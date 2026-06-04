const SkodaLibrary = require('../lib/skoda-library');

module.exports = function (RED) {
    function SkodaConnectNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        node.status({ fill: "grey", shape: "dot", text: "not logged in" });

        node.on('input', async function (msg, send, done) {
            try {
                var credentialsNode = RED.nodes.getNode(config.credentials);
                var credentials = credentialsNode ? credentialsNode.credentials : this.credentials;

                if (!credentials || !credentials.email || !credentials.password) {
                    throw new Error("No credentials configured. Add a MySkoda Account config node.");
                }

                if (!node._flow.skodaLib) {
                    node._flow.skodaLib = new SkodaLibrary(node, config);
                }

                await node._flow.skodaLib.connect(credentials);

                node.status({ fill: "green", shape: "dot", text: "requesting data ..." });

                const vins = await node._flow.skodaLib.getVehicles();
                const carsData = await node._flow.skodaLib.getAllCarsData(vins, config);

                node.status({});
                msg.payload = { vehicles: carsData };
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

    RED.nodes.registerType("myskoda-get", SkodaConnectNode, {
        credentials: {
            email: { type: "text" },
            password: { type: "password" }
        }
    });
}


