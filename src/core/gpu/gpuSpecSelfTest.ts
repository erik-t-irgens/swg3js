// `__debug.specSelfTest()` on WebGPU (the GPU port's step 4, item 1): the WebGL self-test's sphere (`specular.ts`), drawn
// through the lighting model of ours (`gpuSpec.ts`) and read back, every pixel held to `specMath.clientSpecular` within
// the WebGL test's own tolerances: the client's cases under 0.02 of a white surface facing the light, the switch to
// three's GGX under 0.01 of an unwrapped standard material's own node copy, building no pipeline to do it.
//
// Three things differ from the WebGL test, each said in the answer: the readback is three's asynchronous one (a WebGPU
// texture's first row is its top, so a row is turned over to stand where the WebGL test reads it); each case draws a
// material of its own, since three writes an object's own uniforms (a material's mode, colour and power) only when it first
// draws it or its material or matrix moves; and the weather's cases are not drawn, the wetness being a remake of the
// owner's that is not on WebGPU (its share is nought there, `CLIENT_SPEC_WEATHER`). It also draws the console's look
// switch (`gpu({ look: { spec: false } })`), which must be three's GGX as the `use: 'three'` switch is.

//
// Two cases light the sphere with a point light (the rooms' lamps are point lights): the client's term with the light's
// colour attenuated as three attenuates it (`getDistanceAttenuation`, decay 2 and no cutoff: one over the squared distance,
// held off a hundredth), on a black surface; and the same lamp on a grey one, held to the uncut Lambert term plus the
// client's, which is the WebGL picture (0.185's diffuse, `threeHolds.ts` `light-diffuse`) the lighting model of ours gives
// back (`diffuseBackNode`). A third lights the grey one by an ambient light alone, held to the uncut ambient (`ambient-diffuse`). What it counts as built is pipelines made for its own sphere alone (`WARM_STATS.selfTestMade`,
// where the warm patch counts them; else three's whole cache, said), so the game building its own in the meantime is never
// read as the switch's; and its draws are never counted as made in play. It refuses in words, drawing nothing, where its
// part was left out at load or the highlight's wrap was skipped.

import * as THREE from 'three';
import { SPEC_TUNE, SPEC_UNIFORMS, applySpec, specUniformsOf } from '../../world/specular.ts';
import { clientSpecular, type SpecTune, type Vec3 } from '../../world/specMath.ts';
import { GPU_LOOKS } from './looks.ts';
import { SPEC_GPU_STATS, specSelfTestRefusal } from './gpuSpec.ts';
import { WARM_PATCH, WARM_STATS } from './patchWarm.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SELF_TEST_ROUGHNESS = 0.35;

function writeKnobs(t: SpecTune): void {
  SPEC_UNIFORMS.uSwgSpecUse.value = t.use === 'three' ? 1 : 0;
  SPEC_UNIFORMS.uSwgSpecGain.value = t.gain;
  SPEC_UNIFORMS.uSwgSpecCap.value = t.cap;
  SPEC_UNIFORMS.uSwgSpecFilm.value = t.film;
  SPEC_UNIFORMS.uSwgSpecGate.value = t.gate;
}

/** The place and strength of the point-light cases' lamp: up and to one side, about as bright at the sphere as the sun case's light. */
const LAMP: Vec3 = [1.2, 1.5, 3];
const LAMP_INTENSITY = 6 * Math.PI;
/** The grey of the diffuse case, in linear light. */
const LAMP_GREY = 0.5;
/** The ambient case's light: a white surface takes a third of it. */
const AMBIENT_INTENSITY = 2;

