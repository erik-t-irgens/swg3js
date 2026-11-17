// The speed classes' glue (src/anim/bodyLoco.ts): the very class the player's update calls, driven here over
// stand-in frames -- the keys, the caps, the stamina, the tired jog, the sprint's mutes, the body's turn, the fades,
// a seat taken in the middle of a sprint -- at 30, 60 and 144 frames a second; what it answers with the classes off,
// which is the movement before them; and each of its calls in the player's update, the game's frame and the peers'
// pinned as text, with the old expressions still standing under them.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BodyLoco, LocoIn, SPRINT_ENDERS, SPRINT_MUTES, fightKeysDown, newLocoIn, type LocoRig } from '../../../src/anim/bodyLoco.ts';
import { rateFor } from '../../../src/anim/locoPhase.ts';
import { tableClips } from '../../../src/anim/locoTable.ts';
import { LOCO_TUNE, LOCO_TUNE_SHIPPED, tuneLoco, type LocoTune } from '../../../src/anim/locoTune.ts';
import { loadOldMany } from './oldModules.ts';
import { beforeLocoTune } from './polishFixtures.ts';
import { DEFAULT_BINDINGS, FIGHT_ACTIONS } from '../../../src/core/input.ts';
import { JKA, UNIT } from '../../../src/player/jkaMove.ts';
import { STATS } from '../../../src/progress/stats.ts';
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
// 62143fe's tune (the speeds as started, the slow strafe, a gun's split carry): what this wave 2a suite's numbers are
// written for; the polish's own rules are locoPolish.test.ts's.
const T = (): LocoTune => beforeLocoTune();
const DEG = 180 / Math.PI;
/** The digest of the 'muted' frame trace, recorded from 91e62d9's own modules: what a checkout with no history is held to. */
const MUTED_TRACE = '41249bd20fff03f8';

/** A rig with every clip of the table (and what was asked of it), each clip's feet made for 3 m/s. */
const asked: string[] = [];
const full: LocoRig = { has: (c) => (asked.push(c), true), speedOut: 0, readSpeed() { this.speedOut = 3; return true; } };
const bare: LocoRig = { has: (c) => !c.startsWith('mx_'), speedOut: 0, readSpeed: () => false };

interface Keys { w?: boolean; s?: boolean; a?: boolean; d?: boolean; shift?: boolean; walk?: boolean }
/** A body stepped a frame at a time: the keys read as the game reads them (held, and pressed on the frame they go down). */
class Body {
  readonly tune: LocoTune;
  readonly loco: BodyLoco;
  readonly f = newLocoIn();
  private was: Keys = {};
  rig: LocoRig | null = full;
  walking = false;
  rules = false;
  constructor(tune = T()) {
    this.tune = tune;
    this.loco = new BodyLoco(tune);
    this.f.sprint = tune.speed.forward.sprint;
    this.f.pool = tune.stamina.pool;
  }
  step(dt: number, k: Keys, over: Partial<LocoIn> = {}): void {
    this.walking = this.loco.keys(dt, !!k.shift, !!k.shift && !this.was.shift, !!k.walk, this.rig);
    this.was = k;
    Object.assign(this.f, { dt, mz: (k.w ? 1 : 0) - (k.s ? 1 : 0), mx: (k.d ? 1 : 0) - (k.a ? 1 : 0), standing: true, grounded: true, swimming: false, fighting: false, aiming: false, gunUp: false, fightKeys: false, boost: 1 }, over);
    this.rules = this.loco.plan(this.f);
  }
  run(seconds: number, k: Keys, fps = 60, over: Partial<LocoIn> = {}): void {
    for (let i = 0; i < Math.round(seconds * fps); i++) this.step(1 / fps, k, over);
  }
  /** The legs asked as the player's update asks them: the ground speed written into the frame's record first. */
  legs(ground: number, jka = false, rig: LocoRig | null = this.rig) {
    this.f.ground = ground;
    return this.loco.legs(rig, this.f, jka);
  }
  /** Into a sprint: Shift held, let go a moment, and pressed again. */
  sprint(k: Keys = { w: true }): void {
    this.run(0.5, { ...k, shift: true });
    this.run(0.2, k);
    this.run(0.3, { ...k, shift: true });
  }
}

// ---- the classes ---------------------------------------------------------------------------------------------------------
{
  const b = new Body();
  const t = b.tune;
  b.run(0.2, {});
  ok(b.rules && !b.loco.moves && b.loco.pick === null && b.loco.cls === 2 && !b.loco.faces(false) && b.legs(0) === null, 'standing still the classes rule and there is nothing for the legs: the idle is the game\'s own, and no way is asked');
  b.run(0.5, { w: true });
  ok(b.loco.cls === 2 && b.loco.moves && b.loco.pick!.id === 'slow_run' && b.loco.speed === t.speed.forward.jog && b.loco.faces(false), 'nothing held is the jog');
  ok(b.legs(2.85, true) === null && !b.loco.legsOn && !b.loco.faces(true), 'with Jedi Academy\'s animations in charge (a block, a swing under way) the legs and the facing stay its own');
  ok(b.legs(2.85)!.id === 'slow_run' && b.loco.legsOn && b.legs(2.85, false, null) === null && !b.loco.legsOn, 'without, the legs are the table\'s clip; off its feet (no rig handed in) they are the caller\'s own');
  b.run(0.5, { w: true, shift: true });
  ok(b.loco.cls === 3 && b.loco.pick!.id === 'running' && b.loco.speed === t.speed.forward.run && !b.loco.sprinting, 'Shift held is the run');
  b.run(0.2, { w: true });
  b.run(0.5, { w: true, shift: true });
  ok(b.loco.cls === 4 && b.loco.pick!.id === 'fast_run' && b.loco.sprinting && b.loco.refused === '', 'let go and pressed again quickly, the sprint');
  b.f.sprint = 7.5;
  b.step(1 / 60, { w: true, shift: true }, { sprint: 7.5 });
  ok(b.loco.speed === 7.5, 'the sprint\'s speed is the one the body\'s stats hand in (the tune\'s own until something is earned)');
  b.run(0.3, { w: true, shift: true, a: true });
  ok(b.loco.cls === 3 && b.loco.pick!.id === 'left_strafe' && b.loco.refused.includes('only forward sprints') && !b.loco.sprinting && b.loco.asked === 4, 'a way with no sprint gives its run, and says why');
  b.run(0.3, { w: true, shift: true }, 60, { fighting: true });
  ok(b.loco.cls === 3 && b.loco.refused.includes('blocking or attacking') && !b.loco.sprinting, 'blocking, attacking or a swing under way caps it at the run');
  b.run(0.3, { w: true, shift: true }, 60, { aiming: true });
  ok(b.loco.cls === 2 && b.loco.refused.includes('aimed'), 'a blaster aimed caps it at the jog');

  // The walk key: Alt, held. It walks only while it is down, whatever Shift says; sideways that is the slow strafe.
  b.run(0.3, { a: true });
  b.step(1 / 60, { a: true, walk: true });
  ok(b.walking && b.loco.walkOn && b.loco.cls === 1 && b.loco.pick!.id === 'walk_strafe_left' && b.loco.speed === t.speed.side.walk && b.loco.pick!.state === 'walk', 'the walk key held is the walk; sideways that is the slow strafe, bare-handed (the owner\'s answer)');
  b.step(1 / 60, { a: true, walk: true }, { aiming: true, gunUp: true });
  ok(b.loco.pick!.id === 'walk_strafe_left', 'and with a blaster aimed just the same');
  b.run(0.3, { a: true, walk: true, shift: true });
  ok(b.loco.cls === 1 && b.loco.pick!.id === 'walk_strafe_left' && b.loco.refused.includes('walk key'), 'Shift does not lift it: the walk key holds the walk, and says so');
  b.run(1.2, { a: true, walk: true });
  ok(b.walking && b.loco.cls === 1, 'held on, the walk goes on (with Shift let go two drops ago)');
  b.step(1 / 60, { a: true });
  ok(!b.walking && !b.loco.walkOn && b.loco.cls === 2 && b.loco.pick!.id === 'jog_strafe_left', 'let go, the walk is over at once: a hold, never a toggle (the next frame is the jog)');
  b.step(1 / 60, { d: true, walk: true });
  ok(b.loco.pick!.id === 'walk_strafe_right', 'to the right, the right-hand slow strafe');
  b.step(1 / 60, { w: true, a: true, walk: true });
  ok(b.loco.pick!.id === 'left_strafe_walking' && b.loco.speed === t.speed.forwardDiag.walk, 'and the strafe walk is the walked forward diagonal\'s, with the body turned');

  // A blaster up (ready or aimed): a diagonal never turns the body, at any class, and moves as fast as it does without one.
  const g = new Body();
  const deg = () => Math.round(g.loco.turn * DEG);
  g.run(0.2, { w: true, d: true, walk: true }, 60, { gunUp: true });
  ok(g.loco.cls === 1 && g.loco.pick!.id === 'jog_forward_diagonal' && deg() === 0 && g.loco.speed === t.speed.forwardDiag.walk && g.loco.pick!.state === 'walk', 'with a blaster up a walked diagonal plays the diagonal\'s own jog clip with the body square to the view, at the walk\'s own speed');
  g.run(0.2, { w: true, d: true, walk: true });
  ok(g.loco.pick!.id === 'right_strafe_walking' && deg() === 45, 'and without one it is the strafe walk with the body turned 45 degrees, as the table has it');
  g.run(0.3, { s: true, a: true, shift: true }, 60, { gunUp: true });
  ok(g.loco.cls === 3 && g.loco.pick!.id === 'jog_backward_diagonal_mirrored' && deg() === 0 && g.loco.speed === t.speed.backDiag.run && g.loco.pick!.state === 'run', 'a run backward and left with a blaster up: the backward diagonal\'s own clip, square, at the run\'s own speed');
  g.run(0.3, { w: true, a: true, shift: true }, 60, { aiming: true });
  ok(g.loco.cls === 2 && g.loco.pick!.id === 'jog_forward_diagonal_mirrored' && deg() === 0 && g.loco.refused.includes('aimed'), 'aimed, the same clip at the jog the aim caps it at (the aim alone says the blaster is up)');
  // The square diagonals are a switch of ours: off, a blaster up follows the brief's rule as a body without one does.
  const brief = T();
  brief.gunSquare = false;
  const g2 = new Body(brief);
  g2.run(0.2, { w: true, a: true, walk: true }, 60, { aiming: true, gunUp: true });
  ok(g2.loco.pick!.id === 'left_strafe_walking' && Math.round(g2.loco.turn * DEG) === -45, 'with the square diagonals switched off an aimed walked diagonal is the brief\'s: the strafe walk with the body turned 45 degrees');
  g2.run(0.3, { s: true, d: true, shift: true }, 60, { gunUp: true });
  ok(g2.loco.pick!.id === 'running_backward' && Math.round(g2.loco.turn * DEG) === 45, 'and a run backward and right the backward run, turned');
  // The body's turn.
  const turn = (k: Keys) => {
    const x = new Body();
    x.run(0.1, { ...k, walk: true });
    return Math.round(x.loco.turn * DEG);
  };
  ok(turn({ w: true }) === 0 && turn({ s: true }) === 0 && turn({ a: true }) === 0 && turn({ w: true, d: true }) === 45 && turn({ w: true, a: true }) === -45 && turn({ s: true, d: true }) === 45 && turn({ s: true, a: true }) === -45, 'backing up and strafing leave the body facing the view; a walked diagonal turns it 45 degrees (in radians, left positive)');
}

