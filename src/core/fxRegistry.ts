// Every effect the picture goes through, in one list: its settings keys and defaults, its menu
// knobs, where it sits in the chain, what it needs computed first and what it may cost. Nothing
// here imports anything, so the game, the menu and a plain node test all read the same list and
// two effects written apart cannot quietly claim the same key, the same place or the same budget.
//
// An effect that is not written yet still has its row, marked `live: false`: the key exists with a
// default (so a saved settings file never loses it), the knob is hidden until the pass is real, and
// the order it will sit in is already settled.

export interface FxSettings {
  /** The master: the picture goes out through the chain below; off draws straight to the canvas with its own edge smoothing. */
  effects: boolean;
  ssao: boolean;
  ssaoStrength: number;
  /** How far the occlusion reaches, metres. */
  ssaoRadius: number;
  ssaoResolution: number;
  /** A lit blade lights the ground, walls and bodies around it in its own colour. */
  bladeGlow: boolean;
  bladeGlowStrength: number;
  /** The blade's light stops at walls, crates and hulls that are on screen. */
  bladeGlowShadows: boolean;
  waterReflections: boolean;
  waterReflectionResolution: number;
  heatHaze: boolean;
  heatHazeStrength: number;
  /** Volumetric clouds in place of the flat sheets. Off by default: it is the most expensive pass in the chain. */
  volumetricClouds: boolean;
  /** How much of the march reaches the picture, 0 to 1. At 0 the picture is untouched with the pass still on. */
  volumetricCloudAmount: number;
  /** The fraction of the screen it marches at. */
  volumetricCloudQuality: number;
  /** Daylight through the doorways of the room the camera is in, and a glow around its lamps. */
  lightShafts: boolean;
  lightShaftStrength: number;
  /** The haze around a room's lamps and in the depth of a lit hall. */
  roomGlowStrength: number;
  /** Dust drifting in rooms and aboard ships: scene content, drawn with the effects off too. */
  roomMotes: boolean;
  roomMoteAmount: number;
  godRays: boolean;
  godRayStrength: number;
  /** Under a water surface: the picture graded by how much water each pixel is seen through, and a shimmer to the view. */
  underwater: boolean;
  underwaterStrength: number;
  /** The shimmer over the view under water, and the specks drifting in it. */
  underwaterShimmerStrength: number;
  depthOfField: boolean;
  depthOfFieldStrength: number;
  motionBlur: boolean;
  motionBlurStrength: number;
  /** Things that move on their own smear too, not only what the camera sweeps past. */
  motionBlurObjects: boolean;
  bloom: boolean;
  bloomStrength: number;
  lensFlare: boolean;
  lensFlareStrength: number;
  colorGrade: boolean;
  colorGradeStrength: number;
  fxaa: boolean;
  filmGrain: boolean;
  filmGrainStrength: number;
  vignette: boolean;
  vignetteStrength: number;
  // The volumetrics pass's own (src/world/volumetrics/): the master over all of it, and the volume's own switch and
  // quality. The master is an effects key only because the volume's row requires it (`requires`); the moving air,
  // the dust and the light pass are scene content and run with Effects off, as the weather does.
  /** The master: air you can see, the ground keeping what passes, smoke and fog. Off is today's game exactly. */
  volumetrics: boolean;
  /** The dust in the air, marched in the picture: needs Effects and the master. */
  airVolume: boolean;
  /** How much of the march reaches the picture, 0 to 1.5; at 0 the pass refuses and costs nothing. */
  airVolumeAmount: number;
  /** The share of the screen the march runs at: 0.25, 0.5 or 1. */
  airVolumeResolution: number;
  /** Density samples a ray, 6 to 48 (a uniform under a loop bound of 48). */
  airVolumeSteps: number;
  /** A reprojected history that hides the march's grain. */
  airVolumeHistory: boolean;
  /** The sun's cascades shade the dust: in a building's shadow it is dark. */
  airVolumeShadows: boolean;
  // The seventh wave's clouds (src/core/fx/airClouds.ts): one cloud system under the master that stands in for the
  // September pass while it is wanted (`yieldsTo`), its own switch, quality and strength.
  /** The clouds marched from the game's own pictures, drifted by the one wind, a low deck holed by every hull. */
  volClouds: boolean;
  /** How much of the clouds reaches the picture, 0 to 1.5; at 0 the pass refuses and today's sheets are drawn. */
  volCloudsAmount: number;
  /** The share of the screen the clouds are marched at: 0.25, 0.5 or 1. */
  volCloudsResolution: number;
  /** Steps through the high slab, 16 to 96 (a uniform under a loop bound of 128). */
  volCloudsSteps: number;
  /** Steps toward the sun, 2 to 6 (a uniform under a loop bound of 8). */
  volCloudsLight: number;
  /** A reprojected history that hides the clouds' grain. */
  volCloudsHistory: boolean;
}

export type FxPassId =
  | 'sanitize'
  | 'ssao'
  | 'bladeGlow'
  | 'waterReflections'
  | 'heatHaze'
  | 'lightShafts'
  | 'volumetricClouds'
  | 'airClouds'
  | 'airVolume'
  | 'godRays'
  | 'underwater'
  | 'depthOfField'
  | 'motionBlur'
  | 'underwaterSpecks'
  | 'bloom'
  | 'lensFlare'
  | 'colorGrade'
  | 'output'
  | 'fxaa'
  | 'grainVignette'
  | 'debugView';

export type FxProductId = 'linearDepthHalf' | 'normalsHalf' | 'heat' | 'debugMask' | 'waterMask' | 'velocity' | 'dofGlow';

/**
 * scene: linear high range, what the world looks like. lens: linear high range, what the camera
 * does to it. display: after tone mapping, sRGB values in 0 to 1.
 */
export type FxStage = 'scene' | 'lens' | 'display';

