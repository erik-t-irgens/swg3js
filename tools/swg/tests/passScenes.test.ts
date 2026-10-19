// The shadow pass's and the rooms' own scenes (src/world/passScenes.ts), checked without a browser: the mirror copies
// every field a three scene holds of its own beyond an Object3D's (the list is worked out here from three itself, so a
// field three adds later fails this until it is mirrored), the proxies take the world scene's very children array and
// nothing is ever parented to them, and a real PortalRenderer built on a recording stub renderer draws the shadow pass
// through the shadow proxy, the world pass through the real scene, each rooms pass through the rooms proxy and
// `drawShadowsOnly` through the shadow proxy, inside a building and outside one. And the routes-off guard of the room
// deferral (src/world/roomDefer.ts): the pending roots hidden around each rooms pass and put back after.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mirror, PASS_STATES, PassScenes, SCENE_FIELDS } from '../../../src/world/passScenes.ts';
import { INTERIOR_LAYER, PortalRenderer } from '../../../src/world/portalRender.ts';
import type { Portal } from '../../../src/world/assetPack.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---- 1. The mirror. ----
{
  const own = new Set(Object.keys(new THREE.Object3D()));
  const fields = Object.keys(new THREE.Scene()).filter((k) => !own.has(k) && k !== 'isScene');
  const listed = new Set<string>(SCENE_FIELDS);
  ok(fields.every((k) => listed.has(k)), `every own field of a three Scene beyond an Object3D's is mirrored (${fields.filter((k) => !listed.has(k)).join(', ') || 'none missing'})`);
  ok([...listed].every((k) => fields.includes(k)), 'and the list names nothing a three Scene does not hold');
  const real = new THREE.Scene();
  const proxy = new THREE.Scene();
  const fog = new THREE.FogExp2(0x112233, 0.01);
  const env = new THREE.Texture();
  const bg = new THREE.Color(0.2, 0.3, 0.4);
  const over = new THREE.MeshBasicMaterial();
  real.fog = fog;
  real.environment = env;
  real.background = bg;
  real.overrideMaterial = over;
  real.backgroundBlurriness = 0.4;
  real.backgroundIntensity = 0.7;
  real.environmentIntensity = 0.3;
  real.matrixWorldAutoUpdate = false;
  real.visible = false;
  mirror(real, proxy);
  ok(proxy.fog === fog && proxy.environment === env && proxy.background === bg && proxy.overrideMaterial === over, 'the fog, the environment, the background and the override are the real scene\'s own objects');
  ok(proxy.backgroundBlurriness === 0.4 && proxy.backgroundIntensity === 0.7 && proxy.environmentIntensity === 0.3, 'and the numbers come across');
  ok(proxy.backgroundRotation === real.backgroundRotation && proxy.environmentRotation === real.environmentRotation, 'and the two rotations');
  ok(proxy.matrixWorldAutoUpdate === false && proxy.visible === false, 'the walk\'s switch and whether it is shown come across');
  real.matrixWorldAutoUpdate = true;
  real.fog = null;
  mirror(real, proxy);
  ok(proxy.matrixWorldAutoUpdate === true && proxy.fog === null, 'mirrored again on the next draw, as a frame moves them');
}

// ---- 2. The proxies share the world scene's children and are never anybody's parent. ----
{
  const real = new THREE.Scene();
  const a = new THREE.Mesh(new THREE.BoxGeometry());
  real.add(a);
  const ps = new PassScenes();
  const sh = ps.forShadows(real);
  const ro = ps.forRooms(real);
  ok(sh !== real && ro !== real && sh !== ro, 'the shadow pass and the rooms each draw a scene of their own');
  ok(sh.children === real.children && ro.children === real.children, 'whose children array is the real scene\'s very own');
  const b = new THREE.Mesh(new THREE.BoxGeometry());
  real.add(b);
  ok(sh.children.includes(b) && ro.children.includes(b), 'so whatever the world adds is in both at once');
  let proxyParent = false;
  real.traverse((o) => {
    if (o.parent === sh || o.parent === ro) proxyParent = true;
  });
  ok(!proxyParent && a.parent === real && b.parent === real, 'and nothing is ever parented to a proxy');
  // A matrix walk through a proxy works every child's world matrix out from the real scene, its true parent.
  a.position.set(3, 0, 0);
  sh.updateMatrixWorld();
  ok(Math.abs(a.matrixWorld.elements[12] - 3) < 1e-9, 'a matrix walk through the shadow proxy updates the world\'s children from their own parent');
  const other = new THREE.Scene();
  ps.forRooms(other);
  ok(ps.rooms.children === other.children && ps.shadow.children === other.children, 'bound to another scene, both proxies follow it');
  PASS_STATES.mode = 'shared';
  ok(ps.forShadows(real) === real && ps.forRooms(real) === real, "the switch on 'shared' draws every pass through the real scene, as before");
  PASS_STATES.mode = 'perPass';
}

