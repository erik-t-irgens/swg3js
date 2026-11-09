// A baked world read the way the game reads it, for the horizon pass's second wave's tests: the pack's own terrain made
// in node with no worker (its building layers placed as `world.ts` places them) and its far-ground bake's sections
// decoded. Packs under `SWG3JS_PACKS`, else `assets-private`; null where the world or its bake is not on disk.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENERATOR_REVISION } from '../../../src/swg/terrain/generator.ts';
import { inflateSections } from '../../../src/world/horizon/horizonDecode.ts';
import { HORIZON_BIN, HORIZON_JSON, decodeHeights, readHorizonHeader, type HorizonHeader } from '../../../src/world/horizon/horizonFile.ts';
import { SwgTerrain } from '../../../src/world/swgTerrain.ts';

export const repo = fileURLToPath(new URL('../../../', import.meta.url));
export const packs = process.env.SWG3JS_PACKS || join(repo, 'assets-private');

/** The worlds on disk with a bake, the given order first. */
export function bakedWorlds(prefer: string[] = ['tatooine', 'naboo', 'mustafar']): string[] {
  if (!existsSync(packs)) return [];
  const all = readdirSync(packs).filter((w) => existsSync(join(packs, w, HORIZON_JSON)) && existsSync(join(packs, w, HORIZON_BIN)) && existsSync(join(packs, w, 'terrain.trn')));
  return [...prefer.filter((w) => all.includes(w)), ...all.filter((w) => !prefer.includes(w))];
}

// The bake's own rule for a layer's yaw (`world.ts`'s), so the terrain made here is the one the bake was made from.
import { yawOf } from '../horizon.mjs';

export interface BakedWorld {
  name: string;
  dir: string;
  header: HorizonHeader;
  fine: Float32Array;
  coarse: Float32Array;
  families: Uint8Array;
  colour: Uint8Array;
  centre: { x: number; z: number };
  swg: SwgTerrain;
}

/** A pack folder's terrain made as the game makes it at an arrival (its building layers placed as `world.ts` places them), no worker. */
export async function terrainOf(dir: string): Promise<SwgTerrain> {
  const layout = JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf8'));
  const layers: { bytes: ArrayBuffer; x: number; z: number; yaw: number }[] = [];
  for (const o of layout.objects ?? []) {
    if (!o.layer || o.contained || !existsSync(join(dir, o.layer))) continue;
    const b = readFileSync(join(dir, o.layer));
    layers.push({ bytes: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), x: o.x, z: o.z, yaw: yawOf(o.q) });
  }
  const trn = readFileSync(join(dir, 'terrain.trn'));
  return SwgTerrain.create(trn.buffer.slice(trn.byteOffset, trn.byteOffset + trn.byteLength), layers, layout.center.x, layout.center.z, async (file) => {
    const p = join(dir, file);
    if (!existsSync(p)) return null;
    const b = readFileSync(p);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  });
}

export async function loadBaked(name: string): Promise<BakedWorld | null> {
  const dir = join(packs, name);
  if (!existsSync(join(dir, HORIZON_JSON)) || !existsSync(join(dir, 'layout.json'))) return null;
  const layout = JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf8'));
  const read = readHorizonHeader(JSON.parse(readFileSync(join(dir, HORIZON_JSON), 'utf8')), { generator: GENERATOR_REVISION, centre: layout.center }, name);
  if (!('header' in read)) return null;
  const header = read.header;
  const sec = await inflateSections(header, new Uint8Array(readFileSync(join(dir, HORIZON_BIN))));
  const swg = await terrainOf(dir);
  return {
    name,
    dir,
    header,
    fine: decodeHeights(sec.heights, header.fine.nx, header.fine.nz, header.fine.lo, header.fine.q),
    coarse: decodeHeights(sec.coarseHeights, header.coarse.nx, header.coarse.nz, header.coarse.lo, header.coarse.q),
    families: sec.families,
    colour: sec.colour,
    centre: { x: layout.center.x, z: layout.center.z },
    swg,
  };
}

/** A raw pole's height out of the sampler's cached block (generated here, laid as it enters the cache). */
export function poleHeight(swg: SwgTerrain, x: number, z: number): number {
  const s = swg.sampler;
  const bw = s.blockWidth;
  const bx = Math.floor(x / bw);
  const bz = Math.floor(z / bw);
  const b = s.generateBlock(bx, bz);
  const st = s.blockStart(bx, bz);
  const i = Math.round((x - st.x) / s.poleStep);
  const j = Math.round((z - st.z) / s.poleStep);
  return b.heights[j * s.numberOfPoles + i];
}

/** A raw pole's radial far family out of the sampler's cached block (the near ground's own 2 m generation). */
export function poleFar(swg: SwgTerrain, x: number, z: number): number {
  const s = swg.sampler;
  const bw = s.blockWidth;
  const b = s.generateBlock(Math.floor(x / bw), Math.floor(z / bw));
  const st = s.blockStart(Math.floor(x / bw), Math.floor(z / bw));
  const i = Math.round((x - st.x) / s.poleStep);
  const j = Math.round((z - st.z) / s.poleStep);
  return b.radialFar ? b.radialFar[(j * s.numberOfPoles + i) * 2] : 0;
}
