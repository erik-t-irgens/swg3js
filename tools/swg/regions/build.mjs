// Builds regions.json (named places per planet) from SWGEmu Core3's planet region scripts
// (MMOCoreORB/bin/scripts/managers/planet/<planet>_regions.lua). Only the names and
// coordinates of places are kept: cities, named regions and protected landmarks.
//   node tools/swg/regions/build.mjs <path-to-core3>/MMOCoreORB/bin/scripts/managers/planet
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FLAGS = { UNDEFINEDAREA: 0, SPAWNAREA: 1, NOSPAWNAREA: 2, NOWORLDSPAWNAREA: 8, NOBUILDZONEAREA: 0x10, CITY: 0x40, NAVAREA: 0x80, NAMEDREGION: 0x100, LOCKEDAREA: 0x200 };
const JUNK = /nobuild|newbie|deliver|spawner|battlefield|edge_|walls$|_sd$|^dungeon|tutorial|_test|adv_|wp_|bank|shuttle|starport|cantina_|_chase|creature|^sdungeon|^coa2|patrol|^medium|^hard|^easy|_medium$|_hard$|_easy$|_(se|sw|ne|nw)$|^(north|south|east|west)(east|west)?_|^swamp_one|^forest$|^rainforest$|quest_giver|big_game|_poi$|^debris$|^tower$|^camp$|^ruins$|^bench$|^gazebo$|fs_combat_camp|sdungeon|coa2|life_day|quest|_walls|corral|^bh_camp|newbie/;
const SMALL = new Set(['in', 'on', 'at', 'up', 'a', 'and', 'with', 'of', 'the', 'vs', 'o']);
const PLANETS = ['tatooine', 'naboo', 'corellia', 'dantooine', 'lok', 'endor', 'dathomir', 'yavin4', 'talus', 'rori'];

function title(key, planet) {
  return key
    .replace(new RegExp(`^${planet}_`), '')
    .replace(/_\d+$/, '')
    .split('_')
    .filter(Boolean)
    .map((w, i) => (SMALL.has(w) && i > 0 ? w : /^(ne|nw|se|sw|x|vs)$/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

function parse(planet, text) {
  const out = [];
  const seen = new Set();
  const line = /\{\s*"([^"]+)"\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*\{\s*(CIRCLE|RECTANGLE|RING)\s*,\s*(-?[\d.]+)(?:\s*,\s*(-?[\d.]+))?\s*\}\s*,\s*([A-Z_+ \t]+?)\s*[,}]/g;
  for (const m of text.matchAll(line)) {
    if (/^\s*--/.test(text.slice(text.lastIndexOf('\n', m.index) + 1, m.index))) continue; // commented out
    const [, rawName, xs, zs, shape, a, b, flagExpr] = m;
    const flags = flagExpr.split('+').map((f) => FLAGS[f.trim()] ?? 0).reduce((s, v) => s + v, 0);
    let x = Number(xs);
    let z = Number(zs);
    let r;
    if (shape === 'RECTANGLE') {
      const x2 = Number(a);
      const z2 = Number(b);
      r = Math.max(Math.abs(x2 - x), Math.abs(z2 - z)) / 2;
      x = (x + x2) / 2;
      z = (z + z2) / 2;
    } else r = Number(b ?? a);
    const stringId = rawName.startsWith('@') ? rawName.slice(1) : null;
    const key = (stringId ? stringId.split(':')[1] : rawName).toLowerCase();
    const base = key.replace(/_\d+$/, '');
    const city = (flags & FLAGS.CITY) !== 0;
    const named = (flags & FLAGS.NAMEDREGION) !== 0;
    const protectedPoi = (flags & (FLAGS.NOSPAWNAREA | FLAGS.NOBUILDZONEAREA)) === (FLAGS.NOSPAWNAREA | FLAGS.NOBUILDZONEAREA);
    const spawn = (flags & FLAGS.SPAWNAREA) !== 0;
    let kind;
    if (city) kind = 'city';
    else if ((stringId || named) && !spawn) kind = r > 1000 ? 'area' : 'landmark';
    else if (protectedPoi && r >= 60) kind = 'landmark';
    else continue;
    if (!city && JUNK.test(key)) continue;
    if (seen.has(base)) continue;
    seen.add(base);
    out.push({ key: base, stringId: stringId ? stringId.replace(/_\d+$/, '') : null, name: title(base, planet), x: Math.round(x), z: Math.round(z), r: Math.round(r), kind });
  }
  // The same place often appears twice (a named region and a protected circle): keep the named one.
  const rank = (p) => (p.kind === 'city' ? 0 : p.stringId ? 1 : 2);
  const kept = [];
  // "jabbas_palace" and "jabba_palace" are the same place: compare names without plurals.
  const norm = (p) => p.name.toLowerCase().split(' ').map((w) => w.replace(/s$/, '')).join('');
  for (const p of out.sort((a, b) => rank(a) - rank(b) || a.r - b.r)) {
    if (p.kind !== 'area' && kept.some((q) => q.kind !== 'area' && (Math.hypot(q.x - p.x, q.z - p.z) < 120 || norm(q) === norm(p)))) continue;
    kept.push(p);
  }
  return kept;
}

const dir = process.argv[2];
if (!dir) throw new Error('usage: build.mjs <core3 planet scripts dir>');
const result = {};
for (const planet of PLANETS) {
  const file = join(dir, `${planet}_regions.lua`);
  try {
    result[planet] = parse(planet, readFileSync(file, 'utf8'));
    console.log(`${planet}: ${result[planet].length} places (${result[planet].filter((p) => p.kind === 'city').length} cities)`);
  } catch (err) {
    console.warn(`${planet}: ${err.message}`);
  }
}
void readdirSync;
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'regions.json'), JSON.stringify(result, null, 1));
