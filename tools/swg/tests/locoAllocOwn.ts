// The speed classes' frame makes nothing (Animations I, wave 2a): the body's record driven as the player's update
// drives it -- the keys, the frame's record written, the plan, the turn eased, the legs asked with the ground speed,
// the fade and the state asked for -- over a steady jog, over a script of keys that changes way and class every few
// frames (walks, runs, sprints, taps, strafes, diagonals, a blaster up, a jump, a seat taken mid-sprint), and a dozen
// other players' legs worked out each frame from velocities that turn and speeds that change; and the wave 2a polish's
// own (walking sideways under each of its choices, a gun in hand out of combat at every pace, each pace's share of the
// locked rate; the owner's air rule over a stand-in rig and the treading sink). Each over a window of
// frames with no collection, the cleanest of three kept. Not a test itself: `locoAlloc.test.ts` runs it in twelve
// processes at once (`node --expose-gc --allow-natives-syntax`), since which calls the compiler builds in, and so
// whether a number crossing one is boxed, turns on the load it compiles under.
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import { BodyLoco, FadeOpts, LegOpts, fightKeysDown, newLocoIn, type LocoRig } from '../../../src/anim/bodyLoco.ts';
import { GAITS, moreClips, tableClips } from '../../../src/anim/locoTable.ts';
import { PeerIn, PeerLoco } from '../../../src/anim/peerLoco.ts';
import { LOCO_TUNE_SHIPPED, type LocoTune } from '../../../src/anim/locoTune.ts';
import { BodyAnim, type AnimRig } from '../../../src/anim/bodyAnim.ts';
import { ANIM_TUNE_SHIPPED, type AnimTune } from '../../../src/anim/animTune.ts';
import { SwimSink } from '../../../src/anim/swimSink.ts';

const tune = JSON.parse(JSON.stringify(LOCO_TUNE_SHIPPED)) as LocoTune;
// Fractions on every dial a frame reads, as the owner's sliders leave them: a whole number is no test of a number made.
tune.stamina.walk = 9.5;
tune.stamina.jog = 3.25;
tune.stamina.back = 7.75;
tune.stamina.sideWalk = 5.5;
tune.stamina.side = -0.25;
tune.stamina.air = 0.125;
tune.stamina.sprint = -11.5;
tune.turn.rate = 13.5;
tune.peer.hold = 11.5;
// The polish's dials as fractions too: each pace's share of the feet-locked rate.
tune.rate.byClass.walk = 0.9375;
tune.rate.byClass.jog = 1.0625;
tune.rate.byClass.run = 0.875;
tune.rate.byClass.sprint = 0.8125;

/** A rig as the classes see one: every clip of the table, each with a speed of its own, read the frame's way. */
class StandInRig implements LocoRig {
  private readonly speeds = new Map<string, number>();
  speedOut = 0.5;
  scale = 1.0625;
  constructor() {
    tableClips().forEach((id, i) => this.speeds.set(`mx_${id}`, 1.37 + i * 0.211));
    // Wave 2b's rows' clips too: the gaits', the injured walk's, crouched and prone (the game's own among them).
    moreClips().forEach((id, i) => this.speeds.set(`mx_${id}`, 0.61 + i * 0.137));
    for (const name of ['walk', 'loop_crouched:speed1', 'BOTH_CROUCH1WALKBACK', 'loop_prone:speed1']) this.speeds.set(name, 1.4375);
  }
  has(clip: string): boolean {
    return this.speeds.has(clip);
  }
  readSpeed(clip: string): boolean {
    const v = this.speeds.get(clip);
    if (v === undefined) return false;
    this.speedOut = v * this.scale;
    return true;
  }
}

/** The keys of a frame, as bits: forward, back, left, right, Shift, Shift pressed this frame, the walk key; and the attack pressed (a fight's key that ends a sprint). */
const W = 1, S = 2, A = 4, D = 8, SHIFT = 16, PRESS = 32, WALK = 64, GUN = 128, AIR = 256, SEAT = 512, BLOCK = 1024, FIGHT = 2048, HOLSTERED = 4096, CROUCHED = 8192, PRONE = 16384, HURT = 32768;
/** The sideways walk's three choices, cycled through as the script runs (a dial moved in play). */
const SIDE_CHOICES = ['diagonal', 'forward', 'strafe'] as const;

