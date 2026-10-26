// The world editor's snapping (DESIGN.md §2.6): the grid is laid in the file's own frame, so on a world whose layout centre
// is not whole the numbers written are whole multiples of the step all the same; only the axes a move moved are snapped;
// the angle and the grid step through their lists; End drops a thing's lowest point onto the floor under it in a room,
// else onto the higher of the terrain and what stands under it (the terrain winning where it is sunk), and with Shift
// leans it toward the surface by at most the tune's most; V takes a moving box's faces flush to the nearest neighbour's.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { alikeToQuarter, droppedY, leanTo, nudgeAxis, snapAngle, snapFlush, snapPlace, snapValue, stepThrough, surfaceUnder, terrainNormal, type SurfaceHit } from '../../../src/editor/snapping.ts';
import { worldBox } from '../../../src/editor/selection.ts';
import { EDITOR_TUNE } from '../../../src/editor/editorTune.ts';
import { rowMoved } from '../../../src/world/permanentEdit.ts';
import type { PlacementRow } from '../../../src/story/placements.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

{
  ok(snapValue(0.1 * 3, 0.1) === 0.3 && snapValue(7.38, 0.25) === 7.5 && snapValue(-1.12, 0.5) === -1 && snapValue(3.3, 0) === 3.3, 'a value goes to its nearest line, written as the line (0.3, not 0.30000000000000004), and no step is no grid');
  // A world whose layout centre is not whole: the grid is the file's, raw x = cx - gx, z = gz + cz.
  const centre = { x: 1234.5678, z: -987.6543 };
  const row: PlacementRow = { id: 'r', kind: 'prop', pack: 'props', thing: 'chair', x: 0, y: 0, z: 0, q: [1, 0, 0, 0] };
  let whole = true;
  let moved = true;
  const out = { x: 0, y: 0, z: 0 };
  for (const step of EDITOR_TUNE.snap.gridSteps) {
    for (let i = 0; i < 50; i++) {
      const g = { x: Math.sin(i) * 300 + 0.123, y: 12.3456 + i * 0.37, z: Math.cos(i * 1.3) * 400 - 0.077 };
      snapPlace(g, { x: true, y: true, z: true }, step, centre, 'raw', out);
      const written = rowMoved(row, { x: out.x, y: out.y, z: out.z, q: [0, 0, 0, 1] }, [1, 1, 1], centre, 'raw', { mm: 0.001 });
      for (const v of [written.x, written.y, written.z]) {
        const k = v / step;
        if (Math.abs(k - Math.round(k)) > 1e-9) whole = false;
      }
      if (Math.abs(out.x - g.x) > step / 2 + 1e-9 || Math.abs(out.z - g.z) > step / 2 + 1e-9) moved = false;
    }
  }
  ok(whole, `on a world whose centre is (${centre.x}, ${centre.z}) every number written is a whole multiple of the step, for every step of the grid (${EDITOR_TUNE.snap.gridSteps.join(', ')} m)`);
  ok(moved, 'and no place moves more than half a step to get there');
  snapPlace({ x: 3.3, y: 4.44, z: -2.2 }, { x: true, y: false, z: false }, 1, centre, 'raw', out);
  ok(out.y === 4.44 && out.z === -2.2 && out.x !== 3.3, 'only the axes a move moved are snapped: a slide along X leaves the height and Z as they stood');
  snapPlace({ x: 3.3, y: 4.44, z: -2.2 }, { x: true, y: true, z: true }, 0.5, null, 'game', out);
  ok(out.x === 3.5 && out.y === 4.5 && out.z === -2, "in space the grid is the game's own frame");
}

{
  const step = (s: number) => (s * Math.PI) / 180;
  ok(Math.abs(snapAngle(step(37), 15) - step(30)) < 1e-12 && Math.abs(snapAngle(step(-52), 45) - step(-45)) < 1e-12, 'a turn goes to its nearest step of the angle');
  let all = true;
  for (const s of EDITOR_TUNE.snap.angleSteps) {
    const a = snapAngle(step(s * 3.4), s);
    if (Math.abs(a / step(s) - Math.round(a / step(s))) > 1e-9) all = false;
  }
  ok(all, `for every step of the angle (${EDITOR_TUNE.snap.angleSteps.join(', ')}°)`);
  ok(stepThrough([0.25, 1, 0.05], 0.25, 1) === 1 && stepThrough([0.25, 1, 0.05], 0.25, -1) === 0.05 && stepThrough([0.25, 1], 1, 1) === 1 && stepThrough([0.25, 1], 0.6, -1) === 0.25, '[ and ] step the grid through its list, held at its ends, from a value between two to the nearest the way asked');
  const a = nudgeAxis(0.8, -0.6, 1, 0, true, { x: 0, z: 0 });
  const b = nudgeAxis(0.8, -0.6, 0, 1, true, { x: 0, z: 0 });
  const c = nudgeAxis(0.8, -0.6, 1, 0, false, { x: 0, z: 0 });
  ok(a.x === 1 && a.z === 0 && b.x === 0 && b.z === 1 && c.x === 0 && c.z === -1, "an arrow nudges along the world axis nearest the camera's way asked (or the game's own with cameraRelative off)");
}

