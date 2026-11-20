// The display's dials (src/ui/dials.ts, the interface rewrite's first wave): the body block's sizes, health's colour
// steps and timings, breath's flash and the bars' going away, as sliders in the debug menu when `hud` is picked. Each is
// a number of `HUD_SIZES`, set through `tuneSizes` exactly as `__debug.hud({ sizes: { … } })` sets it, and then the
// display's settings applied again (the host's `apply`, which the app hands over), so the bars are placed again and the
// stylesheet's looks rewritten: the line the menu copies out is that helper's own argument
// (`hud({ sizes: { healthBarH: 5 } })`). How a bar looks and how fast it moves is the owner's to judge by eye (CLAUDE.md,
// "Feel is the owner's"); each start value and its reason is in `HUD_SIZES`, and a slider's range is ours.
//
// Pure: it imports the table and the dials' own types and nothing of the page, so a node test moves every dial through
// the real table.
import type { DialGroup, DialSet, NumberDial } from './dials.ts';
import { readDials } from './dials.ts';
import { HUD_SIZES, tuneSizes, type HudSizes } from './hudMath.ts';

/** What a moved dial asks of the game: the display's settings applied again. Set by the app; nothing until then. */
export const HUD_DIALS_HOST: { apply: (() => void) | null } = { apply: null };

function sizeDial(k: keyof HudSizes, label: string, min: number, max: number, step: number, unit: string, note: string): NumberDial {
  return {
    kind: 'number',
    key: `sizes.${k}`,
    label,
    note,
    min,
    max,
    step,
    unit,
    get: () => HUD_SIZES[k],
    set: (v) => {
      tuneSizes({ [k]: v });
      HUD_DIALS_HOST.apply?.();
      return [];
    },
  };
}

