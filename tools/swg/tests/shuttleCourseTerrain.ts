// The shuttle's pilot flown over the real ground, by hand: every directed pair of rigged pads on the
// converted worlds, from the take-off's cut to the landing's join, over the ground the game's own
// terrain rules generate out of each world's `terrain.trn` (without the buildings' own layers, so the
// ground right by a pad is the unflattened ground). It is not in `test:all`: it generates kilometres of
// terrain and takes minutes.
//
// It passes when at least 280 of the pairs meet their join within the pilot's own tolerance
// (`RIDE_PILOT.joinTol`) and no flight goes under the ground further than 600 m from either pad (the
// game's own clips pass under the raw ground nearer than that at several pads). It prints the worst
// flights so the ones that miss can be looked at.
//
// And every crossing down onto a rigged pad over the same ground (`rigArrivals`), raised over the ground
// where it comes out as the ride raises it: those must all plan a course no longer than the straight run
// and turning nowhere, and never go under the ground. And it is judged on what is flown, not only on what
// is planned: every crossing down a ticket can make (the rig a starport stands, `byTicket`) must meet its
// join within the tolerance, never go round again and never turn more than 90 degrees flying it, unless
// its pad is on `KNOWN_HIGH` -- named there with the ground that makes it so, the same ground its
// pad-to-pad trips miss on -- which is printed every run as a known miss rather than passed over. A
// crossing down no ticket makes (a shuttle's landing onto a starport's pad) is flown and printed, not
// judged on how it meets its join.
//
// Run: node tools/swg/tests/shuttleCourseTerrain.ts [pack]

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SWAY, flyCourse, quantile, rigArrivals, rigPairs } from './courseFixtures.ts';
import { RIDE_PILOT } from '../../../src/world/shuttleCourse.ts';
import { RIDE_TUNE } from '../../../src/world/shuttleRide.ts';
import { attachBitmap, bitmapFiles, parseTerrainTemplate, TerrainSampler } from '../../../src/swg/terrain/trn.ts';

const packs = join(process.cwd(), 'assets-private');
const only = process.argv[2];

/** A world's ground in the game's own frame: the terrain sampler over its `terrain.trn`, mirrored and centred as the world is. */
const grounds = new Map<string, { sampler: TerrainSampler; at: (x: number, z: number) => number } | null>();
function groundOf(pack: string): { sampler: TerrainSampler; at: (x: number, z: number) => number } | null {
  if (grounds.has(pack)) return grounds.get(pack) ?? null;
  const layoutFile = join(packs, pack, 'layout.json');
  let out: { sampler: TerrainSampler; at: (x: number, z: number) => number } | null = null;
  if (existsSync(layoutFile)) {
    const layout = JSON.parse(readFileSync(layoutFile, 'utf8')) as { terrain?: string; center?: { x: number; z: number } };
    const trn = layout.terrain ? join(packs, pack, layout.terrain) : '';
    if (trn && existsSync(trn) && layout.center) {
      const template = parseTerrainTemplate(new Uint8Array(readFileSync(trn)));
      for (const b of bitmapFiles(template)) {
        const f = join(packs, pack, b.file);
        if (existsSync(f)) attachBitmap(template, b.familyId, new Uint8Array(readFileSync(f)));
      }
      const sampler = new TerrainSampler(template);
      const c = layout.center;
      out = { sampler, at: (x, z) => sampler.heightAt(c.x - x, c.z + z) };
    }
  }
  grounds.set(pack, out);
  return out;
}

