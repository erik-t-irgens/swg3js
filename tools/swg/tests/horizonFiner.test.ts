// Wave h6a of the horizon pass (the owner's "finer shape far out"): two options, a bake of 4 m (`horizon --step=4`) whose
// own samples carry the rings' 4 m level past the shape window, and a shape window of 2,048 samples a side (the Graphics
// page's Terrain shape window). Held here: with the default bake (8 m) and the window of 1,024 the ranges, the most the
// window holds and the bake's plan are b6aec84's to the bit (its modules out of git, else a recorded hash); a 4 m plan
// stands on the 8 m plan's lattice over its very extent (every other sample the 8 m one's, the families, colours and
// coarse lattice the 8 m plan's), and a world too wide for 8 m keeps its 16 m; with a 4 m bake each level hands over at
// twice the finer one's range (2 m, 4 m, 8 m), every coarser morph its gap past the finer range; the window of 2,048 holds
// every finer range it keeps whole (the game's own window read by its own `ringHeight`); the Graphics page and the dial
// stop where the window in force holds. The vertex stage over these ranges (crack-free, the 4 m bake's own samples) is
// `horizonShaders.test.ts`'s; the field made again at another side is `horizonLive.test.ts`'s.
//
// Run: node tools/swg/tests/horizonFiner.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { HORIZON_TUNE, HoleGrid, RingSelector, cameraFrustum, newReachRules, reachRules, shapeRanges, shapeReachMost, type HorizonTune, type ReachRules } from '../../../src/world/horizon/horizonMath.ts';
import { newAsk, rolling, testAsk, testCamera, testHole, testPyramid } from './horizonFixtures.ts';
import { BAKE_DEFAULTS, HORIZON_FORMAT, planBake, readHorizonHeader } from '../../../src/world/horizon/horizonFile.ts';
import { SHAPE_CHOICE, SHAPE_SIDES, ShapeWindow, heldShapeDetailKm, shapeDetailTopKm, shapeReachMostOf, shapeSideOf, shapeWindowReach } from '../../../src/world/horizon/shapeWindow.ts';
import { SHAPE_REACH_MOST, SHAPE_REACH_MOST_WIDE, shapeReachTop, tuneHorizon } from '../../../src/world/horizon/horizonDials.ts';
import { loadOldMany } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);

const BASE = 'b6aec84';
const saved = { ...HORIZON_TUNE };

// ---- day one: the 8 m bake and the window of 1,024 are b6aec84's to the bit
type OldMath = { shapeRanges: (t: unknown, lodT: number, ok: boolean, out: unknown) => void; reachRules: (t: unknown, vr: number, rev: boolean, out: unknown, ok?: boolean) => unknown; shapeReachMost: (t: unknown) => number; newReachRules: () => Record<string, number> };
type OldFile = { planBake: (w: number, c: { x: number; z: number }, o?: unknown) => unknown };
const old = await loadOldMany(['src/world/horizon/horizonMath.ts', 'src/world/horizon/shapeWindow.ts', 'src/world/horizon/horizonFile.ts'], ['src/world/horizon/horizonMath.ts', 'src/world/horizon/horizonFile.ts'], BASE);
const KEYS = ['finest', 'r1', 'r2', 'lod0', 'mf', 'levels', 'inForce', 'far', 'skyRadius'] as const;
/** Every range the rules answer over a sweep of tunes, as one text (its numbers by `Object.is`'s standard: -0 and NaN kept). */
function sweep(run: (t: HorizonTune, lodT: number, okShape: boolean) => Record<string, number>): string {
  const out: string[] = [];
  for (const S of [0, 1, 50, 200, 350, 500, 700, 703, 704, 900, 1500, 3000]) {
    for (const finest of [2, 4]) {
      for (const fade of [1, 16, 64]) {
        for (const morph of [0.01, 0.15, 0.6]) {
          for (const lodT of [1034, 1400, 1800]) {
            for (const okShape of [true, false]) {
              const t = { ...saved, shapeReach: S, shapeFinest: finest, shapeFade: fade, shapeMorph: morph };
              const r = run(t, lodT, okShape);
              out.push(KEYS.map((k) => (Object.is(r[k], -0) ? '-0' : String(r[k]))).join(','));
            }
          }
        }
      }
    }
  }
  return out.join(';');
}
const now = (fit: { side?: number; bakeStep?: number; bake?: boolean }) =>
  sweep((t, lodT, okShape) => {
    const r = newReachRules();
    r.side = fit.side ?? 1024;
    r.bakeStep = fit.bakeStep ?? 8;
    const tt = { ...t, shapeBake: fit.bake ?? true };
    shapeRanges(tt, lodT, okShape, r);
    return r as unknown as Record<string, number>;
  });
