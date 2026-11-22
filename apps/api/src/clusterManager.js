/**
 * C2 fix — cluster boot guard + worker watchdog.
 *
 * Problem (bug report C2): under `npm start` → `cluster.js`, Nova forks up to
 * 4 workers, each with its own in-process `MemoryStateRepository` pointed at
 * the same `state.json`. Workers do NOT share state, and each `persist()`
 * writes the WHOLE file from its own Map — so worker B overwrites worker A's
 * conversations (last writer wins). A user's next message can land on a worker
 * that has never seen them.
 *
 * Fix shape (matches the report's Phase 0):
 *   1. Resolve the desired worker count from env (NOVA_WORKERS /
 *      NOVA_SINGLE_WORKER), capped at MAX_WORKERS.
 *   2. Boot guard: in production with `memory` storage mode and >1 worker,
 *      REFUSE to start — the configuration is known-broken. Operators either
 *      pin NOVA_WORKERS=1 or switch to NOVA_STORAGE_MODE=persistent (Redis +
 *      Postgres). In non-production we only warn (dev convenience).
 *   3. Heartbeat watchdog: workers send an IPC heartbeat every
 *      heartbeatIntervalMs; if a worker misses `maxMissedBeats` consecutive
 *      beats the master kills and restarts it. This also contains a C1-style
 *      freeze (a frozen worker stops heartbeating and is restarted) — defense
 *      in depth on top of the C1 lock fix.
 *
 * The resolution + guard logic is extracted here so it can be unit-tested
 * without forking real processes. The watchdog uses the cluster module's IPC
 * channel and is exercised in a regression test that spawns a real cluster.
 */
const cluster = require('cluster');
const os = require('os');

const MAX_WORKERS = 4;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;
const DEFAULT_MAX_MISSED_BEATS = 3;

/**
 * Resolve the desired worker count from environment, honoring the explicit
 * NOVA_SINGLE_WORKER / NOVA_WORKERS knobs. Never throws for a missing
 * NOVA_WORKERS (treats blank as "use cpu count").
 */
function resolveWorkerCount(env = process.env, cpuCount = os.cpus().length) {
  if (String(env.NOVA_SINGLE_WORKER || '').toLowerCase() === 'true') return 1;
  const raw = Number(env.NOVA_WORKERS);
  const requested = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : (cpuCount || 1);
  return Math.min(requested, MAX_WORKERS);
}

/**
 * Boot guard. Returns a decision describing whether the cluster may start.
 * In production (`NODE_ENV=production`) with `memory` storage and more than
 * one worker, the configuration is known to lose conversation state across
 * workers and overwrite on disk — refuse to start with an actionable message.
 *
 * Returns { ok: boolean, workerCount, storageMode, isProduction, error?: string, warn?: string }.
 */
function assertBootable({ env = process.env, workerCount, storageMode }) {
  const isProduction = String(env.NODE_ENV || '').toLowerCase() === 'production';
  const result = { ok: true, workerCount, storageMode, isProduction };
  if (isProduction && storageMode === 'memory' && workerCount > 1) {
    result.ok = false;
    result.error = (
      'Nova refuses to start: NODE_ENV=production with NOVA_STORAGE_MODE=memory '
      + `and ${workerCount} workers would lose conversation state (each worker `
      + 'has its own in-memory state and overwrites state.json on disk — last '
      + 'writer wins). Set NOVA_WORKERS=1, or configure NOVA_STORAGE_MODE=persistent '
      + 'with DATABASE_URL and REDIS_URL.'
    );
    return result;
  }
  if (storageMode === 'memory' && workerCount > 1) {
    result.warn = (
      'Warning: NOVA_STORAGE_MODE=memory with multiple workers does not share '
      + 'conversation state — each worker has its own in-memory map and will '
      + 'overwrite state.json on disk. Pin NOVA_WORKERS=1 or use persistent '
      + 'storage in production.'
    );
  }
  return result;
}

/**
 * Resolve the full cluster launch config from environment. Pure function —
 * safe to call from tests and from the master before any fork.
 */
