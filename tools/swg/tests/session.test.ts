// The browser's side of joining a server: the hashing it carries itself, the key it makes for itself,
// the claim it answers a challenge with, and the counting of changes made with nobody watching.
//
// Four failures are pinned here, each of which would only show on the second machine or after an
// evening offline. The hashing has to agree with the server's to the byte, or every claim is refused --
// and the reason the browser carries its own at all is that the page the game is played on across a
// house is not a secure context, where `crypto.subtle` does not exist. A key written out and typed back
// in has to come back as the same key, or copying a player to another machine loses them. The claim has
// to be one the server's own judge accepts, which is checked here by handing it to that judge rather
// than by agreeing with it on paper. And the change counter must not rise when nothing has changed, or
// every reconnection would look like an evening of trading and the tie would be asked about for ever.
//
// A fifth is pinned since the review: where a character stands is part of its mark, because the server
// compares two copies on a summary that has the planet in it. Left out, an ordinary walk to another
// planet left both sides at the same change counter with different stories, which is the server's "ask
// the player" -- on every connection after an ordinary journey, for ever.
//
// Everything here is synthetic: no browser, no document, no socket, and nothing read from the game's
// own files. `node:crypto` and the server's own modules are the authorities. The last section is the
// one exception to "no document": the Multiplayer page's markup is built by a pure function in
// `src/ui/multiplayerPage.ts` and checked as a string, because the page cannot be looked at from a session
// that drives a hidden tab and every one of its lookups ends in a `!` that would take the menu down.
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { fromBase32, fromHex, hmacSha256, sha256, toBase32, toHex, utf8 } from '../../../src/net/hash.ts';
import { SESSION, Session, characterMark, playerIdOf, proofOf, tuneSession, verifierOf, wordProofOf, type SessionStore } from '../../../src/net/session.ts';
import { MULTIPLAYER_PARTS, multiplayerMarkup } from '../../../src/ui/multiplayerPage.ts';
import { checkClaim, playerIdFor, verifierFor } from '../../../server/identity.mjs';
import { cleanClaim } from '../../../server/wire.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---- the hashing, against node:crypto -------------------------------------------------------------

const nodeSha = (b: Uint8Array) => new Uint8Array(createHash('sha256').update(b).digest());
const nodeMac = (k: Uint8Array, b: Uint8Array) => new Uint8Array(createHmac('sha256', k).update(b).digest());
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

// The lengths that break a hash written by hand: empty, one short of the padding, exactly at it, a
// whole block, and one past it.
for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 200, 1000]) {
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = (i * 37 + 11) & 255;
  ok(same(sha256(bytes), nodeSha(bytes)), `sha256 of ${n} bytes is node's`);
}

for (const keyLen of [0, 1, 32, 63, 64, 65, 200]) {
  const key = new Uint8Array(keyLen);
  for (let i = 0; i < keyLen; i++) key[i] = (i * 91 + 7) & 255;
  const msg = utf8(`${'a'.repeat(keyLen)}:0123456789abcdef`);
  ok(same(hmacSha256(key, msg), nodeMac(key, msg)), `hmac under a ${keyLen}-byte key is node's`);
}

// ---- the browser's port against the server's own reckoning -----------------------------------------

{
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key[i] = (i * 17 + 3) & 255;
  ok(playerIdOf(key) === playerIdFor(key), 'a player’s public name is worked out the same on both sides');
  ok(verifierOf(key) === verifierFor(key), 'and so is the verifier the server keeps');
  ok(verifierOf(key) !== toHex(key), 'which is not the key itself');
  const nonce = 'ffeeddccbbaa99887766554433221100';
  ok(proofOf(verifierOf(key), nonce) === createHmac('sha256', verifierOf(key)).update(nonce, 'utf8').digest('hex'), 'the proof is the HMAC of the nonce under the verifier');
  ok(wordProofOf('open sesame', nonce) === createHmac('sha256', 'open sesame').update(nonce, 'utf8').digest('hex'), 'and the join word is proved the same way');
  ok(wordProofOf('open sesame', nonce) !== wordProofOf('open sesame', 'other'), 'a word proved under one challenge does not answer another');
}

