// The space zones: what the client files say a system holds. A zone has no world snapshot; its
// stations come from datatables/space/spacestation/<zone>.iff (a name and a place each), its
// asteroid fields from datatables/space/asteroidfield/<zone>.iff (a centre, a radius, a count,
// a seed and a style table naming the asteroid appearances with their likelihoods, or a spline
// the field follows), and its sky from its terrain file (terrain/<zone>.trn: the skybox, the
// lights, the star field, the dust, the star sprites, and the planets and moons in the picture
// as PLAN forms, the planet appearance then eight floats and a byte; each body's radius is its
// planet appearance's). The pure parts live here, for the tests.
import { findAll, readCString } from './iff.mjs';

/**
 * The space zones the game flies, and the planet each is the sky of. The last three are systems of
 * their own, no planet's orbit: nothing below them to land on or eject to.
 */
export const SPACE_ZONES = {
  space_tatooine: 'tatooine',
  space_naboo: 'naboo',
  space_corellia: 'corellia',
  space_dantooine: 'dantooine',
  space_lok: 'lok',
  space_endor: 'endor',
  space_dathomir: 'dathomir',
  space_yavin4: 'yavin4',
  space_kashyyyk: 'kashyyyk',
  // Systems that are no planet's orbit: nothing to land on.
  space_ord_mantell: null,
  space_light1: null,
  space_heavy1: null,
};

/** space.json's layout version: 2 adds the title, the arrival, the scenery and the hyperspace block. */
export const SPACE_PACK_VERSION = 2;

/**
 * The station drawn for each station the zone tables name: the tables carry the server's names,
 * and the client's station appearances are the factions' (object/ship/shared_spacestation_*).
 * The pairing is by what each system was in the game; a name not listed gets the neutral station.
 */
export const STATION_LOOKS = {
  station_tatooine: 'neutral',
  station_naboo: 'rsf',
  station_rori: 'neutral',
  station_corellia: 'corsec',
  station_talus: 'neutral',
  station_lok: 'imperial_outpost',
  station_yavin4: 'rebel',
  station_dantooine: 'rebel_outpost',
  station_dathomir: 'imperial_outpost',
  station_endor: 'imperial',
  station_kashyyyk: 'neutral',
};

export function stationTemplate(name) {
  return `object/ship/shared_spacestation_${STATION_LOOKS[name] ?? 'neutral'}.iff`;
}

/**
 * The planets and moons a zone's terrain file draws: each PLAN form's chunk is the planet
 * appearance's path, then eight floats and a byte, the layout the ground's environment files give
 * their planets too (sky.mjs): the body's place (x, y, z: where it hangs from the camera, in the
 * same metres as its appearance's radius), three angles in degrees (its own turn), the halo's roll
 * in degrees and the halo's scale, and a byte (0 on every retail body). The chunk holds no size:
 * that is the planet appearance's radius (parsePlanetAppearance), seen from the place's distance
 * (spaceBody). The eighth float, once read as a size, is the halo's scale in the ground reader's
 * layout: it is 0 on all of Ord Mantell's bodies and on Kashyyyk's planet, which the old reading
 * turned into size 0. It does not follow the appearance's HALO chunk (Dathomir and
 * tatooine_moon_03 have none and a non-zero value there; Ord Mantell's haloed moon has 0).
 */
export function parseSpacePlanets(root) {
  const out = [];
  for (const form of findAll(root, 'PLAN')) {
    const c = form.children.find((ch) => ch.tag === '0000' || ch.tag === 'DATA');
    if (!c) continue;
    const { value, next } = readCString(c.data, 0);
    const f = [];
    for (let o = next; o + 4 <= c.data.length && f.length < 8; o += 4) f.push(c.data.readFloatLE(o));
    if (!value || f.length < 8) continue;
    const flag = next + 32 < c.data.length ? c.data[next + 32] : 0;
    out.push({ appearance: value.replace(/\\/g, '/'), direction: [f[0], f[1], f[2]], angles: [f[3], f[4], f[5]], haloRoll: f[6], haloScale: f[7], flag });
  }
  return out;
}

