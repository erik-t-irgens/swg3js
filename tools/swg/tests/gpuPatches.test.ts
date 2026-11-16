// The GPU port's four private patches of three (step 3, item 8): every method of three's a patch replaces or leans on
// (`src/core/gpu/patchTable.ts`) is held here to the text it had in three 0.187.0, by a hash recorded when the patch was
// written. An upgrade of three that moves any of them fails this test, naming the method and the patch, so the patch is
// read again before it is trusted; the patches themselves refuse to apply on any revision but the one they were written
// for (`patchApplies`), which this test holds as well.
//
// The text is read out of the build files the game really loads (`three/webgpu` is `build/three.webgpu.js`, whose node
// classes come from `build/three.tsl.js`): a method is its class's line from `\t<name>(` to the class's next `\t}` at the
// same indent, inside the block from `class <Class> ` at the line's start to the next class declared at the line's start.
// Line endings are folded to LF before hashing.
//
// Run: node tools/swg/tests/gpuPatches.test.ts   (print the hashes as they stand: add --print)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PATCH_REVISION, PATCH_TABLE, PATCH_NEEDS, patchApplies, type ThreeMethod } from '../../../src/core/gpu/patchTable.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const BUILD = join(ROOT, 'node_modules', 'three', 'build');
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
};

/** The text of every method the patches name, as recorded with three 0.187.0 (sha-256 of the method's text, first 16 hex). */
const RECORDED: Record<string, string> = {
  'three.webgpu.js Renderer._getShadowNodes': '4143f2b75aa3efea',
  'three.webgpu.js Renderer.renderObject': 'ab36645b68732692',
  'three.webgpu.js Renderer._createObjectPipeline': 'c9d2eb8999d2135b',
  'three.webgpu.js Renderer.compileAsync': 'bb3a6574ae6f3981',
  'three.webgpu.js Renderer._renderObjectDirect': '2bab3bbbcd3d47e5',
  'three.webgpu.js Renderer._renderBundle': '6ab91c51b478c478',
  'three.webgpu.js NodeManager._createNodeBuilderState': '7be8e0829a48ce6e',
  'three.webgpu.js Pipelines.getForRender': '3d91da7d74eb7fa4',
  'three.webgpu.js WebGPUBackend.createRenderPipeline': '1e54baaa352940a3',
  'three.webgpu.js WebGPUBackend.beginBundle': '5193858a7922ff11',
  'three.webgpu.js WebGPUBackend.finishBundle': 'df80cc86faf209b3',
  'three.webgpu.js WebGPUBackend.addBundle': 'bab3cffb46bd259f',
  'three.webgpu.js WebGPUBackend.finishRender': '60e1944fff65eb51',
  'three.webgpu.js WebGPUBackend.draw': 'a9220fd94d5ecbf5',
  'three.webgpu.js Renderer._renderTransparents': '64f4b9a819a7b4d3',
  'three.webgpu.js Renderer._renderScene': '71a004a6220646d7',
  'three.tsl.js NodeMaterialObserver.needsRefresh': '522d452d6589354f',
};

const files = new Map<string, string[]>();
const linesOf = (file: string): string[] => {
  let l = files.get(file);
  if (!l) files.set(file, (l = readFileSync(join(BUILD, file), 'utf8').replace(/\r\n?/g, '\n').split('\n')));
  return l;
};

/** A method's text in its class, or null with why. */
function methodText(m: ThreeMethod): { text: string } | { why: string } {
  const lines = linesOf(m.file);
  const start = lines.findIndex((l) => l.startsWith(`class ${m.cls} `) || l.startsWith(`class ${m.cls}{`));
  if (start < 0) return { why: `no class ${m.cls} in build/${m.file}` };
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^(class |export |function |const |let |var )/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const head = new RegExp(`^\\t(async )?${m.method.replace(/\$/g, '\\$')}\\(`);
  const found: number[] = [];
  for (let i = start; i < end; i++) if (head.test(lines[i])) found.push(i);
  if (found.length !== 1) return { why: `${found.length} declarations of ${m.cls}.${m.method} in build/${m.file}` };
  const from = found[0];
  for (let i = from + 1; i < end; i++) if (lines[i] === '\t}') return { text: lines.slice(from, i + 1).join('\n') };
  return { why: `no end found for ${m.cls}.${m.method}` };
}
const hash = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);

