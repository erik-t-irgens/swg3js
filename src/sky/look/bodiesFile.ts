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
// **Nothing draws from it yet.** Wave 4a reads, keeps and reports it (`__debug.sky({ bodies: true })`); the bodies still draw
// SWG's pictures with each ground world's own air at its own dials (`bodyAir.ts`), and the air a look carries for a ground
// world reaches neither that world's sky nor its rim. Wiring it in (a place's look onto its body, a ground world's saved air
// onto its dials, the applied systems) is a later wave's (4b's looks, 5's systems), and how the viewer's air dials map onto
// the game's (its visibility and haze colour have a twin there; its sky colour, thickness and the rest do not) is the
// owner's to settle first. `bodyLookOf` and `bodyAirOf` are that wiring's readers, waiting for it.
//
// Rule for this file (node runs it with type stripping for the tests): every value import with its `.ts` extension,
// nothing that touches the page at load.

import { fetchPublic } from '../../world/packFiles.ts';

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
  const file: BodiesFile = {
    version,
    made: typeof raw.made === 'string' && raw.made.length <= 40 ? raw.made : '',
    credits: typeof raw.credits === 'string' ? raw.credits.replace(/[\u0000-\u001f]/g, ' ').slice(0, 200) : '',
    looks,
    uses,
    systems,
    air,
    pictures,
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
          dropped: SKY_BODIES.dropped,
        }
      : null,
    why: SKY_BODIES.why,
  };
}
