// A world's own climate, fog, wind and clouds (Map-maker II's ninth wave, DESIGN.md §2.11 and §12): the locations file's
// world row read where it sets each, the code's tables by identity otherwise. Held here, each through the game's own code
// (the wind and the clouds' feed loaded under the off-proof's hook beside dd994e9's own, the rest plain):
//
//   1. the climate: with none of its own, `climateFor` is dd994e9's to the bit over every world and level count; with one,
//      the world's weights padded and cut as the table's are, and the schedule walks by them;
//   2. the fog: with no row, the table's own look (by identity) and every day's draw dd994e9's; Monument, which the table
//      never fogs, fogs on the days its own row's chance draws, as thick as its row allows, and the morning's fog stands;
//      the world's kept day (`FogDays`) draws from a row landing after the day was drawn on that same day;
//   3. the wind: with no row, every number of the unified wind's step and its pack dd994e9's, frame for frame; Monument with
//      a row blows by its multipliers (each one it sets, the table's for the rest), another pack's row reaching nothing, and
//      a table dial moved under the row reaching what the row does not set;
//   4. the clouds' feed: with no row, every uniform it writes and every deck's cover dd994e9's own feed's, frame for frame,
//      by `Object.is`; with a row, each multiplier laid on its deck's own number, the calibration asked by the numbers drawn,
//      and asked again in the arrival's own order (none first, the row landing after, each multiplier alone, let go again);
//      the game's kept record of the row's clouds and the frame's hand-over to the feed;
//   5. the world row read (`worldRowOf`), and the game's hand-overs (the row to its readers, the feed's input, the fog's
//      read), as text.
//
// Run: node tools/swg/tests/placeWorldRow.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
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

const BASE = 'dd994e9';
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
const text = (p: string): string => readFileSync(join(NEW, p), 'utf8').replace(/\r\n/g, '\n');
const S = (await load(NEW, 'world/weatherSchedule.ts')) as typeof import('../../../src/world/weatherSchedule.ts');
const Fog = (await load(NEW, 'world/volumetrics/airFog.ts')) as typeof import('../../../src/world/volumetrics/airFog.ts');
const Tune = (await load(NEW, 'world/volumetrics/airTune.ts')) as typeof import('../../../src/world/volumetrics/airTune.ts');
const Wind = (await load(NEW, 'world/wind.ts')) as typeof import('../../../src/world/wind.ts');
const Feed = (await load(NEW, 'world/volumetrics/airCloudsFeed.ts')) as typeof import('../../../src/world/volumetrics/airCloudsFeed.ts');
const Vol = (await load(NEW, 'world/volumetrics/volSettings.ts')) as typeof import('../../../src/world/volumetrics/volSettings.ts');
const old = OLD
  ? {
      S: (await load(OLD, 'world/weatherSchedule.ts')) as typeof S,
      Fog: (await load(OLD, 'world/volumetrics/airFog.ts')) as typeof Fog,
      Wind: (await load(OLD, 'world/wind.ts')) as typeof Wind,
      Feed: (await load(OLD, 'world/volumetrics/airCloudsFeed.ts')) as typeof Feed,
      Vol: (await load(OLD, 'world/volumetrics/volSettings.ts')) as typeof Vol,
    }
  : null;
const WORLDS = ['tatooine', 'naboo', 'corellia', 'kashyyyk_main', 'kashyyyk_hunting', 'mustafar', 'monument', 'helensar', 'space_tatooine', 'dungeon1', 'nosuch'];

/** Two traces equal value for value by `Object.is`. */
const sameTrace = (a: number[][], b: number[][]): boolean => a.length === b.length && a.every((r, i) => r.length === b[i].length && r.every((v, k) => Object.is(v, b[i][k])));
const hashOf = (t: number[][]): string => createHash('sha1').update(JSON.stringify(t)).digest('hex').slice(0, 12);
/**
 * A day-one comparison: today's trace held to dd994e9's own where git answers (and the recorded hash to that trace, so it
 * cannot go stale unseen), else to the hash recorded from it.
 */
