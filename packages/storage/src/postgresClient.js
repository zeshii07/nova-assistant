class PostgresClient {
  constructor({ connectionString, pool = null, logger = null } = {}) {
    this.connectionString = connectionString;
    this.pool = pool;
    this.logger = logger;
    this.ownsPool = !pool;
  }
  async connect() {
    if (this.pool) return this;
    if (!this.connectionString) throw new Error("DATABASE_URL is required when NOVA_STORAGE_MODE=persistent");
    let Pool;
    try { ({ Pool } = require("pg")); }
    catch { throw new Error("Persistent storage requires the 'pg' package. Run npm install."); }
    this.pool = new Pool({ connectionString: this.connectionString, max: Number(process.env.NOVA_DB_POOL_MAX || 10) });
    await this.pool.query("select 1 as ok");
    this.logger?.info("storage.postgres.connected");
    return this;
  }
  async query(text, params = []) { if (!this.pool) await this.connect(); return this.pool.query(text, params); }
  async transaction(fn) {
    if (!this.pool) await this.connect();
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const value = await fn(client); await client.query("COMMIT"); return value; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async close() { if (this.pool && this.ownsPool) await this.pool.end(); }
}
module.exports = { PostgresClient };
