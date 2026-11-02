// The sky per place's frame, measured for what it makes (Map-maker II's ninth wave, DESIGN.md §2.0 rule 7), in a node
// process of its own:
//
//   - the grade's ask of the places' index as the game asks it every frame (`hasSky`, the index's kept ask, `skyAsked`)
//     over a hundred places and the world row, and the grade's ease of the look it answers (`PlaceGradeEase.step`, its
//     inputs written as the pass writes them), the eye wandering inside one place (`steady`) and then in no place, under the
//     world row's look (`world`);
//   - what the eye crossing from place to place costs (`perChange`: the ease's goal worked out again as a place's look
//     changes, measured apart, as a grab is);
//   - what falls while a place's weather kind rides the rows, half way through its crossfade (the real weather's `collect`,
//     loaded under the off-proof's hook, each half through `effectFor` with its own kind: `collectHalves`), against the same
//     call on plain rows (`collectPlain`). The weather's own frame (its clock, its wind, its wetness) is not this wave's and
//     is not measured here.
//
// The young generation is read with no collection in the window, the cleanest of three windows kept.
//
// Run: node --expose-gc --allow-natives-syntax tools/swg/tests/placeSkyAlloc.ts [profile [grade]]
// Prints one JSON line: { frames, steady, steadyScavenges, world, worldScavenges, perChange, changes, halves, halvesScavenges,
// plain, plainScavenges, halvesSeen, eased }.
import v8 from 'node:v8';
import { register } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import { REPO } from './airTrees.ts';

const NEW = join(REPO, 'src');
register(pathToFileURL(join(REPO, 'tools', 'swg', 'tests', 'airLoader.mjs')).href, import.meta.url, { data: { roots: [NEW], packageBase: join(REPO, 'package.json') } });
type Mod = Record<string, unknown>;
const load = async (p: string): Promise<Mod> => (await import(pathToFileURL(join(NEW, p)).href)) as Mod;
const Places = (await load('world/places.ts')) as typeof import('../../../src/world/places.ts');
const GM = (await load('core/fx/gradeMath.ts')) as typeof import('../../../src/core/fx/gradeMath.ts');
const Wm = await load('world/weather.ts');

let scavenges = 0;
const watch = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
});
watch.observe({ entryTypes: ['gc'] });
const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => {
  await tick();
  await tick();
};

// --- the places: a hundred circles (a third naming a grade, a third a family, a third a weather kind), one wide town naming
// a grade, and the world row naming its own ---
type Row = import('../../../src/world/editFiles/locationsFile.ts').LocationRow;
const rows: Row[] = [
  { id: 'world', kind: 'world', env: 'desert', grade: { warmth: 0.2 } },
  { id: 'town', kind: 'city', shape: { kind: 'circle', c: [0, 3000], r: 400 }, grade: { gloom: 0.3, saturation: -0.05 } },
];
for (let i = 0; i < 100; i++) {
  const r: Row = { id: `p${i}`, kind: 'place', shape: { kind: 'circle', c: [-(i * 40 - 2000), (i % 5) * 30], r: 25 } };
  if (i % 3 === 0) r.grade = { gloom: 0.1 * (i % 7), saturation: -0.05 };
  else if (i % 3 === 1) r.env = 'moseisley';
  else r.weather = 'snow';
  rows.push(r);
}
const index = new Places.PlaceIndex().build({ rows, centre: { x: 0, z: 0 } });
const sky = new Places.PlaceSky();
const ease = new GM.PlaceGradeEase();
const planet = GM.GRADE_LOOKS.tatooine;
/** The kept numbers of the loops: [frame, where the eye wanders (0 the town, 1 no place, 2 across the row), looks eased, changes]. */
const st = new Float64Array(8);
const eye = new Float64Array(2);
let lastLook: unknown = null;

