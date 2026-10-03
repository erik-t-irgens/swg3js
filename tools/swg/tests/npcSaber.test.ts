// A lightsaber in somebody else's hands (src/world/npcSaber.ts): the keys a fighter or a person from
// the catalogue presses into the player's own move machine, by tier, and whether its blade turns a bolt
// away. Everything here drives the real `NpcSaber` over the real `SaberCombat` with a clock of its own,
// a clip length of its own and dice of its own, so what is counted is what the game would do.
//
// Six things are pinned.
//
// **The gates**, by tier, as the owner's numbers have them: nothing below the second rung, a chain in
// one style at the second and third, the specials, the katas and the leaps from the fourth, and a
// chance to turn a bolt of [0, 0, 0.1, 0.25, 0.4, 0.6].
//
// **The style by seed**, among those a hilt can swing, and never the dual style.
//
// **A chain**, measured: at the second and third rungs every move is a wind-up, a swing, an arc or a
// return -- never a special -- no chain runs past the tier's own count, and the breath after one is
// kept. At the top rung the specials come: a kata standing in reach, the style's own leap at a foe a
// few metres off (the flip slash, the strong leap, the staff's butterfly, the fast style's lunge), the
// back attack on somebody behind and the staff's kick.
//
// **What it will not do**: press anything rolling, in the air, staggered or looking away, and swing on
// once its blade is put away -- which takes back its own whooshes through its own voice.
//
// **The deflection**, measured against the table over thousands of bolts, with the player's own rules
// under it: nothing from behind, nothing in a special, nothing mid-swing below the top rank, and a bolt
// sent back where the top rank looks.
//
// **The clips a person from the catalogue is lent**: every style's moves and parries, and never a dual
// wind-up.
//
// **How hard a chain hits**: every swing lands a share of the body's own blow measured against its own
// cooldown, so a chain of five lands no more over a minute than the old one-swing-a-cooldown clock.
//
// **Which side is which**: a body's right is the player's camera's right and `evade.ts`'s roll to the
// right, for its parries, its kicks and its leaps alike.
//
// And what the two bodies do with it, read out of their own source where a body needs rapier and a
// scene to stand up: the move's clip taken off with the move, a bolt turned through one frame function,
// every whoosh filed under its own swinger.
//
// Synthetic throughout: every clip length, place and number below is written here or read out of the
// modules under test. Nothing comes from the game's archives.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { MOVES, SaberCombat, animForStyle, animOf, type MoveScriptNow, type SaberStyle, type SaberVoice } from '../../../src/combat/saber.ts';
import { DEFLECT_SCATTER, parryClip } from '../../../src/combat/deflect.ts';
import { rollVector } from '../../../src/world/evade.ts';
import {
  BACK_REACH,
  BLOCK_EYE,
  NPC_SABER_CLIPS,
  NPC_SABER_STATS,
  NPC_SABER_TUNE,
  NpcSaber,
  PARRY_ZONES,
  alongFacing,
  blockFrame,
  blowShare,
  canSwing,
  chainsAt,
  clearNpcSaberStats,
  defenceRank,
  deflectChance,
  liesToward,
  npcSaberReport,
  rightOf,
  specialsAt,
  styleClipNames,
  styleOf,
  stylesFor,
  tuneNpcSaber,
  type BladeAsk,
  type BlockAsk,
} from '../../../src/world/npcSaber.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** Dice of our own: the same run every time. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** How long an animation lasts, by kind: a swing a little under half a second, an arc a quarter, a kata two. */
function clipLength(anim: string): number | null {
  if (/SPECIAL|SOULCAL|SABERPROTECT/.test(anim)) return 2;
  if (/^BOTH_T\d/.test(anim)) return 0.25;
  if (/^BOTH_[SR]\d/.test(anim)) return 0.3;
  return 0.45;
}

/** A voice that only counts: what a body's moves would have whooshed, and how often its own were taken back. */
function countingVoice(): { voice: SaberVoice; swings: { style: string; clip: string; seconds: number }[]; cancels: number } {
  const out = { swings: [] as { style: string; clip: string; seconds: number }[], cancels: 0, voice: null as unknown as SaberVoice };
  out.voice = {
    swing: (style, clip, seconds) => out.swings.push({ style, clip, seconds }),
    cancel: () => {
      out.cancels++;
    },
  };
  return out;
}

const ask = (over: Partial<BladeAsk> = {}): BladeAsk => ({ now: 0, dt: 1 / 30, lit: true, hasTarget: true, attackState: true, chasing: false, gap: 1, reach: 1.9, offNose: 0, grounded: true, vy: 0, above: 0, tumbling: false, stunned: false, ...over });

interface Played {
  name: string;
  kind: string;
  anim: string;
  at: number;
  up: number | null;
}

/** Run a body for `seconds` of its own clock, asking the same thing every frame, and write down every move it began. */
function run(s: NpcSaber, a: BladeAsk, seconds: number, from = 0): Played[] {
  const out: Played[] = [];
  for (let t = from; t < from + seconds; t += a.dt) {
    a.now = t;
    const p = s.step(a, clipLength);
    // The machine hands back one kept record: read on the spot, as the game reads it.
    if (p) out.push({ name: p.move.name, kind: p.move.kind, anim: p.anim, at: t, up: p.impulse ? p.impulse.up : null });
  }
  return out;
}

/** The source of a file under `src/`, for the checks that read what a body does rather than stand one up. */
const source = (p: string): string => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** The body of a method in a source file, from its signature to the closing brace at its own indent. */
function methodBody(text: string, signature: string): string {
  const at = text.indexOf(signature);
  assert.ok(at >= 0, `no ${signature} in the source`);
  const line = text.lastIndexOf('\n', at) + 1;
  const indent = text.slice(line, at).match(/^\s*/)![0];
  const end = text.indexOf(`\n${indent}}\n`, at);
  assert.ok(end > at, `no end to ${signature}`);
  return text.slice(at, end);
}

