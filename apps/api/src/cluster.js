/**
 * v36.0 — Cluster entry point. Spawns one worker per CPU core (max 4).
 * The master process monitors workers and restarts them on crash.
 *
 * Benefits:
 *  - Multi-core utilization (2x throughput on 2-core machines)
 *  - Fault tolerance (worker crash doesn't kill the server)
 *  - Zero-downtime restarts (workers can be restarted one at a time)
 *
 * Set NOVA_WORKERS env var to override the worker count.
 * Set NOVA_SINGLE_WORKER=true to force single-process mode (for debugging).
 *
 * C2 fix: the master now refuses to start in production with
 * NOVA_STORAGE_MODE=memory and more than one worker — that configuration loses
 * conversation state across workers (each worker has its own in-memory map and
 * overwrites state.json on disk, last writer wins). Pin NOVA_WORKERS=1 or
 * switch to NOVA_STORAGE_MODE=persistent (Redis + Postgres). A heartbeat
 * watchdog also restarts workers that freeze (miss N consecutive heartbeats),
 * which contains a C1-style deadlock even if one slips past the state-layer fix.
 */
const cluster = require('cluster');
const {
  resolveClusterConfig,
  startWatchdog,
  startHeartbeat,
} = require('./clusterManager');

const config = resolveClusterConfig();

if (!config.decision.ok) {
  // Refuse to start in a known-broken configuration rather than silently
  // corrupting conversation state in production.
  console.error(`[Nova Cluster] BOOT REFUSED: ${config.decision.error}`);
  process.exit(1);
}
if (config.decision.warn) {
  console.warn(`[Nova Cluster] ${config.decision.warn}`);
}

if (cluster.isPrimary && config.workerCount > 1) {
  console.log(`[Nova Cluster] Master ${process.pid} starting ${config.workerCount} workers (storage=${config.storageMode})...`);

  for (let i = 0; i < config.workerCount; i++) {
    cluster.fork();
  }

  cluster.on('online', (worker) => {
    console.log(`[Nova Cluster] Worker ${worker.process.pid} online`);
  });

  cluster.on('exit', (worker, code, signal) => {
    console.error(`[Nova Cluster] Worker ${worker.process.pid} died (code=${code}, signal=${signal}). Restarting...`);
    // Restart after a short delay to avoid crash loops
    setTimeout(() => cluster.fork(), 1000);
  });

  // C2 fix: heartbeat watchdog — restart frozen workers (also contains C1).
  startWatchdog({
    heartbeatIntervalMs: config.heartbeatIntervalMs,
    maxMissedBeats: config.maxMissedBeats,
  });

  // Graceful shutdown — forward signals to workers
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Nova Cluster] ${signal} received, shutting down workers...`);
    for (const id in cluster.workers) {
      cluster.workers[id].process.kill(signal);
    }
    // Force exit after 10s if workers haven't exited
    setTimeout(() => process.exit(0), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

} else {
  // Worker process (or single-process mode) — start the actual server.
  // Start the heartbeat so the master can detect a frozen worker.
  let heartbeatHandle = null;
  try {
    heartbeatHandle = startHeartbeat({ intervalMs: config.heartbeatIntervalMs });
  } catch (err) {
    console.warn('[Nova Cluster] Could not start worker heartbeat:', err.message);
  }
  const { startServer } = require('./server');
  startServer().catch((err) => {
    console.error('[Nova] Failed to start server:', err);
    process.exit(1);
  }).finally(() => {
    // Keep the heartbeat running for the lifetime of the worker; stop it on exit.
    process.on('exit', () => heartbeatHandle?.stop());
  });
}