/**
 * A planet appearance (FORM PLNT > FORM 0000), the parts that size and paint it: SURF is a float
 * (unresolved: 0.005 to 1.15, some negative, read as a spin), the surface shader, the body's radius
 * (metres in the frame the terrain file's PLAN places it in: 390 for Tatooine, 1 to 4 for Ord
 * Mantell's small moons) and four floats (unresolved); CLOD, when there is one, the same float, the
 * cloud shader, the cloud shell's radius (a little over the surface's) and two floats (unresolved);
 * HALO, when there is one, the halo shader and a float (read as its own scale; null if a chunk ever
 * stopped after the shader, which none of the 15 retail HALO chunks does). INIT (two integers,
 * read as the sphere's segments) is not needed. Null for anything else, or without a readable SURF.
 */
export function parsePlanetAppearance(root) {
  if (!root || root.tag !== 'FORM' || root.type !== 'PLNT') return null;
  const v = (root.children ?? []).find((c) => c.tag === 'FORM');
  if (!v) return null;
  const chunk = (tag) => v.children.find((c) => c.tag === tag)?.data ?? null;
  const round = (x) => Math.round(x * 10000) / 10000;
  const layer = (b) => {
    if (!b || b.length < 5) return null;
    const { value, next } = readCString(b, 4);
    if (!value || next + 4 > b.length) return null;
    return { shader: slashes(value), radius: round(b.readFloatLE(next)) };
  };
  const surface = layer(chunk('SURF'));
  if (!surface) return null;
  const halo = (() => {
    const b = chunk('HALO');
    if (!b) return null;
    const { value, next } = readCString(b, 0);
    return value ? { shader: slashes(value), scale: next + 4 <= b.length ? round(b.readFloatLE(next)) : null } : null;
  })();
  return { shader: surface.shader, radius: surface.radius, clouds: layer(chunk('CLOD')), halo };
}

/**
 * What the game draws a space body with (src/world/world.ts): a body of size 1 is a sphere of this
 * radius in metres (`radius`) hung this far out (`distance`), riding with the camera. The pack's
 * `size` is in that unit. These two mirror world.ts's SPACE_BODY_SIZE and SPACE_BODY_DISTANCE, and
 * the space test checks that they still agree.
 */
export const SPACE_BODY_FRAME = { distance: 2600, radius: 240 };

/**
 * Invented, not the client's: the size a body is given when its appearance is missing or names no
 * radius (none of the retail zones' bodies). 1 is what every body was drawn at before the sizes were
 * read, a disc about ten degrees across.
 */
export const INVENTED_BODY_SIZE = 1;

/**
 * One body's space.json entry from its PLAN (parseSpacePlanets) and its appearance
 * (parsePlanetAppearance, or null): the place as `direction`, its `distance` from the camera, the
 * appearance's `radius`, and `size`, the radius over the distance in the game's unit (SPACE_BODY_FRAME),
 * so the body covers as much of the sky as the client's does wherever the game hangs it. `sizeFrom` is
 * 'appearance', or 'invented' when there was no radius (INVENTED_BODY_SIZE). `halo` is the PLAN's roll
 * and scale with the appearance's halo shader, or null when the appearance has no halo or the scale is 0.
 */
export function spaceBody(plan, look, texture = null) {
  const r2 = (x) => Math.round(x * 100) / 100;
  const distance = Math.hypot(...plan.direction);
  const radius = look && Number.isFinite(look.radius) && look.radius > 0 ? look.radius : null;
  const size = radius !== null && distance > 0 ? (radius / distance) * (SPACE_BODY_FRAME.distance / SPACE_BODY_FRAME.radius) : INVENTED_BODY_SIZE;
  return {
    appearance: plan.appearance,
    direction: plan.direction.map(r2),
    distance: r2(distance),
    radius,
    size: Math.round(size * 10000) / 10000,
    sizeFrom: radius !== null && distance > 0 ? 'appearance' : 'invented',
    angles: plan.angles.map(r2),
    halo: look?.halo && plan.haloScale > 0 ? { shader: look.halo.shader, roll: r2(plan.haloRoll), scale: r2(plan.haloScale) } : null,
    texture,
  };
}

/**
 * A zone's own environment, from the forms of its terrain file: the six-sided skybox the SKYB
 * form names (a byte, then the name: the faces are texture/<name>_<front|right|back|left|top|
 * bottom>.dds), the cube map the ENVI form names (what reflections see, not the sky), the clear
 * colour (CLEA: three floats), the ambient light (AMBI: alpha, red, green, blue), the parallel
 * lights (PARA: a byte, the diffuse and specular colours as alpha-red-green-blue, then yaw,
 * pitch and roll in degrees, the light shining down the turned frame's forward), the star field
 * (STAR: the colour ramp's path, then a count), the dust round the camera (DUST: a count, then
 * a radius in metres) and the celestial sprites (CELE: a shader, a size, a spare float, a byte,
 * then yaw, pitch and roll in degrees, the sprite hung along the turned frame's forward).
 */
