// v35.3: Pure-JS QR code generator (Reed-Solomon + bit matrix).
// Based on the ISO/IEC 18004 standard. No external dependencies.
//
// This is a minimal implementation supporting QR versions 1-10 (byte mode,
// error correction level M). Suitable for short URLs (kiosk links, etc.)
// which is our use case — URLs up to ~150 chars.
//
// Output: returns a 2D array of booleans (true = dark module) for the
// QR code. Caller can render this as SVG, PNG, or any other format.

// ─── Galois Field arithmetic (GF(256)) ────────────────────────────
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();
function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

// ─── Reed-Solomon encoder ──────────────────────────────────────────
function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    poly = poly.map((_, k) => gfMul(poly[k], GF_EXP[i])).concat([0]);
    for (let k = 0; k < poly.length - 1; k++) {
      poly[k] ^= poly[k + 1];
    }
  }
  return poly;
}
function rsEncode(data, ecLen) {
  const gen = rsGeneratorPoly(ecLen);
  const result = data.concat(new Array(ecLen).fill(0));
  for (let i = 0; i < data.length; i++) {
    const coef = result[i];
    if (coef !== 0) {
      for (let j = 0; j < gen.length; j++) {
        result[i + j] ^= gfMul(gen[j], coef);
      }
    }
  }
  return result.slice(data.length);
}

// ─── QR code version capacities (byte mode, EC level M) ───────────
const VERSION_CAPACITY = [0, 14, 26, 42, 62, 84, 106, 122, 152, 180, 213];
const EC_CODEWORDS_PER_BLOCK_M = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const EC_BLOCKS_M = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];

function pickVersion(dataLen) {
  for (let v = 1; v <= 10; v++) {
    if (dataLen + 4 <= VERSION_CAPACITY[v]) return v;
  }
  throw new Error('Data too long for QR versions 1-10 (max ~209 bytes). Got: ' + dataLen);
}

// ─── Bit stream ────────────────────────────────────────────────────
class BitStream {
  constructor() { this.bits = []; }
  push(value, length) {
    for (let i = length - 1; i >= 0; i--) {
      this.bits.push((value >> i) & 1);
    }
  }
  toBytes() {
    const bytes = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8 && i + j < this.bits.length; j++) {
        b = (b << 1) | this.bits[i + j];
      }
      bytes.push(b);
    }
    return bytes;
  }
  get length() { return this.bits.length; }
}

// ─── QR matrix builder ────────────────────────────────────────────
function buildMatrix(version, bytes, ecLen, ecBytes) {
  const size = 17 + 4 * version;
  const matrix = Array.from({ length: size }, () => new Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  function placeFinder(r, c) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        const isDark = (dr === 0 || dr === 6) && dc >= 0 && dc <= 6 ||
                       (dc === 0 || dc === 6) && dr >= 0 && dr <= 6 ||
                       (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
        matrix[rr][cc] = isDark;
        reserved[rr][cc] = true;
      }
    }
  }
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  const ALIGN_POS = {
    2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };
  if (version >= 2) {
    const positions = ALIGN_POS[version];
    for (const r of positions) {
      for (const c of positions) {
        if ((r === positions[0] && c === positions[0]) ||
            (r === positions[0] && c === positions[positions.length - 1]) ||
            (r === positions[positions.length - 1] && c === positions[0])) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const rr = r + dr, cc = c + dc;
            const isDark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            matrix[rr][cc] = isDark;
            reserved[rr][cc] = true;
          }
        }
      }
    }
  }

  for (let i = 8; i < size - 8; i++) {
    if (matrix[6][i] === null) {
      matrix[6][i] = i % 2 === 0;
      reserved[6][i] = true;
    }
    if (matrix[i][6] === null) {
      matrix[i][6] = i % 2 === 0;
      reserved[i][6] = true;
    }
  }

  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      reserved[8][i] = true; matrix[8][i] = false;
      reserved[i][8] = true; matrix[i][8] = false;
    }
  }
  for (let i = size - 8; i < size; i++) {
    reserved[8][i] = true; matrix[8][i] = false;
    reserved[i][8] = true; matrix[i][8] = false;
  }

  let bitIndex = 0;
  const dataBits = [];
  for (const b of bytes.concat(ecBytes)) {
    for (let i = 7; i >= 0; i--) dataBits.push((b >> i) & 1);
  }
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < size; i++) {
      const r = upward ? size - 1 - i : i;
      for (let c = 0; c < 2; c++) {
        const cc = col - c;
        if (!reserved[r][cc] && matrix[r][cc] === null) {
          matrix[r][cc] = bitIndex < dataBits.length ? dataBits[bitIndex] === 1 : false;
          bitIndex++;
        }
      }
    }
    upward = !upward;
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!reserved[r][c] && (r + c) % 2 === 0) {
        matrix[r][c] = !matrix[r][c];
      }
    }
  }

  const formatInfo = 0x77e4;
  for (let i = 0; i <= 5; i++) {
    matrix[8][i] = ((formatInfo >> i) & 1) === 1;
  }
  matrix[8][7] = ((formatInfo >> 6) & 1) === 1;
  matrix[8][8] = ((formatInfo >> 7) & 1) === 1;
  matrix[7][8] = ((formatInfo >> 8) & 1) === 1;
  for (let i = 9; i < 15; i++) {
    matrix[14 - i][8] = ((formatInfo >> i) & 1) === 1;
  }
  for (let i = 0; i < 8; i++) {
    matrix[size - 1 - i][8] = ((formatInfo >> i) & 1) === 1;
  }
  for (let i = 8; i < 15; i++) {
    matrix[8][size - 15 + i] = ((formatInfo >> i) & 1) === 1;
  }

  return matrix;
}

