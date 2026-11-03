// The rooms' pool's lights as the effects read them (Map-maker II's wave of the rooms' lights): what `World.fillFxLights` hands
// the ambient occlusion and the room's air of the room lit now -- its ambient, its parallel light, its eight lamps each with the
// cell it came from, and the pool's other slots lit (the casting points as points, the spots as points the air glows round and
// as spots with their cones, which the occlusion takes as spots where the session built any). Out of `world.ts`, so a node test
// fills the very record from the very pool the world does.
//
// Allocates nothing: the record is the effects' own kept one, every light read by its world matrix.
//
// Rule for this file (node runs it with type stripping): every value import with its `.ts` extension, no enum, no namespace,
// no constructor parameter properties, nothing that touches the page at load.

import * as THREE from 'three';
import { addPointLight, luminanceOf, setDirectional, setSpotLight, type FxRoomLights } from '../core/fx/lights.ts';
import type { RoomLightPool } from './roomLightPool.ts';

/**
 * The lit room's lights from the pool into the effects' record (`rooms.lit`, its building and cell are the caller's): the
 * ambient, the parallel light, the plain lamps with `lampCells` (each lamp's cell, -1 unlit), and the pool's other slots.
 */
export function fillRoomLightFx(rooms: FxRoomLights, pool: RoomLightPool, lampCells: readonly number[]): void {
  const a = pool.ambient;
  rooms.ambient.copy(a.color).multiplyScalar(a.intensity);
  rooms.ambientLuminance = luminanceOf(a.color, a.intensity);
  setDirectional(rooms.parallel, pool.parallel);
  const points = pool.points;
  for (let i = 0; i < points.length; i++) rooms.pointCount = addPointLight(rooms.points, rooms.pointCount, points[i], lampCells[i]);
  if (pool.pointShadows.length || pool.spots.length || pool.spotShadows.length) fillRoomExtras(rooms, pool);
}

/**
 * The pool's other slots lit into the record: the casting points first, as points (`extraPoints` of them), then the spots plain
 * and casting, each as a point and as a spot, every one with the cell it came from (`RoomLightPool.cellsOfExtra`).
 */
export function fillRoomExtras(rooms: FxRoomLights, pool: RoomLightPool): void {
  const cells = pool.cellsOfExtra;
  let k = 0;
  const ps = pool.pointShadows;
  for (let i = 0; i < ps.length; i++, k++) rooms.extraCount = addPointLight(rooms.extra, rooms.extraCount, ps[i], cells[k]);
  rooms.extraPoints = rooms.extraCount;
  const sp = pool.spots;
  for (let i = 0; i < sp.length; i++, k++) roomSpot(rooms, sp[i], cells[k]);
  const ss = pool.spotShadows;
  for (let i = 0; i < ss.length; i++, k++) roomSpot(rooms, ss[i], cells[k]);
}

function roomSpot(rooms: FxRoomLights, l: THREE.SpotLight, cell: number): void {
  if (!(l.intensity > 0)) return;
  rooms.extraCount = addPointLight(rooms.extra, rooms.extraCount, l as unknown as THREE.PointLight, cell);
  if (rooms.spotCount >= rooms.spots.length) return;
  const out = rooms.spots[rooms.spotCount++];
  setSpotLight(out, l);
  out.cell = cell;
}
