// A standing piece of ground written again in place (Map-maker II, DESIGN.md §2.4): a sculpt stroke, an undo or a heights
// file that landed late moves the heights under a chunk or a far tile that is already drawn, and its mesh, its material and
// its program must stay what they are, or a stroke builds a program and a frame waits on a link.
//
// **Built, then copied.** The ground is built afresh by the very path that built it (`Terrain.buildChunk`,
// `buildFarTile`, each of `buildGrid`'s three shapes: the tiled, the family and the plain), and every attribute of the
// fresh build is copied into the standing geometry's own arrays, whose buffers then go up whole. So the rewrite equals a
// fresh build by construction, in every shape, a ruled world's moved families included (`groundRewrite.test.ts` holds it
// by `Object.is`), at the cost of a fresh build's time (0.65 to 1.0 ms a chunk [measured r1]) rather than the corner-to-pole
// map's tenth of that, which the design allows as the start and leaves for when a stroke's frames ask for it. The index is
// the same by construction (an identity index on the tiled and family shapes, the fan diagonals on the plain, which hang on
// the chunk's origin alone), and a far tile keeps its own, which is its cut. A whole attribute goes up rather than a range:
// nothing is pushed onto three's list of ranges, so nothing piles up between uploads (the three-ranges lesson).
//
// **The pace** (`GROUND_REWRITE_TUNE`, ours): the chunks a stroke dirtied are rewritten nearest the brush first within
// `frameMs` a frame, each at most once a frame however many stamps reached it, and their plantings replanted `floraHz` times
// a second and once more as the stroke ends. Shipped, since a heights file that lands late in a release is rebuilt the same
// way; the editor's `sculpt({ tune })` moves it.
//
// Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no enum, no namespace, no
// constructor parameter properties.

import * as THREE from 'three';

/** How fast a stroke's dirty ground is written again (ours; live through `sculpt({ tune })`). */
export const GROUND_REWRITE_TUNE = {
  /** Milliseconds a frame the rewrite and the replant may spend between them. */
  frameMs: 2,
  /** How many times a second a held stroke's dirty chunks have their plantings made again (and once more at its end). */
  floraHz: 4,
  /**
   * Milliseconds a frame a paint stroke's preview may spend rewriting the chunks it reached (Map-maker II's second wave,
   * `PAINT_TUNE.previewMs`): a chunk is 0.6 to 0.9 ms from cached blocks, so one or two a frame.
   */
  paintMs: 1.5,
};

/**
 * The paint's shipped numbers (ours; live through `groundPaint({ tune })`): how long a textured real-elevation world's
 * loading screen waits for its raster before it lifts and lets the ground be made again in view (`demGroundPending`).
 */
export const GROUND_PAINT_TUNE = {
  rasterWaitMs: 20000,
};

type Typed = Float32Array | Uint8Array | Uint16Array | Uint32Array | Int8Array | Int16Array | Int32Array;

/**
 * Whether a fresh build has exactly the standing geometry's shape: the same attributes by name, each the same item size,
 * the same kind of array of the same length, normalised alike; and, unless `keepIndex`, an index of the same length. Only
 * then is a copy the fresh build.
 */
export function sameGroundShape(target: THREE.BufferGeometry, fresh: THREE.BufferGeometry, keepIndex = false): boolean {
  const ta = target.attributes;
  const fa = fresh.attributes;
  const tn = Object.keys(ta);
  const fn = Object.keys(fa);
  if (tn.length !== fn.length) return false;
  for (const name of fn) {
    const a = ta[name] as THREE.BufferAttribute | undefined;
    const b = fa[name] as THREE.BufferAttribute;
    if (!a || !(a as THREE.BufferAttribute).isBufferAttribute || !b.isBufferAttribute) return false;
    if (a.itemSize !== b.itemSize || a.normalized !== b.normalized) return false;
    if (a.array.length !== b.array.length || a.array.constructor !== b.array.constructor) return false;
  }
  if (keepIndex) return true;
  const ti = target.getIndex();
  const fi = fresh.getIndex();
  if (!ti || !fi) return !ti && !fi;
  return ti.array.length === fi.array.length;
}

/**
 * The fresh build's attributes copied into the standing geometry's own arrays, each marked to go up whole, and its
 * bounding sphere taken; the index left as it stands (the same by construction on a chunk, a far tile's cut on a far tile).
 * Answers false, and touches nothing, where the two are not the same shape (`sameGroundShape`).
 */
export function copyGround(target: THREE.BufferGeometry, fresh: THREE.BufferGeometry, keepIndex = false): boolean {
  if (!sameGroundShape(target, fresh, keepIndex)) return false;
  for (const name of Object.keys(fresh.attributes)) {
    const a = target.attributes[name] as THREE.BufferAttribute;
    const b = fresh.attributes[name] as THREE.BufferAttribute;
    (a.array as Typed).set(b.array as Typed);
    // Whole: no range is pushed, so none piles up on an attribute three has not uploaded yet.
    a.clearUpdateRanges();
    a.needsUpdate = true;
  }
  if (!fresh.boundingSphere) fresh.computeBoundingSphere();
  if (fresh.boundingSphere) {
    if (target.boundingSphere) target.boundingSphere.copy(fresh.boundingSphere);
    else target.boundingSphere = fresh.boundingSphere.clone();
  }
  target.boundingBox = null;
  return true;
}

/** Whether a game-frame rectangle meets a chunk's sample window (`[origin - 2, origin + size + 2]` each way: a chunk reads one pole past its edge). */
export function rectMeetsChunk(ox: number, oz: number, size: number, x0: number, z0: number, x1: number, z1: number, pole = 2): boolean {
  return !(Math.min(x0, x1) > ox + size + pole || Math.max(x0, x1) < ox - pole || Math.min(z0, z1) > oz + size + pole || Math.max(z0, z1) < oz - pole);
}
