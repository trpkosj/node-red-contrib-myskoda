const helper = require('node-red-node-test-helper');
const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const myskodaSetNode = require('../nodes/myskoda-set.js');
const myskodaCredentialsNode = require('../nodes/myskoda-credentials.js');

helper.init(require.resolve('node-red'));

// ─── Test Helpers ────────────────────────────────────────────────────────────

const VIN = 'TMBJX000000000001';
const SPIN = '1234';

const LOGIN_PAGE_HTML = `
    <html><body><script>
        window._IDK = { csrf_token: 'csrf1', templateModel: {"hmac":"aabbccddee00112233445566778899aabbccddee","relayState":"11223344556677889900aabbccddeeff11223344"} }
    </script></body></html>
`;

const PASSWORD_PAGE_HTML = `
    <html><body><script>
        window._IDK = { csrf_token: 'csrf2', templateModel: {"hmac":"aabbccddee00112233445566778899aabbccddee","relayState":"11223344556677889900aabbccddeeff11223344"} }
    </script></body></html>
`;

function mockLoginFlow(mock) {
    mock.onGet(/identity\.vwgroup\.io/).reply(200, LOGIN_PAGE_HTML);
    mock.onPost(/login\/identifier/).reply(200, PASSWORD_PAGE_HTML);
    mock.onPost(/login\/authenticate/).reply(302, '', {
        location: 'myskoda://redirect/login/?code=auth-code-123&state=test'
    });
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = Buffer.from(JSON.stringify({ exp, sub: 'user1' })).toString('base64');
    mock.onPost(/exchange-authorization-code/).reply(200, {
        accessToken: `h.${payload}.s`,
        refreshToken: 'refresh-123',
        idToken: 'id-123',
    });
}

const credConfigNode = { id: 'cred1', type: 'myskoda-credentials', name: 'Test Account' };
const nodeTypes = [myskodaSetNode, myskodaCredentialsNode];

function makeFlow(command) {
    return [
        credConfigNode,
        { id: 'n1', type: 'myskoda-set', name: 'test set', account: 'cred1', command, wires: [['n2']] },
        { id: 'n2', type: 'helper' },
    ];
}

