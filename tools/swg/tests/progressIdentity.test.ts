// The day-one proof: an empty progress record changes no number the player meets, to the bit.
//
// Every stat progression can change is read through one resolver now, and the promise the whole pass rests on
// (the owner's: "until something is earned the game plays exactly as it does now") is that a record with
// nothing in it hands every read site the very number it held before -- not a number worked out again that
// happens to print the same. So this compares by `Object.is`, against today's literals written out here by
// hand, and reads the read sites as text for a stray copy of a literal beside the resolver, which a later edit
// could otherwise quietly bring back.
//
//   1. today's numbers, each through the empty record, the catalogue and the player's kept fields, and the
//      fields outside the player the game writes only when the stats move (the camera's aim blend, the
//      player's own saber), built for real and driven;
//   2. a gun's and a grenade's profile handed back as the very table object, until a stat of theirs is earned,
//      then one copy for good, rewritten in place (the Bounty Hunter's charge survives a payout);
//   3. `apply` hands back what it is given, sign of nought and NaN included, for every stat;
//   4. a fall, rolled and not, from half a metre to forty, through the real movement: every step's harm and
//      velocity held to today's own, written out here as they were measured before this pass, and the same
//      with the new fields at their identity as with none;
//   5. XP short of a whole rating, and a pool banked with no node, grant nothing at all;
//   6. the read sites hold no stray literal, and every one still reads what progress makes of it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GUNS, type GunType } from '../../../src/combat/guns.ts';
import { GADGETS } from '../../../src/combat/gadgets.ts';
import { THROW_BALL, THROW_SHAPE, lobbed, throwVelocity } from '../../../src/combat/demoMath.ts';
import { SaberCombat, animSpeed, MOVES, type SaberInput } from '../../../src/combat/saber.ts';
import { ThirdPersonCamera } from '../../../src/core/camera.ts';
import type { Input } from '../../../src/core/input';
import { JkaMovement, UNIT, type MoveCommand, type MoveEvents } from '../../../src/player/jkaMove.ts';
import { PlayerStats } from '../../../src/player/playerStats.ts';
import { grantChanges } from '../../../src/progress/learn.ts';
import { applyProgress, emptyRecord, fnv32, type ProgressRecord } from '../../../src/progress/record.ts';
import { STATS, baseOf, resolveStats, type StatDef, type StatId } from '../../../src/progress/stats.ts';
import { PROGRESS_RULES } from '../../../src/progress/tune.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---- 1. today's numbers --------------------------------------------------------------------------------
// Written out by hand, as the read sites held them before this pass: never read back from the catalogue.
const TODAY: Record<string, number> = {
  'health.max': 100,
  'health.regen': 4,
  'resist.burn': 1,
  'fall.safeExtra': 0,
  'fall.rollDivisor': 3,
  'fall.rollFree': 0,
  'roll.iframes': 0,
  'move.airAccel': 1,
  'gun.steady': 1,
  'gun.aimRate': 0.15,
  'launcher.pickCos': 0.9,
  'saber.damage': 1,
  'saber.swing': 1,
  'saber.defense': 3,
  'melee.push': 1,
  'throw.lift': 4,
  'charge.packs': 1,
  'blast.self': 0.35,
  'chain.reach': 0.8,
  'grenade.cooldown': 1,
  'grenade.stock': 1,
  'grenade.count': 1,
  'demo.cook': 0,
  'demo.arc': 0,
  'demo.burst': 0,
  'demo.sticky': 0,
  'demo.lock': 0,
  'demo.payload': 0,
  'demo.remote': 0,
  'demo.shaped': 0,
  'demo.chainAll': 0,
  'demo.stagger': 0,
  'demo.dangerClose': 0,
  // The grapple's (its pass's wave 3): the numbers `GRAPPLE_TUNE` shipped with, which its read sites hand in.
  'grapple.range': 100,
  'grapple.reel': 6,
  'grapple.yank': 18,
  'grapple.swing': 1,
  'tether.strength': 40,
};
const empty = resolveStats(emptyRecord('c1'), PROGRESS_RULES);
{
  const numbered = (STATS as readonly StatDef[]).filter((s) => typeof s.base === 'number').map((s) => s.id);
  const unlisted = numbered.filter((id) => !(id in TODAY));
  const extra = Object.keys(TODAY).filter((id) => !numbered.includes(id));
  ok(unlisted.length === 0 && extra.length === 0, `every stat with one number for a base has today's literal written out here, and nothing else (${numbered.length}${unlisted.length ? `; unlisted ${unlisted.join(', ')}` : ''}${extra.length ? `; not stats ${extra.join(', ')}` : ''})`);
  const offBase = Object.entries(TODAY).filter(([id, v]) => !Object.is(baseOf(id as StatId), v)).map(([id]) => id);
  ok(offBase.length === 0, `the catalogue's base is today's literal, bit for bit, for every one${offBase.length ? `: ${offBase.join(', ')}` : ''}`);
  const moved = Object.entries(TODAY).filter(([id, v]) => !Object.is(empty.apply(id as StatId, v), v)).map(([id]) => id);
  ok(moved.length === 0, `the empty record answers each with the very number it was handed${moved.length ? `: ${moved.join(', ')}` : ''}`);
  ok(empty.touched().length === 0, 'and has no entry at all');
  const s = new PlayerStats();
  const kept: Record<string, number> = {
    'health.max': s.healthMax,
    'health.regen': s.healthRegen,
    'resist.burn': s.burnScale,
    'fall.safeExtra': s.fallSafeExtra,
    'fall.rollDivisor': s.rollDivisor,
    'fall.rollFree': s.rollFree,
    'roll.iframes': s.rollIframes,
    'move.airAccel': s.airAccel,
    'gun.aimRate': s.aimRate,
    'gun.steady': s.steady,
    'saber.damage': s.saberDamage,
    'saber.swing': s.saberSwing,
    'saber.defense': s.saberDefense,
    'melee.push': s.meleePush,
    'blast.self': s.blastSelf,
    'chain.reach': s.chainReach,
    'grenade.cooldown': s.grenadeCooldown,
    'grenade.stock': s.grenadeStock,
    'grenade.count': s.grenadeCount,
    'throw.lift': s.throwLift,
    'charge.packs': s.packs,
    'launcher.pickCos': s.pickCos,
  };
  const keptOff = Object.entries(kept).filter(([id, v]) => !Object.is(v, TODAY[id])).map(([id]) => id);
  ok(keptOff.length === 0, `the player's kept fields are today's numbers before any record (${Object.keys(kept).length} fields)${keptOff.length ? `: ${keptOff.join(', ')}` : ''}`);
  ok(!s.update(emptyRecord('c1')) && s.version === 0, 'and an empty record moves nothing and bumps no version');
  const after = Object.entries(kept).filter(([id]) => !Object.is((s as unknown as Record<string, number>)[fieldOf(id)], TODAY[id])).map(([id]) => id);
  ok(after.length === 0, 'nor any field');

  // What the game writes from the stats only when they move: with an empty record nothing is written, so these
  // fields' own starting values are what the player meets, and each is held to today's number by itself.
  const cam = new ThirdPersonCamera(1);
  const saber = new SaberCombat();
  ok(Object.is(cam.aimRate, TODAY['gun.aimRate']) && Object.is(saber.swingScale, TODAY['saber.swing']), "the camera's aim rate and a saber's swing start at today's 0.15 and 1, not at a number of their own");
  // The view comes to the shoulder as it always did: a share of 0.15 a frame, worked out here by hand.
  const input = { wheel: 0, mouseDX: 0, mouseDY: 0, locked: true } as unknown as Input;
  const target = new THREE.Vector3();
  cam.aim = true;
  let want = 0;
  const blends: string[] = [];
  for (let i = 0; i < 6; i++) {
    cam.update(input, target, null);
    want += (1 - want) * 0.15;
    if (!Object.is(cam.aimAmount, want)) blends.push(`frame ${i + 1}: ${cam.aimAmount} not ${want}`);
  }
  ok(blends.length === 0, `aiming, the view comes in by today's 0.15 a frame, bit for bit over six frames${blends.length ? `: ${blends.join('; ')}` : ''}`);
  const quick = new ThirdPersonCamera(1);
  quick.aimRate = 0.2775;
  quick.aim = true;
  quick.update(input, target, null);
  ok(Object.is(quick.aimAmount, 0.2775), 'and the rate written into it is the rate it comes in by');
  // A saber's swing as it always was: every move's speed its style's own, and a swing scale written in times it.
  const swingInput = (over: Partial<SaberInput> = {}): SaberInput => ({ fmove: 0, smove: 0, grounded: true, vy: 0, aboveGround: 0, jumpHeld: false, crouch: false, attack: true, force: 100, attackPressed: false, altAttack: false, altAttackPressed: false, rollEnding: false, inSpecialJump: false, ...over });
  const swings = (scale: number | null): { move: string; speed: number; duration: number }[] => {
    const sc = new SaberCombat();
    if (scale !== null) sc.swingScale = scale;
    sc.style = 'medium';
    const out: { move: string; speed: number; duration: number }[] = [];
    const noClip = () => null;
    const step = (over: Partial<SaberInput>) => {
      const p = sc.update(0.016, true, swingInput(over), noClip);
      if (p) out.push({ move: p.move.name, speed: p.speed, duration: sc.duration });
    };
    step({ attack: false });
    step({ attack: true, attackPressed: true });
    for (let i = 0; i < 200; i++) step({ attack: true });
    return out;
  };
  const plain = swings(null);
  const style = 'medium';
  ok(plain.length >= 3 && plain.every((p) => Object.is(p.speed, animSpeed(MOVES.get(p.move)!, style))), `a saber left alone plays every move at its style's own speed, bit for bit (${plain.length} moves)`);
  const quicker = swings(2);
  // Twice as fast, the same steps hold more moves and the chain runs on further: every move both played is compared.
  const plainOf = new Map(plain.map((p) => [p.move, p]));
  const both = quicker.filter((q) => plainOf.has(q.move));
  ok(both.length >= 4 && both.every((q) => Object.is(q.speed, plainOf.get(q.move)!.speed * 2) && Object.is(q.duration, plainOf.get(q.move)!.duration / 2)), `and one whose swing scale is written plays every move at twice the speed in half the time (${both.length} moves)`);
}

