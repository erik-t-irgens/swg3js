// The travellers of ours in the street (step 10a), driven through the runner itself (`AmbientPeople`,
// src/world/ambient/ambientPeople.ts) over the converted worlds' own walk grids, ports and buildings: its
// own port plan, its own choice of where an arrival walks and where a departure is first stood, its own
// pass over a traveller whose walk has stalled, and a filler sent round the clutter it stalled in. Nothing
// here re-derives the runner's arithmetic; what the runner answers is read back and held to.
//
// What is shown, and why each is worth showing:
//
//   1. Every port with a shuttle on every converted world plans, and every arrival drawn for it has
//      somewhere to walk to. The strict reach ours ask (both ends in one ranked region) is judged from open
//      ground the arrival really stands on: past a starport's street door, and at a pad out in the open
//      the ranked ground nearest its ramp, since a shuttleport's pad is blocked ground for metres round.
//      Where no such ground is near enough to say, the general rule it always had: a strict rule with
//      nothing to be strict from refused every arrival at 29 of the 30 open pads on the converted worlds.
//   2. Where the strict rule is used, every arrival's goal is in the ranked region of the ground it is judged
//      from, and on open ground; a cantina or a hotel is made for at the open ground outside its door and
//      then walked in at its doorstep; and every departure coming in from the street is first stood on the
//      street's open ground (the first two to four and a half metres outside every Tatooine starport door are
//      the building's footprint or its steps).
//   3. At Mos Eisley's starport, an arrival walked goal to goal: by the pads' door, through the terminals'
//      room, out of the street door onto the open ground, to the open ground outside a cantina's door and on
//      to its doorstep, where it goes in -- never finished in the open street short of the door.
//   4. A walk that stalls is sent once more and then let go, and let go only while nobody sees it, or after
//      `letGoWait` held in view; an arrival finished where there is no door is held while it is seen.
//   5. A filler coming in by a door whose walk stalls off open ground is sent round by the nearest ranked
//      ground and then on to its own place indoors (it once asked for a port it has not got and threw out
//      of the world's update).
//   6. The `clearOut` switch flipped in play takes effect for the next traveller stood, both ways.
//
// Every doorway is taken to stand on the ground (the terrain is not generated here), and a shuttle's ramp
// is taken as six metres off its pad toward the collector, as the runner's own fallback for a shuttle
// standing as its still model has it; a rig's real ramp is within a few metres of that.
//
// Run: node tools/swg/tests/oursStreet.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import * as THREE from 'three';
import { AmbientPeople, type AmbientDeps, type AmbientPort } from '../../../src/world/ambient/ambientPeople.ts';
import { FILLER_TUNE } from '../../../src/world/ambient/fillers.ts';
import { ROUTINE_TUNE, newHeadway, openRegion, rankedRegion, type TravellerPlan } from '../../../src/world/ambient/routines.ts';
import { LIFT_CELL } from '../../../src/world/lifts.ts';
import { DOOR_TUNE, exitsFrom, type DoorExit } from '../../../src/world/nav/doorway.ts';
import { buildRoomGraph, type CellDef, type PortalDef } from '../../../src/world/nav/navRooms.ts';
import { OutdoorNav } from '../../../src/world/nav/outdoorNav.ts';
import { portsOf, type PoiRow } from '../../../src/world/shuttle.ts';
import { travelThingsOf, type TravelRow, type TravelThing } from '../../../src/world/travelTerminal.ts';

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

// ---------------------------------------------------------------- the runner's insides, as the test reads them