function body(tier: number, style: SaberStyle, seed = 7, enemyNear: ((d: 'F' | 'B' | 'L' | 'R', r: number) => boolean) | null = null): { s: NpcSaber; v: ReturnType<typeof countingVoice> } {
  const v = countingVoice();
  const s = new NpcSaber(v.voice, enemyNear);
  s.own = style;
  s.weaponClass = style === 'staff' ? 'lightsaberStaff' : 'lightsaber';
  s.tier = tier;
  s.rand = rng(seed);
  return { s, v };
}

/** The attacks in each chain, a chain being everything between two returns to the ready stance. */
function chainLengths(plays: Played[]): number[] {
  const out: number[] = [];
  let n = 0;
  for (const p of plays) {
    if (p.kind === 'attack' || p.kind === 'special') n++;
    else if (p.kind === 'ready' && n > 0) {
      out.push(n);
      n = 0;
    }
  }
  return out;
}

// ---- the gates, by tier ----
{
  ok(!chainsAt(0) && !chainsAt(1) && chainsAt(2) && chainsAt(3) && chainsAt(4) && chainsAt(5), 'the move machine is swung from the second tier up, and tiers 0 and 1 keep the old random swings');
  ok(!specialsAt(2) && !specialsAt(3) && specialsAt(4) && specialsAt(5), 'the specials, the katas and the leaps come at the fourth tier');
  ok([0, 1, 2, 3, 4, 5].map((t) => deflectChance(t)).join(',') === '0,0,0.1,0.25,0.4,0.6', 'a bolt is turned away by the table: 0, 0, 0.1, 0.25, 0.4, 0.6');
  ok(deflectChance(9) === 0.6 && deflectChance(-2) === 0, 'a tier off the table takes the nearest end');
  ok(defenceRank(5) === 3 && defenceRank(2) === 1 && defenceRank(0) === 0, 'and only the top tier sends a bolt back where it looks');
}

// ---- the style by seed ----
{
  ok(stylesFor('lightsaber').join(',') === 'fast,medium,strong', 'a single blade swings the three single styles');
  ok(stylesFor('lightsaber2h').join(',') === 'medium,strong', "a two-handed one the medium and the strong, as the player's own rule has it: never the fast");
  const r2 = rng(4);
  const twoHanded = new Set<string>();
  for (let i = 0; i < 300; i++) twoHanded.add(styleOf(r2(), 'lightsaber2h'));
  ok(twoHanded.size === 2 && !twoHanded.has('fast'), `and a two-handed hilt's seed draws only those two (${[...twoHanded].join(', ')})`);
  const own2h = new NpcSaber();
  own2h.weaponClass = 'lightsaber2h';
  own2h.own = 'medium';
  tuneNpcSaber({ style: 'fast' });
  ok(own2h.style === 'medium', 'nor can the console put one on the fast style');
  tuneNpcSaber({ style: null });
  ok(stylesFor('lightsaberStaff').join(',') === 'staff', 'a double-bladed hilt swings the staff');
  const seen = new Set<string>();
  const r = rng(3);
  for (let i = 0; i < 300; i++) seen.add(styleOf(r(), 'lightsaber'));
  ok(seen.size === 3 && !seen.has('dual') && !seen.has('staff'), `a single blade draws each of its three styles and never the dual style (${[...seen].join(', ')})`);
  ok(styleOf(0.2, 'lightsaber') === styleOf(0.2, 'lightsaber') && styleOf(0, 'lightsaber') === 'fast' && styleOf(0.99, 'lightsaber') === 'strong', 'the same draw is the same style, which is what lets every browser draw it alike from one seed');
  ok(styleOf(0.5, 'lightsaberStaff') === 'staff' && styleOf(Number.NaN, null) === 'fast', 'a staff is always the staff, and a draw that is not a number takes the first');
}

// ---- tiers 0 and 1: nothing ----
{
  for (const tier of [0, 1]) {
    const { s, v } = body(tier, 'medium');
    const plays = run(s, ask(), 20);
    ok(plays.length === 0 && s.combat.move === 'NONE' && v.swings.length === 0 && !s.active, `tier ${tier}: the machine is never swung, so the body keeps the swings it always had`);
  }
}

// ---- tiers 2 and 3: a chain within one style ----
{
  for (const tier of [2, 3]) {
    for (const style of ['fast', 'medium', 'strong'] as SaberStyle[]) {
      const { s, v } = body(tier, style, 11 + tier);
      const plays = run(s, ask(), 60);
      const kinds = new Set(plays.map((p) => p.kind));
      const chains = chainLengths(plays);
      const max = NPC_SABER_TUNE.chainMax[tier];
      ok(plays.some((p) => p.kind === 'attack') && !kinds.has('special'), `tier ${tier} ${style}: it swings (${s.counts.swings} swings) and never a special`);
      ok(chains.length > 3 && Math.max(...chains) <= max, `tier ${tier} ${style}: ${chains.length} chains, none longer than the tier's ${max} (${chains.slice(0, 8).join(' ')})`);
      // Every attack here is played at its clip's own speed, so its real length is the clip's.
      ok(v.swings.length === s.counts.swings && v.swings.every((w) => Math.abs(w.seconds - (clipLength(w.clip) ?? -1)) < 1e-9 && w.style === style), `tier ${tier} ${style}: every swing is heard through its own voice, with its real length and its own style`);
      ok(v.cancels === v.swings.length, `tier ${tier} ${style}: and every move that cuts first takes back what the one before it laid out (${v.cancels} of ${v.swings.length})`);
      ok(plays.every((p) => NPC_SABER_CLIPS.includes(p.anim) && p.anim === animForStyle(MOVES.get(p.name)!, style)), `tier ${tier} ${style}: every clip it plays is one a person from the catalogue is lent, named in its own style`);
      if (tier === 3 && style === 'medium') {
        // The breath: from a chain's return to the ready stance until the next wind-up.
        const base = NPC_SABER_TUNE.rest[tier];
        let least = Infinity;
        for (let i = 1; i < plays.length; i++) {
          if (plays[i].kind !== 'start') continue;
          let j = i - 1;
          while (j >= 0 && plays[j].kind !== 'ready') j--;
          if (j >= 0 && j > 0) least = Math.min(least, plays[i].at - plays[j].at);
        }
        ok(least >= base * (1 - NPC_SABER_TUNE.restSpread) - 0.05, `tier 3: it breathes at least ${(base * (1 - NPC_SABER_TUNE.restSpread)).toFixed(2)} s between chains (${least.toFixed(2)} s the shortest)`);
      }
    }
  }
  // Somebody behind a tier that has no specials is not back-attacked.
  const behind = () => true;
  const { s } = body(3, 'medium', 5, behind);
  const plays = run(s, ask(), 30);
  ok(!plays.some((p) => p.name.startsWith('A_BACK')), 'tier 3 never back-attacks: that is a special');
  // A foe that has stepped out of reach, or stands off its nose, is not swung at.
  const far = body(3, 'medium');
  ok(run(far.s, ask({ gap: 3 }), 10).every((p) => p.kind === 'ready'), 'a foe out of reach is not swung at');
  const off = body(3, 'medium');
  ok(run(off.s, ask({ offNose: 1.2 }), 10).every((p) => p.kind === 'ready'), 'nor one off its nose');
  const stunned = body(3, 'medium');
  ok(run(stunned.s, ask({ stunned: true }), 10).every((p) => p.kind === 'ready'), 'nor anything while it is staggered');
}

