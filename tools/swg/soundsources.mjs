// Where the game's sounds are used: the client data of every creature, person, droid,
// vehicle, ship and prop, the client effects those name, and the tables that put a
// sound in a room, on a door, on a melee or ranged weapon, on a ship's power and its
// flyby, and under a foot.
//
// Client data is `FORM CLDF > 0000` with one chunk or form per thing the object does.
// The chunks that carry sound, with their layout as the retail archives hold them
// (every one parses to the byte across all 6,181 files):
//   CEFT  event name, then a client effect or sound path     (46,706)
//   CSND  event name, then a sound path                      (15,644)
//   EVNT  event name, then a client effect or sound path     (522, on the player species)
//         An event's value is almost always a `.snd` or a `.cef`, but three snow and
//         afflicted weapons write a particle effect (`appearance/pt_snow_blast.prt`) as their
//         `explode` event, and five creature voices write a sound with no extension at all
//         (the `sounds` command puts the `.snd` back when the file is there). Everything is
//         kept as the file writes it; a reader takes the extension it wants.
//   ASND  the object's own looping sound                     (762)
//   DSTR > INFO   the client effect played when it is destroyed
//   FORM DAMA     a damage state: INFO (two floats, the damage band, then a client
//                 effect), APPR (an appearance), HARD (a hardpoint), PSOR (a place),
//                 ASND (that state's looping sound)
//   FORM VTHR     a thruster for one damage state: INFO (one float, the damage level),
//                 HOBJ appearances, and VSND: a name then eight sound paths, the first
//                 four the idle, speed-up, slow-down and run loops and the last four
//                 the sounds of the damage that state stands for (empty on an undamaged
//                 state). It reads as four sounds and is eight.
//   FORM VGEF > INFO   a ground effect: one byte (1 over water), a sound, the effect's
//                 name and its appearance
//   FORM ENGS > FORM INTS > INFO   a ship engine part: a slot or hardpoint name, the
//                 sound, then six floats, undecoded: (0.7, 1, -16, 0, 0.3, 0.3) on every
//                 undamaged engine and (0.5, 0.8, -16, 0, 0.3, 0.3) on every damage loop
//   FORM INTS > INFO   the same shape at the top level, on a hull rather than a part
import { childrenOf, find, findAll, isForm, parseIff, readCString } from './iff.mjs';
import { parseDatatable } from './datatable.mjs';
import { parseClientEffect } from './shipdata.mjs';
import { readTemplate, stringParam } from './objtemplate.mjs';

