// A world's states: one world standing as one thing or another (Restuss as the living launch city or as its ruins),
// read at each arrival on it and kept by the server when there is one.
//
// **What a pack says.** A world with states names them in its layout (`states`, after its centre: Rori's
// `restuss` block, `tools/swg/restuss.mjs`), and whatever stands in one state only carries a tag, `<key>=<value>`
// (`restuss=living`, `restuss=ruins`): a placed object, a port's row, a travel or a fitting row, one of our people.
// Untagged is every state. The tag is all the game reads of it, through `standsIn`.
//
// **Which state a world stands in** is the server's word where a server has said one (its hail's `states`, and
// the `worldStates` word when its admin changes one), else this browser's own setting (`localStorage`
// `swg.world.<key>`, the owner's to keep: the Gameplay page's row and `__debug.restuss`), else the default
// (`WORLD_STATES`). **It is taken at an arrival and never in the middle of a world** (`takeWorldStates`): the
// streamer files what stands once, the people are adopted once, so a change -- the admin's word, a setting moved --
// is said on the message line and stands at the next arrival on that world. An arrival on a world with states,
// with a server address saved and no hail heard on this line, waits behind its loading screen for the hail first
// (`arrivalWait`, `WORLD_STATE_TUNE.waitMs`), so a session that starts on Rori stands the server's Restuss and
// not this browser's.
//
// Pure of three and of the page but for `localStorage`, read inside a `try`. Rule for this file (node runs it with
// type stripping for the tests): every import with its `.ts` extension, no enum, no namespace, no constructor
// parameter properties.

/** Every world state this build knows: its values and the default a world stands in when nobody has said. */
export const WORLD_STATES: Readonly<Record<string, { readonly values: readonly string[]; readonly default: string }>> = {
  // Ruins by default [owner, 2026-10-19, the design's §10 Q1: "Ruins"]: how SOE's live game ended; the living launch
  // city is the other state, a setting or the admin's word away.
  restuss: { values: ['living', 'ruins'], default: 'ruins' },
};

/** What the message line calls a world state, the world it is on and each of its values. Ours. */
export const WORLD_STATE_WORDS: Readonly<Record<string, { readonly name: string; readonly world: string; readonly values: Readonly<Record<string, string>> }>> = {
  restuss: { name: 'Restuss', world: 'Rori', values: { living: 'the living city', ruins: 'ruins' } },
};

/**
 * What the message line says when a key's state moves to `value` (the server's word, or this browser's setting),
 * or null where there is nothing to say: the world here already stands that way (`inForce`), or nothing moved.
 */
export function stateNews(key: string, before: string | null, value: string, inForce: string | null): string | null {
  // The world here stands that way already; or it is not here and nothing moved.
  if (inForce === value || (inForce === null && value === before)) return null;
  const w = WORLD_STATE_WORDS[key];
  if (!w) return null;
  const said = w.values[value] ?? value;
  return inForce !== null ? `${w.name} stands as ${said} when you next arrive on ${w.world}: it stays as it is until then` : `${w.name} stands as ${said} when you next arrive on ${w.world}`;
}

/**
 * How long an arrival on a world with states waits behind its loading screen for a saved server's hail before it
 * reads the state from this browser's setting, milliseconds [ours: the props keeper's own wait,
 * `PROPS_KEEPER_TUNE.waitMs`, for the same reason: long enough for a server that is there to answer]. Live through
 * `__debug.restuss({ wait })`.
 */
export const WORLD_STATE_TUNE = { waitMs: 6000 };

/** A world's states block as its layout carries it (Rori's `states.restuss`); only `values` and `default` are read here. */
export interface LayoutStateBlock {
  values?: readonly string[];
  default?: string;
  centre?: { x: number; z: number };
  living?: number;
  ruins?: number;
  version?: number;
}

const STORAGE = 'swg.world.';
const TAG = /^([a-z0-9_]+)=([a-z0-9_]+)$/;

/** The server's word, while it has said one: what its hail carried, or its admin's word since. Null with none. */
let serverStates: Record<string, string> | null = null;
/** The state each key of the world arrived on stands in, taken at that arrival; empty between worlds. */
const inForce = new Map<string, string>();
/** What `setLocalWorldState` set this session, for a page whose storage throws. */
const sessionSetting = new Map<string, string>();
/** Moved by every change of any of the three, so whatever keeps a list filtered by state knows to filter again. */
let stamp = 0;
const listeners: ((why: 'server' | 'setting' | 'arrival') => void)[] = [];

function tell(why: 'server' | 'setting' | 'arrival'): void {
  stamp++;
  for (const fn of listeners) {
    try {
      fn(why);
    } catch (err) {
      console.warn('world states: a listener threw', err);
    }
  }
}

