// The grass's shadow held to its mirror in the browser (wave 8, `__debug.grassShadowSelfTest()`), as the ground's,
// the highlight's and the sway's self-tests hold theirs: node compiles no GLSL, so only a real program drawn can say
// that the grass's shadow lookup reads what `grassShadowMath.ts` says it reads.
//
// **Numbers first.** The grass's own program, compiled as the colour program is (no `SWG_GRASS_DEPTH`) with its own
// fragment stage writing the shade it reads (`SWG_GRASS_PROBE`), is drawn as one tuft facing a camera into a float
// target, against three stand-in maps of known depth (a 1x1 depth target cleared to a value) and matrices of ours
// that put each corner's coordinate where the case wants it, one cascade at a time alone able to shade (its own map
// and matrix, the others' lit), so a program that reads one cascade's map, matrix or bias out of another's slot
// cannot pass; the shade read back is held to `grassShadeAt` at each cascade's boundaries on both sides, through
// the last cascade's far fade, and with the lift and the bias on and off. **Then a real
// shadow pass**, off-screen with a directional light of its own: a tuft under a box darkens with receiving on and not
// off, and a tuft standing on the ground behind a casting tuft darkens with casting on and not off. Nothing it makes is
// the world's: its uniforms are copies, its light and targets its own, all let go of after; it builds a few programs
// of its own (another light set), so it runs after `shaders().builtInPlay` is read, never before.
import * as THREE from 'three';
import { GRASS_FRAGMENT, GRASS_NO_SHADOW, GRASS_VERTEX, grassDepthMaterial, grassMaterial, tuftMesh, grassForDepthMode } from './grass.ts';
import { SWAY_STIFF, tuftBuffers } from './grassMath.ts';
import { grassShadeAt, type GrassCascades } from './grassShadowMath.ts';

/** The probe: the grass's own two stages, the fragment's writing the shade it reads in every channel. */
function probeOf(base: THREE.ShaderMaterial, own: Record<string, THREE.IUniform>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ name: 'grass shadow probe', defines: { SWG_GRASS_PROBE: '' }, uniforms: ownUniforms(base, own), vertexShader: GRASS_VERTEX, fragmentShader: grassForDepthMode(GRASS_FRAGMENT), depthTest: false, depthWrite: false });
}

/** A material's uniforms copied: every value by reference but the ones the test writes, which are its own. */
function ownUniforms(base: THREE.ShaderMaterial, own: Record<string, THREE.IUniform>): Record<string, THREE.IUniform> {
  const out: Record<string, THREE.IUniform> = {};
  for (const [k, u] of Object.entries(base.uniforms)) out[k] = { value: u.value };
  return Object.assign(out, own);
}

/** A 1x1 depth map holding one depth everywhere, read with a compare as the cascades are. */
function depthMap(renderer: THREE.WebGLRenderer, depth: number): THREE.WebGLRenderTarget {
  const t = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true });
  t.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  t.depthTexture.compareFunction = THREE.LessEqualCompare;
  t.depthTexture.minFilter = THREE.NearestFilter;
  t.depthTexture.magFilter = THREE.NearestFilter;
  fillDepth(renderer, t, depth);
  return t;
}

/** A depth map of `depthMap`'s cleared to another depth, in place. */
function fillDepth(renderer: THREE.WebGLRenderer, t: THREE.WebGLRenderTarget, depth: number): void {
  renderer.setRenderTarget(t);
  renderer.state.buffers.depth.setClear(depth);
  renderer.clear(false, true, false);
  renderer.state.buffers.depth.setClear(1);
}

/** One tuft standing at `at`, `size` metres wide and tall, still (no sway), lit by nothing of its own. */
function oneTuft(material: THREE.Material, at: THREE.Vector3, size: number, depth: THREE.Material | null = null): THREE.Mesh {
  const b = tuftBuffers(1);
  b.count = 1;
  b.tuft.set([at.x, at.y, at.z, 0]);
  b.size.set([size, size, 0, 0]);
  b.tint.set([1, 1, 1, 0]);
  b.sway.set([SWAY_STIFF, 0, 1000, 0]);
  b.normal.set([0, 1, 0]);
  const mesh = tuftMesh(b, material, depth, false);
  mesh.frustumCulled = false;
  return mesh;
}

