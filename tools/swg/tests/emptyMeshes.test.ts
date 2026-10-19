// A body's meshes that draw nothing, and its small parts (the performance pass's third wave, `src/world/mobiles/crowd.ts`):
// a look whose occlusion empties a body part (its index cut to nothing, or its draw range) lists that geometry on the
// look's own record and nowhere on a mesh (`userData` is deep-copied by `Object3D.copy`, which every clone of a body
// takes), every clone of the look shares it, a change of the occlusion lists the look again, and a mesh drawn per group
// counts its groups; a small part is a mesh with few triangles and a small radius on the body as it stands, never a
// weapon under a bone and never a mesh that draws nothing; and a stub body's small parts are hidden, shown and listed
// again by the very rules a body's own calls are (`hideSmallParts`, `relistSmallParts`). And, read as text, the body
// hangs its empties off by the look's list and the switch, its two calls are those rules, the manager lists its small
// parts again whenever a threshold moved and hands it the band's answer, and fills its tiers' inputs through
// `crowdInput`.
//
// Everything here is synthetic: numbers chosen for this test, nothing read from the game's files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CROWD_TUNE, drawnTriangles, drawsNothing, emptiesOf, hideSmallParts, isSmallPart, relistEmpties, relistSmallParts, type CrowdLook, type SmallPartsOwner } from '../../../src/world/mobiles/crowd.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const mat = new THREE.MeshBasicMaterial();

/** A made-up look: a torso, the arms the shirt hides (their index emptied by the occlusion cull), a shirt, two eyes and a buckle. */
function makeLook(): { look: CrowdLook; torso: THREE.Mesh; arms: THREE.Mesh; shirt: THREE.Mesh; eyes: THREE.Mesh[]; buckle: THREE.Mesh } {
  const scene = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.7, 0.25, 4, 6, 3), mat);
  torso.name = 'torso';
  const arms = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.15, 0.15, 6, 2, 2), mat);
  arms.name = 'arms';
  // The occlusion cull keeps the order and cuts the index: wholly under the shirt, nothing is left.
  arms.geometry.setIndex([]);
  const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.6, 0.3, 3, 3, 3), mat);
  shirt.name = 'shirt';
  const eyes = [0, 1].map((k) => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), mat);
    e.name = `eye${k}`;
    e.position.set(k ? 0.03 : -0.03, 1.65, 0.09);
    return e;
  });
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.04, 0.01), mat);
  buckle.name = 'buckle';
  scene.add(torso, arms, shirt, ...eyes, buckle);
  return { look: { scene }, torso, arms, shirt, eyes, buckle };
}

// ---- 1. What draws nothing, on the look's own record. ----
{
  const { look, torso, arms, shirt } = makeLook();
  const set = emptiesOf(look);
  ok(set.size === 1 && set.has(arms.geometry) && look.empties === set, "a look whose occlusion emptied its arms lists their geometry, and only that, on the look's own record");
  ok(emptiesOf(look) === set, 'asked again, the look answers from its record without walking its meshes');
  ok(drawsNothing(arms) && !drawsNothing(torso) && !drawsNothing(shirt), 'the arms draw no triangle; the torso and the shirt do');
  ok([arms, torso, shirt].every((m) => Object.keys(m.userData).length === 0), "and nothing of it is on a mesh's userData, which every clone deep-copies through JSON");
  const clone = look.scene.clone();
  const cloned = clone.children.filter((o) => (o as THREE.Mesh).isMesh && set.has((o as THREE.Mesh).geometry));
  ok(cloned.length === 1 && cloned[0].name === 'arms', 'a body cloned from the look shares its geometry, so the look\'s list names the clone\'s own arms');
  // A change of occlusion: the arms come out from under the shirt (a sleeve taken off), and the shirt is hidden whole.
  arms.geometry.setIndex([0, 1, 2, 2, 1, 3]);
  shirt.geometry.setDrawRange(0, 0);
  const again = relistEmpties(look);
  ok(again.has(shirt.geometry) && !again.has(arms.geometry) && look.empties === again, 'a change of the look\'s occlusion lists it again: the shirt drawn to nothing is listed, the arms with triangles are not');
}

// ---- 2. Counting a geometry's triangles. ----
{
  const g = new THREE.BoxGeometry(1, 1, 1);
  const all = g.index!.count / 3;
  ok(drawnTriangles(g) === all, `a whole box draws its ${all} triangles`);
  g.setDrawRange(6, 12);
  ok(drawnTriangles(g) === 4, 'a draw range of twelve indices from the sixth is four triangles');
  g.setDrawRange(0, Infinity);
  ok(drawnTriangles(g, true) === all, 'with a material per group, a box draws every group');
  g.clearGroups();
  g.addGroup(0, 6, 0);
  g.addGroup(30, 0, 1);
  ok(drawnTriangles(g, true) === 2 && drawnTriangles(g, false) === all, 'drawn per group it draws only what its groups hold; drawn with one material, every index');
  const loose = new THREE.BufferGeometry();
  loose.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9 * 3), 3));
  ok(drawnTriangles(loose) === 3, 'a geometry with no index draws its vertices in threes');
  const line = new THREE.Line(new THREE.BufferGeometry(), mat);
  ok(!drawsNothing(line as unknown as THREE.Mesh), 'a line is never counted as a mesh that draws nothing');
}

