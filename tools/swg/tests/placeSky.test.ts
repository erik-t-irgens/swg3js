// The sky per place (Map-maker II's ninth wave, DESIGN.md §2.11 and §12): a place of ours names one of the environment
// families of the sky in force, a weather kind and a grade look; the weather asks the places' index where it asks the area
// under the player. Held here, through the real `Weather` (loaded under the off-proof's hook, since the weather names some
// neighbours without an extension) on a stand-in sky and terrain:
//
//   1. day one: with no places source, and with an index whose places name no sky, the weather's rows, family, mix, what
//      falls and every channel's weight are dd994e9's own weather's (loaded out of git), frame for frame, by `Object.is`,
//      and so with a falling effect's file failed to load (never wanted, on the plain path and on the halves);
//   2. inside a place naming a family the weather draws that family's rows, crossfaded in over the weather's own four
//      seconds as a boundary walked over is, its blocks' textures asked for as it comes; outside, the terrain's own; the
//      console's held family first; a family the sky lacks warned of once and the table's fallback drawn; the level the
//      schedule's in both, the same as a weather with no places at the same moment;
//   3. a place's weather kind forced over the rows at the world's level, crossfaded with the rows (each half of the fade
//      through `effectFor` with its own kind), and the console's kind first;
//   4. a world's own climate written into the schedule's weights in place (the wind's pattern made again), only for its pack;
//   5. the index (`PlaceIndex.skyAt`): the smallest place naming a field answers it, a smaller place naming none leaves the
//      larger's, the world row's under all; and a world loaded with no arrival (the creator's captured place) reads none of
//      the last world's rows (`placesFileFor`, as `App.placesNow` asks the keeper).
//
// Run: node tools/swg/tests/placeSky.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, extractOldSrc } from './airTrees.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** The commit this wave was built on: "today" for the day-one proof. */
const BASE = 'dd994e9';
/** The day-one trace's hash as dd994e9's weather made it, for a checkout git cannot answer (held to the live old code where it can). */
const BASE_TRACE = '171c35404933';
/** The same walk's hash with a falling effect's file failed to load (`failedFiles`), as dd994e9's weather made it. */
const BASE_TRACE_FAILED = 'da624d40d3b2';

const NEW = join(REPO, 'src');
let OLD: string | null = null;
try {
  OLD = extractOldSrc(BASE);
} catch {
  OLD = null;
}
process.on('exit', () => {
  if (OLD) rmSync(dirname(OLD), { recursive: true, force: true });
});
register(pathToFileURL(join(REPO, 'tools', 'swg', 'tests', 'airLoader.mjs')).href, import.meta.url, { data: { roots: OLD ? [OLD, NEW] : [NEW], packageBase: join(REPO, 'package.json') } });
type Mod = Record<string, unknown>;
const load = async (root: string, p: string): Promise<Mod> => (await import(pathToFileURL(join(root, p)).href)) as Mod;
const THREE = (await import('three')) as typeof import('three');
const Wm = await load(NEW, 'world/weather.ts');
const Wind = (await load(NEW, 'world/wind.ts')) as typeof import('../../../src/world/wind.ts');
const Places = (await load(NEW, 'world/places.ts')) as typeof import('../../../src/world/places.ts');
const LF = (await load(NEW, 'world/editFiles/locationsFile.ts')) as typeof import('../../../src/world/editFiles/locationsFile.ts');
const OldWm = OLD ? await load(OLD, 'world/weather.ts') : null;

// --- the stand-in sky: three families of five levels (the desert rains, Mos Eisley blows dust, the unnamed rows are clear) ---
type Block = { name: string; weatherIndex: number; windSpeedScale: number; cameraEffect: { file: string; kind: string; strength: number } | null };
const BLOCKS: Block[] = [];
const FAMILIES: [string, string | null, number][] = [
  ['desert', 'rain', 0],
  ['moseisley', 'dust', 5],
  ['', null, 10],
];
for (const [name, kind] of FAMILIES)
  for (let l = 0; l < 5; l++) BLOCKS.push({ name, weatherIndex: l, windSpeedScale: 2 + l, cameraEffect: kind && l > 0 ? { file: `fx_${kind}_${l}.prt`, kind, strength: 0.25 * l } : null });
const EFFECTS = { rain: ['fx_frain_a.prt', 'fx_frain_b.prt', 'fx_frain_c.prt'], dust: ['fx_fdust_a.prt', 'fx_fdust_b.prt', 'fx_fdust_c.prt'], snow: ['fx_fsnow_a.prt', 'fx_fsnow_b.prt'] };

