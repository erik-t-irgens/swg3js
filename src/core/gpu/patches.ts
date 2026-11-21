// The port's four private patches of three, applied together on WebGPU (the GPU port's step 3, item 8): each only where
// three is the revision it was written for and every private method it reaches is there (`patchApplies`), each with a
// switch on by default, read at load from `localStorage['swg.gpu.patch.<name>']` ('0' leaves it off) and moved live by
// `__debug.gpu({ patches: { <name>: false } })`. What each replaces and leans on is `patchTable.ts`, which
// `gpuPatches.test.ts` holds to three's own text. The performance step's replay and pass 1's bone pool (wave 4) carry
// switches of their own, which their records here read through to.

import * as THREE from 'three';
import { PATCH_TABLE, patchApplies, type PatchEntry } from './patchTable.ts';
import { installShadowPatch, setShadowPatch, SHADOW_PATCH } from './patchShadow.ts';
import { installStillPatch, setStillPatch, STILL_PATCH } from './patchStill.ts';
import { STENCIL_PATCH, installStencilPatch } from './patchStencilBundles.ts';
import { WARM_PATCH, WARM_STATS, WARM_TUNE } from './patchWarm.ts';
import { installReplayPatch } from './patchReplay.ts';
import { DRAW_APPLIED, DRAW_COST, DRAW_STATS, setDrawSwitch } from './drawCost.ts';
import { installBonePatch, setBonePool } from './patchBones.ts';
import { BONES } from './bonePool.ts';
import { GPU_KEYS } from './gpuKeys.ts';
import { installMotionPatch } from './patchMotion.ts';
import { GPU_MOTION, MOTION } from './motion.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Name = PatchEntry['name'];

/**
 * The performance step's replay patch (`patchReplay.ts`): its switch is the step's own (`DRAW_COST.replay`, read at load
 * from `swg.gpu.draw.replay` by `readDrawSwitches`), so its record here reads through to it.
 */
const REPLAY_PATCH = {
  get on(): boolean {
    return DRAW_COST.replay;
  },
  set on(v: boolean) {
    setDrawSwitch('replay', v);
  },
  get applied(): boolean {
    return DRAW_APPLIED.replay.applied;
  },
  set applied(v: boolean) {
    DRAW_APPLIED.replay.applied = v;
  },
  get why(): string {
    return DRAW_APPLIED.replay.why;
  },
  set why(v: string) {
    DRAW_APPLIED.replay.why = v;
  },
};

/**
 * Pass 1, wave 4's bone pool (`patchBones.ts`): its switch is the wave's own (`GPU_KEYS.boneStorage`, read at load from
 * `swg.gpu.keys.boneStorage`), so its record here reads through to it and to the pool's own verdict.
 */
const BONES_PATCH = {
  get on(): boolean {
    return GPU_KEYS.boneStorage;
  },
  set on(v: boolean) {
    setBonePool(v);
  },
  get applied(): boolean {
    return BONES.applied;
  },
  set applied(v: boolean) {
    BONES.applied = v;
  },
  get why(): string {
    return BONES.why;
  },
  set why(v: string) {
    BONES.why = v;
  },
};

/**
 * Pass 1, wave 5's motion output (`patchMotion.ts`): its switch is the wave's own (`GPU_MOTION.on`, read at load from
 * `swg.gpu.motion`, read where a chain's scene target is made), so its record here reads through to it and to its verdict.
 */
const MOTION_PATCH = {
  get on(): boolean {
    return GPU_MOTION.on;
  },
  set on(v: boolean) {
    GPU_MOTION.on = v;
  },
  get applied(): boolean {
    return MOTION.applied;
  },
  set applied(v: boolean) {
    MOTION.applied = v;
  },
  get why(): string {
    return MOTION.why;
  },
  set why(v: string) {
    MOTION.why = v;
  },
};

/** Each patch's own record: its switch, whether it applied and why not. */
const STATE: Record<Name, { on: boolean; applied: boolean; why: string }> = {
  shadow: SHADOW_PATCH,
  still: STILL_PATCH,
  warm: WARM_PATCH,
  stencil: STENCIL_PATCH,
  replay: REPLAY_PATCH,
  bones: BONES_PATCH,
  motion: MOTION_PATCH,
};

