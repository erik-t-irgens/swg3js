// The player ships: every ship a player can fly (object/ship/player/), each converted to a model
// with its interior noted when the ship has one (a .pob the multi-crew ships carry, converted
// alongside as a portal building), sorted into a class by its name. The conversions themselves
// are handed in so this stays testable without the archives.

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

/**
 * Build the ships manifest. `deps.convert(template)` converts a template into the pack's models,
 * returning { model, file, bounds } or { skip }; `deps.interiorOf(template)` names the ship's
 * interior layout (a .pob path) or null; `deps.convertInterior(template, pob)` converts it,
 * returning { file, cells } or { skip }. Ships whose exterior fails are listed with why.
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
    }
    const b = r.bounds;
    const length = b ? b.max[2] - b.min[2] : 0;
    ships.push({ id, label: id.replace(/_/g, ' '), template, class: shipClassOf(`${template} ${r.model}`), file: r.file, model: r.model, bounds: b, length: Number(length.toFixed(2)), interior });
    log(`${id}: ${SHIP_CLASSES[shipClassOf(template)]}, ${length.toFixed(1)} m${interior ? interior.failed ? `, interior ${pob} failed: ${interior.failed}` : `, interior ${pob}: ${interior.cells} cells` : ', no interior named by its template'}`);
  }
  ships.sort((a, b) => a.class.localeCompare(b.class) || a.id.localeCompare(b.id));
  return { ships, skipped };
}
