// The Interface page's own table, and the note that goes out when a key is rebound.
//
// Both belong to the Escape menu and both are re-exported from `menu.ts`, which is where anything
// that wants them looks. They sit here rather than in `menu.ts` for one reason: a plain node test
// checks every knob on the page against the setting it writes, and `menu.ts` cannot be imported by
// one (it reaches for `document`, and both it and `input.ts` declare fields in their constructor
// parameters, which node's type stripping will not take). Nothing in this file touches the page, so
// the test needs no browser at all.
import { HUD_LINES_RANGE, HUD_MINIMAP_RANGE, HUD_SCALE_RANGE, type Settings } from '../core/settings.ts';

/** One control on a settings page. `choice` is a list whose values are words rather than numbers. */
export interface Knob {
  key: keyof Settings;
  label: string;
  hint: string;
  kind: 'range' | 'toggle' | 'select' | 'choice';
  min?: number;
  max?: number;
  step?: number;
  options?: { value: number; label: string }[];
  choices?: { value: string; label: string }[];
  format?: (v: number) => string;
  /** Greyed while any of these is off; still usable, so a strength can be set before its toggle. */
  requires?: readonly (keyof Settings)[];
}

/**
 * The display. Every switch and every number the screen's own readouts have, in one page, because
 * they are all judged together and by eye. None of it is read from the game's own interface: the
 * whole look is ours, and so is every number here -- the scale's two ends, how many message lines
 * stand, and which of the four feedback switches start on. `__debug.hud({ ... })` moves the same
 * values from the console for anyone who would rather not open the menu, and a node test checks that
 * every one of them has a knob here and that the ends agree with the ranges that helper clamps to.
 */
