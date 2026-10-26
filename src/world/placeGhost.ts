// The ghost of a building being placed: where it would stand, whether it may, and the outline the
// client itself drew under it.
//
// The client had this and we know it did: a deed template declares `useStructureFootprintOutline`
// beside the name of its `.sfp` grid, so the game drew that grid on the ground while you moved the
// building about. This draws the same grid -- one quad a cell, the building's own cells one colour
// and the hard border round them another -- and the model itself over it, see-through.
//
// **Everything about it is ours** except the grid: how far ahead it starts, how far the wheel moves
// it, how far it may be lifted, and the two colours. They are `GHOST_TUNE` and live; how a held key
// turns and lifts it is `PLACE_HOLD_TUNE`'s (`placeHold.ts`).
//
// Two things about it are not obvious. The model is the gallery pack's own and is **shared**, never
// cloned deep: a house is thousands of triangles and the ghost swaps every mesh's material for one
// see-through copy rather than making a second house. So the ghost owns those copies and gives them
// back, and the model it borrowed is left exactly as it was found. And the outline is drawn at the
// ground under each cell rather than on one plane, so on a slope it reads as the ground it is
// really testing rather than as a flat card floating over it.

import * as THREE from 'three';
import { colourHex } from '../core/palette.ts';
import { HOUSE_TUNE, clearRadius, groundVerdict, patchMiddle, patchOfFootprint, patchProbes, turnLocal, type Footprint, type GroundVerdict, type Patch } from './housePlace.ts';
import { keepLift, turnTo } from './placeHold.ts';

/** Every number of the ghost, all of them ours. Live through `__debug.deed(undefined, { tune })`. */
export const GHOST_TUNE = {
  /** How far ahead of the player it starts, metres. */
  reach: 18,
  /** The closest and furthest the wheel will push it, metres. */
  near: 6,
  far: 60,
  /**
   * How far one notch of the wheel moves it, metres. How far a held key turns or lifts it, and the grid
   * the wheel steps to while one is held, are `PLACE_HOLD_TUNE`'s (`placeHold.ts`).
   */
  step: 2,
  /**
   * The most it may be lifted or dropped off the ground either way, metres. The ground rules judge
   * the lift at the floor (`groundVerdict`), so on level ground the fall's own six metres refuses a
   * house well inside this; it is the hand's reach, not the rule.
   */
  most: 8,
  /**
   * The same reach in a permanent layer, metres, where a building may be sunk into a dune or set on
   * a ledge on purpose: the dev server's placement editor's, for a building whose destination is one
   * of the two files of permanent placements.
   */
  mostPermanent: 30,
  /** How see-through the building itself is while it is a ghost. */
  opacity: 0.45,
  /** How high over the ground the outline is drawn, metres: enough not to fight the ground for the pixel. */
  lift: 0.08,
};

/** What the ghost needs of the world around it, so a node test can hand it something small. */
export interface GhostDeps {
  /** The ground at a point, in the world's frame. */
  heightAt(x: number, z: number): number;
  /** The drawn water there, or -Infinity where a world has none. */
  waterAt(x: number, z: number): number;
  /** What the world already has standing within `reach` of a point. */
  standing(x: number, z: number, reach: number): { x: number; z: number; radius: number; template?: string }[];
}

/** Where the ghost is and whether it may be put down there. */
export interface GhostState {
  x: number;
  z: number;
  /** Where it stands, the player's own lift already in it: this is the height it is put down at. */
  y: number;
  yaw: number;
  ok: boolean;
  /** Why not, in the game's own words, or null. */
  why: string | null;
  /** How much ground it keeps to itself, for whoever places it. */
  clear: number;
  /** How far the player has lifted it off the ground themselves, metres, signed. */
  lift: number;
  /**
   * What the door's height off the ground will mean to whoever walks in -- a jump, or out of reach
   * of one -- or null. Never a refusal: the placing bar shows it beside an allowed spot.
   */
  note: string | null;
}

