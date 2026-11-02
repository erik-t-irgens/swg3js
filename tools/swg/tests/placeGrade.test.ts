// A place's colour-grade look (Map-maker II's ninth wave, DESIGN.md §12): the look a place of ours names (the locations
// file's `grade`, the world row's under every place's) eased in over the planet's own and out again, field by field
// (`PlaceGradeEase`, `gradeMath.ts`, the grade's own mirror), by the real colour grade pass (`grade.ts`, loaded under the
// off-proof's hook). Held here:
//
//   1. no place's look, the planet's own look itself, by identity, every frame;
//   2. a look eased in over its time constant, each field `planet + (place − planet)(1 − e^(−t/τ))`, a field it does not set
//      left the planet's to the bit, the same at 60 and 144 frames a second; the weight the same ease toward one; a cut and a
//      time constant of nought at once; eased out again to the planet's own look by identity; a hand-over from one place's
//      look to another's at a weight of one;
//   3. the real pass: with no place's look, every uniform it writes dd994e9's own pass's, frame for frame, by `Object.is`;
//      with one, its uniforms come to those of the place's look laid over the planet's (the console's look written so) and
//      its strength reaches the amount; the console's look stands over a place's; the report names the weight;
//   4. the hand-overs only the game makes, as text: the frame input's look, the context's copy, the pass's ease.
//
// Run: node tools/swg/tests/placeGrade.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO, extractOldSrc } from './airTrees.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const BASE = 'dd994e9';
/** The pass's day-one trace's hash as dd994e9's pass made it, for a checkout git cannot answer. */
const BASE_TRACE = '248d25679b2f';

const NEW = join(REPO, 'src');
let OLD: string | null = null;
try {
  OLD = extractOldSrc(BASE);
} catch {
  OLD = null;
}
process.on('exit', () => {
  if (OLD) rmSync(dirname(OLD), { recursive: true, force: true });
});
register(pathToFileURL(join(REPO, 'tools', 'swg', 'tests', 'airLoader.mjs')).href, import.meta.url, { data: { roots: OLD ? [OLD, NEW] : [NEW], packageBase: join(REPO, 'package.json') } });
type Mod = Record<string, unknown>;
const load = async (root: string, p: string): Promise<Mod> => (await import(pathToFileURL(join(root, p)).href)) as Mod;
const THREE = (await import('three')) as typeof import('three');
const GM = (await load(NEW, 'core/fx/gradeMath.ts')) as typeof import('../../../src/core/fx/gradeMath.ts');
const G = (await load(NEW, 'core/fx/grade.ts')) as typeof import('../../../src/core/fx/grade.ts');
const OldG = OLD ? await load(OLD, 'core/fx/grade.ts') : null;
const text = (p: string): string => readFileSync(join(NEW, p), 'utf8').replace(/\r\n/g, '\n');

type Look = import('../../../src/core/fx/gradeMath.ts').GradeLook;
const FIELDS = ['gloom', 'heat', 'warmth', 'cool', 'saturation', 'contrast', 'strength'] as const;
const planetOf = (look: Look | undefined, k: (typeof FIELDS)[number]): number => look?.[k] ?? (k === 'strength' ? 1 : 0);

/** One frame of the ease, its inputs written as the pass writes them. */
function step(e: InstanceType<typeof GM.PlaceGradeEase>, planet: Look | undefined, place: Look | null, dt: number, tau: number, cut = false): Look | undefined {
  e.dt = dt;
  e.tau = tau;
  e.cut = cut;
  return e.step(planet, place);
}

// ---- 1. no place's look ----
{
  let same = true;
  for (const planet of [undefined, GM.GRADE_LOOKS.tatooine, GM.GRADE_LOOKS.dathomir, GM.GRADE_LOOKS.mustafar]) {
    const e = new GM.PlaceGradeEase();
    for (let f = 0; f < 200; f++) if (step(e, planet, null, 1 / 60, 2) !== planet) same = false;
    if (e.live || e.weight !== 0) same = false;
  }
  ok(same, "with no place's look the planet's own look itself, by identity, every frame (and none for a planet with none)");
}