// ---- tiers 4 and 5: the specials ----
{
  const was = { kata: NPC_SABER_TUNE.kataShare, kick: NPC_SABER_TUNE.kickShare, leap: NPC_SABER_TUNE.leapShare };
  // A kata, standing in reach at the ready, paid for out of the Force.
  tuneNpcSaber({ kataShare: 1 });
  {
    const { s } = body(5, 'medium', 21);
    const plays = run(s, ask(), 20);
    const katas = plays.filter((p) => p.name === 'A2_SPECIAL').length;
    ok(katas > 0 && s.counts.katas === katas, `tier 5 medium: its kata (${katas} in 20 s)`);
    ok(s.force < NPC_SABER_TUNE.force, `and it paid for them out of its Force (${s.force.toFixed(0)} left of ${NPC_SABER_TUNE.force})`);
    const three = body(3, 'medium', 21);
    ok(!run(three.s, ask(), 20).some((p) => p.name === 'A2_SPECIAL'), 'tier 3 never katas, however often it is asked');
  }
  tuneNpcSaber({ kataShare: was.kata });
  // The style's own leap at a foe a few metres off.
  const leaps: [SaberStyle, number, string][] = [
    ['medium', 4, 'A_FLIP_SLASH'],
    ['strong', 5, 'A_JUMP_T2B'],
    ['staff', 4, 'JUMPATTACK_STAFF_RIGHT'],
    ['fast', 2, 'A_LUNGE'],
  ];
  for (const [style, gap, move] of leaps) {
    const { s } = body(5, style, 31);
    const plays = run(s, ask({ attackState: false, chasing: true, gap }), 10);
    const got = plays.find((p) => p.kind === 'special');
    ok(!!got && got.name === move, `tier 5 ${style}, closing on a foe ${gap} m off: ${move} (${got?.name ?? 'nothing'})`);
    ok(plays.every((p) => NPC_SABER_CLIPS.includes(p.anim)), `and every clip of it is one a person from the catalogue is lent (${style})`);
    if (move === 'A_FLIP_SLASH') ok(got?.up === 400, 'the flip slash throws the body up at its own speed, which the body is handed');
    if (move === 'A_LUNGE') ok(got?.up === null, 'the lunge pushes it along the ground and not up');
    const near = body(5, style, 31);
    ok(!run(near.s, ask({ attackState: false, chasing: true, gap: 30 }), 10).some((p) => p.kind === 'special'), `but not at a foe thirty metres off (${style})`);
    const four = body(3, style, 31);
    ok(!run(four.s, ask({ attackState: false, chasing: true, gap }), 10).some((p) => p.kind === 'special'), `and never below the fourth tier (${style})`);
  }
  // A leap plays out in the air: the machine began it, so leaving the ground neither ends it nor starts
  // anything over it -- and its own whooshes are not taken back.
  for (const [style, gap, move] of leaps) {
    if (move === 'A_LUNGE') continue;
    const { s, v } = body(5, style, 31);
    const a = ask({ attackState: false, chasing: true, gap });
    let t = 0;
    for (; t < 10 && s.combat.move !== move; t += a.dt) {
      a.now = t;
      s.step(a, clipLength);
    }
    ok(s.combat.move === move, `a ${move} begins (${style})`);
    const cancels = v.cancels;
    const length = s.combat.duration;
    // Up it goes, as the body's own leap throws it on the frame it begins; the foe comes into reach mid-flight.
    a.grounded = false;
    a.above = 2;
    a.vy = 3;
    a.attackState = true;
    a.chasing = false;
    a.gap = 1;
    const began = t;
    const air: string[] = [];
    let held = true;
    for (t += a.dt; t < began + length - a.dt; t += a.dt) {
      a.now = t;
      const p = s.step(a, clipLength);
      if (p) air.push(p.move.name);
      if (s.combat.move !== move) held = false;
    }
    ok(held && air.length === 0 && v.cancels === cancels, `${move} plays out whole in the air, with nothing begun over it and none of its whooshes taken back (${air.join(' ') || 'nothing'} began)`);
  }
  // The back attack on somebody behind, and the staff's kick.
  const back = body(5, 'medium', 41, (d, r) => d === 'B' && r <= BACK_REACH);
  ok(run(back.s, ask(), 20).some((p) => p.name === 'A_BACK'), 'tier 5 medium turns on somebody behind with the back attack');
  const stab = body(5, 'fast', 41, (d) => d === 'B');
  ok(run(stab.s, ask(), 20).some((p) => p.name === 'A_BACKSTAB'), 'and the fast style stabs back');
  tuneNpcSaber({ kickShare: 1 });
  const staff = body(5, 'staff', 51);
  const kicks = run(staff.s, ask(), 10).filter((p) => p.name.startsWith('KICK_'));
  ok(kicks.length > 0 && staff.s.counts.kicks === kicks.length, `the staff kicks at the ready (${kicks.length} in 10 s)`);
  // Every one of them straight ahead, at the foe standing there, however its swings were being thrown:
  // with every swing thrown to a side, a kick read off that draw went sideways into the air.
  const swingDirs = NPC_SABER_TUNE.swingDirs;
  tuneNpcSaber({ swingDirs: 1, kickShare: 0.5 });
  const sideways = body(5, 'staff', 52);
  const kicked = run(sideways.s, ask(), 60).filter((p) => p.name.startsWith('KICK_'));
  ok(kicked.length > 3 && kicked.every((p) => p.name === 'KICK_F'), `a kick at a foe in front is the front kick, whatever way its last swing went (${kicked.length} kicks: ${[...new Set(kicked.map((p) => p.name))].join(', ')})`);
  tuneNpcSaber({ swingDirs });
  // A kick drawn for a body whose style has no kick is drawn again rather than pressed for ever (pressed,
  // it starts nothing and the body stands at the ready in reach). The draw and the machine read the same
  // style in the same frame, so no body reaches this today; it is put there by hand to pin the guard.
  tuneNpcSaber({ kickShare: 0, kataShare: 0 });
  const stuck = body(5, 'medium', 53);
  const sa = ask();
  stuck.s.step(sa, clipLength);
  ok(stuck.s.combat.current.kind === 'ready', 'a body at the ready');
  (stuck.s as unknown as { opening: string | null }).opening = 'kick';
  const after = run(stuck.s, sa, 5, sa.dt);
  ok(after.some((p) => p.kind === 'attack'), `a single blade left holding a kick's draw draws again and swings (${after.filter((p) => p.kind === 'attack').length} swings in 5 s)`);
  tuneNpcSaber({ kickShare: was.kick, leapShare: was.leap, kataShare: was.kata });
  // A long fight at the top tier, at the shipped numbers: every kind of move turns up.
  const { s } = body(5, 'strong', 61);
  const plays = run(s, ask(), 120);
  ok(s.counts.swings > 0 && s.counts.specials > 0 && s.counts.katas > 0, `tier 5 strong over two minutes in reach: ${s.counts.swings} swings, ${s.counts.katas} katas, ${chainLengths(plays).length} chains`);
  ok(Math.max(...chainLengths(plays)) <= NPC_SABER_TUNE.chainMax[5], 'and no chain past its own count');
}