export const INTERFACE: { title: string; knobs: readonly Knob[] }[] = [
  {
    title: 'Size',
    knobs: [
      { key: 'hudScale', label: 'Display scale', kind: 'range', min: HUD_SCALE_RANGE.min, max: HUD_SCALE_RANGE.max, step: 0.05, format: (v) => `${v.toFixed(2)}×`, hint: 'How large everything on the screen is drawn, the reticle and its arcs with it. 1 is the size it was drawn at; the two ends are ours, and nothing should overlap or leave the screen at either of them.' },
      { key: 'hudDpr', label: 'Sharper hairlines', kind: 'select', options: [{ value: 1, label: 'One dot per screen pixel' }, { value: 2, label: 'Two (sharper, dearer)' }], hint: 'How many dots the overlay draws for each pixel of the screen. One is cheap and is where it starts; two sharpens every thin line on a dense screen and gives the browser four times as many dots to clear each frame.' },
    ],
  },
  {
    title: 'Flying',
    knobs: [
      { key: 'hudShipCondition', label: 'The ship\'s condition', kind: 'toggle', hint: 'Shields and armour front and back, the hull, and a small square for each part fitted, under the middle of the screen. Your own health bar is hidden while you are at the controls whatever this says.' },
      { key: 'hudTargetBlock', label: 'The target block', kind: 'toggle', hint: 'The four corners on what you have targeted, its name, how far off it is, and the shields, armour and hull of the side facing you; and the arrow at the edge of the screen when it is behind you.' },
      { key: 'hudArcs', label: 'The arcs round the reticle', kind: 'toggle', hint: 'Speed on the left, with a tick for the top speed with the wings open and one for the top speed with them closed; the guns on the right as they reload; the booster underneath.' },
    ],
  },
  {
    title: 'What is said',
    knobs: [
      { key: 'hudMessages', label: 'The message line', kind: 'toggle', hint: 'The lines at the bottom left: what hit you, what you hit, a crash, a part going down, a jump, the relay. Off, those notices are not said anywhere else, so leave it on unless it is in the way.' },
      { key: 'hudMessageLines', label: 'Lines kept', kind: 'range', min: HUD_LINES_RANGE.min, max: HUD_LINES_RANGE.max, step: 1, format: (v) => `${v}`, requires: ['hudMessages'], hint: 'How many stand at once before the oldest goes. Ours: eight is what a busy fight fills.' },
      { key: 'hudFullPrompts', label: 'Full prompts', kind: 'toggle', hint: 'The long line naming every key, under the short bar of four actions. Off to begin with, since the bar already puts your own key on everything it offers; turn it on when you want to check whether the bar has hidden something you use, and say what is missing.' },
    ],
  },
  {
    title: 'Map, waypoints and jobs',
    knobs: [
      { key: 'hudMinimap', label: 'Minimap', kind: 'toggle', hint: "The planet's own map in a circle at the top left, round you, with your arrow, every waypoint that is switched on and a mark for north on its rim; the planet's name stands over its top and your coordinates, the map window's own two numbers, over its foot, and the name of a city fades in under it as you walk in. It stands aside in space, in the dungeons and on a world with no map picture." },
      { key: 'hudMinimapRange', label: 'Minimap reach', kind: 'range', min: HUD_MINIMAP_RANGE.min, max: HUD_MINIMAP_RANGE.max, step: 100, format: (v) => `${v} m`, requires: ['hudMinimap'], hint: 'How far from you the rim of the minimap is. The pictures are sixteen metres to the pixel, so close in they are soft; ours, eight hundred to begin with.' },
      { key: 'hudMinimapNorthUp', label: 'North up', kind: 'toggle', requires: ['hudMinimap'], hint: 'North at the top, with your arrow turning; off, the map turns with you, the way you face is up and the mark for north goes round the rim.' },
      { key: 'hudWaypointMarks', label: 'Waypoints in the world', kind: 'toggle', hint: 'A mark where each waypoint switched on stands, the distance under the tracked one and the nearest, and an arrow at the edge of the screen pointing at the tracked one when it is out of sight. The Waypoints window lists every one of them.' },
      { key: 'hudWaypointMarksInFlight', label: 'Waypoints while flying', kind: 'toggle', requires: ['hudWaypointMarks'], hint: 'The same marks over the flight display, at the controls of a ship.' },
      { key: 'hudTracker', label: 'Jobs followed', kind: 'toggle', hint: 'Down the right edge under the group: up to three of the jobs you follow, each with its objectives, what each is counting, how far off its place is and how long it has left. With none followed, the newest job taken.' },
      { key: 'hudTrackerInFlight', label: 'Jobs while flying', kind: 'toggle', requires: ['hudTracker'], hint: 'The same at the controls of a ship. Off to begin with, since the flight display has the edges then.' },
    ],
  },
  {
    title: 'Fighting',
    knobs: [
      { key: 'hudDamageArc', label: 'Direction of a blow', kind: 'toggle', hint: 'An arc on the side the blow came from, over the red flash. A fall, or anything else with no direction to it, still flashes.' },
      { key: 'hudDamageNumbers', label: 'Damage numbers', kind: 'toggle', hint: 'Small numbers rising where your blows land. Off to begin with: the game said its results in words, and those words go to the message line.' },
      { key: 'hudNameplate', label: 'Name over what you look at', kind: 'toggle', hint: 'Put the crosshair on something alive nearby and its name and health stand over its head, instead of a "nearby" line at the foot of the top-left corner.' },
      { key: 'hudJediCrosshair', label: 'Crosshair as a Jedi', kind: 'toggle', hint: 'A Force power is aimed and nothing showed where. A crosshair that is always there changes how a saber fight feels, so it is yours to switch off.' },
    ],
  },
];

/**
 * Anything that shows a key the player has bound hears about a rebind through here, because the
 * keys are written in one place (the Controls page) and read in several, and nothing in the game
 * heard about it before: the display's slot row said 1 to 6 whatever you had bound.
 *
 * It is a plain list of callbacks, called after a binding is written and never in a frame. A
 * listener that throws does not stop the others, since a display that cannot redraw its key-caps
 * must not take the menu down with it.
 */
const listeners: (() => void)[] = [];

/** Hear about a rebind. Returns the call that stops hearing about it. */
export function onBindingsChanged(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

/** The keys have changed: everything that shows one reads it again. */
export function notifyBindingsChanged(): void {
  for (let i = 0; i < listeners.length; i++) {
    try {
      listeners[i]();
    } catch (err) {
      console.warn('a rebind listener threw', err);
    }
  }
}
