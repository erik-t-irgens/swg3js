// The key census on WebGPU (the GPU port's pass 1, wave 1, item 1): `__debug.gpu({ keys: true })` lists every render pipeline
// three holds, with the field of three's key that separates it from its nearest sibling, and groups the count by that field;
// and what would leave if bone count left the key (wave 4's pool) or the morphs were baked (item 2's projection). On WebGPU
// alone: reached through `start.ts`, nothing of it loaded on the WebGL path, and nothing of it runs unless asked.
//
// Three 0.187 keeps a render pipeline (`Pipelines.caches`) under `vertexProgram.id,fragmentProgram.id,` and the draw state
// (`WebGPUBackend.getRenderCacheKey`: blending, depth, stencil, polygon offset, side, the coverage, the winding, the sample
// count, the outputs' formats, the topology, the vertex layout, the clipping). Two pipelines whose programs are one differ in
// the draw state alone, and that part of the key names the field. Where the programs differ, the parts of three's program
// key read off the render object as the pipeline was made (`pipeLedger.ts`'s `KeyFields`) name it: the bone count, a morph
// attribute, the attributes, the instancing, receiving shadows, the light set, the environment, the outputs, the clipping,
// the material's own graph, or one of the material's properties (a texture's sampler state among them). A pair that differs
// in none of them differs in program text the key's parts do not show, and says so.

import { LEDGER, type KeyFields, type PipeRecord, WHERE } from './pipeLedger.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Three's draw state, as `getRenderCacheKey` joins it, grouped into the fields the census names: its first 27 items stand
 * where they stand. From three's development commit 577fb27 on (pass 1, wave 2) the colour formats are every output's,
 * joined (`getCurrentColorFormats( ctx ).join()`), so the items after the colour space shift by the outputs' count less one,
 * and the census finds them from the topology, the first item after them that names one.
 */
export const DRAW_STATE_GROUPS: readonly [string, readonly number[]][] = [
  ['blending', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 24]],
  ['depth', [10, 11, 12]],
  ['stencil', [13, 14, 15, 16, 17, 18, 19]],
  ['polygon offset', [20, 21, 22]],
  ['side', [23]],
  ['winding', [25]],
  ['sample count', [26]],
];
/** The colour space's item: the output formats are it, every colour format after it and the depth-stencil format. */
const COLOR_SPACE = 27;
/** A WebGPU primitive topology, the item that follows the output formats. */
const TOPOLOGY = /^(point-list|line-list|line-strip|triangle-list|triangle-strip)$/;

export interface ParsedKey {
  v: string;
  f: string;
  /** Each draw-state group's items joined, by group name, and the vertex layout and clipping. */
  state: Record<string, string>;
}

/** Three's pipeline key taken apart: its two programs and its draw state by group. */
export function parsePipelineKey(key: string): ParsedKey {
  const parts = key.split(',');
  const v = parts[0] ?? '';
  const f = parts[1] ?? '';
  const s = parts.slice(2);
  const state: Record<string, string> = {};
  for (const [name, idx] of DRAW_STATE_GROUPS) state[name] = idx.map((i) => s[i] ?? '').join(',');
  // The topology: the first item past the colour space and one colour format and the depth-stencil format that names one.
  let t = COLOR_SPACE + 3;
  while (t < s.length && !TOPOLOGY.test(s[t])) t++;
  if (t >= s.length) t = COLOR_SPACE + 3;
  state['output formats'] = s.slice(COLOR_SPACE, t).join(',');
  state.topology = [s[t] ?? '', s[t + 1] ?? ''].join(',');
  const fixed = t + 2;
  state['vertex layout'] = s.slice(fixed, -1).join(',');
  state.clipping = s.length > fixed ? (s[s.length - 1] ?? '') : '';
  return { v, f, state };
}

/** The program fields compared, each by the name the census gives it. */
const PROGRAM_FIELDS: readonly [keyof KeyFields, string][] = [
  ['bones', 'bone count'],
  ['morph', 'morph attribute'],
  ['attrs', 'attributes'],
  ['inst', 'instancing'],
  ['recv', 'receives shadows'],
  ['lights', 'light set'],
  ['env', 'environment'],
  ['outputs', 'outputs'],
  ['clip', 'clipping'],
  ['custom', 'node graph'],
  ['scene', 'scene'],
];