/** The input as the player's update reads the fight's keys off it (`fightKeysDown`): the attack from the frame's bits, the block from the block's. */
class StandInInput {
  keys = 0;
  held(action: string): boolean {
    return action === 'block' ? (this.keys & BLOCK) !== 0 : false;
  }
  pressedAction(action: string): boolean {
    return action === 'attack' ? (this.keys & FIGHT) !== 0 : false;
  }
}

/** The body as the player's update drives the record: kept fields, and one method a frame. */
class Body {
  readonly loco = new BodyLoco(tune);
  readonly f = newLocoIn();
  readonly legOpts = new LegOpts();
  readonly fadeOpts = new FadeOpts();
  readonly rig = new StandInRig();
  heading = 0.5;
  camYaw = 0.5;
  walking = false;
  readonly input = new StandInInput();
  legsFrames = 0;
  sprintFrames = 0;
  seatFrames = 0;
  dropped = 0;
  muted = 0;
  ended = 0;
  /** Which kind of gun is in hand this frame (counted round), and how many frames each carry was asked. */
  gunTurn = 0;
  carries = 0;

  update(dt: number, keys: number): void {
    const loco = this.loco;
    // The game's key block first: what the record says to mute (under 'ends', nothing).
    if (loco.mutes() !== null) this.muted++;
    this.input.keys = keys;
    if ((keys & SEAT) !== 0) {
      // Riding: the record is put down, as every branch of the update that returns before the plan does.
      loco.idle(dt, tune.stamina.pool);
      this.seatFrames++;
      return;
    }
    this.walking = loco.keys(dt, (keys & SHIFT) !== 0, (keys & PRESS) !== 0, (keys & WALK) !== 0, this.rig);
    const mz = ((keys & W) !== 0 ? 1 : 0) - ((keys & S) !== 0 ? 1 : 0);
    const mx = ((keys & D) !== 0 ? 1 : 0) - ((keys & A) !== 0 ? 1 : 0);
    const moving = mz !== 0 || mx !== 0;
    const jka = (keys & BLOCK) !== 0;
    const lo = this.f;
    lo.dt = dt;
    lo.mz = mz;
    lo.mx = mx;
    lo.crouched = (keys & CROUCHED) !== 0;
    lo.prone = (keys & PRONE) !== 0;
    lo.standing = !lo.crouched && !lo.prone;
    lo.hpShare = (keys & HURT) !== 0 ? 0.125 : 0.875;
    lo.scale = 1.0625;
    lo.grounded = (keys & AIR) === 0;
    lo.swimming = false;
    lo.fighting = jka;
    lo.aiming = false;
    lo.fightKeys = fightKeysDown(this.input);
    lo.gunUp = (keys & GUN) !== 0;
    // A gun in hand and none up: each kind in turn, so every carry the tune names is asked.
    lo.gunClass = (keys & (GUN | HOLSTERED)) !== 0 ? this.gunTurn++ & 3 : -1;
    lo.sprint = tune.speed.forward.sprint;
    lo.pool = tune.stamina.pool;
    lo.boost = 1;
    const wasSprinting = loco.sprinting;
    const classes = loco.plan(lo);
    if (wasSprinting && lo.fightKeys && !loco.sprinting) this.ended++;
    let speed = 6.35;
    if (classes) speed = loco.speed * 1.0125;
    const faces = moving && loco.faces(jka);
    const turn = faces ? loco.turn : 0;
    loco.face(faces);
    this.camYaw += dt * 0.31;
    let diff = this.camYaw + turn - this.heading;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.heading += diff * loco.turnStep;
    lo.ground = speed * 0.9375;
    const legs = loco.legs(moving && lo.grounded ? this.rig : null, lo, jka);
    loco.fadeFor(legs !== null, jka, moving);
    this.legOpts.rate = loco.rate;
    this.legOpts.fade = loco.fadeNow;
    this.fadeOpts.fade = loco.fadeNow;
    const drop = loco.prefers(legs ? legs.state : null);
    if (drop) this.dropped++;
    if (legs) this.legsFrames++;
    if (loco.sprinting) this.sprintFrames++;
    if (loco.carry >= 0) this.carries++;
  }
}

