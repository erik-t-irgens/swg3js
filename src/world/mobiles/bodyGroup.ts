// A body's root that the scene's one matrix walk a frame can step over (the performance pass's third wave).
//
// Three's `Object3D.updateMatrixWorld` recomposes every node and recurses into every child whatever its `visible`, so a
// body nobody draws -- about 48 bones, ten skinned meshes and seven groups -- was walked every frame for nothing, and so
// was every body standing still between two runs of its mixer, whose world matrices are a pure function of locals and a
// root that have not changed. Two skips, each a frame-report switch whose first value is the old way:
//
// - **culled** (`walkSkip`): the manager's whole cull says the body is not drawn (set beside `group.visible`, never the
//   portal renderer's per-pass routing, which hides a body before the first pass walks and would leave a body indoors a
//   frame stale). Its own matrix is composed and nothing under it is walked; the next walk after it is a whole one.
//   Mobiles and fighters alike: a culled body is undrawn whoever poses it.
// - **still** (`walkStill`): nothing has posed any node under the body since its last whole walk (`posed()` clears
//   `still`, a whole walk sets it) and its world matrix is the very one that walk left, sixteen numbers compared after
//   its own matrix is composed. Only a body that marks every write under it may be skipped so (`marksPoses`): a
//   catalogue mobile, whose every writer of a position, a turn or a scale under `src/world/mobiles/` calls
//   `Mobile.posed()` (held by `walkSkip.test.ts`). A fighter is posed by the player's rig and arithmetic outside that
//   folder, and is never skipped as still.
//
// The skip happens only when the walk reaches the body through its parent. Anything that needs the whole subtree now
// calls `walkWhole()` (a ragdoll built from the pose, a weapon hung in a hand), and a reader of one bone or hardpoint
// works its own matrix out through `updateWorldMatrix(true, false)`, which this never touches.
//
// Plain fields, set in the constructor in one order (the stencil lesson: nothing here defines an accessor), and
// nothing made on a frame. Run by node for the tests: value imports carry `.ts`.
import * as THREE from 'three';

/** The two switches (`perf({ ab: { key: 'walkSkip' } })`, `'walkStill'`): false walks every body as three would. */
export const BODY_WALK = { culled: true, still: true };

/**
 * What the walks did, counted as they go: this frame's so far, and the last frame's once `endBodyWalkFrame` has rolled
 * them (the frame loop does, after its draw). A body walked twice in a frame (the passes walking every pass) counts twice.
 */
export const BODY_WALK_STATS = { walked: 0, culled: 0, still: 0, lastWalked: 0, lastCulled: 0, lastStill: 0 };

/** The frame's counts become the last frame's, and the next frame counts from nought. */
export function endBodyWalkFrame(): void {
  const s = BODY_WALK_STATS;
  s.lastWalked = s.walked;
  s.lastCulled = s.culled;
  s.lastStill = s.still;
  s.walked = 0;
  s.culled = 0;
  s.still = 0;
}

export class BodyGroup extends THREE.Group {
  /** The manager's whole cull: true while the body is not drawn at all (its group's `visible` false by the manager). */
  culled: boolean;
  /** True while nothing has posed a node under it since its last whole walk; `posed()` makes it false. */
  still: boolean;
  /** Whether every write under it calls `posed()`, which is what `still` needs to mean anything. */
  readonly marksPoses: boolean;
  /** Whether `kept` holds the world matrix a whole walk left (false once a skip as culled let the subtree go stale). */
  private whole: boolean;
  /** That world matrix, element for element. */
  private readonly kept: Float64Array;

  constructor(marksPoses = false) {
    super();
    this.culled = false;
    this.still = false;
    this.marksPoses = marksPoses;
    this.whole = false;
    this.kept = new Float64Array(16);
  }

  /** Something under it was written: its next walk is a whole one. */
  posed(): void {
    this.still = false;
  }

  /** The whole subtree worked out now, whatever the skips say (three's own walk, forced). */
  walkWhole(): void {
    super.updateMatrixWorld(true);
    this.keep();
  }

  override updateMatrixWorld(force?: boolean): void {
    const w = BODY_WALK;
    if (w.culled && this.culled) {
      this.ownMatrix();
      this.whole = false;
      BODY_WALK_STATS.culled++;
      return;
    }
    if (w.still && this.still && this.marksPoses && this.whole) {
      this.ownMatrix();
      if (this.sameAsKept()) {
        BODY_WALK_STATS.still++;
        return;
      }
    }
    super.updateMatrixWorld(force);
    this.keep();
  }

  /** Its own matrix and world matrix, as three's walk composes them, and nothing under it. */
  private ownMatrix(): void {
    if (this.matrixAutoUpdate) this.updateMatrix();
    if (this.matrixWorldAutoUpdate) {
      if (this.parent === null) this.matrixWorld.copy(this.matrix);
      else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
    }
    this.matrixWorldNeedsUpdate = false;
  }

  /** A whole walk has run: its world matrix kept, and it is still until something poses it. */
  private keep(): void {
    const e = this.matrixWorld.elements;
    const k = this.kept;
    for (let i = 0; i < 16; i++) k[i] = e[i];
    this.whole = true;
    this.still = true;
    BODY_WALK_STATS.walked++;
  }

  private sameAsKept(): boolean {
    const e = this.matrixWorld.elements;
    const k = this.kept;
    for (let i = 0; i < 16; i++) if (e[i] !== k[i]) return false;
    return true;
  }
}
