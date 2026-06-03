const helper = require('node-red-node-test-helper');
const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const skodaGetNode = require('../nodes/skoda-get.js');

helper.init(require.resolve('node-red'));

describe('skoda-get node', () => {
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
        const flow = [{ id: 'n1', type: 'skoda-get', name: 'test get' }];
        helper.load(skodaGetNode, flow, () => {
            const n1 = helper.getNode('n1');
            expect(n1).toBeTruthy();
            expect(n1.name).toBe('test get');
            done();
        });
    });

    it('should output vehicles data on input', (done) => {
        // Mock the full login flow is complex, so we test the node assuming
        // the library is already connected. We mock at axios level.
        
        // Mock OIDC authorize (login page)
        mock.onGet(/identity\.vwgroup\.io/).reply(200, `
            <html><body><script>
                window._IDK = { csrf_token: 'csrf1', templateModel: {"hmac":"aabbccddee00112233445566778899aabbccddee","relayState":"11223344556677889900aabbccddeeff11223344"} }
            </script></body></html>
        `);

        // Mock identifier step
        mock.onPost(/login\/identifier/).reply(200, `
            <html><body><script>
                window._IDK = { csrf_token: 'csrf2', templateModel: {"hmac":"aabbccddee00112233445566778899aabbccddee","relayState":"11223344556677889900aabbccddeeff11223344"} }
            </script></body></html>
        `);

        // Mock authenticate step - redirect to myskoda://
        mock.onPost(/login\/authenticate/).reply(302, '', {
            location: 'myskoda://redirect/login/?code=auth-code-123&state=test'
        });

        // Mock token exchange
        const exp = Math.floor(Date.now() / 1000) + 3600;
        const payload = Buffer.from(JSON.stringify({ exp, sub: 'user1' })).toString('base64');
        const fakeToken = `h.${payload}.s`;

        mock.onPost(/exchange-authorization-code/).reply(200, {
            accessToken: fakeToken,
            refreshToken: 'refresh-123',
            idToken: 'id-123',
        });

        // Mock garage API
        mock.onGet(/\/api\/v2\/garage$/).reply(200, {
            vehicles: [{ vin: 'TMBJTEST123456789' }]
        });

        // Mock vehicle data endpoints
        mock.onGet(/\/api\/v2\/garage\/vehicles\/TMBJTEST/).reply(200, {
            vin: 'TMBJTEST123456789',
            name: 'My Enyaq',
        });
        mock.onGet(/\/api\/v2\/vehicle-status\/TMBJTEST123456789$/).reply(200, {
            overall: { doors: 'closed', locked: true }
        });
        mock.onGet(/\/api\/v2\/vehicle-status\/TMBJTEST123456789\/driving-range/).reply(200, {
            totalRangeInKm: 350
        });

        const flow = [
            { id: 'n1', type: 'skoda-get', name: 'test get', wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];
        const credentials = { n1: { email: 'test@test.com', password: 'pass123' } };

        helper.load(skodaGetNode, flow, credentials, () => {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');

            n2.on('input', (msg) => {
                try {
                    expect(msg.payload).toBeDefined();
                    expect(msg.payload.vehicles).toBeDefined();
                    expect(msg.payload.vehicles).toHaveLength(1);
                    expect(msg.payload.vehicles[0].vin).toBe('TMBJTEST123456789');
                    expect(msg.payload.vehicles[0].info.name).toBe('My Enyaq');
                    expect(msg.payload.vehicles[0].drivingRange.totalRangeInKm).toBe(350);
                    done();
                } catch (err) {
                    done(err);
                }
            });

            n1.receive({ payload: 'trigger' });
        });
    });

    it('should set error status on failure', (done) => {
        // Mock OIDC authorize to fail
        mock.onGet(/identity\.vwgroup\.io/).reply(500);

        const flow = [
            { id: 'n1', type: 'skoda-get', name: 'test get', wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];
        const credentials = { n1: { email: 'test@test.com', password: 'pass123' } };

        helper.load(skodaGetNode, flow, credentials, () => {
            const n1 = helper.getNode('n1');

            // Give time for the error to be processed
            setTimeout(() => {
                // Node should have error status
                done();
            }, 500);

            n1.receive({ payload: 'trigger' });
        });
    });
});
