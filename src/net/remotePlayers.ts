// The other players: each one a rig of its species, stood where the relay last said, gliding to
// each new place, playing the state the other's rig plays, with a name over its head.
import * as THREE from 'three';
import { CharacterRig, loadPlayerRig, type RigState } from '../player/rig';
import { markActor } from '../world/portalRender';
import { isDanceClip, isFlourishClip, loopsEmote } from '../core/emotes';
import type { Hello, PeerState, PeerVehicle } from './net';
import { easeInHull, MIN_GLIDE_SECONDS, peerAboard, placeInHull } from './aboardMath.ts';
import type { Garage } from '../vehicles/garage';
import type { WingSet } from '../vehicles/wings';
import { changedSlots, fitKey, type ResolvedFit, type ShipFit } from '../vehicles/shipFit';
import type { ShipBuild } from '../vehicles/shipMounts';
import type { ShipPaint } from '../vehicles/shipPaint';
import { applyLookPrepared } from '../player/look';
import { weaponHolder, type WeaponCatalogue } from '../player/weapons';
import type { FxMoverList } from '../core/fx/velocity';
import { RELAY, stepRelayVelocity } from '../core/fx/velocityMath.ts';

/** The vehicle a peer is on, as a picture: which, where it is heading to, and how it is turned. */
interface RemoteVehicle {
  id: string;
  obj: THREE.Object3D | null;
  target: THREE.Vector3;
  targetQ: THREE.Quaternion;
  pose: string | null;
  /** Its world velocity from the relay's messages (m/s): its glide between them is not its speed. */
  vel: THREE.Vector3;
  /** performance.now() of its last message; 0 before the first. */
  heardAt: number;
  /** Its wings that open, once the picture is in (moved as the pilot's are); null before, or for a ride with none. */
  wings: WingSet | null;
  /** Whether the pilot's wings are open or opening: the relay's `w`, else (a peer on an older build) whether it is moving. */
  wingsWant: boolean;
  /** Set down on the ground (the relay's `landed`): the picture is put exactly where it is said to be, with no glide. */
  landed: boolean;
  /**
   * Clamped onto another player's ship (the relay's `dock`): whose, and where it rests in that ship's
   * frame. The picture is then drawn from the carrier's pose times this rather than glided to each
   * message, so it sits still on the hull it rides however the hull moves.
   */
  dock: { to: number; p: THREE.Vector3; q: THREE.Quaternion } | null;
  /** Its hull's box and bounding radius from the garage, for anything that must know how big it is; null before the picture is in. */
  size: { label: string; bounds: { min: number[]; max: number[] }; radius: number } | null;
  /** A fitted ship's build (its parts per slot, for a restage), its paint (disposed with the picture) and the fit it shows; null before the picture is in, or for a ride without a fit. */
  build: ShipBuild | null;
  paint: ShipPaint | null;
  fit: ResolvedFit | null;
  /** A refit of the picture under way, and the newest fit asked for meanwhile (the running pass takes it up when it ends). */
  busy: Promise<void> | null;
  want: ShipFit | null;
}

/**
 * A peer standing in a hull somebody else flies: whose (their relay id), where in that hull's own
 * frame the messages put them, and where the glide has got to. The place is eased in the hull's
 * frame and the figure is then carried onto the hull's live pose, so it keeps its seat however the
 * hull moves; a world place eased on its own would swim about the cabin, because the figure and
 * the hull come from two players' messages on two clocks.
 */
interface RemoteAboard {
  ship: number;
  /** Where the last message put them, in the hull's frame, and which way they faced. */
  target: THREE.Vector3;
  heading: number;
  /** Where the glide has got to, in the same frame. */
  at: THREE.Vector3;
  turn: number;
  /** Before the first message of this hull: the glide starts where they are rather than crossing the cabin. */
  first: boolean;
}

interface Remote {
  id: number;
  hello: Hello;
  group: THREE.Group;
  rig: CharacterRig | null;
  label: THREE.Sprite;
  target: THREE.Vector3;
  heading: number;
  /** The figure's whole turn, when the peer sends one (aboard a hull, adrift). */
  targetQ: THREE.Quaternion | null;
  state: string;
  speed: number;
  saber: boolean;
  /** Seconds since the last state: past a while the figure stands still. */
  silent: number;
  /** The dance loop playing, to come back to after a flourish. */
  dance: string | null;
  vehicle: RemoteVehicle | null;
  /** In a hull somebody else flies; null when they are not. It and `vehicle` are never both set. */
  aboard: RemoteAboard | null;
  /** The look last put on the rig, so a repeated hello does not dress it again. */
  lookApplied: string | null;
  /** The dress of `lookApplied` while it goes on (resolved once it is on, or given up for a newer one); null before any. */
  lookPending: Promise<void> | null;
  /** The weapons last hung in its hands (`right|left` ids), or null when they are still to be (the rack was not in yet). */
  heldApplied: string | null;
  /** The holders hung on its hand bones. */
  heldModels: THREE.Object3D[];
  /** Its world velocity from the relay's messages (m/s), for the motion blur: the glide pulses ten times a second. */
  vel: THREE.Vector3;
  /** performance.now() of its last state message. */
  heardAt: number;
  /** In a hyperspace jump (the relay's `j`): neither the figure nor the ship is shown until a state comes without it. */
  jumping: boolean;
}