// ---- the key, written out and read back ------------------------------------------------------------

{
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key[i] = (i * 17 + 3) & 255;
  const written = toBase32(key);
  ok(/^[a-km-np-z2-9-]+$/.test(written), 'a key is written without the characters that are read back wrong');
  ok(same(fromBase32(written, 32), key), 'a key written out reads back as itself');
  ok(same(fromBase32(written.toUpperCase().replace(/-/g, ' '), 32), key), 'upper case, spaces for hyphens: still the same key');
  ok(fromBase32('not a key!', 32).length === 0, 'words that are not a key give nothing');
  ok(fromBase32(written.slice(0, 20), 32).length === 0, 'half a key gives nothing');
  ok(same(fromHex(toHex(key)), key), 'hex round-trips');
}

// ---- the character mark, which never leaves the browser ----------------------------------------------

{
  const c = { name: 'Han', outfit: ['shirt_s03', 'pants_s01'], items: [{ kind: 'wear', id: 'shirt_s03' }], held: { right: 'blaster' }, ships: { player_yt1300: { components: { engine: 'eng_1' } } } };
  ok(characterMark(c) === characterMark({ ...c }), 'the same record marks the same');
  ok(characterMark(c) === characterMark({ ...c, outfit: ['pants_s01', 'shirt_s03'] }), 'the order clothes are listed in is not a change');
  ok(characterMark(c) !== characterMark({ ...c, outfit: ['shirt_s03'] }), 'taking a garment off is a change');
  ok(characterMark(c) !== characterMark({ ...c, items: [] }), 'losing an item is a change');
  ok(characterMark(c) !== characterMark({ ...c, held: {} }), 'emptying a hand is a change');
  ok(characterMark(c) !== characterMark({ ...c, ships: { player_yt1300: { components: { engine: 'eng_2' } } } }), 'a refit is a change');
  // A fit is rebuilt from scratch on every refit, so its fields can come back in another order.
  const one = { ships: { player_x: { a: 1, b: { c: 2, d: 3 } } } };
  const other = { ships: { player_x: { b: { d: 3, c: 2 }, a: 1 } } };
  ok(characterMark(one) === characterMark(other), 'a ship’s fit rebuilt with its fields in another order is not a change');
}

// ---- the session itself ------------------------------------------------------------------------------

/** A browser's storage, in a plain object, so the whole session runs without one. */
function store(): SessionStore & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    get: (k) => (k in data ? data[k] : null),
    set: (k, v) => {
      data[k] = v;
    },
  };
}

/** A session with its outgoing words collected, and its notices. */
function session(s: SessionStore = store()) {
  const sent: Record<string, unknown>[] = [];
  const notes: string[] = [];
  const asks: unknown[] = [];
  const settled: string[] = [];
  const it = new Session(s);
  it.send = (m) => void sent.push(m);
  it.onNote = (t) => void notes.push(t);
  it.onAsk = (a) => void asks.push(a);
  it.onSettled = (w) => void settled.push(w);
  return { it, sent, notes, asks, settled, store: s };
}

const NONCE = 'ffeeddccbbaa99887766554433221100';
const ABOUT = { species: 'human_male', class: 'jedi', planet: 'tatooine', zone: '' };
const claimOf = (sent: Record<string, unknown>[]) => sent.find((m) => m.t === 'claim') as Record<string, unknown> | undefined;

{
  // A browser with no server set writes nothing of its own: the key is made when somebody asks who this
  // is, not when the game starts.
  const s = store();
  const quiet = new Session(s);
  ok(Object.keys(s.data).length === 0, 'a session that is never asked anything keeps nothing');
  quiet.setWord('a word');
  ok(quiet.word === 'a word', 'the join word is held in the session as well as in storage');
  void quiet.player;
  ok(typeof s.data['swg.player'] === 'string', 'and the key is made the first time the player is named');
}

