// The people's program keys (the performance pass): the morph ladder every skinned primitive is padded to at load
// (the second wave), and in the fourth wave the normalisation of person and rack-weapon materials onto one set of
// shapes warmed once a session.
//
// A skinned primitive's morph count is in three's program key, and the converted packs carry counts from 0 to 33 (the
// heads 19 to 33, different by species and gender), so the motion blur's variants and the skinned depth programs were
// sets read off whatever the packs happened to hold, met for the first time in play and built there. Padded at load to
// the next rung of a ladder of ours (`morphLadder`, with zero targets that move no vertex at an influence of nought),
// the counts in the keys come to three, and every warm list built from them is closed and ours: nothing read off the
// packs is committed. A count past the top rung keeps its own.
//
// Both numbers are read once at load. The warm lists are built from the ladder at the first loading screen, and a
// ladder moved in a session would pad new geometry to rungs nobody warmed, so `__debug.skinnedLoad` prints them and
// refuses a change in words.
//
// The fourth wave: the rest of what splits a person's colour program is which maps its material carries (a colour
// map alone, with a normal map, with the metal-rough image, or all three) and whether it has a reflection cube. So
// every skinned material and every rack weapon's is given, at the world's first sight of it (`World.adoptMaterials`,
// before the cascades and every wrap, since all of it is in the program key), whatever it lacks of a superset that
// changes no pixel: a normal map of one float texel of exactly (0.5, 0.5, 1), whose `2t - 1` is exactly (0, 0, 1) and
// so leaves the interpolated normal where it was (`tbn * (0, 0, 1)` is the frame's third column); one white texel for
// the roughness and metalness maps, which multiplies both factors by one and whose red, which three never reads, is
// the client's shine mask of one (the highlight's own default); and the world's environment at a strength of nought
// (`swgEnvBase` 0, so every scale and switch of the registry still writes nought), which takes neither a reflection nor
// a fill, the rule a planet's plain materials already follow. The shapes left are a closed product of our own
// (`personShapes`: the ladder's rungs by the three sides by opaque or cut, and a rack weapon's sides by cut), whose
// stand-ins every loading screen compiles for both passes (`signatureStandIns`, `World.warmPersonShapes`), so from the
// first screen on a person built in play finds its programs built already. A material that falls outside the product
// (a blended visor, a glow map, an untextured placeholder) is named by `__debug.personKeys()` and goes on the queue as
// before. `localStorage['swg.personKeys'] = '0'` leaves all of it out at load. Pure but for three; node loads it.
import * as THREE from 'three';
import { MODEL_REFLECTIONS_AT_LOAD, isRegisteredReflective, registerReflective, unregisterReflective } from './envmap.ts';

/** Read once at load; see the file's head. [ours] */
export const PERSON_KEYS_TUNE: { readonly morphLadder: readonly number[]; readonly on: boolean } = Object.freeze({
  /**
   * Every skinned primitive's morph count is padded up to the next rung (wave 2); one past the top keeps its own. 7
   * takes the commonest counts (3 and 4 are about five in six of the morphed primitives converted) and 33 the highest
   * any converted primitive carries (the heads run 19 to 33); a rung between would warm programs few bodies use.
   */
  morphLadder: Object.freeze([0, 7, 33]),
  /** The fourth wave's maps superset and reflection at nought; `localStorage['swg.personKeys'] = '0'` skips it at load. */
  on: readHatch('swg.personKeys'),
});

/** A `localStorage` hatch read once: on unless it says '0'. Storage that throws (a private window) reads as on. */
export function readHatch(key: string): boolean {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem(key) !== '0';
  } catch {
    return true;
  }
}

/**
 * Whether the ladder is in force this session, read once at load: `localStorage['swg.morphLadder'] = '0'` leaves every
 * skinned primitive its own count, and then every warm list made from the ladder is the first wave's instead (the
 * motion blur's fourteen variants read off the packs, no skinned depth combinations), so the hatch really is the old
 * way to compare against and not the ladder's lists warming counts nothing carries.
 */
