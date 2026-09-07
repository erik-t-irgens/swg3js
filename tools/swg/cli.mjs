#!/usr/bin/env node
// SWG asset converter. Reads a locally owned client install; never ships its output.
//
//   node tools/swg/cli.mjs verify <swg-dir>                       classify every archive against retail manifests
//   node tools/swg/cli.mjs headers <swg-dir>                      print the raw header of every archive (diagnostic)
//   node tools/swg/cli.mjs list <swg-dir> [filter]                list files across archives (search priority applied)
//   node tools/swg/cli.mjs extract <swg-dir> <path-in-archive> <out-file>
//   node tools/swg/cli.mjs dump <file.iff> | <swg-dir> <path-in-archive>   print an IFF tree
//   node tools/swg/cli.mjs shader <swg-dir> <shader/x.sht>        list a shader's texture slots
//   node tools/swg/cli.mjs template <swg-dir> <object/x.iff>       print an object template's parameter chain
//   node tools/swg/cli.mjs texture <swg-dir> <texture/x.dds> <out.png>
//   node tools/swg/cli.mjs msh <swg-dir> <appearance-path> <out.glb>
//   node tools/swg/cli.mjs batch <swg-dir> <out-dir> [filter]     convert every .msh matching filter (default appearance/mesh/)
//   node tools/swg/cli.mjs pack <swg-dir> <spec.json> <out-dir>    build a game asset pack from a spec (see packs/)
//   node tools/swg/cli.mjs snapshot <swg-dir> <planet> <out-dir> --center=x,z --radius=r [--max=n]
//                                                                  convert the world snapshot's objects around a point into a layout
//
// Flags: --retail-only (mount only archives named in the retail manifests)
//        --no-flip (keep left-handed coordinates)  --no-textures (skip DDS decoding)
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { resolveToMesh } from './appearance.mjs';
import { decodeDds } from './dds.mjs';
import { buildGlb } from './glb.mjs';
import { dump, parseIff } from './iff.mjs';
import { classifyDirectory, isRetailByName } from './manifest.mjs';
import { parseMesh } from './msh.mjs';
import { buildPack, familyOf } from './pack.mjs';
import { parseSnapshot } from './ws.mjs';
import { resolveTemplateMesh } from './objtemplate.mjs';
import { encodePng } from './png.mjs';
import { shaderTextures } from './sht.mjs';
import { effectAlpha, alphaModeFor } from './eff.mjs';
import { readTemplate, stringParam } from './objtemplate.mjs';
import { openTre, openVfs, readHeader } from './tre.mjs';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')).map((a) => a.split('=')[0]));
const options = Object.fromEntries(args.filter((a) => a.startsWith('--') && a.includes('=')).map((a) => a.slice(2).split('=')));
const pos = args.filter((a) => !a.startsWith('--'));
const cmd = pos[0];

