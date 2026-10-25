// The trees' gust form (the volumetrics' wave 7a, `src/world/windTrees.ts`): its three anchors are found exactly once in
// every swaying program's text, the colour program and the depth program alike, and rewritten all or none; the sway
// chunk's own text is never touched; with the unified wind's branch not taken the form's arithmetic is the plain sway's
// to the bit, and with it taken a gust patch sways a tree harder, a veer turns its lean and a calm between gusts leaves it
// as it was; a material takes the form chosen at the arrival that first wrapped it and keeps it, under a key of its own,
// and its depth material and the depth combinations follow; and the form's text passes the GLSL scans.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO } from './airTrees.ts';
import { redeclared, reservedWords, unbalanced, undefinedCalls, uniformNames } from './glslScan.ts';
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
const T = (await load('world/windTrees.ts')) as typeof import('../../../src/world/windTrees.ts');
const S = (await load('world/swayMath.ts')) as typeof import('../../../src/world/swayMath.ts');
const F = (await load('world/floraSway.ts')) as typeof import('../../../src/world/floraSway.ts');

// --- the anchors, in the chunk and in every swaying program's text ---
{
  let once = true;
  for (const a of T.TREES_ANCHORS) if (S.SWAY_FUNCTIONS.split(a).length !== 2) once = false;
  ok(once, "each of the form's three anchors is in the sway chunk exactly once");
  // A colour program and a depth program as the wrap makes them: three's own vertex text with the chunk put in.
  const colour = new THREE.MeshStandardMaterial();
  colour.userData.swgSway = 'a stand-in planting';
  const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} as Record<string, unknown>, defines: {} };
  const put = F.injectSway(shader as unknown as import('three').WebGLProgramParametersWithUniforms, colour);
  const depthShader = { vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader, uniforms: {} as Record<string, unknown>, defines: {} };
  const putDepth = F.injectSway(depthShader as unknown as import('three').WebGLProgramParametersWithUniforms, colour);
  const formColour = T.treesFormText(shader.vertexShader);
  const formDepth = T.treesFormText(depthShader.vertexShader);
  ok(put && putDepth && formColour !== null && formDepth !== null, 'the form finds all three anchors in a colour program and a depth program with the chunk put in');
  // Undone, last first, the rewrites give the chunk's own text back (the chunk is never edited).
  const undo = (v: string): string | null => {
    let s: string | null = v;
    const w = s.indexOf('uniform vec4 uWind7[7];');
    if (w < 0) return null;
    for (let i = T.TREES_REWRITES.length - 1; i >= 0 && s; i--) {
      const to = T.TREES_REWRITES[i];
      const at = s.indexOf(to);
      if (at < 0 || s.indexOf(to, at + to.length) >= 0) s = null;
      else s = s.slice(0, at) + T.TREES_ANCHORS[i] + s.slice(at + to.length);
    }
    return s;
  };
  const back = undo(formColour!);
  const W7 = `\n${((await load('world/windMath.ts')) as typeof import('../../../src/world/windMath.ts')).WIND7_GLSL}${T.TREES_GLSL}`;
  ok(back !== null && back.split(W7).length === 2 && back.replace(W7, '') === shader.vertexShader, "and taken out again, last first, they give the wrapped program's own text back to the byte: the form is exactly its rewrites, the gust function and the form's own three functions");
  ok(T.treesFormText('void main() {}') === null && T.treesFormText(shader.vertexShader.replace(T.TREES_ANCHORS[1], '')) === null, 'a text missing an anchor gets no form at all (null), never half a form');
  for (const [what, v, base] of [['colour', formColour!, shader.vertexShader], ['depth', formDepth!, depthShader.vertexShader]] as const) {
    const calls = undefinedCalls(v).filter((c) => c.startsWith('w7') || c.startsWith('swg'));
    // A name declared twice in one scope is a program that never links: the form adds none to what the wrap had.
    const twice = redeclared(v).filter((d) => !redeclared(base).includes(d));
    ok(calls.length === 0 && twice.length === 0 && reservedWords(v).filter((w) => !['sample'].includes(w)).length === reservedWords(base).filter((w) => !['sample'].includes(w)).length && unbalanced(v) === '' && uniformNames(v).includes('uWind7'), `the ${what} program's form calls nothing of ours it does not define, declares nothing twice in a scope${twice.length ? ` (${twice.join(', ')})` : ''}, uses no new reserved word, balances, and declares uWind7`);
  }
  // The scan finds what it is there to find: the form with one of its names declared again.
  const doubled = formColour!.replace('vec2 swgW7Dir = vec2( uSwayWind.x, uSwayWind.y );', 'vec2 swgW7Dir = vec2( uSwayWind.x, uSwayWind.y );\n\tvec2 swgW7Dir = vec2( 0.0 );');
  ok(redeclared(doubled).some((d) => d.includes('swgW7Dir')), 'and the scan would have named a name of the form declared twice');
}

