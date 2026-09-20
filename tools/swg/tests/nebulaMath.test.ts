// A nebula's arithmetic, checked without a browser: how many sheets a row asks for and how the
// zone's cap shares them out, that the same nebula makes the same sheets every time and in every
// browser, that a sheet's colour runs from the row's colour at the middle to its ramp colour at the
// edge, that pulling a far nebula toward the camera leaves its picture exactly the size it was,
// that two browsers on the same wall clock find the same strikes at the same moments however
// differently their frames fall, that a long gap never becomes a burst, what a strike takes off a
// ship, and that the camera shake stays inside the numbers it is given.
//
// Every nebula here is made up. The last section reads the owner's converted zones when they are
// there and prints only a pass or a fail: no value out of a pack is written down anywhere.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { viewShakeAmount } from '../../../src/core/camera.ts';
import { Nebulae } from '../../../src/space/nebulae.ts';
import {
  NEBULA_TUNE,
  apparentSize,
  beamCurves,
  beamEnvelope,
  buildSheets,
  deepestInside,
  dimInside,
  insideDepth,
  pullScale,
  rampAt,
  seedOfName,
  shakeAt,
  shareSheets,
  sheetCount,
  sortFarToNear,
  strikeDamage,
  strikesBetween,
  waveAt,
  type InsideAt,
  type NebulaStrike,
  type ViewShake,
} from '../../../src/space/nebulaMath.ts';
import type { Nebula, NebulaColour } from '../../../src/space/spaceData.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/** A made-up row, in the shape the pack gives one. */
const row = (name: string, at: [number, number, number], radius: number, extra: Partial<Nebula> = {}): Nebula => ({
  name,
  at,
  radius,
  density: 1,
  facingShare: 0.5,
  facing: { colour: [0.6, 1, 0.8, 0.8] as NebulaColour, ramp: [0.2, 0.4, 0.6, 1] as NebulaColour },
  oriented: { colour: [0.5, 1, 1, 1] as NebulaColour, ramp: [0.5, 1, 1, 1] as NebulaColour },
  jitter: 0,
  shader: 'mist',
  shaderIndex: 1,
  sound: { ambient: null, volume: 0 },
  lightning: null,
  unused: {},
  ...extra,
});

// --- 1. how many sheets, and the zone's cap ---

{
  const small = sheetCount(200, 1, NEBULA_TUNE);
  const big = sheetCount(6000, 1, NEBULA_TUNE);
  ok(small >= NEBULA_TUNE.sheetsMin && big <= NEBULA_TUNE.sheetsMax, 'a nebula asks for at least the floor and never more than the ceiling');
  ok(sheetCount(1500, 1, NEBULA_TUNE) >= sheetCount(1500, 0.4, NEBULA_TUNE), 'a thinner nebula asks for no more sheets than a thick one of the same size');
  ok(sheetCount(3000, 1, NEBULA_TUNE) >= sheetCount(600, 1, NEBULA_TUNE), 'a larger nebula asks for at least as many as a small one');

  const wanted = [90, 90, 90, 90, 90];
  const same = shareSheets(wanted, 1000);
  ok(same.join() === wanted.join(), 'a zone under the cap keeps every sheet it asked for');
  const cut = shareSheets(wanted, 100);
  ok(
    cut.reduce((a, b) => a + b, 0) <= 120 && cut.every((c) => c >= 3),
    'a zone over the cap is shared down in proportion and no nebula is left without sheets',
  );
  const lopsided = shareSheets([300, 30], 110);
  ok(lopsided[0] > lopsided[1], 'the share keeps the big nebula bigger than the small one');
}

// --- 2. the same sheets every time ---

