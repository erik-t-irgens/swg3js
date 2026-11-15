// What the player's body remembers for the imported clips (src/anim/bodyAnim.ts): the very class the player's
// update calls, driven here over the events the movement step reports and a rig that records what it is asked. The
// rules it asks (animRules.ts) have their own test; this one holds the memory between frames and the hand-over to the
// rig, which were lines of the player's update that no test could run.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { MX, landingSpeed } from '../../../src/anim/animRules.ts';
import { BodyAnim, type AnimRig } from '../../../src/anim/bodyAnim.ts';
import { ANIM_TUNE_SHIPPED, type AnimTune } from '../../../src/anim/animTune.ts';
import { JkaMovement, UNIT, type MoveCommand } from '../../../src/player/jkaMove.ts';
import { PlayerStats } from '../../../src/player/playerStats.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** A rig that has the clips it is given and records what it is asked to play and to end. */
class Recorder implements AnimRig {
  readonly clips: Set<string>;
  readonly played: { clip: string; fadeIn?: number; from?: number }[] = [];
  readonly yielded: number[] = [];
  overrideName: string | null = null;
  /** Every clip is two seconds long here. */
  static readonly LENGTH = 2;

  constructor(clips: Iterable<string> = Object.values(MX)) {
    this.clips = new Set(clips);
  }

  has(clip: string): boolean {
    return this.clips.has(clip);
  }

  play(clip: string, options: { fadeIn?: number; from?: number } = {}): number | null {
    if (!this.clips.has(clip)) return null;
    this.played.push({ clip, ...options });
    this.overrideName = clip;
    return Recorder.LENGTH - (options.from ?? 0);
  }

  yieldOverride(fade?: number): void {
    this.yielded.push(fade ?? -1);
    this.overrideName = null;
  }

  get last(): { clip: string; fadeIn?: number; from?: number } | undefined {
    return this.played[this.played.length - 1];
  }
}

const tune = (): AnimTune => JSON.parse(JSON.stringify(ANIM_TUNE_SHIPPED));
const T = tune();
/** The movement step's measure of a landing at a speed, m/s: the speed in its own units, squared, over ten thousand. */
const delta = (speed: number) => (speed / UNIT) ** 2 / 10000;
/** A body in the air over a rig with every clip: the movement has been stepped off the ground, as a jump or a ledge has it. */
const airborne = (rig = new Recorder(), t = T) => {
  const body = new BodyAnim(t, UNIT);
  body.stepped(false);
  return { body, rig };
};
const DT = 1 / 60;

// ---- a rig without the clips: everything is "as before" ------------------------------------------------------------------
{
  const rig = new Recorder([]);
  const body = new BodyAnim(T, UNIT);
  body.stepped(false);
  ok(body.jump(rig, false) === false && body.air(rig, false) === null && body.land(rig, delta(9), 0, false, false, false) === 'before' && rig.played.length === 0, 'on a rig without the imported clips the jump, the air and the landing are all the caller\'s own, and nothing is played');
  body.fling();
  ok(body.flung && body.air(rig, false) === null, 'thrown, the air is the caller\'s old flail');
  body.hitGround(rig);
  ok(!body.flung && !body.impactLocked && rig.played.length === 0 && body.land(rig, delta(9), 12, true, false, false) === 'before', 'and the fall ends with nothing played and no key held: the body lies down at once and the game\'s own landing rule decides, as before');
  ok(body.jump(null, false) === false && body.air(null, false) === null && body.land(null, delta(9), 0, false, false, false) === 'before', 'with no rig at all, the same');
}

// ---- the jump ----------------------------------------------------------------------------------------------------------------
{
  const { body, rig } = airborne();
  ok(body.jump(rig, false) && rig.last!.clip === MX.jump && rig.last!.from === T.trim.jumping_up && rig.last!.fadeIn === T.jump.fade && rig.played.length === 1, 'a plain jump plays the imported start on the rig, from its trim and over the jump\'s own fade, and says so');
  ok(body.jump(rig, true) === false && rig.played.length === 1, 'with Jedi Academy\'s animations in charge it plays nothing and leaves the caller its own');
}

