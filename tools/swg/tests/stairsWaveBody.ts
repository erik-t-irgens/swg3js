// The stairs wave's walker: the human male's figure (the converted one where the packs are here, else the tests' own
// skeleton) walked by the game's own movement (the grapple's harness, `grappleBody.ts`) under the speed classes
// (`BodyLoco`), with the stairs' sampler (`StairSense`), the drawn body's ease (`DrawnHeight`), the stair cycles
// (`stairCyclesFor`), the clips played by a three mixer as the rig plays them, and the feet (`FootIk`), each called in the
// player's own order (`Player.update`, pinned as text by `stairsWiring.test.ts`):
//  1. the speed keys (`loco.keys`), 2. last frame's stairs into the classes' record and their measure (`stairLoco`),
//  3. the plan (`loco.plan`: the speed one step a stair gives), 4. the movement at that speed (`speedScale`, the walk flag
//  off as the classes have it), 5. after the move the drawn body's ease, the sampler (measuring) and how far the move took
//  the body along the stairs, 6. the stairs again, that distance and the legs' clip's time, then `loco.legs` (the rate),
//  7. the clip handed over at that rate (a change faded as the rig fades it) and started at the step's snap, 8. the mixer,
//  9. the figure placed on the capsule lifted by the drawn ease, 10. the feet (their stairs, stride and clearance).
// Not a test itself.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import * as H from './grappleBody.ts';
import { RAPIER } from '../../../src/core/physics.ts';
import { FootIk, stairFeetOf } from '../../../src/player/footIk.ts';
import { StairSense } from '../../../src/player/stairSense.ts';
import { DrawnHeight, DrawnIn } from '../../../src/anim/drawnHeight.ts';
import { BodyLoco, newLocoIn, type LocoRig } from '../../../src/anim/bodyLoco.ts';
import { LOCO_TUNE } from '../../../src/anim/locoTune.ts';
import { STAIR_IDS, moreClips } from '../../../src/anim/locoTable.ts';
import { MixamoPack } from '../../../src/anim/mixamoPack.ts';
import { stairCyclesFor, type StairCycles } from '../../../src/anim/stairCycle.ts';
import { phaseAt, timeAtPhase, type ClipFacts } from '../../../src/anim/locoPhase.ts';
import { glbSkeleton, speciesBodies, targetSkeleton } from './animFixtures.ts';
import { REPO } from './oldModules.ts';

export type Target = ReturnType<typeof targetSkeleton>;
export const DEG = Math.PI / 180;
/** Jedi Academy's full run, m/s: what the classes' speed is a scale of (`Player.update`'s `speedScale`). */
export const JKA_RUN = 250 * 0.0254;

const body = speciesBodies(REPO).find((b) => b.id === 'human_male');
export const target: Target = body ? (glbSkeleton(body.body) as Target) : targetSkeleton();
export const converted = !!body;

let clipsMade: THREE.AnimationClip[] | null = null;
let cyclesMade: StairCycles | null = null;
/** Each striding clip's own speed on the figure at scale 1 (the pack's stride: what the game's rig reads, `CharacterRig.readSpeed`). */
const strideSpeeds = new Map<string, number>();
/** Each striding clip's stride (the pack's: its left foot's landing and its length), which a change off a stair cycle starts it in step with, as the rig does. */
const strides = new Map<string, ClipFacts>();
/** The pack's clips for the figure (the table's, the stair clips) and the stair cycles made from them, once. */
export async function clipsAndCycles(): Promise<{ clips: THREE.AnimationClip[]; cycles: StairCycles }> {
  if (!clipsMade) {
    const packDir = join(REPO, 'public', 'anims', 'mixamo');
    const pack = new MixamoPack({
      enabled: () => true,
      index: async () => readFileSync(join(packDir, 'index.json'), 'utf8'),
      clip: async (file: string) => {
        const b = readFileSync(join(packDir, file));
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      },
      breath: async () => {},
      also: [...moreClips(), ...STAIR_IDS],
      now: () => performance.now(),
    });
    const info = console.info;
    const warn = console.warn;
    console.info = () => {};
    console.warn = () => {};
    clipsMade = (await pack.clipsFor(target as never, 'stairs wave')) as THREE.AnimationClip[];
    console.info = info;
    console.warn = warn;
    for (const c of clipsMade) {
      const s = pack.strideOf(c);
      if (s) {
        strideSpeeds.set(c.name, s.speed);
        strides.set(c.name, s);
      }
    }
    cyclesMade = stairCyclesFor(clipsMade, target as never);
  }
  return { clips: clipsMade, cycles: cyclesMade! };
}

