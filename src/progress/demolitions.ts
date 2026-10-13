// Demolitions, the doc's Figure 2: a Novice, four branches of four (Grenadier, Launchers, Charges, Ordnance)
// and a Master. The names and the words are the owner's; what each node does in this pass is ours where the
// doc's words have nothing in the game to act on (a launcher has no sway to take away, a gun no magazine to
// reload), read so that every node changes something the owner can feel and nothing is taken away from a
// character who has learnt nothing. Every number is named in `PROGRESS_RULES.demo`.
//
// What each node does arrives in two waves: the passives (Steady Arm's throw, Launcher Familiarity's pick,
// Quick Reload, Demolition Expert, Blast Discipline, Shrapnel Casing) work as soon as the node is owned; the
// switches (`demo.*`, a cook, an arc, a lock, a sticky throw, more than one det pack) are written now and read
// by the mechanics' own wave.

import type { NodeDef, DisciplineDef } from './disciplines.ts';

const node = (n: Omit<NodeDef, 'discipline'>): NodeDef => ({ ...n, discipline: 'demolitions' });

export const DEMOLITIONS: DisciplineDef = {
  id: 'demolitions',
  name: 'Demolitions',
  rules: 'demo',
  branches: [
    { id: 'grenadier', name: 'Grenadier' },
    { id: 'launchers', name: 'Launchers' },
    { id: 'charges', name: 'Charges' },
    { id: 'ordnance', name: 'Ordnance' },
  ],
  nodes: [
    node({
      id: 'demo.novice',
      branch: null,
      tier: 0,
      name: 'Demolitions Novice',
      text: 'Grenades to Familiar. Hold to cook the fuse. Short arc preview.',
      note: 'hold a grenade’s key to cook it and let go to throw (a tap throws as it always did), with a short arc while it is held',
      requires: [],
      grants: [
        { stat: 'demo.cook', op: 'set', value: 1 },
        { stat: 'demo.arc', op: 'set', value: 1 },
      ],
      prof: [{ family: 'thrown', tier: 'familiar' }],
    }),
    // ---- Grenadier ----
    node({
      id: 'demo.grenadier.1',
      branch: 'grenadier',
      tier: 1,
      name: 'Steady Arm',
      text: '+25% throw range, full arc preview.',
      note: 'a throw leaves the hand faster and lifted harder together, so it lands a quarter further; the arc shown runs to its first touch',
      requires: ['demo.novice'],
      grants: [
        { stat: 'throw.speed', op: 'mul', rule: 'steadyArm' },
        { stat: 'throw.lift', op: 'mul', rule: 'steadyArm' },
        { stat: 'demo.arc', op: 'set', value: 2 },
      ],
    }),
    node({
      id: 'demo.grenadier.2',
      branch: 'grenadier',
      tier: 2,
      name: 'Cooked Fuse',
      text: 'Exact fuse timing, airbursts.',
      note: 'the arc marks where the fuse runs out, and a cooked grenade bursts there in the air',
      requires: ['demo.grenadier.1'],
      grants: [{ stat: 'demo.burst', op: 'set', value: 1 }],
    }),
    node({
      id: 'demo.grenadier.3',
      branch: 'grenadier',
      tier: 3,
      name: 'Bank Shot',
      text: 'Choose bounce or sticky per throw.',
      note: 'the other attack key while cooking makes this throw stick',
      requires: ['demo.grenadier.2'],
      grants: [{ stat: 'demo.sticky', op: 'set', value: 1 }],
    }),
    node({
      id: 'demo.grenadier.4',
      branch: 'grenadier',
      tier: 4,
      name: 'Twin Toss',
      text: 'Throw two at once; fast re-throw.',
      requires: ['demo.grenadier.3'],
      grants: [
        { stat: 'grenade.count', op: 'set', rule: 'twinCount' },
        { stat: 'grenade.cooldown', op: 'mul', rule: 'twinCooldown' },
      ],
    }),
    // ---- Launchers ----
    node({
      id: 'demo.launchers.1',
      branch: 'launchers',
      tier: 1,
      name: 'Launcher Familiarity',
      text: 'Launchers to Familiar, -30% sway.',
      note: 'a launcher has no sway to take away, so the homing rocket picks its mark from a cone about half as wide again',
      requires: ['demo.novice'],
      grants: [{ stat: 'launcher.pickCos', op: 'set', rule: 'pickCos' }],
      prof: [{ family: 'launcher', tier: 'familiar' }],
    }),
    node({
      id: 'demo.launchers.2',
      branch: 'launchers',
      tier: 2,
      name: 'Quick Reload',
      text: 'Launchers to Proficient, -25% reload.',
      note: 'a launcher has no magazine, so it fires again a quarter sooner',
      requires: ['demo.launchers.1'],
      grants: [{ stat: 'launcher.refire', op: 'mul', rule: 'quickReload' }],
      prof: [{ family: 'launcher', tier: 'proficient' }],
    }),
    node({
      id: 'demo.launchers.3',
      branch: 'launchers',
      tier: 3,
      name: 'Tracking Lock',
      text: 'Lock-on for guided warheads.',
      note: 'hold the crosshair on a target to lock it; both rockets home on the lock',
      requires: ['demo.launchers.2'],
      grants: [{ stat: 'demo.lock', op: 'set', value: 1 }],
    }),
    node({
      id: 'demo.launchers.4',
      branch: 'launchers',
      tier: 4,
      name: 'Payload Swap',
      text: 'Switch warheads mid-fight: ion, incendiary, smoke.',
      requires: ['demo.launchers.3'],
      grants: [{ stat: 'demo.payload', op: 'set', value: 1 }],
    }),
    // ---- Charges ----
    node({
      id: 'demo.charges.1',
      branch: 'charges',
      tier: 1,
      name: 'Detonite Handling',
      text: 'Place 1 remote charge.',
      note: 'one det pack is out at a time today; with this the key tapped lays a second and held sets them all off',
      requires: ['demo.novice'],
      grants: [
        { stat: 'charge.packs', op: 'set', rule: 'packs' },
        { stat: 'demo.remote', op: 'set', value: 1 },
      ],
    }),
    node({
      id: 'demo.charges.2',
      branch: 'charges',
      tier: 2,
      name: 'Shaped Charge',
      text: 'Directional blast; breach doors and cover.',
      note: 'a stuck det pack blasts outward from its surface: half again in front, half behind',
      requires: ['demo.charges.1'],
      grants: [{ stat: 'demo.shaped', op: 'set', value: 1 }],
    }),
    node({
      id: 'demo.charges.3',
      branch: 'charges',
      tier: 3,
      name: 'Chain Detonation',
      text: 'Charges trigger each other; carry 3.',
      requires: ['demo.charges.2'],
      grants: [
        { stat: 'chain.reach', op: 'set', rule: 'chainReach' },
        { stat: 'demo.chainAll', op: 'set', value: 1 },
        { stat: 'charge.packs', op: 'set', rule: 'packsChain' },
      ],
    }),
    node({
      id: 'demo.charges.4',
      branch: 'charges',
      tier: 4,
      name: 'Demolition Expert',
      text: 'Bonus vs. vehicles, turrets, structures.',
      note: 'grenades and charges, not the guns’ splash nor the flechette’s mines',
      requires: ['demo.charges.3'],
      grants: [{ stat: 'blast.machines', op: 'mul', rule: 'expert' }],
    }),
    // ---- Ordnance ----
    node({
      id: 'demo.ordnance.1',
      branch: 'ordnance',
      tier: 1,
      name: 'Blast Discipline',
      text: '-40% self-damage.',
      requires: ['demo.novice'],
      grants: [{ stat: 'blast.self', op: 'mul', rule: 'blastDiscipline' }],
    }),
    node({
      id: 'demo.ordnance.2',
      branch: 'ordnance',
      tier: 2,
      name: 'Shrapnel Casing',
      text: '+20% blast radius.',
      note: 'grenades and charges, not the launchers’ splash',
      requires: ['demo.ordnance.1'],
      grants: [{ stat: 'blast.radius', op: 'mul', rule: 'shrapnel' }],
    }),
    node({
      id: 'demo.ordnance.3',
      branch: 'ordnance',
      tier: 3,
      name: 'Ion & Concussion',
      text: 'Ion vs. droids and shields; concussion stagger.',
      note: 'every grenade staggers what is within half its radius; droids take the machine factor',
      requires: ['demo.ordnance.2'],
      grants: [{ stat: 'demo.stagger', op: 'set', rule: 'stagger' }],
    }),
    node({
      id: 'demo.ordnance.4',
      branch: 'ordnance',
      tier: 4,
      name: 'Improvised Ordnance',
      text: 'Craft field grenades from salvage.',
      note: 'a stand-in until crafting is decided: each grenade holds two throws, refilled one at a time',
      standIn: 'a stand-in until crafting is decided: each grenade holds two throws',
      requires: ['demo.ordnance.3'],
      grants: [{ stat: 'grenade.stock', op: 'set', rule: 'stock' }],
    }),
    // ---- Master ----
    node({
      id: 'demo.master',
      branch: null,
      tier: 5,
      name: 'Master Demolitionist: Danger Close',
      text: 'Your own blasts can’t down you, and their knockback launches you.',
      note: 'needs three of the four branches complete',
      requires: ['demo.novice'],
      grants: [{ stat: 'demo.dangerClose', op: 'set', value: 1 }],
    }),
  ],
};
