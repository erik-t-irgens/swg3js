// The made-up system and the ultra cruise, checked without a browser: that the generator draws the
// same system from the same seed and keeps every body inside the system and clear of its middle and
// of each other; that a body which stands somewhere is drawn covering exactly the angle it truly
// covers and hides what is behind it; that the run stops itself short of a planet and at the edge,
// ramps up and down at the rates it says, holds the streamer for its whole length and frees it
// again; and that the blur's reprojection, carried by the run's own step, leaves a still world
// still.
//
// Every number here is made up for the test. Nothing is read from the owner's archives or packs.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  SANDBOX_TUNE,
  SANDBOX_ZONE,
  buildSandbox,
  pickSkyZone,
  sandboxFieldRows,
  sandboxPack,
  sandboxPlanets,
  sandboxPoints,
  sandboxStatus,
} from '../sandbox.mjs';
import { SPACE_SKY_TUNE, skyDistanceFor, standingBodyDepth, standingBodyMaxDepth, standingBodyPlace, tuneSpaceSky, type StandingBodyPlace } from '../../../src/space/suns.ts';
import {
  CRUISE_TUNE,
  Cruise,
  brakingDistance,
  cruiseStops,
  stepCruiseSpeed,
  stopAhead,
  type CruiseHull,
  type CruiseStop,
} from '../../../src/space/cruise.ts';
import { reprojectionCarry, setReprojectionCarry } from '../../../src/core/fx/velocityMath.ts';
import type { SpacePack } from '../../../src/space/spaceData.ts';
import type { EffectHandle } from '../../../src/world/particles';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// --- 1. the system the converter draws -----------------------------------------------------------

const SEED = 4242;
const looks = [
  { appearance: 'appearance/made_up_a.pln', texture: 'space/made_up_a.png' },
  { appearance: 'appearance/made_up_b.pln', texture: null },
];

{
  const a = sandboxPlanets(SEED, looks);
  const b = sandboxPlanets(SEED, looks);
  ok(a.length >= SANDBOX_TUNE.planets.min, `the seed gives at least ${SANDBOX_TUNE.planets.min} bodies (${a.length})`);
  let most = 0;
  for (let s = 1; s <= 200; s++) most = Math.max(most, sandboxPlanets(s, looks).length);
  ok(most <= SANDBOX_TUNE.planets.max, `and no seed of two hundred draws more than the ${SANDBOX_TUNE.planets.max} it asks for (most was ${most})`);
  ok(JSON.stringify(a) === JSON.stringify(b), 'the same seed draws the same system, body for body');
  ok(JSON.stringify(sandboxPlanets(SEED + 1, looks)) !== JSON.stringify(a), 'another seed draws another one');

  let inside = true;
  let clear = true;
  for (const p of a) {
    const d = Math.hypot(p.at[0], p.at[1], p.at[2]);
    if (d + p.radius > SANDBOX_TUNE.edge) inside = false;
    if (d - p.radius < SANDBOX_TUNE.planets.clearOfMiddle) clear = false;
  }
  ok(inside, `every body, with its own radius, stands inside the ${SANDBOX_TUNE.edge / 1000} km the system reaches`);
  ok(clear, 'and none of them reaches in over the middle, where ships arrive');

  let apart = true;
  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      const d = Math.hypot(a[i].at[0] - a[j].at[0], a[i].at[1] - a[j].at[1], a[i].at[2] - a[j].at[2]);
      if (d < (a[i].radius + a[j].radius) * SANDBOX_TUNE.planets.apart) apart = false;
    }
  }
  ok(apart, 'no two bodies stand within each other, however many are drawn');

  ok(a.every((p) => p.place === 'world' && p.source === 'invented'), 'every body says it stands somewhere and that it is made up');
  ok(
    a.every((p) => near(p.direction[0], p.at[0] === 0 ? 0 : -p.at[0], 1) && near(p.direction[2], p.at[2], 1)),
    'a body points the same way whichever of its two frames is read',
  );
  ok(a.every((p) => near(p.size, (p.radius / p.distance) * (2600 / 240), 0.001)), 'the size a reader that ignores the place draws is the true angle');
  ok(a.some((p) => p.texture === looks[0].texture), 'the bodies wear the looks the archives gave, in turn');
}

