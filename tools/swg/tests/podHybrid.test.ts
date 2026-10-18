// Pods put together from parts (src/vehicles/podHybrid.ts, Racer wave 4b): one skinned pod's cockpit on another's
// engines, built at spawn. What is held here: the split of each pod's triangles by the joint their corners are weighted
// heaviest to (on a made-up pod always, and on the converted pods when the packs are here); the engine pod's meshes
// re-pointed to the cockpit pod's skeleton by joint name, every joint index naming a joint of the cockpit's skeleton,
// and the posed engine standing exactly where the engine pod's own posed engine does; a pod on another skeleton refused
// in words; the points (the cockpit's player point stays, the engine pod's engine, beam and damage points hung on the
// cockpit's joints of the same names, the cockpit pod's own engine points taken off); the cockpit pod's meshes keeping
// its cockpit and none of its engines (a mesh wholly engines gone); the seat by the cockpit pod's rule, its owner's row
// moved by the framing, through the very framing and seat functions the garage calls; the hybrid's def a new object that
// writes into neither pod's, and the two pods a hybrid is made of never a hybrid; the id that names both halves through
// the relay's own `cleanVehicle`, and an old-shape state still passing; disposing a hybrid leaving the two pods' cached
// models whole; and the hand-overs only the game makes, pinned as text. Plain node over three and the pure modules.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { HYBRID_SEP, PodHalfRefused, VEHICLE_ID_MOST, buildHybrid, cloneSkinned, cockpitVertices, disposePodHybrid, framedExtents, framingClip, hybridDefOf, hybridSeatCockpit, posedExtents, hybridId, isHalf, keepTriangles, parseHybridId, pickHalves, repointJoints, splitTriangles, wireVehicleId, type HalfDef, type HybridReport } from '../../../src/vehicles/podHybrid.ts';
import { POD_COCKPIT_JOINT, POD_SEAT, boneOver, isPod, podSeatRule, seatPod, type PodSeatRule, type Vec3 } from '../../../src/vehicles/podSeat.ts';
import { findHardpoint, frameExtents, hardpointName } from '../../../src/vehicles/shipAssembly.ts';
import { noteRaceThrusters, type EnginePoint } from '../../../src/vehicles/raceSpots.ts';
import { VEHICLE_KINDS } from '../../../src/vehicles/vehicleKinds.ts';
import { cleanVehicle } from '../../../server/vehicleWire.mjs';
import { loadSkinnedGlb, madeUpPod, type MadeUpTriangle } from './podFixtures.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const near = (a: number, b: number, e = 1e-5) => Math.abs(a - b) <= e;

/** A vehicle as the seat path reads one (a Vehicle satisfies it), standing in plain. */
interface Stand {
  readonly seat: THREE.Object3D;
  readonly group: THREE.Object3D;
  speed: number;
  onUpdate: ((dt: number, self: Stand, drive: null) => void) | null;
  seatBind: THREE.Matrix4 | null;
  seatPelvis: boolean;
  seatFollows: boolean;
  seatRule: PodSeatRule | null;
}
/** A def as the hybrid tests write one: a half's fields and what a spawn may write on it. */
type TestDef = HalfDef & { raceThrusters?: string[]; thrusters?: string[]; hybrid?: { cockpit: string; engines: string }; soundFrom?: { id: string; template?: string } };

// ---------------------------------------------------------------------------------------------
// A made-up pair: a cockpit pod and an engine pod on the pods' joint names, at places of ours.
const tri = (joints: [string, string, string], z: number, x = 0): MadeUpTriangle => ({ joints, corners: [[x, 1, z], [x + 1, 1, z], [x, 2, z + 0.5]] });
const C = POD_COCKPIT_JOINT;
const cockpitTris: MadeUpTriangle[] = [tri([C, C, C], -8), tri([C, C, C], -8.5, 1), tri([C, C, C], -9, 2), tri([C, C, C], -9.5, 3), tri(['lft_engine', 'lft_engine', 'lft_engine'], 2, 3), tri(['rght_engine', 'rght_engine', 'rght_engine'], 2, -3), tri([C, C, 'lft_leg'], -6, 1)];
const engineTris: MadeUpTriangle[] = [tri([C, C, C], -10), tri([C, C, C], -10.5, 1), tri(['lft_engine', 'lft_engine', 'lft_leg'], 3, 4), tri(['lft_leg', 'lft_leg', 'lft_leg'], 1, 4), tri(['rght_engine', 'rght_engine', 'rght_engine'], 3, -4), tri(['rght_leg', 'rght_engine', 'rght_leg'], 1, -4), tri(['lft_leg', C, C], -5, 2), tri([C, 'rght_leg', C], -5, -2)];
// The engine pod's skin lists its joints in another order than the cockpit's: a re-pointing has to survive it.
const SHUFFLED = ['body', 'rght_foot', 'root', 'lft_leg', 'rght_engine', 'left_foot', 'lft_engine', 'rght_leg'];
const madeCockpit = () =>
  madeUpPod({
    triangles: cockpitTris,
    meshes: 2,
    points: [
      { name: 'player', joint: C, at: [0.1, 0.05, -0.5] },
      { name: 'engine_sound_1', joint: C, at: [0.1, 0.4, 0.4] },
      { name: 'engine_1', joint: 'rght_leg', at: [0.2, -1, -4] },
      { name: 'engine_2', joint: 'lft_leg', at: [-0.2, -1, -4] },
    ],
  });
const madeEngines = () =>
  madeUpPod({
    order: SHUFFLED,
    triangles: engineTris,
    points: [
      { name: 'player', joint: C, at: [0.3, 0.3, -0.3] },
      { name: 'engine_1', joint: 'lft_engine', at: [0.5, -1.2, -3] },
      { name: 'engine_3', joint: 'rght_engine', at: [-0.5, -1.2, -3] },
      { name: 'beam_1', joint: 'lft_leg', at: [-1.5, -1, -1.5] },
      { name: 'damage_1', joint: 'rght_leg', at: [1, -1.5, -4], via: [0.25, 0.5, -0.75] },
    ],
  });
const IDS = { cockpit: 'made_up_cockpit', engines: 'made_up_engines' };

const skinnedOf = (root: THREE.Object3D) => {
  const out: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) out.push(o as THREE.SkinnedMesh);
  });
  return out;
};
const pointsOf = (root: THREE.Object3D) => {
  const out = new Map<string, THREE.Object3D[]>();
  root.traverse((o) => {
    const n = hardpointName(o);
    if (n !== null) (out.get(n) ?? out.set(n, []).get(n)!).push(o);
  });
  return out;
};
const worldOf = (o: THREE.Object3D) => {
  o.updateWorldMatrix(true, false);
  return o.getWorldPosition(new THREE.Vector3());
};

// ---------------------------------------------------------------------------------------------
// 1. The split, on the made-up pod: a triangle is the cockpit's when every corner is weighted heaviest to `body`, else
// the engines'; one with corners on both sides is counted apart and goes with the engines.
{
  const pod = madeCockpit();
  const meshes = skinnedOf(pod.scene);
  let total = 0;
  let cockpit = 0;
  let straddle = 0;
  for (const m of meshes) {
    const s = splitTriangles(m.geometry, cockpitVertices(m));
    total += s.total;
    cockpit += s.cockpit;
    straddle += s.straddle;
    ok(s.cockpit + s.engines === s.total, `${m.name}: every triangle is the cockpit's or the engines' (${s.cockpit} and ${s.engines} of ${s.total})`);
  }
  ok(total === 7 && cockpit === 4 && straddle === 1, `the made-up cockpit pod splits 4 cockpit triangles, 2 engine and 1 reaching across (${cockpit}, ${total - cockpit}, ${straddle})`);
  const e = madeEngines();
  const es = splitTriangles(skinnedOf(e.scene)[0].geometry, cockpitVertices(skinnedOf(e.scene)[0]));
  ok(es.cockpit === 2 && es.engines === 6 && es.straddle === 2, `on a skin listing its joints in another order the split reads each corner's own joint (${es.cockpit} cockpit, ${es.engines} engine, ${es.straddle} across)`);
  // The heaviest of several influences decides, the first of a tie.
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0], 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute([0.4, 0.6, 0, 0, 0.7, 0.3, 0, 0, 0.5, 0.5, 0, 0], 4));
  g.setIndex([0, 1, 2]);
  const a = new THREE.Bone();
  a.name = 'root';
  const b = new THREE.Bone();
  b.name = C;
  const sm = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial());
  sm.bind(new THREE.Skeleton([a, b]), new THREE.Matrix4());
  ok(Array.from(cockpitVertices(sm)).join() === '1,1,0', 'a vertex goes to the joint it is weighted heaviest to (0.6 on body, 0.7 on body, a tie going to the first listed)');
}

