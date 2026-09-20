// Another player's lightsaber, on this side: the blade drawn on the hilt their figure is already
// holding, in the colour they chose, lighting the ground and the walls through the same pass and
// the same pool of lights the player's own blade uses. A blade they throw crosses too, and so does
// their death, which plays as a clip rather than a heap of bones -- nothing carries bone motion
// across, so a ragdoll would end up in a different pile on every screen. The clip itself is the
// peers' own (setDown in src/net/remotePlayers.ts, where the rig is); what belongs here is that a
// blade goes out with them and a blade they had in the air is not left hanging where they died.
//
// Nothing here is new machinery. A peer's blade is a `SaberBlade`, the same renderer the player and
// every fighter draw with; it joins the frame's blade list through the `more` list `collectBlades`
// already takes, which keeps the nearest BLADE_GLOW_MAX of them. So with the blade glow pass on, a
// peer's blade lights the ground, the walls and the bodies round it exactly as the player's does,
// through that one pass, and asks for no light at all.
//
// With that pass switched off it is not exactly as the player's, and the difference is worth saying
// plainly: the player's own blade, the fighters' glows and a ship's room lights all ask the pool of
// four flash lights earlier in the frame, and a flash holds its light for its whole life, so by the
// time this draw runs there is often nothing standing dark. A peer's blade takes only a light that
// is standing dark (`PEER_BLADE_TUNE.borrow`), so with the pass off it is lit when the pool has
// room and unlit when it has not -- and it never takes one away from the player, a fighter or a
// cabin. The number of lights in the scene never moves either way.
//
// No program is built while playing. A `SaberBlade`'s four ribbons are `ShaderMaterial`s built from
// two module-level source strings, and three keys a shader stage on the source text itself
// (`WebGLShaderCache._getShaderStage`), so every blade in the game shares one program. The player's
// own six blade groups are in the scene from `Player`'s constructor with their ribbons hidden, and
// `World.compileAllAsync` gathers with `traverse`, not `traverseVisible`, so that program is built
// behind the loading screen of every session, Jedi or not, and a peer's first blade finds it.
//
// This module knows nothing about the socket. It listens to the peers through the watcher the peers
// themselves hand out (`watchPeers` in src/net/remotePlayers.ts, whose `PeerView` is one refilled
// object per peer): told when one arrives, once a frame when one has been put where it is drawn, and
// when one goes. It keeps nothing of the view but the few values it reads, since that object is
// refilled. With no server there are no peers and everything below costs one size check a frame.
//
// The one thing it does not do from there is draw: a blade has to be measured from the hand after
// the pose and drawn with this frame's camera, which is where the player's own `drawBlades` sits, so
// the drawing is a single call from the game at that point and the watcher only gathers.
import * as THREE from 'three';
import { SaberBlade, type BladeSpec } from '../combat/saberBlade.ts';
import { markActor } from '../world/portalRender';
import { segmentDistanceSq } from '../core/fx/bladeGlowMath.ts';
import type { BladeHolder } from '../combat/bladeLights.ts';
import { isSaber, type WeaponClass } from '../player/weapons';
import { watchPeers, type PeerWatcher } from './remotePlayers';

/**
 * As much of a rack weapon as a blade needs: which class it is (a lightsaber of some grip, or
 * anything else), its box (how tall the hilt is), and its blade's own numbers from the client's
 * blade file. A `WeaponDef` from the weapons rack satisfies it as it stands.
 */
export interface BladeWeapon {
  class: string;
  bounds?: { min: number[]; max: number[] };
  blade?: { length: number; width: number; open: number; close: number };
}

/**
 * Something hung on a peer's hand bone: the holder in the scene, what it is, and which hand it is
 * on. The hand is named rather than taken from the list's order, because the peers skip an empty
 * hand when they hang the weapons: a peer carrying a saber in the off hand alone has it first in
 * the list, and reading that as the right hand would hide the wrong hilt when they threw it.
 */
export interface PeerHeld {
  node: THREE.Object3D;
  def: BladeWeapon;
  hand: 'right' | 'left';
}