const todayText = now({});
const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);
// Recorded from b6aec84's own `shapeRanges` over this very sweep (`SWG3JS_NO_OLD=1` runs this path on purpose).
const B6_RANGES = 'b932a0ab44391aa9';
if (old) {
  const [m] = old as [OldMath, OldFile];
  const oldText = sweep((t, lodT, okShape) => {
    const r = m.newReachRules();
    m.shapeRanges(t, lodT, okShape, r);
    return r;
  });
  ok(oldText === todayText, `with an 8 m bake and the window of 1,024 the finer ranges are b6aec84's to the bit (${todayText.split(';').length} tunes)`);
  ok(hash(oldText) === B6_RANGES, `and b6aec84's sweep hashes as recorded (${hash(oldText)})`);
  let mostSame = true;
  for (const fade of [1, 16, 64]) for (const morph of [0.01, 0.15, 0.6]) for (const gap of [0, 2.5, 6]) if (!Object.is(m.shapeReachMost({ ...saved, shapeFade: fade, shapeMorph: morph, shapeGap: gap }), shapeReachMost({ ...saved, shapeFade: fade, shapeMorph: morph, shapeGap: gap }))) mostSame = false;
  ok(mostSame, "the most the window of 1,024 holds is b6aec84's at every fade, morph and gap");
  // reachRules whole (its levels, fog and far plane with the ranges), at today's numbers.
  let whole = true;
  for (const vr of [3, 6, 9]) {
    for (const eyeOver of [0, 40, 2000]) {
      const a = m.newReachRules();
      a.eyeOver = eyeOver;
      a.fogDensity = 0.0002;
      a.bakeMost = 20000;
      m.reachRules({ ...saved }, vr, true, a);
      const b = newReachRules();
      b.eyeOver = eyeOver;
      b.fogDensity = 0.0002;
      b.bakeMost = 20000;
      reachRules({ ...saved }, vr, true, b);
      for (const k of Object.keys(a)) if (!Object.is(a[k], (b as unknown as Record<string, number>)[k])) whole = false;
    }
  }
  ok(whole, "and the reach rules whole, every field b6aec84's record holds");
  const [, f] = old as [OldMath, OldFile];
  let plans = 0;
  let same = 0;
  for (const w of [2048, 4096, 8192, 16384, 32768]) {
    for (const c of [{ x: 0, z: 0 }, { x: 1269, z: -3601 }, { x: -7, z: 1024.5 }, { x: 33, z: 2 }]) {
      plans++;
      if (JSON.stringify(f.planBake(w, c)) === JSON.stringify(planBake(w, c)) && JSON.stringify(f.planBake(w, c)) === JSON.stringify(planBake(w, c, { step: 8 }))) same++;
    }
  }
  ok(same === plans, `the bake's plan is b6aec84's at the default step and at --step=8 (${same} of ${plans} worlds and centres)`);
} else {
  note(`git cannot hand ${BASE} over: the ranges held to its recorded hash alone`);
  ok(hash(todayText) === B6_RANGES, `with an 8 m bake and the window of 1,024 the finer ranges hash as b6aec84's did (${hash(todayText)})`);
}
ok(now({ bakeStep: 4, bake: false }) === todayText, 'with shapeBake off a 4 m bake ranges as an 8 m one');
ok(now({ bakeStep: 16 }) === todayText, 'and a 16 m bake (a wide world) as an 8 m one');

// ---- the 4 m plan
{
  let bad = 0;
  let wideKept = 0;
  let tried = 0;
  for (const w of [2048, 4096, 8192, 16384, 32768]) {
    for (const c of [{ x: 0, z: 0 }, { x: 1269, z: -3601 }, { x: -7, z: 1024.5 }]) {
      tried++;
      const p8 = planBake(w, c);
      const p4 = planBake(w, c, { step: 4 });
      if (p8.wide) {
        if (JSON.stringify(p4) === JSON.stringify(p8)) wideKept++;
        else bad++;
        continue;
      }
      const sameEnd = p4.fine.x0 + (p4.fine.nx - 1) * 4 === p8.fine.x0 + (p8.fine.nx - 1) * 8 && p4.fine.z0 + (p4.fine.nz - 1) * 4 === p8.fine.z0 + (p8.fine.nz - 1) * 8;
      if (p4.fine.step !== 4 || p4.fine.x0 !== p8.fine.x0 || p4.fine.z0 !== p8.fine.z0 || !sameEnd || p4.fine.nx > 2 * (BAKE_DEFAULTS.fineMost - 1) + 1) bad++;
      if (JSON.stringify([p4.ground, p4.colour, p4.coarse]) !== JSON.stringify([p8.ground, p8.colour, p8.coarse])) bad++;
    }
  }
  ok(bad === 0 && wideKept === 3, `a 4 m plan stands on the 8 m plan's first sample to its very last over its extent, its families, colours and coarse lattice the 8 m plan's; a world too wide for 8 m keeps its 16 m (${tried} worlds and centres, ${wideKept} wide)`);
  const p = planBake(16384, { x: 0, z: 0 }, { step: 4 });
  ok(p.fine.nx === 4609 && p.colour.step === 8, `a 16 km world at 4 m: ${p.fine.nx} samples a side, the colour still every 8 m`);
}

