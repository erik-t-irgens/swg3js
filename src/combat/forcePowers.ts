// The Force powers a Jedi can put in the number slots: what each is called, costs and does, in
// words; the Jedi kit does them. The four the game started with, and more after Jedi Academy
// (Pull, Grip, Heal, Protect, Drain, Rage), The Force Unleashed (Repulse) and Jedi: Survivor
// (Slow), and bare hands. A tap power fires on the key; a hold power lasts while the key is
// down; a toggle stays on until the key again, or the Force runs out. The Bounty Hunter's
// gadgets (gadgets.ts) fill the same slots the same way.

export type PowerKind = 'tap' | 'hold' | 'toggle';

export interface PowerDef {
  id: string;
  name: string;
  /** Shown on the slot: a one-off cost, or a drain a second. */
  cost: string;
  kind: PowerKind;
  blurb: string;
}

export const POWERS: PowerDef[] = [
  { id: 'jump', name: 'Force Jump', cost: '20', kind: 'tap', blurb: 'A leap eleven metres up, steered where you look.' },
  { id: 'speed', name: 'Force Speed', cost: '6/s', kind: 'toggle', blurb: 'Twice as fast on foot while it lasts.' },
  { id: 'push', name: 'Force Push', cost: '25', kind: 'tap', blurb: 'Throws everything ahead of you away, and vehicles too.' },
  { id: 'pull', name: 'Force Pull', cost: '20', kind: 'tap', blurb: 'Drags everything ahead of you to your feet.' },
  { id: 'lightning', name: 'Force Lightning', cost: '18/s', kind: 'hold', blurb: 'A bolt at whatever is nearest ahead, hurting it while it lasts.' },
  { id: 'drain', name: 'Force Drain', cost: '10/s', kind: 'hold', blurb: 'Draws life out of what is nearest ahead and into you.' },
  { id: 'grip', name: 'Force Grip', cost: '12/s', kind: 'hold', blurb: 'Lifts the creature under the crosshair and holds it in the air, choking it; let go to throw it.' },
  { id: 'repulse', name: 'Force Repulse', cost: '40', kind: 'tap', blurb: 'A blast in every direction that throws everything near you away.' },
  { id: 'slow', name: 'Force Slow', cost: '25', kind: 'tap', blurb: 'The creature under the crosshair lives at a crawl for five seconds.' },
  { id: 'heal', name: 'Force Heal', cost: '30', kind: 'tap', blurb: 'Mends thirty-five health at once.' },
  { id: 'protect', name: 'Force Protect', cost: '5/s', kind: 'toggle', blurb: 'What hurts you counts for a third while it lasts.' },
  { id: 'rage', name: 'Force Rage', cost: 'health', kind: 'toggle', blurb: 'Ten seconds faster and half again as hard with the blade, at a cost in health; then a rest.' },
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
