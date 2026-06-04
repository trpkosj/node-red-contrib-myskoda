const helper = require('node-red-node-test-helper');
const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const myskodaGetNode = require('../nodes/myskoda-get.js');
const myskodaCredentialsNode = require('../nodes/myskoda-credentials.js');

helper.init(require.resolve('node-red'));

// ─── Test Helpers ────────────────────────────────────────────────────────────

const VIN = 'TMBJX000000000001';

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

function mockGarage(mock) {
    mock.onGet(/\/api\/v2\/garage$/).reply(200, {
        vehicles: [{ vin: VIN }]
    });
}

function mockVehicleInfo(mock) {
    mock.onGet(new RegExp(`/api/v2/garage/vehicles/${VIN}`)).reply(200, {
        vin: VIN,
        name: 'Enyaq iV 80',
        specification: {
            title: 'ENYAQ iV 80',
            model: 'Enyaq',
            modelYear: '2024',
            body: 'SUV',
            systemCode: 'EVO5E',
            trimLevel: 'Sportline',
            battery: { capacityInKWh: 77 },
            engine: { type: 'electric', powerInKW: 150 },
        },
        connectivityGenerations: ['MOD3'],
    });
}

function mockVehicleStatus(mock) {
    mock.onGet(new RegExp(`/api/v2/vehicle-status/${VIN}$`)).reply(200, {
        overall: {
            doors: 'CLOSED',
            windows: 'CLOSED',
            lights: 'OFF',
            locked: 'YES',
        },
        detail: {
            bonnet: 'CLOSED',
            trunk: 'CLOSED',
            doorFrontLeft: { open: 'NO', locked: 'YES' },
            doorFrontRight: { open: 'NO', locked: 'YES' },
            doorRearLeft: { open: 'NO', locked: 'YES' },
            doorRearRight: { open: 'NO', locked: 'YES' },
            windowFrontLeft: 'CLOSED',
            windowFrontRight: 'CLOSED',
            windowRearLeft: 'CLOSED',
            windowRearRight: 'CLOSED',
            sunroof: 'CLOSED',
        },
        odometer: { mileageInKm: 12345 },
    });
}

function mockDrivingRange(mock) {
    mock.onGet(new RegExp(`/api/v2/vehicle-status/${VIN}/driving-range`)).reply(200, {
        totalRangeInKm: 350,
        primaryEngineRange: {
            currentSOCInPercent: 80,
            remainingRangeInKm: 350,
            engineType: 'ELECTRIC',
        },
    });
}

function mockCharging(mock) {
    mock.onGet(new RegExp(`/api/v1/charging/${VIN}$`)).reply(200, {
        status: {
            chargingRateInKmPerHour: 35,
            chargePowerInKW: 11,
            chargeType: 'AC',
            state: 'CHARGING',
            remainingTimeToFullyChargedInMinutes: 120,
            targetSOCInPercent: 80,
            currentSOCInPercent: 55,
        },
        settings: {
            maxChargeCurrentAC: 'MAXIMUM',
            autoUnlockPlugWhenCharged: 'PERMANENT',
            targetSOCInPercent: 80,
        },
    });
}

function mockAirConditioning(mock) {
    mock.onGet(new RegExp(`/api/v2/air-conditioning/${VIN}$`)).reply(200, {
        state: 'OFF',
        chargerConnectionState: 'CONNECTED',
        chargerLockState: 'LOCKED',
        windowHeatingEnabled: false,
        targetTemperature: { temperatureValue: 21.5, unitInCar: 'CELSIUS' },
        steeringWheelPosition: 'LEFT',
        seatHeatingEnabled: { frontLeft: false, frontRight: false },
    });
}

function mockPositions(mock) {
    mock.onGet(new RegExp(`/api/v1/maps/positions\\?vin=${VIN}`)).reply(200, {
        positions: [{
            type: 'VEHICLE',
            gpsCoordinates: {
                latitude: 50.0755,
                longitude: 14.4378,
            },
            address: {
                city: 'Praha',
                country: 'CZ',
                street: 'Václavské náměstí',
            },
        }],
    });
}

function mockMaintenance(mock) {
    mock.onGet(new RegExp(`/api/v3/vehicle-maintenance/vehicles/${VIN}`)).reply(200, {
        maintenanceReport: {
            inspectionDueDateInDays: 365,
            inspectionDueInKm: 15000,
            oilServiceDueDateInDays: 365,
            oilServiceDueInKm: 15000,
        },
    });
}

