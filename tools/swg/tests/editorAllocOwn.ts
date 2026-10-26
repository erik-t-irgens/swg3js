// The world editor's own frame, measured for what it makes (DESIGN.md §2.0 rule 7): the pointer's events, the aim's step
// (the engine's cast, the ground's march, the water, the turned-box walk over the streamer's regions) and the hover, in
// a node process of its own with the engine's cast and the terrain stood in, as `raceAllocOwn.ts` measures the drive.
// The young generation is read with no collection in the window, the cleanest of three windows kept.
//
// Run: node --expose-gc --allow-natives-syntax tools/swg/tests/editorAllocOwn.ts
// Prints one JSON line: { frames, made, scavenges, tested, hovered, gizmo, grabBytes } (the last two with `gizmo`: the
// frames the gizmo was shown on, and what a grab, a press, makes, measured apart from the frames).
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import { EditorAim, type AimRay, type AimRect, type AimSample, type StillHit } from '../../../src/editor/aim.ts';
import { endPointerFrame, notePointerDown, notePointerMove, notePointerUp, notePointerWheel, pointerRecord } from '../../../src/editor/pointer.ts';
import { EDITOR_TUNE } from '../../../src/editor/editorTune.ts';
import { H, cursor, dragAt, gizmoDrag, gizmoLayout, grabAt, handlesFor, layoutGizmo, pickAt, ray3, rayAt, screenView, worldAxes, type HeldKey } from '../../../src/editor/gizmo.ts';
import { drawEditorMarks, marksView, projectBox, selSlot } from '../../../src/ui/editorMarks.ts';

// With `gizmo` (the gizmo's own test, `gizmo.test.ts`): a frame also lays the gizmo out, picks a handle, drags it now and
// then, projects a selection's boxes and draws every mark onto an overlay that does nothing.
const GIZMO = process.argv.includes('gizmo');
const view = screenView();
{
  // A camera at (0, 8, 0) looking down -Z and a little down: its projection and its inverse, written once (the editor writes
  // them a frame from the camera; the measure is of what the gizmo does with them).
  const f = 1 / Math.tan(Math.PI / 6);
  const aspect = 16 / 9;
  const near = 0.1;
  const far = 5000;
  const proj = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  // The view: the eye at (0, 8, 0), no turn; vp = proj × view.
  const viewM = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -8, 0, 1];
  const mul = (a: number[], b: number[]) => {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
    return o;
  };
  const vp = mul(proj, viewM);
  view.vp.set(vp);
  // Its inverse, by Gauss-Jordan on a copy (once, not a frame).
  const m = vp.slice();
  const inv = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const at = (a: number[], r: number, c: number) => a[c * 4 + r];
  const put = (a: number[], r: number, c: number, v: number) => (a[c * 4 + r] = v);
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(at(m, r, c)) > Math.abs(at(m, p, c))) p = r;
    for (let k = 0; k < 4; k++) {
      const t1 = at(m, c, k);
      put(m, c, k, at(m, p, k));
      put(m, p, k, t1);
      const t2 = at(inv, c, k);
      put(inv, c, k, at(inv, p, k));
      put(inv, p, k, t2);
    }
    const d = at(m, c, c);
    for (let k = 0; k < 4; k++) {
      put(m, c, k, at(m, c, k) / d);
      put(inv, c, k, at(inv, c, k) / d);
    }
    for (let r = 0; r < 4; r++) {
      if (r === c) continue;
      const g = at(m, r, c);
      for (let k = 0; k < 4; k++) {
        put(m, r, k, at(m, r, k) - g * at(m, c, k));
        put(inv, r, k, at(inv, r, k) - g * at(inv, c, k));
      }
    }
  }
  view.inv.set(inv);
  view.w = 1600;
  view.h = 900;
  view.ex = 0;
  view.ey = 8;
  view.ez = 0;
  view.fx = 0;
  view.fy = 0;
  view.fz = -1;
  view.focal = 450 * f;
}
const layout = gizmoLayout();
const axes = worldAxes();
const drag = gizmoDrag();
const gray = ray3();
const marks = marksView();
const pivot = { x: 0.5, y: 0.5, z: -20.5 };
const boxEls = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.5, 0.5, -20.5, 1]);
const KEYS: HeldKey[] = ['none', 'turn', 'tumble', 'lift', 'scale'];
const overlay = {
  line(_a: number, _b: number, _c: number, _d: number, _w: number, _col: number, _al: number): void {},
  ring(_a: number, _b: number, _r: number, _w: number, _col: number, _al: number): void {},
  poly(_p: ArrayLike<number>, _n: number, _w: number, _c: number, _a: number, _close?: boolean, _fill?: boolean): void {},
};
for (let i = 0; i < 8; i++) selSlot(marks, i);
let gizmoFrames = 0;

