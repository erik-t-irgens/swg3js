// Everything off is today's game (the volumetrics design's §4.0 and §4.1, run by `test:air`): "today" is the commit the
// pass was cut from (`PRE_PASS`), its `src/` written out of git into a folder of its own and loaded beside today's
// through a module hook (`airLoader.mjs`, registered by this suite alone), so neither the new code nor a copy of it
// ever stands in for the old. Proved here, with the master off:
//
//   0. the hook loads every module compared, from both trees;
//   1. the settings: a settings file the old game saved over its own defaults loads to the new defaults with the
//      player's own values kept, and saving the new defaults writes nothing;
//   2. the chain's decision: for every pass but the volume, over every combination of its switches and an override,
//      the registry's rule answers what the old chain's `passWanted` answered; the volume is unwanted with the master
//      off whatever it says; the typical frame costs what it did;
//   3. the programs' text: the ground's tile program and its key, the version-3 ground's bump injection, the water for
//      every variant (lit and both mask twins, waves and flat, hooked and plain), the ripples' module, and the lava with
//      and without its crust, byte for byte what the old tree makes;
//   6. nothing runs: the field with the master off answers and the renderer is never touched, and the dust pool's
//      motes (the dust or the master off) are the old pool's to the bit, the same spawns and steps, seeded alike;
//   7. no resize, of any of the field's detail dials, disposes a material.
//
// (Item 4, the choosers, is the second wave's: this wave swaps no material. The installed passes and every program the
// game links are the browser's, §4.2.) It fails loudly when git cannot answer.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractOldSrc, PRE_PASS, REPO } from './airTrees.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const t0 = performance.now();

const OLD = extractOldSrc();
const NEW = join(REPO, 'src');
// The old tree is this run's alone: taken away however the run ends.
process.on('exit', () => {
  try {
    rmSync(dirname(OLD), { recursive: true, force: true });
  } catch {
    /* a temporary folder the system clears in its own time */
  }
});
register(pathToFileURL(join(REPO, 'tools', 'swg', 'tests', 'airLoader.mjs')).href, import.meta.url, { data: { roots: [OLD, NEW], packageBase: join(REPO, 'package.json') } });
ok(true, `the commit before the pass (${PRE_PASS}) is written out of git, and the hook registered over both trees`);

type Mod = Record<string, unknown>;
const load = async (root: string, path: string): Promise<Mod> => (await import(pathToFileURL(join(root, path)).href)) as Mod;
const both = async (path: string): Promise<[Mod, Mod]> => {
  const o = await load(OLD, path);
  const n = await load(NEW, path);
  ok(Object.keys(o).length > 0 && Object.keys(n).length > 0, `${path}: loaded from both trees`);
  return [o, n];
};

// A page's storage, for the settings.
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

// --- 1. the settings ---
{
  const [o, n] = await both('core/settings.ts');
  const oldDefaults = o.DEFAULT_SETTINGS as Record<string, unknown>;
  const newDefaults = n.DEFAULT_SETTINGS as Record<string, unknown>;
  const mine = { ...oldDefaults, bloom: !oldDefaults.bloom, fov: 81, shadowDistance: 260 };
  (o.saveSettings as (s: unknown) => void)(mine);
  const loaded = (n.loadSettings as () => Record<string, unknown>)();
  const want = { ...newDefaults, bloom: mine.bloom, fov: 81, shadowDistance: 260 };
  ok(JSON.stringify(loaded) === JSON.stringify(want), "a settings file the old game saved loads to the new defaults with the player's own values kept");
  ok(loaded.volumetrics === false, 'and the master is off in it');
  store.clear();
  (n.saveSettings as (s: unknown) => void)(newDefaults);
  ok(store.size === 0, 'saving the new defaults writes nothing at all');
  (n.saveSettings as (s: unknown) => void)({ ...newDefaults, fov: 81 });
  const saved = JSON.parse(store.get('swg.settings') ?? '{}') as Record<string, unknown>;
  ok(Object.keys(saved).length === 1 && saved.fov === 81, 'and a changed file holds only what changed: no new key is written while it is at its default');
  store.clear();
}

