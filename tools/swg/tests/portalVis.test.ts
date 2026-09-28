// The portal renderer's visible set (src/world/portalVis.ts), checked without a browser: the flood
// through the portals on screen rectangles must never leave out a room a ray from the camera's own room
// reaches through the portals, over the real packs' Mos Eisley cantina, Bestine capitol and Theed
// hangar (and, when they are here, Mustafar's crashed ship with its torn bridge portal off its own plane,
// the Theed palace and the old republic facility for size). That is the gate: a grid of rays from sample
// cameras in every room, from cameras standing in and beside every doorway, and from cameras outside in
// front of every exit (the flood from the street decides which rooms each door shows), each ray walked
// portal by portal through the manifest's own room graph (never the flood's), and every room it enters
// must be in the flood's set with the ray's pixel inside that room's rectangle, and every exit it reaches
// in range must have set `worldSeen` with the pixel inside `exitRect`. Then the near-plane clip (a portal
// wholly behind the camera gives nothing), the doorway rule, an unreachable exit leaving the world unseen,
// the camera-outside-its-box and too-many-visits fallbacks, the camera's room walked from the eye, the
// door range by a doorway's size, the renderer's own door tests against the flood's, the rooms built a
// lead ahead of their doors, the frustum through the exits' rectangle and what the narrowing hides and
// puts back, the narrowing's light guard, and nothing allocated by a frame's work (run with node
// --expose-gc for that one).
//
// The packs are read only for their rooms' boxes and portal polygons; nothing is written, and only counts
// are printed.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';
import * as THREE from 'three';
import { crossing, doorRangeOf, ExitNarrowing, exitFrustum, INTERIOR_LEAD, interiorBuildRange, interiorReachOf, markNarrowRoot, NARROW_STATS, PORTAL_CULL, PORTAL_RANGE, PortalVisibility, topoOf, walkCameraCell, type CameraCell, type NarrowRoot, type PortalCullTune, type VisBuilding } from '../../../src/world/portalVis.ts';
import type { Portal } from '../../../src/world/assetPack.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

interface Def {
  id: string;
  bounds: { min: number[]; max: number[] };
  cells?: { index: number; name: string; bounds: { min: number[]; max: number[] }; portals?: { geometry: number; target: number; passable: boolean }[] }[];
  portals?: { v: number[][]; i: number[] }[];
}

/** The portals as the game's own pack loader makes them (`AssetPack.model`): polygons in model space with the cells either side. */
function portalsOf(def: Def): Portal[] {
  const portals: Portal[] = (def.portals ?? []).map((poly) => {
    const verts = poly.v.map((v) => new THREE.Vector3(v[0], v[1], v[2]));
    const indices = poly.i.filter((k) => k >= 0 && k < verts.length);
    const normal = new THREE.Vector3(0, 0, 1);
    if (indices.length >= 3) {
      const a = verts[indices[0]];
      const b = verts[indices[1]];
      const c = verts[indices[2]];
      normal.copy(b).sub(a).cross(new THREE.Vector3().copy(c).sub(a)).normalize();
    }
    return { verts, indices, normal, d: verts.length ? normal.dot(verts[indices[0] ?? 0]) : 0, links: [], passable: true };
  });
  for (const c of def.cells ?? []) {
    for (const link of c.portals ?? []) {
      const portal = portals[link.geometry];
      if (!portal) continue;
      portal.links.push({ from: c.index, to: link.target });
      if (!link.passable) portal.passable = false;
    }
  }
  return portals;
}

/**
 * A building as the test sees it. The room graph the rays walk (`adj`) is read here straight from the
 * manifest's own cell links and never from `topoOf`, which is the code under test: were the flood's own
 * graph to lose or misroute a portal, the rays walking that same graph would agree with it and pass.
 */
type TestBuilding = VisBuilding & {
  def: Def;
  world: THREE.Vector3[][];
  /** Per room, the (portal, room beyond) pairs its manifest links give, both ways round. */
  adj: Map<number, { k: number; to: number }[]>;
  /** The portals with a link to the world (cell 0). */
  exits: number[];
  /** Each portal's middle and radius in the world. */
  mid: THREE.Vector3[];
  rad: number[];
};

function buildingOf(def: Def, x: number, y: number, z: number, yaw: number): TestBuilding {
  const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
  const portals = portalsOf(def);
  const { min, max } = def.bounds;
  const radius = Math.max(Math.abs(max[0] - min[0]), Math.abs(max[2] - min[2])) / 2;
  const world = portals.map((p) => p.verts.map((v) => v.clone().applyMatrix4(matrix)));
  const adj = new Map<number, { k: number; to: number }[]>();
  const link = (c: number, k: number, to: number) => {
    let list = adj.get(c);
    if (!list) adj.set(c, (list = []));
    if (!list.some((e) => e.k === k && e.to === to)) list.push({ k, to });
  };
  const exits = new Set<number>();
  for (const c of def.cells ?? []) {
    for (const l of c.portals ?? []) {
      if (l.geometry < 0 || l.geometry >= portals.length || l.target < 0) continue;
      if (c.index === 0 || l.target === 0) exits.add(l.geometry);
      if (l.target === c.index) continue;
      link(c.index, l.geometry, l.target);
      link(l.target, l.geometry, c.index);
    }
  }
  const mid = world.map((vs) => vs.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, vs.length)));
  const rad = world.map((vs, k) => vs.reduce((m, v) => Math.max(m, v.distanceTo(mid[k])), 0));
  return { model: { portals, def }, matrix, inverse: matrix.clone().invert(), x, z, radius, def, world, adj, exits: [...exits].sort((a, c) => a - c), mid, rad };
}

/** Whether a point in the building's frame lies in any room's box (the boxes as stored, corners either way round). */
function inAnyRoom(b: TestBuilding, lp: THREE.Vector3): boolean {
  return (b.def.cells ?? []).some((c) => c.index > 0 && [0, 1, 2].every((a) => lp.getComponent(a) >= Math.min(c.bounds.min[a], c.bounds.max[a]) && lp.getComponent(a) <= Math.max(c.bounds.min[a], c.bounds.max[a])));
}

/** A seeded random number, so every run tries the same cameras. */
let seed = 20260928;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 0x100000000);

const W = 1920;
const H = 1080;
const camera = new THREE.PerspectiveCamera(60, W / H, 0.05, 9000);
function place(pos: THREE.Vector3, yaw: number, pitch: number): void {
  camera.position.copy(pos);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  camera.updateMatrixWorld(true);
}
function lookFrom(pos: THREE.Vector3, target: THREE.Vector3): void {
  camera.position.copy(pos);
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
}

