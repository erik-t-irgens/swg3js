// The thrown lightsaber, after OpenJK's codemp/game/w_saber.c (saberFirstThrown,
// saberBackToOwner, thrownSaberTouch): the saber leaves the hand at 400 units a second along the
// aim, is steered towards where the owner looks at 500 (every 0.4 s, or 0.1 s at the top throw
// rank), and comes back when the alternate attack is released half a second after the throw,
// after six seconds, past the rank's reach (700 units a rank), or on striking a wall. On the
// way back it flies at 700 (900 at the top rank), slowing as it nears the hand. It hurts what
// it passes: 30 on the way out, 5 on the way back.
//
// This file is derived from OpenJK, copyright (C) 1999-2000 Id Software, Inc., (C) 2000-2013
// Activision, (C) 2013 OpenJK contributors, and is used under the GNU General Public License
// version 2 (see LICENSES/OpenJK-GPL-2.0.txt).
import * as THREE from 'three';
import { sabers } from '../audio/saberSounds.ts';

const UNIT = 0.0254;
export const THROW = {
  /** Force it costs to throw. */
  cost: 20,
  outSpeed: 400,
  steerSpeed: 500,
  maxDistancePerRank: 700,
  hitDamage: 30,
  returnHitDamage: 5,
  /** Turns a second in flight (apos trDelta 800 degrees a second). */
  spin: (800 * Math.PI) / 180,
};

const tmp = new THREE.Vector3();
const toHand = new THREE.Vector3();

/** A thrown saber's flight. Positions are in metres. */
export class SaberThrow {
  /** Rank of the throw (1..3): reach, steering and the return speed. */
  rank = 3;
  inFlight = false;
  returning = false;
  readonly pos = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly origin = new THREE.Vector3();
  private elapsed = 0;
  private steerIn = 0;
  /** Turns while flying, in radians. */
  spin = 0;
  /** Counts up on each throw and again on the return, so a hit test may hurt each thing once a leg. */
  legId = 0;

  /** Start a throw from `from` along `dir` (unit length). */
  throw(from: THREE.Vector3, dir: THREE.Vector3): void {
    this.inFlight = true;
    this.returning = false;
    this.pos.copy(from);
    this.origin.copy(from);
    this.vel.copy(dir).multiplyScalar(THROW.outSpeed * UNIT);
    this.elapsed = 0;
    this.steerIn = this.rank >= 3 ? 0.1 : 0.4;
    this.legId++;
  }

  /** The way it flies, for laying the blade along its path. */
  direction(out: THREE.Vector3): THREE.Vector3 {
    return out.copy(this.vel).normalize();
  }

  /**
   * Advance the flight. `hand` is where it returns to; `aimFrom` and `aimDir` are the owner's
   * eye and look direction; `hitWall(from, to)` answers whether solid ground blocks a step.
   * Returns 'caught' on the frame it reaches the hand.
   */
  update(dt: number, hand: THREE.Vector3, aimFrom: THREE.Vector3, aimDir: THREE.Vector3, altHeld: boolean, hitWall: (from: THREE.Vector3, to: THREE.Vector3) => boolean): 'caught' | null {
    if (!this.inFlight) return null;
    this.elapsed += dt;
    this.spin += THROW.spin * dt;
    toHand.copy(hand).sub(this.pos);
    const ownerDist = toHand.length();
    if (!this.returning) {
      const reach = THROW.maxDistancePerRank * this.rank * UNIT;
      const release = this.elapsed > 0.5 && !altHeld;
      if (release || this.elapsed > 6 || this.pos.distanceTo(this.origin) >= reach) this.startReturn();
      else {
        // Steered towards the look point at rank 2 and up.
        this.steerIn -= dt;
        if (this.rank >= 2 && this.steerIn <= 0) {
          this.steerIn = this.rank >= 3 ? 0.1 : 0.4;
          tmp.copy(aimFrom).addScaledVector(aimDir, 4096 * UNIT).sub(this.pos).normalize();
          this.vel.copy(tmp).multiplyScalar(THROW.steerSpeed * UNIT);
        }
        tmp.copy(this.pos).addScaledVector(this.vel, dt);
        if (hitWall(this.pos, tmp)) {
          // It struck something solid and turns for home: the blade bounced off it.
          sabers.contact('bounce', this.pos);
          this.startReturn();
        } else this.pos.copy(tmp);
        return null;
      }
      toHand.copy(hand).sub(this.pos);
    }
    // Homing back, slower over the last few metres so it settles into the hand.
    const base = this.rank >= 3 ? 900 : 700;
    const speed = (ownerDist < 64 * UNIT ? base - 200 : ownerDist < 128 * UNIT ? base - 150 : ownerDist < 256 * UNIT ? base - 100 : base) * UNIT;
    const step = speed * dt;
    if (ownerDist <= Math.max(step, 0.3)) {
      this.inFlight = false;
      this.returning = false;
      this.pos.copy(hand);
      sabers.contact('catch', hand);
      return 'caught';
    }
    this.vel.copy(toHand).normalize().multiplyScalar(speed);
    this.pos.addScaledVector(this.vel, dt);
    return null;
  }

  private startReturn(): void {
    this.returning = true;
    this.legId++;
  }

  /** Take it back at once (the owner put it away or died). */
  cancel(): void {
    this.inFlight = false;
    this.returning = false;
  }
}