{
  const a = session();
  const first = a.it.player;
  ok(/^[0-9a-f]{16}$/.test(first), 'a browser makes itself a name the first time it is asked');
  ok(a.it.player === first, 'and answers with the same one after that');
  ok(session(a.store).it.player === first, 'a browser that has run before is the same player');
  const written = a.it.exportKey();
  const b = session();
  ok(b.it.player !== first, 'another browser is another player');
  ok(b.it.importKey(written) === first, 'a key copied across makes the second browser the same player');
  ok(b.it.player === first, 'and it stays that player');
  ok(b.it.importKey('rubbish') === '', 'words that are not a key change nothing');
  ok(b.it.player === first, 'and the player is still who they were');
  ok(session(b.store).it.player === first, 'the key taken in is the one kept from then on');
}

{
  // The counter rises when the record changes and not otherwise.
  const a = session();
  const c = { id: 'char-1', name: 'Han', outfit: ['shirt_s03'], items: [{ kind: 'wear', id: 'shirt_s03' }] };
  a.it.noteCharacter(c, ABOUT);
  ok(a.it.counterOf('char-1') === 1, 'a character seen for the first time starts at one');
  a.it.noteCharacter(c, ABOUT);
  a.it.noteCharacter(c, ABOUT);
  ok(a.it.counterOf('char-1') === 1, 'saying the same thing again is not a change');
  a.it.noteCharacter({ ...c, items: [] }, ABOUT);
  ok(a.it.counterOf('char-1') === 2, 'losing an item is a change');
  a.it.noteCharacter({ ...c, items: [] }, ABOUT);
  ok(a.it.counterOf('char-1') === 2, 'and only one');
  const again = session(a.store);
  again.it.noteCharacter({ ...c, items: [] }, ABOUT);
  ok(again.it.counterOf('char-1') === 2, 'the counter is kept in the browser, not in the session');
}

{
  // The claim, put to the server's own judge rather than agreed with on paper.
  const a = session();
  a.it.noteCharacter({ id: 'char-1', name: 'Han' }, ABOUT);
  a.it.opening();
  ok(a.it.mode === 'waiting', 'nothing is known about a server until it speaks');
  ok(a.it.authority === 'me', 'and until then this browser decides for itself');
  ok(a.it.hail({ v: 2, now: 1000, nonce: NONCE }) === true, 'a hail is answered');
  const raw = claimOf(a.sent)!;
  ok(!!raw, 'with a claim');
  const claim = cleanClaim(raw);
  ok(!!claim, 'which the server’s own checking accepts as a claim');
  ok(claim.player === a.it.player && claim.character === 'char-1' && claim.name === 'Han', 'saying who and which character');
  ok(claim.counter === 1 && claim.about.planet === 'tatooine', 'with the change counter and where the character is');
  ok(raw.word === undefined, 'a server that asks for no word is sent none');
  // A server that has never seen this player: registered on the spot, first come first owned.
  const world: { players: Record<string, { key: string }>; characters: Record<string, unknown> } = { players: {}, characters: {} };
  const verdict = checkClaim(world, claim, NONCE, {});
  ok(verdict.ok === true, 'and the server judges the proof good');
  ok(verdict.registered === true && verdict.keep === 'browser', 'a player it has never met is registered, and the browser’s character stands');
  // And once registered, the same browser is known by its verifier alone.
  world.players[claim.player] = { key: claim.key };
  a.sent.length = 0;
  a.it.opening();
  a.it.hail({ v: 2, now: 2000, nonce: 'aabbccddeeff00112233445566778899' });
  const second = cleanClaim(claimOf(a.sent)!);
  ok(checkClaim(world, second, 'aabbccddeeff00112233445566778899', {}).ok === true, 'a second connection answers the new challenge');
  ok(checkClaim(world, second, NONCE, {}).ok === false, 'and an answer to the old one does not pass');
  // Nobody can be this player by typing their name.
  const liar = session();
  liar.it.noteCharacter({ id: 'char-1', name: 'Han' }, ABOUT);
  liar.it.opening();
  liar.it.hail({ v: 2, now: 3000, nonce: NONCE });
  const theirs = cleanClaim(claimOf(liar.sent)!);
  theirs.player = claim.player;
  const refused = checkClaim(world, theirs, NONCE, {});
  ok(refused.ok === false, `another browser claiming that name is refused (${refused.why})`);
}

