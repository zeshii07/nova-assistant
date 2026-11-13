/**
 * v58.0 — Tenant Isolation Helpers
 *
 * Spec reference: §11 Security and tenant isolation
 *
 * Enforces tenant scope at every retrieval boundary. Used by PostgresRepository,
 * VectorRepository, and the retrieval pipeline to guarantee a tenant's query
 * never returns another tenant's chunks.
 *
 * Mandatory production requirements (spec §11.1):
 *   - Derive tenant identity from trusted authentication/session context.
 *   - Include tenant ID in every repository query and cache key.
 *   - Enforce tenant filters in lexical and vector retrieval.
 *   - Prevent customer input from selecting another tenant.
 *   - Test cross-tenant access attempts.
 *   - Ensure background ingestion jobs retain the correct tenant context.
 */

class TenantIsolation {
  constructor({ logger = null } = {}) {
    this.logger = logger;
  }

  /**
   * Assert that a tenantId is well-formed and not an attempt to inject SQL or
   * traverse the file system.
   */
  assertValidTenantId(tenantId) {
    if (!tenantId || typeof tenantId !== 'string') {
      throw new Error('Tenant ID is required and must be a string.');
    }
    // Allow letters, digits, hyphens, underscores. Length 1-128.
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(tenantId)) {
      throw new Error(`Invalid tenant ID '${tenantId}': must match [A-Za-z0-9_-]{1,128}.`);
    }
    return true;
  }

  /**
   * Build a tenant-scoped query parameter object. Forces tenant_id to be the
   * first parameter and prevents it from being overridden by user input.
   */
  scopedParams(tenantId, extra = []) {
    this.assertValidTenantId(tenantId);
    return [tenantId, ...extra];
  }

  /**
   * Verify a retrieved chunk belongs to the requesting tenant. Used as a
   * defense-in-depth check after retrieval (in case the SQL filter is bypassed).
   */
  assertChunkBelongsToTenant(chunk, tenantId) {
    if (!chunk) return false;
    if (chunk.tenantId && chunk.tenantId !== tenantId) {
      this.logger?.error?.('tenantIsolation.violation', { chunkTenant: chunk.tenantId, requestTenant: tenantId });
      throw new Error(`Cross-tenant access attempt: chunk belongs to '${chunk.tenantId}' but request is for '${tenantId}'.`);
    }
    return true;
  }

  /**
   * Filter a list of chunks to only those belonging to the requesting tenant.
   * Use this as a final safety net before returning retrieval results.
   */
  filterByTenant(chunks, tenantId) {
    this.assertValidTenantId(tenantId);
    return (chunks || []).filter(c => !c.tenantId || c.tenantId === tenantId);
  }
}

module.exports = { TenantIsolation };