// ---- the ranges with a 4 m bake: each level hands over at twice the finer one's range, every morph its gap past
{
  let worst = Infinity;
  let doubling = 0;
  let tried = 0;
  for (const side of SHAPE_SIDES) {
    for (const S of [100, 200, 350, 500, 700, 900, 1200, 1550, 3000]) {
      for (const lodT of [1034, 1400, 1800]) {
        for (const finest of [2, 4]) {
          const r = newReachRules();
          r.side = side;
          r.bakeStep = 4;
          shapeRanges({ ...saved, shapeReach: S, shapeFinest: finest }, lodT, true, r);
          tried++;
          const mf = r.mf;
          const gap = saved.shapeGap;
          if (r.finest === -2) {
            worst = Math.min(worst, r.r1 * (1 - mf) - r.r2 - gap * 32);
            if (r.r1 >= 2 * r.r2 - 1e-9) doubling++;
          } else if (r.finest === -1) doubling++;
          worst = Math.min(worst, r.lod0 * (1 - saved.morph) - r.r1 - gap * 64, r.lod0 - lodT, r.lod0 - 2 * r.r1);
        }
      }
    }
  }
  ok(worst >= -1e-9 && doubling === tried, `with a 4 m bake the 4 m range is at least twice the 2 m one and level 0's at least twice that, every coarser morph its gap past the finer range (${tried} tunes; the least room ${worst.toFixed(1)} m)`);
  const r = newReachRules();
  r.bakeStep = 4;
  shapeRanges({ ...saved, shapeFinest: 4, shapeReach: 3000 }, 1400, true, r);
  ok(r.finest === -1 && r.r1 === 3000, "a 4 m finest from a 4 m bake holds to the reach asked, the window not reached");
}

// ---- the window of 2,048: every finer range it keeps stands where it holds its heights whole
{
  const win = new ShapeWindow(2048, 2);
  win.source = { cached: (bx, bz, out) => (out.fill(100 + bx + bz * 0.5), true), make: () => null };
  const fillAt = (rx: number, rz: number) => {
    for (let k = 0; k < 120 && win.made < win.blocks * win.blocks; k++) win.stepTo(rx, rz);
  };
  let short = 0;
  let tried = 0;
  let least = Infinity;
  for (const fade of [16, 1, 64]) {
    for (const finest of [2, 4]) {
      for (const S of [700, 1200, 1550, 2500]) {
        const r = newReachRules();
        r.side = 2048;
        shapeRanges({ ...saved, shapeFade: fade, shapeFinest: finest, shapeReach: S }, 1400, true, r);
        const reach = r.r1 + 4;
        for (const [ex, ez] of [[64 * 7 + 0.01, -64 * 3 + 0.01], [64 * 8 - 0.01, -64 * 2 - 0.01]]) {
          fillAt(ex, ez);
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            tried++;
            if (win.ringHeight(ex + dx * reach, ez + dz * reach, 0, fade) !== win.ringHeight(ex + dx * reach, ez + dz * reach, 1, fade)) short++;
          }
        }
        least = Math.min(least, shapeWindowReach(fade, 2048) - reach);
      }
    }
  }
  ok(short === 0 && least >= 0, `the window of 2,048 holds every finer range it keeps whole, a morph step and all, from an eye anywhere in its block (${tried} places; the least room ${least.toFixed(1)} m)`);
  ok(shapeWindowReach(16, 2048) === 1950 && Math.abs(shapeReachMostOf(2048, 16, 0.15, 2.5) - 1574.1) < 0.01, `its whole share reaches ${shapeWindowReach(16, 2048)} m along an axis, the 2 m shape to ${shapeReachMostOf(2048, 16, 0.15, 2.5).toFixed(1)} m`);
  win.dispose();
}