const gc = (globalThis as { gc?: (o?: { type: 'minor' }) => void }).gc;
if (!gc) {
  console.log(JSON.stringify({ skipped: 'run with node --expose-gc' }));
  process.exit(0);
}

interface Thing {
  x: number;
  y: number;
  z: number;
  q: { x: number; y: number; z: number; w: number };
  template: string;
}

// Four hundred things in the regions the ray crosses, one in four a permanent row the hover may rest on.
const things: Thing[] = [];
for (let i = 0; i < 400; i++) {
  const a = i * 0.7;
  const h = Math.sin(a / 2);
  things.push({ x: Math.cos(a) * (5 + i * 0.2), y: 0, z: Math.sin(a) * (5 + i * 0.2), q: { x: 0, y: h, z: 0, w: Math.cos(a / 2) }, template: i % 4 === 0 ? `place/test-${i}` : `object/tangible/test/shared_thing_${i}.iff` });
}
const BOX = { min: [-1, 0, -1], max: [1, 2, 1] };
let castDist = 30;
const aim = new EditorAim<Thing>(
  {
    // The engine's cast stood in: it writes its answer into the kept record, as `Physics.aimHit` does.
    cast(r: AimRay, _inside: boolean, out: StillHit): boolean {
      if (castDist > r.len) return false;
      out.toi = castDist;
      out.nx = 0;
      out.ny = 1;
      out.nz = 0;
      out.handle = 7;
      return true;
    },
    // The terrain stood in: a rolling ground and no water.
    sample(p: AimSample): void {
      p.ground = Math.sin(p.x * 0.05) * 2 + Math.cos(p.z * 0.07) * 2;
      p.water = -Infinity;
    },
    walk(_rect: AimRect, visit: (o: Thing) => boolean): void {
      for (let i = 0; i < things.length; i++) if (!visit(things[i])) return;
    },
  },
  () => BOX,
  (o) => o.template.startsWith('place/'),
);
const pointer = pointerRecord();
const ask = { inside: false, space: process.argv.includes('nomarch'), skyReach: 40, now: 0.5 };
let k = 0;
let hovered = 0;
let tested = 0;

/** One frame of the editor's own: the pointer's events, the aim and the hover, the frame's presses spent. */
function frame(): void {
  k++;
  const t = k * 0.0001;
  // The pointer's every event every frame (a move, then a press or a release, a notch of the wheel either way), as a
  // driven Point mode makes them: the rules are what is measured, not how seldom they run.
  notePointerMove(pointer, 400 + Math.sin(t) * 100, 300 + Math.cos(t) * 80, EDITOR_TUNE.pick.dragPx);
  if ((k & 1) === 0) notePointerDown(pointer, 0, pointer.x, pointer.y);
  else notePointerUp(pointer, 0, pointer.x, pointer.y, EDITOR_TUNE.pick.dragPx);
  notePointerWheel(pointer, (k & 2) === 0 ? 1 : -1);
  ask.now = k / 60;
  castDist = k % 3 === 0 ? 1e9 : 20 + (k % 17);
  const dx = Math.cos(t);
  const dz = Math.sin(t);
  const dy = -0.3;
  const n = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const r = aim.ray;
  r.ox = 0;
  r.oy = 8;
  r.oz = 0;
  r.dx = dx / n;
  r.dy = dy / n;
  r.dz = dz / n;
  aim.step(ask, EDITOR_TUNE.aim, EDITOR_TUNE.hover);
  if (aim.hover) hovered++;
  tested += aim.boxes.tested;
  if (GIZMO) {
    // The frame's time handed over in a kept record: a number handed across a call is the harness's own allocation.
    gizmoT[0] = t;
    gizmoFrame();
  }
  endPointerFrame(pointer);
}

const gizmoT = new Float64Array(1);
const gcur = cursor();
let grabbing = true;
/** Frames each handle was dragged on in the measured windows (kept; a count is not an allocation), and whether to count. */
const dragged = new Float64Array(12);
let counting = false;

