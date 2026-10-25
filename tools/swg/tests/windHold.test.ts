// The hold (the volumetrics' wave 7a, the owner's "a wind slider or changer I can use right now"): with the master off,
// `__debug.wind({ speed, heading, gust })` moves every reader at once -- the weather's heading and speed, the water's
// wind, the flora's, the rain sheets' lean and the sky's two sheets (at the held speed times their share aloft, a held
// nought standing them still) -- and letting go gives the weather's own wind back by `Object.is` against a weather that
// was never held; the weather console's `holdWind` writes the same record. The sheets' drift is the sky's own arithmetic
// (`driftAloft`), run here. Under the unified wind's arm the weather's own step (`stepUnifiedWind`) hands every reader
// what the wind's step worked out, the veer turning the water and the rain the weather's way and never the flora, the
// sheets the world's wind aloft over their floor (a held speed's with none), the travel's level nought with the Weather
// setting off; the pattern travels at the held vector from the moment of the hold and gives the shared pattern back the
// moment it is let go, a phase frozen under a held heading included; and with the arm off the sheets take the world's
// wind aloft only while a deck of the next wave draws (`WIND_STATE.decks`), nothing of the ground's readers with them.
//
// The weather names some neighbours without an extension, so this suite registers the off-proof's loader over today's tree.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './airTrees.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const SRC = join(REPO, 'src');
register(pathToFileURL(join(REPO, 'tools', 'swg', 'tests', 'airLoader.mjs')).href, import.meta.url, { data: { roots: [SRC], packageBase: join(REPO, 'package.json') } });
type Mod = Record<string, unknown>;
const load = async (p: string): Promise<Mod> => (await import(pathToFileURL(join(SRC, p)).href)) as Mod;
const THREE = (await import('three')) as typeof import('three');
const Wm = await load('world/weather.ts');
const Wind = (await load('world/wind.ts')) as typeof import('../../../src/world/wind.ts');
const WMath = (await load('world/windMath.ts')) as typeof import('../../../src/world/windMath.ts');
const Sky = (await load('world/sky.ts')) as typeof import('../../../src/world/sky.ts');
const water = await load('world/water.ts');
const flora = await load('world/floraSway.ts');
const { windDebug } = (await load('world/windDebug.ts')) as typeof import('../../../src/world/windDebug.ts');

const WW = water.WATER_WIND as { value: { x: number; y: number } };
const WWF = water.WATER_WIND_FULL as number;
const FW = flora.FLORA_WIND as { x: number; z: number; strength: number };
const DEG = Math.PI / 180;

type W = Record<string, unknown> & { update(dt: number, p: unknown, ctx: unknown): void; updateView(dt: number, c: unknown, ctx: unknown): void; holdWind(h: number | null): void; state: Record<string, number> };
type Frame = Record<string, unknown> & { heading: number; speed: number; mean: number; veer: number; wx: number; wy: number; fx: number; fz: number; fs: number; sheet: (number | null)[]; sky: number; yaw: number; tilt: number };

/** The stand-in sky's rows: a rain row a level, so the falling sheets stand and lean. */
const BLOCKS = [0, 1, 2, 3, 4].map((l) => ({ weatherIndex: l, windSpeedScale: 2 + l, cameraEffect: { file: 'fx_rain.prt', kind: 'rain', strength: 0.8 } }));

