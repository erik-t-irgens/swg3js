// Reflections of the real sky on WebGPU (the GPU port's pass 2, wave 2, maker B; the design's 2.3): the capture's own code
// run whole under node over three's real classes, a recording renderer and a counting filter in place of the card.
//
//  1. the clock (`CaptureClock`): a refresh every `CAPTURE_TUNE.every` seconds, or sooner once the light has turned
//     `sunMoveDeg`, drawn as six faces on six frames and the filter on a seventh; an ask takes everything at once; a hold takes
//     nothing; `pace: 'once'` is the capture before this wave; over the game's own day (`DayCycle`) the clock comes first and
//     an hour moved by hand at once;
//  2. the draws (`SkyCapture.step`): each face by its own camera into the kept cube's own face, the renderer's target put back
//     after each, the kept target filtered on the seventh frame and handed over as the same texture every time, no target
//     made after the first;
//  3. what is drawn beside the dome: a copy for every live mesh WebGPU draws (never a shader material with no stand-in, a
//     mesh writing no colour, points, an instanced mesh), placed as its live mesh less its centre's place to the bit, shown
//     only while its live mesh is shown in a scene with its own material, every one shown for the warm-up's walk and put back,
//     the scene's two lights made once and copied from the world's at each refresh, the dome drawn first;
//  4. our sky's discs in the capture (`airSky.ts`): spread to `sunDeg` and capped at `sunCap` there and nowhere else;
//  5. the dials (`captureTune.ts`): ranges, the pace, the debug menu's set on `reflections`;
//  6. the world's wiring, as text.
//
// Run: node tools/swg/tests/skyCaptureSteps.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { DOME_CUBE, DomeCapture, type DomeFilter } from '../../../src/world/envmap.ts';
import { CaptureClock, SkyCapture, STEP_ALL, STEP_FILTER, STEP_NONE, capturable, type CaptureRenderer } from '../../../src/sky/capture/skyCapture.ts';
import { CAPTURE_TUNE, CAPTURE_TUNE_RANGE, captureDialsFor, tuneCapture } from '../../../src/sky/capture/captureTune.ts';
import { DayCycle } from '../../../src/world/daycycle.ts';
import { sharedClock } from '../../../src/world/sharedClock.ts';
import { discLeastRadius, discMostLight } from '../../../src/sky/air/airSky.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let checks = 0;
const ok = (cond: unknown, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const text = (f: string): string => readFileSync(new URL(`../../../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SHIPPED = { ...CAPTURE_TUNE };
const reset = (): void => void Object.assign(CAPTURE_TUNE, SHIPPED);
const dirOf = (deg: number): THREE.Vector3 => new THREE.Vector3(Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180), 0);

// ---------------------------------------------------------------- 1. the clock
{
  ok(SHIPPED.every === 4 && SHIPPED.sunMoveDeg === 0.5 && SHIPPED.pace === 'faces' && SHIPPED.sunDeg === 1 && SHIPPED.sunCap === 4, "the dials ship at the design's numbers: every 4 s, half a degree, a face a frame, the sun at least 1 degree across its radius and capped at 4");
  const c = new CaptureClock();
  const light = dirOf(30);
  c.dt = 1 / 60;
  // The world's first capture is an ask (its timer begins at 99), which keeps the light's direction.
  c.asked = true;
  ok(c.next(light) === STEP_ALL, "the first capture is the world's ask, all at once");
  const seen: number[] = [];
  for (let i = 0; i < 60 * 4 - 2; i++) seen.push(c.next(light));
  ok(seen.every((s) => s === STEP_NONE), `nothing is taken for the first four seconds of a still light (${seen.length} frames)`);
  const run: number[] = [];
  for (let i = 0; i < 12; i++) run.push(c.next(light));
  const first = run.findIndex((s) => s !== STEP_NONE);
  ok(first >= 0 && run.slice(first, first + 7).join() === '0,1,2,3,4,5,6' && run.slice(first + 7).every((s) => s === STEP_NONE), `then a refresh: a face a frame on six frames, the filter on the seventh, and nothing after (${run.join()})`);
  ok(STEP_FILTER === 6 && c.why.clock === 1 && c.why.light === 0, 'begun by the clock');
  // Over a minute of a still light at 60 frames a second: a refresh begun every four seconds, from one start to the next.
  const begins: number[] = [];
  for (let i = 0; i < 3600; i++) if (c.next(light) === 0) begins.push(i);
  const gaps = begins.slice(1).map((b, i) => b - begins[i]);
  ok(begins.length >= 14 && gaps.every((g) => g === 240 || g === 241), `a minute of a still light begins a refresh every four seconds, start to start, within the frame the sum lands on (${begins.length} refreshes, gaps ${[...new Set(gaps)].join(' or ')} frames)`);
  // The light turned: under half a degree waits for the clock, past it is taken at once.
  const d = new CaptureClock();
  d.dt = 1 / 60;
  d.asked = true;
  d.next(dirOf(30));
  ok(d.next(dirOf(30.45)) === STEP_NONE, 'a light turned 0.45 degrees waits for the clock');
  ok(d.next(dirOf(30.55)) === 0 && d.why.light === 1, 'one turned 0.55 degrees begins a refresh at once');
  for (let i = 0; i < 6; i++) d.next(dirOf(30.55));
  ok(d.next(dirOf(30.9)) === STEP_NONE, 'measured from where the light stood as that refresh began (0.35 degrees on)');
  tuneCapture({ sunMoveDeg: 0.2 });
  ok(d.next(dirOf(30.9)) === 0, 'and a smaller dial takes the same turn at once, the dial read as it moves');
  reset();
  // An ask, a hold and the pace.
  const e = new CaptureClock();
  e.dt = 1 / 60;
  e.asked = true;
  ok(e.next(light) === STEP_ALL && e.why.asked === 1 && e.next(light) === STEP_NONE, 'an ask takes everything at once, and the clock begins from nought');
  e.held = 1;
  e.asked = true;
  let none = true;
  for (let i = 0; i < 600; i++) if (e.next(dirOf(i)) !== STEP_NONE) none = false;
  ok(none, 'a hold takes nothing, not the ask, not the clock, not the light turning');
  e.held = 0;
  ok(e.next(light) === STEP_ALL, 'and when it is let go the ask is taken');
  tuneCapture({ pace: 'once' });
  let onceAt = -1;
  let onceStep = STEP_NONE;
  for (let i = 0; i < 300 && onceStep === STEP_NONE; i++) {
    onceStep = e.next(light);
    onceAt = i;
  }
  ok(onceStep === STEP_ALL && onceAt >= 238 && onceAt <= 241 && e.next(light) === STEP_NONE, `with \`pace: 'once'\` the clock takes everything on one frame four seconds on, as the capture did before (frame ${onceAt})`);
  reset();
  // Over the game's own day: the clock first, an hour moved by hand at once.
  sharedClock.none();
  const day = new DayCycle(0.3, 1);
  const f = new CaptureClock();
  f.dt = 1 / 60;
  day.update(1 / 60, false);
  f.asked = true;
  f.next(day.lightDir);
  let byClock = 0;
  let byLight = 0;
  for (let i = 0; i < 60 * 120; i++) {
    day.update(1 / 60, false);
    const s = f.next(day.lightDir);
    if (s === 0 || s === STEP_ALL) {
      if (f.why.light > byLight) byLight = f.why.light;
      else byClock++;
    }
  }
  ok(byClock >= 29 && byClock <= 30 && byLight === 0, `two minutes of the game's own day: a refresh by the clock every four seconds and none by the light, which turns under half a degree in four seconds (${byClock}, ${byLight})`);
  day.time = 0.62;
  day.update(1 / 60, false);
  ok(f.next(day.lightDir) === 0 && f.why.light === 1, 'an hour moved by hand (a held hour, the creator\'s slider) is taken at once');
}

// ---------------------------------------------------------------- 2 and 3. the draws, and what is drawn
/** A generator that makes a target only when it is handed none, as three's does, and counts. */
class CountingFilter implements DomeFilter {
  made = 0;
  calls = 0;
  fromCubemap(_cube: THREE.Texture, into: THREE.WebGLRenderTarget | null = null): THREE.WebGLRenderTarget {
    this.calls++;
    if (into) return into;
    this.made++;
    return new THREE.WebGLRenderTarget(256, 256);
  }
  compileCubemapShader(): void {}
}

/** Every call the capture makes of the renderer, written down. */
class Rec implements CaptureRenderer {
  target: unknown = null;
  face = 0;
  mip = 0;
  autoClear = true;
  reversedDepthBuffer = true;
  coordinateSystem = THREE.WebGPUCoordinateSystem;
  log: { kind: string; target: unknown; face: number; camera?: THREE.Camera; scene?: THREE.Object3D }[] = [];
  getRenderTarget(): unknown {
    return this.target;
  }
  getActiveCubeFace(): number {
    return this.face;
  }
  getActiveMipmapLevel(): number {
    return this.mip;
  }
  setRenderTarget(t: unknown, face = 0, mip = 0): void {
    this.target = t;
    this.face = face;
    this.mip = mip;
  }
  render(scene: THREE.Object3D, camera: THREE.Camera): void {
    this.log.push({ kind: 'render', target: this.target, face: this.face, camera, scene });
  }
  clearDepth(): void {
    this.log.push({ kind: 'clearDepth', target: this.target, face: this.face });
  }
}

/** A sky as the world hangs one: the world's scene holding a group that rides the camera, its dome and its bodies, and the capture's own scene holding the dome. */
function makeSky() {
  const world = new THREE.Scene();
  const group = new THREE.Group();
  group.position.set(5012.25, 31.5, -1307.75);
  world.add(group);
  const domeMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide, depthTest: false, depthWrite: false });
  const domeGeo = new THREE.SphereGeometry(5600, 8, 4);
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.renderOrder = -10;
  group.add(dome);
  const domeScene = new THREE.Scene();
  domeScene.add(new THREE.Mesh(domeGeo, domeMat));
  domeScene.userData.swgSkyCapture = true;
  const body = (name: string, additive: boolean, deg: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, depthWrite: false }));
    m.name = name;
    m.renderOrder = -5;
    m.position.copy(dirOf(deg)).multiplyScalar(3500);
    m.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.3);
    m.scale.set(210.5, 210.5, 1);
    group.add(m);
    return m;
  };
  const glow = body('moon glow', true, 40);
  const disc = body('moon', false, 40);
  const box = new THREE.Group();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false }));
  face.renderOrder = -9;
  box.add(face);
  group.add(box);
  // What no copy is made of: the stars' points, a shader material WebGPU cannot draw, one with a stand-in (drawn), one writing no colour, an instanced mesh.
  const stars = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());
  group.add(stars);
  const raw = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ vertexShader: 'void main(){}', fragmentShader: 'void main(){}' }));
  const stood = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({ vertexShader: 'void main(){}', fragmentShader: 'void main(){}' }));
  stood.material.userData.gpuStandIn = () => null;
  const depthOnly = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ colorWrite: false }));
  const instanced = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial(), 4);
  const sun = new THREE.DirectionalLight(0xffe0c0, 2.5);
  sun.position.set(5012.25 + 100, 31.5 + 200, -1307.75);
  sun.target.position.set(5012.25, 31.5, -1307.75);
  const hemi = new THREE.HemisphereLight(0x8090a0, 0x403020, 0.75);
  world.add(sun, sun.target, hemi);
  return { world, group, dome, domeMat, domeScene, glow, disc, box, face, stars, raw, stood, depthOnly, instanced, sun, hemi };
}