// ---- 2. the ease ----
{
  const planet = GM.GRADE_LOOKS.tatooine;
  const place: Look = { gloom: 0.6, saturation: -0.1, strength: 0.5 };
  const run = (fps: number, seconds: number, tau: number): InstanceType<typeof GM.PlaceGradeEase> => {
    const e = new GM.PlaceGradeEase();
    const n = Math.round(fps * seconds);
    for (let f = 0; f < n; f++) step(e, planet, place, 1 / fps, tau);
    return e;
  };
  const e60 = run(60, 2, 2);
  const w = 1 - Math.exp(-1);
  let fields = true;
  for (const k of FIELDS) {
    const p = planetOf(planet, k);
    const want = place[k] !== undefined ? p + (place[k]! - p) * w : p;
    // A frame's ease starts from the planet's own the first time: the first frame's step is 1 − e^(−dt/τ) as every other.
    if (Math.abs(e60.look[k] - want) > 1e-12) fields = false;
  }
  ok(fields, 'two seconds into a place at a time constant of two, each field the planet\'s plus (the place\'s − the planet\'s)(1 − 1/e)');
  ok(Object.is(e60.look.warmth, planet.warmth) && Object.is(e60.look.heat, 0) && Object.is(e60.look.contrast, 0), "a field the place does not set is the planet's own to the bit");
  ok(Math.abs(e60.weight - w) < 1e-12 && e60.live, `the weight eased the same way toward one (${e60.weight.toFixed(4)})`);
  const e144 = run(144, 2, 2);
  ok(FIELDS.every((k) => Math.abs(e144.look[k] - e60.look[k]) < 1e-12) && Math.abs(e144.weight - e60.weight) < 1e-12, 'the same at 144 frames a second as at 60');
  const cut = new GM.PlaceGradeEase();
  const atOnce = step(cut, planet, place, 1 / 60, 2, true)!;
  ok(atOnce.gloom === 0.6 && atOnce.saturation === -0.1 && atOnce.strength === 0.5 && cut.weight === 1, 'a cut takes the place\'s look at once');
  const zero = new GM.PlaceGradeEase();
  ok(step(zero, planet, place, 1 / 60, 0)!.gloom === 0.6, 'and so does a time constant of nought');
  // Out again.
  const out = run(60, 30, 2);
  let back: Look | undefined;
  let frames = 0;
  for (; frames < 6000; frames++) {
    back = step(out, planet, null, 1 / 60, 2);
    if (back === planet) break;
  }
  ok(back === planet && !out.live && out.weight === 0, `walked out, eased back to the planet's own look by identity (after ${(frames / 60).toFixed(1)} s, the weight under ${GM.PLACE_GRADE_DONE})`);
  // A hand-over: from one place's look to another's, at a weight of one.
  const a = run(60, 30, 2);
  const other: Look = { gloom: 0.1, heat: 0.4 };
  let least = 1;
  for (let f = 0; f < 600; f++) {
    step(a, planet, other, 1 / 60, 2);
    least = Math.min(least, a.weight);
  }
  ok(least > 0.999 && Math.abs(a.look.gloom - 0.1) < 0.01 && Math.abs(a.look.heat - 0.4) < 0.01 && Math.abs(a.look.saturation - planet.saturation!) < 0.01, 'from one place\'s look into another\'s the weight stays one while the fields ease across (the planet\'s own for a field the next does not set)');
}

