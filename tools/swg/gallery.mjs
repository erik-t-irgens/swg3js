// The gallery: a flat development world with every animation from both games on a grid of
// player models, every player house, every vehicle, every weapon and every structure with rooms
// (the world's buildings, the stations, the ships with interiors), each labelled. This module
// sorts the animations into categories, lays exhibits out in rows, and writes the gallery pack
// (a manifest and layout the game loads like any planet pack, plus gallery.json for the labels
// and the animation grid). The conversions themselves are the converter's usual ones, handed in
// by the command so this file stays testable without the archives.

/** The category an SWG clip belongs to, from its name. */
export function swgAnimCategory(name) {
  const n = name.toLowerCase();
  if (/pistol/.test(n)) return 'Pistol';
  if (/rifle|carbine/.test(n)) return 'Rifle & carbine';
  if (/heavy_weapon|launch|thrown?_|grenade/.test(n)) return 'Heavy & thrown weapons';
  if (/sword_1h|1hand|(^|_)1h(_|$)/.test(n)) return 'One-hand melee';
  if (/sword_2h|2hand|(^|_)2h(_|$)/.test(n)) return 'Two-hand melee';
  if (/polearm|(^|_)pole_/.test(n)) return 'Polearm';
  if (/lightsaber|saber|jedi|force/.test(n)) return 'Force & lightsaber';
  if (/unarmed|punch|kick|brawl/.test(n)) return 'Unarmed';
  if (/^loop_|^walk|^run|^idle|^stand|^jump|^crouch|^prone|^kneel|^sit|^swim|riding|^ridin/.test(n)) return 'Locomotion & postures';
  if (/^emt_|^emote/.test(n)) return 'Emotes';
  if (/^rea_|get_hit|dodge|stumble|knock/.test(n)) return 'Reactions';
  if (/^trn_/.test(n)) return 'Transitions';
  if (/death|incap|dead|dying/.test(n)) return 'Death & incapacitation';
  if (/^cbt_|combat/.test(n)) return 'Combat (generic)';
  if (/skill|craft|heal|medic|dance|music|instrument|sample|survey|harvest/.test(n)) return 'Skills, dance, music';
  return 'Other';
}

/** The category a Jedi Academy clip belongs to, from its name. */
export function jkaAnimCategory(name) {
  const n = name.toUpperCase();
  if (/^TORSO_/.test(n)) return 'Torso only (weapons)';
  if (/^LEGS_/.test(n)) return 'Legs only';
  if (/^FACE_/.test(n)) return 'Face';
  if (/SPECIAL|SABERPROTECT|SOULCAL|SPINATTACK|JUMPATTACK|BUTTERFLY|ARIAL|CARTWHEEL|LUNGE|FORCELEAP|STABDOWN|SLASHDOWN|STABBACK|ATTACK_BACK|ROLL_STAB|A7_KICK|A7_HILT|A6_FB|A6_LR|CROUCHATTACK/.test(n)) return 'Saber specials & katas';
  const style = /^BOTH_([ASRTB])(\d)_/.exec(n) ?? /^BOTH_(P|K|B)(\d)_S\d/.exec(n);
  if (/^BOTH_P\d_S\d|^BOTH_K\d_S\d|PARRY|BLOCK|DEFLECT/.test(n)) return 'Parries & blocks';
  if (style) return `Saber style ${style[2]}: swings, wind-ups, returns, arcs, bounces`;
  if (/STANCE|^BOTH_STAND|IDLE/.test(n)) return 'Stances & idles';
  if (/WALK|RUN|CROUCH/.test(n)) return 'Locomotion';
  if (/JUMP|INAIR|LAND|FLIP|ROLL|WALL|REBOUND/.test(n)) return 'Jumps, rolls, wall moves';
  if (/DEATH|DEAD|PAIN|DIE|KNOCKDOWN|GETUP|FALL/.test(n)) return 'Deaths, pain, knockdowns';
  if (/SABERPULL|SABERTHROW|FORCEPUSH|FORCEPULL|FORCEGRIP|LIGHTNING|FORCEHEAL|MINDTRICK|FORCE_/.test(n)) return 'Force powers';
  if (/TAUNT|GLOAT|BOW|MEDITATE|GESTURE|FLOURISH|SHOWOFF|VICTORY/.test(n)) return 'Taunts & gestures';
  if (/SWIM|LADDER|CLIMB|SIT|SLEEP|TALK|CONSOLE|BUTTON/.test(n)) return 'Postures & interactions';
  return 'Other';
}

/** Group clip descriptions by category, categories in a stable order and clips sorted by name. */
export function groupByCategory(clips, categoryOf) {
  const groups = new Map();
  for (const c of clips) {
    const cat = categoryOf(c.name);
    (groups.get(cat) ?? groups.set(cat, []).get(cat)).push(c);
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([category, items]) => ({ category, clips: items.sort((a, b) => a.name.localeCompare(b.name)) }));
}

