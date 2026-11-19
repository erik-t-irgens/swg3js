// Climbing II, phase 6's own frames (maker A's items 1 and 2), measured with no collection between, each frame a function of its own
// reading kept fields, called from a loop kept out of the optimizer (wave 2a's lesson). `VAULT_PART` picks what is measured:
//  - 'sense': a body sprinting at a face too far yet for any clip's start, the vault's sense every frame (the two face rays, the
//    obstacle's top read once and kept while the same face is met at the same place), against a stand-in world that answers its
//    rays with one kept record (the engine's own answers and the numbers its boundary boxes are the engine's cost, as the poles'
//    measure keeps them apart);
//  - 'read': the same with the face a little nearer or further each frame (`face` moved 0.15 m), so the top is read and followed
//    along the travel every frame (the march, the far side's ray back), as a body running at a face at a slant reads it;
//  - 'step': the frames of one vault held (its clock run slow, so every measured frame is a held one: the body placed on the clip's
//    path through the run-in, the hand on the top, the flight and the landing, the figure's offset), over the obstacle `VAULT_SHAPE`
//    names ('vault' 0.9 m high and 0.8 deep, 'dive' 0.9 by 1.5, 'clamber' a 1 m ledge);
//  - 'begin': the vault begun as an event, once in every 200 sprint frames at a face too far yet (a note: bytes a begin, its own
//    reads of room and ground included, the rest of the frames making nothing as 'sense' shows);
//  - 'clips': the vault's hand-over to a rig (`driveVaultClips`) on a stand-in rig that only counts its calls, the clip's time moving
//    every frame of one long vault;
//  - 'clipEvents': the same with a clip begun and ended (into the run, or into standing) once in every 800 frames (a note: bytes an
//    event, the options handed to the rig's `play` as every other hand-over hands them).
// Prints one line of JSON. Run twelve at once by `climbVaultsAlloc.test.ts`.
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';

const PARTS = ['sense', 'read', 'step', 'begin', 'clips', 'clipEvents'] as const;
const PART = (PARTS as readonly string[]).includes(process.env.VAULT_PART ?? '') ? (process.env.VAULT_PART as (typeof PARTS)[number]) : 'sense';
const SHAPE = process.env.VAULT_SHAPE === 'dive' ? 'dive' : process.env.VAULT_SHAPE === 'clamber' ? 'clamber' : 'vault';
const { Vault, VaultIn, VAULT_PACE_SPRINT } = await import('../../../src/player/vault.ts');
const { driveVaultClips } = await import('../../../src/player/hangClips.ts');
const { resetMoveTune } = await import('../../../src/anim/moveTune.ts');

resetMoveTune();
let scavenges = 0;
new PerformanceObserver((l) => {
  scavenges += l.getEntries().length;
}).observe({ entryTypes: ['gc'] });
const turn = () => new Promise<void>((r) => setImmediate(r));
const young = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;

interface Meas {
  bytes: number;
  frames: number;
  clean: boolean;
}
async function measure(fn: (n: number) => void, window: number): Promise<Meas> {
  fn(4000);
  let best: Meas = { bytes: Number.POSITIVE_INFINITY, frames: window, clean: false };
  for (let tries = 0; tries < 4; tries++) {
    fn(240);
    // (Wall time for the optimising compiler, on a thread of its own, as ledgeAllocOwn.ts waits.)
    await new Promise<void>((r) => setTimeout(r, 25));
    globalThis.gc!({ type: 'minor' } as never);
    await turn();
    await turn();
    const s0 = scavenges;
    const y0 = young();
    fn(window);
    const y1 = young();
    await turn();
    await turn();
    if (scavenges === s0 && y1 - y0 < best.bytes) best = { bytes: y1 - y0, frames: window, clean: true };
  }
  return best;
}

