// The ripples carried by the liquid's current (the volumetrics' fifth wave, the design's §2.9; `airLiquid.ts`'s carry, the
// hook in `waterSim.ts`), held through the carry pass's own GLSL run as script (`glslRun.ts`) and the real pass:
//
//   - Catmull-Rom's weights (`ripWeights`) and the carry's own sampling (`ripCarry`, its 4 by 4 taps) are the mirror's
//     (`carryField`) over a field at whole and fractional places, so a tap moved or a row's weight swapped fails here;
//   - a carry at a whole-texel place is an exact copy (a still current copies the field bit for bit);
//   - a 3 m ripple carried by 1 m/s for 10 s, with the very carries the hook owes at 60 and at 144 frames a second, loses
//     under a tenth of what a bilinear carry loses (the design's bound), and how much each frame rate loses is said and
//     held (a carry damps by its fraction of a texel, and a higher rate carries smaller fractions);
//   - where a texel is in the world (`ripWorldX`, `ripWorldZ`) and where it reads from (`ripSourceX`, `ripSourceY`) are
//     waterSim's own poke convention at every ripple detail (its v against world Z), and the air window's uv of that
//     place is `fluidWindow.ts`'s `rippleUvToAir`, the one place the two conventions meet;
//   - the hook, through a recording renderer and the real `RippleCarryPass`: the carry runs on a frame's first step only,
//     owed every second and every move since it last ran (stepless frames included, a hitch held to a quarter second),
//     hands the pass's own `uCarry` the owed whole texels, the seconds and the texels across; a poke reaches the first
//     carried step after it and no other; where the carry draws nothing the step takes the owed move as today's.
//
// Plain type stripping (three and the modules here import `.ts`-suffixed modules only).
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CARRY_FRAGMENT, carryField, carryFieldBilinear, catmullRomWeights, makeLiquidUniforms, RippleCarryPass } from '../../../src/world/volumetrics/airLiquid.ts';
import { configureWaterSim, disposeWaterSim, pokeWaterSim, rippleCarrySet, setRippleCarry, stepWaterSim, WATER_SIM_DETAIL, WATER_SIM_WINDOW, type RippleCarry } from '../../../src/world/waterSim.ts';
import { fluidUv, newWindow, placeWindow, rippleUvToAir } from '../../../src/world/volumetrics/fluidWindow.ts';
import { RING_VERTEX } from '../../../src/world/volumetrics/airParticleShaders.ts';
import { glslFunctionText, glslFunctions } from './glslRun.ts';
import { redeclared, reservedWords, unbalanced, undefinedCalls } from './glslScan.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** A GLSL vec4 in a scalar run: a splat is the scalar itself, four components a tuple readable by index and by name. */
const vec4 = (...a: number[]): unknown => (a.length === 1 ? a[0] : Object.assign([a[0], a[1], a[2], a[3]], { x: a[0], y: a[1], z: a[2], w: a[3] }));

// --- the weights ---
{
  const w = new Float64Array(4);
  let sums = true;
  for (let i = 0; i <= 100; i++) {
    catmullRomWeights(i / 100, w);
    if (Math.abs(w[0] + w[1] + w[2] + w[3] - 1) > 1e-12) sums = false;
  }
  ok(sums, "Catmull-Rom's four weights sum to one at every fraction of a texel");
  catmullRomWeights(0, w);
  ok(Object.is(w[0], -0) || w[0] === 0, 'and at nought they are the texel itself: (0, 1, 0, 0)');
  ok(w[1] === 1 && w[2] === 0 && w[3] === 0, 'exactly');
  // The carry pass's own weights, run as script, are the mirror's.
  const fns = glslFunctions(glslFunctionText(CARRY_FRAGMENT, 'ripWeights'), ['ripWeights'], { vec4 });
  let same = true;
  for (let i = 0; i <= 64; i++) {
    const f = i / 64;
    const g = fns.ripWeights(f) as unknown as { x: number; y: number; z: number; w: number };
    catmullRomWeights(f, w);
    if (Math.abs(g.x - w[0]) > 1e-12 || Math.abs(g.y - w[1]) > 1e-12 || Math.abs(g.z - w[2]) > 1e-12 || Math.abs(g.w - w[3]) > 1e-12) same = false;
  }
  ok(same, "the carry pass's ripWeights, run, is the mirror's Catmull-Rom over 65 fractions");
}