{
  const pts = sandboxPoints(SEED);
  ok(pts.length === SANDBOX_TUNE.points.count, `${pts.length} jump points, as many as the system asks for`);
  ok(pts.every((p) => p.source === 'invented'), 'every one of them says it is made up');
  ok(new Set(pts.map((p) => p.id)).size === pts.length, 'their ids are their own');
  const rings = pts.map((p) => Math.hypot(p.x, p.z));
  ok(rings.every((r) => r > SANDBOX_TUNE.points.ring * 0.8 && r < SANDBOX_TUNE.points.ring * 1.2), 'they ring the middle at about the distance asked for');
  ok(rings.every((r) => r < SANDBOX_TUNE.planets.clearOfMiddle), 'and all of them stand inside the space kept clear of the bodies');
}

{
  const tables = ['datatables/made/up/one.iff', 'datatables/made/up/two.iff'];
  const rows = sandboxFieldRows(SEED, tables);
  ok(rows.length === SANDBOX_TUNE.fields.count, `${rows.length} fields`);
  ok(rows.every((r) => 'CenterLocationX' in r && 'NumAsteroids' in r && 'FieldStyleTable' in r), "the rows carry the field table's own columns, so the real scatterer fills them");
  ok(rows[0].FieldStyleTable === tables[0] && rows[1].FieldStyleTable === tables[1], 'the style tables are taken in turn');
  ok(sandboxFieldRows(SEED, []).length === 0, 'with no style tables there are no fields');
  ok(rows.every((r) => Math.hypot(r.CenterLocationX, r.CenterLocationY, r.CenterLocationZ) + r.Radius < SANDBOX_TUNE.edge), 'every field stands inside the system');
  // The three rings must not run into each other: the points inside, the fields round them, the bodies outside.
  const nearest = Math.min(...rows.map((r) => Math.hypot(r.CenterLocationX, r.CenterLocationY, r.CenterLocationZ) - r.Radius));
  const farthest = Math.max(...rows.map((r) => Math.hypot(r.CenterLocationX, r.CenterLocationY, r.CenterLocationZ) + r.Radius));
  ok(nearest > SANDBOX_TUNE.points.ring * 1.15, 'no field reaches in over the jump points');
  ok(farthest < SANDBOX_TUNE.planets.clearOfMiddle, 'and none of them reaches out to where a body may stand');
}

// --- 2. the whole pack, through a host that reads nothing ------------------------------------------

const written = new Map<string, string>();
{
  const host = {
    seed: SEED,
    skyZone: 'space_made_up',
    planetLooks: () => looks,
    styleTables: () => ['datatables/made/up/one.iff'],
    styleRows: () => [{ SharedTemplate: 'object/made/up/rock.iff', Likelihood: 1 }],
    // A scatterer of our own: three rocks a field, which is all the pack's shape needs.
    scatter: (row: { CenterLocationX: number; CenterLocationY: number; CenterLocationZ: number }) =>
      [0, 1, 2].map((i) => ({ template: 'object/made/up/rock.iff', x: row.CenterLocationX + i, y: row.CenterLocationY, z: row.CenterLocationZ, q: [1, 0, 0, 0] })),
    convert: () => ({ model: 'rock', radius: 12 }),
    models: () => [{ id: 'rock', file: 'rock.glb', bounds: { min: [-12, -12, -12], max: [12, 12, 12] }, triangles: 40 }],
    hyperspace: () => ({ scene: null, effects: { enter: null, exit: null, timing: null }, messages: { alreadyAtPoint: null }, frameCheck: { checked: 0, sameCloser: 0, mirroredCloser: 0, meanErrorSame: 0, meanErrorMirrored: 0 } }),
    sky: () => written.set('sky.json', '{}'),
    write: (rel: string, text: string) => written.set(rel, text),
    log: () => {},
  };
  const built = buildSandbox(host);
  ok(written.has('space.json') && written.has('layout.json') && written.has('manifest.json'), 'the pack is an ordinary space pack: space.json, layout.json and manifest.json');
  ok(written.has('sky.json'), "and it borrows a converted zone's sky");
  const pack = JSON.parse(written.get('space.json')!) as SpacePack;
  ok(pack.zone === SANDBOX_ZONE && pack.planet === null, 'the zone is its own and has no planet under it');
  ok(pack.sandbox?.source === 'invented' && pack.sandbox.edge === SANDBOX_TUNE.edge, 'the pack says outright that it is made up, and how far it reaches');
  ok(pack.sandbox?.skyFrom === 'space_made_up', 'and whose sky it borrowed');
  ok(pack.stations.length === 0 && (pack.nebulae ?? []).length === 0, 'it has no stations and no nebulae');
  ok(pack.arrival?.kind === 'point' && pack.arrival.point === pack.hyperspace!.points[0].id, 'a ship arrives at its first jump point');
  ok(built.objects.length === built.fields.length * 3, 'every field put its rocks into the layout');
  ok((pack.fields ?? []).every((f) => f.invented), 'every field says it is made up');
  const row = sandboxFieldRows(SEED, ['datatables/made/up/one.iff'])[0];
  ok(pack.fields![0].at[0] === (row.CenterLocationX === 0 ? 0 : -row.CenterLocationX) && pack.fields![0].at[2] === row.CenterLocationZ, "a field's shape is mirrored once, into the frame the map draws it in, while its rocks keep the layout's own");
}

