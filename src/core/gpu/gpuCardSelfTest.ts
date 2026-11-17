// `__debug.cardLightSelfTest()` and `__debug.leafShadowSelfTest()` on WebGPU (the GPU port's step 4, item 4): the WebGL
// self-tests' cases (`cardSelfTests.ts`) drawn through the leaf cards' part of ours (`gpuCard.ts`) on a stage of their own
// and held to the same arithmetic (`cardLightMath.ts`) within the WebGL tests' own tolerances.
//
//   - the client's light: one card at N·L 1, 0 and −1 shows the client's own displayed bytes, with the sun casting and not
//     alike; a mirrored pair under `sunSide: 'face'` shows the front colour from the sun's side and the back colour from
//     the other, and both the same under `'stored'`; a point light on the viewer's side lights both faces of a stored-normal
//     pair at `pointFlat` 1 and only one at nought;
//   - the leaf skip: a crossed pair, the half behind the crossing darker under `'all'` and alike under `'self'`, and a box
//     beyond the crown still shading it.
//
// Four things differ from the WebGL tests, each said in the answer: the readback is three's asynchronous one; the knobs are
// written again before every draw, since the game's own frames run between two readbacks and write the card light's
// colours from the sky; "the shadow map off" is the stage's sun casting nothing (the game's own Shadows setting is never
// moved, or every pipeline of the world would be built again in play); and the stage's sun carries a plain shadow of
// three's, given the same bias node the game's cascades carry (`leafBiasNode`), standing in for the cascades.

import * as THREE from 'three';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { reference, renderGroup } from 'three/tsl';
import { CARD_LIGHT_ON, CARD_LIGHT_TUNE, CARD_LIGHT_UNIFORMS, LEAF_SHADOW_ON, writeCardLightUniforms } from '../../world/cardLight.ts';
import { clientDisplay, clientLight, displayOf, type CardColours, type Rgb } from '../../world/cardLightMath.ts';
import { CARD_RULE_ON, CARD_UNIFORMS, applyCard, prepareCardModel, writeCardUniforms } from '../../world/cardRule.ts';
import { texelTexture } from '../../world/cardStage.ts';
import { GPU_LOOKS, LOOKS_AT_LOAD } from './looks.ts';
import { leafBiasNode } from './gpuCard.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const apart = (a: Rgb, b: Rgb) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
const round = (v: Rgb): number[] => v.map((x) => Number(x.toFixed(1)));
const lum = (v: Rgb) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
type Pixel = [number, number, number, number];
const bytesOf = (p: Pixel): Rgb => {
  const d = displayOf([p[0], p[1], p[2]]);
  return [d[0] * 255, d[1] * 255, d[2] * 255];
};

/** The colours the light tests light by (the WebGL test's): a sunny front, a mid tangent, a dark back, no fills. */
const TEST_COLOURS: CardColours = { front: [0.92, 0.82, 0.62], tangent: [0.6, 0.55, 0.5], back: [0.1, 0.1, 0.12], ambient: [0, 0, 0], fill: [0, 0, 0], bounce: [0, 0, 0], shadow: [0.2, 0.2, 0.25], shadowAlpha: 0.3 };

function setTestColours(c: CardColours): void {
  const u = CARD_LIGHT_UNIFORMS;
  u.uSwgCardFront.value.set(...c.front);
  u.uSwgCardTangent.value.set(...c.tangent);
  u.uSwgCardBack.value.set(...c.back);
  u.uSwgCardAmbient.value.set(...c.ambient);
  u.uSwgCardFill.value.set(...c.fill);
  u.uSwgCardBounce.value.set(...c.bounce);
  u.uSwgCardRow7.value.set(...c.shadow);
  u.uSwgCardRow7Alpha.value = c.shadowAlpha;
  u.uSwgCardOn.value = 1;
  u.uSwgCardCurve.value = 0;
  u.uSwgCardGain.value = 1;
  u.uSwgCardExposureRef.value = 1;
  u.uSwgCardBloomCap.value = 0.84;
  u.uSwgCardShadowLook.value = 0;
  u.uSwgCardFills.value = 2;
  u.uSwgCardEmissiveOn.value = 1;
  u.uSwgLeafShare.value = 1;
}

