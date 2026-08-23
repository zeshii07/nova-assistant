# Goal Engine Acceptance

Required regression flow:

1. `can i get shoes` -> Catalog lists Running Shoes and Comfort Slides and starts a purchase goal.
2. `ok book my order` -> Nova asks which candidate product; it must not fall back to Assistant.
3. `confirm running shoes as my order` -> Running Shoes is selected; Commerce must not start early.
4. Product color, size and quantity are collected by Catalog.
5. `confirm my order` -> Commerce starts checkout only after required product details exist.
6. `cancel my order` -> active goal is cleared from any stage.

The shipped test suite and retail conversation corpus enforce these behaviors.
