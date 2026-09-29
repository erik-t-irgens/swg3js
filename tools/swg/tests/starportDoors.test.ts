// The street in front of a starport, as the travellers of ours use it (step 10a): the first open ground
// of the walk grid out along a door's line (`firstOpenOut`), the strict reach ours ask (`sameRankedRegion`)
// and the nearest ground of one region about a point (`nearestRanked`).
//
// What is shown, and why each is worth showing:
//
//   1. The three rules on a drawn grid: the first open point along a line and never a blocked cell or a
//      building's footprint (a small walled region is open, and not ranked); nothing with no grid, or with
//      none in reach; the strict reach refusing whatever the general one waves through; the nearest ground
//      of a region found in rings, and only of that region when one is asked for.
//   2. Over the real Tatooine grid at all four starports: every way out of every starport has open ground
//      two and a half to four and a half metres out from its middle as measured, the town's ranked region
//      outside every street door and the walled pads' small one outside the others, while every door's own
//      outside step -- where an arrival's reach used to be measured from -- is the footprint, where the
//      general reach can say nothing of anything.
//   3. At Mos Eisley's own starport: the street door's first open ground is the town's ranked region; the
//      old rule, measured from the doorstep, would have sent arrivals to spots of the lumped regions it
//      could not judge; the cantinas' and hotels' doorsteps near it are the buildings' footprints, which the
//      grid plans no way to; and the corners the grid hands a point walked from the street to a cantina, with
//      a corner dropped on its reach alone and with `OUTDOOR_AGENT.sight`, which ships off.
//
// What the runner itself does with all of this -- where it sends an arrival and stands a departure at every
// port on every converted world, a stalled walk, a filler sent round the clutter -- is driven through the
// runner in `oursStreet.test.ts`.
//
// Run: node tools/swg/tests/starportDoors.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import * as THREE from 'three';
import { ROUTINE_TUNE, firstOpenOut, nearestRanked, openRegion, rankedRegion, sameRankedRegion, type OpenOut } from '../../../src/world/ambient/routines.ts';
import { LIFT_CELL } from '../../../src/world/lifts.ts';
import { DOOR_TUNE, exitsFrom } from '../../../src/world/nav/doorway.ts';
import { buildRoomGraph, type CellDef, type PortalDef } from '../../../src/world/nav/navRooms.ts';
import { NAV_RANKS } from '../../../src/world/nav/outdoorGrid.ts';
import { NavAgent } from '../../../src/world/nav/navAgent.ts';
import { OUTDOOR_AGENT, OutdoorNav } from '../../../src/world/nav/outdoorNav.ts';
import { portsOf, type PoiRow } from '../../../src/world/shuttle.ts';
import { travelThingsOf, type TravelRow } from '../../../src/world/travelTerminal.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}
const f1 = (n: number): string => n.toFixed(1);

// ---------------------------------------------------------------- 1: on a drawn grid

