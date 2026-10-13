// Flora sway in the world: which models sway, their shapes and shared uniforms, the wrap on their materials,
// the depth materials their shadows sway with, the clock, the wind and the eye (`swayMath.ts` holds the chunk,
// its mirror and the laws). Ours throughout, and shipped behind `SWAY_TUNE.on`.
//
// **Where it is decided.** Every swaying model is measured once as it loads (`AssetPack.model`'s load callback,
// after the card rule, which is what tells its cards from its trunk, and after the mirror, whose copied vertices
// the measurement counts once): a flora model when it carries a card or its id names a soft plant and nothing
// rigid (269 of the 455 flora models), a placed model when it wears a flora card shader on the same terms and is
// not a building. Every material of a swaying model, at every level, is marked `userData.swgSway` with its
// model's key, a string (a clone copies `userData` through JSON), which the wrap and the depth material look up
// in the table here; a lookup that fails hands a gain of nought, so the program text and key never change. The
// key is the pack's folder and the model's id, since a guest pack's ids may repeat a planet's.
//
// **Shadows sway with the leaves**: one `MeshDepthMaterial` per swaying material, with the same chunk and the
// same uniform objects, hung on every mesh drawn with it (`World.adoptMaterials`); three copies the side, the cut
// and the picture onto it at every shadow draw. They share one program key (`'swg-sway-depth'`), and their
// programs are built behind the loading screen by drawing stand-ins into the shadow maps as a frame does, under
// the world pass's lights and a room's, each set through depth materials of its own (`World.compileShadowDepth`
// says why a compile cannot stand in for that draw).
//
// **Spheres.** A crown moves up to about 1.2 m in a storm on the biggest trees, so every geometry of a swaying
// model has its own bounding sphere grown by the model's largest excursion once, as it loads: every sphere made
// from it afterwards -- a flora batch's, a chunk's, a placed tier's, the exit narrowing's, the cascades' culling --
// is grown with it, and an instance's scale grows the pad with the model as it grows the motion.
//
// `localStorage['swg.sway'] = '0'` skips the wrap at load: a program that fails to compile draws nothing.
import * as THREE from 'three';
import { padLeafBox } from './cardLight.ts';
import { chainHas, wrapCompile, type Wrappable } from './compileHooks.ts';
import { SWAY_APPLY, SWAY_DEFAULTS, SWAY_PARS, cyclesPerWrap, measureSway, omegaOf, stepClock, swayExcursion, swayOffset, swayPeriod, swaySelected, type SwayFrame, type SwayPrimitive, type SwayShape, type SwayTune } from './swayMath.ts';

export { SWAY_DEFAULTS, type SwayTune } from './swayMath.ts';

/** The knobs (`__debug.sway`). */
export const SWAY_TUNE: SwayTune = { ...SWAY_DEFAULTS };

/** False when localStorage 'swg.sway' is '0' (read once, at load): no model is marked and no material wrapped. */
export const SWAY_ON: boolean = (() => {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem('swg.sway') !== '0';
  } catch {
    return true;
  }
})();

/**
 * The wind the flora reads, written by the weather beside the water's (`weather.ts`): its heading as a unit
 * direction in x and z (0 is +Z, turning toward +X, the way the rain leans and the clouds drift) and its
 * strength apart, 0..1. The water's own loses its direction at nought, which on the commonest clear day is
 * nearly where it sits (a median strength of 0.042), so sway takes this one and its own calm floor.
 */
export const FLORA_WIND = { x: 0, z: 1, strength: 0 };

/** The shared uniforms: the wind and the switch, the knobs, the clock and the trunk rule, the eye, the fade. */
export const SWAY_UNIFORMS = {
  uSwayWind: { value: new THREE.Vector4(0, 1, 0, 1) },
  uSwayTune: { value: new THREE.Vector4() },
  uSwayTime: { value: new THREE.Vector4() },
  uSwayEye: { value: new THREE.Vector3() },
  uSwayFade: { value: new THREE.Vector2() },
};

/** One model's own uniforms: its shape and gain, its axis and frequency. Shared by every material, copy and depth material of the model. */
interface ModelUniforms {
  uSwayShape: THREE.IUniform<THREE.Vector4>;
  uSwayAxis: THREE.IUniform<THREE.Vector4>;
}

/** A swaying model as the table keeps it. */
export interface SwayModel {
  key: string;
  id: string;
  shape: SwayShape;
  /** Cycles a wrap at the period in force, and the frequency they make. */
  cycles: number;
  omega: number;
  excursion: number;
  uniforms: ModelUniforms;
}

