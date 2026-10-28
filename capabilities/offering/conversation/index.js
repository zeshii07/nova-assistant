const {
  normalizeText,
  numberFromText,
} = require("../../../packages/conversation-intelligence/src/text");
const {
  isConfirmation,
} = require("../../../packages/conversation-intelligence/src/confirmation");
class OfferingConversationAdapter {
  constructor() {
    this.capabilityId = "offering";
  }
  async analyze({
    tenant,
    message,
    state,
    services,
    normalizedText,
    domain,
    clauseSemantics,
  }) {
    const svc = services.offeringService;
    if (!svc) return null;
    const cfg = svc.getConfig(tenant.id);
    const items = svc.list(tenant.id);
    if (!items.length) return null;
    const text =
      normalizeText(clauseSemantics?.primaryText || message.text) ||
      normalizedText ||
      normalizeText(message.text);
    const fullText = normalizedText || normalizeText(message.text);
    // Delivery/takeaway are business-policy facts, not menu/offering browse intents.
    if (
      /\b(deliver|delivery|shipping|takeaway|take away|pickup|pick up|payment|pay|jazz\s*cash|easypaisa|easy\s*paisa|bank transfer|cash on delivery)\b/.test(
        text,
      ) &&
      /\b(do you|can i|can you|is there|provide|offer|accept|support)\b/.test(
        text,
      )
    )
      return null;
    // Location questions about a venue/campus belong to the business-info
    // assistant, even if "Campus Visit" is also a configured offering.
    if (
      /\b(where|location|address|kahan)\b/.test(text) &&
      /\b(campus|school|clinic|salon|restaurant|office)\b/.test(text)
    )
      return null;
    // v35.6: Out-of-scope queries (weather, sports, flights, product sales,
    // general knowledge) should NOT trigger offering browse. Return null so
    // they fall through to the assistant which handles them gracefully.
    if (/\b(?:weather|temperature|forecast|rain|sunny|cloudy)\b/i.test(text) ||
        /\b(?:flight|plane ticket|airline|airport|book.*flight|flight.*ticket)\b/i.test(text) ||
        /\b(?:cricket|football|soccer|match score|sports|game score|tennis|hockey)\b/i.test(text) ||
        /\b(?:sell.*phone|buy.*phone|mobile phone|laptop|computer|electronics|tv|television)\b/i.test(text) ||
        /\b(?:movie|film|cinema|netflix|youtube|tiktok|instagram)\b/i.test(text) ||
        /\b(?:politics|election|government|president|prime minister)\b/i.test(text) ||
        /\b(?:taxi|uber|careem|ride|cab)\b/i.test(text))
      return null;
    const offeringState = state?.capabilityState?.offering;
    const activeOrder = offeringState?.order;
    // v35.2 BUG FIX: After OFFERING_VIEWED, customer says "I'll take 2 of those"
    // or "I want 3 of this" — recognize as order start with quantity.
    // The previous logic only matched if the offering name was mentioned again,
    // which caused these natural continuations to fall through to the assistant.
    if (
      offeringState?.selectedOfferingId &&
      offeringState?.lastIntent === "offering.details" &&
      !activeOrder &&
      /\b(?:i'?ll|ill|i will|i want|i need|give me|let me get|let me take|take|get|want|need|order|buy|purchase)\b/.test(text) &&
      /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|a couple|some|few)\b/.test(text)
    ) {
      const qty = numberFromText(text) || 1;
      const item = svc.getById(tenant.id, offeringState.selectedOfferingId);
      if (item?.orderable && cfg.actionMode === "order") {
        return pack(
          "offering.order.start",
          0.999,
          {
            offeringId: item.id,
            subject: item.name,
            quantity: qty,
          },
          "viewed_offering_quantity_order",
          130,
        );
      }
    }
    // v35.2 BUG FIX: "Yes, confirm" or "confirm" after an order is ready.
    // The previous check used \b(confirm|yes|done|place it|order it|ok confirm)\b
    // which misses "yes, confirm" and "confirm order". Broaden the pattern.
    if (
      activeOrder?.status === "ready" &&
      (isConfirmation(message.text) ||
        /\b(confirm|yes|yeah|yep|done|place it|order it|ok confirm|confirm order|place the order|finalize|finalise|pakka|kar do|kardo|تصدیق)\b/i.test(text))
    )
      return pack(
        "offering.order.confirm",
        0.999,
        {
          offeringId: activeOrder.offeringId,
          quantity: activeOrder.quantity || 1,
        },
        "offering_order_confirm",
        130,
      );
    if (activeOrder?.status === "collecting_quantity") {
      const qty = numberFromText(text);
      if (qty)
        return pack(
          "offering.order.quantity",
          0.999,
          { offeringId: activeOrder.offeringId, quantity: qty },
          "offering_order_quantity",
          130,
        );
    }
    // v35.2 BUG FIX: After OFFERING_VIEWED, customer says "Tomorrow at 3pm" or
    // "tomorrow morning" — this is a booking intent for the just-viewed offering.
    // Return null so the booking adapter can take over. Set a hint state first.
    if (
      offeringState?.selectedOfferingId &&
      offeringState?.lastIntent === "offering.details" &&
      !activeOrder &&
      /\b(?:tomorrow|today|day after tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|next month)\b/i.test(text) &&
      (/\b(?:\d{1,2}\s*(?:am|pm)|\d{1,2}:\d{2}|morning|afternoon|evening|night|subah|shaam)\b/i.test(text) || /\bat\b/i.test(text))
    ) {
      // Don't handle here — let booking adapter pick this up
      return null;
    }
    if (
      offeringState?.suggestedOfferingId &&
      /^(yes|yeah|yep|correct|right|haan|han|ji|yes please)$/.test(text)
    )
      return pack(
        "offering.details",
        0.999,
        { offeringId: offeringState.suggestedOfferingId },
        "offering_suggestion_confirmed",
        120,
      );
    if (
      cfg.actionMode === "order" &&
      offeringState?.selectedOfferingId &&
      /\b(confirm this item|confirm item|order this|order it|ok confirm)\b/.test(
        text,
      )
    ) {
      const item = svc.getById(tenant.id, offeringState.selectedOfferingId);
      if (item?.orderable)
        return pack(
          "offering.order.confirm_selected",
          0.999,
          { offeringId: item.id, quantity: cfg.defaultQuantity || 1 },
          "generic_selected_offering_order",
          130,
        );
    }
    const activeBooking = state?.capabilityState?.booking;
    // Item edits inside a booking/reservation basket belong to Booking even if
    // the requested word is only a partial offering identity (for example,
    // "add chicken" when two chicken dishes exist).
    if (
      activeBooking &&
      /\b(add|include|also|too|another|aur|bhi)\b/.test(fullText)
    )
      return null;
    if (
      activeBooking?.status === "collecting" &&
      looksLikePendingValue(activeBooking.pendingField, message.text, text)
    )
      return null;
    const bookingCfg = services.bookingService?.getConfig?.(tenant.id) || {};
    const reservationTerms = [
      ...(bookingCfg.triggerTerms || []),
      ...(bookingCfg.defaultSubjectTerms || []),
    ];
    const menuFirst = isMenuFirst(fullText, clauseSemantics);
    const reservationRequest =
      reservationTerms.some((term) => text.includes(normalizeText(term))) &&
      (/\b(table|reserve|reservation|book)\b/.test(text) ||
        Boolean(extractPartySize(text)));
    if (reservationRequest && !menuFirst) return null;
    const filteredIds = matchingBrowseItems(text, items).map((x) => x.id);
    if (menuFirst)
      return pack(
        "offering.browse",
        0.9997,
        { filterOfferingIds: filteredIds },
        "conditional_menu_browse_first",
        130,
      );
    let resolved = svc.resolve(tenant.id, text);
    // v35.6: Multi-item order detection. When customer says "chicken biryani
    // and a beef burger" or "2 biryani + 1 burger", split on conjunctions and
    // try to resolve each part. If 2+ parts match offerings, start a multi-item
    // order instead of falling through to single-item or browse.
    if (cfg.actionMode === "order" && !activeOrder && !activeBooking) {
      const multiItems = extractMultiItemOrder(text, items, svc, tenant.id);
      if (multiItems && multiItems.length >= 2) {
        return pack(
          "offering.order.multi",
          0.998,
          { items: multiItems },
          "multi_item_order",
          135,
        );
      }
    }
    if (tenant.capabilities?.includes("catalog") && services.catalogService) {
      const catalogResult = await services.catalogService.search(
        tenant.id,
        text,
      );
      const catalogBrowse =
        /\b(products?|items?|goods|catalog|grocer(?:y|ies)|merchandise|stock)\b/.test(
          text,
        );
      if (catalogResult?.product || catalogBrowse) return null;
    }
    if (
      activeBooking &&
      resolved.type === "exact" &&
      /\b(also|too|another|add|include|bhi|aur)\b/.test(text)
    )
      return null;
    if (resolved.type === "none") {
      const compact = compactOfferingQuery(text);
      if (compact && compact !== text)
        resolved = svc.resolve(tenant.id, compact);
    }
    const browse = matchesAny(text, [
      ...(domain?.semantics?.offeringBrowseTerms || []),
      ...(cfg.browseTerms || []),
    ]);
    const interest = matchesAny(text, [
      ...(domain?.semantics?.offeringInterestTerms || []),
      ...(cfg.interestTerms || []),
    ]);
    const broadBusinessServices = /\b(what|which)\s+services\b/.test(text);
    // v36.2: Comprehensive menu/browse detection with typo tolerance.
    // Normalize text first to handle common typos + SMS shorthand.
    const normalizedBrowseText = text
      .replace(/\bwht\b/gi, 'what')
      .replace(/\bsomw\b/gi, 'some')
      .replace(/\bkinda\b/gi, 'kind of')
      .replace(/\bkindof\b/gi, 'kind of')
      .replace(/\bur\b/gi, 'your')
      .replace(/\bu\b/gi, 'you')
      .replace(/\bresturant\b/gi, 'restaurant')
      .replace(/\brestaurent\b/gi, 'restaurant')
      .replace(/\bkinda\b/gi, 'kind of')
      .replace(/\bpls\b/gi, 'please')
      .replace(/\bplz\b/gi, 'please')
      .replace(/\bhw\b/gi, 'how')
      .replace(/\bshw\b/gi, 'show')
      .replace(/\bordr\b/gi, 'order')
      .replace(/\bordr\b/gi, 'order')
      .replace(/\bavailabl\b/gi, 'available')
      .replace(/\bavail\b/gi, 'available');
    const broadCollectionQuestion =
      /\b(what|which)\s+(treatments?|classes|grades?|foods?|menu items?|programs?|services)\b/.test(
        normalizedBrowseText,
      ) || /\b(what(?:'s| is)?\s+(?:today'?s\s+)?specials?|today'?s\s+specials?|what(?:'s| is)?\s+on\s+(?:the\s+)?menu|any\s+specials?)\b/i.test(normalizedBrowseText)
      || /\b(?:what|which)\s+(?:items?|dishes?|food|options?)\s+(?:do you have|have you got|are available|can i (?:see|order|get))\b/i.test(normalizedBrowseText)
      || /\b(?:what|which)\s+(?:do you have|have you got|is (?:available|on (?:the )?menu))\b/i.test(normalizedBrowseText)
      || /\b(?:show|tell me|see)\s+(?:me\s+)?(?:the\s+|your\s+)?(?:full\s+|complete\s+)?(?:food\s+)?menu\b/i.test(normalizedBrowseText)
      || /\bwhat\s+items\s+do you have\b/i.test(normalizedBrowseText)
      // v36.2: "what kind of food" / "what type of food"
      || /\b(?:what|which)\s+(?:kind|type)\s+of\s+(?:food|dishes?|items?|menu)?/i.test(normalizedBrowseText)
      // v36.2: "what food do you have" / "what food you offer"
      || /\b(?:what|which)\s+(?:food|dishes?|items?)\s+(?:do you have|do you offer|have you got|are available|you offer|you have|can i (?:see|order|get))\b/i.test(normalizedBrowseText)
      // v36.2: "what do you offer" / "what can i order" / "what are you offering"
      || /\b(?:what|which)\s+(?:do you offer|can i order|can i get|can i see|can i have|are you offering|are (?:the )?available)\b/i.test(normalizedBrowseText)
      // v36.2: "i want to order some food" (with or without follow-up question)
      || /\b(?:i want|i need|i'?d like|i'?ll)\s+(?:to\s+)?(?:order|eat|get|have)\s+(?:some\s+|any\s+)?(?:food|something|dinner|lunch|breakfast)\b/i.test(normalizedBrowseText)
      // v36.2: "do you have any food" / "do you have food" / "do you any item"
      || /\bdo you\s+(?:have|offer)\s+(?:any\s+)?(?:food|dishes?|items?|menu|something)\b/i.test(normalizedBrowseText)
      // v36.2: "can i see what you are offering" / "can i see your menu"
      || /\bcan i see\s+(?:what\s+)?(?:you\s+)?(?:are\s+)?(?:offering|your menu|the menu|what.*available)\b/i.test(normalizedBrowseText)
      // v36.2: "i want to eat food from your restaurant" — intent to order food
      || /\b(?:i want|i need|i'?d like)\s+to\s+(?:eat|order|get|have)\s+(?:food|something|lunch|dinner)\b/i.test(normalizedBrowseText)
      // v36.2: "what items for eating" / "any item for eating"
      || /\b(?:any|some)\s+(?:items?|dishes?|food)\s+for\s+eating\b/i.test(normalizedBrowseText)
      // v36.2: Just "menu" or "show menu"
      || /^(?:show|see|tell me|view)?\s*(?:the\s+|your\s+)?menu\s*(?:please)?$/i.test(normalizedBrowseText.trim())
      // v36.2: "what's available" / "what is available"
      || /\bwhat(?:'s| is| are)?\s+available\b/i.test(normalizedBrowseText);
    const explicit =
      !broadBusinessServices &&
      !broadCollectionQuestion &&
      /\b(do you offer|do you have|can i get|can i have|i want|i need|looking for|treatment|mujhe|mujhay|mujy|chahiye|chaheye|karwani|karwana|krani|krwana|lena|leni|khareedna|kharidna)\b|مجھے|چاہیے|کروان|خرید/.test(
        text,
      );
    if (resolved.type === "exact") {
      // v35.5: Expanded order terms — customers use many natural phrases:
      // "send me 2", "give me one", "i'll take 2", "i want 2", "need 3",
      // "get me", "let me get", "i'd like", "bring me", "have", etc.
      const orderTerms = [
        ...(cfg.orderTerms || []),
        "order", "buy", "purchase",
        "send", "give", "get", "take", "bring", "have",
        "i want", "i need", "i'd like", "i will", "i'll",
        "let me get", "let me take", "let me have", "let me order",
        "can i get", "can i have", "can i order", "can you bring",
        "i would like", "i would love", "i wish to",
        "deliver", "ship", "pack", "prepare",
        "lena", "leni", "chahiye", "chaheye", "karwa", "krwa",
        "bhej", "bhejo", "de do", "de do", "laga do",
      ];
      // v35.5: Quantity + offering name is a strong order signal — even
      // without an explicit order verb. "2 chicken biryani" or "one burger"
      // is clearly an order.
      const hasQuantity = /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|a couple|some|few|ek|do|teen|char|paanch)\b/i.test(text);
      const wantsOrder =
        cfg.actionMode === "order" &&
        resolved.record.orderable &&
        (matchesAny(text, orderTerms) || (hasQuantity && !/\b(?:what|which|how|why|when|where|tell me|show me)\b/i.test(text)));
      if (wantsOrder)
        return pack(
          "offering.order.start",
          0.999,
          {
            offeringId: resolved.record.id,
            subject: resolved.record.name,
            quantity: numberFromText(text) || cfg.defaultQuantity || 1,
          },
          "generic_offering_order",
          130,
        );
      return pack(
        "offering.details",
        0.995,
        { offeringId: resolved.record.id, subject: resolved.record.name },
        "exact_offering",
        120,
      );
    }
    // v35.5: shortOfferingPhrase should NOT match greetings ("hi", "hello",
    // "salam"), acknowledgements ("ok", "yes", "thanks"), or single filler
    // words. Otherwise "hi" fuzzy-matches "Chicken Biryani" and we get
    // "I don't see that exact option. Did you mean Chicken Biryani?"
    const shortOfferingPhrase =
      text.split(/\s+/).length >= 2 && text.split(/\s+/).length <= 4 &&
      !/\b(what|which|why|how|where|when)\b/.test(text) &&
      !/^(hi|hello|hey|salam|salaam|assalam|ok|okay|yes|yeah|no|nope|thanks|thank you|thx|please|bye|goodbye|cool|nice|great|sure|alright|fine|k|kk|yo|sup|howdy)\b/i.test(text);
    if (
      (browse || interest || explicit || shortOfferingPhrase) &&
      (resolved.type === "fuzzy" || resolved.type === "suggestion")
    ) {
      // v35.5: If customer clearly wants to ORDER (has order verb + quantity),
      // start the order with the suggested offering instead of asking "did
      // you mean X?". "i will take 2 burgers" → "Beef Burger × 2" order.
      const orderTerms = ["order", "buy", "purchase", "send", "give", "get", "take", "bring", "have",
        "i want", "i need", "i'd like", "i will", "i'll", "let me get", "let me take",
        "can i get", "can i have", "i would like"];
      const hasQuantity = /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|a couple|some|few|ek|do|teen|char|paanch)\b/i.test(text);
      const wantsOrder = cfg.actionMode === "order" && resolved.record.orderable &&
        (matchesAny(text, orderTerms) || hasQuantity) &&
        !/\b(?:what|which|how|why|when|where|tell me|show me)\b/i.test(text);
      if (wantsOrder) {
        return pack(
          "offering.order.start",
          0.998,
          {
            offeringId: resolved.record.id,
            subject: resolved.record.name,
            quantity: numberFromText(text) || cfg.defaultQuantity || 1,
          },
          "fuzzy_offering_order",
          130,
        );
      }
      return pack(
        "offering.suggestion",
        0.994,
        {
          suggestedOfferingId: resolved.record.id,
          requestedSubject: cleanRequested(message.text),
        },
        "strict_fuzzy_suggestion",
        120,
      );
    }
    // Explicitly requested but not configured: never turn it into a generic list
    // that could imply the business offers it.
    if (explicit && resolved.type === "none") {
      return pack(
        "offering.unavailable",
        0.996,
        { requestedSubject: cleanRequested(message.text) },
        "strict_unavailable_offering",
        120,
      );
    }
    // v35.4: broad collection question (today's specials, what's on the menu)
    // should also trigger offering.browse
    if (browse || interest || broadCollectionQuestion)
      return pack(
        "offering.browse",
        0.95,
        { filterOfferingIds: filteredIds },
        "domain_offering_vocabulary",
        80,
      );
    return null;
  }
}
function compactOfferingQuery(text) {
  return normalizeText(text)
    .replace(
      /\b(ok|okay|please|sorry|show me|tell me|i want to see|i want|can i see|do you offer|do you have|fee information|fees?|price information|for grade|where to|where t|about|bout|mujhe|mujhay|mujy|main|mai|mein|chahiye|chaheye|chahye|karwani|karwana|krani|krwana|lena|leni|hai)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
}
function looksLikePendingValue(field, raw, text) {
  if (field === "phone")
    return /\d{7,15}/.test(String(raw).replace(/[^0-9+]/g, ""));
  if (field === "time")
    return (
      /\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/i.test(String(raw)) ||
      /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/.test(String(raw))
    );
  if (field === "date")
    return (
      /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
        String(raw),
      ) ||
      /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{4}\b/.test(String(raw)) ||
      /\b\d{4}-\d{1,2}-\d{1,2}\b/.test(String(raw))
    );
  if (field === "partySize")
    return /^\s*\d{1,2}\s*(people|persons|guests|seats)?\s*$/i.test(
      String(raw),
    );
  if (field === "grade")
    return /^\s*(grade|class)?\s*\d{1,2}\s*$/i.test(String(raw));
  if (field === "name")
    return (
      /^[\p{L} .'-]{2,60}$/u.test(String(raw).trim()) &&
      !/\b(do you|can i|i want|i need|service|offer|have)\b/i.test(String(raw))
    );
  return false;
}
function cleanRequested(v) {
  return (
    String(v || "")
      .replace(
        /\b(hello|hi|hey|do you offer|do you have|can i get|can i have|i want|i need|looking for|please)\b/gi,
        " ",
      )
      .replace(/[?.!,]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "that option"
  );
}
function isMenuFirst(text, clauses) {
  const conditional = (clauses?.secondaryIntents || []).some((x) =>
    /\b(reserve|reservation|book a table)\b/i.test(x.text),
  );
  return (
    conditional &&
    /\bfirst\b/.test(text) &&
    /\b(menu|dishes?|chicken|pasta|prices?)\b/.test(text)
  );
}
function extractPartySize(text) {
  const m = text.match(
    /\b(?:for\s+)?(\d+)\s*(?:people|persons|guests|seats)\b|\b(?:table|reservation)\s+for\s+(\d{1,2})\b/,
  );
  return m ? Number(m[1] || m[2]) : null;
}
function matchingBrowseItems(text, items) {
  const stop = new Set([
    "what",
    "which",
    "tell",
    "first",
    "have",
    "their",
    "prices",
    "price",
    "dishes",
    "dish",
    "menu",
    "food",
    "foods",
    "planning",
    "dinner",
    "people",
    "this",
    "sunday",
    "could",
    "please",
  ]);
  const tokens = normalizeText(text)
    .split(" ")
    .filter((x) => x.length >= 4 && !stop.has(x) && !/^\d+$/.test(x));
  const matched = (items || []).filter((item) => {
    const identity = normalizeText(
      [item.name, ...(item.aliases || []), item.category || ""].join(" "),
    );
    return tokens.some((token) => ` ${identity} `.includes(` ${token} `));
  });
  return matched.length ? matched : items;
}
function matchesAny(t, terms) {
  return terms.some((x) => t.includes(normalizeText(x)));
}
function pack(intent, confidence, entities, reason, priority = 80) {
  return {
    priority,
    entities,
    candidates: [{ intent, confidence, entities, reason }],
    vocabularyMatches: [],
  };
}
// v35.6: Multi-item order extraction.
// Splits text on conjunctions ("and", "also", "+", ",", "with", "plus", "aur")
// and tries to resolve each part as an offering. Returns array of
// {offeringId, subject, quantity} if 2+ items matched, null otherwise.
function extractMultiItemOrder(text, items, svc, tenantId) {
  if (!text || !items || !items.length) return null;
  // Normalize text — fix common typos before splitting
  const normalized = String(text)
    .replace(/\bchiken\b/gi, 'chicken')
    .replace(/\bbiriyani\b/gi, 'biryani')
    .replace(/\bburgers\b/gi, 'burger')
    .replace(/\bwnt\b/gi, 'want')
    .replace(/\bi wnt\b/gi, 'i want')
    // v35.7: Strip "do" used as verb ("do biryani") to avoid false quantity=2
    .replace(/\bdo\s+(biryani|burger|pasta|chicken|beef|food|order)\b/gi, '$1')
    .replace(/\bplease\s+quickly\b/gi, '')
    .replace(/\bquickly\b/gi, '');
  // Split on conjunctions
  const parts = normalized
    .split(/\s+(?:and|also|plus|with|aur|bhi|\+)\s+|,\s*/i)
    .map(p => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const matched = [];
  for (const part of parts) {
    // Skip pure numbers or quantity-only fragments
    if (/^\d+$/.test(part) || /^(one|two|three|four|five|six|seven|eight|nine|ten)$/i.test(part)) continue;
    // Strip order verbs / filler words — v35.7: also strip "do" as verb
    const cleaned = part
      .replace(/\b(?:i want|i need|i'd like|i will|i'll|let me|can i|please|ok|okay|a|an|the|some|of|to|order|eat|get|have|take|deliver|send|give|bring|pack|do|make|karwana|krwana|chahiye|chaheye|quickly|now|please)\b/gi, '')
      .replace(/\d+\s*(?:x|×)?\s*/g, '')
      .replace(/\b(?:one|two|three|four|five|six|seven|eight|nine|ten|ek|teen|char|paanch)\b/gi, '')  // v35.7: removed "do" — handled above
      .trim();
    if (!cleaned || cleaned.length < 3) continue;
    const result = svc.resolve(tenantId, cleaned);
    if (result && result.record && (result.type === 'exact' || result.type === 'fuzzy' || result.type === 'suggestion')) {
      const qty = numberFromText(part) || 1;
      matched.push({
        offeringId: result.record.id,
        subject: result.record.name,
        quantity: qty,
      });
    }
  }
  return matched.length >= 2 ? matched : null;
}
module.exports = { OfferingConversationAdapter };
