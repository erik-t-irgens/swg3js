// The clouds' fill-in over frames, flight mode, the tiers' steps and the storm reach (the GPU port's pass 3, wave 2, maker T:
// `src/sky/clouds/cloudResolve.ts`, `cloudMarch.ts`' pass, `cloudTune.ts`' dials). The rules the card's graphs follow are run
// here as numbers (which pixel of a two by two is marched, flight mode, where a cloud stood last frame, the history's weight under
// motion, each layer's reach), the last frame's place held against three's own projection; the pass is driven over a stand-in
// renderer (what it draws into, in which order, and that entering flight mode builds nothing). Node builds no WGSL: what only
// the card runs is pinned as the files' text; the pictures are the browser's proof.
//
// Run: node tools/swg/tests/cloudReuse.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { CLOUD_LAYER_MAX, CLOUD_STACK_FLOATS, CLOUD_LAYER_VEC4, newCloudLayer, newStackFrame, packStack } from '../../../src/sky/clouds/cloudLayers.ts';
import { CLOUD_FEED, CLOUD_FLIGHT, CLOUD_TIER, CLOUD_TUNE, setCloudTier, setCloudsOn, traceSizeAt } from '../../../src/sky/clouds/cloudTune.ts';
import { CLOUD_REUSE_STATS, CLOUD_RU, TILE_ORDER, flightStep, historyUvInto, motionShareOf, newFlightState, subPixelOf } from '../../../src/sky/clouds/cloudResolve.ts';
import { CLOUD_FACE, CLOUD_U, GpuCloudPass, STORM_TYPES, writeReach } from '../../../src/sky/clouds/cloudMarch.ts';
import { TAA_MOTION_IN } from '../../../src/core/gpu/taa/taaGraphs.ts';
import { AIR } from '../../../src/sky/air/airApi.ts';
import { markSeeTarget } from '../../../src/sky/air/airSee.ts';
import { markMotionTarget } from '../../../src/core/gpu/motion.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string): string => readFileSync(join(here, '../../../src', p), 'utf8').replace(/\r\n/g, '\n');

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;

// ------------------------------------------------------------------------------------------------ which pixel is marched

{
  const flat = [40, 40.5, 41, 40.2];
  const seen = new Set<number>();
  for (let f = 0; f < 4; f++) seen.add(subPixelOf(f, 10, 6, flat, 0.08));
  ok(seen.size === 4, 'a tile with no depth edge marches each of its four pixels once in four frames');
  ok(subPixelOf(0, 10, 6, flat, 0.08) !== subPixelOf(0, 11, 6, flat, 0.08), 'two neighbouring tiles march different pixels on one frame (the checkerboard)');
  let diag = true;
  for (let f = 0; f < 4; f++) {
    const a = subPixelOf(f, 0, 0, flat, 0.08);
    const b = subPixelOf(f + 1, 0, 0, flat, 0.08);
    // In TILE_ORDER each frame's pixel stands diagonal or beside the last, never the same one twice running.
    diag = diag && a !== b;
  }
  ok(diag && TILE_ORDER.join() === '0,3,1,2', "the frame's order is a Bayer order (0, 3, 1, 2): never the same pixel twice running");
  // A roof against the sky: one sky pixel (the reach) and three roof pixels 30 m away.
  const edge = [30, 1e9, 30.2, 29.9];
  const picks: number[] = [];
  for (let f = 0; f < 12; f++) picks.push(subPixelOf(f % 12, 4, 4, edge, 0.08));
  const skyEvery = picks.map((p, i) => (p === 1 ? i : -1)).filter((i) => i >= 0);
  ok(skyEvery.length >= 5 && skyEvery.every((v, i) => i === 0 || v - skyEvery[i - 1] <= 2), `across a depth edge the far side (the sky) is marched every other frame (${picks.join(' ')})`);
  const roofs = new Set(picks.filter((p) => p !== 1));
  ok(roofs.size === 3, 'and each near pixel (the roof) in its turn, none left out');
  const march = src('sky/clouds/cloudMarch.ts');
  ok(march.includes('const inOrder = select(o4.lessThan(0.5), float(0), select(o4.lessThan(1.5), float(3), select(o4.lessThan(2.5), float(1), float(2))));') && march.includes('const wantFar = select(phase.add(checker).mod(2).lessThan(0.5), float(1), float(0))') && march.includes('const mm = kk.sub(nC.mul(floor(kk.div(nC))))'), "the march's graph is the same rule (its order, its far side on even frames, its turn within a side), as its text");
}

