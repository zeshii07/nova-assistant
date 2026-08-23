/** Chooses one winning capability per message for Sprint 3. */
class CapabilityRouter {
  constructor({ registry, permissionService, logger } = {}) { this.registry = registry; this.permissionService = permissionService; this.logger = logger; }
  async resolve(context) {
    const forcedId = context.intelligence?.forcedCapabilityId;
    if (forcedId) {
      const forced = this.registry.get(forcedId);
      if (forced && this.permissionService.canUse(context.tenant, forced.manifest)) {
        return { capability: forced, confidence: Number(context.intelligence.selected?.confidence || 1), priority: Number(forced.manifest.priority || 0), reason: context.intelligence.selected?.reason || "conversation_intelligence" };
      }
    }
    const candidates = [];
    for (const capability of this.registry.list()) {
      if (!this.permissionService.canUse(context.tenant, capability.manifest)) continue;
      try {
        const score = await capability.canHandle(context);
        const confidence = Number(score?.confidence || 0); const priority = Number(capability.manifest.priority || 0);
        if (confidence > 0) candidates.push({ capability, confidence, priority, reason: score?.reason });
      } catch (error) { this.logger?.error("capability.can_handle_failed", { capabilityId: capability.id, error: error.message }); }
    }
    candidates.sort((a, b) => b.confidence - a.confidence || b.priority - a.priority || a.capability.id.localeCompare(b.capability.id));
    return candidates[0] || null;
  }
}
module.exports = { CapabilityRouter };
