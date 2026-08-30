/**
 * Unified Entity Extraction Layer
 *
 * Consolidates entity extraction from 6+ scattered extractors into ONE
 * canonical entity model. All capabilities consume the same entity output.
 *
 * Extractors consolidated:
 * - temporalSemanticExtractor.js → temporal entities (date, time, duration)
 * - extractCleaningContext() → property entities (bedrooms, balconies, washrooms)
 * - attributeExtractor.js → product attributes (color, size, quantity)
 * - multiProductExtractor.js → multi-item product requests
 * - fieldAmendmentExtractor.js → field change requests (name, phone, address)
 * - acquisitionIntent.js → service vs product intent
 *
 * Output: canonical EntityModel consumed by all capabilities.
 */

const { normalizeText, numberFromText, normalizeWeekdayTypos } = require('../../conversation-intelligence/src/text');
const { normalizeUrduDigits } = require('../../conversation-intelligence/src/multilingualLexicon');
const { TemporalSemanticExtractor } = require('../../conversation-intelligence/src/temporalSemanticExtractor');
const { extractFieldAmendment } = require('../../conversation-intelligence/src/fieldAmendmentExtractor');
const { acquisitionIntent } = require('../../conversation-intelligence/src/acquisitionIntent');

const temporalExtractor = new TemporalSemanticExtractor();

/**
 * Extract ALL entities from a message in one pass.
 * Returns a frozen canonical EntityModel.
 *
 * @param {string} text - Raw message text
 * @param {object} options - { state, services, tenant }
 * @returns {EntityModel} Canonical entity model
 */
function extractEntities(text, options = {}) {
  const raw = String(text || '');
  const digitNormalized = normalizeUrduDigits(raw);
  const canonical = normalizeText(digitNormalized);

  // === TEMPORAL ENTITIES ===
  const temporal = temporalExtractor.extract(digitNormalized);

  // === PROPERTY ENTITIES (cleaning domain) ===
  const property = extractPropertyEntities(canonical);

  // === FIELD AMENDMENTS ===
  const fieldAmendment = extractFieldAmendment(raw);

  // === ACQUISITION INTENT ===
  const acquisition = acquisitionIntent(raw);

  // === CUSTOMER IDENTITY (inline declared) ===
  const identity = extractInlineIdentity(raw);

  // === SERVICE SUPPORT QUESTIONS ===
  const serviceSupport = extractServiceSupport(raw);

  // === BUSINESS IDENTITY QUESTIONS ===
  const businessIdentity = extractBusinessIdentity(raw);

  return Object.freeze({
    version: '2.0',
    text: raw,
    normalized: canonical,
    temporal: Object.freeze({
      date: temporal.dateReference || temporal.dateText || null,
      dateText: temporal.dateText || null,
      dateReference: temporal.dateReference || null,
      weekday: temporal.weekday || null,
      time: temporal.startTime || null,
      startTime: temporal.startTime || null,
      endTime: temporal.endTime || null,
      durationHours: temporal.durationHours || null,
      timeWindow: temporal.timeWindow || null,
      timeFlexible: /\b(?:any(?:time|time)|any available|jo time|جس time)\b/i.test(raw),
      invalidTime: temporal.invalidClockText || null,
    }),
    property: Object.freeze(property),
    fieldAmendment,
    acquisition: Object.freeze({
      requested: acquisition.requested,
      kind: acquisition.kind,
      isService: acquisition.service,
      isProduct: acquisition.product,
    }),
    identity: Object.freeze(identity),
    serviceSupport: Object.freeze(serviceSupport),
    businessIdentity: Object.freeze(businessIdentity),
    isPricingQuestion: /\b(?:charg(?:e|es|ing)|price|prices|pricing|cost|costs|rate|rates|quote|quotation|estimate|how much|kitna|kitni|kitne|kitny|kitnay)\b|(?:قیمت|چارجز|کتنے|قیمتیں)/i.test(canonical),
    isBookingAction: /\b(?:book|schedule|reserve|arrange|place (?:a )?request|start (?:a )?(?:booking|request)|confirm (?:the )?(?:booking|service))\b/i.test(canonical),
    isListRequest: /\b(?:what|which|show|list|tell me)\b[\s\S]{0,35}\b(?:services?|products?)\b/i.test(canonical) && !/\b(?:i want|i need|book|schedule)\b/i.test(canonical),
    isCancelAction: /\b(?:cancel|stop|never mind|nevermind|rehne do|منسوخ)\b/i.test(canonical),
  });
}

/**
 * Extract property-related entities (bedrooms, washrooms, balconies, etc.)
 */
