// Leaf cards drawn the client's way round: the card rule, on every material that wears a flora card shader,
// wherever it hangs (`CARD_TUNE.scope: 'shaders'`).
//
// **Which materials.** A flora card shader is one of the 329 the flora packs draw cut out or blended, and a
// shader is the same client effect wherever it is hung, so a placed copy was culled, blended and lit as a
// planted one was (inferred: the client's own state lives on the shader). 8,136 of the worlds' 101,172 placed
// objects wear one, 6,289 of them on Kashyyyk's six zones, whose forests are mostly placed; the character
// screens' baked places are copies of placed objects. None go through the flora, so the rule runs where every
// model's geometry and materials pass once before anything draws them -- `AssetPack.model`'s load callback, and
// the baked places' loader once its world's pack is in -- and the wrap in `World.adoptMaterials` takes what it
// marked. The shaders are known by name from a session-wide table: each pack's own `cards` (the flora command
// writes it beside the GLBs' `extras.swgCard`, from the same entries), and until a pack carries one, the names
// of the cut-out and blended materials its flora GLBs bring (`cardClass: 'names'` stands in for the class).
//
// **What the rule does**, each before the first compile and each a program-key change made there:
//   - every card is drawn from its **front** (the client's: the owner saw a lone card vanish from behind in the
//     original), and casts from **both** sides (`shadowSide`), or a lone card facing the sun would throw no
//     shadow at all (three draws a front-sided material's shadow from its back faces);
//   - **a card is never glass**: the canopy shaders the converter's name rule made glass are leaves, and drawn as
//     panes they let what is behind show and threw square shadows (the owner saw both);
//   - **no vertex colour on flora**: no flora program reads one, and the roots of Naboo's commonest tree carry a
//     near-black band of them where they meet the ground;
//   - and the mirror (`cardBacks.ts`), so each face takes the light on its own side.
//
// **The injection** (`SWG_CARD`, one wrap, after the cascades, the wet look, the detail map and the highlight):
//   - the alpha by the client's class: a cut-out at its own half, a blended card at a half too (an instanced
//     forest cannot be sorted) with its alpha raised by the texture's level so far crowns stay full
//     (`cardAlpha.ts` says why and is its mirror). Both cuts are shared uniforms: the class only picks which;
//   - the wet look: a card darkens in the rain and takes no gloss or sheen (`wetGloss`, 0: the client had no wet
//     look), and what sheen it takes is worked from whichever face is drawn (`abs` of the facing);
//   - the client's stored normal, worked out once from the geometry's own `normal` and `cardPlane`, which
//     `backs: 'stored'` lights every card by again, by a choice and never a `mix`;
//   - and the card light and the leaf shadow (`cardLight.ts`), under their own defines.
//
// Escape hatches: `localStorage['swg.cards'] = 'three'` skips the rule at load (cards drawn as converted), and
// `localStorage['swg.cardBacks'] = '0'` skips the mirror alone. A program that fails to compile draws nothing.
import * as THREE from 'three';
import { classByName, type CardClass } from './cardAlpha.ts';
import { CARD_PLANE, hasLonePad, mirrorCardGeometry, sheetsOf, zeroCardPlane } from './cardBacks.ts';
import { CARD_LIGHT_STATS, injectCardLight, markCardLight, STORED_LINE } from './cardLight.ts';
import { chainHas, wrapCompile, type Wrappable } from './compileHooks.ts';
import { boxOf, type LeafBox } from './leafShadow.ts';
import { SPEC_FILM_LINE } from './specular.ts';
import { WET_FLIP_LINE, WET_FRES_LINE, WET_GLOSS_LINE, WET_SHEEN_LINE } from './wetness.ts';

