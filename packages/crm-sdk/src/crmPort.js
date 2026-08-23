/**
 * Repository contract for official CRM records.
 * Infrastructure adapters may store these records in memory, PostgreSQL, or
 * another durable system without changing CRM services or capabilities.
 */
class CrmPort {
  async getCustomer() { throw new Error("Not implemented."); }
  async upsertCustomer() { throw new Error("Not implemented."); }
  async deleteCustomer() { throw new Error("Not implemented."); }
  async addNote() { throw new Error("Not implemented."); }
  async addTag() { throw new Error("Not implemented."); }
  async removeTag() { throw new Error("Not implemented."); }
  async recordActivity() { throw new Error("Not implemented."); }
  async listActivities() { throw new Error("Not implemented."); }
  async searchCustomers() { throw new Error("Not implemented."); }
}
module.exports = { CrmPort };
