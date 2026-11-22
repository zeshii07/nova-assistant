// C2 regression: boot guard refuses to start in production with memory
// storage + >1 worker (the known-broken configuration that loses conversation
// state across workers and overwrites state.json on disk).
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveWorkerCount,
  assertBootable,
  resolveClusterConfig,
} = require('../apps/api/src/clusterManager');

test('C2 boot guard: production + memory + >1 worker is refused', () => {
  const d = assertBootable({
    env: { NODE_ENV: 'production' },
    workerCount: 4,
    storageMode: 'memory',
  });
  assert.equal(d.ok, false, 'boot is refused');
  assert.match(d.error, /NODE_ENV=production/);
  assert.match(d.error, /NOVA_WORKERS=1|NOVA_STORAGE_MODE=persistent/);
});

test('C2 boot guard: production + memory + 1 worker is allowed (the documented escape hatch)', () => {
  const d = assertBootable({
    env: { NODE_ENV: 'production', NOVA_WORKERS: '1' },
    workerCount: 1,
    storageMode: 'memory',
  });
  assert.equal(d.ok, true, 'single worker in production memory mode is allowed');
  assert.equal(d.error, undefined);
});

test('C2 boot guard: production + persistent storage + many workers is allowed', () => {
  const d = assertBootable({
    env: { NODE_ENV: 'production', NOVA_WORKERS: '4' },
    workerCount: 4,
    storageMode: 'persistent',
  });
  assert.equal(d.ok, true, 'persistent storage shares state across workers');
  assert.equal(d.error, undefined);
});

test('C2 boot guard: non-production + memory + >1 worker is allowed (with a warning)', () => {
  const d = assertBootable({
    env: { NODE_ENV: 'development' },
    workerCount: 4,
    storageMode: 'memory',
  });
  assert.equal(d.ok, true, 'dev convenience — do not block local multi-worker runs');
  assert.ok(d.warn, 'warns about the state-sharing limitation');
  assert.match(d.warn, /NOVA_WORKERS=1|persistent/);
});

test('C2 worker count: NOVA_SINGLE_WORKER forces 1 even when NOVA_WORKERS is set', () => {
  assert.equal(resolveWorkerCount({ NOVA_SINGLE_WORKER: 'true', NOVA_WORKERS: '4' }), 1);
  assert.equal(resolveWorkerCount({ NOVA_WORKERS: '2' }), 2);
  assert.equal(resolveWorkerCount({ NOVA_WORKERS: '99' }), 4, 'capped at MAX_WORKERS (4)');
  // When NOVA_WORKERS is unset, the count is cpu count capped at MAX_WORKERS.
  assert.equal(resolveWorkerCount({}, 2), 2, 'uses cpu count when unset (under cap)');
  assert.equal(resolveWorkerCount({}, 8), 4, 'cpu count over the cap is clamped to MAX_WORKERS');
  assert.equal(resolveWorkerCount({}, 0), 1, 'falls back to 1 when no cpus');
});

test('C2 resolveClusterConfig: the render.yaml default (NODE_ENV=production, no storage env) is refused', () => {
  // This is the exact configuration the bug report flags: render.yaml sets
  // NODE_ENV=production and startCommand=npm start with NOVA_STORAGE_MODE unset.
  const cfg = resolveClusterConfig({ NODE_ENV: 'production' }, 4);
  assert.equal(cfg.workerCount, 4);
  assert.equal(cfg.storageMode, 'memory');
  assert.equal(cfg.decision.ok, false, 'the default production launch is refused');
  assert.match(cfg.decision.error, /NOVA_WORKERS=1|NOVA_STORAGE_MODE=persistent/);
});

test('C2 resolveClusterConfig: render.yaml + NOVA_WORKERS=1 is allowed', () => {
  const cfg = resolveClusterConfig({ NODE_ENV: 'production', NOVA_WORKERS: '1' }, 4);
  assert.equal(cfg.workerCount, 1);
  assert.equal(cfg.decision.ok, true);
});

test('C2 resolveClusterConfig: heartbeat defaults are sane', () => {
  const cfg = resolveClusterConfig({ NODE_ENV: 'development' }, 2);
  assert.ok(cfg.heartbeatIntervalMs >= 1000 && cfg.heartbeatIntervalMs <= 60000);
  assert.ok(cfg.maxMissedBeats >= 2 && cfg.maxMissedBeats <= 10);
  // A frozen worker is detected within heartbeatIntervalMs * maxMissedBeats.
  const worstCaseMs = cfg.heartbeatIntervalMs * cfg.maxMissedBeats;
  assert.ok(worstCaseMs <= 60000, `watchdog fires within 60s (got ${worstCaseMs}ms)`);
});