const tune: PortalCullTune = { ...PORTAL_CULL, on: true, mode: 'rooms' };
const vis = new PortalVisibility(tune);

// ---- The ray walk: the thing the flood must never fall short of. ----
const e1 = new THREE.Vector3();
const e2 = new THREE.Vector3();
const pv = new THREE.Vector3();
const sv = new THREE.Vector3();
const qv = new THREE.Vector3();
/** Ray against a triangle, both faces (Möller and Trumbore), a hair generous at the edges: the distance along the ray, or -1. */
function rayTri(o: THREE.Vector3, d: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
  e1.subVectors(b, a);
  e2.subVectors(c, a);
  pv.crossVectors(d, e2);
  const det = e1.dot(pv);
  if (Math.abs(det) < 1e-12) return -1;
  const inv = 1 / det;
  sv.subVectors(o, a);
  const u = sv.dot(pv) * inv;
  if (u < -1e-6 || u > 1 + 1e-6) return -1;
  qv.crossVectors(sv, e1);
  const v = d.dot(qv) * inv;
  if (v < -1e-6 || u + v > 1 + 1e-6) return -1;
  return e2.dot(qv) * inv;
}

const ray = new THREE.Vector3();
const rect = new Float64Array(4);
const within = (x: number, y: number, r: ArrayLike<number>) => x >= r[0] - 1e-9 && x <= r[2] + 1e-9 && y >= r[1] - 1e-9 && y <= r[3] + 1e-9;

interface Tally {
  cameras: number;
  flooded: number;
  fallbackBox: number;
  fallbackVisits: number;
  rays: number;
  entered: number;
  exits: number;
  seenRooms: number;
  worldSeen: number;
  visits: number;
  misses: string[];
}
const tallyOf = (): Tally => ({ cameras: 0, flooded: 0, fallbackBox: 0, fallbackVisits: 0, rays: 0, entered: 0, exits: 0, seenRooms: 0, worldSeen: 0, visits: 0, misses: [] });

/**
 * Flood from `cell` with the camera where it is (0: from outside, through the building's doors), then
 * walk a grid of pixel rays through the manifest's own room graph and hold the flood to every one.
 */
function checkCamera(b: TestBuilding, cell: number, t: Tally, nx = 24, ny = 14): void {
  const outside = cell === 0;
  const res = outside ? vis.compute(camera, null, 0, [b], 1, W, H) : vis.compute(camera, b, cell, [], 0, W, H);
  t.cameras++;
  if (res.fallback === 'box') t.fallbackBox++;
  else if (res.fallback === 'visits') t.fallbackVisits++;
  else t.flooded++;
  t.visits += res.visits;
  if (res.worldSeen) t.worldSeen++;
  const seen = vis.seenOf(b);
  if (!seen) {
    t.misses.push(`no set for ${b.def.id} cell ${cell}`);
    return;
  }
  for (let c = 1; c < seen.length; c++) if (seen[c] === 1) t.seenRooms++;
  const o = camera.position;
  // A door counts only within the range the renderer draws it from, measured here from the test's own
  // middle and radius of it.
  const inRange = (k: number) => b.mid[k].distanceTo(o) <= doorRangeOf(b.rad[k], tune);
  // The camera may really be in any room whose box holds it (boxes overlap), whichever one it was named
  // as in: the rays are walked from each of them.
  const starts = [cell];
  if (!outside) {
    const lp = o.clone().applyMatrix4(b.inverse);
    for (const c of b.def.cells ?? []) {
      if (c.index <= 0 || c.index === cell) continue;
      const lo = [0, 1, 2].map((a) => Math.min(c.bounds.min[a], c.bounds.max[a]));
      const hi = [0, 1, 2].map((a) => Math.max(c.bounds.min[a], c.bounds.max[a]));
      if (lp.x >= lo[0] && lp.y >= lo[1] && lp.z >= lo[2] && lp.x <= hi[0] && lp.y <= hi[1] && lp.z <= hi[2]) starts.push(c.index);
    }
  }
  for (const from of starts) for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const x = ((i + 0.5) / nx) * 2 - 1;
      const y = ((j + 0.5) / ny) * 2 - 1;
      ray.set(x, y, 0.5).unproject(camera).sub(o).normalize();
      t.rays++;
      let cur = from;
      let t0 = 0;
      for (let step = 0; step < 64; step++) {
        let bestT = Infinity;
        let bestTo = -1;
        let bestK = -1;
        for (const { k, to } of b.adj.get(cur) ?? []) {
          // From the world, only through a door the renderer draws.
          if (cur === 0 && !inRange(k)) continue;
          const wv = b.world[k];
          const idx = b.model.portals[k].indices;
          for (let q = 0; q + 2 < idx.length; q += 3) {
            const hit = rayTri(o, ray, wv[idx[q]], wv[idx[q + 1]], wv[idx[q + 2]]);
            if (hit > t0 + 1e-7 && hit < bestT) {
              bestT = hit;
              bestTo = to;
              bestK = k;
            }
          }
        }
        if (bestK < 0) break;
        if (bestTo === 0) {
          // Back out into the world from outside: the world is drawn whole already.
          if (outside) break;
          // An exit: required only when it is within the range the renderer draws a door from.
          if (inRange(bestK)) {
            t.exits++;
            if (!res.worldSeen || !within(x, y, res.exitRect)) t.misses.push(`${b.def.id}: from cell ${cell} a ray at (${x.toFixed(2)}, ${y.toFixed(2)}) leaves by exit ${bestK} but worldSeen ${res.worldSeen} exitRect [${[...res.exitRect].map((v) => v.toFixed(3)).join(', ')}]`);
          }
          break;
        }
        t.entered++;
        if (seen[bestTo] !== 1 || !vis.rectOf(b, bestTo, rect) || !within(x, y, rect)) {
          t.misses.push(`${b.def.id}: from ${outside ? 'outside' : `cell ${cell}`} at (${o.x.toFixed(2)}, ${o.y.toFixed(2)}, ${o.z.toFixed(2)}) a ray at (${x.toFixed(2)}, ${y.toFixed(2)}) enters cell ${bestTo} through portal ${bestK} at ${bestT.toFixed(3)} m, but it is ${seen[bestTo] === 1 ? `seen through [${[...rect].map((v) => v.toFixed(3)).join(', ')}]` : 'not seen'}`);
          break;
        }
        cur = bestTo;
        t0 = bestT;
      }
    }
  }
}