// --- the carry's own sampling, run, against the mirror ---
const n = 48;
const field = new Float64Array(n * n);
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) field[j * n + i] = Math.sin(i * 0.37) * Math.cos(j * 0.21) + 0.13 * Math.sin(i * j * 0.01) + (i === 20 && j === 17 ? 0.9 : 0);
{
  const at = (x: number, y: number, size: number): number => (x < 0 || y < 0 || x >= size || y >= size ? 0 : field[y * n + x]);
  const run = glslFunctions(`${glslFunctionText(CARRY_FRAGMENT, 'ripWeights')}\n${glslFunctionText(CARRY_FRAGMENT, 'ripCarry')}`, ['ripCarry'], { vec4, ripState: at });
  const out = new Float64Array(n * n);
  let same = true;
  let exactWhole = true;
  const lines: string[] = [];
  for (const [sx, sy, dx, dy] of [[0, 0, 0, 0], [3, -2, 0, 0], [0, 0, 1 / 3, 0], [0, 0, 0, 0.7], [1, 0, 0.25, -0.6], [0, 0, -1.4, 2.3], [-2, 1, 3, 0]] as const) {
    carryField(field, n, sx, sy, dx, dy, out);
    let worst = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const g = run.ripCarry(i + sx - dx, j + sy - dy, n) as number;
        const d = Math.abs(g - out[j * n + i]);
        if (d > worst) worst = d;
        if (Number.isInteger(dx) && Number.isInteger(dy) && !Object.is(g, out[j * n + i])) exactWhole = false;
      }
    }
    if (worst > 1e-12) same = false;
    lines.push(`(${sx}, ${sy}) less (${dx.toFixed(2)}, ${dy.toFixed(2)}): ${worst.toExponential(1)}`);
  }
  ok(same, `the carry pass's own ripCarry (its 4 by 4 taps and its rows' weights), run as script, is the mirror's carryField at whole and fractional places: ${lines.join('; ')}`);
  ok(exactWhole, 'and at every whole-texel place it is the texel itself, bit for bit');
  carryField(field, n, 0, 0, 0, 0, out);
  ok(out.every((v, k) => Object.is(v, field[k])), 'a still current (no travel, no move) copies the field bit for bit');
}