/** A ray as the engine's: its start and its way, written in place. */
class StandRay {
  origin = { x: 0.5, y: 0.5, z: 0.5 };
  dir = { x: 0.5, y: 0.5, z: 0.5 };
}
/** The engine's answer, one kept record written in place. */
class Hit {
  timeOfImpact = 0.5;
  normal = { x: 0.5, y: 0.5, z: 0.5 };
  collider = { handle: 7 };
}
/** A world of one box across the way (`face` to `face + depth` along +z, `top` high) on flat ground, answering every ray with the kept record. */
class StandWorld {
  face = 3.5;
  depth = SHAPE === 'dive' ? 1.5 : SHAPE === 'clamber' ? 100 : 0.8;
  top = SHAPE === 'clamber' ? 1 : 0.9;
  rays = 0;
  asks = 0;
  readonly hit = new Hit();
  castRayAndGetNormal(ray: StandRay, maxToi: number, _solid?: boolean, flags?: number): Hit | null {
    this.rays++;
    // (Maker B, item 3: this world is all still: what moves, asked of it, is nothing.)
    if (flags !== undefined && (flags & 1) !== 0) return null;
    const o = ray.origin;
    const d = ray.dir;
    const h = this.hit;
    let toi = -1;
    if (d.y < -0.5) {
      toi = o.y - (o.z >= this.face && o.z <= this.face + this.depth ? this.top : 0);
      h.normal.x = 0;
      h.normal.y = 1;
      h.normal.z = 0;
    } else if (d.z > 0.5) {
      if (o.y < this.top) toi = this.face - o.z;
      h.normal.x = 0;
      h.normal.y = 0;
      h.normal.z = -1;
    } else if (d.z < -0.5) {
      toi = o.z - (this.face + this.depth);
      h.normal.x = 0;
      h.normal.y = 0;
      h.normal.z = 1;
    }
    if (toi < 0 || toi > maxToi) return null;
    h.timeOfImpact = toi;
    return h;
  }
  intersectionWithShape(): null {
    this.asks++;
    return null;
  }
}

