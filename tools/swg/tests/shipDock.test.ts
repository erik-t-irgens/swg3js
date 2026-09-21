// One ship clamped onto another: how big a hull must be to carry one, where the carried hull rests on
// it, the pose it is written to while the carrier flies, the crossing between the two ships' rooms, and
// the messages the relay passes about all of it -- including the one message meant for a single player,
// checked against the relay itself with three connections.
//
// Every hull here is synthetic and made of round numbers, and each case says which real shape it stands
// for: a small hull and a big one, a big one whose box is set by something tall standing on its back
// rather than by its deck, and a pair with rooms. Nothing is read from the client's files, and none of
// this is in them: the client has no ship-to-ship docking at all, so every rule under test is ours.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Physics, RAPIER } from '../../../src/core/physics.ts';
import { BOARD_TUNE, Docking, boardKnob, boardRow, onPeerHullGone, peerHullGone, peerRooms, setPeerRooms, type ClampWord, type PeerRooms } from '../../../src/space/docking.ts';
import {
  CLAMP_TUNE,
  atTheDoor,
  carrierEnough,
  clampClear,
  clampLocal,
  clampOnSkin,
  extent,
  highSide,
  hullLength,
  leadPose,
  lowSide,
} from '../../../src/space/dockingMath.ts';
import { cleanAsk, cleanDock, cleanVehicle } from '../../../server/vehicleWire.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

/** A box, either way round: which corner holds the larger value is never trusted anywhere. */
const box = (min: [number, number, number], max: [number, number, number]) => ({ min, max });

// --- 1: the boxes ----------------------------------------------------------------------------------
// A mesh's box chunk holds its two corners with the larger first, and the packs converted before that
// was found out carry them swapped, so nothing here may care which corner is which.
{
  const straight = box([-2, -1, -5], [2, 1, 5]);
  const swapped = box([2, 1, 5], [-2, -1, -5]);
  ok(near(extent(straight, 2), 10) && near(extent(swapped, 2), 10), '1: a box reaches the same distance whichever corner is written first');
  ok(near(lowSide(swapped, 1), -1) && near(highSide(swapped, 1), 1), '1: and its low side is the low one either way');
  ok(near(hullLength(straight), 10) && near(hullLength(swapped), 10), "1: a hull's length is its longest side");
}

// --- 2: what may carry what ------------------------------------------------------------------------
// Ours, and the only rule that decides what a carrier is: twice the length, so a fighter rides a
// freighter and nothing rides its own size.
{
  const fighter = box([-6, -2, -9], [6, 2, 9]);
  const freighter = box([-12, -4, -24], [12, 4, 24]);
  const another = box([-6, -2, -10], [6, 2, 10]);
  ok(carrierEnough(freighter, fighter), '2: a hull more than twice the length can carry the smaller one');
  ok(!carrierEnough(another, fighter), '2: one barely bigger cannot');
  ok(!carrierEnough(fighter, freighter), '2: and the small one can never carry the big one');
  const before = CLAMP_TUNE.carrier;
  CLAMP_TUNE.carrier = 1;
  ok(carrierEnough(another, fighter), '2: the rule is one live number, so the owner can loosen it');
  CLAMP_TUNE.carrier = before;
}

// --- 3: where a carried hull rests -----------------------------------------------------------------
{
  const carrier = box([-20, -3, -60], [20, 23, 60]);
  const ship = box([-6, -2, -9], [6, 2, 9]);
  const at = clampLocal(carrier, ship, { x: 0, y: 0, z: 0 });
  ok(near(at.x, 0) && near(at.z, 0), '3: over the middle of the carrier along and across');
  ok(near(at.y, 23 + CLAMP_TUNE.gap + 2), `3: with its own belly the gap above the top of the box (${at.y})`);
  ok(near(clampOnSkin(3, ship), 3 + CLAMP_TUNE.gap + 2), '3: and the gap above the skin where a ray found the skin');
  // A hull whose own origin is not in the middle of its box still rests on its belly, not its origin.
  const lopsided = box([-6, -7, -9], [6, 1, 9]);
  ok(near(clampOnSkin(0, lopsided), CLAMP_TUNE.gap + 7), '3: a hull whose origin sits high in its box rests on its belly all the same');
}

// --- 4: clear of the hull, and at the door ---------------------------------------------------------
{
  const carrier = { x: 0, y: 0, z: 0 };
  ok(!clampClear({ x: 0, y: 40, z: 0 }, carrier, 10, 60), '4: a hull just let go of is not clear yet');
  ok(clampClear({ x: 0, y: 200, z: 0 }, carrier, 10, 60), '4: one well off the hull is');
  const entry = { x: 1, y: 0.5, z: -3 };
  ok(atTheDoor({ x: 1, y: 0.5, z: -3 }, entry), "4: a walker standing at the room's own way in is at the door");
  ok(!atTheDoor({ x: 1, y: 0.5, z: 40 }, entry), '4: one at the far end of the room is not');
}

// --- 5: a step ahead of the carrier ----------------------------------------------------------------
// The clamp is written before the carrier has taken its own step, so the pose it is written against is
// read a step on. Without it a carried hull rides a constant few metres behind the hull it is on.
{
  const dt = 1 / 60;
  const pos = { x: 0, y: 0, z: 0 };
  const q = { x: 0, y: 0, z: 0, w: 1 };
  const vel = { x: 0, y: 0, z: 120 };
  const spin = { x: 0, y: 0.8, z: 0 };
  const outPos = { x: 0, y: 0, z: 0 };
  const outQ = { x: 0, y: 0, z: 0, w: 1 };
  leadPose(pos, q, vel, spin, dt, 1, outPos, outQ);
  ok(near(outPos.z, 120 * dt, 1e-9), `5: a whole step on, the place is where the hull will be (${outPos.z.toFixed(3)} m)`);
  const exact = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.8 * dt);
  const got = new THREE.Quaternion(outQ.x, outQ.y, outQ.z, outQ.w);
  ok(got.angleTo(exact) < 1e-4, `5: and the turn is within a ten-thousandth of a radian of the true one (${got.angleTo(exact).toExponential(1)})`);
  leadPose(pos, q, vel, spin, dt, 0, outPos, outQ);
  ok(near(outPos.z, 0) && near(outQ.w, 1), '5: with the lead off it is the pose as it stands, which is what the owner compares against');
  // A hull that is not moving is not moved by the lead, whatever it is set to.
  leadPose(pos, q, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, dt, 1, outPos, outQ);
  ok(near(outPos.x, 0) && near(outPos.y, 0) && near(outPos.z, 0) && near(outQ.w, 1), '5: a still hull is left exactly where it is');
}

