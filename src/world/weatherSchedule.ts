// Which weather is falling, when, and how it blends: every rule of the weather that is plain
// arithmetic, with no imports, so a node test can run it as it is.
//
// The server decided which weather level was active; nothing in the archives says so. Here each
// planet walks between its levels from the wall clock, the same walk for every player at the same
// moment: an anchor level is drawn from the planet's climate every two hours, and between anchors
// the level takes Metropolis steps of one level every five minutes at most, heading for the next
// anchor over the last few. Which environment rows are drawn follows from the level and the area
// the player stands in (the terrain's environment family), blended between two levels and, while an
// area boundary is crossed, between two families.

export type WeatherKind = 'rain' | 'snow' | 'dust' | 'fog' | 'leaves' | 'lightning' | 'smoke' | 'other';
export type ForcedKind = 'rain' | 'dust' | 'snow';

/** Seconds per step of the walk; anchors every ANCHOR_STEPS steps; the last BRIDGE_STEPS steps head for the next anchor. */
export const STEP_SECONDS = 300;
export const ANCHOR_STEPS = 24;
export const BRIDGE_STEPS = 4;
/** Chance per step of proposing a move up or down (half each). */
export const MOVE_CHANCE = 0.4;
/** How fast the continuous level follows the target, levels per second: the schedule's own changes, and anything the player asked for (a hold, a release, the console). */
export const LEVEL_RATE = 1 / 40;
export const FORCED_LEVEL_RATE = 1 / 3;
export const FAMILY_FADE_SECONDS = 4;
/** The player moved further than this in one frame: a teleport, so the weather snaps. */
export const JUMP_METRES = 64;
/** How long a snap to another family waits for that family's textures before switching anyway. */
export const SNAP_WAIT_SECONDS = 3;
/** Life Day's season (invented: the event ran for some weeks around the new year): month 0-based, day of month, inclusive. */
export const LIFE_DAY_FROM = [11, 15] as const;
export const LIFE_DAY_TO = [0, 5] as const;

/** Relative weights of weather levels 0.. per planet. Invented: the server held them. Keys are pack ids; a key matches a pack id equal to it or starting with it and an underscore. */
export const CLIMATES: Readonly<Record<string, readonly number[]>> = {
  tatooine: [60, 20, 12, 6, 2],
  lok: [55, 20, 13, 8, 4],
  naboo: [40, 22, 18, 13, 7],
  corellia: [45, 22, 17, 11, 5],
  dantooine: [45, 20, 17, 12, 6],
  dathomir: [35, 22, 20, 15, 8],
  endor: [35, 22, 20, 15, 8],
  rori: [30, 22, 22, 17, 9],
  talus: [40, 22, 18, 13, 7],
  yavin4: [35, 20, 20, 16, 9],
  mustafar: [60, 25, 15],
  kashyyyk: [35, 22, 20, 15, 8],
};
export const DEFAULT_CLIMATE: readonly number[] = [50, 20, 15, 10, 5];

