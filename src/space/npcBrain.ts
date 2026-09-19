// An NPC pilot. The game's server flew its NPC ships and none of that shipped, so every state and
// number here is INVENTED: patrolling an anchor's route, holding a formation slot, engaging with a
// lead on the target, breaking off before a collision, jinking when shot from behind, fleeing when
// the hull is nearly gone (TIE pilots never flee), and returning to the anchor. The brain fills the
// ship's drive in place (flyShip reads the stick, the roll and the cruise from it), and fires the
// ship's own guns through its combat's turn and cooldown with the bolts its components fire.
//
// Nothing is allocated per frame: module scratch vectors, and each brain's own kept objects.
import * as THREE from 'three';
import { NOBODY, PLAYER_KEY, type Living } from '../combat/kit';
import type { Bolts, ProjectileVisual } from '../combat/bolts';
import type { Effects } from '../combat/effects';
import { RAPIER, type Physics } from '../core/physics';
import type { DriveInput } from '../vehicles/vehicle';
import { ShipContact, type ShipContacts } from './contacts';
import { shipHostile } from './factions';
import { PILOT_SKILL, aimPoint, formationPoint, skillOfTier, skillStick, slotCruise, steerToward, toLocal, type PilotSkill, type Stick } from './pilot';
import { targetable } from './shipCombat';
import type { NpcShip } from './npcShips';

export type BrainState = 'patrol' | 'formation' | 'engage' | 'breakoff' | 'evade' | 'flee' | 'return';

/** How well a tier flies and shoots: invented, kept with the pilot's other numbers in pilot.ts (PILOT_SKILL). */
export const SKILL = PILOT_SKILL;
/** How far a pilot sees a ship it would attack (metres), in space and near a planet (invented). */
export const DETECT = { space: 1500, planet: 800 };
/** How far from its anchor (or where it was stood) a pilot chases before it turns back (invented). */
export const LEASH = 4000;
/** The least height over the ground a pilot flies at on a planet (invented). */
export const MIN_ALTITUDE = 60;

/** The rest of the brain's invented numbers, in one place. */
const TUNE = {
  /** Past this off the nose the pilot rolls the target overhead and pulls, as a fighter turns (radians). */
  bankBeyond: THREE.MathUtils.degToRad(35),
  /** Seconds a blow is remembered for retaliation. */
  retaliate: 20,
  /** The range an engaging pilot holds, as a share of the distance, within 0.4 and 1 of the top speed. */
  holdShare: 0.6,
  /** Coming at each other: this share of the top speed. On a target's tail: this far behind it (metres). */
  passShare: 0.55,
  tailRange: 250,
  /** Farther than this the pilot boosts toward its target (metres). */
  boostBeyond: 1200,
  /** Seconds of a break-off (plus up to one more). */
  breakSeconds: 1.2,
  /** A break-off: the target's closest approach within `breakAhead` s passing nearer than the hulls and `collideMargin` (m). */
  breakAhead: 0.8,
  collideMargin: 25,
  /** Any ship's closest approach within this many seconds nearer than the hulls and `dodgeMargin` is dodged. */
  collideSeconds: 1.5,
  /** A jink: this long in all, each turn this long (plus up to as much again), this far off the nose (radians). */
  evadeSeconds: 3,
  jinkEvery: 0.6,
  jinkAngle: THREE.MathUtils.degToRad(70),
  /** An attacker behind within this range (m) makes a pilot jink. */
  evadeBehind: 400,
  /** Under this share of the hull a pilot flees (not an Imperial one), for this long. */
  fleeShare: 0.2,
  fleeSeconds: 12,
  /** Seconds without a target before the pilot turns back. */
  lostSeconds: 8,
  /** The obstacle look ahead: how often (s), how far (seconds of flight, and at least this many metres), and how long the pilot turns away. */
  rayEvery: 0.25,
  rayAhead: 2.5,
  rayMin: 60,
  avoidSeconds: 1.5,
  /** Another ship nearer than this (metres, between the hulls) is turned away from. */
  separation: 40,
  /** Ships within this (metres) are checked for a collision course, dodged when passing nearer than the hulls and this margin. */
  dodgeLook: 400,
  dodgeMargin: 15,
  /** A patrol's next point once within this (metres), at this share of the top speed. */
  waypointReach: 150,
  patrolShare: 0.5,
  /** A wingman aims this far ahead of its slot along the leader's nose (metres). */
  slotAhead: 60,
  /** Returning: back in its place within this (metres). */
  homeReach: 1200,
  /** A shot at the player on foot: this share of its damage, aimed this high over the feet (m). */
  onFootShare: 0.25,
  chest: 1.1,
};