/** Every model this session measured, by key. Kept for the session, since a guest pack's models outlive a world. */
const table = new Map<string, SwayModel>();
/** What a material whose model is not in the table is handed: a gain of nought. */
const NONE: ModelUniforms = { uSwayShape: { value: new THREE.Vector4(1, 0, 0, 0) }, uSwayAxis: { value: new THREE.Vector4() } };

/** The clock, seconds, wrapped; the flutter's quantised frequency. */
let clock = 0;
let flutterOmega = omegaOf(cyclesPerWrap(SWAY_TUNE.flutterPeriod, SWAY_TUNE.wrap), SWAY_TUNE.wrap);

/** What sway has done this session, for the console. */
export const SWAY_STATS = { considered: 0, swaying: 0, materials: 0, wrapped: 0, depthMaterials: 0, warmStandIns: 0, injected: 0, missingAnchor: 0, largestExcursion: 0 };

/** Whether a building's rooms are being drawn now (`setSwayRoomPass`). */
let roomPass = false;

/** Write the shared uniforms from the tune and the frame's state. Writes into the existing vectors; nothing allocated. */
function writeUniforms(): void {
  const t = SWAY_TUNE;
  const strength = typeof t.wind === 'number' ? t.wind : FLORA_WIND.strength;
  SWAY_UNIFORMS.uSwayWind.value.set(FLORA_WIND.x, FLORA_WIND.z, Math.min(1, Math.max(0, strength)), t.on && !roomPass ? 1 : 0);
  SWAY_UNIFORMS.uSwayTune.value.set(t.amp, t.calm, t.lean, t.flutter);
  SWAY_UNIFORMS.uSwayTime.value.set(clock, flutterOmega, t.trunk === 'bend' ? 1 : 0, 0);
  SWAY_UNIFORMS.uSwayFade.value.set(t.fadeNear, Math.max(t.fadeFar, t.fadeNear + 1e-3));
}
writeUniforms();

/** The frequencies worked out again (a period knob moved): each model's whole number of cycles a wrap, and the flutter's. */
function requantise(): void {
  const t = SWAY_TUNE;
  flutterOmega = omegaOf(cyclesPerWrap(t.flutterPeriod, t.wrap), t.wrap);
  for (const m of table.values()) {
    m.cycles = cyclesPerWrap(swayPeriod(m.shape.H, t), t.wrap);
    m.omega = omegaOf(m.cycles, t.wrap);
    m.uniforms.uSwayAxis.value.z = m.omega;
  }
}

/** One frame of the clock, at `1 + rateGain × strength`, wrapped. */
export function stepSway(dt: number): void {
  const strength = typeof SWAY_TUNE.wind === 'number' ? SWAY_TUNE.wind : FLORA_WIND.strength;
  clock = stepClock(clock, dt, strength, SWAY_TUNE);
  writeUniforms();
}

/**
 * A building's rooms pass begun or ended (the portal renderer's `roomPass`). A plant standing in a room -- a potted
 * plant, a planter -- wears its model's own materials and so carries the chunk wherever the model stands, but no
 * weather's wind reaches a room: in a rooms pass the switch is off and it stands still, while the same model out
 * of doors sways in the world's pass. A shared uniform, so nothing compiles. The sun's shadow pass is a world
 * pass: with furniture drawn per building, as it is unless that switch is off, no room's furniture casts in it.
 */
export function setSwayRoomPass(on: boolean): void {
  if (roomPass === on) return;
  roomPass = on;
  SWAY_UNIFORMS.uSwayWind.value.w = SWAY_TUNE.on && !roomPass ? 1 : 0;
}

/** Where the eye is, for the distance fade: the view camera's place, once a frame (never `cameraPosition`, which in the shadow pass is the cascade's). */
export function setSwayEye(p: THREE.Vector3): void {
  SWAY_UNIFORMS.uSwayEye.value.copy(p);
}

const materialsOf = (m: THREE.Mesh): THREE.Material[] => (Array.isArray(m.material) ? m.material : [m.material]);

/**
 * Measure and mark one model as it loads, if it sways (`scenes[0]` its own scene, the rest its lower levels).
 * `flora`: the flora pack's (it may sway on its id alone); otherwise it must wear a card. A building never sways.
 * Answers the model, or null.
 */