const defaultCredentials = {
    cred1: { email: 'test@test.com', password: 'pass123' },
    n1: { email: 'test@test.com', password: 'pass123' },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('myskoda-set node', () => {
    let mock;

    beforeEach((done) => {
        mock = new MockAdapter(axios);
        helper.startServer(done);
    });

    afterEach((done) => {
        mock.restore();
        helper.unload();
        helper.stopServer(done);
    });

    // ── Loading ──────────────────────────────────────────────────────────────

    it('should be loaded with startAC command', (done) => {
        const flow = [credConfigNode, { id: 'n1', type: 'myskoda-set', name: 'test set', account: 'cred1', command: 'startAC' }];
        helper.load(nodeTypes, flow, defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            expect(n1).toBeTruthy();
            expect(n1.name).toBe('test set');
            done();
        });
    });

    it('should be loaded with lock command', (done) => {
        const flow = [credConfigNode, { id: 'n1', type: 'myskoda-set', name: 'lock node', account: 'cred1', command: 'lock' }];
        helper.load(nodeTypes, flow, defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            expect(n1).toBeTruthy();
            expect(n1.name).toBe('lock node');
            done();
        });
    });

    // ── VIN validation ───────────────────────────────────────────────────────

    it('should report error when VIN is missing', (done) => {
        mockLoginFlow(mock);

        helper.load(nodeTypes, makeFlow('startAC'), defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            n1.on('call:error', (call) => {
                try {
                    expect(call.firstArg.message).toContain('VIN is not defined');
                    done();
                } catch (err) { done(err); }
            });
            n1.receive({ payload: true });
        });
    });

    it('should report error when VIN is empty string', (done) => {
        mockLoginFlow(mock);

        helper.load(nodeTypes, makeFlow('startAC'), defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            n1.on('call:error', (call) => {
                try {
                    expect(call.firstArg.message).toContain('VIN is not defined');
                    done();
                } catch (err) { done(err); }
            });
            n1.receive({ payload: true, vin: '' });
        });
    });

    // ── Air Conditioning ─────────────────────────────────────────────────────

    it('should execute startAC command', (done) => {
        mockLoginFlow(mock);
        mock.onPost(new RegExp(`air-conditioning/${VIN}/start`)).reply(200, { status: 'accepted' });

        helper.load(nodeTypes, makeFlow('startAC'), defaultCredentials, () => {
            const n2 = helper.getNode('n2');
            n2.on('input', (msg) => {
                try {
                    expect(msg.payload.status).toBe('accepted');
                    done();
                } catch (err) { done(err); }
            });
            helper.getNode('n1').receive({ payload: true, vin: VIN });
        });
    });

    it('should execute stopAC command', (done) => {
        mockLoginFlow(mock);
        mock.onPost(new RegExp(`air-conditioning/${VIN}/stop`)).reply(200, { status: 'accepted' });

        helper.load(nodeTypes, makeFlow('stopAC'), defaultCredentials, () => {
            const n2 = helper.getNode('n2');
            n2.on('input', (msg) => {
                try {
                    expect(msg.payload.status).toBe('accepted');
                    done();
                } catch (err) { done(err); }
            });
            helper.getNode('n1').receive({ payload: true, vin: VIN });
        });
    });

    // ── Temperature ──────────────────────────────────────────────────────────

    it('should execute temperature command with valid number', (done) => {
        mockLoginFlow(mock);
        mock.onPost(new RegExp(`air-conditioning/${VIN}/settings/target-temperature`)).reply(200, { status: 'accepted' });

        helper.load(nodeTypes, makeFlow('temperature'), defaultCredentials, () => {
            const n2 = helper.getNode('n2');
            n2.on('input', (msg) => {
                try {
                    expect(msg.payload.status).toBe('accepted');
                    done();
                } catch (err) { done(err); }
            });
            helper.getNode('n1').receive({ payload: 22, vin: VIN });
        });
    });

    it('should execute temperature command with decimal value', (done) => {
        mockLoginFlow(mock);
        mock.onPost(new RegExp(`air-conditioning/${VIN}/settings/target-temperature`)).reply(200, { status: 'accepted' });

        helper.load(nodeTypes, makeFlow('temperature'), defaultCredentials, () => {
            const n2 = helper.getNode('n2');
            n2.on('input', (msg) => {
                try {
                    expect(msg.payload.status).toBe('accepted');
                    done();
                } catch (err) { done(err); }
            });
            helper.getNode('n1').receive({ payload: 21.5, vin: VIN });
        });
    });

    it('should reject temperature command with non-number payload', (done) => {
        mockLoginFlow(mock);

        helper.load(nodeTypes, makeFlow('temperature'), defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            n1.on('call:error', (call) => {
                try {
                    expect(call.firstArg.message).toContain('must be a number');
                    done();
                } catch (err) { done(err); }
            });
            n1.receive({ payload: 'not-a-number', vin: VIN });
        });
    });

    it('should reject temperature command with string number payload', (done) => {
        mockLoginFlow(mock);

        helper.load(nodeTypes, makeFlow('temperature'), defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            n1.on('call:error', (call) => {
                try {
                    expect(call.firstArg.message).toContain('must be a number');
                    done();
                } catch (err) { done(err); }
            });
            n1.receive({ payload: '22', vin: VIN });
        });
    });

    // ── Window Heating ───────────────────────────────────────────────────────

    it('should execute startWindowHeating command', (done) => {
        mockLoginFlow(mock);
        mock.onPost(new RegExp(`air-conditioning/${VIN}/start-window-heating`)).reply(200, { status: 'accepted' });

        helper.load(nodeTypes, makeFlow('startWindowHeating'), defaultCredentials, () => {
            const n2 = helper.getNode('n2');
            n2.on('input', (msg) => {
                try {
                    expect(msg.payload.status).toBe('accepted');
                    done();
                } catch (err) { done(err); }
            });
            helper.getNode('n1').receive({ payload: true, vin: VIN });
        });
    });

    it('should execute stopWindowHeating command', (done) => {
        mockLoginFlow(mock);
        mock.onPost(new RegExp(`air-conditioning/${VIN}/stop-window-heating`)).reply(200, { status: 'accepted' });

        helper.load(nodeTypes, makeFlow('stopWindowHeating'), defaultCredentials, () => {
            const n2 = helper.getNode('n2');
            n2.on('input', (msg) => {
                try {
                    expect(msg.payload.status).toBe('accepted');
                    done();
                } catch (err) { done(err); }
            });
            helper.getNode('n1').receive({ payload: true, vin: VIN });
        });
    });

    // ── Charging ─────────────────────────────────────────────────────────────

    it('should execute startCharging command', (done) => {
        mockLoginFlow(mock);
        mock.onPost(new RegExp(`charging/${VIN}/start`)).reply(200, { status: 'accepted' });

        helper.load(nodeTypes, makeFlow('startCharging'), defaultCredentials, () => {
            const n2 = helper.getNode('n2');
            n2.on('input', (msg) => {
                try {
                    expect(msg.payload.status).toBe('accepted');
                    done();
                } catch (err) { done(err); }
            });
            helper.getNode('n1').receive({ payload: true, vin: VIN });
        });
    });

    it('should execute stopCharging command', (done) => {
        mockLoginFlow(mock);
        mock.onPost(new RegExp(`charging/${VIN}/stop`)).reply(200, { status: 'accepted' });

        helper.load(nodeTypes, makeFlow('stopCharging'), defaultCredentials, () => {
            const n2 = helper.getNode('n2');
            n2.on('input', (msg) => {
                try {
                    expect(msg.payload.status).toBe('accepted');
                    done();
                } catch (err) { done(err); }
            });
            helper.getNode('n1').receive({ payload: true, vin: VIN });
        });
    });

    it('should execute setChargeLimit command with valid number', (done) => {
        mockLoginFlow(mock);
        mock.onPut(new RegExp(`charging/${VIN}/set-charge-limit`)).reply(200, { status: 'accepted' });

        helper.load(nodeTypes, makeFlow('setChargeLimit'), defaultCredentials, () => {
            const n2 = helper.getNode('n2');
            n2.on('input', (msg) => {
                try {
                    expect(msg.payload.status).toBe('accepted');
                    done();
                } catch (err) { done(err); }
            });
            helper.getNode('n1').receive({ payload: 80, vin: VIN });
        });
    });

    it('should reject setChargeLimit command with non-number payload', (done) => {
        mockLoginFlow(mock);

        helper.load(nodeTypes, makeFlow('setChargeLimit'), defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            n1.on('call:error', (call) => {
                try {
                    expect(call.firstArg.message).toContain('must be a number');
                    done();
                } catch (err) { done(err); }
            });
            n1.receive({ payload: 'eighty', vin: VIN });
        });
    });

    // ── Lock / Unlock (matches user flow) ────────────────────────────────────

    it('should execute lock command with VIN and SPIN', (done) => {
        mockLoginFlow(mock);
        mock.onPost(new RegExp(`vehicle-access/${VIN}/lock`)).reply(200, { status: 'accepted' });

        helper.load(nodeTypes, makeFlow('lock'), defaultCredentials, () => {
            const n2 = helper.getNode('n2');
            n2.on('input', (msg) => {
                try {
                    expect(msg.payload.status).toBe('accepted');
                    done();
                } catch (err) { done(err); }
            });
            helper.getNode('n1').receive({ payload: true, vin: VIN, spin: SPIN });
        });
    });

    it('should execute unlock command with VIN and SPIN', (done) => {
        mockLoginFlow(mock);
        mock.onPost(new RegExp(`vehicle-access/${VIN}/unlock`)).reply(200, { status: 'accepted' });

        helper.load(nodeTypes, makeFlow('unlock'), defaultCredentials, () => {
            const n2 = helper.getNode('n2');
            n2.on('input', (msg) => {
                try {
                    expect(msg.payload.status).toBe('accepted');
                    done();
                } catch (err) { done(err); }
            });
            helper.getNode('n1').receive({ payload: true, vin: VIN, spin: SPIN });
        });
    });

    it('should reject lock command without SPIN', (done) => {
        mockLoginFlow(mock);

        helper.load(nodeTypes, makeFlow('lock'), defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            n1.on('call:error', (call) => {
                try {
                    expect(call.firstArg.message).toContain('msg.spin is required');
                    done();
                } catch (err) { done(err); }
            });
            n1.receive({ payload: true, vin: VIN });
        });
    });

    it('should reject unlock command without SPIN', (done) => {
        mockLoginFlow(mock);

        helper.load(nodeTypes, makeFlow('unlock'), defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            n1.on('call:error', (call) => {
                try {
                    expect(call.firstArg.message).toContain('msg.spin is required');
                    done();
                } catch (err) { done(err); }
            });
            n1.receive({ payload: true, vin: VIN });
        });
    });

    // ── Honk and Flash ───────────────────────────────────────────────────────

    it('should execute honkAndFlash command with coordinates', (done) => {
        mockLoginFlow(mock);
        mock.onPost(new RegExp(`vehicle-access/${VIN}/honk-and-flash`)).reply(200, { status: 'accepted' });

        helper.load(nodeTypes, makeFlow('honkAndFlash'), defaultCredentials, () => {
            const n2 = helper.getNode('n2');
            n2.on('input', (msg) => {
                try {
                    expect(msg.payload.status).toBe('accepted');
                    done();
                } catch (err) { done(err); }
            });
            helper.getNode('n1').receive({ payload: true, vin: VIN, latitude: 50.0755, longitude: 14.4378 });
        });
    });

    it('should reject honkAndFlash command without coordinates', (done) => {
        mockLoginFlow(mock);

        helper.load(nodeTypes, makeFlow('honkAndFlash'), defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            n1.on('call:error', (call) => {
                try {
                    expect(call.firstArg.message).toContain('msg.latitude and msg.longitude are required');
                    done();
                } catch (err) { done(err); }
            });
            n1.receive({ payload: true, vin: VIN });
        });
    });

    it('should execute flash command with coordinates', (done) => {
        mockLoginFlow(mock);
        mock.onPost(new RegExp(`vehicle-access/${VIN}/honk-and-flash`)).reply(200, { status: 'accepted' });

        helper.load(nodeTypes, makeFlow('flash'), defaultCredentials, () => {
            const n2 = helper.getNode('n2');
            n2.on('input', (msg) => {
                try {
                    expect(msg.payload.status).toBe('accepted');
                    done();
                } catch (err) { done(err); }
            });
            helper.getNode('n1').receive({ payload: true, vin: VIN, latitude: 50.0755, longitude: 14.4378 });
        });
    });

    it('should reject flash command without coordinates', (done) => {
        mockLoginFlow(mock);

        helper.load(nodeTypes, makeFlow('flash'), defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            n1.on('call:error', (call) => {
                try {
                    expect(call.firstArg.message).toContain('msg.latitude and msg.longitude are required');
                    done();
                } catch (err) { done(err); }
            });
            n1.receive({ payload: true, vin: VIN });
        });
    });

    // ── Wakeup ───────────────────────────────────────────────────────────────

    it('should execute wakeup command', (done) => {
        mockLoginFlow(mock);
        mock.onPost(new RegExp(`vehicle-wakeup/${VIN}`)).reply(200, { status: 'accepted' });

        helper.load(nodeTypes, makeFlow('wakeup'), defaultCredentials, () => {
            const n2 = helper.getNode('n2');
            n2.on('input', (msg) => {
                try {
                    expect(msg.payload.status).toBe('accepted');
                    done();
                } catch (err) { done(err); }
            });
            helper.getNode('n1').receive({ payload: true, vin: VIN });
        });
    });

    // ── Unknown command ──────────────────────────────────────────────────────

    it('should reject unknown command', (done) => {
        mockLoginFlow(mock);

        const flow = [
            credConfigNode,
            { id: 'n1', type: 'myskoda-set', name: 'test set', account: 'cred1', command: 'doesNotExist', wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];

        helper.load(nodeTypes, flow, defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            n1.on('call:error', (call) => {
                try {
                    expect(call.firstArg.message).toContain('Unknown command');
                    done();
                } catch (err) { done(err); }
            });
            n1.receive({ payload: true, vin: VIN });
        });
    });

    // ── API error handling ───────────────────────────────────────────────────

    it('should handle API error on lock command', (done) => {
        mockLoginFlow(mock);
        mock.onPost(new RegExp(`vehicle-access/${VIN}/lock`)).reply(500, { error: 'server error' });

        helper.load(nodeTypes, makeFlow('lock'), defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            n1.on('call:error', (call) => {
                try {
                    expect(call.firstArg).toBeDefined();
                    done();
                } catch (err) { done(err); }
            });
            n1.receive({ payload: true, vin: VIN, spin: SPIN });
        });
    });

    it('should handle API error on startAC command', (done) => {
        mockLoginFlow(mock);
        mock.onPost(new RegExp(`air-conditioning/${VIN}/start`)).reply(403, { error: 'forbidden' });

        helper.load(nodeTypes, makeFlow('startAC'), defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            n1.on('call:error', (call) => {
                try {
                    expect(call.firstArg).toBeDefined();
                    done();
                } catch (err) { done(err); }
            });
            n1.receive({ payload: true, vin: VIN });
        });
    });

    // ── Login failure ────────────────────────────────────────────────────────

    it('should handle login failure on set command', (done) => {
        mock.onGet(/identity\.vwgroup\.io/).reply(500);

        helper.load(nodeTypes, makeFlow('lock'), defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            let called = false;
            n1.on('call:error', (call) => {
                if (called) return;
                called = true;
                try {
                    expect(call.firstArg).toBeDefined();
                    done();
                } catch (err) { done(err); }
            });
            n1.receive({ payload: true, vin: VIN, spin: SPIN });
        });
    });

    // ── Success payload when API returns null ────────────────────────────────

    it('should return {success: true} when API returns null/empty', (done) => {
        mockLoginFlow(mock);
        mock.onPost(new RegExp(`vehicle-wakeup/${VIN}`)).reply(200, null);

        helper.load(nodeTypes, makeFlow('wakeup'), defaultCredentials, () => {
            const n2 = helper.getNode('n2');
            n2.on('input', (msg) => {
                try {
                    expect(msg.payload).toEqual({ success: true });
                    done();
                } catch (err) { done(err); }
            });
            helper.getNode('n1').receive({ payload: true, vin: VIN });
        });
    });
});