/** What a brain needs from the world, kept by the manager and filled once a frame. */
export interface BrainContext {
  readonly ships: ShipContacts;
  readonly bolts: Bolts;
  /** For the obstacle ray; null leaves it out. */
  physics: Physics | null;
  projectileFor(index: number): ProjectileVisual | null;
  effects(): Effects | null;
  /** The terrain's height on a planet; null in space. */
  groundAt: ((x: number, z: number) => number) | null;
  space: boolean;
  /** NPC fire allowed this frame (not passive, under the NPC bolt cap). */
  mayFire: boolean;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const pos = new THREE.Vector3();
const vel = new THREE.Vector3();
const nose = new THREE.Vector3();
const want = new THREE.Vector3();
const tPos = new THREE.Vector3();
const tVel = new THREE.Vector3();
const aim = new THREE.Vector3();
const toT = new THREE.Vector3();
const slotPt = new THREE.Vector3();
const slotV = new THREE.Vector3();
const leaderNose = new THREE.Vector3();
const local = new THREE.Vector3();
const localUp = new THREE.Vector3();
const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();
const shotFrom = new THREE.Vector3();
const shotDir = new THREE.Vector3();
const inherit = new THREE.Vector3();
const attitude = new THREE.Quaternion();

/**
 * A ship's velocity without asking the physics (whose `linvel()` makes an object per call): a flying hull is set to
 * its nose times its cruise every step (flyShip), which is `speed`; a landed one's speed is along its nose too.
 */
function velocityOf(v: NpcShip['vehicle'], out: THREE.Vector3): THREE.Vector3 {
  return out.set(0, 0, 1).applyQuaternion(v.group.quaternion).multiplyScalar(v.speed);
}

/** A contact that may still be fought, or the player on foot still there. */
function alive(t: Living | null, me: ShipContact): boolean {
  if (!t || t === me) return false;
  if (t instanceof ShipContact) return !t.vehicle.disposed && targetable(t);
  return !t.dead;
}

export class NpcBrain {
  state: BrainState = 'patrol';
  targetKey = NOBODY;
  /** The target this key named when last resolved (checked every frame, chosen again every `reaction`). */
  target: Living | null = null;
  /** What flyShip reads: kept and refilled, never replaced. */
  readonly drive: DriveInput = { throttle: 0, steer: 0, heading: null, boost: false, hop: false, up: false, down: false, stickX: 0, stickY: 0, cruise: 0 };
  /** Shots fired, for the console. */
  shots = 0;
  private readonly skill: PilotSkill;
  /** The stick the pilot wants (steerToward's), and the one its hand holds (capped and eased by its skill). */
  private readonly stick: Stick = { x: 0, y: 0, roll: 0 };
  private readonly held: Stick = { x: 0, y: 0, roll: 0 };
  private nextPick: number;
  private nextRay: number;
  private stateUntil = 0;
  private lostSince = 0;
  private fled = false;
  /** The last blow the brain has seen (the contact's `lastAttackedAt`), so a new one can make it jink. */
  private seenHit = -Infinity;
  private readonly fleeFrom = new THREE.Vector3();
  /** A break-off's or a jink's direction, in the world. */
  private readonly away = new THREE.Vector3();
  private jinkAt = 0;
  private avoidUntil = 0;
  private readonly avoid = new THREE.Vector3();
  private readonly rayOrigin = { x: 0, y: 0, z: 0 };
  private readonly rayDir = { x: 0, y: 0, z: 1 };
  private readonly ray = new RAPIER.Ray(this.rayOrigin, this.rayDir);
  /** What the obstacle ray may meet: not a ghosted hull (in a jump, or still being prepared; its colliders in no group) nor a sensor. Made once. */
  private readonly solidOnly = (c: RAPIER.Collider): boolean => c.collisionGroups() !== 0 && !c.isSensor();
  /** Within the leash of the group's anchor (or where it was stood): nothing farther is chased. Made once. */
  private readonly leashed = (t: Living): boolean => {
    const g = this.ship.group;
    return t.pos.distanceToSquared(g.anchor ? g.anchor.pos : g.home) <= LEASH * LEASH;
  };

