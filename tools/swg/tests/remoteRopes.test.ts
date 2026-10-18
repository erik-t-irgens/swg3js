// Another player's grappling hook, drawn on this side (src/net/remoteRopes.ts, the design's §3.15, wave 4), checked
// without a browser: a rope drawn from their drawn left hand and hung by the slack they sent, straight inside the taut
// band; a dart in flight flown on at most `peerLead` past its state and stopped where it struck; nothing drawn while
// they are hidden or down; a peer's renderers handed to the next peer rather than built again; a point riding a third
// player's moving vehicle put on this browser's own picture of it, where the world point alone stands metres off (the
// fault the field exists for, measured as research5 measured it); on the rider's own side the same point on their real
// vehicle; the world points glided at the figure's own rate and snapped on the first state and on a change of count;
// their arm raised up the line; their fire, bite and let-go heard; and nothing allocated frame after frame.
// Synthetic peers and pictures only; nothing is read from the game's files.
//
// Run: node --expose-gc tools/swg/tests/remoteRopes.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import v8 from 'node:v8';
import * as THREE from 'three';

// The portal renderer and the peers' own module carry parameter properties, which node's type stripping refuses; the
// ropes take only `markActor` from the one and `watchPeers` from the other, so both are served from stubs.
const portalSrc = readFileSync(new URL('../../../src/world/portalRender.ts', import.meta.url), 'utf8');
const ACTOR_LAYER = Number(/export const ACTOR_LAYER = (\d+);/.exec(portalSrc)?.[1]);
const stub = `export const ACTOR_LAYER = ${ACTOR_LAYER}; export function markActor(o) { o.traverse((x) => x.layers.enable(${ACTOR_LAYER})); }`;
const peersStub = 'export const listeners = []; export function watchPeers(w) { listeners.push(w); return () => { const i = listeners.indexOf(w); if (i >= 0) listeners.splice(i, 1); }; }';
const hook = `export async function resolve(s, c, next) {
  if (s.endsWith('/portalRender.ts') || s.endsWith('/portalRender')) return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(stub)}), shortCircuit: true };
  if (s.endsWith('/remotePlayers.ts') || s.endsWith('/remotePlayers')) return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(peersStub)}), shortCircuit: true };
  return next(s, c);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { RemoteRopes, remoteRopes } = await import('../../../src/net/remoteRopes.ts');
const { PEER_ROPE_TUNE, newPeerRope, readPeerRope } = await import('../../../src/net/peerRope.ts');
const { GRAPPLE_TUNE } = await import('../../../src/player/grapple.ts');
const { PEER_GLIDE } = await import('../../../src/player/grappleFrames.ts');
const peersModule = (await import('../../../src/net/remotePlayers.ts')) as unknown as { listeners: unknown[] };

let passed = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
};

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
camera.position.set(0, 2, 20);

/** A peer: a figure in a scene with a left hand and a left arm, and a rig that records how its arm was aimed. */
function makePeer(id: number, at = new THREE.Vector3(0, 0, 0)) {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.position.copy(at);
  scene.add(group);
  const root = new THREE.Group();
  group.add(root);
  const leftHand = new THREE.Group();
  leftHand.position.set(-0.3, 1.3, 0.1);
  root.add(leftHand);
  // Every aim kept while `keepAims` is set; with it off only the last weight, so the allocation check measures the ropes.
  const aims: { dir: THREE.Vector3; weight: number }[] = [];
  const last = { weight: 0, calls: 0, keepAims: true };
  const rig = {
    root,
    boneFor: (role: string) => (role === 'leftHand' ? leftHand : null),
    aimArm: (_side: string, dir: THREE.Vector3, _roll = 0, weight = 1) => {
      last.weight = weight;
      last.calls++;
      if (last.keepAims) aims.push({ dir: dir.clone(), weight });
    },
  };
  const view = { id, shown: true, down: false, group, rig, rope: newPeerRope() };
  return { scene, group, leftHand, rig, aims, last, view };
}

const meshesOf = (scene: THREE.Scene) => ({
  ribbon: scene.children.find((o) => o.name === 'grapple rope') as THREE.Mesh | undefined,
  dart: scene.children.find((o) => o.name === 'grapple dart') as THREE.Mesh | undefined,
});

/** The ring centres a ribbon was laid through this frame, from its vertex pairs. */
function rings(ribbon: THREE.Mesh): THREE.Vector3[] {
  const pos = ribbon.geometry.getAttribute('position').array as Float32Array;
  const n = ribbon.geometry.drawRange.count / 6 + 1;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) out.push(new THREE.Vector3((pos[6 * i] + pos[6 * i + 3]) / 2, (pos[6 * i + 1] + pos[6 * i + 4]) / 2, (pos[6 * i + 2] + pos[6 * i + 5]) / 2));
  return out;
}

/** One frame as the game runs it: the step told, the peer moved, the ropes laid. Walked by index: a frame makes nothing. */
function frame(ropes: InstanceType<typeof RemoteRopes>, views: readonly { view: unknown }[], dt: number, now: number): void {
  ropes.tick(dt);
  for (let i = 0; i < views.length; i++) ropes.peerMoved(views[i].view as never);
  ropes.draw(camera, 1080, now);
}

// ---- 0. It listens to the peers by itself ----
ok(peersModule.listeners.includes(remoteRopes), 'the one set for the page listens to the peers the moment the file is imported, with nothing to wire up');
remoteRopes.dispose();
// The hook's tune is one key short of the 128 at which the engine makes an object literal with every key out of the
// object, after which the hook's frame boxed what it read off it (grapple.test's own-code measure: 4.2 B a frame where it
// makes 0.09). The watcher's number is a table of its own for that reason, and a key added to the hook's must go elsewhere.
ok(Object.keys(GRAPPLE_TUNE).length < 128 && !Object.hasOwn(GRAPPLE_TUNE, 'peerLead'), `the hook's tune stays under 128 keys (${Object.keys(GRAPPLE_TUNE).length}), the watcher's lead kept in its own table`);

// ---- 1. A rope from the drawn left hand, hung by the slack sent ----
{
  const a = makePeer(1);
  const ropes = new RemoteRopes();
  ropes.peerAdded(a.view as never);
  a.scene.updateMatrixWorld(true);
  readPeerRope([1, 0.05, 3, 12, -2, 1, 6, -1], undefined, 0, a.view.rope);
  frame(ropes, [a], 1 / 60, 0);
  const { ribbon, dart } = meshesOf(a.scene);
  ok(!!ribbon && ribbon.visible && !!dart && dart.visible, 'a peer holding a rope has a ribbon and a dart in the scene their figure is in');
  const r = rings(ribbon!);
  const hand = a.leftHand.getWorldPosition(new THREE.Vector3());
  ok(r[0].distanceTo(new THREE.Vector3(3, 12, -2)) < 1e-4, 'the ribbon starts at the anchor sent');
  ok(r[r.length - 1].distanceTo(hand) < 1e-4, `and ends at their drawn left hand, not at a place the message put (${r[r.length - 1].toArray().map((n) => n.toFixed(2))})`);
  ok(r.length === 3, `inside the taut band the free span is drawn straight: anchor, bend, hand (${r.length} rings)`);
  ok(dart!.position.distanceTo(new THREE.Vector3(3, 12, -2)) < 1e-9, 'and the dart is bitten in at the anchor');
  readPeerRope([1, 2, 3, 12, -2, 1, 6, -1], undefined, 100, a.view.rope);
  frame(ropes, [a], 1 / 60, 100);
  ok(rings(ribbon!).length === 2 + GRAPPLE_TUNE.sagSegments, `past the taut band the free span sags by the slack sent, in ${GRAPPLE_TUNE.sagSegments} pieces`);
  // The arm: aimed up the line, by an eased weight.
  ok(a.aims.length > 0 && a.aims[a.aims.length - 1].weight > a.aims[0].weight, `the left arm is raised up the line by a weight that eases in (${a.aims[0].weight.toFixed(2)} then ${a.aims[a.aims.length - 1].weight.toFixed(2)})`);
  ropes.dispose();
}

// ---- 1b. A world anchor and a bend riding a vehicle, on a turned figure: each point by its own index, the arm up the line ----
//
// The figure and its rig's root are both turned, so the arm's direction is taken into the figure's own frame through
// both turns or it points somewhere else; the vehicle the bend rides stands apart from where the world point says, so a
// bend put on it by its place in the list rather than its index would land on the anchor.
{
  const a = makePeer(1);
  a.group.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  a.rig.root.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.3);
  a.scene.updateMatrixWorld(true);
  const ropes = new RemoteRopes();
  const pose = { pos: new THREE.Vector3(6, 4, 1), quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5) };
  ropes.framePose = (id, pos, quat) => {
    if (id !== 7) return false;
    pos.copy(pose.pos);
    quat.copy(pose.quat);
    return true;
  };
  ropes.peerAdded(a.view as never);
  const bendLocal = new THREE.Vector3(0.5, 1, -0.3);
  const bendOn = bendLocal.clone().applyQuaternion(pose.quat).add(pose.pos);
  // The world point sent for the bend is the sender's own picture of the vehicle, half a metre off this one.
  readPeerRope([1, 0, 3, 15, 2, bendOn.x + 0.5, bendOn.y, bendOn.z - 0.5], [1, 7, 1, bendLocal.x, bendLocal.y, bendLocal.z], 0, a.view.rope);
  frame(ropes, [a], 1 / 60, 0);
  const r = rings(meshesOf(a.scene).ribbon!);
  ok(r.length === 3 && r[0].distanceTo(new THREE.Vector3(3, 15, 2)) < 1e-4, `the anchor, sent as a world point with no frame, stays at it (${r[0].toArray().map((n) => n.toFixed(2))})`);
  ok(r[1].distanceTo(bendOn) < 1e-4, `and the bend its frame names by index 1 is put on this browser's own vehicle, not on the anchor nor where the world point said (${r[1].distanceTo(bendOn).toExponential(1)} m off it)`);
  // The arm: the direction it was handed, turned back out of the figure's frame by the figure's turn and its root's,
  // points from their rope point to the rope's point nearest them (the bend), not to the anchor.
  const last = a.aims[a.aims.length - 1];
  const back = last.dir.clone().applyQuaternion(a.group.quaternion.clone().multiply(a.rig.root.quaternion)).normalize();
  const ropePoint = new THREE.Vector3(0, GRAPPLE_TUNE.ropeY, 0).applyQuaternion(a.group.quaternion).add(a.group.position);
  const want = bendOn.clone().sub(ropePoint).normalize();
  const toAnchor = new THREE.Vector3(3, 15, 2).sub(ropePoint).normalize();
  ok(back.dot(want) > 0.9999 && back.dot(toAnchor) < 0.99, `the left arm points up the line at the bend nearest them, through the figure's own turn and its rig's (${THREE.MathUtils.radToDeg(Math.acos(Math.min(1, back.dot(want)))).toFixed(3)} degrees off)`);
  ropes.dispose();
}