// ---------------------------------------------------------------------------------------------
// 2. Keeping triangles: a new geometry holding only the vertices the kept triangles use, every attribute (and every
// morph attribute) copied exactly; the geometry itself when nothing goes (and no copy is asked for); none when nothing
// stays.
{
  const pod = madeEngines();
  const m = skinnedOf(pod.scene)[0];
  // Every kind of attribute a converted pod's primitives carry (place, normal, picture coordinates, joints and weights),
  // and an interleaved one and a morph target besides, each with values of its own at every vertex.
  const n = m.geometry.getAttribute('position').count;
  m.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(Array.from({ length: n * 2 }, (_, i) => 0.5 + i * 0.125), 2));
  const woven = new THREE.InterleavedBuffer(Float32Array.from({ length: n * 5 }, (_, i) => i * 0.25 - 3), 5);
  m.geometry.setAttribute('color', new THREE.InterleavedBufferAttribute(woven, 3, 1));
  m.geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => (i % 7) * 0.5 - i * 0.01), 3)];
  m.geometry.morphAttributes.normal = [new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => (i % 5) * 0.2), 3)];
  const ck = cockpitVertices(m);
  const before = Array.from(m.geometry.getAttribute('position').array as Float32Array);
  const r = keepTriangles(m.geometry, (x, y, z) => ck[x] + ck[y] + ck[z] < 3);
  const g = r.geometry!;
  ok(g !== m.geometry && r.kept === 6 && r.total === 8, `the engines' triangles make a geometry of their own (${r.kept} of ${r.total})`);
  ok(g.getAttribute('position').count === 18 && g.getIndex()!.count === 18, 'holding only the vertices they use (18 of 24)');
  ok(Array.from(g.getIndex()!.array).every((i) => i < g.getAttribute('position').count), 'and every index names one of them');
  ok(g.userData.podHybrid === true && m.geometry.userData.podHybrid === undefined, "marked as a hybrid's own, the source not marked");
  ok(Array.from(m.geometry.getAttribute('position').array as Float32Array).join() === before.join(), 'and the source geometry is not touched');
  // Each kept triangle's corners carry, in every attribute and every morph attribute, component for component, what the
  // source's did, triangle by triangle in the order they came.
  const src = m.geometry;
  const want: number[] = [];
  for (let t = 0; t < src.getIndex()!.count; t += 3) {
    const v = [0, 1, 2].map((k) => src.getIndex()!.getX(t + k));
    if (ck[v[0]] + ck[v[1]] + ck[v[2]] < 3) want.push(...v);
  }
  const got = Array.from(g.getIndex()!.array);
  type Attr = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  const lists: [string, Attr, Attr | undefined][] = [
    ...Object.keys(src.attributes).map((k): [string, Attr, Attr | undefined] => [k, src.getAttribute(k), g.attributes[k] as Attr | undefined]),
    ...Object.entries(src.morphAttributes).flatMap(([k, list]) => list.map((a, j): [string, Attr, Attr | undefined] => [`morph ${k}[${j}]`, a, g.morphAttributes[k]?.[j]])),
  ];
  const off: string[] = [];
  for (const [name, a, b] of lists) {
    if (!b || b.itemSize !== a.itemSize || b.normalized !== a.normalized || b.array.constructor !== a.array.constructor) {
      off.push(`${name} (missing or of another kind)`);
      continue;
    }
    let bad = 0;
    for (let k = 0; k < want.length; k++) for (let c = 0; c < a.itemSize; c++) if (!Object.is(a.getComponent(want[k], c), b.getComponent(got[k], c))) bad++;
    if (bad) off.push(`${name} (${bad} components)`);
  }
  ok(lists.length === 8 && Object.keys(g.attributes).sort().join() === Object.keys(src.attributes).sort().join() && Object.keys(g.morphAttributes).sort().join() === Object.keys(src.morphAttributes).sort().join(), `the copy carries exactly the source's ${Object.keys(src.attributes).length} attributes and ${Object.keys(src.morphAttributes).length} morph attributes (${Object.keys(src.attributes).sort().join(', ')})`);
  ok(want.length === got.length && off.length === 0, `every kept corner carries, in every attribute and morph attribute, each component the source's did, triangle by triangle in the order they came${off.length ? ` (not so: ${off.join('; ')})` : ''}`);
  ok(keepTriangles(src, () => true).geometry === src, 'a geometry that keeps every triangle is the source itself (still shared)');
  ok(keepTriangles(src, () => true, true).geometry !== src, 'unless a copy is asked for (a re-pointing must not write the source)');
  ok(keepTriangles(src, () => false).geometry === null, 'and one that keeps none is no geometry at all');
}