export const MORPH_LADDER_ON: boolean = readHatch('swg.morphLadder');

/** The ladder the warm lists are made from this session: the ladder, or none with the hatch off. */
export function warmLadder(on: boolean = MORPH_LADDER_ON): readonly number[] | null {
  return on ? PERSON_KEYS_TUNE.morphLadder : null;
}

/** The rung a morph count is padded to: the first at or above it, or the count itself past the top. */
export function morphRung(count: number, ladder: readonly number[] = PERSON_KEYS_TUNE.morphLadder): number {
  for (let i = 0; i < ladder.length; i++) if (count <= ladder[i]) return ladder[i];
  return count;
}

// ---------------------------------------------------------------------------------------------------------------------
// The fourth wave: the maps superset.

let flatNormal: THREE.DataTexture | null = null;
let whiteTexel: THREE.DataTexture | null = null;

/**
 * The session's flat normal map: one texel of exactly (0.5, 0.5, 1), stored as floats. Three reads a tangent-space
 * normal map as `normalize(tbn * (2t - 1))`, and `2 * 0.5 - 1` is exactly nought in float, so the normal comes out the
 * frame's own third column, the interpolated vertex normal; an eight-bit texel is 127 or 128 and would lean it. Nearest
 * filtering with no mipmaps keeps a float texture complete without the linear-filtering extension. Made once, never
 * disposed (a texture, not a material: nothing forgets it).
 */
export function flatNormalMap(): THREE.DataTexture {
  if (!flatNormal) {
    const t = new THREE.DataTexture(new Float32Array([0.5, 0.5, 1, 1]), 1, 1, THREE.RGBAFormat, THREE.FloatType);
    t.name = 'swg.flatNormal';
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    flatNormal = t;
  }
  return flatNormal;
}

/**
 * The session's white texel, for a material's roughness and metalness maps (three reads the roughness from its green
 * and the metalness from its blue, each multiplied into its factor: by one) and for the stand-ins' colour maps. Its red
 * is the client's shine mask (`specular.ts` reads it where a roughness map is), one, which is the highlight's default
 * where none is. Made once, never disposed.
 */
export function whiteMap(): THREE.DataTexture {
  if (!whiteTexel) {
    const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.name = 'swg.whiteTexel';
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    whiteTexel = t;
  }
  return whiteTexel;
}

/** Whether a material's normal map is the session's flat one (a recipe that puts a real normal map on it takes this away). */
export function isFlatNormal(material: THREE.Material): boolean {
  return flatNormal !== null && (material as THREE.MeshStandardMaterial).normalMap === flatNormal;
}

/**
 * Whether the world's normal-map scale is written onto a material (`World.adoptMaterials`, `World.setNormalScale`): one
 * with a normal map of its own. The flat one is left alone; its slope is nought whatever the scale says.
 */
export function takesNormalScale(material: THREE.Material): boolean {
  const s = material as THREE.MeshStandardMaterial;
  return !!s.normalMap && !!s.normalScale && !isFlatNormal(material);
}

/** What normalisation gave one material, so the self test and the comparing switch can take it off and put it back. */
interface Given {
  normal: boolean;
  roughness: boolean;
  metalness: boolean;
  env: boolean;
}

/** The facts of the mesh a material was first met on that the product reads (its geometry's shape, never the mesh). */
export interface MeshFacts {
  skinned: boolean;
  /** Morph targets on its geometry, after the ladder padded them. */
  morphs: number;
  morphNormals: boolean;
  morphColors: boolean;
  normals: boolean;
  tangents: boolean;
}

/** What is known of one material met this session (normalised or not), for the console. */
interface Met {
  kind: 'person' | 'rack';
  facts: MeshFacts;
  /** Its shape before normalisation and after, as `shapeKey` writes them. */
  before: string;
  after: string;
}

