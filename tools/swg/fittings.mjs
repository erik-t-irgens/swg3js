// The other children of a building: everything the server stood in and around the game's own
// buildings that no world snapshot places.
//
// The `travel` command reads one `childObjects` block per starport and shuttleport and keeps the
// three things travel is made of. That block is on a hundred and sixty-eight building templates and
// carries a thousand and two children, and the rest of them are the fittings: the elevator panel
// beside a lift's doorway, the bank terminal outside a bank, the cloning and insurance terminals in
// a cloning facility, the hanging sign over a cantina's door, a guild hall's voting box. All of it
// was the server's, which is why no snapshot has it and why the rooms it belongs in look bare.
//
// Measured over the converted worlds: 714 children join a building this game really places, 710 of
// them resolve to an appearance the archives hold (two templates have no client side at all and are
// counted rather than guessed at), and **not one of the 710 stands within two and a half metres of
// a snapshot object drawn with the same model**, so nothing here doubles what is already there. The
// snapshots' own 1,465 terminals and signs are a different set in different places.
//
// A model's id is the **appearance's own base name**, not the template's, so templates that share
// an appearance share one model and one conversion: the four municipal hanging signs and the player
// house address sign are one sign, the three Jedi enclave terminals are one terminal. Twenty-four
// models cover all 710 things.
//
// **Nothing here may ever reach the repository.** The checkout is a third-party project under its
// own licence: this reads its data, never its code.
//
// Dependency-free but for node's own modules and this folder's readers; shared with
// tools/swg/tests/fittings.test.ts.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { kindOfChild, readBuildingChildren } from './travel.mjs';

/** The pack this command writes. */
export const FITTINGS_PACK_VERSION = 1;

/**
 * Every building template that carries fittings, and what each carries.
 *
 * A child is a fitting when it is not one of the three things travel is made of -- those are the
 * `travel` command's and writing them twice would stand two terminals in one place. What is kept is
 * the child's own template, because which model draws it cannot be known without the archives and
 * this module never opens one.
 */
export function readFittingBuildings(scriptsDir) {
  return readBuildingChildren(scriptsDir, (t) => (kindOfChild(t) ? null : { template: String(t ?? '') }));
}

/**
 * The model id a fitting is drawn with: its appearance's own base name.
 *
 * Keying on the appearance rather than on the template is what makes two templates that look
 * identical one model in the pack, and it is also the name the snapshot's own objects already carry
 * for the same appearance, so a fitting and a snapshot prop of the same thing are one entry.
 */
export function modelIdOf(appearance) {
  const a = String(appearance ?? '').replace(/\\/g, '/');
  if (!a) return null;
  // A `.prt` is a particle effect, not a prop: it has no mesh to convert and the pack's own effects
  // path is what draws one. Seven of the emulator's placements are these (a blinking light, welding
  // sparks, a flock of glowzees), and asking the model converter for them is a warning a world.
  if (/\.prt$/i.test(a)) return null;
  const base = a.split('/').pop() ?? '';
  const id = base.replace(/\.[^.]+$/, '');
  return id || null;
}

/**
 * Which model each fitting template is drawn with, and where that model's appearance lives.
 *
 * `appearanceOf(sharedTemplate)` is injected so this module opens no archive: the caller hands in
 * the converter's own template reader. A template the client has no `shared_` side for, or whose
 * shared side names no appearance, comes back with nothing and is counted rather than dropped in
 * silence.
 */
