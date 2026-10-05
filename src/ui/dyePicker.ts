// The colour picker that opens under a colour row on the appearance page.
//
// A row's own palette is what the game offered for it; with a colour carried whole as the value
// (`rawColour`, texrender.ts) any colour of any palette can go on a garment, a hairstyle or a dye, and
// every species' eyes can take every species' eye colours. So the picker lays out, tab by tab:
//
// - Own: the row's own palette, the creator's colours first in the game's own columns, then the rest;
//   a pick here writes the index, which keeps the game's meaning.
// - Garments: every garment palette the wardrobe carries, each under a name of ours from its file.
// - Creator: every creator palette the creator's table carries (skin tones, hair, eyes, lips...), named
//   for its family and species.
// - Every species (an eye colour only): every species' eye palette.
// - All garment colours: the Garments tab's colours in one grid, near-duplicates folded, greys first,
//   then by hue, then by lightness.
//
// A pick anywhere but Own writes the colour whole. The ship edit page opens the same picker under a ship's
// or a speeder's colours, whose Own tab is the hull's own palette. Which rows offer which tabs is `pickerTabs`, and the
// palettes are only ever the recipes' own palette lists and the creator's table: never a sweep of the
// game's palette folder, which holds the client's interface palettes too.
//
// Every block is one canvas picked by where it was clicked, never a button a swatch: the All grid alone
// is about fifteen hundred colours. The pure parts are exported for the node test; the picker itself
// touches the page only when it is made.
import { COL, colourOf } from '../core/palette.ts';
import { isRawColour, rawColour, rawRgb } from '../player/texrender.ts';
import { CREATOR_TUNE, DYE_PALETTE, type CreatorTable, type SwatchLayout } from './creatorModel.ts';
import { paletteFamily, paletteStem, plainLabel } from './variableLabel.ts';

/** What kind of colour a row is, which decides the tabs it offers (`paint`: a ship's or a speeder's, on its edit page). */
export type PickKind = 'body' | 'eyes' | 'hair' | 'garment' | 'dye' | 'paint';
export type PickerTab = 'own' | 'garments' | 'creator' | 'eyes' | 'all';

/** Every number and name here is ours. */
export const DYE_TUNE = {
  /** A swatch's cell, in pixels, in every block but the All grid. */
  cell: 10,
  /** The All grid's cell. */
  allCell: 8,
  /** Two colours within this many levels on every channel are one in the All grid. */
  foldLevels: 4,
  /** How tall the picker's blocks may stand before they scroll. */
  maxHeight: 240,
  /** The tab a picker opens on: a dye of ours on every garment colour at once, a palette of the game's on its own. */
  openOn: { dye: 'all' as PickerTab, palette: 'own' as PickerTab },
  /** How many slices of hue the All grid sorts by before it sorts by lightness. */
  hueSteps: 24,
  /** Below this saturation a colour counts as a grey, and greys lead the All grid. */
  greyBelow: 0.1,
};

export function tuneDye(o: Partial<typeof DYE_TUNE>): typeof DYE_TUNE {
  const n = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null);
  const cell = n(o.cell, 4, 32);
  if (cell !== null) DYE_TUNE.cell = Math.round(cell);
  const all = n(o.allCell, 4, 32);
  if (all !== null) DYE_TUNE.allCell = Math.round(all);
  const fold = n(o.foldLevels, 0, 64);
  if (fold !== null) DYE_TUNE.foldLevels = Math.round(fold);
  const tall = n(o.maxHeight, 60, 2000);
  if (tall !== null) DYE_TUNE.maxHeight = Math.round(tall);
  const steps = n(o.hueSteps, 1, 360);
  if (steps !== null) DYE_TUNE.hueSteps = Math.round(steps);
  const grey = n(o.greyBelow, 0, 1);
  if (grey !== null) DYE_TUNE.greyBelow = grey;
  const tabs: PickerTab[] = ['own', 'garments', 'creator', 'eyes', 'all'];
  if (o.openOn && tabs.includes(o.openOn.dye)) DYE_TUNE.openOn.dye = o.openOn.dye;
  if (o.openOn && tabs.includes(o.openOn.palette)) DYE_TUNE.openOn.palette = o.openOn.palette;
  allCache.clear();
  return DYE_TUNE;
}