/**
 * The probes, the ground under them, the verdict on that ground and the patch's middle, kept rather
 * than made afresh for every frame a placement moves. `ghostVerdict` alone writes them, and nothing
 * it asks of the world asks it anything back, so none of them is written over while it is read.
 */
const PROBES: { x: number; z: number }[] = [];
const HEIGHTS: number[] = [];
const VERDICT: GroundVerdict = { ok: false, y: 0, rise: 0, sink: 0, slope: 0, why: null, note: null };
const MIDDLE = { x: 0, z: 0 };

/**
 * Where a ghost stands for a player at `from` facing along `yaw`, pushed `reach` metres out.
 *
 * **The yaw is a body's heading, whose forward is `(sin yaw, cos yaw)`** -- not the camera's, whose
 * forward is the negative of it. The two conventions live side by side in this game and are a
 * quarter turn apart in neither: they are exactly opposite, so reading one as the other puts the
 * ghost behind the player's back, which is what it did. The patch's own offset is **not** taken off
 * here, unlike `spotAhead`, because the player is moving the building by eye and what they are
 * pointing at is where its origin goes. The game hands it the heading of the camera's own direction
 * in the world, so the ghost goes where the player looks rather than where the body happens to face.
 *
 * Written into `out` when one is handed over: the frame keeps one.
 */
export function ghostSpot(from: { x: number; z: number }, yaw: number, reach: number, out?: { x: number; z: number }): { x: number; z: number } {
  const o = out ?? { x: 0, z: 0 };
  const x = from.x + Math.sin(yaw) * reach;
  const z = from.z + Math.cos(yaw) * reach;
  o.x = x;
  o.z = z;
  return o;
}

/**
 * Whether a building may stand where the ghost is, and why not.
 *
 * It is the same three tests a house placed any other way makes -- the ground under its own
 * doorstep, what the world already has there, and the water -- with the footprint's own patch in
 * place of the model's box, because a deed carries the grid the game itself measured with.
 *
 * `lift` is the player's own raise or drop and is **inside** the ground test: the rise and the fall
 * are measured from the floor it leaves (`groundVerdict`), because that is where the house really
 * stands. So a doorstep the ground laps over can be lifted clear, a house lowered into a slope is
 * refused for the ground it buries, and one hung in the air over level ground is refused for the
 * ground falling away under it. The slope, the water and what is in the way do not move with it.
 * How far the door then stands off the ground is the state's `note` and is never a refusal.
 *
 * The answer is written into `out`, the placement's own state, which a caller asking every frame keeps
 * (without one a record is made). The probes, their heights, the ground's verdict and the middle are
 * kept here and written over every call.
 */
export function ghostVerdict(patch: Patch, at: { x: number; z: number }, yaw: number, deps: GhostDeps, lift = 0, out?: GhostState): GhostState {
  const probes = patchProbes(patch, at, yaw, HOUSE_TUNE.margin, PROBES);
  HEIGHTS.length = probes.length;
  for (let i = 0; i < probes.length; i++) HEIGHTS[i] = deps.heightAt(probes[i].x, probes[i].z);
  const v = groundVerdict(probes, HEIGHTS, HOUSE_TUNE, lift, VERDICT);
  const clear = clearRadius(patch);
  // The verdict's height has the lift in it already, so it is not added here a second time.
  const state: GhostState = out ?? { x: 0, z: 0, y: 0, yaw: 0, ok: false, why: null, clear: 0, lift: 0, note: null };
  state.x = at.x;
  state.z = at.z;
  state.y = v.y;
  state.yaw = yaw;
  state.ok = false;
  state.why = v.why;
  state.clear = clear;
  state.lift = lift;
  state.note = v.note;
  if (!v.ok) return state;
  if (probesUnderWater(probes, HEIGHTS, deps)) {
    state.why = UNDER_WATER;
    return state;
  }
  const mid = patchMiddle(patch, at, yaw, MIDDLE);
  if (standingIn(mid.x, mid.z, clear, deps)) {
    state.why = ALREADY_STANDING;
    return state;
  }
  state.ok = true;
  state.why = null;
  return state;
}

