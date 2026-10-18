// Pods put together from parts: one skinned pod's cockpit on another's engines, built at spawn from the two converted
// pods, with no conversion and nothing owned (a hybrid is a choice in the garage).
//
// Every skinned pod the gallery converts stands on one skeleton (root > lft_engine > lft_leg > left_foot > body, and the
// right side's engine, leg and foot), the same to the bit, and nearly every triangle of each pod belongs wholly to its
// cockpit (every corner weighted heaviest to `body`) or wholly to its engines. So a hybrid is the cockpit pod's model
// keeping only its cockpit triangles, with the engine pod's skinned meshes keeping only their engine triangles (the few
// with corners on both sides go with the engines: they are where the control cables meet the cockpit) re-pointed to the
// cockpit pod's skeleton by joint name. The engine pod's points that hang off its engines (every point whose nearest
// joint is not `body`: the engine, beam, damage and ground effect points) are hung under the cockpit pod's joints of the
// same names, and the cockpit pod's own such points are taken off; the points on `body` (the pilot's `player`) stay. So
// the seat, the clips and the rider pose are the cockpit pod's, and the glows, the engine parts, the smoke and fire and
// the engine sound are the engine pod's.
//
// Nothing the garage's cached pods share is ever written: the cockpit pod is cloned with a skeleton of its own, the
// engine pod's meshes are new meshes over its cached materials, and a geometry that loses triangles (or has its joints
// re-pointed) is a new one holding only the vertices it uses, marked as the hybrid's own so it is disposed with it; a
// geometry that keeps every triangle is the cached one, still marked shared. The materials are the two pods' own, so a
// hybrid of two pods already drawn this session builds no program.
//
// No browser API and no value import but three and the vehicles' own pure modules, so the node test loads it.
import * as THREE from 'three';
import { POD_COCKPIT_JOINT, boneOver, isPod, type PodSeatCockpit } from './podSeat.ts';
import { frameExtents, hardpointName } from './shipAssembly.ts';

/** What stands between a hybrid's two garage ids in its own id: a character no garage id carries, and one the relay's id pattern passes. */
export const HYBRID_SEP = '.';

/** The longest vehicle id the relay passes on (`cleanVehicle` in server/vehicleWire.mjs; the node test holds the two equal). */
export const VEHICLE_ID_MOST = 48;

/** A hybrid's garage id: the cockpit pod's, then the engine pod's. */
export function hybridId(cockpit: string, engines: string): string {
  return `${cockpit}${HYBRID_SEP}${engines}`;
}

/** A hybrid's two halves from its id, or null for an id that is not a hybrid's. */
export function parseHybridId(id: string): { cockpit: string; engines: string } | null {
  const parts = id.split(HYBRID_SEP);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { cockpit: parts[0], engines: parts[1] };
}

/**
 * The id a ride goes out on the wire as: its own, which for a hybrid names both halves so the others build the same
 * pod; but a hybrid whose id would be longer than the relay passes goes out as its cockpit pod alone (drawn whole on
 * the others' screens) rather than be dropped by the relay altogether. The longest pair of the converted pods is 48
 * characters, exactly what the relay passes.
 */
export function wireVehicleId(def: { readonly id: string; readonly hybrid?: { readonly cockpit: string } | null }): string {
  return def.id.length <= VEHICLE_ID_MOST || !def.hybrid ? def.id : def.hybrid.cockpit;
}

/** What a garage def says of itself, as a hybrid reads it. */
export interface HalfDef {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly inferred: boolean;
  readonly source: string;
  readonly file: string;
  readonly template?: string;
  readonly model?: string;
  readonly bounds?: { min: number[]; max: number[] };
  readonly riderPose?: string | null;
  readonly clipSpeeds?: Record<string, number>;
  /** Whether the gallery converted it on a skeleton (its manifest entry's `skeletal`). */
  readonly skeletal?: boolean;
}

/** Whether a garage def may be either half of a hybrid: a gallery pod converted on a skeleton (the static FG 8T8 has no weights to split by). */
export function isHalf(def: HalfDef): boolean {
  return isPod(def) && def.source === 'gallery' && def.skeletal === true;
}

/** What a def says of the halves it is made of, as `pickHalves` reads it: nothing for a pod of its own. */
export interface PickableDef {
  readonly id: string;
  readonly hybrid?: { readonly cockpit: string; readonly engines: string } | null;
}

