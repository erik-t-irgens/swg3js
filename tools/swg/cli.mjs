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
//   node tools/swg/cli.mjs planets <swg-dir>                        list the world snapshots in the archives and where each would centre
//   node tools/swg/cli.mjs pois <swg-dir> <planet>|all <out-dir>    (re)write just pois.json for packs converted already
//   node tools/swg/cli.mjs creatures <swg-dir> <out-dir>              every planet's creature as a skinned GLB under <out-dir>/creatures/
//   node tools/swg/cli.mjs sat <swg-dir> <x.sat | object/mobile/shared_x.iff> <out.glb> [--anim=all|idle,walk] [--var=skin_color=3,...] [--wear=object/tangible/wearables/...,...]
//   node tools/swg/cli.mjs trt <swg-dir> <x.trt> <out.png> [--var=name=value,...]   bake a texture renderer blueprint (skin, hair) to a PNG
//   node tools/swg/cli.mjs player <swg-dir> <out-dir> [--template=object/creature/player/shared_human_male.iff] [--wear=...] [--var=...]   the player's character as <out-dir>/player/<id>.glb + manifest.json
//                                                                  convert a skeletal appearance (creature, character) with skeleton and animations
//   node tools/swg/cli.mjs flora <swg-dir> <planet>|all <out-dir>   (re)convert just the flora models for packs converted already
//   node tools/swg/cli.mjs snapshot <swg-dir> <planet>|all <out-dir> [--center=x,z|auto] --radius=r|all [--max=n]
//                                                                  convert the world snapshot's objects around a point into a layout,
//                                                                  and copy the planet's terrain (.trn) plus building terrain layers (.lay);
//                                                                  the centre defaults to the planet's starport (else its busiest spot);
//                                                                  "all" converts every planet the game knows into <out-dir>/<planet>
//   node tools/swg/cli.mjs stat <swg-dir> <file>                    which archive provides a file (after load order and deletions)
//   node tools/swg/cli.mjs why <swg-dir> <planet> <pattern>         why snapshot objects matching a name do or do not convert
//   node tools/swg/cli.mjs pob <swg-dir> <file.pob>                 print a portal building's cells, portals and links (diagnostic)
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
import { loadBuildouts, mergeBuildouts } from './buildout.mjs';
import { composeMeshes, mergeSkeletons, parseAnimation, parseLat, parseLmg, parseMgn, parseSat, parseSkeleton, poseAtFrame, readIff, skinData, skinnedPrimitives } from './skeletal.mjs';
import { resolveTemplateMesh, resolveTemplateString } from './objtemplate.mjs';
import { encodePng } from './png.mjs';
import { shaderTextures } from './sht.mjs';
import { bakeShader, describeShader, describeVariables, loadShader, parseBlueprint, preparedShaders, renderBlueprint, renderContext, shaderNeedsBake } from './texrender.mjs';
import { effectAlpha, alphaModeFor } from './eff.mjs';
import { localize, parseDatatable } from './datatable.mjs';
import { createRequire } from 'node:module';

/** Named places per planet (see regions/build.mjs). */
const REGIONS = createRequire(import.meta.url)('./regions/regions.json');
import { decodeTga, encodeHeightmap } from './tga.mjs';
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
/**
 * Load every mesh part of an appearance into one merged mesh. Portal buildings keep their
 * cells apart in `cells` (exterior first) so the game can hide the shell from inside.
 */
function loadAppearanceMesh(vfs, appearancePath) {
  const parts = resolveParts(vfs, appearancePath);
  const merged = { version: '', groups: [], hardpoints: [], bounds: null, warnings: [] };
  const cells = new Map();
  let portalGeometry = null;
  for (const part of parts) {
    const mesh = parseMesh(parseIff(vfs.read(part.mesh)));
    if (part.transform) transformMesh(mesh, part.transform);
    merged.groups.push(...mesh.groups);
    merged.hardpoints.push(...mesh.hardpoints);
    merged.warnings.push(...mesh.warnings);
    if (parts.length === 1) merged.bounds = mesh.bounds;
    if (part.cell !== undefined) {
      const cell = cells.get(part.cell) ?? cells.set(part.cell, { index: part.cell, name: part.cellName, groups: [], hardpoints: [], warnings: [], portals: part.cellPortals ?? [] }).get(part.cell);
      cell.groups.push(...mesh.groups);
      cell.hardpoints.push(...mesh.hardpoints);
      portalGeometry ??= part.portalGeometry ?? null;
    }
  }
  if (!merged.bounds) merged.bounds = boundsFromPositions(merged);
  const cellList = [...cells.values()].sort((a, b) => a.index - b.index);
  for (const c of cellList) c.bounds = boundsFromPositions(c);
  return { mesh: merged, meshPath: parts.length === 1 ? parts[0].mesh : appearancePath, partCount: parts.length, cells: cellList.length > 1 ? cellList : null, portalGeometry };
}

function convertOne(vfs, appearancePath, outFile) {
  const { mesh, meshPath, partCount, cells, portalGeometry } = loadAppearanceMesh(vfs, appearancePath);
  const textures = new Map();
  for (const g of mesh.groups) {
    const t = textureFor(vfs, g.shader);
    if (t) textures.set(g.shader, t);
  }
  const flipX = !flags.has('--no-flip');
  const baseName = basename(meshPath).replace(/\.[^.]+$/, '');
  // One GLB node per portal cell ("cell:<index>:<name>"), or a single node for plain appearances.
  const meshes = cells ? cells.map((c) => ({ name: `cell:${c.index}:${c.name}`, groups: c.groups, hardpoints: c.hardpoints, bounds: c.bounds })) : [{ name: baseName, ...mesh }];
  const glb = buildGlb(meshes, { flipX, textures });
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, glb);
  const tris = mesh.groups.reduce((n, g) => n + g.primitives.reduce((m, p) => m + p.indices.length / 3, 0), 0);
  const shaders = [...new Set(mesh.groups.map((g) => g.shader))];
  const flipBounds = (b) => (flipX && b ? { min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] } : b);
  const cellInfo = cells ? cells.map((c) => ({ index: c.index, name: c.name, bounds: flipBounds(c.bounds), portals: c.portals.map((p) => ({ geometry: p.geometry, target: p.target, passable: p.passable && !p.disabled })) })) : undefined;
  // Portal polygons in model space (X flipped with the meshes) so the game can tell which cell the player is in.
  const portals = portalGeometry ? portalGeometry.map((p) => ({ v: p.verts.map(([x, y, z]) => [flipX ? -x : x, y, z]), i: p.indices })) : undefined;
  return { meshPath, mesh, flipX, tris, shaders, textured: textures.size, warnings: mesh.warnings, partCount, cells: cellInfo, portals };
}

/**
 * Copy terrain/<planet>.trn into the pack as terrain.trn, plus every bitmap its bitmap
 * filters reference (TGA decoded to "HMAP" greyscale files under terrain/). Returns the
 * terrain file name or null. Needs Node 22.18+ for the bitmap step (runs the game's TypeScript).
 */
