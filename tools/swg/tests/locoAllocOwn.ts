// The speed classes' frame makes nothing (Animations I, wave 2a): the body's record driven as the player's update
// drives it -- the keys, the frame's record written, the plan, the turn eased, the legs asked with the ground speed,
// the fade and the state asked for -- over a steady jog, over a script of keys that changes way and class every few
// frames (walks, runs, sprints, taps, strafes, diagonals, a blaster up, a jump, a seat taken mid-sprint), and a dozen
// other players' legs worked out each frame from velocities that turn and speeds that change. Each over a window of
// frames with no collection, the cleanest of three kept. Not a test itself: `locoAlloc.test.ts` runs it in twelve
// processes at once (`node --expose-gc --allow-natives-syntax`), since which calls the compiler builds in, and so
// whether a number crossing one is boxed, turns on the load it compiles under.
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import { BodyLoco, FadeOpts, LegOpts, fightKeysDown, newLocoIn, type LocoRig } from '../../../src/anim/bodyLoco.ts';
import { tableClips } from '../../../src/anim/locoTable.ts';
import { PeerIn, PeerLoco } from '../../../src/anim/peerLoco.ts';
import { LOCO_TUNE_SHIPPED, type LocoTune } from '../../../src/anim/locoTune.ts';

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

/** A rig as the classes see one: every clip of the table, each with a speed of its own, read the frame's way. */
class StandInRig implements LocoRig {
  private readonly speeds = new Map<string, number>();
  speedOut = 0.5;
  scale = 1.0625;
  constructor() {
    tableClips().forEach((id, i) => this.speeds.set(`mx_${id}`, 1.37 + i * 0.211));
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
const W = 1, S = 2, A = 4, D = 8, SHIFT = 16, PRESS = 32, WALK = 64, GUN = 128, AIR = 256, SEAT = 512, BLOCK = 1024, FIGHT = 2048;

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
    lo.standing = true;
    lo.grounded = (keys & AIR) === 0;
    lo.swimming = false;
    lo.fighting = jka;
    lo.aiming = false;
    lo.fightKeys = fightKeysDown(this.input);
    lo.gunUp = (keys & GUN) !== 0;
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
const st = new Float64Array(4);
const DT = 1 / 60;

function steadyFrame(): void {
  steady.update(DT, W);
}
function busyFrame(): void {
  st[0] += 1;
  busy.update(DT, KEYS[(st[0] | 0) % scriptFrames]);
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
console.log(JSON.stringify({
  frames: N,
  steady: a.made, steadyScavenges: a.scavenges, steadyLegs: steady.legsFrames,
  busy: b.made, busyScavenges: b.scavenges, busyLegs: busy.legsFrames, busySprints: busy.sprintFrames, busySeats: busy.seatFrames, busyDrops: busy.dropped, busyEnded: busy.ended, busyMuted: busy.muted,
  peers: c.made, peerScavenges: c.scavenges, peerCount: peers.length, peerPicks,
}));
process.exit(0);
