// What each blaster fires like: Jedi Academy's weapon types (bg_weapons.c, g_weapon.c,
// weapons.dat) with both their triggers, and kinds of the game's own the client's weapon table
// makes plain (a flame thrower, a lightning rifle, slugthrowers, sonic guns, acid, a crossbow,
// carbonite), built the way Jedi Academy builds a gun: a thing in flight with a speed, a drop or
// a bounce, a blast, a burn. The game's guns are sorted into these by the client effect their
// template names first (the family and index into datatables/weapon/weapon.iff), their name
// second, their class last.
//
// This file is derived from OpenJK, copyright (C) 1999-2000 Id Software, Inc., (C) 2000-2013
// Activision, (C) 2013 OpenJK contributors, and is used under the GNU General Public License
// version 2 (see LICENSES/OpenJK-GPL-2.0.txt).
import type { WeaponClass, WeaponDef } from '../player/weapons';

export type GunType = 'bryar' | 'blaster' | 'blasterRapid' | 'disruptor' | 'bowcaster' | 'repeater' | 'demp2' | 'flechette' | 'rocket' | 'concussion' | 'flamethrower' | 'lightning' | 'slug' | 'sonic' | 'acid' | 'crossbow' | 'carbonite';

/**
 * A metre per engine unit: every speed in this file is in Jedi Academy's units a second, and this is
 * the one number that turns one into the other. It lives here because this is where those units are
 * written down, and `bolts.ts` and the readout below both read it from here rather than keeping a
 * copy: a speed the readout printed from a second copy of this would be a speed no bolt ever flies
 * at, which is the drift this project has been bitten by before.
 */
export const ENGINE_UNIT = 0.0254;

export interface GunSpeedTune {
  /**
   * Every ground gun's bolt speed, over the speed its own weapon data gives it. **1 is the game
   * exactly as it was**, and is the switch: `__debug.guns({ speed: 1 })`.
   *
   * It is one multiplier and not seventeen edited numbers on purpose. What makes these guns feel
   * like the ones they were ported from is their speeds *relative to one another* -- a slugthrower
   * is three times a rifle and a rocket is half of one -- and a multiplier is the only change that
   * keeps every one of those ratios while moving the lot. A gun whose speed is 0 is a hitscan beam
   * or a cone and is untouched, since a multiplier on nothing is nothing.
   */
  ground: number;
  /**
   * How much of that multiplier the *drawn* bolt takes in length. At 2.5x a rifle bolt crosses
   * about two and a half metres in a frame, and a dash a third of a metre long read as a dotted
   * line rather than as a streak; stretching it is what makes a fast bolt look fast. 1 takes the
   * whole multiplier, 0 leaves every bolt the length it always was.
   */
  stretchShare: number;
  /** The most a bolt may be stretched to, whatever the multiplier, so nothing becomes a lance. */
  maxStretch: number;
}

/**
 * How much faster the ground guns fire than their own weapon data says, and how much longer their
 * bolts are drawn for it. **Ours, both of them, and the one number in the game that overrides a
 * speed the data gave.** It applies to the ground guns alone: a ship's bolt is 600 m/s over 512 m
 * out of the client's own `datatables/space/ship_weapon_components.iff`, which is the game's own
 * number and is not this project's to overwrite -- which is why the multiplier lives where a gun's
 * units-a-second become metres a second (`Bolts.fire`) and never on the ship path, which hands its
 * speed in as metres a second already made.
 *
 * Live through `__debug.guns({ speed: 1 })`.
 */
export const GUN_SPEED: GunSpeedTune = {
  ground: 2.5,
  stretchShare: 1,
  maxStretch: 4,
};

/**
 * A ground gun's muzzle speed in metres a second: its own units-a-second, the engine unit, and the
 * multiplier. The one place `guns.ts`'s numbers become a speed, so everything downstream -- the
 * bolt's own flight, the length its ray leads by, a blade's deflection, an aim -- reads the bolt's
 * live speed and follows with nothing else to change.
 */
