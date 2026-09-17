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

/** A named list of flags (`pvpBitmask = AGGRESSIVE + ATTACKABLE`), split on + or |. */
function flagList(body, field) {
  const m = new RegExp(String.raw`\b${field}\s*=\s*([A-Za-z_0-9 +|]+)`).exec(body);
  return m ? m[1].split(/[+|]/).map((s) => s.trim()).filter(Boolean) : [];
}

/**
 * Every `name = Creature:new { ... }` block in one Lua file of Core3's scripts/mobile, with the
 * fields a stats override needs. Missing fields stay undefined, because these scripts have been
 * written over many years and no field is on every mobile.
 */
export function parseCore3Mobiles(text, file = '') {
  const out = [];
  for (const m of text.matchAll(/^\s*([A-Za-z_]\w*)\s*=\s*Creature:new\s*\{([\s\S]*?)^\}/gm)) {
    const body = m[2];
    const num = (field) => {
      const x = new RegExp(String.raw`\b${field}\s*=\s*(-?[\d.]+)`).exec(body);
      return x ? Number(x[1]) : undefined;
    };
    const pair = (a, b) => {
      const x = num(a);
      const y = num(b);
      return x === undefined && y === undefined ? undefined : [x ?? y ?? 0, y ?? x ?? 0];
    };
    const t = /templates\s*=\s*\{([^}]*)\}/.exec(body);
    const weaponsList = /\bweapons\s*=\s*\{([^}]*)\}/.exec(body);
    const weapons = weaponsList ? [...weaponsList[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
    for (const field of ['primaryWeapon', 'secondaryWeapon']) {
      const w = new RegExp(String.raw`\b${field}\s*=\s*"([^"]+)"`).exec(body)?.[1];
      if (w && !weapons.includes(w)) weapons.push(w);
    }
    // The attack list is pairs of name and modifier; a merge() of other lists cannot be counted here.
    const attackBlock = /\battacks\s*=\s*\{([\s\S]*?)\n\s*\}/.exec(body);
    const attacks = attackBlock ? [...attackBlock[1].matchAll(/\{\s*"[^"]*"\s*,/g)].length : undefined;
    const diet = /\bdiet\s*=\s*([A-Za-z_]+)/.exec(body)?.[1];
    out.push({
      name: m[1],
      file,
      level: num('level'),
      chanceHit: num('chanceHit'),
      damage: pair('damageMin', 'damageMax'),
      ham: pair('baseHAM', 'baseHAMmax'),
      armor: num('armor'),
      ferocity: num('ferocity'),
      scale: num('scale'),
      pvp: flagList(body, 'pvpBitmask'),
      creature: flagList(body, 'creatureBitmask'),
      ...(diet ? { diet } : {}),
      templates: t ? [...t[1].matchAll(/"([^"]+)"/g)].map((x) => sharedTemplate(x[1])) : [],
      weapons,
      ...(attacks !== undefined ? { attacks } : {}),
      faction: /\bfaction\s*=\s*"([^"]+)"/.exec(body)?.[1],
      socialGroup: /\bsocialGroup\s*=\s*"([^"]+)"/.exec(body)?.[1],
    });
  }
  return out;
}

/**
 * Every mobile under <scriptsDir>/mobile by the client template it draws as, lowest level first,
 * so a template several level variants share is read as its weakest. Returns an empty map when
 * there is no such folder, because Core3 is optional everywhere it is used.
 */
export function core3MobileStats(scriptsDir) {
  const out = new Map();
  const root = join(scriptsDir, 'mobile');
  if (!existsSync(root)) return out;
  for (const file of luaFiles(root)) {
    let mobiles;
    try {
      mobiles = parseCore3Mobiles(readFileSync(file, 'utf8'), relative(scriptsDir, file).replace(/\\/g, '/'));
    } catch {
      continue;
    }
    for (const mob of mobiles) for (const template of mob.templates) {
      const list = out.get(template) ?? out.set(template, []).get(template);
      list.push(mob);
    }
  }
  for (const list of out.values()) list.sort((a, b) => (a.level ?? 1e9) - (b.level ?? 1e9) || a.name.localeCompare(b.name));
  return out;
}