  constructor(
    private readonly ship: NpcShip,
    private readonly rng: () => number,
  ) {
    this.skill = skillOfTier(ship.type.tier);
    // Staggered, so a group does not all choose and look on the same frame.
    this.nextPick = rng() * this.skill.reaction;
    this.nextRay = rng() * TUNE.rayEvery;
  }

  /** Forget the target (it went into a jump, or the world changed). */
  drop(): void {
    this.target = null;
    this.targetKey = NOBODY;
  }

  /** Think one step: choose the target, move the state, fill the drive, and fire. */
  think(dt: number, now: number, ctx: BrainContext): void {
    const ship = this.ship;
    const v = ship.vehicle;
    const me = ship.contact;
    const combat = me.combat;
    if (v.disposed || me.dead) return;
    const space = ctx.space;
    const s = v.spec;
    const top = s.maxSpeed * (space ? 2 : 1);
    const boostTop = s.boostSpeed * (space ? 2 : 1);
    pos.copy(v.pos);
    nose.set(0, 0, 1).applyQuaternion(v.group.quaternion);
    velocityOf(v, vel);
    const group = ship.group;
    const leader = group.members[0] ?? ship;
    const isLeader = leader === ship;
    const home = group.anchor ? group.anchor.pos : group.home;

    // The target: checked every frame (`targetable`: a ship in a jump, or dead, is dropped at once), chosen again every `reaction`.
    if (this.target && !alive(this.target, me)) this.drop();
    if (now >= this.nextPick) {
      this.nextPick = now + this.skill.reaction;
      this.pick(now, ctx, isLeader ? null : leader);
    }
    const target = this.target;

    // The state.
    if (target) {
      this.lostSince = now;
      if (!this.fled && me.faction !== 'imperial' && v.hp / v.maxHp < TUNE.fleeShare) {
        this.fled = true;
        this.state = 'flee';
        this.stateUntil = now + TUNE.fleeSeconds;
        this.fleeFrom.copy(target.pos);
      } else if (this.state !== 'breakoff' && this.state !== 'evade' && this.state !== 'flee') this.state = 'engage';
      // Beyond the leash: let go and go back.
      if (this.state !== 'flee' && pos.distanceToSquared(home) > LEASH * LEASH) {
        this.drop();
        this.state = 'return';
      }
    } else if (this.state === 'engage' || this.state === 'breakoff' || this.state === 'evade') {
      this.state = now - this.lostSince > TUNE.lostSeconds || pos.distanceTo(home) > (group.anchor?.radius ?? 0) + TUNE.homeReach ? 'return' : isLeader ? 'patrol' : 'formation';
    }
    if ((this.state === 'breakoff' || this.state === 'evade') && now >= this.stateUntil) this.state = target ? 'engage' : 'return';
    if (this.state === 'flee' && now >= this.stateUntil) this.state = 'return';
    if (!target && (this.state === 'patrol' || this.state === 'formation')) this.state = isLeader ? 'patrol' : 'formation';

    // Where to go, and how fast.
    let speed = top * TUNE.patrolShare;
    let boost = false;
    let firing = false;
    let aimValid = false;
    let targetDist = Infinity;
    switch (this.state) {
      case 'engage':
      case 'breakoff':
      case 'evade': {
        const t = target!;
        tPos.copy(t.pos);
        if (t instanceof ShipContact) velocityOf(t.vehicle, tVel);
        else {
          tVel.set(0, 0, 0);
          tPos.y += TUNE.chest;
        }
        toT.copy(tPos).sub(pos);
        targetDist = toT.length();
        const weapon = combat && v.guns.length ? combat.weaponOfGun(combat.nextGun % v.guns.length) : null;
        const boltSpeed = weapon?.speed ?? 600;
        aimValid = aimPoint(pos, vel, tPos, tVel, boltSpeed, this.skill.lead, aim) !== null;
        if (!aimValid) aim.copy(tPos);
        if (this.state === 'engage') {
          const radii = v.radius + t.radiusToward(pos);
          // A collision course: the closest approach within `collideSeconds` passes nearer than the hulls and a margin.
          tmp.copy(tVel).sub(vel);
          const rv2 = tmp.lengthSq();
          const tca = rv2 > 1e-6 ? -toT.dot(tmp) / rv2 : -1;
          const miss = tca > 0 && tca < TUNE.breakAhead ? tmp2.copy(toT).addScaledVector(tmp, tca).length() : Infinity;
          if (targetDist < this.skill.breakRange * 0.5 + radii || miss < radii + TUNE.collideMargin) {
            // Turn off to the side (a little away from the target), full speed, for a second or two.
            this.state = 'breakoff';
            this.stateUntil = now + TUNE.breakSeconds + this.rng();
            tmp.crossVectors(toT, WORLD_UP);
            if (tmp.lengthSq() < 1e-6) tmp.set(1, 0, 0);
            tmp.normalize().multiplyScalar(this.rng() < 0.5 ? 1 : -1);
            this.away.copy(toT).normalize().multiplyScalar(-0.3).addScaledVector(tmp, 0.95).normalize();
          } else if (this.hitFromBehind(now, ctx)) {
            this.state = 'evade';
            this.stateUntil = now + TUNE.evadeSeconds;
            this.jinkAt = now;
          }
        }
        if (this.state === 'engage') {
          want.copy(aim).sub(pos);
          // How fast: coming at each other, slow (a longer firing pass and a tighter turn after it); on its tail, hold
          // `tailRange` behind at its own speed; else close at a share of the distance.
          const tSpeed = tVel.length();
          const away = targetDist > 1e-3 && tSpeed > 1 ? tVel.dot(toT) / (tSpeed * targetDist) : 0;
          if (away < -0.5) speed = TUNE.passShare * top;
          else if (away > 0.5) speed = THREE.MathUtils.clamp(tSpeed + (targetDist - TUNE.tailRange) * 0.5, 0.4 * top, top);
          else speed = THREE.MathUtils.clamp(targetDist * TUNE.holdShare, 0.4 * top, top);
          boost = targetDist > TUNE.boostBeyond;
          firing = true;
        } else if (this.state === 'breakoff') {
          want.copy(this.away);
          speed = top;
        } else {
          // A jink: hard turns this way and that, boosting.
          if (now >= this.jinkAt) {
            this.jinkAt = now + TUNE.jinkEvery * (1 + this.rng());
            tmp.set(this.rng() - 0.5, this.rng() - 0.5, this.rng() - 0.5).cross(nose);
            if (tmp.lengthSq() < 1e-6) tmp.set(0, 1, 0);
            tmp.normalize();
            this.away.copy(nose).multiplyScalar(Math.cos(TUNE.jinkAngle)).addScaledVector(tmp, Math.sin(TUNE.jinkAngle));
          }
          want.copy(this.away);
          speed = boostTop;
          boost = true;
        }
        break;
      }
      case 'flee':
        want.copy(pos).sub(this.fleeFrom);
        speed = boostTop;
        boost = true;
        break;
      case 'return':
        if (isLeader) {
          const wp = group.route[group.waypoint] ?? home;
          want.copy(wp).sub(pos);
          if (want.length() < TUNE.homeReach) this.state = 'patrol';
        } else {
          this.slotPoint(leader, space, ctx);
          want.copy(slotPt).sub(pos);
          if (want.length() < TUNE.homeReach) this.state = 'formation';
        }
        speed = top * 0.8;
        break;
      case 'formation': {
        if (isLeader) {
          // Its leader went: it leads now, on the route.
          this.state = 'patrol';
          this.patrol(pos, group);
          want.copy(group.route[group.waypoint] ?? home).sub(pos);
          break;
        }
        this.slotPoint(leader, space, ctx);
        // Aim a little ahead of the slot along the leader's nose; the cruise holds the slot.
        tmp.copy(slotPt).sub(pos);
        const off = tmp.length();
        const ahead = tmp2.copy(pos).sub(slotPt).dot(leaderNose);
        const lead = leader.vehicle;
        if (off > 500) {
          want.copy(tmp);
          speed = top;
        } else {
          want.copy(slotPt).addScaledVector(leaderNose, TUNE.slotAhead).sub(pos);
          speed = slotCruise(Math.max(0, lead.cruise), ahead, top);
        }
        break;
      }
      default:
        this.patrol(pos, group);
        want.copy(group.route[group.waypoint] ?? home).sub(pos);
        speed = top * TUNE.patrolShare;
    }
    if (want.lengthSq() < 1e-6) want.copy(nose);
    want.normalize();

    // Always: an obstacle ahead, another ship too near, the ground too near.
    this.lookAhead(now, v, ctx);
    // Any of these pulls is flown with the whole stick at once (skillStick's `urgent`), as before the tiers had a hand.
    let urgent = now < this.avoidUntil;
    if (urgent) want.addScaledVector(this.avoid, 2).normalize();
    if (this.keepApart(v, ctx)) urgent = true;
    if (!space && ctx.groundAt) {
      const g = ctx.groundAt(pos.x, pos.z);
      const gAhead = ctx.groundAt(pos.x + vel.x * TUNE.rayAhead, pos.z + vel.z * TUNE.rayAhead);
      const h = Math.min(pos.y - g, pos.y + vel.y * TUNE.rayAhead - gAhead);
      if (h < MIN_ALTITUDE) {
        want.y += 1 + (MIN_ALTITUDE - h) / MIN_ALTITUDE;
        want.normalize();
        urgent = true;
      }
    }

    // The stick, the roll and the cruise, in flyShip's own senses.
    attitude.copy(v.group.quaternion);
    toLocal(attitude, want, local);
    const level = space ? null : toLocal(attitude, WORLD_UP, localUp);
    steerToward(local, TUNE.bankBeyond, level, this.stick);
    // The hand: the tier's cap on the stick and how quickly it gets there (all of it at once while pulling away from something).
    skillStick(this.stick, this.skill, dt, this.held, urgent);
    const canBoost = boost && !!combat && combat.boostLeft > 0;
    const cruise = canBoost ? Math.max(speed, top * 1.05) : Math.min(speed, top);
    const d = this.drive;
    d.stickX = this.held.x;
    d.stickY = this.held.y;
    d.steer = this.held.roll;
    d.cruise = cruise;
    d.throttle = v.cruise < cruise - 1 ? 1 : 0;
    d.boost = canBoost;

    if (firing && target && ctx.mayFire) this.fire(target, targetDist, v, ctx);
  }

