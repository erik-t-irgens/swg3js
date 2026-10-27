// A stand-in editor round the world editor's real editing class (`EditorEdits`, src/editor/editorEdit.ts): the files are
// texts in memory, every batch goes through the endpoint's own rules (`applyPlacementOp`, as the dev server's glue runs
// them), and what stands is read back out of those texts, so a test drives the very class the game drives -- its writes,
// its history, its hand on the selection, its gizmo -- and reads what it wrote. Nothing here is a copy of the editor's
// own arithmetic: the stand-ins answer only what the game's world would (where a row stands, its box, the ground, a room).
//
// Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no enum, no namespace,
// no constructor parameter properties.
import * as THREE from 'three';
import { EditorEdits, type EditEditor, type EditorBatch } from '../../../src/editor/editorEdit.ts';
import { EDITOR_TUNE } from '../../../src/editor/editorTune.ts';
import { applyPlacementOp, type BatchEdit, type PlacementBatchOk } from '../../../src/world/placementEdits.ts';
import { placementKey, placementsFileText, readPlacementsFile, toGame, type PlacementLayer, type PlacementRow } from '../../../src/story/placements.ts';
import { marksView, type MarksView } from '../../../src/ui/editorMarks.ts';
import { inflateRawSync } from 'node:zlib';
import type { ScreenView } from '../../../src/editor/gizmo.ts';

/** What a harness is made with: the files' rows, the world's frame, and the world's answers a test wants to set. */
export interface HarnessOpts {
  world?: string;
  story?: PlacementRow[];
  rows?: PlacementRow[];
  /** The frame the files are in: a planet's raw frame (mirrored about the centre) or a space zone's own. */
  frame?: 'raw' | 'game';
  centre?: { x: number; z: number };
  /** Whether a point of the game's frame stands in a room (the editor's `roomAt`); none by default. */
  roomAt?: (x: number, y: number, z: number) => boolean;
  /** Which rows are buildings with rooms (`hasRooms`), by id. */
  rooms?: readonly string[];
  /** The ground's height under a point of the game's frame; NaN (none known) by default. */
  terrainAt?: (x: number, z: number) => number;
  /** What stands still under a point (End's cast): the floor's height, or null for nothing. */
  floorAt?: (x: number, z: number) => number | null;
  /** Every row's model box. */
  box?: { min: number[]; max: number[] };
  point?: boolean;
  packId?: string;
  /** Whether a tool is armed (the editor's `toolArmed`, which the brush's own `brushArmed` was): no click picks, boxes or orbits while it is. None by default. */
  toolArmed?: () => boolean;
  /** The same, by the name Map-maker I's brush tests use. */
  brushArmed?: () => boolean;
  /** A heights file's text to start from (Map-maker II). */
  heights?: string | null;
  /**
   * A write's heights answer landed as the game's page lands it (`App.editorBatch` handing it to `World.landHeights`): the
   * tiles put and the ids taken out, the promise what the write built waits on. None by default.
   */
  onHeights?: (put: unknown[], deleted: string[]) => Promise<unknown>;
}

/** The stand-in input: actions held and pressed, raw keys down, the mouse's movement. */
export interface StandInput {
  heldActs: Set<string>;
  pressedActs: Set<string>;
  down: Set<string>;
  justDown: Set<string>;
  mouseDX: number;
  mouseDY: number;
  locked: boolean;
  held(a: string): boolean;
  pressedAction(a: string): boolean;
  isDown(code: string): boolean;
  justPressed(code: string): boolean;
}

export interface Harness {
  e: EditorEdits;
  files: { story: string | null; world: string | null; heights?: string | null };
  rowsOf(l: PlacementLayer): Map<string, PlacementRow>;
  rowOf(id: string): PlacementRow | undefined;
  /** Where a row stands in the game's frame, its turn as three's quaternion and its scale. */
  gameOf(id: string): { x: number; y: number; z: number; q: THREE.Quaternion; s: [number, number, number] } | null;
  input: StandInput;
  pointer: EditEditor['pointer'];
  said: string[];
  marks: MarksView;
  host: EditEditor & { point: boolean; look: { x: number; y: number; z: number } };
  batches: BatchEdit[][];
  /** One frame as the editor runs it: the key block (or, with Ctrl, `idle`), the frame after the camera, the presses spent. */
  step(opts?: { ctrl?: boolean; now?: number }): void;
  /** Every write and timer the editing set going, settled. */
  settle(): Promise<void>;
  /** The camera at `eye` looking at `at`, 1600 by 900 CSS pixels, written into the editing's view. */
  look(eye: THREE.Vector3, at: THREE.Vector3): ScreenView;
  /** A world gone and come back (the history's key moves on). */
  nextWorld(): void;
}

const BOX = { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] };

