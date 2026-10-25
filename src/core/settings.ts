// The player's settings, kept in this browser: how the mouse feels and what the graphics cost.
// Every value has a default, a range and a live effect; the menu shows them, the game applies them.
// The effects' own keys live in `fxRegistry.ts`, which the menu and a plain node test read as well.
import { FX_DEFAULTS, type FxSettings } from './fxRegistry.ts';
import { volFillQuality, volStampQuality } from '../world/volumetrics/volSettings.ts';

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
  /** Placed buildings and props this big (radius, metres) and up cast shadows, what players put down included. */
  shadowCasterRadius: number;
  // The flora's own (wave 8): what of it is drawn, how far, and what casts and takes the sun's shadow. Scene
  // content, not an effect, and nothing here builds a shader program in play (`src/world/floraSettings.ts`).
  /** The terrain's own grass, flowers and small plants round you. */
  grass: boolean;
  /** The grass's reach over the world's own (20 to 32 m), 0.5 to 3; the window of chunks built follows it. */
  grassReach: number;
  /** A share of the grass's tufts kept, 0.25 to 1. */
  grassDensity: number;
  /** The far hills' tree cards. */
  farCards: boolean;
  /** The far cards' reach over the world's own end (500 to 1000 m), 1 to 2. */
  farCardReach: number;
  /** The small plants' reach, times the world's own plant distance (never under 64 m), 1 to 4. */
  floraPlantReach: number;
  /** Metres the trees are drawn to (0: as far as the ground); past it the far tree cards stand in for them. */
  floraTreeReach: number;
  /** Trees, planted and placed, cast shadows. */
  floraTreeShadows: boolean;
  /** Small plants cast shadows, at their finest level only. */
  floraPlantShadows: boolean;
  /** The grass near you casts shadows (the original's never did). */
  grassShadows: boolean;
  /** Shadows fall on the grass and on the far tree cards. */
  grassTakesShadows: boolean;
  /** The far tree cards cast shadows (only where they stand inside Shadow distance). */
  farCardShadows: boolean;
  /** Whether a leaf takes its own tree's shadow: 'self' no (the owner's), 'all' yes, 'none' no shadow on leaves at all. */
  leafShadows: string;
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
  /** How many creatures and NPCs the spawner may have out at once (nothing the world itself stands is counted). */
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
  /**
   * How solid the nebulae are, 0 to 1: their sheets and the haze inside one together, and how much
   * they dim the lens flare and the god rays with them. 1 is as they are drawn; 0 is none at all.
   */
  nebulaOpacity: number;
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
  /** A race run's block: the countdown, the lap, the time, the splits against the best, and the gates ahead drawn on the overlay. */
  hudRaceBlock: boolean;
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
  /** The grapple's diamond where the dart would bite: drawn whether or not the hook is ever fired, so it has a switch. */
  hudGrappleMark: boolean;
  /** The minimap at the top left: the planet's own picture round you, with your waypoints on it. */
  hudMinimap: boolean;
  /** Metres from the minimap's middle to its rim, 300 to 3200. */
  hudMinimapRange: number;
  /** North at the top of the minimap; off, the map turns so the way you face is up. */
  hudMinimapNorthUp: boolean;
  /** Your waypoints marked where they stand in the world. */
  hudWaypointMarks: boolean;
  /** The same marks while flying a ship. */
  hudWaypointMarksInFlight: boolean;
  /** The jobs followed, down the right edge under the group's roster. */
  hudTracker: boolean;
  /** The same while flying a ship. */
  hudTrackerInFlight: boolean;
  // Gameplay.
  /**
   * How hard the world's own people and creatures are: one scale on their health and their blows,
   * 1 their own numbers (`src/world/difficulty.ts`). Never the player's or another player's.
   */
  difficulty: number;
  /**
   * How Restuss stands when you next arrive on Rori with no server's word on it: the living launch city or its ruins
   * (`src/world/worldState.ts`). Kept as the world state's own setting (`swg.world.restuss`), which this mirrors;
   * a server that keeps one stands it for everybody.
   */
  restuss: 'living' | 'ruins';
  // The volumetrics' scene content (src/world/volumetrics/volSettings.ts speaks for these): the moving air, the dust it
  // carries and the light through it, each with its own detail, what may stir it, and how far the game's own storm
  // sheets thin while the dust draws a storm. The master and the volume's own keys are the effects' (fxRegistry.ts).
  /** The air moves: one layer of it over the ground near you, stirred by engines, blasts and the Force. */
  volAir: boolean;
  /** Cells across the air's 192 m square: 64, 96, 128, 160 or 192. */
  volAirDetail: number;
  /** Pressure steps a solve, 8 to 40. */
  volAirSolve: number;
  /** Solver steps a second: 30 or 60. */
  volAirRate: number;
  /** The air carries dust off sand and dirt, and none off rock, paving or water. */
  volDust: boolean;
  /** The dust's own grid as a multiple of the air's: 2, 3, 4 or 6. */
  volDustDetail: number;
  /** The motes behind a machine are grains thrown up that fall back to the sand, not motes that only rise. */
  volKickUp: boolean;
  /** The dust shades itself toward the sun: a lit face and a dark heart. */
  volLight: boolean;
  /** The light's grid as a multiple of the air's: 1, 2 or 3. */
  volLightDetail: number;
  /** Steps toward the sun, 12 to 40. */
  volLightSteps: number;
  /** How far the game's own storm sheets thin while the dust draws the storm, 0 (kept) to 1 (stood down). */
  volStormThin: number;
  /** Every engine and every hovering hull stirs the air. */
  volFromEngines: boolean;
  /** The Force push, pull and repulse stir the air. */
  volFromForce: boolean;
  /** Grenades, mines, charges, splash and wrecks stir the air. */
  volFromBlasts: boolean;
  /** The ground's pattern drifts under a strong jet and heals back (the carried offsets). */
  volSand: boolean;
  /** The carried offsets' grid as a multiple of the air's: 2, 3, 4 or 6. */
  volSandDetail: number;
  /** Footprints, ruts, scour pits and craters pressed into the ground. */
  volPrints: boolean;
  /** The dents' texels over their 128 m square: 1024, 2048 or 4096. */
  volPrintDetail: number;
  /** How strongly the blowing sand shows over the still ground, 0 (none) to 1. */
  volArtSand: number;
  /** How deep the dents show, their bent light and their darkening, 0 (none) to 1.5. */
  volArtPrints: number;
  /** How dark the dust's shadow on the ground is, 0 (none) to 1. */
  volArtShade: number;
  /** A footstep on ground that keeps marks presses a dent rather than laying a decal. */
  volFromFeet: boolean;
  /** How bright the dust is drawn, 0 to 2 (1 the first wave's light, 0.6 the start). */
  volDustBright: number;
  /** How strongly the dust shades itself toward the sun, 0 (not at all) to 2 (1 the march's own extinction). */
  volDustSelfShadow: number;
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
  // The flora's: every default is what the game drew before the page had a Flora section, but the two the wave
  // added, and each says whose it is. Ours throughout unless it says otherwise.
  grass: true,
  grassReach: 1,
  grassDensity: 1,
  farCards: true,
  farCardReach: 1,
  floraPlantReach: 2,
  floraTreeReach: 0,
  floraTreeShadows: true,
  floraPlantShadows: false,
  // Off: the client's grass cast nothing, and casting adds up to three times the grass's vertex work.
  grassShadows: false,
  // On (new): the client's shadow volumes darkened whatever was drawn inside them, the grass included (inferred).
  grassTakesShadows: true,
  farCardShadows: false,
  // The owner's: no leaf takes its own tree's shadow.
  leafShadows: 'self',
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
  nebulaOpacity: 0.1,
  hudScale: 1,
  hudDpr: 1,
  hudShipCondition: true,
  hudTargetBlock: true,
  hudArcs: true,
  // Ours, and on: a run with no clock and no gates on the screen is not a race anybody can run.
  hudRaceBlock: true,
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
  // On, the owner's answer: it is the only way to aim the hook, and it shows nearly everywhere outdoors.
  hudGrappleMark: true,
  // Ours, all five: the minimap and the marks start on because they are the only way a waypoint is
  // seen without opening the map; eight hundred metres is the design's reach, and north up is how the
  // map window itself is drawn.
  hudMinimap: true,
  hudMinimapRange: 800,
  hudMinimapNorthUp: true,
  hudWaypointMarks: true,
  hudWaypointMarksInFlight: true,
  // Ours, both: the jobs followed stand on the screen on foot, and stand aside at a ship's controls, where
  // the flight display has the right edge's attention.
  hudTracker: true,
  hudTrackerInFlight: false,
  // Ours, and one: every body stands at its own numbers until the player says otherwise.
  difficulty: 1,
  // The owner's (2026-10-19, the pass's design §10 Q1): Restuss stands as its ruins, how SOE's live game ended.
  restuss: 'ruins',
  // The volumetrics': every switch on under the master (which is off, an effects key), every detail at the High
  // preset (`VOL_PRESETS` in volSettings.ts), and the storm sheets thinned to half while the dust draws the storm
  // (ours, the design's Q7: their streaks show the wind at a scale the air's cells cannot).
  volAir: true,
  volAirDetail: 128,
  volAirSolve: 20,
  volAirRate: 60,
  volDust: true,
  volDustDetail: 4,
  volKickUp: true,
  volLight: true,
  volLightDetail: 2,
  volLightSteps: 26,
  volStormThin: 0.5,
  volFromEngines: true,
  volFromForce: true,
  volFromBlasts: true,
  // The second wave's: the ground's effects on and at High, and every art dial at the demo's full look (the owner's to
  // turn down; at nought each leaves the ground's own art exactly as it is).
  volSand: true,
  volSandDetail: 4,
  volPrints: true,
  volPrintDetail: 2048,
  volArtSand: 1,
  volArtPrints: 1,
  volArtShade: 1,
  volFromFeet: true,
  // Wave 2b's look of the dust [ours, the design's §2.8]: at 0.6 fresh dust on sand at noon comes out about its
  // ground's own brightness; at a self-shadow of 1 the dust shades itself exactly as the march's own extinction says.
  volDustBright: 0.6,
  volDustSelfShadow: 1,
  ...FX_DEFAULTS,
};

