// The GPU port's step 3, off: with the renderer switch at WebGL (the default) nothing of the WebGPU side is loaded, and
// every site it guards keeps the line it had as the WebGL branch.
//
//  1. the switch (`src/core/gpuSwitch.ts`): read once; `?renderer=` on the address first, then
//     `localStorage['swg.renderer']`, else WebGL; a word other than the two is no choice; a storage that throws is the
//     default; reading it never sets `GPU.webgpu` (only the boot does, once WebGPU has started);
//  2. the WebGL boot's module graph: every static value import followed from `src/main.ts` reaches nothing under
//     `src/core/gpu/` and no `three/webgpu`, `three/tsl` or `CSMShadowNode`, and the one module of the port it does load,
//     `gpuSwitch.ts`, imports nothing of three's but types;
//  3. anywhere under `src/` outside `src/core/gpu/`, nothing imports three's WebGPU build or the port's runtime, statically
//     or dynamically, but `main.ts`'s one dynamic import in `startGpu`, which the boot makes only with the switch at WebGPU;
//  4. each guarded site: the line it had kept whole as the WebGL branch right after its WebGPU line, or the guard folded into
//     the line itself (`if (!GPU.webgpu) ...`, `... && !GPU.webgpu)`); step 4's (the models' own looks: the registry's
//     stand-in, the world's capture of our sky) the same way, and its modules reached only through `start.ts`.
//
// Run: node tools/swg/tests/gpuOff.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC = join(ROOT, 'src');
const rel = (f: string): string => relative(ROOT, f).replace(/\\/g, '/');
const inGpuDir = (f: string): boolean => rel(f).startsWith('src/core/gpu/');
/** A bare specifier of three's WebGPU build or its node shadows. */
const WEBGPU_BARE = /^three\/(webgpu|tsl)(\/|$)|CSMShadowNode|three\.webgpu|three\.tsl/;
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
};

// ---------------------------------------------------------------- 1. the switch
{
  type Gpu = { asked: string; how: string; webgpu: boolean; read: boolean; refused: unknown; rt: unknown };
  const g = globalThis as unknown as { localStorage?: unknown };
  const had = g.localStorage;
  let n = 0;
  const fresh = async (): Promise<{ GPU: Gpu; readRendererSwitch: (s?: string) => void }> =>
    (await import(pathToFileURL(join(SRC, 'core', 'gpuSwitch.ts')).href + `?case=${n++}`)) as never;
  const store = (v: string | null | 'throw'): void => {
    g.localStorage = {
      getItem(k: string) {
        if (v === 'throw') throw new Error('storage refused');
        return k === 'swg.renderer' ? v : null;
      },
    };
  };
  const cases: { search: string; kept: string | null | 'throw'; asked: string; how: string }[] = [
    { search: '', kept: null, asked: 'webgl', how: 'default' },
    { search: '?renderer=webgpu', kept: null, asked: 'webgpu', how: 'address' },
    { search: '?planet=naboo&renderer=webgpu&class=jedi', kept: 'webgl', asked: 'webgpu', how: 'address' },
    { search: '?renderer=webgl', kept: 'webgpu', asked: 'webgl', how: 'address' },
    { search: '?renderer=vulkan', kept: 'webgpu', asked: 'webgpu', how: 'storage' },
    { search: '', kept: 'webgl', asked: 'webgl', how: 'storage' },
    { search: '', kept: 'WebGPU', asked: 'webgl', how: 'default' },
    { search: '', kept: 'throw', asked: 'webgl', how: 'default' },
  ];
  for (const c of cases) {
    store(c.kept);
    const m = await fresh();
    ok(m.GPU.read === false && m.GPU.asked === 'webgl' && m.GPU.webgpu === false, 'the switch starts at WebGL, unread');
    m.readRendererSwitch(c.search);
    ok(m.GPU.asked === c.asked && m.GPU.how === c.how, `switch ${JSON.stringify(c)}: read ${m.GPU.asked} from ${m.GPU.how}`);
    ok(m.GPU.webgpu === false && m.GPU.rt === null && m.GPU.refused === null, 'reading the switch never starts WebGPU (only the boot does)');
    store(c.asked === 'webgpu' ? 'webgl' : 'webgpu');
    m.readRendererSwitch(c.asked === 'webgpu' ? '?renderer=webgl' : '?renderer=webgpu');
    ok(m.GPU.asked === c.asked && m.GPU.how === c.how, 'the switch is read once: a second read changes nothing');
  }
  g.localStorage = had;
}

