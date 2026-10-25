// The water's current (the volumetrics' fifth wave, the design's §2.9; `airLiquid.ts`, `water.ts`'s variant): the flow
// laid in is `f + k (c − f)` and `f` itself by identity at a share of nought or off the window; its units carry the water's
// detail at the current's own speed (worked out from `detailSlope`'s own constants, read out of `water.ts`); the variant
// is today's text with exactly its three lines added, keyed `…-air`, its mask twins keyed off it, its uniforms the lit
// material's own objects with the session's liquid record beside them; the choosers hand today's materials by identity
// whenever the master, the current or the lava is off; the liquid tile's own GLSL, run as script (`glslRun.ts`): its
// numbers by medium, its step against the mirror (`liquidTargetRule`), its swirl and its cap, and a wake behind an island
// in a small solve over that very step, its curl downstream, and nothing moving at all with the rule's pull at nought;
// the readers' `airLiquidAt` through its own edge fade and tile clamp, run; and a body handed its current wears it whole,
// its two mask twins with it, and gives the plain three back by identity.
//
// The water's module names its neighbours without an extension, so this suite registers the off-proof's loader over
// today's tree alone (`airLoader.mjs`).
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './airTrees.ts';
import { redeclared, reservedWords, unbalanced, undefinedCalls } from './glslScan.ts';
import { glslFunctionText, glslFunctions } from './glslRun.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const SRC = join(REPO, 'src');
register(pathToFileURL(join(REPO, 'tools', 'swg', 'tests', 'airLoader.mjs')).href, import.meta.url, { data: { roots: [SRC], packageBase: join(REPO, 'package.json') } });
const load = async (p: string): Promise<Record<string, unknown>> => (await import(pathToFileURL(join(SRC, p)).href)) as Record<string, unknown>;
const THREE = (await import('three')) as typeof import('three');
const L = (await load('world/volumetrics/airLiquid.ts')) as typeof import('../../../src/world/volumetrics/airLiquid.ts');
const W = (await load('world/water.ts')) as typeof import('../../../src/world/water.ts');
const WL = (await load('world/waterLook.ts')) as typeof import('../../../src/world/waterLook.ts');
const waterText = readFileSync(join(SRC, 'world', 'water.ts'), 'utf8').replace(/\r\n/g, '\n');
const DETAIL_FLOW = Number(/const DETAIL_FLOW = ([\d.]+);/.exec(waterText)?.[1]);
const DETAIL_CYCLE = Number(/const DETAIL_CYCLE = ([\d.]+);/.exec(waterText)?.[1]);
ok(DETAIL_FLOW > 0 && DETAIL_CYCLE > 0, `the water's own detail constants read out of water.ts (${DETAIL_FLOW}, ${DETAIL_CYCLE})`);

