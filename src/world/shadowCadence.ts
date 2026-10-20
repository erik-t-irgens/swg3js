// The sun's shadow cascades drawn by age (the performance pass's sixth wave): the near cascade every frame, the middle
// and far ones only when their maps would otherwise be shown older than their ages, each held exactly where its map was
// drawn for as long as it covers what the camera sees.
//
// Three skips a light whose `shadow.autoUpdate` and `shadow.needsUpdate` are both false, walk and all, and leaves its map
// as it was (`WebGLShadowMap`'s light loop); that is the whole of the mechanism. Its one trap is that three's cascades
// move every light every frame (`CSM.update`) and `refreshCascadeBoxes` works every light's matrix out again from where
// it was moved to, so an old map read through this frame's matrix is wrong (45% of a picture's pixels, research 5). So a
// cascade not drawn this frame has its light and its target put back where its map was drawn from **between
// `csm.update()` and `refreshCascadeBoxes`**, and every reader (the receivers, the ambient occlusion's cascades, the
// grass's matrices by reference, the leaf cards' push toward the light, the bodies' cascade test) sees one cascade whose
// matrix is the one its map was drawn with.
//
// What a hold promises is decided by guards over three's own fitting (`holdCovers`): across the light, every corner of the
// band the shader samples the cascade over (CSMShader.js's `csmx` to `csmy`) that the fresh box holds, the held box holds
// with `coverMargin` to spare (or as much as the fresh box gives it); along the sun the held map's deep end is never more
// than `coverDeep` short of the fresh map's (or of the band's deepest corner, where that is nearer), and the held light
// never more than `coverHigh` nearer the slice. A sun that has moved past `sunStepDeg`, a fast mover that could cast into
// the band (`moverReaches`), a map that is null or a cascade made dirty by the world's own events (`dirtyAll`) all draw
// the cascade now; and the stagger keeps two far cascades due by age alone from being drawn on one frame.
//
// `autoUpdate` of each light is written by `ShadowHold.decide` and `dirtyAll` and nowhere else: true for a cascade due,
// false for one held, so a draw that no `decide` preceded (the settle's frame, a respawn, `bench`, the picture helpers)
// draws what the last frame left due at the pose it left and skips only what was held then.
//
// Every number of ours is in `SHADOW_PASS_TUNE`, live through `__debug.shadowPass({ tune })`. Pure but for three's
// vectors and matrices; node loads it (`shadowCadence.test.ts`, `shadowHold.test.ts`). Nothing in a frame allocates: the
// per-frame paths read and write kept records, and the positional forms are for the tests and the console.
import * as THREE from 'three';
import { FIXED_DT } from '../core/physics.ts';

/** The cascades this holds at most: three, the game's, and one spare so a fourth never overruns a kept array. */
export const CASCADES_MOST = 4;

/** Why a cascade was drawn this frame, or `held` when it was not. */
export type ShadowReason = 'first' | 'dirty' | 'age' | 'cover' | 'deep' | 'high' | 'sun' | 'mover' | 'held';
export const SHADOW_REASONS: readonly ShadowReason[] = ['first', 'dirty', 'age', 'cover', 'deep', 'high', 'sun', 'mover', 'held'];
const REASON_INDEX: Record<ShadowReason, number> = { first: 0, dirty: 1, age: 2, cover: 3, deep: 4, high: 5, sun: 6, mover: 7, held: 8 };

/**
 * The cascades' numbers. `maxAgeMs`, `fastMover` and `coverDeep` change what the owner sees (how far a moving thing's
 * shadow may trail it in the far maps, and how far the far map's own cut-off may step while the view turns): his eye,
 * on the debug menu's sliders. The rest is technical. `cadence` false draws every cascade every frame, today's; so does
 * `maxAgeMs` [0, 0, 0].
 */
export const SHADOW_PASS_TUNE = {
  /** The far cascades drawn by age, each held where its map was drawn; false draws every cascade every frame (today). The perf switch `shadowCadence`. */
  cadence: true,
  /**
   * A cascade is drawn on any frame where its map would otherwise be shown this old or older, in ms: the near map
   * (0-54 m) every frame; the middle (54-115 m) and far (115-320 m) at 144 Hz every 2nd and every 6th frame. It is how
   * far a moving thing's shadow may trail it there: a walker at 6 m/s 8 and 25 cm, under a texel of either map (14 and
   * 40 cm). Counted in time, so the trail is the same at every frame rate. [0, 0, 0] is today exactly. The owner's eye.
   */
  maxAgeMs: [0, 13, 41] as number[],
  /** Never two far cascades due by age alone on one frame: the older map first, the other a frame later. Technical: a far draw never stacks into a spike. */
  stagger: true,
  /** Metres across the light every corner of the band the shader samples a held cascade over must stay inside its box (or as much as the fresh box gives that corner). Technical. */
  coverMargin: 2,
  /**
   * Metres: how far a held map's deep end may fall short of where this frame's fresh map's would end (or of the band's
   * deepest corner where that is nearer). 0, exact: since the owner's answer to Q8 every shadow map's depth reaches its
   * whole band (`farDepth` 'whole', `shadowCameraFar`), so a held far map loses no ground of it and this seldom refuses.
   * With the far map's old depth (`farDepth` 'slice', which ended inside its own band looking across the sun) a number
   * above nought lets that cut-off step by up to this while the view turns, where 0 draws the far map on about half the
   * frames turning. The owner's eye.
   */
  coverDeep: 0,
  /** Metres: how much nearer the slice than the fresh fit a held light may stand (it keeps LIGHT_MARGIN less this over the slice's most sunward corner). Technical. */
  coverHigh: 30,
  /** Degrees: a held cascade whose light points further than this from the sun now is drawn now (a time jump, an arrival under another sun). Technical. */
  sunStepDeg: 0.25,
  /**
   * m/s: a cascade is drawn every frame while anything listed as a mover (a vehicle, a starport's shuttle in flight,
   * another player's ride or figure) and moving faster than this could cast into the band it is sampled over. At 40 m/s
   * a speeder's shadow would trail 1.6 m in the far map; 0 lists every mover whatever its speed. The owner's eye.
   */
  fastMover: 20,
  /** A region tier's still placed casters reach the shadow maps as one draw (`shadowBatches.ts`); false stops drawing the batches built. The perf switch `shadowBatches`. */
  batches: true,
  /** Milliseconds of one frame a tier's batch may be filled for; its pieces cast as they always did until it is whole. Technical. */
  buildSliceMs: 4,
};
export type ShadowPassTune = typeof SHADOW_PASS_TUNE;

