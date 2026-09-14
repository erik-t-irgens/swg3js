// Jedi Academy's player movement, translated from OpenJK's codemp/game/bg_pmove.c
// (PM_Friction, PM_Accelerate, PM_WalkMove, PM_AirMove, PM_CheckJump with METROID_JUMP force
// jumping and its wall runs, wall flips, backflips, wall rebounds and force flips,
// PM_AdjustAngleForWallRun, PM_AdjustAngleForWallJump, PM_CrashLand) and used as a movement
// profile for the ground and the air. Swimming and noclip keep their own code. Quake units (one
// inch) become metres at the boundary; the numbers inside are the game's own.
//
// This file is derived from OpenJK, copyright (C) 1999-2000 Id Software, Inc., (C) 2000-2013
// Activision, (C) 2013 OpenJK contributors, and is used under the GNU General Public License
// version 2 (see LICENSES/OpenJK-GPL-2.0.txt).
import * as THREE from 'three';

/** Metres per Quake unit. */
export const UNIT = 0.0254;

export const JKA = {
  gravity: 800,
  /** Full run speed (cl_run); walking halves the command. */
  speed: 250,
  walkScale: 0.5,
  duckScale: 0.5,
  stopSpeed: 100,
  accelerate: 10,
  airAccelerate: 1,
  friction: 6,
  jumpVelocity: 225,
  /** Height reachable by holding jump, by Force Jump level (0 is a plain jump). */
  forceJumpHeight: [32, 96, 192, 384],
  /** The same with step and crouch slack, which bounds how high a wall rebound may start. */
  forceJumpHeightMax: [66, 130, 226, 418],
  forceJumpStrength: [225, 420, 590, 840],
  /** Force points a second while a force jump lifts, divided by the level. */
  forceJumpDrain: 30,
  /** What a wall run or flip off a wall costs. */
  wallMoveCost: 5,
  /** Speed away from a wall when jumping off it, and the lift (BG_ForceWallJumpStrength). */
  jumpOffWallSpeed: 200,
  wallJumpStrength: 840 / 2.5,
  /** A roll (crouch while moving): its speed, in units a second, and how long it carries you. */
  rollSpeed: 220,
  rollTime: 0.55,
  /** Damage per metre fallen beyond what your own jump could reach, and its cap. */
  fallDamagePerMetre: 8,
  fallDamageMax: 60,
};

export type Dir = 'F' | 'B' | 'L' | 'R';

/**
 * Probe for a wall from the body's middle along a horizontal direction, `dist` units past the
 * body's edge; answers the wall's normal, or null when nothing solid is there.
 */
export type WallProbe = (dir: THREE.Vector3, dist: number) => THREE.Vector3 | null;

export interface MoveCommand {
  /** Camera-relative forward and right, flattened to the ground. */
  forward: THREE.Vector3;
  right: THREE.Vector3;
  /** -1..1 along forward and right. */
  fmove: number;
  smove: number;
  walk: boolean;
  /** Ducking (PMF_DUCKED): half speed on the ground. */
  crouch: boolean;
  /** Crouch pressed this frame while moving: a roll in the movement direction. */
  roll: boolean;
  jump: boolean;
  /** Jump pressed this frame (the wall moves want a fresh press, not a held key). */
  jumpPressed: boolean;
  /** Attack held: back and jump then swings rather than backflips. */
  attack: boolean;
  speedScale: number;
  /** The world's walls, for the wall moves; without a probe there are none. */
  probe?: WallProbe;
  /** Distance to the ground below in units, up to `max`, or null when farther. */
  groundDistance?: (max: number) => number | null;
  /** Whether there is a floor to stand on `dist` units ahead, within a body height below the body's middle. */
  floorAhead?: (dist: number) => boolean;
}

export interface MoveEvents {
  jumped: boolean;
  forceJumpStarted: boolean;
  /** The force jump began while pushing a direction: the flip that way. */
  flip: Dir | null;
  /** A roll began: which way, relative to the command (forward, back, left, right). */
  rolled: Dir | null;
  /** Set on the frame the feet touch down: the client's landing "delta" (fall energy in its units). */
  landed: number | null;
  /** The landing ended a force jump (or fell far): the absorbing landing rather than the hop. */
  forceLanded: boolean;
  damage: number;
  /** A special jump began (a wall run, a flip off a wall, a backflip): its animation, held to its end. */
  special: string | null;
  /** The move wants the body to face this way (along a wall it runs on, into a wall it grabs). */
  heading: THREE.Vector3 | null;
}