/** The gizmo's frame: laid out for a key, picked at the cursor, a drag begun now and then and carried, the boxes and the marks drawn. */
function gizmoFrame(): void {
  const t = gizmoT[0];
  pivot.x = Math.sin(t) * 3;
  handlesFor(KEYS[k % KEYS.length], (k & 8) === 0, layout.shown);
  layoutGizmo(view, pivot, axes, EDITOR_TUNE.gizmo.px, layout);
  if (!layout.on) return;
  gizmoFrames++;
  // A spiral round the pivot, in and out over 97 frames and round in 53, so the cursor crosses every handle's place in turn
  // (the ground square near the middle, the rings at their reach, the arrows' and boxes' ends) and each is grabbed.
  const rad = 4 + ((k % 97) / 97) * 100;
  const ang = ((k % 53) / 53) * Math.PI * 2;
  gcur.x = layout.px + Math.cos(ang) * rad;
  gcur.y = layout.py + Math.sin(ang) * rad;
  pickAt(layout, gcur, EDITOR_TUNE.pick.hitPx);
  rayAt(view, gcur, gray);
  // A grab is a press, once a click, and code run that seldom stays unoptimised and makes its numbers (about forty bytes
  // a grab, measured apart as `grabBytes`): the window measures the frames, which take the handle under the cursor as the
  // drag's own now and then so every branch of the drag is run, and the warm-up grabs for real.
  if ((k & 7) === 0 && layout.hot >= 0) {
    if (grabbing) grabAt(drag, layout, layout.hot, view, pivot, gcur, gray);
    else drag.handle = layout.hot;
  }
  if (drag.handle >= 0) {
    dragAt(drag, layout, gcur, gray);
    if (counting) dragged[drag.handle]++;
  }
  marks.selCount = 0;
  for (let i = 0; i < 8; i++) {
    boxEls[12] = pivot.x + i;
    if (projectBox(BOX.min, BOX.max, boxEls, view.vp, view.w, view.h, marks.sel[i])) marks.selCount++;
  }
  marks.gizmo = layout;
  drawEditorMarks(overlay, marks);
}

let scavenges = 0;
const watch = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
});
watch.observe({ entryTypes: ['gc'] });
const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => {
  await tick();
  await tick();
};
function frames(n: number): void {
  for (let i = 0; i < n; i++) frame();
}
try {
  new Function('f', '%NeverOptimizeFunction(f)')(frames);
} catch {
  // Without the flag the loop is left to the compiler.
}

const FRAMES = 50_000;

