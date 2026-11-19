// Where load time goes (the GPU port's pass 1, wave 2, item 2; `__debug.load()`): the last journeys -- the page's start to
// the character list, and each arrival or trip between worlds (the travel's flag up, to down) -- split by stage, on either
// renderer. Three sources, and nothing worked out until asked but the marks themselves:
//
// - **The downloads**: the browser's own record of every file fetched (resource timing), by kind: the packs' files, the
//   models, the textures, the terrain's, the sounds, the code. The browser keeps 250 of them by default; `index.html` gives it
//   room for the dev server's module graph, which is fetched whole before the game's first line runs, and each time the
//   record fills it is folded here into a kept ring (start, end, bytes over the wire, bytes of the file, kind) and cleared,
//   so nothing is let go. Nothing of it runs in a frame.
// - **The marks**: a stage's piece of work timed where it runs, kept only while a journey is open (`LOAD.open`): a model
//   unpacked (its GLB taken apart and its textures decoded, from the loader's first hook to its last: a wall span, since it
//   runs across awaits), the ground's pictures decoded and laid into their arrays (a span too), a terrain chunk or far tile
//   built, a chunk's plants and props, a physics collider made, a tier of placed objects or a building's rooms put together
//   (each the main thread's own, start to end). Closed, a mark's site reads one flag and never the clock.
// - **The game's own figures**, handed in: the loading screen's phases (each going up and away and the words it said, kept
//   here as they come, bounded), and the shader figures (the landing log's pipelines on WebGPU; the link waits, the programs
//   built behind the screens and the sweep's on WebGL).
//
// Every interval is wall time. The stages overlap one another and the downloads (a model unpacks while the next downloads),
// so a stage's `wallS` is the union of its own intervals and `busyS` their sum, and what is left is the journey's time
// covered by none of them: waits on bounds and timers, the screen's reveal, and the main thread's work no mark covers.
// Nothing here imports three or anything of the WebGPU side: the WebGL boot loads it as it is.

/** The stages a mark can be of. */
export const STAGES = ['models', 'textures', 'terrain', 'flora', 'colliders', 'scene'] as const;
export const ST_MODELS = 0;
export const ST_TEXTURES = 1;
export const ST_TERRAIN = 2;
export const ST_FLORA = 3;
export const ST_COLLIDERS = 4;
export const ST_SCENE = 5;
/** What each stage's marks are: a span across awaits (other work runs inside it), or the main thread's own work. */
export const STAGE_IS = ['a span (each GLB from the loader’s first hook to its last, its textures decoded inside it)', 'a span (the ground’s pictures decoded, then laid into their arrays)', 'the main thread (a chunk’s ground, a far tile)', 'the main thread (a chunk’s plants and props, its grass)', 'the main thread (each collider made, the physics engine’s own build of it inside)', 'the main thread (a tier of placed objects instanced, a building’s rooms built)'] as const;

/** The kinds a download is filed under, by its address. */
export const KINDS = ['packs', 'models', 'textures', 'terrain', 'sounds', 'code', 'other'] as const;
export const K_PACKS = 0;
export const K_MODELS = 1;
export const K_TEXTURES = 2;
export const K_TERRAIN = 3;
export const K_SOUNDS = 4;
export const K_CODE = 5;
export const K_OTHER = 6;

/** How much is kept: journeys, mark intervals, downloads and screen phases. A diagnostic's bounds, not numbers of feel. */
export const LOAD_CAP = { journeys: 12, intervals: 8192, resources: 16384, phases: 256 };
/** A stage's mark this close to its last interval (or overlapping it) is folded into it, ms: a loop of colliders is one interval. */
export const MERGE_MS = 0.5;

/** The words of a screen's phase that are shader work: what `share` counts as the shaders' by phase. */
const SHADER_WORDS = /shader|compil|graphics driver|ship effects|reflections/i;

export interface Journey {
  n: number;
  kind: 'page' | 'trip';
  /** The first loading screen's title (a trip), or the page's. */
  title: string;
  /** performance.now() at its start and end; `end` -1 while open. */
  start: number;
  end: number;
  /** Per stage: milliseconds summed over its marks, and how many marks. */
  busy: Float64Array;
  count: Float64Array;
  /** The intervals made before it began and when it ended (absolute counts into the ring). */
  ivFrom: number;
  ivTo: number;
  /** WebGL's link waits, ms so far, at its start and end (NaN where none was handed). */
  linkFrom: number;
  linkTo: number;
  /** What its screens built and their sweeps' own, from the loading log at its end (WebGL's figures). */
  screens: { title: string; s: number | null; programs: number; sweep: { programs: number; ms: number } | null }[];
}