export function prepareSwayModel(scenes: readonly THREE.Object3D[], key: string, id: string, opts: { flora: boolean; building: boolean }): SwayModel | null {
  if (!SWAY_ON || !scenes.length || opts.building) return null;
  const meshes: THREE.Mesh[] = [];
  for (const s of scenes) s.traverse((o) => void ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry && meshes.push(o as THREE.Mesh)));
  const isCard = (m: THREE.Material | undefined) => !!m && m.userData.swgCardBlend !== undefined;
  // Whether it carries a card is its finest level's answer: two succulents draw a card only far off, as their
  // lowest level, and are no more a swaying plant for it.
  let hasCard = false;
  scenes[0].traverse((o) => {
    if ((o as THREE.Mesh).isMesh && materialsOf(o as THREE.Mesh).some(isCard)) hasCard = true;
  });
  if (!opts.flora && !hasCard) return null;
  SWAY_STATS.considered++;
  if (!swaySelected(id, hasCard)) return null;
  let model = table.get(key);
  if (!model) {
    const prims: SwayPrimitive[] = [];
    scenes[0].traverse((o) => {
      const m = o as THREE.Mesh;
      const pos = m.isMesh ? m.geometry?.getAttribute('position') : null;
      if (!pos) return;
      const a = new Float64Array(pos.count * 3);
      for (let v = 0; v < pos.count; v++) {
        a[v * 3] = pos.getX(v);
        a[v * 3 + 1] = pos.getY(v);
        a[v * 3 + 2] = pos.getZ(v);
      }
      prims.push({ positions: a, card: materialsOf(m).some(isCard) });
    });
    const shape = measureSway(prims);
    const cycles = cyclesPerWrap(swayPeriod(shape.H, SWAY_TUNE), SWAY_TUNE.wrap);
    const omega = omegaOf(cycles, SWAY_TUNE.wrap);
    const excursion = swayExcursion(shape.H, SWAY_TUNE);
    model = {
      key,
      id,
      shape,
      cycles,
      omega,
      excursion,
      uniforms: { uSwayShape: { value: new THREE.Vector4(shape.H, shape.c, shape.rT, 1) }, uSwayAxis: { value: new THREE.Vector4(shape.axisX, shape.axisZ, omega, 0) } },
    };
    table.set(key, model);
    SWAY_STATS.swaying++;
    if (excursion > SWAY_STATS.largestExcursion) SWAY_STATS.largestExcursion = excursion;
  }
  const pad = model.excursion;
  const padded = new Set<THREE.BufferGeometry>();
  const marked = new Set<THREE.Material>();
  for (const mesh of meshes) {
    const g = mesh.geometry;
    if (!padded.has(g) && g.userData.swgSwayPad === undefined) {
      if (!g.boundingSphere) g.computeBoundingSphere();
      if (g.boundingSphere) g.boundingSphere.radius += pad;
      g.userData.swgSwayPad = pad;
    }
    padded.add(g);
    for (const m of materialsOf(mesh)) {
      if (!m || marked.has(m)) continue;
      marked.add(m);
      m.userData.swgSway = key;
      SWAY_STATS.materials++;
      // A swayed leaf stays inside its own crown, so the leaf shadow's box grows with the motion.
      if (isCard(m)) padLeafBox(m, pad);
    }
  }
  return model;
}

/** A model's own uniforms by a material's mark, or the gain of nought. */
function modelUniformsOf(mat: THREE.Material): ModelUniforms {
  const key = mat.userData.swgSway;
  return (typeof key === 'string' && table.get(key)?.uniforms) || NONE;
}

const COMMON = '#include <common>';
const BEGIN_VERTEX = '#include <begin_vertex>';

/** Put the chunk into one compiled vertex stage, colour or depth, with the material's model's uniforms. Every anchor or nothing. */
export function injectSway(shader: THREE.WebGLProgramParametersWithUniforms, mat: THREE.Material): boolean {
  const vs = shader.vertexShader;
  if (!vs.includes(COMMON) || !vs.includes(BEGIN_VERTEX)) {
    SWAY_STATS.missingAnchor++;
    return false;
  }
  const a = vs.indexOf(COMMON) + COMMON.length;
  let v = `${vs.slice(0, a)}\n${SWAY_PARS}${vs.slice(a)}`;
  const b = v.indexOf(BEGIN_VERTEX) + BEGIN_VERTEX.length;
  v = `${v.slice(0, b)}\n${SWAY_APPLY}${v.slice(b)}`;
  shader.vertexShader = v;
  Object.assign(shader.uniforms, SWAY_UNIFORMS, modelUniformsOf(mat));
  SWAY_STATS.injected++;
  return true;
}

/** Marks our own compile hook, so a material is never wrapped twice. */
export const SWAY_HOOK = Symbol('sway');
const wrapped = new WeakSet<THREE.Material>();