const propsRead = new Map<string, Map<string, string>>();
/** A property key (`name=value;`) read into a map, once for each distinct key. */
function readProps(s: string): Map<string, string> {
  let m = propsRead.get(s);
  if (m) return m;
  m = new Map<string, string>();
  for (const kv of s.split(';')) {
    if (!kv) continue;
    const i = kv.indexOf('=');
    m.set(kv.slice(0, i), kv.slice(i + 1));
  }
  propsRead.set(s, m);
  return m;
}

/** How many material properties differ between two property keys. */
function propsDistance(a: string, b: string): number {
  if (a === b) return 0;
  const pa = readProps(a);
  const pb = readProps(b);
  let n = 0;
  for (const [k, v] of pa) if (pb.get(k) !== v) n++;
  for (const k of pb.keys()) if (!pa.has(k)) n++;
  return n;
}

/** The material properties that differ between two property keys (`name=value;`), by name. */
export function propsDiffer(a: string, b: string): string[] {
  if (a === b) return [];
  const pa = readProps(a);
  const pb = readProps(b);
  const out: string[] = [];
  for (const k of new Set([...pa.keys(), ...pb.keys()])) {
    const x = pa.get(k);
    const y = pb.get(k);
    if (x === y) continue;
    // A texture on both sides that differs is its sampler state (three keys WebGPU's sampler into the material's key).
    out.push(x?.startsWith('{') && y?.startsWith('{') && x !== '{}' && y !== '{}' ? `sampler state (${k})` : `property ${k}`);
  }
  return out;
}

export interface Pipe {
  key: string;
  parsed: ParsedKey;
  rec: PipeRecord | null;
}

/** What separates two pipelines: each field named, with the two values where they are short. */
export function separate(a: Pipe, b: Pipe): { fields: string[]; detail: string[]; distance: number } {
  const fields: string[] = [];
  const detail: string[] = [];
  let distance = 0;
  for (const name of Object.keys(a.parsed.state)) {
    const x = a.parsed.state[name];
    const y = b.parsed.state[name];
    if (x === y) continue;
    fields.push(name);
    detail.push(name === 'vertex layout' ? name : `${name} ${x} vs ${y}`);
    distance++;
  }
  const programs = a.parsed.v !== b.parsed.v || a.parsed.f !== b.parsed.f;
  if (programs) {
    const fa = a.rec?.fields ?? null;
    const fb = b.rec?.fields ?? null;
    let named = 0;
    if (fa && fb) {
      for (const [k, name] of PROGRAM_FIELDS) {
        if (fa[k] === fb[k]) continue;
        fields.push(name);
        detail.push(k === 'bones' || k === 'recv' || k === 'inst' ? `${name} ${String(fa[k]) || '-'} vs ${String(fb[k]) || '-'}` : name);
        named++;
      }
      for (const p of propsDiffer(fa.props, fb.props)) {
        fields.push(p.startsWith('sampler') ? 'sampler state' : p);
        detail.push(p);
        named++;
      }
    }
    if (!fa || !fb) {
      fields.push('program (unrecorded)');
      detail.push('program: one of the two was made before the ledger or has left its ring');
      named++;
    } else if (named === 0 && (a.parsed.state.side !== b.parsed.state.side || a.parsed.state.blending !== b.parsed.state.blending)) {
      // Three writes the side (a two-sided see-through thing drawn back then front) and the blending into the program as
      // well as the draw state: a pair apart in those alone is apart in them, its programs following.
      named++;
    } else if (named === 0) {
      fields.push('program text');
      detail.push(`program text the key's parts do not show (${a.parsed.v !== b.parsed.v ? 'vertex' : ''}${a.parsed.v !== b.parsed.v && a.parsed.f !== b.parsed.f ? ' and ' : ''}${a.parsed.f !== b.parsed.f ? 'fragment' : ''})`);
      named++;
    }
    distance += named;
  }
  return { fields: [...new Set(fields)], detail, distance };
}

