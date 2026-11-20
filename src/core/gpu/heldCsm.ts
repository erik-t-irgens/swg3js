// The sun's middle and far cascades held by age on WebGPU (the GPU port's pass 1, wave 3): three's `CSMShadowNode` run by
// the world's own holds (`src/world/shadowCadence.ts`, which WebGL's cascades are run by), made by `sun.ts` in place of the
// plain node.
//
// Three allows it: a cascade's `ShadowNode` draws only while its shadow's `autoUpdate` or `needsUpdate` is set, and one
// not drawn keeps its map and that map's sampling matrix (three writes `shadow.matrix` only as it draws, in
// `LightShadow.updateMatrices`, so every reader of it -- the receivers, the occlusion's cascades, the leaf cards' lookup --
// reads one held cascade whose matrix is its map's). The catch is the node's own `updateBefore`, which moves every cascade
// light inside the render, after `World.updateShadows`, once for every render the sun lights (the world pass, a doorway's,
// the weather's): a held light put back once would be moved off its map's pose again by the next render. So:
//
//   - the game's frame arms the node once (`_heldArm`, which `World.updateShadows` calls where WebGL decides);
//   - the first render after that runs three's own fit (`super.updateBefore`) and asks `ShadowHold.decide` through an
//     adapter that hands it this node's breaks, its light's direction and its reach (`decide` was written against the
//     classic `CSM`; these cascades are three's `LwLight`s, an `Object3D` with a target and a shadow, which is all it
//     reads), and `decide` writes each light's `autoUpdate` and puts each held light and target back where its map was
//     drawn, here with their world matrices;
//   - every later render that frame changes nothing, so the ages and the stagger count once a game frame however many
//     renders light with the sun; nor does a precompile (the warm-up's), where three draws no shadow;
//   - each cascade's draw is told to the hold as three makes it (`drawnOne`), by a permanent wrap of that cascade's own
//     `updateShadow` made with the node, never by the frame report's temporary wrap, which wraps round this one and puts
//     it back; and a cascade asked for and never drawn is made dirty when the frame is armed again (`undrawnDirty`).
//
// Before the first decision three's own fit runs at every render, as the plain node's did. Nothing of this allocates in a
// frame: the adapter's record is kept and written in place, the clock is kept as the frame handed it, and every count is a
// small integer. The subclass leans on the addon's method order (its `build` puts the node before its cascades' shadow
// nodes, so its `updateBefore` runs first in each render), so every method of three's it overrides or calls is held to its
// text at three's development commit (`threeAnchors.test.ts`), and `sun.ts` makes it only at that revision
// (`heldCsmApplies`). Its own fields begin with `_held`: three walks a node's own fields for child nodes and steps over a
// field whose name begins with `_`.

import * as THREE from 'three';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import type { HoldCsm, ShadowHold, ShadowMovers } from '../../world/shadowCadence.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The revision of three the subclass was read against: the development commit 577fb27 (`threeAnchors.test.ts`). */
export const HELD_CSM_REVISION = '188dev';

/** Null where the held node may be made on this revision of three, else why not, in words. */
export function heldCsmApplies(revision: string): string | null {
  return revision === HELD_CSM_REVISION ? null : `three is r${revision}, the held cascades were read against r${HELD_CSM_REVISION}: every cascade is drawn every frame until heldCsm.ts is read against it`;
}

/** What `decide` reads of this node at each decision: its breaks, its light's direction, its reach. Kept, written in place. */
class HeldView implements HoldCsm {
  breaks: readonly number[] = [];
  maxFar = 0;
  readonly lightDirection = new THREE.Vector3();
}

/** The node's own counts, for the console (`__debug.gpu().sun.hold`): small integers, so nothing is made as they rise. */
class HeldCounts {
  /** Game frames armed (`World.updateShadows` on WebGPU). */
  arms = 0;
  /** Renders that lit with the sun and reached the node, the precompiles apart. */
  renders = 0;
  /** The warm-up's precompiles that reached the node (three draws no shadow there). */
  precompiles = 0;
  /** Decisions made: one a game frame that lit with the sun. */
  decisions = 0;
  /** Each cascade's draws, as its wrap saw them. */
  readonly draws = new Uint32Array(4);
}

/** Who is told each decision's cascades drawn and holds refused (the frame report's counters). */
export type HeldCounted = (drawn: number, refused: number) => void;

export class HeldCsmShadowNode extends CSMShadowNode {
  /** The world's holds, bound to this node's cascade lights (`_heldAttach`), or null: three's own node until then. */
  _held: ShadowHold | null = null;
  /** The frame's fast movers (the world's own list, filled before `World.updateShadows`). */
  _heldMovers: ShadowMovers | null = null;
  /** Told each decision's cascades drawn and holds refused. */
  _heldCounted: HeldCounted | null = null;
  /** What `decide` reads of this node (its breaks, direction and reach), written at each decision. */
  readonly _heldView = new HeldView();
  /** The frame's clock as `_heldArm` was handed it, kept as it came, so handing it on to `decide` makes no number. */
  _heldNow: number | null = null;
  /** Set by `_heldArm`, cleared by the decision: the first render after the game's frame decides, and only it. */
  _heldArmed = false;
  /** Whether a decision has been made: before the first, three's own fit runs at every render. */
  _heldDecided = false;
  readonly _heldCounts = new HeldCounts();