/**
 * One peer as the blades read them: the peers' own `PeerView`, with the three fields a blade needs
 * that a body does not. They are optional here on purpose, so that a view without them is read as a
 * peer with nothing in their hands rather than throwing in a frame; the blades come to life as soon
 * as the view carries them.
 *
 * `hands` is what hangs on their hand bones now, each entry saying which hand it is on (the list
 * skips an empty hand, so its order is not the hands'). A lightsaber there is what the blade is
 * drawn from: its class says whether there is a second blade down the other end of the hilt (the
 * double-bladed staff), so nothing about the style ever has to go over the wire. `saber` is their
 * state's own saber flag, which has crossed since the first relay, and `saberColor` the colour they
 * chose. `saberThrown` is where the blade is when it is out of their hand, in world space, with how
 * far it has spun. `hullFrame` is the live matrix of the ship they are standing in, so the blade's
 * smear is remembered in the hull rather than drawn out along the ship's own flight; left out, a
 * blade aboard a fast hull smears with the ship.
 */
export interface PeerBladeView {
  id: number;
  /** Drawn here this frame: on this world, not in a jump, not yet taken away. */
  shown: boolean;
  /** The blade's colour as hex, as their hello gives it. */
  saberColor: number;
  saber: boolean;
  /** Their own browser says they are down; the peers play the clip, and here the blade goes out with them. */
  down: boolean;
  hands?: readonly PeerHeld[];
  saberThrown?: { x: number; y: number; z: number; spin: number } | null;
  hullFrame?: THREE.Matrix4 | null;
}

/** What a borrowed light needs of the effects: the pool to look at, and the way to ask. */
export interface FlashPool {
  readonly lightPool: readonly THREE.PointLight[];
  flash(pos: THREE.Vector3, color: number, intensity: number, distance: number, life: number): void;
}

/**
 * The numbers this file made up, every one live through `__peerBlades({ ... })`.
 *
 * `swing` is the one that needs saying: how hard a blade is being swung is not on the wire, and it
 * only lengthens the smear behind a blade that is already moving (a still blade's swept surface has
 * no area and is not drawn at all), so a middling constant costs nothing and a still peer shows no
 * smear either way.
 *
 * `borrow` is who may take a pooled flash light for a peer's blade when the glow pass is off.
 * 'free' takes only a light standing dark. The pool is four and a flash holds its light for its
 * whole life, so with the player's own blade lit, or a fighter near, or a ship's cabin round them,
 * there is usually nothing dark left by the time this draw runs and a peer's blade goes unlit: that
 * is the price of never taking one away from them. 'always' asks whatever the pool is doing, which
 * evicts the oldest live flash -- and since the pool serves the latest asker when it is full and
 * this draw is the last asker in the frame, what it evicts is the player's own blade, a fighter's
 * glow or a ship's room lights. It is there to compare by eye, not to run with. 'never' leaves
 * peers unlit with the pass off. The number of lights in the scene never changes either way.
 *
 * `spare` is how many renderers are kept for the next peer when one leaves. A blade's materials are
 * registered with the portal renderer and the shadow cascades, both strong sets and the first
 * walked a dozen times a frame, so a renderer that is disposed must be forgotten by them first:
 * keeping a few instead means an evening of people coming and going disposes nothing at all.
 */
export const PEER_BLADE_TUNE = {
  /** Invented: a middling swing, since how hard a peer is swinging does not cross. */
  swing: 0.35,
  /** Invented: 'free' | 'always' | 'never'. See above -- 'always' takes a light somebody else is using. */
  borrow: 'free' as 'free' | 'always' | 'never',
  /** Not invented here: a fighter's blade glow (`main.ts`'s npc glow), which a peer's blade is the twin of. */
  flashIntensity: 2,
  flashDistance: 5,
  flashLife: 0.08,
  /** Not invented here: how far up a hilt with no box of its own the blade leaves it, in metres; the fighters' own figure (`npcs.ts`). */
  hiltTop: 0.13,
  /** Invented: renderers kept for the next peer rather than disposed; four is one peer's worth. */
  spare: 8,
};

/** The game's own blue, for a peer whose hello carries no colour (an older browser). */
const DEFAULT_COLOR = 0x3aa0ff;

/**
 * One blade of one peer. The field is called `saber` so that the slot is itself a `BladeHolder`,
 * which is what the frame's blade list gathers, with no wrapper object per blade per frame.
 */
interface Slot {
  saber: SaberBlade;
  /**
   * What the blade is drawn from, so its numbers are read off the rack only when it changes: the
   * renderer's own `spec` is written in place rather than replaced, and `top` is how far up the
   * hilt it leaves, measured once. A fresh object a frame here would be one per blade per peer per
   * frame. Which hand it is, whether it points down the hilt and whether it snaps out rather than
   * igniting are the slot's own index and never change, so they are arguments rather than fields.
   */
  def: BladeWeapon | null;
  top: number;
  /** Lit this frame. */
  on: boolean;
}

