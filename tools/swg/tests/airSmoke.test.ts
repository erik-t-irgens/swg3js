// The smoke and ash in the air (the GPU port's pass 2, wave 6, part A; the owner's "Mustafar very clear and different than its
// game and movie counterparts"): a second aerosol layer appended to the air record after the haze's colour (`airParams.ts`'
// `smokeER` .. `glowB`, laid by `airProfile.js`' `smokeInto` from nine dials), its extinction chromatic by an Angstrom
// exponent, its own albedo, phase, height and depth (a tent, as the ozone's), and the lava's glow from below, carried through
// the twin, the fit, the card's tables (as text: node builds no WGSL), the body path and the space rims.
//
// What it holds:
//   - **every world at none is the base's to the bit**: the code the wave was cut from (1b2a6c6) is written out of git and run
//     beside the tree's over every world's record, its column densities, its multiple scattering, its sky radiance at set views
//     under three lights (with the glow's scale set), the twin's frames and the lighting fields written from them, the fit and
//     the worker's reply (asked with the smoke at none), and the body path's own tables, march and keys: every number by
//     `Object.is`;
//   - Mustafar starts at its measured plume and every other world at none; the dials, their ranges and the console's words;
//   - what the layer does: its optical depth is its dial, its extinction goes as its Angstrom exponent, the sun through it
//     reddens and dims more the lower it stands, its column table reads the direct sum, its glow lights the night sky orange,
//     the twin and the viewer's march agree on it as they agree without it, and the fit lays it after the hue and the ozone;
//   - the card's tables, the bodies' cards and the rims read it where the twin does (as text).
//   node tools/swg/tests/airSmoke.test.ts
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

/** The commit the wave was cut from: the air as it was. */
const BASE = '1b2a6c6';
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
const OV = await load(OLD, 'sky/look/airProfile.js');
const OB = await load(OLD, 'sky/bodies/bodyAir.ts');
const NP = await load(NEW, 'sky/air/airParams.ts');
const NT = await load(NEW, 'sky/air/airTwin.ts');
const NF = await load(NEW, 'sky/air/airFit.ts');
const V = await load(NEW, 'sky/look/airProfile.js');
const NB = await load(NEW, 'sky/bodies/bodyAir.ts');
const STARS = await load(NEW, 'sky/stars.ts');
const GD = await load(NEW, 'sky/night/galaxyDensity.ts');