// --- a 3 m ripple carried by 1 m/s for 10 s, with the carries the hook really owes ---
/** A renderer that draws nothing and records the steps, the carries and the splats in order. */
function recorder(): { renderer: THREE.WebGLRenderer; calls: string[]; pokes: number[][][]; carries: number[][] } {
  const calls: string[] = [];
  const pokes: number[][][] = [];
  const carries: number[][] = [];
  let target: unknown = null;
  const targets: unknown[] = [];
  const id = (t: unknown): number => {
    if (t === null) return -1;
    let i = targets.indexOf(t);
    if (i < 0) i = targets.push(t) - 1;
    return i;
  };
  const renderer = {
    getContext: () => ({ getExtension: (name: string) => (name === 'EXT_color_buffer_float' || name === 'OES_texture_float_linear' ? {} : null) }),
    getRenderTarget: () => target,
    setRenderTarget: (t: unknown) => {
      target = t;
    },
    clear: () => undefined,
    render: (scene: { children: { material?: { uniforms?: Record<string, { value: unknown }> } }[] }) => {
      const u = scene.children[0]?.material?.uniforms;
      if (u?.uScroll) {
        const s = u.uScroll.value as THREE.Vector2;
        calls.push(`step ${id(target)} scroll ${s.x.toFixed(6)},${s.y.toFixed(6)}`);
        pokes.push((u.uPokes.value as THREE.Vector4[]).map((p) => [p.x, p.y, p.z, p.w]));
      } else if (u?.uCarry) {
        const c = u.uCarry.value as THREE.Vector4;
        carries.push([c.x, c.y, c.z, c.w]);
        calls.push(`carry -> ${id(target)}`);
      } else calls.push('splat');
    },
    autoClear: true,
    getClearAlpha: () => 1,
    getClearColor: (c: THREE.Color) => c,
    setClearColor: () => undefined,
  } as unknown as THREE.WebGLRenderer;
  return { renderer, calls, pokes, carries };
}
{
  // The seconds the hook owes each carry over ten seconds at a frame rate (the real `stepWaterSim`, a carry that draws).
  const owed = (fps: number): number[] => {
    const { renderer } = recorder();
    configureWaterSim({ waterRipples: true, waterRippleDetail: 512, waterRippleHeight: 1, waterRipplePersistence: 0.85 });
    const seen: number[] = [];
    const c: RippleCarry = {
      ask: { scrollU: 0.5, scrollV: 0.5, seconds: 0.5 },
      run() {
        seen.push(c.ask.seconds);
        return true;
      },
    };
    stepWaterSim(renderer, 0, 0, 0, 1 / fps, 3);
    setRippleCarry(c);
    for (let i = 0; i < fps * 10; i++) stepWaterSim(renderer, 0, 0, 0, 1 / fps, 3);
    setRippleCarry(null);
    disposeWaterSim();
    return seen;
  };
  const texel = WATER_SIM_DETAIL[512].window / WATER_SIM_DETAIL[512].grid;
  const k = (2 * Math.PI) / (3 / texel);
  // One carry of a sinusoid by d texels: the filter's response at the wave's wavenumber, against the exact move.
  const respond = (d: number, filter: 'cr' | 'bl'): number => {
    const f = ((-d % 1) + 1) % 1;
    let re = 0;
    let im = 0;
    if (filter === 'cr') {
      const w = catmullRomWeights(f, new Float64Array(4));
      for (let a = 0; a < 4; a++) {
        re += w[a] * Math.cos(k * (a - 1 - f));
        im += w[a] * Math.sin(k * (a - 1 - f));
      }
    } else {
      re = (1 - f) * Math.cos(-k * f) + f * Math.cos(k * (1 - f));
      im = (1 - f) * Math.sin(-k * f) + f * Math.sin(k * (1 - f));
    }
    return Math.hypot(re, im);
  };
  // The response read off the mirror's own 2-D carry once, so the product below is the filter the pass runs.
  {
    const nn = 64;
    const wave = new Float64Array(nn * nn);
    for (let j = 0; j < nn; j++) for (let i = 0; i < nn; i++) wave[j * nn + i] = Math.sin(k * i);
    const o = carryField(wave, nn, 0, 0, 0.3, 0, new Float64Array(nn * nn));
    let ss = 0;
    let sc = 0;
    let s2 = 0;
    let c2 = 0;
    for (let i = 8; i < nn - 8; i++) {
      const v = o[(nn >> 1) * nn + i];
      const s = Math.sin(k * (i - 0.3));
      const c = Math.cos(k * (i - 0.3));
      ss += v * s;
      sc += v * c;
      s2 += s * s;
      c2 += c * c;
    }
    const measured = Math.hypot(ss / s2, sc / c2);
    ok(Math.abs(measured - respond(0.3, 'cr')) < 2e-3, `one carry's response read off the mirror's own field (${measured.toFixed(5)}) is the analytic one (${respond(0.3, 'cr').toFixed(5)}): the product below is the pass's filter`);
  }
  const loss = (seen: number[], filter: 'cr' | 'bl'): number => {
    let a = 1;
    for (const s of seen) a *= respond((1 * s) / texel, filter);
    return 1 - a;
  };
  const s60 = owed(60);
  const s144 = owed(144);
  const total = (s: number[]): number => s.reduce((x, y) => x + y, 0);
  ok(Math.abs(total(s60) - 10) < 0.02 && Math.abs(total(s144) - 10) < 0.02, `the hook owes the carry the whole ten seconds at either rate (${total(s60).toFixed(3)} s in ${s60.length} carries at 60, ${total(s144).toFixed(3)} s in ${s144.length} at 144)`);
  const cr60 = loss(s60, 'cr');
  const cr144 = loss(s144, 'cr');
  const bl60 = loss(s60, 'bl');
  const bl144 = loss(s144, 'bl');
  // The design's "damps about a tenth as much" (§2.9) is a rate: how fast the height decays, `-ln` of what is kept. A
  // bilinear carry has the ripple gone (99.95%) long before ten seconds are up, so the share lost cannot be compared;
  // the decay can.
  const decay = (lost: number): number => -Math.log(1 - lost);
  ok(decay(cr60) < decay(bl60) * 0.1 && decay(cr144) < decay(bl144) * 0.1, `a 3 m ripple carried by 1 m/s for 10 s decays under a tenth as fast as a bilinear carry decays it (the design's bound): ${(cr60 * 100).toFixed(2)}% lost (a decay of ${decay(cr60).toFixed(3)}) against ${(bl60 * 100).toFixed(2)}% (${decay(bl60).toFixed(2)}) at 60 frames a second, ${(cr144 * 100).toFixed(2)}% (${decay(cr144).toFixed(3)}) against ${(bl144 * 100).toFixed(2)}% (${decay(bl144).toFixed(2)}) at 144`);
  // A carry damps by its fraction of a texel squared, so a higher rate's smaller carries lose less: held where it stands,
  // so a change that makes it worse is seen. Over one second it is about 1.4% against 0.8% of a ripple whose own damping
  // takes most of its height within that second (W5-notes).
  ok(cr60 > cr144 && cr60 / cr144 < 3 && cr60 < 0.2, `the frame rate's part, held: ${(cr60 * 100).toFixed(2)}% at 60 against ${(cr144 * 100).toFixed(2)}% at 144 over ten seconds (${(cr60 / cr144).toFixed(2)} times)`);
}

