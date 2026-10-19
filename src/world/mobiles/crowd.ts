// The crowd's drawing thinned by how much of the screen each body covers -- the original client's own measure, the share
// of the screen's height a body takes up (its executable's `lod1-3ScreenFraction`, `noSkinningScreenFraction` and
// `noRenderScreenFraction`) -- and the two exact costs of drawing people that change nothing on screen: the meshes that
// draw nothing at all (a body part wholly under clothes) and the bodies listed for the motion blur though nothing drew them.
//
// What thins how a body looks is the owner's (CLAUDE.md, "Feel is the owner's"): every number in `CROWD_TUNE` that does is
// a live knob with its reason beside it, moved through `tuneCrowd` by `__debug.crowd({ tune })` and the debug menu's
// sliders (`crowdDials.ts`) alike, and nothing here was chosen by measuring. Metres stay for the simulation's own
// decisions (`LOD_TUNE.sleep`, `thinkNear`): the share is only ever how a body is drawn.
//
// Pure, and run by node with type stripping for the tests: value imports carry `.ts`, no enum, no namespace, no
// constructor parameter property.
import * as THREE from 'three';
import { frameOf } from '../bodyCull.ts';
import type { LodInput } from './lod.ts';

/**
 * Every number of ours here, each with why it starts where it does. The shares are of the drawing buffer's height (the
 * same fraction of the frustum's height at the body's distance), so aiming's zoom and the window's shape count.
 */
export const CROWD_TUNE = {
  /**
   * A body covering less than this share of the screen's height hides its small parts. 3% is a 1.8 m figure about 52 m
   * off at the game's 60-degree view (1.56 / d), where an eye or a buckle is a couple of pixels. The owner's eye.
   */
  smallShare: 0.03,
  /**
   * ...and shows them again only above `smallShare` times this, so a body pacing at the line (a patroller, a post's
   * step about) does not blink its eyes and buckles on and off. The gap that stops the blinking.
   */
  smallBand: 1.2,
  /** A "small part" has fewer triangles than this... */
  smallTris: 96,
  /** ...and a bounding radius on the body under this, metres: eyes, teeth, badges, buckles. */
  smallSize: 0.12,
  /**
   * Under this share a body whose root is standing still holds its pose (the client's "no skinning", kept to bodies
   * standing still so no foot slides: a far walker keeps animating at its tier's rate). 0 is off, where it starts.
   */
  holdShare: 0,
  /**
   * Metres: a root that stays within this of where it last came to rest, for `holdAfter` seconds, counts as standing
   * still for `holdShare`; moving further starts the wait again from where it now stands. A millimetre: a body the
   * physics has put to rest moves less, and the slowest walk moves more in one physics step.
   */
  holdStill: 0.001,
  /**
   * Seconds a root must stay within `holdStill` of one place to count as standing still. Judged over time and never
   * from one frame to the next: the physics moves a body only on whole sixtieths of a second, so at 144 frames a
   * second a walker shows no movement on most frames, and a frame's own measure would hold its pose on them and slide
   * its feet. A quarter second is several physics steps (the floor of its range, 0.05 s, is three, the most one frame
   * takes), so a walker never counts as still at any frame rate, and one that stops holds a quarter second later. Put as
   * a speed, a root slower than `holdStill / holdAfter` counts as standing (4 mm a second as shipped).
   */
  holdAfter: 0.25,
  /** Under this share a body is not drawn, still simulated and still shootable (the client's "no render"). 0 is off. */
  goneShare: 0,
  /**
   * Seconds: the slowest a body this browser keeps for a server may think, since its keeper's decisions are everybody's.
   * The tiers' own rate for the rest (`LOD_TUNE.think[1]`), where a body kept here otherwise thinks every 1.5 s frozen.
   */
  sharedThink: 0.4,
};

export type CrowdTune = typeof CROWD_TUNE;

/** What the tiers read of the crowd's numbers (`lodTier`). */
export type CrowdLod = Pick<CrowdTune, 'holdShare' | 'goneShare' | 'sharedThink'>;

/** The range each number is held to; a value past it is held at the edge, and said. */
const RANGES: Record<keyof CrowdTune, readonly [number, number]> = {
  smallShare: [0, 1],
  smallBand: [1, 4],
  smallTris: [0, 1_000_000],
  smallSize: [0, 10],
  holdShare: [0, 1],
  holdStill: [0, 1],
  holdAfter: [0.05, 5],
  goneShare: [0, 1],
  sharedThink: [0.05, 10],
};