/** The words a building under the drawn water is refused (a player) or noted (the world editor) in. */
export const UNDER_WATER = 'that is under water';
/** The words a building where the world already has something is refused or noted in. */
export const ALREADY_STANDING = 'something is already standing there';

/**
 * Whether the drawn water stands over the ground at any of a patch's probes (`heights` the ground at each). The sea is
 * drawn over the ground rather than instead of it, so the ground test passes perfectly well on a lake bed and this is
 * what keeps a house out of one. The one test the player's verdict and the world editor's notes both ask.
 */
export function probesUnderWater(probes: readonly { x: number; z: number }[], heights: readonly number[], deps: Pick<GhostDeps, 'waterAt'>): boolean {
  for (let i = 0; i < probes.length; i++) if (deps.waterAt(probes[i].x, probes[i].z) > heights[i]) return true;
  return false;
}

/**
 * What the world already has standing in a patch's circle (`clear` round its middle `mx`, `mz`), by its own radius: the
 * first such thing, or null. A thing with no radius is in the way of nothing. The one test the player's verdict and the
 * world editor's notes both ask.
 */
export function standingIn(mx: number, mz: number, clear: number, deps: Pick<GhostDeps, 'standing'>): { x: number; z: number; radius: number; template?: string } | null {
  for (const s of deps.standing(mx, mz, clear)) {
    if (!(s.radius > 0)) continue;
    if (Math.hypot(s.x - mx, s.z - mz) < s.radius + clear) return s;
  }
  return null;
}

/** The wheel: a notch in or out, kept between the near and the far. */
export function wheelReach(reach: number, notches: number, tune = GHOST_TUNE): number {
  return Math.min(tune.far, Math.max(tune.near, reach + notches * tune.step));
}

/**
 * A building turned to `yaw` radians, kept inside one turn, [0, 2π). It lives beside the hold that turns
 * it (`placeHold.ts`, which a frame of a held key runs through) and is named here as it always was.
 */
export { turnTo };

/**
 * A building lifted or dropped to `value` metres off the ground, kept within `most` either way and to
 * the centimetre -- what a server keeps of a house's height.
 *
 * It is here for the one case the ground test cannot help with -- a doorstep the ground laps over,
 * which is within everything `groundVerdict` allows and still leaves a door half buried -- and it is
 * bounded both ways by the hand's reach (`GHOST_TUNE.most`; a permanent layer's editor hands over
 * `mostPermanent`). Whether the house may stand where the lift leaves it is the ground test's, which
 * measures the rise and the fall from the floor.
 */
export function liftTo(value: number, most = GHOST_TUNE.most): number {
  return keepLift(value, most);
}

/** One cell of a footprint's grid: its four corners and whether the file marks it a hard edge. */
export interface OutlineCell {
  corners: { x: number; z: number }[];
  hard: boolean;
}

/**
 * The corners of every cell of a footprint, in the world, for a building at `at` turned by `yaw`:
 * one entry a cell with its four corners and whether it is the building's own ground.
 *
 * The cells are walked in the file's own order, so row 0 is the row the file writes first and the
 * pivot cell is where the building's origin stands. A cell the file marks `.` is nothing at all and
 * is left out rather than drawn as empty. Turned the way three turns the building (`turnLocal`).
 */
export function outlineCells(f: Footprint, rows: readonly string[], at: { x: number; z: number }, yaw: number): OutlineCell[] {
  const out: OutlineCell[] = [];
  const place = (lx: number, lz: number) => {
    const p = turnLocal(lx, lz, yaw, { x: 0, z: 0 });
    p.x += at.x;
    p.z += at.z;
    return p;
  };
  for (let r = 0; r < f.height; r++) {
    const row = rows[r] ?? '';
    for (let c = 0; c < f.width; c++) {
      const ch = row[c] ?? '.';
      if (ch !== 'F' && ch !== 'H') continue;
      // The origin stands at the middle of the pivot cell, so a cell's own corners are measured
      // from there: the same arithmetic the patch uses, one cell at a time.
      const x0 = (c - f.pivotX - 0.5) * f.cellWidth;
      const z0 = (r - f.pivotZ - 0.5) * f.cellHeight;
      out.push({
        corners: [place(x0, z0), place(x0 + f.cellWidth, z0), place(x0 + f.cellWidth, z0 + f.cellHeight), place(x0, z0 + f.cellHeight)],
        hard: ch === 'H',
      });
    }
  }
  return out;
}

