// Server-side placements from the SWGEmu (Core3) scripts: the third source of things in the
// world, after the client's world snapshot and its buildout tables. Screenplays call
//   spawnSceneObject(zone, template, x, z, y, cellId, qw, qx, qy, qz)      (or ..., cellId, heading)
//   spawnMobile(zone, mobileName, respawn, x, z, y, heading, cellId)
// with Core3's (x, z, y) order: the third number is the height. Server template paths lack the
// client's "shared_" prefix (object/static/structure/x/y.iff -> .../shared_y.iff). Only calls
// with literal numbers outside building cells are placeable; the rest are counted.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const NUM = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
const ARG = String.raw`(?:${NUM}|math\.rad\(\s*${NUM}\s*\))`;
const SCENE = new RegExp(String.raw`spawnSceneObject\(\s*([A-Za-z_][\w.]*|"[^"]*")\s*,\s*"([^"]+)"\s*,\s*(${NUM})\s*,\s*(${NUM})\s*,\s*(${NUM})\s*,\s*(\d+)\s*((?:\s*,\s*${ARG})*)\s*\)`, 'g');
const MOBILE = new RegExp(String.raw`spawnMobile\(\s*([A-Za-z_][\w.]*|"[^"]*")\s*,\s*"([^"]+)"\s*,\s*(${NUM})\s*,\s*(${NUM})\s*,\s*(${NUM})\s*,\s*(${NUM})\s*,\s*(${ARG})\s*(?:,\s*(\d+))?`, 'g');

function* luaFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* luaFiles(p);
    else if (name.endsWith('.lua')) yield p;
  }
}

/** The client's shared template for a server template path. */
export function sharedTemplate(serverPath) {
  const p = serverPath.replace(/\\/g, '/');
  const i = p.lastIndexOf('/');
  const base = p.slice(i + 1);
  return base.startsWith('shared_') ? p : `${p.slice(0, i + 1)}shared_${base}`;
}

function number(text) {
  const m = /math\.rad\(\s*([-+.\deE]+)\s*\)/.exec(text);
  return m ? (Number(m[1]) * Math.PI) / 180 : Number(text);
}

/** Quaternion [w, x, y, z] for a heading (yaw about Y) in radians. */
function yawQuaternion(rad) {
  return [Math.cos(rad / 2), 0, Math.sin(rad / 2), 0];
}

/**
 * Every literal static object and mobile the scripts under `scriptsDir` (Core3's
 * MMOCoreORB/bin/scripts) place on `planet`. Zones are literal strings or `self.planet`,
 * resolved from the file's own `planet = "..."` line.
 */
export function scanServerSpawns(scriptsDir, planet) {
  const root = join(scriptsDir, 'screenplays');
  const stats = { files: 0, objects: 0, inCells: 0, mobiles: 0, mobilesInCells: 0, unresolvedZone: 0 };
  const objects = [];
  const mobiles = [];
  if (!existsSync(root)) return { objects, mobiles, stats };
  for (const file of luaFiles(root)) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('spawnSceneObject') && !text.includes('spawnMobile')) continue;
    const declared = /\bplanet\s*=\s*"([^"]+)"/.exec(text)?.[1] ?? null;
    const rel = relative(scriptsDir, file).replace(/\\/g, '/');
    const zoneOf = (arg) => {
      if (arg.startsWith('"')) return arg.slice(1, -1);
      if (arg === 'self.planet' || arg === 'planet') return declared;
      return null;
    };
    let used = false;
    for (const m of text.matchAll(SCENE)) {
      const zone = zoneOf(m[1]);
      if (zone === null) {
        stats.unresolvedZone++;
        continue;
      }
      if (zone !== planet) continue;
      used = true;
      const cell = Number(m[6]);
      if (cell !== 0) {
        stats.inCells++;
        continue;
      }
      const extra = m[7].split(',').map((s) => s.trim()).filter(Boolean).map(number);
      let q = [1, 0, 0, 0];
      if (extra.length >= 4) q = extra.slice(0, 4);
      else if (extra.length >= 1) q = yawQuaternion(extra[0]);
      const len = Math.hypot(...q) || 1;
      objects.push({ template: sharedTemplate(m[2]), pos: [Number(m[3]), Number(m[4]), Number(m[5])], q: q.map((v) => v / len), file: rel });
      stats.objects++;
    }
    for (const m of text.matchAll(MOBILE)) {
      const zone = zoneOf(m[1]);
      if (zone === null) {
        stats.unresolvedZone++;
        continue;
      }
      if (zone !== planet) continue;
      used = true;
      const cell = Number(m[8] ?? 0);
      if (cell !== 0) {
        stats.mobilesInCells++;
        continue;
      }
      const heading = number(m[7]);
      mobiles.push({ name: m[2], pos: [Number(m[4]), Number(m[5]), Number(m[6])], heading: Math.abs(heading) > Math.PI * 2 ? (heading * Math.PI) / 180 : heading, respawn: Number(m[3]), file: rel });
      stats.mobiles++;
    }
    if (used) stats.files++;
  }
  return { objects, mobiles, stats };
}

/**
 * The mobile definitions the scripts refer to (scripts/mobile/**): each name's client
 * appearance templates, for placing creatures the server spawns.
 */
export function mobileTemplates(scriptsDir, names) {
  const wanted = new Set(names);
  const out = new Map();
  const root = join(scriptsDir, 'mobile');
  if (!existsSync(root) || !wanted.size) return out;
  for (const file of luaFiles(root)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/^\s*([A-Za-z_]\w*)\s*=\s*Creature:new\s*\{([\s\S]*?)^\}/gm)) {
      const name = m[1];
      if (!wanted.has(name)) continue;
      const t = /templates\s*=\s*\{([^}]*)\}/.exec(m[2]);
      const templates = t ? [...t[1].matchAll(/"([^"]+)"/g)].map((x) => sharedTemplate(x[1])) : [];
      const objectName = /objectName\s*=\s*"([^"]+)"/.exec(m[2])?.[1] ?? name;
      out.set(name, { templates, objectName });
    }
  }
  return out;
}