/** Each number's range: a value past it is held at its edge and said. */
const RANGES: Record<string, [number, number]> = {
  coverMargin: [0, 100],
  coverDeep: [0, 1000],
  coverHigh: [0, 150],
  sunStepDeg: [0, 90],
  fastMover: [0, 2000],
  buildSliceMs: [0.25, 100],
};
const AGE_MOST = 1000;
const FLAGS = ['cadence', 'stagger', 'batches'] as const;

/**
 * Move the table in memory (never saved), as `__debug.shadowPass({ tune })` and the debug menu's sliders do: a number is
 * clamped to its range, a flag must be a boolean, `maxAgeMs` is an array or an object of indices (`{ 1: 33 }`, which is
 * what the menu's line writes) each clamped 0 to 1000; anything else is refused. Answers words for whatever was held or
 * refused.
 */
export function tuneShadowPass(patch: Record<string, unknown>): string[] {
  const t = SHADOW_PASS_TUNE as unknown as Record<string, unknown>;
  const words: string[] = [];
  for (const k of Object.keys(patch)) {
    const v = patch[k];
    if (k === 'maxAgeMs') {
      if (!v || typeof v !== 'object') {
        words.push('maxAgeMs is an array of milliseconds a cascade, or an object of them by index');
        continue;
      }
      const ages = SHADOW_PASS_TUNE.maxAgeMs;
      for (const key of Object.keys(v as object)) {
        const i = Number(key);
        const n = (v as Record<string, unknown>)[key];
        if (!Number.isInteger(i) || i < 0 || i >= CASCADES_MOST) {
          words.push(`maxAgeMs has no cascade ${key}`);
          continue;
        }
        if (typeof n !== 'number' || !Number.isFinite(n)) {
          words.push(`maxAgeMs[${i}] must be a number of milliseconds`);
          continue;
        }
        const held = Math.min(AGE_MOST, Math.max(0, n));
        if (held !== n) words.push(`maxAgeMs[${i}] held at ${held} (0 to ${AGE_MOST})`);
        while (ages.length <= i) ages.push(0);
        ages[i] = held;
      }
      continue;
    }
    if ((FLAGS as readonly string[]).includes(k)) {
      if (typeof v !== 'boolean') words.push(`${k} is true or false`);
      else t[k] = v;
      continue;
    }
    const range = RANGES[k];
    if (!range) {
      words.push(`the shadow pass has no number named ${k}`);
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      words.push(`${k} must be a number`);
      continue;
    }
    const held = Math.min(range[1], Math.max(range[0], v));
    if (held !== v) words.push(`${k} held at ${held} (${range[0]} to ${range[1]})`);
    t[k] = held;
  }
  return words;
}

/**
 * How deep each shadow map reaches, the owner's answer to Q8 ('whole', since 2026-10-19) or the old depth ('slice', the
 * perf switch `farDepth`'s first value, kept to compare). The shadow camera stands `margin` toward the sun beyond its
 * slice's most sunward corner; 'slice' gave every cascade `margin + distance` (470 m), which leaves the far slice's ground
 * past the map's deep end whenever the view is across the sun (the slice runs up to about 750 m along it); 'whole' gives
 * each the larger of that distance and its own box's width, which is its slice's diameter and so reaches every receiver
 * of the slice (only the far cascade's moves, to about 966 m at the game's camera). The one formula the world's
 * `applyShadowQuality` and the tests both use.
 */
export type FarDepth = 'slice' | 'whole';
export function shadowCameraFar(farDepth: FarDepth, margin: number, distance: number, boxWidth: number): number {
  return margin + (farDepth === 'whole' ? Math.max(distance, boxWidth) : distance);
}

// ---------------------------------------------------------------------------------------------------------------------
// The view the guards read, and the band a cascade is sampled over.

/** Indices into `ShadowView.num`. */
const TANX = 0;
const TANY = 1;
const NEAR = 2;
const FAR = 3;
const SUNTAN = 4;
const CAP = 5;

/**
 * The view as the guards read it, written once a frame from the camera `csm.update` just fitted to: where it stands and
 * which way it looks, the projection's own half-extents at one metre (so aiming's zoom is counted), the near plane and
 * the shadow distance (`min(camera.far, maxFar)`, the shader's `shadowFar`), the way toward the sun and its height's
 * tangent, and the band of the cascade being asked about. Kept; nothing is made.
 */
export class ShadowView {
  readonly at = new THREE.Vector3();
  readonly fwd = new THREE.Vector3();
  readonly sun = new THREE.Vector3(0, 1, 0);
  /** tanX, tanY, near, shadow distance, the sun's height's tangent, the shadow camera's range (the cap on a shadow's reach). */
  readonly num = new Float64Array(6);
  /** The band of the cascade being asked about: its near and far distance along the view. */
  readonly band = new Float64Array(2);
}

/**
 * The band of view distances the shader samples cascade `i` over (`CSMShader.js`: `csmx = x - margin / 2`, `csmy = y +
 * margin / 2`, the margin `0.25 · edge²`, the edges `CSM_cascades[i]`, shares of `shadowFar - cameraNear`), the last
 * cascade's far end its slice's (as its box is: the outer fade band past it is not guarded, the design's guards say why),
 * the first cascade's near end the near plane. Into `out[0]` and `out[1]`.
 */