/** A script of keys: each entry held for a number of frames. A walk round every way and class, the taps that make a sprint, a jump out of it, a seat taken in the middle of one, a block, a blaster up, and an attack and a block each ending a sprint. */
const SCRIPT: [number, number][] = [
  [W, 40], [W | SHIFT | PRESS, 1], [W | SHIFT, 30], [W, 8], [W | SHIFT | PRESS, 1], [W | SHIFT, 50], [W | SHIFT | AIR, 30], [W | SHIFT, 20],
  [W | SHIFT | SEAT, 45], [W | SHIFT | PRESS, 1], [W | SHIFT, 25], [W | D | SHIFT, 30], [D | SHIFT, 30], [S | D | SHIFT, 25], [S, 30], [S | A, 30], [A, 30],
  [A | WALK, 30], [W | A | WALK, 30], [W | WALK, 30], [W | D | WALK | GUN, 30], [W | D | GUN, 30], [W | BLOCK, 30], [W, 20], [0, 40], [W | SHIFT | PRESS, 1], [W | SHIFT, 12],
  [W, 3], [W | SHIFT | PRESS, 1], [W | SHIFT, 700], [W | SHIFT, 60], [0, 200],
  // A sprint ended by an attack on its own frame, Shift still held (the run), and a fresh double tap; then by a block.
  [W | SHIFT | PRESS, 1], [W | SHIFT, 20], [W, 8], [W | SHIFT | PRESS, 1], [W | SHIFT, 30], [W | SHIFT | FIGHT, 1], [W | SHIFT, 40],
  [W, 8], [W | SHIFT | PRESS, 1], [W | SHIFT, 30], [W | SHIFT | BLOCK, 20], [W | SHIFT, 30], [0, 30],
];
/**
 * The polish's own script (a body of its own, measured on its own: the wave 2a script is kept as it was, since which
 * frames of it fall in a measured window is part of what it measures): walking sideways under each of its choices in
 * turn, and a gun in hand out of combat at every pace and way.
 */
const POLISH: [number, number][] = [
  [A | WALK, 40], [D | WALK, 40], [W | HOLSTERED, 40], [W | SHIFT | HOLSTERED, 40], [W, 8], [W | SHIFT | PRESS | HOLSTERED, 1], [W | SHIFT | HOLSTERED, 60],
  [A | HOLSTERED, 30], [S | D | HOLSTERED | WALK, 30], [W | A | WALK | HOLSTERED, 30], [S | HOLSTERED, 30], [0, 20],
];
let scriptFrames = 0;
for (const [, n] of SCRIPT) scriptFrames += n;
const KEYS = new Int32Array(scriptFrames);
{
  let at = 0;
  for (const [k, n] of SCRIPT) for (let i = 0; i < n; i++) KEYS[at++] = k;
}

/** Other players as their records stand between messages: a velocity that turns, a heading, a speed that changes. */
class Peer {
  readonly loco = new PeerLoco();
  readonly vel = { x: 0.5, y: 0.5, z: 0.5 };
  heading = 0.5;
  speed = 0.5;
  state = 'run';
}
const PEER_STATES = ['run', 'walk', 'gunRun', 'gunAimWalk', 'run', 'gunReadyRun', 'runBack', 'idle', 'run', 'walk', 'run', 'gunWalk'];
const peers: Peer[] = PEER_STATES.map((state, i) => {
  const p = new Peer();
  p.state = state;
  p.heading = i * 0.61 - 2.9;
  return p;
});
const peerIn = new PeerIn();
const peerRig = new StandInRig();
let peerPicks = 0;

const steady = new Body();
const busy = new Body();
const st = new Float64Array(5);
const DT = 1 / 60;

function steadyFrame(): void {
  steady.update(DT, W);
}
function busyFrame(): void {
  st[0] += 1;
  busy.update(DT, KEYS[(st[0] | 0) % scriptFrames]);
}

let polishFrames = 0;
for (const [, n] of POLISH) polishFrames += n;
const POLISH_KEYS = new Int32Array(polishFrames);
{
  let at = 0;
  for (const [k, n] of POLISH) for (let i = 0; i < n; i++) POLISH_KEYS[at++] = k;
}
const polish = new Body();
function polishFrame(): void {
  st[3] += 1;
  const at = st[3] | 0;
  // The sideways walk's dial moved every so often, as the owner's slider moves it in play.
  if ((at & 511) === 0) tune.sideWalkClip = SIDE_CHOICES[(at >> 9) % 3];
  polish.update(DT, POLISH_KEYS[at % polishFrames]);
}

