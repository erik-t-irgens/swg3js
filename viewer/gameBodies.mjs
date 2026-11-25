// Save to game (the GPU port's pass 2, wave 4; the owner's answer to the design's question 1): the viewer's choices made
// into the game's own bodies file, `public/sky/bodies.json`, which the game reads at its next loading screen
// (`src/sky/look/bodiesFile.ts`) and the owner commits as he does his maps.
//
// What it carries, and nothing else:
//   - `looks`: every look a place or an applied system wears that the game can make from numbers alone: his generated looks
//     (recipe, seed, dials, size, air) whole, and a look of his pictures only where every picture it wears is one of his own
//     photos marked "ship with the game"; a look of his imported pictures otherwise goes as its generated twin, and one with
//     no twin as nothing (the game then shows SWG's picture there). No picture or mesh name of his imports is ever written:
//     a layer's picture is blanked unless shipped, every layer's mesh is left to the game's own defaults, notes are left out.
//   - `uses`: which place wears which of those looks (a place whose look cannot go is left out: SWG's picture there).
//   - `systems`: the star systems he has applied (`starSystems` and the first round's `systems`, `applied` true), as saved.
//   - `air`: each ground world's air dials, from the look its own planet wears in its space zone (the look's air edits the
//     world's record: its ground sky and its rim from orbit together, the design's 2.6).
//   - `pictures`: each photo of his marked to ship and worn by a look here, by its file name under `pictures/`.
//   - `credits`: a line naming him, from the page (`credit`).
// A film or game still is never shipped, whatever its mark (`stillKind`), and a picture is shipped only from the pictures
// he added from the page (`pictures` of his file), never one of the imported folder's own.
//
// Pure (no fs, no page), so the node test runs it as it stands (`tools/swg/tests/viewerSave.test.ts`).

/** The bodies file's version: a reader refuses a file of a later version. */
export const GAME_BODIES_VERSION = 1;

/** The kinds of picture that never ship, whatever their mark: a still from a film or a game, kept for reference. */
export const stillKind = (kind) => kind === 'still';

/** The look id of a place's look as the game names it: the viewer's own id. */
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** The viewer's world names that the game names otherwise (its sky's zone against the game's planet id). */
export const GAME_WORLD = { kashyyyk_main: 'kashyyyk' };

/** A ground world's planet in its space zone (`space_<zone>:planet_<name>`), as the viewer's places name it: the world, or null. */
export function worldOfPlanetPlace(placeId, worlds) {
  const m = /^space_([a-z0-9_]+):planet_([a-z0-9_]+?)(?:#\d+)?$/.exec(String(placeId));
  if (!m) return null;
  for (const w of worlds) {
    const plain = w.replace(/_main$/, '');
    if (m[2] === plain && (m[1] === plain || m[1] === w)) return GAME_WORLD[w] ?? w;
  }
  return null;
}

/**
 * A photo's name in the game's pictures folder: his own name, which the viewer's rules already keep plain, with `.jpeg`
 * written `.jpg` (a release takes `.jpg` and `.png` pictures and refuses any other kind, `tools/launcher/pack.mjs`).
 */
export const gamePictureName = (name) => String(name).replace(/\.jpeg$/i, '.jpg');

/** Every file name a look's layers wear. */
function picturesOf(look) {
  const out = [];
  for (const L of Object.values(look?.layers || {})) {
    if (!isObj(L)) continue;
    if (L.on !== false && typeof L.tex === 'string' && L.tex) out.push(L.tex);
    if (isObj(L.flow) && L.flow.on && typeof L.flow.tex === 'string' && L.flow.tex) out.push(L.flow.tex);
  }
  return out;
}

/**
 * A look's name as the game's file carries it: its plain name alone, every bracketed remark left out, since the viewer's
 * names of twins say what they twin ("Nur (twin of his Kamino map as he wears it)" goes as "Nur"), and what his imports are
 * is never written (the fixer of pass 2, wave 4a). A name that is nothing but a remark goes as nothing.
 */
export function gameLookName(name) {
  return String(name || '').replace(/\s*[([{][^)\]}]*[)\]}]?/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** Numbers only: a look's layers with every picture blanked unless shipped (named under `pictures/` then) and no mesh named. */