export function cascadeBand(breaks: readonly number[], maxFar: number, near: number, i: number, out: { [k: number]: number }): void {
  const span = maxFar - near;
  const x = i > 0 ? breaks[i - 1] : 0;
  const y = breaks[i];
  let n = (x - (0.25 * x * x) / 2) * span;
  if (!(n > near)) n = near;
  const f = i === breaks.length - 1 ? y * span : (y + (0.25 * y * y) / 2) * span;
  out[0] = n;
  out[1] = f;
}

/** `cascadeBand` read off the view's own near and shadow distance, into its band: the per-frame form. */
function bandInto(breaks: readonly number[], v: ShadowView, i: number): void {
  const num = v.num;
  const near = num[NEAR];
  const span = num[FAR] - near;
  const x = i > 0 ? breaks[i - 1] : 0;
  const y = breaks[i];
  let n = (x - (0.25 * x * x) / 2) * span;
  if (!(n > near)) n = near;
  v.band[0] = n;
  v.band[1] = i === breaks.length - 1 ? y * span : (y + (0.25 * y * y) / 2) * span;
}

/**
 * The band's eight corners in the world: at each of its two distances along the view, the four corners of the view's
 * own frustum there (`tanX` and `tanY` its half-extents at one metre), carried by the camera's world matrix. Into kept
 * vectors. (The design gave this the field of view and the aspect; the projection's own half-extents are taken instead,
 * so a view zoomed to aim is the band it really is.)
 */
export function bandCorners(cameraWorld: THREE.Matrix4, tanX: number, tanY: number, near: number, far: number, out: THREE.Vector3[]): void {
  let k = 0;
  for (let e = 0; e < 2; e++) {
    const d = e === 0 ? near : far;
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sy = -1; sy <= 1; sy += 2) out[k++].set(sx * tanX * d, sy * tanY * d, -d).applyMatrix4(cameraWorld);
    }
  }
}