interface Goal {
  x: number;
  z: number;
  stepX: number;
  stepZ: number;
  hold: boolean;
}
interface Place {
  x: number;
  y: number;
  z: number;
  building: unknown;
  room: number;
}
interface Plan {
  ready: boolean;
  why: string;
  port: AmbientPort;
  building: FakeBuilding | null;
  streetDoor: { outX: number; outZ: number; dirX: number; dirZ: number } | null;
  street: { x: number; z: number; d: number; region: number } | null;
  towns: (Goal & { region: number })[];
  board: Place | null;
  terminals: { room: number }[];
}
interface Rec {
  id: string;
  kind: string;
  body: FakeBody;
  walk: { going: boolean; goal: { x: number; z: number }; building: unknown; room: number };
  dest: Goal | null;
  out: boolean;
  via: unknown;
  through: boolean;
  doorstep: boolean;
  detour: { x: number; z: number } | null;
  replanned: boolean;
  fill: unknown;
}
interface Runner {
  ports: Plan[];
  records: Map<string, Rec>;
  tally: AmbientPeople['tally'];
  planPort(pp: Plan, now: number, deps: AmbientDeps): void;
  destination(pp: Plan, p: TravellerPlan, deps: AmbientDeps): Goal | null;
  originOf(pp: Plan, door: Plan['streetDoor'], deps: AmbientDeps): { x: number; z: number; d: number; region: number } | null;
  comeFrom(pp: Plan, p: TravellerPlan, deps: AmbientDeps): Place | null;
  standTraveller(pp: Plan, p: TravellerPlan, stage: string, standUntil: number, now: number, seconds: number, cat: unknown, deps: AmbientDeps): boolean;
  standFiller(f: unknown, i: number, now: number, cat: unknown, deps: AmbientDeps): boolean;
  walkOne(r: Rec, now: number, seconds: number, at: THREE.Vector3, deps: AmbientDeps): void;
}

// ---------------------------------------------------------------- a world, as the runner's deps see it

interface FakeBuilding {
  template: string;
  x: number;
  z: number;
  radius: number;
  model: { def: { id: string; cells?: CellDef[]; portals?: PortalDef[] }; bounds: THREE.Box3 };
  matrix: THREE.Matrix4;
  inverse: THREE.Matrix4;
  exits: DoorExit[];
}

/** A body as the runner reads one: where it is, whether it can move and whether it is drawn on the screen. */
class FakeBody {
  readonly pos = new THREE.Vector3();
  removed = false;
  dead = false;
  ready = true;
  tier: { name: string; move: boolean } = { name: 'near', move: true };
  seated = false;
  inside = false;
  room = 0;
  stepLifts = 0;
  stuckEvents = 0;
  seatedIdleOnly = false;
  routine: unknown = null;
  /** Being spoken to (`Mobile.listening`): the point it faces while the conversation lasts. */
  listening: { x: number; z: number } | null = null;
  readonly entry = { id: 'person' };
  readonly legs = { phase: 0 };
  cleared = 0;
  readonly navAgent = { clear: () => void this.cleared++ };
  sit(): void {
    this.seated = true;
  }
  rise(): void {
    this.seated = false;
  }
}

interface World {
  name: string;
  nav: OutdoorNav;
  things: TravelThing[];
  ports: ReturnType<typeof portsOf>;
  buildings: FakeBuilding[];
  deps: AmbientDeps;
  bodies: FakeBody[];
}

