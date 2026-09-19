// The player ships: every ship a player can fly (object/ship/player/), each converted to a model
// with its interior noted when the ship has one (a .pob the multi-crew ships carry, converted
// alongside as a portal building), sorted into a class by its name. The conversions themselves
// are handed in so this stays testable without the archives.
import { hungSummary } from './shipparts.mjs';
import { fitSummary } from './shipfit.mjs';

/** The classes a ship falls in, from its template name. */
export const SHIP_CLASSES = {
  fighter: 'Starfighters',
  bomber: 'Bombers and heavy fighters',
  freighter: 'Freighters and transports',
  gunship: 'Gunships and multi-crew ships',
  shuttle: 'Shuttles and yachts',
  other: 'Other ships',
};

/** The class a ship is, from its template or appearance name. */
export function shipClassOf(name) {
  const n = name.toLowerCase();
  if (/yt1300|yt_1300|yt2400|yt_2400|ykl37|ykl_37|firespray|freighter|transport|belbullab|g1a|dunelizard/.test(n)) return 'freighter';
  if (/gunship|gunboat|corvette|lambda|arc170|arc_170|decimator|nova_courier|novacourier|hutt_heavy|hutt_medium/.test(n)) return 'gunship';
  if (/y-?wing|ywing|b-?wing|bwing|tie_bomber|tiebomber|tie_defender|advanced|heavy|kimogila|ixiyen|rihkxyrk/.test(n)) return 'bomber';
  if (/x-?wing|xwing|a-?wing|awing|z95|z-?95|tie_|tie\b|headhunter|scyk|dunelizard|vaksai|jedi_starfighter|eta|delta|naboo_n1|n1|starfighter|interceptor|light/.test(n)) return 'fighter';
  if (/shuttle|yacht|sorosuub|luxury/.test(n)) return 'shuttle';
  return 'other';
}