// ------------------------------------------------------------------------------------------------ flight mode

{
  const layers = [newCloudLayer('cumulus')];
  const f = newStackFrame();
  f.level = 2;
  f.groundY = 0;
  const stack = new Float32Array(CLOUD_STACK_FLOATS);
  const n = packStack(layers, f, stack);
  const lo = stack[0];
  const hi = stack[1];
  const s = newFlightState();
  const dt = 1 / 60;
  flightStep(s, true, (lo + hi) / 2, dt, stack, n);
  ok(flightStep(s, true, (lo + hi) / 2, dt, stack, n), `a ship inside a deck's band (${lo} to ${hi} m) is in flight mode`);
  const p = newFlightState();
  flightStep(p, false, (lo + hi) / 2, dt, stack, n);
  ok(!flightStep(p, false, (lo + hi) / 2, dt, stack, n), 'a pod or a speeder inside it never is');
  const c = newFlightState();
  const y0 = lo - 200;
  flightStep(c, true, y0, dt, stack, n);
  ok(flightStep(c, true, y0 + 40 * dt, dt, stack, n) && near(c.vy, 40, 1e-6), 'a ship 200 m under it climbing 40 m/s is (within 300 m, over 30 m/s)');
  const slow = newFlightState();
  flightStep(slow, true, y0, dt, stack, n);
  ok(!flightStep(slow, true, y0 + 20 * dt, dt, stack, n), 'climbing 20 m/s it is not');
  const far = newFlightState();
  flightStep(far, true, lo - 400, dt, stack, n);
  ok(!flightStep(far, true, lo - 400 + 40 * dt, dt, stack, n), '400 m under it, even fast, it is not');
  // Left: held `flightHold` seconds, then off.
  const h = newFlightState();
  flightStep(h, true, (lo + hi) / 2, dt, stack, n);
  let frames = 0;
  while (flightStep(h, true, lo - 1000, dt, stack, n) && frames < 1000) {
    frames++;
    h.lastY = lo - 1000;
  }
  ok(near(frames * dt, CLOUD_TUNE.flightHold, 2 * dt), `after its reason has gone it holds ${CLOUD_TUNE.flightHold} s (${frames} frames), then lets go`);
  layers[0].cover = [0, 0, 0, 0, 0];
  const clear = new Float32Array(CLOUD_STACK_FLOATS);
  const n2 = packStack(layers, f, clear);
  const e = newFlightState();
  ok(!flightStep(e, true, (lo + hi) / 2, dt, clear, n2), 'a deck clear at the level now is no deck to fly in');
  ok(src('main.ts').includes('CLOUD_FLIGHT.ship = !!(this.player.mounted ?? this.player.piloting)?.spec.ship || !!this.player.aboard;'), "the app says a ship is flown or boarded from the ship's own spec (a pod's is no ship)");
}

// ------------------------------------------------------------------------------------------------ where a cloud stood last frame

