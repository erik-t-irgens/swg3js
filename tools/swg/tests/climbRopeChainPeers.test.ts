// The rope chain round, maker B, item 4: another player hanging on a rope. Their state already carries a hanging rope as a held rope
// whose anchor comes twice (phase 4, `PeerRope.hung`), and their figure is drawn here with its hands where their game put them; a
// rope of this browser's own hanging from that anchor bends to those hands, and hangs free otherwise. Nothing new is sent.
// Run through the real watcher of other players' ropes (src/net/remoteRopes.ts, its two imports served from stubs as remoteRopes.test
// serves them), the real chains (src/player/ropeChain.ts) and the real strip (`drawChained`), at 30, 60, 144 and 240 frames a second:
//  - a peer hanging on it: the chain is pinned at their hands' middle (who pins it: them), its drawn line passes through each of their
//    two hands to the bit and the strip's rings there within a centimetre, every frame as their hands climb and swing; their own
//    straight line to the anchor is not drawn here; the tail below their hands hangs and moves after them;
//  - a peer whose anchor is not a rope here: nothing taken, their line drawn as before, the rope here free;
//  - the body holding the rope here: its hands win, the peer's line drawn as before;
//  - with the round's switches at their other setting ('straight'): nothing taken, their line drawn as phase 4 drew it;
//  - a frame the game hands no peers (as `__debug.advance`'s): the rope hangs free; a peer letting go: the rope free again, its tail
//    swinging on with the speed the pin gave it.
//
// Run: node tools/swg/tests/climbRopeChainPeers.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import * as THREE from 'three';

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
const { newPeerRope, readPeerRope } = await import('../../../src/net/peerRope.ts');
const { climbRopeLookBefore, resetClimbTune } = await import('../../../src/anim/climbTune.ts');
const { HangingRope } = await import('../../../src/player/hangingRope.ts');
const { PEER_ANCHOR_NEAR, PIN_BODY, PIN_NONE, PIN_PEER, RopeChains } = await import('../../../src/player/ropeChain.ts');
const { RopeCurve } = await import('../../../src/player/ropeCurve.ts');
const { ChainRibbon, drawChained } = await import('../../../src/player/ropeChainDraw.ts');
const { FIXED_DT } = await import('../../../src/core/physics.ts');
remoteRopes.dispose();

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
camera.position.set(6, 6, 0);

/** A peer: a figure with the left hand the hook's watcher reads and the four joints a hanging rope's grip is read by. */
function makePeer(id: number) {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  scene.add(group);
  const root = new THREE.Group();
  group.add(root);
  const joints: Record<string, THREE.Object3D> = {};
  for (const n of ['lWrist', 'lIndex01', 'rWrist', 'rIndex01']) {
    joints[n] = new THREE.Group();
    root.add(joints[n]);
  }
  const rig = {
    root,
    boneFor: (role: string) => (role === 'leftHand' ? joints.lWrist : null),
    aimArm: () => {},
    boneNamed: (name: string) => joints[name] ?? null,
  };
  const view = { id, shown: true, down: false, group, rig, rope: newPeerRope() };
  return { scene, group, joints, view };
}

/** Their two hands about `x, y, z` (the left a little higher and to one side), each wrist 4 cm over its index knuckle. */
function handsAt(p: ReturnType<typeof makePeer>, x: number, y: number, z: number): void {
  p.joints.lWrist.position.set(x + 0.03, y + 0.06, z);
  p.joints.lIndex01.position.set(x + 0.03, y + 0.02, z);
  p.joints.rWrist.position.set(x - 0.03, y - 0.1, z);
  p.joints.rIndex01.position.set(x - 0.03, y - 0.14, z);
  p.scene.updateMatrixWorld(true);
}

const handMid = (p: ReturnType<typeof makePeer>, a: string, b: string) => {
  const u = p.joints[a].getWorldPosition(new THREE.Vector3());
  const v = p.joints[b].getWorldPosition(new THREE.Vector3());
  return u.add(v).multiplyScalar(0.5);
};