/** Which slot is which, so the four are never confused. */
const RIGHT = 0;
const LEFT = 1;
const STAFF = 2;
const FLYING = 3;
/** How many a peer has. Every walk of them is by index: a frame must make no iterator either. */
const SLOTS = 4;

interface PeerRecord {
  id: number;
  /** Told where they are since the last frame was drawn: one the peers stopped moving draws nothing. */
  moved: boolean;
  color: number;
  // --- what the last `peerMoved` said, copied out of the view (which is refilled) -----------------
  shown: boolean;
  lit: boolean;
  /** Their own browser says they are down: the peers play the clip, and here the blade goes with them. */
  down: boolean;
  /** What is in each hand: the holder in the scene and what the rack says it is, by the hand each names. */
  right: PeerHeld | null;
  left: PeerHeld | null;
  /** Where their blade is when it is out of their hand, and whether it is. */
  thrown: boolean;
  throwAt: { x: number; y: number; z: number; spin: number };
  /** The hull they are standing in, when they are in one; the smear is remembered in it. */
  hull: THREE.Matrix4;
  inHull: boolean;
  slots: (Slot | null)[];
  /** The scene the blade groups were added to (a peer's own group's root). */
  root: THREE.Object3D | null;
  /** The spinning saber in the air, made from a copy of the hilt the first time they throw one. */
  flying: THREE.Group | null;
  /** The hilt that copy was taken from, so a change of weapon makes a fresh one. */
  flyingFrom: THREE.Object3D | null;
  /** The copy itself, in the shape a slot measures a blade from. */
  flyingHilt: HiltFrame | null;
  /** The hilt hidden while it is in the air rather than in the hand; put back when it lands. */
  hidden: THREE.Object3D | null;
}

const base = new THREE.Vector3();
const tip = new THREE.Vector3();
const mid = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
/** The spin a thrown blade carries, before the hull's turn is put in front of it. */
const spinQ = new THREE.Quaternion();

/**
 * Every peer's blades. One of these exists for the life of the page: it listens to the peers and is
 * asked, once a frame, to draw what it gathered and to hand its blades to the frame's blade list.
 */
export class RemoteBlades implements PeerWatcher {
  private readonly records = new Map<number, PeerRecord>();
  /** The same records as a list, so a frame walks them by index rather than making a map iterator. */
  private readonly live: PeerRecord[] = [];
  private dt = 0;
  private camera: THREE.Camera | null = null;
  /** The merged list handed to `collectBlades`: the catalogue's people, then the peers' blades. */
  private readonly merged: BladeHolder[] = [];
  /** Candidates for a borrowed light, kept between frames and never regrown once every peer has drawn. */
  private readonly candidates: { slot: Slot | null; d2: number }[] = [];
  /** For the knob: how many renderers have ever been made, and how many lights were borrowed last frame. */
  private made = 0;
  private borrowed = 0;
  /**
   * Renderers a peer who left is done with, kept for the next one rather than disposed. A blade's
   * four materials are registered with the portal renderer's set and the shadow cascades' map,
   * both strong, so disposing one leaves a dead entry in a set that is walked a dozen times a
   * frame; people come and go all evening (a reconnect, a relay drop, a species change, a travel),
   * so nothing is disposed on that path at all. Over `PEER_BLADE_TUNE.spare` they are disposed, and
   * their materials are handed to `forget` first.
   */
  private readonly spares: SaberBlade[] = [];
  /**
   * How a disposed blade's materials leave the portal renderer's set and the shadow cascades' map
   * (`World.forgetMaterials`), the way the mobiles' and the garage's assets are given one. Null
   * until the game sets it; nothing here disposes a material without asking it first, so a game
   * that never sets it simply keeps its spares.
   */
  forget: ((materials: readonly THREE.Material[]) => void) | null = null;
  /** Stops listening to the peers again; called on dispose, so a disposed set is told nothing more. */
  private unwatch: (() => void) | null = null;

  constructor() {
    // The knob at the foot of this file has no other way to reach the blades; there is one set.
    theBlades = this;
  }

  // --- what the peers tell it (src/net/remotePlayers.ts's watcher) ------------------------------

  /** A peer arrived. Nothing is made here: a blade is made the first time one is in their hand. */
  peerAdded(p: PeerBladeView): void {
    this.peerRemoved(p.id);
    this.keep(this.blank(p));
  }

  /** A record into both the map (found by id) and the list (walked in a frame without an iterator). */
  private keep(r: PeerRecord): void {
    this.records.set(r.id, r);
    this.live.push(r);
  }