function fieldOf(id: string): string {
  const m: Record<string, string> = { 'health.max': 'healthMax', 'health.regen': 'healthRegen', 'resist.burn': 'burnScale', 'fall.safeExtra': 'fallSafeExtra', 'fall.rollDivisor': 'rollDivisor', 'fall.rollFree': 'rollFree', 'roll.iframes': 'rollIframes', 'move.airAccel': 'airAccel', 'gun.aimRate': 'aimRate', 'gun.steady': 'steady', 'saber.damage': 'saberDamage', 'saber.swing': 'saberSwing', 'saber.defense': 'saberDefense', 'melee.push': 'meleePush', 'blast.self': 'blastSelf', 'chain.reach': 'chainReach', 'grenade.cooldown': 'grenadeCooldown', 'grenade.stock': 'grenadeStock', 'grenade.count': 'grenadeCount', 'throw.lift': 'throwLift', 'charge.packs': 'packs', 'launcher.pickCos': 'pickCos' };
  return m[id];
}

// ---- 2. the gun and grenade profiles -------------------------------------------------------------------
{
  const types = Object.keys(GUNS) as GunType[];
  const specs = GADGETS.filter((g) => g.grenade).map((g) => g.grenade!);
  const s = new PlayerStats();
  ok(types.length >= 17 && types.every((t) => s.gun(t) === GUNS[t]), `every gun's profile is the table's own object while nothing is earned (${types.length})`);
  ok(specs.length >= 8 && specs.every((g) => s.grenade(g) === g), `and every grenade's spec its gadget's own (${specs.length})`);
  const spread = GUNS.blaster.primary.spread;
  // A Marksmanship rating of 1: the hip and aimed spreads have an entry.
  const rec: ProgressRecord = emptyRecord('c1');
  rec.core.marksmanship = 40;
  ok(s.update(rec) && s.version === 1, 'a record that earns a gun stat moves the stats once');
  const copy = s.gun('blaster');
  ok(copy !== GUNS.blaster && copy.primary !== GUNS.blaster.primary, 'and from then on a gun is a copy of its own');
  ok(Object.is(copy.primary.spread, spread * (1 + ((PROGRESS_RULES.core.marksmanship.spread - 1) * 1) / 100)) && Object.is(GUNS.blaster.primary.spread, spread), 'with its spread worked out, the table untouched');
  ok(s.gun('blaster') === copy && s.gun('blaster').primary === copy.primary, 'the same copy every time it is asked for');
  const v = s.version;
  rec.core.marksmanship = 50;
  rec.pools.demolitions = 3000;
  ok(!s.update(rec) && s.version === v && s.gun('blaster') === copy, 'a change that moves no whole rating moves no stat: the same version and the very same object');
  rec.core.marksmanship = 40 * 25 ** 1.5;
  ok(s.update(rec) && s.gun('blaster') === copy && copy.primary.spread < spread * 0.999, 'one that moves a gun stat leaves the same object with the new number in it (the kit\'s charge survives a payout)');
  ok(Object.is(copy.primary.damage, GUNS.blaster.primary.damage) && Object.is(copy.primary.fireTime, GUNS.blaster.primary.fireTime), 'and a field nothing grants is the table\'s own number');
  ok(s.update(emptyRecord('c1')) && s.gun('blaster') === copy && Object.is(copy.primary.spread, spread) && Object.is(copy.primary.aimSpread, GUNS.blaster.primary.aimSpread), 'a respec writes the bases back into that same copy');
  ok(specs.every((g) => s.grenade(g) === g), 'a gun stat never makes a grenade a copy');
  // A grenade the same way: Shrapnel Casing gives the thermal detonator a copy of its own once, and a respec and
  // the node again rewrite that very copy.
  const thermal = GADGETS.find((g) => g.id === 'thermal')!.grenade!;
  const radius = thermal.radius;
  const owning = emptyRecord('c1');
  applyProgress(owning, grantChanges(owning, 'demo.ordnance.2', 1, PROGRESS_RULES).ch);
  const gs = new PlayerStats();
  ok(gs.grenade(thermal) === thermal, 'before anything is owned the thermal detonator is its own spec');
  ok(gs.update(owning), 'Shrapnel Casing moves the stats');
  const tcopy = gs.grenade(thermal);
  ok(tcopy !== thermal && Object.is(tcopy.radius, radius * PROGRESS_RULES.demo.shrapnel) && Object.is(thermal.radius, radius) && gs.grenade(thermal) === tcopy, 'and from then on the grenade is one copy of its own, its radius worked out and the gadget untouched');
  ok(Object.is(tcopy.damage, thermal.damage) && Object.is(tcopy.speed, thermal.speed) && Object.is(tcopy.fuse, thermal.fuse), "with every field nothing grants the gadget's own number");
  ok(gs.update(emptyRecord('c1')) && gs.grenade(thermal) === tcopy && Object.is(tcopy.radius, radius), 'a respec writes the base back into that same copy');
  ok(gs.update(owning) && gs.grenade(thermal) === tcopy && Object.is(tcopy.radius, radius * PROGRESS_RULES.demo.shrapnel), 'and the node owned again writes its number into it once more, never a new object');
}