/** What each tab is called. */
export const TAB_LABEL: Record<PickerTab, string> = { own: 'Own', garments: 'Garments', creator: 'Creator', eyes: 'Every species', all: 'All garment colours' };

/**
 * What kind of colour a row is: our dye; a garment's own colour; a hairstyle's colour, or any colour read
 * from a hair palette (the facial hair follows the hair); an eye colour; else a colour of the body (skin,
 * lips, markings, horns), which keeps to what its species was offered.
 */
export function pickKind(o: { palette?: string; garment?: boolean; hair?: boolean; row?: string }): PickKind {
  if (o.palette === DYE_PALETTE) return 'dye';
  if (o.garment) return 'garment';
  const stem = paletteStem(o.palette);
  if (o.hair || /^pc_hair_/.test(stem)) return 'hair';
  if (o.row === 'color_eyes' || /^pc_eye_/.test(stem)) return 'eyes';
  return 'body';
}

/**
 * The tabs a row offers: a garment's, a hairstyle's, a ship's or a speeder's colour every colour there is
 * (the owner's call for the machines too); a body colour its own palette alone, with the creator's colours
 * first; an eye colour its own palette and every species' eyes (the owner's call: every race may take every
 * eye colour). Our dye has no palette of its own to offer -- its one entry is "undyed", which the Default
 * chip already is.
 */
export function pickerTabs(kind: PickKind): PickerTab[] {
  if (kind === 'dye') return ['garments', 'creator', 'all'];
  if (kind === 'garment' || kind === 'hair' || kind === 'paint') return ['own', 'garments', 'creator', 'all'];
  if (kind === 'eyes') return ['own', 'eyes'];
  return ['own'];
}

/** The tab a row's picker opens on (`DYE_TUNE.openOn`), or its first where that one is not offered. */
export function openTab(kind: PickKind, tune: typeof DYE_TUNE = DYE_TUNE): PickerTab {
  const tabs = pickerTabs(kind);
  const want = kind === 'dye' ? tune.openOn.dye : tune.openOn.palette;
  return tabs.includes(want) ? want : tabs[0];
}

/** A palette under a name, as a block of the picker shows it. */
export interface NamedPalette {
  stem: string;
  label: string;
  colors: number[][];
}

/** The garment palettes' names, ours, from their files. */
const GARMENT_NAMES: Record<string, string> = {
  wr_cloth_general: 'Cloth',
  wr_metal: 'Metal',
  wr_leather: 'Leather',
  wr_earthtones: 'Earth tones',
  wr_warm_colors: 'Warm colours',
  stormtrooper: 'Stormtrooper',
  stormtrooper_stripes: 'Stormtrooper stripes',
  stormtrooper_pauldron: 'Stormtrooper pauldron',
  scout_trooper: 'Scout trooper',
  swamptrooper: 'Swamp trooper',
  rebel_faction_armor: 'Rebel armour',
  rebel_faction_armor_spec_ops: 'Rebel spec-ops armour',
  wr_ris_armor: 'R.I.S. armour',
  wr_chitin_armor: 'Chitin armour',
  wr_chitin_visor: 'Chitin visor',
  wr_kashyyykian_feather: 'Kashyyykian feathers',
  tusken_raider: 'Tusken Raider',
  imperial_officer: 'Imperial officer',
  goggles: 'Goggles',
  goggles_reward: 'Reward goggles',
  creature_acklay: 'Acklay',
  starships_base: 'Starship base',
  starships_trim: 'Starship trim',
  vehicle_trim: 'Vehicle trim',
  astromech: 'Astromech',
  white: 'White',
};

/** A garment palette's name: ours where we gave one, else its file's own words tidied. */
export function garmentPaletteLabel(palette: string): string {
  const stem = paletteStem(palette);
  if (GARMENT_NAMES[stem]) return GARMENT_NAMES[stem];
  const words = stem.replace(/^wr_/, '').replace(/_/g, ' ').replace(/\barmor\b/g, 'armour').replace(/\bcolor(s?)\b/g, 'colour$1');
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : palette;
}

