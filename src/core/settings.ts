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
  /** How many creatures and NPCs the spawner may have out at once (the planet's own wildlife is not counted). */
  mobileCap: number;
  /** Metres past which a creature or NPC holds its pose until it comes nearer. */
  mobileAnimRange: number;
  // Interactive water: a height field forced by an overhead render of whatever is in the water,
  // so a ripple takes the shape of the thing that made it. Scene content, not an effect: it works
  // with the effects off, and its cost does not depend on how much water is on screen.
  waterRipples: boolean;
  /** Grid a side: 256, 512, 768 or 1024. Reach grows with it, so the texel shrinks either way. */
  waterRippleDetail: number;
  /** How tall ripples stand, 1 the tuned height. */
  waterRippleHeight: number;
  /** How long they linger, 0 a dead pond to 1 a bathtub. */
  waterRipplePersistence: number;

  // The weather: scene content, not an effect, so these work with the effects off.
  /** Rain, dust storms and snow as the planet's environment rows have them. */
  weather: boolean;
  /** How many sheets, clouds and flakes fall: 1 as the game has them (0.25 .. 1.5). */
  weatherDensity: number;
  /** How solid the falling rain looks: 1 is the game's own sheets, lower lets more through (0.1 .. 1). */
  rainOpacity: number;
  /** Rain wets and glosses surfaces and leaves puddles; snow settles. */
  wetSurfaces: boolean;
  /** Storm rows that turn shadows off fade them out; clear rows always keep them. */
  weatherShadows: boolean;
  /** -1 the schedule; 0..4 hold that level of the area's own rows. */
  weatherForce: number;
  /** 0 the area's own effect; 1 rain, 2 dust storm, 3 snow in its place. */
  weatherKind: number;
  /** Life Day's areas: -1 in season (15 December to 5 January), 1 always, 0 never. */
  lifeDay: number;
  // Sound. One slider for everything and one per layer, so a bed can be turned down without
  // losing the footsteps; the switches are the things a player may simply not want.
  /** Everything, 0 to 1. */
  soundMaster: number;
  /** The area beds, the room beds and the world's placed emitters. */
  soundAmbience: number;
  /** Weapons, explosions, machines and items. */
  soundEffects: number;
  /** Creatures, people and droids, and the emote voices. */
  soundVoices: number;
  /** Feet, on any surface. */
  soundFootsteps: number;
  /** Speeders, ships and their engines. */
  soundVehicles: number;
  /** The panels' own clicks. */
  soundInterface: number;
  /** Music; nothing plays on it until the music pass, so the menu does not show it yet. */
  soundMusic: number;
  /** Head-related panning, which places a sound around the head rather than across the speakers. */
  soundHeadphones: boolean;
  /** A little echo in rooms and halls. The amounts are ours; the client's are not in the archives. */
  soundRoomEcho: boolean;
  /** Keep playing while the tab is in the background. */
  soundInBackground: boolean;
  /** Which lightsaber sounds: 'jka' Jedi Academy's, 'swg' the game's own. */
  soundSabers: string;
  /** A nebula's lightning takes shields and armour off a ship it strikes; off, a strike only flashes. */
  nebulaLightningDamage: boolean;
  // The screen's own display. Every number here is ours -- the game's own interface is not read for
  // any of it -- and every one of them is invented; they are kept together so they can be judged
  // together, and `__debug.hud({ ... })` moves the first two live without opening the menu.
  /** How large the display is drawn, 0.75 small to 1.5 large; 1 is what it was designed at. */
  hudScale: number;
  /** Device pixels per screen pixel on the overlay: 1 cheap, 2 sharper hairlines on a dense screen. */
  hudDpr: number;
  /** The flown ship's shields, armour, hull and its row of part squares. */
  hudShipCondition: boolean;
  /** The bracket, the name, the range and the bars on the ship targeted. */
  hudTargetBlock: boolean;
  /** The speed, gun and booster arcs around the reticle in flight. */
  hudArcs: boolean;
  /** The bottom-left line where everything that happens is said. */
  hudMessages: boolean;
  /** How many of those lines stand at once, 3 to 8. */
  hudMessageLines: number;
  /** The long line under the display that names every key. Off: the action bar names the keys now. */
  hudFullPrompts: boolean;
  /** The arc on the side a blow came from. The red flash underneath it is not switched off by this. */
  hudDamageArc: boolean;
  /** Small numbers rising where a blow lands. Off: the game said its results in words, not numbers. */
  hudDamageNumbers: boolean;
  /** The name and the health of whatever the crosshair is on, drawn over its head. */
  hudNameplate: boolean;
  /** A crosshair for a Jedi as well as a Bounty Hunter, since a Force power is aimed too. */
  hudJediCrosshair: boolean;
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
  mobileCap: 40,
  mobileAnimRange: 160,
  waterRipples: true,
  waterRippleDetail: 512,
  waterRippleHeight: 1,
  waterRipplePersistence: 0.85,
  weather: true,
  weatherDensity: 1,
  rainOpacity: 0.55,
  wetSurfaces: true,
  weatherShadows: true,
  weatherForce: -1,
  weatherKind: 0,
  lifeDay: -1,
  soundMaster: 0.8,
  soundAmbience: 1,
  soundEffects: 1,
  soundVoices: 1,
  soundFootsteps: 1,
  soundVehicles: 1,
  soundInterface: 0.7,
  soundMusic: 1,
  soundHeadphones: false,
  soundRoomEcho: true,
  soundInBackground: false,
  soundSabers: 'jka',
  nebulaLightningDamage: true,
  hudScale: 1,
  hudDpr: 1,
  hudShipCondition: true,
  hudTargetBlock: true,
  hudArcs: true,
  hudMessages: true,
  hudMessageLines: 8,
  // Invented, and off: the short action bar now puts the key you have bound on every action it
  // offers, so the long line is no longer the only place a key is named. It stays as a switch so
  // that the short bar can be judged against it -- turn it on, and whatever the bar has hidden is
  // the thing to say -- but it is not on by default, or both are on the screen at once and there is
  // nothing to compare.
  hudFullPrompts: false,
  // Invented, like every other default in this block: the arc, the nameplate and the Jedi's
  // crosshair start on because they say something the screen otherwise does not say at all, and the
  // floating numbers start off because the game put its combat results in words and the message line
  // is where those words go. All four are switches on the Interface page.
  hudDamageArc: true,
  hudDamageNumbers: false,
  hudNameplate: true,
  hudJediCrosshair: true,
  ...FX_DEFAULTS,
};

/** What the display's scale and its sharpness may be set to; the menu and `__debug.hud` clamp to these. */
export const HUD_SCALE_RANGE = { min: 0.75, max: 1.5 } as const;
export const HUD_DPR_RANGE = { min: 1, max: 2 } as const;
export const HUD_LINES_RANGE = { min: 3, max: 8 } as const;

/**
 * The settings this session is playing with: the object `loadSettings` last returned, which the
 * game keeps and the menu writes into, so anything that reads through here sees a switch the
 * moment it is flicked. Before the game has loaded any (a node test), it is the defaults.
 */
let live: Settings = DEFAULT_SETTINGS;

/** The live settings; never replace what it returns, only read it. */
export function liveSettings(): Settings {
  return live;
}

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
  live = out;
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