{
  ok(sandboxStatus(null).stale, 'status asks for the sandbox when there is no pack');
  const pack = JSON.parse(written.get('space.json')!) as SpacePack;
  const line = sandboxStatus(pack);
  ok(!line.stale, 'and stops asking once it is there');
  ok(line.line.includes('invented'), 'the line says the whole system is made up');
  ok(pickSkyZone((p: string) => p === 'terrain/space_b.trn', ['space_a', 'space_b']) === 'space_b', 'the sky is borrowed from the first zone the archives actually have');
  ok(pickSkyZone(() => false, ['space_a']) === null, 'and from none when they have none');
}

// --- 3. a body that stands somewhere -------------------------------------------------------------

{
  const out: StandingBodyPlace = { drawnAt: 0, scale: 1, tan: 0, depthScale: 1 };
  const pull = 2600;
  for (const [radius, distance] of [
    [15000, 200000],
    [15000, 17000],
    [3000, 40000],
    [800, 2000],
  ]) {
    const p = standingBodyPlace(radius, distance, pull, 40, out);
    const drawnRadius = radius * p.scale;
    ok(near(drawnRadius / p.drawnAt, radius / distance, 1e-9), `a body ${radius} m across ${Math.round(distance / 1000)} km out covers exactly the angle it truly covers`);
    ok(p.drawnAt <= pull + 1e-9, 'and is never drawn further out than the sky itself reaches');
    ok(near(p.depthScale * p.drawnAt, distance, 1e-6), 'what the shader finds on the drawn sphere scales back to the true distance');
  }
  // One record is filled again and again, so nothing is allocated per frame: the test keeps copies.
  const farTan = standingBodyPlace(3000, 40000, pull, 40, out).tan;
  const closeTan = standingBodyPlace(3000, 8000, pull, 40, out).tan;
  ok(closeTan > farTan, 'closing on a body widens the quad that writes its depth');
  ok(standingBodyPlace(3000, 3000.1, pull, 40, out).tan === 40, 'and against the surface the quad is held at its cap rather than running away');
}

{
  const maxDepth = 8280;
  const radius = 3000;
  const distance = 8000;
  const front = standingBodyDepth(radius, distance, 0, maxDepth)!;
  ok(near(front, distance - radius, 1e-6), 'the depth written straight at a body is the depth of its near surface');
  ok(standingBodyDepth(radius, distance, Math.asin(radius / distance) * 1.05, maxDepth) === null, 'a ray past its edge writes nothing at all');
  const rim = standingBodyDepth(radius, distance, Math.asin(radius / distance) * 0.999, maxDepth)!;
  ok(rim > front && rim < distance, 'and a ray near its edge writes a deeper point of the same surface');
  ok(standingBodyDepth(radius, 200000, 0, maxDepth) === maxDepth, 'a body far beyond the far plane writes the furthest depth there is, and no further');
  // What the whole thing is for: what is behind it is hidden, what is in front of it is not.
  ok(front < distance + radius, 'a ship parked beyond the body is deeper than the depth written, so it is hidden');
  ok(front > distance - radius - 1, 'and one parked in front of it is nearer, so it draws over');
}