/** The card rule's knobs (`__debug.cards`). Load-time ones take effect as the next models load. */
export const CARD_TUNE = {
  /** `'shaders'`: every material wearing a flora card shader, planted, placed or in a baked place; `'flora'`: the flora pack's alone. Load-time. */
  scope: 'shaders' as 'shaders' | 'flora',
  /** `'hide'`: Kashyyyk's lone horizontal leaf pads drawn from the front like every other card (the owner's answer 7); `'split'`: a material drawing one stays double-sided. Load-time. */
  lone: 'hide' as 'hide' | 'split',
  /** `'both'`: a card casts from both its sides; `'back'` halves the shadow pass, and a lone card facing the sun then casts nothing. Load-time (it is in the depth program's key). */
  castSides: 'both' as 'both' | 'back',
  /** The cut on cards the client drew `a_punchout`: the client's own half. */
  cutPunch: 0.5,
  /** The cut on cards the client blended: ours, measured to match near. */
  cutBlend: 0.5,
  /** A blended card's alpha × (1 + k · level): ours, a measured fit. */
  mipScale: 0.1,
  /** The same for cut-outs. */
  mipScalePunch: 0,
  /** Where a card's class comes from: `'pack'` the converter's (its GLB's, else its pack's table, else the name); `'names'` the name's suffix alone; `'none'` no class. Load-time. */
  cardClass: 'pack' as 'pack' | 'names' | 'none',
  /** How much gloss and sheen a wet card takes: nought, so a card darkens in rain and never shines. */
  wetGloss: 0,
  /** Keep the vertex colours no flora program reads. Load-time. */
  colours: false,
  /** Let a flora card stay glass. Load-time. */
  glassLeaves: false,
  /** Mirror each card's back copy at load (the owner's answer 13); false leaves every geometry as converted. Load-time. */
  mirror: true,
  /** `'mirror'`: each face lit on its own side; `'stored'`: every card by the client's one normal again, for comparison. */
  backs: 'mirror' as 'mirror' | 'stored',
};
export type CardTune = typeof CARD_TUNE;

