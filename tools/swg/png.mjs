// Minimal PNG encoder (RGBA8, no filtering) and decoder (8-bit RGBA or RGB) using Node's zlib.
import { deflateSync, inflateSync } from 'node:zlib';

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Read a PNG back as RGBA8: 8-bit RGBA (colour type 6) or RGB (type 2, alpha 255), not interlaced,
 * any of the five row filters. Anything else (16-bit, palette, grey, interlaced, damaged) is null.
 * The icon rasterizer's fallback for a texture entry that carries no reduced copy.
 */
export function decodePng(buf) {
  try {
    if (!buf || buf.length < 8 + 25) return null;
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
    for (let i = 0; i < 8; i++) if (b[i] !== PNG_SIGNATURE[i]) return null;
    let o = 8;
    let width = 0, height = 0, colorType = -1, depth = 0, interlace = 0;
    const idat = [];
    while (o + 8 <= b.length) {
      const len = b.readUInt32BE(o);
      const type = b.toString('latin1', o + 4, o + 8);
      const data = b.subarray(o + 8, o + 8 + len);
      if (data.length < len) return null;
      if (type === 'IHDR') {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        depth = data[8];
        colorType = data[9];
        interlace = data[12];
      } else if (type === 'IDAT') idat.push(data);
      else if (type === 'IEND') break;
      o += 12 + len;
    }
    if (!width || !height || depth !== 8 || interlace !== 0 || (colorType !== 6 && colorType !== 2) || !idat.length) return null;
    const bpp = colorType === 6 ? 4 : 3;
    const stride = width * bpp;
    const raw = inflateSync(Buffer.concat(idat));
    if (raw.length < (stride + 1) * height) return null;
    const rows = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
      const filter = raw[y * (stride + 1)];
      const src = y * (stride + 1) + 1;
      const dst = y * stride;
      for (let x = 0; x < stride; x++) {
        const v = raw[src + x];
        const a = x >= bpp ? rows[dst + x - bpp] : 0;
        const up = y > 0 ? rows[dst - stride + x] : 0;
        const c = y > 0 && x >= bpp ? rows[dst - stride + x - bpp] : 0;
        let pred;
        switch (filter) {
          case 0: pred = 0; break;
          case 1: pred = a; break;
          case 2: pred = up; break;
          case 3: pred = (a + up) >> 1; break;
          case 4: {
            const p = a + up - c;
            const pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c);
            pred = pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
            break;
          }
          default: return null;
        }
        rows[dst + x] = (v + pred) & 255;
      }
    }
    if (bpp === 4) return { width, height, rgba: rows };
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0, j = 0; i < rows.length; i += 3, j += 4) {
      rgba[j] = rows[i];
      rgba[j + 1] = rows[i + 1];
      rgba[j + 2] = rows[i + 2];
      rgba[j + 3] = 255;
    }
    return { width, height, rgba };
  } catch {
    return null;
  }
}
