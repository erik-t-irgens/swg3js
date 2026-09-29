// What was added to the scene since the material scan last ran (step 6 of the frame-time wave).
//
// Every material in the world must join the portal stencil scheme, the shadow cascades and the wet wrap
// before its program is built, and the world makes sure of it with a scan a few times a second that walks
// the whole scene -- eleven thousand nodes in a town, 2.6 ms every quarter second -- to find the handful of
// meshes that are new. Almost everything new arrives the same way: added straight to the scene (a tier's
// meshes, a building's rooms, a vehicle, a placed prop, a fighter's group) or under one of a few containers
// that stand in the scene for a world's whole life (the ground's root, the mobiles', the creatures' and the
// turrets' groups). Three says so as it happens, with a `childadded` event on the parent, so this keeps a
// list of what was added under the containers it watches and the scan walks that list instead, keeping the
// whole-scene walk as a slower backstop for anything added deeper -- and counting what the backstop finds,
// which is the one number that says whether the list is missing something.
//
// The paths that hang things deeper than any watched container adopt their own before they compile or show
// them, which is the rule the backstop exists to catch a breach of: `World.compileReady` adopts whatever it
// is handed (a fighter dressed at run time), the placement ghost adopts its see-through copies the moment it
// takes a model, and the creatures' own model, which arrives after its bodies are stood, queues its group.
//
// A root that has left the scene again by the time the list is walked is skipped: adopting the materials of
// something already taken away would register them with the portal renderer after they were forgotten,
// which is a leak. A root added twice is walked once.
//
// Pure apart from three's scene graph, so the node test drives it with real objects.

import type * as THREE from 'three';

/** The scan: walk what was added (true), or the whole scene every time (false, the old way); and how often each. Ours. */
export const SCAN_TUNE = { queued: true, everyMs: 250, backstopMs: 2000 };

export class SceneAdds {
  /** Roots added since the last drain, oldest first: a kept array written by index. */
  private readonly roots: (THREE.Object3D | null)[] = [];
  private n = 0;
  /** What one drain has already walked, so a root added twice is walked once. Cleared, never remade. */
  private readonly seen = new Set<THREE.Object3D>();
  private readonly watched = new Set<THREE.Object3D>();
  /** Since the session began: roots queued, walked, skipped for having left the scene, and walked twice over. */
  readonly stats = { queued: 0, walked: 0, gone: 0, repeats: 0 };
  /** The one listener every watched container shares. */
  private readonly onAdded = (e: { child?: THREE.Object3D | null }): void => {
    if (e.child) this.push(e.child);
  };

  /** Hear of every child added to this container from now on. */
  watch(parent: THREE.Object3D): void {
    if (this.watched.has(parent)) return;
    this.watched.add(parent);
    (parent as THREE.Object3D<THREE.Object3DEventMap>).addEventListener('childadded', this.onAdded as never);
  }

  /** Stop hearing of this container's children (a container that goes with its world, so the set does not keep it). */
  unwatch(parent: THREE.Object3D): void {
    if (!this.watched.delete(parent)) return;
    (parent as THREE.Object3D<THREE.Object3DEventMap>).removeEventListener('childadded', this.onAdded as never);
  }

  /** How many containers are watched. */
  get watching(): number {
    return this.watched.size;
  }

  /** Queue a root by hand: something hung under a container nobody watches. */
  push(o: THREE.Object3D): void {
    this.roots[this.n++] = o;
    this.stats.queued++;
  }

  /** How many roots are waiting. */
  get pending(): number {
    return this.n;
  }

  /**
   * Hand each root queued since the last drain to `visit`, once, if it is still under `scene`, and empty the
   * queue. Answers how many were visited.
   */
  drain(scene: THREE.Object3D, visit: (root: THREE.Object3D) => void): number {
    const n = this.n;
    this.n = 0;
    let walked = 0;
    for (let i = 0; i < n; i++) {
      const o = this.roots[i] as THREE.Object3D;
      this.roots[i] = null;
      if (this.seen.has(o)) {
        this.stats.repeats++;
        continue;
      }
      this.seen.add(o);
      if (!under(o, scene)) {
        this.stats.gone++;
        continue;
      }
      visit(o);
      walked++;
    }
    this.seen.clear();
    this.stats.walked += walked;
    return walked;
  }