// ---- 3. A real PortalRenderer on a recording stub renderer. ----

/** A renderer that records which scene each `render` and `compile` call was handed, and nothing else. */
function stubRenderer(): { r: THREE.WebGLRenderer; renders: { scene: THREE.Object3D; camera: THREE.Camera; hidden: number }[]; compiles: { scene: THREE.Object3D; target: THREE.Object3D | null; mask: number }[]; watch: THREE.Object3D[] } {
  const renders: { scene: THREE.Object3D; camera: THREE.Camera; hidden: number }[] = [];
  const compiles: { scene: THREE.Object3D; target: THREE.Object3D | null; mask: number }[] = [];
  const watch: THREE.Object3D[] = [];
  const stub = {
    autoClear: true,
    info: { render: { calls: 0, triangles: 0 } },
    shadowMap: { enabled: true, autoUpdate: true, needsUpdate: false },
    state: { buffers: { stencil: { setClear: () => undefined } } },
    renderBufferDirect: () => undefined,
    clear: () => undefined,
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(1920, 1080),
    render: (scene: THREE.Object3D, camera: THREE.Camera) => {
      renders.push({ scene, camera, hidden: watch.filter((o) => !o.visible).length });
    },
    compile: (scene: THREE.Object3D, camera: THREE.Camera, target: THREE.Object3D | null = null) => {
      compiles.push({ scene, target, mask: camera.layers.mask });
      return new Set();
    },
  };
  return { r: stub as unknown as THREE.WebGLRenderer, renders, compiles, watch };
}

function quad(x0: number, x1: number, y0: number, y1: number, z: number): { v: number[][]; i: number[] } {
  return { v: [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], i: [0, 1, 2, 0, 2, 3] };
}

/** Two rooms and a door to the world at z 5, as the portal culling test builds them, standing at the origin. */
function building(withDoor: boolean): Record<string, unknown> {
  const def = {
    id: withDoor ? 'test_two_rooms_door' : 'test_two_rooms_shut',
    bounds: { min: [-5, 0, -5], max: [5, 3, 5] },
    cells: [
      { index: 0, name: 'r0', bounds: { min: [-5, 0, -5], max: [5, 3, 5] }, portals: withDoor ? [{ geometry: 1, target: 2, passable: true }] : [] },
      { index: 1, name: 'front', bounds: { min: [-5, 0, -5], max: [5, 3, 0] }, portals: [{ geometry: 0, target: 2, passable: true }] },
      { index: 2, name: 'back', bounds: { min: [-5, 0, 0], max: [5, 3, 5] }, portals: [{ geometry: 0, target: 1, passable: true }, ...(withDoor ? [{ geometry: 1, target: 0, passable: true }] : [])] },
    ],
  };
  const polys = withDoor ? [quad(-1, 1, 0, 2.2, 0), quad(-1, 1, 0, 2.2, 5)] : [quad(-1, 1, 0, 2.2, 0)];
  const portals: Portal[] = polys.map((poly) => {
    const verts = poly.v.map((v) => new THREE.Vector3(v[0], v[1], v[2]));
    const normal = new THREE.Vector3().subVectors(verts[1], verts[0]).cross(new THREE.Vector3().subVectors(verts[2], verts[0])).normalize();
    return { verts, indices: poly.i.slice(), normal, d: normal.dot(verts[0]), links: [], passable: true };
  });
  for (const c of def.cells) for (const l of c.portals) portals[l.geometry]?.links.push({ from: c.index, to: l.target });
  const matrix = new THREE.Matrix4();
  return { model: { portals, def }, matrix, inverse: matrix.clone().invert(), x: 0, z: 0, radius: 5, interior: [], interiorCell: [] };
}

const camera = new THREE.PerspectiveCamera(60, 1920 / 1080, 0.05, 9000);
function look(x: number, y: number, z: number, tx: number, ty: number, tz: number): void {
  camera.position.set(x, y, z);
  camera.lookAt(tx, ty, tz);
  camera.updateMatrixWorld(true);
}