// ---- what it will not do ----
{
  // Rolling or in the air on a jump of its own: nothing pressed, and a chain under way ends where it stands.
  const { s } = body(3, 'medium', 71);
  const a = ask();
  let t = 0;
  let started = false;
  for (; t < 5 && !started; t += a.dt) {
    a.now = t;
    s.step(a, clipLength);
    started = s.combat.current.kind === 'attack';
  }
  ok(started, 'a chain begins');
  a.tumbling = true;
  const after = run(s, a, 3, t);
  ok(after.every((p) => p.kind === 'return' || p.kind === 'ready'), `rolling, the chain runs into its return and nothing more starts (${after.map((p) => p.name).join(' ')})`);
  const air = body(5, 'medium', 72);
  ok(run(air.s, ask({ grounded: false, above: 2 }), 10).every((p) => p.kind === 'ready'), 'nor anything off the ground, where only a leap the machine began itself plays out');
  // Put away mid-move: the move let go of, and only its own whooshes taken back.
  const put = body(3, 'medium', 81);
  const b = ask();
  for (let i = 0; i < 20; i++) {
    b.now = i / 30;
    put.s.step(b, clipLength);
  }
  const cancels = put.v.cancels;
  b.lit = false;
  b.now += b.dt;
  put.s.step(b, clipLength);
  ok(put.s.combat.move === 'NONE' && put.v.cancels === cancels + 1, 'its blade put away, the move is let go of and its own whooshes are taken back through its own voice');
  // Let go of by its body in the middle of a chain -- a roll, a death, a change of hands -- with the
  // blade still lit: the same, and the next chain waits for a fresh ready.
  const drop = body(3, 'medium', 82);
  const c = ask();
  let dt = 0;
  for (; dt < 5 && drop.s.combat.current.kind !== 'attack'; dt += c.dt) {
    c.now = dt;
    drop.s.step(c, clipLength);
  }
  ok(drop.s.combat.current.kind === 'attack', 'a chain under way');
  const dropped = drop.v.cancels;
  drop.s.holster();
  ok(drop.s.combat.move === 'NONE' && drop.v.cancels === dropped + 1 && !drop.s.busy, 'let go of mid-chain by its body, the move goes and its own whooshes with it');
  c.now = dt;
  const next = drop.s.step(c, clipLength);
  ok(next?.move.kind === 'ready', 'and it comes back to the ready before anything else');
  // The console's rung and style go over a body's own, and come off again.
  const own = body(1, 'medium', 91);
  tuneNpcSaber({ tier: 4 });
  ok(own.s.active && own.s.specials && own.s.bladeTier === 4, 'every NPC blade on one rung from the console');
  tuneNpcSaber({ tier: null });
  ok(!own.s.active && own.s.bladeTier === 1, 'and back on its own');
  tuneNpcSaber({ style: 'strong' });
  ok(own.s.style === 'strong', 'one style from the console');
  tuneNpcSaber({ style: 'staff' });
  ok(own.s.style === 'medium', 'but never one its hilt cannot swing: a single blade is not swung as a staff');
  tuneNpcSaber({ style: 'dual' as SaberStyle });
  ok(NPC_SABER_TUNE.style === 'staff', 'and the dual style is not one the console can put on anybody');
  tuneNpcSaber({ style: null });
  ok(NPC_SABER_TUNE.style === null && own.s.style === 'medium', 'and back to each its own');
}