/**
 * Wave 2b's own (a body of its own, measured on its own, as the polish's is): crouched and prone at each class and way,
 * the prone crawl backing up under each of `proneBack`'s choices (the dial moved every 512 frames), the walk in each gait
 * in turn (the gait moved every 256 frames), and walking hurt; and other players crouched, prone and walking in a gait
 * and hurt.
 */
const POSTURE: [number, number][] = [
  [W | CROUCHED | WALK, 40], [W | CROUCHED, 40], [W | CROUCHED | SHIFT, 40], [W | A | CROUCHED, 30], [D | CROUCHED | SHIFT, 30], [S | CROUCHED, 30], [S | D | CROUCHED | WALK, 30], [CROUCHED, 20],
  [W | PRONE | WALK, 40], [W | PRONE, 40], [W | PRONE | SHIFT, 40], [S | PRONE, 40], [S | A | PRONE | SHIFT, 30], [A | PRONE, 30], [PRONE, 20], [W | PRONE | HOLSTERED, 30],
  [W | WALK, 40], [W | A | WALK, 30], [D | WALK, 30], [W | WALK | HURT, 40], [W | A | WALK | HURT, 30], [A | WALK | HURT, 30], [S | WALK | HURT, 30], [W | HURT, 30], [0, 20],
];
let postureFrames = 0;
for (const [, n] of POSTURE) postureFrames += n;
const POSTURE_KEYS = new Int32Array(postureFrames);
{
  let at = 0;
  for (const [k, n] of POSTURE) for (let i = 0; i < n; i++) POSTURE_KEYS[at++] = k;
}
const postureBody = new Body();
const BACKS = ['today', 'reverse'] as const;
const POSTURE_PEER_STATES = ['crouchWalk', 'crouchWalkBack', 'proneMove', 'walk', 'walk', 'run'];
const posturePeers: Peer[] = POSTURE_PEER_STATES.map((state, i) => {
  const p = new Peer();
  p.state = state;
  p.heading = i * 0.73 - 1.9;
  return p;
});
let posturePeerPicks = 0;
const postureIn = new PeerIn();
function postureFrame(): void {
  st[4] += 1;
  const at = st[4] | 0;
  if ((at & 255) === 0) postureBody.loco.setGait(GAITS[(at >> 8) % GAITS.length]);
  if ((at & 511) === 0) tune.proneBack = BACKS[(at >> 9) & 1];
  postureBody.update(DT, POSTURE_KEYS[at % postureFrames]);
  for (let i = 0; i < posturePeers.length; i++) {
    const p = posturePeers[i];
    const turn = p.heading + ((at + i * 41) % 700) * 0.0091;
    const speed = 0.3 + (((at >> 5) + i * 5) % 11) * 0.27;
    p.vel.x = Math.sin(turn) * speed;
    p.vel.z = Math.cos(turn) * speed;
    postureIn.vx = p.vel.x;
    postureIn.vz = p.vel.z;
    postureIn.heading = p.heading;
    postureIn.speed = speed;
    postureIn.dt = DT;
    postureIn.gait = (at >> 7) % GAITS.length;
    postureIn.hpShare = ((at >> 8) & 1) === 0 ? 0.125 : 0.875;
    postureIn.scale = 1.0625;
    if (p.loco.resolve(tune, peerRig, p.state, peerIn)) posturePeerPicks++;
  }
}

