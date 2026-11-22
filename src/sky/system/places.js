// SWG's places and the rules the game places them by. Every ground sky's sun, moons and extra
// bodies and every space zone's planets, moons and stars are read from the survey's skybodies.txt;
// a space zone's light colour comes from that zone's converted sky.json (read only, through the
// server). The arithmetic mirrors the port's own, read only, so a body is shown where the game will
// put it:
//   src/world/sky.ts      SwgSky.direction, SwgSky.offset, place(): the sun and moon slots ride the
//                         light, a supplementary body is offset from it, a celestial is fixed or
//                         circles once per cycle; a sky picture's square is `size` half-wide 3 m out.
//   src/world/daycycle.ts the SWG light path: pitched 67.5 degrees, half a turn by day and half by night.
//   src/space/suns.ts     which of a zone's stars is its sun (the brightest with a glow), sunDirection.
//   tools/swg/space.mjs   a zone body's angle: its radius over its distance.
// Names and numbers only: nothing here is a picture or a mesh.

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** sky.ts: the client draws a sky picture's square this far in front of the camera; a size is a half-width there. */
export const CELESTIAL_DISTANCE = 3;
/** flareMath.ts: the share of a sun picture's half-width its bright disc fills, and of a glow picture's its bright glow. */
export const DISC_FILL = 0.2;
export const GLOW_FILL = 0.45;
/** flareMath.ts: the same for a space zone's star pictures. */
export const STAR_DISC_FILL = 0.08;
export const STAR_GLOW_FILL = 0.5;
/** daycycle.ts: the first 70% of the client's day (06:00 to 22:48) is daylight. */
export const DAY_NIGHT_SPLIT = 0.7;
/** daycycle.ts: the client pitches its light 67.5 degrees: the sun's (and the moon's) highest. */
export const SWG_LIGHT_ELEVATION = 67.5;
/** sky.ts: seconds in the client's day, which a celestial's cycle time counts in. */
export const CLIENT_DAY_SECONDS = 86400;
/** space.mjs / world.ts: a zone body of size 1 is 240 m across its radius, hung 2600 m out. */
export const SPACE_FRAME = { distance: 2600, radius: 240 };

// ---------------------------------------------------------------------------------------------
// directions (this engine's axes: +Y up, the sky's yaw 0 toward -Z, yaw 90 toward +X)

/** sky.ts SwgSky.direction and suns.ts sunDirection: yaw, then pitch, in degrees. */
export function skyDirection(yawDeg, pitchDeg) {
  const y = yawDeg * DEG;
  const p = pitchDeg * DEG;
  const c = Math.cos(p);
  return { x: c * Math.sin(y), y: Math.sin(p), z: -c * Math.cos(y) };
}

/** The yaw and pitch (degrees) of a direction, in the same convention. */
export function yawPitchOf(d) {
  const len = Math.hypot(d.x, d.y, d.z) || 1;
  return { yaw: Math.atan2(d.x, -d.z) / DEG, pitch: Math.asin(clamp(d.y / len, -1, 1)) / DEG };
}

/** sky.ts SwgSky.offset: a direction turned by yaw and pitch offsets (degrees), the supplementary bodies' rule. */
export function offsetDir(dir, yawDeg, pitchDeg) {
  const az = Math.atan2(dir.x, -dir.z) + yawDeg * DEG;
  const el = clamp(Math.asin(clamp(dir.y, -1, 1)) + pitchDeg * DEG, -Math.PI / 2, Math.PI / 2);
  return { x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: -Math.cos(az) * Math.cos(el) };
}

const norm = (v) => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};

/**
 * The world's light at a time of day (hours, 0 to 24), as daycycle.ts works it on SWG's path: the
 * light rises at 06:00 toward -X, peaks 67.5 degrees up at 14:24 and sets at 22:48 toward +X; by
 * night the same arc again, carrying the moon (highest at 02:24). By day the sun is the light and the
 * moon is opposite it; by night the moon is the light and the sun is opposite it.
 */
