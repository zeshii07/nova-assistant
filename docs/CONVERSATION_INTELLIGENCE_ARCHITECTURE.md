# Nova Conversation Intelligence Engine

Version: 2.2.0-alpha.1

## Purpose

The Conversation Intelligence Engine (CIE) determines what the customer is trying to do before Nova routes the message to a business capability.

Permanent separation of concerns:

- Capabilities know business truth and execute business actions.
- Conversation Intelligence understands conversational meaning, state, corrections, interruptions and routing confidence.
- Humanization chooses language, tone and wording.
- Channels format and deliver the final message.

## Processing order

1. Normalize message text.
2. Inspect active workflow stack.
3. Detect global commands (`cancel`, `reset`, `human`).
4. Detect corrections (`I meant...`, `that's not my name`).
5. Detect workflow interruptions.
6. Ask each enabled capability conversation adapter for vocabulary, candidate intents and entities.
7. Rank candidates by confidence.
8. Use the LLM interpreter only when deterministic confidence is low.
9. Force the validated winning capability through the normal Capability Router.
10. Execute the capability, humanize its structured result, persist state and record a replay trace.

## Conversation adapters

The core engine does not contain retail, cleaning, CRM or commerce jargon. Each capability owns a `conversation/` adapter.

Current adapters:

- `capabilities/catalog/conversation`
- `capabilities/commerce/conversation`
- `capabilities/cleaning/conversation`
- `capabilities/crm/conversation`
- `capabilities/assistant/conversation`

Future capabilities must add their vocabulary and entity interpretation here instead of modifying the core engine.

## Trace model

Every processed message exposes an `intelligence` object containing:

- normalized text
- global command
- correction
- interruption
- workflow stack
- pending-field validation
- vocabulary matches
- candidate intents
- extracted entities
- selected intent/capability
- LLM fallback usage
- intelligence timing

The same object is recorded by the Replay Engine.

## Important reliability rules

- Active workflows outrank general interpretation.
- A numeric product size must not become a quantity.
- English `do` in `do you have...` must not become Roman-Urdu quantity `2`.
- Checkout fields are validated before persistence.
- Global cancellation works from any workflow state.
- Interruptions do not destroy the underlying workflow.
- LLM output never creates products, services, prices, availability or business facts.
