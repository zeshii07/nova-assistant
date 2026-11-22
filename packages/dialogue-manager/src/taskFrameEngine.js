// Phase 2 Sprint 2 — Data-driven Task Frame Engine.
//
// Replaces the per-capability slot-collection re-implementation (R8: "each
// capability re-implements parsing — salon works, cleaning doesn't"). Each
// task type (booking, cleaning, order, quote, return) is defined as DATA:
// slots with validators, prompts, extractors, and dependencies. ONE engine
// walks the slots, validates, re-prompts, accepts corrections, and buffers
// slots volunteered early (e.g. "book cleaning saturday 10am name Ali phone X"
// should keep date/time/name/phone even when the service still needs picking).
//
// The engine REUSES (does not re-implement):
//   • UniversalEngagementEngine.parseField / .prompt / .nextMissing / .normalizeState
//     for the canonical validators + re-prompt templates used by booking+cleaning.
//   • confirmation.js isConfirmation / isWorkflowAcceptance for the confirm step.
//   • The per-capability one-shot extractors (booking's extract(), cleaning's
//     extractTimeEntities + extractCleaningContext) via the frame's `extractors`
//     field — the frame engine calls them to pull slots from the raw message.
//
// Design rules (from the report §6.3):
//   • Frames per task defined as data (slots, validators, prompts).
//   • Global commands at any time: cancel, back, start over, human, repeat
//     (owned by GlobalCommandEngine; the frame engine defers).
//   • Interruptions: answer the side question, then resume the frame.
//   • Corrections of any filled slot at any step ("actually 6pm", "make it 5").
//   • Repair policy: attempt 1 re-ask with example → attempt 2 show options →
//     attempt 3 hand off.
//   • Slot buffering: if the user volunteers later slots early, keep them.
//
// This engine does NOT replace the existing booking/cleaning executors in one
// sprint — that would break hundreds of tests. Instead it provides:
//   (1) A shared slot-buffering helper that the cleaning generic-fall-through
//       path calls so date/time/name/phone survive a service-disambiguation
//       step (the R8 fix).
//   (2) A `walkSlots` primitive + `validateSlot` + `repairPrompt` that future
//       sprints wire into each capability's execute path, frame by frame.
//   (3) Frame DEFINITIONS for booking + cleaning (the two sharing the
//       engagement engine), so the slot order, validators, and prompts live
//       in ONE place as data — not duplicated across capabilities.

const { isConfirmation, isWorkflowAcceptance } = require('../../conversation-intelligence/src/confirmation');

// Repair policy thresholds (report §6.3 + §5: "Two failed attempts at the same
// slot → offer choices, then hand off").
const MAX_REASKS_BEFORE_OPTIONS = 1; // after 1 failed attempt, show options
const MAX_REASKS_BEFORE_HANDOFF = 3; // after 3 failed attempts, hand off

/**
 * A single task frame definition.
 *
 * @typedef {object} TaskFrame
 * @property {string} type             - 'booking' | 'cleaning' | 'order' | 'quote' | 'return'
 * @property {string} statePath        - where to write, e.g. 'capabilityState.booking'
 * @property {'slots'|'flat'|'mode'|'catalog'} stateShape - how to serialize
 * @property {string|null} statusField - 'status' | 'step' | 'mode' | null
 * @property {object} slots            - ordered slot definitions
 * @property {function} requiredFields - (config) => string[] slot walk order
 * @property {object} confirmStep      - { prompt, intent, acceptance: 'isConfirmation' }
 * @property {function|null} oneShot   - (text, raw, config, engagement, temporal) => extracted slots
 */

