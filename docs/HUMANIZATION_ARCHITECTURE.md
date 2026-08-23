# Humanization Platform Architecture

Nova follows one permanent separation:

> Capabilities think. Humanization speaks. Channels present.

## Pipeline

1. A capability performs business logic and returns `CapabilityResult`.
2. `IntentRenderer` normalizes `responseModel` into semantic blocks.
3. `ExperienceLanguageEngine` selects a stable language using CRM, memory, current text, and tenant defaults.
4. `RelationshipEngine` classifies visitor, lead, customer, returning customer, or VIP using permitted CRM data.
5. `PersonaEngine` loads the tenant's brand personality.
6. `TemplateEngine` chooses tenant-owned wording.
7. `PolicyEngine` enforces length, emoji, and forbidden-phrase policies.
8. A channel renderer formats the message for WhatsApp, HTTP, and future channels.

Humanization never changes product facts, prices, availability, orders, or CRM records.