const HUD_GROUPS: DialGroup[] = [
  {
    title: 'The bars',
    note: 'How thick each bar is and how long an attached bar is against the one it is attached to. The block is placed again at once; nothing compiles.',
    dials: [
      sizeDial('healthBarH', 'Health bar thickness', 2, 14, 0.5, 'px', 'The health bar, as thick as the Force bar was (6). In the inside look less of it shows, so it may want to be thicker there.'),
      sizeDial('poolBarH', 'Force bar thickness', 2, 12, 0.5, 'px', 'The Force bar (6); laid over, half of it lies over the health bar; inside, half of it shows.'),
      sizeDial('staminaBarH', 'Stamina bar thickness', 1, 10, 0.5, 'px', 'Stamina (4).'),
      sizeDial('breathBarH', 'Breath bar thickness', 1, 10, 0.5, 'px', 'Breath, under water (4, thin like stamina).'),
      sizeDial('barSideShare', 'Attached length, at the sides', 0.2, 1, 0.05, '', 'An attached bar against the one it is on, with the block at either side, lined up with the outer end (0.75).'),
      sizeDial('barMiddleShare', 'Attached length, in the middle', 0.2, 1, 0.05, '', 'The same with the block in the middle, centred (0.6).'),
      sizeDial('markSize', 'Weapon mark box', 16, 80, 1, 'px', "The weapon mark's box, over the bars in the middle and at the screen's edge at the sides (40)."),
      sizeDial('markGap', 'Gap by the mark', 0, 24, 1, 'px', 'Between the weapon mark and the bars (6).'),
      sizeDial('blockSide', 'In from the side', 0, 80, 1, 'px', "How far the block stands in from the screen's side edge when it is on the left or the right (14, the message line's own)."),
    ],
  },
  {
    title: "Health's colours",
    note: "Health is the palette's muted down to a share, the dark red at it and below; under a lower share a ripple of the bright red spreads from the bar. Both shares are of full health.",
    dials: [
      sizeDial('hpLow', 'Dark red at and below', 0, 1, 0.01, '', 'The share the colour turns at (0.4).'),
      sizeDial('hpEaseSeconds', 'Colour eases over', 0, 2, 0.05, 's', 'How long the turn takes (a quarter second).'),
      sizeDial('hpRipple', 'Ripple below', 0, 1, 0.01, '', 'The share the ripple runs under (0.3).'),
      sizeDial('rippleSeconds', 'Ripple every', 0.2, 4, 0.05, 's', 'One ripple spreading and fading, start to start (about once a second).'),
      sizeDial('ripplePx', 'Ripple spreads', 1, 30, 0.5, 'px', 'How far out it spreads before it is gone (6).'),
      sizeDial('rippleStrength', 'Ripple starts at', 0, 1, 0.05, '', 'How much of the bright red the ripple starts at against the bar, before it fades as it spreads (0.75).'),
    ],
  },
  {
    title: 'Breath and going away',
    note: 'Breath flashes white below a share of a full breath; health and Force go a while after they are full, and every bar fades in and out.',
    dials: [
      sizeDial('breathFlashBelow', 'Breath flashes below', 0, 1, 0.01, '', 'The share of a full breath (0.3).'),
      sizeDial('breathFlashSeconds', 'Flash, each way', 0.1, 4, 0.05, 's', 'Into white and back out again each take this long (1).'),
      sizeDial('fullLinger', 'Gone after full', 0, 10, 0.1, 's', "Health and Force go this long after they are full (1.5, stamina's own)."),
      sizeDial('barFadeSeconds', 'Fade in and out', 0, 2, 0.05, 's', 'Every bar coming and going (0.2; 0 is at once).'),
    ],
  },
  {
    title: 'The weapon mark',
    note: "Our own mark for what the hands hold: how see-through it is, each lightsaber stance's tilt, and a pair's two small marks and the line between them. The mark's box and its gap are under The bars.",
    dials: [
      sizeDial('markAlpha', 'Opacity', 0.1, 1, 0.05, '', 'Slightly see-through (0.75).'),
      sizeDial('markTiltFast', 'Fast stance tilt', -90, 90, 0.5, '°', 'Clockwise from upright (45, the owner\'s: to the right).'),
      sizeDial('markTiltMedium', 'Medium stance tilt', -90, 90, 0.5, '°', 'Clockwise from upright (22.5).'),
      sizeDial('markTiltStrong', 'Strong stance tilt', -90, 90, 0.5, '°', 'Clockwise from upright (0, upright).'),
      sizeDial('markTiltStaff', 'Double-bladed tilt', -90, 90, 0.5, '°', 'The double-bladed saber (45).'),
      sizeDial('markTiltDual', 'Two sabers, each', 0, 90, 0.5, '°', 'Each of the two crossed sabers, leaning opposite ways (45); a lone saber in a pair stands at it too.'),
      sizeDial('markTurnSeconds', 'Turn to a new stance', 0, 1, 0.05, 's', 'How long the mark takes to tilt when the stance changes (0.15; 0 snaps).'),
      sizeDial('markBladeSeconds', 'Blade, when none to read', 0.05, 2, 0.01, 's', "The blade drawing in or out when the saber gives no timing of its own (0.32, what the game's blade runs at). A real saber's own timing wins."),
      sizeDial('markPairScale', 'A pair: each mark', 0.15, 0.6, 0.01, '', "Each of two marks against the box (a third, the owner's: or smaller, whatever fits)."),
      sizeDial('markPairAt', 'A pair: along the diagonal', 0.1, 0.5, 0.01, '', 'Each mark\'s middle this far along the box\'s diagonal from its own corner (0.3).'),
      sizeDial('markSplitLength', 'A pair: the line, long', 0, 24, 0.5, '', 'The muted line between them, in the box\'s 24 units (11).'),
      sizeDial('markSplitWidth', 'A pair: the line, thick', 0.25, 3, 0.05, '', 'In the box\'s 24 units (1.2; the marks are drawn at 1.75).'),
      sizeDial('markSplitAngle', 'A pair: the line, angle', 0, 90, 1, '°', 'From level, rising to the right (45: across the diagonal the marks stand on).'),
    ],
  },
  {
    title: 'The corner',
    note: "The frame rate at the top right and the weather's word under the minimap, each with its switch on the Interface page: their type and the frame rate's drop shadow.",
    dials: [
      sizeDial('fpsSize', 'Frame rate, type', 8, 24, 0.5, 'px', 'The number alone at the top right (12).'),
      sizeDial('fpsShadowY', 'Frame rate, shadow down', 0, 6, 0.5, 'px', 'How far below the number its drop shadow falls (1).'),
      sizeDial('fpsShadowBlur', 'Frame rate, shadow blur', 0, 8, 0.5, 'px', 'How soft the drop shadow is (2).'),
      sizeDial('weatherSize', 'Weather, type', 7, 13, 0.5, 'px', 'The word under the minimap, small (10). Its line stays 13 high, so nothing under it moves.'),
    ],
  },
];

/** The display's dials, with the values the game shipped (read once, as this module loads, before anything can move them). */
export const HUD_DIALS: DialSet = { helper: 'hud', groups: HUD_GROUPS, shipped: readDials(HUD_GROUPS) };

/** The dials the `hud` helper of `__debug` has, or null: what the debug menu asks as a helper is picked. */
export function hudDialsFor(helper: string): DialSet | null {
  return helper === 'hud' ? HUD_DIALS : null;
}