/** Whether two footprints are the same grid, field by field. */
function sameFootprint(a: Footprint, b: Footprint): boolean {
  return a.width === b.width && a.height === b.height && a.pivotX === b.pivotX && a.pivotZ === b.pivotZ && a.cellWidth === b.cellWidth && a.cellHeight === b.cellHeight;
}

/** Whether two lists of a footprint's rows say the same, row by row. */
function sameRows(a: readonly string[] | null, b: readonly string[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The ghost itself: a model made see-through, and the grid under it.
 *
 * Nothing here decides anything -- `ghostVerdict` does -- and nothing here is ever drawn until the
 * game gives it a model. It is a group in the world's own scene, hidden when there is no placement
 * in hand.
 */
export class PlacementGhost {
  readonly group = new THREE.Group();
  /** The model being placed, borrowed from the garage's cache; never disposed here. */
  private model: THREE.Object3D | null = null;
  /** Each mesh whose material this swapped, and what it wore before. */
  private swapped: { mesh: THREE.Mesh; was: THREE.Material | THREE.Material[] }[] = [];
  /** The see-through copies this made, which are this object's to dispose. */
  private mine: THREE.Material[] = [];
  private grid: THREE.Mesh | null = null;
  private gridGeometry: THREE.BufferGeometry | null = null;
  private gridMaterial: THREE.MeshBasicMaterial | null = null;
  /**
   * The footprint's cells in the building's own frame, worked out once per footprint and kept: the
   * grid is drawn every frame a placement moves, and `outlineCells` makes a record a corner.
   */
  private cells: OutlineCell[] | null = null;
  /** What `cells` was worked out for, compared by value: a deed hands over a fresh footprint each frame. */
  private cellsFoot: Footprint | null = null;
  private cellsRows: readonly string[] | null = null;
  /** A corner carried into the world, and the two colours, kept rather than made a frame at a time. */
  private readonly corner = { x: 0, z: 0 };
  private readonly fill = new THREE.Color();
  private readonly edge = new THREE.Color();
  ok = true;

  constructor() {
    this.group.name = 'placement-ghost';
    this.group.visible = false;
    // Never a shadow caster and never lit by the cascades: it is a picture of a decision.
    this.group.matrixAutoUpdate = true;
  }

  /** Whether a model is in hand. */
  get holding(): boolean {
    return !!this.model;
  }

  /** The footprint's cells as the grid last drew them, in the building's own frame, or null. */
  get outline(): readonly OutlineCell[] | null {
    return this.cells;
  }

  /** The kept cells for this footprint, worked out again only when the footprint or its rows change. */
  private outlineFor(f: Footprint, rows: readonly string[]): OutlineCell[] {
    if (!this.cells || !this.cellsFoot || !sameFootprint(this.cellsFoot, f) || !sameRows(this.cellsRows, rows)) {
      this.cells = outlineCells(f, rows, { x: 0, z: 0 }, 0);
      this.cellsFoot = { ...f };
      this.cellsRows = rows.slice();
    }
    return this.cells;
  }

  /**
   * Take a model to place. The model is **borrowed**: every mesh keeps its geometry and gets a
   * see-through copy of its material for as long as the ghost holds it, and `release` puts the
   * originals back. A model already held is given back first.
   */
  hold(model: THREE.Object3D): void {
    this.release();
    this.model = model;
    model.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      this.swapped.push({ mesh, was: mesh.material });
      const make = (m: THREE.Material) => {
        const copy = m.clone();
        copy.transparent = true;
        copy.opacity = GHOST_TUNE.opacity;
        copy.depthWrite = false;
        this.mine.push(copy);
        return copy;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(make) : make(mesh.material);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
    });
    this.group.add(model);
    this.group.visible = true;
  }

  /** Give the model back exactly as it was found, and drop every copy this made. */
  release(): THREE.Material[] {
    for (const s of this.swapped) s.mesh.material = s.was;
    this.swapped = [];
    if (this.model) this.group.remove(this.model);
    this.model = null;
    const gone = this.mine;
    this.mine = [];
    for (const m of gone) m.dispose();
    this.group.visible = false;
    return gone;
  }

  /**
   * Where the ghost stands and how it reads: green for a spot that will take it, red for one that will not --
   * or, where `allowed` says so, the accent for a spot that will (the dev server's editor, putting it down for
   * good). Colours only, so no program changes. A building with no footprint (one taken by its model alone)
   * draws no grid.
   */
  place(state: GhostState, f: Footprint | null, rows: readonly string[], heightAt: (x: number, z: number) => number, allowed: 'good' | 'accent' = 'good'): void {
    this.ok = state.ok;
    this.group.position.set(state.x, state.y, state.z);
    this.group.quaternion.identity();
    this.group.rotation.set(0, state.yaw, 0);
    this.group.visible = !!this.model;
    for (const m of this.mine) {
      const mat = m as THREE.MeshStandardMaterial;
      if (mat.color) mat.color.set(colourHex(state.ok ? allowed : 'bad'));
      if (mat.emissive) mat.emissive.set(colourHex(state.ok ? allowed : 'bad')).multiplyScalar(0.25);
    }
    if (!f) {
      this.hideGrid();
      return;
    }
    if (this.grid) this.grid.visible = true;
    this.drawGrid(f, rows, state, heightAt, allowed);
  }

  /**
   * The same for a prop, which has no footprint grid and a turn about all three axes.
   *
   * No grid because there is nothing to draw one of: a `.sfp` footprint is a structure's and a prop
   * has none, and a grid under a teacup would say nothing anybody needs. And a quaternion rather
   * than a yaw because the owner asked to be able to lay a crate on its side.
   */
  placeProp(at: { x: number; y: number; z: number }, turn: { x: number; y: number; z: number; w: number }, ok: boolean, allowed: 'good' | 'accent' = 'good'): void {
    this.ok = ok;
    this.group.position.set(at.x, at.y, at.z);
    this.group.quaternion.set(turn.x, turn.y, turn.z, turn.w);
    this.group.visible = !!this.model;
    for (const m of this.mine) {
      const mat = m as THREE.MeshStandardMaterial;
      if (mat.color) mat.color.set(colourHex(ok ? allowed : 'bad'));
      if (mat.emissive) mat.emissive.set(colourHex(ok ? allowed : 'bad')).multiplyScalar(0.25);
    }
    this.hideGrid();
  }

  /** The grid put away, for a ghost that has none. */
  private hideGrid(): void {
    if (this.grid) this.grid.visible = false;
  }

  /**
   * The grid, rebuilt in place: one quad a cell at the ground under it.
   *
   * The geometry is made once at the size the biggest footprint needs and written into afterwards,
   * because a placement moves every frame the mouse does and a new buffer a frame would orphan one
   * a frame -- the same rule the dashed lines on the space map are drawn by. The cells are kept per
   * footprint and each corner is turned through one kept record, so drawing it makes no records.
   */
  private drawGrid(f: Footprint, rows: readonly string[], state: GhostState, heightAt: (x: number, z: number) => number, allowed: 'good' | 'accent' = 'good'): void {
    const cells = this.outlineFor(f, rows);
    const want = cells.length * 4;
    if (!this.gridGeometry || (this.gridGeometry.getAttribute('position')?.count ?? 0) < want) {
      this.gridGeometry?.dispose();
      this.gridGeometry = new THREE.BufferGeometry();
      this.gridGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(want, 4) * 3), 3));
      this.gridGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(Math.max(want, 4) * 3), 3));
      this.gridGeometry.setIndex(new THREE.BufferAttribute(new Uint32Array(Math.max(cells.length, 1) * 6), 1));
      if (!this.gridMaterial) {
        this.gridMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
        this.gridMaterial.toneMapped = false;
      }
      if (this.grid) this.group.remove(this.grid);
      this.grid = new THREE.Mesh(this.gridGeometry, this.gridMaterial);
      this.grid.frustumCulled = false;
      this.grid.renderOrder = 4;
      this.group.add(this.grid);
    }
    const pos = this.gridGeometry.getAttribute('position') as THREE.BufferAttribute;
    const col = this.gridGeometry.getAttribute('color') as THREE.BufferAttribute;
    const idx = this.gridGeometry.getIndex() as THREE.BufferAttribute;
    const good = this.fill.set(colourHex(state.ok ? allowed : 'bad'));
    const edge = this.edge.set(colourHex(state.ok ? 'accent' : 'bad'));
    let v = 0;
    let i = 0;
    for (const cell of cells) {
      const c = cell.hard ? edge : good;
      for (const corner of cell.corners) {
        // The cells are built in the building's own frame and drawn there, under a group three
        // turns by the yaw; the ground each is drawn at is asked for at the same corner turned the
        // same way, so on a slope the grid lies on the ground under the house's own walls.
        const w = turnLocal(corner.x, corner.z, state.yaw, this.corner);
        pos.setXYZ(v, corner.x, heightAt(state.x + w.x, state.z + w.z) - state.y + GHOST_TUNE.lift, corner.z);
        col.setXYZ(v, c.r, c.g, c.b);
        v++;
      }
      const b = v - 4;
      idx.setX(i++, b);
      idx.setX(i++, b + 1);
      idx.setX(i++, b + 2);
      idx.setX(i++, b);
      idx.setX(i++, b + 2);
      idx.setX(i++, b + 3);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    idx.needsUpdate = true;
    this.gridGeometry.setDrawRange(0, i);
  }

  /** Everything this made, for a world going away. */
  dispose(): void {
    this.release();
    if (this.grid) this.group.remove(this.grid);
    this.grid = null;
    this.gridGeometry?.dispose();
    this.gridGeometry = null;
    this.gridMaterial?.dispose();
    this.gridMaterial = null;
    this.cells = null;
    this.cellsFoot = null;
    this.cellsRows = null;
  }
}