/** Every skinned and rack material met this session, kept until it is disposed; the stand-ins' own are not here. */
const met = new Map<THREE.Material, Met>();
const given = new WeakMap<THREE.Material, Given>();

/** What normalisation has done this session, for `__debug.personKeys()`. */
export const PERSON_KEYS_STATS = {
  /** Materials normalised (skinned and rack), and of them rack weapons'. */
  normalised: 0,
  rack: 0,
  /** Of the slots: flat normals given, white maps given (a material counts once for both), environments joined at nought. */
  normals: 0,
  masks: 0,
  envs: 0,
  /** Skinned or rack materials met that are not three's lit standard kind (an unlit droid, a hologram), never normalised. */
  refused: 0,
  /**
   * Bodies stood outdoors in play whose every material came out on a warmed program, so their rooms pass was found at
   * the urgent rank (key lookups) and they were room-ready a frame or two after they were shown, never deferred
   * (`World.compileReady`, `urgentRooms`).
   */
  roomReady: 0,
  /** Of those, a rooms pass that built a program after all (issued and polled on the queue): a hole in the product's reading, said once. Nought. */
  roomMissed: 0,
};

/** The facts of the mesh a material is first met on. */
export function factsOf(mesh: THREE.Object3D | null | undefined): MeshFacts {
  const m = mesh as THREE.Mesh | null | undefined;
  const g = m?.geometry;
  const pos = g?.morphAttributes?.position;
  const morphs = pos?.length ?? 0;
  return {
    skinned: !!(mesh as THREE.SkinnedMesh | undefined)?.isSkinnedMesh,
    morphs,
    morphNormals: morphs > 0 && (g?.morphAttributes?.normal?.length ?? 0) === morphs,
    morphColors: (g?.morphAttributes?.color?.length ?? 0) > 0,
    normals: !!g?.getAttribute?.('normal'),
    tangents: !!g?.getAttribute?.('tangent'),
  };
}

/** Whether a material on this mesh is one the fourth wave normalises: a skinned mesh's, a rack weapon's, or a copy of one it normalised. */
export function isPersonMaterial(material: THREE.Material, owner: THREE.Object3D | null | undefined): boolean {
  if (!PERSON_KEYS_TUNE.on) return false;
  const u = material.userData;
  return !!(owner as THREE.SkinnedMesh | undefined)?.isSkinnedMesh || u.swgRack === true || u.swgPersonEnv === true;
}

/** One texture slot of a shape: present, and on which coordinate set. */
function slot(t: THREE.Texture | null | undefined): string {
  return t ? (t.channel ? `@${t.channel}` : '+') : '-';
}

/**
 * The parts of a material's program key a person's or a weapon's can differ in, written as one string: the material's
 * kind, its maps and their coordinate sets, its side, cut and blend, vertex colours, the highlight, a detail map and
 * its environment; and the mesh's skinning, morphs, normals and tangents. The light set and the target are the pass's
 * and the same for everybody, and the hooks' text is one text for every material, so they are not in it.
 */
export function shapeKey(material: THREE.Material, f: MeshFacts): string {
  const m = material as THREE.MeshStandardMaterial;
  const side = m.side === THREE.DoubleSide ? 'double' : m.side === THREE.BackSide ? 'back' : 'front';
  return [
    m.type,
    f.skinned ? 'skin' : 'rigid',
    `m${f.morphs}${f.morphNormals ? 'n' : ''}${f.morphColors ? 'c' : ''}`,
    f.normals ? '' : 'nonormal',
    f.tangents ? 'tangent' : '',
    side,
    m.alphaTest > 0 ? 'cut' : 'opaque',
    m.transparent ? 'blend' : '',
    m.vertexColors ? 'vc' : '',
    `map${slot(m.map)}nor${slot(m.normalMap)}rou${slot(m.roughnessMap)}met${slot(m.metalnessMap)}emi${slot(m.emissiveMap)}ao${slot(m.aoMap)}alp${slot(m.alphaMap)}bum${slot(m.bumpMap)}lig${slot(m.lightMap)}dis${slot(m.displacementMap)}`,
    m.userData.swgSpec ? 'spec' : '',
    m.userData.swgDetail ? 'detail' : '',
    m.envMap ? 'env' : '',
  ].join(' ');
}

