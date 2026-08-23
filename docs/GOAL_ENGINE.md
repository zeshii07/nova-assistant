# Nova Goal Engine

Version: 2.3.0-alpha.1

## Purpose
The Goal Engine sits on top of Conversation Intelligence and remembers what the customer is trying to accomplish across multiple messages and capabilities.

A message intent is short-lived (for example `catalog.category_browse`). A goal is longer-lived (for example `purchase_product`).

## Core rule
**Intent explains the current message. Goal explains the customer's active objective.**

## Purchase goal lifecycle

```
browsing_category
  -> awaiting_product_selection
  -> product_selected
  -> collecting_product_details
  -> checkout
  -> completed
```

The Goal Engine stores candidate product IDs rather than assuming a product. If the user says "book my order" while multiple candidates are active, Catalog is asked to clarify the product. If the user names one candidate while saying "confirm", selection happens before Commerce is allowed to start.

## State shape

```json
{
  "context": {
    "goal": {
      "id": "GOAL-...",
      "type": "purchase_product",
      "status": "active",
      "stage": "awaiting_product_selection",
      "capabilityId": "catalog",
      "categoryId": "footwear",
      "candidateIds": ["P011", "P012"],
      "selectedProductId": null,
      "entities": {}
    },
    "goalHistory": []
  }
}
```

## Precedence
1. Global cancel/reset
2. Active workflow/correction
3. Goal continuity
4. Capability intent candidates
5. LLM interpretation fallback

## Capability handoff
The Goal Engine may override routing only to preserve a valid transition. It never invents business truth.

Example:

```
Can I get shoes?
-> Catalog category browse
-> Goal remembers Footwear candidates

Book my order
-> Goal sees multiple candidates
-> Catalog asks which product

Confirm Running Shoes
-> Goal selects Running Shoes
-> Catalog collects color/size/quantity

Confirm my order
-> Goal verifies product details complete
-> Commerce starts checkout
```

## Completion and cancellation
Completed Commerce orders and Cleaning requests close their active goal. Global cancel/reset clears the current goal. Goal history remains available for debugging.

## Developer Playground
The Decision panel contains a dedicated Goal card. Replays also include `intelligence.goal`, so each transition can be inspected message by message.

## Future capability contract
Future capabilities should expose enough structured intent/entities for the Goal Engine to derive domain goals without embedding domain vocabulary in core. Calendar can create appointment goals, Hotel can create reservation goals, and so on.
