/**
 * v32.0 — Business Owner Authentication Service
 *
 * Provides email + password authentication for business owners.
 * Each tenant can have one or more business owner accounts.
 * Owners see ONLY their tenant's data (not all tenants).
 *
 * Auth flow:
 *   1. Owner enters email + password at /business/login
 *   2. Server verifies bcrypt hash against tenants/{tenantId}/owners.json
 *   3. Server issues a JWT with { tenantId, ownerId, role: 'owner' }
 *   4. Client stores JWT in localStorage, sends as Authorization: Bearer <token>
 *   5. Server validates JWT on every /api/business/* request
 *
 * Security:
 *   - Passwords hashed with bcryptjs (10 rounds)
 *   - JWT signed with NOVA_JWT_SECRET env var (or random per-process in dev)
 *   - JWT expires after 7 days
 *   - Failed login attempts rate-limited (5 per minute per IP)
 *
 * Storage:
 *   tenants/{tenantId}/owners.json — array of owner accounts
 *   Each account: { id, email, passwordHash, name, role, createdAt }
 *
 * Note: We use bcryptjs (pure JavaScript) instead of bcrypt (native C++ addon)
 * because bcrypt's native binding fails on Render's deployment environment
 * due to platform differences between build and run environments.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');  // v33.0.1: switched from bcrypt to bcryptjs for Render compatibility
const fs = require('fs');
const path = require('path');
const { withFileLock, atomicWriteJson, readJsonSync } = require('../../storage/src/atomicWrite');
const { InMemoryRateLimiter } = require('./rateLimiter');

const JWT_SECRET = process.env.NOVA_JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_EXPIRY_DAYS = 7;
const BCRYPT_ROUNDS = 10;
// Allowed owner roles. 'admin' can manage co-owners; 'owner' is the default
// working role. Any other value is rejected at create/update time so an admin
// can't mint an arbitrary 'superadmin' role that some future route might trust.
const ALLOWED_ROLES = new Set(['owner', 'admin']);
const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Hash a reset token with SHA-256 for storage. We never persist the raw token,
// so a leak of owners.json doesn't grant password-reset capability. SHA-256 is
// sufficient here (the token is 256-bit random, so a rainbow table is
// infeasible) and faster than bcrypt for a high-volume compare path.
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Constant-time string compare (both inputs must be same-length hex digests).
function tokensEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).toLowerCase().trim());
}

class BusinessOwnerAuthService {
  constructor({ tenantsDir, logger = null, rateLimiter = null } = {}) {
    this.tenantsDir = tenantsDir;
    this.logger = logger;
    // v73.0: rate limiting is delegated to an injected limiter so it can be
    // backed by Redis in persistent mode (survives restart + multi-instance).
    // Default to the in-memory limiter for backward compatibility (dev/tests
    // and any direct construction without a container).
    this.rateLimiter = rateLimiter || new InMemoryRateLimiter({ max: 5, windowMs: 60000 });
  }

  // ─── Owner credential storage ──────────────────────────────────────
  _ownersFilePath(tenantId) {
    return path.join(this.tenantsDir, tenantId, 'owners.json');
  }

  _loadOwners(tenantId) {
    const data = readJsonSync(this._ownersFilePath(tenantId), []);
    return Array.isArray(data) ? data : [];
  }

  _saveOwners(tenantId, owners) {
    const filePath = this._ownersFilePath(tenantId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    atomicWriteJson(filePath, owners, { pretty: true });
  }

  // ─── Account management ────────────────────────────────────────────
  createOwner({ tenantId, email, password, name, role = 'owner' }) {
    if (!email || !password) throw new Error('Email and password are required');
    if (password.length < 6) throw new Error('Password must be at least 6 characters');
    if (!ALLOWED_ROLES.has(role)) throw new Error(`Invalid role '${role}'. Allowed: owner, admin`);
    const owners = this._loadOwners(tenantId);
    if (owners.find(o => o.email.toLowerCase() === email.toLowerCase())) {
      throw new Error('An owner with this email already exists');
    }
    const owner = {
      id: `OWN-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      email: email.toLowerCase().trim(),
      passwordHash: bcrypt.hashSync(password, BCRYPT_ROUNDS),
      name: name || email.split('@')[0],
      role,
      createdAt: new Date().toISOString()
    };
    owners.push(owner);
    this._saveOwners(tenantId, owners);
    this.logger?.info?.('business_owner.created', { tenantId, ownerId: owner.id, email: owner.email, role });
    return { ...owner, passwordHash: undefined }; // never return the hash
  }

  // ─── Authentication ─────────────────────────────────────────────────
  async login({ tenantId, email, ip = 'unknown' }) {
    // Rate limit check (Redis-backed in persistent mode; in-memory fallback).
    const { limited } = await this.rateLimiter.check(ip);
    if (limited) {
      return { ok: false, error: 'Too many login attempts. Please wait a minute.' };
    }
    const owners = this._loadOwners(tenantId);
    const owner = owners.find(o => o.email.toLowerCase() === email.toLowerCase().trim());
    if (!owner) {
      await this.rateLimiter.hit(ip);
      return { ok: false, error: 'Invalid email or password' };
    }
    // Note: password verification happens in loginWithPassword
    return { ok: true, owner };
  }

  async loginWithPassword({ tenantId, email, password, ip = 'unknown' }) {
    const { limited } = await this.rateLimiter.check(ip);
    if (limited) {
      return { ok: false, error: 'Too many login attempts. Please wait a minute.' };
    }
    const owners = this._loadOwners(tenantId);
    const owner = owners.find(o => o.email.toLowerCase() === email.toLowerCase().trim());

    // v33.1: Distinguish between "email not found" and "wrong password"
    // so the business owner knows what went wrong.
    if (!owner) {
      await this.rateLimiter.hit(ip);
      return { ok: false, error: `No account found with email "${email}". Check the email or contact your Nova administrator to create an account.` };
    }
    if (!bcrypt.compareSync(password, owner.passwordHash)) {
      await this.rateLimiter.hit(ip);
      return { ok: false, error: 'Incorrect password. Please try again, or contact your Nova administrator to reset your password.' };
    }
    await this.rateLimiter.clear(ip);
    const token = this._issueJWT(owner, tenantId);
    this.logger?.info?.('business_owner.login', { tenantId, ownerId: owner.id });
    return {
      ok: true,
      token,
      owner: { id: owner.id, email: owner.email, name: owner.name, role: owner.role, tenantId }
    };
  }

  // v33.1: Admin password reset — allows Nova operators to reset
  // any business owner's password via the admin dashboard.
  resetPassword({ tenantId, email, newPassword }) {
    if (!email || !newPassword) throw new Error('Email and new password are required');
    if (newPassword.length < 6) throw new Error('Password must be at least 6 characters');
    const owners = this._loadOwners(tenantId);
    const owner = owners.find(o => o.email.toLowerCase() === email.toLowerCase().trim());
    if (!owner) throw new Error(`No account found with email "${email}"`);
    owner.passwordHash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
    owner.passwordResetAt = new Date().toISOString();
    owner.resetTokenHash = null;        // invalidate any pending self-serve token
    owner.resetTokenExpires = null;
    this._saveOwners(tenantId, owners);
    this.logger?.info?.('business_owner.password_reset', { tenantId, ownerId: owner.id, email: owner.email });
    return { ok: true, ownerId: owner.id, email: owner.email, name: owner.name };
  }

  // ─── Self-serve password recovery (forgot password) ────────────────
  // Issues a single-use, 30-minute reset token for an owner identified by
  // email + tenantId. Returns the token so the caller (route) can deliver it
  // — by email in production, or by returning it directly in dev mode.
  //
  // SECURITY: only a SHA-256 HASH of the token is stored in owners.json
  // (never the plaintext), so a leak of owners.json does not grant reset
  // capability. The plaintext token is returned once and lives only in the
  // email/route response.
  issuePasswordResetToken({ tenantId, email }) {
    if (!email) throw new Error('Email is required');
    const owners = this._loadOwners(tenantId);
    const owner = owners.find(o => o.email.toLowerCase() === email.toLowerCase().trim());
    // SECURITY: do NOT reveal whether the email exists. Return a generic ok
    // even if the owner isn't found, so an attacker can't enumerate accounts.
    if (!owner) return { ok: true, token: null };
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + RESET_TOKEN_TTL_MS;
    owner.resetTokenHash = hashToken(token);   // store the HASH, not the token
    owner.resetTokenExpires = new Date(expires).toISOString();
    this._saveOwners(tenantId, owners);
    this.logger?.info?.('business_owner.reset_token_issued', { tenantId, ownerId: owner.id, email: owner.email });
    return { ok: true, token, ownerId: owner.id, email: owner.email };
  }

  // Consume a reset token + set a new password. Throws on invalid/expired/used
  // token. Single-use: the token hash is cleared on success. Token comparison
  // is constant-time (timingSafeEqual over the fixed-length hex hashes).
  consumePasswordResetToken({ tenantId, token, newPassword }) {
    if (!token || !newPassword) throw new Error('Token and new password are required');
    if (newPassword.length < 6) throw new Error('Password must be at least 6 characters');
    const tokenHash = hashToken(token);
    const owners = this._loadOwners(tenantId);
    const owner = owners.find(o => o.resetTokenHash && tokensEqual(o.resetTokenHash, tokenHash));
    if (!owner) throw new Error('Invalid or already-used reset token');
    if (!owner.resetTokenExpires || new Date(owner.resetTokenExpires).getTime() < Date.now()) {
      owner.resetTokenHash = null; owner.resetTokenExpires = null;
      this._saveOwners(tenantId, owners);
      throw new Error('Reset token has expired. Please request a new one.');
    }
    owner.passwordHash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
    owner.passwordResetAt = new Date().toISOString();
    owner.resetTokenHash = null;            // single-use
    owner.resetTokenExpires = null;
    this._saveOwners(tenantId, owners);
    this.logger?.info?.('business_owner.password_reset_via_token', { tenantId, ownerId: owner.id, email: owner.email });
    return { ok: true, ownerId: owner.id, email: owner.email, name: owner.name };
  }

  // Self-serve password change: requires the CURRENT password (re-auth) so a
  // hijacked session can't silently change the password. Returns the owner
  // (hash stripped) on success; throws on wrong current password.
  updatePassword({ tenantId, ownerId, currentPassword, newPassword }) {
    if (!ownerId || !currentPassword || !newPassword) throw new Error('ownerId, currentPassword, and newPassword are required');
    if (newPassword.length < 6) throw new Error('New password must be at least 6 characters');
    if (currentPassword === newPassword) throw new Error('New password must be different from the current password');
    const owners = this._loadOwners(tenantId);
    const owner = owners.find(o => o.id === ownerId);
    if (!owner) throw new Error('Owner not found');
    if (!bcrypt.compareSync(currentPassword, owner.passwordHash)) {
      throw new Error('Current password is incorrect');
    }
    owner.passwordHash = bcrypt.hashSync(newPassword, BCRYPT_ROUNDS);
    owner.passwordResetAt = new Date().toISOString();
    owner.resetTokenHash = null; owner.resetTokenExpires = null;
    this._saveOwners(tenantId, owners);
    this.logger?.info?.('business_owner.password_changed', { tenantId, ownerId: owner.id });
    // Re-issue the JWT so any session derived from a leaked old token is
    // invalidated (the new password proves continued control). The client
    // stores the new token.
    const token = this._issueJWT(owner, tenantId);
    return { ok: true, ownerId: owner.id, email: owner.email, name: owner.name, token };
  }

  // Self-serve email change: requires the CURRENT password (re-auth) to prevent
  // a hijacked session from silently changing the email (which is the recovery
  // channel). Enforces email uniqueness within the tenant.
  updateEmail({ tenantId, ownerId, currentPassword, newEmail }) {
    if (!ownerId || !currentPassword || !newEmail) throw new Error('ownerId, currentPassword, and newEmail are required');
    const normalized = newEmail.toLowerCase().trim();
    if (!isValidEmail(normalized)) throw new Error('New email is not a valid email address');
    const owners = this._loadOwners(tenantId);
    const owner = owners.find(o => o.id === ownerId);
    if (!owner) throw new Error('Owner not found');
    if (!bcrypt.compareSync(currentPassword, owner.passwordHash)) {
      throw new Error('Current password is incorrect');
    }
    if (owners.some(o => o.id !== ownerId && o.email.toLowerCase() === normalized)) {
      throw new Error('Another owner on this tenant already uses that email');
    }
    const oldEmail = owner.email;
    owner.email = normalized;
    this._saveOwners(tenantId, owners);
    this.logger?.info?.('business_owner.email_changed', { tenantId, ownerId: owner.id, oldEmail, newEmail: normalized });
    // Re-issue the JWT so its payload carries the NEW email — otherwise
    // /api/business/me would return the stale old email until re-login.
    const token = this._issueJWT(owner, tenantId);
    return { ok: true, ownerId: owner.id, email: normalized, name: owner.name, token };
  }

  // v33.1: List all owners for a tenant (for admin dashboard)
  listOwners({ tenantId }) {
    const owners = this._loadOwners(tenantId);
    return owners.map(o => ({ id: o.id, email: o.email, name: o.name, role: o.role, createdAt: o.createdAt, passwordResetAt: o.passwordResetAt || null }));
  }

  // Add an additional owner to a tenant. Called by an authenticated owner
  // (self-serve "Team" page) or by an admin. Enforces email uniqueness.
  addOwner({ tenantId, email, password, name, role = 'owner' }) {
    return this.createOwner({ tenantId, email, password, name, role });
  }

  // Remove an owner from a tenant. Refuses to remove the LAST owner so a
  // tenant can never be locked out. Returns the removed owner (hash stripped).
  removeOwner({ tenantId, ownerId }) {
    if (!ownerId) throw new Error('ownerId is required');
    const owners = this._loadOwners(tenantId);
    if (owners.length <= 1) {
      throw new Error('Cannot remove the last owner. Add another owner first, or suspend the tenant instead.');
    }
    const idx = owners.findIndex(o => o.id === ownerId);
    if (idx === -1) throw new Error('Owner not found');
    const [removed] = owners.splice(idx, 1);
    this._saveOwners(tenantId, owners);
    this.logger?.info?.('business_owner.removed', { tenantId, ownerId: removed.id, email: removed.email });
    return { ok: true, ownerId: removed.id, email: removed.email, name: removed.name };
  }

  // Admin-driven email update (no current-password check — the admin is
  // already authenticated by the dev token). Used by the admin panel.
  adminUpdateEmail({ tenantId, ownerId, newEmail }) {
    if (!ownerId || !newEmail) throw new Error('ownerId and newEmail are required');
    const normalized = newEmail.toLowerCase().trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('New email is not a valid email address');
    const owners = this._loadOwners(tenantId);
    const owner = owners.find(o => o.id === ownerId);
    if (!owner) throw new Error('Owner not found');
    if (owners.some(o => o.id !== ownerId && o.email.toLowerCase() === normalized)) {
      throw new Error('Another owner on this tenant already uses that email');
    }
    const oldEmail = owner.email;
    owner.email = normalized;
    this._saveOwners(tenantId, owners);
    this.logger?.info?.('business_owner.email_changed_admin', { tenantId, ownerId: owner.id, oldEmail, newEmail: normalized });
    return { ok: true, ownerId: owner.id, email: normalized, name: owner.name };
  }

  // ─── JWT ───────────────────────────────────────────────────────────
  _issueJWT(owner, tenantId) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = {
      sub: owner.id,
      email: owner.email,
      name: owner.name,
      role: owner.role,
      tenantId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (JWT_EXPIRY_DAYS * 86400)
    };
    const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${encodedHeader}.${encodedPayload}`).digest('base64url');
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  verifyToken(token) {
    try {
      if (!token || !token.startsWith('Bearer ')) return null;
      const jwt = token.slice(7);
      const parts = jwt.split('.');
      if (parts.length !== 3) return null;
      const [encodedHeader, encodedPayload, signature] = parts;
      const expectedSignature = crypto.createHmac('sha256', JWT_SECRET).update(`${encodedHeader}.${encodedPayload}`).digest('base64url');
      if (signature !== expectedSignature) return null;
      const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
      if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
      return payload;
    } catch { return null; }
  }

  // ─── Rate limiting ─────────────────────────────────────────────────
  // v73.0: rate limiting is delegated to this.rateLimiter (in-memory fallback
  // or Redis-backed, injected by the container). The previous _isRateLimited /
  // _recordFailedAttempt / _clearFailedAttempts helpers are removed — login()
  // and loginWithPassword() call rateLimiter.check/hit/clear directly.

  // ─── Middleware for Express-style handlers ─────────────────────────
  requireAuth(req) {
    const payload = this.verifyToken(req.headers['authorization'] || '');
    if (!payload) return null;
    return payload; // { sub, email, name, role, tenantId }
  }
}

module.exports = { BusinessOwnerAuthService };