/**
 * The two pods a hybrid is asked to be made of, out of the skinned pods (`halves`, each a def of the garage's list), or
 * why not, in words. Every name is looked up again among the halves by its id, never taken as it is handed: a def handed
 * as the cockpit that is itself a hybrid is its own cockpit pod (a hybrid given new engines is its cockpit pod on them),
 * a hybrid's id named as the engines is its engine pod, and so nothing is ever a hybrid of a hybrid, whose cockpit no
 * garage could find when it came to be built. `engines` is a garage id, else (unless `exact`) the first skinned pod whose
 * id holds it; `known` says whether an id is a vehicle of the garage at all, which only chooses the words of a refusal.
 */
export function pickHalves<D extends PickableDef>(halves: readonly D[], known: (id: string) => boolean, cockpit: D | string, engines: string, exact = false): { cockpit: D; engines: D } | string {
  const list = halves.map((v) => v.id).join(', ') || 'none in this gallery';
  const wantC = typeof cockpit === 'string' ? (parseHybridId(cockpit)?.cockpit ?? cockpit) : (cockpit.hybrid?.cockpit ?? cockpit.id);
  const c = halves.find((v) => v.id === wantC);
  if (!c) return known(wantC) ? `the ${wantC} cannot be a hybrid's cockpit: only the skinned pods (${list}) can` : `no skinned pod ${wantC} to take a cockpit from`;
  const wantE = parseHybridId(engines)?.engines ?? engines;
  const n = wantE.toLowerCase();
  const e = halves.find((v) => v.id === wantE) ?? (exact ? undefined : (halves.find((v) => v.id.toLowerCase() === n) ?? halves.find((v) => v.id.toLowerCase().includes(n))));
  if (!e) return `${known(wantE) ? `the ${wantE} cannot be a hybrid's engines` : `no skinned pod ${wantE} to take engines from`}: only the skinned pods (${list}) can`;
  return { cockpit: c, engines: e };
}

/** A hybrid's own def's fields beyond a half's: which pods it is made of, and whose client data it sounds by. */
export interface HybridFields {
  hybrid: { cockpit: string; engines: string };
  soundFrom: { id: string; template?: string };
}

/**
 * A hybrid's def: a new object, the cockpit pod's (what it is, its file and template for anything keyed on them, its
 * rider pose and its clips' speeds, copied), with the two halves named and the engine pod's id and template to sound
 * by. Its race thrusters and bounds are its own, worked out when it is first built; nothing of either half's def is
 * shared but strings, so no spawn of it can write into a half's.
 */
export function hybridDefOf<D extends HalfDef>(cockpit: D, engines: D): D & HybridFields {
  const out: HalfDef & HybridFields = {
    id: hybridId(cockpit.id, engines.id),
    label: `${cockpit.label} on ${engines.label} engines`,
    kind: cockpit.kind,
    inferred: cockpit.inferred,
    source: cockpit.source,
    file: cockpit.file,
    template: cockpit.template,
    model: cockpit.model,
    riderPose: cockpit.riderPose ?? null,
    clipSpeeds: cockpit.clipSpeeds ? { ...cockpit.clipSpeeds } : undefined,
    skeletal: true,
    hybrid: { cockpit: cockpit.id, engines: engines.id },
    soundFrom: { id: engines.id, template: engines.template },
  };
  return out as unknown as D & HybridFields;
}

/** A half refused, in words: the console and the message line say it as it stands. */
export class PodHalfRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PodHalfRefused';
  }
}

/** The joint a vertex is weighted heaviest to, as an index into its own skeleton's bones (the first of a tie). */
export function heaviestJoint(skinIndex: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, skinWeight: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number): number {
  let best = -1;
  let joint = 0;
  for (let c = 0; c < skinIndex.itemSize; c++) {
    const w = skinWeight.getComponent(i, c);
    if (w > best) {
      best = w;
      joint = skinIndex.getComponent(i, c);
    }
  }
  return joint;
}

/** Each vertex of a skinned mesh: 1 where it is weighted heaviest to the cockpit's joint, else 0. */
export function cockpitVertices(mesh: THREE.SkinnedMesh, joint: string = POD_COCKPIT_JOINT): Uint8Array {
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const si = g.getAttribute('skinIndex');
  const sw = g.getAttribute('skinWeight');
  const out = new Uint8Array(pos ? pos.count : 0);
  if (!pos || !si || !sw) return out;
  const bones = mesh.skeleton?.bones ?? [];
  for (let i = 0; i < out.length; i++) out[i] = bones[heaviestJoint(si, sw, i)]?.name === joint ? 1 : 0;
  return out;
}

