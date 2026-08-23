# Tenant Experience Configuration

Each tenant controls communication without changing core code.

- `personality.json`: tone, emoji level, verbosity, greeting and closing style.
- `policies.json`: response limits and forbidden phrases.
- `templates/*.json`: language-specific wording for semantic intents.

Template placeholders use `{{path}}`, for example `{{customer.name}}` or `{{orderId}}`.

Business facts must always come from capability payloads, never from templates.
