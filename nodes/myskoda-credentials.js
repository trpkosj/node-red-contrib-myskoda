module.exports = function (RED) {
    function MySkodaCredentialsNode(config) {
        RED.nodes.createNode(this, config);
    }

    RED.nodes.registerType("myskoda-credentials", MySkodaCredentialsNode, {
        credentials: {
            email: { type: "text" },
            password: { type: "password" }
        }
    });
}