/** The air and the water as the player's update drives them: the owner's air rule over a stand-in rig, and the treading sink. */
const animTune = JSON.parse(JSON.stringify(ANIM_TUNE_SHIPPED)) as AnimTune;
animTune.fall.floatUntil = 9.75;
animTune.swim.sink = 0.3125;
animTune.swim.ease = 0.28125;
class AirRig implements AnimRig {
  overrideName: string | null = null;
  played = 0;
  has(_clip: string): boolean {
    return true;
  }
  play(_clip: string): number | null {
    this.played++;
    return 1;
  }
  yieldOverride(): void {}
}
const airRig = new AirRig();
const airBody = new BodyAnim(animTune, 0.0254);
const sink = new SwimSink();
let floats = 0;
let sunk = 0;
function airFrame(): void {
  st[2] += 1;
  const f = st[2] | 0;
  const phase = f % 240;
  if (phase === 0) {
    // A plain jump: under the owner's rule the float takes it, with no start of its own (nothing made).
    airBody.stepped(false);
    airBody.jump(airRig, false);
  }

  // (A step off a ledge, leftGround, is an event, as a jump's start and a landing are: the ray it is judged by makes
  // objects of its own.) On the rope a third of the time; falling faster and faster through the jump.
  airBody.rope = (f >> 7) % 3 === 0;
  airBody.vy = 4.5 - phase * 0.0625;
  if (airBody.air(airRig, false) === 'mx_floating') floats++;
  if (phase === 230) airBody.onGround();
  // Treading at the surface and diving under it, by turns.
  sink.dt = DT;
  sink.depth = 1.1 + ((f >> 3) % 50) * 0.0275;
  sink.scale = 1.0625;
  sink.floatDepth = 1.1;
  sink.step(((f >> 8) & 1) === 0, animTune);
  if (sink.now > 0) sunk++;
}
function peerFrame(): void {
  st[1] += 1;
  const f = st[1] | 0;
  for (let i = 0; i < peers.length; i++) {
    const p = peers[i];
    // What the relay's messages do to a figure: its travel turns, and now and then its speed is another class's.
    const turn = p.heading + ((f + i * 37) % 900) * 0.0071;
    const speed = 0.4 + (((f >> 6) + i * 3) % 13) * 0.53;
    p.speed = speed;
    p.vel.x = Math.sin(turn) * speed;
    p.vel.z = Math.cos(turn) * speed;
    peerIn.vx = p.vel.x;
    peerIn.vz = p.vel.z;
    peerIn.heading = p.heading;
    peerIn.speed = p.speed;
    peerIn.dt = DT;
    if (p.loco.resolve(tune, peerRig, p.state, peerIn)) peerPicks++;
  }
}

function run(frame: () => void, n: number): void {
  for (let i = 0; i < n; i++) frame();
}
try {
  new Function('f', '%NeverOptimizeFunction(f)')(run);
} catch {
  // Without the flag the loop is left to the compiler.
}

let scavenges = 0;
const watch = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
});
watch.observe({ entryTypes: ['gc'] });
const young = (): number => v8.getHeapSpaceStatistics().find((x) => x.space_name === 'new_space')?.space_used_size ?? 0;
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => {
  await tick();
  await tick();
};

const N = 60_000;
async function measure(frame: () => void): Promise<{ made: number; scavenges: number }> {
  run(frame, 6000);
  let best = { made: Infinity, scavenges: Infinity };
  for (let attempt = 0; attempt < 3; attempt++) {
    run(frame, 2000);
    // Wall time for the optimising compiler, which works on a thread of its own (as ledgeAllocOwn.ts waits): on a loaded
    // machine its job had not landed in one process of a dozen, three times now (0.200, 0.125 and 0.251 B a frame, the
    // busy script's window each time, 36 of 36 clean run alone), and code not yet optimised boxes the fractions it reads.
    // A frame that allocates once optimised still fails.
    await new Promise<void>((r) => setTimeout(r, 25));
    (globalThis as unknown as { gc: (o?: { type: string }) => void }).gc({ type: 'minor' });
    await settle();
    scavenges = 0;
    const before = young();
    run(frame, N);
    const made = young() - before;
    await settle();
    if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges };
    if (best.scavenges === 0 && best.made <= 0) break;
  }
  return best;
}

const a = await measure(steadyFrame);
const b = await measure(busyFrame);
const c = await measure(peerFrame);
const d = await measure(airFrame);
const e = await measure(polishFrame);
const g = await measure(postureFrame);
console.log(JSON.stringify({
  posture: g.made, postureScavenges: g.scavenges, postureLegs: postureBody.legsFrames, posturePeerPicks,
  frames: N,
  steady: a.made, steadyScavenges: a.scavenges, steadyLegs: steady.legsFrames,
  busy: b.made, busyScavenges: b.scavenges, busyLegs: busy.legsFrames, busySprints: busy.sprintFrames, busySeats: busy.seatFrames, busyDrops: busy.dropped, busyEnded: busy.ended, busyMuted: busy.muted,
  polish: e.made, polishScavenges: e.scavenges, polishLegs: polish.legsFrames, busyCarries: polish.carries,
  peers: c.made, peerScavenges: c.scavenges, peerCount: peers.length, peerPicks,
  air: d.made, airScavenges: d.scavenges, airFloats: floats, airSunk: sunk,
}));
process.exit(0);
