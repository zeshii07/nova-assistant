# Nova v5.3.1 — Catalog Precision + Alternative Recommendations

## Resolution rule

Catalog selection and product recommendation are separate decisions.

1. If the requested product is a valid configured match:
   - Nova says it is available.
   - Nova shows its real catalog details.
   - Nova continues only that product's configured attribute flow: color, size, weight/unit, quantity, etc.

2. If the requested product is NOT a valid configured match:
   - Nova explicitly says that requested product is unavailable.
   - Nova may show up to 3 genuinely related in-stock catalog alternatives.
   - Alternatives are labelled as suggestions, never as the requested item.
   - No alternative is written into selectedProductId/cart until the customer explicitly chooses it.

3. If there is no meaningful related product:
   - Nova does not invent a recommendation.
   - It falls back to broader available/catalog discovery.

Examples:
- `fountain pen` -> unavailable; may recommend Gel Pen Pack; does not select it.
- `plastic water bottle` -> unavailable; may recommend Steel Water Bottle; does not select it.
- `ball point pen` -> unavailable; may recommend Gel Pen Pack; does not select it.
- `gel pen pack` -> exact available product; normal attribute/order flow starts.

The same invariant is enforced in both Catalog browsing and Commerce `add ... to my order` flows.

## Humanization

Recommendation responses can mark `preferLegacyText` so tenant humanization templates cannot replace a precise alternative list with a generic full-catalog fallback.