  /** The target, chosen: who struck in the last 20 s (never its own side), the leader's, the nearest it would attack, or for a hand-stood hostile group the player's ship. */
  private pick(now: number, ctx: BrainContext, leader: NpcShip | null): void {
    const me = this.ship.contact;
    const ships = ctx.ships;
    const group = this.ship.group;
    const leashed = this.leashed;
    let best: Living | null = null;
    if (me.lastAttacker !== NOBODY && now - me.lastAttackedAt < TUNE.retaliate) {
      const t = ships.find(me.lastAttacker);
      if (t && alive(t, me) && leashed(t) && !(t instanceof ShipContact && t.faction === me.faction)) best = t;
    }
    if (!best && leader && leader.brain.target && alive(leader.brain.target, me) && leashed(leader.brain.target)) best = leader.brain.target;
    if (!best) {
      const range = ctx.space ? DETECT.space : DETECT.planet;
      let bestD = range * range;
      for (const c of ships.list) {
        if (c === me || !alive(c, me) || !shipHostile(me.faction, c.faction) || !leashed(c)) continue;
        const d2 = c.pos.distanceToSquared(me.pos);
        if (d2 < bestD) {
          bestD = d2;
          best = c;
        }
      }
    }
    const player = ships.playerShip;
    if (!best && group.byHand && player && alive(player, me) && leashed(player) && shipHostile(me.faction, player.faction)) best = player;
    const had = this.target;
    this.target = best;
    this.targetKey = best ? best.key : NOBODY;
    // A group engaging the player: its leader calls it out, once.
    if (best && best !== had && (best === player || best.key === PLAYER_KEY) && !this.ship.group.called) {
      this.ship.group.called = true;
      const speaker = this.ship.group.members[0]?.contact ?? me;
      ships.taunt(speaker, 'entercombat');
    }
  }