export async function specSelfTestGpu(renderer: Any): Promise<Record<string, unknown>> {
  const no = specSelfTestRefusal();
  if (no) return { renderer: 'WebGPU', ok: false, note: no };
  const size = 64;
  const scene = new THREE.Scene();
  const l: Vec3 = [0.35, 0.45, 1];
  const ll = Math.hypot(l[0], l[1], l[2]);
  l[0] /= ll;
  l[1] /= ll;
  l[2] /= ll;
  const light = new THREE.DirectionalLight(0xffffff, Math.PI);
  light.position.set(l[0], l[1], l[2]);
  light.target.position.set(0, 0, 0);
  scene.add(light, light.target);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.set(0, 0, 3);
  camera.updateMatrixWorld();
  const geometry = new THREE.SphereGeometry(1, 192, 96);
  const maskByte = 128;
  const maskTexture = new THREE.DataTexture(new Uint8Array([maskByte, 255, 0, 255]), 1, 1, THREE.RGBAFormat);
  maskTexture.needsUpdate = true;
  const made: THREE.Material[] = [];
  const makeMaterial = (map: THREE.Texture | null, mode: number, color: number, power: number, wrap = true, grey = 0): THREE.MeshStandardMaterial => {
    // Black but for the lamp's diffuse case, whose grey is in linear light (`Color(r, g, b)` is the working space's).
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(grey, grey, grey), metalness: 0, roughness: SELF_TEST_ROUGHNESS });
    if (map) {
      m.roughnessMap = map;
      m.metalnessMap = map;
    }
    if (wrap) {
      m.userData.swgSpec = { mode: 'phong', color: [1, 1, 1], power: 20 };
      applySpec(m, false);
      const u = specUniformsOf(m);
      u.swgSpecMode.value = mode;
      u.swgSpecColor.value.set(color, color, color);
      u.swgSpecPower.value = power;
    }
    made.push(m);
    return m;
  };
  const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(geometry, makeMaterial(null, 0, 0, 0, false));
  // The self-test's own: what is built for it is counted apart and never as made in play (`WARM_STATS.selfTestMade`).
  mesh.userData.swgSelfTest = true;
  scene.add(mesh);
  const lamp = new THREE.PointLight(0xffffff, LAMP_INTENSITY, 0, 2);
  lamp.position.set(LAMP[0], LAMP[1], LAMP[2]);
  const rt = new THREE.RenderTarget(size, size, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false, samples: 0 });
  const fixed: SpecTune = { use: 'client', gain: 1, cap: 1, film: 1, gate: 0 };
  const lightColor: Vec3 = [Math.PI, Math.PI, Math.PI];
  const n: Vec3 = [0, 0, 0];
  const v: Vec3 = [0, 0, 1];
  const js: Vec3 = [0, 0, 0];
  const previous = renderer.getRenderTarget();
  const clear = renderer.getClearColor(new THREE.Color());
  const clearAlpha = renderer.getClearAlpha();
  // Its own sphere's pipelines where the warm patch counts them; else three's whole cache, which the game's own builds move too.
  const ownCount = WARM_PATCH.applied;
  const pipelines = (): number => (ownCount ? WARM_STATS.selfTestMade : (renderer._pipelines?.caches?.size ?? -1));
  const lookWas = GPU_LOOKS.spec;
  const modelsBefore = SPEC_GPU_STATS.models;
  /** Draw `mat` and read its pixels back as half floats, the top row turned to the bottom. */
  const draw = async (mat: THREE.Material): Promise<Float32Array> => {
    mesh.material = mat;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(previous);
    renderer.setClearColor(clear, clearAlpha);
    const raw = (await renderer.readRenderTargetPixelsAsync(rt, 0, 0, size, size)) as Uint16Array;
    const out = new Float32Array(size * size * 4);
    for (let j = 0; j < size; j++) {
      const from = (size - 1 - j) * size * 4;
      for (let i = 0; i < size * 4; i++) out[j * size * 4 + i] = THREE.DataUtils.fromHalfFloat(raw[from + i]);
    }
    return out;
  };
  const eachInside = (visit: (k: number, n: Vec3) => void) => {
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const x = ((i + 0.5) / size) * 2 - 1;
        const y = ((j + 0.5) / size) * 2 - 1;
        const r2 = x * x + y * y;
        if (r2 > 0.85) continue;
        n[0] = x;
        n[1] = y;
        n[2] = Math.sqrt(1 - r2);
        visit(j * size + i, n);
      }
    }
  };
  const brightest = (px: Float32Array) => {
    let most = 0;
    for (let i = 0; i < size * size; i++) most = Math.max(most, px[i * 4]);
    return most;
  };
  const cases: { name: string; pixels: number; maxError: number; peak: { gpu: number; js: number } }[] = [];
  let threeSwitch: Record<string, unknown> = {};
  let lookSwitch: Record<string, unknown> = {};
  let failed: string | null = null;
  try {
    writeKnobs(fixed);
    GPU_LOOKS.spec = true;
    const runs = [
      { name: 'the plain highlight, colour 0.5, power 20', map: null, mode: 1, color: 0.5, power: 20, mask: 1 },
      { name: "the client's band, colour 1, power 20", map: null, mode: 2, color: 1, power: 20, mask: 1 },
      { name: 'colour 10 (glass), held at the cap', map: null, mode: 1, color: 10, power: 8, mask: 1 },
      { name: 'masked by the metal-rough red, colour 0.8, power 12', map: maskTexture, mode: 1, color: 0.8, power: 12, mask: maskByte / 255 },
      { name: 'no highlight', map: null, mode: 0, color: 1, power: 20, mask: 1 },
    ];
    for (const run of runs) {
      const px = await draw(makeMaterial(run.map, run.mode, run.color, run.power));
      let maxError = 0;
      let inside = 0;
      let peakGpu = 0;
      let peakJs = 0;
      eachInside((k, normal) => {
        clientSpecular(js, lightColor, [run.color, run.color, run.color], run.mask, run.mode, run.power, normal, l, v, fixed);
        for (let c = 0; c < 3; c++) {
          const gpu = px[k * 4 + c];
          maxError = Math.max(maxError, Math.abs(gpu - js[c]));
          if (c === 0) {
            peakGpu = Math.max(peakGpu, gpu);
            peakJs = Math.max(peakJs, js[c]);
          }
        }
        inside++;
      });
      cases.push({ name: run.name, pixels: inside, maxError: Number(maxError.toFixed(4)), peak: { gpu: Number(peakGpu.toFixed(4)), js: Number(peakJs.toFixed(4)) } });
    }
    // The lamp in place of the sun: the client's term on a black surface with the colour three's falloff leaves, then a
    // grey surface whose diffuse is the uncut Lambert term (the WebGL picture's) plus that term.
    scene.remove(light, light.target);
    scene.add(lamp);
    const lc: Vec3 = [0, 0, 0];
    const ld: Vec3 = [0, 0, 0];
    const lampRuns = [
      { name: 'a point light, the plain highlight, colour 0.5, power 20, on black', mode: 1, color: 0.5, power: 20, grey: 0 },
      { name: "a point light, the client's band, colour 1, power 20, on grey 0.5 (the uncut diffuse given back)", mode: 2, color: 1, power: 20, grey: LAMP_GREY },
    ];
    for (const run of lampRuns) {
      const px = await draw(makeMaterial(null, run.mode, run.color, run.power, true, run.grey));
      let maxError = 0;
      let inside = 0;
      let peakGpu = 0;
      let peakJs = 0;
      eachInside((k, normal) => {
        // The sphere is the unit one about the origin and the camera looks down -z unturned: a pixel's normal is its point.
        const dx = LAMP[0] - normal[0];
        const dy = LAMP[1] - normal[1];
        const dz = LAMP[2] - normal[2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        ld[0] = dx / d;
        ld[1] = dy / d;
        ld[2] = dz / d;
        const fall = LAMP_INTENSITY / Math.max(d * d, 0.01);
        lc[0] = fall;
        lc[1] = fall;
        lc[2] = fall;
        clientSpecular(js, lc, [run.color, run.color, run.color], 1, run.mode, run.power, normal, ld, v, fixed);
        const nl = Math.max(0, Math.min(1, normal[0] * ld[0] + normal[1] * ld[1] + normal[2] * ld[2]));
        const diffuse = (nl * fall * run.grey) / Math.PI;
        for (let c = 0; c < 3; c++) {
          const want = js[c] + diffuse;
          const gpu = px[k * 4 + c];
          maxError = Math.max(maxError, Math.abs(gpu - want));
          if (c === 0) {
            peakGpu = Math.max(peakGpu, gpu);
            peakJs = Math.max(peakJs, want);
          }
        }
        inside++;
      });
      cases.push({ name: run.name, pixels: inside, maxError: Number(maxError.toFixed(4)), peak: { gpu: Number(peakGpu.toFixed(4)), js: Number(peakJs.toFixed(4)) } });
    }
    scene.remove(lamp);
    // An ambient light alone on the grey surface: the uncut Lambert term (the WebGL picture's 0.185 ambient), which the
    // lighting model of ours gives back where three 0.187 took its highlight's energy from it.
    const ambient = new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY);
    scene.add(ambient);
    {
      const px = await draw(makeMaterial(null, 1, 0.5, 20, true, LAMP_GREY));
      const want = (AMBIENT_INTENSITY * LAMP_GREY) / Math.PI;
      let maxError = 0;
      let inside = 0;
      let peakGpu = 0;
      eachInside((k) => {
        for (let c = 0; c < 3; c++) {
          const gpu = px[k * 4 + c];
          maxError = Math.max(maxError, Math.abs(gpu - want));
          if (c === 0) peakGpu = Math.max(peakGpu, gpu);
        }
        inside++;
      });
      cases.push({ name: 'an ambient light on grey 0.5 (the uncut ambient given back)', pixels: inside, maxError: Number(maxError.toFixed(4)), peak: { gpu: Number(peakGpu.toFixed(4)), js: Number(want.toFixed(4)) } });
    }
    scene.remove(ambient);
    ambient.dispose();
    scene.add(light, light.target);
    // Three's own highlight through a node copy nothing has changed: the reference for both switches.
    const reference = await draw(makeMaterial(null, 0, 0, 0, false));
    const ggxPeak = brightest(reference);
    // The `use: 'three'` switch on the first case's material, drawn again: a uniform, no pipeline.
    const plain = makeMaterial(null, 1, 0.5, 20);
    const clientPx = await draw(plain);
    const before = pipelines();
    writeKnobs({ ...fixed, use: 'three' });
    const threePx = await draw(plain);
    const built = pipelines() - before;
    let againstGgx = 0;
    let apart = 0;
    eachInside((k) => {
      for (let c = 0; c < 3; c++) againstGgx = Math.max(againstGgx, Math.abs(threePx[k * 4 + c] - reference[k * 4 + c]));
      apart = Math.max(apart, Math.abs(threePx[k * 4] - clientPx[k * 4]));
    });
    threeSwitch = { client: Number(brightest(clientPx).toFixed(4)), three: Number(brightest(threePx).toFixed(4)), apart: Number(apart.toFixed(4)), differs: apart > 0.05, ggxPeak: Number(ggxPeak.toFixed(4)), maxErrorAgainstGgx: Number(againstGgx.toFixed(5)), built };
    // The console's look switch, the same way: back to the client, then the look off.
    writeKnobs(fixed);
    const backPx = await draw(plain);
    const before2 = pipelines();
    GPU_LOOKS.spec = false;
    const offPx = await draw(plain);
    const built2 = pipelines() - before2;
    let offAgainstGgx = 0;
    let backAgainstClient = 0;
    eachInside((k) => {
      for (let c = 0; c < 3; c++) {
        offAgainstGgx = Math.max(offAgainstGgx, Math.abs(offPx[k * 4 + c] - reference[k * 4 + c]));
        backAgainstClient = Math.max(backAgainstClient, Math.abs(backPx[k * 4 + c] - clientPx[k * 4 + c]));
      }
    });
    lookSwitch = { maxErrorAgainstGgx: Number(offAgainstGgx.toFixed(5)), backToClientMaxError: Number(backAgainstClient.toFixed(5)), built: built2 };
  } catch (err) {
    failed = String((err as Error)?.message ?? err).slice(0, 300);
  } finally {
    GPU_LOOKS.spec = lookWas;
    writeKnobs(SPEC_TUNE);
    renderer.setRenderTarget(previous);
    renderer.setClearColor(clear, clearAlpha);
    for (const m of made) m.dispose();
    maskTexture.dispose();
    geometry.dispose();
    rt.dispose();
    lamp.dispose();
  }
  const worst = cases.reduce((a, c) => Math.max(a, c.maxError), cases.length ? 0 : Infinity);
  const ts = threeSwitch as { differs?: boolean; ggxPeak?: number; maxErrorAgainstGgx?: number; built?: number };
  const ls = lookSwitch as { maxErrorAgainstGgx?: number; backToClientMaxError?: number; built?: number };
  return {
    renderer: 'WebGPU',
    ok: !failed && worst < 0.02 && ts.differs === true && (ts.ggxPeak ?? 0) > 0.05 && (ts.maxErrorAgainstGgx ?? 1) < 0.01 && ts.built === 0 && (ls.maxErrorAgainstGgx ?? 1) < 0.01 && (ls.backToClientMaxError ?? 1) < 0.01 && ls.built === 0,
    cases,
    threeSwitch,
    lookSwitch,
    modelsBuilt: SPEC_GPU_STATS.models - modelsBefore,
    built: ownCount ? "pipelines made for the test's own sphere alone (the warm patch's count): the game building its own meanwhile is not counted" : "three's whole pipeline cache (the warm patch did not apply here): the game building its own meanwhile is counted too",
    weather: 'not drawn: the wetness is a remake of the owner\'s and not on WebGPU, so the film is the switch alone there',
    failed,
    note: "every pixel inside the rim, in units of a white surface facing the light: the client's cases against specMath.clientSpecular (worst under 0.02, the WebGL test's own), the point light's with three's falloff and the grey one with the uncut Lambert term added; the use: 'three' switch and the console's look switch against an unchanged standard material's node copy (under 0.01, building no pipeline)",
  };
}
