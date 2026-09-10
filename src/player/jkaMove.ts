// Jedi Academy's player movement, translated from OpenJK's codemp/game/bg_pmove.c
// (PM_Friction, PM_Accelerate, PM_WalkMove, PM_AirMove, PM_CheckJump with METROID_JUMP force
// jumping, PM_CrashLand) and used as a movement profile for the ground and the air. Swimming and
// noclip keep their own code. Quake units (one inch) become metres at the boundary; the numbers
// inside are the game's own.
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
  forceJumpStrength: [225, 420, 590, 840],
  /** Force points a second while a force jump lifts, divided by the level. */
  forceJumpDrain: 30,
};

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
  jump: boolean;
  speedScale: number;
}

export interface MoveEvents {
  jumped: boolean;
  forceJumpStarted: boolean;
  /** Set on the frame the feet touch down: the client's landing "delta" (fall energy in its units). */
  landed: number | null;
  damage: number;
}

const wish = new THREE.Vector3();
const wishDir = new THREE.Vector3();

/** Ground and air movement state for one character. */
export class JkaMovement {
  /** Force Jump level 0..3; the player's force pool decides whether a force jump can continue. */
  forceLevel = 3;
  private jumpHeld = false;
  private forceJumping = false;
  private jumpStartY = Number.NaN;
  private apexY = Number.NaN;
  private wasGrounded = true;
  private lastVy = 0;

  /** Gravity in metres per second squared. */
  get gravity(): number {
    return JKA.gravity * UNIT;
  }

  reset(): void {
    this.jumpHeld = false;
    this.forceJumping = false;
    this.jumpStartY = Number.NaN;
    this.apexY = Number.NaN;
    this.wasGrounded = true;
  }

  get isForceJumping(): boolean {
    return this.forceJumping;
  }

  /**
   * One step. `vel` and `pos` are in metres; `grounded` is the character controller's verdict
   * from the previous step. `force` reports the pool and spends from it.
   */
  step(dt: number, vel: THREE.Vector3, pos: THREE.Vector3, grounded: boolean, cmd: MoveCommand, force: { value: number; spend: (n: number) => void }): MoveEvents {
    const ev: MoveEvents = { jumped: false, forceJumpStarted: false, landed: null, damage: 0 };
    // Metres to units for the client's arithmetic.
    let vx = vel.x / UNIT;
    let vy = vel.y / UNIT;
    let vz = vel.z / UNIT;

    if (grounded && !this.wasGrounded) {
      // PM_CrashLand: the landing speed squared, scaled, decides the animation and any damage.
      const landing = Math.min(0, this.lastVy);
      let delta = landing * landing * 0.0001;
      ev.landed = delta;
      const level = Math.max(0, Math.min(3, this.forceLevel));
      const fell = Number.isFinite(this.apexY) ? (this.apexY - pos.y) / UNIT : 0;
      // Coming down from within your own jump's reach never hurts, as in the client's forceJumpZStart rule.
      if (fell <= JKA.forceJumpHeight[level] + JKA.forceJumpHeight[0]) delta = 0;
      if (delta > 7) ev.damage = Math.min(100, Math.round((delta - 7) * 2));
      this.forceJumping = false;
      this.jumpStartY = Number.NaN;
      this.apexY = Number.NaN;
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

    if (grounded) {
      // PM_Friction on the ground plane.
      const s = Math.hypot(vx, vz);
      if (s < 1) {
        vx = 0;
        vz = 0;
      } else {
        const control = s < JKA.stopSpeed ? JKA.stopSpeed : s;
        const drop = control * JKA.friction * dt;
        const k = Math.max(0, s - drop) / s;
        vx *= k;
        vz *= k;
      }
      // PM_CheckJump: leaving the ground.
      if (cmd.jump) {
        vy = JKA.jumpVelocity;
        this.jumpHeld = true;
        this.jumpStartY = pos.y;
        this.apexY = pos.y;
        ev.jumped = true;
        grounded = false;
      }
    }

    if (!grounded) {
      // Holding jump keeps lifting up to the Force Jump height, the METROID_JUMP way.
      const level = Math.max(0, Math.min(3, this.forceLevel));
      if (this.jumpHeld && cmd.jump && Number.isFinite(this.jumpStartY) && level > 0) {
        const cur = (pos.y - this.jumpStartY) / UNIT;
        const h0 = JKA.forceJumpHeight[0];
        const hMax = JKA.forceJumpHeight[level];
        if ((cur <= h0 || force.value > 0) && cur < hMax) {
          if (cur > h0) {
            if (!this.forceJumping) {
              this.forceJumping = true;
              ev.forceJumpStarted = true;
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
