// Blaster bolts, after OpenJK's codemp/game/g_weapon.c (WP_FireBlasterMissile) and g_missile.c:
// a bolt is a thing in flight with a velocity, not a ray. It leaves the muzzle at the weapon's
// speed (the E-11's 2300 units a second, about 58 m/s), flies straight with no drop, and hurts
// the first thing it runs into. A bolt in the air can be sidestepped, and one that strikes a
// lit lightsaber facing it is turned away (see deflect.ts) and flies on as the blocker's own.
//
// A ship's bolt is the game's own: its speed and range from the weapon table, the shooter's
// velocity added so a bolt never lags the ship that fired it, and its look a particle effect
// from the projectile table (a long red, green or blue streak) carried along with it, with the
// table's hit effect where it strikes.
//
// This file is derived from OpenJK, copyright (C) 1999-2000 Id Software, Inc., (C) 2000-2013
// Activision, (C) 2013 OpenJK contributors, and is used under the GNU General Public License
// version 2 (see LICENSES/OpenJK-GPL-2.0.txt).
import * as THREE from 'three';
import { combatSounds, GENERIC_GUN, SILENT_GUN, type GunSound } from '../audio/combatSounds';
import { RAPIER, type Physics } from '../core/physics';
import { markActor } from '../world/portalRender';
import type { EffectHandle, ParticleEffects } from '../world/particles';
import type { Effects } from './effects';
import type { Hittable, Living } from './kit';

const UNIT = 0.0254;

/** The E-11 blaster rifle's numbers (g_weapon.c, bg_weapons.c). */
export const BLASTER = {
  /** Bolt speed in units a second. */
  velocity: 2300,
  damage: 20,
  /** Seconds between shots on the primary trigger. */
  fireTime: 0.35,
  /** Seconds between shots on the rapid trigger. */
  altFireTime: 0.15,
  /** The rapid trigger's scatter, in degrees each way. */
  altSpread: 1.6,
  /** Seconds a bolt lives before it fades. */
  life: 4,
  /** Push on what it hits, as the creatures' knock scale. */
  push: 2.5,
};

export type BoltOwner = 'player' | 'enemy';

/** How a ship's bolt looks: the projectile table's effect for it, and the one for where it strikes. */
export interface ProjectileVisual {
  /** The bolt's particle effect, relative to its pack. */
  effect: string;
  /** How far ahead of the projectile's own point the effect reaches (metres): the bolt's tip. */
  reach: number;
  /** The effect played where the bolt strikes, when the table names one. */
  hit?: string | null;
  /** Which pack's effects these are: the ships' (the default) or the weapons'. */
  pack?: 'ships' | 'weapons';
}

export interface BoltOptions {
  owner: BoltOwner;
  damage?: number;
  /** Units a second. */
  speed?: number;
  /** Metres a second, in place of `speed`, for the game's own guns. */
  metresPerSecond?: number;
  /** The shooter's own velocity (metres a second), carried by the bolt on top of its muzzle speed. */
  inherit?: THREE.Vector3;
  /** Seconds the bolt flies before it fades (the blaster's four, or a ship gun's range over its speed). */
  life?: number;
  color?: number;
  /** The shooter's body, which the bolt flies out through. */
  exclude?: RAPIER.RigidBody;
  /** A ship's bolt: drawn as the game's projectile effect, when the effects are loaded. */
  projectile?: ProjectileVisual | null;
  /** The bolt's size over the E-11's (a rocket is twice, a repeater's bolt smaller). */
  size?: number;
  /** The shove on what it hits, as the creatures' knock scale. */
  push?: number;
  /** Called where the bolt lands, with what it struck when that is something that can be hurt (a rocket's blast, a burn). */
  onHit?: (point: THREE.Vector3, target: Hittable | null) => void;
  /** The bolt falls, metres a second squared (a slug's drop, a crossbow's arc). */
  gravity?: number;
  /** Off a wall or the ground the bolt bounces, this many times, before it lands. */
  bounces?: number;
  /** The bolt turns toward this each frame (a homing rocket). */
  homing?: { pos: THREE.Vector3; dead?: boolean } | null;
  /**
   * Fired inside a ship's rooms: the bolt lives in the hull's frame (`from` and `dir` given in it), flies
   * against the room's own physics, and is drawn where the hull's transform carries it, so the ship's
   * motion is no part of its path.
   */
  frame?: BoltFrame | null;
  /** Who fired it, so whatever it hits knows who to turn on. */
  source?: Living | null;
  /**
   * The gun's own sounds: its shot, what it sounds like striking each surface, and what it sounds
   * like coming to nothing. Every caller passes its gun's set; a bolt with none but a ship's
   * projectile takes that projectile's, and one with neither is silent at the muzzle and takes the
   * plain blaster's where it lands.
   */
  sound?: GunSound | null;
  /**
   * A picture of somebody else's bolt: it flies, is drawn, is heard and leaves its mark, and it
   * hurts nothing at all. A shot fired on one screen is flown again on every other, so without this
   * one trigger pull would take health three times over; the browser that fired is the only one
   * whose bolt is real.
   */
  inert?: boolean;
  /**
   * Which shot this is, when it is one that crosses between browsers: a number made by whoever is
   * keeping them, 0 for a bolt that is nobody's business but this browser's. It is what lets a shot
   * be cut short where the one who fired it says it landed, and what makes a blade's block a word
   * rather than a second bolt.
   */
  wire?: number;
}