/** The stand-in terrain: Mos Eisley's family west of x = -100, the desert's elsewhere. */
const swg = {
  environmentFamilies: new Map([
    [1, { name: 'desert' }],
    [2, { name: 'moseisley' }],
  ]),
  environmentAt: (x: number) => (x < -100 ? 2 : 1),
  environmentIfCached: (x: number) => (x < -100 ? 2 : 1),
};

type W = Record<string, unknown> & { update(dt: number, p: unknown, ctx: unknown): void; force(f: unknown): void; configure(s: unknown): void; setClimate(pack: string, w: number[] | null): void; state: Record<string, unknown>; describe(o?: unknown): Record<string, unknown>; places: unknown };

const SETTINGS = { weather: true, weatherDensity: 1, rainOpacity: 0.55, wetSurfaces: true, weatherShadows: true, weatherForce: -1, weatherKind: 0, lifeDay: 0 };

/** A weather of a module (today's or dd994e9's) on the stand-in sky, its textures loaded but Mos Eisley's (asked for, then ready). */
function weather(mod: Mod, held = 3): { w: W; x: Record<string, unknown>; asked: string[] } {
  const w = new (mod.Weather as new (p: unknown) => W)({ world: null });
  const x = w as unknown as Record<string, unknown>;
  const asked: string[] = [];
  const ready = new Set<Block>();
  x.sky = {
    lighting: { windSpeedScale: 4, shadowScale: 1 },
    data: { blocks: BLOCKS, weather: { effects: EFFECTS } },
    texturesReady: (b: Block) => b.name !== 'moseisley' || ready.has(b),
    ensureTextures: (b: Block) => {
      asked.push(`${b.name}:${b.weatherIndex}`);
      ready.add(b);
      return Promise.resolve();
    },
    setMix: () => undefined,
    setWind: () => undefined,
    setOvercast: () => undefined,
    sheetAloft: new Float64Array(3),
    sheetAloftOn: false,
    mixLength: 1,
    mixBlock: () => BLOCKS[0],
    mixWeights: new Float64Array([1, 0, 0, 0]),
  };
  x.terrain = { swg };
  x.reason = null;
  x.packId = 'tatooine';
  x.hasWeatherData = true;
  x.seed = 4242;
  x.weights = [50, 20, 15, 10, 5];
  x.levels = 5;
  const byName = x.rowsByName as Map<string, { name: string; byLevel: Int16Array }>;
  for (const [name, , at] of FAMILIES) byName.set(name, { name, byLevel: Int16Array.from([at, at + 1, at + 2, at + 3, at + 4]) });
  x.firstRows = byName.get('desert');
  x.current = byName.get('desert');
  w.configure({ ...SETTINGS, weatherForce: held });
  return { w, x, asked };
}

/** One frame's numbers: the family, its id, the mix, what falls and every channel wanted, with its weight. */
function frameOf(w: W, x: Record<string, unknown>): unknown[] {
  const s = w.state;
  const d = w.describe();
  const n = x.wantCount as number;
  return [s.family, s.familyId, s.kind, s.rain, s.snow, s.dust, s.level, (d.mix as string[]).join('|'), (x.current as { name: string } | null)?.name ?? null, (x.previous as { name: string } | null)?.name ?? null, x.fade, n, ...(x.wantFile as string[]).slice(0, n), ...Array.from((x.wantWeight as Float32Array).subarray(0, n))];
}

/** Two traces equal value for value by `Object.is`. */
function same(a: unknown[][], b: unknown[][]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].length !== b[i].length) return false;
    for (let k = 0; k < a[i].length; k++) if (!Object.is(a[i][k], b[i][k])) return false;
  }
  return true;
}

const realNow = Date.now;
let now = 1.79e12;
Date.now = () => now;
const realWarn = console.warn;
const P = new THREE.Vector3();
const CTX = { daylight: 0.8, groundAt: () => 0 };

/** A walk west from x = 300 to -300 and back, a frame a sixtieth, the frames' numbers of each weather. */
function walk(ws: { w: W; x: Record<string, unknown> }[], frames = 1440, hold = (_f: number) => undefined as void): unknown[][][] {
  const out: unknown[][][] = ws.map(() => []);
  for (let f = 0; f < frames; f++) {
    now += 1000 / 60;
    const t = f / frames;
    P.set(t < 0.5 ? 300 - 1200 * t : -300 + 1200 * (t - 0.5), 0, 20);
    hold(f);
    ws.forEach(({ w, x }, i) => {
      w.update(1 / 60, P, CTX);
      out[i].push(frameOf(w, x));
    });
  }
  return out;
}