// ---- 3. the real pass ----
type Pass = { prepare(ctx: unknown): void; report(ctx: unknown): Record<string, unknown>; lookOverride: Look | null; material: import('three').ShaderMaterial };
const lighting = (k: number) => ({ main: new THREE.Color(1, 0.9 - 0.1 * k, 0.7), mainScale: 1.2 + k, ambient: new THREE.Color(0.3, 0.35, 0.45), ambientScale: 0.8, clear: new THREE.Color(0.5, 0.6, 0.8) });
function ctxOf(): Record<string, unknown> {
  return { renderer: { toneMappingExposure: 1 }, settings: { colorGradeStrength: 0.8 }, planetId: 'tatooine', lighting: lighting(0), cameraCut: true, frame: 0, dt: 1 / 60, portalView: false, cameraInHull: false, space: false, daylight: 0.7, fogColor: new THREE.Color(0.6, 0.55, 0.5), placeGrade: null, placeGradeTau: 2 };
}
const uniformsOf = (p: Pass): number[] => {
  const u = p.material.uniforms;
  const v = (n: string) => u[n].value as import('three').Vector3;
  return [u.uAmount.value, ...v('uBalance').toArray(), ...v('uShadowTint').toArray(), ...v('uHighlightTint').toArray(), u.uSplit.value, u.uSaturation.value, u.uContrast.value, u.uPivot.value];
};
const material = (p: Pass) => (p as unknown as { material: import('three').ShaderMaterial }).material;
{
  const make = (mod: Mod): Pass => {
    const p = new (mod.ColorGradePass as new () => Pass)();
    p.material = material(p);
    return p;
  };
  const passes = [make(G as unknown as Mod)];
  if (OldG) passes.push(make(OldG));
  const ctxs = passes.map(() => ctxOf());
  const traces: number[][][] = passes.map(() => []);
  for (let f = 0; f < 600; f++) {
    passes.forEach((p, i) => {
      const c = ctxs[i];
      c.frame = f;
      c.cameraCut = f === 0;
      c.planetId = f < 300 ? 'tatooine' : 'dathomir';
      c.lighting = f % 120 === 0 ? lighting(f / 600) : c.lighting;
      c.daylight = 0.7 - 0.5 * (f / 600);
      p.prepare(c);
      traces[i].push(uniformsOf(p));
    });
  }
  const h = createHash('sha1').update(JSON.stringify(traces[0])).digest('hex').slice(0, 12);
  if (OldG) {
    let same = true;
    for (let f = 0; f < traces[0].length; f++) for (let k = 0; k < traces[0][f].length; k++) if (!Object.is(traces[0][f][k], traces[1][f][k])) same = false;
    ok(same, `with no place's look, every uniform the pass writes is ${BASE}'s own pass's, frame for frame, by Object.is`);
    ok(createHash('sha1').update(JSON.stringify(traces[1])).digest('hex').slice(0, 12) === BASE_TRACE, `the recorded hash is ${BASE}'s own trace's: ${createHash('sha1').update(JSON.stringify(traces[1])).digest('hex').slice(0, 12)}`);
  } else ok(h === BASE_TRACE, `git cannot answer: the trace held to ${BASE}'s recorded hash (${h})`);
}
{
  // A place's look over Tatooine's own, after half a minute: the uniforms of that look laid over the planet's.
  const placed = new G.ColorGradePass() as unknown as Pass;
  const told = new G.ColorGradePass() as unknown as Pass;
  placed.material = material(placed);
  told.material = material(told);
  const place: Look = { gloom: 0.4, cool: 0.2, saturation: -0.08, strength: 0.6 };
  told.lookOverride = { ...GM.GRADE_LOOKS.tatooine, ...place };
  const a = ctxOf();
  const b = ctxOf();
  a.placeGrade = place;
  const seen: number[] = [];
  for (let f = 0; f < 1800; f++) {
    for (const c of [a, b]) {
      c.frame = f;
      c.cameraCut = f === 0;
    }
    placed.prepare(a);
    told.prepare(b);
    if (f === 0 || f === 120) seen.push(uniformsOf(placed)[11]);
  }
  const ua = uniformsOf(placed);
  const ub = uniformsOf(told);
  ok(ua.every((v, i) => Math.abs(v - ub[i]) < 1e-9), "half a minute in, the pass's uniforms are those of the place's look laid over the planet's own");
  ok(Math.abs(ua[0] - 0.8 * 0.6) < 1e-9, "the place's strength reaches the amount (the menu's 0.8 times its 0.6)");
  ok(Object.is(seen[0], seen[1]) && Object.is(seen[1], ua[11]), 'arrived in it (a cut), the place\'s look at once and held there (a cut is a fresh world, never an ease from the last)');
  const rep = placed.report(a).place as { weight: number; live: boolean };
  ok(rep.live && rep.weight === 1, 'the report names the weight and that a place\'s look is in force');
  placed.lookOverride = { gloom: 0 };
  placed.prepare({ ...a, frame: 1800, cameraCut: false });
  told.lookOverride = { gloom: 0 };
  told.prepare({ ...b, frame: 1800, cameraCut: false });
  ok(uniformsOf(placed).every((v, i) => Object.is(v, uniformsOf(told)[i])), "the console's look stands over a place's");
}
{
  // Walking in mid-scene: no cut, so the look eases in over the time constant.
  const p = new G.ColorGradePass() as unknown as Pass;
  p.material = material(p);
  const c = ctxOf();
  for (let f = 0; f < 60; f++) {
    c.frame = f;
    c.cameraCut = f === 0;
    p.prepare(c);
  }
  const before = uniformsOf(p)[11];
  c.placeGrade = { saturation: 0.2 };
  for (let f = 60; f < 180; f++) {
    c.frame = f;
    c.cameraCut = false;
    p.prepare(c);
  }
  const w = (p.report(c).place as { weight: number }).weight;
  ok(uniformsOf(p)[11] > before && Math.abs(w - (1 - Math.exp(-1))) < 0.002, `walked in with no cut, the saturation rises and the weight is 1 − 1/e two seconds in (${w})`);
}

