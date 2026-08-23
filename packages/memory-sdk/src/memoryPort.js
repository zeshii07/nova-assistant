/** Abstract persistence contract for platform memory. */
class MemoryPort {
  async upsert() { throw new Error("MemoryPort.upsert must be implemented."); }
  async get() { throw new Error("MemoryPort.get must be implemented."); }
  async query() { throw new Error("MemoryPort.query must be implemented."); }
  async delete() { throw new Error("MemoryPort.delete must be implemented."); }
  async purgeExpired() { throw new Error("MemoryPort.purgeExpired must be implemented."); }
}
module.exports = { MemoryPort };