/** How a geometry's triangles split: wholly the cockpit's, wholly the engines', and those with corners on both sides. */
export interface TriangleSplit {
  total: number;
  cockpit: number;
  engines: number;
  /** Triangles with corners on both sides (counted among the engines', which keep them). */
  straddle: number;
}

/** A geometry's triangles as corner triples, group by group (or the whole index), each handed to `visit`. */
function eachTriangle(g: THREE.BufferGeometry, visit: (a: number, b: number, c: number, group: number) => void): void {
  const index = g.getIndex();
  const pos = g.getAttribute('position');
  const count = index ? index.count : pos ? pos.count : 0;
  const groups = g.groups.length ? g.groups : [{ start: 0, count, materialIndex: 0 }];
  groups.forEach((gr, k) => {
    const end = Math.min(count, gr.start + gr.count);
    for (let i = gr.start; i + 2 < end; i += 3) {
      if (index) visit(index.getX(i), index.getX(i + 1), index.getX(i + 2), k);
      else visit(i, i + 1, i + 2, k);
    }
  });
}

/** How a geometry's triangles split by which of their corners are the cockpit's. */
export function splitTriangles(g: THREE.BufferGeometry, cockpit: Uint8Array): TriangleSplit {
  const s: TriangleSplit = { total: 0, cockpit: 0, engines: 0, straddle: 0 };
  eachTriangle(g, (a, b, c) => {
    s.total++;
    const n = cockpit[a] + cockpit[b] + cockpit[c];
    if (n === 3) s.cockpit++;
    else {
      s.engines++;
      if (n > 0) s.straddle++;
    }
  });
  return s;
}

/** The constructor of a typed array, as an attribute's array names it. */
type ArrayMaker = new (n: number) => THREE.TypedArray;