/** A weather on a stand-in sky whose scale moves, its frames' readers recorded. */
function weather(player = new THREE.Vector3(10, 0, -4)): { w: W; x: Record<string, unknown>; frame: () => Frame; lighting: { windSpeedScale: number; shadowScale: number } } {
  const w = new (Wm.Weather as new (p: unknown) => W)({ world: null });
  const x = w as unknown as Record<string, unknown>;
  const setWind: number[] = [];
  const lighting = { windSpeedScale: 4, shadowScale: 1 };
  x.sky = {
    lighting,
    data: { blocks: BLOCKS, weather: { effects: null } },
    texturesReady: () => true,
    ensureTextures: () => Promise.resolve(),
    setMix: () => undefined,
    setWind: (h: number) => void setWind.push(h),
    setOvercast: () => undefined,
    sheetAloft: new Float64Array(3),
    sheetAloftOn: false,
    mixLength: 1,
    mixBlock: () => BLOCKS[0],
    mixWeights: new Float64Array([1, 0, 0, 0]),
  };
  const skyRec = x.sky as { sheetAloft: Float64Array; sheetAloftOn: boolean };
  x.reason = null;
  x.hasWeatherData = true;
  x.seed = 4242;
  x.weights = [0.3, 0.25, 0.2, 0.15, 0.1];
  x.levels = 5;
  x.current = { name: '', byLevel: Int16Array.from([0, 1, 2, 3, 4]) };
  type Handle = { rateScale: number; alphaScale: number; file: string };
  x.fxEffects = { quads: 0, batchMaterials: [], kill: null, place: (file: string): Handle => ({ rateScale: 0, alphaScale: 1, file }), move: (): void => undefined, remove: (): void => undefined, particlesOf: (): number => 5, soundsOf: (): string[] => [], update: (): void => undefined };
  (x.roofs as { update: () => void }).update = () => undefined;
  const camera = new THREE.PerspectiveCamera();
  const vctx = { inside: false, aboard: false, underground: false, fog: null, groundAt: () => 0, waterAt: () => -Infinity, vehicles: [], hull: null, ridden: null };
  const wctx = { daylight: 0.8, groundAt: () => 0 };
  const frame = (): Frame => {
    w.update(1 / 60, player, wctx);
    const sheet = skyRec.sheetAloftOn ? [skyRec.sheetAloft[0], skyRec.sheetAloft[1], skyRec.sheetAloft[2]] : [null, null, 0];
    w.updateView(1 / 60, camera, vctx);
    const ch = x.channels as { matrix: THREE.Matrix4 }[];
    const q = new THREE.Quaternion();
    ch[0]?.matrix.decompose(new THREE.Vector3(), q, new THREE.Vector3());
    const yaw = 2 * Math.atan2(q.y, q.w);
    return { heading: w.state.windHeading, speed: w.state.windSpeed, mean: w.state.windMean, veer: w.state.windVeer, wx: WW.value.x, wy: WW.value.y, fx: FW.x, fz: FW.z, fs: FW.strength, sheet, sky: setWind[setWind.length - 1], yaw, tilt: ch[0] ? Math.abs(new THREE.Euler().setFromQuaternion(q, 'YXZ').x) : 0 };
  };
  return { w, x, frame, lighting };
}

/** `fn` run with nothing held (the hold is one record every weather reads), the hold put back after. */
function unheld<T>(fn: () => T): T {
  const keep = { ...Wind.WIND_HOLD };
  Wind.releaseWind();
  try {
    return fn();
  } finally {
    Object.assign(Wind.WIND_HOLD, keep);
  }
}

/** Two readings the same angle (a yaw read back from a matrix wraps). */
const sameAngle = (a: number, b: number, eps = 1e-9): boolean => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < eps;

const realNow = Date.now;
let now = 1.79e12;
Date.now = () => now;
const tick = (s = 1 / 60): void => {
  now += 1000 * s;
};
const nav = { weather: () => ({ windHeading: 0, windSpeed: 0, windMean: 0, windVeer: 0, level: 0, scheduled: 0, enabled: true, reason: null }), sheets: () => null, player: () => ({ x: 0, z: 0 }), crosshair: () => null, air: () => ({ handed: 0, why: null }), trees: () => ({}), selfTest: () => null };

