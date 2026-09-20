// The Force powers a Jedi can put in the number slots: what each is called, costs and does, in
// words; the Jedi kit does them. The four the game started with, and more after Jedi Academy
// (Pull, Grip, Heal, Protect, Drain, Rage), The Force Unleashed (Repulse) and Jedi: Survivor
// (Slow), and bare hands. A tap power fires on the key; a hold power lasts while the key is
// down; a toggle stays on until the key again, or the Force runs out. The Bounty Hunter's
// gadgets (gadgets.ts) fill the same slots the same way.

export type PowerKind = 'tap' | 'hold' | 'toggle';

/**
 * What a power sounds like. The sounds are the game's own `pl_force_*` templates, which come in two
 * shapes: a single `pl_force_<name>` for something that happens at once, and a start, a loop and an
 * end for something that lasts. WHICH set goes with which power is ours: the game's own table of
 * powers is the server's and is not in the archives, so the pairings below are read off the names
 * (choking for the grip, lightning for the lightning, strength for rage, healing for heal) and the
 * three that have no obvious partner -- pull, slow and protect -- are named in the hand-off as
 * guesses. Nothing here invents a sound: every id is a template the converter writes.
 */
export interface PowerSounds {
  /** One sound, for a power that fires and is done. */
  once?: string;
  /** A power that lasts: one as it comes on, a loop while it does, one as it goes. */
  start?: string;
  loop?: string;
  end?: string;
}

export interface PowerDef {
  id: string;
  name: string;
  /** Shown on the slot: a one-off cost, or a drain a second. */
  cost: string;
  kind: PowerKind;
  blurb: string;
  /** The game's own sounds for it (above); a power with none is silent. */
  sound?: PowerSounds;
}

/** A power that lasts, as the game's names have it: `pl_force_<x>_start`, `_lp` and `_end`. */
const lasting = (name: string): PowerSounds => ({ start: `sound/pl_force_${name}_start.snd`, loop: `sound/pl_force_${name}_lp.snd`, end: `sound/pl_force_${name}_end.snd` });
/** One that fires and is done. */
const once = (name: string): PowerSounds => ({ once: `sound/pl_force_${name}.snd` });

export const POWERS: PowerDef[] = [
  { id: 'jump', name: 'Force Jump', cost: '20', kind: 'tap', blurb: 'A leap eleven metres up, steered where you look.', sound: once('jump') },
  { id: 'speed', name: 'Force Speed', cost: '6/s', kind: 'toggle', blurb: 'Twice as fast on foot while it lasts.', sound: lasting('speed') },
  { id: 'push', name: 'Force Push', cost: '25', kind: 'tap', blurb: 'Throws everything ahead of you away, and vehicles too.', sound: once('push') },
  // INVENTED: the game's own "force throw" set is the one that drags a body about, which is what
  // Pull does here.
  { id: 'pull', name: 'Force Pull', cost: '20', kind: 'tap', blurb: 'Drags everything ahead of you to your feet.', sound: once('throw') },
  { id: 'lightning', name: 'Force Lightning', cost: '18/s', kind: 'hold', blurb: 'A bolt at whatever is nearest ahead, hurting it while it lasts.', sound: { start: 'sound/pl_force_lightning_begin.snd', loop: 'sound/pl_force_lightning_lp.snd', end: 'sound/pl_force_lightning_end.snd' } },
  { id: 'drain', name: 'Force Drain', cost: '10/s', kind: 'hold', blurb: 'Draws life out of what is nearest ahead and into you.', sound: lasting('weaken') },
  { id: 'grip', name: 'Force Grip', cost: '12/s', kind: 'hold', blurb: 'Lifts the creature under the crosshair and holds it in the air, choking it; let go to throw it.', sound: lasting('choke') },
  { id: 'repulse', name: 'Force Repulse', cost: '40', kind: 'tap', blurb: 'A blast in every direction that throws everything near you away.', sound: once('blast') },
  // INVENTED: the game has nothing for slowing a creature down, so the tangle -- a thing held where
  // it stands -- stands in for it.
  { id: 'slow', name: 'Force Slow', cost: '25', kind: 'tap', blurb: 'The creature under the crosshair lives at a crawl for five seconds.', sound: once('tangle') },
  { id: 'heal', name: 'Force Heal', cost: '30', kind: 'tap', blurb: 'Mends thirty-five health at once.', sound: once('healing') },
  // INVENTED: absorb is the nearest thing the game has to a guard held up, and it is a single
  // sound with no loop of its own, so the generic loop and end carry it while it lasts.
  { id: 'protect', name: 'Force Protect', cost: '5/s', kind: 'toggle', blurb: 'What hurts you counts for a third while it lasts.', sound: { start: 'sound/pl_force_absorb.snd', loop: 'sound/pl_force_generic_lp.snd', end: 'sound/pl_force_generic_end.snd' } },
  { id: 'rage', name: 'Force Rage', cost: 'health', kind: 'toggle', blurb: 'Ten seconds faster and half again as hard with the blade, at a cost in health; then a rest.', sound: lasting('strength') },
  { id: 'fists', name: 'Bare Hands', cost: 'none', kind: 'toggle', blurb: 'The saber put away: punches on the left mouse, kicks on the right, brawling the way the game did.' },
];

/** The number keys' actions, one per slot. */
export const SLOT_ACTIONS = ['slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6'] as const;

export const DEFAULT_LOADOUT = ['jump', 'speed', 'push', 'lightning'];
/** How many number slots there are (1 to 6). */
export const SLOT_COUNT = 6;

export function powerById(id: string): PowerDef | undefined {
  return POWERS.find((p) => p.id === id);
}
