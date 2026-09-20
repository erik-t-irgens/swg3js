// SHA-256, HMAC-SHA-256 and the base32 the key is copied out in, written by hand with nothing
// imported, because the browser cannot always be asked for them: `crypto.subtle` and
// `crypto.randomUUID` exist only on a page the browser counts as secure (https, or localhost), and
// the README's own recipe for playing across a house serves the game over plain http to another
// machine's address, where neither exists. `crypto.getRandomValues`, which makes the key itself,
// is there on every page.
//
// This file is the reference copy: the browser carries a port of it, and the node test
// (tools/swg/tests/hash.test.ts) checks this one against node's own crypto byte for byte on an
// empty input, on a block boundary, on a key longer than a block and on the shape the claim uses.
// Nothing here allocates per frame -- it is called once on connecting and never again.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const HEX = '0123456789abcdef';
/** RFC 4648 without the letters and digits that are misread when a key is copied out by hand. */
const BASE32 = 'abcdefghijkmnpqrstuvwxyz23456789';

const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;

/** Bytes from a Uint8Array, an ArrayBuffer or a string (as UTF-8). */
export function bytes(x) {
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  return new TextEncoder().encode(String(x));
}

/** The 32 bytes of SHA-256 over anything `bytes` accepts. */
export function sha256(input) {
  const msg = bytes(input);
  const blocks = Math.ceil((msg.length + 9) / 64);
  const total = blocks * 64;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[msg.length] = 0x80;
  const bits = msg.length * 8;
  const hi = Math.floor(bits / 0x100000000);
  const lo = bits >>> 0;
  buf[total - 8] = (hi >>> 24) & 255;
  buf[total - 7] = (hi >>> 16) & 255;
  buf[total - 6] = (hi >>> 8) & 255;
  buf[total - 5] = hi & 255;
  buf[total - 4] = (lo >>> 24) & 255;
  buf[total - 3] = (lo >>> 16) & 255;
  buf[total - 2] = (lo >>> 8) & 255;
  buf[total - 1] = lo & 255;
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let b = 0; b < blocks; b++) {
    const off = b * 64;
    for (let i = 0; i < 16; i++) {
      const p = off + i * 4;
      w[i] = ((buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15];
      const y = w[i - 2];
      const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
      const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h[0];
    let b2 = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];
    for (let i = 0; i < 64; i++) {
      const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (hh + s1 + ch + K[i] + w[i]) >>> 0;
      const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b2) ^ (a & c) ^ (b2 & c)) >>> 0;
      const t2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b2;
      b2 = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b2) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (h[i] >>> 24) & 255;
    out[i * 4 + 1] = (h[i] >>> 16) & 255;
    out[i * 4 + 2] = (h[i] >>> 8) & 255;
    out[i * 4 + 3] = h[i] & 255;
  }
  return out;
}

/** The 32 bytes of HMAC-SHA-256: a key longer than a block is hashed first, as the standard says. */
export function hmacSha256(key, message) {
  let k = bytes(key);
  if (k.length > 64) k = sha256(k);
  const pad = new Uint8Array(64);
  pad.set(k);
  const m = bytes(message);
  const inner = new Uint8Array(64 + m.length);
  for (let i = 0; i < 64; i++) inner[i] = pad[i] ^ 0x36;
  inner.set(m, 64);
  const innerHash = sha256(inner);
  const outer = new Uint8Array(96);
  for (let i = 0; i < 64; i++) outer[i] = pad[i] ^ 0x5c;
  outer.set(innerHash, 64);
  return sha256(outer);
}

/** Lower-case hex of some bytes. */
export function hex(input) {
  const b = bytes(input);
  let s = '';
  for (let i = 0; i < b.length; i++) s += HEX[b[i] >> 4] + HEX[b[i] & 15];
  return s;
}

/** The bytes of a hex string, or null when it is not one (an odd length, or a letter past f). */
export function fromHex(text) {
  if (typeof text !== 'string' || text.length % 2 !== 0) return null;
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) {
    const hi = HEX.indexOf(text[i * 2].toLowerCase());
    const lo = HEX.indexOf(text[i * 2 + 1].toLowerCase());
    if (hi < 0 || lo < 0) return null;
    out[i] = (hi << 4) | lo;
  }
  return out;
}

/** SHA-256 as hex, which is how everything on the wire carries a digest. */
export const sha256Hex = (input) => hex(sha256(input));

/** HMAC-SHA-256 as hex. */
export const hmacHex = (key, message) => hex(hmacSha256(key, message));

/**
 * Base32 for a key a player copies out and pastes into another browser: no padding, no upper case,
 * and no `l`, `o`, `0` or `1`, which are the characters read back wrong. Grouped in fours by the
 * page that shows it, not here.
 */
export function base32(input) {
  const b = bytes(input);
  let out = '';
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < b.length; i++) {
    acc = (acc << 8) | b[i];
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32[(acc >> bits) & 31];
    }
  }
  if (bits > 0) out += BASE32[(acc << (5 - bits)) & 31];
  return out;
}

/** The bytes of a base32 string, ignoring spaces and dashes, or null when a character is not one of ours. */
export function fromBase32(text) {
  if (typeof text !== 'string') return null;
  const clean = text.toLowerCase().replace(/[\s-]/g, '');
  const out = [];
  let acc = 0;
  let bits = 0;
  for (const ch of clean) {
    const v = BASE32.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
    }
  }
  return new Uint8Array(out);
}

/**
 * Two hex digests compared without telling anyone how far they matched. The server has node's own
 * `timingSafeEqual` and uses it; this is the one the browser's port carries, and it is here so both
 * sides have the same answer for the same pair.
 */
export function sameDigest(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
