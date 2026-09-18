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
}

export type FxPassId =
  | 'sanitize'
  | 'ssao'
  | 'bladeGlow'
  | 'waterReflections'
  | 'heatHaze'
  | 'lightShafts'
  | 'godRays'
  | 'depthOfField'
  | 'motionBlur'
  | 'bloom'
  | 'lensFlare'
  | 'colorGrade'
  | 'output'
  | 'fxaa'
  | 'grainVignette'
  | 'debugView';

export type FxProductId = 'linearDepthHalf' | 'normalsHalf' | 'heat' | 'debugMask' | 'waterMask' | 'velocity';

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
  format: 'R32F' | 'RGBA8' | 'R8' | 'RG8' | 'RG16F' | 'RGBA16F';
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
  lightShafts: true,
  lightShaftStrength: 0.8,
  roomGlowStrength: 0.5,
  roomMotes: true,
  roomMoteAmount: 1,
  godRays: true,
  godRayStrength: 0.6,
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
};

const two = (v: number) => v.toFixed(2);
const half = [
  { value: 0.5, label: 'Half (faster)' },
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
  { key: 'lightShafts', pass: 'lightShafts', label: 'Light shafts', kind: 'toggle', requires: ['effects'], hint: 'Daylight through the doorways of the room you are in: a beam in the dusty air and a bright patch where it lands; and a soft glow in the air around the room\'s own lamps.' },
  { key: 'lightShaftStrength', pass: 'lightShafts', label: 'Light shaft strength', kind: 'range', min: 0, max: 1.5, step: 0.05, format: two, requires: ['effects', 'lightShafts'], hint: '0.4 clean air, 0.8 a dusty cantina, 1.2 a smoky hall.' },
  { key: 'roomGlowStrength', pass: 'lightShafts', label: 'Lamp glow', kind: 'range', min: 0, max: 1.5, step: 0.05, format: two, requires: ['effects', 'lightShafts'], hint: 'The haze around a room\'s lamps and in the depth of a lit hall, in the room\'s own colours; 0 turns it off.' },
  { key: 'roomMotes', pass: null, label: 'Dust motes', kind: 'toggle', requires: [], hint: 'Specks of dust drifting in rooms and aboard ships, glinting where daylight or a lamp catches them. Works with Effects off.' },
  { key: 'roomMoteAmount', pass: null, label: 'Dust mote amount', kind: 'range', min: 0.25, max: 2, step: 0.05, format: (v) => `${Math.round(v * 1500)}`, requires: ['roomMotes'], hint: 'How many motes hang in the air around you.' },
  { key: 'godRays', pass: 'godRays', label: 'God rays', kind: 'toggle', requires: ['effects'], hint: 'Sunlight scattered towards you where the sky shows between trees, walls and hulls.' },
  { key: 'godRayStrength', pass: 'godRays', label: 'God ray strength', kind: 'range', min: 0.1, max: 1.5, step: 0.05, format: two, requires: ['effects', 'godRays'], hint: '0.3 a hint, 0.6 a morning, 1.2 a blaze.' },
  { key: 'depthOfField', pass: 'depthOfField', label: 'Depth of field', kind: 'toggle', requires: ['effects'], hint: 'Aiming down the sights, what is not at the range you are aiming at softens.' },
  { key: 'depthOfFieldStrength', pass: 'depthOfField', label: 'Depth of field strength', kind: 'range', min: 0, max: 2, step: 0.05, format: two, requires: ['effects', 'depthOfField'], hint: 'How wide the aperture is: 0.5 a touch, 1 a camera, 2 a long lens.' },
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
  { id: 'godRays', stage: 'scene', toggles: ['godRays'], required: false, needs: ['linearDepthHalf'], budgetMs: 0.25, typical: true, canBeLast: false, live: true, why: 'Scattered sunlight. Before depth of field, since rays are far light that should soften with the far background they overlay, and before the blur and the bloom so they smear and spill like the sun.' },
  { id: 'depthOfField', stage: 'lens', toggles: ['depthOfField'], required: false, needs: ['linearDepthHalf'], budgetMs: 0.35, typical: false, canBeLast: false, live: false, why: 'The aperture needs colour and depth still lined up, so it comes before the blur, which moves colour off its depth; before bloom so a softened highlight blooms as a disc rather than a point.' },
  { id: 'motionBlur', stage: 'lens', toggles: ['motionBlur'], required: false, needs: ['velocity'], budgetMs: 0.25, cpuBudgetMs: 0.2, typical: true, canBeLast: false, live: true, why: 'The shutter after the aperture, and before bloom: bloom first would smear the halo around a near engine glow by the depth of the ground behind it.' },
  { id: 'bloom', stage: 'lens', toggles: ['bloom'], required: false, needs: [], budgetMs: 0.35, typical: true, canBeLast: false, live: true, why: 'Bright light scattering in the eye, so it needs the high range and must come before tone mapping, and after everything that adds or moves light so all of it spills. It composites in place.' },
  { id: 'lensFlare', stage: 'lens', toggles: ['lensFlare'], required: false, needs: [], budgetMs: 0.12, typical: true, canBeLast: false, live: true, why: 'Glare and ghosts are reflections inside the lens of the brightest sources. After bloom, so the flare is not thresholded and bloomed again and its ceiling sees the bloom it must not stack on; after the motion blur and depth of field, so it is neither smeared nor defocused; before grade and tone mapping, so it is graded and mapped with the picture.' },
  { id: 'colorGrade', stage: 'lens', toggles: ['colorGrade'], required: false, needs: [], budgetMs: 0.04, typical: true, canBeLast: false, live: true, why: 'Each planet’s white balance, tint, saturation and contrast in the linear high range, just before the tone curve, so the highlights roll off after grading rather than clipping.' },
  { id: 'output', stage: 'display', toggles: [], required: true, needs: [], budgetMs: 0.04, typical: true, canBeLast: true, live: true, why: 'Exposure, the tone curve and the colour space, exactly once on this path.' },
  { id: 'fxaa', stage: 'display', toggles: ['fxaa'], required: false, needs: [], budgetMs: 0.08, typical: true, canBeLast: true, live: true, why: 'Needs perceptual luma, so after the tone curve; before the grain, which it would take for aliasing and smear away.' },
  { id: 'grainVignette', stage: 'display', toggles: ['filmGrain', 'vignette'], required: false, needs: [], budgetMs: 0.1, typical: true, canBeLast: true, live: true, why: 'Last: grain over final display values keeps its look whatever the exposure, and the vignette falls off predictably in display space.' },
  { id: 'debugView', stage: 'display', toggles: [], required: false, needs: ['linearDepthHalf', 'normalsHalf', 'heat', 'debugMask', 'waterMask', 'velocity'], budgetMs: 0.03, typical: false, canBeLast: true, live: true, why: 'Replaces the picture with one of the shared products for inspection. Only a console override turns it on.' },
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
 */
export const FX_LAYERS = { heat: 30 } as const;

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

export function fxPassIndex(id: FxPassId): number {
  const i = PASS_INDEX.get(id);
  if (i === undefined) throw new Error(`fx: no pass "${id}" in the registry`);
  return i;
}
