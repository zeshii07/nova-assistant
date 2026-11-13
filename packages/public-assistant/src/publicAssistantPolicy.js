/**
 * PublicAssistantPolicy — §4 (isolation), §16 (evidence rules), §20 (security).
 *
 * Enforces the hard security rules for the public product assistant. The policy
 * is the single chokepoint that:
 *  - Refuses unsafe requests (prompt injection, secrets, cross-tenant, staff DB).
 *  - Blocks any tenant-id override coming from the browser (§20.4).
 *  - Sanitizes customer evidence so retrieved documents can't inject instructions.
 *  - Redacts secrets/credentials from any reply (§20.12).
 *
 * The policy is pure (no I/O) so it is unit-testable in isolation.
 */

// §20 + §16 — refuse patterns. Matched against the visitor message (lowercased).
const REFUSE_PATTERNS = [
  // Prompt injection — "ignore previous instructions", "reveal your system prompt".
  { id: "prompt_injection", pattern: /\b(ignore|disregard)\s+(all\s+)?(previous|prior|above)\s+(instructions?|rules?|prompts?)\b/i },
  { id: "reveal_system_prompt", pattern: /\b(reveal|show|print|dump|output)\s+(your|the|all)?\s*(system\s+)?prompt\b/i },
  { id: "reveal_instructions", pattern: /\b(what\s+(are|is)\s+your|tell\s+me\s+your)\s+(instructions?|rules?|policies?|internal)\b/i },
  // Secrets / credentials.
  { id: "secrets", pattern: /\b(password|api\s+key|secret|token|private\s+key|credential)\b/i },
  // Staff / customer database access.
  { id: "staff_db", pattern: /\b(employee|staff|user|admin|customer)\s+(database|table|record|list|records)\b/i },
  // Hacking verbs.
  { id: "hacking", pattern: /\b(hack|exploit|bypass|inject|sql\s+injection|xss)\b/i },
  // Other-tenant references.
  { id: "other_tenant", pattern: /\b(other\s+tenant|other\s+customer|another\s+business'?s?\s+data)\b/i },
  // Source code / implementation.
  { id: "source_code", pattern: /\b(source\s+code|implementation\s+details?|internal\s+url)\b/i }
];

// §16 — patterns that look like injected instructions inside retrieved documents.
const INTERNAL_INSTRUCTION_PATTERNS = [
  /the\s+(assistant|agent|nova)\s+must\s+(never|not|always)/i,
  /must\s+not\s+(promise|reveal|invent|claim)/i,
  /customers?\s+(may|should|must)\s+(ask|be\s+offered|not\s+be)/i,
  /system\s+prompt/i,
  /ignore\s+(previous|prior|all)\s+instructions/i
];

// §20.12 — redact any of these from a public reply, even if they slipped through.
const SECRET_REDACT_PATTERNS = [
  { id: "api_key_like", pattern: /\b(sk-[a-zA-Z0-9]{16,}|AKIA[0-9A-Z]{16}|[a-zA-Z0-9_-]{32,})\b/g, replacement: "[REDACTED]" },
  { id: "private_url", pattern: /\b(https?:\/\/(localhost|127\.0\.0\.1|10\.|192\.168\.|internal|admin)\b[^\s]*)/gi, replacement: "[REDACTED]" }
];

class PublicAssistantPolicy {
  constructor({ logger = null } = {}) {
    this.logger = logger;
  }

  /**
   * Decide whether a visitor message must be refused.
   * Returns { refuse: true, reason } or { refuse: false }.
   */
  evaluateMessage(text) {
    const q = String(text || "");
    for (const r of REFUSE_PATTERNS) {
      if (r.pattern.test(q)) {
        this.logger?.warn?.("public_assistant.refuse", { reason: r.id });
        return { refuse: true, reason: r.id };
      }
    }
    return { refuse: false };
  }

  /**
   * §20.4 — the public assistant identity is fixed server-side. Any tenant_id
   * supplied by the browser MUST be ignored. This method returns the canonical
   * public tenant id regardless of input.
   */
  resolveTenantId(browserSupplied) {
    // Deliberately ignore browserSupplied. Log when it differs so we can detect abuse.
    const canonical = "public-product";
    if (browserSupplied && String(browserSupplied).trim() && String(browserSupplied).trim() !== canonical) {
      this.logger?.warn?.("public_assistant.tenant_override_blocked", { supplied: browserSupplied });
    }
    return canonical;
  }

  /**
   * §16 evidence rules — sanitize a retrieved chunk before it can influence the
   * answer. Strips lines that look like injected internal instructions.
   * Returns the sanitized text (possibly empty) and whether it was flagged.
   */
  sanitizeEvidence(text) {
    const raw = String(text || "");
    if (!raw.trim()) return { text: "", flagged: false };
    const lines = raw.split(/\n+/);
    const kept = [];
    let flagged = false;
    for (const line of lines) {
      let isInternal = false;
      for (const p of INTERNAL_INSTRUCTION_PATTERNS) {
        if (p.test(line)) { isInternal = true; flagged = true; break; }
      }
      if (!isInternal) kept.push(line);
    }
    let cleaned = kept.join("\n").trim();
    // Redact secrets that may have slipped into evidence.
    for (const r of SECRET_REDACT_PATTERNS) {
      cleaned = cleaned.replace(r.pattern, r.replacement);
    }
    return { text: cleaned, flagged };
  }

  /**
   * §20.12 — redact secrets from a final reply before it is sent to the visitor.
   */
  redactReply(text) {
    let cleaned = String(text || "");
    for (const r of SECRET_REDACT_PATTERNS) {
      cleaned = cleaned.replace(r.pattern, r.replacement);
    }
    return cleaned;
  }

  /**
   * §4 isolation check — confirm a retrieved chunk's tenantId matches the public
   * namespace. Defense in depth: if a chunk somehow carries a different tenantId,
   * it is rejected.
   */
  assertChunkPublic(chunk) {
    if (!chunk) return false;
    // Public chunks have tenantId === 'public-product' or no tenantId (legacy).
    if (chunk.tenantId && chunk.tenantId !== "public-product") {
      this.logger?.error?.("public_assistant.cross_tenant_attempt", { chunkTenant: chunk.tenantId });
      return false;
    }
    return true;
  }
}

module.exports = { PublicAssistantPolicy, REFUSE_PATTERNS, INTERNAL_INSTRUCTION_PATTERNS, SECRET_REDACT_PATTERNS };