// ---------------------------------------------------------------------------------------------
// 3. The hybrid of the made-up pair: the cockpit pod's cockpit, the engine pod's engines re-pointed to the cockpit's
// skeleton, and the points by the joint they hang off.
{
  const cockpit = madeCockpit();
  const engines = madeEngines();
  const { model, report } = buildHybrid(cockpit, engines, IDS);
  const meshes = skinnedOf(model);
  const bones = new Set<THREE.Object3D>();
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.add(o);
  });
  ok(report.cockpit.kept === 4 && report.engines.kept === 6 && report.engines.straddle === 2, `the hybrid keeps the cockpit pod's 4 cockpit triangles and the engine pod's 6, its 2 reaching across among them (${report.cockpit.kept}, ${report.engines.kept}, ${report.engines.straddle})`);
  const base = meshes.filter((m) => !m.parent?.name.startsWith('engines:'));
  const eng = meshes.filter((m) => m.parent?.name.startsWith('engines:'));
  ok(base.length === 2 && eng.length === 1, `two meshes of the cockpit pod's (each with only its cockpit triangles) and one of the engine pod's (${base.length}, ${eng.length})`);
  ok(base.every((m) => cockpitVertices(m).every((v) => v === 1)), "every vertex the cockpit pod keeps is its cockpit's");
  ok(base.every((m) => m.userData.shared === false && m.geometry.userData.podHybrid === true), "a cockpit mesh that lost triangles wears a geometry of the hybrid's own, not marked shared (so it is disposed with the vehicle)");
  // Every joint index names a bone of the cockpit's skeleton, and the joint the engine pod's own skin named for it.
  const srcEngine = skinnedOf(engines.scene)[0];
  const byPlace = new Map<string, string>();
  for (let i = 0; i < srcEngine.geometry.getAttribute('position').count; i++) {
    const p = srcEngine.geometry.getAttribute('position');
    byPlace.set(`${p.getX(i)},${p.getY(i)},${p.getZ(i)}`, srcEngine.skeleton.bones[srcEngine.geometry.getAttribute('skinIndex').getX(i)].name);
  }
  let named = 0;
  let wrong = 0;
  for (const m of eng) {
    const p = m.geometry.getAttribute('position');
    const si = m.geometry.getAttribute('skinIndex');
    for (let i = 0; i < p.count; i++) {
      for (let c = 0; c < 4; c++) {
        const bone = m.skeleton.bones[si.getComponent(i, c)];
        if (!bone || !bones.has(bone)) wrong++;
      }
      const bone = m.skeleton.bones[si.getX(i)];
      if (bone.name === byPlace.get(`${p.getX(i)},${p.getY(i)},${p.getZ(i)}`)) named++;
      else wrong++;
    }
  }
  ok(wrong === 0 && named === 18, `every joint index of the re-pointed engines names a bone of the hybrid's own skeleton, and for each vertex the joint the engine pod named (${named} of 18, ${wrong} wrong)`);
  ok(eng.every((m) => m.skeleton === base[0].skeleton), "the engines ride the cockpit's skeleton itself");
  // Posed: the hybrid's engines stand exactly where the engine pod's own do under the same pose.
  const pose = (root: THREE.Object3D) => {
    root.traverse((o) => {
      if (o.name === 'lft_engine') o.rotation.set(0.3, 0.2, -0.1);
      if (o.name === 'rght_leg') o.position.y += 0.7;
      if (o.name === 'root') o.position.y += 1.25;
    });
    root.updateMatrixWorld(true);
  };
  const lone = cloneSkinned(engines.scene);
  pose(lone);
  pose(model);
  const loneMesh = skinnedOf(lone)[0];
  const lck = cockpitVertices(loneMesh);
  const posed: number[] = [];
  for (let t = 0; t < loneMesh.geometry.getIndex()!.count; t += 3) {
    const v = [0, 1, 2].map((k) => loneMesh.geometry.getIndex()!.getX(t + k));
    if (lck[v[0]] + lck[v[1]] + lck[v[2]] < 3) for (const i of v) posed.push(...loneMesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(loneMesh.matrixWorld).toArray());
  }
  const mine: number[] = [];
  const em = eng[0];
  for (let k = 0; k < em.geometry.getIndex()!.count; k++) mine.push(...em.getVertexPosition(em.geometry.getIndex()!.getX(k), new THREE.Vector3()).applyMatrix4(em.matrixWorld).toArray());
  ok(posed.length === mine.length && posed.every((n, i) => near(n, mine[i])), `posed, the hybrid's engines stand exactly where the engine pod's own posed engines do, corner for corner (${mine.length / 3} corners)`);
  // The points.
  const pts = pointsOf(model);
  ok(pts.get('player')?.length === 1 && boneOver(pts.get('player')![0].parent)?.name === C, "one player point, the cockpit pod's own, on the body joint");
  ok(near(pts.get('player')![0].position.x, 0.1) && near(pts.get('player')![0].position.z, -0.5), "at the cockpit pod's own place, not the engine pod's");
  ok(pts.get('engine_sound_1')?.length === 1, "the cockpit's other point on body stays");
  ok(!pts.has('engine_2'), "the cockpit pod's engine points are taken off (its engines are not drawn)");
  const engPts = pointsOf(engines.scene);
  for (const name of ['engine_1', 'engine_3', 'beam_1', 'damage_1']) {
    const mineP = pts.get(name);
    const theirs = engPts.get(name)![0];
    const theirJoint = boneOver(theirs.parent)!.name;
    const ok1 = mineP?.length === 1 && boneOver(mineP[0].parent)?.name === theirJoint && bones.has(boneOver(mineP[0].parent)!);
    ok(ok1, `the engine pod's ${name} hangs on the hybrid's own ${theirJoint} joint`);
  }
  ok(report.pointsOn.sort().join() === 'beam_1,damage_1,engine_1,engine_3' && report.pointsOff.sort().join() === 'engine_1,engine_2', `the report names what went on and what came off (${report.pointsOn.join(' ')}; ${report.pointsOff.join(' ')})`);
  // At rest each engine point stands where it stood on the engine pod (one skeleton), the one hung through a plain node too.
  const restModel = buildHybrid(cockpit, engines, IDS).model;
  const restPts = pointsOf(restModel);
  const far = ['engine_1', 'engine_3', 'beam_1', 'damage_1'].filter((n) => worldOf(restPts.get(n)![0]).distanceTo(worldOf(engPts.get(n)![0])) > 1e-5);
  ok(far.length === 0, `at rest every engine point stands where it did on the engine pod, damage_1 through its plain node too${far.length ? ` (off: ${far.join(', ')})` : ''}`);
  // Where the cockpit pod alone would have stood its model: framed on its own whole box, before anything was taken off.
  const alone = cloneSkinned(cockpit.scene);
  alone.updateMatrixWorld(true);
  const f = frameExtents(alone, () => true)!;
  const ca = model.userData.cockpitAlone as number[];
  ok(near(ca[0], -f.cx) && near(ca[1], -f.minY) && near(ca[2], -f.cz), `the model says where the cockpit pod framed alone stands its model (${ca.map((n) => n.toFixed(2)).join(', ')})`);
}

// ---------------------------------------------------------------------------------------------
// 3b. A cockpit pod one of whose meshes is wholly its engines (five of the seven converted cockpits have such a primitive):
// that mesh goes from the hybrid altogether, or the cockpit pod's own engines are drawn over the other pod's; and one
// wholly its cockpit is worn as it stands.
{
  // Shared out in turn between two meshes: the first takes the two cockpit triangles, the second the two engine ones.
  const split = madeUpPod({ meshes: 2, triangles: [tri([C, C, C], -8), tri(['lft_engine', 'lft_engine', 'lft_engine'], 2, 3), tri([C, C, C], -9, 2), tri(['rght_leg', 'rght_engine', 'rght_engine'], 2, -3)], points: [{ name: 'player', joint: C, at: [0, 0, -0.5] }] });
  const names = skinnedOf(split.scene).map((m) => m.name);
  const { model, report } = buildHybrid(split, madeEngines(), IDS);
  const kept = skinnedOf(model).filter((m) => !m.parent?.name.startsWith('engines:'));
  ok(names.length === 2 && kept.length === 1 && kept[0].name === names[0], `the cockpit pod's mesh of engines alone is gone from the hybrid, its mesh of cockpit alone kept (${kept.map((m) => m.name).join(', ')} of ${names.join(', ')})`);
  const s = splitTriangles(kept[0].geometry, cockpitVertices(kept[0]));
  ok(s.engines === 0 && s.cockpit === 2 && report.cockpit.kept === 2 && report.cockpit.total === 4, `and nothing the cockpit pod keeps is its engines' (${s.cockpit} cockpit triangles, ${s.engines} engine; ${report.cockpit.kept} of its ${report.cockpit.total} kept)`);
  ok(kept[0].userData.shared === true && report.shared >= 1, 'a mesh wholly its cockpit is worn as the cached geometry, said shared');
}

// ---------------------------------------------------------------------------------------------
// 4. Refused, in words, never thrown as a fault: a joint the cockpit's skeleton has not got, and a skeleton at rest elsewhere.
{
  const renamed = madeUpPod({ triangles: engineTris, points: [], rename: { rght_foot: 'rght_toe' } });
  let err: unknown = null;
  try {
    buildHybrid(madeCockpit(), renamed, IDS);
  } catch (e) {
    err = e;
  }
  ok(err instanceof PodHalfRefused && /joints are not the same/.test((err as Error).message), `an engine pod whose joints are not the cockpit's by name is refused in words ("${(err as Error)?.message?.slice(0, 80)}…")`);
  const moved = madeUpPod({ triangles: engineTris, points: [], rest: { body: [-0.5, 0.9, -2] } });
  err = null;
  try {
    buildHybrid(madeCockpit(), moved, IDS);
  } catch (e) {
    err = e;
  }
  ok(err instanceof PodHalfRefused && /rests where/.test((err as Error).message), 'and one whose joints rest elsewhere is refused too');
  // The re-pointing on its own: a joint the target lacks refuses rather than throwing a fault or riding the root.
  const g = new THREE.BufferGeometry();
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 1, 0, 0], 4));
  const own = ['root', 'tail'].map((n) => Object.assign(new THREE.Bone(), { name: n }));
  const target = ['body', 'root'].map((n) => Object.assign(new THREE.Bone(), { name: n }));
  err = null;
  try {
    repointJoints(g, own, target, 'a tailed thing');
  } catch (e) {
    err = e;
  }
  ok(err instanceof PodHalfRefused && /tail/.test((err as Error).message) && Array.from(g.getAttribute('skinIndex').array).join() === '0,1,0,0', 'a joint the target lacks refuses the half, writing nothing');
  const g2 = new THREE.BufferGeometry();
  g2.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 1, 1, 0], 4));
  repointJoints(g2, [own[0], target[0]], target, 'two joints');
  ok(Array.from(g2.getAttribute('skinIndex').array).join() === '1,0,0,1', "a joint is re-pointed to the target's index of the same name");
}

