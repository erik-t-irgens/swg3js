// A hull somebody else flies, as a place (src/net/remoteInterior.ts).
//
// The module under test is the bookkeeping: when a peer's hull becomes a place, where its rooms hang,
// what keeps them on the hull as it moves, what steps them, and -- the part that matters most -- what
// is allowed to take them down. A physics world freed under somebody standing in it is the one
// mistake this whole area punishes, so most of what follows is about refusing to do that.
//
// The game's own Vehicle and ShipInterior are reached through the module's `parts` seam, which in
// play is a dynamic import of those two files and here is a pair of stand-ins that count their calls.
// That seam is why this file loads under node at all: `src/vehicles/vehicle.ts` and
// `src/vehicles/interior.ts` both use constructor parameter properties, which node's strip-only mode
// refuses, and both pull in three's loaders. Nothing here is game data: a box, two rooms, round
// numbers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { REMOTE_ROOM_TUNE, RemoteInteriors, remoteInteriors, remoteRoomKnob, type RoomDeps, type RoomParts } from '../../../src/net/remoteInterior.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

const TUNE_WAS = { ...REMOTE_ROOM_TUNE };
// The sweep of the rooms does its work once a frame however many times it is called, and works out
// what a frame is from the clock. Everywhere below but section 15, which measures that guard on its
// own, a test wants one call to be one frame, so the gap it asks for is nil.
const resetTune = () => Object.assign(REMOTE_ROOM_TUNE, TUNE_WAS, { minStep: 0 });
resetTune();
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A peer as the peers hand one over; only the three fields this module reads matter. */
function peer(id: number, ship: THREE.Object3D | null, shown = true): any {
  return { id, name: `peer ${id}`, shown, group: new THREE.Object3D(), rig: null, ship, shipBox: null, hp: 100, maxHp: 100, down: false, saber: false, saberColor: 0, hands: [], saberThrown: null, hullFrame: null };
}

/** A picture of a ride, as `Garage.visualParts` hands one back: a group that says which vehicle it is. */
function picture(id = 'a_hull'): THREE.Object3D {
  const holder = new THREE.Group();
  holder.userData.vehicleId = id;
  const model = new THREE.Object3D();
  model.position.set(0, 1, 2);
  holder.add(model);
  return holder;
}

/** What the stand-ins count, so a test can say what really happened. */
interface Tally {
  hulls: number;
  rooms: number;
  prepared: number;
  forgotten: number;
  hullDisposed: number;
  roomDisposed: number;
  steps: number;
  revealed: boolean | null;
}

function harness(opts: { roomsNull?: boolean; ownModel?: boolean } = {}) {
  const tally: Tally = { hulls: 0, rooms: 0, prepared: 0, forgotten: 0, hullDisposed: 0, roomDisposed: 0, steps: 0, revealed: null };
  const physics = { name: 'the world' } as any;
  const scene = new THREE.Scene();
  const garage = { find: (id: string) => (id === 'a_hull' ? { id: 'a_hull', label: 'a hull', kind: 'ship', bounds: { min: [-4, -2, -9], max: [4, 2, 9] }, cells: [{ index: 1 }, { index: 2 }] } : undefined) } as any;
  const deps: RoomDeps = {
    physics,
    scene,
    gravity: () => 9.8,
    garage: async () => garage,
    prepare: async () => {
      tally.prepared++;
    },
    forget: (m) => {
      tally.forgotten += m.length;
    },
    watch: () => () => {},
  };
  const parts: RoomParts = {
    async hull(def, bounds, phys, sc) {
      tally.hulls++;
      const group = new THREE.Group();
      sc.add(group);
      return {
        spec: { id: def.id, label: def.label, bounds },
        group,
        pos: new THREE.Vector3(),
        body: {
          valid: true,
          at: { x: 0, y: 0, z: 0 },
          turn: { x: 0, y: 0, z: 0, w: 1 },
          isValid() {
            return this.valid;
          },
          setTranslation(t: any) {
            this.at = { ...t };
          },
          setRotation(q: any) {
            this.turn = { ...q };
          },
        },
        interior: null as any,
        heldFlag: phys === physics,
        dispose() {
          tally.hullDisposed++;
          this.interior?.dispose();
          this.interior = null;
        },
      } as any;
    },
    async rooms(hull, _def, _g, _pic, _gravity, prepare) {
      await prepare([new THREE.Object3D()]);
      if (opts.roomsNull) return null;
      tally.rooms++;
      const own = opts.ownModel ? new THREE.Group() : hull.group;
      if (opts.ownModel) hull.group.add(own);
      const material = new THREE.MeshBasicMaterial();
      return {
        group: own,
        cells: 2,
        lights: [{}, {}, {}],
        entry: new THREE.Vector3(0, 0.5, 1),
        pilotSpot: null,
        bounds: new THREE.Box3(new THREE.Vector3(-2, 0, -3), new THREE.Vector3(2, 3, 3)),
        ownMaterials: opts.ownModel ? [material] : [],
        physics: {
          step(dt: number) {
            tally.steps++;
            tally.lastDt = dt;
          },
        },
        reveal(on: boolean) {
          tally.revealed = on;
        },
        dispose() {
          tally.roomDisposed++;
        },
      } as any;
    },
  };
  const rooms = new RemoteInteriors();
  rooms.parts = parts;
  rooms.bind(deps);
  return { rooms, deps, tally: tally as Tally & { lastDt?: number }, scene, physics };
}