function stored(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** False when localStorage 'swg.cards' is 'three' (read once, at load): no card is ruled, mirrored or wrapped. */
export const CARD_RULE_ON: boolean = stored('swg.cards') !== 'three';
/** False when localStorage 'swg.cardBacks' is '0' (read once, at load): the mirror alone is skipped. */
export const CARD_BACKS_ON: boolean = stored('swg.cardBacks') !== '0';

// ---------------------------------------------------------------- the table of card shaders

/** What is known of a card shader: whether the client blended it, its emissive, and where that came from. */
interface CardShader {
  blend: boolean;
  emissive: [number, number, number];
  from: 'pack' | 'names';
}
/** Every flora card shader this session has met, by name: a pack's table wins over a name's guess. */
const CARD_SHADERS = new Map<string, CardShader>();

const num3 = (v: unknown): [number, number, number] => (Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((x) => typeof x === 'number' && Number.isFinite(x)) ? [v[0], v[1], v[2]] : [0, 0, 0]);

/** A pack's own `cards` table (the flora command's), by shader. Answers how many it named. */
export function registerPackCards(cards: unknown): number {
  if (!cards || typeof cards !== 'object') return 0;
  let n = 0;
  for (const [name, entry] of Object.entries(cards as Record<string, unknown>)) {
    const e = entry as { blend?: unknown; emissive?: unknown } | null;
    if (!e || typeof e.blend !== 'boolean') continue;
    CARD_SHADERS.set(name, { blend: e.blend, emissive: num3(e.emissive), from: 'pack' });
    n++;
  }
  return n;
}

/** The shape of the table of every world's leaf card shaders (`flora-cards.json`, beside the packs). */
export const SHARED_CARDS_VERSION = 1;

/**
 * Every world's leaf card shaders at once, out of `flora-cards.json`, which the flora command writes beside the
 * packs with each world's flora: `{ version, cards }`, the same rows as each pack's own `cards`. A world's placed
 * trees can wear a shader that only another world plants (all eight card-wearing placed models of Kashyyyk's
 * southern dungeons wear one the main zone plants), and known by each world's own table they were ruled only
 * once a world that plants it had been visited that session. A file of another shape is passed over whole.
 * Answers how many it named.
 */
export function registerSharedCards(file: unknown): number {
  const f = file as { version?: unknown; cards?: unknown } | null;
  if (!f || f.version !== SHARED_CARDS_VERSION) return 0;
  return registerPackCards(f.cards);
}

/** A flora GLB's cut-out or blended material, met before any table named it: its name stands in (`cardClass: 'names'`). */
function noteFloraCard(name: string): void {
  if (!CARD_SHADERS.has(name)) CARD_SHADERS.set(name, { blend: classByName(name) === 'blend', emissive: [0, 0, 0], from: 'names' });
}

/** Every card shader forgotten: a test standing in for a fresh session (the game keeps them for its whole life). */
export function forgetCardShaders(): void {
  CARD_SHADERS.clear();
}

/** Whether a shader is a flora card shader this session knows of. */
export function isCardShader(name: string): boolean {
  return CARD_SHADERS.has(name);
}

/** How many card shaders are known, and from where, for the console. */
export function cardShaderCounts(): { pack: number; names: number } {
  let pack = 0;
  let names = 0;
  for (const s of CARD_SHADERS.values()) if (s.from === 'pack') pack++;
  else names++;
  return { pack, names };
}

// ---------------------------------------------------------------- the rule, as a model loads

/** What the rule has done this session, for the console. */
export const CARD_STATS = {
  ruled: 0,
  glassMadeLeaves: 0,
  coloursDropped: 0,
  byClass: { blend: 0, punch: 0, none: 0 },
  from: { glb: 0, pack: 0, names: 0, none: 0 },
  lone: 0,
  geometries: 0,
  mirrored: 0,
  sheets: 0,
  added: 0,
  addedBytes: 0,
  mirrorMs: 0,
  planesZero: 0,
  injected: 0,
  missingAnchor: 0,
  missing: [] as string[],
};

/** A card's own state as the converter wrote it, kept so `rule: 'three'` can put it back. */
interface Original {
  side: THREE.Side;
  shadowSide: THREE.Side | null;
  transparent: boolean;
  depthWrite: boolean;
  alphaTest: number;
  vertexColors: boolean;
  glass: unknown;
  noShadow: unknown;
}
const originals = new WeakMap<THREE.Material, Original>();

/** Whether a material could be a card at all: a lit standard material drawn cut out or blended. */
function cardLike(m: THREE.Material): boolean {
  const s = m as THREE.MeshStandardMaterial;
  if (!s.isMeshStandardMaterial) return false;
  const u = m.userData;
  if (u.unlit || u.invisible || u.water) return false;
  return s.alphaTest > 0 || s.transparent || !!u.swgCard;
}

/** The class and emissive a card takes, and where they came from, under `cardClass`. */
function classOf(m: THREE.Material): { cls: CardClass | null; emissive: [number, number, number]; from: 'glb' | 'pack' | 'names' | 'none' } {
  const glb = m.userData.swgCard as { blend?: unknown; emissive?: unknown } | undefined;
  const entry = CARD_SHADERS.get(m.name);
  const emissive = glb && Array.isArray(glb.emissive) ? num3(glb.emissive) : entry?.from === 'pack' ? [...entry.emissive] as [number, number, number] : [0, 0, 0] as [number, number, number];
  if (CARD_TUNE.cardClass === 'none') return { cls: null, emissive, from: 'none' };
  if (CARD_TUNE.cardClass === 'names') return { cls: classByName(m.name), emissive, from: 'names' };
  if (glb && typeof glb.blend === 'boolean') return { cls: glb.blend ? 'blend' : 'punch', emissive, from: 'glb' };
  if (entry?.from === 'pack') return { cls: entry.blend ? 'blend' : 'punch', emissive, from: 'pack' };
  return { cls: classByName(m.name), emissive, from: 'names' };
}

/**
 * One card material, ruled in place before it ever compiles: its class and emissive written as plain values
 * (`swgCardBlend`, `swgCardEmissive`: a string and a plain array, never under `userData.swg`), drawn from its
 * front unless `lone` keeps it double-sided, casting from both sides, never glass, no vertex colours, and a
 * default for the plane attribute every card geometry carries in any case.
 */
function ruleMaterial(m: THREE.MeshStandardMaterial, lone: boolean, count: boolean): void {
  if (m.userData.swgCardBlend !== undefined) return;
  const { cls, emissive, from } = classOf(m);
  originals.set(m, { side: m.side, shadowSide: m.shadowSide, transparent: m.transparent, depthWrite: m.depthWrite, alphaTest: m.alphaTest, vertexColors: m.vertexColors, glass: m.userData.glass, noShadow: m.userData.noShadow });
  m.userData.swgCardBlend = cls ?? 'none';
  m.userData.swgCardEmissive = emissive;
  m.userData.swgCardFrom = from;
  if (!CARD_TUNE.glassLeaves && (m.transparent || m.userData.glass)) {
    m.transparent = false;
    m.depthWrite = true;
    if (!(m.alphaTest > 0)) m.alphaTest = 0.5;
    delete m.userData.glass;
    delete m.userData.noShadow;
    if (count) CARD_STATS.glassMadeLeaves++;
  }
  if (!(m.alphaTest > 0)) m.alphaTest = 0.5;
  if (lone && CARD_TUNE.lone === 'split') m.userData.swgCardLone = true;
  m.side = lone && CARD_TUNE.lone === 'split' ? THREE.DoubleSide : THREE.FrontSide;
  m.shadowSide = CARD_TUNE.castSides === 'both' ? THREE.DoubleSide : null;
  if (m.vertexColors && !CARD_TUNE.colours) {
    m.vertexColors = false;
    if (count) CARD_STATS.coloursDropped++;
  }
  // A guard for the first draw only (`cardBacks.ts` says why every card geometry carries the attribute anyway).
  (m as unknown as { defaultAttributeValues?: Record<string, number[]> }).defaultAttributeValues = { ...((m as unknown as { defaultAttributeValues?: Record<string, number[]> }).defaultAttributeValues ?? {}), [CARD_PLANE]: [0, 0, 0, 0] };
  if (count) {
    CARD_STATS.ruled++;
    CARD_STATS.byClass[cls ?? 'none']++;
    CARD_STATS.from[from]++;
    if (lone && CARD_TUNE.lone === 'split') CARD_STATS.lone++;
  }
}

/** How a model's materials are ruled: whether it is the flora pack's, and whether the stats count it (a self-test's do not). */
export interface CardModelOptions {
  flora: boolean;
  count?: boolean;
}

/** What one model came to: its card materials, its geometries mirrored and the vertices they gained. */
export interface CardModelReport {
  cards: number;
  mirrored: number;
  added: number;
  ms: number;
}

/** Every mesh of a model, over its scenes (its own and its lower levels'), once each. */
function meshesOf(scenes: readonly THREE.Object3D[]): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  const seen = new Set<THREE.Object3D>();
  for (const s of scenes) {
    s.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry || seen.has(o)) return;
      seen.add(o);
      out.push(m);
    });
  }
  return out;
}