// ---------------------------------------------------------------------------------------------------
// A fake hull: only what the clamp reads of a ship, with a hold that lands it where the real one does
// and an update of its own that writes the held pose again each step, as `Vehicle.update` does.
// ---------------------------------------------------------------------------------------------------

interface FakeBody {
  isValid(): boolean;
  linvel(): { x: number; y: number; z: number };
  angvel(): { x: number; y: number; z: number };
}

function hull(id: string, label: string, bounds: { min: number[]; max: number[] }, at: THREE.Vector3, body?: FakeBody) {
  const attitude = new THREE.Quaternion();
  const vel = new THREE.Vector3();
  const spin = new THREE.Vector3();
  const frameQ = new THREE.Quaternion();
  const frameP = new THREE.Vector3();
  const frameS = new THREE.Vector3();
  let heldFrame: THREE.Matrix4 | null = null;
  const heldPos = new THREE.Vector3();
  const heldQuat = new THREE.Quaternion();
  const w = Math.abs(bounds.max[0] - bounds.min[0]);
  const h = Math.abs(bounds.max[1] - bounds.min[1]);
  const l = Math.abs(bounds.max[2] - bounds.min[2]);
  const self = {
    spec: { id, label, ship: true, bounds },
    pos: at.clone(),
    attitude,
    vel,
    spin,
    radius: Math.hypot(w, h, l) / 2,
    speed: 0,
    disposed: false,
    held: false,
    landed: false,
    holding: false,
    ghosted: false,
    autopilot: null,
    combat: null,
    interior: null as { entry: THREE.Vector3 } | null,
    group: new THREE.Object3D(),
    body:
      body ??
      ({
        isValid: () => true,
        linvel: () => ({ x: vel.x, y: vel.y, z: vel.z }),
        angvel: () => ({ x: spin.x, y: spin.y, z: spin.z }),
      } satisfies FakeBody),
    quaternion: (out: THREE.Quaternion) => out.copy(attitude),
    hold(frame: THREE.Matrix4 | null, p: THREE.Vector3, q: THREE.Quaternion) {
      self.holding = true;
      heldFrame = frame;
      heldPos.copy(p);
      heldQuat.copy(q);
      self.writeHold();
    },
    /** What `Vehicle.update` does every step for a held hull: the frame's matrix now, times the pose. */
    writeHold() {
      if (!self.holding) return;
      if (!heldFrame) {
        self.pos.copy(heldPos);
        attitude.copy(heldQuat);
      } else {
        self.pos.copy(heldPos).applyMatrix4(heldFrame);
        heldFrame.decompose(frameP, frameQ, frameS);
        attitude.copy(frameQ).multiply(heldQuat);
      }
      self.group.position.copy(self.pos);
      self.group.quaternion.copy(attitude);
    },
    release(v: THREE.Vector3 | null) {
      self.holding = false;
      heldFrame = null;
      if (v) vel.copy(v);
    },
    setGhost(on: boolean) {
      self.ghosted = on;
    },
    /** A hull flying under its own power: where it is, and where it is drawn. */
    fly(dt: number) {
      self.pos.addScaledVector(vel, dt);
      if (spin.lengthSq() > 0) attitude.multiply(turnBy(spin, dt));
      self.group.position.copy(self.pos);
      self.group.quaternion.copy(attitude);
    },
  };
  self.group.position.copy(self.pos);
  self.group.updateMatrixWorld(true);
  return self;
}

const spinQ = new THREE.Quaternion();
const spinAxis = new THREE.Vector3();
function turnBy(spin: THREE.Vector3, dt: number): THREE.Quaternion {
  const rate = spin.length();
  spinAxis.copy(spin).normalize();
  return spinQ.setFromAxisAngle(spinAxis, rate * dt);
}

/** What the clamp reads of the world; the rest of `DockWorld` is the station's and unused here. */
function fakeWorld(vehicles: unknown[], physics: unknown = null) {
  return {
    planet: { space: 'a system' },
    spaceData: { version: 3, stations: [], scenery: [], lanes: {}, dockEffects: {} },
    placedObjects: [],
    vehicles,
    physics,
    dockEffect: () => true,
  };
}