/** The species a creator palette's file names, by the game's three letters; ours. */
const SPECIES_CODES: Record<string, string> = {
  bth: 'Bothan',
  hum: 'Human',
  ith: 'Ithorian',
  mon: 'Mon Calamari',
  rod: 'Rodian',
  sul: 'Sullustan',
  trn: 'Trandoshan',
  twk: "Twi'lek",
  wke: 'Wookiee',
  zab: 'Zabrak',
};
const FAMILY_NAMES: Record<string, string> = { skin: 'Skin tones', hair: 'Hair', eye: 'Eyes', lips: 'Lips', tat: 'Tattoos', horns: 'Horns' };
const FAMILY_ORDER = ['skin', 'hair', 'eye', 'lips', 'tat', 'horns'];
const SUFFIX_WORDS: Record<string, string> = { spot: 'spots', leccu: 'lekku', tips: 'tips', b: '' };

/** A species by the game's three letters (`twk` is "Twi'lek"), or the letters themselves. */
export function speciesName(code: string): string {
  return SPECIES_CODES[code] ?? code;
}

/** What a creator palette (`pc_<family>_<species>[_<more>]`) is called: "Skin tones (Twi'lek, lekku)", "Hair (Rodian female)". */
export function creatorPaletteLabel(palette: string): string {
  const stem = paletteStem(palette);
  const m = /^pc_([a-z]+)_([a-z]+)(?:_([a-z_]+))?$/.exec(stem);
  if (!m) return garmentPaletteLabel(palette);
  const [, family, code, more] = m;
  const fam = family === 'skin' && code === 'wke' ? 'Fur' : (FAMILY_NAMES[family] ?? family);
  let who = speciesName(code);
  if (more) {
    if (more === 'f' || more === 'female') who += ' female';
    else if (more === 'm' || more === 'male') who += ' male';
    else {
      const word = SUFFIX_WORDS[more] ?? more.replace(/_/g, ' ');
      if (word) who += `, ${word}`;
    }
  }
  return `${fam} (${who})`;
}

/** A palette's colours with any colour it repeats left out, in its own order (white.pal is one grey twice). */
function distinctOf(colors: readonly number[][]): number[][] {
  const seen = new Set<number>();
  const out: number[][] = [];
  for (const c of colors) {
    const k = (c[0] << 16) | (c[1] << 8) | c[2];
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([c[0], c[1], c[2]]);
  }
  return out;
}

/**
 * Every garment palette a wardrobe's recipes carry, by name, the largest first: what its worn pieces name,
 * and the three garment palettes of the game's that none does, which the converter adds one by one. The
 * creator palettes (`pc_*`, the hairstyles' among them) are the Creator tab's, and our dye's one entry is
 * nobody's colour.
 */
export function garmentPalettes(palettes: Readonly<Record<string, number[][]>> | null | undefined): NamedPalette[] {
  const out: NamedPalette[] = [];
  for (const [p, colors] of Object.entries(palettes ?? {})) {
    if (p === DYE_PALETTE || /^pc_/.test(paletteStem(p)) || !colors?.length) continue;
    out.push({ stem: paletteStem(p), label: garmentPaletteLabel(p), colors: distinctOf(colors) });
  }
  return out.sort((a, b) => b.colors.length - a.colors.length || a.label.localeCompare(b.label));
}

/**
 * Every creator palette there is, by family and then species: the creator's table carries each one's colours
 * (`pc_*`, written for exactly this); without it, the ones the wardrobe's own recipes carry.
 */
export function creatorPalettes(table: CreatorTable | null | undefined, fallback?: Readonly<Record<string, number[][]>> | null): NamedPalette[] {
  const found = new Map<string, number[][]>();
  for (const [stem, meta] of Object.entries(table?.palettes ?? {})) if (/^pc_/.test(stem) && meta.colors?.length) found.set(stem, meta.colors);
  if (!found.size) for (const [p, colors] of Object.entries(fallback ?? {})) if (/^pc_/.test(paletteStem(p)) && colors?.length) found.set(paletteStem(p), colors);
  const familyOf = (stem: string) => /^pc_([a-z]+)_/.exec(stem)?.[1] ?? '';
  const rank = (f: string) => (FAMILY_ORDER.includes(f) ? FAMILY_ORDER.indexOf(f) : FAMILY_ORDER.length);
  return [...found]
    .map(([stem, colors]) => ({ stem, label: creatorPaletteLabel(stem), colors: distinctOf(colors) }))
    .sort((a, b) => rank(familyOf(a.stem)) - rank(familyOf(b.stem)) || a.label.localeCompare(b.label));
}

