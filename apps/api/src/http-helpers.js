/**
 * v74.0 — Shared HTTP helpers (extended in v74.1 with listTenants/runDataset).
 *
 * Historically every one of these lived at module scope in server.js. The
 * Express migration (v74.0/74.1) moves them here so the legacy if-chain in
 * server.js AND the new Express routers in routes/ require the same
 * implementations without a circular server.js ⇄ routes/ require.
 *
 * Behavior is byte-identical to the v73.x implementations.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { ForbiddenError, ValidationError } = require("../../../packages/shared/src/errors");

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
async function readJson(req) {
  const raw = await readRaw(req);
  try { return raw.length ? JSON.parse(raw.toString("utf8")) : {}; }
  catch { throw new ValidationError("Invalid JSON body."); }
}
function sendJson(res, statusCode, payload) { res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(payload)); }
function sendText(res, statusCode, text) { res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" }); res.end(String(text)); }
function sendHtml(res, statusCode, html) { res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" }); res.end(String(html)); }
function escHtml(s) { return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function authorizeDeveloperRequest(req) {
  const expected = String(process.env.NOVA_DEV_TOKEN || "");
  // Local development remains zero-config. Public production deployments fail
  // closed so replay, CRM, inventory, knowledge, and Control Plane data cannot
  // become writable merely because a secret was omitted.
  if (!expected) return String(process.env.NODE_ENV || "development").toLowerCase() !== "production";
  const supplied = String(req.headers["x-nova-dev-token"] || "");
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && crypto.timingSafeEqual(expectedBytes, suppliedBytes);
}
function controlPlaneActor(req, tenantId) {
  const scopedTenant=String(req.headers['x-nova-tenant-id']||'').trim();
  if(process.env.NOVA_DEV_TOKEN&&!scopedTenant)throw new ValidationError('x-nova-tenant-id is required for control-plane requests.');
  if(scopedTenant&&scopedTenant!==tenantId)throw new ForbiddenError('The authenticated tenant scope does not match the requested tenant.');
  return {
    id:String(req.headers['x-nova-actor-id']||process.env.NOVA_DEV_ACTOR_ID||'local-developer').trim(),
    role:String(req.headers['x-nova-role']||process.env.NOVA_DEV_ROLE||'owner').trim().toLowerCase(),
    tenantId:scopedTenant||tenantId
  };
}
function requestCorrelationId(req){return String(req.headers['x-request-id']||req.headers['x-correlation-id']||'').trim()||null;}

// ─── v28.0 Widget rate limiter ──────────────────────────────────────────────
// In-memory sliding-window rate limiter. No Redis required.
// Limits: 30 messages per 60 seconds per (IP + tenantId) bucket.
// Buckets older than 5 minutes are garbage-collected on every call.
// On a multi-instance deployment without Redis this limiter is per-process,
// so each Nova instance allows 30/min independently (e.g., 3 pods × 30 = 90/min).
// When Redis is configured in v26 hardening, swap this for a Redis SETEX-based
// limiter for global counting across instances.
const WIDGET_RATE_LIMIT = { windowMs: 60_000, max: 30, gcMs: 5 * 60_000 };
const _widgetBuckets = new Map();
let _widgetLastGc = Date.now();
function checkWidgetRateLimit(key) {
  const now = Date.now();
  if (now - _widgetLastGc > WIDGET_RATE_LIMIT.gcMs) {
    for (const [k, entry] of _widgetBuckets) if (now - entry.windowStart > WIDGET_RATE_LIMIT.windowMs) _widgetBuckets.delete(k);
    _widgetLastGc = now;
  }
  let entry = _widgetBuckets.get(key);
  if (!entry || now - entry.windowStart > WIDGET_RATE_LIMIT.windowMs) {
    entry = { windowStart: now, count: 0 };
    _widgetBuckets.set(key, entry);
  }
  entry.count += 1;
  const remaining = Math.max(0, WIDGET_RATE_LIMIT.max - entry.count);
  const resetAt = entry.windowStart + WIDGET_RATE_LIMIT.windowMs;
  return {
    allowed: entry.count <= WIDGET_RATE_LIMIT.max,
    remaining,
    resetAt,
    retryAfterSeconds: entry.count > WIDGET_RATE_LIMIT.max ? Math.ceil((resetAt - now) / 1000) : 0
  };
}

// ─── v74.1: tenant listing + dataset runner (moved from server.js) ─────────
// Both are used by the legacy /api/dev/* routes still in server.js AND by
// the new admin/public routers, so they live here (shared, no circularity).
function listTenants(tenantsDir, tenantRepository = null) {
  if (!fs.existsSync(tenantsDir)) return [];
  return fs.readdirSync(tenantsDir).sort().flatMap((id) => {
    // v30.1: skip internal folders (_templates, _deleted)
    if (id.startsWith('_')) return [];
    const profilePath=path.join(tenantsDir,id,"profile.json");
    if(!fs.existsSync(profilePath)) return [];
    try { const p=tenantRepository?.getById(id)||JSON.parse(fs.readFileSync(profilePath,"utf8")); return [{id:p.id,name:p.name,domain:p.domain||"generic",capabilities:p.capabilities||[]}]; }
    catch { return []; }
  });
}

async function runDataset(container, datasetName) {
  if (!/^[a-z0-9/_-]+\.json$/i.test(datasetName)) return { ok:false, error:"Invalid dataset path" };
  const root = path.resolve(__dirname, "../../../tests/datasets"); const file = path.resolve(root, datasetName);
  if (!file.startsWith(root) || !fs.existsSync(file)) return { ok:false, error:"Dataset not found" };
  const dataset = JSON.parse(fs.readFileSync(file, "utf8")); const failures=[]; let passed=0; const started=Date.now();
  for (let index=0; index<dataset.cases.length; index+=1) {
    const test=dataset.cases[index]; const customerId=`dataset-${Date.now()}-${index}`; let last=null; let turnFailed=false;
    for (const turn of test.turns) {
      last=await container.executionEngine.process({tenantId:dataset.tenantId,channel:"dataset",customerId,text:turn.text,messageId:null,metadata:{dataset:datasetName}});
      const expected=turn.expect || {}; const actualIntent=last.intelligence?.selected?.intent || null;
      const problems=[];
      if(expected.capabilityId && last.capabilityId!==expected.capabilityId) problems.push(`capability ${last.capabilityId} != ${expected.capabilityId}`);
      if(expected.intent && actualIntent!==expected.intent) problems.push(`intent ${actualIntent} != ${expected.intent}`);
      if(expected.replyContains && !String(last.reply).toLowerCase().includes(String(expected.replyContains).toLowerCase())) problems.push(`reply missing ${expected.replyContains}`);
      for(const [key,value] of Object.entries(expected.entities||{})) if(JSON.stringify(last.intelligence?.entities?.[key])!==JSON.stringify(value)) problems.push(`entity ${key} mismatch`);
      if(problems.length){failures.push({case:test.name,turn:turn.text,problems,actual:{capabilityId:last.capabilityId,intent:actualIntent,entities:last.intelligence?.entities,reply:last.reply}});turnFailed=true;break;}
    }
    if(!turnFailed) passed+=1;
  }
  return { ok:failures.length===0, dataset:datasetName, total:dataset.cases.length, passed, failed:failures.length, durationMs:Date.now()-started, failures:failures.slice(0,50) };
}

module.exports = {
  readRaw, readJson, sendJson, sendText, sendHtml, escHtml,
  authorizeDeveloperRequest, controlPlaneActor, requestCorrelationId,
  checkWidgetRateLimit, WIDGET_RATE_LIMIT,
  listTenants, runDataset,
};
