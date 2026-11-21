// The edge smoothing's numbers (the GPU port's pass 1, wave 6): the upscaled smoothing's share of the screen, how much of each
// new frame goes into the picture, how much more where something see-through or bright was drawn, and the two depth tests that
// throw a pixel's history away. How soft or how steady the picture is, and how much a fast light may trail, is the owner's to
// decide, so each is a dial (`TAA_DIALS`, the debug menu's sliders when `gpu` is picked) set through `tuneTaa`, exactly as
// `__debug.gpu({ taa: { ... } })` sets it. Each start below is written with its reason; a slider's range is ours, wide enough to
// try anything sensible.
//
// Pure: nothing of three's or the page's, so a node test moves every dial through the real table.

import type { DialGroup, DialSet, NumberDial } from '../../../ui/dials.ts';
import { readDials } from '../../../ui/dials.ts';

/** The smoothing's modes, as the Graphics page's Smoothing row stores them (`FxSettings.smoothing`). */
export const SMOOTHING = { off: 0, full: 1, upscaled: 2 } as const;

export const TAA_TUNE = {
  /**
   * The share of the canvas's width and height the scene is drawn at under the upscaled smoothing, which then fills the canvas
   * from it: 0.7, the design's "about 70%" (half the pixels drawn, 0.49 of them).
   */
  share: 0.7,
  /**
   * The least share of each new frame in the full smoothing's picture: 0.05, three's own, about twenty frames of history behind
   * an edge that stands still. Lower is smoother and slower to settle after a cut; higher shimmers more.
   */
  current: 0.05,
  /**
   * The same for the upscaled smoothing: 0.025, three's own, lower than the full one's since each frame fills less of the canvas's
   * finer grid and the history has more to gather.
   */
  currentUp: 0.025,
  /**
   * How far the motion buffer's reactive mark (a see-through or additive thing drawn over what is behind: a bolt's glow, a blade,
   * glass, water, a particle) raises the new frame's share toward the whole of it: at 0.8 a pixel marked fully takes four fifths
   * of the new frame, so a bolt past a lake leaves at most a fifth of a frame behind it. 0 is none; 1 shows such a pixel as drawn.
   */
  reactive: 0.8,
  /**
   * A pixel's history is thrown away where the surface found there last frame stood further from where this frame's surface was
   * last frame than this share of its distance: 0.05, five centimetres at a metre, half a metre at ten, five at a hundred. Three
   * compared its depth buffer's own values, which with the game's 5 cm near plane spans a metre at ten metres and a hundred at a
   * hundred, and ghosted behind pods and people. Lower throws away more (sharper behind what moves, more shimmer on grazing
   * ground); higher keeps more.
   */
  depth: 0.05,
  /**
   * Where the nearest and farthest of a pixel's nine neighbours differ by more than this share of the nearest, the pixel is an
   * edge and keeps its history whatever the depth test says, the neighbourhood's colours holding it to the frame (three's rule,
   * made relative): 0.1. Lower brings stepped edges back where something moves; higher lets more ghost past an edge.
   */
  edge: 0.1,
  /**
   * The motion in pixels a frame at which a pixel's history counts for nothing: 128, three's own. Between nought and this the new
   * frame's share rises with the motion, which is the softness of the ground under a pod at speed.
   */
  maxMotion: 128,
};

export type TaaTuneKey = keyof typeof TAA_TUNE;

/** The bounds `tuneTaa` holds each number to (a typed value may pass a slider's range, never these). */
const BOUNDS: Record<TaaTuneKey, [number, number]> = {
  share: [0.25, 1],
  current: [0.005, 1],
  currentUp: [0.005, 1],
  reactive: [0, 1],
  depth: [0.001, 1],
  edge: [0.001, 10],
  maxMotion: [1, 4096],
};

/** Set any of the numbers; answers words for anything refused or held to its bounds. */
export function tuneTaa(o: Partial<Record<TaaTuneKey, unknown>>): string[] {
  const said: string[] = [];
  for (const k of Object.keys(o) as TaaTuneKey[]) {
    if (!(k in TAA_TUNE)) {
      said.push(`taa: no number named '${String(k)}'`);
      continue;
    }
    const v = o[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      said.push(`taa.${k}: not a number`);
      continue;
    }
    const [lo, hi] = BOUNDS[k];
    const held = Math.min(hi, Math.max(lo, v));
    if (held !== v) said.push(`taa.${k}: held to ${held} (${lo} to ${hi})`);
    TAA_TUNE[k] = held;
  }
  return said;
}

/** One number of `TAA_TUNE` as a dial, its key the path `__debug.gpu({ taa: { ... } })` takes. */
function num(k: TaaTuneKey, label: string, min: number, max: number, step: number, unit: string, note: string, text?: (v: number) => string): NumberDial {
  return { kind: 'number', key: `taa.${k}`, label, note, min, max, step, unit, get: () => TAA_TUNE[k], set: (v) => tuneTaa({ [k]: v }), text };
}

const TAA_GROUPS: DialGroup[] = [
  {
    title: 'Edge smoothing',
    note: "The Graphics page's Smoothing row picks Off, Full or Upscaled; these move how either smooths. WebGPU's alone, with Effects on.",
    dials: [
      num('share', 'Upscaled: share of the screen', 0.4, 1, 0.05, '×', 'Upscaled draws the scene at this share of the width and height and fills the screen from it: lower is faster and softer. The Quality slider\'s Low and Medium set it (0.6, 0.7) and a reload takes it from there; moved here it holds for the session.', (v) => `${Math.round(v * v * 100)}% of the pixels`),
      num('current', 'Full: new frame share', 0.01, 0.3, 0.005, '', 'The least share of each new frame in the picture: lower is smoother and slower to settle, higher shimmers more.', (v) => `about ${Math.round(1 / v)} frames of history`),
      num('currentUp', 'Upscaled: new frame share', 0.005, 0.3, 0.005, '', 'The same for Upscaled, which has a finer grid to fill from each frame.', (v) => `about ${Math.round(1 / v)} frames of history`),
      num('reactive', 'See-through and bright', 0, 1, 0.05, '', 'How much more of the new frame a pixel takes where a bolt, a blade, glass, water or a particle was drawn over what is behind: 1 shows it as drawn.'),
      num('depth', 'Depth test', 0.005, 0.3, 0.005, '', 'A pixel forgets its history where the surface behind it moved by more than this share of its distance: lower is sharper behind what moves, higher steadier on grazing ground.', (v) => `${(v * 10).toFixed(2)} m at 10 m`),
      num('edge', 'Edges keep their history above', 0.02, 1, 0.01, '', 'Where a pixel and its neighbours differ in depth by more than this share, it keeps its history and is held to the frame by their colours: lower brings stepped edges back where things move.'),
    ],
  },
];

/** The smoothing's dials, with the values the game shipped (read once, as this module loads). */
export const TAA_DIALS: DialSet = { helper: 'gpu', groups: TAA_GROUPS, shipped: readDials(TAA_GROUPS) };