// --- 6: a whole clamp, flown -----------------------------------------------------------------------
// The state the game runs: a small hull beside a big one, asked onto it, carried while the big one
// flies and turns, then let go of and solid again once it is clear.
{
  const carrier = hull('carrier', 'big hull', box([-12, -4, -30], [12, 4, 30]), new THREE.Vector3(0, 0, 0));
  const ship = hull('fighter', 'small hull', box([-6, -2, -9], [6, 2, 9]), new THREE.Vector3(0, 20, 0));
  const docking = new Docking(fakeWorld([carrier, ship]) as never);
  const clamp = docking.clamp;

  ok(clamp.row(ship as never, 'pilot') === null, '6: with nothing going on the clamp leaves the row to the station');
  const offered = clamp.offerRow(ship as never, 'pilot');
  ok(offered?.label === 'Dock onto the big hull' && offered.why === null, `6: a hull big enough within reach is offered by name (${offered?.label})`);
  ship.speed = 200;
  ok(clamp.offerRow(ship as never, 'pilot')?.why === `slow to ${Math.round(CLAMP_TUNE.slow)} m/s first`, '6: not at two hundred metres a second, it is not');
  ship.speed = 0;
  ok(clamp.offerRow(ship as never, 'passenger')?.why === "the pilot's call", '6: and a passenger cannot ask for it');

  const said = clamp.dock(ship as never);
  ok(clamp.report().carried !== null, `6: asking puts the hull on the carrier (${said})`);
  ok(ship.ghosted, '6: ghosted from the moment it comes alongside, so nothing rams a hull that cannot move');
  ok(docking.docked(ship as never), '6: and it reads as docked, so the jump and both crossings refuse');
  ok(docking.docked(carrier as never), '6: the hull carrying it is refused the same, since nothing carries two ships across a zone change');

  // The carrier flies: straight on at a hundred metres a second, turning as it goes.
  carrier.vel.set(0, 0, 100);
  carrier.spin.set(0, 0.6, 0);
  const dt = 1 / 60;
  const wanted = new THREE.Vector3();
  const frame = new THREE.Matrix4();
  const local = new THREE.Vector3(0, 4 + CLAMP_TUNE.gap + 2, 0);
  let worst = 0;
  for (let i = 0; i < 180; i++) {
    docking.step(null, dt, null);
    carrier.fly(dt);
    ship.writeHold();
    // The draw, which is what refreshes every group's world matrix.
    carrier.group.updateMatrixWorld(true);
    ship.group.updateMatrixWorld(true);
    // Measured once the settle has run out: until then the hull is on its way to the spot, not on it.
    if (i > 100) {
      frame.compose(carrier.pos, carrier.attitude, new THREE.Vector3(1, 1, 1));
      wanted.copy(local).applyMatrix4(frame);
      worst = Math.max(worst, ship.pos.distanceTo(wanted));
    }
  }
  ok(clamp.report().carried !== null && (clamp.report().carried as { settling: number }).settling === 0, '6: the settle ends and the hull is simply carried');
  ok(worst < 0.02, `6: and through three seconds of flying and turning it never leaves the spot on the hull by more than a couple of centimetres (${(worst * 100).toFixed(1)} cm)`);
  ok(ship.attitude.angleTo(carrier.attitude) < 1e-3, '6: facing the way the carrier faces');

  // The lead off, for the comparison the owner can make live: the carried hull trails by a step.
  CLAMP_TUNE.lead = 0;
  let behind = 0;
  for (let i = 0; i < 60; i++) {
    docking.step(null, dt, null);
    carrier.fly(dt);
    ship.writeHold();
    carrier.group.updateMatrixWorld(true);
    frame.compose(carrier.pos, carrier.attitude, new THREE.Vector3(1, 1, 1));
    wanted.copy(local).applyMatrix4(frame);
    behind = Math.max(behind, ship.pos.distanceTo(wanted));
  }
  ok(behind > 1, `6: with the lead off it rides a step behind the hull (${behind.toFixed(2)} m), which is what the lead is for`);
  CLAMP_TUNE.lead = 1;

  // A frame the clamp does not step (a panel open, the map up): the hull still rides the carrier,
  // because the pose is written in the carrier's own drawn frame rather than in a copy of where it was.
  let adrift = 0;
  for (let i = 0; i < 60; i++) {
    carrier.fly(dt);
    ship.writeHold();
    carrier.group.updateMatrixWorld(true);
    frame.compose(carrier.pos, carrier.attitude, new THREE.Vector3(1, 1, 1));
    wanted.copy(local).applyMatrix4(frame);
    adrift = Math.max(adrift, ship.pos.distanceTo(wanted));
  }
  ok(adrift < 3, `6: a second of frames the clamp never stepped leaves it on the hull, not a hundred metres astern (${adrift.toFixed(2)} m)`);

  // A tab with no frames in it at all (a driven one, stepped by hand): nothing ever draws, so no group
  // world matrix is ever refreshed by a draw, and the clamp works its own out rather than waiting.
  let headless = 0;
  for (let i = 0; i < 120; i++) {
    docking.step(null, dt, null);
    carrier.fly(dt);
    ship.writeHold();
    frame.compose(carrier.pos, carrier.attitude, new THREE.Vector3(1, 1, 1));
    wanted.copy(local).applyMatrix4(frame);
    headless = Math.max(headless, ship.pos.distanceTo(wanted));
  }
  ok(headless < 0.02, `6: and two seconds of a tab that never draws keep it on the hull to the centimetre (${(headless * 100).toFixed(1)} cm)`);

  // Let go: the carrier's own motion plus a push along its up, and solid again once it is clear.
  const left = clamp.act(ship as never);
  ok(!ship.holding && ship.ghosted, `6: letting go hands the hull back but leaves it ghosted while it is still on the carrier (${left})`);
  ok(ship.vel.length() > 100, '6: flying on at what the carrier was doing, and pushed off it');
  ok(!docking.docked(ship as never) && !docking.docked(carrier as never), '6: and both hulls are their pilots\' again, so a jump is allowed');
  for (let i = 0; i < 600 && ship.ghosted; i++) {
    docking.step(null, dt, null);
    carrier.fly(dt);
    ship.pos.addScaledVector(ship.vel, dt);
  }
  ok(!ship.ghosted, '6: solid again once it is clear of the hull');
  ok(clamp.report().carried === null && clamp.report().letting === null, '6: with nothing left held or remembered');
}

// --- 7: the carrier goes away ----------------------------------------------------------------------
// A hull that is disposed has no body at all, and reading one is an engine panic that takes the rest of
// the frame with it. Whatever it was carrying is let go of before anything reads it.
{
  const carrier = hull('carrier', 'big hull', box([-12, -4, -30], [12, 4, 30]), new THREE.Vector3(0, 0, 0));
  const ship = hull('fighter', 'small hull', box([-6, -2, -9], [6, 2, 9]), new THREE.Vector3(0, 20, 0));
  const docking = new Docking(fakeWorld([carrier, ship]) as never);
  docking.clamp.dock(ship as never);
  ok(docking.clamp.report().carried !== null, '7: carried');
  carrier.disposed = true;
  docking.step(null, 1 / 60, null);
  ok(docking.clamp.report().carried === null && !ship.holding && !ship.ghosted, '7: the carrier going takes the clamp with it, and the hull falls free where it stood');
  ok(!docking.docked(ship as never), '7: and nothing goes on refusing the pilot a jump');
}