// ---- the widest selection the options make (the window of 2,048 at its top, a 4 m bake) fits the instance arrays
{
  const shift = { x: 1, z: 0 };
  const pyr = testPyramid(24000, shift);
  const hole = new HoleGrid();
  const sel = new RingSelector();
  const cam = testCamera();
  const fr = new THREE.Frustum();
  const mm = new THREE.Matrix4();
  const ask = newAsk();
  HORIZON_TUNE.shapeReach = 1550;
  HORIZON_TUNE.reach = 8000;
  let most = 0;
  let overflow = 0;
  for (let k = 0; k < 8; k++) {
    const yaw = (k / 8) * Math.PI * 2;
    cam.position.set(0, rolling(0, 0) + 2, 0);
    cam.rotation.set(-0.05, yaw, 0, 'YXZ');
    cam.updateMatrixWorld();
    testHole(hole, 0, 0, 6);
    testAsk(ask, cam.position, 0, 6, shift, { side: 2048, bakeStep: 4 });
    cameraFrustum(cam, mm, fr);
    sel.select(fr, ask, pyr, hole);
    most = Math.max(most, sel.patchCount);
    overflow += sel.overflow;
  }
  Object.assign(HORIZON_TUNE, saved);
  ok(overflow === 0 && most > 16384 && most < sel.patchCap, `the widest selection from the ground (the window of 2,048 at 1,550 m, a 4 m bake) fits the instance arrays (${most} patches at the most, past b6aec84's 16,384, under ${sel.patchCap})`);
}