/** The patch a deed asks for: its own footprint's, which is the grid the client measured with. */
export function patchForFootprint(f: Footprint): Patch {
  return patchOfFootprint(f);
}

/** What the world editor's ghost needs of the game: where to hang its meshes, how to prepare them, and the actor layer. */
export interface EditorGhostHost {
  add(o: THREE.Object3D): void;
  remove(o: THREE.Object3D): void;
  /** The streamer's own prepare (`World.prepareLikeStreamed`): what every streamed tier is compiled through before it shows. */
  prepare(meshes: THREE.Object3D[]): Promise<void>;
  /** The layer a room's pass draws what stands in it with (`ACTOR_LAYER`). */
  actorLayer: number;
}

/**
 * The world editor's ghost (DESIGN.md §2.3), which is **not** the players' see-through ghost above: the thing in hand
 * drawn as it will stand, on the very geometry, materials and instancing the streamer draws a placement with
 * (`LayoutStreamer.ghostMeshesOf`), so it builds no program a placement of the same model would not -- a model the world
 * already draws builds nothing, and one nobody has drawn yet is prepared through the streamer's own prepare and stays
 * hidden until it has been (the editor draws its box on the overlay meanwhile). In a room it takes the actor layer, but
 * only once a second prepare with that layer on has built its room-pass programs; until then it is its box alone.
 * Its one matrix is written in place each frame. A click leaves copies of it on the same geometry and materials where it
 * was put (`leaveBehind`), which the caller takes away once the stood row's own meshes are built, so there is no gap.
 */
