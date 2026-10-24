// The atlas: one texture holding a tile for each solver (the design's §2.3), so every stage of the solve is one draw
// whatever the number of layers. The first wave has slab 0 alone; the third adds slabs 1 and 2 beside it, the fourth
// the liquid tile at its own size. Each tile is a rectangle of whole texels; every read is clamped half a texel inside
// its own tile **before** the inflow rule is asked, so a backtrace near a seam never blends in the neighbour under
// linear filtering (the coupling, from the third wave, reads the other tiles on purpose).
//
// Pure: the node test lays out every combination and checks the seams.

/** One tile, in whole texels of the atlas. */
export interface AtlasTile {
  kind: 'slab' | 'liquid';
  /** The slab's number (0 nearest the ground), or 0 for the liquid. */
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AtlasLayout {
  width: number;
  height: number;
  tiles: AtlasTile[];
}

/** The most tiles an atlas holds: three slabs and the liquid. The shaders' loop bound. */
export const MAX_TILES = 4;

/** The tiles for `layers` slabs of `cells` a side, and a liquid tile of `liquid` a side (0 for none), side by side. */
export function atlasLayout(cells: number, layers: number, liquid: number): AtlasLayout {
  const tiles: AtlasTile[] = [];
  const n = Math.max(1, Math.min(3, Math.floor(layers)));
  for (let i = 0; i < n; i++) tiles.push({ kind: 'slab', index: i, x: i * cells, y: 0, w: cells, h: cells });
  let width = n * cells;
  let height = cells;
  if (liquid > 0) {
    tiles.push({ kind: 'liquid', index: 0, x: width, y: 0, w: liquid, h: liquid });
    width += liquid;
    height = Math.max(height, liquid);
  }
  return { width, height, tiles };
}

/** Whether two tiles share a texel. */
export function tilesOverlap(a: AtlasTile, b: AtlasTile): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * A read at a tile-local coordinate in 0..1 as an atlas texel coordinate (continuous, the way a linear sample is
 * placed), clamped half a texel inside the tile: the arithmetic the shaders' `atlasAt` runs.
 */
export function atlasTexel(t: AtlasTile, local: number, axis: 'x' | 'y'): number {
  const size = axis === 'x' ? t.w : t.h;
  const start = axis === 'x' ? t.x : t.y;
  const c = Math.min(size - 0.5, Math.max(0.5, local * size));
  return start + c;
}

/** The texels a linear sample at a continuous texel coordinate reads (the two around it). */
export function linearTaps(coord: number): [number, number] {
  const f = Math.floor(coord - 0.5);
  return [f, f + 1];
}

/** The tiles' rectangles as the shaders take them: (x, y, w, h) in atlas uv, `MAX_TILES` of them, the unused nought. */
export function tileRects(layout: AtlasLayout, out: Float32Array): Float32Array {
  out.fill(0);
  for (let i = 0; i < layout.tiles.length && i < MAX_TILES; i++) {
    const t = layout.tiles[i];
    out[i * 4] = t.x / layout.width;
    out[i * 4 + 1] = t.y / layout.height;
    out[i * 4 + 2] = t.w / layout.width;
    out[i * 4 + 3] = t.h / layout.height;
  }
  return out;
}