/**
 * Why a material on a mesh with these facts falls outside the product, in words; empty when it is inside. The product
 * is three's lit standard material with a colour map, a normal map, the roughness and metalness maps all on the first
 * coordinate set, the environment, the highlight, nothing else, opaque or cut and never blended, on a skinned mesh with
 * normals and no tangents whose morph count is a rung of the ladder (with normals on its morphs), or a rack weapon's
 * rigid mesh with no morphs; on any of the three sides.
 */
export function outsideWhy(material: THREE.Material, f: MeshFacts, kind: 'person' | 'rack', ladder: readonly number[] = warmLadder() ?? [0]): string[] {
  const m = material as THREE.MeshStandardMaterial;
  const why: string[] = [];
  if (!m.isMeshStandardMaterial || (m as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) return [(material as THREE.MeshBasicMaterial).isMeshBasicMaterial ? 'unlit' : `a ${m.type}`];
  if (m.transparent) why.push('blended');
  // An untextured material (a placeholder, nearly always a garment's skin shader where the body shows) carries no
  // highlight record either, since the converter writes one only on a textured material: it is said once, as what it is.
  if (!m.map) why.push('no colour map (untextured)');
  if (m.emissiveMap) why.push('a glow map');
  if (m.aoMap || m.alphaMap || m.bumpMap || m.lightMap || m.displacementMap) why.push('a map of another kind');
  if ((m.map && m.map.channel) || (m.normalMap && m.normalMap.channel) || (m.roughnessMap && m.roughnessMap.channel) || (m.metalnessMap && m.metalnessMap.channel)) why.push('a map on a second coordinate set');
  if (!m.normalMap || !m.roughnessMap || !m.metalnessMap) why.push('not normalised');
  if (MODEL_REFLECTIONS_AT_LOAD && !m.envMap) why.push('no environment');
  if (m.vertexColors) why.push('vertex colours');
  if (m.map && !m.userData.swgSpec) why.push('no highlight record (a pack from before format 6)');
  if (m.userData.swgDetail) why.push('a detail map');
  if (m.userData.unlit === true) why.push('unlit');
  if (!f.normals) why.push('no normals');
  if (f.tangents) why.push('tangents');
  if (f.morphColors) why.push('colour morphs');
  if (kind === 'rack') {
    if (f.skinned) why.push('a skinned weapon');
    if (f.morphs) why.push('a morphing weapon');
  } else {
    if (!f.skinned) why.push('not skinned');
    if (!ladder.includes(f.morphs)) why.push(`${f.morphs} morphs, no rung of the ladder`);
    else if (f.morphs > 0 && !f.morphNormals) why.push('morphs without normals');
  }
  return why;
}

/**
 * Give a skinned material, or a rack weapon's, what it lacks of the superset (see the file's head): at the world's first
 * sight of it, before the cascades and every wrap, since the maps and the environment are in its program key. Adds only
 * what is missing and is idempotent; a material three's lit standard kind is not (an unlit droid, a hologram's) is
 * counted and left alone. A copy of a normalised material carries its maps and its marks, and is registered with the
 * environment at nought in its own right as it is adopted. Answers whether anything was given now.
 */
export function normalisePerson(material: THREE.Material, owner?: THREE.Object3D | null): boolean {
  if (!PERSON_KEYS_TUNE.on) return false;
  const m = material as THREE.MeshStandardMaterial;
  const ours = m.userData.swgStandIn === true;
  const facts = factsOf(owner);
  const kind: 'person' | 'rack' = m.userData.swgRack === true && !facts.skinned ? 'rack' : 'person';
  const before = met.has(material) || ours ? '' : shapeKey(material, facts);
  if (!m.isMeshStandardMaterial || m.userData.unlit === true) {
    if (!ours && !met.has(material)) {
      PERSON_KEYS_STATS.refused++;
      met.set(material, { kind, facts, before, after: before });
      material.addEventListener('dispose', forgetOnDispose);
    }
    return false;
  }
  const g = given.get(m) ?? { normal: false, roughness: false, metalness: false, env: false };
  let any = false;
  if (!m.normalMap) {
    m.normalMap = flatNormalMap();
    m.userData.flatNormal = true;
    g.normal = true;
    any = true;
    if (!ours) PERSON_KEYS_STATS.normals++;
  }
  if (!m.roughnessMap || !m.metalnessMap) {
    if (!m.roughnessMap) {
      m.roughnessMap = whiteMap();
      g.roughness = true;
    }
    if (!m.metalnessMap) {
      m.metalnessMap = whiteMap();
      g.metalness = true;
    }
    any = true;
    if (!ours) PERSON_KEYS_STATS.masks++;
  }
  // The environment at nought, for a material the registry does not hold (a cube's joined as a model's already, from
  // `joinModelReflections`) and that carries none of its own; only while the models join the registry at all, or the
  // cube's would have none and the plain one would.
  if (MODEL_REFLECTIONS_AT_LOAD && !m.envMap && !isRegisteredReflective(m)) {
    m.userData.swgPersonEnv = true;
    m.userData.swgEnvBase = 0;
    registerReflective(m);
    g.env = true;
    any = true;
    if (!ours) PERSON_KEYS_STATS.envs++;
  } else if (m.userData.swgPersonEnv === true && !isRegisteredReflective(m)) {
    // A copy of one this normalised (a ship's paint, a ghost): its maps came with it, and its environment is joined here.
    registerReflective(m);
    g.env = true;
  }
  // What the slots hold of ours, whoever put it there (a copy carries its original's), so taking the superset off
  // takes off all of it.
  if (m.normalMap === flatNormal) g.normal = true;
  if (m.roughnessMap === whiteTexel) g.roughness = true;
  if (m.metalnessMap === whiteTexel) g.metalness = true;
  given.set(m, g);
  if (!ours && !met.has(material)) {
    met.set(material, { kind, facts, before, after: shapeKey(material, facts) });
    material.addEventListener('dispose', forgetOnDispose);
    PERSON_KEYS_STATS.normalised++;
    if (kind === 'rack') PERSON_KEYS_STATS.rack++;
  }
  if (any) m.needsUpdate = true;
  return any;
}

function forgetOnDispose(this: THREE.Material): void {
  met.delete(this);
  this.removeEventListener('dispose', forgetOnDispose);
}

/** Every skinned and rack material met this session, with what is known of it, for the console and the in-play count. */
export function forEachPersonMaterial(fn: (material: THREE.Material, kind: 'person' | 'rack', facts: MeshFacts, before: string, after: string) => void): void {
  for (const [m, r] of met) fn(m, r.kind, r.facts, r.before, r.after);
}

/** What normalisation gave a material, or null where it gave nothing (for the self test and the tests). */
export function givenTo(material: THREE.Material): Readonly<Given> | null {
  return given.get(material) ?? null;
}

/**
 * Take off what normalisation gave a material (`on` false) or put it back (`on` true), for the pixel test and the
 * comparing switch only: three works the material's program out again at its next draw, which builds the other
 * shape's program on that frame. A slot something else has filled since (a recipe's own normal map) is left alone.
 * Answers whether anything changed.
 */
export function setGiven(material: THREE.Material, on: boolean): boolean {
  const g = given.get(material);
  if (!g) return false;
  const m = material as THREE.MeshStandardMaterial;
  let changed = false;
  if (g.normal) {
    if (!on && m.normalMap === flatNormal) {
      m.normalMap = null;
      changed = true;
    } else if (on && !m.normalMap) {
      m.normalMap = flatNormalMap();
      changed = true;
    }
  }
  if (g.roughness) {
    if (!on && m.roughnessMap === whiteTexel) {
      m.roughnessMap = null;
      changed = true;
    } else if (on && !m.roughnessMap) {
      m.roughnessMap = whiteMap();
      changed = true;
    }
  }
  if (g.metalness) {
    if (!on && m.metalnessMap === whiteTexel) {
      m.metalnessMap = null;
      changed = true;
    } else if (on && !m.metalnessMap) {
      m.metalnessMap = whiteMap();
      changed = true;
    }
  }
  if (g.env) {
    if (!on && isRegisteredReflective(m)) {
      unregisterReflective(m);
      m.envMap = null;
      changed = true;
    } else if (on && !isRegisteredReflective(m)) {
      registerReflective(m);
      changed = true;
    }
  }
  if (changed) m.needsUpdate = true;
  return changed;
}

/** Whether the comparing switch has taken the superset off every material it gave it to (`__debug.perf({ ab: { key: 'personKeys' } })`). */
export const PERSON_KEYS_LIVE = { on: PERSON_KEYS_TUNE.on };

/** The comparing switch: the superset off or back on every material met this session. Answers how many changed. */
export function setPersonKeysLive(on: boolean): number {
  if (!PERSON_KEYS_TUNE.on) return 0;
  PERSON_KEYS_LIVE.on = on;
  let n = 0;
  for (const m of met.keys()) if (setGiven(m, on)) n++;
  return n;
}

// ---------------------------------------------------------------------------------------------------------------------
// The product, and its stand-ins.

/** One shape of the product: whose (a person's skinned material or a rack weapon's rigid one), the rung, the side and the cut. */
export interface PersonShape {
  kind: 'person' | 'rack';
  rung: number;
  side: 'front' | 'back' | 'double';
  cut: boolean;
}

const SIDES: readonly PersonShape['side'][] = ['front', 'back', 'double'];

/**
 * The closed set of shapes the normalised materials fall in, ours: for a person every rung of the ladder (just nought
 * with the ladder's hatch off) by the three sides by opaque or cut, 18; for a rack weapon, rigid and with no morphs, the
 * three sides by opaque or cut, 6. Every map, the environment and the highlight are the same in each.
 */
export function personShapes(ladder: readonly number[] | null = warmLadder()): PersonShape[] {
  const out: PersonShape[] = [];
  for (const rung of ladder ?? [0]) for (const side of SIDES) for (const cut of [false, true]) out.push({ kind: 'person', rung, side, cut });
  for (const side of SIDES) for (const cut of [false, true]) out.push({ kind: 'rack', rung: 0, side, cut });
  return out;
}

/** A shape's name, as the console lists it. */
export function shapeName(s: PersonShape): string {
  return `${s.kind} r${s.rung} ${s.side} ${s.cut ? 'cut' : 'opaque'}`;
}

let standIns: THREE.Mesh[] | null = null;

/**
 * One stand-in a shape of the product, made once a session and kept (never in the scene, never disposed): a person's a
 * one-triangle skinned mesh on a skeleton of one bone with the rung's morphs (positions and normals, as every converted
 * morph carries both), a rack weapon's a rigid triangle; each material three's lit standard kind with a colour map, the
 * shape's side and cut, a highlight record and no cube, marked as ours. Adopted by the world like any material
 * (`World.adoptMaterials`), so it is normalised, set up for the cascades and wrapped exactly as a person's is, and
 * compiled by every loading screen for both passes: its programs are the ones a person of that shape will ask for.
 */
export function signatureStandIns(): THREE.Mesh[] {
  if (standIns) return standIns;
  standIns = personShapes().map((s) => standIn(s));
  return standIns;
}

function standIn(s: PersonShape): THREE.Mesh {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  const mat = new THREE.MeshStandardMaterial({ map: whiteMap(), side: s.side === 'double' ? THREE.DoubleSide : s.side === 'back' ? THREE.BackSide : THREE.FrontSide, alphaTest: s.cut ? 0.5 : 0 });
  mat.name = `personKeys:${shapeName(s)}`;
  mat.userData.swgStandIn = true;
  mat.userData.swgSpec = { mode: 'phong', color: [0, 0, 0], power: 1 };
  mat.userData.swgCube = false;
  if (s.kind === 'rack') {
    mat.userData.swgRack = true;
    mat.userData.dry = true;
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = mat.name;
    return mesh;
  }
  g.setAttribute('skinIndex', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4));
  if (s.rung > 0) {
    const zeros = new Float32Array(9);
    g.morphAttributes.position = [];
    g.morphAttributes.normal = [];
    for (let i = 0; i < s.rung; i++) {
      g.morphAttributes.position.push(new THREE.BufferAttribute(zeros, 3));
      g.morphAttributes.normal.push(new THREE.BufferAttribute(zeros, 3));
    }
    g.morphTargetsRelative = true;
  }
  const mesh = new THREE.SkinnedMesh(g, mat);
  mesh.name = mat.name;
  const bone = new THREE.Bone();
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  return mesh;
}

