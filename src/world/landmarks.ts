// The landmark index (the horizon pass's wave 5b, DESIGN.md §1b; the rules are `landmarkMath.ts`).
//
// Built behind a world's loading screen, one per streamer: every placed thing out in the open the rules call a landmark --
// the snapshot's own objects, the permanent rows (the race drawer's bridges among them) and the owner's imported models alike,
// since all of them stand in the streamer's list -- grouped by model and look, each group's models loaded **by size and never by
// region** (all of them, at the world's start: `h5b-NOTES.md` has the counts that decided it), drawn at the client's lowest
// level of detail as one instanced draw a piece. A sweep (the eye moved, the clock, the reach in force moved, or a tier shown or
// let go) puts each copy in or out: in while it is within its cut (`landmarkRange` under the reach in force) and the streamer
// does not hold it finer (its own tier built and shown: `LandmarkHost.holdsFiner`, one lookup), packed to the front of its
// group's one instance store. A landmark casts no shadow (Light and shadow's step 3), is never in a tier or a shadow batch,
// and nothing about any tier, level or draw changes for it.
//
// The frame (`step`) reads its eye, its reach and its step from a kept record (`ask`), so no number crosses a call, and makes
// nothing. A collection (the index built, or the rows taken up or put down) is an event's work.
import * as THREE from 'three';
import type { LoadedModel, Primitive } from './assetPack.ts';
import { fitInstanceSphere } from './levelGroup.ts';
import { drawnLevels } from './lodLevels.ts';
import { LANDMARK_TUNE, isLandmark } from './landmarkMath.ts';
import { keepUploadRange, type UploadRange } from './uploadRange.ts';

/** What the index reads of a placed object (the streamer's `PlacedObject`). */
export interface LandmarkObject {
  model: string;
  x: number;
  y: number;
  z: number;
  q: THREE.Quaternion;
  scale?: THREE.Vector3;
  pack?: unknown;
  look?: { mats: readonly unknown[]; sig: string };
  landmark?: true;
  drawDistance?: number;
}

/** What the index asks of the streamer (`LayoutStreamer` answers every one of these). */
export interface LandmarkHost<O extends LandmarkObject = LandmarkObject> {
  /** Every placed thing out in the open that could be one, with its half-span at its scale: what `isLandmark` is asked of. */
  landmarkCandidates(visit: (o: O, size: number) => void): void;
  /** Its model, loaded (the streamer's own cache: shared with its tiers). */
  modelFor(id: string, pack?: never): Promise<LoadedModel>;
  /**
   * A look's donors loaded (the streamer's `loadLook`, as a tier's build and the runtime path load them before they build):
   * without them a borrowed picture or material is refused and the far copy wears its own for the whole session.
   */
  loadLook(look: O['look']): Promise<void>;
  /** A mesh for one piece of a group's lowest level, made as the streamer makes a tier's, hidden, in the scene; null for a piece it never draws. */
  landmarkMesh(owner: object, prim: Primitive, n: number, look: O['look']): THREE.InstancedMesh | null;
  /** The look copies an owner held let go of, and the meshes taken out of the scene and disposed (never their geometry or material). */
  landmarkDrop(owner: object, meshes: readonly THREE.InstancedMesh[]): void;
  /** Whether the streamer holds this object finer now: its own tier built and shown. */
  holdsFiner(o: O): boolean;
  /** Whether a mesh failed to draw and is hidden for good (the portal renderer's quarantine). */
  isBroken(mesh: THREE.Object3D): boolean;
  /** Its programs built before it is shown (the world's paced queue, outright behind a screen); null shows it at once. */
  prepare: ((objects: THREE.Object3D[]) => Promise<void>) | null;
  /** Moves whenever a tier is shown or let go (a sweep then runs at once, so the hand-over is the same frame). */
  readonly tierEpoch: number;
  /** Moves whenever something that could be a landmark is put down, taken up, hidden or shown again. */
  readonly memberEpoch: number;
}

