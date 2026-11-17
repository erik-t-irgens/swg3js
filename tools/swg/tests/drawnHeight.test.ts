// Wave 3 of the animations, item B: the drawn body's height over a step (src/anim/drawnHeight.ts). The controller's
// autostep lifts the capsule a whole riser in one step, its snap drops it one going down; the drawn figure keeps where it
// was and eases onto the capsule over `stairs.ease`, at most `stairs.lagMost` away. What is a pop and what is the ground's
// own slope is told by the plane under the body, so a ramp is drawn on its capsule exactly. Pure: driven here frame by
// frame, at 30, 60 and 144 frames a second, against the arithmetic it promises; with the player's hand-overs as text.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DrawnHeight, DrawnIn } from '../../../src/anim/drawnHeight.ts';
import { LOCO_TUNE_SHIPPED, type LocoTune } from '../../../src/anim/locoTune.ts';
import { REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const T = (): LocoTune['stairs'] => JSON.parse(JSON.stringify(LOCO_TUNE_SHIPPED.stairs)) as LocoTune['stairs'];

/** A frame on level ground (or a plane of slope `deg` along +x) moving `dx` along x, the controller adding `extra` up. */
function frameIn(dt: number, dx: number, extra: number, deg = 0, grounded = true, plane = true): DrawnIn {
  const f = new DrawnIn();
  const t = Math.tan((deg * Math.PI) / 180);
  const c = Math.cos((deg * Math.PI) / 180);
  f.dt = dt;
  f.dx = dx;
  f.dz = 0;
  f.askedY = -0.02;
  f.dy = -0.02 + dx * t + extra;
  // The plane rising along +x: its normal (-sin, cos).
  f.nx = plane ? -Math.sin((deg * Math.PI) / 180) : Number.NaN;
  f.ny = plane ? c : Number.NaN;
  f.nz = plane ? 0 : Number.NaN;
  f.grounded = grounded;
  return f;
}

{
  const tune = T();
  // A riser of 0.25 stepped up at the walk's 1.66 m/s: the offset every sixth of a second after, at three frame rates.
  const traces = new Map<number, number[]>();
  for (const fps of [30, 60, 144]) {
    const d = new DrawnHeight();
    const dt = 1 / fps;
    const out: number[] = [];
    for (let i = 1; i <= fps; i++) {
      d.step(frameIn(dt, 1.66 * dt, i === 1 ? 0.25 : 0), tune);
      if (i % (fps / 6) === 0) out.push(d.offset);
    }
    traces.set(fps, out);
  }
  const want = [1, 2, 3, 4, 5, 6].map((k) => -0.25 * Math.exp(-(k / 6) / tune.ease));
  const worst = Math.max(...[30, 60, 144].flatMap((fps) => traces.get(fps)!.map((v, i) => Math.abs(v - want[i]))));
  ok(worst < 1e-12, `a riser of 0.25 m stepped up: the drawn body stays where it was and eases onto the capsule as -0.25 e^(-t/${tune.ease}), alike at 30, 60 and 144 frames a second (to ${worst.toExponential(1)} m)`);
  // A drop snapped down going down: the other way.
  const d = new DrawnHeight();
  d.step(frameIn(1 / 60, 0.03, -0.2), tune);
  ok(Math.abs(d.offset - 0.2 * Math.exp(-1 / 60 / tune.ease)) < 1e-12 && d.popped < -0.19, 'a riser of 0.2 m snapped down: the drawn body held over the capsule and eased down onto it');
  // A ramp: the capsule follows the plane; no pop at all, at any slope the body walks.
  let ramp = 0;
  for (const deg of [5, 20, 35, 45]) {
    const r = new DrawnHeight();
    for (let i = 0; i < 120; i++) r.step(frameIn(1 / 60, 1.66 / 60, 0, deg), tune);
    ramp = Math.max(ramp, Math.abs(r.offset));
  }
  ok(ramp === 0, 'walking up ramps of 5 to 45 degrees the drawn body is the capsule exactly (the plane\'s own rise is no pop)');
  const air = new DrawnHeight();
  air.step(frameIn(1 / 60, 0.03, 0.3, 0, false), tune);
  const noPlane = new DrawnHeight();
  noPlane.step(frameIn(1 / 60, 0.03, 0.3, 0, true, false), tune);
  const settle = new DrawnHeight();
  settle.step(frameIn(1 / 60, 0.03, 0.008), tune);
  ok(air.offset === 0 && noPlane.offset === 0 && settle.offset === 0, 'a frame that began in the air (a jump, a landing), one with no plane known, and the controller\'s own settling under a centimetre: no pop');
  const big = new DrawnHeight();
  big.step(frameIn(1 / 60, 0.03, 0.9), tune);
  ok(big.offset === -tune.lagMost, `a pop past \`lagMost\` (0.9 m) is held to it (${big.offset} m)`);
  const off = T();
  off.rule = 'before';
  const before = new DrawnHeight();
  for (let i = 0; i < 30; i++) before.step(frameIn(1 / 60, 0.03, i === 3 ? 0.25 : 0), off);
  ok(before.offset === 0 && before.popped === 0, 'under \'before\' the drawn body is the capsule, every frame');
}

// ---- the player's hand-overs ----------------------------------------------------------------------------------------------------
{
  const player = readFileSync(join(REPO, 'src/player/player.ts'), 'utf8').replace(/\r\n/g, '\n');
  ok(player.includes('    di.nx = this.slope.planeNx;\n    di.ny = this.slope.planeNy;\n    di.nz = this.slope.planeNz;\n    di.grounded = wasGrounded && !this.swimming && !rope;\n    this.drawn.step(di, LOCO_TUNE.stairs);'), 'the player hands the ease the slope rule\'s plane after the move and whether the frame began on its feet');
  ok(player.includes('    if (rig && this.drawn.offset !== 0) rig.root.position.y += this.drawn.offset;'), 'and lays the offset on the rig\'s root alone, after the sink\'s write (the capsule, the physics and the wire untouched)');
  const main = readFileSync(join(REPO, 'src/main.ts'), 'utf8');
  ok((main.match(/player\.followAt/g) ?? []).length >= 2, 'the chase follows the drawn body\'s height (`player.followAt`) on foot');
}

console.log(`drawnHeight: ${checks} checks passed`);