interface PhaseEvent {
  at: number;
  words: string;
}

/** The state, one per page. */
export const LOAD = {
  /** A journey is open: what every mark's site reads before it reads the clock. */
  open: false,
  installed: false,
  current: null as Journey | null,
  journeys: [] as Journey[],
  made: 0,
  // The marks' intervals, a ring, made at the first mark.
  ivStage: null as Uint8Array | null,
  ivStart: null as Float64Array | null,
  ivEnd: null as Float64Array | null,
  ivMade: 0,
  /** Each stage's last interval (an absolute count), for folding the next into it; -1 for none. */
  lastOf: new Float64Array(STAGES.length).fill(-1),
  // The downloads, a ring, made at the first fold.
  resStart: null as Float64Array | null,
  resEnd: null as Float64Array | null,
  resWire: null as Float32Array | null,
  resFile: null as Float32Array | null,
  resKind: null as Uint8Array | null,
  resMade: 0,
  folds: 0,
  /** The screens' phases as they came (a bounded list). */
  phases: [] as PhaseEvent[],
};

const now = (): number => performance.now();

/** Digits folded into one mark, so "building shaders, 3 new" and "…, 4 new" are one phase. */
function foldWords(s: string): string {
  return s.replace(/\d+(\.\d+)?/g, '#');
}

function newJourney(kind: 'page' | 'trip', start: number, link: number, title: string): Journey {
  const j: Journey = { n: LOAD.made++, kind, title, start, end: -1, busy: new Float64Array(STAGES.length), count: new Float64Array(STAGES.length), ivFrom: LOAD.ivMade, ivTo: -1, linkFrom: link, linkTo: NaN, screens: [] };
  if (LOAD.journeys.length >= LOAD_CAP.journeys) LOAD.journeys.shift();
  LOAD.journeys.push(j);
  LOAD.current = j;
  LOAD.open = true;
  return j;
}

/**
 * Installed once, at the boot's first line: the page's own journey opened from the navigation's start, and the browser's
 * record of downloads folded here whenever it fills. Nothing else.
 */
export function installLoadTimes(): void {
  if (LOAD.installed) return;
  LOAD.installed = true;
  newJourney('page', 0, NaN, "the page's start");
  const perf = globalThis.performance as (Performance & { addEventListener?: (t: string, f: () => void) => void }) | undefined;
  if (perf && typeof perf.addEventListener === 'function') perf.addEventListener('resourcetimingbufferfull', () => void foldResources());
}

/** Everything forgotten, as at a page's start before the install (the tests'). */
export function resetLoadTimes(): void {
  LOAD.open = false;
  LOAD.installed = false;
  LOAD.current = null;
  LOAD.journeys.length = 0;
  LOAD.made = 0;
  LOAD.ivMade = 0;
  LOAD.lastOf.fill(-1);
  // The rings made again at their next use, at whatever size `LOAD_CAP` says then.
  LOAD.ivStage = null;
  LOAD.ivStart = null;
  LOAD.ivEnd = null;
  LOAD.resStart = null;
  LOAD.resEnd = null;
  LOAD.resWire = null;
  LOAD.resFile = null;
  LOAD.resKind = null;
  LOAD.resMade = 0;
  LOAD.folds = 0;
  LOAD.phases.length = 0;
}

/** A journey begins (the travel's flag went up). `link` is WebGL's link waits so far, ms. One open is ended first. */
export function loadBegin(at: number, link = NaN): void {
  if (LOAD.current) loadEnd(at, { link });
  newJourney('trip', at, link, '');
}

/** What the game hands as a journey ends. */
export interface JourneyEnd {
  link?: number;
  screens?: Journey['screens'];
}

/** The journey open ends (the flag came down, its screen gone; or the page's at the character list). */
export function loadEnd(at: number, e: JourneyEnd = {}): void {
  const j = LOAD.current;
  if (!j) return;
  j.end = at;
  j.ivTo = LOAD.ivMade;
  j.linkTo = e.link ?? NaN;
  if (e.screens) j.screens = e.screens;
  if (!j.title && j.screens.length) j.title = j.screens[0].title;
  LOAD.current = null;
  LOAD.open = false;
}