/** The skeleton as bones under a root, as the game's rig holds them, with a mixer over them. */
export interface Figure {
  root: THREE.Group;
  bones: Map<string, THREE.Bone>;
  rig: { root: THREE.Group; boneNamed(n: string): THREE.Bone | null; restSkeleton(): Target; legPose: { restore(): void } | null };
  mixer: THREE.AnimationMixer;
}
export function figure(): Figure {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.fromArray(target.base.p);
  inner.quaternion.fromArray(target.base.q);
  root.add(inner);
  const bones = new Map<string, THREE.Bone>();
  const made: THREE.Bone[] = [];
  target.joints.forEach((j) => {
    const b = new THREE.Bone();
    b.name = j.name;
    b.position.fromArray(j.restP);
    b.quaternion.fromArray(j.restQ);
    made.push(b);
    bones.set(j.name, b);
    (j.parent < 0 ? inner : made[j.parent]).add(b);
  });
  const rig = { root, boneNamed: (n: string) => bones.get(n) ?? null, restSkeleton: () => target, legPose: null as { restore(): void } | null };
  return { root, bones, rig, mixer: new THREE.AnimationMixer(root) };
}

/** One frame's record of the walker (what the tests measure). */
export interface Row {
  t: number;
  x: number;
  y: number;
  z: number;
  speed: number;
  clip: string;
  rate: number;
  n: number;
  stride: number;
  way: number;
  known: boolean;
  tread: number;
  riser: number;
  next: number;
  /** The hips' joint ('root') in the world, the drop, the feet's weight. */
  hipY: number;
  drop: number;
  weight: number;
  /** Each leg: planted share, grounded, its heel's, ball's and toe tip's places (x, y, z). */
  legs: { planted: number; grounded: boolean; heel: number[]; ball: number[]; tip: number[]; knee: number[]; hip: number[]; ankle: number[] }[];
  /** The clip's legs before the feet (the knees' side), for the knee check: each leg's hip, knee and ankle as the clip posed them. */
  pre: number[][][];
  miss: number;
}

const tmp = new THREE.Vector3();
const at3 = (b: THREE.Object3D) => {
  b.getWorldPosition(tmp);
  return [tmp.x, tmp.y, tmp.z];
};

