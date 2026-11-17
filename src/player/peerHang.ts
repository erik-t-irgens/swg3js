// Another player's figure hanging from a ledge (wave 4 of the animations): their game holds the lip and sends only its
// rig state (`hangBraced`, `shimmyFreeL`, `climbUpBraced` and the rest, src/player/ledge.ts) with the place their body
// hangs at, and this side draws the same clip there, lined up as their own game lines it up (each clip authored at a
// height of its own: the offset of their figure's origin against their body is worked out from the clip alone, as the
// hang place puts it), and, within `ik.peerReach` of the camera, puts its hands on a lip found here in front of where
// their figure hangs (`LedgeHang.peerLip`), its feet on the wall while braced, by the same two-bone solve as this player's
// own (src/player/limbPlace.ts). Where no lip is found the hands are as the clip has them.
//
// Nothing is made on a frame; the lip's two rays are cast only while their figure moves.

import * as THREE from 'three';
import { LedgeHang, type LedgeWorld } from './ledge.ts';
import { LimbPlace, type LimbRig, type LimbWorld } from './limbPlace.ts';
import { LEDGE_FACTS, LEDGE_REST, LEDGE_ROLES, type LedgeClipFacts } from '../anim/ledgeClips.ts';
import type { RAPIER } from '../core/physics.ts';
import { restWorld, type TargetSkeleton } from '../anim/fit.ts';

/** The hang states and the clip each plays (as `STATE_CLIPS` lists it first), braced or free, and whether it is the climb. */
const HANG_STATES: Readonly<Record<string, { clip: string; braced: boolean; climb: boolean }>> = {
  hangBraced: { clip: LEDGE_ROLES.braced.idle, braced: true, climb: false },
  hangFree: { clip: LEDGE_ROLES.free.idle, braced: false, climb: false },
  shimmyBracedL: { clip: LEDGE_ROLES.braced.shimmyLeft, braced: true, climb: false },
  shimmyBracedR: { clip: LEDGE_ROLES.braced.shimmyRight, braced: true, climb: false },
  shimmyFreeL: { clip: LEDGE_ROLES.free.shimmyLeft, braced: false, climb: false },
  shimmyFreeR: { clip: LEDGE_ROLES.free.shimmyRight, braced: false, climb: false },
  climbUpBraced: { clip: LEDGE_ROLES.braced.climb, braced: true, climb: true },
  climbUpFree: { clip: LEDGE_ROLES.free.climb, braced: false, climb: true },
};

/** Whether a rig state is one of the ledges' (every one the peers' list must know). */
export function isHangState(state: string): boolean {
  return Object.prototype.hasOwnProperty.call(HANG_STATES, state);
}

/** A figure's size against the human male's (its hips' rest height over his 1.002 m, times its own scale), kept a skeleton. */
const HIPS = new WeakMap<object, number>();
export function figureScaleOf(rig: { readonly root: THREE.Object3D; restSkeleton(): TargetSkeleton }): number {
  const skel = rig.restSkeleton();
  let k = HIPS.get(skel);
  if (k === undefined) {
    k = 1;
    const at = skel.joints.findIndex((j) => j.name === 'root');
    if (at >= 0) {
      const y = restWorld(skel).p[at * 3 + 1];
      if (y > 0.2) k = y / LEDGE_REST.hips;
    }
    HIPS.set(skel, k);
  }
  return k * rig.root.scale.y;
}

/** A clip's grip over its own feet at its start, human male metres. */
function hangOver(f: LedgeClipFacts): number {
  return f.g0[1] - (f.a0 - LEDGE_REST.ankle);
}

/** A frame of their figure as the hang reads it (fields, so no number crosses a call): written by the caller. */
export class PeerHangIn {
  /** Their rig state ('' for none of the ledges'). */
  state = '';
  /** Where their figure is drawn and which way it faces (its group's place and heading). */
  x = 0.5;
  y = 0.5;
  z = 0.5;
  heading = 0.5;
  /** Their figure's size against the human male (`figureScaleOf`). */
  scale = 0.5;
  /** The groups the rays cast in. */
  filter = 0.5;
  /** Within `ik.peerReach` of the camera (the hands and feet placed only there). */
  near = false;
  dt = 0.5;
  constructor() {
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.heading = 0;
    this.scale = 1;
    this.filter = 0;
    this.dt = 0;
  }
}

