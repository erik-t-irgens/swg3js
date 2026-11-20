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
    note: "The frame rate at the top right and the weather's word under the minimap, each with its switch on the Interface page: their type, the frame rate's drop shadow, and the frame rate's own place on the character list and the creator.",
    dials: [
      sizeDial('fpsSize', 'Frame rate, type', 8, 24, 0.5, 'px', 'The number alone at the top right (12).'),
      sizeDial('fpsShadowY', 'Frame rate, shadow down', 0, 6, 0.5, 'px', 'How far below the number its drop shadow falls (1).'),
      sizeDial('fpsShadowBlur', 'Frame rate, shadow blur', 0, 8, 0.5, 'px', 'How soft the drop shadow is (2).'),
      sizeDial('weatherSize', 'Weather, type', 7, 13, 0.5, 'px', 'The word under the minimap, small (10). Its line stays 13 high, so nothing under it moves.'),
      sizeDial('stageFpsTop', 'Frame rate on the list and creator, down', 0, 80, 1, 'px', 'How far down from the top it stands on the character list and the creator (12, as in play).'),
      sizeDial('stageFpsRight', 'Frame rate on the list and creator, in', 0, 400, 1, 'px', 'How far in from the right it stands there (88: in play\'s 12 it sat on the list\'s "1 of 5"; 88 clears that at every window size).'),
    ],
  },
  {
    title: 'The action bar',
    note: "One rounded bar, a cell an ability: the mark with its key under it, a line between cells (the Interface page switches it to the bar's full height). A press darkens a cell and lets it go; a cooldown darkens it at once and its colour fills back up from the bottom; ready, a short light.",
    dials: [
      sizeDial('slotSize', 'Bar height', 24, 56, 1, 'px', 'The bar, and each cell, this high (36; the cells were 40 square).'),
      sizeDial('slotW', 'Cell width', 20, 56, 1, 'px', 'Each cell this wide (32).'),
      sizeDial('slotGlyph', 'Mark', 10, 36, 1, 'px', "The ability's mark (20; it was 28)."),
      sizeDial('slotKeySize', 'Key, type', 6, 14, 0.5, 'px', 'The key under the mark (9).'),
      sizeDial('slotRadius', 'Corners', 0, 18, 0.5, 'px', 'How round the bar\'s corners are (6, "slightly rounded").'),
      sizeDial('slotLineShare', 'Line, share of the height', 0.2, 1, 0.05, '', "The line between two cells against the bar's height (0.8, \"about 80%\"); the Interface page's switch makes it the full height."),
      sizeDial('slotLineWidth', 'Line, thick', 0.5, 3, 0.25, 'px', 'The line between two cells (1).'),
      sizeDial('pressInSeconds', 'Press, darkens over', 0, 0.5, 0.01, 's', 'A press darkens the cell over this long (0.08, "about 80 ms").'),
      sizeDial('pressOutSeconds', 'Press, back over', 0, 1, 0.01, 's', 'And brings it back over this long (0.2, "about 200 ms").'),
      sizeDial('pressDark', 'Press, how dark', 0, 1, 0.05, '', 'The darkest a press takes the cell (0.45).'),
      sizeDial('coolDark', 'Cooldown, how dark', 0, 1, 0.05, '', 'The dark a cooldown puts over the cell, drawing up from the bottom as it runs (0.6, the old wedge\'s).'),
      sizeDial('readyFlashSeconds', 'Ready flash, long', 0.05, 1.5, 0.01, 's', 'The light as a cooldown ends, up and back (0.33, "about a third of a second").'),
      sizeDial('readyFlashGlow', 'Ready flash, bright', 0, 1, 0.05, '', 'How much lighter the cell goes at the top of the flash (0.25, "about a quarter brighter").'),
      sizeDial('slotLitPx', 'Lit, glow across', 0, 24, 0.5, 'px', 'A lit cell (a toggle running, the blade out) wears a soft light of its colour inside it, this far across (10).'),
      sizeDial('slotLitGlow', 'Lit, glow strength', 0, 1, 0.05, '', 'And at this share of the colour (0.35; the old square cells wore 0.45 outside them).'),
    ],
  },
  {
    title: 'The use prompt',
    note: 'The bar of things you can press, and the long line in the same look: a see-through rounded bar, soft key caps, no outline round the words. It fades in and out, its width eases and its words cross-fade; aboard and in vehicles it is quieter. The blur behind it is a switch on the Interface page.',
    dials: [
      sizeDial('promptStrength', 'Bar strength', 0, 1, 0.05, '', "The panel colour behind it at this share of itself (0.5, \"about half\")."),
      sizeDial('promptRadius', 'Corners', 0, 16, 0.5, 'px', 'How round the bar is (8).'),
      sizeDial('promptGap', 'Between actions', 0, 32, 1, 'px', 'The room between two actions, the line in its middle (12).'),
      sizeDial('promptPadX', 'Padding, ends', 0, 24, 1, 'px', 'Inside the bar at each end, beside half the gap (6).'),
      sizeDial('promptPadY', 'Padding, top and foot', 0, 12, 0.5, 'px', 'Inside the bar above and below the caps (4).'),
      sizeDial('promptCapLight', 'Cap light', 0, 0.5, 0.01, '', 'The key\'s soft cap, this much ink over the bar (0.12, "slightly lighter than the bar").'),
      sizeDial('promptInk', 'Words', 0.3, 1, 0.05, '', 'The words in ink at this strength (0.85, "about 85%").'),
      sizeDial('promptInSeconds', 'Fades in over', 0, 1, 0.01, 's', 'Coming up (0.15, "about 150 ms").'),
      sizeDial('promptOutSeconds', 'Fades out over', 0, 1, 0.01, 's', 'Going (0.2, "about 200 ms").'),
      sizeDial('promptWidthSeconds', 'Width eases over', 0, 1, 0.01, 's', 'When the actions change, the bar\'s width eases to the new one over this long (0.18).'),
      sizeDial('promptSwapSeconds', 'Words cross-fade over', 0, 1, 0.01, 's', 'Old words out and new words in at once, over this long (0.15).'),
      sizeDial('promptQuiet', 'Aboard and in vehicles: strength', 0.1, 1, 0.05, '', 'The whole bar at this share of its strength on foot (0.6, "about 60%").'),
      sizeDial('promptQuietSize', 'Aboard and in vehicles: size', 0.5, 1, 0.01, '', 'And this share of its size (0.9, "slightly smaller").'),
      sizeDial('promptQuietBottom', 'Aboard and in vehicles: up from the floor', 40, 400, 1, 'px', "Where it stands then, clear of the flight display (168: the ship's condition block reaches 159, measured)."),
      sizeDial('promptBlurPx', 'Blur behind it', 0, 24, 0.5, 'px', 'How soft the blur behind it is while its switch is on (6).'),
      sizeDial('capW', 'Key cap, wide', 10, 48, 0.5, 'px', 'The soft cap round each key, at least this wide (22); the long line\'s caps are the same.'),
      sizeDial('capH', 'Key cap, high', 10, 36, 0.5, 'px', 'And this high (18); the long line is as tall as its caps.'),
      sizeDial('capPad', 'Key cap, side room', 0, 12, 0.5, 'px', 'Inside the cap at each side, for a key with a long name (4).'),
      sizeDial('capRadius', 'Key cap, corners', 0, 12, 0.5, 'px', 'How round the cap is (4; 2 while it had a hard border).'),
      sizeDial('capKeySize', 'Key, type', 6, 20, 0.5, 'px', 'The key in its cap (11).'),
      sizeDial('promptWordSize', 'Words, type', 8, 24, 0.5, 'px', 'The words beside each key, and the long line\'s (13).'),
      sizeDial('promptKeyGap', 'Key to words', 0, 16, 0.5, 'px', 'Between a cap and its words (5).'),
    ],
  },
  {
    title: 'The crosshair and the grapple',
    note: "The crosshair's four lines, the grapple's diamond inside them, and the two rings round the middle: a shot's charge, and how much of the longest rope is out while you hang on it, drawn alike. Drawn on the overlay, so a move shows on the next frame.",
    dials: [
      sizeDial('footTickFrom', 'Lines start', 2, 20, 0.5, 'px', 'How far from the middle the four lines begin (7; they began at 9). The dot is 3 across.'),
      sizeDial('footTickLen', 'Lines, long', 1, 12, 0.5, 'px', 'How long each line is (4, so they run 7 to 11; they ran 9 to 14).'),
      sizeDial('grappleMark', 'Diamond, corners out', 2, 16, 0.5, 'px', "The grapple's diamond, its corners this far out on the axes (6, inside the lines; it was 12)."),
      sizeDial('grappleMarkWidth', 'Diamond, thick', 0.25, 4, 0.05, 'px', 'Its stroke (1.4; it was 0.8).'),
      sizeDial('chargeRadius', 'Charge ring, radius', 8, 40, 0.5, 'px', 'The ring a charging shot fills (16).'),
      sizeDial('chargeWidth', 'Charge ring, thick', 0.5, 6, 0.25, 'px', 'Its stroke (2.5).'),
      sizeDial('chargeTrackAlpha', 'Rings, faint circle', 0, 1, 0.05, '', 'The full circle under each ring\'s filled arc, in muted (0.35, the charge ring\'s own).'),
      sizeDial('chargeArcAlpha', 'Rings, filled arc', 0, 1, 0.05, '', 'The filled arc on each ring (0.95, the charge ring\'s own).'),
      sizeDial('grappleRopeArc', 'Rope ring, radius', 8, 40, 0.5, 'px', "The ring that fills as the rope pays out (16, the charge ring's size)."),
      sizeDial('grappleRopeArcWidth', 'Rope ring, thick', 0.5, 6, 0.25, 'px', "Its stroke (2.5, the charge ring's)."),
      sizeDial('grappleRopeWarn', 'Rope ring, amber past', 0, 1, 0.05, '', 'The share of the longest rope past which its arc turns amber (0.5, half).'),
      sizeDial('grappleRopeStep', 'Rope ring, steps out', 0, 3, 0.1, '', 'While a shot charges on the rope, the rope ring steps out by this many of its own widths (1).'),
    ],
  },
];

/** The display's dials, with the values the game shipped (read once, as this module loads, before anything can move them). */
export const HUD_DIALS: DialSet = { helper: 'hud', groups: HUD_GROUPS, shipped: readDials(HUD_GROUPS) };

/** The dials the `hud` helper of `__debug` has, or null: what the debug menu asks as a helper is picked. */
export function hudDialsFor(helper: string): DialSet | null {
  return helper === 'hud' ? HUD_DIALS : null;
}