{
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 90000);
  cam.position.set(0, 0, 0);
  cam.rotation.set(0.1, 0.4, 0, 'YXZ');
  cam.updateMatrixWorld(true);
  const turnOf = (c: THREE.PerspectiveCamera): number[] => {
    const e = c.matrixWorld.elements;
    return [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]];
  };
  const tanOf = (c: THREE.PerspectiveCamera): number[] => {
    const ty = Math.tan((c.fov * Math.PI) / 360);
    return [ty * c.aspect, ty];
  };
  const out = [0, 0];
  const T0 = turnOf(cam);
  const t0 = tanOf(cam);
  historyUvInto(out, 0.3, -0.2, T0, t0, 4000, 0, 0, 1 / 60, [0, 0, 0], T0, t0);
  ok(near(out[0], 0.65, 1e-9) && near(out[1], 0.6, 1e-9), 'a still camera and a still cloud stand where they stood (the pixel itself)');
  // The camera turned and moved, the cloud drifting: last frame's place held against three's own projection by the old camera.
  const prev = cam.clone();
  prev.position.set(-3.5, 1.25, 2);
  prev.rotation.set(0.08, 0.37, 0, 'YXZ');
  prev.updateMatrixWorld(true);
  prev.updateProjectionMatrix();
  const dist = 2500;
  const v = [12, -7];
  const dt = 1 / 30;
  // The point now along the pixel's ray from the camera, less its drift, projected by three through the old camera.
  const ndc = new THREE.Vector3(-0.4, 0.25, 0.5).unproject(cam).sub(cam.position).normalize();
  const world = ndc.clone().multiplyScalar(dist).add(cam.position);
  world.x -= v[0] * dt;
  world.z -= v[1] * dt;
  const seen = world.clone().project(prev);
  const dc = [cam.position.x - prev.position.x, cam.position.y - prev.position.y, cam.position.z - prev.position.z];
  const front = historyUvInto(out, -0.4, 0.25, T0, t0, dist, v[0], v[1], dt, dc, turnOf(prev), tanOf(prev));
  ok(front && near(out[0], seen.x * 0.5 + 0.5, 1e-6) && near(out[1], 0.5 - seen.y * 0.5, 1e-6), `a cloud drifting under a turning, moving camera is found where three's projection by last frame's camera puts it (${out[0].toFixed(5)}, ${out[1].toFixed(5)})`);
  // Parallax: a sideways move shifts a near cloud more than a far one.
  const a = [0, 0];
  const b = [0, 0];
  historyUvInto(a, 0, 0, T0, t0, 300, 0, 0, dt, [5, 0, 0], T0, t0);
  historyUvInto(b, 0, 0, T0, t0, 30000, 0, 0, dt, [5, 0, 0], T0, t0);
  ok(Math.abs(a[0] - 0.5) > 50 * Math.abs(b[0] - 0.5), 'a sideways move shifts a cloud 300 m off a hundred times more than one 30 km off (each by its own distance)');
  const res = src('sky/clouds/cloudResolve.ts');
  ok(res.includes('const p = dir.mul(distM).sub(vec3(vel.x, 0, vel.y).mul(dt)).add(R.dc.xyz).toVar();') && res.includes('const c = transpose(R.prevTurn).mul(p).toVar();'), "the card's reprojection is the same rule (its drift taken off, the camera's move added, last frame's turn), as its text");
}

// ------------------------------------------------------------------------------------------------ the history's weight

{
  ok(motionShareOf(0) === 1 && motionShareOf(CLOUD_TUNE.motionFrom) === 1, 'a still point keeps its whole history');
  ok(near(motionShareOf(CLOUD_TUNE.motionTo), CLOUD_TUNE.motionKeep, 1e-9) && near(motionShareOf(100), CLOUD_TUNE.motionKeep, 1e-9), `a fast one keeps the keep's share (${CLOUD_TUNE.motionKeep})`);
  let mono = true;
  for (let x = 0; x < 20; x += 0.25) mono = mono && motionShareOf(x + 0.25) <= motionShareOf(x) + 1e-12;
  ok(mono, 'the weight only falls as the motion grows');
  const res = src('sky/clouds/cloudResolve.ts');
  ok(res.includes('const keep = mix(float(1), R.rd1.x, smoothstep(R.rd0.z, R.rd0.w, motionPx));') && res.includes('const boxOk = hk.greaterThanEqual(dLo.mul(float(1).sub(R.rd1.y)).sub(DIST_UNIT)).and(hk.lessThanEqual(dHi.mul(float(1).add(R.rd1.y)).add(DIST_UNIT)));'), "the resolve weighs it so, and drops a history whose cloud distance lies past the new rays' round it by over the share (the design's tenth), never one ray's alone");
  ok(res.includes('const held = onPic.and(h.front).and(distOk).and(endOk).and(R.ru.z.lessThan(0.5));'), 'and drops it whole at a reset, off the picture, behind last frame\'s camera, or where its ray now ends elsewhere');
  ok(res.includes('const Hn = vec4(H.rgb.mul(preRatioNode()), H.a)'), "last frame's light is brought to this frame's pre-exposure before it is used (the scene is stored pre-exposed)");
  ok(res.includes('const wNew = select(fresh, w.mul(R.rd0.x), select(quarter, w, w.mul(R.rd2.x)))'), 'a freshly marched pixel keeps only `history` of its history, so its moving jitter is averaged, not frozen');
}

