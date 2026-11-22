// A space zone's distant particle systems (the GPU port's pass 2, wave 3; the design's 2.9 and 2.12: Kessel's Maw). The
// converter reads them off the zone's terrain file (`parseSpaceDistant` in `tools/swg/space.mjs`) and writes each into the
// pack's `distant` list in the game's frame: the effect it plays, where it stands, its turn, and whether it rides with the
// camera ("infinite", as the sky does: Kessel's three black holes and every star field) or stands in the world (Kashyyyk's
// exploding asteroid). This file reads that list into what the game places and moves: which systems are drawn, at what size
// and how far they are kept running (`distantPlan`), and each one's matrix a frame (`distantMatrixInto`), through the game's
// own particle effects (`ParticleEffects.place`, `move`, `resize`, `remove`), which on WebGPU already draw through the eye.
//
// Everything is prepared while the loading screen is up (`DistantSet.build`: each effect's batches made hidden, its textures
// uploaded), so the warm-up builds every pipeline before the screen goes and nothing is made on a live frame; the frame moves
// the riding ones by writing three numbers into a kept matrix each and allocates nothing. The world draws them on WebGPU
// alone (WebGL keeps today's sky until the pass's close-out).
import * as THREE from 'three';
import type { DistantSystem, SpacePack } from './spaceData.ts';

/**
 * The dials, every one ours (the files say where each system stands and how it turns, nothing about how far it is drawn):
 *   - `on` true: draw them at all. Live: off takes the placed effects out, on places them again from what was prepared.
 *   - `starfields` false: also draw the client's particle star fields (`pt_starfield_*`, six or seven a zone in nine zones),
 *     which the brief did not ask for and nobody has seen beside the zone's own star field and star sprites, which already
 *     draw the stars; the owner's to switch on. Spent at the next zone's load, where their programs are prepared.
 *   - `pullTo` 6000 m: a system that rides with the camera stands 140 to 450 m off in the file (Kessel's black holes), so
 *     a station a kilometre away would be drawn behind it; it is pulled out to this distance and scaled by the same ratio,
 *     so it covers exactly the file's angle and stands behind every ship and station nearer, as the sky does. 6000 m is the
 *     nebulae's own pull (`NEBULA_TUNE.pullFrom`), inside the planets' depth at 7.5 km and with room for the black holes'
 *     reach under the 9 km far plane. 0 draws each at the file's own place. Live.
 *   - `keepWithin` 12000 m: how far off a system is kept running and drawn (the game's effects sleep 240 m out, which would
 *     put a pulled-out black hole and Kashyyyk's asteroid, 570 m round, to sleep at once): past the 9 km far plane.
 *     Spent where each is placed.
 */
export const DISTANT_TUNE = { on: true, starfields: false, pullTo: 6000, keepWithin: 12000 };

/** What is spent when a zone's systems are placed, not live: answered as the next zone's. */
export const DISTANT_BUILD_ONLY: readonly string[] = ['starfields', 'keepWithin'];

/** How far one of the game's effects is drawn and kept running before its handle's reach multiplies it (`particles.ts`'s `GLOBAL_LOD`). */
export const EFFECT_SLEEP_METRES = 200;

/** One system as the world places it: the pack's entry, its file, the size its emitters are scaled by and its handle's reach. */
export interface DistantPlaced {
  readonly entry: DistantSystem;
  readonly file: string;
  /** The ratio it is pulled out by (1 standing, or at the file's own place). */
  size: number;
  /** Its handle's reach (`EffectHandle.reach`): how far it is kept running, over the game's 200 m. */
  readonly reach: number;
  /** How far the file puts it from the camera (riding) or from the world's middle (standing), in metres. */
  readonly offset: number;
}

/** The ratio a riding system is pulled out by: to `pullTo` where the file puts it nearer, never in; 1 for a standing one or with the pull off. */
export function pullOf(entry: DistantSystem, pullTo: number): number {
  if (!entry.infinite || !(pullTo > 0)) return 1;
  const d = Math.sqrt(entry.at[0] * entry.at[0] + entry.at[1] * entry.at[1] + entry.at[2] * entry.at[2]);
  return d > 1e-3 && d < pullTo ? pullTo / d : 1;
}

/**
 * Which of a pack's systems the world places, and how: every one whose effect converted, the star fields only where the dial
 * asks, nothing with the dial off. An older pack (no `distant`) places nothing.
 */