export interface FxPassDef {
  id: FxPassId;
  stage: FxStage;
  /** On when any of these settings is true. Empty: only `required` or a console override turns it on. */
  toggles: readonly (keyof FxSettings)[];
  /**
   * Wanted only while every one of these is on, whatever its toggles or a console override say (`fxPassWanted`): the
   * volume under the volumetrics master. No other pass has any, so every other pass decides exactly as it always did.
   */
  requires?: readonly (keyof FxSettings)[];
  /**
   * Unwanted while any of these passes is wanted (`fxPassWanted`): the September clouds, while the volumetrics' clouds
   * stand in for them. No other pass has any, so every other pass decides exactly as it always did; and since the pass
   * yielded to requires the volumetrics master, with the master off this decides as it always did.
   */
  yieldsTo?: readonly FxPassId[];
  /** Always drawn, cannot be forced off from the console. */
  required: boolean;
  /** The most it can ask for; the pass's own `needs(ctx)` returns a subset each frame. */
  needs: readonly FxProductId[];
  /** Ceiling in GPU milliseconds at 2560x1440, render scale 1, on the frames it draws. */
  budgetMs: number;
  /** Ceiling in main-thread milliseconds on the frames it draws, where it has one of its own; `fxTiming` flags `cpuOver` only where it is declared. */
  cpuBudgetMs?: number;
  /** Counted in the typical outdoor daytime frame. */
  typical: boolean;
  /** Can be the last pass on, so it may draw to the canvas: warmed for both. */
  canBeLast: boolean;
  /** Written. A knob whose pass is not live is hidden in the menu; its key is still reserved. */
  live: boolean;
  why: string;
}

export interface FxProductDef {
  id: FxProductId;
  /** depth: its own target, may sample the scene depth. geometry: shares the scene depth attachment, never samples it. */
  kind: 'depth' | 'geometry';
  needs: readonly FxProductId[];
  /** Half or all of the drawing buffer; a geometry product is always 1, since it shares the scene depth. */
  scale: 0.5 | 1;
  format: 'R32F' | 'RGBA8' | 'R8' | 'RG8' | 'R16F' | 'RG16F' | 'RGBA16F';
  /** Colour targets it writes at once, each of `format`; 1 when absent. */
  targets?: number;
  budgetMs: number;
  /** Ceiling in main-thread milliseconds on the frames it is computed, where it has one of its own. */
  cpuBudgetMs?: number;
  typical: boolean;
  owner: 'spine' | FxPassId;
  live: boolean;
}

export interface FxKnobDef {
  key: keyof FxSettings;
  /** The pass the knob belongs to; null for the master and for effects drawn in the scene rather than by a pass (room motes). A null-pass knob is shown whenever its keys exist. */
  pass: FxPassId | null;
  /** Only worth showing once a product exists (objects smearing needs the velocity product). */
  product?: FxProductId;
  label: string;
  hint: string;
  kind: 'range' | 'toggle' | 'select';
  min?: number;
  max?: number;
  step?: number;
  options?: { value: number; label: string }[];
  format?: (v: number) => string;
  /** Greyed while any of these is off. */
  requires: readonly (keyof FxSettings)[];
  /** Shown in a section of its own rather than among the Effects: the volumetrics' rows stand on the Graphics page's Volumetrics section (`src/ui/volPage.ts`). */
  group?: 'volumetrics';
}

/**
 * Cheap effects are on. The expensive ones are on at half resolution. Film grain is off because it
 * is a matter of taste rather than cost: it reads as noise at 144 frames a second.
 */
export const FX_DEFAULTS: FxSettings = {
  effects: true,
  ssao: true,
  ssaoStrength: 1,
  ssaoRadius: 1.2,
  ssaoResolution: 0.5,
  bladeGlow: true,
  bladeGlowStrength: 1,
  bladeGlowShadows: true,
  waterReflections: true,
  waterReflectionResolution: 0.5,
  heatHaze: true,
  heatHazeStrength: 1,
  volumetricClouds: false,
  volumetricCloudAmount: 1,
  volumetricCloudQuality: 0.5,
  lightShafts: true,
  lightShaftStrength: 0.8,
  roomGlowStrength: 0.5,
  roomMotes: true,
  roomMoteAmount: 1,
  godRays: true,
  godRayStrength: 0.6,
  underwater: true,
  underwaterStrength: 1,
  underwaterShimmerStrength: 1,
  depthOfField: true,
  depthOfFieldStrength: 1,
  motionBlur: true,
  motionBlurStrength: 0.35,
  motionBlurObjects: true,
  bloom: true,
  bloomStrength: 0.35,
  lensFlare: true,
  lensFlareStrength: 0.5,
  colorGrade: true,
  colorGradeStrength: 1,
  fxaa: true,
  filmGrain: false,
  filmGrainStrength: 0.3,
  vignette: true,
  vignetteStrength: 0.25,
  // Off until the owner has been through the test sheet (the design's decision 1, Q1); the rest at the High preset.
  volumetrics: false,
  airVolume: true,
  airVolumeAmount: 1,
  airVolumeResolution: 0.5,
  airVolumeSteps: 16,
  airVolumeHistory: true,
  airVolumeShadows: true,
  // The seventh wave's clouds, under the master (off): on, at the High preset, at full strength.
  volClouds: true,
  volCloudsAmount: 1,
  volCloudsResolution: 0.25,
  volCloudsSteps: 48,
  volCloudsLight: 4,
  volCloudsHistory: true,
};

const two = (v: number) => v.toFixed(2);
const half = [
  { value: 0.5, label: 'Half (faster)' },
  { value: 1, label: 'Full' },
];
const cloudQuality = [
  { value: 0.25, label: 'Quarter (fastest)' },
  { value: 0.5, label: 'Half' },
  { value: 1, label: 'Full' },
];

