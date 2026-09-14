// Blocking blaster bolts with a lightsaber, after OpenJK's codemp/game/w_saber.c (WP_SaberCanBlock,
// WP_SaberBlockNonRandom) and g_missile.c (G_ReflectMissile): a bolt that strikes a player whose
// saber is lit, held and facing it bounces off instead of hurting. Where it goes depends on the
// saber defence rank: at rank 3 it flies back where the player looks, at rank 2 it is turned
// around with some scatter, at rank 1 it scatters widely. The parry played is chosen by where
// the bolt struck relative to the eyes and the view: top, upper right or left, lower right or left.
//
// This file is derived from OpenJK, copyright (C) 1999-2000 Id Software, Inc., (C) 2000-2013
// Activision, (C) 2013 OpenJK contributors, and is used under the GNU General Public License
// version 2 (see LICENSES/OpenJK-GPL-2.0.txt).
import * as THREE from 'three';
import type { SaberStyle } from './saber';

const UNIT = 0.0254;

/** Where a bolt struck, as Jedi Academy's blocked positions. */
export type ParryZone = 'top' | 'upperRight' | 'upperLeft' | 'lowerRight' | 'lowerLeft';

const PARRY_SUFFIX: Record<ParryZone, string> = { top: 'T_', upperRight: 'TR', upperLeft: 'TL', lowerRight: 'BR', lowerLeft: 'BL' };

/** How much a bounced bolt scatters at each defence rank (the top rank aims it instead). */
export const DEFLECT_SCATTER = [0, 0.5, 0.2, 0.03];

/** Whether a point lies ahead of an origin looking along `forward` (InFront with a 0.2 threshold). */
export function inFront(point: THREE.Vector3, origin: THREE.Vector3, forward: THREE.Vector3, threshold = 0.2): boolean {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const dz = point.z - origin.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  return (dx * forward.x + dy * forward.y + dz * forward.z) / len > threshold;
}

/**
 * Whether the saber can block a bolt now: the block held, the saber lit and in hand, not
 * mid-flip or knocked about, and not in the middle of a swing unless the defence rank is the
 * top one, which blocks while attacking.
 */
export function canBlock(s: { blocking: boolean; saberOn: boolean; inHand: boolean; attacking: boolean; special: boolean; rank: number }): boolean {
  if (!s.blocking || !s.saberOn || !s.inHand || s.special) return false;
  if (s.attacking && s.rank < 3) return false;
  return s.rank >= 1;
}

/**
 * The parry for a strike at `hit`: above the eyes it is a top block unless well to one side,
 * a little below them an upper block to the nearer side, lower still a low block.
 * `eye` is the eye point, `forward` and `right` the view's directions on the ground plane.
 */
export function parryZone(hit: THREE.Vector3, eye: THREE.Vector3, right: THREE.Vector3): ParryZone {
  const dx = hit.x - eye.x;
  const dz = hit.z - eye.z;
  const len = Math.hypot(dx, dz);
  const rightDot = len < 1e-6 ? 0 : (dx * right.x + dz * right.z) / len;
  const zdiff = hit.y - eye.y;
  if (zdiff > -5 * UNIT) {
    if (rightDot > 0.3) return 'upperRight';
    if (rightDot < -0.3) return 'upperLeft';
    return 'top';
  }
  if (zdiff > -22 * UNIT) return rightDot >= 0 ? 'upperRight' : 'upperLeft';
  return rightDot >= 0 ? 'lowerRight' : 'lowerLeft';
}

/** The parry clip for a zone in a style: the dual and staff styles have their own set, the single styles share one. */
export function parryClip(style: SaberStyle, zone: ParryZone, has: (clip: string) => boolean): string | null {
  const n = style === 'dual' ? 6 : style === 'staff' ? 7 : 1;
  const own = `BOTH_P${n}_S${n}_${PARRY_SUFFIX[zone]}`;
  if (has(own)) return own;
  const single = `BOTH_P1_S1_${PARRY_SUFFIX[zone]}`;
  return n !== 1 && has(single) ? single : null;
}

/**
 * Where a blocked bolt goes. At rank 3 it flies where the player looks; below that it is turned
 * back the way it came and scattered, more at the lower rank. `random` gives -1..1.
 */
export function reflectDirection(rank: number, incoming: THREE.Vector3, look: THREE.Vector3, out: THREE.Vector3, random: () => number = () => Math.random() * 2 - 1): THREE.Vector3 {
  const scatter = DEFLECT_SCATTER[Math.max(1, Math.min(3, rank))];
  if (rank >= 3) out.copy(look);
  else out.copy(incoming).negate();
  out.x += random() * scatter;
  out.y += random() * scatter;
  out.z += random() * scatter;
  if (out.lengthSq() < 1e-8) out.copy(incoming).negate();
  return out.normalize();
}