{
  const filter = new CountingFilter();
  const domeCap = new DomeCapture(filter);
  const cap = new SkyCapture(domeCap);
  const s = makeSky();
  const sources = [s.glow, s.disc, s.box];
  ok(capturable(s.glow) && capturable(s.face) && capturable(s.stood) && !capturable(s.stars) && !capturable(s.raw) && !capturable(s.depthOnly) && !capturable(s.instanced), 'a copy is made of a mesh WebGPU draws, a shader material with a stand-in among them, and of no points, no shader material without one, nothing writing no colour and no instanced mesh');
  const n = cap.attach(s.domeScene, s.group, s.sun, s.hemi, s.domeMat, s.dome.renderOrder, sources);
  ok(n === 3 && cap.counts().join() === '3,0,0', `the sky's two bodies and its skybox's face are copied (${n})`);
  const lights = s.domeScene.children.filter((o) => (o as THREE.Light).isLight);
  ok(lights.length === 2 && lights.some((l) => (l as THREE.DirectionalLight).isDirectionalLight) && lights.some((l) => (l as THREE.HemisphereLight).isHemisphereLight), 'the capture scene has two lights of its own, a directional and a hemisphere');
  ok((s.domeScene.children[0] as THREE.Mesh).renderOrder === -10, "the capture's own mesh of the dome is drawn first, at the live dome's order");
  const copies = s.domeScene.children.filter((o) => o.userData.swgCaptureCopy === true) as THREE.Mesh[];
  ok(copies.length === 3 && copies.every((c) => c.matrixAutoUpdate === false && c.matrixWorldAutoUpdate === false) && copies[0].geometry === s.glow.geometry && copies[0].material === s.glow.material && copies[0].renderOrder === -5 && copies[2].renderOrder === -9, "each copy is a mesh of its own over the live one's very geometry and material, at its draw order, its place written by the capture alone");
  ok(copies.every((c) => c.visible === false), 'hidden until a refresh places it');
  ok(copies.every((c) => c.frustumCulled === false) && s.glow.frustumCulled === true, "and never culled, so the warm-up's walk (which culls against the face camera) lists every copy before its first refresh places it");
  ok(s.domeScene.name === 'the sky capture', "the capture scene named, so the pipeline census files what it draws as the capture's");
  // The warm-up's walk sees every copy, and each is put back after.
  let walked = 0;
  cap.compileWith(() => {
    s.domeScene.traverseVisible((o) => {
      if (o.userData.swgCaptureCopy === true) walked++;
    });
  });
  ok(walked === 3 && copies.every((c) => c.visible === false), "the warm-up's walk is handed every copy shown, and each is put back as it was");
  ok(cap.attach(s.domeScene, s.group, s.sun, s.hemi, s.domeMat, -10, sources) === 3 && s.domeScene.children.filter((o) => (o as THREE.Light).isLight).length === 2 && s.domeScene.children.filter((o) => o.userData.swgCaptureCopy).length === 3, "the same sky attached again keeps its two lights and makes its copies afresh, none twice");

  // The draws: an ask, then the clock.
  const r = new Rec();
  const prevTarget = { name: 'the scene target' };
  r.setRenderTarget(prevTarget, 0, 0);
  s.world.updateMatrixWorld(true);
  s.disc.visible = false;
  cap.clock.asked = true;
  cap.clock.dt = 1 / 60;
  const light = dirOf(40);
  const t0 = cap.step(r, light);
  const renders = r.log.filter((l) => l.kind === 'render');
  ok(t0 !== null && t0 === domeCap.target!.texture && filter.calls === 1 && filter.made === 1, 'an ask takes all six faces and the filter at once, and hands over the kept target');
  ok(renders.length === 6 && renders.every((l, i) => l.target === domeCap.cube && l.face === i && l.camera === domeCap.camera.children[i] && l.scene === s.domeScene), 'each face drawn into its own face of the kept cube by its own camera, from the capture scene');
  ok(r.target === prevTarget && r.face === 0 && r.mip === 0, "and the renderer's own target put back");
  ok(domeCap.camera.coordinateSystem === THREE.WebGPUCoordinateSystem, "the cube's cameras turned to the renderer's coordinate system, as three's own update turns them");
  // Placement: each copy as its live mesh less its centre, to the bit (the copies the second attach made).
  const [cg, cd, cf] = s.domeScene.children.filter((o) => o.userData.swgCaptureCopy === true) as THREE.Mesh[];
  ok(!copies.some((c) => s.domeScene.children.includes(c)), "the first attach's copies left the scene");
  const want = new THREE.Matrix4().copy(s.glow.matrixWorld);
  want.elements[12] -= s.group.matrixWorld.elements[12];
  want.elements[13] -= s.group.matrixWorld.elements[13];
  want.elements[14] -= s.group.matrixWorld.elements[14];
  ok(cg.visible && cg.matrixWorld.elements.every((v, i) => v === want.elements[i]), 'a copy stands where its live mesh does less its centre, to the bit');
  const local = new THREE.Vector3().setFromMatrixPosition(cg.matrixWorld);
  ok(local.distanceTo(s.glow.position) < 1e-9, `which is the live body's own place in the sky (${local.distanceTo(s.glow.position).toExponential(1)} m off), about the cube's cameras at the origin`);
  ok(!cd.visible && cf.visible, 'a body hidden is not drawn, a skybox face shown is');
  const capSun = s.domeScene.children.find((o) => (o as THREE.DirectionalLight).isDirectionalLight) as THREE.DirectionalLight;
  const capSky = s.domeScene.children.find((o) => (o as THREE.HemisphereLight).isHemisphereLight) as THREE.HemisphereLight;
  ok(capSun.color.equals(s.sun.color) && capSun.intensity === 2.5 && capSun.position.x === 100 && capSun.position.y === 200 && capSun.position.z === 0 && capSky.color.equals(s.hemi.color) && capSky.groundColor.equals(s.hemi.groundColor) && capSky.intensity === 0.75, "the scene's sun and sky light copied from the world's, the sun from its target toward it");
  // The clock: four seconds on, a face a frame and the filter on the seventh.
  r.log.length = 0;
  s.disc.visible = true;
  s.group.position.x += 40.5;
  let handed: THREE.Texture | null = null;
  const per: number[] = [];
  for (let i = 0; i < 60 * 4 + 10; i++) {
    const before = r.log.length;
    const t = cap.step(r, light);
    if (t) handed = t;
    per.push(r.log.length - before);
  }
  const drawFrames = per.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
  ok(drawFrames.length === 6 && drawFrames.every((f, i) => f === drawFrames[0] + i) && drawFrames.every((f) => per[f] === 1) && r.log.filter((l) => l.kind === 'clearDepth').length === 0, `four seconds on, one face a frame on six frames in a row (frames ${drawFrames.join(', ')}), one render each, no depth cleared by hand while three clears it`);
  ok(filter.calls === 2 && handed === t0 && filter.made === 1, 'the filter on the seventh frame, into the kept target, the same texture handed over, no target made');
  ok(cd.visible && new THREE.Vector3().setFromMatrixPosition(cd.matrixWorld).distanceTo(s.disc.position) < 1e-9, 'the body shown again is drawn, placed about the group as it now stands (the centres walked as the refresh begins)');
  // Visibility follows the live mesh up to its scene, and its material.
  s.box.visible = false;
  cap.clock.asked = true;
  cap.step(r, light);
  ok(!cf.visible, 'a skybox hidden by its group is not drawn');
  s.box.visible = true;
  s.group.remove(s.box);
  cap.clock.asked = true;
  cap.step(r, light);
  ok(!cf.visible, 'nor one taken out of the scene');
  s.group.add(s.box);
  const swapped = s.glow.material;
  s.glow.material = new THREE.MeshBasicMaterial();
  cap.clock.asked = true;
  cap.step(r, light);
  ok(!cg.visible, 'nor a body given another material since its copy was made (the copy\'s pipeline is the old one\'s)');
  s.glow.material = swapped;
  // With the renderer drawing into its target without clearing, the depth is cleared by hand, as three's update does.
  r.autoClear = false;
  r.log.length = 0;
  cap.clock.asked = true;
  cap.step(r, light);
  ok(r.log.filter((l) => l.kind === 'clearDepth').length === 6, "with three's clearing off under reversed depth each face's depth is cleared first, as three's own update does");
  r.autoClear = true;
  // Planets and nebulae: placed, let go.
  const planets = new THREE.Group();
  planets.position.copy(s.group.position);
  const planet = new THREE.Mesh(new THREE.SphereGeometry(500, 8, 4), new THREE.MeshLambertMaterial());
  planet.position.set(0, 0, -2600);
  const cut = new THREE.Mesh(new THREE.SphereGeometry(2600, 8, 4), new THREE.MeshBasicMaterial({ colorWrite: false }));
  planets.add(planet, cut);
  s.world.add(planets);
  ok(cap.placePlanets(planets) === 1 && cap.counts().join() === '3,1,0', "in space the planets are copied (their depth stand-ins, which write no colour, are not)");
  ok(cap.placePlanets(planets) === 1 && cap.counts().join() === '3,1,0', 'placed again they are made afresh, none twice');
  const sheets = new THREE.Group();
  sheets.add(new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.ShaderMaterial({ vertexShader: 'void main(){}', fragmentShader: 'void main(){}' })));
  s.world.add(sheets);
  ok(cap.placeNebulae(sheets) === 0, 'nebula sheets WebGPU does not draw yet (a shader material with no stand-in) are not copied');
  (sheets.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.Material>).material.userData.gpuStandIn = () => null;
  sheets.children[0].position.set(4000.5, 10, -1000);
  ok(cap.placeNebulae(sheets) === 1, 'and are copied once they are drawn');
  cap.clock.asked = true;
  s.world.updateMatrixWorld(true);
  cap.step(r, light);
  const sheetCopy = s.domeScene.children.filter((o) => o.userData.swgCaptureCopy === true).at(-1) as THREE.Mesh;
  const rel = new THREE.Vector3().setFromMatrixPosition(sheetCopy.matrixWorld);
  ok(rel.distanceTo(new THREE.Vector3(4000.5, 10, -1000).sub(s.group.position)) < 1e-9, 'a sheet fixed in the world is placed about the eye (the sky group, which rides the camera)');
  ok(cap.placePlanets(null) === 0 && cap.placeNebulae(null) === 0 && cap.counts().join() === '3,0,0' && !s.domeScene.children.includes(sheetCopy), 'and let go, their copies out of the scene');
  // A sky goes: nothing is drawn until the next.
  cap.detach();
  r.log.length = 0;
  cap.clock.asked = true;
  ok(cap.step(r, light) === null && r.log.length === 0, 'with no sky attached nothing is drawn');
  const s2 = makeSky();
  cap.attach(s2.domeScene, s2.group, s2.sun, s2.hemi, s2.domeMat, -10, [s2.glow]);
  ok(cap.counts().join() === '1,0,0' && cap.stats.scenes === 2, "a new sky's scene takes its own copies and lights, the last sky's left with its scene");
  ok(cap.clock.asked === true, 'an ask made with no sky attached waits for the next sky, never taken with nothing drawn');
  // A hold and its release.
  cap.hold();
  r.log.length = 0;
  for (let i = 0; i < 600; i++) cap.step(r, light);
  ok(r.log.length === 0, 'nothing is drawn while a hold stands (its pipelines landing)');
  cap.release();
  cap.step(r, light);
  ok(r.log.filter((l) => l.kind === 'render').length === 6, 'and its release takes everything at once');
  ok(DOME_CUBE === 128 && domeCap.stats.captures >= 8 && domeCap.stats.targetsMade === 1, `one kept target for every capture (${domeCap.stats.captures})`);
}

