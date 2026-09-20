// A made-up system to fly in, written from a seed. Nothing in this file is the client's: every
// place, size, distance and count below is ours and the pack says so on each piece (the points
// carry `source: 'invented'`, the fields `invented: true`, the planets `source: 'invented'`).
//
// What it borrows from the archives is only what it is drawn with, all of it already understood by
// the other commands: one converted zone's sky (its skybox, star ramp, star sprites and lights,
// through sky.mjs's exportSky), the planet appearances (`appearance/*.pln`, read by space.mjs's
// parsePlanetAppearance for a surface shader and a radius) and the asteroid field style tables
// (scattered by space.mjs's scatterField, exactly as a real field is). So no number here came out
// of a table, and no table's number is copied into it.
//
// The pack it writes is an ordinary space pack: space.json at the same version, layout.json,
// manifest.json and sky.json, which is why the world, the map, the hyperspace catalogue and the
// galaxy map need nothing new to fly it.
//
// The one thing in it that no other zone has is planets with a real place: a `place: 'world'` body
// carries `at` (the GAME frame, mirrored here as the nebulae and fields are) and a true `radius` in
// metres, so the game can grow it as the ship closes on it instead of hanging it on the sky. A
// reader that does not know `place` still sees `direction` and `size` and draws it as a picture.
import { SPACE_BODY_FRAME, SPACE_PACK_VERSION, seeded } from './space.mjs';

/** The zone's id: a pack directory and a PLANETS entry, never a scene in the archives. */
export const SANDBOX_ZONE = 'space_sandbox';

/** The system's name, as the pack's title and the loading screen show it. */
export const SANDBOX_TITLE = 'Sandbox System';

/**
 * Every number the sandbox is made of, all of them ours and none of them read from anywhere. They
 * are here in one block so that changing the shape of the system is one edit and the conversion
 * says what it used. `--seed=<n>` on the command line overrides `seed` alone.
 *
 * `edge` is the owner's decision: 250 km from the middle in every direction, which is where the
 * cruise turns round. The physics engine works in single precision, and at 250 km a step is still
 * about 3 cm; much further out things shiver.
 */
export const SANDBOX_TUNE = {
  /** The seed the whole system is drawn from: the same seed always gives the same system. */
  seed: 20260919,
  /** How far the system reaches from its middle, in metres (the owner's 250 km). */
  edge: 250000,
  planets: {
    /** How many bodies, inclusive; the generator takes the first count it can place. */
    min: 4,
    max: 6,
    /** How far out a body may hang from the middle, in metres. */
    nearest: 40000,
    farthest: 200000,
    /** How big a body may be, in metres of true radius. */
    smallest: 3000,
    largest: 15000,
    /** Two bodies must stand at least this many times their radii apart, middle to middle. */
    apart: 2.5,
    /** No body's surface may come nearer the middle than this, which is where the fields and the jump points are. */
    clearOfMiddle: 35000,
    /** Tries before the generator gives up on one more body. */
    tries: 400,
  },
  points: {
    /** How many hyperspace points, and how far from the middle they ring it. */
    count: 3,
    ring: 9000,
    /** How far above and below the plane they may sit. */
    rise: 1200,
  },
  fields: {
    /** How many asteroid fields, how far out their middles sit, and how big and how full each is. */
    count: 3,
    /** Far enough out to leave the jump points clear, near enough to be inside the innermost body. */
    spread: [16000, 30000],
    radius: [900, 2600],
    asteroids: [70, 160],
  },
};

/**
 * The converted zones whose sky the sandbox may borrow, best first: one of them supplies the
 * skybox, the star field and the lights, which is also what gives the sandbox a sun to fly toward
 * and rays to see it through. `has` is the archives' test; null when none of them is there.
 */
export const SANDBOX_SKY_ZONES = ['space_tatooine', 'space_dantooine', 'space_corellia', 'space_naboo', 'space_yavin4', 'space_endor', 'space_heavy1'];

