# Social Intelligence Layer

Social Intelligence is a deterministic experience layer above Conversation Intelligence and below final channel delivery.

## Responsibilities

- Recognize greetings, small talk, gratitude, reactions, apologies and price concerns.
- Allow social language to coexist with business intent (`hello can I get shoes`).
- Add lightweight acknowledgements to attribute updates without changing business facts.
- Ensure unsupported services/products receive friendly, tenant-aware replies.
- Never override Catalog, Commerce, CRM, Cleaning, or other domain truth.

## Routing principle

Business intent wins over a greeting when both occur in the same message. Social signals are retained as metadata and used to polish the final response.

## Tenant capability boundary

A request for a domain not enabled for the tenant (for example cleaning on a retail tenant) is routed to Assistant as `assistant.unsupported_capability`. It must never be mistaken for business hours or another unrelated intent.

## Examples

- `hello can i get shoes` -> Catalog category browse + greeting prefix.
- `how do you do today` -> Assistant small talk.
- `do you sell football` -> friendly Catalog unavailable response.
- `I need a cleaner tomorrow for two hours` on retail -> friendly unsupported capability response.
- `41` during shoe selection -> natural acknowledgement + next question.