async function copyTerrain(vfs, planet, outDir) {
  const path = `terrain/${planet}.trn`;
  if (!vfs.has(path)) return null;
  const bytes = vfs.read(path);
  writeFileSync(join(outDir, 'terrain.trn'), bytes);
  try {
    const { parseTerrainTemplate, bitmapFiles } = await import('../../src/swg/terrain/trn.ts');
    const template = parseTerrainTemplate(new Uint8Array(bytes));
    lastTemplate = template;
    for (const b of bitmapFiles(template)) {
      const src = b.name.replace(/\\/g, '/').replace(/^\//, '');
      if (!vfs.has(src)) {
        console.warn(`terrain bitmap missing: ${src}`);
        continue;
      }
      const img = decodeTga(vfs.read(src));
      const target = join(outDir, b.file);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, encodeHeightmap(img));
      console.error(`  terrain bitmap ${src}: ${img.width}x${img.height} ${img.greyscale ? 'greyscale' : `type ${img.imageType}/${img.pixelDepth} bit`} -> ${b.file}`);
    }
  } catch (err) {
    console.warn(`terrain bitmaps not converted: ${err.message}`);
  }
  if (lastTemplate) copyTerrainShaders(vfs, lastTemplate, outDir);
  return 'terrain.trn';
}

/**
 * The ground textures: one per shader family (its heaviest child's main texture, at most 512 px),
 * written under <out>/terrain/shaders/ and listed with each family's metres-per-repeat in
 * terrain/shaders.json, which the game blends across the ground.
 */
function copyTerrainShaders(vfs, template, outDir) {
  const families = [];
  let missing = 0;
  for (const fam of template.generator.shaderGroup.families.values()) {
    const child = [...fam.children].sort((a, b) => b.weight - a.weight)[0];
    const entry = { id: fam.id, name: fam.name, size: fam.shaderSize, file: null, shader: child ? child.name.replace(/\\/g, '/') : null };
    families.push(entry);
    if (!child) continue;
    // Families name their shaders bare (rock_cliff_anza): look for the file wherever it lives.
    const bare = entry.shader.replace(/^\//, '');
    const stem = bare.replace(/\.sht$/i, '').toLowerCase();
    const path = [bare, `${bare}.sht`, `shader/${bare}`, `shader/${bare}.sht`, `shader/terrain/${stem}.sht`].find((c) => vfs.has(c)) ?? vfs.list(`${stem}.sht`).find((f) => f === `${stem}.sht` || f.endsWith(`/${stem}.sht`));
    if (!path) {
      console.warn(`terrain shader missing: ${bare} (family ${fam.id} ${fam.name})`);
      missing++;
      continue;
    }
    try {
      const { main } = shaderTextures(parseIff(vfs.read(path)));
      if (!main || !vfs.has(main)) throw new Error(`no main texture${main ? ` (${main} not in archives)` : ''}`);
      const img = downscaleRgba(decodeDds(vfs.read(main)), 512);
      const rel = `terrain/shaders/${fam.id}_${fam.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}.png`;
      mkdirSync(join(outDir, 'terrain/shaders'), { recursive: true });
      writeFileSync(join(outDir, rel), encodePng(img.width, img.height, img.rgba));
      entry.file = rel;
      entry.texture = main;
    } catch (err) {
      console.warn(`terrain shader ${path}: ${err.message}`);
      missing++;
    }
  }
  mkdirSync(join(outDir, 'terrain'), { recursive: true });
  writeFileSync(join(outDir, 'terrain/shaders.json'), JSON.stringify({ families }, null, 1));
  console.error(`  terrain shaders: ${families.length - missing}/${families.length} families with textures -> terrain/shaders.json`);
}

/** Box-filter an RGBA image down by whole factors until neither side exceeds `max`. */
function downscaleRgba(img, max) {
  let { width, height, rgba } = img;
  while (width > max || height > max) {
    const w = Math.max(1, width >> 1);
    const h = Math.max(1, height >> 1);
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        for (let c = 0; c < 4; c++) {
          const x0 = Math.min(width - 1, x * 2), x1 = Math.min(width - 1, x * 2 + 1);
          const y0 = Math.min(height - 1, y * 2), y1 = Math.min(height - 1, y * 2 + 1);
          out[(y * w + x) * 4 + c] = (rgba[(y0 * width + x0) * 4 + c] + rgba[(y0 * width + x1) * 4 + c] + rgba[(y1 * width + x0) * 4 + c] + rgba[(y1 * width + x1) * 4 + c] + 2) >> 2;
        }
      }
    }
    width = w;
    height = h;
    rgba = out;
  }
  return { width, height, rgba };
}

/** The terrain template copyTerrain parsed last (for the flora conversion that follows it). */
let lastTemplate = null;

/**
 * Convert the appearances the terrain's flora families name (trees, rocks, plants) into
 * <out>/flora/ and record them as the pack's `flora` category, keyed by appearance file.
 */
function convertFlora(vfs, template, outDir, manifest) {
  const families = [...template.generator.floraGroup.families.values()];
  if (!families.length) return { models: 0, missing: 0, families: 0 };
  mkdirSync(join(outDir, 'flora'), { recursive: true });
  const defs = new Map();
  let missing = 0;
  let particles = 0;
  for (const family of families) {
    for (const child of family.children) {
      const appearance = child.appearance;
      const key = appearance.toLowerCase();
      if (defs.has(key)) continue;
      if (/\.prt$/i.test(appearance)) {
        // Particle systems (insects, dust): not meshes.
        particles++;
        continue;
      }
      if (!vfs.has(appearance)) {
        missing++;
        console.warn(`flora appearance missing: ${appearance} (family ${family.name})`);
        continue;
      }
      const id = familyOf(appearance);
      try {
        const conv = convertOne(vfs, appearance, join(outDir, 'flora', `${id}.glb`));
        const b = conv.mesh.bounds ?? { min: [0, 0, 0], max: [0, 0, 0] };
        const bounds = conv.flipX ? { min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] } : b;
        defs.set(key, { id, file: `flora/${id}.glb`, bounds, triangles: conv.tris, textured: conv.textured, shaders: conv.shaders.length, appearance, family: family.id, familyName: family.name });
      } catch (err) {
        missing++;
        console.warn(`flora ${appearance}: ${err.message}`);
      }
    }
  }
  manifest.categories.flora = [...defs.values()];
  return { models: defs.size, missing, particles, families: families.length };
}

/**
 * Friendly clip names for the locomotion loops. The client's speed selector picks the child
 * whose recorded movement speed is nearest the creature's speed, in no fixed order, so the
 * default loop_stand (and loop_stand_combat) steps are named by that speed: idle for the
 * still one, walk and run for the slowest and fastest moving ones.
 */