const local = new THREE.Vector3();
/** Cameras on a grid in every room's box and in and beside every doorway, each looking eight ways. */
function sweep(b: TestBuilding, t: Tally, opts: { pitches: number[]; grid: number[]; heights: number[]; doorways: boolean }): void {
  for (const c of b.def.cells ?? []) {
    if (c.index <= 0) continue;
    const lo = [0, 1, 2].map((a) => Math.min(c.bounds.min[a], c.bounds.max[a]));
    const hi = [0, 1, 2].map((a) => Math.max(c.bounds.min[a], c.bounds.max[a]));
    for (const fx of opts.grid) {
      for (const fz of opts.grid) {
        for (const fy of opts.heights) {
          local.set(lo[0] + (hi[0] - lo[0]) * fx, lo[1] + Math.min(hi[1] - lo[1], 1.6 + (hi[1] - lo[1] - 1.6) * fy), lo[2] + (hi[2] - lo[2]) * fz).applyMatrix4(b.matrix);
          for (let yi = 0; yi < 8; yi++) {
            for (const pitch of opts.pitches) {
              place(local, (yi * Math.PI) / 4, pitch);
              checkCamera(b, c.index, t);
            }
          }
        }
      }
    }
  }
  if (!opts.doorways) return;
  // In and beside every doorway, on both sides, taken as standing in either room it joins.
  const n = new THREE.Vector3();
  const mid = new THREE.Vector3();
  b.model.portals.forEach((p, k) => {
    if (!p.verts.length) return;
    mid.set(0, 0, 0);
    for (const v of p.verts) mid.add(v);
    mid.multiplyScalar(1 / p.verts.length);
    n.copy(p.normal);
    const rooms = new Set<number>();
    for (const [c, list] of b.adj) if (c > 0 && list.some((e) => e.k === k)) rooms.add(c);
    for (const room of rooms) {
      for (const off of [-0.6, -0.3, -0.05, 0.05, 0.3, 0.6]) {
        local.copy(mid).addScaledVector(n, off).applyMatrix4(b.matrix);
        for (let yi = 0; yi < 8; yi++) {
          place(local, (yi * Math.PI) / 4, 0);
          checkCamera(b, room, t);
        }
      }
    }
  });
}

/**
 * Cameras outside the building, in front of every exit on both sides of its polygon, from standing in
 * it to far off, beside it and above and below it, each looking at the doorway (a little off it) and one
 * in four anywhere at all: the flood from the world through the doors in range decides from the street
 * which rooms are drawn through each door and whether a building gets a pass at all. A place that falls
 * in a room's box is not outside and is left out.
 */
function sweepOutside(b: TestBuilding, t: Tally, perSpot = 6): void {
  const n = new THREE.Vector3();
  const side = new THREE.Vector3();
  const lp = new THREE.Vector3();
  const target = new THREE.Vector3();
  for (const k of b.exits) {
    const p = b.model.portals[k];
    if (!p.verts.length) continue;
    const m = b.mid[k];
    const r = b.rad[k];
    n.copy(p.normal).transformDirection(b.matrix);
    side.set(-n.z, 0, n.x);
    if (side.lengthSq() < 1e-9) side.set(1, 0, 0);
    side.normalize();
    const range = doorRangeOf(r, tune);
    const dists = [0.02, 0.2, 0.45, 1, 3, 8, 20, 60, range * 0.5, range * 0.95];
    for (const s of [1, -1]) {
      for (const dist of dists) {
        for (let i = 0; i < perSpot; i++) {
          local.copy(m).addScaledVector(n, s * dist).addScaledVector(side, (rnd() - 0.5) * 2 * (r + 2));
          local.y = m.y + (rnd() - 0.4) * Math.max(2, r);
          lp.copy(local).applyMatrix4(b.inverse);
          if (inAnyRoom(b, lp)) continue;
          if (i % 4 === 3) place(local, rnd() * Math.PI * 2, (rnd() - 0.5) * 1.2);
          else lookFrom(local, target.copy(m).add(new THREE.Vector3((rnd() - 0.5) * 2 * (r + 1), (rnd() - 0.5) * Math.max(2, r), (rnd() - 0.5) * 2 * (r + 1))));
          checkCamera(b, 0, t);
        }
      }
    }
  }
}

/**
 * The renderer's own door tests held to the flood's. The renderer stencils a door when its building is in
 * its list (`withinReach`, the quick box test first) and the door is in range (`doorInRange`); the flood
 * goes through a door only when it took it as in range (`doorsOf`). Were the two to drift, the renderer
 * would stencil a door whose rooms the flood never marked, which is a see-through doorway. Cameras
 * anywhere in and around the building, looking anywhere, with the door range on, off, the old mode and
 * retuned, and each answer held to the test's own reading of which portals are exits and how far.
 */
function doorsAgree(b: TestBuilding): { cameras: number; doorsIn: number; within: boolean; bad: string[] } {
  const bad: string[] = [];
  let cameras = 0;
  let doorsIn = 0;
  const saved = { ...tune };
  const lp = new THREE.Vector3();
  const variants: Partial<PortalCullTune>[] = [{}, { doorRange: false }, { mode: 'all' }, { rangeBase: 40, rangePerRadius: 3, rangeMax: 150 }];
  const np = b.model.portals.length;
  let y = 0;
  for (const k of b.exits) y += b.mid[k].y / b.exits.length;
  // Whether every exit's middle lies within the building's radius across the ground, as it does on every
  // building here: then a door in range means the building is in the renderer's list, or it is never drawn.
  const doorsWithin = b.exits.every((k) => Math.hypot(b.mid[k].x - b.x, b.mid[k].z - b.z) <= b.radius);
  try {
    for (const v of variants) {
      Object.assign(tune, saved, v);
      for (let i = 0; i < 300; i++) {
        const ang = rnd() * Math.PI * 2;
        const d = rnd() * (b.radius + tune.rangeMax + 60);
        local.set(b.x + Math.cos(ang) * d, y + (rnd() - 0.4) * 40, b.z + Math.sin(ang) * d);
        place(local, rnd() * Math.PI * 2, (rnd() - 0.5) * 1.4);
        cameras++;
        const o = camera.position;
        if (vis.withinReach(b, o, false) && !vis.withinReach(b, o, true)) bad.push(`in the building list at ${d.toFixed(1)} m but not in its box test`);
        lp.copy(o).applyMatrix4(b.inverse);
        const cell = (b.def.cells ?? []).find((c) => c.index > 0 && [0, 1, 2].every((a) => lp.getComponent(a) >= Math.min(c.bounds.min[a], c.bounds.max[a]) && lp.getComponent(a) <= Math.max(c.bounds.min[a], c.bounds.max[a])))?.index ?? 0;
        if (cell) vis.compute(camera, b, cell, [], 0, W, H);
        else vis.compute(camera, null, 0, [b], 1, W, H);
        const doors = vis.doorsOf(b);
        if (!doors) {
          bad.push('no doors answered for a building flooded this frame');
          continue;
        }
        const listed = vis.withinReach(b, o, false);
        for (let k = 0; k < np; k++) {
          const renderer = vis.isExit(b, k) && vis.doorInRange(b, k, o);
          const mine = b.exits.includes(k) && b.mid[k].distanceTo(o) <= doorRangeOf(b.rad[k], tune);
          if (renderer) doorsIn++;
          if (renderer && doorsWithin && !listed) bad.push(`door ${k} in range at ${b.mid[k].distanceTo(o).toFixed(2)} m but its building is not in the renderer's list (${JSON.stringify(v)})`);
          if (renderer !== (doors[k] === 1)) bad.push(`door ${k} at ${b.mid[k].distanceTo(o).toFixed(2)} m: the renderer says ${renderer}, the flood ${doors[k] === 1} (${JSON.stringify(v)})`);
          if (renderer !== mine) bad.push(`door ${k} at ${b.mid[k].distanceTo(o).toFixed(2)} m: the renderer says ${renderer}, the manifest and the range ${mine} (${JSON.stringify(v)})`);
        }
      }
    }
  } finally {
    Object.assign(tune, saved);
  }
  return { cameras, doorsIn, within: doorsWithin, bad };
}