// --- 2. the chain's decision ---
{
  const [oldReg, newReg] = await both('core/fxRegistry.ts');
  const [oldPostfx] = await both('core/postfx.ts');
  const oldPassWanted = (oldPostfx.PostFX as { prototype: { passWanted: (this: unknown, id: string) => boolean } }).prototype.passWanted;
  const fxPassWanted = newReg.fxPassWanted as (def: unknown, s: Record<string, unknown>, o?: boolean) => boolean;
  const newDefs = newReg.FX_PASSES as { id: string; toggles: string[]; required?: boolean; typical: boolean; budgetMs: number; requires?: string[] }[];
  const oldDefs = oldReg.FX_PASSES as { id: string; toggles: string[]; typical: boolean; budgetMs: number }[];
  const defaults = newReg.FX_DEFAULTS as Record<string, unknown>;
  let combos = 0;
  let agree = true;
  for (const od of oldDefs) {
    const nd = newDefs.find((d) => d.id === od.id);
    ok(!!nd && !nd.requires, `${od.id}: still a pass, with no requirement of its own`);
    if (!nd) continue;
    const keys = nd.toggles;
    for (let bits = 0; bits < 1 << keys.length; bits++) {
      for (const override of [undefined, true, false]) {
        for (const master of [false, true]) {
          const s: Record<string, unknown> = { ...defaults, volumetrics: master };
          keys.forEach((k, i) => (s[k] = !!(bits & (1 << i))));
          const fake = { byPassId: new Map([[od.id, {}]]), settings: s, override: override === undefined ? {} : { [od.id]: override } };
          combos++;
          if (oldPassWanted.call(fake, od.id) !== fxPassWanted(nd, s, override)) agree = false;
        }
      }
    }
  }
  ok(agree, `for every pass of the old chain, over ${combos} combinations of its switches, an override and the master, the registry's rule answers what the old passWanted answered`);
  const air = newDefs.find((d) => d.id === 'airVolume')!;
  ok(!!air && air.requires?.includes('volumetrics') === true && !oldDefs.some((d) => d.id === 'airVolume'), 'the volume is the one new pass, and requires the master');
  let unwanted = true;
  for (const v of [false, true]) for (const override of [undefined, true, false]) if (fxPassWanted(air, { ...defaults, volumetrics: false, airVolume: v }, override)) unwanted = false;
  ok(unwanted, 'with the master off the volume is unwanted whatever its own switch or an override says');
  const typical = (defs: { typical: boolean; budgetMs: number }[], products: { typical: boolean; budgetMs: number }[]) => Number([...defs, ...products].filter((d) => d.typical).reduce((s, d) => s + d.budgetMs, 0).toFixed(3));
  const oldTypical = typical(oldDefs, oldReg.FX_PRODUCTS as { typical: boolean; budgetMs: number }[]);
  const newTypical = typical(newDefs, newReg.FX_PRODUCTS as { typical: boolean; budgetMs: number }[]);
  ok(oldTypical === newTypical, `the typical frame's effects still come to ${newTypical} ms`);
  // The chain's own code calls the rule both places it decides.
  const postfx = readFileSync(join(NEW, 'core', 'postfx.ts'), 'utf8');
  ok(postfx.includes('return fxPassWanted(fxPassDef(id), this.settings, this.override[id]);') && postfx.includes('let on = fxPassWanted(def, this.settings, this.override[def.id]) && (def.required || pass.enabled(ctx));'), 'and the chain asks that rule both for passWanted and for its frame decision');
}