// ---------------------------------------------------------------------------------------------------------------------
// The pixel test's own rules (`__debug.personKeys({ selfTest: true })`, which the game runs in `main.ts`).

/**
 * The bound the pixel test holds every look to, in sRGB levels over the figure: the largest channel difference between
 * the figure drawn normalised and drawn with the superset off, and the mean of each pixel's largest. The design's, not a
 * number of feel: the superset is meant to change nothing at all, and these leave room for nothing but rounding.
 */
export const PERSON_TEST_BOUND = Object.freeze({ max: 2, mean: 0.2 });

/** A catalogue entry as the test reads one: its id, kind, name, body and what it wears. */
export interface TestEntry {
  id: string;
  kind: string;
  name: string;
  species: string | null;
  outfit: readonly { item: string }[];
}

/** One test look: what it is called and how it is found in the catalogue (a dressed body's species, or a word in its id or name). */
export interface TestLook {
  label: string;
  species?: string;
  find?: string;
  kind?: string;
  /** Among several matches, one wearing something this matches goes first (a Jedi in a robe). */
  prefer?: RegExp;
}

/**
 * The looks the pixel test stands, ours: six species (the Trandoshan's and the Mon Calamari's eyes carry the converter's
 * blended eye films, which stay outside the product), an armoured Imperial, a robed Jedi, a Jawa, and a creature, since
 * every skinned material is normalised and a creature's are among them.
 */