// ---- the air -----------------------------------------------------------------------------------------------------------------
{
  const { body, rig } = airborne();
  ok(body.air(rig, false) === MX.fall && !body.forceAir, 'in the air after a plain jump the loop is the falling one');
  body.forceMove();
  ok(body.forceAir && body.air(rig, false) === MX.float, 'after a flip, a Force jump, a wall move or a launch it is the float, until the feet touch down');
  ok(body.air(rig, true) === null, 'and Jedi Academy\'s own with its animations in charge');
  body.fling();
  ok(body.flung && body.air(rig, false) === MX.thrown && body.air(rig, true) === MX.thrown, 'thrown from a wreck it is the long fall, whatever else is true');
  body.onGround();
  ok(!body.forceAir, 'on the ground under a movement that reports no landings the air\'s memory is put down');
}

// ---- the landing --------------------------------------------------------------------------------------------------------------
{
  const land = (speed: number, harm = 0, forceLanded = false, rolled = false, jka = false, before: (b: BodyAnim) => void = () => {}) => {
    const { body, rig } = airborne();
    before(body);
    return { how: body.land(rig, delta(speed), harm, forceLanded, rolled, jka), rig, body };
  };
  const hop = land(5.7);
  ok(hop.how === 'imported' && hop.rig.last!.clip === MX.landSoft && hop.rig.last!.from === T.trim.jumping_down && hop.rig.last!.fadeIn === T.land.fade && hop.body.landing === MX.landSoft, 'a hop\'s landing plays the short landing on the rig, from its trim over the landing\'s fade');
  const drop = land(10);
  ok(drop.how === 'imported' && drop.rig.last!.clip === MX.land && drop.rig.last!.from === T.trim.falling_to_landing, 'a faster one that does no harm plays the longer landing from the brief\'s trim');
  const hard = land(14, 20, true);
  ok(hard.how === 'imported' && hard.rig.last!.clip === MX.landHard && hard.rig.last!.from === T.trim.hard_landing, 'one that harms plays the hard landing: the fall\'s damage reaches the rule');
  const gentle = land(3);
  ok(gentle.how === 'none' && gentle.rig.played.length === 0 && gentle.body.landing === null, 'one too gentle plays nothing at all, and the caller plays nothing either');
  const rolled = land(12, 6, true, true);
  ok(rolled.how === 'before' && rolled.rig.played.length === 0, 'a landing that rolled out is the game\'s own, harm or none: no imported landing is laid over the roll');
  const swinging = land(9, 0, false, false, true);
  ok(swinging.how === 'before' && swinging.rig.played.length === 0, 'as is one with Jedi Academy\'s animations in charge');
  // A Force user's air: read before it is put down, and put down by the landing.
  const forced = land(10, 0, false, false, false, (b) => b.forceMove());
  ok(forced.how === 'before' && forced.rig.played.length === 0 && !forced.body.forceAir, 'after a flip or a Force jump a harmless landing is the game\'s own: the air\'s memory is read by the rule, and only then put down');
  forced.body.stepped(false);
  ok(forced.body.air(forced.rig, false) === MX.fall && forced.body.land(forced.rig, delta(10), 0, false, false, false) === 'imported', 'so the next time in the air is a plain fall again, and lands in an imported landing');
  ok(land(10, 0, true).how === 'before', 'the step\'s own word for a Force jump\'s landing is believed where no harm was done');
  const forcedHarm = land(16, 9, true, false, false, (b) => b.forceMove());
  ok(forcedHarm.how === 'imported' && forcedHarm.rig.last!.clip === MX.landHard, 'and a Force user\'s landing that harms is the hard one, as everyone\'s');
  const soft = land(2, 0, false, false, false, (b) => b.forceMove());
  ok(soft.how === 'before' && !soft.body.forceAir, 'a gentle landing puts the air\'s memory down as any landing does');
  // The lines are the table's, read at each landing.
  const moved = tune();
  const { body, rig } = airborne(new Recorder(), moved);
  moved.land.soft = 5;
  ok(body.land(rig, delta(5.7), 0, false, false, false) === 'imported' && rig.last!.clip === MX.land, 'the lines are read from the table at each landing: moved, the same hop lands in the longer one');
}