// ---- 3. The small parts. ----
{
  const { look, torso, arms, shirt, eyes, buckle } = makeLook();
  const inner = new THREE.Group();
  inner.add(look.scene);
  // The thresholds set here (the shipped ones are the owner's sliders): under 96 triangles and 0.12 m from the middle.
  const tune = { smallTris: 96, smallSize: 0.12 };
  const small = (m: THREE.Mesh, scale = 1) => isSmallPart(m, inner, scale, tune);
  ok(eyes.every((e) => small(e)) && small(buckle), 'the eyes and the buckle are small parts: few triangles, and smaller than smallSize across');
  ok(!small(torso) && !small(shirt), 'the torso and the shirt are not');
  ok(!small(arms), 'a mesh that draws nothing is never a small part (it is an empty, kept off on its own)');
  // And one that is small in every other way: an eye whose index the occlusion emptied, and one drawn to nothing.
  const lidded = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), mat);
  lidded.geometry.setIndex([]);
  const ranged = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), mat);
  ranged.geometry.setDrawRange(0, 0);
  look.scene.add(lidded, ranged);
  ok(!small(lidded) && !small(ranged) && drawsNothing(lidded) && drawsNothing(ranged), 'an eye-sized mesh that draws nothing, its index emptied or its draw range nought, is never a small part either');
  look.scene.remove(lidded, ranged);
  ok(!small(buckle, 4), "a buckle on a body four times a person's size is not small (its radius is measured on the body as it stands)");
  look.scene.scale.setScalar(4);
  ok(!small(buckle) && small(eyes[0]), 'and the frames between a mesh and the body count: a look scaled up four times over has no small buckle, though its eyes are still small');
  look.scene.scale.setScalar(1);
  // A weapon hangs under a hand bone: never a small part, whatever its size.
  const hand = new THREE.Bone();
  look.scene.add(hand);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.05), mat);
  hand.add(grip);
  ok(!small(grip), 'a weapon under a bone is never one of the body\'s small parts');
  // The body's own call hands no thresholds and reads the live table: moved, the same eye is no longer small.
  const was = { smallTris: CROWD_TUNE.smallTris, smallSize: CROWD_TUNE.smallSize };
  CROWD_TUNE.smallTris = 96;
  CROWD_TUNE.smallSize = 0.12;
  const before = isSmallPart(eyes[0], inner, 1);
  CROWD_TUNE.smallTris = 8;
  ok(before && !isSmallPart(eyes[0], inner, 1), 'smallTris is live: under eight triangles, an eye of 48 is no longer small');
  Object.assign(CROWD_TUNE, was);
}

// ---- 3b. A body's small parts hidden, shown and listed again (`hideSmallParts`, `relistSmallParts`: the calls
// `Mobile.setSmallHidden` and `Mobile.listSmallParts` are), on a stub body over the made-up look. ----
{
  const { look, torso, arms, shirt, eyes, buckle } = makeLook();
  const inner = new THREE.Group();
  inner.add(look.scene);
  const tune = { smallTris: 96, smallSize: 0.12 };
  // A patch the look itself hides (a part of a hood the occlusion keeps off): never a small part however small.
  const patch = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.01), mat);
  patch.visible = false;
  look.scene.add(patch);
  const meshes = [torso, arms, shirt, ...eyes, buckle, patch];
  const body: SmallPartsOwner = { meshes, emptyMeshes: [arms], smallMeshes: [], smallHidden: false, smallVersion: -1 };
  relistSmallParts(body, inner, 1, 3, tune);
  const names = () => body.smallMeshes.map((m) => m.name).sort().join(',');
  ok(names() === 'buckle,eye0,eye1' && body.smallVersion === 3, `listed: the eyes and the buckle, and neither the empties nor a mesh the look hides (${names()})`);
  hideSmallParts(body, true);
  ok(body.smallHidden && eyes.every((e) => !e.visible) && !buckle.visible && torso.visible && shirt.visible && arms.visible && !patch.visible, 'hidden: exactly the small parts go, nothing else is touched');
  // Listed again while hidden (a threshold moved): the hidden parts are listed as what they are, and stay hidden.
  relistSmallParts(body, inner, 1, 4, tune);
  ok(names() === 'buckle,eye0,eye1' && body.smallHidden && eyes.every((e) => !e.visible) && !buckle.visible && body.smallVersion === 4, 'listed again while hidden: the parts it had hidden are listed again, not taken for meshes the look hides, and are hidden again');
  // Listed again with a threshold that leaves the buckle out: the buckle comes back, the eyes stay hidden.
  relistSmallParts(body, inner, 1, 5, { smallTris: 96, smallSize: 0.03 });
  ok(names() === 'eye0,eye1' && buckle.visible && eyes.every((e) => !e.visible), 'a part a moved threshold leaves out is shown again as it leaves the list');
  hideSmallParts(body, false);
  ok(!body.smallHidden && eyes.every((e) => e.visible) && !patch.visible, 'shown again: the small parts come back, and the mesh the look hides stays hidden');
  relistSmallParts(body, null, 1, 6, tune);
  ok(body.smallMeshes.length === 0 && body.smallVersion === 6, 'with no model hung there are none, and the listing is still marked done');
}

