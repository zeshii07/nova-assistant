/**
 * v56.0 — Knowledge Retrieval Intelligence
 *
 * Entry point for the Phase 3 retrieval-intelligence packages:
 *   - IntentRouter      — classifies intent + entities, routes to sources
 *   - QueryRewriter     — normalizes + expands queries behind a dedicated interface
 *   - EvidenceValidator — produces the explicit evidence-validation result
 *
 * Spec reference: §4 Steps 2, 4, 6, 7
 *
 * Architecture rule (spec §2.3.1): "One retrieval implementation."
 * These components are consumed by KnowledgeService (the single authoritative
 * retrieval path). They do NOT introduce a second engine or a second cache.
 */

const { IntentRouter } = require('./intentRouter');
const { QueryRewriter } = require('./queryRewriter');
const { EvidenceValidator } = require('./evidenceValidator');

module.exports = { IntentRouter, QueryRewriter, EvidenceValidator };
