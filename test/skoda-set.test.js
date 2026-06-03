const helper = require('node-red-node-test-helper');
const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const skodaSetNode = require('../nodes/skoda-set.js');

helper.init(require.resolve('node-red'));

describe('skoda-set node', () => {
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

    it('should be loaded', (done) => {
        const flow = [{ id: 'n1', type: 'skoda-set', name: 'test set', command: 'startAC' }];
        helper.load(skodaSetNode, flow, () => {
            const n1 = helper.getNode('n1');
            expect(n1).toBeTruthy();
            expect(n1.name).toBe('test set');
            done();
        });
    });

    it('should report error when VIN is missing', (done) => {
        // Mock the login flow
        mock.onGet(/identity\.vwgroup\.io/).reply(200, `
            <html><body><script>
                window._IDK = { csrf_token: 'csrf1', templateModel: {"hmac":"aabbccddee00112233445566778899aabbccddee","relayState":"11223344556677889900aabbccddeeff11223344"} }
            </script></body></html>
        `);
        mock.onPost(/login\/identifier/).reply(200, `
            <html><body><script>
                window._IDK = { csrf_token: 'csrf2', templateModel: {"hmac":"aabbccddee00112233445566778899aabbccddee","relayState":"11223344556677889900aabbccddeeff11223344"} }
            </script></body></html>
        `);
        mock.onPost(/login\/authenticate/).reply(302, '', {
            location: 'myskoda://redirect/login/?code=code123&state=s'
        });
        const exp = Math.floor(Date.now() / 1000) + 3600;
        const payload = Buffer.from(JSON.stringify({ exp })).toString('base64');
        mock.onPost(/exchange-authorization-code/).reply(200, {
            accessToken: `h.${payload}.s`,
            refreshToken: 'r',
            idToken: 'i',
        });

        const flow = [
            { id: 'n1', type: 'skoda-set', name: 'test set', command: 'startAC', wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];
        const credentials = { n1: { email: 'test@test.com', password: 'pass123' } };

        helper.load(skodaSetNode, flow, credentials, () => {
            const n1 = helper.getNode('n1');

            n1.on('call:error', (call) => {
                try {
                    expect(call.firstArg.message).toContain('VIN is not defined');
                    done();
                } catch (err) {
                    done(err);
                }
            });

            // Send message without vin
            n1.receive({ payload: true });
        });
    });

    it('should execute startAC command with VIN', (done) => {
        // Setup login mocks
        mock.onGet(/identity\.vwgroup\.io/).reply(200, `
            <html><body><script>
                window._IDK = { csrf_token: 'csrf1', templateModel: {"hmac":"aabbccddee00112233445566778899aabbccddee","relayState":"11223344556677889900aabbccddeeff11223344"} }
            </script></body></html>
        `);
        mock.onPost(/login\/identifier/).reply(200, `
            <html><body><script>
                window._IDK = { csrf_token: 'csrf2', templateModel: {"hmac":"aabbccddee00112233445566778899aabbccddee","relayState":"11223344556677889900aabbccddeeff11223344"} }
            </script></body></html>
        `);
        mock.onPost(/login\/authenticate/).reply(302, '', {
            location: 'myskoda://redirect/login/?code=code123&state=s'
        });
        const exp = Math.floor(Date.now() / 1000) + 3600;
        const payload = Buffer.from(JSON.stringify({ exp })).toString('base64');
        mock.onPost(/exchange-authorization-code/).reply(200, {
            accessToken: `h.${payload}.s`,
            refreshToken: 'r',
            idToken: 'i',
        });

        // Mock the AC start endpoint
        mock.onPost(/air-conditioning\/VIN123\/start/).reply(200, { status: 'accepted' });

        const flow = [
            { id: 'n1', type: 'skoda-set', name: 'test set', command: 'startAC', wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];
        const credentials = { n1: { email: 'test@test.com', password: 'pass123' } };

        helper.load(skodaSetNode, flow, credentials, () => {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');

            n2.on('input', (msg) => {
                try {
                    expect(msg.payload.status).toBe('accepted');
                    done();
                } catch (err) {
                    done(err);
                }
            });

            n1.receive({ payload: true, vin: 'VIN123' });
        });
    });

    it('should reject temperature command with non-number payload', (done) => {
        // Setup login mocks
        mock.onGet(/identity\.vwgroup\.io/).reply(200, `
            <html><body><script>
                window._IDK = { csrf_token: 'csrf1', templateModel: {"hmac":"aabbccddee00112233445566778899aabbccddee","relayState":"11223344556677889900aabbccddeeff11223344"} }
            </script></body></html>
        `);
        mock.onPost(/login\/identifier/).reply(200, `
            <html><body><script>
                window._IDK = { csrf_token: 'csrf2', templateModel: {"hmac":"aabbccddee00112233445566778899aabbccddee","relayState":"11223344556677889900aabbccddeeff11223344"} }
            </script></body></html>
        `);
        mock.onPost(/login\/authenticate/).reply(302, '', {
            location: 'myskoda://redirect/login/?code=code123&state=s'
        });
        const exp = Math.floor(Date.now() / 1000) + 3600;
        const payload = Buffer.from(JSON.stringify({ exp })).toString('base64');
        mock.onPost(/exchange-authorization-code/).reply(200, {
            accessToken: `h.${payload}.s`,
            refreshToken: 'r',
            idToken: 'i',
        });

        const flow = [
            { id: 'n1', type: 'skoda-set', name: 'test set', command: 'temperature', wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];
        const credentials = { n1: { email: 'test@test.com', password: 'pass123' } };

        helper.load(skodaSetNode, flow, credentials, () => {
            const n1 = helper.getNode('n1');

            n1.on('call:error', (call) => {
                try {
                    expect(call.firstArg.message).toContain('must be a number');
                    done();
                } catch (err) {
                    done(err);
                }
            });

            n1.receive({ payload: 'not-a-number', vin: 'VIN123' });
        });
    });

    it('should reject lock command without spin', (done) => {
        mock.onGet(/identity\.vwgroup\.io/).reply(200, `
            <html><body><script>
                window._IDK = { csrf_token: 'csrf1', templateModel: {"hmac":"aabbccddee00112233445566778899aabbccddee","relayState":"11223344556677889900aabbccddeeff11223344"} }
            </script></body></html>
        `);
        mock.onPost(/login\/identifier/).reply(200, `
            <html><body><script>
                window._IDK = { csrf_token: 'csrf2', templateModel: {"hmac":"aabbccddee00112233445566778899aabbccddee","relayState":"11223344556677889900aabbccddeeff11223344"} }
            </script></body></html>
        `);
        mock.onPost(/login\/authenticate/).reply(302, '', {
            location: 'myskoda://redirect/login/?code=code123&state=s'
        });
        const exp = Math.floor(Date.now() / 1000) + 3600;
        const payload = Buffer.from(JSON.stringify({ exp })).toString('base64');
        mock.onPost(/exchange-authorization-code/).reply(200, {
            accessToken: `h.${payload}.s`,
            refreshToken: 'r',
            idToken: 'i',
        });

        const flow = [
            { id: 'n1', type: 'skoda-set', name: 'test set', command: 'lock', wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];
        const credentials = { n1: { email: 'test@test.com', password: 'pass123' } };

        helper.load(skodaSetNode, flow, credentials, () => {
            const n1 = helper.getNode('n1');

            n1.on('call:error', (call) => {
                try {
                    expect(call.firstArg.message).toContain('msg.spin is required');
                    done();
                } catch (err) {
                    done(err);
                }
            });

            n1.receive({ payload: true, vin: 'VIN123' });
        });
    });
});