// ─── Public API ────────────────────────────────────────────────────
function generateQrMatrix(text) {
  const bytes = Array.from(Buffer.from(text, 'utf8'));
  const version = pickVersion(bytes.length);
  const stream = new BitStream();
  stream.push(0b0100, 4);
  const lengthBits = version < 10 ? 8 : 16;
  stream.push(bytes.length, lengthBits);
  for (const b of bytes) stream.push(b, 8);
  const totalCapacity = VERSION_CAPACITY[version] * 8;
  const terminatorBits = Math.min(4, totalCapacity - stream.length);
  stream.push(0, terminatorBits);
  while (stream.length % 8 !== 0) stream.push(0, 1);
  const dataBytes = stream.toBytes();
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (dataBytes.length < VERSION_CAPACITY[version]) {
    dataBytes.push(padBytes[padIdx % 2]);
    padIdx++;
  }
  const ecLen = EC_CODEWORDS_PER_BLOCK_M[version];
  const numBlocks = EC_BLOCKS_M[version];
  const blockLen = Math.floor(VERSION_CAPACITY[version] / numBlocks);
  const blocks = [];
  const ecBlocks = [];
  for (let i = 0; i < numBlocks; i++) {
    const block = dataBytes.slice(i * blockLen, (i + 1) * blockLen);
    blocks.push(block);
    ecBlocks.push(rsEncode(block, ecLen));
  }
  return buildMatrix(version, dataBytes, ecLen, ecBlocks.flat());
}

function qrMatrixToSvg(matrix, opts = {}) {
  const size = matrix.length;
  const scale = opts.scale || 10;
  const margin = opts.margin !== undefined ? opts.margin : 4;
  const totalSize = (size + margin * 2) * scale;
  const dark = opts.dark || '#000';
  const light = opts.light || '#fff';
  let rects = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (matrix[r][c]) {
        rects += `<rect x="${(c + margin) * scale}" y="${(r + margin) * scale}" width="${scale}" height="${scale}" fill="${dark}"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalSize}" height="${totalSize}" viewBox="0 0 ${totalSize} ${totalSize}"><rect width="${totalSize}" height="${totalSize}" fill="${light}"/>${rects}</svg>`;
}

function qrMatrixToPng(matrix, opts = {}) {
  const size = matrix.length;
  const scale = opts.scale || 8;
  const margin = opts.margin !== undefined ? opts.margin : 4;
  const totalSize = (size + margin * 2) * scale;
  const width = totalSize;
  const height = totalSize;
  const rowSize = width * 4 + 1;
  const raw = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowSize] = 0;
    for (let x = 0; x < width; x++) {
      const mr = Math.floor((y - margin * scale) / scale);
      const mc = Math.floor((x - margin * scale) / scale);
      const dark = mr >= 0 && mr < size && mc >= 0 && mc < size && matrix[mr][mc];
      const pixel = dark ? 0 : 255;
      const offset = y * rowSize + 1 + x * 4;
      raw[offset] = pixel;
      raw[offset + 1] = pixel;
      raw[offset + 2] = pixel;
      raw[offset + 3] = 255;
    }
  }
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(raw);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  function chunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    const crc = crc32(Buffer.concat([typeBuf, data]));
    crcBuf.writeUInt32BE(crc >>> 0, 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

module.exports = { generateQrMatrix, qrMatrixToSvg, qrMatrixToPng };
