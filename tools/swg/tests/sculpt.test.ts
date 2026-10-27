// The sculpt brush's stroke, pure (Map-maker II, DESIGN.md §2.4, `src/editor/sculpt.ts`): its feather is the generator's own
// four functions; a held second of raise gives the same deltas at 10, 30 and 60 stamps a second; a flatten lands on its height
// within one float32 step at a weight of one, and raise-only never lowers (lower-only never raises); the smooth reads the
// heights as they stood before the stamp (Jacobi, so its result is that of the stamp's own snapshot whatever the poles'
// order); the keep-off mask is nought inside a turned box and feathers back out, nought at a trunk; and through the brush's
// glue a row of ours that carry moves is never kept off while a box is.
//
// Run: node tools/swg/tests/sculpt.test.ts
import assert from 'node:assert/strict';
import { FeatherFunction, feather } from '../../../src/swg/terrain/generator.ts';
import { HeightEdits } from '../../../src/swg/terrain/heightEdits.ts';
import { KeepGrid, keepWeight, SCULPT_FALLOFFS, SculptStroke, stampWeight, type KeepFoot, type StampAsk } from '../../../src/editor/sculpt.ts';
import { EditorSculpt, buttonMode, type SculptHost } from '../../../src/editor/editorSculpt.ts';
import { SCULPT_TUNE } from '../../../src/editor/editorTune.ts';
import { toolFrame } from '../../../src/editor/tools.ts';
import { makeHarness } from './editsHarness.ts';
import { deflateRawSync } from 'node:zlib';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// The feather is the generator's own, at every falloff.
{
  let all = true;
  for (const f of SCULPT_FALLOFFS) {
    for (let i = 0; i <= 20; i++) {
      const d = 1 - i / 20;
      // At hard 0 and radius 1, a pole at d has its band's share 1 - d.
      if (!Object.is(stampWeight(d, 1, 0, f), feather(FeatherFunction[f], 1 - d))) all = false;
    }
  }
  ok(all, "each of the four falloffs is the generator's own feather, at every share of the band");
  ok(stampWeight(0.2, 1, 0.25, 'linear') === 1 && stampWeight(1.01, 1, 0.25, 'linear') === 0 && stampWeight(0.5, 1, 1, 'easeIn') === 1, 'full inside the hard core, nought past the radius, a hard brush full to its edge');
}

const ask = (over: Partial<StampAsk>): StampAsk => ({ mode: 'raise', cx: 0, cz: 0, radius: 10, hard: 0.25, falloff: 'easeInOut', strength: 1, speed: 2, tau: 0.3, smoothTau: 0.5, flatMode: 'both', height: 0, dt: 1 / 30, ...over });
const flat = () => 5;
const all1 = () => 1;

// A held second of raise: the same deltas at 10, 30 and 60 stamps a second.
{
  const run = (rate: number) => {
    const s = new SculptStroke(new HeightEdits(), flat);
    for (let i = 0; i < rate; i++) s.stamp(ask({ dt: 1 / rate }), all1);
    return s;
  };
  const a = run(10);
  const b = run(30);
  const c = run(60);
  let worst = 0;
  for (let pz = -6; pz <= 6; pz++)
    for (let px = -6; px <= 6; px++) {
      const x = a.store.poleDelta(px, pz);
      for (const y of [b.store.poleDelta(px, pz), c.store.poleDelta(px, pz)]) worst = Math.max(worst, Math.abs(x - y) / Math.max(1e-30, Math.abs(x) * 2 ** -23));
    }
  ok(worst <= 1 && a.store.poleDelta(0, 0) > 1.9 && a.store.poleDelta(0, 0) < 2.1, `a held second of raise gives the same deltas at 10, 30 and 60 stamps a second, within one float32 step (the middle ${a.store.poleDelta(0, 0).toFixed(4)} m at 2 m/s)`);
}

