# Nova v7.4 — Roman Urdu + CRM Consistency

## Contextual acceptance
Soft phrases such as `ok`, `ok add kro`, `theek hai`, and `add kro` are accepted only when a product selection is already complete or an add-item flow is explicitly waiting for confirmation. They are not global confirmations.

## Commerce → CRM write-through
Validated checkout fields now update the tenant-scoped CRM profile immediately:
- name → CRM name
- phone → CRM phone
- preferred language → CRM preferredLanguage
- city/address/landmark/payment method → CRM customFields.lastDelivery

Final order creation performs a second synchronization pass and stores lastOrderId.

## Profile recall
`show my details`, `my details`, `show my profile`, and related phrases route to CRM. The profile response may include name, phone, preferred language, and last delivery information.

## State cleanup
Confirmed orders clear the active Catalog draft so a completed product-selection workflow cannot keep stealing later CRM/profile questions.

## Safety
CRM updates remain tenant-scoped. Soft acceptance is workflow-scoped to prevent accidental order confirmation.
