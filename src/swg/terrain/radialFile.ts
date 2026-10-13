// The radial flora's pictures in a pack, as both sides read them: what the converter's `radial` pass writes
// beside a world's terrain file and how the game reads it back, kept in one file so the two cannot drift.
// No three and no DOM: the converter (plain node), the game and the node tests all read it.
//
//   terrain/radial.json   which shaders the terrain's live radial affectors place, near (AFDN, the grass) and
//                         far (AFDF, the far hills' tree cards), each with its layer in the picture file, its own
//                         alpha reference (the shader's ARVS), its kind and its picture's own size
//   terrain/radial.rgba   every one of those pictures as a layer of RADIAL_SIZE square RGBA8, raw bytes, in
//                         layer order: never a PNG, which a browser decodes through a canvas that premultiplies
//
// A pack without the files has no grass and no far cards, which is the world as it was.

import { AffectorFloraDynamic, Operation, type Layer, type TerrainGenerator } from './generator.ts';
import { shaderKey } from './shaderKey.ts';

/** Bumped when what the pass writes changes shape or meaning; `status` asks again when it moves. */
export const RADIAL_FORMAT = 1;
/** The side of every layer, pixels: 158 of the 211 retail pictures are this size already. */
export const RADIAL_SIZE = 256;
export const RADIAL_JSON = 'terrain/radial.json';
export const RADIAL_RGBA = 'terrain/radial.rgba';

/**
 * How a radial shader is drawn, out of the effect its shader names: `plain` (`e_radialflora`, `a_alpha`), lit
 * by the client's sum like every other; `glow` (`a_alpha_emis_full`, Dathomir's and the Rryatt trail's glowing
 * flowers), unlit; `fade` (`a_alpha_fade`, Yavin 4's far tree cards), faded with distance; `particle`
 * (`e_particle_alpha`, Dathomir's far sand cloud), lit as the rest.
 */
export type RadialKind = 'plain' | 'glow' | 'fade' | 'particle';

export function radialKind(effect: string | null | undefined): RadialKind {
  const e = (effect ?? '').toLowerCase();
  if (/emis_full/.test(e)) return 'glow';
  if (/alpha_fade/.test(e)) return 'fade';
  if (/particle/.test(e)) return 'particle';
  return 'plain';
}

/** One shader the radial affectors place. */
export interface RadialPlacement {
  /** The shader as `shaderKey` gives it ("radl_grass_short_green"). */
  key: string;
  /** As the family wrote it. */
  shader: string;
  near: boolean;
  far: boolean;
  /** The radial families it is a child of, ascending. */
  families: number[];
}

/**
 * Every shader a live radial affector places, sorted by key: an AFDN or AFDF that adds a family (not a remove-all
 * and not a replace, which removes one), active itself and with every layer above it active, every child of that
 * family. 15 retail families on 9 worlds are placed by no such affector and are left out.
 */
