// Another player's lightsaber, checked without a browser: that a lit saber in a peer's hand draws a
// blade from the top of the hilt in the colour they chose, that a double-bladed staff draws the far
// end too, that a saber in the off hand alone is read as the off hand, that a blade thrown is drawn
// where the wire says it is (turned with the hull when they threw it in one) with the hilt out of
// the hand, that a dead peer's blade goes out with them, that the blades join the frame's blade list
// beside the catalogue's people and are kept nearest first, that a pooled light is borrowed only
// when one is standing dark, that a peer who leaves builds nothing and disposes nothing, and that
// nothing at all is allocated frame after frame. The death clip itself is the peers' own file and is
// not checked here. Nothing is written; only counts are printed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import * as THREE from 'three';

// The portal renderer's module carries a parameter property, which node's type stripping refuses;
// the blades take only markActor from it, so it is served from a stub with the real layer number
// read from its source.
const portalSrc = readFileSync(new URL('../../../src/world/portalRender.ts', import.meta.url), 'utf8');
const ACTOR_LAYER = Number(/export const ACTOR_LAYER = (\d+);/.exec(portalSrc)?.[1]);
const stub = `export const ACTOR_LAYER = ${ACTOR_LAYER}; export function markActor(o) { o.traverse((x) => x.layers.enable(${ACTOR_LAYER})); }`;
// The peers' own module carries a parameter property too, and pulls in the loader, the character
// and the page besides; the blades take one thing from it -- the way to listen -- and the test
// speaks to the watcher itself, so it is served from a stub that remembers who listened.
const peersStub = 'export const listeners = []; export function watchPeers(w) { listeners.push(w); return () => { const i = listeners.indexOf(w); if (i >= 0) listeners.splice(i, 1); }; }';
// The weapons rack carries a parameter property as well, and the blades take one thing from it:
// which classes are lightsabers. Rather than copy that rule, the stub is built from the real
// predicate's own source text, so a grip added to the rack later is added to this test with it.
const weaponsSrc = readFileSync(new URL('../../../src/player/weapons.ts', import.meta.url), 'utf8');
const saberRule = /export function isSaber\([^)]*\): boolean \{\s*return ([^;]+);/.exec(weaponsSrc)?.[1];
if (!saberRule) throw new Error('the weapons rack no longer declares isSaber the way this test reads it');
const weaponsStub = `export function isSaber(cls) { return ${saberRule}; }`;
const hook = `export async function resolve(s, c, next) {
  if (s.endsWith('/portalRender.ts') || s.endsWith('/portalRender')) return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(stub)}), shortCircuit: true };
  if (s.endsWith('/remotePlayers.ts') || s.endsWith('/remotePlayers')) return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(peersStub)}), shortCircuit: true };
  if (s.endsWith('/player/weapons.ts') || s.endsWith('/player/weapons')) return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(weaponsStub)}), shortCircuit: true };
  return next(s, c);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { RemoteBlades, PEER_BLADE_TUNE, peerBladesKnob, remoteBlades } = await import('../../../src/net/remoteBlades.ts');
const peersModule = (await import('../../../src/net/remotePlayers.ts')) as unknown as { listeners: unknown[] };
const { SaberBlade } = await import('../../../src/combat/saberBlade.ts');
const { collectBlades } = await import('../../../src/combat/bladeLights.ts');
const { createBladeList } = await import('../../../src/core/fx/bladeList.ts');
const { BLADE_GLOW_MAX } = await import('../../../src/core/fx/bladeGlowMath.ts');

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const dt = 1 / 60;
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
camera.position.set(0, 1.6, 0);

// ---- A peer, as the source hands one over ----

const SABER = { class: 'lightsaber', bounds: { min: [-0.03, -0.14, -0.03], max: [0.03, 0.14, 0.03] }, blade: { length: 1.2, width: 0.1, open: 0.3, close: 0.3 } };
const STAFF = { ...SABER, class: 'lightsaberStaff' };
const RIFLE = { class: 'rifle', bounds: { min: [0, 0, 0], max: [0.1, 0.1, 1] } };

/** A scene with one peer in it: a figure at `x`, with a holder on each hand bone. */
function makePeer(id: number, x: number) {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.position.set(x, 0, -5);
  scene.add(group);
  const rightHand = new THREE.Group();
  rightHand.position.set(0.3, 1.2, 0);
  const leftHand = new THREE.Group();
  leftHand.position.set(-0.3, 1.2, 0);
  group.add(rightHand, leftHand);
  const rightHolder = new THREE.Group();
  const leftHolder = new THREE.Group();
  rightHolder.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.28, 0.05), new THREE.MeshBasicMaterial()));
  leftHolder.add(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.28, 0.05), new THREE.MeshBasicMaterial()));
  rightHand.add(rightHolder);
  leftHand.add(leftHolder);
  const p = {
    id,
    shown: true,
    hands: [{ node: rightHolder, def: SABER, hand: 'right' }] as { node: THREE.Object3D; def: typeof SABER; hand: 'right' | 'left' }[],
    saberColor: 0x22ff44,
    saber: true,
    saberThrown: null as { x: number; y: number; z: number; spin: number } | null,
    down: false,
    hullFrame: null as THREE.Matrix4 | null,
  };
  return { scene, group, rightHolder, leftHolder, p };
}

/**
 * One frame as the game runs it: the peers put every figure where it is drawn and tell their
 * watchers (`peerMoved`), and then the blades are drawn at the point the player's own are.
 */
function frame(blades: InstanceType<typeof RemoteBlades>, peers: { id: number }[], flash: unknown = null, n = 1): void {
  for (let i = 0; i < n; i++) {
    for (const p of peers) blades.peerMoved(p as never);
    blades.draw(dt, camera, flash as never);
  }
}

// ---- 0. It listens to the peers by itself ----
{
  ok(peersModule.listeners.length === 1 && peersModule.listeners[0] === remoteBlades, 'the one set for the page listens to the peers the moment the file is imported, with nothing to wire up');
}

// ---- 1. A lit saber in the hand draws a blade, from the hilt's top, in their colour ----
{
  const a = makePeer(1, 0);
  const blades = new RemoteBlades();
  blades.peerAdded(a.p as never);
  const PEERS = [a.p];
  a.scene.updateMatrixWorld(true);
  frame(blades, PEERS);
  const list = blades.holders(undefined);
  ok(list.length === 1, "one lit saber in a peer's hand is one blade on the list");
  const saber = list[0].saber!;
  ok(saber.group.parent === a.scene, 'the renderer hangs at the top of the tree the peer is in, not under their hand');
  ok(saber.group.layers.isEnabled(ACTOR_LAYER), 'the blade is marked as an actor, so the portal renderer draws it');
  // A tenth of a second of ignition, then the drawn segment is measured.
  frame(blades, PEERS, null, 30);
  ok(saber.ignition > 0.99, 'the blade ignites over its own open time');
  ok(saber.glowing, 'a lit blade in a scene glows, so the glow pass sees it');
  ok(near(saber.drawnBase.x, 0.3, 1e-6) && near(saber.drawnBase.y, 1.2 + 0.14, 1e-6), `the blade leaves the hilt half its own height up (${saber.drawnBase.y.toFixed(3)} m)`);
  ok(near(saber.drawnTip.y - saber.drawnBase.y, 1.2, 1e-5), 'the blade is as long as the rack says');
  ok(saber.color.getHex() === 0x22ff44, 'the blade is the colour their hello gave');
  // The depth of field's glow list: a lit blade at the focus must stay a sharp line.
  const cores: THREE.Object3D[] = [];
  ok(blades.glowCores(cores, 0) === 1 && cores[0].visible, "a lit peer's blade core is in the depth of field's glow list");
  // A change of colour reaches the renderer without making another.
  a.p.saberColor = 0xff2200;
  frame(blades, PEERS);
  ok(saber.color.getHex() === 0xff2200, 'a colour changed in play reaches the blade already out');
  ok((blades.debug().renderersMade as number) === 1, 'a colour change makes no second renderer');
  blades.dispose();
}

// ---- 2. Nothing is built that three does not already hold ----
{
  // A peer's blade is a SaberBlade like the player's, so what three keys a program on -- the two
  // shader sources, the blending, the side, the depth write and the tone mapping -- must be equal
  // between two of them, or a peer's first blade would compile on a live frame. (Three keys a
  // shader stage on its source text, and the player's own blade groups are in the scene from the
  // start with their ribbons hidden, so that program is built behind the loading screen.)
  const one = new SaberBlade();
  const two = new SaberBlade();
  const mats = (b: InstanceType<typeof SaberBlade>) => (b.group.children as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[]).map((m) => m.material);
  const a = mats(one);
  const b = mats(two);
  ok(a.length === 4 && b.length === 4, 'a blade is four ribbons (the glow, the core and their two smears)');
  const key = (m: THREE.ShaderMaterial) => JSON.stringify([m.vertexShader, m.fragmentShader, m.blending, m.side, m.transparent, m.depthWrite, m.toneMapped, m.type]);
  ok(
    a.every((m, i) => key(m) === key(b[i])),
    "two blades carry the same shader source, blending, side, depth write and tone mapping, so the second finds the first's program",
  );
  one.dispose();
  two.dispose();
}

// ---- 3. Not lit, and away ----
{
  const a = makePeer(1, 0);
  const blades = new RemoteBlades();
  blades.peerAdded(a.p as never);
  const PEERS = [a.p];
  a.scene.updateMatrixWorld(true);
  frame(blades, PEERS, null, 30);
  const saber = blades.holders(undefined)[0].saber!;
  ok(saber.glowing, 'lit to begin with');
  a.p.saber = false;
  frame(blades, PEERS, null, 40);
  ok(!saber.glowing && saber.ignition === 0, 'a blade put out retracts and stops glowing');
  ok(blades.holders(undefined).length === 0, 'a blade that is out is not on the list at all');
  a.p.saber = true;
  frame(blades, PEERS, null, 30);
  ok(saber.glowing, 'lit again, it comes back on the renderer it already had');
  // A peer on another world is put out once, not sixty times a second for as long as they are away.
  let resets = 0;
  const real = saber.reset.bind(saber);
  saber.reset = () => {
    resets++;
    real();
  };
  a.p.shown = false;
  frame(blades, PEERS, null, 20);
  ok(!saber.glowing && saber.ignition === 0, 'a peer on another world or in a jump draws no blade at all');
  ok(resets === 1, `and is put out once rather than on every frame they are away (${resets} in 20 frames)`);
  blades.dispose();
}

// ---- 4. A staff draws both ends; the off hand draws its own ----
{
  const a = makePeer(1, 0);
  a.p.hands = [{ node: a.rightHolder, def: STAFF, hand: 'right' }];
  const blades = new RemoteBlades();
  blades.peerAdded(a.p as never);
  const PEERS = [a.p];
  a.scene.updateMatrixWorld(true);
  frame(blades, PEERS, null, 30);
  const list = blades.holders(undefined);
  ok(list.length === 2, 'a double-bladed staff is two blades, with nothing about the style on the wire');
  const ys = list.map((h) => h.saber!.drawnTip.y).sort((x, y) => x - y);
  ok(ys[0] < 1.2 && ys[1] > 1.2, 'one blade goes up the hilt and the other down it');
  a.p.hands = [
    { node: a.rightHolder, def: SABER, hand: 'right' },
    { node: a.leftHolder, def: SABER, hand: 'left' },
  ];
  frame(blades, PEERS, null, 30);
  const two = blades.holders(undefined);
  ok(two.length === 2, 'a saber in each hand is two blades');
  ok(
    two.some((h) => near(h.saber!.drawnBase.x, -0.3, 1e-6)),
    "the off hand's blade is drawn from the off hand",
  );
  // The peers skip an empty hand, so a saber carried only in the off hand is first in the list: it
  // is read by the hand it names, or the wrong hilt would be hidden when they threw it.
  a.p.hands = [{ node: a.leftHolder, def: SABER, hand: 'left' }];
  frame(blades, PEERS, null, 30);
  const off = blades.holders(undefined);
  ok(off.length === 1 && near(off[0].saber!.drawnBase.x, -0.3, 1e-6), 'a saber in the off hand alone is read as the off hand, not as the first hand in the list');
  ok((blades.debug().peers as { blades: { which: string }[] }[])[0].blades[0].which === 'left', 'and the knob says so too');
  a.p.hands = [{ node: a.rightHolder, def: RIFLE, hand: 'right' }];
  frame(blades, PEERS, null, 40);
  ok(blades.holders(undefined).length === 0, 'a blaster in the hand is no blade, whatever the saber flag says');
  blades.dispose();
}

// ---- 5. A blade thrown ----
{
  const a = makePeer(1, 0);
  const blades = new RemoteBlades();
  blades.peerAdded(a.p as never);
  const PEERS = [a.p];
  a.scene.updateMatrixWorld(true);
  frame(blades, PEERS, null, 30);
  a.p.saberThrown = { x: 4, y: 1.5, z: -9, spin: 1.2 };
  frame(blades, PEERS);
  ok(!a.rightHolder.visible, 'the hilt leaves the hand while the blade is in the air');
  const list = blades.holders(undefined);
  ok(list.length === 1, 'one blade in the air and none in the hand');
  const flying = list[0].saber!;
  ok(
    near(flying.drawnBase.y, 1.5, 0.3) && near(flying.drawnBase.x, 4, 0.3) && near(flying.drawnBase.z, -9, 0.3),
    `the blade is drawn where the wire says it is (${flying.drawnBase
      .toArray()
      .map((n) => n.toFixed(2))
      .join(', ')})`,
  );
  ok(flying.ignition === 1, 'a blade that left the hand is out at once rather than igniting in mid-air');
  ok(
    a.scene.children.some((c) => c.name === 'peer saber in flight'),
    'a copy of the hilt spins through the air with it',
  );
  const spun = a.scene.children.find((c) => c.name === 'peer saber in flight')!;
  a.p.saberThrown = { x: 4, y: 1.5, z: -9, spin: 2.4 };
  frame(blades, PEERS);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 2.4);
  ok(near(spun.quaternion.angleTo(q), 0, 1e-6), 'the copy turns by the spin the wire carries');
  // Thrown aboard a hull: the thrower composes the hull's turn with the spin, so the copy must too,
  // or a saber thrown in a banked ship lies flat in the world instead of along the deck.
  const bank = new THREE.Matrix4().makeRotationZ(Math.PI / 3);
  a.p.hullFrame = bank;
  frame(blades, PEERS);
  const want = new THREE.Quaternion().setFromRotationMatrix(bank).multiply(q);
  ok(near(spun.quaternion.angleTo(want), 0, 1e-6), "aboard a hull the copy takes the hull's turn as well as the spin");
  a.p.hullFrame = null;
  frame(blades, PEERS);
  ok(near(spun.quaternion.angleTo(q), 0, 1e-6), 'and out of a hull it is the spin alone again');
  a.p.saberThrown = null;
  frame(blades, PEERS);
  ok(a.rightHolder.visible && !spun.visible, 'caught again, the hilt is back in the hand and the copy is put away');
  frame(blades, PEERS, null, 30);
  ok(blades.holders(undefined).length === 1 && near(blades.holders(undefined)[0].saber!.drawnBase.x, 0.3, 1e-6), 'the blade is back on the hilt in the hand');
  blades.dispose();
}

// ---- 5b. A copy built while their figure was out of the tree still lands in it ----
{
  // A species change takes the rig down and dresses it again: a blade thrown across those frames
  // built its copy with nowhere to put it, and it must go in as soon as there is somewhere.
  const a = makePeer(1, 0);
  const blades = new RemoteBlades();
  blades.peerAdded(a.p as never);
  const PEERS = [a.p];
  a.scene.updateMatrixWorld(true);
  frame(blades, PEERS, null, 30);
  a.scene.remove(a.group);
  a.p.saberThrown = { x: 1, y: 1, z: -6, spin: 0.5 };
  frame(blades, PEERS);
  a.scene.add(a.group);
  a.scene.updateMatrixWorld(true);
  frame(blades, PEERS);
  const spun = a.scene.children.find((c) => c.name === 'peer saber in flight');
  ok(!!spun && spun.parent === a.scene, 'a copy built while their figure was out of the tree is put in it on the next frame rather than left hanging in nothing');
  blades.dispose();
}

// ---- 6. Death ----
{
  // The clip is the peers' own (`setDown`, where the rig is): what belongs here is that the blade
  // goes out with them, that one they had in the air is not left hanging where they died, and that
  // it lights again when they are up.
  const a = makePeer(1, 0);
  const blades = new RemoteBlades();
  blades.peerAdded(a.p as never);
  const PEERS = [a.p];
  a.scene.updateMatrixWorld(true);
  frame(blades, PEERS, null, 30);
  a.p.saberThrown = { x: 4, y: 1.5, z: -9, spin: 1.2 };
  frame(blades, PEERS);
  ok(!a.rightHolder.visible && blades.holders(undefined).length === 1, 'a blade in the air, and then they are killed');
  // `down` alone, with their saber flag left standing: being down is what puts the blade out here,
  // whatever else the view says.
  a.p.down = true;
  frame(blades, PEERS);
  ok(blades.holders(undefined).length === 0, "a dead peer's blade goes out at once, in the hand or in the air, on the down flag alone");
  ok(a.rightHolder.visible, 'and the hilt is back in their hand rather than left spinning where they died');
  a.p.down = false;
  a.p.saberThrown = null;
  frame(blades, PEERS, null, 30);
  ok(blades.holders(undefined).length === 1, 'up again, they light it on the renderer they already had');
  blades.dispose();
}

// ---- 8. The list handed to the frame ----
{
  const a = makePeer(1, 0);
  const blades = new RemoteBlades();
  const mobiles = [{ saber: null }, { saber: null }];
  ok(blades.holders(mobiles) === mobiles, 'with no peers the list handed in is handed straight back, untouched');
  ok(blades.holders(undefined).length === 0, 'and with nothing handed in it is empty');
  blades.peerAdded(a.p as never);
  const PEERS = [a.p];
  a.scene.updateMatrixWorld(true);
  frame(blades, PEERS, null, 30);
  const merged = blades.holders(mobiles);
  ok(merged.length === 3 && merged[0] === mobiles[0] && merged[1] === mobiles[1], "the catalogue's people come first and the peers after, in one list");
  const twice = blades.holders(mobiles);
  ok(twice === merged, 'the list is one kept array, rewritten in place rather than made again');
  blades.dispose();
}

// ---- 9. The nearest eight, with peers among them ----
{
  // Nine peers, each a metre farther off than the last: the glow pass keeps eight, nearest first.
  const peers: ReturnType<typeof makePeer>[] = [];
  const scene = new THREE.Scene();
  const blades = new RemoteBlades();
  for (let i = 0; i < 9; i++) {
    const p = makePeer(i + 1, 0);
    // One scene for all of them, so every blade hangs in the same tree.
    p.group.position.set(0, 0, -(i + 2));
    scene.add(p.group);
    peers.push(p);
  }
  for (const p of peers) blades.peerAdded(p.p as never);
  const PEERS = peers.map((p) => p.p);
  scene.updateMatrixWorld(true);
  frame(blades, PEERS, null, 30);
  ok(blades.holders(undefined).length === 9, 'all nine blades are on the list');
  const list = createBladeList();
  collectBlades(list, [], [], camera.position, blades.holders(undefined));
  ok(list.count === BLADE_GLOW_MAX, `the glow pass keeps ${BLADE_GLOW_MAX} of them, which is the rule it already had`);
  const distances = list.items.slice(0, list.count).map((b) => b.a.distanceTo(camera.position));
  ok(
    distances.every((d, i) => i === 0 || d >= distances[i - 1] - 1e-6),
    'nearest first',
  );
  blades.dispose();
}

// ---- 10. Borrowing a pooled light ----
{
  const a = makePeer(1, 0);
  const blades = new RemoteBlades();
  blades.peerAdded(a.p as never);
  const PEERS = [a.p];
  a.scene.updateMatrixWorld(true);
  frame(blades, PEERS, null, 30);
  const pool = [0, 0, 0, 0].map(() => new THREE.PointLight(0xffffff, 0, 1));
  const asked: { color: number; intensity: number }[] = [];
  const flash = {
    lightPool: pool,
    flash: (_p: THREE.Vector3, color: number, intensity: number) => {
      asked.push({ color, intensity });
    },
  };
  frame(blades, PEERS, flash);
  ok(asked.length === 1 && asked[0].color === 0x22ff44, "with the glow pass off a peer's blade borrows a pooled light standing dark, in its own colour");
  // Every light held by somebody else: nothing is taken away from them, and the peer goes unlit.
  asked.length = 0;
  for (const l of pool) l.intensity = 2;
  frame(blades, PEERS, flash);
  ok(asked.length === 0, 'with the pool busy a peer takes nothing and is unlit: the player, a fighter and a room all asked earlier in the frame');
  PEER_BLADE_TUNE.borrow = 'always';
  frame(blades, PEERS, flash);
  ok(asked.length === 1, '`always` asks whatever the pool is doing, which evicts whoever is using it -- for comparison only');
  PEER_BLADE_TUNE.borrow = 'never';
  asked.length = 0;
  for (const l of pool) l.intensity = 0;
  frame(blades, PEERS, flash);
  ok(asked.length === 0, '`never` leaves them unlit');
  PEER_BLADE_TUNE.borrow = 'free';
  asked.length = 0;
  frame(blades, PEERS, null);
  ok(asked.length === 0, 'with the glow pass on nothing is borrowed at all, so no light ever moves');
  ok(
    pool.every((l) => l.parent === null),
    'no light joined or left the scene',
  );
  blades.dispose();
}

// ---- 11. A peer who goes ----
{
  const a = makePeer(1, 0);
  const b = makePeer(2, 3);
  b.group.position.set(3, 0, -5);
  a.scene.add(b.group);
  const blades = new RemoteBlades();
  const live = [a.p, b.p];
  for (const p of live) blades.peerAdded(p as never);
  const PEERS = live;
  a.scene.updateMatrixWorld(true);
  frame(blades, PEERS, null, 30);
  ok(blades.holders(undefined).length === 2, 'two peers, two blades');
  const groups = a.scene.children.filter((c) => c.type === 'Group').length;
  live.pop();
  blades.peerRemoved(2);
  frame(blades, PEERS);
  ok(blades.holders(undefined).length === 1, 'a peer who leaves is taken apart');
  ok(a.scene.children.filter((c) => c.type === 'Group').length === groups - 1, 'and their blade leaves the scene with them');
  // One who stops being moved at all -- the peers were not stepped this frame -- draws nothing, and
  // keeps its renderer for the frame they come back.
  const still = blades.debug().renderersMade as number;
  blades.draw(dt, camera);
  ok(blades.holders(undefined).length === 0, 'a peer whose figure was not moved this frame draws no blade');
  frame(blades, PEERS, null, 30);
  ok(blades.holders(undefined).length === 1 && (blades.debug().renderersMade as number) === still, 'and comes back on the renderer it already had');
  const made = blades.debug().renderersMade as number;
  frame(blades, PEERS, null, 20);
  ok((blades.debug().renderersMade as number) === made, 'nothing new is made frame after frame');
  blades.dispose();
  ok(blades.holders(undefined).length === 0, 'disposed, it holds nothing');
}

// ---- 11b. Peers coming and going build nothing and dispose nothing ----
{
  // A blade's materials are held by the portal renderer's set and the shadow cascades' map, both
  // strong: disposing four of them every time somebody leaves would leave dead entries in a set
  // walked a dozen times a frame. So a renderer a peer is done with waits for the next peer.
  const scene = new THREE.Scene();
  const blades = new RemoteBlades();
  const forgotten: THREE.Material[] = [];
  blades.forget = (mats) => forgotten.push(...mats);
  let disposals = 0;
  for (let round = 0; round < 6; round++) {
    const a = makePeer(round + 1, 0);
    scene.add(a.group);
    scene.updateMatrixWorld(true);
    blades.peerAdded(a.p as never);
    frame(blades, [a.p], null, 4);
    const saber = blades.holders(undefined)[0].saber!;
    const real = saber.dispose.bind(saber);
    saber.dispose = () => {
      disposals++;
      real();
    };
    blades.peerRemoved(round + 1);
    scene.remove(a.group);
  }
  ok((blades.debug().renderersMade as number) === 1, `six peers one after another built one renderer between them (${blades.debug().renderersMade})`);
  ok(disposals === 0 && forgotten.length === 0, 'and nothing was disposed or had to be forgotten while they came and went');
  // Kept down to the tune's figure, and what goes is forgotten before it is disposed.
  const spare = PEER_BLADE_TUNE.spare;
  const peers: ReturnType<typeof makePeer>[] = [];
  for (let i = 0; i < 4; i++) {
    const a = makePeer(100 + i, i);
    scene.add(a.group);
    peers.push(a);
    blades.peerAdded(a.p as never);
  }
  scene.updateMatrixWorld(true);
  frame(
    blades,
    peers.map((p) => p.p),
    null,
    4,
  );
  ok(blades.holders(undefined).length === 4, 'four peers at once, four blades');
  peerBladesKnob({ spare: 1 });
  for (const p of peers) blades.peerRemoved(p.p.id);
  ok(forgotten.length === 4 * 3, `over the tune's figure the rest are disposed, their materials forgotten first (${forgotten.length} materials of 3 renderers)`);
  ok(
    forgotten.every((m) => !!m),
    'and every one of them is a real material the portal renderer could be holding',
  );
  peerBladesKnob({ spare });
  blades.dispose();
}