const STATES: Set<string> = new Set(['idle', 'walk', 'run', 'air', 'seated', 'swim', 'float', 'crouch', 'crouchWalk', 'crouchWalkBack', 'stance', 'strafeLeft', 'strafeRight', 'runBack', 'walkBack', 'runSaber', 'walkSaber', 'gunIdle', 'gunWalk', 'gunRun', 'gunReadyIdle', 'gunReadyWalk', 'gunReadyRun', 'gunAimIdle', 'gunAimWalk', 'gunAimRun', 'kneel', 'prone', 'proneMove']);

export class RemotePlayers {
  private readonly remotes = new Map<number, Remote>();
  /** The world the local player is on: peers elsewhere are kept but not shown. */
  private planet = '';
  private zone: string | undefined;

  /** The garage, for the vehicles the peers ride (loaded the first time one is seen). */
  private garage: Promise<Garage> | null = null;

  /** Called with a peer's rig once it is dressed, and again when their look changes: the motion blur prepares its shaders for it. */
  onDressed: ((root: THREE.Object3D) => void) | null = null;
  /** The weapons rack, for the weapons the peers hold (null until it is in). */
  weapons: (() => WeaponCatalogue | null) | null = null;
  /** Compile something of a peer's before it is shown (the world's actor preparation and the motion blur's). */
  prepare: ((root: THREE.Object3D) => Promise<void>) | null = null;
  /** Compile a peer's ride before it is shown (the world's vehicle preparation); set by the game after construction, read when a ride arrives. */
  prepareVehicle: ((roots: THREE.Object3D[]) => Promise<void>) | null = null;
  /** Take a peer's ship's paint copies out of the world's material sets when they go (World.forgetMaterials); set by the game after construction, read when a paint is made. */
  forget: ((materials: THREE.Material[]) => void) | null = null;
  /**
   * Where the ship of the player with this relay id stands, for a picture clamped onto it. The game
   * answers for its own id (a peer docked onto the ship this player is on, which is no peer's picture);
   * false for anyone else, and the peers' own pictures are used instead.
   */
  carrierPose: ((to: number, pos: THREE.Vector3, quat: THREE.Quaternion) => boolean) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly baseUrl: string,
    private readonly loadGarage: () => Promise<Garage>,
  ) {
    // The knob at the foot of this file has no other way to reach the peers; there is one set.
    thePeers = this;
  }

  /** What the last state said about the hull this player stands in; written once per message at most, never in a frame. */
  private readonly sentAboard = { carrier: 0, p: [0, 0, 0], h: 0, at: 0 };

  /**
   * The game says what its last state carried about standing in somebody's hull, so the knob can
   * report it. Nothing else reads it, and it is called once per message sent, never in a frame.
   */
  noteAboardSent(carrier: number, x: number, y: number, z: number, h: number): void {
    const s = this.sentAboard;
    s.carrier = carrier;
    s.p[0] = x;
    s.p[1] = y;
    s.p[2] = z;
    s.h = h;
    s.at = Date.now();
  }

  /**
   * What this browser last said about the hull it stands in, and who else says they stand in one:
   * whose hull, whether that hull is here to put them in, and where in it they are standing. For
   * `__aboard()` and nothing else, so it allocates freely and reads its own scratch rather than the
   * scratch a frame is using.
   */
  aboardDebug(): Record<string, unknown> {
    const peers: { id: number; name: string; ship: number; here: boolean; at: number[] }[] = [];
    for (const r of this.remotes.values()) {
      const a = r.aboard;
      if (!a) continue;
      peers.push({ id: r.id, name: r.hello.name, ship: a.ship, here: this.carrierShown(a.ship) && this.carrierAt(a.ship, reportPos, reportQuat), at: a.at.toArray().map((n) => Number(n.toFixed(2))) });
    }
    const s = this.sentAboard;
    return {
      // A forced carrier is said to be forced: it is a test override, and a player whose own ship
      // has stopped crossing because they left it on must be able to see why in one word.
      sending: s.carrier > 0 ? (ABOARD_TUNE.carrier > 0 ? 'in (forced)' : 'in') : 'veh',
      sent: { carrier: s.carrier, p: s.p.map((n) => Number(n.toFixed(2))), h: Number(s.h.toFixed(3)), secondsAgo: s.at ? Number(((Date.now() - s.at) / 1000).toFixed(1)) : null },
      peers,
    };
  }

  get count(): number {
    return this.remotes.size;
  }

  /** How many are on this world, and their names. */
  here(): string[] {
    return [...this.remotes.values()].filter((r) => this.sameWorld(r.hello)).map((r) => r.hello.name);
  }

  setWorld(planet: string, zone: string | undefined): void {
    this.planet = planet;
    this.zone = zone;
    for (const r of this.remotes.values()) r.group.visible = this.shown(r);
  }

  private sameWorld(h: Hello): boolean {
    return h.planet === this.planet && (h.zone ?? undefined) === this.zone;
  }

  /** Shown: on this world and not in a jump. */
  private shown(r: Remote): boolean {
    return !r.jumping && this.sameWorld(r.hello);
  }

  add(id: number, hello: Hello): void {
    this.remove(id);
    const group = new THREE.Group();
    group.visible = this.sameWorld(hello);
    const label = makeLabel(hello.name);
    label.position.y = 2.15;
    group.add(label);
    this.scene.add(group);
    markActor(group);
    const remote: Remote = { id, hello, group, rig: null, label, target: new THREE.Vector3(0, -1000, 0), heading: 0, targetQ: null, state: 'idle', speed: 0, saber: false, silent: 0, dance: null, vehicle: null, aboard: null, lookApplied: null, lookPending: null, heldApplied: null, heldModels: [], vel: new THREE.Vector3(), heardAt: 0, jumping: false };
    this.remotes.set(id, remote);
    void this.dress(remote);
  }

  /** The rig of the peer's species, put under its group once it loads (the placeholder is nothing meanwhile). */
  private async dress(remote: Remote): Promise<void> {
    const species = remote.hello.species;
    try {
      const rig = await loadPlayerRig(this.baseUrl, species);
      if (this.remotes.get(remote.id) !== remote || remote.hello.species !== species) return;
      rig.root.scale.setScalar(rig.scale);
      // Hidden until its look is on and its shaders compiled, as a fighter is: the first sight of a
      // peer must not be a stall.
      rig.root.visible = false;
      remote.group.add(rig.root);
      markActor(rig.root);
      remote.rig = rig;
      // A new rig wears nothing of the old one's: its look goes on afresh, even when the look is the same.
      remote.lookApplied = null;
      remote.lookPending = null;
      remote.heldApplied = null;
      remote.heldModels = [];
      remote.rig.setState('idle');
      try {
        await this.applyLook(remote);
        // A newer look that arrived meanwhile is still going on (the first gave way to it): the rig
        // waits for the last one, or it would show in the pack's default dress for a moment.
        await this.lookSettled(remote, rig);
        if (remote.rig === rig) await (this.prepare ?? noPrepare)(rig.root);
      } finally {
        rig.root.visible = true;
      }
      if (remote.rig !== rig) return;
      this.onDressed?.(rig.root);
      await this.applyHeld(remote);
    } catch (err) {
      console.warn(`remote player ${remote.hello.name}: no rig for ${species}`, err);
    }
  }

  /**
   * The peer's look on its rig: shape, height, colours and outfit, as their hello gives it (once per
   * look). A change of clothes goes on as the player's own does: loaded hidden, compiled, then shown,
   * and a newer look arriving meanwhile wins. The same look asked for again answers with the dress
   * already going, so whoever waits on it waits until it is on.
   */
  private applyLook(r: Remote): Promise<void> {
    const c = r.rig?.character;
    const look = r.hello.look;
    if (!c || !look) return Promise.resolve();
    const key = JSON.stringify(look);
    if (r.lookApplied === key) return r.lookPending ?? Promise.resolve();
    r.lookApplied = key;
    const alive = () => this.remotes.get(r.id) === r && r.rig?.character === c && r.lookApplied === key;
    const pending = applyLookPrepared(c, look, this.baseUrl, this.prepare ?? noPrepare, alive).catch((err) => {
      console.warn(`remote player ${r.hello.name}: their look did not go on`, err);
    });
    r.lookPending = pending;
    return pending;
  }

  /** Until the last look asked for on this rig has gone on (each one started meanwhile is waited for in turn), or the rig is gone. */
  private async lookSettled(r: Remote, rig: CharacterRig): Promise<void> {
    for (;;) {
      const pending = r.lookPending;
      if (pending) await pending;
      if (this.remotes.get(r.id) !== r || r.rig !== rig || r.lookPending === pending) return;
    }
  }

  /**
   * The weapons in the peer's hands, as their hello names them: each model prepared before it is hung on
   * the hand bone (every time, as the player's own are). The rack not in yet: tried again by refreshHeld.
   */
  private async applyHeld(r: Remote): Promise<void> {
    const rig = r.rig;
    if (!rig) return;
    const held = r.hello.held;
    const key = `${held?.r ?? ''}|${held?.l ?? ''}`;
    if (r.heldApplied === key) return;
    const cat = this.weapons?.() ?? null;
    if ((held?.r || held?.l) && !cat) {
      r.heldApplied = null;
      return;
    }
    r.heldApplied = key;
    for (const m of r.heldModels) m.removeFromParent();
    r.heldModels = [];
    if (!cat) return;
    for (const [role, id] of [['rightHand', held?.r], ['leftHand', held?.l]] as const) {
      if (!id) continue;
      const def = cat.weapons.find((w) => w.id === id);
      const bone = rig.boneFor(role);
      if (!def || !bone) continue;
      try {
        const model = await cat.model(def);
        const holder = weaponHolder(rig.root, bone, def, model);
        await (this.prepare ?? noPrepare)(holder);
        if (this.remotes.get(r.id) !== r || r.rig !== rig || r.heldApplied !== key) return;
        bone.add(holder);
        markActor(holder);
        r.heldModels.push(holder);
      } catch (err) {
        console.warn(`remote player ${r.hello.name}: their ${id} did not load`, err);
      }
    }
  }

  /** The weapons rack came in: every peer whose weapons were waiting for it is armed. */
  refreshHeld(): void {
    for (const r of this.remotes.values()) if (r.rig && r.heldApplied === null) void this.applyHeld(r);
  }

  hello(id: number, hello: Hello): void {
    const r = this.remotes.get(id);
    if (!r) return;
    const speciesChanged = r.hello.species !== hello.species;
    r.hello = hello;
    if (!speciesChanged)
      void this.applyLook(r).then(() => {
        if (!r.rig) return;
        this.onDressed?.(r.rig.root);
        void this.applyHeld(r);
      });
    // A peer in a jump that moved them to this world stays hidden until their state says the tunnel has opened.
    r.group.visible = this.shown(r);
    // Their ship's fit changed (they closed its Edit page): the picture of it is repainted or refitted in place. A
    // ship other than the one they ride now changes nothing yet; its fit applies when that ship appears.
    const rv = r.vehicle;
    if (rv && hello.ship && hello.ship.id === rv.id) void this.refitRemote(r, rv, hello.ship.fit);
    (r.label.material as THREE.SpriteMaterial).map?.dispose();
    r.group.remove(r.label);
    r.label = makeLabel(hello.name);
    r.label.position.y = 2.15;
    r.group.add(r.label);
    if (speciesChanged) {
      if (r.rig) r.group.remove(r.rig.root);
      r.rig = null;
      void this.dress(r);
    }
  }

  state(id: number, s: PeerState): void {
    const r = this.remotes.get(id);
    if (!r) return;
    const first = r.target.y < -900;
    // Its speed from the messages themselves, smoothed: the glide below is a sawtooth around it.
    const now = performance.now();
    if (!first) stepRelayVelocity(r.vel, s.p[0] - r.target.x, s.p[1] - r.target.y, s.p[2] - r.target.z, (now - r.heardAt) / 1000);
    r.heardAt = now;
    r.target.set(s.p[0], s.p[1], s.p[2]);
    if (first) r.group.position.copy(r.target);
    r.heading = s.h;
    r.targetQ = s.q && s.q.length === 4 ? (r.targetQ ?? new THREE.Quaternion()).set(s.q[0], s.q[1], s.q[2], s.q[3]).normalize() : null;
    r.state = STATES.has(s.s) ? s.s : 'idle';
    r.speed = s.v;
    r.saber = s.sab;
    r.silent = 0;
    this.rideState(r, s.veh, s.in);
    // In a jump they vanish; out of it they appear where they are now, not gliding across the distance jumped.
    const jumping = s.j === 1;
    if (jumping !== r.jumping) {
      r.jumping = jumping;
      r.group.visible = this.shown(r);
      if (!jumping) {
        r.group.position.copy(r.target);
        r.vel.set(0, 0, 0);
        const rv = r.vehicle;
        if (rv) {
          rv.vel.set(0, 0, 0);
          if (rv.obj) {
            rv.obj.position.copy(rv.target);
            rv.obj.quaternion.copy(rv.targetQ);
          }
        }
      }
    }
  }

  /**
   * What a peer is on: a vehicle of their own, which everyone draws, or the hull of somebody else's
   * ship, which only the player who flies it sends. One or the other, never both -- that is the
   * whole point of it. Two people crewing one ship both sending the hull had everyone else build
   * two of it in the same place, fighting for the same pixels, with two sets of engine glows and
   * trails and both handed to the motion blur.
   */
  private rideState(r: Remote, veh: PeerVehicle | undefined, said: unknown): void {
    // Checked here as well as where the message was read: a state also arrives straight out of the
    // roster a server sends on joining, which no live message has been through, and a hull with no
    // place in it would be indexed below.
    const aboard = peerAboard(said);
    if (!aboard) {
      r.aboard = null;
      this.vehicleState(r, veh);
      return;
    }
    // In somebody else's hull: no picture of a hull of their own, whatever they may also have sent.
    this.dropVehicle(r);
    const a = (r.aboard ??= { ship: 0, target: new THREE.Vector3(), heading: 0, at: new THREE.Vector3(), turn: 0, first: true });
    if (a.ship !== aboard.ship) {
      a.ship = aboard.ship;
      a.first = true;
    }
    a.target.set(aboard.p[0], aboard.p[1], aboard.p[2]);
    a.heading = aboard.h;
    if (a.first) {
      a.at.copy(a.target);
      a.turn = a.heading;
      a.first = false;
    }
  }

  /** The vehicle a peer is on: brought in when first seen (or changed), moved along after, taken away when they are off it. */
  private vehicleState(r: Remote, veh: PeerVehicle | undefined): void {
    if (!veh) {
      this.dropVehicle(r);
      return;
    }
    if (!r.vehicle || r.vehicle.id !== veh.id) {
      this.dropVehicle(r);
      const rv: RemoteVehicle = { id: veh.id, obj: null, target: new THREE.Vector3(veh.p[0], veh.p[1], veh.p[2]), targetQ: new THREE.Quaternion(veh.q[0], veh.q[1], veh.q[2], veh.q[3]), pose: veh.pose ?? null, vel: new THREE.Vector3(), heardAt: 0, wings: null, wingsWant: veh.w === 1, landed: veh.landed === 1, dock: null, size: null, build: null, paint: null, fit: null, busy: null, want: null };
      r.vehicle = rv;
      void this.bringVehicle(r, rv);
    }
    const rv = r.vehicle;
    const now = performance.now();
    if (rv.heardAt > 0) stepRelayVelocity(rv.vel, veh.p[0] - rv.target.x, veh.p[1] - rv.target.y, veh.p[2] - rv.target.z, (now - rv.heardAt) / 1000);
    rv.heardAt = now;
    rv.target.set(veh.p[0], veh.p[1], veh.p[2]);
    rv.targetQ.set(veh.q[0], veh.q[1], veh.q[2], veh.q[3]).normalize();
    rv.pose = veh.pose ?? null;
    // The pilot's wings as they send them; a peer on an older build sends none, and its wings open while it moves.
    rv.wingsWant = veh.w !== undefined ? veh.w === 1 : rv.vel.length() > 4;
    // Clamped onto another player's ship: kept in that ship's own frame, and placed from it each frame.
    if (veh.dock) {
      rv.dock ??= { to: 0, p: new THREE.Vector3(), q: new THREE.Quaternion() };
      rv.dock.to = veh.dock.to;
      rv.dock.p.set(veh.dock.p[0], veh.dock.p[1], veh.dock.p[2]);
      rv.dock.q.set(veh.dock.q[0], veh.dock.q[1], veh.dock.q[2], veh.dock.q[3]).normalize();
    } else rv.dock = null;
    // Set down on the ground: it stands exactly where it is said to stand, and its glide is dropped.
    rv.landed = veh.landed === 1;
    if (rv.landed) {
      rv.vel.set(0, 0, 0);
      if (rv.obj) {
        rv.obj.position.copy(rv.target);
        rv.obj.quaternion.copy(rv.targetQ);
      }
    }
    if (rv.obj && rv.obj.position.y < -900) {
      rv.obj.position.copy(rv.target);
      rv.obj.quaternion.copy(rv.targetQ);
    }
  }

  private async bringVehicle(r: Remote, rv: RemoteVehicle): Promise<void> {
    try {
      this.garage ??= this.loadGarage();
      const g = await this.garage;
      const def = g.find(rv.id);
      if (!def) {
        console.warn(`remote player ${r.hello.name} rides a ${rv.id} the garage does not know`);
        return;
      }
      // Its fit, as their hello gives it (stock when the hello names another ship, or none).
      const asked = r.hello.ship?.id === def.id ? r.hello.ship.fit : null;
      const fit = def.fit ? g.resolve(def, asked) : null;
      // Prepared (and painted) before it is shown, so the first sight of it compiles nothing.
      const { holder: obj, wings, build, paint } = await g.visualParts(def, { fit, prepare: this.prepareVehicle ?? undefined, forget: this.forget ?? undefined });
      if (r.vehicle !== rv) {
        paint?.dispose();
        return;
      }
      rv.build = def.fit ? build : null;
      rv.paint = paint;
      rv.fit = fit;
      // How big the hull is, for anything that must judge it from outside (whether it could carry
      // another ship, and how far off it a ship it has let go of has to be). The radius is measured
      // exactly as a hull of this world measures its own (`Vehicle.radius`): half the footprint's
      // longer side. Two measures would make "50 m from the hull" mean one thing for a ship standing
      // here and another for a picture of one.
      if (def.bounds) {
        const b = def.bounds;
        const w = Math.abs(b.max[0] - b.min[0]);
        const l = Math.abs(b.max[2] - b.min[2]);
        rv.size = { label: def.label, bounds: { min: [...b.min], max: [...b.max] }, radius: Math.max(w, l) / 2 };
      }
      obj.position.copy(rv.target);
      obj.quaternion.copy(rv.targetQ);
      obj.visible = r.group.visible;
      // A ship first seen in flight arrives with its wings where they are, not closed and opening.
      if (wings.length) wings.snap(rv.wingsWant);
      // A fitted ship keeps its set even while empty: a part a refit brings may carry a wing (stepping an empty set is free).
      if (wings.length || def.fit) rv.wings = wings;
      this.scene.add(obj);
      markActor(obj);
      rv.obj = obj;
      // A hello that came while the picture was being built: its fit now.
      const latest = r.hello.ship;
      if (latest && latest.id === rv.id && latest.fit !== asked) void this.refitRemote(r, rv, latest.fit);
    } catch (err) {
      console.warn(`remote player ${r.hello.name}: their ${rv.id} did not load`, err);
    }
  }

  /**
   * A peer's ship picture brought to a new fit in place, never rebuilt: only a repaint when no slot's look
   * changes, else the new parts staged, prepared and painted, then swapped in one step (Garage.restage).
   * Coalesced: a fit asked for while one is going waits, and only the newest is done when it ends.
   */
  private refitRemote(r: Remote, rv: RemoteVehicle, want: ShipFit): Promise<void> {
    rv.want = want;
    if (rv.busy) return rv.busy;
    const run = async () => {
      while (rv.want) {
        const asked = rv.want;
        rv.want = null;
        if (r.vehicle !== rv || !rv.build || !rv.fit) return;
        this.garage ??= this.loadGarage();
        const g = await this.garage;
        const def = g.find(rv.id);
        const next = def ? g.resolve(def, asked) : null;
        if (!def?.fit || !next || fitKey(next) === fitKey(rv.fit)) continue;
        const slots = changedSlots(def.fit, rv.fit, next);
        if (!slots.length) await rv.paint?.apply(next.paint);
        else {
          // Its wings set too: a wing a new part brings opens with the pilot's, and one on a part taken down leaves it.
          const s = await g.restage(def, rv.build, rv.fit, next, rv.paint, this.prepareVehicle ?? noPrepareRoots, rv.wings ?? undefined);
          if (r.vehicle !== rv) {
            for (const p of s.parts) rv.paint?.untrack(p.node);
            return;
          }
          s.commit();
        }
        if (r.vehicle !== rv) return;
        rv.fit = next;
      }
    };
    rv.busy = run()
      .catch((err) => console.warn(`remote player ${r.hello.name}: their ${rv.id} could not be refitted`, err))
      .finally(() => {
        rv.busy = null;
      });
    return rv.busy;
  }

  private dropVehicle(r: Remote): void {
    if (!r.vehicle) return;
    if (r.vehicle.obj) this.scene.remove(r.vehicle.obj);
    // Its paint's copies leave the world's material sets with it.
    r.vehicle.paint?.dispose();
    r.vehicle.paint = null;
    r.vehicle.want = null;
    r.vehicle = null;
  }

  /** An emote from the relay: a dance or a sit loops, a flourish plays over the dance (which comes back after it), an empty clip ends whatever plays. */
  emote(id: number, clip: string): void {
    const r = this.remotes.get(id);
    if (!r) return;
    if (!clip) {
      r.rig?.stopOverride(0.2);
      r.dance = null;
      return;
    }
    r.rig?.play(clip, { fadeIn: 0.15, loop: loopsEmote(clip) });
    r.dance = isDanceClip(clip) ? clip : isFlourishClip(clip) ? r.dance : null;
  }

  remove(id: number): void {
    const r = this.remotes.get(id);
    if (!r) return;
    this.remotes.delete(id);
    this.dropVehicle(r);
    this.scene.remove(r.group);
    (r.label.material as THREE.SpriteMaterial).map?.dispose();
  }

  update(dt: number): void {
    let anyDocked = false;
    let anyAboard = false;
    for (const r of this.remotes.values()) {
      if (r.vehicle?.obj) r.vehicle.obj.visible = r.group.visible;
      if (!r.group.visible) {
        // Away (another world, or a jump): the glide inside a hull does not run, so when they come
        // back the next message puts them where they stand rather than walking them across the cabin.
        if (r.aboard) r.aboard.first = true;
        continue;
      }
      r.silent += dt;
      // Gone quiet: the speed the messages gave fades rather than holding the blur on a still figure.
      if (r.silent > RELAY.silentSeconds) {
        const fade = Math.exp(-dt / 0.1);
        r.vel.multiplyScalar(fade);
        r.vehicle?.vel.multiplyScalar(fade);
      }
      // Glide to the last place heard, a tenth of a second's worth at a time, so the figure moves
      // smoothly between the relay's few updates a second.
      const k = 1 - Math.exp(-dt / 0.1);
      r.group.position.lerp(r.target, k);
      if (r.targetQ) {
        // The whole turn: aboard a hull or adrift, the figure is not upright in the world.
        r.group.quaternion.slerp(r.targetQ, k);
      } else {
        let diff = r.heading - r.group.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        r.group.rotation.set(0, r.group.rotation.y + diff * k, 0);
      }
      // In somebody else's hull: the glide is taken in that hull's own frame, at the same rate as
      // every other glide, and the figure is carried onto the hull's live pose after this pass.
      const ab = r.aboard;
      if (ab) {
        anyAboard = true;
        ab.turn = easeInHull(ab.at, ab.target, ab.turn, ab.heading, dt, ABOARD_TUNE.glideSeconds);
      }
      const rv = r.vehicle;
      if (rv?.obj) {
        // Clamped onto another ship: placed from that ship's own pose after this pass, so the hull it
        // rides has been moved first whatever order the peers come in.
        if (rv.dock) anyDocked = true;
        // Landed, it is still: the glide would leave it creeping toward each message, and its springs' bob is not sent.
        else if (rv.landed) {
          rv.obj.position.copy(rv.target);
          rv.obj.quaternion.copy(rv.targetQ);
        } else {
          rv.obj.position.lerp(rv.target, k);
          rv.obj.quaternion.slerp(rv.targetQ, k);
        }
        // The wings open and close as the pilot's do, each on its own clock (nothing moves once they have settled).
        if (rv.wings) {
          rv.wings.want = rv.wingsWant;
          rv.wings.step(dt);
        }
      }
      const rig = r.rig;
      if (rig) {
        // A flourish over, the dance goes on.
        if (r.dance && !rig.overriding) rig.play(r.dance, { fadeIn: 0.15, loop: true });
        const moving = r.silent < 0.6 && r.group.position.distanceTo(r.target) > 0.05;
        const state = (r.silent > 1.5 ? 'idle' : moving || r.state === 'idle' ? r.state : r.state) as RigState;
        // Seated the way the peer's own vehicle seats them: its riding pose's branch of the riding loop.
        if (state === 'seated') {
          const pose = rv?.pose ?? (rv ? `vehicle_${rv.id.replace(/^pv_/, '')}` : null);
          const clip = pose ? rig.variant('loop_riding', pose) : null;
          rig.prefer('seated', clip && clip !== 'loop_riding' ? clip : null);
        }
        rig.setState(rig.hasState(state) ? state : 'idle', r.speed);
        rig.update(dt);
      }
    }
    if (anyDocked) this.placeDocked();
    // After the clamped pictures, never before: the hull a passenger stands in may itself be
    // clamped onto another, and its own pose is only right once that pass has put it there.
    if (anyAboard) this.placeAboard();
  }

  /**
   * Every peer standing in somebody else's hull, put where that hull puts them: the hull's live
   * pose times where the messages say they stand in it. It runs after every picture has been moved
   * (and after the clamped ones have been placed on the hulls they ride), so the order the peers
   * come in never matters. The hull may be the ship this player is on, which is no peer's picture:
   * `carrierPose` answers for that, exactly as it does for a clamp. Nothing is allocated.
   */
  private placeAboard(): void {
    for (const r of this.remotes.values()) {
      const a = r.aboard;
      if (!a || !r.group.visible) continue;
      // The hull is not here to put them in -- they are on another world, the player who flies it
      // has gone, its picture has not come in yet, or it is not shown itself (away, or in a jump,
      // where its pose is the last one heard before it went). The figure keeps the glide through
      // the world its own `p` gave it, which is what any other peer gets and is today's behaviour.
      if (!this.carrierShown(a.ship) || !this.carrierAt(a.ship, dockPos, dockQuat)) continue;
      placeInHull(dockPos, dockQuat, a.at, a.turn, r.group.position, aboardTurn);
      r.group.quaternion.copy(aboardTurn);
    }
  }

  /**
   * Whether the hull of that relay id is one to stand somebody in this frame. The game's own hull
   * always is (it is here, being flown); a peer's only while that peer is shown, since a picture
   * that is away or in a jump keeps the last pose it was heard at and would hold a passenger
   * visible inside a hull nobody can see.
   */
  private carrierShown(to: number): boolean {
    const c = this.remotes.get(to);
    return !c || c.group.visible;
  }

  /**
   * Whose hull an object of the scene stands in: the relay id of the peer whose picture of a ship
   * it is or hangs under, and 0 when it is nobody's -- this player's own ship, or a hull no peer
   * sends. It is what tells a passenger to send `in` rather than a copy of the hull.
   *
   * Nothing answers anything but 0 yet: a hull somebody else flies is not a place you can stand in
   * here (src/space/docking.ts refuses a crossing into one, in those words), and making one is work
   * still to come. When a boardable room is hung on the peer's own picture -- which it must be,
   * since the picture is the only thing carrying the hull's pose off the wire -- this answers on
   * its own with nothing more to wire up.
   *
   * Called once per state sent, ten times a second at most, never in a frame; it allocates nothing.
   */
  hullCarrier(node: THREE.Object3D | null | undefined): number {
    // Forced by the knob, for trying the whole path with two browsers before a friend's hull is a
    // place you can board. It holds only while that player is really here, so a line that dropped,
    // a travel or a reconnect (where a server hands out its ids afresh) lets go of it by itself
    // rather than leaving this browser claiming to be inside somebody who is no longer there.
    if (ABOARD_TUNE.carrier > 0) return this.remotes.has(ABOARD_TUNE.carrier) ? ABOARD_TUNE.carrier : 0;
    for (let o: THREE.Object3D | null = node ?? null; o; o = o.parent) {
      for (const r of this.remotes.values()) if (r.vehicle?.obj === o) return r.id;
    }
    return 0;
  }

  /**
   * Every picture clamped onto another ship, put where the hull it rides puts it: the carrier's pose
   * times the pose the relay gave, so it sits still on the hull rather than gliding about on it. It
   * runs after every picture has been moved, so the order the peers come in never matters. The carrier
   * may be the ship this player is on, which is no peer's picture: `carrierPose` answers for that.
   * Nothing is allocated; a picture whose carrier is not here is left where it was.
   */
  private placeDocked(): void {
    for (const r of this.remotes.values()) {
      const rv = r.vehicle;
      if (!rv?.obj || !rv.dock || !r.group.visible) continue;
      // The hull it rides is not here (they are on another world, or their picture has not come in):
      // it is put where the relay says it is in the world, which is what any other ship would get.
      if (!this.carrierAt(rv.dock.to, dockPos, dockQuat)) {
        rv.obj.position.copy(rv.target);
        rv.obj.quaternion.copy(rv.targetQ);
      } else {
        rv.obj.quaternion.copy(dockQuat).multiply(rv.dock.q);
        rv.obj.position.copy(rv.dock.p).applyQuaternion(dockQuat).add(dockPos);
      }
      // The figure rides the same snap. Its own glide is a tenth of a second behind the messages, and
      // the hull it is sitting in is now placed exactly, so left to itself the pilot swims out of their
      // own cockpit at speed: it is put where it stands in the hull's frame (its offset from where the
      // relay says the hull is), carried onto where the hull has just been put.
      dockOff.copy(r.target).sub(rv.target);
      dockInv.copy(rv.targetQ).invert();
      r.group.position.copy(dockOff).applyQuaternion(dockInv).applyQuaternion(rv.obj.quaternion).add(rv.obj.position);
      if (r.targetQ) r.group.quaternion.copy(rv.obj.quaternion).multiply(dockInv.multiply(r.targetQ));
    }
  }

  /** Where the ship of the player with this relay id stands: the game's own answer first, then the peers' pictures. */
  private carrierAt(to: number, pos: THREE.Vector3, quat: THREE.Quaternion): boolean {
    if (this.carrierPose?.(to, pos, quat)) return true;
    const carrier = this.remotes.get(to)?.vehicle;
    if (!carrier?.obj) return false;
    pos.copy(carrier.obj.position);
    quat.copy(carrier.obj.quaternion);
    return true;
  }

  // --- what a clamp needs of the peers (src/space/docking.ts's ClampPeers) --------------------------

  /** Every peer here who is on a ship whose picture is in, filled into `out` (cleared first). */
  shipPeers(out: number[]): number[] {
    out.length = 0;
    for (const r of this.remotes.values()) if (r.group.visible && r.vehicle?.obj && r.vehicle.size) out.push(r.id);
    return out;
  }

  /** The pose and velocity of the ship that peer is on; false when they are on none, or are elsewhere. */
  vehiclePose(id: number, pos: THREE.Vector3, quat: THREE.Quaternion, vel: THREE.Vector3): boolean {
    const r = this.remotes.get(id);
    const rv = r?.vehicle;
    if (!r?.group.visible || !rv?.obj) return false;
    pos.copy(rv.obj.position);
    quat.copy(rv.obj.quaternion);
    vel.copy(rv.vel);
    return true;
  }

  /** That ship's name, box and bounding radius; null before its picture is in. */
  vehicleOf(id: number): { label: string; bounds: { min: number[]; max: number[] }; radius: number } | null {
    return this.remotes.get(id)?.vehicle?.size ?? null;
  }

  /** What to call the player, for the rows. */
  peerName(id: number): string {
    return this.remotes.get(id)?.hello.name ?? 'someone';
  }

  /** The peers and what they ride, for the motion blur, with the relay's velocity: their glide between messages is not their speed. */
  collectMovers(out: FxMoverList): void {
    for (const r of this.remotes.values()) {
      if (!r.group.visible) continue;
      out.add(r.group, false, 'remote', r.vel);
      // Added to the scene root, not under the figure.
      if (r.vehicle?.obj) out.add(r.vehicle.obj, false, 'remoteVehicle', r.vehicle.vel);
    }
  }

  dispose(): void {
    for (const id of [...this.remotes.keys()]) this.remove(id);
    // The knob's one reference to this, let go with it: it is a strong hold on every peer's group,
    // rig, label and ship picture, and through them on the scene.
    if (thePeers === this) thePeers = null;
  }
}