// ---- the legs' rate, the body's turn eased, the fades, and the state the clip is asked for ---------------------------------
{
  const b = new Body();
  const t = b.tune;
  b.run(0.2, { w: true });
  // The rate: the ground speed over the clip's own, inside the band, by `rateFor`'s own arithmetic.
  let apart = 0;
  for (const boost of [1, 1.6, 2.4]) {
    b.step(1 / 60, { w: true }, { boost });
    for (let g = 0; g <= 12; g += 0.37) {
      b.legs(g);
      if (!Object.is(b.loco.rate, rateFor(g, 3, t.rate.min, t.rate.max, boost))) apart++;
    }
  }
  b.step(1 / 60, { w: true });
  ok(apart === 0, 'the rate the legs\' clip plays at is the ground speed over the speed its feet were made for, held inside the tune\'s band, whose top Force Speed\'s factor raises: `rateFor` to the bit');
  // The feet's own dial: the clip's foot speed taken as that share of what the pack says, so the clip plays slower.
  b.legs(3);
  const plain = b.loco.rate;
  t.rate.feet = 1.1;
  b.legs(3);
  const slowed = b.loco.rate;
  b.legs(30);
  const capped = b.loco.rate;
  t.rate.feet = 1;
  ok(plain === 1 && Math.abs(slowed - 1 / 1.1) < 1e-12 && capped === t.rate.max, '`rate.feet` at 1.1 plays the legs a tenth slower for the same ground speed, inside the same band; at 1 the rate is the pack\'s own');
  const unknown: LocoRig = { has: () => true, speedOut: 7, readSpeed: () => false };
  const still: LocoRig = { has: () => true, speedOut: 0, readSpeed() { this.speedOut = 0; return true; } };
  ok((b.legs(5, false, unknown), b.loco.rate) === 1 && (b.legs(5, false, still), b.loco.rate) === 1, 'a clip of unknown speed, or of none, plays at 1');

  // The turn, eased: an exponential of the frame's own seconds, so the body comes round alike at any frame rate.
  const eased = (fps: number, seconds: number) => {
    const x = new Body();
    x.run(0.2, { w: true, walk: true }, fps);
    x.loco.face(true);
    for (let i = 0; i < Math.round(seconds * fps); i++) {
      x.step(1 / fps, { w: true, d: true, walk: true });
      x.loco.face(x.loco.faces(false));
    }
    return x.loco;
  };
  const at = [30, 60, 144].map((fps) => eased(fps, 0.1).turnNow * DEG);
  const want = 45 * (1 - Math.exp(-0.1 * t.turn.rate));
  ok(at.every((v) => Math.abs(v - want) < 0.5), `a tenth of a second into a 45 degree turn the body has come round ${want.toFixed(1)} degrees, the same at 30, 60 and 144 frames a second (${at.map((v) => v.toFixed(2)).join(', ')})`);
  const linear = 45 * Math.min(1, (1 / 30) * t.turn.rate);
  ok(Math.abs(eased(30, 1 / 30).turnNow * DEG - 45 * (1 - Math.exp(-t.turn.rate / 30))) < 1e-9 && Math.abs(45 * (1 - Math.exp(-t.turn.rate / 30)) - linear) > 3, 'one frame of it is the exponential\'s share, which at 30 frames a second is some degrees short of a share counted in frames');
  const done = eased(60, 1.5);
  ok(Math.abs(done.turnNow * DEG - 45) < 0.01 && done.turnStep > 0 && done.turnStep < 1 && Math.abs(done.turnStep - (1 - Math.exp(-t.turn.rate / 60))) < 1e-12, 'it settles on the clip\'s turn, and each frame\'s share of the way left is what the caller turns the heading by');
  done.face(false);
  ok(done.turnNow * DEG < 45 && done.turnNow > 0, 'and it eases back out when the body stops facing by the table');
  const slow = T();
  slow.turn.rate = 2;
  const sb = new Body(slow);
  sb.run(0.2, { w: true, walk: true });
  for (let i = 0; i < 6; i++) {
    sb.step(1 / 60, { w: true, d: true, walk: true });
    sb.loco.face(true);
  }
  ok(sb.loco.turnNow * DEG < eased(60, 0.1).turnNow * DEG / 3, 'how fast is the tune\'s own rate');

  // The fade a change of the legs' clip takes: by what had the legs last frame and what has them now.
  const ft = T();
  ft.fade.loco = 0.11;
  ft.fade.idle = 0.22;
  ft.fade.jka = 0.33;
  const fb = new BodyLoco(ft);
  const fade = (legs: boolean, jka: boolean, moving: boolean) => (fb.fadeFor(legs, jka, moving), fb.fadeNow);
  ok(fade(false, false, false) === 0.22 && fade(true, false, true) === 0.22, 'standing to a walk or a run fades by the tune\'s `idle`');
  ok(fade(true, false, true) === 0.11 && fade(true, false, true) === 0.11, 'between two of the classes\' clips by its `loco`');
  ok(fade(false, true, true) === 0.33 && fade(false, true, true) === 0.33 && fade(true, false, true) === 0.33, 'into Jedi Academy\'s legs, between two of them, and out of them again by its `jka`');
  ok(fade(true, false, true) === 0.11 && fade(false, false, false) === 0.22 && fade(false, false, false) === 0.22 && fade(false, true, false) === 0.33 && fade(false, false, false) === 0.33, 'back to standing by `idle`; a stance taken standing and let go again by `jka`');
  ok(fade(false, false, true) === 0.22 && fade(true, false, true) === 0.22, 'and anything else that had the legs (a crouch, the air) by `idle`');

  // The state the classes' clip is asked for: the caller is told the one to let go of.
  const pb = new BodyLoco(T());
  ok(pb.prefers(null) === null && pb.prefers('run') === null && pb.prefers('run') === null, 'a state asked for the classes\' clip is not let go of while it is still the one asked');
  ok(pb.prefers('walk') === 'run' && pb.prefers(null) === 'walk' && pb.prefers(null) === null, 'another state, or none, and the last one is handed back once to be let go of');
}

