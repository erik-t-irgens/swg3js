// The volumetrics' settings: the keys, the ranges the page and the console share, the presets, and the one record the
// frame reads (`VolTune`), written from the settings whenever one of them moves (`volQualityFrom`, the `applyFlora`
// shape) so nothing of the pass ever reads the 150-key settings object on a frame.
//
// **A preset is worked out, never stored** (the design's decision 4): `presetOf` answers the name whose every
// quality key matches, else Custom, so it cannot drift from its dials and an old settings file needs nothing. A
// preset writes the quality keys and nothing else, never a switch (what is drawn) and never an art dial (taste).
// It writes and compares only the keys whose knobs this build has (no layer count and no smoke or liquid detail yet),
// and a file saved before a wave added a quality key takes that key from the preset its other keys hold
// (`volFillQuality`), so a wave that adds a quality key never turns an existing choice into Custom.
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
  'volSand',
  'volSandDetail',
  'volPrints',
  'volPrintDetail',
  'volArtSand',
  'volArtPrints',
  'volArtShade',
  'volFromFeet',
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
  // The second wave's: the carried offsets' grid a multiple of the air's (×4 is 37.5 cm at the default air detail), the
  // dents' texels over their 128 m square (2048 is 6.25 cm; 4096 is 67 MB of float32), and the three art dials.
  volSandDetail: { options: [2, 3, 4, 6] as readonly number[] },
  volPrintDetail: { options: [1024, 2048, 4096] as readonly number[] },
  volArtSand: { min: 0, max: 1, step: 0.05 },
  volArtPrints: { min: 0, max: 1.5, step: 0.05 },
  volArtShade: { min: 0, max: 1, step: 0.05 },
} as const;

/** The quality keys a preset writes, in this build. */
export const VOL_QUALITY_KEYS = ['volAirDetail', 'volAirSolve', 'volAirRate', 'volDustDetail', 'volLightDetail', 'volLightSteps', 'volSandDetail', 'volPrintDetail', 'airVolumeResolution', 'airVolumeSteps', 'airVolumeHistory', 'airVolumeShadows'] as const satisfies readonly (keyof Settings)[];

/**
 * The quality keys a wave added after the first: a settings file saved before its wave never wrote them, so with
 * nothing done it would load at the default (High's) and an earlier Low or Ultra would read Custom. `volFillQuality`
 * gives such a file the preset its other quality keys hold, at load.
 */
export const VOL_QUALITY_LATER: readonly VolQualityKey[] = ['volSandDetail', 'volPrintDetail'];

/** The wave each later quality key came in, against the wave a settings file says it was saved in (`VOL_QUALITY_STAMP`). */
export const VOL_QUALITY_ADDED: Readonly<Partial<Record<VolQualityKey, number>>> = { volSandDetail: 2, volPrintDetail: 2 };

/**
 * The key a saved settings file carries the wave it was written in under, and this build's wave. The file keeps only
 * what differs from the defaults, so a key it does not carry is either never written (a file from before its wave) or
 * written at the default: only the stamp tells them apart, and a key of a wave the file already knew is never filled.
 */
export const VOL_QUALITY_STAMP = 'volQualityWave';
export const VOL_QUALITY_WAVE = 2;

/**
 * The stamp into a settings file about to be saved (what differs from the defaults), only when it holds a quality key:
 * a file with none loads every quality key at High's, which is the defaults' already, so it needs no stamp and stays
 * exactly what it was before the pass.
 */
export function volStampQuality(changed: Record<string, unknown>): void {
  for (const k of VOL_QUALITY_KEYS) {
    if (k in changed) {
      changed[VOL_QUALITY_STAMP] = VOL_QUALITY_WAVE;
      return;
    }
  }
}

export type VolQualityKey = (typeof VOL_QUALITY_KEYS)[number];
export type VolPresetName = 'low' | 'medium' | 'high' | 'ultra';
export const VOL_PRESET_NAMES: readonly VolPresetName[] = ['low', 'medium', 'high', 'ultra'];