export const PERSON_TEST_LOOKS: readonly TestLook[] = Object.freeze([
  { label: 'a human', species: 'human_male' },
  { label: 'a rodian', species: 'rodian_male' },
  { label: "a twi'lek", species: 'twilek_female' },
  { label: 'a trandoshan', species: 'trandoshan_male' },
  { label: 'a mon calamari', species: 'moncal_male' },
  { label: 'a wookiee', species: 'wookiee_male' },
  { label: 'an armoured Imperial', find: 'stormtrooper' },
  { label: 'a robed Jedi', find: 'jedi', prefer: /robe/ },
  { label: 'a jawa', find: 'jawa' },
  { label: 'a creature', find: 'bantha', kind: 'creature' },
]);

/**
 * Each test look's entry: the first by id that matches it and can be stood now (`standable`), one matching `prefer`
 * first; a look none matches says why. `asked` (ids or words from the console) replaces the list.
 */
export function pickTestLooks<E extends TestEntry>(entries: readonly E[], standable: (e: E) => boolean, asked?: readonly string[]): { label: string; entry: E | null; why: string }[] {
  const looks: readonly TestLook[] = asked?.length ? asked.map((a) => ({ label: a, find: a })) : PERSON_TEST_LOOKS;
  const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return looks.map((look) => {
    const word = look.find?.toLowerCase();
    const matches = sorted.filter((e) => {
      if (look.kind && e.kind !== look.kind) return false;
      if (look.species) return e.kind === 'dressed' && !!e.species && (e.species === look.species || e.species.endsWith(`/${look.species}`));
      return !!word && (e.id.toLowerCase().includes(word) || e.name.toLowerCase().includes(word));
    });
    const ok = matches.filter(standable);
    const best = (look.prefer ? ok.find((e) => e.outfit.some((p) => look.prefer!.test(p.item))) : undefined) ?? ok[0] ?? null;
    return { label: look.label, entry: best, why: best ? '' : matches.length ? `${matches.length} match, none can be stood now` : 'nothing in the catalogue matches' };
  });
}