function loadWorld(dir: string, name: string): World | null {
  const need = ['nav.json', 'nav.bin', 'travel.json', 'pois.json', 'layout.json', 'manifest.json'];
  if (!need.every((f) => existsSync(join(dir, f)))) return null;
  const nav = new OutdoorNav();
  if (!nav.adopt(name, JSON.parse(readFileSync(join(dir, 'nav.json'), 'utf8')), new Uint8Array(inflateRawSync(readFileSync(join(dir, 'nav.bin')))))) return null;
  const travel = JSON.parse(readFileSync(join(dir, 'travel.json'), 'utf8')) as { rows: TravelRow[] };
  const pois = JSON.parse(readFileSync(join(dir, 'pois.json'), 'utf8')) as { center: { x: number; z: number }; pois?: PoiRow[] };
  const layout = JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf8')) as { center: { x: number; z: number }; objects: { model: string; template: string; x: number; y: number; z: number; q: number[]; radius?: number; contained?: boolean }[] };
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { categories: Record<string, { id: string; cells?: CellDef[]; portals?: PortalDef[] }[]> };
  const defs = new Map<string, { id: string; cells?: CellDef[]; portals?: PortalDef[] }>();
  for (const list of Object.values(manifest.categories)) for (const d of list) defs.set(d.id, d);
  const c = layout.center;
  const buildings: FakeBuilding[] = [];
  for (const o of layout.objects) {
    if (o.contained) continue;
    const def = defs.get(o.model);
    if (!def?.cells?.length || !def.portals?.length) continue;
    const x = -(o.x - c.x);
    const z = o.z - c.z;
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, o.y, z), new THREE.Quaternion(o.q[1], -o.q[2], -o.q[3], o.q[0]), new THREE.Vector3(1, 1, 1));
    const radius = o.radius ?? 20;
    const exits = exitsFrom(buildRoomGraph(def.cells, def.portals, (cell) => LIFT_CELL.test(cell.name ?? '')), def.portals, matrix, DOOR_TUNE.step);
    buildings.push({ template: o.template, x, z, radius, model: { def, bounds: new THREE.Box3(new THREE.Vector3(-radius, -radius, -radius), new THREE.Vector3(radius, radius, radius)) }, matrix, inverse: matrix.clone().invert(), exits });
  }
  const bodies: FakeBody[] = [];
  const entry = { id: 'person' };
  const deps = {
    catalogue: () => ({ byId: () => entry }),
    spawn: (_e: unknown, at: { x: number; z: number; y?: number }, how: { inside: boolean; room?: number }) => {
      const b = new FakeBody();
      b.pos.set(at.x, at.y ?? 0, at.z);
      b.inside = how.inside;
      b.room = how.room ?? 0;
      bodies.push(b);
      return b;
    },
    remove: (m: FakeBody) => void (m.removed = true),
    held: () => false,
    world: () => name,
    seconds: () => 10,
    buildings: () => buildings,
    buildingAt: (x: number, z: number) => buildings.find((b) => Math.abs(b.x - x) < 1 && Math.abs(b.z - z) < 1) ?? null,
    containedNear: () => 0,
    cellAt: () => 0,
    exits: (b: FakeBuilding) => b.exits,
    floor: () => null,
    // Every doorway is taken to stand on the ground: the terrain is not generated here.
    groundAt: () => Number.NaN,
    walkable: (x: number, z: number) => nav.walkable(x, z) && !nav.indoors(x, z),
    reachable: (x: number, z: number, gx: number, gz: number) => nav.reachable(x, z, gx, gz),
    region: (x: number, z: number) => nav.region(x, z),
    cellReady: () => true,
    floorsAt: () => [0],
    memory: () => ({ used: 0, budget: 0 }),
    cost: () => 0,
    people: {
      inWorld: true,
      essentialUp: 0,
      last: { shortBytes: 0, pass: 0 },
      townDraw: () => [['person', 1]],
      drawPerson: () => ({ id: 'person', who: 'somebody', creature: null }),
      anyStanding: () => false,
    },
    peopleDeps: () => ({}),
  } as unknown as AmbientDeps;
  const things = travelThingsOf(travel.rows, pois.center);
  return { name, nav, things, ports: portsOf(pois.pois ?? [], pois.center), buildings, deps, bodies };
}

/** A world's ports with a shuttle, as the game hands them to the runner (`App.ambientPortsOf`), the ramp six metres off the pad toward whoever asks. */
function portsFor(w: World): AmbientPort[] {
  const out: AmbientPort[] = [];
  for (const t of w.things) {
    if (t.kind !== 'shuttle') continue;
    const same = w.things.filter((o) => o.bx === t.bx && o.bz === t.bz);
    const c = same.find((o) => o.kind === 'collector') ?? null;
    let name = `${Math.round(t.bx)},${Math.round(t.bz)}`;
    let best = 300;
    for (const p of w.ports) {
      const d = Math.hypot(p.x - t.bx, p.z - t.bz);
      if (d < best) {
        best = d;
        name = p.name;
      }
    }
    out.push({
      name,
      clock: `${w.name}|${name}`,
      times: null,
      pad: { x: t.x, y: t.y, z: t.z, yaw: t.yaw, cell: t.cell },
      collector: c ? { x: c.x, y: c.y, z: c.z, yaw: c.yaw, cell: c.cell } : null,
      terminals: same.filter((o) => o.kind === 'terminal').map((o) => ({ x: o.x, y: o.y, z: o.z, yaw: o.yaw, cell: o.cell })),
      bx: t.bx,
      bz: t.bz,
      boarding: (towards, into) => {
        const d = Math.hypot(towards.x - t.x, towards.z - t.z) || 1;
        return into.set(t.x + ((towards.x - t.x) / d) * 6, t.y, t.z + ((towards.z - t.z) / d) * 6);
      },
    });
  }
  return out;
}