function nameLocomotion(entries, loadAnimation) {
  const named = entries.map((e) => ({ ...e, clip: e.name, speed: 0 }));
  // Creatures: loop_stand:speedN[:variant]; players: loop_standing:<gender>:speedN[:variant].
  // One entry per speed: the default variant (marked default, or with no variant suffix), from
  // the first selector branch the table lists.
  const LOCO = /^(loop_stand(?:ing)?(?:_combat)?)((?::\d+)*):speed(\d+)((?::\d+)*)$/;
  const branches = new Map();
  for (const e of named) {
    const m = e.name.match(LOCO);
    if (!m) continue;
    const suffix = m[1].endsWith('_combat') ? '_combat' : '';
    const key = `${m[1]}${m[2]}`;
    if (!branches.has(suffix)) branches.set(suffix, { key, bySpeed: new Map() });
    const branch = branches.get(suffix);
    if (branch.key !== key) continue;
    const rank = e.isDefault === true ? 2 : m[4].length === 0 ? 1 : 0;
    const current = branch.bySpeed.get(Number(m[3]));
    if (!current || rank > current.rank) branch.bySpeed.set(Number(m[3]), { e, rank });
  }
  for (const [suffix, branch] of branches) {
    const group = [...branch.bySpeed.values()].map((c) => c.e);
    for (const e of group) {
      try {
        e.speed = loadAnimation(e)?.locomotionSpeed ?? 0;
      } catch {
        e.speed = 0;
      }
    }
    if (!group.length) continue;
    const moving = group.filter((e) => e.speed > 0.05).sort((a, b) => a.speed - b.speed);
    const still = group.filter((e) => e.speed <= 0.05);
    if (still.length) still[0].clip = `idle${suffix}`;
    else if (moving.length) moving.shift().clip = `idle${suffix}`;
    if (moving.length === 1) moving[0].clip = `${moving[0].speed > 4 ? 'run' : 'walk'}${suffix}`;
    else if (moving.length >= 2) {
      moving[0].clip = `walk${suffix}`;
      moving[moving.length - 1].clip = `run${suffix}`;
      moving.slice(1, -1).forEach((e, i) => (e.clip = `walk${i + 2}${suffix}`));
    }
  }
  return named;
}

/**
 * Convert a skeletal appearance (.sat, or an object template that names one) into a skinned
 * GLB with its skeleton and the animations its logical animation table lists.
 * `animations` filters logical names by substring ('all' keeps every one).
 */
/** --var=a=1,b=2 → Map of customization variable values (matched by full or short name). */
function customizationValues(spec) {
  const values = new Map();
  for (const part of (spec ?? '').split(',')) {
    const m = part.match(/^\s*([^=]+?)\s*=\s*(-?\d+)\s*$/);
    if (m) values.set(m[1], Number(m[2]));
  }
  return values;
}

/**
 * The texture for one skinned mesh's shader: a texture-renderer blueprint's output when the mesh
 * names one for it (skin, hair, eyes), the shader baked with its default palette colours when its
 * look depends on them, otherwise the shader's main texture as for any other mesh.
 */
function skinnedTexture(vfs, shaderPath, slots, ctx, info) {
  let shader = null;
  try {
    shader = loadShader(vfs, shaderPath, ctx);
  } catch (err) {
    info.skipped.push(`${shaderPath}: ${err.message}`);
  }
  if (shader && shader.variables?.length) for (const line of describeVariables(shader.variables)) info.customization.add(`${shaderPath}: ${line}`);
  info.shaderNotes.add(`${shaderPath}: ${describeShader(shader)}`);
  const rendered = slots?.find((s) => s.tag === 'MAIN') ?? slots?.[0];
  if (!rendered && !(shader && shaderNeedsBake(shader))) return textureFor(vfs, shaderPath);
  let image = rendered ? rendered.image : null;
  if (shader && shader.effect) {
    const s = { ...shader, textures: new Map(shader.textures) };
    for (const slot of slots ?? []) s.textures.set(slot.tag, slot.image);
    if (!rendered || shaderNeedsBake(s, rendered.tag)) image = bakeShader(s, rendered ? rendered.tag : 'MAIN') ?? image;
  }
  if (!image) return textureFor(vfs, shaderPath);
  const pass = shader?.effect?.passes[0];
  const alphaMode = pass?.alphaTest ? 'MASK' : pass?.alphaBlend ? 'BLEND' : 'OPAQUE';
  let hasAlpha = image.hasAlpha ?? false;
  if (image.hasAlpha === undefined) for (let i = 3; i < image.rgba.length; i += 4) if (image.rgba[i] !== 255) { hasAlpha = true; break; }
  return { path: `${shaderPath}#${rendered ? basename(rendered.file) : 'baked'}`, png: encodePng(image.width, image.height, image.rgba), hasAlpha, alphaMode };
}