{
  // A server with a join word.
  const a = session();
  a.it.setWord('open sesame');
  a.it.noteCharacter({ id: 'char-1', name: 'Han' }, ABOUT);
  a.it.opening();
  a.it.hail({ v: 2, now: 1, nonce: NONCE, word: 1 });
  const raw = claimOf(a.sent)!;
  ok(!JSON.stringify(raw).includes('open sesame'), 'the word itself is nowhere on the wire');
  const claim = cleanClaim(raw);
  const world = { players: {}, characters: {} };
  ok(checkClaim(world, claim, NONCE, { word: 'open sesame' }).ok === true, 'and the server, which knows the word, is satisfied');
  ok(checkClaim(world, claim, NONCE, { word: 'another word' }).ok === false, 'a browser with the wrong word is refused');
}

{
  // No character in play: nothing is claimed, and the session says so rather than half joining.
  const a = session();
  a.it.opening();
  ok(a.it.hail({ v: 2, now: 1, nonce: NONCE }) === false, 'a hail before a character is chosen is not answered');
  ok(claimOf(a.sent) === undefined, 'and nothing is sent');
  ok(a.notes.some((n) => /character/.test(n)), 'and the player is told why');
}

{
  // The old relay: no hail, and everything a server would hold is off.
  const a = session();
  a.it.opening();
  a.it.welcomedWithoutHail();
  ok(a.it.mode === 'relay', 'a welcome with nothing said before it is the old relay');
  ok(a.it.authority === 'me', 'and this browser still decides for itself');
  ok(a.notes.some((n) => /relay/.test(n)), 'and the player is told which they are on');
  const b = session();
  b.it.opening();
  b.it.hailTimedOut();
  ok(b.it.mode === 'relay', 'a server that says nothing at all is the old relay too');
  b.it.hailTimedOut();
  ok(b.notes.length === 1, 'and it is only said once');
}

{
  // Being claimed, taken over, and turned away.
  const a = session();
  a.it.noteCharacter({ id: 'char-1', name: 'Han' }, ABOUT);
  a.it.opening();
  a.it.hail({ v: 2, now: 1, nonce: NONCE, ff: 1 });
  ok(a.it.friendlyFire === false, 'a hail alone does not make this a server session');
  a.it.claimed({ player: a.it.player, character: 'char-1', name: 'Han' }, 'browser');
  ok(a.it.authority === 'server' && a.it.mode === 'server', 'the claim being answered is what makes it one');
  ok(a.it.friendlyFire === true, 'and the friendly-fire switch is the server’s');
  ok(a.notes.some((n) => /joined/.test(n)), 'and the player is told');
  a.it.taken('Han');
  ok(a.it.mode === 'off' && a.it.authority === 'me', 'a character opened elsewhere ends this session');
  ok(a.notes.some((n) => /another browser/.test(n)), 'and says so in words the player reads');
  const b = session();
  b.it.opening();
  b.it.denied('the join word is wrong');
  ok(b.it.mode === 'off' && b.it.debug().denied === 'the join word is wrong', 'a refusal is kept in the server’s own words');
  ok(b.notes.some((n) => /join word is wrong/.test(n)), 'and shown to the player');
}

{
  // The tie, and what answering it does.
  const a = session();
  a.it.noteCharacter({ id: 'char-1', name: 'Han', items: [{ kind: 'wear', id: 'a' }] }, ABOUT);
  const mine = { name: 'Han', species: 'human_male', class: 'jedi', planet: 'tatooine', zone: '', counter: 1 };
  const theirs = { name: 'Han', species: 'human_male', class: 'jedi', planet: 'naboo', zone: '', counter: 1 };
  a.it.opening();
  a.it.hail({ v: 2, now: 1, nonce: NONCE });
  a.sent.length = 0;
  a.it.settleAsk('char-1', mine, theirs);
  ok(a.it.ask !== null && a.it.ask.character === 'char-1', 'a tie is put to the player');
  ok(a.it.ask!.server.planet === 'naboo', 'with both copies to look at');
  a.it.resolveAsk('browser');
  const answer = a.sent.find((m) => m.t === 'settle') as Record<string, unknown>;
  ok(answer.take === 'browser' && answer.character === 'char-1', 'the answer goes to the server in its own words');
  ok(a.it.ask === null, 'and the question is gone');
  ok(a.it.counterOf('char-1') === 2, 'keeping this browser’s copy makes it the newer one, so the next time settles itself');
  // The server's copy standing instead.
  const b = session();
  b.it.noteCharacter({ id: 'char-1', name: 'Han' }, ABOUT);
  b.it.settled('char-1', 'server', theirs);
  ok(b.settled.includes('server'), 'the server’s copy standing is handed on to whoever will apply it');
  ok(b.notes.some((n) => /own copy/.test(n)), 'and the player is told rather than left wondering');
}

