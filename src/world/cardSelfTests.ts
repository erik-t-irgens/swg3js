// The leaf cards' self-tests: a node test compiles no GLSL, so these draw the very programs the game draws a
// card with, off-screen on a stage of their own (`cardStage.ts`), and hold their pixels against the arithmetic.
//
//   - `cardsSelfTest` (the card rule, under three's own light): a back-to-back pair on one set of vertices, lit
//     from the viewer's side, reads alike from both sides with the mirror and dark from one with `backs:
//     'stored'`; a lone card seen from behind draws nothing; and a lone card throws its shadow on the ground
//     whichever side of it the sun stands.
//   - `cardLightSelfTest` (the client's light): a card at N·L 1, 0 and −1 shows the client's own displayed bytes,
//     with the shadow map on and off alike; a mirrored pair under `sunSide: 'face'` shows the front colour from
//     the sun's side and the back colour from the other, and both the same under `'stored'`; and a point light on
//     the viewer's side lights both faces of a stored-normal pair at `pointFlat` 1, and only one at nought.
//   - `leafShadowSelfTest` (the leaf shadow): a crossed card pair, the half behind the crossing darker under
//     `'all'` and alike under `'self'`, and a box beyond the crown still shading it.
//
// Each builds programs of its own, which a console call may; none of its materials is counted among the
// world's, and every knob it moves is put back.
import * as THREE from 'three';
import { CARD_LIGHT_ON, CARD_LIGHT_TUNE, CARD_LIGHT_UNIFORMS, LEAF_SHADOW_ON, writeCardLightUniforms } from './cardLight.ts';
import { clientDisplay, clientLight, displayOf, type CardColours, type Rgb } from './cardLightMath.ts';
import { CARD_RULE_ON, CARD_UNIFORMS, applyCard, prepareCardModel, writeCardUniforms } from './cardRule.ts';
import { CardStage, stageSun, standInCascades, texelTexture, type Pixel } from './cardStage.ts';

/** A pixel's displayed bytes with the grade off: three's fit at exposure 1, then sRGB. */
function bytesOf(p: Pixel): Rgb {
  const d = displayOf([p[0], p[1], p[2]]);
  return [d[0] * 255, d[1] * 255, d[2] * 255];
}
const apart = (a: Rgb, b: Rgb) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
const round = (v: Rgb): number[] => v.map((x) => Number(x.toFixed(1)));
const lum = (v: Rgb) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];

/** A quad of `size` in the XY plane facing +Z (normals and winding alike), centred on the origin. */
function quad(size = 2): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(size, size);
}

/** The same quad with a back copy on the very same vertices wound the other way, carrying the front's normal: the client's commonest back. */
function sharedPair(size = 2): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(size, size);
  const front = Array.from(g.getIndex()!.array);
  const back: number[] = [];
  for (let i = 0; i < front.length; i += 3) back.push(front[i], front[i + 2], front[i + 1]);
  g.setIndex([...front, ...back]);
  return g;
}

/** A card material as a model load makes one: a cut-out of one known texel, ruled by the card rule (front-drawn, shadow both sides, the mirror on its geometry), and wrapped. */
function cardOn(stage: CardStage, geometries: THREE.BufferGeometry[], texel: [number, number, number, number], opts: { cascades: boolean; castShadow?: boolean }): { mat: THREE.MeshStandardMaterial; meshes: THREE.Mesh[] } {
  const mat = stage.own(new THREE.MeshStandardMaterial({ map: stage.own(texelTexture(texel)), roughness: 1, metalness: 0, alphaTest: 0.5, side: THREE.DoubleSide }));
  for (const g of geometries) stage.own(g);
  mat.name = 'swg card self-test';
  mat.userData.swgCard = { blend: false, emissive: [0, 0, 0] };
  const group = new THREE.Group();
  const meshes = geometries.map((g) => {
    const m = new THREE.Mesh(g, mat);
    m.castShadow = !!opts.castShadow;
    m.receiveShadow = true;
    group.add(m);
    return m;
  });
  prepareCardModel([group], { flora: true, count: false });
  if (opts.cascades) standInCascades(mat, stage.camera);
  applyCard(mat);
  stage.scene.add(group);
  return { mat, meshes };
}