// ---- 3. apply hands back what it is given ----------------------------------------------------------------
{
  const odd = [0, -0, 1e-300, 0.35, 1 / 3, 1e300, NaN];
  const bad: string[] = [];
  for (const st of STATS as readonly StatDef[]) for (const x of odd) if (!Object.is(empty.apply(st.id as StatId, x), x)) bad.push(`${st.id} ${x}`);
  ok(bad.length === 0, `apply(id, x) is x itself for every stat and every x of ${odd.join(', ')} (${STATS.length} stats)${bad.length ? `: ${bad.slice(0, 6).join('; ')}` : ''}`);
}

// ---- 4. falls through the real movement ------------------------------------------------------------------
{
  const s = new PlayerStats();
  const cmdOf = (crouch: boolean, withFields: boolean): MoveCommand => {
    const c: MoveCommand = { forward: new THREE.Vector3(0, 0, -1), right: new THREE.Vector3(1, 0, 0), fmove: 1, smove: 0, walk: false, crouch, roll: false, jump: false, jumpPressed: false, attack: false, speedScale: 1 };
    if (withFields) {
      c.fallSafeExtra = s.fallSafeExtra / UNIT;
      c.rollDivisor = s.rollDivisor;
      c.rollFree = s.rollFree;
      c.airAccel = s.airAccel;
    }
    return c;
  };
  /** Every step's harm, what a roll saved, and the velocity, dropped from a height until half a second after landing. */
  const drop = (height: number, crouch: boolean, level: number, withFields: boolean, cmd = cmdOf(crouch, withFields)): number[][] => {
    const jka = new JkaMovement();
    jka.forceLevel = level;
    jka.reset();
    const pos = new THREE.Vector3(0, height, 0);
    const vel = new THREE.Vector3();
    let grounded = false;
    let after = -1;
    const out: number[][] = [];
    const force = { value: 100, spend: () => {} };
    for (let i = 0; i < 2000 && after < 30; i++) {
      const ev: MoveEvents = jka.step(1 / 60, vel, pos, grounded, cmd, force);
      out.push([ev.damage, ev.rollSaved, vel.x, vel.y, vel.z]);
      pos.addScaledVector(vel, 1 / 60);
      if (pos.y <= 0) {
        pos.y = 0;
        if (!grounded) after = 0;
        grounded = true;
      }
      if (after >= 0) after++;
    }
    return out;
  };
  const heights = [0.5, 1, 2, 3, 5, 8, 9, 12, 20, 40];
  // Today's falls, measured through the movement as it stood before this pass (the same drops, the same steps)
  // and written out by hand, so a change to the movement's own arithmetic that both runs below would share is
  // still caught: each run's whole harm, by Force jump level, rolled or not, over the heights above...
  const TODAY_HARM: Record<string, number[]> = {
    'Force jump 0, not rolled': [0, 0, 3, 11, 27, 51, 59, 60, 60, 60],
    'Force jump 0, rolled': [0, 0, 1, 4, 9, 17, 20, 20, 20, 20],
    'Force jump 3, not rolled': [0, 0, 0, 0, 0, 0, 0, 11, 60, 60],
    'Force jump 3, rolled': [0, 0, 0, 0, 0, 0, 0, 4, 20, 20],
  };
  // ...and every step of all forty, their count, harm and velocity, as one FNV-1a over their text: the air
  // control a fall drifts by, the landing and the half second after it, to the bit. A deliberate change to the
  // movement moves it, and the line below prints the new one.
  const TODAY_TRACE = '3a705ad3';
  const bad: string[] = [];
  const harmOff: string[] = [];
  let trace = '';
  let hurt = 0;
  for (const level of [0, 3]) {
    for (const crouch of [false, true]) {
      const name = `Force jump ${level}, ${crouch ? 'rolled' : 'not rolled'}`;
      const totals: number[] = [];
      for (const h of heights) {
        const a = drop(h, crouch, level, false);
        const b = drop(h, crouch, level, true);
        if (a.length !== b.length || a.some((row, i) => row.some((x, j) => !Object.is(x, b[i][j])))) bad.push(`${h} m, ${crouch ? 'rolled' : 'not rolled'}, Force jump ${level}`);
        if (a.some((row) => row[0] > 0)) hurt++;
        totals.push(a.reduce((sum, r) => sum + r[0], 0));
        trace += `${a.length};` + a.map((r) => [r[0], r[2], r[3], r[4]].join(',')).join(';') + '|';
      }
      if (totals.join() !== TODAY_HARM[name].join()) harmOff.push(`${name}: ${totals.join(',')} not ${TODAY_HARM[name].join(',')}`);
    }
  }
  ok(harmOff.length === 0, `every drop's whole harm is today's, written out (40 runs)${harmOff.length ? `: ${harmOff.join('; ')}` : ''}`);
  ok(fnv32(trace) === TODAY_TRACE, `and every step of every drop, harm and velocity, is today's to the bit (${fnv32(trace)}, today ${TODAY_TRACE})`);
  ok(bad.length === 0, `every step's harm, roll saving and velocity is the same with the new fields at their identity as with none (${heights.length} heights, rolled and not, Force jump 0 and 3)${bad.length ? `: ${bad.join('; ')}` : ''}`);
  ok(hurt >= 10, `and the drops really hurt somebody, so the harm is compared and not only nought (${hurt} of 40 runs)`);
  // The fields are read: a divisor of 10 saves more on a hurting roll, and a rolled fall reports what it saved.
  const plain = drop(9, true, 0, false);
  const softer = drop(9, true, 0, false, { ...cmdOf(true, false), rollDivisor: 10 });
  const harm = (rows: number[][]) => rows.reduce((a, r) => a + r[0], 0);
  const saved = (rows: number[][]) => rows.reduce((a, r) => a + r[1], 0);
  ok(harm(softer) < harm(plain) && saved(plain) > 0 && saved(softer) > saved(plain), `the movement reads them: a 9 m roll takes ${harm(plain)} and saves ${saved(plain)} at today's 3, ${harm(softer)} and ${saved(softer)} at 10`);
  const free = drop(8, true, 0, false, { ...cmdOf(true, false), rollFree: 8 });
  ok(harm(free) === 0 && saved(free) > 0 && harm(drop(8, true, 0, false)) > 0, 'and a landing roll from no higher than its free height takes nothing');
  const safer = drop(5, false, 0, false, { ...cmdOf(false, false), fallSafeExtra: 3 / UNIT });
  ok(harm(safer) < harm(drop(5, false, 0, false)) && harm(safer) > 0, `three metres more of a harmless fall takes a 5 m drop's harm from ${harm(drop(5, false, 0, false))} to ${harm(safer)}`);
  const drift = (rows: number[][]) => rows.find((r) => r[2] !== 0 || r[4] !== 0);
  const steer = drop(5, false, 0, false, { ...cmdOf(false, false), airAccel: 1.5 });
  const steerPlain = drop(5, false, 0, false);
  ok(drift(steer) !== undefined && Math.hypot(drift(steer)![2], drift(steer)![4]) > Math.hypot(drift(steerPlain)![2], drift(steerPlain)![4]), 'and more air control drifts a fall further on its first step');
}