  /**
   * Once a frame, after their figure and the picture of their ride have been put where they are
   * drawn. It only gathers: the drawing is `draw` below, at the point in the frame where the
   * player's own blades are drawn. Nothing of the view is kept -- that object is refilled.
   */
  peerMoved(p: PeerBladeView): void {
    let r = this.records.get(p.id);
    if (!r) {
      r = this.blank(p);
      this.keep(r);
    }
    r.moved = true;
    r.shown = p.shown;
    r.lit = p.saber;
    r.down = p.down;
    // By the hand each entry names, never by its place in the list: the peers skip an empty hand
    // when they hang the weapons, so a saber carried in the off hand alone is first in the list.
    r.right = null;
    r.left = null;
    const hands = p.hands;
    if (hands)
      for (let i = 0; i < hands.length; i++) {
        const h = hands[i];
        if (h) r[h.hand] = h;
      }
    const t = p.saberThrown ?? null;
    r.thrown = !!t;
    if (t) {
      r.throwAt.x = t.x;
      r.throwAt.y = t.y;
      r.throwAt.z = t.z;
      r.throwAt.spin = t.spin;
    }
    const hull = p.hullFrame ?? null;
    r.inHull = !!hull;
    if (hull) r.hull.copy(hull);
    const color = p.saberColor || DEFAULT_COLOR;
    if (color !== r.color) {
      r.color = color;
      for (let i = 0; i < SLOTS; i++) r.slots[i]?.saber.setColor(color);
    }
  }

  /** A peer went: their blades leave the scene and their renderers go with them. */
  peerRemoved(id: number): void {
    const r = this.records.get(id);
    if (r) this.drop(r);
  }

  private blank(p: PeerBladeView): PeerRecord {
    return { id: p.id, moved: false, color: p.saberColor || DEFAULT_COLOR, shown: false, lit: false, down: false, right: null, left: null, thrown: false, throwAt: { x: 0, y: 0, z: 0, spin: 0 }, hull: new THREE.Matrix4(), inHull: false, slots: [null, null, null, null], root: null, flying: null, flyingFrom: null, flyingHilt: null, hidden: null };
  }

  /**
   * Draw every peer's blades, once a frame, after their figures have been moved and posed and
   * before the frame is drawn -- exactly where the player's own `drawBlades` sits, and for the same
   * reason: a blade measured from last frame's hand trails it.
   *
   * `flash` is the pooled lights, and is given only while the blade glow pass is not running. With
   * the pass on the blades light the world through it and ask for no light at all, which is what
   * keeps the light count from ever moving.
   */
  draw(dt: number, camera: THREE.Camera, flash: FlashPool | null = null): void {
    // Nobody here: not one line below runs, so playing alone costs one size check a frame.
    if (!this.records.size) return;
    this.dt = dt;
    this.camera = camera;
    this.borrowed = 0;
    // The kept list, walked by index: a map's iterator is an object, and this runs every frame.
    for (let i = 0; i < this.live.length; i++) {
      const r = this.live[i];
      this.step(r);
      r.moved = false;
    }
    if (flash) this.borrow(camera, flash);
  }

  /**
   * The lit blades that are not the player's, for `collectBlades`'s `more`: the catalogue's people
   * first, as they were handed in, then every peer's. The list is one kept array rewritten in
   * place, and with no peers it is whatever was handed in, so nothing is touched at all when
   * nobody else is here.
   */
  holders(more: readonly BladeHolder[] | undefined): readonly BladeHolder[] {
    if (!this.records.size) return more ?? EMPTY;
    const out = this.merged;
    out.length = 0;
    if (more) for (let i = 0; i < more.length; i++) out.push(more[i]);
    for (let i = 0; i < this.live.length; i++) {
      const slots = this.live[i].slots;
      for (let k = 0; k < SLOTS; k++) {
        const s = slots[k];
        if (s && s.on) out.push(s);
      }
    }
    return out;
  }