/** A frame's ask: the eye, the reach in force and the step, written by the world before `step` (fields, never arguments). */
export class LandmarkAsk {
  eyeX = 0.5;
  eyeY = 0.5;
  eyeZ = 0.5;
  reach = 0.5;
  dt = 0.5;
  constructor() {
    this.eyeX = 0;
    this.eyeY = 0;
    this.eyeZ = 0;
    this.reach = 0;
    this.dt = 0;
  }
}

/** One model's landmarks wearing one look: a mesh a piece of its lowest level, all reading one instance store. */
class LandmarkGroup<O extends LandmarkObject> {
  readonly key: string;
  readonly copies: O[];
  readonly n: number;
  readonly mats: Float32Array;
  readonly cx: Float32Array;
  readonly cy: Float32Array;
  readonly cz: Float32Array;
  readonly size: Float32Array;
  readonly dd: Float32Array;
  readonly shown: Uint8Array;
  readonly meshes: THREE.InstancedMesh[] = [];
  readonly attr: THREE.InstancedBufferAttribute;
  readonly range: UploadRange = { start: 0, count: 0 };
  count = 0;
  ready = false;
  /** The lowest level's triangles a copy, and the bytes its pieces' geometry holds (the console's numbers). */
  tris = 0;
  bytes = 0;
  constructor(key: string, copies: O[], sizes: readonly number[], model: LoadedModel) {
    this.key = key;
    this.copies = copies;
    const n = copies.length;
    this.n = n;
    this.mats = new Float32Array(n * 16);
    this.cx = new Float32Array(n);
    this.cy = new Float32Array(n);
    this.cz = new Float32Array(n);
    this.size = new Float32Array(n);
    this.dd = new Float32Array(n);
    this.shown = new Uint8Array(n);
    this.attr = new THREE.InstancedBufferAttribute(new Float32Array(n * 16), 16);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    // Measured from the middle of what its levels draw: a portal building's shell cell, never its rooms (`levelGroup` alike).
    const shell = model.def.cells?.find((c) => c.index === 0)?.bounds;
    const b = shell && shell.min.length >= 3 && shell.max.length >= 3 ? shell : model.def.bounds;
    const centre = new THREE.Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    const m = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const c = copies[i];
      if (c.scale) s.copy(c.scale);
      else s.set(1, 1, 1);
      m.compose(v.set(c.x, c.y, c.z), c.q, s);
      m.toArray(this.mats, i * 16);
      v.copy(centre).multiply(s).applyQuaternion(c.q);
      this.cx[i] = c.x + v.x;
      this.cy[i] = c.y + v.y;
      this.cz[i] = c.z + v.z;
      this.size[i] = sizes[i];
      this.dd[i] = c.drawDistance ?? 0;
    }
  }
}

/** The lowest level a model is ever drawn at: its pieces (a portal building's exterior alone), or none where the artists left it empty. */
export function lowestPieces(model: LoadedModel): Primitive[] {
  const levels = model.levels;
  if (levels && levels.length > 1) {
    const kept = drawnLevels(levels.map((l) => l.near));
    return levels[kept[kept.length - 1]].primitives;
  }
  const rooms = model.portals.length > 0;
  return model.primitives.filter((p) => !(rooms && p.cell > 0));
}

/** The index's counts: a class, so the frame's integer writes stay in place (an object literal's fields would box them). */
export class LandmarkStats {
  builds = 0;
  members = 0;
  groups = 0;
  emptyLowest = 0;
  failed: string[] = [];
  loadMs = 0;
  sweeps = 0;
  repacks = 0;
  shown = 0;
  held = 0;
  cut = 0;
}

