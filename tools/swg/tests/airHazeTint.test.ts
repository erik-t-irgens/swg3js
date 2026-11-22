// The haze's colour appended to the game's air record (the GPU port's pass 2, wave 4a, the brief's item 6): the three numbers
// the viewer's atmosphere wave B appended after the game's 25 (`mieTintR/G/B`, each channel's Mie scattering as a share of
// `mieS`, its extinction kept grey), now the game's own, multiplied into the twin's sums (`psiOf`, `viewRadiance` and the
// frame's own `viewRadianceReg`), the fit's short sum and the GPU sky's march (`airTables.ts`), the fit leaving them at the
// world's dial (grey to start).
//
// What it holds:
//   - **every world's sky is the base's to the bit at a grey haze**: the code before the wave (5011b94) is written out of git
//     and run beside the tree's over every world's record, its column densities, its multiple scattering, its sky radiance at
//     set views under three lights, the twin's frames and the lighting fields it writes, the fit of a world's rows and the
//     fit's own short sum: every number by `Object.is`;
//   - the colour is the in-scatter's alone: a coloured haze dims the sun exactly as a grey one does (the same transmittance),
//     and a pure haze's light takes the haze's own colour;
//   - the game's air and the viewer's (`src/sky/look/airProfile.js`, the body path's) are one record, number for number with
//     the haze's colour, and agree on a coloured haze as they agree on a grey one;
//   - the dials: three a world, starting grey, held to their range, written into a record, handed to the fit, which leaves the
//     fitted hue and ozone what a grey haze gives;
//   - the GPU march reads the colour where the twin does (as text: node builds no WGSL).
//   node tools/swg/tests/airHazeTint.test.ts
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractOldSrc, REPO } from './airTrees.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** The commit the wave was cut from: the sky as it was. */
const BASE = '5011b94';
const OLD = extractOldSrc(BASE);
const NEW = join(REPO, 'src');
process.on('exit', () => {
  try {
    rmSync(dirname(OLD), { recursive: true, force: true });
  } catch {
    /* a temporary folder the system clears in its own time */
  }
});
register(pathToFileURL(join(REPO, 'tools', 'swg', 'tests', 'airLoader.mjs')).href, import.meta.url, { data: { roots: [OLD, NEW], packageBase: join(REPO, 'package.json') } });

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (root: string, path: string): Promise<Any> => await import(pathToFileURL(join(root, path)).href);
const OP = await load(OLD, 'sky/air/airParams.ts');
const OT = await load(OLD, 'sky/air/airTwin.ts');
const OF = await load(OLD, 'sky/air/airFit.ts');
const NP = await load(NEW, 'sky/air/airParams.ts');
const NT = await load(NEW, 'sky/air/airTwin.ts');
const NF = await load(NEW, 'sky/air/airFit.ts');
const V = await load(NEW, 'sky/look/airProfile.js');
ok(OP.AIR_FIELD_COUNT === 25 && NP.AIR_FIELD_COUNT === 28, `the code before the wave (${BASE}) is written out of git beside the tree's: its record of 25 numbers, the tree's of 28`);

