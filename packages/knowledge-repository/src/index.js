/**
 * v58.0 — Knowledge Repository (Storage & Scalability)
 *
 * Phase 5 entry point. Provides durable, horizontally-scalable storage for
 * knowledge sources, chunks, and embeddings, plus cross-instance cache
 * invalidation.
 *
 * Spec reference: §10 Storage and scalability
 *
 * Components:
 *   - PostgresRepository  — durable source + chunk storage (Postgres)
 *   - VectorRepository    — pgvector-backed semantic search
 *   - RedisCache          — per-tenant LRU cache with pub/sub invalidation
 *   - TenantIsolation     — tenant-scope enforcement helpers
 *
 * Architecture rule (spec §10): "Do not rely only on process-local
 * clearCache() in a multi-instance deployment."
 *
 * Design: every component degrades gracefully when its backing service is
 * unavailable. PostgresRepository falls back to the existing FileKnowledgeRepository;
 * RedisCache falls back to an in-process Map. This keeps the system running in
 * single-node mode (the default) and unlocks horizontal scale when the operator
 * configures a real Postgres + Redis.
 */

const { PostgresRepository } = require('./postgresRepository');
const { VectorRepository } = require('./vectorRepository');
const { RedisCache } = require('./redisCache');
const { TenantIsolation } = require('./tenantIsolation');

module.exports = { PostgresRepository, VectorRepository, RedisCache, TenantIsolation };
