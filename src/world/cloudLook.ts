// What the volumetric clouds should look like over this world, at this hour, in this weather.
//
// Everything that says what a sky *is* comes out of the client's own art, measured by the `clouds`
// command: a cloud sheet is one tiling picture drawn across the sky, so its mean alpha is literally
// how much of the sky that row covers and its alpha-weighted brightness is how dark that cover is.
// Over the thirteen tiles the retail worlds use, those two numbers order themselves into the sky
// each planet is known for -- the storm world reads 85% covered at brightness 0.30, the lava world
// is the darkest of all at 0.17, the desert is 12% covered and 0.73 bright, and the emptiest world
// reads 0.007, which is a clear sky.
//
// **A higher weather level does not mean more cloud**, which is the one thing here that looks like
// a rule and is not. On most worlds the sheets are dropped as the weather rises -- the desert
// carries eighteen rows of cloud at level 0 and none at all above it -- because the row hangs a
// storm effect on the camera instead and a sheet behind it would be pointless. So the level says
// what the weather is doing and the tile says what the sky looks like, and reading the first as the
// second gets every world backwards. What rises with the level is the **wind**, which the rows do
// carry, and that is what the march should read for its drift.
//
// Only the shape and the colour are taken from the world. How a cloud is lit is the sky's own
// (`SkyLighting`), which is why Mustafar's red needs no table: the march takes the sun and the
// ambient the sky is already giving everything else.

import * as THREE from 'three';
import type { CoverPoint } from '../core/fx/cloudMath.ts';

/** One weather level of a world, as `clouds.json` records it. */
export interface CloudLevel {
  level: number;
  rows: number;
  /** 1 for a single sheet, 2 where a row carries both a bottom and a top: two layers of sky. */
  decks: number;
  /** The share of sky the cloudiest area at this level covers, 0 to 1. */
  coverage: number;
  /** How bright that cover is, 0 to 1. Low is a dark deck. */
  brightness: number;
  tiles: string[];
}

/** A world's measured sky. */
export interface CloudPack {
  format: number;
  planet: string;
  tiles: Record<string, { width: number; height: number; coverage: number; solid: number; brightness: number }>;
  levels: CloudLevel[];
}

/**
 * What the march is asked to draw. Coverage and colour are the world's own; everything else is a
 * number of ours, and lives in `CLOUD_TUNE` where it can be moved live.
 */
export interface CloudLook {
  /** How much sky to fill, 0 to 1, straight off the art. */
  coverage: number;
  /** How dark the cloud is, 0 to 1, straight off the art. */
  brightness: number;
  /** How deep the deck is, 1 or 2, from whether the row carries one sheet or two. */
  decks: number;
  /** How fast it drifts, in the sheets' own units, from the row's wind. */
  drift: number;
  /** True while the row is hanging a storm effect on the camera, so the march should stand down. */
  storming: boolean;
}

/**
 * Every invented number of the look. None of these is in the client's art, which says what a sky
 * covers and how dark it is and nothing whatever about a volume. Live through `__debug.clouds`.
 */
export const CLOUD_TUNE = {
  /**
   * What a world with no measured sky is given. A clear day: a world nobody has measured must not
   * suddenly grow a storm, and the toggle back to the sheets has to be a fair comparison.
   */
  fallback: { coverage: 0.12, brightness: 0.7, decks: 1 },
  /** How much of the sheets' own wind becomes the march's drift. */
  driftScale: 1,
  /**
   * How far the coverage may be pushed either way by the weather level, as a share of itself.
   *
   * Small on purpose, and it is the only place the level touches the look at all. The art already
   * says what the sky is; this is the difference between a still day and a blustery one on a world
   * whose rows do not change their tile.
   */
  levelLift: 0.15,
  /** Below this coverage nothing is drawn at all, and the pass costs nothing. */
  minCoverage: 0.02,
  /**
   * How much driven dust stands the march down.
   *
   * A dust storm is the one weather that really fills the view: rain and snow you see the sky
   * through, and a rainy sky wants its cloud. So this reads the dust alone, and the number is where
   * a storm has taken the sky over rather than merely started.
   */
  standDownDust: 0.5,
};

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The level whose weather is running, or the nearest one the world actually has. */
export function levelAt(pack: CloudPack | null, weatherIndex: number): CloudLevel | null {
  if (!pack?.levels?.length) return null;
  let best = pack.levels[0];
  for (const l of pack.levels) if (Math.abs(l.level - weatherIndex) < Math.abs(best.level - weatherIndex)) best = l;
  return best;
}

/**
 * The look for a world at a weather level.
 *
 * `storming` is the caller's: only the running weather knows whether a storm effect is on the
 * camera, and the march stands down for one because the client's own rows do -- a sky already full
 * of driven dust has no business also being full of cloud.
 */
