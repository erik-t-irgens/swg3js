// Who a player is without accounts and without passwords (server/identity.mjs): the key the browser
// keeps, the public id it shows, the verifier the server is given, the answer to the hail's nonce,
// the join word, the character claims and the rule that settles a character played offline against
// the one the server holds. Synthetic keys and characters only.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { checkClaim, makeNonce, playerIdFor, proofFor, sameProof, Sessions, settleCharacter, summaryOf, verifierFor, wordProofFor } from '../../../server/identity.mjs';
import { cleanClaim } from '../../../server/wire.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** A browser: 32 random bytes it keeps, and everything it shows the world worked out from them. */
function browser(name: string) {
  const key = new Uint8Array(randomBytes(32));
  return { name, key, player: playerIdFor(key), verifier: verifierFor(key) };
}

/** What a browser sends, already through the wire's checker, as the server would see it. */
function claimFrom(b: ReturnType<typeof browser>, nonce: string, extra: Record<string, unknown> = {}) {
  return cleanClaim({
    t: 'claim',
    player: b.player,
    key: b.verifier,
    proof: proofFor(b.verifier, nonce),
    character: 'char-1',
    name: b.name,
    counter: 0,
    ...extra,
  });
}

/** What the relay does with a verdict it accepted, boiled down to the two records it writes. */
function apply(world: Record<string, any>, claim: any, verdict: any) {
  if (!verdict.ok) return;
  if (verdict.registered) world.players[verdict.player] = { id: verdict.player, key: claim.key, name: claim.name };
  if (verdict.keep === 'browser') world.characters[verdict.character] = verdict.offered;
}

const emptyWorld = () => ({ players: {} as Record<string, any>, characters: {} as Record<string, any> });

// --- 1: the key, the id and the verifier ------------------------------------------------------------
{
  const a = browser('Han');
  ok(/^[0-9a-f]{16}$/.test(a.player), `1: a player's public id is sixteen hex characters (${a.player})`);
  ok(/^[0-9a-f]{64}$/.test(a.verifier), '1: the verifier the server is told is thirty-two bytes');
  ok(a.verifier !== Buffer.from(a.key).toString('hex'), '1: the verifier is not the key: the key itself never crosses the wire');
  ok(playerIdFor(a.key) === a.player && verifierFor(a.key) === a.verifier, '1: the same key always gives the same id and verifier, so a reload comes back as the same player');
  ok(browser('Leia').player !== a.player, '1: two keys are two players');
  const nonce = makeNonce();
  ok(/^[0-9a-f]{32}$/.test(nonce) && makeNonce() !== nonce, '1: every connection is hailed with a fresh nonce');
}

// --- 2: a first claim, and coming back --------------------------------------------------------------
{
  const world = emptyWorld();
  const a = browser('Han');
  const first = makeNonce();
  const c1 = claimFrom(a, first);
  const v1 = checkClaim(world, c1, first) as any;
  ok(v1.ok && v1.registered === true, '2: a player the server has never met is registered on the spot');
  apply(world, c1, v1);
  ok(world.players[a.player].key === a.verifier, '2: and the verifier they sent is what is kept');
  ok(v1.keep === 'browser' && world.characters['char-1'].owner === a.player, '2: their character is written with them as its owner');

  const second = makeNonce();
  const c2 = claimFrom(a, second, { key: undefined, counter: 1 });
  const v2 = checkClaim(world, c2, second) as any;
  ok(v2.ok && v2.registered === false, '2: coming back with an answer to a new nonce is the same player, and no key is sent');
  ok(v2.keep === 'browser', '2: a higher change counter means the browser\'s copy stands');
}

// --- 3: what is refused ------------------------------------------------------------------------------
{
  const world = emptyWorld();
  const a = browser('Han');
  const b = browser('Leia');
  const n1 = makeNonce();
  const c1 = claimFrom(a, n1);
  apply(world, c1, checkClaim(world, c1, n1));

  const n2 = makeNonce();
  const wrong = { ...claimFrom(a, n2), proof: proofFor(verifierFor(new Uint8Array(randomBytes(32))), n2) };
  ok((checkClaim(world, wrong, n2) as any).ok === false, '3: an answer made with the wrong key is refused, so nobody can be you by typing your id');

  const stale = claimFrom(a, n1);
  ok((checkClaim(world, stale, n2) as any).ok === false, '3: an answer to an older nonce is refused, so one overheard cannot be used again');

  const nobody = { ...claimFrom(a, n2), player: 'f'.repeat(16) };
  ok((checkClaim(world, nobody, n2) as any).ok === false, '3: a player the server does not know and who sends no key is refused');

  const n3 = makeNonce();
  const theirs = claimFrom(b, n3);
  const v = checkClaim(world, theirs, n3) as any;
  ok(v.ok === false && /another player/.test(v.why), `3: a character another player owns is refused rather than merged (${v.why})`);
  // Which refusal it is matters: the browser is still itself and can offer another character, so the
  // line must not be closed under it. An id two browsers made the same way would otherwise lock a
  // player out of the server for good.
  ok(v.character === false, '3: and it is the character that is refused, not the browser');
  const closed = checkClaim(world, { ...theirs, proof: 'f'.repeat(64) }, n3) as any;
  ok(closed.ok === false && closed.character === undefined, '3: while an answer that is not this player is the end of the line');

  const n4 = makeNonce();
  const otherChar = claimFrom(b, n4, { character: 'char-2' });
  ok((checkClaim(world, otherChar, n4) as any).ok === true, '3: but a character of their own is fine');
}

