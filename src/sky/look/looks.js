// The looks: what each body is made of, and the places of the game each look stands in for. Holds names and numbers
// only; every picture and mesh is read from the owner's folder in place by the server.
//
// (the GPU port's pass 2, wave 4: the seam of design 2.10) This is the half that ships with the game and the viewer alike:
// the slots, the layers' and the adjustments' starts, the making of a whole look, and the places. The other half, the
// meshes, halos and rings of his imports and every look the owner made of his pictures on 19 and 20 November, names his
// imported files, which never ship: it is his private table (a JSON file the viewer's server reads in development only,
// `viewer/server.mjs`'s `SBV_LOOKS`), handed in by `usePrivateLooks` before anything reads these tables. Without it the
// shipped meshes are the plain sphere every generated look stands on and the flat card, and his looks are his file's alone.

export const SLOTS = ['surface', 'normal', 'specular', 'night', 'clouds', 'overlay', 'atmosphere', 'rings'];

export const SLOT_NAMES = {
  surface: 'Surface',
  normal: 'Normal map',
  specular: 'Specular / water mask',
  night: 'Night lights / illumination',
  clouds: 'Clouds',
  overlay: 'Painted shell (dome overlay)',
  atmosphere: 'Atmosphere',
  rings: 'Rings',
};

export const GROUPS = [
  'Generated worlds',
  // (21 November: recipe version 2's presets, and the placeholders of the lore's bodies, placeholders.js)
  'Generated worlds, version 2',
  // (looks run 2: the generated twins of his imported pictures, generate.js's TWINS)
  'Generated twins of his imported pictures',
  'Placeholders for the lore\'s bodies',
  'Generated shapes',
  'Generated space volumes',
  'Generated (a test)',
  'Our worlds',
  'Our moons and gas giants',
  'Imported sets',
  'Menu circles',
  'Generic meshes',
  'Night-sky moon sheets',
  'Copies for one place',
  'Your own',
];

// Mesh facts from the survey (meshes.md): which section is the surface, which is a shell, the
// facing axis of every dome. Rim radius, base plane and depth are measured from the geometry on load.
// (wave 4) The two that ship: the sphere every generated look is drawn on (its file the page's own sphere where it is not
// there) and the flat card; the rest are his imports', from the private table (`usePrivateLooks`), in their old order.
export const MESHES = {
  planet_01_mesh: { kind: 'sphere', label: 'planet_01 (full sphere)', surface: 'lambert1' },
  sheet: { kind: 'sheet', label: 'flat card (night-sky sheet)' },
};

// Halo meshes for the atmosphere layer, each normalised in the frame of the body it was made for,
// so it rides any body at the survey's ratio. (wave 4) All his imports': the private table's.
export const HALOS = {};

// (wave 4) Ring meshes and belts: all his imports', the private table's.
export const RINGS = {};

export function baseLayer(slot) {
  const L = {
    on: false, tex: '', opacity: 1,
    tint: '#ffffff', hue: 0, sat: 1, bright: 1, contrast: 1,
    replace: { on: false, from: '#3cc8f0', to: '#070707', range: 0.2, soft: 0.12, keep: false },
    alpha: 'texture', alphaFloor: 0, mask: 0, zoom: 1, repeat: [1, 1], flipV: false,
  };
  if (slot === 'surface') Object.assign(L, { uv: 'mesh', lit: true });
  if (slot === 'normal') Object.assign(L, { flipGreen: false, opacity: 0.8 });
  if (slot === 'specular') Object.assign(L, { channel: 'a', shine: 40, opacity: 0.5, tint: '#e6eeff' });
  if (slot === 'night') Object.assign(L, { channel: 'rgb', where: 'night', tint: '#ffd8a0', uv: 'mesh' });
  if (slot === 'clouds') Object.assign(L, { source: 'luma', spin: 1.3, height: 1.004, lit: true, uv: 'latlong', flow: { on: false, tex: '', strength: 0.015, speed: 0.04, bias: 0.72 } });
  if (slot === 'overlay') Object.assign(L, { blend: 'normal', height: 1.002 });
  if (slot === 'atmosphere') Object.assign(L, { form: 'halo', mesh: 'planetfrontendatmosphere_01_mesh', power: 3, height: 1.035, sunSide: 0.75, alpha: 'texture' });
  if (slot === 'rings') Object.assign(L, { mesh: 'planetfrontendrings_01_mesh', tilt: 16, scale: 1, spin: 0.4, roll: 0 });
  return L;
}

