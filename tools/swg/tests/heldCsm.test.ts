// The GPU port's pass 1, wave 3 (`A:\swg3js\port\PASS1-W3.md`), in node: the sun's middle and far cascades held by age on
// WebGPU (`src/core/gpu/heldCsm.ts`). The game's own `makeSun` (`sun.ts`) over a stand-in renderer, the world's own holds
// (`shadowCadence.ts`) handed to it as `World.attachCamera` hands them, the classic cascades the world keeps beside it,
// three's own `CSMShadowNode` fit, and three's own `ShadowBaseNode.updateBefore` deciding each cascade's draw; only the draw
// itself is stood in (`ShadowNode.updateShadow`: what a reader can see of it, `shadow.updateMatrices`, is kept).
//
//  1. what is made: the held node at three's development commit, three's plain node's words at any other; each cascade's
//     `updateShadow` wrapped once, for good; the holds bound to the node's own cascade lights; before they are handed over
//     the node is three's own;
//  2. decided once a game frame: however many renders light with the sun (and the warm-up's precompiles among them),
//     `decide` runs once a frame and the ages and the stagger advance once (at 144 Hz the far map every sixth frame and the
//     middle every second, four renders a frame drawing exactly what one does), and no light moves after the first;
//  3. held lights put back for the port's readers: a held cascade's light, target and world matrix stand where its map was
//     drawn, its `shadow.matrix` is the one its map was drawn with, and the occlusion's cascades (`fillFx`) read that;
//  4. `drawn` through the permanent wraps: each draw recorded at the pose three drew it from, a cascade asked for and never
//     drawn (three draws a map once a camera a frame) dirty at the next frame, and the frame report's own timing wrap (the
//     real `gpuFramePerf`) laid over the permanent one counts the same draws and leaves it in place;
//  5. the switch and the sliders: `cadence` false draws every cascade every frame with nothing put back, a `dirtyAll` of the
//     world's reaches the node's lights, and the debug menu's own age dial reaches the next decision;
//  6. fast movers: a hull at speed in the far band draws the far map that frame ('mover');
//  7. the coverage proof made again against this node's own fit: the classic proof's 15,552 holds (three suns, three
//     rates, three ages, eight motions, twelve headings, three pitches, the middle and the far cascade), with the game's own
//     splits and with three's practical split to compare. Wherever a hold passes, every ground sample of the band this
//     node's own shader samples the cascade over (its linear depth counted from the camera's near plane, its last cascade
//     ending at the shadow distance) that the fresh box holds the held box holds, none lies past the held map's deep end,
//     the held light is never more than `coverHigh` nearer the slice, a fresh fit always passes, and the real `decide`,
//     reached through the adapter, answers every hold as `holdCovers` does over three's own matrices of this node (an exact
//     tie on the cover line apart); the refusals by their own reasons; the schedule turning at 90 degrees a second;
//  8. nothing allocated in a frame: the adapter's own work (three's fit stood in by its own poses, recorded), and the whole
//     frame with three's fit against three's plain node doing the same, in twelve fresh processes at once (`--alloc`).
//
// Everything is synthetic: the game's camera and cascade numbers, nothing read from the game's files.
// Run: node tools/swg/tests/heldCsm.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { ShadowNode } from 'three/webgpu';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { SHADOW_PASS_TUNE, ShadowHold, ShadowMovers, bandCorners, cascadeBand, holdCovers, shadowCameraFar, type ShadowReason } from '../../../src/world/shadowCadence.ts';
import { SHADOW_SPLIT_TUNE, splitBreaks } from '../../../src/world/shadowSplits.ts';
import { followCameraDepth } from '../../../src/world/csmDepth.ts';
import { createFxLights } from '../../../src/core/fx/lights.ts';
import { HELD_CSM_REVISION, HeldCsmShadowNode, heldCsmApplies } from '../../../src/core/gpu/heldCsm.ts';
import { makeSun } from '../../../src/core/gpu/sun.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const ALLOC = process.argv.includes('--alloc');
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  if (!ALLOC) console.log(`ok   ${msg}`);
};

// Three's draw stood in: the one thing of it a reader of the cascades sees, the sampling matrix written as the map is drawn.
// `DRAW.matrices` false (the allocation child's adapter window) counts the draw and writes nothing.
const DRAW = { matrices: true, n: 0 };
(ShadowNode.prototype as Any).updateShadow = function (this: Any): void {
  DRAW.n++;
  if (DRAW.matrices) this.shadow.updateMatrices(this.light);
};
/** Three's own fit (`CSMShadowNode.updateBefore`), kept before any stand-in. */
const THREE_FIT = (CSMShadowNode.prototype as Any).updateBefore as (this: Any, frame: Any) => unknown;

const TUNE0 = { ...SHADOW_PASS_TUNE, maxAgeMs: [...SHADOW_PASS_TUNE.maxAgeMs] };
const resetTune = (): void => {
  Object.assign(SHADOW_PASS_TUNE, { ...TUNE0, maxAgeMs: SHADOW_PASS_TUNE.maxAgeMs });
  SHADOW_PASS_TUNE.maxAgeMs.splice(0, SHADOW_PASS_TUNE.maxAgeMs.length, ...TUNE0.maxAgeMs);
};
const ages = (...a: number[]): void => {
  SHADOW_PASS_TUNE.maxAgeMs.splice(0, SHADOW_PASS_TUNE.maxAgeMs.length, ...a);
};

const MAX_FAR = 320;
const LIGHT_MARGIN = 150;
const ASPECT = 1600 / 900;
const SUNS: Record<string, THREE.Vector3> = {
  high: new THREE.Vector3(0.4, 0.82, -0.2).normalize(),
  noon: new THREE.Vector3(0.83, 0.51, -0.21).normalize(),
  low: new THREE.Vector3(0.96, 0.17, -0.2).normalize(),
};
const NOON = SUNS.noon;
const rad = THREE.MathUtils.degToRad;