// ---------------------------------------------------------------------------------------------
// 5. The seat: by the cockpit pod's rules. Its own player point where it has one, else the owner's row for the cockpit
// pod moved by the framing, so the pelvis stands where it stands on that pod relative to its skeleton.
{
  const guess = (): Vec3 => [0, 9, 9];
  const row = POD_SEAT.pod_racer_ipg_longtail;
  const shift: Vec3 = [0.25, -0.5, 1.75];
  const r = podSeatRule('pod_racer_ipg_longtail.podracer_anakin', { hardpoint: [1, 2, 3], joint: [4, 5, 6], guess }, { id: 'pod_racer_ipg_longtail', shift });
  ok(r.rule === 'table' && r.pelvis.every((n, i) => near(n, row[i] + shift[i])), `on the IPG's cockpit the owner's row for the IPG, moved by the framing (${r.pelvis.map((n) => n.toFixed(2)).join(', ')})`);
  const own = podSeatRule('pod_racer_one.podracer_anakin', { hardpoint: [1, 2, 3], joint: [4, 5, 6], guess }, { id: 'pod_racer_one', shift });
  ok(own.rule === 'hardpoint' && own.pelvis.join() === '1,2,3', "on a cockpit with no row, the game's own player point, which rides the cockpit's joint and needs no moving");
  ok(podSeatRule('pod_racer_ipg_longtail', { hardpoint: null, joint: null, guess }).pelvis.join() === row.join(), 'the IPG alone still sits on its row as it stands');
  // The whole seat path over the made-up hybrid, framed as the garage frames it.
  const { model } = buildHybrid(madeCockpit(), madeEngines(), IDS);
  model.updateMatrixWorld(true);
  const f = frameExtents(model, () => true)!;
  model.position.set(-f.cx, -f.minY, -f.cz);
  const group = new THREE.Group();
  group.add(model);
  group.updateMatrixWorld(true);
  const target: Stand = { seat: new THREE.Object3D(), group, speed: 0, onUpdate: null, seatBind: null, seatPelvis: false, seatFollows: false, seatRule: null };
  group.add(target.seat);
  const seated = seatPod(target, { id: hybridId(IDS.cockpit, IDS.engines), model, clips: [], find: findHardpoint, guess, cockpit: hybridSeatCockpit({ hybrid: IDS }, model) });
  const hp = group.worldToLocal(worldOf(findHardpoint(model, 'player')!));
  ok(seated.rule === 'hardpoint' && near(seated.pelvis[0], hp.x) && near(seated.pelvis[2], hp.z) && seated.joint?.name === C, `the made-up hybrid seats its pilot on its cockpit's own player point, riding the body joint (${seated.pelvis.map((n) => n.toFixed(2)).join(', ')})`);
  ok(hybridSeatCockpit({ hybrid: null }, model) === null && hybridSeatCockpit({ hybrid: IDS }, cloneSkinned(madeCockpit().scene)) === null, "no seat cockpit for a pod of its own, nor for a model the hybrid's build did not make");
}

// ---------------------------------------------------------------------------------------------
// 5b. The owner's row on a hybrid of the IPG's cockpit (the one skinned pod with a row), the whole seat path as the garage
// runs it -- framed by `framedExtents`, its cockpit by `hybridSeatCockpit`, seated by `seatPod` -- against what the row
// means: the pelvis stands on the hybrid's cockpit exactly where the row stands it on the IPG framed alone, in the model's
// own frame (the cockpit is the IPG's own skeleton at rest in both).
{
  const ipg = 'pod_racer_ipg_longtail';
  const row = POD_SEAT[ipg];
  // A cockpit with no player point: with no row it would sit on its joint, so only the row can put the pelvis where it goes.
  const ipgPod = () => madeUpPod({ meshes: 2, triangles: cockpitTris, points: [{ name: 'engine_1', joint: 'rght_leg', at: [0.2, -1, -4] }] });
  const framed = (def: { hybrid?: unknown }, model: THREE.Object3D) => {
    model.updateMatrixWorld(true);
    const f = framedExtents(def, model, [], () => true)!;
    model.position.sub(new THREE.Vector3(f.cx, f.minY, f.cz));
    model.updateMatrixWorld(true);
    return model;
  };
  // The IPG alone, framed as the garage frames any pod at rest: where the row stands in its model's own frame.
  const alone = framed({}, cloneSkinned(ipgPod().scene));
  const onModel = new THREE.Vector3(row[0], row[1], row[2]).sub(alone.position);
  const def = { hybrid: { cockpit: ipg, engines: IDS.engines } };
  const model = framed(def, buildHybrid(ipgPod(), madeEngines(), def.hybrid).model);
  const group = new THREE.Group();
  group.add(model);
  group.updateMatrixWorld(true);
  const target: Stand = { seat: new THREE.Object3D(), group, speed: 0, onUpdate: null, seatBind: null, seatPelvis: false, seatFollows: false, seatRule: null };
  group.add(target.seat);
  const cockpit = hybridSeatCockpit(def, model);
  const seated = seatPod(target, { id: hybridId(ipg, IDS.engines), model, clips: [], find: findHardpoint, guess: (): Vec3 => [0, 9, 9], cockpit });
  const got = new THREE.Vector3(...seated.pelvis).sub(model.position);
  const shift = cockpit ? Math.hypot(...cockpit.shift) : 0;
  ok(shift > 0.25, `the hybrid frames the IPG's cockpit ${shift.toFixed(2)} m from where the IPG framed alone does, so a row left unmoved, or moved the wrong way, is a seat off the cockpit`);
  ok(seated.rule === 'table' && got.distanceTo(onModel) < 1e-5, `the pelvis stands where the IPG's own row stands it on the IPG's cockpit (${got.toArray().map((n) => n.toFixed(2)).join(', ')} on the model, against ${onModel.toArray().map((n) => n.toFixed(2)).join(', ')})`);
}