// --- 1: nothing at all until somebody asks ------------------------------------------------------------
// The game with no server must be the game that is on main: this holds nothing, builds nothing and
// costs a map lookup that misses.
{
  const loose = new RemoteInteriors();
  const status = loose.status();
  ok(status.bound === false && status.rooms === 0, '1: with no world bound it holds nothing');
  const none = await loose.board(1);
  ok(none === null, '1: and a hull cannot be made a place before a world is bound');
  const h = harness();
  h.rooms.peerAdded(peer(1, picture()));
  h.rooms.peerMoved(peer(1, picture()));
  ok(h.tally.hulls === 0 && h.tally.rooms === 0, '1: a peer flying past builds nothing -- rooms are made on the ask, never for a ship in view');
  h.rooms.dispose();
}

// --- 2: what can be boarded, and what is refused ---------------------------------------------------
{
  const h = harness();
  const nobody = await h.rooms.board(7);
  ok(nobody === null, '2: a relay id nobody here answers to is refused');
  h.rooms.peerMoved(peer(2, null));
  ok((await h.rooms.board(2)) === null, '2: a peer on foot has no hull to board');
  const bare = new THREE.Group();
  h.rooms.peerMoved(peer(3, bare));
  ok((await h.rooms.board(3)) === null, "2: a picture that does not say which vehicle it is is refused rather than guessed at");
  h.rooms.peerMoved(peer(4, picture('another_hull')));
  ok((await h.rooms.board(4)) === null, '2: a ride the garage does not know is refused');
  h.rooms.dispose();
}

// --- 3: a hull with no rooms is no place, and its stand-in does not outlive the attempt --------------
{
  const h = harness({ roomsNull: true });
  const pic = picture();
  h.rooms.peerMoved(peer(5, pic));
  const built = await h.rooms.board(5);
  ok(built === null, '3: a hull whose rooms could not be found is not a place');
  ok(h.tally.hulls === 1 && h.tally.hullDisposed === 1, '3: and the stand-in hull made for it is given back at once');
  ok(pic.children.length === 1, '3: with nothing of it left hanging on the picture');
  h.rooms.dispose();
}

// --- 4: built once, shared while it is building ----------------------------------------------------
{
  const h = harness();
  const pic = picture();
  h.rooms.peerMoved(peer(6, pic));
  const [a, b] = await Promise.all([h.rooms.board(6), h.rooms.board(6)]);
  ok(!!a && a === b, '4: two asks while one is building share the one job');
  ok(h.tally.hulls === 1 && h.tally.rooms === 1, '4: so one hull and one set of rooms are made');
  const again = await h.rooms.board(6);
  ok(again === a, '4: and asking again hands back the room that is already up');
  ok(h.tally.prepared === 1, '4: prepared once, before the rooms came back -- nothing of them compiles on a live frame');
  ok(h.rooms.roomOf(6) === a && h.rooms.roomOf(99) === null, '4: and it can be found again by the peer it belongs to');
  h.rooms.dispose();
}