// ---- stamina through the body, at any frame rate ---------------------------------------------------------------------------
{
  /** A script of key legs; what the body was doing at the end of each. */
  const script = (fps: number) => {
    const b = new Body();
    const rows: string[] = [];
    const leg = (seconds: number, k: Keys, over = {}) => {
      b.run(seconds, k, fps, over);
      rows.push(`${b.loco.cls}${b.loco.pick?.id ?? '-'}${b.loco.stamina.tired ? '!' : ''}`);
      return b.loco.stamina.value;
    };
    const v: number[] = [];
    v.push(leg(1, { w: true, shift: true })); // the run: holds
    v.push(leg(0.2, { w: true })); // let go
    v.push(leg(5, { w: true, shift: true })); // the sprint: 60 spent
    v.push(leg(4, { w: true, shift: true })); // emptied on the way: tired, the tired jog
    v.push(leg(3, { w: true, shift: true })); // still tired
    v.push(leg(6, { w: true, shift: true })); // rested at 30: the run, which holds
    v.push(leg(2, { s: true, shift: true })); // backward at the run: regains
    v.push(leg(2, { a: true })); // sideways at the jog: holds
    v.push(leg(1, { w: true }, { grounded: false })); // in the air: holds
    v.push(leg(2, {})); // standing: regains
    return { rows, v, b };
  };
  const runs = [30, 60, 144].map(script);
  ok(runs.every((r) => r.rows.join() === runs[0].rows.join()), `the same keys give the same classes and clips at 30, 60 and 144 frames a second (${runs[0].rows.join(' ')})`);
  ok(runs[0].rows.join() === '3running,3running,4fast_run,2drunk_run_forward!,2drunk_run_forward!,3running,3running_backward,2jog_strafe_left,2slow_run,2-', 'the run, the sprint, emptied the tired jog (no run however long Shift is held), rested the run again and not the sprint, backward, sideways, the air, standing');
  let spread = 0;
  for (let i = 0; i < runs[0].v.length; i++) spread = Math.max(spread, Math.max(...runs.map((r) => r.v[i])) - Math.min(...runs.map((r) => r.v[i])));
  ok(spread < 0.5, `and the pool the same at every leg's end to within half a point (the widest ${spread.toFixed(3)}; ${runs[0].v.map((x) => x.toFixed(1)).join(' ')})`);
  const v = runs[1].v;
  ok(v[0] === 100 && Math.abs(v[2] - 40) < 0.3 && v[3] < 6 && v[4] < 30 && Math.abs(v[5] - 30) < 0.3 && Math.abs(v[6] - 50) < 0.3 && Math.abs(v[7] - 50) < 0.3 && Math.abs(v[8] - 50) < 0.3 && Math.abs(v[9] - 70) < 0.3, 'the run holds the pool, five seconds of sprint spend 60, the tired jog regains 4 a second to 30, the run holds again, backward regains 10 a second at any class, sideways from the jog up and the air hold, standing regains 10');
  // Crouched, kneeling, prone and swimming keep their own rules, and regain as a walk does (the water: nothing).
  const b = runs[1].b;
  const before = b.loco.stamina.value;
  b.run(1, { w: true, shift: true }, 60, { standing: false });
  ok(!b.rules && !b.loco.moves && b.legs(2) === null && !b.loco.faces(false) && !b.loco.sprinting && Math.abs(b.loco.stamina.value - before - 10) < 0.2, 'a body not standing (crouched, kneeling, prone) is left to its own rules: no class speed, no imported legs, no turn; the pool regains as at a walk');
  ok(!b.walking, 'and Shift does not slow it: with the classes on, only the walk key is the walk a crouch or a crawl reads');
  b.step(1 / 60, { w: true, walk: true }, { standing: false });
  ok(b.walking, 'which the walk key held is');
  const wet = b.loco.stamina.value;
  b.run(1, { w: true }, 60, { swimming: true });
  ok(!b.rules && b.loco.stamina.value === wet, 'nor one swimming, where the pool holds');
  b.loco.refill(100);
  ok(b.loco.stamina.value === 100 && !b.loco.stamina.tired && b.loco.asked === 2, 'a respawn or an arrival fills it and rests the body');
  // A sprint carried through a respawn with Shift never let go comes back as the run, not the sprint.
  const r = new Body();
  r.sprint();
  ok(r.loco.sprinting && r.loco.asked === 4, 'sprinting');
  r.loco.refill(100);
  ok(!r.loco.sprinting, 'a respawn ends the sprint there and then');
  r.run(0.3, { w: true, shift: true });
  ok(r.loco.asked === 3 && r.loco.cls === 3 && !r.loco.sprinting, 'and with Shift held through it the body comes back at the run: the class asked was forgotten with the pool\'s refill');
  // A jump out of a sprint is still the sprint: its keys stay muted in the air, and it costs what the sprint costs.
  const j = new Body();
  j.sprint();
  const up = j.loco.stamina.value;
  j.run(1, { w: true, shift: true }, 60, { grounded: false });
  ok(j.loco.sprinting && j.loco.cls === 4 && j.loco.speed === j.tune.speed.forward.sprint && Math.abs(up - j.loco.stamina.value - 12) < 0.3, 'a jump out of a sprint is still the sprint: the fight\'s keys stay muted through it, the speed is the sprint\'s, and a second of it in the air spends the 12 a second on the ground does');
  // The walk in the air regains nothing, and a rate apart for the air is read.
  const w = new Body();
  w.run(1, { w: true, shift: true });
  w.loco.stamina.value = 50;
  w.run(1, { w: true, walk: true }, 60, { grounded: false });
  ok(Math.abs(w.loco.stamina.value - 50) < 1e-9, 'walking through the air regains nothing');
  // A bigger pool, as progression may hand in.
  const big = new Body();
  big.run(10, { w: true }, 60, { pool: 150 });
  big.loco.stamina.value = 150;
  big.run(1, { w: true, shift: true }, 60, { pool: 150 });
  big.run(0.2, { w: true }, 60, { pool: 150 });
  big.run(12, { w: true, shift: true }, 60, { pool: 150 });
  ok(Math.abs(big.loco.stamina.value - (150 - 12 * 12)) < 0.5, 'the pool is the size the body\'s stats hand in');
}

// ---- a body that leaves its feet in the middle of a sprint (a seat, noclip, adrift, the editor's flight, death) --------------
{
  const b = new Body();
  b.sprint();
  b.run(3, { w: true, shift: true });
  ok(b.loco.sprinting && b.loco.stamina.value < 70, 'sprinting, the pool a third spent');
  const spent = b.loco.stamina.value;
  // What every branch of the player's update that returns before the classes are planned calls instead.
  for (let i = 0; i < 60; i++) b.loco.idle(1 / 60, 100);
  ok(!b.loco.sprinting && !b.loco.rules && !b.loco.moves && b.loco.pick === null && b.loco.asked === 2 && !b.loco.walkOn && b.loco.turn === 0 && b.loco.turnNow === 0, 'seated in the middle of a sprint, nothing sprints from the first frame: the fight\'s keys are not left muted for the ride, and no clip of the classes has the legs');
  ok(b.legs(6) === null && !b.loco.faces(false), 'the legs and the facing are the seat\'s own');
  ok(Math.abs(b.loco.stamina.value - spent - 10) < 0.2, 'and the pool regains through the ride as it does standing (10 a second), so its bar does not stand frozen for the ride');
  for (let i = 0; i < 600; i++) b.loco.idle(1 / 60, 100);
  ok(b.loco.stamina.value === 100 && !b.loco.stamina.shown(100, b.tune), 'full again, and its bar down a moment after');
  b.run(0.3, { w: true, shift: true });
  ok(b.loco.cls === 3 && !b.loco.sprinting, 'on foot again with Shift held all the while: the run, not the sprint the body sat down out of');
  // Dead (`dt` nought): put down, the pool as it stood (the respawn fills it).
  const d = new Body();
  d.sprint();
  d.run(2, { w: true, shift: true });
  const left = d.loco.stamina.value;
  d.loco.idle(0, 100);
  ok(!d.loco.sprinting && d.loco.stamina.value === left, 'a body put down with no time passed (dead) keeps its pool as it stood and sprints no more');
  // Tired, a ride rests the body.
  const tired = new Body();
  tired.sprint();
  tired.run(9, { w: true, shift: true });
  ok(tired.loco.stamina.tired, 'sprinted out: tired');
  for (let i = 0; i < 60 * 4; i++) tired.loco.idle(1 / 60, 100);
  ok(!tired.loco.stamina.tired && tired.loco.stamina.value > 30, 'four seconds in a seat and it is rested');
  // With the classes switched off the pool is simply full.
  const offTune = T();
  const off = new Body(offTune);
  off.sprint();
  off.run(2, { w: true, shift: true });
  offTune.on = false;
  off.loco.idle(1 / 60, 100);
  ok(off.loco.stamina.value === 100 && !off.loco.sprinting, 'seated with the classes switched off, the pool is full and its bar down');
}

