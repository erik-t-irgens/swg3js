// Wave 4 of the animations, item B: the wall climb's scenes, shared by its tests (a face at any lean, as a cleaned trimesh).
import { Group, RAPIER, TRIMESH_FLAGS, cleanTrimesh, groups } from '../../../src/core/physics.ts';
import type { Physics } from './grappleBody.ts';

/**
 * A wedge whose front face rises from z = `face` at `angle` degrees from the level (90 upright, past 90 an overhang),
 * `top` high, with a flat roof `depth` deep behind its edge: a cleaned trimesh of its faces, as every placed building is.
 */
export function wedge(p: Physics, angle: number, top: number, face = 2, depth = 3, x0 = -4, x1 = 4): void {
  const run = top / Math.tan((angle * Math.PI) / 180);
  const L = x1 - x0;
  const v: number[] = [];
  const idx: number[] = [];
  const quad = (o: number[], u: number[], w: number[]) => {
    const b = v.length / 3;
    v.push(o[0], o[1], o[2], o[0] + u[0], o[1] + u[1], o[2] + u[2], o[0] + w[0], o[1] + w[1], o[2] + w[2], o[0] + u[0] + w[0], o[1] + u[1] + w[1], o[2] + u[2] + w[2]);
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  };
  const zb = face + run + depth;
  // Front (its normal w x u: out toward -z and up), roof, back, floor.
  quad([x0, 0, face], [L, 0, 0], [0, top, run]);
  quad([x0, top, face + run], [L, 0, 0], [0, 0, depth]);
  quad([x0, 0, zb], [0, top, 0], [L, 0, 0]);
  quad([x0, 0, face], [0, 0, zb - face], [L, 0, 0]);
  // The two ends.
  const A = (x: number) => [x, 0, face];
  const B = (x: number) => [x, top, face + run];
  const C = (x: number) => [x, top, zb];
  const D = (x: number) => [x, 0, zb];
  const tri = (a: number[], b: number[], c: number[]) => {
    const k = v.length / 3;
    v.push(...a, ...b, ...c);
    idx.push(k, k + 1, k + 2);
  };
  tri(A(x0), C(x0), B(x0));
  tri(A(x0), D(x0), C(x0));
  tri(A(x1), B(x1), C(x1));
  tri(A(x1), C(x1), D(x1));
  const clean = cleanTrimesh(new Float32Array(v), new Uint32Array(idx))!;
  const desc = RAPIER.ColliderDesc.trimesh(clean.vertices, clean.indices, TRIMESH_FLAGS).setFriction(0.8);
  desc.setCollisionGroups(groups(Group.exterior, Group.all));
  p.world.createCollider(desc);
}