// --- 8: crossing between the two ships' rooms ------------------------------------------------------
{
  const carrier = hull('carrier', 'big hull', box([-12, -4, -30], [12, 4, 30]), new THREE.Vector3(0, 0, 0));
  const ship = hull('fighter', 'small hull', box([-6, -2, -9], [6, 2, 9]), new THREE.Vector3(0, 20, 0));
  carrier.interior = { entry: new THREE.Vector3(0, -1, 4) };
  ship.interior = { entry: new THREE.Vector3(0, 0, -1) };
  const docking = new Docking(fakeWorld([carrier, ship]) as never);
  const clamp = docking.clamp;
  const from = { kind: 'ship', ship: ship as never } as const;
  const fromCarrier = { kind: 'ship', ship: carrier as never } as const;
  ok(clamp.crossing(from, ship.interior.entry) === null, '8: with the two ships apart there is nowhere to cross to');
  clamp.dock(ship as never);
  ok(clamp.crossing(from, ship.interior.entry) === null, '8: nor while the hull is still coming alongside');
  for (let i = 0; i < 200; i++) docking.step(null, 1 / 60, null);
  const across = clamp.crossing(from, ship.interior.entry);
  ok(across?.kind === 'ship' && across.ship === (carrier as never), `8: at the small ship's own way in, the crossing is to the hull it rides (${across?.label})`);
  ok(clamp.crossing(from, new THREE.Vector3(0, 0, 400)) === null, '8: and nowhere else in the room, where E steps out as it always did');
  // The same pair without the door test: what the menu's row is written from, so it can say "stand at
  // the way in" rather than simply not being there.
  const pair = clamp.crossPair(from);
  ok(pair?.kind === 'ship' && pair.ship === (carrier as never), '8: the pair itself is known wherever in the room the walker stands');
  const back = clamp.crossing(fromCarrier, carrier.interior.entry);
  ok(back?.kind === 'ship' && back.ship === (ship as never), '8: from the carrier it goes the other way');
  // A hull with no rooms is nothing to cross into: stepping out puts you beside it, as it always did.
  carrier.interior = null;
  ok(clamp.crossing(from, ship.interior.entry) === null && clamp.crossPair(from) === null, '8: a carrier with no rooms offers no crossing');
}

// --- 8b: crossing to and from a hull another player flies -------------------------------------------
// A peer's ship is a picture with its rooms hidden and no physics until something in this browser
// builds them. Nothing here builds anything: the clamp only asks whoever does, and with nobody
// registered every answer is the one it always gave, which is what playing alone looks like.
{
  /** A room of theirs, as little of one as the crossing reads: its own way in, in that hull's frame. */
  const theirRoom = { entry: new THREE.Vector3(2, 0, -3) } as never;
  let built = false;
  /** What whoever builds the rooms says about that hull: null is "it is one, or will be once asked". */
  let refusal: string | null = null;
  const opened: number[] = [];
  const closed: number[] = [];
  const held: boolean[] = [];
  const fakeRooms: PeerRooms = {
    roomOf: (id) => (id === 3 && built ? theirRoom : null),
    idOf: (room) => (room === theirRoom ? 3 : 0),
    open: async (id) => {
      opened.push(id);
      built = true;
      return theirRoom;
    },
    aboard: (_id, yes) => void held.push(yes),
    close: (id) => void closed.push(id),
    why: () => refusal,
    nearest: () => 0,
    label: () => 'their big hull',
    hullAt: (_id, pos, vel) => {
      pos.set(0, 0, 0);
      vel.set(0, 0, 0);
      return 33;
    },
  };

  const ship = hull('fighter', 'small hull', box([-6, -2, -9], [6, 2, 9]), new THREE.Vector3(0, 20, 0));
  ship.interior = { entry: new THREE.Vector3(0, 0, -1) };
  const docking = new Docking(fakeWorld([ship]) as never);
  const clamp = docking.clamp;
  clamp.link = { id: () => 7, send: () => {} };
  clamp.peers = {
    shipPeers: (out: number[]) => ((out.length = 0), out.push(3), out),
    vehiclePose: (id, pos, quat, vel) => {
      if (id !== 3) return false;
      pos.set(0, 0, 0);
      quat.identity();
      vel.set(0, 0, 0);
      return true;
    },
    vehicleOf: (id) => (id === 3 ? { label: 'their big hull', bounds: box([-12, -4, -30], [12, 4, 30]), radius: 33 } : null),
    peerName: () => 'the other player',
  };
  clamp.dock(ship as never);
  clamp.heard(3, 'allow', ship as never);
  for (let i = 0; i < 200; i++) docking.step(null, 1 / 60, null);
  const mine = { kind: 'ship', ship: ship as never } as const;
  const theirs = { kind: 'peer', id: 3 } as const;

  ok(peerRooms() === null, '8b: with nothing registered, nothing in this browser can make a peer\'s hull a place to stand in');
  ok(clamp.crossing(mine, ship.interior.entry) === null, '8b: so the crossing into it is refused, exactly as it was before any of this');

  setPeerRooms(fakeRooms);
  refusal = 'their ship is not here';
  ok(clamp.crossing(mine, ship.interior.entry) === null, '8b: registered, but a hull nothing can make a place of is refused as it always was');
  // Built, or buildable. Gating the crossing on the rooms being up already would mean the first
  // crossing into a friend's hull could never be started: nothing else ever asks for them to be built,
  // so the wait, the note and the row would all be unreachable.
  refusal = null;
  const waits = clamp.crossing(mine, ship.interior.entry);
  ok(waits?.kind === 'peer' && waits.id === 3, '8b: a hull whose rooms are not built but could be is a crossing that waits, not one that is refused');
  ok(opened.length === 0, '8b: and asking for it still builds nothing by itself');
  built = true;
  const over = clamp.crossing(mine, ship.interior.entry);
  ok(over?.kind === 'peer' && over.id === 3 && over.label === 'their big hull', `8b: once their rooms are built the crossing names them (${over?.label})`);
  ok(clamp.crossing(mine, new THREE.Vector3(0, 0, 400)) === null, '8b: and only at our own way in, as with two hulls of this world');
  const home = clamp.crossing(theirs, theirRoom.entry);
  ok(home?.kind === 'ship' && home.ship === (ship as never), '8b: and from their rooms it goes back the same way');
  ok(clamp.crossing(theirs, new THREE.Vector3(40, 0, 0)) === null, '8b: from the far end of their cabin it does not');
  // Their hull is what our ship rides, so this is the whole of what the clamp knows of the pair.
  ship.interior = null;
  ok(clamp.crossing(theirs, theirRoom.entry) === null, '8b: with our own rooms gone there is nothing for them to cross into either');
  ship.interior = { entry: new THREE.Vector3(0, 0, -1) };

  // A ship of theirs let onto our hull: the grant is the only record this browser has of their clamp,
  // and it is the pair a crossing is offered for just as our own clamp is.
  const carrier = hull('carrier', 'big hull', box([-12, -4, -30], [12, 4, 30]), new THREE.Vector3(0, 0, 0));
  carrier.interior = { entry: new THREE.Vector3(0, -1, 4) };
  const host = new Docking(fakeWorld([carrier]) as never);
  host.clamp.link = { id: () => 1, send: () => {} };
  /** Where their ship is: the grant says nothing about that, so this is the whole of what decides it. */
  const theirAt = new THREE.Vector3(0, 400, 0);
  host.clamp.peers = {
    shipPeers: (o: number[]) => ((o.length = 0), o.push(3), o),
    vehiclePose: (id, pos, quat, vel) => {
      if (id !== 3) return false;
      pos.copy(theirAt);
      quat.identity();
      vel.set(0, 0, 0);
      return true;
    },
    vehicleOf: () => ({ label: 'their big hull', bounds: box([-6, -2, -9], [6, 2, 9]), radius: 9 }),
    peerName: () => 'the other player',
  };
  host.clamp.heard(3, 'dock', carrier as never);
  host.clamp.answer(true);
  // The grant is written the moment this pilot says yes, which is before the asking ship has flown a
  // metre of an approach that reaches fifty of them: a walker at the way in must not be put inside a
  // hull that is still four hundred metres off.
  ok(host.clamp.crossPair({ kind: 'ship', ship: carrier as never }) === null, '8b: a grant given while their ship is still out there is no crossing');
  theirAt.set(0, 10, 0);
  const outward = host.clamp.crossing({ kind: 'ship', ship: carrier as never }, carrier.interior.entry);
  ok(outward?.kind === 'peer' && outward.id === 3, '8b: once they are lying on the hull, the crossing is into their ship');
  const inward = host.clamp.crossing({ kind: 'peer', id: 3 }, theirRoom.entry);
  ok(inward?.kind === 'ship' && inward.ship === (carrier as never), '8b: and out of their ship back into ours');
  // A pilot whose own clamp never began never sends `undock`, so the grant alone would stand for the
  // rest of the session and offer a crossing into a ship that is nowhere near.
  theirAt.set(0, 400, 0);
  ok(host.clamp.crossPair({ kind: 'ship', ship: carrier as never }) === null, '8b: and they fly off without a word and the crossing goes with them');
  theirAt.set(0, 10, 0);
  host.clamp.heard(3, 'undock', carrier as never);
  ok(host.clamp.crossPair({ kind: 'ship', ship: carrier as never }) === null, '8b: they let go and there is no pair left to cross');

  ok(opened.length === 0 && closed.length === 0 && held.length === 0, '8b: and asking about a crossing never builds, takes down or steps into anything by itself');
  setPeerRooms(null);
  ok(clamp.crossing(mine, ship.interior.entry) === null, '8b: letting go of the builder puts the game back exactly where it was');
}