// ---------------------------------------------------------------- the import graph
type Edge = { spec: string; dynamic: boolean; typeOnly: boolean; line: number };
const edgesCache = new Map<string, Edge[]>();
function edgesOf(file: string): Edge[] {
  const had = edgesCache.get(file);
  if (had) return had;
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Edge[] = [];
  const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const c = node.importClause;
      // A clause of types alone is erased; so is a named list of nothing but `type` names with no default.
      const typeOnly = !!c && (c.isTypeOnly || (!c.name && !!c.namedBindings && ts.isNamedImports(c.namedBindings) && c.namedBindings.elements.length > 0 && c.namedBindings.elements.every((e) => e.isTypeOnly)));
      out.push({ spec: node.moduleSpecifier.text, dynamic: false, typeOnly, line: lineOf(node) });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      out.push({ spec: node.moduleSpecifier.text, dynamic: false, typeOnly: node.isTypeOnly, line: lineOf(node) });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const a = node.arguments[0];
      out.push({ spec: a && ts.isStringLiteralLike(a) ? a.text : '<computed>', dynamic: true, typeOnly: false, line: lineOf(node) });
    } else if (ts.isImportTypeNode(node)) {
      return; // `import('x').T` in a type: erased.
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  edgesCache.set(file, out);
  return out;
}
function resolveSpec(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec.replace(/\?.*$/, ''));
  for (const f of [base, base + '.ts', base + '.tsx', base.replace(/\.js$/, '.ts'), join(base, 'index.ts')]) {
    if (existsSync(f) && statSync(f).isFile()) return f;
  }
  return null;
}
const CODE = /\.(ts|tsx|mts|js|mjs)$/;

// ---------------------------------------------------------------- 2. the WebGL boot's graph
{
  const main = join(SRC, 'main.ts');
  const seen = new Set<string>();
  const bare = new Set<string>();
  const dynamicFromGraph: string[] = [];
  const stack = [main];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const e of edgesOf(f)) {
      if (e.typeOnly) continue;
      if (e.dynamic) {
        dynamicFromGraph.push(`${rel(f)}:${e.line} ${e.spec}`);
        continue;
      }
      if (!e.spec.startsWith('.')) {
        bare.add(e.spec);
        continue;
      }
      const to = resolveSpec(f, e.spec);
      if (to && CODE.test(to)) stack.push(to);
    }
  }
  const files = [...seen].map(rel);
  ok(files.length > 300, `the boot's graph was walked (${files.length} modules)`);
  ok(files.includes('src/core/gpuSwitch.ts'), 'the WebGL boot loads the switch');
  const gpuFiles = files.filter((f) => f.startsWith('src/core/gpu/'));
  ok(gpuFiles.length === 0, `the WebGL boot loads nothing of the WebGPU side: ${gpuFiles.join(', ')}`);
  const webgpuBare = [...bare].filter((s) => WEBGPU_BARE.test(s));
  ok(webgpuBare.length === 0, `the WebGL boot imports nothing of three's WebGPU build: ${webgpuBare.join(', ')}`);
  const gpuDynamic = dynamicFromGraph.filter((d) => /core\/gpu\/|three\/(webgpu|tsl)|CSMShadowNode/.test(d));
  ok(gpuDynamic.length === 1 && gpuDynamic[0].startsWith('src/main.ts:') && gpuDynamic[0].endsWith(' ./core/gpu/start.ts'), `the WebGPU side is reached by one dynamic import, main.ts's: ${gpuDynamic.join('; ')}`);
  // The switch module: types of three's and nothing else.
  for (const e of edgesOf(join(SRC, 'core', 'gpuSwitch.ts'))) ok(e.typeOnly, `gpuSwitch.ts imports nothing but types (${e.spec}, line ${e.line})`);
}

// ---------------------------------------------------------------- 3. nowhere else under src/
{
  const all: string[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (CODE.test(n) && !n.endsWith('.d.ts')) all.push(p);
    }
  };
  walk(SRC);
  ok(all.length > 500, `every source file was read (${all.length})`);
  const offenders: string[] = [];
  for (const f of all) {
    if (inGpuDir(f)) continue;
    for (const e of edgesOf(f)) {
      const target = e.spec.startsWith('.') ? resolveSpec(f, e.spec) : null;
      const intoGpu = target ? inGpuDir(target) : false;
      if (!WEBGPU_BARE.test(e.spec) && !intoGpu) continue;
      if (e.typeOnly) continue;
      offenders.push(`${rel(f)}:${e.line} ${e.dynamic ? 'import(' + e.spec + ')' : e.spec}`);
    }
  }
  ok(offenders.length === 1 && offenders[0].startsWith('src/main.ts:') && offenders[0].endsWith('import(./core/gpu/start.ts)'), `outside src/core/gpu/ only main.ts's one dynamic import reaches the WebGPU side: ${offenders.join('; ')}`);
}

