// The volumetrics' settings: the keys, the ranges the page and the console share, the presets, and the one record the
// frame reads (`VolTune`), written from the settings whenever one of them moves (`volQualityFrom`, the `applyFlora`
// shape) so nothing of the pass ever reads the 150-key settings object on a frame.
//
// **A preset is worked out, never stored** (the design's decision 4): `presetOf` answers the name whose every
// quality key matches, else Custom, so it cannot drift from its dials and an old settings file needs nothing. A
// preset writes the quality keys and nothing else, never a switch (what is drawn) and never an art dial (taste).
// It writes and compares only the keys whose knobs this build has (the first wave's: no layer count and no smoke,
// sand, print or liquid detail), so a wave that adds a quality key never turns an existing choice into Custom.
//
// Pure: types only from the settings, so the node tests run exactly what the page and the console run.
import type { Settings } from '../../core/settings.ts';

/** The volumetrics' scene keys (not read by the effects chain): the page's own rows. */
export const VOL_SCENE_KEYS = [
  'volAir',
  'volAirDetail',
  'volAirSolve',
  'volAirRate',
  'volDust',
  'volDustDetail',
  'volKickUp',
  'volLight',
  'volLightDetail',
  'volLightSteps',
  'volStormThin',
  'volFromEngines',
  'volFromForce',
  'volFromBlasts',
] as const satisfies readonly (keyof Settings)[];

/** The volumetrics' keys the effects chain reads (`fxRegistry.ts`): the master and the volume's own. */
export const VOL_FX_KEYS = ['volumetrics', 'airVolume', 'airVolumeAmount', 'airVolumeResolution', 'airVolumeSteps', 'airVolumeHistory', 'airVolumeShadows'] as const satisfies readonly (keyof Settings)[];

/** Every key the pass speaks for. */
export const VOL_KEYS: readonly (keyof Settings)[] = [...VOL_FX_KEYS, ...VOL_SCENE_KEYS];

export type VolKey = (typeof VOL_SCENE_KEYS)[number] | (typeof VOL_FX_KEYS)[number];

/** Whether a settings key is one of the volumetrics'. */
export function isVolKey(key: string): key is VolKey {
  return (VOL_KEYS as readonly string[]).includes(key);
}

/**
 * The ends the page and the console share. A select's options, or a range's ends and step. Every number here is
 * ours; the air's detail is cells over the 192 m square (3, 2, 1.5, 1.2 or 1.0 m a cell), and a field's detail a
 * whole multiple of the air's, so a scroll of the window is a whole number of texels for every field.
 */
export const VOL_RANGES = {
  volAirDetail: { options: [64, 96, 128, 160, 192] as readonly number[] },
  volAirSolve: { min: 8, max: 40, step: 1 },
  volAirRate: { options: [30, 60] as readonly number[] },
  volDustDetail: { options: [2, 3, 4, 6] as readonly number[] },
  volLightDetail: { options: [1, 2, 3] as readonly number[] },
  volLightSteps: { min: 12, max: 40, step: 2 },
  volStormThin: { min: 0, max: 1, step: 0.05 },
  airVolumeResolution: { options: [0.25, 0.5, 1] as readonly number[] },
  airVolumeSteps: { min: 6, max: 48, step: 2 },
  airVolumeAmount: { min: 0, max: 1.5, step: 0.05 },
} as const;

/** The quality keys a preset writes, in this build. */
export const VOL_QUALITY_KEYS = ['volAirDetail', 'volAirSolve', 'volAirRate', 'volDustDetail', 'volLightDetail', 'volLightSteps', 'airVolumeResolution', 'airVolumeSteps', 'airVolumeHistory', 'airVolumeShadows'] as const satisfies readonly (keyof Settings)[];

export type VolQualityKey = (typeof VOL_QUALITY_KEYS)[number];
export type VolPresetName = 'low' | 'medium' | 'high' | 'ultra';
export const VOL_PRESET_NAMES: readonly VolPresetName[] = ['low', 'medium', 'high', 'ultra'];

/** What each preset writes [ours, the design's §3.4]; High is the default and the demos' own. */
export const VOL_PRESETS: Readonly<Record<VolPresetName, Readonly<Record<VolQualityKey, number | boolean>>>> = {
  low: { volAirDetail: 64, volAirSolve: 10, volAirRate: 30, volDustDetail: 3, volLightDetail: 1, volLightSteps: 16, airVolumeResolution: 0.25, airVolumeSteps: 8, airVolumeHistory: true, airVolumeShadows: false },
  medium: { volAirDetail: 96, volAirSolve: 14, volAirRate: 60, volDustDetail: 4, volLightDetail: 2, volLightSteps: 20, airVolumeResolution: 0.5, airVolumeSteps: 12, airVolumeHistory: true, airVolumeShadows: true },
  high: { volAirDetail: 128, volAirSolve: 20, volAirRate: 60, volDustDetail: 4, volLightDetail: 2, volLightSteps: 26, airVolumeResolution: 0.5, airVolumeSteps: 16, airVolumeHistory: true, airVolumeShadows: true },
  ultra: { volAirDetail: 192, volAirSolve: 28, volAirRate: 60, volDustDetail: 4, volLightDetail: 2, volLightSteps: 32, airVolumeResolution: 1, airVolumeSteps: 24, airVolumeHistory: true, airVolumeShadows: true },
};