{
  // The fragment program itself, step for step, on the numbers the placement actually hands it: the
  // sphere it traces stands where the PICTURE is drawn, with the picture's radius, and the ray comes
  // off a quad hung a few metres from the camera. This is the check the placement's own maths cannot
  // make, because the two disagreed for a while and both were self-consistent.
  const out: StandingBodyPlace = { drawnAt: 0, scale: 1, tan: 0, depthScale: 1 };
  const pull = 2600;
  /** What the shader works out for a ray `angle` off the body's own direction; null where it discards. */
  const shaderDepth = (radius: number, distance: number, angle: number, maxDepth: number): number | null => {
    const p = standingBodyPlace(radius, distance, pull, SPACE_SKY_TUNE.quadTan, out);
    // The drawn sphere's middle in view space, as the frame's matrices give it: straight ahead at
    // the drawn distance, with the drawn radius. The ray is the pixel's, `angle` off that direction.
    const centre = { x: 0, y: 0, z: -p.drawnAt };
    const drawnRadius = radius * p.scale;
    const ray = { x: Math.sin(angle), y: 0, z: -Math.cos(angle) };
    const b = ray.x * centre.x + ray.y * centre.y + ray.z * centre.z;
    const c = centre.x * centre.x + centre.y * centre.y + centre.z * centre.z - drawnRadius * drawnRadius;
    const disc = b * b - c;
    if (disc < 0) return null;
    const root = Math.sqrt(disc);
    let t = b - root;
    if (t < 0) t = b + root;
    if (t < 0) return null;
    return Math.min(maxDepth, Math.max(0.1, -(ray.z * t) * p.depthScale));
  };
  const maxDepth = standingBodyMaxDepth(9000);
  for (const [radius, distance] of [
    [5000, 7000],
    [5000, 10000],
    [5000, 50000],
    [3000, 5000],
    [3000, 40000],
    [12000, 200000],
  ]) {
    const half = Math.asin(radius / distance);
    for (const share of [0, 0.5, 0.95]) {
      const a = half * share;
      const shader = shaderDepth(radius, distance, a, maxDepth);
      const want = standingBodyDepth(radius, distance, a, maxDepth);
      ok(shader !== null && want !== null && near(shader, want, Math.max(0.5, want * 1e-6)), `the shader writes the true surface depth for a ${radius} m body ${Math.round(distance / 1000)} km out (${Math.round(shader ?? -1)} m, ${Math.round(share * 100)}% of the way to its edge)`);
    }
    ok(shaderDepth(radius, distance, half * 1.02, maxDepth) === null, 'and a ray past its edge is thrown away, so the limb is the body and not the quad');
    // Which is only possible while the camera stands outside the sphere the shader traces.
    const p = standingBodyPlace(radius, distance, pull, SPACE_SKY_TUNE.quadTan, out);
    ok(p.drawnAt > radius * p.scale, 'the camera is outside the sphere it traces, which is what lets a ray miss at all');
    // And the quad must be wide enough to carry the whole disc: its own half-angle over the body's.
    ok(Math.atan(p.tan * SPACE_SKY_TUNE.quadMargin) >= half - 1e-9, 'and the quad is a little wider than the disc it has to cover');
  }
  // The god rays count a pixel as sky at or past `skyDistanceFor`, so a body clamped exactly there
  // would read as open sky on the rounding. It is clamped under it, by the margin the sky's own
  // stand-ins keep.
  ok(maxDepth < skyDistanceFor(true, 9000, 0), 'the deepest a body may write is inside the depth at which a pixel counts as sky');
  ok(maxDepth === SPACE_SKY_TUNE.standInDistance, 'and it is the distance the sky bodies already stand at, which was chosen clear of it');
  ok(standingBodyMaxDepth(2000) < 2000, 'and it never reaches a far plane pulled in behind it');
}