export function baseAdjust() {
  return {
    size: 1,
    tilt: 0,
    spin: 2, // degrees a second; a dome's lat-long layers scroll, a sphere turns
    ambient: 0.035,
    glow: '#ff3418',
    glowStrength: 0,
    lightAngle: 150, // a dome's painted light: 0 from the right, 90 from the top, 180 from the left
    lightElev: 25,
    ownSun: { on: false, az: -70, el: 10 },
    over: null, // { look, x, y, z, size }: another look drawn behind this one
    showRects: false,
    alt: '',
  };
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
export function deepMerge(into, from) {
  if (!isObj(from)) return into;
  for (const [k, v] of Object.entries(from)) {
    if (isObj(v) && isObj(into[k])) deepMerge(into[k], v);
    else into[k] = isObj(v) ? deepMerge({}, v) : Array.isArray(v) ? v.slice() : v;
  }
  return into;
}

// A complete look from a partial description: every slot and setting present.
export function makeLook(part) {
  const layers = {};
  for (const s of SLOTS) layers[s] = deepMerge(baseLayer(s), part.layers?.[s]);
  const kind = part.kind || MESHES[part.mesh]?.kind || 'sphere';
  // A sphere's clouds ride clouds_01 at the survey's x1.002 the body unless a look says otherwise.
  if (kind === 'sphere' && part.layers?.clouds?.height === undefined) layers.clouds.height = 1.002;
  const look = {
    name: part.name || 'Untitled',
    group: part.group || 'Your own',
    kind,
    mesh: part.mesh || 'planet_01_mesh',
    note: part.note || '',
    layers,
    adjust: deepMerge(baseAdjust(), part.adjust),
  };
  // A generated look (generate.js) carries its recipe, seed, dials and size; the page checks them.
  if (isObj(part.generated)) look.generated = deepMerge({}, part.generated);
  // (the atmosphere brief's wave A) its Air setting and the air's dials (airProfile.js), only when it has them: a
  // look without them is Painted, as every look made before that wave was
  if (isObj(part.air)) look.air = deepMerge({}, part.air);
  return look;
}

// ---- the private table (wave 4) ----

/** The looks the private table made (his pictures' defaults, by id, as made), or none. */
const PRIVATE = { parts: null, from: '' };

/**
 * His private table handed in (`{ meshes, halos, rings, parts }`, the viewer's server's `/private/looks.json`): its meshes
 * stand between the sphere and the card as they always stood, its halos and rings are the tables', and its looks are
 * the defaults `defaultLooks` makes, each made again as `makeLook` makes any (a made look made again is itself). Called
 * once, before anything reads the tables; a table not of that shape is refused whole.
 */
export function usePrivateLooks(table, from = '') {
  if (!isObj(table) || !isObj(table.parts)) return false;
  const sheet = MESHES.sheet;
  delete MESHES.sheet;
  for (const [k, v] of Object.entries(isObj(table.meshes) ? table.meshes : {})) if (!(k in MESHES) && isObj(v)) MESHES[k] = v;
  MESHES.sheet = sheet;
  for (const [k, v] of Object.entries(isObj(table.halos) ? table.halos : {})) if (isObj(v)) HALOS[k] = v;
  for (const [k, v] of Object.entries(isObj(table.rings) ? table.rings : {})) if (isObj(v)) RINGS[k] = v;
  PRIVATE.parts = table.parts;
  PRIVATE.from = String(from || '');
  return true;
}

/** Where the private table came from, and how many looks it made (none: the page has his file's looks alone). */
export const privateLooks = () => ({ from: PRIVATE.from, looks: PRIVATE.parts ? Object.keys(PRIVATE.parts).length : 0 });

export function defaultLooks() {
  const out = {};
  for (const [id, part] of Object.entries(PRIVATE.parts || {})) out[id] = makeLook(part);
  return out;
}

// ---- places ----

// Ground worlds whose skies are listed first; the rest of skybodies.txt's skies go under "Other skies".
export const MAIN_WORLDS = ['corellia', 'dantooine', 'dathomir', 'endor', 'kashyyyk_main', 'lok', 'mustafar', 'naboo', 'rori', 'talus', 'tatooine', 'yavin4', 'taanab'];

// Places the owner named that the game's files do not list. None of them has a value in SWG's files,
// so each carries a starting place of OURS (`start`), which its "back to SWG's" buttons return to:
//   kind 'sheet' / 'celestial': fixed in a ground sky at yaw and pitch (the sky's own convention),
//     `size` degrees across, lit as `light` says;
//   kind 'body' with `near`: a space body set beside another place of its zone, `right` and `up` in
//     that body's own radii, `sizeShare` of its angle across and `distanceShare` of its distance.
export const EXTRA_PLACES = [
  { id: 'tatooine:nightsky', zone: 'tatooine', what: 'night sky (moon sheet)', kind: 'sheet', start: { yaw: 0, pitch: 35, size: 60, light: 'painted' } },
  { id: 'kashyyyk_main:nightsky', zone: 'kashyyyk_main', what: 'night sky (moon sheet)', kind: 'sheet', start: { yaw: 0, pitch: 35, size: 60, light: 'painted' } },
  { id: 'hoth:nightsky', zone: 'hoth', what: 'Echo Base\'s night sky (moon sheet); SWG\'s files have no Hoth sky', kind: 'sheet', start: { yaw: 0, pitch: 35, size: 60, light: 'painted' } },
  // SWG draws Yavin Prime as Yavin 4's sun slot (sun_yavin, a square 59 degrees across riding the
  // light); the owner wants it fixed in the sky instead, lit by a sun of its own (the first round's
  // look had that sun at azimuth -75, elevation 12 from the front, which is this fixed light).
  { id: 'yavin4:celestial:yavin_prime', zone: 'yavin4', what: 'Yavin Prime, fixed in the sky', kind: 'celestial', start: { yaw: -60, pitch: 28, size: 30, light: 'fixed', azimuth: 167, elevation: 14 } },
  // Up and to the right of Endor, as the first round's look drew Endor behind it.
  { id: 'space_endor:death_star_2', zone: 'space_endor', what: 'Death Star II in orbit above Endor', kind: 'body', start: { near: 'space_endor:planet_endor', right: 0.6, up: 0.75, sizeShare: 0.3, distanceShare: 0.7 } },
  { id: 'mustafar:celestial:jestefad', zone: 'mustafar', what: 'the gas giant Jestefad', kind: 'celestial', start: { yaw: 120, pitch: 25, size: 24 } },
  { id: 'mustafar:celestial:lefrani', zone: 'mustafar', what: 'the gas giant Lefrani', kind: 'celestial', start: { yaw: -140, pitch: 12, size: 14 } },
];

// The owner's choices: place -> look. Places not named here exist and are unassigned.
export const DEFAULT_USES = {
  'naboo:moon': 'rori-ground',
  'rori:celestial:cels_naboo': 'naboo',
  'endor:celestial:cels_endor': 'endor-gas-giant',
  'talus:celestial:cels_corellia': 'corellia',
  'talus:celestial:cels_cpoint_tralus': 'tralus',
  // The owner, 19 Nov: "Corellia's moon should be Takodana." Its ground sky's moon, and the first of its zone's three.
  'corellia:moon': 'menu:takodana',
  'space_corellia:planet_corl_moon_01#1': 'menu:takodana',
  'tatooine:nightsky': 'sky-tatooine',
  'kashyyyk_main:nightsky': 'sky-kashyyyk',
  'hoth:nightsky': 'sky-hoth',
  'yavin4:celestial:yavin_prime': 'yavin-prime',
  'space_endor:death_star_2': 'death-star-2',
  'mustafar:celestial:jestefad': 'jestefad',
  'mustafar:celestial:lefrani': 'lefrani',
  // The owner, 20 Nov (see DEFAULT_USES_SINCE): Mustafar's moon wears Nur, Kashyyyk's second moon Trandosha.
  'mustafar:moon': 'nur',
  'kashyyyk_main:moon2': 'trandosha',
  'space_corellia:planet_corellia': 'corellia',
  'space_dantooine:planet_dantooine': 'dantooine',
  'space_dathomir:planet_dathomir': 'dathomir',
  'space_endor:planet_gas_endor': 'endor-gas-giant',
  'space_endor:planet_endor': 'endor',
  'space_kashyyyk:planet_kashyyyk': 'kashyyyk',
  'space_light1:planet_kessel': 'kessel',
  'space_lok:planet_lok': 'lok',
  'space_naboo:planet_naboo': 'naboo',
  'space_naboo:planet_naboo_moon#1': 'rori',
  'space_naboo:planet_naboo_moon#2': 'rori',
  'space_naboo:planet_naboo_moon#3': 'rori',
  'space_ord_mantell:planet_ord_mantell': 'ord-mantell',
  'space_ord_mantell:planet_ord_mantell_moon#1': 'ord-mantell-moon',
  'space_ord_mantell:planet_ord_mantell_moon#2': 'ord-mantell-moon',
  'space_ord_mantell:planet_ord_mantell_moon_02#1': 'ord-mantell-moon-02',
  'space_ord_mantell:planet_ord_mantell_moon_02#2': 'ord-mantell-moon-02',
  'space_ord_mantell:planet_ord_mantell_moon_02#3': 'ord-mantell-moon-02',
  'space_ord_mantell:planet_ord_mantell_moon_02#4': 'ord-mantell-moon-02',
  'space_ord_mantell:planet_ord_mantell_moon_02#5': 'ord-mantell-moon-02',
  'space_ord_mantell:planet_ord_mantell_moon_02#6': 'ord-mantell-moon-02',
  'space_ord_mantell:planet_ord_mantell_moon_03#1': 'ord-mantell-moon-03',
  'space_ord_mantell:planet_ord_mantell_moon_03#2': 'ord-mantell-moon-03',
  'space_ord_mantell:planet_ord_mantell_moon_03#3': 'ord-mantell-moon-03',
  'space_ord_mantell:planet_ord_mantell_moon_03#4': 'ord-mantell-moon-03',
  'space_sandbox:planet_tatooine#1': 'tatooine',
  'space_sandbox:planet_tatooine#2': 'tatooine',
  'space_tatooine:planet_tatooine': 'tatooine',
  'space_yavin4:planet_yavin': 'yavin-prime',
  'space_yavin4:planet_yavin4': 'yavin4',
};

// Choices added to DEFAULT_USES after the owner had already saved a file of choices. A saved file names every place, an
// unassigned one as null, so a default added later would never show; each of these is taken instead of a saved null only
// when the file was saved before the moment the default was added (the new viewer's own saves name it outright). A file saved since then keeps whatever it says.
export const DEFAULT_USES_SINCE = {
  'mustafar:moon': '2026-11-20T17:54:21.000Z',
  'kashyyyk_main:moon2': '2026-11-20T17:54:21.000Z',
};

// The places themselves (every sky's and zone's bodies, with SWG's values) are read in places.js.
