// The wave 2a polish's air and water (the owner's first look, 2026-11-15), through the game's own code: a plain jump
// floats (the Force jump's float, `mx_floating`) with no start of its own until it falls faster than `fall.floatUntil`,
// then the falling loop for the rest of that air; on the grappling rope the air is the float; a step off a ledge plays
// the hop over a drop of `fall.hopDrop` or more and the falling loop alone over less; treading water the drawn figure is
// lowered by `swim.sink` at the surface (less the deeper the body, none once it is that deep) and eased on and off; held
// still under the water the figure treads. Each through `BodyAnim` (the very record the player's update calls) over the
// game's own movement (`JkaMovement`) at 30, 60 and 144 frames a second where a clock is involved, and `SwimSink` (the
// very class the player and the peers keep), each with a mutation of the new code shown to fail its check; and day one:
// under every switch at 'before' the record answers as 62143fe's did, that commit's modules loaded out of git, with a
// recorded digest for when git cannot answer.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { MX, deepDrop, ledgeHop, airLoopOwner, AirAsk, jumpStartOwner } from '../../../src/anim/animRules.ts';
import { BodyAnim, type AnimRig } from '../../../src/anim/bodyAnim.ts';
import { ANIM_CHOICES, ANIM_TUNE, ANIM_TUNE_SHIPPED, tuneAnim, watchJkaSpine, type AnimTune } from '../../../src/anim/animTune.ts';
import { SwimSink, swimSinkAt } from '../../../src/anim/swimSink.ts';
import { animDialsFor } from '../../../src/anim/animDials.ts';
import { JkaMovement, UNIT, type MoveCommand } from '../../../src/player/jkaMove.ts';
import { PlayerStats } from '../../../src/player/playerStats.ts';
import { SWIM_DEPTH } from '../../../src/player/swimStep.ts';
import { loadOldMany } from './oldModules.ts';
import { BEFORE_POLISH, beforeAnimTune, loadMutant } from './polishFixtures.ts';
import { repoRoot } from './animFixtures.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const root = repoRoot(import.meta.url);
const text = (rel: string) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const tune = (): AnimTune => JSON.parse(JSON.stringify(ANIM_TUNE_SHIPPED)) as AnimTune;
/** The digest of the 'before' trace, recorded from 62143fe's own modules: what a checkout with no history is held to. */
const BEFORE_TRACE = '65310a9dbe121054';

/** A rig that has the clips it is given and records what it is asked to play. */
class Recorder implements AnimRig {
  readonly clips: Set<string>;
  readonly played: { clip: string; fadeIn?: number; from?: number }[] = [];
  constructor(clips: Iterable<string> = Object.values(MX)) {
    this.clips = new Set(clips);
  }
  has(clip: string): boolean {
    return this.clips.has(clip);
  }
  play(clip: string, options: { fadeIn?: number; from?: number } = {}): number | null {
    if (!this.clips.has(clip)) return null;
    this.played.push({ clip, ...options });
    return 2 - (options.from ?? 0);
  }
  yieldOverride(): void {}
}

const stats = new PlayerStats();
const cmd = (jump: boolean, pressed: boolean): MoveCommand => ({ forward: new THREE.Vector3(0, 0, -1), right: new THREE.Vector3(1, 0, 0), fmove: 0, smove: 0, walk: false, crouch: false, roll: false, jump, jumpPressed: pressed, attack: false, speedScale: 1, fallSafeExtra: stats.fallSafeExtra / UNIT, rollDivisor: stats.rollDivisor, rollFree: stats.rollFree, airAccel: stats.airAccel });

type BodyCls = new (t: AnimTune, unit: number) => BodyAnim;
/**
 * A jump through the game's own movement, the record driven as the player's update drives it: `stepped`, the jump, a
 * Force jump's `forceMove`, the landing; each frame in the air `vy` written and the loop asked. The ground is level at
 * nought until the feet leave it, then `floor` metres (a jump off something). The air's loop each frame, and when it is.
 */