const plan = (kind: 'arrive' | 'depart', over: Partial<TravellerPlan> = {}): TravellerPlan => ({ kind, round: 1, index: 0, seed: 7, appearAt: 0, stand: 8, terminal: kind === 'depart' ? 0 : -1, door: 0.1, spot: 0.3, far: 0.5, wait: 100, leave: 200, ...over });

/** Every arrival a port can draw, as `spot`, `far` and `door` range over what the round draws them from. */
function draws(): TravellerPlan[] {
  const out: TravellerPlan[] = [];
  for (const door of [0.1, 0.9]) for (let s = 0; s < 16; s++) for (const far of [0, 0.25, 0.5, 0.75, 1]) out.push(plan('arrive', { door, spot: s / 16 + 1 / 32, far }));
  return out;
}

// ---------------------------------------------------------------- 1 and 2: every port on every converted world

FILLER_TUNE.build = -1e9; // nobody stood in a building of ours here: the travellers are what is driven
const root = join(process.cwd(), 'assets-private');
const worlds: World[] = [];
if (existsSync(root)) {
  for (const name of readdirSync(root)) {
    const w = loadWorld(join(root, name), name);
    if (w) worlds.push(w);
  }
}
if (!worlds.length) note('no world is converted with its walk grid, travel, pois, layout and manifest, so the runner is not driven over any: npm run swg -- navgrid <world> assets-private');
else {
  let portsSeen = 0;
  let planned = 0;
  let strictPorts = 0;
  let generalPorts = 0;
  let destinations = 0;
  const refused: string[] = [];
  const offRegion: string[] = [];
  const offOpen: string[] = [];
  const notPlanned: string[] = [];
  const general: string[] = [];
  let towns = 0;
  let townsWithStep = 0;
  let departures = 0;
  const departuresOff: string[] = [];
  for (const w of worlds) {
    const ap = new AmbientPeople();
    const run = ap as unknown as Runner;
    ap.usePorts(w.name, portsFor(w));
    for (const pp of run.ports) {
      portsSeen++;
      run.planPort(pp, 0, w.deps);
      const label = `${w.name} ${pp.port.name}`;
      if (!pp.ready) {
        notPlanned.push(`${label} (${pp.why})`);
        continue;
      }
      planned++;
      // The ground the runner judges from, as it answers: a street door's open ground, or for a pad out in
      // the open the ranked ground nearest the ramp; and every goal it then gives, held to that ground's region.
      const street = pp.building ? pp.street : null;
      const origin = run.originOf(pp, pp.building ? pp.streetDoor : null, w.deps);
      const all = draws().map((p) => run.destination(pp, p, w.deps));
      destinations += all.length;
      if (all.some((g) => g === null)) refused.push(label);
      const strictFrom = origin && rankedRegion(origin.region) ? origin.region : -1;
      if (!pp.building && origin && pp.board && Math.hypot(origin.x - pp.board.x, origin.z - pp.board.z) > 2 * ROUTINE_TUNE.clearOut + 1) offRegion.push(`${label}: judged from ${f1(Math.hypot(origin.x - pp.board.x, origin.z - pp.board.z))} m off its ramp`);
      if (strictFrom > 0) strictPorts++;
      else {
        generalPorts++;
        general.push(`${label}${pp.building ? ' (its street door has no ranked ground in reach)' : ` (pad region ${w.nav.region(pp.port.pad.x, pp.port.pad.z)}, no ranked ground within ${2 * ROUTINE_TUNE.clearOut} m of its ramp)`}`);
      }
      for (const g of all) {
        if (!g) continue;
        const r = w.nav.region(g.x, g.z);
        if (strictFrom > 0 && r !== strictFrom) offRegion.push(`${label}: ${f1(g.x)},${f1(g.z)} in region ${r}, not ${strictFrom}`);
        if (strictFrom > 0 && !openRegion(r)) offOpen.push(`${label}: ${f1(g.x)},${f1(g.z)}`);
        if (Number.isFinite(g.stepX) || pp.towns.includes(g as Goal & { region: number })) {
          towns++;
          if (Number.isFinite(g.stepX)) townsWithStep++;
        }
      }
      // A departure coming in from the street: the three of a round, a step to either side of each other.
      if (pp.building && pp.streetDoor && pp.terminals.some((t) => t.room > 0)) {
        for (let i = 0; i < 3; i++) {
          const at = run.comeFrom(pp, plan('depart', { index: i }), w.deps);
          departures++;
          const r = at ? w.nav.region(at.x, at.z) : -2;
          if (!at || !openRegion(r) || (street && rankedRegion(street.region) && r !== street.region)) departuresOff.push(`${label} #${i}: region ${r}`);
        }
      }
    }
  }
  ok(portsSeen > 0 && notPlanned.length === 0, `1: every port with a shuttle on the ${worlds.length} converted worlds is planned by the runner (${planned} of ${portsSeen})${notPlanned.length ? `: not ${notPlanned.join('; ')}` : ''}`);
  ok(refused.length === 0, `... and every one of the ${destinations} arrivals drawn for them has somewhere to walk to${refused.length ? `: none at ${refused.join(', ')}` : ''}`);
  ok(strictPorts > 0, `${strictPorts} ports judge an arrival's reach strictly, from open ground the arrival stands on; ${generalPorts} have no ranked ground near enough to judge from and keep the general rule (${general.join('; ') || 'none'})`);
  ok(offRegion.length === 0 && offOpen.length === 0, `2: where the strict rule is used, every goal is in the ranked region of the ground it is judged from, and on open ground${offRegion.length ? `: not ${offRegion.slice(0, 4).join('; ')}` : ''}${offOpen.length ? `; off open ground ${offOpen.slice(0, 4).join('; ')}` : ''}`);
  ok(towns > 0 && townsWithStep > 0, `... a cantina or a hotel is made for at the open ground outside its door, with its doorstep to walk on to (${townsWithStep} of the ${towns} goals at one)`);
  ok(departures > 0 && departuresOff.length === 0, `and every departure coming in from a starport's street is first stood on the street's own open ground (${departures} stood)${departuresOff.length ? `: not ${departuresOff.join('; ')}` : ''}`);
}