// --- the flow laid in ---
{
  const out = { x: 0, z: 0 };
  let identity = true;
  for (const [fx, fz] of [[0.3, -1.2], [-0.03, 0.007], [5, 5]]) {
    L.waterAirFlowMirror(fx, fz, 2, -1, 0, 1, 1, 1, DETAIL_FLOW, DETAIL_CYCLE, out);
    if (!Object.is(out.x, fx) || !Object.is(out.z, fz)) identity = false;
    L.waterAirFlowMirror(fx, fz, 2, -1, 1, 0, 1, 1, DETAIL_FLOW, DETAIL_CYCLE, out);
    if (!Object.is(out.x, fx) || !Object.is(out.z, fz)) identity = false;
  }
  ok(identity, "at an art share of nought, or off the window (an edge of nought), the flow is today's flowAt by identity");
  // Full share, inside: the flow is the current in flowAt's units, which carries the detail at the current's own speed.
  const drift = 1.4;
  L.waterAirFlowMirror(0.4, 0.4, 1.5, -0.5, 1, 1, drift, 1, DETAIL_FLOW, DETAIL_CYCLE, out);
  const t0 = 3.2;
  const dt = 1e-3;
  const speedX = (L.detailCarried(out.x, drift, DETAIL_FLOW, DETAIL_CYCLE, t0 + dt) - L.detailCarried(out.x, drift, DETAIL_FLOW, DETAIL_CYCLE, t0)) / dt;
  const speedZ = (L.detailCarried(out.z, drift, DETAIL_FLOW, DETAIL_CYCLE, t0 + dt) - L.detailCarried(out.z, drift, DETAIL_FLOW, DETAIL_CYCLE, t0)) / dt;
  ok(Math.abs(speedX - 1.5) < 1e-6 && Math.abs(speedZ + 0.5) < 1e-6, `at a share of one the water's detail rides the current at the current's own speed (${speedX.toFixed(4)}, ${speedZ.toFixed(4)} m/s for a current of (1.5, -0.5)): the units are detailSlope's own`);
  L.waterAirFlowMirror(0.4, 0.4, 1.5, -0.5, 1, 1, drift, 0.5, DETAIL_FLOW, DETAIL_CYCLE, out);
  const half = (L.detailCarried(out.x, drift, DETAIL_FLOW, DETAIL_CYCLE, t0 + dt) - L.detailCarried(out.x, drift, DETAIL_FLOW, DETAIL_CYCLE, t0)) / dt;
  ok(Math.abs(half - 0.75) < 1e-6, "and at the detail's share of a half (`liquid.detailFlow`) at half its speed");
  L.waterAirFlowMirror(0.4, -0.2, 1.5, -0.5, 0.5, 1, drift, 1, DETAIL_FLOW, DETAIL_CYCLE, out);
  const scale = 1 / (drift * DETAIL_FLOW * DETAIL_CYCLE);
  ok(Math.abs(out.x - (0.4 + 0.5 * (1.5 * scale - 0.4))) < 1e-12 && Math.abs(out.z - (-0.2 + 0.5 * (-0.5 * scale + 0.2))) < 1e-12, 'between, f + k (c − f): never a function applied to f');
  // The variant's own function says the same, line by line.
  const glsl = L.waterCurrentGlsl(DETAIL_FLOW, DETAIL_CYCLE);
  ok(glsl.includes('if (uAirLiquidP.x <= 0.0) return f;') && glsl.includes('float k = uAirLiquidP.x * c.z;') && glsl.includes('if (k <= 0.0) return f;') && glsl.includes(`vec2 cf = c.xy * (uAirLiquidP.z / max(uDrift * ${DETAIL_FLOW.toFixed(4)} * ${DETAIL_CYCLE.toFixed(4)}, 1e-6));`) && glsl.includes('return f + k * (cf - f);'), "the variant's waterAirFlow is the mirror's line for line: f by a uniform branch at nought, f off the window, f + k (c − f) between, in detailSlope's units");
  ok(reservedWords(glsl).length === 0 && unbalanced(glsl) === '' && redeclared(glsl).length === 0 && !glsl.includes('`'), 'its text: no reserved word, balanced, no name declared twice, no backtick');
  ok(undefinedCalls(`${glsl}\nfloat uDrift;`).length === 0, 'and every function it calls is its own or GLSL\'s');
}

