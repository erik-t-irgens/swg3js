// The debug menu's own arithmetic: which group a helper is shown in, what a search finds, how the
// arguments typed into its box become the call's arguments, how whatever the call answers is shown,
// what the console said while it ran, and what is kept of the history and the pinned calls.
//
// Pure: no DOM and nothing imported, so a node test runs every piece of it as the menu does. The
// three.js objects a helper can answer with are recognised by the flags three sets on them
// (`isVector3`, `isObject3D`, ...), never by importing three.

/** Every number of the menu's that is ours. None of it is the game's; nothing here is saved. */
export const DEBUG_MENU_TUNE = {
  /** Calls kept in the history, newest first. */
  historyMax: 30,
  /** Calls that may be pinned. */
  pinnedMax: 60,
  /** Entries of one object or list shown before the rest is summed up as "… N more". */
  entriesShown: 100,
  /** A branch with more entries than this starts folded. */
  openEntries: 16,
  /** Branches this deep or deeper start folded whatever their size (the answer itself is depth 0). */
  openDepth: 2,
  /** A string longer than this is cut, and says how long it was. */
  stringMax: 4000,
  /** How long the one-line preview beside a folded branch may run. */
  previewChars: 90,
  /** Console lines kept from one call; the rest are counted. */
  consoleMax: 400,
  /** How often the lines and the clock are written while a call is waited on, in milliseconds. */
  flushMs: 500,
  /** Milliseconds the game's keys stand aside after Escape has shut the menu from a typed line. */
  escapeHoldMs: 400,
};

// ---- groups and search ---------------------------------------------------------------------------

/**
 * Where each helper is listed. A helper named in no group is listed under "Other", so one added to
 * `__debug` later still shows; a window knob is written with its own name (`__sharedDay`).
 */
export const DEBUG_GROUPS: readonly { title: string; helpers: readonly string[] }[] = [
  { title: 'Where and when', helpers: ['teleport', 'teleportSwg', 'swg', 'look', 'zoom', 'mouse', 'cell', 'near', 'find', 'player', 'scene', 'time', 'day', 'fog', 'advance', 'advanceCost', 'breakFrames', 'map', 'mapGroup', 'galaxy', 'spaceMap', 'travel', 'gates', 'doorless', 'buildings', 'enter', 'interiors', 'gallery', 'show', 'character', 'capture', 'captureShip', 'goToShot', 'place', 'placeView', 'placeClock', 'cloning'] },
  { title: 'Travel, homes and trade', helpers: ['shuttle', 'terminal', 'ride', 'rigHull', 'fittings', 'house', 'homes', 'deed', 'prop', 'purse', 'trade'] },
  { title: 'Character and kit', helpers: ['appearance', 'recipe', 'morph', 'species', 'wardrobe', 'wear', 'remove', 'preview', 'closet', 'fpHead', 'headLook', 'mood', 'variant', 'anim', 'upper', 'split', 'steady', 'grip', 'items', 'give', 'use', 'destroy', 'backpack', 'startingKit', 'giveScreens', 'weapons', 'equip', 'heldFx', 'shine', 'select', 'burn', 'breath', 'heal', 'profile', 'gun', 'gunType'] },
  { title: 'Fighting', helpers: ['saber', 'saberDefense', 'guns', 'bolts', 'turrets', 'turret', 'shootPlayer', 'blades', 'clash', 'scars', 'marks', 'powers', 'gadgets', 'forceLightning', 'footprints', 'ragdoll', 'kill', 'god', 'difficulty', 'wreck'] },
  { title: 'Creatures and people', helpers: ['creature', 'fighter', 'fighters', 'cover', 'send', 'nav', 'patrols', 'mobile', 'mobiles', 'mobileRoles', 'mobileAssets', 'mobileTune', 'stepProbe', 'mobileCull', 'wild', 'people', 'ours', 'talk', 'followers'] },
  { title: 'Vehicles and ships', helpers: ['vehicles', 'spawn', 'spawnBox', 'mount', 'unspawn', 'vehicleTune', 'vehicleState', 'hover', 'shipFit', 'refit', 'paint', 'shipEdit', 'ship', 'controls', 'cockpit', 'cockpitFrame', 'seat', 'wings', 'landing', 'dock', 'boots', 'droid', 'shipShadows', 'shipDrift', 'pushBodies', 'flight', 'taunt', 'npcShips', 'npcShip', 'shipCombat'] },
  { title: 'Space', helpers: ['cruise', 'jumps', 'jump', 'jumpState', 'jumpFx', 'nebulae', 'suns'] },
  { title: 'Picture and effects', helpers: ['postfx', 'fxTiming', 'fxView', 'fxCheck', 'fxWarm', 'renderInfo', 'ssao', 'dof', 'previewDof', 'clouds', 'bladeGlow', 'torch', 'heat', 'heatPlume', 'flare', 'flareTune', 'flareProbe', 'faceSun', 'roomAir', 'movers', 'motionProbe', 'motionTune', 'grade', 'gradeSelfTest', 'gradeCheck', 'shadows', 'shadowLook', 'ambient', 'normals', 'gloss', 'reflections', 'blackBox', 'specks', 'underwater', 'particles', 'ribbons', 'animTex'] },
  { title: 'Water, sky and weather', helpers: ['water', 'waterFx', 'waterSurface', 'sea', 'afloat', 'lava', 'ripples', 'fountains', 'weather', 'sky'] },
  { title: 'Frame cost', helpers: ['perf', 'bench', 'cull', 'skeletons', 'farTiles', 'reach', 'lod', 'placed', 'flora', 'passes', 'passLog', 'drawCalls', 'shaders', 'physics', 'props'] },
  { title: 'Sound', helpers: ['audio', 'sound', 'soundGain', 'ambience', 'audioSelfTest', 'footsteps', 'gunSounds', 'vehicleSounds', 'sabers', 'surface', 'band'] },
  { title: 'Display and keys', helpers: ['hud', 'hurt', 'hit', 'say', 'windows', 'bind', 'bindings', 'resetBindings', 'debugMenu'] },
  { title: 'Playing together', helpers: ['session', 'group', 'chat', 'combat', 'together', 'owned', 'npcs', '__sharedDay', '__aboard', '__board', '__peers', '__rooms', '__peerBlades', '__npcs'] },
];