// ---- how fast a hop comes down, through the game's own movement ---------------------------------------------------------------
// (The facts the tune's comment and the Landings dials' note state, and the reason `land.soft` starts where it does.
// A Force user's jump is lifted for as long as the key is down, so how fast it comes down hangs on how long the tap
// was, until it becomes a Force jump, whose landing is Jedi Academy's own. Where the line itself stands is the owner's:
// it is said here, never held.)
{
  const stats = new PlayerStats();
  const cmd = (jump: boolean, pressed: boolean): MoveCommand => ({ forward: new THREE.Vector3(0, 0, -1), right: new THREE.Vector3(1, 0, 0), fmove: 0, smove: 0, walk: false, crouch: false, roll: false, jump, jumpPressed: pressed, attack: false, speedScale: 1, fallSafeExtra: stats.fallSafeExtra / UNIT, rollDivisor: stats.rollDivisor, rollFree: stats.rollFree, airAccel: stats.airAccel });
  /** A jump on level ground with the key down `held` seconds, stepped at `dt`: its landing as the step reports it, and whether it became a Force jump. */
  const tap = (level: number, held: number, dt: number) => {
    const jka = new JkaMovement();
    jka.forceLevel = level;
    jka.reset();
    const pos = new THREE.Vector3(), vel = new THREE.Vector3();
    const force = { value: 100, spend: () => {} };
    let grounded = true, forceJump = false, t = 0;
    for (let i = 0; i < 6000; i++) {
      const ev = jka.step(dt, vel, pos, grounded, cmd(t < held - 1e-9, i === 0), force);
      if (ev.jumped) grounded = false;
      if (ev.forceJumpStarted) forceJump = true;
      if (ev.landed !== null && i > 0) return { delta: ev.landed, harm: ev.damage, forceLanded: ev.forceLanded, forceJump };
      pos.addScaledVector(vel, dt);
      if (!grounded && pos.y <= 0 && vel.y < 0) {
        pos.y = 0;
        grounded = true;
      }
      t += dt;
    }
    throw new Error('the jump never landed');
  };
  const player = readFileSync(new URL('../../../src/player/player.ts', import.meta.url), 'utf8');
  ok(player.includes('this.jka.forceLevel = jedi ? 3 : 0;'), 'a Force user jumps at Force level 3 and everyone else at none');
  const jumps: { level: number; ms: number; fps: number; speed: number; j: ReturnType<typeof tap> }[] = [];
  for (const level of [3, 0]) for (const fps of [20, 30, 60, 144, 240]) for (let ms = 5; ms <= 300; ms += 5) {
    const j = tap(level, ms / 1000, 1 / fps);
    jumps.push({ level, ms, fps, speed: landingSpeed(j.delta, UNIT), j });
  }
  const hops = jumps.filter((x) => !x.j.forceJump);
  const forceHops = hops.filter((x) => x.level === 3).map((x) => x.speed), plainHops = hops.filter((x) => x.level === 0).map((x) => x.speed);
  const fastest = Math.max(...forceHops), least = Math.min(...forceHops);
  ok(Math.min(...plainHops) > 5 && Math.max(...plainHops) < 5.75 && jumps.every((x) => x.level !== 0 || !x.j.forceJump), `a body with no Force hops down at ${Math.min(...plainHops).toFixed(2)} to ${Math.max(...plainHops).toFixed(2)} m/s however long the key is down, at 20 to 240 frames a second: the note's 5.7`);
  ok(least > 7.2 && least < 7.9 && fastest > 9.2 && fastest < 9.7, `a Force user's jump that is no Force jump comes down at ${least.toFixed(2)} to ${fastest.toFixed(2)} m/s by how long the tap was: the note's 7.4 to 9.6`);
  const longest = Math.max(...hops.filter((x) => x.level === 3).map((x) => x.ms)), firstForce = Math.min(...jumps.filter((x) => x.j.forceJump).map((x) => x.ms));
  ok(firstForce > 100 && firstForce <= 145 && longest <= 200, `and it becomes a Force jump with the key down ${firstForce} ms or more, by the frame rate (the longest tap that stayed a hop was ${longest} ms): the note's "about 0.12 s"`);
  // Where a fall first hurts: dropped from rising heights, at sixty frames a second.
  const dropFrom = (level: number, height: number) => {
    const jka = new JkaMovement();
    jka.forceLevel = level;
    jka.reset();
    const pos = new THREE.Vector3(0, height, 0), vel = new THREE.Vector3();
    const force = { value: 100, spend: () => {} };
    let grounded = false;
    for (let i = 0; i < 6000; i++) {
      const ev = jka.step(DT, vel, pos, grounded, cmd(false, false), force);
      if (ev.landed !== null) return { speed: landingSpeed(ev.landed, UNIT), harm: ev.damage };
      pos.addScaledVector(vel, DT);
      if (!grounded && pos.y <= 0) {
        pos.y = 0;
        grounded = true;
      }
    }
    throw new Error('the drop never landed');
  };
  let hurtAt = 0, hurtSpeed = 0, forceHurtAt = 0;
  for (let h = 1; h <= 14 && !(hurtAt && forceHurtAt); h += 0.1) {
    if (!hurtAt && dropFrom(0, h).harm > 0) [hurtAt, hurtSpeed] = [h, dropFrom(0, h).speed];
    if (!forceHurtAt && dropFrom(3, h).harm > 0) forceHurtAt = h;
  }
  ok(hurtSpeed > 8.1 && hurtSpeed < 8.7 && forceHurtAt > hurtAt + 2, `a body with no Force is first hurt by a fall of ${hurtAt.toFixed(1)} m, coming down at ${hurtSpeed.toFixed(2)} m/s (the note's "about 8.5"), and a Force user only from ${forceHurtAt.toFixed(1)} m: the harmless drops beyond a hop are a Force user's`);
  // The hand-over, with the line stood just over the fastest hop: every hop the short landing, every Force jump the game's own.
  const over: AnimTune = tune();
  over.land.soft = fastest + 0.01;
  let wrong = '';
  for (const x of jumps) {
    const { body, rig } = airborne(new Recorder(), over);
    if (x.j.forceJump) body.forceMove();
    const how = body.land(rig, x.j.delta, x.j.harm, x.j.forceLanded, false, false);
    if (x.j.forceJump ? how !== 'before' : how !== 'imported' || rig.last!.clip !== MX.landSoft) wrong ||= `Force level ${x.level}, key down ${x.ms} ms at ${x.fps} frames (${x.speed.toFixed(2)} m/s${x.j.forceJump ? ', a Force jump' : ''}): ${how} ${rig.last?.clip ?? ''}`;
  }
  ok(wrong === '' && hops.length > 300 && jumps.length - hops.length > 100, `with the line just over that, every one of the ${hops.length} hops lands in the short landing and every one of the ${jumps.length - hops.length} Force jumps in the game's own${wrong ? `: ${wrong}` : ''}`);
  const under = hops.filter((x) => x.speed >= T.land.soft);
  console.log(`note the line as shipped is ${T.land.soft} m/s: ${under.length === 0 ? `${(T.land.soft - fastest).toFixed(2)} over the fastest hop, so every hop lands in the short landing` : `${under.length} of the ${hops.length} hops come down faster and land in the longer one (a Force user's tap of ${Math.min(...under.map((x) => x.ms))} ms or more)`}`);
}
// ---- a landing gives way to the keys --------------------------------------------------------------------------------------------
{
  const { body, rig } = airborne();
  body.land(rig, delta(10), 0, false, false, false);
  let frames = 0;
  while (rig.yielded.length === 0 && frames < 600) {
    body.cut(rig, DT, false);
    frames++;
  }
  ok(rig.yielded.length === 0 && body.landing === MX.land, 'a landing is never cut under a body standing still, however long it plays');
  // The keys held from the start: cut once the dial's part of it has played, over the dial's fade.
  const run = airborne();
  run.body.land(run.rig, delta(10), 0, false, false, false);
  let held = 0;
  while (run.rig.yielded.length === 0 && held < 600) {
    run.body.cut(run.rig, DT, true);
    held++;
  }
  ok(Math.abs(held * DT - T.land.moveCut) < DT * 1.01 && run.rig.yielded.join() === String(T.land.moveFade) && run.body.landing === null, `with a move key held it is ended once ${T.land.moveCut} s of it have played (${(held * DT).toFixed(3)} s), through the rig's own way out, over the dial's fade`);
  for (let i = 0; i < 60; i++) run.body.cut(run.rig, DT, true);
  ok(run.rig.yielded.length === 1, 'once');
  // A second landing counts from its own start.
  run.body.stepped(false);
  run.body.land(run.rig, delta(10), 0, false, false, false);
  run.body.cut(run.rig, DT, true);
  ok(run.rig.yielded.length === 1 && run.body.landing === MX.land, 'the next landing is not cut at once: its clock starts with it');
  let again = 1;
  while (run.rig.yielded.length === 1 && again < 600) {
    run.body.cut(run.rig, DT, true);
    again++;
  }
  ok(Math.abs(again * DT - T.land.moveCut) < DT * 1.01, 'and is cut after as much of it');
  // Something else takes the body: the landing is forgotten, and nothing of the other clip is ended.
  const taken = airborne();
  taken.body.land(taken.rig, delta(10), 0, false, false, false);
  taken.rig.overrideName = 'BOTH_ROLL_F';
  for (let i = 0; i < 60; i++) taken.body.cut(taken.rig, DT, true);
  ok(taken.rig.yielded.length === 0 && taken.body.landing === null, 'a landing that something else has taken the body from is forgotten: the keys end nothing of the other clip');
  const gone = airborne();
  gone.body.land(gone.rig, delta(10), 0, false, false, false);
  gone.body.cut(null, DT, true);
  ok(gone.body.landing === null, 'as it is when the rig is taken away');
  // The dial at its top: never cut.
  const never = tune();
  never.land.moveCut = 3;
  const long = airborne(new Recorder(), never);
  long.body.land(long.rig, delta(10), 0, false, false, false);
  for (let i = 0; i < 170; i++) long.body.cut(long.rig, DT, true);
  ok(long.rig.yielded.length === 0, 'and with the dial at its top no landing is cut inside its own length');
}

// ---- thrown from a wreck ---------------------------------------------------------------------------------------------------------
{
  const { body, rig } = airborne();
  body.fling();
  ok(body.flung && !body.impactLocked, 'thrown, the body is in the long fall and no key is held yet');
  body.hitGround(rig);
  const left = Recorder.LENGTH - T.trim.falling_flat_impact;
  ok(!body.flung && rig.last!.clip === MX.impact && rig.last!.from === T.trim.falling_flat_impact && rig.last!.fadeIn === T.impact.fade && body.impactLocked, 'as it meets the ground the impact plays from the brief\'s trim, and the keys are held');
  // The movement step reports that landing a frame on: it is the impact's.
  body.tick(DT);
  ok(body.land(rig, delta(11), 14, true, false, false) === 'impact' && rig.played.length === 1, 'the landing the movement reports a frame later is the impact\'s own: no landing is laid over it, imported or the game\'s');
  let t = DT;
  while (body.impactLocked && t < 10) {
    body.tick(DT);
    t += DT;
  }
  ok(Math.abs(t - left) < DT * 1.01, `the keys are held for what is left of the impact to play (${t.toFixed(2)} s of ${left.toFixed(2)})`);
  body.stepped(false);
  ok(body.land(rig, delta(10), 0, false, false, false) === 'imported', 'and the next fall lands as any other');

  // The dial at nought: no key is held, and still nothing is laid over the impact.
  const free = tune();
  free.impact.lock = 0;
  const loose = airborne(new Recorder(), free);
  loose.body.fling();
  loose.body.hitGround(loose.rig);
  ok(!loose.body.impactLocked && loose.rig.last!.clip === MX.impact, 'with the hold dialled to nothing the impact still plays and no key is held');
  ok(loose.body.land(loose.rig, delta(11), 14, true, false, false) === 'impact' && loose.rig.played.length === 1 && loose.rig.last!.clip === MX.impact, 'and the landing a frame on is still the impact\'s: it is told by the impact having played, not by the keys being held');

  // The body stood somewhere new while thrown: the fall goes with the place.
  const blown = airborne();
  blown.body.fling();
  blown.body.drop();
  ok(!blown.body.flung && !blown.body.impactLocked && blown.body.air(blown.rig, false) === MX.fall, 'a body reset, stood or mounted while thrown is thrown no longer (the rider the blast killed comes round at the spawn standing, not into the impact)');
  const held = airborne();
  held.body.fling();
  held.body.hitGround(held.rig);
  held.body.drop();
  ok(!held.body.impactLocked && held.body.landing === null, 'and one stood somewhere new in the middle of the impact has its keys back at once');
  ok(held.body.land(held.rig, delta(9), 0, false, false, false) === 'before' && held.rig.played.length === 1, 'whatever the movement next reports there is no fall onto that ground: the game\'s own rule has it');
  held.body.stepped(false);
  ok(held.body.land(held.rig, delta(9), 0, false, false, false) === 'imported', 'until the body has been in the air there');
  // Thrown again while an impact is owed a landing: the new fall's landing is its own impact's.
  const twice = airborne();
  twice.body.fling();
  twice.body.hitGround(twice.rig);
  twice.body.fling();
  twice.body.stepped(false);
  twice.body.hitGround(twice.rig);
  ok(twice.rig.played.filter((p) => p.clip === MX.impact).length === 2 && twice.body.land(twice.rig, delta(9), 0, false, false, false) === 'impact' && twice.body.land(twice.rig, delta(9), 0, false, false, false) !== 'impact', 'each impact answers for one landing, its own');
}

// ---- the water ----------------------------------------------------------------------------------------------------------------------
{
  const { body, rig } = airborne();
  body.fling();
  body.forceMove();
  body.swim();
  ok(!body.flung && !body.forceAir, 'water ends a thrown fall and a Force user\'s air');
  // The swim never steps the movement, which still remembers the plunge: the first step out, on the bed, reports it.
  body.stepped(true);
  ok(body.land(rig, delta(9), 0, false, false, false) === 'before' && rig.played.length === 0, 'the landing the movement reports on the first step out of the water is the plunge\'s: no imported landing plays on the shore, and the game\'s own rule has it, as before');
  body.stepped(true);
  body.stepped(false);
  ok(body.land(rig, delta(9), 0, false, false, false) === 'imported', 'a jump from the shore lands as any other');
  // Out of the water into the air (hauled out, a ledge under the surface): that is a fall, and its landing a landing.
  const out = airborne();
  out.body.swim();
  out.body.stepped(false);
  ok(out.body.land(out.rig, delta(9), 0, false, false, false) === 'imported', 'and a body that leaves the water into the air has fallen, and lands');
  const thrownIn = airborne();
  thrownIn.body.fling();
  thrownIn.body.hitGround(thrownIn.rig);
  thrownIn.body.swim();
  thrownIn.body.stepped(true);
  ok(thrownIn.body.land(thrownIn.rig, delta(9), 0, false, false, false) === 'before', 'an impact that slid into the water is owed nothing on the far shore');
}

// ---- the hold runs down with the body's own update -----------------------------------------------------------------------------------
{
  const half = tune();
  half.impact.lock = 0.5;
  const { body, rig } = airborne(new Recorder(), half);
  body.fling();
  body.hitGround(rig);
  let t = 0;
  while (body.impactLocked && t < 10) {
    body.tick(0.05);
    t += 0.05;
  }
  ok(Math.abs(t - (Recorder.LENGTH - half.trim.falling_flat_impact) * 0.5) < 0.051, 'the hold is the dial\'s share of what the impact has left to play, and runs down by the steps the body is given');
  body.tick(5);
  ok(!body.impactLocked, 'and never below nought');
}

console.log(`\n${checks} checks passed`);
