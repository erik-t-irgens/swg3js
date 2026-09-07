#!/usr/bin/env node
// SWG asset converter. Reads a locally owned client install; never ships its output.
//
//   node tools/swg/cli.mjs verify <swg-dir>                       classify every archive against retail manifests
//   node tools/swg/cli.mjs headers <swg-dir>                      print the raw header of every archive (diagnostic)
//   node tools/swg/cli.mjs list <swg-dir> [filter]                list files across archives (search priority applied)
//   node tools/swg/cli.mjs extract <swg-dir> <path-in-archive> <out-file>
//   node tools/swg/cli.mjs dump <file.iff> | <swg-dir> <path-in-archive>   print an IFF tree
//   node tools/swg/cli.mjs shader <swg-dir> <shader/x.sht>        list a shader's texture slots
//   node tools/swg/cli.mjs texture <swg-dir> <texture/x.dds> <out.png>
//   node tools/swg/cli.mjs msh <swg-dir> <appearance-path> <out.glb>
//   node tools/swg/cli.mjs batch <swg-dir> <out-dir> [filter]     convert every .msh matching filter (default appearance/mesh/)
//   node tools/swg/cli.mjs pack <swg-dir> <spec.json> <out-dir>    build a game asset pack from a spec (see packs/)
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
import { buildPack } from './pack.mjs';
import { encodePng } from './png.mjs';
import { shaderTextures } from './sht.mjs';
import { openTre, openVfs, readHeader } from './tre.mjs';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
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

function textureFor(vfs, shaderPath) {
  if (flags.has('--no-textures')) return null;
  if (textureCache.has(shaderPath)) return textureCache.get(shaderPath);
  let result = null;
  try {
    const { main, alphaMode } = shaderTextures(parseIff(vfs.read(shaderPath)));
    if (main && vfs.has(main)) {
      const dds = decodeDds(vfs.read(main));
      result = { path: main, png: encodePng(dds.width, dds.height, dds.rgba), hasAlpha: dds.hasAlpha, alphaMode };
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
  case 'shader': {
    const vfs = mount(pos[1]);
    const { main, slots, effect, alphaMode } = shaderTextures(parseIff(vfs.read(pos[2])));
    console.log(`effect: ${effect ?? '(none)'}  alpha: ${alphaMode}`);
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