// ---- the deflection ----
{
  // The frame is the one both bodies build (`blockFrame`): a body at the origin facing +z.
  const block = (): BlockAsk =>
    blockFrame(
      {
        lit: true,
        tumbling: false,
        // A bolt coming straight at it from ahead, striking its chest.
        dir: new THREE.Vector3(0, 0, -1),
        hit: new THREE.Vector3(0, 1.3, 0.3),
        eye: new THREE.Vector3(),
        forward: new THREE.Vector3(),
        right: new THREE.Vector3(),
        look: new THREE.Vector3(1, 0, 1).normalize(),
      },
      0,
      0,
      0,
      0,
      BLOCK_EYE,
    );
  const out = new THREE.Vector3();
  const rate = (tier: number, n = 6000): number => {
    const { s } = body(tier, 'medium', 100 + tier);
    let turned = 0;
    for (let i = 0; i < n; i++) if (s.block(block(), out)) turned++;
    return turned / n;
  };
  ok(rate(0) === 0 && rate(1) === 0, 'tiers 0 and 1 turn nothing');
  for (const tier of [2, 3, 4, 5]) {
    const r = rate(tier);
    const want = NPC_SABER_TUNE.deflect[tier];
    ok(Math.abs(r - want) < 0.03, `tier ${tier} turns ${(r * 100).toFixed(1)} per cent of the bolts that reach it, against the table's ${want * 100}`);
  }
  const { s } = body(5, 'medium', 200);
  s.rand = () => 0;
  const back = block();
  back.hit.set(0, 1.3, -0.3);
  back.dir.set(0, 0, 1);
  ok(s.block(back, out) === null, 'a bolt from behind is not blocked');
  const unlit = block();
  unlit.lit = false;
  ok(s.block(unlit, out) === null, 'nor by a blade that is not out');
  const rolling = block();
  rolling.tumbling = true;
  ok(s.block(rolling, out) === null, 'nor in a roll');
  ok(s.block(block(), out) === 'upperRight' && out.dot(block().look) > 0.99, 'the top rank sends it where it looks, which is at what it is fighting, and a bolt at the chest takes an upper parry');
  const head = block();
  head.hit.set(0, 1.62, 0.3);
  ok(s.block(head, out) === 'top', 'one at the head takes the top parry');
  // A lower rank turns it back the way it came, scattered by its rank's own amount -- and never where it
  // looks, which here is square across the bolt's line so the two cannot be mistaken for each other.
  const low = body(2, 'medium', 201);
  low.s.rand = () => 0;
  const across = block();
  across.look.set(1, 0, 0);
  const zone = low.s.block(across, out);
  const scatter = DEFLECT_SCATTER[defenceRank(2)];
  const want = new THREE.Vector3(0, 0, 1).addScalar(-scatter).normalize();
  ok(zone !== null && out.distanceTo(want) < 1e-9 && out.dot(across.look) < 0, `a lower rank turns it back the way it came, scattered by its rank (${out.toArray().map((n) => n.toFixed(2)).join(', ')}), not where it looks`);
  // Nothing in a special: a kata, a leap, a kick has the body.
  const kataWas = NPC_SABER_TUNE.kataShare;
  tuneNpcSaber({ kataShare: 1 });
  const kata = body(5, 'medium', 202);
  const ka = ask();
  for (let t = 0; t < 10 && !kata.s.special; t += ka.dt) {
    ka.now = t;
    kata.s.step(ka, clipLength);
  }
  tuneNpcSaber({ kataShare: kataWas });
  kata.s.rand = () => 0;
  ok(kata.s.special && kata.s.block(block(), out) === null, `nor in a special, even at the top rank (${kata.s.combat.move})`);
  // Which side: a bolt striking the body's own right parries on the right, and its left on the left,
  // facing +z (right is -x) and facing +x (right is +z) alike.
  for (const facing of [0, Math.PI / 2]) {
    const side = body(5, 'medium', 203);
    side.s.rand = () => 0;
    const r = rightOf(facing, { x: 0, z: 0 });
    const fw = { x: Math.sin(facing), z: Math.cos(facing) };
    const onRight = blockFrame(block(), 0, 0, 0, facing, BLOCK_EYE);
    onRight.dir.set(-fw.x, 0, -fw.z);
    onRight.hit.set(fw.x * 0.3 + r.x * 0.35, 1.55, fw.z * 0.3 + r.z * 0.35);
    const onLeft = blockFrame(block(), 0, 0, 0, facing, BLOCK_EYE);
    onLeft.dir.set(-fw.x, 0, -fw.z);
    onLeft.hit.set(fw.x * 0.3 - r.x * 0.35, 1.55, fw.z * 0.3 - r.z * 0.35);
    const lowRight = blockFrame(block(), 0, 0, 0, facing, BLOCK_EYE);
    lowRight.dir.set(-fw.x, 0, -fw.z);
    lowRight.hit.set(fw.x * 0.3 + r.x * 0.2, 0.7, fw.z * 0.3 + r.z * 0.2);
    const behind = blockFrame(block(), 0, 0, 0, facing, BLOCK_EYE);
    behind.dir.set(fw.x, 0, fw.z);
    behind.hit.set(-fw.x * 0.3, 1.3, -fw.z * 0.3);
    const deg = Math.round((facing * 180) / Math.PI);
    ok(side.s.block(onRight, out) === 'upperRight' && side.s.block(onLeft, out) === 'upperLeft' && side.s.block(lowRight, out) === 'lowerRight', `facing ${deg} degrees, a bolt at its right shoulder parries up on the right, one at its left on the left, one low on its right low on the right`);
    ok(side.s.block(behind, out) === null, `facing ${deg} degrees, one from behind is not blocked`);
  }
  // Mid-swing: only the top rank blocks while attacking.
  const swinging = (tier: number): boolean => {
    const b = body(tier, 'medium', 300 + tier);
    const a = ask();
    for (let t = 0; t < 5 && b.s.combat.current.kind !== 'attack'; t += a.dt) {
      a.now = t;
      b.s.step(a, clipLength);
    }
    b.s.rand = () => 0;
    return b.s.combat.attacking && b.s.block(block(), out) !== null;
  };
  ok(!swinging(4), 'tier 4 in the middle of a swing does not block');
  ok(swinging(5), 'tier 5 blocks in the middle of one, as the top defence rank does');
  // The totals the console reads, and their clearing.
  clearNpcSaberStats(10);
  ok(NPC_SABER_STATS.blocks === 0 && NPC_SABER_STATS.since === 10, 'the totals clear from a time');
  const counted = body(5, 'medium', 400);
  counted.s.rand = () => 0;
  counted.s.block(block(), out);
  const report = npcSaberReport(70) as { total: { blocks: number; reached: number }; perMinute: { blocks: number } };
  ok(report.total.blocks === 1 && report.total.reached === 1 && report.perMinute.blocks === 1, 'and count every body together, a minute of the clock at a time');
}