function jumpThrough(t: AnimTune, fps: number, level: number, held: number, floor: number, Cls: BodyCls = BodyAnim) {
  const dt = 1 / fps;
  const rig = new Recorder();
  const body = new Cls(t, UNIT);
  const jka = new JkaMovement();
  jka.forceLevel = level;
  jka.reset();
  const pos = new THREE.Vector3(), vel = new THREE.Vector3();
  const force = { value: 100, spend: () => {} };
  let grounded = true, ground = 0, time = 0, jumped = false, forced = false;
  const air: { t: number; vy: number; y: number; loop: string | null }[] = [];
  for (let i = 0; i < 4000; i++) {
    const ev = jka.step(dt, vel, pos, grounded, cmd(time < held - 1e-9, i === 0), force);
    body.stepped(grounded);
    if (ev.jumped) {
      grounded = false;
      ground = floor;
      jumped = body.jump(rig, false);
    }
    if (ev.forceJumpStarted || ev.flip || ev.special) {
      forced = true;
      body.forceMove();
    }
    if (ev.landed !== null && i > 0) return { air, rig, body, jumped, forced, landed: ev.landed };
    pos.addScaledVector(vel, dt);
    if (!grounded && pos.y <= ground && vel.y < 0) {
      pos.y = ground;
      grounded = true;
    }
    if (!grounded) {
      body.rope = false;
      body.vy = vel.y;
      air.push({ t: time, vy: vel.y, y: pos.y, loop: body.air(rig, false) });
    }
    time += dt;
  }
  throw new Error('the jump never landed');
}