function clientBytes(texel: Rgb, d: number): Rgb {
  const g = clientLight(TEST_COLOURS, { d, shadow: 1, fillDot: 0, bounceDot: 0, emissive: [0, 0, 0] }, { fills: 'both', emissive: true, gain: 1, shadowLook: 'rise' });
  const disp = clientDisplay([texel[0] / 255, texel[1] / 255, texel[2] / 255], g, TEST_COLOURS, 1, 'rise');
  return [disp[0] * 255, disp[1] * 255, disp[2] * 255];
}

/** A quad of `size` in the XY plane facing +Z. */
const quad = (size = 2): THREE.BufferGeometry => new THREE.PlaneGeometry(size, size);

/** The same quad with a back copy on the very same vertices wound the other way: the client's commonest back. */
function sharedPair(size = 2): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(size, size);
  const front = Array.from(g.getIndex()!.array);
  const back: number[] = [];
  for (let i = 0; i < front.length; i += 3) back.push(front[i], front[i + 2], front[i + 1]);
  g.setIndex([...front, ...back]);
  return g;
}

/** The stage: an orthographic camera onto a half-float target, read back asynchronously. */
class GpuStage {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly target: THREE.RenderTarget;
  readonly renderer: Any;
  readonly size: number;
  private readonly owned = new Set<{ dispose(): void }>();
  private pixels: Float32Array | null = null;
  constructor(renderer: Any, size = 32, half = 1.4) {
    this.renderer = renderer;
    this.size = size;
    this.camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, 40);
    this.target = new THREE.RenderTarget(size, size, { type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false, samples: 0 });
  }
  own<T extends { dispose(): void }>(t: T): T {
    this.owned.add(t);
    return t;
  }
  view(from: THREE.Vector3, to: THREE.Vector3): void {
    this.camera.position.copy(from);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(to);
    this.camera.updateMatrixWorld();
  }
  /** Draw with the knobs `knobs` writes first (the game's frames write the card light between two readbacks), then read back. */
  async render(knobs: () => void, camera: THREE.Camera = this.camera): Promise<void> {
    const r = this.renderer;
    const previous = r.getRenderTarget();
    const clear = r.getClearColor(new THREE.Color());
    const clearAlpha = r.getClearAlpha();
    knobs();
    // The stage's own: what is built for it is counted apart and never as made in play (`WARM_STATS.selfTestMade`).
    this.scene.traverse((o) => {
      o.userData.swgSelfTest = true;
    });
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.scene, camera);
    r.setRenderTarget(previous);
    r.setClearColor(clear, clearAlpha);
    const raw = (await r.readRenderTargetPixelsAsync(this.target, 0, 0, this.size, this.size)) as Uint16Array;
    const out = new Float32Array(this.size * this.size * 4);
    // A WebGPU texture's first row is its top: turned over so a row stands where the WebGL stage reads it.
    for (let j = 0; j < this.size; j++) {
      const from = (this.size - 1 - j) * this.size * 4;
      for (let i = 0; i < this.size * 4; i++) out[j * this.size * 4 + i] = THREE.DataUtils.fromHalfFloat(raw[from + i]);
    }
    this.pixels = out;
  }
  at(u: number, v: number): Pixel {
    const px = this.pixels!;
    const i = Math.min(this.size - 1, Math.max(0, Math.floor(u * this.size)));
    const j = Math.min(this.size - 1, Math.max(0, Math.floor(v * this.size)));
    const k = (j * this.size + i) * 4;
    return [px[k], px[k + 1], px[k + 2], px[k + 3]];
  }
  dispose(): void {
    for (const t of this.owned) t.dispose();
    this.target.dispose();
  }
}

