// The grains (the volumetrics' dust, the design's §2.6), driven through the real dust pool (src/vehicles/dust.ts): with
// the volumetrics' dust on, a machine on rock throws no motes and on sand today's count, at the intervals `emitDust`
// really makes at 30 to 240 frames a second and a jittered one (the shed judged on a fixed twentieth of a second, so
// rock's none does not hang on the frame rate); with the kick-up on a grain
// thrown up comes down on the air's own height raster and lies `rest` seconds before it fades, alike at 60, 144 and 240
// frames a second; a spawn asked for grains with no ground to fall on is today's mote to the bit; and the storm sheets'
// factor is 1 with the volume off or refusing and 1 - thin while it draws the storm. (That the pool with the master or
// the dust off is the commit before the pass's own, both trees side by side, is the off-proof's, `airOff.test.ts`.)
//
// The pool's sprite is a canvas: a stand-in `document` is given only while each pool is made, as the grapple harness does.
// Plain type stripping; synthetic numbers.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Dust, type GrainGround } from '../../../src/vehicles/dust.ts';
import { AirRaster, type GroundSample } from '../../../src/world/volumetrics/airRaster.ts';
import { newWindow, placeWindow } from '../../../src/world/volumetrics/fluidWindow.ts';
import { fillResponseTable } from '../../../src/world/volumetrics/groundResponse.ts';
import { sheddingCount, stormSheetFactor } from '../../../src/world/volumetrics/airMath.ts';
import { AIR_TUNE } from '../../../src/world/volumetrics/airTune.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** A pool, made with a stand-in page for its sprite and the page taken away again. */
function makeDust(): Dust {
  const g = globalThis as unknown as { document?: unknown };
  const was = g.document;
  const ctx = { createRadialGradient: () => ({ addColorStop: () => undefined }), fillRect: () => undefined, fillStyle: '' };
  g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
  try {
    return new Dust();
  } finally {
    g.document = was;
  }
}
/** A seeded Math.random, the same sequence each time it is set. */
function seedRandom(seed: number): () => void {
  const real = Math.random;
  let s = seed >>> 0;
  Math.random = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return () => {
    Math.random = real;
  };
}
const alive = (d: Dust): number => {
  const a = d.points.geometry.getAttribute('aAlpha').array as Float32Array;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] > 0) n++;
  return n;
};

// --- the ground: sand on the west half, rock on the east, a lake in the north-east corner ---
const w = newWindow();
placeWindow(w, 0, 0, AIR_TUNE.window.size, 128, AIR_TUNE.window.jump);
const raster = new AirRaster();
raster.resize(128);
const table = new Uint8Array(4 * 4);
fillResponseTable('', [
  { id: 1, name: 'sand_bumpy', surface: '', children: [] },
  { id: 2, name: 'rock_cliff_anza', surface: '', children: [] },
  { id: 3, name: 'CourtTile', surface: '', children: [] },
], table);
raster.familyResponse = table;
raster.fillAll(
  {
    sample(x: number, z: number, out: GroundSample): boolean {
      out.h = 3;
      out.family = x < 0 ? 1 : z < 40 ? 2 : 3;
      out.medium = x > 60 && z > 60 ? 2 : 1;
      return true;
    },
  },
  w.ox,
  w.oz,
  w.cell,
);
const shedAt = (x: number, z: number): number => raster.dustAt(w.ox, w.oz, w.cell, x, z);
ok(shedAt(-20, 0) === 1 && shedAt(20, 0) < 0.15 && shedAt(20, 50) < 0.15 && shedAt(80, 80) === 0, 'the raster: sand sheds whole, rock and paving a tenth or less, water nothing');

