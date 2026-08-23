# Nova Knowledge Layer v4.4

## Purpose
The Knowledge Layer separates **what a tenant knows** from **how Nova converses and performs actions**.

The universal engines must not be edited merely because a new business has different terminology, policies, services, products, FAQs, or descriptive information.

## Tenant structure

```text
tenants/<tenant-id>/
  profile.json
  knowledge/
    business.json
    faqs.json
    documents/
      *.txt
      *.md
      *.csv
      *.json
```

`business.json` contains structured business facts. `faqs.json` contains approved question/answer pairs. `documents/` contains additional tenant-approved knowledge.

v4.4 indexes JSON, TXT, Markdown and CSV locally. PDF/DOCX ingestion is intentionally a later ingestion-adapter concern: convert/extract those formats into normalized text/structured records before indexing rather than teaching conversation capabilities how to parse files.

## Retrieval pipeline

```text
customer message
 -> universal language/conversation intelligence
 -> specialized action capability when appropriate
 -> otherwise tenant KnowledgeService.retrieve()
 -> tenant-scoped KnowledgeIndex
 -> relevant approved excerpts
 -> optional LLM wording over ONLY those excerpts
 -> extractive answer when LLM is unavailable
```

The LLM is not the source of business truth. Retrieval supplies approved tenant facts; action engines still validate orders/bookings/CRM operations.

## What belongs where

Universal vocabulary:
- shared human language: greetings, requests, "other", common Roman-Urdu spellings, generic concepts.

Tenant knowledge:
- business description, policies, delivery rules, opening hours, FAQs, domain terminology, descriptive documents.

Offerings/catalog:
- actionable products/services, variants, prices, inventory, aliases and booking/order metadata.

Workflow configuration:
- fields required to complete a booking/order/request.

## Adding knowledge manually

1. Put structured facts in `knowledge/business.json`.
2. Put common Q&A in `knowledge/faqs.json`.
3. Put longer approved material in `knowledge/documents/*.md` or `.txt`.
4. Restart the development API, or call the repository cache clear hook in tooling/tests.
5. Ask natural questions. Nova retrieves only within the active tenant.

Never put another tenant's knowledge in the same tenant folder.
