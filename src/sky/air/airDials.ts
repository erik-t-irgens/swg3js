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
import { AIR_DIAL_RANGE, airDialsOf, tuneAirDials } from './airParams.ts';

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

function dial(id: string, key: 'visibilityKm' | 'steer', label: string, step: number, unit: string, note: string): NumberDial {
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

/** A world's two dials as one group of the sky's set. */
export function airDialGroup(id: string, name: string): DialGroup {
  return {
    title: `The air of ${name}`,
    note: "Its clear-day visibility, from which every weather row's haze is scaled (a storm with ten times the clear row's fog sees a tenth as far), and how far its light and sky are bent toward SWG's own colours of the hour (0: the physical air alone).",
    dials: [
      dial(id, 'visibilityKm', 'Clear-day visibility', 0.5, 'km', "How far a dark thing stays seen on a clear day (2% contrast): 40 km is a very clear day. Weather scales from here, so nearer than 2 km in storms is in reach."),
      dial(id, 'steer', 'Steer to SWG', 0.05, '', "0 draws the physical air alone (realism first); 1 bends the sky's light and the lights' colours to SWG's of the hour, channel by channel."),
    ],
  };
}

let registered = false;

/** The air's groups put into the sky's set (once; the set reads them the first time the menu asks for it). */
export function registerAirDials(): void {
  if (registered) return;
  registered = true;
  for (const [id, name] of AIR_DIAL_WORLDS) SKY_DIAL_GROUPS.push(() => airDialGroup(id, name));
}

/** The console's `air` part of `__debug.sky({ air })`: the dials moved, words for anything held or refused. */
export function skyAirArgument(o: unknown): string[] {
  if (o === undefined) return [];
  if (!o || typeof o !== 'object') return ['air: { <world>: { visibilityKm, steer } }'];
  return tuneAirDials(o as Record<string, unknown>);
}
