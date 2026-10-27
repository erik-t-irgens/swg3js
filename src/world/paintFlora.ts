// A real-elevation world's plants from its paint alone (Map-maker II's fourth wave, DESIGN.md §2.6): the one source the
// world's own planter, its grass and its far cards read where no generator runs. A converted world's planter reads its
// terrain (`SwgTerrain`, through the planter's `FloraSource`), its grass the terrain's cached blocks and its far cards the
// far grids; a real-elevation world has none of those, so this answers the same questions from the paint file's `flo:`
// rows (by the very arithmetic the generator's maps take, `GroundPaint.floraPoint`, at the pole each point maps to), the
// lent pack's flora tables and tilings, and the ground's own height, water and colour.
//
// Its frame is the real-elevation world's raw frame about (0, 0) (x mirrored, as `DEM_FRAME`), its tile keys run over the
// world's own width (the lent template's is the lent world's, and a 32 km world would run off its edge), nothing is
// excluded (a real-elevation world has no AEXC; the keep-off circles still filter what is planted), and nothing is a road.
// With no `flo:` row it plants nothing, which is what a world with no row has always planted.
//
// Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no enum, no namespace, no
// constructor parameter properties.

import type { FloraGroup, RadialGroup } from '../swg/terrain/flora.ts';
import type { GroundPaint, FloraPointOut, FloraRecipe } from '../swg/terrain/groundPaint.ts';
import type { FloraTiling, RadialPole, TerrainTemplate } from '../swg/terrain/trn.ts';
import type { FloraSource } from './flora.ts';
import type { FarSamples, GrassSource } from './grassMath.ts';

/** The lent pack's flora as the source reads it: its tilings and its two tables. */
export interface LentFlora {
  readonly flora: Pick<TerrainTemplate['flora'], 'collidable' | 'nonCollidable' | 'radial' | 'farRadial'>;
  readonly floraGroup: FloraGroup;
  readonly radialGroup: RadialGroup;
}

/** What the source asks of the ground, in the game's frame: its height, its water and the colour the grass is tinted by. */
export interface PaintFloraGround {
  heightAt(gx: number, gz: number): number;
  waterHeightAt(gx: number, gz: number): number;
  /** The ground's colour bytes at a point (white where nothing colours it), written into `out`. */
  colourAt(gx: number, gz: number, out: Uint8Array): void;
}

/** The poles the paint is laid at: 2 m, the client's own, as a converted world's blocks hold them. */
const POLE = 2;

/** The real-elevation world's plants from its paint: a `FloraSource` for the planter, a `GrassSource` for the grass, and the far cards' samples. */
export class PaintFloraSource implements FloraSource, GrassSource {
  /** The paint the world holds now (a getter: an editor's first stroke installs one where there was none). */
  private readonly paintOf: () => GroundPaint | null;
  private readonly ground: PaintFloraGround;
  readonly lent: LentFlora;
  readonly template: FloraSource['template'];
  readonly sampler: FloraSource['sampler'];
  /** The planter asks Mustafar's paint over its baked map; here the paint is the whole of the map, laid in `floraAt`. */
  readonly paint = null;
  /** What it answered, for the console. */
  readonly counts = { flora: 0, radial: 0, far: 0 };
  private readonly out: FloraPointOut = { family: 0, choice: 0 };
  private readonly rgb = new Uint8Array(3);

  constructor(paintOf: () => GroundPaint | null, lent: LentFlora, ground: PaintFloraGround, widthMeters: number) {
    this.paintOf = paintOf;
    this.lent = lent;
    this.ground = ground;
    this.template = {
      // The lent world's tilings, never its baked map (`legacyMap` true: every candidate reads `floraAt`), over this world's width.
      flora: { collidable: lent.flora.collidable, nonCollidable: lent.flora.nonCollidable, legacyMap: true, collidableMap: null },
      mapWidthInMeters: Math.max(16, widthMeters),
      generator: { floraGroup: lent.floraGroup },
    };
    this.sampler = {
      excludedAt: () => false,
      floraAt: (x, z, collidable) => this.floraAt(x, z, collidable),
      roadAt: () => false,
    };
  }

