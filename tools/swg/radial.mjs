// The `radial` pass: the pictures of a world's radial flora -- its grass, flowers, reeds and ferns, and the flat
// tree cards on its far hills -- written beside the terrain file the pack already carries (radialFile.ts says
// the two files' shape, and the game reads them through it). A light pass, like `objeffects`: it converts no
// model, touches no terrain or snapshot, and writes only its own two files.
//
// Which shaders: every one a live radial affector places, near (AFDN) or far (AFDF), out of the very generator
// the game runs (`radialPlaced`). For each, its MAIN texture decoded with the converter's own DDS reader and laid
// in a layer of RADIAL_SIZE square (`resampleRgba`), raw RGBA bytes, and its own alpha reference (the ARVS record
// its effect tests against) and kind. No glass rule: these are cards, never panes.
//
// Each file is written beside itself and renamed over its own name, so a run swaps no folder, deletes nothing
// but its own unfinished copy, and a game reading the pack meanwhile reads the last whole file or the new one.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { decodeDds } from './dds.mjs';
import { describeSurface } from './surface.mjs';
import { RadialGroup } from '../../src/swg/terrain/flora.ts';
import { formChild, isForm, parseIff } from '../../src/swg/terrain/iff.ts';
import { RADIAL_FORMAT, RADIAL_JSON, RADIAL_RGBA, RADIAL_SIZE, radialKind, radialPlaced, resampleRgba } from '../../src/swg/terrain/radialFile.ts';

export { RADIAL_FORMAT, RADIAL_JSON, RADIAL_RGBA, RADIAL_SIZE };

/** A file's sha1, hex. */
export function sha1Of(bytes) {
  return createHash('sha1').update(bytes).digest('hex');
}

/**
 * The radial group a terrain file carries, read without the rest of the generator (a cheap read for `status`):
 * the group, or null where the file has none or will not parse.
 */
export function radialGroupOf(trnBytes) {
  try {
    const root = parseIff(new Uint8Array(trnBytes));
    const v = root.children.find(isForm);
    const tgen = v ? formChild(v, 'TGEN') : null;
    const tv = tgen ? formChild(tgen, '0000') : null;
    const rgrp = tv ? formChild(tv, 'RGRP') : null;
    const group = new RadialGroup();
    group.load(rgrp ?? null);
    return group;
  } catch {
    return null;
  }
}

/** Write a file beside itself and rename it over its own name, trying the rename a few times (a reader on Windows can hold the old one open for a moment). */
function writeInPlace(target, bytes) {
  mkdirSync(dirname(target), { recursive: true });
  const part = `${target}.part`;
  writeFileSync(part, bytes);
  let last = null;
  for (let tries = 0; tries < 5; tries++) {
    try {
      renameSync(part, target);
      return;
    } catch (err) {
      last = err;
      const until = Date.now() + 200 * (tries + 1);
      while (Date.now() < until) {
        // A short wait for whatever holds the old file to let it go.
      }
    }
  }
  try {
    rmSync(part, { force: true });
  } catch {
    // Left as it is; the next run writes it again.
  }
  throw new Error(`${target}: could not be put in place (${last?.message ?? 'unknown'}); is something holding it open?`);
}

/**
 * One world's radial pictures and their list, from the terrain file its pack carries (`trnBytes`, which the
 * template was parsed from) and the archives. Returns what it wrote, counted. `late` is the late stamp the caller's
 * mount gives (finalnames.mjs), written as it is: the pictures come out of the archives, so a re-issued grass picture
 * on a terrain that did not change is still asked for again.
 */