// --- the arithmetic: off is the plain sway to the bit, on sways harder in a gust ---
{
  const tune = { ...S.SWAY_DEFAULTS };
  const model = { shape: { H: 9, c: 0.35, axisX: 0.1, axisZ: -0.05, rT: 0.4, positions: [], card: false }, omega: 1.4, gain: 1 } as unknown as import('../../../src/world/swayMath.ts').SwayModelState;
  const a: [number, number, number] = [0, 0, 0];
  const b: [number, number, number] = [0, 0, 0];
  let same = true;
  let calmSame = true;
  let harder = 0;
  let cases = 0;
  let turned = 0;
  for (let i = 0; i < 400; i++) {
    const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, (i % 20) * 3.7 - 30, 0, Math.floor(i / 20) * 4.1 - 40, 1];
    const f = { windX: 0.6, windZ: 0.8, strength: 0.3 + (i % 7) * 0.08, t: 10 + i * 0.37, flutterOmega: 7, eye: [0, 1.7, 0] } as unknown as import('../../../src/world/swayMath.ts').SwayFrame;
    const p = [0.3, 2 + (i % 9) * 0.8, -0.2];
    S.swayOffset(a, p, m, model, f, tune);
    T.swayOffsetForm(b, p, m, model, f, tune, { on: false, k: 1.8, veer: 0.3, patch: 1, trees: 0.4 });
    for (let c = 0; c < 3; c++) if (!Object.is(a[c], b[c])) same = false;
    T.swayOffsetForm(b, p, m, model, f, tune, { on: true, k: 1, veer: 0, patch: 0, trees: 0.4 });
    for (let c = 0; c < 3; c++) if (!Object.is(a[c], b[c])) calmSame = false;
    T.swayOffsetForm(b, p, m, model, f, tune, { on: true, k: 2, veer: 0, patch: 1, trees: 0.4 });
    const la = Math.hypot(a[0], a[2]);
    const lb = Math.hypot(b[0], b[2]);
    if (la > 1e-4) {
      cases++;
      if (lb > la) harder++;
    }
    T.swayOffsetForm(b, p, m, model, f, tune, { on: true, k: 1, veer: 0.5, patch: 0, trees: 0.4 });
    if (la > 1e-4 && Math.abs(Math.atan2(b[0], b[2]) - Math.atan2(a[0], a[2])) > 0.1) turned++;
  }
  ok(same, "with the unified wind's branch not taken the form's arithmetic is the plain sway's to the bit, whatever the gust there says");
  ok(calmSame, "and taken in the calm between gusts (k one, no veer, no patch) it is still the plain sway's to the bit");
  ok(cases > 100 && harder >= cases * 0.6, `inside a gust patch a tree sways harder (${harder} of ${cases} points further over)`);
  ok(turned > 50, `and a veer turns its lean (${turned} points)`);
}

// --- chosen at an arrival, kept by the material, and its depth with it ---
{
  T.chooseWindTrees(false);
  const plain = new THREE.MeshStandardMaterial();
  plain.userData.swgSway = 'plain planting';
  F.swayWrap(plain);
  T.chooseWindTrees(true);
  const formed = new THREE.MeshStandardMaterial();
  formed.userData.swgSway = 'formed planting';
  F.swayWrap(formed);
  const keyOf = (m: THREE.Material): string => m.customProgramCacheKey();
  ok(keyOf(plain) !== keyOf(formed) && keyOf(formed).includes('sway-wind7') && !keyOf(plain).includes('wind7'), "a material wrapped in an arrival that chose the form is keyed apart (`sway-wind7`); one wrapped before keeps today's key");
  T.chooseWindTrees(false);
  ok(keyOf(formed).includes('sway-wind7'), 'and keeps its form whatever a later arrival chooses');
  const dPlain = F.swayDepthFor(plain);
  const dForm = F.swayDepthFor(formed);
  ok(dPlain.customProgramCacheKey() === 'swg-sway-depth' && dForm.customProgramCacheKey() === 'swg-sway-depth-wind7', "its depth material follows it: today's key for the plain, the form's own for the formed");
  const combos = F.swayDepthCombos(true);
  const plainCombos = F.swayDepthCombos(false);
  ok(combos.length === plainCombos.length && combos.length === 12 && combos.every((m) => (m.material as THREE.Material).userData.swgSwayForm === true) && plainCombos.every((m) => (m.material as THREE.Material).userData.swgSwayForm === false), "the depth combinations come in the form's twelve beside today's twelve, each marked");
  const shader = { vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader, uniforms: {} as Record<string, unknown>, defines: {} };
  dForm.onBeforeCompile(shader as unknown as import('three').WebGLProgramParametersWithUniforms, undefined as unknown as import('three').WebGLRenderer);
  ok(shader.vertexShader.includes('w7Gust( swgPlace.xz )') && shader.uniforms.uWind7 !== undefined, "the formed depth material's own hook writes the form and hands it the unified wind's uniform");
}

