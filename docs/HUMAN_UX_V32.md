# Nova v3.2 — Human UX & Input Validation

This release keeps the engines generic and moves business personality into tenant data/templates.

## Improvements
- Business-specific greetings for salon, clinic, cleaning, restaurant, and education tenants.
- Booking date input accepts `DD/MM/YYYY`, `DD-MM-YYYY`, `YYYY-MM-DD`, natural dates such as `12 August`, weekdays, `today`, and `tomorrow`.
- Bare day numbers remain ambiguous and are not silently accepted as a full date.
- Time input accepts `9 PM`, `9:00 PM`, and `21:00`.
- Prompts show examples for dates, times, phone numbers, and grades.
- Cleaning validates date and time separately and cannot save a date word as a time.
- Retail unavailable-product replies always display actual configured available products.
- Checkout pauses for new product browsing instead of consuming the message as city/address/name.
- Education understands `8th grade`, grade collection questions, offering suggestions, and `yes` confirmation.
- Fuzzy offering confirmation is stateful but never silently substitutes an unknown service.

## Universal principle
Client onboarding supplies business information, offerings, policies, booking configuration, and templates. Core engines remain shared.
