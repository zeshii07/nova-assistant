# Nova v22.0 — Production Persistence Setup Guide

## Overview

This guide walks you through setting up PostgreSQL + Redis for Nova, both locally (Docker) and on free-tier cloud providers. Once configured, Nova survives restarts — all conversation state, customer profiles, bookings, and orders persist permanently.

---

## Option A: Local Development (Docker Compose) — 5 minutes

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) installed
- [Node.js](https://nodejs.org/) 20+ installed

### Steps

1. **Start PostgreSQL + Redis containers:**

```bash
cd nova-assistant
docker compose up -d
```

This starts:
- PostgreSQL 16 on port 5432 (user: `nova`, pass: `nova`, db: `nova`)
- Redis 7 on port 6379 (with AOF persistence enabled)

Both have named volumes (`postgres_data`, `redis_data`) so data survives container restarts.

2. **Verify containers are running:**

```bash
docker compose ps
# Both should show "healthy" status
```

3. **Create your .env file:**

```bash
cp .env.example .env
```

4. **Edit .env and set these values:**

```env
NOVA_STORAGE_MODE=persistent
DATABASE_URL=postgresql://nova:nova@localhost:5432/nova
REDIS_URL=redis://localhost:6379
```

5. **Run database migrations:**

```bash
npm run db:migrate
```

You should see:
```
Connecting to PostgreSQL...
  ✓ Connected

Applying 1 migration(s)...

  Applying 001_v7_core.sql...
  ✓ Applied 001_v7_core.sql

✓ All 1 migration(s) applied successfully.
```

6. **Start Nova:**

```bash
npm start
```

7. **Verify health check:**

```bash
curl http://localhost:3000/health
```

Should return:
```json
{
  "ok": true,
  "storage": {
    "mode": "persistent",
    "postgres": { "ok": true, "poolMax": 10 },
    "redis": { "ok": true, "ttlSeconds": 604800 }
  }
}
```

8. **Test persistence — send a message, then restart:**

```bash
# Send a booking
curl -X POST http://localhost:3000/api/dev/chat \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"cleaning-demo","customerId":"test-user","text":"book deep cleaning for my villa"}'

# Restart Nova (Ctrl+C, then npm start)

# Send a follow-up — Nova remembers the conversation
curl -X POST http://localhost:3000/api/dev/chat \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"cleaning-demo","customerId":"test-user","text":"3 bedrooms"}'
```

Nova should remember the previous turn because state is in Redis.

---

## Option B: Free-Tier Cloud PostgreSQL (Neon) — 10 minutes

[Neon](https://neon.tech) offers a generous free tier: 0.5 GB storage, always-available, with branching.

### Steps

1. **Sign up at [neon.tech](https://neon.tech)**

2. **Create a new project:**
   - Project name: `nova`
   - Database name: `nova`
   - Region: Choose closest to your users

3. **Copy the connection string:**
   - On the Neon dashboard, click "Connection Details"
   - Copy the "Connection string" — it looks like:
     ```
     postgresql://nova_user:abc123def456@ep-cool-name-123456.us-east-2.aws.neon.tech/nova?sslmode=require
     ```

4. **Set in your .env:**
   ```env
   NOVA_STORAGE_MODE=persistent
   DATABASE_URL=postgresql://nova_user:abc123def456@ep-cool-name-123456.us-east-2.aws.neon.tech/nova?sslmode=require
   ```

5. **Run migrations:**
   ```bash
   npm run db:migrate
   ```

---

## Option C: Free-Tier Cloud PostgreSQL (Render) — 10 minutes

[Render](https://render.com) offers a free PostgreSQL database (90 days, then it's deleted — use Neon for permanent free).

### Steps

1. **Sign up at [render.com](https://render.com)**

2. **Create a new PostgreSQL database:**
   - Dashboard → New → PostgreSQL
   - Name: `nova-db`
   - Database: `nova`
   - User: `nova`
   - Free tier: Yes

3. **Copy the internal connection string** (for apps on Render) or external (for local dev):
   ```
   postgresql://nova:abc123@dpg-xxx-xxx.render.com/nova
   ```

4. **Set in your .env:**
   ```env
   DATABASE_URL=postgresql://nova:abc123@dpg-xxx-xxx.render.com/nova
   ```

5. **Run migrations:**
   ```bash
   npm run db:migrate
   ```

---

## Option D: Free-Tier Cloud Redis (Upstash) — 5 minutes

[Upstash](https://upstash.com) offers a free Redis tier: 10,000 commands/day, 256MB, TLS enabled.

### Steps

1. **Sign up at [upstash.com](https://upstash.com)**

2. **Create a Redis database:**
   - Name: `nova-redis`
   - Region: Choose closest to your PostgreSQL
   - TLS: Enabled (required for `rediss://` URL)
   - Free tier: Yes

3. **Copy the connection string:**
   - Click "REST API" → then "Redis Connect"
   - Copy the URL — it looks like:
     ```
     rediss://default:abc123def456@xxx.upstash.io:6379
     ```

4. **Set in your .env:**
   ```env
   REDIS_URL=rediss://default:abc123def456@xxx.upstash.io:6379
   ```

5. **Verify the connection** (after setting NOVA_STORAGE_MODE=persistent):
   ```bash
   npm start
   curl http://localhost:3000/health
   # Should show redis: { ok: true }
   ```

---

## Option E: Free-Tier Cloud Redis (Render) — 5 minutes

Render also offers a free Redis instance.

### Steps

1. In Render dashboard → New → Redis
2. Name: `nova-redis`
3. Copy the connection URL:
   ```
   rediss://red-xxx:6379
   ```
4. Set in .env:
   ```env
   REDIS_URL=rediss://red-xxx:6379
   ```

---

## Complete Production .env Example

For a deployment using Neon (PostgreSQL) + Upstash (Redis):

```env
# Core
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
DEFAULT_TENANT_ID=cleaning-demo
NOVA_DEFAULT_TIMEZONE=Asia/Karachi

# Storage
NOVA_STORAGE_MODE=persistent
DATABASE_URL=postgresql://nova_user:abc123@ep-xxx.neon.tech/nova?sslmode=require
REDIS_URL=rediss://default:abc123@xxx.upstash.io:6379
NOVA_DB_POOL_MAX=10
NOVA_STATE_TTL_SECONDS=604800

# Tenants
TENANTS_DIR=./tenants
```

---

## Managing the Database

### Check migration status:
```bash
node scripts/migrate.js --status
```

### Re-run migrations (safe — uses IF NOT EXISTS):
```bash
npm run db:migrate
```

### Connect to the database via psql:
```bash
# Local Docker:
docker exec -it nova-postgres psql -U nova -d nova

# Neon/Render:
psql "postgresql://user:pass@host/db"
```

### View tables:
```sql
\dt
SELECT * FROM nova_schema_migrations;
SELECT count(*) FROM customers;
SELECT count(*) FROM service_requests;
SELECT count(*) FROM bookings;
SELECT count(*) FROM orders;
```

---

## What Persists After v22.0

| Data | Memory mode (before) | Persistent mode (v22.0) |
|------|---------------------|--------------------------|
| Conversation state | JSON file snapshot ✅ | Redis (with 7-day TTL) ✅ |
| Customer profiles (CRM) | JSON file snapshot ✅ | PostgreSQL `customers` table ✅ |
| Cleaning requests | JSON file snapshot ✅ | PostgreSQL `service_requests` table ✅ |
| Bookings | JSON file snapshot ✅ | PostgreSQL `bookings` table ✅ |
| Commerce orders | JSON file snapshot ✅ | PostgreSQL `orders` table ✅ |
| Active shopping carts | JSON file snapshot ✅ | PostgreSQL `carts` table ✅ |
| CRM activity log | JSON file snapshot ✅ | PostgreSQL `crm_activities` table ✅ |
| ML feedback examples | JSON files ✅ | JSON files (unchanged) ✅ |
| Replay logs | In-memory only ❌ | In-memory only ❌ |
| Inventory | JSON file ✅ | JSON file (unchanged) ⚠️ |
| Calendar | JSON files ✅ | JSON files (unchanged) ⚠️ |

**Note**: Inventory and Calendar remain file-based even in persistent mode. This is fine for single-instance deployments. For multi-instance, these would need to be moved to Postgres in a future sprint.

---

## Troubleshooting

### "DATABASE_URL is required"
You haven't set `DATABASE_URL` in your `.env` file, or `NOVA_STORAGE_MODE` is not set to `persistent`.

### "relation customers does not exist"
You haven't run migrations. Run:
```bash
npm run db:migrate
```

### "connect ECONNREFUSED 127.0.0.1:5432"
PostgreSQL isn't running. Start it:
```bash
docker compose up -d
```

### "connect ECONNREFUSED 127.0.0.1:6379"
Redis isn't running. Start it:
```bash
docker compose up -d
```

### Health check returns 503
One of the databases is down. Check:
```bash
curl http://localhost:3000/health | jq .storage
```
If `postgres.ok` or `redis.ok` is `false`, restart the containers:
```bash
docker compose restart
```

### Data disappears after Docker restart
Make sure you're using the `docker-compose.yml` (not `docker-compose.persistence.yml`) — it has named volumes that persist data.

### SSL error connecting to Neon
Make sure your `DATABASE_URL` includes `?sslmode=require` at the end.

### Redis SSL error connecting to Upstash
Make sure your `REDIS_URL` uses `rediss://` (two s's) not `redis://`.

---

## Docker Commands Reference

```bash
# Start services
docker compose up -d

# Stop services (data persists in volumes)
docker compose down

# Stop and DELETE all data
docker compose down -v

# View logs
docker compose logs postgres
docker compose logs redis

# Restart a specific service
docker compose restart postgres
docker compose restart redis

# Check status
docker compose ps
```
