// The air's own dials (the GPU port's pass 2, wave 1; the owner's answers of 20 and 21 November): a world's clear-day
// visibility and its steer toward SWG's colours, one pair a world, joining the sky's dial set (`src/sky/skyDials.ts`'s
// `SKY_DIAL_GROUPS`), so the menu's copied line is the sky's helper's own argument: `__debug.sky({ air: { tatooine: {
// visibilityKm: 25 } } })`, which hands `air` to `tuneAirDials`. Feel is the owner's: each starts where `AIR_DIAL_START`
// says, with its reason there, and nobody tunes it by measuring. Moved, the world's rows take the new haze at once and
// the fit's worker is asked again for their multiple scattering (`AirRun.frame`).
//
// Pure: no three, no DOM.
import type { DialGroup, NumberDial } from '../../ui/dials.ts';
import { SKY_DIAL_GROUPS } from '../skyDials.ts';
import { AIR_DIAL_RANGE, AIR_OZONE, AIR_OZONE_RANGE, airDialsOf, glowStartOf, smokeStartOf, tuneAirDials } from './airParams.ts';
import type { SmokeDials } from '../look/airProfile.js';

/** The worlds whose air has dials (the converted worlds, Hoth's heroic among them as `adventure2`). */
export const AIR_DIAL_WORLDS: readonly [string, string][] = [
  ['tatooine', 'Tatooine'],
  ['naboo', 'Naboo'],
  ['corellia', 'Corellia'],
  ['dantooine', 'Dantooine'],
  ['lok', 'Lok'],
  ['endor', 'Endor'],
  ['dathomir', 'Dathomir'],
  ['yavin4', 'Yavin IV'],
  ['talus', 'Talus'],
  ['rori', 'Rori'],
  ['mustafar', 'Mustafar'],
  ['kashyyyk', 'Kashyyyk'],
  ['adventure2', 'Hoth (Echo Base)'],
];

function dial(id: string, key: 'visibilityKm' | 'steer' | 'hazeR' | 'hazeG' | 'hazeB' | 'glow' | keyof SmokeDials, label: string, step: number, unit: string, note: string): NumberDial {
  const [min, max] = AIR_DIAL_RANGE[key];
  return {
    kind: 'number',
    key: `air.${id}.${key}`,
    label,
    note,
    min,
    max,
    step,
    unit,
    get: () => airDialsOf(id)[key],
    set: (v) => tuneAirDials({ [id]: { [key]: v } }),
  };
}

/** A world's own ozone limit (pass 2, wave 2): nought is "the all-worlds limit". */
function ozoneDial(id: string, key: 'ozoneMin' | 'ozoneMax', label: string, note: string): NumberDial {
  const [min, max] = AIR_OZONE_RANGE.own;
  return {
    kind: 'number',
    key: `air.${id}.${key}`,
    label,
    note,
    min,
    max,
    step: 0.05,
    unit: '×',
    get: () => airDialsOf(id)[key],
    set: (v) => tuneAirDials({ [id]: { [key]: v } }),
    text: (v) => (v > 0 ? `${v.toFixed(2)}×` : 'all worlds\''),
  };
}