{
  const r = row('a made up nebula', [1000, -200, 500], 2000);
  const once = buildSheets(r, 0, 20, NEBULA_TUNE);
  const twice = buildSheets(r, 0, 20, NEBULA_TUNE);
  ok(once.length === 20 && twice.length === 20, 'a nebula makes the sheets it was asked for');
  ok(JSON.stringify(once) === JSON.stringify(twice), 'the same nebula makes exactly the same sheets every time, so two browsers draw one cloud');
  const other = buildSheets(row('another made up nebula', [1000, -200, 500], 2000), 0, 20, NEBULA_TUNE);
  ok(JSON.stringify(other) !== JSON.stringify(once), 'two nebulae with the same place and size are still two different clouds');
  ok(seedOfName('a') !== seedOfName('b'), 'two names are two seeds');

  const inside = once.every((s) => Math.hypot(s.x - r.at[0], s.y - r.at[1], s.z - r.at[2]) <= r.radius + 1e-6);
  ok(inside, 'every sheet stands inside its nebula');
  ok(
    once.every((s) => s.size >= r.radius * NEBULA_TUNE.sizeMin - 1e-6 && s.size <= r.radius * NEBULA_TUNE.sizeMax + 1e-6),
    'every sheet is between the smallest and the largest share of the radius',
  );
  ok(
    once.every((s) => near(Math.hypot(...s.right), 1, 1e-6) && near(Math.hypot(...s.up), 1, 1e-6) && near(s.right[0] * s.up[0] + s.right[1] * s.up[1] + s.right[2] * s.up[2], 0, 1e-6)),
    'a sheet that keeps its turn has two unit axes at right angles, so it is never stretched',
  );
  const facing = once.filter((s) => s.facing).length;
  ok(facing > 2 && facing < 18, 'about half of them turn to face the camera, as the row asks');
  const half = buildSheets(r, 0, 10, NEBULA_TUNE);
  ok(JSON.stringify(half) === JSON.stringify(once.slice(0, 10)), 'asking for fewer sheets keeps the ones it had, so moving the density knob does not shuffle the cloud');
}

// --- 3. the colour from the middle to the edge ---

{
  const colour: NebulaColour = [0.5, 1, 0, 0];
  const ramp: NebulaColour = [0.25, 0, 0, 1];
  const middle = rampAt(colour, ramp, 0);
  const edge = rampAt(colour, ramp, 1);
  const half = rampAt(colour, ramp, 0.5);
  ok(middle[0] === 1 && middle[3] === 0.5, 'at the middle a sheet wears the row\'s own colour, alpha and all');
  ok(edge[2] === 1 && edge[3] === 0.25, 'at the edge it wears the ramp colour');
  ok(near(half[0], 0.5, 1e-9) && near(half[3], 0.375, 1e-9), 'and it runs straight between them on the way out');
}

// --- 4. pulling a far nebula in ---

{
  const far = 14000;
  const k = pullScale(far, NEBULA_TUNE);
  ok(k < 1 && near(far * k, NEBULA_TUNE.pullFrom, 1e-6), 'a nebula past the pull distance is brought exactly to it');
  ok(pullScale(NEBULA_TUNE.pullFrom - 1, NEBULA_TUNE) === 1, 'a nebula this side of it is left alone');
  // A sheet 3 km off the middle of a nebula 14 km away, scaled about the camera by the same ratio.
  const sheetDistance = far + 3000;
  const size = 2500;
  const before = apparentSize(size, sheetDistance);
  const after = apparentSize(size * k, sheetDistance * k);
  ok(near(before, after, 1e-12), 'scaling a whole nebula about the camera leaves every sheet exactly the size it looked');
}

// --- 5. how deep inside ---

{
  ok(insideDepth(1000, 1000, NEBULA_TUNE) === 0, 'at the edge the camera is not inside at all');
  ok(insideDepth(0, 1000, NEBULA_TUNE) === 1, 'at the middle it is all the way in');
  const part = insideDepth(900, 1000, NEBULA_TUNE);
  ok(part > 0 && part < 1, 'just inside the edge it is a little way in');
  ok(insideDepth(1500, 1000, NEBULA_TUNE) === 0, 'outside it is not inside at all');

  const rows = [row('thin', [0, 0, 0], 1000, { density: 0.2 }), row('thick', [0, 0, 400], 1000, { density: 1 })];
  const deep = deepestInside(rows, 0, 0, 200, NEBULA_TUNE);
  ok(deep.index === 1, 'where two nebulae overlap, the thicker one is the one the camera is in');
  ok(deepestInside(rows, 0, 0, 9000, NEBULA_TUNE).index === -1, 'and outside them all there is none');

  // It is asked once a frame, so it writes into an object it is given rather than making one.
  const where: InsideAt = { index: 7, depth: 7 };
  const back = deepestInside(rows, 0, 0, 200, NEBULA_TUNE, where);
  ok(back === where && where.index === 1 && where.depth > 0, 'where the camera is inside is written into the object it is handed, so a frame makes nothing');
  deepestInside(rows, 0, 0, 9000, NEBULA_TUNE, where);
  ok(where.index === -1 && where.depth === 0, 'and the same object is cleared when the camera comes out, never left saying the old answer');

  ok(near(dimInside(0, 0.85), 1, 1e-9), 'outside a nebula the flare and the rays are untouched');
  ok(near(dimInside(1, 0.85), 0.15, 1e-9), 'deep inside one they are dimmed by the share they are given');
}

