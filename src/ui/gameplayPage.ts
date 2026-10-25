// The Gameplay page's own table: how the game plays, as against how it looks or sounds.
//
// It is a file of its own for the reason the Interface page's is (`hudPage.ts`): `menu.ts` reaches for
// `document` and cannot be imported by a node test, and the test is what keeps a knob's ends and the
// range the console clamps to the same two numbers. Nothing here touches the page.
import { DIFFICULTY_RANGE } from '../world/difficulty.ts';
import { FORCE_WAVE_SPEED } from '../combat/forceWaveTune.ts';
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
      {
        key: 'forceKnockTravels',
        label: "The Force's knock travels",
        kind: 'toggle',
        hint: "A push, a pull or a repulse knocks each body when its wave reaches it, so a body far out is knocked a moment after one close by, and one that steps out of the cone before the wave arrives is not knocked at all. Off, every body in reach is knocked the instant the power is used, as it always was. Gameplay only: it plays the same with the volumetrics, the dust and Effects on or off (with them off the wave is simply not drawn).",
      },
      {
        key: 'forceWaveSpeed',
        label: "The Force's wave speed",
        kind: 'range',
        min: FORCE_WAVE_SPEED.min,
        max: FORCE_WAVE_SPEED.max,
        step: FORCE_WAVE_SPEED.step,
        format: (v) => `${v.toFixed(2)}×`,
        requires: ['forceKnockTravels'],
        hint: "How fast the wave runs out (and in, for a pull): 1 is the air's own wave, about a second from your feet to the reach; 2 twice as fast and half as easy to step out of. The wave of dust and the knock read the one speed, so they always arrive together.",
      },
    ],
  },
  {
    title: 'The world',
    knobs: [
      {
        key: 'restuss',
        label: 'Restuss',
        kind: 'choice',
        choices: [
          { value: 'living', label: 'The living city' },
          { value: 'ruins', label: 'In ruins' },
        ],
        hint: "How Restuss on Rori stands: the launch city whole, with its people, its starport and its shuttleport, or its ruins with the First Brigade standing guard and the late camp's pads its only ports. The camp and the faction cantinas stand either way. It changes when you next arrive on Rori; on a server that keeps it, the server's admin decides it for everybody.",
      },
    ],
  },
];