function dayOne(what: string, today: number[][], before: number[][] | null, recorded: string): void {
  if (before) {
    ok(sameTrace(today, before), `${what} ${BASE}'s, value for value by Object.is`);
    ok(hashOf(before) === recorded, `${what}: the recorded hash is ${BASE}'s own trace's (${hashOf(before)})`);
  } else ok(hashOf(today) === recorded, `${what}: git cannot answer, held to ${BASE}'s recorded hash (${hashOf(today)})`);
}
const RECORDED = { climate: '7ac935746f4b', fog: '3421e618558a', wind: 'ac04f8613719', feed: 'ca9fb534b326' };

// ---- 1. the climate ----
{
  const climates = (F: typeof S, given: boolean): number[][] => {
    const out: number[][] = [];
    for (const w of WORLDS) for (let l = 1; l <= 6; l++) out.push(given ? F.climateFor(w, l, null) : F.climateFor(w, l));
    return out;
  };
  const today = climates(S, false);
  ok(sameTrace(today, climates(S, true)), 'with no climate of its own given (null) the weights are those with none');
  dayOne("with no climate of its own, every world's weights at every level count are", today, old ? climates(old.S, false) : null, RECORDED.climate);
  ok(S.climateFor('monument', 5, [9, 3]).join() === '9,3,3,3,3' && S.climateFor('mustafar', 3, [5, 4, 3, 2, 1]).join() === '5,4,3' && S.climateFor('tatooine', 5, []).join() === S.CLIMATES.tatooine.join(), "a world's own climate padded with its last weight and cut to the world's levels, an empty one the table's");
  const seed = S.seedOf('monument');
  let differ = 0;
  for (let k = 0; k < 400; k++) {
    const t = k * S.STEP_SECONDS * 3;
    if (S.scheduledLevel(seed, S.climateFor('monument', 5, [0, 0, 0, 0, 1]), t).level !== 4) differ++;
  }
  ok(differ === 0, 'and the schedule walks by it (a climate of the heaviest level alone holds there)');
}

// ---- 2. the fog ----
{
  const own = Fog.worldFogOf('monument', { morning: 0.6, evening: 0.3, morningLo: 0.5, morningHi: 0.9, eveningLo: 0.1, eveningHi: 0.3, top: 7 })!;
  ok(Fog.fogLookIn('naboo', null) === Tune.GROUND_FOG_LOOKS.naboo && Fog.fogLookIn('naboo', own) === Tune.GROUND_FOG_LOOKS.naboo && Fog.fogLookIn('monument', null) === undefined && Fog.fogLooksIn('naboo', own) === undefined, "with no row of its own (or another world's), the table's own look by identity, and the table the day is drawn from");
  const draws = (F: typeof Fog, viaOwn: boolean): number[][] => {
    const a = { morning: 0, evening: 0, eveningBefore: 0 };
    const out: number[][] = [];
    for (const w of WORLDS) for (let d = -50; d < 1500; d++) {
      if (viaOwn) F.fogDayOf(w, d, a, F.fogLooksIn(w, null));
      else F.fogDayOf(w, d, a);
      out.push([a.morning, a.evening, a.eveningBefore]);
    }
    return out;
  };
  const today = draws(Fog, true);
  dayOne("with no row, every world's draw on 1,550 days (through the world's own table, which is none) is", today, old ? draws(old.Fog, false) : null, RECORDED.fog);
  ok(Fog.fogLookIn('monument', own) === own.look && own.look.top === 7, "Monument's own look where its row names one");
  const out = { morning: 0, evening: 0, eveningBefore: 0 };
  let foggy = 0;
  let want = 0;
  let inRange = true;
  for (let d = 0; d < 2000; d++) {
    Fog.fogDayOf('monument', d, out, Fog.fogLooksIn('monument', own));
    if (Fog.fogHash('monument', d, 1) < 0.6) want++;
    if (out.morning > 0) {
      foggy++;
      if (out.morning < 0.5 || out.morning > 0.9) inRange = false;
    }
  }
  ok(foggy === want && foggy > 1000 && inRange, `Monument, which the table never fogs, fogs on the mornings its row's chance draws (${foggy} of 2,000), as thick as its row allows`);
  Fog.fogDayOf('monument', 0, out, Fog.fogLooksIn('monument', null));
  ok(out.morning === 0 && out.evening === 0, 'and never without it');
  let d = 0;
  for (; d < 100; d++) {
    Fog.fogDayOf('monument', d, out, Fog.fogLooksIn('monument', own));
    if (out.morning > 0) break;
  }
  const fh = Fog.newFogHour();
  fh.time = 0.26;
  fh.morning = out.morning;
  fh.evening = out.evening;
  fh.eveningBefore = out.eveningBefore;
  fh.lookTop = own.look.top;
  Fog.fogHourIn(fh);
  ok(fh.level > 0 && fh.top >= 7, `its foggy morning's fog stands at first light (level ${fh.level.toFixed(2)}, filling to ${fh.top.toFixed(1)} m)`);

  // What the world keeps of its day (`FogDays`, which `World.writeFogHour` asks every frame and `World.setWorldFog` hands the
  // row): the arrival lets the row go, the file lands after the day was drawn, and the row's look is drawn from on that same
  // day, with no new day needed; let go again, the table's on the same day.
  const days = new Fog.FogDays();
  const count = { day: d };
  ok(days.dayOf('monument', count).morning === 0 && days.lookOf('monument') === undefined && days.idx === d && days.world === 'monument', "Monument's day drawn with no row of its own: the table's, which never fogs it");
  days.setOwn('monument', own.look);
  ok(days.dayOf('monument', count).morning === out.morning && out.morning > 0 && days.lookOf('monument')?.top === 7, `a row landing after the day was drawn is drawn from on that same day (morning ${out.morning.toFixed(2)})`);
  days.draw.morning = 99;
  ok(days.dayOf('monument', count).morning === 99, 'and asked again with nothing moved, the day kept as drawn (not drawn again every frame)');
  Tune.FOG_LOOKS_STAMP.n++;
  ok(days.dayOf('monument', count).morning === out.morning, "the table's looks tuned (their stamp moved): drawn again");
  ok(days.dayOf('naboo', count) === days.draw && days.lookOf('naboo') === Tune.GROUND_FOG_LOOKS.naboo && days.world === 'naboo', "another world reads the table's own look by identity, Monument's row reaching it not");
  days.setOwn('monument', null);
  ok(days.dayOf('monument', count).morning === 0 && days.lookOf('monument') === undefined, 'the row let go: the table\'s again, on the same day');
  days.dayOf('monument', count);
  days.draw.morning = 99;
  days.moved();
  ok(days.dayOf('monument', count).morning === 0, 'the looks moved from the console (`moved`): drawn again at the next ask');
}

