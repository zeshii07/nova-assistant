# Production Persistence — Redis + PostgreSQL (v73.0)

This runbook tells you exactly what to do to run Nova in production so that
**data survives server restarts and deploys**, and so a second instance can be
added later without split-brain state. It assumes you currently run Nova in
the default `memory` mode (in-process Maps + JSON snapshot files).

> **Short version:** set `NOVA_STORAGE_MODE=persistent` + `DATABASE_URL` +
> `REDIS_URL` + the two secret env vars, run `npm run db:migrate`, restart.
> Details + caveats below.

---

## 1. What changed in v73.0

Three stores that used to be **pure in-memory** (lost on every restart, unsafe
across instances) now use **Redis** when `NOVA_STORAGE_MODE=persistent` is set,
and fall back to the original in-memory implementation otherwise (so dev, tests,
and single-instance deploys keep working unchanged).

| Store | Before v73.0 (memory mode) | After v73.0 (persistent mode) | What it prevents |
|---|---|---|---|
| **OAuth state nonces** (Google/Microsoft calendar consent) | `InMemoryNonceStore` — process-local Map | `RedisNonceStore` — Redis `SET NX EX` + `GETDEL` | An OAuth flow started on instance A can finish on instance B's callback. CSRF single-use survives restart. |
| **WhatsApp message dedup** | `ProcessedMessageStore` — process-local Map, 24h TTL | `RedisProcessedMessageStore` — Redis `SET NX EX` (atomic) | A retried WhatsApp webhook landing on a different instance (or after a restart) is no longer processed twice → no duplicate replies/orders/bookings. |
| **Login rate-limit counters** | `BusinessOwnerAuthService._failedAttempts` — process-local Map | `RedisRateLimiter` — Redis `INCR` + `EXPIRE` (atomic fixed-window) | Brute-force protection no longer resets on every deploy; 5 fails/minute is enforced across ALL instances, not per-instance. |

These three were the highest-priority gaps: they held **stateful data lost on
restart** with no on-disk backup. They join the stores that were already
Redis/Postgres-backed in persistent mode:

| Store | Backend (persistent mode) | Notes |
|---|---|---|
| Conversation state | Redis (`RedisStateRepository`) | Already wired in v35.3; 7-day TTL, WATCH/MULTI optimistic CAS. |
| CRM (customers + activities) | PostgreSQL | `PostgresCrmRepository` |
| Commerce (carts + orders) | PostgreSQL | `PostgresCommerceRepository` (idempotency-key guarded) |
| Bookings | PostgreSQL | `PostgresBookingRepository` |
| Cleaning service requests | PostgreSQL | `PostgresCleaningRepository` |
| Offering orders | PostgreSQL | `PostgresOfferingOrderRepository` |
| Distributed locks / optimistic versioning / idempotency | Redis | `DistributedLock`, `OptimisticVersioning`, `IdempotencyGuard` |

**Behavior on Redis failure (important):** the three new stores are designed
to **fail safe**, not fail closed:
- `RedisNonceStore.consume()` → returns `false` (rejects the OAuth flow). The
  user retries the consent. We never accept a nonce we couldn't verify.
- `RedisProcessedMessageStore.has()/add()` → returns `false`/fails open. The
  message is processed; the commerce/booking idempotency layer is the second
  line of defense against duplicate side effects.
- `RedisRateLimiter.hit()` → returns `{ limited: false }` (allows the login).
  bcrypt + your network-layer rate limit still apply. Locking every owner out
  during a Redis blip would be worse than a brief brute-force window.

If Redis goes down mid-flight, Nova keeps serving (degraded) rather than
returning 500s. The `/api/health?deep=1` readiness probe reports `degraded`
with a warning so you see it.

---

## 2. What you need to do (production setup)

### 2a. Provision Redis + PostgreSQL

- **PostgreSQL 13+** with the **`pgvector`** extension available (the knowledge
  schema uses `vector(384)` for semantic search). On managed Postgres (RDS,
  Render, Supabase) pgvector is usually available — run
  `CREATE EXTENSION IF NOT EXISTS vector;` once as a superuser, or let
  migration `003` do it (it has `CREATE EXTENSION IF NOT EXISTS vector`).
- **Redis 6+**. No special modules. A small instance (256 MB) is plenty for
  conversation state + nonces + dedup + rate limits — keys are short and TTL'd.