/** One frame of the grade's ask and ease, as `App.placeGradeNow` and `ColorGradePass.prepare` make them. */
function gradeFrame(): void {
  st[0] += 1;
  const t = st[0] * 0.01;
  const where = st[1];
  if (where === 0) {
    eye[0] = Math.sin(t) * 200;
    eye[1] = 3000 + Math.cos(t) * 200;
  } else if (where === 1) {
    eye[0] = 5000 + Math.sin(t) * 200;
    eye[1] = -3000 + Math.cos(t) * 200;
  } else {
    eye[0] = -2000 + ((st[0] * 0.37) % 4000);
    eye[1] = 0;
  }
  let place: Row['grade'] | null = null;
  if (index.hasSky) {
    const q = index.ask;
    q.x = eye[0];
    q.z = eye[1];
    place = index.skyAsked(sky).grade;
  }
  if (place !== lastLook) {
    lastLook = place;
    st[3] += 1;
  }
  ease.dt = 1 / 60;
  ease.tau = 2;
  ease.cut = false;
  if (ease.step(planet, place) !== planet) st[2] += 1;
}
const gradeFrames = (n: number): void => {
  for (let i = 0; i < n; i++) gradeFrame();
};

// --- the weather's `collect`, half way through a crossfade into a place forcing snow over the desert's rain ---
const BLOCKS: { name: string; weatherIndex: number; windSpeedScale: number; cameraEffect: { file: string; kind: string; strength: number } | null }[] = [];
for (let l = 0; l < 5; l++) BLOCKS.push({ name: 'desert', weatherIndex: l, windSpeedScale: 2 + l, cameraEffect: l > 0 ? { file: `fx_rain_${l}.prt`, kind: 'rain', strength: 0.25 * l } : null });
const EFFECTS = { rain: ['fx_frain_a.prt', 'fx_frain_b.prt', 'fx_frain_c.prt'], dust: ['fx_fdust_a.prt', 'fx_fdust_b.prt', 'fx_fdust_c.prt'], snow: ['fx_fsnow_a.prt', 'fx_fsnow_b.prt'] };
type W = Record<string, unknown> & { configure(s: unknown): void };
const w = new (Wm.Weather as new (p: unknown) => W)({ world: null });
const x = w as unknown as Record<string, unknown> & { collect(active: boolean): void; applyMix(): void };
x.sky = { lighting: { windSpeedScale: 4, shadowScale: 1 }, data: { blocks: BLOCKS, weather: { effects: EFFECTS } }, texturesReady: () => true, ensureTextures: () => Promise.resolve(), setMix: () => undefined };
x.reason = null;
x.hasWeatherData = true;
x.levels = 5;
w.configure({ weather: true, weatherDensity: 1, rainOpacity: 0.55, wetSurfaces: true, weatherShadows: true, weatherForce: 3, weatherKind: 0, lifeDay: 0 });
const desert = { name: 'desert', byLevel: Int16Array.from([0, 1, 2, 3, 4]) };
const snowed = { name: 'desert', byLevel: desert.byLevel, kind: 'snow' };
const fall = new Float64Array(2);
/**
 * One frame's `collect`, half way through the crossfade at a level between two rows. The fade and the level are the
 * weather's own fields, written once before a window (a write of the harness's into them is the weather's own frame's cost,
 * which is not measured here), and the mix the plain path reads made once.
 */
function collectFrame(): void {
  fall[0] += 1;
  x.collect(true);
  const cur = x.current as { kind?: string | null };
  if (cur.kind) fall[1] += 1;
}
x.fade = 0.45;
x.level = 2.5;
const collectFrames = (n: number): void => {
  for (let i = 0; i < n; i++) collectFrame();
};
for (const f of [gradeFrames, collectFrames]) {
  try {
    new Function('f', '%NeverOptimizeFunction(f)')(f);
  } catch {
    // Without the flag the loop is left to the compiler.
  }
}

