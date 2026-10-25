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
//   6. nothing runs: the field with the master off answers and the renderer is never touched, and the dust pool's
//      motes (the dust or the master off) are the old pool's to the bit, the same spawns and steps, seeded alike;
//   7. no resize, of any of the field's detail dials (the sand's and the prints' with them), disposes a material.
//
// (The installed passes, every program the game links and the zero-dial picture are the browser's, §4.2.) It fails
// loudly when git cannot answer.
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

const ms = Math.round(performance.now() - t0);
ok(ms < 60000, `the proof took ${ms} ms, under a minute`);
console.log(`\n${checks} checks passed`);