const BOOKING_FRAME = {
  type: 'booking',
  statePath: 'capabilityState.booking',
  stateShape: 'slots',
  statusField: 'status',
  readyValue: 'ready',
  confirmValue: 'confirmation',
  collectingValue: 'collecting',
  // Slot order matches UniversalEngagementEngine + booking's requiredFields().
  // subject is filtered out (stored on items[], not fields).
  slots: ['date', 'time', 'name', 'phone'],
  optionalSlots: ['email', 'partySize', 'grade', 'durationHours'],
  requiredFields: (config) => (config.requiredFields || ['date', 'time', 'name', 'phone']).filter((x) => x !== 'subject'),
  confirmStep: { intent: 'booking.confirm', acceptance: 'isConfirmation' },
  // The booking one-shot extractor lives in capabilities/booking/conversation/index.js:394
  // (not imported here to avoid a cycle). It is invoked by the capability's
  // own execute path; the frame engine's role is to define the slot order +
  // validators so they are queryable from one place.
  oneShot: null,
  ownershipPredicate: (state) => state?.booking?.status === 'ready',
};

const CLEANING_FRAME = {
  type: 'cleaning',
  statePath: 'capabilityState.cleaning',
  stateShape: 'flat',
  statusField: 'step',
  readyValue: 'confirm',
  confirmValue: 'confirm',
  collectingValue: null, // cleaning uses the step name itself
  // Slot walk order matches nextMissingStep() in capabilities/cleaning/src/index.js:1919
  // (pricingFirst branch handled separately by the cleaning executor).
  slots: ['date', 'time', 'address', 'name', 'phone'],
  optionalSlots: ['email', 'durationHours', 'cleanerCount', 'propertyType', 'bedrooms', 'units', 'serviceVariant'],
  requiredFields: () => ['date', 'time', 'address', 'name', 'phone'],
  confirmStep: { intent: 'cleaning.workflow_input', acceptance: 'isConfirmation' },
  oneShot: null,
  ownershipPredicate: (state) => state?.cleaning?.step === 'confirm',
};

const FRAMES = {
  booking: BOOKING_FRAME,
  cleaning: CLEANING_FRAME,
  // order, quote, return frames are reserved for future sprints.
};

class TaskFrameEngine {
  constructor({ engagementEngine = null, logger = null } = {}) {
    this.engagement = engagementEngine;
    this.logger = logger;
    this.frames = FRAMES;
  }

  /**
   * Look up a frame definition by task type.
   * @param {string} type
   * @returns {TaskFrame|null}
   */
  get(type) {
    return this.frames[type] || null;
  }

  /**
   * Walk the required slots and return the first missing one, or null if ready.
   * Delegates to the engagement engine's nextMissing (the canonical walk used
   * by booking) so the frame engine and the existing executors agree.
   *
   * @param {string} type
   * @param {object} fields - the filled slots so far
   * @param {object} config - tenant config (may override requiredFields)
   * @returns {string|null} the next missing field name, or null if ready
   */
  nextMissing(type, fields, config = {}) {
    const frame = this.frames[type];
    if (!frame) return null;
    const required = frame.requiredFields(config);
    if (this.engagement?.nextMissing) {
      return this.engagement.nextMissing(required, fields || {});
    }
    // Fallback if no engagement engine injected (defensive).
    for (const field of required) {
      const v = fields?.[field];
      if (v == null || v === '') return field;
    }
    return null;
  }

  /**
   * Validate a single slot value. Delegates to the engagement engine's
   * parseField (the canonical validator used by booking + cleaning), so the
   * frame engine and the executors agree on what counts as a valid date/time/
   * phone/name.
   *
   * @param {string} field - 'date' | 'time' | 'name' | 'phone' | 'email' | ...
   * @param {string} raw - the raw user input
   * @param {object} options - { allowPast, minDigits, maxDigits, ... }
   * @returns {{valid:boolean, value?:any, field?:string, message?:string}}
   */
  validateSlot(field, raw, options = {}) {
    if (this.engagement?.parseField) {
      return this.engagement.parseField(field, raw, options);
    }
    // Fallback: non-empty = valid.
    const value = String(raw || '').trim();
    return value ? { valid: true, value } : { valid: false, message: 'Value is required.' };
  }

