// The atlas the air's solvers share (src/world/volumetrics/airAtlas.ts): the layout for every combination of layers and
// liquid size; no two tiles overlap; and a read clamped half a texel inside its tile never samples a neighbour under
// linear filtering, over every seam -- the arithmetic the shaders' `atlasAt` runs, held here.
//
// Plain type stripping.
import assert from 'node:assert/strict';
import { atlasLayout, atlasTexel, linearTaps, MAX_TILES, tileRects, tilesOverlap } from '../../../src/world/volumetrics/airAtlas.ts';
import { SPLAT_FRAGMENT } from '../../../src/world/volumetrics/airShaders.ts';

/** The atlas's shared text, as every solver stage carries it. */
const ATLAS_SHARED_FOR_TEST = SPLAT_FRAGMENT;

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const CELLS = [64, 96, 128, 160, 192];
const LIQUID = [0, 64, 96, 128, 192];
for (const cells of CELLS) {
  for (const layers of [1, 2, 3]) {
    for (const liquid of LIQUID) {
      const L = atlasLayout(cells, layers, liquid);
      const name = `${cells} cells, ${layers} layer${layers > 1 ? 's' : ''}, liquid ${liquid}`;
      ok(L.tiles.length === layers + (liquid > 0 ? 1 : 0) && L.tiles.length <= MAX_TILES, `${name}: one tile a solver, inside the shaders' bound`);
      let apart = true;
      let inside = true;
      for (let i = 0; i < L.tiles.length; i++) {
        const t = L.tiles[i];
        if (t.x < 0 || t.y < 0 || t.x + t.w > L.width || t.y + t.h > L.height) inside = false;
        for (let j = i + 1; j < L.tiles.length; j++) if (tilesOverlap(t, L.tiles[j])) apart = false;
      }
      ok(apart && inside, `${name}: no two tiles overlap and every tile is inside the atlas`);
      // Every seam: a read anywhere in 0..1 of a tile (and past it, which the shader clamps), clamped half a texel in,
      // takes its two linear taps inside its own tile on both axes.
      let clean = true;
      for (const t of L.tiles) {
        for (let k = -20; k <= 1020; k++) {
          const local = k / 1000;
          for (const axis of ['x', 'y'] as const) {
            const c = atlasTexel(t, local, axis);
            const [a, b] = linearTaps(c);
            const start = axis === 'x' ? t.x : t.y;
            const size = axis === 'x' ? t.w : t.h;
            // A tap exactly on a texel's middle weighs its neighbour at nought: allowed to name it.
            const frac = c - 0.5 - Math.floor(c - 0.5);
            const aIn = a >= start && a < start + size;
            const bIn = (b >= start && b < start + size) || frac === 0;
            if (!aIn || !bIn) clean = false;
          }
        }
      }
      ok(clean, `${name}: a read clamped half a texel inside its tile never blends a neighbour, at any seam`);
      const rects = tileRects(L, new Float32Array(MAX_TILES * 4).fill(9));
      let same = true;
      for (let i = 0; i < MAX_TILES; i++) {
        const t = L.tiles[i];
        const want = t ? [t.x / L.width, t.y / L.height, t.w / L.width, t.h / L.height] : [0, 0, 0, 0];
        for (let c = 0; c < 4; c++) if (Math.abs(rects[i * 4 + c] - want[c]) > 1e-6) same = false;
      }
      ok(same, `${name}: the shaders' rectangles are the tiles in atlas uv, the unused nought`);
    }
  }
}
ok(atlasLayout(128, 1, 0).width === 128 && atlasLayout(128, 1, 0).height === 128, "the first wave's atlas is slab 0 alone, the air's own square");
// The shader's clamp is the same arithmetic (its text names it).
ok(ATLAS_SHARED_FOR_TEST.includes('vec2 half_ = 0.5 / (r.zw * uAtlasSize);') && ATLAS_SHARED_FOR_TEST.includes('clamp(l, half_, 1.0 - half_)'), "the shaders' atlasAt clamps half a texel inside the tile, as this test's arithmetic does");
{
  const inflow = ATLAS_SHARED_FOR_TEST.indexOf('if (outsideOf(l)) return inflowOf(t);');
  const read = ATLAS_SHARED_FOR_TEST.indexOf('return texture(v, atlasAt(l, t)).xy;');
  ok(inflow > 0 && read > inflow, 'a velocity read asks the inflow rule first (out of the window is the wind), and only then clamps inside its tile');
}

console.log(`\n${checks} checks passed`);
