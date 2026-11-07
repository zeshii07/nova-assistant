/**
 * v53.0 — Regression Evaluator
 *
 * Automated regression testing that compares NLU and output accuracy
 * across versions. Run this whenever the engine is updated to catch
 * regressions before they reach production.
 *
 * Features:
 *   - Runs the variation corpus against the current engine
 *   - Compares results against a known-good baseline
 *   - Generates a diff report with pass/fail per case
 *   - Tracks accuracy trends across versions
 *   - Identifies new failures (regressions) and new passes (improvements)
 */

/**
 * Regression Evaluator
 */
class RegressionEvaluator {
  constructor({ logger = null } = {}) {
    this.logger = logger;
    this.baselines = new Map(); // version → baseline results
    this.currentVersion = null;
  }

  /**
   * Run a test corpus against an execution function and collect results.
   *
   * @param {Array} corpus — array of { id, tenant, message, expect }
   * @param {function} executeFn — async (tenantId, customerId, text) → result
   * @returns {object} evaluation results
   */
  async evaluate(corpus, executeFn) {
    const results = [];
    let pass = 0, fail = 0;

    for (const tc of corpus) {
      if (tc.skip) continue;
      try {
        const r = await executeFn(tc.tenant, `reg-${tc.id}`, tc.message);
        const errors = this._checkExpectations(tc, r);
        const passed = errors.length === 0;
        if (passed) pass++; else fail++;

        results.push({
          id: tc.id,
          passed,
          errors,
          actual: {
            capabilityId: r.capabilityId,
            reply: r.reply?.slice(0, 100),
          },
          expected: tc.expect,
        });
      } catch (err) {
        fail++;
        results.push({ id: tc.id, passed: false, errors: [err.message], actual: null });
      }
    }

    return {
      total: results.length,
      pass,
      fail,
      passRate: results.length > 0 ? Math.round((pass / results.length) * 100) : 0,
      results,
      evaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * Save a baseline result for a specific version.
   */
  saveBaseline(version, evaluation) {
    this.baselines.set(version, evaluation);
    this.logger?.info?.('regression.baseline_saved', { version, passRate: evaluation.passRate });
  }

  /**
   * Compare a new evaluation against a saved baseline.
   *
   * @returns {object} { newFailures, newPasses, unchanged, regressions, improvements }
   */
  compare(baselineVersion, newEvaluation) {
    const baseline = this.baselines.get(baselineVersion);
    if (!baseline) {
      return { error: 'baseline_not_found', baselineVersion };
    }

    const baselineMap = new Map(baseline.results.map(r => [r.id, r]));
    const newMap = new Map(newEvaluation.results.map(r => [r.id, r]));

    const newFailures = [];  // Cases that passed before but fail now (REGRESSIONS)
    const newPasses = [];    // Cases that failed before but pass now (IMPROVEMENTS)
    const unchanged = [];     // Cases with same pass/fail status

    for (const [id, newResult] of newMap) {
      const oldResult = baselineMap.get(id);
      if (!oldResult) continue; // New test case, not in baseline

      if (oldResult.passed && !newResult.passed) {
        newFailures.push({
          id,
          oldResult: { passed: true },
          newResult: { passed: false, errors: newResult.errors },
        });
      } else if (!oldResult.passed && newResult.passed) {
        newPasses.push({
          id,
          oldResult: { passed: false, errors: oldResult.errors },
          newResult: { passed: true },
        });
      } else {
        unchanged.push(id);
      }
    }

    return {
      baselineVersion,
      baselinePassRate: baseline.passRate,
      newPassRate: newEvaluation.passRate,
      delta: newEvaluation.passRate - baseline.passRate,
      newFailures,
      newPasses,
      unchangedCount: unchanged.length,
      regressions: newFailures.length,
      improvements: newPasses.length,
    };
  }

  /**
   * Get all saved baselines.
   */
  listBaselines() {
    return [...this.baselines.entries()].map(([version, eval_]) => ({
      version,
      passRate: eval_.passRate,
      total: eval_.total,
      evaluatedAt: eval_.evaluatedAt,
    }));
  }

  // ─── Private ──────────────────────────────────────────────

  _checkExpectations(tc, result) {
    const errors = [];
    const expect = tc.expect || {};

    if (expect.capabilityId && result.capabilityId !== expect.capabilityId) {
      errors.push(`capabilityId: expected "${expect.capabilityId}", got "${result.capabilityId}"`);
    }

    for (const re of (expect.replyMatches || [])) {
      if (!re.test(result.reply || '')) {
        errors.push(`reply should match /${re.source}/ but got: ${(result.reply || '').slice(0, 100)}`);
      }
    }

    for (const re of (expect.replyNotMatch || [])) {
      if (re.test(result.reply || '')) {
        errors.push(`reply should NOT match /${re.source}/`);
      }
    }

    return errors;
  }
}

module.exports = { RegressionEvaluator };