/** Everything the card self-tests move, kept and put back. */
function keepKnobs(): () => void {
  const card = Object.fromEntries(Object.entries(CARD_UNIFORMS).map(([k, u]) => [k, u.value]));
  const light = Object.fromEntries(Object.entries(CARD_LIGHT_UNIFORMS).map(([k, u]) => [k, (u.value as { clone?: () => unknown }).clone ? (u.value as { clone: () => unknown }).clone() : u.value]));
  return () => {
    for (const [k, v] of Object.entries(card)) (CARD_UNIFORMS as Record<string, { value: unknown }>)[k].value = v;
    for (const [k, v] of Object.entries(light)) {
      const u = (CARD_LIGHT_UNIFORMS as Record<string, { value: unknown }>)[k];
      if ((u.value as { copy?: (x: unknown) => void }).copy) (u.value as { copy: (x: unknown) => void }).copy(v);
      else u.value = v;
    }
  };
}

export interface CardsSelfTest {
  ok: boolean;
  pair: { mirror: { front: number[]; back: number[]; apart: number }; stored: { front: number[]; back: number[]; darker: number } };
  loneFromBehind: { alpha: number };
  loneShadow: { sunFront: { ground: number; open: number }; sunBack: { ground: number; open: number } };
  note: string;
}

/** The card rule's own cases (see the file's head). */
export function cardsSelfTest(renderer: THREE.WebGLRenderer): CardsSelfTest | { ok: false; note: string } {
  if (!CARD_RULE_ON) return { ok: false, note: "the card rule is off for this load (localStorage['swg.cards'] = 'three')" };
  const restore = keepKnobs();
  const stage = new CardStage(renderer, 32, 1.4);
  try {
    // Three's own light throughout: the card light is the other test's.
    CARD_LIGHT_UNIFORMS.uSwgCardOn.value = 0;
    CARD_UNIFORMS.uSwgCardBacksStored.value = 0;
    const texel: [number, number, number, number] = [150, 170, 120, 255];
    // 1. A back-to-back pair on one set of vertices, lit from the viewer's side, read from each side.
    const pair = cardOn(stage, [sharedPair()], texel, { cascades: false });
    const sun = new THREE.DirectionalLight(0xffffff, Math.PI);
    stage.scene.add(sun, sun.target);
    const readSide = (side: 1 | -1): Rgb => {
      sun.position.set(0, 0, 10 * side);
      stage.view(new THREE.Vector3(0, 0, 5 * side), new THREE.Vector3(0, 0, 0));
      stage.render(false);
      return bytesOf(stage.at(0.5, 0.5));
    };
    const mf = readSide(1);
    const mb = readSide(-1);
    CARD_UNIFORMS.uSwgCardBacksStored.value = 1;
    const sf = readSide(1);
    const sb = readSide(-1);
    CARD_UNIFORMS.uSwgCardBacksStored.value = 0;
    stage.scene.remove(pair.meshes[0].parent!);
    // 2. A lone card seen from behind.
    const lone = cardOn(stage, [quad()], texel, { cascades: false, castShadow: true });
    sun.position.set(0, 0, -10);
    stage.view(new THREE.Vector3(0, 0, -5), new THREE.Vector3(0, 0, 0));
    stage.render(false);
    const behind = stage.at(0.5, 0.5)[3];
    stage.scene.remove(sun, sun.target);
    // 3. Its shadow on the ground, the sun on either side of it. The card stands upright over a plane a metre down.
    const ground = new THREE.Mesh(stage.own(new THREE.PlaneGeometry(8, 8).rotateX(-Math.PI / 2)), stage.own(new THREE.MeshStandardMaterial({ color: 0xb0b0b0, roughness: 1 })));
    ground.position.y = -1.2;
    ground.receiveShadow = true;
    stage.scene.add(ground);
    lone.meshes[0].position.y = 0;
    const shadowAt = (z: number): { ground: number; open: number } => {
      const s = stageSun(stage, new THREE.Vector3(0, 1, z), Math.PI, 4);
      stage.view(new THREE.Vector3(0, 6, 0), new THREE.Vector3(0, -1.2, 0));
      stage.render(true);
      // The shadow falls away from the sun, about 1.2 m out on the other side. Looking straight down, the screen's
      // up is the world's −Z, so a place at z is at a height of 0.5 − z over the view's width up the screen.
      const v = 0.5 + (Math.sign(z) * 1.2) / (2 * 1.4);
      const g = lum(bytesOf(stage.at(0.5, v)));
      const open = lum(bytesOf(stage.at(0.05, 0.5)));
      stage.scene.remove(s, s.target);
      s.shadow.map?.dispose();
      return { ground: Number(g.toFixed(1)), open: Number(open.toFixed(1)) };
    };
    const sunFront = shadowAt(1);
    const sunBack = shadowAt(-1);
    const ok =
      apart(mf, mb) <= 1 &&
      lum(mf) > 20 &&
      lum(sb) < lum(sf) * 0.5 &&
      behind < 0.01 &&
      sunFront.ground < sunFront.open * 0.8 &&
      sunBack.ground < sunBack.open * 0.8;
    return {
      ok,
      pair: { mirror: { front: round(mf), back: round(mb), apart: Number(apart(mf, mb).toFixed(2)) }, stored: { front: round(sf), back: round(sb), darker: Number((lum(sb) / Math.max(lum(sf), 1e-6)).toFixed(3)) } },
      loneFromBehind: { alpha: Number(behind.toFixed(3)) },
      loneShadow: { sunFront, sunBack },
      note: "display bytes with the grade off. The mirrored pair lit from the viewer's side reads alike from both sides (within one level) and, with backs 'stored', its far side under half the near; a lone card from behind draws nothing (alpha nought); its shadow on the ground is under 0.8 of the open ground with the sun on either side",
    };
  } finally {
    stage.dispose();
    restore();
    writeCardUniforms();
    writeCardLightUniforms();
  }
}

