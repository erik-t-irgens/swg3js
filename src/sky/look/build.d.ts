// Types for `build.js` (the space body viewer's drawing of a look: its meshes, pictures and one material a layer), so the
// game's TypeScript imports it as it stands (the GPU port's pass 2, wave 5, maker L: `src/sky/bodies/lookBody.ts` draws every
// look's layers in the game with it). Only what the game reads is typed; the module is the viewer's plain JavaScript.
/* eslint-disable @typescript-eslint/no-explicit-any */

/** A look on a stage: its root and groups, its uniforms, its parts, its gas, its air (what `buildLook` answers). */
export interface BuiltLook {
  root: any;
  bill: any;
  axis: any;
  spin: any;
  cloudSpin: any;
  ringGroup: any;
  ringSpin: any;
  LU: Record<string, any>;
  U: Record<string, any>;
  look: any;
  /** Its reach in its own radii (its rings, halo, air or gas), the stage's frame. */
  radius: number;
  profile: unknown;
  gen: unknown;
  parts: { fields: { update(camera: unknown, sizer: unknown): void }[]; ring: unknown } | null;
  vol: unknown;
  air: unknown;
  airMode: 'scattered' | 'painted' | 'none';
  storms?: unknown;
  hasClouds?: boolean;
  placeScale?: number;
  [k: string]: unknown;
}

/** Build a look onto meshes (`place`: drawn at a place of a sky, seen through its air). */
export function buildLook(look: unknown, o?: { onStatus?: (s: string) => void; place?: boolean }): Promise<BuiltLook>;
/** Every slider's value into its uniforms (no rebuild). */
export function syncLook(state: BuiltLook): void;
/** The page's frame call. */
export function updateLook(state: BuiltLook, o: Record<string, unknown>): void;
/** The record `updateLookWith` reads (made once, written in place a frame). */
export interface LookFrameRecord {
  camera: any;
  clock: number;
  sunWorld: any;
  face: any;
  lightWorld: any;
  /** Degrees, NaN: the look's own. */
  tilt: number;
  spin: number;
  /** The radius of the sphere a dome stands for, 0 none. */
  sphereRadius: number;
  /** What the parts' rocks measure their pixels by (`getDrawingBufferSize`), null the bake's renderer. */
  sizer: { getDrawingBufferSize(v: { x: number; y: number }): unknown } | null;
  /** (The sky round, maker L, D) the body's casters this frame (`skyShade.ts`' `ShadeOf`), null for none. */
  shade: { n: number; sunRad: number; ring: number; strength: number; c: Float64Array } | null;
}
export function lookFrameRecord(): LookFrameRecord;
/** The frame call from a kept record: nothing made. */
export function updateLookWith(state: BuiltLook, a: LookFrameRecord): void;
/** The weather's clocks (seconds): the clouds' motion and the lightning's wall clock, written in place by a drawer. */
export const WEATHER_TIME: { motion: number; wall: number };
export function setWeatherTime(motion: number, wall: number): void;
/** Everything a built look made let go. */
export function disposeLook(state: BuiltLook | null): void;
/** The renderer generated looks, shapes, rocks and gas are baked with. */
export function setBakeRenderer(r: unknown): void;
/** The one hook every picture and mesh a look names is read through: its address, or null where it is not here. */
export function setPictureSource(of: ((name: string) => string | null) | null): void;
/** The air's form for every look built after it (`all`: own, scattered, painted, none) and the march's quality. */
export function setAirChoice(o?: { all?: string; quality?: string | null }): { all: string; steps: number };
/** A look's air record set by its drawer (airProfile's `F`), or put back to the look's own (null). */
export function setAirRecordFor(look: unknown, rec: ArrayLike<number> | null): void;
/** The form a look's air is drawn in now. */
export function airModeOf(look: unknown): 'scattered' | 'painted' | 'none';
/** Pictures not in `keep` let go, least recently used first, down to `limit`. */
export function releaseTextures(keep: Set<string>, limit?: number): void;
/** The kind and projection the survey (or the owner) gave each picture, from `textures.json`'s shape. */
export function setTextureInfo(json: unknown): void;
export function setAddedPictures(pictures: Record<string, unknown> | null | undefined): void;
/** A mesh's every triangle cut into `k` squared, its uv laid across each as on the whole, every point pushed onto the sphere of `r`. */
export function cutShell(src: any, k: number, r: number): any;
/** A dome's outline seen along its axis for a half-angle (radians) at a distance: its scale and widest point. */
export function domeOutline(profile: unknown, half: number, dist: number): { scale: number; rho: number; z: number };
