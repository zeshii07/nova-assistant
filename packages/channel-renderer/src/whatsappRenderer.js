/** Formats final language for WhatsApp without changing business meaning. */
class WhatsAppRenderer {
  render(input) {
    return String(input.text || "")
      .replace(/\r\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^[-•]\s+/gm, "• ")
      .trim();
  }
}
module.exports = { WhatsAppRenderer };