/**
 * The world's cascades on WebGPU as `World.attachCamera` makes them: the classic `CSM` (the game's splits, fade, reach,
 * margin, `followCameraDepth`, each shadow camera's depth by `shadowCameraFar`), then the game's sun (`makeSun`, which turns
 * the camera reversed and fits three's node), then the world's holds handed to it with the frame's movers.
 */
function stage(split: 'custom' | 'practical' = 'custom') {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, ASPECT, 0.05, 9000);
  const tune = split === 'custom' ? SHADOW_SPLIT_TUNE : { ...SHADOW_SPLIT_TUNE, scheme: 'practical' as const };
  const splits = (amount: number, near: number, far: number, target: number[]): void => splitBreaks(amount, near, far, tune, target);
  const csm = new CSM({ camera, parent: scene, cascades: 3, maxFar: MAX_FAR, mode: 'custom', customSplitsCallback: splits, shadowMapSize: 2048, lightDirection: new THREE.Vector3(0.3, -1, 0.2).normalize(), lightIntensity: 2, lightMargin: LIGHT_MARGIN, lightNear: 1, lightFar: LIGHT_MARGIN + MAX_FAR });
  csm.fade = true;
  followCameraDepth(csm as Any, camera);
  for (const l of csm.lights) {
    l.shadow.camera.near = 1;
    l.shadow.camera.far = shadowCameraFar('whole', LIGHT_MARGIN, MAX_FAR, l.shadow.camera.right - l.shadow.camera.left);
    l.shadow.camera.updateProjectionMatrix();
    l.visible = false;
  }
  const renderer = { coordinateSystem: THREE.WebGPUCoordinateSystem, reversedDepthBuffer: true, shadowMap: { enabled: true } };
  const sun = makeSun(renderer, scene, camera, { maxFar: MAX_FAR, mapSize: 2048, lightMargin: LIGHT_MARGIN, splits });
  const node = sun.node as HeldCsmShadowNode;
  const lights = node.lights as unknown as THREE.DirectionalLight[];
  // Three makes a cascade's map at its first build; a stand-in with a compare says each has one, as the effects read it.
  for (const l of lights) (l.shadow as Any).map = { depthTexture: { compareFunction: THREE.LessEqualCompare } };
  const hold = new ShadowHold();
  hold.bind(csm.lights);
  const movers = new ShadowMovers();
  const counted = { calls: 0, drawn: 0, refused: 0 };
  const holds = sun.hold(hold, movers, (d, r) => {
    counted.calls++;
    counted.drawn += d;
    counted.refused += r;
  });
  const nodes = (node as Any)._shadowNodes as Any[];
  const frame = { renderer: { _precompilationState: null as unknown, _callDepth: 0 }, frameId: 0, camera, scene };
  const pre = { renderer: { _precompilationState: {} as unknown, _callDepth: 0 }, frameId: 0, camera, scene };
  /** One render that lights with the sun: the node's `updateBefore` first (its `build` order), then each cascade's. */
  const render = (freshFrame: boolean): void => {
    if (freshFrame) frame.frameId++;
    node.updateBefore(frame as Any);
    for (let i = 0; i < nodes.length; i++) nodes[i].updateBefore(frame);
  };
  const precompile = (): void => {
    node.updateBefore(pre as Any);
  };
  /** `World.updateShadows` on WebGPU: the classic fit, the arm where WebGL decides, the sun's sync. */
  const world = (toSun: THREE.Vector3, now: number): void => {
    csm.lightDirection.copy(toSun).negate();
    csm.update();
    sun.arm(now);
    sun.sync(csm, camera, true);
  };
  return { scene, camera, csm, sun, node, lights, hold, movers, counted, holds, nodes, frame, render, precompile, world, renderer };
}
type Stage = ReturnType<typeof stage>;

const pose = (camera: THREE.PerspectiveCamera, yawDeg: number, pitchDeg: number, z: number): void => {
  camera.position.set(0, 1.8, z);
  camera.rotation.set(rad(pitchDeg), rad(yawDeg), 0, 'YXZ');
  camera.updateMatrixWorld();
};
const sameMatrix = (a: THREE.Matrix4, b: THREE.Matrix4): boolean => a.elements.every((v, i) => v === b.elements[i]);

