// The far ground's decode worker (`horizonDecode.ts` does the work): one bake decoded a message, its families, its
// colours and the tile tables kept for the composition window, which is made again here whenever the field asks (whole,
// or by the strips the eye's move brought into it), and for the overlays the field lays over the bake (W2: the poles and
// colour cells the live generator made again), whose albedo is composed again here over their cells and the coarse
// texels those reach. A ground knob's move hands it new tables (`retune`): the albedo composed again whole.
import { coarseAlbedoRegion, coarseReach, composeAlbedo, composeAlbedoRegion, composeBake, composeCoarseAlbedo, decodeBake, inflate, TileComposer, tintRect, wholeWindow, windowRect, type ColourOverride, type IndexRect, type PoleOverride, type TileTables, type WindowPlace } from './horizonDecode.ts';
import { MadeGround, makeBake, plainAlbedos, type MadeGroundSpec } from './horizonDem.ts';
import { sectionOf, type HorizonHeader } from './horizonFile.ts';

interface Kept {
  header: HorizonHeader;
  families: Uint8Array;
  colour: Uint8Array;
  coarseFamilies: Uint8Array;
  coarseColour: Uint8Array;
  tables: TileTables;
  /** The overlays laid so far, oldest first (the newest wins where two hold a pole or a cell). */
  poles: PoleOverride[];
  cells: ColourOverride[];
}
let kept: Kept | null = null;
/** A world with no converted terrain's ground (h6b, `horizonDem.ts`), kept for the shape window's poles (`poles`). */
let madeGround: MadeGround | null = null;

type Message =
  | { type: 'decode'; id: number; header: HorizonHeader; bin: ArrayBuffer; tables: TileTables; centre: { x: number; z: number }; shift: { x: number; z: number }; eye: { rx: number; rz: number }; S: number }
  | { type: 'make'; id: number; spec: MadeGroundSpec; tables: TileTables | null; centre: { x: number; z: number }; shift: { x: number; z: number }; eye: { rx: number; rz: number }; S: number }
  | { type: 'poles'; id: number; startX: number; startZ: number; n: number; step: number }
  | { type: 'window'; id: number; place: WindowPlace }
  | { type: 'strip'; id: number; place: WindowPlace; tiles: IndexRect[]; cells: IndexRect[] }
  | { type: 'retune'; id: number; tables: TileTables; place: WindowPlace }
  | { type: 'overlay'; id: number; poles: PoleOverride | null; cells: ColourOverride | null; i0: number; j0: number; i1: number; j1: number };

const post = (m: unknown, buffers: ArrayBuffer[]) => (self as unknown as Worker).postMessage(m, buffers);