// --- the carry pass's text ---
{
  const t = CARRY_FRAGMENT;
  ok(reservedWords(t).length === 0 && unbalanced(t) === '' && redeclared(t).length === 0 && undefinedCalls(t).length === 0 && !t.includes('`'), 'the carry pass: no reserved word, brackets balanced, no name declared twice, every call its own or GLSL\'s, no backtick');
  ok(t.includes('texelFetch(uState, ivec2(x, y), 0)') && t.includes('vec3 c = airLiquidAt(vec2(ripWorldX(uv.x), ripWorldZ(uv.y)));') && t.includes('vec4 s = ripCarry(ripSourceX(float(dst.x), c.x, k), ripSourceY(float(dst.y), c.y, k), n);'), 'its main reads by texelFetch, finds the current at the texel\'s own world place and samples where ripSourceX and ripSourceY say: the functions run here are the ones it calls');
  const pass = new RippleCarryPass();
  ok(pass.material.uniforms.uRipWin === WATER_SIM_WINDOW && pass.material.blending === THREE.NoBlending && pass.material.depthTest === false, "the pass reads the ripples' own window object by reference, NoBlending, no depth");
  pass.dispose();
}

// --- where a texel is and where it reads from, at every ripple detail ---
{
  const conv = glslFunctions(['ripWorldX', 'ripWorldZ', 'ripSourceX', 'ripSourceY'].map((f) => glslFunctionText(CARRY_FRAGMENT, f)).join('\n'), ['ripWorldX', 'ripWorldZ', 'ripSourceX', 'ripSourceY'], { uRipWin: WATER_SIM_WINDOW.value, uCarry: { x: 0, y: 0, z: 0, w: 0 } });
  const ring = glslFunctions(['ringU', 'ringV'].map((f) => glslFunctionText(RING_VERTEX, f)).join('\n'), ['ringU', 'ringV'], { uRingW: WATER_SIM_WINDOW.value });
  const lines: string[] = [];
  let all = true;
  for (const key of Object.keys(WATER_SIM_DETAIL).map(Number)) {
    const { renderer, pokes } = recorder();
    configureWaterSim({ waterRipples: true, waterRippleDetail: key, waterRippleHeight: 1, waterRipplePersistence: 0.85 });
    stepWaterSim(renderer, 403.7, -211.2, 0, 1 / 60, 3);
    const win = WATER_SIM_WINDOW.value;
    const texels = win.z / win.w;
    // A poke at a world point, read back out of the step's own record: waterSim's own uv of that point.
    const px = win.x + win.z * 0.31;
    const pz = win.y + win.z * 0.72;
    pokes.length = 0;
    pokeWaterSim(px, pz, 0.5, 0.6);
    stepWaterSim(renderer, 403.7, -211.2, 0, 1 / 60, 3);
    const p = pokes[0]?.find((q) => q[3] !== 0);
    if (!p) {
      all = false;
      continue;
    }
    const [u, v] = p;
    const back = { x: conv.ripWorldX(u) as number, z: conv.ripWorldZ(v) as number };
    const backOk = Math.abs(back.x - px) < 1e-6 && Math.abs(back.z - pz) < 1e-6;
    const ringOk = Math.abs((ring.ringU(px) as number) - u) < 1e-9 && Math.abs((ring.ringV(pz) as number) - v) < 1e-9;
    // The air window's uv of that place: fluidWindow's own conversion, from the ripples' uv.
    const w = newWindow();
    placeWindow(w, px + 7.3, pz - 4.1, 192, 128, 0.5);
    const viaRip = rippleUvToAir(u, v, win.x, win.y, win.z, w, { x: 0, y: 0 });
    const viaWorld = fluidUv(w, back.x, back.z, { x: 0, y: 0 });
    const airOk = Math.abs(viaRip.x - viaWorld.x) < 1e-9 && Math.abs(viaRip.y - viaWorld.y) < 1e-9;
    // A current (cx, cz) for s seconds moves a ripple at P to P + c s: the texel there reads from P's texel.
    const cx = 1.3;
    const cz = -0.8;
    const s = 0.4;
    const texelOf = (x: number, z: number): [number, number] => [((x - win.x) / win.z) * texels - 0.5, (1 - (z - win.y) / win.z) * texels - 0.5];
    const [fx, fy] = texelOf(px, pz);
    const [tx, ty] = texelOf(px + cx * s, pz + cz * s);
    const carry = { x: 0, y: 0, z: s, w: texels };
    const run2 = glslFunctions(['ripSourceX', 'ripSourceY'].map((f) => glslFunctionText(CARRY_FRAGMENT, f)).join('\n'), ['ripSourceX', 'ripSourceY'], { uRipWin: win, uCarry: carry });
    const srcOk = Math.abs((run2.ripSourceX(tx, cx, 1) as number) - fx) < 1e-9 && Math.abs((run2.ripSourceY(ty, cz, 1) as number) - fy) < 1e-9;
    // The window moved two texels east and one north: P's new texel reads its old one through the owed whole texels.
    const nx = win.x + 2 * win.w;
    const nz = win.y + win.w;
    const newTexel = [((px - nx) / win.z) * texels - 0.5, (1 - (pz - nz) / win.z) * texels - 0.5];
    const moved = { x: Math.round(((nx - win.x) / win.z) * texels), y: Math.round((-(nz - win.y) / win.z) * texels), z: 0, w: texels };
    const run3 = glslFunctions(['ripSourceX', 'ripSourceY'].map((f) => glslFunctionText(CARRY_FRAGMENT, f)).join('\n'), ['ripSourceX', 'ripSourceY'], { uRipWin: win, uCarry: moved });
    const moveOk = Math.abs((run3.ripSourceX(newTexel[0], 0, 1) as number) - fx) < 1e-9 && Math.abs((run3.ripSourceY(newTexel[1], 0, 1) as number) - fy) < 1e-9;
    if (!backOk || !ringOk || !airOk || !srcOk || !moveOk) all = false;
    lines.push(`${key}: ${backOk && ringOk && airOk && srcOk && moveOk ? 'ok' : `world ${backOk}, ring ${ringOk}, air ${airOk}, current ${srcOk}, move ${moveOk}`}`);
    disposeWaterSim();
  }
  void conv;
  ok(all, `at every ripple detail (${lines.join('; ')}): a poke's own uv, run back through the carry's ripWorldX and ripWorldZ, is the point poked; the rings' ringU and ringV of that point are the poke's uv; the air window's uv of it is fluidWindow's rippleUvToAir; a current carries a ripple to the texel that reads from where it was (ripSourceX, ripSourceY: v against world Z); and a window's whole-texel move is read back the same way`);
}