{
  // An ordinary journey. This is the fault the review found: with the place nowhere in the reckoning
  // the counter did not move, so the two copies tied and differed and the player was asked, every time.
  const c = { id: 'char-1', name: 'Han' };
  const a = session();
  a.it.noteCharacter(c, ABOUT);
  ok(a.it.counterOf('char-1') === 1, 'a character seen for the first time starts at one');
  a.it.noteCharacter(c, ABOUT);
  ok(a.it.counterOf('char-1') === 1, 'standing still is not a change');
  a.it.noteCharacter(c, { ...ABOUT, planet: 'naboo' });
  ok(a.it.counterOf('char-1') === 2, 'walking to another planet is');
  a.it.noteCharacter(c, { ...ABOUT, planet: 'naboo', zone: 'space_naboo' });
  ok(a.it.counterOf('char-1') === 3, 'and so is taking off into that planet’s space');
  // A change of clothes says nothing about where anyone is standing, so the place is read from what
  // the session already holds rather than from the argument.
  a.it.noteCharacter({ ...c, outfit: ['shirt_s03'] });
  ok(a.it.counterOf('char-1') === 4, 'a change of clothes is a change');
  a.it.noteCharacter({ ...c, outfit: ['shirt_s03'] });
  ok(a.it.counterOf('char-1') === 4, 'and saying it twice is still one change');
}

{
  // A place becoming known is not a journey. The way into the world puts a character's clothes back on
  // before anything has said what planet this is, so counting that would raise the counter once every
  // launch and the counter would stop meaning anything at all.
  const c = { id: 'char-1', name: 'Han', outfit: ['shirt_s03'] };
  const a = session();
  a.it.noteCharacter(c);
  ok(a.it.counterOf('char-1') === 1, 'a character first seen before anyone has said where it is starts at one');
  a.it.noteCharacter(c, ABOUT);
  ok(a.it.counterOf('char-1') === 1, 'and learning where it is, afterwards, is not a change');
  // The next launch: the same, and the counter must stand still through all of it.
  const next = session(a.store);
  next.it.noteCharacter(c);
  ok(next.it.counterOf('char-1') === 1, 'a fresh launch, before the world is up, is not a change');
  next.it.noteCharacter(c, ABOUT);
  ok(next.it.counterOf('char-1') === 1, 'nor is arriving on the planet it was already on');
  next.it.noteCharacter(c);
  ok(next.it.counterOf('char-1') === 1, 'nor anything else that says nothing about where it is');
  next.it.noteCharacter(c, { ...ABOUT, planet: 'naboo' });
  ok(next.it.counterOf('char-1') === 2, 'and a real journey still counts, across launches');
  // Switching character: the place the session is holding belongs to the one played before.
  const two = { id: 'char-2', name: 'Leia' };
  next.it.noteCharacter(two);
  next.it.noteCharacter(two, ABOUT);
  ok(next.it.counterOf('char-2') === 1, 'the character played before this one does not leave its planet behind for it');
  next.it.noteCharacter(two, { ...ABOUT, planet: 'corellia' });
  ok(next.it.counterOf('char-2') === 2, 'and its own journeys count from there');
}

