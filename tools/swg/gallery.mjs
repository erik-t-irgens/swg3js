// The gallery: a flat development world with every animation from both games on a grid of
// player models, every player house, every vehicle and every weapon, each labelled. This module
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

/**
 * Build the gallery pack. `deps.convert(template)` converts one template into the pack's models,
 * returning { model, radius, height } or { skip }; `deps.convertAnims(file, source)` writes the
 * animation model for 'swg' or 'jka' and returns its clip descriptions; `deps.copySky()` copies
 * the sky. Sections go one after another along +z from the origin, in SWG coordinates.
 */
export function buildGallery({ log = () => {}, only = ['houses', 'vehicles', 'weapons', 'anims'], limit = Infinity, existing = null }, deps) {
  const objects = [];
  const sections = [];
  let z = 0;
  // A section not being rebuilt keeps what the pack already has (its items and their models), so
  // `--only=vehicles` refreshes the vehicles without emptying the rest of the gallery.
  const section = (id, title, templates, { gap, rowWidth, y = 0 }) => {
    const items = [];
    let skipped = 0;
    const reasons = new Map();
    const kept = !only.includes(id) ? existing?.sections?.find((s) => s.id === id) : null;
    if (!only.includes(id) && !kept) return;
    if (kept) {
      for (const it of kept.items) items.push({ template: it.template, model: it.model, radius: it.radius, height: it.height, label: it.label ?? labelOf(it.template), ...(it.riderPose ? { riderPose: it.riderPose, seats: it.seats } : {}) });
      deps.keepModels?.([...new Set(items.map((it) => it.model))]);
    } else {
      for (const template of templates.slice(0, limit)) {
        const r = deps.convert(template);
        if (!r || r.skip) {
          skipped++;
          const why = String(r?.skip ?? 'failed').replace(/:.*$/, '').slice(0, 60);
          reasons.set(why, (reasons.get(why) ?? 0) + 1);
          continue;
        }
        // A vehicle carries how its rider sits (the mount tables' rider pose), for the riding clip.
        items.push({ template, model: r.model, radius: r.radius, height: r.height, label: labelOf(template), ...(r.riderPose ? { riderPose: r.riderPose, seats: r.seats } : {}) });
      }
    }
    const { placed, depth } = layOutRows(items, { gap, rowWidth, startZ: z });
    for (const p of placed) objects.push({ template: p.template, model: p.model, x: p.x, y, z: p.z, q: [1, 0, 0, 0], radius: p.radius });
    sections.push({ id, title, z, depth, items: placed.map((p) => ({ label: p.label, template: p.template, model: p.model, x: p.x, y, z: p.z, radius: p.radius, height: p.height, ...(p.riderPose ? { riderPose: p.riderPose, seats: p.seats } : {}) })) });
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
  deps.copySky?.();
  return { objects, sections, anims };
}