/** The walker: a body, the classes, the sampler, the drawn ease, the figure and its feet. */
export class Walker {
  readonly b: H.TestBody;
  readonly loco = new BodyLoco(LOCO_TUNE);
  readonly lo = newLocoIn();
  readonly sense = new StairSense();
  readonly drawn = new DrawnHeight();
  readonly di = new DrawnIn();
  readonly fig = figure();
  readonly feet = new FootIk(LOCO_TUNE.ik, () => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }));
  readonly rig: LocoRig;
  private readonly clips: Map<string, THREE.AnimationClip>;
  private action: THREE.AnimationAction | null = null;
  private readonly stairFacts: StairCycles['facts'];
  private moved = 0;
  /** The class walked: the walk (true) or the jog. */
  walk = true;
  /** Stairs II: Shift held from the first frame (the run), unless walking. */
  run = false;
  private shiftWas = false;
  /** Measure the knees' clip legs each frame (costs a little). */
  knees = false;
  /** Played heading (the figure's front), radians, worked out from the travel. */
  heading = 0;
  t = 0;
  constructor(p: H.Physics, clips: THREE.AnimationClip[], cycles: StairCycles) {
    this.b = new H.TestBody(p);
    this.b.jka.forceLevel = 0;
    this.clips = new Map([...clips, ...cycles.clips].map((c) => [c.name, c]));
    const facts = cycles.facts;
    this.stairFacts = facts;
    const all = this.clips;
    const lo = this.lo;
    this.rig = {
      has: (c: string) => all.has(c) || !c.startsWith('mx_'),
      speedOut: 0,
      // A striding clip's own speed at the figure's size, as the game's rig reads it (so a walk's rate follows the ground).
      readSpeed(c: string) {
        const s = strideSpeeds.get(c);
        if (s === undefined) return false;
        this.speedOut = s * lo.scale;
        return true;
      },
      stairFacts: (c: string) => facts.get(c) ?? null,
    };
    this.lo.scale = 1;
    this.lo.standing = true;
  }

  /** Stand the body at (x, y, z) facing along +x (the travel), its keys down. */
  place(x: number, y: number, z: number): void {
    this.b.place(x, y, z);
    this.b.forward.set(1, 0, 0);
    this.b.right.set(0, 0, 1);
    this.heading = Math.PI / 2;
    this.b.key('KeyW', true);
  }

  /** One frame, in the player's order. */
  frame(dt: number): Row {
    const b = this.b;
    const lo = this.lo;
    const loco = this.loco;
    const sense = this.sense;
    this.t += dt;
    // 1. The speed keys (the walk class by the walk key, the jog with none: the classes take the walk flag off the movement).
    const shift = this.run && !this.walk;
    loco.keys(dt, shift, shift && !this.shiftWas, this.walk, this.rig);
    this.shiftWas = shift;
    // 2. Last frame's stairs, and their measure.
    lo.stairs = sense.way;
    lo.stairEnding = sense.ending;
    lo.stairAhead = sense.way > 0 ? sense.ahead.up : sense.way < 0 ? sense.ahead.down : Number.POSITIVE_INFINITY;
    lo.stairGap = sense.way > 0 ? sense.ahead.upGap : sense.way < 0 ? sense.ahead.downGap : Number.POSITIVE_INFINITY;
    lo.stairBehind = sense.way > 0 ? sense.ahead.upBehind : sense.way < 0 ? sense.ahead.downBehind : Number.POSITIVE_INFINITY;
    lo.stairKnown = sense.known;
    lo.stairTread = sense.tread;
    lo.stairRiser = sense.riser;
    lo.stairNext = sense.next;
    lo.stairPrev = sense.prev;
    lo.stairLead = this.feet.leadSide;
    lo.stairLeadAt = this.feet.leadAt;
    // 3. The plan.
    lo.dt = dt;
    lo.mz = 1;
    lo.mx = 0;
    lo.grounded = b.grounded;
    lo.sprint = LOCO_TUNE.speed.forward.sprint;
    lo.pool = 100;
    loco.plan(lo);
    // 4. The movement at the classes' speed.
    b.speedScale = loco.speed / JKA_RUN;
    const px = b.pos.x;
    const py = b.pos.y;
    const pz = b.pos.z;
    const wasGrounded = b.grounded;
    b.frame(dt);
    // 5. The drawn ease, the sampler, the move along the stairs.
    const di = this.di;
    di.dt = dt;
    di.dx = b.pos.x - px;
    di.dy = b.pos.y - py;
    di.dz = b.pos.z - pz;
    di.askedY = 0;
    di.nx = b.slope.planeNx;
    di.ny = b.slope.planeNy;
    di.nz = b.slope.planeNz;
    di.grounded = wasGrounded;
    this.drawn.step(di, LOCO_TUNE.stairs);
    const sa = sense.at;
    sa.x = b.pos.x;
    sa.y = b.pos.y;
    sa.z = b.pos.z;
    sa.vx = b.vel.x;
    sa.vz = b.vel.z;
    sa.dt = dt;
    sa.filter = b.filter;
    const moving = Math.hypot(b.vel.x, b.vel.z) > 0.05;
    sa.reads = b.grounded && moving;
    sa.measure = LOCO_TUNE.ik.hips === 'steady' || LOCO_TUNE.stairs.stepRule === 'stairs';
    sense.step(b.physics.world as never, LOCO_TUNE.stairs);
    this.moved += di.dx * sense.ux + di.dz * sense.uz;
    // 6. The stairs again, the move along them, the legs' clip's time; the legs.
    lo.stairEnding = sense.ending;
    lo.stairAhead = sense.way > 0 ? sense.ahead.up : sense.way < 0 ? sense.ahead.down : Number.POSITIVE_INFINITY;
    lo.stairGap = sense.way > 0 ? sense.ahead.upGap : sense.way < 0 ? sense.ahead.downGap : Number.POSITIVE_INFINITY;
    lo.stairBehind = sense.way > 0 ? sense.ahead.upBehind : sense.way < 0 ? sense.ahead.downBehind : Number.POSITIVE_INFINITY;
    lo.stairKnown = sense.known;
    lo.stairTread = sense.tread;
    lo.stairRiser = sense.riser;
    lo.stairNext = sense.next;
    lo.stairPrev = sense.prev;
    lo.stairMoved = this.moved;
    this.moved = 0;
    const pick = loco.pick;
    lo.legTime = pick && this.action && this.action.getClip().name === pick.clip ? this.action.time : Number.NaN;
    lo.stairLead = this.feet.leadSide;
    lo.stairLeadAt = this.feet.leadAt;
    lo.ground = Math.hypot(b.vel.x, b.vel.z);
    const legs = loco.legs(moving && b.grounded ? this.rig : null, lo, false);
    // 7. The clip handed over (a change faded as the rig fades it), at its rate, started at the step's snap.
    const mixer = this.fig.mixer;
    if (legs) {
      const clip = this.clips.get(legs.clip);
      if (clip) {
        const next = mixer.clipAction(clip);
        if (next !== this.action) {
          // Off a whole stair cycle onto a striding clip, the clip starts in step (its left foot's landing at the cycle's), as
          // the rig starts it (CharacterRig.addStairCycles; the rig's shared rate through the fade is not modelled).
          const was = this.action;
          const wf = was ? this.stairFacts.get(was.getClip().name) : undefined;
          let k = -1;
          if (wf) for (let i = 0; i < wf.steps; i++) if (wf.side[i] === 0) k = i;
          const nb = strides.get(legs.clip);
          const startAt = was && wf && wf.steps === 2 && k >= 0 && nb ? timeAtPhase(phaseAt(was.time, { speed: 1, leftAt: wf.at[k], cycle: wf.len }), nb, clip.duration) : Number.NaN;
          next.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1).play();
          if (startAt === startAt) next.time = startAt;
          if (this.action) this.action.crossFadeTo(next, LOCO_TUNE.fade.loco, false);
          this.action = next;
        }
        next.timeScale = loco.rate;
        if (loco.snap === loco.snap) next.time = loco.snap;
      }
    }
    // 8. The mixer, the feet's clean pose back first.
    this.fig.rig.legPose?.restore();
    mixer.update(dt);
    // 9. The figure on the capsule, lifted by the drawn ease.
    const r = this.fig.root;
    r.position.set(b.pos.x, b.pos.y + this.drawn.offset, b.pos.z);
    r.rotation.set(0, this.heading, 0);
    r.updateMatrixWorld(true);
    const names = [['lThigh', 'lShin', 'lAnkle'], ['rThigh', 'rShin', 'rAnkle']];
    const pre = this.knees ? names.map((l) => l.map((n) => at3(this.fig.bones.get(n)!))) : [];
    // 10. The feet.
    const fi = this.feet.in;
    fi.dt = dt;
    fi.on = b.grounded;
    fi.stairClip = loco.legsOn && loco.stairs !== 0;
    fi.px = b.pos.x;
    fi.py = b.pos.y;
    fi.pz = b.pos.z;
    fi.heading = this.heading;
    fi.filter = b.filter;
    const stepping = loco.legsOn && loco.stepFacts !== null;
    fi.stride = stepping ? loco.step.stride : 1;
    fi.clear = stepping ? LOCO_TUNE.stairs.clear : 0;
    fi.pin = (stepping || loco.stairEnd.pins) && LOCO_TUNE.stairs.pin === 'sole';
    stairFeetOf(sense, fi);
    fi.pivotL = stepping ? loco.step.pivotL : 0;
    fi.pivotR = stepping ? loco.step.pivotR : 0;
    this.feet.step(this.fig.rig as never, b.physics.world as never, null);
    r.updateMatrixWorld(true);
    const legsOut: Row['legs'] = [];
    const rep = this.feet.report() as { legs: { planted: number; grounded: boolean }[] };
    for (let s = 0; s < 2; s++) {
      const sole = (w: number) => {
        const v = this.feet.solePoint(s, w, null, tmp);
        return v ? [v.x, v.y, v.z] : [Number.NaN, Number.NaN, Number.NaN];
      };
      const l = rep.legs[s];
      legsOut.push({ planted: l ? l.planted : 0, grounded: l ? l.grounded : false, heel: sole(0), ball: sole(1), tip: sole(2), hip: at3(this.fig.bones.get(names[s][0])!), knee: at3(this.fig.bones.get(names[s][1])!), ankle: at3(this.fig.bones.get(names[s][2])!) });
    }
    return {
      t: this.t,
      x: b.pos.x,
      y: b.pos.y,
      z: b.pos.z,
      speed: lo.ground,
      clip: this.action ? this.action.getClip().name : '',
      rate: loco.rate,
      n: loco.step.n,
      stride: loco.step.stride,
      way: sense.way,
      known: sense.known,
      tread: sense.tread,
      riser: sense.riser,
      next: sense.next,
      hipY: at3(this.fig.bones.get('root')!)[1],
      drop: this.feet.drop,
      weight: this.feet.weight,
      legs: legsOut,
      pre,
      miss: loco.step.miss,
    };
  }
}

