// The motion output on WebGPU (the GPU port's pass 1, wave 5: `src/core/gpu/motion.ts`, `patchMotion.ts`; the design's
// section 7): every material's draw into the scene target writes its pixel's motion since the last frame, in three's own
// convention (this frame's place in normalised device coordinates less last frame's, x and y), unjittered, into a second
// output, the reactive mark in its alpha; a see-through material keeps the motion behind it and marks itself reactive.
//
// What is held here, in node (three's WebGPU classes load in node; node builds no WGSL and has no card):
//  1. What every kind of material the game draws writes (`motionPlan`, the plan the graph is built from), listed as a table:
//     still, moving, skinned, the sky, water, glass, a blaster bolt (its opaque core and the glow that wraps it), a lightsaber
//     blade, particles, marks, lava, the tunnel, the far rings, the doorways' depth reset, an engine's glow, and the ropes laid
//     on the CPU (the grapple's, a chain's) beside the dart on the rope's material, each made as its site makes it.
//  2. The pipeline three makes for each: three's own `WebGPUPipelineUtils.createRenderPipeline` run over a stub device with
//     the patch's wrap on it, its targets read back: the colour blended as the material blends, the motion overwritten by what
//     writes its own and kept with the larger reactive by what is see-through. And the key three files a pipeline under carries
//     the material's blending and transparency and never the multi-output node: two such nodes differing in their blends
//     alone would share a pipeline, which is why the motion output's blend is decided per material, by a rule of those two
//     fields alone.
//  3. The node follows the target: ours on a motion target, taken off any other, another node left alone; the target's second
//     texture named for the output, cleared to nought; a fragment of its own merged into the node as three merges a colour.
//  4. The arithmetic, the game's own code on the CPU (`motionFrame`, `moverDelta`, `moverStamp`) with the card's modelled in
//     32-bit floats: still things by the camera's change, a mover by its own, the sky by the turn alone, a body's delta turned
//     into view space, all within a hundredth of a pixel of the exact motion and as steady 8 and 16 km from the world's middle
//     as at it; the stamp that takes a change only on its own frame (a stop, a start, a return after hiding); the ropes laid
//     on the CPU, the game's own strips made as on WebGPU, each vertex's change and its motion, and the frames that read still.
//  5. Nothing allocated in a frame (the camera's change, the movers' changes at their refreshes, the last-frame copies), in
//     twelve fresh processes (`--alloc`), the least of three clean windows (`testing.md`).
//
// Run: node --expose-gc tools/swg/tests/gpuMotion.test.ts
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { NodeMaterial, StackNode, WebGPUBackend } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { LAID_ATTRIBUTE, MOTION, MOTION_BLENDS, MOTION_STATS, PIPELINE_NOW, adoptMotion, isMotionTarget, laidMotion, markMotion, markMotionTarget, motionFrame, motionFrameNo, motionMatrices, motionMrt, motionPlan, motionPrevious, motionTextureOf, moverDelta, moverStamp, previousUniform, resetMotionForTests, seeThrough, withMotionOutput } from '../../../src/core/gpu/motion.ts';
import { installMotionPatch } from '../../../src/core/gpu/patchMotion.ts';
import { makeStandIns } from '../../../src/core/gpu/standIns.ts';
import { GPU } from '../../../src/core/gpuSwitch.ts';
import { GRAPPLE_MATERIAL, RopeRibbon } from '../../../src/player/grappleDraw.ts';
import { CHAIN_ROPE_MATERIAL, ChainRibbon } from '../../../src/player/ropeChainDraw.ts';
import { RopeCurve } from '../../../src/player/ropeCurve.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
};
const text = (p: string): string => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n?/g, '\n');

// ---------------------------------------------------------------- 5 (child). what a frame allocates, in a process of its own
if (process.argv.includes('--alloc')) {
  const v8 = await import('node:v8');
  const { PerformanceObserver } = await import('node:perf_hooks');
  const gc = (globalThis as Any).gc as (o?: unknown) => void;
  let collections = 0;
  new PerformanceObserver((l) => (collections += l.getEntries().length)).observe({ entryTypes: ['gc'] });
  const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;
  const turn = () => new Promise((r) => setImmediate(r));
  const least = async (step: () => void, n: number): Promise<number> => {
    let best = Number.POSITIVE_INFINITY;
    for (let w = 0; w < 3; w++) {
      for (let tries = 0; tries < 6; tries++) {
        for (let i = 0; i < 2000; i++) step();
        gc({ type: 'minor' });
        await turn();
        await turn();
        const c0 = collections;
        const b = young();
        for (let i = 0; i < n; i++) step();
        const a = young();
        await turn();
        await turn();
        if (collections === c0) {
          best = Math.min(best, (a - b) / n);
          break;
        }
      }
    }
    return best;
  };
  resetMotionForTests();
  MOTION.applied = true;
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 20000);
  camera.position.set(16000, 40, -16000);
  // Two last-frame copies a material reads (the far rings' eye and grid), rolled at each frame.
  const eye = { value: new THREE.Vector4(16000, 40, -16000, 900) };
  const grid = { value: new THREE.Vector4(0, 0, 1, 1) };
  previousUniform(eye);
  previousUniform(grid);
  // A rope's strip laid on the CPU, drawn (in a scene, shown), its change worked at each frame: the longest a hanging rope lays.
  const laidPos = new Float32Array(261 * 2 * 3);
  const laidGeo = new THREE.BufferGeometry();
  laidGeo.setAttribute('position', new THREE.BufferAttribute(laidPos, 3));
  laidGeo.setDrawRange(0, 260 * 6);
  const laidMesh = new THREE.Mesh(laidGeo, new THREE.MeshStandardMaterial());
  new THREE.Scene().add(laidMesh);
  laidMotion(laidMesh, laidPos);
  // A crowd: 200 objects moving every frame, each refreshed twice a frame (the world pass and a room's), as three's object
  // uniforms ask: the change and the stamp.
  const objs: THREE.Object3D[] = [];
  for (let i = 0; i < 200; i++) {
    const o = new THREE.Object3D();
    o.position.set(16000 + i, 2, -16000 - i);
    o.updateMatrixWorld();
    objs.push(o);
  }
  const out = new THREE.Matrix4();
  let f = 0;
  const frame = (): void => {
    f ^= 1;
    camera.position.x += f === 1 ? 0.01 : -0.01;
    camera.rotation.y += f === 1 ? 0.001 : -0.001;
    camera.updateMatrixWorld();
    eye.value.x = camera.position.x;
    for (let k = 0; k < laidPos.length; k += 7) laidPos[k] += f === 1 ? 0.01 : -0.01;
    motionFrame(camera);
    for (let i = 0; i < objs.length; i++) {
      const e = objs[i].matrixWorld.elements;
      e[12] += f === 1 ? 0.02 : -0.02;
      moverDelta(objs[i], out);
      moverStamp(objs[i]);
      moverDelta(objs[i], out);
      moverStamp(objs[i]);
    }
  };
  for (let i = 0; i < 4; i++) frame();
  const res: Record<string, number> = {};
  res.frame = (await least(frame, 2000)) / 200;
  // The camera's change alone, a frame (the rolls included: the last-frame copies and the laid rope's change).
  res.camera = await least(() => motionFrame(camera), 20000);
  res.laidFrames = MOTION_STATS.laidFrames;
  console.log(JSON.stringify(res));
  process.exit(0);
}