/** The heading a helper nobody filed is listed under. */
export const OTHER_GROUP = 'Other';

/** One helper as the list shows it: its name, where it hangs, and the text a search looks through. */
export interface HelperEntry {
  name: string;
  on: 'debug' | 'window';
  /** The README's words for it, lower-cased once: its rows' first cells and descriptions. */
  haystack: string;
}

/**
 * The helpers in their groups, each group in the table's own order and then anything unfiled in
 * the order it was found. A group with nothing in it is left out.
 */
export function groupHelpers(helpers: readonly HelperEntry[]): { title: string; entries: HelperEntry[] }[] {
  const byName = new Map<string, HelperEntry>();
  for (const h of helpers) byName.set(h.on === 'window' ? `window:${h.name}` : h.name, h);
  const taken = new Set<HelperEntry>();
  const out: { title: string; entries: HelperEntry[] }[] = [];
  for (const g of DEBUG_GROUPS) {
    const entries: HelperEntry[] = [];
    for (const name of g.helpers) {
      const h = byName.get(name.startsWith('__') ? `window:${name}` : name);
      if (h && !taken.has(h)) {
        entries.push(h);
        taken.add(h);
      }
    }
    if (entries.length) out.push({ title: g.title, entries });
  }
  const rest = helpers.filter((h) => !taken.has(h));
  if (rest.length) out.push({ title: OTHER_GROUP, entries: rest });
  return out;
}

/**
 * How well a helper answers a search, lower is better, or -1 when it does not. Every word of the
 * query has to be found, in the name or in the README's words for it; a name that starts with the
 * query comes first, then one that holds it, then one only its description mentions.
 */
export function searchScore(h: HelperEntry, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const name = h.name.toLowerCase();
  const words = q.split(/\s+/);
  let score = 0;
  for (const w of words) {
    if (name === w) continue;
    if (name.startsWith(w)) score += 1;
    else if (name.includes(w)) score += 2;
    else if (h.haystack.includes(w)) score += 4;
    else return -1;
  }
  return score;
}

/**
 * What Enter in the search box picks: the helper that answers the search best, whichever group it is
 * listed in (the name itself before one that starts with it, before one only its row mentions), the
 * list's own order breaking a tie. Null when nothing answers.
 */
export function bestMatch<T extends HelperEntry>(groups: readonly { title: string; entries: T[] }[], query: string): T | null {
  let best: T | null = null;
  let bestScore = Infinity;
  for (const g of groups) {
    for (const h of g.entries) {
      const s = searchScore(h, query);
      if (s >= 0 && s < bestScore) {
        best = h;
        bestScore = s;
      }
    }
  }
  return best;
}

/** The groups again with only what the search finds, each group's own order kept. */
export function filterGroups(groups: readonly { title: string; entries: HelperEntry[] }[], query: string): { title: string; entries: HelperEntry[] }[] {
  if (!query.trim()) return groups.map((g) => ({ title: g.title, entries: g.entries.slice() }));
  const out: { title: string; entries: HelperEntry[] }[] = [];
  for (const g of groups) {
    const hits = g.entries.map((h) => ({ h, s: searchScore(h, query) })).filter((x) => x.s >= 0);
    hits.sort((a, b) => a.s - b.s);
    if (hits.length) out.push({ title: g.title, entries: hits.map((x) => x.h) });
  }
  return out;
}

// ---- the arguments -------------------------------------------------------------------------------

/** What the box made of the arguments: the list to call with, or why there is none. */
export type ArgsResult = { ok: true; args: unknown[] } | { ok: false; error: string };