const pairs = rigPairs(packs).filter((p) => !only || p.pack === only);
if (!pairs.length) {
  console.log('no converted world carries rigged shuttle pads: npm run swg -- travel @SWG assets-private --retail-only');
  process.exit(0);
}
const tol = RIDE_PILOT.joinTol;
const started = Date.now();
const rows: { label: string; f: ReturnType<typeof flyCourse>; within: boolean }[] = [];
let lastPack = '';
for (const p of pairs) {
  const g = groundOf(p.pack);
  if (!g) continue;
  if (p.pack !== lastPack) {
    // One world's ground at a time: its blocks are dropped between worlds to keep the memory down.
    grounds.get(lastPack)?.sampler.invalidateAll();
    lastPack = p.pack;
    console.log(`${p.pack}...`);
  }
  const f = flyCourse(p, g.at);
  const within = f.joined && Math.abs(f.error.across) <= tol.across && Math.abs(f.error.up) <= tol.up && f.error.heading <= tol.heading;
  rows.push({ label: p.label, f, within });
}
const joined = rows.filter((r) => r.within);
const under = rows.filter((r) => r.f.under > 0);
const n1 = (n: number) => n.toFixed(1);
console.log(`\n${rows.length} pairs flown over the real ground in ${((Date.now() - started) / 1000).toFixed(0)} s`);
console.log(`met the join within ${tol.across} m across, ${tol.up} m up and ${tol.heading} degrees: ${joined.length} of ${rows.length}; flown round again: ${rows.filter((r) => r.f.goArounds).length}`);
for (const k of ['across', 'up', 'heading'] as const) {
  const xs = rows.filter((r) => r.f.joined).map((r) => Math.abs(r.f.error[k]));
  console.log(`|${k}| at the join: median ${n1(quantile(xs, 0.5))}, p90 ${n1(quantile(xs, 0.9))}, max ${n1(quantile(xs, 1))}`);
}
const clears = rows.map((r) => r.f.minClear).filter(Number.isFinite);
console.log(`least height over the ground beyond 600 m of a pad: min ${n1(quantile(clears, 0))} m, p10 ${n1(quantile(clears, 0.1))}, median ${n1(quantile(clears, 0.5))}`);
console.log(`highest over the higher pad: median ${n1(quantile(rows.map((r) => r.f.highest), 0.5))} m, p90 ${n1(quantile(rows.map((r) => r.f.highest), 0.9))}, max ${n1(quantile(rows.map((r) => r.f.highest), 1))}`);
console.log(`flown seconds, cut to join: median ${n1(quantile(rows.map((r) => r.f.seconds), 0.5))}, max ${n1(quantile(rows.map((r) => r.f.seconds), 1))}`);
console.log(`under the ground beyond 600 m of a pad: ${under.length} flights`);
// How it swayed over the last half minute before each join (`SWAY`): stick sides changed and climbs turned.
const sw = (k: 'flipsX' | 'flipsY' | 'heightTurns' | 'diveOver') => rows.map((r) => r.f[k]);
console.log(`the last ${SWAY.window} s before the join: stick sides changed across p90 ${quantile(sw('flipsX'), 0.9)}, most ${quantile(sw('flipsX'), 1)}; up p90 ${quantile(sw('flipsY'), 0.9)}, most ${quantile(sw('flipsY'), 1)}; climb turned at most ${quantile(sw('heightTurns'), 1)} times; dived at most ${n1(quantile(sw('diveOver'), 1))} degrees past the steepest allowed`);
for (const r of under.slice(0, 12)) console.log(`   ${r.label}: ${n1(r.f.under)} s, ${n1(r.f.deepest)} m at the deepest`);
const missed = rows.filter((r) => !r.within);
console.log(`outside the tolerance: ${missed.length}`);
for (const r of missed.slice(0, 20)) console.log(`   ${r.label}: across ${n1(r.f.error.across)}, up ${n1(r.f.error.up)}, heading ${n1(r.f.error.heading)}, round again ${r.f.goArounds}, ${r.f.joined ? 'joined' : 'never joined'}`);

// Every crossing down onto a rigged pad, over the same ground: where it comes out (`downArrival`), raised
// to `downClear` over the ground there as the ride raises it once that world is in, and flown in from
// nothing known of the ground, as the ride flies it. Straight in on its glide wherever the ground allows.
const arrivals = rigArrivals(packs).filter((p) => !only || p.pack === only);

/**
 * The pads a crossing down a ticket makes is known not to come in on one glide to, over this ground, each
 * with what stands in the way as measured here. Printed every run as a known miss, never passed over; a
 * pad on it whose crossing comes to meet its join is printed as such, to be taken off.
 */
const KNOWN_HIGH = new Map<string, string>([
  [
    'naboo: Lake Retreat Shuttleport',
    "a ridge up to 375 m over the pad stands on the landing's own line 300 to 1000 m behind its join, which is 127 m up: held clear over it the hull dives at 35 degrees, still comes to the join 34 m high and goes round once, as its pad-to-pad trips there do",
  ],
]);