// A path as the client data writes it: backslashes, a leading slash, and on the wing
// forms one or two `@` signs before it (`@@sound/wings_open_xwing.snd`). One file names
// a sound with its extension written twice.
const slash = (s) => s.replace(/\\/g, '/').replace(/^@+/, '').replace(/^\//, '').replace(/\.snd\.snd$/i, '.snd');

/**
 * A sound or client effect path written inside a chunk's bytes, taken from its own folder
 * onward: a float written just before a string reads as printable text too, and a plain run
 * of printable bytes would otherwise put those characters on the front. A fresh regex each
 * time, so no two sweeps share a `lastIndex`.
 */
const soundPaths = () => /(?:sound|voice|clienteffect|music|player_music)[\\/][\w./\\-]+\.(?:snd|cef)/gi;

/** Every C-string in a chunk, in order. */
function strings(d) {
  const out = [];
  let o = 0;
  while (o < d.length) {
    const r = readCString(d, o);
    out.push(r.value);
    o = r.next;
  }
  return out;
}

/** A float parameter of an object template: int8 data type, the delta byte, then the float. */
export function floatParam(buf) {
  return buf && buf.length >= 6 && buf[0] === 1 ? buf.readFloatLE(2) : null;
}

// Some cells of the interior table carry a trailing space inside the sound's own name (eleven rooms
// of the tutorial station do). It is not part of the file name, and left on it the bank has no entry
// for that bed and the room falls back to the shared default.
const path = (s) => (s && s.trim() ? slash(s.trim()) : null);

/**
 * The sound in one client data file, or null when it holds none. Everything is kept as
 * the file names it; nothing is resolved here.
 */
export function parseClientDataSounds(root) {
  if (!isForm(root) || root.type !== 'CLDF') return null;
  const out = { events: {}, ambient: null, damage: [], thrusters: [], ground: [], engines: [], interior: [], destroyed: null, extra: [] };
  const version = root.children.find(isForm) ?? root;
  const known = new Set();
  const keep = (p) => {
    if (p) known.add(p);
    return p;
  };
  for (const child of version.children ?? []) {
    if (!isForm(child)) {
      const d = child.data;
      if (child.tag === 'CEFT' || child.tag === 'CSND' || child.tag === 'EVNT') {
        const [name, file] = strings(d);
        if (name && file) out.events[name] = keep(path(file));
      } else if (child.tag === 'ASND') {
        const [file] = strings(d);
        if (file) out.ambient = keep(path(file));
      }
      continue;
    }
    if (child.type === 'DAMA') {
      const info = find(child, 'INFO');
      const state = { from: 0, to: 0, effect: null, sound: null };
      if (info && info.data.length >= 8) {
        state.from = info.data.readFloatLE(0);
        state.to = info.data.readFloatLE(4);
        state.effect = keep(path(readCString(info.data, 8).value));
      }
      const snd = find(child, 'ASND');
      if (snd) state.sound = keep(path(readCString(snd.data).value));
      if (state.effect || state.sound) out.damage.push(state);
    } else if (child.type === 'VTHR') {
      const info = find(child, 'INFO');
      for (const v of findAll(child, 'VSND')) {
        const s = strings(v.data);
        const t = { level: info && info.data.length >= 4 ? info.data.readFloatLE(0) : 0, name: s[0] ?? '', idle: keep(path(s[1])), accel: keep(path(s[2])), decel: keep(path(s[3])), run: keep(path(s[4])), damaged: s.slice(5, 9).map((x) => keep(path(x))).filter(Boolean) };
        if (t.idle || t.accel || t.decel || t.run || t.damaged.length) out.thrusters.push(t);
      }
    } else if (child.type === 'VGEF') {
      for (const info of childrenOf(child, 'INFO')) {
        const d = info.data;
        if (!d.length) continue;
        const water = d[0] === 1;
        const s = strings(d.subarray(1));
        const g = { water, sound: keep(path(s[0])), name: s[1] ?? '', appearance: path(s[2]) };
        if (g.sound) out.ground.push(g);
      }
    } else if (child.type === 'ENGS' || child.type === 'INTS') {
      const into = child.type === 'ENGS' ? out.engines : out.interior;
      for (const form of child.type === 'ENGS' ? findAll(child, 'INTS') : [child]) {
        for (const info of childrenOf(form, 'INFO')) {
          const d = info.data;
          const a = readCString(d, 0);
          const b = readCString(d, a.next);
          const params = [];
          for (let o = b.next; o + 4 <= d.length; o += 4) params.push(Math.round(d.readFloatLE(o) * 1e4) / 1e4);
          if (b.value) into.push({ slot: a.value, sound: keep(path(b.value)), params });
        }
      }
    } else if (child.type === 'DSTR') {
      const info = find(child, 'INFO');
      if (info) out.destroyed = keep(path(readCString(info.data).value));
    }
  }
  // Anything else the file names (a capital ship's destruction loop under DSEF > ASNL > SDAS,
  // the break-up effects) is kept as a flat list rather than guessed at.
  const sweep = (node) => {
    if (isForm(node)) {
      for (const c of node.children) sweep(c);
      return;
    }
    for (const s of node.data.toString('latin1').match(soundPaths()) ?? []) {
      const p = slash(s);
      if (known.has(p)) continue;
      known.add(p);
      out.extra.push(p);
    }
  };
  sweep(root);
  const empty = !Object.keys(out.events).length && !out.ambient && !out.damage.length && !out.thrusters.length && !out.ground.length && !out.engines.length && !out.interior.length && !out.destroyed && !out.extra.length;
  if (empty) return null;
  for (const k of ['damage', 'thrusters', 'ground', 'engines', 'interior', 'extra']) if (!out[k].length) delete out[k];
  if (!Object.keys(out.events).length) delete out.events;
  if (!out.ambient) delete out.ambient;
  if (!out.destroyed) delete out.destroyed;
  return out;
}

/** Every sound and client effect path one client data entry names. */
export function soundsOfClientData(entry) {
  const out = [];
  for (const p of Object.values(entry.events ?? {})) if (p) out.push(p);
  if (entry.ambient) out.push(entry.ambient);
  if (entry.destroyed) out.push(entry.destroyed);
  for (const d of entry.damage ?? []) for (const p of [d.effect, d.sound]) if (p) out.push(p);
  for (const t of entry.thrusters ?? []) for (const p of [t.idle, t.accel, t.decel, t.run, ...(t.damaged ?? [])]) if (p) out.push(p);
  for (const g of entry.ground ?? []) if (g.sound) out.push(g.sound);
  for (const e of [...(entry.engines ?? []), ...(entry.interior ?? [])]) if (e.sound) out.push(e.sound);
  for (const p of entry.extra ?? []) out.push(p);
  return out;
}

/** Read every client data file that names a sound or a client effect. */
export function readClientData(vfs, { log = () => {} } = {}) {
  const files = [...new Set(vfs.list('clientdata/'))].filter((f) => /\.(cdf|iff)$/i.test(f)).sort();
  const out = {};
  let unreadable = 0;
  for (const f of files) {
    let entry = null;
    try {
      entry = parseClientDataSounds(parseIff(vfs.read(f)));
    } catch {
      unreadable++;
      continue;
    }
    if (entry) out[f] = entry;
  }
  log(`  sounds: ${Object.keys(out).length} of ${files.length} client data files name a sound${unreadable ? ` (${unreadable} unreadable)` : ''}`);
  return out;
}

/**
 * The client effects (`clienteffect/*.cef`) as sounds and a particle. `wanted` narrows
 * the set; null reads them all, which is what the pack holds, so nothing added later has
 * to reconvert to find an effect's sound.
 */
export function readClientEffects(vfs, wanted = null, { log = () => {} } = {}) {
  const files = wanted ? [...wanted] : [...new Set(vfs.list('clienteffect/'))].filter((f) => f.endsWith('.cef'));
  const out = {};
  let withSound = 0;
  for (const f of files.sort()) {
    if (!vfs.has(f)) continue;
    let e;
    try {
      e = parseClientEffect(parseIff(vfs.read(f)));
    } catch {
      continue;
    }
    if (!e.sounds.length && !e.particles.length) continue;
    out[f] = { ...(e.sounds.length ? { sounds: e.sounds } : {}), ...(e.particles.length ? { particle: e.particles[0] } : {}) };
    if (e.sounds.length) withSound++;
  }
  log(`  sounds: ${Object.keys(out).length} client effects, ${withSound} of them with a sound`);
  return out;
}

/**
 * The sounds the scene files name (`scene/*.iff`), file by file. Seven of them are in the
 * retail archives and three name sounds: `hyperspace.iff` names the jump's three stage
 * sounds and the two `game_music_manager*` files name the combat score and one seashore
 * bed. Their layout is not decoded; the names are swept out of the chunks in the order they
 * are written, which for the jump is begin, end, the 2D out, matching the STG1/STG3/STG2
 * order `space.mjs` reads out of the same file.
 */
export function readSceneSounds(vfs, { log = () => {} } = {}) {
  const out = {};
  for (const f of [...new Set(vfs.list('scene/'))].filter((p) => p.endsWith('.iff')).sort()) {
    const names = [];
    const seen = new Set();
    const take = (buf) => {
      for (const s of buf.toString('latin1').match(soundPaths()) ?? []) {
        const p = slash(s);
        if (seen.has(p)) continue;
        seen.add(p);
        names.push(p);
      }
    };
    let root = null;
    try {
      root = parseIff(vfs.read(f));
    } catch {
      root = null;
    }
    if (root) {
      const walk = (n) => {
        if (isForm(n)) for (const c of n.children) walk(c);
        else take(n.data);
      };
      walk(root);
    } else take(vfs.read(f));
    if (names.length) out[f] = names;
  }
  log(`  sounds: ${Object.keys(out).length} scene files name a sound`);
  return out;
}

/** A terrain surface template (`abstract/terrain_surface/<name>.iff`, FORM STER): its type and cover. */
export function parseSurfaceTemplate(root) {
  const t = readTemplate(root);
  return { type: stringParam(t.params.get('surfaceType')), cover: floatParam(t.params.get('cover')) };
}

const table = (vfs, p) => {
  if (!vfs.has(p)) return null;
  try {
    return parseDatatable(parseIff(vfs.read(p)));
  } catch {
    return null;
  }
};

/** The room table: a row per building and cell, with the `default` rows as fallbacks. */
export function roomRows(t) {
  const col = (r, re) => {
    for (const [k, v] of Object.entries(r)) if (re.test(k)) return v;
    return '';
  };
  return t.rows.map((r) => ({
    pob: r.PobName ?? '',
    cell: r['Cell Name'] ?? '',
    day: path(col(r, /^Day .*Sound/i)) ?? null,
    night: path(col(r, /^Night .*Sound/i)) ?? null,
    music: path(col(r, /^First Music/i)) ?? null,
    surface: r['Surface Type'] ?? '',
    // The client's echo settings are not in the archives: 7 is Mos Eisley's cantina and the
    // four capitol lobbies, 22 every other room. What each means is the runtime's to invent.
    room: r['Room Type'] ?? 0,
  }));
}

/**
 * Every table that puts a sound somewhere: the rooms, the interface, the melee and
 * ranged weapon effects, the door styles, a ship's power and hit sounds, each chassis's
 * flyby, and the nine terrain surface templates.
 */
export function readSoundTables(vfs, { log = () => {} } = {}) {
  const out = { rooms: [], interface: {}, melee: [], ranged: [], doorStyles: {}, shipPower: {}, shipHits: {}, flyby: {}, hitGroups: {}, surfaces: {}, doorEffects: [] };

  const interior = table(vfs, 'datatables/interior/interior.iff');
  if (interior) out.rooms = roomRows(interior);

  const ui = table(vfs, 'datatables/player/sounds.iff');
  if (ui) for (const r of ui.rows) if (r.name && r.path) out.interface[r.name] = path(r.path);

  const melee = table(vfs, 'datatables/weapon/combat_effects_melee.iff');
  if (melee) {
    for (const r of melee.rows) {
      out.melee.push({ weapon: r.Weapon, attack: path(r['Attack Sound']), attackPitch: r['Attack Sound Pitch'] ?? 0, hit: path(r['Hit Target Sound']), hitPitch: r['Hit Sound Pitch'] ?? 0 });
    }
  }
  const ranged = table(vfs, 'datatables/weapon/combat_effects_ranged.iff');
  if (ranged) {
    for (const r of ranged.rows) {
      out.ranged.push({ weapon: r.Weapon, muzzle: path(r['Muzzle Sound']), hit: path(r['Hit Target Sound']), nothing: path(r['Hit Nothing Sound']), ricochet: path(r['Hit Ricochet Sound']) });
    }
  }

  const doors = table(vfs, 'datatables/appearance/door_style.iff');
  if (doors) {
    for (const r of doors.rows) {
      const e = { openBegin: path(r.openBeginEffect), openEnd: path(r.openEndEffect), closeBegin: path(r.closeBeginEffect), closeEnd: path(r.closeEndEffect) };
      if (Object.values(e).some(Boolean)) out.doorStyles[r.doorStyleName] = e;
      for (const p of Object.values(e)) if (p) out.doorEffects.push(p);
    }
  }

  const power = table(vfs, 'datatables/space/ship_power_sounds.iff');
  if (power) for (const r of power.rows) out.shipPower[r.type] = Object.fromEntries(power.columns.filter((c) => c !== 'type').map((c) => [c, path(r[c])]));

  const hits = table(vfs, 'datatables/space/ship_hit_sounds.iff');
  // The hit table's fallback row has an empty type where the power table spells its `default`
  // out; it is written under the same name here so a lookup in either is the same code.
  if (hits) for (const r of hits.rows) out.shipHits[r.type || 'default'] = { shield: path(r.shield), armor: path(r.armor), component: path(r.component), chassis: path(r.chassis) };

  const chassis = table(vfs, 'datatables/space/ship_chassis.iff');
  if (chassis) {
    for (const r of chassis.rows) {
      if (r.flyby_sound) out.flyby[r.name] = path(r.flyby_sound);
      if (r.hit_sound_group) out.hitGroups[r.name] = r.hit_sound_group;
    }
  }

  for (const f of [...new Set(vfs.list('abstract/terrain_surface/'))].filter((p) => p.endsWith('.iff')).sort()) {
    try {
      const s = parseSurfaceTemplate(parseIff(vfs.read(f)));
      if (s.type) out.surfaces[f] = s;
    } catch {
      /* a surface template that will not parse names no surface */
    }
  }

  log(`  sounds: ${out.rooms.length} room rows over ${new Set(out.rooms.map((r) => r.pob)).size} buildings, ${Object.keys(out.interface).length} interface sounds, ${out.melee.length} melee and ${out.ranged.length} ranged weapon rows, ${Object.keys(out.doorStyles).length} door styles, ${new Set(Object.values(out.flyby)).size} flyby sounds, ${Object.keys(out.surfaces).length} terrain surfaces`);
  return out;
}