try {
  // --- with the master off ---
  Wind.setWindArm({ master: false, wind: true, devils: true, trees: true, art: 1 });
  ok(!Wind.WIND_STATE.on, "the master off: the unified wind's arm is off");
  // A weather never held (each of its frames run with the hold empty), and one held then let go, side by side.
  const plain = weather();
  const held = weather();
  for (let f = 0; f < 30; f++) {
    tick();
    unheld(() => plain.frame());
    held.frame();
  }
  // Hold a speed and a heading through the console's own path.
  windDebug({ speed: 12, heading: 90 }, nav);
  let movesAll = true;
  let drift: Frame | null = null;
  let plainMoved = false;
  for (let f = 0; f < 60; f++) {
    tick();
    plain.lighting.windSpeedScale = held.lighting.windSpeedScale = 4 + Math.sin(f * 0.1);
    const a = unheld(() => plain.frame());
    const r = held.frame();
    drift = r;
    if (!sameAngle(a.heading, Math.PI / 2, 1e-6) && a.speed !== 12) plainMoved = true;
    const h = Math.PI / 2;
    if (!Object.is(r.heading, h) || !Object.is(r.speed, 12)) movesAll = false;
    if (Math.abs(r.wx - Math.sin(h) * Math.min(12 / WWF, 1)) > 1e-12 || Math.abs(r.wy - Math.cos(h) * Math.min(12 / WWF, 1)) > 1e-12) movesAll = false;
    if (!Object.is(r.fx, Math.sin(h)) || !Object.is(r.fz, Math.cos(h)) || !Object.is(r.fs, Math.min(12 / WWF, 1))) movesAll = false;
    if (!sameAngle(r.yaw, h) || !Object.is(r.sky, h)) movesAll = false;
  }
  ok(movesAll && plainMoved, "held at 12 m/s toward +X with the master off: the weather's heading and speed, the water's wind, the flora's heading and strength, the sky's wind and the rain's yaw all take it, whatever the rows' scale does, while a weather never held goes on with its own");
  const s = drift!.sheet as number[];
  ok(Math.abs(s[0] - 12 * Wind.WIND_TUNE.aloft.bottom) < 1e-12 && Math.abs(s[1] - 12 * Wind.WIND_TUNE.aloft.top) < 1e-12 && Math.abs(s[2] - Wind.WIND_TUNE.aloft.veerTop * DEG) < 1e-12, `and the sky's two sheets drift at the held speed times their share aloft (${s[0]} and ${s[1]} m/s, the top turned ${Wind.WIND_TUNE.aloft.veerTop} degrees)`);
  ok(drift!.tilt > 0.3, `the rain's lean takes the held speed (tilted ${drift!.tilt.toFixed(3)} rad)`);
  // A held nought stands the sheets still and the flora at its calm.
  windDebug({ speed: 0 }, nav);
  tick();
  unheld(() => plain.frame());
  const still = held.frame();
  ok(still.sheet[0] === 0 && still.sheet[1] === 0 && still.speed === 0 && still.fs === 0, "a held nought stands the sky's sheets still, and the water and the trees at their calm");
  // The gust share alone, through the weather's own step: nought holds the speed at the rows' scale, two doubles the
  // swing of a weather never held about it, at the same moment and the same rows.
  windDebug({ hold: false }, nav);
  windDebug({ gust: 0 }, nav);
  tick();
  const a0 = unheld(() => plain.frame());
  const steady = held.frame();
  ok(steady.speed === held.lighting.windSpeedScale && a0.speed !== held.lighting.windSpeedScale, "a gust share of nought holds the speed steady at the rows' own scale (the pulse taken out), through the weather's own step, where a weather never held swings about it");
  windDebug({ gust: 2 }, nav);
  let doubled = true;
  for (let f = 0; f < 40; f++) {
    tick();
    const a = unheld(() => plain.frame());
    const b = held.frame();
    const rows = held.lighting.windSpeedScale;
    if (Math.abs(b.speed - rows - 2 * (a.speed - rows)) > 1e-12) doubled = false;
  }
  ok(doubled, "and a gust share of two doubles the weather's own swing about the rows' scale, either way, frame for frame against a weather never held");
  // Let go: the weather's own wind back by Object.is against a weather never held, the sheets told nothing is held.
  windDebug({ speed: 9, heading: 45 }, nav);
  for (let f = 0; f < 10; f++) {
    tick();
    unheld(() => plain.frame());
    held.frame();
  }
  windDebug(null, nav);
  let back = true;
  let sheetsBack = true;
  for (let f = 0; f < 60; f++) {
    tick();
    plain.lighting.windSpeedScale = held.lighting.windSpeedScale = 4 + Math.cos(f * 0.13);
    const a = unheld(() => plain.frame());
    const b = held.frame();
    for (const k of ['heading', 'speed', 'mean', 'veer', 'wx', 'wy', 'fx', 'fz', 'fs', 'sky', 'yaw']) if (!Object.is(a[k], b[k])) back = false;
    if (JSON.stringify(a.sheet) !== JSON.stringify(b.sheet)) back = false;
    if (!(b.sheet[0] === null && b.sheet[1] === null && b.sheet[2] === 0)) sheetsBack = false;
  }
  ok(back && !Wind.windHeld(), "let go, every reader is the weather's own again by Object.is against a weather that was never held");
  ok(sheetsBack, "and the sky's sheets are told nothing is held (today's drift line) on every frame after");
  // The weather console's holdWind writes the very record.
  held.w.holdWind(1.25);
  ok(Wind.WIND_HOLD.heading === 1.25, "the weather console's holdWind writes the hold's own heading");
  held.w.holdWind(null);
  ok(Wind.WIND_HOLD.heading === null && !Wind.windHeld(), 'and null lets it go');
} finally {
  Date.now = realNow;
}

