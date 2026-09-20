// SHA-256, HMAC-SHA-256 and the two spellings a key is written in, with nothing imported.
//
// Why this is here rather than `crypto.subtle`: the page this game is actually played on across a
// house is served at http://192.168.x.x:5173, which no browser counts as a secure context, and on a
// page like that `crypto.subtle` and `crypto.randomUUID` do not exist at all. `crypto.getRandomValues`
// does exist everywhere, so the 32 random bytes of a player's key are still the browser's; only the
// hashing is ours. The server carries the same functions (server/hash.mjs) and a node test checks both
// against node:crypto byte for byte.
//
// Nothing here runs in a frame: a connection hashes a few dozen bytes once, a character's mark is
// hashed when what it owns changes, and a key is spelled out only when the Multiplayer page is open.
// The round constants are made once at module level; the message schedule and the working state are
// made per call rather than shared, so that a hash taken from inside a callback another hash is running
// cannot quietly return the wrong digest. Three small arrays per hash, a few times a minute at most.

/** The first thirty-two bits of the fractional parts of the cube roots of the first sixty-four primes. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** SHA-256 of some bytes, as 32 bytes. */
export function sha256(bytes: Uint8Array): Uint8Array {
  // The message schedule and the working state belong to this call: a hash is exactly the function
  // somebody reuses without reading it, and sharing these at module level would make a hash taken
  // while another is running return a digest that is silently not the one asked for.
  const W = new Uint32Array(64);
  const H = new Uint32Array(8);
  H[0] = 0x6a09e667;
  H[1] = 0xbb67ae85;
  H[2] = 0x3c6ef372;
  H[3] = 0xa54ff53a;
  H[4] = 0x510e527f;
  H[5] = 0x9b05688c;
  H[6] = 0x1f83d9ab;
  H[7] = 0x5be0cd19;
  // The padded message: the bytes, a 0x80, zeros, and the bit length as a 64-bit big-endian number.
  const n = bytes.length;
  const blocks = Math.floor((n + 8) / 64) + 1;
  const padded = new Uint8Array(blocks * 64);
  padded.set(bytes);
  padded[n] = 0x80;
  const bits = n * 8;
  // A length past 2^32 bits cannot happen here (the longest thing hashed is a few hundred bytes), but
  // the high word is written all the same so the padding is the standard's.
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000), false);
  view.setUint32(padded.length - 4, bits >>> 0, false);
  for (let b = 0; b < blocks; b++) {
    const at = b * 64;
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(at + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15];
      const c = W[i - 2];
      const s0 = rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3);
      const s1 = rotr(c, 17) ^ rotr(c, 19) ^ (c >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let a = H[0];
    let b1 = H[1];
    let c = H[2];
    let d = H[3];
    let e = H[4];
    let f = H[5];
    let g = H[6];
    let h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b1) ^ (a & c) ^ (b1 & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b1;
      b1 = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b1) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i], false);
  return out;
}

/** HMAC-SHA-256: the standard construction, block size 64. */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const block = new Uint8Array(64);
  if (key.length > 64) block.set(sha256(key));
  else block.set(key);
  const inner = new Uint8Array(64 + message.length);
  const outer = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) {
    inner[i] = block[i] ^ 0x36;
    outer[i] = block[i] ^ 0x5c;
  }
  inner.set(message, 64);
  outer.set(sha256(inner), 64);
  return sha256(outer);
}

/**
 * The bytes of a string, as UTF-8. `TextEncoder` is on every page, secure or not -- it is only
 * `crypto.subtle` that is missing on an insecure one -- so this is the browser's own and not a port.
 */
export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

const HEX = '0123456789abcdef';

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
  return out;
}

/** Hex back to bytes; anything that is not a pair of hex digits gives an empty array. */
export function fromHex(text: string): Uint8Array {
  const s = text.trim().toLowerCase();
  if (s.length % 2 !== 0 || !/^[0-9a-f]*$/.test(s)) return new Uint8Array(0);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** SHA-256 of a string, as hex: the one-liner most callers want. */
export function hashText(text: string): string {
  return toHex(sha256(utf8(text)));
}

/** HMAC-SHA-256 of a string under a key, as hex. */
export function macText(key: Uint8Array, text: string): string {
  return toHex(hmacSha256(key, utf8(text)));
}

/**
 * The alphabet a key is written out in: the server's own (`BASE32` in server/hash.mjs), which leaves
 * out `l`, `o`, `0` and `1` because those are the characters read back wrong when a key is copied by
 * hand. The two files must spell a key the same way or a key copied between browsers would not read.
 */
const B32 = 'abcdefghijkmnpqrstuvwxyz23456789';

/** Bytes as base 32, in groups of four, which is how a key is shown and read back. */
export function toBase32(bytes: Uint8Array, group = 4): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  if (group <= 0) return out;
  let grouped = '';
  for (let i = 0; i < out.length; i += group) grouped += (i ? '-' : '') + out.slice(i, i + group);
  return grouped;
}

/**
 * Base 32 back to bytes, forgiving what a person typing does: spaces, hyphens and line breaks are
 * ignored and case does not matter. Anything else gives an empty array. `want`, when it is given, is
 * how many bytes the answer must be, so half a key pasted in is refused rather than used.
 */
export function fromBase32(text: string, want = 0): Uint8Array {
  const s = text.replace(/[\s-]/g, '').toLowerCase();
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (let i = 0; i < s.length; i++) {
    const d = B32.indexOf(s[i]);
    if (d < 0) return new Uint8Array(0);
    value = (value << 5) | d;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  if (want > 0 && out.length !== want) return new Uint8Array(0);
  return new Uint8Array(out);
}