{
  // The journey end to end, against the server's own judge: connect, travel, connect again.
  const a = session();
  const world: { players: Record<string, { key: string }>; characters: Record<string, unknown> } = { players: {}, characters: {} };
  a.it.noteCharacter({ id: 'char-1', name: 'Han' }, ABOUT);
  a.it.opening();
  a.it.hail({ v: 2, now: 1, nonce: NONCE });
  const firstClaim = cleanClaim(claimOf(a.sent)!);
  const first = checkClaim(world, firstClaim, NONCE, {});
  ok(first.keep === 'browser', 'a character the server has never seen is the browser’s');
  world.players[firstClaim.player] = { key: firstClaim.key };
  world.characters['char-1'] = first.offered;
  a.it.noteCharacter({ id: 'char-1', name: 'Han' }, { ...ABOUT, planet: 'naboo' });
  a.sent.length = 0;
  a.it.opening();
  a.it.hail({ v: 2, now: 2, nonce: NONCE });
  const second = checkClaim(world, cleanClaim(claimOf(a.sent)!), NONCE, {});
  ok(second.keep === 'browser', 'and after an ordinary journey it still is, rather than a question for the player');
}

{
  // A tie answered "the server's copy" moves nothing on either side, so the same question would come
  // back on the next connection, and the next. The answer is remembered and given again instead.
  const a = session();
  a.it.noteCharacter({ id: 'char-1', name: 'Han' }, ABOUT);
  const mine = { name: 'Han', species: 'human_male', class: 'jedi', planet: 'tatooine', zone: '', counter: 1 };
  const theirs = { ...mine, planet: 'naboo' };
  a.it.opening();
  a.it.hail({ v: 2, now: 1, nonce: NONCE });
  a.it.settleAsk('char-1', mine, theirs);
  ok(a.it.ask !== null, 'the first time, the tie is put to the player');
  a.it.resolveAsk('server');
  ok(a.notes.some((n) => /can be put back/.test(n)), 'and the answer says plainly that nothing of the server’s copy is applied yet');
  a.sent.length = 0;
  a.notes.length = 0;
  a.it.settleAsk('char-1', mine, theirs);
  ok(a.it.ask === null, 'the same question with nothing changed since is not put to them again');
  ok((a.sent.find((m) => m.t === 'settle') as Record<string, unknown>).take === 'server', 'the answer they gave before is given again');
  ok(a.notes.some((n) => /still stands/.test(n)), 'and they are told, in one line, that it was');
  a.it.noteCharacter({ id: 'char-1', name: 'Han', outfit: ['shirt_s03'] }, ABOUT);
  a.it.settleAsk('char-1', { ...mine, counter: 2 }, theirs);
  ok(a.it.ask !== null, 'but a real change here since makes it a new question');
}

{
  // A greeting this browser cannot answer does nothing rather than leaving it half joined.
  const a = session();
  a.it.noteCharacter({ id: 'char-1', name: 'Han' }, ABOUT);
  a.it.opening();
  ok(a.it.hail({ v: 2, now: 1, nonce: '' }) === false, 'a greeting with no challenge in it is not answered');
  ok(claimOf(a.sent) === undefined, 'and nothing is claimed');
  ok(a.it.mode === 'relay' && a.it.authority === 'me', 'the line goes on the old relay’s footing');
  ok(a.notes.some((n) => /could not be read/.test(n)), 'and the player is told');
}

{
  // A server from a later build says so in its greeting, and it is said once.
  const a = session();
  a.it.noteCharacter({ id: 'char-1', name: 'Han' }, ABOUT);
  a.it.opening();
  a.it.hail({ v: 99, now: 1, nonce: NONCE });
  ok(a.it.debug().serverVersion === 99, 'the language the far end speaks is kept');
  ok(a.notes.some((n) => /newer language/.test(n)), 'and a newer one is said');
  const before = a.notes.length;
  a.it.hail({ v: 99, now: 2, nonce: NONCE });
  ok(a.notes.length === before, 'once per line, not once per greeting');
}

