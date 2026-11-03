// The rooms' lights edited (Map-maker II's wave of the rooms' lights, the owner's of 2026-11-02): two files the world editor
// writes and every browser reads, shipped with the build as every placements file is.
//
//   public/placements/lights/<world>.json   one copy of a building, every copy of a building on this world, and lights put
//                                            down outdoors (a mark this pass: they light nothing until the Light and shadow
//                                            pass's outdoor pool)
//   public/placements/lights.json           every copy of a building everywhere (one file every world shares, beside
//                                            `solid.json`)
//
//   { "version": 1, "world": "tatooine", "frame": "raw",
//     "rows": [
//       { "id": "dim-cantina", "kind": "fill", "scope": "copy", "copy": "o:object/building/tatooine/shared_cantina_tatooine.iff@3331,4.2,-4801", "model": "mos_eisley_cantina", "cell": 4, "room": "cantina", "scale": 0.6 },
//       { "id": "candle-1", "kind": "light", "scope": "world", "model": "mos_eisley_cantina", "cell": 4, "room": "cantina", "type": "point", "color": [1, 0.7, 0.4], "brightness": 0.3, "reach": 6, "flicker": { "shape": "candle", "rate": 6, "depth": 0.3 }, "pos": [2, 1.1, -3] },
//       { "id": "bar-lamp", "kind": "edit", "scope": "copy", "copy": "...", "model": "mos_eisley_cantina", "cell": 4, "room": "cantina", "of": 2, "off": true }
//     ] }
//
// **A row edits one room at one scope**, and a room is named by its building's model and the client's own cell name and
// index, never by a place: `copy` names one copy (the twelfth wave's content key of one of the world's own objects,
// `o:<template>@x,y,z[#n]`, or a permanent row of the owner's, `place/<id>`), `world` every copy of the model on this world,
// `all` (the shared file alone) every copy anywhere; the narrowest wins (`src/world/roomLightEdits.ts`). Its kind says what it
// does: **`edit`** one light of the room -- one of the game's own by its index in the cell's own list (`of`, a number), or one
// added at a wider scope by its row's id (`of`, a string) -- switched `off`, its brightness `scale`d, its `color` or its
// `reach` put in place of its own, a `shadow` asked for or taken back; **`fill`** the room's fill (its ambient): its own `color` in place of the cell's and a
// `scale`; **`light`** a light added (`src/story/lightSpec.ts`), at `pos` in the building's own frame (so every copy of its
// scope gets it in its own place) and turned by `q` (`[w, x, y, z]`, a spot's or a directional's way, absent for straight
// down). A light whose scope is `outdoor` stands at `pos` in the file's own frame (raw on a planet, the game's in space), `y`
// absolute, with no building, model or room.
//
// **Ids**: one space for the two files, kept apart by spelling: the shared file's begin `all-` and a world's never do, so an
// `edit` naming another scope's light names one light whichever file holds it. A row with no id is given one from its kind.
//
// Pure: imports only the story's JSONC reader and the light reader. Rule for this file (node runs it with type stripping):
// every import with its `.ts` extension, no enum, no namespace, no constructor parameter properties.

import { parseJsonc } from '../../story/jsonc.ts';
import { lightSpecFields, readLightColour, readLightSpec, type LightSpec } from '../../story/lightSpec.ts';

export const LIGHTS_FILE_VERSION = 1;

/** What a row does to its room. */
export type LightRowKind = 'edit' | 'fill' | 'light';
export const LIGHT_ROW_KINDS: readonly LightRowKind[] = ['edit', 'fill', 'light'];

/** How far a row reaches, narrowest first. */
export type LightScope = 'copy' | 'world' | 'all' | 'outdoor';
export const LIGHT_SCOPES: readonly LightScope[] = ['copy', 'world', 'all', 'outdoor'];

/** The shared file's ids begin with this, and a world's never do. */
export const ALL_ID_PREFIX = 'all-';

