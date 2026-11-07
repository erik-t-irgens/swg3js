// The race drawer's second wave's editor tests' rig (not a test itself): the real Course tool (`EditorCourse`) over the real
// editing (`editsHarness.ts`, the endpoint's own batch on file texts), with a stand-in world that carves: a `CourseCarve`
// store the tool's `carve` lands into (a held drag's preview and a landing alike, recorded), the raw ground a plane, the
// standing rows of ours read off the placements file, the heights file's tiles as a store, deflated as the page deflates.
import { deflateRawSync } from 'node:zlib';
import { makeHarness, inflateTile, type Harness } from './editsHarness.ts';
import { EditorCourse, type CourseCarryRow, type CourseHost } from '../../../src/editor/editorCourse.ts';
import { readTrackFile, type TrackDef } from '../../../src/race/trackFile.ts';
import { CourseCarve } from '../../../src/swg/terrain/courseCarve.ts';
import { HeightEdits } from '../../../src/swg/terrain/heightEdits.ts';
import { deltasOf, readHeightsFile, tileOfId, type HeightTileRow } from '../../../src/world/editFiles/heightsFile.ts';
import { gameToRawX, gameToRawZ, rawToGameX, rawToGameZ } from '../../../src/story/waypoints.ts';
import type { PlacementRow } from '../../../src/story/placements.ts';

export const WORLD = 'dantooine';
export const CENTRE = { x: 1000, z: -500 };
/** The raw ground: a gentle plane in the file's raw frame. */
export const land = (x: number, z: number): number => 5 + 0.02 * x - 0.01 * z;

export interface CourseRig {
  h: Harness;
  c: EditorCourse;
  host: CourseHost;
  /** The stand-in world's store, the very one its carve lands into. */
  store: CourseCarve;
  /** The tracks the stand-in world last landed (a landing's list, never a preview's), as `World.courseTracks` keeps them. */
  landed: { tracks: readonly TrackDef[] };
  /** Each carve asked: whether it was a preview, and the rectangles it queued. */
  carves: { preview: boolean; rects: number }[];
  said: string[];
  bad: string[];
  tracks(): TrackDef[];
  /** The heights file's tiles as a store, as the world holds them after its landing. */
  heights(): HeightEdits;
}

export function courseRig(opts: { tracks?: string | null; rows?: PlacementRow[]; heights?: string | null } = {}): CourseRig {
  const h = makeHarness({ world: WORLD, centre: CENTRE, tracks: opts.tracks ?? null, rows: opts.rows, heights: opts.heights ?? null });
  let lastText: string | null | undefined;
  let lastTracks: TrackDef[] = [];
  const said: string[] = [];
  const bad: string[] = [];
  const store = new CourseCarve();
  const landed: { tracks: readonly TrackDef[] } = { tracks: [] };
  const carves: { preview: boolean; rects: number }[] = [];
  const tracks = (): TrackDef[] => {
    const text = h.files.tracks ?? null;
    if (text !== lastText) {
      lastText = text;
      lastTracks = text ? readTrackFile(text, WORLD, 'ground').tracks : [];
    }
    return lastTracks;
  };
  let heightsText: string | null | undefined;
  let heightsStore = new HeightEdits();
  const heights = (): HeightEdits => {
    const text = h.files.heights ?? null;
    if (text !== heightsText) {
      heightsText = text;
      heightsStore = new HeightEdits();
      if (text) {
        const read = readHeightsFile(text, WORLD, 'ground', inflateTile);
        for (const r of read.rows) {
          const d = deltasOf(inflateTile(r.d));
          if (typeof d === 'string') continue;
          const t = tileOfId(r.id);
          heightsStore.set(t.tx, t.tz, d);
        }
      }
    }
    return heightsStore;
  };
  // The world's own landing of the file's courses after a write (the page's `landTracks`): the store set from the file.
  const host: CourseHost = {
    get edits() {
      return h.e;
    },
    worldKind: () => 'ground',
    raceOn: () => true,
    tracks: () => tracks(),
    toRaw: (x, z, out) => {
      out.x = gameToRawX(CENTRE.x, x);
      out.z = gameToRawZ(CENTRE.z, z);
    },
    toGame: (x, z, out) => {
      out.x = rawToGameX(CENTRE.x, x);
      out.z = rawToGameZ(CENTRE.z, z);
    },
    centre: () => CENTRE,
    land,
    landKnown: land,
    water: () => -Infinity,
    grid: () => 1,
    packId: () => WORLD,
    worldMark: () => (h.host as unknown as { worldMark(): number }).worldMark(),
    say: (w, good) => {
      said.push(w);
      if (!good) bad.push(w);
    },
    refresh: () => {},
    carve: (list, _fx, _fz, preview) => {
      const n = store.set(list, !preview);
      if (!preview) landed.tracks = list;
      carves.push({ preview, rects: n });
    },
    carved: () => landed.tracks,
    rawGround: (x, z) => land(x, z),
    standing: (): CourseCarryRow[] => {
      const out: CourseCarryRow[] = [];
      for (const [id, row] of h.rowsOf('world')) {
        const g = h.gameOf(id);
        if (g) out.push({ id, layer: 'world', row, x: g.x, y: g.y, z: g.z });
      }
      return out;
    },
    lowestOf: () => 0,
    heights: () => heights(),
    heightRow: (id): HeightTileRow | null => {
      const text = h.files.heights ?? null;
      if (!text) return null;
      return readHeightsFile(text, WORLD, 'ground', inflateTile).rows.find((r) => r.id === id) ?? null;
    },
    deflate: async (bytes) => deflateRawSync(Buffer.from(bytes)).toString('base64'),
  };
  const c = new EditorCourse(host);
  return { h, c, host, store, landed, carves, said, bad, tracks, heights };
}

/** Every write and timer settled, and the tool's own write landed. */
export async function idle(r: CourseRig): Promise<void> {
  for (let i = 0; i < 60; i++) {
    await r.h.settle();
    if (!r.c.busy) return;
  }
}

/** The world's landing of the file as the page lands a write's answer (`World.landCourses` with the file's tracks). */
export function landFile(r: CourseRig): number {
  const n = r.store.set(r.tracks(), true);
  r.landed.tracks = r.tracks();
  r.carves.push({ preview: false, rects: n });
  return n;
}