// --- 4: the join word --------------------------------------------------------------------------------
{
  const world = emptyWorld();
  const a = browser('Han');
  const nonce = makeNonce();
  const without = claimFrom(a, nonce);
  ok((checkClaim(world, without, nonce, { word: 'mos-eisley' }) as any).ok === false, '4: with a join word set, a browser that gives none is turned away');
  const wrong = claimFrom(a, nonce, { word: wordProofFor('mos-espa', nonce) });
  ok((checkClaim(world, wrong, nonce, { word: 'mos-eisley' }) as any).ok === false, '4: and one with the wrong word too');
  const right = claimFrom(a, nonce, { word: wordProofFor('mos-eisley', nonce) });
  ok((checkClaim(world, right, nonce, { word: 'mos-eisley' }) as any).ok === true, '4: the right word lets them in');
  ok(wordProofFor('mos-eisley', nonce) !== 'mos-eisley', '4: the word itself is never what is sent');
  ok((checkClaim(world, without, nonce, {}) as any).ok === true, '4: with no join word set, nothing is asked for');
}

// --- 5: a character played offline, met by the server (decision 4) ------------------------------------
{
  const stored = { id: 'char-1', owner: 'a', name: 'Han', species: 'human_male', class: 'jedi', planet: 'tatooine', zone: '', counter: 5 };
  ok(settleCharacter(null, { counter: 0 }) === 'browser', '5: a character the server has never seen is taken as the browser has it');
  ok(settleCharacter(stored, { ...stored, counter: 9 }) === 'browser', '5: an evening played offline (a higher counter) wins');
  ok(settleCharacter(stored, { ...stored, counter: 2 }) === 'server', '5: a browser left behind (a lower counter) does not undo what the server holds');
  ok(settleCharacter(stored, { ...stored }) === 'same', '5: the same counter and the same story is simply the same character');
  ok(settleCharacter(stored, { ...stored, planet: 'naboo' }) === 'ask', '5: the same counter and a different story is a real tie, and the player is asked');
  ok(settleCharacter(stored, { ...stored, name: 'Solo' }) === 'ask', '5: a different name at the same counter is a tie too');
  const shown = summaryOf(stored) as Record<string, unknown>;
  ok(Object.keys(shown).join() === 'name,species,class,planet,zone,counter', `5: what is shown when the player is asked is the two stories side by side (${Object.keys(shown).join()})`);
}

// --- 6: the same character in two browsers (decision 8) -----------------------------------------------
{
  const sessions = new Sessions();
  ok(sessions.take('char-1', 7) === null, '6: the first browser to open a character simply has it');
  ok(sessions.holder('char-1') === 7 && sessions.characterOf(7) === 'char-1', '6: and the server knows who has it');
  ok(sessions.take('char-1', 7) === null, '6: the same browser claiming again takes nothing from itself');
  ok(sessions.take('char-1', 9) === 7, '6: a second browser takes it, and the first is named so it can be told');
  ok(sessions.holder('char-1') === 9, '6: the newer browser has it');
  ok(sessions.take('char-2', 9) === null && sessions.holder('char-1') === null, '6: a browser that switches character lets the first one go');
  ok(sessions.release(9) === 'char-2' && sessions.holder('char-2') === null, '6: leaving lets go of whatever was held');
  ok(sessions.release(9) === null, '6: and leaving twice takes nothing from anyone');
}

// --- 7: comparing proofs ------------------------------------------------------------------------------
{
  const p = proofFor('a'.repeat(64), 'nonce');
  ok(sameProof(p, p) === true && sameProof(p, proofFor('b'.repeat(64), 'nonce')) === false, '7: a proof matches itself and no other');
  ok(sameProof(p, p.slice(0, 20)) === false && sameProof('', '') === false, '7: a different length, and nothing at all, never match');
}

console.log(`\n${checks} checks passed`);