// --- 8c: the words of the ship menu's Board row -----------------------------------------------------
// Pure: the row is written from where the walker stands, and the menu only draws it. A row nobody can
// press is never shown at all, which is what keeps a game played alone looking like the one on main.
{
  ok(boardRow(null) === null, '8c: with nothing to cross into there is no row, so the menu is the one that was always there');
  ok(boardRow({ across: null, theirs: true, atDoor: true, opening: false, why: null }) === null, '8c: and none in a ship with nothing clamped to it');
  ok(boardRow({ across: 'big hull', theirs: false, atDoor: true, opening: false, why: null }) === null, '8c: nor between two hulls of this world, where E at the way in is instant: a game played alone never grows a row');
  const waiting = boardRow({ across: null, theirs: true, atDoor: false, opening: true, why: null });
  ok(waiting?.why === 'their rooms are being built', `8c: while their rooms are being built the row says so rather than asking again (${waiting?.label})`);
  const naming = boardRow({ across: 'big hull', theirs: true, atDoor: false, opening: true, why: null });
  ok(naming?.label === 'Crossing to the big hull…', `8c: and it names the hull where the game could name it (${naming?.label})`);
  const away = boardRow({ across: 'big hull', theirs: true, atDoor: false, opening: false, why: null });
  ok(away?.label === 'Cross to the big hull' && away.why === "stand at your own room's way in to cross", `8c: standing across the cabin it says where to stand (${away?.why})`);
  const here = boardRow({ across: 'big hull', theirs: true, atDoor: true, opening: false, why: null });
  ok(here?.label === 'Cross to the big hull' && here.why === null && here.note === 'E at the way in does the same', `8c: at the way in it can be pressed, and says the key does it too (${here?.note})`);
  const refused = boardRow({ across: 'big hull', theirs: true, atDoor: true, opening: false, why: 'they have gone' });
  ok(refused?.why === 'they have gone', '8c: and a reason given by the game wins over the row\'s own');
}

// --- 8d: the two invented numbers, and the word before a room is freed -------------------------------
{
  const before = { ...BOARD_TUNE };
  const knob = boardKnob();
  ok((knob.tune as { reach: number }).reach === before.reach && knob.builder === 'none', `8d: the knob reports what boarding is set to and whether anything can build a peer's rooms (${JSON.stringify(knob.tune)})`);
  boardKnob({ reach: 12, wait: 5 });
  ok(BOARD_TUNE.reach === 12 && BOARD_TUNE.wait === 5, '8d: and both numbers are live');
  boardKnob({ reach: -4 });
  ok(BOARD_TUNE.reach === 0, '8d: a reach below nothing is nothing, not a negative one');
  boardKnob(before);
  ok(BOARD_TUNE.reach === before.reach && BOARD_TUNE.wait === before.wait, '8d: put back');

  // The one word that must never be missed: a room about to be freed with somebody standing in it.
  const told: number[] = [];
  onPeerHullGone((id) => void told.push(id));
  peerHullGone(11);
  ok(told.length === 1 && told[0] === 11, '8d: whoever boards is told which hull is going before anything of its room is freed');
  onPeerHullGone(null);
  peerHullGone(12);
  ok(told.length === 1, '8d: and letting go of that stops it, so nothing is called into a game that has moved on');
}

