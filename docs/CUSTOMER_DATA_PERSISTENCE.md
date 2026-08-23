# Customer Data Persistence

## Current development build
Nova already models customer and transaction data behind repository interfaces, but the demo repositories are in-memory.

Examples:
- CRM customer profile: name, phone, email, language, tags, notes, custom fields.
- Commerce order: customer/delivery details, items, totals, payment method, status/timeline.
- Booking: selected services plus shared date/time/name/phone fields.
- Cleaning request: service, date/time, address and phone.

Because the current repositories are in-memory, this data is not durable across an application restart.

## Production roadmap
The repository boundary is intentional. Production persistence can replace the in-memory implementations with PostgreSQL (or another approved database) without putting SQL/database logic inside conversation capabilities.

Recommended durable model:
- customers
- customer_channels
- customer_addresses
- customer_preferences
- customer_activities
- carts / cart_items
- orders / order_items / order_status_history
- bookings / booking_items
- service_requests
- consent / retention metadata

Every record must be tenant-scoped. Sensitive contact data should use access controls, encryption where appropriate, audit logging, retention/deletion policies, and explicit consent rules required by the deployment.

The Knowledge Layer is separate: business knowledge describes the tenant's products/services/policies; customer/transaction persistence stores user-specific operational data.
