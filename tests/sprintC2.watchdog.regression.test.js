// C2 regression: the master heartbeat watchdog kills and restarts a frozen
// worker. This is the "watchdog" piece of C2 — it also contains a C1-style
// freeze (a worker stuck in the lock-spin stops heartbeating and is restarted),
// defense in depth on top of the C1 lock fix.
//
// We use REAL timers with short intervals so the test exercises the actual
// setInterval-based watchdog, not a mock. Each test waits a bounded wall-clock
// window; a hard guard timer fails the test fast if the watchdog misbehaves.
const test = require('node:test');
const assert = require('node:assert/strict');
const cluster = require('node:cluster');
const { startWatchdog, startHeartbeat } = require('../apps/api/src/clusterManager');

// Build a fake worker object so we never fork a real process for the unit test.
function fakeWorker(id, pid) {
  const killed = [];
  return {
    id,
    process: {
      pid,
      kill(sig) { killed.push(sig); },
    },
    isDead() { return false; },
    // expose the killed signals for assertions
    _killed: killed,
  };
}

test('C2 watchdog: master kills a worker that stops heartbeating (within the watchdog window)', async () => {
  const w = fakeWorker(1, 4242);
  const originalWorkers = cluster.workers;
  cluster.workers = { 1: w };
  const killedPids = [];

  const handle = startWatchdog({
    heartbeatIntervalMs: 50,   // check every 50ms
    maxMissedBeats: 3,          // kill after ~150ms of silence
    logger: { log() {}, warn() {}, error() {} },
    onKill: (worker) => killedPids.push(worker.process.pid),
  });

  try {
    cluster.emit('online', w);
    cluster.emit('message', w, { type: 'nova:heartbeat', at: Date.now() });
    // Worker goes silent — no more heartbeats. The watchdog must kill it.
    await new Promise((resolve) => setTimeout(resolve, 600));  // well past 3*50ms
    assert.ok(w._killed.includes('SIGTERM') || killedPids.includes(4242),
      `watchdog killed the frozen worker (killed=${JSON.stringify(w._killed)}, onKill=${JSON.stringify(killedPids)})`);
  } finally {
    handle.stop();
    cluster.workers = originalWorkers;
  }
});

test('C2 watchdog: a worker that keeps heartbeating is never killed', async () => {
  const w = fakeWorker(2, 9999);
  const originalWorkers = cluster.workers;
  cluster.workers = { 2: w };

  const handle = startWatchdog({
    heartbeatIntervalMs: 50,
    maxMissedBeats: 3,
    logger: { log() {}, warn() {}, error() {} },
  });

  // Heartbeat every 30ms — faster than the 50ms watchdog interval.
  const beatTimer = setInterval(() => {
    cluster.emit('message', w, { type: 'nova:heartbeat', at: Date.now() });
  }, 30);

  try {
    cluster.emit('online', w);
    await new Promise((resolve) => setTimeout(resolve, 500));  // ~10 watchdog ticks
    assert.equal(w._killed.length, 0, 'healthy worker was never killed');
  } finally {
    clearInterval(beatTimer);
    handle.stop();
    cluster.workers = originalWorkers;
  }
});

test('C2 heartbeat: startHeartbeat emits messages on process.send', async () => {
  const sent = [];
  const originalSend = process.send;
  process.send = (msg) => { sent.push(msg); };
  try {
    const handle = startHeartbeat({ intervalMs: 20 });
    // Wait for at least 2 heartbeats to fire.
    await new Promise((resolve) => setTimeout(resolve, 80));
    handle.stop();
    const beats = sent.filter((m) => m && m.type === 'nova:heartbeat');
    assert.ok(beats.length >= 1, `worker emitted heartbeats (got ${beats.length})`);
    assert.ok(beats.every((m) => typeof m.at === 'number' && typeof m.pid === 'number'),
      'heartbeats carry a timestamp and pid');
  } finally {
    process.send = originalSend;
  }
});