/** The colours the light tests light by: a sunny front, a mid tangent, a dark back, no fills. */
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
  u.uSwgCardSunSide.value = 0;
  u.uSwgCardPointFlat.value = 0.5;
  u.uSwgCardFills.value = 2;
  u.uSwgCardEmissiveOn.value = 1;
  u.uSwgLeafSelf.value = 1;
  u.uSwgLeafShare.value = 1;
}

/** What the client shows a texel at a `d`, fully lit, as display bytes. */
function clientBytes(texel: Rgb, d: number): Rgb {
  const g = clientLight(TEST_COLOURS, { d, shadow: 1, fillDot: 0, bounceDot: 0, emissive: [0, 0, 0] }, { fills: 'both', emissive: true, gain: 1, shadowLook: 'rise' });
  const disp = clientDisplay([texel[0] / 255, texel[1] / 255, texel[2] / 255], g, TEST_COLOURS, 1, 'rise');
  return [disp[0] * 255, disp[1] * 255, disp[2] * 255];
}

export interface CardLightSelfTest {
  ok: boolean;
  cases: { name: string; gpu: number[]; client: number[]; apart: number }[];
  shadowsOnOff: number;
  sides: { name: string; near: number[]; far: number[]; wantNear: number[]; wantFar: number[]; worst: number }[];
  pointFlat: { flat: { near: number; far: number }; none: { near: number; far: number } };
  note: string;
}