// ---------------------------------------------------------------------------------------------
// 6. The def: a new object, made of the cockpit pod's and naming the engine pod to sound by, and a spawn's writes of it
// (its race thrusters) going onto it and into neither pod's.
{
  const cockpit: TestDef = { id: 'pod_racer_one', label: 'pod racer one', kind: 'podracer', inferred: true, source: 'gallery', file: 'assets-private/gallery/c.glb', template: 'object/mobile/vehicle/shared_pod_racer_one.iff', model: 'c', bounds: { min: [-1, 0, -2], max: [1, 1, 2] }, riderPose: 'vehicle_podracer_01', clipSpeeds: { run: 15.6, idle: 0 }, skeletal: true, raceThrusters: ['engine_1', 'engine_2'], thrusters: ['engine_1', 'engine_2'] };
  const engines: TestDef = { id: 'podracer_anakin', label: 'podracer anakin', kind: 'podracer', inferred: true, source: 'gallery', file: 'assets-private/gallery/e.glb', template: 'object/mobile/vehicle/shared_podracer_anakin.iff', model: 'e', bounds: { min: [-2, 0, -3], max: [2, 1, 3] }, riderPose: 'vehicle_anakin_podracer', skeletal: true };
  const keys = (d: object) => Object.keys(d);
  const snap = (d: Record<string, unknown>) => keys(d).map((k) => [k, d[k]] as const);
  const before = [snap(cockpit as unknown as Record<string, unknown>), snap(engines as unknown as Record<string, unknown>)];
  const deep = JSON.stringify([cockpit, engines]);
  const h = hybridDefOf(cockpit, engines) as TestDef & { hybrid: { cockpit: string; engines: string }; soundFrom: { id: string; template?: string } };
  ok(h !== (cockpit as unknown) && h.id === `pod_racer_one${HYBRID_SEP}podracer_anakin` && h.kind === 'podracer' && h.source === 'gallery' && h.riderPose === 'vehicle_podracer_01', `a def of its own, ${h.id}, a pod from the gallery seated as the cockpit pod's rider`);
  ok(h.hybrid.cockpit === 'pod_racer_one' && h.hybrid.engines === 'podracer_anakin' && h.soundFrom.id === 'podracer_anakin' && h.soundFrom.template === engines.template, 'naming both halves, and sounding by the engine pod (its id and template)');
  ok(h.clipSpeeds !== cockpit.clipSpeeds && h.clipSpeeds?.run === 15.6, "the cockpit's clips' speeds copied, not shared");
  ok(h.raceThrusters === undefined && h.thrusters === undefined && h.bounds === undefined, "none of the cockpit pod's race thrusters, thrusters or bounds (its own are worked out when it is built)");
  ok(isHalf(h) && isPod(h), 'and itself a skinned pod (the seat and clips follow it as a pod)');
  // The spawn's write: the race thrusters, from the hybrid's own engine points.
  const points: EnginePoint[] = [{ name: 'engine_1', x: 2, z: -6 }, { name: 'engine_2', x: -2, z: -6 }, { name: 'engine_3', x: 2, z: 1 }, { name: 'engine_4', x: -2, z: 1 }];
  ok(noteRaceThrusters(h, () => points, true) && h.raceThrusters?.join() === 'engine_1,engine_2' && h.thrusters === h.raceThrusters, `the spawn names the hybrid's race thrusters on its own def (${h.raceThrusters?.join(' ')})`);
  ok(!noteRaceThrusters(h, () => [], true), 'once, as on every def');
  const after = [snap(cockpit as unknown as Record<string, unknown>), snap(engines as unknown as Record<string, unknown>)];
  const same = before.every((list, k) => list.length === after[k].length && list.every(([key, v], i) => after[k][i][0] === key && Object.is(after[k][i][1], v)));
  ok(same && JSON.stringify([cockpit, engines]) === deep, "and both pods' defs are untouched, every field the same object or value (by Object.is) and every nested value the same");
  ok(!isHalf({ ...engines, skeletal: undefined }) && !isHalf({ ...engines, source: 'creature' }) && !isHalf({ ...engines, kind: 'speederbike' }), 'a pod not converted on a skeleton (the static FG 8T8), a creature named for one and a bike are no half');
}

