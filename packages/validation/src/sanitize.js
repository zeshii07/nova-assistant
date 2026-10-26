// v35.3: Input sanitization helpers for admin/business endpoints.
// Prevents path traversal, command injection, and other injection attacks
// on user-supplied data before persisting to disk.

/**
 * Sanitize a tenant ID — only allow lowercase alphanumeric + dash + underscore.
 * Max 64 chars. Throws on invalid input.
 */
function sanitizeTenantId(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) throw new Error('Tenant ID is required');
  if (s.length > 64) throw new Error('Tenant ID too long (max 64 chars)');
  if (!/^[a-z0-9_-]+$/.test(s)) throw new Error('Invalid tenant ID (only a-z, 0-9, -, _ allowed)');
  if (s.includes('..') || s.startsWith('-') || s.startsWith('_')) throw new Error('Invalid tenant ID format');
  return s;
}

function sanitizeTemplateId(value) {
  return sanitizeTenantId(value);
}

function sanitizeProductId(value) {
  const s = String(value || '').trim();
  if (!s) throw new Error('Product ID is required');
  if (s.length > 32) throw new Error('Product ID too long (max 32 chars)');
  if (!/^[a-zA-Z0-9_-]+$/.test(s)) throw new Error('Invalid product ID');
  return s;
}

function sanitizeText(value, maxLen = 2000, allowNewlines = true) {
  let s = String(value || '');
  s = s.replace(/\0/g, '');
  if (allowNewlines) {
    s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  } else {
    s = s.replace(/[\x00-\x1F\x7F]/g, '');
  }
  s = s.replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '');
  s = s.replace(/<\s*iframe[^>]*>[\s\S]*?<\s*\/\s*iframe\s*>/gi, '');
  s = s.replace(/<\s*object[^>]*>[\s\S]*?<\s*\/\s*object\s*>/gi, '');
  s = s.replace(/javascript:\s*[^"'\s]*/gi, '');
  s = s.replace(/on\w+\s*=\s*"[^"]*"/gi, '');
  s = s.replace(/on\w+\s*=\s*'[^']*'/gi, '');
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s.trim();
}

function sanitizeName(value, maxLen = 200) {
  let s = String(value || '').trim();
  s = s.replace(/[<>]/g, '');
  s = s.replace(/[\x00-\x1F\x7F]/g, '');
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

function sanitizeEmail(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return '';
  if (s.length > 254) throw new Error('Email too long');
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s)) throw new Error('Invalid email format');
  return s;
}

function sanitizePhone(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (s.length > 30) throw new Error('Phone too long');
  if (!/^[0-9+\-\s()]+$/.test(s)) throw new Error('Invalid phone format');
  return s;
}

function sanitizeNumber(value, opts = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('Invalid number');
  if (opts.min !== undefined && n < opts.min) throw new Error(`Number must be >= ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) throw new Error(`Number must be <= ${opts.max}`);
  if (opts.integer && !Number.isInteger(n)) throw new Error('Number must be an integer');
  return n;
}

function sanitizeUrl(value) {
  const s = String(value || '').trim();
  if (!s) return '';
  if (s.length > 2000) throw new Error('URL too long');
  if (!/^https?:\/\/[a-z0-9.-]+/i.test(s)) throw new Error('Invalid URL (must start with http:// or https://)');
  return s;
}

function sanitizeFilename(value) {
  let s = String(value || '').trim();
  if (!s) return '';
  s = s.replace(/[\\/:]/g, '_');
  s = s.replace(/\.\./g, '_');
  if (!/^[a-zA-Z0-9._\-\s]+$/.test(s)) throw new Error('Invalid filename characters');
  if (s.length > 200) s = s.slice(0, 200);
  return s;
}

module.exports = {
  sanitizeTenantId,
  sanitizeTemplateId,
  sanitizeProductId,
  sanitizeText,
  sanitizeName,
  sanitizeEmail,
  sanitizePhone,
  sanitizeNumber,
  sanitizeUrl,
  sanitizeFilename,
};