// --- the variant and its twins ---
const physical = () => ({ vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader, uniforms: {} as Record<string, unknown>, defines: {} as Record<string, unknown> });
{
  const look = WL.waterLookFor(null, null, { color: 0x335577, opacity: 0.6 } as never);
  let all = true;
  for (const waves of [true, false]) {
    for (const hooked of [false, true]) {
      const lit = W.createWaterMaterial(look, waves);
      const air = W.createWaterAirMaterial(lit);
      const mats = [lit, W.createWaterMaskMaterial(lit, THREE.BackSide), W.createWaterMaskMaterial(lit, THREE.FrontSide)];
      const airMats = [air, W.createWaterMaskMaterial(air, THREE.BackSide), W.createWaterMaskMaterial(air, THREE.FrontSide)];
      for (let i = 0; i < 3; i++) {
        const p = mats[i];
        const a = airMats[i];
        if (hooked) {
          p.onBeforeCompile = (s) => void (s.fragmentShader += '\n// another hook');
          a.onBeforeCompile = (s) => void (s.fragmentShader += '\n// another hook');
        }
        const sp = physical();
        const sa = physical();
        p.onBeforeCompile(sp as never, null as never);
        a.onBeforeCompile(sa as never, null as never);
        const keyOk = a.customProgramCacheKey() === `${p.customProgramCacheKey()}-air` && !p.customProgramCacheKey().endsWith('-air');
        const vsOk = sa.vertexShader === sp.vertexShader;
        // Today's text with exactly the three lines added: the pars after the weather's, the flow line, the view line.
        const back = sa.fragmentShader
          .replace(`\n${L.waterCurrentGlsl(DETAIL_FLOW, DETAIL_CYCLE)}`, '')
          .replace(L.WATER_FLOW_TO, L.WATER_FLOW_FROM)
          .replace(L.WATER_VIEW_TO, L.WATER_VIEW_FROM);
        const fsOk = back === sp.fragmentShader && sa.fragmentShader !== sp.fragmentShader && sa.fragmentShader.includes(L.WATER_FLOW_TO);
        if (!keyOk || !vsOk || !fsOk) all = false;
      }
      // Shared uniforms by reference, the session's record beside them.
      const lu = lit.userData.uniforms as unknown as Record<string, unknown>;
      const au = air.userData.uniforms as unknown as Record<string, unknown>;
      if (!Object.keys(lu).every((k) => au[k] === lu[k])) all = false;
      if (!Object.keys(L.LIQUID_U).every((k) => au[k] === (L.LIQUID_U as unknown as Record<string, unknown>)[k])) all = false;
      if (air.userData.air !== true || airMats[1].userData.air !== true || lit.userData.air !== undefined) all = false;
    }
  }
  ok(all, "for every variant (lit and both mask twins, waves and flat, hooked and plain) the current variant's key is today's plus -air and its text today's with exactly the three lines added; its uniforms are the lit material's own objects with the session's liquid record beside them, and its twins are keyed off it");
}

// --- the choosers ---
{
  const plain = {};
  const air = {};
  const c = { on: true, current: true, lava: true, field: true, softOff: false };
  ok(L.waterMaterialFor(c, plain, air) === air && L.lavaMaterialFor(c, plain, air) === air, 'with the master, the switch and a field: the variant');
  let plainAlways = true;
  for (const k of ['on', 'field'] as const) {
    const d = { ...c, [k]: false };
    if (L.waterMaterialFor(d, plain, air) !== plain || L.lavaMaterialFor(d, plain, air) !== plain) plainAlways = false;
  }
  if (L.waterMaterialFor({ ...c, current: false }, plain, air) !== plain || L.lavaMaterialFor({ ...c, current: false }, plain, air) !== air) plainAlways = false;
  if (L.lavaMaterialFor({ ...c, lava: false }, plain, air) !== plain || L.waterMaterialFor({ ...c, lava: false }, plain, air) !== air) plainAlways = false;
  if (L.waterMaterialFor({ ...c, softOff: true }, plain, air) !== plain || L.waterMaterialFor(c, plain, null) !== plain) plainAlways = false;
  ok(plainAlways, "the master off, no field, the soft off or no variant made: today's material by identity; the current and the lava each choose their own liquid alone");
}

