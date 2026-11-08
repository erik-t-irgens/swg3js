// The far ground's decode worker (`horizonDecode.ts` does the work): one bake decoded a message, its families and the
// tile tables kept for the detail window, which is made again here whenever the field asks.
import { decodeBake, detailWindow, inflate, type TileTables } from './horizonDecode.ts';
import { sectionOf, type HorizonHeader } from './horizonFile.ts';

interface Kept {
  header: HorizonHeader;
  families: Uint8Array;
  tables: TileTables;
}
let kept: Kept | null = null;

self.onmessage = async (e: MessageEvent) => {
  const m = e.data as { type: 'decode'; id: number; header: HorizonHeader; bin: ArrayBuffer; tables: TileTables; centre: { x: number; z: number }; shift: { x: number; z: number }; eye: { rx: number; rz: number } } | { type: 'detail'; id: number; rx: number; rz: number };
  try {
    if (m.type === 'decode') {
      const bin = new Uint8Array(m.bin);
      const d = await decodeBake(m.header, bin, m.tables, m.centre, m.shift, m.eye);
      const fam = sectionOf(m.header, 'families');
      kept = { header: m.header, families: await inflate(bin.subarray(fam.offset, fam.offset + fam.length)), tables: m.tables };
      const buffers: ArrayBuffer[] = [d.fine.buffer, d.coarse.buffer, d.fineNormal.buffer, d.coarseNormal.buffer, d.albedo.buffer, d.coarseAlbedo.buffer, d.detail.buffer] as ArrayBuffer[];
      for (const a of [...d.pyramid.lo, ...d.pyramid.hi]) buffers.push(a.buffer as ArrayBuffer);
      (self as unknown as Worker).postMessage({ type: 'decoded', id: m.id, d }, buffers);
    } else if (m.type === 'detail') {
      if (!kept) return;
      const detail = detailWindow(kept.tables, kept.header, kept.families, m.rx, m.rz);
      (self as unknown as Worker).postMessage({ type: 'detail', id: m.id, detail, rx: m.rx, rz: m.rz }, [detail.buffer]);
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', id: m.id, message: String((err as Error)?.message ?? err) });
  }
};