// ---- the clips a person from the catalogue is lent ----
{
  const medium = styleClipNames('medium');
  ok(medium.includes('BOTH_A2_T__B_') && medium.includes('BOTH_S2_S1_T_') && medium.includes('BOTH_R2_B__S1') && medium.includes('BOTH_T2_BR_TL'), 'a style lends its attacks, its wind-ups, its returns and its arcs');
  ok(medium.includes('BOTH_STAND2') && medium.includes('BOTH_P1_S1_T_') && medium.includes('BOTH_A2_SPECIAL') && medium.includes('BOTH_FORCELEAP2_T__B_'), 'and its stance, its parries, its kata and the specials');
  const staff = styleClipNames('staff');
  ok(staff.includes('BOTH_A7_T__B_') && staff.includes('BOTH_S7_S7_T_') && staff.includes('BOTH_P7_S7_T_'), "the staff lends its own set, starts and parries included");
  ok(['fast', 'medium', 'strong', 'staff'].every((st) => styleClipNames(st as SaberStyle).every((n) => NPC_SABER_CLIPS.includes(n))), 'the list lent is every style a body may swing');
  ok(!NPC_SABER_CLIPS.some((n) => n.startsWith('BOTH_S6_S6') || n.startsWith('BOTH_A6_T')), 'and none of the dual style, which nobody but the player swings');
  const every = new Set(NPC_SABER_CLIPS);
  ok(canSwing('strong', (c) => every.has(c)) && !canSwing('strong', () => false), 'a body lent the clips can swing a style, and one lent nothing is left to its old swings');
  // The machine names its moves through a cache kept per style (`animOf`): one style's name must never
  // come back for another's, or whichever named a move first would fix its clip for every body, the
  // player's included.
  const overhead = MOVES.get('A_T2B')!;
  ok(animOf(overhead, 'medium') === 'BOTH_A2_T__B_' && animOf(overhead, 'strong') === 'BOTH_A3_T__B_' && animOf(overhead, 'medium') === 'BOTH_A2_T__B_', 'which the machine names in the style it swings, each style its own, asked in any order');
  let agree = 0;
  let asked = 0;
  for (const style of ['strong', 'fast', 'staff', 'medium', 'dual'] as SaberStyle[]) {
    for (const move of MOVES.values()) {
      asked++;
      if (animOf(move, style) === animForStyle(move, style)) agree++;
    }
  }
  ok(agree === asked, `and the cache answers what the name is worked out to be, for every move in every style (${agree} of ${asked})`);
  // Every parry a style can play is lent: `parryClip` itself, asked of the lent list, finds one for every zone.
  for (const style of ['fast', 'medium', 'strong', 'staff'] as SaberStyle[]) {
    const lent = new Set(NPC_SABER_CLIPS);
    const found = PARRY_ZONES.map((zone) => parryClip(style, zone, (c) => lent.has(c)));
    ok(found.every((c) => c !== null), `${style}: a parry for every place a bolt can strike (${found.join(' ')})`);
  }
}

// ---- somebody standing behind, and which side is which ----
{
  // Facing +z: behind is -z.
  ok(liesToward('B', BACK_REACH, 0, 0, 0, 0, 0, 0, -2), 'two metres straight behind is behind');
  ok(!liesToward('B', BACK_REACH, 0, 0, 0, 0, 0, 0, 2), 'two metres ahead is not');
  ok(!liesToward('B', BACK_REACH, 0, 0, 0, 0, 1.5, 0, -2), 'nor one off to the side of the line');
  ok(!liesToward('B', BACK_REACH, 0, 0, 0, 0, 0, 3, -2), 'nor one three metres over its head');
  // A body facing +z has its right at -x, as the player's camera looking down +z does; facing +x, at +z.
  ok(liesToward('R', 3, 0, 0, 0, 0, -2, 0, 0) && !liesToward('R', 3, 0, 0, 0, 0, 2, 0, 0) && liesToward('L', 3, 0, 0, 0, 0, 2, 0, 0), 'facing +z, its right is -x and its left +x');
  ok(liesToward('R', 3, Math.PI / 2, 0, 0, 0, 0, 0, 2) && liesToward('L', 3, Math.PI / 2, 0, 0, 0, 0, 0, -2), 'turned to face +x, its right is +z and its left -z');
  // One right for everything: the roll to the right, the right a push is carried along, the right of
  // the frame a bolt is judged in, and the camera's own for the body's facing.
  const at = { x: 0, z: 0 };
  const roll = { x: 0, z: 0 };
  const frame = blockFrame({ lit: true, tumbling: false, dir: new THREE.Vector3(), hit: new THREE.Vector3(), eye: new THREE.Vector3(), forward: new THREE.Vector3(), right: new THREE.Vector3(), look: new THREE.Vector3() }, 0, 0, 0, 0, 1);
  let same = true;
  for (let i = 0; i < 16; i++) {
    const facing = (i / 16) * Math.PI * 2 - Math.PI;
    rightOf(facing, at);
    rollVector('R', facing, roll);
    blockFrame(frame, 0, 0, 0, facing, 1);
    // The player's camera: yaw is its facing less a half turn, and its right is (cos yaw, 0, -sin yaw).
    const yaw = facing - Math.PI;
    const cam = { x: Math.cos(yaw), z: -Math.sin(yaw) };
    const pushed = alongFacing(facing, 0, 1, { x: 0, z: 0 });
    const ahead = alongFacing(facing, 1, 0, { x: 0, z: 0 });
    const close = (p: { x: number; z: number }, q: { x: number; z: number }): boolean => Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.z - q.z) < 1e-9;
    // Forward crossed with up is the right, in three's own axes.
    const cross = new THREE.Vector3(Math.sin(facing), 0, Math.cos(facing)).cross(new THREE.Vector3(0, 1, 0));
    if (!close(at, roll) || !close(at, cam) || !close(at, pushed) || !close(at, { x: frame.right.x, z: frame.right.z }) || !close(at, { x: cross.x, z: cross.z }) || !close(ahead, { x: Math.sin(facing), z: Math.cos(facing) })) same = false;
  }
  ok(same, "a body's right is the roll's right, the push's right, the parry's right and the player's camera's right, at every facing");
  ok(frame.eye.y === 1 && Math.abs(frame.forward.length() - 1) < 1e-9 && frame.forward.y === 0, 'and the frame stands its eye over its feet and its forward on the ground');
}