export function groundBoltSpeed(unitsPerSecond: number, unit: number, tune: GunSpeedTune = GUN_SPEED): number {
  if (!Number.isFinite(unitsPerSecond) || unitsPerSecond <= 0) return 0;
  const m = Number.isFinite(tune.ground) && tune.ground > 0 ? tune.ground : 1;
  return unitsPerSecond * unit * m;
}

/**
 * How much longer a ground gun's bolt is drawn than it used to be. Exactly 1 at a multiplier of 1,
 * so the switch that puts the old speed back puts the old picture back with it.
 */
export function boltStretch(tune: GunSpeedTune = GUN_SPEED): number {
  const m = Number.isFinite(tune.ground) && tune.ground > 0 ? tune.ground : 1;
  const share = Number.isFinite(tune.stretchShare) && tune.stretchShare > 0 ? tune.stretchShare : 0;
  const s = 1 + (m - 1) * share;
  if (!(s > 1)) return 1;
  return s > tune.maxStretch ? tune.maxStretch : s;
}

/** The floors that keep the rules finite: a zero multiplier is a bolt that never leaves the muzzle. */
const SPEED_FLOOR: Record<keyof GunSpeedTune, number> = { ground: 0.05, stretchShare: 0, maxStretch: 1 };

/**
 * Move the guns' speed live. `speed` is the same number as `ground` and is the name the switch is
 * spelled with, since `__debug.guns({ speed: 1 })` is the one line the owner types to see the game
 * as it was; both are accepted and both mean the multiplier.
 */
export function tuneGunSpeed(opts?: (Partial<GunSpeedTune> & { speed?: number }) | null): GunSpeedTune {
  if (!opts) return GUN_SPEED;
  if (typeof opts.speed === 'number' && Number.isFinite(opts.speed)) GUN_SPEED.ground = Math.max(SPEED_FLOOR.ground, opts.speed);
  for (const key of Object.keys(GUN_SPEED) as (keyof GunSpeedTune)[]) {
    const v = opts[key];
    if (typeof v === 'number' && Number.isFinite(v)) GUN_SPEED[key] = Math.max(SPEED_FLOOR[key], v);
  }
  return GUN_SPEED;
}

/**
 * The readout: the multiplier in force, what a bolt is stretched to, and what every gun's two
 * triggers now fire at in metres a second beside what they fired at before. Passing `speed` (or any
 * of the tuning's numbers) moves it first. Console only, so it may allocate.
 */
export function gunSpeedReport(opts?: (Partial<GunSpeedTune> & { speed?: number }) | null): {
  tune: GunSpeedTune;
  stretch: number;
  guns: { gun: GunType; trigger: string; was: number; now: number }[];
} {
  if (opts) tuneGunSpeed(opts);
  // The engine unit the bolts themselves fly by (`ENGINE_UNIT`), not a copy of it: the two columns
  // below are the speeds a gun really left the muzzle at before and leaves at now, and a second
  // copy of this number would let the readout say something no bolt ever did.
  const unit = ENGINE_UNIT;
  const rows: { gun: GunType; trigger: string; was: number; now: number }[] = [];
  for (const g of Object.values(GUNS)) {
    for (const [trigger, mode] of [['primary', g.primary] as const, ['alt', g.alt] as const]) {
      if (!mode || mode.speed <= 0) continue;
      rows.push({ gun: g.type, trigger, was: Number((mode.speed * unit).toFixed(2)), now: Number(groundBoltSpeed(mode.speed, unit).toFixed(2)) });
    }
  }
  rows.sort((a, b) => a.now - b.now);
  return { tune: { ...GUN_SPEED }, stretch: Number(boltStretch().toFixed(3)), guns: rows };
}

/**
 * How a trigger fires. `shot` fires bolts at the rate while held; `charge` builds while held and
 * fires on release; `stream` is a cone of harm (a flame) while held; `beam` a hitscan line held on
 * what is ahead; `mines` throws bouncing charges; `blast` a burst around the shooter.
 */
