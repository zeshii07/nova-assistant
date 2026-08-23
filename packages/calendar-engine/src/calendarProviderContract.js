const REQUIRED_METHODS = Object.freeze(["check", "hold", "confirmHold", "releaseHold", "reschedule", "cancel", "listEvents"]);

/**
 * Validates a scheduling adapter without giving it business-decision authority.
 * Google Calendar, Microsoft Graph, Cal.com, or a custom scheduler can satisfy
 * this contract; Nova still owns validation, tenant scope, confirmation, and
 * the customer-facing workflow.
 */
function assertCalendarProvider(provider) {
  if (!provider || typeof provider !== "object") throw new Error("Calendar provider must be an object.");
  for (const method of REQUIRED_METHODS) if (typeof provider[method] !== "function") throw new Error(`Calendar provider is missing '${method}()'.`);
  return provider;
}

module.exports = { REQUIRED_METHODS, assertCalendarProvider };
