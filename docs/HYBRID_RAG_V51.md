# Nova v5.1 — Hybrid Knowledge Retrieval & Universal Question Routing

## What changed

Nova Knowledge retrieval is now hybrid:

1. **Lexical retrieval**
   - exact words
   - partial token matches
   - phrases

2. **Vector/embedding retrieval**
   - every knowledge chunk and query is represented as a fixed-size vector
   - cosine similarity provides a semantic signal
   - the bundled provider is dependency-free and deterministic so Nova works offline

3. **Hybrid fusion**
   - lexical and semantic scores are combined
   - source priority is only a small tie-breaker
   - Knowledge Manager search can expose lexical, semantic and fused scores

4. **Evidence completeness**
   - similarity alone is not enough
   - question-specific evidence gates prevent nearby but non-answering text from being returned

Example:
`How many cleaners do you employ?`

A pricing paragraph containing `number of cleaners` is semantically related, but it does not state the company's workforce count. Nova now abstains instead of returning that paragraph.

## Embedding provider architecture

`packages/knowledge/src/embeddingProvider.js`

The bundled `LocalSemanticEmbeddingProvider` produces 384-dimensional normalized vectors using token, phrase, character-ngram and semantic-concept features.

It implements the provider contract:

```js
provider.embed(text) -> numeric vector
```

This keeps the KnowledgeIndex independent from the embedding implementation.

A future neural provider (local sentence-transformer, hosted embeddings service, etc.) can implement the same contract. The Conversation, Commerce, Booking, Pricing and CRM engines do not need to change.

Important: the bundled v5.1 provider is a **local feature embedding provider**, not a transformer/neural embedding model. It gives Nova hybrid vector retrieval now without adding a hosted dependency. A neural embedding provider is a later swap, not an architectural rewrite.

## Question identity vs answerability

Nova now separates:

- `This is an informational question`
- `Tenant knowledge can answer it`

Those are different decisions.

If a customer asks:

`How many cleaners do you employ?`

and the tenant never supplied a cleaner count:

- the message is still classified as a knowledge question
- Nova does not pass it to a pending date field
- Nova does not list cleaning services
- Nova says the approved knowledge does not contain the answer
- an active workflow is preserved and resumed

## Operational boundary

Knowledge retrieval does not own operational requests such as:

- `Do you have shoes?`
- `What products do you sell?`
- `Book carpet cleaning`
- `Can I have a facial tomorrow?`
- `What subjects do you teach?`
- `How much for two hours?`

Those remain with Catalog, Offering, Booking, Pricing, Cleaning, Availability, etc.

Knowledge retrieval owns informational questions such as:

- service/coverage areas
- parking policy/responsibility
- pets
- heavy furniture policy
- workforce count questions
- general approved informational documents

## Markdown sections

Markdown headings and their section bodies are indexed together. An internal blank line no longer creates an isolated introductory chunk.

For example:

```md
## Service Area

SparkleCare currently serves:

- Johar Town
- DHA Lahore
- Gulberg
```

is retrieved as one complete section rather than returning only:
`SparkleCare currently serves:`.

## FAQ indexing

FAQ question and answer are now a single retrieval unit. Nova can use the question for matching while returning the answer, instead of accidentally returning the FAQ question itself.

## Workflow switching

While waiting for a date:

`Actually I want a maid for two hours only`

is interpreted as a service switch to `Hourly Cleaner Hire`, with its own duration/count/price state. It is not treated as merely changing the duration of Deep Cleaning.

## Debugging

Knowledge Manager retrieval results now expose:

- source
- source kind/title
- lexical score
- semantic/vector score
- hybrid fused score
- source priority
- matched passage