export function cloudLook(pack: CloudPack | null, weatherIndex: number, wind: number, storming: boolean, tune = CLOUD_TUNE): CloudLook {
  const level = levelAt(pack, weatherIndex);
  if (!level || level.coverage <= 0) {
    const f = tune.fallback;
    return { coverage: pack ? 0 : f.coverage, brightness: pack ? 1 : f.brightness, decks: pack ? 1 : f.decks, drift: wind * tune.driftScale, storming };
  }
  // The level's own share of the world's range, so a blustery day reads a little thicker than a
  // still one on a world whose rows never change their tile.
  const levels = pack!.levels;
  const span = Math.max(1, levels[levels.length - 1].level - levels[0].level);
  const t = (level.level - levels[0].level) / span;
  const lift = 1 + (t - 0.5) * 2 * tune.levelLift;
  return {
    coverage: clamp01(level.coverage * lift),
    brightness: clamp01(level.brightness),
    decks: level.decks || 1,
    drift: wind * tune.driftScale,
    storming,
  };
}

/** Whether the march is worth running at all: a sky this clear is cheaper drawn as nothing. */
export function worthDrawing(look: CloudLook, tune = CLOUD_TUNE): boolean {
  return !look.storming && look.coverage >= tune.minCoverage;
}

/** Where the baked billow really lies, as the noise pack measured it off its own bytes. */
export interface BillowRange {
  lo: number;
  hi: number;
}

/** The baked noise volumes' own record. Null when the `clouds` command has not been run. */
export interface CloudNoisePack {
  format: number;
  source: string;
  base: { size: number; channels: number; file: string };
  detail: { size: number; channels: number; file: string };
  billow: BillowRange;
  /** What share of sky each threshold really fills, marched through the volumes themselves. */
  cover: CoverPoint[];
}

export async function loadCloudNoise(base = ''): Promise<CloudNoisePack | null> {
  try {
    const res = await fetch(`${base}assets-private/clouds/manifest.json`);
    if (!res.ok) return null;
    const pack = (await res.json()) as CloudNoisePack;
    // Version 2 is the one that carries the measured cover curve. A version 1 volume is the same
    // bytes with a calibration that under-delivered on sixteen of the eighteen worlds, and the
    // command that mends it opens no archive, so it is refused rather than half-read.
    return pack?.format === 2 && pack.base?.size > 0 && Array.isArray(pack.cover) && pack.cover.length > 1 ? pack : null;
  } catch {
    return null;
  }
}

/**
 * Fetch the two noise volumes and make the 3D textures the march samples.
 *
 * They are raw bytes rather than a picture on purpose: a 128-cube volume is two million texels and
 * no image format holds three dimensions, so the file is exactly what is uploaded and the manifest
 * says how to read it. Repeat wrapping, because the volume is sampled over and over across a sky
 * kilometres wide and it was generated to tile.
 *
 * Both are fetched once for the session and shared: they are the same on every world, which is what
 * lets a travel cost nothing.
 */
let volumesOnce: Promise<{ base: THREE.Data3DTexture; detail: THREE.Data3DTexture; cover: CoverPoint[] } | null> | null = null;
export function loadCloudVolumes(base = ''): Promise<{ base: THREE.Data3DTexture; detail: THREE.Data3DTexture; cover: CoverPoint[] } | null> {
  volumesOnce ??= (async () => {
    const man = await loadCloudNoise(base);
    if (!man) return null;
    const grab = async (file: string, size: number): Promise<THREE.Data3DTexture | null> => {
      const res = await fetch(`${base}assets-private/clouds/${file}`);
      if (!res.ok) return null;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length !== size * size * size * 4) return null;
      const tex = new THREE.Data3DTexture(bytes, size, size, size);
      tex.format = THREE.RGBAFormat;
      tex.type = THREE.UnsignedByteType;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.wrapR = THREE.RepeatWrapping;
      tex.unpackAlignment = 1;
      tex.needsUpdate = true;
      return tex;
    };
    const [b, d] = await Promise.all([grab(man.base.file, man.base.size), grab(man.detail.file, man.detail.size)]);
    if (!b || !d) return null;
    return { base: b, detail: d, cover: man.cover };
  })();
  return volumesOnce;
}

/** A world's measured sky, fetched from its pack. Null when the `clouds` command has not been run. */
export async function loadCloudPack(packId: string, base = ''): Promise<CloudPack | null> {
  try {
    const res = await fetch(`${base}assets-private/${packId}/clouds.json`);
    if (!res.ok) return null;
    const pack = (await res.json()) as CloudPack;
    return pack?.format === 1 && Array.isArray(pack.levels) ? pack : null;
  } catch {
    return null;
  }
}
