class NerEnhancementLayer {
  constructor({ logger = null, enabled = true } = {}) {
    this.logger = logger; this.enabled = enabled; this._initialized = false; this._useRuleBased = true;
  }
  async _initialize() { if (this._initialized) return true; this._initialized = true; return true; }
  async enhance(text, deterministicEntities = {}) {
    if (!this.enabled) return {};
    await this._initialize();
    const nerEntities = {};
    const t = (text||'').toLowerCase();
    // Rule-based NER — fills gaps regex might miss
    if (!deterministicEntities.temporal?.date) {
      if (/\bsometime next week\b/.test(t)) nerEntities.date = 'next_week';
      if (/\bshaam ko\b/.test(t)) nerEntities.time = 'evening';
      if (/\bdopeher ko\b/.test(t)) nerEntities.time = 'afternoon';
      if (/آج/.test(text)) nerEntities.date = 'today';
      if (/کل/.test(text)) nerEntities.date = 'tomorrow';
    }
    if (!deterministicEntities.property?.propertyType) {
      if (/\bghar\b/.test(t)) nerEntities.propertyType = 'villa';
      if (/\bflat\b/.test(t)) nerEntities.propertyType = 'apartment';
    }
    if (!deterministicEntities.serviceSupport?.mentionedServices?.length) {
      if (/\bgehri safai\b/.test(t)) nerEntities.serviceName = 'deep_cleaning';
      if (/\bsafai\b/.test(t)) nerEntities.serviceName = 'cleaning';
    }
    if (/\bany time\b|\bwhenever\b|\bkoi bhi time\b/.test(t)) { nerEntities.vagueTime = 'any'; nerEntities.timeFlexible = true; }
    return { nerEntities, nerSource: 'rule_based', nerTimingMs: 1 };
  }
}
module.exports = { NerEnhancementLayer };