  /** A new blow from an attacker behind, within 400 m and pointing its guns this way: jink, by the skill's chance. */
  private hitFromBehind(now: number, ctx: BrainContext): boolean {
    const me = this.ship.contact;
    if (me.lastAttackedAt <= this.seenHit) return false;
    this.seenHit = me.lastAttackedAt;
    if (now - me.lastAttackedAt > 1) return false;
    const a = ctx.ships.find(me.lastAttacker);
    if (!(a instanceof ShipContact) || !alive(a, me)) return false;
    tmp.copy(a.pos).sub(pos);
    const d = tmp.length();
    if (d > TUNE.evadeBehind || tmp.dot(nose) > 0) return false;
    // Its nose on this ship, within twice a skilled gun cone.
    tmp2.set(0, 0, 1).applyQuaternion(a.vehicle.group.quaternion);
    if (tmp.negate().dot(tmp2) < d * Math.cos(THREE.MathUtils.degToRad(this.skill.gunConeDeg * 2))) return false;
    return this.rng() < this.skill.evadeChance;
  }

  /** The leader's route: the next point once within reach. */
  private patrol(at: THREE.Vector3, group: NpcShip['group']): void {
    if (!group.route.length) return;
    const wp = group.route[group.waypoint % group.route.length];
    if (at.distanceToSquared(wp) < TUNE.waypointReach * TUNE.waypointReach) group.waypoint = (group.waypoint + 1) % group.route.length;
  }