// --- the hook, with the real pass ---
{
  const { renderer, calls, pokes, carries } = recorder();
  configureWaterSim({ waterRipples: true, waterRippleDetail: 512, waterRippleHeight: 1, waterRipplePersistence: 0.85 });
  const u = makeLiquidUniforms();
  const real = new RippleCarryPass(u);
  // The real pass, its asks and answers watched: what it was owed, and whether it drew.
  const ran: { u: number; v: number; s: number; drew: boolean }[] = [];
  const carry: RippleCarry = {
    ask: real.ask,
    run(r, from, to) {
      const drew = real.run(r, from, to);
      ran.push({ u: real.ask.scrollU, v: real.ask.scrollV, s: real.ask.seconds, drew });
      return drew;
    },
  };
  // A first frame with no carry, then the carry hung (the record's water share one: the pass draws).
  stepWaterSim(renderer, 0, 0, 0, 1 / 60, 3);
  ok(!rippleCarrySet(), 'no carry is hung until one is set');
  setRippleCarry(carry);
  ok(rippleCarrySet(), 'and one is, once set');
  u.uAirLiquidP.value.x = 1;
  calls.length = 0;
  carries.length = 0;
  // Frames of 1/240 s at the ripples' 120 steps a second (a step every second frame), the camera moving a texel (0.375 m)
  // each frame: the first frame takes no step, so its move and its seconds wait for the second's carry.
  const texel = 192 / 512;
  stepWaterSim(renderer, texel, 0, 0, 1 / 240, 3);
  ok(ran.length === 0, 'a stepless frame runs no carry');
  stepWaterSim(renderer, 2 * texel, 0, 0, 1 / 240, 3);
  const run = ran[0];
  ok(ran.length === 1 && Math.abs(run.u - 2 / 512) < 1e-12 && run.v === 0 && run.drew, `the carry is handed both frames' whole-texel moves (${(run.u * 512).toFixed(3)} texels), the stepless one's included, where today's step drops a stepless frame's move`);
  ok(Math.abs(run.s - 2 / 240) < 1e-12, `and both frames' seconds (${run.s.toFixed(6)} s)`);
  const c0 = carries[0];
  ok(!!c0 && c0[0] === 2 && c0[1] === 0 && Math.abs(c0[2] - 2 / 240) < 1e-12 && c0[3] === 512, `the real pass hands its own uCarry the owed whole texels, the seconds and the texels across: (${c0?.join(', ')})`);
  const firstStep = calls.findIndex((c) => c.startsWith('step'));
  const firstCarry = calls.findIndex((c) => c.startsWith('carry'));
  ok(firstCarry >= 0 && firstCarry < firstStep && calls[firstStep].endsWith('scroll 0.000000,0.000000'), "the carry draws before the frame's first step, which then takes no scroll of its own (the carry took it)");
  // The window moving north: the ripples' v against world Z, so the owed v is negative and so is the pass's y.
  carries.length = 0;
  stepWaterSim(renderer, 2 * texel, -texel, 0, 1 / 60, 3);
  ok(carries.length === 1 && carries[0][0] === 0 && carries[0][1] === 1, `a window moved a texel toward -Z owes one texel of v, which the pass hands as +1 (the ripples' v runs against world Z): (${carries[0]?.join(', ')})`);
  // A hitch: never more than a quarter second carried at once.
  ran.length = 0;
  stepWaterSim(renderer, 2 * texel, -texel, 0, 2, 3);
  ok(ran.length === 1 && ran[0].s <= 0.25, `a frame of two seconds hands the carry at most a quarter second (${ran[0]?.s.toFixed(3)} s): a hitch never throws the ripples across the window`);
  // A poke reaches the first carried step after it, and no other.
  pokes.length = 0;
  pokeWaterSim(2 * texel + 5, -texel + 5, 0.6, 1.2);
  stepWaterSim(renderer, 2 * texel, -texel, 0, 1 / 60, 3);
  stepWaterSim(renderer, 2 * texel, -texel, 0, 1 / 60, 3);
  const live = (list: number[][]): number[][] => list.filter((q) => q[3] !== 0);
  const first = live(pokes[0] ?? []);
  ok(first.length === 1 && Math.abs(first[0][3] - 0.6) < 1e-12 && Math.abs(first[0][2] - 1.2 / texel) < 1e-9, `the first carried step after a poke carries it whole (strength ${first[0]?.[3]}, ${first[0]?.[2].toFixed(2)} texels across)`);
  ok(pokes.length >= 3 && pokes.slice(1).every((list) => live(list).length === 0), `and the frame's second step and every step after carry none (${pokes.length} steps read): a poke lands once`);
  // The carry drawing nothing (a share of nought): the step takes the owed move as today's takes the frame's.
  u.uAirLiquidP.value.x = 0;
  calls.length = 0;
  ran.length = 0;
  stepWaterSim(renderer, 6 * texel, -texel, 0, 1 / 60, 3);
  const st = calls.find((c) => c.startsWith('step'));
  ok(ran.length === 1 && !ran[0].drew && !calls.some((c) => c.startsWith('carry')) && !!st && !st.endsWith('scroll 0.000000,0.000000'), 'a carry that draws nothing (a share of nought) leaves the step to take the owed move');
  setRippleCarry(null);
  ok(!rippleCarrySet(), 'and the carry taken off: the ripples step today\'s way (the off-proof holds that way to the old module, draw for draw)');
  real.dispose();
  disposeWaterSim();
}

console.log(`\n${checks} checks passed`);