/**
 * The text in the arguments box as the call's arguments: it is read as the inside of a call's
 * parentheses, as a JavaScript expression in the page's own scope, so `{ go: true }`, `'wolf', 14`
 * and `...[1, 2]` all mean what they would in the console. Empty is no arguments. A syntax error and
 * an expression that throws are both answered in words rather than thrown.
 *
 * A name nothing defines is said as what it nearly always is here: one of the README's own
 * placeholders (`teleport(x, z)`, `advance(seconds, ['KeyW'])`), which the box starts from when a
 * helper's only example is written that way. Starting from an empty box instead would be worse, not
 * better: `teleport()` with nothing puts the player at NaN, where the placeholder is refused before
 * anything is called.
 *
 * The page's own, and developer-only: the text is the developer's own typing, run as the console runs it.
 */
export function evaluateArgs(text: string): ArgsResult {
  const src = text.trim();
  if (!src) return { ok: true, args: [] };
  let make: () => unknown;
  try {
    // The newline before the bracket closes a line comment typed at the end.
    make = new Function(`return [\n${src}\n];`) as () => unknown;
  } catch (err) {
    return { ok: false, error: `the arguments do not read as JavaScript: ${errorText(err)}` };
  }
  try {
    const args = make();
    return { ok: true, args: Array.isArray(args) ? args : [args] };
  } catch (err) {
    const hint = err instanceof ReferenceError ? PLACEHOLDER_HINT : '';
    return { ok: false, error: `the arguments threw: ${errorText(err)}${hint}` };
  }
}

/** What a name nothing defines is said to be, after the engine's own words for it. */
export const PLACEHOLDER_HINT = ' (a name the README writes in an example stands for a value of your own: put one in its place)';

/** Whether a value is a promise, or anything else that can be awaited. */
export function isThenable(v: unknown): v is PromiseLike<unknown> {
  return !!v && (typeof v === 'object' || typeof v === 'function') && typeof (v as { then?: unknown }).then === 'function';
}

function errorText(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}

// ---- showing an answer ---------------------------------------------------------------------------

/** What colour a leaf is drawn in, by what it is. */
export type ViewTone = 'string' | 'number' | 'boolean' | 'nil' | 'fn' | 'special' | 'error';

export interface ViewLeaf {
  kind: 'leaf';
  text: string;
  tone: ViewTone;
}

export interface ViewBranch {
  kind: 'branch';
  /** What it is: `Object`, `Array(12)`, `Map(3)`, `Mesh "hull"`. */
  label: string;
  /** A short look inside, for the line it is folded on: `{ ready: true, standing: 3, … }`. */
  preview: string;
  /** How many entries it has in all (more than are shown when the list is long). */
  count: number;
  /** Whether it starts unfolded. */
  open: boolean;
  /** Drawn in the error colour (an Error). */
  error: boolean;
  /** Its entries, worked out only when asked for, so a folded branch costs nothing. */
  entries(): ViewEntry[];
}

export type ViewNode = ViewLeaf | ViewBranch;

export interface ViewEntry {
  /** The key or index it is filed under; null in a set. */
  key: string | null;
  node: ViewNode;
}

type Bag = Record<string | symbol, unknown>;

/** A number as it reads best: whole numbers whole, the rest to six significant figures. */
export function numberText(n: number): string {
  if (Object.is(n, -0)) return '-0';
  if (!Number.isFinite(n) || Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(6)));
}