// ---- 3. the wind ----
type WindMod = typeof Wind;
const rows = [0, 1, 2, 3, 4].map((l) => ({ weatherIndex: l, windSpeedScale: 2 + l, cameraEffect: { kind: l > 2 ? 'rain' : 'clear' } }));
const sky = { mixLength: 2, mixBlock: (i: number) => rows[i + 1], mixWeights: new Float64Array([0.7, 0.3, 0, 0]), lighting: { windSpeedScale: 4 } };
function windTrace(W: WindMod, pack: string, frames: number): number[][] {
  W.setWindArm({ master: true, wind: true, devils: true, trees: true, art: 1 });
  W.attachWind(pack, pack, 777, [50, 20, 15, 10, 5], 5, rows);
  const out: number[][] = [];
  const F = W.WIND_FRAME;
  for (let f = 0; f < frames; f++) {
    F.t = 1.79e9 + f * 0.5;
    F.level = 1.5 + Math.sin(f * 0.01);
    F.forced = null;
    F.px = 40 + f;
    F.pz = -20;
    W.stepWind7(sky);
    const ob = W.windObserver();
    out.push([F.heading, F.mean, F.speed, F.veer, F.k, F.p, F.travel, ob.floor, ob.gust, ob.cover, ob.size, ob.wander, ob.devils, ...Array.from(W.wind7Uniforms().uWind7.value)]);
  }
  return out;
}
{
  const plain = windTrace(Wind, 'monument', 300);
  const live = Wind.windPattern()!;
  ok(live.worldMult === Wind.windWorldOf('monument'), "with no row, the pattern multiplies by the table's own entry, by identity");
  dayOne("with no row, every number of the wind's step and its pack, frame for frame, is", plain, old ? windTrace(old.Wind, 'monument', 300) : null, RECORDED.wind);
  Wind.setPlaceWind('monument', { gust: 2, cover: 0.5 });
  const now = Wind.windWorldNow()!;
  ok(now.mult.gust === 2 && now.mult.cover === 0.5 && now.mult.floor === Wind.windWorldOf('monument').floor && now.own?.gust === 2, "Monument's row's multipliers stand in force, the table's for the rest");
  ok(live.worldMult !== Wind.windWorldOf('monument') && live.worldMult.byLevel === Wind.windWorldOf('monument').byLevel, "the pattern takes them at once, the table's levels by reference");
  ok(Wind.windEntryNow() === live.worldMult && /const e = windEntryNow\(\) \?\? windWorldOf\(id\.planetId\);/.test(text('world/windDebug.ts')), "the wind's console reads the entry in force, the row's laid over the table's");
  const rowed = windTrace(Wind, 'monument', 300);
  ok(rowed.every((r, i) => Math.abs(r[8] - 2 * plain[i][8]) < 1e-12 && Math.abs(r[9] - 0.5 * plain[i][9]) < 1e-12 && Object.is(r[7], plain[i][7])), 'Monument blows by them: its gusts twice as strong and its patches half as many at every frame, its floor as before');
  ok(Wind.WIND_WORLDS.monument.gust === 1, 'and the table itself is never written');
  // A table dial moved while the row stands (`wind({ worlds })`): the pattern takes the table's new number for a multiplier
  // the row does not set, at once, and keeps the row's own for one it does.
  {
    const pat = Wind.windPattern()!;
    const was = Wind.windWorldOf('monument').floor;
    const wasGust = Wind.windWorldOf('monument').gust;
    Wind.tuneWind({ worlds: { monument: { floor: 1.7, gust: 4 } } });
    ok(pat.worldMult.floor === 1.7 && pat.worldMult.gust === 2 && pat.worldMult.cover === 0.5, `a table dial moved under a row: the table's floor at once (${pat.worldMult.floor}), the row's gust and cover kept (${pat.worldMult.gust}, ${pat.worldMult.cover})`);
    Wind.tuneWind({ worlds: { monument: { floor: was, gust: wasGust } } });
    ok(pat.worldMult.floor === was && Wind.WIND_WORLDS.monument.floor === was, 'and moved back, the table\'s again');
  }
  Wind.setPlaceWind('naboo', { gust: 3 });
  ok(Wind.windWorldNow()!.mult.gust === 1 && Wind.windPattern()!.worldMult === Wind.windWorldOf('monument'), "another pack's row reaches nothing of the world attached (Monument's own let go with it)");
  Wind.setPlaceWind('naboo', null);
  Wind.detachWind();
  Wind.setWindArm({ master: false, wind: true, devils: true, trees: true, art: 1 });
}

