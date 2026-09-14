#!/usr/bin/env node
// SWG asset converter. Reads a locally owned client install; never ships its output.
//
//   node tools/swg/cli.mjs verify <swg-dir>                       classify every archive against retail manifests
//   node tools/swg/cli.mjs headers <swg-dir>                      print the raw header of every archive (diagnostic)
//   node tools/swg/cli.mjs list <swg-dir> [filter]                list files across archives (search priority applied)
//   node tools/swg/cli.mjs extract <swg-dir> <path-in-archive> <out-file>
//   node tools/swg/cli.mjs dump <file.iff> | <swg-dir> <path-in-archive>   print an IFF tree
//   node tools/swg/cli.mjs weapons <swg-dir> <out-dir> [--limit=N]       every weapon the game can hold, with its class, under <out-dir>/weapons
//   node tools/swg/cli.mjs ships <swg-dir> <out-dir> [--limit=N]         every ship a player can fly, with its interior when it has one, under <out-dir>/ships
//   node tools/swg/cli.mjs species <swg-dir> <out-dir> [--only=human,twilek_female] [--var=...]   every playable species and gender as parts, with characters/index.json for the character creator
//   node tools/swg/cli.mjs ash <swg-dir> <appearance/x.sat | object/.../shared_x.iff> [--find=pistol]   the animation state hierarchy behind a skeletal appearance, with its strings
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
//   node tools/swg/cli.mjs player <swg-dir> <out-dir> [--template=object/creature/player/shared_human_male.iff] [--wear=...|none] [--var=...]   the player's character as <out-dir>/player/<id>.glb + manifest.json
//                                                               [--jka=<Jedi Academy GameData or base dir>] [--jka-anims=BOTH_A1_T__B_,...]  adds Jedi Academy's saber attacks, jumps and rolls, retargeted
//   node tools/swg/cli.mjs loading <swg-dir> <out-dir> [--match=ui_load] [--list]   the game's loading-screen pictures, one per planet, as <out-dir>/loading/<planet>.png
//   node tools/swg/cli.mjs wardrobe <swg-dir> <out-dir> [--gender=male|female] [--kind=wearables,hair] [--match=...] [--limit=N]   every wearable and hairstyle as parts
//   node tools/swg/cli.mjs parts <swg-dir> <out-dir> [--template=...] [--wear=...]   body, head and worn items as separate GLBs on one shared skeleton
//   node tools/swg/cli.mjs clips-save <model.glb> <out.clips> [--only=BOTH_]   lift a model's animations into a bundle that survives re-conversion
//   node tools/swg/cli.mjs clips-apply <model.glb> <in.clips> [--drop=BOTH_]   put a bundle's animations back onto a model, joints matched by name
//   node tools/swg/cli.mjs jka-clips <player.glb> <jka-dir> [--jka-anims=...]   re-import Jedi Academy's clips into a converted player GLB (no SWG archives needed)
//   node tools/swg/cli.mjs jka-extract <jka-dir> <out-dir>                 copy the humanoid skeleton and animation.cfg out of the pk3 archives
//   node tools/swg/cli.mjs gallery <swg-dir> <out-dir> [--jka=<dir>] [--only=houses,vehicles,weapons,anims] [--limit=N]
//                                                                  a flat development world under <out-dir>/gallery: every player house, vehicle and
//                                                                  weapon in rows, and every animation from both games on a grid of player models
//                                                                  (dressed in a shirt, trousers and shoes unless --wear says otherwise)
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
//   node tools/swg/cli.mjs terrain <swg-dir> <planet>|all <out-dir>  copy just the terrain template and ground textures into a pack
//                                                                  ("all": into every planet pack already under <out-dir>)
//   node tools/swg/cli.mjs sky <swg-dir> <planet>|all <out-dir>      the planet's sky (sun, moons, colour ramps, skybox, reflection maps) into a pack
//                                                                  (snapshot and terrain do this too)
//   node tools/swg/cli.mjs audit <swg-dir> <out-dir> [planet] [--limit=n]   every object the archives place on each converted planet against its pack:
//                                                                  what is missing, why (skipped kind, creature, older conversion), and where;
//                                                                  also written to <out-dir>/audit.txt
//   node tools/swg/cli.mjs extras <swg-dir>                       what the archives outside the retail manifests add or replace, by category
//                                                                  (a listing only; nothing from them is converted)
//   node tools/swg/cli.mjs status <out-dir>                        what the packs under <out-dir> hold and which commands would fill the gaps
//   node tools/swg/cli.mjs terrain-check <out-dir> [--limit=n] [--layers] [--at=x,z]
//                                                                  generate terrain at every snapshot object and compare with its height;
//                                                                  --layers lists every layer, --at prints the height at one point
//
// Paths: a .env file beside package.json can name the folders once (SWG=..., JKA=..., CORE3=...); any
//        argument or flag value written @SWG, @JKA, @CORE3 (any @NAME) is replaced by that value, from
//        .env or the environment, so paths with spaces need no quoting in any shell.
// Flags: --retail-only (mount only archives named in the retail manifests)
//        --events (place buildout areas that the game only shows during an event; planets lists them)
//        --areas (why: list every buildout area with its rows, unknown templates and extent)
//        --ws-add=<archive>@x1,z1,x2,z2 (snapshot, why, audit: also place what an older publish's world snapshot in that
//                       archive put inside the rectangle; stat <file> --all lists every archive carrying a file)
//        --near=x,z,r (why: only objects within r metres of x,z; the pattern "." matches everything)
//        --core3=<dir> (SWGEmu's MMOCoreORB/bin/scripts: place the static objects its screenplays spawn,
//                       and write the creature and NPC spawns to <pack>/spawns.json; or set CORE3 in the environment)
//        --no-flip (keep left-handed coordinates)  --no-textures (skip DDS decoding)
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { resolveParts } from './appearance.mjs';
import { decodeDds } from './dds.mjs';
import { buildGlb } from './glb.mjs';
import { dump, isForm, parseIff } from './iff.mjs';
import { classifyDirectory, isRetailByName } from './manifest.mjs';
import { parseMesh } from './msh.mjs';
import { buildPack, familyOf } from './pack.mjs';
import { parseSnapshot, flattenWithWorldTransforms } from './ws.mjs';
import { loadBuildouts, mergeBuildouts } from './buildout.mjs';
import { R, composeMeshes, mergeSkeletons, parseAnimation, parseLat, parseLmg, parseMgn, parseSat, parseSkeleton, poseAtFrame, readIff, skinData, skinnedPrimitives } from './skeletal.mjs';
import { resolveAppearanceToMesh, resolveTemplateMesh, resolveTemplateString } from './objtemplate.mjs';
import { exportParticle } from './particle.mjs';
import { defaultJkaClips, importJkaClips } from './jka.mjs';
import { extractClips, readGlb, replaceClips, skinJoints } from './glbclips.mjs';
import { packClips, retargetClips, unpackClips } from './clipbundle.mjs';
import { encodePng } from './png.mjs';
import { shaderTextures } from './sht.mjs';
import { bakeShader, describeShader, describeVariables, loadImage, loadShader, parseBlueprint, parsePalette, preparedShaders, renderBlueprint, renderContext, shaderNeedsBake } from './texrender.mjs';
import { ImageRegistry, exportBlueprint, exportPalettes, exportShader, palettesOf } from './customize.mjs';
import { effectAlpha, alphaModeFor } from './eff.mjs';
import { localize, parseDatatable } from './datatable.mjs';
import { createRequire } from 'node:module';

/** Named places per planet (see regions/build.mjs). */
const REGIONS = createRequire(import.meta.url)('./regions/regions.json');
import { decodeTga, encodeHeightmap } from './tga.mjs';
import { exportSky } from './sky.mjs';
import { mobileTemplates, scanServerSpawns } from './spawns.mjs';
import { loadEffect } from './texrender.mjs';
import { readTemplate, stringParam } from './objtemplate.mjs';
import { openTre, openVfs, readHeader } from './tre.mjs';

// A .env beside package.json names the folders once; @NAME anywhere in the arguments becomes that
// variable's value (from .env or the environment), whichever shell is running.
const envFile = new URL('../../.env', import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
const expandEnv = (a) =>
  a.replace(/(^|=)@([A-Za-z_][A-Za-z0-9_]*)$/g, (whole, before, name) => {
    const value = process.env[name];
    if (value === undefined) {
      console.error(`@${name}: not set; put ${name}=<path> in .env beside package.json (see .env.example), or in the environment`);
      process.exit(1);
    }
    return before + value;
  });
const args = process.argv.slice(2).map(expandEnv);
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
    const { main, slots, alphaMode, effect } = shaderTextures(parseIff(vfs.read(shaderPath)));
    if (main && vfs.has(main)) {
      const dds = decodeDds(vfs.read(main));
      result = { path: main, png: encodePng(dds.width, dds.height, dds.rgba), hasAlpha: dds.hasAlpha, alphaMode: alphaFromEffect(vfs, effect, alphaMode) };
      Object.assign(result, surfaceFor(vfs, effect, slots, dds, result.alphaMode));
    }
  } catch (err) {
    console.error(`  texture for ${shaderPath} skipped: ${err.message}`);
  }
  textureCache.set(shaderPath, result);
  return result;
}

const surfaceEffects = new Map();

/**
 * How shiny a shader's surface is, from its effect and texture slots. The game keeps the
 * specular and reflection mask in the alpha channel of the diffuse map (when the effect does
 * not use alpha for transparency): bright alpha means glossy metal or glass. Reflective
 * shaders carry an environment cube map (slot ENVM) that the scene's own environment replaces.
 * Returns glTF metallic/roughness factors and, where a mask exists, a metallicRoughness image.
 */
function surfaceFor(vfs, effect, slots, dds, alphaMode) {
  const name = (effect ?? '').toLowerCase();
  let tags = surfaceEffects.get(name);
  if (!tags) {
    tags = new Set();
    try {
      const eff = effect ? loadEffect(vfs, effect.replace(/\\/g, '/')) : null;
      for (const pass of eff?.passes ?? []) for (const st of pass.stageList ?? []) if (st.textureTag) tags.add(st.textureTag);
    } catch {
      /* effects the renderer cannot parse just get no shine */
    }
    surfaceEffects.set(name, tags);
  }
  const slotTags = new Set((slots ?? []).map((s) => s.slot));
  const reflective = slotTags.has('ENVM') || tags.has('ENVM') || /env|chrome|mirror|refl/.test(name);
  const specular = reflective || slotTags.has('SPEC') || tags.has('SPEC') || /spec|gloss|shin|metal|glass/.test(name);
  if (!specular) return {};
  const masked = dds.hasAlpha && alphaMode === 'OPAQUE';
  if (!masked) return { metallic: reflective ? 0.6 : 0, roughness: reflective ? 0.3 : 0.45 };
  // Roughness in green, metalness in blue, both from the mask.
  const mr = new Uint8Array(dds.width * dds.height * 4);
  for (let i = 0; i < dds.width * dds.height; i++) {
    const a = dds.rgba[i * 4 + 3];
    mr[i * 4] = 0;
    mr[i * 4 + 1] = 255 - Math.round(a * 0.85);
    mr[i * 4 + 2] = reflective ? a : 0;
    mr[i * 4 + 3] = 255;
  }
  return { metallic: 1, roughness: 1, mr: { png: encodePng(dds.width, dds.height, mr) } };
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
  const effects = [];
  let portalGeometry = null;
  for (const part of parts) {
    if (part.particle) {
      // A particle effect among the parts (a lamp's flame, a fountain's spray): kept with its
      // transform for the runtime to play at every placed copy of the model.
      effects.push({ particle: part.particle, transform: part.transform ?? null, ...(part.cell !== undefined ? { cell: part.cell } : {}) });
      continue;
    }
    const mesh = parseMesh(parseIff(vfs.read(part.mesh)));
    if (part.transform) transformMesh(mesh, part.transform);
    merged.groups.push(...mesh.groups);
    merged.hardpoints.push(...mesh.hardpoints);
    merged.warnings.push(...mesh.warnings);
    if (parts.length === 1) merged.bounds = mesh.bounds;
    if (part.cell !== undefined) {
      const cell = cells.get(part.cell) ?? cells.set(part.cell, { index: part.cell, name: part.cellName, groups: [], hardpoints: [], warnings: [], portals: part.cellPortals ?? [], lights: part.cellLights ?? [] }).get(part.cell);
      cell.groups.push(...mesh.groups);
      cell.hardpoints.push(...mesh.hardpoints);
      portalGeometry ??= part.portalGeometry ?? null;
    }
  }
  if (!merged.groups.length) throw new Error(`${appearancePath}: no mesh parts (${effects.length} particle effects only)`);
  if (!merged.bounds) merged.bounds = boundsFromPositions(merged);
  const cellList = [...cells.values()].sort((a, b) => a.index - b.index);
  for (const c of cellList) c.bounds = boundsFromPositions(c);
  const meshParts = parts.length - effects.length;
  return { mesh: merged, meshPath: meshParts === 1 ? parts.find((p) => p.mesh).mesh : appearancePath, partCount: meshParts, cells: cellList.length > 1 ? cellList : null, portalGeometry, effects };
}

function convertOne(vfs, appearancePath, outFile) {
  const { mesh, meshPath, partCount, cells, portalGeometry, effects } = loadAppearanceMesh(vfs, appearancePath);
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
  const flipVec = (v) => (flipX ? [-v[0], v[1], v[2]] : v);
  const cellInfo = cells
    ? cells.map((c) => ({
        index: c.index,
        name: c.name,
        bounds: flipBounds(c.bounds),
        portals: c.portals.map((p) => ({ geometry: p.geometry, target: p.target, passable: p.passable && !p.disabled })),
        ...(c.lights?.length ? { lights: c.lights.map((l) => ({ type: l.type, color: l.color.map((v) => Math.round(v * 1000) / 1000), position: flipVec(l.position).map((v) => Math.round(v * 100) / 100), direction: flipVec(l.direction).map((v) => Math.round(v * 1000) / 1000), attenuation: l.attenuation.map((v) => Math.round(v * 10000) / 10000) })) } : {}),
      }))
    : undefined;
  // Portal polygons in model space (X flipped with the meshes) so the game can tell which cell the player is in.
  const portals = portalGeometry ? portalGeometry.map((p) => ({ v: p.verts.map(([x, y, z]) => [flipX ? -x : x, y, z]), i: p.indices })) : undefined;
  return { meshPath, mesh, flipX, tris, shaders, textured: textures.size, warnings: mesh.warnings, partCount, cells: cellInfo, portals, effects };
}

// Particle effects: converted once per .prt into <out-dir>/particles/, textures shared.
const particleTextures = new Map();
const particleEffects = new Map();

