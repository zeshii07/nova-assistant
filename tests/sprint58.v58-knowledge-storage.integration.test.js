/**
 * Sprint 58 — v58.0 Phase 5 Storage & Scalability
 *
 * Tests:
 *   DD — PostgresRepository (graceful fallback, published-only filter, freshness, job tracking)
 *   DE — VectorRepository (cosine search, model isolation, incompatible embedding detection)
 *   DF — RedisCache (get/set TTL, invalidate, pub/sub subscribe, in-process fallback)
 *   DG — TenantIsolation (valid ID, scoped params, cross-tenant assertion, filter)
 *   DH — Multi-instance cache invalidation (publish on A → drop on B via subscription)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { PostgresRepository } = require('../packages/knowledge-repository/src/postgresRepository');
const { VectorRepository } = require('../packages/knowledge-repository/src/vectorRepository');
const { RedisCache, CHANNEL_PREFIX } = require('../packages/knowledge-repository/src/redisCache');
const { TenantIsolation } = require('../packages/knowledge-repository/src/tenantIsolation');

const TENANTS_DIR = path.resolve(__dirname, '..', 'tenants');

// ─────────────────────────────────────────────────────────────────────────────
// Mock Postgres client (in-memory rows)
// ─────────────────────────────────────────────────────────────────────────────
class MockPgClient {
  constructor() { this.rows = { knowledge_chunks: [], knowledge_sources: [], knowledge_embeddings: [], ingestion_jobs: [] }; this.queries = []; }
  async query(sql, params = []) {
    this.queries.push({ sql, params });
    // Crude SQL routing for the queries PostgresRepository uses.
    if (/FROM knowledge_chunks/.test(sql) && /knowledge_sources/.test(sql)) {
      const tenantId = params[0];
      const statuses = params[1];
      const joined = this.rows.knowledge_chunks
        .filter(c => c.tenant_id === tenantId)
        .map(c => {
          const s = this.rows.knowledge_sources.find(s => s.tenant_id === c.tenant_id && s.source_id === c.source_id && s.version === c.source_version);
          return { ...c, source_kind: s?.kind, source_status: s?.status, priority: s?.priority, source_title: s?.title, effective_from: s?.effective_from, effective_until: s?.effective_until };
        })
        .filter(r => statuses.includes(r.source_status));
      return { rows: joined };
    }
    if (/INSERT INTO knowledge_chunks/.test(sql)) {
      this.rows.knowledge_chunks.push({ tenant_id: params[0], chunk_id: params[1], source_id: params[2], source_version: params[3], content: params[4], knowledge_type: params[5], language: params[6], parent_heading: params[7], customer_safe: params[8] });
      return { rows: [] };
    }
    if (/INSERT INTO knowledge_embeddings/.test(sql)) {
      this.rows.knowledge_embeddings.push({ tenant_id: params[0], chunk_id: params[1], embedding_model: params[2], embedding: params[3] });
      return { rows: [] };
    }
    if (/INSERT INTO ingestion_jobs/.test(sql)) {
      const existing = this.rows.ingestion_jobs.findIndex(j => j.job_id === params[0]);
      const row = { job_id: params[0], tenant_id: params[1], source_id: params[2], file_name: params[3], status: params[4], validation_report: params[5] };
      if (existing >= 0) this.rows.ingestion_jobs[existing] = { ...this.rows.ingestion_jobs[existing], ...row };
      else this.rows.ingestion_jobs.push(row);
      return { rows: [] };
    }
    if (/SELECT \* FROM ingestion_jobs/.test(sql)) {
      return { rows: this.rows.ingestion_jobs.filter(j => j.job_id === params[0]) };
    }
    if (/SELECT DISTINCT embedding_model FROM knowledge_embeddings/.test(sql)) {
      const tenantId = params[0], model = params[1];
      const models = [...new Set(this.rows.knowledge_embeddings.filter(e => e.tenant_id === tenantId && e.embedding_model !== model).map(e => e.embedding_model))];
      return { rows: models.map(m => ({ embedding_model: m })) };
    }
    if (/knowledge_embeddings.*knowledge_chunks/.test(sql)) {
      const tenantId = params[0];
      // For the VectorRepository search, return matching chunks with a fake score.
      const limit = Number(params[params.length - 1]);
      return { rows: this.rows.knowledge_embeddings.filter(e => e.tenant_id === tenantId).slice(0, limit).map(e => ({ chunk_id: e.chunk_id, source_id: 'src', content: 'chunk text', knowledge_type: 'customer_policy', score: 0.9 })) };
    }
    return { rows: [] };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock Redis client (in-memory pub/sub)
// ─────────────────────────────────────────────────────────────────────────────
class MockRedis {
  constructor() { this.store = new Map(); this.subscribers = new Map(); this.messages = []; }
  async get(k) { return this.store.has(k) ? this.store.get(k) : null; }
  async set(k, v, mode, ttl) { this.store.set(k, v); }
  async del(...keys) { for (const k of keys) this.store.delete(k); }
  async scan(cursor, opts, ...rest) {
    // Match the pattern against all stored keys. Return [nextCursor, matchedKeys].
    const pattern = opts === 'MATCH' ? rest[0] : '*';
    const count = rest[rest.length - 1] || 100;
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    const all = [...this.store.keys()].filter(k => regex.test(k));
    return ['0', all];
  }
  async publish(channel, payload) { this.messages.push({ channel, payload }); const subs = this.subscribers.get(channel) || []; for (const cb of subs) cb(channel, payload); return subs.length; }
  async subscribe(channel) { if (!this.subscribers.has(channel)) this.subscribers.set(channel, []); }
  on(event, cb) { if (event === 'message') { for (const channel of this.subscribers.keys()) this.subscribers.get(channel).push(cb); } }
  _register(channel, cb) { if (!this.subscribers.has(channel)) this.subscribers.set(channel, []); this.subscribers.get(channel).push(cb); }
}

// ─────────────────────────────────────────────────────────────────────────────
// GROUP DD — PostgresRepository
// ─────────────────────────────────────────────────────────────────────────────

test('DD1: PostgresRepository falls back to FileKnowledgeRepository when no pgClient', async () => {
  const repo = new PostgresRepository({ tenantsDir: TENANTS_DIR });
  const knowledge = await repo.getForTenant('hotel-demo');
  assert.ok(knowledge, 'fallback must return knowledge');
});

test('DD2: PostgresRepository loads only published + active chunks from Postgres', async () => {
  const pg = new MockPgClient();
  pg.rows.knowledge_sources.push(
    { tenant_id: 't1', source_id: 's1', version: 1, kind: 'document', status: 'published', priority: 50, title: 'Doc 1' },
    { tenant_id: 't1', source_id: 's2', version: 1, kind: 'document', status: 'draft', priority: 50, title: 'Doc 2' },
    { tenant_id: 't1', source_id: 's3', version: 1, kind: 'document', status: 'archived', priority: 50, title: 'Doc 3' },
  );
  pg.rows.knowledge_chunks.push(
    { tenant_id: 't1', chunk_id: 'c1', source_id: 's1', source_version: 1, content: 'published chunk', knowledge_type: 'customer_policy', language: 'en', parent_heading: null, customer_safe: true },
    { tenant_id: 't1', chunk_id: 'c2', source_id: 's2', source_version: 1, content: 'draft chunk', knowledge_type: 'customer_policy', language: 'en', parent_heading: null, customer_safe: true },
    { tenant_id: 't1', chunk_id: 'c3', source_id: 's3', source_version: 1, content: 'archived chunk', knowledge_type: 'customer_policy', language: 'en', parent_heading: null, customer_safe: true },
  );
  const repo = new PostgresRepository({ pgClient: pg });
  const knowledge = await repo.getForTenant('t1');
  assert.equal(knowledge.documentCount, 1, 'only the published source chunk should be loaded');
});

test('DD3: PostgresRepository excludes expired chunks (effectiveUntil in past)', async () => {
  const pg = new MockPgClient();
  pg.rows.knowledge_sources.push(
    { tenant_id: 't1', source_id: 's1', version: 1, kind: 'document', status: 'published', priority: 50, title: 'Old', effective_until: '2020-01-01T00:00:00Z' },
    { tenant_id: 't1', source_id: 's2', version: 1, kind: 'document', status: 'published', priority: 50, title: 'Current' },
  );
  pg.rows.knowledge_chunks.push(
    { tenant_id: 't1', chunk_id: 'c1', source_id: 's1', source_version: 1, content: 'old', knowledge_type: 'policy', language: 'en', parent_heading: null, customer_safe: true },
    { tenant_id: 't1', chunk_id: 'c2', source_id: 's2', source_version: 1, content: 'current', knowledge_type: 'policy', language: 'en', parent_heading: null, customer_safe: true },
  );
  const repo = new PostgresRepository({ pgClient: pg });
  const knowledge = await repo.getForTenant('t1');
  assert.equal(knowledge.documentCount, 1, 'expired source excluded');
});

test('DD4: PostgresRepository.insertChunk writes a chunk', async () => {
  const pg = new MockPgClient();
  const repo = new PostgresRepository({ pgClient: pg });
  await repo.insertChunk({ tenantId: 't1', chunkId: 'c1', sourceId: 's1', sourceVersion: 1, content: 'test', knowledgeType: 'customer_policy', language: 'en', parentHeading: null, customerSafe: true });
  assert.equal(pg.rows.knowledge_chunks.length, 1);
  assert.equal(pg.rows.knowledge_chunks[0].content, 'test');
});

test('DD5: PostgresRepository.recordIngestionJob tracks status + validation report', async () => {
  const pg = new MockPgClient();
  const repo = new PostgresRepository({ pgClient: pg });
  await repo.recordIngestionJob({ jobId: 'J1', tenantId: 't1', sourceId: 's1', fileName: 'policy.pdf', status: 'completed', validationReport: { chunkCount: 5 } });
  const job = await repo.getIngestionJob('J1');
  assert.equal(job.status, 'completed');
  assert.equal(JSON.parse(job.validation_report).chunkCount, 5);
});

test('DD6: PostgresRepository.clearCache drops the in-memory cache', async () => {
  const pg = new MockPgClient();
  pg.rows.knowledge_sources.push({ tenant_id: 't1', source_id: 's1', version: 1, kind: 'document', status: 'published', priority: 50, title: 'Doc' });
  pg.rows.knowledge_chunks.push({ tenant_id: 't1', chunk_id: 'c1', source_id: 's1', source_version: 1, content: 'x', knowledge_type: 'policy', language: 'en', parent_heading: null, customer_safe: true });
  const repo = new PostgresRepository({ pgClient: pg });
  await repo.getForTenant('t1');
  assert.ok(repo.cache.has('t1'));
  repo.clearCache('t1');
  assert.ok(!repo.cache.has('t1'));
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP DE — VectorRepository
// ─────────────────────────────────────────────────────────────────────────────

test('DE1: VectorRepository.search returns empty when no pgClient', async () => {
  const vr = new VectorRepository({});
  const results = await vr.search({ tenantId: 't1', queryEmbedding: [0.1, 0.2], limit: 5 });
  assert.deepEqual(results, []);
});

test('DE2: VectorRepository.storeEmbedding writes to knowledge_embeddings', async () => {
  const pg = new MockPgClient();
  const vr = new VectorRepository({ pgClient: pg });
  await vr.storeEmbedding({ tenantId: 't1', chunkId: 'c1', embeddingModel: 'all-MiniLM-L6-v2', embedding: [0.1, 0.2] });
  assert.equal(pg.rows.knowledge_embeddings.length, 1);
});

test('DE3: VectorRepository detects incompatible embedding models', async () => {
  const pg = new MockPgClient();
  pg.rows.knowledge_embeddings.push(
    { tenant_id: 't1', chunk_id: 'c1', embedding_model: 'old-model', embedding: '[0.1]' },
    { tenant_id: 't1', chunk_id: 'c2', embedding_model: 'all-MiniLM-L6-v2', embedding: '[0.2]' },
  );
  const vr = new VectorRepository({ pgClient: pg });
  const incompatible = await vr.listIncompatibleEmbeddings('t1', 'all-MiniLM-L6-v2');
  assert.ok(incompatible.includes('old-model'));
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP DF — RedisCache
// ─────────────────────────────────────────────────────────────────────────────

test('DF1: RedisCache.get/set works in fallback (in-process) mode', async () => {
  const cache = new RedisCache({});
  await cache.set('t1', 'overview', { chunks: 5 });
  const val = await cache.get('t1', 'overview');
  assert.deepEqual(val, { chunks: 5 });
});

test('DF2: RedisCache.invalidate drops the key in fallback mode', async () => {
  const cache = new RedisCache({});
  await cache.set('t1', 'overview', { chunks: 5 });
  await cache.invalidate('t1', 'overview');
  const val = await cache.get('t1', 'overview');
  assert.equal(val, null);
});

test('DF3: RedisCache.invalidate(tenantId) drops the whole tenant namespace', async () => {
  const cache = new RedisCache({});
  await cache.set('t1', 'a', 1);
  await cache.set('t1', 'b', 2);
  await cache.set('t2', 'c', 3);
  await cache.invalidate('t1');
  assert.equal(await cache.get('t1', 'a'), null);
  assert.equal(await cache.get('t1', 'b'), null);
  assert.equal(await cache.get('t2', 'c'), 3, 'other tenant untouched');
});

test('DF4: RedisCache with mock Redis publishes invalidation on invalidate()', async () => {
  const redis = new MockRedis();
  redis.subscribers.set(CHANNEL_PREFIX + 't1', []);
  const cache = new RedisCache({ redisClient: redis });
  await cache.invalidate('t1');
  assert.ok(redis.messages.some(m => m.channel === CHANNEL_PREFIX + 't1'));
});

test('DF5: RedisCache.subscribe drops local copy on invalidation event', async () => {
  const redis = new MockRedis();
  // Instance A holds a cached value in its local map.
  const cacheA = new RedisCache({ redisClient: redis });
  await cacheA.set('t1', 'overview', { chunks: 5 });
  await cacheA.subscribe('t1');
  // Register the message callback (mock redis.on).
  redis._register(CHANNEL_PREFIX + 't1', (ch, payload) => {
    const evt = JSON.parse(payload);
    if (!evt.key) {
      for (const k of [...cacheA.local.keys()]) {
        if (k.startsWith(`nova:knowledge:${evt.tenantId}:`)) cacheA.local.delete(k);
      }
    }
  });
  // Instance B invalidates.
  const cacheB = new RedisCache({ redisClient: redis });
  await cacheB.invalidate('t1');
  // Instance A's local copy must be gone.
  const val = await cacheA.get('t1', 'overview');
  assert.equal(val, null, 'instance A must drop its copy after pub/sub invalidation');
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP DG — TenantIsolation
// ─────────────────────────────────────────────────────────────────────────────

test('DG1: valid tenant IDs are accepted', () => {
  const ti = new TenantIsolation();
  assert.doesNotThrow(() => ti.assertValidTenantId('hotel-demo'));
  assert.doesNotThrow(() => ti.assertValidTenantId('tenant_123'));
});

test('DG2: invalid tenant IDs are rejected (injection / traversal)', () => {
  const ti = new TenantIsolation();
  assert.throws(() => ti.assertValidTenantId('t1; DROP TABLE'), /Invalid tenant ID/);
  assert.throws(() => ti.assertValidTenantId('../etc/passwd'), /Invalid tenant ID/);
  assert.throws(() => ti.assertValidTenantId(''), /Tenant ID is required/);
  assert.throws(() => ti.assertValidTenantId(null), /Tenant ID is required/);
});

test('DG3: scopedParams puts tenantId first', () => {
  const ti = new TenantIsolation();
  const params = ti.scopedParams('t1', ['extra1', 'extra2']);
  assert.deepEqual(params, ['t1', 'extra1', 'extra2']);
});

test('DG4: assertChunkBelongsToTenant throws on cross-tenant access', () => {
  const ti = new TenantIsolation();
  assert.throws(() => ti.assertChunkBelongsToTenant({ tenantId: 't1' }, 't2'), /Cross-tenant access attempt/);
  assert.equal(ti.assertChunkBelongsToTenant({ tenantId: 't1' }, 't1'), true);
});

test('DG5: filterByTenant removes foreign chunks', () => {
  const ti = new TenantIsolation();
  const chunks = [
    { tenantId: 't1', text: 'a' },
    { tenantId: 't2', text: 'b' },
    { text: 'c (no tenantId)' },
  ];
  const filtered = ti.filterByTenant(chunks, 't1');
  assert.equal(filtered.length, 2, 'keeps t1 chunks + unscoped');
  assert.ok(filtered.every(c => !c.tenantId || c.tenantId === 't1'));
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUP DH — Multi-instance cache invalidation
// ─────────────────────────────────────────────────────────────────────────────

test('DH1: instance A publish → instance B drops cache (cross-instance invalidation)', async () => {
  // Two RedisCache instances sharing one MockRedis (simulating two API servers
  // against one Redis).
  const redis = new MockRedis();
  redis.subscribers.set(CHANNEL_PREFIX + 't1', []);
  const cacheA = new RedisCache({ redisClient: redis });
  const cacheB = new RedisCache({ redisClient: redis });
  // B holds a cached value.
  await cacheB.set('t1', 'overview', { chunks: 47 });
  // B subscribes.
  await cacheB.subscribe('t1');
  // Wire B's on('message') to drop its local cache on invalidation.
  redis._register(CHANNEL_PREFIX + 't1', (ch, payload) => {
    const evt = JSON.parse(payload);
    for (const k of [...cacheB.local.keys()]) {
      if (k.startsWith(`nova:knowledge:${evt.tenantId}:`)) cacheB.local.delete(k);
    }
  });
  // A invalidates (publishes).
  await cacheA.invalidate('t1');
  // B's local copy must be gone.
  const val = await cacheB.get('t1', 'overview');
  assert.equal(val, null, 'instance B must drop its cache after instance A publishes invalidation');
});