/** What each preset writes [ours, the design's §3.4]; High is the default and the demos' own. */
export const VOL_PRESETS: Readonly<Record<VolPresetName, Readonly<Record<VolQualityKey, number | boolean>>>> = {
  low: { volAirDetail: 64, volAirSolve: 10, volAirRate: 30, volDustDetail: 3, volLightDetail: 1, volLightSteps: 16, volSandDetail: 3, volPrintDetail: 1024, airVolumeResolution: 0.25, airVolumeSteps: 8, airVolumeHistory: true, airVolumeShadows: false },
  medium: { volAirDetail: 96, volAirSolve: 14, volAirRate: 60, volDustDetail: 4, volLightDetail: 2, volLightSteps: 20, volSandDetail: 4, volPrintDetail: 2048, airVolumeResolution: 0.5, airVolumeSteps: 12, airVolumeHistory: true, airVolumeShadows: true },
  high: { volAirDetail: 128, volAirSolve: 20, volAirRate: 60, volDustDetail: 4, volLightDetail: 2, volLightSteps: 26, volSandDetail: 4, volPrintDetail: 2048, airVolumeResolution: 0.5, airVolumeSteps: 16, airVolumeHistory: true, airVolumeShadows: true },
  ultra: { volAirDetail: 192, volAirSolve: 28, volAirRate: 60, volDustDetail: 4, volLightDetail: 2, volLightSteps: 32, volSandDetail: 6, volPrintDetail: 2048, airVolumeResolution: 1, airVolumeSteps: 24, airVolumeHistory: true, airVolumeShadows: true },
};

/** The preset whose every quality key in `keys` the settings hold, or 'custom'. */
export function presetOf(s: Pick<Settings, VolQualityKey>, keys: readonly VolQualityKey[] = VOL_QUALITY_KEYS): VolPresetName | 'custom' {
  for (const name of VOL_PRESET_NAMES) {
    const p = VOL_PRESETS[name];
    let all = true;
    for (const k of keys) {
      if (s[k] !== p[k]) {
        all = false;
        break;
      }
    }
    if (all) return name;
  }
  return 'custom';
}

/**
 * A settings file read from storage, the defaults laid under it: each quality key a wave after the file's own added
 * (`VOL_QUALITY_ADDED` against the file's `VOL_QUALITY_STAMP`, a file with none being the first wave's) takes the value
 * of the preset the file's other quality keys hold (none where they hold no preset, or none at all, which is the
 * defaults' High and so the defaults' value). So a Low chosen in the first wave still reads Low, and a key a later file
 * left out because it was at its default stays at it. `merged` is the settings the file loads to; written in place.
 * Answers how many keys it filled.
 */