// ---------------------------------------------------------------------------------------------
// 6b. Which two pods a hybrid is asked to be made of (`pickHalves`, which `Garage.hybrid` asks): every name looked up
// again among the skinned pods, so a hybrid given new engines is its cockpit pod on them and never a hybrid of a hybrid
// (whose cockpit no garage could find when it came to be built), and a refusal in words.
{
  const half = (id: string): TestDef => ({ id, label: id.replace(/_/g, ' '), kind: 'podracer', inferred: false, source: 'gallery', file: `${id}.glb`, skeletal: true });
  const one = half('pod_racer_one');
  const anakin = half('podracer_anakin');
  const two = half('pod_racer_two');
  const halves = [one, anakin, two];
  const known = (id: string) => halves.some((v) => v.id === id) || id === 'fg_8t8_podracer';
  const picked = (p: { cockpit: TestDef; engines: TestDef } | string) =>(typeof p === 'string' ? p : `${p.cockpit.id}+${p.engines.id}`);
  ok(picked(pickHalves(halves, known, one, 'podracer_anakin')) === 'pod_racer_one+podracer_anakin' && picked(pickHalves(halves, known, 'pod_racer_one', 'anakin')) === 'pod_racer_one+podracer_anakin', 'a pod by its def or its id, and engines by id or by part of one');
  const hybrid = hybridDefOf(one, anakin) as TestDef;
  const p = pickHalves(halves, known, hybrid, 'pod_racer_two');
  ok(typeof p !== 'string' && p.cockpit === one && p.engines === two, `a hybrid handed as the cockpit is its own cockpit pod: given new engines, it is that pod on them (${picked(p)}), never a hybrid of a hybrid`);
  ok(picked(pickHalves(halves, known, two, hybridId('pod_racer_one', 'podracer_anakin'))) === 'pod_racer_two+podracer_anakin' && picked(pickHalves(halves, known, hybridId('pod_racer_one', 'podracer_anakin'), 'pod_racer_two')) === 'pod_racer_one+pod_racer_two', "a hybrid's id named as the engines is its engine pod, and named as the cockpit its cockpit pod");
  const back = pickHalves(halves, known, hybrid, 'pod_racer_one');
  ok(typeof back !== 'string' && back.cockpit === one && back.engines === one, 'and given its cockpit pod\'s own engines back, it is that pod itself (the garage hands back the plain pod)');
  ok(/cannot be a hybrid's cockpit/.test(String(pickHalves(halves, known, 'fg_8t8_podracer', 'pod_racer_two'))) && /no skinned pod nothing to take a cockpit from/.test(String(pickHalves(halves, known, 'nothing', 'pod_racer_two'))), 'a vehicle that is no skinned pod is refused as a cockpit in words, and a name that is no vehicle said so');
  ok(/cannot be a hybrid's engines/.test(String(pickHalves(halves, known, one, 'fg_8t8_podracer'))) && /no skinned pod nothing to take engines from/.test(String(pickHalves(halves, known, one, 'nothing'))) && typeof pickHalves(halves, known, one, 'anakin', true) === 'string', 'and the same of the engines; asked exactly (the id another player\'s ride arrives on), part of an id finds nothing');
}

// ---------------------------------------------------------------------------------------------
// 7. The wire: a hybrid goes out by the id that names both halves, which the relay's own cleaner passes for every pair of
// the skinned pods; a state of the old shape (one pod's id) still passes, and an id too long goes out as its cockpit.
{
  const packs = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private', import.meta.url));
  const man = join(packs, 'gallery', 'manifest.json');
  const gal = join(packs, 'gallery', 'gallery.json');
  let ids: string[] = [];
  if (existsSync(man) && existsSync(gal)) {
    const skeletal = new Set((JSON.parse(readFileSync(man, 'utf8')) as { categories: { layout: { id: string; skeletal?: boolean }[] } }).categories.layout.filter((m) => m.skeletal).map((m) => m.id));
    const items = (JSON.parse(readFileSync(gal, 'utf8')) as { sections: { id: string; items: { label: string; model: string }[] }[] }).sections.find((s) => s.id === 'vehicles')?.items ?? [];
    ids = items.filter((it) => skeletal.has(it.model) && VEHICLE_KINDS[it.label]?.kind === 'podracer').map((it) => it.label);
    note(`the converted gallery's skinned pods: ${ids.join(', ')}`);
  } else {
    ids = Object.keys(VEHICLE_KINDS).filter((id) => VEHICLE_KINDS[id].kind === 'podracer' && id !== 'fg_8t8_podracer');
    note(`no converted gallery here (${man}): the pairs are the kinds table's pods but the static FG 8T8`);
  }
  ok(ids.length >= 6, `${ids.length} skinned pods, any of which may be either half`);
  let longest = '';
  let passed = 0;
  let pairs = 0;
  for (const c of ids)
    for (const e of ids) {
      if (c === e) continue;
      pairs++;
      const id = hybridId(c, e);
      if (id.length > longest.length) longest = id;
      const back = parseHybridId(id);
      const clean = cleanVehicle({ id, p: [1, 2, 3], q: [0, 0, 0, 1], role: 'ride' });
      if (clean?.id === id && back?.cockpit === c && back?.engines === e && wireVehicleId({ id, hybrid: { cockpit: c } }) === id) passed++;
    }
  ok(passed === pairs, `every one of the ${pairs} pairs goes out by an id the relay's cleaner keeps whole and reads back as both halves`);
  ok(longest.length <= VEHICLE_ID_MOST, `the longest pair is ${longest.length} characters (${longest}), within the ${VEHICLE_ID_MOST} the relay passes`);
  ok(cleanVehicle({ id: 'x'.repeat(VEHICLE_ID_MOST), p: [0, 0, 0], q: [0, 0, 0, 1] })?.id.length === VEHICLE_ID_MOST && cleanVehicle({ id: 'x'.repeat(VEHICLE_ID_MOST + 1), p: [0, 0, 0], q: [0, 0, 0, 1] }) === undefined, `the relay's cap is the ${VEHICLE_ID_MOST} this side measures against`);
  const plain = cleanVehicle({ id: 'pod_racer_one', p: [0, 0, 0], q: [0, 0, 0, 1], role: 'ride' });
  ok(plain?.id === 'pod_racer_one' && parseHybridId('pod_racer_one') === null && wireVehicleId({ id: 'pod_racer_one' }) === 'pod_racer_one', 'a state of the old shape, one pod by its own id, still passes and is no hybrid');
  const long = hybridId('a_very_long_cockpit_pod_name_x', 'an_even_longer_engine_pod_name');
  ok(long.length > VEHICLE_ID_MOST && wireVehicleId({ id: long, hybrid: { cockpit: 'a_very_long_cockpit_pod_name_x' } }) === 'a_very_long_cockpit_pod_name_x', 'a pair too long for the relay goes out as its cockpit pod, drawn whole, rather than dropped');
  // An older browser looks an id up whole, then as part of another: it finds no vehicle for a hybrid and so draws none (and never throws).
  const oldFind = (n: string) => ids.find((v) => v === n) ?? ids.find((v) => v.includes(n));
  ok(ids.every((c) => ids.every((e) => c === e || oldFind(hybridId(c, e)) === undefined)), "an older browser's garage finds nothing for a hybrid's id, so it draws no picture of it");
  ok(ids.every((id) => !id.includes(HYBRID_SEP)), `no garage id carries the "${HYBRID_SEP}" that parts a hybrid's halves`);
}

// ---------------------------------------------------------------------------------------------
// 8. Disposing a hybrid leaves the two pods' cached models whole: no geometry or material of theirs is disposed or
// changed, their bones and points stand as they did, and every geometry the hybrid made of its own is disposed.
function holdsWhole(cockpit: { scene: THREE.Object3D }, engines: { scene: THREE.Object3D }, ids: { cockpit: string; engines: string }, label: string, unmarked = false): HybridReport {
  // Unmarked: the cached meshes carry no `shared` of their own, so a geometry worn whole is kept only by the hybrid's own mark.
  if (unmarked)
    for (const s of [cockpit.scene, engines.scene])
      s.traverse((o) => {
        delete o.userData.shared;
      });
  const sum = (a: ArrayLike<number>) => {
    let s = 0;
    for (let i = 0; i < a.length; i++) s = (s * 31 + a[i] * 7 + i) % 1e9;
    return s;
  };
  type Held = { geo: THREE.BufferGeometry; attrs: [string, THREE.BufferAttribute | THREE.InterleavedBufferAttribute, number][]; index: THREE.BufferAttribute | null; mat: THREE.Material | THREE.Material[] };
  const held: Held[] = [];
  const disposed = new Set<object>();
  const points: [THREE.Object3D, THREE.Object3D | null, string][] = [];
  const bones: [THREE.Object3D, string][] = [];
  for (const s of [cockpit.scene, engines.scene]) {
    s.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        held.push({ geo: m.geometry, attrs: Object.entries(m.geometry.attributes).map(([k, a]) => [k, a, sum(a.array)]), index: m.geometry.getIndex(), mat: m.material });
        m.geometry.addEventListener('dispose', () => disposed.add(m.geometry));
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.addEventListener('dispose', () => disposed.add(mat));
      }
      if (hardpointName(o) !== null) points.push([o, o.parent, o.position.toArray().join()]);
      if ((o as THREE.Bone).isBone) bones.push([o, `${o.position.toArray().join()}|${o.quaternion.toArray().join()}`]);
    });
  }
  const { model, report } = buildHybrid(cockpit, engines, ids);
  const own = new Set<THREE.BufferGeometry>();
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry.userData.podHybrid === true) {
      own.add(m.geometry);
      m.geometry.addEventListener('dispose', () => disposed.add(m.geometry));
    }
  });
  // As the vehicle disposes itself (every geometry not marked shared), then as a picture is let go of.
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry && !m.userData.shared) m.geometry.dispose();
  });
  disposePodHybrid(model);
  const cachedGone = held.filter((h) => disposed.has(h.geo) || (Array.isArray(h.mat) ? h.mat : [h.mat]).some((m) => disposed.has(m))).length;
  const changed = held.filter((h) => h.attrs.some(([k, a, s]) => h.geo.attributes[k] !== a || sum(a.array) !== s) || h.geo.getIndex() !== h.index).length;
  const moved = points.filter(([o, parent, at]) => o.parent !== parent || o.position.toArray().join() !== at).length + bones.filter(([b, at]) => `${b.position.toArray().join()}|${b.quaternion.toArray().join()}` !== at).length;
  ok(cachedGone === 0 && changed === 0 && moved === 0, `${label}: the two pods' cached models are whole after the hybrid is disposed (${held.length} meshes, ${points.length} points, ${bones.length} bones: none disposed, changed or moved)`);
  ok(own.size === report.own && [...own].every((g) => disposed.has(g)), `${label}: and every one of the ${own.size} geometries the hybrid made of its own was disposed`);
  return report;
}
holdsWhole(madeCockpit(), madeEngines(), IDS, 'the made-up pair');
{
  // A pair with a mesh of each that keeps every triangle (on the engine pod, in the cockpit's own joint order): those are
  // worn as the cached geometries themselves, and said shared by the hybrid even where the cache never said so.
  const wholeCockpit = madeUpPod({ meshes: 2, triangles: [tri(['lft_engine', 'lft_engine', 'lft_engine'], 2, 3), tri([C, C, C], -8), tri([C, C, C], -9, 2), tri([C, C, C], -9.5, 3)], points: [{ name: 'player', joint: C, at: [0, 0, -0.5] }] });
  const wholeEngines = madeUpPod({ meshes: 2, triangles: [tri([C, C, C], -10), tri(['lft_leg', 'lft_leg', 'lft_leg'], 1, 4), tri(['rght_engine', 'rght_engine', 'rght_engine'], 3, -4), tri(['rght_leg', 'rght_leg', 'rght_leg'], 1, -4)], points: [{ name: 'engine_1', joint: 'lft_leg', at: [0, -1, -3] }] });
  const r = holdsWhole(wholeCockpit, wholeEngines, IDS, 'a pair with meshes kept whole, the cache unmarked', true);
  ok(r.shared === 2 && r.own === 2, `two geometries worn as the cached ones and two of the hybrid's own (${r.shared}, ${r.own})`);
}

