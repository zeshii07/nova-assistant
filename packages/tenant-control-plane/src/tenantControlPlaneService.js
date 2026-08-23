const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { validateResource } = require("./resourceValidators");
const { assertResourceType, RESOURCE_TYPES } = require("./controlPlaneRepository");
const { ValidationError, NotFoundError, ConflictError } = require("../../shared/src/errors");
const { unifyServiceDocument } = require("../../service-pricing/src/unifiedServiceCatalog");

class TenantControlPlaneService {
  constructor({ tenantsDir, repository, accessPolicy, invalidators = {}, clock = () => new Date() }) {
    this.tenantsDir = tenantsDir;
    this.repository = repository;
    this.accessPolicy = accessPolicy;
    this.invalidators = invalidators;
    this.clock = clock;
  }

  overview(tenantId, actor) {
    this.#assertTenant(tenantId);
    this.accessPolicy.authorize({ actor, tenantId, action: "read" });
    const state = this.repository.readState(tenantId);
    return {
      tenantId,
      lifecycle: ["draft", "validate", "preview", "publish"],
      resources: Object.fromEntries(RESOURCE_TYPES.map((resourceType) => {
        const revision = state.activeRevisions[resourceType] || 0;
        const active = state.revisions[resourceType].find((item) => item.revision === revision) || null;
        const drafts = Object.values(state.drafts).filter((item) => item.resourceType === resourceType && item.status === "draft");
        return [resourceType, {
          source: active ? "published" : "shipped-baseline",
          activeRevision: revision,
          publishedAt: active?.publishedAt || null,
          draftCount: drafts.length,
          drafts: drafts.map(draftSummary)
        }];
      })),
      auditCount: state.audit.length,
      updatedAt: state.updatedAt
    };
  }

  getResource(tenantId, resourceType, actor) {
    this.accessPolicy.authorize({ actor, tenantId, action: "read", resourceType });
    return this.getEffectiveResource(tenantId, resourceType);
  }