/** A world's dials as one group of the sky's set. */
export function airDialGroup(id: string, name: string): DialGroup {
  return {
    title: `The air of ${name}`,
    note: "Its clear-day visibility, from which every weather row's haze is scaled (a storm with ten times the clear row's fog sees a tenth as far), how far its light and sky are bent toward SWG's own colours of the hour (0: the physical air alone), its own limits on the fit's ozone (nought: the all-worlds limits), its haze's colour (1, 1, 1: grey, the sky as it was), the glow round the sun its haze throws (the world's own to start), and a second layer of smoke and ash with the lava's glow from below (none to start but Mustafar's measured plume).",
    dials: [
      dial(id, 'visibilityKm', 'Clear-day visibility', 0.5, 'km', "How far a dark thing stays seen on a clear day (2% contrast): 40 km is a very clear day. Weather scales from here, so nearer than 2 km in storms is in reach."),
      dial(id, 'steer', 'Steer to SWG', 0.05, '', "0 draws the physical air alone (realism first); 1 bends the sky's light and the lights' colours to SWG's of the hour, channel by channel."),
      ozoneDial(id, 'ozoneMin', 'Ozone at least', "This world's own floor on the fit's ozone, as a share of Earth's; nought takes the all-worlds floor. Moved, its rows are fitted again (a second or so) and its sky follows."),
      ozoneDial(id, 'ozoneMax', 'Ozone at most', "This world's own top on the fit's ozone; nought takes the all-worlds top. A lower top turns a low sun's magenta back toward red where the fit stands at the top (Naboo, Kashyyyk, Endor, Rori, Lok, Yavin 4)."),
      // Pass 2, wave 4a: the haze's colour, a share of its scattering a channel (1, 1, 1 a grey haze: every world starts grey).
      dial(id, 'hazeR', 'Haze colour: red', 0.01, '', "The share of the haze's scattering in the red: 1 with green and blue at 1 is a grey haze (the start, the sky as it was). What a channel scatters less it absorbs, so the sun through the haze is dimmed, never tinted. A desert's warm dust is about 1, 0.9, 0.7."),
      dial(id, 'hazeG', 'Haze colour: green', 0.01, '', "The share of the haze's scattering in the green (1 to start: grey). Moved, the world's rows are fitted again for their multiple scattering (a second or so) and its sky and haze follow; nothing is built."),
      dial(id, 'hazeB', 'Haze colour: blue', 0.01, '', "The share of the haze's scattering in the blue (1 to start: grey). Lower than the green and red for a warm dust or a brown ash."),
      // The sky and light fix round (maker L): the haze's phase g, each world's own to start.
      dial(id, 'glow', 'Glow round the sun', 0.01, '', `How strongly the haze throws light forward (its phase's g), which shapes the glow round the sun and the moon: ${glowStartOf(id)} to start (this world's own haze). Lower spreads it wider and dimmer, so a thick haze (a low Clear-day visibility) shows a smaller, softer sun; higher draws it tighter and brighter round the disc. Moved, the world's rows are fitted again (a second or so); nothing is built.`),
      // Pass 2, wave 6: the second aerosol layer, smoke and ash, and the glow from below (none to start but Mustafar's plume).
      ...smokeDials(id),
    ],
  };
}

/** Pass 2, wave 6: a world's smoke and ash dials (the viewer's air box carries the same names: `airProfile.js`' `AIR_DIALS`). */
function smokeDials(id: string): NumberDial[] {
  const s = smokeStartOf(id);
  const start = (v: number, u = ''): string => `${v}${u} to start${id === 'mustafar' ? " (Mustafar's measured plume: the reasons are airParams.ts' SMOKE_STARTS)" : ''}`;
  return [
    dial(id, 'smokeDepth', 'Smoke and ash: depth', 0.01, '', `How much a second layer of smoke and ash dims the sun straight overhead (its optical depth at 550 nm): ${start(s.smokeDepth)}; 0 is none, the sky as it was. At 1 about a third of the overhead sun comes through, and a low sun is a dim red disc. Moved, the world's rows take it at once and are fitted again for their multiple scattering (a second or so); nothing is built.`),
    dial(id, 'smokeAngstrom', 'Smoke and ash: fine or coarse', 0.05, '', `Its Angstrom exponent, how much more it dims the blue than the red: ${start(s.smokeAngstrom)}. About 2 for fine smoke (the sun through it reddens hard), near 0 for coarse ash (grey, every colour dimmed alike).`),
    dial(id, 'smokeAlbedo', 'Smoke and ash: brightness', 0.01, '', `The share of the light it meets that it scatters rather than absorbs, in the green: ${start(s.smokeAlbedo)}. Ash about 0.9, smoke 0.8 to 0.9, soot lower and darker.`),
    dial(id, 'smokeBrown', 'Smoke and ash: brown', 0.05, '', `How much more it absorbs the blue than the red (its absorption Angstrom exponent): ${start(s.smokeBrown)}. 1 a grey soot, 2 a brown smoke, higher browner.`),
    dial(id, 'smokeHeightKm', 'Smoke and ash: height', 0.1, 'km', `The middle of the layer above the ground: ${start(s.smokeHeightKm, ' km')}.`),
    dial(id, 'smokeThickKm', 'Smoke and ash: thickness', 0.1, 'km', `How deep the layer is, thickening from its bottom to its middle and thinning to its top: ${start(s.smokeThickKm, ' km')}.`),
    dial(id, 'smokeG', 'Smoke and ash: forward glow', 0.01, '', `How strongly it throws light forward (its phase's g), the glow round a sun seen through it: ${start(s.smokeG)}.`),
    dial(id, 'glowLux', 'Glow from below', 0.05, 'lx', `The lava's light the air above it scatters back down, as the upward light at the ground: ${start(s.glowLux, ' lux')}; 0 is none. A full moon gives 0.25 lux: a few lux is an orange night sky over lava.`),
    dial(id, 'glowKelvin', 'Glow colour', 10, 'K', `The lava's temperature: ${start(s.glowKelvin, ' K')}. 1,000 a deep red, 1,250 orange, 1,500 a yellow-orange.`),
  ];
}

