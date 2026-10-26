// The clouds' calibration at run time (the volumetrics' seventh wave's second half, the design's §2.18): the converter's
// own sweep (`coverCurve`, `cloudMath.ts`) over the noise volumes, off the main thread. A deck's cut curve depends on the
// march's numbers and the low deck needs one of its own, so a dial that moves one asks this again and nothing is
// calibrated on the main thread; until it answers the manifest's curve stands.
//
// It fetches the volumes itself (the browser's cache holds them from the clouds' own fetch), runs each job asked at 32²
// rays (48 ms in node, within 0.005 of 64²'s everywhere), and answers each curve with the job's own id.
import { coverCurve, type CoverMarch, type CoverPoint } from '../../core/fx/cloudMath.ts';

/** One curve asked for: which deck, the march it is measured through, and its profile's decks. */
export interface CalibrateJob {
  which: 'high' | 'low';
  march: CoverMarch;
  decks: number;
}

/** What the feed posts: the volumes' addresses and sizes, and the jobs. */
export interface CalibrateAsk {
  id: number;
  baseUrl: string;
  detailUrl: string;
  baseSize: number;
  detailSize: number;
  rays: number;
  jobs: CalibrateJob[];
}

/** What it answers. */
export interface CalibrateAnswer {
  id: number;
  curves: { which: 'high' | 'low'; cover: CoverPoint[] }[];
  ms: number;
  error?: string;
}

let volumes: { base: Uint8Array; detail: Uint8Array; baseUrl: string } | null = null;

async function bytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

const scope = self as unknown as { onmessage: ((e: MessageEvent<CalibrateAsk>) => void) | null; postMessage(m: CalibrateAnswer): void };
scope.onmessage = (e: MessageEvent<CalibrateAsk>) => {
  const a = e.data;
  void (async () => {
    const t0 = performance.now();
    try {
      if (!volumes || volumes.baseUrl !== a.baseUrl) volumes = { base: await bytes(a.baseUrl), detail: await bytes(a.detailUrl), baseUrl: a.baseUrl };
      if (volumes.base.length !== a.baseSize ** 3 * 4 || volumes.detail.length !== a.detailSize ** 3 * 4) throw new Error('the noise volumes are not the size their manifest says');
      const curves = a.jobs.map((j) => ({ which: j.which, cover: coverCurve(volumes!.base, volumes!.detail, a.baseSize, a.detailSize, j.march, j.decks, undefined, a.rays) }));
      scope.postMessage({ id: a.id, curves, ms: Math.round(performance.now() - t0) });
    } catch (err) {
      scope.postMessage({ id: a.id, curves: [], ms: Math.round(performance.now() - t0), error: String((err as Error)?.message ?? err) });
    }
  })();
};