// --- 6. the strikes, on the wall clock ---

{
  const seed = seedOfName('a made up nebula');
  const every = 0.5;
  const maxSeconds = 2;
  const radius = 1500;
  const from = 1_700_000_000_000;
  const to = from + 20_000;

  // One browser polling in long steps, another in short ones: both must find the same strikes.
  const slow: NebulaStrike[] = [];
  const scratch: NebulaStrike[] = [];
  for (let t = from; t < to; t += 500) slow.push(...strikesBetween(seed, every, maxSeconds, radius, t, t + 500, scratch, NEBULA_TUNE));
  const fast: NebulaStrike[] = [];
  for (let t = from; t < to; t += 16) fast.push(...strikesBetween(seed, every, maxSeconds, radius, t, t + 16, scratch, NEBULA_TUNE));
  ok(slow.length > 0, 'a nebula that strikes twice a second strikes a few times in twenty seconds');
  ok(slow.length === fast.length && slow.every((s, i) => s.slot === fast[i].slot && s.at === fast[i].at), 'two browsers with quite different frame rates see the same strikes at the same moments');
  ok(slow.every((s) => s.seconds > 0 && s.seconds <= maxSeconds), 'no strike outlasts the longest the row allows');
  ok(new Set(slow.map((s) => s.slot)).size === slow.length, 'a strike is never started twice');
  ok(
    slow.every((s) => {
      const length = Math.hypot(s.to[0] - s.from[0], s.to[1] - s.from[1], s.to[2] - s.from[2]);
      return length >= radius * NEBULA_TUNE.strikeSpanMin - 1e-6 && length <= radius * NEBULA_TUNE.strikeSpanMax + 1e-6;
    }),
    'a bolt is between the shortest and the longest share of the nebula it strikes in',
  );

  const nothing = strikesBetween(seed, 0, maxSeconds, radius, from, to, scratch, NEBULA_TUNE);
  ok(nothing.length === 0, 'a row with no strike rate never strikes');

  // A tab that was away for an hour must not catch up with an hour of lightning.
  const caught = strikesBetween(seed, 1, maxSeconds, radius, from, from + 3_600_000, scratch, NEBULA_TUNE, 4);
  ok(caught.length <= 5, 'a long gap comes back with the last few strikes, never with a burst');
}

// --- 7. what a strike takes off a ship ---

{
  const band: [number, number] = [100, 300];
  ok(strikeDamage(band, 0, false, NEBULA_TUNE) === 0, 'with the damage switched off a strike only flashes');
  const least = strikeDamage(band, 0, true, NEBULA_TUNE);
  const most = strikeDamage(band, 1, true, NEBULA_TUNE);
  ok(near(least, band[0] * NEBULA_TUNE.damageShare, 1e-9) && near(most, band[1] * NEBULA_TUNE.damageShare, 1e-9), 'a strike does the row\'s own band at the share the game takes of it');
  ok(most < band[1], 'which is less than the table\'s own number, as it was meant to be');
  ok(strikeDamage([300, 100], 1, true, NEBULA_TUNE) === most, 'a band written the other way round does the same damage');
}

// --- 8. the bolt's shape and life ---

{
  const points = [
    [0, 0],
    [0.35, 3],
    [0.95, 3],
    [1, 8],
  ];
  ok(waveAt(points, 0) === 0 && waveAt(points, 1) === 8, 'a waveform reads its own ends');
  ok(near(waveAt(points, 0.175), 1.5, 1e-6), 'and runs straight between its points');
  ok(waveAt([], 0.5) === 0, 'a waveform with no points is nothing at all');
  const curve = beamCurves(points, 9);
  ok(curve.length === 9 && Math.max(...curve) === 1, 'a curve is sampled evenly and scaled so its largest value is one');
  ok(beamCurves([], 5).every((v) => v === 1), 'a bolt with no curve at all is the same width all the way along');

  ok(beamEnvelope(-0.1, 1, NEBULA_TUNE) === 0 && beamEnvelope(1.1, 1, NEBULA_TUNE) === 0, 'a bolt shows nothing before it starts or after it has gone');
  ok(beamEnvelope(0.001, 1, NEBULA_TUNE) < 0.5 && beamEnvelope(0.3, 1, NEBULA_TUNE) === 1, 'it comes up quickly and then holds');
  ok(beamEnvelope(0.95, 1, NEBULA_TUNE) < 1, 'and fades out at the end rather than vanishing at its brightest');
}