const materialsOf = (m: THREE.Mesh): THREE.Material[] => (Array.isArray(m.material) ? m.material : [m.material]);

/**
 * The card rule on one model as it loads, before anything draws it (`scenes[0]` its own scene, the rest its lower
 * levels): which of its materials are cards, the rule on each, the mirror on every geometry only cards draw,
 * a plane of nought on any other a card draws, and each card's crown box (its model's finest-level card vertices,
 * or the whole model's under `box: 'model'`). A flora model's every material also loses its vertex colours, and
 * its cut-out and blended materials stand in for the table where its pack has none.
 */
export function prepareCardModel(scenes: readonly THREE.Object3D[], opts: CardModelOptions, box: 'cards' | 'model' = 'cards'): CardModelReport {
  const report: CardModelReport = { cards: 0, mirrored: 0, added: 0, ms: 0 };
  if (!CARD_RULE_ON || !scenes.length) return report;
  const count = opts.count !== false;
  const meshes = meshesOf(scenes);
  const cards = new Set<THREE.Material>();
  for (const mesh of meshes) {
    for (const m of materialsOf(mesh)) {
      if (!m) continue;
      if (opts.flora) {
        const s = m as THREE.MeshStandardMaterial;
        if (s.vertexColors && !CARD_TUNE.colours) {
          s.vertexColors = false;
          if (count) CARD_STATS.coloursDropped++;
        }
        if (cardLike(m)) noteFloraCard(m.name);
      }
      if (!cardLike(m)) continue;
      if (CARD_TUNE.scope === 'flora' ? opts.flora : opts.flora || CARD_SHADERS.has(m.name)) cards.add(m);
    }
  }
  if (!cards.size) return report;
  // The geometries cards draw, and whether anything else draws them too (GLTFLoader can hand one geometry to two
  // primitives of different materials, and one outside the rule leaves it alone).
  const byGeometry = new Map<THREE.BufferGeometry, THREE.Material[]>();
  for (const mesh of meshes) for (const m of materialsOf(mesh)) if (m) (byGeometry.get(mesh.geometry) ?? byGeometry.set(mesh.geometry, []).get(mesh.geometry)!).push(m);
  // Kashyyyk's lone leaf pads, kept double-sided under `lone: 'split'`.
  const lone = new Set<THREE.Material>();
  if (CARD_TUNE.lone === 'split') {
    for (const [g, mats] of byGeometry) {
      if (!mats.some((m) => cards.has(m))) continue;
      const pos = g.getAttribute('position');
      const nrm = g.getAttribute('normal');
      if (!pos || !nrm) continue;
      const P = new Float64Array(pos.count * 3);
      const N = new Float64Array(pos.count * 3);
      for (let v = 0; v < pos.count; v++) {
        P[v * 3] = pos.getX(v);
        P[v * 3 + 1] = pos.getY(v);
        P[v * 3 + 2] = pos.getZ(v);
        N[v * 3] = nrm.getX(v);
        N[v * 3 + 1] = nrm.getY(v);
        N[v * 3 + 2] = nrm.getZ(v);
      }
      const I = g.getIndex()?.array ?? Uint32Array.from({ length: pos.count }, (_, i) => i);
      if (hasLonePad(P, I, sheetsOf(P, N, I))) for (const m of mats) if (cards.has(m)) lone.add(m);
    }
  }
  // Each card's crown: the box of its model's card vertices (or the whole model's), in the frame the game draws a
  // model in (a model's own nodes stand at its origin), before the rule so the light's define sees it. Over every
  // level and not the finest alone: a lower level's sprite card can stand outside the finest crown, and its own
  // tree's shadow would then fall on it.
  let crown: LeafBox | null = null;
  for (const mesh of meshes) {
    if (box === 'cards' && !materialsOf(mesh).some((x) => cards.has(x))) continue;
    const pos = mesh.geometry.getAttribute('position');
    if (!pos) continue;
    const pts = new Float64Array(pos.count * 3);
    for (let v = 0; v < pos.count; v++) {
      pts[v * 3] = pos.getX(v);
      pts[v * 3 + 1] = pos.getY(v);
      pts[v * 3 + 2] = pos.getZ(v);
    }
    crown = boxOf(pts, crown);
  }
  for (const m of cards) {
    const c = crown as LeafBox | null;
    if (c) m.userData.swgLeaf = { min: [...c.min], max: [...c.max] };
    ruleMaterial(m as THREE.MeshStandardMaterial, lone.has(m), count);
    markCardLight(m);
  }
  report.cards = cards.size;
  // The mirror, on every geometry that only front-drawn cards draw; a plane of nought on any other a card draws.
  for (const [g, mats] of byGeometry) {
    if (!mats.some((m) => cards.has(m))) continue;
    if (count) CARD_STATS.geometries++;
    const all = mats.every((m) => cards.has(m) && (m as THREE.MeshStandardMaterial).side === THREE.FrontSide);
    if (all && CARD_TUNE.mirror && CARD_BACKS_ON) {
      const before = g.getAttribute('position')?.count ?? 0;
      const r = mirrorCardGeometry(g);
      report.ms += r.ms;
      if (r.mirrored) {
        report.mirrored++;
        report.added += r.added;
        if (count) {
          CARD_STATS.mirrored++;
          CARD_STATS.sheets += r.sheets;
          CARD_STATS.added += r.added;
          CARD_STATS.addedBytes += geometryBytesPerVertex(g) * r.added + 4 * (before + r.added);
        }
      } else if (count) CARD_STATS.planesZero++;
    } else if (zeroCardPlane(g) && count) CARD_STATS.planesZero++;
  }
  if (count) CARD_STATS.mirrorMs += report.ms;
  return report;
}