export const FX_KNOBS: readonly FxKnobDef[] = [
  { key: 'effects', pass: null, label: 'Effects', kind: 'toggle', requires: [], hint: 'Runs the picture through the effects below. Switching it recompiles every shader in the background (a notice counts them); the picture changes over when they are ready.' },
  { key: 'ssao', pass: 'ssao', label: 'Ambient occlusion', kind: 'toggle', requires: ['effects'], hint: "Shade where the sky's light cannot reach: creases, corners, the ground under things, the insides of rooms. Sunlit and lamp-lit surfaces keep their light." },
  { key: 'ssaoStrength', pass: 'ssao', label: 'Ambient occlusion strength', kind: 'range', min: 0, max: 2, step: 0.05, format: two, requires: ['effects', 'ssao'], hint: '0.5 a hint, 1 as the light allows, 2 deep.' },
  { key: 'ssaoRadius', pass: 'ssao', label: 'Ambient occlusion reach', kind: 'range', min: 0.4, max: 3, step: 0.1, format: (v) => `${v.toFixed(1)} m`, requires: ['effects', 'ssao'], hint: "How far a surface looks for what shades it: 0.5 m a tight contact shade, 1.2 m a person's size, 2.5 m a room's. Close to the camera it is always shorter." },
  { key: 'ssaoResolution', pass: 'ssao', label: 'Ambient occlusion resolution', kind: 'select', options: half, requires: ['effects', 'ssao'], hint: 'Half is a quarter of the work, smoothed back up along edges. Full costs about three times as much.' },
  { key: 'bladeGlow', pass: 'bladeGlow', label: 'Lightsaber glow', kind: 'toggle', requires: ['effects'], hint: 'A lit blade lights the ground, walls and bodies around it in its own colour. While it is on, the blades leave the pooled flash lights to shots, hits and ship rooms.' },
  { key: 'bladeGlowStrength', pass: 'bladeGlow', label: 'Lightsaber glow strength', kind: 'range', min: 0, max: 2, step: 0.05, format: two, requires: ['effects', 'bladeGlow'], hint: '0.5 a hint, 1 as in the films, 2 a torch. At 0 there is no glow at all.' },
  { key: 'bladeGlowShadows', pass: 'bladeGlow', label: 'Lightsaber glow stops at walls', kind: 'toggle', requires: ['effects', 'bladeGlow'], hint: 'The glow does not reach floors on the far side of a wall, crate or hull that is on screen. Off saves about 0.06 ms a frame.' },
  { key: 'waterReflections', pass: 'waterReflections', label: 'Water reflections', kind: 'toggle', requires: ['effects'], hint: 'Lakes and seas mirror the hills, buildings, ships and sky on screen; what is off screen comes from the sky\'s reflection map.' },
  { key: 'waterReflectionResolution', pass: 'waterReflections', label: 'Water reflection resolution', kind: 'select', options: half, requires: ['effects', 'waterReflections'], hint: 'Half traces a quarter of the pixels and smooths them back along the water; full is sharper and about three times the cost.' },
  { key: 'heatHaze', pass: 'heatHaze', label: 'Heat haze', kind: 'toggle', requires: ['effects'], hint: 'The air shimmers over lava, behind running engines and in front of a flame thrower, as the game drew it over Mustafar\'s lava.' },
  { key: 'heatHazeStrength', pass: 'heatHaze', label: 'Heat haze strength', kind: 'range', min: 0, max: 2, step: 0.05, format: two, requires: ['effects', 'heatHaze'], hint: '1 is the shimmer the game drew; 2 moves the picture twice as far.' },
  { key: 'volumetricClouds', pass: 'volumetricClouds', label: 'Volumetric clouds (unfinished)', kind: 'toggle', requires: ['effects'], hint: "Cloud the sky is really made of rather than a picture drawn across it, marched through a slab overhead and lit by the world's own sun, so each planet keeps its own colour. Unfinished: it draws, but how it looks has not been settled, and it is by far the most expensive thing here. Off is the flat sheets exactly as they always were." },
  // This one offers a quarter as well: the march is the dearest pass in the chain by a long way, and
  // a quarter of the screen is the setting that decides whether it can be afforded at all.
  { key: 'volumetricCloudQuality', pass: 'volumetricClouds', label: 'Cloud resolution', kind: 'select', options: cloudQuality, requires: ['effects', 'volumetricClouds'], hint: 'The share of the screen the march runs at, smoothed back up along edges by depth. Quarter costs about a quarter of half, and cloud has no hard edges of its own to lose.' },
  { key: 'volumetricCloudAmount', pass: 'volumetricClouds', label: 'Cloud strength', kind: 'range', min: 0, max: 1, step: 0.05, format: two, requires: ['effects', 'volumetricClouds'], hint: 'How much of the march reaches the picture. At 0 the sky is untouched with the pass still running, which is the way to see what it costs against what it gives.' },  { key: 'lightShafts', pass: 'lightShafts', label: 'Light shafts', kind: 'toggle', requires: ['effects'], hint: 'Daylight through the doorways of the room you are in: a beam in the dusty air and a bright patch where it lands; and a soft glow in the air around the room\'s own lamps.' },
  { key: 'lightShaftStrength', pass: 'lightShafts', label: 'Light shaft strength', kind: 'range', min: 0, max: 1.5, step: 0.05, format: two, requires: ['effects', 'lightShafts'], hint: '0.4 clean air, 0.8 a dusty cantina, 1.2 a smoky hall.' },
  { key: 'roomGlowStrength', pass: 'lightShafts', label: 'Lamp glow', kind: 'range', min: 0, max: 1.5, step: 0.05, format: two, requires: ['effects', 'lightShafts'], hint: 'The haze around a room\'s lamps and in the depth of a lit hall, in the room\'s own colours; 0 turns it off.' },
  { key: 'roomMotes', pass: null, label: 'Dust motes', kind: 'toggle', requires: [], hint: 'Specks of dust drifting in rooms and aboard ships, glinting where daylight or a lamp catches them. Works with Effects off.' },
  { key: 'roomMoteAmount', pass: null, label: 'Dust mote amount', kind: 'range', min: 0.25, max: 2, step: 0.05, format: (v) => `${Math.round(v * 1500)}`, requires: ['roomMotes'], hint: 'How many motes hang in the air around you.' },
  { key: 'godRays', pass: 'godRays', label: 'God rays', kind: 'toggle', requires: ['effects'], hint: 'Sunlight scattered towards you where the sky shows between trees, walls and hulls.' },
  { key: 'godRayStrength', pass: 'godRays', label: 'God ray strength', kind: 'range', min: 0.1, max: 1.5, step: 0.05, format: two, requires: ['effects', 'godRays'], hint: '0.3 a hint, 0.6 a morning, 1.2 a blaze.' },
  { key: 'underwater', pass: 'underwater', label: 'Underwater look', kind: 'toggle', requires: ['effects'], hint: 'Under a lake or the sea the picture takes the water\'s own colour, thicker the further off a thing is, and darker the deeper you go; the view shimmers a little and specks drift past. Off, being under water looks exactly as it did before.' },
  { key: 'underwaterStrength', pass: 'underwater', label: 'Underwater strength', kind: 'range', min: 0, max: 2, step: 0.05, format: two, requires: ['effects', 'underwater'], hint: '0.5 clear water you can see a long way through, 1 a lake, 2 half as far again as murky. 0 leaves the colour alone and keeps the shimmer.' },
  { key: 'underwaterShimmerStrength', pass: 'underwater', label: 'Underwater shimmer', kind: 'range', min: 0, max: 2, step: 0.05, format: two, requires: ['effects', 'underwater'], hint: 'The whole view wavering gently, as through a lens, where the light bends through the ripples overhead, and the specks drifting past to show you are moving. 1 is a shimmer you notice without watching for it, 2 twice as far. 0 turns both off without losing the colour.' },
  { key: 'depthOfField', pass: 'depthOfField', label: 'Depth of field when aiming', kind: 'toggle', requires: ['effects'], hint: 'Aiming a gun brings what the crosshair is on into focus and softens what lies nearer and farther; your own character and your shots stay sharp. Wheel in close on the face in the wardrobe and the doll softens a little behind it too.' },
  { key: 'depthOfFieldStrength', pass: 'depthOfField', label: 'Depth of field strength', kind: 'range', min: 0, max: 2, step: 0.05, format: two, requires: ['effects', 'depthOfField'], hint: '0.5 a hint, 1 a camera lens, 2 a long lens. 0 turns the blur off without turning the setting off.' },
  { key: 'motionBlur', pass: 'motionBlur', label: 'Motion blur', kind: 'toggle', requires: ['effects'], hint: 'What the camera moves past smears along its movement: the ground under a ship at speed, a wall in a turn; what moves with you stays sharp.' },
  { key: 'motionBlurStrength', pass: 'motionBlur', label: 'Motion blur strength', kind: 'range', min: 0.1, max: 1, step: 0.05, format: two, requires: ['effects', 'motionBlur'], hint: 'How much of a frame’s movement is smeared, for the camera and for moving things alike: 0.2 a hint, 0.35 a film’s, 1 the whole.' },
  { key: 'motionBlurObjects', pass: 'motionBlur', product: 'velocity', label: 'Motion blur on moving things', kind: 'toggle', requires: ['effects', 'motionBlur'], hint: 'Ships, speeders, creatures and people smear by their own movement, not only the camera’s. Off: only the camera blurs the picture. What you ride, fly or stand in stays sharp either way.' },
  { key: 'bloom', pass: 'bloom', label: 'Bloom', kind: 'toggle', requires: ['effects'], hint: 'The bright parts spill over: engine glows, bolts, the suns.' },
  { key: 'bloomStrength', pass: 'bloom', label: 'Bloom strength', kind: 'range', min: 0.05, max: 1.5, step: 0.05, format: two, requires: ['effects', 'bloom'], hint: '0.1 a touch, 0.5 a glow, 1 a haze.' },
  { key: 'lensFlare', pass: 'lensFlare', label: 'Lens flare', kind: 'toggle', requires: ['effects'], hint: 'A glare and the lens’s reflections when you look towards the sun (in space, the brightest star). They fade as anything passes in front of it, and in cloud.' },
  { key: 'lensFlareStrength', pass: 'lensFlare', label: 'Lens flare strength', kind: 'range', min: 0, max: 1.5, step: 0.05, format: two, requires: ['effects', 'lensFlare'], hint: '0.25 a trace, 0.5 a camera, 1 a film’s. It never brightens what is already near white, so by day it shows mostly as a streak and ghosts.' },
  { key: 'colorGrade', pass: 'colorGrade', label: 'Colour grade', kind: 'toggle', requires: ['effects'], hint: 'A look for each planet over the light of its own sky at this hour: Tatooine’s sun warmer and richer, Mustafar hot, Dathomir bleak and cold, nights moonlit. Rooms and ship interiors take a third of it.' },
  { key: 'colorGradeStrength', pass: 'colorGrade', label: 'Colour grade strength', kind: 'range', min: 0, max: 1, step: 0.05, format: two, requires: ['effects', 'colorGrade'], hint: '0.5 a hint, 1 as designed.' },
  { key: 'fxaa', pass: 'fxaa', label: 'Edge smoothing', kind: 'toggle', requires: ['effects'], hint: 'Smooths the stepped edges at the end of the chain. The effects path cannot multisample, so this is what stands in for it.' },
  { key: 'filmGrain', pass: 'grainVignette', label: 'Film grain', kind: 'toggle', requires: ['effects'], hint: 'A fine grain that changes 24 times a second, strongest in the mid-tones; blacks and whites stay clean.' },
  { key: 'filmGrainStrength', pass: 'grainVignette', label: 'Film grain strength', kind: 'range', min: 0, max: 1, step: 0.05, format: two, requires: ['effects', 'filmGrain'], hint: '0.2 fine, 0.5 film, 1 coarse.' },
  { key: 'vignette', pass: 'grainVignette', label: 'Vignette', kind: 'toggle', requires: ['effects'], hint: 'The picture’s corners a little darker, as through a lens; a touch more while aiming.' },
  { key: 'vignetteStrength', pass: 'grainVignette', label: 'Vignette strength', kind: 'range', min: 0, max: 1, step: 0.05, format: two, requires: ['effects', 'vignette'], hint: '0.25 barely there, 0.5 noticeable, 1 heavy.' },
  // The volumetrics' rows, shown in the Graphics page's Volumetrics section and never among the Effects above.
  { key: 'volumetrics', pass: null, group: 'volumetrics', label: 'Volumetrics', kind: 'toggle', requires: [], hint: 'Air that moves and dust you can see: a ship hovering over sand blows dust out from under it, a speeder lifts it off sand and dirt and none off rock or paving, a grenade blows it outward, a storm is real dust you fly through, lit by the sun. Off is the game exactly as it was. Turned on in play it takes effect at your next arrival, which prepares its shaders behind the loading screen. Nothing of it runs indoors or in space.' },
  { key: 'airVolume', pass: 'airVolume', group: 'volumetrics', label: 'Dust in the air', kind: 'toggle', requires: ['effects', 'volumetrics'], hint: 'The airborne dust marched through in the picture, with a lit face, a dark heart and the shade of buildings and trees on it. Off, the air still moves and the grains still fall, but the dust itself is not drawn. Needs Effects.' },
  { key: 'airVolumeResolution', pass: 'airVolume', group: 'volumetrics', label: 'Dust resolution', kind: 'select', options: cloudQuality, requires: ['effects', 'volumetrics', 'airVolume'], hint: 'The share of the screen the dust is marched at, smoothed back up along edges by depth. Quarter costs about a quarter of half; dust has no hard edges of its own to lose.' },
  { key: 'airVolumeSteps', pass: 'airVolume', group: 'volumetrics', label: 'Dust samples', kind: 'range', min: 6, max: 48, step: 2, format: (v) => `${v}`, requires: ['effects', 'volumetrics', 'airVolume'], hint: 'How many times each ray samples the dust, spent only where the air is. Fewer is grainier and cheaper.' },
  { key: 'airVolumeHistory', pass: 'airVolume', group: 'volumetrics', label: 'Smooth the dust over frames', kind: 'toggle', requires: ['effects', 'volumetrics', 'airVolume'], hint: 'Each frame is blended into the last, which hides the grain a few samples leave. Off shows each frame as it is marched.' },
  { key: 'airVolumeShadows', pass: 'airVolume', group: 'volumetrics', label: 'Shadows in the dust', kind: 'toggle', requires: ['effects', 'volumetrics', 'airVolume'], hint: 'The sun\'s own shadows fall in the dust: under a hovering ship or in a street\'s shade it is dark. Off lights all of it.' },
  { key: 'airVolumeAmount', pass: 'airVolume', group: 'volumetrics', label: 'Dust over the picture', kind: 'range', min: 0, max: 1.5, step: 0.05, format: two, requires: ['effects', 'volumetrics', 'airVolume'], hint: 'How much of the dust reaches the picture: 1 as designed, 0 none at all (and then the pass costs nothing), 1.5 thicker.' },
  // The seventh wave's clouds: their switch and quality on the Volumetrics section's "The clouds", their strength among the art dials.
  { key: 'volClouds', pass: 'airClouds', group: 'volumetrics', label: 'Clouds', kind: 'toggle', requires: ['effects', 'volumetrics'], hint: "The sky's clouds marched as cloud rather than drawn as flat sheets, shaped by the game's own cloud pictures area by area (heaps where a picture is patchy, a layer where it is even, an overcast where a storm hangs no picture), drifting on the wind aloft and smeared by its gusts, lit by the sky's own colour; and in rain and overcast a low deck near the ground that a ship flies through and holes. Stands in for the unfinished volumetric clouds of the Effects page while it is on. Off, the sky's sheets are drawn as they always were. Needs Effects." },
  { key: 'volCloudsResolution', pass: 'airClouds', group: 'volumetrics', label: 'Cloud resolution', kind: 'select', options: cloudQuality, requires: ['effects', 'volumetrics', 'volClouds'], hint: 'The share of the screen the clouds are marched at, smoothed back up along edges by depth and over frames. A quarter is enough for cloud, which has no hard edges of its own.' },
  { key: 'volCloudsSteps', pass: 'airClouds', group: 'volumetrics', label: 'Cloud samples', kind: 'range', min: 16, max: 96, step: 8, format: (v) => `${v}`, requires: ['effects', 'volumetrics', 'volClouds'], hint: 'How many times each ray samples the high deck; empty sky is crossed in longer steps. Fewer is grainier and cheaper.' },
  { key: 'volCloudsLight', pass: 'airClouds', group: 'volumetrics', label: 'Cloud light steps', kind: 'range', min: 2, max: 6, step: 1, format: (v) => `${v}`, requires: ['effects', 'volumetrics', 'volClouds'], hint: 'Steps toward the sun from each sample: how deep a cloud\'s own shade reaches.' },
  { key: 'volCloudsHistory', pass: 'airClouds', group: 'volumetrics', label: 'Smooth the clouds over frames', kind: 'toggle', requires: ['effects', 'volumetrics', 'volClouds'], hint: 'Each frame blended into the last, which hides the grain a quarter of the screen leaves. Off shows each frame as it is marched.' },
  { key: 'volCloudsAmount', pass: 'airClouds', group: 'volumetrics', label: 'Clouds over the picture', kind: 'range', min: 0, max: 1.5, step: 0.05, format: two, requires: ['effects', 'volumetrics', 'volClouds'], hint: "How much of the clouds reaches the picture: 1 as designed, 0 none at all (the pass then costs nothing and the sky's own sheets are drawn), 1.5 thicker." },
];