// --- the programs' own text, run as script (glslRun.ts), each with the gust stood in from `env` ---
const W7m = (await load('world/windMath.ts')) as typeof import('../../../src/world/windMath.ts');
const Wd = (await load('world/wind.ts')) as typeof import('../../../src/world/wind.ts');
const G = (await load('world/volumetrics/airGrass.ts')) as typeof import('../../../src/world/volumetrics/airGrass.ts');
const Lq = (await load('world/volumetrics/airLiquid.ts')) as typeof import('../../../src/world/volumetrics/airLiquid.ts');
const Sh = (await load('world/volumetrics/airShaders.ts')) as typeof import('../../../src/world/volumetrics/airShaders.ts');
const Pt = (await load('world/volumetrics/airParticleShaders.ts')) as typeof import('../../../src/world/volumetrics/airParticleShaders.ts');
const AT = (await load('world/volumetrics/airTune.ts')) as typeof import('../../../src/world/volumetrics/airTune.ts');
const v2 = (x: number, y: number): { x: number; y: number } => ({ x, y });
const v3 = (x: number, y?: number, z?: number): { x: number; y: number; z: number } => (y === undefined ? { x, y: x, z: x } : { x, y, z: z! });
const v4 = (x: number, y: number, z: number, w: number): { x: number; y: number; z: number; w: number } => ({ x, y, z, w });
/** A pack's seven vectors as `uWind7[i]` reads them, its on slot as given. */
const pack7 = (on: number, trees = 0.4): { x: number; y: number; z: number; w: number }[] => [0, 1, 2, 3, 4, 5, 6].map((i) => v4(0.5, 0.5, i === 6 ? trees : 0.5, i === 6 ? on : 0.5));
/** A smooth gust field stood in for `w7Gust`: k, the veer and the patch, each different with the place. */
const gustAt = (x: number, z: number): { x: number; y: number; z: number } => ({ x: 1 + 0.8 * Math.sin(x * 0.031) * Math.cos(z * 0.027), y: 0.4 * Math.sin(x * 0.013 + z * 0.019), z: 0.5 + 0.5 * Math.sin(x * 0.021 - z * 0.017) });

