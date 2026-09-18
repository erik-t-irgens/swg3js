// The motion blur's arithmetic, checked without a browser: which movers draw and which are left to
// the camera's blur, the static cut pushed past what the camera follows, the relay's speed estimate,
// the velocity each mover pixel stores, the reconstruction filter's weights (finite for every radius,
// including zero, since the pass sits between the NaN guard and the bloom), and the registry rows and
// budgets the effect claims.
import assert from 'node:assert/strict';
import * as registry from '../../../src/core/fxRegistry.ts';
import {
  MOTION_TUNING,
  MOVER_LIMITS,
  RELAY,
  WARM_VARIANTS,
  classifyMover,
  combineVelocity,
  drawableSince,
  isJump,
  maxBlurRadiusPx,
  moverPriority,
  movingWeight,
  neighbourAccepts,
  reconstructionWeight,
  shownSince,
  staticCut,
  stepRelayVelocity,
  takeByBudget,
  variantKey,
  type BudgetClaim,
  type MoverFacts,
} from '../../../src/core/fx/velocityMath.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const near2 = (a: [number, number], b: [number, number], eps = 1e-9) => near(a[0], b[0], eps) && near(a[1], b[1], eps);

// --- movingWeight ---
ok(movingWeight(0) === 0 && movingWeight(0.5) === 0 && movingWeight(3) === 1, 'a standing thing keeps none of its motion, a walking one all of it');
{
  let mono = true;
  let last = -1;
  for (let s = 0; s <= 5.0001; s += 0.1) {
    const w = movingWeight(s);
    if (w < last) mono = false;
    last = w;
  }
  ok(mono, 'the moving weight never falls as the speed rises');
}

// --- maxBlurRadiusPx ---
ok(maxBlurRadiusPx(1440) === 36 && maxBlurRadiusPx(1080) === 27, 'the longest smear is 36 px either side at 1440, 27 at 1080');
ok(maxBlurRadiusPx(2880) === 64 && maxBlurRadiusPx(200) === 8, 'and it is held between 8 and 64 px');

// --- staticCut ---
{
  const c = { x: 0, y: 0 };
  staticCut(0, c);
  ok(c.x === 25 && c.y === 60, 'nothing followed: the near cut is 25 to 60 m');
  staticCut(7, c);
  ok(c.x === 25 && c.y === 60, 'a figure 7 m away does not move the cut');
  staticCut(180, c);
  ok(c.x === 180 && c.y === 215, 'a hull reaching 180 m away pushes the cut out to its far side');
  let ordered = true;
  for (const f of [0, 1, 25, 60, 1e4]) if (!(staticCut(f, c).x < staticCut(f, c).y)) ordered = false;
  ok(ordered, "the cut's edges are always in order, as the shader's smoothstep needs");
}

// --- isJump ---
ok(isJump('creature', 61, 1 / 144), 'a creature moving 61 m in a frame jumped');
ok(isJump('creature', 1, 1 / 144), 'a creature moving 144 m/s jumped');
ok(!isJump('creature', 0.05, 1 / 144), 'a creature running 7.2 m/s did not');
ok(!isJump('npc', 2.5, 1 / 20), 'a fighter at exactly 50 m/s did not jump');
ok(isJump('npc', 2.6, 1 / 20), 'a fighter at 52 m/s did');
ok(!isJump('vehicle', 1, 1 / 144) && !isJump('player', 1, 1 / 144), 'a vehicle, or the player riding one, at 144 m/s did not');
ok(isJump('remoteVehicle', 11, 1 / 144), "a peer's ship at 1584 m/s did");
ok(isJump('vehicle', 2, 0) === isJump('vehicle', 2, 1e-3), 'a frame of no length is taken as a millisecond');