/**
 * Draw order, settled once and never reordered: passes are referred to by id, never by index, so a
 * new effect can be slotted in without anything else moving.
 */
export const FX_PASSES: readonly FxPassDef[] = [
  { id: 'sanitize', stage: 'scene', toggles: [], required: true, needs: [], budgetMs: 0.06, typical: true, canBeLast: false, live: true, why: 'The only pass that reads the scene target’s colour. Pixels that are not numbers become black before any blur can spread them into a box, and the brightest are held to a ceiling.' },
  { id: 'ssao', stage: 'scene', toggles: ['ssao'], required: false, needs: ['linearDepthHalf', 'normalsHalf', 'waterMask'], budgetMs: 0.45, typical: true, canBeLast: false, live: true, why: 'Occlusion multiplies lit colour, so it comes before anything that adds light that must not be occluded, and before the heat haze, so the darkening travels with the pixels it belongs to.' },
  { id: 'bladeGlow', stage: 'scene', toggles: ['bladeGlow'], required: false, needs: [], budgetMs: 0.15, typical: false, canBeLast: false, live: true, why: 'Direct light added to surfaces: after SSAO, since ambient occlusion does not darken a direct light; before water reflections, heat haze, rays, depth of field, motion blur and bloom, so the pool is reflected, bent, blurred and bloomed like any lit surface. It reads the full-resolution scene depth itself, so it asks for no product.' },
  { id: 'waterReflections', stage: 'scene', toggles: ['waterReflections'], required: false, needs: ['linearDepthHalf', 'waterMask'], budgetMs: 0.6, typical: false, canBeLast: false, live: true, why: 'Adds reflected scene light on water pixels. After occlusion so the reflected ground carries it, before the lens so reflections shimmer, defocus, smear and bloom like anything seen directly.' },
  { id: 'heatHaze', stage: 'scene', toggles: ['heatHaze'], required: false, needs: ['heat', 'linearDepthHalf'], budgetMs: 0.16, typical: false, canBeLast: false, live: true, why: 'Displaces what the surfaces look like, so it follows every surface pass; before the atmosphere and the lens, since the air and the glass sit between the heat and the eye.' },
  { id: 'lightShafts', stage: 'scene', toggles: ['lightShafts'], required: false, needs: ['linearDepthHalf', 'normalsHalf'], budgetMs: 0.3, typical: false, canBeLast: false, live: true, why: 'Daylight scattered in the air of the room the camera is in, from its doorways, the sunlit patch where it lands, and the glow around the room\'s lamps. Evaluated per pixel along the view ray and stopped by the scene depth, which scene meshes cannot read. Atmosphere: after the surface passes (SSAO has darkened the corners the patch lands among), before god rays, depth of field, motion blur and bloom, so the beams defocus, smear and bloom with the room.' },
  { id: 'volumetricClouds', stage: 'scene', toggles: ['volumetricClouds'], yieldsTo: ['airClouds'], required: false, needs: ['linearDepthHalf'], budgetMs: 6, typical: false, canBeLast: false, live: true, why: 'Cloud the sky is really made of rather than a sheet drawn across it: a raymarch through a slab overhead, lit by the very sun, ambient and haze the rest of the scene is lit by, which is how each world keeps its own colour with no table of its own. After the surface passes, so occlusion, blade light and reflections have already settled what the surfaces are, and after the heat, since the air sits between the heat and the eye; before the god rays, so the sky they are drawn from is the cloudy one and a broken deck makes shafts by itself; before depth of field, motion blur, bloom and the grade, so the clouds defocus, smear, spill and are graded with the picture. It marches at a fraction of the screen and comes back through a depth-aware upsample, since a plain one haloes every ridge. By far the most expensive pass here, which is why it is off by default and has a quality of its own.' },
  // The seventh wave's clouds: under the master (`requires`), the September pass yielding to them while they are wanted;
  // their budget High's overcast with the low deck, the smear and a live hole at 2560×1440 [ours, the design's §7].
  { id: 'airClouds', stage: 'scene', toggles: ['volClouds'], requires: ['volumetrics'], required: false, needs: ['linearDepthHalf'], budgetMs: 1.0, typical: false, canBeLast: false, live: true, why: "The sky's clouds marched as cloud (src/core/fx/airClouds.ts): the game's own cloud pictures per deck as a weather map over a 52 km square, heaps or a layer by each picture's kind, the wet overcast where a storm hangs none, drifting on the one wind aloft and smeared by its gusts at a cloud's scale; a low deck near the ground in rain and overcast, holed by every hull; lit by the dome's own sky with octaves of scattering and a history. Where the September clouds stand, and in their place while wanted (they yield to it); before the dust, so the farther layer is composited first; before the god rays, the lens and the grade. It marches at a share of the screen through an upsample of its own size, and refuses with a reason indoors, in space, under water, in a dust storm, at an amount of nought and with nothing to draw. Not typical: off by default under the master." },
  // The volume's budgets are the sixth wave's measurement (`air({ budget })`, High, the effects' line less the master
  // held off): 0.37 ms of the card at 2560×1440 and 0.17 at 1600×900 on Vulkan; Direct3D 11's line wanders by a quarter
  // of a millisecond between rows that are all High (0.03 to 0.56 ms, the middle about 0.3); and 0.01 to 0.04 ms of the
  // main thread. The moving air's own step is the frame report's air line, beside it (about 0.25 ms of the card at High).
  { id: 'airVolume', stage: 'scene', toggles: ['airVolume'], requires: ['volumetrics'], required: false, needs: ['linearDepthHalf'], budgetMs: 0.4, cpuBudgetMs: 0.05, typical: false, canBeLast: false, live: true, why: 'The dust the moving air carries (src/world/volumetrics/), marched through the band of air over the ground near you and integrated past it, lit by the very sun and ambient the scene is lit by, darkened by the dust between it and the sun and by the sun\'s own cascades, and composited as the scene times what it lets through plus what it scatters. After the clouds, so the nearer layer is composited last over the farther; before the god rays, the depth of field, the motion blur, the bloom and the grade, so the dust is rayed, defocused, smeared, spilled and graded with the picture. It marches at a share of the screen through an upsample of its own size, and refuses with a reason indoors, in space, under water, at an amount of nought and while nothing is airborne. Not typical: the typical frame has 0.07 ms left, and its cost is a line of the frame report of its own.' },
  { id: 'godRays', stage: 'scene', toggles: ['godRays'], required: false, needs: ['linearDepthHalf'], budgetMs: 0.25, typical: true, canBeLast: false, live: true, why: 'Scattered sunlight. Before depth of field, since rays are far light that should soften with the far background they overlay, and before the blur and the bloom so they smear and spill like the sun.' },
  { id: 'underwater', stage: 'scene', toggles: ['underwater'], required: false, needs: [], budgetMs: 0.12, typical: false, canBeLast: false, live: true, why: 'What the water between the eye and each pixel does to it, and the shimmer of the light bending through the ripples overhead. After the god rays, so scattered sunlight is graded by the water it comes through like anything else; before the lens, so the aperture and the shutter soften and smear what the water has already done. It reads the full-resolution scene depth itself and asks for no product, and it draws on no frame the camera is dry.' },
  { id: 'depthOfField', stage: 'lens', toggles: ['depthOfField'], required: false, needs: ['linearDepthHalf', 'dofGlow'], budgetMs: 0.35, typical: false, canBeLast: false, live: true, why: 'The aperture needs colour and depth aligned, so it comes before motion blur; before bloom so a defocused highlight blooms as a disc.' },
  { id: 'motionBlur', stage: 'lens', toggles: ['motionBlur'], required: false, needs: ['velocity'], budgetMs: 0.25, cpuBudgetMs: 0.2, typical: true, canBeLast: false, live: true, why: 'The shutter after the aperture, and before bloom: bloom first would smear the halo around a near engine glow by the depth of the ground behind it.' },
  { id: 'underwaterSpecks', stage: 'lens', toggles: ['underwater'], required: false, needs: [], budgetMs: 0.06, typical: false, canBeLast: false, live: true, why: 'The specks drifting in the water, added to the picture rather than seen through it, so they are drawn rather than sampled: the pass puts its own points straight into the buffer and tests the scene depth in its own fragment program. After the underwater look, whose grading reads the scene depth and would take the *background\'s* transmittance off every speck, leaving open water with almost none; after the aperture and the shutter, which would soften and smear each one by the depth and the movement of whatever lies behind it, and in open water, where the depth is the far plane, would turn every speck into a disc the moment the player aimed. Before bloom and the grade, so they spill and are graded with the picture. It asks for no product and draws on no frame the camera is not really under a surface.' },
  { id: 'bloom', stage: 'lens', toggles: ['bloom'], required: false, needs: [], budgetMs: 0.35, typical: true, canBeLast: false, live: true, why: 'Bright light scattering in the eye, so it needs the high range and must come before tone mapping, and after everything that adds or moves light so all of it spills. It composites in place.' },
  { id: 'lensFlare', stage: 'lens', toggles: ['lensFlare'], required: false, needs: [], budgetMs: 0.12, typical: true, canBeLast: false, live: true, why: 'Glare and ghosts are reflections inside the lens of the brightest sources. After bloom, so the flare is not thresholded and bloomed again and its ceiling sees the bloom it must not stack on; after the motion blur and depth of field, so it is neither smeared nor defocused; before grade and tone mapping, so it is graded and mapped with the picture.' },
  { id: 'colorGrade', stage: 'lens', toggles: ['colorGrade'], required: false, needs: [], budgetMs: 0.04, typical: true, canBeLast: false, live: true, why: 'Each planet’s white balance, tint, saturation and contrast in the linear high range, just before the tone curve, so the highlights roll off after grading rather than clipping.' },
  { id: 'output', stage: 'display', toggles: [], required: true, needs: [], budgetMs: 0.04, typical: true, canBeLast: true, live: true, why: 'Exposure, the tone curve and the colour space, exactly once on this path.' },
  { id: 'fxaa', stage: 'display', toggles: ['fxaa'], required: false, needs: [], budgetMs: 0.08, typical: true, canBeLast: true, live: true, why: 'Needs perceptual luma, so after the tone curve; before the grain, which it would take for aliasing and smear away.' },
  { id: 'grainVignette', stage: 'display', toggles: ['filmGrain', 'vignette'], required: false, needs: [], budgetMs: 0.1, typical: true, canBeLast: true, live: true, why: 'Last: grain over final display values keeps its look whatever the exposure, and the vignette falls off predictably in display space.' },
  { id: 'debugView', stage: 'display', toggles: [], required: false, needs: ['linearDepthHalf', 'normalsHalf', 'heat', 'debugMask', 'waterMask', 'velocity', 'dofGlow'], budgetMs: 0.03, typical: false, canBeLast: true, live: true, why: 'Replaces the picture with one of the shared products for inspection. Only a console override turns it on.' },
];