  /** One peer's blades, this frame, from what their last move said. */
  private step(r: PeerRecord): void {
    // Away (another world, a jump, a look still going on), down (the peers play the death clip and
    // put the blade out in the view they hand over), or their figure was not moved at all this
    // frame: nothing is drawn and nothing is remembered, so a blade does not come back with a
    // metres-long smear behind it, and a blade they had in the air when they died is not left
    // hanging there. A blade already out and forgotten is not forgotten again: `reset` forgets the
    // hum, clears the remembered sweep and hides four meshes, and a peer on another world would pay
    // that sixty times a second for as long as they were away. The same guard the slots use below.
    if (!r.shown || !r.moved || r.down) {
      this.putBack(r);
      for (let i = 0; i < SLOTS; i++) {
        const s = r.slots[i];
        if (!s) continue;
        if (s.on || s.saber.ignition > 0) s.saber.reset();
        s.on = false;
      }
      return;
    }
    const right = saberIn(r.right);
    const left = saberIn(r.left);
    const on = r.lit;
    // A blade is drawn from world places, so its renderer hangs at the top of the tree the peer's
    // figure is in rather than under their hand. A travel that builds a fresh scene moves the
    // figure and would leave the blade in the old one, drawn by nothing: it moves with them.
    const root = rootOf((right ?? left)?.node ?? null);
    if (root && root !== r.root) {
      r.root = root;
      for (let i = 0; i < SLOTS; i++) {
        const s = r.slots[i];
        if (s) rehome(root, s.saber.group);
      }
    }
    // The copy in the air is put in the tree every frame rather than only when it is built: a copy
    // built while the figure was out of the scene (a species change takes the rig down and dresses
    // it again) would otherwise hang in nothing until that weapon left their hand. `rehome` is a
    // parent check and nothing more when it is already there.
    if (r.flying && r.root) rehome(r.root, r.flying);
    // Out of the hand: a copy of the hilt, laid flat and spinning, where the wire says it is.
    if (r.thrown && right) this.fly(r, right);
    else this.putBack(r);
    const flying = r.thrown && r.flying ? r.flyingHilt : null;
    const hull = r.inHull ? r.hull : null;
    // The blade in the right hand, or the one in the air: never both, as the game never has both.
    this.slot(r, RIGHT, flying ? null : right, on && !flying, false, false, hull);
    this.slot(r, FLYING, flying, on && !!flying, false, true, hull);
    // The far end of a double-bladed staff; nothing at all for the other grips.
    this.slot(r, STAFF, !flying && right && right.def.class === 'lightsaberStaff' ? right : null, on && !flying, true, false, hull);
    // The off hand's own saber (the dual style, and any rack lightsaber held there).
    this.slot(r, LEFT, !flying ? left : null, on && !flying, false, false, hull);
  }

  /**
   * One slot drawn: the blade from `held`'s hilt, or put out and forgotten when there is none. The
   * renderer is made the first time that peer needs it and kept for as long as they are here, since
   * making one is a handful of buffers and a material whose program three already holds.
   */
  private slot(r: PeerRecord, which: number, held: PeerHeld | HiltFrame | null, on: boolean, down: boolean, snap: boolean, hull: THREE.Matrix4 | null): void {
    let s = r.slots[which];
    if (!held) {
      if (s && (s.on || s.saber.ignition > 0)) {
        s.on = false;
        s.saber.reset();
      } else if (s) s.on = false;
      return;
    }
    const node = held.node;
    if (!s) {
      const saber = this.spares.pop() ?? this.build();
      saber.setColor(r.color);
      s = { saber, def: null, top: PEER_BLADE_TUNE.hiltTop, on: false };
      r.slots[which] = s;
    }
    // The rack's numbers are read only when the weapon changes, and written into the renderer's own
    // spec in place: a fresh object here would be one per blade per peer on every frame.
    if (s.def !== held.def) {
      s.def = held.def;
      const b = held.def.blade;
      const spec = s.saber.spec;
      spec.length = b ? b.length : FALLBACK_SPEC.length;
      spec.width = b ? b.width : FALLBACK_SPEC.width;
      spec.open = b ? b.open : FALLBACK_SPEC.open;
      spec.close = b ? b.close : FALLBACK_SPEC.close;
      s.top = hiltTopOf(held.def);
    }
    // A blade whose group is in no scene gives no light and draws nothing: `glowing` walks up to a
    // scene and answers false without one, which is exactly right. It is put in as soon as there is
    // somewhere to put it -- the copy in the air brings its own tree in with it.
    const root = r.root ?? rootOf(node);
    if (root) {
      r.root = root;
      rehome(root, s.saber.group);
    }
    const sign = down ? -1 : 1;
    const top = s.top;
    node.updateWorldMatrix(true, false);
    node.localToWorld(base.set(0, sign * top, 0));
    node.localToWorld(tip.set(0, sign * (top + s.saber.spec.length), 0));
    s.on = on;
    s.saber.update(this.dt, base, tip, on, this.camera!, PEER_BLADE_TUNE.swing, snap, hull);
  }