export function dayAt(hours) {
  const time = (((hours / 24) % 1) + 1) % 1;
  const ratio = (time - 0.25 + 1) % 1;
  const isDay = ratio < DAY_NIGHT_SPLIT;
  let n = isDay ? 0.5 * (ratio / DAY_NIGHT_SPLIT) : 0.5 + 0.5 * ((ratio - DAY_NIGHT_SPLIT) / (1 - DAY_NIGHT_SPLIT));
  if (n >= 1) n = 0;
  const yaw = (n < 0.5 ? -Math.PI / 2 : -Math.PI * 1.5) + n * Math.PI * 2;
  const e = SWG_LIGHT_ELEVATION * DEG;
  const light = norm({ x: Math.sin(yaw), y: Math.cos(yaw) * Math.sin(e), z: -Math.cos(yaw) * Math.cos(e) });
  const opposite = { x: -light.x, y: -light.y, z: -light.z };
  return {
    hours, time, ratio, isDay, normalized: n, light,
    sun: isDay ? light : opposite,
    moon: isDay ? opposite : light,
    // sky.ts: the client's clock for a circling celestial
    clientTime: ratio * CLIENT_DAY_SECONDS,
    // sky.ts: the sun or moon slot fades in its last few degrees above the horizon
    slotAlpha: clamp(light.y / 0.08, 0, 1),
  };
}

