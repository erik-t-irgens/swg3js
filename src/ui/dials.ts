// Dials: the numbers of feel -- how high a jump goes, how hard a pull, how sudden is too sudden -- as sliders
// in the debug menu. The owner decides those by hand (his words, 2026-10-17: "the 'feel' of driving over
// things, or what is 'too sudden' of a hill steepness change should be something I decide"), so each one is
// a live knob with a range, a step and a line of words, set through the very function its console helper
// sets it through, so a slider and a typed line can never mean two different things.
//
// A set of dials belongs to one helper (`race`, `engines`) and is shown when that helper is picked. Nothing a
// dial sets is kept by itself, as with every knob: what has moved can be copied out as that helper's own
// console line, or pinned to run at start, which is the menu's one way of keeping a knob across a reload.
//
// Pure: no DOM and nothing of the game's, so a node test runs every piece of it as the menu does.

/** A number moved by a slider. */
export interface NumberDial {
  kind: 'number';
  /**
   * Where it is written in the helper's own argument, as a path: `tune.looseFall` is
   * `race({ tune: { looseFall } })`, `base.podracer.maxTurn` is `race({ base: { podracer: { maxTurn } } })`.
   */
  key: string;
  /** Its name on the slider, in words. */
  label: string;
  /** What moving it does, in a line (the slider's tooltip, and the row under it). */
  note: string;
  min: number;
  max: number;
  step: number;
  /** The unit shown after the value: 'm/s²', 's', 'km/h', '' for a share. */
  unit: string;
  /** Its value now. */
  get(): number;
  /** Set it, as its helper would; words for anything held or refused. */
  set(v: number): string[];
  /** The value said another way, after its unit (a speed in m/s said in km/h as well). */
  text?(v: number): string;
}

/** One of a few words, chosen from a row of buttons. */
export interface ChoiceDial {
  kind: 'choice';
  key: string;
  label: string;
  note: string;
  choices: readonly string[];
  get(): string;
  set(v: string): string[];
}

export type Dial = NumberDial | ChoiceDial;

export interface DialGroup {
  title: string;
  /** A line under the group's title: what the group is for, or what moves with it. */
  note?: string;
  dials: Dial[];
}

/** Every dial of one helper, in its groups, with the shipped value of each (what Reset puts back). */
export interface DialSet {
  /** The helper they belong to (`race`), on `__debug`. */
  helper: string;
  groups: DialGroup[];
  /** The value each dial had when the game started, by key: what a reset puts back and what "moved" is measured from. */
  shipped: ReadonlyMap<string, number | string>;
}

/** The decimals a step is shown and kept to: 0.05 has two, 5 has none. */
export function stepDecimals(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 0;
  const s = String(step);
  const e = /e-(\d+)$/.exec(s);
  if (e) return Number(e[1]);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/**
 * A slider's value held to its range and on its step, counted from its least, and cut to the step's own
 * decimals so a slider at 0.15 never writes 0.15000000000000002.
 */
export function snapDial(v: number, min: number, max: number, step: number): number {
  if (!Number.isFinite(v)) return min;
  const held = Math.min(max, Math.max(min, v));
  if (!(step > 0)) return held;
  const n = Math.round((held - min) / step);
  const snapped = Math.min(max, min + n * step);
  return Number(snapped.toFixed(stepDecimals(step)));
}

/**
 * A number dial's value as its box shows it: to its step's decimals, or as it is when a value typed into the box
 * has more of them, so the box never shows a number other than the one that was set.
 */
export function dialNumber(d: NumberDial, v: number): string {
  const s = v.toFixed(stepDecimals(d.step));
  return Number(s) === v ? s : String(Number(v.toFixed(6)));
}

/** What stands after a number dial's box: its unit, and the value said another way where it has one. */
export function dialUnit(d: NumberDial, v: number): string {
  if (!d.text) return d.unit;
  return d.unit ? `${d.unit} · ${d.text(v)}` : d.text(v);
}

/** A dial's value now as one line: `20 m/s²`, `45 m/s · 162 km/h`, `loose`. */
export function dialText(d: Dial): string {
  if (d.kind === 'choice') return d.get();
  const v = d.get();
  const u = dialUnit(d, v);
  return u ? `${dialNumber(d, v)} ${u}` : dialNumber(d, v);
}

/** Every dial of a set, in order. */
export function allDials(set: DialSet): Dial[] {
  return set.groups.flatMap((g) => g.dials);
}

/** Whether a dial stands somewhere other than where the game shipped it (to the step's own decimals). */
export function dialMoved(set: DialSet, d: Dial): boolean {
  const was = set.shipped.get(d.key);
  if (d.kind === 'choice') return was !== d.get();
  if (typeof was !== 'number') return false;
  const k = 10 ** (stepDecimals(d.step) + 2);
  return Math.round(was * k) !== Math.round(d.get() * k);
}

/** The value each dial of a set has now, by key: taken once at start, it is the set's `shipped`. */
export function readDials(groups: readonly DialGroup[]): Map<string, number | string> {
  const out = new Map<string, number | string>();
  for (const g of groups) for (const d of g.dials) out.set(d.key, d.get());
  return out;
}

/** Put every dial back where the game shipped it; words for anything its helper said. */
export function resetDials(set: DialSet): string[] {
  const words: string[] = [];
  for (const d of allDials(set)) {
    const was = set.shipped.get(d.key);
    if (was === undefined || !dialMoved(set, d)) continue;
    if (d.kind === 'choice' && typeof was === 'string') words.push(...d.set(was));
    else if (d.kind === 'number' && typeof was === 'number') words.push(...d.set(was));
  }
  return words;
}

const WORD = /^[A-Za-z_$][\w$]*$/;
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * The dials that have moved, as the inside of their helper's call: `{ tune: { looseFall: 12 }, base: {
 * podracer: { maxTurn: 80 } } }`, the keys' paths made nested objects, in the dials' own order. Empty
 * when nothing has moved. It is plain JavaScript the menu's own argument box reads back, so a pin of it
 * sets exactly these again.
 */
export function movedArgs(set: DialSet): string {
  const root: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  let any = false;
  for (const d of allDials(set)) {
    if (!dialMoved(set, d)) continue;
    const path = d.key.split('.');
    if (!path.every((p) => WORD.test(p) && !FORBIDDEN.has(p))) continue;
    let at = root;
    for (let i = 0; i < path.length - 1; i++) {
      const next = at[path[i]];
      if (next && typeof next === 'object') at = next as Record<string, unknown>;
      else {
        const made = Object.create(null) as Record<string, unknown>;
        at[path[i]] = made;
        at = made;
      }
    }
    at[path[path.length - 1]] = d.get();
    any = true;
  }
  return any ? literal(root) : '';
}

function literal(v: unknown): string {
  if (typeof v === 'string') return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '0';
  if (typeof v === 'boolean') return String(v);
  const o = v as Record<string, unknown>;
  const parts = Object.keys(o).map((k) => `${k}: ${literal(o[k])}`);
  return parts.length ? `{ ${parts.join(', ')} }` : '{}';
}

/** The whole console line for the dials that have moved: `__debug.race({ … })`, or '' when none has. */
export function movedLine(set: DialSet): string {
  const args = movedArgs(set);
  return args ? `__debug.${set.helper}(${args})` : '';
}