/**
 * What the water reflections read each frame, by trace resolution: the half-resolution trace marches
 * the half-resolution depth, the full one the scene's own. The row's `needs` is exactly their union,
 * and the mask carries the surface normals, so neither asks for `normalsHalf`.
 */
export const FX_WATER_NEEDS_HALF: readonly FxProductId[] = ['linearDepthHalf', 'waterMask'];
export const FX_WATER_NEEDS_FULL: readonly FxProductId[] = ['waterMask'];

/** Compute order: everything derived from depth first, then the products drawn with the scene's own geometry. */
export const FX_PRODUCTS: readonly FxProductDef[] = [
  { id: 'linearDepthHalf', kind: 'depth', needs: [], scale: 0.5, format: 'R32F', budgetMs: 0.03, typical: true, owner: 'spine', live: true },
  { id: 'normalsHalf', kind: 'depth', needs: ['linearDepthHalf'], scale: 0.5, format: 'RGBA8', budgetMs: 0.06, typical: true, owner: 'spine', live: true },
  { id: 'heat', kind: 'depth', needs: ['linearDepthHalf'], scale: 0.5, format: 'RGBA16F', budgetMs: 0.08, typical: false, owner: 'heatHaze', live: true },
  { id: 'debugMask', kind: 'geometry', needs: [], scale: 1, format: 'R8', budgetMs: 0.05, typical: false, owner: 'debugView', live: true },
  { id: 'waterMask', kind: 'geometry', needs: [], scale: 1, format: 'RGBA16F', targets: 3, budgetMs: 0.3, typical: false, owner: 'waterReflections', live: true },
  { id: 'velocity', kind: 'geometry', needs: [], scale: 1, format: 'RGBA16F', budgetMs: 0.1, cpuBudgetMs: 0.12, typical: true, owner: 'motionBlur', live: true },
  { id: 'dofGlow', kind: 'geometry', needs: [], scale: 1, format: 'R16F', budgetMs: 0.05, typical: false, owner: 'depthOfField', live: true },
];

