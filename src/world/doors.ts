// The doors in the buildings' doorways: drawn with the building they stand in, opening on their own as a
// body walks up to them and shutting behind it, sounding as they go, and solid while they are shut.
//
// Where everything comes from. The converter's `doors` pass (`tools/swg/doors.mjs`) writes a table per
// pack, `doors.json` beside its manifest: for each portal building, every portal that carries a door,
// its style out of the client's own door style table, the cells on its two sides and where it hangs in
// the building's frame; and the door models once into a folder every pack shares (`doors/`). A door
// stands where the client hung it, slides the way and the distance the table says over the times the
// table gives, opens for whatever comes within the table's own trigger radius, and plays the sounds its
// client effects name at the four moments the table names them. How it eases is ours (`doorMath.ts`).
//
// What it costs and when. A building's doors are made when its rooms are (`LayoutStreamer.buildInterior`,
// a hundred and sixty metres or so out) and taken down with them: meshes that share the door model's
// geometry and materials, hidden until their programs are built (the world's paced queue, `prepare`), and
// for each leaf one kinematic body with one box, made once and moved, never added or taken away as the
// door opens and shuts. A door between two rooms is shown with its rooms, like the rest of the interior;
// one on an exit stands in the world and joins its own building's rooms' pass only (`PortalRenderer`).
// Its transforms are written in the world's step, before the frame is drawn, and only while it moves.
//
// Who opens a door: the player, every person and creature of the catalogue (the followers and ours among
// them), every fighter and every other player's body, alive, within the radius. Whether a body may open
// one at all is one question asked of `mayOpen`, which says yes to everybody today: it is where a lock on
// a house, a keypad on the corvette or a slicer's work will answer. Nothing goes on the wire: every
// browser sees the same bodies near the same doors and opens them itself.
import * as THREE from 'three';
import { RAPIER, type Physics } from '../core/physics.ts';
import { AssetPack, type LoadedModel, type PackManifest } from './assetPack.ts';
import { INTERIOR_LAYER } from './portalRender.ts';
import { markFurniture } from './furnitureHost.ts';
import { isQuarantined } from './portalVis.ts';
import { castsShadow } from './surfaces.ts';
import type { Building } from './layoutStream.ts';
import { makeLeafBody, moveLeafBody, takeLeafBody } from './doorBody.ts';
import {
  DOOR_EVENT,
  DOORS_PACK_VERSION,
  DOORS_TUNE,
  doorWanted,
  isExitDoor,
  leafAt,
  leafBase,
  leafSlide,
  newDoorMotion,
  openersNear,
  stepDoor,
  type BuildingDoors,
  type DoorMotion,
  type DoorRow,
  type DoorsFile,
  type DoorStyleRow,
  type OpenerSink,
} from './doorMath.ts';

export { DOORS_TUNE, OPENER } from './doorMath.ts';

/** One leaf of a door: its meshes, where it hangs shut, its slide when open, and its body. */
interface Leaf {
  meshes: THREE.Mesh[];
  base: THREE.Matrix4;
  slide: THREE.Vector3;
  body: RAPIER.RigidBody | null;
  collider: RAPIER.Collider | null;
  /** The box the body is made of, in the leaf's own frame: its middle and its half sizes. */
  mid: [number, number, number];
  half: [number, number, number];
}

/** One door standing in a building's doorway, as the step and the console see it. */
export interface DoorView {
  readonly building: Building;
  readonly portal: number;
  readonly style: string;
  readonly cells: readonly number[];
  /** Whether one side of it is the open world. */
  readonly exit: boolean;
  /** Its middle in the world: where it is heard from and measured to. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface Door extends DoorView {
  x: number;
  y: number;
  z: number;
  row: DoorRow;
  s: DoorStyleRow;
  /** Where a body is measured from: the bottom middle of the doorway, in the world. */
  ox: number;
  oy: number;
  oz: number;
  leaves: Leaf[];
  frame: THREE.Mesh[];
  motion: DoorMotion;
  /** The console's hold: 1 held open, -1 held shut, 0 as the bodies near it say. */
  hold: number;
  /** Made and not stepped yet: its first step stands it as it should be with no swing and no sound. */
  fresh: boolean;
}

