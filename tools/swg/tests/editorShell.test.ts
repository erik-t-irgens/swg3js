// The world editor's shell (DESIGN.md §2.2, §2.3, §4): the free camera's flight is the same path at every frame rate, its
// speed steps hold to their least and most, the session refuses entering in words in every case and keeps the return
// point before anything moves, leaving chooses the plain reset where something solid is under the return point, its height
// kept where nothing is (space, the drawn water) and the curtain's way otherwise, N moves the return point and refuses the
// water, a world going turns the editor off with the return point kept, a moved tune reaches what is flown now, and
// the ghost is built of instanced meshes of one on the model's own geometry and materials, a portal building's rooms
// left out. Everything here runs the editor's own modules and the real streamer (`streamHarness.ts`), never a copy.
import assert from 'node:assert/strict';
import { HALL, boxGeo, loadedOf, makeStreamer, THREE } from './streamHarness.ts';

const { FlyCam, easeStep, stepSpeed } = await import('../../../src/editor/flyCam.ts');
const { EDITOR_TUNE, TUNE_WATCH, liveTuned, tuneEditor } = await import('../../../src/editor/editorTune.ts');
const { EditorSession, entryRefusal, leaveWay, returnPoint, returnRefusal } = await import('../../../src/editor/editorSession.ts');
const { EditorGhost } = await import('../../../src/world/placeGhost.ts');

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---- The flight at 20, 60 and 144 frames a second. ----
{
  const fly = (fps: number) => {
    const cam = new FlyCam();
    cam.yaw = 0.7;
    cam.pitch = -0.2;
    cam.speed = 10;
    const pos = { x: 0, y: 0, z: 0 };
    const input = { mouseDX: 0, mouseDY: 0, locked: false };
    const steps = Math.round(3 * fps);
    for (let i = 0; i < steps; i++) {
      // The keys change at 1.5 s, a frame every rate here has: forward and right, then up and fast.
      const late = i >= steps / 2;
      cam.ask.fwd = late ? 0 : 1;
      cam.ask.side = late ? 0 : 1;
      cam.ask.up = late ? 1 : 0;
      cam.ask.fast = late;
      cam.step(1 / fps, input, pos);
    }
    return pos;
  };
  const a = fly(20);
  const b = fly(60);
  const c = fly(144);
  const d = (p: { x: number; y: number; z: number }, q: { x: number; y: number; z: number }) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
  const worst = Math.max(d(a, b), d(a, c), d(b, c));
  ok(worst < 0.001, `the eye's eased flight lands within a millimetre after 3 s at 20, 60 and 144 frames a second (worst ${(worst * 1000).toFixed(4)} mm, ${a.x.toFixed(2)}, ${a.y.toFixed(2)}, ${a.z.toFixed(2)})`);
  ok(Math.hypot(a.x, a.y, a.z) > 20, 'and it really went somewhere');
  const e = { v: 0, d: 0 };
  easeStep(0, 10, 0.5, 0, e);
  ok(e.v === 10 && e.d === 5, 'an ease of nought is noclip\'s instant');
}

// ---- The speed's steps. ----
{
  const t = EDITOR_TUNE.cam;
  ok(stepSpeed(10, 1000) === t.max, `the wheel's speed steps stop at the most (${t.max} m/s)`);
  ok(stepSpeed(10, -1000) === t.min, `and at the least (${t.min} m/s)`);
  ok(Math.abs(stepSpeed(10, 1) - 10 * t.wheelStep) < 1e-9, `a notch multiplies by ${t.wheelStep}`);
}