// ---- 4. the clouds' feed ----
type FeedMod = typeof Feed;
class StandInSky {
  mixLength = 1;
  mixWeights = new Float64Array([1, 0, 0, 0]);
  mixBlock(): null {
    return null;
  }
  lighting = { windSpeedScale: 3, shadowScale: 0.6, bounce: new THREE.Color(0.2, 0.2, 0.2), bounceScale: 1, ambient: new THREE.Color(0.3, 0.3, 0.35), ambientScale: 1 };
  sheetAloft = new Float64Array([8, 12, 0.2]);
  sheetAloftOn = true;
  domeUniforms = {};
  tex = new THREE.Texture();
  cloudImages(slot: 0 | 1, out: { readonly images: readonly unknown[] }): void {
    const im = out.images as { file: string | null; weight: number; size: number; speed: number; repeat: number; texture: unknown; scrollX: number; scrollY: number; scrolled: boolean }[];
    for (let m = 0; m < 2; m++) {
      const b = im[m];
      b.file = m === 0 ? (slot === 0 ? 'heaps.png' : 'veil.png') : null;
      b.weight = m === 0 ? 0.8 : 0;
      b.repeat = slot === 0 ? 3000 : 5000;
      b.size = b.repeat / 105;
      b.speed = 1;
      b.texture = m === 0 ? this.tex : null;
      b.scrollX = 0.1;
      b.scrollY = 0.2;
      b.scrolled = true;
    }
  }
}
function feedOf(F: FeedMod): InstanceType<FeedMod['AirCloudsFeed']> {
  const f = new F.AirCloudsFeed();
  f.input.sky = new StandInSky() as never;
  f.input.pictures = F.cloudPicturesOf({ pictures: 2, tiles: { 'heaps.png': { coverage: 0.2, spread: 0.6, brightness: 0.72, colour: [230, 232, 240] }, 'veil.png': { coverage: 0.5, spread: 0.1, brightness: 0.6, colour: [200, 205, 215] } } });
  f.input.weatherOn = true;
  f.input.heading = 0.7;
  f.input.travel = 6;
  f.input.windClock = 0;
  f.input.camX = 0;
  f.input.camY = 2;
  f.input.camZ = 0;
  f.input.lowForce = true;
  f.input.simulate = true;
  f.input.groundAt = () => 120;
  return f;
}
function tuneOf(V: typeof Vol): import('../../../src/world/volumetrics/volSettings.ts').VolTune {
  const t = V.newVolTune();
  t.on = true;
  t.clouds = true;
  t.cloudsSmear = false;
  t.cloudsLow = true;
  t.cloudsHoles = true;
  return t;
}
const uniformNumbers = (f: InstanceType<FeedMod['AirCloudsFeed']>): number[] => {
  const out: number[] = [];
  for (const group of [f.weatherU, f.marchU, f.lowWindU] as Record<string, { value: unknown }>[]) {
    for (const k of Object.keys(group)) {
      const v = group[k].value as { toArray?: () => number[] } | ArrayLike<number> | number;
      if (typeof v === 'number') out.push(v);
      else if (v && typeof (v as { toArray?: unknown }).toArray === 'function') out.push(...(v as { toArray: () => number[] }).toArray());
      else if (v && typeof (v as ArrayLike<number>).length === 'number') out.push(...Array.from(v as ArrayLike<number>));
    }
  }
  out.push(f.coverBottom, f.coverTop, f.low, f.overcast, f.holes.high.bottom, f.holes.high.top);
  return out;
};
function feedTrace(F: FeedMod, V: typeof Vol, frames: number, set?: (f: InstanceType<FeedMod['AirCloudsFeed']>) => void): number[][] {
  const f = feedOf(F);
  set?.(f);
  const t = tuneOf(V);
  const out: number[][] = [];
  for (let k = 0; k < frames; k++) {
    f.input.dt = 1 / 60;
    f.input.rain = 0.5 + 0.5 * Math.sin(k * 0.02);
    f.input.camX = k * 3;
    f.input.windClock = k / 60;
    f.update(t);
    out.push(uniformNumbers(f));
  }
  return out;
}
{
  const plain = feedTrace(Feed, Vol, 240);
  dayOne(`with no row, every uniform the feed writes and every deck's cover (${plain[0].length} numbers a frame), frame for frame, is`, plain, old ? feedTrace(old.Feed as FeedMod, old.Vol as typeof Vol, 240) : null, RECORDED.feed);
  const C = Tune.AIR_TUNE.clouds;
  const LD = Tune.AIR_TUNE.lowDeck;
  const f = feedOf(Feed);
  const t = tuneOf(Vol);
  f.input.dt = 1 / 60;
  f.input.rain = 0.8;
  f.update(t);
  const before = { gain: f.weatherU.uLook.value.x, bottom: f.marchU.uHigh.value.x, top: f.marchU.uHigh.value.y, density: f.marchU.uDens.value.x, coverBottom: f.coverBottom, low: f.low, lowFloor: f.marchU.uLow.value.x, lowTop: f.marchU.uLow.value.y, overcastCover: f.weatherU.uOver.value.x };
  ok(before.gain === C.gain && before.bottom === C.bottom && before.top === C.top && before.density === C.density && f.holes.high.bottom === C.bottom, "the feed's own numbers with no row (the tune's, by identity)");
  f.input.cloudCover = 1.5;
  f.input.cloudHeight = 2;
  f.input.cloudDepth = 0.5;
  f.input.cloudDensity = 3;
  f.update(t);
  ok(f.weatherU.uLook.value.x === C.gain * 1.5 && f.weatherU.uOver.value.x === before.overcastCover * 1.5, "cover laid on the pictures' gain and the overcast's cover");
  ok(Math.abs(f.coverBottom - Math.min(0.2 * C.gain * 1.5, 1) * 0.8 - f.weatherU.uOver.value.z * f.weatherU.uOver.value.x) < 1e-12, 'and so on the bottom deck\'s cover (its picture\'s gained share at its presence, and its overcast\'s)');
  ok(f.marchU.uHigh.value.x === C.bottom * 2 && f.marchU.uHigh.value.y === C.bottom * 2 + (C.top - C.bottom) * 0.5 && f.holes.high.bottom === C.bottom * 2 && f.holes.high.top === f.marchU.uHigh.value.y, "height laid on the high slab's floor and depth on its thickness, the holes' band with them");
  ok(f.marchU.uDens.value.x === C.density * 3, "density laid on the march's");
  ok(Math.abs(f.marchU.uLow.value.x - (f.ground + LD.floor * 2)) < 1e-9 && Math.abs(f.marchU.uLow.value.y - f.marchU.uLow.value.x - Math.max(LD.depth * 0.5, 1)) < 1e-9, "the low deck's floor over its ground by the height and its thickness by the depth");
  f.input.lowForce = null;
  f.update(t);
  ok(Math.abs(f.low - Math.min(Math.max(f.overcast * LD.cover * 1.5, LD.fair * f.coverBottom), 1)) < 1e-12, "the low deck's wet cover by the cover (its fair cover is the lower deck's own, already covered)");
  // Only where the row sets each: a height alone leaves the depth's thickness the tune's.
  const g = feedOf(Feed);
  g.input.cloudHeight = 1.5;
  g.input.dt = 1 / 60;
  g.update(t);
  ok(g.marchU.uHigh.value.y - g.marchU.uHigh.value.x === C.top - C.bottom && g.weatherU.uLook.value.x === C.gain && g.marchU.uDens.value.x === C.density, 'a row setting the height alone moves nothing else');
  // The calibration asked by the numbers drawn.
  const h = feedOf(Feed);
  const posted: { jobs: { which: string; march: Record<string, number> }[] }[] = [];
  const hx = h as unknown as Record<string, unknown>;
  hx.worker = { postMessage: (m: { jobs: { which: string; march: Record<string, number> }[] }) => void posted.push(m) };
  hx.noiseFiles = { baseUrl: 'b', detailUrl: 'd', baseSize: 1, detailSize: 1 };
  h.input.cloudHeight = 2;
  h.input.cloudDepth = 0.5;
  h.input.cloudDensity = 3;
  for (let k = 0; k < 4; k++) h.calibrateCheck(0.3);
  const high = posted.flatMap((p) => p.jobs).find((j) => j.which === 'high');
  const low = posted.flatMap((p) => p.jobs).find((j) => j.which === 'low');
  ok(!!high && high.march.bottom === C.bottom * 2 && high.march.top === C.bottom * 2 + (C.top - C.bottom) * 0.5 && high.march.density === C.density * 3 && !!low && low.march.top === Math.max(LD.depth * 0.5, 1), "the decks' cover curves measured by the numbers drawn (a deck is cut as it is drawn)");

  // The arrival's own order: the row let go at the arrival, the feed's first ask made with none, the file landing after it.
  // The worker is asked again whenever the numbers drawn move -- the row landing, each multiplier alone, and the row let go
  // again -- and the numbers last asked are the numbers drawn.
  type Ask = { id: number; jobs: { which: string; march: Record<string, number> }[] };
  const k = feedOf(Feed);
  const kx = k as unknown as Record<string, unknown>;
  const asks: Ask[] = [];
  kx.worker = { postMessage: (m: Ask) => void asks.push(m) };
  kx.noiseFiles = { baseUrl: 'b', detailUrl: 'd', baseSize: 1, detailSize: 1 };
  const asked = kx.calAsked as Float64Array;
  /** Frames of the feed (a dial at rest asks after half a second): how many asks they posted. */
  const frames = (): number => {
    const before = asks.length;
    for (let i = 0; i < 6; i++) {
      k.input.dt = 0.3;
      k.update(t);
    }
    return asks.length - before;
  };
  const last = (which: string) => asks[asks.length - 1].jobs.find((j) => j.which === which);
  ok(frames() === 1 && asks[0].jobs.length === 1 && last('low')?.march.top === Math.max(LD.depth, 1), "with no row, the first ask is the low deck's alone (the high deck stands on the manifest's own curve)");
  ok(frames() === 0, 'and with nothing moved, nothing is asked again');
  k.input.cloudDensity = 3;
  ok(frames() === 1 && last('high')?.march.density === C.density * 3 && last('low')?.march.density === C.density * 3, "a row's density landing later, alone: asked again, both decks at the density drawn");
  ok(asked[0] === k.marchU.uDens.value.x, `the density last asked is the density drawn (${asked[0]})`);
  k.takeCalibration({ id: asks[asks.length - 1].id, curves: [{ which: 'high', cover: [{ cut: 0, sky: 0.9 }, { cut: 1, sky: 0 }] }], ms: 1 });
  ok(k.calibration.high === 'worker', "the worker's answer for the high deck taken");
  k.input.cloudDensity = Number.NaN;
  k.input.cloudHeight = 2;
  k.input.cloudDepth = 0.5;
  ok(frames() === 1 && last('high')?.march.bottom === C.bottom * 2 && last('high')?.march.top === C.bottom * 2 + (C.top - C.bottom) * 0.5 && last('high')?.march.density === C.density && last('low')?.march.top === Math.max(LD.depth * 0.5, 1), "the row moved to a height and a depth: asked again at the floor, roof and low depth drawn");
  ok(asked[6] === k.marchU.uHigh.value.x && asked[7] === k.marchU.uHigh.value.y && Math.abs(asked[9] - (k.marchU.uLow.value.y - k.marchU.uLow.value.x)) < 1e-9, `the floor, roof and low deck's depth last asked are those drawn (${asked[6]}, ${asked[7]}, ${asked[9]})`);
  k.takeCalibration({ id: asks[asks.length - 1].id, curves: [{ which: 'high', cover: [{ cut: 0, sky: 0.9 }, { cut: 1, sky: 0 }] }], ms: 1 });
  k.input.cloudHeight = Number.NaN;
  k.input.cloudDepth = Number.NaN;
  ok(frames() === 1 && asks[asks.length - 1].jobs.length === 1 && last('low')?.march.top === Math.max(LD.depth, 1) && k.calibration.high === 'manifest', "the row let go again: asked again, the low deck at the tune's depth and the high deck back on the manifest's own curve");

  // The game's kept record of the world row's clouds (`App.worldClouds`, `WorldClouds.set`) and the frame's hand-over to the
  // feed (`CloudsFeedInput.takeWorld`): each multiplier the row sets and NaN for the rest, and none for another world.
  const wc = new Feed.WorldClouds();
  ok(Number.isNaN(wc.cover) && Number.isNaN(wc.height) && Number.isNaN(wc.depth) && Number.isNaN(wc.density) && wc.pack === '', 'the kept record starts with no multiplier');
  wc.set('monument', { cover: 1.5, height: 0.8, depth: 1.2, density: 1.3 });
  const inp = new Feed.CloudsFeedInput();
  inp.takeWorld(wc, 'monument');
  ok(wc.pack === 'monument' && inp.cloudCover === 1.5 && inp.cloudHeight === 0.8 && inp.cloudDepth === 1.2 && inp.cloudDensity === 1.3, "a row's four multipliers kept for its pack and taken by the frame for that world");
  inp.takeWorld(wc, 'tatooine');
  ok(Number.isNaN(inp.cloudCover) && Number.isNaN(inp.cloudHeight) && Number.isNaN(inp.cloudDepth) && Number.isNaN(inp.cloudDensity), "and none for another world (the creator's backdrop, a travel's next world before its file lands)");
  wc.set('monument', { height: 2 });
  inp.takeWorld(wc, 'monument');
  ok(inp.cloudHeight === 2 && Number.isNaN(inp.cloudCover) && Number.isNaN(inp.cloudDepth) && Number.isNaN(inp.cloudDensity), 'a row setting one multiplier: that one, NaN for the rest');
  wc.set('monument', null);
  inp.takeWorld(wc, 'monument');
  ok(Number.isNaN(inp.cloudCover) && Number.isNaN(inp.cloudHeight) && Number.isNaN(inp.cloudDepth) && Number.isNaN(inp.cloudDensity) && wc.pack === 'monument', 'and the row let go (no clouds): every multiplier NaN, the tune\'s own numbers');
}