/** A function as one line: `ƒ name(a, b)`, or `class Name`. */
export function functionText(fn: (...a: unknown[]) => unknown): string {
  let src = '';
  try {
    src = Function.prototype.toString.call(fn);
  } catch {
    src = '';
  }
  if (/^class[\s{]/.test(src)) return `class ${fn.name || '(anonymous)'}`;
  // An arrow with one bare parameter first, or the first bracket in its body would be read as its list.
  const params = /^(?:async\s+)?([\w$]+)\s*=>/.exec(src)?.[1] ?? /^[^(]*\(([^)]*)\)/.exec(src)?.[1] ?? '';
  const cleaned = params.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
  const shown = cleaned.length > 60 ? `${cleaned.slice(0, 57)}…` : cleaned;
  return `ƒ ${fn.name || '(anonymous)'}(${shown})`;
}

/** A string as a quoted, escaped literal, cut when long. */
function quoted(s: string): string {
  const max = DEBUG_MENU_TUNE.stringMax;
  if (s.length <= max) return JSON.stringify(s);
  return `${JSON.stringify(s.slice(0, max))}… (${s.length.toLocaleString('en')} characters)`;
}

function nameOf(o: object): string {
  const c = (o as { constructor?: { name?: unknown } }).constructor;
  return c && typeof c.name === 'string' ? c.name : '';
}

/** One of three's small value types as a line, or null for anything else. */
function threeValueText(o: Bag): string | null {
  const n = numberText;
  if (o.isVector2) return `Vector2(${n(o.x as number)}, ${n(o.y as number)})`;
  if (o.isVector3) return `Vector3(${n(o.x as number)}, ${n(o.y as number)}, ${n(o.z as number)})`;
  if (o.isVector4) return `Vector4(${n(o.x as number)}, ${n(o.y as number)}, ${n(o.z as number)}, ${n(o.w as number)})`;
  if (o.isQuaternion) return `Quaternion(${n(o.x as number)}, ${n(o.y as number)}, ${n(o.z as number)}, ${n(o.w as number)})`;
  if (o.isEuler) return `Euler(${n(o.x as number)}, ${n(o.y as number)}, ${n(o.z as number)}, ${String(o.order)})`;
  if (o.isColor) {
    const hex = (v: unknown) => Math.round(Math.max(0, Math.min(1, v as number)) * 255).toString(16).padStart(2, '0');
    return `Color(#${hex(o.r)}${hex(o.g)}${hex(o.b)})`;
  }
  if (o.isBox3) {
    const a = o.min as Bag;
    const b = o.max as Bag;
    return `Box3(${n(a.x as number)}, ${n(a.y as number)}, ${n(a.z as number)} → ${n(b.x as number)}, ${n(b.y as number)}, ${n(b.z as number)})`;
  }
  if (o.isSphere) {
    const c = o.center as Bag;
    return `Sphere(${n(c.x as number)}, ${n(c.y as number)}, ${n(c.z as number)} r ${n(o.radius as number)})`;
  }
  if (o.isTexture) {
    const img = o.image as { width?: number; height?: number } | null | undefined;
    const size = img && typeof img.width === 'number' ? ` ${img.width}×${img.height}` : '';
    return `${String(o.type || 'Texture')}${o.name ? ` "${String(o.name)}"` : ''}${size}`;
  }
  return null;
}

/** A page element as a line: `<div#menu.overlay.hidden>`. */
function nodeText(o: Bag): string | null {
  if (typeof o.nodeType !== 'number' || typeof o.nodeName !== 'string') return null;
  if (o.nodeType !== 1) return `#${String(o.nodeName).toLowerCase()}`;
  const id = o.id ? `#${String(o.id)}` : '';
  const cls = typeof o.className === 'string' && o.className.trim() ? `.${o.className.trim().split(/\s+/).join('.')}` : '';
  return `<${String(o.nodeName).toLowerCase()}${id}${cls}>`;
}

/** The value as the list shows it on one short line, for a folded branch's preview. */
export function shortText(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  switch (typeof v) {
    case 'string':
      return v.length > 24 ? `${JSON.stringify(v.slice(0, 24))}…` : JSON.stringify(v);
    case 'number':
      return numberText(v);
    case 'bigint':
      return `${v}n`;
    case 'boolean':
      return String(v);
    case 'symbol':
      return v.toString();
    case 'function':
      return 'ƒ';
  }
  const o = v as Bag;
  const three = threeValueText(o);
  if (three) return three;
  if (Array.isArray(v)) return `[${v.length}]`;
  if (v instanceof Map) return `Map(${v.size})`;
  if (v instanceof Set) return `Set(${v.size})`;
  if (ArrayBuffer.isView(v)) return `${nameOf(v)}(${(v as unknown as { length?: number }).length ?? (v as ArrayBufferView).byteLength})`;
  if (o.isObject3D) return `${String(o.type)}`;
  return '{…}';
}

function previewOf(entries: [string | null, unknown][], open: string, close: string, more: number): string {
  const max = DEBUG_MENU_TUNE.previewChars;
  // A list's preview is its values alone; its indices say nothing.
  const keyed = open === '{';
  let s = open;
  let first = true;
  for (const [k, v] of entries) {
    const part = `${k === null || !keyed ? '' : `${k}: `}${shortText(v)}`;
    const next = `${s}${first ? ' ' : ', '}${part}`;
    if (next.length > max) return `${s}${first ? ' ' : ', '}… ${close}`;
    s = next;
    first = false;
  }
  if (more > 0) return `${s}${first ? ' ' : ', '}… ${close}`;
  return first ? `${open}${close}` : `${s} ${close}`;
}

/** Read a property, a getter that throws answering with what it threw. */
function read(o: Bag, key: string | symbol): unknown {
  try {
    return o[key];
  } catch (err) {
    return new ThrewMarker(errorText(err));
  }
}

class ThrewMarker {
  readonly message: string;
  constructor(message: string) {
    this.message = message;
  }
}

/** The entries a list of keys and values comes to, capped, with what was left out said at the end. */
function entriesOf(pairs: [string | null, unknown][], total: number, depth: number, ancestors: readonly object[]): ViewEntry[] {
  const out: ViewEntry[] = [];
  const shown = Math.min(pairs.length, DEBUG_MENU_TUNE.entriesShown);
  for (let i = 0; i < shown; i++) out.push({ key: pairs[i][0], node: describeAt(pairs[i][1], depth + 1, ancestors) });
  const left = total - shown;
  if (left > 0) out.push({ key: null, node: { kind: 'leaf', text: `… ${left.toLocaleString('en')} more`, tone: 'special' } });
  return out;
}

/**
 * A branch over entries already read (shallowly: a key and its value, nothing under it). What is
 * under each is described only when the branch is opened.
 */
function branch(label: string, all: [string | null, unknown][], total: number, depth: number, ancestors: readonly object[], open: string, close: string, error = false): ViewBranch {
  const first = all.slice(0, 8);
  return {
    kind: 'branch',
    label,
    preview: previewOf(first, open, close, total - first.length),
    count: total,
    open: depth === 0 || (depth < DEBUG_MENU_TUNE.openDepth && total <= DEBUG_MENU_TUNE.openEntries),
    error,
    entries: () => entriesOf(all, total, depth, ancestors),
  };
}

/** The own enumerable keys of an object, symbols after strings. */
function ownPairs(o: Bag): [string | null, unknown][] {
  const out: [string | null, unknown][] = [];
  for (const k of Object.keys(o)) out.push([k, read(o, k)]);
  for (const s of Object.getOwnPropertySymbols(o)) if (Object.prototype.propertyIsEnumerable.call(o, s)) out.push([s.toString(), read(o, s)]);
  return out;
}

/**
 * Whatever a helper answered, as a tree the menu can draw and fold. Circular references are named
 * rather than followed, three's value types read as one line, a three object as the handful of
 * things about it worth knowing, a Map by its keys, a function by its name and parameters, and a
 * long list or a long string cut with what was left out said. Nothing is walked until it is opened.
 */
export function describeValue(value: unknown): ViewNode {
  return describeAt(value, 0, []);
}

function describeAt(v: unknown, depth: number, ancestors: readonly object[]): ViewNode {
  if (v === null) return { kind: 'leaf', text: 'null', tone: 'nil' };
  if (v === undefined) return { kind: 'leaf', text: 'undefined', tone: 'nil' };
  switch (typeof v) {
    case 'string':
      return { kind: 'leaf', text: quoted(v), tone: 'string' };
    case 'number':
      return { kind: 'leaf', text: numberText(v), tone: 'number' };
    case 'bigint':
      return { kind: 'leaf', text: `${v}n`, tone: 'number' };
    case 'boolean':
      return { kind: 'leaf', text: String(v), tone: 'boolean' };
    case 'symbol':
      return { kind: 'leaf', text: v.toString(), tone: 'special' };
    case 'function':
      return { kind: 'leaf', text: functionText(v as (...a: unknown[]) => unknown), tone: 'fn' };
  }
  const o = v as Bag;
  if (v instanceof ThrewMarker) return { kind: 'leaf', text: `(threw: ${v.message})`, tone: 'error' };
  const up = ancestors.indexOf(v as object);
  if (up >= 0) return { kind: 'leaf', text: `[Circular ↑${ancestors.length - up}]`, tone: 'special' };
  const three = threeValueText(o);
  if (three) return { kind: 'leaf', text: three, tone: 'special' };
  const node = nodeText(o);
  if (node) return { kind: 'leaf', text: node, tone: 'special' };
  if (v instanceof Date) return { kind: 'leaf', text: Number.isNaN(v.getTime()) ? 'Invalid Date' : v.toISOString(), tone: 'special' };
  if (v instanceof RegExp) return { kind: 'leaf', text: String(v), tone: 'special' };
  if (v instanceof Promise) return { kind: 'leaf', text: 'Promise', tone: 'special' };
  if (v instanceof WeakMap || v instanceof WeakSet || v instanceof WeakRef) return { kind: 'leaf', text: nameOf(v), tone: 'special' };
  if (typeof window !== 'undefined' && v === window) return { kind: 'leaf', text: 'Window', tone: 'special' };
  const path = [...ancestors, v as object];
  if (v instanceof Error) {
    const stack = typeof v.stack === 'string' ? v.stack.split('\n').slice(1).map((l) => l.trim()).filter(Boolean) : [];
    const pairs: [string | null, unknown][] = [...ownPairs(o).filter(([k]) => k !== 'stack' && k !== 'message'), ...stack.map((l, i): [string, unknown] => [`at ${i}`, l])];
    const b = branch(`${v.name}: ${v.message}`, pairs, pairs.length, depth, path, '{', '}', true);
    b.open = depth === 0;
    b.preview = '';
    return b;
  }
  if (Array.isArray(v)) return branch(`Array(${v.length})`, v.slice(0, DEBUG_MENU_TUNE.entriesShown).map((x, i): [string, unknown] => [String(i), x]), v.length, depth, path, '[', ']');
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
    const arr = v as unknown as ArrayLike<unknown>;
    return branch(`${nameOf(v)}(${arr.length})`, Array.from({ length: Math.min(arr.length, DEBUG_MENU_TUNE.entriesShown) }, (_, i): [string, unknown] => [String(i), arr[i]]), arr.length, depth, path, '[', ']');
  }
  if (v instanceof ArrayBuffer) return { kind: 'leaf', text: `ArrayBuffer(${v.byteLength} bytes)`, tone: 'special' };
  if (v instanceof Map) {
    const pairs: [string | null, unknown][] = [];
    for (const [k, x] of v) {
      pairs.push([typeof k === 'string' ? k : shortText(k), x]);
      if (pairs.length >= DEBUG_MENU_TUNE.entriesShown) break;
    }
    return branch(`Map(${v.size})`, pairs, v.size, depth, path, '{', '}');
  }
  if (v instanceof Set) {
    const pairs: [string | null, unknown][] = [];
    for (const x of v) {
      pairs.push([null, x]);
      if (pairs.length >= DEBUG_MENU_TUNE.entriesShown) break;
    }
    return branch(`Set(${v.size})`, pairs, v.size, depth, path, '[', ']');
  }
  if (o.isObject3D) return object3dBranch(o, depth, path);
  if (o.isBufferGeometry) {
    const attrs = (o.attributes ?? {}) as Record<string, { count?: number; itemSize?: number }>;
    const pos = attrs.position;
    const pairs: [string | null, unknown][] = [
      ['name', o.name],
      ['vertices', pos?.count ?? 0],
      ['indexed', !!o.index],
      ...Object.keys(attrs).map((k): [string, unknown] => [`attribute ${k}`, `${attrs[k]?.count ?? 0} × ${attrs[k]?.itemSize ?? 0}`]),
      ['boundingSphere', o.boundingSphere],
    ];
    return branch(`${String(o.type || 'BufferGeometry')}${o.name ? ` "${String(o.name)}"` : ''}`, pairs, pairs.length, depth, path, '{', '}');
  }
  const own = ownPairs(o);
  const ctor = nameOf(o);
  const label = o.isMaterial ? `${String(o.type)}${o.name ? ` "${String(o.name)}"` : ''}` : ctor && ctor !== 'Object' ? ctor : 'Object';
  return branch(label, own.slice(0, DEBUG_MENU_TUNE.entriesShown), own.length, depth, path, '{', '}');
}

