// The unified wind's self test (the volumetrics' wave 7a, `__debug.wind({ selfTest: true })`, the Start's first check):
// the gust function drawn through the game's own program text (`WIND7_GLSL`) at 4,096 points out to 8 km at four
// moments, against its processor copy (`gustFlat`), which every reader on the processor side answers with; and a stand-in
// planting through the plain sway chunk and through the trees' form (`treesFormText`), which with the unified wind's
// branch not taken must agree to the bit, and with it taken must follow the form's mirror (`swayOffsetForm`).
//
// It builds four programs of its own when it is asked and never otherwise, draws them into float targets of its own, reads
// them back and lets everything go; nothing of the frame is touched but the render target, which is put back.
import * as THREE from 'three';
import { FX_CAMERA, createFxQuad } from '../core/fx/pass.ts';
import { PACK_FLOATS, WIND7_GLSL, gustFlat, newGustAt } from './windMath.ts';
import { WIND_FRAME, WIND_PROFILES, windPackAt } from './wind.ts';
import { SWAY_DEFAULTS, SWAY_FUNCTIONS, SWAY_MODEL_PARS, SWAY_SHARED_PARS, type SwayFrame, type SwayModelState, type SwayTune } from './swayMath.ts';
import { swayOffsetForm, treesFormText } from './windTrees.ts';

/** The points a side (64 x 64 = 4,096). */
const SIDE = 64;
const COUNT = SIDE * SIDE;
/** How far out the gust's points go, and the plantings' (the sway fades out long before; the hash keeps float32 near). */
const GUST_REACH = 8000;
const PLANT_REACH = 300;
/** The agreement the Start asks: the gust's three numbers within this of the processor's copy. */
const GUST_TOLERANCE = 1e-3;
/** The form's mirror against the drawn form, metres (the chunk's sines and hash in single precision against double). */
const FORM_TOLERANCE = 2e-3;

/** A fraction from an index, the same each run (a plain integer hash). */
function frac(i: number, salt: number): number {
  let h = Math.imul(i ^ Math.imul(salt, 0x9e3779b9), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h >>> 8) / 16777216;
}

/** The points: (x, z) in a disc of `reach`, the first sixty-four within a hundred metres, and a height for the plantings. */
function points(reach: number): Float32Array {
  const a = new Float32Array(COUNT * 4);
  for (let i = 0; i < COUNT; i++) {
    const r = (i < SIDE ? 100 : reach) * Math.sqrt(frac(i, 1));
    const th = 2 * Math.PI * frac(i, 2);
    a[i * 4] = r * Math.sin(th);
    a[i * 4 + 1] = r * Math.cos(th);
    a[i * 4 + 2] = 10 * frac(i, 3);
    a[i * 4 + 3] = 1;
  }
  return a;
}

const GUST_FRAG = /* glsl */ `
${WIND7_GLSL}
uniform sampler2D uPts;
void main() {
  vec4 q = texelFetch( uPts, ivec2( gl_FragCoord.xy ), 0 );
  gl_FragColor = vec4( w7Gust( q.xy ), 1.0 );
}
`;

const SWAY_FRAG = /* glsl */ `
#include <common>
uniform sampler2D uPts;
${SWAY_SHARED_PARS}${SWAY_MODEL_PARS}${SWAY_FUNCTIONS}
void main() {
  vec4 q = texelFetch( uPts, ivec2( gl_FragCoord.xy ), 0 );
  mat4 swgM = mat4( 1.0 );
  swgM[ 3 ] = vec4( q.x, 0.0, q.y, 1.0 );
  gl_FragColor = vec4( swgSwayOffset( vec3( 0.3, q.z, -0.2 ), swgM ), 1.0 );
}
`;