export function distantPlan(pack: Pick<SpacePack, 'distant'> | null, tune: typeof DISTANT_TUNE = DISTANT_TUNE): DistantPlaced[] {
  const out: DistantPlaced[] = [];
  if (!pack || !tune.on) return out;
  const reach = Math.max(1, tune.keepWithin / EFFECT_SLEEP_METRES);
  for (const entry of pack.distant ?? []) {
    if (!entry || typeof entry.file !== 'string' || !entry.file) continue;
    if (entry.kind === 'starfield' && !tune.starfields) continue;
    if (!Array.isArray(entry.at) || entry.at.length !== 3 || !Array.isArray(entry.basis) || entry.basis.length !== 9) continue;
    const offset = Math.sqrt(entry.at[0] * entry.at[0] + entry.at[1] * entry.at[1] + entry.at[2] * entry.at[2]);
    out.push({ entry, file: entry.file, size: pullOf(entry, tune.pullTo), reach, offset });
  }
  return out;
}

/**
 * A system's world matrix this frame, written into `out` (a `THREE.Matrix4`'s `elements`, by columns): its turn, and its
 * place -- the eye plus its place times its pull where it rides with the camera, its place where it stands. The matrix carries
 * no scale (a handle's size does: a scale in the matrix is half applied). Allocates nothing.
 */
export function distantMatrixInto(p: DistantPlaced, eye: { x: number; y: number; z: number }, out: Float32Array | number[]): void {
  const b = p.entry.basis;
  const a = p.entry.at;
  out[0] = b[0];
  out[1] = b[3];
  out[2] = b[6];
  out[3] = 0;
  out[4] = b[1];
  out[5] = b[4];
  out[6] = b[7];
  out[7] = 0;
  out[8] = b[2];
  out[9] = b[5];
  out[10] = b[8];
  out[11] = 0;
  if (p.entry.infinite) {
    const k = p.size;
    out[12] = eye.x + a[0] * k;
    out[13] = eye.y + a[1] * k;
    out[14] = eye.z + a[2] * k;
  } else {
    out[12] = a[0];
    out[13] = a[1];
    out[14] = a[2];
  }
  out[15] = 1;
}

/** What a set of systems needs from the world: its particle effects, as `ParticleEffects` has them (a stand-in in the node test). */
export interface DistantDeps {
  prepare(file: string): Promise<unknown>;
  place(file: string, matrix: THREE.Matrix4, options: { reach: number; size: number }): unknown;
  move(handle: unknown, matrix: THREE.Matrix4): void;
  resize(handle: unknown, size: number): void;
  remove(handle: unknown): void;
}

/**
 * A zone's placed systems: prepared and placed behind the loading screen (`build`), the riding ones moved with the camera
 * each frame (`frame`), and taken out with the zone (`dispose`). The pull and the switch are live (`retune`).
 */
export class DistantSet {
  readonly placed: DistantPlaced[];
  private readonly handles: unknown[] = [];
  private readonly deps: DistantDeps;
  /** The one matrix every move is written through, made once. */
  private readonly m = new THREE.Matrix4();
  /** Whether the placed effects stand (the `on` dial). */
  private shown = false;
  private readonly lastEye = { x: 0, y: 0, z: 0 };
  /** Riding systems, by index into `placed`, so the frame walks only those. */
  private readonly riding: number[] = [];
  /** The pull the sizes were worked for, so a moved dial resizes once. */
  private pulledTo: number;

  private constructor(deps: DistantDeps, placed: DistantPlaced[]) {
    this.deps = deps;
    this.placed = placed;
    for (let i = 0; i < placed.length; i++) if (placed[i].entry.infinite) this.riding.push(i);
    this.pulledTo = DISTANT_TUNE.pullTo;
  }

  /**
   * The pack's systems prepared (each effect's batches and textures, so the warm-up builds them behind the screen) and placed
   * at `eye`; null where there are none to draw, or the load was dropped meanwhile (`stillWanted`).
   */
  static async build(deps: DistantDeps, pack: Pick<SpacePack, 'distant'> | null, eye: { x: number; y: number; z: number }, stillWanted: () => boolean): Promise<DistantSet | null> {
    const plan = distantPlan(pack);
    if (!plan.length) return null;
    const files = new Set<string>();
    for (const p of plan) files.add(p.file);
    for (const f of files) {
      await deps.prepare(f);
      if (!stillWanted()) return null;
    }
    const set = new DistantSet(deps, plan);
    set.show(eye);
    return set;
  }