// --- 5: the rooms hang under the picture, at its origin ---------------------------------------------
// This is what carries the hull's pose off the wire onto the rooms with nothing copied, and it is also
// what makes `RemotePlayers.hullCarrier` answer for somebody standing in them: it walks a node's
// parents looking for a peer's picture.
{
  const h = harness();
  const pic = picture();
  h.rooms.peerMoved(peer(7, pic));
  const room = (await h.rooms.board(7))!;
  ok(room.hull.group.parent === pic, '5: the stand-in hull hangs under the peer\'s own picture');
  ok(room.hull.group.position.lengthSq() === 0 && near(room.hull.group.quaternion.w, 1) && room.hull.group.scale.x === 1, '5: at its origin, so the rooms ride the hull exactly');
  let found = false;
  for (let o: THREE.Object3D | null = room.interior.group; o; o = o.parent) if (o === pic) found = true;
  ok(found, '5: and the rooms themselves are under it, so whoever stands in them is in that player\'s hull');
  h.rooms.dispose();
}

// --- 6: the stand-in follows the picture, and the rooms are stepped ---------------------------------
{
  const h = harness();
  const pic = picture();
  const view = peer(8, pic);
  h.rooms.peerMoved(view);
  const room = (await h.rooms.board(8))!;
  pic.position.set(120, 40, -7);
  pic.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1);
  h.rooms.peerMoved(view);
  ok(near(room.hull.pos.x, 120) && near(room.hull.pos.y, 40) && near(room.hull.pos.z, -7), '6: the stand-in hull is where the picture is, so everything that reads `room.vehicle.pos` is right');
  const body = (room.hull as any).body;
  ok(near(body.at.x, 120) && near(body.turn.y, Math.sin(0.5), 1e-6), '6: and its body carries the same pose, which is what `quaternion()` answers from');
  const stepsBefore = h.tally.steps;
  h.rooms.peerMoved(view);
  ok(h.tally.steps === stepsBefore + 1, '6: the rooms\' own physics is stepped once a frame');
  ok((h.tally.lastDt ?? 1) <= REMOTE_ROOM_TUNE.maxStep, `6: with a step no longer than ${REMOTE_ROOM_TUNE.maxStep}s, so a stalled tab flings nobody through a wall`);
  REMOTE_ROOM_TUNE.step = 0;
  const held = h.tally.steps;
  h.rooms.peerMoved(view);
  ok(h.tally.steps === held, '6: and the knob can stop it stepping, for a baseline');
  resetTune();
  h.rooms.dispose();
}

// --- 7: showing them is the same fact as being in them ----------------------------------------------
// The game's rooms are bigger than the hull around them and are only ever meant to be seen from
// inside; a room nobody is in is also a room that may be taken down.
{
  const h = harness({ ownModel: true });
  const pic = picture();
  h.rooms.peerMoved(peer(9, pic));
  const room = (await h.rooms.board(9))!;
  ok(h.tally.revealed === null && room.held === false, '7: rooms come up out of sight and held by nobody');
  h.rooms.enter(9, true);
  ok(h.tally.revealed === true && room.held && room.interior.group.visible, '7: stepping in shows them and holds them');
  h.rooms.enter(9, false);
  ok(h.tally.revealed === false && !room.held && !room.interior.group.visible, '7: and stepping out hides them again');
  h.rooms.dispose();
}

// --- 8: a hull that stops being drawn ---------------------------------------------------------------
{
  const h = harness();
  const pic = picture();
  const away = peer(10, pic, false);
  h.rooms.peerMoved(peer(10, pic));
  await h.rooms.board(10);
  ok(!!h.rooms.roomOf(10), '8: up while their hull is drawn');
  // A jump is back within a second: the rooms are kept for a few seconds rather than rebuilt.
  REMOTE_ROOM_TUNE.keepSeconds = 0.05;
  h.rooms.peerMoved(away);
  ok(!!h.rooms.roomOf(10), '8: a hull that stops being drawn keeps its rooms for a moment (a jump is back within one)');
  await pause(90);
  h.rooms.peerMoved(away);
  ok(h.rooms.roomOf(10) === null && h.tally.hullDisposed === 1, '8: and past that they are taken down, hull and all');
  resetTune();
  // Climbing onto something else drops them the same way.
  const other = picture();
  h.rooms.peerMoved(peer(10, pic));
  await h.rooms.board(10);
  REMOTE_ROOM_TUNE.keepSeconds = 0;
  await pause(5);
  h.rooms.peerMoved(peer(10, other));
  ok(h.rooms.roomOf(10) === null, '8: and a peer who climbs onto another ride loses the rooms of the one they left');
  resetTune();
  h.rooms.dispose();
}