function bandCornersInto(cameraWorld: THREE.Matrix4, v: ShadowView, out: THREE.Vector3[]): void {
  const tx = v.num[TANX];
  const ty = v.num[TANY];
  let k = 0;
  for (let e = 0; e < 2; e++) {
    const d = v.band[e];
    for (let sx = -1; sx <= 1; sx += 2) {
      for (let sy = -1; sy <= 1; sy += 2) out[k++].set(sx * tx * d, sy * ty * d, -d).applyMatrix4(cameraWorld);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The guards.

/** What `holdCovers` reads: the band's corners, each light's frame inverted, the way to the sun, and four numbers. Kept. */
export class CoverQuery {
  readonly corners: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  readonly heldInv = new THREE.Matrix4();
  readonly freshInv = new THREE.Matrix4();
  readonly sun = new THREE.Vector3(0, 1, 0);
  /** The box's half width, the held light's place along the sun, the fresh light's, and the shadow camera's range. */
  readonly num = new Float64Array(4);
}

/**
 * Whether a held cascade still covers this frame's band, by its own reason or '': **the deep side**, the held map's deep
 * end (its light's place along the sun less the range) no more than `coverDeep` short of the fresh map's, or of the
 * band's deepest corner along the sun where that is nearer (one-sided: a held light nearer the slice only deepens its
 * map), else `deep`; **the near side**, the held light no more than `coverHigh` nearer the slice than the fresh fit, else
 * `high`; **across the light**, every corner inside the held box with `coverMargin` to spare, or as much as the fresh box
 * gives that corner where that is less, else `cover`. A fresh fit always passes.
 */
export function holdCoversIn(q: CoverQuery, tune: ShadowPassTune = SHADOW_PASS_TUNE): ShadowReason | '' {
  const half = q.num[0];
  const heldDepth = q.num[1];
  const freshDepth = q.num[2];
  const far = q.num[3];
  const s = q.sun;
  const cs = q.corners;
  let bandMin = Number.POSITIVE_INFINITY;
  for (let k = 0; k < 8; k++) {
    const c = cs[k];
    const along = c.x * s.x + c.y * s.y + c.z * s.z;
    if (along < bandMin) bandMin = along;
  }
  const freshDeep = freshDepth - far;
  const needDeep = freshDeep > bandMin ? freshDeep : bandMin;
  if (heldDepth - far - needDeep > tune.coverDeep) return 'deep';
  if (freshDepth - heldDepth > tune.coverHigh) return 'high';
  const h = q.heldInv.elements;
  const f = q.freshInv.elements;
  const margin = tune.coverMargin;
  for (let k = 0; k < 8; k++) {
    const c = cs[k];
    const hx = h[0] * c.x + h[4] * c.y + h[8] * c.z + h[12];
    const hy = h[1] * c.x + h[5] * c.y + h[9] * c.z + h[13];
    const fx = f[0] * c.x + f[4] * c.y + f[8] * c.z + f[12];
    const fy = f[1] * c.x + f[5] * c.y + f[9] * c.z + f[13];
    const held = half - (Math.abs(hx) > Math.abs(hy) ? Math.abs(hx) : Math.abs(hy));
    const fresh = half - (Math.abs(fx) > Math.abs(fy) ? Math.abs(fx) : Math.abs(fy));
    if (held < (margin < fresh ? margin : fresh)) return 'cover';
  }
  return '';
}

const positional = new CoverQuery();
/** `holdCoversIn` with its numbers in the design's order: for the tests and the console. */
export function holdCovers(corners: readonly THREE.Vector3[], heldInv: THREE.Matrix4, freshInv: THREE.Matrix4, half: number, sunDir: THREE.Vector3, heldDepth: number, freshDepth: number, far: number, tune: ShadowPassTune = SHADOW_PASS_TUNE): ShadowReason | '' {
  for (let k = 0; k < 8; k++) positional.corners[k].copy(corners[k]);
  positional.heldInv.copy(heldInv);
  positional.freshInv.copy(freshInv);
  positional.sun.copy(sunDir);
  positional.num[0] = half;
  positional.num[1] = heldDepth;
  positional.num[2] = freshDepth;
  positional.num[3] = far;
  return holdCoversIn(positional, tune);
}

/** Whether a held light's direction is further than `stepDeg` from the direction now. */
export function sunMoved(heldDir: THREE.Vector3, nowDir: THREE.Vector3, stepDeg: number): boolean {
  const la = heldDir.length();
  const lb = nowDir.length();
  if (!(la > 0) || !(lb > 0)) return true;
  const cos = (heldDir.x * nowDir.x + heldDir.y * nowDir.y + heldDir.z * nowDir.z) / (la * lb);
  return cos < Math.cos((stepDeg * Math.PI) / 180);
}

/** `sunMoved` with the step read off the tune, for a frame (no number handed across a call). */
function sunMovedIn(heldDir: THREE.Vector3, nowDir: THREE.Vector3, tune: ShadowPassTune): boolean {
  const la = Math.sqrt(heldDir.x * heldDir.x + heldDir.y * heldDir.y + heldDir.z * heldDir.z);
  const lb = Math.sqrt(nowDir.x * nowDir.x + nowDir.y * nowDir.y + nowDir.z * nowDir.z);
  if (!(la > 0) || !(lb > 0)) return true;
  const cos = (heldDir.x * nowDir.x + heldDir.y * nowDir.y + heldDir.z * nowDir.z) / (la * lb);
  return cos < Math.cos((tune.sunStepDeg * Math.PI) / 180);
}

/**
 * Whether a mover could cast into a band (`near` to `far` along the view): its shadow's reach along the ground,
 * `(max(y - ground, 0) + r) / sunTan` capped at `cap` (the shadow camera's range), the ground unknown (NaN) taken as the
 * cap; the band met when its distance along the view less the reach and its radius is short of the band's far end and
 * that distance plus them is past its near end. Conservative across the view (it does not ask the frustum's sides),
 * exact enough along it, which is where a rider's own shadow and a far map's band are told apart.
 */
export function moverReaches(x: number, y: number, z: number, r: number, ground: number, cam: THREE.Vector3, fwd: THREE.Vector3, sunTan: number, near: number, far: number, cap: number): boolean {
  const m = scratchMovers;
  m.x[0] = x;
  m.y[0] = y;
  m.z[0] = z;
  m.r[0] = r;
  m.ground[0] = ground;
  const v = scratchView;
  v.at.copy(cam);
  v.fwd.copy(fwd);
  v.num[SUNTAN] = sunTan;
  v.num[CAP] = cap;
  v.band[0] = near;
  v.band[1] = far;
  return moverReachesBand(m, 0, v);
}

// ---------------------------------------------------------------------------------------------------------------------
// The movers.

/** How many movers a frame lists at most: past it the rest are not listed (the console says so). */
export const MOVERS_MOST = 64;

/**
 * This frame's fast movers (anything listed moving faster than `fastMover`): where each stands, its radius, the cached
 * ground under it (NaN where no cached block answers), its speed, and the cascades it reached as a bit each. Filled once a
 * frame by the game, after the shuttles are posed and before `decide`; every source writes a slot it `take`s.
 */
export class ShadowMovers {
  n = 0;
  /** Movers the frame would have listed past `MOVERS_MOST`. */
  over = 0;
  readonly x = new Float64Array(MOVERS_MOST);
  readonly y = new Float64Array(MOVERS_MOST);
  readonly z = new Float64Array(MOVERS_MOST);
  readonly r = new Float64Array(MOVERS_MOST);
  readonly ground = new Float64Array(MOVERS_MOST);
  readonly speed = new Float64Array(MOVERS_MOST);
  readonly reached = new Uint8Array(MOVERS_MOST);
  /** The frame's step in seconds, for a source that works its speed out from its last place (a stood shuttle's joint). */
  readonly dt = new Float64Array(1);
  /**
   * The physics steps the vehicles' places stand at this frame: the step count as the vehicles copied their bodies'
   * places, which the game writes in `stepVehicles` before the frame's own physics step (a body moves only on whole
   * sixtieths of a second, so a hull's speed from its place is timed in the steps it really took, never in frames).
   */
  readonly steps = new Float64Array(1);
  /** What each slot is, for the console: a vehicle, a shuttle, a ride or a figure. */
  readonly kind: string[] = new Array<string>(MOVERS_MOST).fill('');

  /** Empty for this frame (the caller writes the frame's step into `dt[0]`, so no number crosses a call). */
  begin(): void {
    this.n = 0;
    this.over = 0;
  }

  /** The next slot to write, or -1 when the list is full. */
  take(): number {
    if (this.n >= MOVERS_MOST) {
      this.over++;
      return -1;
    }
    const i = this.n++;
    this.ground[i] = Number.NaN;
    this.reached[i] = 0;
    return i;
  }
}

/**
 * Whether mover `j` reaches the band in `v`: `moverReaches`'s arithmetic, read off the kept arrays (every number a frame
 * reads stays in a typed array, so nothing is boxed on its way into a call the engine did not build in).
 */
function moverReachesBand(m: ShadowMovers, j: number, v: ShadowView): boolean {
  const num = v.num;
  const cap = num[CAP];
  const sunTan = num[SUNTAN];
  const y = m.y[j];
  const ground = m.ground[j];
  const r = m.r[j];
  let reach = cap;
  if (ground === ground && sunTan > 0) {
    const h = y - ground;
    reach = ((h > 0 ? h : 0) + r) / sunTan;
    if (!(reach < cap)) reach = cap;
  }
  const d = (m.x[j] - v.at.x) * v.fwd.x + (y - v.at.y) * v.fwd.y + (m.z[j] - v.at.z) * v.fwd.z;
  const span = reach + r;
  return d - span < v.band[1] && d + span > v.band[0];
}

const scratchMovers = new ShadowMovers();
const scratchView = new ShadowView();

/**
 * The ground under each listed mover, written into its slot, NaN where `ground` answers nothing (no cached block and no
 * far grid under it; `moverReaches` then takes the reach as the cap). `ground` is the world's cached ground
 * (`World.groundAtCached`, which never makes a block and, since this wave, never builds a key for a far grid either);
 * the walk itself makes nothing, and what a terrain read costs is the terrain's, as every read of it is.
 */
export function moverGroundInto(out: ShadowMovers, ground: (x: number, z: number) => number | null): void {
  for (let j = 0; j < out.n; j++) {
    const g = ground(out.x[j], out.z[j]);
    out.ground[j] = g === null ? Number.NaN : g;
  }
}

// The three sources a frame's movers are listed from, each a pure walk over records of the shapes the game keeps, so a
// node test runs the very rules the world, the shuttles and the peers run (`shadowMovers.test.ts`).

/** A vehicle as the movers' list reads it: where its group stands, whether it is shown, its own speed and radius. */
export interface VehicleMoverSource {
  readonly group: { readonly position: THREE.Vector3; readonly visible: boolean };
  readonly speed: number;
  readonly radius: number;
  readonly disposed: boolean;
  /** Something writes its pose every frame (a landing, a dock, a carrier, a jump: `Vehicle.hold`), so it moves on frames rather than on the physics' steps. */
  readonly holding: boolean;
}

/** Indices into a vehicle's kept record: its last place, whether known, the step count then, and the speed its places last gave. */
const AT_X = 0;
const AT_Y = 1;
const AT_Z = 2;
const AT_KNOWN = 3;
const AT_STEPS = 4;
const AT_SPEED = 5;

/**
 * The world's vehicles faster than `fastMover`: by each hull's own `speed` or, where that is larger, the speed its own
 * places give (a hull whose pose is written for it, a shuttle trip's on its clips or a run's, carries no speed of its
 * own), its place and radius. A body moves only on whole sixtieths of a second and a hull's group copies its body's place
 * before the frame's physics step, so the distance it went since the last frame is timed in the physics steps between
 * the two places (`out.steps`), never in the frame's own step: timed in frames, a hull at 10 m/s read 24 m/s on the frames
 * a 144 Hz frame took a step and was listed on 4 frames in 10. A frame that saw no step keeps the speed the last step
 * gave, and a step that moved it nowhere says it stands; a hull whose pose is written every frame (`holding`), or moved
 * with no step seen, is timed in the frame's step. `last` keeps each hull's record; a hull's first is the one thing made.
 */
export function listVehicleMovers(out: ShadowMovers, list: readonly VehicleMoverSource[], last: WeakMap<object, Float64Array>): void {
  const dt = out.dt[0];
  const steps = out.steps[0];
  const fast = SHADOW_PASS_TUNE.fastMover;
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    if (v.disposed) continue;
    const p = v.group.position;
    let at = last.get(v);
    if (!at) {
      at = new Float64Array(6);
      last.set(v, at);
    }
    let pose = 0;
    if (at[AT_KNOWN] === 1) {
      const dx = p.x - at[AT_X];
      const dy = p.y - at[AT_Y];
      const dz = p.z - at[AT_Z];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const stepped = steps - at[AT_STEPS];
      if (v.holding) pose = dt > 0 ? d / dt : 0;
      else if (stepped > 0) pose = d / (stepped * FIXED_DT);
      else if (d > 0) pose = dt > 0 ? d / dt : 0;
      else pose = at[AT_SPEED];
    }
    at[AT_X] = p.x;
    at[AT_Y] = p.y;
    at[AT_Z] = p.z;
    at[AT_KNOWN] = 1;
    at[AT_STEPS] = steps;
    at[AT_SPEED] = pose;
    let speed = v.speed < 0 ? -v.speed : v.speed;
    if (pose > speed) speed = pose;
    if (!v.group.visible || !(speed > fast)) continue;
    const j = out.take();
    if (j < 0) return;
    out.x[j] = p.x;
    out.y[j] = p.y;
    out.z[j] = p.z;
    out.r[j] = v.radius;
    out.speed[j] = speed;
    out.kind[j] = 'vehicle';
  }
}

/** A stood shuttle as the movers' list reads it (`ShuttleRigs`' record). */
export interface ShuttleMoverSource {
  shown: boolean;
  role: string;
  body: THREE.Object3D;
  radius: number;
  moverAt: Float64Array;
  moverKnown: boolean;
}

/**
 * A stood shuttle in flight: shown and not in its `ground` role, its body joint's place worked out from its parents now
 * (`updateWorldMatrix(true, false)`: posed by its mixer after the frame's last walk), its speed from that place against
 * last frame's, listed when faster than `fastMover` with twice its biggest piece's half-diagonal as its radius; one on
 * its pad or not shown writes nothing and forgets its last place.
 */
export function listShuttleMover(out: ShadowMovers, s: ShuttleMoverSource): void {
  if (!s.shown || s.role === 'ground') {
    s.moverKnown = false;
    return;
  }
  s.body.updateWorldMatrix(true, false);
  const e = s.body.matrixWorld.elements;
  const a = s.moverAt;
  const known = s.moverKnown;
  const dx = e[12] - a[0];
  const dy = e[13] - a[1];
  const dz = e[14] - a[2];
  a[0] = e[12];
  a[1] = e[13];
  a[2] = e[14];
  s.moverKnown = true;
  const dt = out.dt[0];
  if (!known || !(dt > 0)) return;
  const speed = Math.sqrt(dx * dx + dy * dy + dz * dz) / dt;
  if (!(speed > SHADOW_PASS_TUNE.fastMover)) return;
  const j = out.take();
  if (j < 0) return;
  out.x[j] = e[12];
  out.y[j] = e[13];
  out.z[j] = e[14];
  out.r[j] = 2 * s.radius;
  out.speed[j] = speed;
  out.kind[j] = 'shuttle';
}

/** Another player as the movers' list reads them (`RemotePlayers`' record): their figure and the picture of their ride. */
export interface PeerMoverSource {
  readonly group: { readonly visible: boolean; readonly position: THREE.Vector3 };
  readonly vel: THREE.Vector3;
  readonly vehicle: { readonly obj: THREE.Object3D | null; readonly reckoned: boolean; readonly sentVel: THREE.Vector3; readonly vel: THREE.Vector3; readonly size: { readonly radius: number } | null } | null;
}

/**
 * A shown peer: their figure by the relay's velocity (a friend swinging on a rope at 35 m/s counts), a metre across; their
 * ride by the velocity their game sent while its picture is reckoned, else the relay's, its picture's own radius; each
 * listed only while faster than `fastMover`.
 */
export function listPeerMover(out: ShadowMovers, r: PeerMoverSource): void {
  if (!r.group.visible) return;
  const fast = SHADOW_PASS_TUNE.fastMover;
  const f = r.vel;
  const fs = Math.sqrt(f.x * f.x + f.y * f.y + f.z * f.z);
  if (fs > fast) {
    const j = out.take();
    if (j >= 0) {
      const p = r.group.position;
      out.x[j] = p.x;
      out.y[j] = p.y;
      out.z[j] = p.z;
      out.r[j] = 1;
      out.speed[j] = fs;
      out.kind[j] = 'figure';
    }
  }
  const rv = r.vehicle;
  if (!rv || !rv.obj) return;
  const v = rv.reckoned ? rv.sentVel : rv.vel;
  const vs = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  if (!(vs > fast)) return;
  const j = out.take();
  if (j < 0) return;
  const p = rv.obj.position;
  out.x[j] = p.x;
  out.y[j] = p.y;
  out.z[j] = p.z;
  out.r[j] = rv.size ? rv.size.radius : 2;
  out.speed[j] = vs;
  out.kind[j] = 'ride';
}

// ---------------------------------------------------------------------------------------------------------------------
// The decision.

/** The cascades' state a decision reads: when each map was drawn, whether it has one and a pose, dirty, and the guards' answers. Kept. */
export class CascadeClock {
  n = 3;
  readonly now = new Float64Array(1);
  readonly drawnAt = new Float64Array(CASCADES_MOST);
  readonly valid = new Uint8Array(CASCADES_MOST);
  readonly hasMap = new Uint8Array(CASCADES_MOST);
  readonly dirty = new Uint8Array(CASCADES_MOST);
  /** Each cascade's guard refusal this frame ('' for none, or not asked). */
  readonly guard: (ShadowReason | '')[] = ['', '', '', ''];
}

/**
 * Which cascades are drawn this frame, into `out` by reason, answering how many: one with no record or no map
 * (`first`), one made dirty (`dirty`), every cascade with `cadence` off or an age of nought (`age`, never staggered), one
 * a guard refused (its reason), one whose map would be shown at its age or older (`age`), else `held`. Then the
 * stagger: of the cascades after the first due by age alone with an age above nought, at most one is drawn, the one
 * whose map is older, the others held a frame; a dirty or refused cascade is never held back.
 */
export function dueCascades(s: CascadeClock, now: number, tune: ShadowPassTune, out: ShadowReason[]): number {
  s.now[0] = now;
  return dueIn(s, tune, out);
}

function dueIn(s: CascadeClock, tune: ShadowPassTune, out: ShadowReason[]): number {
  const now = s.now[0];
  const ages = tune.maxAgeMs;
  for (let i = 0; i < s.n; i++) {
    const limit = i < ages.length ? ages[i] : 0;
    let r: ShadowReason;
    if (!s.valid[i] || !s.hasMap[i]) r = 'first';
    else if (s.dirty[i]) r = 'dirty';
    else if (!tune.cadence || !(limit > 0)) r = 'age';
    else if (s.guard[i] !== '') r = s.guard[i] as ShadowReason;
    else if (now - s.drawnAt[i] >= limit) r = 'age';
    else r = 'held';
    out[i] = r;
  }
  if (tune.cadence && tune.stagger) {
    let keep = -1;
    for (let i = 1; i < s.n; i++) {
      if (out[i] !== 'age' || !(i < ages.length && ages[i] > 0) || !s.valid[i] || !s.hasMap[i] || s.dirty[i]) continue;
      if (keep < 0) keep = i;
      else if (s.drawnAt[i] < s.drawnAt[keep]) {
        out[keep] = 'held';
        keep = i;
      } else out[i] = 'held';
    }
  }
  let count = 0;
  for (let i = 0; i < s.n; i++) if (out[i] !== 'held') count++;
  return count;
}

/**
 * The light frame a shadow camera at `pos` looking at `target` stands in, inverted, into `out`: three's camera `lookAt`
 * with the world's up (its axes, and its nudge where the view runs straight up or down), the place, then the inverse of a
 * turn and a place, which is the turn's transpose and the place carried back through it. Written out rather than
 * `Matrix4.lookAt`, `setPosition` and `invert`, because `lookAt`'s `normalize` hands its length across a call the
 * compiler does not build in, which made a number on every guarded cascade every frame.
 */
function lookInverse(pos: THREE.Vector3, target: THREE.Vector3, out: THREE.Matrix4): void {
  // z: from the target to the eye.
  let zx = pos.x - target.x;
  let zy = pos.y - target.y;
  let zz = pos.z - target.z;
  let zl = zx * zx + zy * zy + zz * zz;
  if (zl === 0) {
    zz = 1;
    zl = 1;
  }
  let k = 1 / Math.sqrt(zl);
  zx *= k;
  zy *= k;
  zz *= k;
  // x: up (0, 1, 0) across z.
  let xx = zz;
  let xy = 0;
  let xz = -zx;
  let xl = xx * xx + xz * xz;
  if (xl === 0) {
    // The view runs straight along up: three nudges z along its own z and tries again.
    zz += 0.0001;
    k = 1 / Math.sqrt(zx * zx + zy * zy + zz * zz);
    zx *= k;
    zy *= k;
    zz *= k;
    xx = zz;
    xy = 0;
    xz = -zx;
    xl = xx * xx + xz * xz;
  }
  k = xl > 0 ? 1 / Math.sqrt(xl) : 1;
  xx *= k;
  xy *= k;
  xz *= k;
  // y: z across x.
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const te = out.elements;
  te[0] = xx;
  te[4] = xy;
  te[8] = xz;
  te[12] = -(xx * pos.x + xy * pos.y + xz * pos.z);
  te[1] = yx;
  te[5] = yy;
  te[9] = yz;
  te[13] = -(yx * pos.x + yy * pos.y + yz * pos.z);
  te[2] = zx;
  te[6] = zy;
  te[10] = zz;
  te[14] = -(zx * pos.x + zy * pos.y + zz * pos.z);
  te[3] = 0;
  te[7] = 0;
  te[11] = 0;
  te[15] = 1;
}

const tmpDir = new THREE.Vector3();
const tmpOff = new THREE.Vector3();

/** What a CSM is to the hold: its breaks and the way its light points. */
export interface HoldCsm {
  breaks: readonly number[];
  maxFar: number;
  lightDirection: THREE.Vector3;
}

/**
 * The cascades' holds: per cascade where its map was drawn from and when, dirty or not, and why it was drawn last; the
 * view the guards read; what the console reports. `decide` after `csm.update()` and before `refreshCascadeBoxes`; `drawn`
 * after each shadow pass (the portal renderer's hooks); `dirtyAll` for the world's own events.
 */
export class ShadowHold {
  /** The lights it holds (the CSM's, handed over as it is made). */
  lights: readonly THREE.DirectionalLight[] = [];
  readonly clock = new CascadeClock();
  readonly view = new ShadowView();
  /** Where each cascade's light and target stood when its map was drawn. */
  readonly pos: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  readonly tgt: THREE.Vector3[] = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  /** Each cascade's decision this frame. */
  readonly reason: ShadowReason[] = ['first', 'first', 'first', 'first'];
  /** Whether each is held this frame. */
  readonly held = new Uint8Array(CASCADES_MOST);
  /** Each held cascade's light off this frame's fit: metres across the light, and along the sun (+ toward it). */
  readonly offset = new Float64Array(CASCADES_MOST * 2);
  private readonly cover = new CoverQuery();
  /** Decisions made, for the console and the tests. */
  decisions = 0;
  /** Holds a guard refused this frame (the frame report's `holds refused`). */
  refusedNow = 0;
  // The rolling second the console reads: draws a cascade, decisions by reason, and frames.
  private windowFrom = Number.NaN;
  private windowFrames = 0;
  private readonly windowDraws = new Uint32Array(CASCADES_MOST);
  private readonly windowReasons = new Uint32Array(SHADOW_REASONS.length);
  /** Draws a second by cascade, decisions a second by reason, and frames a second, over the last whole second. */
  readonly drawsPerSecond = new Float64Array(CASCADES_MOST);
  readonly reasonsPerSecond = new Float64Array(SHADOW_REASONS.length);
  readonly framesPerSecond = new Float64Array(1);

  /** The lights it holds, from now on. */
  bind(lights: readonly THREE.DirectionalLight[]): void {
    this.lights = lights;
    this.clock.n = Math.min(CASCADES_MOST, lights.length);
  }

  /**
   * This frame's decision, after `csm.update()` has fitted every light to the view and before anything reads a cascade:
   * the guards worked out for every cascade that could be held, `dueCascades`, then each light's `autoUpdate` written
   * (true for a cascade drawn this frame, which also gets `needsUpdate` so `drawn` can tell it was drawn; false for one
   * held, whose light and target are put back where its map was drawn from). Answers how many cascades are drawn.
   */
  decide(lights: readonly THREE.DirectionalLight[], csm: HoldCsm, camera: THREE.PerspectiveCamera, now: number, movers: ShadowMovers | null): number {
    if (lights !== this.lights) this.bind(lights);
    const t = SHADOW_PASS_TUNE;
    const c = this.clock;
    c.now[0] = now;
    const v = this.view;
    const e = camera.matrixWorld.elements;
    // Every length worked out here, never through `normalize`, which hands it across a call (see `lookInverse`).
    v.at.x = e[12];
    v.at.y = e[13];
    v.at.z = e[14];
    const fl = Math.sqrt(e[8] * e[8] + e[9] * e[9] + e[10] * e[10]);
    const fk = fl > 0 ? -1 / fl : 0;
    v.fwd.x = e[8] * fk;
    v.fwd.y = e[9] * fk;
    v.fwd.z = e[10] * fk;
    const p = camera.projectionMatrix.elements;
    v.num[TANX] = 1 / p[0];
    v.num[TANY] = 1 / p[5];
    v.num[NEAR] = camera.near;
    v.num[FAR] = camera.far < csm.maxFar ? camera.far : csm.maxFar;
    const ld = csm.lightDirection;
    const sl = Math.sqrt(ld.x * ld.x + ld.y * ld.y + ld.z * ld.z);
    const sk = sl > 0 ? -1 / sl : 0;
    v.sun.x = ld.x * sk;
    v.sun.y = ld.y * sk;
    v.sun.z = ld.z * sk;
    const hz = Math.sqrt(v.sun.x * v.sun.x + v.sun.z * v.sun.z);
    v.num[SUNTAN] = hz > 1e-6 ? v.sun.y / hz : 1e6;
    if (movers) for (let j = 0; j < movers.n; j++) movers.reached[j] = 0;
    const ages = t.maxAgeMs;
    for (let i = 0; i < c.n; i++) {
      const l = lights[i];
      c.hasMap[i] = l.shadow.map !== null ? 1 : 0;
      c.guard[i] = '';
      this.offset[i * 2] = 0;
      this.offset[i * 2 + 1] = 0;
      const limit = i < ages.length ? ages[i] : 0;
      if (!t.cadence || !(limit > 0) || !c.valid[i] || !c.hasMap[i] || c.dirty[i]) continue;
      c.guard[i] = this.guard(i, l, csm, camera, movers);
    }
    const drawn = dueIn(c, t, this.reason);
    let refused = 0;
    for (let i = 0; i < c.n; i++) {
      const l = lights[i];
      const s = l.shadow;
      if (c.guard[i] !== '' && this.reason[i] === c.guard[i]) refused++;
      if (this.reason[i] === 'held') {
        s.autoUpdate = false;
        s.needsUpdate = false;
        l.position.copy(this.pos[i]);
        l.target.position.copy(this.tgt[i]);
        this.held[i] = 1;
      } else {
        s.autoUpdate = true;
        s.needsUpdate = true;
        this.held[i] = 0;
      }
      this.windowReasons[REASON_INDEX[this.reason[i]]]++;
    }
    this.refusedNow = refused;
    this.decisions++;
    this.roll(now);
    return drawn;
  }

  /** One cascade's guards: the sun, the band's cover across the light and in depth, then the fast movers. */
  private guard(i: number, l: THREE.DirectionalLight, csm: HoldCsm, camera: THREE.PerspectiveCamera, movers: ShadowMovers | null): ShadowReason | '' {
    const t = SHADOW_PASS_TUNE;
    const v = this.view;
    const pos = this.pos[i];
    const tgt = this.tgt[i];
    tmpDir.subVectors(tgt, pos);
    if (sunMovedIn(tmpDir, csm.lightDirection, t)) return 'sun';
    bandInto(csm.breaks, v, i);
    const q = this.cover;
    bandCornersInto(camera.matrixWorld, v, q.corners);
    lookInverse(l.position, l.target.position, q.freshInv);
    lookInverse(pos, tgt, q.heldInv);
    q.sun.copy(v.sun);
    const s = v.sun;
    const cam = l.shadow.camera;
    q.num[0] = cam.right;
    q.num[1] = pos.x * s.x + pos.y * s.y + pos.z * s.z;
    q.num[2] = l.position.x * s.x + l.position.y * s.y + l.position.z * s.z;
    q.num[3] = cam.far;
    v.num[CAP] = cam.far;
    // How far the held light stands off this frame's fit, for the console.
    tmpOff.subVectors(pos, l.position);
    const along = tmpOff.x * s.x + tmpOff.y * s.y + tmpOff.z * s.z;
    const across2 = tmpOff.lengthSq() - along * along;
    this.offset[i * 2] = across2 > 0 ? Math.sqrt(across2) : 0;
    this.offset[i * 2 + 1] = along;
    const r = holdCoversIn(q, t);
    if (r !== '') return r;
    if (movers) {
      let met = false;
      for (let j = 0; j < movers.n; j++) {
        if (!moverReachesBand(movers, j, v)) continue;
        movers.reached[j] |= 1 << i;
        met = true;
      }
      if (met) return 'mover';
    }
    return '';
  }

  /**
   * After a shadow pass, or a frame with none: each cascade three drew (asked by `decide` and its `needsUpdate` cleared
   * by three, or asked and drawn by a draw no `decide` preceded) records the pose it was drawn from and when; one asked
   * and not drawn (a pass that stopped before it) is made dirty. A frame with no shadow pass (`drewPass` false) and a
   * whole draw outside a frame (`whole`, `drawShadowsOnly`) make every cascade dirty.
   */
  drawn(lights: readonly THREE.DirectionalLight[], drewPass: boolean, whole: boolean): void {
    if (lights !== this.lights) this.bind(lights);
    if (!drewPass || whole) {
      this.dirtyAll();
      return;
    }
    const c = this.clock;
    for (let i = 0; i < c.n; i++) {
      const l = lights[i];
      const s = l.shadow;
      if (!s.autoUpdate) continue;
      if (s.needsUpdate || s.map === null) {
        c.dirty[i] = 1;
        continue;
      }
      this.pos[i].copy(l.position);
      this.tgt[i].copy(l.target.position);
      c.valid[i] = 1;
      c.dirty[i] = 0;
      c.drawnAt[i] = c.now[0];
      this.windowDraws[i]++;
    }
  }

  /** Every cascade drawn wherever the next draw comes from: dirty, and every light's `autoUpdate` true. */
  dirtyAll(): void {
    const c = this.clock;
    for (let i = 0; i < c.n; i++) {
      c.dirty[i] = 1;
      const l = this.lights[i];
      if (l) l.shadow.autoUpdate = true;
    }
  }

  /** The rolling second: counts turned into rates once a second has gone by. */
  private roll(now: number): void {
    if (!(this.windowFrom === this.windowFrom)) this.windowFrom = now;
    this.windowFrames++;
    const span = now - this.windowFrom;
    if (span < 1000) return;
    const k = 1000 / span;
    for (let i = 0; i < CASCADES_MOST; i++) {
      this.drawsPerSecond[i] = this.windowDraws[i] * k;
      this.windowDraws[i] = 0;
    }
    for (let i = 0; i < SHADOW_REASONS.length; i++) {
      this.reasonsPerSecond[i] = this.windowReasons[i] * k;
      this.windowReasons[i] = 0;
    }
    this.framesPerSecond[0] = this.windowFrames * k;
    this.windowFrames = 0;
    this.windowFrom = now;
  }

  /** For the console: each cascade's age now and its limit, how often it was drawn a second, held or not and why, its offset. */
  report(now: number): { frameRate: number; cascades: { age: number; limit: number; perSecond: number; held: boolean; reason: ShadowReason; offAcross: number; offAlong: number }[]; refusedPerSecond: Record<string, number> } {
    const c = this.clock;
    const r1 = (x: number) => Number(x.toFixed(1));
    const cascades = [];
    for (let i = 0; i < c.n; i++) {
      cascades.push({ age: c.valid[i] ? r1(now - c.drawnAt[i]) : -1, limit: SHADOW_PASS_TUNE.maxAgeMs[i] ?? 0, perSecond: r1(this.drawsPerSecond[i]), held: this.held[i] === 1, reason: this.reason[i], offAcross: r1(this.offset[i * 2]), offAlong: r1(this.offset[i * 2 + 1]) });
    }
    const refusedPerSecond: Record<string, number> = {};
    for (const k of ['cover', 'deep', 'high', 'sun', 'mover', 'dirty', 'first'] as const) refusedPerSecond[k] = r1(this.reasonsPerSecond[REASON_INDEX[k]]);
    return { frameRate: r1(this.framesPerSecond[0]), cascades, refusedPerSecond };
  }
}