// Flatten: lands on H within one float32 step at a weight of one; raise-only never lowers, lower-only never raises.
{
  const s = new SculptStroke(new HeightEdits(), (px) => 5 + px * 0.5);
  for (let i = 0; i < 30 * 12; i++) s.stamp(ask({ mode: 'flatten', height: 9, hard: 1, radius: 6 }), all1);
  // Within one float32 step of the delta that lands it exactly: |d - (H - raw)| no more than that delta's own step.
  let worst = 0;
  for (let pz = -2; pz <= 2; pz++)
    for (let px = -2; px <= 2; px++) {
      const want = 9 - s.raw(px, pz);
      const step = Math.max(Math.abs(want), 1e-30) * 2 ** -23;
      worst = Math.max(worst, Math.abs(s.store.poleDelta(px, pz) - want) / step);
    }
  ok(worst <= 1, `a held flatten lands on its height within one float32 step of the delta at a weight of one (${worst.toFixed(2)} steps at worst)`);
  const up = new SculptStroke(new HeightEdits(), (px) => 5 + px);
  for (let i = 0; i < 30; i++) up.stamp(ask({ mode: 'flatten', height: 5, flatMode: 'raise', hard: 1, radius: 8 }), all1);
  let lowered = false;
  let raised = false;
  for (let px = -4; px <= 4; px++) {
    const d = up.store.poleDelta(px, 0);
    if (d < 0) lowered = true;
    if (px < 0 && d > 0) raised = true;
  }
  ok(!lowered && raised, 'raise-only raises the low side toward its height and never lowers the high side');
  const down = new SculptStroke(new HeightEdits(), (px) => 5 + px);
  for (let i = 0; i < 30; i++) down.stamp(ask({ mode: 'flatten', height: 5, flatMode: 'lower', hard: 1, radius: 8 }), all1);
  let up2 = false;
  for (let px = -4; px <= 4; px++) if (down.store.poleDelta(px, 0) > 0) up2 = true;
  ok(!up2 && down.store.poleDelta(3, 0) < 0, 'and lower-only lowers the high side and never raises');
}

// Smooth: Jacobi, from the stamp's own snapshot of the heights.
{
  const raw = (px: number, pz: number) => ((px * 7 + pz * 13) % 5) * 1.3;
  const store = new HeightEdits();
  const s = new SculptStroke(store, raw);
  const a = ask({ mode: 'smooth', radius: 6, hard: 0.5 });
  const before = new Map<string, number>();
  for (let pz = -5; pz <= 5; pz++) for (let px = -5; px <= 5; px++) before.set(`${px},${pz}`, s.heightAt(px, pz));
  s.stamp(a, all1);
  const q = 1 - Math.exp(-a.dt / a.smoothTau);
  let worst = 0;
  for (let pz = -3; pz <= 3; pz++)
    for (let px = -3; px <= 3; px++) {
      const h = (x: number, z: number) => before.get(`${x},${z}`)!;
      const m = (4 * h(px, pz) + 2 * (h(px - 1, pz) + h(px + 1, pz) + h(px, pz - 1) + h(px, pz + 1)) + (h(px - 1, pz - 1) + h(px + 1, pz - 1) + h(px - 1, pz + 1) + h(px + 1, pz + 1))) / 16;
      const w = stampWeight(Math.hypot(px * 2, pz * 2), 6, 0.5, 'easeInOut');
      const want = Math.fround(w * q * (m - h(px, pz)));
      worst = Math.max(worst, Math.abs(store.poleDelta(px, pz) - want));
    }
  ok(worst < 1e-6, `the smooth moves every pole by its 1-2-1 mean of the heights before the stamp (Jacobi, the poles' order nothing to it; worst ${worst.toExponential(1)})`);
}

// The keep-off mask: nought inside a turned box and feathering out; nought at a trunk.
{
  const t = { keepMargin: 2, keepFeather: 4, keepTrunkMargin: 0.5, keepTrunkFeather: 2 };
  const c = Math.cos(0.6);
  const sn = Math.sin(0.6);
  const box: KeepFoot = { kind: 'box', x: 10, z: -4, hx: 3, hz: 1.5, cos: c, sin: sn, r: 0 };
  const at = (u: number, v: number) => ({ x: 10 + u * c - v * sn, z: -4 + u * sn + v * c });
  const inside = at(4.9, 0);
  const edge = at(3 + 2 + 2, 0);
  const out = at(3 + 2 + 4.01, 0);
  ok(keepWeight([box], inside.x, inside.z, t) === 0 && keepWeight([box], at(0, 3.4).x, at(0, 3.4).z, t) === 0, 'nought inside a turned box grown by its margin');
  const mid = keepWeight([box], edge.x, edge.z, t);
  ok(mid > 0 && mid < 1 && keepWeight([box], out.x, out.z, t) === 1, `feathering back to one past the margin (${mid.toFixed(3)} half way, one past it)`);
  const trunk: KeepFoot = { kind: 'trunk', x: 0, z: 0, hx: 0, hz: 0, cos: 1, sin: 0, r: 0.4 };
  ok(keepWeight([trunk], 0.85, 0, t) === 0 && keepWeight([trunk], 0.95, 0, t) > 0 && keepWeight([trunk], 2.95, 0, t) === 1, "nought at a trunk grown by its own margin, back to one over its own feather");
}

