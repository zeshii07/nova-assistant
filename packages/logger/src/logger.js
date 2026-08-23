const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
class Logger {
  constructor({ level = "info", context = {} } = {}) {
    this.level = LEVELS[level] ? level : "info";
    this.context = context;
  }
  child(context = {}) { return new Logger({ level: this.level, context: { ...this.context, ...context } }); }
  write(level, message, data = {}) {
    if (LEVELS[level] < LEVELS[this.level]) return;
    const entry = { timestamp: new Date().toISOString(), level, message, ...this.context, ...data };
    const output = JSON.stringify(entry);
    if (level === "error") console.error(output); else console.log(output);
  }
  debug(message, data) { this.write("debug", message, data); }
  info(message, data) { this.write("info", message, data); }
  warn(message, data) { this.write("warn", message, data); }
  error(message, data) { this.write("error", message, data); }
}
module.exports = { Logger };