export interface BoltFrame {
  /** The hull's world matrix, read live. */
  matrix: THREE.Matrix4;
  physics: Physics;
}

export interface Bolt {
  readonly pos: THREE.Vector3;
  readonly dir: THREE.Vector3;
  /** Metres a second. */
  speed: number;
  damage: number;
  owner: BoltOwner;
  exclude: RAPIER.RigidBody | undefined;
  age: number;
  life: number;
  /** How far ahead of `pos` the bolt's tip is: what leads the way into whatever it hits. */
  lead: number;
  /** Set once a saber has turned it away, so a second block cannot send it back again at once. */
  reflected: number;
  mesh: THREE.Group;
  /** The projectile effect carried along, in place of the mesh, for a ship's bolt. */
  fx: EffectHandle | null;
  hitFx: string | null;
  /** Which effects player drew it, when an effect did. */
  fxPack: ParticleEffects | null;
  push: number;
  onHit: ((point: THREE.Vector3, target: Hittable | null) => void) | null;
  gravity: number;
  bounces: number;
  homing: { pos: THREE.Vector3; dead?: boolean } | null;
  /** The bolt's velocity as a vector when it falls or turns; `dir` and `speed` follow it. */
  vel: THREE.Vector3 | null;
  /** The hull's frame the bolt lives in, aboard; null in the world. */
  frame: BoltFrame | null;
  /** Who fired it; a bolt turned away by the saber becomes the player's. */
  source: Living | null;
  /** The gun's own sounds, carried so that where it lands sounds like what fired it. */
  sound: GunSound | null;
  /** It has already whined past the ear, so a slow bolt alongside does not whine every frame. */
  flew: boolean;
  /**
   * What it looks like, kept on the bolt rather than only in the options it was built from: a bolt
   * that is fired again from somewhere else -- turned away by a blade, or flown again on another
   * browser -- is then the same bolt to look at and not a plain one of roughly the right colour.
   */
  color: number;
  size: number;
  projectile: ProjectileVisual | null;
  /** A picture of somebody else's shot: it hurts nothing (`BoltOptions.inert`). */
  inert: boolean;
  /** Which shot it is where shots cross between browsers, 0 where they do not (`BoltOptions.wire`). */
  wire: number;
}

/** A shot that landed the instant it was fired: its line, fading over its life. */
interface Beam {
  mesh: THREE.Group;
  age: number;
  life: number;
  width: number;
}

/** What a bolt may strike and what to do about it. */
export interface BoltWorld {
  physics: Physics;
  effects: Effects;
  /** The creature, emplacement or vehicle a collider belongs to. */
  hittableAt(handle: number): Hittable | undefined;
  /** The player's body and collider, hit by other shooters' bolts. */
  player: { body: RAPIER.RigidBody; collider: RAPIER.Collider; pos: THREE.Vector3 };
  /** The player as something that can be blamed: a bolt the saber turns away becomes theirs. */
  playerSource?: Living | null;
  /** A bolt reached the player: return the way it leaves when blocked, or null to let it hurt. */
  block(bolt: Bolt, hit: THREE.Vector3, out: THREE.Vector3): boolean;
  onPlayerHit(damage: number, from: THREE.Vector3): void;
}

