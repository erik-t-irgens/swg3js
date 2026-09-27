// The Gameplay page's own table: how the game plays, as against how it looks or sounds.
//
// It is a file of its own for the reason the Interface page's is (`hudPage.ts`): `menu.ts` reaches for
// `document` and cannot be imported by a node test, and the test is what keeps a knob's ends and the
// range the console clamps to the same two numbers. Nothing here touches the page.
import { DIFFICULTY_RANGE } from '../world/difficulty.ts';
import type { Knob } from './hudPage.ts';

/**
 * One knob so far, the owner's: the world's own people and creatures stand at the emulator's numbers,
 * and this scales their health and their blows together, live. The slider's ends are the knob's own
 * range (`DIFFICULTY_RANGE`), which `__debug.difficulty` clamps to as well.
 */
export const GAMEPLAY: { title: string; knobs: readonly Knob[] }[] = [
  {
    title: 'Fighting',
    knobs: [
      {
        key: 'difficulty',
        label: 'Difficulty',
        kind: 'range',
        min: DIFFICULTY_RANGE.min,
        max: DIFFICULTY_RANGE.max,
        step: 0.05,
        format: (v) => `${v.toFixed(2)}×`,
        hint: 'How much health the world\'s own people and creatures have and how hard they hit, together. 1 is their own numbers, which were set for a character with a whole profession behind it: a level-116 Tusken takes nearly seventeen hundred to put down and lands fifty-odd a blow. Lower makes everything the world stands softer at once, a fight already under way included; you and other players are never scaled.',
      },
    ],
  },
];