// ---- 1. the air: a plain jump floats -------------------------------------------------------------------------------------
{
  const t = tune();
  ok(t.airRule === 'owner' && t.fall.hopDrop === 1.5 && t.fall.floatUntil === 10, 'the air ships under the owner\'s rule: a plain jump floats until it falls past 10 m/s, a ledge hops from a drop of 1.5 m');
  for (const fps of [30, 60, 144]) {
    // On level ground, every hop: no start of its own, the float to the landing.
    for (const level of [0, 3]) {
      const j = jumpThrough(t, fps, level, 0.05, 0);
      assert.ok(j.jumped && j.rig.played.length === 0 && !j.forced && j.air.length > 3 && j.air.every((a) => a.loop === MX.float), `fps ${fps} level ${level}: ${j.air.map((a) => a.loop).join(',')}`);
    }
    // Off something 8 m down: the float until the fall passes 10 m/s, then the falling loop to the landing.
    const off = jumpThrough(t, fps, 0, 0.05, -8);
    const turn = off.air.findIndex((a) => a.loop === MX.fall);
    assert.ok(off.jumped && off.rig.played.length === 0 && turn > 0 && off.air.slice(0, turn).every((a) => a.loop === MX.float && a.vy >= -10) && off.air.slice(turn).every((a) => a.loop === MX.fall), `fps ${fps}: off a ledge ${off.air.map((a) => a.loop?.slice(3, 6)).join(',')}`);
    const at = off.air[turn];
    const apex = Math.max(...off.air.map((a) => a.y));
    assert.ok(at.vy < -10 && at.vy > -10 - (20.32 / fps) * 1.01 - 1e-9, `fps ${fps}: handed over at ${at.vy}`);
    // A Force jump: the float as before, whatever its speed.
    const fj = jumpThrough(t, fps, 3, 0.6, -8);
    assert.ok(fj.forced && fj.air.every((a) => a.loop === MX.float), `fps ${fps}: a Force jump floats`);
    ok(true, `at ${fps} fps a plain hop (level 0 and a Force user's tap) plays no start and floats to its landing; a jump off something 8 m down floats from its apex until it falls past 10 m/s (handed over at ${at.vy.toFixed(2)} m/s, ${(apex - at.y).toFixed(2)} m under the apex, within a frame of the line) and is the falling loop to the landing; a Force jump floats all the way, as before`);
  }
  // Jedi Academy in charge: the game's own (no float taken), and its jump is the caller's.
  const body = new BodyAnim(t, UNIT);
  const rig = new Recorder();
  body.stepped(false);
  ok(body.jump(rig, true) === false && body.air(rig, true) === null && rig.played.length === 0, 'with Jedi Academy\'s animations in charge the jump and the air are that game\'s own, as before');
  // A rig without the float: the jump's start, as before, and the fall.
  const noFloat = new Recorder(Object.values(MX).filter((c) => c !== MX.float));
  const b2 = new BodyAnim(t, UNIT);
  b2.stepped(false);
  ok(b2.jump(noFloat, false) && noFloat.played[0].clip === MX.jump && b2.air(noFloat, false) === MX.fall, 'a rig without the float keeps the jump\'s start and the falling loop');
  // The rope: the float while attached off the ground; let go, the falling loop.
  const r = new BodyAnim(t, UNIT);
  const rr = new Recorder();
  r.stepped(false);
  r.rope = true;
  r.vy = -25;
  ok(r.air(rr, false) === MX.float, 'on the grappling rope with the feet off the ground the air is the float, however fast it swings down');
  r.rope = false;
  ok(r.air(rr, false) === MX.fall, 'and let go of it, the falling loop');
  // Thrown: the long fall, as before.
  r.fling();
  ok(r.air(rr, false) === MX.thrown, 'thrown from a wreck, the long fall as before');
  // The latch: once fallen past the line, a slower fall (a let-go, a slope) is still the falling loop for that air.
  const l = new BodyAnim(t, UNIT);
  const lr = new Recorder();
  l.stepped(false);
  l.jump(lr, false);
  l.vy = -11;
  l.air(lr, false);
  l.vy = -3;
  ok(l.air(lr, false) === MX.fall && !l.jumpFloat, 'fallen past the line, the float is done for that air whatever the speed after');
  l.land(lr, 0.0001, 0, false, false, false);
  l.jump(lr, false);
  l.vy = 2;
  ok(l.jumpFloat && l.air(lr, false) === MX.float, 'and the next jump floats again');
  // The line is read at each frame: moved, the same fall hands over later.
  const moved = tune();
  moved.fall.floatUntil = 20;
  const m = jumpThrough(moved, 60, 0, 0.05, -40);
  const mt = m.air.find((a) => a.loop === MX.fall)!;
  ok(mt.vy < -20 && mt.vy > -20.4, `the line is the table's: at 20 the same jump off something hands over at ${mt.vy.toFixed(2)} m/s`);
  // Rules alone.
  const has = (c: string) => c !== 'nothing';
  const a = new AirAsk();
  ok(airLoopOwner(has, a) === MX.fall && ((a.jumped = true), airLoopOwner(has, a) === MX.float) && ((a.jka = true), airLoopOwner(has, a) === null) && ((a.thrown = true), airLoopOwner(has, a) === MX.thrown), 'the rule: the falling loop, the float for a jump, the game\'s own for Jedi Academy, the long fall thrown (over Jedi Academy too)');
  ok(jumpStartOwner(has, false, t) === 'float' && (jumpStartOwner(has, true, t) as { clip: string } | null)?.clip !== MX.float, 'a jump\'s start under the rule: the float, unless Jedi Academy\'s animations are in charge');
  // Mutations.
  const [mut] = await loadMutant(['src/anim/bodyAnim.ts', 'src/anim/animRules.ts'], ['src/anim/bodyAnim.ts'], [{ file: 'src/anim/bodyAnim.ts', from: 'if (this.jumped && this.vy < -this.tune.fall.floatUntil) this.jumped = false;', to: '' }]);
  const mj = jumpThrough(t, 60, 0, 0.05, -8, (mut as { BodyAnim: BodyCls }).BodyAnim);
  ok(mj.air.every((a) => a.loop === MX.float), 'a mutation that never hands over floats all the way down off a ledge: the check above fails on it');
  const [mut2] = await loadMutant(['src/anim/bodyAnim.ts', 'src/anim/animRules.ts'], ['src/anim/bodyAnim.ts'], [{ file: 'src/anim/animRules.ts', from: 'a.force || a.rope || a.jumped', to: 'a.force || a.jumped' }]);
  const mr = new (mut2 as { BodyAnim: BodyCls }).BodyAnim(t, UNIT);
  mr.stepped(false);
  mr.rope = true;
  ok(mr.air(new Recorder(), false) === MX.fall, 'a mutation that forgets the rope falls on it: the check above fails on it');
  const [mut3] = await loadMutant(['src/anim/bodyAnim.ts', 'src/anim/animRules.ts'], ['src/anim/bodyAnim.ts'], [{ file: 'src/anim/animRules.ts', from: "if (!jkaMode && has(MX.float)) return 'float';", to: '' }]);
  const m3 = jumpThrough(t, 60, 0, 0.05, 0, (mut3 as { BodyAnim: BodyCls }).BodyAnim);
  ok(m3.rig.played.length === 1 && m3.rig.played[0].clip === MX.jump, 'a mutation that keeps the start plays the hop on every jump: the check above fails on it');
}