/** A tag's key and value, or null where it is not `<key>=<value>` in lower-case words. */
export function tagParts(tag: string | null | undefined): { key: string; value: string } | null {
  if (typeof tag !== 'string') return null;
  const m = TAG.exec(tag);
  return m ? { key: m[1], value: m[2] } : null;
}

/** Whether a value is one a key this build knows allows. */
export function allowed(key: string, value: unknown): value is string {
  const s = Object.prototype.hasOwnProperty.call(WORLD_STATES, key) ? WORLD_STATES[key] : null;
  return !!s && typeof value === 'string' && s.values.includes(value);
}

/**
 * A server's states as they came off the wire: only the keys this build knows, each with a value its key allows,
 * on an object of no prototype. Null for anything that is not an object at all, which is how a hail from a server
 * before world states reads.
 */
export function cleanStates(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = Object.create(null) as Record<string, string>;
  for (const key of Object.keys(WORLD_STATES)) {
    const value = (v as Record<string, unknown>)[key];
    if (allowed(key, value)) out[key] = value;
  }
  return out;
}

/** This browser's own setting for a key, or null for none (or a page that refuses storage). */
export function localWorldState(key: string): string | null {
  try {
    const v = globalThis.localStorage?.getItem(STORAGE + key) ?? null;
    return allowed(key, v) ? v : null;
  } catch {
    return null;
  }
}

/** Set this browser's own setting for a key, kept across reloads; false for a value the key does not allow. */
export function setLocalWorldState(key: string, value: string): boolean {
  if (!allowed(key, value)) return false;
  try {
    globalThis.localStorage?.setItem(STORAGE + key, value);
  } catch {
    /* a page that refuses storage keeps the setting for this session alone */
  }
  sessionSetting.set(key, value);
  tell('setting');
  return true;
}

/** Where a key's state would come from at an arrival now: the server's word, this browser's setting, or the default. */
export function worldStateSource(key: string): 'server' | 'setting' | 'default' {
  if (serverStates && allowed(key, serverStates[key])) return 'server';
  if (localWorldState(key) ?? sessionSetting.get(key)) return 'setting';
  return 'default';
}

/** The state a key would stand in at an arrival now: the server's word, else this browser's setting, else the default. */
export function worldStateOf(key: string): string {
  if (serverStates && allowed(key, serverStates[key])) return serverStates[key];
  const mine = localWorldState(key) ?? sessionSetting.get(key) ?? null;
  if (mine) return mine;
  return WORLD_STATES[key]?.default ?? '';
}

/** The server's word, as its hail or its admin's word carried it (cleaned), or null when no server says any. */
export function setServerStates(states: Record<string, string> | null): void {
  const before = JSON.stringify(serverStates);
  serverStates = states ? { ...states } : null;
  if (JSON.stringify(serverStates) !== before) tell('server');
}

/** The server's word as it stands, or null. */
export function serverWorldStates(): Readonly<Record<string, string>> | null {
  return serverStates;
}

