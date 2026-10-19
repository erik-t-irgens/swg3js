// The crowd's dials (src/ui/dials.ts): the numbers of how a far body is drawn, on sliders in the debug menu when `crowd`
// is picked. Each is set through `tuneCrowd`, exactly as `__debug.crowd({ tune })` sets it, so the clamps and the words
// are the console's own, and the line the menu copies out is that helper's own argument (`crowd({ tune: { smallShare:
// 0.05 } })`). Every number here changes how a body looks or moves and is the owner's to judge by eye (CLAUDE.md, "Feel
// is the owner's"); a slider's range is ours, wide enough to try anything sensible.
//
// Pure: it imports the tune table and the dials' own types and nothing of the page, so a node test moves every dial
// through the real table.
import type { DialGroup, DialSet, NumberDial } from '../../ui/dials.ts';
import { readDials } from '../../ui/dials.ts';
import { CROWD_TUNE, tuneCrowd, type CrowdTune } from './crowd.ts';

/** How far off a 1.8 m figure covers a share of the screen's height at the game's 60-degree view (1.56 / share). */
const metresAt = (share: number) => (share > 0 ? `a figure at about ${Math.round(1.56 / share)} m` : 'off');

/** A number of `CROWD_TUNE`, set through `tuneCrowd`. */
function dial(k: keyof CrowdTune, label: string, min: number, max: number, step: number, unit: string, note: string, text?: (v: number) => string): NumberDial {
  const t = CROWD_TUNE as unknown as Record<string, number>;
  return { kind: 'number', key: `tune.${k}`, label, note, min, max, step, unit, get: () => t[k], set: (v) => tuneCrowd({ [k]: v }), text };
}

const CROWD_GROUPS: DialGroup[] = [
  {
    title: 'Small parts',
    note: "Eyes, teeth, badges and buckles hidden on a body small on the screen, shown again the moment it turns to fight. The shares are of the screen's height, so zooming in to aim brings them back.",
    dials: [
      dial('smallShare', 'Hide under', 0, 0.15, 0.005, '', 'A body covering less of the screen\'s height than this hides its small parts. 0.03 is a person about 52 m off.', metresAt),
      dial('smallBand', 'Show again past', 1, 2, 0.05, '×', 'They come back only once the body covers this many times the hiding share, so one pacing at the line does not blink.'),
      dial('smallTris', 'Fewer triangles than', 0, 400, 4, '', 'A piece counts as a small part only with fewer triangles than this...'),
      dial('smallSize', 'Smaller than', 0, 0.5, 0.01, 'm', '...and smaller than this across from its middle.'),
    ],
  },
  {
    title: "The client's own far tiers",
    note: 'Both off (at nought) until you turn them on. A body in a fight is never held or hidden by them.',
    dials: [
      dial('holdShare', 'Hold the pose under', 0, 0.05, 0.001, '', 'A body standing still and covering less of the screen than this holds its pose instead of breathing (one walking keeps walking, so no foot slides).', metresAt),
      dial('holdStill', 'Standing still within', 0, 0.05, 0.001, 'm', 'How far its feet may stray from where they came to rest and still count as standing still. With the next, anything slower than this over that counts as standing.'),
      dial('holdAfter', 'Standing still for', 0.05, 2, 0.05, 's', 'How long its feet must stay within that before it counts as standing still (judged over time: the physics moves a body only sixty times a second).'),
      dial('goneShare', 'Not drawn under', 0, 0.02, 0.001, '', 'A body covering less of the screen than this is not drawn at all (still there, still shootable).', metresAt),
    ],
  },
  {
    title: 'Kept for a server',
    dials: [dial('sharedThink', 'Thinks at least every', 0.05, 1.5, 0.05, 's', 'The slowest a body this browser keeps for a server may think, since its decisions are everybody\'s.')],
  },
];

/** The crowd's dials, with the values the game shipped (read once, as this module loads, before anything can move them). */
export const CROWD_DIALS: DialSet = { helper: 'crowd', groups: CROWD_GROUPS, shipped: readDials(CROWD_GROUPS) };

/** The dials a crowd helper of `__debug` has, or null: what the debug menu asks as a helper is picked. */
export function crowdDialsFor(helper: string): DialSet | null {
  return helper === 'crowd' ? CROWD_DIALS : null;
}