// ---- how hard a chain hits ----
{
  const cd = 1.6;
  ok(blowShare(Infinity, cd) === 1 && blowShare(cd, cd) === 1 && blowShare(cd * 3, cd) === 1, 'a swing a cooldown or more after the last blow lands the whole of one');
  ok(Math.abs(blowShare(cd / 4, cd) - 0.25) < 1e-12 && blowShare(0, cd) === 0, 'one hard on its heels that much less, and one at the same instant nothing');
  ok(blowShare(0.4, 0) === 1 && blowShare(0.4, cd, 1000) === 1, 'a body with no cooldown of its own, or a rate turned right up, lands every swing whole');
  // Every swing of a chain landing, over a minute at each tier and style: never more than one blow a
  // cooldown and the first. The count of swings is what the chain would have landed with each one whole.
  const minute = 60;
  const lines: string[] = [];
  let within = true;
  for (const tier of [2, 3, 4, 5]) {
    for (const style of ['fast', 'medium', 'strong', 'staff'] as SaberStyle[]) {
      const { s } = body(tier, style, 500 + tier);
      const a = ask();
      let lastId = -1;
      let blows = 0;
      let swings = 0;
      for (let t = 0; t < minute; t += a.dt) {
        a.now = t;
        s.step(a, clipLength);
        const c = s.combat;
        const cutting = c.attacking || c.kicking !== null;
        if (cutting && c.attackId !== lastId) {
          lastId = c.attackId;
          swings++;
          blows += s.shareOf(t, cd);
          s.landed(t);
        }
      }
      if (blows > minute / cd + 1 + 1e-9) within = false;
      if (style === 'medium' || (style === 'staff' && tier === 5)) lines.push(`tier ${tier} ${style}: ${swings} swings, ${blows.toFixed(1)} blows`);
    }
  }
  ok(within, `a minute of every swing landing is never more than ${(minute / cd + 1).toFixed(1)} of the body's own blows (${lines.join('; ')})`);
  // The same minute with the rate turned right up: every swing a whole blow, which is how much harder the
  // chains would have hit.
  const rate = NPC_SABER_TUNE.blowRate;
  tuneNpcSaber({ blowRate: 1000 });
  const { s: loud } = body(5, 'fast', 505);
  const la = ask();
  let loudId = -1;
  let loudBlows = 0;
  let loudSwings = 0;
  for (let t = 0; t < minute; t += la.dt) {
    la.now = t;
    loud.step(la, clipLength);
    if (loud.combat.attacking && loud.combat.attackId !== loudId) {
      loudId = loud.combat.attackId;
      loudSwings++;
      loudBlows += loud.shareOf(t, cd);
      loud.landed(t);
    }
  }
  tuneNpcSaber({ blowRate: rate });
  ok(loudSwings > minute / cd + 1 && Math.abs(loudBlows - loudSwings) < 1e-9, `with the rate turned right up every swing is a whole blow: ${loudSwings} in a minute against the ${(minute / cd).toFixed(1)} the body's own cooldown allows`);
  // A miss spends nothing: a body that has swung and missed for a cooldown lands its next blow whole.
  const miss = body(3, 'medium', 510);
  miss.s.landed(0);
  ok(miss.s.shareOf(0.8, cd) === 0.5 && miss.s.shareOf(2, cd) === 1, 'and a miss spends nothing: the share runs from the last blow that landed');
  miss.s.refill();
  ok(miss.s.shareOf(0.01, cd) === 1, 'a fresh life lands its first blow whole');
}

// ---- a move's own steps, worked out with nothing made ----
{
  // `scriptInto` is the allocation-free twin of `scriptNow`, which the player reads: every scripted move,
  // sampled along its whole length, must answer the same.
  const c = new SaberCombat();
  const into: MoveScriptNow = { fmove: 0, smove: 0, hop: Number.NaN };
  let scripted = 0;
  let samples = 0;
  let differ = 0;
  for (const move of MOVES.values()) {
    if (!move.script) continue;
    scripted++;
    c.move = move.name;
    c.duration = 3;
    for (let t = 0; t <= 3; t += 0.005) {
      c.timer = c.duration - t;
      const now = c.scriptNow();
      const has = c.scriptInto(into);
      samples++;
      const hop = now?.hop ?? null;
      if (!now || !has || now.fmove !== into.fmove || now.smove !== into.smove || (hop === null ? !Number.isNaN(into.hop) : hop !== into.hop)) differ++;
    }
  }
  ok(scripted >= 8 && differ === 0, `every scripted move steps and hops the same by both (${scripted} moves, ${samples} samples, ${differ} apart)`);
  c.move = 'A_T2B';
  ok(!c.scriptInto(into) && into.fmove === 0 && into.smove === 0 && Number.isNaN(into.hop) && c.scriptNow() === null, 'and a move with no script has none either way');
}

