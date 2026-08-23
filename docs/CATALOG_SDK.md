# Catalog SDK

Public concepts:

- `CatalogPort`: repository abstraction.
- `ProductRecord`: validated immutable product truth.
- `SearchResult`: stable deterministic search response.

Capability-scoped service methods:

- `search(query)`
- `listProducts()`
- `listCategories()`
- `getProductById(productId)`
- `validateSelection(selection)`

Prices and variants must always be read from this service. No capability may calculate official catalog truth from LLM text.