// ---- 2. a step off a ledge ---------------------------------------------------------------------------------------------------
{
  const t = tune();
  const off = (drop: number, jka = false, tn = t) => {
    const body = new BodyAnim(tn, UNIT);
    const rig = new Recorder();
    body.stepped(false);
    body.dropBelow = drop;
    const hop = body.leftGround(rig, jka);
    body.vy = -1;
    return { hop, rig, loop: body.air(rig, jka), judges: body.judgesLedges };
  };
  const deep = off(3), shallow = off(0.4), none = off(-1), edge = off(1.5), under = off(1.49);
  ok(deep.hop && deep.rig.played.length === 1 && deep.rig.played[0].clip === MX.jump && deep.rig.played[0].from === t.trim.jumping_up && deep.rig.played[0].fadeIn === t.jump.fade && deep.loop === MX.fall, 'stepping off a ledge 3 m down plays the hop (the jump\'s start from its trim) and then the falling loop, not the float');
  ok(!shallow.hop && shallow.rig.played.length === 0 && shallow.loop === MX.fall && !under.hop && edge.hop && none.hop, 'over less than 1.5 m (a kerb, a stair) the falling loop alone; at 1.5 m or with nothing found within it, the hop');
  ok(!off(3, true).hop && off(3, true).loop === null, 'with Jedi Academy\'s animations in charge no hop and that game\'s own air');
  const before = beforeAnimTune();
  ok(!off(3, false, before).hop && !off(3, false, before).judges && deep.judges, 'under \'before\' the caller judges no ledge at all (no ray is cast) and nothing plays');
  ok(deepDrop(-1, t) && deepDrop(1.5, t) && !deepDrop(1.4, t) && ledgeHop(() => true, true, false, t)?.clip === MX.jump && ledgeHop(() => false, true, false, t) === null, 'the rule, alone: the drop judged against the table\'s line, the hop only on a rig that has the clip');
  const [mut] = await loadMutant(['src/anim/bodyAnim.ts', 'src/anim/animRules.ts'], ['src/anim/bodyAnim.ts'], [{ file: 'src/anim/bodyAnim.ts', from: 'const hop = ledgeHop(this.has, d < 0 || d >= this.tune.fall.hopDrop, jka, this.tune);', to: 'const hop = ledgeHop(this.has, true, jka, this.tune);' }]);
  const mb = new (mut as { BodyAnim: BodyCls }).BodyAnim(t, UNIT);
  mb.dropBelow = 0.3;
  ok(mb.leftGround(new Recorder(), false), 'a mutation that ignores the drop hops off a kerb: the check above fails on it');
  const player = text('src/player/player.ts');
  ok(player.includes('if (wasGrounded && !this.grounded && !this.swimming && !this.flung && !this.grapple.attached && this.anim.judgesLedges) {') && player.includes('const d = this.physics.groundDistance(this.pos.x, this.pos.y + 0.1, this.pos.z, reach + 0.1, this.body, filter);') && player.includes('this.anim.dropBelow = d === null ? -1 : Math.max(0, d - 0.1);') && player.includes('this.anim.leftGround(this.rig, this.jkaActing);') && player.indexOf('const wasGrounded = this.grounded;') > player.indexOf('if (!this.anim.jump(rig, this.jkaActing))'), 'the player judges a ledge the frame its feet leave the ground with no jump (the jump\'s own frame puts them down first), never swimming, thrown or on the rope, by one ray down from the feet past the line');
  ok(player.includes('this.anim.rope = this.grapple.attached;') && player.includes('this.anim.vy = this.vel.y;') && player.indexOf('this.anim.vy = this.vel.y;') < player.indexOf('const loop = this.anim.air(rig, this.jkaActing);'), 'and writes the rope and the fall\'s speed before it asks the air');
  const peers = text('src/net/remotePlayers.ts');
  ok(peers.includes("else if (state === 'air') rig.prefer('air', ANIM_TUNE.airRule === 'owner' ? (r.vel.y > -ANIM_TUNE.fall.floatUntil ? MX.float : MX.fall) : null);"), 'another player in the air is shown the float while heard to fall slower than the line and the falling loop past it (their state says only "air"; nothing new on the wire)');
}