/** One building's doors, made together and taken down together. */
interface Built {
  b: Building;
  doors: Door[];
  /** Its doors by the portal each stands in, for what asks how open a doorway is (`openShare`). */
  byPortal: Map<number, Door>;
  view: BuildingDoors;
  meshes: THREE.Mesh[];
  /** Taken down: anything still on its way to it drops what it made. */
  gone: boolean;
  /**
   * For the bodies near it (`openersNear`): how far its farthest door stands from its middle, level, and
   * the largest radius any of its doors opens at. Apart, so the `reach` knob scales the radius alone.
   */
  spread: number;
  trigger: number;
}

/** What the console reads of the doors. */
export interface DoorsStatus {
  on: boolean;
  models: string;
  buildings: number;
  doors: number;
  ready: number;
  open: number;
  moving: number;
  bodies: number;
  openers: number;
  sounds: number;
  refused: number;
  missingModels: string[];
}

const tmpM = new THREE.Matrix4();
const tmpP = new THREE.Vector3();

/**
 * The doors of the world. One for the world, made with it; the streamer tells it when a building's rooms
 * are made and dropped (`LayoutStreamer.doorHost`), and the world steps it once a step.
 */
export class Doors implements OpenerSink {
  /** Builds the programs of the meshes handed over before they are shown (the world's paced queue). Null shows them at once. */
  prepare: ((objects: THREE.Object3D[]) => Promise<void>) | null = null;
  /** Plays one of the game's sounds at a door; the world says which space it is heard in. */
  onSound: ((id: string, door: DoorView) => void) | null = null;
  /** Has the mixer fetch and decode some sounds ahead of their first use. */
  prepareSounds: ((ids: string[]) => void) | null = null;
  /**
   * The locks' seam: whether a body of kind `who` (`OPENER`) may open this door. Null is yes to every
   * body, which is the game today. Asked only of a body already within the door's radius.
   */
  mayOpen: ((door: DoorView, who: number) => boolean) | null = null;
  /** What it has done, for the console. */
  readonly counts = { sounds: 0, refused: 0, built: 0, dropped: 0 };
  /**
   * The leaf meshes that moved this step, for the motion blur (`App.collectMovers`): a door is a thing
   * that moves on its own. Kept and refilled each step; a door that only stood still is not in it.
   */
  private readonly movedList: THREE.Mesh[] = [];

  private readonly scene: THREE.Scene;
  private readonly physics: Physics;
  private readonly baseUrl: string;
  private pack: AssetPack | null = null;
  private packLoad: Promise<AssetPack | null> | null = null;
  /** Moved on by every unload, so a pack still loading for the world that went is dropped when it lands. */
  private generation = 0;
  private modelsState = 'not asked for';
  private readonly missing = new Set<string>();
  private readonly built = new Map<Building, Built>();
  /** Every built building, in a kept list the step walks by index. */
  private readonly list: Built[] = [];
  /** This step's openers: x, y, z a body, and its kind; kept and grown, never shortened. */
  private ox = new Float64Array(3 * 128);
  private okind = new Uint8Array(128);
  private n = 0;
  /** The openers near one building, by index, refilled for each. */
  private near = new Int32Array(128);
  /** Whether the colliders stand as the tune last said (`solid`), and the exits' shadows, so a flip is applied once. */
  private solidNow = DOORS_TUNE.solid;
  private shadowsNow = DOORS_TUNE.shadows;
  /** Kept for the bodies' next places: the engine copies out of it at the call. */
  private readonly at = { x: 0, y: 0, z: 0 };