// --- classifyMover ---
{
  const base: MoverFacts = { kind: 'creature', carried: false, hidden: false, inFrustum: true, historyValid: true, moved: 0, dt: 1 / 144, speed: 0, turn: 0, animated: 0, screenRadiusPx: 100 };
  const c = (o: Partial<MoverFacts>) => classifyMover({ ...base, ...o });
  ok(c({ hidden: true, inFrustum: false }) === 'hidden', 'hidden comes first');
  ok(c({ inFrustum: false }) === 'culled', 'out of view is culled');
  ok(c({ historyValid: false }) === 'fresh', 'no history is fresh');
  ok(c({ moved: 61 }) === 'jump', 'a teleport is a jump');
  ok(c({}) === 'still', 'a standing creature is still');
  ok(c({ animated: 1 }) === 'animated', 'a standing creature with a moving part draws that part');
  ok(c({ speed: 1 }) === 'all' && c({ turn: 0.5 }) === 'all', 'a walking or turning creature draws everything');
  ok(c({ screenRadiusPx: 2, speed: 1 }) === 'small', 'a speck is left to the camera');
  ok(c({ carried: true, screenRadiusPx: 1, animated: 0, speed: 40 }) === 'still', 'what the camera follows is still, never small, never all');
  ok(c({ carried: true, animated: 2 }) === 'animated', 'what the camera follows draws only its moving parts');
}

// --- moverPriority ---
ok(moverPriority(200, 10) > moverPriority(100, 10), 'larger first');
ok(moverPriority(100, 20) > moverPriority(100, 0), 'faster first');
ok(Number.isFinite(moverPriority(Infinity, 0)), 'a mover around the camera still has a finite priority');

// --- variantKey and WARM_VARIANTS ---
ok(variantKey({ skinned: true, morphs: 3, morphNormals: true, morphColors: false, alpha: false }) === 's1|m3|n1|c0|a0', 'a variant key reads s1|m3|n1|c0|a0');
{
  const keys = WARM_VARIANTS.map(variantKey);
  ok(keys.length === 14 && new Set(keys).size === 14, 'fourteen warm variants, fourteen distinct keys');
  ok(keys.includes('s0|m0|n0|c0|a0') && keys.includes('s1|m0|n0|c0|a1') && keys.includes('s1|m4|n1|c0|a0'), 'rigid, alpha-tested skinned and four-morph skinned are among them');
}

// --- combineVelocity ---
{
  const z: [number, number] = [0, 0];
  ok(near2(combineVelocity([0.2, 0.1], [0.2, 0.1], [0.2, 0.1], 1, 0), z), 'a carried hull the camera follows exactly: no velocity');
  ok(near2(combineVelocity([0.3, 0.1], [0.2, 0.1], [0.2, 0.1], 0, 0), z), 'a carried hull in a lagging turn inside the pushed cut: none');
  ok(near2(combineVelocity([0.2, 0.1], [0.2, 0.1], [0.1, 0.05], 0, 0), [0.05, 0.025]), "a wing opening on the flown hull keeps its own motion");
  ok(near2(combineVelocity([0.4, 0.1], [0.2, 0.1], [0.2, 0.1], 0, 0), z), 'a standing creature near a fast camera: none');
  ok(near2(combineVelocity([0.2, 0.1], [0.5, 0.3], [0.2, 0.1], 0, 1), z), 'a wingman flying alongside: none');
  ok(near2(combineVelocity([0.3, 0.2], [0.3, 0.2], [0.1, 0.1], 0, 1), [0.1, 0.05]), 'a creature running past a still camera: its true motion');
}

// --- reconstructionWeight ---
ok(reconstructionWeight(10, 0, 20, 5, 50) === 0, 'a sharp foreground takes nothing from the blurred background behind it');
ok(near(reconstructionWeight(6, 0, 12, 50, 5), 0.5), 'a blurred foreground reaches a still background half way along its radius');
ok(reconstructionWeight(13, 0, 12, 50, 5) === 0, 'and not past its radius');
ok(near(reconstructionWeight(5, 10, 10, 5, 5), 3), 'two blurred pixels at one depth mix where both reach');
ok(reconstructionWeight(11, 10, 10, 5, 5) === 0, 'and not past them');
ok(near(reconstructionWeight(0, 0, 0, 5, 5), 4), 'still pixels weigh a finite 4');
{
  let finite = true;
  for (const d of [0, 0.0005, 1, 40])
    for (const rX of [0, 1e-4, 0.5, 36])
      for (const rY of [0, 1e-4, 0.5, 36])
        for (const zX of [0.05, 5, 9000])
          for (const zY of [0.05, 5, 9000]) if (!Number.isFinite(reconstructionWeight(d, rX, rY, zX, zY))) finite = false;
  ok(finite, 'the gather weight is finite for every radius and depth, zero included');
}