/** A three object: what it is, where it is, what it holds; the rest of its fields one fold further in. */
function object3dBranch(o: Bag, depth: number, path: readonly object[]): ViewBranch {
  const kids = (o.children as unknown[]) ?? [];
  const pairs: [string | null, unknown][] = [
    ['type', o.type],
    ['name', o.name],
    ['uuid', o.uuid],
    ['visible', o.visible],
    ['position', o.position],
    ['quaternion', o.quaternion],
    ['scale', o.scale],
    ['layers', (o.layers as { mask?: number } | undefined)?.mask],
  ];
  if (o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.isPoints || o.isLine) pairs.push(['geometry', o.geometry], ['material', o.material]);
  if (o.isInstancedMesh) pairs.push(['count', o.count]);
  if (o.isLight) pairs.push(['intensity', o.intensity], ['color', o.color]);
  pairs.push(['children', kids], ['userData', o.userData]);
  // Everything else, for the rare question the summary does not answer.
  pairs.push(['(every field)', new AllFields(o)]);
  const label = `${String(o.type || 'Object3D')}${o.name ? ` "${String(o.name)}"` : ''}`;
  const b = branch(label, pairs, pairs.length, depth, path, '{', '}');
  b.preview = `{ ${kids.length} children${o.visible === false ? ', hidden' : ''} }`;
  return b;
}