// ---------------------------------------------------------------------------------------------
// 9a. A hybrid is framed as its cockpit pod's idle poses it, its skeleton put back at rest after: the engines ride clips
// made for another pod's engines, and framed at rest the idle can stand the cockpit under the hull's underside.
const lowestPosed = (model: THREE.Object3D): number => {
  model.updateMatrixWorld(true);
  let low = Infinity;
  const v = new THREE.Vector3();
  for (const m of skinnedOf(model)) {
    const p = m.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) low = Math.min(low, m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld).y);
  }
  return low;
};
const posedLow = (model: THREE.Object3D, clip: THREE.AnimationClip): number => {
  const mixer = new THREE.AnimationMixer(model);
  mixer.clipAction(clip).play();
  mixer.update(0);
  const low = lowestPosed(model);
  mixer.stopAllAction();
  mixer.uncacheRoot(model);
  model.updateMatrixWorld(true);
  return low;
};
{
  const idle = new THREE.AnimationClip('idle', 1, [new THREE.VectorKeyframeTrack('left_foot.position', [0, 1], [-1.5, -3.5, -6, -1.5, -3.5, -6])]);
  const run = new THREE.AnimationClip('run', 1, [new THREE.VectorKeyframeTrack('left_foot.position', [0, 1], [-1.5, 0.5, -6, -1.5, 0.5, -6])]);
  ok(framingClip([run, idle]) === idle && framingClip([run]) === null && framingClip([]) === null, 'a hybrid is framed in its cockpit pod\'s idle, and at rest when that pod has no idle');
  const { model } = buildHybrid(madeCockpit(), madeEngines(), IDS);
  const restAt = new Map<THREE.Object3D, string>();
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) restAt.set(o, `${o.position.toArray().join()}|${o.quaternion.toArray().join()}`);
  });
  const atRest = frameExtents(model, () => true)!;
  const inIdle = posedExtents(model, framingClip([run, idle]), () => true)!;
  const back = [...restAt].every(([b, at]) => `${b.position.toArray().join()}|${b.quaternion.toArray().join()}` === at);
  ok(back, 'measured in the idle, the skeleton is put back at rest after');
  const dip = posedLow(model, idle) - atRest.minY;
  ok(dip < -2.5, `framed at rest, the made-up cockpit's idle stands ${(-dip).toFixed(2)} m under the hull's underside`);
  ok(near(posedLow(model, idle), inIdle.minY) && posedLow(model, run) >= inIdle.minY - 1e-6, 'framed in the idle, the idle stands on the underside and the run above it');
  ok(near(posedExtents(model, null, () => true)!.minY, atRest.minY), 'with no clip, the frame is the one at rest');
  // What the garage frames on (`framedExtents`, which `frameModel` calls): a hybrid in its idle, anything else at rest.
  const same = (a: ReturnType<typeof frameExtents>, b: ReturnType<typeof frameExtents>) => !!a && !!b && (['cx', 'cz', 'minY', 'h', 'halfW', 'halfL', 'reach'] as const).every((k) => near(a[k], b[k], 1e-9));
  ok(same(framedExtents({ hybrid: IDS }, model, [run, idle], () => true), inIdle), "the garage frames a hybrid on its cockpit pod's idle");
  ok(same(framedExtents({}, model, [run, idle], () => true), atRest) && same(framedExtents({ hybrid: null }, model, [run, idle], () => true), atRest), 'and a pod of its own at rest, whatever clips it carries, as it always was');
}

// ---------------------------------------------------------------------------------------------
// 9. The converted pods, when they are here: each splits cleanly (only a few dozen triangles reach across), every pair
// is put together with nothing refused, one player point on its cockpit, its engines' points from the engine pod.
{
  const packs = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private', import.meta.url));
  const dir = join(packs, 'gallery');
  const man = join(dir, 'manifest.json');
  const gal = join(dir, 'gallery.json');
  if (!existsSync(man) || !existsSync(gal)) {
    note(`the converted pods are not here (${dir}): the split, the re-pointing and the dispose are held on the made-up pod alone; convert the gallery to hold them on the game's own pods`);
  } else {
    const layout = (JSON.parse(readFileSync(man, 'utf8')) as { categories: { layout: { id: string; file: string; skeletal?: boolean; triangles?: number }[] } }).categories.layout;
    const items = (JSON.parse(readFileSync(gal, 'utf8')) as { sections: { id: string; items: { label: string; model: string }[] }[] }).sections.find((s) => s.id === 'vehicles')?.items ?? [];
    const pods = items.filter((it) => VEHICLE_KINDS[it.label]?.kind === 'podracer').map((it) => ({ id: it.label, m: layout.find((l) => l.id === it.model) })).filter((p) => p.m?.skeletal && existsSync(join(dir, p.m.file)));
    const loaded = new Map(pods.map((p) => [p.id, loadSkinnedGlb(join(dir, p.m!.file))]));
    ok(pods.length >= 6, `${pods.length} skinned pods converted: ${pods.map((p) => p.id).join(', ')}`);
    const splits = new Map<string, { total: number; cockpit: number; straddle: number }>();
    for (const p of pods) {
      const s = { total: 0, cockpit: 0, straddle: 0 };
      for (const m of skinnedOf(loaded.get(p.id)!.scene)) {
        const t = splitTriangles(m.geometry, cockpitVertices(m));
        s.total += t.total;
        s.cockpit += t.cockpit;
        s.straddle += t.straddle;
      }
      splits.set(p.id, s);
      ok(s.straddle >= 16 && s.straddle <= 32 && s.straddle / s.total < 0.01 && s.cockpit > 0 && s.cockpit < s.total && (p.m!.triangles === undefined || p.m!.triangles === s.total), `${p.id}: ${s.straddle} of its ${s.total} triangles reach across (${s.cockpit} its cockpit's, ${s.total - s.cockpit - s.straddle} wholly its engines')`);
    }
    let built = 0;
    const refused: string[] = [];
    const wrong: string[] = [];
    const leaks: string[] = [];
    // How many of the converted cockpits have a primitive wholly their engines, which a hybrid must drop whole.
    const wholeEngines = pods.filter((p) => skinnedOf(loaded.get(p.id)!.scene).some((m) => splitTriangles(m.geometry, cockpitVertices(m)).cockpit === 0)).map((p) => p.id);
    note(`cockpits with a primitive wholly their engines: ${wholeEngines.join(', ') || 'none'}`);
    for (const c of pods)
      for (const e of pods) {
        if (c.id === e.id) continue;
        try {
          const { model, report } = buildHybrid(loaded.get(c.id)!, loaded.get(e.id)!, { cockpit: c.id, engines: e.id });
          built++;
          const pts = pointsOf(model);
          const enginePts = [...pointsOf(loaded.get(e.id)!.scene).entries()].filter(([, list]) => boneOver(list[0].parent)?.name !== C).map(([n]) => n).sort();
          const hung = [...pts.entries()].filter(([, list]) => boneOver(list[0].parent)?.name !== C).map(([n]) => n).sort();
          const bones = new Set<THREE.Object3D>();
          model.traverse((o) => {
            if ((o as THREE.Bone).isBone) bones.add(o);
          });
          let stray = 0;
          for (const m of skinnedOf(model)) {
            const si = m.geometry.getAttribute('skinIndex');
            for (let i = 0; i < si.count; i++) for (let k = 0; k < 4; k++) if (!bones.has(m.skeleton.bones[si.getComponent(i, k)])) stray++;
          }
          const sc = splits.get(c.id)!;
          const se = splits.get(e.id)!;
          const good = pts.get('player')?.length === 1 && boneOver(pts.get('player')![0].parent)?.name === C && hung.join() === enginePts.join() && stray === 0 && report.cockpit.kept === sc.cockpit && report.engines.kept === se.total - se.cockpit;
          if (!good) wrong.push(`${c.id}+${e.id}`);
          // What the cockpit pod keeps is its cockpit and nothing else: no mesh of it outside the engines' group carries a
          // triangle of its own engines (a primitive wholly engines gone, the rest cut to their cockpit triangles), and the
          // triangles it keeps are exactly its cockpit's.
          let mine = 0;
          for (const m of skinnedOf(model)) {
            if (m.parent?.name.startsWith('engines:')) continue;
            const t = splitTriangles(m.geometry, cockpitVertices(m));
            mine += t.cockpit;
            if (t.engines) leaks.push(`${c.id}+${e.id}: ${m.name || 'a mesh'} keeps ${t.engines} engine triangles`);
          }
          if (mine !== sc.cockpit) leaks.push(`${c.id}+${e.id}: its cockpit pod's meshes hold ${mine} cockpit triangles where it has ${sc.cockpit}`);
        } catch (err) {
          refused.push(`${c.id}+${e.id}: ${(err as Error).message}`);
        }
      }
    ok(refused.length === 0, `every one of the ${pods.length * (pods.length - 1)} pairs is put together, none refused${refused.length ? `: ${refused.slice(0, 3).join('; ')}` : ''}`);
    ok(wrong.length === 0 && built === pods.length * (pods.length - 1), `each with one player point on its cockpit, exactly its engine pod's engine points on its own joints, every joint index on its own skeleton and the triangles each half gives${wrong.length ? ` (not so: ${wrong.slice(0, 4).join(', ')})` : ''}`);
    ok(leaks.length === 0 && built > 0, `on every pair the cockpit pod's meshes draw its cockpit and none of its own engines, its ${wholeEngines.length} cockpits with a primitive wholly engines among them${leaks.length ? ` (not so: ${leaks.slice(0, 4).join('; ')})` : ''}`);
    // The light-bending pod as either half wears its own materials, never Gasgano's.
    const lb = pods.find((p) => p.id === 'pod_racer_light_bending');
    const other = pods.find((p) => p.id === 'podracer_anakin') ?? pods.find((p) => p.id !== 'pod_racer_light_bending');
    if (lb && other) {
      const names = (root: THREE.Object3D) => {
        const out = new Set<string>();
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) out.add(mat.name);
        });
        return out;
      };
      const lbMats = names(loaded.get(lb.id)!.scene);
      const asCockpit = names(buildHybrid(loaded.get(lb.id)!, loaded.get(other.id)!, { cockpit: lb.id, engines: other.id }).model);
      const asEngines = names(buildHybrid(loaded.get(other.id)!, loaded.get(lb.id)!, { cockpit: other.id, engines: lb.id }).model);
      ok([...asCockpit].some((n) => lbMats.has(n)) && [...asEngines].some((n) => lbMats.has(n)) && ![...asCockpit, ...asEngines].some((n) => /^shader\/gasgano_/.test(n)), 'the light-bending pod as either half wears its own materials exactly, none of the pod whose shape it shares');
    }
    // Every hybrid on a cockpit with clips, framed in that cockpit's idle: neither the idle's first frame nor the run's
    // stands under its underside; framed at rest, some stood metres under it.
    let worstAtRest = 0;
    let worstPair = '';
    const under: string[] = [];
    for (const c of pods) {
      const clips = loaded.get(c.id)!.animations;
      const idle = framingClip(clips);
      if (!idle) continue;
      const run = clips.find((k) => k.name === 'run') ?? null;
      for (const e of pods) {
        if (e.id === c.id) continue;
        const { model } = buildHybrid(loaded.get(c.id)!, loaded.get(e.id)!, { cockpit: c.id, engines: e.id });
        const rest = frameExtents(model, () => true)!;
        const framed = posedExtents(model, idle, () => true)!;
        const idleLow = posedLow(model, idle);
        const runLow = run ? posedLow(model, run) : Infinity;
        if (idleLow - rest.minY < worstAtRest) {
          worstAtRest = idleLow - rest.minY;
          worstPair = `${c.id} on ${e.id}`;
        }
        if (idleLow < framed.minY - 1e-3 || runLow < framed.minY - 1e-3) under.push(`${c.id} on ${e.id}`);
      }
    }
    ok(worstAtRest < -1, `framed at rest, the worst hybrid's idle would stand ${(-worstAtRest).toFixed(2)} m under its underside (${worstPair})`);
    ok(under.length === 0, `framed in the idle, no hybrid on a cockpit with clips stands its idle's or its run's first frame under its underside${under.length ? ` (${under.join(', ')})` : ''}`);
    const a = pods[0];
    const b = pods.find((p) => p.id !== a.id)!;
    holdsWhole(loaded.get(a.id)!, loaded.get(b.id)!, { cockpit: a.id, engines: b.id }, `${a.id} on ${b.id}`);
  }
}