const tmp = new THREE.Vector3();
/** Where a shot or a strike is heard; a module vector, so firing ten times a second allocates nothing. */
const soundAt = new THREE.Vector3();
/** The stretch a bolt covers this frame, in the world, for the whine as it goes by. */
const flyStep = new THREE.Vector3();
const hitPoint = new THREE.Vector3();
const hitNormal = new THREE.Vector3();
const bounce = new THREE.Vector3();
const placeQ = new THREE.Quaternion();
const frameQ = new THREE.Quaternion();
const placeM = new THREE.Matrix4();
const ONE = new THREE.Vector3(1, 1, 1);
const Z = new THREE.Vector3(0, 0, 1);
const Y = new THREE.Vector3(0, 1, 0);
/** Bolt length in metres: JKA's bolt effect is about 32 units long. */
const LENGTH = 32 * UNIT;

export class Bolts {
  readonly bolts: Bolt[] = [];
  // The bolt: a bright core, a glow that tapers off toward the tail, and a rounder head of light.
  private readonly core = new THREE.CylinderGeometry(0.02, 0.012, LENGTH, 6, 1).rotateX(Math.PI / 2);
  private readonly glow = new THREE.CylinderGeometry(0.075, 0.02, LENGTH * 1.1, 8, 1).rotateX(Math.PI / 2);
  private readonly head = new THREE.SphereGeometry(0.06, 8, 6).translate(0, 0, LENGTH * 0.5);
  private readonly beamCore = new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  private readonly beamGlow = new THREE.CylinderGeometry(0.045, 0.045, 1, 8, 1).rotateX(Math.PI / 2).translate(0, 0, 0.5);
  private readonly beams: Beam[] = [];
  private readonly materials = new Map<number, [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial]>();
  /** Bolts fired this session by each side, for the console. */
  readonly fired = { player: 0, enemy: 0 };
  /** The player of the ships pack's particle effects, once there is one: a ship's bolt is drawn through it. */
  visuals: ParticleEffects | null = null;
  /** The weapons pack's, for the guns' own shot, flash and hit effects. */
  weaponVisuals: ParticleEffects | null = null;
  /**
   * The world ray's filter: a collider in no collision group is a ghosted hull (a ship in a jump, or a
   * ship's hull still being prepared before it joins the world's vehicles), and a bolt flies through it.
   * `Vehicle.setGhost` is the only thing that empties a collider's groups. Made once, not per ray.
   */
  private readonly passable = (c: RAPIER.Collider): boolean => c.collisionGroups() !== 0;
  /**
   * The same for a picture of somebody else's bolt, with every other player's body passed over as
   * well. Such a copy is fired from the very muzzle it left on the other screen, and that muzzle is
   * inside the shooter's own body here -- inside the one box a hull of theirs is -- so a ray that
   * could find it would stop the copy dead at the gun and nothing would ever be seen to fly. It is
   * also not this browser's business whether the shot hit anybody: the one who fired says where it
   * stopped, and the copy is cut short there.
   */
  private readonly passableNotPeer = (c: RAPIER.Collider): boolean => c.collisionGroups() !== 0 && !this.peers?.isPeer(c.handle);
  /** The physics of the world being flown through, for the filter above; set at the top of every update. */
  private peers: Physics | null = null;

  /** The effects player for a visual's pack. */
  private playerFor(v: ProjectileVisual | null | undefined): ParticleEffects | null {
    if (!v) return null;
    return v.pack === 'weapons' ? this.weaponVisuals : this.visuals;
  }

  /** Play a weapons-pack effect once at a point, facing `dir` (a muzzle flash, a hit). */
  flash(effect: string | null | undefined, at: THREE.Vector3, dir: THREE.Vector3): void {
    if (!effect || !this.weaponVisuals) return;
    placeQ.setFromUnitVectors(Z, tmp.copy(dir).normalize());
    this.weaponVisuals.place(effect, placeM.compose(at, placeQ, ONE), false, true);
  }

