// The frame report's arithmetic, kept apart from the recording so a node test can hold it to known
// numbers: percentiles, the A/B block schedule, and the report's shape and its printed table. Nothing
// here runs on a frame; it runs when somebody asks for a report.

/** How a set of samples spreads: the middle, the slow tail, the worst and the mean. */
export interface Spread {
  n: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

export const EMPTY_SPREAD: Readonly<Spread> = Object.freeze({ n: 0, p50: 0, p95: 0, max: 0, mean: 0 });

/**
 * The nearest-rank percentile of `n` samples already sorted ascending: the smallest sample with at
 * least `q` of the samples at or below it. 0 for no samples.
 */
export function percentileSorted(sorted: ArrayLike<number>, n: number, q: number): number {
  if (n <= 0) return 0;
  const i = Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1));
  return sorted[i];
}

/**
 * The spread of the first `n` samples of `src`. It sorts a copy in `scratch` when one is given (and
 * long enough), so the samples themselves are left in the order they were taken.
 */
export function spreadOf(src: ArrayLike<number>, n: number, scratch?: Float64Array): Spread {
  if (n <= 0) return { ...EMPTY_SPREAD };
  const s = scratch && scratch.length >= n ? scratch : new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    s[i] = src[i];
    sum += src[i];
  }
  const view = s.length === n ? s : s.subarray(0, n);
  view.sort();
  return { n, p50: percentileSorted(view, n, 0.5), p95: percentileSorted(view, n, 0.95), max: view[n - 1], mean: sum / n };
}

// ---------------------------------------------------------------------------------------------
// The A/B schedule.
//
// A value is held for two blocks at a time: the first block after each flip settles (a cull that
// has just been switched, a cache that has just been emptied) and is thrown away, and the second
// is kept. So the run goes a (thrown), a (kept), b (thrown), b (kept), a (thrown) ... and drift in
// the scene -- people walking in and out of view, a streaming hitch -- falls on both sides alike.

/** Which side frame `i` of a run is on: 0 for `a`, 1 for `b`. */
export function abSide(i: number, block: number): 0 | 1 {
  const b = Math.max(1, Math.floor(block));
  return (Math.floor(i / (2 * b)) % 2) as 0 | 1;
}

/** Whether frame `i` of a run counts: false on the first block after each flip. */
export function abKeep(i: number, block: number): boolean {
  const b = Math.max(1, Math.floor(block));
  return i % (2 * b) >= b;
}

/** How many frames a run of about `frames` really takes: whole cycles (a thrown, a kept, b thrown, b kept), at least one. */
export function abLength(frames: number, block: number): number {
  const cycle = 4 * Math.max(1, Math.floor(block));
  return Math.max(1, Math.ceil(Math.max(1, frames) / cycle)) * cycle;
}

// ---------------------------------------------------------------------------------------------
// The report.

/** One timed section: its name, how deep it sits under the others, and what it cost per frame (ms). */
export interface SectionRow {
  name: string;
  depth: number;
  mean: number;
  p50: number;
  p95: number;
  max: number;
}

/** One kind of pass: what it cost per frame and what it drew, as means over the frames reported. */
export interface PassRow {
  name: string;
  /** CPU ms per frame. */
  ms: number;
  /** GPU ms per frame, when the timer was on and answered; null otherwise. */
  gpuMs: number | null;
  /** How many passes of this kind a frame made (the interiors are one per building drawn). */
  calls: number;
  draws: number;
  skinned: number;
  instanced: number;
  instances: number;
  triangles: number;
}

/** The whole report `__debug.perf()` hands back. */
export interface PerfReport {
  /** Frames of play the report covers. */
  frames: number;
  /** Frames between them that went by paused (the menu, a panel, the map, a loading screen, a death), which are left out. */
  paused: number;
  /** Whether the sections and draws were being recorded over those frames. */
  timed: boolean;
  /** The CPU time of the frame's step, in ms. */
  frame: Spread;
  /** The wall time from one frame to the next, in ms: what a frame rate is made of. */
  interval: Spread;
  fps: number;
  /** Draw calls per frame, from the renderer's own count (recorded whether or not timing is on). */
  calls: number;
  sections: SectionRow[];
  passes: PassRow[];
  shadow: { casters: number[]; strays: number };
  /** Counters by group ('skeletons', 'streaming', and whatever later steps add), each a mean per frame or the last value of a gauge. */
  groups: Record<string, Record<string, number>>;
  /** The switches registered, with the value each holds now. */
  switches: Record<string, unknown>;
  notes: string[];
}

const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));
const lpad = (s: string, n: number): string => (s.length >= n ? s : ' '.repeat(n - s.length) + s);