// --- the sheets' drift: the sky's own arithmetic, run ---
{
  const size = 37;
  const alt = 1500;
  const repeat = size * (alt / 10) * 0.7;
  const aloft = new Float64Array([15 * Wind.WIND_TUNE.aloft.bottom, 15 * Wind.WIND_TUNE.aloft.top, 25 * DEG]);
  const h = 0.9;
  const dt = 1 / 60;
  const s0 = { x: 0.25, y: 0.5 };
  Sky.driftAloft(s0, aloft, 0, h, size, alt, dt);
  const rate = aloft[0] / repeat;
  ok(Math.abs(0.25 - s0.x - Math.sin(h) * rate * dt) < 1e-15 && Math.abs(0.5 - s0.y - Math.cos(h) * rate * dt) < 1e-15, `a held 15 m/s moves the lower sheet ${(rate).toExponential(3)} repeats a second toward the heading: its speed aloft over its repeat in metres, with no floor`);
  const s1 = { x: 0.25, y: 0.5 };
  Sky.driftAloft(s1, aloft, 1, h, size, 2300, dt);
  const rate1 = aloft[1] / (size * (2300 / 10) * 0.7);
  ok(Math.abs(0.25 - s1.x - Math.sin(h + aloft[2]) * rate1 * dt) < 1e-15 && Math.abs(0.5 - s1.y - Math.cos(h + aloft[2]) * rate1 * dt) < 1e-15, 'the upper sheet at its own speed, turned from the heading by the veer the way a heading turns');
  const zero = new Float64Array([0, 0, 25 * DEG]);
  const sz = { x: 0.25, y: 0.5 };
  for (let f = 0; f < 600; f++) Sky.driftAloft(sz, zero, f % 2, h, size, alt, dt);
  ok(Object.is(sz.x, 0.25) && Object.is(sz.y, 0.5), 'a held nought stands both sheets exactly still, ten seconds of frames');
}