  // Written out rather than taken off the constructor's own parameters, as every runtime file here is.
  constructor(scene: THREE.Scene, physics: Physics, baseUrl: string) {
    this.scene = scene;
    this.physics = physics;
    this.baseUrl = baseUrl;
  }

  /** How many doors stand now. */
  get count(): number {
    let n = 0;
    for (let i = 0; i < this.list.length; i++) n += this.list[i].doors.length;
    return n;
  }

  /** The leaf meshes that moved this step, for the motion blur: read by index, never kept. */
  get moved(): readonly THREE.Mesh[] {
    return this.movedList;
  }

  /**
   * How open the doorway in a building's portal is, 0 shut to 1 open: 1 where no door stands, where its
   * door is not yet shown (it is no wall then either) and in a building whose doors are not made. What
   * the room's daylight beams ask, so the sun does not pour in through a shut door. Nothing allocated.
   */
  openShare(b: Building, portal: number): number {
    const rec = this.built.get(b);
    if (!rec || !rec.view.ready) return 1;
    const d = rec.byPortal.get(portal);
    if (!d) return 1;
    const open = d.motion.open;
    return open <= 0 ? 0 : open >= 1 ? 1 : open;
  }

  /** The shared door models, loaded the first time a building with doors is made in this world. */
  private models(): Promise<AssetPack | null> {
    if (this.packLoad) return this.packLoad;
    const gen = this.generation;
    const base = `${this.baseUrl}assets-private/doors/`;
    this.modelsState = 'loading';
    this.packLoad = (async () => {
      try {
        const res = await fetch(`${base}manifest.json`);
        if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) {
          if (gen === this.generation) this.modelsState = 'no doors/manifest.json: run the doors command';
          return null;
        }
        const man = (await res.json()) as PackManifest & { version?: number };
        if (gen !== this.generation) return null;
        if (man.version !== DOORS_PACK_VERSION) {
          this.modelsState = `doors/manifest.json is version ${man.version}; this build reads ${DOORS_PACK_VERSION}`;
          return null;
        }
        const pack = AssetPack.from(man, base);
        this.pack = pack;
        this.modelsState = `${pack.category('doors').length} door models`;
        return pack;
      } catch (err) {
        if (gen === this.generation) this.modelsState = `the door models failed to load (${err instanceof Error ? err.message : String(err)})`;
        return null;
      }
    })();
    return this.packLoad;
  }

  /** A building's rooms were made: its doors are made too, out of sight until their programs exist. */
  build(b: Building, table: DoorsFile): void {
    if (this.built.has(b)) return;
    const rows = table.models[b.model.def.id];
    if (!rows || !rows.length) return;
    const rec: Built = { b, doors: [], byPortal: new Map(), view: { ready: false, outer: [], inner: [], innerCells: new Int16Array(0) }, meshes: [], gone: false, spread: 0, trigger: 0 };
    this.built.set(b, rec);
    this.list.push(rec);
    b.doors = rec.view;
    this.counts.built++;
    void this.make(rec, rows, table.styles).catch((err) => console.warn('doors: a building’s doors could not be made', err));
  }

  /** A building's rooms were dropped: its doors go with them, meshes, bodies and all. */
  drop(b: Building): void {
    const rec = this.built.get(b);
    if (!rec) return;
    this.built.delete(b);
    rec.gone = true;
    const i = this.list.indexOf(rec);
    if (i >= 0) {
      this.list[i] = this.list[this.list.length - 1];
      this.list.pop();
    }
    this.takeDown(rec);
    if (b.doors === rec.view) b.doors = undefined;
    this.counts.dropped++;
  }

  private takeDown(rec: Built): void {
    for (let i = 0; i < rec.meshes.length; i++) this.scene.remove(rec.meshes[i]);
    rec.meshes.length = 0;
    for (let di = 0; di < rec.doors.length; di++) {
      const leaves = rec.doors[di].leaves;
      for (let li = 0; li < leaves.length; li++) {
        const leaf = leaves[li];
        takeLeafBody(this.physics, leaf.body, leaf.collider);
        leaf.body = null;
        leaf.collider = null;
      }
    }
    rec.view.ready = false;
    rec.view.outer.length = 0;
    rec.view.inner.length = 0;
  }

  /** The meshes and bodies of one building's doors, once their models are in, then their programs, then shown. */
  private async make(rec: Built, rows: readonly DoorRow[], styles: Record<string, DoorStyleRow>): Promise<void> {
    const pack = await this.models();
    if (!pack || rec.gone) return;
    const want = new Set<string>();
    for (const r of rows) {
      const s = styles[r.style];
      if (!s) continue;
      for (const id of [s.door, s.door2, s.frame]) if (id) want.add(id);
    }
    const loaded = new Map<string, LoadedModel>();
    for (const id of want) {
      if (!pack.find(id)) {
        if (this.missing.size < 50) this.missing.add(id);
        continue;
      }
      try {
        loaded.set(id, await pack.model(id));
      } catch (err) {
        if (!this.missing.has(id)) console.warn(`doors: the door model ${id} would not load`, err);
        this.missing.add(id);
      }
      if (rec.gone) return;
    }
    const b = rec.b;
    const outer: THREE.Object3D[] = [];
    const inner: THREE.Object3D[] = [];
    const innerCells: number[] = [];
    const sounds = new Set<string>();
    for (const row of rows) {
      const s = styles[row.style];
      if (!s) continue;
      const exit = isExitDoor(row.cells);
      const door: Door = {
        building: b,
        portal: row.portal,
        style: row.style,
        cells: row.cells,
        exit,
        x: 0,
        y: 0,
        z: 0,
        row,
        s,
        ox: 0,
        oy: 0,
        oz: 0,
        leaves: [],
        frame: [],
        motion: newDoorMotion(),
        hold: 0,
        fresh: true,
      };
      const hang = (id: string | null, flip: boolean, moves: boolean): void => {
        const model = id ? loaded.get(id) : undefined;
        if (!model) return;
        const base = leafBase(b.matrix, row.m, flip, new THREE.Matrix4());
        const meshes: THREE.Mesh[] = [];
        for (const prim of model.primitives) {
          const mesh = new THREE.Mesh(prim.geometry, prim.material);
          mesh.name = `door:${row.style}`;
          mesh.matrixAutoUpdate = false;
          mesh.matrix.copy(base);
          mesh.matrixWorld.copy(base);
          mesh.visible = false;
          mesh.receiveShadow = true;
          mesh.castShadow = exit && DOORS_TUNE.shadows && castsShadow(prim.material);
          if (exit) {
            // In the world's pass, and in its own building's rooms' pass by the layer it takes for that pass:
            // compiled for both, as a room's furniture is (`World.passesOf`).
            mesh.layers.set(0);
            markFurniture(mesh);
            outer.push(mesh);
          } else {
            mesh.layers.set(INTERIOR_LAYER);
            inner.push(mesh);
            innerCells.push(row.cells[0] ?? 0, row.cells[1] ?? 0);
          }
          this.scene.add(mesh);
          rec.meshes.push(mesh);
          meshes.push(mesh);
        }
        if (!moves) {
          door.frame.push(...meshes);
          return;
        }
        // The box a body is made of: the model's own, its corners taken as extents (a pack may store them
        // either way round), no thinner than the tune's least depth.
        const bb = model.def.bounds;
        const mid: [number, number, number] = [0, 0, 0];
        const half: [number, number, number] = [0, 0, 0];
        for (let a = 0; a < 3; a++) {
          const lo = Math.min(bb.min[a], bb.max[a]);
          const hi = Math.max(bb.min[a], bb.max[a]);
          mid[a] = (lo + hi) / 2;
          half[a] = Math.max(DOORS_TUNE.minDepth, (hi - lo) / 2);
        }
        door.leaves.push({ meshes, base, slide: leafSlide(base, s.move, new THREE.Vector3()), body: null, collider: null, mid, half });
      };
      hang(s.door, false, true);
      hang(s.door2, s.flip2, true);
      hang(s.frame, false, false);
      if (!door.leaves.length) continue;
      // Measured from the doorway's bottom middle, and heard from the first leaf's middle, shut.
      const first = door.leaves[0];
      const e = first.base.elements;
      door.ox = e[12];
      door.oy = e[13];
      door.oz = e[14];
      tmpP.set(first.mid[0], first.mid[1], first.mid[2]).applyMatrix4(first.base);
      door.x = tmpP.x;
      door.y = tmpP.y;
      door.z = tmpP.z;
      rec.spread = Math.max(rec.spread, Math.hypot(door.ox - b.x, door.oz - b.z));
      rec.trigger = Math.max(rec.trigger, s.trigger);
      for (const list of Object.values(s.sounds)) for (const id of list ?? []) sounds.add(id);
      rec.doors.push(door);
      rec.byPortal.set(row.portal, door);
    }
    rec.view.outer = outer;
    rec.view.inner = inner;
    rec.view.innerCells = Int16Array.from(innerCells);
    if (sounds.size) this.prepareSounds?.([...sounds]);
    if (this.prepare && rec.meshes.length) {
      try {
        await this.prepare(rec.meshes.slice());
      } catch (err) {
        console.warn('doors: a building’s doors could not be compiled ahead of their first draw; shown anyway', err);
      }
      if (rec.gone) return;
    }
    // Solid from the moment they are seen, and not before: a door nobody can see is no wall. Made where
    // the leaf hangs shut; the door's first step puts it where the bodies near it say outright, with no
    // swing (`moveLeafBody`'s jump), before the engine steps it once.
    for (let di = 0; di < rec.doors.length; di++) {
      const leaves = rec.doors[di].leaves;
      for (let li = 0; li < leaves.length; li++) {
        const leaf = leaves[li];
        const made = makeLeafBody(this.physics, leaf.base, leaf, DOORS_TUNE.solid);
        leaf.body = made.body;
        leaf.collider = made.collider;
      }
    }
    for (let i = 0; i < outer.length; i++) outer[i].visible = !isQuarantined(outer[i]);
    rec.view.ready = true;
  }

  /** A new step's openers: everything that may open a door is told again with `addOpener`. */
  beginOpeners(): void {
    this.n = 0;
  }

  /** One body that opens doors, its feet in the world and its kind (`OPENER`). */
  addOpener(x: number, y: number, z: number, kind: number): void {
    if (this.n >= this.okind.length) {
      const cap = this.okind.length * 2;
      const xyz = new Float64Array(cap * 3);
      xyz.set(this.ox);
      const k = new Uint8Array(cap);
      k.set(this.okind);
      this.ox = xyz;
      this.okind = k;
      this.near = new Int32Array(cap);
    }
    const i = this.n++;
    this.ox[i * 3] = x;
    this.ox[i * 3 + 1] = y;
    this.ox[i * 3 + 2] = z;
    this.okind[i] = kind;
  }

  /** How many openers this step was told of. */
  get openers(): number {
    return this.n;
  }

  /**
   * One step of every door: who is near it, its motion, its sounds, and where its leaves and their bodies
   * are -- written only while it moves. Called from the world's step, after the bodies have moved and
   * before the physics steps and the frame is drawn. Nothing allocated.
   */
  step(dt: number): void {
    const tune = DOORS_TUNE;
    this.movedList.length = 0;
    if (tune.solid !== this.solidNow) {
      this.solidNow = tune.solid;
      for (let i = 0; i < this.list.length; i++) {
        const doors = this.list[i].doors;
        for (let di = 0; di < doors.length; di++) {
          const leaves = doors[di].leaves;
          for (let li = 0; li < leaves.length; li++) leaves[li].collider?.setEnabled(tune.solid);
        }
      }
    }
    if (tune.shadows !== this.shadowsNow) {
      this.shadowsNow = tune.shadows;
      for (let i = 0; i < this.list.length; i++) {
        const outer = this.list[i].view.outer;
        for (let k = 0; k < outer.length; k++) {
          const mesh = outer[k] as THREE.Mesh;
          mesh.castShadow = tune.shadows && castsShadow(mesh.material);
        }
      }
    }
    if (!tune.on) return;
    for (let bi = 0; bi < this.list.length; bi++) {
      const rec = this.list[bi];
      if (!rec.view.ready) continue;
      const b = rec.b;
      // The bodies near enough to this building that any of its doors could be within their reach.
      const m = openersNear(b.x, b.z, rec.spread, rec.trigger, this.ox, this.n, this.near, tune);
      const doors = rec.doors;
      for (let di = 0; di < doors.length; di++) {
        const d = doors[di];
        const want = d.hold > 0 ? true : d.hold < 0 ? false : doorWanted<DoorView>(d, d.ox, d.oy, d.oz, d.s.trigger, d.motion.target === 1, this.ox, this.okind, this.near, m, this.mayOpen, this.counts, tune);
        if (d.fresh) {
          // Stood as it should be the moment it is seen, with no swing and nothing heard, and its bodies
          // put there outright rather than slid there.
          d.fresh = false;
          const mo = d.motion;
          mo.open = want ? 1 : 0;
          mo.from = mo.open;
          mo.target = mo.open;
          mo.moving = false;
          mo.idle = 0;
          this.pose(d, true);
          continue;
        }
        const events = stepDoor(d.motion, want, dt, d.s, tune);
        if (events && tune.sound) this.sound(d, events);
        if (d.motion.moving || events) this.pose(d, false);
      }
    }
  }

  /**
   * The door's leaves and their bodies where its motion has it. `jump` puts the bodies there outright,
   * for a door's first step; otherwise they slide there over the engine's next step and the leaves are
   * listed for the motion blur.
   */
  private pose(d: Door, jump: boolean): void {
    const open = d.motion.open;
    const at = this.at;
    const leaves = d.leaves;
    for (let li = 0; li < leaves.length; li++) {
      const leaf = leaves[li];
      leafAt(leaf.base, leaf.slide, open, tmpM);
      for (let i = 0; i < leaf.meshes.length; i++) {
        const mesh = leaf.meshes[i];
        mesh.matrix.copy(tmpM);
        mesh.matrixWorld.copy(tmpM);
        if (!jump) this.movedList.push(mesh);
      }
      const body = leaf.body;
      if (body) {
        const e = tmpM.elements;
        at.x = e[12];
        at.y = e[13];
        at.z = e[14];
        moveLeafBody(body, at, jump);
      }
    }
  }

  /** The sounds the moments it crossed name. */
  private sound(d: Door, events: number): void {
    const play = this.onSound;
    if (!play) return;
    const s = d.s.sounds;
    if (events & DOOR_EVENT.openBegin) this.playAll(s.openBegin, d, play);
    if (events & DOOR_EVENT.openEnd) this.playAll(s.openEnd, d, play);
    if (events & DOOR_EVENT.closeBegin) this.playAll(s.closeBegin, d, play);
    if (events & DOOR_EVENT.closeEnd) this.playAll(s.closeEnd, d, play);
  }

  private playAll(list: readonly string[] | undefined, d: Door, play: (id: string, door: DoorView) => void): void {
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      play(list[i], d);
      this.counts.sounds++;
    }
  }

  /** The door nearest a point, within `within` metres, for the console. */
  nearest(x: number, y: number, z: number, within = Infinity): { door: DoorView; d: number } | null {
    let best: Door | null = null;
    let bestD = within;
    for (const rec of this.list) {
      for (const d of rec.doors) {
        const dist = Math.hypot(d.ox - x, d.oy - y, d.oz - z);
        if (dist < bestD) {
          bestD = dist;
          best = d;
        }
      }
    }
    return best ? { door: best, d: bestD } : null;
  }

  /** Every door within `within` metres of a point, nearest first, as `describe` prints them. */
  around(x: number, y: number, z: number, within: number): Record<string, unknown>[] {
    const found: { d: Door; away: number }[] = [];
    for (const rec of this.list) {
      for (const d of rec.doors) {
        const away = Math.hypot(d.ox - x, d.oy - y, d.oz - z);
        if (away <= within) found.push({ d, away });
      }
    }
    found.sort((a, b) => a.away - b.away);
    return found.map((f) => this.describe(f.d, { x, y, z }));
  }

  /** Hold a door open (1), shut (-1) or let the bodies near it say again (0): the console's own test. */
  hold(door: DoorView, how: number): void {
    (door as Door).hold = how > 0 ? 1 : how < 0 ? -1 : 0;
  }

  /** One door as the console prints it. */
  describe(door: DoorView, from?: { x: number; y: number; z: number }): Record<string, unknown> {
    const d = door as Door;
    // The doorway's bottom middle in the world, and the way through it (the leaf's own Z).
    const e = d.leaves[0]?.base.elements;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return {
      at: [r2(d.ox), r2(d.oy), r2(d.oz)],
      through: e ? [r2(e[8]), r2(e[9]), r2(e[10])] : null,
      building: d.building.template,
      model: d.building.model.def.id,
      portal: d.portal,
      style: d.style,
      cells: d.cells,
      exit: d.exit,
      leaves: d.leaves.length,
      solid: d.leaves.every((l) => !!l.collider && l.collider.isEnabled()),
      open: Number(d.motion.open.toFixed(3)),
      moving: d.motion.moving,
      hold: d.hold,
      trigger: d.s.trigger,
      times: [d.s.open, d.s.close],
      move: d.s.move,
      sounds: d.s.sounds,
      fallback: !!d.row.fallback,
      ...(from ? { away: Number(Math.hypot(d.ox - from.x, d.oy - from.y, d.oz - from.z).toFixed(2)) } : {}),
    };
  }

  /** What the doors are doing, for the console. */
  status(): DoorsStatus {
    let doors = 0;
    let ready = 0;
    let open = 0;
    let moving = 0;
    let bodies = 0;
    for (const rec of this.list) {
      for (const d of rec.doors) {
        doors++;
        if (rec.view.ready) ready++;
        if (d.motion.open > 0.01) open++;
        if (d.motion.moving) moving++;
        for (const leaf of d.leaves) if (leaf.body) bodies++;
      }
    }
    return { on: DOORS_TUNE.on, models: this.modelsState, buildings: this.list.length, doors, ready, open, moving, bodies, openers: this.n, sounds: this.counts.sounds, refused: this.counts.refused, missingModels: [...this.missing] };
  }

  /** Every material of the door models loaded in this world, which the world forgets before they are disposed. */
  materials(): THREE.Material[] {
    return this.pack ? this.pack.loadedMaterials() : [];
  }

  /**
   * The world is going: every door comes down and the door models go with the world they were prepared
   * for, since their materials joined that world's shadow cascades and the portal renderer's set. The
   * caller forgets those (`materials`) first.
   */
  unload(): void {
    this.generation++;
    for (const rec of this.list) {
      rec.gone = true;
      this.takeDown(rec);
      if (rec.b.doors === rec.view) rec.b.doors = undefined;
    }
    this.list.length = 0;
    this.built.clear();
    this.movedList.length = 0;
    this.pack?.dispose();
    this.pack = null;
    this.packLoad = null;
    this.modelsState = 'not asked for';
    this.n = 0;
  }
}