// ---------------------------------------------------------------- 1. what every kind of material writes
resetMotionForTests();
const standIns = makeStandIns();

/** The sky's original as `sky.ts` makes its dome, a stand-in registered on it, and the stand-in's marks adopted (`fallback.ts`). */
const skyOriginal = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
const skyStandIn = standIns.sky(new THREE.Color(0.5, 0.6, 0.7), new THREE.Color(0.2, 0.3, 0.6));
adoptMotion(skyOriginal, skyStandIn);
/** A material that moves its vertices by the camera (the far rings' way): its place last frame handed in on the stand-in. */
const ringOriginal = new THREE.ShaderMaterial({});
const ringStandIn = motionPrevious(new NodeMaterial(), () => TSL.positionGeometry);
adoptMotion(ringOriginal, ringStandIn);

// Each kind as its site makes it (the fields three's pipeline and the plan read): checked against the site's own text below.
const KINDS: { kind: string; site: string; material: THREE.Material; pooled?: boolean; laid?: boolean }[] = [
  { kind: 'a still building', site: 'converted models (MeshStandardMaterial)', material: new THREE.MeshStandardMaterial() },
  { kind: 'a leaf card (cut out)', site: 'flora (an alpha test, opaque)', material: new THREE.MeshStandardMaterial({ alphaTest: 0.5 }) },
  { kind: 'a moving speeder or ship', site: 'vehicles (opaque; its own change at its refresh)', material: new THREE.MeshStandardMaterial() },
  { kind: 'a person (the bone pool)', site: 'bodies skinned from the pool', material: new THREE.MeshStandardMaterial(), pooled: true },
  { kind: 'the sky', site: "sky.ts's dome, its stand-in marked", material: skyOriginal },
  { kind: 'the far rings', site: "horizonRings.ts, its stand-in handing in last frame's place", material: ringOriginal },
  { kind: 'the ground tiles', site: 'terrainTextures.ts (opaque)', material: new THREE.ShaderMaterial({}) },
  { kind: 'lava', site: 'lava.ts (opaque)', material: new THREE.ShaderMaterial({}) },
  { kind: 'the hyperspace tunnel', site: 'hyperspaceTunnel.ts (opaque, its back side)', material: new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: true }) },
  { kind: 'water (lakes, the sea, rivers)', site: 'water.ts (MeshPhysicalMaterial, transparent)', material: new THREE.MeshPhysicalMaterial({ transparent: true, opacity: 0.8 }) },
  { kind: 'glass', site: 'a converted see-through part (transparent, normal blending)', material: new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.35 }) },
  { kind: "a blaster bolt's glow", site: 'bolts.ts (additive, transparent, round the core)', material: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }) },
  { kind: 'a lit lightsaber blade', site: 'saberBlade.ts (additive, transparent)', material: new THREE.ShaderMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }) },
  { kind: 'particles, additive', site: "the client's particles", material: new THREE.ShaderMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }) },
  { kind: 'particles, blended', site: "the client's particles", material: new THREE.ShaderMaterial({ transparent: true, blending: THREE.NormalBlending, depthWrite: false }) },
  { kind: 'particles, modulate', site: "the client's particles (WebGPU: custom, nought and the source colour)", material: new THREE.ShaderMaterial({ transparent: true, blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor, depthWrite: false }) },
  { kind: 'marks and decals', site: 'marks.ts, decals (blended, no depth write)', material: new THREE.ShaderMaterial({ transparent: true, depthWrite: false, polygonOffset: true }) },
  { kind: "an engine's glow", site: 'a glow sprite (additive)', material: new THREE.SpriteMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }) },
  { kind: "the doorways' depth reset", site: 'portalRender.ts (no colour write)', material: new THREE.ShaderMaterial({ colorWrite: false }) },
  // The wave's fixer: the bolt's core beside its glow, and the ropes laid on the CPU (the game's own materials).
  { kind: "a blaster bolt's core", site: 'bolts.ts (opaque, unlit, inside its glow)', material: new THREE.MeshBasicMaterial({ toneMapped: false }) },
  { kind: "the grapple's rope", site: "grappleDraw.ts's RopeRibbon (laid on the CPU; another player's rope is one too)", material: GRAPPLE_MATERIAL, laid: true },
  { kind: 'a rope hanging as a chain', site: "ropeChainDraw.ts's ChainRibbon (laid on the CPU)", material: CHAIN_ROPE_MATERIAL, laid: true },
  { kind: "the grapple's dart", site: "grappleDraw.ts's dartMesh (rigid, on the rope's material)", material: GRAPPLE_MATERIAL },
];

