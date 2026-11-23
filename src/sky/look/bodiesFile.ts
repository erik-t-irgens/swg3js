// The game's reader of the space body viewer's Save to game (the GPU port's pass 2, wave 4; the owner's answer to the
// design's question 1): `public/sky/bodies.json`, which the viewer writes (`viewer/gameBodies.mjs`) and he commits as he
// does his maps. Read again at every loading screen (`World.load` behind it), so a Save to game shows at the next one.
//
// It holds numbers only, and this reader keeps it so whatever the file says: his generated looks (recipe, seed, dials,
// size, air), which place wears which, the systems he applied, each ground world's air dials, the photos of his he marked
// to ship (by name under `sky/pictures/`), and a credits line. A string is kept only where it is a colour (`#rrggbb`), a
// short word (a recipe, a mode, an id) or a shipped photo's path; anything else is dropped, a look a place names that the
// file does not hold is dropped with it, and a file of a later version or not an object is refused whole.
//
// **What draws from it** (pass 2, wave 4b, maker A): a place's look is what its body wears (`lookPictures.ts`'s `lookOfPlace`,
// baked on the card behind the screen, `skyLooks.ts`), and a ground world's saved air is that world's air (`applyFileAir`,
// behind the screen before the world's air is made), so its ground sky, its rim seen from another world and its rim from
// orbit change together. The applied systems wait for wave 5.
//
// **How the viewer's air dials reach the game** (`gameAirOf`; the README says it for the owner too). A viewer dial with a twin
// among the game's own air dials sets that dial exactly as the live dial would (`tuneAirDials`):
//   - Haze (clear-day visibility), km -> the world's `visibilityKm` (held to the game's 0.2 to 300 km: at 300 the game's haze is
//     nought, as the viewer's 1000 is);
//   - Haze colour -> the world's `hazeR`, `hazeG`, `hazeB` (each channel's share of the haze's scattering, its brightest 1:
//     the viewer's own `hazeTintFromHex`).
// A dial with no twin among the game's dials but naming a field of the game's record that no fit moves sets that field on the
// world's record (`airParams.ts`'s `AIR_FILE_FIELDS`, laid over by `worldRecord`, so the fitted rows, the twin and the body's
// record all carry it):
//   - Planet radius -> the record's bottom; Thickness -> its top (the bottom plus it);
//   - How fast it thins -> Rayleigh's scale height (the ozone's centre and half width scaled by it, as the viewer's record does);
//   - Haze height -> the haze's scale height; Haze forward glow -> its phase's g; Haze brightness -> its single-scattering
//     albedo (its extinction split again by it); Ground bounce -> the ground's albedo in every channel.
// The rest stay the viewer's (`VIEWER_ONLY_AIR`, listed for the owner): Sky colour and Sky strength (Rayleigh's colour and
// amount) and Ozone, which the game fits to SWG's own sky of each hour (`airFit.ts`, with its steer dial), so a saved value would
// fight the fit; Limb brightness and Twilight brightness, the rim's gains, one pair for every body in the game
// (`BODY_TUNE.limb`, `.twilight`), not a world's; and the look's lighting dials (limb darkening, glint, cloud relief, silver
// edge and shadows, night-side fill), which shape how the viewer lights a look's surface, not the air.
//
// Rule for this file (node runs it with type stripping for the tests): every value import with its `.ts` extension,
// nothing that touches the page at load.

import { fetchPublic } from '../../world/packFiles.ts';
import { AIR_DIAL_RANGE, AIR_FILE_FIELD_NAMES, airDialsOf, setAirFileFields, tuneAirDials, type AirFileFields } from '../air/airParams.ts';

/** The version this reader knows (the viewer's `GAME_BODIES_VERSION`). */
export const BODIES_VERSION = 1;
/** Where the file is, under the site's public folder. */
export const BODIES_PATH = 'sky/bodies.json';
/** Where his shipped photos are, under the same. */
export const BODIES_PICTURES = 'sky/pictures/';

