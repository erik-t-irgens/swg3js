// The hand-written SHA-256 and HMAC the browser needs (server/hash.mjs), checked against node's own
// crypto byte for byte. It is written by hand because `crypto.subtle` does not exist on the page
// this game is actually played on across a house: a browser counts only https and localhost as
// secure, and the README's recipe serves the game over plain http to another machine's address.
// Synthetic input only.
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { base32, bytes, fromBase32, fromHex, hex, hmacHex, sameDigest, sha256Hex } from '../../../server/hash.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const nodeSha = (input: Uint8Array | string) => createHash('sha256').update(Buffer.from(bytes(input))).digest('hex');
const nodeHmac = (key: Uint8Array | string, msg: Uint8Array | string) => createHmac('sha256', Buffer.from(bytes(key))).update(Buffer.from(bytes(msg))).digest('hex');

// --- 1: SHA-256 against node's ---------------------------------------------------------------------
{
  ok(sha256Hex('') === nodeSha(''), `1: nothing at all hashes the same (${sha256Hex('').slice(0, 16)}…)`);
  ok(sha256Hex('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', '1: the standard\'s own example is right');
  ok(sha256Hex('abc') === nodeSha('abc'), '1: and node agrees');
  // The lengths either side of a block and either side of the point where the length no longer fits.
  for (const n of [1, 55, 56, 57, 63, 64, 65, 119, 120, 121, 128, 1000]) {
    const input = new Uint8Array(n).map((_, i) => (i * 37 + 11) & 255);
    ok(sha256Hex(input) === nodeSha(input), `1: ${n} bytes hash the same as node's`);
  }
  const text = 'a nonce and a name: Hän Solo — ok';
  ok(sha256Hex(text) === nodeSha(text), '1: a string is hashed as UTF-8, as node does');
}

// --- 2: HMAC against node's ------------------------------------------------------------------------
{
  ok(hmacHex('key', 'The quick brown fox jumps over the lazy dog') === 'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8', '2: the standard\'s own example is right');
  ok(hmacHex('', '') === nodeHmac('', ''), '2: an empty key over nothing matches node');
  const short = randomBytes(16);
  const exact = randomBytes(64);
  const long = randomBytes(200);
  for (const [name, key] of [['a short key', short], ['a key exactly a block long', exact], ['a key longer than a block', long]] as [string, Buffer][]) {
    const k = new Uint8Array(key);
    ok(hmacHex(k, 'nonce') === nodeHmac(k, 'nonce'), `2: ${name} gives node's answer`);
  }
  // The exact shape the claim uses: a 32-byte verifier as hex, over a 32-character nonce.
  const verifier = hex(randomBytes(32));
  const nonce = randomBytes(16).toString('hex');
  ok(hmacHex(verifier, nonce) === nodeHmac(verifier, nonce), '2: the claim\'s own shape (a hex verifier over a hex nonce) matches node');
  ok(hmacHex(verifier, nonce).length === 64, '2: and the proof is sixty-four hex characters');
}

// --- 3: hex and base32 round trips -----------------------------------------------------------------
{
  const raw = randomBytes(32);
  ok(hex(new Uint8Array(raw)) === raw.toString('hex'), '3: hex is node\'s hex');
  ok(hex(fromHex(raw.toString('hex')) as Uint8Array) === raw.toString('hex'), '3: hex goes back to the same bytes');
  ok(fromHex('abc') === null && fromHex('zz') === null, '3: something that is not hex is not read as hex');
  const key = new Uint8Array(raw);
  const written = base32(key);
  ok(!/[lo01]/.test(written), `3: the copied-out key has no character that is read back wrong (${written.slice(0, 12)}…)`);
  const back = fromBase32(`${written.slice(0, 8)} ${written.slice(8, 16)}-${written.slice(16)}`);
  ok(!!back && hex(back.subarray(0, 32)) === hex(key), '3: a key pasted back with spaces and dashes in it is the same key');
  ok(fromBase32('not a key!') === null, '3: a word with a character that is not ours is refused');
}

// --- 4: comparing two digests ----------------------------------------------------------------------
{
  const a = sha256Hex('one');
  ok(sameDigest(a, a) === true, '4: a digest matches itself');
  ok(sameDigest(a, sha256Hex('two')) === false, '4: and not another');
  ok(sameDigest(a, a.slice(0, 32)) === false && sameDigest('', '') === false, '4: a different length, and nothing at all, never match');
}

console.log(`\n${checks} checks passed`);
