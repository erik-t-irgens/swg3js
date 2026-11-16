// The stairs wave, part A's walk: the human male walked or jogged by the game's own movement, classes, sampler and feet
// (`stairsWaveBody.ts`, the player's order) over a slope, a kerb or a flight, measured for what the hips add to the clip's
// own bob. What a run gives: the hips' height over the figure's root (the clip's bob and the feet's drop) from its lowest to
// its highest over a stretch walked steadily, its largest change in a frame, the planted feet's worst slide, and how far a
// knee ever stood behind its hip-to-ankle line. Not a test itself.
import * as H from './grappleBody.ts';
import * as W from './stairsWaveBody.ts';
import { LOCO_TUNE } from '../../../src/anim/locoTune.ts';

export interface HipsRun {
  /** The hips over the root, lowest to highest over the stretch, metres. */
  bob: number;
  /** The hips' height in the world less the straight line through it along the travel (a least-squares fit), lowest to highest, metres: the bob the eye sees on a slope. */
  line: number;
  /** The largest change of that, metres a second (frame to frame). */
  linePop: number;
  /** The largest change of the hips' height in the world, metres a second (frame to frame). */
  worldPop: number;
  /** The largest change of the hips over the root in a frame, metres a second. */
  pop: number;
  /** The planted feet's worst slide over a stance (a sole point on its ground, along the travel), metres, and how many stances. */
  slide: number;
  stances: number;
  /** How far a knee stood behind its hip-to-ankle line at the worst (positive: behind), metres. */
  knee: number;
  frames: number;
  /**
   * A planted foot (planted whole, on its ground) whose lower sole point (heel or ball) stands over its ground: the worst, metres,
   * and in how many frames by more than a centimetre (the brief: a planted foot within a centimetre of its ground).
   */
  float: number;
  floatFrames: number;
  /** The deepest any sole point (heel, ball, the toe's tip), planted or swinging, stands under the ground, metres. */
  sunk: number;
}
export type Ground = { kind: 'flat' } | { kind: 'slope'; deg: number; way: number } | { kind: 'kerb'; h: number } | { kind: 'stairs'; tread: number; riser: number; way: number };