// ---- 1c. What the reader passes over ----
{
  const rope = newPeerRope();
  ok(!readPeerRope([1, 0, 3, Number.NaN, 2], undefined, 0, rope) && rope.kind === -1, 'a rope with a number that is not one is no rope at all');
  ok(!readPeerRope([2, 0, 3, 1, 2], undefined, 0, rope) && rope.kind === -1, 'nor is a kind this browser does not know');
  ok(!readPeerRope([1, 0, 3, 1, 2, 4], undefined, 0, rope) && rope.kind === -1, 'nor a held rope whose points do not come in threes');
  const two = [1, 0, 3, 1, 2, 5, 1, 2];
  const entries: [string, number[]][] = [
    ['a frame kind this browser does not know', [2, 7, 0, 0, 0, 0]],
    ['an index at the count of points', [1, 7, 2, 0, 0, 0]],
    ['an index past it', [1, 7, 9, 0, 0, 0]],
    ['a negative index', [1, 7, -1, 0, 0, 0]],
    ['an index that is not whole', [1, 7, 0.5, 0, 0, 0]],
    ['a relay id of nought', [1, 0, 0, 0, 0, 0]],
    ['a place that is not a number', [1, 7, 0, 0, Number.POSITIVE_INFINITY, 0]],
  ];
  for (const [what, grf] of entries) {
    ok(readPeerRope(two, grf, 0, rope) && rope.kind === 1 && rope.count === 2 && rope.frames === 0, `a frame entry with ${what} is passed over on its own, the rope standing`);
  }
  ok(readPeerRope(two, [1, 7, 1, 0.1, 0.2, 0.3, 1, 9, 1, 4, 5, 6, 1, 8, 0, 7, 8, 9], 0, rope) && rope.frames === 2 && rope.frameIndex[0] === 1 && rope.frameId[0] === 7 && rope.frameIndex[1] === 0 && rope.frameId[1] === 8, 'an index named twice keeps its first entry and passes over the second, the others standing');
  ok(readPeerRope(two, [1, 7, 1, 0, 0], 0, rope) && rope.frames === 0, 'and a frame list whose entries do not come in sixes is passed over whole');
}

