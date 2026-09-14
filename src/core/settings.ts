// The player's settings, kept in this browser: how the mouse feels and what the graphics cost.
// Every value has a default, a range and a live effect; the menu shows them, the game applies them.

export interface Settings {
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
  exposure: 1,
  objectReach: 1,
  terrainRadius: 6,
  farRadius: 6,
};

const KEY = 'swg.settings';

export function loadSettings(): Settings {
  const out = { ...DEFAULT_SETTINGS };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
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