// ---- The session: refusals, the return point, leaving, N, a world going. ----
{
  const NONE = { mounted: false, piloting: false, aboard: false, passenger: false, jumping: false, cruising: false, travelling: false, dead: false, talking: false };
  ok(entryRefusal(NONE) === null, 'nothing refuses entering a plain body on foot');
  const words = new Set<string>();
  for (const k of Object.keys(NONE) as (keyof typeof NONE)[]) {
    const why = entryRefusal({ ...NONE, [k]: true });
    ok(typeof why === 'string' && why.length > 8, `entering is refused in words while ${k} (“${why}”)`);
    words.add(why as string);
  }
  ok(words.size === Object.keys(NONE).length, 'every case has words of its own');

  const log: string[] = [];
  let state = { ...NONE };
  let floor = true;
  let keeps = false;
  const body = { x: 5, y: 2, z: -7, heading: 1.25, cell: 3, noclip: true, hp: 42 };
  const session = new EditorSession({
    state: () => state,
    body: (out) => {
      log.push('body');
      Object.assign(out, body);
    },
    enter: () => {
      log.push('enter');
      body.x = 999; // the anchor moves once the editor is on: the return point must already be kept
    },
    leave: (ret, way) => log.push(`leave ${way} ${ret.x}`),
    floorUnder: () => floor,
    keepsHeight: () => keeps,
    lock: () => log.push('lock'),
    release: () => log.push('release'),
  });
  state = { ...NONE, mounted: true };
  ok(session.enter() !== null && !session.on && log.length === 0, 'a refused entry moves nothing and keeps nothing');
  state = { ...NONE };
  ok(session.enter() === null && session.on, 'an allowed entry turns the editor on');
  ok(log.join(',') === 'body,enter,lock', `the return point is kept before anything moves (${log.join(', ')})`);
  ok(session.ret.x === 5 && session.ret.heading === 1.25 && session.ret.cell === 3 && session.ret.noclip && session.ret.hp === 42, 'with its place, heading, room (by its number), noclip and health');
  session.setPoint(true);
  ok(session.point && log[log.length - 1] === 'release', 'Tab into Point frees the cursor');
  session.setPoint(false);
  ok(!session.point && log[log.length - 1] === 'lock', 'and back into Fly takes it again');
  ok(session.lockLost(1000) && session.point && session.droppedAt === 1000, 'a lock lost in Fly drops to Point and the editor takes it');
  session.setPoint(false);
  session.setReturn(10, 1, 20, 0.5, 0);
  ok(session.ret.x === 10 && session.ret.z === 20 && session.ret.cell === 0, 'N moves the return point (its room with it)');
  floor = true;
  session.leave();
  ok(!session.on && log[log.length - 1] === 'leave plain 10' && session.lastLeave === 'plain', 'leaving with something solid under the return point is a plain reset');
  log.length = 0;
  session.enter();
  floor = false;
  session.leave();
  ok(log[log.length - 1].startsWith('leave curtain') && session.lastLeave === 'curtain', "and with nothing under it, the curtain's way");
  log.length = 0;
  session.enter();
  floor = false;
  keeps = true;
  session.leave();
  ok(log[log.length - 1].startsWith('leave exact') && session.lastLeave === 'exact', 'with nothing under it in space or in the drawn water, exactly where it was, its height kept and no ground read');
  keeps = false;
  log.length = 0;
  session.enter();
  const kept = { ...session.ret };
  session.worldGone();
  ok(!session.on && log.every((l) => !l.startsWith('leave')), 'a world going turns the editor off and stands nobody (the travel does)');
  ok(!!session.lastReturn && session.lastReturn.x === kept.x && session.lastReturn.z === kept.z && session.lastLeave === 'world-gone', 'and the return point survives it, kept to say');
  ok(returnPoint().cell === 0, 'a fresh return point holds no room');
  ok(leaveWay(true, true) === 'plain' && leaveWay(false, true) === 'exact' && leaveWay(false, false) === 'curtain', 'a floor under it is a plain reset whatever else; with none, its height kept where it keeps it, the curtain otherwise');
}

// ---- N's refusals: only the ground and what stands still are a place to stand. ----
{
  ok(returnRefusal('terrain', false) === null && returnRefusal('still', false) === null, 'N takes the ground and what stands still');
  ok(returnRefusal('box', true) === null, "and a row's box with something solid under its face");
  const water = returnRefusal('water', false);
  ok(typeof water === 'string' && water.includes('water'), `never the drawn water (“${water}”)`);
  const box = returnRefusal('box', false);
  ok(typeof box === 'string' && box.includes('nothing solid'), `nor a box with nothing under it (“${box}”)`);
  ok(typeof returnRefusal('sky', false) === 'string' && typeof returnRefusal('handle', false) === 'string', 'nor the sky');
}