const traceHash = (t: unknown[][]): string => createHash('sha1').update(JSON.stringify(t)).digest('hex').slice(0, 12);

try {
  // ---- 1. day one ----
  {
    const today = weather(Wm);
    const quiet = weather(Wm);
    // An index of a place that names no sky, and the world row with none: the places say nothing of the sky.
    const plain = LF.readLocationsFile(LF.locationsFileText('tatooine', 'raw', [{ id: 'yard', kind: 'zone', shape: { kind: 'circle', c: [200, 20], r: 80 } }, { id: 'world', kind: 'world', loading: ['x'] }] as never), 'tatooine', 'ground');
    const idx = new Places.PlaceIndex().build({ rows: plain.rows, centre: { x: 0, z: 0 } });
    ok(!idx.hasSky, 'an index whose places name no sky says it has none');
    quiet.w.places = { skyAt: (px: number, pz: number, out: unknown) => idx.skyAt(px, pz, out as InstanceType<typeof Places.PlaceSky>) };
    const sets = [today, quiet];
    const old = OldWm ? weather(OldWm) : null;
    if (old) sets.push(old);
    const traces = walk(sets);
    ok(traces[0].some((fr) => fr[0] === 'moseisley') && traces[0].some((fr) => fr[0] === 'desert') && traces[0].some((fr) => (fr[3] as number) > 0) && traces[0].some((fr) => (fr[5] as number) > 0), 'the walk crosses the boundary both ways, rain falling in the desert and dust in Mos Eisley');
    ok(same(traces[0], traces[1]), "an index whose places name no sky leaves every frame the weather with none would draw");
    const h = traceHash(traces[0]);
    if (old) {
      ok(same(traces[0], traces[2]), `with no places, every frame (family, id, mix, what falls, each channel's weight) is ${BASE}'s own weather's, by Object.is`);
      ok(traceHash(traces[2]) === BASE_TRACE, `the recorded hash is ${BASE}'s own trace's (so it cannot go stale unseen): ${traceHash(traces[2])}`);
    } else ok(h === BASE_TRACE, `git cannot answer: the trace held to ${BASE}'s recorded hash (${h})`);
  }
  {
    // Day one with a falling effect whose file failed to load (`failedFiles`, which the ninth wave's `want` now asks where
    // `collect`'s loop asked it): that file carries no weight and adds nothing to what falls, frame for frame as dd994e9's.
    const FAILED = ['fx_rain_3.prt', 'fx_dust_2.prt'];
    const failing = (mod: Mod) => {
      const s = weather(mod);
      for (const f of FAILED) (s.x.failedFiles as Set<string>).add(f);
      return s;
    };
    const sets = [failing(Wm)];
    if (OldWm) sets.push(failing(OldWm));
    const traces = walk(sets);
    const t0 = traces[0];
    const files = (fr: unknown[]) => fr.slice(12, 12 + (fr[11] as number)) as string[];
    ok(t0.every((fr) => !files(fr).some((f) => FAILED.includes(f))) && t0.some((fr) => files(fr).includes('fx_rain_2.prt')) && t0.some((fr) => files(fr).includes('fx_dust_3.prt')), 'a file that failed to load is never wanted, while the files beside it are');
    if (sets.length > 1) ok(same(t0, traces[1]), `with a failed file, every frame (what falls, each channel's weight) is ${BASE}'s own weather's, by Object.is`);
    const h = traceHash(t0);
    ok(h === BASE_TRACE_FAILED, `the failed-file trace's recorded hash (${BASE}'s, held whether or not git answers): ${h}`);
  }

  // ---- 2. a place's family ----
  const placeFile = (rows: unknown[]) => {
    const read = LF.readLocationsFile(LF.locationsFileText('tatooine', 'raw', rows as never), 'tatooine', 'ground');
    assert.ok(read.problem === null && read.skipped.length === 0, `the test's file reads (${read.problem ?? read.skipped.map((s) => s.why).join('; ')})`);
    return new Places.PlaceIndex().build({ rows: read.rows, centre: { x: 0, z: 0 } });
  };
  const adapter = (idx: InstanceType<typeof Places.PlaceIndex>) => ({ skyAt: (px: number, pz: number, out: unknown) => idx.skyAt(px, pz, out as InstanceType<typeof Places.PlaceSky>) });
  {
    // A cantina of ours at game (200, 20) (raw (-200, 20) about the origin) naming Mos Eisley's family in the desert.
    const idx = placeFile([{ id: 'cantina', kind: 'place', shape: { kind: 'circle', c: [-200, 20], r: 60 }, env: 'moseisley' }]);
    const a = weather(Wm);
    const b = weather(Wm);
    a.w.places = adapter(idx);
    const seen: { f: number; fam: unknown; fade: number; prev: unknown; level: unknown; sched: unknown; levelB: unknown; schedB: unknown }[] = [];
    // Unheld: the schedule's level, so both weathers walk the same clock.
    a.w.configure({ ...SETTINGS });
    b.w.configure({ ...SETTINGS });
    const cross = (from: number, to: number, frames: number): void => {
      for (let f = 0; f < frames; f++) {
        now += 1000 / 60;
        P.set(from + ((to - from) * (f + 1)) / frames, 0, 20);
        a.w.update(1 / 60, P, CTX);
        b.w.update(1 / 60, P, CTX);
        seen.push({ f: seen.length, fam: a.w.state.family, fade: a.x.fade as number, prev: (a.x.previous as { name: string } | null)?.name ?? null, level: a.w.state.level, sched: a.w.state.scheduled, levelB: b.w.state.level, schedB: b.w.state.scheduled });
      }
    };
    cross(0, 0, 60);
    ok(seen[seen.length - 1].fam === 'desert' && a.w.state.place === null, 'outside the place, the terrain\'s own family (the desert)');
    cross(0, 200, 60);
    // Stand in it for six seconds.
    cross(200, 200, 360);
    const inFrames = seen.filter((s) => s.fam === 'moseisley');
    ok(inFrames.length > 0 && a.w.state.place === 'cantina', "inside it, the family the place names, and the state names the place");
    const firstIn = seen.findIndex((s) => s.fam === 'moseisley');
    const twoSeconds = seen[firstIn + 120];
    ok(seen[firstIn].prev === 'desert' && Math.abs(twoSeconds.fade - (seen[firstIn].fade + 2 / 4)) < 1e-9, `the rows crossfaded from the desert's over the weather's own four seconds (half way two seconds in: ${twoSeconds.fade.toFixed(3)})`);
    ok(seen[seen.length - 1].prev === null && seen[seen.length - 1].fade === 1, 'and the crossfade done after four');
    ok(a.asked.some((s) => s.startsWith('moseisley:')) && !b.asked.length, "its family's textures asked for as it came in (a block still loading drawn at nothing until it is ready), as a boundary walked over asks them");
    ok(seen.every((s) => Object.is(s.level, s.levelB) && Object.is(s.sched, s.schedB)), 'the level the schedule\'s inside and out, the same as a weather with no places at every moment');
    cross(200, 0, 60);
    cross(0, 0, 300);
    ok(seen[seen.length - 1].fam === 'desert' && a.w.state.place === null, 'walked out, the terrain\'s own again');
    // The console's held family stands first.
    cross(0, 200, 60);
    a.w.force({ family: 'desert' });
    cross(200, 200, 60);
    ok(a.w.state.family === 'desert' && a.w.state.place === null, "the console's held family before a place's");
    a.w.force(null);
    cross(200, 200, 300);
    ok(a.w.state.family === 'moseisley', 'and the place\'s again once it is let go');
  }
  {
    // A family the sky lacks: warned of once, the table's fallback (its unnamed rows) drawn.
    const idx = placeFile([{ id: 'odd', kind: 'place', shape: { kind: 'circle', c: [-200, 20], r: 60 }, env: 'nosuchfamily' }]);
    const a = weather(Wm);
    a.w.places = adapter(idx);
    const warned: string[] = [];
    console.warn = (...args: unknown[]) => void warned.push(args.join(' '));
    for (let f = 0; f < 600; f++) {
      now += 1000 / 60;
      P.set(200, 0, 20);
      a.w.update(1 / 60, P, CTX);
    }
    console.warn = realWarn;
    ok(warned.filter((s) => s.includes('nosuchfamily')).length === 1, 'a family the sky lacks is warned of once, in the table\'s own words');
    ok((a.x.current as { name: string }).name === '' && a.w.state.family === 'nosuchfamily', "and the table's own fallback (its unnamed rows) drawn under the place's name");
  }

  // ---- 3. a place's weather kind ----
  {
    // A shelter of ours forcing snow over the desert's rows, at the held level 3 (forced snow's second effect, strength 1).
    const idx = placeFile([{ id: 'shelter', kind: 'place', shape: { kind: 'circle', c: [-200, 20], r: 60 }, weather: 'snow' }]);
    const a = weather(Wm, 3);
    a.w.places = adapter(idx);
    // Standing at the held level from the start (a hold eases in over a few seconds).
    a.x.level = 3;
    const frames: { fade: number; prev: string | null; kind: unknown; want: Record<string, number> }[] = [];
    for (let f = 0; f < 900; f++) {
      now += 1000 / 60;
      // Walked in (a step over 64 m in a frame is a teleport, which snaps).
      P.set(f < 60 ? 0 : f < 120 ? ((f - 60) * 200) / 60 : 200, 0, 20);
      a.w.update(1 / 60, P, CTX);
      const n = a.x.wantCount as number;
      const want: Record<string, number> = {};
      for (let i = 0; i < n; i++) want[(a.x.wantFile as string[])[i]] = (a.x.wantWeight as Float32Array)[i];
      frames.push({ fade: a.x.fade as number, prev: (a.x.previous as { kind?: string | null } | null) ? String((a.x.previous as { kind?: string | null }).kind ?? 'none') : null, kind: a.w.state.kind, want });
    }
    const before = frames[50];
    ok(before.want['fx_rain_3.prt'] === 1 && Object.keys(before.want).length === 1, 'outside it, the desert\'s own rain at the level');
    const mid = frames.find((fr) => fr.prev === 'none' && fr.fade > 0.4 && fr.fade < 0.6)!;
    ok(!!mid && Math.abs(mid.want['fx_rain_3.prt'] - (1 - mid.fade)) < 1e-6 && Math.abs(mid.want['fx_fsnow_b.prt'] - mid.fade) < 1e-6, `crossing in, the desert's rain at the fade's rest and the place's snow at its share (fade ${mid?.fade.toFixed(3)}: rain ${mid?.want['fx_rain_3.prt']?.toFixed(3)}, snow ${mid?.want['fx_fsnow_b.prt']?.toFixed(3)})`);
    const after = frames[frames.length - 1];
    ok(after.want['fx_fsnow_b.prt'] === 1 && Object.keys(after.want).length === 1 && after.kind === 'snow' && a.w.state.placeKind === 'snow' && a.w.state.placeWeather === 'shelter', 'inside, the place\'s snow alone at the world\'s level, and the state names the place and its kind');
    ok((a.x.current as { name: string; byLevel: Int16Array }).name === 'desert' && (a.x.current as { byLevel: Int16Array }).byLevel === (a.x.rowsByName as Map<string, { byLevel: Int16Array }>).get('desert')!.byLevel, "the rows drawn are the desert's own blocks (the sky draws the same), a copy carrying the kind");
    a.w.force({ kind: 'dust' });
    now += 1000 / 60;
    a.w.update(1 / 60, P, CTX);
    ok(a.w.state.kind === 'dust' && (a.x.wantFile as string[])[0] === 'fx_fdust_c.prt', "the console's forced kind before a place's");
    a.w.force(null);
    // The wet replay's view of the past reads the kind the rows carry: snow fell here, not the desert's rain.
    const fall = (a.x as unknown as { fallingAt(level: number, kind: 'rain' | 'snow'): number }).fallingAt.bind(a.x);
    ok(fall(3, 'snow') === 1 && fall(3, 'rain') === 0, "the replay of what fell reads the place's kind over the rows (snow 1, rain 0 at level 3)");
  }
  {
    // The halves with a failed file (`want`'s own check, on the path `collect`'s old loop never took): crossing into the
    // shelter's snow whose file failed to load, the desert's rain at the fade's rest and no snow at all; inside, nothing falls.
    const idx = placeFile([{ id: 'shelter', kind: 'place', shape: { kind: 'circle', c: [-200, 20], r: 60 }, weather: 'snow' }]);
    const a = weather(Wm, 3);
    a.w.places = adapter(idx);
    (a.x.failedFiles as Set<string>).add('fx_fsnow_b.prt');
    a.x.level = 3;
    let mid: { fade: number; rain: number; snow: number; files: string[] } | null = null;
    for (let f = 0; f < 900; f++) {
      now += 1000 / 60;
      P.set(f < 60 ? 0 : f < 120 ? ((f - 60) * 200) / 60 : 200, 0, 20);
      a.w.update(1 / 60, P, CTX);
      const fade = a.x.fade as number;
      if (!mid && a.x.previous && fade > 0.4 && fade < 0.6) mid = { fade, rain: a.w.state.rain as number, snow: a.w.state.snow as number, files: (a.x.wantFile as string[]).slice(0, a.x.wantCount as number) };
    }
    ok(!!mid && mid.files.length === 1 && mid.files[0] === 'fx_rain_3.prt' && mid.snow === 0 && mid.rain > 0, `crossing in under a kind whose file failed, only the desert's rain is wanted (${mid?.files.join(', ')}) and no snow falls`);
    ok((a.x.wantCount as number) === 0 && a.w.state.snow === 0 && a.w.state.rain === 0, 'and inside nothing falls');
  }
  {
    // A place naming a family and a kind: that family's rows, carrying the kind.
    const idx = placeFile([{ id: 'yard', kind: 'place', shape: { kind: 'circle', c: [-200, 20], r: 60 }, env: 'moseisley', weather: 'snow' }]);
    const a = weather(Wm, 3);
    a.w.places = adapter(idx);
    a.x.level = 3;
    for (let f = 0; f < 600; f++) {
      now += 1000 / 60;
      P.set(f < 60 ? 0 : f < 120 ? ((f - 60) * 200) / 60 : 200, 0, 20);
      a.w.update(1 / 60, P, CTX);
    }
    const cur = a.x.current as { name: string; kind?: string | null };
    ok(cur.name === 'moseisley' && cur.kind === 'snow' && a.w.state.kind === 'snow' && (a.x.wantFile as string[])[0] === 'fx_fsnow_b.prt', "a place naming a family and a kind: Mos Eisley's rows carrying snow, and snow falls");
  }
  {
    // Leaving a place for terrain whose family id is the one the weather held before the place: the terrain's own again (a
    // place's family is held under an id no terrain gives, so the terrain's answer is looked up afresh).
    const idx = placeFile([{ id: 'cantina', kind: 'place', shape: { kind: 'circle', c: [-200, 20], r: 60 }, env: 'moseisley' }]);
    const a = weather(Wm);
    a.x.terrain = { swg: { environmentFamilies: new Map([[0, { name: 'desert' }]]), environmentAt: () => 0, environmentIfCached: () => 0 } };
    a.w.places = adapter(idx);
    const fams: unknown[] = [];
    for (let f = 0; f < 1200; f++) {
      now += 1000 / 60;
      P.set(f < 60 ? 0 : f < 120 ? ((f - 60) * 200) / 60 : f < 600 ? 200 : f < 660 ? 200 - ((f - 600) * 200) / 60 : 0, 0, 20);
      a.w.update(1 / 60, P, CTX);
      fams.push(a.w.state.family);
    }
    ok(fams[590] === 'moseisley' && fams[fams.length - 1] === 'desert' && a.w.state.familyId === 0, "walked out onto terrain of family id nought, the terrain's own family again");
  }
  {
    // The places moved behind a loading screen (`placesMoved(true)`): switched outright; in play (`false`): crossfaded.
    const idx = placeFile([{ id: 'cantina', kind: 'place', shape: { kind: 'circle', c: [-200, 20], r: 60 }, env: 'moseisley' }]);
    const run = (snap: boolean): { fades: number[]; fam: unknown } => {
      const a = weather(Wm);
      P.set(200, 0, 20);
      for (let f = 0; f < 60; f++) {
        now += 1000 / 60;
        a.w.update(1 / 60, P, CTX);
      }
      a.w.places = adapter(idx);
      (a.w as unknown as { placesMoved(snap: boolean): void }).placesMoved(snap);
      const fades: number[] = [];
      for (let f = 0; f < 120; f++) {
        now += 1000 / 60;
        a.w.update(1 / 60, P, CTX);
        if (a.x.previous) fades.push(a.x.fade as number);
      }
      return { fades, fam: a.w.state.family };
    };
    const snapped = run(true);
    const faded = run(false);
    ok(snapped.fam === 'moseisley' && snapped.fades.length === 0 && faded.fam === 'moseisley' && faded.fades.length > 0, `a place file landed behind a loading screen switches the rows outright, in play crossfades them (${faded.fades.length} frames of fade)`);
  }
  {
    // A half's blocks are `mixBlocks`' own for that family alone: the rule written out in `halfOf` held to the schedule's at
    // levels between rows, past the last, at nought and below, and over rows with gaps (a level with no row of its own).
    const Sched = (await load(NEW, 'world/weatherSchedule.ts')) as typeof import('../../../src/world/weatherSchedule.ts');
    const a = weather(Wm);
    const out = Sched.createMixOut();
    const sets = [Int16Array.from([0, 1, 2, 3, 4]), Int16Array.from([-1, 1, -1, 3, -1]), Int16Array.from([2, 2, 2, 2, 2]), Int16Array.from([-1, -1, -1, -1, -1])];
    let same = 0;
    let tried = 0;
    let bad = '';
    for (const byLevel of sets) {
      const rows = { name: 'desert', byLevel };
      for (const level of [0, 0.25, 1, 1.5, 2.7, 3.999, 4, 4.5, 7.2, -1]) {
        a.x.level = level;
        const n = (a.x as unknown as { halfOf(r: unknown): number }).halfOf(rows);
        const m = a.x.halfMix as { index: Int16Array; weight: Float32Array };
        const k = Sched.mixBlocks(out, rows, null, 1, level);
        tried++;
        let alike = n === k;
        for (let i = 0; alike && i < n; i++) alike = m.index[i] === out.index[i] && m.weight[i] === out.weight[i];
        if (alike) same++;
        else if (!bad) bad = `${byLevel.join()} at ${level}: ${n} against ${k}`;
      }
    }
    ok(same === tried, `a half's blocks are mixBlocks' own for one family, to the bit (${same} of ${tried}${bad ? `; ${bad}` : ''})`);
  }

  // ---- 4. a world's own climate ----
  {
    const a = weather(Wm);
    const weights = a.x.weights as number[];
    Wind.attachWind('tatooine', 'tatooine', 4242, weights, 5, BLOCKS as never);
    Wind.stepWindAloft();
    ok(Wind.windPattern() !== null, "the wind's pattern made for the world attached");
    a.w.setClimate('naboo', [1, 1, 1, 1, 1]);
    ok(weights.join() === '50,20,15,10,5' && Wind.windPattern() !== null, "another pack's climate moves nothing of the world attached");
    a.w.setClimate('tatooine', [9, 1]);
    ok(a.x.weights === weights && weights.join() === '9,1,1,1,1', "the world's own climate written into the schedule's weights in place, padded with its last weight (the wind's are the same array)");
    ok(Wind.windPattern() === null, "and the wind's pattern made again at its next step (its memo of levels was the old climate's)");
    a.w.setClimate('tatooine', null);
    const Sched = (await load(NEW, 'world/weatherSchedule.ts')) as typeof import('../../../src/world/weatherSchedule.ts');
    ok(weights.join() === Sched.climateFor('tatooine', 5).join() && Sched.CLIMATES.tatooine.join() === weights.join(), "let go, the table's own again (Tatooine's)");
    Wind.detachWind();
  }

  // ---- 5. the index ----
  {
    const idx = placeFile([
      { id: 'world', kind: 'world', env: 'desert', grade: { warmth: 0.1 } },
      { id: 'town', kind: 'city', shape: { kind: 'circle', c: [0, 0], r: 300 }, env: 'moseisley', weather: 'rain', grade: { gloom: 0.2 } },
      { id: 'square', kind: 'landmark', shape: { kind: 'circle', c: [0, 0], r: 30 } },
      { id: 'shrine', kind: 'place', shape: { kind: 'rect', min: [100, -10], max: [120, 10] }, grade: { heat: 0.5 } },
    ]);
    const sky = new Places.PlaceSky();
    idx.skyAt(0, 0, sky);
    ok(sky.env === 'moseisley' && sky.envFrom === 'town' && sky.weather === 'rain' && sky.grade?.gloom === 0.2, "in a landmark naming no sky inside a town naming one, the town's (a smaller place naming none leaves the larger's)");
    idx.skyAt(-110, 0, sky);
    ok(sky.env === 'moseisley' && sky.grade?.heat === 0.5 && sky.gradeFrom === 'shrine', 'in a smaller place naming a grade, its grade and the town\'s family (each field the smallest place naming it)');
    idx.skyAt(1000, 1000, sky);
    ok(sky.env === 'desert' && sky.envFrom === 'world' && sky.weather === null && sky.grade?.warmth === 0.1, "in no place, the world row's (under every place's), and no weather where it names none");
    // Each field the smallest place naming it, whichever of the two the file lists first.
    const shrine = { id: 'shrine', kind: 'place', shape: { kind: 'rect', min: [100, -10], max: [120, 10] }, env: 'desert', weather: 'snow', grade: { heat: 0.5 } };
    const town = { id: 'town', kind: 'city', shape: { kind: 'circle', c: [0, 0], r: 300 }, env: 'moseisley', weather: 'rain', grade: { gloom: 0.2 } };
    const orders = [[town, shrine], [shrine, town]].map((rows) => new Places.PlaceIndex().build({ rows: rows as never, centre: { x: 0, z: 0 } }).skyAt(-110, 0, new Places.PlaceSky()));
    ok(orders.every((s) => s.envFrom === 'shrine' && s.weatherFrom === 'shrine' && s.gradeFrom === 'shrine' && s.weather === 'snow' && s.grade?.heat === 0.5), "the smallest place naming a field answers it whichever is listed first (the larger town listed before the shrine in it, and after)");
    idx.ask.r = 500;
    idx.skyAt(1000, 1000, sky);
    ok(sky.envFrom === 'world' && sky.gradeFrom === 'world', "asked at the point itself whatever reach a no-build ask left in the kept ask (500 m would reach the town)");
    const worldOnly = placeFile([{ id: 'world', kind: 'world', grade: { warmth: 0.1 } }]);
    ok(worldOnly.hasSky && worldOnly.skyAt(5, 5, sky).grade?.warmth === 0.1, "an index whose world row alone names a sky field says it has one");
    const none = new Places.PlaceIndex().build({ rows: [], centre: { x: 0, z: 0 } });
    none.skyAt(0, 0, sky);
    ok(sky.env === null && sky.weather === null && sky.grade === null && !none.hasSky, 'an index of no rows says nothing of the sky');
  }
  {
    // A world loaded with no arrival (the creator's captured place, `showScene`): the game's index is built from the places
    // file only while it is the world loaded now's (`placesFileFor`, as `App.placesNow` asks the keeper), so the last world's
    // world row and places say nothing of the backdrop's sky, the weather's family and kind or its grade.
    const read = LF.readLocationsFile(LF.locationsFileText('monument', 'raw', [{ id: 'world', kind: 'world', env: 'moseisley', grade: { gloom: 0.4 } }, { id: 'yard', kind: 'place', shape: { kind: 'circle', c: [-200, 20], r: 60 }, weather: 'snow' }] as never), 'monument', 'ground');
    const file = { locations: read.rows, pois: [], noBuild: [] };
    ok(Places.placesFileFor(file, 'monument', 'monument') === file && Places.placesFileFor(file, 'monument', 'tatooine') === null && Places.placesFileFor(null, 'tatooine', 'tatooine') === null, "the file is the world loaded now's only while it was read for that world");
    const keeper = new Places.PlaceIndexKeeper();
    const yes = () => true;
    const sky = new Places.PlaceSky();
    const played = keeper.now(Places.placesFileFor(file, 'monument', 'monument'), { x: 0, z: 0 }, 1, false, yes);
    played.skyAt(200, 20, sky);
    ok(played.hasSky && sky.env === 'moseisley' && sky.weather === 'snow' && sky.grade?.gloom === 0.4, 'on the world it was read for, its world row and places name the sky');
    const backdrop = keeper.now(Places.placesFileFor(file, 'monument', 'tatooine'), { x: 0, z: 0 }, 1, false, yes);
    backdrop.skyAt(200, 20, sky);
    ok(!backdrop.hasSky && sky.env === null && sky.weather === null && sky.grade === null, "on another world loaded with no arrival, the last world's rows say nothing (no family, kind or grade)");
    // The weather handed the index as the game hands it: the backdrop's own terrain family, nothing forced over it.
    const a = weather(Wm);
    a.w.places = { skyAt: (px: number, pz: number, out: unknown) => keeper.now(Places.placesFileFor(file, 'monument', 'tatooine'), { x: 0, z: 0 }, 1, false, yes).skyAt(px, pz, out as InstanceType<typeof Places.PlaceSky>) };
    for (let f = 0; f < 120; f++) {
      now += 1000 / 60;
      P.set(200, 0, 20);
      a.w.update(1 / 60, P, CTX);
    }
    ok(a.w.state.family === 'desert' && a.w.state.place === null && a.w.state.placeWeather === null && (a.x.current as { kind?: string | null }).kind == null, "and the weather draws the terrain's own family there, with no place's kind over it");
  }
} finally {
  Date.now = realNow;
  console.warn = realWarn;
}

console.log(`placeSky: ${checks} checks passed`);
