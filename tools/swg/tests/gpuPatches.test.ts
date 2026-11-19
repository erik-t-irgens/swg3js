// The GPU port's private patches of three (step 3, item 8): every method of three's a patch replaces or leans on
// (`src/core/gpu/patchTable.ts`) is held here to the text it has in the installed three, by a hash recorded when the patch
// was last read against it (three 0.187.0, then three's development commit 577fb27 in pass 1's wave 2). An upgrade of three
// that moves any of them fails this test, naming the method and the patch, so the patch is read again before it is trusted;
// the patches themselves refuse to apply on any revision but the one each was proven on (`patchApplies`), which this test
// holds as well.
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
import { PATCH_REVISIONS, PATCH_TABLE, PATCH_NEEDS, patchApplies, type ThreeMethod } from '../../../src/core/gpu/patchTable.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const BUILD = join(ROOT, 'node_modules', 'three', 'build');
let checks = 0;
const ok = (cond: unknown, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
};

/**
 * The text of every method the patches name (sha-256 of the method's text, first 16 hex), as recorded with three 0.187.0 and
 * read again at three's development commit `577fb27` (pass 1, wave 2): sixteen of the twenty-one are the same text; the five
 * that moved are recorded anew below, each read against the patch that names it.
 */
const RECORDED: Record<string, string> = {
  'three.webgpu.js Renderer._getShadowNodes': '4143f2b75aa3efea',
  // Moved at 577fb27: a shadow pass's material is drawn in one pass whatever its side (`isSinglePass`), where 0.187 drew a
  // two-sided see-through caster's shadow back then front. The shadow patch's colour node and the warm-up's listing (which
  // keeps the side each item was listed with) stand as they were; three's adjustments to the override are the same ten.
  'three.webgpu.js Renderer.renderObject': 'c55b1d652b3c9e5a',
  // Moved at 577fb27: three always queues here now (its synchronous path is gone); the warm-up swaps the method for its
  // listing during the walk alone, as before, and builds each item itself.
  'three.webgpu.js Renderer._createObjectPipeline': 'a02dd42b74a88703',
  // Moved at 577fb27: the state is taken by `_getPrecompilationState` before the walk and put back in a `finally`, and no node
  // graph is built asynchronously; the walk is still synchronous (the warm-up lists in it) and the context still takes the
  // renderer's own depth and stencil (`withTargetDepth`).
  'three.webgpu.js Renderer.compileAsync': 'e45c181e86891d2e',
  'three.webgpu.js Renderer._renderObjectDirect': '2bab3bbbcd3d47e5',
  'three.webgpu.js Renderer._renderBundle': '6ab91c51b478c478',
  'three.webgpu.js NodeManager._createNodeBuilderState': '7be8e0829a48ce6e',
  'three.webgpu.js Pipelines.getForRender': '3d91da7d74eb7fa4',
  'three.webgpu.js WebGPUBackend.createRenderPipeline': '1e54baaa352940a3',
  'three.webgpu.js WebGPUBackend.beginBundle': '5193858a7922ff11',
  'three.webgpu.js WebGPUBackend.finishBundle': 'df80cc86faf209b3',
  'three.webgpu.js WebGPUBackend.addBundle': 'bab3cffb46bd259f',
  // Moved at 577fb27: a split pass's later layers continue its timestamp query (`_continueTimestampQuery`); the stencil patch
  // runs its bundles before calling it whole, as before.
  'three.webgpu.js WebGPUBackend.finishRender': 'a3e4d93c2176bb40',
  // Moved at 577fb27: a comment taken out, nothing else.
  'three.webgpu.js WebGPUBackend.draw': 'db889ce2c53b3e09',
  'three.webgpu.js Renderer._renderTransparents': '64f4b9a819a7b4d3',
  'three.webgpu.js Renderer._renderScene': '71a004a6220646d7',
  'three.tsl.js NodeMaterialObserver.needsRefresh': '522d452d6589354f',
  // The performance step's replay patch (`patchReplay.ts`): what it wraps and what its answer stands on.
  'three.webgpu.js NodeManager.needsRefresh': '4626b6f6132104ef',
  'three.webgpu.js Renderer._bundleNeedsUpdate': '68e9d067ae2566be',
  'three.tsl.js NodeMaterialObserver.hasDynamicInstancing': '9b708c29c023642f',
  'three.tsl.js NodeMaterialObserver.equals': '7b4b90afcd33a2fa',
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
// Pass 1, wave 2: three is one pinned commit of its development branch (`577fb27`, REVISION `188dev` at every development
// commit, its package.json still saying 0.187.0), so the revision is read from three's own constants and the commit from
// the lockfile, which holds the tarball of that commit by its integrity.
const PIN = '577fb270cb4ac153c689856aa6e096342561fb38';
{
  const constants = readFileSync(join(ROOT, 'node_modules', 'three', 'src', 'constants.js'), 'utf8');
  const revision = /export const REVISION = '([^']+)';/.exec(constants)?.[1] ?? '?';
  for (const e of PATCH_TABLE) ok(PATCH_REVISIONS[e.name] === revision, `${e.name}: proven on r${PATCH_REVISIONS[e.name]}, the installed three's revision (${revision})`);
  const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')) as { packages: Record<string, { resolved?: string; integrity?: string }> };
  const three = lock.packages['node_modules/three'];
  ok(three?.resolved === `https://codeload.github.com/mrdoob/three.js/tar.gz/${PIN}` && /^sha512-/.test(three?.integrity ?? ''), `the lockfile pins three to the tarball of commit ${PIN.slice(0, 7)} by its integrity`);
  ok(patchApplies('shadow', '188', {}) !== null && /three is r188, the patch was proven on r188dev/.test(patchApplies('shadow', '188', {}) ?? ''), 'a patch refuses another revision, in words (the release 0.188.0 included, until each patch is read against it)');
  ok(patchApplies('shadow', '187', {}) !== null, 'and the revision it was proven on before');
  const bare: Record<string, unknown> = {};
  ok(/_getShadowNodes/.test(patchApplies('shadow', revision, bare) ?? ''), 'a patch refuses a renderer that lacks a private method it reaches, naming it');
  // A stand-in renderer with every method each patch reaches answers yes.
  for (const e of PATCH_TABLE) {
    const r: Record<string, unknown> = {};
    for (const path of PATCH_NEEDS[e.name]) {
      const parts = path.split('.');
      let o = r;
      for (let i = 0; i < parts.length - 1; i++) o = (o[parts[i]] ??= {}) as Record<string, unknown>;
      o[parts[parts.length - 1]] = () => undefined;
    }
    ok(patchApplies(e.name, PATCH_REVISIONS[e.name], r) === null, `${e.name}: applies where every method it reaches is there`);
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