// --- neighbourAccepts ---
ok(neighbourAccepts(1, 0, 0.3, 5) && neighbourAccepts(0, -1, -4, 0) && neighbourAccepts(0, 1, 1, 1), 'orthogonal tiles are always taken');
ok(neighbourAccepts(1, 1, 1, 1) && neighbourAccepts(1, 1, -1, -1), 'a diagonal tile moving along the diagonal is taken, either way');
ok(!neighbourAccepts(1, 1, 1, -1), 'one moving across it is not');
ok(neighbourAccepts(1, 1, 0, 0) && !neighbourAccepts(1, -1, 0, 0), 'a zero velocity answers as the shader does');

// --- stepRelayVelocity ---
{
  const v = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < 20; i++) stepRelayVelocity(v, 10, 0, 0, 0.1);
  ok(Math.abs(v.x - 100) / 100 < 0.01, `twenty messages 10 m and 0.1 s apart settle on 100 m/s (${v.x.toFixed(2)})`);
  stepRelayVelocity(v, 300, 0, 0, 0.1);
  ok(v.x === 0 && v.y === 0 && v.z === 0, 'a 300 m step is a jump and resets the speed');
  stepRelayVelocity(v, 1, 0, 0, 0);
  ok(near(v.x, 20 * RELAY.blend), 'two messages at once are taken as the minimum gap apart');
}

// --- takeByBudget ---
{
  const taken: boolean[] = [];
  const order: number[] = [];
  const totals = { draws: 0, carriedDraws: 0 };
  const claim = (pending: number, priority: number, carried = false): BudgetClaim => ({ pending, priority, carried });
  const run = (claims: BudgetClaim[], max = 64, maxCarried = 16) => {
    takeByBudget(claims, taken, order, max, maxCarried, totals);
    return taken.slice();
  };
  // A large, fast hull that does not fit, then two smaller creatures behind it in priority.
  let t = run([claim(10, 50), claim(70, 900), claim(20, 100)]);
  ok(!t[1] && t[0] && t[2], 'a large mover that does not fit is passed over and the smaller ones still draw');
  ok(totals.draws === 30 && totals.carriedDraws === 0, 'and the draws count only what was taken');
  t = run([claim(30, 10), claim(40, 30)]);
  ok(!t[0] && t[1] && totals.draws === 40, 'larger and faster first: the higher priority takes the draws though listed later');
  {
    let capped = true;
    for (let seed = 1; seed <= 200; seed++) {
      let x = seed;
      const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
      const claims = Array.from({ length: 1 + Math.floor(rnd() * 12) }, () => claim(Math.floor(rnd() * 40), rnd() * 100, rnd() < 0.3));
      const tk = run(claims);
      let d = 0;
      let c = 0;
      claims.forEach((cl, i) => {
        if (tk[i]) cl.carried ? (c += cl.pending) : (d += cl.pending);
      });
      if (d > 64 || c > 16 || d !== totals.draws || c !== totals.carriedDraws) capped = false;
      // Greedy: nothing passed over would still have fitted after everything taken.
      claims.forEach((cl, i) => {
        if (!tk[i] && (cl.carried ? c + cl.pending <= 16 : d + cl.pending <= 64)) capped = false;
      });
    }
    ok(capped, 'over 200 random frames neither cap is passed, the totals are what was taken, and nothing left out would have fitted');
  }
  t = run([claim(30, 5), claim(30, 5), claim(30, 5)]);
  ok(t[0] && t[1] && !t[2], 'equal priorities are taken in list order');
  t = run([claim(10, 0, true), claim(10, 0, true), claim(5, 0, true), claim(64, 1)]);
  ok(t[0] && !t[1] && t[2] && t[3], 'what the camera follows has its own cap, passes over one that does not fit, and leaves the others their whole cap');
  ok(totals.carriedDraws === 15 && totals.draws === 64, 'the two caps are counted apart');
  t = run([claim(0, 1e9), claim(64, 1)]);
  ok(t[0] && t[1], 'a mover whose draws all wait for their program costs nothing');
  run([]);
  ok(taken.length === 0 && totals.draws === 0 && totals.carriedDraws === 0, 'no claims, nothing taken');
}