// ---------------------------------------------------------------- 8 (child). what a frame allocates, in a process of its own
if (ALLOC) {
  const v8 = await import('node:v8');
  const { PerformanceObserver } = await import('node:perf_hooks');
  const gc = (globalThis as Any).gc as (o?: unknown) => void;
  let collections = 0;
  new PerformanceObserver((l) => (collections += l.getEntries().length)).observe({ entryTypes: ['gc'] });
  const young = (): number => v8.getHeapSpaceStatistics().find((x) => x.space_name === 'new_space')!.space_used_size;
  const turn = (): Promise<void> => new Promise((r) => setImmediate(r));
  /**
   * The least of three windows no collection fell inside, after the call is warmed over turns of the event loop. The
   * adapter's frame is warmed long and measured over long windows: a path that runs on one frame in five (a fast mover's)
   * is optimised last, and 5,000 frames in it still read 4.4 B a frame where 40,000 read the harness's own floor.
   */
  const measure = async (step: () => void, n: number, warmTurns: number, warmSteps: number): Promise<number | null> => {
    for (let t = 0; t < warmTurns; t++) {
      for (let i = 0; i < warmSteps; i++) step();
      await turn();
    }
    let best: number | null = null;
    let clean = 0;
    for (let tries = 0; tries < 12 && clean < 3; tries++) {
      gc({ type: 'minor' });
      await turn();
      await turn();
      const c0 = collections;
      const b = young();
      for (let i = 0; i < n; i++) step();
      const a = young();
      await turn();
      await turn();
      if (collections !== c0) continue;
      clean++;
      const per = (a - b) / n;
      if (best === null || per < best) best = per;
    }
    return best;
  };
  resetTune();
  const s = stage('custom');
  const cam = s.camera;
  // The view turning a little each frame and now and then a big step the guards refuse, recorded once: each pose's camera
  // matrix and three's own fit of it, so a frame hands nothing across a call to make a pose.
  const K = 240;
  const turns: THREE.Matrix4[] = [];
  const fits = new Float64Array(K * 3 * 6);
  s.csm.lightDirection.copy(NOON).negate();
  for (let k = 0; k < K; k++) {
    pose(cam, 40 + k * 0.25 + (k % 61 === 0 ? 30 : 0), -10, -k * 0.02);
    turns.push(cam.matrixWorld.clone());
    s.sun.sync(s.csm, cam, true);
    THREE_FIT.call(s.node, s.frame);
    for (let i = 0; i < 3; i++) {
      const l = s.lights[i];
      const o = (k * 3 + i) * 6;
      fits[o] = l.position.x;
      fits[o + 1] = l.position.y;
      fits[o + 2] = l.position.z;
      fits[o + 3] = l.target.position.x;
      fits[o + 4] = l.target.position.y;
      fits[o + 5] = l.target.position.z;
    }
  }
  const at = new Int32Array(1);
  // Three's fit stood in by the pose recorded for this frame: what the adapter adds is all a window then holds.
  const standInFit = function (this: Any): void {
    const k = at[0];
    for (let i = 0; i < 3; i++) {
      const l = this.lights[i];
      const o = (k * 3 + i) * 6;
      l.position.set(fits[o], fits[o + 1], fits[o + 2]);
      l.target.position.set(fits[o + 3], fits[o + 4], fits[o + 5]);
      l.updateMatrixWorld();
      l.target.updateMatrixWorld();
    }
  };
  ages(0, 13, 41);
  let f = 0;
  const m = s.movers;
  const step = (renders: number): void => {
    f++;
    at[0] = f % K;
    cam.matrixWorld.copy(turns[at[0]]);
    // Now and then a fast hull 150 m ahead, which the far guard meets.
    m.begin();
    if (f % 50 < 10) {
      const j = m.take();
      m.x[j] = 0;
      m.y[j] = 1.5;
      m.z[j] = -150;
      m.r[j] = 2;
      m.ground[j] = 0;
      m.speed[j] = 40;
    }
    s.sun.arm(f * 7);
    s.sun.sync(s.csm, cam, true);
    s.render(true);
    if (renders > 1) {
      s.precompile();
      for (let r = 1; r < renders; r++) s.render(false);
    }
  };
  // (a) The adapter's own work: three's fit stood in, three's draw counted and nothing written.
  (CSMShadowNode.prototype as Any).updateBefore = standInFit;
  DRAW.matrices = false;
  const adapter = await measure(() => step(4), 20000, 40, 1000);
  // (b) The whole frame, three's fit and three's matrices written as it draws, one render a frame; against three's plain node
  // doing the same render (the holds taken off, every cascade asked every frame).
  (CSMShadowNode.prototype as Any).updateBefore = THREE_FIT;
  DRAW.matrices = true;
  const real = (): void => {
    f++;
    pose(cam, 40 + (f % 400) * 0.2, -10, 0);
    s.sun.arm(f * 7);
    s.sun.sync(s.csm, cam, true);
    s.render(true);
  };
  const whole = await measure(real, 2000, 10, 500);
  s.hold.dirtyAll();
  const keep = s.node._held;
  s.node._held = null;
  const base = await measure(real, 2000, 10, 500);
  s.node._held = keep;
  process.stdout.write(`${JSON.stringify({ adapter, whole, base, decisions: s.hold.decisions })}\n`);
  process.exit(0);
}

// ---------------------------------------------------------------- 1. what is made
{
  resetTune();
  ok(THREE.REVISION === HELD_CSM_REVISION && heldCsmApplies(THREE.REVISION) === null, `three is r${THREE.REVISION}, the revision the held node was read against`);
  ok(/three is r188, the held cascades were read against r188dev/.test(heldCsmApplies('188') ?? ''), 'at any other revision (the release 0.188.0 included) the node is three\'s plain one, said in words');
  const s = stage();
  ok(s.node instanceof HeldCsmShadowNode && s.sun.holds && s.sun.notHeld === null && s.holds, "makeSun makes the held node and the holds are handed to it");
  ok(s.hold.lights === (s.node.lights as unknown) && s.hold.clock.n === 3, "the world's holds are bound to the node's own three cascade lights, not the classic ones");
  ok(s.lights.every((l) => l.shadow.autoUpdate === true), 'handed over, every cascade is due (dirty) at the first decision');
  const own = s.nodes.map((n) => n.updateShadow);
  ok(s.nodes.length === 3 && s.nodes.every((n) => Object.prototype.hasOwnProperty.call(n, 'updateShadow') && n._heldWrapped === true), "each cascade's updateShadow is wrapped once, an own field of its shadow node");
  (s.node as Any)._heldWrap();
  ok(s.nodes.every((n, i) => n.updateShadow === own[i]), 'and wrapping again changes nothing');
  ok(Object.keys(s.node).filter((k) => k.startsWith('_held')).length >= 8 && !Object.keys(s.node).some((k) => /^held/.test(k)), "the node's own fields all begin with `_held`, which three's walk for child nodes steps over");
  // Before the holds are handed over the node is three's own: every call fits, a precompile's too.
  const plain = stage();
  plain.node._held = null;
  pose(plain.camera, 30, -10, 0);
  plain.sun.sync(plain.csm, plain.camera, true);
  plain.precompile();
  const a = plain.lights[2].position.clone();
  pose(plain.camera, 60, -10, 0);
  plain.precompile();
  ok(!plain.lights[2].position.equals(a), "with no holds the node fits at every call, as three's does (a precompile's included)");
}

