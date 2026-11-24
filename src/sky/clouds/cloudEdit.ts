// The clouds' console edits of a stack (pass 3, wave 1, maker M): one layer changed, added, removed or moved, and the line that
// keeps a stack, for `__debug.clouds(...)` and the debug menu's `clouds` sliders (`cloudRun.ts`). Pure: no three, no DOM, so a
// node test runs the very edits the console makes. Nothing is refused but the contract's safety clamps (`cleanLayer`).
import { CLOUD_LAYER_MAX, CLOUD_TYPES, cleanLayer, copyStack, nameSeed, newCloudLayer, sharesWritten, type CloudLayer, type CloudTypeId } from './cloudLayers.ts';
import { CLOUD_DECKS, blankLayer, type CloudDeckId } from './cloudClimate.ts';

/**
 * What an edit works on: the live stack and how it is replaced (the run's `setLayers`, which keeps each layer's drift), and
 * the world's decks a new layer may start from (`add: 'low' | 'middle' | 'high'`; the run's, from the world's climate).
 */
export interface StackHost {
  layers: CloudLayer[];
  setLayers(list: readonly CloudLayer[]): string[];
  deckOf?(deck: CloudDeckId): CloudLayer | null;
}
export const LAYER_KEYS = ['name', 'on', 'types', 'type', 'shares', 'levelShares', 'mixScale', 'base', 'thickness', 'cover', 'density', 'cellSize', 'drift', 'turn', 'diurnal', 'edge', 'seed'];

/** The starts an added layer may begin from besides a type: the world's three decks and a blank layer. */
export const ADD_STARTS = [...CLOUD_DECKS, 'blank'] as const;

/** A layer by name or index in the live stack, or -1. */
function layerIndex(r: StackHost, key: unknown): number {
  if (typeof key === 'number' && Number.isInteger(key)) return key >= 0 && key < r.layers.length ? key : -1;
  if (typeof key === 'string') return r.layers.findIndex((l) => l.name === key);
  return -1;
}

/** A name not yet in the stack: the name itself, else it with 2, 3 and on ("Low deck 2"). */
function freeName(next: readonly CloudLayer[], name: string): string {
  let n = name;
  for (let k = 2; next.some((l) => l.name === n); k++) n = `${name} ${k}`;
  return n;
}

/**
 * A new layer's start (`add`): one of the world's decks at its real height and types (`'low'`, `'middle'`, `'high'`, or
 * `{ deck: 'low', ...fields }`), a blank layer with no cover (`'blank'`, `{}`, or `{ deck: 'blank', ...fields }`), or a type at
 * its starts (`'cumulus'`, `{ types: [...], ...fields }`). Answers the start and the fields laid over it.
 */
function addStart(r: StackHost, add: unknown, words: string[]): { start: CloudLayer; spec: Record<string, unknown> } {
  const spec: Record<string, unknown> = typeof add === 'object' && add ? { ...(add as Record<string, unknown>) } : {};
  const which = typeof add === 'string' ? add : typeof spec.deck === 'string' ? spec.deck : null;
  delete spec.deck;
  if (which === 'low' || which === 'middle' || which === 'high') {
    const d = r.deckOf?.(which) ?? null;
    if (d) return { start: d, spec };
    words.push(`no world's ${which} deck to start from here: a blank layer instead`);
    return { start: blankLayer(), spec };
  }
  if (which === 'blank' || (typeof add === 'object' && add && spec.types === undefined && spec.type === undefined)) return { start: blankLayer(), spec };
  const t = typeof add === 'string' ? add : ((Array.isArray(spec.types) ? spec.types[0] : spec.type) as string | undefined);
  const known = (CLOUD_TYPES as readonly string[]).includes(t ?? '');
  if (!known) words.push(`"${String(t)}" is not a cloud type or a start (${CLOUD_TYPES.join(', ')}; or ${ADD_STARTS.join(', ')}): a cumulus instead`);
  if (typeof add === 'string') spec.types = [known ? t : 'cumulus'];
  const type = known ? (t as CloudTypeId) : 'cumulus';
  return { start: newCloudLayer(type, type), spec };
}

/**
 * One layer's change (`__debug.clouds({ layer: {...} })`): `{ name or index, ...fields }` changes it; `{ add: 'low' | 'middle'
 * | 'high' | 'blank' | 'cumulus' | {...fields} }` adds one (at `at`, else last); `{ name or index, remove: true }` removes it;
 * `{ name or index, to: i }` moves it. A cover may be given whole (`cover: [...]`), one level at a time (`cover0` to `cover4`),
 * or as one number for every level. A type may be `type` (one) or `types` (a mix), with `shares`, each share one number (every
 * level) or five (one a level), or one at a time (`share0` to `share2`, a number or five). Nothing refused but the safety clamps.
 */
