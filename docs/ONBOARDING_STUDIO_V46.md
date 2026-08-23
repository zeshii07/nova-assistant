# Nova v4.6 — Developer Onboarding Studio

Open `http://localhost:3000/developer` and choose **Onboarding Studio**.

The studio is a developer/testing interface over the same `UniversalTenantOnboardingService` introduced in v4.5. It does not create a second onboarding architecture.

Workflow:
1. Enter business identity, hours, contact and location.
2. Add zero or more offerings. Each offering can be a service/bookable offering or a product/sellable item.
3. Add aliases/synonyms and operational attributes such as price, duration, inventory, sizes and colors.
4. Paste approved knowledge or load a JSON/TXT/Markdown/CSV file in the browser. The file is read locally by the browser and sent as normalized knowledge text.
5. Generate the tenant. Nova derives profile/capabilities, knowledge files, offering/booking configuration and/or product catalog.
6. Click **Open in Playground** and immediately stress-test the unseen business.

## Architecture

The Studio is intentionally only a UI over the onboarding and ingestion services:

`Onboarding Studio → onboarding API → UniversalTenantOnboardingService → tenant-native config → universal engines`

Later the customer-facing SaaS onboarding experience should reuse these same services while adding authentication, organization/team setup, database persistence, richer document ingestion, validation/review screens, deployment/channel setup and billing.