// --- 9: the clamp spot lowered onto the skin -------------------------------------------------------
// A big hull's box is set by whatever stands highest on it, which on a real one is a tower well above
// the deck: a ship left at the top of the box would ride the tower's height above the hull. One ray
// straight down its back lowers the spot onto what the hull really has under it.
{
  const physics = await Physics.create();
  const deckBody = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, 0, 0));
  // The deck: 40 across, 6 high, 120 long, its top at y 3.
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(20, 3, 60), deckBody);
  // A tower standing on it well aft, 20 m tall: what sets the box's top and nothing else.
  physics.world.createCollider(RAPIER.ColliderDesc.cuboid(2, 10, 2).setTranslation(0, 13, -40), deckBody);
  // Rapier sees nothing until the world has stepped once.
  physics.world.step();
  const shipBody = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 60, 0));
  physics.world.createCollider(RAPIER.ColliderDesc.ball(1), shipBody);
  physics.world.step();

  const carrier = hull('carrier', 'big hull', box([-20, -3, -60], [20, 23, 60]), new THREE.Vector3(0, 0, 0), deckBody as unknown as FakeBody);
  const ship = hull('fighter', 'small hull', box([-6, -2, -9], [6, 2, 9]), new THREE.Vector3(0, 40, 0), shipBody as unknown as FakeBody);
  const docking = new Docking(fakeWorld([carrier, ship], physics) as never);
  docking.clamp.dock(ship as never);
  const at = (docking.clamp.report().carried as { at: number[] }).at;
  ok(near(at[1], 3 + CLAMP_TUNE.gap + 2, 0.05), `9: the hull rests on the deck the ray found, not on the top of the box (${at[1]} against ${23 + CLAMP_TUNE.gap + 2})`);
  ok(near(at[0], 0, 1e-6) && near(at[2], 0, 1e-6), '9: over the middle of the carrier, as before');
  // Worked out once per pair of hulls: a second ask of the same two does not cast again.
  ok((docking.clamp.report().spots as number) === 1, '9: and the spot is worked out once per pair of hulls, not once per press');
  ok((docking.clamp.report().missedSkin as number) === 0, '9: with the ray finding the hull, so nothing was guessed at');

  // A ray whose hit is not the carrier's own body (something parked in the way, a hull the query cannot
  // see just then) must not be kept. The box's top is used for that one press and the pair is left
  // unlearned, so the next press casts again rather than pinning the two hulls a mast's height apart
  // for the rest of the session. Here the carrier is not the body the deck belongs to.
  const gone = hull('carrier', 'big hull', box([-20, -3, -60], [20, 23, 60]), new THREE.Vector3(0, 0, 0));
  const other = hull('fighter', 'small hull', box([-6, -2, -9], [6, 2, 9]), new THREE.Vector3(0, 40, 0), shipBody as unknown as FakeBody);
  const blind = new Docking(fakeWorld([gone, other], physics) as never);
  blind.clamp.dock(other as never);
  const high = (blind.clamp.report().carried as { at: number[] }).at;
  ok(near(high[1], 23 + CLAMP_TUNE.gap + 2, 1e-6), '9: a ray that finds nothing leaves the hull at the top of the box');
  ok((blind.clamp.report().spots as number) === 0 && (blind.clamp.report().missedSkin as number) === 1, '9: and that answer is counted as a miss and not kept, so the next press casts again');
  physics.dispose?.();
}

// --- 10: what the relay keeps of a clamp -----------------------------------------------------------
{
  const veh = (extra: Record<string, unknown> = {}) => ({ id: 'a_ship', p: [1, 2, 3], q: [0, 0, 0, 1], role: 'pilot', ...extra });
  const dock = { to: 4, p: [0, 9, 0], q: [0, 0, 0, 1] };
  ok(JSON.stringify(cleanVehicle(veh({ dock }))?.dock) === JSON.stringify(dock), '10: whose ship carries this one, and where on it, are kept');
  ok(cleanVehicle(veh())?.dock === undefined, '10: a client that sends nothing about a clamp has none kept (an older build)');
  ok(cleanDock({ to: 0, p: [0, 0, 0], q: [0, 0, 0, 1] }) === undefined, '10: nobody is not a player to be carried by');
  ok(cleanDock({ to: 1.5, p: [0, 0, 0], q: [0, 0, 0, 1] }) === undefined, '10: nor is half a player');
  ok(cleanDock({ to: 2, p: [0, 0], q: [0, 0, 0, 1] }) === undefined, '10: a place with two numbers in it is not a place');
  ok(cleanDock({ to: 2, p: [0, 'x', 0], q: [0, 0, 0, 1] }) === undefined, '10: and a word in the middle of one is not either');
  ok(JSON.stringify(cleanAsk({ to: 3, word: 'dock' })) === JSON.stringify({ to: 3, word: 'dock' }), '10: a word meant for one player is kept');
  ok(cleanAsk({ to: 3, word: 'ram' }) === undefined, '10: a word nobody knows is dropped rather than passed on');
  ok(cleanAsk({ to: 0, word: 'dock' }) === undefined && cleanAsk({ word: 'dock' }) === undefined, '10: and one addressed to nobody goes nowhere');
}