/** Two arrays the same to the bit over their first `n` numbers (every number by `Object.is`). */
function sameBits(a: ArrayLike<number>, b: ArrayLike<number>, n = Math.max(a.length, b.length)): boolean {
  if (a.length < n || b.length < n) return false;
  for (let i = 0; i < n; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}
/** A record's appended twelve at none: noughts but the tent's finite shape. */
function isNone(r: ArrayLike<number>): boolean {
  const F = NP.F;
  for (const k of ['smokeER', 'smokeEG', 'smokeEB', 'smokeSR', 'smokeSG', 'smokeSB', 'glowR', 'glowG', 'glowB']) if (r[F[k]] !== 0) return false;
  return r[F.smokeC] === V.SMOKE_NONE.c && r[F.smokeW] === V.SMOKE_NONE.w && r[F.smokeG] === V.SMOKE_NONE.g;
}

// ---------------------------------------------------------------- the record

ok(OP.AIR_FIELD_COUNT === 28 && NP.AIR_FIELD_COUNT === 40 && NP.HAZE_FIELD_COUNT === 28, `the code the wave was cut from (${BASE}) is written out of git beside the tree's: its record of 28 numbers, the tree's of 40`);
ok(
  Object.entries(OP.F).every(([k, i]) => NP.F[k] === i) && NP.F.smokeER === 28 && NP.F.glowB === 39 && Object.entries(NP.F).every(([k, i]) => V.F[k] === i) && V.AIR_FIELD_COUNT === 40 && V.HAZE_FIELD_COUNT === 28,
  "every number of the old record sits where it sat, the smoke and ash's twelve appended at 28 to 39, the game's layout and the viewer's (the body path's) one",
);
{
  const r = NP.newAirRecord();
  const v = V.newRecord();
  ok(r.length === 40 && sameBits(r, OP.newAirRecord(), 28) && isNone(r) && sameBits(r, v), 'a fresh record is the old one to the bit over its 28 numbers, the layer none after them, the game\'s and the viewer\'s alike');
}

const WORLDS = [...Object.keys(OP.AIR_WORLDS), 'yavin4', 'unknown_world'];
/** A world's record as a run lays it at its start: its base, its visibility, its haze dials and (the tree's) its smoke dials. */
const worldPair = (id: string, vis: number): [Any, Any] => {
  const o = OP.worldRecord(id);
  OP.setVisibility(o, vis);
  OP.applyHazeDials(id, o);
  const n = NP.worldRecord(id);
  NP.setVisibility(n, vis);
  NP.applyHazeDials(id, n);
  return [o, n];
};
// Every world at none: Mustafar's own start moved to none for the comparison, put back after.
const mustStart = { ...NP.airDialsOf('mustafar') };
NP.tuneAirDials({ mustafar: { smokeDepth: 0, glowLux: 0 } });
{
  let all = true;
  for (const id of WORLDS) for (const vis of [40, 7, 1.5]) {
    const [o, n] = worldPair(id, vis);
    if (!sameBits(o, n, 28) || !isNone(n)) all = false;
  }
  ok(all, `every world's record as its run lays it (${WORLDS.length} worlds, three visibilities, its haze dials and its smoke at none) is the old one's 28 numbers to the bit, the layer none`);
}

// ---------------------------------------------------------------- the twin's tables and sums at none, old against new

{
  let depthSame = true;
  let psiSame = true;
  let viewSame = true;
  let views = 0;
  const lightsO = new OT.AirLights();
  const lightsN = new NT.AirLights();
  lightsN.glowScale = 2.4287;
  const outO = new Float64Array(3);
  const outN = new Float64Array(3);
  const trO = new Float64Array(3);
  const trN = new Float64Array(3);
  const smokeN = new Float64Array(NT.SMOKE_FLOATS);
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
    NT.buildPsiTable(n, dN, pN, NT.TWIN_STEPS.psiDirs, NT.TWIN_STEPS.psi, smokeN);
    if (!sameBits(pO, pN)) psiSame = false;
    for (const sunEl of [50, 4, -3]) {
      const se = (sunEl * Math.PI) / 180;
      for (const L of [lightsO, lightsN]) {
        L.count = 3;
        L.dir.set([Math.cos(se), Math.sin(se), 0, Math.cos(se - 0.03), Math.sin(se - 0.03), 0.05, -Math.cos(se), -Math.sin(se), 0.2]);
        L.top.set([1, 0.98, 0.95, 0.4, 0.35, 0.3, 2e-6, 2e-6, 2e-6]);
        L.live.set([1, 1, sunEl < 0 ? 1 : 0]);
      }
      for (const [el, az] of [[90, 0], [45, 0], [20, 180], [10, 90], [3, 0], [1, 30], [-2, 0], [-20, 120], [60, 270]]) {
        const e = (el * Math.PI) / 180;
        const z = (az * Math.PI) / 180;
        for (const maxT of [Infinity, 3.5]) {
          OT.viewRadiance(o, dO, pO, o[OP.F.bottom] + 0.02, Math.cos(e) * Math.cos(z), Math.sin(e), Math.cos(e) * Math.sin(z), lightsO, 24, maxT, outO, 0, trO);
          NT.viewRadiance(n, dN, pN, n[NP.F.bottom] + 0.02, Math.cos(e) * Math.cos(z), Math.sin(e), Math.cos(e) * Math.sin(z), lightsN, 24, maxT, outN, 0, trN, smokeN);
          views++;
          if (!sameBits(outO, outN) || !sameBits(trO, trN)) viewSame = false;
        }
      }
    }
  }
  ok(depthSame, `every world's column densities are the old ones to the bit (${WORLDS.length} worlds, 256 by 64)`);
  ok(psiSame, "every world's multiple scattering is the old one's to the bit with the smoke at none (its column table handed, nought)");
  ok(viewSame, `the sky's radiance and transmittance are the old ones to the bit at ${views} views with the smoke at none and the glow's scale set (every world, the sun 50, 4 and -3 degrees up, three lights, to the top and to 3.5 km)`);
}

// The twin's whole frame (its sliced sums, the frame's own register path, the glow's scale set) and the lighting it writes.
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
    tN.glowScale = 2.4287;
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
  ok(same, `the twin's ${frames} frames (five worlds, the sun from 60 degrees up to 10 under, its sums sliced as a frame slices them, the glow's scale set) and the lighting fields written from them are the old ones to the bit with the smoke at none`);
}