{
  // A strip of ground along +x: the doorstep's footprint (15) for 2 m, blocked steps (0) for 1 m, then
  // ranked region 3; along -x the same footprint and steps, then a lumped small region (14), a walled pad;
  // and region 5 off to one side.
  const region = (x: number, z: number): number => (z > 20 ? 5 : Math.abs(x) < 2 ? 15 : Math.abs(x) < 3 ? 0 : x < 0 ? 14 : 3);
  const door = { outX: 0, outZ: 0, dirX: 1, dirZ: 0 };
  const o: OpenOut = { x: NaN, z: NaN, d: NaN, region: -1 };
  ok(firstOpenOut(door, region, o, 8, 0.5) && o.d === 3 && o.region === 3 && o.x === 3 && o.z === 0, `1: the first open ground along a door's line: past the footprint and the steps, ${o.d} m out in region ${o.region}`);
  const pads: OpenOut = { x: NaN, z: NaN, d: NaN, region: -1 };
  ok(firstOpenOut({ outX: 0, outZ: 0, dirX: -1, dirZ: 0 }, region, pads, 8, 0.5) && pads.d === 3 && pads.region === 14 && openRegion(14) && !rankedRegion(14), "... open ground of a small walled region too (a starport's pads), which is open and not ranked");
  const none: OpenOut = { x: 7, z: 7, d: 7, region: 7 };
  ok(!firstOpenOut(door, region, none, 2.5, 0.5) && none.x === 7 && none.region === 7, '... none within a shorter reach, and nothing written');
  ok(!firstOpenOut(door, () => -1, none, 8) && !firstOpenOut(door, region, none, 0), '... nor with no grid at all, nor with the reach switched off (`clearOut` 0), which leave the old ways');
  ok(rankedRegion(1) && rankedRegion(NAV_RANKS) && !rankedRegion(0) && !rankedRegion(14) && !rankedRegion(15) && !rankedRegion(-1), `a ranked region is one of 1 to ${NAV_RANKS}: not blocked, not the lumped small ones, not a footprint`);
  ok(openRegion(1) && openRegion(14) && !openRegion(0) && !openRegion(15) && !openRegion(-1), '... and open ground is those and the lumped small ones');
  ok(sameRankedRegion(3, 3) && !sameRankedRegion(3, 5) && !sameRankedRegion(14, 14) && !sameRankedRegion(3, 15) && !sameRankedRegion(0, 0), 'the strict reach: both ends in one ranked region, and never two lumped or blocked ones');
  const near: OpenOut = { x: 0, z: 0, d: 0, region: 0 };
  ok(nearestRanked(1, 0, region, 0, 8, near) && near.region === 3 && near.d === 2, `the nearest ranked ground about a point, in rings a metre apart: ${near.d} m off in region ${near.region}`);
  ok(nearestRanked(1, 15, region, 5, 8, near) && near.region === 5 && nearestRanked(10, 0, region, 3, 8, near) && near.d === 0, '... of the one region asked for, and the point itself when it is on it');
  ok(!nearestRanked(1, 0, region, 9, 8, near) && !nearestRanked(1, 0, () => -1, 0, 8, near), '... and none of a region nowhere near, or with no grid');
  ok(ROUTINE_TUNE.clearOut === 8 && ROUTINE_TUNE.replanOnce === true && ROUTINE_TUNE.letGoOffScreen === true, "the switches ship on: open ground found to 8 m out, one more try before a let-go, and a let-go only off the screen");
  ok(OUTDOOR_AGENT.sight === 0, "and the corner rule every body outdoors walks by ships as it was (`OUTDOOR_AGENT.sight` 0, the switch `navSightAdvance` off): the one-street trial of the other did not get one arrival more through, and it would change every creature, person and fighter out of doors");
}

// ---------------------------------------------------------------- 2 and 3: the real Tatooine grid

