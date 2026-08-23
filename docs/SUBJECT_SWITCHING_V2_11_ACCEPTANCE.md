# v2.11 Acceptance

Validated behaviors:
- Active Denim Jeans draft does not capture a later `white shirt` request.
- `white shirt do you have` does not infer quantity 2 from English `do`.
- `black shoes` after another product returns all matching Footwear options.
- `hello can i get black shoes from you` returns Running Shoes + Comfort Slides.
- `clear` removes the active product draft and active goal.
- `blck` remains a valid typo color follow-up for an active product.
- Restaurant and Salon semantic demo tenants load through the standard tenant/domain/assistant/replay path.

Quality gate:
- 155 JavaScript files passed syntax validation.
- 112 automated tests passed.
- 140 / 140 conversation corpus cases passed.
