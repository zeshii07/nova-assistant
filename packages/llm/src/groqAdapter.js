class GroqAdapter {
  constructor({ apiKey = process.env.GROQ_API_KEY, model = process.env.GROQ_MODEL || "openai/gpt-oss-20b", timeoutMs = 5000, logger } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.logger = logger;
    this.timeoutMs = timeoutMs;
  }
  isConfigured() { return Boolean(this.apiKey); }
  async complete(messages, { maxTokens = 180 } = {}) {
    if (!this.isConfigured()) return { success: false, text: null, reason: "not_configured" };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        signal:controller.signal,
        body: JSON.stringify({ model: this.model, messages, max_tokens: maxTokens, temperature: 0.1 })
      });
      if (!response.ok) throw new Error(`Groq HTTP ${response.status}`);
      const body = await response.json();
      return { success: true, text: body.choices?.[0]?.message?.content || null };
    } catch (error) {
      const reason=error?.name==='AbortError'?'timeout':error.message;
      this.logger?.warn?.("llm.groq.failed", { error: reason });
      return { success: false, text: null, reason };
    } finally {
      clearTimeout(timer);
    }
  }
}
module.exports = { GroqAdapter };