/** How far apart two pipelines are: the fields `separate` would name, counted without naming them. */
function distanceOf(a: Pipe, b: Pipe): number {
  let d = 0;
  const sa = a.parsed.state;
  const sb = b.parsed.state;
  for (const k in sa) if (sa[k] !== sb[k]) d++;
  if (a.parsed.v === b.parsed.v && a.parsed.f === b.parsed.f) return d;
  const fa = a.rec?.fields;
  const fb = b.rec?.fields;
  if (!fa || !fb) return d + 1;
  let n = 0;
  for (const [k] of PROGRAM_FIELDS) if (fa[k] !== fb[k]) n++;
  n += propsDistance(fa.props, fb.props);
  return d + (n || 1);
}

/**
 * The nearest sibling of each pipeline: the fewest fields apart, looked for first among pipelines of its own material kind
 * and pass (all of them where it is alone there), a different kind or pass counting half and a quarter of a field.
 */
export function nearestSiblings(pipes: Pipe[]): { i: number; j: number; fields: string[]; detail: string[] }[] {
  const groups = new Map<string, number[]>();
  for (let i = 0; i < pipes.length; i++) {
    const r = pipes[i].rec;
    const g = r ? `${r.matType}|${r.pass}` : '?';
    let list = groups.get(g);
    if (!list) groups.set(g, (list = []));
    list.push(i);
  }
  const all = pipes.map((_, i) => i);
  const out: { i: number; j: number; fields: string[]; detail: string[] }[] = [];
  for (let i = 0; i < pipes.length; i++) {
    const r = pipes[i].rec;
    const own = groups.get(r ? `${r.matType}|${r.pass}` : '?')!;
    const pool = own.length > 1 ? own : all;
    let best = -1;
    let bestD = Infinity;
    for (const j of pool) {
      if (j === i) continue;
      const b = pipes[j].rec;
      const d = distanceOf(pipes[i], pipes[j]) + (r && b && r.matType !== b.matType ? 0.5 : 0) + (r && b && r.pass !== b.pass ? 0.25 : 0);
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    if (best < 0) out.push({ i, j: -1, fields: ['alone'], detail: ['the only pipeline'] });
    else {
      const s = separate(pipes[i], pipes[best]);
      out.push({ i, j: best, fields: s.fields.length ? s.fields : ['nothing (one key held twice?)'], detail: s.detail });
    }
  }
  return out;
}

/**
 * One pipeline's signature from the parts of its key, some left out: what wave 4's pool (the bone count out of the key) and
 * the morph bake (no morphs on the drawn mesh) would merge. Unrecorded pipelines keep their own key.
 */
export function signature(p: Pipe, drop: { bones?: boolean; morph?: boolean }): string {
  const f = p.rec?.fields;
  if (!f) return `key:${p.key}`;
  const st = p.parsed.state;
  const state = Object.keys(st)
    .map((k) => st[k])
    .join('|');
  return [p.rec!.pass, f.custom, f.props, f.attrs, f.inst, f.recv, f.lights, f.env, f.outputs, f.clip, drop.bones && f.bones > 0 ? 'pooled' : f.bones, drop.morph ? '' : f.morph, state].join('§');
}

/** The pipelines three holds (render pipelines; compute ones counted apart). */
export function heldPipes(renderer: Any): { pipes: Pipe[]; compute: number } {
  const caches: Map<string, Any> | undefined = renderer?._pipelines?.caches;
  const pipes: Pipe[] = [];
  let compute = 0;
  if (!caches) return { pipes, compute };
  for (const [key, p] of caches) {
    if (!p || !p.vertexProgram || !p.fragmentProgram) {
      compute++;
      continue;
    }
    pipes.push({ key, parsed: parsePipelineKey(key), rec: LEDGER.byKey.get(key) ?? null });
  }
  return { pipes, compute };
}

const count = (into: Record<string, number>, k: string): void => {
  into[k] = (into[k] ?? 0) + 1;
};
const sorted = (o: Record<string, number>): Record<string, number> => Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));