export function parseSpaceEnvironment(root) {
  const chunkOf = (form) => form.children.find((ch) => ch.tag === '0000' || ch.tag === 'DATA');
  const each = (tag) => findAll(root, tag).map(chunkOf).filter(Boolean).map((c) => c.data);
  const first = (tag) => each(tag)[0] ?? null;
  const f32s = (b, from, n) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(from + 4 * i + 4 <= b.length ? b.readFloatLE(from + 4 * i) : 0);
    return out;
  };
  const rgb = (b, at) => f32s(b, at, 4).slice(1);
  const out = { skybox: null, environmentMap: null, clear: null, ambient: null, lights: [], stars: null, dust: null, celestials: [] };
  const skyb = first('SKYB');
  if (skyb && skyb.length > 1) out.skybox = readCString(skyb, 1).value || null;
  const envi = first('ENVI');
  if (envi) out.environmentMap = readCString(envi, 0).value.replace(/\\/g, '/') || null;
  const clea = first('CLEA');
  if (clea && clea.length >= 12) out.clear = f32s(clea, 0, 3);
  const ambi = first('AMBI');
  if (ambi && ambi.length >= 16) out.ambient = rgb(ambi, 0);
  for (const b of each('PARA')) {
    if (b.length < 45) continue;
    const [yaw, pitch, roll] = f32s(b, 33, 3);
    out.lights.push({ shadows: b[0] !== 0, diffuse: rgb(b, 1), specular: rgb(b, 17), yaw, pitch, roll });
  }
  const star = first('STAR');
  if (star) {
    const { value, next } = readCString(star, 0);
    out.stars = { colorRamp: value.replace(/\\/g, '/'), count: next + 4 <= star.length ? star.readInt32LE(next) : 0 };
  }
  const dust = first('DUST');
  if (dust && dust.length >= 8) out.dust = { count: dust.readInt32LE(0), radius: dust.readFloatLE(4) };
  for (const b of each('CELE')) {
    const { value, next } = readCString(b, 0);
    if (!value || next + 21 > b.length) continue;
    const [yaw, pitch, roll] = f32s(b, next + 9, 3);
    out.celestials.push({ shader: value.replace(/\\/g, '/'), size: b.readFloatLE(next), yaw, pitch, roll });
  }
  return out;
}

