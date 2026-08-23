class GeminiAdapter {
  constructor({ apiKey = process.env.GEMINI_API_KEY, model = "gemini-1.5-flash", logger } = {}) {
    this.apiKey = apiKey;
    this.model = model;
    this.logger = logger;
  }
  isConfigured() { return Boolean(this.apiKey); }
  async complete(messages, { maxTokens = 180 } = {}) {
    if (!this.isConfigured()) return { success: false, text: null, reason: "not_configured" };
    try {
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
      const contents = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ system_instruction: { parts: [{ text: system }] }, contents, generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2 } })
      });
      if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
      const body = await response.json();
      return { success: true, text: body.candidates?.[0]?.content?.parts?.[0]?.text || null };
    } catch (error) {
      this.logger?.warning("llm.gemini.failed", { error: error.message });
      return { success: false, text: null, reason: error.message };
    }
  }
}
module.exports = { GeminiAdapter };