/** A readable label for a ship template: the file's own name without the shared_player_ prefix. */
export function shipLabelOf(template) {
  return template.replace(/^.*\//, '').replace(/^shared_/, '').replace(/^player_/, '').replace(/\.iff$/, '');
}

/** Ships that fire the Empire's green bolts, by their id. */
export const IMPERIAL_SHIP = /(^|_)tie|imperial|lambda|star_destroyer|decimator/i;

/**
 * The weapon a ship fires, from the game's weapon table (datatables/space/ship_weapon_components):
 * the blaster named for the ship's family when there is one (wpn_awing_blaster, wpn_tiefighter_basic,
 * wpn_z95_blaster), else the light blaster in the faction's colour, else the generic gun.
 */
export function defaultWeaponFor(id, weaponNames) {
  const family = id.replace(/^(advanced|basic|prototype|player)_/, '').replace(/_modified$|_imperial_guard$|_longprobe$/, '');
  const compact = family.replace(/_/g, '');
  const gun = (w) => /blaster|basic|cannon/i.test(w) && !/missile|launcher|countermeasure|mining|tractor/i.test(w);
  const own = weaponNames.find((w) => {
    const b = w.replace(/^wpn_/, '');
    return (b.startsWith(`${family}_`) || b.startsWith(compact)) && gun(b);
  });
  if (own) return own;
  const want = IMPERIAL_SHIP.test(id) ? 'wpn_light_blaster_green' : 'wpn_light_blaster';
  if (weaponNames.includes(want)) return want;
  return weaponNames.includes('wpn_generic') ? 'wpn_generic' : weaponNames[0] ?? null;
}

/**
 * The reach of a bolt's particle effect ahead of the projectile, in metres: the client draws a
 * space bolt as a quad centred ahead of the projectile's own point, so a bolt's visual tip is its
 * emitter's forward offset plus the quad's half length, the furthest of its emitters.
 */
export function boltReach(effect) {
  let reach = 0;
  for (const g of effect.groups ?? []) {
    for (const e of g.emitters ?? []) {
      const quad = e.particle?.quad;
      if (!quad) continue;
      const at = (wf) => (wf?.points?.length ? wf.points[0][1] : 0);
      reach = Math.max(reach, (at(e.translationZ) + at(quad.length)) * (effect.scale || 1));
    }
  }
  return reach;
}

/**
 * Build the ships manifest. `deps.convert(template)` converts a template into the pack's models,
 * returning { model, file, bounds } or { skip }; `deps.interiorOf(template)` names the ship's
 * interior layout (a .pob path) or null; `deps.convertInterior(template, pob)` converts it,
 * returning { file, cells } or { skip }; `deps.extrasOf(template)` converts what the ship's client
 * data hangs on the hull (wings, an engine appearance) and its cockpit frame, returning
 * { attachments, thrusters, contrails, cockpit, notes } (and, once assembled by shipparts.mjs,
 * `chassis` and `wingOpenSpeedFactor`; once the chassis tables are read for customization, `fit`,
 * copied onto the ship when set, null for a ship with no tables); `deps.weaponOf(id)` names the weapon the ship
 * fires as { name, projectile, speed, range } or null. Ships whose exterior fails are listed with why.
 */
export function buildShips(templates, deps, { log = () => {}, limit = Infinity } = {}) {
  const ships = [];
  const skipped = [];
  for (const template of templates.slice(0, limit)) {
    const r = deps.convert(template);
    if (!r || r.skip) {
      skipped.push({ template, why: String(r?.skip ?? 'failed').slice(0, 120) });
      continue;
    }
    const id = shipLabelOf(template);
    const pob = deps.interiorOf?.(template) ?? null;
    let interior = null;
    if (pob) {
      const i = deps.convertInterior?.(template, pob) ?? { skip: 'no interior conversion' };
      interior = i.skip ? { pob, failed: i.skip } : { pob, file: i.file, cells: i.cells ?? 0 };
    } else if (r.cells) interior = { hull: true, cells: r.cells };
    const b = r.bounds;
    const length = b ? b.max[2] - b.min[2] : 0;
    // What hangs on the hull and the cockpit frame, from the ship's client data and cockpit files.
    const extras = deps.extrasOf?.(template, r) ?? { attachments: [], thrusters: [], contrails: [], cockpit: null, notes: [] };
    const weapon = deps.weaponOf?.(id) ?? null;
    // `chassis` (null when the ship has none) is on every ship whose parts were assembled as a tree
    // (shipparts.mjs): status tells a ship converted before by its absence.
    ships.push({ id, label: id.replace(/_/g, ' '), template, class: shipClassOf(`${template} ${r.model}`), file: r.file, model: r.model, bounds: b, length: Number(length.toFixed(2)), interior, ...(extras.chassis !== undefined ? { chassis: extras.chassis, wingOpenSpeedFactor: extras.wingOpenSpeedFactor ?? 1 } : {}), attachments: extras.attachments, thrusters: extras.thrusters, contrails: extras.contrails, cockpit: extras.cockpit, weapon, ...(extras.fit ? { fit: extras.fit } : {}), ...(extras.damage ? { damage: extras.damage } : {}), ...(extras.destroyed ? { destroyed: extras.destroyed } : {}), ...(extras.notes.length ? { notes: extras.notes } : {}) });
    const hung = extras.attachments.length ? `, ${hungSummary(extras.attachments)}` : '';
    // The slots, looks, droid socket and paint, once the converter reads the chassis tables for them.
    const fitted = extras.fit !== undefined ? `, ${fitSummary(extras.fit)}` : '';
    log(`${id}: ${SHIP_CLASSES[shipClassOf(template)]}, ${length.toFixed(1)} m${interior ? interior.failed ? `, interior ${pob} failed: ${interior.failed}` : interior.hull ? `, ${interior.cells} rooms in the hull model` : `, interior ${pob}: ${interior.cells} cells` : ', no interior named by its template'}${hung}${fitted}${extras.thrusters.length ? `, thrusters at ${extras.thrusters.join(' ')}` : ''}${extras.cockpit ? ', cockpit frame' : ''}${weapon ? `, fires ${weapon.name} (projectile ${weapon.projectile}, ${weapon.speed} m/s to ${weapon.range} m)` : ''}${extras.notes.length ? `\n   ${extras.notes.join('\n   ')}` : ''}`);
  }
  ships.sort((a, b) => a.class.localeCompare(b.class) || a.id.localeCompare(b.id));
  return { ships, skipped };
}