/**
 * How far ahead of its doors a building's rooms are built. A door is in range only while the camera is
 * within its range of the door's middle, so the farthest off its edge the camera can be with any door in
 * range is the largest of each exit's middle across the ground from the building's middle plus that
 * door's range, less the building's radius; the streamer builds the rooms from `interiorBuildRange` off
 * the edge. The difference is the walk the rooms' programs have, less the sweep's 8 m step and however far
 * the camera stands from the player. Cameras sampled round the building check that the renderer's own
 * door test never reaches past that farthest point.
 */
function roomsLead(b: TestBuilding): { min: number; build: number; door: number; past: number } {
  const build = interiorBuildRange(b, tune);
  let far = -Infinity;
  let door = 0;
  for (const k of b.exits) {
    const range = doorRangeOf(b.rad[k], tune);
    door = Math.max(door, range);
    far = Math.max(far, Math.hypot(b.mid[k].x - b.x, b.mid[k].z - b.z) + range - b.radius);
  }
  let past = 0;
  let y = 0;
  for (const k of b.exits) y += b.mid[k].y / b.exits.length;
  const cam = new THREE.Vector3();
  for (let i = 0; i < 4000; i++) {
    const ang = rnd() * Math.PI * 2;
    const d = b.radius + (rnd() * 1.2 - 0.1) * (far + 20);
    cam.set(b.x + Math.cos(ang) * d, y + (rnd() - 0.5) * 20, b.z + Math.sin(ang) * d);
    let any = false;
    for (const k of b.exits) if (vis.doorInRange(b, k, cam)) any = true;
    if (any && Math.hypot(b.x - cam.x, b.z - cam.z) - b.radius > far + 1e-6) past++;
  }
  return { min: build - far, build, door, past };
}

function report(name: string, t: Tally): void {
  console.log(`     ${name}: ${t.cameras} cameras (${t.flooded} flooded whole, ${t.fallbackBox} outside their room's box, ${t.fallbackVisits} over the visit cap), ${t.rays} rays entering ${t.entered} rooms and reaching ${t.exits} exits in range; ${(t.seenRooms / t.cameras).toFixed(2)} rooms seen and ${(t.visits / t.cameras).toFixed(1)} visits a camera, the world seen by ${((100 * t.worldSeen) / t.cameras).toFixed(0)}%`);
  if (t.misses.length) for (const m of t.misses.slice(0, 8)) console.log(`     MISS ${m}`);
}

// A made-up two-room box, for the rules that want a known shape: room 1 is x -5..5, z -5..0; room 2 is
// x -5..5, z 0..5; a doorway between them at z = 0, x -1..1, y 0..2.2; and an exit from room 2 to the
// world at z = 5, x -1..1, y 0..2.2.
function quad(x0: number, x1: number, y0: number, y1: number, z: number): { v: number[][]; i: number[] } {
  return { v: [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], i: [0, 1, 2, 0, 2, 3] };
}
const boxDef: Def = {
  id: 'test_two_rooms',
  bounds: { min: [-5, 0, -5], max: [5, 3, 5] },
  cells: [
    { index: 0, name: 'r0', bounds: { min: [-5, 0, -5], max: [5, 3, 5] }, portals: [{ geometry: 1, target: 2, passable: true }] },
    { index: 1, name: 'front', bounds: { min: [-5, 0, -5], max: [5, 3, 0] }, portals: [{ geometry: 0, target: 2, passable: true }] },
    { index: 2, name: 'back', bounds: { min: [-5, 0, 0], max: [5, 3, 5] }, portals: [{ geometry: 0, target: 1, passable: true }, { geometry: 1, target: 0, passable: true }] },
  ],
  portals: [quad(-1, 1, 0, 2.2, 0), quad(-1, 1, 0, 2.2, 5)],
};

