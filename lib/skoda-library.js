const axios = require('axios');
const crypto = require("crypto");
const { JSDOM } = require("jsdom");

const BASE_URL_SKODA = "https://mysmob.api.connect.skoda-auto.cz";
const BASE_URL_IDENT = "https://identity.vwgroup.io";
const CLIENT_ID = "7f045eee-7003-4379-9968-9355ed2adb06@apps_vw-dilab_com";
const REDIRECT_URI = "myskoda://redirect/login/";
const SCOPE = "address badge birthdate cars driversLicense dealers email mileage mbb nationalIdentifier openid phone profession profile vin";


class SkodaLibrary {
    constructor(node, config) {
        this.node = node;
        this.config = config;

        this.accessToken = null;
        this.refreshToken = null;
        this.idToken = null;
        this.tokenExpiry = null;

        this.relogin = false;
        this.currentEmail = "";
        this.currentPassword = "";
    }

    // ─── Authentication ───────────────────────────────────────────────────────

    async connect(credentials) {
        if (credentials.email !== this.currentEmail || credentials.password !== this.currentPassword || this.relogin) {
            this.node.status({ fill: "yellow", shape: "ring", text: "logging in" });
            this.relogin = false;
            try {
                await this.login(credentials.email, credentials.password);
                this.currentEmail = credentials.email;
                this.currentPassword = credentials.password;
                this.node.status({ fill: "green", shape: "dot", text: "connected" });
            } catch (error) {
                this.errorHandling(error);
                throw error;
            }
        } else if (this.isTokenExpired()) {
            this.node.status({ fill: "yellow", shape: "ring", text: "refreshing token" });
            try {
                await this.performRefreshToken();
                this.node.status({ fill: "green", shape: "dot", text: "connected" });
            } catch (error) {
                this.node.log("Token refresh failed, trying full re-login");
                this.relogin = true;
                await this.connect(credentials);
            }
        }
    }

    errorHandling(error) {
        this.node.status({ fill: "red", shape: "dot", text: "error" });
        if (error && error.message) {
            this.node.error(error.message);
        } else if (error) {
            this.node.error(JSON.stringify(error));
        }
        if (error && error.stack) {
            this.node.log(error.stack);
        }
    }

    generateVerifier() {
        return crypto.randomBytes(32).toString("base64url");
    }

    generateChallenge(verifier) {
        return crypto.createHash("sha256").update(verifier).digest("base64url");
    }

    generateNonce() {
        return crypto.randomBytes(16).toString("base64url");
    }

    isTokenExpired() {
        if (!this.tokenExpiry) return true;
        return Date.now() >= this.tokenExpiry - 60000;
    }

    parseJwtExpiry(token) {
        try {
            const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
            return payload.exp ? payload.exp * 1000 : 0;
        } catch (e) {
            return 0;
        }
    }