{
  // The quad's three numbers are ours and live; the knob holds each one where it cannot break.
  const was = { quadAt: SPACE_SKY_TUNE.quadAt, quadTan: SPACE_SKY_TUNE.quadTan, quadMargin: SPACE_SKY_TUNE.quadMargin };
  tuneSpaceSky({ quadAt: 35, quadTan: 60, quadMargin: 1.2 });
  ok(SPACE_SKY_TUNE.quadAt === 35 && SPACE_SKY_TUNE.quadTan === 60 && SPACE_SKY_TUNE.quadMargin === 1.2, 'the depth quad can be moved, widened and given more margin live');
  tuneSpaceSky({ quadMargin: 0.2 });
  ok(SPACE_SKY_TUNE.quadMargin === 1, 'and a margin under the disc itself is held at the disc');
  tuneSpaceSky(was);
}

// --- 4. the run's maths --------------------------------------------------------------------------

{
  ok(near(brakingDistance(10000, 2), 10000, 1e-6), 'a run at 10 km/s needs ten kilometres to stop in two seconds');
  ok(brakingDistance(0, 2) === 0, 'and a stopped one needs none');
  let s = 0;
  for (let i = 0; i < 300; i++) s = stepCruiseSpeed(s, CRUISE_TUNE.top, 0.01);
  ok(near(s, CRUISE_TUNE.top, 1), `the speed reaches the top in the ${CRUISE_TUNE.spinUp} seconds it says`);
  for (let i = 0; i < 200; i++) s = stepCruiseSpeed(s, 0, 0.01);
  ok(s === 0, `and comes back down in the ${CRUISE_TUNE.brake} it says`);
}

{
  const stops: CruiseStop[] = [{ x: 0, y: 0, z: -50000, r: 5000 }];
  const from = { x: 0, y: 0, z: 0 };
  const ahead = { x: 0, y: 0, z: -1 };
  ok(near(stopAhead(from, ahead, stops, 250000), 45000, 1), 'the run stops where the stand-off sphere begins, not at the middle of the body');
  ok(stopAhead(from, { x: 0, y: 0, z: 1 }, stops, 250000) === 250000, 'flying away from it, the only thing ahead is the edge of the system');
  ok(stopAhead(from, { x: 1, y: 0, z: 0 }, stops, 250000) === 250000, 'and a body off to one side is not in the way at all');
  ok(stopAhead({ x: 0, y: 0, z: -48000 }, ahead, stops, 250000) === 0, 'already inside a stand-off, there is nowhere left to go that way');
  ok(stopAhead({ x: 0, y: 0, z: -260000 }, ahead, stops, 250000) === 0, 'and outside the edge, the same');
  ok(stopAhead(from, ahead, [], 0) === Infinity, 'with nothing in the way and no edge, nothing stops it');
}

{
  const pack = {
    planets: [
      { appearance: 'a', direction: [0, 0, 0], size: 1, texture: null, place: 'world', at: [1000, 0, 0], radius: 500 },
      { appearance: 'b', direction: [0, 0, 0], size: 1, texture: null },
    ],
  } as unknown as SpacePack;
  const out: CruiseStop[] = [];
  cruiseStops(pack, out, 2000);
  ok(out.length === 1, 'only the bodies that stand somewhere are things to stop short of');
  ok(out[0].r === 2500, 'and each one is its own radius plus the stand-off');
  cruiseStops(null, out, 2000);
  ok(out.length === 0, 'a zone with no pack has nothing to stop short of');
}

// --- 5. the run itself, against a hull that is not a ship ----------------------------------------