/** The bytes one vertex of a geometry holds over its attributes, but the plane. */
function geometryBytesPerVertex(g: THREE.BufferGeometry): number {
  let b = 0;
  for (const [name, a] of Object.entries(g.attributes)) {
    if (name === CARD_PLANE) continue;
    const arr = (a as THREE.BufferAttribute).array as unknown as { BYTES_PER_ELEMENT?: number };
    b += (arr.BYTES_PER_ELEMENT ?? 4) * a.itemSize;
  }
  return b;
}

// ---------------------------------------------------------------- the injection

/** The knobs, shared by reference into every card's uniforms. */
export const CARD_UNIFORMS = {
  uSwgCardCutPunch: { value: CARD_TUNE.cutPunch },
  uSwgCardCutBlend: { value: CARD_TUNE.cutBlend },
  uSwgCardMipScale: { value: CARD_TUNE.mipScale },
  uSwgCardMipScalePunch: { value: CARD_TUNE.mipScalePunch },
  uSwgCardWetGloss: { value: CARD_TUNE.wetGloss },
  uSwgCardBacksStored: { value: CARD_TUNE.backs === 'stored' ? 1 : 0 },
};

function writeUniforms(t: CardTune = CARD_TUNE): void {
  CARD_UNIFORMS.uSwgCardCutPunch.value = t.cutPunch;
  CARD_UNIFORMS.uSwgCardCutBlend.value = t.cutBlend;
  CARD_UNIFORMS.uSwgCardMipScale.value = t.mipScale;
  CARD_UNIFORMS.uSwgCardMipScalePunch.value = t.mipScalePunch;
  CARD_UNIFORMS.uSwgCardWetGloss.value = t.wetGloss;
  CARD_UNIFORMS.uSwgCardBacksStored.value = t.backs === 'stored' ? 1 : 0;
}

