// The far ground's bake, its format (the horizon pass, DESIGN.md §2.2): the header `terrain/horizon.json` and the
// deflated sections of `terrain/horizon.bin`, read by the converter that writes them (`tools/swg/horizon.mjs`) and by the
// browser that draws the rings from them (`horizonField.ts`). Two lattices, each the one that matters: the heights on the
// ground's own lattice every 8 m (the chunks' vertices and the far grids stand there, so a ring vertex at the hole's edge
// stands on a chunk's), and the families on the client's 8 m pattern (raw multiples of 8), with each 8 m cell's colour
// mean centred on its corner. Everything here is in the raw frame (terrain x and z), ascending.
//
// Pure: no import, so the converter, the browser and a node test read it alike (it ships: tools/launcher/pack.mjs).

export const HORIZON_FORMAT = 1;
export const HORIZON_JSON = 'terrain/horizon.json';
export const HORIZON_BIN = 'terrain/horizon.bin';
/** The sections, in the order the file holds them. */
export const HORIZON_SECTIONS = ['heights', 'families', 'colour', 'coarseHeights', 'coarseFamilies', 'coarseColour'] as const;
export type HorizonSectionName = (typeof HORIZON_SECTIONS)[number];

/** A lattice in the raw frame: sample (i, j) stands at raw (x0 + i step, z0 + j step). */
export interface Lattice {
  x0: number;
  z0: number;
  step: number;
  nx: number;
  nz: number;
}
/** A heights lattice, with its 16-bit store's span: height = lo + q * stored. */
export interface HeightLattice extends Lattice {
  lo: number;
  q: number;
}
export interface HorizonSection {
  name: HorizonSectionName;
  offset: number;
  length: number;
  /** Its bytes inflated. */
  size: number;
}
export interface HorizonSource {
  generator: number;
  trn: { length: number; sha1: string };
  inputs: string;
  centre: { x: number; z: number };
  layers: { sha1: string; list: [number, string, number, number, number][] };
  lifeDay: boolean;
  made: 'poles' | 'grid';
  /** When it was made (ISO), for the console. */
  at?: string;
}
export interface HorizonHeader {
  format: number;
  source: HorizonSource;
  fine: HeightLattice;
  ground: Lattice;
  colour: Lattice;
  coarse: HeightLattice;
  sections: HorizonSection[];
}

/** The converter's own extents [ours, §2.14]: the map and this round it at the fine step, and this past it coarse. */
export const BAKE_DEFAULTS = { margin: 1024, farMargin: 16384, fineMost: 2305, coarseStep: 64 };

const mod = (v: number, m: number): number => ((v % m) + m) % m;

/**
 * Where a world's bake stands (§2.2), by its map's width and its layout's centre: the heights on the ground's lattice
 * (game x = shift.x + 8i, so raw x = centre.x - shift.x - 8i: a raw value congruent to centre.x - shift.x modulo 8), at
 * 8 m, or 16 m where 8 m would pass `fineMost` samples a side; the families at every 8 m pattern corner whatever the
 * step; the colour at the heights' step on raw multiples of it (cells centred on pattern corners); the coarse heights on
 * the heights' own lattice every 64 m, so every eighth fine sample is a coarse one.
 */
export function planBake(mapWidth: number, centre: { x: number; z: number }, o: Partial<typeof BAKE_DEFAULTS> = {}): { fine: Lattice; ground: Lattice; colour: Lattice; coarse: Lattice; wide: boolean } {
  const margin = o.margin ?? BAKE_DEFAULTS.margin;
  const farMargin = o.farMargin ?? BAKE_DEFAULTS.farMargin;
  const fineMost = o.fineMost ?? BAKE_DEFAULTS.fineMost;
  const cs = o.coarseStep ?? BAKE_DEFAULTS.coarseStep;
  const half = mapWidth / 2;
  const lo = -half - margin;
  const hi = half + margin;
  // The heights lattice's residue in the raw frame: centre.x less the ground's shift (centre.x mod 2), and centre.z plus
  // its own (-centre.z mod 2), each modulo 8 (`groundShift`).
  const rx = mod(centre.x - mod(centre.x, 2), 8);
  const rz = mod(centre.z + mod(-centre.z, 2), 8);
  const across = (step: number, r: number) => {
    const x0 = lo + mod(r - lo, step);
    return { x0, n: Math.floor((hi - x0) / step) + 1 };
  };
  let step = 8;
  const at8 = across(8, rx);
  const wide = at8.n > fineMost;
  if (wide) step = 16;
  const fx = across(step, rx);
  const fz = across(step, rz);
  const fine: Lattice = { x0: fx.x0, z0: fz.x0, step, nx: fx.n, nz: fz.n };
  const gx = across(8, 0);
  const ground: Lattice = { x0: gx.x0, z0: gx.x0, step: 8, nx: gx.n, nz: gx.n };
  const cx = across(step, 0);
  const colour: Lattice = { x0: cx.x0, z0: cx.x0, step, nx: cx.n, nz: cx.n };
  const k = Math.ceil((farMargin - margin) / cs);
  const c0x = fine.x0 - cs * k;
  const c0z = fine.z0 - cs * k;
  const coarse: Lattice = { x0: c0x, z0: c0z, step: cs, nx: Math.floor((half + farMargin - c0x) / cs) + 1, nz: Math.floor((half + farMargin - c0z) / cs) + 1 };
  return { fine, ground, colour, coarse, wide };
}

/**
 * Heights as 16 bits (D4): each the nearest step of `q = (hi - lo) / 65535` over the section's own span, each row's
 * samples less the one to their west (wrapping at 16 bits, the row's first less nought), in two byte planes (every low
 * byte, then every high byte), which deflate far better than the floats.
 */
