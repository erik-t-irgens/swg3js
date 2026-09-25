// A creature's mind crossing between browsers when it changes hands.
//
// Until now a hand-over carried where a creature was and what it looked like doing, and nothing of
// what it was thinking: the target it was fighting, where it was walking and everything on it were
// dropped at the boundary and started fresh on the new keeper. A creature led away from a fight by
// a stun would shrug the stun off as it crossed and walk back into it.
//
// The rules that can be run headless are the wire's own cleaning, which is the server's, and the
// shape of what the browser writes, which is read as text because the two live in different files
// and neither would fail to compile if it drifted from the other.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanNpcBrain, cleanNpcRow, NPC_WIRE } from '../../../server/npcWire.mjs';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

// ------------------------------------------------------------------ what the server lets through
{
  ok(cleanNpcBrain(undefined) === undefined, 'a row with no mind on it is a row with no mind on it');
  ok(cleanNpcBrain({}) === undefined, 'and an empty one is nothing rather than an object full of noughts');
  ok(cleanNpcBrain([]) === undefined, 'an array is not a mind');

  const b = cleanNpcBrain({ t: 'p', st: 2, sl: 1.5, bd: 7, bs: 4, gx: 100, gz: -200 });
  ok(b?.t === 'p', 'the player crosses as the one word that is not an id, since there is exactly one of them');
  ok(b?.st === 2 && b?.sl === 1.5, 'a stun and a slow cross as the seconds they have left');
  ok(b?.bd === 7 && b?.bs === 4, 'and a burn as how much a second and for how much longer');
  ok(b?.gx === 100 && b?.gz === -200, 'and where it was walking');

  ok(cleanNpcBrain({ t: 'some_creature_id' })?.t === 'some_creature_id', 'another creature crosses as the id every browser knows it by');
  ok(cleanNpcBrain({ t: 'x'.repeat(NPC_WIRE.id + 40) })?.t === undefined, 'an id longer than an id is refused');
  ok(cleanNpcBrain({ t: 42 as never })?.t === undefined, 'and a target that is not a word at all is refused');
}

// ------------------------------------------------------------------ nothing may be made nonsense of
{
  // A cap here is a bound on nonsense rather than a rule, as the damage cap is: the point is that a
  // browser on another build cannot hand somebody a creature stunned for the rest of the evening.
  const wild = cleanNpcBrain({ st: 1e9, sl: -5, bs: 1e9, bd: 1e12, gx: 1e12, gz: -1e12 });
  ok((wild?.st ?? 0) <= NPC_WIRE.timer, `a stun is held to ${NPC_WIRE.timer} s, however long it claims`);
  ok(wild?.sl === undefined, 'a slow of less than nothing is simply not there');
  ok((wild?.bd ?? 0) <= NPC_WIRE.damage, 'a burn is held to what a blow may claim');
  ok(Math.abs(wild?.gx ?? 0) <= NPC_WIRE.reach && Math.abs(wild?.gz ?? 0) <= NPC_WIRE.reach, 'and a goal to somewhere inside the world');

  // A burn with no time left carries no damage either: half a burn is not a burn.
  ok(cleanNpcBrain({ bd: 9 })?.bd === undefined, 'a burn with no seconds on it is not carried');
}

// ------------------------------------------------------------------ it rides on the row itself
{
  const row = cleanNpcRow({ i: 'w:1', p: [1, 2, 3], h: 0, s: 'idle', v: 0, hp: 1, b: { t: 'p', st: 3 } });
  ok(row?.b?.t === 'p' && row?.b?.st === 3, "a creature's mind rides on its own row, so a hand-over needs no second word on the wire");
  const bare = cleanNpcRow({ i: 'w:1', p: [1, 2, 3], h: 0, s: 'idle', v: 0, hp: 1 });
  ok(bare !== undefined && bare.b === undefined, 'and a browser built before any of this sends a row without one, which is read exactly as it always was');
  const junk = cleanNpcRow({ i: 'w:1', p: [1, 2, 3], h: 0, s: 'idle', v: 0, hp: 1, b: 'nonsense' });
  ok(junk !== undefined && junk.b === undefined, 'a mind that is not one is dropped and the rest of the row still arrives');
}

// ------------------------------------------------------------------ the two halves must agree
{
  const mobile = readFileSync(new URL('../../../src/world/mobiles/mobile.ts', import.meta.url), 'utf8');

  // A target cannot cross as a key: every living thing's key is handed out by the browser it was
  // made in, so one browser's number is another browser's rock.
  ok(/t\.key === PLAYER_KEY \? 'p' :/.test(mobile), "the player is written as the one word that means the same everywhere, never as a key");
  ok(/npcId\?: string \}\)\.npcId \?\? ''/.test(mobile), 'and any other creature as the id the world knows it by');
  ok(!/b\.t = t\.key/.test(mobile), 'and never as a key, which would name something else entirely on the browser it arrived at');

  // Kept while driven, applied when it is handed over: a driven copy thinks nothing.
  ok(/if \(row\.b\) this\.heldBrain = row\.b;/.test(mobile), 'a driven copy keeps the last mind it was told, which costs nothing');
  ok(/this\.adoptBrain\(this\.heldBrain\);/.test(mobile), 'and takes it on at the moment it is asked to do the thinking');
  ok(/this\.heldBrain = null;/.test(mobile), 'and lets it go, so a second hand-over is not given a stale one');

  // Every timer is written as what is left, not as when it ends.
  ok(/b\.st = Math\.round\(this\.stunned \* 100\)/.test(mobile), 'a timer is written as the seconds it has left, because two browsers do not share a moment');

  // The target is looked up where there is a list to look in, and not finding it is ordinary.
  ok(/if \(this\.wantTarget\) this\.takeWantedTarget\(ctx\.targets\);/.test(mobile), "the target is found on the first thought after arriving, where the list of the living is at hand");
  ok(/this\.wantTarget = null;/.test(mobile), 'and asked for once: a target that is not here is not waited for');
}

console.log(`\n${passed} checks passed`);