/** A card material as a model load makes one: a cut-out of one texel, ruled by the card rule and wrapped. */
function cardOn(stage: GpuStage, geometries: THREE.BufferGeometry[], texel: [number, number, number, number], castShadow = false): { mat: THREE.MeshStandardMaterial; group: THREE.Group } {
  const mat = stage.own(new THREE.MeshStandardMaterial({ map: stage.own(texelTexture(texel)), roughness: 1, metalness: 0, alphaTest: 0.5, side: THREE.DoubleSide }));
  for (const g of geometries) stage.own(g);
  mat.name = 'swg card self-test';
  mat.userData.swgCard = { blend: false, emissive: [0, 0, 0] };
  const group = new THREE.Group();
  for (const g of geometries) {
    const m = new THREE.Mesh(g, mat);
    m.castShadow = castShadow;
    m.receiveShadow = true;
    group.add(m);
  }
  prepareCardModel([group], { flora: true, count: false });
  applyCard(mat);
  stage.scene.add(group);
  return { mat, group };
}

/** The stage's sun: the light the cards take as the sun, with a plain shadow of three's given the cascades' bias node. */
function stageSun(stage: GpuStage, toward: THREE.Vector3, intensity = Math.PI, half = 3): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight(0xffffff, intensity);
  sun.userData.swgSun = true;
  sun.position.copy(toward).normalize().multiplyScalar(10);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(256, 256);
  const c = sun.shadow.camera;
  c.left = -half;
  c.right = half;
  c.top = half;
  c.bottom = -half;
  c.near = 0.5;
  c.far = 20;
  c.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.01;
  (sun.shadow as Any).biasNode = leafBiasNode(reference('bias', 'float', sun.shadow).setGroup(renderGroup));
  stage.scene.add(sun, sun.target);
  return sun;
}

/**
 * The cascades' stage (the leaf test's fourth part): the game's near cascade's bias and normal bias (read off its live
 * cascades at Naboo, -2.12e-5 and 0.0199 on a 40.8 m box: a bias that leans away from the light and a normal bias at
 * all, the two things the plain stage's sun does not carry as the game's do), a reach for the stage's few metres.
 */
const CASCADE_STAGE = { bias: -0.0000212, normalBias: 0.0199, maxFar: 12, lightMargin: 6 };

/** Everything the tests move, kept and put back. */
function keepKnobs(): () => void {
  const card = Object.fromEntries(Object.entries(CARD_UNIFORMS).map(([k, u]) => [k, u.value]));
  const light = Object.fromEntries(Object.entries(CARD_LIGHT_UNIFORMS).map(([k, u]) => [k, (u.value as { clone?: () => unknown }).clone ? (u.value as { clone: () => unknown }).clone() : u.value]));
  const look = GPU_LOOKS.card;
  return () => {
    for (const [k, v] of Object.entries(card)) (CARD_UNIFORMS as Record<string, { value: unknown }>)[k].value = v;
    for (const [k, v] of Object.entries(light)) {
      const u = (CARD_LIGHT_UNIFORMS as Record<string, { value: unknown }>)[k];
      if ((u.value as { copy?: (x: unknown) => void }).copy) (u.value as { copy: (x: unknown) => void }).copy(v);
      else u.value = v;
    }
    GPU_LOOKS.card = look;
  };
}

function refusal(which: 'light' | 'leaf'): string | null {
  if (!LOOKS_AT_LOAD.card) return "the leaf cards' part is left out at load (localStorage['swg.gpu.card'] = '0')";
  if (!CARD_RULE_ON) return "the card rule is off for this load (localStorage['swg.cards'] = 'three')";
  if (which === 'light' && !CARD_LIGHT_ON) return "the card light is off for this load (localStorage['swg.cardLight'] = '0')";
  if (which === 'leaf' && !LEAF_SHADOW_ON) return "the leaf shadow is off for this load (localStorage['swg.leafShadow'] = 'all')";
  return null;
}