### 2b. Set environment variables

Copy `.env.persistence.example` to `.env` (or your platform's secret store)
and fill in real values:

```bash
NOVA_STORAGE_MODE=persistent
DATABASE_URL=postgresql://nova:REAL_PASSWORD@your-postgres-host:5432/nova
REDIS_URL=redis://:REAL_PASSWORD@your-redis-host:6379
NOVA_STATE_TTL_SECONDS=604800      # 7 days; conversation state TTL
NOVA_DB_POOL_MAX=10                # pg.Pool max connections

# REQUIRED secrets — generate each with: openssl rand -hex 32
NOVA_JWT_SECRET=<64 hex chars>
NOVA_OAUTH_STATE_SECRET=<different 64 hex chars>
```

**Why the secrets matter even in memory mode:**
- `NOVA_JWT_SECRET`: if unset, the default is a **random per-process key**. Every
  restart invalidates all business-owner sessions + pending password resets.
  In production this MUST be stable.
- `NOVA_OAUTH_STATE_SECRET`: if unset, a dev-only key is used. The OAuth state
  token HMAC protects against the calendar-consent CSRF where an attacker's
  auth code is saved to a victim tenant.

On managed Postgres, also set `PGSSLMODE=require` (passed through to `pg`).

### 2c. Run database migrations

```bash
npm run db:migrate
# or: node scripts/migrate.js
# check status: node scripts/migrate.js --status
```

This applies `database/migrations/001_v7_core.sql` → `002_v72_consistency.sql`
→ **`003_v73_knowledge_reconcile.sql`** (new in v73.0). Migration `003`
reconciles a table-name collision: `001` created a minimal `knowledge_sources`
stub that no code used; `003` drops it (if present) and creates the full
pgvector knowledge schema (`knowledge_sources`, `knowledge_chunks`,
`knowledge_embeddings`, `ingestion_jobs` + RLS). It's idempotent — safe to
re-run.

> **Pre-v73 databases:** if you previously ran `migrations/001_knowledge_schema.sql`
> manually (the file in `migrations/`, not `database/migrations/`), migration
> `003` is still safe — every statement is `IF NOT EXISTS`, and the
> `evidence_type` column guard ensures the v7 stub is only dropped if it's the
> wrong shape.

### 2d. Restart + verify

```bash
npm start
```

Then check readiness:

```bash
curl -s https://your-nova-host/api/health?deep=1 | jq .
```

You should see:

```json
{
  "status": "ok",
  "checks": {
    "tenantsDir": { "ok": true, "path": "..." },
    "billing": { "ok": true, "mode": "live" },
    "calendar": { "google": true, "microsoft": false },
    "storage": {
      "mode": "persistent",
      "redis": { "ok": true, "reply": "PONG" },
      "postgres": { "ok": true }
    },
    "process": { "uptime": 12, "memoryMb": 84, "loadAvg": [0.1, 0.1, 0.1] }
  },
  "warnings": [],
  "version": "73.0.0"
}
```

If `status` is `degraded`, read `warnings` — it will name which probe failed
(Redis / Postgres). The instance stays in rotation (200, not 503) so you can
debug; Nova's in-memory fallbacks keep it functional.

---

## 3. What's covered vs deferred

### ✅ Covered by v73.0 (survives restart + multi-instance safe)

- **Conversation state** (Redis) — already done in v35.3; verified wired.
- **OAuth nonces** (Redis) — calendar consent flows survive restart + work across instances.
- **WhatsApp message dedup** (Redis) — no duplicate processing after restart or across instances.
- **Login rate-limit counters** (Redis) — brute-force protection is durable + shared.
- **CRM, commerce, bookings, cleaning requests, offering orders** (Postgres) — already had Postgres repos; verified persistent mode selects them.
- **Distributed locks, optimistic versioning, idempotency** (Redis) — already wired; verified `redisClient` is passed through.
- **Knowledge schema** (Postgres + pgvector) — migration `003` now applies it via `npm run db:migrate` (was silently never applied before).
- **Health/readiness** — probes Redis + Postgres connectivity; fail-open warnings.

### ⏳ Deferred (works in single-instance prod; needs more work for horizontal scaling)

These still use **filesystem JSON** (atomic writes, in-process locks). They
survive restarts fine (the files persist), but are **not multi-instance safe**
because the in-process file lock doesn't coordinate across instances and the
in-memory read caches aren't invalidated across instances.

| Domain | Repository | Multi-instance risk |
|---|---|---|
| Tenant profiles | `FileTenantRepository` | Read cache stale on other instance after a profile edit (low risk — edits are rare). |
| Owner accounts | `BusinessOwnerAuthService` (owners.json) | Concurrent owner-add on two instances could lose one (low risk — rare op). |
| Subscriptions | `FileSubscriptionRepository` | `mutate()` counter increments race across instances (medium risk — message-quota counters). |
| Calendar state | `FileCalendarRepository` | Double-booking risk if two instances book the same slot simultaneously (medium risk). |
| Inventory | `FileInventoryRepository` | Oversell risk across instances (medium risk for high-volume catalog). |
| Knowledge (files) | `FileKnowledgeRepository` | Read cache stale after a knowledge edit on another instance. The `knowledge-repository` package has a `RedisCache` with pub/sub invalidation — wiring it is the next phase. |
| Notifications, feedback, leads, public leads, unanswered Qs | various `File*Repository` | Atomic writes, no cross-instance coordination. Acceptable at low volume. |
| Replay recordings | `InMemoryReplayRepository` + file-per-record | Works single-instance; multi-instance needs shared storage. |

**When this matters:** if you run a **single Nova instance** (the common case),
everything above is fine — files persist across restarts, and there's no second
instance to race with. The deferred items only become real risks when you
scale to **2+ instances** behind a load balancer. The v73.0 work is the
prerequisite: the truly-lost-on-restart state (nonces, dedup, rate limits,
conversation state) is now durable, so a restart no longer drops in-flight
customer interactions.

### 🔐 Special: calendar OAuth tokens

`FileCalendarTokenRepository` stores Google/Microsoft OAuth tokens as plaintext
JSON in `.nova-calendar-tokens/`. This is a **secret-at-rest** concern, not a
restart concern (the files persist). For production hardening, move these to an
encrypted vault (AWS Secrets Manager, GCP Secret Manager, or encrypt-at-rest
with a KMS key). This is tracked as a follow-up; it is not blocking for
restart-safety.

---

## 4. Rollback

If persistent mode causes problems, set `NOVA_STORAGE_MODE=memory` (or unset
it) and restart. Nova falls back to in-memory stores + file snapshots
immediately. **No data is lost** in the rollback direction:
- Conversation state in Redis simply isn't read (new conversations start fresh
  in memory); the Redis keys expire on their 7-day TTL.
