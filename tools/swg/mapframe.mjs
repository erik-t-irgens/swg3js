// Where a world's map picture lies on its ground.
//
// The `maps` command wrote every picture as covering the terrain's whole width about the origin,
// which is right for the ten launch worlds and wrong for every expansion zone: the client draws an
// expansion zone's map over the buildout area's **composite** rectangle instead
// (`datatables/buildout/areas_<planet>.iff`, compositeX1..compositeZ2, on a row whose `allowMap` is
// 1), moved by `datatables/planetary_map/map_adjustments.iff`'s offset for that zone. Measured off
// the retail tables:
//
//   kashyyyk_main         (-1024,-1024)..(1024,1024): 2048 m, where the terrain is 4096
//   kashyyyk_hunting      (-1422,-1422)..(1422,1422): 2844 m
//   kashyyyk_dead_forest  (-500,-500)..(500,500):     1000 m
//   mustafar_main         (-6880,-1024)..(1120,6976): 8000 m about (-2880, 2976), where the terrain is 16384
//
// and the ten launch worlds carry a composite of 0,0,0,0, which is "none": their pictures are right
// as they always were. Mustafar's instance areas carry `allowMap` 0 and no composite, which is the
// client saying there is no map there, and they are not the zone's map.
//
// The one offset the archives hold is `kashyyyk_main__kashyyyk_main`'s offsetY of 56. It is in the
// picture's own pixels and its sense was measured by fitting every placed object and place onto the
// picture (the starport pad, the huts, the Rodian camp land on their drawn icons only with the
// picture's middle 112 m north of the composite's, which is 56 pixels at 2 m a pixel), not read off
// the client's code. offsetX is taken the same way round; no retail row sets one.
//
// Everything is in the map's own frame, which is the snapshot's (the client's world, X not mirrored):
// the same frame the places in pois.json and the composite rectangle are already in.

/** The four corners' columns, as the areas table names them. */
const COMPOSITE = ['compositeX1', 'compositeZ1', 'compositeX2', 'compositeZ2'];

/** A row's composite rectangle, or null where it carries none (all four zero, or missing). */
function compositeOf(row) {
  const v = COMPOSITE.map((k) => Number(row?.[k]));
  if (!v.every(Number.isFinite)) return null;
  const [x1, z1, x2, z2] = v;
  if (!(x2 > x1 && z2 > z1)) return null;
  return { x1, z1, x2, z2, name: String(row.compositeName ?? '') };
}

/**
 * The frame a world's map picture covers: how wide a ground, about which point, and which rule said so.
 *
 *   planet        the pack's own name, which is the areas table's and the adjustments' key
 *   areas         the rows of `datatables/buildout/areas_<planet>.iff` ([] for a world with none)
 *   adjustments   the rows of `datatables/planetary_map/map_adjustments.iff`
 *   image         the picture's own size in pixels ({ width, height })
 *   terrainWidth  the terrain's own width, which is the frame wherever no composite is set
 *
 * A composite set on several rows (Mustafar's four quarters all carry one) is one composite; were two
 * different ones allowed a map, the one the most rows carry wins and the rest are reported.
 */
export function mapFrameOf({ planet, areas = [], adjustments = [], image = null, terrainWidth = 16384 } = {}) {
  const terrain = { width: terrainWidth, centre: { x: 0, z: 0 }, frame: 'terrain' };
  const groups = new Map();
  for (const row of areas) {
    if (Number(row?.allowMap) !== 1) continue;
    const c = compositeOf(row);
    if (!c) continue;
    const key = `${c.x1},${c.z1},${c.x2},${c.z2}`;
    const g = groups.get(key) ?? { c, rows: 0 };
    g.rows++;
    groups.set(key, g);
  }
  if (!groups.size) return terrain;
  const ranked = [...groups.values()].sort((a, b) => b.rows - a.rows);
  const { c } = ranked[0];
  const w = c.x2 - c.x1;
  const h = c.z2 - c.z1;
  let x = (c.x1 + c.x2) / 2;
  let z = (c.z1 + c.z2) / 2;
  const key = `${planet}__${c.name}`.toLowerCase();
  const adj = adjustments.find((r) => String(r?.Zone ?? '').toLowerCase() === key) ?? null;
  let offset = null;
  if (adj) {
    const ox = Number(adj.offsetX) || 0;
    const oy = Number(adj.offsetY) || 0;
    // Pixels of the picture, at the metres a pixel the composite gives it.
    const mx = image?.width ? w / image.width : 0;
    const mz = image?.height ? h / image.height : 0;
    x += ox * mx;
    z += oy * mz;
    if (ox || oy) offset = { x: ox, y: oy };
  }
  return {
    width: Math.max(w, h),
    centre: { x, z },
    frame: 'composite',
    composite: c.name,
    ...(w !== h ? { height: h } : {}),
    ...(offset ? { offset } : {}),
    ...(ranked.length > 1 ? { others: ranked.slice(1).map((g) => g.c.name) } : {}),
  };
}
