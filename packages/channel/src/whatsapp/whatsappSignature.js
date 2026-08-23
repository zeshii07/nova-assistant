const crypto = require("crypto");

/** Verify Meta's x-hub-signature-256 header against the exact raw request bytes. */
function verifyWhatsAppSignature({ rawBody, signatureHeader, appSecret }) {
  if (!Buffer.isBuffer(rawBody) || !signatureHeader || !appSecret) return false;
  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const actualBuffer = Buffer.from(String(signatureHeader));
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

module.exports = { verifyWhatsAppSignature };