  getEffectiveResource(tenantId, resourceType) {
    this.#assertTenant(tenantId);
    assertResourceType(resourceType);
    const published = this.repository.getPublished(tenantId, resourceType);
    if (published) return { tenantId, resourceType, source: "published", revision: published.revision, publishedAt: published.publishedAt, document: resourceType === "services" ? unifyServiceDocument(published.document,this.#legacyPricing(tenantId)) : structuredClone(published.document) };
    return { tenantId, resourceType, source: "shipped-baseline", revision: 0, publishedAt: null, document: this.#baseline(tenantId, resourceType) };
  }

  createDraft({ tenantId, resourceType, document, actor, requestId = null }) {
    this.#assertTenant(tenantId);
    assertResourceType(resourceType);
    this.accessPolicy.authorize({ actor, tenantId, action: "draft.create", resourceType });
    const state = this.repository.readState(tenantId);
    const now = this.#now();
    const draft = {
      id: id("DFT"), tenantId, resourceType, status: "draft",
      baseRevision: Number(state.activeRevisions[resourceType] || 0),
      document: structuredClone(document ?? this.getEffectiveResource(tenantId, resourceType).document),
      validation: { status: "pending", valid: null, errors: [], warnings: [], checksum: null, validatedAt: null },
      createdBy: actor.id, createdAt: now, updatedBy: actor.id, updatedAt: now,
      publishedRevision: null
    };
    state.drafts[draft.id] = draft;
    this.#audit(state, { tenantId, actor, action: "draft.created", resourceType, draftId: draft.id, requestId, toRevision: draft.baseRevision, afterChecksum: checksum(draft.document) });
    this.repository.writeState(tenantId, state);
    return structuredClone(draft);
  }

  getDraft(tenantId, draftId, actor) {
    this.#assertTenant(tenantId);
    const draft = this.#draft(this.repository.readState(tenantId), tenantId, draftId);
    this.accessPolicy.authorize({ actor, tenantId, action: "read", resourceType: draft.resourceType });
    return structuredClone(draft);
  }

  listDrafts(tenantId, actor, { status = null } = {}) {
    this.#assertTenant(tenantId);
    this.accessPolicy.authorize({ actor, tenantId, action: "read" });
    return Object.values(this.repository.readState(tenantId).drafts)
      .filter((draft) => !status || draft.status === status)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .map((draft) => structuredClone(draft));
  }

  updateDraft({ tenantId, draftId, document, actor, requestId = null }) {
    this.#assertTenant(tenantId);
    const state = this.repository.readState(tenantId);
    const draft = this.#draft(state, tenantId, draftId);
    this.accessPolicy.authorize({ actor, tenantId, action: "draft.update", resourceType: draft.resourceType });
    this.#assertEditable(draft);
    const beforeChecksum = checksum(draft.document);
    draft.document = structuredClone(document);
    draft.validation = { status: "pending", valid: null, errors: [], warnings: [], checksum: null, validatedAt: null };
    draft.updatedBy = actor.id;
    draft.updatedAt = this.#now();
    this.#audit(state, { tenantId, actor, action: "draft.updated", resourceType: draft.resourceType, draftId, requestId, beforeChecksum, afterChecksum: checksum(draft.document) });
    this.repository.writeState(tenantId, state);
    return structuredClone(draft);
  }

  validateDraft({ tenantId, draftId, actor, requestId = null }) {
    this.#assertTenant(tenantId);
    const state = this.repository.readState(tenantId);
    const draft = this.#draft(state, tenantId, draftId);
    this.accessPolicy.authorize({ actor, tenantId, action: "draft.validate", resourceType: draft.resourceType });
    this.#assertEditable(draft);
    const result = validateResource(draft.resourceType, draft.document, this.#validationContext(tenantId));
    draft.validation = { status: result.valid ? "valid" : "invalid", ...result, checksum: checksum(draft.document), validatedAt: this.#now() };
    draft.updatedBy = actor.id;
    draft.updatedAt = draft.validation.validatedAt;
    this.#audit(state, { tenantId, actor, action: "draft.validated", resourceType: draft.resourceType, draftId, requestId, afterChecksum: draft.validation.checksum, metadata: { valid: result.valid, errorCount: result.errors.length, warningCount: result.warnings.length } });
    this.repository.writeState(tenantId, state);
    return structuredClone(draft.validation);
  }

  previewDraft({ tenantId, draftId, actor, requestId = null }) {
    const validation = this.validateDraft({ tenantId, draftId, actor, requestId });
    const draft = this.getDraft(tenantId, draftId, actor);
    this.accessPolicy.authorize({ actor, tenantId, action: "draft.preview", resourceType: draft.resourceType });
    const current = this.getEffectiveResource(tenantId, draft.resourceType);
    return {
      tenantId, draftId, resourceType: draft.resourceType, baseRevision: draft.baseRevision,
      currentRevision: current.revision, stale: draft.baseRevision !== current.revision,
      validation, diff: diffDocuments(current.document, draft.document)
    };
  }

  publishDraft({ tenantId, draftId, actor, requestId = null }) {
    this.#assertTenant(tenantId);
    const state = this.repository.readState(tenantId);
    const draft = this.#draft(state, tenantId, draftId);
    this.accessPolicy.authorize({ actor, tenantId, action: "publish", resourceType: draft.resourceType });
    this.#assertEditable(draft);
    const activeRevision = Number(state.activeRevisions[draft.resourceType] || 0);
    if (draft.baseRevision !== activeRevision) throw new ConflictError("This draft is stale because a newer revision has already been published.", { draftBaseRevision: draft.baseRevision, activeRevision });
    const currentChecksum = checksum(draft.document);
    if (draft.validation?.status !== "valid" || draft.validation.checksum !== currentChecksum) throw new ConflictError("Validate the current draft before publishing it.");
    const revisions = state.revisions[draft.resourceType];
    const revision = revisions.reduce((max, entry) => Math.max(max, Number(entry.revision || 0)), 0) + 1;
    const now = this.#now();
    const entry = {
      revision, tenantId, resourceType: draft.resourceType, document: structuredClone(draft.document),
      checksum: currentChecksum, source: "draft", sourceDraftId: draft.id,
      publishedBy: actor.id, publishedAt: now, rolledBackFromRevision: null
    };
    revisions.push(entry);
    state.activeRevisions[draft.resourceType] = revision;
    draft.status = "published";
    draft.publishedRevision = revision;
    draft.updatedBy = actor.id;
    draft.updatedAt = now;
    this.#audit(state, { tenantId, actor, action: "resource.published", resourceType: draft.resourceType, draftId, requestId, fromRevision: activeRevision, toRevision: revision, afterChecksum: currentChecksum });
    this.repository.writeState(tenantId, state);
    this.#invalidate(tenantId, draft.resourceType);
    return revisionView(entry, true);
  }

  discardDraft({ tenantId, draftId, actor, requestId = null }) {
    this.#assertTenant(tenantId);
    const state = this.repository.readState(tenantId);
    const draft = this.#draft(state, tenantId, draftId);
    this.accessPolicy.authorize({ actor, tenantId, action: "draft.discard", resourceType: draft.resourceType });
    this.#assertEditable(draft);
    draft.status = "discarded";
    draft.updatedBy = actor.id;
    draft.updatedAt = this.#now();
    this.#audit(state, { tenantId, actor, action: "draft.discarded", resourceType: draft.resourceType, draftId, requestId, afterChecksum: checksum(draft.document) });
    this.repository.writeState(tenantId, state);
    return structuredClone(draft);
  }

  listRevisions(tenantId, resourceType, actor, { includeDocument = false } = {}) {
    this.#assertTenant(tenantId);
    assertResourceType(resourceType);
    this.accessPolicy.authorize({ actor, tenantId, action: "read", resourceType });
    return this.repository.readState(tenantId).revisions[resourceType]
      .slice().sort((a, b) => b.revision - a.revision).map((entry) => revisionView(entry, includeDocument));
  }

  rollback({ tenantId, resourceType, targetRevision, actor, requestId = null }) {
    this.#assertTenant(tenantId);
    assertResourceType(resourceType);
    this.accessPolicy.authorize({ actor, tenantId, action: "rollback", resourceType });
    const state = this.repository.readState(tenantId);
    const revisions = state.revisions[resourceType];
    const target = revisions.find((entry) => entry.revision === Number(targetRevision));
    if (!target) throw new NotFoundError(`Revision ${targetRevision} was not found for '${resourceType}'.`);
    const current = Number(state.activeRevisions[resourceType] || 0);
    if (current === target.revision) throw new ConflictError(`Revision ${target.revision} is already active.`);
    const revision = revisions.reduce((max, entry) => Math.max(max, entry.revision), 0) + 1;
    const now = this.#now();
    const entry = {
      revision, tenantId, resourceType, document: structuredClone(target.document), checksum: target.checksum,
      source: "rollback", sourceDraftId: null, publishedBy: actor.id, publishedAt: now,
      rolledBackFromRevision: target.revision
    };
    revisions.push(entry);
    state.activeRevisions[resourceType] = revision;
    this.#audit(state, { tenantId, actor, action: "resource.rolled_back", resourceType, requestId, fromRevision: current, toRevision: revision, afterChecksum: entry.checksum, metadata: { restoredRevision: target.revision } });
    this.repository.writeState(tenantId, state);
    this.#invalidate(tenantId, resourceType);
    return revisionView(entry, true);
  }

  listAudit(tenantId, actor, { limit = 100 } = {}) {
    this.#assertTenant(tenantId);
    this.accessPolicy.authorize({ actor, tenantId, action: "read" });
    return this.repository.readState(tenantId).audit.slice(-Math.max(1, Math.min(Number(limit) || 100, 500))).reverse().map((entry) => structuredClone(entry));
  }

  #validationContext(tenantId) {
    const profile = this.getEffectiveResource(tenantId, "profile").document;
    const categoryFile = path.join(this.tenantsDir, tenantId, "catalog", "categories.json");
    const services = this.getEffectiveResource(tenantId, "services").document.items || [];
    return {
      tenantId,
      capabilities: Array.isArray(profile.capabilities) ? profile.capabilities : [],
      categoryIds: new Set(readJson(categoryFile, []).map((item) => item.id)),
      baselineServiceKind: this.#baseline(tenantId, "services").kind,
      serviceIds: new Set(services.map((item) => item.id))
    };
  }

  #baseline(tenantId, resourceType) {
    if (resourceType === "profile") return readJson(path.join(this.tenantsDir, tenantId, "profile.json"), null);
    if (resourceType === "products") return readJson(path.join(this.tenantsDir, tenantId, "catalog", "products.json"), []);
    if (resourceType === "services") {
      const cleaning = path.join(this.tenantsDir, tenantId, "cleaning", "services.json");
      if (fs.existsSync(cleaning)) return unifyServiceDocument({ kind: "cleaning", items: readJson(cleaning, []) },this.#legacyPricing(tenantId));
      return unifyServiceDocument({ kind: "offering", items: readJson(path.join(this.tenantsDir, tenantId, "offerings", "items.json"), []) },this.#legacyPricing(tenantId));
    }
    if (resourceType === "hours") {
      const knowledge = readJson(path.join(this.tenantsDir, tenantId, "knowledge", "business.json"), {});
      return { text: String(knowledge.hours || "") };
    }
    if (resourceType === "calendar") {
      return readJson(path.join(this.tenantsDir, tenantId, "calendar", "config.json"), {
        enabled: false, provider: "disabled", timezone: "UTC", defaultDurationMinutes: 60,
        slotIntervalMinutes: 30, holdTtlSeconds: 300, minLeadMinutes: 0, maxAdvanceDays: 365,
        resourcePools: [], serviceRules: []
      });
    }
    throw new ValidationError(`Unsupported resource '${resourceType}'.`);
  }

  #firstExisting(files) { return files.find((file) => fs.existsSync(file)) || null; }
  #legacyPricing(tenantId) {
    const pricingFile=this.#firstExisting([
      path.join(this.repository.operationalDataDir,tenantId,"pricing","services.json"),
      path.join(this.tenantsDir,tenantId,"pricing","services.json")
    ]);
    return pricingFile?readJson(pricingFile,{}):{};
  }
  #draft(state, tenantId, draftId) { const draft = state.drafts[draftId]; if (!draft || draft.tenantId !== tenantId) throw new NotFoundError(`Draft '${draftId}' was not found for this tenant.`); return draft; }
  #assertEditable(draft) { if (draft.status !== "draft") throw new ConflictError(`Draft '${draft.id}' is ${draft.status} and cannot be changed.`); }
  #assertTenant(tenantId) { if (!fs.existsSync(path.join(this.tenantsDir, tenantId, "profile.json"))) throw new NotFoundError(`Tenant '${tenantId}' was not found.`); }
  #now() { return this.clock().toISOString(); }
  #invalidate(tenantId, resourceType) { this.invalidators[resourceType]?.(tenantId); }
  #audit(state, input) {
    state.audit.push({
      id: id("AUD"), tenantId: input.tenantId, actorId: input.actor.id, actorRole: input.actor.role,
      action: input.action, resourceType: input.resourceType || null, draftId: input.draftId || null,
      requestId: input.requestId || null, fromRevision: input.fromRevision ?? null, toRevision: input.toRevision ?? null,
      beforeChecksum: input.beforeChecksum || null, afterChecksum: input.afterChecksum || null,
      metadata: input.metadata || {}, timestamp: this.#now()
    });
  }
}

function draftSummary(draft) { return { id: draft.id, status: draft.status, baseRevision: draft.baseRevision, validationStatus: draft.validation?.status || "pending", updatedBy: draft.updatedBy, updatedAt: draft.updatedAt }; }
function revisionView(entry, includeDocument) { const view = { revision: entry.revision, tenantId: entry.tenantId, resourceType: entry.resourceType, checksum: entry.checksum, source: entry.source, sourceDraftId: entry.sourceDraftId, publishedBy: entry.publishedBy, publishedAt: entry.publishedAt, rolledBackFromRevision: entry.rolledBackFromRevision }; if (includeDocument) view.document = structuredClone(entry.document); return view; }
function id(prefix) { return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`; }
function checksum(value) { return crypto.createHash("sha256").update(stableJson(value)).digest("hex"); }
function stableJson(value) { return JSON.stringify(sortValue(value)); }
function sortValue(value) { if (Array.isArray(value)) return value.map(sortValue); if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, sortValue(value[key])])); return value; }
function readJson(file, fallback) { if (!file || !fs.existsSync(file)) return structuredClone(fallback); return JSON.parse(fs.readFileSync(file, "utf8")); }
function diffDocuments(before, after) {
  const left = flatten(before); const right = flatten(after); const paths = [...new Set([...left.keys(), ...right.keys()])].sort();
  const changes = [];
  for (const pathName of paths) {
    const hasBefore = left.has(pathName), hasAfter = right.has(pathName), oldValue = left.get(pathName), newValue = right.get(pathName);
    if (hasBefore && hasAfter && stableJson(oldValue) === stableJson(newValue)) continue;
    changes.push({ path: pathName, type: !hasBefore ? "added" : !hasAfter ? "removed" : "changed", before: hasBefore ? oldValue : undefined, after: hasAfter ? newValue : undefined });
  }
  return { changed: changes.length > 0, additions: changes.filter((item) => item.type === "added").length, removals: changes.filter((item) => item.type === "removed").length, modifications: changes.filter((item) => item.type === "changed").length, changes: changes.slice(0, 250), truncated: changes.length > 250 };
}
function flatten(value, pathName = "$", out = new Map()) { if (value && typeof value === "object") { const entries = Array.isArray(value) ? value.map((item, index) => [index, item]) : Object.entries(value); if (!entries.length) out.set(pathName, value); else for (const [key, item] of entries) flatten(item, `${pathName}${Array.isArray(value) ? `[${key}]` : `.${key}`}`, out); } else out.set(pathName, value); return out; }

module.exports = { TenantControlPlaneService, checksum, diffDocuments };
