class ConversationStack {
  snapshot(state) {
    const stack = [];
    const commerce = state?.capabilityState?.commerce;
    const cleaning = state?.capabilityState?.cleaning;
    const catalog = state?.capabilityState?.catalog;
    const booking = state?.capabilityState?.booking;
    if (catalog?.selectedProductId) stack.push({ capabilityId:'catalog', workflow:'product_selection', pendingField:inferCatalogPending(catalog) });
    if (commerce?.mode === 'paused_add_item') stack.push({ capabilityId:'commerce', workflow:'add_item', pendingField:inferCatalogPending(catalog) });
    if (commerce?.mode === 'checkout' || commerce?.mode === 'review') stack.push({ capabilityId:'commerce', workflow:commerce.mode, pendingField:commerce.pendingField || null });
    if (cleaning?.step) stack.push({ capabilityId:'cleaning', workflow:'service_request', pendingField:cleaning.step });
    if (booking?.status === 'collecting' || booking?.status === 'ready') stack.push({ capabilityId:'booking', workflow:'generic_booking', pendingField:booking.pendingField || (booking.status==='ready'?'confirmation':null) });
    return stack;
  }
  current(state) { const list = this.snapshot(state); return list[list.length - 1] || null; }
}
function inferCatalogPending(catalog) {
  if(!catalog?.selectedProductId) return null;
  const attrs = catalog?.selectedAttributes || {};
  if (!attrs.color) return 'color';
  if (!attrs.size) return 'size_or_quantity';
  if (!attrs.quantity) return 'quantity';
  return 'confirmation';
}
module.exports = { ConversationStack };
