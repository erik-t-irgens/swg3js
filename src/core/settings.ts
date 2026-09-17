// The player's settings, kept in this browser: how the mouse feels and what the graphics cost.
// Every value has a default, a range and a live effect; the menu shows them, the game applies them.
// The effects' own keys live in `fxRegistry.ts`, which the menu and a plain node test read as well.
import { FX_DEFAULTS, type FxSettings } from './fxRegistry.ts';

export interface Settings extends FxSettings {
  /** Mouse look speed, 1 is the game's own. */
  sensitivity: number;
  invertY: boolean;
  /** Field of view in degrees, upright. */
  fov: number;
  /** Rendering resolution over the screen's, 0.5 to 2. */
  renderScale: number;
  shadows: boolean;
  /** Shadow map edge per cascade: 1024, 2048 or 4096. */
  shadowMapSize: number;
  /** How far the cascades reach, metres. */
  shadowDistance: number;
  /** Shadow blur in map texels, 1 crisp to 3 soft. */
  shadowSoftness: number;
  /** Placed objects this big (radius, metres) and up cast shadows. */
  shadowCasterRadius: number;
  /** Multiplier over the planet's own fog density. */
  fog: number;
  /** How strongly the normal maps bend the lighting, 0 flat to 2 doubled. */
  normalStrength: number;
  /** Tone mapping exposure. */
  exposure: number;
  /** How far placed objects (buildings, props) load, as a scale of the game's ranges. */
  objectReach: number;
  /** Detailed ground chunks around the player, in chunks each way. */
  terrainRadius: number;
  /** Coarse far tiles each way. */
  farRadius: number;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  invertY: false,
  fov: 60,
  renderScale: Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2),
  shadows: true,
  shadowMapSize: 2048,
  shadowDistance: 320,
  shadowSoftness: 1.4,
  shadowCasterRadius: 1.2,
  fog: 1,
  normalStrength: 1,
  exposure: 1,
  objectReach: 1,
  terrainRadius: 6,
  farRadius: 6,
  ...FX_DEFAULTS,
};

/**
 * Keys renamed when the effects got a registry of their own: a value kept under an old name moves
 * to the new one, so a player who had turned the speed blur off still has it off. Old names are
 * dropped here and never written again, since saving only walks the live object.
 */
export function migrateSettings(saved: Record<string, unknown>): Record<string, unknown> {
  const out = { ...saved };
  if (typeof out.motionBlur === 'number') {
    out.motionBlurStrength ??= out.motionBlur;
    delete out.motionBlur;
  }
  if (typeof out.speedBlur === 'boolean') {
    out.motionBlur ??= out.speedBlur;
    delete out.speedBlur;
  }
  return out;
}

const KEY = 'swg.settings';

export function loadSettings(): Settings {
  const out = { ...DEFAULT_SETTINGS };
  try {
    const saved = migrateSettings(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>);
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      const v = saved[k];
      if (typeof v === typeof DEFAULT_SETTINGS[k]) (out as unknown as Record<string, unknown>)[k] = v;
    }
  } catch {
    /* none saved, or not ours */
  }
  return out;
}

export function saveSettings(s: Settings): void {
  try {
    const changed = Object.fromEntries(Object.entries(s).filter(([k, v]) => v !== DEFAULT_SETTINGS[k as keyof Settings]));
    if (Object.keys(changed).length) localStorage.setItem(KEY, JSON.stringify(changed));
    else localStorage.removeItem(KEY);
  } catch {
    /* no storage: the settings last the session */
  }
}