/** A holder that shows every own field of a three object, generically, when it is opened. */
class AllFields {
  constructor(target: Bag) {
    for (const k of Object.keys(target)) {
      try {
        (this as Bag)[k] = target[k];
      } catch {
        // A getter that throws is left out.
      }
    }
  }
}

// ---- copying an answer out -----------------------------------------------------------------------

/**
 * The answer as JSON text, for pasting: circular references named, three's value types as plain
 * numbers, a three object summed up, a Map as an object (or a list of pairs when its keys are not
 * words), a Set as a list, a function by its name, and a very long list cut.
 */
export function toJsonText(value: unknown, indent = 2): string {
  if (value === undefined) return 'undefined';
  const seen: object[] = [];
  const plain = (v: unknown, depth: number): unknown => {
    if (v === null || v === undefined) return v ?? null;
    switch (typeof v) {
      case 'string':
      case 'boolean':
        return v;
      case 'number':
        return Number.isFinite(v) ? v : String(v);
      case 'bigint':
        return `${v}n`;
      case 'symbol':
        return v.toString();
      case 'function':
        return functionText(v as (...a: unknown[]) => unknown);
    }
    const o = v as Bag;
    if (seen.includes(v as object)) return '[Circular]';
    if (depth > 24) return '[too deep]';
    if (o.isVector2) return { x: o.x, y: o.y };
    if (o.isVector3) return { x: o.x, y: o.y, z: o.z };
    if (o.isVector4 || o.isQuaternion) return { x: o.x, y: o.y, z: o.z, w: o.w };
    const three = threeValueText(o);
    if (three) return three;
    const node = nodeText(o);
    if (node) return node;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? 'Invalid Date' : v.toISOString();
    if (v instanceof RegExp) return String(v);
    if (v instanceof Error) return { error: v.name, message: v.message };
    if (o.isObject3D) return { type: o.type, name: o.name, uuid: o.uuid, children: ((o.children as unknown[]) ?? []).length };
    seen.push(v as object);
    try {
      const cap = 5000;
      if (Array.isArray(v) || (ArrayBuffer.isView(v) && !(v instanceof DataView))) {
        const arr = v as unknown as ArrayLike<unknown>;
        const out: unknown[] = [];
        for (let i = 0; i < Math.min(arr.length, cap); i++) out.push(plain(arr[i], depth + 1));
        if (arr.length > cap) out.push(`… ${arr.length - cap} more`);
        return out;
      }
      if (v instanceof Map) {
        const words = [...v.keys()].every((k) => typeof k === 'string');
        if (words) {
          const out: Record<string, unknown> = {};
          for (const [k, x] of v) out[k as string] = plain(x, depth + 1);
          return out;
        }
        return [...v].slice(0, cap).map(([k, x]) => [plain(k, depth + 1), plain(x, depth + 1)]);
      }
      if (v instanceof Set) return [...v].slice(0, cap).map((x) => plain(x, depth + 1));
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(o)) {
        const x = read(o, k);
        if (x instanceof ThrewMarker) out[k] = `(threw: ${x.message})`;
        else if (x !== undefined) out[k] = plain(x, depth + 1);
      }
      return out;
    } finally {
      seen.pop();
    }
  };
  const text = JSON.stringify(plain(value, 0), null, indent);
  return text === undefined ? 'undefined' : text;
}

