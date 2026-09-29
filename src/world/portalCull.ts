// What moves on its own -- the creatures and people, the fighters, the ships, the stood shuttles -- drawn
// only in the passes of the rooms it stands in (commit 2a of the frame-time wave).
//
// Everything on the actor layer used to go into every pass the portal renderer makes: the shadows, the
// world, and one interior pass for each building near enough to be seen into, so a crowd in a town was
// sent to the card four and five times a frame and only the stencil threw most of it away, after the
// vertex work and the draw calls were paid. Here each such thing is a record for the frame -- its roots,
// the room it stands in (0 outdoors) and a sphere about it -- and:
//
//   - before any pass, a record none of whose rooms the frame's visible set (`portalVis.ts`) saw is
//     hidden for the whole frame; outdoors counts as unseen only from inside a building with no exit in
//     sight;
//   - in the shadow pass only what stands outdoors is drawn (sunlight reaches no room);
//   - in the world pass only what stands outdoors, and from inside only what the exits' rectangle can show;
//   - in building B's pass only what stands in one of B's rooms.
//
// A record whose sphere reaches one of its room's portals counts in the room beyond as well, and so on
// through every portal the sphere reaches from there, so a body half through a doorway is drawn on both
// sides of it: the half behind the doorway's polygon is in the stencilled region, which is redrawn in the
// other side's pass. The room a body is recorded in is the one its owner last followed it into, a quarter
// of a second or two metres ago at most while it lives and as long ago as its death once it falls, so the
// portals are tested with the sphere grown by how far it has gone since (`at[4]`): every portal it crossed
// since lies within that of where it is now, and a runner, a thrown corpse or a ship through a hangar door
// is never drawn on the side it has left alone. A record with a light anywhere under it is never touched
// (a hidden light changes the light count, and that rebuilds every program). What a record's own owner
// hid stays hidden; what this hides is put back exactly: after the last pass (`endPasses`) for the
// per-pass choices, and after the effects (`restoreFrame`) for the frame's.
//
// A body left out of every view pass is kept hidden through the effects too: the motion blur draws a
// mesh on its own only when it thinks three drew it the frame before, and a record the passes all left
// out was never drawn at all. A lit blade is not a body: it is not something the motion blur draws, and
// what it lights (the blade glow pass reads whether it is shown) can be on the screen when the blade is
// not, so a blade root goes back to its owner's value once the passes are drawn.
//
// The same records say, per body, how its rooms were seen (`levelOf`, commit 2c), which the creatures'
// manager reads a frame late for its tiers: the routing's own answer, so a body drawn through a doorway is
// never tiered as walled up, and one that counts outdoors is left to the frustum as it always was.
//
// Nothing here allocates on a frame once its arrays have grown to the crowd: kept typed arrays, written
// by index and never shortened. Node tests run it (`portalCull.test.ts`), so value imports carry `.ts`.
import * as THREE from 'three';
import type { PortalVisibility, VisBuilding } from './portalVis.ts';

/** What a record is, for the console's counts. */
export const ROUTE_KIND = { mobile: 0, fighter: 1, vehicle: 2, rig: 3 } as const;
export const ROUTE_KIND_NAMES = ['mobile', 'fighter', 'vehicle', 'rig'] as const;
const NKIND = ROUTE_KIND_NAMES.length;

/** Which pass is being routed. */
export const ROUTE_PASS = { shadows: 0, world: 1, building: 2 } as const;

/** The routing's own numbers. Ours. */
export const ROUTE_TUNE = {
  /** Rooms one record may count in (its own and those past the doorways it reaches); past this it is left alone. */
  maxRooms: 6,
  /** Frames between looks for a light under a record's roots. */
  lightEvery: 120,
  /** Metres past a building's radius within which a record outdoors is tested against its exits. */
  outdoorReach: 4,
};