// ---- 4. the hand-overs only the game makes ----
{
  const main = text('main.ts');
  ok(main.includes('f.placeGrade = this.placeGradeNow();') && main.includes('f.placeGradeTau = PLACE_TUNE.gradeTau;'), 'the game hands the frame the look of the place holding the player and the time constant');
  ok(/private placeGradeNow\(\): LocationGrade \| null \{\n    const idx = this\.placesNow\(\);\n    if \(!idx\.hasSky\) return null;\n    const p = this\.player\.worldPos;\n    const q = idx\.ask;\n    q\.x = p\.x;\n    q\.z = p\.z;\n    return idx\.skyAsked\(this\.gradeSky\)\.grade;/.test(main), "asked of the places' index through its kept record, nothing on a world whose places name no sky");
  ok(text('core/fx/context.ts').includes('ctx.placeGrade = input.placeGrade ?? null;'), "the context copies the frame's look (none from a caller from before)");
  // The context's own copy, run: the look and its time constant taken from the frame, none of either from a caller from before.
  const C = (await load(NEW, 'core/fx/context.ts')) as typeof import('../../../src/core/fx/context.ts');
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  cam.updateMatrixWorld();
  const cx = { frame: 0, time: 0, cameraCut: true, view: new THREE.Matrix4(), proj: new THREE.Matrix4(), invProj: new THREE.Matrix4(), viewProj: new THREE.Matrix4(), invViewProj: new THREE.Matrix4(), prevViewProj: new THREE.Matrix4(), prevView: new THREE.Matrix4(), prevProjView: new THREE.Matrix4(), cameraPos: new THREE.Vector3(), tanHalfFov: new THREE.Vector2(), sunStore: {}, fogColor: new THREE.Color(), underwaterColor: new THREE.Color(), exitColor: new THREE.Color(), weather: {}, placeGrade: null as unknown, placeGradeTau: 0.5 };
  const input = { camera: cam, dt: 1 / 60, followFar: 0, sun: null, portalView: false, cameraInHull: false, inside: false, aboard: false, space: false, fog: null, daylight: 1, dayIndex: 0, lighting: null, planetId: 'tatooine', aiming: false, aimAmount: 0, vignetteKick: 0, firstPerson: false, orbitDistance: 0, waterInView: false, blades: [], lights: null, skyLights: [], skyLightCount: 0, clouds: [], cloudCount: 0, cameraUnderwater: false, cameraSubmerged: false, underwaterDepth: 0, underwaterColor: new THREE.Color(), underwaterOpacity: 0.75, underwaterReach: 0, room: null, weather: null };
  const warm: Look = { warmth: 0.5 };
  C.updateContext(cx as never, { ...input, placeGrade: warm, placeGradeTau: 3 } as never, new THREE.Vector2(16, 9));
  const took = cx.placeGrade === warm && cx.placeGradeTau === 3;
  C.updateContext(cx as never, input as never, new THREE.Vector2(16, 9));
  ok(took && cx.placeGrade === null && cx.placeGradeTau === 0, "the context takes the frame's look and its time constant, and from a caller from before none of either");
  const grade = text('core/fx/grade.ts');
  ok(grade.includes('const placed = ease.step(this.look, ctx.placeGrade);') && grade.includes('const look = this.lookOverride ?? placed;') && grade.includes('ease.tau = ctx.placeGradeTau;'), "the pass eases the place's look over the planet's own, the console's over both");
}

console.log(`placeGrade: ${checks} checks passed`);