type Plain = number | boolean | string | null | Plain[] | { [k: string]: Plain };

/** One look as the file keeps it: the viewer's look, numbers only. */
export interface BodyLook {
  name: string;
  kind: 'sphere' | 'dome' | 'sheet';
  layers: Record<string, Record<string, Plain>>;
  adjust: Record<string, Plain>;
  generated: Record<string, Plain> | null;
  air: Record<string, Plain> | null;
}

/**
 * A body held still in a ground world's sky (pass 2, wave 4b; the brief's `held` key): the Death Star over Endor, any of SWG's
 * sky sprites he places. `picture` a sky pack picture's SWG name with no extension; `yawDeg`, `pitchDeg` and `size` SWG's
 * celestial numbers as the converter writes them; `rollDeg` its turn on the card; `light` its brightness's scale (1 as
 * converted). Numbers and one plain word, nothing else.
 */
export interface HeldBody {
  picture: string;
  yawDeg: number;
  pitchDeg: number;
  size: number;
  rollDeg: number;
  light: number;
}

/** The pictures a held body may name (a sky pack's, by SWG's names): the Death Star's four stages and SWG's two ship sprites. */
export const HELD_PICTURES = ['moon_deathstar1', 'moon_deathstar2', 'moon_deathstar3', 'moon_deathstar', 'cels_moncal_cruiser', 'cels_star_destroyer'] as const;

/** Each number's range (a held body's numbers are held to them; SWG's celestial size is the square's, 0 to 20). */
export const HELD_RANGE = { yawDeg: [-360, 360], pitchDeg: [-90, 90], size: [0.01, 20], rollDeg: [-360, 360], light: [0, 8] } as const;

/** The file as kept. */
export interface BodiesFile {
  version: number;
  made: string;
  credits: string;
  looks: Record<string, BodyLook>;
  uses: Record<string, string>;
  systems: Record<string, Record<string, Plain>>;
  air: Record<string, Record<string, Plain>>;
  pictures: Record<string, { kind: string }>;
  /** Bodies held still in a ground world's sky, by world, then by the body's own id (`deathstar`, `cruiser`, ...). */
  held: Record<string, Record<string, HeldBody>>;
}

/**
 * One held body made safe: its picture one of `HELD_PICTURES`, every number finite and held to `HELD_RANGE` (a missing one
 * takes SWG's placement's, `start`), or null where its picture is not one of them. `count` counts what is dropped or held.
 */
export function cleanHeld(raw: unknown, start: HeldBody, count: { dropped: number } = { dropped: 0 }): HeldBody | null {
  if (!isObj(raw)) {
    count.dropped++;
    return null;
  }
  const pic = typeof raw.picture === 'string' ? raw.picture.toLowerCase().replace(/\.(dds|png|tga)$/, '') : start.picture;
  if (!(HELD_PICTURES as readonly string[]).includes(pic)) {
    count.dropped++;
    return null;
  }
  const num = (k: keyof typeof HELD_RANGE): number => {
    const v = raw[k];
    const [lo, hi] = HELD_RANGE[k];
    if (v === undefined) return start[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      count.dropped++;
      return start[k];
    }
    return v < lo ? lo : v > hi ? hi : v;
  };
  return { picture: pic, yawDeg: num('yawDeg'), pitchDeg: num('pitchDeg'), size: num('size'), rollDeg: num('rollDeg'), light: num('light') };
}

/**
 * SWG's own placement of Endor's Death Star (its environment's `GSCL` chunks, the sweep's reading): yaw 140°, pitch 30°, size
 * 0.6, at stage 1, the half-built sphere (`moon_deathstar1`, about 1 ABY: the owner's answer), unrolled, as converted. What a
 * held body the file names takes for a number it leaves out; the converter's own numbers stand where the sky pack has them.
 */
export const HELD_DEATH_STAR: HeldBody = { picture: 'moon_deathstar1', yawDeg: 140, pitchDeg: 30, size: 0.6, rollDeg: 0, light: 1 };

