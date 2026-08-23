# Commerce v2.6 Acceptance

Required regression behavior:
- Checkout at delivery name + `do you have milk also?` -> friendly unavailable response, name remains pending, cart preserved.
- Checkout + `i want to add shoes in my order` -> Footwear choices, checkout preserved as resume state.
- `show my cart` -> Commerce cart view, never Catalog list.
- Generic category add requests do not silently select the first/best product.
- Quantities above inventory are rejected.
- `clear cart` explicitly empties cart.
- Existing Conversation Intelligence, Goal, Social, Retail and Cleaning suites remain green.
