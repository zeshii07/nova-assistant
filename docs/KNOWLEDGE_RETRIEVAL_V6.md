# Nova Knowledge Retrieval v6

## Boundary
Catalog, Commerce, Booking, CRM, Pricing and Availability remain deterministic operational engines. Knowledge retrieval cannot mutate carts, bookings, CRM records, inventory or availability.

## Retrieval pipeline
User knowledge question → tenant-safe knowledge corpus → BM25 lexical retrieval → graph/vector retrieval → Reciprocal Rank Fusion (RRF) → evidence-aware reranking → KnowledgeService evidence gate → grounded/extractive answer → optional LLM wording using supplied evidence only.

## LightRAG boundary
`GraphVectorRetriever` is a local LightRAG-compatible provider boundary. It currently combines semantic vectors with lightweight entity/concept overlap without introducing a new runtime dependency. A production LightRAG service/adapter can later implement the same `search(query, options)` contract. RRF and deterministic business engines do not need to change.

This avoids pretending that an external LightRAG runtime is bundled when it is not, while establishing the architecture needed to plug one in.

## Safety invariants
- Operational truth stays in structured business systems.
- RAG answers knowledge questions; it does not confirm inventory, appointments, live availability, orders, payments, or CRM writes.
- Tenant isolation remains enforced by FileKnowledgeRepository.
- Internal instructions and customer-unsafe evidence remain excluded.
- Incomplete evidence abstains.
- LLM output is grounded only in retrieved tenant excerpts.
