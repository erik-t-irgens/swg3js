// The ghost of a building being placed: where it would stand, whether it may, and the outline the
// client itself drew under it.
//
// The client had this and we know it did: a deed template declares `useStructureFootprintOutline`
// beside the name of its `.sfp` grid, so the game drew that grid on the ground while you moved the
// building about. This draws the same grid -- one quad a cell, the building's own cells one colour
// and the hard border round them another -- and the model itself over it, see-through.
//
// **Everything about it is ours** except the grid: how far ahead it starts, how far the wheel moves
// it, how fast the buttons turn it, and the two colours. They are `GHOST_TUNE` and live.
//
// Two things about it are not obvious. The model is the gallery pack's own and is **shared**, never
// cloned deep: a house is thousands of triangles and the ghost swaps every mesh's material for one
// see-through copy rather than making a second house. So the ghost owns those copies and gives them
// back, and the model it borrowed is left exactly as it was found. And the outline is drawn at the
// ground under each cell rather than on one plane, so on a slope it reads as the ground it is
// really testing rather than as a flat card floating over it.

import * as THREE from 'three';
import { colourHex } from '../core/palette.ts';
import { clearRadius, groundVerdict, patchOfFootprint, patchProbes, type Footprint, type Patch } from './housePlace.ts';

/** Every number of the ghost, all of them ours. Live through `__debug.place`. */
export const GHOST_TUNE = {
  /** How far ahead of the player it starts, metres. */
  reach: 18,
  /** The closest and furthest the wheel will push it, metres. */
  near: 6,
  far: 60,
  /** How far one notch of the wheel moves it, metres. */
  step: 2,
  /** How far one press of a turn key turns it, degrees. */
  turn: 15,
  /** How far one press of a height key lifts or drops it, metres. */
  rise: 0.25,
  /** The most it may be lifted or dropped off the ground either way, metres. */
  most: 8,
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
}

/**
 * Where a ghost stands for a player at `from` facing along `yaw`, pushed `reach` metres out.
 *
 * **The yaw is a body's heading, whose forward is `(sin yaw, cos yaw)`** -- not the camera's, whose
 * forward is the negative of it. The two conventions live side by side in this game and are a
 * quarter turn apart in neither: they are exactly opposite, so reading one as the other puts the
 * ghost behind the player's back, which is what it did. The patch's own offset is **not** taken off
 * here, unlike `spotAhead`, because the player is moving the building by eye and what they are
 * pointing at is where its origin goes.
 */
export function ghostSpot(from: { x: number; z: number }, yaw: number, reach: number): { x: number; z: number } {
  return { x: from.x + Math.sin(yaw) * reach, z: from.z + Math.cos(yaw) * reach };
}

/**
 * Whether a building may stand where the ghost is, and why not.
 *
 * It is the same three tests a house placed any other way makes -- the ground under its own
 * doorstep, what the world already has there, and the water -- with the footprint's own patch in
 * place of the model's box, because a deed carries the grid the game itself measured with.
 *
 * `lift` is the player's own nudge and is deliberately **outside** every test: it moves where the
 * building is put down without moving what the ground is asked about, because the ground test is
 * the one thing here that is not a matter of taste. So a doorway riding a little under the ground
 * can be lifted clear by hand, and a spot the ground refuses cannot be lifted into being allowed.
 */
export function ghostVerdict(patch: Patch, at: { x: number; z: number }, yaw: number, deps: GhostDeps, lift = 0): GhostState {
  const probes = patchProbes(patch, at, yaw);
  const heights = probes.map((p) => deps.heightAt(p.x, p.z));
  const v = groundVerdict(probes, heights);
  const clear = clearRadius(patch);
  const base: GhostState = { x: at.x, z: at.z, y: v.y + lift, yaw, ok: false, why: v.why, clear, lift };
  if (!v.ok) return base;
  // The sea is drawn over the ground rather than instead of it, so the ground test passes perfectly
  // well on a lake bed and this is what keeps a house out of one.
  if (probes.some((p, i) => deps.waterAt(p.x, p.z) > heights[i])) return { ...base, why: 'that is under water' };
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const mx = at.x + (patch.cx * cos - patch.cz * sin);
  const mz = at.z + (patch.cx * sin + patch.cz * cos);
  for (const s of deps.standing(mx, mz, clear)) {
    if (!(s.radius > 0)) continue;
    if (Math.hypot(s.x - mx, s.z - mz) < s.radius + clear) return { ...base, why: 'something is already standing there' };
  }
  return { ...base, ok: true, why: null };
}

