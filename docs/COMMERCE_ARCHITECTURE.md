# Commerce Capability Architecture

Commerce owns carts, checkout data, payment selection, orders, and order status. Catalog owns products, variants, availability, and prices. At order creation Commerce calls Catalog validation again and calculates totals from the official current price.

## Flow
Catalog selection → confirmation → cart → checkout fields → payment → catalog revalidation → order → CRM/memory/events.

## Current repository
Sprint development uses `InMemoryCommerceRepository`. PostgreSQL can replace it through the repository interface in a production milestone.