// --- the liquid tile's own GLSL, run: its numbers by medium, its step, its swirl and its cap ---
const S = (await load('world/volumetrics/airShaders.ts')) as typeof import('../../../src/world/volumetrics/airShaders.ts');
const T = (await load('world/volumetrics/airTune.ts')) as typeof import('../../../src/world/volumetrics/airTune.ts');
const LQ = T.AIR_TUNE.liquid;
// The uniforms laid out as the field writes them (`AirField.syncLiquid`, which airFrame.test holds to these places).
const uLiquidP = { x: LQ.waterRelax, y: LQ.waterDiss, z: LQ.lavaRelax, w: LQ.lavaDiss };
const uLiquidQ = { x: LQ.waterWind, y: LQ.lavaWind, z: LQ.waterSwirl, w: 0.37 };
const uLiquidR = { x: LQ.push, y: LQ.ribbonFlow, z: T.AIR_TUNE.solver.liquidCap, w: 1.5 };
const LIQ_FNS = ['liquidRelax', 'liquidDiss', 'liquidWindShare', 'liquidSwirl', 'liquidCap', 'liquidStep'];
const liq = glslFunctions(LIQ_FNS.map((f) => glslFunctionText(S.ADVECT_FRAGMENT, f)).join('\n'), LIQ_FNS, { uLiquidP, uLiquidQ, uLiquidR });
{
  const n = (x: unknown): number => x as number;
  ok(n(liq.liquidRelax(1)) === LQ.waterRelax && n(liq.liquidRelax(2)) === LQ.lavaRelax && n(liq.liquidDiss(1)) === LQ.waterDiss && n(liq.liquidDiss(2)) === LQ.lavaDiss && n(liq.liquidWindShare(1)) === LQ.waterWind && n(liq.liquidWindShare(2)) === LQ.lavaWind, "the advect's own liquidRelax, liquidDiss and liquidWindShare, run: water takes water's pull, dissipation and share of the wind, lava lava's");
  ok(n(liq.liquidSwirl(1)) === LQ.waterSwirl * 1.5 && n(liq.liquidSwirl(2)) === 0.37 * 1.5, "liquidSwirl: water its own share of the swirl and lava its own, each at the tile's own cell (uLiquidR.w)");
  ok(n(liq.liquidCap(100)) === T.AIR_TUNE.solver.liquidCap && n(liq.liquidCap(4)) === 4, "liquidCap: the liquid's fastest under the air's own");
  // The step against its mirror (`liquidTargetRule`) over a sweep, water and lava, past the cap both ways.
  const rule = L.newLiquidRule();
  let same = true;
  let capped = true;
  for (const medium of [1, 2]) {
    for (const v0 of [-80, -3.1, 0, 0.4, 2.2, 55]) {
      for (const target of [-40, -0.6, 0, 1.3, 47]) {
        for (const dt of [1 / 240, 1 / 60, 0.1, 2]) {
          rule.vx = v0;
          rule.vz = 0;
          rule.relax = medium === 2 ? LQ.lavaRelax : LQ.waterRelax;
          rule.diss = medium === 2 ? LQ.lavaDiss : LQ.waterDiss;
          rule.share = 1;
          rule.windX = target;
          rule.windZ = 0;
          rule.flowX = 0;
          rule.flowZ = 0;
          rule.cap = uLiquidR.z;
          rule.dt = dt;
          L.liquidTargetRule(rule);
          const g = n(liq.liquidStep(v0, target, liq.liquidRelax(medium), liq.liquidDiss(medium), dt));
          if (Math.abs(g - rule.vx) > 1e-12) same = false;
          if (Math.abs(g) > uLiquidR.z + 1e-12) capped = false;
        }
      }
    }
  }
  ok(same, "the advect's own liquidStep, run, is the mirror's liquidTargetRule over water and lava, six speeds, five targets and four steps: back-traced, dissipated, pulled toward its target at its medium's relax");
  ok(capped, `and never past the liquid's fastest (uLiquidR.z, ${uLiquidR.z} m/s) either way`);
  const src = S.ADVECT_FRAGMENT;
  ok(src.includes('int m = mediumAt(l);') && src.includes('vec2 tg = liquidTarget(w, l, liquidWindShare(m));') && src.includes('gl_FragColor = finite4(vec4(liquidStep(lv.x, tg.x, relax, diss, uDt), liquidStep(lv.y, tg.y, relax, diss, uDt), 0.0, 1.0));') && src.includes('float relax = liquidRelax(m);') && src.includes('float diss = liquidDiss(m);'), "the advect's liquid branch is those functions called on the medium under the cell: the ones run here");
  ok(S.VORT_FRAGMENT.includes('float swirl = liquid ? liquidSwirl(mediumAt(l)) : 1.0;') && S.VORT_FRAGMENT.includes('float cap = liquid ? liquidCap(uCap) : uCap;'), 'and the vorticity takes the liquid\'s swirl and cap through liquidSwirl and liquidCap');
  ok(L.LIQUID_TARGET_GLSL.includes('return windHere(w, uWind * windShare) + own;') && L.LIQUID_TARGET_GLSL.includes('vec2 own = texture(uFlowR, clamp(l, 0.0, 1.0)).xy * uLiquidR.y;') && (src.match(/liquidTarget\(/g) ?? []).length === 2, "and the target is one function (LIQUID_TARGET_GLSL: the wind times the medium's share, plus the liquid's own flow times its share), called once, which the seventh wave's one wind will set");
}

// --- the liquid tile's rule: a wake behind an island ---
{
  // A small solve over the advect's own step (`liquidStep`, run as script) with a pressure projection: water in a channel
  // closed by its banks and wrapped round along x (so nothing flows in from an edge: whatever moves, the rule moved), an
  // island in it, the wind's share along +x. Behind the island the water runs slower than beside it, and the wake's two
  // shear layers carry a curl the open water upstream has not got.
  const solve = (relax: number): { behind: number; beside: number; free: number; curlWake: number; curlFar: number; island: number } => {
    const nx = 96;
    const nz = 40;
    const at = (i: number, j: number): number => j * nx + i;
    const wrap = (i: number): number => ((i % nx) + nx) % nx;
    const solid = new Uint8Array(nx * nz);
    const cx = 24;
    const cz = 20;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (j === 0 || j === nz - 1 || (i - cx) ** 2 + (j - cz) ** 2 <= 16) solid[at(i, j)] = 1;
    let u = new Float64Array(nx * nz);
    let v = new Float64Array(nx * nz);
    const dt = 0.1;
    const windX = 20;
    const target = windX * (liq.liquidWindShare(1) as number);
    const diss = liq.liquidDiss(1) as number;
    const sample = (f: Float64Array, x: number, z: number): number => {
      const zc = Math.min(nz - 1, Math.max(0, z));
      const i = Math.floor(x);
      const j = Math.floor(zc);
      const fx = x - i;
      const fz = zc - j;
      const g = (a: number, b: number) => (solid[at(wrap(a), Math.min(nz - 1, b))] ? 0 : f[at(wrap(a), Math.min(nz - 1, b))]);
      return (g(i, j) * (1 - fx) + g(i + 1, j) * fx) * (1 - fz) + (g(i, j + 1) * (1 - fx) + g(i + 1, j + 1) * fx) * fz;
    };
    const p = new Float64Array(nx * nz);
    for (let step = 0; step < 500; step++) {
      const nu = new Float64Array(nx * nz);
      const nv = new Float64Array(nx * nz);
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const k = at(i, j);
          if (solid[k]) continue;
          const bx = i - u[k] * dt;
          const bz = j - v[k] * dt;
          nu[k] = liq.liquidStep(sample(u, bx, bz), target, relax, diss, dt) as number;
          nv[k] = liq.liquidStep(sample(v, bx, bz), 0, relax, diss, dt) as number;
        }
      }
      // Projection: the divergence taken off by Jacobi steps, the land reflecting, x wrapped.
      const div = new Float64Array(nx * nz);
      const g = (f: Float64Array, i: number, j: number, own: number) => (j < 0 || j >= nz || solid[at(wrap(i), j)] ? -own : f[at(wrap(i), j)]);
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (!solid[at(i, j)]) div[at(i, j)] = 0.5 * (g(nu, i + 1, j, nu[at(i, j)]) - g(nu, i - 1, j, nu[at(i, j)]) + g(nv, i, j + 1, nv[at(i, j)]) - g(nv, i, j - 1, nv[at(i, j)]));
      p.fill(0);
      for (let it = 0; it < 30; it++) {
        const q = p.slice();
        for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
          if (solid[at(i, j)]) continue;
          const pp = (a: number, b: number) => (b < 0 || b >= nz || solid[at(wrap(a), b)] ? q[at(i, j)] : q[at(wrap(a), b)]);
          p[at(i, j)] = (pp(i - 1, j) + pp(i + 1, j) + pp(i, j - 1) + pp(i, j + 1) - div[at(i, j)]) * 0.25;
        }
      }
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
        const k = at(i, j);
        if (solid[k]) continue;
        const pp = (a: number, b: number) => (b < 0 || b >= nz || solid[at(wrap(a), b)] ? p[k] : p[at(wrap(a), b)]);
        nu[k] -= 0.5 * (pp(i + 1, j) - pp(i - 1, j));
        nv[k] -= 0.5 * (pp(i, j + 1) - pp(i, j - 1));
      }
      u = nu;
      v = nv;
    }
    const speed = (i: number, j: number) => Math.hypot(u[at(i, j)], v[at(i, j)]);
    const curl = (i: number, j: number) => 0.5 * (v[at(wrap(i + 1), j)] - v[at(wrap(i - 1), j)]) - 0.5 * (u[at(i, j + 1)] - u[at(i, j - 1)]);
    let behind = 0;
    let beside = 0;
    for (let d = 6; d <= 9; d++) {
      behind += speed(cx + d, cz);
      beside += speed(cx + d, cz + 12);
    }
    let curlWake = 0;
    let curlFar = 0;
    let cells = 0;
    for (let j = cz - 6; j <= cz + 6; j++) {
      for (let i = cx + 6; i <= cx + 16; i++) curlWake += Math.abs(curl(i, j));
      // Upstream of the island, as far from the wake round the wrap as the channel allows.
      for (let i = cx - 16; i <= cx - 6; i++) curlFar += Math.abs(curl(wrap(i), j));
      cells += 11;
    }
    return { behind: behind / 4, beside: beside / 4, free: target, curlWake: curlWake / cells, curlFar: curlFar / cells, island: speed(cx, cz) };
  };
  const w = solve(liq.liquidRelax(1) as number);
  ok(w.behind < w.beside * 0.8 && w.beside > w.free * 0.5, `the liquid's own step leaves a wake behind an island: ${w.behind.toFixed(2)} m/s two cells behind it against ${w.beside.toFixed(2)} m/s beside it (the means; the free stream ${w.free.toFixed(2)})`);
  ok(w.curlWake > 0.02 && w.curlWake > w.curlFar * 3, `and its shear layers carry a curl downstream (a mean |curl| of ${w.curlWake.toFixed(3)} a second behind the island against ${w.curlFar.toFixed(3)} upstream)`);
  ok(w.island === 0, "and nothing moves on the land: the island is the liquid's solid");
  const still = solve(0);
  ok(!(still.behind < still.beside * 0.8 && still.beside > still.free * 0.5) && still.beside === 0, `the control: with the rule's pull at nought nothing moves at all (${still.beside.toFixed(3)} m/s beside the island), so the wake above is the rule's, never an edge's inflow`);
}

