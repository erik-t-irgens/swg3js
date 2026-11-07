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
/** Every collection of any kind (a major one empties the young generation too): what a measure across one must know. */
let collections = 0;
const watch = new PerformanceObserver((list) => {
  for (const e of list.getEntries()) {
    collections++;
    if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
  }
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
// With `brush` (`brush.test.ts`, map-maker wave 3): the brush's frame while it is armed and no stroke is under way (its
// buttons read, its kept ask written, `EditorBrush.frame`), and its ring: forty-eight ground points round the aim projected
// (`brushRing`, the ground stood in as the aim's own rolling ground) and drawn as the marks draw them, the aim wandering.
if (process.argv.includes('brush')) {
  const { brushRing, ringAsk } = await import('../../../src/editor/brush.ts');
  const { EditorBrush } = await import('../../../src/editor/editorBrush.ts');
  const ra = ringAsk();
  const rgAt = { x: 0.5, z: 0.5, y: 0.5 };
  const rg = {
    at: rgAt,
    sample(): void {
      rgAt.y = Math.sin(rgAt.x * 0.05) * 2 + Math.cos(rgAt.z * 0.07) * 2;
    },
  };
  const bm = marksView();
  const brush = new EditorBrush({
    edits: { writing: false } as never,
    source: async () => 'the measure paints nothing',
    near: () => [],
    ground: () => 0,
    water: () => Number.NaN,
    centre: () => null,
    frame: () => 'raw',
    packId: () => 'test',
    inSpace: () => false,
    dest: () => 'world',
    cameraYaw: () => 0,
    say() {},
  });
  brush.armed = true;
  const bt = new Float64Array(2);
  const brushFrame = (): void => {
    bt[1]++;
    bt[0] = bt[1] * 0.01;
    const ba = brush.ask;
    ba.paint = false;
    ba.erase = false;
    ba.cx = Math.sin(bt[0]) * 30;
    ba.cz = -20 + Math.cos(bt[0]) * 10;
    ba.valid = true;
    ba.dt = 1 / 60;
    brush.frame();
    ra.cx = ba.cx;
    ra.cy = 0.5;
    ra.cz = ba.cz;
    ra.radius = EDITOR_TUNE.brush.radius;
    ra.w = 1600;
    ra.h = 900;
    brushRing(ra, rg, view.vp, bm.ring, bm.ringVis);
    bm.ringOn = true;
    bm.ringErase = bt[1] % 2 === 0;
    drawEditorMarks(overlay, bm);
  };
  const brushFrames = (n: number): void => {
    for (let i = 0; i < n; i++) brushFrame();
  };
  try {
    new Function('f', '%NeverOptimizeFunction(f)')(brushFrames);
  } catch {
    // Without the flag the loop is left to the compiler.
  }
  brushFrames(20_000);
  let bestB = { made: Infinity, scavenges: Infinity };
  for (let attempt = 0; attempt < 3; attempt++) {
    brushFrames(10_000);
    gc({ type: 'minor' });
    await settle();
    scavenges = 0;
    const before = young();
    brushFrames(FRAMES);
    const made = young() - before;
    await settle();
    if (scavenges < bestB.scavenges || (scavenges === bestB.scavenges && made < bestB.made)) bestB = { made, scavenges };
    if (bestB.scavenges === 0 && bestB.made <= 0) break;
  }
  let shown = 0;
  for (let i = 0; i < bm.ringVis.length; i++) shown += bm.ringVis[i];
  watch.disconnect();
  console.log(JSON.stringify({ frames: FRAMES, made: bestB.made, scavenges: bestB.scavenges, ringShown: shown, armed: brush.armed, stroke: brush.mode }));
  process.exit(0);
}
// With `sculpt` (`sculpt.test.ts`, Map-maker II's first wave): the sculpt brush armed and hovering, no stroke under way -- the
// Tools list's frame written into its kept record and handed to the tool (`sculptTool`'s step), and its two rings (at its
// radius and at its hardness) projected through the editor's own `ToolDraw` shape and drawn, the aim wandering.
if (process.argv.includes('sculpt')) {
  const { brushRing, ringAsk } = await import('../../../src/editor/brush.ts');
  const { EditorSculpt, sculptTool } = await import('../../../src/editor/editorSculpt.ts');
  const { toolFrame } = await import('../../../src/editor/tools.ts');
  const { HeightEdits } = await import('../../../src/swg/terrain/heightEdits.ts');
  const ra = ringAsk();
  const rgAt = { x: 0.5, z: 0.5, y: 0.5 };
  const rg = {
    at: rgAt,
    sample(): void {
      rgAt.y = Math.sin(rgAt.x * 0.05) * 2 + Math.cos(rgAt.z * 0.07) * 2;
    },
  };
  const sm = marksView();
  const store = new HeightEdits();
  const sculpt = new EditorSculpt({
    edits: { writing: false } as never,
    worldKind: () => 'ground',
    store: () => store,
    rawAt: () => 0,
    toRaw: () => {},
    toGame: () => {},
    changed: () => {},
    feet: () => {},
    standing: () => [],
    lowestOf: () => null,
    fileRow: () => null,
    fileSize: () => ({ tiles: 0, bytes: 0 }),
    deflate: async () => '',
    beginWork: () => {},
    noteStamp: () => {},
    say() {},
  });
  sculpt.armed = true;
  const tool = sculptTool(sculpt);
  const f = toolFrame();
  // The editor's own ToolDraw: a radius written into the record, then the slot's ring projected into the marks' kept arrays.
  const draw = {
    marks: sm,
    radius: 0.5,
    ring(slot: 0 | 1): void {
      ra.radius = this.radius;
      if (slot === 0) {
        brushRing(ra, rg, view.vp, sm.ring, sm.ringVis);
        sm.ringOn = true;
      } else {
        brushRing(ra, rg, view.vp, sm.ring2, sm.ring2Vis);
        sm.ring2On = true;
      }
    },
  };
  const st = new Float64Array(2);
  const sculptFrame = (): void => {
    st[1]++;
    st[0] = st[1] * 0.01;
    f.apply = false;
    f.inverse = false;
    f.shift = false;
    f.sampled = false;
    f.x = Math.sin(st[0]) * 30;
    f.y = 0.5;
    f.z = -20 + Math.cos(st[0]) * 10;
    f.valid = true;
    f.dt = 1 / 60;
    f.now = st[0];
    tool.step(f);
    ra.cx = f.x;
    ra.cy = 0.5;
    ra.cz = f.z;
    ra.w = 1600;
    ra.h = 900;
    sm.ringOn = false;
    sm.ring2On = false;
    tool.draw(draw);
    drawEditorMarks(overlay, sm);
  };
  const sculptFrames = (n: number): void => {
    for (let i = 0; i < n; i++) sculptFrame();
  };
  try {
    new Function('f', '%NeverOptimizeFunction(f)')(sculptFrames);
  } catch {
    // Without the flag the loop is left to the compiler.
  }
  sculptFrames(20_000);
  let bestS = { made: Infinity, scavenges: Infinity };
  for (let attempt = 0; attempt < 3; attempt++) {
    sculptFrames(10_000);
    gc({ type: 'minor' });
    await settle();
    scavenges = 0;
    const before = young();
    sculptFrames(FRAMES);
    const made = young() - before;
    await settle();
    if (scavenges < bestS.scavenges || (scavenges === bestS.scavenges && made < bestS.made)) bestS = { made, scavenges };
    if (bestS.scavenges === 0 && bestS.made <= 0) break;
  }
  let shown = 0;
  let shown2 = 0;
  for (let i = 0; i < sm.ringVis.length; i++) shown += sm.ringVis[i];
  for (let i = 0; i < sm.ring2Vis.length; i++) shown2 += sm.ring2Vis[i];
  watch.disconnect();
  console.log(JSON.stringify({ frames: FRAMES, made: bestS.made, scavenges: bestS.scavenges, ringShown: shown, ring2Shown: shown2, armed: sculpt.armed, stroke: sculpt.mode, tiles: store.size }));
  process.exit(0);
}
// With `water` (`waterLive.test.ts`, Map-maker II's fifth wave): the water tool armed over three lakes of forty points, one
// picked -- the Tools list's frame handed to the tool (`waterTool`'s step), its overlay from the view (the picked lake's
// gizmo laid out and picked, every outline and ring projected into the marks' kept arrays) and every mark drawn -- measured
// three ways: the aim wandering with nothing held; F held with the mouse moving (the raise carried on, `liftDelta`'s rate);
// and the picked lake's square grabbed and dragged. Nothing is let go inside a window (a let-go writes).
// With `looks` (`looksAlloc.test.ts`, Map-maker II's seventh wave): the attachments' holder looking at its rows between
// looks, the handles laid out and the one under the cursor found (`EditorLooks.frame`), the marks drawn; then an attachment
// picked and R held with the mouse moving, its turn carried live by the holder (`attachMovedFrame`, `followItem`).
if (process.argv.includes('looks')) {
  const { RowAttachments } = await import('../../../src/world/rowAttach.ts');
  const { EditorLooks } = await import('../../../src/editor/editorLooks.ts');
  type Row = import('../../../src/story/placements.ts').PlacementRow;
  // A holder whose effects are kept handles of nothing: the measure is of what the holder and the looks do.
  const holder = new RowAttachments<{ n: number }>({
    fileOf: (ref) => ref,
    prepare: async () => true,
    place: () => ({ n: 1 }),
    move: () => {},
    resize: () => {},
    remove: () => {},
    sound: () => {},
    soundMove: () => {},
    soundOff: () => {},
    fullOf: () => 4,
  });
  const rows: Row[] = [];
  for (let i = 0; i < 6; i++) {
    const row: Row = { id: `r${i}`, kind: i % 3 === 0 ? 'mark' : 'prop', ...(i % 3 === 0 ? {} : { pack: 'props', thing: 'crate' }), x: i * 4 - 10, y: 1, z: -20, q: [1, 0, 0, 0], attach: [{ fx: 'props:particles/fire.json', at: [0, 1, 0] }, { snd: 'sound/test.snd' }] } as Row;
    rows.push(row);
    holder.stand(`place/${row.id}`, row, { x: row.x, y: row.y, z: row.z, q: [0, 0, 0, 1] });
  }
  const eye = { x: 0.5, y: 8.5, z: 0.5 };
  holder.update(eye, 1);
  await settle();
  holder.update(eye, 1);
  const lm = marksView();
  // The keys stood in: R held while `turning`, the mouse's movement written each frame.
  const st = new Float64Array(4);
  const input = {
    mouseDX: 0.5,
    mouseDY: 0.5,
    // R held while `st[2]` is 1, C held while it is 2 (the size carried in place, `resize`).
    held: (a: string) => (a === 'placeTurn' && st[2] === 1) || (a === 'editorScale' && st[2] === 2),
    pressedAction: () => false,
  };
  const ptr = { x: 800.5, y: 450.5, over: true };
  const none: string[] = [];
  const looks = new EditorLooks({
    input: input as never,
    point: () => false,
    pointer: () => ptr,
    rowFor: (id) => {
      const row = rows.find((r) => r.id === id);
      return row ? { row, layer: 'world', label: id } : null;
    },
    picked: () => none,
    pickOnly: () => {},
    putRows: async () => 'written',
    say: () => {},
    stream: () => null,
    attachments: () => holder as never,
    frame: () => 'game',
    centre: () => null,
    curtain: async (_d, w) => w(),
    grid: () => 0.25,
    refresh: () => {},
  });
  const lcur = { x: 0.5, y: 0.5 };
  // Four times the other modes' window, as the water's: the reading's own few kilobytes a smaller share of the line.
  const LOOKS_FRAMES = 4 * FRAMES;
  const looksFrame = (): void => {
    st[1]++;
    st[0] = st[1] * 0.01;
    input.mouseDX = Math.sin(st[0] * 3) * 4;
    input.mouseDY = Math.cos(st[0] * 2) * 3;
    holder.update(eye, 1 / 60);
    looks.keys();
    lcur.x = 800 + Math.sin(st[0]) * 200;
    lcur.y = 450 + Math.cos(st[0]) * 120;
    looks.frame(view, lcur, lm);
    drawEditorMarks(overlay, lm);
  };
  const looksFrames = (n: number): void => {
    for (let i = 0; i < n; i++) looksFrame();
  };
  try {
    new Function('f', '%NeverOptimizeFunction(f)')(looksFrames);
  } catch {
    // Without the flag the loop is left to the compiler.
  }
  const measure = async (): Promise<{ made: number; scavenges: number }> => {
    looksFrames(20_000);
    let best = { made: Infinity, scavenges: Infinity };
    for (let attempt = 0; attempt < 3; attempt++) {
      looksFrames(10_000);
      gc({ type: 'minor' });
      await settle();
      scavenges = 0;
      const before = young();
      looksFrames(LOOKS_FRAMES);
      const made = young() - before;
      await settle();
      if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges };
      if (best.scavenges === 0 && best.made <= 0) break;
    }
    return best;
  };
  const steady = await measure();
  const shown = lm.handleCount;
  // An attachment picked by its handle and R held: the turn carried live, nothing written until it is let go.
  looks.pickAttachment('r1', 0);
  st[2] = 1;
  looksFrame();
  const holding = looks.takesMouse;
  const hold = await measure();
  // R let go (its one write is the stand-in's), then C held: the size moved nearly every frame, the standing effect sized
  // where it plays (`resize`), never placed again.
  st[2] = 0;
  looksFrame();
  await settle();
  looks.pickAttachment('r1', 0);
  st[2] = 2;
  looksFrame();
  const sizing = looks.takesMouse;
  const size = await measure();
  watch.disconnect();
  console.log(JSON.stringify({ frames: LOOKS_FRAMES, made: steady.made, scavenges: steady.scavenges, holdMade: hold.made, holdScavenges: hold.scavenges, sizeMade: size.made, sizeScavenges: size.scavenges, sizing, handles: shown, placed: holder.placed, holding }));
  process.exit(0);
}
if (process.argv.includes('water')) {
  const { EditorWater, waterTool } = await import('../../../src/editor/editorWater.ts');
  const { tuneWater, WATER_TUNE_DEFAULTS } = await import('../../../src/editor/editorTune.ts');
  const { toolFrame } = await import('../../../src/editor/tools.ts');
  type Row = import('../../../src/world/editFiles/waterFile.ts').WaterLakeRow;
  const lakes: Row[] = [];
  for (let l = 0; l < 3; l++) {
    const pts: [number, number][] = [];
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      pts.push([-(Math.cos(a) * 20 + l * 50 - 50), Math.sin(a) * 20 - 40]);
    }
    lakes.push({ id: `l${l}`, kind: 'lake', h: 1, points: pts, shader: null });
  }
  // And two rivers (the sixth wave), whose banks are drawn with a height a point (`ys`): the frame's other path.
  const rivers: import('../../../src/world/editFiles/waterFile.ts').WaterRiverRow[] = [];
  for (let r = 0; r < 2; r++) {
    const pts: [number, number, number][] = [];
    for (let i = 0; i < 12; i++) pts.push([-(i * 6 - 30), 10 + r * 30 + Math.sin(i) * 3, 2 - i * 0.3]);
    rivers.push({ id: `r${r}`, kind: 'river', points: pts, width: 8, velocity: 1, shader: null });
  }
  const wm = marksView();
  tuneWater({ ...WATER_TUNE_DEFAULTS, mode: 'clicks' });
  const water = new EditorWater({
    // A write's stand-in: a let-go between windows writes, and nothing it writes moves the lakes.
    edits: { beginStroke: (label: string) => ({ label }), strokeWrite: async () => null, endStroke: () => '' } as never,
    worldKind: () => 'ground',
    rows: () => lakes,
    rivers: () => rivers,
    toRaw: (x, z, out) => {
      out.x = -x;
      out.z = z;
    },
    toGame: (x, z, out) => {
      out.x = -x;
      out.z = z;
    },
    groundAt: () => 0.5,
    heightAt: () => 0.5,
    seaLevel: () => -Infinity,
    isLava: () => false,
    wantsCurtain: () => false,
    curtain: async (_d, w) => w(),
    fallSource: async () => 'none',
    dest: () => 'world',
    centre: () => ({ x: 0, z: 0 }),
    frame: () => 'raw',
    packId: () => 'test',
    cameraYaw: () => 0,
    underNotes: () => [],
    say() {},
  });
  await water.arm();
  water.picked = 'l1';
  const tool = waterTool(water);
  const f = toolFrame();
  const draw = { marks: wm, radius: 0.5, ring(): void {} };
  // What each window holds (0 nothing, 1 F with the mouse moving, 2 the square dragged), its cursor's middle and the step.
  const st = new Float64Array(5);
  const waterFrame = (): void => {
    st[1]++;
    st[0] = st[1] * 0.01;
    const held = st[2];
    f.apply = held === 2 || held === 3;
    f.inverse = false;
    f.shift = false;
    f.sampled = false;
    f.x = Math.sin(st[0]) * 30;
    f.y = 0.5;
    f.z = -40 + Math.cos(st[0]) * 10;
    f.valid = true;
    f.dt = 1 / 60;
    f.now = st[0];
    f.sx = st[3] + Math.sin(st[0] * 3) * 6;
    f.sy = st[4] + Math.sin(st[0] * 2) * 4;
    f.dy = held === 1 ? Math.sin(st[0] * 5) * 3 : 0;
    f.lift = held === 1;
    tool.step(f);
    tool.overlay!(draw as never, view);
    drawEditorMarks(overlay, wm);
  };
  const waterFrames = (n: number): void => {
    for (let i = 0; i < n; i++) waterFrame();
  };
  // Four times the other modes' window: a frame here is cheap, and the reading's own few kilobytes (the heap's statistics,
  // read at each end) are then a smaller share of the line every mode is held to (a twentieth of a byte a frame).
  const WATER_FRAMES = 4 * FRAMES;
  try {
    new Function('f', '%NeverOptimizeFunction(f)')(waterFrames);
  } catch {
    // Without the flag the loop is left to the compiler.
  }
  const measure = async (): Promise<{ made: number; scavenges: number }> => {
    waterFrames(20_000);
    let best = { made: Infinity, scavenges: Infinity };
    for (let attempt = 0; attempt < 3; attempt++) {
      waterFrames(10_000);
      gc({ type: 'minor' });
      await settle();
      scavenges = 0;
      const before = young();
      waterFrames(WATER_FRAMES);
      const made = young() - before;
      await settle();
      if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges };
      if (best.scavenges === 0 && best.made <= 0) break;
    }
    return best;
  };
  // The aim over the picked lake's middle on the screen, nothing held.
  st[2] = 0;
  st[3] = 800;
  st[4] = 450;
  waterFrame();
  const L = (water as unknown as { layout: { on: boolean; square: Float64Array } }).layout;
  const steady = await measure();
  const shownLakes = wm.lakeCount;
  // F held, the mouse moving: the raise carried on.
  st[2] = 1;
  const raise = await measure();
  const raising = (water.report() as { raising: number }).raising !== 0;
  // F let go (a write, outside every window), then the square grabbed at its middle and dragged.
  st[2] = 0;
  waterFrame();
  await settle();
  // A frame laid out after the let-go (the let-go's own frame laid the square out still raised).
  waterFrame();
  st[3] = (L.square[0] + L.square[2] + L.square[4] + L.square[6]) / 4;
  st[4] = (L.square[1] + L.square[3] + L.square[5] + L.square[7]) / 4;
  st[2] = 2;
  // The press frame's cursor on the square's middle itself (its step at nought, so its wander is nought).
  const saveStep = st[1];
  st[1] = -1;
  waterFrame();
  st[1] = saveStep;
  const dragging = (water.report() as { dragging: boolean }).dragging;
  const hot = (L as unknown as { hot: number }).hot;
  const drag = await measure();
  // The drag let go (a write, outside every window), the lake let go, and three clicks of an outline (each a press and a
  // let-go, away from every lake's ring): a draft under way, drawn with the aim, nothing held.
  st[2] = 0;
  waterFrame();
  await settle();
  water.picked = null;
  st[3] = 800;
  st[4] = 450;
  for (let k = 0; k < 3; k++) {
    st[2] = 3;
    waterFrame();
    st[2] = 0;
    waterFrame();
  }
  const draftPoints = (water.report() as { draft: number }).draft;
  if (process.argv.includes('profile')) {
    // Where the draft's frame makes anything, by the sampling heap profiler: `node --expose-gc --allow-natives-syntax
    // tools/swg/tests/editorAllocOwn.ts water profile`.
    waterFrames(20_000);
    const { Session } = await import('node:inspector/promises');
    const session = new Session();
    session.connect();
    await session.post('HeapProfiler.startSampling', { samplingInterval: 32, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    waterFrames(50_000);
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
  const draft = await measure();
  watch.disconnect();
  console.log(JSON.stringify({ frames: WATER_FRAMES, made: steady.made, scavenges: steady.scavenges, raiseMade: raise.made, raiseScavenges: raise.scavenges, dragMade: drag.made, dragScavenges: drag.scavenges, draftMade: draft.made, draftScavenges: draft.scavenges, lakes: shownLakes, raising, dragging, hot, draftPoints, draftDrawn: wm.draftCount, gizmo: L.on }));
  process.exit(0);
}
// With `course` (`courseAlloc.test.ts`, the race drawer's first wave): the Course tool armed over a 400-node circuit, its
// frame (the Tools list's record handed to it, its overlay: the courses projected, the picked one's diamonds, width lines,
// grabbers and gates laid out and hovered) and the marks drawn, in five windows: editing with the cursor on a node, a
// node's diamond dragged (with `live` 'release', and again with the default 'drag': the held course shown between the
// preview's ticks, its clock held so no tick falls inside), the gates mode hovering a gate, and a draft of three clicks drawn
// with the aim. A held edit's course is made again at `previewHz` (a stamp's work, never a frame's), measured apart
// (`previewBytes`, what one made).
if (process.argv.includes('course')) {
  const { EditorCourse, courseTool } = await import('../../../src/editor/editorCourse.ts');
  const { courseCtx, drawTrack } = await import('../../../src/editor/courseEdit.ts');
  const { COURSE_TUNE } = await import('../../../src/race/courseTune.ts');
  const { toolFrame } = await import('../../../src/editor/tools.ts');
  // The camera at (0, 8, 0) looks down -Z: a circuit of 400 nodes about (0, -260) of the game's frame, 200 m round, on flat
  // ground at nought (the file's raw frame is the game's mirrored in x about a centre at nought).
  const pts: { x: number; z: number; y: number }[] = [];
  for (let i = 0; i < 400; i++) {
    const a = (i / 400) * Math.PI * 2;
    pts.push({ x: -Math.sin(a) * 200, z: -260 + Math.cos(a) * 200, y: 0 });
  }
  const made = drawTrack('course_1', 'Course 1', pts, true, courseCtx(() => 0));
  if (typeof made === 'string') throw new Error(made);
  const tracks = [made];
  const cm = marksView();
  // The race drawer's second wave: the world carves a held edit's course at each preview tick (a store kept, as the world's).
  const { CourseCarve } = await import('../../../src/swg/terrain/courseCarve.ts');
  const carveStore = new CourseCarve();
  carveStore.set(tracks);
  const course = new EditorCourse({
    // A write's stand-in: a let-go between windows writes, and nothing it writes moves the course.
    edits: { beginStroke: (label: string) => ({ label }), strokeWrite: async () => '', endStroke: () => '' } as never,
    worldKind: () => 'ground',
    raceOn: () => true,
    tracks: () => tracks,
    toRaw: (x, z, out) => {
      out.x = -x;
      out.z = z;
    },
    toGame: (x, z, out) => {
      out.x = -x;
      out.z = z;
    },
    centre: () => null,
    land: () => 0,
    landKnown: () => 0,
    water: () => -Infinity,
    grid: () => 1,
    packId: () => 'test',
    worldMark: () => 1,
    say() {},
    refresh() {},
    carve: (list, _fx, _fz, preview) => {
      carveStore.set(list, !preview);
    },
  });
  await course.arm();
  course.pick('course_1');
  course.setMode('edit');
  COURSE_TUNE.live = 'release';
  const tool = courseTool(course);
  const f = toolFrame();
  const draw = { marks: cm, radius: 0.5, ring(): void {} };
  // What each window holds (0 nothing, 1 the left button: a drag, or a click of the draft), its cursor's middle and the step.
  const st = new Float64Array(6);
  // The preview's clock held still (a moment of its own, else -1): the default `live` 'drag' window runs with no tick inside it.
  const frozen = new Float64Array(1);
  frozen[0] = -1;
  const courseFrame = (): void => {
    st[1]++;
    st[0] = st[1] * 0.01;
    f.apply = st[2] === 1;
    f.inverse = false;
    f.shift = false;
    f.sampled = false;
    f.x = Math.sin(st[0]) * 30 + st[5];
    f.y = 0.5;
    f.z = -40 + Math.cos(st[0]) * 10;
    f.valid = true;
    f.dt = 1 / 60;
    f.now = frozen[0] >= 0 ? frozen[0] : st[0];
    f.sx = st[3] + Math.sin(st[0] * 3) * 3;
    f.sy = st[4] + Math.sin(st[0] * 2) * 2;
    f.dy = 0;
    f.lift = false;
    f.turn = false;
    f.dx = 0;
    tool.step(f);
    tool.overlay!(draw as never, view);
    drawEditorMarks(overlay, cm);
  };
  const courseFrames = (n: number): void => {
    for (let i = 0; i < n; i++) courseFrame();
  };
  const COURSE_FRAMES = 2 * FRAMES;
  try {
    new Function('f', '%NeverOptimizeFunction(f)')(courseFrames);
  } catch {
    // Without the flag the loop is left to the compiler.
  }
  const measure = async (): Promise<{ made: number; scavenges: number }> => {
    courseFrames(20_000);
    let best = { made: Infinity, scavenges: Infinity };
    for (let attempt = 0; attempt < 3; attempt++) {
      courseFrames(10_000);
      gc({ type: 'minor' });
      await settle();
      scavenges = 0;
      const before = young();
      courseFrames(COURSE_FRAMES);
      const made = young() - before;
      await settle();
      if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges };
      if (best.scavenges === 0 && best.made <= 0) break;
    }
    return best;
  };
  // The cursor on node 0's diamond (its place on the screen read off the marks a frame drew), nothing held.
  st[3] = 800;
  st[4] = 450;
  courseFrame();
  // The diamond of the node nearest the screen's middle (every node's diamond is the first of its three handles).
  let pick = 0;
  let bestD = Infinity;
  for (let i = 0; i < cm.courseMarkN; i += 3) {
    if (!cm.courseMarkVis[i]) continue;
    const d = Math.hypot(cm.courseMarkPts[i * 2] - 800, cm.courseMarkPts[i * 2 + 1] - 600);
    if (d < bestD) {
      bestD = d;
      pick = i;
    }
  }
  st[3] = cm.courseMarkPts[pick * 2];
  st[4] = cm.courseMarkPts[pick * 2 + 1];
  const steady = await measure();
  const report = () => course.report() as { node: number; held: string; gate: number; draft: number; views: number };
  const shown = { lines: cm.courseLineN, marks: cm.courseMarkN };
  // The diamond grabbed (its press frame's cursor exactly on it) and dragged.
  const saveStep = st[1];
  st[1] = -1;
  courseFrame();
  st[2] = 1;
  st[1] = -1;
  courseFrame();
  st[1] = saveStep;
  const grabbed = report().held;
  const drag = await measure();
  // The preview's tick, measured apart: one course made for the drag as `previewHz` asks, in bytes. A tick measured across a
  // collection reads short (the young generation's size falls at one), so a tick a collection fell inside is tried again, a
  // tenth of a second of frames later so the preview's clock is due again, and -1 is said where every try had one.
  let previewBytes = -1;
  for (let attempt = 0; attempt < 6 && previewBytes < 0; attempt++) {
    COURSE_TUNE.live = 'drag';
    gc({ type: 'minor' });
    await settle();
    collections = 0;
    const pb = young();
    // The first frame after the switch makes one (the preview's clock was never wound while it was off).
    courseFrame();
    const made = young() - pb;
    await settle();
    if (collections === 0) previewBytes = made;
    COURSE_TUNE.live = 'release';
    courseFrames(15);
  }
  // The default, `live` 'drag': the frames a player really drags through between the preview's ticks (the held course shown,
  // the views made from it, the preview's clock asked every frame). One tick taken, then the clock held at its moment so no
  // tick falls inside the window: the tick is the stamp's work measured above, never the frame's.
  COURSE_TUNE.live = 'drag';
  courseFrame();
  frozen[0] = f.now;
  const liveHeld = course.live;
  const dragLive = await measure();
  const liveKept = liveHeld !== null && course.live === liveHeld;
  frozen[0] = -1;
  COURSE_TUNE.live = 'release';
  // Let go (a write, outside every window), then the gates mode, the cursor near gate 1's window.
  st[2] = 0;
  courseFrame();
  await settle();
  course.setMode('gates');
  courseFrame();
  let at = 0;
  let found = -1;
  for (let l = 0; l < cm.courseLineN; l++) {
    if (cm.courseStyle[l] & 0x80) {
      found++;
      if (found === 1) break;
    }
    at += cm.courseSpans[l];
  }
  st[3] = (cm.coursePts[at * 2] + cm.coursePts[(at + 1) * 2]) / 2;
  st[4] = (cm.coursePts[at * 2 + 1] + cm.coursePts[(at + 1) * 2 + 1]) / 2;
  courseFrame();
  const gatesHot = (course as unknown as { hotGate: number }).hotGate;
  const gates = await measure();
  // A draft of three clicks (each a press and a let-go), drawn with the aim, nothing held.
  course.setMode('draw');
  course.pick(null);
  for (let kk = 0; kk < 3; kk++) {
    // Off the road and 30 m apart (past the close and the finish's reach), then the aim back where it wanders.
    st[5] = 100 + kk * 30;
    st[2] = 1;
    courseFrame();
    st[2] = 0;
    courseFrame();
  }
  st[5] = 0;
  const draftPoints = report().draft;
  const draft = await measure();
  watch.disconnect();
  console.log(JSON.stringify({ frames: COURSE_FRAMES, made: steady.made, scavenges: steady.scavenges, dragMade: drag.made, dragScavenges: drag.scavenges, dragLiveMade: dragLive.made, dragLiveScavenges: dragLive.scavenges, liveKept, gatesMade: gates.made, gatesScavenges: gates.scavenges, draftMade: draft.made, draftScavenges: draft.scavenges, nodes: made.course!.paths[0].nodes.length, gateCount: made.gates.length, lines: shown.lines, marks: shown.marks, grabbed, gatesHot, draftPoints, previewBytes }));
  process.exit(0);
}
// With `places` (`placesAlloc.test.ts`, Map-maker II's eighth wave): the places tool armed with three places drawn (a circle,
// a rectangle and an outline, one of them no-build) and one picked, the aim wandering -- the Tools list's frame handed to the
// tool and its overlay (the outlines projected at their ground, the picked one's square laid out and picked, the rings) and
// the marks drawn; then the picked place's square dragged; then an outline of three clicks under way, drawn with the aim; and
// the places' index asked as a ghost asks every frame (`noBuildAt` and `placeAt` over a hundred zones).
if (process.argv.includes('places')) {
  const { EditorPlaces, placesTool } = await import('../../../src/editor/editorPlaces.ts');
  const { tunePlacesTool, PLACES_TOOL_TUNE_DEFAULTS } = await import('../../../src/editor/editorTune.ts');
  const { toolFrame } = await import('../../../src/editor/tools.ts');
  const { PlaceIndex } = await import('../../../src/world/places.ts');
  type Row = import('../../../src/world/editFiles/locationsFile.ts').LocationRow;
  const rows: Row[] = [
    { id: 'ring', kind: 'city', name: 'Ring', shape: { kind: 'circle', c: [-10, -40], r: 25 }, build: false },
    { id: 'box', kind: 'area', shape: { kind: 'rect', min: [20, -60], max: [60, -20] } },
    { id: 'ell', kind: 'zone', shape: { kind: 'poly', pts: [[-60, 0], [-20, 0], [-20, 10], [-50, 10], [-50, 40], [-60, 40]] } },
  ];
  const pm = marksView();
  tunePlacesTool({ ...PLACES_TOOL_TUNE_DEFAULTS, mode: 'outline' });
  const places = new EditorPlaces({
    // A write's stand-in: a let-go between windows writes, and nothing it writes moves the places.
    edits: { beginStroke: (label: string) => ({ label }), strokeWrite: async () => null, endStroke: () => '' } as never,
    worldKind: () => 'ground',
    rows: () => rows,
    toRaw: (x, z, out) => {
      out.x = -x;
      out.z = z;
    },
    toGame: (x, z, out) => {
      out.x = -x;
      out.z = z;
    },
    groundAt: () => 0.5,
    groundCached: (_x, _z, out) => {
      out.y = 0.5;
      return true;
    },
    say() {},
  });
  await places.arm();
  places.picked = 'box';
  const tool = placesTool(places);
  const f = toolFrame();
  const draw = { marks: pm, radius: 0.5, ring(): void {} };
  const index = new PlaceIndex().build({ rows: [...rows, ...Array.from({ length: 100 }, (_, i) => ({ id: `z${i}`, kind: 'zone' as const, build: false, shape: { kind: 'circle' as const, c: [i * 30 - 1500, (i % 7) * 40] as [number, number], r: 12 } }))], centre: { x: 0, z: 0 } });
  const NOINDEX = process.argv.includes('noindex');
  const st = new Float64Array(6);
  const placesFrame = (): void => {
    st[1]++;
    st[0] = st[1] * 0.01;
    const held = st[2];
    f.apply = held === 2 || held === 3;
    f.inverse = false;
    f.shift = false;
    f.sampled = false;
    f.x = Math.sin(st[0]) * 30;
    f.y = 0.5;
    f.z = -40 + Math.cos(st[0]) * 10;
    f.valid = true;
    f.dt = 1 / 60;
    f.now = st[0];
    f.sx = st[3] + Math.sin(st[0] * 3) * 6;
    f.sy = st[4] + Math.sin(st[0] * 2) * 4;
    f.dy = 0;
    f.lift = false;
    tool.step(f);
    tool.overlay!(draw as never, view);
    drawEditorMarks(overlay, pm);
    // What a ghost asks every frame, through the index's own kept ask (a number handed across a call is boxed).
    if (!NOINDEX) {
      const q = index.ask;
      q.x = f.x;
      q.z = f.z;
      q.r = 6;
      if (index.noBuildAsked()) st[5]++;
      q.r = 0;
      if (index.placeAsked()) st[5]++;
    }
  };
  const placesFrames = (n: number): void => {
    for (let i = 0; i < n; i++) placesFrame();
  };
  const PLACES_FRAMES = 4 * FRAMES;
  try {
    new Function('f', '%NeverOptimizeFunction(f)')(placesFrames);
  } catch {
    // Without the flag the loop is left to the compiler.
  }
  const measure = async (): Promise<{ made: number; scavenges: number }> => {
    placesFrames(20_000);
    let best = { made: Infinity, scavenges: Infinity };
    for (let attempt = 0; attempt < 3; attempt++) {
      placesFrames(10_000);
      gc({ type: 'minor' });
      await settle();
      scavenges = 0;
      const before = young();
      placesFrames(PLACES_FRAMES);
      const made = young() - before;
      await settle();
      if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges };
      if (best.scavenges === 0 && best.made <= 0) break;
    }
    return best;
  };
  st[2] = 0;
  st[3] = 800;
  st[4] = 450;
  placesFrame();
  const L = (places as unknown as { layout: { on: boolean; square: Float64Array; hot: number } }).layout;
  if (process.argv.includes('profile')) {
    // Where the frame makes anything, by the sampling heap profiler: `node --expose-gc --allow-natives-syntax
    // tools/swg/tests/editorAllocOwn.ts places profile`.
    placesFrames(20_000);
    const { Session } = await import('node:inspector/promises');
    const session = new Session();
    session.connect();
    await session.post('HeapProfiler.startSampling', { samplingInterval: 32, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    placesFrames(50_000);
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
  const shown = pm.lakeCount;
  const bad = pm.lakeBad[0];
  // The square grabbed at its middle and dragged.
  placesFrame();
  st[3] = (L.square[0] + L.square[2] + L.square[4] + L.square[6]) / 4;
  st[4] = (L.square[1] + L.square[3] + L.square[5] + L.square[7]) / 4;
  st[2] = 2;
  const saveStep = st[1];
  st[1] = -1;
  placesFrame();
  st[1] = saveStep;
  const dragging = (places.report() as { dragging: boolean }).dragging;
  const drag = await measure();
  // The drag let go (a write, outside every window), the place let go, and three clicks of an outline away from every ring.
  st[2] = 0;
  placesFrame();
  await settle();
  places.picked = null;
  st[3] = 300;
  st[4] = 200;
  for (let k = 0; k < 3; k++) {
    st[2] = 3;
    placesFrame();
    st[2] = 0;
    placesFrame();
  }
  const draftPoints = places.draftN;
  const draft = await measure();
  watch.disconnect();
  console.log(JSON.stringify({ frames: PLACES_FRAMES, made: steady.made, scavenges: steady.scavenges, dragMade: drag.made, dragScavenges: drag.scavenges, draftMade: draft.made, draftScavenges: draft.scavenges, places: shown, bad, dragging, draftPoints, draftDrawn: pm.draftCount, asked: st[5] > 0 }));
  process.exit(0);
}
// With `paint` (`paintAlloc.test.ts`, Map-maker II's second wave): the paint brush armed and hovering, no stroke under way -- the Tools list's frame handed to the tool
// (`paintTool`'s step) and its two rings projected and drawn, the aim wandering, exactly as the sculpt brush's. With `plants`
// as well (the fourth wave), on the plants layer: its own radius and tune, the recipe chosen.
if (process.argv.includes('paint')) {
  const { brushRing, ringAsk } = await import('../../../src/editor/brush.ts');
  const { EditorPaint, paintTool } = await import('../../../src/editor/editorPaint.ts');
  const { toolFrame } = await import('../../../src/editor/tools.ts');
  const { GroundPaint } = await import('../../../src/swg/terrain/groundPaint.ts');
  const { PAINT_TUNE, FLORA_PAINT_TUNE } = await import('../../../src/editor/editorTune.ts');
  if (process.argv.includes('plants')) {
    PAINT_TUNE.layer = 'plants';
    FLORA_PAINT_TUNE.recipe = 1;
  }
  const ra = ringAsk();
  const rgAt = { x: 0.5, z: 0.5, y: 0.5 };
  const rg = {
    at: rgAt,
    sample(): void {
      rgAt.y = Math.sin(rgAt.x * 0.05) * 2 + Math.cos(rgAt.z * 0.07) * 2;
    },
  };
  const sm = marksView();
  const ground = new GroundPaint();
  const paint = new EditorPaint({
    edits: { writing: false } as never,
    worldKind: () => 'ground',
    notPaintable: () => null,
    paint: () => ground,
    entries: () => [],
    addEntry: () => 1,
    keepEntries: () => {},
    pack: () => 'test',
    families: () => [],
    familyAt: () => null,
    colourAt: () => null,
    toRaw: () => {},
    preview: () => {},
    release: () => {},
    recipes: () => [{ trees: 'clear' }],
    addRecipe: () => 1,
    keepRecipes: () => {},
    recipeMissing: () => null,
    floraReady: async () => null,
    floraIsReady: () => true,
    fileRow: () => null,
    fileSize: () => ({ rows: 0, bytes: 0 }),
    worldRow: () => ({ id: 'world' }),
    beginWork: () => {},
    noteStamp: () => {},
    say() {},
  });
  paint.armed = true;
  const middle = { valid: false, x: 0.5, z: 0.5 };
  const tool = paintTool(paint, () => middle);
  const f = toolFrame();
  const draw = {
    marks: sm,
    radius: 0.5,
    ring(slot: 0 | 1): void {
      ra.radius = this.radius;
      if (slot === 0) {
        brushRing(ra, rg, view.vp, sm.ring, sm.ringVis);
        sm.ringOn = true;
      } else {
        brushRing(ra, rg, view.vp, sm.ring2, sm.ring2Vis);
        sm.ring2On = true;
      }
    },
  };
  const st = new Float64Array(2);
  const paintFrame = (): void => {
    st[1]++;
    st[0] = st[1] * 0.01;
    f.apply = false;
    f.inverse = false;
    f.shift = false;
    f.sampled = false;
    f.x = Math.sin(st[0]) * 30;
    f.y = 0.5;
    f.z = -20 + Math.cos(st[0]) * 10;
    f.valid = true;
    f.dt = 1 / 60;
    f.now = st[0];
    tool.step(f);
    ra.cx = f.x;
    ra.cy = 0.5;
    ra.cz = f.z;
    ra.w = 1600;
    ra.h = 900;
    sm.ringOn = false;
    sm.ring2On = false;
    tool.draw(draw);
    drawEditorMarks(overlay, sm);
  };
  const paintFrames = (n: number): void => {
    for (let i = 0; i < n; i++) paintFrame();
  };
  try {
    new Function('f', '%NeverOptimizeFunction(f)')(paintFrames);
  } catch {
    // Without the flag the loop is left to the compiler.
  }
  paintFrames(20_000);
  let bestP = { made: Infinity, scavenges: Infinity };
  for (let attempt = 0; attempt < 3; attempt++) {
    paintFrames(10_000);
    gc({ type: 'minor' });
    await settle();
    scavenges = 0;
    const before = young();
    paintFrames(FRAMES);
    const made = young() - before;
    await settle();
    if (scavenges < bestP.scavenges || (scavenges === bestP.scavenges && made < bestP.made)) bestP = { made, scavenges };
    if (bestP.scavenges === 0 && bestP.made <= 0) break;
  }
  let shown = 0;
  let shown2 = 0;
  for (let i = 0; i < sm.ringVis.length; i++) shown += sm.ringVis[i];
  for (let i = 0; i < sm.ring2Vis.length; i++) shown2 += sm.ring2Vis[i];
  watch.disconnect();
  console.log(JSON.stringify({ frames: FRAMES, made: bestP.made, scavenges: bestP.scavenges, ringShown: shown, ring2Shown: shown2, armed: paint.armed, stroke: paint.mode, tiles: ground.fam.size + ground.col.size + ground.flo.size, layer: PAINT_TUNE.layer }));
  process.exit(0);
}
// With `zones` (`zonesAlloc.test.ts`, Map-maker II's twelfth wave): the no-spawn zone tool armed with three zones drawn (a
// circle, a rectangle and an outline) and one picked, the aim wandering -- the Tools list's frame handed to the tool and its
// overlay, the marks drawn; then a rectangle dragged out; then an outline of three clicks under way, drawn with the aim; and,
// beside each frame, the seat snap a chair in hand asks every frame over forty sitters (`seatSnapIn` and its kept ask).
if (process.argv.includes('zones')) {
  const { EditorZones, ZONE_TOOL_TUNE, zonesTool } = await import('../../../src/editor/editorZones.ts');
  const { toolFrame } = await import('../../../src/editor/tools.ts');
  const { SeatSnapAsk, seatSnapIn } = await import('../../../src/world/seatProps.ts');
  type Row = import('../../../src/story/removals.ts').RemovalRow;
  const rows: Row[] = [
    { id: 'z:ring', shape: { kind: 'circle', c: [-10, -40], r: 25 } } as Row,
    { id: 'z:box', shape: { kind: 'rect', min: [20, -60], max: [60, -20] } } as Row,
    { id: 'z:ell', shape: { kind: 'poly', pts: [[-60, 0], [-20, 0], [-20, 10], [-50, 10], [-50, 40], [-60, 40]] } } as Row,
  ];
  const zm = marksView();
  ZONE_TOOL_TUNE.mode = 'circle';
  const zones = new EditorZones({
    // A write's stand-in: a let-go between windows writes, and nothing it writes moves the zones.
    edits: { putRows: async (label: string) => label } as never,
    worldKind: () => 'ground',
    rows: () => rows,
    locations: () => [],
    toRaw: (x, z, out) => {
      out.x = -x;
      out.z = z;
    },
    toGame: (x, z, out) => {
      out.x = -x;
      out.z = z;
    },
    groundAt: () => 0.5,
    groundCached: (_x, _z, out) => {
      out.y = 0.5;
      return true;
    },
    keptOff: () => null,
    goTo() {},
    say() {},
  });
  await zones.arm();
  zones.picked = 'z:box';
  const tool = zonesTool(zones);
  const f = toolFrame();
  const draw = { marks: zm, radius: 0.5, ring(): void {} };
  // Forty sitters, half in chairs and half at tables, about the aim's wander.
  const sitters = Array.from({ length: 40 }, (_, i) => ({ key: `s${i}`, x: Math.cos(i) * 30, y: 0.5, z: -40 + Math.sin(i) * 12, heading: i * 0.3, inside: true, sits: (i % 2 ? 'chair' : 'table') as 'chair' | 'table' }));
  const snap = new SeatSnapAsk();
  const st = new Float64Array(6);
  const zonesFrame = (): void => {
    st[1]++;
    st[0] = st[1] * 0.01;
    const held = st[2];
    f.apply = held === 2 || held === 3;
    f.inverse = false;
    f.shift = false;
    f.sampled = false;
    f.x = Math.sin(st[0]) * 30;
    f.y = 0.5;
    f.z = -40 + Math.cos(st[0]) * 10;
    f.valid = true;
    f.dt = 1 / 60;
    f.now = st[0];
    f.sx = st[3] + Math.sin(st[0] * 3) * 6;
    f.sy = st[4] + Math.sin(st[0] * 2) * 4;
    f.dy = 0;
    f.lift = false;
    tool.step(f);
    tool.overlay!(draw as never, view);
    drawEditorMarks(overlay, zm);
    // A chair in hand over the same aim, as the editor's frame asks it (`EditorEntry`'s ghost).
    snap.kind = st[1] % 2 ? 'seat' : 'table';
    snap.x = f.x;
    snap.z = f.z;
    if (seatSnapIn(snap, sitters)) st[5]++;
  };
  const zonesFrames = (n: number): void => {
    for (let i = 0; i < n; i++) zonesFrame();
  };
  const ZONES_FRAMES = 4 * FRAMES;
  try {
    new Function('f', '%NeverOptimizeFunction(f)')(zonesFrames);
  } catch {
    // Without the flag the loop is left to the compiler.
  }
  const measure = async (): Promise<{ made: number; scavenges: number }> => {
    zonesFrames(20_000);
    let best = { made: Infinity, scavenges: Infinity };
    for (let attempt = 0; attempt < 3; attempt++) {
      zonesFrames(10_000);
      gc({ type: 'minor' });
      await settle();
      scavenges = 0;
      const before = young();
      zonesFrames(ZONES_FRAMES);
      const made = young() - before;
      await settle();
      if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges };
      if (best.scavenges === 0 && best.made <= 0) break;
    }
    return best;
  };
  st[2] = 0;
  st[3] = 800;
  st[4] = 450;
  zonesFrame();
  if (process.argv.includes('afterSteady')) {
    // Where a rectangle's drag makes anything once the steady frames have been compiled first, as the measure runs them
    // (`node --expose-gc --allow-natives-syntax tools/swg/tests/editorAllocOwn.ts zones afterSteady profile`).
    zones.picked = 'z:box';
    ZONE_TOOL_TUNE.mode = 'circle';
    st[2] = 0;
    st[3] = 800;
    st[4] = 450;
    await measure();
    zones.picked = null;
    ZONE_TOOL_TUNE.mode = 'rect';
    st[3] = 300;
    st[4] = 200;
    st[2] = 2;
    zonesFrame();
  }
  if (process.argv.includes('profile')) {
    zonesFrames(20_000);
    const { Session } = await import('node:inspector/promises');
    const session = new Session();
    session.connect();
    await session.post('HeapProfiler.startSampling', { samplingInterval: 32, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    zonesFrames(50_000);
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
  const shown = zm.lakeCount;
  // A rectangle dragged out: the zone let go, the mode a rectangle, pressed away from every ring and held.
  zones.picked = null;
  ZONE_TOOL_TUNE.mode = 'rect';
  st[3] = 300;
  st[4] = 200;
  st[2] = 2;
  zonesFrame();
  const rectOn = (zones as unknown as { rectOn: boolean }).rectOn;
  const rect = await measure();
  // Let go (a write, outside every window), then an outline of three clicks under way.
  st[2] = 0;
  zonesFrame();
  await settle();
  // The rectangle written is picked; let go, so the outline's first click is a point and not the click that lets go of it.
  zones.picked = null;
  ZONE_TOOL_TUNE.mode = 'outline';
  for (let k = 0; k < 3; k++) {
    st[2] = 3;
    zonesFrame();
    st[2] = 0;
    zonesFrame();
  }
  const draftPoints = zones.draftN;
  const draft = await measure();
  watch.disconnect();
  console.log(JSON.stringify({ frames: ZONES_FRAMES, made: steady.made, scavenges: steady.scavenges, rectMade: rect.made, rectScavenges: rect.scavenges, draftMade: draft.made, draftScavenges: draft.scavenges, zones: shown, rectOn, draftPoints, draftDrawn: zm.draftCount, snapped: st[5] > 0 }));
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