  /** Every system placed where it stands now (from what was prepared at load: nothing new to build). */
  private show(eye: { x: number; y: number; z: number }): void {
    if (this.shown) return;
    this.shown = true;
    const e = this.m.elements;
    for (const p of this.placed) {
      distantMatrixInto(p, eye, e);
      this.handles.push(this.deps.place(p.file, this.m, { reach: p.reach, size: p.size }));
    }
    this.lastEye.x = eye.x;
    this.lastEye.y = eye.y;
    this.lastEye.z = eye.z;
  }

  /** Every placed effect taken out (its particles go with it). */
  private hide(): void {
    if (!this.shown) return;
    this.shown = false;
    for (const h of this.handles) if (h) this.deps.remove(h);
    this.handles.length = 0;
  }

  /** Once a frame: each system that rides with the camera moved with it. Allocates nothing. */
  frame(eye: { x: number; y: number; z: number }): void {
    if (!this.shown) return;
    this.lastEye.x = eye.x;
    this.lastEye.y = eye.y;
    this.lastEye.z = eye.z;
    const e = this.m.elements;
    const r = this.riding;
    for (let i = 0; i < r.length; i++) {
      const k = r[i];
      const h = this.handles[k];
      if (!h) continue;
      distantMatrixInto(this.placed[k], eye, e);
      this.deps.move(h, this.m);
    }
  }

  /** The live dials read again: the switch shows or hides them, a moved pull resizes and moves the riding ones. */
  retune(): void {
    if (!DISTANT_TUNE.on) {
      this.hide();
      return;
    }
    if (DISTANT_TUNE.pullTo !== this.pulledTo) {
      this.pulledTo = DISTANT_TUNE.pullTo;
      for (let i = 0; i < this.placed.length; i++) {
        const p = this.placed[i];
        p.size = pullOf(p.entry, this.pulledTo);
        const h = this.handles[i];
        if (h && p.entry.infinite) this.deps.resize(h, p.size);
      }
    }
    if (!this.shown) this.show(this.lastEye);
    else this.frame(this.lastEye);
  }

  /** What the console says. */
  report(): Record<string, unknown> {
    return {
      shown: this.shown,
      systems: this.placed.map((p) => ({
        appearance: p.entry.appearance,
        kind: p.entry.kind,
        rides: p.entry.infinite,
        at: p.entry.at,
        turn: p.entry.turn,
        offset: Math.round(p.offset),
        pulledOutBy: Math.round(p.size * 100) / 100,
        standsAt: Math.round(p.offset * (p.entry.infinite ? p.size : 1)),
      })),
    };
  }

  /** Taken out with the zone. */
  dispose(): void {
    this.hide();
  }
}

/** The zone's set while there is one, for the console. */
let current: DistantSet | null = null;

/** The world's set of the zone (null when it goes). */
export function setDistantCurrent(set: DistantSet | null): void {
  current = set;
}

/**
 * `__debug.distant()` says what the zone has placed; `__debug.distant({ pullTo: 0 })` (and every name in `DISTANT_TUNE`)
 * moves a dial, the live ones at once and the rest at the next zone (`atNextZone`); `line` is the one to paste back.
 */
const distantHook = (opts?: Partial<typeof DISTANT_TUNE>): Record<string, unknown> => {
  const later: string[] = [];
  if (opts && typeof opts === 'object') {
    for (const [key, value] of Object.entries(opts)) {
      if (!(key in DISTANT_TUNE) || typeof value !== typeof (DISTANT_TUNE as Record<string, unknown>)[key]) continue;
      if (typeof value === 'number' && !(value >= 0 && Number.isFinite(value))) continue;
      (DISTANT_TUNE as Record<string, unknown>)[key] = value;
      if (DISTANT_BUILD_ONLY.includes(key)) later.push(key);
    }
    current?.retune();
  }
  return {
    ...(current ? current.report() : { systems: [], note: 'no distant particle systems here: a space zone converted with them (the space command since pass 2, wave 3) and drawn on WebGPU has them' }),
    tune: { ...DISTANT_TUNE },
    line: `__debug.distant(${JSON.stringify(DISTANT_TUNE)})`,
    ...(later.length ? { atNextZone: later.join(', ') } : {}),
  };
};

/** Put the hook on `__debug` unless it is there (the game makes its `__debug` in one go at startup, so this runs at each zone's load too). */
export function installDistantDebug(): void {
  if (typeof window === 'undefined') return;
  const holder = window as unknown as { __debug?: Record<string, unknown> };
  const debug = (holder.__debug ??= {});
  if (debug.distant !== distantHook) debug.distant = distantHook;
}

installDistantDebug();
