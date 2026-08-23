/** In-process versioned event bus with failure isolation. */
class EventBus {
  constructor({ logger } = {}) { this.logger = logger; this.listeners = new Map(); }
  subscribe(eventName, handler) {
    if (typeof handler !== "function") throw new TypeError("Event handler must be a function.");
    const handlers = this.listeners.get(eventName) || new Set(); handlers.add(handler); this.listeners.set(eventName, handlers);
    return () => handlers.delete(handler);
  }
  async publish(eventName, payload = {}, metadata = {}) {
    const handlers = [...(this.listeners.get(eventName) || []), ...(this.listeners.get("*") || [])];
    const event = Object.freeze({ name: eventName, payload, metadata, occurredAt: new Date().toISOString() });
    const results = [];
    for (const handler of handlers) {
      try { results.push({ ok: true, value: await handler(event) }); }
      catch (error) { this.logger?.error("event.handler_failed", { eventName, error: error.message }); results.push({ ok: false, error }); }
    }
    return results;
  }
}
module.exports = { EventBus };