// ---- what the two bodies do with it, read out of their own source ----
{
  const npcs = source('world/npcs.ts');
  const mobile = source('world/mobiles/mobile.ts');
  const bolts = source('combat/bolts.ts');
  for (const [name, text] of [
    ['a fighter', npcs],
    ['a person from the catalogue', mobile],
  ] as const) {
    // A move is played held, so nothing but another clip or this ends it: a body let go of mid-move (and
    // a person handed to another browser, which only ever gives it its loop after) would stand frozen in
    // the move's last frame for as long as it was held.
    ok(/this\.blades\.holster\(\);\s*\n\s*this\.takeBladeClip\(\);/.test(methodBody(text, 'private dropBlades(): void {')), `${name}: its move let go of takes the move's clip off with it`);
    // Judged in `blockFrom`, which a bolt reaching this body here and one reaching its copy on another
    // browser (the keeper's answer, `npcHurt`) both ask; `blockBolt` is the first of the two.
    ok(/blockFrame\(a, this\.pos\.x, this\.pos\.y, this\.pos\.z, this\.facing, /.test(methodBody(text, 'private blockFrom(dir: THREE.Vector3, point: THREE.Vector3, out: THREE.Vector3): boolean {')) && /if \(!this\.blockFrom\(bolt\.dir, point, out\)\) return false;/.test(methodBody(text, 'blockBolt(bolt: Bolt, point: THREE.Vector3, out: THREE.Vector3): boolean {')), `${name}: a bolt meeting its blade is judged in the one shared frame`);
    // Pinned as behaviour and not as the presence of a call: the driven copy holds the bolt for the blow
    // it strikes in the same breath, and the keeper's blade, asked with it, marks the parry for every
    // other screen and flies a bolt back.
    ok(/if \(this\.driven\) \{[\s\S]*?this\.heldBoltAt = this\.now;[\s\S]*?return false;\s*\}/.test(methodBody(text, 'blockBolt(bolt: Bolt, point: THREE.Vector3, out: THREE.Vector3): boolean {')), `${name}: a copy driven from elsewhere never turns a bolt itself, and holds it for the blow it is about to ask of its keeper`);
    ok(/const bolt = this\.heldBoltAt === this\.now \? this\.heldBolt : null;/.test(methodBody(text, 'damage(amount: number, from?: THREE.Vector3, push = 0, source?: Living | null): void {')), `${name}: and that blow hands the keeper the bolt it held`);
    ok(/if \(this\.blockFrom\([^)]*\)\) \{\s*this\.mark = 'block';[\s\S]{0,400}\.fire\(/.test(methodBody(text, 'npcHurt(')), `${name}: and its keeper's blade answers for it: the parry marked for every other screen, and a bolt flown back`);
    ok(/combatSounds\.saberSwing\(style, bx, by, bz, clip, seconds, this\)/.test(text) && /cancel: \(\) => combatSounds\.saberCancel\(this\)/.test(text), `${name}: its whooshes go out with their real length and filed under itself, and its cancel takes back only its own`);
    ok(/alongFacing\(this\.facing, im\.forward \* JKA_UNIT, im\.right \* JKA_UNIT, this\.pushAt\)/.test(methodBody(text, 'private leap(im: Impulse): void {')), `${name}: a leap is carried along its own facing and its own right`);
    ok(/shareOf\(this\.now, /.test(methodBody(text, 'private stepBlades(')), `${name}: every swing of the machine's opens with its share of a blow`);
  }
  ok(/this\.dropBlades\(\);/.test(methodBody(mobile, 'npcSetDriven(driven: boolean): void {')), 'a person handed to another browser lets its move go');
  // Taking the clip off takes off only the move's own, and really ends it: a held shot stays busy, at
  // full weight over the loop, until `stopShot` lets it go (`MobileAnimator.busy`), and a held override
  // on a fighter's rig until `stopOverride`.
  ok(/if \(animator && this\.bladeAnim && animator\.shot === this\.bladeAnim\) animator\.stopShot\(/.test(methodBody(mobile, 'private takeBladeClip(): void {')), "a person's move clip is let go of through the animator, and only while it is still the one on it");
  ok(/if \(rig && this\.bladeAnim && rig\.overrideName === this\.bladeAnim\) rig\.stopOverride\(\);/.test(methodBody(npcs, 'private takeBladeClip(): void {')), "a fighter's through its rig, the same way");
  ok(/hold: true/.test(methodBody(mobile, 'private stepBlades(')) && /get busy\(\): boolean \{\s*\n\s*return !!this\.shotAction && \(this\.hold \|\| !this\.shotEnded\);/.test(source('world/mobiles/animator.ts')), 'which matters because the move is played held, and a held shot is busy until it is let go of');
  // The fighter's death: its clip taken first, the move let go of after, so the fall blends out of the swing.
  const die = methodBody(npcs, 'private die(): void {');
  ok(die.indexOf('rig.play(clip, { fadeIn: 0.08, hold: true })') >= 0 && die.indexOf('this.dropBlades();') > die.indexOf('rig.play(clip, { fadeIn: 0.08, hold: true })'), "a fighter's death takes the rig before its move is let go of");
  // The bolt: turned only for a real bolt, never a picture of another browser's; the blocker's own shot
  // from then on, its body passed over as it leaves, and homing on nothing.
  const branch = bolts.slice(bolts.indexOf('struck.blockBolt?.('), bolts.indexOf('continue;', bolts.indexOf('struck.blockBolt?.(')));
  ok(/if \(struck && !b\.inert && struck\.blockBolt\?\.\(b, hitPoint, bounce\)\)/.test(bolts), 'a bolt is offered to a blade only when it is real and not a picture of somebody else\'s');
  ok(/b\.owner = 'enemy';/.test(branch) && /b\.exclude = /.test(branch) && /b\.homing = null;/.test(branch) && /b\.dir\.copy\(bounce\);/.test(branch) && /b\.vel\.copy\(bounce\)/.test(branch), 'and one turned is the blocker\'s own shot, leaving its body, flying the new way, homing on nothing');
}

console.log(`${checks} checks passed`);
