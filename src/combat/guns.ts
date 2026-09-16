// What each blaster fires like, after Jedi Academy's weapon types (bg_weapons.c, g_weapon.c,
// weapons.dat): the Bryar pistol that charges, the E-11 with its accurate and its rapid trigger,
// the disruptor that hits at once and charges for a heavier shot, the bowcaster that fans out
// several bolts when charged, the repeater's stream, the DEMP2's ion bolt, the flechette's spread
// of shards, the rocket and the concussion rifle with their blasts. The game's guns are sorted into
// these by their names and classes, so each kind on the rack handles its own way.
//
// This file is derived from OpenJK, copyright (C) 1999-2000 Id Software, Inc., (C) 2000-2013
// Activision, (C) 2013 OpenJK contributors, and is used under the GNU General Public License
// version 2 (see LICENSES/OpenJK-GPL-2.0.txt).
import type { WeaponClass } from '../player/weapons';

export type GunType = 'bryar' | 'blaster' | 'blasterRapid' | 'disruptor' | 'bowcaster' | 'repeater' | 'demp2' | 'flechette' | 'rocket' | 'concussion';

export interface GunProfile {
  type: GunType;
  label: string;
  /** A line for the help and the rack. */
  blurb: string;
  damage: number;
  /** Bolt speed in units a second (1 unit is 2.54 cm); ignored by a hitscan gun. */
  speed: number;
  /** Seconds between shots. */
  fireTime: number;
  /** Scatter in degrees each way from the hip, and aimed. */
  spread: number;
  aimSpread: number;
  /** The shot lands the instant it is fired, along a beam. */
  hitscan?: boolean;
  /** Holding the trigger charges the shot: over `time` seconds the damage climbs to `maxDamage`, and a bowcaster fans out up to `bolts`. */
  charge?: { time: number; maxDamage: number; bolts?: number };
  /** Several bolts a shot, each scattered by `pelletSpread` degrees. */
  pellets?: number;
  pelletSpread?: number;
  /** A blast where the bolt lands: everything within `radius` metres takes up to `damage`. */
  splash?: { radius: number; damage: number };
  color: number;
  /** The bolt's size over the E-11's. */
  size: number;
  /** The shove on what it hits, as the creatures' knock scale. */
  push: number;
}

const p = (g: GunProfile): GunProfile => g;

export const GUNS: Record<GunType, GunProfile> = {
  bryar: p({ type: 'bryar', label: 'Bryar-type pistol', blurb: 'hold the trigger to charge, up to five times the damage', damage: 10, speed: 1600, fireTime: 0.4, spread: 0.6, aimSpread: 0.2, charge: { time: 1.0, maxDamage: 50 }, color: 0xffb040, size: 1, push: 2 }),
  blaster: p({ type: 'blaster', label: 'E-11-type rifle', blurb: 'a true shot every third of a second', damage: 20, speed: 2300, fireTime: 0.35, spread: 1.0, aimSpread: 0.3, color: 0xff3a2a, size: 1, push: 2.5 }),
  blasterRapid: p({ type: 'blasterRapid', label: 'E-11-type carbine', blurb: 'the rapid trigger: quick bolts that scatter', damage: 20, speed: 2300, fireTime: 0.15, spread: 2.4, aimSpread: 0.9, color: 0xff3a2a, size: 0.9, push: 2.5 }),
  disruptor: p({ type: 'disruptor', label: 'Disruptor-type sniper', blurb: 'hits the instant it fires; hold to charge a shot that hits four times as hard', damage: 30, speed: 0, fireTime: 0.6, spread: 0.3, aimSpread: 0, hitscan: true, charge: { time: 1.2, maxDamage: 125 }, color: 0xff6030, size: 1, push: 4 }),
  bowcaster: p({ type: 'bowcaster', label: 'Bowcaster', blurb: 'slow, heavy bolts; hold to charge and it fans out up to five', damage: 50, speed: 1300, fireTime: 1.0, spread: 0.6, aimSpread: 0.2, charge: { time: 1.0, maxDamage: 50, bolts: 5 }, pelletSpread: 5, color: 0x40ff60, size: 1.3, push: 5 }),
  repeater: p({ type: 'repeater', label: 'Repeater', blurb: 'a stream of light bolts', damage: 14, speed: 1600, fireTime: 0.1, spread: 1.4, aimSpread: 0.8, color: 0x60a0ff, size: 0.8, push: 1.5 }),
  demp2: p({ type: 'demp2', label: 'Ion (DEMP2-type)', blurb: 'a heavy ion bolt', damage: 35, speed: 1800, fireTime: 0.4, spread: 0.5, aimSpread: 0.2, color: 0xa070ff, size: 1.2, push: 3 }),
  flechette: p({ type: 'flechette', label: 'Flechette', blurb: 'five fast shards a shot, spread wide', damage: 12, speed: 3500, fireTime: 0.7, spread: 0, aimSpread: 0, pellets: 5, pelletSpread: 8, color: 0xffe070, size: 0.6, push: 2 }),
  rocket: p({ type: 'rocket', label: 'Rocket launcher', blurb: 'a slow rocket that blasts everything near where it lands', damage: 100, speed: 900, fireTime: 0.9, spread: 0, aimSpread: 0, splash: { radius: 4, damage: 100 }, color: 0xff9040, size: 2, push: 8 }),
  concussion: p({ type: 'concussion', label: 'Concussion rifle', blurb: 'a fast heavy bolt with a small blast', damage: 75, speed: 3000, fireTime: 0.8, spread: 0.2, aimSpread: 0, splash: { radius: 2.5, damage: 40 }, color: 0x70e0ff, size: 1.6, push: 7 }),
};

/** Which type a gun on the rack is, by its name first, then by its class. */
export function gunTypeFor(id: string | null, cls: WeaponClass | 'pistol' | 'carbine' | 'rifle' | 'heavy'): GunType {
  const s = (id ?? '').toLowerCase();
  if (/bowcaster/.test(s)) return 'bowcaster';
  if (/flechette|scatter|shotgun|spray|fwg5|shot_gun/.test(s)) return 'flechette';
  if (/disruptor|sniper|laser|dlt20|dxr6|sg82|tangle|beam_rifle|dc15s|charric/.test(s)) return 'disruptor';
  if (/ion|demp|stun|electric|lightning|shock/.test(s)) return 'demp2';
  if (/launcher|rocket|missile|cannon|cr1|mortar|flame/.test(s)) return 'rocket';
  if (/concussion|pulse|carbonite|particle_beam/.test(s)) return 'concussion';
  if (/repeater|acid_beam|lightning_beam|heavy_/.test(s)) return 'repeater';
  switch (cls) {
    case 'pistol':
      return 'bryar';
    case 'carbine':
      return 'blasterRapid';
    case 'heavy':
      return 'repeater';
    default:
      return 'blaster';
  }
}