// ------------------------------------------------------------------------------------------------ the tiers' steps and the storm reach

{
  setCloudTier('ultra');
  ok(CLOUD_TUNE.steps === 96 && CLOUD_TUNE.stepsHorizon === 192 && CLOUD_TUNE.lightExtra === 1 && CLOUD_TIER.name === 'ultra', 'Ultra: 96 steps looking up, 192 along the horizon, eight light steps (the design\'s 2.6)');
  setCloudTier('medium');
  ok(CLOUD_TUNE.steps === 64 && CLOUD_TUNE.stepsHorizon === 128 && CLOUD_TUNE.lightExtra === 0, 'Medium marches as High until the flat tiers come');
  setCloudTier('nonsense');
  ok(CLOUD_TIER.name === 'high' && CLOUD_TUNE.steps === 64, 'an unknown tier takes High');
  const layers = [newCloudLayer('cumulus'), newCloudLayer('cumulonimbus'), newCloudLayer('cirrus')];
  layers[0].types = ['cumulus', 'cumulonimbus'];
  layers[0].shares = [1, 0];
  const f = newStackFrame();
  f.level = 2;
  f.groundY = 0;
  const stack = new Float32Array(CLOUD_STACK_FLOATS);
  const n = packStack(layers, f, stack);
  const most = writeReach(CLOUD_U, stack, n);
  ok(CLOUD_U.rch[1].x === CLOUD_TUNE.stormReach && CLOUD_U.rch[0].x === CLOUD_TUNE.reach && CLOUD_U.rch[2].x === CLOUD_TUNE.reach, `a cumulonimbus layer reaches the storm reach (${CLOUD_TUNE.stormReach} m), a cumulus deck whose towers have no share now and a cirrus the reach (${CLOUD_TUNE.reach} m)`);
  ok(most === CLOUD_TUNE.stormReach, 'the ray runs to the farthest a drawn layer reaches');
  ok(near(CLOUD_U.rch[1].y, CLOUD_TUNE.stormReach * (1 - CLOUD_TUNE.fade) - 1, 1e-6), "each layer's fade begins the fade's share before its reach");
  ok(CLOUD_U.rch[1].z === stack[CLOUD_LAYER_VEC4 * 4] && CLOUD_U.rch[1].w === stack[CLOUD_LAYER_VEC4 * 4 + 1] && CLOUD_U.rch[5].z > CLOUD_U.rch[5].w, "each drawn layer's band is handed beside its reach (a slot not drawn stands its low past its high)");
  layers[0].shares = [0.5, 0.5];
  packStack(layers, f, stack);
  writeReach(CLOUD_U, stack, n);
  ok(CLOUD_U.rch[0].x === CLOUD_TUNE.stormReach && STORM_TYPES.length === 2, 'a deck whose storm towers have a share now reaches the storm reach');
  const march = src('sky/clouds/cloudMarch.ts');
  ok(march.includes('If(s1.w.greaterThan(0.5).and(y.greaterThan(s0.x)).and(y.lessThan(s0.y)).and(far.lessThan(rc.x)), () => {') && march.includes('const dd = float(d).mul(float(1).sub(smoothstep(rc.y, rc.x, far))).toVar('), 'the density reads a layer only within its reach and fades it out over the last of it');
  ok(march.includes('const a1 = min(max(ta, tb), min(maxT, rb));') && march.includes('const steps = int(mix(ST.y, ST.x, clamp(abs(dir.y).mul(2), 0, 1)));'), "a band reaches only as far as its farthest layer, and a ray's steps go from the horizon's to the overhead's as it looks up");
  setCloudTier('high');
}

// ------------------------------------------------------------------------------------------------ the pass over a stand-in renderer

