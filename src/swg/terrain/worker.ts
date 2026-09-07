// Web Worker: owns a TerrainSampler and generates pole grids off the main thread.
// Messages in: { type: 'init', trn, layers: [{ bytes, x, z, yaw }] } | { type: 'generate', id, startX, startZ, n, step }
// Messages out: { type: 'ready', info } | { type: 'grid', id, heights, shaders } | { type: 'error', message }

import { parseLayerFile, parseTerrainTemplate, TerrainSampler } from './trn.ts';

interface InitMessage {
  type: 'init';
  trn: ArrayBuffer;
  layers: { bytes: ArrayBuffer; x: number; z: number; yaw: number }[];
}

interface GenerateMessage {
  type: 'generate';
  id: number;
  startX: number;
  startZ: number;
  n: number;
  step: number;
}

const ctx = self as unknown as { postMessage(message: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null };

let sampler: TerrainSampler | null = null;

ctx.onmessage = (e: MessageEvent<InitMessage | GenerateMessage>) => {
  const msg = e.data;
  try {
    if (msg.type === 'init') {
      const template = parseTerrainTemplate(new Uint8Array(msg.trn));
      sampler = new TerrainSampler(template);
      let applied = 0;
      for (const l of msg.layers) {
        const layer = parseLayerFile(new Uint8Array(l.bytes), template.generator);
        if (!layer) continue;
        sampler.addBuildingLayer(layer, l.x, l.z, l.yaw);
        applied++;
      }
      ctx.postMessage({ type: 'ready', info: { name: template.name, layers: applied, items: template.generator.summary() } });
    } else if (msg.type === 'generate') {
      if (!sampler) throw new Error('terrain worker: generate before init');
      const g = sampler.generate(msg.startX, msg.startZ, msg.n, msg.step);
      ctx.postMessage({ type: 'grid', id: msg.id, heights: g.heights, shaders: g.shaders }, [g.heights.buffer, g.shaders.buffer]);
    }
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