export class LandmarkIndex<O extends LandmarkObject = LandmarkObject> {
  readonly host: LandmarkHost<O>;
  readonly ask = new LandmarkAsk();
  private groups: LandmarkGroup<O>[] = [];
  /** The members as last collected, for a collection that finds nothing moved. */
  private members = new Set<O>();
  private seenMember = -1;
  private seenTier = -1;
  private building: Promise<void> | null = null;
  private gen = 0;
  private disposed = false;
  private measured = false;
  // Every field a frame writes a fraction into starts as one (a field that starts as a small integer boxes every fraction
  // written into it afterwards) and is put to nought in the constructor.
  private age = 0.5;
  private sinceCollect = 0.5;
  private lastX = 0.5;
  private lastY = 0.5;
  private lastZ = 0.5;
  private lastReach = 0.5;
  private lastK = 0.5;
  private lastDrawn = true;
  /**
   * The size rule as the last collection behind a screen or a curtain took it (`build(true)`): what every collection the
   * frame makes (rows put down or taken up) collects by, so a switch or a least half-span moved since never loads a model in
   * play (`pending` says one is waiting).
   */
  private collectOn = false;
  private collectMin = 0;
  private force = false;
  private readonly packIds = new WeakMap<object, number>();
  private packCount = 0;
  /** What was built and what it came to, for the console. */
  readonly stats = new LandmarkStats();

  constructor(host: LandmarkHost<O>) {
    this.host = host;
    this.age = 0;
    this.sinceCollect = 0;
    this.lastX = 0;
    this.lastY = 0;
    this.lastZ = 0;
    this.lastReach = 0;
    this.lastK = 0;
    this.collectOn = LANDMARK_TUNE.on;
    this.collectMin = LANDMARK_TUNE.minSize;
  }

  /**
   * Whether the size rule moved since the last collection behind a screen or a curtain took it: the switch, or (with it on)
   * the least half-span. Taken by `build()` (an arrival's, `__debug.landmarks({ apply: true })`'s curtain), never by a frame.
   */
  get pending(): boolean {
    return LANDMARK_TUNE.on !== this.collectOn || (LANDMARK_TUNE.on && LANDMARK_TUNE.minSize !== this.collectMin);
  }

  /** How many groups stand now (0 with nothing collected: the switch off and no row's field, which is the world of before). */
  get groupCount(): number {
    return this.groups.length;
  }

  /** Every mesh of every group, for the console and the tests. */
  meshes(): THREE.InstancedMesh[] {
    const out: THREE.InstancedMesh[] = [];
    for (const g of this.groups) out.push(...g.meshes);
    return out;
  }