// ---- the classes off, or a rig without the clips: the movement before them ------------------------------------------------
{
  for (const [name, make] of [['the switch off', () => { const t = T(); t.on = false; return new Body(t); }], ['a rig without the imported clips', () => { const b = new Body(); b.rig = bare; return b; }], ['no rig', () => { const b = new Body(); b.rig = null; return b; }]] as const) {
    const b = make();
    b.step(1 / 60, { w: true });
    const none = !b.walking && !b.rules;
    b.step(1 / 60, { w: true, shift: true });
    const shift = b.walking && !b.rules;
    b.step(1 / 60, { w: true, walk: true });
    const walk = b.walking && !b.rules;
    b.run(20, { w: true, shift: true });
    b.loco.face(b.loco.faces(false));
    ok(none && shift && walk && !b.loco.on && !b.loco.moves && b.legs(6) === null && !b.loco.legsOn && !b.loco.faces(false) && b.loco.turn === 0 && b.loco.turnNow === 0 && !b.loco.sprinting && b.loco.stamina.value === 100 && !b.loco.stamina.shown(100, b.tune), `${name}: Shift walks as it always did (and the walk key, held), no class speed is given, the legs and the facing are the caller's own, nothing sprints, and the pool stays full with its bar down`);
  }
  const b = new Body();
  ok(b.loco.enabled(full) && !b.loco.enabled(bare) && !b.loco.enabled({ has: (c) => c !== 'mx_fast_run', speedOut: 0, readSpeed: () => false }), 'the classes need every clip of the table on the rig: with one missing the body moves as before');
  asked.length = 0;
  b.loco.enabled(full);
  ok(asked.sort().join() === tableClips().map((id) => `mx_${id}`).sort().join(), 'asked of the rig by the game\'s own names for them');
  // Flipped live, the pool is put down with the classes.
  const t = T();
  const live = new Body(t);
  live.sprint();
  live.run(3, { w: true, shift: true });
  ok(live.loco.sprinting && live.loco.stamina.value < 70, 'sprinting');
  t.on = false;
  live.step(1 / 60, { w: true, shift: true });
  ok(!live.rules && live.walking && !live.loco.sprinting && live.loco.stamina.value === 100 && live.loco.asked === 2 && live.legs(6) === null, 'switched off live the next frame is the old movement: Shift walks, nothing sprints, the pool is full');
  ok(live.loco.prefers(null) === null && (live.loco.prefers('run'), live.loco.prefers(null)) === 'run', 'and the state the classes\' clip had been asked for is handed back to be let go of, so the rig picks that state\'s own clip again while the body runs on');
  t.on = true;
  live.step(1 / 60, { w: true });
  ok(live.rules && live.loco.cls === 2, 'and switched on again the jog');
}

// ---- the sprint's mutes, the bindings and the stats ----------------------------------------------------------------------
{
  ok(SPRINT_MUTES.join() === 'attack,altFire,saberThrow' && SPRINT_MUTES.every((a) => Object.hasOwn(DEFAULT_BINDINGS, a) && (FIGHT_ACTIONS as readonly string[]).includes(a)), 'sprinting, the attack, a gun\'s other trigger and the saber\'s throw are muted: each an action the game has, each one of the fight\'s');
  ok(!SPRINT_MUTES.includes('block') && !SPRINT_MUTES.includes('altAttack') && !SPRINT_MUTES.includes('jump'), 'never the block or a blaster\'s aim, which end the sprint by the classes\' own caps, nor the jump');
  ok(text('src/combat/unarmed.ts').includes('if (!onFoot || this.blow || player.sprinting) return;'), 'bare hands\' kick is on the aim\'s own key, which the sprint cannot mute, so the brawl itself starts no blow while the body sprints');
  ok(DEFAULT_BINDINGS.walk.join() === 'AltLeft,AltRight' && DEFAULT_BINDINGS.walk.join() === DEFAULT_BINDINGS.freeLook.join() && DEFAULT_BINDINGS.speedUp.join() === 'ShiftLeft,ShiftRight' && !Object.values(DEFAULT_BINDINGS).some((codes) => codes.includes('CapsLock')), 'the walk is Alt, with the free look (the one is read only on foot on the ground, the other only riding, piloting and adrift); Shift is the speed-up; nothing is on Caps Lock');
  const sprint = STATS.find((s) => s.id === 'move.sprint')!, stamina = STATS.find((s) => s.id === 'move.stamina')!;
  ok(sprint.status === 'route' && sprint.base === LOCO_TUNE_SHIPPED.speed.forward.sprint && sprint.reads === 'src/player/player.ts' && stamina.status === 'route' && stamina.base === LOCO_TUNE_SHIPPED.stamina.pool && stamina.reads === 'src/player/player.ts', 'the progression table\'s sprint speed and stamina pool are read through the player\'s stats, each base the tune\'s own number');
  ok(LOCO_TUNE_SHIPPED.speed.forward.sprint === 7 && LOCO_TUNE_SHIPPED.speed.forward.sprint > JKA.speed * UNIT, `and the sprint starts at the owner's own 7 m/s (2026-11-15: "the speed for sprint fast"), faster than Jedi Academy's own run, the one speed the body had before (${(JKA.speed * UNIT).toFixed(2)})`);
}

