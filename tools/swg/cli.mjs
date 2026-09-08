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
//                                                                  convert the world snapshot's objects around a point into a layout,
//                                                                  and copy the planet's terrain (.trn) plus building terrain layers (.lay)
//   node tools/swg/cli.mjs terrain <swg-dir> <planet> <out-dir>    copy just the terrain template into a pack
//   node tools/swg/cli.mjs terrain-check <out-dir> [--limit=n] [--layers] [--at=x,z]
//                                                                  generate terrain at every snapshot object and compare with its height;
//                                                                  --layers lists every layer, --at prints the height at one point
//
// Flags: --retail-only (mount only archives named in the retail manifests)
//        --no-flip (keep left-handed coordinates)  --no-textures (skip DDS decoding)
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { resolveParts } from './appearance.mjs';
import { decodeDds } from './dds.mjs';
import { buildGlb } from './glb.mjs';
import { dump, parseIff } from './iff.mjs';
import { classifyDirectory, isRetailByName } from './manifest.mjs';
import { parseMesh } from './msh.mjs';
import { buildPack, familyOf } from './pack.mjs';
import { parseSnapshot, flattenWithWorldTransforms } from './ws.mjs';
import { resolveTemplateMesh, resolveTemplateString } from './objtemplate.mjs';
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

/** Apply a row-major 3x4 transform to a parsed mesh's positions and normals in place. */
function transformMesh(mesh, m) {
  for (const g of mesh.groups) {
    for (const p of g.primitives) {
      const pos = p.positions;
      for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i], y = pos[i + 1], z = pos[i + 2];
        pos[i] = m[0] * x + m[1] * y + m[2] * z + m[3];
        pos[i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
        pos[i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
      }
      const nrm = p.normals;
      if (nrm) {
        for (let i = 0; i < nrm.length; i += 3) {
          const x = nrm[i], y = nrm[i + 1], z = nrm[i + 2];
          nrm[i] = m[0] * x + m[1] * y + m[2] * z;
          nrm[i + 1] = m[4] * x + m[5] * y + m[6] * z;
          nrm[i + 2] = m[8] * x + m[9] * y + m[10] * z;
        }
      }
    }
  }
  mesh.bounds = null;
  for (const hp of mesh.hardpoints) {
    const [x, y, z] = hp.position;
    hp.position = [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
  }
}

function boundsFromPositions(mesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const g of mesh.groups) for (const p of g.primitives) {
    for (let i = 0; i < p.positions.length; i += 3) for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p.positions[i + k]);
      max[k] = Math.max(max[k], p.positions[i + k]);
    }
  }
  return { min, max };
}

/** Load an appearance as one merged mesh: component parts are baked by their transforms. */
function loadAppearanceMesh(vfs, appearancePath) {
  const parts = resolveParts(vfs, appearancePath);
  const merged = { version: '', groups: [], hardpoints: [], bounds: null, warnings: [] };
  for (const part of parts) {
    const mesh = parseMesh(parseIff(vfs.read(part.mesh)));
    if (part.transform) transformMesh(mesh, part.transform);
    merged.groups.push(...mesh.groups);
    merged.hardpoints.push(...mesh.hardpoints);
    merged.warnings.push(...mesh.warnings);
    if (parts.length === 1) merged.bounds = mesh.bounds;
  }
  if (!merged.bounds) merged.bounds = boundsFromPositions(merged);
  return { mesh: merged, meshPath: parts.length === 1 ? parts[0].mesh : appearancePath, partCount: parts.length };
}