// ---- A tune moved reaches what is flown now. ----
{
  const said: unknown[] = [];
  const was = TUNE_WATCH.moved;
  TUNE_WATCH.moved = (p) => said.push(p);
  const before = EDITOR_TUNE.cam.speed;
  tuneEditor({ cam: { speed: 22 } });
  ok(said.length === 1 && liveTuned(said[0]).speed && !liveTuned(said[0]).skyReach, 'a tune moved tells the editor, naming the flight\'s speed');
  tuneEditor({ aim: { skyReach: 90 } });
  ok(liveTuned(said[1]).skyReach && !liveTuned(said[1]).speed, "and the sky's reach");
  ok(!liveTuned({ cam: { fast: 3 } }).speed && !liveTuned(null).speed, 'and nothing else as either');
  tuneEditor({ cam: { speed: before }, aim: { skyReach: 40 } });
  TUNE_WATCH.moved = was;
}

// ---- The ghost: instanced meshes of one on the model's own geometry and materials. ----
{
  const h = await makeStreamer();
  const shellMat = new THREE.MeshStandardMaterial();
  const roomMat = new THREE.MeshStandardMaterial();
  const prims = [
    { geometry: boxGeo(20, 8, 20, 0), cell: 0, material: shellMat },
    { geometry: boxGeo(18, 0.3, 18, 0), cell: 1, material: roomMat },
  ];
  const hall = loadedOf(HALL as never, prims, [new THREE.Box3(new THREE.Vector3(-9, 0, -9), new THREE.Vector3(9, 7.5, 9))]);
  (hall as { portals: unknown[] }).portals = [{ cells: [0, 1] }];
  const meshes = h.stream.ghostMeshesOf(hall as never);
  ok(meshes.length === 1, `a portal building's ghost leaves its rooms out (${meshes.length} mesh of 2 primitives)`);
  const m = meshes[0];
  ok(m.isInstancedMesh && m.count === 1, 'each piece is an instanced mesh of one, as the streamer draws a placement');
  ok(m.geometry === prims[0].geometry && m.material === shellMat, "on the model's own geometry and material, never a copy");
  ok(!m.visible && !m.frustumCulled, 'hung hidden until prepared, and never culled by a stale sphere');
  const crate = loadedOf({ id: 'crate', file: 'crate.glb', bounds: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }, triangles: 12 }, [{ geometry: boxGeo(1, 1, 1, 0), cell: -1 }]);
  ok(h.stream.ghostMeshesOf(crate as never).length === 1, 'a plain prop is one piece of one');

  const scene = new THREE.Scene();
  let prepared = 0;
  let release: (() => void) | null = null;
  const ghost = new EditorGhost({
    add: (o) => scene.add(o),
    remove: (o) => scene.remove(o),
    prepare: () => {
      prepared++;
      return new Promise<void>((r) => {
        release = r;
      });
    },
    actorLayer: 1,
  });
  ghost.set('buildings:hall', meshes);
  const at = new THREE.Matrix4().makeTranslation(3, 0, 4);
  ghost.place(at, false);
  ok(prepared === 1 && !ghost.shown && !m.visible, 'not shown while its programs are still being prepared');
  (release as unknown as () => void)();
  await new Promise((r) => setTimeout(r, 0));
  ok(ghost.ready && ghost.shown && m.visible, 'shown once the streamer\'s own prepare has answered');
  ghost.place(at, true);
  ok(prepared === 2 && !ghost.shown, 'in a room it waits for its room-pass programs, drawn as its box alone meanwhile');
  (release as unknown as () => void)();
  await new Promise((r) => setTimeout(r, 0));
  ok(ghost.shown && m.layers.isEnabled(1), 'and then takes the actor layer');
  const left = ghost.leaveBehind();
  ok(left.length === 1 && left[0].geometry === m.geometry && left[0].material === m.material && scene.children.includes(left[0]), 'a click leaves copies on the same geometry and material where it stood');
  ghost.dropLeft(left);
  ok(!scene.children.includes(left[0]), 'taken away once the row is built');
  ghost.clear();
  ok(!scene.children.includes(m) && ghost.meshes.length === 0 && ghost.key === '', 'cleared, nothing of it is left in the scene');
}

console.log(`\n${checks} checks passed`);
