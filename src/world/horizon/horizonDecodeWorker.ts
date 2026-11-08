// The far ground's decode worker (`horizonDecode.ts` does the work): one bake decoded a message, its families, its
// colours and the tile tables kept for the detail window, which is made again here whenever the field asks, and for the
// overlays the field lays over the bake (W2: the poles and colour cells the live generator made again), whose albedo is
// composed again here over their cells and the coarse texels those reach.
import { coarseAlbedoRegion, coarseReach, composeAlbedoRegion, decodeBake, detailWindow, inflate, type ColourOverride, type PoleOverride, type TileTables } from './horizonDecode.ts';
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

type Message =
  | { type: 'decode'; id: number; header: HorizonHeader; bin: ArrayBuffer; tables: TileTables; centre: { x: number; z: number }; shift: { x: number; z: number }; eye: { rx: number; rz: number } }
  | { type: 'detail'; id: number; rx: number; rz: number }
  | { type: 'overlay'; id: number; poles: PoleOverride | null; cells: ColourOverride | null; i0: number; j0: number; i1: number; j1: number };

self.onmessage = async (e: MessageEvent) => {
  const m = e.data as Message;
  try {
    if (m.type === 'decode') {
      const bin = new Uint8Array(m.bin);
      const d = await decodeBake(m.header, bin, m.tables, m.centre, m.shift, m.eye);
      const sec = async (name: 'families' | 'colour' | 'coarseFamilies' | 'coarseColour') => {
        const s = sectionOf(m.header, name);
        return inflate(bin.subarray(s.offset, s.offset + s.length));
      };
      kept = { header: m.header, families: await sec('families'), colour: await sec('colour'), coarseFamilies: await sec('coarseFamilies'), coarseColour: await sec('coarseColour'), tables: m.tables, poles: [], cells: [] };
      const buffers: ArrayBuffer[] = [d.fine.buffer, d.coarse.buffer, d.fineNormal.buffer, d.coarseNormal.buffer, d.albedo.buffer, d.coarseAlbedo.buffer, d.detail.buffer] as ArrayBuffer[];
      for (const a of [...d.pyramid.lo, ...d.pyramid.hi]) buffers.push(a.buffer as ArrayBuffer);
      (self as unknown as Worker).postMessage({ type: 'decoded', id: m.id, d }, buffers);
    } else if (m.type === 'detail') {
      if (!kept) return;
      const detail = detailWindow(kept.tables, kept.header, kept.families, m.rx, m.rz, undefined, kept.poles);
      (self as unknown as Worker).postMessage({ type: 'detail', id: m.id, detail, rx: m.rx, rz: m.rz }, [detail.buffer]);
    } else if (m.type === 'overlay') {
      if (!kept) return;
      if (m.poles) kept.poles.push(m.poles);
      if (m.cells) kept.cells.push(m.cells);
      const r = coarseReach(kept.header, m.i0, m.j0, m.i1, m.j1);
      // The fine cells every coarse texel the change reaches averages, so the coarse texels are whole.
      const fine = composeAlbedoRegion(kept.tables, kept.header, kept.families, kept.colour, kept.poles, kept.cells, Math.min(m.i0, r.fi0), Math.min(m.j0, r.fj0), Math.max(m.i1, r.fi1), Math.max(m.j1, r.fj1));
      const coarse = coarseAlbedoRegion(kept.tables, kept.header, fine, kept.coarseFamilies, kept.coarseColour, r.ci0, r.cj0, r.ci1, r.cj1);
      (self as unknown as Worker).postMessage({ type: 'overlay', id: m.id, fine, coarse }, [fine.rgba.buffer, coarse.rgba.buffer] as ArrayBuffer[]);
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', id: m.id, message: String((err as Error)?.message ?? err) });
  }
};