export function fittingModels(templates, appearanceOf) {
  const models = new Map();
  const missing = [];
  for (const t of templates) {
    const shared = String(t).replace(/\/([^/]+)$/, '/shared_$1');
    let appearance = null;
    try {
      appearance = appearanceOf(shared);
    } catch {
      appearance = null;
    }
    const id = modelIdOf(appearance);
    if (!id) {
      missing.push(t);
      continue;
    }
    models.set(t, { id, appearance: String(appearance).replace(/\\/g, '/').replace(/^\//, '') });
  }
  return { models, missing };
}

/**
 * The other half of the fittings: the static objects the emulator's own screenplays stand.
 *
 * A building template's `childObjects` are what stands wherever that *kind* of building stands. A
 * screenplay's `spawnSceneObject` is the other thing -- one object at one place on one world, which
 * is where the campsites, the crafting stations, the dungeon props, the tiki torches, the elevator
 * panels and the powered-down droids come from. The `snapshot` command can already read them, but
 * only with `--core3` and only the outdoor ones (it counts and drops every one in a cell), so on an
 * install converted without it every one of them is missing -- and re-running `snapshot` for them
 * is a whole world's conversion for a few dozen props.
 *
 * Two things about the numbers. **A child's position is written `x, z, y` with z the height**, the
 * same emulator convention the building children use. And the sixth argument is not a cell *index*
 * but the **client's own object id for that cell**, which is why it can be joined to the snapshot at
 * all: measured, 120 of the 136 in-cell objects in the whole game name a cell the client's own
 * snapshot really has, and the other 16 are in buildings the server itself puts up.
 */
const SCENE = /spawnSceneObject\(\s*([^,]+),\s*"([^"]+)"\s*,\s*([-\d.eE]+)\s*,\s*([-\d.eE]+)\s*,\s*([-\d.eE]+)\s*,\s*([-\d]+)\s*([^)]*)\)/g;

function luaUnder(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) luaUnder(p, out);
    else if (e.endsWith('.lua')) out.push(p);
  }
  return out;
}

/** A number written as a literal or as `math.rad(n)`. */
function radians(text) {
  const m = /math\.rad\(\s*([-+.\deE]+)\s*\)/.exec(text);
  return m ? (Number(m[1]) * Math.PI) / 180 : Number(text);
}

/**
 * Every static object the screenplays place on `planet`: its template, where it stands and, for one
 * inside a building, the client's cell object id it was written for.
 */
export function readServerProps(scriptsDir, planet) {
  const out = [];
  const root = join(scriptsDir, 'screenplays');
  if (!existsSync(root)) return out;
  for (const file of luaUnder(root)) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!text.includes('spawnSceneObject')) continue;
    const declared = /\bplanet\s*=\s*"([^"]+)"/.exec(text)?.[1] ?? null;
    for (const m of text.matchAll(SCENE)) {
      const a = m[1].trim();
      const zone = a.startsWith('"') ? a.slice(1, -1) : a === 'self.planet' || a === 'planet' ? declared : null;
      if (zone !== planet) continue;
      const x = Number(m[3]);
      const height = Number(m[4]);
      const depth = Number(m[5]);
      if (!Number.isFinite(x) || !Number.isFinite(height) || !Number.isFinite(depth)) continue;
      // Anything in the tail that is not a number is a name or a call the script works out at run
      // time (`getCellID(...)`, a local), and 40 of the 91 on one world have one. Kept as written it
      // is a NaN turn, which reads as a prop facing nowhere and draws nothing at all: what is not a
      // number is dropped, and a row left with nothing faces along the world as the default is.
      const extra = m[7].split(',').map((s) => s.trim()).filter(Boolean).map(radians).filter((n) => Number.isFinite(n));
      // Four numbers are a quaternion (w, x, y, z); one is a heading; none is facing along.
      let yaw = 0;
      if (extra.length >= 4) yaw = Math.atan2(2 * extra[0] * extra[2], 1 - 2 * extra[2] * extra[2]);
      else if (extra.length >= 1) yaw = extra[0];
      if (!Number.isFinite(yaw)) yaw = 0;
      out.push({ template: String(m[2]), x, y: height, z: depth, yaw: Math.round(yaw * 1e4) / 1e4, cellId: Math.round(Number(m[6])) || 0 });
    }
  }
  return out;
}

/** What the conversion prints and `status` reads. */
export function fittingCounts(rows) {
  return {
    things: rows.length,
    models: new Set(rows.map((r) => r.model)).size,
    buildings: new Set(rows.map((r) => r.building)).size,
    indoors: rows.filter((r) => r.cell > 0).length,
  };
}