// ---- 2. The dart in flight: at most `peerLead` past its state, stopped where it struck ----
{
  const a = makePeer(1);
  const ropes = new RemoteRopes();
  ropes.peerAdded(a.view as never);
  a.scene.updateMatrixWorld(true);
  readPeerRope([0, 0, 2, 0, 0, 0, -100], undefined, 1000, a.view.rope);
  frame(ropes, [a], 1 / 60, 1050);
  const { dart } = meshesOf(a.scene);
  ok(Math.abs(dart!.position.z - -5) < 1e-6, `50 ms after its state the dart is 50 ms further along (${dart!.position.z.toFixed(3)})`);
  frame(ropes, [a], 1 / 60, 3000);
  ok(Math.abs(dart!.position.z - -100 * PEER_ROPE_TUNE.peerLead) < 1e-6, `two seconds after it, it is held to ${PEER_ROPE_TUNE.peerLead} s past it (${dart!.position.z.toFixed(2)})`);
  ropes.cast = (s) => void (s[6] = Math.hypot(s[3] - s[0], s[4] - s[1], s[5] - s[2]) > 4 ? 4 : Infinity);
  frame(ropes, [a], 1 / 60, 3000);
  ok(Math.abs(dart!.position.z - -4) < 1e-6, 'and a ray in this world that meets something 4 m on stops it there');
  ok(dart!.getWorldDirection(new THREE.Vector3()).z < -0.99, 'flying point first along the way it goes');
  ropes.dispose();
}