/** A small seeded random generator (mulberry32), so a field scatters the same way every conversion. */
export function seeded(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The control points of a field's spline, "x,y,z:x,y,z:..." as the table writes them. */
export function parseSpline(text) {
  return String(text ?? '')
    .split(':')
    .map((p) => p.split(',').map(Number))
    .filter((p) => p.length === 3 && p.every(Number.isFinite));
}

/**
 * Where a field's asteroids go: `row` is the field table's row, `styles` the style table's rows
 * ({ SharedTemplate, Likelihood }). A type 1 field fills a sphere round its centre; a type 2
 * field runs along its spline, each asteroid within the radius of a point on it. Each asteroid
 * is a template, a place, a random turn (a quaternion as w, x, y, z) and a scale within the
 * row's range. At most `cap` asteroids, whatever the row asks for.
 */
export function scatterField(row, styles, cap = 400) {
  const rng = seeded(Number(row.RandomSeed) || 1);
  const count = Math.min(cap, Math.max(0, Math.round(Number(row.NumAsteroids) || 0)));
  const radius = Math.max(1, Number(row.Radius) || 1);
  const centre = [Number(row.CenterLocationX) || 0, Number(row.CenterLocationY) || 0, Number(row.CenterLocationZ) || 0];
  const spline = Number(row.Type) === 2 ? parseSpline(row.SplineControlPoints) : [];
  const total = styles.reduce((n, s) => n + (Number(s.Likelihood) || 0), 0);
  const pick = () => {
    if (!styles.length) return null;
    let r = rng() * (total || styles.length);
    for (const s of styles) {
      r -= total ? Number(s.Likelihood) || 0 : 1;
      if (r <= 0) return s.SharedTemplate;
    }
    return styles[styles.length - 1].SharedTemplate;
  };
  // Segment lengths, so a spline field is even along its length rather than per control point.
  const lengths = [];
  let splineLength = 0;
  for (let i = 1; i < spline.length; i++) {
    const l = Math.hypot(spline[i][0] - spline[i - 1][0], spline[i][1] - spline[i - 1][1], spline[i][2] - spline[i - 1][2]);
    lengths.push(l);
    splineLength += l;
  }
  const inSphere = () => {
    // A point spread evenly through a unit sphere: a random direction at a radius weighted by volume.
    const u = rng() * 2 - 1;
    const a = rng() * Math.PI * 2;
    const r = Math.cbrt(rng());
    const s = Math.sqrt(1 - u * u);
    return [r * s * Math.cos(a), r * u, r * s * Math.sin(a)];
  };
  const out = [];
  const smin = Number(row.ScaleMin) || 1;
  const smax = Number(row.ScaleMax) || smin;
  for (let i = 0; i < count; i++) {
    const template = pick();
    if (!template) break;
    let at;
    if (spline.length >= 2 && splineLength > 0) {
      let d = rng() * splineLength;
      let seg = 0;
      while (seg < lengths.length - 1 && d > lengths[seg]) d -= lengths[seg++];
      const t = lengths[seg] > 0 ? d / lengths[seg] : 0;
      const a = spline[seg];
      const b = spline[seg + 1];
      const off = inSphere();
      at = [a[0] + (b[0] - a[0]) * t + off[0] * radius, a[1] + (b[1] - a[1]) * t + off[1] * radius, a[2] + (b[2] - a[2]) * t + off[2] * radius];
    } else {
      const off = inSphere();
      at = [centre[0] + off[0] * radius, centre[1] + off[1] * radius, centre[2] + off[2] * radius];
    }
    // A random turn: a quaternion from three angles.
    const yaw = rng() * Math.PI * 2;
    const pitch = (rng() - 0.5) * Math.PI;
    const roll = rng() * Math.PI * 2;
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2), cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
    const q = [cr * cp * cy + sr * sp * sy, sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy];
    out.push({ template: String(template).replace(/\\/g, '/'), x: at[0], y: at[1], z: at[2], q: q.map((v) => Math.round(v * 10000) / 10000), scale: smin + (smax - smin) * rng() });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Hyperspace. The client's point table (datatables/space/hyperspace/hyperspace_locations.iff:
// HYPERSPACE_POINT_NAME, SCENE, X, Y, Z) is in the same frame as the station tables: each point's
// description gives its distance to its system's stations, and those distances fit the unmirrored
// pairing (checkPointFrame repeats that on every conversion). The jump itself is scene/hyperspace.iff
// (three stages) and the two warp particle effects it names.

const slashes = (p) => String(p ?? '').replace(/\\/g, '/');

/**
 * scene/hyperspace.iff: HYPR > 0000 > DATA (a float, unresolved), STG1 and STG3 (the stage's seconds,
 * the warp .prt, a .cef, a float that is unresolved, a .snd) and STG2 (three floats, read as the
 * longest wait for the new scene, the speed the ship leaves at and the hand-over fade, and a .snd).
 * Null for anything else. The chunks are found by tag over the version form's children.
 */
export function parseHyperspaceScene(root) {
  if (!root || root.tag !== 'FORM' || root.type !== 'HYPR') return null;
  const v = (root.children ?? []).find((c) => c.tag === 'FORM' && c.type === '0000');
  if (!v) return null;
  const chunk = (tag) => v.children.find((c) => c.tag === tag)?.data ?? null;
  const data = chunk('DATA');
  const s1 = chunk('STG1');
  const s2 = chunk('STG2');
  const s3 = chunk('STG3');
  if (!s1 || !s2 || !s3) return null;
  const round = (x) => Math.round(x * 10000) / 10000;
  const stage = (b) => {
    let o = 0;
    const f = () => {
      const x = o + 4 <= b.length ? b.readFloatLE(o) : 0;
      o += 4;
      return round(x);
    };
    const s = () => {
      const { value, next } = readCString(b, o);
      o = next;
      return slashes(value);
    };
    const seconds = f();
    const particle = s();
    const clientEffect = s();
    const value = f();
    const sound = s();
    return { seconds, particle, clientEffect, value, sound };
  };
  const transit = (() => {
    const f = (o) => (o + 4 <= s2.length ? round(s2.readFloatLE(o)) : 0);
    return { limit: f(0), speed: f(4), fade: f(8), sound: slashes(readCString(s2, 12).value) };
  })();
  return { scale: data && data.length >= 4 ? round(data.readFloatLE(0)) : 1, enter: stage(s1), transit, exit: stage(s3) };
}

/** Every emitter of a parsed particle effect, with the second its first particle can appear (the group's and its own start delay, at their longest). */
function emittersOf(effect) {
  const out = [];
  for (const g of effect?.groups ?? []) {
    const gs = g.timing?.startDelay?.[1] ?? 0;
    for (const e of g.emitters ?? []) out.push({ e, start: gs + (e.timing?.startDelay?.[1] ?? 0) });
  }
  return out;
}

/** The largest value a waveform's keys take (their own values, not the random band). */
const keysMax = (wf) => Math.max(0, ...(wf?.points ?? []).map((p) => p[1]));

/** The time (0..1 of a life) of the last key at or above `level`; 0 when none. */
const lastKeyAtOrAbove = (wf, level) => {
  let t = 0;
  for (const p of wf?.points ?? []) if (p[1] >= level - 1e-6) t = p[0];
  return t;
};

/**
 * The jump's timings from the two parsed warp effects (parseParticleEffect's output):
 * { enterPeak, tunnelAt, exitBurstAt, exitClearAt }, each null when the effect has no emitter of that kind.
 * - enterPeak: over the enter effect's textured one-shot quad emitters, the largest start + life x (the
 *   time of the alpha ramp's last key at its maximum): the end of the streaks' brightest stretch.
 * - tunnelAt: the smallest start of the enter effect's untextured quad emitters (the dark tunnel).
 * - exitBurstAt: the smallest start of the exit effect's textured one-shot emitters (the stars bursting past).
 * - exitClearAt: over the exit effect's untextured one-shot quad emitters, the largest start + life x (the
 *   time of the alpha ramp's last key at or above half its maximum): when the tunnel starts to dissolve.
 * "Textured" is a quad whose texture names a shader; "untextured" one whose shader is empty; both must be
 * visible. A start is the timing's longest start delay, a life the largest value of the life-time keys.
 */
export function warpTimings(enter, exit) {
  const quads = (effect, textured) =>
    emittersOf(effect).filter(({ e }) => e.visible !== false && e.particle?.type === 'quad' && !!e.particle.quad?.texture?.shader === textured);
  const life = (e) => keysMax(e.lifeTime);
  const round = (x) => (x === null ? null : Math.round(x * 1000) / 1000);
  const most = (xs) => (xs.length ? Math.max(...xs) : null);
  const least = (xs) => (xs.length ? Math.min(...xs) : null);
  const enterStreaks = quads(enter, true).filter(({ e }) => e.oneShot);
  const enterPeak = most(enterStreaks.map(({ e, start }) => start + life(e) * lastKeyAtOrAbove(e.particle.alpha, keysMax(e.particle.alpha))));
  const tunnelAt = least(quads(enter, false).map(({ start }) => start));
  const exitBurstAt = least(quads(exit, true).filter(({ e }) => e.oneShot).map(({ start }) => start));
  const exitTunnels = quads(exit, false).filter(({ e }) => e.oneShot);
  const exitClearAt = most(exitTunnels.map(({ e, start }) => start + life(e) * lastKeyAtOrAbove(e.particle.alpha, keysMax(e.particle.alpha) / 2)));
  return { enterPeak: round(enterPeak), tunnelAt: round(tunnelAt), exitBurstAt: round(exitBurstAt), exitClearAt: round(exitClearAt) };
}

/** A string from the tables without its colour codes (`\#pcontrast3 `) and stray backslashes; line breaks kept. */
export function cleanText(text) {
  return String(text ?? '')
    .replace(/\\#[0-9A-Za-z]+ ?/g, '')
    .replace(/\\+/g, '')
    .trim();
}

/** A zone's system name, without the server's "(PvP Enabled)" or "(RESTRICTED)". */
export function cleanZoneTitle(text) {
  return cleanText(text)
    .replace(/\s*\((?:PvP Enabled|RESTRICTED)\)\s*$/i, '')
    .trim();
}

/** "a_b_c" as "A b c". */
const sentenceCase = (s) => {
  const t = String(s).replace(/_/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
};

/** "a_b_c" as "A B C". */
const titleCase = (s) =>
  String(s)
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

/**
 * A station's title and description from the point tables (<planet>_station_0 for station_<planet>),
 * else a title made from its name ("station_kashyyyk" is "Kashyyyk Space Station",
 * "spacestation_imperial" is "Imperial station"). The descriptions' "Land Here" promises a landing that
 * is not built: that clause is dropped ("Space Station, Land Here." is "Space Station";
 * "Lok Space Station. Land Here" is "Lok Space Station."). A description left empty is the title.
 */
export function stationStrings(name, names, descs) {
  const n = String(name ?? '');
  const m = /^station_(.+)$/.exec(n);
  const key = m ? `${m[1]}_station_0` : null;
  const own = key ? cleanText(names?.get(key) ?? '') : '';
  const title = own || (m ? `${titleCase(m[1])} Space Station` : /^spacestation_(.+)$/.test(n) ? `${sentenceCase(n.replace(/^spacestation_/, ''))} station` : sentenceCase(n));
  const raw = key ? cleanText(descs?.get(key) ?? '') : '';
  const description = raw.replace(/[,;]?[ \t]*\bland here\b[.!]?/gi, '').trim();
  return { title, description: description || title };
}

/**
 * Made up here, not in the client's files: the client names Kessel's and Deep Space's four points
 * (hyperspace_points_n) but the table places none of them (the server kept them). Client frame, as the
 * table's rows are. Kessel's are clear of its asteroid fields (1.4 to 4.7 km from the nearest asteroid).
 */
export const INVENTED_POINTS = {
  space_light1_0: [-5200, -800, 5600], // Kessel: Quadrant I
  space_light1_1: [5800, -1200, -5400], // Kessel: Quadrant IV
  space_light1_2: [6200, 1500, 4600], // Kessel: Quadrant III
  space_light1_3: [-5600, 900, -4800], // Kessel: Quadrant II
  space_heavy1_0: [4800, 400, 5200], // Deep Space: Quadrant I (the Star Destroyer's)
  space_heavy1_1: [5400, -600, -4800], // Deep Space: Quadrant IV
  space_heavy1_2: [-5000, 300, -5400], // Deep Space: Quadrant III
  space_heavy1_3: [-5600, -400, 4600], // Deep Space: Quadrant II
};

/**
 * A zone that takes another scene's rows: Ord Mantell has no row of its own, and its one point is its
 * sister scene's (space_nova_orion has the same station, fields and sky).
 */
export const BORROWED_POINTS = { space_ord_mantell: ['space_nova_orion_0'] };

/**
 * Deep Space's contents, made up (the client has no field table for it): rows in the asteroid field
 * table's own columns, scattered like the real ones by scatterField.
 */
export const INVENTED_FIELDS = {
  space_heavy1: [
    { Name: 'Unknown Regions wreckage (invented)', Type: 1, SplineControlPoints: '', CenterLocationX: 1000, CenterLocationY: 300, CenterLocationZ: 5600, Radius: 500, NumAsteroids: 60, RandomSeed: 1701, ScaleMin: 1, ScaleMax: 1, FieldStyleTable: 'datatables/space/asteroidfield/fieldstyle/debris_xwingvstie.iff' },
    { Name: 'Unknown Regions belt (invented)', Type: 1, SplineControlPoints: '', CenterLocationX: -2500, CenterLocationY: 800, CenterLocationZ: 1500, Radius: 1100, NumAsteroids: 140, RandomSeed: 4242, ScaleMin: 1, ScaleMax: 1, FieldStyleTable: 'datatables/space/asteroidfield/fieldstyle/asteroid_basic_large.iff' },
  ],
};

/**
 * Scenery, made up: a model hung near a point, toward the zone's middle, broadside to it. The Star
 * Destroyer is the plain ship template (the exterior only; the spacestation_stardestroyer template
 * adds its 59-cell interior, which is not boarded).
 */
export const INVENTED_SCENERY = {
  space_heavy1: [{ name: 'Star Destroyer', template: 'object/ship/shared_star_destroyer.iff', near: 'space_heavy1_0', distance: 2200, rise: 250 }],
};

/** The scene a point id belongs to: "space_tatooine_2" is space_tatooine's. */
const sceneOfPoint = (id) => String(id).replace(/_\d+$/, '');

/**
 * A zone's hyperspace points: its own table rows, any it borrows, and any made up; sorted by id. Each
 * is { id, name, description, x, y, z, source: 'table' | 'borrowed' | 'invented', from? } in the
 * client frame. Names and descriptions come from the string maps through cleanText (a name kept as the
 * table has it, "Deep Space: Unknown Regions / Quadrant I"); a missing name falls back to the id, a
 * missing description to the name. A named id with no row (and not made up) is not a point.
 */
export function hyperspacePoints(zone, rows, names, descs) {
  const strings = (id) => {
    const name = cleanText(names?.get(id) ?? '') || id;
    return { name, description: cleanText(descs?.get(id) ?? '') || name };
  };
  const out = [];
  const seen = new Set();
  const num = (v) => Number(v) || 0;
  for (const r of rows ?? []) {
    if (r.SCENE !== zone || seen.has(r.HYPERSPACE_POINT_NAME)) continue;
    seen.add(r.HYPERSPACE_POINT_NAME);
    out.push({ id: r.HYPERSPACE_POINT_NAME, ...strings(r.HYPERSPACE_POINT_NAME), x: num(r.X), y: num(r.Y), z: num(r.Z), source: 'table' });
  }
  for (const id of BORROWED_POINTS[zone] ?? []) {
    const r = (rows ?? []).find((row) => row.HYPERSPACE_POINT_NAME === id);
    if (!r || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, ...strings(id), x: num(r.X), y: num(r.Y), z: num(r.Z), source: 'borrowed', from: r.SCENE });
  }
  for (const [id, [x, y, z]] of Object.entries(INVENTED_POINTS)) {
    if (sceneOfPoint(id) !== zone || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, ...strings(id), x, y, z, source: 'invented' });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Where scenery goes: `distance` from its point toward the zone's origin, measured across (at least
 * `radius + 400`, so no model can reach within 400 m of the point whatever its size), `rise` metres
 * above the point, turned about Y so its long axis (Z) lies across the line from the point: broadside
 * to a ship arriving there. Returns { x, y, z, q: [w, x, y, z] } in the client frame.
 */
export function placeScenery(point, spec, radius) {
  const d = Math.max(Number(spec.distance) || 0, (Number(radius) || 0) + 400);
  let dx = -point.x;
  let dz = -point.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) {
    dx = 0;
    dz = 1;
  } else {
    dx /= len;
    dz /= len;
  }
  // The model's Z turned onto (dz, -dx), which is square to the line (dx, dz).
  const yaw = Math.atan2(dz, -dx);
  const r4 = (v) => Math.round(v * 10000) / 10000;
  return {
    x: Math.round(point.x + dx * d),
    y: Math.round(point.y + (Number(spec.rise) || 0)),
    z: Math.round(point.z + dz * d),
    q: [r4(Math.cos(yaw / 2)), 0, r4(Math.sin(yaw / 2)), 0],
  };
}

/**
 * The zone's arrival: an orbit's is the origin, where a ship climbing out of the planet's sky comes out
 * (kind 'launch'); any other system's is its first point (kind 'point'), else the origin.
 */
export function arrivalOf(zone, planet, points) {
  void zone;
  if (planet) return { x: 0, y: 0, z: 0, kind: 'launch', planet };
  const p = points?.[0];
  if (p) return { x: p.x, y: p.y, z: p.z, kind: 'point', point: p.id };
  return { x: 0, y: 0, z: 0, kind: 'point' };
}

/** How far short of a station's centre a jump to it stops: its radius and this much more. */
export const STATION_STANDOFF = 400;

/**
 * Where a ship jumping to a station from the zone's arrival stops (the runtime's arrivalPose rule, in
 * the client frame): radius + 400 short of the station on the line from the arrival; straight along +Z
 * from the station when the station sits on the arrival. Returns [x, y, z].
 */
export function stationApproachEnd(station, arrival) {
  const off = (Number(station.radius) || 0) + STATION_STANDOFF;
  const dx = arrival.x - station.x;
  const dy = arrival.y - station.y;
  const dz = arrival.z - station.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-3) return [station.x, station.y, station.z + off];
  return [station.x + (dx / len) * off, station.y + (dy / len) * off, station.z + (dz / len) * off];
}

/**
 * The station distances a point's description gives: "Distance to Tatooine Space Station: 15144m" is
 * [{ station: 'station_tatooine', metres: 15144, rough: false }]; "~9.5km" is 9500 and rough. The
 * station's table name is made from the words before "Space Station" ("Yavin 4" is station_yavin4).
 */
export function describedDistances(description) {
  const out = [];
  const re = /Distance to ([^:\n]+?)\s*:\s*(~?)\s*([\d.]+)\s*(km|m)\b/gi;
  let m;
  while ((m = re.exec(String(description ?? '')))) {
    const words = m[1].replace(/\bspace station\b/i, '').replace(/\s+/g, '').toLowerCase();
    const metres = Number(m[3]) * (m[4].toLowerCase() === 'km' ? 1000 : 1);
    if (!words || !Number.isFinite(metres)) continue;
    out.push({ station: `station_${words}`, metres, rough: m[2] === '~' });
  }
  return out;
}

/**
 * The frame check over a zone's table points: for every exact distance a point's description gives to
 * a station of the zone, which pairing fits (the point as it is, or with its X mirrored). Rough
 * distances are skipped. Returns { checked, sameCloser, mirroredCloser, meanErrorSame, meanErrorMirrored }.
 */
export function checkPointFrame(points, stations) {
  let checked = 0;
  let sameCloser = 0;
  let mirroredCloser = 0;
  let errSame = 0;
  let errMirrored = 0;
  for (const p of points ?? []) {
    for (const d of describedDistances(p.description)) {
      if (d.rough) continue;
      const s = (stations ?? []).find((st) => String(st.name).toLowerCase() === d.station);
      if (!s) continue;
      const same = Math.abs(Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z) - d.metres);
      const mirrored = Math.abs(Math.hypot(-p.x - s.x, p.y - s.y, p.z - s.z) - d.metres);
      checked++;
      if (same <= mirrored) sameCloser++;
      else mirroredCloser++;
      errSame += same;
      errMirrored += mirrored;
    }
  }
  return {
    checked,
    sameCloser,
    mirroredCloser,
    meanErrorSame: checked ? Math.round(errSame / checked) : 0,
    meanErrorMirrored: checked ? Math.round(errMirrored / checked) : 0,
  };
}