// The fit, and the worker's reply asked with the smoke at none.
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
const fitRows = (blue: [number, number, number], dusk: [number, number, number]) => [
  { name: 'global', weatherIndex: 0, ramp: { rows: 8, rgba: ramp(blue, dusk) }, fog: { enabled: true, min: 0.0004, max: 0.0008 } },
  { name: 'global', weatherIndex: 1, ramp: { rows: 8, rgba: ramp(blue, dusk) }, fog: { enabled: true, min: 0.002, max: 0.004 } },
  { name: 'desert', weatherIndex: 0, ramp: { rows: 8, rgba: ramp([150, 170, 210], [90, 60, 110]) }, fog: { enabled: false, min: 0, max: 0 } },
];
{
  let same = true;
  let n = 0;
  const none = { ...V.SMOKE_DIAL_START };
  for (const [id, blue, dusk] of [
    ['tatooine', [120, 160, 230], [80, 60, 120]],
    ['naboo', [90, 150, 240], [60, 70, 140]],
    ['mustafar', [140, 100, 90], [90, 40, 30]],
  ] as [string, [number, number, number], [number, number, number]][]) {
    const sky = { planet: id, sunElevationDegrees: 67.5, blocks: fitRows(blue, dusk) };
    const a = OF.fitWorld(sky, 40);
    const b = NF.fitWorld(sky, 40, null, 0.75, 4, [1, 1, 1], null, none);
    if (a.rows.length !== b.rows.length || !sameBits(a.depth, b.depth)) same = false;
    for (let i = 0; i < a.rows.length; i++) {
      n++;
      const ra = a.rows[i];
      const rb = b.rows[i];
      if (!sameBits(ra.record, rb.record, 28) || !isNone(rb.record) || !sameBits(ra.psi, rb.psi) || ra.distinct !== rb.distinct) same = false;
      if (!sameBits(ra.tint, rb.tint) || !Object.is(ra.ozone, rb.ozone)) same = false;
    }
    const ro = OF.fitReply({ id: 1, sky, visibilityKm: 40, gradients: {} });
    const rn = NF.fitReply({ id: 1, sky, visibilityKm: 40, gradients: {}, smoke: none });
    for (let i = 0; i < ro.records.length; i++) if (!sameBits(ro.records[i], rn.records[i], 28) || !sameBits(ro.psis[i], rn.psis[i])) same = false;
  }
  ok(same, `the fit's ${n} rows over three worlds and the worker's replies, asked with the smoke at none, are the old ones to the bit (records over their 28, tables and words), the layer none in every row`);
}

// The body path at none: the viewer's own tables, march and reference, and the bodies' keys (the bake cache finds them again).
{
  let same = true;
  let keys = true;
  const o6 = new Float64Array(6);
  const n6 = new Float64Array(6);
  for (const id of ['naboo', 'tatooine', 'mustafar', 'corellia']) {
    const o = OB.bodyRecord({ kind: 'world', world: id });
    const n = NB.bodyRecord({ kind: 'world', world: id });
    if (!sameBits(o, n, 28) || !isNone(n)) same = false;
    if (OB.bodyTablesKey(o) !== NB.bodyTablesKey(n) || OV.recordKey(o) !== V.recordKey(n)) keys = false;
    const to = OV.makeTables(o);
    const tn = V.makeTables(n);
    if (!sameBits(to.T, tn.T) || !sameBits(to.MS, tn.MS) || !sameBits(to.E, tn.E) || to.key !== tn.key) same = false;
    const b = n[NP.F.bottom];
    for (const [ox, oy, oz, dx, dy, dz] of [[0, 0, b * 3, 0, 0, -1], [b * 1.004, 0, b * 3, 0, 0, -1], [0, b + 0.01, 0, 0.9, 0.3, 0.3]]) {
      const l = Math.SQRT1_2;
      OV.marchAir(o, to, ox, oy, oz, dx, dy, dz, l, l, 0, 12, NaN, null, o6, 1.5);
      V.marchAir(n, tn, ox, oy, oz, dx, dy, dz, l, l, 0, 12, NaN, null, n6, 1.5);
      if (!sameBits(o6, n6)) same = false;
      OV.marchDirect(o, to, ox, oy, oz, dx, dy, dz, l, l, 0, 64, NaN, o6, 40);
      V.marchDirect(n, tn, ox, oy, oz, dx, dy, dz, l, l, 0, 64, NaN, n6, 40);
      if (!sameBits(o6, n6)) same = false;
    }
  }
  ok(same, "the body path at none (four worlds' bodies: the viewer's transmittance, multiple scattering and ground light tables, its march at the game's lay and its direct reference) is the old one's to the bit");
  ok(keys, "a body's tables and the viewer's tables are keyed as before at none (`recordLength` 28), so every bake the browser kept is found again");
  const look = V.recordOf({ mode: 'scattered', visibilityKm: 14, hazeColour: '#fff3e4' });
  const lookO = OV.recordOf({ mode: 'scattered', visibilityKm: 14, hazeColour: '#fff3e4' });
  ok(sameBits(look, lookO, 28) && isNone(look) && V.recordKey(look) === OV.recordKey(lookO), "a look's air with no smoke dials makes the old record and key");
}

// ---------------------------------------------------------------- the dials