export class EditorGhost {
  /** The meshes in hand, one a primitive, hung hidden until prepared. */
  meshes: THREE.InstancedMesh[] = [];
  /** What is in hand, by the library's key; '' for nothing. */
  key = '';
  /** Prepared for the world's pass, and for a room's. */
  ready = false;
  roomReady = false;
  /** Whether the last place it was put is in a room. */
  inRoom = false;
  private readonly host: EditorGhostHost;
  private gen = 0;
  private roomAsked = false;
  private hidden = false;

  constructor(host: EditorGhostHost) {
    this.host = host;
  }

  /** Whether it is drawn now (prepared, and in a room prepared for that too). */
  get shown(): boolean {
    return this.meshes.length > 0 && !this.hidden && this.ready && (!this.inRoom || this.roomReady);
  }

  /** Take these meshes in hand (what was in hand goes): hung hidden, prepared, then shown where it was last put. */
  set(key: string, meshes: THREE.InstancedMesh[]): void {
    this.clear();
    this.key = key;
    this.meshes = meshes;
    for (const m of meshes) {
      m.visible = false;
      this.host.add(m);
    }
    const g = ++this.gen;
    const done = (): void => {
      if (g !== this.gen) return;
      this.ready = true;
      this.apply();
    };
    this.host.prepare(meshes).then(done, done);
  }

