// What a planet's water.json says, and how one water body's look is decided from it.
// Only shaderKey.ts is imported, so a plain node test reads this file as the game does.

export { shaderKey } from '../swg/terrain/shaderKey.ts';

/** One shader's cube map in the pack: six face PNGs, the size written and the size in the archives. */
export interface WaterCubeInfo {
  file: string;
  faces: string[];
  size: number;
  source: number;
  /** The mean colour of the six faces, "#rrggbb". */
  mean: string;
}

/** A lava shader's look as the converter wrote it (water.json, `lava`): the client's MATL and TFNS values and where its textures went. */
export interface WaterLavaInfo {
  /** Seconds; the flow's time is taken modulo this, and flow × loopTime is whole, so the loop has no seam. */
  loopTime: number;
  /** Noise texture units per second. */
  flow: [number, number, number];
  colorScale: number;
  colorBias: number;
  /** Noise repeats per shader size. */
  tcScale: number;
  /** The shader's bloom texture factor (red), or null when it had none. */
  textureFactor: number | null;
  /** The colour ramp's top row, RGBA bytes in base64. */
  ramp: { width: number; rgba: string } | null;
  /** The crust, a pack-relative PNG. */
  mix: string | null;
  /** The noise volume, a pack-relative file of width × height × depth bytes. */
  noise: { file: string; size: [number, number, number] } | null;
}

/** One water shader as the converter read it. */
export interface WaterShaderInfo {
  file?: string;
  effect?: string;
  kind: 'water' | 'lava';
  waterTypes: number[];
  tables: number;
  global: boolean;
  /** The main texture's mean colour, "#rrggbb". */
  color?: string;
  alpha?: number;
  opacity?: number;
  fallbackColor?: string;
  ripple?: number;
  drift?: number;
  normalMap?: string;
  cube?: WaterCubeInfo;
  cubeMissing?: string;
  missing?: boolean;
  /**
   * A lava shader's look, exactly as written (null when its MATL could not be read). readWaterPack
   * does not check it: read it through lavaStyle.ts's readLavaInfo, which never throws.
   */
  lava?: WaterLavaInfo | null;
  /** readWaterPack keeps unknown fields untouched. */
  [extra: string]: unknown;
}

export interface WaterPackData {
  version: number;
  planet: string;
  global: { height: number; shader: string; shaderSize: number } | null;
  shaders: Record<string, WaterShaderInfo>;
  notes: string[];
  /**
   * What this planet's water does to whatever stands in it, exactly as the water command wrote it
   * and unread here: the client's own water values and its list of what takes no damage. It is kept
   * rather than re-typed because nothing about it is this file's business -- `lavaHarmMath.ts` is
   * where the block means anything -- but it must survive the way in, since the record this
   * function builds is what `World` hands on, and a block dropped here is a block the game never
   * sees however well the converter writes it. Undefined on every pack converted before it existed.
   */
  harm?: unknown;
}

/** How one water body is drawn. */
export interface WaterLook {
  /** sRGB hex, "#rrggbb". */
  color: string;
  opacity: number;
  /** Multiplier on the fine ripples' slopes (the material's uRipple). */
  ripple: number;
  /** Multiplier on how fast the fine ripples drift (uDrift). */
  drift: number;
  /** The pack-relative faces of this shader's cube, or null. Used only in 'shader' mode. */
  cube: string[] | null;
  /** Where the look came from, for the description. */
  source: 'shader' | 'planet' | 'default';
  shader: string | null;
}

const HEX = /^#[0-9a-f]{6}$/i;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hex = (v: unknown): string | undefined => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

function readCube(v: unknown): WaterCubeInfo | undefined {
  if (!isObject(v)) return undefined;
  const faces = Array.isArray(v.faces) ? v.faces.filter((f): f is string => typeof f === 'string') : [];
  if (faces.length !== 6) return undefined;
  return { file: str(v.file) ?? '', faces, size: num(v.size) ?? 0, source: num(v.source) ?? 0, mean: hex(v.mean) ?? '#000000' };
}

/**
 * water.json read leniently, never throwing: null unless it is an object with an object `shaders`.
 * An entry is kept when it is an object whose `kind` is 'water' or 'lava'; a colour that is not
 * "#rrggbb", or a number that is not finite, is dropped from its entry; a cube without six string
 * faces is dropped. The `lava` block and unknown fields are kept as they are, and so is the pack's
 * own `harm` block, which is what the rest of the game reads off this record.
 */