  constructor(private readonly scene: THREE.Scene) {}

  /**
   * Every bolt that leaves a muzzle, whoever fired it. It is the one place a shot can be picked up
   * and sent to the other browsers; nothing here decides which shots are worth sending, because only
   * the game knows which of them are this player's. Everything such a shot is made of is on the bolt
   * itself, so nothing has to be carried alongside it.
   */
  onFire: ((bolt: Bolt) => void) | null = null;
  /**
   * Every bolt as it leaves the air, with the point it struck or null when it simply reached the end
   * of its flight. What crosses is that point: each browser traces its own streamed world, so a
   * picture of a shot cannot be relied on to stop where the shot did.
   */
  onGone: ((bolt: Bolt, at: THREE.Vector3 | null) => void) | null = null;
  /**
   * A lit blade turned away a bolt that came off the wire. True when it was taken over -- the bolt
   * is then cut here and whoever blocked it announces a shot of their own -- and false to turn it
   * away the way a bolt fired on this browser is turned away.
   */
  onBlocked: ((bolt: Bolt, at: THREE.Vector3, out: THREE.Vector3) => boolean) | null = null;

  /** Fire a bolt from `from` along `dir` (unit length). */
  fire(from: THREE.Vector3, dir: THREE.Vector3, o: BoltOptions): Bolt {
    const { owner, damage = BLASTER.damage, speed = BLASTER.velocity, metresPerSecond, inherit, life = BLASTER.life, color = 0xff4a2a, exclude, projectile, size = 1, push = BLASTER.push, onHit, gravity = 0, bounces = 0, homing = null, frame = null, source = null, sound = null, inert = false, wire = 0 } = o;
    const [coreMat, glowMat] = this.materialsFor(color);
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(this.core, coreMat), new THREE.Mesh(this.glow, glowMat), new THREE.Mesh(this.head, glowMat));
    // A bigger bolt is wider and a little longer, not just scaled up.
    mesh.scale.set(size, size, 0.6 + size * 0.4);
    mesh.position.copy(from);
    // The bolt's velocity: its muzzle speed along the barrel, plus whatever the shooter itself
    // was doing, so a fighter at full throttle sees its bolts pull away as they should.
    const vel = dir.clone().normalize().multiplyScalar(metresPerSecond ?? speed * UNIT);
    if (inherit) vel.add(inherit);
    const s = vel.length();
    const heading = s > 1e-6 ? vel.divideScalar(s) : dir.clone().normalize();
    mesh.quaternion.setFromUnitVectors(Z, heading);
    const fxPlayer = this.playerFor(projectile);
    const fx = projectile && fxPlayer ? fxPlayer.place(projectile.effect, placeM.compose(from, mesh.quaternion, ONE), false, true) : null;
    if (fx) mesh.visible = false;
    this.scene.add(mesh);
    markActor(mesh);
    // Which gun this is, for everything it will be heard doing: the caller's own set, or, for a
    // ship's bolt fired by something that does not carry one, the set of the projectile it draws,
    // and failing both the plain blaster, so a bolt is never silent leaving and loud landing.
    const gun = sound ?? (projectile ? combatSounds.projectileGun(projectile.effect) : null) ?? GENERIC_GUN;
    const bolt: Bolt = { pos: from.clone(), dir: heading, speed: s, damage, owner, exclude, age: 0, life, lead: fx && projectile ? projectile.reach : (LENGTH / 2) * mesh.scale.z, reflected: 0, mesh, fx, hitFx: fx ? (projectile?.hit ?? null) : null, fxPack: fx ? fxPlayer : null, push, onHit: onHit ?? null, gravity, bounces, homing, vel: gravity || homing ? vel.clone().multiplyScalar(s) : null, frame, source, sound: gun, flew: false, color, size, projectile: projectile ?? null, inert, wire };
    if (frame) this.settle(bolt);
    this.bolts.push(bolt);
    this.fired[owner]++;
    // The shot itself, from the one place every bolt in the game passes through. Aboard, the muzzle
    // is in the hull's frame and the ear is in the world, so it is carried out before it is heard.
    // Who fired matters as much as what: a volley is one shot per shooter, and a squad carrying one
    // kind of rifle is several. The shooter is its own body where it has no key of its own (a
    // turret), so every emplacement of a field is still itself.
    if (frame) soundAt.copy(from).applyMatrix4(frame.matrix);
    else soundAt.copy(from);
    combatSounds.fire(gun, soundAt.x, soundAt.y, soundAt.z, source?.key ?? exclude?.handle ?? 0);
    // Last, with the bolt whole and already in the air: whoever is carrying shots to the other
    // browsers reads what it needs off it. A shot made in answer to this one (a picture of it)
    // comes back through here and is known by having no shooter of its own, so nothing can send a
    // shot round for ever.
    this.onFire?.(bolt);
    return bolt;
  }

  /** A bolt of each colour far below the world, gone on the next update, so the first real shot finds its shaders compiled. */
  warmUp(colors: number[] = [0xff4a2a, 0x3af06a]): void {
    for (const color of colors) {
      // Not really a shot: the set that names nothing, so the warm-up is heard no more than it is seen.
      const b = this.fire(new THREE.Vector3(0, -900, 0), new THREE.Vector3(0, -1, 0), { owner: 'enemy', color, speed: 0, sound: SILENT_GUN });
      b.age = BLASTER.life;
      this.fired.enemy--;
    }
  }

  /**
   * A shot that has already landed (a disruptor's): its line from muzzle to mark, drawn as a beam
   * that thins away over `life` seconds. `width` is over the plain beam's.
   */
  beam(from: THREE.Vector3, to: THREE.Vector3, color: number, life = 0.35, width = 1): void {
    const [coreMat, glowMat] = this.materialsFor(color);
    const mesh = new THREE.Group();
    mesh.add(new THREE.Mesh(this.beamCore, coreMat.clone()), new THREE.Mesh(this.beamGlow, glowMat.clone()));
    mesh.position.copy(from);
    tmp.copy(to).sub(from);
    const len = tmp.length();
    if (len < 1e-3) return;
    mesh.quaternion.setFromUnitVectors(Z, tmp.divideScalar(len));
    mesh.scale.set(width, width, len);
    this.scene.add(mesh);
    markActor(mesh);
    this.beams.push({ mesh, age: 0, life, width });
  }

  /** Fly every bolt on by `dt` and settle what each one struck. */
  update(dt: number, w: BoltWorld): void {
    this.peers = w.physics;
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.age += dt;
      const t = b.age / b.life;
      if (t >= 1) {
        this.scene.remove(b.mesh);
        for (const m of b.mesh.children) ((m as THREE.Mesh).material as THREE.Material).dispose();
        this.beams.splice(i, 1);
        continue;
      }
      const w2 = b.width * (1 - t * t);
      b.mesh.scale.x = w2;
      b.mesh.scale.y = w2;
      for (const m of b.mesh.children) ((m as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.9;
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.age += dt;
      if (b.age > b.life) {
        // It reached the end of its flight without striking anything: the weapon table's own
        // "hit nothing" sound, which most guns have and the plain blaster has not.
        if (b.sound) combatSounds.miss(b.sound, b.mesh.position.x, b.mesh.position.y, b.mesh.position.z, 'nothing');
        this.remove(i);
        continue;
      }
      // A bolt that falls or turns keeps a velocity: gravity pulls it, a homing one steers toward its mark.
      if (b.vel) {
        if (b.gravity) b.vel.y -= b.gravity * dt;
        if (b.homing && !b.homing.dead) {
          tmp.copy(b.homing.pos).sub(b.pos);
          tmp.y += 0.8;
          const d = tmp.length();
          if (d > 0.5) {
            tmp.divideScalar(d);
            const s = b.vel.length();
            b.vel.divideScalar(s).lerp(tmp, Math.min(1, dt * 3.5)).normalize().multiplyScalar(s);
          }
        }
        b.speed = b.vel.length();
        if (b.speed > 1e-6) b.dir.copy(b.vel).divideScalar(b.speed);
      }
      const step = b.speed * dt;
      // Past the ear, over the stretch it covers this frame rather than at the one point it was
      // drawn at: a bolt crosses 20 to 40 metres in a frame and would otherwise slip past the ear
      // unheard five times out of six. The mesh's place is where it was drawn, in the world; aboard,
      // its heading is in the hull's frame and is carried out to match.
      if (!b.flew && b.sound) {
        flyStep.copy(b.dir);
        if (b.frame) flyStep.transformDirection(b.frame.matrix);
        flyStep.multiplyScalar(step);
        b.flew = combatSounds.flyPast(b.mesh.position.x, b.mesh.position.y, b.mesh.position.z, flyStep.x, flyStep.y, flyStep.z, b.sound.ship);
      }
      // Aboard, the bolt flies in the hull's frame against the room's own walls: nothing else is in there.
      if (b.frame) {
        const ray = new RAPIER.Ray(b.pos, b.dir);
        const hit = b.frame.physics.world.castRayAndGetNormal(ray, step + b.lead, true, undefined, undefined, undefined, undefined);
        if (!hit) {
          b.pos.addScaledVector(b.dir, step);
          this.settle(b);
          continue;
        }
        const p = ray.pointAt(hit.timeOfImpact);
        hitPoint.set(p.x, p.y, p.z).applyMatrix4(b.frame.matrix);
        // A hull's rooms are the hull: its walls and its deck sound like metal, and no ray of the
        // planet's physics reaches in there to say otherwise.
        combatSounds.hit(b.sound, hitPoint.x, hitPoint.y, hitPoint.z, 'ship');
        w.effects.burst(hitPoint, 0xffb070, 0.35, 0.12);
        w.effects.flash(hitPoint, 0xff8a50, 6, 4, 0.08);
        // Nothing a picture of a bolt lands on is told about it: whatever the shot did is the
        // business of the browser that fired it, and this is one of the three ways a bolt in this
        // file can pass something on.
        if (!b.inert) b.onHit?.(hitPoint, null);
        this.remove(i, hitPoint);
        continue;
      }
      // The bolt's own length leads the way so it does not visibly poke through what it hits.
      const ray = new RAPIER.Ray(b.pos, b.dir);
      const hit = w.physics.world.castRayAndGetNormal(ray, step + b.lead, true, undefined, undefined, undefined, b.exclude, b.inert ? this.passableNotPeer : this.passable);
      if (!hit) {
        b.pos.addScaledVector(b.dir, step);
        this.settle(b);
        continue;
      }
      const p = ray.pointAt(hit.timeOfImpact);
      hitPoint.set(p.x, p.y, p.z);
      hitNormal.set(hit.normal.x, hit.normal.y, hit.normal.z);
      // Off a wall or the ground, a bouncing bolt turns and flies on.
      if (b.bounces > 0 && hit.collider.handle !== w.player.collider.handle && !w.hittableAt(hit.collider.handle)) {
        b.bounces--;
        if (hitNormal.lengthSq() > 1e-6) {
          hitNormal.normalize();
          b.dir.reflect(hitNormal);
          if (b.vel) b.vel.copy(b.dir).multiplyScalar(b.speed);
        }
        b.pos.copy(hitPoint).addScaledVector(b.dir, 0.05 + b.lead * 0.5);
        this.settle(b);
        // Off a wall: the weapon table's own ricochet where the gun has one, else what it sounds
        // like striking whatever it glanced off.
        if (b.sound?.ricochet) combatSounds.ricochet(b.sound, hitPoint.x, hitPoint.y, hitPoint.z);
        else combatSounds.hit(b.sound, hitPoint.x, hitPoint.y, hitPoint.z, null, hit.collider.handle);
        w.effects.burst(hitPoint, 0xffb070, 0.3, 0.1);
        continue;
      }
      if (hit.collider.handle === w.player.collider.handle) {
        if (b.owner !== 'player' && w.block(b, hitPoint, bounce)) {
          // A bolt somebody else fired cannot simply become this player's: the browser that fired it
          // is watching its own copy fly, and the blade is not in that world at all. It is a word
          // instead -- that shot stops here, on every screen including the shooter's, and the one who
          // blocked it announces a shot of their own from the same point. One bolt in, one bolt out.
          if (b.wire && this.onBlocked?.(b, hitPoint, bounce)) {
            w.effects.burst(hitPoint, 0xbfe6ff, 0.6, 0.15);
            w.effects.flash(hitPoint, 0x9fd4ff, 14, 7, 0.12);
            this.remove(i, hitPoint);
            continue;
          }
          // Turned away by the saber: it now belongs to the player and flies on from the block.
          b.owner = 'player';
          b.exclude = w.player.body;
          // It is the player's shot now: whatever it goes on to hurt turns on them, not the shooter.
          b.source = w.playerSource ?? null;
          b.reflected++;
          b.age = 0;
          b.dir.copy(bounce);
          b.pos.copy(hitPoint).addScaledVector(b.dir, 0.05);
          this.settle(b);
          w.effects.burst(hitPoint, 0xbfe6ff, 0.6, 0.15);
          w.effects.flash(hitPoint, 0x9fd4ff, 14, 7, 0.12);
          continue;
        }
        if (b.owner !== 'player') {
          // A picture of somebody else's bolt stops here and is heard and seen doing it, and takes
          // nothing: the browser that fired it is the one that says whether it hit, and what it
          // takes comes back from there.
          if (!b.inert) w.onPlayerHit(b.damage, b.pos);
          combatSounds.hit(b.sound, hitPoint.x, hitPoint.y, hitPoint.z, 'creature');
          w.effects.burst(hitPoint, 0xff8060, 0.5, 0.15);
        }
        if (!b.inert) b.onHit?.(hitPoint, null);
        this.remove(i, hitPoint);
        continue;
      }
      // What it struck, and what may be taken off it: a picture of somebody else's bolt is seen and
      // heard striking a creature, a hull or a wall exactly as the real one is, and takes nothing
      // from any of them. Read both ways round, a copy striking a person looked and sounded like a
      // bolt going into the dirt.
      const struck = w.hittableAt(hit.collider.handle);
      const target = b.inert ? undefined : struck;
      if (!b.inert) b.onHit?.(hitPoint, target ?? null);
      // A ship with a fight takes the bolt whole: its shields, armour and parts, and the game's hit effect for the layer struck.
      if (struck?.takeBolt) {
        if (hitNormal.lengthSq() < 1e-6) hitNormal.copy(b.dir).negate();
        hitNormal.normalize();
        // The picture is not handed to the hull's own fight: it is drawn and heard striking it, as
        // a hull with nothing to say about the layer struck already is.
        const took = target?.takeBolt ? target.takeBolt(b, hitPoint, hitNormal) : 'taken';
        if (took) {
          // Whatever layer it went through, it struck a hull: the gun's own sound for metal.
          combatSounds.hit(b.sound, hitPoint.x, hitPoint.y, hitPoint.z, 'ship');
          // No layer effect placed (no combat file, or none for that layer): the burst and the bolt's own hit effect, as before ships had a fight.
          if (took === 'taken') {
            w.effects.burst(hitPoint, 0xffb070, 0.7, 0.15);
            if (b.hitFx && b.fxPack) {
              placeQ.setFromUnitVectors(Y, hitNormal);
              b.fxPack.place(b.hitFx, placeM.compose(hitPoint, placeQ, ONE), false, true);
            }
          }
          this.remove(i, hitPoint);
          continue;
        }
      }
      if (struck) {
        if (target) {
          tmp.copy(b.pos).addScaledVector(b.dir, -1);
          target.damage(b.damage, tmp, b.push, b.source);
        }
        combatSounds.hit(b.sound, hitPoint.x, hitPoint.y, hitPoint.z, 'creature');
        w.effects.burst(hitPoint, 0xffb070, 0.7, 0.15);
        w.effects.flash(hitPoint, 0xff8a50, 10, 6, 0.1);
      } else {
        // Nothing alive: the water, the bare ground, or something standing there. What it struck is
        // asked for by the collider that stopped it, which is the one thing that knows -- a mark on
        // a wall is metres above anything a ray down from it could name.
        const missed = combatSounds.missKindAt(hitPoint.x, hitPoint.y, hitPoint.z, hit.collider.handle);
        if (missed) combatSounds.miss(b.sound, hitPoint.x, hitPoint.y, hitPoint.z, missed);
        else combatSounds.hit(b.sound, hitPoint.x, hitPoint.y, hitPoint.z, null, hit.collider.handle);
        w.effects.burst(hitPoint, 0xffb070, 0.35, 0.12);
        w.effects.flash(hitPoint, 0xff8a50, 6, 4, 0.08);
      }
      // The game's own hit effect for a ship's or a gun's bolt, stood on the surface it struck.
      if (b.hitFx && b.fxPack) {
        if (hitNormal.lengthSq() < 1e-6) hitNormal.copy(b.dir).negate();
        placeQ.setFromUnitVectors(Y, hitNormal.normalize());
        b.fxPack.place(b.hitFx, placeM.compose(hitPoint, placeQ, ONE), false, true);
      }
      this.remove(i, hitPoint);
    }
  }

  /**
   * End a bolt where somebody else says it landed, with the mark and the burst there. It is how a
   * picture of a shot is brought into line with the shot it copies, and how the one real bolt is
   * stopped when a blade somewhere else turned it away. A bolt that has already gone is no error:
   * the word and the flight are two clocks, and either may come first.
   */
  cutShort(bolt: Bolt, at: THREE.Vector3, effects: Effects | null = null): boolean {
    const i = this.bolts.indexOf(bolt);
    if (i < 0) return false;
    effects?.burst(at, 0xffb070, 0.35, 0.12);
    this.remove(i, null);
    return true;
  }

  /** Put the bolt's mesh, or the effect carried in its place, where the bolt now is. */
  private settle(b: Bolt): void {
    if (b.frame) {
      // Where the hull's transform carries the bolt's own place and heading.
      b.mesh.position.copy(b.pos).applyMatrix4(b.frame.matrix);
      frameQ.setFromRotationMatrix(b.frame.matrix);
      b.mesh.quaternion.setFromUnitVectors(Z, b.dir).premultiply(frameQ);
    } else {
      b.mesh.position.copy(b.pos);
      b.mesh.quaternion.setFromUnitVectors(Z, b.dir);
    }
    if (b.fx && b.fxPack) b.fxPack.move(b.fx, placeM.compose(b.mesh.position, b.mesh.quaternion, ONE));
  }

  /** Take every bolt out of the air (leaving a planet). */
  clear(): void {
    for (let i = this.bolts.length - 1; i >= 0; i--) this.remove(i);
  }

  /** `at` is where it struck, or null when it reached the end of its flight or was cut short by a word. */
  private remove(i: number, at: THREE.Vector3 | null = null): void {
    const b = this.bolts[i];
    this.scene.remove(b.mesh);
    if (b.fx && b.fxPack) b.fxPack.remove(b.fx);
    this.bolts.splice(i, 1);
    // Whoever is carrying shots between browsers hears about every one of them leaving the air, so
    // nothing it is holding outlives the bolt it is about. The point is the one it is holding while
    // it settles what was struck, so it is read now or not at all.
    this.onGone?.(b, at);
  }

  private materialsFor(color: number): [THREE.MeshBasicMaterial, THREE.MeshBasicMaterial] {
    let m = this.materials.get(color);
    if (!m) {
      const c = new THREE.Color(color);
      m = [
        new THREE.MeshBasicMaterial({ color: c.clone().lerp(new THREE.Color(0xffffff), 0.7).multiplyScalar(1.6), toneMapped: false }),
        new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(1.3), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      ];
      this.materials.set(color, m);
    }
    return m;
  }

  dispose(): void {
    this.clear();
    for (const b of this.beams) this.scene.remove(b.mesh);
    this.beams.length = 0;
    this.core.dispose();
    this.glow.dispose();
    this.head.dispose();
    this.beamCore.dispose();
    this.beamGlow.dispose();
    for (const [a, b] of this.materials.values()) {
      a.dispose();
      b.dispose();
    }
    this.materials.clear();
  }
}