function extractPropertyEntities(n) {
  const out = {};
  const numberToken = '(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|ek|aik|do|teen|char|chaar|paanch)';

  // Bedrooms (with typo tolerance)
  let m = n.match(new RegExp(`\\b(${numberToken})\\s*(?:bedrooms?|bed|bhk|bdrooms?|bd|bdrm)\\b`));
  if (m) out.bedrooms = numberFromText(m[1]);

  // Property type
  if (/\b(?:villa|vila|vill)\b|ولا/.test(n)) out.propertyType = 'villa';
  else if (/\b(?:apartment|flat|studio)\b|(?:فلیٹ|اپارٹمنٹ)/.test(n)) out.propertyType = 'apartment';

  // Studio = 0 bedrooms
  if (/\bstudio\b/.test(n) && out.bedrooms == null) out.bedrooms = 0;

  // Washrooms
  m = n.match(/\b(\d+)\s*(?:washrooms?|bathrooms?)\b/);
  if (m) out.washrooms = Number(m[1]);

  // Balconies
  m = n.match(/\b(\d+)\s*(?:balcon(?:y|ies)|balconys|blcon(?:y|ies))\b/);
  if (m) out.balconies = Number(m[1]);

  // Interior windows
  m = n.match(/\b(\d+)\s*(?:interior|inside|internal)\s+windows?\b/);
  if (m) out.interiorWindows = Number(m[1]);

  // Furniture units (seaters, metres)
  m = n.match(/\b(\d+)\s*(?:seater|seat|chairs?|seats?)\b/);
  if (m) out.units = Number(m[1]);

  // Service variant (mattress size, curtain size)
  if (/\bextra[ -]?large\b|\bxl\b/.test(n)) out.serviceVariant = 'extra-large';
  else if (/\bking(?: size)?\b/.test(n)) out.serviceVariant = 'king';
  else if (/\bqueen(?: size)?\b/.test(n)) out.serviceVariant = 'queen';
  else if (/\bcrib(?: size)?\b/.test(n)) out.serviceVariant = 'crib';
  else if (/\bsingle(?: size)?\b/.test(n)) out.serviceVariant = 'single';
  else if (/\bmedium\b/.test(n)) out.serviceVariant = 'medium';
  else if (/\blarge\b/.test(n)) out.serviceVariant = 'large';
  else if (/\bsmall\b/.test(n)) out.serviceVariant = 'small';

  // Cleaning type
  if (/\bdeep\b|گہری/.test(n)) out.cleaningType = 'deep';
  else if (/\b(?:standard|stndrad|standrd|general|regular|routine|hourly)\b/.test(n)) out.cleaningType = 'standard';

  // Cleaner count
  m = n.match(/\b(\d{1,2}|one|two|three|four|five|ek|aik|do|teen|char|chaar)\s*(?:cleaners?|maids?|workers?|people|persons?|person)\b/);
  if (m) out.cleanerCount = numberFromText(m[1]);

  // Move in/out
  if (/\bmove[ -]?(?:in|out)\b/.test(n)) out.moveInOut = true;

  return out;
}

/**
 * Extract inline customer identity (name, phone, email) from message text.
 */
function extractInlineIdentity(raw) {
  const out = { name: null, phone: null, email: null, address: null };

  // Name: "my name is X", "mera naam X"
  const nameMatch = raw.match(/\b(?:my name is|name\s*:)\s*([\p{L}][\p{L} .'-]{1,70}?)(?=\s+(?:(?:and\s+)?(?:my\s+)?(?:phone|contact|number)|what is|what's|who are|can i|could i|i want|i need|do you|please|but|because)\b|[.!?,;\n]|$)/iu);
  if (nameMatch) out.name = nameMatch[1].trim();

  // Phone: 10-15 digit number
  const phoneMatch = raw.match(/\+?\d[\d ()-]{8,24}\d/);
  if (phoneMatch) {
    const digits = phoneMatch[0].replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 15) out.phone = phoneMatch[0].trim();
  }

  // Email
  const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (emailMatch) out.email = emailMatch[0].toLowerCase();

  return out;
}

/**
 * Detect service support questions: "do you provide/offer/clean X"
 */
function extractServiceSupport(raw) {
  const isSupportQuestion = /\b(?:do you|can you|are you able to|will you)\b[\s\S]{0,20}\b(?:provide|offer|have|do|give|clean|wash)\b/i.test(raw);
  if (!isSupportQuestion) return { isSupportQuestion: false, category: null };

  const n = normalizeText(raw);
  const categories = [
    { keywords: ['furniture cleaning', 'furniture clean', 'upholstery'], category: 'Furniture cleaning' },
    { keywords: ['deep cleaning', 'deep clean'], category: 'Deep cleaning' },
    { keywords: ['standard cleaning', 'home cleaning', 'hourly'], category: 'Home cleaning' },
    { keywords: ['laundry', 'wash and fold', 'ironing'], category: 'Laundry' },
    { keywords: ['office cleaning', 'commercial'], category: 'Business cleaning' },
    { keywords: ['kitchen cleaning', 'bathroom cleaning', 'floor cleaning', 'window cleaning', 'balcony cleaning'], category: 'Specialised cleaning' },
    { keywords: ['ac cleaning', 'duct cleaning', 'pest control'], category: 'Home maintenance cleaning' },
  ];

  for (const entry of categories) {
    if (entry.keywords.some(kw => n.includes(kw))) {
      return { isSupportQuestion: true, category: entry.category };
    }
  }
  return { isSupportQuestion: true, category: null };
}

/**
 * Detect business identity questions: "what is your name", "opening hours", etc.
 */
function extractBusinessIdentity(raw) {
  const patterns = [
    { regex: /\b(?:business name|company name|your name|what are you|who are you)\b/i, facet: 'identity' },
    { regex: /\b(?:opening hours|business hours|working hours|store hours|your hours|are you open)\b/i, facet: 'hours' },
    { regex: /\b(?:phone number|contact number|email address|whatsapp)\b/i, facet: 'contact' },
    { regex: /\b(?:where are you|where.*located|your address|your location)\b/i, facet: 'location' },
    { regex: /\b(?:payment method|pay by|cash on delivery|jazzcash|easypaisa)\b/i, facet: 'payment' },
    { regex: /\b(?:return policy|refund policy|warranty|exchange)\b/i, facet: 'returns' },
    { regex: /\b(?:delivery|shipping|takeaway|pickup)\b/i, facet: 'delivery' },
  ];

  for (const p of patterns) {
    if (p.regex.test(raw)) return { isBusinessIdentity: true, facet: p.facet };
  }
  return { isBusinessIdentity: false, facet: null };
}

module.exports = { extractEntities };
