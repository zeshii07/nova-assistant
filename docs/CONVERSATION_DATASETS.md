# Conversation Compliance Datasets

Nova ships conversation behavior datasets under `tests/datasets/`.

Current corpus:

- Retail core: 65 cases
- Cleaning core: 43 cases
- Shared/global: 17 cases
- Total: 125 conversation cases

The corpus covers category language, product synonyms, spelling variants, quantity words, corrections, checkout interruptions, cancellation, Cleaning Services terminology, English, Roman Urdu and Urdu/global commands.

Run all datasets:

```powershell
npm run test:conversations
```

Or run them visually from Developer Console → Datasets.

## Permanent quality rule

Every production bug becomes a regression case. Every new business capability must ship its own conversation adapter and compliance dataset before customer enablement.