// ---------------------------------------------------------------- 3 to 6: at Mos Eisley's starport

const tat = worlds.find((w) => w.name === 'tatooine');
const tatPorts = tat ? portsFor(tat) : [];
const mosEisley = tatPorts.find((p) => p.name === 'Mos Eisley Starport' && p.terminals.some((t) => t.cell > 0));
if (!tat || !mosEisley) note("Tatooine or its starport at Mos Eisley is not converted with its walk grid and travel, so no traveller is walked there");
else {
  const deps = tat.deps;
  const region = (x: number, z: number): number => tat.nav.region(x, z);
  const fresh = (): { ap: AmbientPeople; run: Runner; pp: Plan } => {
    const ap = new AmbientPeople();
    const run = ap as unknown as Runner;
    ap.usePorts('tatooine', [mosEisley]);
    const pp = run.ports[0];
    run.planPort(pp, 0, deps);
    return { ap, run, pp };
  };
  const cat = { byId: () => ({ id: 'person' }) };
  const at = new THREE.Vector3(mosEisley.pad.x, 0, mosEisley.pad.z);
  const standArrival = (run: Runner, pp: Plan, over: Partial<TravellerPlan>): Rec => {
    const before = new Set(run.records.keys());
    assert.ok(run.standTraveller(pp, plan('arrive', over), 'enter', 0, 0, 10, cat, deps), 'an arrival is stood');
    const id = [...run.records.keys()].find((k) => !before.has(k))!;
    return run.records.get(id)!;
  };

  // 3: an arrival walked goal to goal, the body put on each goal it is given as it is given it.
  {
    const { run, pp } = fresh();
    const r = standArrival(run, pp, { door: 0.1, spot: 0.1 });
    const g = r.dest!;
    ok(Number.isFinite(g.stepX) && openRegion(region(g.x, g.z)) && !openRegion(region(g.stepX, g.stepZ)), `3: at Mos Eisley an arrival bound for a cantina or a hotel is sent to the open ground outside its door (region ${region(g.x, g.z)}), with its doorstep, the building's footprint on the grid (region ${region(g.stepX, g.stepZ)}), still to go`);
    const steps: string[] = [];
    let now = 0;
    for (let i = 0; i < 20 && run.records.has(r.id); i++) {
      const w = r.walk;
      const stage = r.via ? 'the pads door' : r.through ? 'the terminals' : r.out ? 'the street' : r.doorstep ? 'its doorstep' : 'the cantina';
      steps.push(stage);
      r.body.pos.set(w.goal.x, 0, w.goal.z);
      r.body.inside = w.building !== null;
      r.body.room = w.room;
      now += 0.5;
      run.walkOne(r, now, 10 + now, at, deps);
    }
    const walked = steps.filter((s, i) => i === 0 || steps[i - 1] !== s);
    ok(!run.records.has(r.id) && run.tally.arrived === 1 && walked.join(',') === 'the pads door,the terminals,the street,the cantina,its doorstep', `walked by the pads' door, through the terminals' room, out onto the street's open ground and on to the cantina's, it goes in at the doorstep and is finished there (${walked.join(' -> ')})`);
    ok(Math.hypot(r.body.pos.x - g.stepX, r.body.pos.z - g.stepZ) < 1e-6, '... where it vanishes: at the door, never in the open street short of it');
  }

  // 4: a walk that stalls, on screen and off it.
  for (const seen of [true, false]) {
    const { run, pp } = fresh();
    const r = standArrival(run, pp, { door: 0.9, spot: 0.4 });
    r.body.tier = { name: seen ? 'near' : 'hidden', move: true };
    let now = 0;
    let replannedAt = -1;
    let goneAt = -1;
    for (let i = 0; i < 1200 && run.records.has(r.id); i++) {
      now += 0.5;
      run.walkOne(r, now, 10 + now, at, deps);
      if (replannedAt < 0 && run.tally.replanned === 1) replannedAt = now;
      if (goneAt < 0 && !run.records.has(r.id)) goneAt = now;
    }
    const firstStall = ROUTINE_TUNE.giveUp;
    const held = goneAt - replannedAt;
    if (seen) {
      ok(replannedAt >= firstStall && replannedAt < firstStall + 1 && r.body.cleared === 1 && run.tally.letGo === 1 && run.tally.heldInView === 1 && held >= firstStall + ROUTINE_TUNE.letGoWait - 1, `4: a walk stalled in view is sent once more (at ${f1(replannedAt)} s, its route thrown away), and stalled again is held while it is seen, let go only ${f1(held - firstStall)} s later (letGoWait ${ROUTINE_TUNE.letGoWait})`);
    } else {
      ok(replannedAt >= firstStall && run.tally.replanned === 1 && run.tally.letGo === 1 && run.tally.heldInView === 0 && held >= firstStall && held < firstStall + 1, `... and one nobody can see is let go the moment it stalls again (${f1(held)} s after its second try began), and tried again only once`);
    }
  }
  // An arrival finished at a goal that is no door is held while it is seen.
  for (const seen of [true, false]) {
    const { run, pp } = fresh();
    const r = standArrival(run, pp, { door: 0.9, spot: 0.4 });
    r.via = null;
    r.through = false;
    r.out = false;
    const x = pp.street!.x;
    const z = pp.street!.z;
    r.dest = { x, z, stepX: Number.NaN, stepZ: Number.NaN, hold: true };
    r.walk.goal.x = x;
    r.walk.goal.z = z;
    r.body.pos.set(x, 0, z);
    r.body.tier = { name: seen ? 'far' : 'frozen', move: true };
    let now = 0;
    let goneAt = -1;
    for (let i = 0; i < 400 && run.records.has(r.id); i++) {
      now += 0.5;
      run.walkOne(r, now, 10 + now, at, deps);
      if (!run.records.has(r.id)) goneAt = now;
    }
    if (seen) ok(goneAt >= ROUTINE_TUNE.letGoWait && run.tally.arrived === 1, `an arrival finished where there is no door (nowhere it could surely reach, or the nearest it could after a stall) is held there while it is seen, at most ${ROUTINE_TUNE.letGoWait} s (${f1(goneAt)} s)`);
    else ok(goneAt === 0.5 && run.tally.arrived === 1, '... and finished at once off the screen');
  }

  // 5: a filler coming in by a door, stalled off open ground on its outside step.
  {
    const { run, pp } = fresh();
    // The nearest cantina or hotel with a way in whose outside step the grid calls the footprint, and open ground past it.
    let cantina: FakeBuilding | null = null;
    let e: DoorExit | null = null;
    let best = Infinity;
    for (const b of tat.buildings) {
      if (!/cantina|hotel/i.test(b.template)) continue;
      const d = Math.hypot(b.x - at.x, b.z - at.z);
      if (d >= best) continue;
      for (const x of b.exits) {
        const l = Math.hypot(x.outX - x.inX, x.outZ - x.inZ) || 1;
        const openPast = [1, 2, 3, 4, 5, 6].some((k) => openRegion(region(x.outX + ((x.outX - x.inX) / l) * k, x.outZ + ((x.outZ - x.inZ) / l) * k)));
        if (openRegion(region(x.outX, x.outZ)) || !openPast) continue;
        cantina = b;
        e = x;
        best = d;
        break;
      }
    }
    if (!cantina || !e) note('no cantina or hotel near Mos Eisley starport has a way in off open ground with open ground past it, so no filler is walked');
    else {
      const l = Math.hypot(e.outX - e.inX, e.outZ - e.inZ) || 1;
      const door = { outX: e.outX, outZ: e.outZ, dirX: (e.outX - e.inX) / l, dirZ: (e.outZ - e.inZ) / l };
      const spot = { x: e.inX, y: e.y, z: e.inZ, cell: e.room, seat: false, heading: 0, frontX: e.inX, frontZ: e.inZ };
      const f = { building: cantina, kind: 'cantina', seed: 3, empty: true, spots: [spot], doors: [door], draw: [['person', 1]], slots: [{ state: 'entering', life: 0, nextAt: 0, leaveAt: 1e9 }], bodies: [null], blocked: [false], active: true, why: '' };
      ok(run.standFiller(f, 0, 0, cat, deps), 'a filler coming in by a door is stood');
      const r = [...run.records.values()].find((x) => x.kind === 'filler')!;
      ok(openRegion(region(r.body.pos.x, r.body.pos.z)) && r.walk.building === cantina, `5: first seen on the open ground outside the door (region ${region(r.body.pos.x, r.body.pos.z)}), walking in to its place`);
      // Pressed against the doorway's outside step, which the grid calls the building's footprint.
      r.body.pos.set(e.outX, 0, e.outZ);
      let now = 0;
      let threw: unknown = null;
      for (let i = 0; i < 200 && !r.detour; i++) {
        now += 0.5;
        run.walkOne(r, now, 10 + now, at, deps);
      }
      const detour = r.detour;
      ok(!!detour && rankedRegion(region(detour.x, detour.z)) && r.walk.goal.x === detour.x && r.walk.building === null, `stalled there off open ground (region ${region(e.outX, e.outZ)}), it is sent round by the nearest ranked ground (region ${detour ? region(detour.x, detour.z) : 'none'})`);
      r.body.pos.set(detour!.x, 0, detour!.z);
      try {
        now += 0.5;
        run.walkOne(r, now, 10 + now, at, deps);
      } catch (err) {
        threw = err;
      }
      ok(threw === null && r.detour === null && r.walk.going && r.walk.building === cantina && r.walk.room === spot.cell && r.walk.goal.x === spot.x, `and from there on to its own place indoors, room ${spot.cell}, as a filler, never as a traveller with a port it has not got${threw ? ` (it threw: ${String(threw)})` : ''}`);
    }
  }

  // 6: the switch flipped in play.
  {
    const was = ROUTINE_TUNE.clearOut;
    const { run, pp } = fresh();
    try {
      ROUTINE_TUNE.clearOut = 0;
      const off = run.destination(pp, plan('arrive', { door: 0.1, spot: 0.1 }), deps);
      const offRec = standArrival(run, pp, { door: 0.9, spot: 0.2, index: 1 });
      ROUTINE_TUNE.clearOut = was;
      const on = run.destination(pp, plan('arrive', { door: 0.1, spot: 0.1 }), deps);
      const onRec = standArrival(run, pp, { door: 0.9, spot: 0.2, index: 2 });
      ok(!!off && !offRec.out && !!on && onRec.out && !!pp.street && rankedRegion(pp.street.region), `6: with \`clearOut\` switched off in play an arrival is still sent somewhere and walks as it used to, and switched on again the next one steps out onto the street's open ground (region ${pp.street?.region}): one flip either way`);
    } finally {
      ROUTINE_TUNE.clearOut = was;
    }
  }
}