class FakeHull implements CruiseHull {
  readonly group = new THREE.Object3D();
  readonly pos = new THREE.Vector3();
  destroyed = false;
  holding = false;
  cruise = 120;
  jumpCruise: number | null = null;
  ghost = false;
  holds = 0;
  released = 0;
  private readonly turn = new THREE.Quaternion();
  constructor(facing: THREE.Vector3) {
    this.turn.setFromUnitVectors(new THREE.Vector3(0, 0, -1), facing.clone().normalize());
  }
  hold(_frame: THREE.Matrix4 | null, pos: THREE.Vector3, _quat: THREE.Quaternion): void {
    this.holding = true;
    this.holds++;
    this.pos.copy(pos);
  }
  release(): void {
    this.holding = false;
    this.released++;
  }
  setGhost(on: boolean): void {
    this.ghost = on;
  }
  quaternion(out: THREE.Quaternion): THREE.Quaternion {
    return out.copy(this.turn);
  }
}

function makeRun(planetAt: [number, number, number] | null, facing = new THREE.Vector3(0, 0, -1)) {
  const hull = new FakeHull(facing);
  const state = { held: false, holdsSeen: 0, ready: 0, zone: 'space_made_up', jumping: false, jumpHasHull: false, alive: true, placed: 0, removed: 0, programs: 0, buildOnSettle: 0 };
  const pack = {
    sandbox: { source: 'invented', seed: 1, edge: CRUISE_TUNE.edge, skyFrom: null },
    planets: planetAt ? [{ appearance: 'a', direction: [0, 0, 0], size: 1, texture: null, place: 'world', at: planetAt, radius: 5000 }] : [],
  } as unknown as SpacePack;
  const cruise = new Cruise({
    zone: () => state.zone,
    packHere: () => pack,
    ship: () => (state.alive ? hull : null),
    alive: () => state.alive,
    jumping: () => state.jumping,
    jumpHasHull: () => state.jumpHasHull,
    holdStream: (on) => {
      state.held = on;
      if (on) state.holdsSeen++;
    },
    readyAround: async () => {
      state.ready++;
      // What the stopping point needs is built here, which is where a real settle builds it.
      state.programs += state.buildOnSettle;
      return true;
    },
    effects: () => ({ enter: 'streaks.prt', exit: null }),
    placeEffect: () => {
      state.placed++;
      return { placed: state.placed } as unknown as EffectHandle;
    },
    removeEffect: () => {
      state.removed++;
    },
    programs: () => state.programs,
  });
  return { hull, state, cruise };
}

/** Run the clock at a fixed step, letting anything the run awaited land between frames. */
async function advance(cruise: Cruise, seconds: number, dt = 1 / 60): Promise<void> {
  for (let t = 0; t < seconds; t += dt) {
    cruise.update(dt);
    await Promise.resolve();
  }
}

{
  const { hull, state, cruise } = makeRun([0, 0, -60000]);
  ok(cruise.why() === null, 'a pilot in a made-up system may start a run');
  cruise.toggle();
  ok(cruise.phase === 'countdown', 'the key starts the countdown');
  ok(!hull.ghost && !hull.holding, 'and the ship flies itself until the countdown is out');
  await advance(cruise, CRUISE_TUNE.countdown + 0.05);
  ok(cruise.phase === 'running', 'then the run begins');
  ok(hull.ghost && hull.holding, 'the hull is held and ghosted: nothing can hit it and nothing it passes can hurt it');
  ok(state.held, 'and the streamer is held for the length of the run');
  await advance(cruise, CRUISE_TUNE.spinUp + 0.1);
  ok(near(cruise.speed, CRUISE_TUNE.top, CRUISE_TUNE.top * 0.02), `it reaches ${CRUISE_TUNE.top} m/s`);
  const along = -hull.pos.z;
  ok(along > 10000, `and it has gone somewhere (${Math.round(along / 1000)} km)`);
  ok(near(hull.pos.x, 0, 1e-6) && near(hull.pos.y, 0, 1e-6), 'straight along the nose it had when it began, and nowhere else');
  await advance(cruise, 20);
  ok(cruise.phase === 'off', 'the run stops itself');
  const gap = 60000 - -hull.pos.z;
  const want = 5000 + CRUISE_TUNE.standOff;
  // It brakes on the last frame it still could, so it stops at the stand-off or up to one frame's
  // travel outside it, and never inside it.
  ok(gap >= want - 1 && gap <= want + 400, `and it stops at least ${CRUISE_TUNE.standOff} m short of the planet's surface (${Math.round(gap)} m from its middle, against ${want})`);
  ok(!hull.ghost && !hull.holding, 'the ship is handed back, solid and flying itself');
  ok(!state.held, 'the streamer runs again');
  ok(state.ready === 1, 'and what stands round the stopping point was asked for before the hand-back');
}