// ---------------------------------------------------------------- the revision
{
  const pkg = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'three', 'package.json'), 'utf8')) as { version: string };
  ok(pkg.version === `0.${PATCH_REVISION}.0`, `node_modules/three is 0.${PATCH_REVISION}.0, the release the patches were written against (it is ${pkg.version})`);
  ok(patchApplies('shadow', '188', {}) !== null && /r188/.test(patchApplies('shadow', '188', {}) ?? ''), 'a patch refuses another revision, in words');
  const bare: Record<string, unknown> = {};
  ok(/_getShadowNodes/.test(patchApplies('shadow', PATCH_REVISION, bare) ?? ''), 'a patch refuses a renderer that lacks a private method it reaches, naming it');
  // A stand-in renderer with every method each patch reaches answers yes.
  for (const e of PATCH_TABLE) {
    const r: Record<string, unknown> = {};
    for (const path of PATCH_NEEDS[e.name]) {
      const parts = path.split('.');
      let o = r;
      for (let i = 0; i < parts.length - 1; i++) o = (o[parts[i]] ??= {}) as Record<string, unknown>;
      o[parts[parts.length - 1]] = () => undefined;
    }
    ok(patchApplies(e.name, PATCH_REVISION, r) === null, `${e.name}: applies where every method it reaches is there`);
  }
}

// ---------------------------------------------------------------- every method, to its recorded text
{
  const print = process.argv.includes('--print');
  const named = new Set<string>();
  for (const e of PATCH_TABLE) {
    ok(e.replaces.length > 0, `${e.name}: names the methods it replaces`);
    for (const m of [...e.replaces, ...e.relies]) {
      const k = `${m.file} ${m.cls}.${m.method}`;
      named.add(k);
      const t = methodText(m);
      if ('why' in t) {
        ok(false, `${e.name}: ${t.why}`);
        continue;
      }
      const h = hash(t.text);
      if (print) console.log(`  '${k}': '${h}',`);
      ok(k in RECORDED || print, `${e.name}: ${k} has a recorded hash`);
      ok(RECORDED[k] === h || print, `${e.name}: three's ${m.cls}.${m.method} (build/${m.file}) has moved since the patch was written (hash ${h}, recorded ${RECORDED[k]}): read the patch against it again before recording the new hash`);
    }
  }
  for (const k of Object.keys(RECORDED)) ok(named.has(k), `the recorded ${k} is named by a patch`);
}

// ---------------------------------------------------------------- each patch file names what it replaces
{
  for (const e of PATCH_TABLE) {
    const src = readFileSync(join(ROOT, 'src', 'core', 'gpu', e.file), 'utf8');
    for (const m of e.replaces) ok(src.includes(m.method), `${e.file} touches ${m.cls}.${m.method}, as the table says`);
  }
  // The patches are applied on WebGPU alone: only the runtime's own start applies them.
  const start = readFileSync(join(ROOT, 'src', 'core', 'gpu', 'start.ts'), 'utf8');
  ok(start.includes('applyPatches(renderer);') && start.includes('installWarm(renderer,'), 'start.ts applies the patches and installs the warm-up');
  ok(start.indexOf('applyPatches(renderer);') < start.indexOf('installWarm(renderer,'), "start.ts gives the warm-up its verdict before it is installed");
  // The warm-up's own wrap of three's private method sits behind the patch's verdict, so another revision never gets it.
  const warm = readFileSync(join(ROOT, 'src', 'core', 'gpu', 'patchWarm.ts'), 'utf8');
  const guard = warm.indexOf('if (WARM_PATCH.applied) {');
  const wrap = warm.indexOf('be.createRenderPipeline = (');
  ok(guard > 0 && wrap > guard && warm.slice(guard, wrap).split('\n').length <= 3 && warm.split('be.createRenderPipeline = (').length === 2, 'patchWarm.ts wraps createRenderPipeline once, only where the warm patch applied');
}

console.log(`gpuPatches: ${checks} checks passed`);
