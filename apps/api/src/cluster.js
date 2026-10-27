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
 */
const cluster = require('cluster');
const os = require('os');

const MAX_WORKERS = 4;
const desiredWorkers = process.env.NOVA_SINGLE_WORKER === 'true'
  ? 1
  : Math.min(Number(process.env.NOVA_WORKERS) || os.cpus().length || 1, MAX_WORKERS);

if (cluster.isPrimary && desiredWorkers > 1) {
  console.log(`[Nova Cluster] Master ${process.pid} starting ${desiredWorkers} workers...`);

  for (let i = 0; i < desiredWorkers; i++) {
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
  // Worker process (or single-process mode) — start the actual server
  const { startServer } = require('./server');
  startServer().catch((err) => {
    console.error('[Nova] Failed to start server:', err);
    process.exit(1);
  });
}