/** One card's own uniform: whether its class is the blended one. */
const perMaterial = new WeakMap<THREE.Material, { swgCardBlend: THREE.IUniform<number> }>();
export function cardUniformsOf(mat: THREE.Material): { swgCardBlend: THREE.IUniform<number> } {
  let u = perMaterial.get(mat);
  if (!u) {
    u = { swgCardBlend: { value: mat.userData.swgCardBlend === 'blend' ? 1 : 0 } };
    perMaterial.set(mat, u);
  }
  return u;
}

/** Vertex declarations: the plane every card geometry carries, and the switch to the client's own normal. */
export const CARD_VERTEX_PARS = /* glsl */ `
// The leaf cards' own (src/world/cardRule.ts): the plane the mirror reflected this vertex's normal through.
attribute vec4 cardPlane;
uniform float uSwgCardBacksStored;
`;

/**
 * Vertex, right after `#include <beginnormal_vertex>`: the client's stored normal, worked out once from the
 * geometry's own `normal` and the plane (normalised, nought kept nought: `normalize` of nought is undefined),
 * and taken in place of the mirrored one while `backs` is `'stored'` -- by a choice, never a `mix`, which would
 * carry a NaN from the side not chosen.
 */
export const CARD_STORED = /* glsl */ `
vec3 swgCardPlane = cardPlane.xyz;
float swgCardPlaneLen = length( swgCardPlane );
swgCardPlane = swgCardPlaneLen > 1e-4 ? swgCardPlane / swgCardPlaneLen : vec3( 0.0 );
vec3 swgStoredNormal = normal - 2.0 * dot( normal, swgCardPlane ) * swgCardPlane;
${STORED_LINE}
`;

/** Fragment declarations: the class's uniform and the shared cuts. */
export const CARD_PARS = /* glsl */ `
uniform float swgCardBlend;
uniform float uSwgCardCutPunch;
uniform float uSwgCardCutBlend;
uniform float uSwgCardMipScale;
uniform float uSwgCardMipScalePunch;
uniform float uSwgCardWetGloss;
`;

/**
 * In place of `#include <alphatest_fragment>`: a blended card's alpha raised by the texture's level (the floor
 * inside the log, cardAlpha.ts says why), then the class's cut. The derivatives are taken under a branch on a
 * uniform, which is uniform control flow.
 */
export const CARD_ALPHA = /* glsl */ `
#ifdef USE_ALPHATEST
{
	float swgCardK = swgCardBlend > 0.5 ? uSwgCardMipScale : uSwgCardMipScalePunch;
	#ifdef USE_MAP
	if ( swgCardK > 0.0 ) {
		vec2 swgCardTexel = vMapUv * vec2( textureSize( map, 0 ) );
		vec2 swgCardDx = dFdx( swgCardTexel );
		vec2 swgCardDy = dFdy( swgCardTexel );
		float swgCardLod = 0.5 * log2( max( max( dot( swgCardDx, swgCardDx ), dot( swgCardDy, swgCardDy ) ), 1e-12 ) );
		diffuseColor.a = min( 1.0, diffuseColor.a * ( 1.0 + swgCardK * max( 0.0, swgCardLod ) ) );
	}
	#endif
	if ( diffuseColor.a < ( swgCardBlend > 0.5 ? uSwgCardCutBlend : uSwgCardCutPunch ) ) discard;
}
#endif
`;

/** The wet look's lines on a card: gloss and sheen by `wetGloss`, the sheen's Fresnel from whichever face is drawn. */
export const CARD_WET_GLOSS = 'roughnessFactor = mix(roughnessFactor, min(roughnessFactor, 0.28), wetSurface * uSwgCardWetGloss);';
export const CARD_WET_FRES = 'float wetFres = 0.02 + 0.98 * pow(1.0 - saturate(abs(dot(normal, geometryViewDir))), 5.0);';
export const CARD_WET_SHEEN = 'reflectedLight.indirectSpecular += uWetSky * wetFres * (wetSurface * 0.3 + wetPuddle * 0.85) * (1.0 - wetSnow) * uSwgCardWetGloss;';
export const CARD_SPEC_FILM = 'swgSpecFilm = max( max( wetSurface * uSwgCardWetGloss, wetPuddle ), wetSnow );';

const COMMON = '#include <common>';
const BEGIN_NORMAL = '#include <beginnormal_vertex>';
const ALPHATEST = '#include <alphatest_fragment>';

/** Marks our own compile hook, so a material is never wrapped twice. */
export const CARD_HOOK = Symbol('card');