/** FNV-1a of the pack id: the walk's seed. */
export function seedOf(packId: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < packId.length; i++) {
    h ^= packId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** One round of an integer mix (murmur3's finaliser over the running hash and a value). */
function mixInt(h: number, v: number): number {
  h = Math.imul(h ^ (v | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h;
}

/** A float in [0, 1) from three integers (Math.imul mixing, identical in every browser). */
export function rand3(a: number, b: number, c: number): number {
  const h = mixInt(mixInt(mixInt(0x9e3779b9, a), b), c);
  return (h >>> 0) / 4294967296;
}

/** The planet's weights cut to `levels` (a shorter climate is padded with its last weight). */
export function climateFor(packId: string, levels: number): number[] {
  const id = packId.toLowerCase();
  let w: readonly number[] = DEFAULT_CLIMATE;
  for (const key of Object.keys(CLIMATES)) {
    if (id === key || id.startsWith(`${key}_`)) {
      w = CLIMATES[key];
      break;
    }
  }
  const n = Math.max(1, Math.floor(levels));
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(w[Math.min(i, w.length - 1)]);
  return out;
}

/** A level drawn from the weights by one uniform number. */
function pick(w: readonly number[], r: number): number {
  let total = 0;
  for (let i = 0; i < w.length; i++) total += w[i];
  let x = r * total;
  for (let i = 0; i < w.length; i++) {
    x -= w[i];
    if (x < 0) return i;
  }
  return w.length - 1;
}

/**
 * The scheduled level at a moment. Anchors every ANCHOR_STEPS steps are drawn from the weights.
 * Between two anchors the level takes Metropolis steps: propose +-1 with MOVE_CHANCE, accept with
 * min(1, w[new] / w[old]), and never move out of reach of the next anchor. In the last BRIDGE_STEPS
 * steps it moves one level toward that anchor. Consecutive steps never differ by more than one.
 */
export function levelAtStep(seed: number, weights: readonly number[], step: number): number {
  const a = Math.floor(step / ANCHOR_STEPS);
  let level = pick(weights, rand3(seed, a, 1));
  const next = pick(weights, rand3(seed, a + 1, 1));
  const steps = step - a * ANCHOR_STEPS;
  for (let k = 1; k <= steps; k++) {
    const s = a * ANCHOR_STEPS + k;
    const left = ANCHOR_STEPS - k;
    const dist = next - level;
    if (Math.abs(dist) > left || (k > ANCHOR_STEPS - BRIDGE_STEPS && dist !== 0)) {
      level += Math.sign(dist);
      continue;
    }
    const r = rand3(seed, s, 2);
    if (r >= MOVE_CHANCE) continue;
    const cand = level + (r < MOVE_CHANCE / 2 ? 1 : -1);
    if (cand < 0 || cand >= weights.length || Math.abs(next - cand) > left) continue;
    const wOld = weights[level];
    const accept = wOld > 0 ? Math.min(1, weights[cand] / wOld) : 1;
    if (rand3(seed, s, 3) < accept) level = cand;
  }
  return level;
}

/** How far ahead the schedule looks for its next change: two anchors, so it always finds one when there is one. */
const LOOKAHEAD_STEPS = ANCHOR_STEPS * 2;

export interface ScheduledLevel {
  level: number;
  step: number;
  /** Seconds until the level next differs, or null when it holds past the lookahead. */
  nextChangeSeconds: number | null;
}

/** The level the schedule has at a clock (seconds), the step it is in, and how long until it changes. Fills `out` when given. */
export function scheduledLevel(seed: number, weights: readonly number[], clockSeconds: number, out?: ScheduledLevel): ScheduledLevel {
  const o = out ?? { level: 0, step: 0, nextChangeSeconds: null };
  const step = Math.floor(clockSeconds / STEP_SECONDS);
  const level = levelAtStep(seed, weights, step);
  o.level = level;
  o.step = step;
  o.nextChangeSeconds = null;
  for (let s = step + 1; s <= step + LOOKAHEAD_STEPS; s++) {
    if (levelAtStep(seed, weights, s) !== level) {
      o.nextChangeSeconds = s * STEP_SECONDS - clockSeconds;
      break;
    }
  }
  return o;
}

/** 1-D value noise, smoothstepped between integer knots. */
function valueNoise(seed: number, salt: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const t = f * f * (3 - 2 * f);
  const a = rand3(seed, i, salt);
  const b = rand3(seed, i + 1, salt);
  return a + (b - a) * t;
}

export interface WindNow {
  /** Radians, 0 = +Z, turning toward +X; not wrapped, so it never jumps. */
  heading: number;
  /** 0.8..1.2 on the sky's wind scale. */
  gust: number;
}

/** Wind heading (radians, 0 = +Z, turning toward +X) and gust factor (0.8..1.2), from 1-D value noise over 1200 s and 37 s. Fills `out` when given. */
export function windAt(seed: number, clockSeconds: number, out?: WindNow): WindNow {
  const o = out ?? { heading: 0, gust: 1 };
  o.heading = valueNoise(seed, 11, clockSeconds / 1200) * Math.PI * 4;
  o.gust = 0.8 + 0.4 * valueNoise(seed, 13, clockSeconds / 37);
  return o;
}

/** The continuous level one step on: toward `target` at FORCED_LEVEL_RATE when `fast`, else LEVEL_RATE; never overshoots. */
export function stepLevel(level: number, target: number, dt: number, fast: boolean): number {
  const d = (fast ? FORCED_LEVEL_RATE : LEVEL_RATE) * Math.max(0, dt);
  if (level < target) return Math.min(target, level + d);
  if (level > target) return Math.max(target, level - d);
  return level;
}

/** Whether Life Day's areas are on: setting 1 always, 0 never, -1 by the date (LIFE_DAY_FROM to LIFE_DAY_TO, across the new year). */
export function lifeDayOn(setting: number, month: number, day: number): boolean {
  if (setting === 1) return true;
  if (setting === 0) return false;
  const v = month * 100 + day;
  const from = LIFE_DAY_FROM[0] * 100 + LIFE_DAY_FROM[1];
  const to = LIFE_DAY_TO[0] * 100 + LIFE_DAY_TO[1];
  return from <= to ? v >= from && v <= to : v >= from || v <= to;
}

/** A block's share of shadows: a clear (weather 0) row always keeps them, as before; other rows as the table says. */
export function blockShadow(weatherIndex: number, shadows: boolean): number {
  return weatherIndex === 0 || shadows ? 1 : 0;
}

/** A family's rows: block index per weather index (-1 where the table has no row). */
export interface FamilyRows {
  name: string;
  byLevel: Int16Array;
}

/** The block for a level: the row at that level, else the nearest lower row, else the lowest row there is; -1 for a family with none. */
export function rowFor(rows: FamilyRows, level: number): number {
  const b = rows.byLevel;
  const n = b.length;
  if (!n) return -1;
  const l = Math.min(n - 1, Math.max(0, Math.floor(level)));
  for (let i = l; i >= 0; i--) if (b[i] >= 0) return b[i];
  for (let i = l + 1; i < n; i++) if (b[i] >= 0) return b[i];
  return -1;
}

/** Up to four weighted blocks, kept by the caller. */
export interface MixOut {
  index: Int16Array;
  weight: Float32Array;
}

export function createMixOut(): MixOut {
  return { index: new Int16Array(4), weight: new Float32Array(4) };
}

function addMix(out: MixOut, n: number, index: number, weight: number): number {
  if (index < 0 || !(weight > 1e-6)) return n;
  for (let i = 0; i < n; i++) {
    if (out.index[i] === index) {
      out.weight[i] += weight;
      return n;
    }
  }
  out.index[n] = index;
  out.weight[n] = weight;
  return n + 1;
}

/**
 * Up to four weighted blocks: this family at floor(level) and ceil(level), and the family being left
 * (weight 1 - fade) likewise. Equal indices merge. Returns the count; the weights sum to 1.
 */
export function mixBlocks(out: MixOut, current: FamilyRows, previous: FamilyRows | null, fade: number, level: number): number {
  const lv = Math.max(0, level);
  const lo = Math.floor(lv);
  const hi = Math.ceil(lv);
  const t = lv - lo;
  const f = previous ? Math.min(1, Math.max(0, fade)) : 1;
  let n = 0;
  n = addMix(out, n, rowFor(current, lo), f * (1 - t));
  n = addMix(out, n, rowFor(current, hi), f * t);
  if (previous) {
    n = addMix(out, n, rowFor(previous, lo), (1 - f) * (1 - t));
    n = addMix(out, n, rowFor(previous, hi), (1 - f) * t);
  }
  // Rows missing on one side (a family with no row at all) leave the rest to carry the whole.
  let total = 0;
  for (let i = 0; i < n; i++) total += out.weight[i];
  if (total > 0) for (let i = 0; i < n; i++) out.weight[i] /= total;
  return n;
}

/** What a block names for the camera, as the converter writes it. */
export interface EffectChoiceSource {
  file: string | null;
  kind: WeatherKind;
  strength: number;
}
export interface EffectChoice {
  file: string;
  kind: WeatherKind;
  strength: number;
}

/** How hard each of a forced kind's effects falls, lightest first (the converter's strengths for those names). */
const FORCED_STRENGTH: Record<ForcedKind, readonly number[]> = {
  rain: [0.35, 0.6, 1],
  dust: [0.6, 0.7, 1],
  snow: [0.7, 1],
};

/** Which of a forced kind's effects a level plays (index into the pack's list), or -1 for none. */
function forcedSlot(kind: ForcedKind, level: number): number {
  if (level <= 0) return -1;
  if (kind === 'snow') return level <= 2 ? 0 : 1;
  return level === 1 ? 0 : level === 2 ? 1 : 2;
}

/**
 * The effect a block plays: its own, or with a forced kind the pack's forceable effect for the level.
 * Rain: 1 very light, 2 light, 3-4 heavy. Dust: 1 light, 2 plain, 3-4 heavy. Snow: 1-2 Life Day, 3-4 storm.
 * Level 0 forced plays nothing. Fills `out` when given.
 */
export function effectFor(
  block: { cameraEffect?: EffectChoiceSource | null },
  forced: ForcedKind | null,
  level: number,
  force: Readonly<Record<ForcedKind, readonly (string | null)[]>> | null | undefined,
  out?: EffectChoice,
): EffectChoice | null {
  if (!forced) {
    const e = block.cameraEffect;
    if (!e || !e.file) return null;
    const o = out ?? { file: '', kind: 'other', strength: 0 };
    o.file = e.file;
    o.kind = e.kind;
    o.strength = e.strength;
    return o;
  }
  const slot = forcedSlot(forced, Math.round(level));
  if (slot < 0) return null;
  const file = force?.[forced]?.[slot] ?? null;
  if (!file) return null;
  const o = out ?? { file: '', kind: 'other', strength: 0 };
  o.file = file;
  o.kind = forced;
  o.strength = FORCED_STRENGTH[forced][slot] ?? 1;
  return o;
}

/**
 * The heaviest and the next heaviest of the first `n` weights, as indices into out[0] and out[1]
 * (-1 for none); a tie keeps the earlier. What the sky's dome and cloud sheets draw of the mix.
 */
export function heaviestTwo(w: ArrayLike<number>, n: number, out: Int32Array): Int32Array {
  let a = -1;
  let b = -1;
  for (let k = 0; k < n; k++) {
    if (a < 0 || w[k] > w[a]) {
      b = a;
      a = k;
    } else if (b < 0 || w[k] > w[b]) b = k;
  }
  out[0] = a;
  out[1] = b;
  return out;
}

/**
 * One frame of a cloud image's drift, integrated and wrapped to [0, 1). A sheet samples its image at
 * xz / repeat + scroll, so a feature is drawn at repeat * (u - scroll) and moves against the scroll:
 * taking the heading off (0 = +Z, turning toward +X) moves the clouds toward it, the way the rain
 * leans and the dust blows.
 */
export function driftScroll(s: { x: number; y: number }, heading: number, perSecond: number, dt: number): void {
  s.x -= Math.sin(heading) * perSecond * dt;
  s.y -= Math.cos(heading) * perSecond * dt;
  s.x -= Math.floor(s.x);
  s.y -= Math.floor(s.y);
}

export interface WetState {
  wetness: number;
  puddles: number;
  snowCover: number;
}
/** Per second at full rain, toward the target. */
export const WET_RISE = 0.08;
/** Per second in daylight, calm. */
export const DRY_RATE = 1 / 300;
export const PUDDLE_RISE = 0.03;
export const PUDDLE_DRAIN = 1 / 420;
/** Per second at full snow. */
export const SNOW_RISE = 0.01;
export const SNOW_MELT = 1 / 600;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** One step. rain and snow are 0..1 falling now; daylight 0..1; windSpeed m/s. */
export function stepWet(s: WetState, dt: number, rain: number, snow: number, daylight: number, windSpeed: number): void {
  const d = Math.max(0, dt);
  const target = rain > 0 ? Math.min(1, 0.35 + 0.65 * rain) : 0;
  if (rain > 0 && s.wetness < target) s.wetness += WET_RISE * rain * (target - s.wetness) * d;
  else {
    const dry = DRY_RATE * (0.35 + 0.65 * clamp01(daylight)) * (1 + Math.min(Math.max(0, windSpeed), 10) / 20) * d;
    // Raining lighter than it has been: it dries back to what this rain keeps wet, no further.
    s.wetness = Math.max(rain > 0 ? Math.min(s.wetness, target) : 0, s.wetness - dry);
  }
  const puddleTarget = rain > 0 ? smooth(0.55, 0.95, s.wetness) : 0;
  if (s.puddles < puddleTarget) s.puddles = Math.min(puddleTarget, s.puddles + PUDDLE_RISE * d);
  else if (s.puddles > puddleTarget) s.puddles = Math.max(puddleTarget, s.puddles - PUDDLE_DRAIN * d);
  if (snow > 0) s.snowCover += SNOW_RISE * snow * d;
  else s.snowCover -= SNOW_MELT * (0.5 + 0.5 * clamp01(daylight)) * d;
  s.wetness = clamp01(s.wetness);
  s.puddles = clamp01(s.puddles);
  s.snowCover = clamp01(s.snowCover);
}

/** How far back arrival replays the schedule, and the step it replays in. */
const SEED_SECONDS = 1200;
const SEED_STEP = 30;

/** Wetness on arrival: replay the last 20 minutes of the schedule in 30 s steps (each integrated a second at a time, in half daylight and calm). */
export function seedWet(out: WetState, seed: number, weights: readonly number[], clockSeconds: number, rainAt: (level: number) => number, snowAt: (level: number) => number): void {
  out.wetness = 0;
  out.puddles = 0;
  out.snowCover = 0;
  for (let t = clockSeconds - SEED_SECONDS; t < clockSeconds; t += SEED_STEP) {
    const level = levelAtStep(seed, weights, Math.floor(t / STEP_SECONDS));
    const rain = rainAt(level);
    const snow = snowAt(level);
    for (let k = 0; k < SEED_STEP; k++) stepWet(out, 1, rain, snow, 0.5, 0);
  }
}