function resolveClusterConfig(env = process.env, cpuCount = os.cpus().length) {
  const workerCount = resolveWorkerCount(env, cpuCount);
  const storageMode = String(env.NOVA_STORAGE_MODE || 'memory').toLowerCase();
  const decision = assertBootable({ env, workerCount, storageMode });
  const heartbeatIntervalMs = boundedInt(env.NOVA_WORKER_HEARTBEAT_MS, DEFAULT_HEARTBEAT_INTERVAL_MS, 1000, 60000);
  const maxMissedBeats = boundedInt(env.NOVA_WORKER_MAX_MISSED_BEATS, DEFAULT_MAX_MISSED_BEATS, 2, 10);
  return { workerCount, storageMode, decision, heartbeatIntervalMs, maxMissedBeats };
}

function boundedInt(raw, fallback, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return Math.floor(n);
}

/**
 * Master-side heartbeat watchdog. Call once after forking workers.
 *
 * Workers must call reportHeartbeat() (in the worker process) on an interval
 * shorter than heartbeatIntervalMs * maxMissedBeats. The master tracks the
 * last heartbeat per worker; if a worker misses `maxMissedBeats` consecutive
 * intervals, it is killed (SIGTERM) — cluster's 'exit' handler restarts it.
 *
 * This catches both a crashed worker AND a frozen worker (one that is still
 * alive but, e.g., stuck in the C1 lock-spin and no longer heartbeating) —
 * the report's section 6.6 requirement that the health check exercise the
 * event loop is satisfied because a frozen worker cannot send heartbeats.
 *
 * Returns a { stop } handle.
 */
function startWatchdog({ heartbeatIntervalMs, maxMissedBeats, logger = console, onKill } = {}) {
  const lastBeat = new Map();
  const missed = new Map();

  cluster.on('online', (worker) => {
    lastBeat.set(worker.id, Date.now());
    missed.set(worker.id, 0);
    logger.log(`[Nova Cluster] Worker ${worker.process.pid} online — heartbeat monitored`);
  });

  cluster.on('message', (worker, msg) => {
    if (msg && msg.type === 'nova:heartbeat') {
      lastBeat.set(worker.id, Date.now());
      missed.set(worker.id, 0);
    }
  });

  cluster.on('exit', (worker) => {
    lastBeat.delete(worker.id);
    missed.delete(worker.id);
  });

  const timer = setInterval(() => {
    const now = Date.now();
    for (const id in cluster.workers) {
      const worker = cluster.workers[id];
      if (!worker) continue;
      const last = lastBeat.get(worker.id) || worker.process?.startTime || now;
      const elapsed = now - last;
      if (elapsed > heartbeatIntervalMs) {
        const count = (missed.get(worker.id) || 0) + 1;
        missed.set(worker.id, count);
        logger.warn(`[Nova Cluster] Worker ${worker.process.pid} missed heartbeat ${count}/${maxMissedBeats} (${elapsed}ms)`);
        if (count >= maxMissedBeats) {
          logger.error(`[Nova Cluster] Worker ${worker.process.pid} frozen (missed ${count} heartbeats) — killing and restarting`);
          try { if (typeof onKill === 'function') onKill(worker); } catch (_) {}
          try {
            // SIGTERM first; cluster 'exit' handler will fork a replacement.
            worker.process.kill('SIGTERM');
            // Hard kill after a grace period if it hasn't exited.
            setTimeout(() => {
              try { if (!worker.isDead()) worker.process.kill('SIGKILL'); } catch (_) {}
            }, 2000).unref();
          } catch (_) {}
          missed.set(worker.id, 0);
          lastBeat.set(worker.id, Date.now());
        }
      }
    }
  }, heartbeatIntervalMs);
  timer.unref();

  return { stop() { clearInterval(timer); } };
}

/**
 * Worker-side: send a heartbeat to the master every `intervalMs`. Workers
 * should call this once they are online and serving. Returns a { stop } handle.
 */
function startHeartbeat({ intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS } = {}) {
  const timer = setInterval(() => {
    if (process.send) {
      try { process.send({ type: 'nova:heartbeat', at: Date.now(), pid: process.pid }); } catch (_) {}
    }
  }, intervalMs);
  timer.unref();
  // Send one immediately so the master sees us before the first tick.
  if (process.send) {
    try { process.send({ type: 'nova:heartbeat', at: Date.now(), pid: process.pid }); } catch (_) {}
  }
  return { stop() { clearInterval(timer); } };
}

module.exports = {
  MAX_WORKERS,
  resolveWorkerCount,
  assertBootable,
  resolveClusterConfig,
  startWatchdog,
  startHeartbeat,
};