// ---- what the console said -----------------------------------------------------------------------

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'table';

export interface ConsoleLine {
  level: ConsoleLevel;
  text: string;
}

/** The console methods the menu listens to while a call runs. */
export const CAPTURED_LEVELS: readonly ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug', 'table'];

/**
 * Whether a piece of text is laid out in columns and must be drawn without wrapping: a
 * `console.table`, and anything of more than one line, which is how the helpers print their own
 * fixed-width reports (`perf()`'s is one string of rows up to a hundred characters). Wrapped, a row
 * wider than the window breaks in the middle and its columns stop lining up; unwrapped, the box
 * scrolls sideways instead. A single line of prose still wraps, so a long sentence is read whole.
 */
export function keepsColumns(level: ConsoleLevel, text: string): boolean {
  return level === 'table' || text.includes('\n');
}

/** One console argument as text: a string as it is, anything else as it would be copied out. */
function argText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.stack ? String(v.stack) : `${v.name}: ${v.message}`;
  if (typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Map) && !(v instanceof Set) && !(v as Bag).isObject3D) {
    const three = threeValueText(v as Bag) ?? nodeText(v as Bag);
    if (three) return three;
  }
  if (typeof v === 'object' && v !== null) {
    try {
      const text = toJsonText(v, 0);
      return text.length > 2000 ? `${text.slice(0, 2000)}…` : text;
    } catch {
      return String(v);
    }
  }
  return shortText(v);
}

/**
 * What a console call printed, as one line of text: the format directives the console itself
 * honours (`%s`, `%d`, `%i`, `%f`, `%o`, `%O`, and `%c`, which takes its style and prints nothing),
 * then the rest of the arguments after a space each. `console.table` is drawn as a text table.
 */
export function consoleText(level: ConsoleLevel, args: readonly unknown[]): string {
  if (level === 'table') return textTable(args[0], Array.isArray(args[1]) ? (args[1] as unknown[]).map(String) : undefined);
  if (!args.length) return '';
  const rest = args.slice();
  let head = '';
  if (typeof rest[0] === 'string' && /%[sdifoOc%]/.test(rest[0])) {
    const fmt = rest.shift() as string;
    head = fmt.replace(/%([sdifoOc%])/g, (all, d: string) => {
      if (d === '%') return '%';
      if (!rest.length) return all;
      const a = rest.shift();
      switch (d) {
        case 's':
          return typeof a === 'string' ? a : argText(a);
        case 'd':
        case 'i':
          return typeof a === 'number' ? String(Math.trunc(a)) : String(parseInt(String(a), 10));
        case 'f':
          return String(typeof a === 'number' ? a : parseFloat(String(a)));
        case 'c':
          return '';
        default:
          return argText(a);
      }
    });
  }
  const tail = rest.map(argText).join(' ');
  return head && tail ? `${head} ${tail}` : head || tail;
}

/**
 * `console.table`'s data as a text table: a row per entry (a list's index or an object's key), a
 * column per key the rows' objects carry (or one column of values for rows that are not objects),
 * each cell cut at forty characters. Anything that is not a list or an object is printed as it is.
 */
export function textTable(data: unknown, columns?: readonly string[]): string {
  if (!data || typeof data !== 'object') return argText(data);
  const rows: [string, unknown][] = Array.isArray(data) ? data.map((v, i): [string, unknown] => [String(i), v]) : data instanceof Map ? [...data].map(([k, v]): [string, unknown] => [String(k), v]) : Object.keys(data).map((k): [string, unknown] => [k, (data as Bag)[k]]);
  const cols: string[] = [];
  let values = false;
  for (const [, v] of rows) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const k of Object.keys(v)) if (!cols.includes(k)) cols.push(k);
    } else values = true;
  }
  const shownCols = columns ? cols.filter((c) => columns.includes(c)) : cols;
  const head = ['(index)', ...shownCols, ...(values ? ['Values'] : [])];
  const cut = (s: string) => (s.length > 40 ? `${s.slice(0, 39)}…` : s);
  const cell = (v: unknown) => cut(v === undefined ? '' : typeof v === 'string' ? v : shortText(v));
  const body = rows.map(([k, v]) => {
    const isObj = !!v && typeof v === 'object' && !Array.isArray(v);
    return [k, ...shownCols.map((c) => (isObj ? cell((v as Bag)[c]) : '')), ...(values ? [isObj ? '' : cell(v)] : [])];
  });
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
  const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i])).join(' │ ').trimEnd();
  const rule = widths.map((w) => '─'.repeat(w)).join('─┼─');
  return [line(head), rule, ...body.map(line)].join('\n');
}