NP.tuneAirDials({ mustafar: { smokeDepth: mustStart.smokeDepth, glowLux: mustStart.glowLux } });
{
  const m = NP.airDialsOf('mustafar');
  const s = NP.SMOKE_STARTS.mustafar;
  ok(m.smokeDepth === 1 && m.smokeAngstrom === 1 && m.smokeAlbedo === 0.85 && m.smokeBrown === 1.5 && m.smokeHeightKm === 3 && m.smokeThickKm === 5 && m.smokeG === 0.7 && m.glowLux === 1 && m.glowKelvin === 1250 && s.smokeDepth === 1, "Mustafar starts at its measured plume (depth 1, Angstrom 1, albedo 0.85, brown 1.5, 3 km up, 5 km deep, g 0.7) and a glow of 1 lux at 1,250 K");
  let others = true;
  for (const id of WORLDS) if (id !== 'mustafar' && (NP.airDialsOf(id).smokeDepth !== 0 || NP.airDialsOf(id).glowLux !== 0)) others = false;
  ok(others && NP.AIR_DIAL_START.smokeDepth === 0 && NP.AIR_DIAL_START.glowLux === 0, 'every other world starts at none (a depth and a glow of nought)');
  const row = NP.airDialsOf('smoketest');
  const words = NP.tuneAirDials({ smoketest: { smokeDepth: 9, smokeAngstrom: -2, glowKelvin: 1200, smokeThickKm: 0 } });
  ok(row.smokeDepth === 6 && row.smokeAngstrom === -0.5 && row.glowKelvin === 1200 && row.smokeThickKm === 0.2 && words.some((w: string) => /smokeDepth held to 6/.test(w)), `the smoke dials move through the console's line, held to their ranges (${words.join('; ')})`);
  ok(NP.tuneAirDials({ smoketest: { smokeQ: 1 } }).some((w: string) => /no such dial/.test(w) && /smokeDepth/.test(w) && /glowKelvin/.test(w)), 'an unknown dial is refused and the smoke dials are named');
  const dials = await load(NEW, 'sky/air/airDials.ts');
  const g = dials.airDialGroup('mustafar', 'Mustafar');
  const keys = g.dials.map((d: Any) => d.key);
  ok(['smokeDepth', 'smokeAngstrom', 'smokeAlbedo', 'smokeBrown', 'smokeHeightKm', 'smokeThickKm', 'smokeG', 'glowLux', 'glowKelvin'].every((k) => keys.includes(`air.mustafar.${k}`)) && g.dials.every((d: Any) => typeof d.note === 'string' && d.note.length > 20), "the sky helper's \"The air of Mustafar\" holds the nine dials, each with its start and reason");
  const viewer = V.AIR_DIALS.filter((d: Any) => V.SMOKE_DIAL_NAMES.includes(d.k));
  ok(viewer.length === 9 && viewer.every((d: Any) => d.group === 'air' && d.def === V.SMOKE_DIAL_START[d.k] && d.min === V.SMOKE_DIAL_RANGE[d.k][0] && d.max === V.SMOKE_DIAL_RANGE[d.k][1]) && viewer.filter((d: Any) => d.struct).map((d: Any) => d.k).join() === 'smokeDepth,glowLux', "the viewer's air box carries the same nine (none to start), its depth and glow rebuilding a look (its graph gains the layer only where it has one)");
}

// ---------------------------------------------------------------- what the layer is

{
  const r = NP.newAirRecord();
  NP.setSmoke(r, NP.smokeStartOf('mustafar'));
  const F = NP.F;
  // Its vertical optical depth from the ground up at 550 nm is the dial (the green's coefficient times the tent's column).
  const c = r[F.smokeC];
  const w = r[F.smokeW];
  let col = 0;
  for (let i = 0; i < 20000; i++) {
    const h = ((i + 0.5) / 20000) * 40;
    col += V.smokeDensity(c, w, h) * (40 / 20000);
  }
  ok(Math.abs(r[F.smokeEG] * col - 1) < 1e-4, `the layer's vertical optical depth at 550 nm is its dial (${(r[F.smokeEG] * col).toFixed(5)} for 1)`);
  const ratio = (a: number, b: number) => Math.log(a / b);
  const aRB = -ratio(r[F.smokeER], r[F.smokeEB]) / ratio(680, 440);
  ok(Math.abs(aRB - 1) < 1e-12 && r[F.smokeEB] > r[F.smokeEG] && r[F.smokeEG] > r[F.smokeER], `its extinction goes as (lambda / 550)^-1 (the exponent read back from red and blue: ${aRB.toFixed(12)}), the blue dimmed most`);
  ok(Math.abs(r[F.smokeSG] / r[F.smokeEG] - 0.85) < 1e-12 && r[F.smokeSB] / r[F.smokeEB] < r[F.smokeSG] / r[F.smokeEG] && r[F.smokeSG] / r[F.smokeEG] < r[F.smokeSR] / r[F.smokeER], `its albedo in the green is its dial (${(r[F.smokeSG] / r[F.smokeEG]).toFixed(3)}), lower in the blue and higher in the red (brown: ${(r[F.smokeSB] / r[F.smokeEB]).toFixed(3)}, ${(r[F.smokeSR] / r[F.smokeER]).toFixed(3)})`);
  const rgb = [0, 0, 0];
  STARS.kelvinToLinear(1250, rgb);
  const bb = [0, 0, 0];
  V.blackBody(1250, bb);
  ok(sameBits(rgb, bb) && V.SMOKE_SUN_LUX === GD.SUN_LUX && Math.abs(r[F.glowG] - (rgb[1] * 1) / GD.SUN_LUX) < 1e-18 && r[F.glowR] > r[F.glowG] && r[F.glowG] > r[F.glowB], "its glow is the dial's lux over the top-of-air sun's (128,000) in a black body's colour at 1,250 K (the viewer's black body the star table's to the bit): orange");
  const z = NP.newAirRecord();
  NP.setSmoke(z, { ...NP.smokeStartOf('mustafar'), smokeDepth: 0, glowLux: 0 });
  ok(isNone(z) && !NP.smokeOn(z), 'a depth and a glow of nought lay none, whatever the other dials say');
}