    extractCsrf(html) {
        // The VW identity server puts CSRF data in a script tag as:
        // window._IDK = {
        //   templateModel: {"hmac":"...","relayState":"...", ...},
        //   csrf_token: "...",
        //   ...
        // }
        let csrf = null;
        let hmac = null;
        let relayState = null;

        // Search in the full HTML for these patterns (handles both quoted and unquoted keys)
        const csrfMatch = html.match(/["']?csrf_token["']?\s*:\s*["']([^"']+)["']/);
        if (csrfMatch) csrf = csrfMatch[1];

        const hmacMatch = html.match(/["']?hmac["']?\s*:\s*["']([a-f0-9]{20,})["']/);
        if (hmacMatch) hmac = hmacMatch[1];

        const relayMatch = html.match(/["']?relayState["']?\s*:\s*["']([a-f0-9]{20,})["']/);
        if (relayMatch) relayState = relayMatch[1];

        // If csrf_token not found in script, try hidden input
        if (!csrf) {
            const dom = new JSDOM(html);
            const doc = dom.window.document;
            const csrfInput = doc.querySelector('input[name="_csrf"]');
            if (csrfInput) csrf = csrfInput.value;
        }

        return { csrf, hmac, relayState };
    }

    async followRedirects(url, method, body, contentType, existingCookies) {
        const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36";
        let cookies = [...(existingCookies || [])];
        let currentUrl = url;
        const maxRedirects = 20;

        for (let i = 0; i < maxRedirects; i++) {
            const headers = {
                "User-Agent": UA,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            };
            if (cookies.length > 0) {
                headers["Cookie"] = cookies.map(c => c.split(";")[0]).join("; ");
            }
            if (contentType) {
                headers["Content-Type"] = contentType;
            }

            let response;
            try {
                if (method === 'POST' && i === 0) {
                    response = await axios.post(currentUrl, body, {
                        maxRedirects: 0,
                        validateStatus: () => true,
                        headers,
                    });
                } else {
                    response = await axios.get(currentUrl, {
                        maxRedirects: 0,
                        validateStatus: () => true,
                        headers,
                    });
                }
            } catch (err) {
                if (err.response) {
                    response = err.response;
                } else {
                    throw err;
                }
            }

            // Collect cookies from every step
            if (response.headers["set-cookie"]) {
                const newCookies = response.headers["set-cookie"];
                cookies = cookies.concat(newCookies);
            }

            const location = response.headers["location"];
            if (!location || response.status < 300 || response.status >= 400) {
                // Final response (non-redirect)
                return { body: response.data, status: response.status, cookies, headers: response.headers };
            }

            // Follow the redirect
            if (location.startsWith("/")) {
                const urlObj = new URL(currentUrl);
                currentUrl = `${urlObj.protocol}//${urlObj.host}${location}`;
            } else {
                currentUrl = location;
            }
            method = 'GET'; // redirects always become GET
        }

        throw new Error("Too many redirects during followRedirects");
    }

    async login(email, password) {
        const verifier = this.generateVerifier();
        const challenge = this.generateChallenge(verifier);
        const nonce = this.generateNonce();

        // Step 1: Initial OIDC authorize - follow redirects manually to get the login page
        const authorizeParams = new URLSearchParams({
            client_id: CLIENT_ID,
            nonce: nonce,
            redirect_uri: REDIRECT_URI,
            response_type: "code",
            scope: SCOPE,
            code_challenge: challenge,
            code_challenge_method: "s256",
            prompt: "login",
        });

        let authorizeUrl = `${BASE_URL_IDENT}/oidc/v1/authorize?${authorizeParams.toString()}`;
        let cookies = [];
        let loginPageHtml = "";

        // Follow redirects manually to collect all cookies
        let response = await this.followRedirects(authorizeUrl, 'GET', null, null, cookies);
        loginPageHtml = response.body;
        cookies = response.cookies;

        // Step 2: Extract CSRF from login page and submit email
        const csrfData = this.extractCsrf(loginPageHtml);
        if (!csrfData.csrf || !csrfData.hmac || !csrfData.relayState) {
            throw new Error("Failed to extract CSRF/HMAC/relayState from login page");
        }

        const identifierFormData = new URLSearchParams({
            relayState: csrfData.relayState,
            email: email,
            hmac: csrfData.hmac,
            _csrf: csrfData.csrf,
        });

        const identifierUrl = `${BASE_URL_IDENT}/signin-service/v1/${CLIENT_ID}/login/identifier`;
        response = await this.followRedirects(identifierUrl, 'POST', identifierFormData.toString(), 'application/x-www-form-urlencoded', cookies);
        cookies = response.cookies;

        // Step 3: Extract CSRF from password page and submit password
        const csrfData2 = this.extractCsrf(response.body);
        if (!csrfData2.csrf) {
            this.node.log("Password page response status: " + response.status);
            this.node.log("Password page excerpt: " + (typeof response.body === 'string' ? response.body.substring(0, 500) : JSON.stringify(response.body)));
            throw new Error("Failed to extract CSRF from password page. Check your email address.");
        }
        // Use hmac/relayState from step 2 if not found in step 3
        if (!csrfData2.hmac) csrfData2.hmac = csrfData.hmac;
        if (!csrfData2.relayState) csrfData2.relayState = csrfData.relayState;

        const authFormData = new URLSearchParams({
            relayState: csrfData2.relayState,
            email: email,
            password: password,
            hmac: csrfData2.hmac,
            _csrf: csrfData2.csrf,
        });

        const authenticateUrl = `${BASE_URL_IDENT}/signin-service/v1/${CLIENT_ID}/login/authenticate`;

        // Step 4: Submit password and follow redirect chain to myskoda://
        // Use allow_redirects=False like the Python library, then manually follow
        const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36";
        let authResponse;
        try {
            authResponse = await axios.post(authenticateUrl, authFormData.toString(), {
                maxRedirects: 0,
                validateStatus: () => true,
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": UA,
                    "Cookie": cookies.map(c => c.split(";")[0]).join("; "),
                },
            });
        } catch (authErr) {
            if (authErr.response) {
                authResponse = authErr.response;
            } else {
                throw new Error("Authentication request failed: " + (authErr.message || authErr));
            }
        }

        if (authResponse.headers["set-cookie"]) {
            cookies = cookies.concat(authResponse.headers["set-cookie"]);
        }

        let location = authResponse.headers["location"];
        if (!location) {
            this.node.log("Auth response status: " + authResponse.status);
            this.node.log("Auth response excerpt: " + (typeof authResponse.data === 'string' ? authResponse.data.substring(0, 500) : JSON.stringify(authResponse.data)));
            throw new Error("No redirect after authentication. Check your credentials.");
        }

        // Follow redirects until myskoda:// is encountered
        const maxRedirects = 20;
        for (let i = 0; i < maxRedirects; i++) {
            if (location.startsWith("myskoda://")) {
                break;
            }
            if (location.includes("terms-and-conditions")) {
                throw new Error("You must accept the Terms and Conditions in the MySkoda app first.");
            }
            if (location.includes("consent/marketing")) {
                throw new Error("You must handle the marketing consent in the MySkoda app first.");
            }
            this.node.log(`Login redirect ${i+1}: ${location.substring(0, 120)}`);

            let redirectUrl = location;
            if (redirectUrl.startsWith("/")) {
                redirectUrl = `${BASE_URL_IDENT}${redirectUrl}`;
            }

            let rResponse;
            try {
                rResponse = await axios.get(redirectUrl, {
                    maxRedirects: 0,
                    validateStatus: () => true,
                    headers: {
                        "User-Agent": UA,
                        "Cookie": cookies.map(c => c.split(";")[0]).join("; "),
                    },
                });
            } catch (redirectErr) {
                if (redirectErr.response) {
                    rResponse = redirectErr.response;
                } else {
                    throw redirectErr;
                }
            }

            if (rResponse.headers["set-cookie"]) {
                cookies = cookies.concat(rResponse.headers["set-cookie"]);
            }
            location = rResponse.headers["location"];
            if (!location) {
                throw new Error(`Lost redirect chain at step ${i+1}. Status: ${rResponse.status}`);
            }
        }

        if (!location || !location.startsWith("myskoda://")) {
            throw new Error("Failed to complete login redirect chain.");
        }

        // Step 4: Extract authorization code from redirect URI
        const urlObj = new URL(location);
        const authCode = urlObj.searchParams.get("code");
        if (!authCode) {
            throw new Error("No authorization code received in redirect.");
        }

        // Step 5: Exchange auth code for tokens via Skoda API
        const tokenResponse = await axios.post(
            `${BASE_URL_SKODA}/api/v1/authentication/exchange-authorization-code?tokenType=CONNECT`,
            {
                code: authCode,
                redirectUri: REDIRECT_URI,
                verifier: verifier,
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
            }
        );

        if (!tokenResponse.data || !tokenResponse.data.accessToken) {
            throw new Error("Failed to exchange authorization code for tokens.");
        }

        this.accessToken = tokenResponse.data.accessToken;
        this.refreshToken = tokenResponse.data.refreshToken;
        this.idToken = tokenResponse.data.idToken;
        this.tokenExpiry = this.parseJwtExpiry(this.accessToken);

        this.node.log("Login successful");
    }

    async performRefreshToken() {
        const response = await axios.post(
            `${BASE_URL_SKODA}/api/v1/authentication/refresh-token?tokenType=CONNECT`,
            { token: this.refreshToken },
            {
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
            }
        );

        if (!response.data || !response.data.accessToken) {
            throw new Error("Failed to refresh token.");
        }

        this.accessToken = response.data.accessToken;
        this.refreshToken = response.data.refreshToken;
        this.idToken = response.data.idToken;
        this.tokenExpiry = this.parseJwtExpiry(this.accessToken);
        this.node.log("Token refreshed successfully");
    }

    // ─── API Helpers ────────────────────────────────────────────────────────────

    getHeaders() {
        return {
            "Authorization": `Bearer ${this.accessToken}`,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 (Linux; Android 14) MySkoda/8.11.0",
        };
    }

    async apiGet(path) {
        const url = `${BASE_URL_SKODA}/api${path}`;
        const response = await axios.get(url, { headers: this.getHeaders() });
        return response.data;
    }

    async apiPost(path, data = null) {
        const url = `${BASE_URL_SKODA}/api${path}`;
        const response = await axios.post(url, data, { headers: this.getHeaders() });
        return response.data;
    }

    async apiPut(path, data = null) {
        const url = `${BASE_URL_SKODA}/api${path}`;
        const response = await axios.put(url, data, { headers: this.getHeaders() });
        return response.data;
    }

    // ─── Vehicle Data (GET) ─────────────────────────────────────────────────────

    async getVehicles() {
        const data = await this.apiGet("/v2/garage");
        if (!data || !data.vehicles || data.vehicles.length === 0) {
            throw new Error("No vehicles found in garage.");
        }
        return data.vehicles.map(v => v.vin);
    }

    async getVehicleInfo(vin) {
        return await this.apiGet(`/v2/garage/vehicles/${vin}?connectivityGenerations=MOD1&connectivityGenerations=MOD2&connectivityGenerations=MOD3&connectivityGenerations=MOD4`);
    }

    async getVehicleStatus(vin) {
        return await this.apiGet(`/v2/vehicle-status/${vin}`);
    }

    async getDrivingRange(vin) {
        return await this.apiGet(`/v2/vehicle-status/${vin}/driving-range`);
    }

    async getAirConditioning(vin) {
        return await this.apiGet(`/v2/air-conditioning/${vin}`);
    }

    async getPositions(vin) {
        return await this.apiGet(`/v1/maps/positions?vin=${vin}`);
    }

    async getCharging(vin) {
        return await this.apiGet(`/v1/charging/${vin}`);
    }

    async getMaintenance(vin) {
        return await this.apiGet(`/v3/vehicle-maintenance/vehicles/${vin}`);
    }

    async getTripStatistics(vin) {
        return await this.apiGet(`/v1/trip-statistics/${vin}?offsetType=week&offset=0&timezone=Europe/Berlin`);
    }

    async getAllCarsData(vins, config) {
        const vehicles = [];

        for (const vin of vins) {
            const currentCar = { vin };

            try {
                currentCar.info = await this.getVehicleInfo(vin);
            } catch (e) {
                this.node.warn(`Failed to get vehicle info for ${vin}: ${e.message}`);
            }

            try {
                currentCar.status = await this.getVehicleStatus(vin);
            } catch (e) {
                this.node.warn(`Failed to get vehicle status for ${vin}: ${e.message}`);
            }

            try {
                currentCar.drivingRange = await this.getDrivingRange(vin);
            } catch (e) {
                this.node.warn(`Failed to get driving range for ${vin}: ${e.message}`);
            }

            if (config.queryParking) {
                try {
                    currentCar.positions = await this.getPositions(vin);
                } catch (e) {
                    this.node.warn(`Failed to get positions for ${vin}: ${e.message}`);
                }
            }

            if (config.queryClimater) {
                try {
                    currentCar.airConditioning = await this.getAirConditioning(vin);
                } catch (e) {
                    this.node.warn(`Failed to get air conditioning for ${vin}: ${e.message}`);
                }
            }

            if (config.queryCharger) {
                try {
                    currentCar.charging = await this.getCharging(vin);
                } catch (e) {
                    this.node.warn(`Failed to get charging for ${vin}: ${e.message}`);
                }
            }

            if (config.queryMaintenance) {
                try {
                    currentCar.maintenance = await this.getMaintenance(vin);
                } catch (e) {
                    this.node.warn(`Failed to get maintenance for ${vin}: ${e.message}`);
                }
            }

            vehicles.push(currentCar);
        }

        return vehicles;
    }

    // ─── Vehicle Commands (SET) ─────────────────────────────────────────────────

    async startAirConditioning(vin) {
        this.node.status({ fill: "green", shape: "dot", text: "starting AC" });
        return await this.apiPost(`/v2/air-conditioning/${vin}/start`);
    }

    async stopAirConditioning(vin) {
        this.node.status({ fill: "green", shape: "dot", text: "stopping AC" });
        return await this.apiPost(`/v2/air-conditioning/${vin}/stop`);
    }

    async setTargetTemperature(vin, temperatureCelsius) {
        this.node.status({ fill: "green", shape: "dot", text: "setting temperature" });
        const roundTemp = Math.round(temperatureCelsius * 2) / 2;
        return await this.apiPost(`/v2/air-conditioning/${vin}/settings/target-temperature`, {
            temperatureValue: roundTemp,
            unitInCar: "CELSIUS",
        });
    }

    async startWindowHeating(vin) {
        this.node.status({ fill: "green", shape: "dot", text: "starting window heating" });
        return await this.apiPost(`/v2/air-conditioning/${vin}/start-window-heating`);
    }

    async stopWindowHeating(vin) {
        this.node.status({ fill: "green", shape: "dot", text: "stopping window heating" });
        return await this.apiPost(`/v2/air-conditioning/${vin}/stop-window-heating`);
    }

    async setChargeLimit(vin, limitPercent) {
        this.node.status({ fill: "green", shape: "dot", text: "setting charge limit" });
        return await this.apiPut(`/v1/charging/${vin}/set-charge-limit`, {
            targetSOCInPercent: limitPercent,
        });
    }

    async startCharging(vin) {
        this.node.status({ fill: "green", shape: "dot", text: "starting charging" });
        return await this.apiPost(`/v1/charging/${vin}/start`);
    }

    async stopCharging(vin) {
        this.node.status({ fill: "green", shape: "dot", text: "stopping charging" });
        return await this.apiPost(`/v1/charging/${vin}/stop`);
    }

    async honkAndFlash(vin, latitude, longitude) {
        this.node.status({ fill: "green", shape: "dot", text: "honk & flash" });
        return await this.apiPost(`/v1/vehicle-access/${vin}/honk-and-flash`, {
            mode: "HONK_AND_FLASH",
            vehiclePosition: { latitude, longitude },
        });
    }

    async flash(vin, latitude, longitude) {
        this.node.status({ fill: "green", shape: "dot", text: "flash" });
        return await this.apiPost(`/v1/vehicle-access/${vin}/honk-and-flash`, {
            mode: "FLASH",
            vehiclePosition: { latitude, longitude },
        });
    }

    async lock(vin, spin) {
        this.node.status({ fill: "green", shape: "dot", text: "locking" });
        return await this.apiPost(`/v1/vehicle-access/${vin}/lock`, {
            currentSpin: spin,
        });
    }

    async unlock(vin, spin) {
        this.node.status({ fill: "green", shape: "dot", text: "unlocking" });
        return await this.apiPost(`/v1/vehicle-access/${vin}/unlock`, {
            currentSpin: spin,
        });
    }

    async wakeup(vin) {
        this.node.status({ fill: "green", shape: "dot", text: "waking up" });
        return await this.apiPost(`/v1/vehicle-wakeup/${vin}?applyRequestLimiter=true`);
    }
}

module.exports = SkodaLibrary;

