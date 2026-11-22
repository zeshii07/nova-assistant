// Phase 2 Sprint 1 — T0 fast-path tier.
//
// T0 sits in front of the regex/adapter brain in ConversationIntelligenceEngine
// .analyze() and short-circuits the ~30-40% of turns that need no understanding
// at all: greetings, gratitude, bare yes/no, emoji-only, "back"/"help"/"human"
// (when no workflow is mid-slot). On a hit it returns the same `intelligence`
// shape the full pipeline would, but with nlu.used=false and
// semanticRouter.used=false so the heavy adapter iteration + ML + NLU is skipped
// entirely. Misses fall through to the existing pipeline untouched (NO rewrite).
//
// Design rules (from the Phase 2 architecture):
//   • Reuse, don't re-implement: greeting/gratitude come from SocialIntelligenceEngine
//     (already computed at analyze stage 3); yes/affirmation come from
//     confirmation.js isConfirmation/isWorkflowAcceptance; cancel/reset/human
//     come from GlobalCommandEngine (already computed at stage 11). T0 only adds
//     the classes those miss: bare "yes"/"no" (when no workflow is claiming them),
//     emoji-only, "back", "help", quick-reply payloads, and bare numbers.
//   • Never fire when a workflow is mid-slot (a bare "yes" inside booking-ready
//     or commerce-review MUST reach the owning capability to confirm).
//   • Never fire on multi-intent or compound messages.
//   • Never fire when globalCommand already fired (let GlobalCommandEngine own
//     cancel/reset/human — execution-engine short-circuits on those).
const { normalizeText } = require('./text');
const { isConfirmation, isWorkflowAcceptance } = require('./confirmation');

// Emoji-only (or emoji + trivial punctuation). Matches a string that, once
// whitespace/punctuation is stripped, is one or more emoji with no letters or
// digits. Covers common reaction emoji and thethumbs up/down.
const EMOJI_ONLY_RE = /^[\s\p{P}\p{S}]*[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}][\s\p{P}\p{S}\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]*$/u;

// Bare numbers (1, 2, 3) — only meaningful as T0 when a workflow is NOT asking
// for a number slot. When a workflow IS asking for a number (quantity, party
// size, bedrooms), the number must reach the owning capability. So T0 only
// fires for bare numbers when there is no pending workflow at all.
const BARE_NUMBER_RE = /^\d{1,4}$/;

// Bare "no" / denial (when not consumed by an active workflow's yes/no slot).
const DENIAL_RE = /^(no|nope|nah|na|nahi|nahin|nahi nahi|no no|nhi|نہیں|نہ)\b/i;

// "back" / "go back" / "previous" — navigate the conversation back. Net-new:
// GlobalCommandEngine does not cover this.
const BACK_RE = /^\s*(go back|back|previous|pichla|peeche|wapas|واپس)\s*$/i;

// "help" / "help me" — request assistance. Net-new.
const HELP_RE = /^\s*(help|help me|madad|madad karo|مدد)\s*$/i;

// Quick-reply payload convention: messages of the form "qr:<action>" or
// "<action>::<value>" emitted by a client quick-reply button. Net-new — the
// pipeline has no concept of payload input today.
const QUICK_REPLY_RE = /^qr:([a-z0-9_.-]+)(?::(.*))?$/i;

