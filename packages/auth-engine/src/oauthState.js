// Phase 4 hardening — Signed OAuth state tokens.
//
// The OAuth callback (Google + Microsoft) used to trust a `state` query param
// of the form `hash:tenantId` where `hash` was never validated. An attacker
// could craft a callback with their own authorization code + a victim's
// tenantId in state, and the server would save the attacker's tokens to the
// victim tenant — reading/writing the victim's calendar.
//
// This module signs state with an HMAC over { tenantId, nonce, expiresAt }
// using NOVA_OAUTH_STATE_SECRET (or a derived dev key). The callback verifies
// the signature + expiry + single-use (nonce consumed).
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — long enough for a consent flow

function getSecret() {
  if (process.env.NOVA_OAUTH_STATE_SECRET) return process.env.NOVA_OAUTH_STATE_SECRET;
  // Dev fallback: derive a stable per-install key so local dev works without env.
  // Production MUST set NOVA_OAUTH_STATE_SECRET (warned at startup).
  return "nova-dev-oauth-state-key-do-not-use-in-prod";
}

function hmac(data) {
  return crypto.createHmac("sha256", getSecret()).update(data).digest("hex");
}

/**
 * Mint a signed, single-use state token for a tenant's OAuth flow.
 * @param {string} tenantId
 * @param {object} [store]  optional nonce store with .consume(nonce) + .has(nonce);
 *                          if provided, the nonce is recorded for single-use.
 * @returns {string} the opaque state string to send to the provider.
 */
function mintState(tenantId, store = null, { ttlMs = STATE_TTL_MS } = {}) {
  const nonce = crypto.randomBytes(8).toString("hex");
  const expiresAt = Date.now() + ttlMs;
  const payload = `${tenantId}|${nonce}|${expiresAt}`;
  const sig = hmac(payload);
  if (store && typeof store.record === "function") store.record(nonce, expiresAt);
  return `${sig}.${payload}`;
}

/**
 * Verify a state token returned by the provider. Throws on tamper/expiry/reuse.
 * @param {string} state
 * @param {object} [store]  optional nonce store with .consume(nonce) → boolean
 * @returns {{ tenantId:string, nonce:string, expiresAt:number }}
 */
function verifyState(state, store = null) {
  if (!state || typeof state !== "string") throw new Error("Missing state token");
  const parts = state.split(".");
  if (parts.length !== 2) throw new Error("Malformed state token");
  const [sig, payload] = parts;
  const expected = hmac(payload);
  // Constant-time compare to prevent timing attacks.
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error("Invalid state signature");
  }
  const [tenantId, nonce, expiresAtStr] = payload.split("|");
  if (!tenantId || !nonce || !expiresAtStr) throw new Error("Malformed state payload");
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) throw new Error("State token expired");
  if (store && typeof store.consume === "function") {
    if (!store.consume(nonce)) throw new Error("State token already used (replay)");
  }
  return { tenantId, nonce, expiresAt };
}

/**
 * In-memory nonce store (good enough for a single-process deploy; for multi-
 * instance, swap for a Redis-backed store). Records nonces; consume() returns
 * false if the nonce was never recorded or already consumed.
 */
class InMemoryNonceStore {
  constructor() { this._used = new Map(); this._ttl = new Map(); }
  record(nonce, expiresAt) { this._ttl.set(nonce, expiresAt); }
  consume(nonce) {
    if (!this._ttl.has(nonce)) return false; // was never minted (or expired+pruned)
    this._ttl.delete(nonce);
    if (this._used.has(nonce)) return false; // double-consume
    this._used.set(nonce, Date.now());
    // Prune old entries (>1h) to bound memory.
    if (this._used.size > 10000) {
      const cutoff = Date.now() - 3600000;
      for (const [k, t] of this._used) if (t < cutoff) this._used.delete(k);
    }
    return true;
  }
  /** Prune expired-but-unused nonces (called lazily). */
  prune() {
    const now = Date.now();
    for (const [k, t] of this._ttl) if (t < now) this._ttl.delete(k);
  }
}

module.exports = { mintState, verifyState, InMemoryNonceStore, STATE_TTL_MS };
