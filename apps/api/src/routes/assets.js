/**
 * v74.2 — Public asset router (Phase 4, final, of the Express migration),
 * mounted at /api:
 *   GET /api/catalog/products?tenantId= — public product listing
 *   GET /api/catalog/images/{tenantId}/{productId} — product image serve
 *   GET /api/qr/{tenantId}.png|svg — server-side QR codes (?download=1
 *   sends Content-Disposition: attachment)
 *
 * Verbatim transcription from the v73.x if-chain; the QR engine require
 * stays lazy so deployments without the qr-engine package still boot.
 */
const express = require("express");
const fs = require("fs");
const path = require("path");
const { sendJson, sendText } = require("../http-helpers");

function createAssetsRouter({ container }) {
  const router = express.Router();

  router.get('/catalog/products', async (req, res) => {
    const tenantId = req.query.tenantId || container.config.defaultTenantId;
    const products = await container.catalogService.listProducts(tenantId);
    return sendJson(res, 200, { ok: true, products });
  });

  // Serve product image (public, no auth)
  router.get('/catalog/images/:tenantId/:productId', (req, res) => {
    const tenantId = req.params.tenantId;
    const productId = req.params.productId;
    const imagesDir = path.join(container.config.tenantsDir, tenantId, 'catalog', 'images');
    // Try common extensions
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.gif']) {
      const filePath = path.join(imagesDir, `${productId}${ext}`);
      if (fs.existsSync(filePath)) {
        const mimeTypes = { '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.gif':'image/gif' };
        const data = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': mimeTypes[ext], 'Cache-Control': 'public, max-age=86400' });
        res.end(data);
        return;
      }
    }
    return sendText(res, 404, 'Image not found');
  });

  // v35.3: Server-side QR code endpoints (no external API)
  // GET /api/qr/{tenantId}.png → QR code PNG
  // GET /api/qr/{tenantId}.svg → QR code SVG
  // ?download=1 → send Content-Disposition: attachment so browsers save
  //   the file instead of opening/rendering it. Used by the dashboard's
  //   "Download QR Code" buttons. The same endpoint serves both the inline
  //   <img> preview (no query) and the download (with query).
  // The v73.x regex captured the extension as a second group; Express
  // params cannot span the dot the same way, so the tenant param is split
  // on the last dot here — identical matching for all real-world IDs.
  router.get('/qr/:tenantFile', (req, res, next) => {
    const tenantFile = req.params.tenantFile;
    const dot = tenantFile.lastIndexOf('.');
    const tenantId = decodeURIComponent(tenantFile.slice(0, dot));
    const format = tenantFile.slice(dot + 1);
    // Non-png/svg suffixes fell through the v73.x regex to the JSON 404
    // catch-all; next() preserves that (no route below matches /api/qr/*).
    if (format !== 'png' && format !== 'svg') return next();
    const wantsDownload = req.query.download === '1';
    try { container.tenantRepository.getById(tenantId); }
    catch { return sendText(res, 404, 'Unknown tenant'); }
    const novaOrigin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['host'] || 'localhost:3000'}`;
    const kioskUrl = `${novaOrigin}/kiosk/${tenantId}`;
    try {
      const { generateQrMatrix, qrMatrixToSvg, qrMatrixToPng } = require("../../../../packages/qr-engine/src/qrCode");
      const matrix = generateQrMatrix(kioskUrl);
      // Use a higher scale for downloads so the printed QR stays crisp at
      // large sizes; the inline preview stays small for fast page load.
      const scale = wantsDownload ? 16 : 8;
      if (format === 'svg') {
        const svg = qrMatrixToSvg(matrix, { scale: 10, margin: 4 });
        const headers = { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' };
        if (wantsDownload) {
          headers['Content-Disposition'] = `attachment; filename="nova-kiosk-${tenantId}.svg"`;
        }
        res.writeHead(200, headers);
        res.end(svg);
        return;
      } else {
        const png = qrMatrixToPng(matrix, { scale, margin: 4 });
        const headers = { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'Content-Length': png.length };
        if (wantsDownload) {
          headers['Content-Disposition'] = `attachment; filename="nova-kiosk-${tenantId}.png"`;
        }
        res.writeHead(200, headers);
        res.end(png);
        return;
      }
    } catch (err) {
      container.logger?.error?.('qr.generation_failed', { tenantId, error: err.message });
      return sendText(res, 500, 'QR generation failed.');
    }
  });

  return router;
}

module.exports = { createAssetsRouter };