/**
 * How a body's rooms were seen, as `levelOf` answers it (commit 2c): `unknown` (-1) leaves it to the
 * frustum -- nothing known, a record left untouched, or one that counts outdoors -- `seen` (1) one of its
 * rooms was seen, `past` (2) none was but one is one room past a seen one, `unseen` (0) none of them.
 */
export const ROOM_LEVEL = { unknown: -1, unseen: 0, seen: 1, past: 2 } as const;

const F_OUT = 1;
const F_SKIP = 2;
const F_HID = 4;
const F_DRAWN = 8;
const F_UNDRAWN = 16;

/** One root as this has seen it: whether a light is under it and when that was looked at, and how its rooms were seen. */
interface RootMark {
  at: number;
  light: boolean;
  /** `ROOM_LEVEL` as of the record frame `levelFrame`. */
  level: number;
  levelFrame: number;
}

export interface RouteStats {
  /** Records this frame, and by kind. */
  records: number;
  byKind: Int32Array;
  /** Left untouched: a light under them, or more rooms than `maxRooms`. */
  unhideable: number;
  /** Counting in more than one room (a doorway, or outdoors beside a door). */
  doorway: number;
  /** Hidden for the whole frame, and by kind. */
  hidden: number;
  hiddenByKind: Int32Array;
  /** Shown to no view pass, so hidden through the effects as well. */
  undrawn: number;
  /** Records shown summed over the passes of each sort, and how many passes of each sort were routed. */
  shownShadows: number;
  shownWorld: number;
  shownRooms: number;
  passes: Int32Array;
}

export class ActorRoutes {
  /** Whether this frame's records were collected and the frame's hiding has been done: every other call is a no-op while false. */
  active = false;
  /** How many records this frame. */
  n = 0;
  readonly stats: RouteStats = { records: 0, byKind: new Int32Array(NKIND), unhideable: 0, doorway: 0, hidden: 0, hiddenByKind: new Int32Array(NKIND), undrawn: 0, shownShadows: 0, shownWorld: 0, shownRooms: 0, passes: new Int32Array(3) };
  private vis: PortalVisibility | null = null;
  private cap = 0;
  private readonly k: number;
  private kind = new Uint8Array(0);
  private flag = new Uint8Array(0);
  private savedA = new Uint8Array(0);
  private savedB = new Uint8Array(0);
  private sphere = new Float64Array(0);
  private memN = new Uint8Array(0);
  private memC = new Int16Array(0);
  private readonly rootA: (THREE.Object3D | null)[] = [];
  private readonly rootB: (THREE.Object3D | null)[] = [];
  private readonly markA: (RootMark | null)[] = [];
  private readonly memB: (VisBuilding | null)[] = [];
  private readonly marks = new WeakMap<THREE.Object3D, RootMark>();
  private readonly stack: (THREE.Object3D | null)[] = [];
  private frame = 0;
  private readonly rooms = new Int32Array(16);
  private readonly tmpSphere = new THREE.Sphere();
  /** The sphere the portals are tested with: the record's own, grown by how far it has gone since its room was followed. */
  private readonly probe = new Float64Array(4);
  /** World steps (`tick`), and the step and record frame the last levels were worked out in (-1: none). */
  private ticks = 0;
  private levelsTick = 0;
  private levelsFrame = -1;

  constructor(maxRooms = ROUTE_TUNE.maxRooms) {
    this.k = Math.max(1, Math.min(15, Math.floor(maxRooms)));
  }

  /**
   * A new frame: last frame's records are let go of, and this one's are collected only when `on` and the
   * visible set is this frame's (`vis.result.valid`). Answers whether to collect.
   */
  begin(vis: PortalVisibility | null, on: boolean): boolean {
    // A frame that never reached its `restoreFrame` (it threw) is put back before anything is let go of.
    if (this.active) this.restoreFrame();
    this.clearRefs();
    this.n = 0;
    this.frame++;
    this.vis = vis;
    this.active = false;
    // Until this frame's levels are worked out, none are known: a frame that collects nothing leaves none standing.
    this.levelsFrame = -1;
    const s = this.stats;
    s.records = 0;
    s.byKind.fill(0);
    s.unhideable = 0;
    s.doorway = 0;
    s.hidden = 0;
    s.hiddenByKind.fill(0);
    s.undrawn = 0;
    s.shownShadows = 0;
    s.shownWorld = 0;
    s.shownRooms = 0;
    s.passes.fill(0);
    return on && !!vis && vis.result.valid;
  }

