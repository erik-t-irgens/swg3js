// What the material tests share (normals.test.ts, specMask.test.ts): the client's archives mounted the way
// the converter mounts them with --retail-only, the converter's own surface readers and texture entries
// (tools/swg/surface.mjs, the very code `cli.mjs` runs), a model written by the converter's own GLB writer
// and read back, and the shaders the converted packs really use. Not a test itself.
//
// The archives come from SWG in the environment or in the .env beside package.json; the packs from the
// folder SWG3JS_PACKS names, else assets-private. A machine with neither is told so and checks nothing
// here, as every other test that reads the archives does.
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeDds } from '../dds.mjs';
import { effectAlpha, alphaModeFor } from '../eff.mjs';
import { buildGlb } from '../glb.mjs';
import { readGlb } from '../glbclips.mjs';
import { parseIff } from '../iff.mjs';
import { decodePng, encodePng } from '../png.mjs';
import { effectAlphaMode } from '../sht.mjs';
import { surfaceReaders, surfaceTexture } from '../surface.mjs';
import { loadEffect } from '../texrender.mjs';

export type Img = { width: number; height: number; rgba: Uint8Array };
export type Vfs = { has(p: string): boolean; read(p: string): Buffer; list(prefix: string): string[] };

/** The packs folder the tests read: SWG3JS_PACKS, else the checkout's assets-private. */
export const PACKS = process.env.SWG3JS_PACKS ?? fileURLToPath(new URL('../../../assets-private/', import.meta.url));

/** The folder holding the client's archives (SWG in the environment, else in the .env beside package.json), or null. */
export function swgDir(): string | null {
  let swg = process.env.SWG ?? '';
  const env = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (!swg && existsSync(env)) {
    for (const line of readFileSync(env, 'utf8').split(/\r?\n/)) {
      const m = /^\s*SWG\s*=\s*(.*?)\s*$/.exec(line);
      if (m) swg = m[1].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return swg && existsSync(swg) ? swg : null;
}

/** The client's archives, retail only, or null where this machine has none. */
export async function mountRetail(): Promise<Vfs | null> {
  const swg = swgDir();
  if (!swg) return null;
  const { openVfs } = await import('../tre.mjs');
  const { isRetailByName } = await import('../manifest.mjs');
  return openVfs(swg, { filter: (f: string) => isRetailByName(f, statSync(join(swg, f)).size) !== null, log: () => {} }) as Vfs;
}

/** The converter's own texture-entry dependencies over these archives, as `cli.mjs`'s `surfaceDeps` makes them. */
export function converterDeps(vfs: Vfs, log: (m: string) => void = () => {}) {
  const readers = surfaceReaders(vfs, { decodeDds, encodePng, loadEffect, log });
  const alphaCache = new Map<string, string>();
  const deps = {
    cache: new Map(),
    decodeDds,
    encodePng,
    alphaFromEffect: (effect: string | null, fallback: string) => {
      if (!effect) return fallback;
      if (!alphaCache.has(effect)) {
        let mode = fallback;
        try {
          if (vfs.has(effect)) mode = alphaModeFor(effectAlpha(parseIff(vfs.read(effect))), effect);
        } catch {
          /* the fallback stands, as in the converter */
        }
        alphaCache.set(effect, mode);
      }
      return alphaCache.get(effect)!;
    },
    surfaceFor: readers.surfaceFor,
    normalFor: readers.normalFor,
    glassNamed: /glass|window|windshield|canopy|transparen|viewport|pane|goggle|visor|lens/i,
    byName: effectAlphaMode,
    log,
  };
  return { deps, readers };
}

/** A shader's texture entry, exactly as the converter makes it (null for one it draws untextured). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function entryOf(vfs: Vfs, shader: string, deps: any): any {
  return surfaceTexture(vfs, shader, deps);
}

/** One triangle with both coordinate sets, the shape the GLB writer takes. */
const tri = (second: boolean) => ({
  positions: Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0),
  normals: Float32Array.of(0, 0, 1, 0, 0, 1, 0, 0, 1),
  uvs: Float32Array.of(0, 0, 1, 0, 0, 1),
  uvs2: second ? Float32Array.of(0, 0, 2, 0, 0, 2) : null,
  indices: Uint16Array.of(0, 1, 2),
});

/**
 * A model of one triangle under the shader, written by the converter's own GLB writer with the entry it
 * made, and read back: the material the file carries and a way to decode any texture of it, so a test
 * checks the pixels a pack would hold and not what the converter decided.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function writtenModel(shader: string, entry: any, { second = false } = {}) {
  const glb = buildGlb([{ name: 'm', groups: [{ shader, primitives: [tri(second)] }] }], { textures: new Map([[shader, entry]]) });
  const { json, bin } = readGlb(glb);
  return { json, material: json.materials.find((m: { name: string }) => m.name === shader), image: (index: number | undefined) => glbImage(json, bin, index) };
}

/** A texture of a GLB, decoded from the bytes it embeds; null where there is none. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function glbImage(json: any, bin: Buffer, index: number | undefined): Img | null {
  const t = index === undefined ? null : json.textures?.[index];
  const im = t ? json.images?.[t.source] : null;
  if (!im) return null;
  const bv = json.bufferViews[im.bufferView];
  return decodePng(bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength)) as Img | null;
}

/** A GLB file's JSON chunk alone, no buffer read; null for anything that is not one. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function glbJsonOf(file: string): any {
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    const head = Buffer.alloc(20);
    if (readSync(fd, head, 0, 20, 0) < 20 || head.toString('latin1', 0, 4) !== 'glTF') return null;
    const body = Buffer.alloc(head.readUInt32LE(12));
    readSync(fd, body, 0, body.length, 20);
    return JSON.parse(body.toString('utf8'));
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Every .glb under a folder, at most `limit`, in a stable order. */
export function glbsUnder(dir: string, limit = Infinity): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    if (out.length >= limit || !existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (out.length >= limit) return;
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name.endsWith('.glb')) out.push(join(d, e.name));
    }
  };
  walk(dir);
  return out;
}

/** The folders of the packs the material tests read: a world, the rack, a wardrobe, a species. */
export const PACK_FOLDERS = ['tatooine', 'weapons', join('wardrobe', 'human_male'), join('characters', 'human_male')];

/** The shaders the packs under `root` draw with (their materials' names), or an empty set where there are none. */
export function usedShaders(root = PACKS): Set<string> {
  const out = new Set<string>();
  for (const f of PACK_FOLDERS) {
    for (const file of glbsUnder(join(root, f))) {
      for (const m of glbJsonOf(file)?.materials ?? []) if (typeof m?.name === 'string' && /\.sht$/i.test(m.name)) out.add(m.name.toLowerCase());
    }
  }
  return out;
}

/** The material format a pack folder was converted at (its manifest's or catalogue's stamp; 1 when it carries none). */
export function packFormat(root: string, folder: string): number | null {
  for (const name of ['manifest.json', 'wardrobe.json', 'parts.json']) {
    const file = join(root, folder, name);
    if (!existsSync(file)) continue;
    try {
      return JSON.parse(readFileSync(file, 'utf8')).materialFormat ?? 1;
    } catch {
      return null;
    }
  }
  return null;
}