export function clockText(hours) {
  const mins = Math.round((((hours % 24) + 24) % 24) * 60) % (24 * 60);
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/** The angle (degrees) the square of a ground sky picture of SWG size `size` fills: 2 atan(size / 3). */
export const skySquareDegrees = (size) => (2 * Math.atan(Math.max(0, size) / CELESTIAL_DISTANCE)) / DEG;

// ---------------------------------------------------------------------------------------------
// skybodies.txt

const num = (v, d = null) => (v === undefined || v === '' || v === '-' || !Number.isFinite(+v) ? d : +v);
const pictureName = (img) => (!img || img === '-' ? null : img.replace(/^sky\//, '').replace(/^space\//, '').replace(/\.png$/, ''));

function fields(rest) {
  const parts = rest.split('|');
  const o = { shader: parts[0] };
  for (const p of parts.slice(1)) {
    const i = p.indexOf('=');
    if (i > 0) o[p.slice(0, i)] = p.slice(i + 1);
  }
  return o;
}

/** Every sky and zone skybodies.txt lists: its slots, extra bodies, stars and (space) bodies. */
export function parseSkies(text) {
  const skies = new Map();
  let sky = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const head = raw.match(/^== (\S+) sky:(.*)$/);
    if (head) {
      const meta = head[2];
      sky = {
        id: head[1],
        // a space zone by its name: some ground skies (a dungeon's) have a skybox too
        space: head[1].startsWith('space_'),
        title: null,
        planet: null,
        sunElev: num((meta.match(/sunElev=([-\d.]+)/) || [])[1], SWG_LIGHT_ELEVATION),
        starCount: num((meta.match(/stars=(\d+)/) || [])[1], 0),
        nightSky: pictureName((meta.match(/nightSky=(\S+)/) || [])[1]),
        slots: { sun: null, sun2: null, moon: null, moon2: null },
        cels: [],
        stars: [],
        bodies: [],
        lines: {},
      };
      skies.set(sky.id, sky);
      continue;
    }
    if (!sky) continue;
    const line = raw.trim();
    let m = line.match(/^(sun|sun2|moon|moon2|cel|star):\s*(.*)$/);
    if (m) {
      const [, kind, rest] = m;
      if (rest === 'null') continue;
      const f = fields(rest);
      if (kind === 'star') {
        sky.stars.push({ shader: f.shader, size: num(f.size, 0), yaw: num(f.yaw, 0), pitch: num(f.pitch, 0), img: f.img || null });
        continue;
      }
      const b = {
        shader: f.shader, size: num(f.size, 0), img: f.img && f.img !== '-' ? f.img : null,
        glowSize: num(f.glowSize, 0), glowImg: f.glowImg && f.glowImg !== '-' ? f.glowImg : null,
        yaw: num(f.yaw, null), pitch: num(f.pitch, null), cycle: num(f.cycle, 0), pdir: num(f.pdir, null), line,
      };
      if (kind === 'cel') sky.cels.push(b);
      else sky.slots[kind] = b;
      continue;
    }
    m = line.match(/^space\.json: planet=(\S+) title=(.*?) stations=/);
    if (m) {
      sky.planet = m[1] === 'null' ? null : m[1];
      sky.title = m[2];
      continue;
    }
    m = line.match(/^body: appearance\/([^|]+)\.pln\|(.*)$/);
    if (m) {
      const f = fields('x|' + m[2]);
      const dir = (f.dir || '0,0,-1').split(',').map(Number);
      sky.bodies.push({ app: m[1], dir, size: num(f.size, 1), r: num(f.r, null), tex: f.tex || null, place: f.place || 'sky', line });
    }
  }
  return skies;
}

// ---------------------------------------------------------------------------------------------
// names in plain words

const WORLD_NAMES = {
  kashyyyk_main: 'Kashyyyk', yavin4: 'Yavin 4', ord_mantell: 'Ord Mantell', otoh_gunga: 'Otoh Gunga',
  endor_asommers: 'Endor (test)', hoth: 'Hoth (Echo Base)',
};
export function worldName(id) {
  if (WORLD_NAMES[id]) return WORLD_NAMES[id];
  return String(id).split('_').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}
const possessive = (name) => (name.endsWith('s') ? name + '\'' : name + '\'s');

// ---------------------------------------------------------------------------------------------
// the places, each with SWG's own values

const SLOT_WORDS = { sun: 'sun', sun2: 'second sun', moon: 'moon', moon2: 'second moon' };
const LIGHT_ANGLES = { azimuth: 150, elevation: 25 };

function groundLight() { return { source: 'world-sun', ...LIGHT_ANGLES }; }
function spaceLight() { return { source: 'zone-sun', ...LIGHT_ANGLES }; }

function spacePlace(sky, b, id, n) {
  const d = { x: -b.dir[0], y: b.dir[1], z: b.dir[2] }; // the game's frame mirrored in X, as world.ts reads it
  const distance = Math.hypot(b.dir[0], b.dir[1], b.dir[2]) || 1;
  const { yaw, pitch } = yawPitchOf(d);
  const share = b.r ? b.r / distance : (b.size * SPACE_FRAME.radius) / SPACE_FRAME.distance;
  const size = (2 * Math.asin(clamp(share, 0, 1))) / DEG;
  const title = sky.title || worldName(sky.id);
  return {
    id, zone: sky.id, space: true, kind: 'body', picture: b.app,
    label: `${title}: ${b.app.replace(/^planet_/, '')}${n ? ' #' + n : ''}`,
    what: `${b.app}, ${size.toFixed(1)}° across`,
    swg: { size, yaw, pitch, distance, tilt: 0, spin: 0, light: spaceLight(), brightness: 1 },
    from: {
      size: `2 asin(r / distance) = 2 asin(${b.r ?? '?'} / ${distance.toFixed(1)}): its radius over its distance, as the game sizes a zone's body`,
      yaw: `its direction ${b.dir.join(', ')} in the zone's file (X mirrored, as the game reads it)`,
      pitch: `its direction ${b.dir.join(', ')} in the zone's file`,
      distance: `the length of its direction ${b.dir.join(', ')}`,
      line: b.line,
    },
    fields: ['size', 'yaw', 'pitch', 'distance', 'tilt', 'spin', 'light', 'brightness'],
  };
}

function slotPlace(sky, kind, s) {
  const name = worldName(sky.id);
  const offset = kind === 'sun2' || kind === 'moon2';
  const size = skySquareDegrees(s.size);
  return {
    id: `${sky.id}:${kind}`, zone: sky.id, space: false, kind, picture: pictureName(s.img),
    label: `${possessive(name)} ${SLOT_WORDS[kind]}`,
    what: `${SLOT_WORDS[kind]}: ${pictureName(s.img) || '(no picture)'}, ${size.toFixed(1)}°`,
    swg: { size, yaw: offset ? s.yaw ?? 0 : null, pitch: offset ? s.pitch ?? 0 : null, distance: null, tilt: 0, spin: 0, light: groundLight(), brightness: 1 },
    glowSize: s.glowSize || 0,
    swgSize: s.size,
    from: {
      size: `the square SWG draws, 2 atan(size / 3) with size ${(+s.size).toFixed(3)}`,
      yaw: offset ? `its yaw offset from the light, ${s.yaw ?? 0}` : null,
      pitch: offset ? `its pitch offset from the light, ${s.pitch ?? 0}` : null,
      line: s.line,
    },
    fields: offset ? ['size', 'yaw', 'pitch', 'tilt', 'spin', 'light', 'brightness'] : ['size', 'tilt', 'spin', 'light', 'brightness'],
  };
}

function celPlace(sky, c, id, name) {
  const size = skySquareDegrees(c.size);
  const circles = c.cycle > 0 && (c.pdir ?? 1) !== 0;
  return {
    id, zone: sky.id, space: false, kind: 'celestial', picture: pictureName(c.img),
    label: `${possessive(worldName(sky.id))} sky: ${name}`,
    what: `celestial ${name}, ${size.toFixed(1)}°${circles ? `, circles every ${(c.cycle / 3600).toFixed(2)} h` : ''}`,
    swg: { size, yaw: c.yaw ?? 0, pitch: c.pitch ?? 45, distance: null, tilt: 0, spin: 0, light: groundLight(), brightness: 1 },
    cycle: c.cycle || 0,
    pdir: c.pdir ?? 1,
    swgSize: c.size,
    from: {
      size: `the square SWG draws, 2 atan(size / 3) with size ${(+c.size).toFixed(3)}`,
      yaw: `its yaw in the sky file, ${c.yaw ?? 0}`,
      pitch: `its pitch in the sky file, ${c.pitch ?? '45 (none given: sky.ts\'s 45)'}`,
      line: c.line,
    },
    fields: ['size', 'yaw', 'pitch', 'tilt', 'spin', 'light', 'brightness'],
  };
}

function extraPlace(e, byId) {
  const s = e.start || {};
  const space = e.zone.startsWith('space_');
  const base = {
    id: e.id, zone: e.zone, space, kind: space ? 'body' : e.kind === 'sheet' ? 'sheet' : 'celestial', picture: null,
    label: e.what ? `${space ? '' : possessive(worldName(e.zone)) + ' sky: '}${e.what[0].toUpperCase() + e.what.slice(1)}` : e.id,
    what: e.what || '', invented: true, cycle: 0, pdir: 1,
  };
  let swg;
  if (space && s.near && byId.get(s.near)) {
    const near = byId.get(s.near).swg;
    const half = near.size / 2;
    swg = {
      size: near.size * (s.sizeShare ?? 0.3),
      yaw: near.yaw + ((s.right ?? 0) * half) / Math.max(0.2, Math.cos(near.pitch * DEG)),
      pitch: clamp(near.pitch + (s.up ?? 0) * half, -89, 89),
      distance: near.distance * (s.distanceShare ?? 0.7),
    };
  } else {
    swg = { size: s.size ?? 20, yaw: s.yaw ?? 0, pitch: s.pitch ?? 30, distance: space ? s.distance ?? 600 : null };
  }
  const light = { source: s.light || (space ? 'zone-sun' : 'world-sun'), azimuth: s.azimuth ?? LIGHT_ANGLES.azimuth, elevation: s.elevation ?? LIGHT_ANGLES.elevation };
  const ours = 'not in SWG\'s files: our starting value';
  return {
    ...base,
    swg: { ...swg, tilt: 0, spin: 0, light, brightness: 1 },
    from: { size: ours, yaw: ours, pitch: ours, distance: ours, light: ours, line: null },
    fields: space ? ['size', 'yaw', 'pitch', 'distance', 'tilt', 'spin', 'light', 'brightness'] : ['size', 'yaw', 'pitch', 'tilt', 'spin', 'light', 'brightness'],
  };
}

/** Every place: each sky's slots and celestials, each zone's bodies, then the owner's extra places. */
export function buildPlaces(skies, extras = []) {
  const places = [];
  for (const sky of skies.values()) {
    if (sky.space) {
      const seen = {};
      for (const b of sky.bodies) seen[b.app] = (seen[b.app] || 0) + 1;
      const n = {};
      for (const b of sky.bodies) {
        n[b.app] = (n[b.app] || 0) + 1;
        const many = seen[b.app] > 1;
        places.push(spacePlace(sky, b, `${sky.id}:${b.app}${many ? '#' + n[b.app] : ''}`, many ? n[b.app] : 0));
      }
    } else {
      for (const k of ['sun', 'sun2', 'moon', 'moon2']) if (sky.slots[k]) places.push(slotPlace(sky, k, sky.slots[k]));
      const counts = {};
      for (const c of sky.cels) {
        const name = pictureName(c.img) || 'unnamed';
        counts[name] = (counts[name] || 0) + 1;
        places.push(celPlace(sky, c, `${sky.id}:celestial:${name}${counts[name] > 1 ? '#' + counts[name] : ''}`, name));
      }
    }
  }
  const byId = new Map(places.map((p) => [p.id, p]));
  for (const e of extras) {
    if (byId.has(e.id)) continue;
    const p = extraPlace(e, byId);
    places.push(p);
    byId.set(p.id, p);
  }
  return places;
}

/** A place a saved file names that no sky lists: kept, with neutral starting values. */
export function unknownPlace(id) {
  const zone = id.split(':')[0];
  const space = zone.startsWith('space_');
  return {
    id, zone, space, kind: space ? 'body' : 'celestial', picture: null, label: id, what: '(not in skybodies.txt)', invented: true, cycle: 0, pdir: 1,
    swg: { size: 10, yaw: 0, pitch: 30, distance: space ? 600 : null, tilt: 0, spin: 0, light: space ? spaceLight() : groundLight(), brightness: 1 },
    from: {},
    fields: space ? ['size', 'yaw', 'pitch', 'distance', 'tilt', 'spin', 'light', 'brightness'] : ['size', 'yaw', 'pitch', 'tilt', 'spin', 'light', 'brightness'],
  };
}

// ---------------------------------------------------------------------------------------------
// a space zone's sun (suns.ts, read only: its 'glow' rule, the game's default)

/** suns.ts starGroups: the zone's star pictures gathered by the direction they share, brightest first. */
export function starGroups(stars) {
  const byPlace = new Map();
  for (const s of stars || []) {
    if (!s || !s.img) continue;
    const key = `${s.yaw}|${s.pitch}`;
    let g = byPlace.get(key);
    if (!g) {
      g = { yaw: s.yaw, pitch: s.pitch, discSize: 0, glowSize: 0, score: 0 };
      byPlace.set(key, g);
    }
    const size = s.size > 0 ? s.size : 0;
    if (s.shader.includes('starglow')) g.glowSize = Math.max(g.glowSize, size);
    else if (s.shader.includes('cels_star')) g.discSize = Math.max(g.discSize, size);
  }
  const out = [];
  for (const g of byPlace.values()) {
    if (g.glowSize <= 0 && g.discSize <= 0) continue;
    g.score = g.glowSize + 0.25 * g.discSize;
    out.push(g);
  }
  out.sort((a, b) => b.score - a.score || a.yaw - b.yaw || a.pitch - b.pitch);
  return out;
}

/** suns.ts pickSuns, the 'glow' rule: the brightest group with a glow (any group if none has one). */
export function pickZoneSun(stars) {
  const groups = starGroups(stars);
  if (!groups.length) return { sun: null, groups };
  const glowing = groups.filter((g) => g.glowSize > 0);
  return { sun: (glowing.length ? glowing : groups)[0], groups };
}

const hex2 = (v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
/** three's own sRGB curves (ColorManagement), which sky.ts's setRGB(..., SRGBColorSpace) runs. */
export const srgbToLinear = (c) => (c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4));
export const linearToSrgb = (c) => (c < 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 0.41666) - 0.055);

/**
 * SWG's sun for a space zone: the direction of the star the game picks, and the colour and
 * brightness of the zone's first light (its sky.json's `space.lights[0].diffuse`). sky.ts reads that
 * diffuse as sRGB and turns it to linear light (setRGB(..., SRGBColorSpace)), a part above 1 included,
 * so Tatooine's 1.15, 0.90, 0.75 lights at 1.376, 0.787, 0.523. The brightness here is the largest
 * of those linear parts (at least 1), and the colour the linear light over it, written back as sRGB
 * for the colour box; the page turns the colour to linear again and multiplies by the brightness,
 * giving the game's light back (to the colour box's 8 bits).
 */
export function zoneSunDefaults(sky, skyJson) {
  const pick = pickZoneSun(sky?.stars);
  const light = skyJson?.space?.lights?.[0] || null;
  let yaw = 0, pitch = 0, fromDir;
  if (pick.sun) {
    ({ yaw, pitch } = pick.sun);
    fromDir = `the star at yaw ${yaw}, pitch ${pitch} (the brightest of the zone's ${pick.groups.length} stars with a glow, the game's rule in suns.ts)`;
  } else if (light) {
    yaw = light.yaw;
    pitch = light.pitch;
    fromDir = `the zone's first light (yaw ${yaw}, pitch ${pitch}): the zone has no star picture`;
  } else {
    fromDir = 'nothing in the files: straight ahead';
  }
  let colour = '#ffffff', brightness = 1, fromColour = 'no sky.json for this zone: white';
  let fromBrightness = 'the game lights a zone at a scale of 1 (sky.ts)';
  if (light && Array.isArray(light.diffuse)) {
    const srgb = light.diffuse.slice(0, 3).map((x) => Math.max(0, +x || 0));
    const lin = srgb.map(srgbToLinear);
    brightness = Math.max(1, ...lin);
    colour = '#' + lin.map((c) => hex2(linearToSrgb(c / brightness))).join('');
    const said = `the zone's first light, diffuse ${srgb.map((x) => x.toFixed(2)).join(', ')} in sky.json, read as sRGB as sky.ts reads it (linear ${lin.map((x) => x.toFixed(3)).join(', ')})`;
    fromColour = said;
    if (brightness > 1) fromBrightness = `${said}: its brightest linear part, ${brightness.toFixed(3)}`;
  }
  return {
    yaw, pitch, colour, brightness,
    groups: pick.groups, sunGroup: pick.sun,
    from: { yaw: fromDir, pitch: fromDir, colour: fromColour, brightness: fromBrightness },
  };
}

// ---------------------------------------------------------------------------------------------
// the owner's changes: only what differs from SWG's

export const PLACE_FIELDS = ['size', 'yaw', 'pitch', 'distance', 'tilt', 'spin', 'light', 'brightness'];
export const LIGHT_SOURCES = ['world-sun', 'zone-sun', 'fixed', 'painted'];

/** Which light sources a place may take: a ground sky's bodies the world's sun, a zone's the zone's. */
export function lightSourcesFor(place) {
  return place.space ? ['zone-sun', 'fixed', 'painted'] : ['world-sun', 'fixed', 'painted'];
}

/** A place's settings now: SWG's, with the owner's changes over them. */
export function effective(place, edits) {
  const e = (edits && edits[place.id]) || {};
  const out = { ...place.swg, light: { ...place.swg.light } };
  for (const k of PLACE_FIELDS) {
    if (k === 'light' || e[k] === undefined || e[k] === null) continue;
    if (!place.fields.includes(k)) continue;
    if (Number.isFinite(+e[k])) out[k] = +e[k];
  }
  if (e.light && typeof e.light === 'object') {
    if (lightSourcesFor(place).includes(e.light.source)) out.light.source = e.light.source;
    if (Number.isFinite(+e.light.azimuth) && e.light.azimuth !== null) out.light.azimuth = +e.light.azimuth;
    if (Number.isFinite(+e.light.elevation) && e.light.elevation !== null) out.light.elevation = +e.light.elevation;
  }
  return out;
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** A saved file's `places`, kept to the fields the file describes and values that are numbers. */
export function cleanPlaceEdits(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [id, e] of Object.entries(raw)) {
    if (!isObj(e)) continue;
    const o = {};
    for (const k of PLACE_FIELDS) {
      if (k === 'light') continue;
      if (e[k] !== undefined && e[k] !== null && Number.isFinite(+e[k])) o[k] = +e[k];
    }
    if (isObj(e.light)) {
      const l = {};
      if (LIGHT_SOURCES.includes(e.light.source)) l.source = e.light.source;
      if (Number.isFinite(+e.light.azimuth) && e.light.azimuth !== null) l.azimuth = +e.light.azimuth;
      if (Number.isFinite(+e.light.elevation) && e.light.elevation !== null) l.elevation = +e.light.elevation;
      if (Object.keys(l).length) o.light = l;
    }
    if (Object.keys(o).length) out[id] = o;
  }
  return out;
}

/** A saved file's `zones`: each zone's sun, kept to yaw, pitch, colour and brightness. */
export function cleanZoneEdits(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [zone, z] of Object.entries(raw)) {
    if (!isObj(z) || !isObj(z.sun)) continue;
    const s = {};
    if (Number.isFinite(+z.sun.yaw) && z.sun.yaw !== null) s.yaw = +z.sun.yaw;
    if (Number.isFinite(+z.sun.pitch) && z.sun.pitch !== null) s.pitch = +z.sun.pitch;
    if (typeof z.sun.colour === 'string' && /^#[0-9a-f]{6}$/i.test(z.sun.colour)) s.colour = z.sun.colour.toLowerCase();
    if (Number.isFinite(+z.sun.brightness) && z.sun.brightness !== null) s.brightness = +z.sun.brightness;
    if (Object.keys(s).length) out[zone] = { sun: s };
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// where a place is in its sky now, and where its light comes from

/**
 * sky.ts place(): where a place's body hangs at this moment, and whether the game shows it. In space
 * a body hangs where its zone puts it. Over a planet the sun slot rides the light by day and the moon
 * slot by night (the other waits below the ground), a second sun or moon keeps its offset from the
 * light, and a celestial is fixed or circles once per cycle; anything 0.3 below the horizon is hidden.
 */
export function placeDirection(place, eff, day) {
  if (place.space || !day) return { dir: skyDirection(eff.yaw ?? 0, eff.pitch ?? 0), shown: true, why: '' };
  let dir, shown = true, why = '';
  const k = place.kind;
  if (k === 'sun' || k === 'sun2') {
    shown = day.isDay;
    dir = k === 'sun' ? day.light : offsetDir(day.light, eff.yaw ?? 0, eff.pitch ?? 0);
    if (!shown) why = 'SWG shows the sun slot only by day (06:00 to 22:48)';
  } else if (k === 'moon' || k === 'moon2') {
    shown = !day.isDay;
    dir = k === 'moon' ? day.light : offsetDir(day.light, eff.yaw ?? 0, eff.pitch ?? 0);
    if (!shown) why = 'SWG shows the moon slot only by night (22:48 to 06:00)';
  } else {
    let pitch = eff.pitch ?? 45;
    if (place.cycle > 0) pitch += (place.pdir ?? 1) * 360 * ((day.clientTime % place.cycle) / place.cycle);
    dir = skyDirection(eff.yaw ?? 0, pitch);
  }
  const slot = k === 'sun' || k === 'sun2' || k === 'moon' || k === 'moon2';
  const alpha = slot ? day.slotAlpha : 1;
  if (shown && alpha <= 0.002) { shown = false; why = 'it is on the horizon, where SWG fades it out'; }
  if (shown && dir.y <= -0.3) { shown = false; why = 'it is below the horizon'; }
  return { dir, shown, why, alpha };
}

/** A body's own frame as the viewer sees it: right, up (toward the zenith along the sky) and back toward the viewer. */
export function bodyFrame(dir) {
  const back = { x: -dir.x, y: -dir.y, z: -dir.z };
  const h = Math.sqrt(dir.x * dir.x + dir.z * dir.z);
  const right = h > 1e-6 ? { x: -dir.z / h, y: 0, z: dir.x / h } : { x: 1, y: 0, z: 0 };
  const up = { x: back.y * right.z - back.z * right.y, y: back.z * right.x - back.x * right.z, z: back.x * right.y - back.y * right.x };
  return { right, up, back };
}

/** A light held against the body as you see it: `azimuth` round its disc (0 from the right, 90 from above), `elevation` toward you. */
export function heldLight(dir, azimuthDeg, elevationDeg) {
  const { right, up, back } = bodyFrame(dir);
  const a = azimuthDeg * DEG, e = elevationDeg * DEG;
  const ca = Math.cos(a) * Math.cos(e), sa = Math.sin(a) * Math.cos(e), se = Math.sin(e);
  return norm({ x: right.x * ca + up.x * sa + back.x * se, y: right.y * ca + up.y * sa + back.y * se, z: right.z * ca + up.z * sa + back.z * se });
}

/**
 * Where a place's light comes from: the world's sun at the hour, the zone's sun, a fixed light held
 * against the body, or the look's own painted light (`painted: true`; a sphere has none, so it takes
 * the look's painted angle as a held light). `power` and `colour` are the sun's.
 */
export function placeLight(place, eff, day, zoneSun, look, dir) {
  const src = eff.light.source;
  if (src === 'zone-sun' && zoneSun) return { dir: skyDirection(zoneSun.yaw, zoneSun.pitch), power: zoneSun.brightness, colour: zoneSun.colour, painted: false };
  if (src === 'world-sun' && day) return { dir: day.sun, power: 1, colour: '#ffffff', painted: false };
  if (src === 'painted') {
    if (look && look.kind !== 'sphere') return { dir: null, power: 1, colour: '#ffffff', painted: true };
    return { dir: heldLight(dir, +look?.adjust?.lightAngle || 150, +look?.adjust?.lightElev || 25), power: 1, colour: '#ffffff', painted: false };
  }
  return { dir: heldLight(dir, eff.light.azimuth ?? 150, eff.light.elevation ?? 25), power: 1, colour: '#ffffff', painted: false };
}

// ---------------------------------------------------------------------------------------------
// words for directions and phases

const COMPASS = ['ahead', 'ahead and to the right', 'to the right', 'behind and to the right', 'behind', 'behind and to the left', 'to the left', 'ahead and to the left'];
/** "behind and to the left (yaw -150), 40 up": a pitch past 90 goes on over the top, so it is turned round first. */
export function directionWords(yaw, pitch) {
  let p = pitch, yw = yaw;
  if (p > 90) { p = 180 - p; yw += 180; }
  if (p < -90) { p = -180 - p; yw += 180; }
  const y = ((((yw + 180) % 360) + 360) % 360) - 180;
  const i = ((Math.round(y / 45) % 8) + 8) % 8;
  const up = p > 89.5 ? 'overhead' : p < -89.5 ? 'straight below' : p >= 0 ? `${Math.round(p)}° up` : `${Math.round(-p)}° down`;
  return `${COMPASS[i]} (yaw ${Math.round(y)}°), ${up}`;
}

/** How much of a body's face, seen from the camera, its light shows: the lit share and its word. */
export function phaseOf(toBody, light) {
  // From the body, the viewer is back along toBody: the lit share is (1 + cos(phase angle)) / 2.
  const v = norm({ x: -toBody.x, y: -toBody.y, z: -toBody.z });
  const l = norm(light);
  const c = clamp(v.x * l.x + v.y * l.y + v.z * l.z, -1, 1);
  const lit = (1 + c) / 2;
  const word = lit > 0.97 ? 'full' : lit > 0.6 ? 'gibbous' : lit > 0.4 ? 'half lit' : lit > 0.03 ? 'a crescent' : 'new (dark)';
  return { lit, word };
}
