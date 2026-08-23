# Nova v2.9 Transactional Validation

## Purpose

This quality release makes invalid conversational input transactional: rejected values never partially mutate draft/cart state, and human acknowledgements happen only after validation succeeds.

## Rules

- Draft product selection is separate from committed cart state.
- Inventory validation happens before quantity is persisted.
- Insufficient inventory reports the actual available quantity.
- A rejected quantity preserves valid product, color, and size slots while leaving quantity pending.
- Social acknowledgements such as `Perfect 👍` are never prepended to validation failures.
- `show my cart` reports an unfinished draft when the committed cart is empty.
- `confirm my order` cannot start checkout until the draft has a valid quantity.

## Example

Customer selects Comfort Slides / Black / Size 41 and enters `50` while inventory is 38. Nova responds that only 38 are available and asks for quantity again. The draft remains Comfort Slides / Black / 41 with quantity unset.