/**
 * The most the effects may cost on the GPU in a typical outdoor daytime frame (walking in third
 * person, the sun on screen, no water and no heat in view, not aiming), at 2560x1440. The frame at
 * 144 a second is 6.94 ms, so this is under a third of it. `npm run test:fx` adds up every row
 * marked `typical` and fails if they pass it: a new effect that wants to be typical has to take its
 * milliseconds from the margin rather than from the total.
 */
export const FX_TYPICAL_BUDGET_MS = 2.0;

/**
 * The effects' main-thread budget in a typical outdoor daytime frame: about 32 full-screen draws at
 * 0.02-0.04 ms each and the velocity product's direct draws. `fxTiming` reports `postCpuOver` against
 * it, and `npm run test:velocity` checks every declared `cpuBudgetMs` adds up to no more.
 */
export const FX_TYPICAL_CPU_MS = 0.9;

/**
 * Camera layers an effect has claimed for itself, so no two claim the same one. 0 is the world,
 * 1 the rooms of a building and 31 the actors; 2 to 30 are free. This is the only place a layer is
 * named.
 *
 * `shadowOnly`: drawn into the shadow maps and in no view pass (the portal renderer's shadow camera
 * sees every layer; its view passes see 0 or 1 plus 31): what first person hides of the player
 * (`src/player/headHide.ts`).
 *
 * `shadowCast`: drawn into the shadow maps and in no view pass, as `shadowOnly` is, but warmed for no pass at all: a
 * region tier's still placed casters batched as one draw (`src/world/shadowBatches.ts`), whose colour program no frame
 * ever draws. Every layer named: 0 the world, 1 a building's rooms, 28 the shadow batches, 29 first person's hidden
 * head, 30 the heat, 31 the actors.
 */