/** Warned once per missing anchor. */
const warned = new Set<string>();
function warnMissing(anchor: string): void {
  CARD_STATS.missingAnchor++;
  if (!CARD_STATS.missing.includes(anchor)) CARD_STATS.missing.push(anchor);
  if (warned.has(anchor)) return;
  warned.add(anchor);
  console.warn(`cardRule: no ${anchor} in this shader, so its leaves keep the converter's cut and three's sides`);
}

function after(source: string, anchor: string, code: string): string {
  const end = source.indexOf(anchor) + anchor.length;
  return `${source.slice(0, end)}\n${code}${source.slice(end)}`;
}

/**
 * The card rule into one compiled shader, with this material's own uniforms, then the card light (`cardLight.ts`).
 * Every anchor must be there or nothing is written at all, and it is said: a declaration with no use compiles, a
 * use with no declaration does not. The wet look's lines must all be there where the wet chunk is (`SWG_WET`), and
 * the film's where the highlight's is. Answers whether the rule went in.
 */
export function injectCard(shader: THREE.WebGLProgramParametersWithUniforms, mat: THREE.Material): boolean {
  const vs = shader.vertexShader;
  const fs = shader.fragmentShader;
  const lack = [COMMON, BEGIN_NORMAL].find((a) => !vs.includes(a)) ?? [COMMON, ALPHATEST].find((a) => !fs.includes(a));
  if (lack) {
    warnMissing(lack);
    return false;
  }
  const wet = fs.includes('#define SWG_WET');
  if (wet) {
    const wetLack = [WET_FLIP_LINE, WET_GLOSS_LINE, WET_FRES_LINE, WET_SHEEN_LINE].find((a) => !fs.includes(a));
    if (wetLack) {
      warnMissing(`the wet look's line ${wetLack}`);
      return false;
    }
  }
  let v = after(vs, COMMON, CARD_VERTEX_PARS);
  v = after(v, BEGIN_NORMAL, CARD_STORED);
  let f = after(fs, COMMON, CARD_PARS);
  f = f.replace(ALPHATEST, () => CARD_ALPHA);
  if (wet) {
    f = f.replace(WET_GLOSS_LINE, () => CARD_WET_GLOSS).replace(WET_FRES_LINE, () => CARD_WET_FRES).replace(WET_SHEEN_LINE, () => CARD_WET_SHEEN);
    if (f.includes(SPEC_FILM_LINE)) f = f.replace(SPEC_FILM_LINE, () => CARD_SPEC_FILM);
  }
  shader.vertexShader = v;
  shader.fragmentShader = f;
  Object.assign(shader.uniforms, CARD_UNIFORMS, cardUniformsOf(mat));
  CARD_STATS.injected++;
  const defines = mat.defines as Record<string, unknown> | undefined;
  if (defines && (defines.SWG_CARD_LIGHT !== undefined || defines.SWG_LEAF_SHADOW !== undefined)) injectCardLight(shader, mat);
  return true;
}

/**
 * Wrap a card's compile hook so the rule follows whatever came before (the cascades', the wet look's, the detail
 * map's, the highlight's), keyed apart under `card`. Idempotent through `wrapCompile`, and wrapped again after the
 * cascades replace the hook.
 */
export function applyCard(mat: THREE.MeshStandardMaterial): void {
  if (!chainHas(mat.onBeforeCompile, CARD_HOOK)) wrapCompile(mat as unknown as Wrappable, CARD_HOOK, 'card', (shader) => injectCard(shader as unknown as THREE.WebGLProgramParametersWithUniforms, mat));
}