  /** This wingman's slot in the world now (into `slotPt`), and the leader's nose (into `leaderNose`). */
  private slotPoint(leader: NpcShip, space: boolean, ctx: BrainContext): void {
    const lv = leader.vehicle;
    leaderNose.set(0, 0, 1).applyQuaternion(lv.group.quaternion);
    const rows = ctx.ships.data?.formation(this.ship.group.formation, !space) ?? [];
    const i = this.ship.slot;
    const row = rows[i];
    if (row) slotV.set(row[0], row[1], row[2]);
    // A slot past the table's rows: behind and to either side, 40 m a step.
    else slotV.set((i % 2 ? 1 : -1) * 40 * Math.ceil(i / 2), 0, -40 * i);
    formationPoint(lv.pos, lv.group.quaternion, slotV, slotPt);
  }

  /** The obstacle ray, every quarter second: something ahead within 2.5 s of flight turns the pilot away for 1.5 s. */
  private lookAhead(now: number, v: NpcShip['vehicle'], ctx: BrainContext): void {
    if (now < this.nextRay || !ctx.physics) return;
    this.nextRay = now + TUNE.rayEvery;
    const reach = Math.max(TUNE.rayMin, Math.abs(v.speed) * TUNE.rayAhead);
    this.rayOrigin.x = pos.x;
    this.rayOrigin.y = pos.y;
    this.rayOrigin.z = pos.z;
    this.rayDir.x = nose.x;
    this.rayDir.y = nose.y;
    this.rayDir.z = nose.z;
    const hit = ctx.physics.world.castRayAndGetNormal(this.ray, reach, true, undefined, undefined, undefined, v.body, this.solidOnly);
    if (!hit) return;
    this.avoid.set(hit.normal.x, hit.normal.y, hit.normal.z);
    if (this.avoid.lengthSq() < 1e-6) this.avoid.copy(WORLD_UP);
    this.avoid.normalize();
    this.avoidUntil = now + TUNE.avoidSeconds;
  }