/** A flight of `count` treads `tread` deep rising `riser` each (`way` +1 up along +x from `x0`, -1 down from a top), with a landing of `land` treads after `half` of them (0 none), on flat ground, wide in z; and its profile. */
export function flight(p: H.Physics, opt: { tread: number; riser: number; count: number; x0: number; way: number; half?: number; landing?: number }): (x: number) => number {
  const { tread: T, riser: R, count, x0, way } = opt;
  const half = opt.half ?? 0;
  const landing = opt.landing ?? 0;
  H.ground(p, 0);
  // Heights of each tread from x0 (going up: rising; going down: the flight built rising toward -x).
  const edges: number[] = [];
  let x = x0;
  for (let i = 0; i < count; i++) {
    const w = half > 0 && i === half ? landing * T : T;
    edges.push(x);
    x += w;
  }
  const end = x;
  const top = count * R;
  const heightAt = (xx: number): number => {
    if (way > 0) {
      if (xx < x0) return 0;
      if (xx >= end) return top;
      let k = 0;
      while (k + 1 < edges.length && xx >= edges[k + 1]) k++;
      return (k + 1) * R;
    }
    // Down along +x: the top before x0, falling a riser at each edge.
    if (xx < x0) return top;
    if (xx >= end) return 0;
    let k = 0;
    while (k + 1 < edges.length && xx >= edges[k + 1]) k++;
    return top - (k + 1) * R;
  };
  // Boxes: each tread's column, and the run-off beyond (up) or the top before (down).
  for (let i = 0; i < count; i++) {
    const a = edges[i];
    const bEnd = i + 1 < edges.length ? edges[i + 1] : end;
    const h = way > 0 ? (i + 1) * R : top - (i + 1) * R;
    if (h > 0.001) H.box(p, [a, 0, -3], [bEnd, h, 3]);
  }
  if (way > 0) H.box(p, [end, 0, -3], [end + 6, top, 3]);
  else H.box(p, [x0 - 6, 0, -3], [x0, top, 3]);
  return heightAt;
}