// ---------------------------------------------------------------- 4. the guarded sites
{
  const read = (f: string): string[] => readFileSync(join(ROOT, f), 'utf8').split(/\r?\n/).map((l) => l.trim());
  const files = new Map<string, string[]>();
  const lines = (f: string): string[] => {
    let l = files.get(f);
    if (!l) files.set(f, (l = read(f)));
    return l;
  };
  /** The WebGPU line, then the WebGL branch on the next line that is not blank: each exactly once. */
  const pairs: [string, string, string][] = [
    ['src/main.ts', 'if (GPU.webgpu) this.renderer = GPU.rt!.renderer;', "else this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance', stencil: true, reversedDepthBuffer: REVERSED_DEPTH });"],
    ['src/main.ts', "if (GPU.webgpu) this.backend = 'unknown';", 'else {'],
    ['src/main.ts', 'if (GPU.webgpu) World.anisotropy = Math.min(8, (this.renderer as unknown as { getMaxAnisotropy(): number }).getMaxAnisotropy());', 'else World.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());'],
    ['src/main.ts', 'if (GPU.webgpu) this.forceGpuOff();', 'else if (S.effects) this.postfx = this.makePostFX();'],
    ['src/main.ts', "if (GPU.webgpu) HORIZON_TUNE.ground = 'tiles';", "else HORIZON_TUNE.ground = S.farRings ? 'rings' : 'tiles';"],
    ['src/main.ts', 'if (GPU.webgpu) perf.attach(null);', 'else perf.attach(this.renderer.getContext() as WebGL2RenderingContext);'],
    ['src/main.ts', 'if (GPU.webgpu) this.frameCalls = GPU.rt!.frameDraws();', 'else this.frameCalls = info.calls;'],
  ];
  for (const [f, gpu, gl] of pairs) {
    const l = lines(f);
    const at = l.flatMap((x, i) => (x === gpu ? [i] : []));
    ok(at.length === 1, `${f}: the WebGPU line is there once: ${gpu}`);
    let j = at[0] + 1;
    while (j < l.length && l[j] === '') j++;
    ok(l[j] === gl, `${f}: the WebGL branch keeps the line it had, right after its WebGPU line: ${gl}`);
  }
  // The WebGL block after `else {`: the questions of the WebGL context, asked as before.
  {
    const l = lines('src/main.ts');
    const at = l.indexOf("if (GPU.webgpu) this.backend = 'unknown';");
    const block = l.slice(at, at + 26).join('\n');
    for (const want of ['if (REVERSED_DEPTH !== this.renderer.capabilities.reversedDepthBuffer) {', 'const gl = this.renderer.getContext();', 'const readback = readbackNote(this.backend);', 'watchLinkWaits(this.renderer.getContext(), () => performance.now());']) ok(block.includes(want), `main.ts: the WebGL context's questions are asked in the WebGL branch: ${want}`);
  }
  /** Guards folded into the line: the line it had, with the guard round it. */
  const folded: [string, string][] = [
    ['src/world/portalRender.ts', 'if (!GPU.webgpu) this.hookDraws();'],
    ['src/world/world.ts', 'if (this.renderer && !GPU.webgpu) {'],
    // Three's WebGPU `info.render.calls` is its own render-call id (it skips a second upload of an attribute in one call by
    // it): never put back to nought there, or no attribute written in play reaches the GPU after its first frame.
    ['src/main.ts', 'if (!GPU.webgpu) info.calls = 0;'],
  ];
  for (const [f, line] of folded) ok(lines(f).filter((x) => x === line).length === 1, `${f}: the guarded line is there once: ${line}`);
  /**
   * What items 7 and 9 add (the bundles, the warm-up, the float joints): a WebGPU line that adds and has no WebGL branch,
   * there exactly once, with the line `ce6b94c` had there right after it, so nothing of the WebGL path moved round it.
   */
  const added: [string, string, string][] = [
    ['src/world/layoutStream.ts', 'if (GPU.webgpu) GPU.rt!.bundles.mark(loaded, loaded.meshes, loaded.bulk, (m) => this.furnitureOfMesh.has(m));', 'if (this.prepare && loaded.meshes.length) {'],
    ['src/world/layoutStream.ts', 'if (GPU.webgpu) GPU.rt!.bundles.take(loaded, this.scene);', "// The landmark index hands its copies of this tier's objects back at its next sweep, which this asks for (`landmarks.ts`)."],
    ['src/world/layoutStream.ts', 'if (GPU.webgpu) GPU.rt!.bundles.drop(t);', 'for (const b of t.buildings) this.dropInterior(b);'],
    ['src/world/portalRender.ts', 'if (GPU.webgpu) GPU.rt!.bundles.pass(layer === 0);', 'const interior = layer === INTERIOR_LAYER;'],
    ['src/world/portalRender.ts', 'if (GPU.webgpu) GPU.rt!.bundles.frame(camera);', '// The frame an exit comes into view the shadows are drawn here, before the world pass, so nothing pops.'],
    ['src/world/world.ts', 'if (GPU.webgpu) GPU.rt!.bundles.attach(this.scene, portals.narrowParents);', '// Round every shadow pass (the sixth wave): the batches follow their sources and take over their casting for the'],
    ['src/world/world.ts', 'if (GPU.webgpu) return this.gpuReady(objects, own);', "// On a page on screen the idle rule's bounds are the long ones (`PACE_TUNE.idleShownMs`): frames stand still there"],
    ['src/world/world.ts', 'if (GPU.webgpu) await GPU.rt!.compiled();', 'const t = this.outrightLinks;'],
  ];
  for (const [f, gpu, gl] of added) {
    const l = lines(f);
    const at = l.flatMap((x, i) => (x === gpu ? [i] : []));
    ok(at.length === 1, `${f}: the WebGPU line is there once: ${gpu}`);
    ok(l[at[0] + 1] === gl, `${f}: the line ce6b94c had there follows the WebGPU line: ${gl}`);
  }
  // The same line twice in the streamer: a folded row hidden or shown in place records its tier's bundle again, and a
  // level sweep or a caster switch pokes every bundle.
  {
    const l = lines('src/world/layoutStream.ts');
    const dirty = l.flatMap((x, i) => (x === 'if (GPU.webgpu) GPU.rt!.bundles.dirty(r.tier);' ? [i] : []));
    ok(dirty.length === 2 && l[dirty[0] + 1] === 'if (r.hidden === 0) {' && l[dirty[1] + 1] === 'const saved = r.saved;', 'layoutStream.ts: hiding and showing in place each record the tier again, before the lines they had');
    const poke = l.flatMap((x, i) => (x === 'if (GPU.webgpu) GPU.rt!.bundles.poke();' ? [i] : []));
    ok(poke.length === 2 && l[poke[0] + 1] === 'for (const region of this.regions.values()) {' && l[poke[1] - 2] === 'st.ms = performance.now() - t0;' && l[poke[1] + 1] === '}', 'layoutStream.ts: a caster switch and a level sweep each poke the bundles, beside the lines they had');
  }
  // Step 4's sites (the models' own looks on WebGPU). The registry's black stand-in on WebGPU is three's WebGPU generator's;
  // the WebGL branch hands over the water's, the line it had.
  {
    const l = lines('src/main.ts');
    const at = l.flatMap((x, i) => (x === 'if (GPU.webgpu) setEnvironmentStandIn(GPU.rt!.environment.standIn);' ? [i] : []));
    ok(at.length === 1 && l[at[0] + 1] === 'else setEnvironmentStandIn(this.world.waterBodies.blackEnvironment);', "main.ts: the registry's stand-in is the WebGPU generator's on WebGPU, the water's in the WebGL branch, as it was");
  }
  // The world's reflections on WebGPU: step 3's guards (`if (GPU.webgpu) return;`) now hand WebGPU its own half or ask the
  // runtime whether it captures; the lines 1446f2a had after each stand right after them, and the dome made behind the
  // first screen on WebGPU stands after the WebGL block, folded into one line of its own.
  const step4: [string, string, string][] = [
    ['src/world/world.ts', 'if (GPU.webgpu) return this.refreshEnvironmentGpu(dt);', 'const sky = this.swgSky;'],
    ['src/world/world.ts', 'if (GPU.webgpu && !GPU.rt!.environment.capturing) return;', 'if (!this.swgSky || !this.renderer) return;'],
    ['src/world/world.ts', 'if (this.renderer && GPU.webgpu && GPU.rt!.environment.capturing) this.dome ??= GPU.rt!.environment.makeDome();', '// The sound of the place, as early as it can be had: on an arrival this runs before the pack is'],
  ];
  for (const [f, gpu, gl] of step4) {
    const l = lines(f);
    const at = l.flatMap((x, i) => (x === gpu ? [i] : []));
    ok(at.length === 1, `${f}: the WebGPU line is there once: ${gpu}`);
    ok(l[at[0] + 1] === gl, `${f}: the line 1446f2a had there follows the WebGPU line: ${gl}`);
  }
  {
    const l = lines('src/world/world.ts');
    const dome = l.indexOf('if (this.renderer && GPU.webgpu && GPU.rt!.environment.capturing) this.dome ??= GPU.rt!.environment.makeDome();');
    ok(dome > 4 && l[dome - 2] === '}' && l[dome - 3] === 'this.dome ??= this.makeDome(this.renderer);' && l[dome - 4] === 'this.pmrem ??= this.makePmrem(this.renderer);' && l[dome - 5] === 'if (this.renderer && !GPU.webgpu) {', "world.ts: the WebGL warm-up's pmrem and dome lines stand as they were, before WebGPU's own dome");
    // WebGPU's own half is a method of its own, called only from the guard above: nothing of it runs on WebGL.
    const calls = l.filter((x) => x.includes('this.refreshEnvironmentGpu(')).length;
    ok(calls === 1, `world.ts: refreshEnvironmentGpu is called from the WebGPU guard alone (${calls})`);
  }
  // What step 4 adds under src/core/gpu/ is reached only through start.ts (section 2 holds the WebGL graph loads none of it);
  // the one file of the WebGL path it touches beyond the guards is specMath.ts, whose new names are the numbers its own
  // functions and the WebGL shader text use.
  {
    const m = readFileSync(join(SRC, 'world', 'specMath.ts'), 'utf8');
    for (const want of ['export const SPEC_FLOOR = 1e-6;', 'export const GATE_NL = 1e-4;', 'export const MODE_NONE_BELOW = 0.5;', 'export const MODE_BAND_ABOVE = 1.5;']) ok(m.includes(want), `specMath.ts: ${want}`);
    for (const g of ['looks.ts', 'gpuSpec.ts', 'gpuDetail.ts', 'gpuEnv.ts', 'gpuSpecSelfTest.ts', 'gpuCard.ts', 'gpuCardSelfTest.ts']) ok(existsSync(join(SRC, 'core', 'gpu', g)), `step 4's ${g} is under src/core/gpu/`);
    const startText = readFileSync(join(SRC, 'core', 'gpu', 'start.ts'), 'utf8');
    ok(/LOOK_PARTS\.push\(detailPart, specPart, cardPart\);\s*installLooks\(renderer\);/.test(startText) && startText.indexOf('installLooks(renderer);') > startText.indexOf('const fallback: FallbackStats = installFallback(renderer);'), "start.ts: the looks go on the node library after the fallback's wrap");
  }
  // The leaf cards' part (step 4, item 4): the two files of the WebGL path it touches are the mirrors, whose new names are
  // the numbers their own functions and the WebGL shader text use; and the one guarded site is inside `forceGpuOff`, which
  // runs on WebGPU alone, holding the skip off only where the part is left out at load.
  {
    const m = readFileSync(join(SRC, 'world', 'cardLightMath.ts'), 'utf8');
    for (const want of ['export const ACES_FIT = { a: 0.0245786, b: 0.000090537, c: 0.983729, d: 0.432951, e: 0.238081, scale: 0.6 } as const;', 'export const LUMINANCE = [0.2126, 0.7152, 0.0722] as const;', '  toSrgbBelow: 0.0031308,', '  toLinearBelow: 0.04045,', '  exposure: 1e-3,']) ok(m.includes(want), `cardLightMath.ts: ${want.trim()}`);
    const s = readFileSync(join(SRC, 'world', 'leafShadow.ts'), 'utf8');
    ok(s.includes('export const CROWN_DIR_FLOOR = 1e-6;'), 'leafShadow.ts: the crown exit\'s floor is the shader\'s 1e-6');
    const l = lines('src/main.ts');
    const f = l.indexOf('private forceGpuOff(): void {');
    const g = l.indexOf("if (rt.look({}).card !== true) {");
    ok(f > 0 && g > f && g - f < 20 && l[g + 2] === "CARD_LIGHT_TUNE.shadow = 'all';", "main.ts: the leaf skip is held off on WebGPU only inside forceGpuOff, and only with the leaf cards' part left out at load");
    const sun = readFileSync(join(SRC, 'core', 'gpu', 'sun.ts'), 'utf8');
    ok(sun.includes('light.userData.swgSun = true;') && sun.includes('if (LOOKS_AT_LOAD.card) for (const l of node.lights'), "sun.ts: the sun is marked for the cards and its cascades carry the leaf floor's bias node only with the part in");
  }
  // Items 5 and 6 (step 4): the carries' check and the stays are WebGPU's own module, reached through start.ts; main.ts
  // asks for the check only past the WebGL return of `gpu()`; and the flora stand-ins are told to receive the sun's
  // shadow inside the warm patch alone (WebGPU's), never in flora.ts, whose stand-ins WebGL builds as they were.
  {
    ok(existsSync(join(SRC, 'core', 'gpu', 'carries.ts')), "step 4's carries.ts is under src/core/gpu/");
    const startText = readFileSync(join(SRC, 'core', 'gpu', 'start.ts'), 'utf8');
    ok(startText.includes("import { carriesReport, STAYS } from './carries.ts';") && startText.includes('stays: { ...STAYS },'), 'start.ts: the report says what stays and the tune checks what the copies carry');
    const l = lines('src/main.ts');
    const back = l.indexOf("if (!GPU.webgpu) return { renderer: 'WebGL (three WebGLRenderer)', ...how, refused: GPU.refused ?? undefined, note: GPU.refused ? 'WebGPU was asked for and could not start here' : 'WebGPU is not in use: nothing of it was loaded' };");
    const ask = l.findIndex((x) => x.includes('o.carries === true) ? rt.tune({ ...o, scene: this.scene })'));
    ok(back > 0 && ask > back && ask - back < 6, "main.ts: gpu() asks for the carries' check only after its WebGL return");
    const warm = readFileSync(join(SRC, 'core', 'gpu', 'patchWarm.ts'), 'utf8');
    ok(warm.includes("if (o.name === 'flora stand-in' && o.receiveShadow !== true) {"), 'patchWarm.ts: the flora stand-ins are told to receive as the batches do, inside the warm patch');
    ok(warm.includes("if (o.name === 'flora stand-in' && o.castShadow !== true) {"), "patchWarm.ts: and told to cast, so the sun's cascades list their shadow pipelines, inside the warm patch");
    const flora = readFileSync(join(SRC, 'world', 'flora.ts'), 'utf8');
    ok(!/receiveShadow|castShadow/.test(flora.slice(flora.indexOf('standIns(): THREE.InstancedMesh[] {'), flora.indexOf('materials(out: Set<THREE.Material>'))), 'flora.ts: the stand-ins are made as 1446f2a made them');
  }
  // The doorways on WebGPU: their two ways of being drawn each wear a material of their own, the WebGL lines after the guard.
  {
    const l = lines('src/world/portalRender.ts');
    const at = l.indexOf('if (GPU.webgpu) return this.drawPortalsGpu(meshes, n, camera, from, depthTest, restore);');
    ok(at > 0 && l[at + 1] === 'const m = this.portalMat;' && l[at + 2] === 'if (restore) {', 'portalRender.ts: the doorways are drawn as they were on WebGL after the WebGPU guard');
  }
  // The boot: WebGPU only when it was asked for, through the one function that imports it.
  const main = lines('src/main.ts');
  ok(main.filter((x) => x === "if (GPU.asked === 'webgpu') await startGpu();").length === 1, 'main.ts: the boot starts WebGPU only when asked for it');
  const start = main.indexOf('async function startGpu(): Promise<void> {');
  ok(start > 0 && main.slice(start, start + 6).includes("const m = await import('./core/gpu/start.ts');"), 'main.ts: startGpu makes the one dynamic import');
  ok(main.indexOf('readRendererSwitch();') > 0 && main.indexOf('readRendererSwitch();') < main.indexOf("if (GPU.asked === 'webgpu') await startGpu();"), 'main.ts: the switch is read before the boot asks it');
}

console.log(`gpuOff: ${checks} checks passed`);