// ---------------------------------------------------------------- 2. decided once a game frame
{
  const once = (renders: (f: number) => number): { decisions: number; renders: number; precompiles: number; draws: number[]; both: number; moved: number; frames: number; decidedEach: boolean; countedEach: boolean } => {
    resetTune();
    ages(0, 13, 41);
    const s = stage();
    pose(s.camera, 40, -10, 0);
    const N = 1440;
    const d0 = s.hold.decisions;
    let decidedEach = true;
    let moved = 0;
    let both = 0;
    const draws = [0, 0, 0];
    const after = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    for (let f = 0; f < N; f++) {
      const now = (f * 1000) / 144;
      s.world(NOON, now);
      const before = s.hold.decisions;
      const counts = Array.from(s.node._heldCounts.draws);
      const n = renders(f);
      for (let r = 0; r < n; r++) {
        if (r === 1) s.precompile();
        s.render(r === 0);
        if (r === 0) for (let i = 0; i < 3; i++) after[i].copy(s.lights[i].position);
        else for (let i = 0; i < 3; i++) if (!s.lights[i].position.equals(after[i])) moved++;
      }
      if (s.hold.decisions !== before + 1) decidedEach = false;
      let far = 0;
      for (let i = 0; i < 3; i++) {
        const d = s.node._heldCounts.draws[i] - counts[i];
        draws[i] += d;
        if (i > 0 && d > 0 && s.hold.reason[i] === 'age') far++;
      }
      if (far > 1) both++;
    }
    const c = s.node._heldCounts;
    return { decisions: s.hold.decisions - d0, renders: c.renders, precompiles: c.precompiles, draws, both, moved, frames: N, decidedEach, countedEach: s.counted.calls === c.decisions };
  };
  const one = once(() => 1);
  const many = once((f) => 1 + (f % 4));
  ok(one.decidedEach && many.decidedEach && one.decisions === one.frames && many.decisions === many.frames, `decide runs once a game frame however many renders light with the sun (${many.decisions} decisions over ${many.frames} frames of 1 to 4 renders, ${many.renders} renders and ${many.precompiles} precompiles reaching the node)`);
  ok(many.renders === 2.5 * many.frames && many.precompiles === 0.75 * many.frames, 'every render reached the node and every precompile changed nothing');
  ok(many.moved === 0, `no cascade light moves after the frame's first render, the precompiles' included (${many.moved})`);
  ok(one.draws[0] === one.frames && Math.abs(one.draws[2] - one.frames / 6) <= one.frames / 60 && one.draws[1] >= one.frames / 3 && one.draws[1] <= one.frames / 2 + 1, `at 144 Hz standing, the near map every frame, the far every sixth (${one.draws[2]} of ${one.frames}) and the middle every second (${one.draws[1]}), as WebGL's`);
  ok(many.draws.join() === one.draws.join(), `four renders a frame draw exactly what one does (${many.draws.join(', ')} against ${one.draws.join(', ')}): the ages and the stagger count once a frame`);
  ok(one.both === 0 && many.both === 0, 'and the middle and far maps are never both drawn by age on one frame (the stagger)');
  ok(one.countedEach && many.countedEach, "every decision is counted for the frame report (the world's two counters)");
}

// ---------------------------------------------------------------- 3. held lights put back for the port's readers
{
  resetTune();
  ages(0, 1e6, 1e6);
  const s = stage();
  pose(s.camera, 40, -10, 0);
  s.hold.dirtyAll();
  s.world(NOON, 1000);
  s.render(true);
  ok(s.hold.reason.slice(0, 3).every((r) => r === 'first'), 'handed over, every cascade is drawn at the first decision (first)');
  const drawnPos = s.lights.map((l) => l.position.clone());
  const drawnTgt = s.lights.map((l) => l.target.position.clone());
  const drawnWorld = s.lights.map((l) => l.matrixWorld.clone());
  const drawnMatrix = s.lights.map((l) => l.shadow.matrix.clone());
  // The camera moves a little: three's own fit would move every light.
  pose(s.camera, 40.5, -10, -0.1);
  s.sun.sync(s.csm, s.camera, true);
  THREE_FIT.call(s.node, s.frame);
  const fresh = s.lights.map((l) => l.position.clone());
  s.world(NOON, 1010);
  s.render(true);
  ok(s.hold.reason[0] === 'age' && s.hold.reason[1] === 'held' && s.hold.reason[2] === 'held', `the near cascade drawn, the middle and far held (${s.hold.reason.slice(0, 3).join(' ')})`);
  ok(!fresh[1].equals(drawnPos[1]) && !fresh[2].equals(drawnPos[2]), "three's fit had moved the held lights, so the hold is what keeps them");
  ok([1, 2].every((i) => s.lights[i].position.equals(drawnPos[i]) && s.lights[i].target.position.equals(drawnTgt[i]) && sameMatrix(s.lights[i].matrixWorld, drawnWorld[i])), "each held light and target stand where its map was drawn, its world matrix with them");
  ok([1, 2].every((i) => sameMatrix(s.lights[i].shadow.matrix, drawnMatrix[i])), "each held cascade's shadow.matrix, which the receivers read by reference, is element for element the one its map was drawn with");
  ok(s.lights[0].position.equals(fresh[0]) && !sameMatrix(s.lights[0].shadow.matrix, drawnMatrix[0]), 'the near cascade, due, takes the fresh fit and is drawn from it');
  const fx = createFxLights();
  s.sun.fillFx(fx.sky, s.csm, s.renderer, MAX_FAR - s.camera.near);
  const c = fx.sky.cascades;
  ok(c.count === 3 && sameMatrix(c.matrices[1], drawnMatrix[1]) && sameMatrix(c.matrices[2], drawnMatrix[2]) && sameMatrix(c.matrices[0], s.lights[0].shadow.matrix), "the occlusion's cascades (fillFx) read the held maps' own matrices and the near map's fresh one");
  // A later render of the frame (the doorways', the weather's) moves nothing back to the fit.
  s.render(false);
  ok([1, 2].every((i) => s.lights[i].position.equals(drawnPos[i])), 'a later render of the same frame leaves every held light where its map was drawn');
}