// ---- 3. Hidden, down, gone ----
{
  const a = makePeer(1);
  const ropes = new RemoteRopes();
  ropes.peerAdded(a.view as never);
  readPeerRope([1, 0, 3, 12, -2], undefined, 0, a.view.rope);
  frame(ropes, [a], 1 / 60, 0);
  const { ribbon, dart } = meshesOf(a.scene);
  ok(ribbon!.visible, 'shown, the rope is drawn');
  a.view.shown = false;
  frame(ropes, [a], 1 / 60, 0);
  ok(!ribbon!.visible && !dart!.visible, 'hidden (another world, a jump, not yet heard), nothing of it is drawn');
  a.view.shown = true;
  a.view.down = true;
  frame(ropes, [a], 1 / 60, 0);
  ok(!ribbon!.visible && !dart!.visible, 'and down, nothing of it is drawn');
  a.view.down = false;
  frame(ropes, [a], 1 / 60, 0);
  ok(ribbon!.visible, 'up again, it is');
  readPeerRope(undefined, undefined, 0, a.view.rope);
  frame(ropes, [a], 1 / 60, 0);
  ok(!ribbon!.visible && !dart!.visible, 'and a state with no rope takes it away');
  ropes.dispose();
}

// ---- 4. A renderer handed on ----
{
  const ropes = new RemoteRopes();
  const a = makePeer(1);
  ropes.peerAdded(a.view as never);
  readPeerRope([1, 0, 3, 12, -2], undefined, 0, a.view.rope);
  frame(ropes, [a], 1 / 60, 0);
  ok(ropes.report().made === 1, 'the first peer to rope makes one ribbon');
  ropes.peerRemoved(1);
  ok(!meshesOf(a.scene).ribbon && ropes.report().spare === 1, 'a peer who leaves takes theirs out of the scene and keeps it for the next');
  const b = makePeer(2);
  ropes.peerAdded(b.view as never);
  readPeerRope([1, 0, 1, 1, 1], undefined, 0, b.view.rope);
  frame(ropes, [b], 1 / 60, 0);
  ok(ropes.report().made === 1 && !!meshesOf(b.scene).ribbon?.visible, 'and the next to rope is handed it rather than having one made');
  ropes.dispose();
}

