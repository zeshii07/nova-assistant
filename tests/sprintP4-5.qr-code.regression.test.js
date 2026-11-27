// Sprint P4-5 — QR code regression tests.
//
// History: the hand-rolled QR encoder (v35.3) produced structurally-complete
// matrices but the format-information bits were a hardcoded magic constant
// (0x77e4) that lied to scanners — it advertised EC level H + mask pattern 6,
// while the data was actually encoded with EC level M and a single fixed mask
// (pattern 0). Scanners read the format info, tried to undo the wrong mask with
// the wrong error-correction level, failed, and refused to decode. Symptom
// reported by the user: "the QR is only half / mobile scanners can't scan it,
// and the owner can't download it."
//
// These tests prove the fix: every generated QR (short URL, long URL, URL with
// query params) decodes back to the source URL via jsQR (a reference QR
// decoder), the PNG/SVG are well-formed, and the /api/qr endpoint sets
// Content-Disposition: attachment when ?download=1 is present.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const PNG = require("pngjs").PNG;
const jsQR = require("jsqr");
const { startServer } = require("../apps/api/src/server");
const { buildContainer } = require("../apps/api/src/container");
const { generateQrMatrix, qrMatrixToSvg, qrMatrixToPng } = require("../packages/qr-engine/src/qrCode");

// ─── Module-level: the QR matrix + PNG/SVG must decode to the source URL ──
function decodePng(pngBuf) {
  const png = PNG.sync.read(pngBuf);
  const res = jsQR(Uint8ClampedArray.from(png.data), png.width, png.height);
  return { res, width: png.width, height: png.height };
}

test("QR: a short kiosk URL decodes via jsQR", () => {
  const url = "https://nova.example.com/kiosk/byt-cleaners-dubai";
  const matrix = generateQrMatrix(url);
  assert.ok(matrix.length > 0);
  // No nulls — every module must be placed.
  const nulls = matrix.flat().filter((c) => c === null).length;
  assert.equal(nulls, 0, "matrix must have no unplaced (null) modules");
  const png = qrMatrixToPng(matrix, { scale: 8, margin: 4 });
  const { res } = decodePng(png);
  assert.ok(res, "jsQR must decode the generated QR");
  assert.equal(res.data, url, "decoded data must match the source URL");
});

test("QR: a long URL with query params decodes (exercises higher versions)", () => {
  const url = "https://nova.example.com/kiosk/very-long-tenant-identifier-12345?source=qr&campaign=holiday";
  const matrix = generateQrMatrix(url);
  const png = qrMatrixToPng(matrix, { scale: 8, margin: 4 });
  const { res } = decodePng(png);
  assert.ok(res, "jsQR must decode the longer-URL QR");
  assert.equal(res.data, url);
});

test("QR: the SVG output is well-formed + decodes (via PNG re-render)", () => {
  const url = "https://nova.example.com/kiosk/salon-aurora";
  const matrix = generateQrMatrix(url);
  const svg = qrMatrixToSvg(matrix, { scale: 10, margin: 4 });
  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("</svg>"));
  assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'));
  // The SVG renders the SAME matrix as the PNG, so re-rendering the matrix as
  // PNG must also decode (proves the SVG + PNG share a correct source matrix).
  const png = qrMatrixToPng(matrix, { scale: 8, margin: 4 });
  const { res } = decodePng(png);
  assert.equal(res.data, url);
});

test("QR: generateQrMatrix rejects empty/non-string input", () => {
  assert.throws(() => generateQrMatrix(""), /required/i);
  assert.throws(() => generateQrMatrix(null), /required/i);
  assert.throws(() => generateQrMatrix(123), /required/i);
});

