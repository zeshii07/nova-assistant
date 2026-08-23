const { buildContainer } = require("../apps/api/src/container");
async function run() {
  const c = await buildContainer();
  const messages = ["hello", "what cleaning services do you offer", "i need deep cleaning", "15 August", "11 am", "Johar Town Lahore", "confirm"];
  for (const text of messages) {
    const result = await c.executionEngine.process({ tenantId: "cleaning-demo", customerId: "cleaning-customer-1", channel: "http", text });
    console.log(`USER: ${text}\nNOVA [${result.capabilityId}]: ${result.reply}\n`);
  }
  await c.registry.shutdownAll();
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