const packs = join(process.cwd(), 'assets-private', 'tatooine');
const files = ['nav.json', 'nav.bin', 'layout.json', 'manifest.json', 'travel.json', 'pois.json'];
if (!files.every((f) => existsSync(join(packs, f)))) note(`tatooine is not converted with ${files.join(', ')}, so the starports' doors are not measured: npm run swg -- navgrid tatooine assets-private`);
else {
  const nav = new OutdoorNav();
  ok(nav.adopt('tatooine', JSON.parse(readFileSync(join(packs, 'nav.json'), 'utf8')), new Uint8Array(inflateRawSync(readFileSync(join(packs, 'nav.bin'))))), "Tatooine's walk grid is adopted as the game adopts it");
  const region = (x: number, z: number): number => nav.region(x, z);
  const layout = JSON.parse(readFileSync(join(packs, 'layout.json'), 'utf8')) as { center: { x: number; z: number }; objects: { model: string; template: string; x: number; y: number; z: number; q: number[]; contained?: boolean }[] };
  const manifest = JSON.parse(readFileSync(join(packs, 'manifest.json'), 'utf8')) as { categories: Record<string, { id: string; cells?: CellDef[]; portals?: PortalDef[] }[]> };
  const MODEL = 'mun_tato_starport_s01_u01';
  let def: { cells?: CellDef[]; portals?: PortalDef[] } | undefined;
  for (const list of Object.values(manifest.categories)) for (const d of list) if (d.id === MODEL) def = d;
  const c = layout.center;
  const placed = layout.objects.filter((o) => o.model === MODEL && !o.contained);
  const graph = buildRoomGraph(def?.cells, def?.portals, (cell) => LIFT_CELL.test(cell.name ?? ''));
  /** Each starport's ways out, as the game's doorway join works them out, with the unit way out through each. */
  const starports = placed.map((o) => {
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(-(o.x - c.x), o.y, o.z - c.z), new THREE.Quaternion(o.q[1], -o.q[2], -o.q[3], o.q[0]), new THREE.Vector3(1, 1, 1));
    const exits = exitsFrom(graph, def?.portals, matrix, DOOR_TUNE.step).map((e) => {
      const l = Math.hypot(e.outX - e.inX, e.outZ - e.inZ) || 1;
      return { ...e, dirX: (e.outX - e.inX) / l, dirZ: (e.outZ - e.inZ) / l };
    });
    return { x: -(o.x - c.x), z: o.z - c.z, exits };
  });
  const doors = starports.flatMap((s) => s.exits);
  const rows: string[] = [];
  let off = 0;
  let bad = '';
  let streets = 0;
  let stepOff = 0;
  let badStreet = '';
  for (const e of doors) {
    const o: OpenOut = { x: 0, z: 0, d: 0, region: -1 };
    // Out from the door's own middle, which is what was measured: its outside point stands a step past it.
    const found = firstOpenOut(e, region, o);
    const out = found ? (o.x - e.x) * e.dirX + (o.z - e.z) * e.dirZ : NaN;
    rows.push(found ? `${f1(out)} m (${o.region})` : 'none');
    if (!found || !openRegion(o.region) || !nav.walkable(o.x, o.z) || !(out >= 2 && out <= 5)) bad = `door at ${f1(e.x)},${f1(e.z)}: ${rows.at(-1)}`;
    // The street door, onto the foyer (room 1): its open ground is the town's, a ranked region.
    if (e.room === 1) {
      streets++;
      if (!found || !rankedRegion(o.region)) badStreet = `door at ${f1(e.x)},${f1(e.z)}: ${rows.at(-1)}`;
    }
    const oldX = e.outX + e.dirX * ROUTINE_TUNE.outside;
    const oldZ = e.outZ + e.dirZ * ROUTINE_TUNE.outside;
    if (!openRegion(region(oldX, oldZ))) off++;
    if (!openRegion(region(e.outX, e.outZ))) stepOff++;
  }
  ok(starports.length === 4 && doors.length === 12, `2: the four starports of Tatooine have ${doors.length} ways out between them, three each: the street door and two onto the walled pads`);
  ok(!bad, `every one has open ground straight out from it, 2.5 to 4.5 m from its middle as measured (give or take the half-metre it is sought in), after its footprint and its steps (${rows.join(', ')}, by region)${bad ? `: not ${bad}` : ''}`);
  ok(streets === 4 && !badStreet, `... and every street door's is the town's own ranked region, which an arrival's walk can be judged from${badStreet ? `: not ${badStreet}` : ''}`);
  ok(stepOff === doors.length && off >= 3, `... while every door's own outside step, which an arrival's reach was measured from, is off open ground (${stepOff} of ${doors.length}), where the general reach answers yes to everything, and so is the point ${ROUTINE_TUNE.outside} m past it where a departure used to be stood at ${off} of them`);

  // Mos Eisley's own starport: its street door and its pad door, as the port's plan picks them.
  const pois = JSON.parse(readFileSync(join(packs, 'pois.json'), 'utf8')) as { center: { x: number; z: number }; pois?: PoiRow[] };
  const travel = JSON.parse(readFileSync(join(packs, 'travel.json'), 'utf8')) as { rows: TravelRow[] };
  const port = portsOf(pois.pois ?? [], pois.center).find((p) => p.name === 'Mos Eisley Starport');
  const things = travelThingsOf(travel.rows, pois.center);
  const here = port ? starports.reduce((a, b) => (Math.hypot(a.x - port.x, a.z - port.z) < Math.hypot(b.x - port.x, b.z - port.z) ? a : b)) : null;
  const mine = here ? things.filter((t) => Math.hypot(t.bx - here.x, t.bz - here.z) < 2) : [];
  const collector = mine.find((t) => t.kind === 'collector');
  const terminal = mine.find((t) => t.kind === 'terminal' && t.cell > 0);
  if (!here || !collector || !terminal) note("Mos Eisley's starport, its collector or a terminal inside it is not found, so its street is not walked");
  else {
    const near = (a: { outX: number; outZ: number }, p: { x: number; z: number }): number => Math.hypot(a.outX - p.x, a.outZ - p.z);
    const padDoor = here.exits.reduce((a, b) => (near(a, collector) <= near(b, collector) ? a : b));
    const others = here.exits.filter((e) => e !== padDoor);
    const street = others.reduce((a, b) => (near(a, terminal) <= near(b, terminal) ? a : b));
    const open: OpenOut = { x: 0, z: 0, d: 0, region: -1 };
    ok(firstOpenOut(street, region, open) && rankedRegion(open.region), `3: at Mos Eisley the street door's first open ground is ${f1(open.d)} m past its outside step, in ranked region ${open.region}`);
    // What the old rule, measured from the doorstep and answering yes wherever either end is unranked, would
    // have let an arrival be sent to: rings 40 to 90 m out within the spread of the door's way. What the runner
    // sends arrivals to now is read off the runner itself in `oursStreet.test.ts`.
    const base = Math.atan2(street.dirX, street.dirZ);
    const was: number[] = [];
    for (let r = ROUTINE_TUNE.townWalk[0]; r <= ROUTINE_TUNE.townWalk[1]; r += 10) {
      for (let k = 0; k < 8; k++) {
        const a = base + (k / 8 - 0.5) * 2 * ROUTINE_TUNE.spread;
        const x = street.outX + Math.sin(a) * r;
        const z = street.outZ + Math.cos(a) * r;
        if (nav.walkable(x, z) && nav.reachable(street.outX, street.outZ, x, z)) was.push(region(x, z));
      }
    }
    const lumped = was.filter((r) => !rankedRegion(r)).length;
    ok(was.length > 0 && !rankedRegion(region(street.outX, street.outZ)), `the old rule, measured from the doorstep (region ${region(street.outX, street.outZ)}, where the general reach answers yes to everything), took ${was.length} of the ring's walkable spots, ${lumped} of them in the lumped regions it could not judge and ${was.filter((r) => rankedRegion(r) && r !== open.region).length} in another ranked region`);
    note(`Mos Eisley's street door stands at ${f1(street.x)},${f1(street.z)}`);
    // The cantinas and hotels an arrival makes for, each by its door nearest the pad, as `townDoors` picks it:
    // the goal is the open ground outside that door, never its doorstep, which is the building's footprint.
    const towns: string[] = [];
    let reached = 0;
    let doorsteps = 0;
    for (const o of layout.objects) {
      if (o.contained || !/cantina|hotel/i.test(o.template)) continue;
      const bx = -(o.x - c.x);
      const bz = o.z - c.z;
      if (Math.hypot(bx - here.x, bz - here.z) > ROUTINE_TUNE.town) continue;
      let tdef: { cells?: CellDef[]; portals?: PortalDef[] } | undefined;
      for (const list of Object.values(manifest.categories)) for (const d of list) if (d.id === o.model) tdef = d;
      if (!tdef?.cells) continue;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(bx, o.y, bz), new THREE.Quaternion(o.q[1], -o.q[2], -o.q[3], o.q[0]), new THREE.Vector3(1, 1, 1));
      const ways = exitsFrom(buildRoomGraph(tdef.cells, tdef.portals, (cell) => LIFT_CELL.test(cell.name ?? '')), tdef.portals, m, DOOR_TUNE.step);
      if (!ways.length) continue;
      const door = ways.reduce((a, b) => (Math.hypot(a.outX - collector.x, a.outZ - collector.z) <= Math.hypot(b.outX - collector.x, b.outZ - collector.z) ? a : b));
      const l = Math.hypot(door.outX - door.inX, door.outZ - door.inZ) || 1;
      const line = { outX: door.outX, outZ: door.outZ, dirX: (door.outX - door.inX) / l, dirZ: (door.outZ - door.inZ) / l };
      const t: OpenOut = { x: 0, z: 0, d: 0, region: -1 };
      const found = firstOpenOut(line, region, t);
      if (!openRegion(region(door.outX + line.dirX * 0.5, door.outZ + line.dirZ * 0.5))) doorsteps++;
      if (found && sameRankedRegion(open.region, t.region)) reached++;
      towns.push(`${o.model.replace(/^[a-z]+_[a-z]+_/, '')} ${found ? `${f1(t.d)} m (${t.region})` : 'none'}`);
    }
    ok(towns.length > 0 && reached > 0, `of the ${towns.length} cantinas and hotels within ${ROUTINE_TUNE.town} m, ${reached} have open ground outside their door in the street's region, which an arrival is sent to and finished on (${towns.join(', ')})`);
    ok(doorsteps > 0, `... while ${doorsteps} of their doorsteps, where arrivals used to be sent, are the buildings' footprints, which the walk grid plans no way to`);

    // The corners the grid hands (`OutdoorNav.corner`), a point with no size and no physics walked straight
    // at each at a walking pace: from the street's open ground to the cantina's. With a corner dropped on
    // `reach` alone, the path's tight turn round the junk in the street lost its turning corner three metres
    // short and the point cut across cells the grid calls blocked -- where every arrival at Mos Eisley was let
    // go (step 10's trace). Dropped only where the leg after it can be walked from where the body stands
    // (`OUTDOOR_AGENT.sight`), the legs stay on open cells. That is all this shows: in the game, with the
    // rule on, bodies stopped about 1.3 m short of the corner it kept and were let go at the same spot, so
    // the rule ships off and the trap wants the props' colliders put against the grid's bake.
    const cantina = (() => {
      for (const o of layout.objects) {
        if (o.contained || !/cantina/i.test(o.template)) continue;
        const bx = -(o.x - c.x);
        const bz = o.z - c.z;
        if (Math.hypot(bx - here.x, bz - here.z) > ROUTINE_TUNE.town) continue;
        let tdef: { cells?: CellDef[]; portals?: PortalDef[] } | undefined;
        for (const list of Object.values(manifest.categories)) for (const d of list) if (d.id === o.model) tdef = d;
        if (!tdef?.cells) continue;
        const m = new THREE.Matrix4().compose(new THREE.Vector3(bx, o.y, bz), new THREE.Quaternion(o.q[1], -o.q[2], -o.q[3], o.q[0]), new THREE.Vector3(1, 1, 1));
        const ways = exitsFrom(buildRoomGraph(tdef.cells, tdef.portals, (cell) => LIFT_CELL.test(cell.name ?? '')), tdef.portals, m, DOOR_TUNE.step);
        if (!ways.length) continue;
        const door = ways.reduce((a, b) => (Math.hypot(a.outX - collector.x, a.outZ - collector.z) <= Math.hypot(b.outX - collector.x, b.outZ - collector.z) ? a : b));
        const l = Math.hypot(door.outX - door.inX, door.outZ - door.inZ) || 1;
        const t: OpenOut = { x: 0, z: 0, d: 0, region: -1 };
        if (firstOpenOut({ outX: door.outX, outZ: door.outZ, dirX: (door.outX - door.inX) / l, dirZ: (door.outZ - door.inZ) / l }, region, t)) return t;
      }
      return null;
    })();
    if (!cantina) note('no cantina with open ground outside its door near Mos Eisley starport, so the walk to it is not taken');
    else {
      /** A body walked at 1.3 m/s toward whatever corner the grid hands it (the goal itself with none): how many of its steps ended off open ground, and whether it got there. */
      const walkTo = (sight: number): { blocked: number; arrived: boolean; seconds: number } => {
        const was = OUTDOOR_AGENT.sight;
        OUTDOOR_AGENT.sight = sight;
        try {
          const agent = new NavAgent();
          let x = open.x;
          let z = open.z;
          let blocked = 0;
          for (let s = 0; s < 3000; s++) {
            const now = s * 0.1;
            if (Math.hypot(cantina.x - x, cantina.z - z) <= ROUTINE_TUNE.reach) return { blocked, arrived: true, seconds: now };
            const k = nav.corner(agent, x, 0, z, cantina.x, 0, cantina.z, 0.38, now);
            const tx = k ? k.x : cantina.x;
            const tz = k ? k.z : cantina.z;
            const d = Math.hypot(tx - x, tz - z);
            if (d > 1e-6) {
              const step = Math.min(d, 0.13);
              x += ((tx - x) / d) * step;
              z += ((tz - z) / d) * step;
            }
            if (!openRegion(region(x, z))) blocked++;
          }
          return { blocked, arrived: false, seconds: Infinity };
        } finally {
          OUTDOOR_AGENT.sight = was;
        }
      };
      const old = walkTo(0);
      const seen = walkTo(1);
      ok(old.blocked > 0, `... with a corner dropped on its reach alone, a point walked at the corners the grid hands it cuts through ground the grid calls blocked on its way to the cantina (${old.blocked} tenths of a second off open ground): where the junk every arrival was stuck in stands`);
      ok(seen.blocked === 0, `and dropped only where the leg after it can be walked from where the point stands, every leg it is handed stays on open cells (${seen.arrived ? `${f1(seen.seconds)} s to the cantina's ground` : 'never reaching it'}); not, by itself, that a body with a size gets past what stands there`);
    }
  }
}

console.log(`\nstarport doors: ${passed} checks passed`);