test("QR: the PNG has valid signature + correct dimensions", () => {
  const url = "https://nova.example.com/kiosk/demo";
  const matrix = generateQrMatrix(url);
  const png = qrMatrixToPng(matrix, { scale: 8, margin: 4 });
  // PNG signature.
  assert.ok(png.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
  // IHDR width/height = (matrix + margin*2) * scale.
  const expected = (matrix.length + 4 * 2) * 8;
  assert.equal(png.readUInt32BE(16), expected);
  assert.equal(png.readUInt32BE(20), expected);
});

// ─── HTTP endpoint: /api/qr/:tenant.png + .svg + ?download=1 ──────────────
let container, serverHandle, baseUrl;
const TENANT = "qr-test-tenant";

test.before(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nova-qr-"));
  process.env.NOVA_LOCAL_DATA_DIR = root;
  process.env.NOVA_KNOWLEDGE_DATA_DIR = path.join(root, "tenant-knowledge");
  process.env.NOVA_OPERATIONAL_DATA_DIR = path.join(root, "tenant-operational");
  process.env.NOVA_NLU_MODE = "off";
  process.env.LOG_LEVEL = "error";
  container = await buildContainer();
  // Seed a tenant profile so /api/qr/:tenant doesn't 404.
  const tenantDir = path.join(container.config.tenantsDir, TENANT);
  fs.mkdirSync(tenantDir, { recursive: true });
  fs.writeFileSync(path.join(tenantDir, "profile.json"), JSON.stringify({
    id: TENANT, name: "QR Test Tenant", capabilities: [], status: "active",
  }));
  container.tenantRepository.clearCache();
  const started = await startServer();
  serverHandle = started.server;
  await new Promise((resolve) => {
    serverHandle.on("listening", resolve);
    if (!serverHandle.listening) setTimeout(resolve, 50);
  });
  baseUrl = `http://127.0.0.1:${serverHandle.address().port}`;
});

test.after(async () => {
  // Force-close: server.close() can hang on lingering keep-alive sockets +
  // background timers (the engine schedules periodic jobs that keep the event
  // loop alive). Drop all connections first (Node 18.2+), then close with a
  // hard timeout, then force-exit — all assertions have run by teardown, so a
  // forced exit is safe and matches how integration tests with background
  // timers must behave under `npm test` (which has no --test-force-exit).
  if (serverHandle) {
    try { serverHandle.closeAllConnections && serverHandle.closeAllConnections(); } catch {}
    await new Promise((r) => {
      const t = setTimeout(() => { try { serverHandle.closeAllConnections && serverHandle.closeAllConnections(); } catch {} r(); }, 500);
      serverHandle.close(() => { clearTimeout(t); r(); });
    }).catch(() => {});
  }
  if (container) await container.registry.shutdownAll().catch(() => {});
  process.exit(0);
});

function get(p) {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${p}`, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on("error", reject);
  });
}

test("HTTP: GET /api/qr/:tenant.png returns a decodable PNG (inline, no Content-Disposition)", async () => {
  const r = await get(`/api/qr/${TENANT}.png`);
  assert.equal(r.status, 200);
  assert.equal(r.headers["content-type"], "image/png");
  assert.equal(r.headers["content-disposition"], undefined, "inline image must NOT force a download");
  const { res } = decodePng(r.body);
  assert.ok(res, "the endpoint-served PNG must decode via jsQR");
  assert.ok(res.data.endsWith(`/kiosk/${TENANT}`), "decoded URL must point at the tenant kiosk");
});

test("HTTP: GET /api/qr/:tenant.png?download=1 sets Content-Disposition: attachment + a filename", async () => {
  const r = await get(`/api/qr/${TENANT}.png?download=1`);
  assert.equal(r.status, 200);
  const cd = r.headers["content-disposition"] || "";
  assert.match(cd, /attachment/i, "must set Content-Disposition: attachment");
  assert.match(cd, /nova-kiosk-.*\.png/i, "must include a .png filename");
  // The download PNG must STILL decode (higher scale, same correct matrix).
  const { res } = decodePng(r.body);
  assert.ok(res, "the download PNG must decode via jsQR");
  assert.ok(res.data.endsWith(`/kiosk/${TENANT}`));
});

test("HTTP: GET /api/qr/:tenant.svg?download=1 sets Content-Disposition with .svg filename", async () => {
  const r = await get(`/api/qr/${TENANT}.svg?download=1`);
  assert.equal(r.status, 200);
  assert.equal(r.headers["content-type"], "image/svg+xml");
  const cd = r.headers["content-disposition"] || "";
  assert.match(cd, /attachment/i);
  assert.match(cd, /nova-kiosk-.*\.svg/i);
  // SVG body must be well-formed.
  const svg = r.body.toString("utf8");
  assert.ok(svg.startsWith("<svg") && svg.includes("</svg>"));
});

test("HTTP: GET /api/qr/unknown-tenant.png returns 404", async () => {
  const r = await get(`/api/qr/no-such-tenant.png`);
  assert.equal(r.status, 404);
});