// --- 3. the programs' text ---
const THREE = (await import('three')) as typeof import('three');
const physical = () => ({ vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader, uniforms: {} as Record<string, unknown>, defines: {} as Record<string, unknown> });
{
  const [o, n] = await both('world/terrainTextures.ts');
  const tiles = (m: Mod) => {
    const s = physical();
    const done = (m.injectGroundTiles as (s: unknown, u: unknown) => boolean)(s, (m.makeGroundTileUniforms as () => unknown)());
    return { done, vs: s.vertexShader, fs: s.fragmentShader };
  };
  const a = tiles(o);
  const b = tiles(n);
  ok(a.done && b.done && a.vs === b.vs && a.fs === b.fs, `the ground's tile program: the same vertex and fragment text (${b.fs.length} characters)`);
  const matKey = (m: Mod) => {
    const mat = (m.groundTilesMaterial as (u: unknown, csm: null) => import('three').MeshStandardMaterial)((m.makeGroundTileUniforms as () => unknown)(), null);
    const s = physical();
    mat.onBeforeCompile(s as never, null as never);
    return { key: mat.customProgramCacheKey(), vs: s.vertexShader, fs: s.fragmentShader };
  };
  const ma = matKey(o);
  const mb = matKey(n);
  ok(ma.key === mb.key && ma.vs === mb.vs && ma.fs === mb.fs && mb.key === 'swg-ground-tiles-wet', `and its material's key (${mb.key}) and its text through its own hook`);
  const normal = (m: Mod) => {
    const s = physical();
    (m.injectGroundFamilies as (s: unknown, c: number, t: null, a: Float32Array, b: Float32Array) => void)(s, 16, null, new Float32Array(16), new Float32Array(16));
    const done = (m.injectGroundNormal as (s: unknown, n: null, scale: { value: number }) => boolean)(s, null, { value: 1 });
    return { done, fs: s.fragmentShader, vs: s.vertexShader };
  };
  const na = normal(o);
  const nb = normal(n);
  ok(na.done && nb.done && na.fs === nb.fs && na.vs === nb.vs, "the version-3 ground's families and bump injection: the same text");
}
{
  const [o, n] = await both('world/water.ts');
  const [lo, ln] = await both('world/waterLook.ts');
  const texts = (m: Mod, l: Mod) => {
    const out: string[] = [];
    const look = (l.waterLookFor as (s: null, d: null, p: { color: number; opacity: number }) => unknown)(null, null, { color: 0x335577, opacity: 0.6 });
    for (const waves of [true, false]) {
      for (const hooked of [false, true]) {
        const lit = (m.createWaterMaterial as (look: unknown, waves: boolean) => import('three').MeshPhysicalMaterial & { userData: unknown })(look, waves);
        const twins = [lit, (m.createWaterMaskMaterial as (lit: unknown, side: number) => import('three').MeshPhysicalMaterial)(lit, THREE.BackSide), (m.createWaterMaskMaterial as (lit: unknown, side: number) => import('three').MeshPhysicalMaterial)(lit, THREE.FrontSide)];
        for (const mat of twins) {
          if (hooked) mat.onBeforeCompile = (s) => void (s.fragmentShader += '\n// another hook');
          const s = physical();
          mat.onBeforeCompile(s as never, null as never);
          out.push(`${mat.customProgramCacheKey()}\n${JSON.stringify(mat.defines ?? {})}\n${s.vertexShader}\n${s.fragmentShader}`);
        }
      }
    }
    return out;
  };
  const a = texts(o, lo);
  const b = texts(n, ln);
  ok(a.length === 12 && b.length === 12, 'the water: lit and both mask twins, waves and flat, hooked and plain, twelve programs each tree');
  let same = true;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) same = false;
  ok(same, 'and every one is the same key, defines and text');
}
{
  const fold = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  ok(fold(join(OLD, 'world', 'waterSim.ts')) === fold(join(NEW, 'world', 'waterSim.ts')), "the ripples' module is the old one to the byte (its step's programs are its own and not exported): this wave touches nothing of it");
  const [o, n] = await both('world/lava.ts');
  const [so, sn] = await both('world/lavaStyle.ts');
  const lava = (m: Mod, s: Mod, crust: boolean) => {
    const tex = (m.standInLavaTextures as () => Record<string, unknown>)();
    const t = crust ? { ...tex, mix: tex.ramp } : tex;
    const mat = (m.createLavaMaterial as (style: unknown, size: number, t: unknown) => import('three').ShaderMaterial)(s.FALLBACK_LAVA_STYLE, 2, t);
    return `${mat.customProgramCacheKey()}\n${JSON.stringify(mat.defines)}\n${mat.vertexShader}\n${mat.fragmentShader}`;
  };
  ok(lava(o, so, false) === lava(n, sn, false) && lava(o, so, true) === lava(n, sn, true) && lava(n, sn, true).includes('"USE_MIX":""'), 'the lava with and without its crust: the same key, defines and text');
}