// The trees' form: its three statements as the rewrite writes them, run, against what the form is meant to do.
{
  const kept = 'vec3 swgWind = transpose( mat3( swgModel ) ) * vec3( swgW7Dir.x, 0.0, swgW7Dir.y );';
  ok(T.TREES_REWRITES[0].endsWith(kept), "the form's first rewrite ends on the chunk's own wind line, turned to the form's direction");
  const body = [T.TREES_REWRITES[0].replace(kept, 'vec3 swgWind = vec3( swgW7Dir.x, 0.0, swgW7Dir.y );'), T.TREES_REWRITES[1], T.TREES_REWRITES[2]].join('\n');
  const text = `${T.TREES_GLSL}\nvec4 swgFormRun( vec3 swgPlace ) {\n${body}\n\treturn vec4( swgWind.x, swgWind.z, swgS, swgF );\n}`;
  const smooth = (e0: number, e1: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  let worst = 0;
  let readAt = true;
  let sense = 0;
  let cases = 0;
  for (const on of [0, 1]) {
    for (let i = 0; i < 300; i++) {
      const place = { x: (i % 20) * 13.7 - 120, y: 3, z: Math.floor(i / 20) * 11.3 - 80, xz: v2(0, 0) };
      place.xz = v2(place.x, place.z);
      const h = i * 0.37;
      const S = (i % 11) * 0.11;
      const calm = 0.25;
      const trees = 0.4;
      let asked: { x: number; y: number } | null = null;
      const env = {
        uSwayWind: v3(Math.sin(h), Math.cos(h), S),
        uSwayTune: v4(1, calm, 1, 1),
        uWind7: pack7(on, trees),
        w7On: () => on > 0.5,
        w7Gust: (xz: { x: number; y: number }) => {
          asked = xz;
          return gustAt(xz.x, xz.y);
        },
        swgSwayStep: smooth,
        vec2: v2,
        vec3: v3,
        vec4: v4,
        cos: Math.cos,
        sin: Math.sin,
      };
      const run = glslFunctions(text, ['swgFormRun', 'swgW7Turn'], env) as unknown as { swgFormRun: (p: unknown) => { x: number; y: number; z: number; w: number }; swgW7Turn: (x: number, z: number, a: number) => { x: number; y: number } };
      const got = run.swgFormRun(place);
      const g = on ? gustAt(place.x, place.z) : { x: 1, y: 0, z: 0 };
      if (on && (asked === null || (asked as { x: number; y: number }).x !== place.x || (asked as { x: number; y: number }).y !== place.z)) readAt = false;
      const c = Math.cos(g.y);
      const s = Math.sin(g.y);
      const dx = on && g.y !== 0 ? Math.sin(h) * c + Math.cos(h) * s : Math.sin(h);
      const dz = on && g.y !== 0 ? Math.cos(h) * c - Math.sin(h) * s : Math.cos(h);
      const sS = Math.min(1, Math.max(0, on ? S * g.x : S));
      let sF = calm + (1 - calm) * smooth(0, 0.8, sS);
      if (on) sF = Math.min(1, sF * (1 + trees * g.z));
      worst = Math.max(worst, Math.abs(got.x - dx), Math.abs(got.y - dz), Math.abs(got.z - sS), Math.abs(got.w - sF));
      // The turn is the air's own sense: a heading h turned by the veer is h + the veer (w7Target's, windMath.test's).
      const t = run.swgW7Turn(Math.sin(h), Math.cos(h), 0.3);
      sense = Math.max(sense, Math.abs(t.x - Math.sin(h + 0.3)), Math.abs(t.y - Math.cos(h + 0.3)));
      cases++;
    }
  }
  ok(worst < 1e-15 && readAt && cases === 600, `the trees' form's own statements, run: its lean turned by the veer at the planting's own place, its strength the flora's times k there, its bend's amplitude gaining the trees' share times the patch, held at one; off the arm, the chunk's own wind, strength and bend (worst ${worst})`);
  ok(sense < 1e-12, "and its turn is the air's own sense: a heading h is turned to h + the veer, as w7Target turns the air's wind and the weather the water's and the rain's");
}

// The air's and the liquid's pull target: today's gusts at the wind's art nought, the unified wind's under the arm.
{
  Wd.setWindArm({ master: true, wind: true, devils: true, trees: true, art: 0 });
  const offOn = Wd.wind7Uniforms().uWind7.value[27];
  const fromHere = { x: 1.25, y: -0.5, tag: 'windHere' };
  const W7text = W7m.WIND7_GLSL;
  const uW = pack7(0);
  const env = { uWind7: uW, w7Gust: (xz: { x: number; y: number }) => gustAt(xz.x, xz.y), windHere: () => fromHere, vec2: v2, vec3: v3, cos: Math.cos, sin: Math.sin };
  const run = glslFunctions([glslFunctionText(W7text, 'w7On'), glslFunctionText(W7text, 'w7Target'), glslFunctionText(Lq.LIQUID_TARGET_GLSL, 'airTarget')].join('\n'), ['airTarget', 'w7Target'], env) as unknown as { airTarget: (w: unknown, wind: unknown) => { x: number; y: number }; w7Target: (w: unknown, wind: unknown) => { x: number; y: number } };
  uW[6].w = offOn;
  const atNought = run.airTarget(v2(30, -40), v2(2, 3));
  uW[6].w = 1;
  const armed = run.airTarget(v2(30, -40), v2(2, 3));
  const want = run.w7Target(v2(30, -40), v2(2, 3));
  ok(offOn === 0 && atNought === fromHere && armed.x === want.x && armed.y === want.y && armed !== fromHere, "the pull's target (airTarget, run): at the wind's art nought the arm writes the uniform's on nought and the target is today's windHere, the very value; under the arm the unified wind's w7Target");
  Wd.setWindArm({ master: false, wind: true, devils: true, trees: true, art: 1 });
}

// The calm day's dirt (w7ShedAt, run): the rate times the patch times the step, nought off the arm or at a rate of nought.
{
  const text = glslFunctionText(Sh.DUST_FRAGMENT, 'w7ShedAt');
  const runWith = (on: boolean, rate: number, dt: number): ((wp: { x: number; y: number }) => number) =>
    glslFunctions(text, ['w7ShedAt'], { w7On: () => on, uShedP: v4(rate, 0.2, 0.3, 0.8), uDt: dt, w7Gust: (xz: { x: number; y: number }) => gustAt(xz.x, xz.y) }).w7ShedAt as unknown as (wp: { x: number; y: number }) => number;
  let right = true;
  for (let i = 0; i < 200; i++) {
    const wp = v2(i * 7.1 - 600, i * -3.3 + 90);
    const p = gustAt(wp.x, wp.y).z;
    for (const dt of [1 / 60]) {
      if (Math.abs(runWith(true, 0.08, dt)(wp) - 0.08 * p * dt) > 1e-17) right = false;
      if (runWith(false, 0.08, dt)(wp) !== 0 || runWith(true, 0, dt)(wp) !== 0) right = false;
    }
  }
  ok(right, "a gust patch sheds its rate times the patch there times the step (w7ShedAt, run), nothing off the unified wind's arm or at a rate of nought");
  ok(/if \(give > 0\.0\) \{[\s\S]*float sg = w7ShedAt\(wp\);[\s\S]*add \*= give;/.test(Sh.DUST_FRAGMENT), "and it is laid inside the ground's give and taken by it, as every source in the pass is: a tenth over rock, none over water or a solid");
}

// A gust picks up leaves and puffs (kickGustSheds, run): a patch over a half, never a streak, nothing off the arm.
{
  const text = glslFunctionText(Pt.KICK_UPDATE_FRAGMENT, 'kickGustSheds');
  const win = v4(-96, 40, 192, 0);
  let right = true;
  for (const on of [false, true]) {
    let asked: { x: number; y: number } | null = null;
    const run = glslFunctions(text, ['kickGustSheds'], { w7On: () => on, uWindow: win, vec2: v2, w7Gust: (xz: { x: number; y: number }) => ((asked = xz), gustAt(xz.x, xz.y)) }).kickGustSheds as unknown as (lc: unknown, kind: number) => boolean;
    for (let i = 0; i < 200; i++) {
      const lc = v2((i % 20) / 20, Math.floor(i / 20) / 10);
      const x = win.x + lc.x * win.z;
      const z = win.y + lc.y * win.z;
      const p = gustAt(x, z).z;
      for (const kind of [0, 1, 2, 3]) {
        asked = null;
        const got = run(lc, kind);
        const want = on && kind !== 3 && p > 0.5;
        if (got !== want) right = false;
        if (on && kind !== 3 && (asked === null || Math.abs((asked as { x: number; y: number }).x - x) > 1e-12 || Math.abs((asked as { x: number; y: number }).y - z) > 1e-12)) right = false;
      }
    }
  }
  ok(right, "a gust patch over a half starts a leaf or a puff at the cell's own world place (kickGustSheds, run), never a streak, and none off the arm");
}

// The grass's lean outside the window and its sheen (swgAirWind7, swgAirSheenOf, swgAirSheen, run): one lean across the
// edge band with the window's own, the sheen nought at the art nought.
{
  const Gt = AT.AIR_TUNE.grass;
  const P = v4(1, Gt.full, Gt.most, Gt.sink);
  const Wn = v4(-37.5, 61.25, 192, AT.AIR_TUNE.window.edge);
  const windRec = { x: 2.6, y: -1.4, z: 0.15, w: 1, xy: v2(2.6, -1.4) };
  const sheenRec = v4(0.45, 0.5, 1.3, 0);
  const uW = pack7(1);
  let footAt: { x: number; z: number } = { x: 0, z: 0 };
  const names = ['swgAirGrassAtlas', 'swgAirGrassEdge', 'swgAirGrassBend', 'swgAirGrassReach', 'swgAirLean'];
  const W7text = W7m.WIND7_GLSL;
  const text = [...names.map((n) => glslFunctionText(G.GRASS_AIR_PARS, n)), glslFunctionText(W7text, 'w7On'), glslFunctionText(W7text, 'w7Target'), glslFunctionText(G.GRASS_AIR_WIND7_PARS, 'swgAirWind7'), glslFunctionText(G.GRASS_AIR_WIND7_PARS, 'swgAirSheenOf')].join('\n');
  let run: Record<string, (...a: unknown[]) => unknown> = {};
  const env: Record<string, unknown> = {
    uAirGrassP: P,
    uAirGrassWin: Wn,
    uAirGrassRect: v4(0, 0, 1, 1),
    uAirGrassHalf: v2(0.5 / 128, 0.5 / 128),
    uAirGrassVel: 'the atlas',
    uAirGrassWind: windRec,
    uAirGrassSheen: sheenRec,
    uWind7: uW,
    w7Gust: (xz: { x: number; y: number }) => gustAt(xz.x, xz.y),
    vec2: v2,
    vec3: v3,
    cos: Math.cos,
    sin: Math.sin,
    length: (v: { x: number; y: number }) => Math.sqrt(v.x * v.x + v.y * v.y),
    isnan: (v: { x: number; y: number }) => [Number.isNaN(v.x), Number.isNaN(v.y)],
    isinf: (v: { x: number; y: number }) => [Math.abs(v.x) === Infinity, Math.abs(v.y) === Infinity],
    any: (b: boolean[]) => b.some(Boolean),
    // Slab 0's air at the tuft's foot stood exactly at its relax target there: the window's lean and the one outside then
    // stand for one wind, which is what the edge band must join without a step.
    texture2D: () => {
      const t = run.w7Target(v2(footAt.x, footAt.z), windRec.xy) as { x: number; y: number };
      return { x: t.x, y: t.y, xy: v2(t.x, t.y) };
    },
  };
  run = glslFunctions(text, ['swgAirLean', 'swgAirWind7', 'swgAirSheenOf', 'w7Target'], env) as unknown as Record<string, (...a: unknown[]) => unknown>;
  const base = (x: number, z: number): { x: number; y: number; z: number; xz: { x: number; y: number } } => ({ x, y: 0, z, xz: v2(x, z) });
  const lev = 0.8;
  const h = 0.6;
  let worst = 0;
  let worstSheen = 0;
  let band = 0;
  let farWorst = 0;
  // Along a line from deep inside the window across its edge band and out past it, and along the far side too.
  for (let i = 0; i <= 400; i++) {
    const lx = 0.5 - (i / 400) * 0.8;
    for (const lz of [0.03, 0.5, 0.97]) {
      const b = base(Wn.x + lx * Wn.z, Wn.y + lz * Wn.z);
      footAt = { x: b.x, z: b.z };
      const near = run.swgAirLean(b, lev, h) as { x: number; y: number; z: number };
      const out = run.swgAirWind7(b, lev, h, false) as { x: number; y: number; z: number };
      const tot = { x: near.x + out.x, y: near.y + out.y, z: near.z + out.z, xz: v2(near.x + out.x, near.z + out.z) };
      // What one wind leans a tuft by at this place: the wheat's law on the unified wind there, the whole of it.
      const w = run.w7Target(v2(b.x, b.z), windRec.xy) as { x: number; y: number };
      const sp = Math.sqrt(w.x * w.x + w.y * w.y);
      const k = lev * lev * h * Math.min(Math.max(sp / P.y, 0), P.z) * P.x;
      worst = Math.max(worst, Math.abs(tot.x - (w.x / sp) * k), Math.abs(tot.y + P.w * k), Math.abs(tot.z - (w.y / sp) * k));
      const sheen = run.swgAirSheenOf(tot, lev, h) as number;
      const wantSheen = Math.min(1, Math.max(0, Math.sqrt(tot.x * tot.x + tot.z * tot.z) / (lev * h))) * sheenRec.x;
      worstSheen = Math.max(worstSheen, Math.abs(sheen - wantSheen));
      if (Math.abs(near.x) > 1e-9 && Math.abs(out.x) > 1e-9) band++;
      const far = run.swgAirWind7(b, lev, h, true) as { x: number; y: number; z: number };
      const kf = lev * lev * h * Math.min(Math.max(sp / P.y, 0), P.z) * windRec.z;
      farWorst = Math.max(farWorst, Math.abs(far.x - (w.x / sp) * kf), Math.abs(far.z - (w.y / sp) * kf));
    }
  }
  ok(worst < 1e-12 && band > 20, `a near tuft leans by one wind across the window's edge band: the window's own lean faded out and the unified wind's outside faded in sum to the whole lean of the wind there, inside, in the band and outside, run (${band} places in the band; worst ${worst.toExponential(2)})`);
  ok(farWorst < 1e-12, "a far card takes its own share of that lean wherever it stands, never the window's");
  ok(worstSheen < 1e-12, "and the sheen is the bend over the tuft's height times its strength, so it is as continuous as the lean");
  sheenRec.x = 0;
  const b0 = base(Wn.x + 0.2 * Wn.z, Wn.y + 0.5 * Wn.z);
  footAt = { x: b0.x, z: b0.z };
  const lean0 = run.swgAirWind7(base(Wn.x - 30, Wn.y - 30), lev, h, false) as { x: number; y: number; z: number };
  ok((run.swgAirSheenOf({ ...lean0, xz: v2(lean0.x, lean0.z) }, lev, h) as number) === 0, 'the sheen nought at its strength nought (the art nought)');
  uW[6].w = 0;
  const off = run.swgAirWind7(base(Wn.x - 30, Wn.y - 30), lev, h, false) as { x: number; y: number; z: number };
  ok(off.x === 0 && off.y === 0 && off.z === 0, 'and no lean of the unified wind off its arm');
  // The fragment's sheen, run: the colour toward a paler grey of itself by the vertex stage's share, none at nought.
  const frag = glslFunctionText(G.GRASS_AIR_SHEEN_FRAG, 'swgAirSheen');
  const sheenRun = (v: number): ((c: unknown) => { x: number; y: number; z: number }) => glslFunctions(frag, ['swgAirSheen'], { vSwgAirSheen: v, uAirGrassSheen: v4(0.45, 0.5, 1.3, 0), vec3: v3 }).swgAirSheen as unknown as (c: unknown) => { x: number; y: number; z: number };
  const c = v3(0.2, 0.5, 0.1);
  let shWorst = 0;
  for (const v of [0.2, 0.7, 1, 1.4]) {
    const got = sheenRun(v)(c);
    const g = 0.2126 * c.x + 0.7152 * c.y + 0.0722 * c.z;
    const s = Math.min(1, Math.max(0, v));
    for (const k of ['x', 'y', 'z'] as const) {
      const pale = Math.min((c[k] * (1 - 0.5) + g * 0.5) * 1.3, 1);
      shWorst = Math.max(shWorst, Math.abs(got[k] - (c[k] * (1 - s) + pale * s)));
    }
  }
  ok(shWorst < 1e-15 && sheenRun(0)(c) === c, `the fragment's sheen (swgAirSheen, run) lifts a colour toward a paler grey of itself by its share, the colour itself at nought (worst ${shWorst})`);
}

// --- the flora's shared sway never pulses with the player's own gust ---
// With the player standing inside a gust patch and with the player standing outside every patch, at the same moments,
// `SWAY_UNIFORMS.uSwayWind` is the weather's mean along the shared heading, the same to the bit, and so a tuft outside every
// patch sways the same; the first cut's flora wind (the wind at the player's feet, S·k) is the control, which would pulse.
{
  const Wm = await load('world/weather.ts');
  const water = await load('world/water.ts');
  const WWF = water.WATER_WIND_FULL as number;
  const FW = F.FLORA_WIND as { x: number; z: number; strength: number };
  type Wx = Record<string, unknown> & { update(dt: number, p: unknown, ctx: unknown): void };
  const blocks = [0, 1, 2, 3, 4].map((l) => ({ weatherIndex: l, windSpeedScale: 2 + l, cameraEffect: null }));
  const make = (): Wx => {
    const w = new (Wm.Weather as new (p: unknown) => Wx)({ world: null });
    const x = w as unknown as Record<string, unknown>;
    x.sky = { lighting: { windSpeedScale: 3, shadowScale: 1 }, data: { blocks, weather: { effects: null } }, texturesReady: () => true, ensureTextures: () => Promise.resolve(), setMix: () => undefined, setWind: () => undefined, setOvercast: () => undefined, sheetAloft: new Float64Array(3), sheetAloftOn: false, mixLength: 1, mixBlock: () => blocks[0], mixWeights: new Float64Array([1, 0, 0, 0]) };
    x.reason = null;
    x.hasWeatherData = true;
    x.seed = 99;
    x.weights = [0.3, 0.25, 0.2, 0.15, 0.1];
    x.levels = 5;
    x.current = { name: '', byLevel: Int16Array.from([0, 1, 2, 3, 4]) };
    x.fxEffects = { quads: 0, batchMaterials: [], kill: null, place: () => ({ rateScale: 0, alphaScale: 1 }), move: () => undefined, remove: () => undefined, particlesOf: () => 5, soundsOf: () => [], update: () => undefined };
    (x.roofs as { update: () => void }).update = () => undefined;
    return w;
  };
  const realNow = Date.now;
  let now = 1.79e12 + 4242;
  Date.now = () => now;
  try {
    Wd.attachWind('test-pack', 'zz-trees-planet', 99, [0.3, 0.25, 0.2, 0.15, 0.1], 5, blocks);
    Wd.setWindArm({ master: true, wind: true, devils: false, trees: true, art: 1 });
    const scout = make();
    const inGust = make();
    const between = make();
    const wctx = { daylight: 0.8, groundAt: () => 0 };
    const g = W7m.newGustAt();
    const tuft = { shape: { H: 0.6, c: 0, axisX: 0, axisZ: 0, rT: 0.05, positions: [], card: true }, omega: 3.1, gain: 1 } as unknown as import('../../../src/world/swayMath.ts').SwayModelState;
    const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 400, 0, -350, 1];
    const pa: [number, number, number] = [0, 0, 0];
    const pb: [number, number, number] = [0, 0, 0];
    // The frame the sway chunk reads, from the shared uniforms (the eye held near the tuft, so no fade takes it).
    const frameNow = (): import('../../../src/world/swayMath.ts').SwayFrame => {
      const w = F.SWAY_UNIFORMS.uSwayWind.value;
      return { windX: w.x, windZ: w.y, strength: w.z, t: F.SWAY_UNIFORMS.uSwayTime.value.x, flutterOmega: F.SWAY_UNIFORMS.uSwayTime.value.y, eye: [400, 1.7, -352] } as unknown as import('../../../src/world/swayMath.ts').SwayFrame;
    };
    let same = true;
    let pulses = 0;
    let frames = 0;
    let swaySame = true;
    for (let f = 0; f < 900; f++) {
      now += 1000 / 60;
      scout.update(1 / 60, new THREE.Vector3(0, 0, 0), wctx);
      // Where a gust stands now, and where none does, near the scout.
      const P = Wd.windPattern()!;
      let inside: [number, number] | null = null;
      let outside: [number, number] | null = null;
      for (let i = 0; i < 2000 && (!inside || !outside); i++) {
        g.x = ((i * 37) % 200) * 1.7 - 170;
        g.z = Math.floor(i / 20) * 2.3 - 115;
        W7m.gustFlat(g, P.packOut);
        if (!inside && g.p > 0.95) inside = [g.x, g.z];
        if (!outside && g.p < 0.02) outside = [g.x, g.z];
      }
      if (!inside || !outside) continue;
      inGust.update(1 / 60, new THREE.Vector3(inside[0], 0, inside[1]), wctx);
      const kIn = Wd.WIND_FRAME.speed;
      F.stepSway(0);
      const a = F.SWAY_UNIFORMS.uSwayWind.value.clone();
      const fa = frameNow();
      S.swayOffset(pa, [0.1, 0.4, 0.05], m, tuft, fa, S.SWAY_DEFAULTS);
      const meanA = Wd.WIND_FRAME.mean;
      const hA = Wd.WIND_FRAME.heading;
      between.update(1 / 60, new THREE.Vector3(outside[0], 0, outside[1]), wctx);
      const kOut = Wd.WIND_FRAME.speed;
      F.stepSway(0);
      const b = F.SWAY_UNIFORMS.uSwayWind.value.clone();
      const fb = frameNow();
      S.swayOffset(pb, [0.1, 0.4, 0.05], m, tuft, fb, S.SWAY_DEFAULTS);
      frames++;
      if (!(Object.is(a.x, b.x) && Object.is(a.y, b.y) && Object.is(a.z, b.z))) same = false;
      if (!(Object.is(a.x, Math.sin(hA)) && Object.is(a.y, Math.cos(hA)) && Object.is(a.z, Math.min(1, Math.max(0, Math.min(meanA / WWF, 1)))))) same = false;
      for (let c = 0; c < 3; c++) if (!Object.is(pa[c], pb[c])) swaySame = false;
      // The control: a flora wind from the wind at the player's feet would differ between the two.
      if (Math.min(kIn / WWF, 1) !== Math.min(kOut / WWF, 1)) pulses++;
      void FW;
    }
    ok(frames > 800 && same, `with the player inside a gust patch and outside every one, at the same moments, the flora's shared wind (uSwayWind) is the weather's mean along the shared heading to the bit (${frames} frames)`);
    ok(swaySame, 'and a tuft outside every patch sways the same, to the bit, wherever the player stands');
    ok(pulses > frames * 0.9, `while a flora wind taken from the wind at the player's feet (the first cut's) would have differed on ${pulses} of those frames: the control`);
  } finally {
    Date.now = realNow;
    Wd.setWindArm({ master: false, wind: true, devils: true, trees: true, art: 1 });
    Wd.detachWind();
  }
}

console.log(`\n${checks} checks passed`);
