# Sprint 2 Architecture — Assistant Engine

## Purpose
Sprint 2 adds a multilingual, tenant-grounded assistant to the Sprint 1 SaaS foundation.

## Processing order
1. Resolve tenant and conversation state.
2. Detect language locally.
3. Detect common intent locally.
4. Read approved tenant knowledge.
5. Produce a deterministic response when possible.
6. Use an LLM only for ambiguous requests.
7. Give the LLM only approved tenant facts.
8. Return a safe missing-information response when facts are absent.
9. Save language, intent, and response source in conversation state.

## Anti-hallucination boundary
The LLM is not a source of business truth. Tenant facts come from:
- `tenants/<tenantId>/profile.json`
- `tenants/<tenantId>/knowledge/business.json`
- `tenants/<tenantId>/knowledge/faqs.json`

The LLM may rewrite approved facts, but it may not add new services, locations, policies, prices, people, or contact details.

## Languages
- English
- Roman Urdu
- Urdu script

Critical language detection and common intents do not require an LLM.