// ---- 5. Gliding: the figure's own rate, snapped on the first state and on a change of count ----
{
  const a = makePeer(1);
  const ropes = new RemoteRopes();
  ropes.peerAdded(a.view as never);
  readPeerRope([1, 0, 0, 10, 0], undefined, 0, a.view.rope);
  frame(ropes, [a], 1 / 60, 0);
  const { dart } = meshesOf(a.scene);
  ok(dart!.position.distanceTo(new THREE.Vector3(0, 10, 0)) < 1e-9, 'the first state is snapped, not glided in from nowhere');
  readPeerRope([1, 0, 2, 10, 0], undefined, 100, a.view.rope);
  const dt = 1 / 60;
  frame(ropes, [a], dt, 100);
  const k = 1 - Math.exp(-dt / PEER_GLIDE);
  ok(Math.abs(dart!.position.x - 2 * k) < 1e-9, `a moved world point is glided at the figure's own rate (${dart!.position.x.toFixed(4)} = 2 x ${k.toFixed(4)})`);
  readPeerRope([1, 0, 4, 10, 0, 1, 5, 0], undefined, 200, a.view.rope);
  frame(ropes, [a], dt, 200);
  ok(dart!.position.distanceTo(new THREE.Vector3(4, 10, 0)) < 1e-9, 'and a bend coming, which changes the count of points, snaps them all');
  ropes.dispose();
}

