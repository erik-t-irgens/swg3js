// Web Worker: owns a TerrainSampler and generates pole grids off the main thread. What it does with
// each message is `TerrainWorkerCore` (workerCore.ts), where the messages' shapes are written down;
// this file only joins it to the worker's own port.

import { TerrainWorkerCore, type TerrainGenerateMessage, type TerrainInitMessage } from './workerCore.ts';

const ctx = self as unknown as { postMessage(message: unknown, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent) => void) | null };

const core = new TerrainWorkerCore();

ctx.onmessage = (e: MessageEvent<TerrainInitMessage | TerrainGenerateMessage>) => {
  const reply = core.handle(e.data);
  ctx.postMessage(reply.message, reply.transfer);
};