// --- shownSince / drawableSince ---
{
  let f = -1;
  f = shownSince(f, true, 10);
  ok(f === 10 && !drawableSince(f, 10), 'a mesh first shown this frame is not drawn: three has not projected it yet');
  f = shownSince(f, true, 11);
  ok(f === 10 && drawableSince(f, 11), 'shown on an earlier frame too, it is drawn');
  f = shownSince(f, false, 12);
  ok(f === -1 && !drawableSince(f, 12), 'culled or hidden, the run ends');
  f = shownSince(f, true, 13);
  ok(f === 13 && !drawableSince(f, 13), 'and shown again it waits a frame once more');
}

// --- tuning ---
ok(MOTION_TUNING.nearCut[0] < MOTION_TUNING.nearCut[1], 'the near cut is in order');
ok(MOTION_TUNING.samples >= 4 && MOTION_TUNING.samples <= 32, 'the gather takes between 4 and 32 taps');
ok(MOTION_TUNING.radiusOfHeight * 2880 >= 64, "the radius clamp is reachable, so the tile shader's loop of 64 holds");
ok(MOVER_LIMITS.figureJumpSpeed < MOVER_LIMITS.machineJumpSpeed && MOVER_LIMITS.maxDraws + MOVER_LIMITS.maxCarriedDraws <= 96, 'figures jump sooner than machines, and the draws are capped');

// --- the registry ---
{
  const R = registry as typeof registry & { FX_TYPICAL_CPU_MS?: number };
  type CpuRow = { cpuBudgetMs?: number };
  const product = R.fxProductDef('velocity');
  ok(product.live && product.format === 'RGBA16F' && product.owner === 'motionBlur' && product.typical, 'the velocity product is live, RGBA16F, the motion blur\'s and in the typical frame');
  ok(product.budgetMs === 0.1 && (product as CpuRow).cpuBudgetMs === 0.12, 'it costs 0.10 ms of GPU and 0.12 ms of CPU at most');
  const pass = R.fxPassDef('motionBlur');
  ok(pass.needs.includes('velocity') && pass.budgetMs === 0.25 && (pass as CpuRow).cpuBudgetMs === 0.2, 'the motion blur reads it, 0.25 ms of GPU and 0.20 ms of CPU at most');
  const knob = R.FX_KNOBS.find((k) => k.key === 'motionBlurObjects');
  ok(!!knob && knob.product === 'velocity' && knob.requires.includes('motionBlur'), 'the moving-things knob waits for the product and the blur');
  let typical = 0;
  for (const d of R.FX_PRODUCTS) if (d.typical) typical += d.budgetMs;
  for (const d of R.FX_PASSES) if (d.typical) typical += d.budgetMs;
  ok(Number(typical.toFixed(3)) <= R.FX_TYPICAL_BUDGET_MS + 1e-6, `a typical frame's effects come to ${typical.toFixed(2)} ms of GPU, inside ${R.FX_TYPICAL_BUDGET_MS}`);
  ok(R.FX_TYPICAL_CPU_MS === 0.9, 'the effects may take 0.9 ms of the main thread in a typical frame');
  let cpu = 0;
  for (const d of R.FX_PRODUCTS) cpu += (d as CpuRow).cpuBudgetMs ?? 0;
  for (const d of R.FX_PASSES) cpu += (d as CpuRow).cpuBudgetMs ?? 0;
  ok(cpu <= (R.FX_TYPICAL_CPU_MS ?? 0) + 1e-6, `the declared CPU budgets come to ${cpu.toFixed(2)} ms, inside it`);
}

console.log(`\n${passed} checks passed`);