/** A ground world's held bodies by the file (its own ids to each body), or null where the file names none for it. */
export function heldBodiesOf(world: string): Record<string, HeldBody> | null {
  return SKY_BODIES.file?.held[world] ?? null;
}

/** What the last loading screen read, for the bodies and `__debug.sky({ bodies: true })`. */
export const SKY_BODIES: { file: BodiesFile | null; reads: number; at: string; why: string; dropped: number } = { file: null, reads: 0, at: '', why: 'not read yet', dropped: 0 };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const WORD = /^[A-Za-z0-9_.:# -]{0,64}$/;
const COLOUR = /^#[0-9a-fA-F]{6}$/;
/** A key the file may use: an id, a slot, a dial. */
const KEY = /^[A-Za-z0-9_.:#-]{1,96}$/;

/** A photo's path as a look names it, `pictures/<name>`, its name plain and its kind a picture's. */
function photoPath(s: string, pictures: Record<string, { kind: string }>): boolean {
  if (!s.startsWith('pictures/')) return false;
  const name = s.slice('pictures/'.length);
  return /^[A-Za-z0-9][A-Za-z0-9 _-]{0,98}[A-Za-z0-9]?\.(png|jpg)$/.test(name) && Object.prototype.hasOwnProperty.call(pictures, name);
}

/** A value kept numbers only (`count` counts what is dropped), or undefined where nothing of it is kept. */
function keep(v: unknown, pictures: Record<string, { kind: string }>, count: { dropped: number }, depth = 0): Plain | undefined {
  if (depth > 8) {
    count.dropped++;
    return undefined;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? v : (count.dropped++, undefined);
  if (typeof v === 'boolean' || v === null) return v;
  if (typeof v === 'string') {
    if (v === '' || COLOUR.test(v) || photoPath(v, pictures)) return v;
    if (WORD.test(v) && !/\.(png|jpe?g|fbx|dds|tga)$/i.test(v)) return v;
    count.dropped++;
    return undefined;
  }
  if (Array.isArray(v)) {
    if (v.length > 4096) {
      count.dropped++;
      return undefined;
    }
    const out: Plain[] = [];
    for (const x of v) {
      const k = keep(x, pictures, count, depth + 1);
      if (k !== undefined) out.push(k);
    }
    return out;
  }
  if (isObj(v)) {
    const out: Record<string, Plain> = {};
    for (const [k, x] of Object.entries(v)) {
      if (!KEY.test(k)) {
        count.dropped++;
        continue;
      }
      const kept = keep(x, pictures, count, depth + 1);
      if (kept !== undefined) out[k] = kept;
    }
    return out;
  }
  count.dropped++;
  return undefined;
}

const objectOf = (v: Plain | undefined): Record<string, Plain> => (isObj(v) ? (v as Record<string, Plain>) : {});

/** The file made safe to keep: `null` and why where it is refused whole; otherwise the file and how much was dropped. */
export function cleanBodiesFile(raw: unknown): { file: BodiesFile | null; why: string; dropped: number } {
  if (!isObj(raw)) return { file: null, why: 'not an object', dropped: 0 };
  const version = raw.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return { file: null, why: 'no version', dropped: 0 };
  if (version > BODIES_VERSION) return { file: null, why: `version ${version} is a later viewer's (this game reads ${BODIES_VERSION})`, dropped: 0 };
  const count = { dropped: 0 };
  const pictures: Record<string, { kind: string }> = {};
  for (const [name, p] of Object.entries(isObj(raw.pictures) ? raw.pictures : {})) {
    if (/^[A-Za-z0-9][A-Za-z0-9 _-]{0,98}[A-Za-z0-9]?\.(png|jpg)$/.test(name) && isObj(p) && typeof p.kind === 'string' && WORD.test(p.kind) && p.kind !== 'still') pictures[name] = { kind: p.kind };
    else count.dropped++;
  }
  const looks: Record<string, BodyLook> = {};
  for (const [id, l] of Object.entries(isObj(raw.looks) ? raw.looks : {})) {
    if (!KEY.test(id) || !isObj(l)) {
      count.dropped++;
      continue;
    }
    const layers: Record<string, Record<string, Plain>> = {};
    for (const [slot, L] of Object.entries(isObj(l.layers) ? l.layers : {})) {
      if (!KEY.test(slot)) {
        count.dropped++;
        continue;
      }
      layers[slot] = objectOf(keep(L, pictures, count));
    }
    const generated = isObj(l.generated) ? objectOf(keep(l.generated, pictures, count)) : null;
    const air = isObj(l.air) ? objectOf(keep(l.air, pictures, count)) : null;
    looks[id] = {
      name: typeof l.name === 'string' ? l.name.slice(0, 120) : '',
      kind: l.kind === 'dome' || l.kind === 'sheet' ? l.kind : 'sphere',
      layers,
      adjust: objectOf(keep(l.adjust, pictures, count)),
      generated,
      air,
    };
  }
  const uses: Record<string, string> = {};
  for (const [place, id] of Object.entries(isObj(raw.uses) ? raw.uses : {})) {
    if (KEY.test(place) && typeof id === 'string' && Object.prototype.hasOwnProperty.call(looks, id)) uses[place] = id;
    else count.dropped++;
  }
  const systems: Record<string, Record<string, Plain>> = {};
  for (const [id, s] of Object.entries(isObj(raw.systems) ? raw.systems : {})) {
    if (KEY.test(id) && isObj(s)) systems[id] = objectOf(keep(s, pictures, count));
    else count.dropped++;
  }
  const air: Record<string, Record<string, Plain>> = {};
  for (const [world, a] of Object.entries(isObj(raw.air) ? raw.air : {})) {
    if (/^[a-z0-9_]{1,40}$/.test(world) && isObj(a)) air[world] = objectOf(keep(a, pictures, count));
    else count.dropped++;
  }
  // Pass 2, wave 4b: the bodies held still in a ground sky (additive: a file without the key holds none).
  const held: Record<string, Record<string, HeldBody>> = {};
  for (const [world, bodies] of Object.entries(isObj(raw.held) ? raw.held : {})) {
    if (!/^[a-z0-9_]{1,40}$/.test(world) || !isObj(bodies)) {
      count.dropped++;
      continue;
    }
    const kept: Record<string, HeldBody> = {};
    for (const [id, b] of Object.entries(bodies)) {
      if (!/^[a-z0-9_]{1,40}$/.test(id)) {
        count.dropped++;
        continue;
      }
      const h = cleanHeld(b, HELD_DEATH_STAR, count);
      if (h) kept[id] = h;
    }
    if (Object.keys(kept).length) held[world] = kept;
  }
  const file: BodiesFile = {
    version,
    made: typeof raw.made === 'string' && raw.made.length <= 40 ? raw.made : '',
    credits: typeof raw.credits === 'string' ? raw.credits.replace(/[\u0000-\u001f]/g, ' ').slice(0, 200) : '',
    looks,
    uses,
    systems,
    air,
    pictures,
    held,
  };
  return { file, why: '', dropped: count.dropped };
}

/** The little of a public file's ask this reader uses (`fetchPublic`, or a test's stand-in). */
export type PublicFetch = (path: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> } | null>;

/**
 * The file read at a loading screen (`World.load`, behind the screen): asked fresh every time (a Save to game while the game
 * runs shows at the next screen), kept in `SKY_BODIES`. A file not there, or not the file (the dev server can answer a miss
 * with the page itself), leaves none, quietly; a refused file leaves none and says why once on the console.
 */
export async function readBodiesFile(ask: PublicFetch = (p) => fetchPublic(p, { cache: 'no-store' }) as ReturnType<PublicFetch>): Promise<BodiesFile | null> {
  SKY_BODIES.reads++;
  SKY_BODIES.at = new Date().toISOString();
  let res: Awaited<ReturnType<PublicFetch>> = null;
  try {
    res = await ask(BODIES_PATH);
  } catch {
    res = null;
  }
  if (!res || !res.ok) {
    SKY_BODIES.file = null;
    SKY_BODIES.dropped = 0;
    SKY_BODIES.why = res ? `no file (${res.status})` : 'no file in this build';
    return null;
  }
  let raw: unknown = null;
  try {
    raw = JSON.parse(await res.text());
  } catch {
    SKY_BODIES.file = null;
    SKY_BODIES.dropped = 0;
    SKY_BODIES.why = 'not the file (no JSON)';
    return null;
  }
  const c = cleanBodiesFile(raw);
  SKY_BODIES.file = c.file;
  SKY_BODIES.dropped = c.dropped;
  SKY_BODIES.why = c.why;
  if (!c.file) console.warn(`sky: ${BODIES_PATH} refused: ${c.why}`);
  return c.file;
}

/** The look a place wears by his Save to game, or null (SWG's, or a placeholder of the bodies' own). */
export function bodyLookOf(placeId: string): BodyLook | null {
  const f = SKY_BODIES.file;
  const id = f?.uses[placeId];
  return id ? (f!.looks[id] ?? null) : null;
}

/** A ground world's air dials by his Save to game (the look its planet wears in its space zone), or null. */
export function bodyAirOf(world: string): Record<string, Plain> | null {
  return SKY_BODIES.file?.air[world] ?? null;
}

/** What `__debug.sky({ bodies: true })` says of the file. */
export function bodiesReport(): Record<string, unknown> {
  const f = SKY_BODIES.file;
  return {
    path: BODIES_PATH,
    reads: SKY_BODIES.reads,
    at: SKY_BODIES.at,
    file: f
      ? {
          version: f.version,
          made: f.made,
          credits: f.credits,
          looks: Object.keys(f.looks).length,
          generated: Object.values(f.looks).filter((l) => l.generated).length,
          uses: Object.keys(f.uses).length,
          systems: Object.keys(f.systems),
          air: Object.keys(f.air),
          pictures: Object.keys(f.pictures),
          held: Object.fromEntries(Object.entries(f.held).map(([w, b]) => [w, Object.keys(b)])),
          dropped: SKY_BODIES.dropped,
        }
      : null,
    why: SKY_BODIES.why,
    airApplied: { ...FILE_AIR.report },
  };
}

// ---------------------------------------------------------------- the saved air in the game (pass 2, wave 4b, maker A)

/** The viewer's air dials that stay the viewer's (the header says why), for the owner's list and the tests. */
export const VIEWER_ONLY_AIR = ['skyColour', 'skyStrength', 'ozone', 'limbBright', 'twilightBright', 'limbDark', 'glint', 'glintRough', 'cloudRelief', 'cloudForward', 'cloudShadow', 'nightFill', 'mode'] as const;

/** The game's dials a saved air sets (`tuneAirDials`' own names). */
export interface FileAirDials {
  visibilityKm?: number;
  hazeR?: number;
  hazeG?: number;
  hazeB?: number;
}

/** The haze colour as its three shares (the viewer's `hazeTintFromHex`, number for number: linear channels over the brightest). */
export function hazeSharesOf(hex: string): [number, number, number] | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const r = lin(((n >> 16) & 255) / 255);
  const g = lin(((n >> 8) & 255) / 255);
  const b = lin((n & 255) / 255);
  const m = Math.max(r, g, b);
  if (!(m > 1e-6)) return [1, 1, 1];
  return [r / m, g / m, b / m];
}

/**
 * A viewer look's air (the file's `air[world]`) as the game takes it: the game's dials it twins, the record fields it names,
 * and the dials it held or left to the viewer (the header's mapping). Numbers outside a range are held to it.
 */
export function gameAirOf(air: Record<string, Plain> | null | undefined): { dials: FileAirDials; fields: AirFileFields; viewerOnly: string[] } {
  const dials: FileAirDials = {};
  const fields: AirFileFields = {};
  const viewerOnly: string[] = [];
  if (!air || typeof air !== 'object') return { dials, fields, viewerOnly };
  const num = (k: string): number | null => {
    const v = air[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const vis = num('visibilityKm');
  if (vis !== null) {
    const [lo, hi] = AIR_DIAL_RANGE.visibilityKm;
    dials.visibilityKm = vis < lo ? lo : vis > hi ? hi : vis;
  }
  if (typeof air.hazeColour === 'string') {
    const t = hazeSharesOf(air.hazeColour);
    if (t) {
      dials.hazeR = t[0];
      dials.hazeG = t[1];
      dials.hazeB = t[2];
    }
  }
  // The viewer's own ranges (airProfile.js's AIR_DIALS), so a file edited by hand stays within what the viewer offers.
  const span: Record<(typeof AIR_FILE_FIELD_NAMES)[number], [number, number]> = {
    radiusKm: [200, 80000],
    thicknessKm: [5, 3000],
    rayleighHeightKm: [0.5, 120],
    hazeHeightKm: [0.1, 60],
    hazeG: [0, 0.95],
    hazeAlbedo: [0.2, 1],
    groundAlbedo: [0, 1],
  };
  for (const k of AIR_FILE_FIELD_NAMES) {
    const v = num(k);
    if (v === null) continue;
    const [lo, hi] = span[k];
    fields[k] = v < lo ? lo : v > hi ? hi : v;
  }
  for (const k of VIEWER_ONLY_AIR) if (air[k] !== undefined) viewerOnly.push(k);
  return { dials, fields, viewerOnly };
}

/** What the last screen's saved air set, and what it found the dials at before, so a later file that drops a world puts them back. */
const FILE_AIR: { set: Record<string, { before: FileAirDials; to: FileAirDials }>; report: Record<string, unknown> } = { set: {}, report: {} };

/**
 * The file's saved air made each named world's air (behind a loading screen, before the world's air is made): its dials set
 * as the live dials set them (`tuneAirDials`) and its record fields laid (`setAirFileFields`). What an earlier screen set for a
 * world the file no longer names is put back first, where the owner has not moved it since. With no file, or a file naming no
 * world, nothing is touched: every sky as before.
 */
export function applyFileAir(file: BodiesFile | null = SKY_BODIES.file): Record<string, unknown> {
  const named = file ? file.air : {};
  // Undo what an earlier screen set, dial by dial, where the dial still stands where the file put it.
  for (const [world, was] of Object.entries(FILE_AIR.set)) {
    const now = airDialsOf(world) as unknown as Record<string, number>;
    const back: Record<string, number> = {};
    for (const [k, v] of Object.entries(was.to)) if (now[k] === v) back[k] = (was.before as Record<string, number>)[k];
    if (Object.keys(back).length) tuneAirDials({ [world]: back });
    setAirFileFields(world, null);
  }
  FILE_AIR.set = {};
  const report: Record<string, unknown> = {};
  for (const [world, air] of Object.entries(named)) {
    const g = gameAirOf(air);
    const before: Record<string, number> = {};
    const d = airDialsOf(world) as unknown as Record<string, number>;
    for (const k of Object.keys(g.dials)) before[k] = d[k];
    if (Object.keys(g.dials).length) tuneAirDials({ [world]: g.dials as Record<string, number> });
    const to: Record<string, number> = {};
    const after = airDialsOf(world) as unknown as Record<string, number>;
    for (const k of Object.keys(g.dials)) to[k] = after[k];
    FILE_AIR.set[world] = { before: before as FileAirDials, to: to as FileAirDials };
    setAirFileFields(world, g.fields);
    report[world] = { dials: g.dials, fields: g.fields, viewerOnly: g.viewerOnly };
  }
  FILE_AIR.report = report;
  return report;
}