/** Scratch for placing a clamped picture, and its rider, on the hull it rides; nothing is allocated per frame. */
const dockPos = new THREE.Vector3();
const dockQuat = new THREE.Quaternion();
const dockOff = new THREE.Vector3();
const dockInv = new THREE.Quaternion();
/**
 * The same, for a passenger's turn inside the hull they stand in. It is written field by field and
 * copied onto the figure, so the quaternion that tells the figure it turned is told once.
 */
const aboardTurn = new THREE.Quaternion();
/** The knob's own, so reading a report between frames cannot tread on the scratch a frame is using. */
const reportPos = new THREE.Vector3();
const reportQuat = new THREE.Quaternion();

/**
 * The invented numbers of standing in somebody else's hull, both live through `__aboard()`.
 *
 * `carrier` is a test override and is 0 in play. It is here because a hull somebody else flies is
 * not yet a place you can stand in, so without it there is no way at all to try this end to end
 * with two browsers: set to another player's relay id, this browser reports the hull it is really
 * standing in as that player's, stops sending a copy of it, and is drawn inside their ship. It
 * changes nothing about what is checked, sent or placed -- only the answer to "whose hull is this".
 */
export const ABOARD_TUNE = {
  /** Invented, and a test override only: 0 is off, and is what every reading of it is in play. */
  carrier: 0,
  /** Invented: the same tenth of a second every other glide here uses, so a passenger moves no differently from anyone else. */
  glideSeconds: 0.1,
};

