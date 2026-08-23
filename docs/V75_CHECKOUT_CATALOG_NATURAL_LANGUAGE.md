# Nova v7.5 — Checkout & Catalog Natural-Language Consistency

## Main fixes

### Field-aware checkout answers
Pending checkout fields understand natural answers before generic shopping cues:
- `I want it in Lahore` -> city = Lahore
- `it is 03019299608` -> phone
- `my name is Zeeshan` -> name

A true shopping request such as `I want another watch` still interrupts checkout.

### Incomplete checkout confirmation
`confirm my order` while required customer details are still missing means continue checkout. Nova explains the missing field instead of validating the phrase as a name/city/address.

### Multi-product extraction
One segment may explicitly contain multiple product identities. Example:
`I want a smart watch a polo shirt and gel pen pack`
keeps all three products.

### Related-product browsing
`show/check other watches` is discovery. It returns matching available watch options without claiming the phrase itself is an unavailable product.

### Conservative typo normalization
Common structural typo `hve` canonicalizes to `have`, so `do you hve caps` remains a Catalog availability question.

### Operational routing before knowledge abstention
When deterministic Catalog/Commerce evidence exists, an Assistant `knowledge_question_abstention` cannot steal the query. Genuine business-knowledge questions can still abstain normally.

### Unavailable item cleanup
Greeting/request scaffolding is removed from unavailable names:
`hello i want to purchase a cap` -> requested item `cap`, not `hello a cap`.