  private grow(): void {
    const cap = Math.max(64, this.cap * 2);
    const k = this.k;
    const kind = new Uint8Array(cap);
    kind.set(this.kind);
    const flag = new Uint8Array(cap);
    flag.set(this.flag);
    const savedA = new Uint8Array(cap);
    savedA.set(this.savedA);
    const savedB = new Uint8Array(cap);
    savedB.set(this.savedB);
    const sphere = new Float64Array(cap * 4);
    sphere.set(this.sphere);
    const memN = new Uint8Array(cap);
    memN.set(this.memN);
    const memC = new Int16Array(cap * k);
    memC.set(this.memC);
    this.kind = kind;
    this.flag = flag;
    this.savedA = savedA;
    this.savedB = savedB;
    this.sphere = sphere;
    this.memN = memN;
    this.memC = memC;
    for (let i = this.cap; i < cap; i++) {
      this.rootA[i] = null;
      this.rootB[i] = null;
      this.markA[i] = null;
    }
    for (let i = this.cap * k; i < cap * k; i++) this.memB[i] = null;
    this.cap = cap;
  }

  /**
   * The sphere of the next record `add` takes, written here by the caller rather than handed over as
   * numbers: a number handed to a call that is not inlined is boxed, and this is asked for every body on
   * every frame. The middle (x, y, z) in the world, the radius (0 or less: no sphere, so no doorway is ever
   * found and nothing narrows it), and how far the body has gone since the room it is recorded in was last
   * followed (0 when it is followed now, or not known to lag).
   */
  readonly at = new Float64Array(5);

  /**
   * One record: what it is, its roots (`b` a second root that is not under the first, a lit blade's, or
   * null), the building and room it stands in (null and 0 outdoors), and its sphere, written into `at`
   * first. Called between `begin` and `hideFrame`, only when `begin` answered true.
   */
  add(kind: number, a: THREE.Object3D, b: THREE.Object3D | null, building: VisBuilding | null, cell: number): void {
    const vis = this.vis;
    if (!vis) return;
    if (this.n >= this.cap) this.grow();
    const i = this.n++;
    const s = this.stats;
    s.records++;
    if (kind >= 0 && kind < NKIND) s.byKind[kind]++;
    this.kind[i] = kind;
    this.rootA[i] = a;
    this.rootB[i] = b;
    const o = i * 4;
    const at = this.at;
    this.sphere[o] = at[0];
    this.sphere[o + 1] = at[1];
    this.sphere[o + 2] = at[2];
    this.sphere[o + 3] = at[3];
    this.memN[i] = 0;
    this.flag[i] = 0;
    const mark = this.markOf(a);
    this.markA[i] = mark;
    if (this.lit(mark, a) || (b !== null && this.lit(this.markOf(b), b))) {
      this.flag[i] = F_SKIP;
      s.unhideable++;
      return;
    }
    // The portals are tried with the sphere grown by how far the body has gone since its room was followed.
    const q = this.probe;
    q[0] = at[0];
    q[1] = at[1];
    q[2] = at[2];
    q[3] = at[3] > 0 ? at[3] + (at[4] > 0 ? at[4] : 0) : 0;
    let wide = false;
    if (building !== null && cell > 0) {
      this.push(i, building, cell);
      if (q[3] > 0 && !this.spread(i, building, 0, false)) wide = true;
    } else {
      this.flag[i] |= F_OUT;
      if (q[3] > 0) {
        // Outdoors beside a building drawn this frame: through any of its exits the sphere reaches, it is in the room behind.
        const res = vis.result;
        const reach = ROUTE_TUNE.outdoorReach;
        for (let d = 0; d < res.drawnCount && !wide; d++) {
          const bd = res.drawn[d];
          if (!bd) continue;
          const dx = bd.x - q[0];
          const dz = bd.z - q[2];
          const far = bd.radius + q[3] + reach;
          if (dx * dx + dz * dz > far * far) continue;
          if (!this.spread(i, bd, this.memN[i], true)) wide = true;
        }
      }
    }
    if (wide) {
      this.flag[i] = F_SKIP;
      s.unhideable++;
      return;
    }
    if (this.memN[i] + (this.flag[i] & F_OUT ? 1 : 0) > 1) s.doorway++;
  }