/** Be told whenever the server's word, a setting or a world's states in force change. Answers the way to stop. */
export function onWorldStates(fn: (why: 'server' | 'setting' | 'arrival') => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/**
 * An arrival's states taken: each key of the world's `states` block stands in what `worldStateOf` says now, for
 * the rest of the world, whatever is said meanwhile. A key this build does not know stands in its block's own
 * default. Every key of the world before is let go first.
 */
export function takeWorldStates(block: Readonly<Record<string, LayoutStateBlock>> | null | undefined): void {
  inForce.clear();
  for (const key of Object.keys(block ?? {})) {
    const b = block![key];
    const known = Object.prototype.hasOwnProperty.call(WORLD_STATES, key);
    const value = known ? worldStateOf(key) : typeof b?.default === 'string' ? b.default : '';
    if (value) inForce.set(key, value);
  }
  tell('arrival');
}

/** Let go of the states a world arrived with: between worlds, every key reads what `worldStateOf` says. */
export function releaseWorldStates(): void {
  if (!inForce.size) return;
  inForce.clear();
  stamp++;
}

/** The state a key stands in now: the world's in force where it is the world here, else what an arrival would take. */
export function stateNow(key: string): string | null {
  const here = inForce.get(key);
  if (here !== undefined) return here;
  return Object.prototype.hasOwnProperty.call(WORLD_STATES, key) ? worldStateOf(key) : null;
}

/** The states in force for the world here, by key: empty for a world with none. */
export function statesInForce(): Readonly<Record<string, string>> {
  return Object.fromEntries(inForce);
}

/**
 * Whether something tagged `<key>=<value>` stands now: untagged always does, a tag of a key nobody knows does, and
 * otherwise only while that key's state now is that value. A tag of the wrong shape is no tag.
 */
export function standsIn(tag?: string | null): boolean {
  const t = tagParts(tag);
  if (!t) return true;
  const now = stateNow(t.key);
  return now === null || now === t.value;
}

/** The rows of a list that stand now (`standsIn` on each one's `state`): a world's ports, its travel rows. */
export function inState<T extends { state?: string | null }>(rows: readonly T[]): T[] {
  return rows.filter((r) => standsIn(r.state));
}

/**
 * A pack file whose list (`rows` of a travel file, `pois` of a places file) is left with only the rows that stand
 * now (`inState`), the rest of the file as it was; anything that is no such file is handed back as it came.
 */
export function fileInState(file: unknown, field = 'rows'): unknown {
  if (!file || typeof file !== 'object' || Array.isArray(file)) return file;
  const list = (file as Record<string, unknown>)[field];
  if (!Array.isArray(list)) return file;
  return { ...(file as Record<string, unknown>), [field]: inState(list as { state?: string }[]) };
}

/** A number moved by every change of the states, for a cache to key on. */
export function worldStateStamp(): number {
  return stamp;
}

/** What an arrival on a world does before it reads its states: nothing, a look at a saved server's hail, or a wait for this line's. */
export type ArrivalWait = 'none' | 'peek' | 'wait';

/**
 * What an arrival does before it takes its states. Nothing for a world with none (`states` false) or with no
 * server address saved; nothing where this line has been answered (`mode` `server` or `relay`: the hail is heard,
 * or the far end is the relay that came before and says nothing); a look at the saved server's hail on a line of
 * its own where the game's own line is still to be made after this loading screen (`toCome`, a session's first
 * world); and a wait for this line's hail where a line is wanted and has not been answered yet (opening, or
 * dropped and coming back).
 */
export function arrivalWait(f: { states: boolean; saved: boolean; mode: string; wanted: boolean; toCome: boolean }): ArrivalWait {
  if (!f.states || !f.saved) return 'none';
  if (f.mode === 'server' || f.mode === 'relay') return 'none';
  if (f.toCome && !f.wanted) return 'peek';
  if (f.wanted) return 'wait';
  return 'none';
}

/**
 * Wait until `heard()` says yes or `waitMs` has gone, asking every `everyMs`: true when it was heard. `sleep` is
 * the timer, handed in so a test can step it.
 */
export async function waitForHail(heard: () => boolean, waitMs: number = WORLD_STATE_TUNE.waitMs, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)), everyMs = 100): Promise<boolean> {
  let waited = 0;
  while (!heard()) {
    if (waited >= waitMs) return false;
    await sleep(everyMs);
    waited += everyMs;
  }
  return true;
}

/** Set the wait, clamped to between nought and half a minute; answers what it is. */
export function tuneWorldStateWait(ms: unknown): number {
  if (typeof ms === 'number' && Number.isFinite(ms)) WORLD_STATE_TUNE.waitMs = Math.max(0, Math.min(30000, Math.round(ms)));
  return WORLD_STATE_TUNE.waitMs;
}

/**
 * How a world's layout objects are filed, by the state they stand in: `placedAt[i]` the index layout object `i`
 * takes in the streamer's own list, or -1 where it lies dormant (its own tag not standing, or it stands in a room
 * of a building that is dormant), and `host[i]` the index its building takes in that list (from the layout's own
 * `in`), or -1. **The layout's own indices are never handed on as they are**: a building's index in the layout is
 * not its index once what lies dormant before it is left out.
 */
export function fileByState(objects: readonly { state?: string; contained?: boolean; in?: number }[], stands: (tag?: string) => boolean = standsIn): { placedAt: Int32Array; host: Int32Array; dormant: number } {
  const n = objects.length;
  const own = new Uint8Array(n);
  for (let i = 0; i < n; i++) own[i] = stands(objects[i].state) ? 1 : 0;
  const placedAt = new Int32Array(n).fill(-1);
  const host = new Int32Array(n).fill(-1);
  let next = 0;
  let dormant = 0;
  for (let i = 0; i < n; i++) {
    const o = objects[i];
    const h = o.contained && typeof o.in === 'number' && o.in >= 0 && o.in < n ? o.in : -1;
    // A thing in a room of a building that lies dormant lies dormant with it, whatever its own tag says.
    if (!own[i] || (h >= 0 && !own[h])) {
      dormant++;
      continue;
    }
    placedAt[i] = next++;
  }
  for (let i = 0; i < n; i++) {
    const o = objects[i];
    if (placedAt[i] < 0 || !o.contained || typeof o.in !== 'number' || o.in < 0 || o.in >= n) continue;
    host[i] = placedAt[o.in];
  }
  return { placedAt, host, dormant };
}

/** Everything this module holds let go of: a node test's fresh start. */
export function forgetWorldStates(): void {
  serverStates = null;
  inForce.clear();
  sessionSetting.clear();
  listeners.length = 0;
  stamp++;
}