/** The preset whose every quality key the settings hold, or 'custom'. */
export function presetOf(s: Pick<Settings, VolQualityKey>): VolPresetName | 'custom' {
  for (const name of VOL_PRESET_NAMES) {
    const p = VOL_PRESETS[name];
    let all = true;
    for (const k of VOL_QUALITY_KEYS) {
      if (s[k] !== p[k]) {
        all = false;
        break;
      }
    }
    if (all) return name;
  }
  return 'custom';
}

/** The words a preset is shown under. */
export const VOL_PRESET_LABELS: Readonly<Record<VolPresetName | 'custom', string>> = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra', custom: 'Custom' };

/**
 * What the frame reads, written whenever a setting moves: one small record kept for the session (its fields take
 * their first values here, so every number field is a double from the start). Nothing of the pass reads `Settings`
 * on a frame.
 */
export interface VolTune {
  /** The master. */
  on: boolean;
  effects: boolean;
  air: boolean;
  airDetail: number;
  solve: number;
  rate: number;
  dust: boolean;
  dustDetail: number;
  kickUp: boolean;
  light: boolean;
  lightDetail: number;
  lightSteps: number;
  stormThin: number;
  fromEngines: boolean;
  fromForce: boolean;
  fromBlasts: boolean;
  volume: boolean;
  volumeAmount: number;
  volumeResolution: number;
  volumeSteps: number;
  volumeHistory: boolean;
  volumeShadows: boolean;
}

export function newVolTune(): VolTune {
  return {
    on: false,
    effects: true,
    air: true,
    airDetail: 128,
    solve: 20,
    rate: 60,
    dust: true,
    dustDetail: 4,
    kickUp: true,
    light: true,
    lightDetail: 2,
    lightSteps: 26,
    stormThin: 0.5,
    fromEngines: true,
    fromForce: true,
    fromBlasts: true,
    volume: true,
    volumeAmount: 1,
    volumeResolution: 0.5,
    volumeSteps: 16,
    volumeHistory: true,
    volumeShadows: true,
  };
}

/** The session's one record: written by the game from the settings (`volQualityFrom`) whenever one moves, read by the frame. */
export const VOL_TUNE: VolTune = newVolTune();

const snap = (v: number, options: readonly number[], fallback: number): number => (options.includes(v) ? v : fallback);
const clampRange = (v: number, r: { min: number; max: number }, fallback: number): number => (Number.isFinite(v) ? Math.min(r.max, Math.max(r.min, v)) : fallback);

/**
 * The settings into the kept record, held to the page's ends (a detail not on the page's list takes the High
 * preset's, so a hand-edited file can never size a target the presets never made). Returns the record it wrote.
 * `over` is a value the console put past a page's end, applied live and never kept in the settings.
 */
export function volQualityFrom(s: Pick<Settings, VolKey | 'effects'>, out: VolTune, over: Partial<Record<VolKey, number | boolean>> = {}): VolTune {
  const R = VOL_RANGES;
  const n = (k: VolKey): number => (typeof over[k] === 'number' ? (over[k] as number) : (s[k] as number));
  const b = (k: VolKey): boolean => (typeof over[k] === 'boolean' ? (over[k] as boolean) : (s[k] as boolean));
  out.on = b('volumetrics');
  out.effects = s.effects;
  out.air = b('volAir');
  out.airDetail = snap(n('volAirDetail'), R.volAirDetail.options, 128);
  out.solve = Math.round(over.volAirSolve !== undefined ? Math.max(1, Math.min(80, n('volAirSolve'))) : clampRange(n('volAirSolve'), R.volAirSolve, 20));
  out.rate = snap(n('volAirRate'), R.volAirRate.options, 60);
  out.dust = b('volDust');
  out.dustDetail = snap(n('volDustDetail'), R.volDustDetail.options, 4);
  out.kickUp = b('volKickUp');
  out.light = b('volLight');
  out.lightDetail = snap(n('volLightDetail'), R.volLightDetail.options, 2);
  out.lightSteps = Math.round(over.volLightSteps !== undefined ? Math.max(1, Math.min(48, n('volLightSteps'))) : clampRange(n('volLightSteps'), R.volLightSteps, 26));
  out.stormThin = clampRange(n('volStormThin'), R.volStormThin, 0.5);
  out.fromEngines = b('volFromEngines');
  out.fromForce = b('volFromForce');
  out.fromBlasts = b('volFromBlasts');
  out.volume = b('airVolume');
  out.volumeAmount = over.airVolumeAmount !== undefined ? Math.max(0, Math.min(4, n('airVolumeAmount'))) : clampRange(n('airVolumeAmount'), R.airVolumeAmount, 1);
  out.volumeResolution = snap(n('airVolumeResolution'), R.airVolumeResolution.options, 0.5);
  out.volumeSteps = Math.round(over.airVolumeSteps !== undefined ? Math.max(1, Math.min(48, n('airVolumeSteps'))) : clampRange(n('airVolumeSteps'), R.airVolumeSteps, 16));
  out.volumeHistory = b('airVolumeHistory');
  out.volumeShadows = b('airVolumeShadows');
  return out;
}

