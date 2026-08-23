# Commerce Conversation Orchestration v2.6

This quality release makes Commerce behave as a conversation rather than a form.

## Routing precedence during checkout
1. global commands
2. cart operations / shopping interruptions
3. corrections
4. business interruptions
5. pending checkout-field validation

A message such as `do you have milk also?` is therefore not stored as the delivery name. The active cart and checkout field are preserved.

## Cart operations
- `commerce.cart.view`
- `commerce.cart.add_request`
- `commerce.cart.remove_request`
- `commerce.cart.update_quantity`
- `commerce.cart.clear`

Cart data is authoritative in CommerceService. Catalog remains authoritative for product identity, price, variants, inventory and selection validation.

## Nested add-item flow
When checkout is active, an add-item request temporarily moves Commerce to `paused_add_item`. Generic category requests (for example `add shoes`) show all matching options rather than silently choosing a product. After the added item's required attributes are complete and confirmed, Commerce merges it into the existing cart and resumes the previous checkout field.

## Cancellation semantics
`cancel` stops the current conversational request/checkout state and keeps the Commerce repository cart recoverable. `undo cancel` restores the captured workflow state. `clear cart` explicitly removes cart contents. Confirmed orders remain separate records.

## Inventory
Catalog selection validation now rejects requested quantities above a product's `inventory` value with `insufficient_inventory`.