// --- 9: a room somebody is standing in is never freed under them -------------------------------------
// The rule the whole file is written around: a body in a physics world that is then freed is left in
// nothing at all. Whoever put the player there is told; if they are still there afterwards the rooms
// are cut loose from the picture and left standing where the hull last was.
{
  const h = harness();
  const pic = picture();
  pic.position.set(10, 5, 0);
  h.rooms.peerMoved(peer(11, pic));
  const room = (await h.rooms.board(11))!;
  h.rooms.peerMoved(peer(11, pic));
  h.rooms.enter(11, true);
  let told = 0;
  h.rooms.onMustLeave = () => {
    told++;
  };
  h.rooms.release(11);
  ok(told === 1, '9: taking the rooms down first tells whoever put somebody in them');
  ok(h.rooms.status().rooms === 1 && h.tally.hullDisposed === 0 && h.tally.roomDisposed === 0, '9: and while they stay in, nothing is freed');
  ok(room.adrift && room.hull.group.parent === h.scene, '9: the rooms are cut loose from the picture instead');
  ok(near(room.hull.group.position.x, 10) && near(room.hull.group.position.y, 5), '9: standing exactly where the hull last was, so nobody inside moves');
  ok(h.rooms.roomOf(11) === null, '9: and they are no longer offered as that player\'s ship, which by now they are not');
  h.rooms.peerRemoved(11);
  ok(h.rooms.status().rooms === 1, '9: the peer going does not free them either');
  h.rooms.enter(11, false);
  ok(h.rooms.status().rooms === 0 && h.tally.hullDisposed === 1, '9: they go the moment the last person steps out');
  h.rooms.dispose();
}

// --- 10: an interior model of its own leaves the world's sets when it goes ----------------------------
// The portal renderer's material set and the shadow cascades' map are both strong holds; a room built
// and taken down over and over would grow both for the life of the page.
{
  const h = harness({ ownModel: true });
  h.rooms.peerMoved(peer(12, picture()));
  await h.rooms.board(12);
  h.rooms.release(12);
  ok(h.tally.forgotten === 1, '10: the materials of an interior model of its own are taken out of the world\'s sets');
  const plain = harness();
  plain.rooms.peerMoved(peer(13, picture()));
  await plain.rooms.board(13);
  plain.rooms.release(13);
  ok(plain.tally.forgotten === 0, "10: and a hull's own cells forget nothing, because their materials are the picture's and are still in use");
  h.rooms.dispose();
  plain.rooms.dispose();
}

// --- 11: another world ------------------------------------------------------------------------------
// A travel frees the physics world the stand-in's body is in. Nothing of the old one may be touched
// after that -- which means the hull is not disposed, only let go of, and the rooms' own little world,
// which is theirs alone, is freed.
{
  const h = harness();
  h.rooms.peerMoved(peer(14, picture()));
  await h.rooms.board(14);
  h.rooms.bind({ ...h.deps, physics: { name: 'the next world' } as any });
  ok(h.rooms.roomOf(14) === null, '11: bound to another world, nothing of the last one is left');
  ok(h.tally.hullDisposed === 0, '11: and its stand-in hull is not disposed into a world that has been freed');
  ok(h.tally.roomDisposed === 1, "11: while the rooms' own physics world, which is theirs alone, is freed");
  h.rooms.dispose();
}

// --- 12: nothing is allocated per frame ---------------------------------------------------------------
{
  const h = harness();
  const pic = picture();
  const view = peer(15, pic);
  h.rooms.peerMoved(view);
  await h.rooms.board(15);
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc) {
    for (let i = 0; i < 2000; i++) {
      pic.position.x = i * 0.01;
      h.rooms.peerMoved(view);
    }
    gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 60000; i++) {
      pic.position.x = i * 0.001;
      h.rooms.peerMoved(view);
    }
    gc();
    const grew = process.memoryUsage().heapUsed - before;
    ok(grew < 512 * 1024, `12: sixty thousand frames of a friend's hull moving grow the heap by ${(grew / 1024).toFixed(0)} kB`);
  } else {
    ok(true, '12: run with --expose-gc to measure the heap across sixty thousand frames');
  }
  h.rooms.dispose();
}

