const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const SkodaLibrary = require('../lib/skoda-library');

// Mock node object for Node-RED
function createMockNode() {
    return {
        status: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
}

describe('SkodaLibrary', () => {
    let lib;
    let mockNode;

    beforeEach(() => {
        mockNode = createMockNode();
        lib = new SkodaLibrary(mockNode, {});
    });

    // ─── Constructor ─────────────────────────────────────────────────────────

    describe('constructor', () => {
        it('should initialize with null tokens', () => {
            expect(lib.accessToken).toBeNull();
            expect(lib.refreshToken).toBeNull();
            expect(lib.idToken).toBeNull();
            expect(lib.tokenExpiry).toBeNull();
        });

        it('should store node and config references', () => {
            expect(lib.node).toBe(mockNode);
            expect(lib.config).toEqual({});
        });
    });

    // ─── Crypto helpers ──────────────────────────────────────────────────────

    describe('generateVerifier', () => {
        it('should return a base64url string', () => {
            const verifier = lib.generateVerifier();
            expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
        });

        it('should return 43 characters (32 bytes in base64url)', () => {
            const verifier = lib.generateVerifier();
            expect(verifier.length).toBe(43);
        });

        it('should generate unique values', () => {
            const v1 = lib.generateVerifier();
            const v2 = lib.generateVerifier();
            expect(v1).not.toBe(v2);
        });
    });

    describe('generateChallenge', () => {
        it('should return a base64url string', () => {
            const verifier = lib.generateVerifier();
            const challenge = lib.generateChallenge(verifier);
            expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
        });

        it('should be deterministic for the same verifier', () => {
            const verifier = 'test-verifier-string';
            const c1 = lib.generateChallenge(verifier);
            const c2 = lib.generateChallenge(verifier);
            expect(c1).toBe(c2);
        });

        it('should produce different challenges for different verifiers', () => {
            const c1 = lib.generateChallenge('verifier1');
            const c2 = lib.generateChallenge('verifier2');
            expect(c1).not.toBe(c2);
        });
    });

    describe('generateNonce', () => {
        it('should return a base64url string', () => {
            const nonce = lib.generateNonce();
            expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
        });

        it('should generate unique values', () => {
            const n1 = lib.generateNonce();
            const n2 = lib.generateNonce();
            expect(n1).not.toBe(n2);
        });
    });

    // ─── Token handling ──────────────────────────────────────────────────────

    describe('isTokenExpired', () => {
        it('should return true when tokenExpiry is null', () => {
            expect(lib.isTokenExpired()).toBe(true);
        });

        it('should return true when token is expired', () => {
            lib.tokenExpiry = Date.now() - 10000;
            expect(lib.isTokenExpired()).toBe(true);
        });

        it('should return true when token expires within 60 seconds', () => {
            lib.tokenExpiry = Date.now() + 30000; // 30s from now
            expect(lib.isTokenExpired()).toBe(true);
        });

        it('should return false when token is valid and not near expiry', () => {
            lib.tokenExpiry = Date.now() + 600000; // 10min from now
            expect(lib.isTokenExpired()).toBe(false);
        });
    });

    describe('parseJwtExpiry', () => {
        it('should parse expiry from a valid JWT', () => {
            const exp = Math.floor(Date.now() / 1000) + 3600;
            const payload = Buffer.from(JSON.stringify({ exp })).toString('base64');
            const fakeJwt = `header.${payload}.signature`;
            expect(lib.parseJwtExpiry(fakeJwt)).toBe(exp * 1000);
        });

        it('should return 0 for an invalid JWT', () => {
            expect(lib.parseJwtExpiry('not.a.jwt')).toBe(0);
            expect(lib.parseJwtExpiry('')).toBe(0);
            expect(lib.parseJwtExpiry(null)).toBe(0);
        });

        it('should return 0 when exp is missing', () => {
            const payload = Buffer.from(JSON.stringify({ sub: 'user' })).toString('base64');
            const fakeJwt = `header.${payload}.signature`;
            expect(lib.parseJwtExpiry(fakeJwt)).toBe(0);
        });
    });

    // ─── CSRF Extraction ─────────────────────────────────────────────────────

    describe('extractCsrf', () => {
        it('should extract from real VW identity server format', () => {
            const html = `
                <html><body>
                    <script>
                        window._IDK = {
                            templateModel: {"clientLegalEntityModel":{"clientId":"test"},"hmac":"71ff346b562f985718e591e27bf4a2b026ad970c","relayState":"b7d80868f77a39b2ccc80db2346f1078c4fd2545"},
                            csrf_token: 'the-csrf-token-value',
                        }
                    </script>
                </body></html>
            `;
            const result = lib.extractCsrf(html);
            expect(result.csrf).toBe('the-csrf-token-value');
            expect(result.hmac).toBe('71ff346b562f985718e591e27bf4a2b026ad970c');
            expect(result.relayState).toBe('b7d80868f77a39b2ccc80db2346f1078c4fd2545');
        });

        it('should extract from JSON-quoted keys format', () => {
            const html = `
                <html><body>
                    <script>
                        window._IDK = {
                            "csrf_token": "csrf-json-val",
                            "templateModel": {"hmac":"aabbccddee00112233445566778899aabbccddee","relayState":"11223344556677889900aabbccddeeff11223344"}
                        }
                    </script>
                </body></html>
            `;
            const result = lib.extractCsrf(html);
            expect(result.csrf).toBe('csrf-json-val');
            expect(result.hmac).toBe('aabbccddee00112233445566778899aabbccddee');
            expect(result.relayState).toBe('11223344556677889900aabbccddeeff11223344');
        });

        it('should fallback to hidden input for csrf when csrf_token not in script', () => {
            const html = `
                <html><body>
                    <form>
                        <input type="hidden" name="_csrf" value="csrf-from-input"/>
                    </form>
                    <script>
                        window._IDK = {
                            templateModel: {"hmac":"aabbccddee00112233445566778899aabbccddee","relayState":"11223344556677889900aabbccddeeff11223344"}
                        }
                    </script>
                </body></html>
            `;
            const result = lib.extractCsrf(html);
            expect(result.csrf).toBe('csrf-from-input');
            expect(result.hmac).toBe('aabbccddee00112233445566778899aabbccddee');
            expect(result.relayState).toBe('11223344556677889900aabbccddeeff11223344');
        });

        it('should return nulls when elements are missing', () => {
            const html = '<html><body><p>No form here</p></body></html>';
            const result = lib.extractCsrf(html);
            expect(result.csrf).toBeNull();
            expect(result.hmac).toBeNull();
            expect(result.relayState).toBeNull();
        });
    });

    // ─── Error handling ──────────────────────────────────────────────────────

    describe('errorHandling', () => {
        it('should set node status to error', () => {
            lib.errorHandling(new Error('test error'));
            expect(mockNode.status).toHaveBeenCalledWith({
                fill: "red", shape: "dot", text: "error"
            });
        });

        it('should log error message', () => {
            lib.errorHandling(new Error('something failed'));
            expect(mockNode.error).toHaveBeenCalledWith('something failed');
        });

        it('should handle non-Error objects', () => {
            lib.errorHandling({ code: 'ERR_NETWORK' });
            expect(mockNode.error).toHaveBeenCalled();
        });

        it('should handle null error gracefully', () => {
            expect(() => lib.errorHandling(null)).not.toThrow();
        });
    });

    // ─── API Helpers ─────────────────────────────────────────────────────────

    describe('getHeaders', () => {
        it('should include Authorization bearer token', () => {
            lib.accessToken = 'test-access-token';
            const headers = lib.getHeaders();
            expect(headers['Authorization']).toBe('Bearer test-access-token');
        });

        it('should include Content-Type and Accept as JSON', () => {
            lib.accessToken = 'token';
            const headers = lib.getHeaders();
            expect(headers['Content-Type']).toBe('application/json');
            expect(headers['Accept']).toBe('application/json');
        });
    });

    describe('API methods (apiGet, apiPost, apiPut)', () => {
        let mock;

        beforeEach(() => {
            mock = new MockAdapter(axios);
            lib.accessToken = 'test-token';
        });

        afterEach(() => {
            mock.restore();
        });

        it('apiGet should call correct URL and return data', async () => {
            mock.onGet('https://mysmob.api.connect.skoda-auto.cz/api/v2/garage').reply(200, {
                vehicles: [{ vin: 'TEST123' }]
            });

            const result = await lib.apiGet('/v2/garage');
            expect(result.vehicles[0].vin).toBe('TEST123');
        });

        it('apiPost should send data and return response', async () => {
            mock.onPost('https://mysmob.api.connect.skoda-auto.cz/api/v2/air-conditioning/VIN123/start').reply(200, {
                status: 'accepted'
            });

            const result = await lib.apiPost('/v2/air-conditioning/VIN123/start');
            expect(result.status).toBe('accepted');
        });

        it('apiPut should send data and return response', async () => {
            mock.onPut('https://mysmob.api.connect.skoda-auto.cz/api/v1/charging/VIN123/set-charge-limit').reply(200, {
                status: 'ok'
            });

            const result = await lib.apiPut('/v1/charging/VIN123/set-charge-limit', {
                targetSOCInPercent: 80
            });
            expect(result.status).toBe('ok');
        });

        it('apiGet should throw on 401', async () => {
            mock.onGet('https://mysmob.api.connect.skoda-auto.cz/api/v2/garage').reply(401);
            await expect(lib.apiGet('/v2/garage')).rejects.toThrow();
        });

        it('apiGet should throw on 500', async () => {
            mock.onGet('https://mysmob.api.connect.skoda-auto.cz/api/v2/garage').reply(500);
            await expect(lib.apiGet('/v2/garage')).rejects.toThrow();
        });
    });

    // ─── Vehicle Data Methods ────────────────────────────────────────────────

    describe('getVehicles', () => {
        let mock;

        beforeEach(() => {
            mock = new MockAdapter(axios);
            lib.accessToken = 'test-token';
        });

        afterEach(() => {
            mock.restore();
        });

        it('should return array of VINs', async () => {
            mock.onGet(/\/api\/v2\/garage/).reply(200, {
                vehicles: [
                    { vin: 'VIN001', nickname: 'Car1' },
                    { vin: 'VIN002', nickname: 'Car2' },
                ]
            });

            const vins = await lib.getVehicles();
            expect(vins).toEqual(['VIN001', 'VIN002']);
        });

        it('should throw when no vehicles found', async () => {
            mock.onGet(/\/api\/v2\/garage/).reply(200, { vehicles: [] });
            await expect(lib.getVehicles()).rejects.toThrow('No vehicles found');
        });

        it('should throw when response has no vehicles array', async () => {
            mock.onGet(/\/api\/v2\/garage/).reply(200, {});
            await expect(lib.getVehicles()).rejects.toThrow('No vehicles found');
        });
    });

    describe('getAllCarsData', () => {
        let mock;

        beforeEach(() => {
            mock = new MockAdapter(axios);
            lib.accessToken = 'test-token';
        });

        afterEach(() => {
            mock.restore();
        });

        it('should fetch info, status, and drivingRange for each VIN', async () => {
            mock.onGet(/\/v2\/garage\/vehicles\/VIN1/).reply(200, { vin: 'VIN1', model: 'Enyaq' });
            mock.onGet(/\/v2\/vehicle-status\/VIN1$/).reply(200, { doors: 'locked' });
            mock.onGet(/\/v2\/vehicle-status\/VIN1\/driving-range/).reply(200, { range: 350 });

            const result = await lib.getAllCarsData(['VIN1'], {});
            expect(result).toHaveLength(1);
            expect(result[0].vin).toBe('VIN1');
            expect(result[0].info.model).toBe('Enyaq');
            expect(result[0].status.doors).toBe('locked');
            expect(result[0].drivingRange.range).toBe(350);
        });

        it('should include positions when queryParking is true', async () => {
            mock.onGet(/\/v2\/garage\/vehicles\/VIN1/).reply(200, {});
            mock.onGet(/\/v2\/vehicle-status\/VIN1$/).reply(200, {});
            mock.onGet(/\/v2\/vehicle-status\/VIN1\/driving-range/).reply(200, {});
            mock.onGet(/\/v1\/maps\/positions/).reply(200, { lat: 50.0, lng: 14.0 });

            const result = await lib.getAllCarsData(['VIN1'], { queryParking: true });
            expect(result[0].positions.lat).toBe(50.0);
        });

        it('should include airConditioning when queryClimater is true', async () => {
            mock.onGet(/\/v2\/garage\/vehicles\/VIN1/).reply(200, {});
            mock.onGet(/\/v2\/vehicle-status\/VIN1$/).reply(200, {});
            mock.onGet(/\/v2\/vehicle-status\/VIN1\/driving-range/).reply(200, {});
            mock.onGet(/\/v2\/air-conditioning\/VIN1/).reply(200, { targetTemp: 22 });

            const result = await lib.getAllCarsData(['VIN1'], { queryClimater: true });
            expect(result[0].airConditioning.targetTemp).toBe(22);
        });

        it('should include charging when queryCharger is true', async () => {
            mock.onGet(/\/v2\/garage\/vehicles\/VIN1/).reply(200, {});
            mock.onGet(/\/v2\/vehicle-status\/VIN1$/).reply(200, {});
            mock.onGet(/\/v2\/vehicle-status\/VIN1\/driving-range/).reply(200, {});
            mock.onGet(/\/v1\/charging\/VIN1/).reply(200, { state: 'charging' });

            const result = await lib.getAllCarsData(['VIN1'], { queryCharger: true });
            expect(result[0].charging.state).toBe('charging');
        });

        it('should warn but not throw when optional endpoint fails', async () => {
            mock.onGet(/\/v2\/garage\/vehicles\/VIN1/).reply(200, {});
            mock.onGet(/\/v2\/vehicle-status\/VIN1$/).reply(200, {});
            mock.onGet(/\/v2\/vehicle-status\/VIN1\/driving-range/).reply(200, {});
            mock.onGet(/\/v1\/charging\/VIN1/).reply(500);

            const result = await lib.getAllCarsData(['VIN1'], { queryCharger: true });
            expect(result[0].charging).toBeUndefined();
            expect(mockNode.warn).toHaveBeenCalled();
        });
    });

    // ─── Vehicle Commands ────────────────────────────────────────────────────

    describe('vehicle commands', () => {
        let mock;

        beforeEach(() => {
            mock = new MockAdapter(axios);
            lib.accessToken = 'test-token';
        });

        afterEach(() => {
            mock.restore();
        });

        it('startAirConditioning should POST to correct endpoint', async () => {
            mock.onPost('https://mysmob.api.connect.skoda-auto.cz/api/v2/air-conditioning/VIN1/start').reply(200, { ok: true });
            const result = await lib.startAirConditioning('VIN1');
            expect(result.ok).toBe(true);
            expect(mockNode.status).toHaveBeenCalledWith(expect.objectContaining({ text: "starting AC" }));
        });

        it('stopAirConditioning should POST to correct endpoint', async () => {
            mock.onPost('https://mysmob.api.connect.skoda-auto.cz/api/v2/air-conditioning/VIN1/stop').reply(200, { ok: true });
            const result = await lib.stopAirConditioning('VIN1');
            expect(result.ok).toBe(true);
        });

        it('setTargetTemperature should round to 0.5 and POST', async () => {
            mock.onPost('https://mysmob.api.connect.skoda-auto.cz/api/v2/air-conditioning/VIN1/settings/target-temperature').reply(200, { ok: true });
            await lib.setTargetTemperature('VIN1', 21.3);
            const request = mock.history.post[0];
            const body = JSON.parse(request.data);
            expect(body.temperatureValue).toBe(21.5);
            expect(body.unitInCar).toBe('CELSIUS');
        });

        it('setTargetTemperature should handle exact values', async () => {
            mock.onPost(/target-temperature/).reply(200, {});
            await lib.setTargetTemperature('VIN1', 22.0);
            const body = JSON.parse(mock.history.post[0].data);
            expect(body.temperatureValue).toBe(22);
        });

        it('startCharging should POST to correct endpoint', async () => {
            mock.onPost('https://mysmob.api.connect.skoda-auto.cz/api/v1/charging/VIN1/start').reply(200, {});
            await lib.startCharging('VIN1');
            expect(mock.history.post).toHaveLength(1);
        });

        it('stopCharging should POST to correct endpoint', async () => {
            mock.onPost('https://mysmob.api.connect.skoda-auto.cz/api/v1/charging/VIN1/stop').reply(200, {});
            await lib.stopCharging('VIN1');
            expect(mock.history.post).toHaveLength(1);
        });

        it('setChargeLimit should PUT with targetSOCInPercent', async () => {
            mock.onPut('https://mysmob.api.connect.skoda-auto.cz/api/v1/charging/VIN1/set-charge-limit').reply(200, {});
            await lib.setChargeLimit('VIN1', 80);
            const body = JSON.parse(mock.history.put[0].data);
            expect(body.targetSOCInPercent).toBe(80);
        });

        it('lock should POST with spin', async () => {
            mock.onPost('https://mysmob.api.connect.skoda-auto.cz/api/v1/vehicle-access/VIN1/lock').reply(200, {});
            await lib.lock('VIN1', '1234');
            const body = JSON.parse(mock.history.post[0].data);
            expect(body.currentSpin).toBe('1234');
        });

        it('unlock should POST with spin', async () => {
            mock.onPost('https://mysmob.api.connect.skoda-auto.cz/api/v1/vehicle-access/VIN1/unlock').reply(200, {});
            await lib.unlock('VIN1', '5678');
            const body = JSON.parse(mock.history.post[0].data);
            expect(body.currentSpin).toBe('5678');
        });

        it('honkAndFlash should POST with position', async () => {
            mock.onPost('https://mysmob.api.connect.skoda-auto.cz/api/v1/vehicle-access/VIN1/honk-and-flash').reply(200, {});
            await lib.honkAndFlash('VIN1', 50.08, 14.42);
            const body = JSON.parse(mock.history.post[0].data);
            expect(body.mode).toBe('HONK_AND_FLASH');
            expect(body.vehiclePosition.latitude).toBe(50.08);
            expect(body.vehiclePosition.longitude).toBe(14.42);
        });

        it('flash should POST with FLASH mode', async () => {
            mock.onPost('https://mysmob.api.connect.skoda-auto.cz/api/v1/vehicle-access/VIN1/honk-and-flash').reply(200, {});
            await lib.flash('VIN1', 50.08, 14.42);
            const body = JSON.parse(mock.history.post[0].data);
            expect(body.mode).toBe('FLASH');
        });

        it('wakeup should POST to correct endpoint', async () => {
            mock.onPost(/vehicle-wakeup\/VIN1/).reply(200, {});
            await lib.wakeup('VIN1');
            expect(mock.history.post).toHaveLength(1);
        });

        it('startWindowHeating should POST', async () => {
            mock.onPost('https://mysmob.api.connect.skoda-auto.cz/api/v2/air-conditioning/VIN1/start-window-heating').reply(200, {});
            await lib.startWindowHeating('VIN1');
            expect(mock.history.post).toHaveLength(1);
        });

        it('stopWindowHeating should POST', async () => {
            mock.onPost('https://mysmob.api.connect.skoda-auto.cz/api/v2/air-conditioning/VIN1/stop-window-heating').reply(200, {});
            await lib.stopWindowHeating('VIN1');
            expect(mock.history.post).toHaveLength(1);
        });
    });

    // ─── Connect & Token Refresh ─────────────────────────────────────────────

    describe('connect', () => {
        let mock;

        beforeEach(() => {
            mock = new MockAdapter(axios);
        });

        afterEach(() => {
            mock.restore();
        });

        it('should skip login if credentials unchanged and token valid', async () => {
            lib.currentEmail = 'test@test.com';
            lib.currentPassword = 'pass';
            lib.tokenExpiry = Date.now() + 600000;
            lib.accessToken = 'valid-token';

            await lib.connect({ email: 'test@test.com', password: 'pass' });
            expect(mockNode.status).not.toHaveBeenCalled();
        });

        it('should attempt refresh when token expired but credentials match', async () => {
            lib.currentEmail = 'test@test.com';
            lib.currentPassword = 'pass';
            lib.tokenExpiry = Date.now() - 10000; // expired
            lib.accessToken = 'old-token';
            lib.refreshToken = 'refresh-token';

            const exp = Math.floor(Date.now() / 1000) + 3600;
            const payload = Buffer.from(JSON.stringify({ exp })).toString('base64');
            const newToken = `h.${payload}.s`;

            mock.onPost(/refresh-token/).reply(200, {
                accessToken: newToken,
                refreshToken: 'new-refresh',
                idToken: 'new-id',
            });

            await lib.connect({ email: 'test@test.com', password: 'pass' });
            expect(lib.accessToken).toBe(newToken);
            expect(mockNode.status).toHaveBeenCalledWith(expect.objectContaining({ text: "refreshing token" }));
        });
    });

    describe('performRefreshToken', () => {
        let mock;

        beforeEach(() => {
            mock = new MockAdapter(axios);
            lib.refreshToken = 'old-refresh-token';
        });

        afterEach(() => {
            mock.restore();
        });

        it('should update tokens on success', async () => {
            const exp = Math.floor(Date.now() / 1000) + 3600;
            const payload = Buffer.from(JSON.stringify({ exp })).toString('base64');
            const newToken = `header.${payload}.sig`;

            mock.onPost('https://mysmob.api.connect.skoda-auto.cz/api/v1/authentication/refresh-token?tokenType=CONNECT').reply(200, {
                accessToken: newToken,
                refreshToken: 'refreshed-token',
                idToken: 'id-token',
            });

            await lib.performRefreshToken();
            expect(lib.accessToken).toBe(newToken);
            expect(lib.refreshToken).toBe('refreshed-token');
            expect(lib.idToken).toBe('id-token');
            expect(lib.tokenExpiry).toBe(exp * 1000);
        });

        it('should throw when response has no accessToken', async () => {
            mock.onPost(/refresh-token/).reply(200, { error: 'invalid' });
            await expect(lib.performRefreshToken()).rejects.toThrow('Failed to refresh token');
        });

        it('should throw on HTTP error', async () => {
            mock.onPost(/refresh-token/).reply(401);
            await expect(lib.performRefreshToken()).rejects.toThrow();
        });
    });
});