{
  const rows: string[] = [];
  for (const k of KINDS) {
    const p = motionPlan(k.material, k.pooled === true, k.laid === true);
    rows.push(`  ${k.kind.padEnd(32)} ${p.writes.padEnd(7)} ${p.previous.padEnd(7)} ${p.reactive.padEnd(23)} ${p.blend}`);
  }
  console.log(`  ${'kind'.padEnd(32)} ${'writes'.padEnd(7)} ${'last'.padEnd(7)} ${'reactive'.padEnd(23)} motion blend\n${rows.join('\n')}`);
  const plan = (kind: string) => {
    const k = KINDS.find((x) => x.kind === kind)!;
    return motionPlan(k.material, k.pooled === true, k.laid === true);
  };
  const own = ['a still building', 'a leaf card (cut out)', 'a moving speeder or ship', 'the ground tiles', 'lava', 'the hyperspace tunnel', "a blaster bolt's core", "the grapple's dart"];
  for (const k of own) ok(plan(k).writes === 'own' && plan(k).previous === 'rigid' && plan(k).blend === 'none', `${k} writes its own motion (the camera's change, its own on top where it moved), overwriting what is behind`);
  ok(plan('a person (the bone pool)').writes === 'own' && plan('a person (the bone pool)').previous === 'bones', "a person writes its own motion from the bone pool's last half");
  ok(plan('the sky').writes === 'own' && plan('the sky').previous === 'sky', "the sky writes the camera's turn (its stand-in's mark adopted by the original three builds on)");
  ok(plan('the far rings').writes === 'own' && plan('the far rings').previous === 'handed', "the far rings write their own motion from last frame's place they hand in");
  for (const k of ['water (lakes, the sea, rivers)', 'glass', 'particles, blended', 'marks and decals', 'particles, modulate']) ok(plan(k).writes === 'behind' && plan(k).reactive === 'alpha' && plan(k).blend === 'keep, larger reactive', `${k} keeps the motion behind it and marks itself reactive by its alpha`);
  for (const k of ["the grapple's rope", 'a rope hanging as a chain']) ok(plan(k).writes === 'own' && plan(k).previous === 'laid' && plan(k).blend === 'none', `${k} writes its own motion from each vertex's change laid on the CPU (its matrix never moves)`);
  for (const k of ["a blaster bolt's glow", 'a lit lightsaber blade', 'particles, additive', "an engine's glow"]) ok(plan(k).writes === 'behind' && plan(k).reactive === 'additive' && plan(k).blend === 'keep, larger reactive', `${k} keeps the motion behind it and marks itself reactive by its brightest channel times its alpha`);
  ok(plan("the doorways' depth reset").writes === 'none', "the doorways' depth reset writes nothing at all (no colour write)");
  // The kinds as their sites make them: the fields above read off the sites' own text.
  ok(/blending: THREE\.AdditiveBlending, depthWrite: false/.test(text('src/combat/bolts.ts')) && /transparent: true, opacity: 0\.55, blending: THREE\.AdditiveBlending/.test(text('src/combat/bolts.ts')), "bolts.ts: a bolt's glow is additive and transparent, as listed");
  {
    // The wave's fixer: a bolt is two materials. Its core is opaque and writes the bolt's own motion: keeping the motion behind
    // is not a thing an opaque draw can do (drawn nearest first, what stands behind it fails the depth test there and is never
    // drawn). Its pixels are marked reactive by the glow, which wraps the core whole and is drawn after it (see-through after
    // opaque) in front of it, keeping the motion under it (the core's own) and taking the larger reactive.
    const bolts = text('src/combat/bolts.ts');
    ok(/new THREE\.MeshBasicMaterial\(\{ color: c\.clone\(\)\.lerp\(new THREE\.Color\(0xffffff\), 0\.7\)\.multiplyScalar\(1\.6\), toneMapped: false \}\),\n\s+new THREE\.MeshBasicMaterial\(\{ color: c\.clone\(\)\.multiplyScalar\(1\.3\), transparent: true, opacity: 0\.55, blending: THREE\.AdditiveBlending, depthWrite: false, toneMapped: false \}\),/.test(bolts), "bolts.ts: a bolt's core is opaque and its glow additive, as listed (`materialsFor`, the core first)");
    ok(bolts.includes('mesh.add(new THREE.Mesh(this.core, coreMat), new THREE.Mesh(this.glow, glowMat), new THREE.Mesh(this.head, glowMat));') && bolts.includes('mesh.add(new THREE.Mesh(this.beamCore, coreMat.clone()), new THREE.Mesh(this.beamGlow, glowMat.clone()));'), "bolts.ts: a bolt's core and its glow are one group, and a beam's");
    /** A cylinder of the bolt's, by its field: its top and bottom radii, its length in the bolt's lengths, and what is done to it after. */
    const cyl = (name: string): { top: number; bottom: number; h: number; then: string } => {
      const m = new RegExp(String.raw`private readonly ${name} = new THREE\.CylinderGeometry\(([\d.]+), ([\d.]+), (LENGTH \* [\d.]+|LENGTH|[\d.]+), \d+, \d+\)(.*);`).exec(bolts);
      assert.ok(m, `bolts.ts: the ${name} cylinder is read`);
      const h = m[3] === 'LENGTH' ? 1 : m[3].startsWith('LENGTH') ? Number(m[3].split('*')[1]) : Number(m[3]);
      return { top: Number(m[1]), bottom: Number(m[2]), h, then: m[4] };
    };
    for (const [coreName, glowName] of [['core', 'glow'], ['beamCore', 'beamGlow']]) {
      const c = cyl(coreName);
      const g = cyl(glowName);
      // Both turned and moved alike, so one axis and one middle; the glow's radius along the core's length, at the core's ends.
      const rGlow = (y: number): number => g.bottom + ((g.top - g.bottom) * (y + g.h / 2)) / g.h;
      const wraps = c.then === g.then && g.h >= c.h && rGlow(c.h / 2) > c.top && rGlow(-c.h / 2) > c.bottom;
      ok(wraps, `bolts.ts: the ${glowName} wraps the ${coreName} whole (radii ${c.bottom} to ${c.top} inside ${rGlow(-c.h / 2).toFixed(4)} to ${rGlow(c.h / 2).toFixed(4)}, ${c.h} long inside ${g.h})`);
    }
    // The glow's reactive mark over the core, for the two colours the warm-up fires: its brightest channel times its alpha.
    for (const hex of [0xff4a2a, 0x3af06a]) {
      const glow = new THREE.Color(hex).multiplyScalar(1.3);
      const reactive = Math.min(1, Math.max(glow.r, glow.g, glow.b) * 0.55);
      ok(reactive > 0.5, `a bolt of ${hex.toString(16)}: its glow marks the core's pixels reactive at ${reactive.toFixed(2)} (kept as the larger over the core's nought)`);
    }
  }
  ok(text('src/player/grappleDraw.ts').split('if (GPU.webgpu) GPU.rt!.motion.laid(this.mesh, this.pos);').length === 2 && text('src/player/ropeChainDraw.ts').split('if (GPU.webgpu) GPU.rt!.motion.laid(this.mesh, this.pos);').length === 2, "grappleDraw.ts and ropeChainDraw.ts: each rope's strip is registered as laid as it is made, on WebGPU (another player's rope is a RopeRibbon)");
  ok(/r\.ribbon = new RopeRibbon\(/.test(text('src/net/remoteRopes.ts')), "remoteRopes.ts: another player's rope is drawn with the game's RopeRibbon");
  ok(/transparent: true,\n\s+blending: THREE\.AdditiveBlending,\n\s+depthWrite: false,/.test(text('src/combat/saberBlade.ts')), "saberBlade.ts: a blade is additive and transparent, as listed");
  ok(/new THREE\.MeshPhysicalMaterial\(\{\n\s+color: look\.color,\n\s+transparent: true,/.test(text('src/world/water.ts')), 'water.ts: the water is transparent, as listed');
  ok(/side: THREE\.BackSide, depthWrite: true, depthTest: true/.test(text('src/space/hyperspaceTunnel.ts')), 'hyperspaceTunnel.ts: the tunnel is opaque, its back side drawn, as listed');
  ok(/markMotion\(m, 'sky'\)/.test(text('src/core/gpu/standIns.ts')) && /adoptMotion\(m, s\);/.test(text('src/core/gpu/fallback.ts')), "the sky's stand-in is marked and the fallback hands a stand-in's marks to its original");
  ok(/motionPrevious\(m, \(\) => ringVertexN\(ringPrevious\(r, u\), previousOr\(ground\.uGroundFrame, g\.frame\), attribute\('aRing', 'vec4'\), positionGeometry\)\.pos\);/.test(text('src/core/gpu/gpuGround.ts')), "the far rings hand in last frame's place: the ring's own vertex over last frame's copies");
  // The rule is three's own (`materialBlending` in `createRenderPipeline`), held to its text.
  const pipe = text('node_modules/three/build/three.webgpu.js');
  ok(pipe.includes('if ( material.blending !== NoBlending && ( material.blending !== NormalBlending || material.transparent !== false ) ) {'), "three's pipeline blends a material's colour by the rule `seeThrough` is (its blending, and transparency under normal blending)");
  ok(seeThrough({ blending: THREE.NormalBlending, transparent: false }) === false && seeThrough({ blending: THREE.NormalBlending, transparent: true }) === true && seeThrough({ blending: THREE.NoBlending, transparent: true }) === false && seeThrough({ blending: THREE.AdditiveBlending, transparent: false }) === true, 'seeThrough reads the two fields as three does');
}

// ---------------------------------------------------------------- 2. the pipeline three makes for each
{
  resetMotionForTests();
  const be = new WebGPUBackend({}) as Any;
  const captured: Any[] = [];
  be.device = {
    createPipelineLayout: () => ({}),
    pushErrorScope: () => {},
    popErrorScope: () => Promise.resolve(null),
    createRenderPipeline: (d: Any) => {
      captured.push(JSON.parse(JSON.stringify(d.fragment.targets)));
      return {};
    },
  };
  be.attributeUtils.getVertexBufferLayout = () => [];
  be.attributeUtils.getVertexBufferLayoutCacheKey = () => 'layout';
  // A stand-in renderer the patch is installed on: its target and node as three's renderer keeps them.
  const renderer: Any = {
    backend: be,
    _target: null,
    _mrt: null,
    setRenderTarget(t: Any) {
      this._target = t;
    },
    getRenderTarget() {
      return this._target;
    },
    setMRT(m: Any) {
      this._mrt = m;
      return this;
    },
    getMRT() {
      return this._mrt;
    },
  };
  installMotionPatch(renderer);
  ok(MOTION.applied === true, 'the patch says it applied');
  const node = motionMrt();
  const colour = new THREE.Texture();
  colour.type = THREE.HalfFloatType;
  colour.name = 'fx.scene';
  const motion = colour.clone();
  motion.name = 'motion';
  const ctxOf = (mrt: Any): Any => ({ textures: [colour, motion], mrt, depth: true, stencil: true, sampleCount: 1, depthTexture: { format: THREE.DepthStencilFormat, type: THREE.UnsignedInt248Type } });
  const vp = {};
  const fp = {};
  be.get(vp).module = { module: 'v', entryPoint: 'main' };
  be.get(fp).module = { module: 'f', entryPoint: 'main' };
  const roOf = (m: THREE.Material, ctx: Any): Any => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), m);
    return { object: mesh, material: m, geometry: mesh.geometry, pipeline: { vertexProgram: vp, fragmentProgram: fp }, context: ctx, getBindings: () => [], clippingContextCacheKey: '' };
  };
  const KEEP = { color: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'max' } };
  let seeThroughs = 0;
  for (const k of KINDS) {
    captured.length = 0;
    be.pipelineUtils.createRenderPipeline(roOf(k.material, ctxOf(node)), null);
    const withOutput = captured[0];
    captured.length = 0;
    be.pipelineUtils.createRenderPipeline(roOf(k.material, { ...ctxOf(null), textures: [colour] }), null);
    const plain = captured[0];
    ok(withOutput?.length === 2 && plain?.length === 1, `${k.kind}: two targets with the motion output, one without`);
    ok(JSON.stringify(withOutput[0].blend ?? null) === JSON.stringify(plain[0].blend ?? null), `${k.kind}: its colour blends exactly as it does with no motion output (${JSON.stringify(plain[0].blend ?? 'none')})`);
    const plan = motionPlan(k.material, k.pooled === true);
    if (plan.blend === 'keep, larger reactive') {
      seeThroughs++;
      ok(JSON.stringify(withOutput[1].blend) === JSON.stringify(KEEP), `${k.kind}: its motion output keeps what is behind (nought and one) and takes the larger reactive (max): ${JSON.stringify(withOutput[1].blend)}`);
    } else ok(withOutput[1].blend === undefined, `${k.kind}: its motion output overwrites what is behind (no blend)`);
    ok(withOutput[1].writeMask === withOutput[0].writeMask, `${k.kind}: the motion output written as its colour is (write mask ${withOutput[1].writeMask})`);
    ok(PIPELINE_NOW.seeThrough === false, `${k.kind}: the blend's answer put back after the call`);
  }
  ok(MOTION_STATS.pipelines === KINDS.length && MOTION_STATS.seeThrough === seeThroughs && MOTION_STATS.seeThroughNames.length === seeThroughs, `the census counts the pipelines made for a motion target (${MOTION_STATS.pipelines}) and names the see-through ones (${MOTION_STATS.seeThrough})`);
  // Another multi-output node's pipelines are three's own: the wrap answers nothing there.
  captured.length = 0;
  const other = TSL.mrt({ output: TSL.output, extra: TSL.vec4(1) }) as Any;
  be.pipelineUtils.createRenderPipeline(roOf(KINDS[11].material, ctxOf(other)), null);
  ok(captured[0][1].blend === undefined && MOTION_STATS.pipelines === KINDS.length, "a node of another's is left to three: its outputs blend as three reads them, nothing counted");

  // The key three files a pipeline under: the material's blending and transparency, never the node or its blends.
  const keyOf = (m: THREE.Material, mrt: Any): string => {
    const ro = roOf(m, ctxOf(mrt));
    ro.object.matrixWorld.identity();
    return be.getRenderCacheKey(ro);
  };
  const opaque = new THREE.MeshStandardMaterial();
  const glass = new THREE.MeshStandardMaterial({ transparent: true });
  ok(keyOf(opaque, node) !== keyOf(glass, node), "an opaque and a see-through material are keyed apart by three (its blending and transparency are in the key)");
  const otherBlends = TSL.mrt({ motion: TSL.vec4(0) }) as Any;
  otherBlends.setBlendMode('motion', MOTION_BLENDS.keepBehind);
  ok(keyOf(glass, node) === keyOf(glass, otherBlends) && keyOf(opaque, node) === keyOf(opaque, otherBlends), "the key carries no multi-output node nor its blends: two nodes differing in their blends alone would share a pipeline");
  const key = text('node_modules/three/build/three.webgpu.js');
  ok(/return stageVertex\.id \+ ',' \+ stageFragment\.id \+ ',' \+ this\.backend\.getRenderCacheKey\( renderObject \);/.test(key), "three's pipeline key is its two programs' ids and the backend's draw state");
}

