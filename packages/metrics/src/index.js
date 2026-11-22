/**
 * Phase 3 Sprint 2 — Dashboard metrics aggregator package.
 *
 * Re-exports the MetricsAggregator so callers can require the package root:
 *   const { MetricsAggregator } = require('../../packages/metrics/src');
 */
const { MetricsAggregator } = require("./metricsAggregator");

module.exports = { MetricsAggregator };