// ---------------------------------------------------------------- 4. our sky's discs in the capture
{
  const capture = { scene: { userData: { swgSkyCapture: true } } };
  const world = { scene: { userData: {} } };
  ok(discLeastRadius(world) === 0 && discMostLight(world) === 1e9, "in the world a disc is drawn as ever: spread to nothing, capped at a light no disc sends");
  ok(Math.abs(discLeastRadius(capture) - Math.PI / 180) < 1e-15 && discMostLight(capture) === 4, "in the capture spread to at least a degree of radius and capped at four times its light a steradian");
  tuneCapture({ sunDeg: 2, sunCap: 16 });
  ok(Math.abs(discLeastRadius(capture) - (2 * Math.PI) / 180) < 1e-15 && discMostLight(capture) === 16, 'both read off the dials as they move');
  reset();
  const sky = text('src/sky/air/airSky.ts');
  ok(/return top\.mul\(min\(shade\.div\(max\(area, 1e-12\)\), cap\)\.mul\(inside\)\);/.test(sky), "a disc's light a steradian is its own, at most the cap");
  // The sky and light fix round: each disc's radius times the Disc size dial (`DISC_TUNE.size`) before the capture's spread.
  ok(/disc\(d, n\.sunDir, max\(n\.sunRadius\.mul\(size\), capLeast\), n\.sunTop, limb, edge, capMost\)/.test(sky) && /disc\(d, n\.sun2Dir, max\(n\.sunRadius\.mul\(ratio\)\.mul\(size\), capLeast\), n\.sun2Top, limb, edge, capMost\)/.test(sky), 'both suns are sized by the Disc size dial, then spread and capped alike');
  ok(/onRenderUpdate\(discLeastRadius\)/.test(sky) && /onRenderUpdate\(discMostLight\)/.test(sky) && /setGroup\(renderGroup\)\.onRenderUpdate\(discLeastRadius\)/.test(sky), 'read once a render, in the shared render group, off the scene three draws');
  ok(!/\.mul\(drawn\)/.test(sky), 'and the discs are no longer left out of the capture');
}