let out: Record<string, unknown> = {};
if (PART === 'sense' || PART === 'read' || PART === 'step' || PART === 'begin') {
  const world = new StandWorld();
  const V = new Vault({ ray: () => new StandRay() as never, capsule: () => ({}) as never, cuboid: () => ({}) as never });
  /** The frame's state: the body, the vault's record, which frame. Fields, so nothing crosses a call. */
  class Run {
    pos = { x: 0, y: 0, z: 0 };
    vel = { x: 0, y: 0, z: 7 };
    vi = new VaultIn();
    n = 0;
    begun = 0;
    ended = 0;
    waits = 0;
    held = 0;
  }
  const st = new Run();
  const vi = st.vi;
  // 'step': a held vault's clock run so slow that one vault outlasts every frame measured (its arithmetic is a frame's whatever
  // the frame's length: the path, the lift, the landing, the offset).
  // (Each shape's so its measured frames reach its landing and none its end: the dive's clip is twice as long.)
  vi.dt = PART !== 'step' ? 1 / 144 : SHAPE === 'dive' ? 1 / 350000 : SHAPE === 'clamber' ? 1 / 750000 : 1 / 700000;
  vi.vx = 0;
  vi.vz = 7;
  vi.grounded = true;
  vi.pace = VAULT_PACE_SPRINT;
  vi.sprintHeld = true;
  vi.scale = 1;
  vi.filter = 0;
  function frame(): void {
    const s = st;
    s.n++;
    const b = s;
    if (PART === 'step' || PART === 'begin') {
      if (V.holding) {
        V.step(b as never, s.vi, true);
        s.held++;
        if (!V.holding) s.ended++;
        return;
      }
      V.tick(s.vi.dt);
      s.waits++;
      // Sprinting at a face too far yet; once in 200 frames (at once, holding a vault for good: 'step') met within reach.
      b.pos.x = 0;
      b.pos.y = 0;
      // (A clamber's hand starts further in: its start is met a little nearer.)
      b.pos.z = PART === 'step' || s.waits % 200 === 0 ? (SHAPE === 'clamber' ? 1.65 : 1.5) : -0.2;
      b.vel.x = 0;
      b.vel.y = 0;
      b.vel.z = 7;
      if (V.sense(world as never, b as never, s.vi)) s.begun++;
      return;
    }
    b.pos.x = 0;
    b.pos.y = 0;
    b.pos.z = -0.2;
    // 'read': the face a little nearer or further each frame, so its top is read anew (the kept read is the same face's within 0.1 m).
    if (PART === 'read') world.face = (s.n & 1) === 0 ? 3.5 : 3.65;
    if (!V.sense(world as never, b as never, s.vi) && V.verdict === 'waiting') s.waits++;
  }
  function run(n: number): void {
    for (let k = 0; k < n; k++) frame();
  }
  // eslint-disable-next-line no-eval
  eval('%NeverOptimizeFunction(run)');
  const begun0 = st.begun;
  const meas = await measure(run, 100000);
  out = { part: PART, shape: SHAPE, waits: st.waits, held: st.held, begun: st.begun - begun0, ended: st.ended, rays: world.rays, asks: world.asks, casts: V.casts, verdict: V.verdict, clip: V.clip, kind: V.kind, t: V.t, meas };
} else {
  /** A rig that only counts its calls (the vault's hand-over is measured, never the rig's own mixer). */
  class StandRig {
    calls = 0;
    overrideSeekAt = 0.5;
    overrideRateAt = 0.5;
    overrideName: string | null = null;
    play(c: string, _o: unknown): number {
      this.calls++;
      this.overrideName = c;
      return 1;
    }
    overrideSeekNow(_c: string): void {
      this.calls++;
    }
    setState(_s: string, _sp: number, _u: string | null, _o: unknown): void {
      this.calls++;
    }
    blendOut(_f: number): void {
      this.calls++;
      this.overrideName = null;
    }
    update(_dt: number): void {
      this.calls++;
    }
  }
  for (const m of ['play', 'overrideSeekNow', 'setState', 'blendOut', 'update']) {
    const fn = (StandRig.prototype as unknown as Record<string, unknown>)[m];
    // eslint-disable-next-line no-eval
    eval('(fn) => %NeverOptimizeFunction(fn)')(fn);
  }
  const rig = new StandRig();
  const hang = { posePlaying: '', hangFade: { fade: 0.15 }, ladderRate: { rate: 1, fade: 0.15 } };
  /** The vault's fields `driveVaultClips` reads, one class (as the vault is). */
  class VaultS {
    startClip = false;
    holding = true;
    ended = false;
    runOn = true;
    t = 0.5;
    clipName = 'mx_jumping';
    k = 0;
    starts = 0;
  }
  const V = new VaultS();
  V.t = 0.25;
  const EVERY = PART === 'clipEvents' ? 800 : 1 << 30;
  const drive = (): void => {
    const v = V;
    v.k = (v.k + 1) % EVERY;
    v.startClip = v.k === 1;
    if (v.startClip) v.starts++;
    v.holding = v.k > 0 && v.k < EVERY - 100;
    v.ended = v.k === EVERY - 100;
    v.runOn = (v.starts & 1) === 0;
    if (v.holding) v.t = v.t > 1.1 ? 0.01 : v.t + 0.0000125;
    driveVaultClips(rig as never, v as never, 1 / 60, hang as never);
  };
  const drives = (n: number): void => {
    for (let i = 0; i < n; i++) drive();
  };
  // eslint-disable-next-line no-eval
  eval('%NeverOptimizeFunction(drives)');
  const s0 = V.starts;
  const meas = await measure(drives, 100000);
  out = { part: PART, calls: rig.calls, starts: V.starts - s0, meas };
}
console.log(JSON.stringify(out));