// --- 13: the knob -------------------------------------------------------------------------------------
{
  const report = remoteRoomKnob();
  ok(typeof report.bound === 'boolean' && Array.isArray(report.rows) && !!report.tune, '13: __rooms() answers in numbers, which is the only way to see this in a hidden tab');
  remoteRoomKnob({ keepSeconds: 12 });
  ok(REMOTE_ROOM_TUNE.keepSeconds === 12, '13: and every invented number is live through it');
  remoteRoomKnob({ maxStep: 0 });
  ok(REMOTE_ROOM_TUNE.maxStep > 0, '13: a step of zero is refused, since a room that never steps holds nobody up');
  resetTune();
  ok(remoteInteriors() === remoteInteriors(), '13: there is one set of them for the page');
  ok((globalThis as any).__rooms === remoteRoomKnob, '13: reachable wherever there is a console');
}

// --- 14: what the rest of the tree has to be for this to work ------------------------------------------
{
  const garage = src('../../../src/vehicles/garage.ts');
  ok(/holder\.userData\.vehicleId = def\.id;/.test(garage), '14: a picture says which vehicle it is, which is the only way back to its def');
  const roomsFn = /visualRooms\(holder: THREE\.Object3D\)[\s\S]*?\n  }/.exec(garage)?.[0] ?? '';
  ok(/\.clone\(true\)/.test(roomsFn), "14: the rooms of a picture are a copy, so the picture goes on being a picture");
  ok(/m\.userData\.shared = true/.test(roomsFn), '14: every mesh of that copy is marked shared, so disposing it leaves the picture\'s geometry alone');
  ok(/group\.position\.copy\(from\.position\)/.test(roomsFn), "14: and the copy carries the model's own place, so it stands where the picture's own cells stand");
  ok(/ownCellIndex\(o\) <= 0/.test(roomsFn), "14: cell 0, which is the hull's own shell and is already drawn, is not copied with the rooms");
  ok(/group\.visible = false;\s*\n\s*return group;/.test(roomsFn), '14: and the copy comes back turned off, so nothing of it is drawn through the hull while it is being hung, measured and prepared');
  ok(/export function ownCellIndex/.test(src('../../../src/vehicles/interior.ts')), "14: with one spelling of the converter's cell naming, read from the rooms themselves");

  const interior = src('../../../src/vehicles/interior.ts');
  ok(/export interface InteriorHost/.test(interior), '14: the rooms name what they ask of a hull');
  const body = /export class ShipInterior \{[\s\S]*$/.exec(interior)?.[0] ?? '';
  const reads = body.match(/this\.vehicle\.[a-zA-Z]/g) ?? [];
  ok(reads.length === 0, `14: and read nothing else of it -- ${reads.length} reads of the hull that go round the interface`);
  ok(/opts\.hidden/.test(interior) && /opts\.prepare/.test(interior), '14: an interior model can be loaded out of sight and prepared before anything draws it');

  const world = src('../../../src/world/world.ts');
  ok(/remoteRooms\(\): RemoteInteriors \{[\s\S]*?prepare: \(roots\) => this\.vehiclePrepare\(roots\)/.test(world), '14: the world prepares a peer\'s rooms the way it prepares a vehicle of its own');
  ok(/remoteRooms\(\): RemoteInteriors \{[\s\S]*?forget: \(m\) => this\.forgetMaterials\(m\)/.test(world), '14: and hands over the one way to leave its material sets');

  const mine = src('../../../src/net/remoteInterior.ts');
  ok(!/new THREE\.(Point|Spot|Directional|Hemisphere|Ambient)Light/.test(mine), '14: no light is ever made here: a room\'s lamps are the flash pool\'s, so the light count never moves');
  ok(!/^import \{[^}]*\} from '\.\.\/vehicles\//m.test(mine), '14: the vehicle and the rooms are reached at the moment one is asked for, not at load time');
  const live = /const liveParts: RoomParts = \{[\s\S]*$/.exec(mine)?.[0] ?? '';
  ok(/await prepare\(\[copy\]\);[\s\S]*fromHull[\s\S]*copy\.visible = true;/.test(live), '14: and the copy is turned on only after the rooms themselves have hidden their cells, never before the preparation that yields to the frame loop');
  ok(/hull\.group\.userData\.noBox = true;/.test(live), "14: what hangs under a peer's picture here is kept out of the box a bolt stops against, so their ship does not grow to the size of its own cabins while somebody is inside");
}

// --- 15: the sweep is one a frame, however many times it is called -------------------------------------
// It is called once by the frame loop and once per other player by the peers' pass. Stepping a room
// once per player would have everybody in one walking at the number of players' times the speed.
{
  const h = harness();
  const pic = picture();
  const view = peer(20, pic);
  h.rooms.peerMoved(view);
  await h.rooms.board(20);
  REMOTE_ROOM_TUNE.minStep = 0.05;
  h.rooms.step();
  const before = h.tally.steps;
  for (let i = 0; i < 8; i++) h.rooms.peerMoved(view);
  h.rooms.step();
  ok(h.tally.steps === before, '15: eight players and the frame loop, all inside one frame, step the rooms no more than that frame already did');
  await pause(70);
  h.rooms.step();
  ok(h.tally.steps === before + 1, '15: and the next frame steps them once');
  ok(TUNE_WAS.minStep > 0 && TUNE_WAS.minStep < 1 / 120, `15: the gap it ships with (${(TUNE_WAS.minStep * 1000).toFixed(1)} ms) is shorter than any frame this game draws, so no real frame is ever skipped`);
  resetTune();
  h.rooms.dispose();
}

// --- 16: a room outlives the player whose hull it was ---------------------------------------------------
// The headline case: somebody is standing in a friend's ship and that friend drops off the line. The
// rooms are cut loose and kept, and the thing that steps them must not be hung off a player who is no
// longer here, or the floor under the walker stops being simulated at all.
{
  const h = harness();
  const pic = picture();
  h.rooms.peerMoved(peer(21, pic));
  await h.rooms.board(21);
  h.rooms.enter(21, true);
  let told = 0;
  h.rooms.onMustLeave = () => {
    told++;
  };
  h.rooms.peerRemoved(21);
  const room = h.rooms.status().rows as Record<string, unknown>[];
  ok(room.length === 1 && room[0].adrift === true && room[0].held === true, '16: their line drops and the rooms are cut loose with somebody still in them');
  const before = h.tally.steps;
  await pause(5);
  h.rooms.step();
  await pause(5);
  h.rooms.step();
  ok(h.tally.steps === before + 2, '16: and they go on being stepped with nothing left to hear from that player -- a room nothing steps is a floor that has stopped');
  ok(told === 1, '16: whoever put them there is told once, on the way in, not once a frame for as long as they stay');
  REMOTE_ROOM_TUNE.keepSeconds = 0.02;
  await pause(30);
  h.rooms.step();
  ok(told === 2, '16: and asked again after a while, in case the first asking came at a moment nobody could answer');
  resetTune();
  h.rooms.enter(21, false);
  ok(h.rooms.status().rooms === 0 && h.tally.hullDisposed === 1, '16: and the room goes the moment they step out');
  h.rooms.dispose();
}

// --- 17: a relay number handed out again ----------------------------------------------------------------
{
  const h = harness();
  const pic = picture();
  h.rooms.peerMoved(peer(22, pic));
  await h.rooms.board(22);
  h.rooms.enter(22, true);
  h.rooms.peerRemoved(22);
  const later = picture();
  h.rooms.peerMoved(peer(22, later));
  ok((await h.rooms.board(22)) === null, '17: a number the relay hands out again is not answered with the rooms cut loose from the last hull that carried it');
  const rows = h.rooms.status().rows as Record<string, unknown>[];
  ok(rows.length === 1 && rows[0].adrift === true, '17: which go on standing where that hull was, following nothing and holding nobody new');
  h.rooms.dispose();
}

// --- 18: the knob's off switch ---------------------------------------------------------------------------
// The baseline the owner compares a frame against has to be a frame with none of this in it.
{
  const h = harness();
  h.rooms.peerMoved(peer(23, picture()));
  await h.rooms.board(23);
  ok(h.rooms.status().rooms === 1, '18: a room is up');
  REMOTE_ROOM_TUNE.on = 0;
  h.rooms.step();
  ok(h.rooms.status().rooms === 0 && h.tally.hullDisposed === 1, '18: and turning them off takes down the ones that are up, rather than waiting on their players to say something');
  resetTune();
  h.rooms.dispose();
}

console.log(`\n${checks} checks passed`);
