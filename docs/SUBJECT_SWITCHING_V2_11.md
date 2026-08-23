# Nova v2.11 — Subject Switching & Domain Playground Expansion

## Purpose
This quality release fixes a conversation-precedence bug where an active product draft could absorb a brand-new product request merely because the new message contained an attribute such as a color or size.

## Core rule
A newly expressed product, product family, or category beats the old draft. Attribute-only replies continue the old draft.

Examples:
- `white` while configuring Polo Shirt → attribute update.
- `can i get white shirt` while configuring Denim Jeans → new shirt-family request.
- `can i get black shoes` while configuring Denim Jeans → new filtered Footwear browse.
- `i want black running shoes` → specific Running Shoes request.

## Additional fixes
- English auxiliary `do` in phrases such as `do you have shirts` is never interpreted as Roman-Urdu quantity 2.
- Bare `clear` and `reset` are global conversation reset commands.
- Reset replaces capability state instead of merging the old draft back into the new state.
- Typo attribute follow-ups such as `blck` still work by requiring an actual non-null attribute extraction from the selected product.

## Playground demo domains
The Developer Playground now includes:
- Retail (`default`)
- Cleaning (`cleaning-demo`)
- Healthcare (`healthcare-demo`)
- Education (`education-demo`)
- Restaurant (`restaurant-demo`)
- Salon (`salon-demo`)

Healthcare, Education, Restaurant, and Salon are semantic demos. They intentionally use Assistant + CRM + domain schemas and business knowledge rather than pretending unbuilt booking capabilities already exist.