// ---- a fight's key while sprinting: 'ends' (the owner's word of 2026-11-15), and 'muted' (the rule before) ------------------
{
  // Which keys: the fight's five, pressed or held; never an ability key or the jump.
  const reader = (held: string[], pressed: string[] = []) => ({ held: (a: string) => held.includes(a), pressedAction: (a: string) => pressed.includes(a) });
  ok(SPRINT_ENDERS.join() === 'attack,altAttack,altFire,saberThrow,block' && SPRINT_ENDERS.every((a) => Object.hasOwn(DEFAULT_BINDINGS, a) && (FIGHT_ACTIONS as readonly string[]).includes(a)), 'the keys that end a sprint are the attack, the other attack (a blaster\'s aim, bare hands\' kick), a gun\'s other trigger, the saber\'s throw and the block: each an action the game has, each one of the fight\'s');
  ok(SPRINT_ENDERS.every((a) => fightKeysDown(reader([a])) && fightKeysDown(reader([], [a]))) && !fightKeysDown(reader([])), 'each of them pressed or held is one');
  ok(!['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6', 'jump', 'speedUp', 'walk', 'forward'].some((a) => fightKeysDown(reader([a], [a]))), 'and the six ability keys, the jump, the speed keys and the move keys never are');
  ok(LOCO_TUNE_SHIPPED.sprintFight === 'ends', 'the rule is \'ends\' unless the owner moves it');

  // 'ends', at 30, 60 and 144 frames a second.
  for (const fps of [30, 60, 144]) {
    const b = new Body();
    b.sprint();
    ok(b.loco.sprinting && b.loco.mutes() === null, `${fps} fps: sprinting under 'ends', nothing is muted (the press is never swallowed)`);
    b.step(1 / fps, { w: true, shift: true }, { fightKeys: true });
    ok(!b.loco.sprinting && b.loco.cls === 3 && b.loco.asked === 3 && b.loco.pick!.id === 'running' && b.loco.speed === b.tune.speed.forward.run && b.loco.refused.includes('fight key') && b.loco.mutes() === null, `${fps} fps: the frame a fight's key goes down the sprint is over and the body is at the run, on that very frame (so the kit, which reads the press after the body's plan, finds no sprint: the press goes through)`);
    b.run(1, { w: true, shift: true }, fps);
    ok(!b.loco.sprinting && b.loco.cls === 3 && b.loco.asked === 3, `${fps} fps: with Shift still held, a second on, the run: the sprint does not come back by itself`);
    b.run(0.2, { w: true }, fps);
    b.run(0.3, { w: true, shift: true }, fps);
    ok(b.loco.sprinting && b.loco.cls === 4, `${fps} fps: a fresh double tap of Shift sprints again`);
    // The block: held while sprinting, then let go with Shift still held.
    b.run(0.3, { w: true, shift: true }, fps, { fighting: true, fightKeys: true });
    ok(!b.loco.sprinting && b.loco.cls === 3, `${fps} fps: a block held caps it at the run`);
    b.run(0.5, { w: true, shift: true }, fps);
    ok(!b.loco.sprinting && b.loco.cls === 3 && b.loco.asked === 3, `${fps} fps: and let go with Shift still held it is the run, not the sprint: a block ends it the same way`);
    // The jump and the ability keys: no fight key, so the sprint goes on through them.
    b.run(0.2, { w: true }, fps);
    b.run(0.3, { w: true, shift: true }, fps);
    b.run(0.5, { w: true, shift: true }, fps, { grounded: false });
    ok(b.loco.sprinting && b.loco.cls === 4, `${fps} fps: a jump out of a sprint is still the sprint`);
    // Shift let go just before the fight's key and pressed once just after it: the two taps straddle the attack, and
    // are no double tap. The let-go before the key is forgotten, so the one press held gives the run.
    b.run(0.5, { w: true, shift: true }, fps);
    b.run(0.1, { w: true }, fps);
    ok(b.loco.sprinting, `${fps} fps: Shift let go a moment, still sprinting (the drop's delay)`);
    b.step(1 / fps, { w: true }, { fightKeys: true });
    b.run(0.05, { w: true }, fps);
    b.run(1, { w: true, shift: true }, fps);
    ok(!b.loco.sprinting && b.loco.cls === 3 && b.loco.asked === 3, `${fps} fps: Shift let go, a fight's key, then one press of Shift held: the run, not the sprint (a let-go from before the key opens no tap)`);
    b.run(0.2, { w: true }, fps);
    b.run(0.3, { w: true, shift: true }, fps);
    ok(b.loco.sprinting && b.loco.cls === 4, `${fps} fps: and a double tap begun after the key sprints`);
  }
  // A fight's key held as the double tap comes: the sprint never starts.
  const h = new Body();
  h.run(0.5, { w: true, shift: true }, 60, { fightKeys: true });
  h.run(0.2, { w: true }, 60, { fightKeys: true });
  h.run(0.3, { w: true, shift: true }, 60, { fightKeys: true });
  ok(!h.loco.sprinting && h.loco.cls === 3, 'with a fight\'s key held (a trigger kept down) the double tap gives the run and never a sprint');
  // Walking, the walk key holds the walk whatever is pressed, and the sprint asked is left as it was.
  const w = new Body();
  w.sprint();
  w.step(1 / 60, { w: true, shift: true, walk: true }, { fightKeys: true });
  ok(w.loco.cls === 1 && w.loco.asked === 4, 'the walk key held, a fight\'s key ends nothing the body is not doing');
  // Switched to 'muted' live: the rule before, its mutes back.
  const m = new Body();
  ok(tuneLoco({ sprintFight: 'muted' }).length === 0 && tuneLoco({ sprintFight: 'off' })[0].includes("'ends' or 'muted'") && LOCO_TUNE.sprintFight === 'muted', 'the switch takes its two words and refuses any other');
  tuneLoco({ sprintFight: 'ends' });
  m.tune.sprintFight = 'muted';
  m.sprint();
  ok(m.loco.mutes() === SPRINT_MUTES, 'under \'muted\', sprinting, the sprint\'s mutes are asked for as before');
  m.step(1 / 60, { w: true, shift: true }, { fightKeys: true });
  ok(m.loco.sprinting && m.loco.cls === 4, 'and a fight\'s key ends nothing');
  m.run(0.3, { w: true, shift: true }, 60, { fighting: true, fightKeys: true });
  m.run(0.3, { w: true, shift: true });
  ok(m.loco.sprinting && m.loco.cls === 4, 'a block held caps it only while held: let go with Shift still held, the sprint is back by itself (what a block did before the owner\'s word)');
  ok((m.loco.report(100) as { sprintFight: string }).sprintFight === 'muted', '__debug.loco() says the rule');

  // 'muted' is 91e62d9's frame for frame: the same keys through that commit's own modules, out of git, and through
  // today's, every number the record answers and the mutes the game asks for, compared by Object.is.
  const FILES = ['src/anim/bodyLoco.ts', 'src/anim/locoClass.ts', 'src/anim/locoTable.ts', 'src/anim/locoTune.ts'];
  const oldMods = await loadOldMany(FILES, ['src/anim/bodyLoco.ts', 'src/anim/locoTune.ts'], '91e62d9');
  const trace = (Loco: new (t: never) => BodyLoco, tune: unknown, mutesOf: (b: BodyLoco) => readonly string[] | null): string[] => {
    const rows: string[] = [];
    for (const fps of [30, 60, 144]) {
      const b = new Loco(tune as never);
      const f = newLocoIn();
      f.sprint = 6.35;
      f.pool = 100;
      let was = false;
      const step = (seconds: number, k: Keys, over: Partial<LocoIn> = {}) => {
        for (let i = 0; i < Math.round(seconds * fps); i++) {
          const dt = 1 / fps;
          const mutes = mutesOf(b);
          b.keys(dt, !!k.shift, !!k.shift && !was, !!k.walk, full);
          was = !!k.shift;
          Object.assign(f, { dt, mz: (k.w ? 1 : 0) - (k.s ? 1 : 0), mx: (k.d ? 1 : 0) - (k.a ? 1 : 0), standing: true, grounded: true, swimming: false, fighting: false, aiming: false, gunUp: false, fightKeys: false, boost: 1, ground: 0 }, over);
          const rules = b.plan(f);
          f.ground = b.speed * (f.grounded ? 0.97 : 1);
          const legs = b.legs(full, f, !!over.fighting);
          b.face(b.faces(!!over.fighting));
          b.fadeFor(legs !== null, !!over.fighting, f.mz !== 0 || f.mx !== 0);
          rows.push([mutes ? mutes.join('+') : '-', rules, b.asked, b.cls, b.speed, b.sprinting, b.refused, b.pick?.id ?? '-', b.dir, b.walkOn, b.moves, b.legsOn, b.rate, b.turn, b.turnNow, b.turnStep, b.fadeNow, b.stamina.value, b.stamina.tired].map((v) => (typeof v === 'number' ? Object.is(v, -0) ? '-0' : String(v) : String(v))).join(' '));
        }
      };
      step(0.5, { w: true });
      step(0.5, { w: true, shift: true });
      step(0.2, { w: true });
      step(0.6, { w: true, shift: true });
      step(1 / fps, { w: true, shift: true }, { fightKeys: true });
      step(0.4, { w: true, shift: true }, { fightKeys: true, fighting: true });
      step(0.5, { w: true, shift: true });
      step(0.3, { w: true, shift: true }, { fightKeys: true, aiming: true, gunUp: true });
      step(0.4, { w: true, shift: true });
      step(0.3, { w: true, a: true, shift: true }, { fightKeys: true });
      step(0.3, { s: true, d: true, shift: true });
      step(0.3, { a: true, walk: true }, { fightKeys: true });
      step(0.3, {});
      step(0.2, { w: true });
      step(0.6, { w: true, shift: true }, { grounded: false });
      step(6, { w: true, shift: true });
      step(1, { w: true }, { standing: false });
      step(0.3, { w: true }, { swimming: true });
      b.idle(1 / fps, 100);
      step(0.5, { w: true, shift: true });
    }
    return rows;
  };
  const todayMuted = T();
  todayMuted.sprintFight = 'muted';
  const now = trace(BodyLoco as never, todayMuted, (b) => b.mutes());
  const digest = createHash('sha1').update(now.join('\n')).digest('hex').slice(0, 16);
  if (oldMods) {
    const [oldBody, oldTune] = oldMods as [{ BodyLoco: new (t: never) => BodyLoco; SPRINT_MUTES: readonly string[] }, { LOCO_TUNE_SHIPPED: unknown }];
    const then = trace(oldBody.BodyLoco, JSON.parse(JSON.stringify(oldTune.LOCO_TUNE_SHIPPED)), (b) => (b.sprinting ? oldBody.SPRINT_MUTES : null));
    const first = now.findIndex((r, i) => r !== then[i]);
    ok(now.length === then.length && first < 0, `under 'muted' the record is 91e62d9's, frame for frame at 30, 60 and 144 frames a second (${now.length} frames: the mutes the game asks for, the class asked and given, the speed, the pick, the rate, the turn, the fade and the pool)${first >= 0 ? `: frame ${first} is ${now[first]} against ${then[first]}` : ''}`);
    note(`the 'muted' trace's digest is ${digest} (MUTED_TRACE, which a checkout with no history is held to)`);
  } else note('git cannot hand over 91e62d9\'s modules here: the \'muted\' trace is held to the digest recorded from them');
  ok(digest === MUTED_TRACE, `and its digest is the one recorded from 91e62d9's own modules (${digest})`);
}

