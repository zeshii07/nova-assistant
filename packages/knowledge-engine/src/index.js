/**
 * v50.0 — Knowledge Engine
 *
 * Retrieves business-specific information for answering customer questions.
 * Wraps the existing knowledge package (embedding, hybrid retrieval) with
 * a business-aware interface that grounds answers in tenant-approved data.
 *
 * Architecture rule: Structured business data (prices, stock, availability,
 * opening hours) remains the source of truth. RAG retrieves descriptive
 * knowledge (FAQs, policies, service descriptions) — it does NOT replace
 * transactional database queries.
 *
 * Sources:
 *   - Business FAQs (tenants/{id}/knowledge/faqs.json)
 *   - Business info (tenants/{id}/knowledge/business.json)
 *   - Uploaded documents (tenants/{id}/knowledge/documents/)
 *   - Product/service catalogs (via catalogService, offeringService)
 *   - Business policies (via businessPolicyEngine)
 */

const fs = require('fs');
const path = require('path');

class KnowledgeEngine {
  constructor({ tenantsDir, logger = null } = {}) {
    this.tenantsDir = tenantsDir;
    this.logger = logger;
    this.cache = new Map(); // tenantId → { faqs, business, loaded }
  }

  /**
   * Retrieve knowledge for a customer question.
   *
   * @param {object} params - { tenant, message, state }
   * @returns {object} { answer, source, confidence, type }
   */
  async retrieve({ tenant, message, state }) {
    const text = String(message?.text || '').toLowerCase().trim();
    if (!text) return { answer: null, source: null, confidence: 0, type: 'none' };

    // Load tenant knowledge
    const knowledge = this._loadTenantKnowledge(tenant?.id);
    if (!knowledge) return { answer: null, source: null, confidence: 0, type: 'none' };

    // Try FAQ matching first (highest confidence)
    const faqResult = this._matchFAQ(text, knowledge.faqs);
    if (faqResult) return faqResult;

    // Try business info matching (hours, location, contact, policies)
    const bizResult = this._matchBusinessInfo(text, knowledge.business);
    if (bizResult) return bizResult;

    // Try document-based retrieval (if knowledge ingestion has indexed documents)
    // This is where the existing knowledge package's hybrid retrieval would be called.
    // For now, we return null — the assistant capability handles the fallback.

    return { answer: null, source: null, confidence: 0, type: 'none' };
  }

  /**
   * Match customer question against tenant FAQs.
   */
  _matchFAQ(text, faqs) {
    if (!faqs || !Array.isArray(faqs)) return null;

    let bestMatch = null;
    let bestScore = 0;

    for (const faq of faqs) {
      const question = String(faq.question || '').toLowerCase();
      const keywords = String(faq.keywords || '').toLowerCase().split(',').map(k => k.trim());

      // Direct keyword match
      let score = 0;
      for (const keyword of keywords) {
        if (keyword && text.includes(keyword)) {
          score += 10;
        }
      }

      // Word overlap
      const questionWords = question.split(/\s+/).filter(w => w.length > 3);
      for (const word of questionWords) {
        if (text.includes(word)) {
          score += 2;
        }
      }

      // Exact question substring match
      if (question && text.includes(question)) {
        score += 50;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = faq;
      }
    }

    if (bestMatch && bestScore >= 5) {
      return {
        answer: bestMatch.answer,
        source: 'faq',
        confidence: Math.min(bestScore / 20, 1),
        type: 'faq',
        question: bestMatch.question,
      };
    }

    return null;
  }

  /**
   * Match customer question against business info (hours, location, contact, policies).
   */
  _matchBusinessInfo(text, business) {
    if (!business) return null;

    // Check-in time (hotel) — check BEFORE generic hours to give a specific answer
    if (/\b(?:check.?in)\b/i.test(text)) {
      if (business.checkInTime) {
        return {
          answer: `Check-in time is ${business.checkInTime}`,
          source: 'business_info',
          confidence: 0.95,
          type: 'business_info',
        };
      }
    }

    // Check-out time (hotel)
    if (/\b(?:check.?out)\b/i.test(text)) {
      if (business.checkOutTime) {
        return {
          answer: `Check-out time is ${business.checkOutTime}`,
          source: 'business_info',
          confidence: 0.95,
          type: 'business_info',
        };
      }
    }

    // Hours
    if (/\b(?:hours?|open|close|timing|when.*open|what time)\b/i.test(text)) {
      const hours = business.checkInTime || business.hours || business.operatingHours;
      if (hours) {
        return {
          answer: `Our hours: ${typeof hours === 'string' ? hours : JSON.stringify(hours)}`,
          source: 'business_info',
          confidence: 0.95,
          type: 'business_hours',
        };
      }
    }

    // Location / address
    if (/\b(?:where|location|address|located|directions?)\b/i.test(text)) {
      if (business.address) {
        return {
          answer: `We are located at ${business.address}`,
          source: 'business_info',
          confidence: 0.95,
          type: 'business_location',
        };
      }
    }

    // Phone / contact
    if (/\b(?:phone|contact|call|number|reach)\b/i.test(text)) {
      if (business.phone) {
        return {
          answer: `You can reach us at ${business.phone}`,
          source: 'business_info',
          confidence: 0.95,
          type: 'business_contact',
        };
      }
    }

    // Email
    if (/\b(?:email|e-mail|mail)\b/i.test(text)) {
      if (business.email) {
        return {
          answer: `Email us at ${business.email}`,
          source: 'business_info',
          confidence: 0.95,
          type: 'business_contact',
        };
      }
    }

    // Cancellation policy
    if (/\b(?:cancel|cancellation|refund)\b/i.test(text)) {
      if (business.policies?.cancellation) {
        return {
          answer: `Cancellation policy: ${business.policies.cancellation}`,
          source: 'business_info',
          confidence: 0.95,
          type: 'business_policy',
        };
      }
    }

    return null;
  }

  /**
   * Load tenant knowledge (FAQs + business info) from disk.
   * Cached per-tenant for performance.
   */
  _loadTenantKnowledge(tenantId) {
    if (!tenantId) return null;
    if (this.cache.has(tenantId)) return this.cache.get(tenantId);

    const knowledge = { faqs: [], business: null, loaded: false };

    try {
      // Load FAQs
      const faqPath = path.join(this.tenantsDir, tenantId, 'knowledge', 'faqs.json');
      if (fs.existsSync(faqPath)) {
        const raw = JSON.parse(fs.readFileSync(faqPath, 'utf8'));
        knowledge.faqs = Array.isArray(raw) ? raw : (raw.faqs || []);
      }

      // Load business info
      const bizPath = path.join(this.tenantsDir, tenantId, 'knowledge', 'business.json');
      if (fs.existsSync(bizPath)) {
        knowledge.business = JSON.parse(fs.readFileSync(bizPath, 'utf8'));
      }

      knowledge.loaded = true;
    } catch (err) {
      this.logger?.warn?.('knowledge.load_failed', { tenantId, error: err.message });
    }

    this.cache.set(tenantId, knowledge);
    return knowledge;
  }

  /**
   * Clear cache for a specific tenant.
   */
  clearCache(tenantId) {
    if (tenantId) this.cache.delete(tenantId);
    else this.cache.clear();
  }
}

module.exports = { KnowledgeEngine };