// ---------------------------------------------------------------- 5. the dials
{
  ok(tuneCapture({ every: 0.01 }).join() === 'tune.every: held to 0.25' && CAPTURE_TUNE.every === 0.25, 'a number past its range is held to it, and said');
  ok(tuneCapture({ pace: 'sometimes' }).length === 1 && CAPTURE_TUNE.pace === 'faces', 'a pace that is not one of the two is refused');
  ok(tuneCapture({ nope: 1 }).join() === 'tune.nope: no such dial' && tuneCapture({ sunCap: 'x' }).join() === 'tune.sunCap: not a number', 'an unknown dial and a word for a number are refused');
  ok(tuneCapture('x').join() === 'tune: not a record', 'and a word for the record');
  reset();
  const set = captureDialsFor('reflections')!;
  ok(set.helper === 'reflections' && captureDialsFor('sky') === null, "the dials belong to `reflections`, the helper whose argument the menu's copied line is");
  const dials = set.groups.flatMap((g) => g.dials);
  ok(dials.map((d) => d.key).join() === 'tune.every,tune.sunMoveDeg,tune.pace,tune.sunDeg,tune.sunCap', `five dials (${dials.map((d) => d.key).join(', ')})`);
  ok(set.shipped.get('tune.every') === 4 && set.shipped.get('tune.pace') === 'faces' && set.shipped.get('tune.sunCap') === 4, 'shipped at the design\'s numbers');
  for (const d of dials) {
    if (d.kind === 'number') {
      const r = (CAPTURE_TUNE_RANGE as Record<string, readonly [number, number]>)[d.key.slice(5)];
      ok(d.min === r[0] && d.max === r[1], `${d.key}'s slider spans its range`);
      d.set(d.max);
      ok(d.get() === d.max, `${d.key} set through tuneCapture`);
    } else {
      d.set('once');
      ok(d.get() === 'once', `${d.key} set through tuneCapture`);
    }
  }
  reset();
}

