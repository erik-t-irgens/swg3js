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
//   4. the choosers (the second wave's): with the master off the ground's chooser hands every chunk today's tile
//      material by identity whatever else it is told, the sweep compiles no ground stand-in, and every footstep is
//      today's decal;
//   5. the weather (the fourth wave's): its own particle shader's text and uniforms are the old ones, its rain and snow
//      sheets start whole with nothing of ours on its pass, and its pass draws and stencils as the old one did;
//   6c. the wind's lines (the seventh wave's first half): the weather stepped through both trees with the unified wind's
//      arm off three ways (the master off, its switch off, its art at nought), every wind reader frame for frame the
//      old weather's; nothing of it made; the flora's sway wrap the old one's with the trees' form off;
//   6. nothing runs: the field with the master off answers and the renderer is never touched, and the dust pool's
//      motes (the dust or the master off) are the old pool's to the bit, the same spawns and steps, seeded alike;
//   7. no resize, of any of the field's detail dials (the sand's and the prints' with them), disposes a material.
//
// (The installed passes, every program the game links and the zero-dial picture are the browser's, §4.2.) It fails
// loudly when git cannot answer.
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
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
  const fxPassWanted = newReg.fxPassWanted as (def: unknown, s: Record<string, unknown>, o?: boolean, yielded?: (id: string) => boolean) => boolean;
  // A chain holding nothing a pass yields to (the master off never registers the clouds of W7b): its `yielded` answers no.
  const noYield = (): boolean => false;
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
          if (oldPassWanted.call(fake, od.id) !== fxPassWanted(nd, s, override, noYield)) agree = false;
        }
      }
    }
  }
  ok(agree, `for every pass of the old chain, over ${combos} combinations of its switches, an override and the master, the registry's rule answers what the old passWanted answered (on a chain holding nothing it yields to)`);
  const air = newDefs.find((d) => d.id === 'airVolume')!;
  const newPasses = newDefs.filter((d) => !oldDefs.some((o2) => o2.id === d.id)).map((d) => d.id);
  ok(!!air && air.requires?.includes('volumetrics') === true && newPasses.length === 2 && newPasses.includes('airVolume') && newPasses.includes('airClouds') && newDefs.find((d) => d.id === 'airClouds')!.requires?.includes('volumetrics') === true, 'the volume and the clouds are the two new passes, and each requires the master');
  // W7b's `yieldsTo` (the design's §4.1 item 6c): the September row alone names it, it names the clouds alone, and the
  // decision over every combination of the September switch, the clouds' switch, the master and the effects -- with the
  // registry's own answer for whether the clouds are wanted, so nothing is stood in -- is the old chain's wherever the
  // master is off; with it on and the clouds' switch on the September pass yields, and with the clouds' off decides as
  // the old one did.
  {
    const yields = (newDefs as { id: string; yieldsTo?: string[] }[]).filter((d) => d.yieldsTo && d.yieldsTo.length);
    ok(yields.length === 1 && yields[0].id === 'volumetricClouds' && yields[0].yieldsTo!.length === 1 && yields[0].yieldsTo![0] === 'airClouds', "`yieldsTo` is on the September clouds' row alone, and names the volumetrics' clouds alone");
    const od = oldDefs.find((d) => d.id === 'volumetricClouds')!;
    const nd = newDefs.find((d) => d.id === 'volumetricClouds')!;
    let same = true;
    let yieldsOn = true;
    let todayOff = true;
    let n = 0;
    for (const sept of [false, true]) {
      for (const clouds of [false, true]) {
        for (const master of [false, true]) {
          for (const effects of [false, true]) {
            for (const override of [undefined, true, false]) {
              const s: Record<string, unknown> = { ...defaults, volumetricClouds: sept, volClouds: clouds, volumetrics: master, effects };
              const fake = { byPassId: new Map([[od.id, {}]]), settings: s, override: override === undefined ? {} : { [od.id]: override } };
              const was = oldPassWanted.call(fake, od.id);
              const now = fxPassWanted(nd, s, override);
              n++;
              if (!master && was !== now) same = false;
              if (master && clouds && now) yieldsOn = false;
              if (master && !clouds && was !== now) todayOff = false;
            }
          }
        }
      }
    }
    ok(same && yieldsOn && todayOff, `the September clouds' decision over ${n} combinations of its switch, the clouds', the master, the effects and an override: the old chain's wherever the master is off, yielding while the clouds are wanted, and the old chain's again with the clouds' switch off`);
  }
  let unwanted = true;
  for (const v of [false, true]) for (const override of [undefined, true, false]) if (fxPassWanted(air, { ...defaults, volumetrics: false, airVolume: v }, override)) unwanted = false;
  ok(unwanted, 'with the master off the volume is unwanted whatever its own switch or an override says');
  const typical = (defs: { typical: boolean; budgetMs: number }[], products: { typical: boolean; budgetMs: number }[]) => Number([...defs, ...products].filter((d) => d.typical).reduce((s, d) => s + d.budgetMs, 0).toFixed(3));
  const oldTypical = typical(oldDefs, oldReg.FX_PRODUCTS as { typical: boolean; budgetMs: number }[]);
  const newTypical = typical(newDefs, newReg.FX_PRODUCTS as { typical: boolean; budgetMs: number }[]);
  ok(oldTypical === newTypical, `the typical frame's effects still come to ${newTypical} ms`);
  // The chain's own code calls the rule both places it decides.
  const postfx = readFileSync(join(NEW, 'core', 'postfx.ts'), 'utf8');
  ok(postfx.includes('return fxPassWanted(fxPassDef(id), this.settings, this.override[id], this.yielded);') && postfx.includes('let on = fxPassWanted(def, this.settings, this.override[def.id], this.yielded) && (def.required || pass.enabled(ctx));') && postfx.includes('private readonly yielded = (id: FxPassId): boolean => this.passWanted(id);'), 'and the chain asks that rule both for passWanted and for its frame decision, a pass that yields asking the chain itself whether what it yields to is on it and wanted');
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
  // The ripples (the fifth wave hangs a carry on them, `setRippleCarry`, only with the master and the current on): with
  // no carry hung, the old module's step and today's make the same draws, in the same order, into the same targets, with
  // the same step uniforms (the scroll, the state read, the pokes, the coupling and the damping) over a run of frames of
  // every kind -- a first frame, frames the window slides on, frames with no step at all, a poke -- through a renderer
  // that records rather than draws. Their step's text is the old one too, and the module only grew.
  const [wo, wn] = await both('world/waterSim.ts');
  const record = (m: Mod): string[] => {
    const calls: string[] = [];
    const targets: unknown[] = [];
    const id = (t: unknown): number => {
      if (t === null) return -1;
      let i = targets.indexOf(t);
      if (i < 0) i = targets.push(t) - 1;
      return i;
    };
    let target: unknown = null;
    const gl = { getExtension: (n: string) => (n === 'EXT_color_buffer_float' || n === 'OES_texture_float_linear' ? {} : null) };
    const renderer = {
      getContext: () => gl,
      getRenderTarget: () => target,
      setRenderTarget: (t: unknown) => {
        target = t;
      },
      clear: () => void calls.push(`clear ${id(target)}`),
      render: (scene: { children: { material?: { uniforms?: Record<string, { value: unknown }> } }[] }) => {
        const mat = scene.children[0]?.material;
        const u = mat?.uniforms;
        if (u && u.uScroll) {
          const s = u.uScroll.value as import('three').Vector2;
          const pokes = (u.uPokes.value as import('three').Vector4[]).map((p) => p.toArray().map((v) => v.toFixed(6)).join(',')).join(';');
          calls.push(`step into ${id(target)} from ${id((u.uState.value as unknown) ?? null)} scroll ${s.x.toFixed(9)},${s.y.toFixed(9)} c2 ${u.uC2.value} damp ${u.uDamp.value} pokes ${pokes}`);
        } else calls.push(`splat into ${id(target)}`);
      },
      autoClear: true,
      getClearAlpha: () => 1,
      getClearColor: (c: import('three').Color) => c,
      setClearColor: () => undefined,
    };
    (m.configureWaterSim as (s: unknown) => void)({ waterRipples: true, waterRippleDetail: 512, waterRippleHeight: 1, waterRipplePersistence: 0.85 });
    const step = m.stepWaterSim as (r: unknown, x: number, z: number, y: number, dt: number, cy?: number) => void;
    let x = 10;
    let z = -4;
    for (let f = 0; f < 60; f++) {
      if (f === 7) (m.pokeWaterSim as (x: number, z: number, s: number, r: number) => void)(x + 3, z - 2, 0.6, 1.2);
      x += f % 5 === 0 ? 0.9 : 0.05;
      z -= f % 3 === 0 ? 0.4 : 0;
      step(renderer, x, z, 0, f % 4 === 1 ? 1 / 240 : 1 / 60, 3);
      calls.push(`frame ${f} tex ${id((m.WATER_SIM_TEX as { value: unknown }).value)}`);
    }
    (m.disposeWaterSim as () => void)();
    return calls;
  };
  const a = record(wo);
  const b = record(wn);
  let same = a.length === b.length && a.length > 100;
  for (let i = 0; i < a.length && same; i++) if (a[i] !== b[i]) same = false;
  ok(same, `the ripples with no carry hung: the old step's ${a.length} draws and frames, in order, into the same targets with the same uniforms`);
  ok((wn.rippleCarrySet as () => boolean)() === false, 'and no carry is hung unless the world hangs one');
  const fold = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  const stepText = (t: string) => t.slice(t.indexOf('const STEP_FRAG'), t.indexOf('interface Rig'));
  ok(stepText(fold(join(OLD, 'world', 'waterSim.ts'))) === stepText(fold(join(NEW, 'world', 'waterSim.ts'))) && stepText(fold(join(NEW, 'world', 'waterSim.ts'))).length > 1000, "the ripples' step program's text is the old one to the byte");
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
  ok(calls.length === 0 && field.forces.oneCount === 0 && field.forces.engineCount === 0 && field.forces.frontCount === 0, "with the master off the field touches no renderer and no GL call, and every force answers before touching anything (wave 2b's fronts' table included)");

  // The same once the window has been placed: the field stepped with the master on, then made to do nothing without
  // letting go of its targets (the player in a building, then the moving air turned off), so a force inside the window
  // is held back by the field's own `active` and by nothing else (an unplaced window would refuse it as off the window
  // whatever the guard said, which is how the check above could not fail).
  {
    tune.on = true;
    field.update(inp);
    ok(field.forces.active && field.win.placed, 'with the master on the field steps and its window is placed round the camera');
    const counts = { engines: 0, oneShots: 0, dust: 0, droppedSplats: 0, droppedDust: 0, offWindow: 0, notFinite: 0, blasts: 0, forces: 0, fronts: 0, droppedFronts: 0 };
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
      ok(!field.forces.active && field.win.placed && field.forces.oneCount === 0 && field.forces.engineCount === 0 && field.forces.dustCount === 0 && field.forces.frontCount === 0 && none, `${why}, the window placed: a blast, a push and an engine at its middle are refused before anything is queued or counted (${JSON.stringify(counts)})`);
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
  // The second wave's details: the carried offsets' and the dents' targets made again at every size, the same.
  tune.sand = true;
  tune.prints = true;
  let sized = 0;
  const dents = (field as unknown as { dents: { target: { width: number } | null } | null }).dents;
  for (const sand of [2, 3, 4, 6]) {
    for (const print of [1024, 2048, 4096]) {
      tune.sandDetail = sand;
      tune.printDetail = print;
      ensure();
      if (dents?.target?.width === print) sized++;
    }
  }
  ok(sized === 12 && disposed === 0, `across every sand and print detail (${sized} sizes, the dents' target at each) no material was disposed`);
  tune.on = false;
  field.releaseTargets();
}