/** One frame as the game runs it: the peers moved, their hangs handed to the chains, the chains stepped and the strip laid, the peers' ropes laid. */
class Frame {
  readonly ropes = new RemoteRopes();
  readonly C = new RopeChains();
  readonly curve = new RopeCurve();
  readonly strip = new ChainRibbon();
  acc = 0;
  constructor(readonlyRope: InstanceType<typeof HangingRope>) {
    this.rope = readonlyRope;
  }
  rope: InstanceType<typeof HangingRope>;
  step(dt: number, peers: { view: unknown }[], give = true): void {
    this.ropes.tick(dt);
    for (const p of peers) this.ropes.peerMoved(p.view as never);
    // (The player's update: the steps the frame's physics step takes; the free rope swung.)
    this.acc += dt;
    let n = 0;
    while (this.acc >= FIXED_DT - 1e-12) {
      this.acc -= FIXED_DT;
      n++;
    }
    this.C.steps = n;
    this.C.behind = this.acc;
    if (give) this.ropes.hungInto(this.C.peers);
    this.C.frame([this.rope]);
    if (!drawChained(this.rope, this.strip, this.curve, camera, 1080)) this.strip.hide();
    this.ropes.draw(camera, 1080, 0);
  }
}

const peerLine = (p: ReturnType<typeof makePeer>) => p.scene.children.find((o) => o.name === 'grapple rope') as THREE.Mesh | undefined;
const AX = 0;
const AY = 10;
const AZ = 0;
const hung = (p: ReturnType<typeof makePeer>, ax = AX, ay = AY, az = AZ) => readPeerRope([1, 0, ax, ay, az, ax, ay, az], undefined, 0, p.view.rope);

for (const fps of [30, 60, 144, 240]) {
  resetClimbTune();
  const r = new HangingRope('peer rope', AX, AY, AZ, 8);
  r.lay();
  const F = new Frame(r);
  const a = makePeer(7);
  F.ropes.peerAdded(a.view as never);
  hung(a);
  ok(a.view.rope.hung, `${fps}: their state marks a hanging rope (its anchor twice)`);
  // Their hands 3 m down the rope, climbing up a metre and swinging out a metre over 4 s.
  let handMiss = 0;
  let ringWorst = 0;
  let lineShown = 0;
  let pinned = 0;
  let tailMoved = 0;
  const n = Math.round(4 * fps);
  let tail0 = 0;
  for (let k = 0; k < n; k++) {
    const t = k / fps;
    const sx = Math.sin(t * 1.4) * Math.min(1, t / 2);
    handsAt(a, sx, AY - 3 + t * 0.25, 0);
    F.step(1 / fps, [a]);
    const c = r.chain!;
    if (c.pinOn && c.pinWho === PIN_PEER) pinned++;
    const ha = handMid(a, 'lWrist', 'lIndex01');
    const hb = handMid(a, 'rWrist', 'rIndex01');
    const da = Math.hypot(c.draw[3 * c.gripA] - ha.x, c.draw[3 * c.gripA + 1] - ha.y, c.draw[3 * c.gripA + 2] - ha.z);
    const db = Math.hypot(c.draw[3 * c.gripB] - hb.x, c.draw[3 * c.gripB + 1] - hb.y, c.draw[3 * c.gripB + 2] - hb.z);
    if (!(da === 0 && db === 0)) handMiss++;
    const pos = F.strip.mesh.geometry.getAttribute('position').array as Float32Array;
    const ring = (i: number) => new THREE.Vector3((pos[6 * i] + pos[6 * i + 3]) / 2, (pos[6 * i + 1] + pos[6 * i + 4]) / 2, (pos[6 * i + 2] + pos[6 * i + 5]) / 2);
    ringWorst = Math.max(ringWorst, ring(F.curve.gripA).distanceTo(ha), ring(F.curve.gripB).distanceTo(hb));
    if (peerLine(a)?.visible) lineShown++;
    const e = c.n - 1;
    if (k === Math.round(fps)) tail0 = c.px[e];
    if (k > fps && Math.abs(c.px[e] - tail0) > 0.05) tailMoved++;
  }
  ok(pinned === n, `${fps}: a peer hanging on a rope here pins its chain at their hands (who pins it: them) every frame (${pinned} of ${n})`);
  ok(handMiss === 0, `${fps}: ... its drawn line passes through each of their two hands to the bit every frame as they climb and swing`);
  ok(ringWorst < 0.01, `${fps}: ... the strip's rings there within a centimetre (worst ${(ringWorst * 1000).toFixed(3)} mm)`);
  ok(lineShown === 0, `${fps}: ... and their own straight line to the anchor is not drawn here (${lineShown} frames)`);
  ok(tailMoved > fps, `${fps}: ... the tail below their hands moving after them (${tailMoved} frames off where it hung)`);
  ok((F.C.report([r]) as { ropes: { by: string }[] }).ropes[0].by === 'player 7', "the console says who pins it");
  // A frame with no peers handed (as `__debug.advance`'s): the rope hangs free.
  F.step(1 / fps, [a], false);
  ok(r.chain!.pinWho === PIN_NONE && !r.chain!.pinOn, `${fps}: a frame the game hands no peers leaves the rope free`);
  F.step(1 / fps, [a]);
  ok(r.chain!.pinWho === PIN_PEER, `${fps}: ... and the next that does pins it again`);
  // They let go: the rope free again, its tail swinging on.
  readPeerRope(undefined, undefined, 0, a.view.rope);
  const before = r.chain!.px[r.chain!.n - 1];
  let moved = 0;
  for (let k = 0; k < fps; k++) {
    F.step(1 / fps, [a]);
    if (Math.abs(r.chain!.px[r.chain!.n - 1] - before) > 0.01) moved++;
  }
  ok(r.chain!.pinWho === PIN_NONE && moved > 0, `${fps}: a peer letting go leaves the rope free, its tail swinging on (${moved} frames off where it was let go)`);
  F.ropes.dispose();
}