/**
 * Which meshes count as a body's small parts moves with `smallTris` and `smallSize`; this counts how many times either
 * has been moved, so every body lists its small parts again on the manager's next pass, whichever of the console and a
 * slider moved it.
 */
export const CROWD_PARTS = { version: 0 };

/**
 * Move `CROWD_TUNE` in place: a name it does not hold is refused, a value that is not a number refused, one past its
 * range held at the edge, each said in words. Answers the words (none when everything took).
 */
export function tuneCrowd(patch: Partial<Record<keyof CrowdTune, unknown>> | null | undefined): string[] {
  const words: string[] = [];
  const t = CROWD_TUNE as unknown as Record<string, number>;
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!Object.hasOwn(CROWD_TUNE, key)) {
      words.push(`no number called ${key}`);
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      words.push(`${key} takes a number`);
      continue;
    }
    const [lo, hi] = RANGES[key as keyof CrowdTune];
    const n = Math.min(hi, Math.max(lo, value));
    if (n !== value) words.push(`${key} held to ${lo} to ${hi}: ${n}`);
    if ((key === 'smallTris' || key === 'smallSize') && t[key] !== n) CROWD_PARTS.version++;
    t[key] = n;
  }
  return words;
}

/**
 * The three exact switches the frame report compares (`perf({ ab: { key } })`), each first value the old way: the meshes
 * that draw nothing kept off, only the bodies a pass drew listed for the motion blur, and the small parts hidden on a
 * body small on the screen (the last a look, the owner's, through `CROWD_TUNE`).
 */
export const CROWD_SWITCHES = { emptyMeshes: true, moverList: true, smallParts: true };

/**
 * What a share is worked out from at one camera: a body `h` metres tall `d` metres off covers `h * shareScale / d` of
 * the screen's height. `fovY` is the vertical field of view in degrees and `zoom` the camera's own, as three keeps them
 * on a `PerspectiveCamera` (its projection's top is `near * tan(fov / 2) / zoom`). Worked out once a frame.
 */
export function shareScale(fovY: number, zoom = 1): number {
  const half = Math.tan((fovY * Math.PI) / 360);
  if (!(half > 0) || !Number.isFinite(half)) return Number.POSITIVE_INFINITY;
  return (zoom > 0 ? zoom : 1) / (2 * half);
}

/**
 * The share of the screen's height a body `height` metres tall covers `dist` metres off the camera: its height over the
 * frustum's height there, `height * zoom / (2 * dist * tan(fovY / 2))`. A body on the eye covers everything.
 */
export function screenShare(height: number, dist: number, fovY: number, zoom = 1): number {
  if (!(dist > 1e-6)) return Number.POSITIVE_INFINITY;
  return (height * shareScale(fovY, zoom)) / dist;
}

/**
 * Whether a body's small parts are hidden now, from whether they were: hidden while its share is under `smallShare`,
 * shown again only above `smallShare * smallBand`, and never while it is engaged (shown the step it engages) or with
 * the switch off.
 */
export function smallPartsHidden(hidden: boolean, share: number, engaged: boolean, on: boolean, tune: Pick<CrowdTune, 'smallShare' | 'smallBand'> = CROWD_TUNE): boolean {
  if (!on || engaged) return false;
  if (hidden) return share <= tune.smallShare * tune.smallBand;
  return share < tune.smallShare;
}

/**
 * Whether a body is listed for the motion blur this frame: one the matrix walk stepped over as culled never (its meshes'
 * world matrices are not this frame's, and the blur would carry them as history), and otherwise one whose group is drawn
 * -- read once the effects run, after the passes, which keep a body no pass drew hidden through the effects -- or every
 * one with the list switch at the old way. One the walk stepped over as standing still is listed like any other: its
 * world matrices are the very ones a whole walk would have made this frame. A body that comes back into the list is a
 * record met for the first time, which blurs with the camera alone for its first frame.
 */
export function listsMover(visible: boolean, culledSkipped: boolean, drawnOnly: boolean): boolean {
  if (culledSkipped) return false;
  return !drawnOnly || visible;
}

// ---- the crowd's say on one body, each pass -------------------------------------------------------------------------

/**
 * What the manager keeps of one body for the crowd between its passes (`crowdInput` writes it): a class with every field
 * given its first value where it is declared, never an object literal. In node's measure of the crowd's frame, an
 * object literal of this shape made a new heap number of every `share` written (16 bytes a body a frame) where this
 * class makes none; and a field declared bare and set in a constructor starts as nothing (`undefined`), so its numbers
 * would never be held unboxed. `perf.test.ts` measures this very class.
 */