const NOTE_DIFFERS = "WebGPU: read back asynchronously, the knobs written before every draw (the game's frames run between readbacks), the sun casting or not in place of the shadow map on or off (the game's Shadows setting is never moved), and a plain shadow of three's on the stage's sun carrying the cascades' bias node";

/** The card light's own cases (the WebGL test's, drawn through `gpuCard.ts`). */
export async function cardLightSelfTestGpu(renderer: Any): Promise<Record<string, unknown>> {
  const no = refusal('light');
  if (no) return { renderer: 'WebGPU', ok: false, note: no };
  const restore = keepKnobs();
  const stage = new GpuStage(renderer, 32, 1.4);
  const texel: [number, number, number, number] = [60, 90, 40, 255];
  const base = (extra?: () => void) => () => {
    GPU_LOOKS.card = true;
    setTestColours(TEST_COLOURS);
    CARD_UNIFORMS.uSwgCardBacksStored.value = 0;
    CARD_LIGHT_UNIFORMS.uSwgCardSunSide.value = 0;
    CARD_LIGHT_UNIFORMS.uSwgCardPointFlat.value = 0.5;
    extra?.();
  };
  let failed: string | null = null;
  const cases: { name: string; gpu: number[]; client: number[]; apart: number }[] = [];
  const sides: { name: string; near: number[]; far: number[]; wantNear: number[]; wantFar: number[]; worst: number }[] = [];
  let onOff = 0;
  let flat = { near: 0, far: 0 };
  let none = { near: 0, far: 0 };
  const cut: { alpha: number; look: boolean; drawn: number }[] = [];
  try {
    // 1. One card facing +Z, the sun at N·L 1, 0 and −1, casting and not.
    const card = cardOn(stage, [quad()], texel);
    stage.view(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, 0));
    for (const [name, toward, d] of [['N·L 1', new THREE.Vector3(0, 0, 1), 1], ['N·L 0', new THREE.Vector3(1, 0, 0), 0], ['N·L −1', new THREE.Vector3(0, 0, -1), -1]] as const) {
      const sun = stageSun(stage, toward, Math.PI, 3);
      await stage.render(base(() => CARD_LIGHT_UNIFORMS.uSwgLeafSun.value.copy(toward)));
      const on = bytesOf(stage.at(0.5, 0.5));
      sun.castShadow = false;
      await stage.render(base(() => CARD_LIGHT_UNIFORMS.uSwgLeafSun.value.copy(toward)));
      const off = bytesOf(stage.at(0.5, 0.5));
      onOff = Math.max(onOff, apart(on, off));
      const want = clientBytes([texel[0], texel[1], texel[2]], d);
      cases.push({ name, gpu: round(on), client: round(want), apart: Number(apart(on, want).toFixed(2)) });
      stage.scene.remove(sun, sun.target);
      sun.dispose();
    }
    stage.scene.remove(card.group);
    // 2. A mirrored pair from both sides, the sun at +Z: the face rule and the stored rule.
    const pair = cardOn(stage, [sharedPair()], texel);
    const z = new THREE.Vector3(0, 0, 1);
    const sun = stageSun(stage, z, Math.PI, 3);
    const read = async (side: 1 | -1, stored: boolean): Promise<Rgb> => {
      stage.view(new THREE.Vector3(0, 0, 5 * side), new THREE.Vector3(0, 0, 0));
      await stage.render(base(() => {
        CARD_LIGHT_UNIFORMS.uSwgLeafSun.value.copy(z);
        CARD_LIGHT_UNIFORMS.uSwgCardSunSide.value = stored ? 1 : 0;
      }));
      return bytesOf(stage.at(0.5, 0.5));
    };
    for (const side of ['face', 'stored'] as const) {
      const near = await read(1, side === 'stored');
      const far = await read(-1, side === 'stored');
      const wantNear = clientBytes([texel[0], texel[1], texel[2]], 1);
      const wantFar = clientBytes([texel[0], texel[1], texel[2]], side === 'face' ? -1 : 1);
      sides.push({ name: side, near: round(near), far: round(far), wantNear: round(wantNear), wantFar: round(wantFar), worst: Number(Math.max(apart(near, wantNear), apart(far, wantFar)).toFixed(2)) });
    }
    // 3. A point light on the viewer's side, the sun out, every card lit by the client's one normal: at pointFlat 1
    // both faces take it, at nought the one whose normal faces away does not.
    sun.intensity = 0;
    sun.castShadow = false;
    const lamp = new THREE.PointLight(0xffffff, 30, 0, 2);
    stage.scene.add(lamp);
    const lampRead = async (side: 1 | -1, pf: number): Promise<number> => {
      lamp.position.set(0, 0, 2 * side);
      stage.view(new THREE.Vector3(0, 0, 5 * side), new THREE.Vector3(0, 0, 0));
      await stage.render(base(() => {
        setTestColours({ ...TEST_COLOURS, front: [0, 0, 0], tangent: [0, 0, 0], back: [0, 0, 0] });
        CARD_UNIFORMS.uSwgCardBacksStored.value = 1;
        CARD_LIGHT_UNIFORMS.uSwgCardPointFlat.value = pf;
        CARD_LIGHT_UNIFORMS.uSwgLeafSun.value.copy(z);
      }));
      return lum(bytesOf(stage.at(0.5, 0.5)));
    };
    flat = { near: Number((await lampRead(1, 1)).toFixed(1)), far: Number((await lampRead(-1, 1)).toFixed(1)) };
    none = { near: Number((await lampRead(1, 0)).toFixed(1)), far: Number((await lampRead(-1, 0)).toFixed(1)) };
    stage.scene.remove(lamp, sun, sun.target, pair.group);
    sun.dispose();
    lamp.dispose();
    // 4. The cut: a texel under the class's half draws nothing and one over it draws, with the look on and off (three's
    // own alpha test then) alike; three makes an opaque material's alpha one straight after its test, so a cut put after
    // it would cut nothing.
    const z2 = new THREE.Vector3(0, 0, 1);
    const sun2 = stageSun(stage, z2, Math.PI, 3);
    stage.view(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, 0));
    for (const [alpha, look] of [[64, true], [200, true], [64, false], [200, false]] as const) {
      const c = cardOn(stage, [quad()], [texel[0], texel[1], texel[2], alpha]);
      await stage.render(base(() => {
        CARD_LIGHT_UNIFORMS.uSwgLeafSun.value.copy(z2);
        GPU_LOOKS.card = look;
      }));
      cut.push({ alpha, look, drawn: Number(stage.at(0.5, 0.5)[3].toFixed(3)) });
      stage.scene.remove(c.group);
    }
    stage.scene.remove(sun2, sun2.target);
    sun2.dispose();
  } catch (err) {
    failed = String((err as Error)?.message ?? err).slice(0, 300);
  } finally {
    stage.dispose();
    restore();
    writeCardUniforms();
    writeCardLightUniforms();
  }
  const ok =
    !failed &&
    cases.length === 3 &&
    cases.every((c) => c.apart <= 2) &&
    onOff <= 1 &&
    sides.length === 2 &&
    sides.every((s) => s.worst <= 2) &&
    flat.near > 10 &&
    Math.abs(flat.near - flat.far) <= Math.max(1, flat.near * 0.03) &&
    none.far < none.near * 0.25 &&
    cut.length === 4 &&
    cut.every((c) => (c.alpha < 128 ? c.drawn < 0.01 : c.drawn > 0.99));
  return {
    renderer: 'WebGPU',
    ok,
    cases,
    shadowsOnOff: Number(onOff.toFixed(2)),
    sides,
    pointFlat: { flat, none },
    cut,
    failed,
    differs: NOTE_DIFFERS,
    tune: { sunSide: CARD_LIGHT_TUNE.sunSide, pointFlat: CARD_LIGHT_TUNE.pointFlat },
    note: "display bytes with the grade off and the curve 'client': each case within 2 of the client's own, the sun casting and not within 1 of each other, the face rule's far side the back colour and the stored rule's the front, and a point light lighting both faces alike at pointFlat 1 and the far one under a quarter at nought (the WebGL test's own tolerances); and a texel under the cut draws nothing, one over it draws, with the look on and off",
  };
}