function convertSat(vfs, path, outFile, { animations = 'all', maxAnimations = 80, variables = new Map(), wear = [] } = {}) {
  let satPath = path.replace(/\\/g, '/');
  if (/\.iff$/i.test(satPath)) {
    const cache = new Map();
    const a = resolveTemplateString(vfs, satPath, ['appearanceFilename'], cache);
    if (!a) throw new Error(`${satPath}: no appearanceFilename in its template chain`);
    satPath = a.replace(/\\/g, '/').replace(/^\//, '');
  }
  const sat = parseSat(readIff(vfs, satPath));
  if (!sat.skeletons.length) throw new Error(`${satPath}: no skeleton`);
  const skeletonFile = sat.skeletons[0].file;
  const loadSkeleton = (file) => parseSkeleton(readIff(vfs, file), (f) => (vfs.has(f) ? readIff(vfs, f) : null));
  const info = { sat: satPath, skeleton: skeletonFile, joints: 0, meshes: [], animations: [], missing: [], unknownTransforms: 0, skipped: [], textureRenderers: [], customization: new Set(), attached: [], shaderNotes: new Set() };
  // Extra skeletons (the face rig) hang from a joint of the first.
  const extras = [];
  for (const k of sat.skeletons.slice(1)) {
    if (!vfs.has(k.file)) {
      info.missing.push(k.file);
      continue;
    }
    try {
      extras.push({ skeleton: loadSkeleton(k.file), attachTo: k.attachTo, file: k.file });
    } catch (err) {
      info.skipped.push(`${k.file}: ${err.message}`);
    }
  }
  const skeleton = mergeSkeletons(loadSkeleton(skeletonFile), extras);
  info.joints = skeleton.joints.length;
  info.attached = skeleton.attached.map((a, i) => `${extras[i].file} (${a.joints} joints) at ${a.attachTo}`);
  const meshes = [];
  const textures = new Map();
  const ctx = renderContext(variables);
  // Mesh generators of the body and of everything worn over it, composed the way the game does:
  // outer layers hide the zones of inner ones (a shirt hides the torso skin beneath it).
  const loaded = [];
  const sources = [{ sat, label: satPath, body: true }];
  for (const item of wear) {
    try {
      let file = item.replace(/\\/g, '/').replace(/^\//, '');
      if (/\.iff$/i.test(file)) {
        const a = resolveTemplateString(vfs, file, ['appearanceFilename'], new Map());
        if (!a) throw new Error('no appearanceFilename in its template chain');
        file = a.replace(/\\/g, '/').replace(/^\//, '');
      }
      if (!vfs.has(file)) throw new Error('not in archives');
      const worn = parseSat(readIff(vfs, file));
      const skeletons = worn.skeletons.map((k) => k.file.toLowerCase());
      if (!skeletons.includes(skeletonFile.toLowerCase())) throw new Error(`built for skeleton ${worn.skeletons.map((k) => k.file).join(', ') || 'none'}, not ${skeletonFile}`);
      sources.push({ sat: worn, label: file, body: false });
    } catch (err) {
      info.skipped.push(`wearable ${item}: ${err.message}`);
    }
  }
  for (const source of sources) {
    for (const name of source.sat.meshes) {
      let file = name;
      if (/\.lmg$/i.test(file)) {
        if (!vfs.has(file)) {
          info.missing.push(file);
          continue;
        }
        const lods = parseLmg(readIff(vfs, file));
        file = lods.find((l) => vfs.has(l)) ?? lods[0];
      }
      if (!file || !vfs.has(file)) {
        info.missing.push(file ?? name);
        continue;
      }
      try {
        loaded.push({ mgn: parseMgn(readIff(vfs, file)), file, body: source.body });
      } catch (err) {
        info.skipped.push(`${file}: ${err.message}`);
      }
    }
  }
  for (const { mgn, file, body, hiddenTriangles } of composeMeshes(loaded)) {
    const { groups, unknownTransforms, unknownNames } = skinnedPrimitives(mgn, skeleton);
    info.unknownTransforms += unknownTransforms;
    for (const n of unknownNames) (info.unknownJoints ??= new Set()).add(n);
    if (body) {
      for (let i = 0; i < mgn.positions.length; i += 3) {
        const b = (info.bounds ??= { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
        const p = [-mgn.positions[i], mgn.positions[i + 1], mgn.positions[i + 2]];
        for (let k = 0; k < 3; k++) {
          b.min[k] = Math.min(b.min[k], p[k]);
          b.max[k] = Math.max(b.max[k], p[k]);
        }
      }
    }
    // Run the mesh's texture renderers (skin, hair, eyes) and hand their output to the shaders they fill.
    const meshName = basename(file).replace(/\.[^.]+$/, '');
    const slotsByShader = new Map();
    for (const trt of mgn.textureRenderers) {
      if (!vfs.has(trt.file)) {
        info.missing.push(trt.file);
        continue;
      }
      try {
        const bp = parseBlueprint(readIff(vfs, trt.file));
        const image = renderBlueprint(vfs, bp, ctx);
        info.textureRenderers.push(`${trt.file}: ${bp.width}x${bp.height} for ${trt.slots.map((sl) => `${mgn.shaders[sl.shaderIndex]?.shader ?? sl.shaderIndex}:${sl.tag}`).join(', ')}${image.missing.length ? `; missing textures ${image.missing.join(', ')}` : ''}${image.unsupported.length ? `; effects without fixed-function passes ${image.unsupported.join(', ')}` : ''}`);
        for (const line of describeVariables(bp.variables)) info.customization.add(`${trt.file}: ${line}`);
        for (const sl of trt.slots) (slotsByShader.get(sl.shaderIndex) ?? slotsByShader.set(sl.shaderIndex, []).get(sl.shaderIndex)).push({ tag: sl.tag, image, file: trt.file });
      } catch (err) {
        info.skipped.push(`${trt.file}: ${err.message}`);
      }
    }
    const kept = [];
    groups.forEach((g, i) => {
      if (!g.primitives[0].indices.length) return; // everything this shader drew is under clothing
      const slots = slotsByShader.get(i);
      const t = skinnedTexture(vfs, g.shader, slots, ctx, info);
      if (slots) g.shader = `${g.shader}@${meshName}`; // its own material: the rendered texture is this mesh's
      if (t) textures.set(g.shader, t);
      kept.push(g);
    });
    if (kept.length) meshes.push({ name: meshName, groups: kept });
    info.meshes.push({ file, shaders: kept.length, triangles: kept.reduce((a, g) => a + g.primitives[0].indices.length / 3, 0), hidden: hiddenTriangles, layer: mgn.occlusionLayer, occludes: mgn.occludes });
  }
  const clips = [];
  const latFile = sat.animationTables.get(skeletonFile.toLowerCase()) ?? [...sat.animationTables.values()][0];
  if (latFile && vfs.has(latFile)) {
    const lat = parseLat(readIff(vfs, latFile));
    info.animationTable = latFile;
    const wanted = animations === 'all' || animations === 'list' ? null : animations.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const parsed = new Map();
    const loadAnimation = (e) => {
      const key = e.kind === 'file' ? e.file : e.form;
      if (parsed.has(key)) return parsed.get(key);
      let a = null;
      if (e.kind === 'inline') a = parseAnimation(e.form);
      else if (e.kind === 'file' && vfs.has(e.file)) a = parseAnimation(readIff(vfs, e.file));
      parsed.set(key, a);
      return a;
    };
    const named = nameLocomotion(lat.entries, loadAnimation);
    info.available = named.map((e) => `${e.clip}${e.clip !== e.name ? ` (${e.name}${e.speed ? ` ${e.speed.toFixed(1)} m/s` : ''})` : ''}${e.kind === 'file' || e.kind === 'inline' ? '' : ` [${e.kind}]`}${e.variable ? ` (${e.variable}${e.isDefault ? ', default' : ''})` : ''}${e.timeScale && e.timeScale !== 1 ? ` x${e.timeScale.toFixed(2)}` : ''}`);
    if (animations === 'list') return info;
    const used = new Set();
    for (const e of named) {
      if (wanted && !wanted.some((w) => (w.startsWith('=') ? e.clip.toLowerCase() === w.slice(1) || e.name.toLowerCase() === w.slice(1) : e.clip.toLowerCase().includes(w) || e.name.toLowerCase().includes(w)))) continue;
      if (used.has(e.clip)) continue;
      if (clips.length >= maxAnimations) break;
      try {
        if (e.kind !== 'inline' && e.kind !== 'file') {
          info.skipped.push(`${e.name}: ${e.kind} animation templates are not converted`);
          continue;
        }
        if (e.kind === 'file' && !vfs.has(e.file)) {
          info.missing.push(e.file);
          continue;
        }
        const animation = { ...loadAnimation(e) };
        if (e.timeScale && e.timeScale !== 1 && e.timeScale > 0) animation.fps *= e.timeScale;
        used.add(e.clip);
        clips.push({ name: e.clip, animation });
        info.animations.push(e.clip);
        (info.clipSpeeds ??= {})[e.clip] = Number(((animation.locomotionSpeed ?? 0) * (e.timeScale || 1)).toFixed(3));
        // How much of the skeleton this clip actually moves, for spotting name mismatches.
        const jointNames = new Set(skeleton.joints.map((j) => j.name.toLowerCase()));
        const matched = animation.transforms.filter((t) => jointNames.has(t.name.toLowerCase())).length;
        const first = poseAtFrame(skeleton, animation, 0);
        const mid = poseAtFrame(skeleton, animation, Math.floor(animation.frameCount / 2));
        let moving = 0;
        first.forEach((a, i) => {
          const b = mid[i];
          const dq = Math.abs(a.rotation[0] - b.rotation[0]) + Math.abs(a.rotation[1] - b.rotation[1]) + Math.abs(a.rotation[2] - b.rotation[2]) + Math.abs(a.rotation[3] - b.rotation[3]);
          const dt = Math.abs(a.translation[0] - b.translation[0]) + Math.abs(a.translation[1] - b.translation[1]) + Math.abs(a.translation[2] - b.translation[2]);
          if (dq > 1e-3 || dt > 1e-3) moving++;
        });
        (info.clipStats ??= []).push(`${e.clip}: ${animation.frameCount} frames at ${animation.fps.toFixed(1)} fps, ${animation.transforms.length} transforms (${matched} match skeleton joints, ${animation.rotationChannels.length} rotation channels), ${moving} joints move by mid-clip${matched === 0 && animation.transforms.length ? `; e.g. animation "${animation.transforms[0].name}" vs skeleton "${skeleton.joints[0].name}", "${skeleton.joints[1]?.name}"` : ''}`);
      } catch (err) {
        info.skipped.push(`${e.name}: ${err.message}`);
      }
    }
  } else if (latFile) info.missing.push(latFile);
  const skin = skinData(skeleton, clips, { flipX: true });
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, buildGlb(meshes, { flipX: true, textures, skin, animations: skin.clips }));
  return info;
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
  const { parseTerrainTemplate, parseLayerFile, TerrainSampler, bitmapFiles, attachBitmap } = await import('../../src/swg/terrain/trn.ts');
  const trnPath = join(dir, 'terrain.trn');
  if (!existsSync(trnPath)) throw new Error(`${trnPath} missing; run the snapshot (or terrain) command first`);
  const t0 = Date.now();
  const template = parseTerrainTemplate(new Uint8Array(readFileSync(trnPath)));
  const gen = template.generator;
  console.log(`terrain ${template.name}: map ${template.mapWidthInMeters} m, chunk ${template.chunkWidthInMeters} m, ${template.numberOfTilesPerChunk} tiles/chunk (${template.tileWidthInMeters} m tiles), version ${template.version}, water ${template.useGlobalWaterTable ? template.globalWaterTableHeight : 'none'}, loaded in ${Date.now() - t0} ms`);
  console.log(`  layer items: ${Object.entries(gen.summary()).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  fractal families: ${gen.fractalGroup.families.size}, shader families: ${gen.shaderGroup.families.size}`);
  for (const b of bitmapFiles(template)) {
    const file = join(dir, b.file);
    const ok = existsSync(file) && attachBitmap(template, b.familyId, new Uint8Array(readFileSync(file)));
    console.log(`  bitmap family ${b.familyId} ${b.name}: ${ok ? `loaded from ${b.file}` : `${b.file} missing (re-run snapshot or terrain to convert it); filter passes everywhere`}`);
  }
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
  console.log(`  ${rows.length} objects sampled in ${ms} ms (${sampler.blockWidth} m blocks of ${sampler.numberOfPoles}x${sampler.numberOfPoles} poles)`);
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

/** A planet's objects from both placement sources: the world snapshot and the buildout areas. */
function loadPlanetObjects(vfs, planet) {
  const wsPath = `snapshot/${planet}.ws`;
  if (!vfs.has(wsPath)) throw new Error(`no ${wsPath} in archives`);
  const snap = parseSnapshot(parseIff(vfs.read(wsPath)));
  const snapshotCount = snap.nodes.length;
  const buildout = loadBuildouts(vfs, planet);
  mergeBuildouts(snap, buildout);
  const entries = flattenWithWorldTransforms(snap);
  return { snap, entries, snapshotCount, buildout: buildout.stats };
}

/** The creature each planet spawns (src/data/planets.ts) and the mobile template that draws it. */
const CREATURES = {
  bantha: 'object/mobile/shared_bantha.iff',
  kaadu: 'object/mobile/shared_kaadu.iff',
  durni: 'object/mobile/shared_durni.iff',
  bol: 'object/mobile/shared_bol.iff',
  kimogila: 'object/mobile/shared_kimogila.iff',
  boar_wolf: 'object/mobile/shared_boar_wolf.iff',
  rancor: 'object/mobile/shared_rancor.iff',
  mawgax: 'object/mobile/shared_mawgax.iff',
  kahmurra: 'object/mobile/shared_kahmurra.iff',
  torton: 'object/mobile/shared_torton.iff',
};
/** Logical animations (substrings) the game drives creatures with. */
const CREATURE_CLIPS = 'idle,walk,run,cbt_stand_combat_attack_light,rea_stand_get_hit_light,trn_stand_to_incapacitated,loop_incapacitated';

/** The player's clips: locomotion and posture by exact name (=), reactions by substring. */
const PLAYER_CLIPS = '=idle,=walk,=run,=idle_combat,=walk_combat,=run_combat,=jump,=loop_sitting_chair:0,=loop_sitting_ground,=unarmed_standing_ready_punch,=sword_1h_standing_ready_hrz_slash_middle_r,=rea_get_hit_medium_mid_center,=trn_combat_standing_hit_to_incapacitated_face_up,=loop_incapacitated_face_up,=cbt_stand_combat_attack_light,=rea_stand_get_hit_light,=trn_stand_to_incapacitated,=loop_incapacitated';
const PLAYER_TEMPLATE = 'object/creature/player/shared_human_male.iff';

/** Planet ids the game can load a pack for (see src/data/planets.ts). */
const GAME_PLANETS = ['tatooine', 'naboo', 'corellia', 'dantooine', 'lok', 'endor', 'dathomir', 'yavin4', 'talus', 'rori'];

/** Names of the world snapshots the archives hold (snapshot/<name>.ws). */
function snapshotPlanets(vfs) {
  return vfs
    .list('snapshot/')
    .filter((n) => n.endsWith('.ws'))
    .map((n) => basename(n, '.ws'))
    .sort();
}

/**
 * Where to centre a planet when no centre is given: its starport (or shuttleport) if it has
 * one, else the middle of the 256 m square holding the most objects, which is a city.
 */
function autoCenter(snap, entries) {
  for (const want of ['starport', 'shuttleport']) {
    const hit = entries.find((e) => e.world && e.parentId === 0 && snap.templates[e.node.templateIndex].includes(want));
    if (hit) return { x: hit.world.pos[0], z: hit.world.pos[2], why: `${want} ${snap.templates[hit.node.templateIndex].split('/').pop()}` };
  }
  const cells = new Map();
  for (const e of entries) {
    if (!e.world || e.parentId !== 0) continue;
    const key = `${Math.floor(e.world.pos[0] / 256)},${Math.floor(e.world.pos[2] / 256)}`;
    const c = cells.get(key) ?? { n: 0, x: 0, z: 0 };
    c.n++;
    c.x += e.world.pos[0];
    c.z += e.world.pos[2];
    cells.set(key, c);
  }
  let best = null;
  for (const c of cells.values()) if (!best || c.n > best.n) best = c;
  if (!best) return { x: 0, z: 0, why: 'empty snapshot' };
  return { x: best.x / best.n, z: best.z / best.n, why: `busiest square, ${best.n} objects` };
}

/**
 * Points of interest for the in-game map, in SWG coordinates: the planet's named places
 * (regions/regions.json: cities, landmarks and areas, with names from the client's string
 * tables), the client's own region table when it has one, and every starport and shuttleport
 * in the snapshot named after the city it stands in.
 */
function pointsOfInterest(vfs, planet, snap, entries, { regions: wantRegions = true } = {}) {
  const strings = new Map();
  const places = [];
  const seen = new Set();
  const add = (p) => {
    const k = p.name.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    places.push(p);
  };
  for (const r of REGIONS[planet] ?? []) {
    const name = (r.stringId && localize(vfs, r.stringId, strings)) || r.name;
    add({ name, x: r.x, z: r.z, r: r.r, kind: r.kind });
  }
  const table = `datatables/clientregion/${planet}.iff`;
  if (wantRegions && vfs.has(table)) {
    const dt = parseDatatable(parseIff(vfs.read(table)));
    for (const row of dt.rows) {
      const [id, x, z, r] = dt.columns.map((c) => row[c]);
      if (typeof id !== 'string' || typeof x !== 'number') continue;
      add({ name: localize(vfs, id, strings) ?? title(id.split(':').pop()), x, z, r, kind: r > 1000 ? 'area' : 'landmark' });
    }
  }
  const cities = places.filter((p) => p.kind === 'city');
  const cityAt = (x, z) => {
    let best = null;
    for (const c of cities) if (Math.hypot(c.x - x, c.z - z) <= Math.max(c.r, 300) && (!best || c.r < best.r)) best = c;
    return best;
  };
  for (const e of entries) {
    if (!e.world || e.parentId !== 0) continue;
    const template = snap.templates[e.node.templateIndex];
    const kind = template.includes('starport') ? 'starport' : template.includes('shuttleport') ? 'shuttleport' : null;
    if (!kind) continue;
    const [x, , z] = e.world.pos;
    const city = cityAt(x, z);
    const label = kind === 'starport' ? 'Starport' : 'Shuttleport';
    add({ name: city ? `${city.name} ${label}` : `${label} (${x.toFixed(0)}, ${z.toFixed(0)})`, x, z, r: 0, kind });
  }
  const order = { city: 0, starport: 1, shuttleport: 2, landmark: 3, area: 4 };
  places.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || a.name.localeCompare(b.name));
  return places;
}

/** "jabbas_palace" -> "Jabbas Palace" */
function title(key) {
  return key.split('_').filter(Boolean).map((w, i) => (i > 0 && /^(of|the|in|on|at|and|with)$/.test(w) ? w : w[0].toUpperCase() + w.slice(1))).join(' ');
}

/** Write <out>/pois.json for a planet; a broken region table costs the regions, never the snapshot. */
function writePois(vfs, planet, snap, entries, cx, cz, outDir) {
  let pois = [];
  try {
    pois = pointsOfInterest(vfs, planet, snap, entries);
  } catch (err) {
    console.warn(`points of interest: ${err.message}`);
    try {
      pois = pointsOfInterest(vfs, planet, snap, entries, { regions: false });
    } catch {
      pois = [];
    }
  }
  writeFileSync(join(outDir, 'pois.json'), JSON.stringify({ planet, center: { x: cx, z: cz }, pois }));
  console.log(`points of interest: ${pois.length} (${pois.filter((p) => p.kind === 'region').length} named regions, ${pois.filter((p) => p.kind !== 'region').length} travel points) -> ${join(outDir, 'pois.json')}`);
}

/** Convert one planet's snapshot (see the snapshot command). */
async function snapshotPlanet(vfs, planet, outDir) {
    const radius = options.radius === 'all' ? Infinity : Number(options.radius ?? 400);
    const max = Number(options.max ?? Infinity);
    const wsPath = `snapshot/${planet}.ws`;
    const { snap, entries, snapshotCount, buildout } = loadPlanetObjects(vfs, planet);
    console.error(`${wsPath}: ${snapshotCount} top-level objects, ${entries.length} including contained and buildouts, ${snap.templates.length} templates`);
    console.error(`buildouts: ${buildout.objects} objects in ${buildout.areas} areas${buildout.eventAreas ? `, ${buildout.eventAreas} event-only areas skipped` : ''}${buildout.unknownTemplates ? `, ${buildout.unknownTemplates} rows with unknown templates` : ''}${buildout.missingTables ? `, ${buildout.missingTables} area tables missing` : ''}`);
    let cx;
    let cz;
    if (options.center && options.center !== 'auto') {
      [cx, cz] = options.center.split(',').map(Number);
    } else {
      const c = autoCenter(snap, entries);
      cx = Math.round(c.x);
      cz = Math.round(c.z);
      console.error(`centre ${cx},${cz}: ${c.why}`);
    }
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
          models.set(id, { id, source: r.source ?? r.appearance, file: `${id}.glb`, bounds, triangles: conv.tris, textured: conv.textured, shaders: conv.shaders.length, parts: conv.partCount, ...(conv.cells ? { cells: conv.cells, portals: conv.portals ?? [] } : {}) });
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
    const terrainFile = await copyTerrain(vfs, planet, outDir);
    const layout = { planet, center: { x: cx, z: cz }, radius: Number.isFinite(radius) ? radius : null, terrain: terrainFile, objects, skipped };
    writeFileSync(join(outDir, 'layout.json'), JSON.stringify(layout));
    const manifestPath = join(outDir, 'manifest.json');
    const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { planet, categories: {} };
    manifest.categories.layout = [...models.values()].filter((m) => m && !m.failed);
    const flora = lastTemplate ? convertFlora(vfs, lastTemplate, outDir, manifest) : { models: 0, missing: 0, families: 0 };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`flora: ${flora.models} models for ${flora.families} families${flora.missing ? `, ${flora.missing} appearances missing` : ''}${flora.particles ? `, ${flora.particles} particle effects skipped` : ''}`);
    writePois(vfs, planet, snap, entries, cx, cz, outDir);
    console.log(`layout: ${objects.length} objects, ${manifest.categories.layout.length} models -> ${join(outDir, 'layout.json')}`);
    const withCells = manifest.categories.layout.filter((m) => m.cells);
    console.log(`buildings: ${withCells.length} models with cells, ${withCells.filter((m) => m.portals && m.portals.length).length} with portals`);
    console.log(`terrain: ${terrainFile ?? 'not found'}, ${objects.filter((o) => o.layer).length} objects with terrain modification layers (${new Set(objects.map((o) => o.layer).filter(Boolean)).size} files)`);
    for (const [reason, count] of Object.entries(skipped).sort((a, b) => b[1] - a[1])) {
      console.log(`  skipped ${count}: ${reason}`);
      for (const ex of [...(examples[reason] ?? [])].slice(0, 3)) console.log(`      e.g. ${ex}`);
    }
    printEffectSummary();
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
  case 'planets': {
    if (!pos[1]) usage();
    const vfs = mount(pos[1]);
    for (const planet of snapshotPlanets(vfs)) {
      const { snap, entries, buildout } = loadPlanetObjects(vfs, planet);
      const centre = autoCenter(snap, entries);
      const known = GAME_PLANETS.includes(planet);
      console.log(`${planet.padEnd(12)} ${String(snap.nodes.length).padStart(6)} objects (${buildout.objects} from buildouts), terrain ${vfs.has(`terrain/${planet}.trn`) ? 'yes' : 'no '}, centre ${centre.x.toFixed(0)},${centre.z.toFixed(0)} (${centre.why})${known ? '' : '  [not a planet in the game]'}`);
    }
    break;
  }

  case 'flora': {
    // Only the flora models, for packs converted already: <swg-dir> <planet>|all <out-dir>
    if (!pos[3]) usage();
    const vfs = mount(pos[1]);
    const { parseTerrainTemplate } = await import('../../src/swg/terrain/trn.ts');
    const planets = pos[2] === 'all' ? snapshotPlanets(vfs).filter((p) => GAME_PLANETS.includes(p)) : [pos[2]];
    for (const planet of planets) {
      const outDir = pos[2] === 'all' ? join(pos[3], planet) : pos[3];
      const trnPath = `terrain/${planet}.trn`;
      if (!vfs.has(trnPath)) {
        console.warn(`no ${trnPath} in archives`);
        continue;
      }
      const manifestPath = join(outDir, 'manifest.json');
      const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { planet, categories: {} };
      mkdirSync(outDir, { recursive: true });
      console.log(`=== ${planet} ===`);
      const flora = convertFlora(vfs, parseTerrainTemplate(new Uint8Array(vfs.read(trnPath))), outDir, manifest);
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      console.log(`flora: ${flora.models} models for ${flora.families} families${flora.missing ? `, ${flora.missing} appearances missing` : ''}${flora.particles ? `, ${flora.particles} particle effects skipped` : ''}`);
    }
    printEffectSummary();
    break;
  }

  case 'creatures': {
    // <swg-dir> <out-dir>: the creature of every planet the game spawns, as skinned GLBs under <out-dir>/creatures/
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const outDir = join(pos[2], 'creatures');
    mkdirSync(outDir, { recursive: true });
    const list = [];
    for (const [id, template] of Object.entries(CREATURES)) {
      const out = join(outDir, `${id}.glb`);
      try {
        const info = convertSat(vfs, template, out, { animations: CREATURE_CLIPS });
        list.push({ id, file: `creatures/${id}.glb`, template, clips: info.animations, clipSpeeds: info.clipSpeeds ?? {}, bounds: info.bounds });
        console.log(`${id}: ${info.joints} joints, ${info.meshes.reduce((a, m) => a + m.triangles, 0)} tris, clips ${info.animations.join(', ')}${info.missing.length ? `, missing ${info.missing.length}` : ''}`);
      } catch (err) {
        console.warn(`${id}: ${err.message}`);
      }
    }
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ creatures: list }, null, 2));
    console.log(`creatures: ${list.length} -> ${join(outDir, 'manifest.json')}`);
    printEffectSummary();
    break;
  }

  case 'sat': {
    // <swg-dir> <appearance/x.sat | object/mobile/shared_x.iff> <out.glb> [--anim=all|idle,walk,run]
    if (!pos[3]) usage();
    const vfs = mount(pos[1]);
    const info = convertSat(vfs, pos[2], pos[3], { animations: options.anim ?? 'all', variables: customizationValues(options.var), wear: (options.wear ?? '').split(',').map((w) => w.trim()).filter(Boolean) });
    console.log(`${info.sat}: skeleton ${info.skeleton} (${info.joints} joints${info.attached.length ? `, with ${info.attached.join('; ')}` : ''})`);
    for (const m of info.meshes) console.log(`  mesh ${m.file}: ${m.triangles} tris, ${m.shaders} shaders, layer ${m.layer}${m.hidden ? `, ${m.hidden} tris under clothing` : ''}${m.occludes.length ? `, hides ${m.occludes.join(' ')}` : ''}`);
    for (const t of info.textureRenderers) console.log(`  texture renderer ${t}`);
    if (info.customization.size) console.log(`  customization (set with --var=name=value,...):\n    ${[...info.customization].join('\n    ')}`);
    console.log(`  animations (${info.animations.length})${info.animationTable ? ` from ${info.animationTable}` : ''}: ${info.animations.join(', ') || 'none'}`);
    if (info.available && (!info.animations.length || options.anim === 'list')) console.log(`  available (${info.available.length}): ${info.available.join(', ')}`);
    if (info.unknownTransforms) console.log(`  ${info.unknownTransforms} vertex weights named joints the skeleton lacks: ${[...info.unknownJoints ?? []].join(', ')}`);
    for (const c of info.clipStats ?? []) console.log(`  clip ${c}`);
    for (const m of info.missing) console.log(`  missing: ${m}`);
    for (const m of info.skipped) console.log(`  skipped: ${m}`);
    console.log(`-> ${pos[3]}`);
    printEffectSummary();
    break;
  }

  case 'player': {
    // <swg-dir> <out-dir> [--template=object/creature/player/shared_human_male.iff] [--wear=...] [--var=...] [--anim=...]
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const template = (options.template ?? PLAYER_TEMPLATE).replace(/\\/g, '/');
    const id = basename(template).replace(/^shared_/, '').replace(/\.[^.]+$/, '');
    const outDir = join(pos[2], 'player');
    const wear = (options.wear ?? '').split(',').map((w) => w.trim()).filter(Boolean);
    const info = convertSat(vfs, template, join(outDir, `${id}.glb`), { animations: options.anim ?? PLAYER_CLIPS, variables: customizationValues(options.var), wear, maxAnimations: 40 });
    console.log(`${info.sat}: skeleton ${info.skeleton} (${info.joints} joints${info.attached.length ? `, with ${info.attached.join('; ')}` : ''})`);
    for (const m of info.meshes) console.log(`  mesh ${m.file}: ${m.triangles} tris, ${m.shaders} shaders, layer ${m.layer}${m.hidden ? `, ${m.hidden} tris under clothing` : ''}`);
    for (const t of info.textureRenderers) console.log(`  texture renderer ${t}`);
    if (info.customization.size) console.log(`  customization (set with --var=name=value,...):\n    ${[...info.customization].join('\n    ')}`);
    if (info.shaderNotes.size) console.log(`  shaders:\n    ${[...info.shaderNotes].join('\n    ')}`);
    console.log(`  animations (${info.animations.length}): ${info.animations.join(', ') || 'none'}`);
    if (!info.animations.length && info.available) console.log(`  available (${info.available.length}): ${info.available.join(', ')}`);
    for (const c of info.clipStats ?? []) console.log(`  clip ${c}`);
    if (info.unknownTransforms) console.log(`  ${info.unknownTransforms} vertex weights named joints the skeleton lacks: ${[...info.unknownJoints ?? []].join(', ')}`);
    for (const m of info.missing) console.log(`  missing: ${m}`);
    for (const m of info.skipped) console.log(`  skipped: ${m}`);
    const manifestFile = join(outDir, 'manifest.json');
    const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : { players: [] };
    const entry = { id, file: `player/${id}.glb`, template, wear, variables: Object.fromEntries(customizationValues(options.var)), clips: info.animations, clipSpeeds: info.clipSpeeds ?? {}, bounds: info.bounds, scale: 1 };
    manifest.players = [entry, ...(manifest.players ?? []).filter((p) => p.id !== id)];
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
    console.log(`-> ${join(outDir, `${id}.glb`)} and ${manifestFile}; the game uses the first entry`);
    printEffectSummary();
    break;
  }

  case 'trt': {
    // <swg-dir> <x.trt> <out.png> [--var=name=value,...]: bake a texture renderer blueprint with default (or given) customization values
    if (!pos[3]) usage();
    const vfs = mount(pos[1]);
    const file = pos[2].replace(/\\/g, '/');
    if (!vfs.has(file)) throw new Error(`${file}: not in archives`);
    const bp = parseBlueprint(readIff(vfs, file));
    const ctx = renderContext(customizationValues(options.var));
    console.log(`${file}: ${bp.width}x${bp.height}, ${bp.shaders.length} shaders, ${bp.textures.length} textures, ${bp.commands.length} commands, ${bp.prepare.length} prepare operations`);
    let prepared = [];
    try {
      prepared = preparedShaders(vfs, bp, ctx);
    } catch (err) {
      console.log(`  shaders unreadable: ${err.message}`);
    }
    prepared.forEach((sh, i) => console.log(`  shader ${i} ${bp.shaders[i].file ?? '(inline)'}: ${describeShader(sh)}`));
    for (const line of describeVariables(bp.variables)) console.log(`  variable ${line}`);
    bp.prepare.forEach((op) => console.log(`  prepare: ${op.kind} shader ${op.shader} ${op.tag}${op.palette ? ` from ${op.palette} via ${bp.variables[op.variable]?.name}` : ''}${op.kind === 'texture' ? ` = ${bp.textures[op.texture]}` : ''}${op.kind === 'texture1d' ? ` = ${bp.textures[op.base]}.. (${op.count}) via ${bp.variables[op.variable]?.name}` : ''}`));
    bp.commands.forEach((c) => console.log(`  draw: ${c.kind === 'clear' ? `clear ${c.clearColor ? (c.color >>> 0).toString(16) : '(colour kept)'}` : `shader ${c.shader}, ${c.primitives.map((pr) => (pr.kind === 'fan' ? `fan vb${pr.vb}` : `${pr.triangles} tris vb${pr.vb}`)).join(' + ')}`}`));
    const image = renderBlueprint(vfs, bp, ctx);
    for (const m of image.missing) console.log(`  missing texture: ${m}`);
    for (const u of image.unsupported) console.log(`  not drawn (no fixed-function effect): ${u}`);
    mkdirSync(dirname(pos[3]), { recursive: true });
    writeFileSync(pos[3], encodePng(image.width, image.height, image.rgba));
    console.log(`-> ${pos[3]}`);
    break;
  }

  case 'pois': {
    // Only the points of interest, for packs converted already: <swg-dir> <planet>|all <out-dir>
    if (!pos[3]) usage();
    const vfs = mount(pos[1]);
    const planets = pos[2] === 'all' ? snapshotPlanets(vfs).filter((p) => GAME_PLANETS.includes(p)) : [pos[2]];
    for (const planet of planets) {
      const outDir = pos[2] === 'all' ? join(pos[3], planet) : pos[3];
      if (!vfs.has(`snapshot/${planet}.ws`)) {
        console.warn(`no snapshot/${planet}.ws in archives`);
        continue;
      }
      const { snap, entries } = loadPlanetObjects(vfs, planet);
      const layoutPath = join(outDir, 'layout.json');
      let cx;
      let cz;
      if (options.center && options.center !== 'auto') [cx, cz] = options.center.split(',').map(Number);
      else if (existsSync(layoutPath)) ({ x: cx, z: cz } = JSON.parse(readFileSync(layoutPath, 'utf8')).center);
      else {
        const c = autoCenter(snap, entries);
        cx = Math.round(c.x);
        cz = Math.round(c.z);
      }
      mkdirSync(outDir, { recursive: true });
      console.log(`=== ${planet} (centre ${cx},${cz}) ===`);
      writePois(vfs, planet, snap, entries, cx, cz, outDir);
    }
    break;
  }

  case 'snapshot': {
    if (!pos[3]) usage();
    const vfs = mount(pos[1]);
    if (pos[2] === 'all') {
      const planets = snapshotPlanets(vfs).filter((p) => GAME_PLANETS.includes(p));
      console.log(`converting ${planets.length} planets: ${planets.join(', ')}`);
      for (const planet of planets) {
        console.log(`\n=== ${planet} ===`);
        await snapshotPlanet(vfs, planet, join(pos[3], planet));
      }
    } else {
      await snapshotPlanet(vfs, pos[2], pos[3]);
    }
    break;
  }

  case 'pob': {
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const root = parseIff(vfs.read(pos[2]));
    console.log(dump(root).slice(0, 60).join('\n'));
    const { parsePob } = await import('./pob.mjs');
    const pob = parsePob(root);
    console.log(`${pob.cells.length} cells, ${pob.portals.length} portal polygons`);
    pob.portals.forEach(({ verts, indices }, i) => console.log(`  portal ${i}: ${verts.length} verts, ${indices.length / 3} triangles, centre ${verts.reduce((a, v) => a.map((c, k) => c + v[k] / verts.length), [0, 0, 0]).map((v) => v.toFixed(2)).join(',')}`));
    pob.cells.forEach((c, i) => console.log(`  cell ${i} "${c.name}" ${c.appearance} floor ${c.floor || '-'}: ${c.portals.map((p) => `#${p.geometry}->${p.target}${p.passable ? '' : ' closed'}${p.disabled ? ' disabled' : ''}`).join(' ') || 'no portals'}`));
    break;
  }

  case 'why': {
    // Why a snapshot object does or does not make it into a pack: <swg-dir> <planet> <pattern>
    if (!pos[3]) usage();
    const vfs = mount(pos[1]);
    const planet = pos[2];
    const pattern = new RegExp(pos[3], 'i');
    const { snap, entries, buildout } = loadPlanetObjects(vfs, planet);
    console.log(`${entries.length} objects (${buildout.objects} from ${buildout.areas} buildout areas)`);
    const cache = new Map();
    const hits = new Map();
    for (const e of entries) {
      const template = snap.templates[e.node.templateIndex];
      if (!pattern.test(template)) continue;
      const h = hits.get(template) ?? { count: 0, contained: 0, buildout: 0, radius: e.node.radius, example: e };
      h.count++;
      if (e.node.buildout) h.buildout++;
      if (e.parentId !== 0) h.contained++;
      hits.set(template, h);
    }
    if (!hits.size) {
      console.log(`no objects on ${planet} match /${pos[3]}/i; templates containing "${pos[3].slice(0, 4)}":`);
      for (const t of snap.templates.filter((t) => t.toLowerCase().includes(pos[3].slice(0, 4).toLowerCase())).slice(0, 20)) console.log(`  ${t}`);
      break;
    }
    const tmpDir = join(pos[4] ?? '.', '.why');
    mkdirSync(tmpDir, { recursive: true });
    for (const [template, h] of hits) {
      const p = h.example.world?.pos ?? [0, 0, 0];
      console.log(`\n${template}`);
      console.log(`  ${h.count} placed (${h.buildout} by buildouts, ${h.contained} inside buildings), radius ${h.radius}, e.g. at ${p[0].toFixed(0)}, ${p[2].toFixed(0)}`);
      const r = resolveTemplateMesh(vfs, template, cache);
      if (r.skip) {
        console.log(`  SKIPPED: ${r.skip}`);
        continue;
      }
      const appearance = r.parts.length === 1 && !r.parts[0].transform ? r.parts[0].mesh : r.appearance;
      console.log(`  appearance: ${r.appearance ?? '-'}${r.source ? ` (via ${r.source})` : ''}, ${r.parts.length} part(s)`);
      const st = vfs.stat(appearance);
      console.log(`  ${appearance}: ${st ? `${st.size} bytes from ${basename(st.archive)}` : 'NOT IN ARCHIVES'}`);
      try {
        const conv = convertOne(vfs, appearance, join(tmpDir, `${familyOf(appearance)}.glb`));
        console.log(`  converts: ${conv.tris} tris, ${conv.textured}/${conv.shaders.length} textured${conv.partCount > 1 ? `, ${conv.partCount} parts` : ''}${conv.cells ? `, ${conv.cells.length} cells, ${conv.portals?.length ?? 0} portal polygons` : ''}`);
      } catch (err) {
        console.log(`  CONVERSION FAILED: ${err.message}`);
      }
    }
    break;
  }

  case 'stat': {
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const st = vfs.stat(pos[2]);
    console.log(st ? `${pos[2]}: ${st.size} bytes from ${st.archive}` : `${pos[2]}: not in archives`);
    break;
  }

  case 'terrain': {
    if (!pos[3]) usage();
    const vfs = mount(pos[1]);
    mkdirSync(pos[3], { recursive: true });
    const file = await copyTerrain(vfs, pos[2], pos[3]);
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
