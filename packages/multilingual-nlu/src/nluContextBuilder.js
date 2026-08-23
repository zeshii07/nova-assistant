class NluContextBuilder {
  constructor({ maxItems = 80, defaultTimezone = 'UTC', clock = () => new Date() } = {}) { Object.assign(this, {maxItems, defaultTimezone, clock}); }

  async build({ tenant, state, services = {}, pending = null }) {
    const vocabulary = [];
    const add = (kind, item) => {
      if (!item || vocabulary.length >= this.maxItems) return;
      const id = clean(item.id, 80); const name = clean(item.name, 120);
      if (!id || !name) return;
      vocabulary.push({ kind, id, name, aliases:(item.aliases || []).map((x) => clean(x, 80)).filter(Boolean).slice(0, 8) });
    };
    try { for (const item of services.offeringService?.list?.(tenant.id) || []) add('service', item); } catch {}
    try { for (const item of await (services.catalogService?.listProducts?.(tenant.id) || [])) add('product', item); } catch {}
    try { for (const item of services.pricingService?.getConfig?.(tenant.id)?.services || []) add('service', item); } catch {}

    const unique = [];
    const seen = new Set();
    for (const item of vocabulary) {
      const key = `${item.kind}:${item.id}`;
      if (!seen.has(key)) { seen.add(key); unique.push(item); }
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
function scalar(value) { return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'; }
function clean(value, max) { const out = String(value || '').trim(); return out ? out.slice(0, max) : null; }

module.exports = { NluContextBuilder };