// ---- 4. The wiring, read as text. ----
{
  const read = (p: string) => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8');
  const mobile = read('world/mobiles/mobile.ts');
  const attach = mobile.slice(mobile.indexOf('  attach(model: MobileBody'), mobile.indexOf('  private fitArms('));
  ok(/const empties = emptiesOf\(model\);[\s\S]*if \(m\.visible && empties\.has\(m\.geometry\)\) this\.emptyMeshes\.push\(m\);\s*this\.showEmpties\(\);/.test(attach), "a body hangs its empties off by its look's own list (the model asset it is cloned from), on its own record");
  ok(/showEmpties\(\): void \{\s*const on = !CROWD_SWITCHES\.emptyMeshes;\s*for \(let i = 0; i < this\.emptyMeshes\.length; i\+\+\) this\.emptyMeshes\[i\]\.visible = on;/.test(mobile), "and the switch turns exactly those back on and off, nothing else");
  ok(/empties\?: Set<THREE\.BufferGeometry>;/.test(mobile), 'the list lives on the look\'s record type (`MobileBody.empties`)');
  const manager = read('world/mobiles/manager.ts');
  ok(/if \(m\.smallVersion !== CROWD_PARTS\.version\) m\.listSmallParts\(CROWD_PARTS\.version\);\s*const hide = smallPartsHidden\(m\.smallHidden, held\.crowd\.share, m\.engaged, CROWD_SWITCHES\.smallParts\);\s*if \(hide !== m\.smallHidden\) m\.setSmallHidden\(hide\);/.test(manager), "the manager lists a body's small parts again whenever a threshold moved, hides them by the band's rule, engaged or not, switch or not, and hands the body the answer");
  ok(/setSmallHidden\(hidden: boolean\): void \{\s*hideSmallParts\(this, hidden\);\s*\}/.test(mobile) && /listSmallParts\(version: number\): void \{\s*relistSmallParts\(this, this\.model \? this\.inner : null, this\.scale, version\);\s*\}/.test(mobile), "and a body's own two calls are the rules above, handed its inner group (none before its model is hung) and its scale");
  // The tiers' crowd inputs: the manager hands each body to `crowdInput` and its answer to `lodTier`, nothing between.
  ok(/crowdInput\(i, m, held\.crowd, this\.crowdView\);\s*return lodTier\(i, tune, out\);/.test(manager), "the manager fills each body's crowd inputs through `crowdInput` (the share, the fight, the server's keeping, standing still) and hands them straight to the tiers");
  ok(/crowd: new CrowdRecord\(\),/.test(manager) && /private readonly crowdView = new CrowdView\(\);/.test(manager) && /readonly crowd: CrowdRecord;/.test(manager), "and its record of each body and its view are the crowd's own classes, whose number fields the frame writes in place (`perf.test.ts` measures them), never fields of the manager's literal");
  ok(/view\.now = ctx\.now;/.test(manager) && /view\.shareK = shareScale\(persp\.fov, persp\.zoom\);/.test(manager) && /if \(!persp \|\| !persp\.isPerspectiveCamera\) view\.shareK = 0;/.test(manager), "and the view it hands them is this frame's: the world's clock, and the camera's share scale (nought with no perspective camera)");
  ok(/get keptForServer\(\): boolean \{\s*return !this\.driven && this\.sharedLive;\s*\}/.test(mobile), 'a body is kept for a server while one holds the world and this browser is not driven from another');
  ok(/applyEmpties\(\): void \{\s*for \(const m of this\.live\) m\.showEmpties\(\);/.test(manager) && read('main.ts').includes('this.world.mobiles?.applyEmpties();'), 'and the empties switch reaches every body at once');
  ok((mobile.match(/this\.smallVersion = -1;/g) ?? []).length === 2, 'a weapon going into a hand or out of it has the small parts listed again');
}

console.log(`\n${checks} checks passed`);