export function pickSkyZone(has, zones = SANDBOX_SKY_ZONES) {
  for (const z of zones) if (has(`terrain/${z}.trn`)) return z;
  return null;
}

/** A number in [lo, hi) from a generator. */
const between = (rng, lo, hi) => lo + (hi - lo) * rng();

/** A direction spread evenly over the sphere. */
function onSphere(rng) {
  const u = rng() * 2 - 1;
  const a = rng() * Math.PI * 2;
  const s = Math.sqrt(Math.max(0, 1 - u * u));
  return [s * Math.cos(a), u, s * Math.sin(a)];
}

const r2 = (x) => Math.round(x * 100) / 100;
const r4 = (x) => Math.round(x * 10000) / 10000;

/**
 * The system's bodies: a seeded set of spheres inside the edge, none of them overlapping another
 * and none of them near the middle. `looks` is what the archives gave, one entry per appearance:
 * `{ appearance, texture }`, the picture a body wears and the pack-relative image or null. The
 * appearance's own radius is not among them and is not wanted: a body's size here is ours, drawn
 * from the tuning below, and a picture is only a picture. Each body is given a look in turn, so a
 * run with one look makes one look's worth of planets.
 *
 * `at` is the GAME frame (X mirrored), `direction` the client frame, so both readings point the
 * same way; `size` is the apparent size in the game's own sky unit, worked out from the true radius
 * over the true distance, which is what a reader that ignores `place` draws.
 */
export function sandboxPlanets(seed, looks, tune = SANDBOX_TUNE) {
  const t = tune.planets;
  const rng = seeded(seed);
  const want = t.min + Math.floor(rng() * (t.max - t.min + 1));
  const out = [];
  for (let n = 0; n < want; n++) {
    let placed = null;
    for (let i = 0; i < t.tries && !placed; i++) {
      const dir = onSphere(rng);
      const distance = between(rng, t.nearest, t.farthest);
      const radius = between(rng, t.smallest, t.largest);
      if (distance - radius < t.clearOfMiddle) continue;
      if (distance + radius > tune.edge) continue;
      const at = [dir[0] * distance, dir[1] * distance, dir[2] * distance];
      const clash = out.some((p) => {
        const d = Math.hypot(p.at[0] - at[0], p.at[1] - at[1], p.at[2] - at[2]);
        return d < (p.radius + radius) * t.apart;
      });
      if (clash) continue;
      placed = { at, radius, distance };
    }
    if (!placed) break;
    const look = looks.length ? looks[out.length % looks.length] : null;
    const size = (placed.radius / placed.distance) * (SPACE_BODY_FRAME.distance / SPACE_BODY_FRAME.radius);
    out.push({
      appearance: look?.appearance ?? null,
      // The client frame, so a reader that hangs this body on the sky points it the same way the
      // game's own bodies are pointed (world.ts mirrors X when it reads `direction`).
      direction: [placed.at[0] === 0 ? 0 : -placed.at[0], placed.at[1], placed.at[2]].map(r2),
      distance: r2(placed.distance),
      radius: Math.round(placed.radius),
      size: r4(size),
      sizeFrom: 'invented',
      angles: [0, 0, 0],
      halo: null,
      texture: look?.texture ?? null,
      // What the game needs to fly to it: the GAME frame, already mirrored, and a true radius.
      place: 'world',
      at: placed.at.map((v) => Math.round(v)),
      source: 'invented',
    });
  }
  return out;
}

/**
 * The points a ship arrives at: a ring round the middle, evenly spaced with a seeded nudge, each
 * one clear of the planets by construction (they are all `clearOfMiddle` out). The client frame,
 * as every pack's points are.
 */