// ---- 0. Nothing allocated by a frame's work: the camera's room walked, the set flooded, the renderer's
// building list and door tests, and the world pass narrowed to the exits. ----
// First, while the functions have seen only what the game hands them: one tune and one shape of building.
// The sections after this hand them a dozen tunes on purpose (every switch and number moved), which
// makes the loads of the tune's numbers megamorphic, and a megamorphic load of a number boxes it: an
// artefact of the test that the game, with its one `PORTAL_CULL`, never meets.
{
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc) {
    const b = buildingOf(boxDef, 10, 0, 10, 0.3);
    const others = [buildingOf(boxDef, 40, 0, 10, 1.1), buildingOf(boxDef, -30, 0, 25, 2.2)];
    const all = [b, ...others];
    const out: CameraCell<TestBuilding> = { building: null, cell: 0 };
    const near: (TestBuilding | null)[] = [];
    const NONE: TestBuilding[] = [];
    const eye = new THREE.Vector3(10, 1.6, 8);
    const cam = new THREE.Vector3(10, 2, 12);
    // Four cameras posed once, taken in turn: the test's own posing would pass numbers about and box them.
    const cams = [0, 1.2, 2.9, 4.4].map((yaw) => {
      const c = new THREE.PerspectiveCamera(60, W / H, 0.05, 9000);
      c.position.copy(eye);
      c.rotation.set(-0.1, yaw, 0, 'YXZ');
      c.updateMatrixWorld(true);
      return c;
    });
    // The renderer's own per-frame share: its building list and door tests, and the narrowing of the world pass.
    const narrowing = new ExitNarrowing();
    const roots = new THREE.Group();
    for (let k = 0; k < 16; k++) {
      const g = new THREE.Group();
      markNarrowRoot(g, new THREE.Sphere(new THREE.Vector3(10 + (k % 4) * 30 - 45, 0, 10 + Math.floor(k / 4) * 30 - 45), 5));
      roots.add(g);
    }
    narrowing.parents.push(roots);
    const exitRect = new Float64Array([-0.2, -0.3, 0.1, 0.2]);
    const pvm = new THREE.Matrix4();
    const body = (i: number) => {
      const c = cams[i & 3];
      walkCameraCell(b, 1, eye, cam, all, out, near);
      vis.compute(c, b, 1, NONE, 0, W, H);
      vis.compute(c, null, 0, all, all.length, W, H);
      for (let j = 0; j < all.length; j++) {
        const x = all[j];
        if (!vis.withinReach(x, c.position, false) || !vis.withinReach(x, c.position, true)) continue;
        for (let k = 0; k < x.model.portals.length; k++) if (vis.isExit(x, k)) vis.doorInRange(x, k, c.position);
      }
      pvm.multiplyMatrices(c.projectionMatrix, c.matrixWorldInverse);
      narrowing.hide(exitRect, pvm);
      narrowing.restore();
    };
    // Warmed long enough for every function in it to reach the optimising compiler, as a game's frame
    // loop does within seconds: the tiers below it box numbers of their own accord (measured: this body
    // made 577 bytes a frame after twenty thousand frames and one after two hundred thousand).
    for (let i = 0; i < 200000; i++) body(i);
    let gcs = 0;
    const obs = new PerformanceObserver((list) => {
      gcs += list.getEntries().length;
    });
    obs.observe({ entryTypes: ['gc'] });
    const youngSpace = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
    const settle = () => new Promise<void>((r) => setTimeout(r, 20));
    let perFrame = Infinity;
    for (let attempt = 0; attempt < 4; attempt++) {
      gc();
      await settle();
      gcs = 0;
      const before = youngSpace();
      for (let i = 0; i < 2000; i++) body(i);
      const after = youngSpace();
      await settle();
      perFrame = (after - before) / 2000;
      if (gcs === 0) break;
    }
    obs.disconnect();
    ok(gcs === 0 && perFrame < 4, `a frame's camera walk, floods, the renderer's building list and door tests and the world pass's narrowing make no garbage (${perFrame.toFixed(2)} bytes a frame over two thousand)`);
  } else console.log('skip nothing allocated on a frame: run with node --expose-gc to measure');
}

// ---- 1. Door ranges, by a doorway's size. ----
{
  ok(doorRangeOf(0, tune) === 120 && doorRangeOf(10, tune) === 120 && doorRangeOf(20, tune) === 170 && doorRangeOf(1000, tune) === 320, 'a door is drawn from 120 m, or 8.5 times its radius when that is farther, never past 320 m: an ordinary door keeps the old range');
  const off = { ...tune, doorRange: false };
  ok(doorRangeOf(34, off) === PORTAL_RANGE && doorRangeOf(34, { ...tune, mode: 'all' }) === PORTAL_RANGE, "with the switch off, or the mode 'all', every door is the old fixed 120 m");
}

// ---- 2. The narrowing's light guard. ----
{
  const plain = new THREE.Group();
  plain.add(new THREE.Mesh(new THREE.BoxGeometry()));
  const lit = new THREE.Group();
  const inner = new THREE.Group();
  inner.add(new THREE.PointLight());
  lit.add(inner);
  const before = NARROW_STATS.unhideable;
  const s = new THREE.Sphere(new THREE.Vector3(), 3);
  ok(markNarrowRoot(plain, s) && (plain as THREE.Object3D & NarrowRoot).exitCullSphere === s, 'a root with no light under it is offered to the narrowing with its sphere');
  ok(!markNarrowRoot(lit, s) && (lit as THREE.Object3D & NarrowRoot).exitCullSphere === undefined && NARROW_STATS.unhideable === before + 1, 'a root with a light anywhere under it is never offered, and is counted unhideable');
}