// --- 11: asking another player, and the answer -----------------------------------------------------
// One browser's side of it, with the relay stood in for: a request goes out, their answer comes back,
// and the hull is put on their ship's picture, which is all this browser has of it.
{
  const ship = hull('fighter', 'small hull', box([-6, -2, -9], [6, 2, 9]), new THREE.Vector3(0, 20, 0));
  const docking = new Docking(fakeWorld([ship]) as never);
  const clamp = docking.clamp;
  const sent: { to: number; word: ClampWord }[] = [];
  clamp.link = { id: () => 7, send: (to, word) => void sent.push({ to, word }) };
  const theirs = { pos: new THREE.Vector3(0, 0, 0), quat: new THREE.Quaternion() };
  clamp.peers = {
    shipPeers: (out: number[]) => {
      out.length = 0;
      out.push(3);
      return out;
    },
    vehiclePose: (id, pos, quat, vel) => {
      if (id !== 3) return false;
      pos.copy(theirs.pos);
      quat.copy(theirs.quat);
      vel.set(0, 0, 0);
      return true;
    },
    vehicleOf: (id) => (id === 3 ? { label: 'big hull', bounds: box([-12, -4, -30], [12, 4, 30]), radius: 33 } : null),
    peerName: () => 'the other player',
  };

  ok(clamp.dock(ship as never).includes('asked'), '11: a ship of another player\'s is asked for rather than taken');
  ok(sent.length === 1 && sent[0].to === 3 && sent[0].word === 'dock', '11: and the asking goes to that player alone');
  ok(clamp.report().carried === null, '11: nothing is carried until they answer');
  ok(clamp.row(ship as never, 'pilot')?.why === 'waiting for their answer', '11: the row says what it is waiting for');
  // The wait belongs to the hull it was asked for. A pilot who stepped into another ship meanwhile is
  // not kept from a station's lane for twenty seconds by a question that is not about the hull they fly.
  const another = hull('hauler', 'another hull', box([-6, -2, -9], [6, 2, 9]), new THREE.Vector3(0, 60, 0));
  ok(clamp.row(another as never, 'pilot') === null && clamp.act(another as never, false) === null, '11: and it blocks nothing for a different hull');
  clamp.heard(3, 'refuse', ship as never);
  ok(clamp.report().carried === null && clamp.report().waiting === null, '11: they say no and the hull stays where it is');

  // An answer is up to twenty seconds old by the time it arrives, and nothing about this hull was
  // looked at again when it was sent. So the press's own checks are made again here: a ship that has
  // flown off, or is doing three hundred metres a second by then, is not eased on from where it is.
  clamp.dock(ship as never);
  const far = ship.pos.clone();
  ship.pos.set(0, 5000, 0);
  sent.length = 0;
  clamp.heard(3, 'allow', ship as never);
  ok(clamp.report().carried === null, '11: an answer that comes back after the ship has flown off does not clamp it from five kilometres');
  ok(sent.some((m) => m.to === 3 && m.word === 'undock'), '11: and their side is told at once that the clamp is off');
  ship.pos.copy(far);
  clamp.dock(ship as never);
  ship.speed = 300;
  sent.length = 0;
  clamp.heard(3, 'allow', ship as never);
  ok(clamp.report().carried === null && sent.some((m) => m.word === 'undock'), '11: nor at three hundred metres a second, however near it is');
  ship.speed = 0;

  clamp.dock(ship as never);
  clamp.heard(3, 'allow', ship as never);
  ok(clamp.report().carried !== null, '11: they say yes and the hull is put on their ship');
  for (let i = 0; i < 200; i++) docking.step(null, 1 / 60, null);
  ok(near(ship.pos.y, 4 + CLAMP_TUNE.gap + 2, 1e-3), `11: at the spot on the picture of their hull (${ship.pos.y.toFixed(2)} m up)`);
  const wire = clamp.wire(ship as never);
  ok(wire?.to === 3 && near(wire.p[1], 4 + CLAMP_TUNE.gap + 2, 1e-3), '11: and the others are told whose hull it is on and where on it');
  // Their hull moves: the picture is the only thing this browser has of it, and the clamp rides it.
  theirs.pos.set(300, -50, 120);
  for (let i = 0; i < 4; i++) docking.step(null, 1 / 60, null);
  ok(near(ship.pos.x, 300, 1e-3) && near(ship.pos.z, 120, 1e-3), '11: the hull goes with it');
  clamp.heard(3, 'undock', ship as never);
  ok(clamp.report().carried === null, '11: and their pilot can put it off again');
}

// --- 12: a request from another player, answered ---------------------------------------------------
{
  const mine = hull('carrier', 'big hull', box([-12, -4, -30], [12, 4, 30]), new THREE.Vector3(0, 0, 0));
  const docking = new Docking(fakeWorld([mine]) as never);
  const clamp = docking.clamp;
  const sent: { to: number; word: ClampWord }[] = [];
  clamp.link = { id: () => 1, send: (to, word) => void sent.push({ to, word }) };
  // Their ship's picture, which is what says a peer let onto this hull is still there.
  const theirs = { label: 'small hull', bounds: box([-6, -2, -9], [6, 2, 9]), radius: 9 };
  let here = true;
  clamp.peers = { shipPeers: (o: number[]) => ((o.length = 0), o), vehiclePose: () => false, vehicleOf: () => (here ? theirs : null), peerName: () => 'the other player' };

  clamp.heard(5, 'dock', mine as never);
  const row = clamp.row(mine as never, 'pilot');
  ok(row?.label === 'Let the other player dock', `12: the row becomes the question, and it is the pilot's to answer (${row?.label})`);
  ok(clamp.row(mine as never, 'passenger')?.why === "the pilot's call", '12: a passenger cannot answer it');
  ok(docking.act(mine as never).includes('may dock'), '12: pressing it lets them on');
  ok(sent.some((m) => m.to === 5 && m.word === 'allow'), '12: and the answer goes back to them alone');
  ok(docking.docked(mine as never), '12: the hull that has let somebody on is itself refused the jump and both crossings');

  // A second player asking while one is already on: there is one spot per pair of hulls, so the two
  // would be drawn inside each other. They are turned away rather than granted the same place.
  sent.length = 0;
  clamp.heard(9, 'dock', mine as never);
  ok(clamp.report().asked === null && sent.some((m) => m.to === 9 && m.word === 'refuse'), '12: a second asker is turned away while somebody is already on the hull');
  // They let go, or they go: either way the hull is the pilot's again.
  clamp.heard(5, 'undock', mine as never);
  ok(!docking.docked(mine as never), '12: they let go and the hull is free to jump again');
  clamp.heard(5, 'dock', mine as never);
  docking.act(mine as never);
  here = false;
  docking.step(null, 1 / 60, null);
  ok(!docking.docked(mine as never), '12: and a player who simply goes does not leave the hull refused for ever');
  here = true;

  // A press the station's own dock is in the middle of: the caller says so by handing the clamp no
  // ship, and the clamp must not answer it. A Launch that granted somebody's request instead of
  // launching would leave the pilot's ship on the dock and a peer on their hull.
  clamp.heard(7, 'dock', mine as never);
  ok(clamp.act(null) === null && clamp.report().asked !== null, '12: a press the station has the answer to is not the clamp\'s to take, and the question still stands');
  clamp.answer(false);

  // Turned away, and left unanswered: both say so, and neither leaves the row stuck on the question.
  clamp.heard(6, 'dock', mine as never);
  ok(docking.tune({ allow: false }) && clamp.report().asked === null, '12: __debug.dock({ allow: false }) turns them away');
  ok(sent.some((m) => m.to === 6 && m.word === 'refuse'), '12: and tells them so');
  clamp.heard(8, 'dock', mine as never);
  for (let i = 0; i < 60 * 30; i++) docking.step(null, 1 / 60, null);
  ok(clamp.report().asked === null && clamp.row(mine as never, 'pilot') === null, '12: a question nobody answers lapses rather than standing for ever');
}