// Today's count (world.ts emitDust's own lines), over the speeds and widths a machine has, at the intervals emitDust
// really makes: each frame's dt summed until a twentieth of a second or more has passed, then the whole sum taken
// (0.0556 s at 144 frames a second, 0.0583 at 120, 0.0667 at 30), at five frame rates and a jittered one. Judged on the
// interval itself, a fast wide machine on rock threw a mote every window at 144 and none at 60.
function intervals(fps: number, jitter: number, seconds: number, seed: number): number[] {
  let s = seed >>> 0;
  const rnd = (): number => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296);
  const out: number[] = [];
  let due = 0;
  for (let t = 0; t < seconds; ) {
    const dt = (1 / fps) * (1 + jitter * (rnd() * 2 - 1));
    t += dt;
    due += dt;
    if (due < 0.05) continue;
    out.push(due);
    due = 0;
  }
  return out;
}
const rates: [string, number[]][] = [
  ['30 fps', intervals(30, 0, 10, 1)],
  ['60 fps', intervals(60, 0, 10, 1)],
  ['120 fps', intervals(120, 0, 10, 1)],
  ['144 fps', intervals(144, 0, 10, 1)],
  ['240 fps', intervals(240, 0, 10, 1)],
  ['144 fps jittered by a third', intervals(144, 0.33, 10, 7)],
];
const perSecondOf = (speed: number, width: number): number => (12 + 70 * Math.min(1, speed / 35)) * (0.6 + Math.min(1.4, width * 0.35));
const countOf = (interval: number, speed: number, width: number): number => Math.round(interval * (12 + 70 * Math.min(1, speed / 35)) * (0.6 + Math.min(1.4, width * 0.35)));
const speeds = [2.5, 10, 20, 35, 60];
const widths = [0.8, 1.5, 2.5, 3.6, 4, 6];
for (const [name, list] of rates) {
  let rockNone = true;
  let sandSame = true;
  let worstOff = 0;
  for (const speed of speeds) {
    for (const width of widths) {
      const perSecond = perSecondOf(speed, width);
      let gravel = 0;
      for (const interval of list) {
        const count = countOf(interval, speed, width);
        if (sheddingCount(count, perSecond, interval, shedAt(20, 0)) !== 0 || sheddingCount(count, perSecond, interval, shedAt(20, 50)) !== 0 || sheddingCount(count, perSecond, interval, shedAt(80, 80)) !== 0) rockNone = false;
        if (sheddingCount(count, perSecond, interval, shedAt(-20, 0)) !== count) sandSame = false;
        gravel += sheddingCount(count, perSecond, interval, 0.3);
      }
      // Ground that sheds some: the motes over the run against the fixed twentieth's own rate, off by under half a
      // mote an interval (each interval rounds its share of whole motes), whatever the frame rate.
      const whole = Math.floor(perSecond * 0.05 * 0.3);
      const span = list.reduce((a, b) => a + b, 0);
      const off = Math.abs(gravel - (whole * span) / 0.05) / list.length;
      if (off > worstOff) worstOff = off;
    }
  }
  ok(rockNone, `${name}: a machine on rock, on paving or over water throws no motes, at every speed and width`);
  ok(sandSame, `${name}: and on sand exactly today's count`);
  ok(worstOff <= 0.5, `${name}: and on ground that sheds a share, the motes it throws are the fixed twentieth's rate to within half a mote an interval (worst ${worstOff.toFixed(2)})`);
}