const defaultCredentials = {
    cred1: { email: 'test@test.com', password: 'pass123' },
    n1: { email: 'test@test.com', password: 'pass123' },
};
const nodeTypes = [myskodaGetNode, myskodaCredentialsNode];
const credConfigNode = { id: 'cred1', type: 'myskoda-credentials', name: 'Test Account' };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('myskoda-get node', () => {
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

    it('should be loaded with default config', (done) => {
        const flow = [credConfigNode, { id: 'n1', type: 'myskoda-get', name: 'test get', account: 'cred1' }];
        helper.load(nodeTypes, flow, defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            expect(n1).toBeTruthy();
            expect(n1.name).toBe('test get');
            done();
        });
    });

    it('should be loaded with all query options enabled', (done) => {
        const flow = [credConfigNode, {
            id: 'n1', type: 'myskoda-get', name: 'full query', account: 'cred1',
            queryParking: true, queryClimater: true, queryCharger: true, queryMaintenance: true,
        }];
        helper.load(nodeTypes, flow, defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            expect(n1).toBeTruthy();
            expect(n1.name).toBe('full query');
            done();
        });
    });

    // ── Basic data retrieval ─────────────────────────────────────────────────

    it('should return basic vehicle data (info, status, drivingRange)', (done) => {
        mockLoginFlow(mock);
        mockGarage(mock);
        mockVehicleInfo(mock);
        mockVehicleStatus(mock);
        mockDrivingRange(mock);

        const flow = [
            credConfigNode,
            { id: 'n1', type: 'myskoda-get', name: 'test get', account: 'cred1',
              queryParking: false, queryClimater: false, queryCharger: false, queryMaintenance: false,
              wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];

        helper.load(nodeTypes, flow, defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');

            n2.on('input', (msg) => {
                try {
                    expect(msg.payload).toBeDefined();
                    expect(msg.payload.vehicles).toHaveLength(1);

                    const car = msg.payload.vehicles[0];
                    expect(car.vin).toBe(VIN);
                    expect(car.info.name).toBe('Enyaq iV 80');
                    expect(car.info.specification.model).toBe('Enyaq');
                    expect(car.status.overall.doors).toBe('CLOSED');
                    expect(car.status.overall.locked).toBe('YES');
                    expect(car.status.odometer.mileageInKm).toBe(12345);
                    expect(car.drivingRange.totalRangeInKm).toBe(350);
                    expect(car.drivingRange.primaryEngineRange.currentSOCInPercent).toBe(80);

                    // Optional data should NOT be present
                    expect(car.positions).toBeUndefined();
                    expect(car.airConditioning).toBeUndefined();
                    expect(car.charging).toBeUndefined();
                    expect(car.maintenance).toBeUndefined();

                    done();
                } catch (err) {
                    done(err);
                }
            });

            n1.receive({ payload: 'trigger' });
        });
    });

    // ── Charging query (matches user flow: queryCharger=true) ────────────────

    it('should return charging data when queryCharger is enabled', (done) => {
        mockLoginFlow(mock);
        mockGarage(mock);
        mockVehicleInfo(mock);
        mockVehicleStatus(mock);
        mockDrivingRange(mock);
        mockCharging(mock);

        const flow = [
            credConfigNode,
            { id: 'n1', type: 'myskoda-get', name: 'charger test', account: 'cred1',
              queryParking: false, queryClimater: false, queryCharger: true, queryMaintenance: false,
              wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];

        helper.load(nodeTypes, flow, defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');

            n2.on('input', (msg) => {
                try {
                    const car = msg.payload.vehicles[0];
                    expect(car.vin).toBe(VIN);
                    expect(car.charging).toBeDefined();
                    expect(car.charging.status.state).toBe('CHARGING');
                    expect(car.charging.status.currentSOCInPercent).toBe(55);
                    expect(car.charging.status.chargePowerInKW).toBe(11);
                    expect(car.charging.settings.targetSOCInPercent).toBe(80);

                    // Other optional data should NOT be present
                    expect(car.positions).toBeUndefined();
                    expect(car.airConditioning).toBeUndefined();
                    expect(car.maintenance).toBeUndefined();

                    done();
                } catch (err) {
                    done(err);
                }
            });

            n1.receive({ payload: 'trigger' });
        });
    });

    // ── Air conditioning query ───────────────────────────────────────────────

    it('should return air conditioning data when queryClimater is enabled', (done) => {
        mockLoginFlow(mock);
        mockGarage(mock);
        mockVehicleInfo(mock);
        mockVehicleStatus(mock);
        mockDrivingRange(mock);
        mockAirConditioning(mock);

        const flow = [
            credConfigNode,
            { id: 'n1', type: 'myskoda-get', name: 'ac test', account: 'cred1',
              queryParking: false, queryClimater: true, queryCharger: false, queryMaintenance: false,
              wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];

        helper.load(nodeTypes, flow, defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');

            n2.on('input', (msg) => {
                try {
                    const car = msg.payload.vehicles[0];
                    expect(car.airConditioning).toBeDefined();
                    expect(car.airConditioning.state).toBe('OFF');
                    expect(car.airConditioning.targetTemperature.temperatureValue).toBe(21.5);
                    done();
                } catch (err) {
                    done(err);
                }
            });

            n1.receive({ payload: 'trigger' });
        });
    });

    // ── Parking position query ───────────────────────────────────────────────

    it('should return parking position when queryParking is enabled', (done) => {
        mockLoginFlow(mock);
        mockGarage(mock);
        mockVehicleInfo(mock);
        mockVehicleStatus(mock);
        mockDrivingRange(mock);
        mockPositions(mock);

        const flow = [
            credConfigNode,
            { id: 'n1', type: 'myskoda-get', name: 'parking test', account: 'cred1',
              queryParking: true, queryClimater: false, queryCharger: false, queryMaintenance: false,
              wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];

        helper.load(nodeTypes, flow, defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');

            n2.on('input', (msg) => {
                try {
                    const car = msg.payload.vehicles[0];
                    expect(car.positions).toBeDefined();
                    expect(car.positions.positions[0].gpsCoordinates.latitude).toBe(50.0755);
                    expect(car.positions.positions[0].gpsCoordinates.longitude).toBe(14.4378);
                    expect(car.positions.positions[0].address.city).toBe('Praha');
                    done();
                } catch (err) {
                    done(err);
                }
            });

            n1.receive({ payload: 'trigger' });
        });
    });

    // ── Maintenance query ────────────────────────────────────────────────────

    it('should return maintenance data when queryMaintenance is enabled', (done) => {
        mockLoginFlow(mock);
        mockGarage(mock);
        mockVehicleInfo(mock);
        mockVehicleStatus(mock);
        mockDrivingRange(mock);
        mockMaintenance(mock);

        const flow = [
            credConfigNode,
            { id: 'n1', type: 'myskoda-get', name: 'maintenance test', account: 'cred1',
              queryParking: false, queryClimater: false, queryCharger: false, queryMaintenance: true,
              wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];

        helper.load(nodeTypes, flow, defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');

            n2.on('input', (msg) => {
                try {
                    const car = msg.payload.vehicles[0];
                    expect(car.maintenance).toBeDefined();
                    expect(car.maintenance.maintenanceReport.inspectionDueDateInDays).toBe(365);
                    expect(car.maintenance.maintenanceReport.inspectionDueInKm).toBe(15000);
                    done();
                } catch (err) {
                    done(err);
                }
            });

            n1.receive({ payload: 'trigger' });
        });
    });

    // ── All queries enabled ──────────────────────────────────────────────────

    it('should return all optional data when all queries are enabled', (done) => {
        mockLoginFlow(mock);
        mockGarage(mock);
        mockVehicleInfo(mock);
        mockVehicleStatus(mock);
        mockDrivingRange(mock);
        mockCharging(mock);
        mockAirConditioning(mock);
        mockPositions(mock);
        mockMaintenance(mock);

        const flow = [
            credConfigNode,
            { id: 'n1', type: 'myskoda-get', name: 'full test', account: 'cred1',
              queryParking: true, queryClimater: true, queryCharger: true, queryMaintenance: true,
              wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];

        helper.load(nodeTypes, flow, defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');

            n2.on('input', (msg) => {
                try {
                    const car = msg.payload.vehicles[0];
                    expect(car.vin).toBe(VIN);
                    expect(car.info).toBeDefined();
                    expect(car.status).toBeDefined();
                    expect(car.drivingRange).toBeDefined();
                    expect(car.positions).toBeDefined();
                    expect(car.airConditioning).toBeDefined();
                    expect(car.charging).toBeDefined();
                    expect(car.maintenance).toBeDefined();
                    done();
                } catch (err) {
                    done(err);
                }
            });

            n1.receive({ payload: 'trigger' });
        });
    });

    // ── Error handling ───────────────────────────────────────────────────────

    it('should set error status when login fails (500)', (done) => {
        mock.onGet(/identity\.vwgroup\.io/).reply(500);

        const flow = [
            credConfigNode,
            { id: 'n1', type: 'myskoda-get', name: 'test get', account: 'cred1', wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];

        helper.load(nodeTypes, flow, defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            setTimeout(() => { done(); }, 500);
            n1.receive({ payload: 'trigger' });
        });
    });

    it('should set error status when garage returns no vehicles', (done) => {
        mockLoginFlow(mock);
        mock.onGet(/\/api\/v2\/garage$/).reply(200, { vehicles: [] });

        const flow = [
            credConfigNode,
            { id: 'n1', type: 'myskoda-get', name: 'test get', account: 'cred1', wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];

        helper.load(nodeTypes, flow, defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            setTimeout(() => { done(); }, 500);
            n1.receive({ payload: 'trigger' });
        });
    });

    it('should handle vehicle info API failure gracefully', (done) => {
        mockLoginFlow(mock);
        mockGarage(mock);
        mock.onGet(new RegExp(`/api/v2/garage/vehicles/${VIN}`)).reply(500);
        mockVehicleStatus(mock);
        mockDrivingRange(mock);

        const flow = [
            credConfigNode,
            { id: 'n1', type: 'myskoda-get', name: 'test get', account: 'cred1',
              queryParking: false, queryClimater: false, queryCharger: false, queryMaintenance: false,
              wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];

        helper.load(nodeTypes, flow, defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');

            n2.on('input', (msg) => {
                try {
                    const car = msg.payload.vehicles[0];
                    expect(car.vin).toBe(VIN);
                    expect(car.info).toBeUndefined();
                    expect(car.status).toBeDefined();
                    expect(car.drivingRange).toBeDefined();
                    done();
                } catch (err) {
                    done(err);
                }
            });

            n1.receive({ payload: 'trigger' });
        });
    });

    it('should handle charging API failure gracefully when queryCharger is enabled', (done) => {
        mockLoginFlow(mock);
        mockGarage(mock);
        mockVehicleInfo(mock);
        mockVehicleStatus(mock);
        mockDrivingRange(mock);
        mock.onGet(new RegExp(`/api/v1/charging/${VIN}$`)).reply(500);

        const flow = [
            credConfigNode,
            { id: 'n1', type: 'myskoda-get', name: 'test get', account: 'cred1',
              queryParking: false, queryClimater: false, queryCharger: true, queryMaintenance: false,
              wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];

        helper.load(nodeTypes, flow, defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');

            n2.on('input', (msg) => {
                try {
                    const car = msg.payload.vehicles[0];
                    expect(car.vin).toBe(VIN);
                    expect(car.info).toBeDefined();
                    expect(car.charging).toBeUndefined();
                    done();
                } catch (err) {
                    done(err);
                }
            });

            n1.receive({ payload: 'trigger' });
        });
    });

    // ── Window/door status detail ────────────────────────────────────────────

    it('should return detailed door and window status', (done) => {
        mockLoginFlow(mock);
        mockGarage(mock);
        mockVehicleInfo(mock);
        mockVehicleStatus(mock);
        mockDrivingRange(mock);

        const flow = [
            credConfigNode,
            { id: 'n1', type: 'myskoda-get', name: 'detail test', account: 'cred1',
              queryParking: false, queryClimater: false, queryCharger: false, queryMaintenance: false,
              wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];

        helper.load(nodeTypes, flow, defaultCredentials, () => {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');

            n2.on('input', (msg) => {
                try {
                    const detail = msg.payload.vehicles[0].status.detail;
                    expect(detail.bonnet).toBe('CLOSED');
                    expect(detail.trunk).toBe('CLOSED');
                    expect(detail.doorFrontLeft.open).toBe('NO');
                    expect(detail.doorFrontLeft.locked).toBe('YES');
                    expect(detail.windowFrontLeft).toBe('CLOSED');
                    expect(detail.windowRearRight).toBe('CLOSED');
                    expect(detail.sunroof).toBe('CLOSED');
                    done();
                } catch (err) {
                    done(err);
                }
            });

            n1.receive({ payload: 'trigger' });
        });
    });
});