// ---- the wiring, as text ---------------------------------------------------------------------------------------------------
{
  const player = text('src/player/player.ts');
  const main = text('src/main.ts');
  const peers = text('src/net/remotePlayers.ts');
  const rig = text('src/player/rig.ts');
  const hud = text('src/ui/hud.ts');
  const has = (src: string, line: string) => src.includes(line);
  const count = (src: string, part: string) => src.split(part).length - 1;

  ok(has(player, 'readonly loco = new BodyLoco(LOCO_TUNE);') && count(player, 'new BodyLoco(') === 1, 'the player keeps one record for the speed classes, over the game\'s one tune');
  ok(has(player, "const walking = this.loco.keys(dt, !atControls && input.held('speedUp'), !atControls && input.pressedAction('speedUp'), !atControls && input.held('walk'), this.rig);\n    this.walkKey = walking;") && count(player, 'this.loco.keys(') === 1 && !has(player, "const walking = input.held('walk');") && !has(player, "pressedAction('walk')"), 'the speed keys are read once, first thing, through the record (the walk key as a hold, and neither key at a ship\'s controls, where Shift is the boost and Alt the free look): what comes back is the walk by the old rules');
  ok(/lo\.dt = dt;\n\s+lo\.mz = mz;\n\s+lo\.mx = mx;\n\s+lo\.standing = !this\.crouching && !this\.duck\.crouch && !this\.prone && !this\.kneeling;\n\s+lo\.grounded = this\.grounded;\n\s+lo\.swimming = this\.swimming;\n(\s+\/\/[^\n]*\n)*\s+lo\.fighting = this\.blocking \|\| fighting;\n\s+lo\.aiming = this\.aiming;\n(\s+\/\/[^\n]*\n)*\s+lo\.fightKeys = !atControls && fightKeysDown\(input\);\n\s+lo\.gunUp = this\.classId === 'bounty_hunter' && !this\.fists && \(this\.aiming \|\| this\.gunReady\);\n(\s+\/\/[^\n]*\n)*\s+lo\.gunClass = this\.classId === 'bounty_hunter' && this\.hasGunClips && !this\.fists \? gunClassIndex\(this\.gunClass\) : -1;\n\s+lo\.sprint = this\.stats\.apply\('move\.sprint', LOCO_TUNE\.speed\.forward\.sprint\);\n\s+lo\.pool = this\.staminaPool;\n\s+lo\.boost = this\.speedMultiplier;\n(\s+\/\/[^\n]*\n)*\s+lo\.duckToCrouch = this\.duck\.toCrouch;\n\s+lo\.duckToCrawl = this\.duck\.toCrawl;\n(\s+\/\/[^\n]*\n)*\s+lo\.crouched = this\.crouching \|\| this\.duck\.crouch;\n\s+lo\.prone = this\.prone;\n\s+lo\.hpShare = this\.hp \/ this\.maxHp;\n\s+lo\.scale = this\.rig \? this\.rig\.root\.scale\.y : 1;\n\s+const classes = this\.loco\.plan\(lo\);\n\s+if \(classes\) \{\n\s+speed = this\.loco\.speed \* this\.speedMultiplier \* this\.lavaPaceNow;\n(\s+\/\/[^\n]*\n)*\s+this\.walkKey = this\.loco\.cls <= 1;/.test(player) && count(player, 'this.loco.plan(') === 1, 'the frame is handed over whole and planned once, after the water has said whether the body swims; a class\'s speed is the body\'s, under Force Speed and the lava\'s pace as ever, and the walk class picks the walk clips whatever key gave it; only blocking or a fight caps the class, never one of Jedi Academy\'s one-offs playing out (a Force jump\'s flip)');
  ok(player.indexOf('this.waterDepth = depth;') < player.indexOf('const classes = this.loco.plan(lo);') && player.indexOf('const classes = this.loco.plan(lo);') < player.indexOf('if (this.swimming) {\n      // Swimming: slow, no gravity'), 'between the swim\'s verdict and the swim itself');
  ok(has(player, "return this.stats.apply('move.stamina', LOCO_TUNE.stamina.pool);") && has(player, 'get sprinting(): boolean {\n    return this.loco.sprinting;\n  }'), 'the pool\'s size is the stats\' over the tune\'s, and the body sprints exactly while its record says so');
  ok(has(player, 'c.walk = classes && !script ? false : walking;') && has(player, 'c.speedScale = this.speedMultiplier * this.lavaPaceNow * (classes && this.loco.moves && !script ? this.loco.speed / (this.loco.posture === CROUCH && this.grounded ? JKA.speed * UNIT * JKA.duckScale : JKA.speed * UNIT) : this.paceScale(walking, mz, mx));'), 'Jedi Academy\'s movement is handed the class\'s speed as a share of its own run, with no halving, while a way is asked; with none (a body braking to a stop), in a leaping saber move, and everywhere without a class, the pace it always had');
  ok(has(player, 'if (!rig || this.swimming || !this.grounded || (!mz && !mx)) return 1;'), 'which with no key held is 1: the friction that stops a body is as hard as it was before the classes');
  // Every branch of the update that returns before the classes are planned puts them down first.
  const update = player.slice(player.indexOf('  update(dt: number, input: Input, cam: ThirdPersonCamera, world: World): void {'), player.indexOf('const walking = this.loco.keys('));
  // Wave 4: hanging from a ledge is the sixth, through `hangFrame`, and climbing a wall the seventh, through `wallFrame`,
  // each of which puts the record down first itself.
  const branches = ['if (this.ragdoll) {', 'if (this.editorFlight) {', 'if (this.mounted) {', 'if (this.noclip) {', 'if (world.planet.space && !this.aboard) {', 'if (this.ledge.holding) {', 'if (this.wall.holding) {'];
  const hangIdles = /private hangFrame\(dt: number, input: Input, cam: ThirdPersonCamera, world: World\): void \{\n    void world;\n    this\.loco\.idle\(0, this\.staminaPool\);/.test(player);
  const wallIdles = /private wallFrame\(dt: number, input: Input, cam: ThirdPersonCamera, world: World\): void \{\n    void world;\n    this\.loco\.idle\(0, this\.staminaPool\);/.test(player);
  const idled = branches.filter((open) => {
    const from = update.indexOf(open);
    const body = from < 0 ? '' : update.slice(from, update.indexOf('return;', from));
    return /this\.loco\.idle\((0|dt), this\.staminaPool\);/.test(body) || (hangIdles && /^if \(this\.ledge\.holding\) \{\n\s+this\.hangFrame\(dt, input, cam, world\);\n\s+$/.test(body)) || (wallIdles && /^if \(this\.wall\.holding\) \{\n\s+this\.wallFrame\(dt, input, cam, world\);\n\s+$/.test(body));
  });
  ok(idled.length === branches.length && count(update, 'return;') === branches.length && count(player, 'this.loco.idle(') === branches.length, `each of the ${branches.length} ways the update returns before the classes are planned (dead, the editor's flight, seated, noclip, adrift, hanging from a ledge, on a wall) puts the record down first, so a sprint never outlives the feet it was run on (${idled.length} of ${branches.length})`);
  ok(has(player, 'const locoFaces = moving && !this.swimming && this.loco.faces(this.jkaMode);\n    const locoTurn = locoFaces ? this.loco.turn : 0;') && /this\.loco\.face\(locoFaces\);/.test(player) && has(player, 'let diff = camYaw + locoTurn + this.aimBodyTurn - this.heading;') && has(player, '} else if (locoFaces) {\n      let diff = camYaw + locoTurn - this.heading;\n      diff = Math.atan2(Math.sin(diff), Math.cos(diff));\n      this.heading += diff * this.loco.turnStep;') && has(player, 'this.heading = camYaw + this.loco.turnNow;') && count(player, 'this.loco.face(') === 1, 'the body faces the view turned by the clip\'s own turn: eased by the record in third person (its share of the way left each frame), with the aim\'s correction on top with a blaster up, and as far as the record has eased it in first person');
  ok(player.indexOf('} else if (locoFaces) {') < player.indexOf('} else if (moving && directional) {') && has(player, '    } else if (moving) {\n      const desired = Math.atan2(move.x, move.z);') && has(player, 'const directional = this.jkaMode && !!this.rig && this.rig.hasState(\'runBack\');'), 'ahead of the old rules, which stand as they were under it: Jedi Academy\'s angled legs with its animations in charge, and the body turned the way it runs otherwise');
  ok(has(player, 'if (locoFaces && !this.lockedHeading) {\n      const back = camYaw + this.aimBodyNow - this.heading;\n      this.torsoTwist = Math.atan2(Math.sin(back), Math.cos(back)) * LOCO_TUNE.turn.torso;'), 'and the torso takes back the tune\'s share of however far the body stands from the view');
  ok(has(player, 'const onFeet = moving && this.grounded && !this.mounted && !this.swimming && !this.kneeling && (this.loco.posture !== STAND || (!this.prone && !this.crouching));\n    this.locoIn.ground = speed;\n    const legs = this.loco.legs(onFeet ? rig : null, this.locoIn, this.jkaMode);') && count(player, 'this.loco.legs(') === 1, 'the legs are asked for once a frame, only for a body moving on its feet on the ground, with the speed it really moves at written into the frame\'s record');
  ok(has(player, 'this.loco.fadeFor(legs !== null, this.jkaMode, moving);\n    this.legOpts.rate = this.loco.rate;\n    this.legOpts.fade = this.loco.fadeNow;\n    this.fadeOpts.fade = this.loco.fadeNow;\n    const fo = this.loco.on ? this.fadeOpts : undefined;') && count(player, 'this.loco.fadeFor(') === 1, 'the fade is the record\'s for the frame, handed on with every state; with the classes off no state is handed a fade or a rate (the rig\'s own, as before)');
  ok(has(player, 'const dropped = this.loco.prefers(legs && !armed ? legs.state : null);\n    if (dropped) rig.prefer(dropped as RigState, null, true);') && count(player, 'this.loco.prefers(') === 1, 'a state keeps the classes\' clip only while they have the legs: let go of, the rig is told to pick that state\'s own clip again');
  ok(has(player, "    else if (legs) {\n      // The speed classes: the imported clip for the way and the class, at the rate that matches the ground.\n      rig.prefer(legs.state, legs.clip);\n      rig.setState(legs.state, speed, null, this.legOpts);\n    } else rig.setState(running ? 'run' : 'walk', speed, null, fo);") && has(player, "    else if (this.jkaMode) rig.setState(running ? 'runSaber' : 'walkSaber', speed, null, fo);") && has(player, "    } else if (!moving) rig.setState('idle', 0, null, fo);"), 'bare-handed the legs\' clip is the state\'s by name, at the record\'s rate; Jedi Academy\'s run and walk, the idle and the game\'s own run and walk stand where they stood');
  ok(has(player, 'rig.prefer(state, legs.clip);\n        rig.setState(state, speed, gunUpper ?? (this.loco.carry === CARRY_FULL ? null : this.gunCarry(rig, gun)), this.legOpts);\n      } else rig.setState(state, speed, gunUpper, fo);') && has(player, "c.clip = rig.clipMatching(gun === 'pistol' ? /^loop_pistol_standing:speed0/ : /^loop_rifle:speed0/) ?? null;"), 'with a blaster the legs are the classes\' clip and the upper body the gun\'s own pose, or its relaxed carry: the pistol\'s standing loop for a pistol and the rifle\'s for a rifle');
  ok(has(player, "    let running = !this.walkKey;") && has(player, 'if (this.jkaMode && this.loco.rules && this.loco.moves) {') && has(player, 'running = this.loco.cls > 1 && this.loco.speed >= (this.directional && mz < 0 ? from.back : from.forward) * LOCO_TUNE.fight.walkUnder;') && has(player, "from.forward = Math.sqrt((rig.naturalSpeed('walkSaber') ?? 0) * (rig.naturalSpeed('runSaber') ?? 0));") && has(player, "from.back = Math.sqrt((rig.naturalSpeed('walkBack') ?? 0) * (rig.naturalSpeed('runBack') ?? 0));"), 'under a block or a swing with the classes ruling, Jedi Academy\'s legs are its walk where the class\'s speed is under the tune\'s share of the point between its walk\'s own speed and its run\'s, and its run from there up; without the classes the walk key picks, as it did');
  ok(has(player, 'const wideSpine = Math.max(AIM_SPINE_MAX, (LOCO_TUNE.turn.aimSpine * Math.PI) / 180);\n    this.aimSpineMax = legs ? wideSpine : AIM_SPINE_MAX;') && has(player, 'const spineFix = this.loco.on && gunUp ? THREE.MathUtils.clamp(this.aimFix.yaw - this.aimBodyNow, -wideSpine, wideSpine) : THREE.MathUtils.clamp(this.aimFix.yaw, -this.aimSpineMax, this.aimSpineMax);') && has(player, 'return this.aimFix.yaw - THREE.MathUtils.clamp(this.aimFix.yaw, -this.aimSpineMax, this.aimSpineMax);') && has(player, 'private aimSpineMax = AIM_SPINE_MAX;') && has(player, 'const stands = this.heading - camYaw - locoTurn;\n      this.aimBodyNow = Math.atan2(Math.sin(stands), Math.cos(stands));') && /this\.loco\.face\(locoFaces\);\n\s+this\.aimBodyNow = 0;/.test(player), 'under the classes\' legs the body\'s share of the aim\'s correction is what is over the tune\'s wider spine; the spine itself takes whatever of the correction the body does not stand turned by just now, so the two add up to it through every start and stop; without the classes the spine\'s share is the game\'s own, as before');
  ok(has(player, 'this.anim.drop();\n    // Whole means rested too: the stamina is full at a respawn and at an arrival.\n    this.loco.refill(this.staminaPool);'), 'a respawn and an arrival fill the pool');
  ok(has(player, "const speed = this.noclipSpeed * (input.held('speedUp') ? 3.5 : 1) * this.speedMultiplier;") && has(text('src/editor/editorEntry.ts'), "a.fast = input.held('speedUp');") && has(text('src/editor/editorEdit.ts'), "const shift = input.held('speedUp');"), 'noclip\'s fast, the world editor\'s fast flight and its Shift are Shift still, which is the speed-up now');

  ok(has(main, 'private stepSprintKeys(): void {\n    const mutes = this.player.loco.mutes();\n    if (mutes) this.input.mute(mutes as readonly Action[]);\n  }') && count(main, 'this.stepSprintKeys();\n') === 2 && /this\.stepSprintKeys\(\);\n\s+this\.stepImpactKeys\(\);/.test(main) && count(main, 'this.stepSprintKeys();') === count(main, 'this.stepImpactKeys();'), 'the game mutes what the record says to mute (under the tune\'s \'muted\' the sprint\'s actions, under \'ends\' nothing) at two places, the frame loop and the console\'s advance, each straight before the impact\'s and so before anything reads a key');
  // Under 'ends' a fight's key ends the sprint in the body's own plan, which must come before the kit reads the press:
  // in both loops the player's update stands before the combat's step (whose kit starts the swing, the shot, the kick).
  const loops = [main.indexOf('this.stepSprintKeys();'), main.lastIndexOf('this.stepSprintKeys();')].map((at) => ({ sprint: at, update: main.indexOf('player.update(dt,', at), combat: main.indexOf('this.stepCombat(dt);', at) }));
  ok(loops.every((l) => l.sprint >= 0 && l.sprint < l.update && l.update < l.combat) && has(main, 'this.kit.update(ctx);'), 'and in both the frame loop and the console\'s advance the player\'s update, which plans the class and ends a sprint, runs before the combat\'s step, whose kit reads the press: so the press that ends a sprint goes through on its own frame');
  ok(has(player, 'lo.fightKeys = !atControls && fightKeysDown(input);') && count(player, 'fightKeysDown(') === 1, 'the player hands the plan whether one of the fight\'s keys is pressed or held, once a frame, never at a ship\'s controls');
  ok(has(main, 'IMPORTED_CLIPS.strides = (clip) => MIXAMO.strideOf(clip);') && has(main, "LOCO_TUNE.on = locoSwitchOn(() => localStorage.getItem(LOCO_SWITCH));") && has(main, 'animDialsFor(helper) ?? locoDialsFor(helper) ??') && has(main, 'loco: (o: LocoDebugOptions = {}) => this.locoDebug(o),'), 'the game hands the rigs\' loader each clip\'s stride, reads the classes\' switch at load, and has the console\'s helper and its dials');
  ok(has(main, 'this.hud.setStamina(player.loco.stamina, staminaPool, player.loco.stamina.shown(staminaPool, LOCO_TUNE), player.loco.on);\n      this.hud.update(dt,'), 'and tells the display the pool each frame it draws it, and whether the classes are in force for the body at all');
  ok(has(main, "boost: input.held('speedUp') && (pilot.combat ? pilot.combat.boostLeft > 0 : true),"), 'a ship\'s boost is Shift still, which is the speed-up now');
  const prompt = text('src/ui/promptRules.ts');
  ok(count(prompt, "push(out, n, 'speedUp', W.boost)") === 2 && !has(prompt, "'walk', W.boost"), 'and the boost the action bar offers on a vehicle, racing or not, shows the speed-up\'s key');
  ok(has(hud, "{ text: 'move · mouse look · wheel zoom · %s jump · %s run · %s walk', actions: ['jump', 'speedUp', 'walk'], move: true },"), 'the help block names the run on the speed-up\'s key and the walk on the walk\'s, in that order');
  const menu = text('src/ui/menu.ts');
  ok(has(menu, "walk: 'Walk, held (on foot: the slowest pace)',") && has(menu, "speedUp: 'Run, tap again to sprint (vehicle: boost)',"), 'and the Controls page lists both under what they do');
  ok(has(text('src/ui/debugModel.ts'), "'anim', 'loco',"), 'the debug menu files `loco` beside `anim`, under Character and kit');

  ok(has(peers, 'PEER_IN.vx = r.vel.x;\n        PEER_IN.vz = r.vel.z;\n        PEER_IN.heading = r.heading;\n        PEER_IN.speed = r.speed;\n        PEER_IN.dt = dt;\n        let legs = r.loco.resolve(LOCO_TUNE, rig, state, PEER_IN);') && has(peers, 'rig.prefer(state, legs.clip);\n          r.locoState = state;\n          PEER_LEGS.rate = r.loco.rate;\n          PEER_LEGS.fade = LOCO_TUNE.fade.loco;\n          rig.setState(state, r.speed, upper, PEER_LEGS);') && has(peers, 'if (r.locoState && (!legs || r.locoState !== state)) {\n          // Let go of, the state picks its own clip again there and then, even where the state itself stays as it was.\n          rig.prefer(r.locoState, null, true);'), 'another player\'s legs are worked out from what they already send (the velocity their figure is heard at, the heading and the speed sent), and let go of, their state picks its own clip again');
  ok(has(peers, 'if (legs && !rv) {') && has(peers, "const back = legs ? null : peerBackState(state, r.loco.rel);\n          const shown = back && rig.hasState(back) ? back : state;\n          rig.setState(rig.hasState(shown) ? shown : 'idle', r.speed);"), 'a figure riding something is never handed the classes\' legs; and without an answer their state plays its own clip, as before, but that a figure sent a walk or a run while it goes backward plays its own back-pedal');
  ok(has(peers, 'const carry = peerCarryState(state);\n          if (carry) {') && has(peers, 'r.carryClip = rig.tableClip(carry);\n            }\n            // With the tune\'s \'full\' for their kind of gun out of combat, the table\'s clip has the whole body.\n            upper = relaxedGun === CARRY_FULL ? null : r.carryClip;'), 'with a gun their upper body keeps the standing pose of the carry their state names');
  ok(!/locoClass|cls:/.test(text('server/wire.mjs')) && has(text('server/wire.mjs'), "if (typeof x.gait === 'string' && GAITS.includes(x.gait)) hello.gait = x.gait;") && has(main, "s: p.mounted ? 'seated' : (rig?.describe().state ?? 'idle'), v: n2(Math.hypot(p.vel.x, p.vel.z)), m: !!p.mounted, sab: p.saberOn, q,"), 'nothing of the legs crosses the wire but a hello\'s gait (wave 2b): the state\'s name, the heading and the speed are what they were');
  ok(has(rig, "setState(state: RigState, speed = 0, upper: string | null = null, opts?: { rate?: number; fade?: number }): void {") && has(rig, 'const fade = opts?.fade ?? 0.18;') && has(rig, 'if (this.current && !same) this.current.crossFadeTo(next, fade, false);') && has(rig, "    let wanted = 1;\n    if (opts?.rate !== undefined) wanted = opts.rate;\n    else if (speed > 0) {") && has(rig, 'const natural = stride ? stride.speed * this.root.scale.y : this.clipSpeeds[clip] || DEFAULT_CLIP_SPEED[state];\n      if (natural) wanted = THREE.MathUtils.clamp(speed / natural, 0.5, 2.5);'), 'the rig takes a rate and a fade only where one is handed in: without, the fade is the game\'s own 0.18 and the rate the body\'s speed over the clip\'s inside the game\'s own band');

  // With the classes off: every hand-over above reduces to the line that stood at the commit before the wave.
  const PRE_WAVE = '3432677';
  let old: string | null = null;
  try {
    old = execFileSync('git', ['show', `${PRE_WAVE}:src/player/player.ts`], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n');
  } catch (err) {
    note(`git could not hand over the player before the wave (${err instanceof Error ? err.message.split('\n')[0] : err}): the old lines are held to the copies written here alone`);
  }
  // Each pair: the line before the wave, and today's with the record's off answers written in (classes false, no
  // legs, no facing, no fade, no way asked, the walk as it was, the spine's share the game's own).
  const reduce = (s: string) => s
    .replace("this.loco.keys(dt, !atControls && input.held('speedUp'), !atControls && input.pressedAction('speedUp'), !atControls && input.held('walk'), this.rig)", "input.held('walk')")
    .replace('classes && !script ? false : walking', 'walking')
    .replace('(classes && this.loco.moves && !script ? this.loco.speed / (this.loco.posture === CROUCH && this.grounded ? JKA.speed * UNIT * JKA.duckScale : JKA.speed * UNIT) : this.paceScale(walking, mz, mx))', 'this.paceScale(walking, mz, mx)')
    .replace('camYaw + locoTurn + this.aimBodyTurn', 'camYaw + this.aimBodyTurn')
    .replace('camYaw + this.loco.turnNow', 'camYaw')
    .replace('let running', 'const running')
    .replace('this.loco.on && gunUp ? THREE.MathUtils.clamp(this.aimFix.yaw - this.aimBodyNow, -wideSpine, wideSpine) : ', '')
    .replace(/this\.aimSpineMax/g, 'AIM_SPINE_MAX')
    .replace(/, null, fo\)/g, ')')
    .replace(/, gunUpper, fo\)/g, ', gunUpper)')
    .replace("rig.setState('idle', 0)", "rig.setState('idle')")
    .replace("rig.setState('stance', 0)", "rig.setState('stance')")
    .replace("input.held('speedUp') ? 3.5", "input.held('walk') ? 3.5");
  const lines: [string, string][] = [
    ["    const walking = input.held('walk');", "    const walking = this.loco.keys(dt, !atControls && input.held('speedUp'), !atControls && input.pressedAction('speedUp'), !atControls && input.held('walk'), this.rig);"],
    ['      c.walk = walking;', '      c.walk = classes && !script ? false : walking;'],
    ['      c.speedScale = this.speedMultiplier * this.lavaPaceNow * this.paceScale(walking, mz, mx);', '      c.speedScale = this.speedMultiplier * this.lavaPaceNow * (classes && this.loco.moves && !script ? this.loco.speed / (this.loco.posture === CROUCH && this.grounded ? JKA.speed * UNIT * JKA.duckScale : JKA.speed * UNIT) : this.paceScale(walking, mz, mx));'],
    ['      let diff = camYaw + this.aimBodyTurn - this.heading;', '      let diff = camYaw + locoTurn + this.aimBodyTurn - this.heading;'],
    ['      this.heading = camYaw;', '      this.heading = camYaw + this.loco.turnNow;'],
    ['    const running = !this.walkKey;', '    let running = !this.walkKey;'],
    ['    const spineFix = THREE.MathUtils.clamp(this.aimFix.yaw, -AIM_SPINE_MAX, AIM_SPINE_MAX);', '    const spineFix = this.loco.on && gunUp ? THREE.MathUtils.clamp(this.aimFix.yaw - this.aimBodyNow, -wideSpine, wideSpine) : THREE.MathUtils.clamp(this.aimFix.yaw, -this.aimSpineMax, this.aimSpineMax);'],
    ['    return this.aimFix.yaw - THREE.MathUtils.clamp(this.aimFix.yaw, -AIM_SPINE_MAX, AIM_SPINE_MAX);', '    return this.aimFix.yaw - THREE.MathUtils.clamp(this.aimFix.yaw, -this.aimSpineMax, this.aimSpineMax);'],
    ["    } else if (!moving) rig.setState('idle');", "    } else if (!moving) rig.setState('idle', 0, null, fo);"],
    ["    else if (this.jkaMode) rig.setState(running ? 'runSaber' : 'walkSaber', speed);", "    else if (this.jkaMode) rig.setState(running ? 'runSaber' : 'walkSaber', speed, null, fo);"],
    ["    else rig.setState(running ? 'run' : 'walk', speed);", "    } else rig.setState(running ? 'run' : 'walk', speed, null, fo);"],
    ["      rig.setState('stance');", "      rig.setState('stance', 0, null, fo);"],
    ["      rig.setState(running && rig.hasState('runBack') ? 'runBack' : rig.hasState('walkBack') ? 'walkBack' : 'runBack', speed);", "      rig.setState(running && rig.hasState('runBack') ? 'runBack' : rig.hasState('walkBack') ? 'walkBack' : 'runBack', speed, null, fo);"],
    ["    const speed = this.noclipSpeed * (input.held('walk') ? 3.5 : 1) * this.speedMultiplier;", "    const speed = this.noclipSpeed * (input.held('speedUp') ? 3.5 : 1) * this.speedMultiplier;"],
  ];
  let held = 0;
  for (const [was, now] of lines) {
    assert.ok(player.includes(`${now}\n`), `today's line stands: ${now.trim()}`);
    // (A line that gained a branch before it now closes that branch's brace: the brace is not the line's own.)
    const plain = (s: string) => s.trim().replace(/^\} /, '');
    assert.ok(plain(reduce(now)) === plain(was), `with the classes off it is the line before the wave: ${was.trim()}`);
    if (old) assert.ok(old.includes(`${was}\n`), `which is in the player at ${PRE_WAVE}: ${was.trim()}`);
    held++;
  }
  ok(held === lines.length, `with the record's off answers written in, each of the ${lines.length} lines the wave changed in the player's movement and its choice of clip is the line that stood before it${old ? ` (read out of git at ${PRE_WAVE})` : ''}`);
  ok(!old || (old.includes("rig.setState(`${carry}${!moving ? 'Idle' : running ? 'Run' : 'Walk'}` as RigState, speed, gunUpper);") && has(player, "const state = `${carry}${!moving ? 'Idle' : running ? 'Run' : 'Walk'}` as RigState;") && has(player, '} else rig.setState(state, speed, gunUpper, fo);')), 'and a blaster\'s state is the one it was, handed the pose it was');
}

console.log(`\n${checks} checks passed`);