  /** Three's own, then a permanent wrap of each cascade's `updateShadow`, so every draw is told as three makes it. */
  _init(o: Any): void {
    (CSMShadowNode.prototype as unknown as { _init(o: unknown): void })._init.call(this, o);
    this._heldWrap();
    if (this._held !== null) this._held.bind(this.lights as unknown as THREE.DirectionalLight[]);
  }

  /** Each cascade's shadow node's `updateShadow` wrapped once: after three's own draw, the hold is told which was drawn. */
  _heldWrap(): void {
    const nodes = (this as unknown as { _shadowNodes: Any[] })._shadowNodes ?? [];
    for (let i = 0; i < nodes.length; i++) {
      const sn = nodes[i];
      if (!sn || sn._heldWrapped === true || typeof sn.updateShadow !== 'function') continue;
      const own = sn.updateShadow;
      const index = i;
      // An own field, as the frame report's timing wrap is, which wraps round this one and puts it back.
      sn.updateShadow = (frame: Any): unknown => {
        const out = own.call(sn, frame);
        this._heldDrawn(index);
        return out;
      };
      sn._heldWrapped = true;
    }
  }

  /** Cascade `i` was drawn just now, from where its light stands. */
  _heldDrawn(i: number): void {
    if (i < 4) this._heldCounts.draws[i]++;
    const hold = this._held;
    if (hold !== null) hold.drawnOne(i);
  }

  /**
   * The world's holds handed over: bound to this node's cascade lights, every cascade dirty (drawn at the first decision),
   * with the world's list of fast movers and who counts each decision.
   */
  _heldAttach(hold: ShadowHold, movers: ShadowMovers, counted: HeldCounted | null): void {
    this._held = hold;
    this._heldMovers = movers;
    this._heldCounted = counted;
    hold.bind(this.lights as unknown as THREE.DirectionalLight[]);
    hold.dirtyAll();
    this._heldDecided = false;
    this._heldArmed = false;
  }

  /**
   * Once a game frame, where WebGL's `World.updateShadows` decides: a cascade the last decision asked for that three never
   * drew is made dirty, the frame's clock kept, and the next render that lights with the sun decides.
   */
  _heldArm(now: number): void {
    const hold = this._held;
    if (hold === null) return;
    hold.undrawnDirty();
    this._heldNow = now;
    this._heldArmed = true;
    this._heldCounts.arms++;
  }

  /** Each render that lights with the sun: the decision once a game frame, three's own fit before it, nothing after it. */
  updateBefore(frame: Any): boolean | undefined {
    const hold = this._held;
    if (hold === null) return super.updateBefore(frame);
    const counts = this._heldCounts;
    // The warm-up's precompile: three draws no shadow there (`ShadowBaseNode.updateBefore`), so nothing moves.
    if (frame && frame.renderer && frame.renderer._precompilationState != null) {
      counts.precompiles++;
      return undefined;
    }
    counts.renders++;
    if (!this._heldArmed) {
      // A later render of the same game frame: the decision stands, and every held light stays where its map was drawn.
      if (this._heldDecided) return undefined;
      // Before the first decision: three's own fit, as the plain node did.
      return super.updateBefore(frame);
    }
    this._heldArmed = false;
    super.updateBefore(frame);
    this._heldDecide(hold);
    return undefined;
  }

  /** The decision, straight after three's fit: the adapter written, `decide` asked, each held light's matrices put back. */
  _heldDecide(hold: ShadowHold): void {
    const v = this._heldView;
    v.breaks = this.breaks;
    v.maxFar = this.maxFar;
    // The direction three's fit oriented every cascade by (`_lightDirection`, from the light to its target), unnormalised:
    // `decide` works every length out by hand.
    const light = this.light as unknown as THREE.DirectionalLight;
    v.lightDirection.subVectors(light.target.position, light.position);
    const lights = this.lights as unknown as THREE.DirectionalLight[];
    const drawn = hold.decide(lights, v, this.camera as THREE.PerspectiveCamera, this._heldNow as number, this._heldMovers);
    // A held light and target are back where its map was drawn; their world matrices follow, as three's fit writes them.
    const held = hold.held;
    for (let i = 0; i < lights.length && i < held.length; i++) {
      if (held[i] !== 1) continue;
      lights[i].updateMatrixWorld();
      lights[i].target.updateMatrixWorld();
    }
    this._heldDecided = true;
    this._heldCounts.decisions++;
    const counted = this._heldCounted;
    if (counted !== null) counted(drawn, hold.refusedNow);
  }

  /** For the console (`__debug.gpu().sun.hold`): the counts, and each cascade held or not this frame and why. Allocates. */
  _heldReport(): Record<string, unknown> {
    const h = this._held;
    const c = this._heldCounts;
    const n = this.lights.length;
    return {
      by: "the world's holds (shadowCadence.ts) on three's own cascades, decided once a game frame in the first render that lights with the sun (heldCsm.ts)",
      attached: h !== null,
      armed: this._heldArmed,
      arms: c.arms,
      renders: c.renders,
      precompiles: c.precompiles,
      decisions: c.decisions,
      draws: Array.from(c.draws.subarray(0, Math.min(4, n))),
      held: h ? Array.from(h.held.subarray(0, Math.min(4, n)), (x) => x === 1) : [],
      reasons: h ? h.reason.slice(0, n) : [],
    };
  }
}