self.onmessage = async (e: MessageEvent) => {
  const m = e.data as Message;
  try {
    if (m.type === 'decode') {
      const bin = new Uint8Array(m.bin);
      const d = await decodeBake(m.header, bin, m.tables, m.centre, m.shift, m.eye, m.S);
      const sec = async (name: 'families' | 'colour' | 'coarseFamilies' | 'coarseColour') => {
        const s = sectionOf(m.header, name);
        return inflate(bin.subarray(s.offset, s.offset + s.length));
      };
      kept = { header: m.header, families: await sec('families'), colour: await sec('colour'), coarseFamilies: await sec('coarseFamilies'), coarseColour: await sec('coarseColour'), tables: m.tables, poles: [], cells: [] };
      const buffers: ArrayBuffer[] = [d.fine.buffer, d.coarse.buffer, d.fineNormal.buffer, d.albedo.buffer, d.coarseAlbedo.buffer, d.window.buffer, d.tint.buffer] as ArrayBuffer[];
      for (const a of [...d.pyramid.lo, ...d.pyramid.hi]) buffers.push(a.buffer as ArrayBuffer);
      post({ type: 'decoded', id: m.id, d }, buffers);
    } else if (m.type === 'make') {
      // A world with no converted terrain (h6b): the bake's own lattices and sections made here, then the decode's own steps.
      const t0 = performance.now();
      const g = new MadeGround(m.spec);
      const b = makeBake(g);
      const ms = { inflate: 0, heights: performance.now() - t0, normals: 0, albedo: 0, pyramid: 0, detail: 0, memo: 0 };
      const t1 = performance.now();
      const plain = m.tables ? null : plainAlbedos(b, m.spec.plain!);
      if (plain) ms.albedo = performance.now() - t1;
      const d = composeBake(b.header, b.fine, b.coarse, b, m.tables, m.centre, m.shift, m.eye, m.S, ms, plain);
      d.header = b.header;
      madeGround = g;
      if (m.tables) kept = { header: b.header, families: b.families, colour: b.colour, coarseFamilies: b.coarseFamilies, coarseColour: b.coarseColour, tables: m.tables, poles: [], cells: [] };
      const buffers: ArrayBuffer[] = [d.fine.buffer, d.coarse.buffer, d.fineNormal.buffer, d.albedo.buffer, d.coarseAlbedo.buffer, d.window.buffer, d.tint.buffer] as ArrayBuffer[];
      for (const a of [...d.pyramid.lo, ...d.pyramid.hi]) buffers.push(a.buffer as ArrayBuffer);
      post({ type: 'decoded', id: m.id, d }, buffers);
    } else if (m.type === 'poles') {
      if (!madeGround) return;
      const heights = madeGround.polesIn(m.startX, m.startZ, m.n, m.step);
      post({ type: 'poles', id: m.id, heights }, [heights.buffer as ArrayBuffer]);
    } else if (m.type === 'window') {
      if (!kept) return;
      const w = wholeWindow(kept.tables, kept.header, kept.families, kept.colour, kept.poles, kept.cells, m.place);
      post({ type: 'window', id: m.id, place: m.place, window: w.window, tint: w.tint }, [w.window.buffer as ArrayBuffer, w.tint.buffer as ArrayBuffer]);
    } else if (m.type === 'strip') {
      if (!kept) return;
      const comp = new TileComposer(kept.tables, kept.families, kept.header.ground);
      comp.setOverrides(kept.poles);
      const tiles = m.tiles.map((r) => windowRect(comp, r));
      const cells = m.cells.map((r) => tintRect(kept!.colour, kept!.header.colour, kept!.cells, r));
      post({ type: 'strip', id: m.id, place: m.place, tileRects: m.tiles, cellRects: m.cells, tiles, cells }, [...tiles.map((a) => a.buffer as ArrayBuffer), ...cells.map((a) => a.buffer as ArrayBuffer)]);
    } else if (m.type === 'retune') {
      if (!kept) return;
      kept.tables = m.tables;
      // The whole albedo composed again under the knobs as they stand, the overlays laid over it as they were laid.
      const c = kept.header.colour;
      const albedo = kept.poles.length || kept.cells.length ? composeAlbedoRegion(m.tables, kept.header, kept.families, kept.colour, kept.poles, kept.cells, 0, 0, c.nx - 1, c.nz - 1).rgba : composeAlbedo(m.tables, kept.header, kept.families, kept.colour).rgba;
      const coarse = composeCoarseAlbedo(m.tables, kept.header, albedo, kept.coarseFamilies, kept.coarseColour);
      const w = wholeWindow(kept.tables, kept.header, kept.families, kept.colour, kept.poles, kept.cells, m.place);
      post({ type: 'retune', id: m.id, albedo, coarseAlbedo: coarse, place: m.place, window: w.window, tint: w.tint }, [albedo.buffer, coarse.buffer, w.window.buffer, w.tint.buffer] as ArrayBuffer[]);
    } else if (m.type === 'overlay') {
      if (!kept) return;
      if (m.poles) kept.poles.push(m.poles);
      if (m.cells) kept.cells.push(m.cells);
      const r = coarseReach(kept.header, m.i0, m.j0, m.i1, m.j1);
      // The fine cells every coarse texel the change reaches averages, so the coarse texels are whole.
      const fine = composeAlbedoRegion(kept.tables, kept.header, kept.families, kept.colour, kept.poles, kept.cells, Math.min(m.i0, r.fi0), Math.min(m.j0, r.fj0), Math.max(m.i1, r.fi1), Math.max(m.j1, r.fj1));
      const coarse = coarseAlbedoRegion(kept.tables, kept.header, fine, kept.coarseFamilies, kept.coarseColour, r.ci0, r.cj0, r.ci1, r.cj1);
      post({ type: 'overlay', id: m.id, fine, coarse }, [fine.rgba.buffer, coarse.rgba.buffer] as ArrayBuffer[]);
    }
  } catch (err) {
    post({ type: 'error', id: m.id, message: String((err as Error)?.message ?? err) }, []);
  }
};