// ---------------------------------------------------------------------------------------------
// 10. The hand-overs only the game makes, which no test above can see because each makes them for itself (the garage, the
// peers and the app do not load under node): pinned as text, so a line lost there fails here.
{
  const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const garage = read('src/vehicles/garage.ts');
  const remotes = read('src/net/remotePlayers.ts');
  const main = read('src/main.ts');
  const ui = read('src/ui/vehiclesUi.ts');
  const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;
  ok(/const pair = parseHybridId\(name\);\s*if \(pair\) \{\s*const h = this\.hybrid\(pair\.cockpit, pair\.engines, true\);/.test(garage), "(garage.ts: `find` turns a hybrid's id, the one another player's ride arrives on, back into its def, exactly)");
  ok(/hybrid\(cockpit: VehicleDef \| string, engines: string, exact = false\): VehicleDef \| string \{\s*const pick = pickHalves\(this\.halves\(\),/.test(garage), "(garage.ts: `hybrid` takes its two pods from `pickHalves`)");
  ok(/private async instance\(def: VehicleDef\): Promise<\{ model: THREE\.Group; animations: THREE\.AnimationClip\[\] \}> \{\s*if \(def\.hybrid\) \{/.test(garage) && /const built = buildHybrid\(cl, el, def\.hybrid\);/.test(garage) && /return \{ model: built\.model, animations: cl\.animations \};/.test(garage), "(garage.ts: `instance` builds a hybrid afresh out of the two pods' loaded models, with its cockpit pod's clips)");
  ok(count(garage, /const \[\{ model, animations \}, saddle\] = await Promise\.all\(\[this\.instance\(def\), this\.saddleFor\(def\)\]\);/g) === 2, '(garage.ts: the spawn and another player\'s picture both take their model from `instance`)');
  ok(/const f = framedExtents\(def, model, animations, include\);/.test(garage) && count(garage, /this\.frameModel\(def, model, animations\)/g) === 2, "(garage.ts: `frameModel` frames on `framedExtents`, handed the clips by the spawn and the picture alike)");
  ok(/const cockpit = pod \? hybridSeatCockpit\(def, model\) : null;/.test(garage) && /seatPod\(v, \{[^}]*, cockpit \}\)/.test(garage), "(garage.ts: a pod is seated with its hybrid's cockpit, `hybridSeatCockpit`)");
  ok(/disposePodHybrid\(holder\);/.test(garage) && /disposePodHybrid\(model\);/.test(garage), "(garage.ts: a picture and a spawn that fail let the hybrid's own geometries go)");
  ok(/if \(r\.vehicle !== rv\) \{\s*paint\?\.dispose\(\);\s*disposePodHybrid\(obj\);/.test(remotes) && /this\.scene\.remove\(r\.vehicle\.obj\);\s*(\/\/[^\n]*\n\s*)*disposePodHybrid\(r\.vehicle\.obj\);/.test(remotes), "(remotePlayers.ts: a peer's picture abandoned mid-build or dropped lets the hybrid's own geometries go)");
  ok(/id: own\.def \? wireVehicleId\(own\.def\) : own\.spec\.id/.test(main), '(main.ts: the ride goes out on the wire by `wireVehicleId`, the id that names both halves)');
  ok(/new VehiclesUi\(this\.ui, \(def, kind, engines\) => void this\.spawnWithEngines\(def, kind, engines\)/.test(main) && /const h = \(await this\.loadGarage\(\)\)\.hybrid\(def, engines\);/.test(main) && count(ui, /this\.onSpawn\(def, (undefined|sel\.value as VehicleKind), this\.enginesFor\(def\.id\) \|\| undefined\)/g) === 2, "(main.ts and vehiclesUi.ts: the panel's spawn button and its 'as…' menu both spawn on the engines chosen, through `Garage.hybrid`)");
}

console.log(`\n${checks} checks passed`);