export class PeerHang {
  readonly ledge: LedgeHang;
  readonly limbs: LimbPlace;
  /** The root's offset put on last frame (taken back off before anything writes the root again, `undo`). */
  private onY = 0.5;
  private rooted = false;
  /** The state and how long it has stood (a climb's offset runs from its hands to its feet over the clip's own time). */
  private state = '';
  private time = 0.5;
  /** The frame's seconds as a record (what the ledge's ease reads). */
  private readonly clock = { dt: 0.5 };

  /** `limbs`: the figure's one limbs' solve, where the caller keeps one a figure (maker B's wall and bracing share it: a rig has one hook). */
  constructor(makeRay: () => RAPIER.Ray, makeCapsule: (h: number, r: number) => RAPIER.Shape, limbs: LimbPlace | null = null) {
    this.ledge = new LedgeHang({ ray: makeRay, capsule: makeCapsule });
    this.limbs = limbs ?? new LimbPlace(makeRay);
    this.onY = 0;
    this.time = 0;
  }

  /** The offset put on the root last frame taken back off (before the swim's sink and the feet's drop write it again). */
  undo(root: THREE.Object3D): void {
    if (!this.rooted) return;
    root.position.x = 0;
    root.position.z = 0;
    root.position.y -= this.onY;
    if (this.tilted) root.quaternion.set(0, 0, 0, 1);
    this.tilted = false;
    this.onY = 0;
    this.rooted = false;
  }

  /** The root turned with a sloping lip last frame (put back upright by `undo`). */
  private tilted = false;

  /**
   * A frame of their figure, after it is posed and placed: the root's offset for the hang's clip, and within reach its hands
   * on a lip found here and its feet on the wall (`q`: their rig state, place, heading and size, the camera's reach).
   */
  step(rig: LimbRig, world: (LedgeWorld & LimbWorld) | null, q: PeerHangIn): void {
    const state = q.state;
    const h = HANG_STATES[state];
    this.clock.dt = q.dt;
    if (state !== this.state) {
      this.state = state;
      this.time = 0;
    } else this.time += q.dt;
    const L = this.ledge;
    if (!h) {
      if (L.hands > 0 || L.feet > 0) L.easeShares(0, 0, this.clock);
      if (!this.limbs.busy) return;
    }
    const s = q.scale;
    if (h) {
      // Where their figure's origin is drawn against their body: the clip's hands where the idle's are (the hang place's own
      // rule), a climb's run from that to its feet on the body's over its own time.
      const idle = LEDGE_FACTS[h.braced ? LEDGE_ROLES.braced.idle : LEDGE_ROLES.free.idle];
      const f = LEDGE_FACTS[h.clip];
      let oy = (hangOver(idle) - f.g0[1]) * s;
      let oz = (idle.g0[2] - f.g0[2]) * s;
      if (h.climb) {
        const u = f.dur > 0 ? Math.min(1, this.time / f.dur) : 1;
        oy += ((LEDGE_REST.ankle - f.a1) * s - oy) * u;
        oz -= oz * u;
      }
      rig.root.position.x = 0;
      rig.root.position.y += oy;
      rig.root.position.z = oz;
      this.onY = oy;
      this.rooted = true;
    }
    if (!world) return;
    const found = !!h && !h.climb && q.near && L.peerLip(world, q, h.braced);
    L.easeShares(found ? 1 : 0, found && h!.braced ? 1 : 0, this.clock);
    // Turned with a sloping lip found under their hands, as this side's own hang is (the fix round's), on their clip's grip.
    if (found && L.tilt !== 0) {
      L.rigClip = h!.clip;
      L.applyTilt(rig.root);
      this.onY += L.tiltLift;
      this.tilted = true;
    }
    if (L.hands === 0 && L.feet === 0 && !this.limbs.busy) return;
    rig.root.updateMatrixWorld(true);
    // The hands' anchor lifts the root too (taken back off with the offset).
    L.limbsFor(this.limbs, rig, null);
    const lift = L.lifted;
    if (lift !== 0) {
      this.onY += lift;
      this.rooted = true;
    }
    this.limbs.filter = q.filter;
    this.limbs.place(rig, world, null);
  }
}
