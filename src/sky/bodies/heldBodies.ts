// Bodies that hang still in a ground world's sky (the GPU port's pass 2, wave 4b, maker B; the owner's answer to the design's
// question 3): Endor's Death Star, and the same way any of SWG's sky sprites a world is given (a Mon Cal cruiser, a Star
// Destroyer). Pure: no three, no page, so the node tests read the very rules the world reads.
//
// **What SWG says** is the world's own `held` list in its `sky.json` (the converter's reading of the environment file's `GSCL`
// chunks: one body in stages, each its picture, yaw, pitch and size), drawn at **stage 1**, the half-built sphere (about 1
// ABY, the owner's answer), at SWG's own placement.
//
// **What the owner saved** is the viewer's Save to game, `public/sky/bodies.json`'s `held` key (maker A's reader keeps it
// numbers and words; this reads it again the same way): `held[world][name] = { picture, yawDeg, pitchDeg, size, rollDeg,
// light }`, `picture` a sky picture's SWG name with no extension, the angles and size SWG's celestial numbers. A world the file
// names holds exactly what the file lists for it; a world it does not name keeps what SWG's environment says.
//
// Where the picture comes from: the world's own pack where its sky carries it (Endor's three stages), else the shared sky
// pack (`<packs>/sky/`, the converter's `exportSkyPictures`), whose list says which pictures every player has.

/** One held body as the world hangs it. */
export interface HeldPlan {
  /** Its name in the world's list (`deathstar`). */
  readonly name: string;
  /** The picture's SWG name, no extension (`moon_deathstar1`). */
  readonly picture: string;
  /** SWG's celestial numbers: yaw and pitch in degrees, size (the half width at the client's 3 m), roll in degrees. */
  readonly yawDeg: number;
  readonly pitchDeg: number;
  readonly size: number;
  readonly rollDeg: number;
  /** Its brightness over the converted picture's (1 as converted). */
  readonly light: number;
  /** Whose numbers: SWG's environment, or the owner's saved file. */
  readonly from: 'swg' | 'file';
  /** The SWG stage it shows, where SWG's list names one (1 to 3; 0 none). */
  readonly stage: number;
}

/** Where a held body's picture is: its file in the world's pack, or a name of the shared sky pack. */
export interface HeldPicture {
  readonly where: 'world' | 'shared';
  readonly file: string;
}

/** A held entry of the world's `sky.json` as the converter writes it (`exportSky`'s `held`). */
export interface SkyHeldEntry {
  picture?: unknown;
  stage?: unknown;
  yaw?: unknown;
  pitch?: unknown;
  size?: unknown;
  image?: { file?: unknown } | null;
}

/** The stage SWG's own sky is drawn at where the owner names none (his answer: the half-built sphere, about 1 ABY). */
export const HELD_STAGE = 1;

/** The ranges a saved held body's numbers are held to (the Save to game reader's own, `bodiesFile.ts`' `HELD_RANGE`). */
export const HELD_RANGE = { size: [0.01, 20], pitchDeg: [-90, 90], light: [0, 8] } as const;

/** A picture's or a body's name: a short plain word. */
const NAME = /^[a-z0-9_]{1,48}$/;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clampTo = (v: number, r: readonly [number, number]): number => (v < r[0] ? r[0] : v > r[1] ? r[1] : v);
/** An angle in degrees brought into (−180, 180]. */
const wrapDeg = (d: number): number => {
  const w = ((((d + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
};

/** The name SWG's stages share, from a stage's picture: `moon_deathstar1` is `deathstar`. */
export function heldNameOf(picture: string): string {
  const n = String(picture ?? '').toLowerCase().replace(/^(moon|cels)_/, '').replace(/\d+$/, '');
  return NAME.test(n) ? n : 'held';
}

/** What SWG's environment holds for a world: its `held` list's stage-`stage` entries, at SWG's own numbers. */
export function swgHeldOf(list: readonly SkyHeldEntry[] | null | undefined, stage = HELD_STAGE): HeldPlan[] {
  const out: HeldPlan[] = [];
  if (!Array.isArray(list)) return out;
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const picture = typeof e.picture === 'string' ? e.picture.toLowerCase() : '';
    const yaw = num(e.yaw);
    const pitch = num(e.pitch);
    const size = num(e.size);
    if (!NAME.test(picture) || yaw === null || pitch === null || size === null || !(size > 0)) continue;
    if (num(e.stage) !== stage) continue;
    out.push({ name: heldNameOf(picture), picture, yawDeg: wrapDeg(yaw), pitchDeg: clampTo(pitch, HELD_RANGE.pitchDeg), size: clampTo(size, HELD_RANGE.size), rollDeg: 0, light: 1, from: 'swg', stage });
  }
  return out;
}

/**
 * A world's saved held bodies (`held[world]` of the owner's file), each kept numbers and words only, or null where the file
 * names no such world (which then keeps SWG's). A body whose picture or numbers do not read is left out.
 */
export function fileHeldOf(held: unknown, world: string): HeldPlan[] | null {
  if (!held || typeof held !== 'object' || Array.isArray(held)) return null;
  const w = (held as Record<string, unknown>)[world];
  if (!w || typeof w !== 'object' || Array.isArray(w)) return null;
  const out: HeldPlan[] = [];
  for (const [name, v] of Object.entries(w as Record<string, unknown>)) {
    if (!NAME.test(name) || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    const picture = typeof o.picture === 'string' ? o.picture.toLowerCase() : '';
    const yaw = num(o.yawDeg);
    const pitch = num(o.pitchDeg);
    const size = num(o.size);
    if (!NAME.test(picture) || yaw === null || pitch === null || size === null || !(size > 0)) continue;
    const roll = num(o.rollDeg) ?? 0;
    const light = num(o.light) ?? 1;
    const stage = /\d$/.test(picture) ? Number(picture.slice(-1)) : 0;
    out.push({ name, picture, yawDeg: wrapDeg(yaw), pitchDeg: clampTo(pitch, HELD_RANGE.pitchDeg), size: clampTo(size, HELD_RANGE.size), rollDeg: wrapDeg(roll), light: clampTo(light, HELD_RANGE.light), from: 'file', stage });
  }
  return out;
}

/** What a world holds: the owner's saved list where his file names the world, else SWG's at stage 1. */
export function heldPlanOf(world: string, skyHeld: readonly SkyHeldEntry[] | null | undefined, fileHeld: unknown): HeldPlan[] {
  return fileHeldOf(fileHeld, world) ?? swgHeldOf(skyHeld);
}

/**
 * Where a held body's picture is: the world's own pack where its sky's `held` list carries that picture (its converted file),
 * else the shared sky pack where its list (`pictures.json`) names it, else nowhere (the body is not hung).
 */
export function heldPictureOf(picture: string, skyHeld: readonly SkyHeldEntry[] | null | undefined, shared: Record<string, { file?: unknown }> | null | undefined): HeldPicture | null {
  for (const e of Array.isArray(skyHeld) ? skyHeld : []) {
    const file = e?.image && typeof e.image.file === 'string' ? e.image.file : null;
    if (file && typeof e.picture === 'string' && e.picture.toLowerCase() === picture) return { where: 'world', file };
  }
  const s = shared && Object.prototype.hasOwnProperty.call(shared, picture) ? shared[picture] : null;
  if (s && typeof s.file === 'string' && /^[a-z0-9_]{1,48}\.png$/.test(s.file)) return { where: 'shared', file: s.file };
  return null;
}