  /** Forget everything queued (a world let go). */
  clear(): void {
    for (let i = 0; i < this.n; i++) this.roots[i] = null;
    this.n = 0;
  }
}

/** Whether `o` is `root` or hangs somewhere under it now. */
export function under(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === root) return true;
  return false;
}

/** Whether `o` and every parent above it are shown: whether a frame could draw it now. */
export function shownUp(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** What the scan asks of the world it runs for. */
export interface ScanHost {
  /** The scene the whole-scene backstop walks and a queued root must still hang under. */
  readonly scene: THREE.Object3D;
  /** Join every material under a root to the world's schemes; answers the drawables whose materials were new. */
  adopt(root: THREE.Object3D): THREE.Object3D[];
  /** Queue those drawables' programs to be built. */
  compile(fresh: THREE.Object3D[]): void;
  /** Whether a screen is up that nobody is looking past (a miss found then was never drawn unadopted). */
  readonly behindScreen: boolean;
}

/**
 * The quarter-second material scan (`World.updateShadows`): the roots added since it last ran, adopted and
 * queued to compile, with the whole scene walked every `backstopMs` behind them -- and whatever that walk
 * finds new counted as missed (`missedInPlay` the part of it found with no screen up, which could have been
 * drawn unadopted) and named in `lastMissed`. With `queued` off it walks the whole scene every time, as it
 * always did, and counts nothing as missed. Its one visit is made with it, so a scan makes no closure.
 */
export class MaterialScan {
  /** Since the session began. */
  readonly stats = { scans: 0, whole: 0, roots: 0, missed: 0, missedInPlay: 0, lastMissed: [] as string[] };
  /** When the whole scene was last walked (ms): the backstop's clock. */
  wholeAt = Number.NEGATIVE_INFINITY;
  private host: ScanHost | null = null;
  private readonly adds: SceneAdds;
  private readonly visit = (root: THREE.Object3D): void => {
    const host = this.host;
    if (!host) return;
    const fresh = host.adopt(root);
    if (fresh.length) host.compile(fresh);
  };

  constructor(adds: SceneAdds) {
    this.adds = adds;
  }

  /** What the last scan did: the roots the queue handed it, whether it walked the whole scene, and what that walk missed. Kept, not made. */
  readonly last = { roots: 0, whole: false, missed: 0 };

  /** One scan at `now` (ms); `last` says what it did. */
  run(now: number, host: ScanHost, tune: typeof SCAN_TUNE = SCAN_TUNE): void {
    const s = this.stats;
    const last = this.last;
    s.scans++;
    last.roots = 0;
    last.whole = false;
    last.missed = 0;
    if (tune.queued) {
      this.host = host;
      try {
        last.roots = this.adds.drain(host.scene, this.visit);
      } finally {
        this.host = null;
      }
      s.roots += last.roots;
      if (now - this.wholeAt < tune.backstopMs) return;
    } else this.adds.clear();
    this.wholeAt = now;
    s.whole++;
    last.whole = true;
    const fresh = host.adopt(host.scene);
    if (!fresh.length) return;
    host.compile(fresh);
    if (!tune.queued) return;
    last.missed = fresh.length;
    this.noteMissed(fresh, now, !host.behindScreen);
  }

  /**
   * What the backstop found that nothing queued: counted, and the last dozen named with where they hung.
   * `missedInPlay` counts only what could have been drawn unadopted -- found with no screen up, and shown all
   * the way up its parents -- since a thing still hidden while it is dressed (a fighter's clothes go on under
   * a rig kept hidden until its programs exist) is adopted by its own path before it is shown.
   */
  noteMissed(fresh: readonly THREE.Object3D[], now: number, inPlay: boolean): void {
    const s = this.stats;
    s.missed += fresh.length;
    const at = (now / 1000).toFixed(1);
    for (let i = 0; i < fresh.length; i++) {
      const o = fresh[i];
      const shown = shownUp(o);
      if (inPlay && shown) s.missedInPlay++;
      const p = o.parent;
      const pp = p?.parent;
      const where = !inPlay ? ' (behind a screen)' : shown ? '' : ' (hidden)';
      s.lastMissed.push(`${at} s${where}: ${o.name || o.type} under ${p?.name || p?.type || 'nothing'}${pp ? ` under ${pp.name || pp.type}` : ''}`);
      if (s.lastMissed.length > 12) s.lastMissed.shift();
    }
  }
}
