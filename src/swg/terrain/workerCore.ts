// The terrain worker's whole job, kept apart from the worker itself so node can drive it: one sampler
// built from the planet's terrain file at `init` (its bitmaps, colour ramps and building layers with
// it), then a pole grid generated for every `generate`. Every map of a grid goes out with it and every
// one is transferred, never copied, so the answer costs the main thread nothing to receive.
//
// In:  { type: 'init', trn, layers: [{ bytes, x, z, yaw }], bitmaps: [{ familyId, bytes }], ramps: [{ name, width, rgb }], roadsClearFlora, lifeDay, paint?, rev?, lent? }
//      { type: 'paint', rev, paint, lent? }                (Map-maker II: the ground's paint as it stands now, `groundPaint.ts`;
//                                                           `lent` the families other worlds lent the main thread's group)
//      { type: 'generate', id, startX, startZ, n, step }
// Out: { type: 'ready', info } | { type: 'grid', id, rev, heights, shaders, children, colors, excluded,
//      floraCollidable, floraNonCollidable, radialNear, radialFar, environments, seasonal, colorsUnpainted?, roads } | { type: 'error', message }
//      (`roads`, Map-maker II's fourth wave: one byte a pole a road's flat part or a river's bed reached.)
//
// Every grid carries the paint's revision it was made at (`rev`), so the main thread can tell a grid asked for before a
// stroke was let go and answered after it, and ask for it again rather than put it (DESIGN.md §2.5). The worker's paint is
// its own copy, posted and never shared: its module is a copy of its own.

import { TERRAIN_GROUND_TUNE, type LentFamily } from './generator.ts';
import { GroundPaint, type GroundPaintMessage } from './groundPaint.ts';
import { attachBitmap, attachRamp, parseLayerFile, parseTerrainTemplate, TerrainSampler } from './trn.ts';

export interface TerrainInitMessage {
  type: 'init';
  trn: ArrayBuffer;
  layers: { bytes: ArrayBuffer; x: number; z: number; yaw: number }[];
  bitmaps: { familyId: number; bytes: ArrayBuffer }[];
  /** The colour ramps the colour affectors read, three bytes a pixel; a ramp that is not here makes its affector do nothing. */
  ramps?: { name: string; width: number; rgb: ArrayBuffer }[];
  /** The main thread's `TERRAIN_GROUND_TUNE.roadsClearFlora`, since the worker's module is a copy of its own; absent keeps the default. */
  roadsClearFlora?: boolean;
  /** The main thread's `TERRAIN_GROUND_TUNE.lifeDay`, read as the terrain is parsed; absent keeps the default (out of season). */
  lifeDay?: boolean;
  /** The world's ground paint as the main thread holds it at the start (Map-maker II), and its revision; absent paints nothing. */
  paint?: GroundPaintMessage | null;
  rev?: number;
  /** The families other worlds lent the main thread's group (Map-maker II's third wave), each at its id there; absent lends none. */
  lent?: LentFamily[];
}

/** The ground's paint as it stands now (Map-maker II): what every grid made after it is painted with, at revision `rev`. */
export interface TerrainPaintMessage {
  type: 'paint';
  rev: number;
  paint: GroundPaintMessage | null;
  /** The main thread's lent families as they stand now (Map-maker II's third wave), so the worker's group gives each the same id. */
  lent?: LentFamily[];
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
  /** The paint's revision every grid made now is painted at (0: none ever). */
  private rev = 0;

  /** The paint taken (or let go: null), its revision with it. */
  private takePaint(m: GroundPaintMessage | null | undefined, rev: number | undefined): void {
    const s = this.sampler;
    if (!s) return;
    if (typeof rev === 'number' && Number.isFinite(rev)) this.rev = rev;
    if (!m) {
      s.paint = null;
      return;
    }
    // A paint of another cell is a paint afresh; one of the same cell takes the message over what it holds.
    if (!s.paint || s.paint.cell !== m.cell) s.paint = new GroundPaint(m.cell);
    s.paint.take(m);
  }

  handle(msg: TerrainInitMessage | TerrainPaintMessage | TerrainGenerateMessage): TerrainWorkerReply {
    try {
      if (msg.type === 'init') {
        if (typeof msg.roadsClearFlora === 'boolean') TERRAIN_GROUND_TUNE.roadsClearFlora = msg.roadsClearFlora;
        if (typeof msg.lifeDay === 'boolean') TERRAIN_GROUND_TUNE.lifeDay = msg.lifeDay;
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
        // Other worlds' families lent the main thread's group (Map-maker II's third wave), after the building layers as the
        // main thread lends them, each at the id it has there.
        template.generator.shaderGroup.takeLent(msg.lent);
        if (msg.paint) this.takePaint(msg.paint, msg.rev);
        return { message: { type: 'ready', info: { name: template.name, layers: applied, ramps, items: template.generator.summary() } }, transfer: [] };
      }
      if (msg.type === 'paint') {
        if (!this.sampler) throw new Error('terrain worker: paint before init');
        this.sampler.generator.shaderGroup.takeLent(msg.lent);
        this.takePaint(msg.paint, msg.rev);
        return { message: { type: 'painted', rev: this.rev }, transfer: [] };
      }
      if (msg.type === 'generate') {
        if (!this.sampler) throw new Error('terrain worker: generate before init');
        const g = this.sampler.generate(msg.startX, msg.startZ, msg.n, msg.step);
        const reply: TerrainWorkerReply = {
          message: { type: 'grid', id: msg.id, rev: this.rev, heights: g.heights, shaders: g.shaders, children: g.children, colors: g.colors, excluded: g.excluded, floraCollidable: g.floraCollidable, floraNonCollidable: g.floraNonCollidable, radialNear: g.radialNear, radialFar: g.radialFar, environments: g.environments, seasonal: g.seasonal },
          transfer: [g.heights.buffer, g.shaders.buffer, g.children.buffer, g.colors.buffer, g.excluded.buffer, g.floraCollidable.buffer, g.floraNonCollidable.buffer, g.radialNear.buffer, g.radialFar.buffer, g.environments.buffer, g.seasonal.buffer],
        };
        // The colours before the paint's (Map-maker II), only where the paint has colours over the grid: a stroke's preview
        // lays the paint over them (`TerrainSampler.previewPaint`).
        if (g.colorsUnpainted) {
          reply.message.colorsUnpainted = g.colorsUnpainted;
          reply.transfer.push(g.colorsUnpainted.buffer);
        }
        // The poles a road or a river reached (Map-maker II's fourth wave): what the scatter brush keeps off.
        if (g.roads) {
          reply.message.roads = g.roads;
          reply.transfer.push(g.roads.buffer);
        }
        return reply;
      }
      return { message: { type: 'error', message: `terrain worker: unknown message ${(msg as { type?: unknown }).type}` }, transfer: [] };
    } catch (err) {
      return { message: { type: 'error', message: err instanceof Error ? err.message : String(err) }, transfer: [] };
    }
  }
}