  /**
   * Every room of `bd` the probe sphere reaches through a chain of portals, from the rooms the record
   * already counts in there (its entries from `from` on) and, when `out`, from outdoors through the
   * building's exits: each portal of a room reached that the sphere touches adds the room beyond, and an
   * exit it touches counts it outdoors and tries the building's other exits. False when that comes to more
   * than `maxRooms`, and the record is then left alone. Nothing allocated: the rooms reached are the
   * record's own list, walked as it grows.
   */
  private spread(i: number, bd: VisBuilding, from: number, out: boolean): boolean {
    const vis = this.vis as PortalVisibility;
    const k = this.k;
    const rooms = this.rooms;
    const q = this.probe;
    const base = i * k;
    let pendingOut = out;
    let outDone = false;
    let j = from;
    for (;;) {
      if (pendingOut && !outDone) {
        outDone = true;
        const got = vis.touching(bd, 0, q, rooms, k);
        if (got > k) return false;
        for (let m = 0; m < got; m++) if (rooms[m] > 0 && !this.push(i, bd, rooms[m])) return false;
        continue;
      }
      if (j >= this.memN[i]) return true;
      const e = base + j++;
      if (this.memB[e] !== bd) continue;
      const got = vis.touching(bd, this.memC[e], q, rooms, k);
      if (got > k) return false;
      for (let m = 0; m < got; m++) {
        if (rooms[m] === 0) {
          this.flag[i] |= F_OUT;
          pendingOut = true;
        } else if (!this.push(i, bd, rooms[m])) return false;
      }
    }
  }

  /** A room this record counts in; false when it already counts in `maxRooms`. */
  private push(i: number, b: VisBuilding, cell: number): boolean {
    const k = this.k;
    const n = this.memN[i];
    const base = i * k;
    for (let j = 0; j < n; j++) if (this.memB[base + j] === b && this.memC[base + j] === cell) return true;
    if (n >= k) return false;
    this.memB[base + n] = b;
    this.memC[base + n] = cell;
    this.memN[i] = n + 1;
    return true;
  }

  /** A root's mark, made the first time the root is met (the one allocation a root ever costs). */
  private markOf(root: THREE.Object3D): RootMark {
    let mark = this.marks.get(root);
    if (!mark) {
      mark = { at: -Infinity, light: false, level: ROOM_LEVEL.unknown, levelFrame: -1 };
      this.marks.set(root, mark);
    }
    return mark;
  }

  /** Whether a light hangs anywhere under a root: looked at when first met and every `lightEvery` frames after. */
  private lit(mark: RootMark, root: THREE.Object3D): boolean {
    if (this.frame - mark.at < ROUTE_TUNE.lightEvery) return mark.light;
    mark.at = this.frame;
    const st = this.stack;
    let sp = 0;
    st[sp++] = root;
    let found = false;
    while (sp > 0) {
      const o = st[--sp] as THREE.Object3D;
      st[sp] = null;
      if ((o as THREE.Light).isLight) {
        found = true;
        break;
      }
      const ch = o.children;
      for (let c = 0; c < ch.length; c++) st[sp++] = ch[c];
    }
    while (sp > 0) st[--sp] = null;
    mark.light = found;
    return found;
  }