// --- 8b. the mist's order, far to near, without making anything ---

{
  const count = 1500;
  const keys = new Float32Array(count);
  const order = new Int32Array(count);
  const scratch = new Int32Array(count);
  let seed = 12345;
  for (let i = 0; i < count; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    keys[i] = seed % 100000;
    order[i] = i;
  }
  sortFarToNear(order, keys, count, scratch);
  let falls = true;
  for (let i = 1; i < count; i++) if (keys[order[i - 1]] < keys[order[i]]) falls = false;
  ok(falls, 'the sheets come out farthest first, all fifteen hundred of them');
  ok(new Set(order).size === count, 'and every sheet is there exactly once, none lost and none drawn twice');

  // Equal distances must keep the order they came in, or the picture flickers where two sheets tie.
  const ties = new Float32Array([5, 5, 9, 5, 9]);
  const tieOrder = new Int32Array([0, 1, 2, 3, 4]);
  sortFarToNear(tieOrder, ties, 5, new Int32Array(5));
  ok(tieOrder[0] === 2 && tieOrder[1] === 4 && tieOrder[2] === 0 && tieOrder[3] === 1 && tieOrder[4] === 3, 'sheets exactly as far off keep the order they were in, so nothing flickers between two frames');

  const one = new Int32Array([0]);
  sortFarToNear(one, new Float32Array([1]), 1, new Int32Array(1));
  ok(one[0] === 0, 'a single sheet is left where it is');

  // The point of it: no comparator, no copy of the array, nothing made while the player is flying.
  // `%TypedArray%.sort` with a comparator costs about 1.7 KB a call, which is two megabytes here.
  // The first two thousand are a warm-up that is not measured: the engine tiers the function up while
  // they run and the code and feedback it writes land on the heap, which is not the sort allocating
  // anything, and it is enough on a loaded machine to fail a check that is really about the sort.
  for (let i = 0; i < 2000; i++) sortFarToNear(order, keys, count, scratch);
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < 2000; i++) sortFarToNear(order, keys, count, scratch);
  const grew = process.memoryUsage().heapUsed - before;
  ok(grew < 1024 * 1024, `two thousand orderings of fifteen hundred sheets make next to nothing (${Math.round(grew / 1024)} KB)`);
}

// --- 9. the camera shake ---

{
  const out: ViewShake = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0 };
  shakeAt(3.21, 0, out, NEBULA_TUNE);
  ok(out.yaw === 0 && out.x === 0, 'nothing shakes where there is nothing to shake it');
  let biggestTurn = 0;
  let biggestShift = 0;
  for (let t = 0; t < 10; t += 0.01) {
    shakeAt(t, 1, out, NEBULA_TUNE);
    biggestTurn = Math.max(biggestTurn, Math.abs(out.yaw), Math.abs(out.pitch), Math.abs(out.roll));
    biggestShift = Math.max(biggestShift, Math.abs(out.x), Math.abs(out.y));
  }
  ok(biggestTurn <= NEBULA_TUNE.shakeTurn + 1e-9 && biggestShift <= NEBULA_TUNE.shakeShift + 1e-9, 'the shake never goes past the numbers it is given');
  ok(biggestTurn > NEBULA_TUNE.shakeTurn * 0.9, 'and it does reach them');
  const a = { ...out };
  shakeAt(3.21, 1, out, NEBULA_TUNE);
  const b = { ...out };
  shakeAt(3.21, 1, out, NEBULA_TUNE);
  ok(out.yaw === b.yaw && out.pitch === b.pitch, 'the same moment shakes the same way, so a pause and a step give the same view');
  ok(a.yaw !== out.yaw || a.pitch !== out.pitch, 'and the shake does move as the seconds go by');
}

// --- 10. the owner's own zones, when they are converted (pass or fail only) ---

