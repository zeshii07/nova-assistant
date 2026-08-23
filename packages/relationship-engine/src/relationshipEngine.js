/** Classifies relationship using only data the current context may access. */
class RelationshipEngine {
  async resolve({ context }) {
    const customer = context.customer || {};
    const tags = new Set(customer.tags || []);
    if (tags.has("vip")) return "vip";
    let activities = [];
    try {
      // Activity history is optional. Capabilities without crm.activity.read must
      // still receive a safe relationship level instead of failing rendering.
      activities = await context.services.crm?.listActivities?.({ limit: 100 }) || [];
    } catch (error) {
      if (error?.code !== "CRM_PERMISSION_DENIED") throw error;
    }
    if (customer.status === "customer" && activities.length >= 10) return "returning_customer";
    if (customer.status === "customer") return "customer";
    if (customer.name || customer.email || customer.phone) return "lead";
    return "visitor";
  }
}
module.exports = { RelationshipEngine };
