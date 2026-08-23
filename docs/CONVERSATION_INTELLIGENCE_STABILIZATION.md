# Conversation Intelligence Stabilization

Version: `2.0.1-alpha.1`

This milestone fixes deterministic conversation problems before adding new platform features.

## Routing order

1. Active capability state and pending attributes.
2. Deterministic attribute parsing.
3. Concrete catalog product evidence.
4. Generic browse intent.
5. Specialized capabilities.
6. Assistant and controlled LLM fallback.

## Fixed cases

- `i want to make an order for sunglasses from your products` selects Sunglasses instead of listing the full catalog.
- `i want to order four pieces` resolves quantity `4` against the selected item.
- `i meant 4` updates the pending quantity instead of reaching fallback.
- English number words and common Roman Urdu/Urdu number words are supported from one through ten.
- `ap k pass kia kia hai?` is treated as a catalog browse request.
- `hi`, `hello`, and `assalam o alaikum kia hal hai` reliably route to Assistant.
- A completed catalog selection naturally invites order confirmation.

## Safety rule

The LLM remains a fallback. Products, variants, quantities, prices, subtotals, and orders are determined and validated by backend services.
