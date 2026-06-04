const SkodaLibrary = require('../lib/skoda-library');

module.exports = function (RED) {
    function SkodaConnectNodeSet(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.on('input', async function (msg, send, done) {
            try {
                var credentialsNode = RED.nodes.getNode(config.account);
                var credentials = credentialsNode ? credentialsNode.credentials : this.credentials;

                if (!credentials || !credentials.email || !credentials.password) {
                    throw new Error("No credentials configured. Add a MySkoda Account config node.");
                }

                if (!node._flow.skodaLib) {
                    node._flow.skodaLib = new SkodaLibrary(node, config);
                }

                await node._flow.skodaLib.connect(credentials);

                if (!msg.vin || msg.vin === "") {
                    throw new Error("VIN is not defined. Pass msg.vin with the vehicle VIN.");
                }

                let result = null;

                switch (config.command) {
                    case "startAC":
                        result = await node._flow.skodaLib.startAirConditioning(msg.vin);
                        break;
                    case "stopAC":
                        result = await node._flow.skodaLib.stopAirConditioning(msg.vin);
                        break;
                    case "temperature":
                        if (typeof msg.payload !== "number") {
                            throw new Error("msg.payload must be a number (target temperature in Celsius).");
                        }
                        result = await node._flow.skodaLib.setTargetTemperature(msg.vin, msg.payload);
                        break;
                    case "startWindowHeating":
                        result = await node._flow.skodaLib.startWindowHeating(msg.vin);
                        break;
                    case "stopWindowHeating":
                        result = await node._flow.skodaLib.stopWindowHeating(msg.vin);
                        break;
                    case "startCharging":
                        result = await node._flow.skodaLib.startCharging(msg.vin);
                        break;
                    case "stopCharging":
                        result = await node._flow.skodaLib.stopCharging(msg.vin);
                        break;
                    case "setChargeLimit":
                        if (typeof msg.payload !== "number") {
                            throw new Error("msg.payload must be a number (charge limit in %).");
                        }
                        result = await node._flow.skodaLib.setChargeLimit(msg.vin, msg.payload);
                        break;
                    case "lock":
                        if (!msg.spin) {
                            throw new Error("msg.spin is required for locking.");
                        }
                        result = await node._flow.skodaLib.lock(msg.vin, msg.spin);
                        break;
                    case "unlock":
                        if (!msg.spin) {
                            throw new Error("msg.spin is required for unlocking.");
                        }
                        result = await node._flow.skodaLib.unlock(msg.vin, msg.spin);
                        break;
                    case "honkAndFlash":
                        if (!msg.latitude || !msg.longitude) {
                            throw new Error("msg.latitude and msg.longitude are required.");
                        }
                        result = await node._flow.skodaLib.honkAndFlash(msg.vin, msg.latitude, msg.longitude);
                        break;
                    case "flash":
                        if (!msg.latitude || !msg.longitude) {
                            throw new Error("msg.latitude and msg.longitude are required.");
                        }
                        result = await node._flow.skodaLib.flash(msg.vin, msg.latitude, msg.longitude);
                        break;
                    case "wakeup":
                        result = await node._flow.skodaLib.wakeup(msg.vin);
                        break;
                    default:
                        throw new Error(`Unknown command: ${config.command}`);
                }

                node.status({});
                msg.payload = result || { success: true };
                node.send(msg);

                if (done) done();
            } catch (error) {
                node.status({ fill: "red", shape: "dot", text: "error" });
                if (done) {
                    done(error);
                } else {
                    node.error(error, msg);
                }
            }
        });
    }

    RED.nodes.registerType("myskoda-set", SkodaConnectNodeSet, {
        credentials: {
            email: { type: "text" },
            password: { type: "password" }
        }
    });
}