// ---- the page, the dial and the console stop where the window in force holds
{
  ok(SHAPE_REACH_MOST === 700 && SHAPE_REACH_MOST_WIDE === 1550 && shapeDetailTopKm(1024) === 0.7 && shapeDetailTopKm(2048) === 1.55 && shapeDetailTopKm(4096) === 0.7, 'the Terrain shape detail stops at 0.7 km with the window of 1,024 and 1.55 km with 2,048 (anything else read as 1,024)');
  ok(shapeSideOf(2048) === 2048 && shapeSideOf(1024) === 1024 && shapeSideOf('2048') === 1024 && shapeSideOf(undefined) === 1024, "a setting's side is 2,048 only where it says so");
  const menu = readFileSync(new URL('../../../src/ui/menu.ts', import.meta.url), 'utf8');
  ok(/key: 'terrainShapeWindow'[^\n]*options: \[\{ value: 1024[^\n]*\{ value: 2048[^\n]*redraws: true/.test(menu), "the Graphics page offers the window of 1,024 or 2,048 and draws itself again when it moves");
  ok(/key: 'terrainShapeDetail'[^\n]*maxOf: \(s\) => shapeDetailTopKm\(s\.terrainShapeWindow\)/.test(menu), "and the Terrain shape detail's top follows it");
  const was = SHAPE_CHOICE.side;
  SHAPE_CHOICE.side = 2048;
  let said = tuneHorizon({ shapeReach: 9000 });
  ok(HORIZON_TUNE.shapeReach === 1550 && shapeReachTop() === 1550 && said.some((s) => s.includes('2048 samples')), `the console holds the reach where the window of 2,048 holds (${said.join('; ')})`);
  SHAPE_CHOICE.side = 1024;
  said = tuneHorizon({ shapeReach: 9000 });
  ok(HORIZON_TUNE.shapeReach === 700 && shapeReachTop() === 700, 'and where the window of 1,024 does');
  SHAPE_CHOICE.side = was;
  // The game's hand-overs node cannot run, pinned as text.
  // (Line endings folded: this checkout's working copies of main.ts and world.ts are CRLF.)
  const text = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const main = text('../../../src/main.ts');
  const world = text('../../../src/world/world.ts');
  const field = text('../../../src/world/horizon/horizonField.ts');
  ok(main.includes('SHAPE_CHOICE.side = shapeSideOf(S.terrainShapeWindow);\n    // How far the rings draw the near ground'), 'main.ts: the window side read from the settings before any world');
  ok(/case 'terrainShapeWindow':[\s\S]{0,400}this\.setShapeWindow\(shapeSideOf\(S\.terrainShapeWindow\)\)/.test(main), 'main.ts: the Graphics page moved in play goes to setShapeWindow');
  ok(/await this\.groundCurtain\('the shape window', \(\) => \{\s*said = this\.world\.reshapeHorizon\(\);/.test(main), "main.ts: the window made again behind the far ground's short curtain");
  ok(/if \(!f\.resizeShape\(SHAPE_CHOICE\.side\)\) return '';\s*f\.useShape\(shapeSourceOf\(swg\)\);/.test(world), "world.ts: the field's window made again at the side chosen, its source the near ground's");
  ok(/this\.rules\.side = this\.shapeSide \|\| SHAPE_SIDE;\s*this\.rules\.bakeStep = h\.fine\.step;/.test(field), "horizonField.ts: the rules told the window's side and the bake's own step at the load");
  // h6a's review: the Terrain shape detail held where the window in force holds it, at the load and when the window moves,
  // so the page, the console and the rings say one number (a detail saved under 2,048 read, or left standing, under 1,024).
  ok(heldShapeDetailKm(1.55, 1024) === 0.7 && heldShapeDetailKm(1.55, 2048) === 1.55 && heldShapeDetailKm(0.3, 1024) === 0.3 && heldShapeDetailKm(1.2, 2048) === 1.2 && heldShapeDetailKm(-1, 2048) === 0 && heldShapeDetailKm(NaN, 1024) === 0, 'the Terrain shape detail held to the top of the window in force, never under nought');
  ok(main.includes('S.terrainShapeDetail = heldShapeDetailKm(S.terrainShapeDetail, SHAPE_CHOICE.side);\n    HORIZON_TUNE.shapeReach = S.terrainShapeDetail * 1000;'), 'main.ts: the detail read from the settings held to the window read before it');
  ok(main.includes("case 'terrainShapeDetail':\n        // A range the selection and the ring's morph read a frame (wave 3b): nothing is built, the shape window is the world's.\n        HORIZON_TUNE.shapeReach = heldShapeDetailKm(S.terrainShapeDetail, SHAPE_CHOICE.side) * 1000;"), 'main.ts: the page moved held to the window in force');
  ok(/SHAPE_CHOICE\.side = side;\n(?:\s*\/\/[^\n]*\n)*\s*this\.settings\.terrainShapeDetail = heldShapeDetailKm\(this\.settings\.terrainShapeDetail, side\);\n\s*HORIZON_TUNE\.shapeReach = Math\.min\(HORIZON_TUNE\.shapeReach, shapeReachTop\(\)\);\n\s*const words = /.test(main), 'main.ts: a window moved holds the setting and the reach in force before anything is awaited (the page draws itself again at once)');
  // h6a's review: a 4 m bake refused in the browser names the command that makes it again at 4 m, as `status` does.
  const refused = (h: unknown) => {
    const r = readHorizonHeader(h, { generator: 0, centre: { x: 0, z: 0 } }, 'w');
    return 'refused' in r ? r.refused : '';
  };
  const stale = (step: number) => ({ format: HORIZON_FORMAT, source: { generator: 1, centre: { x: 0, z: 0 } }, fine: { step } });
  ok(/--only=w --step=4\)/.test(refused(stale(4))) && /--only=w\)/.test(refused(stale(8))) && !/--step/.test(refused(stale(8))) && /--only=w\)/.test(refused(null)) && /--only=w\)/.test(refused({ format: HORIZON_FORMAT, fine: null })), "a stale 4 m bake's refusal names `--step=4`, an 8 m or unreadable one's none");
}

// A band of the bake past the end of a 4 m lattice (the owner's whole-install `--step=4` stopped on Corellia): every band of
// rows a worker can be handed, over every residue of the world's centre, lands inside the array.
{
  const { rowsIn } = await import('../horizonWorker.mjs');
  const span = 256;
  let bands = 0;
  let bad = 0;
  let past = 0;
  for (let cz = 0; cz < 16; cz++) {
    for (const step of [4, 8] as const) {
      const { fine } = planBake(16384, { x: 0, z: cz }, { step });
      const out = new Float32Array(fine.nz);
      const last = fine.z0 + (fine.nz - 1) * fine.step;
      for (let sz = fine.z0 - 2 * span; sz < last + 2 * span; sz += 8) {
        const [j0, j1] = rowsIn(fine, sz, sz + span);
        bands++;
        if (Math.ceil((sz - fine.z0) / fine.step) > fine.nz) past++;
        try {
          out.set(new Float32Array(Math.max(0, j1 - j0)), j0);
        } catch {
          bad++;
        }
      }
    }
  }
  ok(past > 0 && bad === 0, `every band of a bake's rows lands inside the lattice, ${past} of ${bands} beginning past its end`);
}

Object.assign(HORIZON_TUNE, saved);
void (null as unknown as ReachRules);
console.log(`\nhorizonFiner: ${checks} checks passed`);