  /**
   * The saber in the air: a copy of the hilt they are holding, laid flat and turned by the spin the
   * wire carries, with the hilt in their hand hidden while it is out there. The copy is made once
   * per weapon and kept: it shares the model's own materials, so it builds nothing.
   */
  private fly(r: PeerRecord, right: PeerHeld): void {
    const at = r.throwAt;
    if (r.flyingFrom !== right.node) {
      if (r.flying) {
        r.flying.removeFromParent();
        r.flying = null;
      }
      const g = new THREE.Group();
      g.name = 'peer saber in flight';
      const copy = right.node.clone(true);
      copy.position.set(0, 0, 0);
      copy.rotation.set(0, 0, Math.PI / 2);
      copy.scale.setScalar(1);
      g.add(copy);
      // Never weathered, as the player's own thrown saber is not: rain does not bead on a blade.
      g.userData.weatherDry = true;
      const root = rootOf(right.node);
      if (root) {
        root.add(g);
        markActor(g);
        r.root = root;
      }
      r.flying = g;
      r.flyingFrom = right.node;
      r.flyingHilt = { node: copy, def: right.def };
    }
    const g = r.flying;
    if (!g) return;
    g.position.set(at.x, at.y, at.z);
    // The spin the wire carries is about the thrower's own up. Aboard a hull the thrower composes
    // it with the hull's turn, so a saber thrown in a banked ship lies along the deck rather than
    // flat in the world; the place is already carried into the world by the sender, so only the
    // turn is rebuilt here.
    spinQ.setFromAxisAngle(UP, at.spin);
    if (r.inHull) g.quaternion.setFromRotationMatrix(r.hull).multiply(spinQ);
    else g.quaternion.copy(spinQ);
    g.visible = true;
    g.updateMatrixWorld(true);
    if (r.hidden !== right.node) {
      this.putBack(r);
      right.node.visible = false;
      r.hidden = right.node;
    }
  }

  /** The hilt that was hidden while the blade was in the air, put back in the hand. */
  private putBack(r: PeerRecord): void {
    if (r.hidden) {
      r.hidden.visible = true;
      r.hidden = null;
    }
    if (r.flying?.visible) r.flying.visible = false;
  }

  /**
   * A pooled flash light for the nearest peer blades, while the glow pass is off. With 'free' only
   * a light standing dark is taken, so nothing the player, a fighter or a ship's room lights asked
   * for earlier in the frame is ever taken away -- and equally, with a busy pool a peer's blade
   * takes nothing and is unlit. The pool is fixed in size and no light joins or leaves the scene
   * either way.
   */
  private borrow(camera: THREE.Camera, flash: FlashPool): void {
    const how = PEER_BLADE_TUNE.borrow;
    if (how === 'never') return;
    let room = 0;
    const pool = flash.lightPool;
    if (how === 'always') room = pool.length;
    else for (let i = 0; i < pool.length; i++) if (pool[i].intensity <= 0) room++;
    if (room <= 0) return;
    // The lit blades, with how far each is from the eye; the nearest `room` of them are lit.
    let n = 0;
    for (let i = 0; i < this.live.length; i++) {
      const slots = this.live[i].slots;
      for (let k = 0; k < SLOTS; k++) {
        const s = slots[k];
        if (!s || !s.on || !s.saber.glowing) continue;
        const d2 = segmentDistanceSq(camera.position, s.saber.drawnBase, s.saber.drawnTip);
        const c = this.candidates[n] ?? (this.candidates[n] = { slot: null, d2 });
        c.slot = s;
        c.d2 = d2;
        n++;
      }
    }
    const take = Math.min(room, n);
    for (let k = 0; k < take; k++) {
      let best = k;
      for (let j = k + 1; j < n; j++) if (this.candidates[j].d2 < this.candidates[best].d2) best = j;
      const tmp = this.candidates[k];
      this.candidates[k] = this.candidates[best];
      this.candidates[best] = tmp;
      const s = this.candidates[k].slot!;
      mid.copy(s.saber.drawnBase).lerp(s.saber.drawnTip, 0.5);
      flash.flash(mid, s.saber.color.getHex(), PEER_BLADE_TUNE.flashIntensity, PEER_BLADE_TUNE.flashDistance, PEER_BLADE_TUNE.flashLife);
      this.borrowed++;
    }
    // Nothing kept between frames: a renderer that goes must not be held by this list.
    for (let k = 0; k < this.candidates.length; k++) this.candidates[k].slot = null;
  }

