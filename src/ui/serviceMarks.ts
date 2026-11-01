// The game's own services on the maps (Map-maker II's eighth wave, from the map audit): the cantinas, banks, cloning
// facilities, medical centres, hotels, garages, capitols, guild halls, salons, theatres and taverns the server listed on its
// planetary map, its Force shrines, and its bank, bazaar and mission terminals, each a mark on the map window and the
// minimap under two layer switches (`services`, the buildings and shrines; `terminals`, the terminals).
//
// **Every mark is ours.** The archives hold zone-map icons for the space zone map's six layers alone
// (`texture/ui_space_zone_*`); the planetary map's category icons are in the interface's own atlases, which the hard rule on
// interface art keeps out of the game. So each kind wears a mark drawn here by hand, on a 24 by 24 box like the marks of
// `hud.svg`, in the palette's colours, as the waypoints and the group already do on these maps.
//
// The rows are the pack's (`pois.json`'s `services`, written by the `pois` command from Core3's map categories joined to the
// world's layout), in the raw frame. A pack converted before them has none, and nothing is drawn.
//
// Pure but for `drawServiceMark` (a canvas and `Path2D`), which no node test calls. Rule for this file (node runs it with
// type stripping): every import with its `.ts` extension, no enum, no namespace, no constructor parameter properties.

import type { PaletteName } from '../core/palette.ts';

/** The two switches the services ride. */
export type ServiceLayer = 'services' | 'terminals';
export const SERVICE_LAYERS: readonly { id: ServiceLayer; label: string }[] = [
  { id: 'services', label: 'Services' },
  { id: 'terminals', label: 'Terminals' },
];

/**
 * The services' numbers, all ours and live through `__debug.locations({ services: { ... } })`: which switches start on, a
 * mark's size, and how close the map window must be before a building's name is written beside its mark.
 */
export const SERVICE_TUNE = {
  /** Whether the buildings' and shrines' marks start on (the game's map listed them; a town reads by them). */
  services: true,
  /** Whether the terminals' marks start on: off, since a town has dozens and the buildings would be lost under them. */
  terminals: false,
  /** Half a mark on the map window, CSS pixels. */
  markPx: 6,
  /** Half a mark on the minimap, CSS pixels at scale 1. */
  minimapPx: 4,
  /** The map window writes a building's name beside its mark only closer than this many metres a pixel. */
  labelScale: 3,
  /** Whether the minimap shows the marks at all. */
  minimap: true,
};

/**
 * Move any of those; the answer is the table as it stands. A switch takes `true`/`false` or the debug menu's words for them,
 * `'on'`/`'off'` (the line its dials copy out).
 */
export function tuneServices(o: Partial<Record<keyof typeof SERVICE_TUNE, number | boolean | string>>): typeof SERVICE_TUNE {
  const t = SERVICE_TUNE as Record<string, number | boolean>;
  for (const k of Object.keys(SERVICE_TUNE) as (keyof typeof SERVICE_TUNE)[]) {
    const v = o[k];
    if (typeof SERVICE_TUNE[k] === 'boolean') {
      if (typeof v === 'boolean') t[k] = v;
      else if (v === 'on' || v === 'off') t[k] = v === 'on';
    } else if (typeof SERVICE_TUNE[k] === 'number' && typeof v === 'number' && Number.isFinite(v)) t[k] = Math.max(0, v);
  }
  return SERVICE_TUNE;
}

/** Which switch a service kind rides: a terminal's own, else the buildings'. */
export function serviceLayerOf(kind: string): ServiceLayer {
  return kind === 'terminal' || kind.startsWith('terminal_') ? 'terminals' : 'services';
}

/** What each kind is called on the maps, ours (the server's category words, written for a reader). */
const LABELS: Record<string, string> = {
  bank: 'Bank',
  cantina: 'Cantina',
  tavern: 'Tavern',
  capitol: 'Capitol',
  cloningfacility: 'Cloning facility',
  shrine: 'Force shrine',
  garage: 'Garage',
  guild: 'Guild hall',
  hotel: 'Hotel',
  medicalcenter: 'Medical centre',
  salon: 'Salon',
  theater: 'Theatre',
  terminal: 'Terminal',
  terminal_bank: 'Bank terminal',
  terminal_bazaar: 'Bazaar terminal',
  terminal_mission: 'Mission terminal',
  imperial: 'Imperial base',
  rebel: 'Rebel base',
};