- CRM/commerce/bookings in Postgres aren't read either (the in-memory repos
  start empty + snapshot to `.nova-data/*.json`). **Caveat:** any data written
  to Postgres while in persistent mode is not auto-migrated back to the
  in-memory snapshot files. If you rollback after collecting real customer
  data in Postgres, that data stays in Postgres until you switch back.

The safe rollback window is **before you have real customer traffic** in
persistent mode. After that, treat persistent mode as the source of truth.

---

## 5. Testing

The v73.0 changes are covered by:
- `tests/sprintP5-1.redis-persistence.regression.test.js` — 19 cases: the
  Redis-path logic for all 3 stores (via a `FakeRedisClient` that implements
  the exact command surface), the in-memory fallback path, fail-open/fail-closed
  behavior, the async auth service integration, and the HealthService probes.
- `tests/sprintP5-2.container-wiring.regression.test.js` — verifies
  `buildContainer()` selects the in-memory fallback stores in memory mode +
  that `loginWithPassword` is now async.
- The existing `sprintP4-*` suite (132 tests) — updated for the now-async
  `login`/`loginWithPassword`/`signup` methods; all pass.

Full sweep: **152/152** Phase-4 + Phase-5 tests pass; **273/273** sanity tests
pass — no regressions.

> **Note on live Redis/Postgres tests:** the sandbox has no Redis/Postgres
> binaries, so the Redis-path logic is tested against a `FakeRedisClient` that
> honors the same command semantics (NX/EX, GETDEL atomicity, INCR returns
> post-increment count). This validates every Redis command we issue. A
> live-integration test against real Redis/Postgres should be added to CI once
> a service is provisioned (the test would `skip` if `REDIS_URL`/`DATABASE_URL`
> is unset, so local dev still works).