export class CrowdRecord {
  /** Its share of the screen's height at the last pass (a fraction from the start, so the field holds doubles). */
  share = 0.5;
  /** Where its root last came to rest: moved further than `holdStill` from it, the root comes to rest again where it is. */
  readonly restAt = new THREE.Vector3();
  /** When it came to rest there, on the manager's clock; NaN before its first pass. */
  restSince = Number.NaN;
  /** Whether the last pass judged it standing still (`LodInput.still`), for the console. */
  resting = false;
}

/** The shape `crowdInput` writes, which a `CrowdRecord` is and a test's own record may be. */
export type CrowdHeld = Pick<CrowdRecord, 'share' | 'restAt' | 'restSince' | 'resting'>;

/**
 * What one pass hands every body, written once at the top of the manager's update and never made: the camera's
 * `shareScale` (nought with no perspective camera, when nothing is thinned by its share) and the manager's clock. A
 * class for the reason `CrowdRecord` is one; both start as fractions and are written before any body reads them.
 */
export class CrowdView {
  shareK = 0.5;
  now = 0.5;
}

/** What the crowd reads of a body (a `Mobile`, or a stub in the tests). */
export interface CrowdBody {
  readonly plan: { readonly height: number };
  readonly pos: THREE.Vector3;
  readonly engaged: boolean;
  readonly keptForServer: boolean;
}

/**
 * The crowd's inputs to one body's tier, written into the manager's one `LodInput` (whose `dist` is already the camera's
 * to the body): its share of the screen's height, `screenShare`'s arithmetic at the view's own scale; whether it is in a
 * fight; whether this browser keeps it for a server; and whether its root is standing still, judged over `holdAfter`
 * seconds and never from one frame to the next (see `holdAfter`). Every number goes through a kept record, so nothing
 * crosses the call to be boxed.
 */
export function crowdInput(i: LodInput, body: CrowdBody, held: CrowdHeld, view: CrowdView, tune: Pick<CrowdTune, 'holdStill' | 'holdAfter'> = CROWD_TUNE): void {
  const d = i.dist;
  const k = view.shareK;
  const share = k > 0 && d > 1e-6 ? (body.plan.height * k) / d : Number.POSITIVE_INFINITY;
  held.share = share;
  i.share = share;
  i.engaged = body.engaged;
  i.shared = body.keptForServer;
  const now = view.now;
  const p = body.pos;
  const r = held.restAt;
  const s = tune.holdStill;
  // The distance written out, so no number is handed back across a call the engine might not build in (the house rule).
  const dx = p.x - r.x;
  const dy = p.y - r.y;
  const dz = p.z - r.z;
  // Moved past `holdStill` from where it came to rest, or never judged (NaN), or a clock that went back: at rest again here.
  if (!(held.restSince <= now) || dx * dx + dy * dy + dz * dz > s * s) {
    r.copy(p);
    held.restSince = now;
  }
  const still = now - held.restSince >= tune.holdAfter;
  held.resting = still;
  i.still = still;
}

// ---- a body's small parts -----------------------------------------------------------------------------------------

/** What the small parts' two calls read and write of a body (a `Mobile`, or a stub in the tests). */
export interface SmallPartsOwner {
  readonly meshes: readonly THREE.Mesh[];
  readonly emptyMeshes: readonly THREE.Mesh[];
  readonly smallMeshes: THREE.Mesh[];
  smallHidden: boolean;
  smallVersion: number;
}

/** A body's small parts hidden or shown again: each listed small part's `visible` the opposite of `hidden`, nothing else. */
export function hideSmallParts(body: SmallPartsOwner, hidden: boolean): void {
  if (body.smallHidden === hidden) return;
  body.smallHidden = hidden;
  const parts = body.smallMeshes;
  for (let i = 0; i < parts.length; i++) parts[i].visible = !hidden;
}

/**
 * A body's small parts listed again by the thresholds in force (`isSmallPart`), `frame` its inner group (null before its
 * model is hung, when it has none). The parts hidden now are shown first, so they are listed as what they are and not
 * taken for meshes the look itself hides; a mesh the look hides and one of its empties is never one; and whether they
 * were hidden is put back on the new list.
 */