  /**
   * One peer taken apart: their blades out of the scene, their renderers kept for the next peer,
   * their hilt put back in their hand. Nothing is disposed on this path: people come and go all
   * evening, and a blade's materials are held by the portal renderer's set and the shadow cascades'
   * map, so disposing four of them per departure would leave dead entries in a set walked a dozen
   * times a frame.
   */
  private drop(r: PeerRecord): void {
    this.putBack(r);
    for (let i = 0; i < SLOTS; i++) {
      const s = r.slots[i];
      if (!s) continue;
      s.on = false;
      s.saber.reset();
      s.saber.group.removeFromParent();
      this.spares.push(s.saber);
    }
    r.slots[RIGHT] = r.slots[LEFT] = r.slots[STAFF] = r.slots[FLYING] = null;
    r.flying?.removeFromParent();
    r.flying = null;
    r.flyingFrom = null;
    r.flyingHilt = null;
    this.records.delete(r.id);
    const i = this.live.indexOf(r);
    if (i >= 0) this.live.splice(i, 1);
    this.trimSpares();
  }

  /** A renderer, counted so the knob can say a new one was not made on a live frame. */
  private build(): SaberBlade {
    this.made++;
    return new SaberBlade();
  }

  /**
   * The spares kept down to `PEER_BLADE_TUNE.spare`. What goes is disposed, and its materials are
   * handed to `forget` first so they leave the portal renderer's set and the shadow cascades' map;
   * with no `forget` set they are kept instead, since a dead entry in those sets costs more than a
   * renderer nobody is drawing. Never called in a frame: only when a peer leaves.
   */
  private trimSpares(): void {
    const keep = Math.max(0, Math.floor(PEER_BLADE_TUNE.spare));
    while (this.spares.length > keep) {
      const saber = this.spares.pop();
      if (!saber) break;
      if (!this.forget) {
        this.spares.push(saber);
        return;
      }
      materialsOf(saber, scratchMaterials);
      this.forget(scratchMaterials);
      saber.dispose();
      scratchMaterials.length = 0;
    }
  }

  private clear(): void {
    while (this.live.length) this.drop(this.live[this.live.length - 1]);
    this.records.clear();
    this.merged.length = 0;
  }

  /**
   * Everything let go: the world was left, the line was put down, the page is going. This is the
   * one path that disposes renderers, and it is not a frame: the spares go through `forget` as
   * well, so nothing disposed is left in the portal renderer's set.
   */
  dispose(): void {
    this.clear();
    for (const saber of this.spares) {
      if (this.forget) {
        materialsOf(saber, scratchMaterials);
        this.forget(scratchMaterials);
        scratchMaterials.length = 0;
      }
      saber.dispose();
    }
    this.spares.length = 0;
    this.unwatch?.();
    this.unwatch = null;
    // The knob's one reference to this, let go with it.
    if (theBlades === this) {
      theBlades = null;
      delete (globalThis as { __peerBlades?: unknown }).__peerBlades;
    }
  }

  /** Set once by the one that listens for the page, so a dispose can stop listening again. */
  listening(stop: () => void): void {
    this.unwatch = stop;
  }

  /**
   * Every peer blade's white core drawn this frame, for the depth of field's glow depth: a lit
   * blade at the focus must stay a sharp line rather than take the blur of the town behind it,
   * which is what that product is for. Fills `out` from `n` and returns the new count; with no
   * peers it hands `n` straight back.
   */
  glowCores(out: THREE.Object3D[], n: number): number {
    if (!this.records.size) return n;
    for (let i = 0; i < this.live.length; i++) {
      const slots = this.live[i].slots;
      for (let k = 0; k < SLOTS; k++) {
        const s = slots[k];
        if (s && s.on) n = s.saber.glowCore(out, n);
      }
    }
    return n;
  }

  /**
   * For the console: every peer with a blade, what it is doing and how far off it is. It allocates
   * freely and is never called in a frame.
   */
  debug(): Record<string, unknown> {
    const eye = this.camera?.position ?? new THREE.Vector3();
    const peers = [...this.records.values()].map((r) => ({
      id: r.id,
      color: `#${r.color.toString(16).padStart(6, '0')}`,
      down: r.down,
      thrown: !!r.hidden,
      blades: r.slots
        .map((s, i) => (s && s.on ? { which: ['right', 'left', 'staff', 'thrown'][i], glowing: s.saber.glowing, ignition: Number(s.saber.ignition.toFixed(2)), distance: Number(Math.sqrt(segmentDistanceSq(eye, s.saber.drawnBase, s.saber.drawnTip)).toFixed(1)) } : null))
        .filter((x) => x !== null),
    }));
    return { peers, renderersMade: this.made, spare: this.spares.length, forgets: !!this.forget, borrowedLastFrame: this.borrowed, tune: { ...PEER_BLADE_TUNE } };
  }
}