/**
 * How far a point ({ x, y, z } or [x, y, z]) is from the nearest placed object's surface (its centre's
 * distance less its radius), leaving out `except`; Infinity when there is nothing else.
 */
export function clearanceOf(point, objects, except = null) {
  return nearestObject(point, objects, except).clearance;
}

/** The placed object whose surface is nearest a point, and how far that is: { object, clearance } (null and Infinity with nothing else). */
export function nearestObject(point, objects, except = null) {
  const [x, y, z] = Array.isArray(point) ? point : [point.x, point.y, point.z];
  let clearance = Infinity;
  let object = null;
  for (const o of objects ?? []) {
    if (o === except) continue;
    const c = Math.hypot(o.x - x, o.y - y, o.z - z) - (Number(o.radius) || 0);
    if (c < clearance) {
      clearance = c;
      object = o;
    }
  }
  return { object, clearance };
}

/**
 * The `status` line for one space zone's pack (its space.json and the number of objects its layout
 * places), and whether the pack wants the space command again (missing, or converted before
 * hyperspace). `pack` is null when there is none.
 */
export function spaceZoneStatus(zone, pack, objects) {
  if (!pack) return { line: `${zone}: no pack`, stale: true };
  const stations = pack.stations?.length ?? 0;
  const counts = `${stations} station${stations === 1 ? '' : 's'}${pack.scenery?.length ? `, ${pack.scenery.length} scenery` : ''}, ${objects ?? 0} objects`;
  if ((pack.version ?? 1) < SPACE_PACK_VERSION || !pack.hyperspace?.points) return { line: `${zone}: ${counts}, converted before hyperspace`, stale: true };
  // A body with no `radius` at all (null is an appearance that names none) was sized from the halo's scale.
  if ((pack.planets ?? []).some((p) => p && p.radius === undefined)) return { line: `${zone}: ${counts}, planets converted before their sizes were read`, stale: true };
  const points = pack.hyperspace.points;
  const by = (source) => points.filter((p) => p.source === source).length;
  const notes = [by('invented') && `${by('invented')} invented`, by('borrowed') && `${by('borrowed')} borrowed`].filter(Boolean);
  const a = pack.arrival;
  const arrival = !a ? 'no arrival' : a.kind === 'launch' ? 'arrival at launch point' : `arrival at point ${a.point ?? 'the origin'}`;
  const f = pack.hyperspace.frameCheck;
  const frame = f && f.mirroredCloser > f.sameCloser ? `; WARNING: ${f.mirroredCloser} of ${f.checked} described distances fit the mirrored pairing` : '';
  const fx = pack.hyperspace.effects?.enter && pack.hyperspace.effects?.exit ? '' : ', no warp effects';
  return {
    line: `${zone}: ${pack.title || zone}, ${counts}, ${points.length} hyperspace point${points.length === 1 ? '' : 's'}${notes.length ? ` (${notes.join(', ')})` : ''}, ${arrival}${fx}${frame}`,
    stale: false,
  };
}