// ---------------------------------------------------------------- 4. drawn through the permanent wraps, and the frame report's
{
  resetTune();
  ages(0, 13, 41);
  const s = stage();
  pose(s.camera, 40, -10, 0);
  // Each draw recorded at the pose three drew it from, when the decision that asked for it was made.
  s.world(NOON, 2000);
  const d0 = DRAW.n;
  s.render(true);
  ok(DRAW.n - d0 === 3 && [0, 1, 2].every((i) => s.hold.pos[i].equals(s.lights[i].position) && s.hold.clock.drawnAt[i] === 2000 && s.hold.clock.valid[i] === 1), "every draw three made is recorded at the pose it was drawn from and the decision's time");
  // A cascade asked for and never drawn: a second game frame inside one of three's frames (three draws a map once a camera a
  // frame), then the next frame finds it dirty.
  s.world(NOON, 2007);
  const d1 = DRAW.n;
  s.render(false);
  ok(DRAW.n === d1 && s.hold.reason[0] === 'age' && s.lights[0].shadow.needsUpdate === true, 'a decision inside a frame three has already drawn asks for the near map and three draws nothing');
  s.world(NOON, 2014);
  s.render(true);
  ok(s.hold.reason[0] === 'dirty', `the next frame finds it asked and never drawn, and draws it (${s.hold.reason[0]})`);
  // A dirtyAll made after a draw stands: the next arm records nothing over it.
  s.hold.dirtyAll();
  s.world(NOON, 2021);
  s.render(true);
  ok(s.hold.reason.slice(0, 3).every((r) => r === 'dirty'), 'a dirtyAll made between frames stands: every cascade is drawn at the next decision');
  // The frame report's own timing wrap (the real gpuFramePerf) over the permanent one.
  const { gpuFramePerf } = await import('../../../src/core/gpu/framePerf.ts');
  const { perf } = await import('../../../src/core/perf.ts');
  const permanent = s.nodes.map((n) => n.updateShadow);
  let ended = 0;
  const report = gpuFramePerf({}, { ended: () => ended, cascadeNodes: () => s.nodes, switches: () => ({}), timer: {} as Any }, { frames: 8, noCount: true });
  const laid = s.nodes.every((n, i) => n.updateShadow !== permanent[i]);
  const h0 = Array.from(s.node._heldCounts.draws);
  const t0 = DRAW.n;
  let t = 3000;
  for (let f = 0; f < 16; f++) {
    perf.frameStart(t);
    s.world(NOON, t);
    s.render(true);
    t += 7;
    perf.frameEnd(t, 0);
    ended++;
  }
  const out = (await report) as Any;
  const heldDraws = s.node._heldCounts.draws.reduce((a, b, i) => a + (i < 3 ? b - h0[i] : 0), 0);
  ok(laid && s.nodes.every((n, i) => n.updateShadow === permanent[i] && Object.prototype.hasOwnProperty.call(n, 'updateShadow')), "the frame report's timing wrap lies over the permanent one while it times and puts it back after, an own field still");
  ok(heldDraws === DRAW.n - t0 && out.mainThread && out.mainThread.cascadesDrawn > 0, `the hold was told every draw made while the report timed (${heldDraws} of ${DRAW.n - t0}), and the report counted them (${out.mainThread?.cascadesDrawn} a frame)`);
}

// ---------------------------------------------------------------- 5. the switch, the world's dirtyAll and the sliders
{
  resetTune();
  ages(0, 13, 41);
  const s = stage();
  SHADOW_PASS_TUNE.cadence = false;
  s.hold.dirtyAll();
  let everyFrame = true;
  let putBack = false;
  const N = 200;
  for (let f = 0; f < N; f++) {
    pose(s.camera, 40 + f * 0.6, -10, -f * 0.05);
    s.world(NOON, f * 7);
    const d = Array.from(s.node._heldCounts.draws);
    s.render(true);
    for (let i = 0; i < 3; i++) if (s.node._heldCounts.draws[i] - d[i] !== 1 || s.hold.reason[i] === 'held') everyFrame = false;
    if (s.hold.held.some((x) => x === 1)) putBack = true;
  }
  ok(everyFrame && !putBack, "cadence off (SHADOW_PASS_TUNE.cadence, the perf switch shadowCadence): every cascade drawn every frame, nothing held or put back");
  SHADOW_PASS_TUNE.cadence = true;
  s.hold.dirtyAll();
  pose(s.camera, 40, -10, 0);
  let held = 0;
  for (let f = 0; f < 60; f++) {
    s.world(NOON, 5000 + (f * 1000) / 144);
    s.render(true);
    if (s.hold.reason[1] === 'held' || s.hold.reason[2] === 'held') held++;
  }
  ok(held > 30, `cadence on again: the middle and far held between their ages (${held} of 60 frames)`);
  ok(s.lights.some((l) => l.shadow.autoUpdate === false), 'some cascade is held now');
  s.hold.dirtyAll();
  ok(s.lights.every((l) => l.shadow.autoUpdate === true), "the world's dirtyAll (a setting, a jump, the console's redraw) reaches the node's own cascade lights");
  // The debug menu's own age dial, moved as its slider moves it: the next decision reads it.
  const { SHADOW_DIALS } = await import('../../../src/world/shadowDials.ts');
  const { allDials, resetDials } = await import('../../../src/ui/dials.ts');
  const dial = allDials(SHADOW_DIALS).find((d) => d.key === 'tune.maxAgeMs.1')!;
  dial.set(0);
  let middleEvery = true;
  for (let f = 0; f < 30; f++) {
    s.world(NOON, 6000 + (f * 1000) / 144);
    const d = s.node._heldCounts.draws[1];
    s.render(true);
    if (s.node._heldCounts.draws[1] !== d + 1) middleEvery = false;
  }
  resetDials(SHADOW_DIALS);
  ok(middleEvery && SHADOW_PASS_TUNE.maxAgeMs[1] === TUNE0.maxAgeMs[1], "the shadowPass slider of the middle map's age at nought draws it every frame from the next decision, and Reset puts it back");
}

