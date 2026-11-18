// The performance step's `replay` (`drawCost.ts`), a fifth private patch of three's WebGPU renderer (`patchTable.ts`), on
// WebGPU alone and only where `patchApplies` says three is the revision it was written for.
//
// Three replays a render bundle by asking its node manager, for every render object the bundle holds, whether that object
// needs refreshing (`needsRefresh`), and refreshes what it is told to. For a bundle three keeps static (every one the port
// makes), whose version, render target and attributes have not moved, the answer for an object three does not refresh in
// full on every draw (no node of its own, not skinned, its copies not dynamic, no velocity being written) can only be
// "nothing", or "the shared buffers" for the first object of its program in this render. So once a bundle's replay has asked
// about every object and been told none needed a full refresh, the next replays ask only where the answer could differ:
// the object whose program has not yet been refreshed in this render, and any object three refreshes in full whatever.
// Everything three is asked is answered by three, and nothing it would refresh is stepped over, so the draws, their
// uniforms and the bundle's content are what they were; what is saved is the asking.
//
// Two of three's methods are wrapped on the live renderer, never on a prototype, and neither is copied: `_renderBundle`,
// round each call (to learn whether this call replays or records, and to keep the bundle's record of its last clean
// replay), and `NodeManager.needsRefresh`, which answers "nothing" itself only inside a clean replay and only for an object
// of that bundle whose program three has already refreshed in this render. A shadow pass drawn from inside a replay (the
// sun's cascades, from the first object that reads them) replays bundles of its own: the replays nest, each on a stack.
//
// Its switch (`DRAW_COST.replay`, `gpu({ draw: { replay: false } })`, `localStorage['swg.gpu.draw.replay'] = '0'` at load)
// is live: off, three is asked about every object, as before.

import { DRAW_APPLIED, DRAW_COST, DRAW_STATS } from './drawCost.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Three's `DynamicDrawUsage`: an instanced mesh whose copies carry it is refreshed in full on every draw. */
const DYNAMIC_DRAW = 35048;

/** One replay in progress: the bundle group, whether it is a clean one, and whether a full refresh was met. */
interface Frame {
  group: Any;
  skip: boolean;
  renderId: number;
  /** A full refresh met that three's own flags do not explain (the record of a clean replay is then not written). */
  dirty: boolean;
}

/** The record a bundle's data keeps of its last clean replay: what it depended on then. */
interface Clean {
  /** False once the bundle was found not clean (the record is kept, so a bundle going clean again makes nothing). */
  ok: boolean;
  dispose: number;
  target: Any;
  version: number;
}

export function installReplayPatch(renderer: Any): void {
  const nodes = renderer._nodes;
  const attributes = renderer._attributes;
  const stack: Frame[] = [];
  let depth = 0;
  const pool: Frame[] = [];

  /** Whether three refreshes this object in full at every draw whatever moved (its program's flags and its own copies). */
  const flagged = (m: Any, o: Any): boolean => m === null || m === undefined || m.hasNode === true || m.hasAnimation === true || (o.isInstancedMesh === true && (o.instanceMatrix.usage === DYNAMIC_DRAW || (o.instanceColor !== null && o.instanceColor.usage === DYNAMIC_DRAW)));

  const askOrig = nodes.needsRefresh;
  nodes.needsRefresh = function (this: Any, ro: Any): number {
    if (depth > 0) {
      const f = stack[depth - 1];
      if (ro.bundle === f.group) {
        const m = ro._monitor;
        if (f.skip && m !== null && m !== undefined && m.renderId === f.renderId && !flagged(m, ro.object)) {
          DRAW_STATS.replaySkipped++;
          return 0;
        }
        DRAW_STATS.replayAsked++;
        const r = askOrig.call(this, ro);
        // A full refresh, or an object three refreshes in full whatever (its record is then not kept up by three, so a
        // flag that later turns off must find the bundle not clean): no record of a clean replay is written.
        if (r === 2 || flagged(ro._monitor, ro.object)) f.dirty = true;
        return r;
      }
    }
    return askOrig.call(this, ro);
  };

  const replayOrig = renderer._renderBundle;
  renderer._renderBundle = function (this: Any, bundle: Any, sceneRef: Any, lightsNode: Any): void {
    if (!DRAW_COST.replay) return replayOrig.call(this, bundle, sceneRef, lightsNode);
    const group = bundle.bundleGroup;
    const ctx = this._currentRenderContext;
    const rb = this._bundles.get(group, bundle.camera, ctx);
    const data = this.backend.get(rb);
    // Asked before three asks it: a bundle that will be recorded again is left to three whole (its objects are refreshed by
    // their draws). Asked twice in a row it answers the same, the first asking taking whatever it moves.
    if (this._bundleNeedsUpdate(group, data)) {
      if (data.__swgClean) data.__swgClean.ok = false;
      return replayOrig.call(this, bundle, sceneRef, lightsNode);
    }
    const target = this.getRenderTarget() ?? (this.getOutputRenderTarget() || this.getCanvasTarget());
    const mrt = this.getMRT();
    const c: Clean | null | undefined = data.__swgClean;
    const f = pool[depth] ?? (pool[depth] = { group: null, skip: false, renderId: 0, dirty: false });
    f.group = group;
    f.renderId = nodes.nodeFrame.renderId;
    f.dirty = false;
    f.skip = c !== null && c !== undefined && c.ok && group.static === true && c.dispose === attributes.disposeVersion && c.target === target && c.version === group.version && !(mrt !== null && mrt.has('velocity'));
    stack[depth++] = f;
    try {
      replayOrig.call(this, bundle, sceneRef, lightsNode);
    } finally {
      depth--;
      stack[depth] = null as unknown as Frame;
    }
    if (f.skip) return;
    DRAW_STATS.replayFull++;
    // A replay that asked about every object and found none in need of a full refresh: the next may ask less.
    if (f.dirty || group.static !== true) {
      if (c) c.ok = false;
    } else {
      const k: Clean = c ?? (data.__swgClean = { ok: false, dispose: 0, target: null, version: 0 });
      k.ok = true;
      k.dispose = attributes.disposeVersion;
      k.target = target;
      k.version = group.version;
    }
  };
  DRAW_APPLIED.replay = { applied: true, why: '' };
}
