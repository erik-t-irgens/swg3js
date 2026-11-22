// `__debug.sky({ match })` (the GPU port's pass 2, wave 2; the owner's answer 2 of 21 November): one frame shown the same in
// two tabs, so he can match Tatooine's sky by eye against SWG's at the same spot, hour, weather and camera. The first call by a
// name saves where the player stands, the camera's place, turn and field of view, the hour and the weather under that name in
// the browser's storage, which every tab of the same address shares, and holds them; the same call in another tab
// (`?renderer=webgl`, or a WebGPU tab started with the Sky row at SWG's) travels there behind a loading screen and puts the
// camera, the hour and the weather exactly as saved, each held. `{ match: null }` lets go; `{ matches: true }` lists them.
//
// This file is the record and its keeping, pure (no three, no DOM: the storage is handed in), so a node test holds the
// record's shape, a save read back, a bad record refused and the list. The game's side (the travel, the hold of the camera,
// the hour and the weather) is `main.ts`'s `skyMatch`.

/** Where the matches are kept in the browser's storage (shared by every tab of one address). */
export const MATCH_KEY = 'swg.skyMatch';

/** One saved frame. */
export interface SkyMatch {
  name: string;
  /** When it was saved (ISO). */
  saved: string;
  /** The renderer and sky of the tab that saved it (words, for the list). */
  from: string;
  /** The world (`PLANETS` id), its zone (a space zone or a dungeon; null on a planet) and its pack. */
  planet: string;
  zone: string | null;
  pack: string;
  /** Where the player stood, metres, and the heading, radians. */
  stand: { x: number; y: number; z: number; heading: number };
  /** The camera's place (metres), its turn (a unit quaternion) and its upright field of view (degrees). */
  camera: { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number; fov: number };
  /** The day's time (`DayCycle.time`, 0 midnight, 0.5 noon), held. */
  time: number;
  /** The weather's level, its forced kind and the family it held, or null where the world has none. */
  weather: { level: number; kind: string | null; family: string | null } | null;
}

/** A storage's reading and writing (the browser's `localStorage`, or a stand-in). */
export interface MatchStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Whether a value read back is a whole match record (a hand-edited or older one is refused, never half used). */
export function isMatch(v: unknown): v is SkyMatch {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  const s = m.stand as Record<string, unknown> | undefined;
  const c = m.camera as Record<string, unknown> | undefined;
  const w = m.weather as Record<string, unknown> | null | undefined;
  return (
    typeof m.name === 'string' &&
    m.name.length > 0 &&
    typeof m.planet === 'string' &&
    (m.zone === null || typeof m.zone === 'string') &&
    typeof m.pack === 'string' &&
    !!s &&
    finite(s.x) &&
    finite(s.y) &&
    finite(s.z) &&
    finite(s.heading) &&
    !!c &&
    finite(c.x) &&
    finite(c.y) &&
    finite(c.z) &&
    finite(c.qx) &&
    finite(c.qy) &&
    finite(c.qz) &&
    finite(c.qw) &&
    finite(c.fov) &&
    c.fov > 1 &&
    c.fov < 179 &&
    finite(m.time) &&
    (w === null || (!!w && finite(w.level) && (w.kind === null || typeof w.kind === 'string') && (w.family === null || typeof w.family === 'string')))
  );
}

/** Every match kept, by name (anything not a whole record left out). */
export function readMatches(store: MatchStore | null): Record<string, SkyMatch> {
  const out: Record<string, SkyMatch> = {};
  if (!store) return out;
  let raw: unknown = null;
  try {
    raw = JSON.parse(store.getItem(MATCH_KEY) ?? '{}');
  } catch {
    return out;
  }
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (isMatch(v) && v.name === k) out[k] = v;
  return out;
}

/** A match kept under its name (replacing one of the same name); false where the storage refused it. */
export function saveMatch(store: MatchStore | null, m: SkyMatch): boolean {
  if (!store || !isMatch(m)) return false;
  const all = readMatches(store);
  all[m.name] = m;
  try {
    store.setItem(MATCH_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

/** A match let go of; false where there was none or the storage refused. */
export function forgetMatch(store: MatchStore | null, name: string): boolean {
  if (!store) return false;
  const all = readMatches(store);
  if (!all[name]) return false;
  delete all[name];
  try {
    store.setItem(MATCH_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

/** The list `{ matches: true }` answers: one line a match. */
export function matchList(store: MatchStore | null): { name: string; where: string; hour: string; saved: string; from: string }[] {
  return Object.values(readMatches(store)).map((m) => ({ name: m.name, where: `${m.planet}${m.zone ? ` (${m.zone})` : ''} at ${m.stand.x.toFixed(1)}, ${m.stand.y.toFixed(1)}, ${m.stand.z.toFixed(1)}`, hour: clockOf(m.time), saved: m.saved, from: m.from }));
}

/** A day's time as the clock's words (00:00 midnight, 12:00 noon). */
export function clockOf(time: number): string {
  const t = ((time % 1) + 1) % 1;
  const mins = Math.round(t * 24 * 60) % (24 * 60);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/**
 * The camera hold while a match stands (`main.ts` puts the camera here every frame and skips its own placing): the place, the
 * turn and the field of view, kept numbers, so a frame of the hold makes nothing.
 */
export const MATCH_HOLD = { on: false, name: '', x: 0.5, y: 0.5, z: 0.5, qx: 0.5, qy: 0.5, qz: 0.5, qw: 0.5, fov: 60.5 };

/** The hold set from a record. */
export function holdFrom(m: SkyMatch): void {
  const h = MATCH_HOLD;
  h.name = m.name;
  h.x = m.camera.x;
  h.y = m.camera.y;
  h.z = m.camera.z;
  h.qx = m.camera.qx;
  h.qy = m.camera.qy;
  h.qz = m.camera.qz;
  h.qw = m.camera.qw;
  h.fov = m.camera.fov;
  h.on = true;
}
