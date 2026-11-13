/**
 * v57.0 — Knowledge Answer Intelligence
 *
 * Phase 4 entry point. Replaces the 8 hardcoded cleaning-domain groundedAnswer
 * templates with a domain-independent grounded answer composer, claim-level
 * evidence references, response validation, and explicit answer/clarify/escalate/
 * refuse decisions.
 *
 * Spec reference: §12 Answer composer and response validator
 *
 * Components:
 *   - AnswerComposer    — composes a natural grounded answer from evidence
 *   - ResponseValidator — verifies every factual claim against cited evidence
 *   - DecisionEngine    — maps evidence-validation result to a decision outcome
 *   - CitationBuilder   — attaches internal evidence IDs to factual claims
 *   - AbstentionHandler — wraps the existing missingKnowledge() pattern + clarification
 *
 * Architecture rule (spec §12): "Critical transactional facts should bypass
 * free-form generation and be inserted from the trusted structured system."
 */

const { AnswerComposer } = require('./answerComposer');
const { ResponseValidator } = require('./responseValidator');
const { DecisionEngine } = require('./decisionEngine');
const { CitationBuilder } = require('./citationBuilder');
const { AbstentionHandler } = require('./abstentionHandler');

module.exports = { AnswerComposer, ResponseValidator, DecisionEngine, CitationBuilder, AbstentionHandler };