// Through the brush's glue: a box the brush keeps off is held at raw; a row of ours that carry moves is never kept off.
{
  const store = new HeightEdits();
  const h = makeHarness();
  const host: SculptHost = {
    edits: h.e,
    worldKind: () => 'ground',
    store: () => store,
    rawAt: () => 10,
    toRaw: (x, z, o) => {
      o.x = -x;
      o.z = z;
    },
    toGame: (x, z, o) => {
      o.x = -x;
      o.z = z;
    },
    changed: () => {},
    feet: (_x0, _z0, _x1, _z1, visit) => {
      visit({ kind: 'box', owner: 'game', template: 'object/building/x', x: 6, z: 0, y: 10, hx: 1, hz: 1, cos: 1, sin: 0, r: 0 });
      visit({ kind: 'carry', owner: 'ours', template: 'place/crate-1', x: -6, z: 0, y: 10, hx: 0, hz: 0, cos: 1, sin: 0, r: 0 });
    },
    standing: () => [],
    lowestOf: () => null,
    fileRow: () => null,
    fileSize: () => ({ tiles: 0, bytes: 0 }),
    deflate: async (b) => deflateRawSync(Buffer.from(b)).toString('base64'),
    beginWork: () => {},
    noteStamp: () => {},
    say: () => {},
  };
  const was = { ...SCULPT_TUNE };
  try {
    SCULPT_TUNE.mode = 'raise';
    SCULPT_TUNE.keepOff = true;
    SCULPT_TUNE.keepMargin = 1;
    SCULPT_TUNE.keepFeather = 1;
    SCULPT_TUNE.radius = 14;
    const s = new EditorSculpt(host);
    await s.arm();
    const f = toolFrame();
    f.apply = true;
    f.valid = true;
    f.dt = 1 / 30;
    f.x = 0;
    f.z = 0;
    for (let i = 0; i < 15; i++) s.frame(f);
    // The box at game (6, 0) is raw (-6, 0); the carried crate at game (-6, 0) is raw (6, 0).
    ok(store.poleDelta(-3, 0) === 0 && store.poleDelta(3, 0) > 0 && store.poleDelta(0, 0) > 0, 'the brush keeps the ground under a box at raw, and moves it under a row of ours that carry moves');
  } finally {
    Object.assign(SCULPT_TUNE, was);
  }
}

ok(buttonMode('raise', true) === 'lower' && buttonMode('lower', true) === 'raise' && buttonMode('flatten', true) === null && buttonMode('smooth', false) === 'smooth', "the right button is raise's and lower's other, and nothing for flatten and smooth");