// ---------------------------------------------------------------- 3. the node follows the target; its texture; a fragment of its own
{
  resetMotionForTests();
  const node = motionMrt();
  const renderer: Any = {
    backend: { pipelineUtils: { createRenderPipeline: () => undefined } },
    _target: null,
    _mrt: null,
    setRenderTarget(t: Any) {
      this._target = t;
      return 'three';
    },
    getRenderTarget() {
      return this._target;
    },
    setMRT(m: Any) {
      this._mrt = m;
      return this;
    },
    getMRT() {
      return this._mrt;
    },
  };
  installMotionPatch(renderer);
  const t = new THREE.RenderTarget(8, 4, { type: THREE.HalfFloatType, count: 2 });
  t.texture.name = 'fx.scene';
  markMotionTarget(t);
  ok(t.textures.length === 2 && t.textures[1].name === 'motion' && t.textures[1].type === THREE.HalfFloatType && t.textures[1].format === THREE.RGBAFormat, "a motion target's second texture is half-float RGBA named for the output (8 bytes a pixel)");
  ok(isMotionTarget(t) && motionTextureOf(t.texture) === t.textures[1] && motionTextureOf(null) === null, "the target is known, its motion texture found from its colour");
  const plain = new THREE.RenderTarget(8, 4);
  ok(renderer.setRenderTarget(t) === 'three' && renderer.getMRT() === node, "set to a motion target, the renderer's node is ours (three's own call answered as it was)");
  renderer.setRenderTarget(plain);
  ok(renderer.getMRT() === null, 'set to any other target, it is taken off');
  renderer.setRenderTarget(t);
  renderer.setRenderTarget(null);
  ok(renderer.getMRT() === null, 'and off for the canvas');
  const foreign = TSL.mrt({ output: TSL.output }) as Any;
  renderer.setMRT(foreign);
  renderer.setRenderTarget(plain);
  ok(renderer.getMRT() === foreign, "another's node is left as it stands");
  const clear = node.getClearColor('motion');
  ok(clear && clear.r === 0 && clear.g === 0 && clear.b === 0 && clear.a === 0, 'the motion output is cleared to nought');
  ok(node.getClearColor('fx.scene') === null, "the colour is cleared as three clears it");
  ok(node.getBlendMode('fx.scene') === MOTION_BLENDS.asMaterial && node.getBlendMode('motion') === MOTION_BLENDS.overwrite, 'the colour blends as its material, the motion output is overwritten unless see-through');
  PIPELINE_NOW.seeThrough = true;
  ok(node.getBlendMode('motion') === MOTION_BLENDS.keepBehind, "and kept with the larger reactive while a see-through material's pipeline is made");
  PIPELINE_NOW.seeThrough = false;
  ok(MOTION_BLENDS.keepBehind.blendEquationAlpha === THREE.MaxEquation && MOTION_BLENDS.keepBehind.blendSrcAlpha === THREE.OneFactor && MOTION_BLENDS.keepBehind.blendDstAlpha === THREE.OneFactor, "the reactive's max takes one and one (WebGPU's rule for max)");
  // A fragment of its own (the step's programs, a part left out at load) merged into the node as three merges a colour.
  const m = withMotionOutput(new NodeMaterial()) as Any;
  m.fragmentNode = TSL.vec4(1, 0, 0, 1);
  const builder = { renderer };
  // A stack for the output's assignment to go on, as a build has one.
  (TSL as Any).setCurrentStack(new StackNode());
  renderer.setRenderTarget(t);
  const merged = m.setupOutput(builder, TSL.vec4(1, 0, 0, 1));
  ok(merged?.isOutputStructNode === true && merged.isMRTNode === true && merged.has('fx.scene') && merged.has('motion'), "a fragment of its own, built for a motion target, gives three a node with the colour by its texture's name and the motion output");
  renderer.setRenderTarget(plain);
  const alone = m.setupOutput(builder, TSL.vec4(1, 0, 0, 1));
  ok(alone?.isMRTNode !== true, 'built for any other target, it is its own output as before');
  const lit = withMotionOutput(new NodeMaterial()) as Any;
  renderer.setRenderTarget(t);
  ok(lit.setupOutput(builder, TSL.vec4(1)).isMRTNode !== true, "a material with no fragment of its own is left to three's own merge round its colour");
  (TSL as Any).setCurrentStack(null);
  // Every node material of the game's own with a fragment of its own drawn into the scene carries it.
  const progs = text('src/core/gpu/gpuPrograms.ts');
  ok(/function program\(name: string, fog: boolean\): Any \{[\s\S]*?withMotionOutput\(m\);\n  return m;\n\}/.test(progs) && (progs.match(/= program\(/g) ?? []).length === 5 && (progs.match(/new NodeMaterial\(/g) ?? []).length === 1, "gpuPrograms.ts: the step's five programs (lava, marks, blades, particles, tunnel) are each made by program(), which gives them the output");
  ok(/function drawsNothing\(name: string\): THREE\.Material \{[\s\S]*?return withMotionOutput\(m\);\n\}/.test(text('src/core/gpu/standIns.ts')), 'standIns.ts: a part left out at load draws nothing and writes every output');
  // The warm-up builds each item under the node its context was made with, never whatever its clock finds.
  const warm = text('src/core/gpu/patchWarm.ts');
  ok(warm.includes('const mrtKept = r.getMRT?.() ?? null;') && warm.includes('r.setMRT?.(it.ctx?.mrt ?? null);') && warm.includes('r.setMRT?.(mrtKept);'), "patchWarm.ts: an item is built under its context's node and the renderer's put back");
}

// ---------------------------------------------------------------- 4. the arithmetic: the game's code, the card's modelled in floats
{
  resetMotionForTests();
  const f = Math.fround;
  /** A 4x4 times a 4-vector in 32-bit floats, each product and sum rounded as the card rounds them (column-major). */
  const mulF = (m: ArrayLike<number>, v: number[]): number[] => {
    const o = [0, 0, 0, 0];
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let c = 0; c < 4; c++) s = f(s + f(f(m[c * 4 + r]) * f(v[c])));
      o[r] = s;
    }
    return o;
  };
  /** A 4x4 times a 4x4 in 32-bit floats (three's `cameraViewMatrix.mul( modelWorldMatrix )` on the card). */
  const mulMF = (a: ArrayLike<number>, b: ArrayLike<number>): number[] => {
    const o = new Array(16).fill(0);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s = f(s + f(f(a[k * 4 + r]) * f(b[c * 4 + k])));
      o[c * 4 + r] = s;
    }
    return o;
  };
  const W = 1600;
  const H = 900;
  const px = (ndcDx: number, ndcDy: number): number => Math.sqrt((ndcDx * W * 0.5) ** 2 + (ndcDy * H * 0.5) ** 2);
  /** The exact motion of a world place `p` (doubles): its place now less last frame's, normalised device coordinates. */
  const exact = (pNow: THREE.Matrix4, vNow: THREE.Matrix4, pLast: THREE.Matrix4, vLast: THREE.Matrix4, now: THREE.Vector3, last: THREE.Vector3): [number, number] => {
    const a = now.clone().applyMatrix4(vNow).applyMatrix4(pNow);
    const b = last.clone().applyMatrix4(vLast).applyMatrix4(pLast);
    return [a.x - b.x, a.y - b.y];
  };
  const mats = { pNow: new THREE.Matrix4(), dPrev: new THREE.Matrix4() };
  /** The card's motion for a draw: three's view place, then `pNow` and `dPrev` (and `w` on top, where taken) as the graph has them. */
  const card = (pv: number[], w: THREE.Matrix4 | null, dir = false): [number, number] => {
    const h = dir ? [pv[0], pv[1], pv[2], 0] : [pv[0], pv[1], pv[2], 1];
    const cur = mulF(mats.pNow.elements, h);
    const moved = w && !dir ? mulF(w.elements, h) : h;
    const prev = mulF(mats.dPrev.elements, moved);
    return [f(f(cur[0] / cur[3]) - f(prev[0] / prev[3])), f(f(cur[1] / cur[3]) - f(prev[1] / prev[3]))];
  };
  const camera = new THREE.PerspectiveCamera(60, W / H, 0.05, 20000);
  for (const far of [0, 8000, 16000]) {
    resetMotionForTests();
    // A still building's corner, 2 m and 30 m and 500 m before the camera, as three places it: its world matrix (a building
    // stands where it was placed) times its own place, both as floats on the card, and the view times that on the card.
    const model = new THREE.Matrix4().makeTranslation(far + 3, 1.5, -far - 2);
    const locals = [new THREE.Vector3(-1, 0.5, -2), new THREE.Vector3(0, 0, -30), new THREE.Vector3(10, 20, -500)];
    let worstOurs = 0;
    let worstNaive = 0;
    let lastV = new THREE.Matrix4();
    let lastP = new THREE.Matrix4();
    let lastMv: number[] | null = null;
    for (let fr = 0; fr < 60; fr++) {
      // The camera walks and turns (1.5 m/s at 60 a second, and a turn), looking down -z.
      camera.position.set(far + 0.025 * fr, 1.7 + 0.002 * Math.sin(fr), -far - 0.01 * fr);
      camera.rotation.set(0.01 * Math.sin(fr * 0.1), 0.004 * fr, 0);
      camera.updateMatrixWorld();
      motionFrame(camera);
      motionMatrices(mats);
      const mv = mulMF(camera.matrixWorldInverse.elements, model.elements);
      if (fr > 0) {
        for (const l of locals) {
          const world = l.clone().applyMatrix4(model);
          const [ex, ey] = exact(camera.projectionMatrix, camera.matrixWorldInverse, lastP, lastV, world, world);
          const pv = mulF(mv, [l.x, l.y, l.z, 1]);
          const [cx, cy] = card(pv, null);
          worstOurs = Math.max(worstOurs, px(cx - ex, cy - ey));
          // Three's own velocity's way (last frame's projection times its view times the world matrix, on the card): its two
          // places carry the world's middle in floats apart.
          const cur = mulF(camera.projectionMatrix.elements, pv);
          const prevPv = mulF(lastMv!, [l.x, l.y, l.z, 1]);
          const prev = mulF(lastP.elements, prevPv);
          worstNaive = Math.max(worstNaive, px(f(cur[0] / cur[3]) - f(prev[0] / prev[3]) - ex, f(cur[1] / cur[3]) - f(prev[1] / prev[3]) - ey));
        }
      }
      lastV = camera.matrixWorldInverse.clone();
      lastP = camera.projectionMatrix.clone();
      lastMv = mv;
    }
    ok(worstOurs < 0.01, `still things ${far} m from the middle: within ${worstOurs.toFixed(5)} px of the exact motion over 60 frames of a walk and a turn (three's own velocity's way: ${worstNaive.toFixed(4)} px)`);
    console.log(`  still, ${String(far).padStart(5)} m out: ours ${worstOurs.toFixed(5)} px from exact, three's velocity's way ${worstNaive.toFixed(4)} px`);
  }
  // A mover 16 km out (a speeder at 40 m/s turning), its own change worked at its refresh (`moverDelta`), the camera following.
  for (const far of [0, 16000]) {
    resetMotionForTests();
    const ship = new THREE.Object3D();
    const corner = new THREE.Vector3(1.2, 0.4, -2.5);
    let worst = 0;
    let lastV = new THREE.Matrix4();
    let lastP = new THREE.Matrix4();
    let lastWorld = new THREE.Vector3();
    const w = new THREE.Matrix4();
    let stamps = 0;
    for (let fr = 0; fr < 40; fr++) {
      ship.position.set(far + 0.66 * fr, 2 + 0.05 * fr, -far - 0.2 * fr);
      ship.rotation.set(0, 0.02 * fr, 0.01 * fr);
      ship.updateMatrixWorld();
      camera.position.set(far + 0.66 * fr - 6, 4, -far - 0.2 * fr + 9);
      camera.lookAt(ship.position);
      camera.updateMatrixWorld();
      motionFrame(camera);
      motionMatrices(mats);
      // Three refreshes it in full (its matrix moved): its two object uniforms are asked, the change and its frame.
      moverDelta(ship, w);
      const stamp = moverStamp(ship);
      const world = corner.clone().applyMatrix4(ship.matrixWorld);
      if (fr >= 1) {
        ok(stamp === motionFrameNo(), `frame ${fr}: a mover's change is taken on its own frame`);
        stamps++;
        const mv = mulMF(camera.matrixWorldInverse.elements, ship.matrixWorld.elements);
        const pv = mulF(mv, [corner.x, corner.y, corner.z, 1]);
        const [ex, ey] = exact(camera.projectionMatrix, camera.matrixWorldInverse, lastP, lastV, world, lastWorld);
        const [cx, cy] = card(pv, w);
        worst = Math.max(worst, px(cx - ex, cy - ey));
      } else ok(stamp === 0, `frame ${fr}: the first frame it is met reads as still (no last place known on the frame before)`);
      lastV = camera.matrixWorldInverse.clone();
      lastP = camera.projectionMatrix.clone();
      lastWorld = world;
    }
    ok(stamps > 30 && worst < 0.01, `a mover ${far} m out, its own change on top of the camera's: within ${worst.toFixed(5)} px of the exact motion`);
    console.log(`  mover, ${String(far).padStart(5)} m out: ours ${worst.toFixed(5)} px from exact`);
  }
  // The stamp: a stop, a start, a return after hiding.
  {
    resetMotionForTests();
    const o = new THREE.Object3D();
    const w = new THREE.Matrix4();
    const cam = new THREE.PerspectiveCamera();
    const step = (moveBy: number | null): number => {
      motionFrame(cam);
      if (moveBy !== null) {
        o.position.x += moveBy;
        o.updateMatrixWorld();
      }
      // Three refreshes an object only when its matrix moved since its last draw (or at its first): `null` is a frame it is
      // not refreshed (still, or not drawn), where the card keeps the stamp it was last given.
      return moveBy === null ? -1 : (moverDelta(o, w), moverStamp(o));
    };
    const s0 = step(0);
    const s1 = step(1);
    const s2 = step(1);
    let cardStamp = s2;
    const f2 = motionFrameNo();
    const s3 = step(null);
    const f3 = motionFrameNo();
    ok(s0 === 0 && s1 === f2 - 1 && s2 === f2, `a start takes its change from its second refresh on (${s0}, ${s1}, ${s2})`);
    ok(s3 === -1 && cardStamp !== f3, 'stopped, three refreshes nothing, and the stamp the card holds is not this frame: the card reads it as still');
    const s4 = step(5);
    ok(s4 === 0, 'moving again after a frame unrefreshed (stood, or hidden), the first frame reads as still, never as a jump from where it last stood');
    cardStamp = s4;
    const s5 = step(1);
    ok(s5 === motionFrameNo() && cardStamp !== s5, 'and its change is taken again from the next');
    ok(w.equals(new THREE.Matrix4().makeTranslation(-1, 0, 0)), "the change takes this frame's place back to last frame's (a step of one along x; the camera at its default, the view the identity)");
  }
  // The sky: the camera's turn alone, its place a direction: the camera's walk adds nothing.
  {
    resetMotionForTests();
    let worst = 0;
    let lastV = new THREE.Matrix4();
    let lastP = new THREE.Matrix4();
    for (let fr = 0; fr < 30; fr++) {
      camera.position.set(16000 + 3 * fr, 50 + fr, -16000);
      camera.rotation.set(0.02 * fr, 0.03 * fr, 0);
      camera.updateMatrixWorld();
      motionFrame(camera);
      motionMatrices(mats);
      if (fr > 0) {
        for (const d of [new THREE.Vector3(0.3, 0.2, -1), new THREE.Vector3(-0.8, 0.1, -0.4)]) {
          // The dome about the camera: its view place is the direction turned into view space.
          const pvD = d.clone().normalize().multiplyScalar(4000).transformDirection(camera.matrixWorldInverse).multiplyScalar(4000);
          const a = new THREE.Vector4(pvD.x, pvD.y, pvD.z, 0).applyMatrix4(camera.projectionMatrix);
          const worldDir = d.clone().normalize();
          const lastViewDir = worldDir.clone().transformDirection(lastV);
          const b = new THREE.Vector4(lastViewDir.x, lastViewDir.y, lastViewDir.z, 0).applyMatrix4(lastP);
          const ex = a.x / a.w - b.x / b.w;
          const ey = a.y / a.w - b.y / b.w;
          const [cx, cy] = card([pvD.x, pvD.y, pvD.z], null, true);
          worst = Math.max(worst, px(cx - ex, cy - ey));
        }
      }
      lastV = camera.matrixWorldInverse.clone();
      lastP = camera.projectionMatrix.clone();
    }
    ok(worst < 0.01, `the sky writes the camera's turn alone, 16 km out with the camera walking: within ${worst.toFixed(5)} px`);
  }
  // A body's delta (the pool's last skinned place less this one's, in the mesh's space) turned into view space by the
  // model-view's turn alone: the same as the model-view taken whole of last frame's place, with nothing of the middle in it.
  {
    const model = new THREE.Matrix4().compose(new THREE.Vector3(16000, 2, -16000), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.7, 0)), new THREE.Vector3(1, 1, 1));
    camera.position.set(16003, 3.5, -16004);
    camera.lookAt(16000, 2, -16000);
    camera.updateMatrixWorld();
    const mv = mulMF(camera.matrixWorldInverse.elements, model.elements);
    const cur = [0.1, 1.2, 0.05];
    const prev = [0.12, 1.19, 0.04];
    const pv = mulF(mv, [...cur, 1]);
    const turned = [0, 1, 2].map((r) => f(f(f(mv[r] * f(prev[0] - cur[0])) + f(mv[4 + r] * f(prev[1] - cur[1]))) + f(mv[8 + r] * f(prev[2] - cur[2]))));
    const before = [f(pv[0] + turned[0]), f(pv[1] + turned[1]), f(pv[2] + turned[2])];
    const exactPrev = new THREE.Vector3(...prev).applyMatrix4(model).applyMatrix4(camera.matrixWorldInverse);
    const exactCur = new THREE.Vector3(...cur).applyMatrix4(model).applyMatrix4(camera.matrixWorldInverse);
    const errDelta = Math.hypot(before[0] - pv[0] - (exactPrev.x - exactCur.x), before[1] - pv[1] - (exactPrev.y - exactCur.y), before[2] - pv[2] - (exactPrev.z - exactCur.z));
    ok(errDelta < 1e-6, `a body's delta in view space, 16 km out, is the exact delta to ${errDelta.toExponential(2)} m (the turn alone carries no place)`);
  }
  // The wave's fixer: the ropes laid on the CPU, the game's own `RopeRibbon` and `ChainRibbon`, made as on WebGPU (the runtime's
  // `laid` is `laidMotion`), laid frame by frame as the hand swings and the camera walks 16 km out, each vertex's motion on the card
  // (its view place, plus the laid change turned by the view's turn, through last frame's matrix) against the exact motion of
  // the very vertex drawn (last frame's laid place by last frame's camera); and the frames that read as still.
  /** The half-float buffer's own step at a motion of `p` pixels a frame (what the buffer itself can hold of it). */
  const halfStep = (p: number): number => Math.pow(2, Math.floor(Math.log2(p / (W / 2))) - 10) * (W / 2);
  for (const far of [0, 16000]) {
    resetMotionForTests();
    MOTION.applied = true;
    const gpu = GPU as Any;
    const had = { webgpu: gpu.webgpu, rt: gpu.rt };
    gpu.webgpu = true;
    gpu.rt = { motion: { laid: laidMotion } };
    const rope = new RopeRibbon(16, 8);
    const strip = new ChainRibbon();
    gpu.webgpu = had.webgpu;
    gpu.rt = had.rt;
    const plain = new RopeRibbon(16, 8);
    ok(rope.mesh.geometry.getAttribute(LAID_ATTRIBUTE)?.itemSize === 3 && strip.mesh.geometry.getAttribute(LAID_ATTRIBUTE)?.itemSize === 3 && MOTION_STATS.laid === 2, "made on WebGPU, a rope's strip and a chain's carry the laid change, registered once each");
    ok(plain.mesh.geometry.getAttribute(LAID_ATTRIBUTE) === undefined && Object.keys(plain.mesh.geometry.attributes).join() === 'position,normal', 'made on WebGL, the strip is as it was: its position and normal alone');
    ok(motionPlan(rope.mesh.material, false, true).previous === 'laid' && motionPlan(plain.mesh.material, false, false).previous === 'rigid', "the rope's plan reads its geometry: laid where it carries the change (the attribute's name is in three's key), rigid where not");
    const scene = new THREE.Scene();
    scene.add(rope.mesh, strip.mesh);
    const curve = new RopeCurve();
    const fixed = new Float64Array(3 * 16);
    let worst = 0;
    let worstMotion = 0;
    let lastV = new THREE.Matrix4();
    let lastP = new THREE.Matrix4();
    let lastRope: Float32Array | null = null;
    let lastStrip: Float32Array | null = null;
    const ropePos = rope.mesh.geometry.getAttribute('position').array as Float32Array;
    const stripPos = strip.mesh.geometry.getAttribute('position').array as Float32Array;
    const ropeD = rope.mesh.geometry.getAttribute(LAID_ATTRIBUTE).array as Float32Array;
    const stripD = strip.mesh.geometry.getAttribute(LAID_ATTRIBUTE).array as Float32Array;
    const zeros = (a: Float32Array): boolean => a.every((x) => x === 0);
    const still: string[] = [];
    let wrongChange = 0;
    let checked = 0;
    for (let fr = 0; fr < 40; fr++) {
      // The camera walks and turns; the rope hangs from an anchor 12 m up, the hand swinging 6 m/s; the chain sways.
      camera.position.set(far + 0.025 * fr, 1.7, -far + 4 - 0.01 * fr);
      camera.rotation.set(0.02, 0.006 * fr, 0);
      camera.updateMatrixWorld();
      fixed.set([far + 1, 12, -far - 2]);
      rope.slack = 0.5;
      rope.screenH = 900;
      rope.lay(fixed, 1, { x: far + 1 + 0.1 * Math.sin(fr * 0.3) * 10, y: 1.2, z: -far - 2 + 0.05 * fr }, camera);
      // A ring more from frame 20 on (a hand put on the rope), so at 20 a vertex is not last frame's: it reads as still.
      const n = fr >= 20 ? 13 : 12;
      curve.count = n;
      for (let i = 0; i < n; i++) {
        curve.ring[3 * i] = far - 2 + 0.05 * Math.sin(fr * 0.2 + i);
        curve.ring[3 * i + 1] = 10 - 0.8 * i;
        curve.ring[3 * i + 2] = -far - 3 + 0.03 * fr;
        curve.along[i] = 0.8 * i;
      }
      strip.screenH = 900;
      strip.lay(curve, camera);
      // Hidden at frame 30 and shown again at 31: its first frame back reads as still, never a jump.
      rope.mesh.visible = fr !== 30;
      scene.updateMatrixWorld();
      motionFrame(camera);
      motionMatrices(mats);
      if (fr === 0 || fr === 20 || fr === 31) still.push(`${fr}: rope ${zeros(ropeD)}, chain ${fr === 31 ? 'n/a' : zeros(stripD)}`);
      if (fr === 0) ok(zeros(ropeD) && zeros(stripD), 'the first frame drawn reads as still (nothing laid the frame before)');
      if (fr === 20) ok(zeros(stripD) && !zeros(ropeD), "a frame the chain's draw range changed reads as still, the rope beside it as it moved");
      if (fr === 31) ok(zeros(ropeD), 'the first frame back after being hidden reads as still');
      if (fr > 0 && fr !== 20 && fr !== 30 && fr !== 31) {
        const mv = camera.matrixWorldInverse.elements;
        for (const [pos, d, lastPos, rings] of [[ropePos, ropeD, lastRope, rope.rings], [stripPos, stripD, lastStrip, strip.rings]] as const) {
          for (let v = 0; v < 2 * rings; v++) {
            const x = [pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]];
            const was = new THREE.Vector3(lastPos![3 * v], lastPos![3 * v + 1], lastPos![3 * v + 2]);
            if (d[3 * v] !== f(was.x - x[0]) || d[3 * v + 1] !== f(was.y - x[1]) || d[3 * v + 2] !== f(was.z - x[2])) wrongChange++;
            checked++;
            const [ex, ey] = exact(camera.projectionMatrix, camera.matrixWorldInverse, lastP, lastV, new THREE.Vector3(...x), was);
            // The card: three's view place (the mesh's matrix the identity), and the change turned by the view's turn alone.
            const pv = mulF(mv, [x[0], x[1], x[2], 1]);
            const turned = [0, 1, 2].map((r) => f(f(f(f(mv[r]) * f(d[3 * v])) + f(f(mv[4 + r]) * f(d[3 * v + 1]))) + f(f(mv[8 + r]) * f(d[3 * v + 2]))));
            const before = [f(pv[0] + turned[0]), f(pv[1] + turned[1]), f(pv[2] + turned[2]), 1];
            const cur = mulF(mats.pNow.elements, [pv[0], pv[1], pv[2], 1]);
            const prev = mulF(mats.dPrev.elements, before);
            const cx = f(f(cur[0] / cur[3]) - f(prev[0] / prev[3]));
            const cy = f(f(cur[1] / cur[3]) - f(prev[1] / prev[3]));
            worst = Math.max(worst, px(cx - ex, cy - ey));
            worstMotion = Math.max(worstMotion, px(ex, ey));
          }
        }
      }
      lastV = camera.matrixWorldInverse.clone();
      lastP = camera.projectionMatrix.clone();
      lastRope = Float32Array.from(ropePos);
      lastStrip = Float32Array.from(stripPos);
    }
    ok(checked > 1000 && wrongChange === 0, `each vertex's change is its last frame's laid place less this frame's, as 32-bit floats (${checked} vertex frames, ${wrongChange} otherwise)`);
    // At the middle within a thousandth of a pixel; far out, the rope's vertices are world places in 32-bit floats as they were
    // before this pass (the strip draws so), whose rounding shows in a fast rope's motion, held under the buffer's own step there.
    const bound = far === 0 ? 0.001 : Math.max(0.01, halfStep(worstMotion));
    ok(worstMotion > 5 && worst < bound, `the ropes laid on the CPU ${far} m out: within ${worst.toFixed(5)} px of the exact motion of each vertex drawn (bound ${bound.toFixed(4)} px, the half-float buffer's own step at ${worstMotion.toFixed(1)} px a frame being ${halfStep(worstMotion).toFixed(4)})`);
    console.log(`  ropes laid, ${String(far).padStart(5)} m out: ours ${worst.toFixed(5)} px from exact (motion up to ${worstMotion.toFixed(1)} px, the buffer's step there ${halfStep(worstMotion).toFixed(4)} px); still frames ${still.join('; ')}`);
    // Taken out of the scene, it is worked no more.
    rope.mesh.removeFromParent();
    const framesBefore = MOTION_STATS.laidFrames;
    motionFrame(camera);
    ok(MOTION_STATS.laidFrames === framesBefore + 1, 'a strip taken out of the scene is not worked (the chain still is)');
  }
}