/** The reader's backstops (ours): every build holds a file to them alike, so none is live. */
export const LIGHTS_LIMITS = {
  rows: 4096,
  /** A room's index: the client's buildings run to about two hundred cells. */
  cell: 4095,
  /** How far from its building's origin a light may stand, metres (the Star Destroyer's rooms reach about 800). */
  reach: 2000,
  /** An outdoor light's place, metres (as a row's). */
  far: 100000,
  /** The most a game light's brightness may be scaled, and the least a reach put in place may be. */
  scaleMost: 100,
  reachLeast: 0.25,
  reachMost: 200,
  name: 80,
  note: 400,
  copy: 300,
  room: 80,
  /** How far a turn's length may be off one. */
  unit: 1e-3,
};

/** One row of a lights file, as read and cleaned. A light's own fields are the row's (`LightSpec`), present on a `light` row alone. */
export interface LightRow {
  id: string;
  kind: LightRowKind;
  scope: LightScope;
  /** The copy it edits (`copy` scope): one of the world's own objects' content key, or `place/<id>`. */
  copy?: string;
  /** The building's model, the room's index and its own name (every scope but `outdoor`). */
  model?: string;
  cell?: number;
  room?: string;
  /** An `edit`: the light it edits (a game light's index in its cell, or an added light's row id) and what it does. */
  of?: number | string;
  off?: true;
  scale?: number;
  color?: [number, number, number];
  reach?: number;
  /** A `light`: what it is (`LightSpec`'s fields but `color` and `reach`, above), where it stands and how it is turned. */
  type?: LightSpec['type'];
  brightness?: number;
  falloff?: number;
  cone?: [number, number];
  /** A light's own (true, or absent); an edit's asked for or taken back. */
  shadow?: boolean;
  flicker?: LightSpec['flicker'];
  pos?: [number, number, number];
  q?: [number, number, number, number];
  name?: string;
  note?: string;
  at?: number;
}

