const { ValidationError } = require("../../../shared/src/errors");

/** Small dependency-injected client for WhatsApp Cloud API. */
class WhatsAppCloudClient {
  constructor({ fetchImpl = globalThis.fetch, logger, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    if (typeof fetchImpl !== "function") throw new ValidationError("A fetch implementation is required");
    this.fetch = fetchImpl;
    this.logger = logger;
    this.sleep = sleep;
  }

  async sendText(config, to, text) {
    return this.#request(config, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: String(to),
      type: "text",
      text: { preview_url: false, body: truncate(String(text), 4096) }
    });
  }

  async markRead(config, messageId) {
    return this.#request(config, { messaging_product: "whatsapp", status: "read", message_id: messageId });
  }

  async #request(config, body) {
    if (!config?.enabled) throw new ValidationError("WhatsApp is disabled for this tenant");
    const url = `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`;
    let lastError;
    for (let attempt = 0; attempt <= config.retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      try {
        const response = await this.fetch(url, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal
        });
        const data = await safeJson(response);
        if (!response.ok) {
          const error = new Error(data?.error?.message || `WhatsApp API returned ${response.status}`);
          error.status = response.status;
          error.response = data;
          throw error;
        }
        return data;
      } catch (error) {
        lastError = error;
        const retryable = error.name === "AbortError" || !error.status || error.status === 429 || error.status >= 500;
        if (!retryable || attempt >= config.retries) break;
        this.logger?.warn("whatsapp.request_retry", { attempt: attempt + 1, error: error.message });
        await this.sleep(250 * (2 ** attempt));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }
}

function truncate(text, max) { return text.length <= max ? text : `${text.slice(0, max - 3)}...`; }
async function safeJson(response) { try { return await response.json(); } catch { return null; } }
module.exports = { WhatsAppCloudClient, truncate };