{
  const packs = new URL('../../../assets-private/', import.meta.url);
  const zones = existsSync(packs) ? readdirSync(packs).filter((d) => d.startsWith('space_') && existsSync(new URL(`${d}/space.json`, packs))) : [];
  if (!zones.length) console.log('note  no converted space packs here, so the zones themselves were not checked');
  let withNebulae = 0;
  let withLightning = 0;
  for (const zone of zones) {
    const pack = JSON.parse(readFileSync(new URL(`${zone}/space.json`, packs), 'utf8')) as { nebulae?: Nebula[] };
    const rows = pack.nebulae ?? [];
    if (!rows.length) continue;
    withNebulae++;
    const counts = shareSheets(
      rows.map((r) => sheetCount(r.radius, r.density, NEBULA_TUNE)),
      NEBULA_TUNE.zoneSheets,
    );
    const total = counts.reduce((a, b) => a + b, 0);
    // The cap, plus at most the three sheets the share keeps for a nebula that would round to none;
    // and in practice within a twentieth of the cap, which is what the budget was measured at.
    ok(
      total <= NEBULA_TUNE.zoneSheets + 3 * rows.length && total <= NEBULA_TUNE.zoneSheets * 1.05 && counts.every((c) => c >= 3),
      `${zone} draws a sheet count inside the zone's budget, with every nebula in it`,
    );
    ok(
      rows.every((r) => {
        const sheets = buildSheets(r, 0, Math.min(8, counts[0]), NEBULA_TUNE);
        return sheets.every((s) => Number.isFinite(s.x) && Number.isFinite(s.size) && s.size > 0);
      }),
      `${zone} places every nebula's sheets at a real place and a real size`,
    );
    if (rows.some((r) => r.lightning && r.lightning.every > 0)) withLightning++;
  }
  if (withNebulae) ok(withNebulae > 0 && withLightning > 0, 'the converted zones carry nebulae, and lightning strikes in some of them');
}

// --- 11. the set itself, built and stepped without a browser ---