// The keep-off mask laid once a stamp over its own disc of poles (`KeepGrid`) is `keepWeight` over the same feet at every
// pole, to the bit: many turned boxes and trunks round stamps of every size, in a frame that is a mirror and a shift.
{
  const t = { keepMargin: 2, keepFeather: 4, keepTrunkMargin: 0.5, keepTrunkFeather: 2 };
  const C = 137.5;
  const toGame = (x: number, z: number, o: { x: number; z: number }) => {
    o.x = C - x;
    o.z = z;
  };
  const toRaw = toGame;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  let poles = 0;
  let apart = 0;
  let lowered = 0;
  const grid = new KeepGrid();
  for (const R of [3, 12, 40, 90]) {
    for (let n = 0; n < 6; n++) {
      const cx = (rand() - 0.5) * 200;
      const cz = (rand() - 0.5) * 200;
      const feet: KeepFoot[] = [];
      for (let k = 0; k < 40; k++) {
        const g = { x: 0, z: 0 };
        toGame(cx + (rand() - 0.5) * 3 * R, cz + (rand() - 0.5) * 3 * R, g);
        const a = rand() * Math.PI * 2;
        feet.push(rand() < 0.3 ? { kind: 'trunk', x: g.x, z: g.z, hx: 0, hz: 0, cos: 1, sin: 0, r: rand() * 1.2 } : { kind: 'box', x: g.x, z: g.z, hx: 0.3 + rand() * 12, hz: 0.3 + rand() * 9, cos: Math.cos(a), sin: Math.sin(a), r: 0 });
      }
      grid.reset(cx, cz, R);
      for (const f of feet) grid.lay(f, t, toGame, toRaw);
      const g = { x: 0, z: 0 };
      for (let pz = Math.ceil((cz - R) / 2); pz <= Math.floor((cz + R) / 2); pz++)
        for (let px = Math.ceil((cx - R) / 2); px <= Math.floor((cx + R) / 2); px++) {
          toGame(px * 2, pz * 2, g);
          const want = keepWeight(feet, g.x, g.z, t);
          const got = grid.at(px * 2, pz * 2);
          poles++;
          if (!Object.is(want, got)) apart++;
          if (got < 1) lowered++;
        }
    }
  }
  ok(apart === 0 && lowered > 1000, `the mask laid once a stamp over its disc is keepWeight at every pole, to the bit (${poles} poles, ${lowered} kept off, ${apart} apart)`);
  ok(grid.at(1e6, 0) === 1, 'and one off its window');
}

// A held second through the brush's own clock and glue (`EditorSculpt.frame`, stamps by `stampsDue`), at 30, 60 and 144
// frames a second, for a second and for ten: the same stamps and the same ground to the bit at every rate (it lost a
// stamp at 144 on the clock's float sum before the fix round).
{
  const was2 = { ...SCULPT_TUNE };
  try {
    SCULPT_TUNE.mode = 'raise';
    SCULPT_TUNE.rate = 30;
    SCULPT_TUNE.radius = 10;
    SCULPT_TUNE.keepOff = false;
    SCULPT_TUNE.carry = false;
    const hold = async (fps: number, seconds: number): Promise<{ stamps: number; mid: number }> => {
      const store = new HeightEdits();
      let stamps = 0;
      const h = makeHarness();
      const host: SculptHost = {
        edits: h.e,
        worldKind: () => 'ground',
        store: () => store,
        rawAt: () => 10,
        toRaw: (x, z, o) => {
          o.x = -x;
          o.z = z;
        },
        toGame: (x, z, o) => {
          o.x = -x;
          o.z = z;
        },
        changed: () => {},
        feet: () => {},
        standing: () => [],
        lowestOf: () => null,
        fileRow: () => null,
        fileSize: () => ({ tiles: 0, bytes: 0 }),
        deflate: async (b) => deflateRawSync(Buffer.from(b)).toString('base64'),
        beginWork: () => {},
        noteStamp: () => stamps++,
        say: () => {},
      };
      const s = new EditorSculpt(host);
      await s.arm();
      const f = toolFrame();
      f.valid = true;
      f.x = 0;
      f.z = 0;
      f.dt = 1 / fps;
      f.apply = true;
      const frames = Math.round(fps * seconds);
      for (let i = 0; i < frames; i++) s.frame(f);
      const mid = store.poleDelta(0, 0);
      f.apply = false;
      s.frame(f);
      await h.settle();
      return { stamps, mid };
    };
    for (const seconds of [1, 10]) {
      const at = [];
      for (const fps of [30, 60, 144]) at.push(await hold(fps, seconds));
      const want = 1 + seconds * 30;
      ok(at.every((a) => a.stamps === want) && at.every((a) => Object.is(a.mid, at[0].mid)), `a stroke held ${seconds} s stamps ${at.map((a) => a.stamps).join(', ')} times at 30, 60 and 144 frames a second (${want} by its clock), the middle ${at[0].mid.toFixed(4)} m at each to the bit`);
    }
  } finally {
    Object.assign(SCULPT_TUNE, was2);
  }
}

