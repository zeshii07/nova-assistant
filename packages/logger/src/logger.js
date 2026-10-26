// v35.3: Logger now supports AsyncLocalStorage for automatic correlation ID
// propagation. Each request can call Logger.withCorrelationId(id, fn) and
// every log emitted inside `fn` will include the `requestId` field
// automatically — no need to pass it through every service call.
const { AsyncLocalStorage } = require('async_hooks');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const _als = new AsyncLocalStorage();

class Logger {
  constructor({ level = "info", context = {} } = {}) {
    this.level = LEVELS[level] ? level : "info";
    this.context = context;
  }
  child(context = {}) { return new Logger({ level: this.level, context: { ...this.context, ...context } }); }
  write(level, message, data = {}) {
    if (LEVELS[level] < LEVELS[this.level]) return;
    // v35.3: pull correlation ID from AsyncLocalStorage if active
    const alsStore = _als.getStore();
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...this.context,
      ...(alsStore || {}),
      ...data
    };
    const output = JSON.stringify(entry);
    if (level === "error") console.error(output); else console.log(output);
  }
  debug(message, data) { this.write("debug", message, data); }
  info(message, data) { this.write("info", message, data); }
  warn(message, data) { this.write("warn", message, data); }
  error(message, data) { this.write("error", message, data); }

  /**
   * v35.3: Run an async function with a correlation ID. Every log emitted
   * inside the function (and any downstream services that use the same
   * logger instance) will automatically include `requestId`.
   */
  static withCorrelationId(requestId, fn) {
    return _als.run({ requestId }, fn);
  }
}

module.exports = { Logger };