function numbersOnly(look, shipped) {
  const out = { name: gameLookName(look.name), kind: look.kind === 'sphere' || look.kind === 'dome' || look.kind === 'sheet' ? look.kind : 'sphere' };
  const layers = {};
  for (const [slot, L] of Object.entries(look.layers || {})) {
    if (!isObj(L)) continue;
    const c = JSON.parse(JSON.stringify(L));
    delete c.mesh;
    if (typeof c.tex === 'string') c.tex = c.tex && shipped.has(c.tex) ? 'pictures/' + gamePictureName(c.tex) : '';
    if (isObj(c.flow) && typeof c.flow.tex === 'string') c.flow.tex = c.flow.tex && shipped.has(c.flow.tex) ? 'pictures/' + gamePictureName(c.flow.tex) : '';
    layers[slot] = c;
  }
  out.layers = layers;
  if (isObj(look.adjust)) {
    const a = JSON.parse(JSON.stringify(look.adjust));
    out.adjust = a;
  }
  if (isObj(look.generated)) out.generated = JSON.parse(JSON.stringify(look.generated));
  if (isObj(look.air)) out.air = JSON.parse(JSON.stringify(look.air));
  return out;
}

/**
 * The game's bodies file from the page's choices: `data` is `{ looks, uses, starSystems?, systems?, pictures?, credit?,
 * worlds?, twins? }` as the page holds them (`twins` its answer of each look's generated twin, `twinOfLook`, by look id),
 * `opts.at` the moment (ISO). Allocation is no matter here: it runs once a press.
 */