// ---- 5. short of a whole rating, and a pool with no node -------------------------------------------------
{
  const rec = emptyRecord('c2');
  for (const s of ['marksmanship', 'melee', 'fortitude', 'acrobatics'] as const) rec.core[s] = 39;
  rec.pools.demolitions = 20000;
  const r = resolveStats(rec, PROGRESS_RULES);
  ok(r.touched().length === 0, 'core XP short of rating 1 and Demolitions XP banked with no node grant nothing at all');
  const s = new PlayerStats();
  ok(!s.update(rec) && s.version === 0 && s.gun('disruptor') === GUNS.disruptor && GUNS.disruptor !== undefined, 'and the player\'s stats do not move for it');
}

// ---- 6. no stray literal at the read sites ----------------------------------------------------------------
{
  const read = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8');
  const bh = read('src/combat/bountyHunter.ts');
  const player = read('src/player/player.ts');
  const jka = read('src/player/jkaMove.ts');
  const cam = read('src/core/camera.ts');
  const world = read('src/world/world.ts');
  ok(!/0\.35\s*\*\s*\(1\s*-/.test(bh) && /player\.stats\.blastSelf\s*\*\s*\(1\s*-/.test(bh), 'the blast on yourself reads its stat and holds no 0.35 of its own');
  ok(!/distanceTo\(at\)\s*<\s*radius\s*\*\s*0\.8\)/.test(bh) && /distanceTo\(at\) < radius \* player\.stats\.chainReach/.test(bh), 'the chain reads its stat, not 0.8');
  ok(!/targetAhead\(ctx,\s*60,\s*0\.9\)/.test(bh) && /targetAhead\(ctx, 60, player\.stats\.pickCos\)/.test(bh), 'the homing pick reads its stat, not 0.9');
  ok(!/return GUNS\[/.test(bh) && /ctx\.player\.stats\.gun\(/.test(bh), 'the gun in hand is the stats\' own, never the table read beside them');
  ok(/throwGrenade\(ctx, player\.stats\.grenade\(/.test(bh) && /spec\.bounce, ctx\.player\.stats\.throwLift\)/.test(bh), 'and a grenade thrown is its stats\' spec with its stats\' lift');
  ok(!/\(this\.aim \? 1 : 0\)\s*-\s*this\.aimBlend\)\s*\*\s*0\.15/.test(cam) && /\(\(this\.aim \? 1 : 0\) - this\.aimBlend\) \* this\.aimRate/.test(cam), 'the aim blend reads its rate, with no * 0.15 of its own');
  ok(!/readonly maxHp = 100/.test(player) && /get maxHp\(\): number \{\s*return this\.stats\.healthMax;/.test(player), 'the player\'s whole health is a getter over its stat, no readonly 100 beside it');
  ok(!/this\.hp \+ 4 \* dt/.test(player) && !/saberDefense = 3;/.test(player), 'the regeneration and the saber defence read their stats');
  ok(!/Math\.round\(ev\.damage \/ 3\)/.test(jka) && /JKA\.airAccelerate \* \(cmd\.airAccel \?\? 1\)/.test(jka), 'the landing roll and the air control read the command, not a 3 or a bare factor');
  ok(!/takeBurn\(this\.burn, dps, seconds\)/.test(world) && /seconds \* this\.burnScale/.test(world), 'a burn on the player reads its scale');

  // Each read site still reads what progress makes of it: a site that quietly went back to its bare number would
  // leave a node or a skill doing nothing in the game with every number above still right.
  const saber = read('src/combat/saber.ts');
  const jedi = read('src/combat/jedi.ts');
  const unarmed = read('src/combat/unarmed.ts');
  const main = read('src/main.ts');
  ok(/class PlayerTarget[\s\S]*?\n\s*burnScale = 1;/.test(world), "the player's record in the world starts its burn scale at today's 1");
  ok(/\n\s*swingScale = 1;/.test(saber) && /animSpeed\(move, this\.style\) \* this\.swingScale/.test(saber), "a saber's swing scale starts at 1 and every move's speed is times it");
  ok(/syncStats\(\): void \{\s*this\.saber\.swingScale = this\.stats\.saberSwing;\s*if \(this\.hp > this\.maxHp\) this\.hp = this\.maxHp;/.test(player), "the player's own saber takes its swing from the stats, and health over a whole that went down comes down to it");
  ok(/c\.fallSafeExtra = st\.fallSafeExtra \/ UNIT;\s*c\.rollDivisor = st\.rollDivisor;\s*c\.rollFree = st\.rollFree;\s*c\.airAccel = st\.airAccel;/.test(player), 'the movement is handed the four fall and air stats every step');
  ok(/this\.stats\.healthRegen \* dt/.test(player) && /saberDefense = this\.stats\.saberDefense;/.test(player) && /STYLE_DAMAGE\[this\.saber\.style\] \* this\.stats\.saberDamage \* this\.damageBoost/.test(player), 'the regeneration, the saber defence and the saber damage read their stats');
  ok(/JKA\.forceJumpHeight\[level\] \+ JKA\.forceJumpHeight\[0\] \+ \(cmd\.fallSafeExtra \?\? 0\)/.test(jka) && /Math\.round\(ev\.damage \/ \(cmd\.rollDivisor \?\? 3\)\)/.test(jka) && /<= \(cmd\.rollFree \?\? 0\)\) ev\.damage = 0/.test(jka), 'the movement reads the fall stats it is handed, each at its old number when it is not');
  ok(/private applyProgressStats\(\): void \{[\s\S]*?if \(!s\.update\(this\.progress\.record\)\) return;\s*this\.player\.syncStats\(\);\s*this\.cam\.aimRate = s\.aimRate;\s*this\.world\.playerTarget\.burnScale = s\.burnScale;/.test(main), 'the game writes the camera, the saber and the burn from the stats when they move');
  ok(/KICK_DAMAGE\.push \* player\.stats\.meleePush/.test(jedi) && /spec\.push \* player\.stats\.meleePush/.test(unarmed), "a kick's and a fist's shove times the stats' push");
  ok(/this\.grenadeCooldown = player\.stats\.grenadeCooldown;/.test(bh) && /return g\.grenade \? g\.cooldown \* this\.grenadeCooldown : g\.cooldown;/.test(bh), "a grenade's cooldown is times the stats' share, written every update, and nothing else's");
  ok(/this\.cds\.set\(id, this\.cooldownOf\(g\)\);\s*this\.throwGrenade\(ctx, player\.stats\.grenade\(g\.grenade\)\);/.test(bh) && /\(this\.cds\.get\(g\.id\) \?\? 0\) \/ this\.cooldownOf\(g\)/.test(bh), "a grenade thrown waits its stats' cooldown, and the display's sweep divides by the same");
  ok(/radius: ctx\.player\.stats\.apply\('blast\.radius', TRIP_RADIUS\)/.test(bh) && /radius: ctx\.player\.stats\.apply\('blast\.radius', PACK_RADIUS\)/.test(bh), "a trip mine's and a det pack's radius go through the stats");
  ok((bh.match(/'blast\.machines'/g) ?? []).length === 1 && /c\.mode \? machines : ctx\.player\.stats\.apply\('blast\.machines', machines\)/.test(bh) && /spec: GrenadeSpec \| null = null, machines = spec\?\.machines \?\? 1\)/.test(bh), "what machines take goes through the stats at a grenade's or a charge's detonation only, a gun's splash keeping its own");
  ok(/const v = throwVelocity\(dir, speed, upward, player\.vel\.x, player\.vel\.z, launch\);/.test(bh) && /\.setLinvel\(v\.x, v\.y, v\.z\)/.test(bh) && /ColliderDesc\.ball\(THROW_BALL\)/.test(bh), "a throw's body leaves at the velocity the Steady Arm test measures, with the lift it is handed");
  ok(/setY\(player\.pos\.y \+ THROW_SHAPE\.hand\)/.test(bh) && /\n\s*lobbed\(dir\);/.test(bh) && /from\.addScaledVector\(dir, THROW_SHAPE\.ahead\)/.test(bh), 'and from the hand, lobbed and ahead as the shape says');
  // That shape is today's, number for number, and the throw's arithmetic is the lines it replaced.
  ok(Object.is(THROW_SHAPE.lob, 0.3) && Object.is(THROW_SHAPE.hand, 1.4) && Object.is(THROW_SHAPE.ahead, 0.4) && Object.is(THROW_BALL, 0.14), "a throw's shape is today's: lobbed by 0.3, from 1.4 m, 0.4 m ahead, a ball of 0.14 m");
  const aims = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0.3, -0.2, -0.9), new THREE.Vector3(-2, 5, 1), new THREE.Vector3(0, -1, 0.01)];
  const lobOff = aims.filter((a) => {
    const old = a.clone();
    old.normalize().y += 0.3;
    old.normalize();
    const now = lobbed(a.clone());
    return !Object.is(now.x, old.x) || !Object.is(now.y, old.y) || !Object.is(now.z, old.z);
  });
  ok(lobOff.length === 0, 'lobbing a direction is the very lines it replaced, bit for bit');
  const dirs = aims.map((a) => lobbed(a.clone()));
  const velOff = dirs.filter((d) => {
    const v = throwVelocity(d, 18, 4, 2.5, -1.25, { x: 0, y: 0, z: 0 });
    return !Object.is(v.x, d.x * 18 + 2.5) || !Object.is(v.y, d.y * 18 + 4) || !Object.is(v.z, d.z * 18 + -1.25);
  });
  ok(velOff.length === 0, "and a throw's velocity is the old expression, the thrower's run carried with it");
}

// ---- 7. the grapple's rows (the grapple pass's wave 3) ------------------------------------------------------
// Each read site hands the stat table `GRAPPLE_TUNE`'s own number, so the tune stays live: the rows' bases are the
// tune's defaults, two of the rows were rewritten where they stood rather than added again, an empty record hands
// every one back by `Object.is`, and the hook's own files read each number through the table and nowhere beside it.
{
  const { GRAPPLE_DEFAULTS, GRAPPLE_STATS, Grapple, grappleStatBase } = await import('../../../src/player/grapple.ts');
  const { RAPIER } = await import('../../../src/core/physics.ts');
  const ids = ['grapple.range', 'grapple.reel', 'grapple.yank', 'grapple.swing', 'tether.strength'] as const;
  // Which tune key each is read over, written out by hand: the sway's factor alone has 1, no key, for its base.
  const keyOf: Record<string, keyof typeof GRAPPLE_DEFAULTS> = { 'grapple.range': 'range', 'grapple.reel': 'reel', 'grapple.yank': 'haul', 'tether.strength': 'strength' };
  const rows = STATS as readonly StatDef[];
  const counts = ids.map((id) => rows.filter((s) => s.id === id).length);
  ok(counts.every((n) => n === 1), `each of the grapple's five rows is in the table exactly once (${ids.map((id, i) => `${id} ${counts[i]}`).join(', ')})`);
  ok(rows.findIndex((s) => s.id === 'grapple.range') === rows.findIndex((s) => s.id === 'move.wallRun') + 1 && rows.findIndex((s) => s.id === 'tether.strength') === rows.findIndex((s) => s.id === 'detect.radius') + 1, 'and the two rows that stood absent are rewritten where they stood, never added beside themselves');
  const wrongBase = ids.filter((id) => !Object.is(baseOf(id), id === 'grapple.swing' ? 1 : (GRAPPLE_DEFAULTS[keyOf[id]] as number)));
  ok(wrongBase.length === 0, `every row's base is the tune's own default, bit for bit (100, 6, 18, 1, 40)${wrongBase.length ? `: ${wrongBase.join(', ')}` : ''}`);
  ok(Object.entries(GRAPPLE_STATS).every(([id, key]) => keyOf[id] === key) && Object.keys(GRAPPLE_STATS).length === 4, "the hook's own table names the same tune key for each as written here");
  ok(ids.every((id) => Object.is(grappleStatBase(id), baseOf(id))) && grappleStatBase('health.max') === null, 'and the base it hands the table, read off the tune as it stands, is that default while nothing is tuned');
  const s = new PlayerStats();
  ok(ids.every((id) => Object.is(s.apply(id, TODAY[id]), TODAY[id])) && ids.every((id) => !s.grants.has(id)), "an empty record hands each one back by Object.is and holds no entry for any");
  const statusOf = (id: string) => rows.find((r) => r.id === id)!;
  ok(statusOf('grapple.swing').status === 'built' && statusOf('grapple.swing').by === 'Acrobatics' && ['grapple.range', 'grapple.reel', 'grapple.yank', 'tether.strength'].every((id) => statusOf(id).status === 'route' && statusOf(id).reads === 'src/player/grapple.ts'), 'Acrobatics writes the swing; the range, the reel, the haul and the strength are read and written by nothing yet');
  const g = new Grapple(RAPIER, { world: {} } as never);
  g.stats = s;
  ok(Object.is(g.range, GRAPPLE_DEFAULTS.range) && g.whoMovesFor(20) === 'thing' && g.whoMovesFor(40) === 'thing' && g.whoMovesFor(41) === 'both', "the hook, handed the player's empty stats, reaches the tune's very range and weighs a 20 kg prop against its 40 kg strength");

  // The read sites, as text: each of these numbers goes through the table in the hook, and nowhere beside it.
  const read = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8');
  const hook = read('src/player/grapple.ts');
  const math = read('src/player/grappleMath.ts');
  const main = read('src/main.ts');
  const player = read('src/player/player.ts');
  const through = (key: string, id: string) => {
    const bare = (hook.match(new RegExp(`\\b(?:T|GRAPPLE_TUNE)\\.${key}\\b`, 'g')) ?? []).length;
    const routed = (hook.match(new RegExp(`stats\\.apply\\('${id.replace('.', '\\.')}', (?:T|GRAPPLE_TUNE)\\.${key}\\)`, 'g')) ?? []).length;
    return { bare, routed };
  };
  for (const [id, key] of Object.entries(keyOf)) {
    const t = through(key, id);
    ok(t.bare >= 1 && t.bare === t.routed, `every read of the tune's ${key} in the hook goes through stats.apply('${id}', ...) (${t.routed} of ${t.bare})`);
  }
  // Each read whole, to the end of its expression, so a factor written after the swing is caught as well as one before it.
  const swayReads = hook.match(/\bT\.(swayAccel|swayMax)\b[^;\n]*/g) ?? [];
  const swayWhole = [/^T\.swayMax \* swing$/, /^T\.swayAccel \* swing \* dt, swayMax - along\)$/];
  ok(/const swing = this\.stats\.apply\('grapple\.swing', 1\);/.test(hook) && swayReads.length === 2 && swayWhole.every((re) => swayReads.some((r) => re.test(r))), `the sway's push and cap are each times the swing the table hands back and nothing more (${swayReads.join('; ')})`);
  // No stray 100, 6, 18 or 40 anywhere in the hook's own code (the tune's table and its knob left out, comments and an
  // index such as sg[6] left out): a read site that wrote the tune's number out would read beside the table.
  const lines = hook.split(/\r?\n/);
  const tableAt = lines.findIndex((l) => l.startsWith('export const GRAPPLE_TUNE = {'));
  const tableEnd = lines.findIndex((l, i) => i > tableAt && l === '};');
  const knobAt = lines.findIndex((l) => l.startsWith('export function tuneGrapple('));
  const knobEnd = lines.findIndex((l, i) => i > knobAt && l === '}');
  const hookStrays = lines
    .map((l, i) => ({ l, i }))
    .filter(({ i }) => !(i >= tableAt && i <= tableEnd) && !(i >= knobAt && i <= knobEnd))
    .map(({ l, i }) => ({ code: l.trim().startsWith('*') || l.trim().startsWith('/*') ? '' : l.replace(/\/\/.*$/, '').replace(/'[^']*'|`[^`]*`/g, "''"), i }))
    .filter(({ code }) => /(?<![\w.[-])(100|6|18|40)(?![\w.\]])/.test(code))
    .map(({ i }) => `${i + 1}: ${lines[i].trim()}`);
  ok(tableAt > 0 && tableEnd > tableAt && knobAt > 0 && knobEnd > knobAt && hookStrays.length === 0, `the hook's own code holds no 100, 6, 18 or 40 beside the table (${hookStrays.length} strays${hookStrays.length ? `: ${hookStrays.join(' | ')}` : ''})`);
  ok(!/tune\.range/.test(math) && /markShows\(kind: MarkKind, reach: \{ readonly dist: number; readonly range: number \}, tune: \{ minRange: number \}\)/.test(math) && /reach\.range = range;/.test(hook), "the mark's range test is handed the range the hook read through the table, and reads none of its own");
  ok(!/GRAPPLE_TUNE\.(range|reel|haul|swayAccel|swayMax|strength)\b/.test(main) && /hm\.ropeUsed = g\.rope\.length \/ g\.range;/.test(main), 'the game reads the hook\'s range off the hook (the rope used, the long line), never the tune\'s');
  const strays = player.split('\n').filter((l) => /grapple/i.test(l) && /(?<![\w.])(100|6|18)(?![\w.])/.test(l));
  ok(strays.length === 0 && /this\.grapple\.stats = this\.stats;/.test(player), `the player holds no 100, 6 or 18 beside the grapple, and hands the hook its own stats (${strays.length} strays)`);
}

console.log(`\n${checks} checks passed`);
