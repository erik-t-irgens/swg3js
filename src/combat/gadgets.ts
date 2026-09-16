// The gadgets a Bounty Hunter can put in the number slots, as the Jedi's Force powers: the
// game's grenades by their own flavour (a fragmentation grenade's kinetic burst, the thermal
// detonator's heat, cryoban's cold that freezes, glop's goo that sticks, poison's lingering
// cloud, the proton grenade made for droids and vehicles, the Imperial detonator, the bug bomb's
// swarm), played the way Jedi Academy plays a thrown charge (an arc with bounces and a fuse, a
// blast that throws everything near), and the two that game had which this one did not: the
// trip mine's laser across a doorway and the det pack set off by the key again. Plus the stim
// pack, and bare hands. The Bounty Hunter kit does them; this is what each is, in words and
// numbers.
import type { PowerDef } from './forcePowers';

/** What a thrown charge does where it lands, beyond its blast: a burn or poison, a freeze, a stun, a shove that vehicles feel more. */
export interface GrenadeSpec {
  /** The rack entry whose model it throws (a substring of the weapon id), else a plain ball. */
  model: string;
  /** Seconds before it goes off; 0 goes off on the first thing it touches. */
  fuse: number;
  /** Thrown at this many metres a second, with a little lift. */
  speed: number;
  /** How much it bounces (0 dead, 1 lively). */
  bounce: number;
  damage: number;
  radius: number;
  /** The shove at the middle of the blast, metres a second. */
  push: number;
  color: number;
  /** A burn or a poison after: damage a second, for this long. */
  dot?: { dps: number; seconds: number };
  /** Seconds at a crawl after. */
  slow?: number;
  /** Seconds staggered after. */
  stun?: number;
  /** Vehicles and turrets take the damage this many times over (the proton grenade). */
  machines?: number;
  /** A cloud that stays where it went off, hurting whoever stands in it: seconds it lasts. */
  cloud?: number;
}

export interface GadgetDef extends PowerDef {
  /** Seconds between uses. */
  cooldown: number;
  grenade?: GrenadeSpec;
}

export const GADGETS: GadgetDef[] = [
  {
    id: 'thermal',
    name: 'Thermal Detonator',
    cost: '3s',
    kind: 'tap',
    cooldown: 3,
    blurb: 'The strongest of the grenades: a ball of heat and light where it lands, thrown in an arc that bounces, off on a short fuse.',
    grenade: { model: 'grenade_thermal_detonator', fuse: 2.5, speed: 17, bounce: 0.45, damage: 120, radius: 7, push: 14, color: 0xffb060 },
  },
  {
    id: 'frag',
    name: 'Fragmentation Grenade',
    cost: '2s',
    kind: 'tap',
    cooldown: 2,
    blurb: 'A burst of shrapnel: less than the detonator, sooner and oftener, and it throws whatever it does not kill.',
    grenade: { model: 'grenade_fragmentation', fuse: 2, speed: 18, bounce: 0.4, damage: 60, radius: 6, push: 12, color: 0xffd090 },
  },
  {
    id: 'proton',
    name: 'Proton Grenade',
    cost: '4s',
    kind: 'tap',
    cooldown: 4,
    blurb: 'An energy burst made for droids and machines: vehicles and turrets take it three times over and are thrown.',
    grenade: { model: 'grenade_proton', fuse: 2.5, speed: 16, bounce: 0.35, damage: 80, radius: 6, push: 10, color: 0x80c0ff, machines: 3 },
  },
  {
    id: 'imperial',
    name: 'Imperial Detonator',
    cost: '6s',
    kind: 'tap',
    cooldown: 6,
    blurb: "The Empire's own: the biggest blast there is, and what it does not kill stands stunned.",
    grenade: { model: 'grenade_imperial_detonator', fuse: 3, speed: 16, bounce: 0.4, damage: 160, radius: 8, push: 18, color: 0xff5040, stun: 1.5 },
  },
  {
    id: 'cryoban',
    name: 'Cryoban Grenade',
    cost: '4s',
    kind: 'tap',
    cooldown: 4,
    blurb: 'A burst of cold: little harm, but everything in it is frozen to a crawl for six seconds.',
    grenade: { model: 'grenade_cryoban', fuse: 2, speed: 17, bounce: 0.4, damage: 25, radius: 5.5, push: 4, color: 0xa0e0ff, slow: 6 },
  },
  {
    id: 'glop',
    name: 'Glop Grenade',
    cost: '4s',
    kind: 'tap',
    cooldown: 4,
    blurb: 'Goo: what it splashes is stuck fast for two seconds and slowed for five after, and can hardly see to fight.',
    grenade: { model: 'grenade_glop', fuse: 2, speed: 17, bounce: 0.2, damage: 10, radius: 5, push: 0, color: 0x90e060, stun: 2, slow: 5 },
  },
  {
    id: 'poison',
    name: 'Poison Grenade',
    cost: '5s',
    kind: 'tap',
    cooldown: 5,
    blurb: 'A cloud of poison that hangs where it burst for five seconds: whoever stands in it keeps taking harm for a while after.',
    grenade: { model: 'grenade_poison', fuse: 2, speed: 17, bounce: 0.3, damage: 10, radius: 5, push: 0, color: 0xc0ff60, dot: { dps: 7, seconds: 8 }, cloud: 5 },
  },
  {
    id: 'bug_bomb',
    name: 'Bug Bomb',
    cost: '6s',
    kind: 'tap',
    cooldown: 6,
    blurb: "A swarm from Kashyyyk that stays eight seconds and bites: a long sickness, and it is hard to run through.",
    grenade: { model: 'grenade_bug_bomb', fuse: 1.5, speed: 16, bounce: 0.3, damage: 5, radius: 6, push: 0, color: 0xb0a060, dot: { dps: 5, seconds: 10 }, slow: 3, cloud: 8 },
  },
  { id: 'trip_mine', name: 'Trip Mine', cost: '3s', kind: 'tap', cooldown: 3, blurb: 'Set on the wall or floor under the crosshair (within four metres), a laser out from it: whatever crosses the beam sets it off, you included.' },
  { id: 'det_pack', name: 'Det Pack', cost: '1s', kind: 'tap', cooldown: 1, blurb: 'Stuck where the crosshair is (within four metres, or thrown at what is farther); the key again sets every one off.' },
  { id: 'stim', name: 'Stim Pack', cost: '12s', kind: 'tap', cooldown: 12, blurb: 'Mends forty-five health at once.' },
  { id: 'fists', name: 'Bare Hands', cost: 'none', kind: 'toggle', cooldown: 0, blurb: 'The gun put away: punches on the left mouse, kicks on the right, brawling the way the game did.' },
];

export const DEFAULT_GADGETS = ['thermal', 'frag', 'trip_mine', 'det_pack', 'stim', 'fists'];

export function gadgetById(id: string): GadgetDef | undefined {
  return GADGETS.find((g) => g.id === id);
}
