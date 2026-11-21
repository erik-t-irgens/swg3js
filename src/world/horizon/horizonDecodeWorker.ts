// The far ground's decode worker (`horizonDecode.ts` does the work): one bake decoded a message, its families, its
// colours and the tile tables kept for the composition window, which is made again here whenever the field asks (whole,
// or by the strips the eye's move brought into it), and for the overlays the field lays over the bake (W2: the poles and
// colour cells the live generator made again), whose albedo is composed again here over their cells and the coarse
// texels those reach. A ground knob's move hands it new tables (`retune`): the albedo composed again whole.
//
// The GPU port's pass 1, wave 8, cut 2: with `HORIZON_TUNE.early` the bake comes in two words, `begin` as soon as the pack's
// list is in (the sections, heights, normals and pyramid, `beginBake`) and `compose` once the ground's pictures are
// (`finishBake`); with `HORIZON_TUNE.albedoThreads` past one the field makes helper workers of this same module, each handed
// a port (`helper`), and the fine albedo's rows are shared out over them, this worker composing the first slice and
// stitching the rest in (`composeAlbedoRows`, `stitchAlbedo`), every byte the one-thread walk's. With neither, every word
// is answered exactly as before.
import { albedoSlices, beginBake, coarseAlbedoRegion, coarseReach, composeAlbedo, composeAlbedoRegion, composeAlbedoRows, composeBake, composeCoarseAlbedo, decodeBake, finishBake, inflate, shapeBake, stitchAlbedo, TileComposer, tintRect, wholeWindow, windowRect, type AlbedoSlice, type BegunBake, type ColourOverride, type DecodedBake, type IndexRect, type PoleOverride, type TileTables, type WindowPlace } from './horizonDecode.ts';
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

/** Cut 2: the bake begun (`begin`) and not yet composed: its first half, or null where it failed (its own error answered that). */
let begun: Promise<BegunBake | null> | null = null;
/** Cut 2: the helpers' ports handed over with the bake, in slice order from the second; the slices a helper lost are made here. */
let helperPorts: MessagePort[] = [];
const helperLost = new Map<number, () => void>();
/** The slots the field said were lost, kept for the bake under way: a helper can be lost before its slice is asked. */
const lostSlots = new Set<number>();

type Message =
  | { type: 'decode'; id: number; header: HorizonHeader; bin: ArrayBuffer; tables: TileTables; centre: { x: number; z: number }; shift: { x: number; z: number }; eye: { rx: number; rz: number }; S: number; ports?: MessagePort[] }
  | { type: 'make'; id: number; spec: MadeGroundSpec; tables: TileTables | null; centre: { x: number; z: number }; shift: { x: number; z: number }; eye: { rx: number; rz: number }; S: number; ports?: MessagePort[] }
  | { type: 'begin'; id: number; header: HorizonHeader; bin: ArrayBuffer; centre: { x: number; z: number }; shift: { x: number; z: number }; ports?: MessagePort[] }
  | { type: 'compose'; id: number; tables: TileTables; eye: { rx: number; rz: number }; S: number }
  | { type: 'helper'; id: number; port: MessagePort }
  | { type: 'helperLost'; id: number; slot: number }
  | { type: 'poles'; id: number; startX: number; startZ: number; n: number; step: number }
  | { type: 'window'; id: number; place: WindowPlace }
  | { type: 'strip'; id: number; place: WindowPlace; tiles: IndexRect[]; cells: IndexRect[] }
  | { type: 'retune'; id: number; tables: TileTables; place: WindowPlace }
  | { type: 'overlay'; id: number; poles: PoleOverride | null; cells: ColourOverride | null; i0: number; j0: number; i1: number; j1: number };

const post = (m: unknown, buffers: ArrayBuffer[]) => (self as unknown as Worker).postMessage(m, buffers);

/** Every array a decoded bake hands the field, to move rather than copy. */
function bakeBuffers(d: DecodedBake): ArrayBuffer[] {
  const buffers: ArrayBuffer[] = [d.fine.buffer, d.coarse.buffer, d.fineNormal.buffer, d.albedo.buffer, d.coarseAlbedo.buffer, d.window.buffer, d.tint.buffer] as ArrayBuffer[];
  for (const a of [...d.pyramid.lo, ...d.pyramid.hi]) buffers.push(a.buffer as ArrayBuffer);
  return buffers;
}

/** A slice's arrays, to move rather than copy. */
function sliceBuffers(s: AlbedoSlice): ArrayBuffer[] {
  return [s.rgba.buffer, s.sigLo.buffer, s.sigHi.buffer, s.cell.buffer, s.slot.buffer, s.at.buffer, s.vals.buffer] as ArrayBuffer[];
}

/**
 * The fine albedo composed over this worker and its helpers: the rows cut into one slice a thread, the first composed
 * here while the helpers compose theirs (each handed the tables, the families and its own rows of colour over its port),
 * then stitched in row order. A helper that answers an error, or that the field says was lost, has its slice made here.
 */