/** The material scan's call (`World.adoptMaterials`), after the card rule's, in the same iteration: a material of a swaying model is wrapped. */
export function swayWrap(m: THREE.Material): void {
  if (!SWAY_ON || typeof m.userData.swgSway !== 'string' || !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
  if (chainHas(m.onBeforeCompile, SWAY_HOOK)) return;
  wrapCompile(m as unknown as Wrappable, SWAY_HOOK, 'sway', (shader) => injectSway(shader as unknown as THREE.WebGLProgramParametersWithUniforms, m));
  if (!wrapped.has(m)) {
    wrapped.add(m);
    SWAY_STATS.wrapped++;
  }
}

/** One shared hook and one shared key for every sway depth material: a depth program is shared per parameter set. */
function swayDepthHook(this: THREE.Material, shader: THREE.WebGLProgramParametersWithUniforms): void {
  injectSway(shader, this);
}
function swayDepthKey(): string {
  return 'swg-sway-depth';
}

const depthOf = new WeakMap<THREE.Material, THREE.MeshDepthMaterial>();

/** The depth material a swaying material's shadow is drawn with: made once, carrying its model's mark, let go of with its source. */
export function swayDepthFor(source: THREE.Material): THREE.MeshDepthMaterial {
  let d = depthOf.get(source);
  if (!d) {
    d = new THREE.MeshDepthMaterial();
    d.name = `sway depth (${source.name})`;
    d.userData.swgSway = source.userData.swgSway;
    d.onBeforeCompile = swayDepthHook as unknown as THREE.MeshDepthMaterial['onBeforeCompile'];
    d.customProgramCacheKey = swayDepthKey;
    depthOf.set(source, d);
    SWAY_STATS.depthMaterials++;
    const depth = d;
    source.addEventListener('dispose', () => {
      depth.dispose();
      depthOf.delete(source);
    });
  }
  return d;
}

/** Hang a mesh's sway depth material (or take it off with `shadow` off): each single-material mesh of a swaying model, before it ever casts. */
export function hangSwayDepth(mesh: THREE.Mesh): void {
  if (!SWAY_ON || Array.isArray(mesh.material) || !mesh.material) return;
  const m = mesh.material;
  if (typeof m.userData.swgSway !== 'string') return;
  if (SWAY_TUNE.shadow) mesh.customDepthMaterial = swayDepthFor(m);
  else if (mesh.customDepthMaterial && mesh.customDepthMaterial === depthOf.get(m)) mesh.customDepthMaterial = undefined;
}

/** Three's own rule for the side a shadow is drawn from (`WebGLShadowMap`'s): a material's `shadowSide`, else its side turned over. */
function shadowSideOf(m: THREE.Material): THREE.Side {
  if (m.shadowSide !== null && m.shadowSide !== undefined) return m.shadowSide;
  return m.side === THREE.FrontSide ? THREE.BackSide : m.side === THREE.BackSide ? THREE.FrontSide : THREE.DoubleSide;
}

/**
 * One stand-in per depth combination the swaying meshes given can draw their shadow with, so the world's warm-up
 * builds every sway depth program behind the loading screen (the loading sweep never builds a depth program). A
 * stand-in is drawn into the shadow maps as a caster really is (`World.compileShadowDepth`): it wears its source's
 * own material, from which three copies the side, the cut and the picture onto the depth material at the draw, and
 * hangs that depth material as its `customDepthMaterial`, set up as the draw sets it, so a compile of the depth
 * material alone builds the same program. What else is in a depth program's key -- instancing, the second
 * coordinate set -- is the mesh's and the geometry's, so it is in the combination too: an instanced mesh's
 * stand-in is instanced, a plain mesh's plain. Each casts and is culled by its sphere, which the warm-up stands in
 * front of the eye. Let go of after (`disposeStandIn`): the geometry and the materials are not theirs.
 */
export function swayDepthStandIns(meshes: readonly THREE.Mesh[], twin = ''): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  if (!SWAY_ON || !SWAY_TUNE.shadow) return out;
  const seen = new Set<string>();
  const identity = new THREE.Matrix4();
  for (const mesh of meshes) {
    const m = Array.isArray(mesh.material) ? null : mesh.material;
    if (!m || typeof m.userData.swgSway !== 'string') continue;
    const s = m as THREE.MeshStandardMaterial;
    const g = mesh.geometry;
    const side = shadowSideOf(m);
    const instanced = (mesh as THREE.InstancedMesh).isInstancedMesh === true;
    const key = `${instanced}|${side}|${s.alphaTest > 0}|${!!s.map}|${s.map?.channel ?? 0}|${!!s.alphaMap}|${!!g.attributes.uv1}|${!!g.attributes.uv2}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const d = twin ? depthTwin(m, twin, key) : swayDepthFor(m);
    d.side = side;
    d.alphaTest = s.alphaTest;
    d.map = s.map;
    d.alphaMap = s.alphaMap;
    let standIn: THREE.Mesh;
    if (instanced) {
      const im = new THREE.InstancedMesh(g, m, 1);
      im.setMatrixAt(0, identity);
      standIn = im;
    } else standIn = new THREE.Mesh(g, m);
    standIn.customDepthMaterial = d;
    standIn.castShadow = true;
    standIn.receiveShadow = false;
    standIn.name = 'sway depth stand-in';
    out.push(standIn);
  }
  SWAY_STATS.warmStandIns = out.length;
  return out;
}

/**
 * A depth material of the same program as a source's, kept for the session by combination and light set. Three
 * gives a depth material its program at its first draw and never changes it with the lights (it is unlit), so a
 * warm-up that drew one material under the world's lights and then a room's built only the first: each light set
 * is warmed through depth materials of its own, which hold their programs for every world after.
 */
const twins = new Map<string, THREE.MeshDepthMaterial>();
function depthTwin(source: THREE.Material, tag: string, key: string): THREE.MeshDepthMaterial {
  const k = `${tag}|${key}`;
  let d = twins.get(k);
  if (!d) {
    d = new THREE.MeshDepthMaterial();
    d.name = `sway depth stand-in (${tag})`;
    d.userData.swgSway = source.userData.swgSway;
    d.onBeforeCompile = swayDepthHook as unknown as THREE.MeshDepthMaterial['onBeforeCompile'];
    d.customProgramCacheKey = swayDepthKey;
    twins.set(k, d);
  }
  return d;
}

/** The mark the sources of `swayDepthCombos` carry: no model's, so their depth programs take a gain of nought (the text and key are every model's). */
export const SWAY_COMBO_KEY = 'sway depth combination';

/**
 * Sources standing for every depth combination a swaying material can cast with, whether or not anything wearing
 * it has loaded yet: instanced or not (a planting, a placed tier and a thing put down are instanced; a captured
 * place's copies are not), the shadow drawn from both sides (a card, a double-sided bark) or from the back (an
 * opaque front-sided trunk), and plain, pictured or pictured and cut out -- which is every way three keys a depth
 * program a converted model's swaying materials can differ in (`side`, `alphaTest`, the picture's set, instancing;
 * a picture is always on the first set and no swaying material carries an alpha picture, which the warm list's own
 * test holds on the packs). Offered to the world's warm-up beside the scene's own swaying meshes, so a placed tier
 * that streams in after the loading screen with a combination nothing at the arrival had finds its program built.
 * Made once a session; never in a scene; their materials are never compiled (only their stand-ins' depth twins are
 * drawn, `swayDepthStandIns`).
 */
let combos: THREE.Mesh[] | null = null;
export function swayDepthCombos(): THREE.Mesh[] {
  if (combos) return combos;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  const picture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  picture.needsUpdate = true;
  const out: THREE.Mesh[] = [];
  for (const instanced of [false, true]) {
    for (const both of [true, false]) {
      for (const kind of ['plain', 'pictured', 'cut'] as const) {
        const m = new THREE.MeshStandardMaterial({ map: kind === 'plain' ? null : picture, alphaTest: kind === 'cut' ? 0.5 : 0, side: THREE.FrontSide });
        m.shadowSide = both ? THREE.DoubleSide : null;
        m.name = `${SWAY_COMBO_KEY} (${instanced ? 'instanced' : 'plain'}, ${both ? 'both sides' : 'back'}, ${kind})`;
        m.userData.swgSway = SWAY_COMBO_KEY;
        out.push(instanced ? new THREE.InstancedMesh(g, m, 1) : new THREE.Mesh(g, m));
      }
    }
  }
  combos = out;
  return out;
}

/**
 * A plain stand-in's shadow hook: the depth material three hands it (the hook's sixth argument) is told to choose its
 * program again before this draw (`needsUpdate`, a step of its version). Three chooses a material's program again
 * only when its version moves or the draw differs in instancing, skinning, morphs, clipping, fog or tone mapping
 * (`WebGLRenderer`'s `setProgram`), never when `map`, `side` or `alphaMap` move, and its shadow pass writes exactly
 * those three onto its one shared depth material for each caster without a version step. Drawn back to back, the
 * instanced stand-ins on that shared material chose one program between them, at most, and every other key they
 * stand for was left for a live frame to build. A clone (a picture with a cut) chooses its own at its first draw
 * anyway, and choosing again where the key is built only finds it.
 */
export function chooseDepthProgram(_r: unknown, _o: unknown, _c: unknown, _s: unknown, _g: unknown, depthMaterial: THREE.Material): void {
  depthMaterial.needsUpdate = true;
}

/**
 * Stand-ins for every way three's own depth material can be drawn for a placed or flora caster that does not sway
 * (wave 8), one light set's worth: an instanced mesh of one copy for each side three gives the depth material (a
 * front-only material casts from its back, a double-sided one from both, a back-only one from its front) by each way
 * its picture can be in its key -- none, a picture, a picture with a cut (which three draws through a clone of its
 * depth material made per source material), and a picture with an alpha picture beside it (a split-alpha surface's)
 * with and without a cut -- on the first coordinate set, which is the only one a converted caster's picture uses.
 * Each set is drawn through sources of its own, kept for the session by `set`: a clone's program is fixed at its
 * first draw under whatever lights were set up then, so the world's set and the rooms' set each need a clone of their
 * own. Three's one shared depth material keeps the program it chose last until something it checks moves, so each
 * stand-in makes it choose again under this set's lights (`chooseDepthProgram`), or the shared keys would come to one.
 * Not culled; never in a scene but while the warm-up draws them; their geometry and materials are the session's.
 * Only instanced: every caster the page's switches and slider can turn on is an instanced mesh (a tier's copies, a
 * level group's, a thing put down in play, a flora batch, a chunk's own plants), and what is not (a building's rooms,
 * a captured place) casts as it always did.
 */
const plainCombos = new Map<string, THREE.InstancedMesh[]>();
export function plainDepthCombos(set: string): THREE.InstancedMesh[] {
  let out = plainCombos.get(set);
  if (out) return out;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  const picture = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  picture.needsUpdate = true;
  out = [];
  for (const side of [THREE.FrontSide, THREE.DoubleSide, THREE.BackSide]) {
    for (const kind of ['plain', 'pictured', 'cut', 'alphaPictured', 'alphaCut'] as const) {
      const alpha = kind === 'alphaPictured' || kind === 'alphaCut';
      const m = new THREE.MeshStandardMaterial({ side, map: kind === 'plain' ? null : picture, alphaMap: alpha ? picture : null, alphaTest: kind === 'cut' || kind === 'alphaCut' ? 0.5 : 0 });
      m.name = `plain depth combination (${set}, ${side === THREE.FrontSide ? 'cast from the back' : side === THREE.DoubleSide ? 'both sides' : 'cast from the front'}, ${kind})`;
      const s = new THREE.InstancedMesh(g, m, 1);
      s.setMatrixAt(0, new THREE.Matrix4());
      s.castShadow = true;
      s.receiveShadow = true;
      s.frustumCulled = false;
      s.name = 'plain depth stand-in';
      s.onBeforeShadow = chooseDepthProgram as THREE.Object3D['onBeforeShadow'];
      out.push(s);
    }
  }
  plainCombos.set(set, out);
  return out;
}

/** A stand-in let go of: an instanced one's own instance buffers only; the geometry and the material are the model's. */
export function disposeStandIn(s: THREE.Mesh): void {
  if ((s as THREE.InstancedMesh).isInstancedMesh) (s as THREE.InstancedMesh).dispose();
}

/** Change the knobs live (`__debug.sway`): uniforms, the frequencies requantised when a period moves; `shadow` is the caller's walk. */
export function setSwayTune(o: Partial<SwayTune>): SwayTune {
  const t = SWAY_TUNE;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  if (typeof o.on === 'boolean') t.on = o.on;
  if (num(o.amp) && o.amp >= 0) t.amp = o.amp;
  if (num(o.calm)) t.calm = Math.min(1, Math.max(0, o.calm));
  if (num(o.lean) && o.lean >= 0) t.lean = o.lean;
  let periods = false;
  if (num(o.periodBase) && o.periodBase > 0) {
    t.periodBase = o.periodBase;
    periods = true;
  }
  if (num(o.periodPow) && o.periodPow >= 0) {
    t.periodPow = o.periodPow;
    periods = true;
  }
  if (num(o.flutter) && o.flutter >= 0) t.flutter = o.flutter;
  if (num(o.flutterPeriod) && o.flutterPeriod > 0) {
    t.flutterPeriod = o.flutterPeriod;
    periods = true;
  }
  if (num(o.rateGain) && o.rateGain >= 0) t.rateGain = o.rateGain;
  if (o.trunk === 'still' || o.trunk === 'bend') t.trunk = o.trunk;
  if (num(o.fadeNear) && o.fadeNear >= 0) t.fadeNear = o.fadeNear;
  if (num(o.fadeFar) && o.fadeFar >= 0) t.fadeFar = o.fadeFar;
  if (typeof o.shadow === 'boolean') t.shadow = o.shadow;
  if (o.wind === 'weather' || (num(o.wind) && o.wind >= 0)) t.wind = o.wind;
  if (typeof o.freeze === 'boolean') t.freeze = o.freeze;
  if (o.clock === 'water' || o.clock === 'sim') t.clock = o.clock;
  if (periods) requantise();
  writeUniforms();
  return { ...t };
}

/** One model's numbers, by its id or its key. */
export function swayModel(name: string): (SwayModel & { period: number }) | null {
  const m = table.get(name) ?? [...table.values()].find((x) => x.id === name) ?? null;
  return m ? { ...m, period: SWAY_TUNE.wrap / m.cycles } : null;
}

/** What sway is doing, for the console. */
export function swayReport(): Record<string, unknown> {
  const strength = typeof SWAY_TUNE.wind === 'number' ? SWAY_TUNE.wind : FLORA_WIND.strength;
  const s = Math.min(1, Math.max(0, strength));
  const f = SWAY_TUNE.calm + (1 - SWAY_TUNE.calm) * (s <= 0 ? 0 : s >= 0.8 ? 1 : (s / 0.8) ** 2 * (3 - 2 * (s / 0.8)));
  return {
    wrap: SWAY_ON ? 'on: every swaying flora material and its shadow carry the chunk' : "off for this load (localStorage['swg.sway'] = '0')",
    tune: { ...SWAY_TUNE },
    models: { considered: SWAY_STATS.considered, swaying: SWAY_STATS.swaying },
    materials: { marked: SWAY_STATS.materials, wrapped: SWAY_STATS.wrapped, depth: SWAY_STATS.depthMaterials, injected: SWAY_STATS.injected, missingAnchor: SWAY_STATS.missingAnchor },
    warmStandIns: SWAY_STATS.warmStandIns,
    clock: { seconds: Number(clock.toFixed(3)), flutterPeriod: Number(((2 * Math.PI) / flutterOmega).toFixed(4)) },
    wind: { heading: Number(Math.atan2(FLORA_WIND.x, FLORA_WIND.z).toFixed(3)), strength: Number(s.toFixed(3)), bendFactor: Number(f.toFixed(3)), flutterFactor: Number((SWAY_TUNE.calm + (1 - SWAY_TUNE.calm) * s).toFixed(3)) },
    eye: SWAY_UNIFORMS.uSwayEye.value.toArray().map((v) => Number(v.toFixed(1))),
    largestExcursion: Number(SWAY_STATS.largestExcursion.toFixed(3)),
  };
}

/** The frame's state as the mirror reads it, from the shared uniforms. */
function frameNow(): SwayFrame {
  const w = SWAY_UNIFORMS.uSwayWind.value;
  const e = SWAY_UNIFORMS.uSwayEye.value;
  return { windX: w.x, windZ: w.y, strength: w.z, t: SWAY_UNIFORMS.uSwayTime.value.x, flutterOmega: SWAY_UNIFORMS.uSwayTime.value.y, eye: [e.x, e.y, e.z] };
}

/**
 * Render a probe built from the very chunk into a float target -- one point a test vertex, its displacement as its
 * colour -- and compare every one with `swayOffset` to a millimetre, as `gradeSelfTest` does: a still day and a
 * storm, the trunk still and bent, a planting turned and scaled, and one past the fade. Builds one program of its
 * own (a console call may).
 */
export function swaySelfTest(renderer: THREE.WebGLRenderer): { ok: boolean; cases: { name: string; worstMm: number; largestMm: number }[]; note: string } {
  const N = 64;
  const shape: SwayShape = { H: 12, c: 0.3, axisX: 0.4, axisZ: -0.2, rT: 0.5 };
  const model = { shape, omega: omegaOf(cyclesPerWrap(swayPeriod(12, SWAY_TUNE), SWAY_TUNE.wrap), SWAY_TUNE.wrap), gain: 1 };
  const shapeU = { value: new THREE.Vector4(shape.H, shape.c, shape.rT, 1) };
  const axisU = { value: new THREE.Vector4(shape.axisX, shape.axisZ, model.omega, 0) };
  const pts = new Float32Array(N * 3);
  const idx = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i * 2.399963) % (Math.PI * 2);
    const r = (i % 7) * 0.6;
    pts[i * 3] = Math.cos(a) * r;
    pts[i * 3 + 1] = (i / (N - 1)) * 13 - 0.5;
    pts[i * 3 + 2] = Math.sin(a) * r;
    idx[i] = i;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  geometry.setAttribute('aIndex', new THREE.BufferAttribute(idx, 1));
  const modelM = { value: new THREE.Matrix4() };
  const material = new THREE.ShaderMaterial({
    uniforms: { ...SWAY_UNIFORMS, uSwayShape: shapeU, uSwayAxis: axisU, swgProbeModel: modelM },
    vertexShader: `${SWAY_PARS}
uniform mat4 swgProbeModel;
attribute float aIndex;
varying vec3 vSwgProbe;
void main() {
	vSwgProbe = swgSwayOffset( position, swgProbeModel );
	gl_Position = vec4( ( ( aIndex + 0.5 ) / ${N}.0 ) * 2.0 - 1.0, 0.0, 0.0, 1.0 );
	gl_PointSize = 1.0;
}`,
    fragmentShader: 'varying vec3 vSwgProbe;\nvoid main() { gl_FragColor = vec4( vSwgProbe, 1.0 ); }',
    depthTest: false,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(points);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const target = new THREE.WebGLRenderTarget(N, 1, { type: THREE.FloatType, depthBuffer: false });
  const buf = new Float32Array(N * 4);
  const keep = { ...SWAY_TUNE };
  const keepClock = clock;
  const keepWind = { ...FLORA_WIND };
  const keepEye = SWAY_UNIFORMS.uSwayEye.value.clone();
  const prev = renderer.getRenderTarget();
  const cases: { name: string; worstMm: number; largestMm: number }[] = [];
  const out: [number, number, number] = [0, 0, 0];
  try {
    const runs: { name: string; strength: number; trunk: 'still' | 'bend'; t: number; yaw: number; scale: number; at: [number, number, number] }[] = [
      { name: 'a still day', strength: 0.05, trunk: 'still', t: 12.3, yaw: 0, scale: 1, at: [3, 0, -4] },
      { name: 'a storm', strength: 1, trunk: 'still', t: 47.9, yaw: 0.7, scale: 1.3, at: [-12, 1, 6] },
      { name: 'the whole tree bent', strength: 0.6, trunk: 'bend', t: 101.1, yaw: 2.2, scale: 0.8, at: [20, -2, 9] },
      { name: 'past the fade', strength: 1, trunk: 'still', t: 5, yaw: 0, scale: 1, at: [400, 0, 0] },
    ];
    for (const run of runs) {
      SWAY_TUNE.on = true;
      SWAY_TUNE.trunk = run.trunk;
      SWAY_TUNE.wind = run.strength;
      FLORA_WIND.x = Math.sin(0.9);
      FLORA_WIND.z = Math.cos(0.9);
      clock = run.t;
      SWAY_UNIFORMS.uSwayEye.value.set(0, 1.7, 0);
      writeUniforms();
      modelM.value.compose(new THREE.Vector3(...run.at), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), run.yaw), new THREE.Vector3(run.scale, run.scale, run.scale));
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, N, 1, buf);
      const f = frameNow();
      let worst = 0;
      let largest = 0;
      for (let i = 0; i < N; i++) {
        swayOffset(out, [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]], modelM.value.elements, model, f, SWAY_TUNE);
        largest = Math.max(largest, Math.hypot(out[0], out[1], out[2]));
        worst = Math.max(worst, Math.hypot(buf[i * 4] - out[0], buf[i * 4 + 1] - out[1], buf[i * 4 + 2] - out[2]));
      }
      cases.push({ name: run.name, worstMm: Number((worst * 1000).toFixed(3)), largestMm: Number((largest * 1000).toFixed(1)) });
    }
  } finally {
    Object.assign(SWAY_TUNE, keep);
    clock = keepClock;
    Object.assign(FLORA_WIND, keepWind);
    SWAY_UNIFORMS.uSwayEye.value.copy(keepEye);
    writeUniforms();
    renderer.setRenderTarget(prev);
    geometry.dispose();
    material.dispose();
    target.dispose();
  }
  const moved = cases.slice(0, 3).every((c) => c.largestMm > 1);
  return {
    ok: cases.every((c) => c.worstMm <= 1) && moved && cases[3].largestMm === 0,
    cases,
    note: 'every probe vertex against swayMath.swayOffset, in millimetres (worst under 1); the first three cases must move something and the one past the fade nothing',
  };
}