export const FX_LAYERS = { heat: 30, shadowOnly: 29, shadowCast: 28 } as const;

/** A mask first person has put on the shadow-only layer: markActor leaves it, passesOf warms it as an actor's. */
export function isShadowOnly(mask: number): boolean {
  return (mask & (1 << FX_LAYERS.shadowOnly)) !== 0;
}

/** A mask on the shadow batches' layer and no other: drawn by the shadow pass alone, warmed for no view pass (`passesOf`). */
export function isShadowCast(mask: number): boolean {
  return mask === 1 << FX_LAYERS.shadowCast;
}

const DEFAULT_KEYS = new Set(Object.keys(FX_DEFAULTS));

export function isFxSettingKey(key: string): key is keyof FxSettings {
  return DEFAULT_KEYS.has(key);
}

const PASS_BY_ID = new Map<FxPassId, FxPassDef>(FX_PASSES.map((p) => [p.id, p]));
const PASS_INDEX = new Map<FxPassId, number>(FX_PASSES.map((p, i) => [p.id, i]));
const PRODUCT_BY_ID = new Map<FxProductId, FxProductDef>(FX_PRODUCTS.map((p) => [p.id, p]));

export function fxPassDef(id: FxPassId): FxPassDef {
  const def = PASS_BY_ID.get(id);
  if (!def) throw new Error(`fx: no pass "${id}" in the registry`);
  return def;
}

