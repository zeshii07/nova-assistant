const { createResponseModel } = require("../../response-sdk/src/responseModel");

/** Normalizes capability output into semantic blocks without choosing wording. */
class IntentRenderer {
  render({ capabilityId, result }) {
    const model = result.responseModel
      ? createResponseModel(result.responseModel)
      : this.fromLegacy({ capabilityId, result });
    return {
      version: "1.0",
      intent: model.intent,
      payload: model.payload,
      actions: model.actions,
      suggestions: model.suggestions,
      metadata: { capabilityId, ...model.metadata },
      flags: model.flags,
      blocks: this.blocksFor(model)
    };
  }

  fromLegacy({ capabilityId, result }) {
    const rawIntent = String(result.statePatch?.lastIntent || `${capabilityId}_reply`).toUpperCase();
    const aliases = { GREET: "GREETING", THANKS: "THANKS", GOODBYE: "GOODBYE", SMALL_TALK: "SMALL_TALK" };
    return createResponseModel({
      intent: aliases[rawIntent] || rawIntent,
      payload: { legacyText: result.reply },
      metadata: { legacy: true }
    });
  }

  blocksFor(model) {
    const map = {
      GREETING: ["greeting", "prompt"],
      CATALOG_LIST_VIEWED: ["intro", "product_list", "prompt"],
      CATALOG_PRODUCT_VIEWED: ["product", "attributes", "prompt"],
      CATALOG_UNAVAILABLE: ["apology", "availability", "prompt"],
      CRM_NAME_UPDATED: ["acknowledgement", "profile_update"],
      CRM_PROFILE_VIEWED: ["profile"],
      COMMERCE_CHECKOUT_STARTED: ["order_summary", "prompt"],
      COMMERCE_ORDER_CREATED: ["confirmation", "order_summary", "closing"],
      CLEANING_SERVICES_LISTED: ["intro", "service_list", "prompt"],
      CLEANING_SERVICES_WITH_DURATION: ["acknowledgement", "duration", "service_list", "prompt"],
      CLEANING_SERVICE_SELECTED: ["service", "price", "prompt"],
      CLEANING_ASK_TIME: ["prompt"],
      CLEANING_ASK_ADDRESS: ["prompt"],
      CLEANING_READY_TO_CONFIRM: ["service_summary", "prompt"],
      CLEANING_REQUEST_CREATED: ["confirmation", "service_summary", "closing"],
      CLEANING_REQUESTS_CREATED: ["confirmation", "service_summary", "closing"]
    };
    return (map[model.intent] || ["message"]).map((type) => ({ type }));
  }
}
module.exports = { IntentRenderer };