export function writeRadial(vfs, template, trnBytes, outDir, { log = console.error, warn = console.warn, late = null } = {}) {
  const placed = radialPlaced(template.generator);
  const cache = new Map();
  const shaders = {};
  const missing = [];
  const layers = [];
  const kinds = {};
  for (const p of placed) {
    const path = `shader/${p.key}.sht`;
    const d = describeSurface(vfs, path, cache);
    if (!d.main || !vfs.has(d.main)) {
      missing.push({ key: p.key, why: d.main ? `${d.main} not in the archives` : vfs.has(path) ? 'no main texture' : `${path} not in the archives` });
      warn(`radial ${p.key}: ${missing[missing.length - 1].why}`);
      continue;
    }
    let img;
    try {
      img = decodeDds(vfs.read(d.main));
    } catch (err) {
      missing.push({ key: p.key, why: `${d.main}: ${err.message}` });
      warn(`radial ${p.key}: ${d.main} not decoded (${err.message})`);
      continue;
    }
    const kind = radialKind(d.effect);
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    shaders[p.key] = { layer: layers.length, near: p.near, far: p.far, alphaRef: d.alphaRef ?? 0, kind, effect: d.effect, texture: d.main, width: img.width, height: img.height, families: p.families };
    layers.push(resampleRgba(img.rgba, img.width, img.height, RADIAL_SIZE));
  }
  const layerBytes = RADIAL_SIZE * RADIAL_SIZE * 4;
  const rgba = new Uint8Array(layers.length * layerBytes);
  layers.forEach((l, i) => rgba.set(l, i * layerBytes));
  const file = {
    radialFormat: RADIAL_FORMAT,
    size: RADIAL_SIZE,
    trn: { bytes: trnBytes.length, sha1: sha1Of(trnBytes) },
    placed: placed.length,
    layers: layers.length,
    near: placed.filter((p) => p.near).length,
    far: placed.filter((p) => p.far).length,
    shaders,
    ...(missing.length ? { missing } : {}),
    ...(late ? { late } : {}),
  };
  // The pictures first and the list after, so a list is never there before the pictures it names.
  writeInPlace(join(outDir, RADIAL_RGBA), rgba);
  writeInPlace(join(outDir, RADIAL_JSON), JSON.stringify(file, null, 1));
  log(`  radial: ${layers.length}/${placed.length} shaders (${file.near} near, ${file.far} far; ${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')}), ${(rgba.length / 1048576).toFixed(1)} MB${missing.length ? `, ${missing.length} missing` : ''}`);
  return { placed: placed.length, layers: layers.length, near: file.near, far: file.far, bytes: rgba.length, missing: missing.length, kinds };
}

/**
 * What `status` says of a world's radial flora (`radial.json` read, null where there is none; the terrain file's
 * bytes; whether the picture file is the size the list says): a line, and why the pass is wanted, or null. A world
 * whose terrain names no radial shader (Mustafar, the copies' world, the pob dungeons) is never asked.
 */
export function radialStatus(planet, json, trnBytes, rgbaBytes) {
  const group = trnBytes ? radialGroupOf(trnBytes) : null;
  const named = group ? group.childCount : 0;
  if (!named) return { line: null, why: null };
  if (!json) return { line: 'NO GRASS', why: `${planet}'s terrain names ${named} radial children (grass, flowers and the far hills' tree cards) and the pack has none of their pictures (${RADIAL_JSON})` };
  if (json.radialFormat !== RADIAL_FORMAT) return { line: 'GRASS OF ANOTHER FORMAT', why: `${planet}'s ${RADIAL_JSON} is format ${json.radialFormat ?? 'none'}, not ${RADIAL_FORMAT}` };
  if (json.trn?.sha1 !== sha1Of(trnBytes)) return { line: 'GRASS FROM ANOTHER TERRAIN', why: `${planet}'s grass pictures were written from a terrain file other than the one its pack carries now` };
  if (json.layers !== json.placed) return { line: `grass ${json.layers}/${json.placed} pictures`, why: `${planet}'s grass has ${json.layers} of the ${json.placed} pictures its terrain places` };
  const want = json.layers * (json.size ?? RADIAL_SIZE) ** 2 * 4;
  if (rgbaBytes !== want) return { line: 'GRASS PICTURES CUT SHORT', why: `${planet}'s ${RADIAL_RGBA} holds ${rgbaBytes ?? 'no'} bytes where its list says ${want}` };
  return { line: `grass ${json.layers} pictures (${json.near ?? '?'} near, ${json.far ?? '?'} far)`, why: null };
}

/** `radialStatus` over a pack folder on disk. */
export function radialStatusOf(planet, packDir) {
  const trnPath = join(packDir, 'terrain.trn');
  if (!existsSync(trnPath)) return { line: null, why: null };
  const trn = readFileSync(trnPath);
  const jsonPath = join(packDir, RADIAL_JSON);
  let json = null;
  if (existsSync(jsonPath)) {
    try {
      json = JSON.parse(readFileSync(jsonPath, 'utf8'));
    } catch {
      json = null;
    }
  }
  const rgbaPath = join(packDir, RADIAL_RGBA);
  return radialStatus(planet, json, trn, existsSync(rgbaPath) ? statSync(rgbaPath).size : null);
}