// --- 6b. the shared modules wave 2b edits, each held to the old tree with the master off ---
{
  // `terrainTextures.ts` exports the text of its own tint and decode and interpolates it back where it stood (item 3
  // holds the tile program's whole text and key above); here, that the exported text is exactly the old program's.
  const [o, n] = await both('world/terrainTextures.ts');
  const tiles = (m: Mod) => {
    const s = physical();
    (m.injectGroundTiles as (s: unknown, u: unknown) => boolean)(s, (m.makeGroundTileUniforms as () => unknown)());
    return s;
  };
  const a = tiles(o);
  const tint = n.GROUND_TINT_GLSL as string;
  const decode = n.GROUND_DECODE_GLSL as string;
  ok(typeof tint === 'string' && typeof decode === 'string' && a.vertexShader.split(tint).length === 2 && a.fragmentShader.split(decode).length === 2, "the tile program's own tint and decode, exported, are the old program's text to the byte, each once at its place");
  // `toneColour` at a tone of nought is `averageColor`, the same walk, by Object.is: called on a stand-in of the
  // textures' own fields (a two-layer picture of random bytes), through the old class's averageColor and the new's.
  const size = 64;
  const data = new Uint8Array(size * size * 4 * 2);
  let s = 99;
  for (let i = 0; i < data.length; i++) data[i] = (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) >>> 24;
  const stand = () => ({ layerIndex: new Map([[7, 1], [3, 0]]), averages: new Map(), texture: { image: { data, width: size, height: size } } });
  const OldTT = o.TerrainTextures as { prototype: { averageColor(f: number): import('three').Color | null } };
  const NewTT = n.TerrainTextures as { prototype: { averageColor(f: number): import('three').Color | null; toneColour(f: number, tone: number, out: import('three').Color): import('three').Color | null } };
  let same = true;
  for (const f of [3, 7]) {
    const was = OldTT.prototype.averageColor.call(stand(), f)!;
    const now = NewTT.prototype.averageColor.call(stand(), f)!;
    const tone = NewTT.prototype.toneColour.call(stand(), f, 0, new THREE.Color())!;
    if (!Object.is(was.r, now.r) || !Object.is(was.g, now.g) || !Object.is(was.b, now.b)) same = false;
    if (!Object.is(was.r, tone.r) || !Object.is(was.g, tone.g) || !Object.is(was.b, tone.b)) same = false;
  }
  ok(same && NewTT.prototype.toneColour.call(stand(), 99, 0.5, new THREE.Color()) === null, "averageColor is the old one's, and toneColour at a tone of nought is it to the bit (null for a family with no picture)");
}
{
  // `terrain.ts` keeps the chunk's colour-map bytes beside its families and answers them (`colourIdAt`): over a real
  // world's built chunk, `familyIdAt`, `familyAt` and `surfaceAt` (what the feet read) are the old tree's at every pole,
  // and `colourIdAt` the pole's own bytes. A machine with no converted world says so and checks nothing here.
  const packs = process.env.SWG3JS_PACKS ?? join(REPO, 'assets-private');
  const world = ['tatooine', 'naboo'].find((w) => {
    try {
      readFileSync(join(packs, w, 'terrain.trn'));
      readFileSync(join(packs, w, 'layout.json'));
      return true;
    } catch {
      return false;
    }
  });
  if (!world) console.log(`note no converted Tatooine or Naboo under ${packs}: the terrain's family and colour reads are not held here`);
  else {
    const dir = join(packs, world);
    const bytes = (rel: string): ArrayBuffer | null => {
      try {
        const b = readFileSync(join(dir, rel));
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      } catch {
        return null;
      }
    };
    const m = /"center"\s*:\s*\{\s*"x"\s*:\s*(-?[\d.]+)\s*,\s*"z"\s*:\s*(-?[\d.]+)/.exec(readFileSync(join(dir, 'layout.json'), 'utf8').slice(0, 8000))!;
    const cx = Number(m[1]);
    const cz = Number(m[2]);
    const planet = { id: 'test', seed: 1, palette: { low: 0x808080, mid: 0x808080, high: 0x808080, slope: 0x808080, shore: 0x808080 }, terrain: { base: 0, amplitude: 10, frequency: 0.01, octaves: 1, ridged: 0, flatten: 1, detail: 0 }, water: null };
    type T = { attachSwg(s: unknown): void; tiler: unknown; prepareChunk(x: number, z: number, b: boolean): void; buildChunk(x: number, z: number): { origin: { x: number; z: number } }; familyIdAt(x: number, z: number): number; familyAt(x: number, z: number): number | null; surfaceAt(x: number, z: number): string | null; colourIdAt?(x: number, z: number): number };
    const build = async (root: string): Promise<{ t: T; swg: { groundIfCached(x: number, z: number, out: { color: number }): boolean } }> => {
      const S = (await load(root, 'world/swgTerrain.ts')).SwgTerrain as { create(trn: ArrayBuffer, a: unknown[], x: number, z: number, f: (file: string) => Promise<ArrayBuffer | null>): Promise<unknown> };
      const TT = (await load(root, 'world/terrain.ts')).Terrain as new (p: unknown) => T;
      const swg = await S.create(bytes('terrain.trn')!, [], cx, cz, async (file) => bytes(file));
      const t = new TT(planet);
      t.attachSwg(swg);
      const order = new Map<number, number>();
      t.tiler = { rank: (f: number) => order.get(f) ?? f, layer: (f: number) => f, corners: [0, 1, 2, 3], census: new Float64Array(5) };
      t.prepareChunk(1, -1, true);
      t.buildChunk(1, -1);
      return { t, swg: swg as { groundIfCached(x: number, z: number, out: { color: number }): boolean } };
    };
    const old = await build(OLD);
    const now = await build(NEW);
    const origin = now.t.buildChunk(1, -1).origin;
    let fams = true;
    let cols = true;
    let poles = 0;
    const pole = { family: 0, choice: 0, color: 0 } as { color: number };
    for (let j = 0; j <= 32; j += 3) {
      for (let i = 0; i <= 32; i += 3) {
        const x = origin.x + i * 2;
        const z = origin.z + j * 2;
        // `familyIdAt` is the first wave's (the old tree has none): it answers by number what the old `familyAt` answers.
        const was = old.t.familyAt(x, z);
        if (was === null || was !== now.t.familyAt(x, z) || was !== now.t.familyIdAt(x, z) || old.t.surfaceAt(x, z) !== now.t.surfaceAt(x, z)) fams = false;
        if (now.swg.groundIfCached(x, z, pole)) {
          poles++;
          if (now.t.colourIdAt!(x, z) !== (pole.color & 0xffffff)) cols = false;
        }
      }
    }
    ok(fams, `${world}: on a built chunk the family the feet and the air's strips read (familyAt, surfaceAt, and familyIdAt by number) is the old tree's at every pole asked`);
    ok(cols && poles > 50, `and colourIdAt answers each pole's own colour-map bytes (${poles} poles), by number`);
    ok(now.t.colourIdAt!(origin.x + 5000, origin.z + 5000) === -1, 'and -1 where no chunk is built: a tint of one');
  }
}

// --- 4. the choosers (the second wave's): with the master off the ground is today's material, and no footprint is the air's ---
{
  const { groundMaterialFor, groundWearsAir } = await import(pathToFileURL(join(NEW, 'world', 'volumetrics', 'airGround.ts')).href);
  const plain = { name: 'plain' };
  const variant = { name: 'variant' };
  let every = true;
  let combos = 0;
  for (let bits = 0; bits < 32; bits++) {
    const c = { on: false, tiles: !!(bits & 1), sand: !!(bits & 2), prints: !!(bits & 4), field: !!(bits & 8), softOff: !!(bits & 16) };
    combos++;
    if (groundMaterialFor(c, plain, variant) !== plain || groundWearsAir(c) !== false || groundMaterialFor(c, plain, null) !== plain) every = false;
  }
  ok(every, `with the master off the chooser hands every chunk today's material, by identity, over all ${combos} combinations of the rest`);
  const world = readFileSync(join(NEW, 'world', 'world.ts'), 'utf8').replace(/\r\n/g, '\n');
  ok(/if \(this\.air && VOL_TUNE\.on\) \{\n\s+for \(const o of this\.groundStandInsFor\(this\.air\)\)/.test(world) && /groundStandInsFor\(air: AirField \| null\): THREE\.Mesh\[\] \{\n\s+if \(!air \|\| air\.refused !== null/.test(world), 'and the sweep compiles no ground stand-in: with the master off at an arrival there is no field, and with none there are none');
  const { AirField, newAirFrameInput } = await import(pathToFileURL(join(NEW, 'world', 'volumetrics', 'airField.ts')).href);
  const { newVolTune } = await import(pathToFileURL(join(NEW, 'world', 'volumetrics', 'volSettings.ts')).href);
  const gl = { getExtension: () => ({}) };
  const stub = new Proxy({}, { get: (_t, k) => (k === 'getContext' ? () => gl : () => undefined) });
  const field = new AirField(stub, newVolTune(), { ground: { sample: () => false }, boxes: null, hulls: [] });
  const inp = newAirFrameInput();
  inp.dt = 1 / 60;
  inp.reading = true;
  inp.ground = true;
  field.update(inp);
  const step = { key: 1, kind: 'player', label: 'you', surface: 'sand', from: 'terrain', x: 0, y: 0, z: 0, heading: 0, scale: 1, inside: false, deck: null, ground: null };
  ok(field.dentStep(step) === false && field.feetCounts.off === 1 && field.feetCounts.decal === 1 && field.feetCounts.dents === 0, "and every footstep is today's decal: the air answers no to it");
}

// --- 4b. the sixth wave's: with the master off the grass is today's material and its key, and nothing of the peers runs ---
{
  const [o, n] = await both('world/grass.ts');
  type Mat = { name: string; vertexShader: string; fragmentShader: string; defines: Record<string, unknown>; fog: boolean; side: number; shadowSide: number | null; customProgramCacheKey(): string; uniforms: Record<string, unknown> };
  const pairs: [string, Mat, Mat][] = [
    ['grass', (o.grassMaterial as () => Mat)(), (n.grassMaterial as () => Mat)()],
    ['grass depth', (o.grassDepthMaterial as () => Mat)(), (n.grassDepthMaterial as () => Mat)()],
  ];
  for (const [what, a, b] of pairs) {
    const key = (m: Mat): string => `${m.name}|${m.vertexShader}|${m.fragmentShader}|${JSON.stringify(m.defines)}|${m.fog}|${m.side}|${m.shadowSide}|${m.customProgramCacheKey()}|${Object.keys(m.uniforms).sort().join(',')}`;
    ok(key(a) === key(b), `the ${what} material: its text, defines, flags and uniform names byte for byte the old tree's (its program key unchanged)`);
  }
  ok(Object.keys(o.GRASS_UNIFORMS as object).join() === Object.keys(n.GRASS_UNIFORMS as object).join(), "the grass's own uniforms are the old ones");
  const { grassMaterialFor, grassWearsAir } = await import(pathToFileURL(join(NEW, 'world', 'volumetrics', 'airGrass.ts')).href);
  const plain = { name: 'plain' };
  const twin = { name: 'twin' };
  let every = true;
  let combos = 0;
  for (let bits = 0; bits < 64; bits++) {
    const c = { on: false, grass: !!(bits & 1), field: !!(bits & 2), softOff: !!(bits & 4), built: !!(bits & 8), casting: !!(bits & 16), depthDrawn: !!(bits & 32) };
    combos++;
    if (grassMaterialFor(c, plain, twin) !== plain || grassWearsAir(c) !== false) every = false;
  }
  ok(every, `with the master off the grass's chooser hands every chunk and far tile today's material, by identity, over all ${combos} combinations of the rest`);
  const world = readFileSync(join(NEW, 'world', 'world.ts'), 'utf8').replace(/\r\n/g, '\n');
  ok(/grassStandInsFor\(air: AirField \| null\): THREE\.Mesh\[\] \{\n\s+if \(!air \|\| air\.refused !== null \|\| !VOL_TUNE\.on\) return \[\];/.test(world) && /const twinTuft = VOL_TUNE\.on && this\.grassAirDepth && this\.grassAirStand \? this\.grassAirStand : null;/.test(world) && /private grassAirFor\(\): THREE\.ShaderMaterial \| null \{\n\s+if \(!VOL_TUNE\.on \|\| !this\.grassMat\) return this\.grassAirMat;/.test(world), "and nothing of the twin is made, compiled or drawn into the shadow maps with the master off");
  // The world's own hand-over into that chooser: the master as it is (with it off, the field the session kept and the
  // twin built long ago still leave the grass plain), the switch, a field built for the frames' target, the soft off.
  const GRASS_CHOICE_BODY = /private grassChoice\(air: AirField \| null\): ReturnType<typeof newGrassChoice> \{\n\s+const c = this\.grassAsk;\n\s+c\.on = VOL_TUNE\.on;\n\s+c\.grass = VOL_TUNE\.grass;\n\s+c\.field = air !== null && air\.refused === null && this\.airBuiltNow\(\);\n\s+c\.softOff = this\.grassSoftOff;\n\s+c\.built = this\.grassAirBuilt;\n/;
  ok(GRASS_CHOICE_BODY.test(world), "the world asks the grass's chooser the master as it stands, the switch, a field that runs and is built for the frames' target, and the frame report's soft off");
  ok(/const stirs = VOL_TUNE\.on && VOL_TUNE\.air && VOL_TUNE\.fromEngines/.test(world), "nor are other players' rides or a shuttle's engines asked for: the records stay empty");
  const { pushEngines } = await import(pathToFileURL(join(NEW, 'world', 'volumetrics', 'airEngines.ts')).href);
  const { AirForces } = await import(pathToFileURL(join(NEW, 'world', 'volumetrics', 'airForces.ts')).href);
  const { newNearRides } = await import(pathToFileURL(join(NEW, 'net', 'nearRides.ts')).href);
  const f = new AirForces();
  const rides = newNearRides(4);
  rides.n = 1;
  rides.kind[0] = 1;
  rides.flags[0] = 1;
  rides.vx[0] = 20;
  pushEngines([], f, rides, null);
  ok(f.engineCount === 0 && f.counts.peers === 0, "and a ride handed to a field that is off (the master off) is never taken");
}

// --- 5. the weather (the fourth wave's): with the master off its sheets, its pass and its own shader are today's ---
{
  const [o, n] = await both('world/weather.ts');
  type Shader = { vertex: string; fragment: string; uniforms: Record<string, { value: unknown }> };
  const so = o.WEATHER_PARTICLE_SHADER as Shader;
  const sn = n.WEATHER_PARTICLE_SHADER as Shader;
  ok(so.vertex === sn.vertex && so.fragment === sn.fragment && Object.keys(so.uniforms).join() === Object.keys(sn.uniforms).join() && (n.PARTICLE_UNIFORMS as unknown) === sn.uniforms, "the weather's own particle shader: the same text and uniforms, its uniform object now exported as it stands (the rain of ours holds it by reference)");
  type W = { draw(r: unknown, c: unknown, portalView: boolean): void; rainSheetScale?: number; snowSheetScale?: number; airRainDraws?: boolean; airMaterials?: unknown[]; scene: import('three').Scene };
  const make = (m: Mod): W => new (m.Weather as new (p: unknown) => W)({ world: null });
  const wo = make(o);
  const wn = make(n);
  ok(wn.rainSheetScale === 1 && wn.snowSheetScale === 1 && wn.airRainDraws === false && wn.airMaterials?.length === 0, "a weather made today starts with its rain and snow sheets whole, our rain not drawing and no material of ours on its pass");
  // The pass, drawn by both through a renderer that records what it was asked, over the sheets' quads and the view.
  const drawn = (w: W, quads: number, portalView: boolean): string => {
    const batch = new THREE.MeshBasicMaterial();
    (w as unknown as { fxEffects: unknown }).fxEffects = { quads, batchMaterials: [batch] };
    const calls: string[] = [];
    const renderer = { render: (scene: unknown) => calls.push(scene === w.scene ? 'scene' : 'other') };
    const camera = { layers: new THREE.Layers() };
    camera.layers.enableAll();
    w.draw(renderer, camera, portalView);
    return `${calls.join()}|${batch.stencilWrite}|${batch.stencilFunc}|${batch.stencilRef}|${batch.stencilZPass}|${camera.layers.mask}`;
  };
  let same = true;
  for (const quads of [0, 3]) for (const pv of [false, true]) if (drawn(wo, quads, pv) !== drawn(wn, quads, pv)) same = false;
  ok(same, "its pass, with the sheets' quads and none, outside and through a building's exits: the same draws and the same stencil as the old weather's");
  // Its view half stepped (`updateView`) through both trees over the same scripted frames, with no rain of ours: what
  // falls and what it weighs, the sheets' quads, the wet ground and nothing at all. Frame by frame each channel's rate
  // and alpha, and whether the roof grid cast, are the old weather's (§4.1 item 6b's fourth-wave half).
  const stepped = (w: W): string[] => {
    const x = w as unknown as Record<string, unknown>;
    let casts = 0;
    (x.roofs as { update: () => void }).update = () => void casts++;
    type Handle = { rateScale: number; alphaScale: number; file: string };
    let quads = 3;
    x.fxEffects = {
      get quads(): number {
        return quads;
      },
      batchMaterials: [],
      kill: null,
      place: (file: string): Handle => ({ rateScale: 0, alphaScale: 1, file }),
      move: (): void => undefined,
      remove: (): void => undefined,
      particlesOf: (h: Handle): number => (h.file.includes('fog') ? 0 : 5),
      soundsOf: (): string[] => [],
      update: (): void => undefined,
    };
    x.reason = null;
    x.sky = {};
    x.hasWeatherData = true;
    const files = x.wantFile as string[];
    const kinds = x.wantKind as string[];
    const weights = x.wantWeight as Float32Array;
    files.length = 0;
    kinds.length = 0;
    files.push('fx_rain_heavy.prt', 'fx_snow.prt', 'fx_dust.prt', 'fx_fog.prt');
    kinds.push('rain', 'snow', 'dust', 'fog');
    const wet = x.wet as { wetness: number; puddles: number; snowCover: number };
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(3, 1.7, -2);
    const ctx = { inside: false, aboard: false, underground: false, fog: null, groundAt: () => 0, waterAt: () => -Infinity, vehicles: [], hull: null, ridden: null };
    const out: string[] = [];
    for (let f = 0; f < 120; f++) {
      const phase = f < 30 ? 0 : f < 60 ? 1 : f < 90 ? 2 : 3;
      x.wantCount = phase === 3 ? 0 : 4;
      weights[0] = phase === 0 ? 0.8 : phase === 1 ? 0.2 : 0;
      weights[1] = phase === 1 ? 0.6 : 0;
      weights[2] = phase === 0 ? 0.3 : 0;
      weights[3] = phase < 2 ? 0.5 : 0;
      quads = phase === 0 ? 3 : 0;
      wet.puddles = phase === 2 ? 0.3 : 0;
      const before = casts;
      (w as unknown as { updateView(dt: number, c: unknown, ctx: unknown): void }).updateView(1 / 60, camera, ctx);
      const ch = (x.channels as { file: string; handle: Handle }[]).map((c) => `${c.file}:${c.handle.rateScale.toFixed(6)}:${c.handle.alphaScale}`).join('|');
      out.push(`${ch}#${casts - before}`);
    }
    return out;
  };
  const so5 = stepped(make(o));
  const sn5 = stepped(make(n));
  const diffAt = so5.findIndex((s, i) => s !== sn5[i]);
  const castFrames = so5.filter((s) => s.endsWith('#1')).length;
  ok(diffAt === -1 && so5.length === 120 && castFrames > 30 && castFrames < 120, `its view half over 120 scripted frames (rain, snow, dust and fog weighed in turn, the sheets' quads, wet ground, nothing): every channel's rate and alpha and every roof cast the old weather's (${castFrames} frames cast)${diffAt >= 0 ? `; first differs at frame ${diffAt}: ${so5[diffAt]} against ${sn5[diffAt]}` : ''}`);
}

// --- 6c. the wind's lines (the seventh wave's first half): with its arm off, today's weather to the bit ---
{
  // The weather's step through both trees over the same scripted frames, its sky a stand-in whose scale moves, the shared
  // clock (with no server, the wall clock) stood in: the heading, the speed, the water's and the flora's wind, the wet
  // state, the sky's wind and every channel's placement equal frame for frame by `Object.is` -- with the master off, again
  // with the master on and the unified wind's switch off, and again with its art at nought (the arm off each time).
  const [o, n] = await both('world/weather.ts');
  const [oWater, nWater] = await both('world/water.ts');
  const [oFlora, nFlora] = await both('world/floraSway.ts');
  const windNew = await load(NEW, 'world/wind.ts');
  const setWindArm = windNew.setWindArm as (o: { master: boolean; wind: boolean; devils: boolean; trees: boolean; art: number }) => void;
  const WIND_STATE = windNew.WIND_STATE as { on: boolean; decks: boolean };
  const madeBefore = (windNew.wind7UniformsMade as () => boolean)();
  type W = Record<string, unknown> & { update(dt: number, p: unknown, ctx: unknown): void; updateView(dt: number, c: unknown, ctx: unknown): void; state: Record<string, unknown> };
  const run = (m: Mod, water: Mod, flora: Mod, arm: { master: boolean; wind: boolean; art: number; decks?: boolean }): string[] => {
    setWindArm({ master: arm.master, wind: arm.wind, devils: true, trees: true, art: arm.art });
    // W7b's: a cloud deck of the new tree drawing (its feed sets the flag while its pass is wanted).
    WIND_STATE.decks = m === n && !!arm.decks;
    const w = new (m.Weather as new (p: unknown) => W)({ world: null });
    const x = w as unknown as Record<string, unknown>;
    const setWindArgs: number[] = [];
    let aloftFrames = 0;
    let meanApart = 0;
    const lighting = { windSpeedScale: 3, shadowScale: 1 };
    const blocks = [0, 1, 2, 3, 4].map((l) => ({ weatherIndex: l, windSpeedScale: 2 + l, cameraEffect: l >= 2 ? { file: l >= 3 ? 'fx_dust.prt' : 'fx_rain.prt', kind: l >= 3 ? 'dust' : 'rain', strength: 0.5 + l * 0.1 } : null }));
    x.sky = {
      lighting,
      data: { blocks, weather: { effects: null } },
      texturesReady: () => true,
      ensureTextures: () => Promise.resolve(),
      setMix: () => undefined,
      setWind: (h: number) => void setWindArgs.push(h),
      setOvercast: () => undefined,
      sheetAloft: new Float64Array(3),
      sheetAloftOn: false,
      mixLength: 0,
      mixBlock: () => null,
      mixWeights: new Float64Array(4),
    };
    x.reason = null;
    x.hasWeatherData = true;
    x.seed = 12345;
    x.weights = [0.3, 0.25, 0.2, 0.15, 0.1];
    x.levels = 5;
    x.current = { name: '', byLevel: Int16Array.from([0, 1, 2, 3, 4]) };
    type Handle = { rateScale: number; alphaScale: number; file: string };
    x.fxEffects = {
      quads: 0,
      batchMaterials: [],
      kill: null,
      place: (file: string): Handle => ({ rateScale: 0, alphaScale: 1, file }),
      move: (): void => undefined,
      remove: (): void => undefined,
      particlesOf: (): number => 5,
      soundsOf: (): string[] => [],
      update: (): void => undefined,
    };
    (x.roofs as { update: () => void }).update = () => undefined;
    const WW = water.WATER_WIND as { value: { x: number; y: number } };
    const FW = flora.FLORA_WIND as { x: number; z: number; strength: number };
    const wet = x.wet as { wetness: number; puddles: number; snowCover: number };
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(3, 1.7, -2);
    const player = new THREE.Vector3(10, 0, -4);
    const vctx = { inside: false, aboard: false, underground: false, fog: null, groundAt: () => 0, waterAt: () => -Infinity, vehicles: [], hull: null, ridden: null };
    const wctx = { daylight: 0.8, groundAt: () => 0 };
    const out: string[] = [];
    const realNow = Date.now;
    let now = 1.79e12;
    Date.now = () => now;
    try {
      for (let f = 0; f < 240; f++) {
        now += 1000 / 60 + (f % 7) * 3;
        lighting.windSpeedScale = 3 + 2.5 * Math.sin(f * 0.07);
        w.update(1 / 60, player, wctx);
        if ((x.sky as { sheetAloftOn: boolean }).sheetAloftOn) aloftFrames++;
        if (m === n && !Object.is(w.state.windMean, w.state.windSpeed)) meanApart++;
        w.updateView(1 / 60, camera, vctx);
        const ch = (x.channels as { file: string; matrix: THREE.Matrix4 }[]).map((c) => `${c.file}:${c.matrix.elements.join(',')}`).join('|');
        out.push([w.state.windHeading, w.state.windSpeed, WW.value.x, WW.value.y, FW.x, FW.z, FW.strength, wet.wetness, wet.puddles, wet.snowCover, setWindArgs[setWindArgs.length - 1], ch].map((v) => (typeof v === 'number' ? (Object.is(v, -0) ? '-0' : String(v)) : String(v))).join(';'));
      }
    } finally {
      Date.now = realNow;
    }
    // The new tree's sky is told nothing is held (today's drift) on every frame; the old one has no such flag. With a deck
    // of W7b's drawing it is handed the world's wind aloft on every frame instead, and nothing else of the weather moves.
    if (m === n && !arm.decks && aloftFrames !== 0) out.push('the sheets were handed a wind aloft with nothing held');
    if (m === n && arm.decks && aloftFrames !== 240) out.push(`the sheets were handed the world's wind aloft on ${aloftFrames} of 240 frames while a deck drew`);
    WIND_STATE.decks = false;
    // And its mean is the speed itself on every frame (what the September clouds' feed and the drying now read).
    if (m === n && meanApart !== 0) out.push(`the mean stood apart from the speed on ${meanApart} frames`);
    return out;
  };
  for (const arm of [
    { master: false, wind: true, art: 1, what: 'the master off' },
    { master: true, wind: false, art: 1, what: "the master on and the unified wind's switch off" },
    { master: true, wind: true, art: 0, what: "the master on and the wind's art at nought" },
    { master: true, wind: false, art: 1, decks: true, what: "the master on, the unified wind's switch off and a cloud deck of W7b's drawing (WIND_STATE.decks)" },
  ]) {
    const a = run(o, oWater, oFlora, arm);
    const b = run(n, nWater, nFlora, arm);
    const at = a.findIndex((s, i) => s !== b[i]);
    ok(!WIND_STATE.on && at === -1 && a.length === 240 && b.length === 240 && new Set(a.map((s) => s.split(';')[1])).size > 10, `the weather's wind lines with ${arm.what}: the heading, the speed, the water's and the flora's wind, the wet state, the sky's wind and every channel's placement over 240 frames equal to the old weather's by Object.is${at >= 0 ? `; first differs at frame ${at}: ${a[at]} against ${b[at]}` : ''}`);
  }
  setWindArm({ master: false, wind: true, devils: true, trees: true, art: 1 });
  // The uniform is made only by what the master on builds (the field, its pools, the grass's twin, the trees' form): the
  // field section 6 built above made it in this process, so its makers are held as text and the pattern by its absence.
  void madeBefore;
  const makers: string[] = [];
  const walk = (dir: string): void => {
    for (const e of (readdirSync(dir, { withFileTypes: true }) as import('node:fs').Dirent[])) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.ts') && readFileSync(p, 'utf8').includes('wind7Uniforms()')) makers.push(p.slice(NEW.length + 1).replace(/\\/g, '/'));
    }
  };
  walk(NEW);
  const allowed = ['world/wind.ts', 'world/windTrees.ts', 'world/windSelfTest.ts', 'world/volumetrics/airField.ts', 'world/volumetrics/airParticles.ts', 'world/volumetrics/airRain.ts', 'world/volumetrics/airGrass.ts'];
  ok((windNew.windPattern as () => unknown)() === null && makers.every((m) => allowed.includes(m)), `and nothing of the unified wind is made by the weather with its arm off: no pattern, and its one uniform asked for only by what the master on builds (${makers.join(', ')})`);
  // The sky's sheets with nothing held: `sheetWind(null, …)` keeps today's drift line (the sheets' own test, `sky.ts`).
  const skySrc = readFileSync(join(NEW, 'world', 'sky.ts'), 'utf8').replace(/\r\n/g, '\n');
  ok(/sheetWind\(bottom: number \| null, top: number \| null, veer: number\): void \{/.test(skySrc) && /if \(!this\.sheetAloftOn\) \{\n\s+\/\/ Drift in texture repeats per second: the client's wind, but never quite still\.\n\s+const perSecond = Math\.max\(\(layer\.speed \* L\.windSpeedScale\) \/ size, CLOUD_MIN_DRIFT\);\n\s+\/\/ Toward the wind's heading, as the rain leans and the dust blows\.\n\s+driftScroll\(scroll\.s, this\.windHeading, perSecond, dt\);/.test(skySrc), "the sky's sheets take a wind aloft only when one is handed them, today's drift line otherwise");
  // The flora's wrap and its depth materials with the trees' form off: the same injected text and keys as the old tree's.
  const wrapOf = (m: Mod): ((mat: THREE.Material) => void) | null => (typeof m.swayWrap === 'function' ? (m.swayWrap as (mat: THREE.Material) => void) : null);
  const oWrap = wrapOf(oFlora);
  const nWrap = wrapOf(nFlora);
  if (oWrap && nWrap) {
    const text = (wrap: (mat: THREE.Material) => void): string => {
      const mat = new THREE.MeshStandardMaterial();
      mat.userData.swgSway = 'a stand-in planting';
      wrap(mat);
      const shader = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} as Record<string, unknown>, defines: {} };
      mat.onBeforeCompile?.(shader as unknown as THREE.WebGLProgramParametersWithUniforms, undefined as unknown as THREE.WebGLRenderer);
      return `${mat.customProgramCacheKey()}|${shader.vertexShader}|${Object.keys(shader.uniforms).sort().join()}`;
    };
    const a = text(oWrap);
    const b = text(nWrap);
    ok(a === b && a.includes('swgSwayOffset'), "the flora's sway wrap with the trees' form off: the same injected text, uniforms and key as the old tree's");
  } else ok(false, 'both trees export swayWrap');
  // Its depth materials and the depth combinations the screens draw, with the form off: today's text, uniforms and keys.
  type DepthFor = (m: THREE.Material) => THREE.MeshDepthMaterial;
  type Combos = (form?: boolean) => THREE.Mesh[];
  const depthText = (depthFor: DepthFor, combos: Combos): string => {
    const src = new THREE.MeshStandardMaterial();
    src.userData.swgSway = 'a stand-in planting';
    const parts: string[] = [];
    for (const d of [depthFor(src), ...combos().map((c) => depthFor(c.material as THREE.Material))]) {
      const shader = { vertexShader: THREE.ShaderLib.depth.vertexShader, fragmentShader: THREE.ShaderLib.depth.fragmentShader, uniforms: {} as Record<string, unknown>, defines: {} };
      d.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, undefined as unknown as THREE.WebGLRenderer);
      parts.push(`${d.customProgramCacheKey()}|${shader.vertexShader}|${Object.keys(shader.uniforms).sort().join()}`);
    }
    return `${combos().length}#${parts.join('##')}`;
  };
  const oD = depthText(oFlora.swayDepthFor as DepthFor, oFlora.swayDepthCombos as Combos);
  const nD = depthText(nFlora.swayDepthFor as DepthFor, nFlora.swayDepthCombos as Combos);
  ok(oD === nD && oD.startsWith('12#') && oD.includes('swg-sway-depth|'), "and its depth materials and the twelve depth combinations a screen draws, with the form off: the same injected text, uniforms and keys as the old tree's");
  // The grass's own material and its depth material with the master off are held to the old tree's, text and key, in 4b
  // above (the wave's lean and sheen live in the twin, which the master off never makes); here, that its module reads
  // nothing of the unified wind. And the September clouds' feed takes the mean, the speed itself with the arm off (held
  // above, frame for frame).
  const newGrass = readFileSync(join(NEW, 'world', 'grass.ts'), 'utf8');
  ok(!newGrass.includes('uWind7') && !/\bw7[A-Z]/.test(newGrass) && !newGrass.includes('wind.ts'), "the grass's own module reads nothing of the unified wind: its lean and sheen are the twin's alone");
  const oldMain = readFileSync(join(OLD, 'main.ts'), 'utf8').replace(/\r\n/g, '\n');
  const newMain = readFileSync(join(NEW, 'main.ts'), 'utf8').replace(/\r\n/g, '\n');
  const oldFeed = /const look = cloudLook\(.*\);/.exec(oldMain)?.[0] ?? '';
  const newFeed = /const look = cloudLook\(.*\);/.exec(newMain)?.[0] ?? '';
  ok(oldFeed.includes('on ? w.windSpeed : 0') && newFeed === oldFeed.replace('on ? w.windSpeed : 0', 'on ? w.windMean : 0'), "the September clouds' feed reads the mean where it read the speed and nothing else moved (the mean the speed itself with the arm off, frame for frame above)");
}

// --- 6d. the clouds' lines (the seventh wave's second half): with no deck drawing, today's sheets and September clouds ---
{
  // The sky's sheets stepped through both trees' `SwgSky` over the same scripted mixes -- two areas crossfading, a row
  // with a top sheet alone, a picture still loading, a weather row with none -- every sheet's opacity, map, repeat,
  // scroll and visibility, and the lens flare's read of them (`cloudLayers`), equal frame for frame by `Object.is` with
  // nothing kept over a deck (the master off: nothing calls `cloudImages` or `keepTopSheets`).
  const [oSky, nSky] = await both('world/sky.ts');
  const cloud = (file: string, size: number, speed: number) => ({ file, size, speed });
  const row = (name: string, weatherIndex: number, bottom: ReturnType<typeof cloud> | null, top: ReturnType<typeof cloud> | null) => ({ name, weatherIndex, gradientSky: null, cloudBottom: bottom, cloudTop: top, ramp: null, shadows: true, fog: { enabled: false, min: 0, max: 0 }, dayEnvironment: null, nightEnvironment: null, windSpeedScale: 2 + weatherIndex });
  const blocks = [
    row('a', 0, cloud('texture/a_low.png', 9, 1.5), cloud('texture/a_high.png', 14, 2.5)),
    row('b', 0, cloud('texture/b_low.png', 7, 0.8), null),
    row('a', 2, null, cloud('texture/loading.png', 12, 3)),
    row('a', 3, null, null),
  ];
  type Sky = Record<string, unknown> & { setMix(b: unknown[], w: ArrayLike<number>, n: number): void; cloudLayers(out: unknown[]): number };
  const make = (m: Mod): Sky => {
    const textures = new Map<string, unknown>();
    // Every picture up but one, which stays loading (no load is started: it is marked failed, as a picture that never comes).
    for (const f of ['texture/a_low.png', 'texture/a_high.png', 'texture/b_low.png']) {
      const t = new THREE.Texture({ width: 64, height: 64 });
      t.name = f;
      textures.set(f, t);
    }
    const data = { planet: 'test', dayNightSplit: 0.5, sunElevationDegrees: 60, sun: null, supplementalSun: null, moon: null, supplementalMoon: null, celestials: [], stars: null, nightSky: null, skybox: null, blocks };
    const S = m.SwgSky as new (d: unknown, t: unknown, p: unknown, f: Set<string>) => Sky;
    return new S(data, textures, { root: '/nowhere/' }, new Set(['texture/loading.png']));
  };
  const L = { windSpeedScale: 3, main: new THREE.Color(1, 0.9, 0.8) };
  const trace = (sky: Sky): string[] => {
    const out: string[] = [];
    const cam = new THREE.Vector3(5, 40, -3);
    const layers = Array.from({ length: 4 }, () => ({ texture: null, altitude: 0, repeat: 0, scroll: new THREE.Vector2(), opacity: 0, fade: new THREE.Vector2(), texels: 0 }));
    const update = (sky as unknown as { updateClouds(slot: 0 | 1, l: unknown, day: boolean, c: THREE.Vector3, dt: number): void }).updateClouds;
    const pools = (sky as unknown as { clouds: { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> }[] }).clouds;
    for (let f = 0; f < 300; f++) {
      const t = f / 299;
      // Two areas crossfading, then the storm rows coming in with the weather.
      const w = f < 150 ? [1 - t * 2, t * 2, 0, 0] : [0.6 - (t - 0.5), 0.2, 0.2 + (t - 0.5) * 0.6, 0.4 * (t - 0.5)];
      const sum = w.reduce((a, b) => a + Math.max(0, b), 0);
      sky.setMix(blocks, w.map((v) => Math.max(0, v) / sum), 4);
      L.windSpeedScale = 3 + Math.sin(f * 0.05);
      update.call(sky, 0, L, f % 97 < 60, cam, 1 / 60);
      update.call(sky, 1, L, f % 97 < 60, cam, 1 / 60);
      const sheets = pools.map((c) => {
        const u = c.mesh.material.uniforms;
        const s = u.uScroll.value as THREE.Vector2;
        return [u.uOpacity.value, (u.uMap.value as THREE.Texture).name || 'white', u.uRepeat.value, s.x, s.y, c.mesh.visible].join(',');
      });
      const n = sky.cloudLayers(layers);
      const flare = layers.slice(0, n).map((l) => [(l.texture as THREE.Texture | null)?.name, l.altitude, l.repeat, l.scroll.x, l.scroll.y, l.opacity].join(',')).join('/');
      out.push(`${sheets.join('|')}#${flare}`);
    }
    return out;
  };
  const a = trace(make(oSky));
  const nsky = make(nSky);
  const b = trace(nsky);
  const at = a.findIndex((s, i) => s !== b[i]);
  ok(at === -1 && a.length === 300 && new Set(a).size > 100, `the sky's four sheets over 300 frames of crossfading areas, a top sheet alone, a picture still loading and a row with none: every opacity, map, repeat, scroll and visibility and the lens flare's read of them equal to the old sky's, with no deck drawing${at >= 0 ? `; first differs at frame ${at}: ${a[at]} against ${b[at]}` : ''}`);
  // The grouping is written once: `cloudImages` reads the very grouping `updateClouds` draws, and reads only.
  const NS = nsky as unknown as { cloudImages(slot: 0 | 1, out: { images: Record<string, unknown>[] }): void; keepTopSheets(s: number): void; sheets: boolean; clouds: { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>; file: string | null }[]; cloudScroll: Map<string, { s: THREE.Vector2 }> };
  const im = () => ({ images: [{} as Record<string, unknown>, {} as Record<string, unknown>] });
  const scrollsBefore = [...NS.cloudScroll.values()].map((v) => `${v.s.x},${v.s.y}`).join('|');
  const bot = im();
  const top = im();
  NS.cloudImages(0, bot);
  NS.cloudImages(1, top);
  const scrollsAfter = [...NS.cloudScroll.values()].map((v) => `${v.s.x},${v.s.y}`).join('|');
  const sheetFile = (i: number) => NS.clouds[i].file;
  const sheetOp = (i: number) => NS.clouds[i].mesh.material.uniforms.uOpacity.value as number;
  const matches = [0, 1].every((m) => (bot.images[m].file ?? null) === sheetFile(m) && (bot.images[m].texture ? Object.is(bot.images[m].weight, sheetOp(m)) : true)) && [0, 1].every((m) => (top.images[m].file ?? null) === sheetFile(2 + m) && (top.images[m].texture ? Object.is(top.images[m].weight, sheetOp(2 + m)) : true));
  ok(matches && scrollsBefore === scrollsAfter && scrollsBefore.length > 0, "`cloudImages` hands each deck the very images and weights the sheets were drawn with, and moves no scroll and starts no load");
  // `keepTopSheets`: with the sheets down, the top pair keeps that share of its opacity and the bottom pair stays hidden;
  // nought hides them all again, and with the sheets up it changes nothing.
  NS.sheets = false;
  NS.keepTopSheets(0.5);
  update0(nsky);
  const kept = NS.clouds.map((c) => `${c.mesh.visible}:${c.mesh.material.uniforms.uOpacity.value}`);
  // Each kept top sheet's opacity is its own weight this frame (what the sheets would have drawn) times the share kept,
  // and its weight is still the whole (the lens flare reads the weight, never what is kept of it).
  const weights = (nsky as unknown as { sheetWeights: Float64Array | Float32Array | number[] }).sheetWeights;
  const keptOps = [2, 3].map((i) => NS.clouds[i].mesh.material.uniforms.uOpacity.value as number);
  const shared = [2, 3].every((i, m) => !NS.clouds[i].file || weights[i] <= 0.002 || Object.is(keptOps[m], weights[i] * 0.5)) && [2, 3].some((i) => !!NS.clouds[i].file && weights[i] > 0.002);
  NS.keepTopSheets(0);
  update0(nsky);
  const none = NS.clouds.every((c) => !c.mesh.visible);
  NS.sheets = true;
  ok(none && shared && kept[0].startsWith('false') && kept[1].startsWith('false') && NS.clouds.slice(2).some((c) => !!c.file) && kept.slice(2).some((k) => k.startsWith('true')), `keepTopSheets keeps the top sheets at exactly that share of their own weight over a deck (${kept.join(' ')}; weights ${[2, 3].map((i) => weights[i]).join(', ')}) and nought hides every sheet`);
  function update0(sky: Sky): void {
    const u = (sky as unknown as { updateClouds(slot: 0 | 1, l: unknown, day: boolean, c: THREE.Vector3, dt: number): void }).updateClouds;
    u.call(sky, 0, L, true, new THREE.Vector3(), 0);
    u.call(sky, 1, L, true, new THREE.Vector3(), 0);
  }
  // `cloudMath.ts`: every export the old tree had, the same (functions by their text, numbers and tables by value), and
  // the September march's programs byte for byte with `coverCurve` moved in beside them.
  const [oMath, nMath] = await both('core/fx/cloudMath.ts');
  const differ: string[] = [];
  for (const [k, v] of Object.entries(oMath)) {
    const w = nMath[k];
    const same = typeof v === 'function' ? typeof w === 'function' && String(v) === String(w) : JSON.stringify(v) === JSON.stringify(w);
    if (!same) differ.push(k);
  }
  ok(differ.length === 0 && Object.keys(oMath).length > 3 && typeof nMath.coverCurve === 'function', `cloudMath.ts keeps all ${Object.keys(oMath).length} of its old exports as they were${differ.length ? ` (differ: ${differ.join(', ')})` : ''}, with coverCurve beside them`);
  const [oClouds, nClouds] = await both('core/fx/clouds.ts');
  const progs = (m: Mod): string => {
    const p = new (m.CloudsPass as new () => Record<string, unknown>)();
    const mats = ((p.materials as () => { material: THREE.ShaderMaterial }[]).call(p)).map((x) => `${x.material.name}|${x.material.vertexShader}|${x.material.fragmentShader}|${Object.keys(x.material.uniforms).sort().join()}`);
    (p.dispose as () => void).call(p);
    return mats.join('##');
  };
  const pa = progs(oClouds);
  const pb = progs(nClouds);
  ok(pa === pb && pa.length > 1000, `the September clouds' programs, every one of them, byte for byte the old tree's (${pa.length} characters)`);
  // `clouds.ts` and `cloudLook.ts` untouched since the pass began.
  for (const f of ['core/fx/clouds.ts', 'world/cloudLook.ts']) {
    const o = readFileSync(join(OLD, f), 'utf8').replace(/\r\n/g, '\n');
    const n = readFileSync(join(NEW, f), 'utf8').replace(/\r\n/g, '\n');
    ok(o === n, `${f}: untouched since the pass began`);
  }
  // `feedClouds` feeds the volumetrics' clouds first and returns; everything after that is today's text.
  const oldMain = readFileSync(join(OLD, 'main.ts'), 'utf8').replace(/\r\n/g, '\n');
  const newMain = readFileSync(join(NEW, 'main.ts'), 'utf8').replace(/\r\n/g, '\n');
  const body = (src: string): string => {
    const i = src.indexOf('  private feedClouds(): void {');
    const j = src.indexOf('\n  }\n', i);
    return i >= 0 && j > i ? src.slice(i, j) : '';
  };
  const ob = body(oldMain);
  const nb = body(newMain);
  // The code after the new lines, its comments left out (W7a reworded the one over the look's wind).
  const tail = (s: string) =>
    s
      .slice(s.indexOf('    const pass = this.settings.volumetricClouds'))
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
  ok(ob.length > 0 && nb.includes("if (this.postfx?.passWanted('airClouds')) {\n      this.feedAirClouds(this.postfx.pass<AirCloudsPass>('airClouds')!);\n      return;\n    }\n    if (WIND_STATE.decks) this.letGoDecks();\n") && tail(nb) === tail(ob).replace('on ? w.windSpeed : 0', 'on ? w.windMean : 0'), "feedClouds feeds the volumetrics' clouds first and returns, lets the decks go only once they were set, and every line after is today's (the mean where it read the speed, W7a's)");
}

// --- 5b. the particles' picture accessor (the fourth wave's): it answers a held picture and starts nothing ---
{
  const { ParticleEffects } = await load(NEW, 'world/particles.ts');
  const scene = new THREE.Scene();
  const fx = new (ParticleEffects as new (s: unknown, base: string) => Record<string, unknown>)(scene, '/nowhere/');
  const textures = fx.textures as Map<string, unknown>;
  const ready = fx.textureReady as Map<string, unknown>;
  const loaded = (fx.loadedTexture as (f: string) => unknown).call(fx, 'particles/pt_leaf_single.png');
  ok(loaded === null && textures.size === 0 && ready.size === 0 && scene.children.length === 0, "particles.ts's loadedTexture answers null for a picture it does not hold and starts no load, makes no texture and adds nothing to the scene");
  const held = new THREE.Texture({ width: 32, height: 32 });
  textures.set('particles/pt_sand_cloud.png', held);
  const empty = new THREE.Texture();
  textures.set('particles/pt_leaf.png', empty);
  const answer = (fx.loadedTexture as (f: string) => unknown).call(fx, 'particles/pt_sand_cloud.png');
  const notYet = (fx.loadedTexture as (f: string) => unknown).call(fx, 'particles/pt_leaf.png');
  ok(answer === held && notYet === null && textures.size === 2 && ready.size === 0, 'and the one it holds, loaded, by identity; one still loading (no picture yet) is null; nothing more made either way');
}

const ms = Math.round(performance.now() - t0);
ok(ms < 60000, `the proof took ${ms} ms, under a minute`);
console.log(`\n${checks} checks passed`);