/** A hilt of our own making (the copy spinning through the air) in the shape a slot reads. */
interface HiltFrame {
  node: THREE.Object3D;
  def: BladeWeapon;
}

/**
 * What is in a hand, when it is a lightsaber; null for anything else and for an empty hand. The
 * rack's own `isSaber` decides, not a list of our own: a grip added to the game later would
 * otherwise draw a blade for the fighters and none for the peers, and nothing would say so.
 */
function saberIn(h: PeerHeld | null): PeerHeld | null {
  return h && isSaber(h.def.class as WeaponClass) ? h : null;
}

/** The blade's numbers when the rack carries none: the renderer's own defaults, in metres and seconds. */
const FALLBACK_SPEC: BladeSpec = { length: 1.1, width: 0.12, open: 0.32, close: 0.32 };

/** A blade's own materials, written into `out` in place: what `forget` is given before it is disposed. */
function materialsOf(saber: SaberBlade, out: THREE.Material[]): void {
  for (const child of saber.group.children) {
    const m = (child as THREE.Mesh).material;
    if (!m) continue;
    if (Array.isArray(m)) out.push(...m);
    else out.push(m);
  }
}
const scratchMaterials: THREE.Material[] = [];

/**
 * How far up the hilt the blade leaves it: half the hilt's own height, as a fighter measures it. A
 * box's corners are read componentwise, since a mesh's box chunk holds the larger corner first and
 * packs converted before that was learnt carry the two the other way about.
 */
function hiltTopOf(def: BladeWeapon): number {
  const b = def.bounds;
  return b ? Math.abs(b.max[1] - b.min[1]) / 2 : PEER_BLADE_TUNE.hiltTop;
}

/** The top of the tree a node hangs in: the scene, when it is in one. */
function rootOf(node: THREE.Object3D | null): THREE.Object3D | null {
  if (!node) return null;
  let o: THREE.Object3D = node;
  while (o.parent) o = o.parent;
  return o === node ? null : o;
}

/** A blade's group moved to the tree its peer is now in, and marked as an actor there. */
function rehome(root: THREE.Object3D, group: THREE.Object3D): void {
  if (group.parent === root) return;
  root.add(group);
  markActor(group);
}

const EMPTY: readonly BladeHolder[] = [];

/** The one set of peer blades, so the knob can report them; let go on dispose. */
let theBlades: RemoteBlades | null = null;

/**
 * The one set for the page, listening to the peers from the moment anything imports this file, so
 * there is nothing to wire up: the peers hand every arrival, every frame's pose and every departure
 * to it, and the game's only other word with it is the one call a frame that draws what it gathered.
 * Nothing of the peers reaches back into here, which is what keeps the two files from importing each
 * other.
 */
export const remoteBlades = new RemoteBlades();
remoteBlades.listening(watchPeers(remoteBlades));

/**
 * The live knob, on the window as `__peerBlades()`: which peers have a blade out, what it is doing,
 * how many renderers have ever been built (it must not climb while nothing changes hands, and a
 * peer who leaves and another who arrives reuses theirs rather than building one) and how many
 * pooled lights were borrowed on the last frame. Any number of PEER_BLADE_TUNE retunes live; one
 * that is not a number, or is below nothing, is refused rather than floored, so a mistyped distance
 * does not quietly become a light with no reach. Reading it costs nothing and it never runs in a frame.
 */
export function peerBladesKnob(opts?: Partial<typeof PEER_BLADE_TUNE>): Record<string, unknown> {
  if (opts) {
    if (opts.borrow === 'free' || opts.borrow === 'always' || opts.borrow === 'never') PEER_BLADE_TUNE.borrow = opts.borrow;
    for (const key of ['swing', 'flashIntensity', 'flashDistance', 'flashLife', 'hiltTop', 'spare'] as const) {
      const v = opts[key];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) PEER_BLADE_TUNE[key] = v;
    }
  }
  return theBlades ? theBlades.debug() : { peers: [], renderersMade: 0, spare: 0, forgets: false, borrowedLastFrame: 0, tune: { ...PEER_BLADE_TUNE } };
}

// Reachable wherever there is a console: this has no panel of its own, and a browser driven by a
// script is hidden, so the only way to see what it decided is to ask it in numbers.
(globalThis as unknown as { __peerBlades?: typeof peerBladesKnob }).__peerBlades = peerBladesKnob;