// ---- 3. treading water ---------------------------------------------------------------------------------------------------------
{
  const t = tune();
  ok(t.swim.rule === 'owner' && t.swim.sink === 0.3 && t.swim.ease === 0.3, 'the water ships under the owner\'s rule: the treading figure drawn 0.3 m lower, eased over 0.3 s');
  const settle = (fps: number, seconds: number, depth: number, scale: number, treading: boolean, tn = t, s = new SwimSink()) => {
    for (let i = 0; i < Math.round(seconds * fps); i++) {
      s.dt = 1 / fps;
      s.depth = depth;
      s.scale = scale;
      s.floatDepth = SWIM_DEPTH;
      s.step(treading, tn);
    }
    return s;
  };
  const rows: string[] = [];
  for (const fps of [30, 60, 144]) {
    const half = settle(fps, 1 / 3, SWIM_DEPTH, 1, true);
    const full = settle(fps, 3, SWIM_DEPTH, 1, true);
    const want = 0.3 * (1 - Math.exp(-1 / 3 / 0.3));
    assert.ok(Math.abs(half.now - want) < 1e-9 && Math.abs(full.now - 0.3) < 1e-4, `fps ${fps}: ${half.now}, ${full.now}`);
    const out = settle(fps, 3, SWIM_DEPTH, 1, false, t, full);
    assert.ok(out.now === 0 && out.share === 0, `fps ${fps}: settled to nothing`);
    rows.push(`${fps}: ${half.now.toFixed(6)}`);
  }
  ok(true, `the sink comes on at the same pace at every frame rate (after a third of a second, whole frames at each: ${rows.join(', ')}; all ${(0.3 * (1 - Math.exp(-1 / 3 / 0.3))).toFixed(6)}), reaches the whole 0.3 m, and swims off back to exactly nothing`);
  ok(Math.abs(settle(60, 3, SWIM_DEPTH, 0.72, true).now - 0.216) < 1e-4 && Math.abs(settle(60, 3, SWIM_DEPTH, 1.28, true).now - 0.384) < 1e-4, 'scaled by the figure: 0.216 m on the Bothan woman at 0.72, 0.384 on the Wookiee at 1.28');
  ok(Math.abs(settle(60, 3, SWIM_DEPTH + 0.1, 1, true).now - 0.2) < 1e-4 && settle(60, 3, SWIM_DEPTH + 0.3, 1, true).now === 0 && settle(60, 3, SWIM_DEPTH + 2, 1, true).now === 0 && Math.abs(settle(60, 3, SWIM_DEPTH - 0.5, 1, true).now - 0.3) < 1e-4, 'only at the surface: 0.1 m deeper than the float line it is 0.2, at the sink\'s own depth and under none (a dive and a rise hand over with no step), and a body standing higher still takes the whole sink');
  ok(swimSinkAt(0.3, SWIM_DEPTH, SWIM_DEPTH) === 0.3 && Math.abs(swimSinkAt(0.3, SWIM_DEPTH + 0.15, SWIM_DEPTH) - 0.15) < 1e-12 && swimSinkAt(0.3, SWIM_DEPTH + 0.5, SWIM_DEPTH) === 0,'the rule, alone');
  ok(settle(60, 3, SWIM_DEPTH, 1, true, beforeAnimTune()).now === 0, 'under \'before\' the sink is nought, as it was');
  const d = settle(60, 3, SWIM_DEPTH, 1, true);
  d.drop();
  ok(d.now === 0 && d.share === 0, 'let go at once at a reset, a stand or a mount');
  const [mut] = await loadMutant(['src/anim/swimSink.ts'], ['src/anim/swimSink.ts'], [{ file: 'src/anim/swimSink.ts', from: 'const s = full - (this.depth - this.floatDepth);', to: 'const s = full;' }]);
  const ms = new (mut as { SwimSink: typeof SwimSink }).SwimSink();
  settle(60, 3, SWIM_DEPTH + 2, 1, true, t, ms);
  ok(ms.now > 0.29, 'a mutation that ignores the depth sinks a diver 2 m under: the check above fails on it');
  const player = text('src/player/player.ts');
  ok(player.includes('ss.step(this.swimming && !moving && !cam.firstPerson, ANIM_TUNE);') && player.includes('ss.depth = this.waterDepth;') && player.includes('ss.scale = this.rig ? this.rig.root.scale.y : 1;') && player.includes('if (rig) rig.root.position.y = this.swimming && !room && !this.eva && this.swimSink.now > 0 ? -this.swimSink.now : 0;'), 'the player lowers the rig\'s root alone (the capsule, the swim, the camera\'s place and what hangs on the group are as ever), only while it treads, never in first person, in a room or adrift');
  ok(player.includes("rig.setState(moving || (this.submerged && ANIM_TUNE.swim.rule !== 'owner') ? 'swim' : 'float', speed, this.blocking && this.hasJkaClips ? stance : null);"), 'held still under the water the figure treads under the owner\'s rule, and swims as before under \'before\'');
  ok((player.match(/this\.swimSink\.drop\(\);/g) ?? []).length >= 2, 'and lets the sink go at a stand and at a reset');
  const peers = text('src/net/remotePlayers.ts');
  ok(peers.includes('ss.step(treads, ANIM_TUNE);') && peers.includes('rig.root.position.y = ss.now > 0 ? -ss.now : 0;') && peers.includes("const treads = state === 'float' && !(this.adrift && !r.aboard);") && text('src/main.ts').includes('this.remotes.surfaceAt = (x, z) => {'), 'another player treading is drawn as low by the same class, at their depth under the water this world draws (handed in by the game), never adrift in space');
  // Under 'before' the two lines above write nought into a figure's root every frame. That is 62143fe's to the bit only
  // because a rig's root stands at the origin (a GLB's scene or a parts character's own group, each made fresh, the
  // player's and a peer's added under their own group as they are) and nothing else in the game moves it: held here over
  // every source file, so a writer added later cannot have its work put back to nought by the water's 'before'.
  // Wave 3 adds four writers, each by its own line: the drawn body's lag and the feet's drop laid on the root after the
  // sink's write in the same frame (so the sink never puts their work back), the drop taken off a peer's root before its
  // own frame writes it, and a frame off the feet putting the root back where the sink stood it. Each writes only what is
  // not nought, and under 'before' (`ik.rule`, `stairs.rule`) nothing makes one.
  const WAVE3_ROOT = [
    'if (rig && this.drawn.offset !== 0) rig.root.position.y += this.drawn.offset;',
    'if (rig && rig.root.position.y !== this.rootBase) rig.root.position.y = this.rootBase;',
    'if (this.applied !== 0 && rig === this.rig) rig.root.position.y += this.applied;',
    'rig.root.position.y -= drop;',
  ];
  // Wave 4 adds the ledges' line-up of a hanging figure against its body (each clip authored at a height of its own), on
  // the player's root and, from their rig state, on a peer's, each by its own line and taken back off by its own (the
  // player's put back to nought where nothing hangs, a peer's taken off before its frame writes it). Under 'before'
  // (`climb.ledges`) nothing hangs and nothing makes one.
  const WAVE4_ROOT = [
    'rig.root.position.x = 0;',
    'rig.root.position.z = 0;',
    'rig.root.position.x = L.offX * c - L.offZ * s;',
    'rig.root.position.y += L.offY;',
    'rig.root.position.z = L.offX * s + L.offZ * c;',
    'rig.root.position.y += oy;',
    'rig.root.position.z = oz;',
  ];
  const wave3Root: string[] = [];
  const wave4Root: string[] = [];
  // Wave 4, item B: the wall's own three (its figure's offset added to whatever the hang's put there), beside its two
  // noughts above, which read as the ledges' own text.
  const WAVE4B_ROOT = ['rig.root.position.x += W.offX * c - W.offZ * s;', 'rig.root.position.y += W.offY;', 'rig.root.position.z += W.offX * s + W.offZ * c;'];
  const wave4bRoot: string[] = [];
  // Climbing II, Smoothness II, item 3: the duck's push across taken back before the next frame lays its own (the spheres'
  // `move` lays it through the root's parent's frame, as the ledges' anchor does, with no line of this shape).
  const S2_ROOT = ['rig.root.position.set(0, rig.root.position.y, 0);'];
  // Climbing II, phase 3: the bar's own three (its figure's offset, as the ledges' are), beside its two noughts, which read as the
  // ledges' own text (the put-back where nothing swings).
  const BAR_ROOT = ['rig.root.position.x = B.offX * c - B.offZ * s;', 'rig.root.position.y += B.offY;', 'rig.root.position.z = B.offX * s + B.offZ * c;'];
  const barRoot: string[] = [];
  // Climbing II, phase 4: the rope's own three (its figure's offset, as the bar's are), beside its two noughts, which read as the
  // ledges' own text (the put-back where nothing holds the rope).
  const ROPE_ROOT = ['rig.root.position.x = R.offX * c - R.offZ * s;', 'rig.root.position.y += R.offY;', 'rig.root.position.z = R.offX * s + R.offZ * c;'];
  const ropeRoot: string[] = [];
  // Climbing II, phase 5: the pole's own three (its figure's offset, as the rope's are), beside its two noughts, which read as the
  // ledges' own text (the put-back where nothing holds the pole).
  const POLE_ROOT = ['rig.root.position.x = P.offX * c - P.offZ * s;', 'rig.root.position.y += P.offY;', 'rig.root.position.z = P.offX * s + P.offZ * c;'];
  const poleRoot: string[] = [];
  const s2Root: string[] = [];
  const writers: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.ts$/.test(e.name)) {
        // A rig's root as the game reaches it: `rig.root` (or `.rig?.root`) anywhere, `this.root` in the rig itself.
        const own = rel === 'src/player/rig.ts' ? '|\\bthis\\.root' : '';
        const write = new RegExp(`(\\brig\\??\\.root${own})\\.position(\\.[xyz])?\\s*([-+*/]?=(?!=)|\\.(set|setX|setY|setZ|copy|add|sub|addScaledVector|multiplyScalar|lerp|applyMatrix4|applyQuaternion)\\()`);
        text(rel).split('\n').forEach((line, i) => {
          if (write.test(line)) (WAVE3_ROOT.includes(line.trim()) ? wave3Root : WAVE4_ROOT.includes(line.trim()) ? wave4Root : WAVE4B_ROOT.includes(line.trim()) ? wave4bRoot : S2_ROOT.includes(line.trim()) ? s2Root : BAR_ROOT.includes(line.trim()) ? barRoot : ROPE_ROOT.includes(line.trim()) ? ropeRoot : POLE_ROOT.includes(line.trim()) ? poleRoot : writers).push(`${rel}:${i + 1}`);
        });
      }
    }
  };
  walk('src');
  const rigTs = text('src/player/rig.ts');
  ok(wave4Root.length === 16 && wave4Root.filter((w) => w.startsWith('src/player/player.ts:')).length === 13 && wave4Root.filter((w) => w.startsWith('src/player/peerHang.ts:')).length === 3, `wave 4's sixteen writers of a rig's root are the ledges' own lines and the wall's two noughts and the bar's (phase 3), the rope's (phase 4) and the pole's (phase 5), and nothing else (${wave4Root.join(', ')})`);
  ok(barRoot.length === 3 && barRoot.every((w) => w.startsWith('src/player/player.ts:')), `phase 3's own three, the bar's figure's offset, in the player alone (${barRoot.join(', ')})`);
  ok(ropeRoot.length === 3 && ropeRoot.every((w) => w.startsWith('src/player/player.ts:')), `phase 4's own three, the rope's figure's offset, in the player alone (${ropeRoot.join(', ')})`);
  ok(poleRoot.length === 3 && poleRoot.every((w) => w.startsWith('src/player/player.ts:')), `phase 5's own three, the pole's figure's offset, in the player alone (${poleRoot.join(', ')})`);
  ok(s2Root.length === 1 && s2Root[0].startsWith('src/player/player.ts:'), `Smoothness II's one: the duck's push across taken back, in the player alone (${s2Root.join(', ')})`);
  ok(wave4bRoot.length === 3 && wave4bRoot.every((w) => w.startsWith('src/player/player.ts:')), `and the wall's own three, in the player alone (${wave4bRoot.join(', ')})`);
  ok(wave3Root.length === 4 && wave3Root.filter((w) => w.startsWith('src/player/player.ts:')).length === 2 && wave3Root.filter((w) => w.startsWith('src/player/footIk.ts:')).length === 2, `wave 3's four writers of a rig's root are its own lines and nothing else (${wave3Root.join(', ')})`);
  ok(writers.length === 2 && writers.some((w) => w.startsWith('src/player/player.ts:')) && writers.some((w) => w.startsWith('src/net/remotePlayers.ts:')) && rigTs.includes('return new CharacterRig(gltf.scene, gltf.animations, options);') && rigTs.includes('const rig = new CharacterRig(character.group, character.clips, options);') && text('src/player/character.ts').includes('readonly group = new THREE.Group();'), `nothing in the game writes a rig's root's place but the sink's two lines (${writers.join(', ')}), and a rig's root is a scene or a group made fresh at the origin: under 'before' the nought they write is the nought it already stood at, as 62143fe left it`);
}