/** What one pair of pictures differs by: the pixels compared, the largest channel difference and the mean of each pixel's largest. */
export interface PixelStats {
  pixels: number;
  max: number;
  mean: number;
}

/**
 * Two RGBA pictures of one size compared over the pixels `inMask` takes (handed each pixel's first byte's index): the
 * largest difference in any of the three colour channels, and the mean over those pixels of each one's largest.
 */
export function pixelDiff(a: ArrayLike<number>, b: ArrayLike<number>, inMask: (i: number) => boolean): PixelStats {
  let pixels = 0;
  let max = 0;
  let sum = 0;
  for (let i = 0; i + 3 < a.length; i += 4) {
    if (!inMask(i)) continue;
    const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
    pixels++;
    sum += d;
    if (d > max) max = d;
  }
  return { pixels, max, mean: pixels ? Number((sum / pixels).toFixed(4)) : 0 };
}

/** A program as three's renderer keeps it on a material's record: its object, its id and its cache key. */
export interface ProgramLike {
  id: number;
  cacheKey: string;
}

/** The programs a material has been compiled for, as the world reads them off its renderer's records. */
export type ProgramsOf = (material: THREE.Material) => Iterable<ProgramLike> | null | undefined;

/** What the warms have done this session: the programs the stand-ins hold, the screens that warmed them, the milliseconds. */
export const PERSON_KEYS_WARM = {
  programs: new Set<ProgramLike>(),
  warms: 0,
  /** The first warm's milliseconds (the session's cold one) and the last's. */
  firstMs: 0,
  lastMs: 0,
  /** Programs the first warm built, and the last. */
  firstBuilt: 0,
  lastBuilt: 0,
};