{
  const { hull, cruise } = makeRun(null, new THREE.Vector3(1, 0, 0));
  cruise.toggle();
  await advance(cruise, CRUISE_TUNE.countdown + 60);
  ok(cruise.phase === 'off', 'with nothing in the way the run ends at the edge of the system');
  ok(near(hull.pos.x, CRUISE_TUNE.edge, 200), `${Math.round(hull.pos.x / 1000)} km out, which is the edge`);
  ok(hull.pos.x <= CRUISE_TUNE.edge + 1, 'and never past it');
}

{
  const { hull, state, cruise } = makeRun(null);
  cruise.toggle();
  await advance(cruise, CRUISE_TUNE.countdown + 1);
  const wasAt = hull.pos.z;
  cruise.toggle();
  ok(cruise.phase === 'braking', 'the same key lets go of a run');
  await advance(cruise, CRUISE_TUNE.brake + CRUISE_TUNE.settleWait + 1);
  ok(cruise.phase === 'off' && !hull.holding, 'and it brakes to a stop and hands the ship back');
  ok(hull.pos.z < wasAt, 'having gone a little further while it braked');
  ok(!state.held, 'the streamer is free again');
}

{
  const { hull, state, cruise } = makeRun(null);
  cruise.toggle();
  await advance(cruise, CRUISE_TUNE.countdown + 0.5);
  state.jumping = true;
  cruise.update(1 / 60);
  ok(cruise.phase === 'off' && !hull.holding && !hull.ghost, 'a jump taking the ship ends the run at once and gives it back');
  ok(!state.held, 'and frees the streamer');
}

{
  const { hull, state, cruise } = makeRun(null);
  cruise.toggle();
  await advance(cruise, CRUISE_TUNE.countdown + 0.5);
  cruise.update(1 / 60);
  // A travel under a run: the zone is another one and the run must not fly in it.
  state.zone = 'somewhere_else';
  cruise.update(1 / 60);
  ok(cruise.phase === 'off' && !hull.holding, 'a travel under a run ends it rather than flying on in the next world');
}

{
  const { cruise } = makeRun(null);
  const row = cruise.available();
  ok(row.label === 'Ultra cruise' && row.why === null, 'the ship menu offers the run where it may be run');
  cruise.toggle();
  ok(cruise.available().label === 'Let go', 'and offers to let go once it is running');
  cruise.abort();
  ok(cruise.phase === 'off', 'anything that must stop it, stops it');
  const d = cruise.describe();
  ok(d.phase === 'off' && typeof d.tune === 'object', 'the debug report says the state and every number the run is made of');
  ok(Array.isArray(d.carry) && (d.carry as number[]).length === 3, "and the carry it reports is the blur's three numbers, not the speed again");
}

{
  // The streaks end themselves after a few seconds and a run lasts far longer, so they are laid on
  // again while the speed holds, and not once the brake has begun.
  const { state, cruise } = makeRun(null);
  cruise.toggle();
  ok(state.placed === 1, 'the countdown lays the streaks on once');
  await advance(cruise, CRUISE_TUNE.countdown + CRUISE_TUNE.fxRepeat * 3 + 0.2);
  ok(state.placed >= 4, `and the run lays them on again about every ${CRUISE_TUNE.fxRepeat} s (${state.placed} times in ${Math.round(CRUISE_TUNE.fxRepeat * 3)} s of speed)`);
  const atBrake = state.placed;
  cruise.toggle();
  await advance(cruise, CRUISE_TUNE.brake + CRUISE_TUNE.settleWait + 1);
  ok(state.placed === atBrake, 'once it is braking no more are laid on');
  ok(state.removed >= 1, 'and the last one is taken away when the ship is handed back');
}