export function sandboxPoints(seed, tune = SANDBOX_TUNE) {
  const t = tune.points;
  const rng = seeded(seed ^ 0x5a5a);
  const names = ['Sandbox: the near mark', 'Sandbox: the far mark', 'Sandbox: the high mark', 'Sandbox: the low mark', 'Sandbox: the outer mark'];
  const out = [];
  for (let i = 0; i < t.count; i++) {
    const a = (i / t.count) * Math.PI * 2 + (rng() - 0.5) * 0.4;
    const r = t.ring * between(rng, 0.85, 1.15);
    out.push({
      id: `${SANDBOX_ZONE}_${i}`,
      name: names[i % names.length],
      description: 'A jump point in a system of our own: nothing here is from the game.',
      x: Math.round(Math.cos(a) * r),
      y: Math.round((rng() - 0.5) * 2 * t.rise),
      z: Math.round(Math.sin(a) * r),
      source: 'invented',
      clearance: null,
    });
  }
  return out;
}

/**
 * Asteroid fields, as rows in the client's own field-table columns so that `scatterField` fills
 * them exactly as it fills a real one. `styleTables` is the list of style tables the archives have;
 * each field takes one in turn. The rows are ours, the style tables the client's.
 */
export function sandboxFieldRows(seed, styleTables, tune = SANDBOX_TUNE) {
  const t = tune.fields;
  const rng = seeded(seed ^ 0x3c3c);
  const rows = [];
  if (!styleTables.length) return rows;
  for (let i = 0; i < t.count; i++) {
    const dir = onSphere(rng);
    const d = between(rng, t.spread[0], t.spread[1]);
    rows.push({
      Name: `Sandbox field ${i + 1} (invented)`,
      Type: 1,
      SplineControlPoints: '',
      CenterLocationX: Math.round(dir[0] * d),
      CenterLocationY: Math.round(dir[1] * d),
      CenterLocationZ: Math.round(dir[2] * d),
      Radius: Math.round(between(rng, t.radius[0], t.radius[1])),
      NumAsteroids: Math.round(between(rng, t.asteroids[0], t.asteroids[1])),
      RandomSeed: (seed + i * 7919) >>> 0,
      ScaleMin: 1,
      ScaleMax: 1,
      FieldStyleTable: styleTables[i % styleTables.length],
    });
  }
  return rows;
}

/** Where a ship coming out of hyperspace into the system appears: its first point. */
export function sandboxArrival(points) {
  const p = points[0];
  return p ? { x: p.x, y: p.y, z: p.z, kind: 'point', point: p.id } : { x: 0, y: 0, z: 0, kind: 'point' };
}

/**
 * The whole space.json for the sandbox. `hyperspace` is given by the caller, which is the only
 * piece that needs the archives (the jump scene and the warp effects are the same for every zone).
 */
export function sandboxPack({ planets, points, fields, hyperspace, skyZone, seed, tune = SANDBOX_TUNE }) {
  return {
    version: SPACE_PACK_VERSION,
    zone: SANDBOX_ZONE,
    planet: null,
    title: SANDBOX_TITLE,
    // Made up entirely: the seed it was drawn from, how far it reaches, and whose sky it borrows.
    sandbox: { source: 'invented', seed, edge: tune.edge, skyFrom: skyZone },
    stations: [],
    scenery: [],
    planets,
    arrival: sandboxArrival(points),
    hyperspace: { ...hyperspace, points },
    nebulae: [],
    nebulaLook: null,
    lightning: null,
    fields,
    lanes: {},
    dockEffects: {},
  };
}

/** The `status` line for the sandbox pack, and whether the command should be run (again). */
export function sandboxStatus(pack) {
  if (!pack || pack.zone !== SANDBOX_ZONE) return { line: `${SANDBOX_ZONE}: not converted (a made-up system to fly in)`, stale: true };
  if ((pack.version ?? 0) < SPACE_PACK_VERSION) return { line: `${SANDBOX_ZONE}: older than version ${SPACE_PACK_VERSION}`, stale: true };
  const worlds = (pack.planets ?? []).filter((p) => p.place === 'world').length;
  const edge = Math.round((pack.sandbox?.edge ?? SANDBOX_TUNE.edge) / 1000);
  return { line: `${SANDBOX_ZONE}: ${worlds} planets, ${(pack.fields ?? []).length} fields, ${(pack.hyperspace?.points ?? []).length} jump points, ${edge} km across (all invented)`, stale: false };
}