function convertOne(vfs, appearancePath, outFile) {
  const { mesh, meshPath, partCount } = loadAppearanceMesh(vfs, appearancePath);
  const textures = new Map();
  for (const g of mesh.groups) {
    const t = textureFor(vfs, g.shader);
    if (t) textures.set(g.shader, t);
  }
  const flipX = !flags.has('--no-flip');
  const glb = buildGlb([{ name: basename(meshPath).replace(/\.[^.]+$/, ''), ...mesh }], { flipX, textures });
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, glb);
  const tris = mesh.groups.reduce((n, g) => n + g.primitives.reduce((m, p) => m + p.indices.length / 3, 0), 0);
  const shaders = [...new Set(mesh.groups.map((g) => g.shader))];
  return { meshPath, mesh, flipX, tris, shaders, textured: textures.size, warnings: mesh.warnings, partCount };
}

/** Copy terrain/<planet>.trn into the pack as terrain.trn. Returns the file name or null. */
function copyTerrain(vfs, planet, outDir) {
  const path = `terrain/${planet}.trn`;
  if (!vfs.has(path)) return null;
  writeFileSync(join(outDir, 'terrain.trn'), vfs.read(path));
  return 'terrain.trn';
}

/** Copy a building template's terrain modification layer (.lay) into <out>/terrain/. Returns the pack-relative file or null. */
function copyTerrainLayer(vfs, template, outDir, cache) {
  const raw = resolveTemplateString(vfs, template, ['terrainModificationFileName'], cache);
  if (!raw) return null;
  const path = raw.replace(/\\/g, '/').replace(/^\//, '');
  const rel = `terrain/${basename(path)}`;
  const target = join(outDir, rel);
  if (!existsSync(target)) {
    if (!vfs.has(path)) {
      console.warn(`terrain layer missing: ${path} (for ${template})`);
      return null;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, vfs.read(path));
  }
  return rel;
}

/** Yaw (rotation about Y) of a w,x,y,z quaternion: the heading of its forward vector. */
function yawOf(q) {
  const [w, x, y, z] = q;
  return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
}

/** Compare generated terrain heights with the snapshot's object heights. Needs Node 22.18+ (runs the game's TypeScript directly). */
async function terrainCheck(dir, limit, opts = {}) {
  const { parseTerrainTemplate, parseLayerFile, TerrainSampler } = await import('../../src/swg/terrain/trn.ts');
  const trnPath = join(dir, 'terrain.trn');
  if (!existsSync(trnPath)) throw new Error(`${trnPath} missing; run the snapshot (or terrain) command first`);
  const t0 = Date.now();
  const template = parseTerrainTemplate(new Uint8Array(readFileSync(trnPath)));
  const gen = template.generator;
  console.log(`terrain ${template.name}: map ${template.mapWidthInMeters} m, chunk ${template.chunkWidthInMeters} m, ${template.numberOfTilesPerChunk} tiles/chunk (${template.tileWidthInMeters} m tiles), version ${template.version}, water ${template.useGlobalWaterTable ? template.globalWaterTableHeight : 'none'}, loaded in ${Date.now() - t0} ms`);
  console.log(`  layer items: ${Object.entries(gen.summary()).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  fractal families: ${gen.fractalGroup.families.size}, shader families: ${gen.shaderGroup.families.size}`);
  if (opts.layers) {
    console.log('  fractals:');
    for (const [id, f] of gen.fractalGroup.families) {
      const m = f.fractal;
      console.log(`    ${id} ${f.name}: seed ${m.seed} rule ${m.combinationRule} octaves ${m.numberOfOctaves} freq ${m.frequency} amp ${m.amplitude} scale ${m.scaleX},${m.scaleY} offset ${m.offsetX},${m.offsetY}${m.useBias ? ` bias ${m.bias}` : ''}${m.useGain ? ` gain ${m.gain}` : ''}`);
    }
    console.log('  layers:');
    for (const line of gen.describe()) console.log(`    ${line}`);
  }
  const sampler = new TerrainSampler(template);
  if (opts.at) {
    const [ax, az] = opts.at.split(',').map(Number);
    console.log(`  height at ${ax},${az}: ${sampler.heightAt(ax, az).toFixed(3)} (base terrain, before building layers)`);
  }
  const layoutPath = join(dir, 'layout.json');
  if (!existsSync(layoutPath)) {
    console.log('no layout.json: nothing to compare');
    return;
  }
  const layout = JSON.parse(readFileSync(layoutPath, 'utf8'));
  const objects = layout.objects.filter((o) => !o.contained);
  // Buildings first: their modification layers flatten the ground for everything else.
  let layers = 0;
  const t1 = Date.now();
  for (const o of objects) {
    if (!o.layer) continue;
    const file = join(dir, o.layer);
    if (!existsSync(file)) continue;
    const layer = parseLayerFile(new Uint8Array(readFileSync(file)), gen);
    if (!layer) continue;
    sampler.addBuildingLayer(layer, o.x, o.z, yawOf(o.q));
    layers++;
  }
  console.log(`  ${layers} building terrain layers applied in ${Date.now() - t1} ms`);
  const t2 = Date.now();
  const rows = [];
  for (const o of objects) {
    const h = sampler.heightAt(o.x, o.z);
    rows.push({ o, h, err: h - o.y });
  }
  const ms = Date.now() - t2;
  const signed = rows.map((r) => r.err).sort((a, b) => a - b);
  const q = (p) => signed[Math.min(signed.length - 1, Math.floor(signed.length * p))];
  console.log(`  signed error (generated - object): 10% ${q(0.1).toFixed(2)}, 25% ${q(0.25).toFixed(2)}, median ${q(0.5).toFixed(2)}, 75% ${q(0.75).toFixed(2)}, 90% ${q(0.9).toFixed(2)} m`);
  const bins = new Map();
  for (const e of signed) {
    const b = Math.max(-10, Math.min(10, Math.round(e)));
    bins.set(b, (bins.get(b) ?? 0) + 1);
  }
  console.log(`  histogram (m -> objects): ${[...bins.entries()].sort((a, b) => a[0] - b[0]).map(([b, n]) => `${b}:${n}`).join(' ')}`);
  const abs = rows.map((r) => Math.abs(r.err)).sort((a, b) => a - b);
  const pct = (p) => abs[Math.min(abs.length - 1, Math.floor(abs.length * p))];
  console.log(`  ${rows.length} objects sampled in ${ms} ms (${sampler.numberOfPoles}x${sampler.numberOfPoles} poles per chunk)`);
  console.log(`  |height error| median ${pct(0.5).toFixed(2)} m, 90% ${pct(0.9).toFixed(2)} m, max ${abs[abs.length - 1].toFixed(2)} m; within 0.5 m: ${((abs.filter((a) => a <= 0.5).length / abs.length) * 100).toFixed(1)}%`);
  const nan = rows.filter((r) => !Number.isFinite(r.h)).length;
  if (nan) console.log(`  WARNING: ${nan} non-finite heights`);
  rows.sort((a, b) => Math.abs(b.err) - Math.abs(a.err));
  console.log(`  worst ${Math.min(limit, rows.length)}:`);
  for (const r of rows.slice(0, limit)) console.log(`    ${r.err >= 0 ? '+' : ''}${r.err.toFixed(2)} m  at ${r.o.x.toFixed(1)},${r.o.z.toFixed(1)} object y ${r.o.y.toFixed(2)} generated ${r.h.toFixed(2)}  ${r.o.template}${r.o.layer ? ` [${r.o.layer}]` : ''}`);
  const withLayer = rows.filter((r) => r.o.layer);
  if (withLayer.length) {
    const la = withLayer.map((r) => Math.abs(r.err)).sort((a, b) => a - b);
    console.log(`  buildings with layers: ${withLayer.length}, median |error| ${la[Math.floor(la.length / 2)].toFixed(2)} m`);
  }
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
    const entries = flattenWithWorldTransforms(snap);
    console.error(`${wsPath}: ${snap.nodes.length} top-level objects, ${entries.length} including contained, ${snap.templates.length} templates`);
    const inRegion = entries.filter((e) => e.world && Math.hypot(e.world.pos[0] - cx, e.world.pos[2] - cz) <= radius);
    console.error(`${inRegion.length} within ${radius} m of ${cx},${cz}`);
    const cache = new Map();
    const skipped = {};
    const examples = {};
    const skip = (reason, template) => {
      skipped[reason] = (skipped[reason] ?? 0) + 1;
      (examples[reason] ??= new Set()).add(template);
    };
    const models = new Map();
    const objects = [];
    const layerCache = new Map();
    mkdirSync(outDir, { recursive: true });
    for (const e of inRegion) {
      const n = e.node;
      const template = snap.templates[n.templateIndex];
      const r = resolveTemplateMesh(vfs, template, cache);
      if (r.skip) {
        skip(r.skip, template);
        continue;
      }
      const single = r.parts.length === 1 && !r.parts[0].transform;
      const id = familyOf(single ? r.parts[0].mesh : r.appearance);
      if (!models.has(id)) {
        if (models.size >= max) break;
        try {
          const conv = convertOne(vfs, single ? r.parts[0].mesh : r.appearance, join(outDir, `${id}.glb`));
          const b = conv.mesh.bounds ?? { min: [0, 0, 0], max: [0, 0, 0] };
          const bounds = conv.flipX ? { min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] } : b;
          models.set(id, { id, source: r.source ?? r.appearance, file: `${id}.glb`, bounds, triangles: conv.tris, textured: conv.textured, shaders: conv.shaders.length, parts: conv.partCount });
          console.error(`  ${id}: ${conv.tris} tris, ${conv.textured}/${conv.shaders.length} textured${conv.partCount > 1 ? `, ${conv.partCount} parts` : ''}`);
        } catch (err) {
          models.set(id, { failed: err.message });
        }
      }
      const model = models.get(id);
      if (!model || model.failed) {
        skip(`convert failed: ${model?.failed ?? 'unknown'}`, template);
        continue;
      }
      const obj = { template, model: id, x: e.world.pos[0], y: e.world.pos[1], z: e.world.pos[2], q: e.world.q, radius: n.radius, contained: e.parentId !== 0 };
      if (!obj.contained) {
        const layer = copyTerrainLayer(vfs, template, outDir, layerCache);
        if (layer) obj.layer = layer;
      }
      objects.push(obj);
    }
    const terrainFile = copyTerrain(vfs, planet, outDir);
    const layout = { planet, center: { x: cx, z: cz }, radius, terrain: terrainFile, objects, skipped };
    writeFileSync(join(outDir, 'layout.json'), JSON.stringify(layout));
    const manifestPath = join(outDir, 'manifest.json');
    const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { planet, categories: {} };
    manifest.categories.layout = [...models.values()].filter((m) => m && !m.failed);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`layout: ${objects.length} objects, ${manifest.categories.layout.length} models -> ${join(outDir, 'layout.json')}`);
    console.log(`terrain: ${terrainFile ?? 'not found'}, ${objects.filter((o) => o.layer).length} objects with terrain modification layers (${new Set(objects.map((o) => o.layer).filter(Boolean)).size} files)`);
    for (const [reason, count] of Object.entries(skipped).sort((a, b) => b[1] - a[1])) {
      console.log(`  skipped ${count}: ${reason}`);
      for (const ex of [...(examples[reason] ?? [])].slice(0, 3)) console.log(`      e.g. ${ex}`);
    }
    printEffectSummary();
    break;
  }
  case 'terrain': {
    if (!pos[3]) usage();
    const vfs = mount(pos[1]);
    mkdirSync(pos[3], { recursive: true });
    const file = copyTerrain(vfs, pos[2], pos[3]);
    console.log(file ? `terrain -> ${join(pos[3], file)}` : `no terrain/${pos[2]}.trn in archives`);
    break;
  }

  case 'terrain-check': {
    if (!pos[1]) usage();
    await terrainCheck(pos[1], Number(options.limit ?? 30), { layers: args.includes('--layers'), at: options.at });
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