/** The one set of peers, so the knob can report them; set when the game builds it, let go on dispose. */
let thePeers: RemotePlayers | null = null;

/**
 * The live knob, on the window as `__aboard()`: what this browser last said about the hull it
 * stands in, which peers say they stand in somebody's hull and whether that hull is here to put
 * them in, and the two numbers above. Reading it costs nothing and it never runs in a frame.
 */
export function aboardKnob(opts?: { carrier?: number; glideSeconds?: number }): Record<string, unknown> {
  if (opts) {
    if (opts.carrier !== undefined && Number.isFinite(opts.carrier)) ABOARD_TUNE.carrier = Math.max(0, Math.round(opts.carrier));
    if (opts.glideSeconds !== undefined && Number.isFinite(opts.glideSeconds)) ABOARD_TUNE.glideSeconds = Math.max(MIN_GLIDE_SECONDS, opts.glideSeconds);
  }
  return { ...(thePeers ? thePeers.aboardDebug() : { sending: 'veh', sent: null, peers: [] }), tune: { ...ABOARD_TUNE } };
}

// Reachable wherever there is a console: this has no panel of its own, and a browser driven by a
// script is hidden, so the only way to see what it decided is to ask it in numbers.
(globalThis as unknown as { __aboard?: typeof aboardKnob }).__aboard = aboardKnob;

/** No preparation to wait for (the game has not given one). */
const noPrepare = (): Promise<void> => Promise.resolve();
const noPrepareRoots = (_roots: THREE.Object3D[]): Promise<void> => Promise.resolve();

/** A name over the head: text on a small canvas, as a sprite that faces the camera. */
function makeLabel(name: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '600 28px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  const w = Math.min(250, ctx.measureText(name).width + 24);
  ctx.beginPath();
  ctx.roundRect(128 - w / 2, 12, w, 40, 8);
  ctx.fill();
  ctx.fillStyle = '#dff1ff';
  ctx.fillText(name, 128, 33);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.renderOrder = 10;
  return sprite;
}