// A peer whose anchor is not a rope here; the body holding the rope here; and the round's other setting.
{
  resetClimbTune();
  const r = new HangingRope('peer rope', AX, AY, AZ, 8);
  r.lay();
  const F = new Frame(r);
  const a = makePeer(3);
  F.ropes.peerAdded(a.view as never);
  hung(a, AX + 4 * PEER_ANCHOR_NEAR, AY, AZ);
  handsAt(a, 0.2, AY - 3, 0);
  for (let k = 0; k < 30; k++) F.step(1 / 60, [a]);
  ok(r.chain!.pinWho === PIN_NONE && peerLine(a)?.visible === true && !F.C.peers.drawnFor(3), `a peer whose anchor stands ${4 * PEER_ANCHOR_NEAR} m from this rope's is not taken: the rope free, their line drawn as before`);
  hung(a);
  for (let k = 0; k < 30; k++) F.step(1 / 60, [a]);
  ok(r.chain!.pinWho === PIN_PEER && peerLine(a)?.visible === false, '... and one within the wire\'s centimetre of it is');
  r.held = true;
  r.gripS = 2;
  for (let k = 0; k < 30; k++) F.step(1 / 60, [a]);
  ok(r.chain!.pinWho === PIN_BODY && peerLine(a)?.visible === true && !F.C.peers.drawnFor(3), 'the body holding the rope here wins: its hands pin it, the peer\'s line drawn as before');
  r.held = false;
  climbRopeLookBefore();
  for (let k = 0; k < 30; k++) F.step(1 / 60, [a]);
  ok(!r.chain!.live && peerLine(a)?.visible === true && !F.C.peers.drawnFor(3) && !F.strip.mesh.visible, "with the round's switches at their other setting nothing is taken: no chain, no strip, the peer's line drawn as phase 4 drew it");
  F.ropes.dispose();
}

// What only the game hands over, as text (a working copy may be CRLF).
{
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
  const main = read('../../../src/main.ts');
  const remote = read('../../../src/net/remoteRopes.ts');
  const hand = main.indexOf('remoteRopes.hungInto(player.ropeChains.peers);');
  const ropes = main.search(/(?<!\.)player\.drawRopes\(this\.cam\.camera, window\.innerHeight\);/);
  const peerDraw = main.indexOf('remoteRopes.draw(this.cam.camera, window.innerHeight, tFrame);');
  ok(main.split('remoteRopes.hungInto(').length === 2 && hand >= 0 && hand < ropes && ropes < peerDraw && ropes - hand < 600, "the frame loop hands the peers' hangs to the chains once, just before it lays the ropes and before the peers' ropes are laid");
  ok(/if \(r\.hung && this\.hangs !== null && this\.hangs\.drawnFor\(r\.id\)\) \{\n\s*this\.hide\(r\);\n\s*return;\n\s*\}/.test(remote), "the watcher of other players' ropes draws no line of theirs for a peer whose rope here is drawn bent to their hands");
  ok(/for \(const n of \['lWrist', 'lIndex01', 'rWrist', 'rIndex01'\]\)/.test(readFileSync(new URL(import.meta.url), 'utf8')) && ["rig.boneNamed('lWrist')", "rig.boneNamed('lIndex01')", "rig.boneNamed('rWrist')", "rig.boneNamed('rIndex01')"].every((s) => remote.includes(s)), "... reading their hands off the joints the player's own grip is read by");
}

resetClimbTune();
console.log(`climbRopeChainPeers: ${checks} checks passed`);