  /** The near and far tilings of the lent pack's radial flora (the grass's and the far cards'). */
  get radialTilings(): { near: FloraTiling; far: FloraTiling } {
    return { near: this.lent.flora.radial, far: this.lent.flora.farRadial };
  }

  toSwgX(gx: number): number {
    return -gx;
  }
  toSwgZ(gz: number): number {
    return gz;
  }
  toGameX(x: number): number {
    return -x;
  }
  toGameZ(z: number): number {
    return z;
  }

  /** The static flora at a raw point (its pole's), as a converted sampler answers it: the family and its choice over 255. */
  floraAt(x: number, z: number, collidable: boolean): { family: number; choice: number } {
    const p = this.paintOf();
    if (!p || p.flo.size === 0) return { family: 0, choice: 0 };
    const o = p.floraPoint(collidable ? 0 : 1, Math.floor(x / POLE) * POLE, Math.floor(z / POLE) * POLE, 0, 0, false, this.out);
    if (o.family) this.counts.flora++;
    return { family: o.family, choice: o.choice / 255 };
  }

  /**
   * What the grass reads at the pole under a game point: the near (or far) radial family and choice the paint lays there,
   * nothing excluded, the ground's colour, its height at the point and its normal from the heights a metre either side.
   * Always answers (nothing on this ground waits to be generated). Allocates nothing.
   */
  radialPoleIfCached(gx: number, gz: number, far: boolean, out: RadialPole): boolean {
    const p = this.paintOf();
    out.family = 0;
    out.choice = 0;
    if (p && p.flo.size !== 0) {
      const o = p.floraPoint(far ? 3 : 2, Math.floor(-gx / POLE) * POLE, Math.floor(gz / POLE) * POLE, 0, 0, false, this.out);
      out.family = o.family;
      out.choice = o.choice;
      if (o.family) this.counts.radial++;
    }
    out.excluded = false;
    const g = this.ground;
    const c = this.rgb;
    g.colourAt(gx, gz, c);
    out.color = (c[0] << 16) | (c[1] << 8) | c[2];
    out.height = g.heightAt(gx, gz);
    const dx = (g.heightAt(gx + 1, gz) - g.heightAt(gx - 1, gz)) / 2;
    const dz = (g.heightAt(gx, gz + 1) - g.heightAt(gx, gz - 1)) / 2;
    const len = Math.sqrt(dx * dx + 1 + dz * dz);
    out.nx = -dx / len;
    out.ny = 1 / len;
    out.nz = -dz / len;
    return true;
  }

  /** The drawn water's height at a game point, as the terrain answers it (lakes of ours among it, from the fifth wave). */
  waterAt(gx: number, gz: number): number {
    return this.ground.waterHeightAt(gx, gz);
  }

  /**
   * A far tile's samples as the far cards read them (`FarSamples`), made from the ground's own height at the far grid's 16 m
   * (where a converted world reads its far grid), its colour, and the far class the paint lays at each sample's pole.
   * `gx0`, `gz0` the tile's corner, `size` metres across, `res` steps.
   */
  farSamples(gx0: number, gz0: number, size: number, res: number): FarSamples {
    const step = size / res;
    const n = res + 3;
    const heights = new Float32Array(n * n);
    const colors = new Uint8Array(n * n * 3);
    const radialFar = new Uint8Array(n * n * 2);
    const p = this.paintOf();
    const g = this.ground;
    const c = this.rgb;
    for (let j = 0; j < n; j++) {
      const z = gz0 - step + j * step;
      for (let i = 0; i < n; i++) {
        const x = gx0 - step + i * step;
        const k = j * n + i;
        heights[k] = g.heightAt(x, z);
        g.colourAt(x, z, c);
        colors[k * 3] = c[0];
        colors[k * 3 + 1] = c[1];
        colors[k * 3 + 2] = c[2];
        if (p && p.flo.size !== 0) {
          const o = p.floraPoint(3, Math.floor(-x / POLE) * POLE, Math.floor(z / POLE) * POLE, 0, 0, false, this.out);
          radialFar[k * 2] = o.family;
          radialFar[k * 2 + 1] = o.choice;
          if (o.family) this.counts.far++;
        }
      }
    }
    return { heights, colors, radialFar, n, step, gx0: gx0 - step, gz0: gz0 - step };
  }