/** Lengths of the special jump clips (seconds) when the rig cannot say. */
const CLIP_SECONDS: Record<string, number> = {
  BOTH_WALL_RUN_LEFT: 1.85,
  BOTH_WALL_RUN_RIGHT: 1.85,
  BOTH_WALL_RUN_LEFT_STOP: 0.8,
  BOTH_WALL_RUN_RIGHT_STOP: 0.8,
  BOTH_WALL_RUN_LEFT_FLIP: 0.7,
  BOTH_WALL_RUN_RIGHT_FLIP: 0.7,
  BOTH_WALL_FLIP_LEFT: 0.83,
  BOTH_WALL_FLIP_RIGHT: 0.83,
  BOTH_FLIP_BACK1: 0.75,
  BOTH_WALL_FLIP_BACK1: 1.35,
  BOTH_FORCEWALLRUNFLIP_START: 1.35,
  BOTH_FORCEWALLRUNFLIP_END: 0.95,
  BOTH_FORCEWALLRUNFLIP_ALT: 0.95,
  BOTH_FORCEWALLREBOUND_FORWARD: 0.6,
  BOTH_FORCEWALLREBOUND_BACK: 0.6,
  BOTH_FORCEWALLREBOUND_LEFT: 0.6,
  BOTH_FORCEWALLREBOUND_RIGHT: 0.6,
  BOTH_FORCEWALLRELEASE_FORWARD: 0.3,
  BOTH_FORCEWALLRELEASE_BACK: 0.3,
  BOTH_FORCEWALLRELEASE_LEFT: 0.3,
  BOTH_FORCEWALLRELEASE_RIGHT: 0.3,
};

const wish = new THREE.Vector3();
const wishDir = new THREE.Vector3();
const side = new THREE.Vector3();
const along = new THREE.Vector3();
const heading = new THREE.Vector3();

/** Ground and air movement state for one character. */
export class JkaMovement {
  /** Force Jump level 0..3; the player's force pool decides whether a force jump can continue. */
  forceLevel = 3;
  /** Answers a clip's length in seconds, so the special jumps know when they end. */
  clipDuration: (anim: string) => number | null = () => null;
  private jumpHeld = false;
  private forceJumping = false;
  private jumpStartY = Number.NaN;
  private apexY = Number.NaN;
  private wasGrounded = true;
  private lastVy = 0;
  /** Seconds left in a roll; the roll's direction, in units a second. */
  private rollLeft = 0;
  private rollDir: Dir | null = null;
  private readonly rollVel = new THREE.Vector3();
  /** The special jump in progress: its clip, how long it has run and has left. */
  private special: string | null = null;
  private specialLeft = 0;
  private specialElapsed = 0;
  /** Which side the wall being run on is, and the way pushed at a wall being held. */
  private wallSide: 'L' | 'R' | null = null;
  private readonly grabDir = new THREE.Vector3();
  private grabbing = false;

  /** Gravity in metres per second squared. */
  get gravity(): number {
    return JKA.gravity * UNIT;
  }

  reset(): void {
    this.rollLeft = 0;
    this.rollDir = null;
    this.jumpHeld = false;
    this.forceJumping = false;
    this.jumpStartY = Number.NaN;
    this.apexY = Number.NaN;
    this.wasGrounded = true;
    this.endSpecial();
  }

  get isForceJumping(): boolean {
    return this.forceJumping;
  }

  get rolling(): boolean {
    return this.rollLeft > 0;
  }

  /** The roll's direction and how long it has left, for the roll stab. */
  get roll(): { dir: Dir; left: number } | null {
    return this.rollLeft > 0 && this.rollDir ? { dir: this.rollDir, left: this.rollLeft } : null;
  }

  /** A wall run, flip or rebound in progress (BG_InSpecialJump). */
  get inSpecialJump(): boolean {
    return this.special !== null;
  }

  get specialJump(): string | null {
    return this.special;
  }