// ---------------------------------------------------------------- one of ours spoken to, and asked to follow
//
// Synthetic, whatever is converted: a traveller and a filler written into the runner's own books as it
// keeps them, spoken to (`Mobile.listening`, which holds its day still) and then given up to the people
// following the player (`AmbientPeople.release`, src/world/followers.ts), which takes it off the books
// without taking it out of the world.
{
  type Books = Runner & { travelling: Map<number, unknown>; done: Map<number, number> };
  const record = (id: string, num: number, body: FakeBody, over: Record<string, unknown> = {}) => ({
    id,
    num,
    kind: num >= 0 ? 'arrive' : 'filler',
    body,
    walk: { going: true, goal: { x: 50, z: 0 }, building: null, room: 0 },
    track: newHeadway(0),
    who: 'somebody',
    port: null,
    plan: null,
    state: { stage: 'enter', standUntil: 0 },
    terminal: null,
    wait: null,
    dest: null,
    fill: null,
    slot: 0,
    doorstep: false,
    through: false,
    via: null,
    out: false,
    replanned: false,
    detour: null,
    heldSince: Number.NaN,
    trace: null,
    ...over,
  });
  const ap = new AmbientPeople();
  const run = ap as unknown as Books;
  const deps = { remove: (m: FakeBody) => void (m.removed = true) } as unknown as AmbientDeps;
  const at = new THREE.Vector3(0, 0, 0);

  // Spoken to: not walked, put away or let go, however far off it is and however long it stands.
  const talker = new FakeBody();
  talker.pos.set(1e5, 0, 0);
  talker.listening = { x: 0, z: 0 };
  const tr = record('ours:t1', 1, talker);
  tr.track.at = 3;
  run.records.set(tr.id, tr as never);
  run.travelling.set(1, tr);
  run.walkOne(tr as never, 20, 30, at, deps);
  ok(run.records.has('ours:t1') && !talker.removed && tr.track.at === 20 && tr.walk.goal.x === 50, "one of ours being spoken to is not walked, put away or let go, however far off; its walk's clock starts again, so the stand is not taken for a stall");
  talker.listening = null;
  run.walkOne(tr as never, 21, 31, at, deps);
  ok(!run.records.has('ours:t1') && talker.removed, 'and spoken to no longer, one that far off is put away as ever');

  // A traveller asked to follow: off the books, out of the travellers, done for its round, still in the world.
  const trav = new FakeBody();
  const rt = record('ours:t2', 2, trav, { plan: { round: 4 } });
  run.records.set(rt.id, rt as never);
  run.travelling.set(2, rt);
  ok(ap.release(trav as never, 10) && !run.records.has('ours:t2') && !run.travelling.has(2) && run.done.get(2) === 4 && !trav.removed && ap.tally.recruited === 1, 'a traveller asked to follow is off our books without being taken away, and done for its round, so it is not stood again as well');
  ok(!ap.release(trav as never, 11) && ap.tally.recruited === 1, 'asked again, it is not ours to give');

  // A filler asked to follow: up off its seat, its place waiting for somebody new as when one leaves.
  const sitter = new FakeBody();
  sitter.seated = true;
  sitter.routine = { sitting: true };
  const slot = { state: 'staying', life: 2, nextAt: 0, leaveAt: 99 };
  const fill = { spots: [{ frontX: 1, frontZ: 2 }], bodies: [] as unknown[], slots: [slot], seed: 5 };
  const rf = record('ours:f1', -1, sitter, { kind: 'filler', fill, slot: 0 });
  fill.bodies[0] = rf;
  run.records.set(rf.id, rf as never);
  ok(ap.release(sitter as never, 10) && !run.records.has('ours:f1') && fill.bodies[0] === null && !sitter.removed, 'a filler asked to follow is off our books without being taken away');
  ok(!sitter.seated && sitter.routine === null, 'up off its seat, and walked by no routine of ours');
  ok(slot.state === 'empty' && slot.life === 3 && slot.nextAt >= 10 && ap.tally.recruited === 2, `and its place waits for somebody new, as it does when one leaves (next at ${slot.nextAt.toFixed(1)} s)`);
}

console.log(`\nours in the street: ${passed} checks passed`);