/** One attribute holding only the vertices `order` names (old index by new), its own array of the same kind. */
function keptAttribute(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, order: Int32Array, n: number): THREE.BufferAttribute {
  const size = a.itemSize;
  const inter = (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute === true;
  const src = inter ? (a as THREE.InterleavedBufferAttribute).data.array : a.array;
  const stride = inter ? (a as THREE.InterleavedBufferAttribute).data.stride : size;
  const offset = inter ? (a as THREE.InterleavedBufferAttribute).offset : 0;
  const arr = new (src.constructor as ArrayMaker)(n * size);
  for (let k = 0; k < n; k++) {
    const from = order[k] * stride + offset;
    for (let c = 0; c < size; c++) arr[k * size + c] = src[from + c];
  }
  const out = new THREE.BufferAttribute(arr, size, a.normalized);
  out.name = a.name;
  if (!inter) {
    const b = a as THREE.BufferAttribute;
    out.usage = b.usage;
    out.gpuType = b.gpuType;
  }
  return out;
}

/**
 * A geometry with only the triangles `keep` takes, as a new geometry holding only the vertices they use (every
 * attribute and morph attribute, its groups kept in order), marked as a hybrid's own (`userData.podHybrid`); the
 * geometry itself when every triangle is kept and `copy` is not asked for; null when none is. Spawn-time work.
 */
export function keepTriangles(g: THREE.BufferGeometry, keep: (a: number, b: number, c: number) => boolean, copy = false): { geometry: THREE.BufferGeometry | null; kept: number; total: number } {
  const corners: number[] = [];
  const groups: { start: number; count: number; materialIndex: number }[] = [];
  let total = 0;
  let group = -1;
  eachTriangle(g, (a, b, c, k) => {
    total++;
    if (k !== group) {
      group = k;
      groups.push({ start: corners.length, count: 0, materialIndex: g.groups[k]?.materialIndex ?? 0 });
    }
    if (!keep(a, b, c)) return;
    corners.push(a, b, c);
    groups[groups.length - 1].count += 3;
  });
  const kept = corners.length / 3;
  if (kept === 0) return { geometry: null, kept, total };
  if (kept === total && !copy) return { geometry: g, kept, total };
  const pos = g.getAttribute('position');
  const map = new Int32Array(pos.count).fill(-1);
  const order = new Int32Array(pos.count);
  let n = 0;
  for (const v of corners) {
    if (map[v] < 0) {
      map[v] = n;
      order[n++] = v;
    }
  }
  const out = new THREE.BufferGeometry();
  out.name = g.name;
  for (const [name, a] of Object.entries(g.attributes)) out.setAttribute(name, keptAttribute(a, order, n));
  const morphs = out.morphAttributes as Record<string, (THREE.BufferAttribute | THREE.InterleavedBufferAttribute)[]>;
  for (const [name, list] of Object.entries(g.morphAttributes)) if (list) morphs[name] = list.map((a) => keptAttribute(a, order, n));
  out.morphTargetsRelative = g.morphTargetsRelative;
  const index = n > 65535 ? new Uint32Array(corners.length) : new Uint16Array(corners.length);
  for (let i = 0; i < corners.length; i++) index[i] = map[corners[i]];
  out.setIndex(new THREE.BufferAttribute(index, 1));
  if (g.groups.length) for (const gr of groups) if (gr.count) out.addGroup(gr.start, gr.count, gr.materialIndex);
  out.userData = JSON.parse(JSON.stringify(g.userData ?? {})) as Record<string, unknown>;
  out.userData.podHybrid = true;
  return { geometry: out, kept, total };
}

/**
 * A geometry's joint indices re-pointed from its own skeleton's order (`own`) to `target`'s, by joint name, in place: for
 * a geometry the hybrid owns, never a cached one. A joint the target lacks refuses the half (rather than riding the
 * root, as a worn piece's does): an engine on the wrong joint is a pod in pieces.
 */
export function repointJoints(g: THREE.BufferGeometry, own: readonly THREE.Bone[], target: readonly THREE.Bone[], what: string): void {
  const index = new Map(target.map((b, i) => [b.name, i]));
  const map = own.map((b) => index.get(b.name) ?? -1);
  const missing = own.filter((_, i) => map[i] < 0).map((b) => b.name);
  if (missing.length) throw new PodHalfRefused(`${what}: its joint${missing.length > 1 ? 's' : ''} ${missing.join(', ')} ${missing.length > 1 ? 'are' : 'is'} not on the cockpit's skeleton`);
  const a = g.getAttribute('skinIndex') as THREE.BufferAttribute | undefined;
  if (!a) return;
  const arr = a.array;
  for (let i = 0; i < arr.length; i++) {
    const to = map[arr[i]];
    if (to === undefined) throw new PodHalfRefused(`${what}: a vertex names joint ${arr[i]}, which its skeleton does not have`);
    arr[i] = to;
  }
  a.needsUpdate = true;
}

/** Whether a joint-to-joint map is the identity (each joint the same index in both skeletons). */
function sameOrder(own: readonly THREE.Bone[], target: readonly THREE.Bone[]): boolean {
  return own.length === target.length && own.every((b, i) => b.name === target[i].name);
}

/** The bones of a skeleton by name. */
function namesOf(bones: readonly THREE.Bone[]): string {
  return bones
    .map((b) => b.name)
    .sort()
    .join(',');
}

/** The skinned meshes under a node, in traverse order. */
function skinnedUnder(root: THREE.Object3D): THREE.SkinnedMesh[] {
  const out: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) out.push(o as THREE.SkinnedMesh);
  });
  return out;
}

/** The hardpoint nodes under a node whose nearest joint is not the cockpit's (the engines' points). */
function enginePointsUnder(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (hardpointName(o) === null) return;
    const bone = boneOver(o.parent);
    if (bone?.name !== POD_COCKPIT_JOINT) out.push(o);
  });
  return out;
}

/** A node's place relative to the nearest bone above it, from the local turns and places between (the cached model's matrices are never trusted to be current). */
function relativeToBone(node: THREE.Object3D, bone: THREE.Bone): THREE.Matrix4 {
  const m = new THREE.Matrix4().compose(node.position, node.quaternion, node.scale);
  const step = new THREE.Matrix4();
  for (let o = node.parent; o && o !== bone; o = o.parent) m.premultiply(step.compose(o.position, o.quaternion, o.scale));
  return m;
}

