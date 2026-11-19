// The GPU port's step 3, off: with the renderer switch at WebGL (`?renderer=webgl`; WebGPU is the default since 2026-11-18) nothing of the WebGPU side is loaded, and
// every site it guards keeps the line it had as the WebGL branch.
//
//  1. the switch (`src/core/gpuSwitch.ts`): read once; `?renderer=` on the address first, then
//     `localStorage['swg.renderer']`, else WebGPU; a word other than the two is no choice; a storage that throws is the
//     default; reading it never sets `GPU.webgpu` (only the boot does, once WebGPU has started);
//  2. the WebGL boot's module graph: every static value import followed from `src/main.ts` reaches nothing under
//     `src/core/gpu/` and no `three/webgpu`, `three/tsl` or `CSMShadowNode`, and the one module of the port it does load,
//     `gpuSwitch.ts`, imports nothing of three's but types;
//  3. anywhere under `src/` outside `src/core/gpu/`, nothing imports three's WebGPU build or the port's runtime, statically
//     or dynamically, but `main.ts`'s one dynamic import in `startGpu`, which the boot makes only with the switch at WebGPU;
//  4. each guarded site: the line it had kept whole as the WebGL branch right after its WebGPU line, or the guard folded into
//     the line itself (`if (!GPU.webgpu) ...`, `... && !GPU.webgpu)`); step 4's (the models' own looks: the registry's
//     stand-in, the world's capture of our sky) the same way, and its modules reached only through `start.ts`; step 6's (the
//     effects chain: the scene target's depth and the spine in `PostFX`'s constructor, the install, the boot's chain, the
//     Effects switch in play, the Graphics page's rows) the same way, the WebGL lines of each block standing as `8d0c759` had them.
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
    { search: '', kept: null, asked: 'webgpu', how: 'default' },
    { search: '?renderer=webgpu', kept: null, asked: 'webgpu', how: 'address' },
    { search: '?planet=naboo&renderer=webgpu&class=jedi', kept: 'webgl', asked: 'webgpu', how: 'address' },
    { search: '?renderer=webgl', kept: 'webgpu', asked: 'webgl', how: 'address' },
    { search: '?renderer=vulkan', kept: 'webgpu', asked: 'webgpu', how: 'storage' },
    { search: '', kept: 'webgl', asked: 'webgl', how: 'storage' },
    { search: '', kept: 'WebGPU', asked: 'webgpu', how: 'default' },
    { search: '', kept: 'throw', asked: 'webgpu', how: 'default' },
  ];
  for (const c of cases) {
    store(c.kept);
    const m = await fresh();
    ok(m.GPU.read === false && m.GPU.asked === 'webgpu' && m.GPU.webgpu === false, 'the switch starts at WebGPU, unread');
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
    // Step 5: the far rings drawn on WebGPU as on WebGL where the Graphics page asks, unless their part is left out at load.
    ['src/main.ts', "if (GPU.webgpu) HORIZON_TUNE.ground = S.farRings && GPU.rt!.look({}).rings === true ? 'rings' : 'tiles';", "else HORIZON_TUNE.ground = S.farRings ? 'rings' : 'tiles';"],
    ['src/main.ts', 'if (GPU.webgpu) perf.attach(null);', 'else perf.attach(this.renderer.getContext() as WebGL2RenderingContext);'],
    ['src/main.ts', 'if (GPU.webgpu) this.frameCalls = GPU.rt!.frameDraws();', 'else this.frameCalls = info.calls;'],
    // Step 6: the effects chain's scene target takes its depth's type off three's WebGPU renderer, and its spine is the WebGPU side's.
    ['src/core/postfx.ts', 'if (GPU.webgpu) depth = GPU.rt!.chain.sceneDepth(w, h);', 'else depth = new THREE.DepthTexture(w, h, this.renderer.capabilities.reversedDepthBuffer ? THREE.FloatType : THREE.UnsignedInt248Type);'],
    ['src/core/postfx.ts', 'if (GPU.webgpu) GPU.rt!.chain.spine(this, w, h, this.settings);', 'else {'],
    // Step 6, item 4: an item that names its own target is warmed against it on WebGPU, through the camera it is drawn with
    // (the fixer's: the runtime's `warmInto`); the WebGL lines in the branch after.
    ['src/core/postfx.ts', 'if (GPU.webgpu && m.into) jobs.push(GPU.rt!.chain.warmInto(m.into, object, m.camera));', 'else {'],
    ['src/core/postfx.ts', 'if (GPU.webgpu && it.into) jobs.push(GPU.rt!.chain.warmInto(it.into, object, it.camera));', 'else {'],
    // Step 6's fixer: the portal renderer's own draws hand WebGPU a stand-in for each way a doorway is drawn there too.
    ['src/world/portalRender.ts', 'if (GPU.webgpu) return [this.portalStandIn, this.resetQuad, ...this.gpuDoorwayStandIns()];', 'return [this.portalStandIn, this.resetQuad];'],
    // And the sun the occlusion reads: on WebGPU the WebGPU sun's and its cascades, the WebGL branch the line it had.
    ['src/world/world.ts', 'if (GPU.webgpu && csm && csm.lights.length && this.gpuSun && this.renderer && this.camera) this.gpuSun.fillFx(sky, csm, this.renderer, Math.min(this.camera.far, csm.maxFar) - this.camera.near);', 'else if (csm && csm.lights.length) {'],
  ];
  for (const [f, gpu, gl] of pairs) {
    const l = lines(f);
    const at = l.flatMap((x, i) => (x === gpu ? [i] : []));
    ok(at.length === 1, `${f}: the WebGPU line is there once: ${gpu}`);
    let j = at[0] + 1;
    while (j < l.length && l[j] === '') j++;
    ok(l[j] === gl, `${f}: the WebGL branch keeps the line it had, right after its WebGPU line: ${gl}`);
  }
  // Step 6, item 4: the warm-up's two WebGL lines inside each `else {` after the WebGPU line, as 8d0c759 had them; and the
  // world's WebGL sun lines after its `else if`, as they were.
  {
    const l = lines('src/core/postfx.ts');
    for (const gpu of ['if (GPU.webgpu && m.into) jobs.push(GPU.rt!.chain.warmInto(m.into, object, m.camera));', 'if (GPU.webgpu && it.into) jobs.push(GPU.rt!.chain.warmInto(it.into, object, it.camera));']) {
      const at = l.indexOf(gpu);
      const body = l.slice(at + 2, at + 8).filter((x) => !x.startsWith('//'));
      const want = gpu.includes('m.into') ? ["if (where !== 'screen') compileOn(this.bufferA, object);", "if (where !== 'target') compileOn(null, object);", '}'] : ["if (it.where !== 'screen') compileOn(this.bufferA, object);", "if (it.where !== 'target') compileOn(null, object);", '}'];
      ok(at > 0 && want.every((x, i) => body[i] === x), `postfx.ts: the WebGL warm-up's two lines stand as 8d0c759 had them inside the else after: ${gpu}`);
    }
    const w = lines('src/world/world.ts');
    const s = w.indexOf('else if (csm && csm.lights.length) {');
    ok(s > 0 && w[s + 1] === '// The plain sun is hidden once the cascades exist; they carry its colour and intensity.' && w[s + 2] === 'const l = csm.lights[0];', "world.ts: fillFxLights's WebGL sun lines stand after the WebGPU line as they stood");
  }
  // Step 6's WebGL block after the spine's `else {`: every product and pass 8d0c759 registered, in its order, and nothing else.
  {
    const l = lines('src/core/postfx.ts');
    const at = l.indexOf('if (GPU.webgpu) GPU.rt!.chain.spine(this, w, h, this.settings);');
    const want = ['else {', 'this.registerProduct(new LinearDepthHalf());', 'this.registerProduct(new NormalsHalf());', 'this.registerProduct(new DebugMaskProduct(this));', 'this.registerPass(new SanitizePass());', 'this.registerPass(new GodRaysPass());', 'this.registerPass(new MotionBlurPass());', 'this.registerPass(new BloomPass(w, h, this.settings.bloomStrength));', 'this.registerPass(new OutputFxPass());', 'this.registerPass(new FxaaPass());', 'this.registerPass(new DebugViewPass());', '}', 'this.setSizeAll(w, h);'];
    ok(at > 0 && want.every((x, i) => l[at + 1 + i] === x), "postfx.ts: the WebGL spine registers every product and pass 8d0c759 did, in its order, in the branch after the WebGPU line");
    // The install: the WebGPU side's own line before the lines 8d0c759 had, which stand after it as they stood.
    const inst = lines('src/core/fx/install.ts');
    const i = inst.indexOf('if (GPU.webgpu) return GPU.rt!.chain.install(postfx, deps);');
    ok(i > 0 && inst[i - 2] === 'export function installEffects(postfx: PostFX, deps: FxInstallDeps = {}): void {' && inst[i + 1] === "// Ambient occlusion reads the frame's lights from the context and makes its region target (sharing" && inst[i + 3] === 'postfx.registerPass(new SsaoPass(ssaoHostFor(postfx)));', 'install.ts: the WebGPU side installs what is ported before the WebGL lines 8d0c759 had, which stand after it');
    // The boot: the chain on WebGPU on a line of its own after the pair that holds the WebGL boot's line.
    const m = lines('src/main.ts');
    const b = m.indexOf('if (GPU.webgpu && S.effects && GPU.rt!.chain.atLoad) this.postfx = this.makePostFX();');
    ok(b > 0 && m[b - 1] === 'else if (S.effects) this.postfx = this.makePostFX();' && m[b - 2] === 'if (GPU.webgpu) this.forceGpuOff();', "main.ts: the boot makes WebGPU's chain on a line of its own after the WebGL boot's line, which stands as it was");
    // The Effects switch in play: on WebGPU the WebGL path's own switch, unless the chain was left out at load.
    const r = m.indexOf('if (GPU.webgpu && !GPU.rt!.chain.atLoad) {');
    ok(r > 0 && m[r + 1] === 'this.syncPreviewEffects();' && m[r + 2] === 'return;' && m[r + 3] === '}' && m[r + 4] === 'if (this.fxBusy) {', 'main.ts: the Effects switch is held off on WebGPU only with the chain left out at load, the WebGL path after it as it was');
    // Every chain held off in words only inside forceGpuOff, which runs on WebGPU alone.
    const f = m.indexOf('private forceGpuOff(): void {');
    const e = m.indexOf("if (!rt.chain.atLoad) rt.forced('effects', \"the effects chain is left out at load (localStorage['swg.gpu.chain'] = '0'): straight to the canvas, three's tone mapping at the game's exposure\");");
    ok(f > 0 && e > f && e - f < 4, 'main.ts: the effects are said held off on WebGPU only inside forceGpuOff, and only with the chain left out at load');
    for (const g6 of ['gpuChain.ts', 'gpuChainPasses.ts', 'gpuSsao.ts', 'gpuSsaoPass.ts', 'inlineOutput.ts']) ok(existsSync(join(SRC, 'core', 'gpu', g6)), `step 6's ${g6} is under src/core/gpu/`);
    const startText = readFileSync(join(SRC, 'core', 'gpu', 'start.ts'), 'utf8');
    ok(startText.includes('const chain = chainRuntime(renderer);') && startText.includes('chain: chain.report(),'), "start.ts: the runtime hands the game the chain, and gpu() says it");
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
  /**
   * What step 6's fixer adds to the Effects switch in play (`World.gpuSwitch`, `gpuSwitchCatchUp`): a WebGPU line that adds
   * and has no WebGL branch, there exactly once, with the line `8d0c759` had there right after it.
   */
  const switchAdded: [string, string, string][] = [
    ['src/main.ts', 'if (GPU.webgpu) this.world.gpuSwitch = { target: next ? next.compileTarget : null, listed: new WeakSet() };', "const label = want ? 'Effects on' : 'Effects off';"],
    ['src/main.ts', 'if (GPU.webgpu) await this.world.gpuSwitchCatchUp((n) => this.notice.set(`${label}: shaders for ${n} more objects`));', 'if (this.settings.effects !== want) {'],
    ['src/main.ts', 'if (GPU.webgpu) this.world.gpuSwitch = null;', 'this.fxBusy = false;'],
    ['src/world/world.ts', 'if (GPU.webgpu && this.gpuSwitch && this.gpuSwitch.target === target) for (const o of objects) this.gpuSwitch.listed.add(o);', 'const before = r.info.programs?.length ?? 0;'],
  ];
  for (const [f, gpu, gl] of switchAdded) {
    const l = lines(f);
    const at = l.flatMap((x, i) => (x === gpu ? [i] : []));
    ok(at.length === 1, `${f}: the WebGPU line is there once: ${gpu}`);
    ok(l[at[0] + 1] === gl, `${f}: the line 8d0c759 had there follows the WebGPU line: ${gl}`);
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
    // Pass 1, wave 2: three's indirect light held at 0.187's goes on first (`gpuLightHold.ts`).
    ok(/LOOK_PARTS\.push\(lightHoldPart, detailPart, specPart, cardPart\);\s*installLooks\(renderer\);/.test(startText) && startText.indexOf('installLooks(renderer);') > startText.indexOf('const fallback: FallbackStats = installFallback(renderer);'), "start.ts: the looks go on the node library after the fallback's wrap");
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
    // Step 6 asks for the inline output's live switch (item 5) on the same line, after the carries, and the performance step
    // its draw switches after that.
    const ask = l.findIndex((x) => x.includes('o.carries === true || o.inline !== undefined || o.draw) ? rt.tune({ ...o, scene: this.scene })'));
    ok(back > 0 && ask > back && ask - back < 6, "main.ts: gpu() asks for the carries' check only after its WebGL return");
    const warm = readFileSync(join(SRC, 'core', 'gpu', 'patchWarm.ts'), 'utf8');
    ok(warm.includes("if (o.name === 'flora stand-in' && o.receiveShadow !== true) {"), 'patchWarm.ts: the flora stand-ins are told to receive as the batches do, inside the warm patch');
    ok(warm.includes("if (o.name === 'flora stand-in' && o.castShadow !== true) {"), "patchWarm.ts: and told to cast, so the sun's cascades list their shadow pipelines, inside the warm patch");
    const flora = readFileSync(join(SRC, 'world', 'flora.ts'), 'utf8');
    ok(!/receiveShadow|castShadow/.test(flora.slice(flora.indexOf('standIns(): THREE.InstancedMesh[] {'), flora.indexOf('materials(out: Set<THREE.Material>'))), 'flora.ts: the stand-ins are made as 1446f2a made them');
  }
  // Step 5 (the ground's tile program, the version-3 ground and the far rings on WebGPU): each site registers a node material
  // of its own as its stand-in on a WebGPU line of its own, the WebGL lines it had standing round it as they stood; the
  // composition window's picture is made RGBA32UI on WebGPU alone; the horizon's self test hands WebGPU its own half before
  // the WebGL line; and the rings are held to the far tiles only with their part left out at load.
  {
    const step5: [string, string, string, string][] = [
      // [file, WebGPU line, the line before it, the line after it]
      ['src/world/terrainTextures.ts', 'if (GPU.webgpu) mat.userData.gpuStandIn = () => GPU.rt!.standIns.groundTiles(u);', '// stand-in, each chunk in its colour map\'s colour, where that part is left out at load).', 'return mat;'],
      ['src/world/terrainTextures.ts', "if (GPU.webgpu) [mat.userData.gpuStandIn, mat.customProgramCacheKey] = [() => GPU.rt!.standIns.groundFamilies({ texture, layerOf, sizeOf, normals, normalScale, glossScale }), () => `swg-ground-wet-${mat.uuid}`];", "// material: three keeps one built graph a key, and two worlds of one count would draw each other's.", 'this.material = mat;'],
      ['src/world/horizon/horizonRings.ts', 'if (GPU.webgpu) mat.userData.gpuStandIn = () => GPU.rt!.standIns.ring(u, ground);', '// On WebGPU (the GPU port\'s step 5) the ring program is a node material of its own over the very same uniforms.', 'return mat;'],
      ['src/world/horizon/horizonRings.ts', 'if (GPU.webgpu) widenWindowTex(w);', "// picture as a float one, and takes `internalFormat` for WebGPU's own format name.", 'const tn = tex1(THREE.RGBAFormat, THREE.UnsignedByteType, new Uint8Array([255, 255, 255, 255]));'],
      ['src/world/horizon/horizonField.ts', 'if (GPU.webgpu) widenWindowTex(t);', "// On WebGPU (the GPU port's step 5) RGBA32UI, its numbers the same (`widenWindowTex`).", 'return t;'],
      ['src/world/horizon/horizonField.ts', 'if (GPU.webgpu) widenWindowTex(this.winTex);', 'this.winTex.needsUpdate = true;', 'this.tintTex.image = { data: tint, width: p.T, height: p.T } as never;'],
      ['src/world/horizon/horizonField.ts', 'if (GPU.webgpu && type === THREE.UnsignedShortType) [data, type] = [Uint32Array.from(data as Uint16Array), THREE.UnsignedIntType];', "// The composition window's strips on WebGPU (the GPU port's step 5): RGBA32UI, as the window is there.", 'const src = new THREE.DataTexture(data as never, r.w, r.h, format, type);'],
      ['src/world/world.ts', 'if (GPU.webgpu) return GPU.rt!.horizonSelfTest({ ground: f.groundTables, groundArray: s.ground.uGround.value, patch: s.patch, scene: this.scene, camera: this.camera!, uniforms: s.uniforms, fine: f.surface.fine, coarse: f.surface.coarse, shape: f.shape });', "// On WebGPU (the GPU port's step 5) the means, the ring's textures off its WGSL and its arithmetic on the GPU.", 'return f.selfTest(this.renderer, s.ground, s.material);'],
      ['src/main.ts', "if (GPU.webgpu && key === 'farRings' && GPU.rt!.look({}).rings !== true) return { off: 'left out at load on WebGPU (swg.gpu.rings)' };", "// The far rings are on WebGPU from the port's step 5, unless their part was left out at load (localStorage['swg.gpu.rings'] = '0').", "// The far tiles' radius while the rings stand in their place (the horizon pass): their reach is the Terrain distance."],
      ['src/main.ts', 'if (GPU.webgpu && g !== \'tiles\' && GPU.rt!.look({}).rings !== true) return "left out at load on WebGPU (localStorage[\'swg.gpu.rings\'] = \'0\'): the far ground is drawn as far tiles there";', "// The far rings are drawn on WebGPU from the port's step 5 (`gpuGround.ts`), unless their part was left out at load.", 'const was = HORIZON_TUNE.ground;'],
    ];
    for (const [f, gpu, before, afterLine] of step5) {
      const l = lines(f);
      const at = l.flatMap((x, i) => (x === gpu ? [i] : []));
      ok(at.length === 1, `${f}: step 5's WebGPU line is there once: ${gpu}`);
      ok(l[at[0] - 1] === before && l[at[0] + 1] === afterLine, `${f}: step 5's WebGPU line stands between the lines 28fdb7c had there: ${afterLine}`);
    }
    // The guards folded into forceGpuOff (WebGPU alone): the rings held to the far tiles only with their part left out at load.
    const l = lines('src/main.ts');
    const f = l.indexOf('private forceGpuOff(): void {');
    const g = l.indexOf('if (rt.look({}).rings !== true) {');
    ok(f > 0 && g > f && g - f < 12 && l[g + 2] === "HORIZON_TUNE.ground = 'tiles';", 'main.ts: the far ground is held to the far tiles on WebGPU only inside forceGpuOff, and only with the rings left out at load');
    ok(l.filter((x) => x === "if (GPU.webgpu && ((isFxSettingKey(key) && !GPU.rt!.chain.knobPorted(key)) || key.startsWith('vol') || key === 'farCardsHorizon')) return { off: GPU.rt!.chain.knobWhy(key) ?? 'not on WebGPU yet' };").length === 1, "main.ts: the Graphics page's far rings row is on WebGPU from step 5, the Effects setting and the rows of the passes ported from step 6 (the chain's knobPorted), every other effect, the volumetrics and the far tree cards still not");
    for (const g5 of ['gpuGround.ts', 'gpuGroundSelfTest.ts']) ok(existsSync(join(SRC, 'core', 'gpu', g5)), `step 5's ${g5} is under src/core/gpu/`);
    const startText = readFileSync(join(SRC, 'core', 'gpu', 'start.ts'), 'utf8');
    ok(startText.includes("groundSelfTest: () => groundSelfTestGpu(renderer),") && startText.includes('return horizonSelfTestGpu(renderer, o);'), "start.ts: the ground's and the horizon's self tests are the WebGPU side's own");
    ok(/renderer\.copyTextureToTexture = \(src: Any, dst: Any, \.\.\.rest: Any\[\]\) => \{\s*if \(\(src\?\.isDataTexture === true \|\| src\?\.isDataArrayTexture === true\) && src\.image\?\.data\) src\.needsUpdate = true;/.test(startText), "start.ts: a data source is marked for upload at every copy on WebGPU, as WebGL's copy uploads its bytes");
  }
  // Step 5's own programs (items 3 to 6: the lava, the marks, the blades, the client's particles and the weather's variant,
  // the tunnel): each site registers its node graph on a WebGPU line of its own, the WebGL lines it had standing round it as
  // they stood (the lava's step 3 line is unchanged: the runtime's `lava` is the graph now); the marks, made with their module
  // before the boot, are handed their graphs by the boot's own guarded line; the weather hands the warm-up its hidden batches
  // on WebGPU before the WebGL lines, and twins of them in each of its pass's stencils; a batch of the world's carries the
  // portal renderer's stencil from its making and a modulate batch the client's blend, on WebGPU alone; and the noise volume
  // goes up with no chain on WebGPU alone.
  {
    const own: [string, string, string, string][] = [
      // [file, WebGPU line, the line before it, the line after it]
      ['src/combat/saberBlade.ts', 'if (GPU.webgpu) for (const m of [this.glow, this.core, this.smearGlow, this.smearCore]) m.material.userData.gpuStandIn = () => GPU.rt!.standIns.blade();', "// On WebGPU (the GPU port's step 5) the ribbons' program is a node graph of its own, one for every ribbon of every blade.", 'for (let i = 0; i < HISTORY; i++) this.history.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), age: Infinity });'],
      ['src/world/particles.ts', 'if (GPU.webgpu) material.userData.gpuStandIn = () => GPU.rt!.standIns.particles(shader !== null);', "// weather's (`WEATHER_PARTICLE_SHADER`, the one there is), drawn by its own variant.", '// Three 0.187 blends `MultiplyBlending` only premultiplied: WebGL says so and leaves the last blend standing, WebGPU says'],
      ['src/world/particles.ts', "if (GPU.webgpu && blend === 'modulate') Object.assign(material, { blending: THREE.CustomBlending, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor });", "// rule instead (`particle.mjs`'s 'modulate': the colour under it times the texel's colour, its alpha kept).", "// WebGPU keys a pipeline on the stencil the portal renderer writes on every material it registers, which the world's"],
      ['src/world/particles.ts', 'if (GPU.webgpu && !shader) { Object.assign(material, { stencilWrite: true, stencilFunc: THREE.EqualStencilFunc, stencilFuncMask: 0xff, stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp }); shareRef(material); }', "// the weather's, whose pass writes its own at each draw) carries that stencil from the start, `registerMaterial`'s own.", 'const geometry = new THREE.BufferGeometry();'],
      ['src/world/particles.ts', 'if (GPU.webgpu) { const own = new Set([...this.batches.values()].map((b) => b.mesh.geometry)); for (const o of [...this.scene.children]) if (o.userData.gpuWarmTwin === true && own.has((o as THREE.Mesh).geometry)) { this.scene.remove(o); ((o as THREE.Mesh).material as THREE.Material).dispose(); } }', "// On WebGPU the warm-up's twins (`gpuWarmTwins`): this set's own, found by the geometry they share with its batches.", 'for (const b of this.batches.values()) {'],
      ['src/world/particles.ts', 'if (GPU.webgpu) t.minFilter = t.magFilter = THREE.LinearFilter;', '// a texture filtered nearest both ways as a fetch with no sampler, so a graph built while it was bound fetched them all.', 't.needsUpdate = true;'],
      ['src/world/marks.ts', 'this.standIn.minFilter = this.standIn.magFilter = THREE.LinearFilter;', '// filtered nearest both ways as a fetch with no sampler, so the graph built while it was bound would fetch the sheet.', 'this.blended.useGpu();'],
      ['src/world/weather.ts', 'if (GPU.webgpu) for (const portalView of [false, true]) fx.gpuWarmTwins((m) => passStencil(m, portalView));', "// which WebGPU keys a pipeline on, through hidden twins of the set's own warm batches (`gpuWarmTwins`).", 'this.fxEffects = fx;'],
      ['src/world/particles.ts', "if (GPU.webgpu) for (const blend of ['alpha', 'add', 'modulate'] as const) this.batch('@gpu-warm', blend, this.white);", '// blending draws with behind the loading screen: WebGPU keys a pipeline on its blending, WebGL\'s program never on it.', '}'],
      ['src/space/hyperspaceTunnel.ts', 'if (GPU.webgpu) this.material.userData.gpuStandIn = () => GPU.rt!.standIns.tunnel();', "// On WebGPU (the GPU port's step 5) the program is a node graph of its own, warmed with the rest behind every screen.", '// A unit sphere with its poles on Z (the nose), scaled to the ellipsoid per jump.'],
      ['src/main.ts', 'if (GPU.webgpu) this.marks.useGpu();', "// On WebGPU (the GPU port's step 5) both sheets drawn by a node graph of their own: made with the module, before the boot.", '// What lays the mark a bolt leaves where it stops (`src/combat/scars.ts`). The combat code has'],
      ['src/world/weather.ts', 'if (GPU.webgpu) return renderer.compileAsync(this.gpuRoot, camera, this.scene).then(() => undefined, () => undefined);', '// hidden for want of quads: handed as a root of its drawables, the warm-up lists every one (`patchWarm.ts`).', 'if (waitReady) return renderer.compileAsync(this.scene, camera, this.scene).then(() => undefined, () => undefined);'],
      ['src/world/heatNoise.ts', 'if (GPU.webgpu) tex.generateMipmaps = false;', "// and the lava's own far fade (its veins faded to their mean past two texels a pixel) carries what the chain carried.", 'tex.needsUpdate = true;'],
    ];
    for (const [f, gpu, before, afterLine] of own) {
      const l = lines(f);
      const at = l.flatMap((x, i) => (x === gpu ? [i] : []));
      ok(at.length === 1, `${f}: step 5's WebGPU line is there once: ${gpu}`);
      ok(l[at[0] - 1] === before && l[at[0] + 1] === afterLine, `${f}: step 5's WebGPU line stands between the lines 28fdb7c had there: ${afterLine}`);
    }
    // The lava's site keeps step 3's line: the graph is the runtime's answer to it.
    ok(lines('src/world/lava.ts').filter((x) => x === 'material.userData.gpuStandIn = () => GPU.rt!.standIns.lava(middle);').length === 1, "lava.ts: step 3's stand-in line stands as it was (the runtime answers it with the client's lava)");
    // The marks' sheets get their graphs only from the boot's guard: `useGpu` is called nowhere else under src/.
    const files: string[] = [];
    const walkSrc = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walkSrc(p);
        else if (CODE.test(n) && !n.endsWith('.d.ts')) files.push(p);
      }
    };
    walkSrc(SRC);
    const calls = files.filter((f) => !inGpuDir(f)).flatMap((f) => readFileSync(f, 'utf8').split(/\r?\n/).filter((x) => /\.useGpu\(\)/.test(x) && !/^\s*useGpu\(\)/.test(x)).map((x) => `${rel(f)}: ${x.trim()}`));
    ok(calls.length === 3 && calls.filter((c) => c.startsWith('src/main.ts: if (GPU.webgpu) this.marks.useGpu();')).length === 1 && calls.filter((c) => c.startsWith('src/world/marks.ts:')).length === 2, `the marks' WebGPU graphs are handed over from the boot's guard alone: ${calls.join('; ')}`);
    // The particles' warm twins are made by the weather's guarded line alone, and touch nothing on WebGL: the method is
    // called nowhere else, and the set's dispose reaches them only on its own WebGPU line.
    const twins = files.flatMap((f) => readFileSync(f, 'utf8').split(/\r?\n/).filter((x) => /\.gpuWarmTwins\(/.test(x)).map((x) => `${rel(f)}: ${x.trim()}`));
    ok(twins.length === 1 && twins[0].startsWith('src/world/weather.ts: if (GPU.webgpu) for (const portalView of [false, true]) fx.gpuWarmTwins('), `the particles' warm twins are made from the weather's WebGPU guard alone: ${twins.join('; ')}`);
    ok(lines('src/world/particles.ts').filter((x) => /gpuWarmTwin\b/.test(x) && !/^\s*(\/\/|\*)/.test(x)).every((x) => /twin\.userData\.gpuWarmTwin = true;|if \(GPU\.webgpu\) \{ const own/.test(x)), "particles.ts: the twins' mark is written by the method and read by the dispose's WebGPU line alone");
    // The weather's root for the warm-up is a getter, made only when the WebGPU line asks for it.
    const w = readFileSync(join(SRC, 'world', 'weather.ts'), 'utf8');
    ok(/private get gpuRoot\(\): THREE\.Object3D \{/.test(w) && (w.match(/this\.gpuRoot/g) ?? []).length === 1, 'weather.ts: the warm-up root is a getter read by the WebGPU line alone');
    ok(existsSync(join(SRC, 'core', 'gpu', 'gpuPrograms.ts')), "step 5's gpuPrograms.ts is under src/core/gpu/");
    const startText = readFileSync(join(SRC, 'core', 'gpu', 'start.ts'), 'utf8');
    ok(startText.includes('programs: programsReport(),') && startText.includes('notPorted: { ...NOT_PORTED },'), "start.ts: gpu() says the programs of step 5 and what is not ported");
  }
  // The doorways on WebGPU: their two ways of being drawn each wear a material of their own, the WebGL lines after the guard.
  {
    const l = lines('src/world/portalRender.ts');
    const at = l.indexOf('if (GPU.webgpu) return this.drawPortalsGpu(meshes, n, camera, from, depthTest, restore);');
    ok(at > 0 && l[at + 1] === 'const m = this.portalMat;' && l[at + 2] === 'if (restore) {', 'portalRender.ts: the doorways are drawn as they were on WebGL after the WebGPU guard');
  }
  // The performance step: the frame report and the draw switches. Its modules are under src/core/gpu/ and reached only
  // through start.ts (section 2 holds that the WebGL graph loads none of them); the console's two new words are read only
  // after the helper's WebGL answer has returned, and the switches are installed only by the WebGPU runtime.
  {
    for (const p of ['framePerf.ts', 'drawCost.ts', 'patchReplay.ts', 'shadowCull.ts']) ok(existsSync(join(SRC, 'core', 'gpu', p)), `the performance step's ${p} is under src/core/gpu/`);
    const m = lines('src/main.ts');
    const gl = m.indexOf("if (!GPU.webgpu) return { renderer: 'WebGL (three WebGLRenderer)', ...how, refused: GPU.refused ?? undefined, note: GPU.refused ? 'WebGPU was asked for and could not start here' : 'WebGPU is not in use: nothing of it was loaded' };");
    const rtAt = m.indexOf('const rt = GPU.rt!;', gl);
    const perfAt = m.findIndex((x) => x.startsWith('if (o?.perf) return rt.perf('));
    const tunedAt = m.findIndex((x) => x.startsWith('const tuned = o && (') && x.includes('|| o.draw)'));
    ok(gl > 0 && rtAt === gl + 1 && perfAt > rtAt && perfAt - rtAt < 4 && tunedAt > perfAt && tunedAt - perfAt < 4, "main.ts: gpu({ perf }) and gpu({ draw }) are read only after the helper's WebGL answer has returned, through the WebGPU runtime");
    const startText = readFileSync(join(SRC, 'core', 'gpu', 'start.ts'), 'utf8');
    ok(startText.includes('readDrawSwitches();') && startText.includes('installShadowCull(renderer);') && startText.includes('registerDrawPerfSwitches(registerPerfSwitch);') && startText.includes('draw: drawCostReport(),'), 'start.ts: the WebGPU runtime reads, installs, registers and reports the draw switches');
    const patchesText = readFileSync(join(SRC, 'core', 'gpu', 'patches.ts'), 'utf8');
    ok(patchesText.includes("else if (e.name === 'replay') installReplayPatch(renderer);"), 'patches.ts: the replay patch is installed with the others, on the WebGPU renderer');
    // Nothing outside src/core/gpu/ reaches any of the four (section 3 holds the import graph; this names them).
    const all: string[] = [];
    const walkAll = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walkAll(p);
        else if (CODE.test(n) && !n.endsWith('.d.ts')) all.push(p);
      }
    };
    walkAll(SRC);
    const outside = all.filter((f) => !inGpuDir(f)).flatMap((f) => readFileSync(f, 'utf8').split(/\r?\n/).filter((x) => /\b(import|from)\b/.test(x) && /(framePerf|drawCost|patchReplay|shadowCull)(\.ts)?['"]/.test(x)).map((x) => `${rel(f)}: ${x.trim()}`));
    ok(outside.length === 0, `nothing outside src/core/gpu/ imports the performance step's modules: ${outside.join('; ')}`);
    // The performance step's `sweepPace` (maker B): the sweep's WebGPU guard reads the pace through the runtime alone, and
    // the WebGL path's own line follows the guarded block exactly as e6d1e1f had it after the batch's `continue`.
    const w = lines('src/world/world.ts');
    const g = w.flatMap((x, i) => (x === 'if (GPU.webgpu && !behind && GPU.rt!.sweepPaceMs() > 0) {' ? [i] : []));
    ok(g.length === 1, `world.ts: the sweep's pace is asked behind GPU.webgpu once (${g.length})`);
    ok(w[g[0] + 1] === 'if (sweepYieldPaced(built, t1 - sliceFrom, behind, LOADING_TUNE.sliceMs, GPU.rt!.sweepPaceMs())) {' && w[g[0] + 2] === 'await this.nextFrame();' && w[g[0] + 3] === 'sliceFrom = performance.now();' && w[g[0] + 4] === '}' && w[g[0] + 5] === 'continue;' && w[g[0] + 6] === '}', 'world.ts: the guarded block paces the batch and goes on to the next');
    ok(w[g[0] + 7] === 'if (sweepYield(built, t1 - sliceFrom, behind, LOADING_TUNE.sliceMs)) {' && w[g[0] + 8] === 'await this.nextFrame();' && w.filter((x) => x === 'if (sweepYield(built, t1 - sliceFrom, behind, LOADING_TUNE.sliceMs)) {').length === 1, "world.ts: the WebGL path's own sweepYield line follows the WebGPU block, there once, as it was");
    ok(startText.includes('return DRAW_COST.sweepPace ? WARM_TUNE.sliceInPlayMs : 0;'), 'start.ts: the runtime answers the pace from the switch and the warm-up\'s in-play slice');
  }
  // Pass 1, wave 1 (items 1, 2, 4 and 5): the pipeline ledger, the key census, the landing log and the card's clock are
  // modules under src/core/gpu/ reached only through start.ts (section 2 holds that the WebGL graph loads none of them); the
  // console's two new words are read only after the helper's WebGL answer has returned; the frame's end hands the runtime the
  // travel's flag on its WebGPU line alone; and the runtime installs the ledger and makes the clock.
  {
    for (const p of ['pipeLedger.ts', 'keyCensus.ts', 'gpuTimer.ts']) ok(existsSync(join(SRC, 'core', 'gpu', p)), `pass 1's ${p} is under src/core/gpu/`);
    const m = lines('src/main.ts');
    const gl = m.indexOf("if (!GPU.webgpu) return { renderer: 'WebGL (three WebGLRenderer)', ...how, refused: GPU.refused ?? undefined, note: GPU.refused ? 'WebGPU was asked for and could not start here' : 'WebGPU is not in use: nothing of it was loaded' };");
    const keysAt = m.findIndex((x) => x.startsWith('if (o?.keys) return { ...rt.keys('));
    const landingAt = m.findIndex((x) => x === 'if (o?.landing) return rt.landing(o.landing === true ? {} : o.landing);');
    ok(gl > 0 && keysAt > gl && keysAt - gl < 12 && landingAt === keysAt + 1, "main.ts: gpu({ keys }) and gpu({ landing }) are read only after the helper's WebGL answer has returned, through the WebGPU runtime");
    ok(m.filter((x) => x.includes('rt.keys(') || x.includes('rt.landing(')).length === 2, 'main.ts: the census and the log are asked nowhere else');
    const ends = m.filter((x) => x.includes('GPU.rt!.endFrame('));
    ok(ends.length === 1 && ends[0] === 'if (GPU.webgpu) GPU.rt!.endFrame(this.traveling || !this.inWorld, this.traveling);', `main.ts: the frame's end hands the runtime the travel's flag on its WebGPU line alone (${ends.join(' | ')})`);
    const startText = readFileSync(join(SRC, 'core', 'gpu', 'start.ts'), 'utf8');
    ok(startText.includes('installLedger(renderer, ') && startText.includes('const timer = passTimer(renderer, adapter.vendor);') && startText.includes('ledgerFrame(loading, traveling);') && startText.includes('return keyCensus(renderer, o);') && startText.includes('return landingReport(o);'), 'start.ts: the WebGPU runtime installs the ledger, makes the clock, calls the frame and answers the two words');
    const perfText = readFileSync(join(SRC, 'core', 'gpu', 'framePerf.ts'), 'utf8');
    ok(!/\btrackTimestamp\b|timestampQueryPool|resolveTimestampsAsync/.test(perfText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')),"framePerf.ts: the card's clock is read through the adapter alone (gpuTimer.ts), the file three r188's GPUTimer changes");
    const all: string[] = [];
    const walkAll = (d: string): void => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walkAll(p);
        else if (CODE.test(n) && !n.endsWith('.d.ts')) all.push(p);
      }
    };
    walkAll(SRC);
    const outside = all.filter((f) => !inGpuDir(f)).flatMap((f) => readFileSync(f, 'utf8').split(/\r?\n/).filter((x) => /\b(import|from)\b/.test(x) && /(pipeLedger|keyCensus|gpuTimer)(\.ts)?['"]/.test(x)).map((x) => `${rel(f)}: ${x.trim()}`));
    ok(outside.length === 0, `nothing outside src/core/gpu/ imports wave 1's modules: ${outside.join('; ')}`);
  }
  // The boot: WebGPU only when it was asked for, through the one function that imports it.
  const main = lines('src/main.ts');
  ok(main.filter((x) => x === "if (GPU.asked === 'webgpu') await startGpu();").length === 1, 'main.ts: the boot starts WebGPU only when asked for it');
  const start = main.indexOf('async function startGpu(): Promise<void> {');
  ok(start > 0 && main.slice(start, start + 6).includes("const m = await import('./core/gpu/start.ts');"), 'main.ts: startGpu makes the one dynamic import');
  ok(main.indexOf('readRendererSwitch();') > 0 && main.indexOf('readRendererSwitch();') < main.indexOf("if (GPU.asked === 'webgpu') await startGpu();"), 'main.ts: the switch is read before the boot asks it');
}

console.log(`gpuOff: ${checks} checks passed`);