{
  // What the console reads and what the game reads are one thing, and neither outlives the line.
  const a = session();
  a.it.noteCharacter({ id: 'char-1', name: 'Han' }, ABOUT);
  a.it.opening();
  a.it.hail({ v: 2, now: 1, nonce: NONCE, ff: 1 });
  ok(a.it.friendlyFire === a.it.debug().friendlyFire, 'the console and every caller read the same switch');
  ok(a.it.friendlyFire === false, 'and between the greeting and the claim, damage between players is off');
  a.it.claimed({ character: 'char-1' }, 'same');
  ok(a.it.friendlyFire && a.it.debug().friendlyFire, 'the server having us is what switches it on');
  a.it.taken('someone else');
  ok(!a.it.friendlyFire && !a.it.debug().friendlyFire, 'and losing the character switches it off again');
  ok(a.it.debug().taken, 'which the console can see');
  a.it.opening();
  ok(!a.it.debug().taken, 'until the line is opened again, which is the player asking for the character back');
}

{
  // A counter file that is not a table of characters would swallow every write in silence.
  const s = store();
  s.data['swg.charrev'] = '[1,2,3]';
  const a = session(s);
  a.it.noteCharacter({ id: 'char-1', name: 'Han' }, ABOUT);
  ok(a.it.counterOf('char-1') === 1, 'a counter file that is a list is thrown away rather than written into');
  const back = JSON.parse(s.data['swg.charrev']) as unknown;
  ok(!Array.isArray(back) && (back as Record<string, { n: number }>)['char-1'].n === 1, 'and what is put in its place is a table');
}

{
  // A key taken in while a line is open: the server still holds the player before this one.
  const a = session();
  a.it.noteCharacter({ id: 'char-1', name: 'Han' }, ABOUT);
  a.it.importKey(session().it.exportKey());
  ok(!a.notes.some((n) => /Connect again/.test(n)), 'with no line open, taking a key in says nothing');
  a.it.opening();
  a.it.hail({ v: 2, now: 1, nonce: NONCE });
  a.it.claimed({ character: 'char-1' }, 'same');
  a.it.importKey(session().it.exportKey());
  ok(a.notes.some((n) => /Connect again/.test(n)), 'with one open, the player is told the line has to be made again');
}

// ---- the Multiplayer page's markup ------------------------------------------------------------------

/** Every class name in a piece of markup, split as the browser splits a class attribute. */
function classesIn(html: string): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(/class="([^"]*)"/g)) for (const name of m[1].split(/\s+/)) if (name) out.add(name);
  return out;
}

{
  const view = { url: 'ws://localhost:8787', word: '', status: 'online', mode: 'server' as const, player: '0123456789abcdef', peers: ['Han'], ask: null };
  const plain = classesIn(multiplayerMarkup(view));
  for (const part of MULTIPLAYER_PARTS.always) ok(plain.has(part.slice(1)), `the page has ${part} for its wiring to find`);
  for (const part of MULTIPLAYER_PARTS.asking) ok(!plain.has(part.slice(1)), `and ${part} only when there is something to settle`);
  const copy = { name: 'Han', species: 'human_male', class: 'jedi', planet: 'tatooine', zone: '', counter: 1 };
  const asking = classesIn(multiplayerMarkup({ ...view, ask: { character: 'char-1', browser: copy, server: { ...copy, planet: 'naboo' } } }));
  for (const part of [...MULTIPLAYER_PARTS.always, ...MULTIPLAYER_PARTS.asking]) ok(asking.has(part.slice(1)), `with a tie to settle the page still has ${part}`);
}

{
  // Everything that came from another browser is text, whichever quote the next hand writes it with.
  const nasty = `<script>alert("x")</script>'y'`;
  const html = multiplayerMarkup({ url: nasty, word: nasty, status: nasty, mode: 'server', player: nasty, peers: [nasty], ask: null });
  ok(!html.includes('<script>'), 'a name or an address from elsewhere is never written as markup');
  ok(html.includes('&lt;script&gt;'), 'it is written as the text it is');
  ok(html.includes('&quot;') && html.includes('&#39;'), 'with both kinds of quote escaped, so the next interpolation written with single quotes is not a way in');
}

{
  // The live number.
  const was = SESSION.hailWait;
  ok(tuneSession({ hailWait: -5 }).hailWait === 0, 'the wait cannot be negative');
  ok(tuneSession({ hailWait: 1e9 }).hailWait === 30000, 'nor half a minute’s worth of waiting');
  tuneSession({ hailWait: was });
  ok(SESSION.hailWait === was, 'the number is put back');
}

console.log(`\n${checks} checks passed`);
