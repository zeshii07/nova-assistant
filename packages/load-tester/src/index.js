/**
 * v53.0 — Load Tester
 *
 * Stress testing and fault injection for production readiness validation.
 *
 * Features:
 *   - Concurrent conversation simulation (multiple customers simultaneously)
 *   - Fault injection (force specific errors at specific points)
 *   - Latency measurement under load
 *   - Throughput measurement
 *   - Memory usage tracking
 *   - Error rate tracking
 */

/**
 * Load Tester
 */
class LoadTester {
  constructor({ logger = null } = {}) {
    this.logger = logger;
    this.results = [];
    this.faults = []; // Injected faults
  }

  /**
   * Run a load test with concurrent conversations.
   *
   * @param {object} params - { executeFn, conversations, concurrency }
   *   - executeFn: async (message) → result
   *   - conversations: array of { tenantId, customerId, messages: [text1, text2, ...] }
   *   - concurrency: how many conversations to run in parallel
   * @returns {object} test results
   */
  async runLoadTest({ executeFn, conversations = [], concurrency = 5 }) {
    const startTime = performance.now();
    const memoryBefore = process.memoryUsage();
    const results = [];

    // Run conversations in batches of `concurrency`
    for (let i = 0; i < conversations.length; i += concurrency) {
      const batch = conversations.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(conv => this._runConversation(executeFn, conv))
      );
      results.push(...batchResults);
    }

    const elapsed = performance.now() - startTime;
    const memoryAfter = process.memoryUsage();
    const totalMessages = results.reduce((sum, r) => sum + r.messageCount, 0);
    const successful = results.filter(r => r.completed).length;
    const failed = results.filter(r => !r.completed).length;
    const allLatencies = results.flatMap(r => r.latencies);
    const errors = results.flatMap(r => r.errors);

    return {
      totalConversations: conversations.length,
      successfulConversations: successful,
      failedConversations: failed,
      totalMessages,
      elapsedMs: Math.round(elapsed),
      throughput: elapsed > 0 ? Math.round((totalMessages / elapsed) * 1000) : 0, // msg/sec
      latency: {
        min: allLatencies.length ? Math.min(...allLatencies) : 0,
        avg: allLatencies.length ? Math.round(allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length) : 0,
        max: allLatencies.length ? Math.max(...allLatencies) : 0,
        p50: this._percentile(allLatencies, 50),
        p95: this._percentile(allLatencies, 95),
      },
      memoryDelta: {
        rss: Math.round((memoryAfter.rss - memoryBefore.rss) / 1024 / 1024), // MB
        heapUsed: Math.round((memoryAfter.heapUsed - memoryBefore.heapUsed) / 1024 / 1024),
      },
      errors,
      conversations: results,
      testedAt: new Date().toISOString(),
    };
  }

  /**
   * Inject a fault (force a specific error).
   *
   * @param {object} fault - { type, target, probability }
   *   - type: 'timeout' | 'error' | 'slow'
   *   - target: 'booking' | 'commerce' | 'nlu' | 'any'
   *   - probability: 0-1 (0.1 = 10% of calls)
   */
  injectFault(fault) {
    this.faults.push(fault);
  }

  /**
   * Clear all injected faults.
   */
  clearFaults() {
    this.faults = [];
  }

  /**
   * Run a stress test: increasing load until error rate exceeds threshold.
   *
   * @param {object} params - { executeFn, baseConversations, maxConcurrency, errorThreshold }
   */
  async runStressTest({ executeFn, conversations, maxConcurrency = 50, errorThreshold = 0.1 }) {
    const results = [];
    let concurrency = 1;

    while (concurrency <= maxConcurrency) {
      // Use a subset of conversations for each level
      const subset = conversations.slice(0, Math.min(concurrency * 2, conversations.length));
      const test = await this.runLoadTest({ executeFn, conversations: subset, concurrency });

      const errorRate = test.totalConversations > 0
        ? test.failedConversations / test.totalConversations
        : 0;

      results.push({
        concurrency,
        ...test,
        errorRate: Math.round(errorRate * 100),
      });

      if (errorRate >= errorThreshold) {
        results.push({ concurrency, breakingPoint: true, errorRate: Math.round(errorRate * 100) });
        break;
      }

      concurrency = Math.ceil(concurrency * 1.5); // Increase by 50% each round
    }

    return {
      levels: results,
      maxSupportedConcurrency: results.filter(r => !r.breakingPoint).pop()?.concurrency || 0,
      breakingPoint: results.find(r => r.breakingPoint)?.concurrency || null,
      testedAt: new Date().toISOString(),
    };
  }

  // ─── Private ──────────────────────────────────────────────

  async _runConversation(executeFn, conv) {
    const latencies = [];
    const errors = [];
    let messageCount = 0;
    let completed = true;

    for (const text of conv.messages || []) {
      const start = performance.now();
      try {
        // Check for injected faults
        if (this._shouldInjectFault()) {
          throw new Error('injected_fault');
        }
        await executeFn({ tenantId: conv.tenantId, customerId: conv.customerId, text });
        messageCount++;
      } catch (err) {
        errors.push({ message: text.slice(0, 50), error: err.message });
        if (err.message !== 'injected_fault') completed = false;
      }
      latencies.push(performance.now() - start);
    }

    return { tenantId: conv.tenantId, customerId: conv.customerId, messageCount, latencies, errors, completed };
  }

  _shouldInjectFault() {
    for (const fault of this.faults) {
      if (Math.random() < (fault.probability || 0)) return true;
    }
    return false;
  }

  _percentile(arr, p) {
    if (!arr || !arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return Math.round(sorted[Math.max(0, idx)] || 0);
  }
}

module.exports = { LoadTester };