{
  const { r, renders, compiles, watch } = stubRenderer();
  const portals = new PortalRenderer(r);
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BoxGeometry()));
  const shadowProxy = portals.passScenes.shadow;
  const roomsProxy = portals.passScenes.rooms;
  // The old behaviour put back for the routes-off case: every root on the pending list hidden around a rooms pass.
  const pendingA = new THREE.Group();
  const pendingB = new THREE.Group();
  pendingB.visible = false;
  watch.push(pendingA, pendingB);

  // Outside, facing the door of a building near enough to be drawn through it.
  look(0, 1.6, 20, 0, 1.6, 0);
  const near = building(true);
  portals.roomPending[0] = pendingA;
  portals.roomPending[1] = pendingB;
  portals.roomPendingCount = 2;
  portals.render(scene, camera, null, [near as never]);
  const shadowPasses = renders.filter((x) => x.camera !== camera);
  const views = renders.filter((x) => x.camera === camera && (x.scene === scene || x.scene === roomsProxy));
  ok(shadowPasses.length === 1 && shadowPasses[0].scene === shadowProxy, 'outside: the shadow pass draws through the shadow proxy');
  ok(views.length >= 2 && views[0].scene === scene, 'outside: the world pass draws the real scene');
  const roomsPass = renders.find((x) => x.scene === roomsProxy);
  ok(!!roomsPass, 'outside: the building seen through its door is drawn through the rooms proxy');
  ok(roomsPass!.hidden === 2, 'with the routes off for the frame, every body waiting on its rooms programs is hidden in that pass');
  ok(pendingA.visible === true && pendingB.visible === false, 'and each is put back as its owner left it afterwards');
  ok(renders.filter((x) => x.scene === scene).every((x) => x.hidden === 1), 'the world pass hides nobody on the list (the one still hidden is its owner\'s)');

  // Inside a building with no way out: the rooms pass first, through the rooms proxy, and nothing else.
  renders.length = 0;
  portals.roomPendingCount = 0;
  look(0, 1.6, -3, 0, 1.6, 4);
  const shut = building(false);
  portals.render(scene, camera, shut as never, [shut as never]);
  const inShadow = renders.filter((x) => x.camera !== camera);
  const inRooms = renders.filter((x) => x.scene === roomsProxy);
  ok(inShadow.length === 1 && inShadow[0].scene === shadowProxy, 'inside: the shadow pass draws through the shadow proxy');
  ok(inRooms.length === 1 && renders.indexOf(inRooms[0]) === 1, 'inside: the building\'s rooms are drawn first after the shadows, through the rooms proxy');
  ok(!renders.some((x) => x.scene === scene && x.camera === camera), 'inside with no exit in sight: no world pass at all');

  // Inside with a door: the world drawn through it with the real scene.
  renders.length = 0;
  look(0, 1.6, -3, 0, 1.6, 10);
  portals.render(scene, camera, near as never, [near as never]);
  ok(renders.some((x) => x.scene === roomsProxy) && renders.some((x) => x.scene === scene && x.camera === camera), 'inside facing the door: the rooms through the rooms proxy and the world through the door with the real scene');
  ok(renders.filter((x) => x.camera !== camera).every((x) => x.scene === shadowProxy), 'and the shadow pass through its own');

  // The shadow-only draw the warm-up makes depth programs by.
  renders.length = 0;
  portals.drawShadowsOnly(scene);
  ok(renders.length === 1 && renders[0].scene === shadowProxy, 'drawShadowsOnly draws through the shadow proxy, as a frame\'s shadow pass does');

  // A pass's scene for the world's compiles, and the proxies' lights set up once.
  ok(portals.passScene(scene, INTERIOR_LAYER) === roomsProxy && portals.passScene(scene, 0) === scene, 'the world compiles a rooms pass against the rooms proxy and the world pass against the real scene');
  compiles.length = 0;
  camera.layers.set(0);
  const maskBefore = camera.layers.mask;
  portals.primePasses(scene, camera);
  ok(compiles.length === 2 && compiles[0].target === shadowProxy && compiles[1].target === roomsProxy, 'priming compiles nothing into each proxy, setting its lights up');
  ok(compiles[0].mask === (0xffffffff | 0), "the shadow proxy's under the probe, which sees every layer");
  ok(compiles[1].mask === ((1 << INTERIOR_LAYER) | (1 << 31)), "the rooms' under the rooms' layer and the actors'");
  ok(camera.layers.mask === maskBefore, "and the camera's own layers are put back");

  // The switch on 'shared' draws every pass through the real scene again.
  PASS_STATES.mode = 'shared';
  renders.length = 0;
  look(0, 1.6, 20, 0, 1.6, 0);
  portals.render(scene, camera, null, [near as never]);
  ok(renders.length > 0 && renders.every((x) => x.scene !== shadowProxy && x.scene !== roomsProxy), "with the switch on 'shared', no pass draws through a proxy");
  PASS_STATES.mode = 'perPass';
}

console.log(`\n${checks} checks passed`);