type DownRow = { label: string; pad: string; byTicket: boolean; f: ReturnType<typeof flyCourse>; within: boolean; raised: number };
const downRows: DownRow[] = [];
for (const p of arrivals) {
  const g = groundOf(p.pack);
  if (!g) continue;
  if (p.pack !== lastPack) {
    grounds.get(lastPack)?.sampler.invalidateAll();
    lastPack = p.pack;
    console.log(`${p.pack} (crossings down)...`);
  }
  const floor = g.at(p.cut.pos.x, p.cut.pos.z) + RIDE_TUNE.downClear;
  const raised = Math.max(0, floor - p.cut.pos.y);
  const pair = raised > 0 ? { ...p, cut: { ...p.cut, pos: p.cut.pos.clone().setY(floor) } } : p;
  const f = flyCourse(pair, g.at, { startGround: undefined });
  const within = f.joined && Math.abs(f.error.across) <= tol.across && Math.abs(f.error.up) <= tol.up && f.error.heading <= tol.heading;
  downRows.push({ label: p.label, pad: `${p.pack}: ${p.to.port || p.to.key}`, byTicket: p.byTicket, f, within, raised });
}
/** Whether a crossing down flew as it must: met its join, went round nowhere, turned nowhere, and never dived more than a degree past the steepest allowed. */
const flownWell = (r: DownRow) => r.within && r.f.goArounds === 0 && r.f.flownTurn <= 90 && r.f.diveOver <= 1;
const downUnder = downRows.filter((r) => r.f.under > 0);
const downLong = downRows.filter((r) => r.f.course > 1.15 * r.f.straight || r.f.courseTurn > 90);
const ticketed = downRows.filter((r) => r.byTicket);
const downFailing = ticketed.filter((r) => !flownWell(r) && !KNOWN_HIGH.has(r.pad));
const downKnown = ticketed.filter((r) => KNOWN_HIGH.has(r.pad));
const untried = [...KNOWN_HIGH.keys()].filter((pad) => !only || pad.startsWith(`${only}: `)).filter((pad) => !ticketed.some((r) => r.pad === pad));
const maxOf = (xs: number[]) => (xs.length ? Math.max(...xs) : 0);
console.log(`\n${downRows.length} crossings down flown over the real ground, ${ticketed.length} of them ones a ticket makes (the rig a starport stands); ${downRows.filter((r) => r.raised > 0).length} came out raised over the ground there (most ${n1(maxOf(downRows.map((r) => r.raised)))} m)`);
console.log(`course against the straight line: max ${n1(maxOf(downRows.map((r) => r.f.course / r.f.straight)))}x; planned turn at most ${n1(maxOf(downRows.map((r) => r.f.courseTurn)))}°`);
console.log(`of those a ticket makes: ${ticketed.filter(flownWell).length} of ${ticketed.length} flown in as they must be; met the join ${ticketed.filter((r) => r.within).length}; flown round again ${ticketed.filter((r) => r.f.goArounds).length}; flown turn at most ${n1(maxOf(ticketed.map((r) => r.f.flownTurn)))}°; steepest dive ${n1(maxOf(ticketed.map((r) => r.f.steepest)))}° (${n1(maxOf(ticketed.filter(flownWell).map((r) => r.f.steepest)))}° of those flown in as they must be)`);
console.log(`under the ground beyond 600 m of the pad: ${downUnder.length} flights; longer than the straight run by 15% or turning more than 90° as planned: ${downLong.length}`);
const line = (r: DownRow) => `${r.label}: across ${n1(r.f.error.across)}, up ${n1(r.f.error.up)}, heading ${n1(r.f.error.heading)}, round again ${r.f.goArounds}, flown turn ${n1(r.f.flownTurn)}°, steepest ${n1(r.f.steepest)}°, under ${n1(r.f.under)} s, raised ${n1(r.raised)} m, ${r.f.joined ? 'joined' : 'never joined'}`;
for (const r of downUnder.slice(0, 12)) console.log(`   under the ground: ${line(r)}`);
for (const r of downFailing.slice(0, 12)) console.log(`   not flown in as it must be: ${line(r)}`);
for (const r of downKnown) console.log(`   ${flownWell(r) ? 'known to miss, but flown in as it must be now (take it off KNOWN_HIGH)' : 'known miss'}: ${line(r)}\n      (${KNOWN_HIGH.get(r.pad)})`);
for (const pad of untried) console.log(`   known miss not flown this run (no ticketed crossing down onto it): ${pad}`);
const unticketed = downRows.filter((r) => !r.byTicket && !flownWell(r));
if (unticketed.length) console.log(`no ticket flies these, so they are shown and not judged: ${unticketed.length}`);
for (const r of unticketed.slice(0, 12)) console.log(`   ${line(r)}`);
const pass = joined.length >= rows.length - 14 && under.length === 0 && downUnder.length === 0 && downLong.length === 0 && downFailing.length === 0;
console.log(pass ? '\nPASS' : '\nFAIL');
process.exit(pass ? 0 : 1);