export interface FireMode {
  kind: 'shot' | 'charge' | 'stream' | 'beam' | 'mines' | 'blast';
  /** Per shot, or per second for a stream or beam. */
  damage: number;
  /** Bolt speed in units a second (1 unit is 2.54 cm); 0 is a hitscan shot. */
  speed: number;
  /** Seconds between shots. */
  fireTime: number;
  /** Scatter in degrees each way from the hip, and aimed. */
  spread: number;
  aimSpread: number;
  /** Several bolts a shot, each scattered by `pelletSpread` degrees; `fan` spreads them evenly instead. */
  pellets?: number;
  pelletSpread?: number;
  fan?: boolean;
  /** A charge: over `time` seconds the damage climbs to `maxDamage`; `bolts` fans out that many at full charge. */
  charge?: { time: number; maxDamage: number; bolts?: number };
  /** A blast where it lands (or, for `blast`, around the shooter): everything within `radius` metres takes up to `damage`. */
  splash?: { radius: number; damage: number };
  /** The bolt falls (metres a second squared), bounces off walls this many times, or turns toward what was under the crosshair. */
  gravity?: number;
  bounces?: number;
  homing?: boolean;
  /** What it does to a creature it hits over time, or at once. */
  dot?: { dps: number; seconds: number };
  stun?: number;
  slow?: number;
  /** A beam that jumps to another creature within `radius`, at `share` of the damage. */
  chain?: { radius: number; share: number };
  /** A stream's or spray's reach and half-angle (degrees). */
  cone?: { range: number; angle: number };
  /** Mines: how many a throw, and their fuse. */
  mines?: { count: number; fuse: number };
  /** A shove on vehicles too (ion). */
  ion?: boolean;
  /** The shove on what it hits, as the creatures' knock scale. */
  push: number;
  /** The bolt's size over the E-11's. */
  size: number;
  color: number;
  /** The manifest's extra effect drawn at the muzzle while a stream or beam is held. */
  effect?: 'flame' | 'lightning' | 'acid' | 'ice';
  /** Whether the client's own shot effect is used for the bolt when the pack has it. */
  ownShot?: boolean;
}

export interface GunProfile {
  type: GunType;
  label: string;
  /** What the two triggers do, in words. */
  blurb: string;
  altBlurb: string;
  primary: FireMode;
  alt: FireMode | null;
}

const shot = (m: Partial<FireMode> & { damage: number; speed: number; fireTime: number }): FireMode => ({ kind: 'shot', spread: 0.5, aimSpread: 0.2, push: 2.5, size: 1, color: 0xff3a2a, ownShot: true, ...m });