// What a stroke reached, said whether or not the keep-off is on: the game's objects counted, the players' things by name.
{
  const said: string[] = [];
  // A fresh store and files for each run.
  const hostFor = (): SculptHost => {
    const store = new HeightEdits();
    const h = makeHarness();
    return {
      edits: h.e,
      worldKind: () => 'ground',
      store: () => store,
      rawAt: () => 10,
      toRaw: (x, z, o) => {
        o.x = -x;
        o.z = z;
      },
      toGame: (x, z, o) => {
        o.x = -x;
        o.z = z;
      },
      changed: () => {},
      feet: (_x0, _z0, _x1, _z1, visit) => {
        visit({ kind: 'box', owner: 'game', template: 'object/building/a', x: 4, z: 0, y: 10, hx: 1, hz: 1, cos: 1, sin: 0, r: 0 });
        visit({ kind: 'trunk', owner: 'game', template: 'object/tree', x: -4, z: 3, y: 10, hx: 0, hz: 0, cos: 1, sin: 0, r: 0.5 });
        visit({ kind: 'box', owner: 'game', template: 'object/building/far', x: 300, z: 0, y: 10, hx: 1, hz: 1, cos: 1, sin: 0, r: 0 });
        visit({ kind: 'box', owner: 'player', template: 'home:9', x: 0, z: -6, y: 10, hx: 2, hz: 2, cos: 1, sin: 0, r: 0 });
      },
      standing: () => [],
      lowestOf: () => null,
      fileRow: () => null,
      fileSize: () => ({ tiles: 0, bytes: 0 }),
      deflate: async (b) => deflateRawSync(Buffer.from(b)).toString('base64'),
      beginWork: () => {},
      noteStamp: () => {},
      say: (w) => said.push(w),
    };
  };
  const settle = async () => {
    for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const was3 = { ...SCULPT_TUNE };
  try {
    SCULPT_TUNE.mode = 'raise';
    SCULPT_TUNE.radius = 12;
    for (const keepOff of [false, true]) {
      SCULPT_TUNE.keepOff = keepOff;
      const s = new EditorSculpt(hostFor());
      await s.arm();
      const f = toolFrame();
      f.valid = true;
      f.dt = 1 / 30;
      f.x = 0;
      f.z = 0;
      f.apply = true;
      for (let i = 0; i < 4; i++) s.frame(f);
      const bar = s.barWords();
      f.apply = false;
      s.frame(f);
      await settle();
      const r = s.last.reached;
      ok(r.game === 2 && r.players.length === 1 && r.players[0] === 'home:9', `keep-off ${keepOff ? 'on' : 'off'}: the stroke reached two of the game's objects (never the one 300 m off) and a player's house, by name`);
      ok(keepOff ? /kept off 2 of the game's objects/.test(s.last.said) && /home:9/.test(s.last.said) : /moved the ground under 2 of the game's objects/.test(s.last.said) && /home:9/.test(s.last.said) && /under 2 of the game's objects/.test(bar), `and says so on its line${keepOff ? '' : ' and, while held, on the bar'} ("${s.last.said}")`);
    }
    ok(said.some((w) => /home:9/.test(w)), "and on the message line, where it reached a player's thing");
  } finally {
    Object.assign(SCULPT_TUNE, was3);
  }
}

{
  // The armed brush's hover frame and its two rings make nothing (`editorAllocOwn.ts sculpt`, twelve processes at once, each asserted).
  const { spawn } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const file = fileURLToPath(new URL('./editorAllocOwn.ts', import.meta.url));
  const run = () =>
    new Promise<{ frames: number; made: number; scavenges: number; ringShown: number; ring2Shown: number; armed: boolean; stroke: string | null; tiles: number }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', file, 'sculpt'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (code) => {
        const line = out.trim().split('\n').pop() ?? '';
        if (code !== 0) {
          const lines = err.trim().split('\n');
          reject(new Error(`the allocation child exited ${code}: ${lines.find((l) => /Error/.test(l))?.trim() ?? lines.pop() ?? line}`));
          return;
        }
        try {
          resolve(JSON.parse(line));
        } catch {
          reject(new Error(`the allocation child printed nothing that reads: ${line || '(nothing)'}`));
        }
      });
    });
  const all = await Promise.all(Array.from({ length: 12 }, run));
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    ok(a.armed && a.stroke === null && a.tiles === 0 && a.ringShown > 0 && a.ring2Shown > 0 && a.scavenges === 0 && a.made < 0.05 * a.frames, `process ${i + 1} of 12: the armed sculpt brush's hover frame and its two rings make ${Math.max(0, a.made)} bytes over ${a.frames} frames (${(Math.max(0, a.made) / a.frames).toFixed(3)} a frame, ${a.scavenges} collections)`);
  }
}

console.log(`\nsculpt: ${checks} checks passed`);