/** A clone of a skinned model with a skeleton of its own (three's SkeletonUtils, inlined for the garage's uses): it shares the geometry and materials. */
export function cloneSkinned(source: THREE.Object3D): THREE.Group {
  const sourceLookup = new Map<THREE.Object3D, THREE.Object3D>();
  const cloneLookup = new Map<THREE.Object3D, THREE.Object3D>();
  const clone = source.clone() as THREE.Group;
  const pair = (a: THREE.Object3D, b: THREE.Object3D) => {
    sourceLookup.set(b, a);
    cloneLookup.set(a, b);
    for (let i = 0; i < a.children.length; i++) pair(a.children[i], b.children[i]);
  };
  pair(source, clone);
  clone.traverse((node) => {
    const sm = node as THREE.SkinnedMesh;
    if (!sm.isSkinnedMesh) return;
    const sourceMesh = sourceLookup.get(node) as THREE.SkinnedMesh;
    const sourceBones = sourceMesh.skeleton.bones;
    sm.skeleton = sourceMesh.skeleton.clone();
    sm.bindMatrix.copy(sourceMesh.bindMatrix);
    sm.skeleton.bones = sourceBones.map((b) => (cloneLookup.get(b) as THREE.Bone) ?? b);
    sm.bind(sm.skeleton, sm.bindMatrix);
  });
  return clone;
}

/** How far two rest poses may differ, per matrix element, and still be one skeleton (the converted pods differ by nought). */
const REST_TOLERANCE = 1e-3;

/** What a hybrid's build kept, for the spawn's line and the console. */
export interface HybridReport {
  cockpit: { id: string } & TriangleSplit & { kept: number };
  engines: { id: string } & TriangleSplit & { kept: number };
  /** The cockpit pod's points taken off (its engines'), and the engine pod's hung on the cockpit's joints, by name. */
  pointsOff: string[];
  pointsOn: string[];
  /** Geometries the hybrid made of its own (disposed with it), and cached ones it wears as they are. */
  own: number;
  shared: number;
}

/** What a hybrid's build hands back: the model, built afresh; and what it kept. */
export interface HybridBuild {
  model: THREE.Group;
  report: HybridReport;
}

/** A converted pod as the garage loaded it once for the session: never written. */
export interface LoadedPod {
  readonly scene: THREE.Object3D;
}

/**
 * Put a hybrid together from two pods as the garage loaded them, synchronously and without writing either: the cockpit
 * pod cloned with a skeleton of its own keeping only its cockpit triangles and its own points on `body`, and the engine
 * pod's skinned meshes keeping only their engine triangles, re-pointed to the clone's skeleton by joint name and bound
 * to it, with the engine pod's points that hang off its engines hung on the clone's joints of the same names. A pod
 * whose joints are not the cockpit pod's, by name and at rest, is refused in words (`PodHalfRefused`).
 *
 * The model carries, in `userData.cockpitAlone`, where the garage would have stood the cockpit pod's model had it been
 * framed alone (its box at rest, measured before anything was taken off), which a seat row the owner set in that pod's
 * own frame is shifted by (`seatPod`'s `cockpit`).
 */
