// What the paint's tests share (Map-maker II, W2): a terrain made in memory -- three families of shader (dirt, grass with
// three alternates, rock) over a ground of dirt, a layer whose shader filter plants a tree wherever grass stands, and a
// small rock patch making the families dirty again at the end -- and the cells a test paints by hand. Synthetic
// throughout: nothing here is read from the game's files. Not a test itself.
import { form, chunk, W, encode, ihdr, mfrc } from './iffWriter.ts';
import { GroundPaint } from '../../../src/swg/terrain/groundPaint.ts';

const header = new W().str('paint').f32(2048).f32(8).i32(2).i32(0).f32(0).f32(2).str('').f32(60)
  .f32(0).f32(0).f32(16).f32(2).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).f32(0).f32(0).f32(0).f32(0).u32(0).u8(1).bytes();
const adta = () => chunk('ADTA', new W().i32(0).i32(0).i32(1).str('').bytes());
const rect = (x0: number, z0: number, x1: number, z1: number) => form('BREC', form('0004', ihdr('rect'), chunk('DATA', new W().f32(x0).f32(z0).f32(x1).f32(z1).i32(0).f32(0).i32(0).i32(0).f32(0).f32(2).str('').i32(0).bytes())));
const ascn = (family: number) => form('ASCN', form('0001', ihdr(`paint ${family}`), chunk('DATA', new W().i32(family).i32(0).f32(1).bytes())));
const ahfr = () => form('AHCN', form('0000', ihdr('flat'), chunk('DATA', new W().i32(0).f32(3).bytes())));
const fshd = (family: number) => form('FSHD', form('0000', ihdr(`on ${family}`), chunk('DATA', new W().i32(family).bytes())));
const afsc = (family: number) => form('AFSC', form('0004', ihdr('trees'), chunk('DATA', new W().i32(family).i32(1).i32(0).i32(0).f32(1).bytes())));
const layer = (name: string, ...items: ReturnType<typeof form>[]) => form('LAYR', form('0003', ihdr(name), adta(), ...items));
const sfam = (id: number, name: string, kids: number) => {
  const w = new W().i32(id).str(name).str('').u8(1).u8(2).u8(3).f32(4).f32(1).i32(kids);
  for (let k = 0; k < kids; k++) w.str(`shader/${name}_${k}.sht`).f32(1);
  return chunk('SFAM', w.bytes());
};

/** The made terrain's bytes: dirt over a ground 3 m up, trees wherever grass stands, a rock patch at (-40..-30, 30..40). */
export function paintTerrainBytes(): Uint8Array {
  const sgrp = form('SGRP', form('0006', sfam(1, 'dirt', 3), sfam(2, 'grass', 3), sfam(3, 'rock', 1)));
  const ffam = chunk('FFAM', new W().i32(1).str('tree').u8(0).u8(0).u8(0).f32(1).i32(0).i32(1).str('appearance/tree.apt').f32(1).i32(0).f32(0).f32(0).i32(0).i32(0).f32(1).f32(1).bytes());
  const mgrp = form('MGRP', form('0000', form('MFAM', chunk('DATA', new W().i32(1).str('noise').bytes()), mfrc(1337, { oct: 2, freq: 2, amp: 0.5, sx: 0.02, sy: 0.02 }))));
  const tgen = form('TGEN', form('0000', sgrp, form('FGRP', form('0008', ffam)), form('RGRP', form('0003')), form('EGRP', form('0002')), mgrp, form('LYRS',
    layer('ground', rect(-4000, -4000, 4000, 4000), ascn(1), ahfr()),
    layer('trees on grass', rect(-4000, -4000, 4000, 4000), fshd(2), afsc(1)),
    layer('rock', rect(-40, 30, -30, 40), ascn(3)),
  )));
  return encode(form('PTAT', form('0015', chunk('DATA', header), tgen, form('BAKE'))));
}

/** A family cell painted with a palette entry (made where its tile is not). */
export function cellPaint(p: GroundPaint, cx: number, cz: number, entry: number): void {
  const n = p.n;
  const tx = Math.floor(cx / n);
  const tz = Math.floor(cz / n);
  p.familyTile(tx, tz, true)![(cz - tz * n) * n + (cx - tx * n)] = entry;
}

/** A colour cell painted: its three bytes and its amount. */
export function colourCell(p: GroundPaint, cx: number, cz: number, r: number, g: number, b: number, a: number): void {
  const n = p.n;
  const tx = Math.floor(cx / n);
  const tz = Math.floor(cz / n);
  const t = p.colourTile(tx, tz, true)!;
  const k = ((cz - tz * n) * n + (cx - tx * n)) * 4;
  t[k] = r;
  t[k + 1] = g;
  t[k + 2] = b;
  t[k + 3] = a;
}

/** Every typed array of an object by name, the same by `Object.is` (a block, a grid, a worker's reply). */
export function sameArrays(a: object, b: object): boolean {
  const arrs = (o: object) => new Map(Object.entries(o).filter(([, v]) => v && typeof v === 'object' && ArrayBuffer.isView(v)) as [string, ArrayLike<number>][]);
  const x = arrs(a);
  const y = arrs(b);
  if (x.size !== y.size) return false;
  for (const [k, v] of x) {
    const w = y.get(k);
    if (!w || w.length !== v.length) return false;
    for (let i = 0; i < v.length; i++) if (!Object.is(v[i], w[i])) return false;
  }
  return true;
}
