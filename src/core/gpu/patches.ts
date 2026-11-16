// The port's four private patches of three, applied together on WebGPU (the GPU port's step 3, item 8): each only where
// three is the revision it was written for and every private method it reaches is there (`patchApplies`), each with a
// switch on by default, read at load from `localStorage['swg.gpu.patch.<name>']` ('0' leaves it off) and moved live by
// `__debug.gpu({ patches: { <name>: false } })`. What each replaces and leans on is `patchTable.ts`, which
// `gpuPatches.test.ts` holds to three's own text.

import * as THREE from 'three';
import { PATCH_TABLE, patchApplies, type PatchEntry } from './patchTable.ts';
import { installShadowPatch, setShadowPatch, SHADOW_PATCH } from './patchShadow.ts';
import { installStillPatch, setStillPatch, STILL_PATCH } from './patchStill.ts';
import { STENCIL_PATCH, installStencilPatch } from './patchStencilBundles.ts';
import { WARM_PATCH, WARM_STATS, WARM_TUNE } from './patchWarm.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Name = PatchEntry['name'];

/** Each patch's own record: its switch, whether it applied and why not. */
const STATE: Record<Name, { on: boolean; applied: boolean; why: string }> = {
  shadow: SHADOW_PATCH,
  still: STILL_PATCH,
  warm: WARM_PATCH,
  stencil: STENCIL_PATCH,
};

function readSwitch(name: Name): boolean {
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
  return n === 'shadow' || n === 'still' || n === 'warm' || n === 'stencil';
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
  return out;
}
