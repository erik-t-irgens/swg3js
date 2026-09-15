// The space zones: what the client files say a system holds. A zone has no world snapshot; its
// stations come from datatables/space/spacestation/<zone>.iff (a name and a place each), its
// asteroid fields from datatables/space/asteroidfield/<zone>.iff (a centre, a radius, a count,
// a seed and a style table naming the asteroid appearances with their likelihoods, or a spline
// the field follows), and its sky from its terrain file (terrain/<zone>.trn: the skybox, the
// lights, the star field, the dust, the star sprites, and the planets and moons in the picture
// as PLAN forms, the planet appearance then eight floats). The pure parts live here, for the tests.
import { findAll, readCString } from './iff.mjs';

/** The space zones the game flies, and the planet each is the sky of. */
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
};

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
 * appearance's path, then eight floats, read as a direction (the first three: where in the sky
 * it hangs, the client scaling it out to the sky's distance), three angles, a spare, and a size.
 */
export function parseSpacePlanets(root) {
  const out = [];
  for (const form of findAll(root, 'PLAN')) {
    const c = form.children.find((ch) => ch.tag === '0000' || ch.tag === 'DATA');
    if (!c) continue;
    const { value, next } = readCString(c.data, 0);
    const f = [];
    for (let o = next; o + 4 <= c.data.length; o += 4) f.push(c.data.readFloatLE(o));
    if (!value || f.length < 8) continue;
    out.push({ appearance: value.replace(/\\/g, '/'), direction: [f[0], f[1], f[2]], angles: [f[3], f[4], f[5]], size: f[7] });
  }
  return out;
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
