// Phase 4 Sprint 2 — Industry onboarding templates.
//
// A new business signing up self-serve picks an industry vertical; the template
// seeds their tenant with sensible default offerings, hours, FAQ, and booking
// config so the assistant is useful immediately — before they customize it in
// the dashboard. Templates are pure data; the signup service merges them with
// the owner's overrides.
//
// Each template is the `spec` shape that UniversalTenantOnboardingService.create
// consumes, with the owner-provided `name`, `description`, `contact`, etc.
// layered on top at signup time.

const INDUSTRY_TEMPLATES = {
  // Restaurant / café — ordering + menu Q&A + reservations.
  restaurant: {
    id: "restaurant",
    name: "Restaurant / Café",
    domain: "restaurant",
    defaultLanguage: "english",
    currency: "USD",
    offerings: [
      { id: "dine-in", name: "Dine-in reservation", type: "service", bookable: true, durationMinutes: 90, pricing: { amount: 0, currency: "USD" } },
      { id: "takeaway", name: "Takeaway order", type: "service", bookable: false },
    ],
    hours: "Mon-Sun, 11 AM - 11 PM",
    faqs: [
      { question: "What are your hours?", answer: "We are open daily from 11 AM to 11 PM." },
      { question: "Do you take reservations?", answer: "Yes, we accept reservations. Just tell me the date, time, and party size." },
    ],
    bookingMode: "reservation",
    bookingFields: ["subject", "date", "time", "partySize", "name", "phone"],
  },

  // Cleaning service — booking + service pricing (mirrors byt-cleaners-dubai).
  cleaning: {
    id: "cleaning",
    name: "Cleaning Service",
    domain: "cleaning",
    defaultLanguage: "english",
    currency: "USD",
    offerings: [
      { id: "deep-clean", name: "Deep cleaning", type: "service", bookable: true, durationMinutes: 240, pricing: { amount: 120, currency: "USD" } },
      { id: "standard-clean", name: "Standard cleaning", type: "service", bookable: true, durationMinutes: 120, pricing: { amount: 60, currency: "USD" } },
    ],
    hours: "Mon-Sat, 8 AM - 8 PM",
    faqs: [
      { question: "What areas do you cover?", answer: "Please tell us your location and we will confirm coverage." },
      { question: "Do you bring your own supplies?", answer: "Yes, our team arrives with all cleaning supplies and equipment." },
    ],
    bookingMode: "appointment",
    bookingFields: ["subject", "date", "time", "address", "name", "phone"],
  },

  // Salon / spa — appointment booking with service durations.
  salon: {
    id: "salon",
    name: "Salon / Spa",
    domain: "salon",
    defaultLanguage: "english",
    currency: "USD",
    offerings: [
      { id: "haircut", name: "Haircut & styling", type: "service", bookable: true, durationMinutes: 60, pricing: { amount: 45, currency: "USD" } },
      { id: "manicure", name: "Manicure", type: "service", bookable: true, durationMinutes: 45, pricing: { amount: 30, currency: "USD" } },
    ],
    hours: "Mon-Sat, 10 AM - 8 PM",
    faqs: [
      { question: "Do I need an appointment?", answer: "Appointments are recommended. Walk-ins are welcome subject to availability." },
    ],
    bookingMode: "appointment",
    bookingFields: ["subject", "date", "time", "name", "phone"],
  },

  // Retail / shop — product catalog + order taking.
  retail: {
    id: "retail",
    name: "Retail / Shop",
    domain: "retail",
    defaultLanguage: "english",
    currency: "USD",
    offerings: [
      { id: "general-product", name: "General product", type: "product", price: 0, currency: "USD" },
    ],
    hours: "Mon-Sun, 9 AM - 9 PM",
    faqs: [
      { question: "Do you deliver?", answer: "Yes, we offer delivery. Please ask about delivery to your area." },
    ],
    calendarEnabled: false,
  },
};

/** Get a template by id; returns a deep clone so callers can mutate safely. */
function getTemplate(templateId) {
  const t = INDUSTRY_TEMPLATES[templateId];
  return t ? JSON.parse(JSON.stringify(t)) : null;
}

/** List available templates for the signup UI. */
function listTemplates() {
  return Object.values(INDUSTRY_TEMPLATES).map((t) => ({ id: t.id, name: t.name, domain: t.domain }));
}

module.exports = { INDUSTRY_TEMPLATES, getTemplate, listTemplates };