/**
 * Lay exhibits out in rows: each takes a slot as wide as it is (its radius plus a gap on both
 * sides), rows wrap at `rowWidth`, and rows are as deep as their deepest exhibit. Returns each
 * exhibit's centre, and the depth the section takes. Radii in metres; `gap` is the clear space
 * between neighbours.
 */
export function layOutRows(items, { rowWidth = 240, gap = 3, startZ = 0 } = {}) {
  const placed = [];
  let x = 0;
  let z = startZ;
  let rowDepth = 0;
  let rowRadius = 0;
  for (const it of items) {
    const r = Math.max(0.5, it.radius ?? 1);
    const width = 2 * r + gap;
    if (x > 0 && x + width > rowWidth) {
      z += rowDepth + gap;
      x = 0;
      rowDepth = 0;
    }
    placed.push({ ...it, x: x + r + gap / 2, z: z + r + gap / 2 });
    x += width;
    rowDepth = Math.max(rowDepth, 2 * r + gap);
    rowRadius = Math.max(rowRadius, r);
  }
  return { placed, depth: z + rowDepth + gap - startZ, widest: rowRadius };
}

/** Templates under a prefix that are the shared client templates (one per object). */
export function galleryTemplates(vfs, prefix, { match = null, limit = Infinity } = {}) {
  const out = [];
  for (const name of vfs.list(prefix)) {
    if (!/\/shared_[^/]+\.iff$/.test(name) || !name.startsWith(prefix)) continue;
    if (match && !match.test(name)) continue;
    out.push(name);
    if (out.length >= limit) break;
  }
  return out;
}

