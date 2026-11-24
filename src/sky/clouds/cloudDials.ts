// The march's and the look's sliders for the debug menu's `clouds` (the GPU port's pass 3, wave 1, maker V): every number of
// `CLOUD_TUNE` (`cloudTune.ts`) and `CLOUD_LOOK` (`cloudShape.ts`) as a dial, each set through the helper's own setter
// (`tuneMarch`, `tuneLook`), its key the helper's argument path (`clouds({ tune: { march: { steps } } })`), so a slider moved
// copies out as the line that keeps it. Feel is the owner's: these are his to move. Pure.

import type { DialGroup, NumberDial } from '../../ui/dials.ts';
import { CLOUD_TUNE, CLOUD_TUNE_RANGE, tuneMarch } from './cloudTune.ts';
import { CLOUD_LOOK, CLOUD_LOOK_RANGE, tuneLook } from './cloudShape.ts';

/** A slider's step from its range: whole numbers over a hundred, halves over ten, hundredths below, thousandths under one. */
function stepOf(min: number, max: number): number {
  const span = max - min;
  return span > 10000 ? 100 : span > 100 ? 1 : span > 10 ? 0.5 : span > 1 ? 0.01 : 0.001;
}

/** What each dial does, in a line (the slider's note): the start and its reason are in the dial's own comment. */
const MARCH_NOTES: Record<keyof typeof CLOUD_TUNE, string> = {
  trace: "the trace's share of the display each way (a half: a quarter of the pixels marched)",
  rayBudget: 'the most rays a frame; a larger display shrinks its trace to it',
  steps: 'the most steps a ray takes',
  nearStep: 'metres a step over the first stretch from the lens',
  nearReach: 'metres from the lens stepped finely',
  grow: "past that, a step is its distance's share",
  farStep: 'the longest step, metres',
  reach: 'metres the march reaches; past it the sky is clear',
  lightReach: 'metres the light march looks toward the light',
  minTransmittance: 'a ray ends when this little gets through',
  clearGrow: 'how fast steps grow over clear map',
  jitter: "the first step's jitter moves each frame (1) or holds (0)",
  depthMatch: "how near a trace texel's depth must be a pixel's, a share of its distance",
};

const LOOK_NOTES: Record<keyof typeof CLOUD_LOOK, string> = {
  sigma: 'extinction a metre at full density: how opaque a cloud is',
  erosion: "how hard the detail eats the edges (times each type's own)",
  edgeHard: "the cover cut's band at a layer's hardest edge",
  edgeSoft: "and at its softest",
  shapeTile: "metres the shape noise repeats over: its billows' size",
  detailTile: "metres the detail noise repeats over: its frays' size",
  tallness: "the shape noise's height against its width",
  curl: 'metres the curl turns the detail at a base',
  wispyBand: 'the share of a layer over which the detail turns from wisps to billows',
  carve: "how much of the cover a billowy or fibrous type's noise always carves",
  taperFrom: "where in a cloud's column its type's taper begins, a share of the column",
  anvilFrom: "where the anvil's spread begins, a share of a tower's column",
  anvilTo: 'where it is whole',
  anvilPower: "the cover's power at a full anvil (under one spreads the top past its cell)",
  bite: "the most of a cloud's cut the detail's erosion eats",
  softBite: 'that bite at the softest edge, a share of itself',
  forward: "the forward lobe's eccentricity (the silver lining)",
  back: "the back lobe's (a sunlit face with the sun behind)",
  forwardShare: "the forward lobe's share",
  albedo: 'how much of the light a droplet scatters rather than takes',
  octaveExtinction: "each octave of multiple scattering's light extinction",
  octaveLight: "each octave's share of the light",
  octavePhase: "each octave's phase eccentricity",
  powder: 'how dark thin edges facing away from the light are',
  powderDepth: 'metres of cloud over which a dark edge fills in',
  ambient: "the sky's light on the clouds",
  belly: "a layer's base's ambient against its top's",
  cone: "the light march's cone, a share of the distance",
};

/** The march's and the look's groups (made once a call; the menu asks once). */
export function marchDialGroups(): DialGroup[] {
  const march: NumberDial[] = (Object.keys(CLOUD_TUNE) as (keyof typeof CLOUD_TUNE)[]).map((k) => {
    const [min, max] = CLOUD_TUNE_RANGE[k];
    return { kind: 'number', key: `tune.march.${k}`, label: k, note: `CLOUD_TUNE.${k}: ${MARCH_NOTES[k]}`, min, max, step: stepOf(min, max), unit: '', get: () => CLOUD_TUNE[k], set: (v: number) => tuneMarch({ [k]: v }) };
  });
  const look: NumberDial[] = (Object.keys(CLOUD_LOOK) as (keyof typeof CLOUD_LOOK)[]).map((k) => {
    const [min, max] = CLOUD_LOOK_RANGE[k];
    return { kind: 'number', key: `tune.look.${k}`, label: k, note: `CLOUD_LOOK.${k}: ${LOOK_NOTES[k]}`, min, max, step: stepOf(min, max), unit: '', get: () => CLOUD_LOOK[k], set: (v: number) => tuneLook({ [k]: v }) };
  });
  return [
    { title: 'The march', note: "How the clouds are marched (CLOUD_TUNE): the trace, the steps, the reach. Every world's.", dials: march },
    { title: 'The look', note: "How every layer is shaped and lit (CLOUD_LOOK): density, edges, noise, phase, powder, octaves, ambient. Every world's.", dials: look },
  ];
}