export function volFillQuality(saved: Readonly<Record<string, unknown>>, merged: Settings): number {
  const stamp = saved[VOL_QUALITY_STAMP];
  const wave = typeof stamp === 'number' && Number.isFinite(stamp) ? stamp : 1;
  const earlier = VOL_QUALITY_KEYS.filter((k) => !VOL_QUALITY_LATER.includes(k));
  const name = presetOf(merged, earlier);
  if (name === 'custom') return 0;
  let n = 0;
  for (const k of VOL_QUALITY_LATER) {
    if (k in saved || (VOL_QUALITY_ADDED[k] ?? 1) <= wave) continue;
    (merged as unknown as Record<string, unknown>)[k] = VOL_PRESETS[name][k];
    n++;
  }
  return n;
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
  /** The ground's carried offsets (the sand drifting under a jet) and their grid over the air's. */
  sand: boolean;
  sandDetail: number;
  /** The dents (prints, ruts, pits, craters) and their texels over the 128 m square. */
  prints: boolean;
  printDetail: number;
  /** How much of each is laid over the ground's own art: the offsets' reach, the dents' depth, the dust's shadow. */
  artSand: number;
  artPrints: number;
  artShade: number;
  /** A footstep on ground that keeps marks presses a dent rather than laying today's decal. */
  fromFeet: boolean;
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
    sand: true,
    sandDetail: 4,
    prints: true,
    printDetail: 2048,
    // Ones a fraction may be written into start as a fraction, so each is a double from its first write.
    artSand: 0.5,
    artPrints: 0.5,
    artShade: 0.5,
    fromFeet: true,
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
  out.sand = b('volSand');
  out.sandDetail = snap(n('volSandDetail'), R.volSandDetail.options, 4);
  out.prints = b('volPrints');
  out.printDetail = snap(n('volPrintDetail'), R.volPrintDetail.options, 2048);
  // An art dial past the page's end from the console is held only to what cannot break anything (no negative depth).
  out.artSand = over.volArtSand !== undefined ? Math.max(0, Math.min(4, n('volArtSand'))) : clampRange(n('volArtSand'), R.volArtSand, 1);
  out.artPrints = over.volArtPrints !== undefined ? Math.max(0, Math.min(4, n('volArtPrints'))) : clampRange(n('volArtPrints'), R.volArtPrints, 1);
  out.artShade = over.volArtShade !== undefined ? Math.max(0, Math.min(1, n('volArtShade'))) : clampRange(n('volArtShade'), R.volArtShade, 1);
  out.fromFeet = b('volFromFeet');
  return out;
}

/**
 * How each setting takes effect (the design's §3.1): U a uniform, C a gate on the CPU, T a target made at a new size, M
 * which of two materials already compiled a mesh wears, W the master, which turned on in play warms its programs off the
 * frame with the old picture drawn meanwhile and changes over when every one has linked. Nothing here builds a program
 * on a live frame.
 */
export const VOL_APPLY_CLASS: Readonly<Record<VolKey, 'W' | 'C' | 'T' | 'U' | 'M'>> = {
  volumetrics: 'W',
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
  volSand: 'M',
  volSandDetail: 'T',
  volPrints: 'M',
  volPrintDetail: 'T',
  volArtSand: 'U',
  volArtPrints: 'U',
  volArtShade: 'U',
  volFromFeet: 'C',
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
    const wantsBool =
      key === 'volumetrics' ||
      key === 'airVolume' ||
      key === 'airVolumeHistory' ||
      key === 'airVolumeShadows' ||
      key === 'volAir' ||
      key === 'volDust' ||
      key === 'volKickUp' ||
      key === 'volLight' ||
      key === 'volFromEngines' ||
      key === 'volFromForce' ||
      key === 'volFromBlasts' ||
      key === 'volSand' ||
      key === 'volPrints' ||
      key === 'volFromFeet';
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
  // Velocity pair RG16F (4 bytes), pressure pair R16F (2), divergence R16F, obstacles RG16F (red the walls, green the
  // walls and a compound's rooms: 4).
  let bytes = cells * (4 * 2 + 2 * 2 + 2 + 4);
  // The rasters: height R32F, response RGBA8, colour RGBA8.
  bytes += cells * (4 + 4 + 4);
  // The dust pair, RGBA32F.
  const d = n * t.dustDetail;
  bytes += d * d * 16 * 2;
  // The light, R8.
  const l = n * t.lightDetail;
  bytes += l * l;
  // The ground's carried offsets, an RGBA32F pair (16 bytes a texel: float32, since a half float stalls a drift), and the
  // dents, one R32F target over their square (the second wave's): each held only while its switch is on, a texel across
  // otherwise (`AirField.ensureTargets`), so each is counted only then.
  if (t.sand) {
    const s = n * t.sandDetail;
    bytes += s * s * 16 * 2;
  }
  if (t.prints) bytes += t.printDetail * t.printDetail * 4;
  // The volume's march and its two histories, RGBA16F at its share of the screen.
  if (t.volume) {
    const vw = Math.max(1, Math.round(width * t.volumeResolution));
    const vh = Math.max(1, Math.round(height * t.volumeResolution));
    bytes += vw * vh * 8 * 3;
  }
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}