const VERT = /* glsl */ `
void main() {
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

/** The stand-in planting's numbers: a ten-metre tree, its canopy from three metres, swaying in a wind of 0.7 toward +X. */
const PLANT = { H: 10, c: 0.3, rT: 0.4, gain: 1, axisX: 0, axisZ: 0, omega: 1.3, t: 12.3, flutterOmega: 7, windX: 0.8, windZ: 0.6, strength: 0.7 };

/** Draws one material over a target of `SIDE` and reads it back. */
function drawRead(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, target: THREE.WebGLRenderTarget, out: Float32Array): void {
  const scene = new THREE.Scene();
  const quad = createFxQuad(material);
  scene.add(quad);
  const before = renderer.getRenderTarget();
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene, FX_CAMERA);
    renderer.readRenderTargetPixels(target, 0, 0, SIDE, SIDE, out);
  } finally {
    renderer.setRenderTarget(before);
    scene.remove(quad);
  }
}

/**
 * The self test. Answers the gust's worst differences at each moment and how many NaN, the planting's agreement at the form's
 * branch not taken (to the bit) and taken (against the mirror), and how many plantings stood in a gust patch.
 */
export async function windSelfTest(renderer: THREE.WebGLRenderer): Promise<Record<string, unknown>> {
  const notes: string[] = [];
  const pack = new Float32Array(PACK_FLOATS);
  const t0 = Number.isFinite(WIND_FRAME.t) && WIND_FRAME.t > 1 ? Math.floor(WIND_FRAME.t) : 100000;
  // The clear weather's profile, so the patches are those of a fair day whatever the sky is doing now.
  if (!windPackAt(t0, pack, WIND_PROFILES.clear)) return { pass: false, notes: ['no world: the wind comes with one (stand on a planet first)'] };
  const target = new THREE.WebGLRenderTarget(SIDE, SIDE, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false });
  const make = (pts: Float32Array): THREE.DataTexture => {
    const t = new THREE.DataTexture(pts, SIDE, SIDE, THREE.RGBAFormat, THREE.FloatType);
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  };
  const far = points(GUST_REACH);
  const near = points(PLANT_REACH);
  const farTex = make(far);
  const nearTex = make(near);
  const uWind7 = { value: pack };
  const gustMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: GUST_FRAG, uniforms: { uWind7, uPts: { value: farTex } }, depthTest: false, depthWrite: false });
  const swayUniforms = (): Record<string, THREE.IUniform> => ({
    uPts: { value: nearTex },
    uSwayWind: { value: new THREE.Vector4(PLANT.windX, PLANT.windZ, PLANT.strength, 1) },
    uSwayTune: { value: new THREE.Vector4(SWAY_DEFAULTS.amp, SWAY_DEFAULTS.calm, SWAY_DEFAULTS.lean, SWAY_DEFAULTS.flutter) },
    uSwayTime: { value: new THREE.Vector4(PLANT.t, PLANT.flutterOmega, 0, 0) },
    uSwayEye: { value: new THREE.Vector3(0, 0, 0) },
    uSwayFade: { value: new THREE.Vector2(1e6, 2e6) },
    uSwayShape: { value: new THREE.Vector4(PLANT.H, PLANT.c, PLANT.rT, PLANT.gain) },
    uSwayAxis: { value: new THREE.Vector4(PLANT.axisX, PLANT.axisZ, PLANT.omega, 0) },
    uWind7,
  });
  const formText = treesFormText(SWAY_FRAG);
  if (!formText) notes.push("the trees' form did not find its three anchors in the sway chunk's text: the form would write nothing");
  const plainMat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: SWAY_FRAG, uniforms: swayUniforms(), depthTest: false, depthWrite: false });
  const formMat = formText ? new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: formText, uniforms: swayUniforms(), depthTest: false, depthWrite: false }) : null;
  const read = new Float32Array(COUNT * 4);
  const g = newGustAt();
  const moments: Record<string, unknown>[] = [];
  let pass = true;
  try {
    // 1. The gust function at four moments: now, half a cycle on, past a phase's change, an hour on.
    const at = [t0, t0 + 45, t0 + 91, t0 + 3600];
    for (const t of at) {
      windPackAt(t, pack, WIND_PROFILES.clear);
      // A gust strength and veer to see: the clear profile's own (a pack at art one), never nought.
      drawRead(renderer, gustMat, target, read);
      let worstK = 0;
      let worstA = 0;
      let worstP = 0;
      let nan = 0;
      let inside = 0;
      for (let i = 0; i < COUNT; i++) {
        g.x = far[i * 4];
        g.z = far[i * 4 + 1];
        gustFlat(g, pack);
        const k = read[i * 4];
        const a = read[i * 4 + 1];
        const p = read[i * 4 + 2];
        if (!Number.isFinite(k) || !Number.isFinite(a) || !Number.isFinite(p)) {
          nan++;
          continue;
        }
        if (g.p > 0.5) inside++;
        worstK = Math.max(worstK, Math.abs(k - g.k));
        worstA = Math.max(worstA, Math.abs(a - g.a));
        worstP = Math.max(worstP, Math.abs(p - g.p));
      }
      const ok = nan === 0 && worstK <= GUST_TOLERANCE && worstA <= GUST_TOLERANCE && worstP <= GUST_TOLERANCE;
      if (!ok) pass = false;
      moments.push({ t, ok, worstK, worstVeer: worstA, worstPatch: worstP, nan, insideShare: Math.round((inside / COUNT) * 1000) / 1000 });
    }
    // 2. The stand-in planting: the plain chunk against the form with the branch not taken (to the bit), then taken.
    const plant: Record<string, unknown> = {};
    if (formMat) {
      windPackAt(t0, pack, WIND_PROFILES.clear);
      const on = pack[27];
      pack[27] = 0;
      const plain = new Float32Array(COUNT * 4);
      drawRead(renderer, plainMat, target, plain);
      drawRead(renderer, formMat, target, read);
      let differ = 0;
      for (let i = 0; i < COUNT * 4; i++) if (!Object.is(plain[i], read[i])) differ++;
      plant.offBitwise = differ === 0;
      plant.offDiffer = differ;
      if (differ !== 0) pass = false;
      // Taken: the drawn form against its mirror over the gust at each planting's place.
      pack[27] = on > 0.5 ? on : 1;
      drawRead(renderer, formMat, target, read);
      const tune: SwayTune = { ...SWAY_DEFAULTS, fadeNear: 1e6, fadeFar: 2e6, trunk: 'still' };
      const model: SwayModelState = { shape: { H: PLANT.H, c: PLANT.c, axisX: PLANT.axisX, axisZ: PLANT.axisZ, rT: PLANT.rT, positions: [], card: false }, omega: PLANT.omega, gain: PLANT.gain } as unknown as SwayModelState;
      const frame: SwayFrame = { windX: PLANT.windX, windZ: PLANT.windZ, strength: PLANT.strength, t: PLANT.t, flutterOmega: PLANT.flutterOmega, eye: [0, 0, 0] } as SwayFrame;
      const m = new Float64Array(16);
      m[0] = 1;
      m[5] = 1;
      m[10] = 1;
      m[15] = 1;
      const out: [number, number, number] = [0, 0, 0];
      let worst = 0;
      let nan = 0;
      let gusted = 0;
      let moved = 0;
      for (let i = 0; i < COUNT; i++) {
        m[12] = near[i * 4];
        m[13] = 0;
        m[14] = near[i * 4 + 1];
        g.x = near[i * 4];
        g.z = near[i * 4 + 1];
        gustFlat(g, pack);
        if (g.p > 0.5) gusted++;
        swayOffsetForm(out, [0.3, near[i * 4 + 2], -0.2], m, model, frame, tune, { on: true, k: g.k, veer: g.a, patch: g.p, trees: pack[26] });
        for (let c = 0; c < 3; c++) {
          const v = read[i * 4 + c];
          if (!Number.isFinite(v)) nan++;
          else worst = Math.max(worst, Math.abs(v - out[c]));
          if (Math.abs(v - plain[i * 4 + c]) > 1e-4) moved++;
        }
      }
      plant.onWorst = worst;
      plant.onNan = nan;
      plant.inGust = gusted;
      plant.movedByTheGust = moved;
      plant.onOk = nan === 0 && worst <= FORM_TOLERANCE;
      if (!plant.onOk) pass = false;
    }
    notes.push('four programs of the self test built now, at the console (never in play otherwise)');
    return { pass, points: COUNT, reach: GUST_REACH, tolerance: GUST_TOLERANCE, moments, plant, notes };
  } catch (e) {
    return { pass: false, error: String(e), moments, notes };
  } finally {
    gustMat.dispose();
    plainMat.dispose();
    formMat?.dispose();
    farTex.dispose();
    nearTex.dispose();
    target.dispose();
  }
}