  /**
   * Get the re-prompt for a slot. Delegates to the engagement engine's prompt
   * (canonical templates, overridable per-tenant via config.prompts).
   *
   * @param {string} field
   * @param {object} config
   * @param {string} language
   * @returns {string}
   */
  promptFor(field, config = {}, language = 'english') {
    if (this.engagement?.prompt) {
      return this.engagement.prompt(field, config, language);
    }
    return `Please provide ${field}.`;
  }

  /**
   * Repair policy (report §6.3 + §5). After N failed attempts at the same slot:
   *   1 fail  → re-ask with an example (default engagement prompt).
   *   2 fails → show options / hand off (caller decides).
   *   3 fails → hand off to a human.
   *
   * @param {string} field
   * @param {number} attempts - prior failed attempts for this slot
   * @param {object} config
   * @param {string} language
   * @returns {{action:'reask'|'offer_options'|'handoff', prompt:string}}
   */
  repairPrompt(field, attempts = 0, config = {}, language = 'english') {
    if (attempts >= MAX_REASKS_BEFORE_HANDOFF) {
      return {
        action: 'handoff',
        prompt: language === 'roman_urdu'
          ? 'Mujhe is field mein madad chahiye. Main aapko hamare team member se connect kar deta hoon.'
          : 'I am having trouble with this. Let me connect you with a team member who can help.',
      };
    }
    if (attempts > MAX_REASKS_BEFORE_OPTIONS) {
      return {
        action: 'offer_options',
        prompt: language === 'roman_urdu'
          ? `Main ${field} samajh nahi saka. Kya aap options mein se choose karna chahenge?`
          : `I could not understand ${field}. Would you like to choose from options?`,
      };
    }
    return { action: 'reask', prompt: this.promptFor(field, config, language) };
  }

  /**
   * Detect whether the user is correcting a previously-filled slot.
   *   "actually 6pm", "make it 5", "change the date to friday", "naam Ahmed rakhein"
   *
   * @param {string} text
   * @param {object} filledFields - the slots already filled
   * @returns {{isCorrection:boolean, field?:string, raw?:string}}
   */
  detectCorrection(text, filledFields = {}) {
    const t = String(text || '');
    // Correction cues (English + Roman Urdu).
    const correctionCue = /\b(?:actually|change|make it|update|edit|instead|nahi\s|nahin\s|balkay|balki)\b/i;
    if (!correctionCue.test(t)) return { isCorrection: false };
    // Which field is being corrected? Check each filled field's extractor.
    for (const field of Object.keys(filledFields)) {
      if (filledFields[field] == null) continue;
      const parsed = this.validateSlot(field, t, { allowPast: true });
      if (parsed?.valid) {
        return { isCorrection: true, field, raw: t, value: parsed.value };
      }
    }
    return { isCorrection: true, field: null, raw: t };
  }