// ---- 5. the hand-overs only the game makes ----
{
  const main = text('main.ts');
  ok(/private applyWorldSky\(pack: string, f: \{ locations: readonly LocationRow\[\] \} \| null\): void \{\n    const row = f \? worldRowOf\(f\.locations, standsIn\) : null;\n    this\.world\.weather\.setClimate\(pack, row\?\.climate \?\? null\);\n    this\.world\.setWorldFog\(pack, row\?\.fog \?\? null\);\n    setPlaceWind\(pack, row\?\.wind \?\? null\);\n    this\.worldClouds\.set\(pack, row\?\.clouds\);\n  \}/.test(main), "the world row's climate, fog, wind and clouds handed to their readers by the pack, the whole of the hand-over");
  ok(main.includes('private readonly worldClouds = new WorldClouds();'), "the clouds' multipliers kept in the feed's own record");
  ok(main.includes('this.applyWorldSky(packIdOf(this.world.planet, this.zone), this.placesSky(f));\n    this.world.weather.placesMoved(this.traveling);') && main.includes('this.applyWorldSky(placesFor, null);'), 'whenever the places are shown again (an arrival, a landing, a state taken), let go as a world is arrived at');
  ok(main.includes('I.travel = WIND_FRAME.travel;\n    I.space = !!this.world.planet?.space;\n    I.inside = this.world.inside;') && /I\.inside = this\.world\.inside;\n(?:    \/\/[^\n]*\n)*    I\.takeWorld\(this\.worldClouds, this\.world\.packId\);\n    I\.sky = sky as CloudsSky \| null;/.test(main), "the clouds' multipliers taken into the feed's kept input every frame, for the world loaded now alone");
  ok(main.includes('this.world.weather.places = { skyAt: (x, z, out) => this.placesNow().skyAt(x, z, out) };'), "the weather asks the places' index");
  const world = text('world/world.ts');
  ok(world.includes('setWorldFog(pack: string, look: FogLook | null): void {\n    this.fogDays.setOwn(pack, look);\n  }') && world.includes('fogLooksMoved(): void {\n    this.fogDays.moved();\n  }'), "the world row's fog look and the console's tuned looks handed to the world's kept day");
  ok(world.includes('const days = this.fogDays;\n    const look = days.lookOf(id);') && world.includes('const drawn = days.dayOf(id, count);') && world.includes('fh.morning = hold.day ? (look ? look.morningHi : 0.8) : drawn.morning;\n    fh.evening = drawn.evening;\n    fh.eveningBefore = hold.day ? fh.morning : drawn.eveningBefore;'), "the ground fog's hour reads the world's own look and the day its kept day draws, in place of the table's");
  // The world row the sky is read from (`worldRowOf`): the row standing in the world's state now, wherever the file lists it.
  const PlacesM = (await load(NEW, 'world/places.ts')) as typeof import('../../../src/world/places.ts');
  type R = import('../../../src/world/editFiles/locationsFile.ts').LocationRow;
  const place: R = { id: 'town', kind: 'city', shape: { kind: 'circle', c: [0, 0], r: 100 } };
  const living: R = { id: 'world', kind: 'world', state: 'restuss=living', climate: [1, 2] };
  const plainWorld: R = { id: 'world2', kind: 'world', fog: { morning: 1, evening: 0, morningLo: 0.1, morningHi: 0.2, eveningLo: 0, eveningHi: 0, top: 5 } };
  const yes = () => true;
  ok(PlacesM.worldRowOf([place, plainWorld], yes) === plainWorld, 'the world row read wherever the file lists it (after a place)');
  ok(PlacesM.worldRowOf([place], yes) === null && PlacesM.worldRowOf([], yes) === null, 'and none where the file has none');
  let state = 'living';
  const stands = (s?: string | null) => !s || s === `restuss=${state}`;
  ok(PlacesM.worldRowOf([place, living], stands) === living, 'a world row tagged for the state in force stands');
  state = 'ruins';
  ok(PlacesM.worldRowOf([place, living], stands) === null && PlacesM.worldRowOf([living, plainWorld], stands) === plainWorld, "one tagged for a state not in force is passed over (the next standing world row read, or none)");
  const weather = text('world/weather.ts');
  ok(weather.includes('this.weights = own && own.pack === opts.packId ? climateFor(opts.packId, this.levels, own.weights) : climateFor(opts.packId, this.levels);'), "an arrival takes its world's own climate");
}

console.log(`placeWorldRow: ${checks} checks passed`);