/** The material scan's call (`World.adoptMaterials`), after the highlight's, in the same iteration: a material the rule marked as a card is wrapped. */
export function cardWrap(m: THREE.Material): void {
  if (!CARD_RULE_ON || m.userData.swgCardBlend === undefined || !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return;
  applyCard(m as THREE.MeshStandardMaterial);
}

/** Change the knobs live (`__debug.cards`): uniforms move at once; the load-time ones take effect as the next models load. */
export function setCardTune(o: Partial<CardTune>): CardTune {
  const t = CARD_TUNE;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (num(o.cutPunch)) t.cutPunch = Math.min(1, o.cutPunch);
  if (num(o.cutBlend)) t.cutBlend = Math.min(1, o.cutBlend);
  if (num(o.mipScale)) t.mipScale = o.mipScale;
  if (num(o.mipScalePunch)) t.mipScalePunch = o.mipScalePunch;
  if (num(o.wetGloss)) t.wetGloss = Math.min(1, o.wetGloss);
  if (o.backs === 'mirror' || o.backs === 'stored') t.backs = o.backs;
  if (o.scope === 'shaders' || o.scope === 'flora') t.scope = o.scope;
  if (o.lone === 'hide' || o.lone === 'split') t.lone = o.lone;
  if (o.castSides === 'both' || o.castSides === 'back') t.castSides = o.castSides;
  if (o.cardClass === 'pack' || o.cardClass === 'names' || o.cardClass === 'none') t.cardClass = o.cardClass;
  if (typeof o.colours === 'boolean') t.colours = o.colours;
  if (typeof o.glassLeaves === 'boolean') t.glassLeaves = o.glassLeaves;
  if (typeof o.mirror === 'boolean') t.mirror = o.mirror;
  writeUniforms(t);
  return { ...t };
}

/**
 * The converter's double-sided materials back (`rule: 'three'`), or the rule again (`'card'`), on the cards given:
 * sides, transparency, the cut and the colours as the GLB had them, with the injection's cuts held at the
 * converter's half and every card lit by the client's one normal. Every material changed recompiles: a stall,
 * which the console says.
 */
export function setCardRule(rule: 'three' | 'card', materials: Iterable<THREE.Material>): number {
  let n = 0;
  for (const m of materials) {
    const s = m as THREE.MeshStandardMaterial;
    const o = originals.get(m);
    if (!o) continue;
    if (rule === 'three') {
      s.side = o.side;
      s.shadowSide = o.shadowSide;
      s.transparent = o.transparent;
      s.depthWrite = o.depthWrite;
      s.alphaTest = o.alphaTest > 0 ? o.alphaTest : 0.5;
      s.vertexColors = o.vertexColors;
    } else {
      s.side = s.userData.swgCardLone ? THREE.DoubleSide : THREE.FrontSide;
      s.shadowSide = CARD_TUNE.castSides === 'both' ? THREE.DoubleSide : null;
      s.transparent = false;
      s.depthWrite = true;
      if (!(s.alphaTest > 0)) s.alphaTest = 0.5;
      if (!CARD_TUNE.colours) s.vertexColors = false;
    }
    s.needsUpdate = true;
    n++;
  }
  if (rule === 'three') {
    CARD_UNIFORMS.uSwgCardCutPunch.value = 0.5;
    CARD_UNIFORMS.uSwgCardCutBlend.value = 0.5;
    CARD_UNIFORMS.uSwgCardMipScale.value = 0;
    CARD_UNIFORMS.uSwgCardMipScalePunch.value = 0;
    CARD_UNIFORMS.uSwgCardWetGloss.value = 1;
    CARD_UNIFORMS.uSwgCardBacksStored.value = 1;
  } else writeUniforms();
  return n;
}

/** What the rule is doing, for the console. */
export function cardsReport(): Record<string, unknown> {
  const s = CARD_STATS;
  return {
    rule: CARD_RULE_ON ? 'on: every material wearing a flora card shader is drawn from its front, casts from both sides, is never glass and keeps no vertex colour' : "off for this load (localStorage['swg.cards'] = 'three'): cards drawn as converted",
    mirror: CARD_BACKS_ON && CARD_TUNE.mirror ? 'on: each card face lit on its own side' : "off (localStorage['swg.cardBacks'] = '0' or mirror false)",
    tune: { ...CARD_TUNE },
    shaders: cardShaderCounts(),
    switched: s.ruled,
    glassMadeLeaves: s.glassMadeLeaves,
    coloursDropped: s.coloursDropped,
    byClass: { ...s.byClass },
    classFrom: { ...s.from },
    lonePadsKeptDoubleSided: s.lone,
    mirror_: { geometries: s.geometries, mirrored: s.mirrored, sheets: s.sheets, verticesAdded: s.added, megabytesAdded: Number((s.addedBytes / 1048576).toFixed(3)), ms: Number(s.mirrorMs.toFixed(1)), planesOfNought: s.planesZero },
    injected: s.injected,
    missingAnchor: s.missingAnchor,
    missing: [...s.missing],
    light: { marked: CARD_LIGHT_STATS.marked, injected: CARD_LIGHT_STATS.injected, missingAnchor: CARD_LIGHT_STATS.missingAnchor, missing: [...CARD_LIGHT_STATS.missing] },
  };
}

/** Whether a material is a card the rule marked (`World` walks the scene for the live switches with it). */
export function isCard(m: THREE.Material): boolean {
  return m.userData.swgCardBlend !== undefined;
}

// Re-exported for the self-tests' callers.
export { writeUniforms as writeCardUniforms };