export function relistSmallParts(body: SmallPartsOwner, frame: THREE.Object3D | null, scale: number, version: number, tune: Pick<CrowdTune, 'smallTris' | 'smallSize'> = CROWD_TUNE): void {
  const hidden = body.smallHidden;
  hideSmallParts(body, false);
  body.smallMeshes.length = 0;
  body.smallVersion = version;
  if (frame) {
    const meshes = body.meshes;
    for (let i = 0; i < meshes.length; i++) {
      const m = meshes[i];
      if (!m.visible || body.emptyMeshes.includes(m)) continue;
      if (isSmallPart(m, frame, scale, tune)) body.smallMeshes.push(m);
    }
  }
  hideSmallParts(body, hidden);
}

// ---- what a body draws -------------------------------------------------------------------------------------------

/**
 * The triangles a mesh's geometry draws: its index (or its vertices) cut to its draw range, and with a material per
 * group, each group's share of that range. A body part wholly under clothes has had its index emptied by the look's
 * occlusion cull, and three still issues a draw of nothing for it, after its program, its uniforms and its vertex array.
 */
export function drawnTriangles(geometry: THREE.BufferGeometry, grouped = false): number {
  const all = geometry.index ? geometry.index.count : (geometry.getAttribute('position')?.count ?? 0);
  const start = Math.max(0, geometry.drawRange.start);
  const end = Math.min(all, start + geometry.drawRange.count);
  if (!(end > start)) return 0;
  if (!grouped || geometry.groups.length === 0) return Math.floor((end - start) / 3);
  let n = 0;
  for (const g of geometry.groups) {
    const s = Math.max(start, g.start);
    const e = Math.min(end, g.start + g.count);
    if (e > s) n += Math.floor((e - s) / 3);
  }
  return n;
}

/** Whether a mesh draws no triangle at all (only triangle meshes are asked: a line or points is never one). */
export function drawsNothing(mesh: THREE.Mesh): boolean {
  if (!mesh.isMesh || !mesh.geometry) return false;
  return drawnTriangles(mesh.geometry, Array.isArray(mesh.material)) === 0;
}

/**
 * A look's own record of which of its geometries draw nothing: on the look's record (the model asset every body of it
 * is cloned from), never on a mesh's `userData`, which `Object3D.copy` deep-copies through JSON. A body's clone shares
 * its geometry with the look, so the set answers for every body of it.
 */
export interface CrowdLook {
  scene: THREE.Object3D;
  empties?: Set<THREE.BufferGeometry>;
}

/** The geometries of a look that draw nothing, worked out the first time a body of it is hung. */
export function emptiesOf(look: CrowdLook): ReadonlySet<THREE.BufferGeometry> {
  return look.empties ?? relistEmpties(look);
}

/**
 * The look's empties listed again from its meshes as they stand: called whenever its occlusion changes. A catalogue look
 * never changes once built (`buildLook`), so today that is its first body's hanging alone.
 */
export function relistEmpties(look: CrowdLook): Set<THREE.BufferGeometry> {
  const set = new Set<THREE.BufferGeometry>();
  look.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && drawsNothing(m)) set.add(m.geometry);
  });
  look.empties = set;
  return set;
}

/** A geometry's radius from its vertices' box, worked out once a geometry and kept (never on the geometry itself). */
const radii = new WeakMap<THREE.BufferGeometry, number>();
const box = new THREE.Box3();
const boxSize = new THREE.Vector3();
const rel = new THREE.Matrix4();

export function geometryRadius(geometry: THREE.BufferGeometry): number {
  const kept = radii.get(geometry);
  if (kept !== undefined) return kept;
  const pos = geometry.getAttribute('position');
  let r = 0;
  if (pos && pos.count > 0) {
    box.setFromBufferAttribute(pos as THREE.BufferAttribute);
    r = 0.5 * box.getSize(boxSize).length();
  }
  radii.set(geometry, r);
  return r;
}

/**
 * Whether a mesh hung on a body counts as one of its small parts: it draws something, fewer than `smallTris` triangles,
 * and its geometry's radius, carried through the frames between it and the body's (`frame`, where the body's own scale
 * is `bodyScale`), is under `smallSize` metres. A mesh under a bone (a weapon in a hand) is never one.
 */
export function isSmallPart(mesh: THREE.Mesh, frame: THREE.Object3D, bodyScale: number, tune: Pick<CrowdTune, 'smallTris' | 'smallSize'> = CROWD_TUNE): boolean {
  if (!mesh.isMesh || !mesh.geometry) return false;
  const tris = drawnTriangles(mesh.geometry, Array.isArray(mesh.material));
  if (tris <= 0 || tris >= tune.smallTris) return false;
  if (!frameOf(mesh, frame, rel)) return false;
  return geometryRadius(mesh.geometry) * rel.getMaxScaleOnAxis() * bodyScale < tune.smallSize;
}