function usage() {
  const src = readFileSync(new URL(import.meta.url)).toString().split('\n');
  console.log(src.filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  process.exit(1);
}

function mount(dir) {
  const retailOnly = flags.has('--retail-only');
  const vfs = openVfs(dir, {
    filter: retailOnly ? (f) => isRetailByName(f, statSync(join(dir, f)).size) !== null : undefined,
  });
  console.error(`mounted ${vfs.summary}${retailOnly ? ' (retail only)' : ''}`);
  return vfs;
}

const textureCache = new Map();
const effectCache = new Map();
const effectUse = new Map();

/** Alpha mode from the effect file's first pass; falls back to the name heuristic. */
function alphaFromEffect(vfs, effect, fallback) {
  if (!effect) return fallback;
  if (!effectCache.has(effect)) {
    let mode = fallback;
    try {
      if (vfs.has(effect)) mode = alphaModeFor(effectAlpha(parseIff(vfs.read(effect))), effect);
    } catch (err) {
      console.error(`  effect ${effect} unreadable: ${err.message}`);
    }
    effectCache.set(effect, mode);
  }
  const mode = effectCache.get(effect);
  const key = `${effect} -> ${mode}`;
  effectUse.set(key, (effectUse.get(key) ?? 0) + 1);
  return mode;
}

function printEffectSummary() {
  if (!effectUse.size) return;
  console.log('effects used:');
  for (const [k, n] of [...effectUse.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${k}`);
}

function textureFor(vfs, shaderPath) {
  if (flags.has('--no-textures')) return null;
  if (textureCache.has(shaderPath)) return textureCache.get(shaderPath);
  let result = null;
  try {
    const { main, alphaMode, effect } = shaderTextures(parseIff(vfs.read(shaderPath)));
    if (main && vfs.has(main)) {
      const dds = decodeDds(vfs.read(main));
      result = { path: main, png: encodePng(dds.width, dds.height, dds.rgba), hasAlpha: dds.hasAlpha, alphaMode: alphaFromEffect(vfs, effect, alphaMode) };
    }
  } catch (err) {
    console.error(`  texture for ${shaderPath} skipped: ${err.message}`);
  }
  textureCache.set(shaderPath, result);
  return result;
}

function convertOne(vfs, appearancePath, outFile) {
  const meshPath = resolveToMesh(vfs, appearancePath);
  const mesh = parseMesh(parseIff(vfs.read(meshPath)));
  const textures = new Map();
  for (const g of mesh.groups) {
    const t = textureFor(vfs, g.shader);
    if (t) textures.set(g.shader, t);
  }
  const flipX = !flags.has('--no-flip');
  const glb = buildGlb([{ name: basename(meshPath, '.msh'), ...mesh }], { flipX, textures });
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, glb);
  const tris = mesh.groups.reduce((n, g) => n + g.primitives.reduce((m, p) => m + p.indices.length / 3, 0), 0);
  return { meshPath, mesh, flipX, tris, shaders: mesh.groups.map((g) => g.shader), textured: textures.size, warnings: mesh.warnings };
}

switch (cmd) {
  case 'verify': {
    if (!pos[1]) usage();
    console.error('hashing every archive; large installs take a few minutes');
    const results = await classifyDirectory(pos[1], (r, done, total) => {
      console.log(`[${String(done).padStart(3)}/${total}] ${r.file.padEnd(34)} ${String(r.size).padStart(12)}  ${r.verdict}`);
    });
    const retail = results.filter((r) => r.set).length;
    console.log(`\n${retail} retail archives, ${results.length - retail} unknown or modified, of ${results.length}`);
    break;
  }
  case 'headers': {
    if (!pos[1]) usage();
    for (const f of readdirSync(pos[1]).filter((x) => x.toLowerCase().endsWith('.tre')).sort()) {
      const h = readHeader(join(pos[1], f));
      let status = 'ok';
      try {
        const t = openTre(join(pos[1], f));
        if (t.dataOnly) status = 'data-only (6000), read through the .toc index';
        t.close();
      } catch (err) {
        status = `FAIL ${err.message}`;
      }
      console.log(`${f.padEnd(34)} ${JSON.stringify(h.magic)} ${h.fields.join(' ')}  ${status}`);
    }
    break;
  }
  case 'list': {
    const vfs = mount(pos[1]);
    for (const name of vfs.list(pos[2])) console.log(name);
    break;
  }
  case 'extract': {
    const vfs = mount(pos[1]);
    mkdirSync(dirname(pos[3]), { recursive: true });
    writeFileSync(pos[3], vfs.read(pos[2]));
    console.log(`wrote ${pos[3]}`);
    break;
  }
  case 'dump': {
    let buf;
    if (pos[2]) buf = mount(pos[1]).read(pos[2]);
    else if (existsSync(pos[1]) && statSync(pos[1]).isFile()) buf = readFileSync(pos[1]);
    else usage();
    console.log(dump(parseIff(buf)).join('\n'));
    break;
  }
  case 'template': {
    const vfs = mount(pos[1]);
    let path = pos[2];
    for (let depth = 0; depth < 8 && path; depth++) {
      if (!vfs.has(path)) {
        console.log(`${path}: missing`);
        break;
      }
      const t = readTemplate(parseIff(vfs.read(path)));
      console.log(`${path}  [${t.type}]  base: ${t.base ?? '(none)'}`);
      for (const [name, buf] of t.params) console.log(`  ${name} = ${stringParam(buf) ?? `<${buf.length} bytes, type ${buf[0]}>`}`);
      path = stringParam(t.params.get('sharedTemplate')) ?? t.base;
    }
    break;
  }
  case 'shader': {
    const vfs = mount(pos[1]);
    const { main, slots, effect, alphaMode } = shaderTextures(parseIff(vfs.read(pos[2])));
    console.log(`effect: ${effect ?? '(none)'}  alpha by name: ${alphaMode}  alpha by effect file: ${alphaFromEffect(vfs, effect, alphaMode)}`);
    for (const s of slots) console.log(`${s.slot}  ${s.path}${s.path === main ? '  (main)' : ''}`);
    break;
  }
  case 'texture': {
    const vfs = mount(pos[1]);
    const dds = decodeDds(vfs.read(pos[2]));
    mkdirSync(dirname(pos[3]), { recursive: true });
    writeFileSync(pos[3], encodePng(dds.width, dds.height, dds.rgba));
    console.log(`${pos[2]} ${dds.width}x${dds.height} ${dds.format}${dds.hasAlpha ? ' with alpha' : ''} -> ${pos[3]}`);
    break;
  }
  case 'msh': {
    const vfs = mount(pos[1]);
    const r = convertOne(vfs, pos[2], pos[3]);
    console.log(`${r.meshPath} -> ${pos[3]} (${r.tris} triangles, ${r.textured}/${r.shaders.length} shaders textured: ${r.shaders.join(', ')})`);
    for (const w of r.warnings) console.log(`  warning: ${w}`);
    break;
  }
  case 'pack': {
    if (!pos[3]) usage();
    const vfs = mount(pos[1]);
    const spec = JSON.parse(readFileSync(pos[2], 'utf8'));
    buildPack(vfs, spec, pos[3], (meshPath, out) => convertOne(vfs, meshPath, out));
    printEffectSummary();
    break;
  }
  case 'snapshot': {
    if (!pos[3] || !options.center) usage();
    const vfs = mount(pos[1]);
    const planet = pos[2];
    const outDir = pos[3];
    const [cx, cz] = options.center.split(',').map(Number);
    const radius = Number(options.radius ?? 400);
    const max = Number(options.max ?? Infinity);
    const wsPath = `snapshot/${planet}.ws`;
    if (!vfs.has(wsPath)) throw new Error(`no ${wsPath} in archives`);
    const snap = parseSnapshot(parseIff(vfs.read(wsPath)));
    console.error(`${wsPath}: ${snap.nodes.length} top-level objects, ${snap.templates.length} templates`);
    const inRegion = snap.nodes.filter((n) => Math.hypot(n.pos[0] - cx, n.pos[2] - cz) <= radius);
    console.error(`${inRegion.length} within ${radius} m of ${cx},${cz}`);
    const cache = new Map();
    const skipped = {};
    const examples = {};
    const models = new Map();
    const objects = [];
    mkdirSync(outDir, { recursive: true });
    for (const n of inRegion) {
      const template = snap.templates[n.templateIndex];
      const r = resolveTemplateMesh(vfs, template, cache);
      if (r.skip) {
        skipped[r.skip] = (skipped[r.skip] ?? 0) + 1;
        (examples[r.skip] ??= new Set()).add(template);
        continue;
      }
      const id = familyOf(r.mesh);
      if (!models.has(id)) {
        if (models.size >= max) break;
        try {
          const conv = convertOne(vfs, r.mesh, join(outDir, `${id}.glb`));
          const b = conv.mesh.bounds ?? { min: [0, 0, 0], max: [0, 0, 0] };
          const bounds = conv.flipX ? { min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] } : b;
          models.set(id, { id, source: r.mesh, file: `${id}.glb`, bounds, triangles: conv.tris, textured: conv.textured, shaders: conv.shaders.length });
          console.error(`  ${id}: ${conv.tris} tris, ${conv.textured}/${conv.shaders.length} textured`);
        } catch (err) {
          skipped[`convert failed: ${err.message}`] = (skipped[`convert failed: ${err.message}`] ?? 0) + 1;
          models.set(id, null);
          continue;
        }
      }
      if (!models.get(id)) continue;
      objects.push({ template, model: id, x: n.pos[0], y: n.pos[1], z: n.pos[2], q: n.q, radius: n.radius, children: n.children.length });
    }
    const layout = { planet, center: { x: cx, z: cz }, radius, objects, skipped };
    writeFileSync(join(outDir, 'layout.json'), JSON.stringify(layout));
    const manifestPath = join(outDir, 'manifest.json');
    const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { planet, categories: {} };
    manifest.categories.layout = [...models.values()].filter(Boolean);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`layout: ${objects.length} objects, ${manifest.categories.layout.length} models -> ${join(outDir, 'layout.json')}`);
    for (const [reason, count] of Object.entries(skipped).sort((a, b) => b[1] - a[1])) {
      console.log(`  skipped ${count}: ${reason}`);
      for (const ex of [...examples[reason]].slice(0, 3)) console.log(`      e.g. ${ex}`);
    }
    printEffectSummary();
    break;
  }
  case 'batch': {
    const vfs = mount(pos[1]);
    const outDir = pos[2];
    const filter = pos[3] ?? 'appearance/mesh/';
    let ok = 0;
    const failures = [];
    for (const name of vfs.list(filter)) {
      if (!name.endsWith('.msh')) continue;
      const out = join(outDir, name.replace(/\.msh$/, '.glb'));
      try {
        convertOne(vfs, name, out);
        ok++;
      } catch (err) {
        failures.push(`${name}: ${err.message}`);
      }
    }
    console.log(`converted ${ok} meshes, ${failures.length} failed`);
    if (failures.length) {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, 'failures.log'), failures.join('\n'));
      console.log(`see ${join(outDir, 'failures.log')}`);
    }
    break;
  }
  default:
    usage();
}