// ---------------------------------------------------------------- 6. fast movers
{
  resetTune();
  ages(0, 1e6, 1e6);
  const s = stage();
  pose(s.camera, 0, -5, 0);
  s.hold.dirtyAll();
  s.world(NOON, 100);
  s.render(true);
  const m = s.movers;
  const list = (on: boolean): void => {
    m.dt[0] = 1 / 144;
    m.begin();
    if (!on) return;
    const j = m.take();
    m.x[j] = 0;
    m.y[j] = 1.5;
    m.z[j] = -150;
    m.r[j] = 2;
    m.ground[j] = 0;
    m.speed[j] = 40;
    m.kind[j] = 'vehicle';
  };
  list(false);
  s.world(NOON, 110);
  s.render(true);
  const without = s.hold.reason.slice(0, 3).join(' ');
  list(true);
  s.world(NOON, 120);
  const d = s.node._heldCounts.draws[2];
  s.render(true);
  ok(without === 'age held held' && s.hold.reason[2] === 'mover' && s.node._heldCounts.draws[2] === d + 1 && (m.reached[0] & 4) !== 0 && s.hold.reason[1] === 'held', `a hull at 40 m/s 150 m ahead draws the far map that frame ('mover') and leaves the middle held (${without}, then ${s.hold.reason.slice(0, 3).join(' ')})`);
}

// ---------------------------------------------------------------- 7. the coverage proof against this node's own fit
const MOTIONS = [
  { name: 'standing', turn: 0, walk: 0 },
  { name: 'walking 6 m/s', turn: 0, walk: 6 },
  { name: 'riding 40 m/s', turn: 0, walk: 40 },
  { name: 'turning 15', turn: 15, walk: 0 },
  { name: 'turning 45', turn: 45, walk: 0 },
  { name: 'turning 90', turn: 90, walk: 0 },
  { name: 'turning 180', turn: 180, walk: 0 },
  { name: 'turning 360', turn: 360, walk: 0 },
];
const tmp = new THREE.Vector3();
const inverseFor = (l: THREE.DirectionalLight, pos: THREE.Vector3, tgt: THREE.Vector3, out: THREE.Matrix4): THREE.Matrix4 => {
  l.position.copy(pos);
  l.target.position.copy(tgt);
  l.updateMatrixWorld();
  l.target.updateMatrixWorld();
  l.shadow.updateMatrices(l);
  return out.copy(l.shadow.camera.matrixWorldInverse);
};
const across = (inv: THREE.Matrix4, half: number, p: THREE.Vector3): number => (tmp.copy(p).applyMatrix4(inv), half - Math.max(Math.abs(tmp.x), Math.abs(tmp.y)));
/**
 * The band this node's shader samples cascade `i` over, as distances along the view (`CSMShadowNode._setupFade`): its
 * linear depth is `viewZToOrthographicDepth`, `(d - near) / (shadowFar - near)`, counted from the near plane where the
 * classic shader's is `d / (shadowFar - near)`; in range from `x - x²/8` to `y + y²/8` (the closest edge's margin, a
 * quarter of its square, halved), the last cascade to `y`, the shadow distance.
 */
