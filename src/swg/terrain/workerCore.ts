// The terrain worker's whole job, kept apart from the worker itself so node can drive it: one sampler
// built from the planet's terrain file at `init` (its bitmaps, colour ramps and building layers with
// it), then a pole grid generated for every `generate`. Every map of a grid goes out with it and every
// one is transferred, never copied, so the answer costs the main thread nothing to receive.
//
// In:  { type: 'init', trn, layers: [{ bytes, x, z, yaw }], bitmaps: [{ familyId, bytes }], ramps: [{ name, width, rgb }] }
//      { type: 'generate', id, startX, startZ, n, step }
// Out: { type: 'ready', info } | { type: 'grid', id, heights, shaders, children, colors, excluded,
//      floraCollidable, floraNonCollidable, environments, seasonal } | { type: 'error', message }

import { attachBitmap, attachRamp, parseLayerFile, parseTerrainTemplate, TerrainSampler } from './trn.ts';

export interface TerrainInitMessage {
  type: 'init';
  trn: ArrayBuffer;
  layers: { bytes: ArrayBuffer; x: number; z: number; yaw: number }[];
  bitmaps: { familyId: number; bytes: ArrayBuffer }[];
  /** The colour ramps the colour affectors read, three bytes a pixel; a ramp that is not here makes its affector do nothing. */
  ramps?: { name: string; width: number; rgb: ArrayBuffer }[];
}

export interface TerrainGenerateMessage {
  type: 'generate';
  id: number;
  startX: number;
  startZ: number;
  n: number;
  step: number;
}

export interface TerrainWorkerReply {
  message: { type: string; [k: string]: unknown };
  transfer: Transferable[];
}

export class TerrainWorkerCore {
  private sampler: TerrainSampler | null = null;

  handle(msg: TerrainInitMessage | TerrainGenerateMessage): TerrainWorkerReply {
    try {
      if (msg.type === 'init') {
        const template = parseTerrainTemplate(new Uint8Array(msg.trn));
        for (const b of msg.bitmaps ?? []) attachBitmap(template, b.familyId, new Uint8Array(b.bytes));
        let ramps = 0;
        for (const r of msg.ramps ?? []) if (attachRamp(template, r.name, { width: r.width, rgb: new Uint8Array(r.rgb) })) ramps++;
        this.sampler = new TerrainSampler(template);
        let applied = 0;
        for (const l of msg.layers) {
          const layer = parseLayerFile(new Uint8Array(l.bytes), template.generator);
          if (!layer) continue;
          this.sampler.addBuildingLayer(layer, l.x, l.z, l.yaw);
          applied++;
        }
        return { message: { type: 'ready', info: { name: template.name, layers: applied, ramps, items: template.generator.summary() } }, transfer: [] };
      }
      if (msg.type === 'generate') {
        if (!this.sampler) throw new Error('terrain worker: generate before init');
        const g = this.sampler.generate(msg.startX, msg.startZ, msg.n, msg.step);
        return {
          message: { type: 'grid', id: msg.id, heights: g.heights, shaders: g.shaders, children: g.children, colors: g.colors, excluded: g.excluded, floraCollidable: g.floraCollidable, floraNonCollidable: g.floraNonCollidable, environments: g.environments, seasonal: g.seasonal },
          transfer: [g.heights.buffer, g.shaders.buffer, g.children.buffer, g.colors.buffer, g.excluded.buffer, g.floraCollidable.buffer, g.floraNonCollidable.buffer, g.environments.buffer, g.seasonal.buffer],
        };
      }
      return { message: { type: 'error', message: `terrain worker: unknown message ${(msg as { type?: unknown }).type}` }, transfer: [] };
    } catch (err) {
      return { message: { type: 'error', message: err instanceof Error ? err.message : String(err) }, transfer: [] };
    }
  }
}