export interface LightsRead {
  rows: LightRow[];
  skipped: { id: string; why: string }[];
  unknown: string[];
  problem: string | null;
}

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MODEL = /^[A-Za-z0-9_./-]{1,160}$/;
/** A copy's key: one of the world's own objects' content key (as the twelfth wave spells it, never a piece's), or a permanent row's. */
const COPY = /^(?:o:object\/[A-Za-z0-9_/.-]+\.iff@-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?(?:#\d+)?|place\/[a-z0-9][a-z0-9_-]{0,63})$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const ORDER: (keyof LightRow)[] = ['id', 'kind', 'scope', 'copy', 'model', 'cell', 'room', 'of', 'type', 'off', 'scale', 'color', 'brightness', 'reach', 'falloff', 'cone', 'shadow', 'flicker', 'pos', 'q', 'name', 'note', 'at'];
const FIELDS = new Set<string>(ORDER);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Whether an id is one a row may carry, in a world's file (`shared` false) or the shared one. */
export function isLightId(v: unknown, shared?: boolean): v is string {
  if (typeof v !== 'string' || !ID.test(v)) return false;
  if (shared === undefined) return true;
  return shared === v.startsWith(ALL_ID_PREFIX);
}

/** Whether a copy key is one a row may name. */
export function isCopyKey(v: unknown): v is string {
  return typeof v === 'string' && v.length <= LIGHTS_LIMITS.copy && COPY.test(v);
}

/** A fresh id from a base (a light's name, its kind), unique among `taken`: its words in lower case joined by `-`, numbered from 1; `all-` first in the shared file. */
export function mintLightId(base: string, taken: ReadonlySet<string>, shared: boolean): string {
  const stem = (base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'light').slice(0, 52);
  const plain = /^[a-z0-9]/.test(stem) ? stem : `light-${stem}`;
  const s = shared ? (plain.startsWith(ALL_ID_PREFIX) ? plain : ALL_ID_PREFIX + plain) : plain.startsWith(ALL_ID_PREFIX) ? `room-${plain}` : plain;
  for (let n = 1; ; n++) {
    const id = `${s}-${n}`;
    if (!taken.has(id)) return id;
  }
}

/** Three numbers within `most` of nought, or why not. */
function readPlace(v: unknown, most: number, what: string): [number, number, number] | string {
  if (!Array.isArray(v) || v.length !== 3) return `its ${what} is three numbers (x, y, z)`;
  const out: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const c = num(v[i]);
    if (c === undefined || Math.abs(c) > most) return `its ${what} is within ${most} m`;
    out[i] = c;
  }
  return out;
}

/**
 * One row cleaned, or why it is refused. `shared` says which file it is read from (the shared file's rows are `all` and
 * nothing else; a world's are never `all`). A field this build does not read is kept out and named in `unknown`.
 */
export function readLightRow(v: unknown, shared: boolean, unknown: string[] = []): LightRow | string {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'a row is an object';
  const o = v as Record<string, unknown>;
  if (!isLightId(o.id)) return 'its id is not a-z, 0-9, _ and - (64 at most, starting with a letter or a digit)';
  const id = o.id;
  if (!isLightId(id, shared)) return shared ? `an id of the shared file begins ${ALL_ID_PREFIX}` : `an id beginning ${ALL_ID_PREFIX} is the shared file's`;
  for (const k of Object.keys(o)) if (!FIELDS.has(k)) unknown.push(`${id}.${k}`);
  if (!(LIGHT_ROW_KINDS as readonly unknown[]).includes(o.kind)) return `its kind is ${LIGHT_ROW_KINDS.join(', ')}`;
  const kind = o.kind as LightRowKind;
  if (!(LIGHT_SCOPES as readonly unknown[]).includes(o.scope)) return `its scope is ${LIGHT_SCOPES.join(', ')}`;
  const scope = o.scope as LightScope;
  if (shared && scope !== 'all') return 'the shared file holds the rows of every copy everywhere (scope all) and nothing else';
  if (!shared && scope === 'all') return "every copy everywhere is the shared file's (public/placements/lights.json)";
  const row: LightRow = { id, kind, scope };
  if (scope === 'outdoor') {
    if (kind !== 'light') return 'outdoors there is no room to edit: an outdoor row is a light';
    for (const k of ['copy', 'model', 'cell', 'room'] as const) if (o[k] !== undefined) return `an outdoor light names no ${k}`;
  } else {
    if (scope === 'copy') {
      if (!isCopyKey(o.copy)) return "its copy is one of the world's own objects' key (o:<template>@x,y,z) or a permanent row's (place/<id>)";
      row.copy = o.copy;
    } else if (o.copy !== undefined) return 'only a row of one copy names its copy';
    if (typeof o.model !== 'string' || !MODEL.test(o.model)) return "its model is the building's model id";
    row.model = o.model;
    const c = num(o.cell);
    if (c === undefined || !Number.isInteger(c) || c < 1 || c > LIGHTS_LIMITS.cell) return `its cell is a room's index, 1 to ${LIGHTS_LIMITS.cell} (0 is the outside)`;
    row.cell = c;
    if (typeof o.room !== 'string' || !o.room || o.room.length > LIGHTS_LIMITS.room || CONTROL.test(o.room)) return "its room is the cell's own name";
    row.room = o.room;
  }
  const L = LIGHTS_LIMITS;
  const readScale = (): string | null => {
    if (o.scale === undefined) return null;
    const s = num(o.scale);
    if (s === undefined || s < 0 || s > L.scaleMost) return `its scale is 0 to ${L.scaleMost}`;
    // One is no scale at all, written absent.
    if (s !== 1) row.scale = s;
    return null;
  };
  const readColour = (): string | null => {
    if (o.color === undefined) return null;
    const c = readLightColour(o.color, 'colour');
    if (typeof c === 'string') return c;
    row.color = c;
    return null;
  };
  if (kind === 'edit') {
    if (typeof o.of === 'number') {
      if (!Number.isInteger(o.of) || o.of < 0 || o.of > 4095) return "its of is a game light's index in its cell (0 up) or an added light's id";
      row.of = o.of;
    } else if (isLightId(o.of)) row.of = o.of;
    else return "its of is a game light's index in its cell (0 up) or an added light's id";
    if (o.off !== undefined) {
      if (o.off !== true && o.off !== false) return 'its off is true or false';
      if (o.off) row.off = true;
    }
    const bad = readScale() ?? readColour();
    if (bad) return bad;
    if (o.reach !== undefined) {
      const r = num(o.reach);
      if (r === undefined || r < L.reachLeast || r > L.reachMost) return `its reach is ${L.reachLeast} to ${L.reachMost} m`;
      row.reach = r;
    }
    // A shadow asked for (a game lamp's) or taken back (an added light's, for this scope alone): both are words of their own.
    if (o.shadow !== undefined) {
      if (o.shadow !== true && o.shadow !== false) return 'its shadow is true or false';
      row.shadow = o.shadow;
    }
    for (const k of ['type', 'brightness', 'falloff', 'cone', 'flicker', 'pos', 'q'] as const) if (o[k] !== undefined) return `an edit carries no ${k} (only off, scale, color, reach and shadow)`;
    if (!row.off && row.scale === undefined && !row.color && row.reach === undefined && row.shadow === undefined) return 'an edit does something: off, scale, color, reach or shadow';
  } else if (kind === 'fill') {
    if (o.of !== undefined || o.off !== undefined || o.reach !== undefined) return 'a fill carries scale and color alone';
    const bad = readScale() ?? readColour();
    if (bad) return bad;
    for (const k of ['type', 'brightness', 'falloff', 'cone', 'shadow', 'flicker', 'pos', 'q'] as const) if (o[k] !== undefined) return `a fill carries no ${k} (only scale and color)`;
    if (row.scale === undefined && !row.color) return 'a fill does something: scale or color';
  } else {
    if (o.of !== undefined || o.off !== undefined || o.scale !== undefined) return 'a light carries no of, off or scale (its own brightness is its own)';
    const spec = readLightSpec(o);
    if (typeof spec === 'string') return spec;
    Object.assign(row, lightSpecFields(spec));
    const pos = readPlace(o.pos, scope === 'outdoor' ? L.far : L.reach, 'pos');
    if (typeof pos === 'string') return pos;
    row.pos = pos;
    if (o.q !== undefined) {
      const q = o.q;
      if (!Array.isArray(q) || q.length !== 4 || q.some((c) => num(c) === undefined)) return 'its q is a turn, [w, x, y, z]';
      const len = Math.sqrt((q[0] as number) ** 2 + (q[1] as number) ** 2 + (q[2] as number) ** 2 + (q[3] as number) ** 2);
      if (!(Math.abs(len - 1) <= L.unit)) return 'its q is a turn of length one';
      const n = Math.abs(len - 1) > 1e-12 ? len : 1;
      const t: [number, number, number, number] = [(q[0] as number) / n, (q[1] as number) / n, (q[2] as number) / n, (q[3] as number) / n];
      // No turn at all is written absent.
      if (!(t[0] === 1 && t[1] === 0 && t[2] === 0 && t[3] === 0)) row.q = t;
    }
  }
  if (o.name !== undefined) {
    if (typeof o.name !== 'string' || o.name.length > L.name || CONTROL.test(o.name)) return `its name is words of ${L.name} characters at most`;
    if (o.name) row.name = o.name;
  }
  if (o.note !== undefined) {
    if (typeof o.note !== 'string' || o.note.length > L.note) return `its note is words of ${L.note} characters at most`;
    if (o.note) row.note = o.note;
  }
  if (o.at !== undefined) {
    if (typeof o.at !== 'number' || !Number.isFinite(o.at) || o.at < 0) return 'its at is a time in milliseconds';
    row.at = o.at;
  }
  return row;
}

/** A light row's own light, as the pool and the editor read it (`LightSpec`); null for a row that is no light. */
export function specOfRow(r: LightRow): LightSpec | null {
  if (r.kind !== 'light' || !r.type || !r.color || r.brightness === undefined) return null;
  const s: LightSpec = { type: r.type, color: r.color, brightness: r.brightness };
  if (r.reach !== undefined) s.reach = r.reach;
  if (r.falloff !== undefined) s.falloff = r.falloff;
  if (r.cone) s.cone = r.cone;
  if (r.shadow) s.shadow = true;
  if (r.flicker) s.flicker = r.flicker;
  return s;
}

/** The file's frame a world's file is written in: raw on a planet, the game's in space. */
export function lightsFrameOf(kindOfWorld: 'ground' | 'space'): 'raw' | 'game' {
  return kindOfWorld === 'space' ? 'game' : 'raw';
}

/**
 * Read a lights file: a world's (`world` its pack id, its header naming that world and its frame) or the shared one (`world`
 * null: no world, no frame). Every row a row, one past the backstop or a second of an id skipped and named.
 */
export function readLightsFile(text: string, world: string | null, kindOfWorld: 'ground' | 'space', raws?: Record<string, unknown>[]): LightsRead {
  const out: LightsRead = { rows: [], skipped: [], unknown: [], problem: null };
  const doc = parseJsonc(text);
  if (doc.error) {
    out.problem = `it does not read (line ${doc.error.line}, column ${doc.error.col}: ${doc.error.message})`;
    return out;
  }
  const v = doc.value as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    out.problem = 'it is not an object';
    return out;
  }
  if (v.version !== LIGHTS_FILE_VERSION) {
    out.problem = `its version is not ${LIGHTS_FILE_VERSION}`;
    return out;
  }
  const shared = world === null;
  if (!shared) {
    if (v.world !== world) {
      out.problem = `it says it is ${typeof v.world === 'string' ? v.world : 'no world'}'s, and its name says ${world}'s`;
      return out;
    }
    const frame = lightsFrameOf(kindOfWorld);
    if (v.frame !== frame) {
      out.problem = `a ${kindOfWorld === 'space' ? 'space zone' : 'world on the ground'} is written in the ${frame} frame, and it says ${typeof v.frame === 'string' ? v.frame : 'none'}`;
      return out;
    }
  } else if (v.world !== undefined || v.frame !== undefined) {
    out.problem = "the shared file is every world's: it names no world and no frame";
    return out;
  }
  if (!Array.isArray(v.rows)) {
    out.problem = 'it has no rows list';
    return out;
  }
  const seen = new Set<string>();
  for (let i = 0; i < v.rows.length; i++) {
    const raw = v.rows[i];
    const named = raw && typeof raw === 'object' && isLightId((raw as { id?: unknown }).id) ? (raw as { id: string }).id : `#${i}`;
    if (out.rows.length >= LIGHTS_LIMITS.rows) {
      out.skipped.push({ id: named, why: `past the ${LIGHTS_LIMITS.rows} rows a file may hold` });
      continue;
    }
    const row = readLightRow(raw, shared, out.unknown);
    if (typeof row === 'string') {
      out.skipped.push({ id: named, why: row });
      continue;
    }
    if (seen.has(row.id)) {
      out.skipped.push({ id: row.id, why: 'a second row under the same id' });
      continue;
    }
    seen.add(row.id);
    out.rows.push(row);
    raws?.push(raw as Record<string, unknown>);
  }
  return out;
}