/**
 * How each setting takes effect (the design's §3.1): U a uniform, C a gate on the CPU, T a target made at a new size,
 * A the master, which in this wave waits for the next arrival. Nothing here builds a program in play.
 */
export const VOL_APPLY_CLASS: Readonly<Record<VolKey, 'A' | 'C' | 'T' | 'U'>> = {
  volumetrics: 'A',
  airVolume: 'C',
  airVolumeAmount: 'U',
  airVolumeResolution: 'T',
  airVolumeSteps: 'U',
  airVolumeHistory: 'C',
  airVolumeShadows: 'U',
  volAir: 'C',
  volAirDetail: 'T',
  volAirSolve: 'C',
  volAirRate: 'C',
  volDust: 'C',
  volDustDetail: 'T',
  volKickUp: 'C',
  volLight: 'C',
  volLightDetail: 'T',
  volLightSteps: 'U',
  volStormThin: 'U',
  volFromEngines: 'C',
  volFromForce: 'C',
  volFromBlasts: 'C',
};

/** One console field as a setting: the key, its value, and whether the page's control can hold it. */
export interface VolConsoleSetting {
  key: VolKey;
  value: number | boolean;
  inRange: boolean;
}

/** Whether a value is one the page can show for a key. */
function onPage(key: VolKey, v: number | boolean): boolean {
  const r = (VOL_RANGES as Record<string, { options?: readonly number[]; min?: number; max?: number }>)[key];
  if (typeof v === 'boolean') return true;
  if (!r) return false;
  if (r.options) return r.options.includes(v);
  return v >= (r.min as number) && v <= (r.max as number);
}

/**
 * `__debug.volumetrics(o)`'s fields as settings: any of the pass's keys by its own name, `on` for the master, and
 * `preset` for a preset's every quality key (the keys the call names as well win over the preset's). A field that is
 * not a usable value (a word where a number goes, NaN, a switch given a number) is dropped. Each value is marked by
 * whether the page can hold it; one past it is applied live and the setting left alone.
 */
export function volConsoleToSettings(o: Record<string, unknown>): VolConsoleSetting[] {
  const out = new Map<VolKey, VolConsoleSetting>();
  const preset = o.preset;
  if (typeof preset === 'string' && (VOL_PRESET_NAMES as readonly string[]).includes(preset)) {
    const p = VOL_PRESETS[preset as VolPresetName];
    for (const k of VOL_QUALITY_KEYS) out.set(k, { key: k, value: p[k], inRange: true });
  }
  if (typeof o.on === 'boolean') out.set('volumetrics', { key: 'volumetrics', value: o.on, inRange: true });
  for (const key of VOL_KEYS as readonly VolKey[]) {
    if (!(key in o)) continue;
    const v = o[key];
    const wantsBool = key === 'volumetrics' || key === 'airVolume' || key === 'airVolumeHistory' || key === 'airVolumeShadows' || key === 'volAir' || key === 'volDust' || key === 'volKickUp' || key === 'volLight' || key === 'volFromEngines' || key === 'volFromForce' || key === 'volFromBlasts';
    if (wantsBool) {
      if (typeof v === 'boolean') out.set(key, { key, value: v, inRange: true });
      continue;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    out.set(key, { key, value: v, inRange: onPage(key, v) });
  }
  return [...out.values()];
}

/**
 * The fields' memory on the card at these settings and this screen, in megabytes (the design's §2.3 formats),
 * for the console: the air's atlas and its scratch, the rasters, the dust pair, the light, and the volume's three
 * targets at its share of the screen. Arithmetic, never measured.
 */
export function volMemoryMB(t: VolTune, width: number, height: number): number {
  const n = t.airDetail;
  const cells = n * n;
  // Velocity pair RG16F (4 bytes), pressure pair R16F (2), divergence R16F, obstacles R16F.
  let bytes = cells * (4 * 2 + 2 * 2 + 2 + 2);
  // The rasters: height R32F, response RGBA8, colour RGBA8.
  bytes += cells * (4 + 4 + 4);
  // The dust pair, RGBA32F.
  const d = n * t.dustDetail;
  bytes += d * d * 16 * 2;
  // The light, R8.
  const l = n * t.lightDetail;
  bytes += l * l;
  // The volume's march and its two histories, RGBA16F at its share of the screen.
  if (t.volume) {
    const vw = Math.max(1, Math.round(width * t.volumeResolution));
    const vh = Math.max(1, Math.round(height * t.volumeResolution));
    bytes += vw * vh * 8 * 3;
  }
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}