// ---------------------------------------------------------------- 5. nothing allocated in a frame, in twelve fresh processes at once
{
  const me = fileURLToPath(import.meta.url);
  const runs = await Promise.all(
    Array.from({ length: 12 }, () =>
      new Promise<Record<string, number> | string>((res) => {
        const ch = spawn(process.execPath, ['--expose-gc', me, '--alloc'], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '';
        let err = '';
        ch.stdout.on('data', (x) => (out += x));
        ch.stderr.on('data', (x) => (err += x));
        ch.on('close', () => {
          try {
            res(JSON.parse(out.trim().split('\n').pop() ?? ''));
          } catch {
            res(`no answer: ${err.slice(0, 300)}`);
          }
        });
      }),
    ),
  );
  const bad = runs.filter((r) => typeof r === 'string');
  ok(bad.length === 0, `every process answered (${bad.join('; ')})`);
  const got = runs as Record<string, number>[];
  ok(got.every((r) => r.laidFrames > 20000), `the laid rope's change was worked at every measured frame (${got.map((r) => r.laidFrames).join(' ')})`);
  for (const [k, what] of [['frame', "a frame's movers (an object, its two refreshes)"], ['camera', "the camera's change, the last-frame copies and a laid rope's change"]] as const) {
    const v = got.map((r) => r[k]);
    const said = v.map((x) => (Number.isFinite(x) ? x.toFixed(3) : 'no clean window')).join(' ');
    ok(v.every((x) => Number.isFinite(x) && x < 0.5), `${what} allocates nothing in 12 of 12 processes (${said} B a call)`);
    console.log(`  ${what}: ${said} B a call`);
  }
}

console.log(`gpuMotion: ${checks} checks passed`);