// --- 13: in space and nowhere else ------------------------------------------------------------------
// Everything about one ship riding another is written for space: a carried hull is held out of its own
// flight altogether, which over ground would be no crash, no wings and no landing. So a planet offers
// the row no differently from before, and a press there does nothing.
{
  const carrier = hull('carrier', 'big hull', box([-12, -4, -30], [12, 4, 30]), new THREE.Vector3(0, 0, 0));
  const ship = hull('fighter', 'small hull', box([-6, -2, -9], [6, 2, 9]), new THREE.Vector3(0, 20, 0));
  const ground = { ...fakeWorld([carrier, ship]), planet: {} };
  const docking = new Docking(ground as never);
  const row = docking.menuRow(ship as never, 'pilot', false);
  ok(row.label === 'Dock' && row.why === 'only in space', `13: on a planet the row is what it always was (${row.why})`);
  ok(docking.act(ship as never) === 'docking is for space' && docking.clamp.report().carried === null, '13: and a press there carries nothing');
  // In space the same two hulls offer it, which is what says the gate is the zone and not the hulls.
  const above = new Docking(fakeWorld([carrier, ship]) as never);
  ok(above.menuRow(ship as never, 'pilot', true).label === 'Dock onto the big hull', '13: in orbit the same two hulls offer it');
}

// --- 14: the relay itself, with three connections --------------------------------------------------
// The one message meant for a single player. Everything else the relay passes goes to everyone, so this
// is the only place where "and to nobody else" has to be true, and the only way to see it is to run it.
if (typeof WebSocket === 'undefined') {
  console.log('note the relay round trip was skipped: this node has no WebSocket of its own');
} else {
  const port = 18787;
  process.env.PORT = String(port);
  await import('../../../server/relay.mjs');

  /** A connection with its id and everything it has been sent. */
  async function connect(name: string): Promise<{ id: number; got: Record<string, unknown>[]; send: (m: unknown) => void }> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const got: Record<string, unknown>[] = [];
    let id = 0;
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', () => reject(new Error(`${name} could not connect`)));
    });
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(String((e as MessageEvent).data)) as Record<string, unknown>;
      if (m.t === 'welcome') id = Number(m.id);
      got.push(m);
    });
    const send = (m: unknown) => ws.send(JSON.stringify(m));
    send({ t: 'hello', name, species: 'human_male', class: 'jedi', planet: 'a world' });
    await settle();
    return {
      get id() {
        return id;
      },
      got,
      send,
    };
  }
  const settle = () => new Promise((r) => setTimeout(r, 120));

  const a = await connect('one');
  const b = await connect('two');
  const c = await connect('three');
  await settle();
  ok(a.id > 0 && b.id > 0 && c.id > 0 && a.id !== b.id, `13: three players on the relay (${a.id}, ${b.id}, ${c.id})`);

  b.got.length = 0;
  c.got.length = 0;
  a.send({ t: 'ask', to: b.id, word: 'dock' });
  await settle();
  const asked = b.got.filter((m) => m.t === 'ask');
  ok(asked.length === 1 && asked[0].id === a.id && asked[0].word === 'dock', `13: the question reaches the player it was addressed to (${JSON.stringify(asked[0])})`);
  ok(!c.got.some((m) => m.t === 'ask'), '14: and nobody else hears it');

  a.got.length = 0;
  b.send({ t: 'ask', to: a.id, word: 'allow' });
  await settle();
  ok(a.got.some((m) => m.t === 'ask' && m.word === 'allow'), '14: the answer comes back the same way');

  b.got.length = 0;
  c.got.length = 0;
  a.send({ t: 'ask', to: 9999, word: 'dock' });
  a.send({ t: 'ask', to: b.id, word: 'ram' });
  a.send({ t: 'ask', word: 'dock' });
  await settle();
  ok(!b.got.some((m) => m.t === 'ask') && !c.got.some((m) => m.t === 'ask'), '14: a player who is not there, a word nobody knows and no address at all all go nowhere');

  // And the clamp in a state, through the relay's own checking, to everyone as usual.
  b.got.length = 0;
  a.send({ t: 'state', p: [1, 2, 3], h: 0, s: 'seated', v: 0, m: true, veh: { id: 'a_ship', p: [1, 2, 3], q: [0, 0, 0, 1], role: 'pilot', dock: { to: b.id, p: [0, 9, 0], q: [0, 0, 0, 1] } } });
  await settle();
  const state = b.got.find((m) => m.t === 'state') as { veh?: { dock?: { to: number; p: number[] } } } | undefined;
  ok(state?.veh?.dock?.to === b.id && state.veh.dock.p[1] === 9, `14: and a ship clamped onto another is passed on with it (${JSON.stringify(state?.veh?.dock)})`);

  console.log(`\n${checks} checks passed`);
  // The relay keeps a timer of its own alive, so this says when it is done rather than hanging on it.
  process.exit(0);
}

console.log(`\n${checks} checks passed`);
