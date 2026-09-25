// A structure's footprint: the grid the client drew while you placed a building.
//
// `FORM FOOT > FORM 0000 > INFO + PRNT`, and it is one of the smallest formats in the archives.
// INFO is six words: the cells across and along, which cell the building's own origin stands on,
// and how big one cell is in metres both ways. PRNT is one NUL-terminated string per row, one
// character per cell.
//
// The characters are `F`, `H` and `.` and nothing else across all 86 files in the retail archives:
// 1,185 `F`, 1,098 `H` and 50 `.`. `F` is the building's own ground and `H` is the hard border round
// it that nothing else may stand in -- which is read off the shapes rather than out of any document,
// because every footprint's `F` cells are a solid block and its `H` cells surround them. `.` is
// nothing at all. The deed template declares `useStructureFootprintOutline` beside the footprint's
// name, so this grid is what the game itself drew under the ghost of a building being placed.
//
// Every one of the 86 parses to the byte: the rows match the counts on all of them and the pivot is
// inside the grid on all of them, which this checks on every file of every run rather than once by
// hand. Cell sizes really do vary -- 3x2, 3x3, 4x4, 6x6, 8x8, 16x16 and 32x32 metres all occur --
// so nothing may assume eight.
//
// Dependency-free but for the shared IFF reader, and shared with tools/swg/tests/sfp.test.ts.

import { parseIff } from './iff.mjs';

/**
 * One footprint, or null when the file is not one.
 *
 * `rows` is top to bottom as the file writes them, one character a cell; `pivotX`/`pivotZ` name the
 * cell the building's own origin stands on, and the origin is that cell's **middle**, which is what
 * makes an odd grid with a middle pivot come out centred.
 */
export function readFootprint(raw) {
  let root;
  try {
    // The shared reader wants a Buffer (it reads big-endian sizes off one); the archives hand it
    // one already and a caller with plain bytes should not have to know that.
    root = parseIff(Buffer.isBuffer(raw) ? raw : Buffer.from(raw));
  } catch {
    return null;
  }
  if (root?.type !== 'FOOT') return null;
  const version = root.children?.find((c) => c.children);
  if (!version) return null;
  const info = version.children.find((c) => c.tag === 'INFO');
  const prnt = version.children.find((c) => c.tag === 'PRNT');
  if (!info?.data || !prnt?.data || info.data.length < 24) return null;
  const b = Buffer.from(info.data);
  const width = b.readInt32LE(0);
  const height = b.readInt32LE(4);
  const pivotX = b.readInt32LE(8);
  const pivotZ = b.readInt32LE(12);
  const cellWidth = b.readFloatLE(16);
  const cellHeight = b.readFloatLE(20);
  const rows = Buffer.from(prnt.data)
    .toString('latin1')
    .split('\0')
    .filter((s) => s.length > 0);
  if (!(width > 0) || !(height > 0) || !(cellWidth > 0) || !(cellHeight > 0)) return null;
  return { version: version.type, width, height, pivotX, pivotZ, cellWidth, cellHeight, rows };
}

/**
 * What is wrong with a footprint, as a list of words, or an empty list when nothing is.
 *
 * Reported rather than thrown: a file that does not match its own counts is worth knowing about in
 * the conversion's own printout, and one bad footprint must not cost the run.
 */
export function footprintFaults(f) {
  const out = [];
  if (!f) return ['not a footprint'];
  if (f.rows.length !== f.height) out.push(`${f.rows.length} rows for a height of ${f.height}`);
  for (const [i, r] of f.rows.entries()) if (r.length !== f.width) out.push(`row ${i} is ${r.length} wide, not ${f.width}`);
  if (f.pivotX < 0 || f.pivotX >= f.width || f.pivotZ < 0 || f.pivotZ >= f.height) out.push(`the pivot ${f.pivotX},${f.pivotZ} is outside the grid`);
  const odd = [...new Set([...f.rows.join('')].filter((c) => c !== 'F' && c !== 'H' && c !== '.'))];
  if (odd.length) out.push(`characters the retail files never use: ${odd.map((c) => JSON.stringify(c)).join(', ')}`);
  return out;
}

/** The metres a footprint covers, across and along. */
export function footprintSize(f) {
  return { x: f.width * f.cellWidth, z: f.height * f.cellHeight };
}

/**
 * The patch a footprint asks for, in the shape the game's own placing rules take: half the span each
 * way and where the middle of that span sits relative to the building's own origin.
 *
 * The origin stands at the **middle of the pivot cell**, so a grid whose pivot is its middle cell
 * has no offset and one whose pivot is a corner has the whole half-span as its offset. This is the
 * same arithmetic as `patchOfFootprint` in `src/world/housePlace.ts` and the node test compares the
 * two, because one of them is the converter's and the other is the game's and they must agree.
 */
export function footprintPatch(f) {
  const x = f.width * f.cellWidth;
  const z = f.height * f.cellHeight;
  return {
    hx: x / 2,
    hz: z / 2,
    cx: x / 2 - (f.pivotX + 0.5) * f.cellWidth,
    cz: z / 2 - (f.pivotZ + 0.5) * f.cellHeight,
  };
}

/** What goes in a pack: everything a browser needs to draw the outline and test the ground. */
export function footprintEntry(f) {
  return { w: f.width, h: f.height, px: f.pivotX, pz: f.pivotZ, cw: f.cellWidth, ch: f.cellHeight, rows: f.rows };
}