export function buildHybrid(cockpit: LoadedPod, engines: LoadedPod, ids: { cockpit: string; engines: string }): HybridBuild {
  const model = cloneSkinned(cockpit.scene);
  const baseMeshes = skinnedUnder(model);
  if (!baseMeshes.length) throw new PodHalfRefused(`the ${ids.cockpit} cannot be a hybrid's cockpit: it has no skinned mesh`);
  const skeleton = baseMeshes[0].skeleton;
  const baseNames = namesOf(skeleton.bones);
  if (!skeleton.bones.some((b) => b.name === POD_COCKPIT_JOINT)) throw new PodHalfRefused(`the ${ids.cockpit} cannot be a hybrid's cockpit: its skeleton has no ${POD_COCKPIT_JOINT} joint`);
  const engineMeshes = skinnedUnder(engines.scene);
  if (!engineMeshes.length) throw new PodHalfRefused(`the ${ids.engines} cannot be a hybrid's engines: it has no skinned mesh`);
  // One skeleton, by name and at rest, or no hybrid.
  for (const m of baseMeshes) if (namesOf(m.skeleton.bones) !== baseNames) throw new PodHalfRefused(`the ${ids.cockpit} cannot be a hybrid's cockpit: its own meshes stand on skeletons with different joints`);
  for (const m of engineMeshes) {
    const names = namesOf(m.skeleton.bones);
    if (names !== baseNames) throw new PodHalfRefused(`the ${ids.engines} cannot be the ${ids.cockpit}'s engines: their skeletons' joints are not the same (${names} against ${baseNames})`);
  }
  const byName = new Map(skeleton.bones.map((b, i) => [b.name, i]));
  for (const m of engineMeshes) {
    m.skeleton.bones.forEach((b, i) => {
      const a = m.skeleton.boneInverses[i].elements;
      const t = skeleton.boneInverses[byName.get(b.name)!].elements;
      for (let k = 0; k < 16; k++) if (Math.abs(a[k] - t[k]) > REST_TOLERANCE) throw new PodHalfRefused(`the ${ids.engines} cannot be the ${ids.cockpit}'s engines: its ${b.name} joint rests where the cockpit's does not`);
    });
  }
  // Where the cockpit pod alone would stand its model, before anything is taken off: framed on its own box at rest.
  model.updateMatrixWorld(true);
  const alone = frameExtents(model, () => true);
  model.userData.cockpitAlone = alone ? [-alone.cx, -alone.minY, -alone.cz] : [0, 0, 0];
  const report: HybridReport = {
    cockpit: { id: ids.cockpit, total: 0, cockpit: 0, engines: 0, straddle: 0, kept: 0 },
    engines: { id: ids.engines, total: 0, cockpit: 0, engines: 0, straddle: 0, kept: 0 },
    pointsOff: [],
    pointsOn: [],
    own: 0,
    shared: 0,
  };
  const add = (to: TriangleSplit, s: TriangleSplit) => {
    to.total += s.total;
    to.cockpit += s.cockpit;
    to.engines += s.engines;
    to.straddle += s.straddle;
  };
  // The cockpit pod: only its cockpit triangles; a mesh left with none goes.
  for (const m of baseMeshes) {
    const ck = cockpitVertices(m);
    add(report.cockpit, splitTriangles(m.geometry, ck));
    const r = keepTriangles(m.geometry, (a, b, c) => ck[a] + ck[b] + ck[c] === 3);
    report.cockpit.kept += r.kept;
    if (!r.geometry) {
      m.removeFromParent();
      continue;
    }
    if (r.geometry !== m.geometry) {
      m.geometry = r.geometry;
      // Measured over the whole pod just above: worked out again from what it keeps.
      m.computeBoundingBox();
      m.computeBoundingSphere();
      m.userData.shared = false;
      report.own++;
    } else {
      // The cached geometry, worn as it is: said shared here whatever the cache said, so no dispose ever reaches it.
      m.userData.shared = true;
      report.shared++;
    }
  }
  // Its points off its engines go: those engines are not drawn.
  for (const p of enginePointsUnder(model)) {
    report.pointsOff.push(hardpointName(p)!);
    p.removeFromParent();
  }
  // The engine pod's meshes: only their engine triangles, on the clone's skeleton.
  const engineGroup = new THREE.Group();
  engineGroup.name = `engines:${ids.engines}`;
  for (const src of engineMeshes) {
    const ck = cockpitVertices(src);
    add(report.engines, splitTriangles(src.geometry, ck));
    const repoint = !sameOrder(src.skeleton.bones, skeleton.bones);
    const r = keepTriangles(src.geometry, (a, b, c) => ck[a] + ck[b] + ck[c] < 3, repoint);
    report.engines.kept += r.kept;
    if (!r.geometry) continue;
    const ownGeometry = r.geometry !== src.geometry;
    if (repoint) repointJoints(r.geometry, src.skeleton.bones, skeleton.bones, `the ${ids.engines}'s ${src.name || 'mesh'}`);
    const mesh = new THREE.SkinnedMesh(r.geometry, src.material);
    mesh.name = src.name;
    mesh.userData = JSON.parse(JSON.stringify(src.userData ?? {})) as Record<string, unknown>;
    mesh.userData.shared = !ownGeometry;
    mesh.castShadow = src.castShadow;
    mesh.receiveShadow = src.receiveShadow;
    mesh.frustumCulled = src.frustumCulled;
    mesh.visible = src.visible;
    mesh.renderOrder = src.renderOrder;
    mesh.layers.mask = src.layers.mask;
    mesh.bindMode = src.bindMode;
    engineGroup.add(mesh);
    mesh.bind(skeleton, src.bindMatrix);
    if (ownGeometry) report.own++;
    else report.shared++;
  }
  if (engineGroup.children.length) model.add(engineGroup);
  // The engine pod's points off its engines, on the clone's joints of the same names, where they stood on its own.
  const bones = new Map<string, THREE.Bone>();
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone && !bones.has(o.name)) bones.set(o.name, o as THREE.Bone);
  });
  for (const p of enginePointsUnder(engines.scene)) {
    const bone = boneOver(p.parent);
    const name = hardpointName(p)!;
    const onto = bone ? bones.get(bone.name) : undefined;
    if (!bone || !onto) throw new PodHalfRefused(`the ${ids.engines} cannot be the ${ids.cockpit}'s engines: its ${name} point hangs off a joint the cockpit's skeleton has not got`);
    const copy = p.clone(true);
    relativeToBone(p, bone).decompose(copy.position, copy.quaternion, copy.scale);
    onto.add(copy);
    report.pointsOn.push(name);
  }
  model.updateMatrixWorld(true);
  return { model, report };
}