{
  const depth = new THREE.DepthTexture(64, 36, THREE.FloatType);
  const target = new THREE.RenderTarget(64, 36, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: true, samples: 0, depthTexture: depth, count: 3 });
  target.texture.name = 'fx.scene';
  markMotionTarget(target);
  markSeeTarget(target);
  const keepTables = AIR.tables;
  AIR.tables = { nodes: {}, ready: true } as Any;
  AIR.frame.on = true;
  CLOUD_FACE.face = { sample() {}, weights() {}, slot() {}, typeSlot() {}, frame: null, band() {} } as Any;
  CLOUD_FACE.ready = () => true;
  const log: string[] = [];
  let compiles = 0;
  let into: Any = null;
  const r: Any = {
    reversedDepthBuffer: true,
    getRenderTarget: () => into,
    setRenderTarget(t: Any) {
      into = t;
    },
    render(mesh: Any) {
      log.push(`${mesh.name} into ${into?.textures?.[0]?.name ?? into?.texture?.name ?? 'out'}`);
    },
    compileAsync: () => {
      compiles++;
      return Promise.resolve();
    },
    compileComputeAsync: () => Promise.resolve(),
    compute() {},
  };
  const pass = new GpuCloudPass(r, target);
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 9000);
  camera.updateMatrixWorld(true);
  const ctx: Any = { renderer: r, near: 0.05, far: 9000, space: false, cameraUnderwater: false, cameraSubmerged: false, frame: 0, dt: 1 / 60, cameraCut: false, tanHalfFov: new THREE.Vector2(1.1, 0.6), camera };
  const input: Any = { width: 64, height: 36, texture: new THREE.Texture() };
  const output: Any = { width: 64, height: 36, texture: new THREE.Texture() };
  output.texture.name = 'out';
  const layers = [newCloudLayer('cumulus')];
  const f = newStackFrame();
  f.level = 2;
  f.groundY = 0;
  const stack = new Float32Array(CLOUD_STACK_FLOATS);
  const n = packStack(layers, f, stack);
  CLOUD_FEED.stack = stack;
  CLOUD_FEED.count = n;
  CLOUD_FEED.drift = new Float64Array(CLOUD_LAYER_MAX * 4);
  CLOUD_FEED.layers = layers;
  CLOUD_FEED.version = 1;
  setCloudsOn(true);
  const frame = (): boolean => {
    ctx.frame++;
    if (!pass.enabled(ctx)) return false;
    pass.prepare(ctx);
    return pass.render(ctx, input, output);
  };
  for (let i = 0; i < 40 && !pass.drewLast; i++) {
    frame();
    await new Promise((res) => setImmediate(res));
  }
  ok(pass.drewLast, 'on, with its parts landed, the pass draws');
  const items = pass.materials();
  ok(items.length === 5 && items.filter((x) => x.material.name === 'fx.gpu.clouds.march').length === 2 && items.some((x) => x.material.name === 'fx.gpu.clouds.resolve' && x.into) && items.some((x) => x.material.name === 'fx.gpu.clouds.motion'), 'the warm-up is handed the march against both its targets, the resolve against a history and the motion and composite against a chain buffer');
  log.length = 0;
  frame();
  ok(log[0] === 'fx.gpu.clouds.march into fx.gpu.clouds.quarter.0' && /^fx\.gpu\.clouds\.resolve into fx\.gpu\.clouds\.history[01]\.0$/.test(log[1]) && log[2] === 'fx.gpu.clouds.composite into out', `under the fill-in a quarter is marched, resolved into a history, then laid on the picture (${log.join('; ')})`);
  ok(pass.quarter.width === Math.ceil(pass.report().trace[0] / 2) && CLOUD_RU.ru.x === 1, "the quarter is half the trace's size each way");
  const phases = new Set<number>();
  for (let i = 0; i < 4; i++) {
    frame();
    phases.add(CLOUD_RU.ru.y);
  }
  ok(phases.size === 4 && [...phases].every((x) => x >= 0 && x < 12), "the frame's phase walks (twelve frames: four for a tile's order, three turns of a depth edge's side)");
  ok(CLOUD_RU.ru.z === 0, 'a steady frame keeps its history');
  ctx.cameraCut = true;
  frame();
  ok(CLOUD_RU.ru.z === 1, 'a cut (`postfx.reset()`) takes nothing from it');
  ctx.cameraCut = false;
  frame();
  ok(CLOUD_RU.ru.z === 0, 'and the frame after gathers again');
  ctx.frame += 5;
  frame();
  ok(CLOUD_RU.ru.z === 1, 'a frame the clouds did not draw resets it too');
  // Into flight mode: a ship inside the deck. Nothing is compiled, the whole trace is marched at its smaller size.
  const before = compiles;
  CLOUD_FLIGHT.ship = true;
  camera.position.y = (stack[0] + stack[1]) / 2;
  camera.updateMatrixWorld(true);
  log.length = 0;
  frame();
  const ws = [0, 0];
  traceSizeAt(64, 36, CLOUD_TUNE.flightTrace, ws);
  ok(CLOUD_FLIGHT.on && log[0] === 'fx.gpu.clouds.march into fx.gpu.clouds.trace.0' && /^fx\.gpu\.clouds\.resolve into fx\.gpu\.clouds\.history[01]\.0$/.test(log[1]) && log[2] === 'fx.gpu.clouds.composite into out' && CLOUD_RU.ru.x === 0, `in flight mode the whole trace is marched, every texel new, and resolved with flight's short history (${log.join('; ')})`);
  ok(pass.whole.width === ws[0] && pass.whole.height === ws[1] && CLOUD_RU.qs.x === ws[0] && CLOUD_RU.ct.x === pass.report().trace[0], `at flight mode's smaller size (${ws[0]} by ${ws[1]}), which the resolve reads and lays at the trace's`);
  ok(compiles === before && CLOUD_REUSE_STATS.flightEntered >= 1 && CLOUD_RU.ru.z === 0, "entering flight mode compiles nothing (its target is the march's one kind, warmed at the build) and keeps the history");
  ok(src('sky/clouds/cloudResolve.ts').includes('const wNew = select(fresh, w.mul(R.rd0.x), select(quarter, w, w.mul(R.rd2.x))).toVar('), "in flight mode every pixel keeps only flight's own short history (`flightHistory`, 0 the design's nothing reused)");
  CLOUD_FLIGHT.ship = false;
  camera.position.y = 40;
  camera.updateMatrixWorld(true);
  frame();
  ok(!CLOUD_FLIGHT.on && CLOUD_RU.ru.x === 1, 'leaving it (a pod never stays) the fill-in takes over');
  // The fill-in off (`reuse` 0): every pixel each frame, read as it is (wave 1's way), and back again from nothing.
  CLOUD_TUNE.reuse = 0;
  log.length = 0;
  frame();
  ok(log.length === 2 && log[0] === 'fx.gpu.clouds.march into fx.gpu.clouds.trace.0' && log[1] === 'fx.gpu.clouds.composite into out', `with the fill-in off the whole trace is marched and laid on as it is (${log.join('; ')})`);
  CLOUD_TUNE.reuse = 1;
  frame();
  ok(CLOUD_RU.ru.x === 1 && CLOUD_RU.ru.z === 1, 'turned back on, the fill-in starts again from nothing');
  ok(TAA_MOTION_IN.frame !== ctx.frame, 'with no edge smoothing drawing, the clouds lay no motion for it');
  setCloudsOn(false);
  pass.dispose();
  AIR.tables = keepTables;
  CLOUD_FEED.stack = null;
}