// ---------------------------------------------------------------- 6. the world's wiring, as text
{
  const world = text('src/world/world.ts');
  const gpu = world.slice(world.indexOf('  private refreshEnvironmentGpu('), world.indexOf('  private useEnvironment('));
  ok(/const steps = env\.sky;\s*if \(!steps \|\| steps\.dome !== dome\) return;\s*if \(this\.envTimer >= 99\) \{\s*this\.envTimer = 0;\s*steps\.clock\.asked = true;\s*\}\s*steps\.clock\.dt = dt;\s*const captured = steps\.step\(this\.renderer as unknown as CaptureRenderer, this\.day\.lightDir\);\s*if \(captured\) this\.useEnvironment\(captured, null\);/.test(gpu), "WebGPU's refresh takes the sky through the stepped capture, an ask (the timer at 99) all at once, the kept target handed over");
  ok(!/camera\.update\(renderer, sky\.domeScene\)/.test(gpu), "and never by three's `CubeCamera.update` (six faces on one frame)");
  ok(/if \(this\.envHeld\) return;\s*\/\/ Pass 2, wave 2/.test(gpu) && /if \(usable && skyPack\)/.test(gpu), "a sky just hung still waits for its dome's pipeline, and the 'game' source's own cube is taken first, as before");
  const ready = world.slice(world.indexOf('  private gpuSkyReady('), world.indexOf('  private gpuDrawablesNow('));
  ok(/if \(steps\) this\.gpuCaptureParts\(steps, sky\);/.test(ready) && /steps\.compileWith\(\(\) => r\.compile\(sky\.domeScene, face, sky\.domeScene\)\)/.test(ready), "a sky hung gives the capture its copies before the dome's warm, which walks them all shown");
  ok(/steps\.attach\(sky\.domeScene, sky\.group, this\.sun, this\.hemi, dome\.material, dome\.order, sky\.captureSources\(\)\);\s*steps\.placePlanets\(this\.spaceBodies\);\s*steps\.placeNebulae\(this\.nebulae\?\.group \?\? null\);/.test(ready), "the sky's own drawables, the planets and the nebulae standing");
  ok(/steps\.hold\(\);\s*void rt\.compiledSince\(mark\)\.then\(\(\) => steps\.release\(\)\);/.test(ready), 'planets or nebulae hung later are built as they hang, the capture held until they land');
  ok(/this\.swgSky\?\.setSpaceOccluders\(discs\);\s*\/\/ Pass 2, wave 2 \(maker B\)[^\n]*\n\s*if \(GPU\.webgpu\) this\.gpuCaptureMore\(\);/.test(world) && /this\.scene\.add\(built\.group\);\s*\/\/ Pass 2, wave 2 \(maker B\)[^\n]*\n\s*if \(GPU\.webgpu\) this\.gpuCaptureMore\(\);/.test(world), 'the planets and the nebulae each ask for it as they hang, on WebGPU alone');
  // Pass 2, wave 4b (maker C): the planets' air (`spaceRims.ts`, shells hung in the planets' group) is let go between the
  // capture's copies and the group's removal: after the copies (which share the live materials), before the planets are freed.
  ok(/if \(GPU\.webgpu\) GPU\.rt!\.environment\.sky\?\.placePlanets\(null\);\s*\/\/ Pass 2, wave 4b \(maker C\)[^\n]*\n\s*if \(GPU\.webgpu\) this\.dropSpaceRims\(\);\s*this\.scene\.remove\(this\.spaceBodies\);/.test(world) &&/if \(GPU\.webgpu\) GPU\.rt!\.environment\.sky\?\.placeNebulae\(null\);\s*this\.scene\.remove\(nebulae\.group\);/.test(world) && /if \(GPU\.webgpu\) GPU\.rt!\.environment\.sky\?\.detach\(\);/.test(world), 'and their copies, and the sky\'s scene, are let go before what they draw is freed');
  const sky = text('src/world/sky.ts');
  const src = sky.slice(sky.indexOf('  captureSources(): THREE.Object3D[] {'), sky.indexOf('  get domeDraw()'));
  ok(/\.\.\.this\.sun, \.\.\.this\.supplementalSun, \.\.\.this\.moon, \.\.\.this\.supplementalMoon/.test(src) && /for \(const c of this\.celestials\) out\.push\(\.\.\.c\.sprites\);/.test(src) && /if \(this\.skybox\) out\.push\(this\.skybox\);/.test(src) && !/stars|dust|starQuads/.test(src.replace(/\/\/.*$/gm, '')), "the sky hands over its bodies and its skybox, never its stars, its dust or a zone's star quads");
  const env = text('src/core/gpu/gpuEnv.ts');
  ok(/dome = new DomeCapture\(domeGen as DomeFilter\);\s*sky = new SkyCapture\(dome\);/.test(env) && /domeGen\._boxMesh\.userData\.swgSkyFilter = true;/.test(env), "the capture is made with the session's one dome, the filter's draws named for the card's timer");
  const perf = text('src/core/gpu/framePerf.ts');
  ok(/if \(scene\?\.userData\?\.swgSkyCapture === true\) return 'sky capture: faces';/.test(perf) && /if \(scene\?\.userData\?\.swgSkyFilter === true\) return 'sky capture: filter';/.test(perf), "the card's timer names the faces and the filter");
  const envmap = text('src/world/envmap.ts');
  ok(/return globalThis\.localStorage\?\.getItem\('swg\.reflections'\) === 'game' \? 'game' : 'sky';/.test(envmap), "`localStorage['swg.reflections'] = 'game'` still gives the game's own cube maps");
  const main = text('src/main.ts');
  const chain = main.split('\n').find((l) => l.includes('dials: (helper) => vehicleDialsFor(helper)')) ?? '';
  ok(chain.includes('?? (GPU.webgpu ? captureDialsFor(helper) : null) ??') && /const tuned = opts\.tune === undefined \? \[\] : GPU\.webgpu \? tuneCapture\(opts\.tune\)/.test(main), "the dials are the debug menu's on WebGPU, set through `reflections({ tune })`");
}

console.log(`\nskyCaptureSteps: ${checks} checks passed`);