// ---- 6. A point riding a third player's moving vehicle ----
//
// Player C rides a speeder, B's anchor is on it, and this browser (A) watches. C sends where it is every 100 ms; B and
// A each glide a picture of it toward that at the figure's own rate; B sends its rope every 100 ms at its own phase,
// the anchor's world point worked out from B's picture and, beside it, the anchor's place in C's own frame. A draws
// the anchor; what is measured is how far it stands from where A draws that point of C's speeder.
{
  const local = new THREE.Vector3(0, 0.6, 1.5);
  function run(speed: number, withFrames: boolean): number {
    const ropes = new RemoteRopes();
    const a = makePeer(2);
    ropes.peerAdded(a.view as never);
    const picA = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), tp: new THREE.Vector3() };
    const picB = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), tp: new THREE.Vector3() };
    ropes.framePose = (id, pos, quat) => {
      if (id !== 7) return false;
      pos.copy(picA.position);
      quat.copy(picA.quaternion);
      return true;
    };
    const dt = 1 / 60;
    const k = 1 - Math.exp(-dt / 0.1);
    let lastC = -1;
    let lastB = -1;
    let worst = 0;
    const w = new THREE.Vector3();
    for (let i = 0; i * dt < 20; i++) {
      const t = i * dt;
      const c = Math.floor(t / 0.1);
      if (c !== lastC) {
        lastC = c;
        picA.tp.set(speed * c * 0.1, 0, 0);
        picB.tp.set(speed * c * 0.1, 0, 0);
      }
      const bs = Math.floor((t - 0.037) / 0.1);
      if (t > 0.037 && bs !== lastB) {
        lastB = bs;
        w.copy(local).applyQuaternion(picB.quaternion).add(picB.position);
        readPeerRope([1, 0, w.x, w.y, w.z], withFrames ? [1, 7, 0, local.x, local.y, local.z] : undefined, t * 1000, a.view.rope);
      }
      picA.position.lerp(picA.tp, k);
      picB.position.lerp(picB.tp, k);
      frame(ropes, [a], dt, t * 1000);
      if (t < 2) continue;
      const drawnHull = local.clone().applyQuaternion(picA.quaternion).add(picA.position);
      worst = Math.max(worst, meshesOf(a.scene).dart!.position.distanceTo(drawnHull));
    }
    ropes.dispose();
    return worst;
  }
  for (const [speed, least] of [
    [10, 1],
    [20, 2],
    [40, 4],
  ] as const) {
    const off = run(speed, false);
    const on = run(speed, true);
    ok(off > least, `at ${speed} m/s the world point alone stands up to ${off.toFixed(2)} m off the hull this browser draws, which is the fault the frames are for`);
    ok(on < 0.001, `and with the point put on this browser's own picture of the vehicle it is on the hull to within a millimetre (${(on * 1000).toFixed(3)} mm)`);
  }
  // On the rider's own browser the vehicle is not a picture: `framePose` answers their real vehicle.
  const ropes = new RemoteRopes();
  const a = makePeer(2);
  ropes.peerAdded(a.view as never);
  const real = { pos: new THREE.Vector3(40, 1, -7), quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7) };
  ropes.framePose = (id, pos, quat) => {
    if (id !== 9) return false;
    pos.copy(real.pos);
    quat.copy(real.quat);
    return true;
  };
  readPeerRope([1, 0, 0, 0, 0], [1, 9, 0, local.x, local.y, local.z], 0, a.view.rope);
  frame(ropes, [a], 1 / 60, 0);
  const want = local.clone().applyQuaternion(real.quat).add(real.pos);
  ok(meshesOf(a.scene).dart!.position.distanceTo(want) < 1e-9, 'on the rider\'s own side the point is on their real vehicle, wherever the world point said');
  const rep = ropes.report().ropes[0] as { frames: { shown: boolean; vehicleOf: number }[] };
  ok(rep.frames.length === 1 && rep.frames[0].shown && rep.frames[0].vehicleOf === 9, 'and the console says the entry was put on a vehicle shown here');
  ropes.framePose = () => false;
  frame(ropes, [a], 1 / 60, 0);
  ok(meshesOf(a.scene).dart!.position.length() < 1e-9 && !(ropes.report().ropes[0] as { frames: { shown: boolean }[] }).frames[0].shown, 'a vehicle not shown here leaves the point where the world point put it');
  ropes.dispose();
}

// ---- 7. Heard at their hand ----
{
  const a = makePeer(1);
  const ropes = new RemoteRopes();
  const heard: string[] = [];
  ropes.sound = (what) => void heard.push(what);
  ropes.peerAdded(a.view as never);
  frame(ropes, [a], 1 / 60, 0);
  readPeerRope([0, 0, 2, 0, 0, 0, -100], undefined, 0, a.view.rope);
  frame(ropes, [a], 1 / 60, 0);
  readPeerRope([1, 0, 0, 2, -9], undefined, 100, a.view.rope);
  frame(ropes, [a], 1 / 60, 100);
  readPeerRope(undefined, undefined, 200, a.view.rope);
  frame(ropes, [a], 1 / 60, 200);
  ok(heard.join() === 'fire,bite,letGo', `their dart going out, biting and the rope let go are each heard once (${heard.join(', ')})`);
  const b = makePeer(2);
  readPeerRope([1, 0, 0, 2, -9], undefined, 0, b.view.rope);
  heard.length = 0;
  ropes.peerAdded(b.view as never);
  frame(ropes, [b], 1 / 60, 0);
  ok(heard.length === 0, 'a rope already out when a peer is first shown is not heard as a bite');
  ropes.dispose();
}