export function editLayer(r: StackHost, o: Record<string, unknown>): string[] {
  const words: string[] = [];
  const next = copyStack(r.layers);
  if (o.add !== undefined) {
    if (next.length >= CLOUD_LAYER_MAX) return [`the stack holds ${CLOUD_LAYER_MAX} layers already (CLOUD_LAYER_MAX); remove one first`];
    const { start, spec } = addStart(r, o.add, words);
    const name = freeName(next, typeof spec.name === 'string' && spec.name ? spec.name : start.name);
    spec.name = name;
    // A fresh seed from the new name, so a second deck of a world is its own clouds, not the first's again.
    const L = cleanLayer(spec, { ...start, name, seed: typeof spec.seed === 'number' ? start.seed : nameSeed(name) }, words);
    const at = typeof o.at === 'number' && Number.isInteger(o.at) ? Math.max(0, Math.min(next.length, o.at)) : next.length;
    next.splice(at, 0, L);
    words.push(...r.setLayers(next));
    words.push(`added "${L.name}" (${L.types.join(' + ')}, ${Math.round(L.base)} to ${Math.round(L.base + L.thickness)} m) at ${at}`);
    return words;
  }
  const i = layerIndex(r, o.index ?? o.name);
  if (i < 0) return [`no layer ${JSON.stringify(o.index ?? o.name)}: the stack is ${r.layers.map((l, k) => `${k} "${l.name}"`).join(', ') || 'empty'}`];
  if (o.remove === true) {
    const [gone] = next.splice(i, 1);
    words.push(...r.setLayers(next));
    words.push(`removed "${gone.name}"`);
    return words;
  }
  if (typeof o.to === 'number' && Number.isInteger(o.to)) {
    const [L] = next.splice(i, 1);
    const to = Math.max(0, Math.min(next.length, o.to));
    next.splice(to, 0, L);
    words.push(...r.setLayers(next));
    words.push(`moved "${L.name}" to ${to}`);
    return words;
  }
  const ch: Record<string, unknown> = {};
  // The shares as written (a number a type, or five by level), so a type's share edited or a type added keeps the others' rows.
  const sharesNow = (): (number | number[])[] => (Array.isArray(ch.shares) ? (ch.shares as (number | number[])[]) : sharesWritten(next[i]));
  for (const [k, v] of Object.entries(o)) {
    if (k === 'index' || (k === 'name' && o.index === undefined)) continue;
    if (k === 'rename') ch.name = v;
    else if (/^cover[0-4]$/.test(k)) {
      const c = Array.isArray(ch.cover) ? (ch.cover as number[]) : [...next[i].cover];
      c[Number(k[5])] = Number(v);
      ch.cover = c;
    } else if (/^type[0-2]$/.test(k)) {
      const t = Array.isArray(ch.types) ? (ch.types as string[]) : [...next[i].types];
      const s = sharesNow();
      const at = Number(k[4]);
      if (v === 'none' || v === null) {
        if (at > 0 && at < t.length) {
          t.splice(at, 1);
          s.splice(at, 1);
        }
      } else if (at < t.length) t[at] = String(v);
      else {
        t.push(String(v));
        s.push(1);
      }
      ch.types = t;
      ch.shares = s;
      ch.levelShares = null;
    } else if (/^share[0-2]$/.test(k)) {
      const s = sharesNow();
      const at = Number(k[5]);
      if (at < s.length) s[at] = Array.isArray(v) ? (v as number[]).map(Number) : Number(v);
      ch.shares = s;
      ch.levelShares = null;
    } else if (k === 'type') {
      ch.types = [v];
      ch.levelShares = null;
    } else if (k === 'shares') {
      ch.shares = v;
      ch.levelShares = null;
    } else if (LAYER_KEYS.includes(k)) ch[k] = v;
    else words.push(`"${k}" is not a layer's field (${LAYER_KEYS.join(', ')}, cover0 to cover4, type0 to type2, share0 to share2, rename)`);
  }
  next[i] = cleanLayer({ ...next[i], ...ch }, next[i], words);
  words.push(...r.setLayers(next));
  return words;
}

/** The stack as a line that keeps it (as the dials' copied line does): `__debug.clouds({ layers: [...] })`. */
export function keepLine(layers: readonly CloudLayer[]): string {
  const short = layers.map((l) => {
    const o: Record<string, unknown> = { name: l.name };
    if (!l.on) o.on = false;
    o.types = l.types;
    if (l.types.length > 1) o.shares = sharesWritten(l).map((s) => (Array.isArray(s) ? s.map((v) => round(v, 3)) : round(s, 3)));
    o.base = round(l.base, 0);
    o.thickness = round(l.thickness, 0);
    o.cover = l.cover.map((c) => round(c, 3));
    for (const k of ['density', 'cellSize', 'mixScale', 'drift', 'turn', 'diurnal', 'edge', 'seed'] as const) o[k] = round(l[k], k === 'seed' || k === 'cellSize' || k === 'mixScale' ? 0 : 3);
    return o;
  });
  return `__debug.clouds(${JSON.stringify({ layers: short })})`;
}
const round = (v: number, d: number): number => Number(v.toFixed(d));
