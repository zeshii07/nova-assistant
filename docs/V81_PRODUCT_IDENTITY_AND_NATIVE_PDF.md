# Nova v8.1 — Product Identity & Native PDF Stabilization

## Product identity invariant

A fresh explicit product/category request always outranks stale Catalog/Goal state.

Example:

1. `do you have shoes`
2. Nova lists Running Shoes and Comfort Slides.
3. `i want to buy a large shirt`

Nova must switch to the Shirts family. The previous Footwear goal cannot restrict the new request to shoe candidates.

## Corrections and negation

Negative subject corrections are interpreted before product scoring.

`not shoes but i want shirts`

The negated `shoes` clause is not allowed to contribute positive product-match score. Nova resolves the positive clause (`i want shirts`) and resets the stale goal.

## Goal Engine boundary

The Goal Engine may:
- preserve candidate context for ambiguous follow-ups;
- request selection when the customer says `book my order` after browsing a category;
- preserve incomplete product details.

The Goal Engine may NOT:
- veto a fresh explicit Catalog subject;
- force a newly requested shirt into a previous Footwear candidate set;
- keep an old selected product after an explicit subject correction.

## Native PDF ingestion

Nova no longer requires Poppler/pdftotext for ordinary text PDFs.

The bundled parser supports common text-PDF content streams including:
- uncompressed text streams;
- FlateDecode;
- ASCII85Decode + FlateDecode;
- ASCIIHexDecode;
- RunLengthDecode;
- PDF literal strings;
- PDF hex strings;
- `Tj` and `TJ` text operators.

Original PDFs remain preserved under the tenant knowledge originals directory; extracted text enters the standard knowledge pipeline.

Image-only/scanned PDFs are rejected with a clear message that OCR is required. Nova does not hallucinate text from images.

## Regression cases

The release includes exact regressions for:
- native ingestion of the SparkleCare and Demo Store v8 test PDFs;
- Shoes browse → Large Shirt subject switch;
- `not shoes but i want shirts`;
- frustrated explicit replacement request;
- existing goal-flow preservation for `ok book my order`.

## Release gates

- v8.1 blocker tests: 5/5
- complete automated suite: 317/317
- conversation corpus: 156/156
- JavaScript syntax: 250 files
- state-safety audit: pass