  /** Treat the current height as where a jump began, so landing back at it never hurts. */
  markJumpStart(y: number): void {
    this.jumpStartY = Number.isFinite(this.jumpStartY) ? Math.min(this.jumpStartY, y) : y;
    this.apexY = Number.isFinite(this.apexY) ? Math.max(this.apexY, y) : y;
    this.jumpHeld = true;
  }

  private startSpecial(anim: string, ev: MoveEvents): void {
    this.special = anim;
    this.specialLeft = this.clipDuration(anim) ?? CLIP_SECONDS[anim] ?? 1;
    this.specialElapsed = 0;
    ev.special = anim;
  }

  private endSpecial(): void {
    this.special = null;
    this.specialLeft = 0;
    this.specialElapsed = 0;
    this.wallSide = null;
    this.grabbing = false;
  }

  /**
   * One step. `vel` and `pos` are in metres; `grounded` is the character controller's verdict
   * from the previous step. `force` reports the pool and spends from it.
   */
  step(dt: number, vel: THREE.Vector3, pos: THREE.Vector3, grounded: boolean, cmd: MoveCommand, force: { value: number; spend: (n: number) => void }): MoveEvents {
    const ev: MoveEvents = { jumped: false, forceJumpStarted: false, flip: null, rolled: null, landed: null, forceLanded: false, damage: 0, special: null, heading: null };
    // Metres to units for the client's arithmetic.
    let vx = vel.x / UNIT;
    let vy = vel.y / UNIT;
    let vz = vel.z / UNIT;
    const level = Math.max(0, Math.min(3, this.forceLevel));

    if (this.special) {
      this.specialLeft -= dt;
      this.specialElapsed += dt;
      if (this.specialLeft <= 0) this.endSpecial();
    }
    if (grounded && !this.wasGrounded) {
      // PM_CrashLand: the landing speed squared, scaled, decides the animation and any damage.
      const landing = Math.min(0, this.lastVy);
      let delta = landing * landing * 0.0001;
      ev.landed = delta;
      const fell = Number.isFinite(this.apexY) ? (this.apexY - pos.y) / UNIT : 0;
      // Coming down from within your own jump's reach never hurts, as in the client's forceJumpZStart rule;
      // beyond that the damage grows with the extra height rather than with the square of the speed.
      const safe = JKA.forceJumpHeight[level] + JKA.forceJumpHeight[0];
      if (fell <= safe) delta = 0;
      else ev.damage = Math.min(JKA.fallDamageMax, Math.round(((fell - safe) * UNIT) * JKA.fallDamagePerMetre));
      ev.forceLanded = this.forceJumping || ev.damage > 0;
      this.forceJumping = false;
      this.jumpStartY = Number.NaN;
      this.apexY = Number.NaN;
      // A wall run or a flip ends on touching down (its stop and landing clips play out on the ground).
      if (this.special && !/_STOP$|RELEASE/.test(this.special)) this.endSpecial();
    }
    if (!grounded) this.apexY = Number.isFinite(this.apexY) ? Math.max(this.apexY, pos.y) : pos.y;

    const speed = JKA.speed * (cmd.walk ? JKA.walkScale : 1) * (cmd.crouch && grounded ? JKA.duckScale : 1) * cmd.speedScale;
    wish.set(0, 0, 0).addScaledVector(cmd.forward, cmd.fmove).addScaledVector(cmd.right, cmd.smove);
    wish.y = 0;
    // PM_CmdScale: a diagonal command is not faster than a straight one.
    const max = Math.max(Math.abs(cmd.fmove), Math.abs(cmd.smove));
    const total = Math.hypot(cmd.fmove, cmd.smove);
    const scale = max > 0 ? (speed * max) / total : 0;
    const wishSpeed = wish.length() * scale;
    if (wishSpeed > 0) wishDir.copy(wish).normalize();
    else wishDir.set(0, 0, 0);

    // A roll carries you along the command at its own speed, ignoring friction and new input.
    if (this.rollLeft > 0) {
      this.rollLeft -= dt;
      vx = this.rollVel.x;
      vz = this.rollVel.z;
      if (!grounded) vy -= JKA.gravity * dt;
      vel.set(vx * UNIT, vy * UNIT, vz * UNIT);
      this.lastVy = vy;
      this.wasGrounded = grounded;
      return ev;
    }
    // Touching down crouched while moving rolls out of the landing and absorbs some of it.
    const landingRoll = ev.landed !== null && ev.landed >= 2 && cmd.crouch && wishSpeed > 0;
    if (landingRoll) ev.damage = Math.round(ev.damage / 3);
    if (grounded && (cmd.roll || landingRoll) && wishSpeed > 0 && !this.special) {
      // PM_TryRoll: a roll the way you are moving.
      this.rollLeft = JKA.rollTime;
      this.rollVel.set(wishDir.x * JKA.rollSpeed, 0, wishDir.z * JKA.rollSpeed);
      this.rollDir = Math.abs(cmd.fmove) >= Math.abs(cmd.smove) ? (cmd.fmove >= 0 ? 'F' : 'B') : cmd.smove > 0 ? 'R' : 'L';
      ev.rolled = this.rollDir;
      vel.set(this.rollVel.x * UNIT, 0, this.rollVel.z * UNIT);
      this.lastVy = 0;
      this.wasGrounded = true;
      return ev;
    }

    // Holding a wall (a rebound): pressed into it until the grab's moment passes, then off it.
    if (this.grabbing && !grounded) {
      const normal = this.special && this.specialLeft > 0.1 && cmd.probe ? cmd.probe(this.grabDir, 128) : null;
      if (normal && Math.abs(normal.y) <= 0.2) {
        vx = -normal.x * 128;
        vy = 0;
        vz = -normal.z * 128;
        ev.heading = heading.copy(this.grabDir);
        vel.set(vx * UNIT, vy * UNIT, vz * UNIT);
        this.lastVy = vy;
        this.wasGrounded = grounded;
        return ev;
      }
      // Jump off: away from the wall, with the wall jump's lift.
      const release = (this.special ?? 'BOTH_FORCEWALLREBOUND_FORWARD').replace('REBOUND', 'RELEASE');
      this.endSpecial();
      vx = -this.grabDir.x * JKA.jumpOffWallSpeed;
      vz = -this.grabDir.z * JKA.jumpOffWallSpeed;
      vy = JKA.wallJumpStrength;
      this.jumpHeld = true;
      if (!(pos.y >= this.jumpStartY)) this.jumpStartY = pos.y;
      this.startSpecial(release, ev);
      vy -= JKA.gravity * dt;
      vel.set(vx * UNIT, vy * UNIT, vz * UNIT);
      this.lastVy = vy;
      this.wasGrounded = grounded;
      return ev;
    }

    // Running along a wall: carried along it while it lasts, facing along it; jump flips off.
    if (this.wallSide && !grounded && this.special && cmd.probe) {
      side.copy(cmd.right).multiplyScalar(this.wallSide === 'R' ? 1 : -1);
      const normal = this.specialLeft > 0.5 ? cmd.probe(side, 128) : null;
      if (normal && normal.y >= 0 && normal.y <= 0.4) {
        // Along the wall, the way the body faces.
        along.set(-normal.z, 0, normal.x);
        if (along.dot(cmd.forward) < 0) along.negate();
        const runSpeed = cmd.fmove > 0 ? 250 : cmd.fmove < 0 ? 100 : 175;
        vx = along.x * runSpeed - normal.x * 128;
        vz = along.z * runSpeed - normal.z * 128;
        ev.heading = heading.copy(along);
        if (cmd.jumpPressed && this.specialElapsed > 0.4 && this.specialLeft > 0.4 && cmd.probe(side, 16)) {
          // Flip off the wall.
          vx = vx * 0.5 - side.x * 150;
          vz = vz * 0.5 - side.z * 150;
          const flip = `${this.special}_FLIP`;
          this.wallSide = null;
          this.startSpecial(flip, ev);
          this.jumpHeld = true;
        }
        vy -= JKA.gravity * dt;
        vel.set(vx * UNIT, vy * UNIT, vz * UNIT);
        this.lastVy = vy;
        this.wasGrounded = grounded;
        return ev;
      }
      // The wall ended: stop running.
      const stop = `${this.special}_STOP`;
      this.wallSide = null;
      this.startSpecial(stop, ev);
    }

    if (grounded) {
      // PM_Friction on the ground plane.
      const s = Math.hypot(vx, vz);
      if (s < 1) {
        vx = 0;
        vz = 0;
      } else {
        // A slow pace (a walk matched to its clip) scales the stopping speed down with it, or the
        // friction meant for a run would hold the body far under the speed asked for.
        const stop = JKA.stopSpeed * Math.min(1, cmd.speedScale);
        const control = s < stop ? stop : s;
        const drop = control * JKA.friction * dt;
        const k = Math.max(0, s - drop) / s;
        vx *= k;
        vz *= k;
      }
      // PM_CheckJump: the special jumps from the ground (a fresh press of jump), else leaving the ground.
      if (cmd.jumpPressed && !this.special) {
        let anim: string | null = null;
        let lift = 0;
        if (cmd.smove !== 0 && level > 1 && cmd.probe) {
          side.copy(cmd.right).multiplyScalar(cmd.smove > 0 ? 1 : -1);
          const normal = cmd.probe(side, 16);
          if (normal && normal.y >= 0 && normal.y <= 0.4) {
            if (cmd.fmove > 0) {
              // Strafing and running beside a wall: run along it.
              anim = cmd.smove > 0 ? 'BOTH_WALL_RUN_RIGHT' : 'BOTH_WALL_RUN_LEFT';
              lift = JKA.forceJumpStrength[2] / 2;
              this.wallSide = cmd.smove > 0 ? 'R' : 'L';
            } else if (cmd.fmove === 0) {
              // Strafing into a wall: flip off it.
              anim = cmd.smove > 0 ? 'BOTH_WALL_FLIP_RIGHT' : 'BOTH_WALL_FLIP_LEFT';
              lift = JKA.forceJumpStrength[2] / 2.25;
              vx = -side.x * 150;
              vz = -side.z * 150;
            }
          }
        } else if (cmd.fmove < 0 && !cmd.attack && cmd.smove === 0 && level > 1) {
          // Back and jump: a backflip (a Force move, like the wall moves).
          anim = 'BOTH_FLIP_BACK1';
          lift = JKA.jumpVelocity;
          vx = -cmd.forward.x * 150;
          vz = -cmd.forward.z * 150;
        }
        if (anim) {
          vy = lift + 128;
          this.jumpHeld = true;
          this.jumpStartY = pos.y;
          this.apexY = pos.y;
          this.startSpecial(anim, ev);
          grounded = false;
          if (anim.includes('WALL')) force.spend(JKA.wallMoveCost);
        }
      }
      if (grounded && cmd.jump && !this.special) {
        vy = JKA.jumpVelocity;
        this.jumpHeld = true;
        this.jumpStartY = pos.y;
        this.apexY = pos.y;
        ev.jumped = true;
        grounded = false;
      }
    } else if (cmd.jumpPressed && cmd.probe && level > 1) {
      // PM_CheckJump in the air: off walls.
      const rising = Number.isFinite(this.jumpStartY) ? (pos.y - this.jumpStartY) / UNIT : 0;
      if (this.special === 'BOTH_FORCEWALLRUNFLIP_START') {
        // Running up a wall: jump flips back off it.
        if (this.specialElapsed > 0.4 && cmd.probe(cmd.forward, 16)) {
          vx = vx * 0.5 - cmd.forward.x * 300;
          vz = vz * 0.5 - cmd.forward.z * 300;
          vy += 200;
          this.startSpecial('BOTH_FORCEWALLRUNFLIP_END', ev);
        }
      } else if (cmd.fmove > 0 && !this.special && (cmd.groundDistance?.(80) ?? null) !== null) {
        // Jumping at a wall just off the ground: run up it and flip back (level 3 runs higher).
        const normal = cmd.probe(cmd.forward, 32);
        if (normal && -(normal.x * cmd.forward.x + normal.z * cmd.forward.z) > 0.7) {
          if (level > 2) {
            vx = 0;
            vz = 0;
            vy = JKA.forceJumpStrength[3] / 2;
            this.startSpecial('BOTH_FORCEWALLRUNFLIP_START', ev);
          } else {
            vx = -cmd.forward.x * 150;
            vz = -cmd.forward.z * 150;
            vy += 150;
            this.startSpecial('BOTH_WALL_FLIP_BACK1', ev);
          }
          this.jumpStartY = pos.y;
          this.apexY = pos.y;
          this.jumpHeld = true;
          force.spend(JKA.wallMoveCost);
        }
      } else if ((!this.special || this.special === 'BOTH_FLIP_BACK1') && vy > -1200 && (cmd.fmove || cmd.smove) && level > 2 && rising < JKA.forceJumpHeightMax[3] - JKA.wallJumpStrength / 2) {
        // Pushing at a wall in the air: grab it and rebound (PM_GrabWallForJump).
        let anim: string;
        if (cmd.smove) {
          this.grabDir.copy(cmd.right).multiplyScalar(cmd.smove > 0 ? 1 : -1);
          anim = cmd.smove > 0 ? 'BOTH_FORCEWALLREBOUND_RIGHT' : 'BOTH_FORCEWALLREBOUND_LEFT';
        } else {
          this.grabDir.copy(cmd.forward).multiplyScalar(cmd.fmove > 0 ? 1 : -1);
          anim = cmd.fmove > 0 ? 'BOTH_FORCEWALLREBOUND_FORWARD' : 'BOTH_FORCEWALLREBOUND_BACK';
        }
        const normal = cmd.probe(this.grabDir, 8);
        if (normal && Math.abs(normal.y) <= 0.2 && -(normal.x * this.grabDir.x + normal.z * this.grabDir.z) > 0.7 && vx * normal.x + vz * normal.z < 1) {
          this.startSpecial(anim, ev);
          this.grabbing = true;
          this.jumpHeld = true;
        }
      }
    }

    // Running up a wall and clearing its top: flip over onto whatever is up there (PM_AdjustAngleForWallRunUp).
    if (!grounded && this.special === 'BOTH_FORCEWALLRUNFLIP_START' && this.specialElapsed > 0.25 && cmd.probe && cmd.floorAhead && !cmd.probe(cmd.forward, 64) && cmd.floorAhead(48)) {
      vx = cmd.forward.x * 100;
      vz = cmd.forward.z * 100;
      vy += 400;
      this.jumpHeld = true;
      this.startSpecial('BOTH_FORCEWALLRUNFLIP_ALT', ev);
    }

    if (!grounded) {
      // Holding jump keeps lifting up to the Force Jump height, the METROID_JUMP way.
      if (this.jumpHeld && cmd.jump && Number.isFinite(this.jumpStartY) && level > 0 && !this.special) {
        const cur = (pos.y - this.jumpStartY) / UNIT;
        const h0 = JKA.forceJumpHeight[0];
        const hMax = JKA.forceJumpHeight[level];
        if ((cur <= h0 || force.value > 0) && cur < hMax) {
          if (cur > h0) {
            if (!this.forceJumping) {
              this.forceJumping = true;
              ev.forceJumpStarted = true;
              // Pushing a direction as the force jump begins: a flip that way.
              if (cmd.fmove > 0) ev.flip = 'F';
              else if (cmd.fmove < 0) ev.flip = 'B';
              else if (cmd.smove > 0) ev.flip = 'R';
              else if (cmd.smove < 0) ev.flip = 'L';
            }
            force.spend((JKA.forceJumpDrain / level) * dt);
          }
          vy = ((hMax - cur) / hMax) * JKA.forceJumpStrength[level];
          vy /= 10;
          vy += JKA.jumpVelocity;
        } else if (vy > JKA.jumpVelocity) vy = JKA.jumpVelocity;
      }
      if (!cmd.jump) this.jumpHeld = false;
      vy -= JKA.gravity * dt;
    } else if (!cmd.jump) this.jumpHeld = false;

    // PM_Accelerate: ground and air share the rule, the air just gets less of it.
    if (wishSpeed > 0) {
      const accel = grounded ? JKA.accelerate : JKA.airAccelerate;
      const current = vx * wishDir.x + vz * wishDir.z;
      const add = wishSpeed - current;
      if (add > 0) {
        const a = Math.min(accel * dt * wishSpeed, add);
        vx += a * wishDir.x;
        vz += a * wishDir.z;
      }
    }

    vel.set(vx * UNIT, vy * UNIT, vz * UNIT);
    this.lastVy = vy;
    this.wasGrounded = grounded;
    return ev;
  }
}