export function encodeHeights(h: ArrayLike<number>, nx: number, nz: number): { bytes: Uint8Array; lo: number; q: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < nx * nz; i++) {
    const v = h[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo)) lo = hi = 0;
  const q = hi > lo ? (hi - lo) / 65535 : 1;
  const n = nx * nz;
  const bytes = new Uint8Array(n * 2);
  for (let j = 0; j < nz; j++) {
    let last = 0;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const s = Math.min(65535, Math.max(0, Math.round((h[k] - lo) / q)));
      const d = (s - last) & 0xffff;
      last = s;
      bytes[k] = d & 0xff;
      bytes[n + k] = d >> 8;
    }
  }
  return { bytes, lo, q };
}

/** The stored steps back (`encodeHeights`' inverse), as whole numbers 0..65535. */
export function decodeSteps(bytes: Uint8Array, nx: number, nz: number, out: Uint16Array = new Uint16Array(nx * nz)): Uint16Array {
  const n = nx * nz;
  for (let j = 0; j < nz; j++) {
    let last = 0;
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      last = (last + (bytes[k] | (bytes[n + k] << 8))) & 0xffff;
      out[k] = last;
    }
  }
  return out;
}

/** The heights as float32: exactly `lo + q * stored` for every sample. */
export function decodeHeights(bytes: Uint8Array, nx: number, nz: number, lo: number, q: number, out: Float32Array = new Float32Array(nx * nz)): Float32Array {
  const s = decodeSteps(bytes, nx, nz);
  for (let k = 0; k < s.length; k++) out[k] = lo + q * s[k];
  return out;
}

/** What a build of the game expects of a bake it would draw (`readHorizonHeader`). */
export interface HorizonExpect {
  generator: number;
  centre: { x: number; z: number };
  /** The `.bin`'s length, when known: a section past its end is refused. */
  binLength?: number;
}

const isLattice = (l: unknown, heights: boolean): l is HeightLattice => {
  const o = l as Record<string, unknown> | null;
  if (!o || typeof o !== 'object') return false;
  for (const k of ['x0', 'z0', 'step', 'nx', 'nz']) if (typeof o[k] !== 'number' || !Number.isFinite(o[k] as number)) return false;
  if (!((o.step as number) > 0) || !((o.nx as number) > 1) || !((o.nz as number) > 1)) return false;
  if (heights && (typeof o.lo !== 'number' || typeof o.q !== 'number' || !((o.q as number) > 0))) return false;
  return true;
};

/**
 * A bake's header read and held to what this build draws: refused in words (never thrown) when it is not one, its format is
 * newer than this build reads, another generator made it, its centre is not the layout's, or a section reaches past the
 * file's end. The words name the command that makes another.
 */
export function readHorizonHeader(json: unknown, expect: HorizonExpect, world = '<world>'): { header: HorizonHeader } | { refused: string } {
  const again = `npm run swg -- horizon assets-private --only=${world}`;
  const h = json as Partial<HorizonHeader> | null;
  if (!h || typeof h !== 'object') return { refused: `the bake's header is not one (${again})` };
  if (typeof h.format !== 'number') return { refused: `the bake's header has no format (${again})` };
  if (h.format > HORIZON_FORMAT) return { refused: `the bake is format ${h.format}, newer than this build's ${HORIZON_FORMAT}: a newer build made it` };
  if (h.format < HORIZON_FORMAT) return { refused: `the bake is format ${h.format}, older than this build's ${HORIZON_FORMAT} (${again})` };
  const s = h.source;
  if (!s || typeof s !== 'object') return { refused: `the bake says nothing of what made it (${again})` };
  if (s.generator !== expect.generator) return { refused: `the bake was made by generator revision ${s.generator}, this build's is ${expect.generator} (${again})` };
  if (!s.centre || s.centre.x !== expect.centre.x || s.centre.z !== expect.centre.z) return { refused: `the bake's centre (${s.centre?.x}, ${s.centre?.z}) is not the layout's (${expect.centre.x}, ${expect.centre.z}) (${again})` };
  if (!isLattice(h.fine, true) || !isLattice(h.coarse, true) || !isLattice(h.ground, false) || !isLattice(h.colour, false)) return { refused: `the bake's lattices are not whole (${again})` };
  if (!Array.isArray(h.sections)) return { refused: `the bake lists no sections (${again})` };
  for (const name of HORIZON_SECTIONS) {
    const sec = h.sections.find((x) => x && x.name === name);
    if (!sec || !(sec.offset >= 0) || !(sec.length > 0) || !(sec.size > 0)) return { refused: `the bake has no ${name} section (${again})` };
    if (expect.binLength !== undefined && sec.offset + sec.length > expect.binLength) return { refused: `the bake's ${name} section reaches past the file's end (${again})` };
  }
  return { header: h as HorizonHeader };
}

/** A section's entry. */
export function sectionOf(header: HorizonHeader, name: HorizonSectionName): HorizonSection {
  const s = header.sections.find((x) => x.name === name);
  if (!s) throw new Error(`no ${name} section`);
  return s;
}

/** The bytes each section inflates to, by its lattice: heights 2 a sample, families 1, colour 3. */
export function sectionSize(header: Pick<HorizonHeader, 'fine' | 'ground' | 'colour' | 'coarse'>, name: HorizonSectionName): number {
  switch (name) {
    case 'heights':
      return header.fine.nx * header.fine.nz * 2;
    case 'families':
      return header.ground.nx * header.ground.nz;
    case 'colour':
      return header.colour.nx * header.colour.nz * 3;
    case 'coarseHeights':
      return header.coarse.nx * header.coarse.nz * 2;
    case 'coarseFamilies':
      return header.coarse.nx * header.coarse.nz;
    default:
      return header.coarse.nx * header.coarse.nz * 3;
  }
}