export function fxProductDef(id: FxProductId): FxProductDef {
  const def = PRODUCT_BY_ID.get(id);
  if (!def) throw new Error(`fx: no product "${id}" in the registry`);
  return def;
}

/**
 * Whether a pass's settings ask for it (with a console override, when one is given): the one rule `PostFX.passWanted`
 * and the frame's own decision both ask. A pass that requires a key that is off is not wanted, whatever else says
 * so; past that, a required pass always is, and any other when one of its toggles is on, unless the console says
 * otherwise. For every pass with no `requires`, this is the rule as it always stood.
 */
export function fxPassWanted(def: FxPassDef, settings: FxSettings, override?: boolean, yielded?: (id: FxPassId) => boolean): boolean {
  const req = def.requires;
  if (req) for (let i = 0; i < req.length; i++) if (!settings[req[i]]) return false;
  // A pass yields while a pass it yields to is wanted (the September clouds to the volumetrics' own): asked of the chain
  // (`yielded`, which also says whether that pass is on the chain at all) or, with none handed, of the registry's own
  // rule over the settings alone. Only the September row has any, so every other pass decides exactly as it always did.
  const ys = def.yieldsTo;
  if (ys) {
    for (let i = 0; i < ys.length; i++) {
      const y = ys[i];
      if (yielded ? yielded(y) : fxPassWanted(fxPassDef(y), settings)) return false;
    }
  }
  if (def.required) return true;
  let setting = false;
  const toggles = def.toggles;
  for (let i = 0; i < toggles.length; i++) {
    if (settings[toggles[i]]) {
      setting = true;
      break;
    }
  }
  return override ?? setting;
}

export function fxPassIndex(id: FxPassId): number {
  const i = PASS_INDEX.get(id);
  if (i === undefined) throw new Error(`fx: no pass "${id}" in the registry`);
  return i;
}