// With `edits` (`editorEdits.test.ts`): the editing class's own frame (`EditorEdits.keys` then `frame`), with three rows
// picked and the cursor moving over the gizmo in Point mode -- the selection's pivot, the gizmo laid out and picked, the
// selection's boxes and the marks -- and then with R held and a hold under way (the hold's turn applied to the probe and
// every row placed from it, `placeLive`), each measured in a window of its own. The stand-in host answers from kept
// objects, as the streamer's placed objects are kept, so what is measured is the class's.
if (process.argv.includes('edits')) {
  const THREE = await import('three');
  const { EditorEdits } = await import('../../../src/editor/editorEdit.ts');
  const ids = ['a', 'b', 'c'];
  const keyOf = (id: string) => `place/${id}`;
  const placedObjs = new Map<string, { x: number; y: number; z: number; q: InstanceType<typeof THREE.Quaternion>; scale: null; template: string }>();
  ids.forEach((id, i) => placedObjs.set(keyOf(id), { x: -i * 3, y: 0, z: -20, q: new THREE.Quaternion(), scale: null, template: keyOf(id) }));
  const rowsById = new Map(ids.map((id, i) => [id, { row: { id, kind: 'prop' as const, pack: 'props' as const, thing: 'chair', x: i * 3, y: 0, z: -20, q: [1, 0, 0, 0] as [number, number, number, number], at: 1 }, layer: 'world' as const, label: id }]));
  const held = new Set<string>();
  // Its places start as fractions, as the pointer layer's own record does (a field that starts whole boxes every fraction after).
  const ptr = { x: 800.5, y: 450.5, over: true, buttons: 0, pressed: 0, released: 0, dragging: false, clicked: false, downX: 0.5, downY: 0.5 };
  const lookV = { x: 0, y: 0, z: -1 };
  const host = {
    input: { held: (a: string) => held.has(a), pressedAction: () => false, isDown: () => false, justPressed: () => false, mouseDX: 0, mouseDY: 0 },
    fly: {
      yaw: 0,
      pitch: 0,
      lookDir(o: { x: number; y: number; z: number }) {
        o.x = lookV.x;
        o.y = lookV.y;
        o.z = lookV.z;
      },
      lookAlong() {},
      stop() {},
    },
    pointer: ptr,
    point: true,
    inHand: () => false,
    hoveredId: () => null,
    placed: (key: string) => placedObjs.get(key) ?? null,
    boxOf: () => BOX,
    hasRooms: () => false,
    copies: () => [],
    dropCopies() {},
    setHidden() {},
    rowFor: (id: string) => rowsById.get(id) ?? null,
    standing: () => [],
    idsTaken: () => new Set(ids),
    frame: () => 'raw' as const,
    centre: () => ({ x: 0, z: 0 }),
    terrainAt: () => Number.NaN,
    castDown: () => false,
    roomAt: () => false,
    inSpace: () => false,
    packId: () => 'tatooine',
    worldMark: () => 1,
    hit: () => ({ x: 0, y: 0, z: 0 }),
    batch: async () => ({ ok: false, why: 'the measure writes nothing', files: {}, ms: 0, built: Promise.resolve() }),
    status: async () => 'none',
    say() {},
    take: async () => null,
    entryOfRow: () => null,
    entryByKey: () => null,
    handKey: () => null,
    hotbar: () => [],
    setHotbar() {},
    refreshWindow() {},
  };
  const ed = new EditorEdits(host as unknown as ConstructorParameters<typeof EditorEdits>[0]);
  ed.snapOn = false;
  // The camera's view, the aim's own: the eye at (0, 8, 0) looking down -Z.
  const v = ed.view;
  v.vp.set(view.vp);
  v.inv.set(view.inv);
  v.w = view.w;
  v.h = view.h;
  v.ex = view.ex;
  v.ey = view.ey;
  v.ez = view.ez;
  v.fx = view.fx;
  v.fy = view.fy;
  v.fz = view.fz;
  v.focal = view.focal;
  ed.chords();
  ed.sel.pick(ids, 'set');
  const em = marksView();
  for (let i = 0; i < 8; i++) selSlot(em, i);
  // The frame's count in a typed array: a module's `let` written with a number allocates on every write.
  const et = new Float64Array(3);
  /** One frame of the editing's own: the key block's read, then the step after the camera, the cursor moving round. */
  const editsFrame = (): void => {
    et[2]++;
    et[0] = et[2] * 0.02;
    ptr.x = 800 + Math.sin(et[0]) * 70;
    ptr.y = 450 + Math.cos(et[0]) * 50;
    // The clock written as the editor writes it, into the class's kept record.
    ed.clock.dt = 1 / 60;
    ed.clock.now = et[2] / 60;
    ed.keys(false);
    ed.frame(em);
  };
  const editsFrames = (n: number): void => {
    for (let i = 0; i < n; i++) editsFrame();
  };
  try {
    new Function('f', '%NeverOptimizeFunction(f)')(editsFrames);
  } catch {
    // Without the flag the loop is left to the compiler.
  }
  const measure = async (): Promise<{ made: number; scavenges: number }> => {
    let bestE = { made: Infinity, scavenges: Infinity };
    for (let attempt = 0; attempt < 3; attempt++) {
      editsFrames(10_000);
      gc({ type: 'minor' });
      await settle();
      scavenges = 0;
      const before = young();
      editsFrames(FRAMES);
      const made = young() - before;
      await settle();
      if (scavenges < bestE.scavenges || (scavenges === bestE.scavenges && made < bestE.made)) bestE = { made, scavenges };
      if (bestE.scavenges === 0 && bestE.made <= 0) break;
    }
    return bestE;
  };
  editsFrames(20_000);
  if (process.argv.includes('profile')) {
    // Where it is made, by the sampling heap profiler: `node --expose-gc tools/swg/tests/editorAllocOwn.ts edits profile [hold]`.
    if (process.argv.includes('hold')) {
      held.add('placeTurn');
      editsFrames(20_000);
    }
    const { Session } = await import('node:inspector/promises');
    const session = new Session();
    session.connect();
    await session.post('HeapProfiler.startSampling', { samplingInterval: 32, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    editsFrames(50_000);
    interface SampleNode {
      callFrame: { functionName: string; url: string; lineNumber: number };
      selfSize: number;
      children: SampleNode[];
    }
    const { profile } = (await session.post('HeapProfiler.stopSampling')) as unknown as { profile: { head: SampleNode } };
    const sites = new Map<string, number>();
    const walk = (n: SampleNode, path: string) => {
      const here = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
      if (n.selfSize > 0) sites.set(`${here}  <-  ${path}`, (sites.get(`${here}  <-  ${path}`) ?? 0) + n.selfSize);
      for (const c of n.children) walk(c, here);
    };
    walk(profile.head, '');
    for (const [key, n] of [...sites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`${(n / 50_000).toFixed(2)} B/frame  ${key}`);
    process.exit(0);
  }
  const steady = await measure();
  // R held: the hold begins on the next frame (a press, outside the window) and is under way through every frame after.
  held.add('placeTurn');
  editsFrames(20_000);
  const live = (ed.report().under as { via?: string } | null)?.via === 'hold';
  const hold = await measure();
  watch.disconnect();
  console.log(JSON.stringify({ frames: FRAMES, made: steady.made, scavenges: steady.scavenges, holdMade: hold.made, holdScavenges: hold.scavenges, hold: live, picked: ed.sel.size }));
  process.exit(0);
}
if (process.argv.includes('profile')) {
  // Where it is made, by the sampling heap profiler: `node --expose-gc tools/swg/tests/editorAllocOwn.ts profile`.
  const { Session } = await import('node:inspector/promises');
  const session = new Session();
  session.connect();
  frames(50_000);
  await session.post('HeapProfiler.startSampling', { samplingInterval: 32, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  frames(50_000);
  interface SampleNode {
    callFrame: { functionName: string; url: string; lineNumber: number };
    selfSize: number;
    children: SampleNode[];
  }
  const { profile } = (await session.post('HeapProfiler.stopSampling')) as unknown as { profile: { head: SampleNode } };
  const sites = new Map<string, number>();
  const walk = (n: SampleNode, path: string) => {
    const here = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
    if (n.selfSize > 0) sites.set(`${here}  <-  ${path}`, (sites.get(`${here}  <-  ${path}`) ?? 0) + n.selfSize);
    for (const c of n.children) walk(c, here);
  };
  walk(profile.head, '');
  for (const [key, n] of [...sites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`${(n / 50_000).toFixed(2)} B/frame  ${key}`);
  process.exit(0);
}
frames(20_000);
let best = { made: Infinity, scavenges: Infinity };
for (let attempt = 0; attempt < 3; attempt++) {
  gc();
  await settle();
  grabbing = true;
  frames(10_000);
  grabbing = false;
  frames(1_000);
  gc({ type: 'minor' });
  await settle();
  scavenges = 0;
  counting = true;
  const before = young();
  frames(FRAMES);
  const made = young() - before;
  counting = false;
  await settle();
  if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges };
  if (best.scavenges === 0 && best.made <= 0) break;
}
// A grab's own bytes, apart: a few hundred grabs in a window of their own (a press, never a frame's work).
let grabBytes = 0;
if (GIZMO) {
  gc({ type: 'minor' });
  await settle();
  scavenges = 0;
  const before = young();
  let n = 0;
  for (let i = 0; i < 400; i++) {
    gcur.x = layout.px + 40;
    gcur.y = layout.py;
    handlesFor('none', false, layout.shown);
    layoutGizmo(view, pivot, axes, EDITOR_TUNE.gizmo.px, layout);
    if (grabAt(drag, layout, H.x, view, pivot, gcur, gray)) n++;
  }
  const made = young() - before;
  await settle();
  grabBytes = scavenges === 0 && n ? made / n : -1;
}
watch.disconnect();
// The frames each handle was dragged on in the measured windows, by name: every branch of the drag the window says it runs.
const branches: Record<string, number> = {};
for (const [name, i] of Object.entries(H)) branches[name] = dragged[i];
console.log(JSON.stringify({ frames: FRAMES, made: best.made, scavenges: best.scavenges, tested: Math.round(tested / k), hovered, gizmo: gizmoFrames, grabBytes: Math.round(grabBytes), ...(GIZMO ? { branches } : {}) }));