// The sun through it at Mustafar, noon to dusk: the twin's table against the direct sum, the reddening and dimming by height.
const MUST = (): [Any, Any] => {
  const base = NP.worldRecord('mustafar');
  NP.setVisibility(base, 40);
  NP.applyHazeDials('mustafar', base);
  const none = Float64Array.from(base);
  NP.setSmoke(none, V.SMOKE_DIAL_START);
  return [base, none];
};
{
  const [rec, none] = MUST();
  ok(NP.smokeOn(rec) && isNone(none) && sameBits(rec, none, 28), "Mustafar's record as its run lays it carries its plume after the 28 numbers the air had");
  const depth = new Float64Array(NT.DEPTH_FLOATS);
  NT.buildDepthTable(rec, depth);
  const smoke = new Float64Array(NT.SMOKE_FLOATS);
  NT.buildSmokeTable(rec, smoke);
  const t = new Float64Array(3);
  const u = new Float64Array(3);
  const od = new Float64Array(3);
  let worst = 0;
  const rows: string[] = [];
  let lastRB = 0;
  let redder = true;
  for (const el of [67.5, 30, 10, 4, 1.5]) {
    const mu = Math.sin((el * Math.PI) / 180);
    const r0 = rec[NP.F.bottom] + 0.01;
    NT.lightTransmittance(rec, depth, r0, mu, t, 0, smoke);
    NT.lightTransmittance(none, depth, r0, mu, u, 0);
    NT.opticalDepth(rec, r0, mu, 2000, od, 0);
    for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(t[k] - Math.exp(-od[k])) / Math.max(Math.exp(-od[k]), 1e-6));
    const rb = (t[0] / t[2]) / (u[0] / u[2]);
    if (!(rb > lastRB)) redder = false;
    lastRB = rb;
    rows.push(`${el} deg: ${(100 * (0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2])).toFixed(1)}% (without ${(100 * (0.2126 * u[0] + 0.7152 * u[1] + 0.0722 * u[2])).toFixed(1)}%), red over blue x${rb.toFixed(2)}`);
  }
  ok(worst < 0.02, `the twin's sun through the plume (its column tables, read as a frame reads them) is the direct sum's within ${(worst * 100).toFixed(2)}% from noon to 1.5 degrees`);
  ok(redder && lastRB > 3, `the sun reddens and dims through the plume more the lower it stands: ${rows.join('; ')}`);
}