export interface GrassShadowSelfTest {
  ok: boolean;
  /** Each numeric case: the shade drawn, the mirror's, and the difference. */
  cases: { name: string; got: number; want: number; off: number }[];
  /** Through a real shadow pass: the shade under the box with receiving on and off, and behind the caster with casting on and off. */
  real: { underBoxReceiving: number; underBoxNot: number; behindCasterCasting: number; behindCasterNot: number };
  nan: boolean;
  note: string;
}

export function grassShadowSelfTest(renderer: THREE.WebGLRenderer): GrassShadowSelfTest {
  // The stand-in maps (a LessEqual compare, cleared to known depths), the matrices and the mirror (grassShadowMath.ts)
  // all model ordinary depth. Under reversed depth the grass's own text turns its bias and far test round
  // (grass.ts, grassForDepthMode; reversedDepthOn.test.ts holds it), and this test would only report differences of
  // its own making, so it does not run: load the page with ?norevz to run it.
  if (renderer.capabilities.reversedDepthBuffer) {
    return { ok: false, cases: [], real: { underBoxReceiving: NaN, underBoxNot: NaN, behindCasterCasting: NaN, behindCasterNot: NaN }, nan: false, note: 'not run: this test models ordinary depth and the page draws with reversed depth; load with ?norevz to run it' };
  }
  const made: { dispose(): void }[] = [];
  const keepTarget = renderer.getRenderTarget();
  const keepClear = renderer.getClearColor(new THREE.Color());
  const keepAlpha = renderer.getClearAlpha();
  const keepShadows = renderer.shadowMap.enabled;
  const keepShadowType = renderer.shadowMap.type;
  const keepAuto = renderer.shadowMap.autoUpdate;
  const cases: GrassShadowSelfTest['cases'] = [];
  let nan = false;
  const real = { underBoxReceiving: Number.NaN, underBoxNot: Number.NaN, behindCasterCasting: Number.NaN, behindCasterNot: Number.NaN };
  try {
    // ---------------------------------------------------------------- the numbers
    const base = grassMaterial();
    made.push(base);
    const maps = [depthMap(renderer, 0.2), depthMap(renderer, 0.2), depthMap(renderer, 0.2)];
    made.push(...maps);
    const stored = [0.2, 0.2, 0.2];
    const matrices = [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()];
    const ranges = new Float32Array([0, 0.1, 0.1, 0.3, 0.3, 1]);
    const RANGE = 100;
    const INTENSITY = 0.8;
    const u = {
      uSwgGrassReach: { value: new THREE.Vector4(1000, 0.25, 500, 0.1) },
      uSwgGrassMode: { value: new THREE.Vector4(0, 0, 0.5, 1) },
      uSwgGrassShow: { value: new THREE.Vector2(1, 1) },
      uSwgLeafSun: { value: new THREE.Vector3(0, 0, 1) },
      uSwgGrassShadow0: { value: maps[0].depthTexture },
      uSwgGrassShadow1: { value: maps[1].depthTexture },
      uSwgGrassShadow2: { value: maps[2].depthTexture },
      uSwgGrassShadowMatrix: { value: matrices },
      uSwgGrassCascade: { value: ranges },
      uSwgGrassShadowRange: { value: RANGE },
      uSwgGrassCascadeFade: { value: 1 },
      uSwgGrassShadowBias: { value: new THREE.Vector3() },
      uSwgGrassShadowOn: { value: new THREE.Vector3(1, 0, INTENSITY) },
      uSwgGrassReceive: { value: new THREE.Vector2(1, 1) },
      uSwgGrassFarLift: { value: 0 },
    };
    const probe = probeOf(base, u);
    made.push(probe);
    const tuft = oneTuft(probe, new THREE.Vector3(0, 0, 0), 1);
    made.push(tuft.geometry);
    const scene = new THREE.Scene();
    scene.add(tuft);
    const target = new THREE.WebGLRenderTarget(3, 3, { type: THREE.FloatType, depthBuffer: false });
    made.push(target);
    const camera = new THREE.PerspectiveCamera(0.2, 1, 0.1, 1000);
    const px = new Float32Array(4 * 9);
    const draw = (): number => {
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, 3, 3, px);
      for (const v of px) if (!Number.isFinite(v)) nan = true;
      return px[4 * 4];
    };
    // Every corner of the tuft stands on z = 0 (it faces the eye down the z axis), so a matrix of ours that reads z
    // alone gives the whole tuft one coordinate: x held at `x` (the map's middle, or off it at 1.5), y at the
    // middle, z = a z + b.
    const flat = (m: THREE.Matrix4, a: number, b: number, x = 0.5) => m.set(0, 0, 0, x, 0, 0, 0, 0.5, 0, 0, a, b, 0, 0, 0, 1);
    // One cascade alone can shade: its own map holds 0.2 under the tuft's 0.5 and its own matrix lands on the map,
    // while every other map holds 0.8 and every other matrix lands off it. So a program that read a cascade's map,
    // its matrix or its bias out of another cascade's slot, or picked the wrong cascade, reads lit where the mirror
    // reads shaded (or the other way round), which no setting of three maps alike can show.
    const isolate = (k: number) => {
      for (let i = 0; i < 3; i++) {
        const depth = i === k ? 0.2 : 0.8;
        if (stored[i] !== depth) fillDepth(renderer, maps[i], depth);
        stored[i] = depth;
        flat(matrices[i], 0, 0.5, i === k ? 0.5 : 1.5);
      }
    };
    const at = new THREE.Vector3();
    const run = (name: string, d: number, lift: number, bias: [number, number, number] = [0, 0, 0]) => {
      camera.position.set(0, 0.5, d);
      camera.lookAt(0, 0.5, 0);
      camera.updateMatrixWorld();
      u.uSwgGrassShadowOn.value.y = lift;
      u.uSwgGrassShadowBias.value.set(bias[0], bias[1], bias[2]);
      const got = draw();
      const c: GrassCascades = { ranges, range: RANGE, fade: true };
      const want = grassShadeAt(d / RANGE, c, INTENSITY, (i) => at.set(0, 0.5, lift * 1).applyMatrix4(matrices[i]), bias, (i) => stored[i]);
      cases.push({ name, got: Number(got.toFixed(4)), want: Number(want.toFixed(4)), off: Number(Math.abs(got - want).toFixed(4)) });
    };
    isolate(0);
    run('cascade 0 alone shading: just short of its end (shaded)', 9.5, 0);
    run('cascade 0 alone shading: just past its end, in cascade 1 (lit)', 10.5, 0);
    isolate(1);
    run('cascade 1 alone shading: just past cascade 0\'s end (shaded)', 10.5, 0);
    run('cascade 1 alone shading: just short of cascade 0\'s end (lit)', 9.5, 0);
    run('cascade 1 alone shading: just short of its own end (shaded)', 29.5, 0);
    run('cascade 1 alone shading: just past its end, in cascade 2 (lit)', 30.5, 0);
    isolate(2);
    run('cascade 2 alone shading: just past cascade 1\'s end (shaded)', 30.5, 0);
    run('cascade 2 alone shading: just short of cascade 1\'s end (lit)', 29.5, 0);
    run('cascade 2 alone shading: inside its fade', 95, 0);
    run('cascade 2 alone shading: at its far end', 100, 0);
    run('cascade 2 alone shading: past the fade (lit)', 115, 0);
    // The lift: the first cascade reads z, a corner at z 0 shaded and one lifted a metre toward the sun (+z) lit.
    isolate(0);
    flat(matrices[0], -0.05, 0.525);
    fillDepth(renderer, maps[0], 0.5);
    stored[0] = 0.5;
    run('the lift off (the tuft at its own place, shaded)', 5, 0);
    run('the lift on (a metre toward the sun, lit)', 5, 1);
    run('cascade 0\'s own bias lowering the compared depth (lit)', 5, 0, [-0.03, 0, 0]);
    run('the other cascades\' bias, not its own (shaded)', 5, 0, [0, -0.03, -0.03]);
    // Off the map: lit whatever the map holds.
    flat(matrices[0], 0, 0.9, 1.5);
    run('off the map (lit)', 5, 0);

    // ---------------------------------------------------------------- a real shadow pass
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = true;
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.castShadow = true;
    light.shadow.mapSize.set(256, 256);
    const sc = light.shadow.camera as THREE.OrthographicCamera;
    sc.left = -5;
    sc.right = 5;
    sc.top = 5;
    sc.bottom = -5;
    sc.near = 0.5;
    sc.far = 40;
    sc.updateProjectionMatrix();
    const world = new THREE.Scene();
    world.add(light, light.target);
    light.target.position.set(0, 0, 0);
    // A camera looking away from everything: the pass draws only the shadow maps.
    const away = new THREE.PerspectiveCamera(10, 1, 0.1, 2);
    away.position.set(0, 100, 0);
    away.lookAt(0, 200, 0);
    away.updateMatrixWorld();
    const sink = new THREE.WebGLRenderTarget(1, 1);
    made.push(sink);
    const shadowPass = () => {
      light.updateMatrixWorld();
      light.target.updateMatrixWorld();
      renderer.shadowMap.needsUpdate = true;
      renderer.setRenderTarget(sink);
      renderer.render(world, away);
    };
    // The probe reads the light's own map and matrix, the whole of it in cascade 0 and no fade.
    const realU = {
      uSwgGrassReach: { value: new THREE.Vector4(1000, 0.25, 500, 0.1) },
      uSwgGrassMode: { value: new THREE.Vector4(0, 0, 0.5, 1) },
      uSwgGrassShow: { value: new THREE.Vector2(1, 1) },
      uSwgLeafSun: { value: new THREE.Vector3(0, 1, 0) },
      uSwgGrassShadow0: { value: GRASS_NO_SHADOW as THREE.Texture },
      uSwgGrassShadow1: { value: GRASS_NO_SHADOW as THREE.Texture },
      uSwgGrassShadow2: { value: GRASS_NO_SHADOW as THREE.Texture },
      uSwgGrassShadowMatrix: { value: [light.shadow.matrix, light.shadow.matrix, light.shadow.matrix] },
      uSwgGrassCascade: { value: new Float32Array([0, 1, 1, 1, 1, 1]) },
      uSwgGrassShadowRange: { value: 1000 },
      uSwgGrassCascadeFade: { value: 0 },
      uSwgGrassShadowBias: { value: new THREE.Vector3() },
      uSwgGrassShadowOn: { value: new THREE.Vector3(1, 1, 1) },
      uSwgGrassReceive: { value: new THREE.Vector2(1, 1) },
      uSwgGrassFarLift: { value: 0 },
    };
    const realProbe = probeOf(base, realU);
    made.push(realProbe);
    const look = (at: THREE.Vector3): number => {
      // Never null: a null shadow sampler drops the draw, which would read as a shadow.
      const map = light.shadow.map?.depthTexture ?? GRASS_NO_SHADOW;
      realU.uSwgGrassShadow0.value = map;
      realU.uSwgGrassShadow1.value = map;
      realU.uSwgGrassShadow2.value = map;
      const p = oneTuft(realProbe, at, 0.2);
      made.push(p.geometry);
      const s = new THREE.Scene();
      s.add(p);
      camera.fov = 2;
      camera.updateProjectionMatrix();
      camera.position.set(at.x, at.y + 0.1, at.z + 3);
      camera.lookAt(at.x, at.y + 0.1, at.z);
      camera.updateMatrixWorld();
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(s, camera);
      renderer.readRenderTargetPixels(target, 0, 0, 3, 3, px);
      for (const v of px) if (!Number.isFinite(v)) nan = true;
      return px[4 * 4];
    };
    // Receiving: the sun straight down, a box three metres over a tuft.
    light.position.set(0, 10, 0.001);
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 2), new THREE.MeshBasicMaterial());
    box.position.set(0, 3, 0);
    box.castShadow = true;
    world.add(box);
    made.push(box.geometry, box.material as THREE.Material);
    shadowPass();
    real.underBoxReceiving = Number(look(new THREE.Vector3(0, 0, 0)).toFixed(4));
    realU.uSwgGrassReceive.value.x = 0;
    real.underBoxNot = Number(look(new THREE.Vector3(0, 0, 0)).toFixed(4));
    realU.uSwgGrassReceive.value.x = 1;
    world.remove(box);
    // Casting: the sun forty-five degrees up from +z, a two-metre tuft at the origin turned across it, and a small tuft
    // a metre and a half behind it on the ground, in its shadow.
    light.position.set(0, 10, 10);
    realU.uSwgLeafSun.value.set(0, 1, 1).normalize();
    const colour = grassMaterial();
    const depth = grassDepthMaterial();
    made.push(colour, depth);
    // A picture of its own, solid, and no cut: the casting tuft is whole whatever world's pictures are loaded.
    const solid = new THREE.DataArrayTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, 1);
    solid.needsUpdate = true;
    made.push(solid);
    const castU = { uSwgGrassMap: { value: solid }, uSwgGrassReach: { value: new THREE.Vector4(1000, 0.25, 500, 0.1) }, uSwgGrassShow: { value: new THREE.Vector2(1, 1) }, uSwgGrassCast: { value: new THREE.Vector3(1, 0, 1) }, uSwgGrassCastCut: { value: 0 }, uSwgLeafSun: { value: realU.uSwgLeafSun.value }, uSwayEye: { value: new THREE.Vector3(0, 1.7, 3) } };
    depth.uniforms = ownUniforms(depth, castU);
    const caster = oneTuft(colour, new THREE.Vector3(0, 0, 0), 2, depth);
    made.push(caster.geometry);
    caster.castShadow = true;
    // Culled by its sphere, so the camera looking away never draws it in colour: the shadow pass alone does.
    caster.frustumCulled = true;
    world.add(caster);
    shadowPass();
    real.behindCasterCasting = Number(look(new THREE.Vector3(0, 0, -1.5)).toFixed(4));
    castU.uSwgGrassCast.value.x = 0;
    shadowPass();
    real.behindCasterNot = Number(look(new THREE.Vector3(0, 0, -1.5)).toFixed(4));
    world.remove(caster);
    light.shadow.map?.dispose();
    light.dispose();
  } finally {
    renderer.shadowMap.enabled = keepShadows;
    renderer.shadowMap.type = keepShadowType;
    renderer.shadowMap.autoUpdate = keepAuto;
    renderer.shadowMap.needsUpdate = true;
    renderer.setClearColor(keepClear, keepAlpha);
    renderer.setRenderTarget(keepTarget);
    for (const m of made) m.dispose();
  }
  const numbers = cases.every((c) => c.off <= 2e-3);
  const realOk = real.underBoxReceiving < 0.5 && real.underBoxNot > 0.99 && real.behindCasterCasting < 0.5 && real.behindCasterNot > 0.99;
  return {
    ok: numbers && realOk && !nan,
    cases,
    real,
    nan,
    note: `${cases.filter((c) => c.off <= 2e-3).length} of ${cases.length} cases on the mirror; a real shadow pass ${realOk ? 'darkens the tuft under the box only while receiving and the one behind the caster only while casting' : 'did not darken as it should'}${nan ? '; a NaN was read' : ''}. Built programs of its own (another light set): read shaders().builtInPlay before running it, not after.`,
  };
}