{
  // Three runs in node as long as nothing is drawn, so the whole set can be built, stepped and
  // freed here: what is drawn, what the haze does, who is struck, and that nothing is left behind.
  const look = {
    shader: '',
    effect: null,
    blend: 'alpha' as const,
    texture: 'nebula/mist.png',
    shell: { shader: '', effect: null, texture: 'nebula/mist.png' },
  };
  const rows: Nebula[] = [
    row('near and thick', [0, 0, 0], 2000, {
      shader: 'mist',
      jitter: 0.5,
      lightning: { appearance: '', every: 2, maxSeconds: 1.5, damage: [40, 120], colour: [0.5, 1, 0.6, 0.2] as NebulaColour, ramp: [0.5, 1, 0.9, 0.3] as NebulaColour, sounds: { strike: null, loop: null }, hit: { client: null, server: null } },
    }),
    row('far and glowing', [30000, 0, 0], 3000, { shader: 'glow' }),
  ];
  const pack = {
    version: 3,
    zone: 'a made up zone',
    planet: null,
    title: 'a made up zone',
    stations: [],
    scenery: [],
    planets: [],
    arrival: null,
    hyperspace: null,
    nebulae: rows,
    nebulaLook: { glow: { ...look, blend: 'add' as const, texture: 'nebula/glow.png' }, mist: look },
    lightning: {
      source: '',
      flipbook: { shader: '', frames: 4, frameStart: 0, frameEnd: 3, uvSize: 0.5, perColumn: 2, fps: 10, visible: true },
      texture: 'nebula/lightning.png',
      // Two curves of different shapes, so which one shapes what can be told apart.
      waveforms: [
        { interp: 0, sample: 0, points: [[0, 0], [0.5, 3], [1, 8]] },
        { interp: 0, sample: 0, points: [[0, 8], [0.5, 1], [1, 4]] },
      ],
      value: 0.2,
      start: null,
      end: null,
      trailingBytes: 0,
    },
    fields: [],
    lanes: {},
    dockEffects: {},
  };

  let clock = 1_700_000_000_000;
  let hurt = 0;
  let flashes = 0;
  const shipPos = new THREE.Vector3(600, 0, 0);
  let shipRadius = 20;
  const nebulae = await Nebulae.build(
    {
      place: () => null,
      remove: () => {},
      flash: () => {
        flashes++;
      },
      shipAt: (out) => {
        out.copy(shipPos);
        return shipRadius;
      },
      hurtShip: (amount) => {
        hurt += amount;
      },
      damageEnabled: () => true,
      now: () => clock,
      texture: async () => new THREE.Texture(),
    },
    pack,
    (f) => f,
    async () => {},
    () => true,
  );
  ok(!!nebulae, 'a zone with nebulae and a look to draw them with builds a set');
  const set = nebulae!;
  const camera = new THREE.PerspectiveCamera(60, 1.7, 0.05, 9000);
  ok(set.sheets > 0 && set.sheets <= NEBULA_TUNE.zoneSheets, 'the zone draws sheets, and no more than its budget');
  const drawn = set.group.children.filter((o) => (o as THREE.Mesh).isMesh).length;
  ok(drawn === 2 + 2 + NEBULA_TUNE.beams, 'the whole zone is two sheet sets, two hazes and the bolt pool, and nothing else');
  ok(
    set.group.children.every((o) => {
      const m = o as THREE.Mesh;
      const mat = m.material as THREE.Material;
      return !m.castShadow && !m.receiveShadow && !m.frustumCulled && mat.userData.unlit === true && mat.userData.dry === true && mat.depthWrite === false;
    }),
    'nothing a nebula draws casts a shadow, writes depth, joins the cascades or is ever wet',
  );

  // Outside them all: no haze, nothing dimmed.
  camera.position.set(0, 0, 9000);
  set.update(0.016, camera);
  let report = set.report() as { inside: unknown; haze: { drawn: boolean }[]; dim: { flare: number; rays: number } };
  ok(report.inside === null && report.haze.every((h) => !h.drawn), 'outside every nebula there is no haze at all');
  ok(report.dim.flare === 1 && report.dim.rays === 1, 'and the flare and the god rays are untouched');

  // In the middle of the thick one: haze up, the star dimmed, the view shaking.
  camera.position.set(0, 0, 0);
  set.update(0.016, camera);
  report = set.report() as typeof report;
  ok(!!report.inside, 'inside one, the set knows which one it is in');
  ok(report.haze.some((h) => h.drawn), 'the haze comes up around the camera');
  ok(report.dim.flare < 0.2 && report.dim.rays < 0.3, 'and deep inside, the flare and the rays are mostly gone');
  ok(viewShakeAmount() > 0, 'a nebula the table gives a shake to shakes the view');

  // The bolts: two at once and no more, and a strike that ends on the ship hurts it.
  shipPos.set(200, 0, 0);
  const first = set.forceStrike(camera.position);
  const second = set.forceStrike(camera.position);
  const third = set.forceStrike(camera.position);
  ok(!first.includes('busy') && !second.includes('busy'), 'two bolts can be in the air at once');
  ok(third.includes('busy'), 'and a third strike is skipped rather than making a bolt out of nothing');
  ok(flashes === 2, 'each bolt borrows one pooled light and no more');
  ok(hurt > 0, 'a strike that ends on the player\'s ship hurts it');
  let took = hurt;
  // The bolts age out, and a strike that comes straight after must not take the ship apart.
  set.update(2, camera);
  set.update(2, camera);
  set.forceStrike(camera.position);
  ok(hurt === took, 'a second strike moments later leaves the ship alone: there is a floor on how often one may be hit');
  // Once the floor has passed, a strike that happens to end near the ship hurts it again. Where a
  // bolt falls is a hash of its slot, so this tries a few slots rather than assuming the next one.
  clock += NEBULA_TUNE.hitEvery * 1000 + 1000;
  for (let i = 0; i < 40 && hurt === took; i++) {
    set.update(2, camera);
    set.update(2, camera);
    set.forceStrike(camera.position);
  }
  ok(hurt > took, 'and once that time has passed it can be hit again');
  took = hurt;
  shipRadius = 0;
  clock += 5000;
  set.update(2, camera);
  set.update(2, camera);
  set.forceStrike(camera.position);
  ok(hurt === took, 'with no ship there, a strike hurts nothing');
  ok((set.report() as { lightning: { live: number } }).lightning.live <= NEBULA_TUNE.beams, 'never more bolts than the pool holds');

  // The bolt's two curves. By default the first widens it and the second says how far it wanders,
  // and nothing shapes how bright it is along its length; `waveAlpha` is the other reading.
  const bolt = set.group.children.find((o) => o.name === 'nebula:lightning:0') as THREE.Mesh;
  const readAttr = (mesh: THREE.Mesh, name: string): number[] => Array.from((mesh.geometry.getAttribute(name) as THREE.BufferAttribute).array as Float32Array);
  const varies = (v: number[]): boolean => Math.max(...v) - Math.min(...v) > 1e-6;
  ok(varies(readAttr(bolt, 'aWidth')), 'the first curve shapes the bolt\'s width along its length');
  ok(varies(readAttr(bolt, 'aWander')), 'the second says how far it wanders off the straight line');
  ok(readAttr(bolt, 'aBright').every((v) => v === 1), 'and nothing dims it along its length, which is the reading of the two curves this game takes');

  // The sort's cadence at a jump's speed: the camera moving 900 m a second at 144 frames a second
  // asks for an ordering on nearly every frame, and the floor must hold it to about ten a second.
  const mist = set.group.children.find((o) => o.name === 'nebula:mist') as THREE.Mesh;
  const version = (): number => (mist.geometry.getAttribute('iCentre') as THREE.BufferAttribute).version;
  const startedAt = version();
  camera.position.set(0, 0, -5000);
  for (let f = 0; f < 144; f++) {
    camera.position.z += 900 / 144;
    set.update(1 / 144, camera);
  }
  const sorts = version() - startedAt;
  ok(sorts > 0 && sorts <= Math.ceil(1 / NEBULA_TUNE.sortLeast) + 1, `a second of flying at a jump's speed orders the mist ${sorts} times, not once a frame`);

  // The density knob: the sheets change and no material is made.
  const materialsBefore = new Set(set.group.children.map((o) => (o as THREE.Mesh).material));
  const sheetsBefore = set.sheets;
  NEBULA_TUNE.density = 0.25;
  set.fill();
  ok(set.sheets < sheetsBefore, 'turning the density down draws fewer sheets');
  const materialsAfter = new Set(set.group.children.map((o) => (o as THREE.Mesh).material));
  ok(materialsBefore.size === materialsAfter.size && [...materialsAfter].every((m) => materialsBefore.has(m)), 'and it makes no new material, so nothing can compile on a live frame');
  NEBULA_TUNE.density = 1;
  set.fill();

  let forgotten = 0;
  set.dispose((mats) => {
    forgotten += mats.length;
  });
  ok(forgotten >= 4, 'everything it drew leaves the portal renderer\'s set and the cascades\' map when the zone goes');
  ok(set.group.children.length === 0, 'and the group is left empty');

  // --- the other reading of the second curve, which the owner can ask for ---

  const plainDeps = {
    place: () => null,
    remove: () => {},
    flash: () => {},
    shipAt: () => 0,
    hurtShip: () => {},
    damageEnabled: () => false,
    now: () => clock,
    texture: async () => new THREE.Texture(),
  };
  NEBULA_TUNE.waveAlpha = true;
  const other = await Nebulae.build(plainDeps, pack, (f) => f, async () => {}, () => true);
  NEBULA_TUNE.waveAlpha = false;
  ok(!!other, 'the other reading builds a set too');
  const otherBolt = other!.group.children.find((o) => o.name === 'nebula:lightning:0') as THREE.Mesh;
  ok(varies(readAttr(otherBolt, 'aBright')), 'with it asked for, the second curve is how bright the bolt is along its length');
  ok(readAttr(otherBolt, 'aWander').every((v) => v === 1), 'and the bolt then wanders the same amount all the way along, rather than being shaped twice by one curve');
  ok(varies(readAttr(otherBolt, 'aWidth')), 'while the first curve still widens it either way');
  other!.dispose(() => {});

  // --- a build a travel or a jump abandons part way through ---

  let made = 0;
  let freed = 0;
  let asked = 0;
  const abandoned = await Nebulae.build(
    {
      ...plainDeps,
      texture: async () => {
        made++;
        const t = new THREE.Texture();
        t.addEventListener('dispose', () => {
          freed++;
        });
        return t;
      },
    },
    pack,
    (f) => f,
    async () => {},
    // True while the pictures load, false by the time the meshes are made: the moment a travel
    // lands part way through a build.
    () => asked++ < 1,
  );
  ok(abandoned === null, 'a build the world no longer wants comes back with nothing rather than a set nobody holds');
  ok(made > 0 && freed === made, 'and every picture it had already loaded is freed where it stands');
}

console.log(`\n${passed} checks passed`);