// The night sky over the lava: the glow lights the sky orange; and the twin agrees with the viewer's march on the layer.
{
  const [rec, none] = MUST();
  const depth = new Float64Array(NT.DEPTH_FLOATS);
  NT.buildDepthTable(rec, depth);
  const smoke = new Float64Array(NT.SMOKE_FLOATS);
  NT.buildSmokeTable(rec, smoke);
  const psi = new Float64Array(NT.PSI_FLOATS);
  NT.buildPsiTable(rec, depth, psi, NT.TWIN_STEPS.psiDirs, NT.TWIN_STEPS.psi, smoke);
  const psiN = new Float64Array(NT.PSI_FLOATS);
  NT.buildPsiTable(none, depth, psiN);
  const L = new NT.AirLights();
  L.count = 1;
  L.live[0] = 0;
  L.glowScale = 2.4287;
  const up = new Float64Array(3);
  const upN = new Float64Array(3);
  NT.viewRadiance(rec, depth, psi, rec[NP.F.bottom] + 0.01, 0, 1, 0, L, 200, 1e9, up, 0, null, smoke);
  NT.viewRadiance(none, depth, psiN, none[NP.F.bottom] + 0.01, 0, 1, 0, L, 200, 1e9, upN, 0, null);
  const cdm = (v: Float64Array) => ((0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]) * GD.SUN_LUX) / 2.4287;
  ok(upN[0] === 0 && up[0] > 0 && up[1] / up[0] < 0.5 && up[2] <= up[1] && cdm(up) > 0.005 && cdm(up) < 0.5, `with no sun or moon the zenith over the lava glows orange-red (${cdm(up).toPrecision(3)} cd/m2, green and blue over red ${(up[1] / up[0]).toFixed(3)}, ${(up[2] / up[0]).toFixed(3)}; a moonlit sky is about 0.002), where the air without the layer and glow is black`);
  L.glowScale = 0;
  const off = new Float64Array(3);
  NT.viewRadiance(rec, depth, psi, rec[NP.F.bottom] + 0.01, 0, 1, 0, L, 200, 1e9, off, 0, null, smoke);
  ok(off[0] === 0 && off[1] === 0 && off[2] === 0, 'the glow is the lava\'s alone: with its scale at nought the night sky is black again');
  // The twin, the viewer's march (the body path) and the viewer's direct reference on the layer, from Mustafar's ground: the
  // single scattering alone (each one's multiple-scattering table at nought), then with it.
  const tabs = V.makeTables(rec);
  const L2 = new NT.AirLights();
  const out = new Float64Array(6);
  const dir = new Float64Array(6);
  const gv = new Float64Array(3);
  const zeroPsi = new Float64Array(NT.PSI_FLOATS);
  const views = (single: boolean): { twin: number; march: number } => {
    const tb = single ? { ...tabs, MS: new Float32Array(tabs.MS.length) } : tabs;
    let tw = 0;
    let mw = 0;
    for (const sunEl of [40, 12]) {
      const se = (sunEl * Math.PI) / 180;
      L2.count = 1;
      L2.live[0] = 1;
      L2.dir.set([Math.cos(se), Math.sin(se), 0, 0, 0, 0, 0, 0, 0]);
      L2.top.set([1, 1, 1, 0, 0, 0, 0, 0, 0]);
      L2.glowScale = 1;
      for (const [el, az] of [[90, 0], [45, 0], [30, 180], [20, 90], [5, 0], [5, 180]]) {
        const e = (el * Math.PI) / 180;
        const z = (az * Math.PI) / 180;
        const dx = Math.cos(e) * Math.cos(z);
        const dy = Math.sin(e);
        const dz = Math.cos(e) * Math.sin(z);
        NT.viewRadiance(rec, depth, single ? zeroPsi : psi, rec[NP.F.bottom] + 0.01, dx, dy, dz, L2, 400, 1e9, gv, 0, null, smoke);
        V.marchAir(rec, tb, 0, rec[NP.F.bottom] + 0.01, 0, dx, dy, dz, L2.dir[0], L2.dir[1], 0, 64, NaN, null, out, 1.5);
        V.marchDirect(rec, tb, 0, rec[NP.F.bottom] + 0.01, 0, dx, dy, dz, L2.dir[0], L2.dir[1], 0, 2000, NaN, dir, 200, !single);
        for (let k = 0; k < 3; k++) tw = Math.max(tw, Math.abs(gv[k] - dir[k]) / dir[k]);
        // (the march by its luminance, and within 15%: its transmittance table is the viewer's 128 by 32, whose rows by
        // Bruneton's mapping stand about 2.6 and 6.6 km up, so a point inside the plume reads the sun's light through it
        // interpolated across three or four rows where the twin's 64 have ten; the body path draws bodies seen from afar)
        const lum = (v: Float64Array) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
        mw = Math.max(mw, Math.abs(lum(out) - lum(dir)) / lum(dir));
      }
    }
    return { twin: tw, march: mw };
  };
  const s1 = views(true);
  ok(s1.twin < 0.02 && s1.march < 0.15, `the layer's single scattering from the ground: the twin's 400-step sum is the direct reference's within ${(s1.twin * 100).toFixed(1)}% and the viewer's 64-step march within ${(s1.march * 100).toFixed(1)}% (twelve views, the sun at 40 and 12 degrees, its light reddened through the plume)`);
  const s2 = views(false);
  // (the twin's multiple-scattering table is 16 heights over Mustafar's 100 km of air, so the plume's 5 km lies inside one row
  // and its share is smeared with the clear air's above; the card's and the viewer's are 32 high. The twin lights the world
  // (the sun, the hemisphere, the fog colour), never draws the sky: that is the card's, whose table is the viewer's size.)
  ok(s2.march < 0.15 && s2.twin < 0.4, `with the multiple scattering the march still reads the direct reference within ${(s2.march * 100).toFixed(1)}% (one table), the twin within ${(s2.twin * 100).toFixed(1)}% (its own coarser table: said, not mended, as it holds every world without the layer to the bit)`);
  // The glow alone through both: the march's glow (per unit of the record's sun, strength 1 here) against the twin's at a scale of 1.
  L2.live[0] = 0;
  L2.glowScale = 1;
  NT.viewRadiance(rec, depth, psi, rec[NP.F.bottom] + 0.01, 0, 1, 0, L2, 400, 1e9, gv, 0, null, smoke);
  V.marchAir(rec, tabs, 0, rec[NP.F.bottom] + 0.01, 0, 0, 1, 0, 0, -1, 0, 64, NaN, null, out, 1.5);
  V.marchDirect(rec, tabs, 0, rec[NP.F.bottom] + 0.01, 0, 0, 1, 0, 0, -1, 0, 2000, NaN, dir, 200, false);
  const gw = Math.max(...[0, 1].map((k) => Math.abs(gv[k] - dir[k]) / dir[k]));
  const gm = Math.max(...[0, 1].map((k) => Math.abs(out[k] - dir[k]) / dir[k]));
  ok(rec[NP.F.sunStrength] === 1 && gw < 0.02 && gm < 0.05, `the glow from below alone at the zenith (no sun): the twin within ${(gw * 100).toFixed(2)}% and the march within ${(gm * 100).toFixed(2)}% of the direct reference`);
  ok(!sameBits(psi, psiN), "the layer's multiple scattering is its own (the table differs from the air without it)");
}