{
  // The two halves of the count: nothing may be built while the ship is moving, and what the
  // stopping point needs is built afterwards, with the ship already still.
  const { state, cruise } = makeRun(null);
  state.buildOnSettle = 7;
  cruise.toggle();
  await advance(cruise, CRUISE_TUNE.countdown + 1);
  cruise.toggle();
  await advance(cruise, CRUISE_TUNE.brake + CRUISE_TUNE.settleWait + 1);
  const d = cruise.describe();
  ok(d.programsWhileFast === 0, 'nothing was built while the ship was moving');
  ok(d.programsWhileSettling === 7, 'and what the stopping point needed is counted apart');
  cruise.toggle();
  cruise.abort();
  const after = cruise.describe();
  ok(after.programsWhileFast === 0 && after.programsWhileSettling === 0, "and a run called off before the speed leaves last run's figures behind rather than reporting them again");
}

{
  // A jump that has actually taken the hull owns the hold and the ghost; one merely counting down
  // has not, and would not release the hull if it were called off, so there the run hands it back.
  const { hull, state, cruise } = makeRun(null);
  cruise.toggle();
  await advance(cruise, CRUISE_TUNE.countdown + 0.5);
  state.jumping = true;
  state.jumpHasHull = true;
  cruise.update(1 / 60);
  ok(cruise.phase === 'off', 'a jump that has the ship ends the run');
  ok(hull.ghost && hull.holding, 'and the run leaves the hold and the ghost to it rather than stripping them off a hull in a tunnel');
  ok(!state.held, 'the streamer is freed all the same');
}

// --- 6. the blur's reprojection, carried by the run's step ---------------------------------------

{
  // The carry itself: three numbers the run writes and clears, which `velocity.ts` turns into the
  // translation it multiplies last frame's view by. Nothing else in the game ever writes them.
  setReprojectionCarry(0, 0, 0);
  ok(!reprojectionCarry().on, 'nothing carries the reprojection by default');
  setReprojectionCarry(0, 0, -167);
  ok(reprojectionCarry().on && reprojectionCarry().z === -167, 'a run writes its own step');
  setReprojectionCarry(0, 0, 0);
  ok(!reprojectionCarry().on, 'and clears it when it ends');

  // And the arithmetic the carry rests on, which is what makes a still world stay still: last
  // frame's projection-view moved by the step the camera took is this frame's projection-view.
  const proj = new THREE.Matrix4().makePerspective(-0.1, 0.1, 0.06, -0.06, 0.1, 9000);
  const cam = new THREE.Object3D();
  const viewAt = (z: number) => {
    cam.position.set(0, 0, z);
    cam.updateMatrixWorld(true);
    return cam.matrixWorld.clone().invert();
  };
  const step = new THREE.Vector3(0, 0, -1000);
  const before = viewAt(0);
  const after = viewAt(step.z);
  // Off to one side, where a step straight ahead moves a still point across the screen the most.
  const still = new THREE.Vector3(600, 250, -4000);
  const where = (m: THREE.Matrix4, p: THREE.Vector3) => {
    const v = new THREE.Vector4(p.x, p.y, p.z, 1).applyMatrix4(m);
    return new THREE.Vector2(v.x / v.w, v.y / v.w);
  };
  const now = where(new THREE.Matrix4().multiplyMatrices(proj, after), still);
  const plain = where(new THREE.Matrix4().multiplyMatrices(proj, before), still);
  ok(plain.distanceTo(now) > 0.05, 'a kilometre of run moves a still point right across the screen, which is the smear');
  // What velocity.ts does: proj x last frame's view x the translation by minus the step.
  const carried = new THREE.Matrix4().multiplyMatrices(proj, before).multiply(new THREE.Matrix4().makeTranslation(-step.x, -step.y, -step.z));
  ok(where(carried, still).distanceTo(now) < 1e-6, "with the run's step taken out, the point reprojects onto itself and leaves no smear at all");
  const wrongWay = new THREE.Matrix4().multiplyMatrices(proj, before).multiply(new THREE.Matrix4().makeTranslation(step.x, step.y, step.z));
  ok(where(wrongWay, still).distanceTo(now) > 0.05, 'and the sign matters: the other way round doubles the smear rather than removing it');
}

console.log(`\n${passed} checks passed`);
