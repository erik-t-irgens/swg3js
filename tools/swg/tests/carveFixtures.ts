// The race drawer's second wave's courses for its tests (not a test itself): tracks shaped as the carve reads them, in the
// raw frame. A straight sprint, a figure eight whose crossing is raised, a climbing hairpin, two parallel roads, a circuit
// with a shortcut joined at both ends, and a level crossing. Every number here is the test's own.
import type { CarveNode, CarveTrack } from '../../../src/swg/terrain/courseCarve.ts';

export function node(x: number, z: number, y: number, o: Partial<CarveNode> & { j?: string } = {}): CarveNode & { j?: string } {
  return { x, y, z, w: o.w ?? 12, b: o.b ?? 0, sh: o.sh ?? 8, c: o.c ?? 'smooth', ...(o.j ? { j: o.j } : {}) };
}

export interface CourseNumbers {
  feather?: string;
  crossing?: string;
  margin?: number;
  level?: number;
  grass?: string;
}

/** A track of one or more paths. */
export function track(id: string, kind: 'circuit' | 'sprint', paths: { id: string; nodes: CarveNode[] }[], n: CourseNumbers = {}, clear = 6): CarveTrack {
  return { id, kind, clear, course: { feather: n.feather ?? 'easeInOut', crossing: n.crossing ?? 'wall', margin: n.margin ?? 2, level: n.level ?? 1, grass: n.grass ?? 'clear', paths } };
}

/** A straight sprint along +x from (x0, z) to (x1, z) at height y (its right is -z). */
export function straight(id: string, x0: number, x1: number, z: number, y: number, o: Partial<CarveNode> = {}, n: CourseNumbers = {}): CarveTrack {
  return track(id, 'sprint', [{ id: 'main', nodes: [node(x0, z, y, { ...o, c: 'straight' }), node(x1, z, y, { ...o, c: 'straight' })] }], n);
}

/**
 * A figure eight about the origin: the diagonal running down-right through the middle is the upper road (`hi` m), the one
 * running down-left the lower (0 m), its loops' ends at 3 m. Straights through the crossing, so both roads cross square on
 * their own lines.
 */
export function figureEight(id = 'eight', hi = 8, n: CourseNumbers = {}, w = 12): CarveTrack {
  const s = { w, c: 'straight' as const };
  return track(
    id,
    'circuit',
    [
      {
        id: 'main',
        nodes: [
          node(-180, 0, 3, { w }),
          node(-90, 90, hi, s),
          node(90, -90, hi, { w }),
          node(180, 0, 3, { w }),
          node(90, 90, 0, s),
          node(-90, -90, 0, { w }),
        ],
      },
    ],
    n,
  );
}

/**
 * A climbing hairpin: two legs 40 m apart run along +x and back at heights `y0` and `y0 + rise`, joined by a turn; their
 * roads (12 m wide) and shoulders (8 m) do not overlap but their shoulders meet in the gap.
 */
export function hairpin(id = 'pin', rise = 5, gap = 40, n: CourseNumbers = {}): CarveTrack {
  return track(
    id,
    'sprint',
    [
      {
        id: 'main',
        nodes: [node(-200, 0, 0, { c: 'straight' }), node(100, 0, 0), node(160, gap / 2, rise / 2), node(100, gap, rise, { c: 'straight' }), node(-200, gap, rise, { c: 'straight' })],
      },
    ],
    n,
  );
}

/** Two straight parallel roads `gap` m apart, `rise` m apart in height. */
export function parallel(gap = 30, rise = 5, n: CourseNumbers = {}): CarveTrack[] {
  return [straight('low', -200, 200, 0, 0, {}, n), straight('high', -200, 200, gap, rise, {}, n)];
}

/** A circuit with two shortcuts across it, each joined to the main road at both ends. */
export function withShortcuts(id = 'loop', order: 'ab' | 'ba' = 'ab', rotate = 0): CarveTrack {
  const main = [node(-200, -200, 0), node(200, -200, 2), node(200, 200, 4), node(-200, 200, 2)];
  const r = ((rotate % main.length) + main.length) % main.length;
  const rot = main.slice(r).concat(main.slice(0, r));
  const a = { id: 'cut_a', nodes: [node(0, -200, 1, { j: 'main' }), node(0, 0, 3), node(0, 200, 3, { j: 'main' })] };
  const b = { id: 'cut_b', nodes: [node(-200, 0, 1, { j: 'main' }), node(-50, 30, 2), node(200, 0, 3, { j: 'main' })] };
  return track(id, 'circuit', [{ id: 'main', nodes: rot }, ...(order === 'ab' ? [a, b] : [b, a])]);
}

/** A grid of poles over a rectangle of the raw frame at `step` m, as a lay asks it. */
export function grid(x0: number, z0: number, nx: number, nz: number, step: number): { raw: Float32Array; out: Float32Array; x0: number; z0: number; nx: number; nz: number; step: number } {
  return { raw: new Float32Array(nx * nz), out: new Float32Array(nx * nz), x0, z0, nx, nz, step };
}