async function sharedAlbedo(t: TileTables, header: HorizonHeader, fam: Uint8Array, colour: Uint8Array, ports: MessagePort[]): Promise<{ rgba: Uint8Array; memo: number; ms: number }> {
  const t0 = performance.now();
  const nx = header.colour.nx;
  const bounds = albedoSlices(header.colour.nz, ports.length + 1);
  const here = (k: number) => composeAlbedoRows(t, header, fam, colour, bounds[k], bounds[k + 1], 0);
  const asks = ports.map(
    (p, i) =>
      new Promise<AlbedoSlice>((resolve) => {
        const k = i + 1;
        let done = false;
        const own = () => {
          if (done) return;
          done = true;
          helperLost.delete(k);
          p.onmessage = null;
          p.close();
          resolve(here(k));
        };
        if (lostSlots.has(k)) {
          // Lost before its slice was asked: made here, its port let go.
          own();
          return;
        }
        helperLost.set(k, own);
        p.onmessage = (e: MessageEvent) => {
          const r = e.data as AlbedoSlice & { error?: string };
          if (r.error || done) return own();
          done = true;
          helperLost.delete(k);
          p.onmessage = null;
          p.close();
          resolve(r);
        };
        const rows = colour.slice(bounds[k] * nx * 3, bounds[k + 1] * nx * 3);
        p.postMessage({ tables: t, header, fam, colour: rows, j0: bounds[k], j1: bounds[k + 1] }, [rows.buffer]);
      }),
  );
  const first = here(0);
  const rest = await Promise.all(asks);
  const a = stitchAlbedo(header, [first, ...rest]);
  return { rgba: a.rgba, memo: a.memo, ms: performance.now() - t0 };
}

/** A begun bake finished, its albedo shared out where helpers were handed over, and kept for the window's asks as a decode keeps it. */
async function finishShared(b: BegunBake, t: TileTables, eye: { rx: number; rz: number }, S: number, ports: MessagePort[]): Promise<DecodedBake> {
  const fine = ports.length ? await sharedAlbedo(t, b.header, b.s.families, b.s.colour, ports) : null;
  const d = finishBake(b, t, eye, S, fine);
  kept = { header: b.header, families: b.s.families, colour: b.s.colour, coarseFamilies: b.s.coarseFamilies, coarseColour: b.s.coarseColour, tables: t, poles: [], cells: [] };
  return d;
}

self.onmessage = async (e: MessageEvent) => {
  const m = e.data as Message;
  try {
    if (m.type === 'helper') {
      // A helper (cut 2): one slice of the fine albedo's rows composed for the decode worker over the port it was handed.
      const port = m.port;
      port.onmessage = (ev: MessageEvent) => {
        const r = ev.data as { tables: TileTables; header: HorizonHeader; fam: Uint8Array; colour: Uint8Array; j0: number; j1: number };
        try {
          const s = composeAlbedoRows(r.tables, r.header, r.fam, r.colour, r.j0, r.j1, r.j0);
          port.postMessage(s, sliceBuffers(s));
        } catch (err) {
          port.postMessage({ error: String((err as Error)?.message ?? err) });
        }
      };
      return;
    }
    if (m.type === 'helperLost') {
      lostSlots.add(m.slot);
      helperLost.get(m.slot)?.();
      return;
    }
    // A bake's first word: no slot of the last bake's is lost for it.
    if (m.type === 'begin' || m.type === 'decode' || m.type === 'make') lostSlots.clear();
    if (m.type === 'begin') {
      helperPorts = m.ports ?? [];
      const p = beginBake(m.header, new Uint8Array(m.bin), m.centre, m.shift);
      // The compose reads null where the begin failed: its error is answered here, once.
      begun = p.catch(() => null);
      await p;
      return;
    }
    if (m.type === 'compose') {
      if (!begun) throw new Error('nothing begun to compose');
      const b = await begun;
      begun = null;
      if (!b) return;
      const ports = helperPorts;
      helperPorts = [];
      const d = await finishShared(b, m.tables, m.eye, m.S, ports);
      post({ type: 'decoded', id: m.id, d }, bakeBuffers(d));
      return;
    }
    if (m.type === 'decode' && m.ports?.length) {
      // The decode in one word with its albedo shared out (the threads without the early start).
      const b = await beginBake(m.header, new Uint8Array(m.bin), m.centre, m.shift);
      const d = await finishShared(b, m.tables, m.eye, m.S, m.ports);
      post({ type: 'decoded', id: m.id, d }, bakeBuffers(d));
      return;
    }
    if (m.type === 'make' && m.ports?.length && m.tables) {
      // A world with no converted terrain (h6b), its albedo shared out: the make's own heights, then the same steps.
      const t0 = performance.now();
      const g = new MadeGround(m.spec);
      const b = makeBake(g);
      const ms = { inflate: 0, heights: performance.now() - t0, normals: 0, albedo: 0, pyramid: 0, detail: 0, memo: 0 };
      const d = await finishShared(shapeBake(b.header, b.fine, b.coarse, b, m.centre, m.shift, ms), m.tables, m.eye, m.S, m.ports);
      d.header = b.header;
      madeGround = g;
      post({ type: 'decoded', id: m.id, d }, bakeBuffers(d));
      return;
    }
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
