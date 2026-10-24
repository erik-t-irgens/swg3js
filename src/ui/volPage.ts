// The Graphics page's Volumetrics sections: the master and the preset, the dust in the picture, the moving air and
// what it carries (each with its own detail), how much is laid over the game's own art, and what may stir the air. A
// file of its own for the reason the Flora section's is (`floraPage.ts`): `menu.ts` reaches for `document` and cannot
// be imported by a node test, and the test is what keeps a knob's ends and the range the console reads the same
// numbers (`VOL_RANGES`). Nothing here touches the page.
//
// The master and the volume's own rows are the effects registry's (`FX_KNOBS`, `group: 'volumetrics'`), taken from
// there so a row and its setting cannot drift apart and the Effects section leaves them out. A row shows only from
// the wave that builds what it moves: the later waves' rows (the ground, smoke and fog, water and lava, the grass)
// are not in this build at all, so no switch here does nothing.
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
      { key: 'volDust', label: 'Dust', kind: 'toggle', requires: ['volumetrics', 'volAir'], hint: 'The air carries dust: off sand and dirt under engines and blasts, none off rock, paving or water, and a storm\'s on the wind. Off, the air moves with nothing in it.' },
      { key: 'volDustDetail', label: 'Dust detail', kind: 'select', options: R.volDustDetail.options.map((v) => ({ value: v, label: times(v) })), requires: ['volumetrics', 'volAir', 'volDust'], hint: 'The dust\'s own grid over the air\'s: ×4 is 37.5 cm at the default air detail. Finer shows finer wisps.' },
      { key: 'volKickUp', label: 'Grains that fall back', kind: 'toggle', requires: ['volumetrics', 'volAir', 'volDust'], hint: 'The motes a machine throws behind it are sand that flies up and falls back to the ground, and a blast throws a shower of it. Off, they are the motes that only rise, as before; either way none come off rock, paving or water while the dust is on.' },
      { key: 'volLight', label: 'Dust shades itself', kind: 'toggle', requires: ['volumetrics', 'volAir'], hint: 'The dust between a cloud and the sun darkens it: a lit face toward the sun and a dark heart. Off, all of it is lit alike.' },
      { key: 'volLightDetail', label: 'Dust shading detail', kind: 'select', options: R.volLightDetail.options.map((v) => ({ value: v, label: times(v) })), requires: ['volumetrics', 'volAir', 'volLight'], hint: 'The shading\'s grid over the air\'s.' },
      { key: 'volLightSteps', label: 'Dust shading steps', kind: 'range', min: R.volLightSteps.min, max: R.volLightSteps.max, step: R.volLightSteps.step, format: (v) => `${v}`, requires: ['volumetrics', 'volAir', 'volLight'], hint: 'Steps toward the sun; fewer are longer, so the shade reaches as far either way.' },
    ],
  },
  {
    title: 'Over the game\'s own art',
    knobs: [
      fxKnob('airVolumeAmount'),
      { key: 'volStormThin', label: 'Storm sheets thinned', kind: 'range', min: R.volStormThin.min, max: R.volStormThin.max, step: R.volStormThin.step, format: (v) => `${Math.round(v * 100)}%`, requires: ['volumetrics'], hint: 'While the dust draws a dust storm, the game\'s own storm sheets thin by this much: 0 keeps them as they are, 100% stands them down. Half, to begin with, since their streaks show the wind at a scale the air cannot.' },
    ],
  },
  {
    title: 'What stirs the air',
    knobs: [
      { key: 'volFromEngines', label: 'Engines', kind: 'toggle', requires: ['volumetrics', 'volAir'], hint: 'Every engine near you blows the air, and a ship or a flyer holding itself up blows down under it.' },
      { key: 'volFromForce', label: 'The Force', kind: 'toggle', requires: ['volumetrics', 'volAir'], hint: 'A push shoves the air along its cone, a pull draws it back, a repulse rings it away.' },
      { key: 'volFromBlasts', label: 'Blasts', kind: 'toggle', requires: ['volumetrics', 'volAir'], hint: 'Grenades, mines, charges, a gun\'s splash and a wreck blow the air outward and lift dust.' },
    ],
  },
];

/** Every key the sections show, the preset row aside. */
export const VOL_PAGE_KEYS: readonly (keyof Settings)[] = VOLUMETRICS.flatMap((g) => g.knobs.filter((k) => k.kind !== 'preset').map((k) => k.key));