/** One run of `seconds` over the ground at `fps`, the walk (true) or the jog, under the hips' rule asked. */
export async function hipsRun(ground: Ground, walk: boolean, fps: number, hips: 'steady' | 'before', seconds = 9): Promise<HipsRun> {
  const was = LOCO_TUNE.ik.hips;
  LOCO_TUNE.ik.hips = hips;
  const { clips, cycles } = await W.clipsAndCycles();
  const p = await H.makePhysics();
  let y0 = 0.02;
  // The stretch measured: along x, where the ground is what the run is of and the walk steady.
  let lo = 4;
  let hi = 12;
  let prof: (x: number) => number = () => 0;
  if (ground.kind === 'flat') H.ground(p, 0);
  else if (ground.kind === 'slope') {
    const k = Math.tan((ground.deg * Math.PI) / 180);
    const up = ground.way > 0;
    const h = (x: number) => (up ? Math.min(Math.max(x - 2, 0), 20) : Math.min(Math.max(22 - x, 0), 20)) * k;
    H.heightChunk(p, -8, -32, (x) => h(x));
    prof = h;
    if (!up) y0 = h(0) + 0.02;
    lo = 5;
    hi = 16;
  } else if (ground.kind === 'kerb') {
    H.ground(p, 0);
    H.box(p, [5, 0, -3], [40, ground.h, 3]);
    prof = (x) => (x >= 5 ? ground.h : 0);
    lo = 3;
    hi = 8;
  } else {
    prof = W.flight(p, { tread: ground.tread, riser: ground.riser, count: 14, x0: 2, way: ground.way });
    if (ground.way < 0) y0 = 14 * ground.riser + 0.02;
    lo = 2 + 2 * ground.tread;
    hi = 2 + 12 * ground.tread;
  }
  p.stepOnce();
  const w = new W.Walker(p, clips, cycles);
  w.walk = walk;
  w.knees = true;
  w.place(0, y0, 0);
  const dt = 1 / fps;
  let lowest = Infinity;
  let highest = -Infinity;
  let pop = 0;
  let last = Number.NaN;
  let frames = 0;
  let knee = -Infinity;
  let float = 0;
  let floatFrames = 0;
  let sunk = 0;
  let slide = 0;
  let stances = 0;
  const st: (number[] | null)[] = [null, null, null, null];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < seconds * fps; i++) {
    const r = w.frame(dt);
    const rel = r.hipY - (r.y + w.drawn.offset);
    if (r.x < lo || r.x > hi) {
      last = rel;
      st.fill(null);
      continue;
    }
    frames++;
    xs.push(r.x);
    ys.push(r.hipY);
    lowest = Math.min(lowest, rel);
    highest = Math.max(highest, rel);
    if (last === last) pop = Math.max(pop, Math.abs(rel - last) / dt);
    last = rel;
    for (let s = 0; s < 2; s++) {
      const l = r.legs[s];
      // The knee against its hip-to-ankle line, along the figure's front (+x): behind is the line's side the front is not.
      const [hx, hy] = l.hip;
      const [kx, ky] = l.knee;
      const [ax, ay] = l.ankle;
      const dx = ax - hx;
      const dy = ay - hy;
      const len = Math.hypot(dx, dy) || 1;
      // The line's normal toward the front: (-dy, dx) for a leg hanging down (dy < 0) points along +x.
      const nx = -dy / len;
      const ny = dx / len;
      const ahead = (kx - hx) * nx + (ky - hy) * ny;
      knee = Math.max(knee, -ahead);
      if (l.planted >= 0.99 && l.grounded) {
        // Its lowest sole point: the heel, the ball, or at toe-off the tip of the toes it is rolled onto (jogging down a steep
        // slope the heel is 12 cm up, the toes bent 12 to 18 degrees and the ball 1 to 1.7 cm over the ground the tip stands on).
        // The tip counts only with the toes bent up off the foot's own line by 5 degrees or more (rolled onto, not pointed: a
        // foot pointed down whole at a heel strike, the toes on its line, still reads its ball).
        const footPitch = Math.atan2(l.heel[1] - l.ball[1], l.ball[0] - l.heel[0]);
        const toePitch = Math.atan2(l.ball[1] - l.tip[1], l.tip[0] - l.ball[0]);
        const rolled = l.tip[1] === l.tip[1] && footPitch - toePitch >= (5 * Math.PI) / 180;
        const tip = rolled ? l.tip[1] - prof(l.tip[0]) : Infinity;
        const e = Math.min(l.heel[1] - prof(l.heel[0]), l.ball[1] - prof(l.ball[0]), tip);
        if (e > float) float = e;
        if (e > 0.01) floatFrames++;
      }
      for (const at of [l.heel, l.ball, l.tip]) if (at[1] === at[1]) sunk = Math.max(sunk, prof(at[0]) - at[1]);
      // Each sole point (heel, ball) while it stands on its ground (within 1 cm, the foot planted whole): its range along
      // the travel over each unbroken run of such frames (a stance, or the part of one a point stands through).
      for (let pt = 0; pt < 2; pt++) {
        const at = pt === 0 ? l.heel : l.ball;
        const on = l.planted >= 0.99 && l.grounded && Math.abs(at[1] - prof(at[0])) <= 0.01;
        const q = st[s * 2 + pt];
        if (on) {
          if (q) {
            q[0] = Math.min(q[0], at[0]);
            q[1] = Math.max(q[1], at[0]);
            q[2]++;
          } else st[s * 2 + pt] = [at[0], at[0], 1];
        } else if (q) {
          if (q[2] >= 3) {
            if (pt === 0) stances++;
            slide = Math.max(slide, q[1] - q[0]);
          }
          st[s * 2 + pt] = null;
        }
      }
    }
  }
  LOCO_TUNE.ik.hips = was;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  const n = xs.length;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
    sxx += xs[i] * xs[i];
    sxy += xs[i] * ys[i];
  }
  const k = n > 1 ? (n * sxy - sx * sy) / (n * sxx - sx * sx) : 0;
  const c = n > 0 ? (sy - k * sx) / n : 0;
  let lo2 = Infinity;
  let hi2 = -Infinity;
  let linePop = 0;
  let worldPop = 0;
  for (let i = 0; i < n; i++) {
    const d = ys[i] - (c + k * xs[i]);
    lo2 = Math.min(lo2, d);
    hi2 = Math.max(hi2, d);
    if (i > 0) {
      linePop = Math.max(linePop, Math.abs(d - (ys[i - 1] - (c + k * xs[i - 1]))) / dt);
      worldPop = Math.max(worldPop, Math.abs(ys[i] - ys[i - 1]) / dt);
    }
  }
  return { bob: highest - lowest, line: hi2 - lo2, linePop, worldPop, pop, slide, stances, knee, frames, float, floatFrames, sunk };
}