// ---- 8. Nothing allocated frame after frame ----
{
  const a = makePeer(1);
  const b = makePeer(2, new THREE.Vector3(5, 0, 0));
  const ropes = new RemoteRopes();
  ropes.peerAdded(a.view as never);
  ropes.peerAdded(b.view as never);
  const pic = { position: new THREE.Vector3(3, 0, 0), quaternion: new THREE.Quaternion() };
  ropes.framePose = (id, pos, quat) => {
    pos.copy(pic.position);
    quat.copy(pic.quaternion);
    return id === 7;
  };
  ropes.cast = (s) => void (s[6] = Infinity);
  readPeerRope([1, 0.5, 3, 12, -2, 1, 6, -1, 0, 3, 0], [1, 7, 0, 0.5, 1, 0], 0, a.view.rope);
  readPeerRope([0, 5, 2, 0, 0, 0, -100], undefined, 0, b.view.rope);
  a.last.keepAims = false;
  b.last.keepAims = false;
  const both = [a, b];
  const dt = 1 / 60;
  // The frame's clock held 50 ms after the dart's state, so the dart is always between two states and its ray is cast.
  // The harness hands the ropes the same two numbers every frame: a number of its own worked out and handed across a
  // call would be a fresh one of the harness's, which is no measure of the ropes (the game's own clock read is one
  // already, made by the read).
  const NOW = 50.5;
  const clock = { t: 0.5 };
  const step = (n: number) => {
    for (let i = 0; i < n; i++) {
      clock.t += dt;
      pic.position.x = 3 + Math.sin(clock.t);
      frame(ropes, both, dt, NOW);
    }
  };
  step(4000);
  const gc = (globalThis as { gc?: (o?: unknown) => void }).gc;
  if (typeof gc === 'function') {
    // The young generation measured over a window, with every collection that ran inside it counted: one that did
    // empties what the window made and reads as nothing, so a window with one is no measure at all and counts as a
    // failure rather than a clean frame. Collections are told a turn or two of the loop after they run, so each window
    // is read only after two turns. The cleanest of three windows, each after a full collection and a few thousand
    // frames to build the code again (a full collection throws away code built round what has since died) and a minor
    // one that empties what they made.
    let scavenges = 0;
    const watch = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
    });
    watch.observe({ entryTypes: ['gc'] });
    const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
    const turns = async () => {
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    };
    const FRAMES = 20000;
    let best = { made: Infinity, scavenges: Infinity };
    for (let attempt = 0; attempt < 3; attempt++) {
      gc();
      await turns();
      step(4000);
      gc({ type: 'minor' });
      await turns();
      scavenges = 0;
      const before = young();
      step(FRAMES);
      const made = young() - before;
      await turns();
      if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges };
      if (best.scavenges === 0 && best.made <= 0) break;
    }
    watch.disconnect();
    const perFrame = best.scavenges > 0 ? Infinity : Math.max(0, best.made) / FRAMES;
    ok(best.scavenges === 0 && perFrame < 1, `two roping peers, one on a moving vehicle and one with a dart in flight, allocate nothing a frame (${perFrame.toFixed(3)} bytes a frame over ${FRAMES} frames, ${best.scavenges} collections in the cleanest window of three)`);
  } else console.log('skip the allocation check (run with --expose-gc to take it)');
  ropes.dispose();
}

console.log(`\n${passed} checks passed`);