// --- the readers' own airLiquidAt, run: the edge band and the tile's clamp ---
{
  const FW = (await load('world/volumetrics/fluidWindow.ts')) as typeof import('../../../src/world/volumetrics/fluidWindow.ts');
  const band = 0.07;
  const uAirLiquidWin = { x: 10, y: -20, z: 192, w: band };
  const at = glslFunctions(['airLiquidEdge', 'airLiquidAtlas'].map((f) => glslFunctionText(L.LIQUID_PARS_GLSL, f)).join('\n'), ['airLiquidEdge', 'airLiquidAtlas'], { uAirLiquidWin });
  let fade = true;
  for (let i = 0; i <= 50; i++) {
    for (let j = 0; j <= 50; j++) {
      const lx = i / 50;
      const ly = j / 50;
      if (Math.abs((at.airLiquidEdge(lx, ly) as number) - FW.edgeFade(lx, ly, band)) > 1e-12) fade = false;
    }
  }
  ok(fade, "airLiquidEdge, run, is the window's own edgeFade over the whole window: nought at the edge, eased to one a band's width inside");
  const origin = 0.75;
  const size = 0.25;
  const hf = 0.5 / 1024;
  let held = true;
  let inside = true;
  for (let i = -20; i <= 120; i++) {
    const l = i / 100;
    const a = at.airLiquidAtlas(l, origin, size, hf) as number;
    if (a < origin + hf - 1e-15 || a > origin + size - hf + 1e-15) held = false;
    if (l * size >= hf && l * size <= size - hf && Math.abs(a - (origin + l * size)) > 1e-15) inside = false;
  }
  ok(held && inside, "airLiquidAtlas, run: the read stands at the window place inside the tile and is held half a texel inside its rectangle at and past the window's edges, never in the slab beside it");
  ok(L.LIQUID_PARS_GLSL.includes('vec2 a = vec2(airLiquidAtlas(l.x, uAirLiquidRect.x, uAirLiquidRect.z, uAirLiquidHalf.x), airLiquidAtlas(l.y, uAirLiquidRect.y, uAirLiquidRect.w, uAirLiquidHalf.y));') && L.LIQUID_PARS_GLSL.includes('return vec3(c, airLiquidEdge(l.x, l.y));'), 'and airLiquidAt reads the current through them: the functions run here are the ones every reader calls');
}