/**
 * Build the whole pack. Everything that needs the archives comes in as a callback, so this module
 * holds the shape of the system and the command holds the reading and the writing:
 *
 *   has(path)                      whether the archives have a file
 *   planetLooks()                  [{ appearance, texture }], the pictures the bodies may wear
 *   styleTables()                  the asteroid field style tables to scatter from
 *   scatter(row, styleRows)        space.mjs's scatterField
 *   styleRows(path)                a style table's rows, or []
 *   convert(template)              { model, radius } or { skip }, the command's own converter
 *   models()                       the manifest entries the converts made
 *   hyperspace()                   the jump block every zone shares (scene, effects, messages, frameCheck)
 *   sky(zone, outDir)              exportSky for the borrowed zone
 *   write(relative, text)          write a file under the pack
 *   log(line)
 */
export function buildSandbox(host) {
  const tune = host.tune ?? SANDBOX_TUNE;
  const seed = (host.seed ?? tune.seed) >>> 0;
  const skyZone = host.skyZone ?? null;
  const looks = host.planetLooks();
  const planets = sandboxPlanets(seed, looks, tune);
  const points = sandboxPoints(seed, tune);
  const styleTables = host.styleTables();
  const rows = sandboxFieldRows(seed, styleTables, tune);
  const objects = [];
  const fields = [];
  let asteroids = 0;
  for (const row of rows) {
    const styles = host.styleRows(row.FieldStyleTable);
    let kept = 0;
    for (const a of host.scatter(row, styles)) {
      const r = host.convert(a.template);
      if (r.skip) continue;
      objects.push({ template: a.template, model: r.model, x: a.x, y: a.y, z: a.z, q: a.q, radius: r.radius });
      kept++;
    }
    asteroids += kept;
    fields.push({
      name: row.Name,
      kind: 'sphere',
      at: [row.CenterLocationX === 0 ? 0 : -row.CenterLocationX, row.CenterLocationY, row.CenterLocationZ],
      radius: row.Radius,
      spline: [],
      count: row.NumAsteroids,
      sound: null,
      viewFrom: null,
      viewAll: null,
      flattenDepth: 0,
      faceTowards: null,
      invented: true,
    });
    host.log(`  ${row.Name}: ${kept} of ${row.NumAsteroids} asteroids, radius ${row.Radius} m at ${row.CenterLocationX}, ${row.CenterLocationY}, ${row.CenterLocationZ}`);
  }
  for (const p of planets) host.log(`  planet ${p.appearance ? p.appearance.replace(/^.*\//, '') : 'no appearance'}: radius ${p.radius} m at ${p.at.join(', ')}, ${(p.distance / 1000).toFixed(1)} km out${p.texture ? '' : ', no surface texture'}`);
  for (const p of points) host.log(`  jump point ${p.id}: ${p.x}, ${p.y}, ${p.z} (invented)`);
  const pack = sandboxPack({ planets, points, fields, hyperspace: host.hyperspace(), skyZone, seed, tune });
  host.write('space.json', JSON.stringify(pack, null, 2));
  host.write('manifest.json', JSON.stringify({ planet: SANDBOX_ZONE, categories: { layout: host.models().filter((m) => !m.failed) } }, null, 2));
  host.write('layout.json', JSON.stringify({ planet: SANDBOX_ZONE, center: { x: 0, z: 0 }, radius: null, objects, skipped: [] }));
  if (skyZone) host.sky(skyZone);
  return { pack, objects, asteroids, planets, points, fields, skyZone, seed };
}
