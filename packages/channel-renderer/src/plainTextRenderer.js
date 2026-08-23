class PlainTextRenderer { render(input) { return String(input.text || "").trim(); } }
module.exports = { PlainTextRenderer };