export function readWaterPack(json: unknown): WaterPackData | null {
  if (!isObject(json) || !isObject(json.shaders)) return null;
  const shaders: Record<string, WaterShaderInfo> = {};
  for (const [key, raw] of Object.entries(json.shaders)) {
    if (!isObject(raw)) continue;
    if (raw.kind !== 'water' && raw.kind !== 'lava') continue;
    // The lava block and any unknown fields ride along untouched (readLavaInfo checks the lava
    // block where it is used); the known ones are re-read and dropped when they are the wrong shape.
    const out = { ...raw } as WaterShaderInfo;
    out.kind = raw.kind;
    out.waterTypes = Array.isArray(raw.waterTypes) ? raw.waterTypes.filter((t): t is number => typeof t === 'number' && Number.isFinite(t)) : [];
    out.tables = num(raw.tables) ?? 0;
    out.global = raw.global === true;
    const text = (k: 'file' | 'effect' | 'color' | 'fallbackColor' | 'normalMap' | 'cubeMissing', v: string | undefined) => {
      if (v === undefined) delete out[k];
      else out[k] = v;
    };
    const number = (k: 'alpha' | 'opacity' | 'ripple' | 'drift', v: number | undefined) => {
      if (v === undefined) delete out[k];
      else out[k] = v;
    };
    text('file', str(raw.file));
    text('effect', str(raw.effect));
    text('color', hex(raw.color));
    text('fallbackColor', hex(raw.fallbackColor));
    text('normalMap', str(raw.normalMap));
    text('cubeMissing', str(raw.cubeMissing));
    number('alpha', num(raw.alpha));
    number('opacity', num(raw.opacity));
    number('ripple', num(raw.ripple));
    number('drift', num(raw.drift));
    if (raw.missing === true) out.missing = true;
    else delete out.missing;
    const cube = readCube(raw.cube);
    if (cube) out.cube = cube;
    else delete out.cube;
    shaders[key] = out;
  }
  const g = isObject(json.global) ? json.global : null;
  const out: WaterPackData = {
    version: num(json.version) ?? 0,
    planet: str(json.planet) ?? '',
    global: g ? { height: num(g.height) ?? 0, shader: str(g.shader) ?? '', shaderSize: num(g.shaderSize) ?? 2 } : null,
    shaders,
    notes: Array.isArray(json.notes) ? json.notes.filter((n): n is string => typeof n === 'string') : [],
  };
  // Carried through untouched and unchecked: the readers of the harm block take the raw shapes and
  // never throw, and a block re-read here would be a second spelling of what they already know.
  if (json.harm !== undefined) out.harm = json.harm;
  return out;
}

/** Lava: the terrain says type 1; else the pack's entry decides; with no entry, a shader that names lava. */
export function isLavaWater(shader: string | null, waterType: number, info: WaterShaderInfo | undefined): boolean {
  if (waterType === 1) return true;
  if (info) return info.kind === 'lava';
  return /lava/i.test(shader ?? '');
}

/**
 * The look of a water body drawn with `shader`: the pack's entry when it has a colour, else the
 * planet's own water (planets.ts), else a neutral default (#2e7fbb, 0.75). A missing cube leaves
 * `cube` null, and a lava entry never offers one.
 */
export function waterLookFor(shader: string | null, data: WaterPackData | null, planet: { color: number; opacity: number } | null): WaterLook {
  const info = shader ? data?.shaders[shader] : undefined;
  const fromShader = info?.color ?? info?.fallbackColor;
  const fromPlanet = planet ? `#${(planet.color >>> 0).toString(16).padStart(6, '0')}` : undefined;
  const color = fromShader ?? fromPlanet ?? '#2e7fbb';
  const opacity = info?.opacity ?? planet?.opacity ?? 0.75;
  return {
    color,
    opacity,
    ripple: info?.ripple ?? 1,
    drift: info?.drift ?? 1,
    cube: info?.kind === 'water' ? info.cube?.faces ?? null : null,
    source: fromShader !== undefined ? 'shader' : fromPlanet !== undefined ? 'planet' : 'default',
    shader: shader || null,
  };
}

/**
 * How bright a per-shader cube may be now: sqrt(clear / peak), held to 0.12..1; 1 without a peak.
 * A static daytime cube must be dimmed at night, since it cannot follow the sky.
 */
export function envLightFrom(clearLuminance: number, peakLuminance: number): number {
  if (!(peakLuminance > 1e-4)) return 1;
  return Math.min(1, Math.max(0.12, Math.sqrt(Math.max(0, clearLuminance) / peakLuminance)));
}
