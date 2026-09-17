// How long each step of the chain takes, on the GPU as well as on the main thread. The GPU part
// uses timer queries, which answer two or three frames late and have to be thrown away whenever
// the driver says it lost track of time; without the extension only the main-thread numbers come
// back. Nothing runs at all until `enabled` is set from the console, so a normal frame pays
// nothing for it.
import * as THREE from 'three';

export interface FxTimingRow {
  /** Mean milliseconds on the GPU, or null without the extension. */
  gpuMs: number | null;
  /** Mean milliseconds on the main thread. */
  cpuMs: number;
  /** Mean draw calls. */
  calls: number;
  budgetMs?: number;
  over?: boolean;
}

export interface FxTimingReport {
  gpu: boolean;
  frames: number;
  rows: Record<string, FxTimingRow>;
  /** Everything but the scene, summed. */
  postGpuMs: number;
  postCpuMs: number;
}

interface Row {
  gpuSum: number;
  gpuCount: number;
  cpuSum: number;
  cpuCount: number;
  callSum: number;
}

interface Pending {
  label: string;
  query: WebGLQuery;
}

const TIME_ELAPSED = 0x88bf;
const GPU_DISJOINT = 0x8fbb;
const QUERY_RESULT = 0x8866;
const QUERY_RESULT_AVAILABLE = 0x8867;

/** The most queries kept alive; the pool only grows while the timer is on. */
const MAX_QUERIES = 64;

export class FxTimer {
  enabled = false;
  private readonly gl: WebGL2RenderingContext;
  private readonly ext: unknown;
  private readonly rows = new Map<string, Row>();
  private readonly pending: Pending[] = [];
  private readonly pool: WebGLQuery[] = [];
  private readonly made: WebGLQuery[] = [];
  private open: { label: string; cpu: number; calls: number; query: WebGLQuery | null } | null = null;
  private frames = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.gl = renderer.getContext() as WebGL2RenderingContext;
    this.ext = renderer.extensions.get('EXT_disjoint_timer_query_webgl2');
  }

  get hasGpu(): boolean {
    return !!this.ext;
  }

  begin(label: string): void {
    if (!this.enabled || this.open) return;
    let query: WebGLQuery | null = null;
    if (this.ext) {
      query = this.pool.pop() ?? null;
      if (!query && this.made.length < MAX_QUERIES) {
        query = this.gl.createQuery();
        if (query) this.made.push(query);
      }
      if (query) this.gl.beginQuery(TIME_ELAPSED, query);
    }
    this.open = { label, cpu: performance.now(), calls: this.renderer.info.render.calls, query };
  }

  end(label: string): void {
    const open = this.open;
    if (!open || open.label !== label) return;
    this.open = null;
    const row = this.row(label);
    row.cpuSum += performance.now() - open.cpu;
    row.cpuCount++;
    row.callSum += this.renderer.info.render.calls - open.calls;
    if (open.query) {
      this.gl.endQuery(TIME_ELAPSED);
      this.pending.push({ label, query: open.query });
    }
  }

  /** Once a frame: take whatever the driver has finished timing. */
  poll(): void {
    if (!this.enabled) return;
    this.frames++;
    if (!this.ext || !this.pending.length) return;
    const gl = this.gl;
    // The driver lost track of time (a tab switch, a reset): everything in flight is nonsense.
    if (gl.getParameter(GPU_DISJOINT)) {
      for (const p of this.pending) this.pool.push(p.query);
      this.pending.length = 0;
      return;
    }
    let keep = 0;
    for (let i = 0; i < this.pending.length; i++) {
      const p = this.pending[i];
      if (!gl.getQueryParameter(p.query, QUERY_RESULT_AVAILABLE)) {
        this.pending[keep++] = p;
        continue;
      }
      const row = this.row(p.label);
      row.gpuSum += (gl.getQueryParameter(p.query, QUERY_RESULT) as number) / 1e6;
      row.gpuCount++;
      this.pool.push(p.query);
    }
    this.pending.length = keep;
  }

  reset(): void {
    this.rows.clear();
    this.frames = 0;
    for (const p of this.pending) this.pool.push(p.query);
    this.pending.length = 0;
  }

  report(budgets: Record<string, number> = {}): FxTimingReport {
    const rows: Record<string, FxTimingRow> = {};
    let postGpu = 0;
    let postCpu = 0;
    for (const [label, r] of this.rows) {
      const gpuMs = r.gpuCount ? Number((r.gpuSum / r.gpuCount).toFixed(3)) : null;
      const cpuMs = r.cpuCount ? Number((r.cpuSum / r.cpuCount).toFixed(3)) : 0;
      const row: FxTimingRow = { gpuMs, cpuMs, calls: r.cpuCount ? Math.round(r.callSum / r.cpuCount) : 0 };
      const budget = budgets[label];
      if (budget !== undefined) {
        row.budgetMs = budget;
        row.over = gpuMs !== null && gpuMs > budget;
      }
      rows[label] = row;
      if (label !== 'scene') {
        postGpu += gpuMs ?? 0;
        postCpu += cpuMs;
      }
    }
    return { gpu: !!this.ext, frames: this.frames, rows, postGpuMs: Number(postGpu.toFixed(3)), postCpuMs: Number(postCpu.toFixed(3)) };
  }

  dispose(): void {
    if (this.open) {
      if (this.open.query) this.gl.endQuery(TIME_ELAPSED);
      this.open = null;
    }
    for (const q of this.made) this.gl.deleteQuery(q);
    this.made.length = 0;
    this.pool.length = 0;
    this.pending.length = 0;
  }

  private row(label: string): Row {
    let r = this.rows.get(label);
    if (!r) {
      r = { gpuSum: 0, gpuCount: 0, cpuSum: 0, cpuCount: 0, callSum: 0 };
      this.rows.set(label, r);
    }
    return r;
  }
}