// ---- 2b. The frustum through the exits' rectangle, and what the narrowing hides and puts back. ----
{
  const pv = new THREE.Matrix4();
  const fr = new THREE.Frustum();
  const cam = new THREE.PerspectiveCamera(60, W / H, 0.05, 9000);
  const p = new THREE.Vector3();
  let inside = 0;
  let outside = 0;
  let wrong = 0;
  for (let c = 0; c < 2000; c++) {
    cam.fov = 40 + rnd() * 60;
    cam.aspect = 0.6 + rnd() * 2.2;
    cam.updateProjectionMatrix();
    cam.position.set((rnd() - 0.5) * 4000, (rnd() - 0.5) * 200, (rnd() - 0.5) * 4000);
    cam.rotation.set((rnd() - 0.5) * 3, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.5, 'YXZ');
    cam.updateMatrixWorld(true);
    pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const ax = rnd() * 2 - 1;
    const bx = rnd() * 2 - 1;
    const ay = rnd() * 2 - 1;
    const by = rnd() * 2 - 1;
    const r = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
    if (r[2] - r[0] < 0.02 || r[3] - r[1] < 0.02) continue;
    if (!exitFrustum(r, pv, fr)) {
      wrong++;
      continue;
    }
    const tan = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    for (let s = 0; s < 100; s++) {
      // A point on the screen and at a depth: inside the rectangle by a hair between the near and far
      // planes; outside it by one; or inside it on the screen but nearer than the near plane or past the far.
      const kind = s % 4;
      let x: number;
      let y: number;
      if (kind !== 1) {
        x = r[0] + 0.001 + rnd() * (r[2] - r[0] - 0.002);
        y = r[1] + 0.001 + rnd() * (r[3] - r[1] - 0.002);
      } else {
        do {
          x = rnd() * 2.4 - 1.2;
          y = rnd() * 2.4 - 1.2;
        } while (x > r[0] - 0.002 && x < r[2] + 0.002 && y > r[1] - 0.002 && y < r[3] + 0.002);
      }
      // A depth along the view, in metres: between the planes, or short of the near one, or past the far one.
      const depth = kind === 2 ? cam.near * (0.1 + 0.8 * rnd()) : kind === 3 ? cam.far * (1.01 + rnd()) : cam.near * 1.01 + rnd() * (cam.far * 0.99 - cam.near * 1.01);
      p.set(x * depth * tan * cam.aspect, y * depth * tan, -depth).applyMatrix4(cam.matrixWorld);
      const want = kind === 0;
      const got = fr.containsPoint(p);
      if (got !== want) wrong++;
      if (want) inside++;
      else outside++;
    }
  }
  ok(wrong === 0 && inside > 40000 && outside > 100000, `the frustum through a rectangle of the screen holds every point that projects inside it between the near and far planes, and none that projects outside it or lies short of the near plane or past the far (${inside} in, ${outside} out, over random cameras and rectangles)`);
  ok(!exitFrustum([-1, -1, 1, 1], pv, fr) && !exitFrustum([-3, -2, 2, 5], pv, fr) && !exitFrustum([0.2, 0.1, 0.1, 0.4], pv, fr), 'a rectangle over the whole screen, or an empty one, narrows nothing');

  // The narrowing: roots under two parents, a camera looking down -Z, the exits' rectangle the middle of the screen.
  const view = new THREE.PerspectiveCamera(60, 1, 0.05, 9000);
  view.position.set(0, 0, 0);
  view.updateMatrixWorld(true);
  pv.multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse);
  const rootAt = (x: number, y: number, z: number, r = 1) => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry()));
    markNarrowRoot(g, new THREE.Sphere(new THREE.Vector3(x, y, z), r));
    return g;
  };
  const scene = new THREE.Group();
  const ground = new THREE.Group();
  const seen = rootAt(0, 0, -50);
  const missed = rootAt(40, 0, -50);
  const heldHidden = rootAt(-40, 0, -50);
  heldHidden.visible = false;
  const behind = rootAt(0, 0, 50);
  const unmarked = new THREE.Group();
  const lit = new THREE.Group();
  lit.add(new THREE.PointLight());
  markNarrowRoot(lit, new THREE.Sphere(new THREE.Vector3(40, 0, -60), 1));
  const straddle = rootAt(6, 0, -50, 4);
  scene.add(seen, missed, heldHidden, unmarked, lit);
  ground.add(behind, straddle);
  const narrowing = new ExitNarrowing();
  narrowing.parents.push(scene, ground);
  const rect = [-0.1, -0.1, 0.1, 0.1];
  for (let round = 0; round < 3; round++) {
    narrowing.stats.tested = 0;
    narrowing.stats.hidden = 0;
    const hid = narrowing.hide(rect, pv);
    const during = [seen.visible, missed.visible, heldHidden.visible, behind.visible, unmarked.visible, lit.visible, straddle.visible];
    narrowing.restore();
    const after = [seen.visible, missed.visible, heldHidden.visible, behind.visible, unmarked.visible, lit.visible, straddle.visible];
    ok(
      hid === 2 && narrowing.stats.tested === 4 && during.join() === 'true,false,false,false,true,true,true',
      `round ${round + 1}: through the middle of the screen the narrowing hides the root off to the side and the one behind, keeps the one ahead and the one straddling the edge, never tests one already hidden, and never touches one with no sphere or with a light under it`,
    );
    ok(after.join() === 'true,true,false,true,true,true,true' && narrowing.holding === 0, `round ${round + 1}: and puts back exactly what it hid, leaving the root somebody else holds hidden as it was`);
  }
  ok(narrowing.hide([-1, -1, 1, 1], pv) === 0 && missed.visible && behind.visible && narrowing.holding === 0, 'through the whole screen it hides nothing');
  narrowing.restore();
}

// ---- 3. The made-up two-room box (`boxDef`, above), for the rules that want a known shape. ----
{
  const b = buildingOf(boxDef, 100, 0, -40, 0.7);
  const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(b.matrix);
  // Facing away from the doorway, which is wholly behind the camera: nothing through it.
  lookFrom(at(0, 1.6, -3), at(0, 1.6, -10));
  let res = vis.compute(camera, b, 1, [], 0, W, H);
  ok(res.fallback === '' && vis.seenOf(b)?.[2] === 2 && !res.worldSeen, 'a doorway wholly behind the camera gives nothing: the room beyond is only one room past a seen one, and the world is unseen');
  // Facing it: the room beyond is seen, and the exit behind it too.
  lookFrom(at(0, 1.6, -3), at(0, 1.6, 10));
  res = vis.compute(camera, b, 1, [], 0, W, H);
  ok(vis.seenOf(b)?.[2] === 1 && res.worldSeen, 'facing the doorway, the room beyond is seen and the exit through it too');
  const r2 = new Float64Array(4);
  vis.rectOf(b, 2, r2);
  ok(r2[0] > -1 && r2[2] < 1 && r2[1] > -1 && r2[3] < 1, 'and it is seen only through the doorway, not the whole screen');
  ok(res.exitRect[0] >= r2[0] - 1e-9 && res.exitRect[2] <= r2[2] + 1e-9 && res.exitRect[2] > res.exitRect[0], 'the exit is seen through a rectangle inside the doorway it is seen through');
  // Standing in the doorway, looking along the wall: the doorway is edge-on and would project to a
  // sliver, but the room beyond gets the camera's whole screen.
  lookFrom(at(0, 1.6, -0.2), at(10, 1.6, -0.2));
  res = vis.compute(camera, b, 1, [], 0, W, H);
  vis.rectOf(b, 2, r2);
  ok(vis.seenOf(b)?.[2] === 1 && r2[0] === -1 && r2[1] === -1 && r2[2] === 1 && r2[3] === 1, 'standing in a doorway, the room beyond is given the whole rectangle of the room the camera is in');
  // A step back from it, the rule lets go.
  lookFrom(at(0, 1.6, -1.2), at(10, 1.6, -1.2));
  res = vis.compute(camera, b, 1, [], 0, W, H);
  ok(vis.seenOf(b)?.[2] !== 1, 'a metre back from the doorway, looking along the wall, the room beyond is not seen');
  // Standing in the room beyond while named as in this one (a teleport picks a room by its box, and
  // boxes overlap): the room whose box holds the camera starts the flood as well.
  lookFrom(at(0, 1.6, 0.8), at(0, 1.6, 10));
  res = vis.compute(camera, b, 1, [], 0, W, H);
  ok(res.fallback === '' && vis.seenOf(b)?.[2] === 1 && res.worldSeen, "a camera named as in one room but standing in the next, facing away from the doorway, still sees the room it stands in and the exit ahead of it");
  // Out of the room's box: nothing is known, so everything is drawn.
  lookFrom(at(0, 1.6, -7), at(0, 1.6, -20));
  res = vis.compute(camera, b, 1, [], 0, W, H);
  ok(res.fallback === 'box' && vis.seenOf(b)?.[2] === 1 && res.worldSeen, "a camera outside its own room's padded box takes every room and the world as seen");
  // The visit cap.
  const tight = new PortalVisibility({ ...tune, maxVisits: 1 });
  lookFrom(at(0, 1.6, -3), at(0, 1.6, 10));
  const rt = tight.compute(camera, b, 1, [], 0, W, H);
  ok(rt.fallback === 'visits' && tight.seenOf(b)?.[2] === 1 && rt.worldSeen, 'a flood over its visit cap gives up and takes everything as seen');
  // From outside: through the exit only when it is on screen and in range.
  lookFrom(at(0, 1.6, 20), at(0, 1.6, 0));
  res = vis.compute(camera, null, 0, [b], 1, W, H);
  ok(res.drawnCount === 1 && vis.seenOf(b)?.[2] === 1 && vis.seenOf(b)?.[1] === 1, 'from outside facing the door, the room behind it and the room beyond that are seen');
  lookFrom(at(0, 1.6, 20), at(0, 1.6, 40));
  res = vis.compute(camera, null, 0, [b], 1, W, H);
  ok(res.drawnCount === 0 && !vis.anySeen(b), 'from outside with the door behind the camera, no room of it is seen and it is not drawn');
  lookFrom(at(0, 1.6, 200), at(0, 1.6, 0));
  res = vis.compute(camera, null, 0, [b], 1, W, H);
  ok(res.drawnCount === 0, 'from outside past the door range, no room is seen through it');
  // The camera's room, walked from the eye.
  const out: CameraCell<TestBuilding> = { building: null, cell: 0 };
  const near: TestBuilding[] = [];
  walkCameraCell(b, 1, at(0, 1.6, -2), at(0, 1.6, 2), [b], out, near);
  ok(out.building === b && out.cell === 2, 'a camera behind the eye through a doorway between two rooms is in the room beyond');
  walkCameraCell(b, 1, at(0, 1.6, -2), at(0, 1.6, 7), [b], out, near);
  ok(out.building === null && out.cell === 0, 'and through the exit beyond that, outside');
  walkCameraCell(null, 0, at(0, 1.6, 7), at(0, 1.6, 3), [b], out, near);
  ok(out.building === b && out.cell === 2, 'from outside through the door, in the room behind it');
  walkCameraCell(b, 1, at(0, 1.6, -2), at(3, 1.6, -4), [b], out, near);
  ok(out.building === b && out.cell === 1, "a camera that crosses nothing stays in the eye's room");
  // Over the lintel counts as through the door for an exit, as it always did, but not for a doorway between rooms.
  walkCameraCell(b, 2, at(0, 1.6, 4), at(0, 3.5, 6), [b], out, near);
  ok(out.building === null, 'over an exit\'s lintel is outside, as the walk over exits always had it');
  walkCameraCell(b, 1, at(0, 1.6, -1), at(0, 3.5, 1), [b], out, near);
  ok(out.building === b && out.cell === 1, 'over the lintel of a doorway between rooms is not through it');
  const t = tallyOf();
  sweep(b, t, { pitches: [0, -0.35, 0.35], grid: [0.15, 0.5, 0.85], heights: [0, 0.6], doorways: true });
  report('two made-up rooms', t);
  ok(t.misses.length === 0, `no ray from a camera in either made-up room enters a room or reaches an exit the flood left out (${t.rays} rays)`);
  const to = tallyOf();
  sweepOutside(b, to, 12);
  report('two made-up rooms, from outside', to);
  ok(to.cameras > 100 && to.entered > 0 && to.misses.length === 0, `no ray from a camera outside them enters a room through the door that the flood left out (${to.rays} rays, ${to.entered} rooms entered)`);
}

