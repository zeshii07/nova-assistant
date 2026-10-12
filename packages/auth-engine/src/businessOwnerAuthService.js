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

const JWT_SECRET = process.env.NOVA_JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_EXPIRY_DAYS = 7;
const BCRYPT_ROUNDS = 10;

class BusinessOwnerAuthService {
  constructor({ tenantsDir, logger = null }) {
    this.tenantsDir = tenantsDir;
    this.logger = logger;
    // Rate limiting: 5 failed attempts per minute per IP
    this._failedAttempts = new Map(); // ip → { count, windowStart }
  }

  // ─── Owner credential storage ──────────────────────────────────────
  _ownersFilePath(tenantId) {
    return path.join(this.tenantsDir, tenantId, 'owners.json');
  }

  _loadOwners(tenantId) {
    try {
      const filePath = this._ownersFilePath(tenantId);
      if (!fs.existsSync(filePath)) return [];
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  }

  _saveOwners(tenantId, owners) {
    const filePath = this._ownersFilePath(tenantId);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(owners, null, 2) + '\n', 'utf8');
  }

  // ─── Account management ────────────────────────────────────────────
  createOwner({ tenantId, email, password, name, role = 'owner' }) {
    if (!email || !password) throw new Error('Email and password are required');
    if (password.length < 6) throw new Error('Password must be at least 6 characters');
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
    this.logger?.info?.('business_owner.created', { tenantId, ownerId: owner.id, email: owner.email });
    return { ...owner, passwordHash: undefined }; // never return the hash
  }

  // ─── Authentication ─────────────────────────────────────────────────
  login({ tenantId, email, ip = 'unknown' }) {
    // Rate limit check
    if (this._isRateLimited(ip)) {
      return { ok: false, error: 'Too many login attempts. Please wait a minute.' };
    }
    const owners = this._loadOwners(tenantId);
    const owner = owners.find(o => o.email.toLowerCase() === email.toLowerCase().trim());
    if (!owner) {
      this._recordFailedAttempt(ip);
      return { ok: false, error: 'Invalid email or password' };
    }
    // Note: password verification happens in loginWithPassword
    return { ok: true, owner };
  }

  loginWithPassword({ tenantId, email, password, ip = 'unknown' }) {
    if (this._isRateLimited(ip)) {
      return { ok: false, error: 'Too many login attempts. Please wait a minute.' };
    }
    const owners = this._loadOwners(tenantId);
    const owner = owners.find(o => o.email.toLowerCase() === email.toLowerCase().trim());
    if (!owner || !bcrypt.compareSync(password, owner.passwordHash)) {
      this._recordFailedAttempt(ip);
      return { ok: false, error: 'Invalid email or password' };
    }
    this._clearFailedAttempts(ip);
    const token = this._issueJWT(owner, tenantId);
    this.logger?.info?.('business_owner.login', { tenantId, ownerId: owner.id });
    return {
      ok: true,
      token,
      owner: { id: owner.id, email: owner.email, name: owner.name, role: owner.role, tenantId }
    };
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
  _isRateLimited(ip) {
    const entry = this._failedAttempts.get(ip);
    if (!entry) return false;
    if (Date.now() - entry.windowStart > 60000) {
      this._failedAttempts.delete(ip);
      return false;
    }
    return entry.count >= 5;
  }

  _recordFailedAttempt(ip) {
    const entry = this._failedAttempts.get(ip) || { count: 0, windowStart: Date.now() };
    if (Date.now() - entry.windowStart > 60000) {
      entry.count = 0;
      entry.windowStart = Date.now();
    }
    entry.count += 1;
    this._failedAttempts.set(ip, entry);
  }

  _clearFailedAttempts(ip) {
    this._failedAttempts.delete(ip);
  }

  // ─── Middleware for Express-style handlers ─────────────────────────
  requireAuth(req) {
    const payload = this.verifyToken(req.headers['authorization'] || '');
    if (!payload) return null;
    return payload; // { sub, email, name, role, tenantId }
  }
}

module.exports = { BusinessOwnerAuthService };
