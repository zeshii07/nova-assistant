class NluContextBuilder {
  constructor({ maxItems = 80, defaultTimezone = 'UTC', clock = () => new Date(), maxRecentTurns = 6, maxTurnChars = 320 } = {}) { Object.assign(this, {maxItems, defaultTimezone, clock, maxRecentTurns, maxTurnChars}); }

  async build({ tenant, state, services = {}, pending = null }) {
    const vocabulary = [];
    const add = (kind, item) => {
      if (!item || vocabulary.length >= this.maxItems) return;
      const id = clean(item.id, 80); const name = clean(item.name, 120);
      if (!id || !name) return;
      vocabulary.push({ kind, id, name, aliases:(item.aliases || []).map((x) => clean(x, 80)).filter(Boolean).slice(0, 8) });
    };
    // Operational catalogs come first. Knowledge-derived offerings are useful
    // vocabulary, but their synthetic IDs must not displace executable service
    // IDs such as CLN011. This also keeps the language layer aligned with the
    // Control Plane's single source of service/pricing truth.
    try {
      for(const item of services.pricingService?.getConfig?.(tenant.id)?.services||[]){
        add('service',{
          ...item,
          id:item.operationalServiceId||item.id,
          aliases:[...(item.aliases||[]),...(item.operationalServiceId&&item.id?[item.id]:[])]
        });
      }
    } catch {}
    try { for (const item of await (services.catalogService?.listProducts?.(tenant.id) || [])) add('product', item); } catch {}
    try { for (const item of services.offeringService?.list?.(tenant.id) || []) add('service', item); } catch {}

    const unique = [];
    const seen = new Set();
    const seenNames=new Set();
    for (const item of vocabulary) {
      const key = `${item.kind}:${item.id}`;
      const nameKey=`${item.kind}:${String(item.name).toLowerCase().replace(/[^a-z0-9]+/g,' ')}`;
      if (!seen.has(key)&&!seenNames.has(nameKey)) { seen.add(key);seenNames.add(nameKey);unique.push(item); }
    }
    const activeState = pending ? state?.capabilityState?.[pending.capabilityId] || {} : {};
    return Object.freeze({
      reference_time:Object.freeze({
        iso:this.clock().toISOString(),
        timezone:clean(tenant.timezone || tenant.business?.timezone || this.defaultTimezone, 80)
      }),
      tenant:Object.freeze({
        id:String(tenant.id),
        domain:clean(tenant.domain || 'universal', 80),
        enabled_capabilities:[...(tenant.capabilities || [])].map(String).slice(0, 30)
      }),
      active_workflow:pending ? Object.freeze({
        capability_id:pending.capabilityId,
        workflow:pending.workflow,
        pending_field:pending.pendingField || null,
        collected:safeCollected(activeState)
      }) : null,
      // Conversation memory window — the last N customer turns and the
      // capability/intent that handled each. PII (name/phone/email/address)
      // is deliberately excluded so the provider can resolve pronouns like
      // "book it again" or "the same time as last week" without seeing
      // customer contact data. See docs/V11_CONVERSATION_MEMORY_WINDOW.md.
      recent_turns:Object.freeze(safeRecentTurns(state?.context?.recentTurns || [], this.maxRecentTurns, this.maxTurnChars)),
      vocabulary:Object.freeze(unique),
      allowed_service_ids:Object.freeze(unique.filter((x) => x.kind === 'service').map((x) => x.id)),
      allowed_product_ids:Object.freeze(unique.filter((x) => x.kind === 'product').map((x) => x.id))
    });
  }
}

function safeCollected(state) {
  const fields = state.slots || state.fields || {};
  const allow = ['offeringId', 'serviceId', 'date', 'time', 'durationHours', 'cleanerCount', 'propertyType', 'bedrooms'];
  const out = {};
  for (const key of allow) if (scalar(fields[key] ?? state[key])) out[key] = fields[key] ?? state[key];
  if (Array.isArray(state.items)) out.itemIds = state.items.map((x) => x?.id).filter(Boolean).slice(0, 12);
  return Object.freeze(out);
}
function safeRecentTurns(turns, maxTurns, maxChars) {
  if (!Array.isArray(turns)) return [];
  const safeIntent = (value) => typeof value === 'string' && /^[\w.-]{1,80}$/.test(value) ? value : null;
  return turns
    .slice(-maxTurns)
    .map((turn) => ({
      // Customer-facing message text only — truncated for token budget.
      // The provider uses this to resolve references such as "it", "the same
      // one", "wohi", "وہی", "doosra wala".
      text: clean(turn.text, maxChars),
      capability_id: safeIntent(turn.capabilityId),
      intent: safeIntent(turn.intent)
    }))
    .filter((turn) => turn.text);
}
function scalar(value) { return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'; }
function clean(value, max) { const out = String(value || '').trim(); return out ? out.slice(0, max) : null; }

module.exports = { NluContextBuilder };