const nodeBand = (breaks: readonly number[], i: number, near: number, span: number, out: Float64Array): void => {
  const x = i > 0 ? breaks[i - 1] : 0;
  const y = breaks[i];
  const lo = x - (0.25 * x * x) / 2;
  const hi = i === breaks.length - 1 ? y : y + (0.25 * y * y) / 2;
  out[0] = Math.max(near, near + lo * span);
  out[1] = near + hi * span;
};
/** Ground samples (to 60 m up) between two distances along the view, at the projection's own half-extents. */
const groundSamples = (camera: THREE.PerspectiveCamera, tx: number, ty: number, zn: number, zf: number, out: THREE.Vector3[]): number => {
  let n = 0;
  for (let k = 0; k <= 10; k++) {
    const d = zn + ((zf - zn) * k) / 10;
    for (let a = 0; a <= 12; a++) {
      for (let b = 0; b <= 12; b++) {
        const p = out[n] ?? (out[n] = new THREE.Vector3());
        p.set((-1 + a / 6) * tx * d, (-1 + b / 6) * ty * d, -d).applyMatrix4(camera.matrixWorld);
        if (p.y >= -0.5 && p.y <= 60) n++;
      }
    }
  }
  return n;
};
function coverage(split: 'custom' | 'practical'): { holds: number; passed: number; lostAcross: number; pastDeep: number; tooHigh: number; freshPasses: boolean; reasons: Record<string, number>; agrees: number; ties: number; differs: string[]; bands: string } {
  resetTune();
  ages(0, 1e9, 1e9);
  const s = stage(split);
  const cam = s.camera;
  const lights = s.lights;
  const tune = SHADOW_PASS_TUNE;
  const tx = 1 / cam.projectionMatrix.elements[0];
  const ty = 1 / cam.projectionMatrix.elements[5];
  const probe = [new THREE.DirectionalLight(), new THREE.DirectionalLight(), new THREE.DirectionalLight()];
  const heldPos = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const heldTgt = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const freshPos = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const freshTgt = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const heldInv = new THREE.Matrix4();
  const freshInv = new THREE.Matrix4();
  const corners = Array.from({ length: 8 }, () => new THREE.Vector3());
  const band = new Float64Array(2);
  const real = new Float64Array(2);
  const samples: THREE.Vector3[] = [];
  const expected: string[] = ['', '', ''];
  const slack = [0, 0, 0];
  const reasons: Record<string, number> = {};
  const differs: string[] = [];
  let holds = 0;
  let passed = 0;
  let lostAcross = 0;
  let pastDeep = 0;
  let tooHigh = 0;
  let freshPasses = true;
  let agrees = 0;
  let ties = 0;
  let bands = '';
  let fitOff = 0;
  let boxOff = 0;
  for (const sun of Object.values(SUNS)) {
    for (const fps of [30, 60, 144]) {
      for (const ageFrames of [1, 3, 7]) {
        const age = ageFrames / fps;
        for (const m of MOTIONS) {
          for (let yaw0 = 0; yaw0 < 360; yaw0 += 30) {
            for (const pitch of [-25, -10, 0]) {
              // Every map drawn at the earlier pose, each draw told to the hold through its wrap.
              pose(cam, yaw0 - m.turn * age, pitch, m.walk * age);
              s.hold.dirtyAll();
              s.world(sun, 0);
              s.render(true);
              for (let i = 1; i < 3; i++) {
                heldPos[i].copy(s.hold.pos[i]);
                heldTgt[i].copy(s.hold.tgt[i]);
              }
              // The view now, and three's own fit of this node at it, read before the hold decides.
              pose(cam, yaw0, pitch, 0);
              s.csm.lightDirection.copy(sun).negate();
              s.csm.update();
              s.sun.sync(s.csm, cam, true);
              THREE_FIT.call(s.node, s.frame);
              for (let i = 0; i < 3; i++) {
                freshPos[i].copy(lights[i].position);
                freshTgt[i].copy(lights[i].target.position);
                // How far this node's fit stands from the classic cascades' fit of the same view (said, not held).
                fitOff = Math.max(fitOff, freshPos[i].distanceTo(s.csm.lights[i].position));
                boxOff = Math.max(boxOff, Math.abs(lights[i].shadow.camera.right - s.csm.lights[i].shadow.camera.right));
              }
              const shadowFar = Math.min(cam.far, s.node.maxFar);
              const span = shadowFar - cam.near;
              for (let i = 1; i < 3; i++) {
                const sc = lights[i].shadow.camera;
                const half = sc.right;
                const far = sc.far;
                probe[i].shadow.camera.copy(sc);
                inverseFor(probe[i], freshPos[i], freshTgt[i], freshInv);
                inverseFor(probe[i], heldPos[i], heldTgt[i], heldInv);
                // The guards' own band, as `decide` works it out.
                cascadeBand(s.node.breaks, shadowFar, cam.near, i, band);
                bandCorners(cam.matrixWorld, tx, ty, band[0], band[1], corners);
                const heldDepth = heldPos[i].dot(sun);
                const freshDepth = freshPos[i].dot(sun);
                if (holdCovers(corners, freshInv, freshInv, half, sun, freshDepth, freshDepth, far, tune) !== '') freshPasses = false;
                holds++;
                const r = holdCovers(corners, heldInv, freshInv, half, sun, heldDepth, freshDepth, far, tune);
                expected[i] = r || 'held';
                let least = Infinity;
                for (const c of corners) least = Math.min(least, across(heldInv, half, c) - Math.min(tune.coverMargin, across(freshInv, half, c)));
                slack[i] = Math.abs(least);
                reasons[r || 'held'] = (reasons[r || 'held'] ?? 0) + 1;
                if (r !== '') continue;
                passed++;
                if (freshDepth - heldDepth > tune.coverHigh + 1e-6) tooHigh++;
                // The band this node's shader really samples the cascade over.
                nodeBand(s.node.breaks, i, cam.near, span, real);
                if (!bands && i === 1) bands = `middle ${band[0].toFixed(2)}-${band[1].toFixed(2)} m guarded, ${real[0].toFixed(2)}-${real[1].toFixed(2)} m sampled`;
                const n = groundSamples(cam, tx, ty, real[0], real[1], samples);
                for (let k = 0; k < n; k++) {
                  const p = samples[k];
                  if (across(freshInv, half, p) >= 0 && across(heldInv, half, p) < 0) lostAcross++;
                  if (p.dot(sun) < heldDepth - far - 1e-6) pastDeep++;
                }
              }
              // The real decision, through the adapter: the frame armed and its first render.
              s.sun.arm(10);
              s.render(true);
              for (let i = 1; i < 3; i++) {
                const got = s.hold.reason[i];
                const pair = `${got} ${expected[i]}`;
                if (got === expected[i]) agrees++;
                else if ((pair === 'held cover' || pair === 'cover held') && slack[i] < 1e-6) {
                  agrees++;
                  ties++;
                } else if (differs.length < 6) differs.push(`cascade ${i}: decide ${got}, holdCovers ${expected[i]} (${slack[i].toExponential(1)} m off the line)`);
              }
            }
          }
        }
      }
    }
  }
  resetTune();
  bands += `; this node's fit stands at most ${fitOff.toExponential(1)} m from the classic cascades' fit of the same view, its boxes at most ${boxOff.toExponential(1)} m wider or narrower`;
  return { holds, passed, lostAcross, pastDeep, tooHigh, freshPasses, reasons, agrees, ties, differs, bands };
}
for (const split of ['custom', 'practical'] as const) {
  const r = coverage(split);
  const label = split === 'custom' ? "the game's own splits (what ships)" : "three's practical split (the classic proof's)";
  console.log(`     ${label}: ${r.passed} of ${r.holds} holds pass (${Object.entries(r.reasons).map(([k, v]) => `${k} ${v}`).join(', ')}); ${r.bands}`);
  ok(r.holds === 15552, `${label}: the classic proof's 15,552 holds, against this node's own fit (${r.holds})`);
  ok(r.freshPasses, `${label}: a fresh fit of this node always passes the guards`);
  ok(r.passed > r.holds / 4, `${label}: the guards pass a good share of holds over every motion, rate, age and sun (${r.passed} of ${r.holds})`);
  ok(r.lostAcross === 0, `${label}: across the light, wherever a hold passes, every ground sample of the band this node's shader samples that the fresh box holds the held box holds (${r.lostAcross} lost)`);
  ok(r.pastDeep === 0, `${label}: in depth, no ground sample of that band lies past a passed hold's deep end (${r.pastDeep})`);
  ok(r.tooHigh === 0, `${label}: and the held light is never more than coverHigh nearer the slice (${r.tooHigh})`);
  ok(r.agrees === r.holds && r.ties < r.holds / 200, `${label}: the real decide through the adapter answers every hold as holdCovers does over three's own matrices of this node (${r.agrees} of ${r.holds}, ${r.ties} exact ties on the cover line${r.differs.length ? `: ${r.differs.join('; ')}` : ''})`);
}