export function gameBodiesFile(data, opts = {}) {
  const looks = isObj(data.looks) ? data.looks : {};
  const pictures = isObj(data.pictures) ? data.pictures : {};
  const twins = isObj(data.twins) ? data.twins : {};
  const worlds = Array.isArray(data.worlds) ? data.worlds.map(String) : [];
  // His own photos marked to ship: added from the page, marked, and no still.
  const shippable = new Set(Object.entries(pictures).filter(([, p]) => isObj(p) && p.ship === true && !stillKind(p.kind)).map(([n]) => n));
  const out = { version: GAME_BODIES_VERSION, made: String(opts.at || ''), credits: '', looks: {}, uses: {}, systems: {}, air: {}, pictures: {} };
  const used = new Set();
  /** The look id the game wears for `id`: itself where it can go, else its twin, else null. */
  const wearable = (id, seen = 0) => {
    const look = looks[id];
    if (!isObj(look) || seen > 2) return null;
    if (isObj(look.generated)) return id;
    const wears = picturesOf(look);
    // a look of a mesh of his (a dome, its halo or rings) never ships: only a sphere or a flat card of shipped photos does
    const meshOk = look.kind === 'sphere' || look.kind === 'sheet';
    if (meshOk && wears.length && wears.every((n) => shippable.has(n))) return id;
    const twin = twins[id];
    return typeof twin === 'string' && twin !== id ? wearable(twin, seen + 1) : null;
  };
  const take = (id) => {
    if (out.looks[id]) return;
    const look = numbersOnly(looks[id], shippable);
    out.looks[id] = look;
    for (const L of Object.values(look.layers)) {
      if (typeof L.tex === 'string' && L.tex.startsWith('pictures/')) used.add(L.tex.slice('pictures/'.length));
      if (isObj(L.flow) && typeof L.flow.tex === 'string' && L.flow.tex.startsWith('pictures/')) used.add(L.flow.tex.slice('pictures/'.length));
    }
    // a look drawn behind another (its `over`) goes with it
    const over = looks[id]?.adjust?.over?.look;
    if (typeof over === 'string') {
      const w = wearable(over);
      if (w) take(w);
    }
  };
  for (const [place, id] of Object.entries(isObj(data.uses) ? data.uses : {})) {
    if (typeof id !== 'string' || !id) continue;
    const w = wearable(id);
    if (!w) continue;
    take(w);
    out.uses[place] = w;
  }
  // the systems he applied, as saved, and the looks their bodies name
  for (const [key, src] of [['starSystems', data.starSystems], ['systems', data.systems]]) {
    if (!isObj(src)) continue;
    for (const [id, e] of Object.entries(src)) {
      if (!isObj(e) || e.applied !== true || !isObj(e.system)) continue;
      const sys = JSON.parse(JSON.stringify(e.system));
      delete sys.future;
      out.systems[key === 'systems' ? 'v1:' + id : id] = sys;
      for (const b of Array.isArray(sys.bodies) ? sys.bodies : []) {
        if (isObj(b) && typeof b.look === 'string') {
          const w = wearable(b.look);
          if (w) {
            take(w);
            b.look = w;
          } else delete b.look;
        }
      }
    }
  }
  // each ground world's air dials, from the look its planet wears in its space zone
  for (const [place, id] of Object.entries(out.uses)) {
    const world = worldOfPlanetPlace(place, worlds);
    const air = out.looks[id]?.air;
    if (world && isObj(air) && !out.air[world]) out.air[world] = JSON.parse(JSON.stringify(air));
  }
  // (skies of his own worlds) the air he gave a world of his own in the air box (`worldAir`, by its own id: no space zone holds
  // its planet), which the game reads before the air of the world whose sky it borrows; none set, the file as before
  for (const [world, air] of Object.entries(isObj(data.worldAir) ? data.worldAir : {})) {
    if (/^[a-z0-9_]{1,40}$/.test(world) && isObj(air) && !out.air[world]) out.air[world] = JSON.parse(JSON.stringify(air));
  }
  // (pass 2, wave 4b) the bodies held still in a ground sky (the Death Star over Endor, any of SWG's sky sprites he places):
  // numbers and one picture of the sky pack each, by world and the body's own id; a world with none is left out (an older
  // game ignores the key, and a world absent from it keeps what SWG's environment says)
  const held = heldForGame(data.held);
  if (Object.keys(held).length) out.held = held;
  // (pass 2, wave 5, maker L) the space places he moved or sized (the page's place edits, `places`): numbers only, by place; a
  // file without any is as before (the game reads none)
  const places = spacePlacesForGame(data.places);
  // (pass 2, wave 6, maker K) and a ground sky's places he moved or sized on the Place tab: SWG's slots and celestials
  Object.assign(places, groundPlacesForGame(data.places));
  if (Object.keys(places).length) out.places = places;
  for (const name of [...used].sort()) out.pictures[gamePictureName(name)] = { kind: String(pictures[name]?.kind || 'other') };
  const credit = typeof data.credit === 'string' ? data.credit.trim().slice(0, 120) : '';
  const photos = Object.keys(out.pictures).length;
  out.credits = credit ? `Sky looks${photos ? ' and photos' : ''} by ${credit}, made in the space body viewer.` : 'Sky looks made in the space body viewer.';
  return out;
}

/**
 * The pictures a held body may wear, by SWG's names in the sky pack (the game's reader keeps the same list,
 * `src/sky/look/bodiesFile.ts`'s `HELD_PICTURES`): the Death Star's three stages and its near-complete picture, SWG's two ship
 * sprites.
 */
export const HELD_PICTURES = ['moon_deathstar1', 'moon_deathstar2', 'moon_deathstar3', 'moon_deathstar', 'cels_moncal_cruiser', 'cels_star_destroyer'];

/** Each number's range (the game's reader holds them so too). */
export const HELD_RANGE = { yawDeg: [-360, 360], pitchDeg: [-90, 90], size: [0.01, 20], rollDeg: [-360, 360], light: [0, 8] };

/**
 * SWG's own placement of Endor's Death Star (its environment's `GSCL` chunks): yaw 140, pitch 30, size 0.6, stage 1 (the
 * half-built sphere), unrolled, as converted. A held body's number left out takes it.
 */
export const HELD_START = { picture: 'moon_deathstar1', yawDeg: 140, pitchDeg: 30, size: 0.6, rollDeg: 0, light: 1 };