/** Two arrays the same to the bit over their first `n` numbers (every number by `Object.is`). */
function sameBits(a: ArrayLike<number>, b: ArrayLike<number>, n = Math.max(a.length, b.length)): boolean {
  if (a.length < n || b.length < n) return false;
  for (let i = 0; i < n; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

// ---------------------------------------------------------------- the record

ok(
  Object.entries(OP.F).every(([k, i]) => NP.F[k] === i) && NP.F.mieTintR === 25 && NP.F.mieTintG === 26 && NP.F.mieTintB === 27,
  "every number of the old record sits where it sat, the haze's colour appended after them at 25, 26 and 27",
);
{
  const r = NP.newAirRecord();
  ok(r.length === 28 && r[NP.F.mieTintR] === 1 && r[NP.F.mieTintG] === 1 && r[NP.F.mieTintB] === 1 && sameBits(r, OP.newAirRecord(), 25), 'a fresh record is the old one to the bit, with a grey haze (1, 1, 1)');
}
ok(
  Object.entries(NP.F).every(([k, i]) => V.F[k] === i) && V.AIR_FIELD_COUNT === NP.AIR_FIELD_COUNT,
  "the game's record and the viewer's (the body path's, `airProfile.js`) are one layout, the haze's colour included",
);

// Every world the air knows of, and one it does not (the default world's numbers).
const WORLDS = [...Object.keys(OP.AIR_WORLDS), 'yavin4', 'unknown_world'];
const worldPair = (id: string, vis: number): [Any, Any] => {
  const o = OP.worldRecord(id);
  OP.setVisibility(o, vis);
  const n = NP.worldRecord(id);
  NP.setVisibility(n, vis);
  return [o, n];
};
{
  let all = true;
  for (const id of WORLDS) for (const vis of [40, 7, 1.5]) {
    const [o, n] = worldPair(id, vis);
    if (!sameBits(o, n, 25) || n[NP.F.mieTintR] !== 1 || n[NP.F.mieTintG] !== 1 || n[NP.F.mieTintB] !== 1) all = false;
  }
  ok(all, `every world's base record (${WORLDS.length} worlds, three visibilities) is the old one's 25 numbers to the bit, with a grey haze`);
}

// ---------------------------------------------------------------- the twin's tables and sums, old against new

{
  let depthSame = true;
  let psiSame = true;
  let viewSame = true;
  let views = 0;
  const lightsO = new OT.AirLights();
  const lightsN = new NT.AirLights();
  const outO = new Float64Array(3);
  const outN = new Float64Array(3);
  const trO = new Float64Array(3);
  const trN = new Float64Array(3);
  for (const id of WORLDS) {
    const [o, n] = worldPair(id, id === 'mustafar' ? 8 : 40);
    const dO = new Float64Array(OT.DEPTH_FLOATS);
    const dN = new Float64Array(NT.DEPTH_FLOATS);
    OT.buildDepthTable(o, dO);
    NT.buildDepthTable(n, dN);
    if (!sameBits(dO, dN)) depthSame = false;
    const pO = new Float64Array(OT.PSI_FLOATS);
    const pN = new Float64Array(NT.PSI_FLOATS);
    OT.buildPsiTable(o, dO, pO);
    NT.buildPsiTable(n, dN, pN);
    if (!sameBits(pO, pN)) psiSame = false;
    // Three lights (the sun, a second sun, the moon) at three heights of the sun, nine views each.
    for (const sunEl of [50, 4, -3]) {
      const se = (sunEl * Math.PI) / 180;
      for (const [L, top] of [
        [lightsO, 1],
        [lightsN, 1],
      ] as [Any, number][]) {
        L.count = 3;
        L.dir.set([Math.cos(se), Math.sin(se), 0, Math.cos(se - 0.03), Math.sin(se - 0.03), 0.05, -Math.cos(se), -Math.sin(se), 0.2]);
        L.top.set([top, top * 0.98, top * 0.95, 0.4, 0.35, 0.3, 2e-6, 2e-6, 2e-6]);
        L.live.set([1, 1, sunEl < 0 ? 1 : 0]);
      }
      for (const [el, az] of [[90, 0], [45, 0], [20, 180], [10, 90], [3, 0], [1, 30], [-2, 0], [-20, 120], [60, 270]]) {
        const e = (el * Math.PI) / 180;
        const z = (az * Math.PI) / 180;
        const dx = Math.cos(e) * Math.cos(z);
        const dy = Math.sin(e);
        const dz = Math.cos(e) * Math.sin(z);
        for (const maxT of [Infinity, 3.5]) {
          OT.viewRadiance(o, dO, pO, o[OP.F.bottom] + 0.02, dx, dy, dz, lightsO, 24, maxT, outO, 0, trO);
          NT.viewRadiance(n, dN, pN, n[NP.F.bottom] + 0.02, dx, dy, dz, lightsN, 24, maxT, outN, 0, trN);
          views++;
          if (!sameBits(outO, outN) || !sameBits(trO, trN)) viewSame = false;
        }
      }
    }
  }
  ok(depthSame, `every world's column densities are the old ones to the bit (${WORLDS.length} worlds, 256 by 64)`);
  ok(psiSame, "every world's multiple scattering (the twin's 32 by 16, each texel 32 rays of 16 steps) is the old one's to the bit at a grey haze");
  ok(viewSame, `the sky's radiance and transmittance are the old ones to the bit at ${views} views (every world, the sun 50, 4 and -3 degrees up, three lights, to the top and to 3.5 km)`);
}

// The twin's whole frame (its sliced sums, the frame's own register path) and the lighting fields it writes.
{
  let same = true;
  let frames = 0;
  const col = () => ({ r: 0.5, g: 0.5, b: 0.5 });
  const fields = () => ({ main: col(), mainScale: 1, ambient: col(), ambientScale: 1, bounce: col(), bounceScale: 1, fill: col(), fillScale: 1, fog: col(), fogDensity: 0 });
  const swg = { ...fields(), steer: 0 };
  for (const id of ['tatooine', 'naboo', 'mustafar', 'adventure2', 'unknown_world']) {
    const [o, n] = worldPair(id, 40);
    const tO = new OT.AirTwin();
    const tN = new NT.AirTwin();
    const dO = new Float64Array(OT.DEPTH_FLOATS);
    const dN = new Float64Array(NT.DEPTH_FLOATS);
    OT.buildDepthTable(o, dO);
    NT.buildDepthTable(n, dN);
    const pO = new Float64Array(OT.PSI_FLOATS);
    const pN = new Float64Array(NT.PSI_FLOATS);
    OT.buildPsiTable(o, dO, pO);
    NT.buildPsiTable(n, dN, pN);
    tO.useDepth(dO);
    tN.useDepth(dN);
    tO.useRecord(o, pO);
    tN.useRecord(n, pN);
    for (const sunEl of [60, 20, 5, 0.5, -2, -10]) {
      const se = (sunEl * Math.PI) / 180;
      for (const t of [tO, tN]) {
        t.inp.set([Math.cos(se) * 0.8, Math.sin(se), Math.cos(se) * 0.6, -Math.cos(se) * 0.8, -Math.sin(se), -Math.cos(se) * 0.6, Math.cos(se - 0.026), Math.sin(se - 0.026), 0, 0.03]);
        t.sun2 = id === 'tatooine';
        t.sunTop.set([2.1, 2.0, 1.9]);
        t.sun2Top.set([0.9, 0.8, 0.7]);
        t.moonTop.set([5e-6, 5e-6, 5e-6]);
        t.sumNow();
        t.frame();
      }
      frames++;
      const a = tO.out;
      const b = tN.out;
      for (const k of ['sunHere', 'sun2Here', 'moonHere', 'skyUp', 'groundDown', 'horizon', 'zenith']) if (!sameBits(a[k], b[k])) same = false;
      if (!Object.is(a.visibilityKm, b.visibilityKm) || !Object.is(a.fogDensity, b.fogDensity)) same = false;
      const LO = fields();
      const LN = fields();
      OT.writeTwinLighting(a, swg, LO);
      NT.writeTwinLighting(b, swg, LN);
      if (JSON.stringify(LO) !== JSON.stringify(LN)) same = false;
    }
  }
  ok(same, `the twin's ${frames} frames (five worlds, the sun from 60 degrees up to 10 under, its sums sliced as a frame slices them) and the lighting fields written from them are the old ones to the bit`);
}

// The fit: a world's rows, their hue and ozone fitted from a ramp, their haze by their fog, their tables.
{
  const ramp = (noon: [number, number, number], dusk: [number, number, number]): string => {
    const b = new Uint8Array(256 * 8 * 4);
    for (let r = 0; r < 8; r++) for (let i = 0; i < 256; i++) {
      const o = (r * 256 + i) * 4;
      const c = i < 128 ? noon : dusk;
      b[o] = c[0];
      b[o + 1] = c[1];
      b[o + 2] = c[2];
      b[o + 3] = 164;
    }
    return Buffer.from(b).toString('base64');
  };
  const rows = (blue: [number, number, number], dusk: [number, number, number]) => [
    { name: 'global', weatherIndex: 0, ramp: { rows: 8, rgba: ramp(blue, dusk) }, fog: { enabled: true, min: 0.0004, max: 0.0008 } },
    { name: 'global', weatherIndex: 1, ramp: { rows: 8, rgba: ramp(blue, dusk) }, fog: { enabled: true, min: 0.002, max: 0.004 } },
    { name: 'desert', weatherIndex: 0, ramp: { rows: 8, rgba: ramp([150, 170, 210], [90, 60, 110]) }, fog: { enabled: false, min: 0, max: 0 } },
  ];
  let same = true;
  let n = 0;
  for (const [id, blue, dusk] of [
    ['tatooine', [120, 160, 230], [80, 60, 120]],
    ['naboo', [90, 150, 240], [60, 70, 140]],
    ['mustafar', [140, 100, 90], [90, 40, 30]],
  ] as [string, [number, number, number], [number, number, number]][]) {
    const sky = { planet: id, sunElevationDegrees: 67.5, blocks: rows(blue, dusk) };
    const a = OF.fitWorld(sky, 40);
    const b = NF.fitWorld(sky, 40);
    if (a.rows.length !== b.rows.length || !sameBits(a.depth, b.depth)) same = false;
    for (let i = 0; i < a.rows.length; i++) {
      n++;
      const ra = a.rows[i];
      const rb = b.rows[i];
      if (!sameBits(ra.record, rb.record, 25) || !sameBits(ra.psi, rb.psi) || rb.record[NP.F.mieTintR] !== 1 || ra.distinct !== rb.distinct) same = false;
      if (!sameBits(ra.tint, rb.tint) || !Object.is(ra.ozone, rb.ozone)) same = false;
    }
    const o = new Float64Array(3);
    const p = new Float64Array(3);
    for (const [el, az, sunEl] of [[0.7, 1.5, 1.1], [1.5, 0, -0.05], [0.1, 3, 0.2]]) {
      OF.singleScatter(a.rows[0].record, el, az, sunEl, o);
      NF.singleScatter(b.rows[0].record, el, az, sunEl, p);
      if (!sameBits(o, p)) same = false;
    }
  }
  ok(same, `the fit's ${n} rows over three worlds (the hue and the ozone fitted from a ramp, a storm row's haze by its fog) are the old ones to the bit, records, tables and words, and so is the fit's own short sum`);
}

// ---------------------------------------------------------------- what the colour does

{
  const [, grey] = worldPair('tatooine', 12);
  const warm = Float64Array.from(grey);
  NP.setHazeTint(warm, 1, 0.85, 0.6);
  const dG = new Float64Array(NT.DEPTH_FLOATS);
  NT.buildDepthTable(grey, dG);
  const tG = new Float64Array(3);
  const tW = new Float64Array(3);
  let trSame = true;
  for (const mu of [1, 0.4, 0.1, 0.02]) {
    NT.lightTransmittance(grey, dG, grey[NP.F.bottom] + 0.01, mu, tG, 0);
    NT.lightTransmittance(warm, dG, warm[NP.F.bottom] + 0.01, mu, tW, 0);
    if (!sameBits(tG, tW)) trSame = false;
  }
  ok(trSame, "a warm haze dims the sun exactly as a grey one does (the transmittance the same to the bit): its colour takes nothing more from the light that crosses it");
  const pG = new Float64Array(NT.PSI_FLOATS);
  const pW = new Float64Array(NT.PSI_FLOATS);
  NT.buildPsiTable(grey, dG, pG);
  NT.buildPsiTable(warm, dG, pW);
  const L = new NT.AirLights();
  L.count = 1;
  L.live[0] = 1;
  const se = (15 * Math.PI) / 180;
  L.dir.set([Math.cos(se), Math.sin(se), 0]);
  L.top.set([1, 1, 1]);
  const lg = new Float64Array(3);
  const lw = new Float64Array(3);
  NT.viewRadiance(grey, dG, pG, grey[NP.F.bottom] + 0.01, 0.99, 0.12, 0.05, L, 24, Infinity, lg, 0, null);
  NT.viewRadiance(warm, dG, pW, warm[NP.F.bottom] + 0.01, 0.99, 0.12, 0.05, L, 24, Infinity, lw, 0, null);
  ok(lw[0] / lw[2] > 1.15 * (lg[0] / lg[2]) && lw[2] < lg[2] && lw[1] < lg[1], `toward a low sun through Tatooine's 12 km haze a warm dust's light is redder than a grey haze's (red over blue ${(lw[0] / lw[2]).toFixed(3)} against ${(lg[0] / lg[2]).toFixed(3)}) and dimmer in the channels it absorbs`);
  // A pure haze (no clear air, no ozone): its single scattering's colour is the haze's own shares.
  const pure = Float64Array.from(warm);
  pure[NP.F.rayR] = pure[NP.F.rayG] = pure[NP.F.rayB] = 0;
  pure[NP.F.ozR] = pure[NP.F.ozG] = pure[NP.F.ozB] = 0;
  const o = new Float64Array(3);
  NF.singleScatter(pure, 0.3, 0.5, 0.6, o);
  ok(Math.abs(o[1] / o[0] - 0.85) < 1e-12 && Math.abs(o[2] / o[0] - 0.6) < 1e-12, `a pure haze's single scattering takes the haze's own colour (green and blue over red ${(o[1] / o[0]).toFixed(6)}, ${(o[2] / o[0]).toFixed(6)})`);
}

// The game's sky and the viewer's march on one coloured record agree as on a grey one (test-game-agree's own views).
{
  const g = NP.newAirRecord();
  NP.setVisibility(g, 15);
  g[NP.F.groundR] = g[NP.F.groundG] = g[NP.F.groundB] = 0.2;
  const worst = (tint: [number, number, number]): number => {
    const r = Float64Array.from(g);
    NP.setHazeTint(r, tint[0], tint[1], tint[2]);
    const depth = new Float64Array(NT.DEPTH_FLOATS);
    NT.buildDepthTable(r, depth);
    const psi = new Float64Array(NT.PSI_FLOATS);
    NT.buildPsiTable(r, depth, psi);
    const tabs = V.makeTables(r);
    const L = new NT.AirLights();
    const out = new Float64Array(6);
    const gv = new Float64Array(3);
    let w = 0;
    for (const sunEl of [30, 5]) {
      const se = (sunEl * Math.PI) / 180;
      L.count = 1;
      L.live[0] = 1;
      L.dir[0] = Math.cos(se);
      L.dir[1] = Math.sin(se);
      L.dir[2] = 0;
      L.top[0] = L.top[1] = L.top[2] = 1;
      for (const [el, az] of [[90, 0], [45, 0], [20, 180], [10, 90], [3, 0]]) {
        const e = (el * Math.PI) / 180;
        const z = (az * Math.PI) / 180;
        const dx = Math.cos(e) * Math.cos(z);
        const dy = Math.sin(e);
        const dz = Math.cos(e) * Math.sin(z);
        NT.viewRadiance(r, depth, psi, r[NP.F.bottom] + 0.01, dx, dy, dz, L, 200, 1e9, gv, 0, null);
        V.marchAir(r, tabs, 0, r[NP.F.bottom] + 0.01, 0, dx, dy, dz, L.dir[0], L.dir[1], 0, 16, NaN, null, out);
        for (let k = 0; k < 3; k++) w = Math.max(w, Math.abs(out[k] - gv[k]) / Math.max(gv[k], 1e-12));
      }
    }
    return w;
  };
  const wg = worst([1, 1, 1]);
  const ww = worst([1, 0.8, 0.55]);
  // (16 steps through a 15 km haze along the horizon miss the 200-step sum by about a sixth whatever the haze's colour: the
  // viewer's own test-haze names it; held here is that the colour adds no miss of its own)
  ok(wg < 0.2 && ww < 0.2 && Math.abs(ww - wg) < 0.01, `the game's sky and the viewer's march agree on a warm dust (worst ${(ww * 100).toFixed(1)}%) as on a grey haze (${(wg * 100).toFixed(1)}%), over a 15 km haze at ten views, the sun at 30 and 5 degrees: the colour adds no miss of its own`);
}

// ---------------------------------------------------------------- the dials and the fit

{
  const row = NP.airDialsOf('hazetest');
  ok(row.hazeR === 1 && row.hazeG === 1 && row.hazeB === 1 && NP.AIR_DIAL_START.hazeR === 1 && NP.AIR_DIAL_START.hazeG === 1 && NP.AIR_DIAL_START.hazeB === 1, "every world's haze colour dials start grey (1, 1, 1)");
  const v0 = NP.AIR_DIAL_STATE.version;
  const words = NP.tuneAirDials({ hazetest: { hazeR: 1, hazeG: 0.9, hazeB: 1.7 } });
  ok(row.hazeG === 0.9 && row.hazeB === 1 && words.some((w: string) => /hazeB held to 1/.test(w)) && NP.AIR_DIAL_STATE.version === v0 + 1, `a dial moves through the console's line, held to its range (${words.join('; ')}), and the dials' count moves`);
  ok(NP.tuneAirDials({ hazetest: { hazeQ: 1 } }).some((w: string) => /no such dial/.test(w) && /hazeR, hazeG, hazeB/.test(w)), 'an unknown dial is refused and the haze dials are named');
  const r = NP.newAirRecord();
  NP.applyHazeDials('hazetest', r);
  ok(r[NP.F.mieTintR] === 1 && r[NP.F.mieTintG] === 0.9 && r[NP.F.mieTintB] === 1, "a world's dials written into a record");
  NP.setHazeTint(r, -1, 2, 0.5);
  ok(r[NP.F.mieTintR] === 0 && r[NP.F.mieTintG] === 1 && r[NP.F.mieTintB] === 0.5, 'a share is held to [0, 1]');
  ok(NP.recordWords(r).hazeColour.join() === '0,1,0.5', "the report says the record's haze colour");
  // The fit with a colour: every row takes it, the fitted hue and ozone are a grey haze's.
  const sky = { planet: 'naboo', sunElevationDegrees: 67.5, blocks: [{ name: 'global', weatherIndex: 0, ramp: null, fog: { enabled: true, min: 0.0004, max: 0.0008 } }, { name: 'global', weatherIndex: 2, ramp: null, fog: { enabled: true, min: 0.002, max: 0.004 } }] };
  const grey = NF.fitWorld(sky, 30);
  const warm = NF.fitWorld(sky, 30, null, 0.75, 4, [1, 0.8, 0.6]);
  let rowsOk = true;
  for (let i = 0; i < grey.rows.length; i++) {
    const a = grey.rows[i].record;
    const b = warm.rows[i].record;
    for (let f = 0; f < 25; f++) if (!Object.is(a[f], b[f])) rowsOk = false;
    if (b[NP.F.mieTintR] !== 1 || b[NP.F.mieTintG] !== 0.8 || b[NP.F.mieTintB] !== 0.6) rowsOk = false;
  }
  ok(rowsOk && !sameBits(grey.rows[0].psi, warm.rows[0].psi), "the fit hands every row the world's haze colour and leaves its other 25 numbers a grey haze's (the colour is never fitted); its multiple scattering is the coloured haze's own");
  const reply = NF.fitReply({ id: 1, sky, visibilityKm: 30, gradients: {}, hazeTint: [1, 0.8, 0.6] });
  ok(reply.records.every((x: Float64Array) => x[NP.F.mieTintB] === 0.6) && NF.fitReply({ id: 2, sky, visibilityKm: 30, gradients: {} }).records.every((x: Float64Array) => x[NP.F.mieTintB] === 1), "the worker's ask carries the colour, and an ask without one is a grey haze");
}

// ---------------------------------------------------------------- the GPU march and the run, as text

{
  const t = readFileSync(join(NEW, 'sky', 'air', 'airTables.ts'), 'utf8').replace(/\r\n/g, '\n');
  const hits = (s: string): number => t.split(s).length - 1;
  ok(
    hits('mieTint.mul(mieS.mul(m.y))') === 3 && t.includes('this.u5.set(r[F.mieTintR], r[F.mieTintG], r[F.mieTintB]);') && t.includes('const mieTint = live(U.u5);') && t.includes('tl.mul(sR.mul(rayleighPhase(c)).add(sM.mul(miePhase(c)))).add(ps.mul(sR.add(sM)))'),
    "the card's multiple scattering, sky view and haze volume take the haze's scattering times its colour (one uniform written from the record with the rest), and every light's source the coloured scattering; the extinction stays grey (`mieS.add(mieA)`)",
  );
  ok(hits('mieS.add(mieA)') === 1, "the card's extinction is the grey haze's alone");
  const run = readFileSync(join(NEW, 'sky', 'air', 'airRun.ts'), 'utf8');
  ok(/hazeTint: \[this\.hazeSet\[0\], this\.hazeSet\[1\], this\.hazeSet\[2\]\]/.test(run) && /setHazeTint\(this\.base, dials\.hazeR, dials\.hazeG, dials\.hazeB\)/.test(run) && /else if \(ozMoved \|\| hazeMoved\) this\.ask\(\);/.test(run), "the run reads the world's haze dials at its start, hands them to the fit's worker and asks again when they move");
}

console.log(`\nairHazeTint: ${checks} checks passed`);
