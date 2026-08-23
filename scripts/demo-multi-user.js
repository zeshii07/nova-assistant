const { buildContainer } = require("../apps/api/src/container");
async function run() {
  const c = await buildContainer();
  const scenarios = [
    { customerId: "demo-customer-1", messages: ["hello", "i want silver sunglasses", "4", "confirm order", "Ali", "03001234567", "Lahore", "Model Town Lahore", "skip", "cash on delivery"] },
    { customerId: "demo-customer-2", messages: ["assalam o alaikum", "i want 2 black wireless earbuds", "confirm order", "Sara", "03007654321", "Karachi", "Clifton Karachi", "skip", "cash on delivery"] },
    { customerId: "demo-customer-3", messages: ["ap k pass kia kia hai", "black running shoes size 42", "1", "confirm order", "Usman", "03111222333", "Islamabad", "F-10 Islamabad", "skip", "cash on delivery"] }
  ];
  for (const scenario of scenarios) {
    console.log(`\n===== ${scenario.customerId} =====`);
    for (const text of scenario.messages) {
      const result = await c.executionEngine.process({ tenantId: "default", customerId: scenario.customerId, channel: "http", text });
      console.log(`USER: ${text}\nNOVA [${result.capabilityId}]: ${result.reply}\n`);
    }
  }
  await c.registry.shutdownAll();
}
run().catch((error) => { console.error(error); process.exitCode = 1; });
