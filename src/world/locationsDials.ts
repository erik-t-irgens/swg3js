// The places' dials (src/ui/dials.ts, Map-maker II's eighth wave): a real-elevation world's made map, the places' own marks
// and the game's services on the maps, as sliders in the debug menu when `locations` is picked. Each is set exactly as
// `__debug.locations({ map: { tune } })`, `({ tune })` and `({ services })` set them, so the line the menu copies out is that
// helper's own argument (`locations({ map: { tune: { shade: 0.5 } } })`). Every number is the owner's to judge by eye: the
// made map's light and shade, the marks' sizes and the outlines' width.
//
// Pure: it imports the tables and the dials' own types and nothing of the page, so a node test moves every dial through the
// real tables.
import type { ChoiceDial, DialGroup, DialSet, NumberDial } from '../ui/dials.ts';
import { readDials } from '../ui/dials.ts';
import { MAP_PICTURE_TUNE, tuneMapPicture } from './demMap.ts';
import { PLACE_TUNE, tunePlaces } from './places.ts';
import { SERVICE_TUNE, tuneServices } from '../ui/serviceMarks.ts';

/**
 * Who makes the picture again and draws the maps again when a dial moves one (the game hands its own); none, the tune alone
 * moves. And the world editor's places tool's own dials (`tool`, its circle's radius, the wheel's step and the rest of
 * `PLACES_TOOL_TUNE`), which the editor hands in as it loads: they live in the editor, which a build never carries, so this
 * file names none of them and the set takes them only once the editor is there.
 */
export const LOCATION_DIALS: { host: { remake(): void; redraw(): void } | null; tool: { groups(): DialGroup[]; shipped: ReadonlyMap<string, number | string> } | null } = { host: null, tool: null };

/** One number of a table as a slider, its key the console's path to it, what the setter holds it to said back where it differs. */
function num(key: string, label: string, note: string, min: number, max: number, step: number, unit: string, get: () => number, set: (v: number) => void): NumberDial {
  return {
    kind: 'number',
    key,
    label,
    note,
    min,
    max,
    step,
    unit,
    get,
    set: (v) => {
      set(v);
      const now = get();
      return now === v ? [] : [`held at ${now}`];
    },
  };
}

const map = (k: 'sunAz' | 'sunEl' | 'shade' | 'sliceRows' | 'sliceMs' | 'debounceMs') => (v: number) => {
  tuneMapPicture({ [k]: v });
  LOCATION_DIALS.host?.remake();
};
const place = (k: 'outlinePx') => (v: number) => {
  tunePlaces({ [k]: v });
  LOCATION_DIALS.host?.redraw();
};
const service = (k: 'markPx' | 'minimapPx' | 'labelScale') => (v: number) => {
  tuneServices({ [k]: v });
  LOCATION_DIALS.host?.redraw();
};

/** A services switch as a choice of `on` and `off`, set exactly as `locations({ services: { <key>: 'on' } })` sets it. */
function serviceSwitch(k: 'services' | 'terminals' | 'minimap', label: string, note: string): ChoiceDial {
  return {
    kind: 'choice',
    key: `services.${k}`,
    label,
    note,
    choices: ['on', 'off'],
    get: () => (SERVICE_TUNE[k] ? 'on' : 'off'),
    set: (v) => {
      tuneServices({ [k]: v });
      LOCATION_DIALS.host?.redraw();
      return [];
    },
  };
}

const GROUPS: DialGroup[] = [
  {
    title: 'The made map (a real-elevation world)',
    note: 'The picture the browser makes from a real-elevation world’s own raster: its ground’s colours under a hillshade, its water. A moved dial makes it again (a few rows a frame).',
    dials: [
      num('map.tune.sunAz', 'Light from', 'The light’s bearing, degrees clockwise from the picture’s top (315: the cartographer’s top left).', 0, 360, 5, '°', () => MAP_PICTURE_TUNE.sunAz, map('sunAz')),
      num('map.tune.sunEl', 'Light’s height', 'How high the light stands over the ground, degrees: lower, longer shadows on the hills.', 1, 90, 1, '°', () => MAP_PICTURE_TUNE.sunEl, map('sunEl')),
      num('map.tune.shade', 'Shade', 'How much a slope’s light moves a pixel’s colour: 0 flat, 1 the light’s whole.', 0, 1, 0.01, '', () => MAP_PICTURE_TUNE.shade, map('shade')),
      num('map.tune.sliceRows', 'Rows a slice', 'Rows counted as one slice (a picture is its pixels across over this many slices).', 1, 256, 1, '', () => MAP_PICTURE_TUNE.sliceRows, map('sliceRows')),
      num('map.tune.sliceMs', 'A frame spends', 'The most a frame of making spends, milliseconds.', 0.25, 8, 0.25, 'ms', () => MAP_PICTURE_TUNE.sliceMs, map('sliceMs')),
      num('map.tune.debounceMs', 'Made again after', 'How long after an edit lands (the ground, its paint, its water) the picture is made again.', 0, 10000, 100, 'ms', () => MAP_PICTURE_TUNE.debounceMs, map('debounceMs')),
    ],
  },
  {
    title: 'The places and the game’s services on the maps',
    note: 'How a city’s outline and the game’s own services are drawn on the map window and the minimap.',
    dials: [
      serviceSwitch('services', 'Services shown', 'Whether the cantinas, banks, cloning facilities, shrines and the rest start shown on the map window and the minimap (on: the game’s own map listed them, and a town reads by them).'),
      serviceSwitch('terminals', 'Terminals shown', 'Whether the bank, bazaar and mission terminals are shown (off: a town has dozens, and the buildings would be lost under them).'),
      serviceSwitch('minimap', 'On the minimap', 'Whether the minimap shows the services at all (the map window’s switches still say which).'),
      num('tune.outlinePx', 'City outline', 'A city’s outline on the minimap, CSS pixels at scale 1.', 0, 6, 0.25, 'px', () => PLACE_TUNE.outlinePx, place('outlinePx')),
      num('services.markPx', 'Mark on the map', 'Half a service’s mark on the map window, CSS pixels.', 2, 16, 0.5, 'px', () => SERVICE_TUNE.markPx, service('markPx')),
      num('services.minimapPx', 'Mark on the minimap', 'Half a service’s mark on the minimap, CSS pixels at scale 1.', 1, 12, 0.5, 'px', () => SERVICE_TUNE.minimapPx, service('minimapPx')),
      num('services.labelScale', 'Names closer than', 'The map window writes a building’s name beside its mark only closer than this many metres a pixel.', 0, 20, 0.25, 'm/px', () => SERVICE_TUNE.labelScale, service('labelScale')),
    ],
  },
];

/** The places' dials, with the values the game shipped (read once, as this module loads, before anything can move them). */
export const LOCATION_DIAL_SET: DialSet = { helper: 'locations', groups: GROUPS, shipped: readDials(GROUPS) };

/**
 * The set the debug menu shows when `locations` is picked: the places' own dials, and the places tool's once the world editor
 * has handed them in (`LOCATION_DIALS.tool`), their shipped values the tool's own defaults.
 */
export function locationDialSet(): DialSet {
  const tool = LOCATION_DIALS.tool;
  if (!tool) return LOCATION_DIAL_SET;
  const shipped = new Map(LOCATION_DIAL_SET.shipped);
  for (const [k, v] of tool.shipped) shipped.set(k, v);
  return { helper: 'locations', groups: [...GROUPS, ...tool.groups()], shipped };
}