  /** Whether any flora cell is painted over a game-frame square (a chunk's): the planter plants it; else its procedural props stand. */
  paintedIn(gx0: number, gz0: number, size: number): boolean {
    const p = this.paintOf();
    return !!p && p.flo.size !== 0 && p.floraIn(-(gx0 + size), gz0, -gx0, gz0 + size);
  }

  /**
   * Whether the paint's trees and plants own a game point: a recipe that does anything to either class reaches it. A
   * procedural prop (a rock, a tree of the world's own style) that stood there before the paint is left out of a chunk the
   * planter plants, and every other one of that chunk kept, so a dab of grass takes no rock away and a forest painted over
   * a corner of a chunk leaves the rest of the chunk's rocks where they stood. Allocates nothing.
   */
  ownsAt(gx: number, gz: number): boolean {
    const p = this.paintOf();
    return !!p && p.flo.size !== 0 && p.floraOwnsStatic(-gx, gz);
  }

  /**
   * Whether a far tile's samples (`farSamples`: the tile and a far step past each side) meet any painted flora tile: one
   * that meets none carries no far card at all, so its samples are never worked out (a real-elevation world's far ring
   * is 169 tiles, and only those under the paint hold cards).
   */
  farReaches(gx0: number, gz0: number, size: number, res: number): boolean {
    const p = this.paintOf();
    if (!p || p.flo.size === 0) return false;
    const step = size / res;
    return p.floraTouches(-(gx0 + size + step), gz0 - step, -(gx0 - step), gz0 + size + step);
  }
}

/**
 * Whether the recipes a file holds are the list in memory or its start, recipe for recipe (a file holding none is the
 * start of any list): then the recipes appended in memory ahead of the file (one chosen while a stroke's answer was on its
 * way, one an undo's row took out with the cells that named it) are kept, so the place the brush paints with never comes
 * to name nothing and a landing moves nothing it did not change.
 */
export function recipesLead(file: readonly FloraRecipe[], memory: readonly FloraRecipe[]): boolean {
  if (file.length > memory.length) return false;
  for (let i = 0; i < file.length; i++) if (JSON.stringify(file[i]) !== JSON.stringify(memory[i])) return false;
  return true;
}

/**
 * What a list of recipes moved against the one before it, place by place (a class left out is a class kept): whether a
 * recipe's trees or plants moved (`static`: the planter's), its grass, or its far cards. A real-elevation world plants
 * again only the classes that moved over the tiles that name them.
 */
export function recipeClassesMoved(before: readonly FloraRecipe[], after: readonly FloraRecipe[]): { static: boolean; grass: boolean; far: boolean } {
  const out = { static: false, grass: false, far: false };
  const spec = (r: FloraRecipe | undefined, c: keyof FloraRecipe): string => JSON.stringify(r?.[c] ?? 'keep');
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    const a = before[i];
    const b = after[i];
    if (spec(a, 'trees') !== spec(b, 'trees') || spec(a, 'plants') !== spec(b, 'plants')) out.static = true;
    if (spec(a, 'grass') !== spec(b, 'grass')) out.grass = true;
    if (spec(a, 'far') !== spec(b, 'far')) out.far = true;
    // Whether a recipe paints the roads moves every class it paints (a real-elevation world has no road, a converted one
    // makes every painted grid again whatever moved).
    if ((a?.roads === true) !== (b?.roads === true)) out.static = out.grass = out.far = true;
  }
  return out;
}

/**
 * The lent pack's flora models a recipe of this paint names (its trees' and plants' adds), by appearance as the planter
 * looks them up: what the arrival loads, and what a recipe first named in play loads behind the editor's curtain. The
 * families are named by their ids in the lent table.
 */
export function appearancesNamed(paint: GroundPaint, flora: FloraGroup): string[] {
  const out = new Set<string>();
  for (let r = 1; r < 256; r++) {
    for (let c = 0; c < 2; c++) {
      const k = r * 4 + c;
      if (paint.recOp[k] !== 3) continue;
      const f = flora.families.get(paint.recFam[k]);
      for (const ch of f?.children ?? []) out.add(ch.appearance.replace(/\\/g, '/').toLowerCase());
    }
  }
  return [...out];
}