class T0Engine {
  /**
   * @param {object} input
   * @param {string} input.normalizedText  already-normalized lowercased text
   * @param {object} input.social           SocialIntelligenceEngine output
   * @param {object} input.messageFrame     UniversalMessageFrame output
   * @param {object|null} input.globalCommand  GlobalCommandEngine output
   * @param {object|null} input.pending     active workflow top-of-stack or null
   * @param {object} input.pendingValidation  ValidationEngine output for pending
   * @param {string} input.rawText          original message.text (for emoji)
   * @returns {{hit:true,kind:string,intent:string,confidence:number,entities:object,turnFrame:object}|{hit:false}}
   */
  detect({ normalizedText, social = {}, messageFrame = {}, globalCommand = null, pending = null, pendingValidation = { valid: true }, rawText = '' }) {
    // Guard 1: GlobalCommandEngine already claimed this turn.
    if (globalCommand) return { hit: false };
    // Guard 2: a workflow is mid-slot — the owning capability must get this.
    if (pending && pending.pendingField) {
      // Exception: if the pending field is a yes/no confirmation slot AND the
      // message is a bare affirmation, the workflowOwnershipEngine will claim
      // it in the full pipeline — so we still defer. No T0 here.
      return { hit: false };
    }
    // Guard 3: multi-intent messages need the full pipeline.
    if (messageFrame.hasMultipleIntents) return { hit: false };

    const text = normalizedText || normalizeText(rawText);
    const raw = String(rawText || '');

    // ── Class: emoji-only ────────────────────────────────────────────────
    // Detect on the RAW text (normalization strips emoji). No letters/digits
    // may be present, otherwise it's a real message with an emoji decoration.
    if (raw.trim() && EMOJI_ONLY_RE.test(raw.trim()) && !/\p{L}|\p{N}/u.test(raw.replace(EMOJI_ONLY_RE, ''))) {
      return this._hit('emoji', 'assistant.small_talk', 0.95, {}, { acknowledgement: true });
    }

    // ── Class: greeting (reuse social.greeting) ──────────────────────────
    // Only short-circuit a BARE greeting — a greeting followed by a real
    // request ("hello can i get black shoes", "hi i want to book a haircut")
    // is multi-intent and must reach the domain capability. Guard: the message
    // must be short AND contain no domain action/object keywords.
    if (social.greeting && text.length <= 24 && !text.match(/\b(book|order|price|cancel|menu|cart|reservation|appointment|get|want|need|looking|show|see|buy|purchase|clean|cleaning|shoes?|shirt|pants?|jeans|haircut|burger|biryani|room|slot|available|deliver|hours?|open|address|contact|phone|location|services?|products?|cost|how much|when|where|what|which|do you|can i|could|would|should)\b/)) {
      return this._hit('greeting', 'assistant.greet', 0.97, {}, {});
    }

    // ── Class: gratitude (reuse social.gratitude) ────────────────────────
    // Same guard: bare gratitude only, not "thanks but i also want...".
    if (social.gratitude && text.length <= 24 && !text.match(/\b(but|and|also|however|plus|need|want|get|show|book|order|price|cancel|menu|cart)\b/)) {
      return this._hit('gratitude', 'assistant.thanks', 0.95, {}, { acknowledgement: true });
    }

    // ── Class: goodbye (reuse social.goodbye) ────────────────────────────
    if (social.goodbye && text.length <= 20) {
      return this._hit('goodbye', 'assistant.goodbye', 0.95, {}, {});
    }

    // ── Class: bare affirmation ("yes"/"confirm"/"ok") with NO pending workflow ─
    // When there IS a pending workflow, isWorkflowAcceptance must reach the
    // owning capability. The pending guard above already returned, so here a
    // bare "yes" with nothing pending → assistant small acknowledgement.
    if (!pending && (isConfirmation(text) || isWorkflowAcceptance(text)) && text.length < 30) {
      return this._hit('affirmation', 'conversation.affirm', 0.9, { confirmation: true }, { acknowledgement: true });
    }

    // ── Class: bare denial ("no") with NO pending workflow ───────────────
    if (!pending && DENIAL_RE.test(text.trim())) {
      return this._hit('denial', 'conversation.deny', 0.9, { confirmation: false }, {});
    }

    // ── Class: "back" / "go back" / "previous" ───────────────────────────
    if (BACK_RE.test(text.trim())) {
      return this._hit('back', 'conversation.back', 0.95, {}, { navigation: 'back' });
    }

    // ── Class: "help" / "help me" / "madad" ──────────────────────────────
    if (HELP_RE.test(text.trim())) {
      return this._hit('help', 'assistant.help', 0.95, {}, { navigation: 'help' });
    }

    // ── Class: quick-reply payload ───────────────────────────────────────
    const qr = raw.trim().match(QUICK_REPLY_RE);
    if (qr) {
      const action = qr[1];
      const value = qr[2] || null;
      return this._hit('quickReply', `qr.${action}`, 0.99, { quickReply: { action, value } }, { payload: action });
    }

    // ── Class: bare number with NO pending workflow ──────────────────────
    // A bare "2" with nothing pending is ambiguous; the assistant can offer
    // options. With a pending workflow, the number must reach the capability
    // (already guarded above).
    if (!pending && BARE_NUMBER_RE.test(text.trim())) {
      return this._hit('number', 'assistant.clarify_bare_number', 0.85, { bareNumber: Number(text.trim()) }, { needs_clarification: 'bare_number' });
    }

    return { hit: false };
  }

  _hit(kind, intent, confidence, entities, turnFrameExtras) {
    return {
      hit: true,
      kind,
      intent,
      confidence,
      entities,
      turnFrame: {
        language: null, // filled by caller (ExperienceLanguageEngine.detect)
        acts: [{ intent, slots: entities, confidence }],
        negation: kind === 'denial',
        is_correction: false,
        refers_to: null,
        topic_switch: false,
        needs_clarification: turnFrameExtras.needs_clarification || null,
        ...turnFrameExtras,
      },
    };
  }
}

module.exports = { T0Engine };