// --- under the arm: the weather's own unified step and its readers ---
const ROWS = BLOCKS.map((b) => ({ weatherIndex: b.weatherIndex, windSpeedScale: b.windSpeedScale, cameraEffect: { kind: 'rain' } }));
const SEED = 4242;
const WEIGHTS = [0.3, 0.25, 0.2, 0.15, 0.1];
const GEOMETRY = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 23, 24];
Date.now = () => now;
try {
  now = 1.79e12 + 7777;
  Wind.attachWind('test-pack', 'zz-hold-planet', SEED, WEIGHTS, 5, ROWS);
  Wind.setWindArm({ master: true, wind: true, devils: false, trees: true, art: 1 });
  ok(Wind.WIND_STATE.on, 'the master, the wind and its art on: the arm is on');
  const F = Wind.WIND_FRAME;
  const r = weather(new THREE.Vector3(37, 0, -12));
  let readers = true;
  let veered = 0;
  let floored = 0;
  let bad = '';
  for (let f = 0; f < 600; f++) {
    tick();
    r.lighting.windSpeedScale = 0.3 + 3 * (0.5 + 0.5 * Math.sin(f * 0.05));
    const o = r.frame();
    const h = F.heading;
    const wh = F.veer !== 0 ? h + F.veer : h;
    const A = Wind.WIND_TUNE.aloft;
    const want = {
      heading: o.heading === h && o.speed === F.speed && o.mean === F.mean && o.veer === F.veer && o.sky === h,
      water: Math.abs(o.wx - Math.sin(wh) * Math.min(F.speed / WWF, 1)) < 1e-12 && Math.abs(o.wy - Math.cos(wh) * Math.min(F.speed / WWF, 1)) < 1e-12,
      flora: Object.is(o.fx, Math.sin(h)) && Object.is(o.fz, Math.cos(h)) && Object.is(o.fs, Math.min(F.mean / WWF, 1)),
      rain: sameAngle(o.yaw, wh),
      sheets: o.sheet[0] === Math.max(F.travel * A.bottom, A.floor) && o.sheet[1] === Math.max(F.travel * A.top, A.floor) && o.sheet[2] === A.veerTop * DEG,
    };
    for (const [k, v] of Object.entries(want)) if (!v && !bad) bad = `${k} at frame ${f}`;
    if (!Object.values(want).every(Boolean)) readers = false;
    if (F.veer !== 0 && Math.abs(F.veer) > 1e-3) veered++;
    if (F.travel * A.bottom < A.floor) floored++;
  }
  ok(readers && veered > 100, `under the arm the weather's own step hands every reader the wind's step: the heading, the speed at the player and the mean apart, the water's wind along the heading turned by the veer, the rain's yaw the same, the flora the mean along the heading alone (no veer, no gust), the sky's wind the heading (${veered} of 600 frames veered)${bad ? `; first wrong: ${bad}` : ''}`);
  ok(readers, `and the sky's sheets the world's travel speed times their share aloft over the floor (${floored} of 600 frames on the floor)`);
  const floorWas = Wind.WIND_TUNE.aloft.floor;
  Wind.WIND_TUNE.aloft.floor = 100;
  tick();
  const fl = r.frame();
  Wind.WIND_TUNE.aloft.floor = floorWas;
  ok(fl.sheet[0] === 100 && fl.sheet[1] === 100 && F.travel * Wind.WIND_TUNE.aloft.top < 100, 'and never under their floor where the world\'s wind aloft falls short of it (a floor of 100 m/s for a frame)');
  // A held speed under the arm: the sheets at it with no floor (a held nought stands them still), the readers at it.
  Wind.holdWind({ speed: 0 });
  tick();
  const z = r.frame();
  ok(z.sheet[0] === 0 && z.sheet[1] === 0 && z.speed === 0 && F.mean === 0, 'a held nought under the arm stands the sheets still, under their floor, and the wind with them');
  Wind.releaseWind();
  // A world's multiplier reaches the observer's own profile the weather blends.
  const gust0 = Wind.windObserver().gust;
  const e = Wind.windWorldOf('zz-hold-planet');
  e.gust = 2;
  tick();
  r.frame();
  const gust2 = Wind.windObserver().gust;
  e.gust = 1;
  ok(gust2 === gust0 * 2, `and a world's multiplier reaches the observer's own blend the weather steps (gust ${gust0} doubled to ${gust2})`);

  // The hold under the arm through the weather's own step: the pattern at the held vector, then the shared one back,
  // a phase frozen under the held heading taken again from the shared heading the moment it is let go.
  const p = Wind.windPattern()!;
  const fresh = (): InstanceType<typeof WMath.WindPattern> => new WMath.WindPattern(SEED, WEIGHTS, WMath.worldWindOf(ROWS, 5), Wind.WIND_PROFILES, Wind.windWorldOf('zz-hold-planet'), Wind.WIND_TUNE as unknown as import('../../../src/world/windMath.ts').WindMathTune, new Float32Array(WMath.PACK_FLOATS));
  const profile = WMath.newProfile();
  Object.assign(profile, Wind.WIND_PROFILES.rain);
  const askAt = (t: number): ReturnType<typeof WMath.newWindAsk> => {
    const a = WMath.newWindAsk(profile);
    a.t = t;
    a.on = true;
    a.rows = 3;
    a.art = 1;
    return a;
  };
  const geometrySame = (q: InstanceType<typeof WMath.WindPattern>): boolean => GEOMETRY.every((i) => Object.is(p.packOut[i], q.packOut[i]));
  const free = fresh();
  free.pack(askAt(F.t));
  const before = geometrySame(free);
  Wind.holdWind({ speed: 11, heading: 2.2 });
  const restartsAt = p.ages[0] > p.ages[1] ? 0 : 1;
  const age0 = p.ages[restartsAt];
  let restarted = false;
  let heldDiffers = false;
  let heldReaders = true;
  for (let f = 0; f < 60 * 70; f++) {
    tick();
    const o = r.frame();
    const A = Wind.WIND_TUNE.aloft;
    // Every reader takes the held numbers under the arm: the heading, the mean (the gust at the player on it), the flora
    // the mean along the heading, the sheets the held speed aloft with no floor.
    if (!(o.heading === 2.2 && o.mean === 11 && o.speed === 11 * F.k && Object.is(o.fx, Math.sin(2.2)) && Object.is(o.fs, Math.min(11 / WWF, 1)) && o.sheet[0] === 11 * A.bottom && o.sheet[1] === 11 * A.top)) heldReaders = false;
    if (p.ages[restartsAt] < age0) restarted = true;
    if (f === 60 * 70 - 1) {
      const q = fresh();
      q.pack(askAt(F.t));
      heldDiffers = !geometrySame(q);
    }
  }
  const heldTravel = p.held && Math.abs(p.travelSpeed - 11) < 1e-12;
  Wind.releaseWind();
  tick();
  r.frame();
  const q = fresh();
  q.pack(askAt(F.t));
  const backNow = geometrySame(q) && !p.held;
  const diff = GEOMETRY.filter((i) => !Object.is(p.packOut[i], q.packOut[i])).map((i) => `${i}: ${p.packOut[i]} against ${q.packOut[i]}`);
  let stays = true;
  for (let f = 0; f < 120; f++) {
    tick();
    r.frame();
    const g = fresh();
    g.pack(askAt(F.t));
    if (!geometrySame(g)) stays = false;
  }
  ok(heldReaders, "held at 11 m/s and 2.2 rad under the arm, every reader takes it: the heading, the mean (the player's gust on it), the flora the held mean along the held heading, the sheets the held speed aloft with no floor");
  ok(before && heldTravel && heldDiffers && restarted, `held under the arm, through the weather's own step, the pattern travels at the held vector (11 m/s) and departs from the shared one, a phase restarting under the held heading`);
  ok(backNow && stays, `let go, the very next frame packs the shared pattern every player has, to the bit, and goes on so: the phase frozen under the held heading taken again from the shared heading${diff.length ? `; differs at ${diff.join(', ')}` : ''}`);
  // The travel's level: a forced one, and nought with the Weather setting off (after the hold: a force moves the travel
  // of the phases standing, which a pattern made afresh never knew of).
  r.x.forced = { level: 3, kind: null };
  tick();
  r.frame();
  const forced = F.forced;
  r.x.forced = null;
  (r.x.settings as { weather: boolean }).weather = false;
  tick();
  r.frame();
  const off = F.forced;
  (r.x.settings as { weather: boolean }).weather = true;
  tick();
  r.frame();
  ok(forced === 3 && off === 0 && F.forced === null, "the travel's level is a forced one when the weather holds one, nought with the Weather setting off (as the weather's own wind is), and the schedule's otherwise");
  // The level let go ramps back over the weather's 40 s; past it, and past both phases' restarts, nothing of it is left.
  for (let f = 0; f < 60 * 100; f++) {
    tick();
    r.frame();
  }

  // --- with the arm off: the sheets at the world's wind aloft while a deck of the next wave draws, nothing else ---
  Wind.setWindArm({ master: true, wind: false, devils: false, trees: true, art: 1 });
  ok(!Wind.WIND_STATE.on && Wind.wind7Uniforms().uWind7.value[27] === 0, "the unified wind's switch off: the arm off, and its uniform's on nought at once");
  const d = weather(new THREE.Vector3(37, 0, -12));
  const plainDeck = weather(new THREE.Vector3(37, 0, -12));
  tick();
  const noDeck = d.frame();
  Wind.WIND_STATE.decks = true;
  let deckRight = true;
  let groundToday = true;
  for (let f = 0; f < 120; f++) {
    tick();
    const a = d.frame();
    Wind.WIND_STATE.decks = false;
    const b = plainDeck.frame();
    Wind.WIND_STATE.decks = true;
    const A = Wind.WIND_TUNE.aloft;
    const tw = fresh();
    tw.arm = false;
    tw.travelWindIn(F.t);
    const travel = Math.sqrt(tw.su.x * tw.su.x + tw.su.z * tw.su.z);
    if (!(F.travel === travel && a.sheet[0] === Math.max(travel * A.bottom, A.floor) && a.sheet[1] === Math.max(travel * A.top, A.floor) && a.sheet[2] === A.veerTop * DEG)) deckRight = false;
    for (const k of ['heading', 'speed', 'mean', 'veer', 'wx', 'wy', 'fx', 'fz', 'fs', 'sky', 'yaw']) if (!Object.is(a[k], b[k])) groundToday = false;
    if (Wind.wind7Uniforms().uWind7.value[27] !== 0) groundToday = false;
  }
  Wind.holdWind({ speed: 6 });
  tick();
  const heldOverDeck = d.frame();
  Wind.releaseWind();
  Wind.WIND_STATE.decks = false;
  tick();
  const deckGone = d.frame();
  ok(noDeck.sheet[0] === null && deckGone.sheet[0] === null, "with the arm off and no deck drawing the sheets are told nothing (today's drift)");
  ok(deckRight, "while a deck of the next wave draws (WIND_STATE.decks) the sheets take the world's pure travel speed aloft, never under the floor");
  ok(groundToday, "and nothing of the ground's readers takes the unified wind with it: the heading, the speeds, the water, the flora and the rain the arm-off weather's by Object.is, the uniform's on nought");
  ok(heldOverDeck.sheet[0] === 6 * Wind.WIND_TUNE.aloft.bottom && heldOverDeck.sheet[1] === 6 * Wind.WIND_TUNE.aloft.top, 'a held speed stands over the deck: its own speed aloft, with no floor');
  Wind.setWindArm({ master: false, wind: true, devils: true, trees: true, art: 1 });
  Wind.detachWind();
} finally {
  Date.now = realNow;
}

console.log(`\n${checks} checks passed`);