/** After a warm: every program the stand-ins' materials hold is one a person of that shape will find built. */
export function noteWarmed(programsOf: ProgramsOf): number {
  const list = standIns;
  if (!list) return 0;
  for (const s of list) {
    const ps = programsOf(s.material as THREE.Material);
    if (ps) for (const p of ps) PERSON_KEYS_WARM.programs.add(p);
  }
  return PERSON_KEYS_WARM.programs.size;
}

/**
 * Whether every material under these meshes has been compiled only for warmed programs (at least one each): what sends
 * a body's rooms pass to the urgent rank once its world pass is built (`urgentRooms`), since a shape the warm compiled
 * for the world's lights it also compiled for the rooms'. Read off the renderer's own records, never the shapes'
 * reading, so nothing is taken as warm that three would not find.
 */
export function allWarmed(meshes: readonly THREE.Object3D[], programsOf: ProgramsOf): boolean {
  if (!PERSON_KEYS_TUNE.on || PERSON_KEYS_WARM.programs.size === 0) return false;
  let any = false;
  for (const o of meshes) {
    const mat = (o as THREE.Mesh).material;
    if (!mat) continue;
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      const ps = programsOf(m);
      if (!ps) return false;
      let one = false;
      for (const p of ps) {
        if (!PERSON_KEYS_WARM.programs.has(p)) return false;
        one = true;
      }
      if (!one) return false;
      any = true;
    }
  }
  return any;
}