// ---- 3b. The graph the gate walks is the manifest's, not the flood's. ----
{
  // A copy of the made-up rooms whose manifest names the doorway between them from one side only: the
  // flood's topology and the test's must both still open it both ways round.
  const oneWay: Def = JSON.parse(JSON.stringify(boxDef));
  oneWay.id = 'test_one_way';
  oneWay.cells![2].portals = oneWay.cells![2].portals!.filter((l) => l.target !== 1);
  const b = buildingOf(oneWay, -60, 0, 30, 1.9);
  ok(b.adj.get(2)?.some((e) => e.to === 1) === true && b.adj.get(1)?.some((e) => e.to === 2) === true, "the test's own room graph opens a doorway both ways when the manifest names it from one side");
  const topo = topoOf(b.model);
  const to2 = (c: number, target: number) => {
    for (let a = topo.adjStart[c]; a < topo.adjStart[c + 1]; a++) if (topo.adjTarget[a] === target) return true;
    return false;
  };
  ok(to2(1, 2) && to2(2, 1) && topo.exit[1] === 1 && topo.exit[0] === 0, "and so does the flood's, with the world's door an exit and the doorway not");
  const t = tallyOf();
  sweep(b, t, { pitches: [0], grid: [0.2, 0.8], heights: [0], doorways: true });
  sweepOutside(b, t, 4);
  ok(t.misses.length === 0 && t.entered > 0, `no ray misses a room through a doorway named from one side only (${t.rays} rays)`);
}

// ---- 4. The real packs. ----
const root = new URL('../../../assets-private/', import.meta.url);
function findDef(pack: string, id: string): Def | null {
  const url = new URL(`${pack}/manifest.json`, root);
  if (!existsSync(url)) return null;
  const manifest = JSON.parse(readFileSync(url, 'utf8')) as { categories: Record<string, Def[]> };
  for (const list of Object.values(manifest.categories)) for (const d of list) if (d.id === id) return d;
  return null;
}

const REAL: { pack: string; id: string; name: string; gate: boolean }[] = [
  { pack: 'tatooine', id: 'thm_tato_cantina', name: 'the Mos Eisley cantina', gate: true },
  { pack: 'tatooine', id: 'mun_tato_capitol_s01', name: 'the Bestine capitol', gate: true },
  { pack: 'naboo', id: 'thm_nboo_thed_hangar', name: 'the Theed hangar', gate: true },
  { pack: 'mustafar', id: 'poi_must_crashed_republic_ship', name: "Mustafar's crashed ship (the torn bridge)", gate: false },
  { pack: 'naboo', id: 'thm_nboo_thed_theed_palace', name: 'the Theed palace', gate: false },
  { pack: 'mustafar', id: 'thm_must_old_republic_facilty', name: 'the old republic facility', gate: false },
];