// ---- 4. the choices and their dials --------------------------------------------------------------------------------------------
{
  const was = JSON.parse(JSON.stringify(ANIM_TUNE)) as AnimTune;
  let told = 0;
  watchJkaSpine(() => told++);
  ok(tuneAnim({ airRule: 'before' }).length === 0 && ANIM_TUNE.airRule === 'before' && tuneAnim({ airRule: 'float' }).length === 1 && ANIM_TUNE.airRule === 'before', 'the air\'s rule takes its two words and refuses any other');
  ok(tuneAnim({ swim: { rule: 'before', sink: 0.5 } }).length === 0 && ANIM_TUNE.swim.rule === 'before' && ANIM_TUNE.swim.sink === 0.5 && tuneAnim({ swim: { rule: 1 } }).length === 1 && tuneAnim({ swim: { sink: 9 } }).length === 1 && ANIM_TUNE.swim.sink === 1, 'the water\'s rule and its numbers, each held to its range');
  ok(tuneAnim({ jkaSpine: 'before' }).length === 0 && told === 1 && tuneAnim({ jkaSpine: 'before' }).length === 0 && told === 1 && tuneAnim({ jkaSpine: 'mended' }).length === 0 && told === 2, 'the spine\'s switch tells whoever holds the clips once a move, and only when it moves');
  ok(tuneAnim({ fall: { hopDrop: 0.1, floatUntil: 99 } }).length === 2 && ANIM_TUNE.fall.hopDrop === 0.3 && ANIM_TUNE.fall.floatUntil === 40, 'the fall\'s numbers held to their ranges');
  watchJkaSpine(null);
  const set = animDialsFor('anim')!;
  const keys = set.groups.flatMap((g) => g.dials.map((d) => d.key));
  ok(Object.keys(ANIM_CHOICES).every((p) => keys.includes(`tune.${p}`)) && ['tune.fall.hopDrop', 'tune.fall.floatUntil', 'tune.swim.sink', 'tune.swim.ease'].every((k) => keys.includes(k)), 'every new choice and number is a dial in the debug menu ("The air and the water")');
  const choice = set.groups.flatMap((g) => g.dials).find((d) => d.key === 'tune.swim.rule') as { set: (s: string) => unknown; get: () => string };
  choice.set('owner');
  ok(choice.get() === 'owner' && ANIM_TUNE.swim.rule === 'owner', 'and a choice dial sets the table through its own setter');
  // Put the table back.
  Object.assign(ANIM_TUNE, JSON.parse(JSON.stringify(was)));
}