/** A readable label for a template: the file's own name without the shared_ prefix. */
export function labelOf(template) {
  return template.replace(/^.*\//, '').replace(/^shared_/, '').replace(/\.iff$/, '');
}

/** Whether a portal cell's name marks it as a lift shaft (elevator1, reactorlift, empelevator, turbolift). */
export function isLiftCell(name) {
  return /elev|lift/i.test(name ?? '');
}

/**
 * The structures with rooms: every template (buildings, stations, the ships with interiors) whose
 * chain names a portal layout, one exhibit per layout since the layouts are shared between
 * templates (the same house on three planets, a station in every zone). `pobOf(template)` gives
 * a template's layout file or null, `cellsOf(pob)` its cell names. The player houses are left to
 * their own section unless `withHouses`. A layout with lift cells is labelled so, which is how
 * the ones with elevators are found on the ground.
 */
export function interiorLayouts(templates, { pobOf, cellsOf = () => [], withHouses = false }) {
  const byPob = new Map();
  for (const template of templates) {
    if (!withHouses && /^object\/building\/player\//.test(template)) continue;
    const pob = pobOf(template);
    if (!pob) continue;
    const key = pob.toLowerCase().replace(/\\/g, '/');
    if (byPob.has(key)) {
      byPob.get(key).shared.push(template);
      continue;
    }
    let cells = [];
    try {
      cells = cellsOf(pob) ?? [];
    } catch {
      cells = [];
    }
    const lifts = cells.filter(isLiftCell);
    byPob.set(key, { template, appearance: pob, label: `${labelOf(template)}${lifts.length ? ` (lift${lifts.length > 1 ? 's' : ''})` : ''}`, lifts, cells: cells.length, shared: [] });
  }
  return [...byPob.values()];
}

export const GALLERY_SECTIONS = ['houses', 'vehicles', 'weapons', 'anims', 'interiors'];

/**
 * How the gallery converts a skeletal model (every one it has is a vehicle: the walkers, the
 * basilisk, the jetpacks and the pod racers): its own clips when it walks with them (`clips`, the
 * list the creatures keep), and its body mesh's hardpoints kept as hp:<name> nodes under their
 * joints, as the creatures command keeps a mount's. Every skinned pod racer's mesh carries the game's
 * own seat point, `player`, on its cockpit joint `body`, and the garage seats its pilot there
 * (src/vehicles/podSeat.ts); a gallery converted before this dropped it. `paint` (a vehicle's, when the
 * run builds the vehicles) bakes a paint shader as a ship's is, for a walker whose shaders take colours.
 */
export function gallerySatOptions(animated, clips, paint = false) {
  return { animations: animated ? clips : 'none', hardpoints: true, ...(paint ? { paint: true } : {}) };
}

/**
 * A skeletal model's entry in the gallery's manifest, from what `convertSat` said of it (`info`): its
 * box, its triangle count, the names of the hardpoints its conversion kept (which is how `status` tells
 * a gallery converted before they were kept), its clips when it walks with them, and why it failed when
 * no triangle survived.
 */
export function skeletalModelEntry(id, source, info, animated) {
  const triangles = (info.meshes ?? []).reduce((a, m) => a + m.triangles, 0);
  return {
    id,
    source,
    file: `${id}.glb`,
    bounds: info.bounds ?? { min: [-1, 0, -1], max: [1, 2, 1] },
    triangles,
    skeletal: true,
    hardpoints: (info.hardpoints ?? []).map((h) => h.name),
    ...(animated ? { clips: info.animations, clipSpeeds: info.clipSpeeds ?? {} } : {}),
    ...(triangles ? {} : { failed: `no triangles (${[...(info.missing ?? []), ...(info.skipped ?? [])].slice(0, 3).join('; ') || 'no meshes'})` }),
  };
}

/**
 * Whether a gallery's skinned pod racers carry the game's own seat point: how many of a manifest's
 * models are skeletal pods (named for a pod, as the garage names a pod's kind) and how many of those
 * list `player` among the hardpoints their conversion kept. A gallery converted before the hardpoints
 * were kept lists none on any of them, which is what `status` asks for the gallery again over.
 */
export function podSeatStatus(models) {
  const pods = (models ?? []).filter((m) => m?.skeletal && /pod_?racer|podracer/i.test(String(m.id ?? '')));
  const seated = pods.filter((m) => Array.isArray(m.hardpoints) && m.hardpoints.some((h) => String(h).toLowerCase() === 'player'));
  return { pods: pods.length, seated: seated.length };
}

/**
 * The shape of a gallery's vehicle paint, stamped on its manifest (`paintFormat`) when a run built the
 * vehicles: each vehicle model whose shaders take colours carries `paint: { shaders, variables }` (the ships
 * pack's own shape for a hull's paint) and the gallery's customize.json carries their recipes. 1: the first.
 */
export const GALLERY_PAINT_FORMAT = 1;

/**
 * A vehicle model's paint from the shaders its conversion kept, in their order: the ones `maker.isPaint` says
 * are paint (which writes each one's recipe the first time it meets it), with one variable list over them
 * (`maker.variablesOf`, mergePaintVariables). Null when none is: most of the gallery's vehicles take no colour
 * (measured over the retail archives: 24 of the 57 vehicle templates, on 21 models, do).
 *  -> { paint: { shaders, variables } | null, notes }
 */
export function vehiclePaint(shaders, maker) {
  const own = [];
  for (const sh of shaders ?? []) if (sh && !own.includes(sh) && maker.isPaint(sh)) own.push(sh);
  if (!own.length) return { paint: null, notes: [] };
  const merged = maker.variablesOf(own);
  if (!merged.variables.length) return { paint: null, notes: merged.notes };
  return { paint: { shaders: own, variables: merged.variables }, notes: merged.notes };
}

/**
 * Whether a gallery's vehicles carry their paint, as `status` reads it: a gallery with vehicles whose manifest
 * has no `paintFormat` (or an older one) was converted before a speeder could be painted, so every speeder and
 * walker whose shaders take colours shows its uncoloured main texture and has no paint page. A gallery that has
 * no vehicles section asks for nothing.
 *  -> { vehicles, painted, stale, why }
 */
export function galleryPaintStatus(manifest, index) {
  const vehicles = (index?.sections ?? []).find((s) => s?.id === 'vehicles')?.items?.length ?? 0;
  const painted = (manifest?.categories?.layout ?? []).filter((m) => m?.paint?.variables?.length).length;
  const stale = vehicles > 0 && (Number(manifest?.paintFormat) || 0) < GALLERY_PAINT_FORMAT;
  return { vehicles, painted, stale, why: stale ? `the gallery's ${vehicles} vehicles were converted before a speeder could be painted: the ones whose shaders take colours show their uncoloured texture and have no paint page` : '' };
}

/**
 * Build the gallery pack. `deps.convert(template, appearance?)` converts one template into the
 * pack's models (from the given appearance file rather than the template's own when one is
 * named), returning { model, radius, height } or { skip }; `deps.convertAnims(file, source)`
 * writes the animation model for 'swg' or 'jka' and returns its clip descriptions;
 * `deps.interiors()` lists the structures with rooms (see interiorLayouts); `deps.copySky()`
 * copies the sky. Sections go one after another along +z from the origin, in SWG coordinates.
 */
export function buildGallery({ log = () => {}, only = GALLERY_SECTIONS, limit = Infinity, existing = null }, deps) {
  const objects = [];
  const sections = [];
  let z = 0;
  // A section not being rebuilt keeps what the pack already has (its items and their models), so
  // `--only=vehicles` refreshes the vehicles without emptying the rest of the gallery.
  // Exhibits are templates, or { template, appearance, label } for one shown from a named file.
  const section = (id, title, templates, { gap, rowWidth, y = 0, bigFirst = false }) => {
    const items = [];
    let skipped = 0;
    const reasons = new Map();
    const kept = !only.includes(id) ? existing?.sections?.find((s) => s.id === id) : null;
    if (!only.includes(id) && !kept) return;
    if (kept) {
      for (const it of kept.items) items.push({ template: it.template, model: it.model, radius: it.radius, height: it.height, label: it.label ?? labelOf(it.template), ...(it.riderPose ? { riderPose: it.riderPose, seats: it.seats } : {}), ...(it.lifts ? { lifts: it.lifts } : {}) });
      deps.keepModels?.([...new Set(items.map((it) => it.model))]);
    } else {
      for (const entry of templates.slice(0, limit)) {
        const it = typeof entry === 'string' ? { template: entry } : entry;
        const r = deps.convert(it.template, it.appearance);
        if (!r || r.skip) {
          skipped++;
          const why = String(r?.skip ?? 'failed').replace(/:.*$/, '').slice(0, 60);
          reasons.set(why, (reasons.get(why) ?? 0) + 1);
          continue;
        }
        // A vehicle carries how its rider sits (the mount tables' rider pose), for the riding clip; a structure its lift cells.
        items.push({ template: it.template, model: r.model, radius: r.radius, height: r.height, label: it.label ?? labelOf(it.template), ...(r.riderPose ? { riderPose: r.riderPose, seats: r.seats } : {}), ...(it.lifts?.length ? { lifts: it.lifts } : {}) });
      }
    }
    // A row is as deep as its deepest exhibit: with the structures sorted biggest first the giants
    // share rows and the small ones pack close, rather than a hut beside a Star Destroyer in every row.
    if (bigFirst) items.sort((a, b) => b.radius - a.radius);
    const { placed, depth } = layOutRows(items, { gap, rowWidth, startZ: z });
    for (const p of placed) objects.push({ template: p.template, model: p.model, x: p.x, y, z: p.z, q: [1, 0, 0, 0], radius: p.radius });
    sections.push({ id, title, z, depth, items: placed.map((p) => ({ label: p.label, template: p.template, model: p.model, x: p.x, y, z: p.z, radius: p.radius, height: p.height, ...(p.riderPose ? { riderPose: p.riderPose, seats: p.seats } : {}), ...(p.lifts ? { lifts: p.lifts } : {}) })) });
    log(`${title}: ${placed.length} placed${kept ? ' (kept from the last build)' : ''}${skipped ? `, ${skipped} skipped (${[...reasons.entries()].map(([why, n]) => `${n} ${why}`).join('; ')})` : ''}, rows from z ${z} to ${Math.round(z + depth)}`);
    z += depth + 30;
  };
  const anims = {};
  const keptAnims = !only.includes('anims') ? existing?.anims : null;
  if (only.includes('anims') || keptAnims) {
    // The animation grid sits nearest the arrival point; the game lays the mannequins out from these lists.
    anims.origin = { x: 0, z };
    for (const source of ['swg', 'jka']) {
      if (keptAnims) {
        if (keptAnims[source]) anims[source] = keptAnims[source];
        continue;
      }
      const r = deps.convertAnims(source);
      if (!r) continue;
      anims[source] = { file: r.file, categories: groupByCategory(r.clips, source === 'swg' ? swgAnimCategory : jkaAnimCategory) };
      log(`${source} animations: ${r.clips.length} clips in ${anims[source].categories.length} categories -> ${r.file}`);
    }
    if (keptAnims) log('animations: kept from the last build');
    // Room for the grid: rows of 24 at 2 m, a row every 3 m, a break between categories.
    const total = ['swg', 'jka'].reduce((n, s) => n + (anims[s]?.categories.reduce((m, c) => m + Math.ceil(c.clips.length / 24) * 3 + 6, 0) ?? 0), 0);
    z += total + 30;
  }
  section('weapons', 'Weapons', only.includes('weapons') ? deps.templates('object/weapon/') : [], { gap: 1.5, rowWidth: 120, y: 1.1 });
  section('vehicles', 'Vehicles', only.includes('vehicles') ? deps.templates('object/mobile/vehicle/') : [], { gap: 4, rowWidth: 200 });
  section('houses', 'Player houses', only.includes('houses') ? deps.templates('object/building/player/') : [], { gap: 8, rowWidth: 400 });
  // Every other structure with rooms, one per layout: the world's buildings, the space stations
  // and the ships with interiors, with the ones that have lift shafts labelled. The biggest
  // (a Star Destroyer's rooms) are kilometres across, so the rows are two kilometres wide with
  // the giants first, and the field runs a dozen kilometres south; the labels and the map find things.
  section('interiors', 'Interiors: every structure with rooms', only.includes('interiors') ? (deps.interiors?.() ?? []) : [], { gap: 12, rowWidth: 2000, bigFirst: true });
  deps.copySky?.();
  return { objects, sections, anims };
}