/** The card light's own cases (see the file's head). */
export function cardLightSelfTest(renderer: THREE.WebGLRenderer): CardLightSelfTest | { ok: false; note: string } {
  if (!CARD_RULE_ON || !CARD_LIGHT_ON) return { ok: false, note: "the card rule or the card light is off for this load (localStorage['swg.cards'] or ['swg.cardLight'])" };
  if (!THREE.ShaderChunk.lights_fragment_begin.includes('USE_CSM')) return { ok: false, note: "the cascades' light chunk is not installed (no shadows were ever set up), so no card takes the client's light" };
  const restore = keepKnobs();
  const stage = new CardStage(renderer, 32, 1.4);
  const texel: [number, number, number, number] = [60, 90, 40, 255];
  try {
    setTestColours(TEST_COLOURS);
    CARD_UNIFORMS.uSwgCardBacksStored.value = 0;
    // 1. One card facing +Z, the sun at N·L 1, 0 and −1, the shadow map on and off.
    const card = cardOn(stage, [quad()], texel, { cascades: true });
    stage.view(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, 0));
    const cases: CardLightSelfTest['cases'] = [];
    let onOff = 0;
    for (const [name, toward, d] of [['N·L 1', new THREE.Vector3(0, 0, 1), 1], ['N·L 0', new THREE.Vector3(1, 0, 0), 0], ['N·L −1', new THREE.Vector3(0, 0, -1), -1]] as const) {
      const sun = stageSun(stage, toward, Math.PI, 3);
      stage.render(true);
      const on = bytesOf(stage.at(0.5, 0.5));
      stage.render(false);
      const off = bytesOf(stage.at(0.5, 0.5));
      onOff = Math.max(onOff, apart(on, off));
      const want = clientBytes([texel[0], texel[1], texel[2]], d);
      cases.push({ name, gpu: round(on), client: round(want), apart: Number(apart(on, want).toFixed(2)) });
      stage.scene.remove(sun, sun.target);
      sun.shadow.map?.dispose();
    }
    stage.scene.remove(card.meshes[0].parent!);
    // 2. A mirrored pair from both sides, the sun at +Z: the face rule and the stored rule.
    const pair = cardOn(stage, [sharedPair()], texel, { cascades: true });
    const sun = stageSun(stage, new THREE.Vector3(0, 0, 1), Math.PI, 3);
    const read = (side: 1 | -1): Rgb => {
      stage.view(new THREE.Vector3(0, 0, 5 * side), new THREE.Vector3(0, 0, 0));
      stage.render(true);
      return bytesOf(stage.at(0.5, 0.5));
    };
    const sides: CardLightSelfTest['sides'] = [];
    for (const side of ['face', 'stored'] as const) {
      CARD_LIGHT_UNIFORMS.uSwgCardSunSide.value = side === 'stored' ? 1 : 0;
      const near = read(1);
      const far = read(-1);
      const wantNear = clientBytes([texel[0], texel[1], texel[2]], 1);
      const wantFar = clientBytes([texel[0], texel[1], texel[2]], side === 'face' ? -1 : 1);
      sides.push({ name: side, near: round(near), far: round(far), wantNear: round(wantNear), wantFar: round(wantFar), worst: Number(Math.max(apart(near, wantNear), apart(far, wantFar)).toFixed(2)) });
    }
    CARD_LIGHT_UNIFORMS.uSwgCardSunSide.value = 0;
    // 3. A point light on the viewer's side, the sun turned off (nothing but the point light), every card lit by
    // the client's one normal: at pointFlat 1 both faces take it, at nought the one whose normal faces away does not.
    sun.intensity = 0;
    setTestColours({ ...TEST_COLOURS, front: [0, 0, 0], tangent: [0, 0, 0], back: [0, 0, 0] });
    CARD_UNIFORMS.uSwgCardBacksStored.value = 1;
    const lamp = new THREE.PointLight(0xffffff, 30, 0, 2);
    stage.scene.add(lamp);
    const lampRead = (side: 1 | -1): number => {
      lamp.position.set(0, 0, 2 * side);
      stage.view(new THREE.Vector3(0, 0, 5 * side), new THREE.Vector3(0, 0, 0));
      stage.render(false);
      return lum(bytesOf(stage.at(0.5, 0.5)));
    };
    CARD_LIGHT_UNIFORMS.uSwgCardPointFlat.value = 1;
    const flat = { near: Number(lampRead(1).toFixed(1)), far: Number(lampRead(-1).toFixed(1)) };
    CARD_LIGHT_UNIFORMS.uSwgCardPointFlat.value = 0;
    const none = { near: Number(lampRead(1).toFixed(1)), far: Number(lampRead(-1).toFixed(1)) };
    stage.scene.remove(lamp, sun, sun.target, pair.meshes[0].parent!);
    sun.shadow.map?.dispose();
    const ok =
      cases.every((c) => c.apart <= 2) &&
      onOff <= 1 &&
      sides.every((s) => s.worst <= 2) &&
      flat.near > 10 &&
      Math.abs(flat.near - flat.far) <= Math.max(1, flat.near * 0.03) &&
      none.far < none.near * 0.25;
    return {
      ok,
      cases,
      shadowsOnOff: Number(onOff.toFixed(2)),
      sides,
      pointFlat: { flat, none },
      note: "display bytes with the grade off and the curve 'client': each case within 2 of the client's own, the shadow map on and off within 1 of each other, the face rule's far side the back colour and the stored rule's the front, and a point light lighting both faces alike at pointFlat 1 and the far one under a quarter at nought",
    };
  } finally {
    stage.dispose();
    restore();
    writeCardUniforms();
    writeCardLightUniforms();
  }
}