// --- 6. nothing runs ---
{
  const [o, n] = await both('vehicles/dust.ts');
  const g = globalThis as unknown as { document?: unknown };
  const make = (m: Mod) => {
    const ctx = { createRadialGradient: () => ({ addColorStop: () => undefined }), fillRect: () => undefined, fillStyle: '' };
    const was = g.document;
    g.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
    try {
      return new (m.Dust as new () => { spawn: (...a: unknown[]) => void; update: (dt: number) => void; points: import('three').Points })();
    } finally {
      g.document = was;
    }
  };
  const run = (m: Mod) => {
    const real = Math.random;
    let s = 2024;
    Math.random = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296);
    try {
      const d = make(m);
      const colour = new THREE.Color(0.7, 0.55, 0.4);
      for (let f = 0; f < 240; f++) {
        if (f % 3 === 0) d.spawn(f * 0.2, 1, -f * 0.1, 4 + (f % 5), 12, -3, 1.8, colour);
        d.update(f % 7 === 0 ? 1 / 30 : 1 / 144);
      }
      return d;
    } finally {
      Math.random = real;
    }
  };
  const a = run(o);
  const b = run(n);
  let same = true;
  for (const name of ['position', 'aAlpha', 'aSize', 'aColor']) {
    const x = a.points.geometry.getAttribute(name).array as Float32Array;
    const y = b.points.geometry.getAttribute(name).array as Float32Array;
    if (x.length !== y.length) same = false;
    for (let i = 0; i < x.length && same; i++) if (!Object.is(x[i], y[i])) same = false;
  }
  ok(same, "the dust pool's motes, with the dust or the master off, are the old pool's to the bit: the same spawns and steps, seeded alike");
}
{
  const { AirField, newAirFrameInput } = await import(pathToFileURL(join(NEW, 'world', 'volumetrics', 'airField.ts')).href);
  const { newVolTune } = await import(pathToFileURL(join(NEW, 'world', 'volumetrics', 'volSettings.ts')).href);
  const calls: string[] = [];
  let recording = false;
  const gl = new Proxy({}, { get: (_t, k) => (k === 'getExtension' ? () => ({}) : () => (recording && calls.push(`gl.${String(k)}`), 0)) });
  const stub = new Proxy({}, { get: (_t, k) => (k === 'getContext' ? () => gl : () => (recording && calls.push(String(k)), undefined)) });
  const tune = newVolTune();
  const field = new AirField(stub, tune, { ground: { sample: () => false }, boxes: null, hulls: [] });
  const inp = newAirFrameInput();
  inp.dt = 1 / 60;
  inp.reading = true;
  recording = true;
  for (let i = 0; i < 100; i++) field.update(inp);
  field.forces.blast(0, 0, 0, 7, 14, 0);
  field.forces.force(0, 0, 0, 1, 0, 1, 1, 16);
  field.forces.engine(0, 1, 0, 0, -1, 0, 40, 0, 0);
  recording = false;
  ok(calls.length === 0 && field.forces.oneCount === 0 && field.forces.engineCount === 0, 'with the master off the field touches no renderer and no GL call, and every force answers before touching anything');

  // The same once the window has been placed: the field stepped with the master on, then made to do nothing without
  // letting go of its targets (the player in a building, then the moving air turned off), so a force inside the window
  // is held back by the field's own `active` and by nothing else (an unplaced window would refuse it as off the window
  // whatever the guard said, which is how the check above could not fail).
  {
    tune.on = true;
    field.update(inp);
    ok(field.forces.active && field.win.placed, 'with the master on the field steps and its window is placed round the camera');
    const counts = { engines: 0, oneShots: 0, dust: 0, droppedSplats: 0, droppedDust: 0, offWindow: 0, notFinite: 0, blasts: 0, forces: 0 };
    for (const [why, set, unset] of [
      ['the player in a building', () => (inp.where = 'a test: indoors'), () => (inp.where = null)],
      ['the moving air off', () => (tune.air = false), () => (tune.air = true)],
    ] as const) {
      set();
      field.update(inp);
      field.forces.takeCounts(counts);
      field.forces.blast(0, 0, 0, 7, 14, 0);
      field.forces.force(0, 0, 0, 1, 0, 1, 1, 16);
      field.forces.engine(0, 1, 0, 0, -1, 0, 40, 0, 0);
      field.forces.takeCounts(counts);
      const none = Object.values(counts).every((n) => n === 0);
      ok(!field.forces.active && field.win.placed && field.forces.oneCount === 0 && field.forces.engineCount === 0 && field.forces.dustCount === 0 && none, `${why}, the window placed: a blast, a push and an engine at its middle are refused before anything is queued or counted (${JSON.stringify(counts)})`);
      unset();
    }
    tune.on = false;
    field.releaseTargets();
  }

  // --- 7. no resize disposes a material ---
  tune.on = true;
  let disposed = 0;
  for (const m of field.materials()) m.addEventListener('dispose', () => disposed++);
  const ensure = (field as unknown as { ensureTargets: () => boolean }).ensureTargets.bind(field);
  let resized = 0;
  for (const cells of [64, 96, 128, 160, 192]) {
    for (const dust of [2, 3, 4, 6]) {
      for (const light of [1, 2, 3]) {
        tune.airDetail = cells;
        tune.dustDetail = dust;
        tune.lightDetail = light;
        if (ensure()) resized++;
      }
    }
  }
  ok(resized === 60 && disposed === 0, `across every air, dust and light detail (${resized} resizes) no material was disposed: a program is never let go to be built again on a live frame`);
}

const ms = Math.round(performance.now() - t0);
ok(ms < 60000, `the proof took ${ms} ms, under a minute`);
console.log(`\n${checks} checks passed`);