function readSwitch(name: Name): boolean {
  // The replay patch's switch is the step's own, read already (`readDrawSwitches`).
  if (name === 'replay') return DRAW_COST.replay;
  // The bone pool's is the wave's own, read already (`gpuKeys.ts`).
  if (name === 'bones') return GPU_KEYS.boneStorage;
  // The motion output's is wave 5's own, read already (`motion.ts`).
  if (name === 'motion') return GPU_MOTION.on;
  try {
    return localStorage.getItem(`swg.gpu.patch.${name}`) !== '0';
  } catch {
    return true;
  }
}

/**
 * Every patch that may apply, applied (the warm-up is installed by the runtime itself, `installWarm`, once it has its
 * dependencies: here only its switch and verdict are set). Answers nothing: each record says what came of it.
 */
export function applyPatches(renderer: Any): void {
  for (const e of PATCH_TABLE) {
    const st = STATE[e.name];
    st.on = readSwitch(e.name);
    const why = patchApplies(e.name, THREE.REVISION, renderer);
    if (why) {
      st.applied = false;
      st.why = why;
      continue;
    }
    if (e.name === 'shadow') installShadowPatch(renderer);
    else if (e.name === 'still') installStillPatch(renderer);
    else if (e.name === 'stencil') installStencilPatch(renderer);
    else if (e.name === 'warm') WARM_PATCH.applied = true;
    else if (e.name === 'replay') installReplayPatch(renderer);
    else if (e.name === 'bones') installBonePatch(renderer);
    else if (e.name === 'motion') installMotionPatch(renderer);
    st.why = '';
  }
}

/** A switch moved live (the console). Answers the switch as it stands. */
export function setPatch(name: Name, on: boolean): boolean {
  if (name === 'shadow') setShadowPatch(on);
  else if (name === 'still') setStillPatch(on);
  else STATE[name].on = on;
  return STATE[name].on;
}

export function isPatchName(n: string): n is Name {
  return n === 'shadow' || n === 'still' || n === 'warm' || n === 'stencil' || n === 'replay' || n === 'bones' || n === 'motion';
}

/** What `__debug.gpu()` says of the patches. */
export function patchReport(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const e of PATCH_TABLE) {
    const st = STATE[e.name];
    out[e.name] = {
      on: st.on,
      applied: st.applied,
      ...(st.why ? { why: st.why } : {}),
      does: e.does,
      replaces: e.replaces.map((m) => `${m.cls}.${m.method}`),
      switch: `__debug.gpu({ patches: { ${e.name}: false } }), or localStorage['swg.gpu.patch.${e.name}'] = '0' and a reload`,
    };
  }
  (out.shadow as Record<string, unknown>).told = SHADOW_PATCH.told;
  (out.shadow as Record<string, unknown>).opaqueCastersPlain = SHADOW_PATCH.plainCasters;
  (out.still as Record<string, unknown>).told = STILL_PATCH.told;
  (out.stencil as Record<string, unknown>).bundles = { recorded: STENCIL_PATCH.recorded, run: STENCIL_PATCH.run, mixedReferences: STENCIL_PATCH.mixed };
  (out.warm as Record<string, unknown>).stats = { ...WARM_STATS, listMs: Math.round(WARM_STATS.listMs), buildMs: Math.round(WARM_STATS.buildMs), longestItemMs: Number(WARM_STATS.longestItemMs.toFixed(1)), lastInPlay: [...WARM_STATS.lastInPlay] };
  (out.warm as Record<string, unknown>).tune = { ...WARM_TUNE };
  (out.replay as Record<string, unknown>).switch = "__debug.gpu({ draw: { replay: false } }), or localStorage['swg.gpu.draw.replay'] = '0' and a reload";
  (out.replay as Record<string, unknown>).stats = { asked: DRAW_STATS.replayAsked, skipped: DRAW_STATS.replaySkipped, fullReplays: DRAW_STATS.replayFull };
  (out.bones as Record<string, unknown>).switch = "__debug.gpu({ bones: false }) live, or localStorage['swg.gpu.keys.boneStorage'] = '0' and a reload (the pool itself: __debug.gpu().bones)";
  (out.motion as Record<string, unknown>).switch = "__debug.gpu({ motion: false }) live (the effects chain made again), or localStorage['swg.gpu.motion'] = '0' and a reload (the output itself: __debug.gpu().motion)";
  return out;
}