// ---- day one: under every switch at 'before' the record is 62143fe's -----------------------------------------------------
{
  const FILES = ['src/anim/bodyAnim.ts', 'src/anim/animRules.ts', 'src/anim/animTune.ts'];
  const old = await loadOldMany(FILES, ['src/anim/bodyAnim.ts', 'src/anim/animTune.ts'], BEFORE_POLISH);
  const trace = (Cls: BodyCls, t: AnimTune): string[] => {
    const rows: string[] = [];
    for (const fps of [30, 60, 144]) {
      for (const [level, held, floor] of [[0, 0.05, 0], [0, 0.05, -8], [3, 0.08, 0], [3, 0.6, -8], [0, 0.05, -30]] as const) {
        const j = jumpThrough(t, fps, level, held, floor, Cls);
        rows.push(`${fps} ${level} ${held} ${floor} ${j.jumped} ${j.forced} ${j.landed} ${j.air.map((a) => a.loop ?? '-').join(',')} ${j.rig.played.map((p) => `${p.clip}@${p.from}/${p.fadeIn}`).join(',')} ${j.body.landing} ${j.body.forceAir}`);
        // The landing it makes.
        const rig = new Recorder();
        const how = j.body.land(rig, j.landed, 0, j.forced, false, false);
        rows.push(`${how} ${rig.played.map((p) => `${p.clip}@${p.from}/${p.fadeIn}`).join(',')}`);
      }
    }
    // Thrown, swimming, dropped, a rig without clips.
    const body = new Cls(t, UNIT);
    const rig = new Recorder();
    body.stepped(false);
    body.fling();
    rows.push(`${body.air(rig, false)} ${body.flung}`);
    body.hitGround(rig);
    rows.push(`${rig.played.map((p) => p.clip).join(',')} ${body.impactLocked}`);
    body.swim();
    rows.push(`${body.air(rig, false)}`);
    body.drop();
    body.stepped(false);
    rows.push(`${body.jump(new Recorder([]), false)} ${body.air(new Recorder([]), false)}`);
    return rows;
  };
  const now = trace(BodyAnim, beforeAnimTune());
  const digest = createHash('sha1').update(now.join('\n')).digest('hex').slice(0, 16);
  if (old) {
    const [ob, ot] = old as [{ BodyAnim: BodyCls }, { ANIM_TUNE_SHIPPED: AnimTune }];
    const then = trace(ob.BodyAnim, JSON.parse(JSON.stringify(ot.ANIM_TUNE_SHIPPED)) as AnimTune);
    const first = now.findIndex((r, i) => r !== then[i]);
    ok(now.length === then.length && first < 0, `under every switch at 'before' the record answers as ${BEFORE_POLISH}'s did, jumps, falls, Force jumps, landings, a throw, a swim and a rig without the clips at 30, 60 and 144 frames a second (${now.length} rows)${first >= 0 ? `: row ${first} is ${now[first]} against ${then[first]}` : ''}`);
    note(`the 'before' trace's digest is ${digest} (BEFORE_TRACE, which a checkout with no history is held to)`);
  } else note(`git cannot hand over ${BEFORE_POLISH}'s modules here: the 'before' trace is held to the digest recorded from them`);
  if (BEFORE_TRACE) ok(digest === BEFORE_TRACE, `and its digest is the one recorded from ${BEFORE_POLISH}'s own modules (${digest})`);
  else assert.ok(old, 'a recorded digest, or git');
  // The new fields, written under 'before', move nothing.
  const b = new BodyAnim(beforeAnimTune(), UNIT);
  const r = new Recorder();
  b.stepped(false);
  b.rope = true;
  b.vy = -50;
  b.dropBelow = 9;
  ok(b.air(r, false) === MX.fall && !b.leftGround(r, false) && r.played.length === 0 && !b.jumpFloat, 'and under \'before\' the rope, the fall\'s speed and a drop written in move nothing');
}

console.log(`\n${checks} checks passed`);