/** A heights tile's deltas inflated as the dev server's glue inflates them (node's zlib), or null. */
export function inflateTile(b64: string): Uint8Array | null {
  try {
    return new Uint8Array(inflateRawSync(Buffer.from(b64, 'base64')));
  } catch {
    return null;
  }
}

/** A stand-in editor and the real editing round it. */
export function makeHarness(opts: HarnessOpts = {}): Harness {
  const world = opts.world ?? 'tatooine';
  const frame = opts.frame ?? 'raw';
  const centre = opts.centre ?? { x: 0, z: 0 };
  const box = opts.box ?? BOX;
  const kind = frame === 'game' ? 'space' : 'ground';
  let clock = 1_800_000_000_000;
  let mark = 1;
  const files: Harness['files'] = { story: opts.story ? placementsFileText(world, frame, opts.story) : null, world: opts.rows ? placementsFileText(world, frame, opts.rows) : null, heights: opts.heights ?? null };
  const rowsOf = (l: PlacementLayer): Map<string, PlacementRow> => new Map((files[l] ? readPlacementsFile(files[l]!, world, kind).rows : []).map((r) => [r.id, r]));
  const rowOf = (id: string): PlacementRow | undefined => rowsOf('world').get(id) ?? rowsOf('story').get(id);
  const placedCache = new Map<string, { x: number; y: number; z: number; q: THREE.Quaternion; scale: THREE.Vector3 | null; template: string }>();
  const placed = (key: string) => {
    for (const l of ['story', 'world'] as const)
      for (const r of rowsOf(l).values()) {
        if (placementKey(r.id) !== key) continue;
        const g = toGame(r, centre, frame);
        const s = r.scale === undefined ? null : Array.isArray(r.scale) ? new THREE.Vector3(r.scale[0], r.scale[1], r.scale[2]) : new THREE.Vector3(r.scale, r.scale, r.scale);
        // One object a key, written in place, as the streamer keeps one placed object a row.
        let o = placedCache.get(key);
        if (!o) placedCache.set(key, (o = { x: 0, y: 0, z: 0, q: new THREE.Quaternion(), scale: null, template: key }));
        o.x = g.x;
        o.y = g.y;
        o.z = g.z;
        o.q.set(g.q[0], g.q[1], g.q[2], g.q[3]);
        o.scale = s;
        return o;
      }
    return null;
  };
  const input: StandInput = {
    heldActs: new Set(),
    pressedActs: new Set(),
    down: new Set(),
    justDown: new Set(),
    mouseDX: 0,
    mouseDY: 0,
    locked: true,
    held(a) {
      return this.heldActs.has(a);
    },
    pressedAction(a) {
      return this.pressedActs.has(a);
    },
    isDown(code) {
      return this.down.has(code);
    },
    justPressed(code) {
      return this.justDown.has(code);
    },
  };
  const pointer: EditEditor['pointer'] = { x: 800, y: 450, over: true, buttons: 0, pressed: 0, released: 0, dragging: false, clicked: false, downX: 0, downY: 0 };
  const said: string[] = [];
  const batches: BatchEdit[][] = [];
  const look = { x: 0, y: 0, z: -1 };
  const host = {
    input: input as unknown as EditEditor['input'],
    fly: {
      yaw: 0,
      pitch: 0,
      lookDir(o: { x: number; y: number; z: number }) {
        o.x = look.x;
        o.y = look.y;
        o.z = look.z;
      },
      lookAlong() {},
      stop() {},
    },
    pointer,
    point: opts.point ?? false,
    look,
    inHand: () => false,
    hoveredId: () => null,
    placed: (key: string) => placed(key) as unknown as ReturnType<EditEditor['placed']>,
    boxOf: () => box,
    hasRooms: (key: string) => (opts.rooms ?? []).some((id) => placementKey(id) === key),
    copies: () => [],
    dropCopies() {},
    setHidden() {},
    rowFor: (id: string) => {
      for (const l of ['story', 'world'] as const) {
        const r = rowsOf(l).get(id);
        if (r) return { row: r, layer: l, label: id };
      }
      return null;
    },
    standing: () => {
      const out: ReturnType<EditEditor['standing']> = [];
      for (const l of ['story', 'world'] as const)
        for (const r of rowsOf(l).values()) {
          const g = toGame(r, centre, frame);
          out.push({ id: r.id, row: r, layer: l, x: g.x, y: g.y, z: g.z });
        }
      return out;
    },
    idsTaken: () => new Set([...rowsOf('story').keys(), ...rowsOf('world').keys()]),
    frame: () => frame,
    centre: () => centre,
    terrainAt: (x: number, z: number) => (opts.terrainAt ? opts.terrainAt(x, z) : Number.NaN),
    castDown: (x: number, y: number, z: number, _reach: number, _inside: boolean, out: { y: number; nx: number; ny: number; nz: number }) => {
      const f = opts.floorAt ? opts.floorAt(x, z) : null;
      if (f === null || f > y) return false;
      out.y = f;
      out.nx = 0;
      out.ny = 1;
      out.nz = 0;
      return true;
    },
    roomAt: (x: number, y: number, z: number) => (opts.roomAt ? opts.roomAt(x, y, z) : false),
    inSpace: () => frame === 'game',
    packId: () => opts.packId ?? world,
    worldMark: () => mark,
    hit: () => ({ x: 0, y: 0, z: 0 }),
    batch: async (edits: BatchEdit[]): Promise<EditorBatch> => {
      batches.push(edits);
      const a = applyPlacementOp({ op: 'batch', world, edits }, { ...files }, { worlds: new Map([[world, kind]]), now: (clock += 1000), inflate: inflateTile });
      if (a.status !== 200 || !a.body.ok) return { ok: false, why: (a.body as { why: string }).why, files: {}, ms: 0, built: Promise.resolve() };
      for (const w of a.writes) (files as Record<string, string | null>)[w.layer] = w.text;
      const body = a.body as PlacementBatchOk;
      // The heights landed as the page lands them: begun at once, not waited for here, part of what the write built.
      const hf = (body.files as Record<string, { put: unknown[]; deleted: string[] } | undefined>).heights;
      const built = hf && opts.onHeights ? opts.onHeights(hf.put, hf.deleted).then(() => undefined) : Promise.resolve();
      return { ok: true, why: '', files: body.files as EditorBatch['files'], ms: 0, built };
    },
    status: async () => 'no git here',
    say: (w: string) => said.push(w),
    take: async () => null,
    entryOfRow: () => null,
    entryByKey: () => null,
    handKey: () => null,
    hotbar: () => [],
    setHotbar() {},
    refreshWindow() {},
    ...(opts.toolArmed || opts.brushArmed ? { toolArmed: opts.toolArmed ?? opts.brushArmed } : {}),
  };
  EDITOR_TUNE.statusDebounceMs = 0;
  const e = new EditorEdits(host as unknown as EditEditor);
  const marks = marksView();
  let now = 0;
  const h: Harness = {
    e,
    files,
    rowsOf,
    rowOf,
    gameOf(id) {
      const r = rowOf(id);
      if (!r) return null;
      const g = toGame(r, centre, frame);
      const s: [number, number, number] = r.scale === undefined ? [1, 1, 1] : Array.isArray(r.scale) ? [r.scale[0], r.scale[1], r.scale[2]] : [r.scale, r.scale, r.scale];
      return { x: g.x, y: g.y, z: g.z, q: new THREE.Quaternion(g.q[0], g.q[1], g.q[2], g.q[3]), s };
    },
    input,
    pointer,
    said,
    marks,
    host: host as unknown as Harness['host'],
    batches,
    step(o = {}) {
      now = o.now ?? now + 1 / 60;
      e.clock.dt = 1 / 60;
      e.clock.now = now;
      if (o.ctrl) e.idle();
      else e.keys(false);
      e.frame(marks);
      input.pressedActs.clear();
      input.justDown.clear();
      pointer.pressed = 0;
      pointer.released = 0;
      pointer.clicked = false;
    },
    async settle() {
      for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
    },
    look(eye, at) {
      const cam = new THREE.PerspectiveCamera(60, 1600 / 900, 0.1, 5000);
      cam.position.copy(eye);
      cam.lookAt(at);
      cam.updateMatrixWorld();
      const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      const v = e.view;
      v.vp.set(vp.elements);
      v.inv.set(vp.clone().invert().elements);
      v.w = 1600;
      v.h = 900;
      v.ex = eye.x;
      v.ey = eye.y;
      v.ez = eye.z;
      const f = new THREE.Vector3();
      cam.getWorldDirection(f);
      v.fx = f.x;
      v.fy = f.y;
      v.fz = f.z;
      look.x = f.x;
      look.y = f.y;
      look.z = f.z;
      v.focal = 900 / (2 * Math.tan((60 * Math.PI) / 360));
      return v;
    },
    nextWorld() {
      mark++;
    },
  };
  // The world the history is of, taken as this one, as the game's first frame takes it.
  e.chords();
  return h;
}

/** A prop of the props pack at a place of the file's frame, its turn `q` as a file writes it (`[w, x, y, z]`). */
export function propRow(id: string, x: number, z: number, extra: Partial<PlacementRow> = {}): PlacementRow {
  return { id, kind: 'prop', pack: 'props', thing: 'chair', x, y: 0, z, q: [1, 0, 0, 0], at: 1_700_000_000_000, ...extra };
}