// ---- 7b. The holds the guards must refuse, through the node: each by its own reason. ----
{
  resetTune();
  ages(0, 1e9, 1e9);
  const s = stage();
  const lightX = new THREE.Vector3();
  new THREE.Matrix4().lookAt(new THREE.Vector3(), NOON.clone().negate(), new THREE.Vector3(0, 1, 0)).extractBasis(lightX, new THREE.Vector3(), new THREE.Vector3());
  const ask = (move: (pos: THREE.Vector3, tgt: THREE.Vector3) => void): ShadowReason => {
    pose(s.camera, 40, -10, 0);
    s.hold.dirtyAll();
    s.world(NOON, 0);
    s.render(true);
    move(s.hold.pos[2], s.hold.tgt[2]);
    s.world(NOON, 10);
    s.render(true);
    return s.hold.reason[2];
  };
  const unmoved = ask(() => {});
  const crossed = ask((p, t) => {
    const d = lightX.clone().multiplyScalar(300);
    p.add(d);
    t.add(d);
  });
  const deep = ask((p, t) => {
    const d = NOON.clone().multiplyScalar(900);
    p.add(d);
    t.add(d);
  });
  const high = ask((p, t) => {
    const d = NOON.clone().multiplyScalar(-(SHADOW_PASS_TUNE.coverHigh + 10));
    p.add(d);
    t.add(d);
  });
  const turned = ask((p, t) => {
    t.copy(p).add(NOON.clone().negate().applyAxisAngle(lightX, rad(0.3)));
  });
  ok(unmoved === 'held' && crossed === 'cover' && deep === 'deep' && high === 'high' && turned === 'sun', `decide on this node refuses each by its own reason (unmoved ${unmoved}, 300 m across ${crossed}, 900 m toward the sun ${deep}, ${SHADOW_PASS_TUNE.coverHigh + 10} m toward the slice ${high}, turned 0.3 degrees ${turned})`);
  resetTune();
}

// ---- 7c. The schedule turning at 90 degrees a second at 144 Hz, held noon, through the node. ----
{
  resetTune();
  const s = stage();
  const frames = 144 * 6;
  const draws = [0, 0, 0];
  const why: Record<string, number> = {};
  let yaw = 0;
  for (let f = 0; f < frames + 144; f++) {
    yaw += 90 / 144;
    pose(s.camera, yaw, -10, 0);
    s.world(NOON, (f * 1000) / 144);
    const d = Array.from(s.node._heldCounts.draws);
    s.render(true);
    if (f < 144) continue;
    for (let i = 0; i < 3; i++) {
      draws[i] += s.node._heldCounts.draws[i] - d[i];
      why[s.hold.reason[i]] = (why[s.hold.reason[i]] ?? 0) + 1;
    }
  }
  console.log(`     turning 90 degrees a second at 144 Hz, noon, through this node: middle drawn on ${((100 * draws[1]) / frames).toFixed(0)}% of frames, far on ${((100 * draws[2]) / frames).toFixed(0)}% (${Object.entries(why).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  ok(draws[0] === frames, 'turning: the near map every frame');
  ok(draws[2] <= frames / 3 && draws[1] <= (2 * frames) / 3, `turning: the far map on at most one frame in three (${draws[2]} of ${frames}) and the middle on at most two in three (${draws[1]})`);
  resetTune();
}

// ---------------------------------------------------------------- 8. nothing allocated in a frame, in twelve fresh processes
{
  const me = fileURLToPath(import.meta.url);
  const runs = await Promise.all(
    Array.from(
      { length: 12 },
      () =>
        new Promise<{ adapter: number | null; whole: number | null; base: number | null; decisions: number }>((res, rej) => {
          const ch = spawn(process.execPath, ['--expose-gc', me, '--alloc'], { stdio: ['ignore', 'pipe', 'pipe'] });
          let out = '';
          let err = '';
          ch.stdout.on('data', (b) => (out += b));
          ch.stderr.on('data', (b) => (err += b));
          ch.on('exit', (code) => {
            try {
              if (code !== 0) throw new Error(`exit ${code}: ${err.slice(0, 400)}`);
              res(JSON.parse(out.trim().split('\n').pop()!));
            } catch (e) {
              rej(e);
            }
          });
        }),
    ),
  );
  const say = (x: number | null): string => (x === null ? 'no clean window' : `${x.toFixed(3)}`);
  const adapter = runs.map((r) => r.adapter);
  const added = runs.map((r) => (r.whole === null || r.base === null ? null : r.whole - r.base));
  console.log(`     the adapter's own frame (four renders and a precompile, three's fit stood in), B a frame in 12 processes: ${adapter.map(say).join(' ')}`);
  console.log(`     the whole frame with three's fit against three's plain node, B a frame added in 12 processes: ${added.map(say).join(' ')} (whole ${runs.map((r) => say(r.whole)).join(' ')}; plain ${runs.map((r) => say(r.base)).join(' ')})`);
  ok(adapter.every((x) => x !== null && x < 0.5), `the hold on three's cascades allocates nothing in a frame of four renders and a precompile, in 12 of 12 processes (${adapter.map(say).join(' ')} B)`);
  ok(added.every((x) => x !== null && x < 4) && runs.every((r) => r.decisions > 1000), `and the whole frame with three's own fit makes nothing three's plain node does not (${added.map(say).join(' ')} B added)`);
}

console.log(`\nheldCsm: ${checks} checks passed`);