/** The leaf skip's own cases (the WebGL test's, drawn through `gpuCard.ts`). */
export async function leafShadowSelfTestGpu(renderer: Any): Promise<Record<string, unknown>> {
  const no = refusal('leaf');
  if (no) return { renderer: 'WebGPU', ok: false, note: no };
  if (renderer.shadowMap?.enabled !== true) return { renderer: 'WebGPU', ok: false, note: 'the Shadows setting is off: no shadow is drawn to skip (the test never moves the setting, which would build every pipeline of the world again)' };
  const restore = keepKnobs();
  const stage = new GpuStage(renderer, 64, 1.4);
  let failed: string | null = null;
  let all = { behind: 0, open: 0 };
  let self = { behind: 0, open: 0 };
  let withBox = { behind: 0, open: 0 };
  const cascades = { all: { behind: 0, open: 0 }, self: { behind: 0, open: 0 }, box: { shaded: 0, open: 0 } };
  try {
    // A crossed pair: card A facing +Z, card B across it facing +X, both one model's (one crown).
    const a = quad();
    const b = quad().rotateY(Math.PI / 2);
    const pair = cardOn(stage, [a, b], [200, 200, 200, 255], true);
    const toward = new THREE.Vector3(1, 0.3, 1).normalize();
    const sun = stageSun(stage, toward, Math.PI, 5);
    stage.view(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, 0));
    // Card A's left half lies behind card B from the sun; its right half is in the open.
    const left = 0.5 - 0.5 / (2 * 1.4);
    const right = 0.5 + 0.5 / (2 * 1.4);
    const halves = async (leafSelf: number): Promise<{ behind: number; open: number }> => {
      await stage.render(() => {
        GPU_LOOKS.card = true;
        setTestColours(TEST_COLOURS);
        CARD_UNIFORMS.uSwgCardBacksStored.value = 0;
        CARD_LIGHT_UNIFORMS.uSwgCardSunSide.value = 0;
        CARD_LIGHT_UNIFORMS.uSwgLeafSun.value.copy(toward);
        CARD_LIGHT_UNIFORMS.uSwgLeafSelf.value = leafSelf;
        CARD_LIGHT_UNIFORMS.uSwgLeafAcne.value = 4;
      });
      return { behind: Number(lum(bytesOf(stage.at(left, 0.5))).toFixed(1)), open: Number(lum(bytesOf(stage.at(right, 0.5))).toFixed(1)) };
    };
    all = await halves(0);
    self = await halves(1);
    // A box beyond the crown, between the sun and card A's right half.
    const box = new THREE.Mesh(stage.own(new THREE.BoxGeometry(0.7, 0.7, 0.7)), stage.own(new THREE.MeshStandardMaterial({ color: 0x808080 })));
    box.position.set(0.5, 0, 0).addScaledVector(toward, 3.2);
    box.castShadow = true;
    stage.scene.add(box);
    withBox = await halves(1);
    stage.scene.remove(box, sun, sun.target);
    sun.dispose();
    // 4. The same three cases through the cascades, as the game's sun is drawn (`sun.ts`): three's `CSMShadowNode` with its
    // fade, each cascade carrying the leaf floor's bias node, a negative bias and a normal bias of the game's near cascade's
    // size, a low sun, a perspective view; the halves read where card A's two points land on the screen.
    const view = new THREE.PerspectiveCamera(30, 1, 0.5, 30);
    view.position.set(0, 0, 5);
    view.lookAt(0, 0, 0);
    if (renderer.reversedDepthBuffer === true && view.reversedDepth !== true) (view as Any)._reversedDepth = true;
    view.updateProjectionMatrix();
    view.updateMatrixWorld();
    const sunC = new THREE.DirectionalLight(0xffffff, Math.PI);
    sunC.userData.swgSun = true;
    sunC.castShadow = true;
    sunC.shadow.mapSize.set(512, 512);
    sunC.shadow.bias = CASCADE_STAGE.bias;
    sunC.shadow.normalBias = CASCADE_STAGE.normalBias;
    sunC.position.copy(toward).multiplyScalar(10);
    sunC.target.position.set(0, 0, 0);
    const node: Any = new CSMShadowNode(sunC, { cascades: 3, maxFar: CASCADE_STAGE.maxFar, mode: 'practical', lightMargin: CASCADE_STAGE.lightMargin });
    node.fade = true;
    (sunC.shadow as Any).shadowNode = node;
    stage.scene.add(sunC, sunC.target);
    node._init({ camera: view, renderer });
    for (const l of node.lights as { shadow: Any }[]) l.shadow.biasNode = leafBiasNode(reference('bias', 'float', l.shadow).setGroup(renderGroup));
    const onScreen = (x: number): [number, number] => {
      const p = new THREE.Vector3(x, 0, 0).project(view);
      return [(p.x + 1) / 2, (p.y + 1) / 2];
    };
    const [lu, lv] = onScreen(-0.5);
    const [ru, rv] = onScreen(0.5);
    const cascadeHalves = async (leafSelf: number): Promise<{ behind: number; open: number }> => {
      await stage.render(() => {
        GPU_LOOKS.card = true;
        setTestColours(TEST_COLOURS);
        CARD_UNIFORMS.uSwgCardBacksStored.value = 0;
        CARD_LIGHT_UNIFORMS.uSwgCardSunSide.value = 0;
        CARD_LIGHT_UNIFORMS.uSwgLeafSun.value.copy(toward);
        CARD_LIGHT_UNIFORMS.uSwgLeafSelf.value = leafSelf;
        CARD_LIGHT_UNIFORMS.uSwgLeafAcne.value = 4;
      }, view);
      return { behind: Number(lum(bytesOf(stage.at(lu, lv))).toFixed(1)), open: Number(lum(bytesOf(stage.at(ru, rv))).toFixed(1)) };
    };
    try {
      cascades.all = await cascadeHalves(0);
      cascades.self = await cascadeHalves(1);
      stage.scene.add(box);
      const boxed2 = await cascadeHalves(1);
      cascades.box = { shaded: boxed2.open, open: boxed2.behind };
      stage.scene.remove(box);
    } finally {
      node.dispose?.();
      stage.scene.remove(sunC, sunC.target);
      sunC.dispose();
    }
    stage.scene.remove(pair.group);
  } catch (err) {
    failed = String((err as Error)?.message ?? err).slice(0, 300);
  } finally {
    stage.dispose();
    restore();
    writeCardUniforms();
    writeCardLightUniforms();
  }
  const boxed = { shaded: withBox.open, open: withBox.behind };
  const plainOk = all.behind < all.open * 0.9 && Math.abs(self.behind - self.open) <= 1.5 && boxed.shaded < boxed.open * 0.9;
  const cascadesOk = cascades.all.behind < cascades.all.open * 0.9 && Math.abs(cascades.self.behind - cascades.self.open) <= 1.5 && cascades.box.shaded < cascades.box.open * 0.9;
  const ok = !failed && plainOk && cascadesOk;
  return {
    renderer: 'WebGPU',
    ok,
    all,
    self,
    box: boxed,
    cascades,
    failed,
    differs: NOTE_DIFFERS,
    note: "the luminance of display bytes on card A, its half behind card B from the sun against its half in the open: under 'all' the half behind darker, under 'self' the two within a level and a half, and with a box beyond the crown the half it shades darker than the other (the WebGL test's own tolerances); once on a plain shadow, and once more through the cascades as the game's sun is drawn (`cascades`: three's CSMShadowNode with its fade, the leaf floor's bias node on each cascade, a negative bias and a normal bias, a low sun)",
  };
}