/** The first fixed-function pass of a shader's effect, for its blend mode. */
function passFor(vfs, shaderPath) {
  try {
    const { effect } = shaderTextures(parseIff(vfs.read(shaderPath)));
    const eff = effect ? loadEffect(vfs, effect.replace(/\\/g, '/')) : null;
    return eff?.passes?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Convert a particle effect into the pack (cached per file); returns its manifest entry or { failed }. */
function convertParticle(vfs, prtPath, outDir) {
  const key = prtPath.toLowerCase();
  let entry = particleEffects.get(key);
  if (entry) return entry;
  try {
    entry = exportParticle(vfs, prtPath, outDir, {
      textureFor: (shader) => textureFor(vfs, shader),
      passFor: (shader) => passFor(vfs, shader),
      textures: particleTextures,
      write: (file, bytes) => {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, bytes);
      },
      log: (m) => console.error(m),
    });
    console.error(`  ${entry.id}: particle effect, ${entry.quads} quad emitter(s)${entry.meshes ? `, ${entry.meshes} mesh emitter(s) (not drawn yet)` : ''}${entry.missingTextures.length ? `, textures missing: ${entry.missingTextures.join(', ')}` : ''}`);
  } catch (err) {
    entry = { failed: err.message };
  }
  particleEffects.set(key, entry);
  return entry;
}

/** Attached effects of a converted model, as the manifest stores them (transforms in the model's unflipped space). */
function attachedEffects(vfs, effects, outDir) {
  const out = [];
  for (const e of effects ?? []) {
    const p = convertParticle(vfs, e.particle, outDir);
    if (p.failed) {
      console.error(`  attached effect ${e.particle} skipped: ${p.failed}`);
      continue;
    }
    out.push({ file: p.file, id: p.id, ...(e.transform ? { transform: e.transform.map((v) => Math.round(v * 10000) / 10000) } : {}), ...(e.cell !== undefined ? { cell: e.cell } : {}) });
  }
  return out;
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
  exportSky(vfs, planet, outDir, { textureFor: (p) => textureFor(vfs, p) });
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
  // Families the planet's rules use, plus any that building layer files in the pack add by name.
  const wanted = [...template.generator.shaderGroup.families.values()];
  const known = new Set(wanted.map((f) => f.name.toLowerCase()));
  const layerDir = join(outDir, 'terrain');
  if (existsSync(layerDir)) {
    // Ids after the planet's own; the game matches these by name, the id only has to be unique here.
    let nextId = Math.max(0, ...wanted.map((f) => f.id)) + 1;
    for (const file of readdirSync(layerDir).filter((f) => /\.lay$/i.test(f)).sort()) {
      try {
        for (const fam of layerFamilies(readFileSync(join(layerDir, file)))) {
          if (!fam.name || fam.name === 'null' || known.has(fam.name.toLowerCase())) continue;
          known.add(fam.name.toLowerCase());
          wanted.push({ ...fam, id: nextId++ });
        }
      } catch (err) {
        console.warn(`terrain layer ${file}: families not read: ${err.message}`);
      }
    }
  }
  for (const fam of wanted) {
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
      // The alpha channel is a specular or blend mask, not transparency: browsers drop the colour of
      // transparent pixels when they draw an image, so the ground texture is written opaque.
      for (let i = 3; i < img.rgba.length; i += 4) img.rgba[i] = 255;
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

/** The shader families a terrain layer file (.lay) carries: SFAM chunks of its SGRP form. */
function layerFamilies(bytes) {
  const out = [];
  let o = 0;
  while (o + 8 <= bytes.length) {
    const tag = bytes.toString('latin1', o, o + 4);
    const size = bytes.readUInt32BE(o + 4);
    if (tag === 'FORM' && bytes.toString('latin1', o + 8, o + 12) === 'SGRP') {
      const root = parseIff(bytes.subarray(o, o + 8 + size));
      const v = root.children.find((c) => c.tag === 'FORM');
      const version = v ? Number.parseInt(v.type, 10) : 0;
      for (const c of v ? v.children : []) {
        if (c.tag !== 'SFAM') continue;
        const r = new R(c.data);
        const id = r.i32();
        let name = 'null';
        if (version >= 1) {
          name = r.str();
          if (version >= 6) r.str();
          r.u8(); r.u8(); r.u8();
        }
        let shaderSize = 2;
        if (version >= 2) shaderSize = r.f32();
        if (version === 3) r.f32();
        let featherClamp = 1;
        if (version >= 4) featherClamp = r.f32();
        if (version === 5) r.i32();
        const n = r.i32();
        const children = [];
        for (let k = 0; k < n; k++) children.push({ name: r.str(), weight: version >= 1 ? r.f32() : 1 / n });
        out.push({ id, name, shaderSize, featherClamp, children });
      }
      break;
    }
    o += 8 + size;
  }
  return out;
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
  // A speed selector's branches are listed in the file's order, not by speed: rank each group's
  // ":speedN" by the speed its animation carries (0 the slowest, so speed0 is the idle everywhere).
  const groups = new Map();
  for (const e of named) {
    const m = /^(.*):speed(\d+)(.*)$/.exec(e.name);
    if (!m) continue;
    const g = groups.get(m[1]) ?? groups.set(m[1], new Map()).get(m[1]);
    const idx = Number(m[2]);
    const list = g.get(idx) ?? g.set(idx, []).get(idx);
    list.push({ e, tail: m[3] });
  }
  for (const [base, byIndex] of groups) {
    if (byIndex.size < 2) continue;
    const ranked = [...byIndex.entries()].map(([idx, list]) => {
      const rep = list.find((x) => x.tail === '') ?? list.find((x) => x.e.isDefault) ?? list[0];
      let speed = 0;
      try {
        speed = loadAnimation(rep.e)?.locomotionSpeed ?? 0;
      } catch {
        speed = 0;
      }
      return { idx, speed, list };
    });
    ranked.sort((a, b) => a.speed - b.speed || a.idx - b.idx);
    ranked.forEach((r, rank) => {
      for (const { e, tail } of r.list) e.clip = e.name = `${base}:speed${rank}${tail}`;
    });
  }
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
/**
 * A character as parts (body, head and each worn item as its own GLB against one shared skeleton)
 * under <outRoot>/characters/<id>/, keeping the Jedi Academy clips an old rig there carried.
 */
function convertParts(vfs, outRoot, template, { wear = DEFAULT_WEAR, variables = new Map(), anim = undefined, maxAnims = undefined } = {}) {
  const id = basename(template).replace(/^shared_/, '').replace(/\.[^.]+$/, '');
  const outDir = join(outRoot, 'characters', id);
  const rigFile = join(outDir, 'rig.glb');
  const oldParts = existsSync(join(outDir, 'parts.json')) ? JSON.parse(readFileSync(join(outDir, 'parts.json'), 'utf8')) : null;
  let carried = null;
  if (existsSync(rigFile)) {
    try {
      const bundle = extractClips(readFileSync(rigFile), (name) => /^BOTH_/i.test(name));
      if (bundle.clips.length) carried = { bundle, jkaClips: oldParts?.jkaClips ?? {}, jkaGrip: oldParts?.jkaGrip, scale: oldParts?.scale };
    } catch (err) {
      console.log(`  (the old rig's Jedi Academy clips could not be read: ${err.message})`);
    }
  }
  const gender = /female/i.test(id) ? 'f' : 'm';
  const info = convertSat(vfs, template, null, {
    animations: anim ?? PLAYER_CLIPS,
    maxAnimations: maxAnims ? Number(maxAnims) : 240,
    variables,
    wear,
    parts: { dir: outDir, rig: 'rig' },
    gender,
  });
  let kept = null;
  if (carried) {
    const buf = readFileSync(rigFile);
    const { json } = readGlb(buf);
    if (!(json.animations ?? []).some((a) => /^BOTH_/i.test(a.name))) {
      const { clips } = retargetClips(carried.bundle, skinJoints(json));
      writeFileSync(rigFile, replaceClips(buf, clips, (name) => clips.some((c) => c.name === name)));
      info.rig.clips = (info.rig.clips ?? 0) + clips.length;
      kept = { count: clips.length, jkaClips: Object.fromEntries(Object.entries(carried.jkaClips).filter(([n]) => clips.some((c) => c.name === n))) };
    }
  }
  const manifest = {
    id,
    species: id.replace(/_(male|female)$/, ''),
    gender: gender === 'f' ? 'female' : 'male',
    template,
    skeleton: info.skeleton,
    rig: info.rig,
    joints: info.joints,
    defaultWear: info.parts.filter((p) => p.occlusionLayer > 0).map((p) => p.name),
    clips: info.animations,
    clipSpeeds: info.clipSpeeds ?? {},
    ...(info.partialClips ? { partialClips: info.partialClips } : {}),
    parts: info.parts,
    customization: [...info.customization],
    variables: customizationList(vfs, info),
    values: Object.fromEntries(variables),
    ...(kept ? { jkaClips: kept.jkaClips, ...(carried.jkaGrip ? { jkaGrip: carried.jkaGrip } : {}), ...(carried.scale !== undefined ? { scale: carried.scale } : {}) } : {}),
  };
  writeFileSync(join(outDir, 'parts.json'), JSON.stringify(manifest, null, 2));
  const total = info.parts.reduce((a, p) => a + p.bytes, 0);
  console.log(`-> ${outDir}`);
  console.log(`   rig ${info.rig.file}: ${info.rig.joints} joints, ${info.rig.clips} clips${kept ? ` (${kept.count} Jedi Academy clips carried over from the old rig)` : ''}`);
  for (const p of info.parts) {
    console.log(`   ${p.name.padEnd(22)} ${String(p.triangles).padStart(5)} tris  ${(p.bytes / 1024).toFixed(0).padStart(5)} KB  layer ${p.occlusionLayer}${p.occludes?.length ? `  hides ${p.occludes.join(' ')}` : ''}${p.morphs?.length ? `  ${p.morphs.length} morphs` : ''}`);
  }
  console.log(`   ${info.parts.length} parts, ${(total / 1e6).toFixed(1)} MB of meshes (the rig and its clips are shared)`);
  if (info.recipes) console.log(`   live customization: ${info.recipes} texture recipes over ${info.images} images in customize/ (the game renders skin, hair and eyes itself)`);
  const palettes = manifest.variables.filter((v) => v.kind === 'palette');
  if (manifest.variables.length) console.log(`   customization: ${palettes.length} colour palettes (${palettes.map((v) => `${v.name} ${v.colors.length}`).join(', ')}), ${manifest.variables.length - palettes.length} choices; set with --var=name=value`);
  if (info.skipped.length) console.log(`   skipped: ${info.skipped.slice(0, 5).join('; ')}`);
  return { id, outDir, manifest };
}

/** Put a saved clip bundle onto a parts rig that lacks its clips, with the loop flags into parts.json; returns how many clips went on. */
function applyBundleToRig(rigFile, bundleFile) {
  const buf = readFileSync(rigFile);
  const { json } = readGlb(buf);
  if ((json.animations ?? []).some((a) => /^BOTH_/i.test(a.name))) return 0;
  const bundle = unpackClips(readFileSync(bundleFile));
  const { clips } = retargetClips(bundle, skinJoints(json));
  if (!clips.length) return 0;
  writeFileSync(rigFile, replaceClips(buf, clips, (name) => clips.some((c) => c.name === name)));
  const partsManifest = join(dirname(rigFile), 'parts.json');
  if (existsSync(partsManifest)) {
    const m = JSON.parse(readFileSync(partsManifest, 'utf8'));
    const present = new Set(clips.map((c) => c.name));
    m.rig = { ...(m.rig ?? {}), clips: (m.rig?.clips ?? 0) + clips.length };
    m.jkaClips = Object.fromEntries(Object.entries(bundle.meta?.jkaClips ?? {}).filter(([n]) => present.has(n)));
    m.clipSpeeds = { ...(m.clipSpeeds ?? {}), ...(bundle.meta?.clipSpeeds ?? {}) };
    if (bundle.meta?.scale !== undefined) m.scale = bundle.meta.scale;
    if (bundle.meta?.grip) m.jkaGrip = bundle.meta.grip;
    writeFileSync(partsManifest, JSON.stringify(m, null, 2));
  }
  return clips.length;
}

/** characters/index.json: every parts pack under <outRoot>/characters, with what each offers the character creator. */
function writeSpeciesIndex(outRoot) {
  const dir = join(outRoot, 'characters');
  const species = [];
  if (existsSync(dir)) {
    for (const id of readdirSync(dir).sort()) {
      const file = join(dir, id, 'parts.json');
      if (!existsSync(file)) continue;
      let m;
      try {
        m = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        continue;
      }
      const gender = m.gender ?? (/female/i.test(id) ? 'female' : 'male');
      const wardrobeDir = [id, `human_${gender}`].find((w) => existsSync(join(outRoot, 'wardrobe', w, 'wardrobe.json')));
      species.push({
        id,
        species: m.species ?? id.replace(/_(male|female)$/, ''),
        gender,
        template: m.template,
        skeleton: m.skeleton,
        parts: m.parts?.length ?? 0,
        morphs: [...new Set((m.parts ?? []).flatMap((p) => p.morphs ?? []))],
        variables: m.variables ?? [],
        jkaClips: Object.keys(m.jkaClips ?? {}).length,
        wardrobe: wardrobeDir ?? null,
      });
    }
  }
  const index = { species };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.json'), JSON.stringify(index, null, 2));
  return index;
}

/** Remember a customization variable by name, with where it was met, for the structured manifest. */
function noteVariables(info, list, source, mesh = null) {
  if (!info.variables) return;
  for (const v of list) {
    // A private variable is the object's own (a shirt's colour 1 is not the body's colour 1), so
    // it is kept per mesh; a shared one (the owner's skin colour) is one for the whole character.
    const key = `${v.private ? 'private:' : ''}${v.name}`;
    const entry = info.variables.get(key) ?? info.variables.set(key, { name: v.name, private: !!v.private, kind: v.kind, sources: [], meshes: [] }).get(key);
    if (v.kind === 'palette') entry.palette = v.palette;
    else entry.max = Math.max(entry.max ?? 0, v.max ?? 0);
    if (entry.default === undefined) entry.default = v.default ?? 0;
    if (!entry.sources.includes(source)) entry.sources.push(source);
    if (mesh && !entry.meshes.includes(mesh)) entry.meshes.push(mesh);
  }
}

/** The structured customization list a manifest carries: each variable with its palette's colours or its range. */
function customizationList(vfs, info) {
  const out = [];
  for (const v of info.variables?.values() ?? []) {
    const entry = { name: v.name, private: v.private, kind: v.kind === 'palette' ? 'palette' : 'index', default: v.default, sources: v.sources.map((f) => basename(f)), meshes: v.meshes ?? [] };
    if (v.kind === 'palette') {
      entry.palette = v.palette;
      try {
        entry.colors = vfs.has(v.palette) ? parsePalette(vfs.read(v.palette)).map(([r, g, b]) => [r, g, b]) : [];
      } catch {
        entry.colors = [];
      }
    } else entry.count = v.max ?? 0;
    out.push(entry);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

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
function skinnedTexture(vfs, shaderPath, slots, ctx, info, mesh = null) {
  let shader = null;
  try {
    shader = loadShader(vfs, shaderPath, ctx);
  } catch (err) {
    info.skipped.push(`${shaderPath}: ${err.message}`);
  }
  if (shader && shader.variables?.length) {
    for (const line of describeVariables(shader.variables)) info.customization.add(`${shaderPath}: ${line}`);
    noteVariables(info, shader.variables, shaderPath, mesh);
  }
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

/**
 * Convert a skeletal appearance.
 *
 * By default everything -- body, head and whatever is worn -- is merged into one GLB, with the
 * skin under the clothing culled away for good. `parts` instead writes each mesh as its own GLB
 * against the same skeleton, keeps every triangle, and carries the occlusion zones through, so
 * the game can dress and undress a character at run time rather than the converter deciding once.
 */
function convertSat(vfs, path, outFile, { animations = 'all', maxAnimations = 80, variables = new Map(), wear = [], extraClips = null, parts = null, gender = null } = {}) {
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
  const info = { sat: satPath, skeleton: skeletonFile, joints: 0, meshes: [], animations: [], missing: [], unknownTransforms: 0, skipped: [], textureRenderers: [], customization: new Set(), variables: new Map(), attached: [], shaderNotes: new Set() };
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
  {
    const ext = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (const j of skeleton.joints) for (let k = 0; k < 3; k++) {
      ext.min[k] = Math.min(ext.min[k], j.bindT[k]);
      ext.max[k] = Math.max(ext.max[k], j.bindT[k]);
    }
    info.jointExtent = ext;
    info.rootJoint = skeleton.joints.find((j) => j.parent < 0)?.name ?? '?';
  }
  info.attached = skeleton.attached.map((a, i) => `${extras[i].file} (${a.joints} joints) at ${a.attachTo}`);
  const meshes = [];
  const recipes = parts ? [] : null;
  const registry = parts ? new ImageRegistry((id, bytes) => {
    mkdirSync(join(parts.dir, 'customize'), { recursive: true });
    writeFileSync(join(parts.dir, 'customize', id), bytes);
  }) : null;
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
      // A wearable's template names one gender's appearance and the client swaps the suffix for
      // the other, so a male character given shirt_s03_f.sat should wear shirt_s03_m.sat.
      if (gender) {
        const swapped = file.replace(/_[fm](\.sat)$/i, `_${gender}$1`);
        if (swapped !== file && vfs.has(swapped)) file = swapped;
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
  // In parts mode nothing is hidden at conversion time: the zones travel with the mesh instead.
  const composed = parts ? loaded.map((l) => ({ ...l, hiddenTriangles: 0 })) : composeMeshes(loaded);
  for (const { mgn, file, body, hiddenTriangles } of composed) {
    const { groups, unknownTransforms, unknownNames } = skinnedPrimitives(mgn, skeleton);
    info.unknownTransforms += unknownTransforms;
    for (const n of unknownNames) (info.unknownJoints ??= new Set()).add(n);
    // Each mesh's own extent, for telling a tiny model from a wrong one.
    const ext = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let i = 0; i < mgn.positions.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        ext.min[k] = Math.min(ext.min[k], mgn.positions[i + k]);
        ext.max[k] = Math.max(ext.max[k], mgn.positions[i + k]);
      }
    }
    (info.meshExtents ??= []).push({ file, vertices: mgn.positions.length / 3, min: ext.min, max: ext.max });
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
        noteVariables(info, bp.variables, trt.file, meshName);
        for (const sl of trt.slots) (slotsByShader.get(sl.shaderIndex) ?? slotsByShader.set(sl.shaderIndex, []).get(sl.shaderIndex)).push({ tag: sl.tag, image, file: trt.file, bp });
      } catch (err) {
        info.skipped.push(`${trt.file}: ${err.message}`);
      }
    }
    const kept = [];
    groups.forEach((g, i) => {
      if (!g.primitives[0].indices.length) return; // everything this shader drew is under clothing
      const slots = slotsByShader.get(i);
      const shaderPath = g.shader;
      const t = skinnedTexture(vfs, g.shader, slots, ctx, info, meshName);
      if (slots) g.shader = `${g.shader}@${meshName}`; // its own material: the rendered texture is this mesh's
      if (t) textures.set(g.shader, t);
      kept.push(g);
      // For a parts pack: how this material's texture is made, so the game can make it again with
      // other colours and choices (a rendered blueprint, a shader baked over one, or a shader
      // baked from its own textures and palette factors). A plain texture needs nothing.
      if (parts && recipes) {
        try {
          const shader = loadShader(vfs, shaderPath, ctx);
          const rendered = slots?.find((sl) => sl.tag === 'MAIN') ?? slots?.[0];
          let bake = false;
          if (shader?.effect) {
            const s = { ...shader, textures: new Map(shader.textures) };
            for (const slot of slots ?? []) s.textures.set(slot.tag, slot.image);
            bake = !rendered || shaderNeedsBake(s, rendered.tag);
          }
          if (rendered || bake) {
            const load = (file) => loadImage(vfs, file, ctx.images);
            recipes.push({
              mesh: meshName,
              material: g.shader,
              kind: bake ? 'bake' : 'render',
              baseTag: rendered ? rendered.tag : 'MAIN',
              shader: exportShader(shader, registry, load),
              slots: (slots ?? []).map((sl) => ({ tag: sl.tag, file: sl.file, blueprint: exportBlueprint(vfs, sl.bp, ctx, registry, loadImage) })),
            });
          }
        } catch (err) {
          info.skipped.push(`${shaderPath}: no live recipe (${err.message})`);
        }
      }
    });
    if (kept.length) {
      const entry = { name: meshName, groups: kept, blendTargets: mgn.blendTargets };
      if (parts) {
        // What this mesh hides on the layers beneath it, and the zone names its triangles index.
        entry.extras = {
          occlusionLayer: mgn.occlusionLayer,
          occludes: mgn.occludes,
          zoneNames: mgn.occlusionZones,
          zoneCombinations: mgn.zoneCombinations,
          fullyOccludedBy: mgn.fullyOccludedBy,
          body: !!body,
        };
      }
      meshes.push(entry);
    }
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
    const cut = [];
    for (const e of named) {
      if (wanted && !wanted.some((w) => (w.startsWith('=') ? e.clip.toLowerCase() === w.slice(1) || e.name.toLowerCase() === w.slice(1) : e.clip.toLowerCase().includes(w) || e.name.toLowerCase().includes(w)))) continue;
      if (used.has(e.clip)) continue;
      if (clips.length >= maxAnimations) {
        // Past the cap: say which wanted clips were left out rather than dropping them quietly.
        if (!used.has(e.clip)) cut.push(e.clip);
        used.add(e.clip);
        continue;
      }
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
        // A clip that moves only part of the skeleton (a fire on the arms, an emote on the face) is
        // noted with the joints it drives, so it can be layered over a full pose instead of T-posing the rest.
        if (matched < jointNames.size) {
          // The joints by the skeleton's own spelling, which is what the model's nodes are named.
          const canonical = new Map(skeleton.joints.map((j) => [j.name.toLowerCase(), j.name]));
          (info.partialClips ??= {})[e.clip] = animation.transforms.map((t) => canonical.get(t.name.toLowerCase())).filter((n) => n !== undefined);
        }
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
    if (cut.length) {
      info.cut = cut;
      console.warn(`   ${cut.length} wanted clips left out by the --max-anims cap of ${maxAnimations}: ${cut.slice(0, 8).join(', ')}${cut.length > 8 ? ', ...' : ''}; raise --max-anims to keep them`);
    }
  } else if (latFile) info.missing.push(latFile);
  const skin = skinData(skeleton, clips, { flipX: true });
  if (extraClips) {
    // Clips from elsewhere (Jedi Academy's), already retargeted onto this skeleton's joints.
    const extra = extraClips(skin.joints, info);
    for (const c of extra) {
      skin.clips.push(c);
      info.animations.push(c.name);
    }
  }
  if (parts) {
    // One GLB per mesh, each carrying the same skeleton so they can be bound to one at run time,
    // plus a rig of skeleton and animations alone that every part and every species shares.
    mkdirSync(parts.dir, { recursive: true });
    info.parts = [];
    // The live customization recipes and the images they draw from.
    if (recipes.length) {
      const palettes = exportPalettes(vfs, recipes.flatMap((r) => palettesOf(r)));
      writeFileSync(join(parts.dir, 'customize.json'), JSON.stringify({ images: 'customize/', recipes, palettes }, null, 1));
      info.recipes = recipes.length;
      info.images = registry.ids.size;
    }
    const rigFile = join(parts.dir, `${parts.rig ?? 'rig'}.glb`);
    writeFileSync(rigFile, buildGlb([], { flipX: true, skin, animations: skin.clips }));
    info.rig = { file: relative(parts.dir, rigFile), joints: skin.joints.length, clips: skin.clips.length };
    for (const mesh of meshes) {
      const file = join(parts.dir, `${mesh.name}.glb`);
      const own = new Map();
      for (const g of mesh.groups) if (textures.has(g.shader)) own.set(g.shader, textures.get(g.shader));
      writeFileSync(file, buildGlb([mesh], { flipX: true, textures: own, skin, keepZones: true }));
      info.parts.push({
        name: mesh.name,
        file: relative(parts.dir, file),
        bytes: statSync(file).size,
        triangles: mesh.groups.reduce((a, g) => a + g.primitives[0].indices.length / 3, 0),
        ...(mesh.blendTargets?.length ? { morphs: mesh.blendTargets.map((b) => b.name) } : {}),
        ...(mesh.extras ?? {}),
      });
    }
    return info;
  }
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
    for (const line of sampler.trace(ax, az)) console.log(`    ${line}`);
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
  if (opts.at) {
    const [ax, az] = opts.at.split(',').map(Number);
    sampler.invalidateAll();
    console.log(`  height at ${ax},${az} with building layers: ${sampler.heightAt(ax, az).toFixed(3)}`);
    for (const line of sampler.trace(ax, az)) console.log(`    ${line}`);
  }
  const t2 = Date.now();
  const rows = [];
  for (const o of objects) {
    const h = sampler.heightAt(o.x, o.z);
    rows.push({ o, h, err: h - o.y });
  }
  const ms = Date.now() - t2;
  const signed = rows.map((r) => r.err).sort((a, b) => a - b);
  const q = (p) => signed[Math.min(signed.length - 1, Math.floor(signed.length * p))];
  if (!rows.length) {
    console.log('  no snapshot objects to compare against');
    return;
  }
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
  // The launch planets ship a world snapshot; the expansions' planets place everything through
  // buildout tables and have none, so an empty snapshot is fine as long as buildouts exist.
  const wsPath = `snapshot/${planet}.ws`;
  const hasBuildouts = vfs.has(`datatables/buildout/areas_${planet}.iff`);
  if (!vfs.has(wsPath) && !hasBuildouts) throw new Error(`no ${wsPath} and no datatables/buildout/areas_${planet}.iff in archives`);
  const snap = vfs.has(wsPath) ? parseSnapshot(parseIff(vfs.read(wsPath))) : { version: 'none', templates: [], nodes: [] };
  // --ws-add=<archive>@x1,z1,x2,z2 brings back objects an older publish's snapshot placed inside a
  // rectangle (a city the final client no longer carries, such as pre-battle Restuss).
  if (options['ws-add']) {
    const [archive, rect] = options['ws-add'].split('@');
    const [x1, z1, x2, z2] = (rect ?? '').split(',').map(Number);
    if (![x1, z1, x2, z2].every(Number.isFinite)) throw new Error('--ws-add needs <archive>@x1,z1,x2,z2');
    const old = parseSnapshot(parseIff(vfs.readFrom(wsPath, archive)));
    const templateIndex = new Map(snap.templates.map((t, i) => [t, i]));
    let added = 0;
    const remap = (n) => {
      const template = old.templates[n.templateIndex];
      let ti = templateIndex.get(template);
      if (ti === undefined) {
        ti = snap.templates.length;
        snap.templates.push(template);
        templateIndex.set(template, ti);
      }
      added++;
      return { ...n, id: n.id + (1 << 28), containedBy: n.containedBy ? n.containedBy + (1 << 28) : 0, templateIndex: ti, children: (n.children ?? []).map(remap), wsAdd: true };
    };
    for (const n of old.nodes) {
      const [x, , z] = n.pos;
      if (x >= Math.min(x1, x2) && x <= Math.max(x1, x2) && z >= Math.min(z1, z2) && z <= Math.max(z1, z2)) snap.nodes.push(remap(n));
    }
    console.error(`snapshot from ${archive}: ${added} objects added inside ${x1},${z1} to ${x2},${z2}`);
  }
  const snapshotCount = snap.nodes.length;
  const buildout = loadBuildouts(vfs, planet, { events: flags.has('--events') });
  mergeBuildouts(snap, buildout);
  // Server placements (SWGEmu's scripts) are a third source, when a checkout is given.
  const core3 = options.core3 ?? process.env.CORE3;
  let spawns = null;
  if (core3) {
    spawns = scanServerSpawns(core3, planet);
    let nextId = 1 << 29;
    const extra = spawns.objects.map((o) => ({ id: nextId++, containedBy: 0, template: o.template, cellIndex: 0, q: o.q, pos: o.pos, radius: 4, portalLayoutCrc: 0, children: [], area: `server:${o.file}` }));
    mergeBuildouts(snap, { nodes: extra });
  }
  const entries = flattenWithWorldTransforms(snap);
  return { snap, entries, snapshotCount, buildout: buildout.stats, spawns, core3 };
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
  lava_flea: 'object/mobile/som/shared_lava_flea.iff',
  webweaver: 'object/mobile/shared_webweaver.iff',
};
/** Logical animations (substrings) the game drives creatures with. */
const CREATURE_CLIPS = 'idle,walk,run,cbt_stand_combat_attack_light,rea_stand_get_hit_light,trn_stand_to_incapacitated,loop_incapacitated';

/** The player's clips: locomotion and posture by exact name (=), reactions by substring. */
/** What the player wears when --wear is not given: a plain shirt, trousers and shoes. */
const DEFAULT_WEAR = ['object/tangible/wearables/shirt/shared_shirt_s03.iff', 'object/tangible/wearables/pants/shared_pants_s01.iff', 'object/tangible/wearables/shoes/shared_shoes_s01.iff'];
const PLAYER_CLIPS = '=idle,=walk,=run,=idle_combat,=walk_combat,=run_combat,=jump,strafe,backward,walk_back,run_back,loop_crouched,loop_kneeling,loop_prone,trn_standing_to_crouched,trn_crouched_to_standing,trn_standing_to_kneeling,trn_kneeling_to_standing,trn_crouched_to_kneeling,trn_kneeling_to_prone,trn_prone_to_kneeling,trn_standing_to_prone,trn_prone_to_standing,loop_pistol_standing,loop_rifle:,loop_pistol_riding,loop_rifle_riding,loop_riding,loop_ride,loop_combat_standing,loop_pistol_kneeling,loop_rifle_kneeling,loop_pistol_prone,loop_rifle_prone,loop_pistol_combat_prone,loop_rifle_combat_prone,add_pistol_fire,add_rifle_fire,pistol_combat_prone_fire,rifle_combat_prone_fire,pistol_reload,rifle_reload,loop_pistol_combat_standing,loop_rifle_combat_standing,loop_rifle_a_combat,loop_pistol_combat_kneeling,loop_rifle_combat_kneeling,loop_rifle_kneeling_combat,loop_pistol_kneeling_combat,pistol_combat_standing_fire,rifle_combat_standing_fire,rifle_standing_aimed_fire,pistol_standing_aimed_fire,pistol_combat_kneeling_fire,rifle_combat_kneeling_fire,pistol_kneeling_fire,rifle_kneeling_fire,trn_pistol_standing_to_pistol_combat,trn_rifle_a_standing,trn_pistol_combat_to_pistol_combat_aimed,trn_pistol_combat_standing_aimed_to,trn_pistol_combat_standing_to,trn_rifle_combat_standing_to,trn_rifle_combat_standing_aimed_to,trn_pistol_combat_kneeling,trn_rifle_combat_kneeling,trn_pistol_combat_prone_to,trn_rifle_combat_prone_to,trn_pistol_combat_prone_aimed_to,trn_rifle_combat_prone_aimed_to,=loop_sitting_chair:0,=loop_sitting_ground,=loop_swimming:speed0,=loop_swimming:speed1,=unarmed_standing_ready_punch,=sword_1h_standing_ready_hrz_slash_middle_r,=rea_get_hit_medium_mid_center,=trn_combat_standing_hit_to_incapacitated_face_up,=loop_incapacitated_face_up,=cbt_stand_combat_attack_light,=rea_stand_get_hit_light,=trn_stand_to_incapacitated,=loop_incapacitated';
const PLAYER_TEMPLATE = 'object/creature/player/shared_human_male.iff';

/** Planet ids the game can load a pack for (see src/data/planets.ts). */
const GAME_PLANETS = ['tatooine', 'naboo', 'corellia', 'dantooine', 'lok', 'endor', 'dathomir', 'yavin4', 'talus', 'rori', 'mustafar', 'kashyyyk_main', 'kashyyyk_hunting', 'kashyyyk_dead_forest', 'kashyyyk_rryatt_trail', 'kashyyyk_north_dungeons', 'kashyyyk_south_dungeons', 'kashyyyk_pob_dungeons'];

/**
 * Report what the packs under <dir> hold (planets, creatures, player) and which command
 * would fill each gap, so a fresh checkout or a second machine knows what to run.
 */
function packStatus(dir) {
  const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);
  const todo = new Map();
  const need = (cmd, why) => {
    if (!todo.has(cmd)) todo.set(cmd, []);
    todo.get(cmd).push(why);
  };
  console.log(`packs under ${dir}:`);
  let planets = 0;
  for (const planet of GAME_PLANETS) {
    const packDir = join(dir, planet);
    const manifest = readJson(join(packDir, 'manifest.json'));
    if (!manifest) {
      console.log(`  ${planet}: no pack`);
      need(`snapshot <swg-dir> all ${dir} --radius=all --retail-only`, `${planet} has no pack`);
      continue;
    }
    planets++;
    const layout = readJson(join(packDir, 'layout.json'));
    const objects = layout ? layout.objects.length : 0;
    const flora = Object.keys(manifest.categories?.flora ?? {}).length;
    const pois = readJson(join(packDir, 'pois.json'));
    const terrain = existsSync(join(packDir, 'terrain.trn'));
    const shaders = readJson(join(packDir, 'terrain/shaders.json'));
    const textured = shaders ? shaders.families.filter((f) => f.file).length : 0;
    const layers = existsSync(join(packDir, 'terrain')) ? readdirSync(join(packDir, 'terrain')).filter((f) => f.endsWith('.lay')).length : 0;
    const sky = readJson(join(packDir, 'sky.json'));
    const parts = [
      `${objects} objects`,
      `${flora} flora models`,
      pois ? `${(pois.pois ?? pois).length ?? 0} places` : 'no pois.json',
      terrain ? `terrain${layers ? ` + ${layers} building layers` : ''}` : 'NO TERRAIN',
      shaders ? `ground textures ${textured}/${shaders.families.length}` : 'NO GROUND TEXTURES',
      sky ? `sky (${sky.blocks.length} blocks)` : 'NO SKY',
    ];
    console.log(`  ${planet}: ${parts.join(', ')}`);
    if (!objects) need(`snapshot <swg-dir> ${planet} ${packDir} --center=auto --radius=all --retail-only`, `${planet} has no objects`);
    if (!terrain) need(`snapshot <swg-dir> ${planet} ${packDir} --center=auto --radius=all --retail-only`, `${planet} has no terrain`);
    else if (!shaders) need(`terrain <swg-dir> all ${dir} --retail-only`, `${planet} has no ground textures`);
    else if (!sky) need(`sky <swg-dir> all ${dir} --retail-only`, `${planet} has no sky`);
    if (!pois) need(`pois <swg-dir> all ${dir} --retail-only`, `${planet} has no pois.json`);
  }
  const creatures = readJson(join(dir, 'creatures/manifest.json'));
  if (!creatures) {
    console.log('  creatures: none');
    need(`creatures <swg-dir> ${dir} --retail-only`, 'no creatures converted');
  } else {
    const have = new Set(creatures.creatures.map((c) => c.id));
    const missing = Object.keys(CREATURES).filter((id) => !have.has(id));
    console.log(`  creatures: ${have.size} (${[...have].join(', ')})${missing.length ? `; missing ${missing.join(', ')}` : ''}`);
    if (missing.length) need(`creatures <swg-dir> ${dir} --retail-only`, `creatures missing: ${missing.join(', ')}`);
  }
  const player = readJson(join(dir, 'player/manifest.json'));
  if (!player || !player.players?.length) {
    console.log('  player: none (the placeholder rig is used)');
    need(`player <swg-dir> ${dir} --retail-only`, 'no player character converted');
  } else {
    const p = player.players[0];
    const wear = p.wear?.length ? `${p.wear.length} wearables` : 'NO CLOTHES';
    const swims = p.clips.some((c) => /swim/i.test(c));
    console.log(`  player: ${p.id} (${p.template}), ${wear}, ${p.clips.length} clips${swims ? '' : ', NO SWIMMING CLIPS'}`);
    // The clips each posture and carry the game plays needs; a rig converted before they were listed lacks them.
    const POSTURE_CLIPS = [
      ['crouch', /^loop_crouched:speed[01]/],
      ['prone', /^loop_prone:speed[01]/],
      ['pistol', /^loop_pistol_(standing|combat)/],
      ['rifle', /^loop_rifle(_combat)?:speed/],
      ['prone blaster', /^loop_(pistol|rifle)_combat_prone/],
      ['combat stance', /^loop_combat_standing:speed/],
      ['kneel', /^loop_kneeling/],
      ['blaster shots', /^add_(pistol|rifle)_fire/],
    ];
    const lacking = (names) => POSTURE_CLIPS.filter(([, re]) => !names.some((c) => re.test(c))).map(([what]) => what);
    const playerLacks = lacking(p.clips);
    if (playerLacks.length) console.log(`  player clips missing: ${playerLacks.join(', ')}`);
    if (!Object.keys(p.jkaClips ?? {}).length) console.log('  player: no Jedi Academy clips (saber swings, jumps, rolls): add --jka=<jka-dir> to the player command, then re-run parts, clips-save and clips-apply');
    if (!p.wear?.length) need(`player <swg-dir> ${dir} --retail-only`, 'the player has no clothes');
    else if (!swims) need(`player <swg-dir> ${dir} --retail-only`, 'the player lacks the swimming clips');
    else if (playerLacks.length) need(`player <swg-dir> ${dir} --retail-only${p.jkaClips ? ' --jka=<jka-dir>' : ''}`, `the player lacks the ${playerLacks.join(', ')} clips`);
    // The parts pack the game prefers: it must carry the named locomotion clips, and the Jedi Academy clips travel to it by bundle.
    const partsFile = join(dir, 'characters', p.id, 'parts.json');
    const partsManifest = readJson(partsFile);
    if (partsManifest) {
      const clipNames = new Set([...(partsManifest.clips ?? []), ...Object.keys(partsManifest.clipSpeeds ?? {}), ...Object.keys(partsManifest.jkaClips ?? {})]);
      const walks = clipNames.has('walk') && clipNames.has('run') && clipNames.has('idle');
      const jkaCount = Object.keys(partsManifest.jkaClips ?? {}).length;
      const playerJka = Object.keys(p.jkaClips ?? {}).length;
      console.log(`  parts: ${partsManifest.parts?.length ?? 0} parts, rig ${partsManifest.rig?.clips ?? '?'} clips${walks ? '' : ', NO WALK/RUN/IDLE CLIPS (the game falls back to the single model)'}${jkaCount ? `, ${jkaCount} Jedi Academy clips` : ''}`);
      if (!walks && !partsManifest.clips) console.log('  (an older parts.json does not list its clips; re-run parts to be sure)');
      if (!walks) need(`parts <swg-dir> ${dir} --retail-only`, 'the parts rig lacks the named idle, walk and run clips');
      const partsLacks = lacking([...clipNames]);
      if (partsLacks.length) {
        console.log(`  parts clips missing: ${partsLacks.join(', ')} (the game plays the parts rig, so the player's clips do not reach it until parts is rerun)`);
        need(`parts <swg-dir> ${dir} --retail-only`, `the parts rig lacks the ${partsLacks.join(', ')} clips`);
      }
      if (playerJka && jkaCount < playerJka) need(`clips-save ${join(dir, p.file)} ${join(dir, 'player', 'jka.clips')} --only=BOTH_ && clips-apply ${join(dir, 'characters', p.id, 'rig.glb')} ${join(dir, 'player', 'jka.clips')}`, `the parts rig has ${jkaCount} of the player's ${playerJka} Jedi Academy clips`);
    }
  }
  const weapons = readJson(join(dir, 'weapons/manifest.json'));
  if (!weapons) {
    console.log('  weapons: none (the placeholder saber and rifle are used)');
    need(`weapons <swg-dir> ${dir} --retail-only`, 'no weapons converted for the rack (I in game, the Weapons tab)');
  } else console.log(`  weapons: ${weapons.weapons?.length ?? 0} on the rack, ${weapons.skipped?.length ?? 0} left out`);
  const speciesIndex = readJson(join(dir, 'characters/index.json'));
  if (speciesIndex?.species?.length) console.log(`  species: ${speciesIndex.species.map((sp) => `${sp.id} (${sp.morphs.length} sliders, ${sp.variables.length} variables${sp.jkaClips ? '' : ', NO Jedi Academy clips'})`).join(', ')}`);
  else need(`species <swg-dir> ${dir} --retail-only`, 'no species index: only the one character can be played');
  const ships = readJson(join(dir, 'ships/manifest.json'));
  if (!ships) need(`ships <swg-dir> ${dir} --retail-only`, 'no ships converted for the garage (B in game, at the bottom)');
  else console.log(`  ships: ${ships.ships.length} ships, ${ships.ships.filter((sh) => sh.interior && !sh.interior.failed).length} with an interior, ${ships.skipped.length} left out`);
  if (!todo.size) {
    console.log(`everything is in place: ${planets} planet packs, creatures and player`);
    return;
  }

  console.log('\nto fill the gaps (replace <swg-dir> with your SWG folder):');
  for (const [cmd, whys] of todo) console.log(`  npm run swg -- ${cmd}\n      ${whys.length > 4 ? `${whys.slice(0, 3).join('; ')}; and ${whys.length - 3} more` : whys.join('; ')}`);
}

/** Names of the world snapshots the archives hold (snapshot/<name>.ws). */
function snapshotPlanets(vfs) {
  const names = new Set(vfs.list('snapshot/').filter((n) => n.endsWith('.ws')).map((n) => basename(n, '.ws')));
  // Expansion planets have no snapshot, only buildout tables (and a terrain).
  for (const n of vfs.list('datatables/buildout/areas_')) {
    const planet = basename(n, '.iff').replace(/^areas_/, '');
    if (vfs.has(`terrain/${planet}.trn`)) names.add(planet);
  }
  return [...names].sort();
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
    const { snap, entries, snapshotCount, buildout, spawns, core3 } = loadPlanetObjects(vfs, planet);
    console.error(`${wsPath}: ${snapshotCount} top-level objects, ${entries.length} including contained and buildouts, ${snap.templates.length} templates`);
    if (spawns) {
      const st = spawns.stats;
      console.error(`server spawns (${core3}): ${st.objects} static objects placed, ${st.mobiles} creature and NPC spawns noted for spawns.json (${st.inCells + st.mobilesInCells} inside building cells skipped) from ${st.files} scripts`);
      const names = [...new Set(spawns.mobiles.map((m) => m.name))];
      const defs = mobileTemplates(core3, names);
      const list = spawns.mobiles.map((m) => ({ name: m.name, x: m.pos[0], y: m.pos[1], z: m.pos[2], heading: Math.round(m.heading * 1000) / 1000, respawn: m.respawn, templates: defs.get(m.name)?.templates ?? [], label: defs.get(m.name)?.objectName ?? m.name }));
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, 'spawns.json'), JSON.stringify({ planet, source: 'core3', mobiles: list }));
    }
    console.error(`buildouts: ${buildout.objects} objects in ${buildout.areas} areas${buildout.eventAreas ? `, ${buildout.eventAreas} event-only areas skipped` : ''}${buildout.computedTemplates ? `, ${buildout.computedTemplates} rows named by hashing the archives' templates (the string table lacks them)` : ''}${buildout.unknownTemplates ? `, WARNING: ${buildout.unknownTemplates} rows with unknown templates (their objects are missing)` : ''}${buildout.missingTables ? `, ${buildout.missingTables} area tables missing` : ''}`);
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
      if (r.skeletal) {
        // Creatures and NPCs are the server's to spawn and animate; other skeletal things (the
        // Sarlacc, animated banners) are baked at their bind pose as static props.
        if (/^object\/(mobile|creature)\//i.test(template)) {
          skip('creature or NPC (skeletal, spawned by the server)', template);
          continue;
        }
        const sid = familyOf(r.skeletal);
        if (!models.has(sid)) {
          if (models.size >= max) break;
          try {
            const info = convertSat(vfs, r.skeletal, join(outDir, `${sid}.glb`), { animations: 'none' });
            const tris = info.meshes.reduce((a, m) => a + m.triangles, 0);
            models.set(sid, { id: sid, source: r.skeletal, file: `${sid}.glb`, bounds: info.bounds ?? { min: [-1, 0, -1], max: [1, 2, 1] }, triangles: tris, textured: info.meshes.length, shaders: info.meshes.reduce((a, m) => a + m.shaders, 0), parts: 1, skeletal: true });
            console.error(`  ${sid}: ${tris} tris, skeletal appearance baked at its bind pose`);
          } catch (err) {
            models.set(sid, { failed: err.message });
          }
        }
        const model = models.get(sid);
        if (!model || model.failed) {
          skip(`skeletal convert failed: ${model?.failed ?? 'unknown'}`, template);
          continue;
        }
        objects.push({ template, model: sid, x: e.world.pos[0], y: e.world.pos[1], z: e.world.pos[2], q: e.world.q, radius: n.radius, contained: e.parentId !== 0 });
        continue;
      }
      if (r.particle) {
        // A particle effect on its own (smoke, sparks, a campfire's flames): the pack keeps its
        // description and textures, and the game plays it where the snapshot places it.
        const p = convertParticle(vfs, r.particle, outDir);
        if (p.failed) {
          skip(`particle convert failed: ${p.failed}`, template);
          continue;
        }
        if (!models.has(p.id)) models.set(p.id, { ...p, source: r.source ?? r.appearance });
        objects.push({ template, model: p.id, x: e.world.pos[0], y: e.world.pos[1], z: e.world.pos[2], q: e.world.q, radius: Math.max(n.radius, p.bounds.max[0]), contained: e.parentId !== 0 });
        continue;
      }
      const single = r.parts.length === 1 && !r.parts[0].transform && !r.effects?.length;
      const id = familyOf(single ? r.parts[0].mesh : r.appearance);
      if (!models.has(id)) {
        if (models.size >= max) break;
        try {
          const conv = convertOne(vfs, single ? r.parts[0].mesh : r.appearance, join(outDir, `${id}.glb`));
          const b = conv.mesh.bounds ?? { min: [0, 0, 0], max: [0, 0, 0] };
          const bounds = conv.flipX ? { min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] } : b;
          const effects = attachedEffects(vfs, conv.effects, outDir);
          models.set(id, { id, source: r.source ?? r.appearance, file: `${id}.glb`, bounds, triangles: conv.tris, textured: conv.textured, shaders: conv.shaders.length, parts: conv.partCount, ...(conv.cells ? { cells: conv.cells, portals: conv.portals ?? [] } : {}), ...(effects.length ? { effects } : {}) });
          console.error(`  ${id}: ${conv.tris} tris, ${conv.textured}/${conv.shaders.length} textured${conv.partCount > 1 ? `, ${conv.partCount} parts` : ''}${effects.length ? `, ${effects.length} attached particle effect(s)` : ''}`);
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
    const fx = manifest.categories.layout.filter((m) => m.particle);
    const attached = manifest.categories.layout.reduce((n, m) => n + (m.effects?.length ?? 0), 0);
    console.log(`layout: ${objects.length} objects, ${manifest.categories.layout.length} models -> ${join(outDir, 'layout.json')}`);
    if (fx.length || attached) console.log(`particles: ${fx.length} effects placed on their own (${objects.filter((o) => fx.some((m) => m.id === o.model)).length} placements), ${attached} attached to models, ${particleTextures.size} textures`);
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
  case 'ash': {
    // <swg-dir> <appearance/x.sat | object/.../shared_x.iff | appearance/ash/x.ash>: the animation state
    // hierarchy behind a skeletal appearance, every state with the strings it carries, for reading how
    // the game picks its loops (a pistol's combat stance) from names the logical table alone does not show.
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    let file = pos[2].replace(/\\/g, '/');
    if (/\.iff$/i.test(file)) {
      const a = resolveTemplateString(vfs, file, ['appearanceFilename'], new Map());
      if (!a) throw new Error(`${file}: no appearanceFilename in its template chain`);
      file = a.replace(/\\/g, '/').replace(/^\//, '');
    }
    let latNames = null;
    if (/\.sat$/i.test(file)) {
      const sat = parseSat(readIff(vfs, file));
      const latFile = sat.animationTables.get(sat.skeletons[0]?.file.toLowerCase()) ?? [...sat.animationTables.values()][0];
      const lat = parseLat(readIff(vfs, latFile));
      latNames = new Set(lat.logical.map((n) => n.toLowerCase()));
      console.log(`${file}: logical table ${latFile} (${lat.logical.length} logical names read of the ${lat.count} it declares, ${lat.entries.length} clips once the selectors are unwrapped), hierarchy ${lat.hierarchy}`);
      file = lat.hierarchy.replace(/\\/g, '/').replace(/^\//, '');
    }
    if (!vfs.has(file)) throw new Error(`${file}: not in the archives`);
    const strings = (data) => {
      const out = [];
      let cur = '';
      for (const b of data) {
        if (b >= 0x20 && b < 0x7f) cur += String.fromCharCode(b);
        else {
          if (cur.length >= 3) out.push(cur);
          cur = '';
        }
      }
      if (cur.length >= 3) out.push(cur);
      return out;
    };
    const walk = (node, depth, lines) => {
      const pad = '  '.repeat(depth);
      if (isForm(node)) {
        lines.push(`${pad}FORM ${node.type}`);
        for (const c of node.children) walk(c, depth + 1, lines);
      } else {
        const str = strings(node.data);
        const nums = node.data.length <= 16 ? ` [${[...node.data].map((b) => b.toString(16).padStart(2, '0')).join(' ')}]` : '';
        lines.push(`${pad}${node.tag} (${node.data.length} bytes)${str.length ? ` ${str.join(' | ')}` : nums}`);
      }
      return lines;
    };
    const root = parseIff(vfs.read(file));
    // The states, each with its idle's logical name, its actions and its links, and which of the
    // logical names the table lacks: those the game cannot play from this table.
    if (latNames) {
      const states = [];
      const missing = new Map();
      const known = (n) => latNames.has(n.toLowerCase());
      const note = (n, where) => { if (!known(n)) missing.set(n, (missing.get(n) ?? []).concat(where)); };
      const visit = (node, path) => {
        if (!isForm(node)) return;
        if (node.type === 'STAT') {
          const info = node.children.find((c) => !isForm(c) && c.tag === 'INFO');
          const [name, idle] = info ? strings(info.data) : ['?'];
          const here = [...path, name ?? '?'];
          const state = { path: here.join('/'), idle: idle ?? null, actions: [], links: [] };
          for (const c of node.children) {
            if (!isForm(c)) continue;
            if (c.type === 'ACTS') {
              const acts = (f) => { for (const a of f.children) { if (isForm(a)) acts(a); else if (a.tag === 'ACTN') { const [act, logical] = strings(a.data); state.actions.push(`${act}=${logical ?? '?'}`); if (logical) note(logical, `${state.path} action ${act}`); } } };
              acts(c);
            } else if (c.type === 'LNKS') {
              for (const l of c.children) if (!isForm(l) && l.tag === 'LINK') { const parts = strings(l.data); const last = parts[parts.length - 1]; const trn = parts.length > 1 && /^(trn_|rea_|add_|loop_)|_to_/.test(last) ? last : null; state.links.push(`${(trn ? parts.slice(0, -1) : parts).join('/')}${trn ? ` via ${trn}` : ''}`); if (trn) note(trn, `${state.path} link`); }
            } else if (c.type === 'CHLD') for (const child of c.children) visit(child, here);
          }
          if (idle) note(idle, `${state.path} idle`);
          states.push(state);
          return;
        }
        for (const c of node.children) visit(c, path);
      };
      visit(root, []);
      const find = options.find ? String(options.find).toLowerCase() : null;
      const shown = find ? states.filter((st) => st.path.toLowerCase().includes(find)) : states;
      console.log(`${file}: ${states.length} states${find ? `, ${shown.length} under "${find}"` : ''}`);
      for (const st of shown) {
        console.log(`${st.path}: idle ${st.idle ?? '(none)'}${st.idle && !known(st.idle) ? ' [NOT IN TABLE]' : ''}`);
        if (st.actions.length) console.log(`    actions: ${st.actions.map((a) => (known(a.split('=')[1]) ? a : `${a} [NOT IN TABLE]`)).join(', ')}`);
        if (st.links.length) console.log(`    links: ${st.links.join(', ')}`);
      }
      const relevant = [...missing.entries()].filter(([, w]) => !find || w.some((x) => x.toLowerCase().includes(find)));
      console.log(`\n${relevant.length} logical names the hierarchy uses that the table lacks${find ? ` (under "${find}")` : ''}:`);
      for (const [n, w] of relevant) console.log(`  ${n}  (${w.length} uses, e.g. ${w[0]})`);
      break;
    }
    const lines = walk(root, 0, []);
    const find = options.find ? String(options.find).toLowerCase() : null;
    console.log(`${file}: ${lines.length} lines${find ? `, those with "${find}" and their forms` : ''}`);
    if (!find) console.log(lines.join('\n'));
    else {
      const stack = [];
      for (const line of lines) {
        const depth = line.search(/\S/) / 2;
        stack.length = depth;
        stack[depth] = line;
        if (line.toLowerCase().includes(find)) {
          for (let d = 0; d <= depth; d++) if (stack[d] && !stack[d].printed) { console.log(stack[d]); stack[d] = Object.assign(new String(stack[d]), { printed: true }); }
        }
      }
    }
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
  case 'loading': {
    // <swg-dir> <out-dir> [--match=...] [--list]: the client's loading-screen pictures, one per
    // planet, found by name among the UI textures (the archives name them after the planet), as
    // PNGs the game's loading screen colours in as the world arrives.
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const match = options.match ? new RegExp(options.match, 'i') : /ui_(load|loading)|load(ing)?_?screen|loadscreen/i;
    const candidates = vfs.list('texture/').filter((n) => /\.dds$/i.test(n) && match.test(n));
    if (options.list || !candidates.length) {
      console.log(candidates.length ? `${candidates.length} loading-screen textures:` : `no texture matches ${match}; every UI texture with "load" in its name:`);
      for (const n of candidates.length ? candidates : vfs.list('texture/').filter((n) => /load/i.test(n))) console.log(`  ${n}`);
      if (!candidates.length) console.log('pick a pattern from these and run again with --match=<pattern>');
      if (options.list) break;
    }
    const outDir = join(pos[2], 'loading');
    mkdirSync(outDir, { recursive: true });
    const planets = [['tatooine', /tatooine|tat\b/], ['naboo', /naboo/], ['corellia', /corellia|corel/], ['dantooine', /dantooine|dant/], ['lok', /\blok|_lok/], ['endor', /endor/], ['dathomir', /dathomir|dath/], ['yavin4', /yavin/], ['talus', /talus/], ['rori', /rori/], ['mustafar', /mustafar|must/], ['kashyyyk', /kashyyyk|kash/]];
    const index = {};
    for (const [id, re] of planets) {
      // The largest matching texture: the client keeps a small and a large of some.
      const hits = candidates.filter((n) => re.test(basename(n)));
      if (!hits.length) continue;
      let best = null;
      for (const n of hits) {
        try {
          const dds = decodeDds(vfs.read(n));
          if (!best || dds.width * dds.height > best.dds.width * best.dds.height) best = { name: n, dds };
        } catch (err) {
          console.log(`  ${n}: ${err.message}`);
        }
      }
      if (!best) continue;
      const img = downscaleRgba(best.dds, 2048);
      // Loading screens have no transparency: whatever the alpha holds is not for the picture.
      for (let i = 3; i < img.rgba.length; i += 4) img.rgba[i] = 255;
      writeFileSync(join(outDir, `${id}.png`), encodePng(img.width, img.height, img.rgba));
      index[id] = { file: `${id}.png`, source: best.name, width: img.width, height: img.height };
      console.log(`  ${id.padEnd(10)} <- ${best.name} (${best.dds.width}x${best.dds.height}${hits.length > 1 ? `, of ${hits.length}` : ''})`);
    }
    writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 2));
    const missing = planets.map(([id]) => id).filter((id) => !index[id]);
    console.log(`-> ${outDir}: ${Object.keys(index).length} planets${missing.length ? `; none found for ${missing.join(', ')} (the game draws its own)` : ''}`);
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
      const events = buildout.eventList?.length ? `; event-only areas: ${buildout.eventList.map((e) => `${e.area} (${e.rows} rows, "${e.event}")`).join(', ')}` : '';
      console.log(`${planet.padEnd(12)} ${String(snap.nodes.length).padStart(6)} objects (${buildout.objects} from buildouts), terrain ${vfs.has(`terrain/${planet}.trn`) ? 'yes' : 'no '}, centre ${centre.x.toFixed(0)},${centre.z.toFixed(0)} (${centre.why})${known ? '' : '  [not a planet in the game]'}${events}`);
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
    const fmt = (v) => v.map((x) => (Number.isFinite(x) ? x.toFixed(2) : String(x))).join(' ');
    if (info.bounds) console.log(`  bounds (x mirrored): min ${fmt(info.bounds.min)}, max ${fmt(info.bounds.max)}`);
    for (const e of info.meshExtents ?? []) console.log(`  extent ${e.file}: ${e.vertices} vertices, min ${fmt(e.min)}, max ${fmt(e.max)}`);
    if (info.jointExtent) console.log(`  joints: bind translations within ${fmt(info.jointExtent.min)} to ${fmt(info.jointExtent.max)}; root ${info.rootJoint}`);
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
    const wear = options.wear === undefined ? DEFAULT_WEAR : options.wear === 'none' ? [] : options.wear.split(',').map((w) => w.trim()).filter(Boolean);
    // --jka=<Jedi Academy GameData or base folder>: its saber attacks, jumps and rolls retargeted onto this skeleton.
    let jka = null;
    const extraClips = options.jka
      ? (joints, info) => {
          const wanted = options['jka-anims'] ? options['jka-anims'].split(',').map((a) => a.trim().toUpperCase()).filter(Boolean) : defaultJkaClips();
          const r = importJkaClips(options.jka, joints, wanted, { log: (m) => console.log(`  jka: ${m}`) });
          jka = r.info;
          info.jkaClips = Object.fromEntries(r.clips.map((c) => [c.name, { loop: c.loop, fps: c.fps, frames: c.frames, ...(c.speed ? { speed: c.speed } : {}) }]));
          for (const c of r.clips) if (c.speed) (info.clipSpeeds ??= {})[c.name] = c.speed;
          if (r.info.grip) info.jkaGrip = r.info.grip;
          return r.clips;
        }
      : null;
    const info = convertSat(vfs, template, join(outDir, `${id}.glb`), { animations: options.anim ?? PLAYER_CLIPS, variables: customizationValues(options.var), wear, maxAnimations: options['max-anims'] ? Number(options['max-anims']) : 240, extraClips });
    console.log(`${info.sat}: skeleton ${info.skeleton} (${info.joints} joints${info.attached.length ? `, with ${info.attached.join('; ')}` : ''})`);
    if (jka) console.log(`  jka: ${Object.keys(info.jkaClips).length} clips retargeted${jka.missing.length ? `; not in animation.cfg: ${jka.missing.join(', ')}` : ''}`);
    if (jka) console.log(`  jka: locomotion speeds from the feet: ${Object.entries(info.jkaClips).filter(([, c]) => c.speed).map(([n, c]) => `${n} ${c.speed.toFixed(2)} m/s`).join(', ') || 'none'}`);
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
    {
      const wantedGun = ['loop_pistol_combat_standing_aimed', 'pistol_combat_standing_fire_1', 'loop_pistol_combat_kneeling_aimed', 'loop_rifle_a_combat_standing_aimed', 'rifle_standing_aimed_fire_1', 'loop_rifle_kneeling_combat_aimed'];
      const have = new Set(info.animations.map((n) => n.split(':')[0]));
      const lacking = wantedGun.filter((n) => !have.has(n));
      if (lacking.length) console.log(`  the animation table in these archives lacks ${lacking.join(', ')}: the blaster's combat stances and hip shots the state hierarchy names. The retail table has 870 logical names, the Legends one 908; convert without --retail-only to take them from the Legends table (the clips themselves are the game's own files; nothing leaves assets-private).`);
    }
    const entry = { id, file: `player/${id}.glb`, template, wear, variables: Object.fromEntries(customizationValues(options.var)), clips: info.animations, clipSpeeds: info.clipSpeeds ?? {}, ...(info.partialClips ? { partialClips: info.partialClips } : {}), bounds: info.bounds, scale: 1, ...(info.jkaClips ? { jkaClips: info.jkaClips } : {}), ...(info.jkaGrip ? { jkaGrip: info.jkaGrip } : {}) };
    if (!info.jkaClips && existsSync(join(outDir, 'manifest.json'))) {
      const before = (JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')).players ?? []).find((e) => e.id === id);
      const had = Object.keys(before?.jkaClips ?? {}).length;
      if (had) console.log(`\n  WARNING: the previous conversion carried ${had} Jedi Academy clips (saber swings, jumps, rolls) and this one has none.\n  Re-run with --jka=<Jedi Academy GameData or base folder> (@JKA), then parts, clips-save and clips-apply, or the game loses them.\n`);
    }
    manifest.players = [entry, ...(manifest.players ?? []).filter((p) => p.id !== id)];
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
    console.log(`-> ${join(outDir, `${id}.glb`)} and ${manifestFile}; the game uses the first entry`);
    printEffectSummary();
    break;
  }

  case 'wardrobe': {
    // <swg-dir> <out-dir> [--gender=male|female] [--kind=wearables,hair] [--match=armor] [--limit=N]
    // Every wearable and hairstyle built for the humanoid skeleton, as parts a character can put on.
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const gender = (options.gender ?? 'male').toLowerCase().startsWith('f') ? 'f' : 'm';
    const kinds = (options.kind ?? 'wearables,hair').split(',').map((k) => k.trim()).filter(Boolean);
    const match = options.match ? new RegExp(options.match, 'i') : null;
    const limit = options.limit ? Number(options.limit) : Infinity;
    const template = (options.template ?? PLAYER_TEMPLATE).replace(/\\/g, '/');
    // The wardrobe is per gender: human_male, human_female (the --gender wins over the template's own).
    const speciesId = basename(template).replace(/^shared_/, '').replace(/\.[^.]+$/, '').replace(/_(male|female)$/, gender === 'f' ? '_female' : '_male');
    const outDir = join(pos[2], 'wardrobe', speciesId);
    mkdirSync(outDir, { recursive: true });

    // The species' merged skeleton: everything worn has to be weighted to these joints.
    const speciesSat = parseSat(readIff(vfs, resolveTemplateString(vfs, template, ['appearanceFilename'], new Map()).replace(/\\/g, '/').replace(/^\//, '')));
    const loadSkeleton = (file) => parseSkeleton(readIff(vfs, file), (f) => (vfs.has(f) ? readIff(vfs, f) : null));
    const baseSkeletonFile = speciesSat.skeletons[0].file;
    const extraSkeletons = speciesSat.skeletons.slice(1).filter((k) => vfs.has(k.file)).map((k) => ({ skeleton: loadSkeleton(k.file), attachTo: k.attachTo, file: k.file }));
    const skeleton = mergeSkeletons(loadSkeleton(baseSkeletonFile), extraSkeletons);
    const skin = skinData(skeleton, [], { flipX: true });
    const allowed = new Set([baseSkeletonFile.toLowerCase(), ...extraSkeletons.map((e) => e.file.toLowerCase())]);

    const templates = [...vfs.list()].filter((n) => kinds.some((k) => new RegExp(`^object/tangible/${k}/.*/shared_.*\\.iff$`).test(n))).sort();
    const ctx = renderContext(customizationValues(options.var));
    const catalogue = [];
    const failed = [];
    // The live recipes for the items whose look a colour changes (a shirt's palette factors, a
    // hairstyle's colour), one per material and mesh, with their images beside them.
    const recipes = [];
    const recipeKeys = new Set();
    const registry = new ImageRegistry((id, bytes) => {
      mkdirSync(join(outDir, 'customize'), { recursive: true });
      writeFileSync(join(outDir, 'customize', id), bytes);
    });
    let done = 0;
    for (const tpl of templates) {
      if (done >= limit) break;
      const id = basename(tpl).replace(/^shared_/, '').replace(/\.[^.]+$/, '');
      if (match && !match.test(tpl)) continue;
      try {
        let satPath = resolveTemplateString(vfs, tpl, ['appearanceFilename'], new Map());
        if (!satPath) throw new Error('no appearance in its template chain');
        satPath = satPath.replace(/\\/g, '/').replace(/^\//, '');
        // A template names one gender's appearance; the client swaps the suffix for the other.
        // Take the wearer's if it exists, and note when only the other was authored.
        const wanted = satPath.replace(/_[fm](\.sat)$/i, `_${gender}$1`);
        let usedOtherGender = false;
        if (wanted !== satPath && vfs.has(wanted)) satPath = wanted;
        else if (/_[fm]\.sat$/i.test(satPath) && !satPath.toLowerCase().endsWith(`_${gender}.sat`)) usedOtherGender = true;
        if (!vfs.has(satPath)) throw new Error(`${satPath} not in archives`);
        const sat = parseSat(readIff(vfs, satPath));
        if (!sat.skeletons.some((k) => allowed.has(k.file.toLowerCase()))) throw new Error(`built for ${sat.skeletons.map((k) => basename(k.file)).join(', ') || 'no skeleton'}`);
        const entries = [];
        // The item's variables (a shirt's colour 1 and 2), noted per mesh as its shaders are read.
        const info = { missing: [], skipped: [], customization: new Set(), variables: new Map(), textureRenderers: [], shaderNotes: new Set() };
        for (let name of sat.meshes) {
          if (/\.lmg$/i.test(name)) {
            if (!vfs.has(name)) continue;
            const lods = parseLmg(readIff(vfs, name));
            name = lods.find((l) => vfs.has(l)) ?? lods[0];
          }
          if (!name || !vfs.has(name)) continue;
          const mgn = parseMgn(readIff(vfs, name));
          const { groups } = skinnedPrimitives(mgn, skeleton);
          const meshName = basename(name).replace(/\.[^.]+$/, '');
          const textures = new Map();
          const kept = [];
          for (const g of groups) {
            if (!g.primitives[0].indices.length) continue;
            const t = skinnedTexture(vfs, g.shader, null, ctx, info, meshName);
            if (t) textures.set(g.shader, t);
            kept.push(g);
            const rkey = `${g.shader}|${meshName}`;
            if (!recipeKeys.has(rkey)) {
              try {
                const shader = loadShader(vfs, g.shader, ctx);
                if (shader?.effect && shaderNeedsBake(shader)) {
                  recipeKeys.add(rkey);
                  recipes.push({ mesh: meshName, material: g.shader, kind: 'bake', baseTag: 'MAIN', shader: exportShader(shader, registry, (f) => loadImage(vfs, f, ctx.images)), slots: [] });
                }
              } catch (err) {
                info.skipped.push(`${g.shader}: no live recipe (${err.message})`);
              }
            }
          }
          if (!kept.length) continue;
          const file = `${meshName}.glb`;
          writeFileSync(join(outDir, file), buildGlb([{ name: meshName, groups: kept, extras: { occlusionLayer: mgn.occlusionLayer, occludes: mgn.occludes, zoneNames: mgn.occlusionZones, zoneCombinations: mgn.zoneCombinations, fullyOccludedBy: mgn.fullyOccludedBy } }], { flipX: true, textures, skin, keepZones: true }));
          entries.push({
            name: meshName,
            file,
            bytes: statSync(join(outDir, file)).size,
            triangles: kept.reduce((a, g) => a + g.primitives[0].indices.length / 3, 0),
            occlusionLayer: mgn.occlusionLayer,
            occludes: mgn.occludes,
            zoneNames: mgn.occlusionZones,
            zoneCombinations: mgn.zoneCombinations,
            fullyOccludedBy: mgn.fullyOccludedBy,
            morphs: mgn.blendTargets.map((b) => b.name),
          });
        }
        if (!entries.length) throw new Error('no mesh survived');
        catalogue.push({ id, template: tpl, kind: tpl.split('/')[2], sat: satPath, gender: usedOtherGender ? (gender === 'm' ? 'f' : 'm') : gender, parts: entries, variables: customizationList(vfs, info) });
        done++;
        if (done % 50 === 0) console.log(`  ${done} converted...`);
      } catch (err) {
        failed.push(`${id}: ${err.message}`);
      }
    }
    const bytes = catalogue.reduce((a, c) => a + c.parts.reduce((b, p) => b + p.bytes, 0), 0);
    writeFileSync(join(outDir, 'wardrobe.json'), JSON.stringify({ species: speciesId, gender, skeleton: baseSkeletonFile, items: catalogue }, null, 2));
    if (recipes.length) {
      const palettes = exportPalettes(vfs, recipes.flatMap((r) => palettesOf(r)));
      writeFileSync(join(outDir, 'customize.json'), JSON.stringify({ images: 'customize/', recipes, palettes }, null, 1));
    }
    console.log(`-> ${outDir}: ${catalogue.length} items, ${catalogue.reduce((a, c) => a + c.parts.length, 0)} meshes, ${(bytes / 1e6).toFixed(1)} MB${recipes.length ? `; ${recipes.length} live colour recipes over ${registry.ids.size} images` : ''}`);
    const withMorphs = catalogue.filter((c) => c.parts.some((p) => p.morphs.length)).length;
    const otherGender = catalogue.filter((c) => c.gender !== gender).length;
    console.log(`   ${withMorphs} carry body-shape morphs; ${otherGender} exist only in the other gender's mesh`);
    if (failed.length) {
      // The reasons, most common first, so a bug that fails every item shows as one line rather than hiding behind the usual few.
      const reasons = new Map();
      for (const f of failed) {
        const why = f.replace(/^[^:]*: /, '').replace(/[a-z0-9_/.]+\.(sat|iff|mgn|lmg|sht)/gi, '…');
        reasons.set(why, (reasons.get(why) ?? 0) + 1);
      }
      console.log(`   ${failed.length} skipped: ${[...reasons].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([why, n]) => `${n} × ${why}`).join('; ')}`);
    }
    break;
  }

  case 'parts': {
    // <swg-dir> <out-dir> [--template=...] [--wear=...]: body, head and each worn item as its own
    // GLB against one shared skeleton, with the occlusion zones left for the game to apply.
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const template = (options.template ?? PLAYER_TEMPLATE).replace(/\\/g, '/');
    const wear = options.wear === undefined ? DEFAULT_WEAR : options.wear === 'none' ? [] : options.wear.split(',').map((w) => w.trim()).filter(Boolean);
    convertParts(vfs, pos[2], template, { wear, variables: customizationValues(options.var), anim: options.anim, maxAnims: options['max-anims'] });
    writeSpeciesIndex(pos[2]);
    break;
  }

  case 'species': {
    // <swg-dir> <out-dir> [--only=human,twilek_female] [--wear=...] [--var=...]: every playable species and
    // gender (object/creature/player/shared_<species>_<gender>.iff) as a parts pack, the Jedi Academy
    // clip bundle applied to each rig when the player has one, and characters/index.json listing them
    // with their customization variables (palette colours, index ranges) and shape sliders.
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const only = options.only ? options.only.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) : null;
    const templates = [...vfs.list('object/creature/player/')].filter((n) => /\/shared_[a-z_]+_(male|female)\.iff$/i.test(n)).sort();
    const picked = templates.filter((t) => !only || only.some((o) => basename(t).toLowerCase().includes(o)));
    if (!picked.length) {
      console.log(`no player species templates${only ? ` matching ${only.join(', ')}` : ''}; the archives hold: ${templates.map((t) => basename(t)).join(', ') || 'none'}`);
      break;
    }
    const wear = options.wear === undefined ? DEFAULT_WEAR : options.wear === 'none' ? [] : options.wear.split(',').map((w) => w.trim()).filter(Boolean);
    const bundle = join(pos[2], 'player', 'jka.clips');
    const done = [];
    const failed = [];
    for (const template of picked) {
      const id = basename(template).replace(/^shared_/, '').replace(/\.[^.]+$/, '');
      console.log(`\n${id} (${template})`);
      try {
        const r = convertParts(vfs, pos[2], template, { wear, variables: customizationValues(options.var), anim: options.anim, maxAnims: options['max-anims'] });
        if (existsSync(bundle)) {
          const n = applyBundleToRig(join(r.outDir, 'rig.glb'), bundle);
          if (n) console.log(`   ${n} Jedi Academy clips applied from ${bundle}`);
        } else console.log('   no player/jka.clips bundle to apply: run the player command with --jka and clips-save first for the saber, jump and roll clips');
        done.push(id);
      } catch (err) {
        failed.push(`${id}: ${err.message}`);
        console.log(`   failed: ${err.message}`);
      }
    }
    const index = writeSpeciesIndex(pos[2]);
    console.log(`\n-> ${join(pos[2], 'characters', 'index.json')}: ${index.species.length} characters (${done.length} converted now${failed.length ? `, ${failed.length} failed: ${failed.join('; ')}` : ''})`);
    for (const sp of index.species) console.log(`   ${sp.id.padEnd(22)} ${sp.parts} parts, ${sp.morphs.length} shape sliders, ${sp.variables.filter((v) => v.kind === 'palette').length} colour palettes, ${sp.variables.filter((v) => v.kind === 'index').length} choices, ${sp.jkaClips} Jedi Academy clips${sp.wardrobe ? `, wardrobe ${sp.wardrobe}` : ''}`);
    break;
  }

  case 'clips-save': {
    // <model.glb> <out.clips> [--only=BOTH_,TORSO_]: lift a model's animations out into a bundle
    if (!pos[2]) usage();
    const buf = readFileSync(pos[1]);
    const prefixes = options.only ? options.only.split(',').map((x) => x.trim()).filter(Boolean) : null;
    const keep = prefixes ? (name) => prefixes.some((p) => name.toUpperCase().startsWith(p.toUpperCase())) : () => true;
    const bundle = extractClips(buf, keep);
    if (!bundle.clips.length) throw new Error(`${pos[1]} has no animations matching ${prefixes ? prefixes.join(', ') : 'anything'}`);
    // A GLB cannot say whether a clip loops or how fast it plays; the manifest beside it can,
    // and that is exactly the part a re-conversion would otherwise throw away.
    const srcManifest = join(dirname(pos[1]), 'manifest.json');
    if (existsSync(srcManifest)) {
      const m = JSON.parse(readFileSync(srcManifest, 'utf8'));
      const entry = (m.players ?? []).find((e) => basename(e.file) === basename(pos[1]));
      if (entry) {
        const names = new Set(bundle.clips.map((c) => c.name));
        bundle.meta = {
          jkaClips: Object.fromEntries(Object.entries(entry.jkaClips ?? {}).filter(([n]) => names.has(n))),
          clipSpeeds: Object.fromEntries(Object.entries(entry.clipSpeeds ?? {}).filter(([n]) => names.has(n))),
          scale: entry.scale,
          ...(entry.jkaGrip ? { grip: entry.jkaGrip } : {}),
        };
      }
    }
    const packed = packClips(bundle);
    writeFileSync(pos[2], packed);
    if (bundle.meta) console.log(`   carrying ${Object.keys(bundle.meta.jkaClips).length} Jedi Academy loop flags and ${Object.keys(bundle.meta.clipSpeeds).length} clip speeds`);
    const frames = bundle.clips.reduce((n, c) => n + c.times.length, 0);
    console.log(`-> ${pos[2]}: ${bundle.clips.length} clips, ${frames} frames, ${bundle.joints.length} joints, ${(packed.length / 1e6).toFixed(1)} MB`);
    console.log(`   ${bundle.clips.slice(0, 6).map((c) => c.name).join(', ')}${bundle.clips.length > 6 ? ', ...' : ''}`);
    break;
  }

  case 'clips-apply': {
    // <model.glb> <in.clips> [--drop=BOTH_]: put a bundle's animations onto a model, matching joints by name
    if (!pos[2]) usage();
    const glbFile = pos[1];
    const buf = readFileSync(glbFile);
    const { json } = readGlb(buf);
    const joints = skinJoints(json);
    const bundle = unpackClips(readFileSync(pos[2]));
    const { clips, missing } = retargetClips(bundle, joints);
    const prefixes = options.drop ? options.drop.split(',').map((x) => x.trim()).filter(Boolean) : null;
    const incoming = new Set(clips.map((c) => c.name));
    // Replace clips of the same name, and anything the caller names by prefix.
    const drop = (name) => incoming.has(name) || (prefixes ? prefixes.some((p) => name.toUpperCase().startsWith(p.toUpperCase())) : false);
    const backup = `${glbFile}.bak`;
    if (!existsSync(backup)) writeFileSync(backup, buf);
    writeFileSync(glbFile, replaceClips(buf, clips, drop));
    // Put the loop flags and speeds back on the manifest the game reads.
    let restored = '';
    // A parts rig keeps the same animation metadata, in its own manifest.
    const partsManifest = join(dirname(glbFile), 'parts.json');
    if (bundle.meta && existsSync(partsManifest)) {
      const m = JSON.parse(readFileSync(partsManifest, 'utf8'));
      const { json: after } = readGlb(readFileSync(glbFile));
      const present = new Set((after.animations ?? []).map((a) => a.name));
      m.rig = { ...(m.rig ?? {}), clips: present.size };
      m.jkaClips = Object.fromEntries(Object.entries(bundle.meta.jkaClips ?? {}).filter(([n]) => present.has(n)));
      m.clipSpeeds = { ...(m.clipSpeeds ?? {}), ...(bundle.meta.clipSpeeds ?? {}) };
      if (bundle.meta.scale !== undefined) m.scale = bundle.meta.scale;
      if (bundle.meta.grip) m.jkaGrip = bundle.meta.grip;
      writeFileSync(partsManifest, JSON.stringify(m, null, 2));
      restored = `; parts.json updated with ${Object.keys(m.jkaClips).length} loop flags`;
    }
    const outManifest = join(dirname(glbFile), 'manifest.json');
    if (bundle.meta && existsSync(outManifest)) {
      const m = JSON.parse(readFileSync(outManifest, 'utf8'));
      const entry = (m.players ?? []).find((e) => basename(e.file) === basename(glbFile));
      if (entry) {
        const { json: after } = readGlb(readFileSync(glbFile));
        const present = new Set((after.animations ?? []).map((a) => a.name));
        entry.clips = [...present];
        entry.jkaClips = { ...(entry.jkaClips ?? {}), ...Object.fromEntries(Object.entries(bundle.meta.jkaClips ?? {}).filter(([n]) => present.has(n))) };
        entry.clipSpeeds = { ...(entry.clipSpeeds ?? {}), ...(bundle.meta.clipSpeeds ?? {}) };
        if (bundle.meta.scale !== undefined) entry.scale = bundle.meta.scale;
        if (bundle.meta.grip) entry.jkaGrip = bundle.meta.grip;
        writeFileSync(outManifest, JSON.stringify(m, null, 2));
        restored = `; manifest updated with ${Object.keys(entry.jkaClips).length} loop flags`;
      }
    }
    console.log(`-> ${glbFile}: ${clips.length} clips applied${restored}${missing.length ? `; the bundle had no track for ${missing.length} joints (${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ', ...' : ''}), which hold their bind pose` : ''}`);
    break;
  }

  case 'jka-clips': {
    // <player.glb> <jka-dir|folder with _humanoid.gla + animation.cfg> [--jka-anims=...]: swap the GLB's Jedi Academy clips for freshly retargeted ones
    if (!pos[2]) usage();
    const glbFile = pos[1];
    const buf = readFileSync(glbFile);
    const { json } = readGlb(buf);
    const joints = skinJoints(json);
    const wanted = options['jka-anims'] ? options['jka-anims'].split(',').map((a) => a.trim().toUpperCase()).filter(Boolean) : defaultJkaClips();
    const r = importJkaClips(pos[2], joints, wanted, { log: (m) => console.log(`  jka: ${m}`) });
    const backup = `${glbFile}.bak`;
    if (!existsSync(backup)) writeFileSync(backup, buf);
    writeFileSync(glbFile, replaceClips(buf, r.clips, (name) => /^BOTH_/i.test(name)));
    const manifestFile = join(dirname(glbFile), 'manifest.json');
    if (existsSync(manifestFile)) {
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
      const entry = (manifest.players ?? []).find((p) => basename(p.file) === basename(glbFile));
      if (entry) {
        entry.clips = [...(entry.clips ?? []).filter((c) => !/^BOTH_/i.test(c)), ...r.clips.map((c) => c.name)];
        entry.jkaClips = Object.fromEntries(r.clips.map((c) => [c.name, { loop: c.loop, fps: c.fps, frames: c.frames, ...(c.speed ? { speed: c.speed } : {}) }]));
        entry.clipSpeeds = { ...(entry.clipSpeeds ?? {}), ...Object.fromEntries(r.clips.filter((c) => c.speed).map((c) => [c.name, c.speed])) };
        if (r.info.grip) entry.jkaGrip = r.info.grip;
        writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
      }
    }
    console.log(`-> ${glbFile}: ${r.clips.length} Jedi Academy clips${r.info.missing.length ? `; not in animation.cfg: ${r.info.missing.join(', ')}` : ''} (the previous file is kept as ${basename(backup)})`);
    break;
  }

  case 'weapons': {
    // <swg-dir> <out-dir> [--limit=N]: every weapon the game can hold, as models under <out-dir>/weapons
    // with a manifest naming each one's class (pistol, carbine, rifle, heavy, one-hand sword, knife,
    // two-hand sword, polearm, lightsaber); the kinds the game does not play yet are listed with why.
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const outDir = join(pos[2], 'weapons');
    mkdirSync(outDir, { recursive: true });
    const { buildWeapons, WEAPON_CLASSES } = await import('./weapons.mjs');
    const { galleryTemplates } = await import('./gallery.mjs');
    const models = new Map();
    const cache = new Map();
    const convert = (template) => {
      const r = resolveTemplateMesh(vfs, template, cache);
      if (r.skip) return { skip: r.skip };
      if (r.particle) return { skip: 'particle effect' };
      if (r.skeletal) return { skip: 'skeletal appearance' };
      const single = r.parts.length === 1 && !r.parts[0].transform && !r.effects?.length;
      const id = familyOf(single ? r.parts[0].mesh : r.appearance);
      if (!models.has(id)) {
        try {
          const conv = convertOne(vfs, single ? r.parts[0].mesh : r.appearance, join(outDir, `${id}.glb`));
          const b = conv.mesh.bounds ?? { min: [0, 0, 0], max: [0, 0, 0] };
          const bounds = conv.flipX ? { min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] } : b;
          models.set(id, { id, file: `${id}.glb`, bounds, triangles: conv.tris, textured: conv.textured, shaders: conv.shaders.length, ...(conv.tris ? {} : { failed: 'no triangles' }) });
        } catch (err) {
          models.set(id, { id, failed: err.message });
        }
      }
      const def = models.get(id);
      if (!def || def.failed) return { skip: def?.failed ?? 'failed' };
      return { model: id, file: def.file, bounds: def.bounds };
    };
    const limit = options.limit ? Number(options.limit) : Infinity;
    const { weapons, skipped } = buildWeapons(galleryTemplates(vfs, 'object/weapon/'), { convert }, { log: console.log, limit });
    const manifest = { classes: WEAPON_CLASSES, weapons, skipped };
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`-> ${outDir}: ${weapons.length} weapons in ${models.size} models, ${skipped.length} left out (listed in manifest.json; I in game opens the rack, the Weapons tab)`);
    const unknown = skipped.filter((s) => /unknown|melee kind/.test(s.why));
    if (unknown.length) console.log(`   kinds without a style yet:\n${unknown.map((s) => `     ${s.template}  (${s.why})`).join('\n')}`);
    printEffectSummary();
    break;
  }
  case 'ships': {
    // <swg-dir> <out-dir> [--limit=N]: every ship a player can fly (object/ship/player/), as models under
    // <out-dir>/ships with a manifest naming each one's class and, for the multi-crew ships, its interior
    // (the ship template's interiorLayoutFileName, a portal building converted alongside with its cells).
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const outDir = join(pos[2], 'ships');
    mkdirSync(outDir, { recursive: true });
    const { buildShips, SHIP_CLASSES } = await import('./ships.mjs');
    const { galleryTemplates } = await import('./gallery.mjs');
    const models = new Map();
    const cache = new Map();
    const convert = (template) => {
      const r = resolveTemplateMesh(vfs, template, cache);
      if (r.skip) return { skip: r.skip };
      if (r.particle) return { skip: 'particle effect' };
      if (r.skeletal) return { skip: 'skeletal appearance' };
      const single = r.parts.length === 1 && !r.parts[0].transform && !r.effects?.length;
      const id = familyOf(single ? r.parts[0].mesh : r.appearance);
      if (!models.has(id)) {
        try {
          const conv = convertOne(vfs, single ? r.parts[0].mesh : r.appearance, join(outDir, `${id}.glb`));
          const b = conv.mesh.bounds ?? { min: [0, 0, 0], max: [0, 0, 0] };
          const bounds = conv.flipX ? { min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] } : b;
          const effects = attachedEffects(vfs, conv.effects, outDir);
          models.set(id, { id, file: `${id}.glb`, bounds, triangles: conv.tris, textured: conv.textured, shaders: conv.shaders.length, parts: conv.partCount, ...(effects.length ? { effects } : {}), ...(conv.tris ? {} : { failed: 'no triangles' }) });
        } catch (err) {
          models.set(id, { id, failed: err.message });
        }
      }
      const def = models.get(id);
      if (!def || def.failed) return { skip: def?.failed ?? 'failed' };
      return { model: id, file: def.file, bounds: def.bounds };
    };
    const interiorOf = (template) => {
      const pob = resolveTemplateString(vfs, template, ['interiorLayoutFileName', 'interiorLayoutFilename'], cache);
      return pob && vfs.has(pob) ? pob : null;
    };
    const convertInterior = (template, pob) => {
      const id = `${familyOf(pob)}_interior`;
      if (!models.has(id)) {
        try {
          const conv = convertOne(vfs, pob, join(outDir, `${id}.glb`));
          models.set(id, { id, file: `${id}.glb`, triangles: conv.tris, textured: conv.textured, shaders: conv.shaders.length, cells: conv.cells, portals: conv.portals ?? [], interior: true, ...(conv.tris ? {} : { failed: 'no triangles' }) });
        } catch (err) {
          models.set(id, { id, failed: err.message });
        }
      }
      const def = models.get(id);
      if (!def || def.failed) return { skip: def?.failed ?? 'failed' };
      return { file: def.file, cells: def.cells?.length ?? 0 };
    };
    const limit = options.limit ? Number(options.limit) : Infinity;
    const { ships, skipped } = buildShips(galleryTemplates(vfs, 'object/ship/player/'), { convert, interiorOf, convertInterior }, { log: console.log, limit });
    const manifest = { classes: SHIP_CLASSES, ships, skipped, models: [...models.values()].filter((m) => !m.failed) };
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    const withInterior = ships.filter((sh) => sh.interior && !sh.interior.failed).length;
    console.log(`-> ${outDir}: ${ships.length} ships in ${models.size} models, ${withInterior} with an interior, ${skipped.length} left out (listed in manifest.json; B in game opens the garage, ships at the bottom)`);
    if (skipped.length) console.log(`   left out:\n${skipped.map((sk) => `     ${sk.template}  (${sk.why})`).join('\n')}`);
    printEffectSummary();
    break;
  }

  case 'gallery': {
    // <swg-dir> <out-dir> [--jka=<dir>] [--only=houses,vehicles,weapons,anims] [--limit=N]
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const outDir = join(pos[2], 'gallery');
    mkdirSync(outDir, { recursive: true });
    const { buildGallery, galleryTemplates } = await import('./gallery.mjs');
    const models = new Map();
    const cache = new Map();
    const only = options.only ? options.only.split(',').map((s) => s.trim()) : ['houses', 'vehicles', 'weapons', 'anims'];
    const limit = options.limit ? Number(options.limit) : Infinity;
    // One template into the pack's models, as the snapshot does it (static, portal building, or a skeletal thing at its bind pose).
    const convert = (template) => {
      let r = resolveTemplateMesh(vfs, template, cache);
      if (r.skip) return { skip: r.skip };
      // A rideable vehicle's skeletal appearance (pv_<name>.sat) is a two-joint placeholder with a
      // 10 cm box for a mesh; the visible body is the static appearance of the same name, which the
      // client attaches at run time. Show that one.
      const pv = r.skeletal && /^appearance\/pv_(.+)\.sat$/i.exec(r.skeletal);
      if (pv) {
        const x = pv[1];
        const candidates = [`appearance/${x}.apt`, `appearance/${x}.lod`, `appearance/lod/${x}.lod`, `appearance/${x}.msh`, `appearance/mesh/${x}.msh`, `appearance/mesh/${x}_l0.msh`];
        const found = candidates.find((c) => vfs.has(c));
        const body = found ? resolveAppearanceToMesh(vfs, found) : null;
        if (body && !body.skip) r = { ...body, source: `${found} (the body of ${r.skeletal})` };
        else return { skip: `vehicle placeholder ${r.skeletal} with no body found (tried ${x}.apt/.lod/.msh)` };
      }
      if (r.particle) return { skip: 'particle effect' };
      let id;
      try {
        if (r.skeletal) {
          id = familyOf(r.skeletal);
          if (!models.has(id)) {
            const info = convertSat(vfs, r.skeletal, join(outDir, `${id}.glb`), { animations: 'none' });
            const tris = info.meshes.reduce((a, m) => a + m.triangles, 0);
            models.set(id, { id, source: r.skeletal, file: `${id}.glb`, bounds: info.bounds ?? { min: [-1, 0, -1], max: [1, 2, 1] }, triangles: tris, skeletal: true, ...(tris ? {} : { failed: `no triangles (${[...info.missing, ...info.skipped].slice(0, 3).join('; ') || 'no meshes'})` }) });
            if (!tris) console.log(`  ${template}: ${r.skeletal} converted with no triangles: ${[...info.missing, ...info.skipped].slice(0, 3).join('; ') || 'no meshes in it'}`);
          }
        } else {
          const single = r.parts.length === 1 && !r.parts[0].transform && !r.effects?.length;
          id = familyOf(single ? r.parts[0].mesh : r.appearance);
          if (!models.has(id)) {
            const conv = convertOne(vfs, single ? r.parts[0].mesh : r.appearance, join(outDir, `${id}.glb`));
            const b = conv.mesh.bounds ?? { min: [0, 0, 0], max: [0, 0, 0] };
            const bounds = conv.flipX ? { min: [-b.max[0], b.min[1], b.min[2]], max: [-b.min[0], b.max[1], b.max[2]] } : b;
            const effects = attachedEffects(vfs, conv.effects, outDir);
            models.set(id, { id, source: r.source ?? r.appearance, file: `${id}.glb`, bounds, triangles: conv.tris, textured: conv.textured, shaders: conv.shaders.length, parts: conv.partCount, ...(conv.cells ? { cells: conv.cells, portals: conv.portals ?? [] } : {}), ...(effects.length ? { effects } : {}), ...(conv.tris ? {} : { failed: 'no triangles' }) });
            if (!conv.tris) console.log(`  ${template}: converted with no triangles`);
          }
        }
      } catch (err) {
        console.log(`  ${template}: ${err.message}`);
        return { skip: err.message };
      }
      const def = models.get(id);
      if (!def || def.failed) return { skip: def?.failed ?? 'failed' };
      const b = def.bounds;
      return { model: id, radius: Math.max(0.5, Math.abs(b.min[0]), Math.abs(b.max[0]), Math.abs(b.min[2]), Math.abs(b.max[2])), height: b.max[1] };
    };
    const convertAnims = (source) => {
      const file = `anims_${source}.glb`;
      if (source === 'swg') {
        const info = convertSat(vfs, PLAYER_TEMPLATE, join(outDir, file), { animations: 'all', maxAnimations: 5000, wear: DEFAULT_WEAR });
        return { file, clips: info.animations.map((n) => ({ name: n, speed: info.clipSpeeds?.[n] || undefined, joints: info.partialClips?.[n] })) };
      }
      if (!options.jka) {
        console.log('  no --jka=<dir>: the Jedi Academy animations are left out');
        return null;
      }
      let jkaInfo = null;
      const extraClips = (joints) => {
        const r = importJkaClips(options.jka, joints, 'all', { log: (m) => console.log(`  jka: ${m}`) });
        jkaInfo = r.clips.map((c) => ({ name: c.name, loop: c.loop, fps: c.fps, frames: c.frames, speed: c.speed || undefined }));
        return r.clips;
      };
      convertSat(vfs, PLAYER_TEMPLATE, join(outDir, file), { animations: '=idle', maxAnimations: 1, wear: DEFAULT_WEAR, extraClips });
      return { file, clips: jkaInfo ?? [] };
    };
    // What the pack already holds, so a partial build keeps the other sections.
    let existing = null;
    try {
      if (existsSync(join(outDir, 'gallery.json')) && existsSync(join(outDir, 'manifest.json'))) {
        existing = JSON.parse(readFileSync(join(outDir, 'gallery.json'), 'utf8'));
        existing.models = new Map((JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')).categories?.layout ?? []).map((m) => [m.id, m]));
      }
    } catch (err) {
      console.log(`  the last build could not be read (${err.message}); building only what --only names`);
      existing = null;
    }
    const g = buildGallery({ log: console.log, only, limit, existing }, {
      convert,
      convertAnims,
      keepModels: (ids) => {
        for (const id of ids) if (!models.has(id) && existing?.models?.has(id)) models.set(id, existing.models.get(id));
      },
      templates: (prefix) => galleryTemplates(vfs, prefix),
      copySky: () => {
        try {
          exportSky(vfs, 'tatooine', outDir, { textureFor: (p) => textureFor(vfs, p), log: () => {} });
        } catch (err) {
          console.log(`  sky: ${err.message}`);
        }
      },
    });
    writeFileSync(join(outDir, 'layout.json'), JSON.stringify({ planet: 'gallery', center: { x: 0, z: 0 }, radius: null, objects: g.objects }));
    writeFileSync(join(outDir, 'manifest.json'), JSON.stringify({ planet: 'gallery', categories: { layout: [...models.values()].filter((m) => m && !m.failed) } }, null, 2));
    writeFileSync(join(outDir, 'gallery.json'), JSON.stringify({ sections: g.sections, anims: g.anims }));
    console.log(`-> ${outDir}: ${g.objects.length} exhibits, ${models.size} models; play it with ?planet=gallery`);
    printEffectSummary();
    break;
  }

  case 'jka-extract': {
    // <jka-dir> <out-dir>: the humanoid skeleton and animation.cfg as loose files, for sharing a retarget problem
    if (!pos[2]) usage();
    const { openJkaBase } = await import('./jka.mjs');
    const base = openJkaBase(pos[1]);
    mkdirSync(pos[2], { recursive: true });
    for (const name of ['models/players/_humanoid/_humanoid.gla', 'models/players/_humanoid/animation.cfg']) {
      const out = join(pos[2], basename(name));
      writeFileSync(out, base.read(name));
      console.log(`${name} (${base.where(name)}) -> ${out}`);
    }
    base.close();
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
    const { snap, entries, buildout, spawns } = loadPlanetObjects(vfs, planet);
    console.log(`${entries.length} objects (${buildout.objects} from ${buildout.areas} buildout areas)`);
    if (spawns) console.log(`server spawns: ${spawns.stats.objects} static objects, ${spawns.stats.mobiles} creature and NPC spawns (${spawns.stats.inCells + spawns.stats.mobilesInCells} inside cells skipped)`);
    if (flags.has('--areas')) {
      console.log('buildout areas (rows placed / rows in the table, unknown templates, extent in metres):');
      for (const a of buildout.areaList ?? []) console.log(`  ${a.area}: ${a.placed}/${a.rows}${a.unknown ? `, ${a.unknown} UNKNOWN` : ''}, ${a.x.toFixed(0)},${a.z.toFixed(0)} to ${a.x2.toFixed(0)},${a.z2.toFixed(0)}${a.event ? `, event "${a.event}"` : ''}`);
    }
    if (buildout.eventList?.length) {
      console.log(`event-only buildout areas (${flags.has('--events') ? 'included with --events' : 'left out; add --events to include them'}):`);
      for (const e of buildout.eventList) console.log(`  ${e.area}: ${e.rows} rows, event "${e.event}"`);
    }
    const cache = new Map();
    const hits = new Map();
    // --near=x,z,r narrows the search to objects within r metres of a point.
    const near = options.near ? options.near.split(',').map(Number) : null;
    for (const e of entries) {
      const template = snap.templates[e.node.templateIndex];
      if (!pattern.test(template)) continue;
      if (near && (!e.world || Math.hypot(e.world.pos[0] - near[0], e.world.pos[2] - near[1]) > (near[2] ?? 500))) continue;
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
      if (r.skeletal) {
        console.log(`  skeletal appearance: ${r.skeletal}${/^object\/(mobile|creature)\//i.test(template) ? ' (a creature or NPC: the server spawns these, snapshot leaves them out)' : ' (baked at its bind pose as a static prop)'}`);
        continue;
      }
      if (r.skip) {
        console.log(`  SKIPPED: ${r.skip}`);
        continue;
      }
      if (r.particle) {
        console.log(`  appearance: ${r.appearance}${r.source ? ` (via ${r.source})` : ''}: a particle effect`);
        try {
          const p = exportParticle(vfs, r.particle, tmpDir, { textureFor: (sh) => textureFor(vfs, sh), passFor: (sh) => passFor(vfs, sh), write: () => {}, log: (m) => console.log(m) });
          console.log(`  converts: ${p.quads} quad emitter(s), ${p.meshes} mesh emitter(s), reach ${p.bounds.max[0]} m${p.missingTextures.length ? `, textures missing: ${p.missingTextures.join(', ')}` : ''}`);
        } catch (err) {
          console.log(`  CONVERSION FAILED: ${err.message}`);
        }
        continue;
      }
      const appearance = r.parts.length === 1 && !r.parts[0].transform && !r.effects?.length ? r.parts[0].mesh : r.appearance;
      console.log(`  appearance: ${r.appearance ?? '-'}${r.source ? ` (via ${r.source})` : ''}, ${r.parts.length} part(s)${r.effects?.length ? `, ${r.effects.length} attached particle effect(s)` : ''}`);
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
    if (flags.has('--all')) {
      const versions = vfs.versions(pos[2]);
      console.log(`every copy, oldest first (the last one wins):`);
      for (const v of versions) console.log(`  ${basename(v.archive)}: ${v.deleted ? 'deletion marker' : `${v.size} bytes`}`);
    }
    break;
  }

  case 'terrain': {
    if (!pos[3]) usage();
    const vfs = mount(pos[1]);
    // "all" refreshes the terrain of every planet pack that exists under <out-dir> already.
    const targets = pos[2] === 'all' ? GAME_PLANETS.filter((p) => existsSync(join(pos[3], p, 'manifest.json'))).map((p) => [p, join(pos[3], p)]) : [[pos[2], pos[3]]];
    if (!targets.length) console.log(`no planet packs under ${pos[3]} yet; run snapshot first`);
    for (const [planet, outDir] of targets) {
      mkdirSync(outDir, { recursive: true });
      const file = await copyTerrain(vfs, planet, outDir);
      console.log(file ? `${planet}: terrain -> ${join(outDir, file)}` : `${planet}: no terrain/${planet}.trn in archives`);
    }
    break;
  }

  case 'sky': {
    if (!pos[3]) usage();
    const vfs = mount(pos[1]);
    const targets = pos[2] === 'all' ? GAME_PLANETS.filter((p) => existsSync(join(pos[3], p, 'manifest.json'))).map((p) => [p, join(pos[3], p)]) : [[pos[2], pos[3]]];
    if (!targets.length) console.log(`no planet packs under ${pos[3]} yet; run snapshot first`);
    for (const [planet, outDir] of targets) {
      mkdirSync(outDir, { recursive: true });
      console.log(`${planet}:`);
      exportSky(vfs, planet, outDir, { textureFor: (p) => textureFor(vfs, p), log: console.log });
    }
    printEffectSummary();
    break;
  }

  case 'audit': {
    // <swg-dir> <out-dir> [planet]: everything the archives place on each converted planet against what its pack holds
    if (!pos[2]) usage();
    const vfs = mount(pos[1]);
    const planets = pos[3] && !pos[3].startsWith('--') ? [pos[3]] : GAME_PLANETS.filter((p) => existsSync(join(pos[2], p, 'layout.json')));
    // Everything printed also goes to <out-dir>/audit.txt, for sharing.
    const lines = [];
    const log = (line) => {
      console.log(line);
      lines.push(line);
    };
    log(`audit of ${pos[2]} on ${new Date().toISOString()}; ${vfs.summary}${flags.has('--retail-only') ? ' (retail only)' : ''}${flags.has('--events') ? ', event areas included' : ''}`);
    for (const planet of planets) {
      const packDir = join(pos[2], planet);
      const layout = JSON.parse(readFileSync(join(packDir, 'layout.json'), 'utf8'));
      const manifest = existsSync(join(packDir, 'manifest.json')) ? JSON.parse(readFileSync(join(packDir, 'manifest.json'), 'utf8')) : { categories: {} };
      const models = new Map((manifest.categories?.layout ?? []).map((m) => [m.id, m]));
      let entries;
      try {
        const loaded = loadPlanetObjects(vfs, planet);
        entries = loaded.entries.map((e) => ({ template: loaded.snap.templates[e.node.templateIndex], e }));
      } catch (err) {
        log(`${planet}: ${err.message}`);
        continue;
      }
      const placed = new Map();
      for (const o of layout.objects) placed.set(o.template, (placed.get(o.template) ?? 0) + 1);
      const inArchives = new Map();
      for (const { template, e } of entries) {
        const h = inArchives.get(template) ?? { count: 0, example: e };
        h.count++;
        inArchives.set(template, h);
      }
      const cache = new Map();
      const missing = [];
      let missingObjects = 0;
      for (const [template, h] of inArchives) {
        const have = placed.get(template) ?? 0;
        if (have >= h.count) continue;
        const r = resolveTemplateMesh(vfs, template, cache);
        const reason = r.skip ? r.skip : r.skeletal ? (/^object\/(mobile|creature)\//i.test(template) ? 'creature or NPC (server spawns it)' : 'skeletal prop: reconvert to bake it') : r.particle ? 'particle effect: reconvert to add it' : 'converted, but the pack lacks it (radius filter, or an older conversion)';
        missing.push({ template, want: h.count, have, reason, at: h.example.world?.pos });
        missingObjects += h.count - have;
      }
      const glbMissing = [...models.values()].filter((m) => !existsSync(join(packDir, m.file))).map((m) => m.id);
      const noModel = layout.objects.filter((o) => !models.has(o.model)).length;
      log(`${planet}: archives place ${entries.length} objects, pack has ${layout.objects.length}; ${missingObjects} not in the pack across ${missing.length} templates${noModel ? `; ${noModel} placed objects name a model the manifest lacks` : ''}${glbMissing.length ? `; ${glbMissing.length} manifest models have no file: ${glbMissing.slice(0, 5).join(', ')}` : ''}`);
      const byReason = new Map();
      for (const m of missing) byReason.set(m.reason, (byReason.get(m.reason) ?? 0) + (m.want - m.have));
      for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1])) log(`  ${String(n).padStart(6)}  ${reason}`);
      const limit = Number(options.limit ?? 60);
      for (const m of missing.sort((a, b) => b.want - b.have - (a.want - a.have)).slice(0, limit)) log(`    ${m.want - m.have} of ${m.want} missing  ${m.template}  (${m.reason})${m.at ? ` e.g. ${m.at[0].toFixed(0)},${m.at[2].toFixed(0)}` : ''}`);
      log('');
    }
    writeFileSync(join(pos[2], 'audit.txt'), lines.join('\n') + '\n');
    console.log(`written to ${join(pos[2], 'audit.txt')}`);
    break;
  }

  case 'extras': {
    // <swg-dir>: what the archives outside the retail manifests add or replace, by category, without converting any of it
    if (!pos[1]) usage();
    const dir = pos[1];
    const isRetail = (f) => isRetailByName(f, statSync(join(dir, f)).size) !== null;
    const all = openVfs(dir, { log: () => {} });
    const retail = openVfs(dir, { filter: isRetail, log: () => {} });
    const extra = all.archives.map((a) => basename(a.path)).filter((f) => !isRetail(f));
    console.log(`archives outside the retail manifests: ${extra.length ? extra.join(', ') : 'none'}`);
    const category = (name) => {
      if (name.startsWith('snapshot/')) return 'world snapshots';
      if (name.startsWith('datatables/buildout/')) return 'buildout tables';
      if (/^terrain\/.*\.(trn|lay|tga)$/.test(name)) return 'terrain rules, building layers and heightmaps';
      if (name.startsWith('terrain/environment/') || name.startsWith('datatables/environment/')) return 'sky and environment';
      if (name.startsWith('datatables/clientregion/') || /^string\/en\/.*region/.test(name)) return 'named regions';
      if (name.startsWith('object/')) return 'object templates';
      if (name.startsWith('appearance/')) return 'appearances (meshes, portals, skeletons, animations)';
      if (name.startsWith('texture/')) return 'textures';
      if (name.startsWith('shader/') || name.startsWith('effect/')) return 'shaders and effects';
      if (name.startsWith('datatables/')) return 'other datatables';
      if (name.startsWith('string/')) return 'strings';
      if (name.startsWith('ui/')) return 'user interface';
      if (name.startsWith('sound/') || name.startsWith('music/')) return 'sound and music';
      return 'other';
    };
    const detail = new Set(['world snapshots', 'buildout tables', 'terrain rules, building layers and heightmaps', 'sky and environment', 'named regions']);
    const groups = new Map();
    for (const name of all.list()) {
      const st = all.stat(name);
      if (!st || isRetail(basename(st.archive))) continue;
      const cat = category(name);
      const g = groups.get(cat) ?? { added: [], replaced: [] };
      (retail.has(name) ? g.replaced : g.added).push(`${name} (${basename(st.archive)})`);
      groups.set(cat, g);
    }
    const order = [...groups.entries()].sort((a, b) => b[1].added.length + b[1].replaced.length - (a[1].added.length + a[1].replaced.length));
    for (const [cat, g] of order) {
      console.log(`\n${cat}: ${g.added.length} new, ${g.replaced.length} replacing retail files`);
      const show = (label, list) => {
        if (!list.length) return;
        const limit = detail.has(cat) ? list.length : 12;
        console.log(`  ${label}:`);
        for (const n of list.slice(0, limit)) console.log(`    ${n}`);
        if (list.length > limit) console.log(`    ... and ${list.length - limit} more`);
      };
      show('replaced', g.replaced);
      show('new', g.added);
    }
    break;
  }

  case 'status': {
    // <out-dir>: what the converted packs hold, and the command that fills each gap. Needs no archives.
    if (!pos[1]) usage();
    packStatus(pos[1]);
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