/** A number as the table prints it: two places under ten, one under a thousand, none above. */
export function fmt(v: number): string {
  if (!Number.isFinite(v)) return '-';
  if (Number.isInteger(v)) return String(v);
  const a = Math.abs(v);
  if (a >= 1000) return Math.round(v).toString();
  if (a >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

/** The report as a short fixed-width table, for the console: what the owner reads and pastes back. */
export function formatReport(r: PerfReport): string {
  const L: string[] = [];
  L.push(`perf: ${r.frames} frames of play${r.paused ? ` (${r.paused} paused left out)` : ''}${r.timed ? '' : ' (timing was off: sections and draws are empty)'}`);
  L.push(`frame cpu  p50 ${fmt(r.frame.p50)}  p95 ${fmt(r.frame.p95)}  max ${fmt(r.frame.max)} ms   every p50 ${fmt(r.interval.p50)} ms (${Math.round(r.fps)} fps)   ${Math.round(r.calls)} draw calls`);
  if (r.sections.length) {
    L.push('');
    L.push(`${pad('section (ms/frame)', 22)}${lpad('mean', 8)}${lpad('p50', 8)}${lpad('p95', 8)}${lpad('max', 8)}`);
    for (const s of r.sections) L.push(`${pad('  '.repeat(s.depth) + s.name, 22)}${lpad(fmt(s.mean), 8)}${lpad(fmt(s.p50), 8)}${lpad(fmt(s.p95), 8)}${lpad(fmt(s.max), 8)}`);
  }
  if (r.passes.length) {
    const gpu = r.passes.some((p) => p.gpuMs !== null);
    L.push('');
    L.push(`${pad('pass (per frame)', 14)}${lpad('ms', 7)}${gpu ? lpad('gpu', 7) : ''}${lpad('n', 5)}${lpad('draws', 8)}${lpad('skinned', 9)}${lpad('inst', 7)}${lpad('instances', 11)}${lpad('tris', 10)}`);
    for (const p of r.passes) {
      L.push(`${pad(p.name, 14)}${lpad(fmt(p.ms), 7)}${gpu ? lpad(p.gpuMs === null ? '-' : fmt(p.gpuMs), 7) : ''}${lpad(fmt(p.calls), 5)}${lpad(Math.round(p.draws).toString(), 8)}${lpad(Math.round(p.skinned).toString(), 9)}${lpad(Math.round(p.instanced).toString(), 7)}${lpad(Math.round(p.instances).toString(), 11)}${lpad(Math.round(p.triangles).toString(), 10)}`);
    }
    L.push(`shadow casters per cascade ${r.shadow.casters.map((c) => Math.round(c)).join(' / ') || '-'}   strays ${Math.round(r.shadow.strays)}`);
  }
  const groups = Object.keys(r.groups);
  if (groups.length) L.push('');
  for (const g of groups) {
    const row = r.groups[g];
    wrapParts(
      L,
      `${g}: `,
      Object.keys(row).map((k) => `${k} ${fmt(row[k])}`),
    );
  }
  const sw = Object.keys(r.switches);
  if (sw.length)
    wrapParts(
      L,
      'switches: ',
      sw.map((k) => `${k}=${String(r.switches[k])}`),
    );
  for (const n of r.notes) L.push(`note: ${n}`);
  return L.join('\n');
}

/** Lay `parts` out after `head`, comma separated, starting a new indented line before one would pass `width`. */
function wrapParts(L: string[], head: string, parts: string[], width = 100): void {
  let line = head;
  let first = true;
  for (const p of parts) {
    const add = first ? p : `, ${p}`;
    if (!first && line.length + add.length > width) {
      L.push(`${line},`);
      line = ' '.repeat(Math.min(head.length, 4)) + p;
    } else line += add;
    first = false;
  }
  L.push(line);
}

/** One side of an A/B run. */
export interface AbSide {
  value: unknown;
  frames: number;
  frame: Spread;
  interval: Spread;
  calls: number;
  /** Draws per frame by pass kind, when timing was on for that side (empty otherwise). */
  draws: Record<string, number>;
}

/** What an A/B run hands back. */
export interface AbReport {
  key: string;
  block: number;
  ran: number;
  a: AbSide;
  b: AbSide;
  /** b minus a, in ms: negative is b faster. */
  delta: { p50: number; p95: number; mean: number };
  notes: string[];
}

/** An A/B run as a few lines of table. */
export function formatAb(r: AbReport): string {
  const L: string[] = [];
  L.push(`ab ${r.key}: ${r.ran} frames in blocks of ${r.block}, the first block after each flip thrown away`);
  L.push(`${pad('side', 18)}${lpad('frames', 8)}${lpad('p50', 8)}${lpad('p95', 8)}${lpad('max', 8)}${lpad('mean', 8)}${lpad('every', 8)}${lpad('calls', 8)}`);
  for (const [name, s] of [
    ['a', r.a],
    ['b', r.b],
  ] as const) {
    L.push(`${pad(`${name} = ${String(s.value)}`, 18)}${lpad(String(s.frames), 8)}${lpad(fmt(s.frame.p50), 8)}${lpad(fmt(s.frame.p95), 8)}${lpad(fmt(s.frame.max), 8)}${lpad(fmt(s.frame.mean), 8)}${lpad(fmt(s.interval.p50), 8)}${lpad(Math.round(s.calls).toString(), 8)}`);
  }
  L.push(`b - a: p50 ${fmt(r.delta.p50)} ms, p95 ${fmt(r.delta.p95)} ms, mean ${fmt(r.delta.mean)} ms`);
  const kinds = [...new Set([...Object.keys(r.a.draws), ...Object.keys(r.b.draws)])];
  if (kinds.length) L.push(`draws a / b: ${kinds.map((k) => `${k} ${Math.round(r.a.draws[k] ?? 0)} / ${Math.round(r.b.draws[k] ?? 0)}`).join(', ')}`);
  for (const n of r.notes) L.push(`note: ${n}`);
  return L.join('\n');
}