/** Something with the console's methods on it: the page's own console, or a stand-in in a test. */
export type ConsoleLike = Partial<Record<ConsoleLevel, (...args: unknown[]) => void>>;

/**
 * Listen to the console until the returned call: every line a captured method prints is handed to
 * `onLine` and still goes to the console as it would have. Putting it back takes out only this
 * listener's own wrappers -- one somebody else hung over them since is left, and ours under it goes
 * quiet -- so two listeners in turn never unplug each other.
 */
export function captureConsole(target: ConsoleLike, onLine: (line: ConsoleLine) => void): () => void {
  let live = true;
  const undo: (() => void)[] = [];
  for (const level of CAPTURED_LEVELS) {
    const was = target[level];
    if (typeof was !== 'function') continue;
    const wrap = function (this: unknown, ...args: unknown[]): void {
      if (live) {
        try {
          onLine({ level, text: consoleText(level, args) });
        } catch {
          // A line that cannot be read is not worth losing the console over.
        }
      }
      was.apply(this, args);
    };
    target[level] = wrap;
    undo.push(() => {
      if (target[level] === wrap) target[level] = was;
    });
  }
  return () => {
    live = false;
    for (const u of undo) u();
  };
}

// ---- what is kept --------------------------------------------------------------------------------

/** A call as the history and the pins keep it: which helper, where it hangs, what was typed. */
export interface CallRecord {
  helper: string;
  on: 'debug' | 'window';
  args: string;
}

export interface DebugStore {
  /** Newest first, each with when it was run. */
  history: (CallRecord & { at: number })[];
  pinned: CallRecord[];
  /** The helper that was picked last, so the menu opens on it. */
  last: CallRecord | null;
}

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

function recordOf(v: unknown): CallRecord | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Bag;
  if (typeof r.helper !== 'string' || !/^[A-Za-z_$][\w$]*$/.test(r.helper) || FORBIDDEN.has(r.helper)) return null;
  const on = r.on === 'window' ? 'window' : 'debug';
  return { helper: r.helper, on, args: typeof r.args === 'string' ? r.args.slice(0, 4000) : '' };
}

/** What storage held, read defensively: anything that does not read is nothing kept. */
export function readStore(text: string | null | undefined): DebugStore {
  const out: DebugStore = { history: [], pinned: [], last: null };
  if (!text) return out;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return out;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const r = raw as Bag;
  if (Array.isArray(r.history)) {
    for (const h of r.history) {
      const rec = recordOf(h);
      if (!rec) continue;
      const at = typeof (h as Bag).at === 'number' && Number.isFinite((h as Bag).at) ? ((h as Bag).at as number) : 0;
      out.history.push({ ...rec, at });
      if (out.history.length >= DEBUG_MENU_TUNE.historyMax) break;
    }
  }
  if (Array.isArray(r.pinned)) {
    for (const p of r.pinned) {
      const rec = recordOf(p);
      if (rec && !out.pinned.some((x) => sameCall(x, rec))) out.pinned.push(rec);
      if (out.pinned.length >= DEBUG_MENU_TUNE.pinnedMax) break;
    }
  }
  out.last = recordOf(r.last);
  return out;
}

export function writeStore(s: DebugStore): string {
  return JSON.stringify({ history: s.history, pinned: s.pinned, last: s.last });
}

export function sameCall(a: CallRecord, b: CallRecord): boolean {
  return a.helper === b.helper && a.on === b.on && a.args.trim() === b.args.trim();
}

/** A call run now, at the top of the history; the same call run before is moved up rather than kept twice. */
export function pushHistory(list: readonly (CallRecord & { at: number })[], rec: CallRecord, now: number): (CallRecord & { at: number })[] {
  const out = list.filter((x) => !sameCall(x, rec));
  out.unshift({ helper: rec.helper, on: rec.on, args: rec.args.trim(), at: now });
  return out.slice(0, DEBUG_MENU_TUNE.historyMax);
}

/** Pin a call, or unpin it if it is pinned; the answer says which it is now. */
export function togglePin(list: readonly CallRecord[], rec: CallRecord): { list: CallRecord[]; pinned: boolean } {
  if (list.some((x) => sameCall(x, rec))) return { list: list.filter((x) => !sameCall(x, rec)), pinned: false };
  const clean = { helper: rec.helper, on: rec.on, args: rec.args.trim() };
  return { list: [...list, clean].slice(-DEBUG_MENU_TUNE.pinnedMax), pinned: true };
}

/** A call as one line: `perf({ frames: 240 })`, or `__sharedDay()`. */
export function callText(rec: CallRecord): string {
  return `${rec.helper}(${rec.args.trim()})`;
}
