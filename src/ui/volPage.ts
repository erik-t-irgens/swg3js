// The Graphics page's Volumetrics sections: the master and the preset, the dust in the picture, the moving air and
// what it carries (each with its own detail), how much is laid over the game's own art, and what may stir the air. A
// file of its own for the reason the Flora section's is (`floraPage.ts`): `menu.ts` reaches for `document` and cannot
// be imported by a node test, and the test is what keeps a knob's ends and the range the console reads the same
// numbers (`VOL_RANGES`). Nothing here touches the page.
//
// The master and the volume's own rows are the effects registry's (`FX_KNOBS`, `group: 'volumetrics'`), taken from
// there so a row and its setting cannot drift apart and the Effects section leaves them out. A row shows only from
// the wave that builds what it moves: the later waves' rows (water and lava, the grass, the wind and the clouds) are not
// in this build at all, so no switch here does nothing.
import { FX_KNOBS, type FxKnobDef } from '../core/fxRegistry.ts';
import type { Settings } from '../core/settings.ts';
import { VOL_PRESET_LABELS, VOL_PRESET_NAMES, VOL_PRESETS, VOL_RANGES, presetOf } from '../world/volumetrics/volSettings.ts';
import type { Knob } from './hudPage.ts';

const R = VOL_RANGES;

/** An effects row as a page knob. */
function fxKnob(key: FxKnobDef['key']): Knob {
  const k = FX_KNOBS.find((f) => f.key === key);
  if (!k) throw new Error(`volPage: no effects row for "${key}"`);
  return { key: k.key, label: k.label, hint: k.hint, kind: k.kind, min: k.min, max: k.max, step: k.step, options: k.options, format: k.format, requires: k.requires };
}

const times = (v: number): string => `×${v}`;
const cellOf = (n: number): string => `${n} cells (${(192 / n).toFixed(1)} m)`;

/** The preset row: worked out from the dials, never stored (`presetOf`). */
const PRESET: Knob = {
  key: 'volumetrics',
  label: 'Quality',
  hint: 'Sets every detail below together: Low for a weaker card, Ultra for a strong one. It never touches a switch or how much is laid over the art. Move any detail on its own and this reads Custom.',
  kind: 'preset',
  presets: VOL_PRESET_NAMES.map((name) => ({ name, label: VOL_PRESET_LABELS[name], values: VOL_PRESETS[name] })),
  presetOf: (s: Settings) => presetOf(s),
  otherLabel: VOL_PRESET_LABELS.custom,
  requires: ['volumetrics'],
};

