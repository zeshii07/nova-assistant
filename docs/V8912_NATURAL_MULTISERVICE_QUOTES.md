# Nova v8.9.12 — Natural Multi-Service Quotes

Nova v8.9.12 upgrades cleaning price enquiries from single-winner matching to
compositional quotation state. Groq remains an optional language interpreter;
tenant-scoped deterministic services remain the only execution authority.

## Cleaning-type clarification

Property cleaning has two different pricing models:

| Type | Price rule | Required details |
| --- | --- | --- |
| Standard/general cleaning | AED 40 per hour per cleaner | Cleaner count and hours |
| Deep villa cleaning | AED 300 for one bedroom, then AED 70 per additional bedroom | Bedroom count |
| Deep apartment cleaning | AED 200 studio; AED 250 one bedroom, then AED 50 per additional bedroom | Bedroom count |

`What are the charges for a 2-bedroom villa cleaning?` does not silently choose
the hourly or deep-cleaning model. Nova asks whether the customer means standard
or deep cleaning and displays the configured choices. After `standard`, it asks
for cleaners and hours. After `deep`, it uses the bedroom table.

## Compound price questions

Nova resolves each explicit service segment independently. For example:

> What are the charges for a 2-bedroom villa cleaning and a 3-seater sofa?

The sofa scope is already unambiguous, so Nova shows AED 110 immediately and
asks only whether the villa needs standard or deep cleaning. If the customer
chooses deep cleaning, the deterministic quote is:

- Deep cleaning, 2-bedroom villa — AED 370
- Sofa cleaning, 3-seater — AED 110
- Combined total — AED 480

The quote remains informational state until the customer explicitly asks to
book it. The customer-facing reply does not expose internal statements such as
`booking draft unchanged`, `information only`, or `nothing has been booked`.
Those guarantees are carried in response/replay metadata.

## Quote-to-booking continuity

Nova stores the exact latest quote, its operational service identity, and its
required scope. Therefore:

- `WHAT ARE CHARGES` can repeat the latest contextual sofa quote.
- `Make booking for this quotation` selects the quoted service rather than an
  older service in an interrupted workflow.
- A five-seater sofa quote retains `units=5` and AED 170 when booking begins.
- A combined quote becomes one primary cleaning request with additional service
  lines and a preserved combined estimate.
- Confirmation before required date/time/contact fields responds with the next
  natural question instead of sending the customer a raw validation error.

## Validation

Run the release gate:

```powershell
npm run benchmark:v8.9.12
```

Run deterministic-only:

```powershell
$env:NOVA_NLU_MODE="off"
npm start
```

Run with adaptive Groq interpretation:

```powershell
$env:NOVA_NLU_MODE="on"
npm run model:groq:check
npm start
```