// The fit lays the layer after the hue and the ozone: the first 28 numbers are what the air without it fits to.
{
  const sky = { planet: 'mustafar', sunElevationDegrees: 67.5, blocks: fitRows([140, 100, 90], [90, 40, 30]) };
  const plain = NF.fitWorld(sky, 30);
  const plume = NF.fitWorld(sky, 30, null, 0.75, 4, [1, 1, 1], null, NP.smokeStartOf('mustafar'));
  let rowsOk = true;
  for (let i = 0; i < plain.rows.length; i++) {
    if (!sameBits(plain.rows[i].record, plume.rows[i].record, 28) || !NP.smokeOn(plume.rows[i].record)) rowsOk = false;
    if (sameBits(plain.rows[i].psi, plume.rows[i].psi)) rowsOk = false;
  }
  ok(rowsOk, "the fit hands every row the world's layer and leaves its 28 numbers the air without it fits to (the layer is never fitted); its multiple scattering is the layer's own");
  const reply = NF.fitReply({ id: 3, sky, visibilityKm: 30, gradients: {}, smoke: NP.smokeStartOf('mustafar') });
  ok(reply.records.every((x: Float64Array) => NP.smokeOn(x)) && NF.fitReply({ id: 4, sky, visibilityKm: 30, gradients: {} }).records.every((x: Float64Array) => !NP.smokeOn(x)), "the worker's ask carries the layer, and an ask without one is none");
}

// A body showing Mustafar carries its plume (its record at its dials), the viewer's look air its own, Save to game the dials.
{
  const b = NB.bodyRecord({ kind: 'world', world: 'mustafar' });
  ok(NP.smokeOn(b) && NB.bodyTablesKey(b).startsWith('air-40:'), "a body showing Mustafar carries its plume, keyed by all 40 numbers");
  const look = V.recordOf({ mode: 'scattered', smokeDepth: 0.8, smokeAngstrom: 1.8, glowLux: 2 });
  ok(V.hasSmoke(look) && look[V.F.smokeEB] > look[V.F.smokeER] * 2 && look[V.F.glowR] > 0, "a look's own air takes the smoke dials (a fine smoke's blue dimmed over twice its red)");
  const BF = await load(NEW, 'sky/look/bodiesFile.ts');
  const g = BF.gameAirOf({ visibilityKm: 12, smokeDepth: 0.7, glowKelvin: 99999, hazeG: 0.6 });
  ok(g.dials.smokeDepth === 0.7 && g.dials.glowKelvin === 3000 && g.dials.glow === 0.6 && BF.gameAirOf({ visibilityKm: 12 }).dials.smokeDepth === undefined, "Save to game's air carries the smoke dials to the world's of the same names, held to their ranges; a look naming none leaves the world's own");
}

// ---------------------------------------------------------------- the card, the bodies and the rims, as text