/** A whole file's text: one line a row, sorted by id, each row's fields in one fixed order (extras after them). */
export function lightsFileText(world: string | null, frame: 'raw' | 'game', rows: readonly Record<string, unknown>[]): string {
  const sorted = [...rows].sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
  const lines = sorted.map((r) => {
    const parts: string[] = [];
    for (const k of ORDER) if (r[k] !== undefined) parts.push(`${JSON.stringify(k)}: ${JSON.stringify(r[k])}`);
    for (const k of Object.keys(r)) if (!FIELDS.has(k) && r[k] !== undefined) parts.push(`${JSON.stringify(k)}: ${JSON.stringify(r[k])}`);
    return `    { ${parts.join(', ')} }`;
  });
  const body = lines.length ? `[\n${lines.join(',\n')}\n  ]` : '[]';
  const head = world === null ? '' : `\n  "world": ${JSON.stringify(world)},\n  "frame": ${JSON.stringify(frame)},`;
  return `{\n  "version": ${LIGHTS_FILE_VERSION},${head}\n  "rows": ${body}\n}\n`;
}

/** A row as one canonical text of what it does and says (never its time): what two rows are compared by. */
function rowContent(r: LightRow): string {
  const out: unknown[] = [];
  for (const k of ORDER) if (k !== 'at') out.push(r[k] ?? null);
  return JSON.stringify(out);
}

/** Two rows that do and read the same. */
export function sameLightRow(a: LightRow, b: LightRow): boolean {
  return a.id === b.id && rowContent(a) === rowContent(b) && (a.at ?? null) === (b.at ?? null);
}

/** A cleaned row to write, carrying what the row it replaces held that this build does not read. */
export function lightWithExtras(row: LightRow, was: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  if (was) for (const k of Object.keys(was)) if (!FIELDS.has(k) && !(k in out)) out[k] = was[k];
  return out;
}

/** Whether a row names a room: every scope but `outdoor`. */
export function roomRow(r: LightRow): boolean {
  return r.scope !== 'outdoor';
}