/**
 * Every species' eye palette, for an eye colour's Every species tab, each under the game's own word for the
 * eye row where the table gives one (off the first species' row that names it) and the species' name; where no
 * row has a word, the page's own word for an eye palette (`paletteFamily`, variableLabel.ts).
 */
export function eyePalettes(table: CreatorTable | null | undefined): NamedPalette[] {
  if (!table) return [];
  let word: string | null = null;
  for (const s of Object.values(table.species)) {
    const row = s.rows.find((r) => r.name === 'color_eyes' && r.label);
    if (row?.label) {
      word = row.label;
      break;
    }
  }
  const out: NamedPalette[] = [];
  for (const [stem, meta] of Object.entries(table.palettes)) {
    const m = /^pc_eye_([a-z]+)$/.exec(stem);
    if (!m || !meta.colors?.length) continue;
    const said = word ?? paletteFamily(stem) ?? plainLabel(stem);
    // The creator's colours first, as the Own tab lays them out: what each species was offered leads.
    out.push({ stem, label: `${said} (${speciesName(m[1])})`, colors: distinctOf(meta.colors) });
  }
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

/** Hue (0..1), saturation and lightness of a colour, 0..255 in. */
function hsl(c: readonly number[]): [number, number, number] {
  const r = c[0] / 255;
  const g = c[1] / 255;
  const b = c[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  if (h < 0) h += 1;
  return [h, s, l];
}

/** Colours sorted for browsing: greys first, darkest to lightest, then by slice of hue, each slice dark to light. */
export function sortColours(list: readonly number[][], tune: typeof DYE_TUNE = DYE_TUNE): number[][] {
  const keyed = list.map((c) => {
    const [h, s, l] = hsl(c);
    const grey = s < tune.greyBelow;
    return { c, grey, slice: grey ? -1 : Math.floor(h * tune.hueSteps) % tune.hueSteps, l };
  });
  keyed.sort((a, b) => a.slice - b.slice || a.l - b.l);
  return keyed.map((k) => k.c);
}

/**
 * The colours of several palettes in one grid: each colour once, a colour within `levels` on every channel
 * of one already kept folded into it (the first met keeps its place), then sorted for browsing.
 */
export function foldColours(lists: readonly (readonly number[][])[], levels: number, tune: typeof DYE_TUNE = DYE_TUNE): number[][] {
  const seen = new Set<number>();
  const kept: number[][] = [];
  for (const list of lists) {
    for (const c of list) {
      const k = (c[0] << 16) | (c[1] << 8) | c[2];
      if (seen.has(k)) continue;
      seen.add(k);
      if (levels > 0 && kept.some((x) => Math.abs(x[0] - c[0]) <= levels && Math.abs(x[1] - c[1]) <= levels && Math.abs(x[2] - c[2]) <= levels)) continue;
      kept.push([c[0], c[1], c[2]]);
    }
  }
  return sortColours(kept, tune);
}

/** The All grid for a wardrobe's palettes, worked out once per parsed file (it is about two million comparisons). */
const allCache = new Map<object, number[][]>();
export function allGarmentColours(garments: readonly NamedPalette[], key: object, tune: typeof DYE_TUNE = DYE_TUNE): number[][] {
  let all = allCache.get(key);
  if (!all) {
    all = foldColours(
      garments.map((g) => g.colors),
      tune.foldLevels,
      tune,
    );
    allCache.set(key, all);
  }
  return all;
}

/** The colour a row's value shows: a colour carried whole as itself, an index as its palette's entry; null for none. */
export function valueRgb(value: number, colors: readonly number[][] | undefined): [number, number, number] | null {
  if (isRawColour(value)) return rawRgb(value);
  if (!colors?.length) return null;
  const c = colors[Math.min(Math.max(Math.round(value), 0), colors.length - 1)];
  return c ? [c[0], c[1], c[2]] : null;
}

/** `#rrggbb` for a colour. */
export function hexOf(rgb: readonly number[]): string {
  return `#${[rgb[0], rgb[1], rgb[2]].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('')}`;
}

/** A `#rrggbb` (or `#rgb`) as a colour carried whole, or null when it is not one. */
export function rawFromHex(text: string): number | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].replace(/./g, (x) => x + x) : m[1];
  const n = parseInt(h, 16);
  return rawColour((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/** What a colour row's count reads: the colour carried whole as `#rrggbb`, else the index of how many. */
export function countText(value: number, colors: readonly number[][] | undefined): string {
  if (isRawColour(value)) return hexOf(rawRgb(value));
  return `${Math.round(value) + 1}/${colors?.length ?? 0}`;
}

// ---- the picker on the page -----------------------------------------------------------------------

/** A colour row as the picker serves it. */
export interface PickerRow {
  label: string;
  kind: PickKind;
  /** Its own palette, in the palette's order: the Own tab writes the index of what is picked there. */
  colors: number[][];
  /** How the Own tab lays the palette out (the creator's colours first, in the game's own columns). */
  layout: SwatchLayout;
  /** What the Default chip puts back: the recipe's own default. */
  defaultValue: number;
  current(): number;
  pick(value: number): void;
}

/** Every palette a picker can offer beyond the row's own. */
export interface PickerSource {
  garments: NamedPalette[];
  creator: NamedPalette[];
  eyes: NamedPalette[];
  all: number[][];
}

/** One block of swatches as a tab lays it out: its heading, its colours, its columns and cell, and the index its first colour writes. */
export interface BlockPlan {
  label: string | null;
  /** Said after the heading, quieter (a palette's count). */
  note?: string;
  colors: number[][];
  cols: number;
  cell: number;
  /** The index in the row's own palette its first colour writes (the Own tab's blocks); null: each colour writes itself whole. */
  base: number | null;
}

/**
 * The blocks a tab shows for a row, `room` pixels wide (0 when the picker is not on the page yet): the Own tab
 * the row's own palette, the creator's colours first in the game's own columns and the rest under them, each
 * swatch writing its index; every other tab its palettes (or the All grid), each swatch writing its colour whole.
 */
export function tabBlocks(tab: PickerTab, row: Pick<PickerRow, 'colors' | 'layout'>, source: PickerSource, room: number, tune: typeof DYE_TUNE = DYE_TUNE): BlockPlan[] {
  const out: BlockPlan[] = [];
  const fit = (cell: number) => (room > 0 ? Math.max(4, Math.floor(room / cell)) : CREATOR_TUNE.moreColumns);
  const add = (label: string | null, colors: number[][], cols: number, cell: number, base: number | null, note?: string): void => {
    if (colors.length) out.push({ label, ...(note ? { note } : {}), colors, cols: Math.max(1, cols), cell, base });
  };
  if (tab === 'own') {
    const lay = row.layout;
    add(null, row.colors.slice(0, lay.creation), lay.columns, tune.cell, 0);
    if (lay.more > 0) add('More colours', row.colors.slice(lay.creation), lay.moreColumns, tune.cell, lay.creation);
  } else if (tab === 'all') {
    add(`${source.all.length.toLocaleString('en')} colours`, source.all, fit(tune.allCell), tune.allCell, null, ' every garment colour, near twins folded');
  } else {
    const list = tab === 'garments' ? source.garments : tab === 'creator' ? source.creator : source.eyes;
    for (const p of list) add(p.label, p.colors, fit(tune.cell), tune.cell, null, ` ${p.colors.length}`);
  }
  return out;
}

/**
 * What the swatch at `i` of a block writes: on the Own tab its index in the row's own palette, which keeps the
 * game's meaning (a skin stays a skin tone of the species' own); anywhere else its colour carried whole. Null
 * past the block's last swatch.
 */
export function pickValue(block: Pick<BlockPlan, 'colors' | 'base'>, i: number): number | null {
  const c = block.colors[i];
  if (!c) return null;
  return block.base !== null ? block.base + i : rawColour(c[0], c[1], c[2]);
}

/** One block on the page: its plan and the canvas it is drawn on. */
interface Block extends BlockPlan {
  canvas: HTMLCanvasElement;
}

/** Draw a block's swatches, the colour now outlined wherever it stands. */
function drawBlock(b: Block, now: [number, number, number] | null): void {
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const rows = Math.max(1, Math.ceil(b.colors.length / b.cols));
  const w = b.cols * b.cell;
  const h = rows * b.cell;
  if (b.canvas.width !== Math.round(w * dpr) || b.canvas.height !== Math.round(h * dpr)) {
    b.canvas.width = Math.round(w * dpr);
    b.canvas.height = Math.round(h * dpr);
    b.canvas.style.width = `${w}px`;
    b.canvas.style.height = `${h}px`;
  }
  const g = b.canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  b.colors.forEach((c, i) => {
    const x = (i % b.cols) * b.cell;
    const y = Math.floor(i / b.cols) * b.cell;
    g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    g.fillRect(x, y, b.cell - 1, b.cell - 1);
  });
  if (!now) return;
  g.lineWidth = 2;
  b.colors.forEach((c, i) => {
    if (c[0] !== now[0] || c[1] !== now[1] || c[2] !== now[2]) return;
    const x = (i % b.cols) * b.cell;
    const y = Math.floor(i / b.cols) * b.cell;
    g.strokeStyle = colourOf(COL.void);
    g.strokeRect(x - 0.5, y - 0.5, b.cell, b.cell);
    g.strokeStyle = colourOf(COL.accent);
    g.strokeRect(x + 0.5, y + 0.5, b.cell - 2, b.cell - 2);
  });
}

/**
 * A row's swatch strip, which opens its picker: the colour now as a chip, then the colours its species was
 * offered at creation in one line (as many as fit), the one now outlined. Our dye shows only its chip, a
 * slash through it while undyed.
 */
export function drawStrip(canvas: HTMLCanvasElement, row: PickerRow, tune: typeof DYE_TUNE = DYE_TUNE): void {
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const w = Math.max(60, canvas.clientWidth || 200);
  const h = Math.max(10, canvas.clientHeight || 14);
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const value = row.current();
  const now = row.kind === 'dye' && !isRawColour(value) ? null : valueRgb(value, row.colors);
  const chip = Math.min(28, w / 4);
  if (now) {
    g.fillStyle = `rgb(${now[0]},${now[1]},${now[2]})`;
    g.fillRect(0, 0, chip, h);
  } else {
    g.strokeStyle = colourOf(COL.muted);
    g.lineWidth = 1;
    g.strokeRect(0.5, 0.5, chip - 1, h - 1);
    g.beginPath();
    g.moveTo(1, h - 1);
    g.lineTo(chip - 1, 1);
    g.stroke();
  }
  if (row.kind === 'dye') return;
  const cell = tune.cell;
  const from = chip + 6;
  const fit = Math.max(0, Math.floor((w - from) / cell));
  const shown = Math.min(fit, row.layout.creation || row.colors.length, row.colors.length);
  const y = Math.max(0, (h - cell) / 2);
  for (let i = 0; i < shown; i++) {
    const c = row.colors[i];
    g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
    g.fillRect(from + i * cell, y, cell - 1, cell - 1);
    if (now && c[0] === now[0] && c[1] === now[1] && c[2] === now[2]) {
      g.strokeStyle = colourOf(COL.accent);
      g.lineWidth = 1.5;
      g.strokeRect(from + i * cell + 0.75, y + 0.75, cell - 2.5, cell - 2.5);
    }
  }
}

/**
 * One picker, under one row: its tabs, the Default chip, the count, and the blocks of the tab showing. Made
 * when the row's strip is clicked and taken off the page when it closes; nothing of it is kept.
 */
export class DyePicker {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly count: HTMLElement;
  private readonly row: PickerRow;
  private readonly source: PickerSource;
  private readonly tune: typeof DYE_TUNE;
  private readonly blocks: Block[] = [];
  private shown: PickerTab;
  /** Called when the picker asks to be closed (its own close button). */
  onClose: () => void = () => {};

  constructor(row: PickerRow, source: PickerSource, tune: typeof DYE_TUNE = DYE_TUNE) {
    this.row = row;
    this.source = source;
    this.tune = tune;
    const tabs = this.tabs();
    this.shown = tabs.includes(openTab(row.kind, tune)) ? openTab(row.kind, tune) : tabs[0];
    this.el = document.createElement('div');
    this.el.className = 'dye-picker';
    const head = document.createElement('div');
    head.className = 'dye-head';
    const strip = document.createElement('div');
    strip.className = 'dye-tabs';
    for (const t of tabs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `dye-tab${t === this.shown ? ' on' : ''}`;
      b.dataset.tab = t;
      b.textContent = TAB_LABEL[t];
      strip.append(b);
    }
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'dye-chip';
    chip.textContent = 'Default';
    chip.title = row.kind === 'paint' ? "Back to the hull's own colour" : "Back to the piece's own colour";
    this.count = document.createElement('span');
    this.count.className = 'dye-count';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'dye-close';
    close.textContent = 'Close';
    head.append(strip, chip, this.count, close);
    this.body = document.createElement('div');
    this.body.className = 'dye-body';
    this.body.style.maxHeight = `${tune.maxHeight}px`;
    this.el.append(head, this.body);
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const tab = t.closest<HTMLElement>('.dye-tab');
      if (tab?.dataset.tab) {
        this.show(tab.dataset.tab as PickerTab);
        return;
      }
      if (t.closest('.dye-chip')) {
        this.row.pick(this.row.defaultValue);
        this.refresh();
        return;
      }
      if (t.closest('.dye-close')) {
        this.onClose();
        return;
      }
      if (t instanceof HTMLCanvasElement) this.pickAt(t, e as MouseEvent);
    });
  }

  /** The tabs this row offers that have something in them. */
  private tabs(): PickerTab[] {
    const has: Record<PickerTab, boolean> = { own: this.row.colors.length > 0, garments: this.source.garments.length > 0, creator: this.source.creator.length > 0, eyes: this.source.eyes.length > 0, all: this.source.all.length > 0 };
    const out = pickerTabs(this.row.kind).filter((t) => has[t]);
    return out.length ? out : ['own'];
  }

  /** The tab showing, for the console. */
  get tab(): PickerTab {
    return this.shown;
  }

  /** Put it on the page right after `after` (the row it belongs to) and draw its tab. */
  mount(after: Element): void {
    after.after(this.el);
    this.show(this.shown);
  }

  /** Show a tab: its blocks made afresh, each as wide as the picker has room for. */
  show(tab: PickerTab): void {
    this.shown = tab;
    for (const b of this.el.querySelectorAll<HTMLElement>('.dye-tab')) b.classList.toggle('on', b.dataset.tab === tab);
    this.blocks.length = 0;
    this.body.textContent = '';
    const room = Math.max(0, this.body.clientWidth - 8);
    for (const plan of tabBlocks(tab, this.row, this.source, room, this.tune)) {
      if (plan.label) {
        const h = document.createElement('div');
        h.className = 'dye-label';
        h.textContent = plan.label;
        if (plan.note) {
          const n = document.createElement('span');
          n.textContent = plan.note;
          h.append(n);
        }
        this.body.append(h);
      }
      const canvas = document.createElement('canvas');
      canvas.className = 'dye-grid';
      canvas.title = plan.label ?? '';
      this.body.append(canvas);
      this.blocks.push({ ...plan, canvas });
    }
    this.refresh();
  }

  /** Every block's outline and the count put back in step with the row's value. */
  refresh(): void {
    const value = this.row.current();
    const now = this.row.kind === 'dye' && !isRawColour(value) ? null : valueRgb(value, this.row.colors);
    for (const b of this.blocks) drawBlock(b, now);
    this.count.textContent = this.row.kind === 'dye' && !isRawColour(value) ? 'undyed' : countText(value, this.row.colors);
  }

  /** A click on a block: the swatch under it, its index on the Own tab, its colour whole anywhere else (`pickValue`). */
  private pickAt(canvas: HTMLCanvasElement, e: MouseEvent): void {
    const b = this.blocks.find((x) => x.canvas === canvas);
    if (!b) return;
    const r = canvas.getBoundingClientRect();
    const col = Math.floor((e.clientX - r.left) / b.cell);
    const line = Math.floor((e.clientY - r.top) / b.cell);
    if (col < 0 || col >= b.cols || line < 0) return;
    const v = pickValue(b, line * b.cols + col);
    if (v === null) return;
    this.row.pick(v);
    this.refresh();
  }

  close(): void {
    this.el.remove();
    this.blocks.length = 0;
  }
}