/** A kind's name on the maps: ours where we wrote one, else its own word with its underscores taken out. */
export function serviceLabel(kind: string): string {
  return LABELS[kind] ?? (kind ? kind.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : 'Service');
}

/** The palette colour a kind's mark wears: the buildings in `ink`, the terminals in `muted`, the faction bases in `warn`. */
export function serviceColour(kind: string): PaletteName {
  if (serviceLayerOf(kind) === 'terminals') return 'muted';
  if (kind === 'imperial' || kind === 'rebel') return 'warn';
  return 'ink';
}

/**
 * Each kind's mark, drawn by hand on a 24 by 24 box (its middle at 12, 12) as one stroked path: a glass, a mug, a bank's
 * columns, a cross in a ring, a triangle, a plus, a bed, a garage, a dome, a shield, scissors, a mask, a terminal's screen
 * three ways, a diamond, a ring.
 */
const GLYPHS: Record<string, string> = {
  cantina: 'M7 5h10l-2 8h-6z M12 13v5 M8 19h8',
  tavern: 'M6 6h9v12h-9z M15 9h3v6h-3',
  bank: 'M12 3l8 5H4z M6 9v8 M10 9v8 M14 9v8 M18 9v8 M4 19h16',
  cloningfacility: 'M12 7v10 M7 12h10 M20 12a8 8 0 1 1-16 0a8 8 0 1 1 16 0',
  shrine: 'M12 4l7 15H5z',
  medicalcenter: 'M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z',
  hotel: 'M4 18V7 M4 14h16v4 M7 11h6v3',
  garage: 'M4 19V9l8-5 8 5v10 M8 19v-6h8v6',
  capitol: 'M5 11a7 7 0 0 1 14 0z M7 13v6 M17 13v6 M12 13v6 M4 19h16',
  guild: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z',
  salon: 'M10 7a3 3 0 1 1-6 0a3 3 0 1 1 6 0 M10 17a3 3 0 1 1-6 0a3 3 0 1 1 6 0 M9 9l11 8 M9 15l11-8',
  theater: 'M5 5h14v7a7 7 0 0 1-14 0z M8 10h2 M14 10h2 M9 14q3 2 6 0',
  terminal: 'M5 5h14v11H5z M9 19h6',
  terminal_bank: 'M5 5h14v11H5z M9 19h6 M12 7v7 M10 9h4',
  terminal_bazaar: 'M5 5h14v11H5z M9 19h6 M5 10h14',
  terminal_mission: 'M12 3l8 8-8 8-8-8z M12 8v6',
  imperial: 'M19 12a7 7 0 1 1-14 0a7 7 0 1 1 14 0 M12 5v14 M5 12h14',
  rebel: 'M19 12a7 7 0 1 1-14 0a7 7 0 1 1 14 0 M12 7l3 9-6-6h6l-6 6z',
};

/** A kind's mark as a path on the 24 box: its own, else a ring. */
export function serviceGlyph(kind: string): string {
  return GLYPHS[kind] ?? 'M18 12a6 6 0 1 1-12 0a6 6 0 1 1 12 0';
}

/** The marks as `Path2D`s, made the first time each is drawn and kept for the session. */
const PATHS = new Map<string, Path2D>();

/**
 * One mark on a canvas, its middle at (x, y), `half` pixels from its middle to its box's edge, stroked in `colour` over a
 * `shade` halo so it reads on any ground. Makes a path the first time a kind is drawn, and nothing after.
 */
export function drawServiceMark(c: CanvasRenderingContext2D, kind: string, x: number, y: number, half: number, colour: string, shade: string): void {
  let p = PATHS.get(kind);
  if (!p) {
    p = new Path2D(serviceGlyph(kind));
    PATHS.set(kind, p);
  }
  const k = half / 12;
  c.save();
  c.translate(x - 12 * k, y - 12 * k);
  c.scale(k, k);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.lineWidth = 4.5;
  c.strokeStyle = shade;
  c.stroke(p);
  c.lineWidth = 2;
  c.strokeStyle = colour;
  c.stroke(p);
  c.restore();
}