// --- a grain falls onto the raster and lies there, alike at three frame rates ---
const grainGround: GrainGround = { ox: w.ox, oz: w.oz, cell: w.cell, n: raster.n, height: raster.height, known: raster.known, gravity: AIR_TUNE.grains.gravity, rest: AIR_TUNE.grains.rest };
const colour = new THREE.Color(0.8, 0.6, 0.4);
interface Run {
  landedBy: number;
  goneBy: number;
  restAfterLast: number;
  onGround: boolean;
  everFlew: boolean;
}
function fall(fps: number): Run {
  const back = seedRandom(77);
  try {
    const d = makeDust();
    d.ground = grainGround;
    d.spawn(-20, 3, 0, 40, 25, 0, 2, colour, true);
    const dt = 1 / fps;
    let t = 0;
    let landedBy = -1;
    let goneBy = -1;
    let everFlew = false;
    let onGround = true;
    const pos = d.points.geometry.getAttribute('position').array as Float32Array;
    const alpha = d.points.geometry.getAttribute('aAlpha').array as Float32Array;
    for (let i = 0; i < fps * 6; i++) {
      d.update(dt);
      t += dt;
      if (d.grainsFlying > 0) everFlew = true;
      if (landedBy < 0 && everFlew && d.grainsFlying === 0) {
        landedBy = t;
        for (let k = 0; k < alpha.length; k++) if (alpha[k] > 0 && Math.abs(pos[k * 3 + 1] - 3.04) > 1e-4) onGround = false;
      }
      if (landedBy >= 0 && goneBy < 0 && d.grainsLying === 0 && alive(d) === 0) goneBy = t;
    }
    return { landedBy, goneBy, restAfterLast: goneBy - landedBy, onGround, everFlew };
  } finally {
    back();
  }
}
const runs = [60, 144, 240].map((fps) => ({ fps, ...fall(fps) }));
for (const r of runs) {
  ok(r.everFlew && r.landedBy > 0 && r.onGround, `${r.fps} fps: every grain thrown up came down on the raster's own ground (all down by ${r.landedBy.toFixed(2)} s)`);
  ok(Math.abs(r.restAfterLast - AIR_TUNE.grains.rest) <= 1 / r.fps + 1e-9, `${r.fps} fps: the last lies ${r.restAfterLast.toFixed(3)} s, its rest of ${AIR_TUNE.grains.rest} s within a frame, and fades`);
}
ok(Math.abs(runs[0].landedBy - runs[2].landedBy) < 0.08 && Math.abs(runs[1].landedBy - runs[2].landedBy) < 0.08, `alike at every frame rate: down by ${runs.map((r) => r.landedBy.toFixed(2)).join(', ')} s`);

// --- a grain asked for with nothing to fall on is today's mote ---
{
  const same = (a: Dust, b: Dust): boolean => {
    for (const name of ['position', 'aAlpha', 'aSize', 'aColor']) {
      const x = a.points.geometry.getAttribute(name).array as Float32Array;
      const y = b.points.geometry.getAttribute(name).array as Float32Array;
      for (let i = 0; i < x.length; i++) if (!Object.is(x[i], y[i])) return false;
    }
    return true;
  };
  let back = seedRandom(5);
  const today = makeDust();
  today.spawn(1, 2, 3, 30, 12, -4, 1.5, colour);
  for (let i = 0; i < 90; i++) today.update(1 / 60);
  back();
  back = seedRandom(5);
  const asked = makeDust();
  asked.spawn(1, 2, 3, 30, 12, -4, 1.5, colour, true);
  for (let i = 0; i < 90; i++) asked.update(1 / 60);
  back();
  ok(same(today, asked) && asked.grainsFlying === 0 && asked.grainsLying === 0, "with no ground handed over (the dust or the kick-up off), a spawn asked for grains is today's mote to the bit");
  const blast = makeDust();
  blast.throwGrains(0, 3, 0, 300, 20, colour);
  ok(alive(blast) === 0 && blast.grainsFlying === 0, 'and a blast throws no grains at all with nothing to fall on');
  blast.ground = grainGround;
  const s = seedRandom(9);
  blast.throwGrains(-20, 3, 0, 300, 20, colour);
  blast.update(1 / 60);
  s();
  ok(blast.grainsFlying > 250, `with the ground, a thermal detonator's shower is in the air (${blast.grainsFlying})`);
}

// --- the storm sheets ---
ok(stormSheetFactor(false, 0.8, 0.5) === 1, 'the volume off or refusing: the storm sheets are today\'s, factor 1');
ok(stormSheetFactor(true, 0.8, 0.5) === 0.5 && stormSheetFactor(true, 0.8, 0.3) === 0.7 && stormSheetFactor(true, 0.8, 1) === 0, 'while it draws the storm: 1 - volStormThin');
ok(stormSheetFactor(true, 0, 0.5) === 1, 'and with no storm, 1');

console.log(`\n${checks} checks passed`);