/** The all-worlds ozone limits (pass 2, wave 2, the owner's answer 3): two dials over every world whose own are nought. */
export function airOzoneGroup(): DialGroup {
  const one = (key: 'ozoneMin' | 'ozoneMax', label: string, note: string): NumberDial => {
    const [min, max] = AIR_OZONE_RANGE.all;
    return { kind: 'number', key: `air.all.${key}`, label, note, min, max, step: 0.05, unit: '×', get: () => AIR_OZONE[key === 'ozoneMin' ? 'min' : 'max'], set: (v) => tuneAirDials({ all: { [key]: v } }) };
  };
  return {
    title: "The air's ozone, all worlds",
    note: "How far the fit may move each world's ozone from Earth's toward the dusk SWG paints: ozone's absorption of the orange is what keeps a clear twilight's zenith blue. Moved, every world whose own limits are nought is fitted again (the one you stand on at once, a second or so in the worker) and its sky follows; nothing is built.",
    dials: [
      one('ozoneMin', 'Ozone at least', "0.75 to start (wave 1's): at three quarters of Earth's a clear twilight's zenith is blue over green on every world's fitted clear row; lower lets SWG's red dusks come through greener."),
      one('ozoneMax', 'Ozone at most', "4 to start (what you have seen): six worlds' fits stand at it, which turns a low sun magenta-red there (Kachirho's dawn); lower it to temper that, higher to let the fit go further."),
    ],
  };
}

let registered = false;

/** The air's groups put into the sky's set (once; the set reads them the first time the menu asks for it). */
export function registerAirDials(): void {
  if (registered) return;
  registered = true;
  SKY_DIAL_GROUPS.push(airOzoneGroup);
  for (const [id, name] of AIR_DIAL_WORLDS) SKY_DIAL_GROUPS.push(() => airDialGroup(id, name));
}

/** The console's `air` part of `__debug.sky({ air })`: the dials moved, words for anything held or refused. */
export function skyAirArgument(o: unknown): string[] {
  if (o === undefined) return [];
  if (!o || typeof o !== 'object') return ['air: { <world>: { visibilityKm, steer, ozoneMin, ozoneMax, hazeR, hazeG, hazeB, glow, smokeDepth, smokeAngstrom, smokeAlbedo, smokeBrown, smokeHeightKm, smokeThickKm, smokeG, glowLux, glowKelvin }, all: { ozoneMin, ozoneMax } }'];
  return tuneAirDials(o as Record<string, unknown>);
}