/**
 * The loading screen changed (`LoadingScreen.onChange`), or the boot said what it is doing: kept in the order it came, so a
 * journey's phases are the stretches between them. `on`'s title names the journey under way when it has none yet; `off` is
 * a stretch of its own (the screen gone).
 */
export function loadPhase(kind: 'on' | 'what' | 'off', text: string, at: number): void {
  if (kind === 'on') {
    const j = LOAD.current;
    if (j && !j.title) j.title = text;
    return;
  }
  const words = kind === 'off' ? '(no screen up)' : foldWords(text);
  const last = LOAD.phases[LOAD.phases.length - 1];
  if (last && last.words === words) return;
  if (LOAD.phases.length >= LOAD_CAP.phases) LOAD.phases.shift();
  LOAD.phases.push({ at, words });
}

/** The clock at a mark's start: now while a journey is open, else 0 and the clock not read. */
export function markStart(): number {
  return LOAD.open ? now() : 0;
}

/** A stage's piece of work begun at `t0` (`markStart`'s) ended now: kept while a journey is open, nothing otherwise. */
export function markEnd(stage: number, t0: number): void {
  if (LOAD.open && t0 > 0) loadMark(stage, t0, now());
}

/** A stage's piece of work ran from `t0` to `t1`: summed into the open journey and kept as an interval. */
export function loadMark(stage: number, t0: number, t1: number): void {
  const j = LOAD.current;
  if (!j) return;
  if (t0 < j.start) t0 = j.start;
  if (!(t1 >= t0)) return;
  j.busy[stage] += t1 - t0;
  j.count[stage]++;
  const cap = LOAD_CAP.intervals;
  if (!LOAD.ivStage) {
    LOAD.ivStage = new Uint8Array(cap);
    LOAD.ivStart = new Float64Array(cap);
    LOAD.ivEnd = new Float64Array(cap);
  }
  const s = LOAD.ivStart!;
  const e = LOAD.ivEnd!;
  // Folded into the stage's last interval where the two meet: a loop of colliders, or two models unpacking at once.
  const last = LOAD.lastOf[stage];
  if (last >= j.ivFrom && LOAD.ivMade - last <= cap) {
    const i = last % cap;
    if (t0 <= e[i] + MERGE_MS && t1 >= s[i] - MERGE_MS) {
      if (t0 < s[i]) s[i] = t0;
      if (t1 > e[i]) e[i] = t1;
      return;
    }
  }
  const i = LOAD.ivMade % cap;
  LOAD.ivStage[i] = stage;
  s[i] = t0;
  e[i] = t1;
  LOAD.lastOf[stage] = LOAD.ivMade;
  LOAD.ivMade++;
}