/** One held body as the game's file carries it (numbers and its picture), or null where its picture is not one of the list. */
export function heldBody(b) {
  if (!isObj(b)) return null;
  const picture = typeof b.picture === 'string' ? b.picture.toLowerCase().replace(/\.(dds|png|tga)$/, '') : HELD_START.picture;
  if (!HELD_PICTURES.includes(picture)) return null;
  const out = { picture };
  for (const [k, [lo, hi]] of Object.entries(HELD_RANGE)) {
    const v = typeof b[k] === 'number' && Number.isFinite(b[k]) ? b[k] : HELD_START[k];
    out[k] = v < lo ? lo : v > hi ? hi : v;
  }
  return out;
}

/** The page's held bodies (`{ <world>: { <id>: body } }`) as the game's file carries them. */
export function heldForGame(held) {
  const out = {};
  for (const [world, bodies] of Object.entries(isObj(held) ? held : {})) {
    if (!/^[a-z0-9_]{1,40}$/.test(world) || !isObj(bodies)) continue;
    const kept = {};
    for (const [id, b] of Object.entries(bodies)) {
      if (!/^[a-z0-9_]{1,40}$/.test(id)) continue;
      const h = heldBody(b);
      if (h) kept[id] = h;
    }
    if (Object.keys(kept).length) out[GAME_WORLD[world] ?? world] = kept;
  }
  return out;
}

/**
 * (pass 2, wave 5, maker L) The space places he moved or sized, as the game's file carries them: from the page's place edits
 * (`{ <place>: { yaw, pitch, size, distance, ... } }`), each space place's own yaw, pitch, size across and distance where he set
 * them (degrees, and the zone file's units), nothing of a ground sky's and nothing else. The game hangs the zone's planet there
 * (`src/sky/look/bodiesFile.ts`' `spacePlaceOf`).
 */
export function spacePlacesForGame(places) {
  const out = {};
  for (const [id, e] of Object.entries(isObj(places) ? places : {})) {
    if (!/^space_[a-z0-9_]{1,40}:[a-z0-9_]{1,60}(?:#\d{1,3})?$/.test(id) || !isObj(e)) continue;
    const o = {};
    for (const k of ['yaw', 'pitch', 'size', 'distance']) if (typeof e[k] === 'number' && Number.isFinite(e[k])) o[k] = e[k];
    if (Object.keys(o).length) out[id] = o;
  }
  return out;
}

/** A ground sky's place of SWG's as the viewer names it: its four slots, or a celestial by its picture (`#n` where it repeats). */
export const GROUND_PLACE = /^(?!space_)[a-z0-9_]{1,40}:(?:sun|sun2|moon|moon2|celestial:[a-z0-9_]{1,60}(?:#\d{1,3})?)$/;

/**
 * (pass 2, wave 6, maker K) A ground sky's places he moved or sized on the Place tab, as the game's file carries them: from the
 * page's place edits, each of SWG's slots' and celestials' own size (the square SWG draws, degrees across, as the Place tab
 * shows it) and, for a celestial, a second sun and a second moon, its yaw and pitch (a celestial's in the sky; a second body's
 * its offset from the light, as SWG's file has them); nothing of the look's light, tilt or spin, which are the viewer's. The
 * game lays them over SWG's sky file behind the next loading screen (`src/sky/look/groundPlaces.ts`).
 */
export function groundPlacesForGame(places) {
  const out = {};
  for (const [id, e] of Object.entries(isObj(places) ? places : {})) {
    if (!GROUND_PLACE.test(id) || !isObj(e)) continue;
    const turns = !/:(sun|moon)$/.test(id);
    const o = {};
    for (const k of turns ? ['yaw', 'pitch', 'size'] : ['size']) if (typeof e[k] === 'number' && Number.isFinite(e[k])) o[k] = e[k];
    if (Object.keys(o).length) out[id] = o;
  }
  return out;
}

/** The photos a made file wears (their own names), for the writer to copy beside it. */
export function shippedPictures(made) {
  return Object.keys(made?.pictures || {});
}
