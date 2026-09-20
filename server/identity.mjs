// Who a player is, without accounts and without passwords.
//
// The browser makes itself 32 random bytes the first time it runs and keeps them. From those it
// works out two things: a public id, the first sixteen hex characters of their SHA-256, which is
// what everyone sees; and a verifier, the SHA-256 of the key and a fixed label, which is the only
// part the server is ever given. On connecting, the server hands out a nonce in its hail and the
// browser answers with HMAC-SHA-256 of that nonce under the verifier. A player the server has never
// seen is registered on the spot with the verifier they sent -- first come, first owned -- and from
// then on nobody who does not hold the key can answer a nonce, so nobody can appear as them by
// typing their id.
//
// The key itself never crosses the wire and the server never learns it, which is why the verifier
// is derived rather than sent: someone who reads the server's file can be that player on this
// server, but cannot produce the key the player copied out to their other machine.
//
// The join word is checked the same way, over the same nonce, so the word itself is not sent either.
//
// This is not security (a modified browser can still lie about where it is standing); it is a door
// and a name. Dependency-free but for node's own crypto, and every rule in it is a pure function so
// the tests can run them.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hmacHex, sha256Hex } from './hash.mjs';

/** The label mixed into the key to make the verifier. Changing it would make every player new. */
export const VERIFY_LABEL = 'swg3js/verify/1';

/** The fields of a character whose two copies are compared when the change counters tie. */
const SUMMARY = ['name', 'species', 'class', 'planet', 'zone'];

/** A fresh challenge for one connection: sixteen bytes as hex. */
export function makeNonce() {
  return randomBytes(16).toString('hex');
}

/** The public id of a key: the first sixteen hex characters of its SHA-256. */
export function playerIdFor(key) {
  return sha256Hex(key).slice(0, 16);
}

/** The verifier the browser registers with: SHA-256 of the key and the label, as hex. */
export function verifierFor(key) {
  const k = key instanceof Uint8Array ? key : new TextEncoder().encode(String(key));
  const label = new TextEncoder().encode(VERIFY_LABEL);
  const both = new Uint8Array(k.length + label.length);
  both.set(k);
  both.set(label, k.length);
  return sha256Hex(both);
}

/** The answer to a nonce: HMAC-SHA-256 of it under the verifier, as hex. */
export function proofFor(verifierHex, nonce) {
  return hmacHex(verifierHex, String(nonce));
}

/** The answer to a nonce for the join word, so the word itself is never sent. */
export function wordProofFor(word, nonce) {
  return hmacHex(String(word), String(nonce));
}

/** Two hex digests of the same length, compared without saying how far they matched. */
export function sameProof(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * Which copy of a character to keep when a browser that has been playing offline meets the server
 * (decision 4). The higher change counter wins; equal counters with the same story are simply the
 * same character; equal counters that disagree are a real tie, and the player is asked.
 *
 * @returns {'browser' | 'server' | 'same' | 'ask'}
 */
export function settleCharacter(stored, offered) {
  if (!stored) return 'browser';
  const mine = Number(stored.counter) || 0;
  const theirs = Number(offered?.counter) || 0;
  if (theirs > mine) return 'browser';
  if (theirs < mine) return 'server';
  for (const field of SUMMARY) if ((stored[field] ?? '') !== (offered?.[field] ?? '')) return 'ask';
  return 'same';
}

/** The part of a character two copies are compared on, and the part that is shown when they are. */
export function summaryOf(record) {
  const out = {};
  for (const field of SUMMARY) out[field] = record?.[field] ?? '';
  out.counter = Number(record?.counter) || 0;
  return out;
}

/**
 * Judge a claim against what the server holds. Nothing is written here: the caller is given what
 * happened and writes it, so the rules can be run by a test with a plain object for the world.
 *
 * @param {object} data the store's world
 * @param {object} claim a claim already through `cleanClaim`
 * @param {string} nonce the nonce this connection was hailed with
 * @param {{ word?: string }} options the join word the server was started with, if any
 * A refusal says whether it is the line that is refused or only the character: a bad proof or a bad
 * join word means this browser is not who it says it is and there is nothing it can do about it, but
 * a character another player already owns is the end of that character only -- the browser is still
 * itself and can pick another one, so the caller keeps it connected.
 *
 * @returns {{ ok: false, why: string, character?: false } | { ok: true, player, character, registered: boolean, keep: string, stored: object | null, offered: object }}
 */
export function checkClaim(data, claim, nonce, { word = '' } = {}) {
  if (!claim) return { ok: false, why: 'nothing to claim with' };
  if (word) {
    if (!claim.word || !sameProof(claim.word, wordProofFor(word, nonce))) return { ok: false, why: 'the join word is wrong' };
  }
  const known = data.players?.[claim.player] ?? null;
  const verifier = known ? known.key : claim.key;
  if (!verifier) return { ok: false, why: 'a player the server does not know must send its key' };
  if (!sameProof(claim.proof, proofFor(verifier, nonce))) return { ok: false, why: 'that is not this player' };
  const stored = data.characters?.[claim.character] ?? null;
  // A character id a browser made itself can collide: on the page this game is played on across a
  // house there is no `randomUUID`, and the fallback is a time and six random characters. So the
  // character is refused rather than merged into someone else's -- and only the character.
  if (stored && stored.owner !== claim.player) return { ok: false, character: false, why: 'that character belongs to another player' };
  const offered = {
    id: claim.character,
    owner: claim.player,
    name: claim.name,
    species: claim.about?.species ?? stored?.species ?? '',
    class: claim.about?.class ?? stored?.class ?? '',
    planet: claim.about?.planet ?? stored?.planet ?? '',
    zone: claim.about?.zone ?? stored?.zone ?? '',
    counter: claim.counter ?? 0,
  };
  return { ok: true, player: claim.player, character: claim.character, registered: !known, keep: settleCharacter(stored, offered), stored, offered };
}

/**
 * Who is playing which character right now. A character opened in a second browser is given to the
 * newer one and the older is told it was taken over (decision 8); this is the piece that says so.
 * It lives for as long as the server runs and is not written to disk.
 */
export class Sessions {
  constructor() {
    /** @type {Map<string, number>} character id to the session holding it */
    this.byCharacter = new Map();
    /** @type {Map<number, string>} session to the character it holds */
    this.bySession = new Map();
  }

  /**
   * Give a character to a session. Returns the session that held it a moment ago and must now be
   * told, or null when nobody did (or when it was already this one).
   */
  take(character, session) {
    const before = this.byCharacter.get(character);
    const had = this.bySession.get(session);
    if (had && had !== character) this.byCharacter.delete(had);
    this.byCharacter.set(character, session);
    this.bySession.set(session, character);
    return before !== undefined && before !== session ? before : null;
  }

  /** Let go of whatever a session held, on the way out. */
  release(session) {
    const character = this.bySession.get(session);
    if (character === undefined) return null;
    this.bySession.delete(session);
    if (this.byCharacter.get(character) === session) this.byCharacter.delete(character);
    return character;
  }

  /** The session playing a character, or null. */
  holder(character) {
    return this.byCharacter.get(character) ?? null;
  }

  /** The character a session is playing, or null. */
  characterOf(session) {
    return this.bySession.get(session) ?? null;
  }
}