{
  const t = readFileSync(join(NEW, 'sky', 'air', 'airTables.ts'), 'utf8').replace(/\r\n/g, '\n');
  const hits = (s: string): number => t.split(s).length - 1;
  ok(
    t.includes('this.u6.set(r[F.smokeER], r[F.smokeEG], r[F.smokeEB], r[F.smokeC]);') && t.includes('this.u8.set(r[F.glowR] * k, r[F.glowG] * k, r[F.glowB] * k, r[F.smokeG]);') && t.includes('const k = AIR_UNITS.scene;'),
    "the card's uniforms are written from the record with the rest, the glow in the scene's units",
  );
  ok(
    hits('.add(smokeE.mul(dS))') === 3 && hits('lightSource(p, rr, d, sunDir, sunTop, sR, sM, sS)') === 2 && hits('.mul(glowAt(rr.sub(bottom)))') === 2 && t.includes('exp(depth.negate().sub(smokeE.mul(smokeCol.mul(sdt))))') && t.includes('Loop({ start: 0, end: SMOKE_STEPS') && t.includes('.add(smokeS.mul(dS)).toVar(\'airMSS\')'),
    "the card's transmittance, multiple scattering, sky view and haze volume add the layer's extinction after the rest, the light's source its own scattering by its phase, and the two marches the glow from below: the haze on solids and the fog node read the haze volume, so they carry it",
  );
  for (const [file, what] of [
    [join(NEW, 'sky', 'bodies', 'skyBody.ts'), "the sky's bodies' cards"],
    [join(NEW, 'space', 'spaceRims.ts'), "space's rims"],
  ]) {
    const s = readFileSync(file, 'utf8');
    ok(/smokeE: a6\.xyz, smokeC: a6\.w, smokeS: a7\.xyz, smokeW: a7\.w, glow: a8\.xyz, smokeG: a8\.w/.test(s) && /const s = smokeUniformValues\(rec\);/.test(s), `${what} hand the body path the layer from the record`);
  }
  const b = readFileSync(join(NEW, 'sky', 'look', 'build.js'), 'utf8');
  ok(/if \(hasSmoke\(rec\)\) \{\n\s+U\.smokeE = uniform/.test(b.replace(/\r\n/g, '\n')), "the viewer's looks gain the layer's uniforms only where their record has one (every other look's graph as it was)");
}

// ---------------------------------------------------------------- wave 4b's leftover: space's exposure (the same wave's part A)

{
  const ER = await load(NEW, 'sky/exposure/eyeRun.ts');
  const EM = await load(NEW, 'sky/exposure/eyeMath.ts');
  const run = (space: boolean, air: boolean): { mode: number; exposure: number; glow: number; renderer: number } => {
    Object.assign(ER.EYE_IN, { dt: 0.016, air, chain: true, eye: true, adapt: 1, stops: 0, loading: false, level: 1e-6, space });
    ER.eyeFrameRun();
    return { mode: ER.EYE_OUT.mode, exposure: ER.EYE_OUT.exposure, glow: ER.EYE_OUT.glow, renderer: ER.EYE_OUT.renderer };
  };
  const ground = run(false, false);
  const sp = run(true, false);
  ok(ground.mode === 0 && ground.exposure === 1 && ground.glow === 1, 'a world with no air and SWG\'s sky keep today\'s exposure of 1');
  ok(ER.SPACE_EYE.stops === 3 && sp.mode === 0 && sp.exposure === 8 && Math.abs(sp.glow - 2 ** (-EM.EYE_TUNE.glow * 3)) < 1e-15 && sp.renderer === 1, `space reads at its dial's 3 stops (an exposure of ${sp.exposure}, emissives compensated by ${sp.glow}), written into the eye's buffer as the card does not adapt there`);
  ER.tuneSpaceEye({ stops: 0 });
  const zero = run(true, false);
  ok(zero.exposure === 1 && zero.glow === 1, 'at 0 stops space is today\'s exposure of 1 to the bit');
  const words = ER.tuneSpaceEye({ stops: 99, other: 1 });
  ok(ER.SPACE_EYE.stops === 6 && words.some((w: string) => /held to 6/.test(w)) && words.some((w: string) => /no such dial/.test(w)), `the dial is held to its range and an unknown one refused (${words.join('; ')})`);
  ER.tuneSpaceEye({ stops: 3 });
  const onGround = run(true, true);
  ok(onGround.mode === 2, 'a world whose air draws adapts on the card whatever the space flag says');
  const main = readFileSync(join(REPO, 'src', 'main.ts'), 'utf8');
  ok(main.includes('e.space = !!this.world.planet?.space;') && main.includes("if (o && typeof o === 'object' && 'space' in o) said.push(...tuneSpaceEye(o.space));"), "the frame hands the eye whether it stands in space, and `exposure({ space: { stops } })` moves the dial");
}

console.log(`\nairSmoke: ${checks} checks passed`);
