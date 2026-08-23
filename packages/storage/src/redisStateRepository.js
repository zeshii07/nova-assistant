class RedisStateRepository {
  constructor({ url, client = null, prefix = "nova:conversation:", ttlSeconds = 86400 * 7, logger = null } = {}) {
    this.url = url; this.client = client; this.prefix = prefix; this.ttlSeconds = ttlSeconds; this.logger = logger; this.ownsClient = !client;
  }
  key(conversationId) { return `${this.prefix}${conversationId}`; }
  async connect() {
    if (this.client) return this;
    if (!this.url) throw new Error("REDIS_URL is required when NOVA_STORAGE_MODE=persistent");
    let createClient;
    try { ({ createClient } = require("redis")); }
    catch { throw new Error("Persistent conversation state requires the 'redis' package. Run npm install."); }
    this.client = createClient({ url: this.url });
    this.client.on?.("error", (error) => this.logger?.error("storage.redis.error", { error: error.message }));
    await this.client.connect(); this.logger?.info("storage.redis.connected"); return this;
  }
  async get(conversationId) { if (!this.client) await this.connect(); const raw = await this.client.get(this.key(conversationId)); return raw ? JSON.parse(raw) : null; }
  async save(state) { if (!state?.conversationId) throw new Error("state.conversationId is required"); if (!this.client) await this.connect(); await this.client.set(this.key(state.conversationId), JSON.stringify(state), { EX: this.ttlSeconds }); return structuredClone(state); }
  async delete(conversationId) { if (!this.client) await this.connect(); return (await this.client.del(this.key(conversationId))) > 0; }
  async clear() { if (!this.client) await this.connect(); let cursor = "0"; do { const result = await this.client.scan(cursor, { MATCH: `${this.prefix}*`, COUNT: 200 }); cursor = String(result.cursor); if (result.keys?.length) await this.client.del(result.keys); } while (cursor !== "0"); }
  async close() { if (this.client && this.ownsClient) await this.client.quit(); }
}
module.exports = { RedisStateRepository };