// ---- 12. The knob ----
{
  const back = { ...PEER_BLADE_TUNE };
  const r = peerBladesKnob({ swing: 0.5, borrow: 'never', flashDistance: 3 });
  ok((r.tune as typeof PEER_BLADE_TUNE).swing === 0.5 && PEER_BLADE_TUNE.borrow === 'never' && PEER_BLADE_TUNE.flashDistance === 3, 'every number is live through the knob');
  peerBladesKnob({ flashDistance: -1 });
  ok(PEER_BLADE_TUNE.flashDistance === 3, 'a number below nothing is refused rather than quietly floored, so a mistyped reach is not a light with none');
  peerBladesKnob(back);
  ok(PEER_BLADE_TUNE.swing === back.swing && PEER_BLADE_TUNE.borrow === back.borrow && PEER_BLADE_TUNE.flashDistance === back.flashDistance, 'and put back');
  const knob = peerBladesKnob();
  ok(Array.isArray(knob.peers) && typeof knob.renderersMade === 'number' && typeof knob.borrowedLastFrame === 'number', 'the knob reports in numbers, which is all a hidden tab can read');
}

// ---- 13. Nothing allocated once the blades are out ----
{
  const a = makePeer(1, 0);
  const blades = new RemoteBlades();
  blades.peerAdded(a.p as never);
  const PEERS = [a.p];
  a.scene.updateMatrixWorld(true);
  frame(blades, PEERS, null, 30);
  // The one that was allocated per blade per frame: the rack's numbers are read on a change of
  // weapon and written into the renderer's own spec, so the object is the same one next frame.
  const spec = blades.holders(undefined)[0].saber!.spec;
  frame(blades, PEERS);
  ok(blades.holders(undefined)[0].saber!.spec === spec, "the blade's numbers are one object written in place, not a fresh one every frame");
  ok(spec.length === 1.2 && spec.open === 0.3, 'and they are the rack\'s own');
  if (typeof (globalThis as { gc?: () => void }).gc === 'function') {
    const gc = (globalThis as { gc: () => void }).gc;
    const run = (n: number) => {
      gc();
      const before = process.memoryUsage().heapUsed;
      for (let i = 0; i < n; i++) {
        frame(blades, PEERS);
        blades.holders(undefined);
      }
      gc();
      return process.memoryUsage().heapUsed - before;
    };
    // The first run measures V8 warming up as much as anything (optimised code, inline caches), so
    // it is thrown away: what a per-frame allocation looks like is a run that keeps growing.
    const warm = run(4000);
    const grew = run(8000);
    // 21-22 kB across runs here, and one object a frame would be ten times that.
    ok(grew < 64 * 1024, `8000 frames of a peer's blade grew the heap by ${(grew / 1024).toFixed(0)} kB, once V8 had settled (the first 4000 frames cost ${(warm / 1024).toFixed(0)} kB of that settling)`);
  } else console.log('skip the allocation check (run with --expose-gc to take it)');
  blades.dispose();
}

console.log(`\n${passed} checks passed`);
