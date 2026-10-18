// Real-world ground, dropped into a planet as a patch.
//
// `dem2swg.py` turns an elevation raster into `base16.raw` (16-bit heights) and `base.json` (the
// metres those bytes stand for). This reads the pair and answers a height for any world point
// inside the patch, blending out to the planet's own terrain at the edge so there is no step to
// walk off.
//
// It is hung on `Terrain.heightAt`, which is the one call `buildGrid` makes per sample. The mesh
// and the Rapier heightfield are both built from that one array, so the ground stays exactly as
// collidable as it looks, with nothing to keep in step by hand.
//
// A patch is a proof of concept, not the way a planet should be built. Done properly this is the
// AHBM affector the generator currently skips, where it would compose with the shader layers and
// their height, slope and fractal filters instead of overriding everything underneath it.

/** What `dem2swg.py` writes beside the heights. */
export interface DemMeta {
  mapWidthInMeters: number;
  base: { samples: number; metresPerSample: number; minHeight: number; maxHeight: number };
  exaggeration?: number;
}

export interface DemPatch {
  /** Where the patch sits in the world, as the centre of its square. */
  centreX: number;
  centreZ: number;
  /** Metres a side. */
  size: number;
  /** Metres of ground added to every sample, for sitting the patch at a sensible level. */
  lift: number;
  /** Metres over which the patch gives way to the planet's own terrain at its edge. */
  feather: number;
  readonly samples: number;
  readonly minHeight: number;
  readonly maxHeight: number;
  /**
   * The height at a world point, or null outside the patch. Inside the feather the caller's own
   * height is wanted too, so this takes it and does the blend here.
   */
  heightAt(x: number, z: number, under: () => number): number | null;
}

/** 16-bit little-endian rows, top-down, exactly as `base16.raw` holds them. */
export function makeDemPatch(raw: ArrayBuffer, meta: DemMeta, where: { centreX?: number; centreZ?: number; size?: number; lift?: number; feather?: number } = {}): DemPatch {
  const n = meta.base.samples;
  const heights = new Uint16Array(raw);
  if (heights.length < n * n) throw new Error(`base16.raw holds ${heights.length} samples, not the ${n * n} base.json claims`);

  const lo = meta.base.minHeight;
  const span = meta.base.maxHeight - lo;
  const size = where.size ?? meta.base.samples * meta.base.metresPerSample;

  const patch: DemPatch = {
    centreX: where.centreX ?? 0,
    centreZ: where.centreZ ?? 0,
    size,
    lift: where.lift ?? 0,
    feather: where.feather ?? Math.min(size * 0.12, 200),
    samples: n,
    minHeight: lo,
    maxHeight: meta.base.maxHeight,

    heightAt(x: number, z: number, under: () => number): number | null {
      const half = this.size / 2;
      const dx = x - this.centreX;
      const dz = z - this.centreZ;
      if (Math.abs(dx) > half || Math.abs(dz) > half) return null;

      // World to sample. A north-up raster holds its northernmost row first, and north here is -Z,
      // so row 0 sits at the -Z edge and v runs WITH z. Getting this backwards mirrors the patch
      // north to south, which looks perfectly plausible and is wrong; `demSampler.test.mjs` pins it.
      const u = ((dx + half) / this.size) * (n - 1);
      const v = ((dz + half) / this.size) * (n - 1);
      const x0 = Math.min(n - 2, Math.max(0, Math.floor(u)));
      const y0 = Math.min(n - 2, Math.max(0, Math.floor(v)));
      const fx = u - x0;
      const fy = v - y0;

      const row0 = y0 * n;
      const row1 = row0 + n;
      const h00 = heights[row0 + x0];
      const h10 = heights[row0 + x0 + 1];
      const h01 = heights[row1 + x0];
      const h11 = heights[row1 + x0 + 1];
      const top = h00 + (h10 - h00) * fx;
      const bot = h01 + (h11 - h01) * fx;
      const h = lo + ((top + (bot - top) * fy) / 65535) * span + this.lift;

      // Give way to the planet's own ground at the edge, or the patch is a cliff on all four sides.
      if (this.feather > 0) {
        const edge = Math.min(half - Math.abs(dx), half - Math.abs(dz));
        if (edge < this.feather) {
          let t = edge / this.feather;
          t = t * t * (3 - 2 * t);
          return under() + (h - under()) * t;
        }
      }
      return h;
    },
  };
  return patch;
}

/**
 * Load a patch from wherever the two files are served. `base16.raw` is preferred over `base.hmap`:
 * eight bits across real relief is a couple of metres a step, which the lighting draws as contour
 * terracing on every slope.
 */
export async function loadDemPatch(baseUrl: string, where?: Parameters<typeof makeDemPatch>[2]): Promise<DemPatch> {
  const base = baseUrl.replace(/\/+$/, '');
  const [metaRes, rawRes] = await Promise.all([fetch(`${base}/base.json`), fetch(`${base}/base16.raw`)]);
  if (!metaRes.ok) throw new Error(`no base.json at ${base} (${metaRes.status})`);
  if (!rawRes.ok) throw new Error(`no base16.raw at ${base} (${rawRes.status})`);
  const meta = (await metaRes.json()) as DemMeta;
  return makeDemPatch(await rawRes.arrayBuffer(), meta, where);
}