export const GUNS: Record<GunType, GunProfile> = {
  bryar: {
    type: 'bryar',
    label: 'Blaster pistol',
    blurb: 'a bolt a shot',
    altBlurb: 'hold to charge, up to five times the damage on release',
    primary: shot({ damage: 10, speed: 1600, fireTime: 0.4, spread: 0.6, aimSpread: 0.2, color: 0xffb040, push: 2 }),
    alt: { ...shot({ damage: 10, speed: 1600, fireTime: 0.5, spread: 0.6, aimSpread: 0.2, color: 0xffb040, push: 3 }), kind: 'charge', charge: { time: 1.0, maxDamage: 50 } },
  },
  blaster: {
    type: 'blaster',
    label: 'Blaster rifle',
    blurb: 'a true bolt every third of a second',
    altBlurb: 'the rapid trigger: quick bolts that scatter',
    primary: shot({ damage: 20, speed: 2300, fireTime: 0.35, spread: 1.0, aimSpread: 0.3 }),
    alt: shot({ damage: 20, speed: 2300, fireTime: 0.15, spread: 2.4, aimSpread: 0.9, size: 0.9 }),
  },
  blasterRapid: {
    type: 'blasterRapid',
    label: 'Blaster carbine',
    blurb: 'quick bolts that scatter',
    altBlurb: 'a true bolt every third of a second',
    primary: shot({ damage: 20, speed: 2300, fireTime: 0.15, spread: 2.4, aimSpread: 0.9, size: 0.9 }),
    alt: shot({ damage: 20, speed: 2300, fireTime: 0.35, spread: 0.5, aimSpread: 0.2 }),
  },
  disruptor: {
    type: 'disruptor',
    label: 'Disruptor',
    blurb: 'hits the instant it fires, along a beam',
    altBlurb: 'hold to charge a shot that hits four times as hard',
    primary: shot({ damage: 30, speed: 0, fireTime: 0.6, spread: 0.3, aimSpread: 0, color: 0xff6030, push: 4 }),
    alt: { ...shot({ damage: 30, speed: 0, fireTime: 0.8, spread: 0.2, aimSpread: 0, color: 0xff6030, push: 6 }), kind: 'charge', charge: { time: 1.2, maxDamage: 125 } },
  },
  bowcaster: {
    type: 'bowcaster',
    label: 'Bowcaster',
    blurb: 'hold to charge: it fans out up to five heavy bolts',
    altBlurb: 'one bolt that bounces off walls',
    primary: { ...shot({ damage: 50, speed: 1300, fireTime: 1.0, spread: 0.6, aimSpread: 0.2, color: 0x40ff60, size: 1.3, push: 5 }), kind: 'charge', charge: { time: 1.0, maxDamage: 50, bolts: 5 }, pelletSpread: 5, fan: true },
    alt: shot({ damage: 50, speed: 1300, fireTime: 1.0, spread: 0.3, aimSpread: 0.1, color: 0x40ff60, size: 1.3, push: 5, bounces: 3 }),
  },
  repeater: {
    type: 'repeater',
    label: 'Repeater',
    blurb: 'a stream of light bolts',
    altBlurb: 'a slow concussive ball that blasts where it lands',
    primary: shot({ damage: 14, speed: 1600, fireTime: 0.1, spread: 1.4, aimSpread: 0.8, color: 0x60a0ff, size: 0.8, push: 1.5 }),
    alt: shot({ damage: 60, speed: 1100, fireTime: 0.8, spread: 0.3, aimSpread: 0.1, color: 0x9fd0ff, size: 1.8, push: 6, splash: { radius: 1.5, damage: 60 }, ownShot: false }),
  },
  demp2: {
    type: 'demp2',
    label: 'Ion',
    blurb: 'a heavy ion bolt that stuns, and throws vehicles',
    altBlurb: 'hold to charge an ion blast that stuns everything near where it lands',
    primary: shot({ damage: 35, speed: 1800, fireTime: 0.4, spread: 0.5, aimSpread: 0.2, color: 0xa070ff, size: 1.2, push: 3, stun: 1, ion: true }),
    alt: { ...shot({ damage: 30, speed: 1400, fireTime: 1.0, spread: 0.3, aimSpread: 0.1, color: 0xc0a0ff, size: 1.6, push: 4, splash: { radius: 4, damage: 40 }, stun: 2, ion: true, ownShot: false }), kind: 'charge', charge: { time: 1.0, maxDamage: 60 } },
  },
  flechette: {
    type: 'flechette',
    label: 'Flechette',
    blurb: 'five fast shards a shot, spread wide',
    altBlurb: 'two bouncing mines that go off after a moment',
    primary: shot({ damage: 12, speed: 3500, fireTime: 0.7, spread: 0, aimSpread: 0, pellets: 5, pelletSpread: 8, color: 0xffe070, size: 0.6, push: 2 }),
    alt: { ...shot({ damage: 60, speed: 900, fireTime: 1.2, spread: 0, aimSpread: 0, color: 0xffe070, size: 1, push: 6, splash: { radius: 3, damage: 60 } }), kind: 'mines', mines: { count: 2, fuse: 2.5 } },
  },
  rocket: {
    type: 'rocket',
    label: 'Rocket launcher',
    blurb: 'a slow rocket that blasts everything near where it lands',
    altBlurb: 'a rocket that follows what was under the crosshair',
    primary: shot({ damage: 100, speed: 900, fireTime: 0.9, spread: 0, aimSpread: 0, color: 0xff9040, size: 2, push: 8, splash: { radius: 4, damage: 100 } }),
    alt: shot({ damage: 100, speed: 900, fireTime: 1.2, spread: 0, aimSpread: 0, color: 0xff9040, size: 2, push: 8, splash: { radius: 4, damage: 100 }, homing: true }),
  },
  concussion: {
    type: 'concussion',
    label: 'Concussion rifle',
    blurb: 'a fast heavy bolt with a small blast',
    altBlurb: 'an instant beam that throws whatever it hits',
    primary: shot({ damage: 75, speed: 3000, fireTime: 0.8, spread: 0.2, aimSpread: 0, color: 0x70e0ff, size: 1.6, push: 7, splash: { radius: 2.5, damage: 40 } }),
    alt: shot({ damage: 15, speed: 0, fireTime: 0.6, spread: 0.2, aimSpread: 0, color: 0x70e0ff, size: 1, push: 16 }),
  },
  flamethrower: {
    type: 'flamethrower',
    label: 'Flame thrower',
    blurb: 'a cone of flame while the trigger is held; what it touches burns on',
    altBlurb: 'a fireball that bursts where it lands and sets it alight',
    primary: { kind: 'stream', damage: 25, speed: 0, fireTime: 0, spread: 0, aimSpread: 0, cone: { range: 6, angle: 22 }, dot: { dps: 8, seconds: 3 }, push: 1, size: 1, color: 0xff7020, effect: 'flame' },
    alt: shot({ damage: 40, speed: 900, fireTime: 0.9, spread: 0, aimSpread: 0, color: 0xff7020, size: 1.6, push: 5, splash: { radius: 2, damage: 30 }, dot: { dps: 8, seconds: 3 }, gravity: 4 }),
  },
  lightning: {
    type: 'lightning',
    label: 'Lightning rifle',
    blurb: 'a bolt of lightning held on what is ahead, jumping to what stands near it',
    altBlurb: 'hold to charge a ball of lightning that shocks everything near where it lands',
    primary: { kind: 'beam', damage: 15, speed: 0, fireTime: 0, spread: 0, aimSpread: 0, cone: { range: 25, angle: 8 }, chain: { radius: 5, share: 0.6 }, stun: 0.4, push: 1, size: 1, color: 0x9fd4ff, effect: 'lightning' },
    alt: { ...shot({ damage: 30, speed: 900, fireTime: 1.0, spread: 0.3, aimSpread: 0.1, color: 0x9fd4ff, size: 1.8, push: 4, splash: { radius: 4, damage: 30 }, stun: 1, ownShot: false }), kind: 'charge', charge: { time: 1.0, maxDamage: 70 } },
  },
  slug: {
    type: 'slug',
    label: 'Slugthrower',
    blurb: 'a fast slug that drops a little over distance and hits hard',
    altBlurb: 'the same, twice as fast and less true',
    primary: shot({ damage: 28, speed: 7500, fireTime: 0.45, spread: 0.4, aimSpread: 0.1, color: 0xffd0a0, size: 0.6, push: 5, gravity: 3 }),
    alt: shot({ damage: 28, speed: 7500, fireTime: 0.2, spread: 1.6, aimSpread: 0.6, color: 0xffd0a0, size: 0.6, push: 5, gravity: 3 }),
  },
  sonic: {
    type: 'sonic',
    label: 'Sonic',
    blurb: 'a slow wide wave that staggers and shoves what it hits',
    altBlurb: 'a pulse around you that throws everything near you back',
    primary: shot({ damage: 18, speed: 1600, fireTime: 0.6, spread: 0.3, aimSpread: 0.1, color: 0xbfffff, size: 2.2, push: 10, stun: 0.6 }),
    alt: { kind: 'blast', damage: 15, speed: 0, fireTime: 1.5, spread: 0, aimSpread: 0, splash: { radius: 5, damage: 15 }, push: 14, size: 1, color: 0xbfffff },
  },
  acid: {
    type: 'acid',
    label: 'Acid',
    blurb: 'a bolt of acid that eats at what it hits for seconds after',
    altBlurb: 'a short spray of acid while the trigger is held',
    primary: shot({ damage: 20, speed: 1800, fireTime: 0.5, spread: 0.6, aimSpread: 0.2, color: 0x80ff40, size: 1.1, push: 2, dot: { dps: 6, seconds: 5 } }),
    alt: { kind: 'stream', damage: 18, speed: 0, fireTime: 0, spread: 0, aimSpread: 0, cone: { range: 4, angle: 30 }, dot: { dps: 6, seconds: 4 }, push: 0.5, size: 1, color: 0x80ff40, effect: 'acid' },
  },
  crossbow: {
    type: 'crossbow',
    label: 'Crossbow',
    blurb: 'a heavy bolt that falls as it flies: aim over what is far',
    altBlurb: '',
    primary: shot({ damage: 40, speed: 1800, fireTime: 0.9, spread: 0.2, aimSpread: 0, color: 0xd0c0a0, size: 0.8, push: 4, gravity: 9.8, ownShot: true }),
    alt: null,
  },
  carbonite: {
    type: 'carbonite',
    label: 'Carbonite',
    blurb: 'a freezing bolt: what it hits moves at a crawl for a while',
    altBlurb: 'a cryo charge that freezes everything near where it lands',
    primary: shot({ damage: 25, speed: 2000, fireTime: 0.5, spread: 0.5, aimSpread: 0.2, color: 0xa0e0ff, size: 1.1, push: 2, slow: 3 }),
    alt: shot({ damage: 20, speed: 1200, fireTime: 1.0, spread: 0.3, aimSpread: 0.1, color: 0xa0e0ff, size: 1.6, push: 3, splash: { radius: 3, damage: 20 }, slow: 4, ownShot: false }),
  },
};