/**
 * The clip a hybrid is framed in: its cockpit pod's idle (the pose it is drawn in whenever it stands still, as `podGait`
 * picks it), or null for a cockpit pod with no clips, which is framed at rest as every pod is.
 *
 * Why a hybrid is not framed at rest: the engines ride the cockpit pod's clips, which were made for that pod's own
 * engines, and another pod's engines at rest can stand metres above where those clips carry its cockpit. Framed at rest
 * (measured, Gasgano's cockpit on Anakin's engines), the idle stood the cockpit 2.1 m under the hull's underside, which
 * is under the ground; framed in the idle, nothing any clip of the converted pods poses stands under it (the run's first
 * frame stands higher than the idle's on every pair).
 */
export function framingClip(clips: readonly THREE.AnimationClip[]): THREE.AnimationClip | null {
  return clips.find((c) => c.name === 'idle') ?? clips.find((c) => c.name === 'loop_stand:speed0') ?? null;
}

/**
 * A model's framing box (`frameExtents`) as `clip`'s first frame poses it, the skeleton put back at rest after: a mixer of
 * its own posed once and stopped, which hands every joint back the value it had. With no clip, at rest. Spawn-time work.
 */
export function posedExtents(model: THREE.Object3D, clip: THREE.AnimationClip | null, include: (o: THREE.Object3D) => boolean = () => true): ReturnType<typeof frameExtents> {
  if (!clip) return frameExtents(model, include);
  const mixer = new THREE.AnimationMixer(model);
  mixer.clipAction(clip).play();
  mixer.update(0);
  model.updateMatrixWorld(true);
  const f = frameExtents(model, include);
  mixer.stopAllAction();
  mixer.uncacheRoot(model);
  model.updateMatrixWorld(true);
  return f;
}

/**
 * The box the garage frames a vehicle's model on (`Garage.frameModel`): a pod put together from parts as its cockpit pod's
 * idle poses it (`framingClip`, `posedExtents`), everything else at rest, as it always was. Spawn-time work.
 */
export function framedExtents(def: { readonly hybrid?: unknown }, model: THREE.Object3D, clips: readonly THREE.AnimationClip[], include: (o: THREE.Object3D) => boolean = () => true): ReturnType<typeof frameExtents> {
  return def.hybrid ? posedExtents(model, framingClip(clips), include) : frameExtents(model, include);
}

/**
 * How a pod put together from parts seats its pilot by its cockpit pod's rules: that pod's id, and how far this hybrid's
 * framing stands the cockpit from where that pod framed alone stood it (the model's own place, framed, less
 * `buildHybrid`'s `cockpitAlone`), which an owner's seat row written in that pod's own frame is moved by (`podSeatRule`).
 * Null for any other pod, and for a model `buildHybrid` did not make.
 */
export function hybridSeatCockpit(def: { readonly hybrid?: { readonly cockpit: string } | null }, model: THREE.Object3D): PodSeatCockpit | null {
  const alone = model.userData.cockpitAlone as [number, number, number] | undefined;
  if (!def.hybrid || !alone) return null;
  return { id: def.hybrid.cockpit, shift: [model.position.x - alone[0], model.position.y - alone[1], model.position.z - alone[2]] };
}

/**
 * Dispose every geometry under a node that a hybrid made of its own (`userData.podHybrid`), and none other: for a
 * picture or a spawn thrown away before it became a vehicle (a vehicle disposes its own, which are not marked shared).
 */
export function disposePodHybrid(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry?.userData?.podHybrid === true) {
      m.geometry.dispose();
      n++;
    }
  });
  return n;
}