if (process.argv.includes('profile')) {
  // Where a frame makes anything, by the sampling heap profiler: `... placeSkyAlloc.ts profile [grade]`.
  const grade = process.argv.includes('grade');
  if (!grade) {
    x.current = snowed;
    x.previous = desert;
  }
  const run = grade ? gradeFrames : collectFrames;
  run(60_000);
  const { Session } = await import('node:inspector/promises');
  const session = new Session();
  session.connect();
  await session.post('HeapProfiler.startSampling', { samplingInterval: 32, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  run(20_000);
  interface SampleNode {
    callFrame: { functionName: string; url: string; lineNumber: number };
    selfSize: number;
    children: SampleNode[];
  }
  const { profile } = (await session.post('HeapProfiler.stopSampling')) as unknown as { profile: { head: SampleNode } };
  const sites = new Map<string, number>();
  const walk = (n: SampleNode, path: string) => {
    const here = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
    if (n.selfSize > 0) sites.set(`${here}  <-  ${path}`, (sites.get(`${here}  <-  ${path}`) ?? 0) + n.selfSize);
    for (const c of n.children) walk(c, here);
  };
  walk(profile.head, '');
  for (const [key, n] of [...sites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`${(n / 20_000).toFixed(2)} B/frame  ${key}`);
  process.exit(0);
}

const FRAMES = 200_000;
async function measure(run: (n: number) => void, frames: number): Promise<{ made: number; scavenges: number }> {
  run(40_000);
  let best = { made: Infinity, scavenges: Infinity };
  for (let attempt = 0; attempt < 3; attempt++) {
    run(10_000);
    gc!({ type: 'minor' } as never);
    await settle();
    scavenges = 0;
    const before = young();
    run(frames);
    const made = young() - before;
    await settle();
    if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges };
    if (best.scavenges === 0 && best.made <= 0) break;
  }
  return best;
}
// Inside one place, then in no place under the world row's look.
st[1] = 0;
const steady = await measure(gradeFrames, FRAMES);
st[1] = 1;
const world = await measure(gradeFrames, FRAMES);
// Across the row of places: what each change of the look costs, measured apart, the cleanest of three windows kept (its own
// collections read after its settle, before any later window resets the count: a window a collection lands in measures
// nothing by the young generation's size).
st[1] = 2;
gradeFrames(40_000);
let crossMade = 0;
let changes = 0;
let crossScavenges = Infinity;
for (let attempt = 0; attempt < 3; attempt++) {
  gradeFrames(10_000);
  gc!({ type: 'minor' } as never);
  await settle();
  scavenges = 0;
  const changesBefore = st[3];
  const madeBefore = young();
  gradeFrames(FRAMES);
  const made = young() - madeBefore;
  const changed = st[3] - changesBefore;
  await settle();
  const seen = scavenges;
  if (seen < crossScavenges || (seen === crossScavenges && changed > 0 && made / changed < crossMade / Math.max(1, changes))) {
    crossScavenges = seen;
    crossMade = made;
    changes = changed;
  }
  if (crossScavenges === 0) break;
}
// The weather's fall: half way through a place's kind's crossfade, and on plain rows.
x.current = snowed;
x.previous = desert;
const halves = await measure(collectFrames, FRAMES);
const halvesSeen = fall[1];
const wantsHalves = (x.wantCount as number) >= 2;
x.current = desert;
x.previous = null;
x.applyMix();
const plain = await measure(collectFrames, FRAMES);
watch.disconnect();
console.log(JSON.stringify({ frames: FRAMES, steady: steady.made, steadyScavenges: steady.scavenges, world: world.made, worldScavenges: world.scavenges, perChange: changes ? Math.round(Math.max(0, crossMade) / changes) : 0, changes, crossScavenges, halves: halves.made, halvesScavenges: halves.scavenges, plain: plain.made, plainScavenges: plain.scavenges, halvesSeen, wantsHalves, eased: st[2] }));
process.exit(0);