  /** Put it at a matrix this frame, in a room or not. Nothing is made. */
  place(m: THREE.Matrix4, inRoom: boolean): void {
    for (const mesh of this.meshes) {
      mesh.setMatrixAt(0, m);
      mesh.instanceMatrix.needsUpdate = true;
    }
    this.inRoom = inRoom;
    if (inRoom && !this.roomAsked && this.ready) {
      // Its room-pass programs, built once, through the same prepare, with the actor layer on while it is hidden.
      this.roomAsked = true;
      const g = this.gen;
      for (const mesh of this.meshes) mesh.layers.enable(this.host.actorLayer);
      const done = (): void => {
        if (g !== this.gen) return;
        this.roomReady = true;
        this.apply();
      };
      this.host.prepare(this.meshes).then(done, done);
    }
    this.apply();
  }

  /** Hide it (nothing to aim at, a panel over the world) or show it again. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.apply();
  }

  private apply(): void {
    const show = this.shown;
    const actor = this.inRoom && this.roomReady;
    for (const mesh of this.meshes) {
      mesh.visible = show;
      if (this.roomReady) {
        if (actor) mesh.layers.enable(this.host.actorLayer);
        else mesh.layers.disable(this.host.actorLayer);
      }
    }
  }

  /**
   * Copies of what is in hand where it stands now, on the same geometry and materials (no program), hung and shown as
   * the ghost is: what stands in the gap between a click and the stood row's own meshes. The caller takes them away
   * with `dropLeft`.
   */
  leaveBehind(): THREE.InstancedMesh[] {
    const out: THREE.InstancedMesh[] = [];
    if (!this.shown) return out;
    for (const mesh of this.meshes) {
      const c = new THREE.InstancedMesh(mesh.geometry, mesh.material, 1);
      c.instanceMatrix.copy(mesh.instanceMatrix);
      c.instanceMatrix.needsUpdate = true;
      c.layers.mask = mesh.layers.mask;
      c.castShadow = mesh.castShadow;
      c.receiveShadow = mesh.receiveShadow;
      c.renderOrder = mesh.renderOrder;
      c.frustumCulled = false;
      c.userData = { ...mesh.userData };
      this.host.add(c);
      out.push(c);
    }
    return out;
  }

  /** Copies left behind taken away: out of the scene, their instance buffers let go (never the shared geometry or materials). */
  dropLeft(left: readonly THREE.InstancedMesh[]): void {
    for (const c of left) {
      this.host.remove(c);
      c.dispose();
    }
  }

  /** Nothing in hand: the meshes out of the scene and their instance buffers let go, the model's own left as they were. */
  clear(): void {
    this.gen++;
    for (const m of this.meshes) {
      this.host.remove(m);
      m.dispose();
    }
    this.meshes = [];
    this.key = '';
    this.ready = false;
    this.roomReady = false;
    this.roomAsked = false;
    this.inRoom = false;
  }
}