  /**
   * SLOT BUFFERING (the R8 fix). Given a raw message that may contain MULTIPLE
   * slots volunteered at once (date + time + name + phone), extract every slot
   * that is valid, and return them as a partial patch. This is what the
   * cleaning generic-fall-through path calls so date/time/name/phone survive
   * a service-disambiguation step instead of being dropped.
   *
   * @param {string} type - frame type ('booking' | 'cleaning')
   * @param {string} raw - the raw user message
   * @param {object} options - { engagement, config, allowPast }
   * @returns {{buffered:object, invalid:string[]}} buffered slots + invalid field names
   */
  bufferSlots(type, raw, options = {}) {
    const frame = this.frames[type];
    if (!frame) return { buffered: {}, invalid: [] };
    const engagement = options.engagement || this.engagement;
    const text = String(raw || '');
    const buffered = {};
    const invalid = [];
    const slotOptions = { allowPast: options.allowPast ?? false };

    // date
    if (engagement?.parseField) {
      const d = engagement.parseField('date', text, slotOptions);
      if (d?.valid) buffered.date = d.value;
      else if (this._hasDateSignal(text) && !d?.valid) invalid.push('date');

      // time
      const tm = engagement.parseField('time', text);
      if (tm?.valid) buffered.time = tm.value;
      else if (this._hasTimeSignal(text) && !tm?.valid) invalid.push('time');

      // email (cue-free regex — works on the whole message)
      const em = engagement.parseField('email', text);
      if (em?.valid) buffered.email = em.value;

      // address (only if there's an address cue, to avoid false positives)
      if (/\b(?:address|house|street|building|flat|apartment|block|road)\b/i.test(text)) {
        const ad = engagement.parseField('address', text);
        if (ad?.valid) buffered.address = ad.value;
      }
    }

    // Name + phone: use the proven booking-extractor regexes (cue-based)
    // instead of engagement.parseDeclaredName / parseField('phone', <whole msg>),
    // which validate the WHOLE message and reject compound booking requests.
    // These regexes are the same ones capabilities/booking/conversation/index.js:394
    // uses for one-shot extraction.
    {
      const named = text.match(/\b(?:for\s+the\s+name|under\s+the\s+name|name\s+is|my\s+name\s+is)\s+([\p{L}][\p{L} .'-]{1,60}?)(?=\s+(?:on|for|at|date|time|and|my phone|phone|number|contact)\b|[,.!?;]|$)/iu);
      if (named) {
        // Validate the captured name via engagement.parseField('name', <just the name>)
        if (engagement?.parseField) {
          const nm = engagement.parseField('name', named[1].trim());
          if (nm?.valid) buffered.name = nm.value;
        } else {
          buffered.name = named[1].trim();
        }
      }
      const phone = text.match(/(?:phone|number|contact)(?:\s+(?:is|=))?\s*(\+?\d[\d\s-]{8,18}\d)\b/i);
      if (phone) {
        if (engagement?.parseField) {
          const ph = engagement.parseField('phone', phone[1].trim(), { minDigits: 10, maxDigits: 15 });
          if (ph?.valid) buffered.phone = ph.value;
        } else {
          buffered.phone = phone[1].trim();
        }
      }
    }
    return { buffered, invalid };
  }

  /**
   * Check if a message has a date signal (so bufferSlots can flag invalid dates).
   */
  _hasDateSignal(text) {
    return /\b(?:today|tomorrow|day after tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|kal|aaj|parso|parsun|آج|کل|پرسوں)\b/i.test(text)
      || /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/.test(text);
  }

  _hasTimeSignal(text) {
    return /\b\d{1,2}\s*(?:am|pm|a\.?m\.?|p\.?m\.?)\b/i.test(text)
      || /\b\d{1,2}:\d{2}\b/.test(text)
      || /\b(?:morning|afternoon|evening|night|subah|shaam|dopahar|raat)\b/i.test(text);
  }

  /**
   * Confirm-step check. Returns true if the message is a workflow confirmation
   * (yes/confirm/ok/theek hai) — delegating to the canonical confirmation helpers.
   */
  isConfirmation(text) {
    return isConfirmation(text) || isWorkflowAcceptance(text);
  }

  /**
   * Serialize a frame's filled slots into the capability's state shape.
   * This is the bridge between the frame engine's generic slot dict and the
   * per-capability state shape (booking.slots vs cleaning.flat vs commerce.mode).
   *
   * @param {string} type
   * @param {object} fields - the filled slots
   * @param {object} previous - prior capability state (to merge into)
   * @returns {object} the capabilityState patch
   */
  toStatePatch(type, fields, previous = {}) {
    const frame = this.frames[type];
    if (!frame) return previous;
    if (frame.stateShape === 'slots') {
      return { ...previous, slots: { ...(previous.slots || {}), ...fields } };
    }
    if (frame.stateShape === 'flat') {
      return { ...previous, ...fields };
    }
    // mode / catalog shapes are handled by the capability itself.
    return previous;
  }
}

module.exports = { TaskFrameEngine, FRAMES, BOOKING_FRAME, CLEANING_FRAME };