/** The wheel: a notch in or out, kept between the near and the far. */
export function wheelReach(reach: number, notches: number, tune = GHOST_TUNE): number {
  return Math.min(tune.far, Math.max(tune.near, reach + notches * tune.step));
}

/** A turn key: one press, kept in one turn. */
export function turnBy(yaw: number, presses: number, tune = GHOST_TUNE): number {
  const turn = Math.PI * 2;
  const next = yaw + (presses * tune.turn * Math.PI) / 180;
  return ((next % turn) + turn) % turn;
}

/**
 * A height key: one press up or down, kept within `most` of the ground either way.
 *
 * It is here for the one case the ground test cannot help with -- a doorstep the ground laps over,
 * which is within everything `groundVerdict` allows and still leaves a door half buried -- and it
 * is bounded both ways so that it stays a nudge rather than a way to hang a house in the air.
 */
export function liftBy(lift: number, presses: number, tune = GHOST_TUNE): number {
  const next = lift + presses * tune.rise;
  return Math.min(tune.most, Math.max(-tune.most, Math.round(next / tune.rise) * tune.rise));
}

/**
 * The corners of every cell of a footprint, in the world, for a building at `at` turned by `yaw`:
 * one entry a cell with its four corners and whether it is the building's own ground.
 *
 * The cells are walked in the file's own order, so row 0 is the row the file writes first and the
 * pivot cell is where the building's origin stands. A cell the file marks `.` is nothing at all and
 * is left out rather than drawn as empty.
 */
export function outlineCells(f: Footprint, rows: readonly string[], at: { x: number; z: number }, yaw: number): { corners: { x: number; z: number }[]; hard: boolean }[] {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const out: { corners: { x: number; z: number }[]; hard: boolean }[] = [];
  const place = (lx: number, lz: number) => ({ x: at.x + lx * cos - lz * sin, z: at.z + lx * sin + lz * cos });
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

  /** Where the ghost stands and how it reads: green for a spot that will take it, red for one that will not. */
  place(state: GhostState, f: Footprint | null, rows: readonly string[], heightAt: (x: number, z: number) => number): void {
    this.ok = state.ok;
    this.group.position.set(state.x, state.y, state.z);
    this.group.rotation.set(0, state.yaw, 0);
    this.group.visible = !!this.model;
    for (const m of this.mine) {
      const mat = m as THREE.MeshStandardMaterial;
      if (mat.color) mat.color.set(colourHex(state.ok ? 'good' : 'bad'));
      if (mat.emissive) mat.emissive.set(colourHex(state.ok ? 'good' : 'bad')).multiplyScalar(0.25);
    }
    if (f) this.drawGrid(f, rows, state, heightAt);
  }

  /**
   * The grid, rebuilt in place: one quad a cell at the ground under it.
   *
   * The geometry is made once at the size the biggest footprint needs and written into afterwards,
   * because a placement moves every frame the mouse does and a new buffer a frame would orphan one
   * a frame -- the same rule the dashed lines on the space map are drawn by.
   */
  private drawGrid(f: Footprint, rows: readonly string[], state: GhostState, heightAt: (x: number, z: number) => number): void {
    const cells = outlineCells(f, rows, { x: 0, z: 0 }, 0);
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
    const good = new THREE.Color(colourHex(state.ok ? 'good' : 'bad'));
    const edge = new THREE.Color(colourHex(state.ok ? 'accent' : 'bad'));
    const cos = Math.cos(state.yaw);
    const sin = Math.sin(state.yaw);
    let v = 0;
    let i = 0;
    for (const cell of cells) {
      const c = cell.hard ? edge : good;
      for (const corner of cell.corners) {
        // The cells are built in the building's own frame and turned here, so the height each one
        // is drawn at is the real ground under it: on a slope the grid follows the ground.
        const wx = state.x + (corner.x * cos - corner.z * sin);
        const wz = state.z + (corner.x * sin + corner.z * cos);
        pos.setXYZ(v, corner.x, heightAt(wx, wz) - state.y + GHOST_TUNE.lift, corner.z);
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
  }
}

/** The patch a deed asks for: its own footprint's, which is the grid the client measured with. */
export function patchForFootprint(f: Footprint): Patch {
  return patchOfFootprint(f);
}