// ------------------------------------------------------------------------------------------------ the edge smoothing reads the clouds' motion

{
  const taa = src('core/gpu/taa/taaPass.ts');
  const graphs = src('core/gpu/taa/taaGraphs.ts');
  ok(taa.includes('u.motionIn!.value = TAA_MOTION_IN.frame === ctx.frame ? TAA_MOTION_IN.value : null;') && graphs.includes('motion: u.motionIn ? liveTexture(u.motionIn, u.motion) : texture(u.motion),'), "the edge smoothing reads the clouds' motion on a frame they laid it, the scene's own on any other");
  const res = src('sky/clouds/cloudResolve.ts');
  ok(res.includes('const react = cover.mul(R.rd1.z).mul(float(1).sub(R.ru.x));') && res.includes('return vec4(mix(mv.xy, cmv, cover), mv.z, max(mv.w, react));'), "the clouds' motion is laid over the scene's by what the cloud covers, the reactive mark raised under cloud only where the trace was marched whole");
  const r = { ...CLOUD_TUNE };
  ok(r.reuse === 1 && r.history === 0.8 && r.flightTrace === 0.3 && r.flightHistory === 0.5 && r.reactive === 0.05 && r.stormReach === 80_000 && r.reach === 50_000 && r.fade === 0.2, "the starts: the fill-in on, history 0.8, flight's trace 0.3 and its history 0.5, the mark 0.05, the storm reach 80 km against 50 km, the fade a fifth");
}

console.log(`\ncloudReuse: ${checks} checks passed`);
process.exit(0);