/** The types by the client's weapon effect family and index, where the table makes the kind plain. */
const BY_FX: Record<string, GunType> = {
  'bolt:10': 'disruptor',
  'bolt:34': 'disruptor',
  'bolt:12': 'demp2',
  'bolt:13': 'sonic',
  'bolt:24': 'sonic',
  'bolt:15': 'bowcaster',
  'bolt:16': 'flechette',
  'bolt:18': 'flechette',
  'bolt:35': 'flechette',
  'bolt:17': 'rocket',
  'rocket:0': 'rocket',
  'rocket:1': 'concussion',
  'rocket:3': 'lightning',
  'bolt:21': 'flamethrower',
  'bolt:22': 'crossbow',
  'bolt:39': 'acid',
  'bolt:27': 'demp2',
  'bolt:28': 'demp2',
};

/** Which type a gun on the rack is: by its client effect first, its name second, its class last. */
export function gunTypeFor(def: WeaponDef | null, cls: WeaponClass | 'pistol' | 'carbine' | 'rifle' | 'heavy'): GunType {
  const fx = def?.fx;
  if (fx) {
    if (/^projectile_/.test(fx.id)) return 'slug';
    const byFx = BY_FX[`${fx.id}:${fx.index}`];
    if (byFx) return byFx;
  }
  const s = (def?.id ?? '').toLowerCase();
  if (/flame|flamer|lava/.test(s)) return 'flamethrower';
  if (/lightning/.test(s)) return 'lightning';
  if (/carbonite|cryo|ice_/.test(s)) return 'carbonite';
  if (/acid/.test(s)) return 'acid';
  if (/bowcaster/.test(s)) return 'bowcaster';
  if (/flechette|scatter|spray|fwg5|shotgun/.test(s)) return 'flechette';
  if (/disruptor|sniper|dlt20|dxr6|laser/.test(s)) return 'disruptor';
  if (/ion|demp|stun|electric|shock/.test(s)) return 'demp2';
  if (/sonic/.test(s)) return 'sonic';
  if (/launcher|rocket|missile/.test(s)) return 'rocket';
  if (/concussion|pulse|particle_beam|cannon/.test(s)) return 'concussion';
  if (/repeater/.test(s)) return 'repeater';
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