export const VOLUMETRICS: readonly { title: string; knobs: readonly Knob[] }[] = [
  {
    title: 'Volumetrics',
    knobs: [fxKnob('volumetrics'), PRESET],
  },
  {
    title: 'Dust in the picture',
    knobs: [fxKnob('airVolume'), fxKnob('airVolumeResolution'), fxKnob('airVolumeSteps'), fxKnob('airVolumeHistory'), fxKnob('airVolumeShadows')],
  },
  {
    title: 'The moving air',
    knobs: [
      { key: 'volAir', label: 'Moving air', kind: 'toggle', requires: ['volumetrics'], hint: 'One layer of air over the ground near you, blown by the planet\'s own wind and gusts, stirred by engines, blasts and the Force, flowing round buildings rather than through them. Off, nothing airborne moves and no dust is lifted. It is worked out only while something draws it -- in this first wave the dust in the picture, which needs Effects -- and nothing of it runs indoors or in space.' },
      { key: 'volAirDetail', label: 'Air detail', kind: 'select', options: R.volAirDetail.options.map((v) => ({ value: v, label: cellOf(v) })), requires: ['volumetrics', 'volAir'], hint: 'How finely the air is worked out over the 192 m square that follows you. Finer swirls smaller; it costs little either way.' },
      { key: 'volAirSolve', label: 'Air pressure steps', kind: 'range', min: R.volAirSolve.min, max: R.volAirSolve.max, step: R.volAirSolve.step, format: (v) => `${v}`, requires: ['volumetrics', 'volAir'], hint: 'How carefully the air is kept from piling up: more makes it flow round buildings and out from under a jet more truly. The dearest part of the air, and still cheap.' },
      { key: 'volAirRate', label: 'Air rate', kind: 'select', options: R.volAirRate.options.map((v) => ({ value: v, label: `${v} a second` })), requires: ['volumetrics', 'volAir'], hint: 'How often the air is worked out. The dust it carries moves every frame either way, so 30 is smooth too.' },
      { key: 'volAirLayers', label: 'Layers of air', kind: 'select', options: R.volAirLayers.options.map((v) => ({ value: v, label: v === 1 ? 'One (to 3.5 m)' : v === 2 ? 'Two (to 9 m)' : 'Three (to 16 m)' })), requires: ['volumetrics', 'volAir'], hint: 'How many layers of air are worked out, one over the other: near the ground the wind is slower, higher up faster, so smoke bends over as it rises and a jet at the ground does not stir smoke fifteen metres up. With fewer, the highest worked out stands in for the rest.' },
      { key: 'volDust', label: 'Dust', kind: 'toggle', requires: ['volumetrics', 'volAir'], hint: 'The air carries dust: off sand and dirt under engines and blasts, none off rock, paving or water, and a storm\'s on the wind. Off, the air moves with nothing in it.' },
      { key: 'volDustDetail', label: 'Dust detail', kind: 'select', options: R.volDustDetail.options.map((v) => ({ value: v, label: times(v) })), requires: ['volumetrics', 'volAir', 'volDust'], hint: 'The dust\'s own grid over the air\'s: ×4 is 37.5 cm at the default air detail. Finer shows finer wisps.' },
      { key: 'volDustWisps', label: 'Wisps', kind: 'select', options: R.volDustWisps.options.map((v) => ({ value: v, label: ['Off', 'Bands (cheap)', 'Noise', 'Noise ×2 (dearest)'][v] ?? `${v}` })), requires: ['volumetrics', 'volAir', 'volDust'], hint: 'The dust and the fog break into curling wisps carried by the air, more at a cloud\'s top and bottom and more as it ages, so a cloud is no longer full from top to bottom. Bands is the cheap road, its curls only as fine as four heights; noise ×2 adds a finer layer running on the air above.' },
      { key: 'volDustLayers', label: 'A dust field a layer (Ultra)', kind: 'toggle', requires: ['volumetrics', 'volAir', 'volDust'], hint: 'The dust kept apart in each layer of air rather than in one field carrying how high each cloud stands, so a storm\'s high dust really runs ahead of its low dust. Three times the dust\'s memory and its passes; off but on Ultra.' },
      { key: 'volKickUp', label: 'Grains that fall back', kind: 'toggle', requires: ['volumetrics', 'volAir', 'volDust'], hint: 'The motes a machine throws behind it are sand that flies up and falls back to the ground, and a blast throws a shower of it: only a few off rock and paving (a tenth of sand\'s to start, a dial), and none over water. Off, they are the motes that only rise, as before, and none of those come off rock, paving or water while the dust is on.' },
      { key: 'volLight', label: 'Dust shades itself', kind: 'toggle', requires: ['volumetrics', 'volAir'], hint: 'The dust between a cloud and the sun darkens it: a lit face toward the sun and a dark heart. Off, all of it is lit alike.' },
      { key: 'volLightDetail', label: 'Dust shading detail', kind: 'select', options: R.volLightDetail.options.map((v) => ({ value: v, label: times(v) })), requires: ['volumetrics', 'volAir', 'volLight'], hint: 'The shading\'s grid over the air\'s.' },
      { key: 'volLightSteps', label: 'Dust shading steps', kind: 'range', min: R.volLightSteps.min, max: R.volLightSteps.max, step: R.volLightSteps.step, format: (v) => `${v}`, requires: ['volumetrics', 'volAir', 'volLight'], hint: 'Steps toward the sun; fewer are longer, so the shade reaches as far either way.' },
    ],
  },
  {
    title: 'Smoke and fog',
    knobs: [
      { key: 'volSmoke', label: 'Smoke', kind: 'toggle', requires: ['volumetrics', 'volAir'], hint: 'Blasts, wrecks, burning engines and gas grenades leave smoke the air carries, climbing and bending over with the wind. A gas cloud is drawn as its smoke while this shows it, and as its puffs whenever it does not; what it does to whoever stands in it never changes.' },
      { key: 'volFog', label: 'Ground fog', kind: 'toggle', requires: ['volumetrics', 'volAir'], hint: 'On a foggy morning or evening (some worlds often, some sometimes, Tatooine, Lok and Mustafar never; every player on a server sees the same days) fog comes in on the wind and rises off the ground in banks with gaps between them, pooling in hollows and burning off as the morning warms.' },
      { key: 'volSmokeDetail', label: 'Smoke and fog detail', kind: 'select', options: R.volSmokeDetail.options.map((v) => ({ value: v, label: times(v) })), requires: ['volumetrics', 'volAir'], hint: 'The smoke\'s and the fog\'s own grid over the air\'s.' },
    ],
  },
  {
    title: 'What the air carries besides dust',
    knobs: [
      { key: 'volParticles', label: 'Leaves, puffs and spray', kind: 'toggle', requires: ['volumetrics', 'volAir'], hint: 'The air carries things besides its dust: leaves off grass and forest floor, puffs of the game\'s own sand cloud off sand, spray off water, and fine streaks of blowing sand -- thrown up by engines, blasts, the Force and running feet, and picked up by a gust or a storm with nothing near. They swirl in the same air the dust does, settle, and blow on again.' },
      { key: 'volLeaves', label: 'Leaves', kind: 'toggle', requires: ['volumetrics', 'volAir', 'volParticles'], hint: 'Leaves off grass and forest floor, in the game\'s own leaf picture tinted toward the ground they came off. They flutter down, lie a few seconds and blow on again as a speeder passes.' },
      { key: 'volPuffs', label: 'Puffs of sand', kind: 'toggle', requires: ['volumetrics', 'volAir', 'volParticles'], hint: 'Puffs of the game\'s own sand cloud off sand, ash and dirt, in the dust\'s own colour, for depth in a trail or a blast.' },
      { key: 'volSpray', label: 'Spray', kind: 'toggle', requires: ['volumetrics', 'volAir', 'volParticles'], hint: 'Spray off water: thrown up under a hovering ship, by a blast, and behind any machine crossing water as the game\'s own vehicle trail was (its look; its picture is not in the converted packs, so the fountains\' spray picture stands in). Water throws water and never sand or dust.' },
      { key: 'volStreaks', label: 'Fine streaks', kind: 'toggle', requires: ['volumetrics', 'volAir', 'volParticles'], hint: 'Thin streaks of blowing sand, of our own drawing, carried by the air and stretched along their own motion, apart from the mass of dust: lifted in a dust storm and in a strong wash of an engine or a blast.' },
      { key: 'volParticleDetail', label: 'How many', kind: 'select', options: R.volParticleDetail.options.map((v) => ({ value: v, label: v === 0.5 ? 'Half' : v === 1 ? 'High\'s' : 'Twice' })), requires: ['volumetrics', 'volAir', 'volParticles'], hint: 'How many the air holds at most: at High 2,048 leaves, 256 puffs, 1,024 drops of spray and 1,024 streaks.' },
      { key: 'volParticleShadows', label: 'Leaves in shadow', kind: 'toggle', requires: ['volumetrics', 'volAir', 'volParticles', 'volLeaves'], hint: 'A leaf in the shade of a tree or a wall is darkened as a leaf of the trees is. They cast no shadow of their own.' },
      { key: 'volRain', label: 'Rain', kind: 'toggle', requires: ['volumetrics'], hint: 'Rain of our own drawing near you, carried by the air: it leans in a gust, sweeps round a corner, thins in a building\'s lee and stops under roofs. It falls with the moving air off too (on the wind alone), and through a doorway seen from inside.' },
      { key: 'volSnow', label: 'Snow', kind: 'toggle', requires: ['volumetrics'], hint: 'Snow by the same drops, drifting on the air. Off to begin with: the game\'s own snow is untouched until you turn ours on.' },
      { key: 'volRainDetail', label: 'Rain detail', kind: 'select', options: R.volRainDetail.options.map((v) => ({ value: v, label: `${v.toLocaleString('en-GB')} drops` })), requires: ['volumetrics'], hint: 'How many drops stand in the box round you (64 m across).' },
    ],
  },
  {
    title: "The dust's look",
    knobs: [
      { key: 'volDustBright', label: 'Dust brightness', kind: 'range', min: R.volDustBright.min, max: R.volDustBright.max, step: R.volDustBright.step, format: (v) => `${Math.round(v * 100)}%`, requires: ['volumetrics', 'volAir', 'volDust'], hint: 'How bright the dust is drawn, its sunlit side and its shade alike. At 60% fresh dust on sand at noon is about as bright as the sand it came off; at 100% it is lit as the first dust was, brighter than its ground.' },
      { key: 'volDustSelfShadow', label: 'Strength of the dust\'s own shade', kind: 'range', min: R.volDustSelfShadow.min, max: R.volDustSelfShadow.max, step: R.volDustSelfShadow.step, format: (v) => `${Math.round(v * 100)}%`, requires: ['volumetrics', 'volAir', 'volLight'], hint: 'How strongly the dust between a cloud and the sun darkens it. At 100% exactly as much light is lost on the way in as the dust takes from what you see through it; less lightens the dark heart, more deepens it.' },
    ],
  },
  {
    title: 'The ground',
    knobs: [
      { key: 'volSand', label: 'Blowing sand', kind: 'toggle', requires: ['volumetrics'], hint: 'Blowing sand streaks over sand, snow, ash and dirt where a jet or a gale passes, and stops a moment after; the ground\'s own picture never moves, and mud, wet sand, rock and paving never blow. On the ground the client draws its own way (every converted world); a world drawn the older way or a real-elevation one keeps its ground as it is.' },
      { key: 'volSandDetail', label: 'Blowing sand detail', kind: 'select', options: R.volSandDetail.options.map((v) => ({ value: v, label: times(v) })), requires: ['volumetrics', 'volSand'], hint: 'The blowing sand\'s own grid over the air\'s: ×4 is 37.5 cm at the default air detail.' },
      { key: 'volPrints', label: 'Prints and pits', kind: 'toggle', requires: ['volumetrics'], hint: 'Ruts behind a speeder, a pit scoured under a hovering ship, a crater where a grenade went off, and footprints pressed into sand, snow, mud and dirt (in place of the flat print there), each by how deep the ground gives, healing over half a minute. Rock and paving take none, and a foot there leaves the print it always did.' },
      { key: 'volPrintDetail', label: 'Prints detail', kind: 'select', options: R.volPrintDetail.options.map((v) => ({ value: v, label: `${v} (${((128 / v) * 100).toFixed(1)} cm)` })), requires: ['volumetrics', 'volPrints'], hint: 'How finely the marks are kept over the 128 m square round you. 4096 is 67 MB on the card.' },
    ],
  },
  {
    title: 'Over the game\'s own art',
    knobs: [
      fxKnob('airVolumeAmount'),
      { key: 'volStormThin', label: 'Storm sheets thinned', kind: 'range', min: R.volStormThin.min, max: R.volStormThin.max, step: R.volStormThin.step, format: (v) => `${Math.round(v * 100)}%`, requires: ['volumetrics'], hint: 'While the dust draws a dust storm, the game\'s own storm sheets thin by this much: 0 keeps them as they are, 100% stands them down. Half, to begin with, since their streaks show the wind at a scale the air cannot.' },
      { key: 'volArtSand', label: 'Blowing sand over the ground', kind: 'range', min: R.volArtSand.min, max: R.volArtSand.max, step: R.volArtSand.step, format: (v) => `${Math.round(v * 100)}%`, requires: ['volumetrics', 'volSand'], hint: 'How strongly the blowing sand shows. 0 leaves the ground exactly as it is.' },
      { key: 'volArtPrints', label: 'Prints over the ground', kind: 'range', min: R.volArtPrints.min, max: R.volArtPrints.max, step: R.volArtPrints.step, format: (v) => `${Math.round(v * 100)}%`, requires: ['volumetrics', 'volPrints'], hint: 'How deep the prints, ruts and pits read: the light they bend and how much darker pressed ground is. 0 leaves the ground exactly as it is, and every footprint is the flat print it always was.' },
      { key: 'volArtShade', label: 'Dust shades the ground', kind: 'range', min: R.volArtShade.min, max: R.volArtShade.max, step: R.volArtShade.step, format: (v) => `${Math.round(v * 100)}%`, requires: ['volumetrics', 'volLight'], hint: 'How much of the sun the dust between the ground and the sun takes off the ground under it, while the dust is drawn. 0 leaves the ground\'s light exactly as it is.' },
      { key: 'volRainThin', label: 'Rain sheets stood down', kind: 'range', min: R.volRainThin.min, max: R.volRainThin.max, step: R.volRainThin.step, format: (v) => `${Math.round(v * 100)}%`, requires: ['volumetrics', 'volRain'], hint: 'While our rain falls, the game\'s own rain sheets stand down by this much: 100% to begin with, since their one lean for the whole sky against each drop\'s own lean in a gust reads as two rains; 0 keeps them.' },
      { key: 'volSnowThin', label: 'Snow sheets stood down', kind: 'range', min: R.volSnowThin.min, max: R.volSnowThin.max, step: R.volSnowThin.step, format: (v) => `${Math.round(v * 100)}%`, requires: ['volumetrics', 'volSnow'], hint: 'While our snow falls, the game\'s own snow sheets stand down by this much. With our snow off they are untouched whatever this says.' },
    ],
  },
  {
    title: 'What stirs the air',
    knobs: [
      { key: 'volFromEngines', label: 'Engines', kind: 'toggle', requires: ['volumetrics', 'volAir'], hint: 'Every engine near you blows the air, and a ship or a flyer holding itself up blows down under it.' },
      { key: 'volFromForce', label: 'The Force', kind: 'toggle', requires: ['volumetrics', 'volAir'], hint: 'A push sends a wave of air out along its cone over about a second, raising a band of dust as it runs; a pull rolls one in toward you from its reach; a repulse opens a ring with its middle clear.' },
      { key: 'volFromBlasts', label: 'Blasts', kind: 'toggle', requires: ['volumetrics', 'volAir'], hint: 'Grenades, mines, charges, a gun\'s splash and a wreck blow the air outward and lift dust.' },
      { key: 'volFromFeet', label: 'Feet', kind: 'toggle', requires: ['volumetrics'], hint: 'A foot on sand, snow, mud or dirt near you presses a print into the ground in place of the flat print laid there before (with the prints on), and a running foot kicks up a couple of leaves off grass and spray where it wades (with the leaves or spray on). Off, every footprint is the flat one and nothing is kicked up.' },
    ],
  },
];

/** Every key the sections show, the preset row aside. */
export const VOL_PAGE_KEYS: readonly (keyof Settings)[] = VOLUMETRICS.flatMap((g) => g.knobs.filter((k) => k.kind !== 'preset').map((k) => k.key));