let realRuns = 0;
const timings: { name: string; us: number }[] = [];
for (const r of REAL) {
  const def = findDef(r.pack, r.id);
  if (!def) {
    console.log(`skip ${r.name}: ${r.pack} is not converted or has no ${r.id}`);
    continue;
  }
  realRuns++;
  const b = buildingOf(def, -1350.5, 12, 2210.25, -2.1);
  const t = tallyOf();
  const t0 = performance.now();
  sweep(b, t, { pitches: [0, -0.3], grid: [0.2, 0.5, 0.8], heights: [0], doorways: true });
  report(r.name, t);
  ok(t.misses.length === 0, `${r.name}: no ray from a camera in any of its rooms or doorways enters a room or reaches an exit in range that the flood left out (${t.rays} rays, ${t.entered} rooms entered)`);
  ok(t.flooded > t.cameras * 0.5, `${r.name}: most of those cameras ran the flood whole rather than a fallback (${t.flooded} of ${t.cameras})`);
  // From the street: which rooms each door shows, and whether the building is drawn at all.
  const tOut = tallyOf();
  sweepOutside(b, tOut);
  report(`${r.name}, from outside`, tOut);
  ok(tOut.misses.length === 0 && tOut.entered > 0, `${r.name}: no ray from a camera outside it, in front of any of its ${b.exits.length} exits, enters a room through a door in range that the flood left out (${tOut.rays} rays, ${tOut.entered} rooms entered)`);
  // The renderer's own door tests against the flood's: a door the renderer stencils is one the flood went through.
  const agree = doorsAgree(b);
  ok(agree.bad.length === 0, `${r.name}: over ${agree.cameras} cameras in and around it, with the door range on, off and retuned, the renderer's door test and building list agree with the doors the flood took (${agree.doorsIn} doors in range${agree.within ? '' : '; an exit of it stands past its radius, so a door in range need not put it in the list'})${agree.bad.length ? `: ${agree.bad.slice(0, 3).join('; ')}` : ''}`);
  // Its rooms are built before any of its doors can be drawn.
  const lead = roomsLead(b);
  ok(lead.past === 0 && lead.min >= 30, `${r.name}: whenever a door of it is in range its rooms were built ${lead.min.toFixed(1)} m or more before, which covers the sweep's 8 m step and a camera held well behind the player (built from ${lead.build.toFixed(0)} m off its edge, a door drawn from ${lead.door.toFixed(0)} m)`);
  // What one frame's flood costs, over the cameras in the rooms (the rays are the test's, not the game's).
  const topo = topoOf(b.model);
  const cams: THREE.Vector3[] = [];
  const cells: number[] = [];
  for (const c of def.cells ?? []) {
    if (c.index <= 0) continue;
    const lo = [0, 1, 2].map((a) => Math.min(c.bounds.min[a], c.bounds.max[a]));
    const hi = [0, 1, 2].map((a) => Math.max(c.bounds.min[a], c.bounds.max[a]));
    cams.push(new THREE.Vector3((lo[0] + hi[0]) / 2, lo[1] + Math.min(1.6, hi[1] - lo[1]), (lo[2] + hi[2]) / 2).applyMatrix4(b.matrix));
    cells.push(c.index);
  }
  const reps = 400;
  const s0 = performance.now();
  for (let k = 0; k < reps; k++) {
    const i = k % cams.length;
    place(cams[i], (k * 0.37) % (2 * Math.PI), 0);
    vis.compute(camera, b, cells[i], [], 0, W, H);
  }
  const us = ((performance.now() - s0) / reps) * 1000;
  timings.push({ name: r.name, us });
  console.log(`     ${r.name}: ${topo.ncell - 1} rooms, ${topo.nportal} portals; one frame's flood ${us.toFixed(1)} µs; the sweep took ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  if (r.id === 'thm_nboo_thed_hangar') {
    const door = doorRangeOf(topoOf(b.model).maxExitRadius, tune);
    const reach = interiorReachOf(b, tune);
    ok(door > 270 && door < 320 && reach === door + INTERIOR_LEAD && interiorBuildRange(b, tune) === reach, `the hangar's big door is drawn from ${door.toFixed(0)} m, about 300, and its rooms are built from ${reach.toFixed(0)} m, the lead before that`);
    const off = { ...tune, doorRange: false };
    ok(interiorReachOf(b, off) === 0 && interiorBuildRange(b, off) === PORTAL_RANGE + INTERIOR_LEAD, 'and from the old 160 m while the door range is off');
  }
  if (r.id === 'thm_tato_cantina') {
    ok(interiorBuildRange(b, tune) === PORTAL_RANGE + INTERIOR_LEAD, "the cantina's ordinary doors keep the old 120 m and its rooms the old 160 m");
    // Deep in an alcove facing its back wall: its one doorway is behind the camera, so no exit can be seen.
    const alcove = def.cells?.find((c) => c.name === 'alcove1');
    if (alcove) {
      const lo = alcove.bounds.min;
      const hi = alcove.bounds.max;
      const p = new THREE.Vector3((lo[0] + hi[0]) / 2, 1.2, lo[2] + 2).applyMatrix4(b.matrix);
      const back = new THREE.Vector3((lo[0] + hi[0]) / 2, 1.2, lo[2] - 5).applyMatrix4(b.matrix);
      lookFrom(p, back);
      const res = vis.compute(camera, b, alcove.index, [], 0, W, H);
      ok(res.fallback === '' && !res.worldSeen && vis.describe(b)?.seen.length === 1, 'in a cantina alcove facing its back wall, only that alcove is seen and no exit: the world, its shadows and the weather are not drawn');
    }
    // In the office facing away from its one door.
    const office = def.cells?.find((c) => c.name === 'office');
    if (office) {
      const lo = office.bounds.min;
      const hi = office.bounds.max;
      const p = new THREE.Vector3(hi[0] - 2, 1.4, (lo[2] + hi[2]) / 2).applyMatrix4(b.matrix);
      const wall = new THREE.Vector3(hi[0] + 5, 1.4, (lo[2] + hi[2]) / 2).applyMatrix4(b.matrix);
      lookFrom(p, wall);
      const res = vis.compute(camera, b, office.index, [], 0, W, H);
      ok(!res.worldSeen, 'in the cantina office facing away from its door, the world is not seen');
    }
  }
}
if (!realRuns) console.log('skip the converted packs are not here (assets-private/<planet>/manifest.json)');

// ---- 6. `crossing` is the one the streamer and the camera walk share, moved here unchanged. ----
{
  const [p] = portalsOf(boxDef);
  ok(crossing(p, new THREE.Vector3(0, 1, -1), new THREE.Vector3(0, 1, 1)) === 0.5 && crossing(p, new THREE.Vector3(3, 1, -1), new THREE.Vector3(3, 1, 1)) === null, 'a segment through a doorway crosses it half way; one beside it does not');
  ok(crossing(p, new THREE.Vector3(0, 3, -1), new THREE.Vector3(0, 3, 1), 4) === 0.5 && crossing(p, new THREE.Vector3(0, 3, -1), new THREE.Vector3(0, 3, 1)) === null, 'over the lintel counts only with headroom');
}

console.log(`\n${checks} checks passed`);
if (timings.length) console.log(`flood per frame: ${timings.map((t) => `${t.name} ${t.us.toFixed(1)} µs`).join(', ')}`);