  /**
   * Collect the members and build what is new: each new group's model loaded (a few at once), its lowest level's meshes made
   * hidden and prepared, and then in one synchronous step the groups that went taken down and the new ones put in, so nothing
   * blinks. A collection that finds the same members does nothing. Answers when it is done; a newer build overtakes an older.
   *
   * `take` (the default: a loading screen's, a curtain's) takes the size rule as it stands now; the frame's own collection
   * (`step`, rows put down or taken up, whose models their placement has loaded and prepared) passes false and collects by
   * the rule last taken, so a switch or a least half-span moved since never brings a model in on a frame.
   */
  build(take = true): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.seenMember = this.host.memberEpoch;
    if (take) {
      this.collectOn = LANDMARK_TUNE.on;
      this.collectMin = LANDMARK_TUNE.minSize;
    }
    this.sinceCollect = 0;
    const found: O[] = [];
    const sizes = new Map<O, number>();
    const on = this.collectOn;
    const minSize = this.collectMin;
    this.host.landmarkCandidates((o, size) => {
      if (!isLandmark(size, o.landmark === true, o.drawDistance ?? 0, on, minSize)) return;
      found.push(o);
      sizes.set(o, size);
    });
    if (this.building === null && found.length === this.members.size && found.every((o) => this.members.has(o))) return Promise.resolve();
    const gen = ++this.gen;
    this.building = this.collectInto(gen, found, sizes).finally(() => {
      if (this.gen === gen) this.building = null;
    });
    return this.building;
  }

  /** The build under way, or one resolved (the loading screen's wait). */
  get ready(): Promise<void> {
    return this.building ?? Promise.resolve();
  }

  /** Whether a build is under way (models loading, programs being built). */
  get busy(): boolean {
    return this.building !== null;
  }

  private keyOf(o: O): string {
    let p = 0;
    if (o.pack && typeof o.pack === 'object') {
      p = this.packIds.get(o.pack) ?? 0;
      if (!p) {
        p = ++this.packCount;
        this.packIds.set(o.pack, p);
      }
    }
    return `${p}|${o.model}|${o.look?.sig ?? ''}`;
  }

  private async collectInto(gen: number, found: O[], sizes: Map<O, number>): Promise<void> {
    const t0 = performance.now();
    const byKey = new Map<string, O[]>();
    for (const o of found) {
      const k = this.keyOf(o);
      const list = byKey.get(k);
      if (list) list.push(o);
      else byKey.set(k, [o]);
    }
    // A group whose key and copies are the very ones standing is kept as it is.
    const keep = new Map<string, LandmarkGroup<O>>();
    for (const g of this.groups) {
      const list = byKey.get(g.key);
      if (list && list.length === g.n && list.every((o, i) => g.copies[i] === o)) keep.set(g.key, g);
    }
    const fresh: LandmarkGroup<O>[] = [];
    const failed: string[] = [];
    let empty = 0;
    const todo = [...byKey].filter(([k]) => !keep.has(k));
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < todo.length) {
        const [key, list] = todo[next++];
        let model: LoadedModel;
        try {
          model = await this.host.modelFor(list[0].model, list[0].pack as never);
        } catch {
          failed.push(list[0].model);
          continue;
        }
        // Its look's donors too, before its meshes wear the look (every copy of a group wears one look: the key holds it),
        // as a tier's build and the runtime path load them: a donor no tier has loaded would otherwise refuse the look.
        if (list[0].look) await this.host.loadLook(list[0].look);
        if (this.disposed || gen !== this.gen) return;
        const pieces = lowestPieces(model);
        const g = new LandmarkGroup<O>(key, list, list.map((o) => sizes.get(o) ?? 0), model);
        for (const prim of pieces) {
          const mesh = this.host.landmarkMesh(g, prim, list.length, list[0].look);
          if (!mesh) continue;
          mesh.instanceMatrix = g.attr;
          mesh.count = 0;
          fitInstanceSphere(mesh);
          g.meshes.push(mesh);
          const idx = prim.geometry.index;
          g.tris += (idx ? idx.count : (prim.geometry.getAttribute('position')?.count ?? 0)) / 3;
          for (const a of Object.values(prim.geometry.attributes)) g.bytes += (a as THREE.BufferAttribute).array?.byteLength ?? 0;
          if (idx) g.bytes += idx.array.byteLength;
        }
        if (!g.meshes.length) {
          empty++;
          this.host.landmarkDrop(g, g.meshes);
          continue;
        }
        if (this.host.prepare) {
          try {
            await this.host.prepare(g.meshes);
          } catch (err) {
            console.warn('landmarks: a group could not be compiled ahead of its first draw; shown anyway', err);
          }
        }
        if (this.disposed || gen !== this.gen) {
          this.host.landmarkDrop(g, g.meshes);
          return;
        }
        g.ready = true;
        fresh.push(g);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, LANDMARK_TUNE.loads) }, () => worker()));
    if (this.disposed || gen !== this.gen) {
      for (const g of fresh) this.host.landmarkDrop(g, g.meshes);
      return;
    }
    // One synchronous step: what went taken down, what came put in, and a sweep asked for at once. A group made again for
    // its members (a row of its model put down or taken up anywhere) carries each copy's drawn state over from the one it
    // stands for, so a copy drawn inside the band (`hysteresis`) is not hidden until the eye comes a band nearer.
    for (const g of fresh) {
      const was = this.groups.find((o) => o.key === g.key);
      if (was) this.carryShown(was, g);
    }
    for (const g of this.groups) if (keep.get(g.key) !== g) this.host.landmarkDrop(g, g.meshes);
    this.groups = [...keep.values(), ...fresh];
    this.members = new Set(found);
    const st = this.stats;
    st.builds++;
    st.members = found.length;
    st.groups = this.groups.length;
    st.emptyLowest = empty;
    st.failed = failed;
    st.loadMs = Math.round(performance.now() - t0);
    this.force = true;
  }

  /** Each copy `was` drew drawn again in `g` (matched by the object, the same placed thing), packed to its store. An event's work. */
  private carryShown(was: LandmarkGroup<O>, g: LandmarkGroup<O>): void {
    const at = new Map<O, number>();
    for (let j = 0; j < was.n; j++) if (was.shown[j] === 1) at.set(was.copies[j], j);
    if (!at.size) return;
    let any = false;
    for (let i = 0; i < g.n; i++) {
      if (!at.has(g.copies[i])) continue;
      g.shown[i] = 1;
      any = true;
    }
    if (any) this.repack(g);
  }

  /**
   * A frame: collect again when what could be a landmark moved (at most every `collectSeconds`, by the size rule last taken:
   * the rows' models are their placement's, loaded and prepared; a moved switch or least half-span waits for a screen or a
   * curtain, `pending`), and sweep when it is due (the eye moved, the clock ran, the reach in force moved by its share, `k`
   * or the drawn switch moved, or a tier was shown or let go, which hands a copy over on the very frame). Reads `ask`; makes
   * nothing.
   */
  step(): void {
    if (this.disposed) return;
    const a = this.ask;
    const host = this.host;
    this.sinceCollect += a.dt;
    if (host.memberEpoch !== this.seenMember && this.sinceCollect >= LANDMARK_TUNE.collectSeconds && this.building === null) void this.build(false);
    const groups = this.groups;
    if (!groups.length) return;
    this.age += a.dt;
    const dx = a.eyeX - this.lastX;
    const dy = a.eyeY - this.lastY;
    const dz = a.eyeZ - this.lastZ;
    const moved = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const tierMoved = host.tierEpoch !== this.seenTier;
    const k = LANDMARK_TUNE.k;
    const drawn = LANDMARK_TUNE.drawn;
    // `landmarkSweepDue` written out (a number handed to a call the compiler leaves out is a number made).
    const dr = a.reach - this.lastReach;
    const due = this.age >= LANDMARK_TUNE.sweepSeconds || moved >= LANDMARK_TUNE.sweepMetres || (dr < 0 ? -dr : dr) > this.lastReach * LANDMARK_TUNE.reachStep;
    if (this.measured && !this.force && !tierMoved && k === this.lastK && drawn === this.lastDrawn && !due) return;
    this.measured = true;
    this.force = false;
    this.age = 0;
    this.seenTier = host.tierEpoch;
    this.lastX = a.eyeX;
    this.lastY = a.eyeY;
    this.lastZ = a.eyeZ;
    this.lastReach = a.reach;
    this.lastK = k;
    this.lastDrawn = drawn;
    const h = LANDMARK_TUNE.hysteresis;
    let shownAll = 0;
    let heldAll = 0;
    let cutAll = 0;
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      let changed = false;
      for (let i = 0; i < g.n; i++) {
        const ex = g.cx[i] - a.eyeX;
        const ey = g.cy[i] - a.eyeY;
        const ez = g.cz[i] - a.eyeZ;
        const d = Math.sqrt(ex * ex + ey * ey + ez * ez);
        // `landmarkRange` under the reach in force, and `landmarkWants`, written out (held to them by the node test).
        let cut = k * g.size[i];
        if (g.dd[i] > 0) cut = g.dd[i];
        if (cut > a.reach) cut = a.reach;
        const prev = g.shown[i] === 1;
        // The streamer is asked only of a copy within its cut: most of a world's landmarks are past it on any frame.
        let want = false;
        if (cut > 0 && d <= cut * (1 + h)) {
          const held = host.holdsFiner(g.copies[i]);
          if (held) heldAll++;
          else want = prev ? true : d <= cut * (1 - h);
        } else cutAll++;
        if (want) shownAll++;
        if (want !== prev) {
          g.shown[i] = want ? 1 : 0;
          changed = true;
        }
      }
      if (changed) this.repack(g);
      this.applyVisible(g, drawn);
    }
    const st = this.stats;
    st.sweeps++;
    st.shown = shownAll;
    st.held = heldAll;
    st.cut = cutAll;
  }

  /** The copies drawn now written to the front of the group's store, its count and its sphere. Nothing made. */
  private repack(g: LandmarkGroup<O>): void {
    const out = g.attr.array as Float32Array;
    const mats = g.mats;
    let c = 0;
    for (let i = 0; i < g.n; i++) {
      if (g.shown[i] !== 1) continue;
      const s = i * 16;
      const o = c * 16;
      for (let e = 0; e < 16; e++) out[o + e] = mats[s + e];
      c++;
    }
    g.count = c;
    if (c > 0) {
      keepUploadRange(g.attr.updateRanges as UploadRange[], g.range, 0, c * 16);
      g.attr.needsUpdate = true;
    }
    const meshes = g.meshes;
    for (let m = 0; m < meshes.length; m++) {
      const mesh = meshes[m];
      mesh.count = c;
      fitInstanceSphere(mesh);
    }
    this.stats.repacks++;
  }

  private applyVisible(g: LandmarkGroup<O>, drawn: boolean): void {
    const meshes = g.meshes;
    for (let m = 0; m < meshes.length; m++) {
      const mesh = meshes[m];
      const v = drawn && g.ready && g.count > 0 && !this.host.isBroken(mesh);
      if (mesh.visible !== v) mesh.visible = v;
    }
  }

  /** The next frame sweeps whatever the clocks say (a tune moved). */
  refresh(): void {
    this.force = true;
  }

  /**
   * For the console (`__debug.landmarks()`): what was collected and built, what a sweep found (drawn, held finer by the
   * streamer, cut by distance), the lowest levels' triangles drawn now and in all, and their geometry's bytes.
   */
  report(): Record<string, unknown> {
    let tris = 0;
    let trisAll = 0;
    let bytes = 0;
    let copies = 0;
    const biggest: { key: string; copies: number; tris: number }[] = [];
    const materials = new Set<string>();
    for (const g of this.groups) {
      for (const m of g.meshes) materials.add((m.material as THREE.Material).name);
      tris += g.tris * g.count;
      trisAll += g.tris * g.n;
      bytes += g.bytes;
      copies += g.n;
      biggest.push({ key: g.key.split('|')[1], copies: g.n, tris: Math.round(g.tris) });
    }
    biggest.sort((x, y) => y.copies * y.tris - x.copies * x.tris);
    const st = this.stats;
    return {
      on: LANDMARK_TUNE.on,
      drawn: LANDMARK_TUNE.drawn,
      k: LANDMARK_TUNE.k,
      minSize: LANDMARK_TUNE.minSize,
      // The size rule the members were collected by, and whether a moved switch or least half-span waits for a curtain.
      collectedWith: { on: this.collectOn, minSize: this.collectMin },
      pending: this.pending,
      reach: Math.round(this.ask.reach),
      members: st.members,
      groups: this.groups.length,
      copies,
      emptyLowest: st.emptyLowest,
      failed: st.failed,
      building: this.building !== null,
      builds: st.builds,
      loadMs: st.loadMs,
      shown: st.shown,
      heldFiner: st.held,
      pastCut: st.cut,
      trisDrawn: Math.round(tris),
      trisIfAllDrawn: Math.round(trisAll),
      lowestGeometryMB: Number((bytes / 1048576).toFixed(2)),
      sweeps: st.sweeps,
      repacks: st.repacks,
      heaviest: biggest.slice(0, 8),
      // The materials its pieces wear, by name: what a program built in play is checked against (`shaders().builtInPlay`).
      materials: [...materials],
    };
  }

  /** Everything taken down: the meshes out of the scene, the looks' copies let go; a build under way stands nothing. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gen++;
    for (const g of this.groups) this.host.landmarkDrop(g, g.meshes);
    this.groups = [];
    this.members.clear();
  }
}
