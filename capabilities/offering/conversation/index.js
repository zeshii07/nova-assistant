const {
  normalizeText,
  numberFromText,
} = require("../../../packages/conversation-intelligence/src/text");
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
    const offeringState = state?.capabilityState?.offering;
    const activeOrder = offeringState?.order;
    if (
      activeOrder?.status === "ready" &&
      /\b(confirm|yes|done|place it|order it|ok confirm)\b/.test(text)
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
    const broadCollectionQuestion =
      /\b(what|which)\s+(treatments?|classes|grades?|foods?|menu items?|programs?|services)\b/.test(
        text,
      );
    const explicit =
      !broadBusinessServices &&
      !broadCollectionQuestion &&
      /\b(do you offer|do you have|can i get|can i have|i want|i need|looking for|treatment|mujhe|mujhay|mujy|chahiye|chaheye|karwani|karwana|krani|krwana|lena|leni|khareedna|kharidna)\b|مجھے|چاہیے|کروان|خرید/.test(
        text,
      );
    if (resolved.type === "exact") {
      const orderTerms = [
        ...(cfg.orderTerms || []),
        "order",
        "buy",
        "purchase",
      ];
      const wantsOrder =
        cfg.actionMode === "order" &&
        resolved.record.orderable &&
        matchesAny(text, orderTerms);
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
    const shortOfferingPhrase =
      text.split(/\s+/).length <= 4 &&
      !/\b(what|which|why|how|where|when)\b/.test(text);
    if (
      (browse || interest || explicit || shortOfferingPhrase) &&
      (resolved.type === "fuzzy" || resolved.type === "suggestion")
    ) {
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
    if (browse || interest)
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
module.exports = { OfferingConversationAdapter };