  /**
   * Other ships: one within the separation distance is turned away from, and one on a collision course (its closest
   * approach within `collideSeconds`, nearer than the hulls and a margin) is dodged, away from where that approach is.
   * Every ship's velocity is its nose times its speed, so nothing is asked of the physics. Says whether it pulled at all.
   */
  private keepApart(v: NpcShip['vehicle'], ctx: BrainContext): boolean {
    const me = this.ship.contact;
    let pulled = false;
    for (const c of ctx.ships.list) {
      if (c === me || c.vehicle.disposed) continue;
      const other = c.vehicle;
      const gap = TUNE.separation + v.radius + other.radius;
      const d2 = other.pos.distanceToSquared(pos);
      if (d2 < gap * gap && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        want.addScaledVector(tmp.copy(pos).sub(other.pos).divideScalar(d), 3 * (1 - d / gap)).normalize();
        pulled = true;
      }
      if (d2 > TUNE.dodgeLook * TUNE.dodgeLook) continue;
      // The closest approach: its time from the relative motion, and how near it passes.
      velocityOf(other, tmp2).sub(vel);
      const rv2 = tmp2.lengthSq();
      if (rv2 < 1) continue;
      tmp.copy(other.pos).sub(pos);
      const tca = -tmp.dot(tmp2) / rv2;
      if (tca <= 0 || tca > TUNE.collideSeconds) continue;
      tmp.addScaledVector(tmp2, tca);
      const miss = tmp.length();
      const room = v.radius + other.radius + TUNE.dodgeMargin;
      if (miss >= room) continue;
      // Away from the point of closest approach (straight up past a dead-centre one).
      if (miss < 1e-3) tmp.set(0, 1, 0).applyQuaternion(v.group.quaternion);
      else tmp.divideScalar(-miss);
      want.addScaledVector(tmp, 4 * (1 - miss / room)).normalize();
      pulled = true;
    }
    return pulled;
  }

  /** Within range and inside the gun cone of the aim: the next gun fires, scattered by the skill. */
  private fire(target: Living, dist: number, v: NpcShip['vehicle'], ctx: BrainContext): void {
    const combat = this.ship.contact.combat;
    if (!combat || !v.guns.length) return;
    const w = combat.weaponOfGun(combat.nextGun % v.guns.length);
    if (dist > w.range) return;
    tmp.copy(aim).sub(pos);
    const d = tmp.length();
    if (d < 1e-3 || tmp.dot(nose) < d * Math.cos(THREE.MathUtils.degToRad(this.skill.gunConeDeg))) return;
    const gi = combat.takeShot();
    if (gi < 0) return;
    const g = v.guns[gi];
    v.group.updateMatrixWorld(true);
    v.muzzle(g, shotFrom, shotDir);
    shotDir.copy(aim).sub(shotFrom).normalize();
    // The skill's scatter: a random turn off the aim within its cone.
    const spread = Math.tan(THREE.MathUtils.degToRad(this.skill.scatterDeg));
    tmp.set(this.rng() - 0.5, this.rng() - 0.5, this.rng() - 0.5).cross(shotDir);
    if (tmp.lengthSq() > 1e-8) shotDir.addScaledVector(tmp.normalize(), spread * this.rng()).normalize();
    shotFrom.addScaledVector(shotDir, 1.2);
    velocityOf(v, inherit);
    const onFoot = !(target instanceof ShipContact);
    ctx.bolts.fire(shotFrom, shotDir, {
      owner: 'enemy',
      damage: w.damage * (onFoot ? TUNE.onFootShare : 1),
      metresPerSecond: w.speed,
      inherit,
      life: w.range / w.speed + 0.05,
      color: v.boltColor,
      exclude: v.body,
      projectile: ctx.projectileFor(w.projectile),
      source: this.ship.contact,
    });
    ctx.effects()?.flash(shotFrom, v.boltColor, 5, 6, 0.06);
    this.shots++;
  }
}