export interface CensusOptions {
  /** List every pipeline (true), or the first `limit` (default all with `list`, none without). */
  list?: boolean;
  limit?: number;
}

/** The census over a set of pipelines (the running game's, or a test's stand-ins). */
export function censusOf(pipes: Pipe[], compute: number, o: CensusOptions = {}): Record<string, unknown> {
  const sib = nearestSiblings(pipes);
  const byField: Record<string, number> = {};
  const byLabel: Record<string, number> = {};
  const byPass: Record<string, number> = {};
  const byAsked: Record<string, number> = {};
  const bones: Record<string, number> = {};
  const morphs = new Set<string>();
  let morphed = 0;
  for (const s of sib) {
    for (const f of s.fields) count(byField, f);
    count(byLabel, s.fields.join(' + '));
    const r = pipes[s.i].rec;
    count(byPass, r ? r.pass : 'unrecorded');
    count(byAsked, r ? WHERE[r.where] : 'unrecorded');
    if (r?.fields && r.fields.bones > 0) count(bones, String(r.fields.bones));
    if (r?.fields?.morph) {
      morphed++;
      morphs.add(r.fields.morph);
    }
  }
  const distinct = (drop: { bones?: boolean; morph?: boolean }): number => new Set(pipes.map((p) => signature(p, drop))).size;
  const sig0 = distinct({});
  const sigPool = distinct({ bones: true });
  const sigBake = distinct({ morph: true });
  const sigBoth = distinct({ bones: true, morph: true });
  const held = pipes.length;
  const out: Record<string, unknown> = {
    renderer: 'WebGPU',
    pipelines: held,
    computePipelines: compute,
    recorded: pipes.filter((p) => p.rec).length,
    byPass: sorted(byPass),
    asked: sorted(byAsked),
    separatedBy: sorted(byField),
    separatedByAll: sorted(byLabel),
    bodies: { skinnedByBoneCount: sorted(bones), morphed, morphKeys: morphs.size },
    projection: {
      signatures: sig0,
      note: "signatures are the parts of three's key the ledger read; where they are fewer than the pipelines, the rest differ in program text those parts do not show, and each projection is the pipelines held less the signatures it merges",
      boneCountOut: { merges: sig0 - sigPool, leaves: held - (sig0 - sigPool) },
      morphsBaked: { merges: sig0 - sigBake, leaves: held - (sig0 - sigBake) },
      both: { merges: sig0 - sigBoth, leaves: held - (sig0 - sigBoth) },
    },
  };
  const want = o.list ? Math.max(0, Math.floor(o.limit ?? held)) : 0;
  if (want) {
    out.list = sib.slice(0, want).map((s) => {
      const p = pipes[s.i];
      const r = p.rec;
      const q = s.j >= 0 ? pipes[s.j].rec : null;
      return {
        key: p.key.length > 90 ? `${p.key.slice(0, 90)}…` : p.key,
        material: r ? `${r.matType}${r.matName ? ` "${r.matName}"` : ''}#${r.matId}` : '?',
        firstObject: r ? `${r.objType}${r.objName ? ` "${r.objName}"` : ''}#${r.objId}` : '?',
        pass: r ? r.pass : '?',
        asked: r ? WHERE[r.where] : '?',
        separatedBy: s.detail.join('; '),
        sibling: q ? `${q.matName || q.matType}#${q.matId} on ${q.objName || q.objType}#${q.objId}` : s.j >= 0 ? 'unrecorded' : 'none',
      };
    });
  }
  return out;
}

/** `__debug.gpu({ keys })` over the running renderer. */
export function keyCensus(renderer: Any, o: CensusOptions = {}): Record<string, unknown> {
  const { pipes, compute } = heldPipes(renderer);
  const out = censusOf(pipes, compute, o);
  out.ledger = { installed: LEDGER.installed, made: LEDGER.made, fieldErrors: LEDGER.fieldErrors, recordingMs: Math.round(LEDGER.recordMs) };
  out.how = "{ keys: true } counts and groups; { keys: { list: true, limit: 50 } } lists each pipeline with its first object, pass, who asked and what separates it from its nearest sibling";
  return out;
}