/** What the display's scale and its sharpness may be set to; the menu and `__debug.hud` clamp to these. */
export const HUD_SCALE_RANGE = { min: 0.75, max: 1.5 } as const;
export const HUD_DPR_RANGE = { min: 1, max: 2 } as const;
export const HUD_LINES_RANGE = { min: 3, max: 8 } as const;
/** The minimap's reach, in metres from its middle to its rim: the menu and `__debug.minimap` clamp to it. */
export const HUD_MINIMAP_RANGE = { min: 300, max: 3200 } as const;

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
    // A volumetrics quality key a later wave added, which a file saved before it never wrote, takes the preset the
    // file's other quality keys hold: a Low chosen before stays Low rather than reading Custom.
    volFillQuality(saved, out);
  } catch {
    /* none saved, or not ours */
  }
  live = out;
  return out;
}

export function saveSettings(s: Settings): void {
  try {
    const changed: Record<string, unknown> = Object.fromEntries(Object.entries(s).filter(([k, v]) => v !== DEFAULT_SETTINGS[k as keyof Settings]));
    // The volumetrics' wave the file was written in, where it holds a quality key, so a quality key a later wave adds is
    // filled only in a file from before it (`volFillQuality`), never in one that left it out for being at its default.
    volStampQuality(changed);
    if (Object.keys(changed).length) localStorage.setItem(KEY, JSON.stringify(changed));
    else localStorage.removeItem(KEY);
  } catch {
    /* no storage: the settings last the session */
  }
}