{
  // End: the floor, the terrain, what stands.
  const out: SurfaceHit = { y: 0, nx: 0, ny: 1, nz: 0 };
  const floor: SurfaceHit = { y: 3, nx: 0, ny: 1, nz: 0 };
  const terrain: SurfaceHit = { y: 5, nx: 0.1, ny: 0.99, nz: 0 };
  ok(surfaceUnder(10, floor, terrain, false, out) && out.y === 3, "in a room a thing goes onto the floor under it, never the terrain over the room's roof");
  ok(surfaceUnder(10, null, terrain, true, out) && out.y === 5 && out.nx === 0.1, 'out in the open with nothing under it, onto the terrain');
  ok(surfaceUnder(10, { y: 8, nx: 0, ny: 1, nz: 0 }, terrain, true, out) && out.y === 8, 'onto a crate standing higher than the terrain');
  ok(surfaceUnder(10, { y: 2, nx: 0, ny: 1, nz: 0 }, terrain, true, out) && out.y === 5, 'onto the terrain where what the cast met is under it');
  ok(surfaceUnder(3, { y: 1, nx: 0, ny: 1, nz: 0 }, terrain, true, out) && out.y === 5, 'a thing sunk under the terrain comes up onto it, whatever the cast met under it');
  ok(!surfaceUnder(3, null, { y: Number.NaN, nx: 0, ny: 1, nz: 0 }, true, out), 'nothing under it at all, nothing to drop onto');
  ok(!surfaceUnder(3, null, terrain, false, out), "in space or a room there is no terrain to fall back on");
  // A box reaching 0.5 under its origin, turned on its side and scaled: its lowest point is the turned, scaled box's.
  const lo: [number, number, number] = [0, 0, 0];
  const hi: [number, number, number] = [0, 0, 0];
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  worldBox([-1, -0.5, -0.2], [1, 2, 0.2], 2, 1, 1, q, { x: 0, y: 0, z: 0 }, lo, hi);
  ok(Math.abs(lo[1] + 2) < 1e-9 && droppedY(5, lo[1]) === 7, `its lowest point is its own box turned and scaled (${lo[1].toFixed(2)} m under its origin), so it stands at 7 on ground at 5`);
  ok(Number.isNaN(droppedY(Number.NaN, -1)), 'no surface, no height');
  const n = terrainNormal(0, 1, 0, 0, 0.5, { y: 0, nx: 0, ny: 0, nz: 0 });
  ok(Math.abs(n.nx + Math.SQRT1_2) < 1e-12 && Math.abs(n.ny - Math.SQRT1_2) < 1e-12 && n.nz === 0, "the terrain's normal from its heights either side (a 45-degree rise to +X leans it back toward -X)");
  // Shift+End leans the thing's up toward the surface's, by at most the most.
  const up = (t: { x: number; y: number; z: number; w: number }) => new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(t.x, t.y, t.z, t.w));
  const t = { x: 0, y: 0, z: 0, w: 1 };
  leanTo(t, n.nx, n.ny, n.nz, EDITOR_TUNE.snap.normalMaxDeg, t);
  const angle = (up(t).angleTo(new THREE.Vector3(0, 1, 0)) * 180) / Math.PI;
  ok(Math.abs(angle - EDITOR_TUNE.snap.normalMaxDeg) < 1e-9 && up(t).x < 0, `Shift+End leans it toward a 45-degree slope by the most, ${EDITOR_TUNE.snap.normalMaxDeg}° (${angle.toFixed(3)}°), never past`);
  const t2 = { x: 0, y: 0, z: 0, w: 1 };
  const s = Math.sin((4 * Math.PI) / 180);
  leanTo(t2, -s, Math.cos((4 * Math.PI) / 180), 0, EDITOR_TUNE.snap.normalMaxDeg, t2);
  ok(up(t2).angleTo(new THREE.Vector3(-s, Math.cos((4 * Math.PI) / 180), 0)) < 1e-9, 'and a gentler slope by all of it, its up laid along the surface\'s');
  const t3 = { x: 0, y: Math.sin(0.4), z: 0, w: Math.cos(0.4) };
  leanTo(t3, 0, 1, 0, 10, t3);
  ok(t3.y === Math.sin(0.4) && t3.w === Math.cos(0.4), 'a level surface leaves its turn as it stands');
}

{
  // V: flush to the nearest neighbour.
  const moving = { lo: [0, 0, 0] as const, hi: [2, 1, 2] as const };
  const near = { lo: [2.3, 0, 0.5] as const, hi: [4, 1, 3] as const };
  const far = { lo: [10, 0, 0] as const, hi: [12, 1, 2] as const };
  const o = snapFlush(moving, [far, near], 0.5, { x: 0, y: 0, z: 0 });
  ok(Math.abs(o.x - 0.3) < 1e-12, `its high face is taken flush to the near neighbour's low face (${o.x.toFixed(2)} m), the far one too far`);
  ok(Math.abs(o.z - 0.5) < 1e-12 && o.y === 0, 'and on the other axes faces are lined up with the neighbour where one is within reach');
  const off = snapFlush(moving, [{ lo: [2.3, 5, 0] as const, hi: [4, 6, 2] as const }], 0.5, { x: 0, y: 0, z: 0 });
  ok(off.x === 0, 'a neighbour that is not beside it on the other axes is no face to meet');
  ok(alikeToQuarter(0, Math.PI / 2) && alikeToQuarter(0.2, 0.2 + Math.PI) && !alikeToQuarter(0, 0.4), 'only boxes turned alike to a quarter turn are flush');
}

console.log(`\n${checks} checks passed`);
