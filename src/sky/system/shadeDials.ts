// The light between the bodies' dials and console (the GPU port's sky round, maker L): `skyShade.ts`' `SHADE_TUNE` on sliders in
// the debug menu when `sky` is picked (the sky's own set, `SKY_DIAL_GROUPS`), each set through `tuneShade`, exactly as
// `__debug.sky({ shade: { shadows, band, ring, reachKm, floor, worldScale, innerShare } })` sets it, so the menu's copied line is that
// helper's own argument; `__debug.sky({ shade: true })` says the light now (each sun's direct and air's light, the occluders,
// every shadowed body's casters, the radii) and the suns the applied system gave the world (`systemSuns.ts`). Feel and look are
// the owner's: each dial starts where `skyShade.ts` says, with its reason.
//
// Pure: no three, no DOM.
import type { DialGroup, NumberDial } from '../../ui/dials.ts';
import { SKY_DIAL_GROUPS } from '../skyDials.ts';
import { SHADE_RANGE, SHADE_TUNE, tuneShade, type SkyShade } from './skyShade.ts';
import { SYSTEM_SUNS_SAID } from './systemSuns.ts';

type Key = keyof typeof SHADE_TUNE;

function dial(k: Key, label: string, step: number, note: string): NumberDial {
  const r = SHADE_RANGE[k];
  return { kind: 'number', key: `shade.${k}`, label, note, min: r[0], max: r[1], step, unit: '', get: () => SHADE_TUNE[k], set: (v) => tuneShade({ [k]: v }) };
}

/** The shade's group of the sky's dials. */
export function shadeDialGroup(): DialGroup {
  return {
    title: 'Shadows, eclipses and the night floor (an applied star system)',
    note: "Only a world whose star system the viewer's Apply and Save to game applied: the bodies' shadows on each other, an eclipse's fade and darkness, and the floor under a moonless night.",
    dials: [
      dial('shadows', 'Shadows between bodies', 0.05, "How much of a body's shadow on another is drawn: 1 the share of the star's disc the caster really covers there; 0 none."),
      dial('band', 'Eclipse band through air', 1, "An air body's limb band, through which a sun fades and reddens, as a multiple of its air's true depth (six scale heights): 30 spans about three of the sun's diameters on Endor's giant; 0 a hard cut."),
      dial('ring', 'Light bent into a full shadow', 0.00001, "The share of the sunlight an occluder's air bends into its full shadow, reddened (a totally eclipsed moon's light, and from inside a giant's shadow the red ring drawn at its limb, its light falling on the land as the sky's): 0.0001 is about Earth's; 0 black."),
      dial('reachKm', 'Visible air (km)', 10, "How far round the play area the air whose light reaches the eye is counted: a shadow wider than this swallows the sky, a narrower one leaves a bright ring at the horizon."),
      dial('floor', 'Night floor', 0.005, "Starlight, airglow and the Milky Way under every applied system's night, as a share of today's full-moon night (every night's light before an applied system): 1 keeps a moonless night readable 20 m off; real skies give about 0.01."),
      dial('worldScale', "The world's own shadow", 0.1, 'The world you stand on casts its shadow on its moons at this share of its true radius (its moons are drawn many times a true moon\'s size).'),
      // (the sky round's fixer)
      dial('innerShare', "The band's red inner part", 0.01, "The share of an air body's band, from its limb up, through which the sun comes deep in the air and reddened: a third (its lowest two of six scale heights) turns the fade red as a sunset does; more reddens longer, less keeps the fade white to the last."),
    ],
  };
}

SKY_DIAL_GROUPS.push(shadeDialGroup);

/** `__debug.sky({ shade })`: `true` says the light between the bodies now; a record moves its dials first. */
export function shadeConsole(arg: unknown, m: { shade: SkyShade | null; items: readonly { name: string }[] } | null): Record<string, unknown> {
  const said = arg && typeof arg === 'object' ? tuneShade(arg) : [];
  return {
    ...(said.length ? { said } : {}),
    shade: m && m.shade ? m.shade.report(m) : 'none: this world follows no applied star system, or the renderer is WebGL',
    suns: { ...SYSTEM_SUNS_SAID },
    tune: { ...SHADE_TUNE },
  };
}