/** The kind a download's address is filed under. A pack's terrain folder is the terrain's, its pictures with it. */
export function kindOfUrl(url: string): number {
  let path = url;
  const q = path.search(/[?#]/);
  if (q >= 0) path = path.slice(0, q);
  path = path.toLowerCase();
  if (/\.(m?js|tsx?|css|wasm|html?)$/.test(path) || /\/(@vite|@fs|@id|node_modules|src)\//.test(path)) return K_CODE;
  if (/\.(wav|mp3|ogg|opus|flac|m4a)$/.test(path) || /\/(music|sound|sounds)\//.test(path)) return K_SOUNDS;
  if (/\/terrain\//.test(path) || /\.(trn|hmap|f32|r16|u16)$/.test(path)) return K_TERRAIN;
  if (/\.(glb|gltf)$/.test(path)) return K_MODELS;
  if (/\.(png|jpe?g|webp|avif|gif|bmp|dds|ktx2?|basis|rgba)$/.test(path)) return K_TEXTURES;
  if (/\.(json|lay|zip|bin|txt|csv|tsv|iff)$/.test(path) || path.includes('/assets-private/')) return K_PACKS;
  return K_OTHER;
}

/** One download into the kept ring. */
export function pushResource(url: string, start: number, end: number, wire: number, file: number): void {
  const cap = LOAD_CAP.resources;
  if (!LOAD.resStart) {
    LOAD.resStart = new Float64Array(cap);
    LOAD.resEnd = new Float64Array(cap);
    LOAD.resWire = new Float32Array(cap);
    LOAD.resFile = new Float32Array(cap);
    LOAD.resKind = new Uint8Array(cap);
  }
  const i = LOAD.resMade % cap;
  LOAD.resStart[i] = start;
  LOAD.resEnd![i] = end >= start ? end : start;
  LOAD.resWire![i] = wire > 0 ? wire : 0;
  LOAD.resFile![i] = file > 0 ? file : 0;
  LOAD.resKind![i] = kindOfUrl(url);
  LOAD.resMade++;
}

interface ResourceEntry {
  name: string;
  startTime: number;
  responseEnd: number;
  duration: number;
  transferSize?: number;
  decodedBodySize?: number;
}

/**
 * The browser's record of downloads as it stands, folded into the ring and cleared (so it never fills and lets one go).
 * On a full record (`resourcetimingbufferfull`) and as a report is asked; answers how many were folded.
 */
export function foldResources(perf: { getEntriesByType?(t: string): unknown[]; clearResourceTimings?(): void } | undefined = globalThis.performance as never): number {
  if (!perf || typeof perf.getEntriesByType !== 'function') return 0;
  const list = perf.getEntriesByType('resource') as ResourceEntry[];
  for (const r of list) pushResource(r.name, r.startTime, r.responseEnd > 0 ? r.responseEnd : r.startTime + r.duration, r.transferSize ?? 0, r.decodedBodySize ?? 0);
  if (typeof perf.clearResourceTimings === 'function') perf.clearResourceTimings();
  LOAD.folds++;
  return list.length;
}

// ---------------------------------------------------------------------------------------------
// The report.

/** The union's length of intervals (a flat list s0, e0, s1, e1, …) clipped to [from, to], ms. */
export function unionMs(iv: readonly number[], from: number, to: number): number {
  const pairs: [number, number][] = [];
  for (let k = 0; k + 1 < iv.length; k += 2) {
    const s = Math.max(iv[k], from);
    const e = Math.min(iv[k + 1], to);
    if (e > s) pairs.push([s, e]);
  }
  pairs.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cs = Number.NaN;
  let ce = Number.NaN;
  for (const [s, e] of pairs) {
    if (!(s <= ce)) {
      if (ce > cs) total += ce - cs;
      cs = s;
      ce = e;
    } else if (e > ce) ce = e;
  }
  if (ce > cs) total += ce - cs;
  return total;
}

/** One pipeline of the landing log, its times unrounded (`__debug.gpu({ landing: { all: true, exact: true } })`'s rows). */
export interface PipeRow {
  askedMs: number;
  /** -1 while pending. */
  landedMs: number;
  asked: string;
}

/** What the game hands the report as it is asked. */
export interface LoadReportDeps {
  now: number;
  renderer: 'WebGPU' | 'WebGL';
  /** WebGPU's landing log, every record held; null on WebGL. */
  pipelines: readonly PipeRow[] | null;
  /** The page's own document, as the browser timed it (`navigation`): the page's journey's first download. */
  navigation?: { startTime: number; responseEnd: number; transferSize?: number; decodedBodySize?: number } | null;
}

const s2 = (ms: number): number => Math.round(ms / 10) / 100;
const mb = (b: number): number => Math.round(b / 10485.76) / 100;

/** The phases of a journey: each stretch between the screen's changes inside it, with its words. */
function phasesOf(j: Journey, end: number): { words: string; from: number; to: number }[] {
  const out: { words: string; from: number; to: number }[] = [];
  let words = j.kind === 'page' ? 'the page and its code (fetched and evaluated)' : '(before any screen)';
  for (const p of LOAD.phases) {
    if (p.at <= j.start) words = p.words;
  }
  let from = j.start;
  for (const p of LOAD.phases) {
    if (p.at <= j.start || p.at >= end) continue;
    if (p.at > from) out.push({ words, from, to: p.at });
    words = p.words;
    from = p.at;
  }
  if (end > from) out.push({ words, from, to: end });
  // A phase said twice apart (a settle's loop coming back to the same words) is kept as two stretches, in order.
  return out;
}

/**
 * `__debug.load()`: the last journeys, newest last, each with its downloads by kind, its stages, its shaders, its phases and
 * what is left, and the share that is shaders and the share that is not. `last` journeys (all kept by default).
 */
export function loadReport(d: LoadReportDeps, o: { last?: number } = {}): Record<string, unknown> {
  foldResources();
  const cap = LOAD_CAP.resources;
  const resHeld = Math.min(LOAD.resMade, cap);
  const resOldest = LOAD.resMade - resHeld;
  const oldestStart = resHeld ? LOAD.resStart![resOldest % cap] : Number.POSITIVE_INFINITY;
  const ivHeld = Math.min(LOAD.ivMade, LOAD_CAP.intervals);
  const ivOldest = LOAD.ivMade - ivHeld;
  const list = LOAD.journeys.slice(-Math.max(1, Math.floor(o.last ?? LOAD_CAP.journeys)));
  const journeys = list.map((j) => {
    const end = j.end >= 0 ? j.end : d.now;
    const total = end - j.start;
    // The downloads: those begun inside it counted and weighed; every one under way inside it in the time.
    const byKind = KINDS.map(() => ({ files: 0, cached: 0, wire: 0, file: 0, iv: [] as number[] }));
    const all: number[] = [];
    for (let a = resOldest; a < LOAD.resMade; a++) {
      const i = a % cap;
      const s = LOAD.resStart![i];
      const e = LOAD.resEnd![i];
      if (e < j.start || s > end) continue;
      const k = byKind[LOAD.resKind![i]];
      k.iv.push(s, e);
      all.push(s, e);
      if (s < j.start) continue;
      k.files++;
      k.wire += LOAD.resWire![i];
      k.file += LOAD.resFile![i];
      if (LOAD.resWire![i] === 0 && LOAD.resFile![i] > 0) k.cached++;
    }
    if (j.kind === 'page' && d.navigation) {
      const n = d.navigation;
      const k = byKind[K_CODE];
      k.files++;
      k.wire += n.transferSize ?? 0;
      k.file += n.decodedBodySize ?? 0;
      k.iv.push(n.startTime, n.responseEnd);
      all.push(n.startTime, n.responseEnd);
    }
    const downloads: Record<string, unknown> = {
      files: byKind.reduce((t, k) => t + k.files, 0),
      wireMB: mb(byKind.reduce((t, k) => t + k.wire, 0)),
      fileMB: mb(byKind.reduce((t, k) => t + k.file, 0)),
      fromCache: byKind.reduce((t, k) => t + k.cached, 0),
      wallS: s2(unionMs(all, j.start, end)),
      byKind: Object.fromEntries(KINDS.map((name, i) => [name, { files: byKind[i].files, fromCache: byKind[i].cached, wireMB: mb(byKind[i].wire), fileMB: mb(byKind[i].file), wallS: s2(unionMs(byKind[i].iv, j.start, end)) }]).filter(([, v]) => (v as { files: number }).files > 0 || (v as { wallS: number }).wallS > 0)),
      ...(j.start < oldestStart && LOAD.resMade > cap ? { partial: `the ring holds the last ${cap} downloads: some of this journey's were let go` } : {}),
    };
    // The marks' intervals, by stage.
    const stageIv = STAGES.map(() => [] as number[]);
    const ivTo = j.ivTo >= 0 ? j.ivTo : LOAD.ivMade;
    for (let a = Math.max(j.ivFrom, ivOldest); a < ivTo; a++) {
      const i = a % LOAD_CAP.intervals;
      stageIv[LOAD.ivStage![i]].push(LOAD.ivStart![i], LOAD.ivEnd![i]);
    }
    const stages = Object.fromEntries(STAGES.map((name, i) => [name, { marks: j.count[i], busyS: s2(j.busy[i]), wallS: s2(unionMs(stageIv[i], j.start, end)), is: STAGE_IS[i] }]));
    // The shaders: WebGPU's pipelines from the landing log, WebGL's link waits and what its screens built.
    const shaderIv: number[] = [];
    let shaders: Record<string, unknown>;
    if (d.pipelines) {
      const byWhere: Record<string, number> = {};
      let asked = 0;
      let landed = 0;
      let pendingAtEnd = 0;
      for (const p of d.pipelines) {
        const landedAt = p.landedMs < 0 ? Number.POSITIVE_INFINITY : p.landedMs;
        if (landedAt < j.start || p.askedMs > end) continue;
        shaderIv.push(p.askedMs, Math.min(landedAt, end));
        if (p.askedMs >= j.start) {
          asked++;
          byWhere[p.asked] = (byWhere[p.asked] ?? 0) + 1;
        }
        if (landedAt >= j.start && landedAt <= end) landed++;
        if (landedAt > end) pendingAtEnd++;
      }
      shaders = { pipelinesAsked: asked, landed, pendingAtEnd, askedBy: byWhere, pendingWallS: s2(unionMs(shaderIv, j.start, end)), is: 'the wall time with at least one pipeline asked and not landed (three builds them off the main thread, a draw\'s while it waits)' };
    } else {
      const link = j.linkTo - j.linkFrom;
      let programs = 0;
      let sweepMs = 0;
      let sweepPrograms = 0;
      for (const s of j.screens) {
        programs += s.programs;
        if (s.sweep) {
          sweepMs += s.sweep.ms;
          sweepPrograms += s.sweep.programs;
        }
      }
      shaders = { linkWaitS: Number.isFinite(link) ? s2(link) : null, programsBehindScreens: programs, sweep: { programs: sweepPrograms, s: s2(sweepMs) }, is: 'the main thread waiting on shader links (timed at the GL calls), and the screens\' sweep, a wall span that holds most of them' };
    }
    // Every named thing's intervals together, for what is left.
    const named: number[] = [...all, ...shaderIv];
    for (const iv of stageIv) for (const x of iv) named.push(x);
    const left = total - unionMs(named, j.start, end);
    // The phases, each overlaid with the downloads, the stages and the shaders inside it.
    const phases = phasesOf(j, end).map((p) => {
      const len = p.to - p.from;
      const row: Record<string, unknown> = { words: p.words, s: s2(len), downloadsS: s2(unionMs(all, p.from, p.to)) };
      STAGES.forEach((name, i) => {
        const w = unionMs(stageIv[i], p.from, p.to);
        if (w > 0) row[`${name}S`] = s2(w);
      });
      if (shaderIv.length) row.pipelinesPendingS = s2(unionMs(shaderIv, p.from, p.to));
      row.leftS = s2(len - unionMs(named, p.from, p.to));
      return row;
    });
    // The share: by the screens' own words (a phase saying shaders is the shaders'), and by measure.
    let shaderPhaseMs = 0;
    for (const p of phasesOf(j, end)) if (SHADER_WORDS.test(p.words)) shaderPhaseMs += p.to - p.from;
    const measured = d.pipelines ? unionMs(shaderIv, j.start, end) : Number.isFinite(j.linkTo - j.linkFrom) ? j.linkTo - j.linkFrom : 0;
    return {
      journey: j.kind === 'page' ? "the page's start, to the character list" : `trip ${j.n}${j.title ? `: ${j.title}` : ''}`,
      beganS: s2(j.start),
      endedS: j.end >= 0 ? s2(j.end) : 'under way',
      totalS: s2(total),
      downloads,
      stages,
      shaders,
      share: {
        byPhase: { shadersS: s2(shaderPhaseMs), notShadersS: s2(total - shaderPhaseMs), shaders: total > 0 ? Math.round((shaderPhaseMs / total) * 100) / 100 : 0 },
        byMeasure: { shadersS: s2(measured), notShadersS: s2(total - measured), shaders: total > 0 ? Math.round((measured / total) * 100) / 100 : 0, is: d.pipelines ? 'pipelines pending (wall)' : 'link waits (the main thread)' },
      },
      leftS: s2(left),
      phases,
    };
  });
  return {
    renderer: d.renderer,
    since: "the page's start (seconds from it, performance.now())",
    held: { journeys: LOAD.journeys.length, downloads: resHeld, downloadsEver: LOAD.resMade, intervals: ivHeld, folds: LOAD.folds },
    journeys,
    note: "Every figure is wall time. A stage's busyS sums its marks, its wallS is their union; stages overlap one another and the downloads, so they do not add up to the total. leftS is the time no download, mark or pipeline covers: waits on bounds and timers, the screen's reveal, and work no mark covers (the people dressed, the effects warmed, the code evaluated). share.byPhase counts a screen's phase whose words are shader work as the shaders'; share.byMeasure counts what the renderer measured.",
  };
}