// --- a body handed its current wears it whole, twins and all ---
{
  const WB = (await load('world/waterBodies.ts')) as typeof import('../../../src/world/waterBodies.ts');
  const bodies = new WB.WaterBodies();
  const look = WL.waterLookFor(null, null, { color: 0x335577, opacity: 0.6 } as never);
  const geometry = new THREE.PlaneGeometry(10, 10);
  const mesh = new THREE.Mesh(geometry);
  const body = bodies.add(mesh, false, look, 'lake');
  const plain = [body.lit, body.masks[0], body.masks[1]];
  const made: import('three').Material[] = [];
  ok(bodies.makeAir(made) === 1 && made.length === 1 && made[0] === body.air && body.airMasks !== null, 'makeAir gives the body its current variant and two mask twins, and hands the variant to the list it is given');
  ok(bodies.wearAir(true, () => false) === 0 && mesh.material === body.lit && body.twins[0].material === body.masks[0], "a variant the world says is not built yet is not worn: the body keeps its plain material and plain twins");
  ok(bodies.wearAir(true) === 1, 'built, it is worn');
  const keys = [mesh.material, body.twins[0].material, body.twins[1].material] as import('three').Material[];
  ok(keys[0] === body.air && keys[1] === body.airMasks![0] && keys[2] === body.airMasks![1] && keys.every((m) => m.userData.air === true), "the mesh and both twins wear the current's own: the lit variant and its back and front mask twins (the reflections' mask flows as the lit water does)");
  ok(bodies.wearAir(false) === 0 && mesh.material === plain[0] && body.twins[0].material === plain[1] && body.twins[1].material === plain[2], 'and taken off, the plain three come back by identity');
  bodies.remove(mesh);
  geometry.dispose();
}

console.log(`\n${checks} checks passed`);
