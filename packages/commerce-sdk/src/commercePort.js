/** Port implemented by Commerce repositories. */
class CommercePort {
  async getCart() { throw new Error("Not implemented"); }
  async saveCart() { throw new Error("Not implemented"); }
  async createOrder() { throw new Error("Not implemented"); }
  async saveOrder() { throw new Error("Not implemented"); }
  async getOrder() { throw new Error("Not implemented"); }
  async listOrders() { throw new Error("Not implemented"); }
}
module.exports = { CommercePort };