export interface LeafShadowSelfTest {
  ok: boolean;
  all: { behind: number; open: number };
  self: { behind: number; open: number };
  box: { shaded: number; open: number };
  note: string;
}

/** The leaf shadow's own cases (see the file's head). */
export function leafShadowSelfTest(renderer: THREE.WebGLRenderer): LeafShadowSelfTest | { ok: false; note: string } {
  if (!CARD_RULE_ON || !LEAF_SHADOW_ON) return { ok: false, note: "the card rule or the leaf shadow is off for this load (localStorage['swg.cards'] or ['swg.leafShadow'])" };
  if (!THREE.ShaderChunk.lights_fragment_begin.includes('USE_CSM')) return { ok: false, note: "the cascades' light chunk is not installed (no shadows were ever set up)" };
  const restore = keepKnobs();
  const stage = new CardStage(renderer, 64, 1.4);
  try {
    setTestColours(TEST_COLOURS);
    CARD_UNIFORMS.uSwgCardBacksStored.value = 0;
    // A crossed pair: card A facing +Z, card B across it facing +X, both one model's (one crown).
    const a = quad();
    const b = quad().rotateY(Math.PI / 2);
    const pair = cardOn(stage, [a, b], [200, 200, 200, 255], { cascades: true, castShadow: true });
    const toward = new THREE.Vector3(1, 0.3, 1).normalize();
    const sun = stageSun(stage, toward, Math.PI, 5);
    CARD_LIGHT_UNIFORMS.uSwgLeafSun.value.copy(toward);
    CARD_LIGHT_UNIFORMS.uSwgLeafRange.value.setScalar(sun.shadow.camera.far - sun.shadow.camera.near);
    stage.view(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, 0));
    // Card A's left half lies behind card B from the sun; its right half is in the open.
    const left = 0.5 - 0.5 / (2 * 1.4);
    const right = 0.5 + 0.5 / (2 * 1.4);
    const halves = (): { behind: number; open: number } => {
      stage.render(true);
      return { behind: Number(lum(bytesOf(stage.at(left, 0.5))).toFixed(1)), open: Number(lum(bytesOf(stage.at(right, 0.5))).toFixed(1)) };
    };
    CARD_LIGHT_UNIFORMS.uSwgLeafSelf.value = 0;
    const all = halves();
    CARD_LIGHT_UNIFORMS.uSwgLeafSelf.value = 1;
    const self = halves();
    // A box beyond the crown, between the sun and card A's right half.
    const box = new THREE.Mesh(stage.own(new THREE.BoxGeometry(0.7, 0.7, 0.7)), stage.own(new THREE.MeshStandardMaterial({ color: 0x808080 })));
    box.position.set(0.5, 0, 0).addScaledVector(toward, 3.2);
    box.castShadow = true;
    stage.scene.add(box);
    const withBox = halves();
    stage.scene.remove(box, sun, sun.target, pair.meshes[0].parent!);
    sun.shadow.map?.dispose();
    const boxed = { shaded: withBox.open, open: withBox.behind };
    const ok = all.behind < all.open * 0.9 && Math.abs(self.behind - self.open) <= 1.5 && boxed.shaded < boxed.open * 0.9;
    return {
      ok,
      all,
      self,
      box: boxed,
      note: "the luminance of display bytes on card A, its half behind card B from the sun against its half in the open: under 'all' the half behind darker, under 'self' the two within a level and a half, and with a box beyond the crown the half it shades darker than the other",
    };
  } finally {
    stage.dispose();
    restore();
    writeCardUniforms();
    writeCardLightUniforms();
  }
}

/** The tune the self-tests leave alone, said so the console can show it with the answer. */
export function selfTestTune(): { sunSide: string; pointFlat: number } {
  return { sunSide: CARD_LIGHT_TUNE.sunSide, pointFlat: CARD_LIGHT_TUNE.pointFlat };
}