  /**
   * Work out how each record's rooms were seen (what `levelOf` answers next step), and with `hide` hide
   * for the whole frame every record none of whose rooms is seen; outdoors is unseen only from inside a
   * building with no exit in sight. Each root's own visibility is kept first, to be put back exactly.
   * Without `hide` nothing is touched and the passes route nothing (`active` stays false).
   */
  hideFrame(hide = true): void {
    const vis = this.vis;
    if (!vis || !vis.result.valid) {
      this.active = false;
      return;
    }
    this.levelsFrame = this.frame;
    this.levelsTick = this.ticks;
    const res = vis.result;
    const outdoorsSeen = !(res.inside !== null && !res.worldSeen);
    const k = this.k;
    const s = this.stats;
    for (let i = 0; i < this.n; i++) {
      const f = this.flag[i];
      const mark = this.markA[i] as RootMark;
      mark.levelFrame = this.frame;
      if (f & F_SKIP) {
        mark.level = ROOM_LEVEL.unknown;
        continue;
      }
      let level: number = ROOM_LEVEL.unseen;
      const base = i * k;
      for (let j = 0; j < this.memN[i]; j++) {
        const set = vis.seenOf(this.memB[base + j] as VisBuilding);
        const c = this.memC[base + j];
        if (set === null || c >= set.length) continue;
        if (set[c] === 1) {
          level = ROOM_LEVEL.seen;
          break;
        }
        if (set[c] === 2) level = ROOM_LEVEL.past;
      }
      const out = (f & F_OUT) !== 0;
      // What counts outdoors is left to the frustum: the open is no room, and a body there that the walls
      // of the room the camera stands in hide now is on screen the moment an exit comes round.
      mark.level = out ? ROOM_LEVEL.unknown : level;
      if (!hide) continue;
      const a = this.rootA[i] as THREE.Object3D;
      const b = this.rootB[i];
      this.savedA[i] = a.visible ? 1 : 0;
      this.savedB[i] = b !== null && b.visible ? 1 : 0;
      if ((out && outdoorsSeen) || level === ROOM_LEVEL.seen) continue;
      this.flag[i] = f | F_HID;
      a.visible = false;
      if (b !== null) b.visible = false;
      s.hidden++;
      const kd = this.kind[i];
      if (kd < NKIND) s.hiddenByKind[kd]++;
    }
    this.active = hide;
  }

  /** One world step has passed: levels worked out before the last one are too old to act on (`levelOf`). */
  tick(): void {
    this.ticks++;
  }

  /**
   * How the rooms of the body under `root` were seen when the last frame was drawn (`ROOM_LEVEL`), for the
   * creatures' manager, which runs before this frame is: `unknown` for a root that frame did not route,
   * for one it left alone or that counts outdoors, and for every root once more than one world step has
   * passed since that frame (nothing drawn: a driven tab stepping headless, or the steps after a travel).
   */
  levelOf(root: THREE.Object3D): number {
    if (this.levelsFrame < 0 || this.ticks - this.levelsTick > 1) return ROOM_LEVEL.unknown;
    const mark = this.marks.get(root);
    return mark && mark.levelFrame === this.levelsFrame ? mark.level : ROOM_LEVEL.unknown;
  }