export function radialPlaced(generator: TerrainGenerator): RadialPlacement[] {
  const byKey = new Map<string, RadialPlacement>();
  const walk = (layers: readonly Layer[], on: boolean) => {
    for (const l of layers) {
      const live = on && l.active;
      if (!live) continue;
      for (const a of l.affectors) {
        if (!(a instanceof AffectorFloraDynamic) || !a.active || a.removeAll || a.operation !== Operation.add || !a.familyId) continue;
        const family = generator.radialGroup.families.get(a.familyId);
        if (!family) continue;
        for (const c of family.children) {
          const key = shaderKey(c.shader);
          if (!key) continue;
          let p = byKey.get(key);
          if (!p) byKey.set(key, (p = { key, shader: c.shader, near: false, far: false, families: [] }));
          if (a.tag === 'AFDN') p.near = true;
          else p.far = true;
          if (!p.families.includes(family.id)) p.families.push(family.id);
        }
      }
      walk(l.layers, live);
    }
  };
  walk(generator.layers, true);
  for (const p of byKey.values()) p.families.sort((x, y) => x - y);
  return [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** One shader's entry in the pack's file. */
export interface RadialShaderEntry {
  /** Its layer in `radial.rgba`. */
  layer: number;
  near: boolean;
  far: boolean;
  /** The shader's own alpha reference, 0..255 (ARVS on its MAIN slot), against which the client tested. */
  alphaRef: number;
  kind: RadialKind;
  /** The picture's own size before it was laid in its layer. */
  width: number;
  height: number;
}

/** The pack's radial file as the game reads it. */
export interface RadialFile {
  size: number;
  layers: number;
  shaders: Map<string, RadialShaderEntry>;
}

/** The pack's `terrain/radial.json` read back, or null for one that is not this format (the world then has no grass). */
export function readRadialFile(json: unknown): RadialFile | null {
  const j = json as { radialFormat?: unknown; size?: unknown; layers?: unknown; shaders?: unknown } | null;
  if (!j || j.radialFormat !== RADIAL_FORMAT) return null;
  const size = Number(j.size);
  const layers = Number(j.layers);
  if (!(size > 0) || !Number.isInteger(layers) || layers < 0 || !j.shaders || typeof j.shaders !== 'object') return null;
  const shaders = new Map<string, RadialShaderEntry>();
  for (const [key, raw] of Object.entries(j.shaders as Record<string, unknown>)) {
    const e = raw as Partial<RadialShaderEntry>;
    const layer = Number(e?.layer);
    if (!Number.isInteger(layer) || layer < 0 || layer >= layers) continue;
    const kind: RadialKind = e.kind === 'glow' || e.kind === 'fade' || e.kind === 'particle' ? e.kind : 'plain';
    shaders.set(key, { layer, near: !!e.near, far: !!e.far, alphaRef: Math.min(255, Math.max(0, Number(e.alphaRef) || 0)), kind, width: Number(e.width) || size, height: Number(e.height) || size });
  }
  return { size, layers, shaders };
}

/**
 * A picture brought to `size` square, one axis at a time: a side larger than `size` by a whole factor is box
 * filtered by that factor (every retail picture is a power of two), a smaller one is stretched by linear
 * interpolation between texel centres, clamped at the edges; any other ratio is interpolated too. Every channel
 * alike, straight alpha. The converter writes every layer through this and the test holds every layer to the
 * DDS decode through this, so the two are one rule. The quad a picture is drawn on keeps the picture's own
 * proportions (the family's width and height), so a stretched layer is drawn unstretched.
 */
export function resampleRgba(rgba: ArrayLike<number>, width: number, height: number, size: number = RADIAL_SIZE): Uint8Array {
  const along = (n: number) => {
    // For each output texel along an axis: the source texels it reads and their weights.
    const idx: number[][] = [];
    const wt: number[][] = [];
    if (n === size) {
      for (let i = 0; i < size; i++) {
        idx.push([i]);
        wt.push([1]);
      }
    } else if (n > size && n % size === 0) {
      const r = n / size;
      for (let i = 0; i < size; i++) {
        const a: number[] = [];
        const w: number[] = [];
        for (let k = 0; k < r; k++) {
          a.push(i * r + k);
          w.push(1 / r);
        }
        idx.push(a);
        wt.push(w);
      }
    } else {
      for (let i = 0; i < size; i++) {
        const s = Math.min(n - 1, Math.max(0, ((i + 0.5) * n) / size - 0.5));
        const i0 = Math.floor(s);
        const i1 = Math.min(n - 1, i0 + 1);
        const t = s - i0;
        idx.push([i0, i1]);
        wt.push([1 - t, t]);
      }
    }
    return { idx, wt };
  };
  const ax = along(width);
  const ay = along(height);
  // Across first, into floats, then down: rounded once, at the end.
  const mid = new Float64Array(size * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < size; x++) {
      const a = ax.idx[x];
      const w = ax.wt[x];
      for (let c = 0; c < 4; c++) {
        let v = 0;
        for (let k = 0; k < a.length; k++) v += rgba[(y * width + a[k]) * 4 + c] * w[k];
        mid[(y * size + x) * 4 + c] = v;
      }
    }
  }
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const a = ay.idx[y];
    const w = ay.wt[y];
    for (let x = 0; x < size; x++) {
      for (let c = 0; c < 4; c++) {
        let v = 0;
        for (let k = 0; k < a.length; k++) v += mid[(a[k] * size + x) * 4 + c] * w[k];
        out[(y * size + x) * 4 + c] = Math.min(255, Math.max(0, Math.round(v)));
      }
    }
  }
  return out;
}