  /**
   * Choose what one pass draws: `ROUTE_PASS.shadows` and `world` take what stands outdoors (the world pass
   * from inside only what `frustum`, the one through the exits' rectangle, holds; null narrows nothing), and
   * `building` what stands in one of `b`'s rooms. Everything the frame hid stays hidden, and nothing its
   * owner hid is shown.
   */
  route(pass: number, b: VisBuilding | null, frustum: THREE.Frustum | null): void {
    if (!this.active) return;
    const s = this.stats;
    if (pass >= 0 && pass < 3) s.passes[pass]++;
    const k = this.k;
    const sp = this.tmpSphere;
    for (let i = 0; i < this.n; i++) {
      const f = this.flag[i];
      if (f & (F_SKIP | F_HID)) continue;
      let show = false;
      if (pass === ROUTE_PASS.building) {
        const base = i * k;
        for (let j = 0; j < this.memN[i]; j++) {
          if (this.memB[base + j] === b) {
            show = true;
            break;
          }
        }
      } else {
        show = (f & F_OUT) !== 0;
        if (show && pass === ROUTE_PASS.world && frustum !== null) {
          const o = i * 4;
          const r = this.sphere[o + 3];
          if (r > 0) {
            sp.center.set(this.sphere[o], this.sphere[o + 1], this.sphere[o + 2]);
            sp.radius = r;
            show = frustum.intersectsSphere(sp);
          }
        }
      }
      const a = this.rootA[i] as THREE.Object3D;
      const bb = this.rootB[i];
      a.visible = show && this.savedA[i] === 1;
      if (bb !== null) bb.visible = show && this.savedB[i] === 1;
      if (!show) continue;
      if (pass === ROUTE_PASS.shadows) s.shownShadows++;
      else {
        this.flag[i] = f | F_DRAWN;
        if (pass === ROUTE_PASS.world) s.shownWorld++;
        else s.shownRooms++;
      }
    }
  }

  /**
   * The passes are over: each record is put back as the frame left it, except a body shown to no view
   * pass (or hidden for the frame), which stays hidden through the effects (`restoreFrame` puts it back
   * after them). A blade goes back to its owner's value whatever its body did: what it lights can be on
   * the screen when it is not, and the motion blur does not draw it.
   */
  endPasses(): void {
    if (!this.active) return;
    const s = this.stats;
    for (let i = 0; i < this.n; i++) {
      const f = this.flag[i];
      if (f & F_SKIP) continue;
      const b = this.rootB[i];
      if (b !== null) b.visible = this.savedB[i] === 1;
      if (f & F_HID) continue;
      const drawn = (f & F_DRAWN) !== 0;
      if (!drawn) {
        this.flag[i] = f | F_UNDRAWN;
        s.undrawn++;
      }
      (this.rootA[i] as THREE.Object3D).visible = drawn && this.savedA[i] === 1;
    }
  }

  /** The frame is drawn, effects and all: every root this touched is put back to its owner's own value. */
  restoreFrame(): void {
    if (!this.active) return;
    this.active = false;
    for (let i = 0; i < this.n; i++) {
      if (this.flag[i] & F_SKIP) continue;
      (this.rootA[i] as THREE.Object3D).visible = this.savedA[i] === 1;
      const b = this.rootB[i];
      if (b !== null) b.visible = this.savedB[i] === 1;
    }
  }

  /** Last frame's roots and buildings let go of, so nothing gone from the world is held here. */
  private clearRefs(): void {
    const k = this.k;
    for (let i = 0; i < this.n; i++) {
      this.rootA[i] = null;
      this.rootB[i] = null;
      this.markA[i] = null;
      for (let j = 0; j < k; j++) this.memB[i * k + j] = null;
    }
  }

  /** Whether record `i` was hidden for the whole frame (for the console and the tests). */
  hiddenAt(i: number): boolean {
    return (this.flag[i] & F_HID) !== 0;
  }

  /** Whether record `i` was left untouched (a light under it, or too many rooms). */
  skippedAt(i: number): boolean {
    return (this.flag[i] & F_SKIP) !== 0;
  }

  /** How many rooms record `i` counts in, outdoors included. */
  roomsAt(i: number): number {
    return this.memN[i] + (this.flag[i] & F_OUT ? 1 : 0);
  }

  /** Whether record `i` counts in room `cell` of building `b`. */
  countsIn(i: number, b: VisBuilding, cell: number): boolean {
    const k = this.k;
    const base = i * k;
    for (let j = 0; j < this.memN[i]; j++) if (this.memB[base + j] === b && this.memC[base + j] === cell) return true;
    return false;
  }

  /** Whether record `i` counts outdoors. */
  outdoorsAt(i: number): boolean {
    return (this.flag[i] & F_OUT) !== 0;
  }
}
