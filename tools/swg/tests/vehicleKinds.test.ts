// The gallery's vehicles by kind, and which part of a vehicle follows which kind (src/vehicles/vehicleKinds.ts).
//
// The table's 57 rows and their counts; the name rule kept as the fallback and as the switch's other side; every
// converted gallery vehicle with a row; the routing over every row against every kind it can be spawned as (the drive,
// the modes and the race box by the kind; the seat and the clips by what it is; a rig never; a creature's saddle
// whatever; the eye seat only for the ships pack's own ships spawned as ships); and the race boxes over the real
// models' bounds when a gallery is converted. The table is ours; the bounds are the packs'.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { RACE_BASE, RACE_TUNE, tuneRace } from '../../../src/vehicles/raceTune.ts';
import { isPod } from '../../../src/vehicles/podSeat.ts';
import { VEHICLE_KINDS, hoverCarFor, kindByNames, kindFor, raceBoxFor, raceNote, raceRoute, raceSpecFor, races } from '../../../src/vehicles/vehicleKinds.ts';
import { isHoverCar, type VehicleKind } from '../../../src/vehicles/vehicle.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const TUNE0 = JSON.parse(JSON.stringify(RACE_TUNE)) as typeof RACE_TUNE;
const restore = () => {
  Object.assign(RACE_TUNE, JSON.parse(JSON.stringify(TUNE0)));
  tuneRace({});
};

const rows = Object.entries(VEHICLE_KINDS);
const count = (f: (r: (typeof rows)[number][1]) => boolean) => rows.filter(([, r]) => f(r)).length;
ok(rows.length === 58 && Object.hasOwn(VEHICLE_KINDS, 'podracer_sebulba'), `the table has the gallery's 57 vehicles and Sebulba's pod, an exhibit of ours (${rows.length})`);
const pods = count((r) => r.kind === 'podracer');
const bikes = count((r) => r.kind === 'speederbike');
const hover = count((r) => r.kind === 'flyer' && !r.air);
const air = count((r) => r.kind === 'flyer' && !!r.air);
const ground = count((r) => r.kind === 'ground');
ok(pods === 8 && bikes === 33 && hover === 3 && air === 6 && ground === 8, `8 pods, 33 bikes, 3 hover cars, 6 aircraft and 8 that walk or roll (${pods}, ${bikes}, ${hover}, ${air}, ${ground})`);
ok(rows.every(([id, r]) => kindFor({ id }).kind === r.kind && kindFor({ id }).inferred), 'with the switch on, every row is its own kind and never a guess');
ok(hoverCarFor('koro2_speeder') === true && hoverCarFor('landspeeder_organa') === true && hoverCarFor('snowspeeder') === false && hoverCarFor('jetpack') === false && hoverCarFor('no_such_vehicle') === undefined, "a flyer is a hover car or an aircraft by its row; an id the table lacks is the name rule's");
ok(races('podracer') && races('speederbike') && !races('flyer') && !races('ground') && !races('ship'), 'every pod and every bike races, nothing else');

// The gallery, when converted: its vehicles' templates and models, and their bounds.
const GALLERY = 'assets-private/gallery';
interface GalleryVehicle {
  label: string;
  template?: string;
  model?: string;
}
let gallery: GalleryVehicle[] | null = null;
const bounds = new Map<string, { min: number[]; max: number[] }>();
if (existsSync(`${GALLERY}/gallery.json`) && existsSync(`${GALLERY}/manifest.json`)) {
  const g = JSON.parse(readFileSync(`${GALLERY}/gallery.json`, 'utf8')) as { sections: { title: string; items: GalleryVehicle[] }[] };
  gallery = g.sections.find((s) => s.title === 'Vehicles')?.items ?? null;
  const m = JSON.parse(readFileSync(`${GALLERY}/manifest.json`, 'utf8')) as { categories: { layout: { id: string; bounds: { min: number[]; max: number[] } }[] } };
  for (const e of m.categories.layout) bounds.set(e.id, e.bounds);
}

// The name rule: the switch's other side, and the fallback for an id the table lacks.
RACE_TUNE.kinds = 'names';
ok(rows.every(([id]) => kindFor({ id }).kind === kindByNames(id, undefined, undefined).kind), "with kinds: 'names' every id answers the name rule's kind");
restore();
{
  // With the pass switched off the table is not read at all: every gallery vehicle is the kind the name rule gives it
  // (its template and model too, where the gallery is converted) and every flyer is the name rule's hover car or not.
  tuneRace({ on: false });
  const v = (id: string) => gallery?.find((x) => x.label === id);
  const byNames = rows.every(([id]) => {
    const g = v(id);
    const a = kindFor({ id, template: g?.template, model: g?.model });
    const b = kindByNames(id, g?.template, g?.model);
    return a.kind === b.kind && a.inferred === b.inferred;
  });
  const flyers = rows.every(([id]) => hoverCarFor(id) === undefined);
  ok(byNames && flyers, `with the pass off every one of the ${rows.length} rows is the name rule's kind and no flyer is sorted by the table`);
  restore();
}
{
  // How many rows the table moves from what the name rule made of them.
  const byName = (id: string) => {
    const v = gallery?.find((x) => x.label === id);
    return kindByNames(id, v?.template, v?.model).kind;
  };
  // A move is a kind changed, or a flyer the name rule made a hover car the table makes an aircraft (or back).
  const moves = rows.filter(([id, r]) => byName(id) !== r.kind || (r.kind === 'flyer' && isHoverCar(id) !== !r.air)).map(([id]) => id);
  if (gallery) ok(moves.length === 19, `the table moves 19 vehicles from the kind the name rule gave them (${moves.length}: ${moves.join(', ')})`);
  else note(`no gallery converted: by their ids alone the table moves ${moves.length} vehicles from the name rule`);
}
if (gallery) {
  const missing = gallery.filter((v) => !Object.hasOwn(VEHICLE_KINDS, v.label)).map((v) => v.label);
  ok(gallery.length > 0 && missing.length === 0, `every vehicle of the converted gallery has a row (${gallery.length}${missing.length ? `; missing ${missing.join(', ')}` : ''})`);
  // Sebulba's pod, once the vehicles are converted again: its seat borrowed, its engine points ours, a rider pose (names
  // and counts only).
  const seb = gallery.find((v) => v.label === 'podracer_sebulba') as (GalleryVehicle & { riderPose?: string; invented?: boolean }) | undefined;
  if (!seb) note("the gallery has no Sebulba's pod yet: convert the vehicles again (npm run swg -- gallery '@SWG' assets-private --only=vehicles --retail-only)");
  else {
    const m = JSON.parse(readFileSync(`${GALLERY}/manifest.json`, 'utf8')) as { categories: { layout: { id: string; hardpoints?: string[]; hardpointsFrom?: Record<string, string> }[] } };
    const e = m.categories.layout.find((x) => x.id === seb.model);
    const hp = e?.hardpoints ?? [];
    ok(['player', 'engine_1', 'engine_2'].every((n) => hp.includes(n)) && !!seb.riderPose && seb.invented === true, `Sebulba's pod lists player, engine_1 and engine_2 among its ${hp.length} points and a rider pose, marked as ours`);
    ok(/^borrowed/.test(e?.hardpointsFrom?.player ?? '') && /^ours/.test(e?.hardpointsFrom?.engine_1 ?? '') && /^ours/.test(e?.hardpointsFrom?.engine_2 ?? ''), 'and its manifest entry says the seat is borrowed and the engines ours');
  }
} else note('no gallery converted: the rows are not held against it');

// --- the routing over every row against every kind ------------------------------------------------------------------
const KINDS: VehicleKind[] = ['podracer', 'speederbike', 'flyer', 'ground', 'ship'];
{
  let bad = '';
  for (const [id, r] of rows) {
    for (const source of ['gallery', 'creature', 'rig', 'ship']) {
      const def = { id, kind: r.kind, source, clipSpeeds: r.kind === 'ground' ? { walk: 2 } : undefined };
      for (const kind of KINDS) {
        const route = raceRoute(def, kind);
        const drive = source === 'rig' ? null : kind === 'podracer' ? 'pod' : kind === 'speederbike' ? 'bike' : null;
        const pod = isPod(def);
        const wrong =
          route.drive !== drive ||
          route.modes !== (drive === 'bike') ||
          (drive === null) !== (route.box === 'mesh') ||
          route.seat !== (pod ? 'pod' : 'own') ||
          route.clips !== (pod ? 'pod' : def.clipSpeeds ? 'own' : 'none') ||
          route.saddle !== (source === 'creature') ||
          route.eyeSeat !== (source === 'ship' && kind === 'ship');
        if (wrong && !bad) bad = `${id} (${source}) as ${kind}: ${JSON.stringify(route)}`;
      }
    }
  }
  ok(!bad, `the routing over the 57 rows against every kind (${rows.length * 4 * KINDS.length} routes): the drive, the modes and the box by the kind; the seat and clips by what it is; a rig never; a saddle kept; the eye seat only for a ship spawned as one${bad ? ` -- ${bad}` : ''}`);
}
{
  RACE_TUNE.hull = 'mesh';
  ok(raceRoute({ id: 'x', kind: 'podracer', source: 'gallery' }, 'podracer').box === 'mesh', "hull: 'mesh' gives no race box at all");
  restore();
  RACE_TUNE.podBox = 'own';
  ok(raceRoute({ id: 'x', kind: 'podracer', source: 'gallery' }, 'podracer').box === 'own', "podBox: 'own' gives a pod its own box");
  restore();
}

// --- the race boxes -------------------------------------------------------------------------------------------------
{
  const pod = RACE_BASE.podracer.box;
  const bike = RACE_BASE.speederbike.box;
  if (!gallery) note('no gallery converted: the race boxes are held against invented bounds only');
  const boundsOf = (id: string) => {
    const v = gallery?.find((x) => x.label === id);
    return v?.model ? (bounds.get(v.model) ?? null) : null;
  };
  // Invented: a one-seat bike, a nine-metre skiff, a pod.
  const oneSeat = { min: [-0.45, 0, -2], max: [0.45, 1.2, 2] };
  ok(raceBoxFor(raceRoute({ id: 'x', kind: 'speederbike', source: 'gallery' }, 'speederbike'), oneSeat, pod, bike)!.every((n, i) => n === bike[i]), 'a one-seat bike races on the shared bike box');
  ok(raceBoxFor(raceRoute({ id: 'x', kind: 'flyer', source: 'gallery' }, 'flyer'), oneSeat, pod, bike) === null, 'a vehicle that does not race has no race box');
  if (gallery) {
    const bikeBoxed: string[] = [];
    let bigger = '';
    for (const [id] of rows) {
      const b = boundsOf(id);
      if (!b) continue;
      const box = raceBoxFor(raceRoute({ id, kind: VEHICLE_KINDS[id].kind, source: 'gallery' }, 'speederbike'), b, pod, bike)!;
      if (box.every((n, i) => n === bike[i])) bikeBoxed.push(id);
      if (box.some((n, i) => n > pod[i] + 1e-9)) bigger = id;
    }
    ok(!bigger, `no vehicle spawned as a bike races on a box bigger than the pod box on any axis${bigger ? ` (${bigger})` : ''}`);
    const ownBikes = rows.filter(([id, r]) => r.kind === 'speederbike' && bikeBoxed.includes(id)).length;
    ok(ownBikes === 12, `twelve of the bikes race on the shared bike box (${ownBikes}: ${rows.filter(([id, r]) => r.kind === 'speederbike' && bikeBoxed.includes(id)).map(([id]) => id).join(', ')})`);
    const asBike = (id: string) => {
      const b = boundsOf(id);
      return b ? raceBoxFor(raceRoute({ id, kind: VEHICLE_KINDS[id].kind, source: 'gallery' }, 'speederbike'), b, pod, bike) : null;
    };
    const skiff = asBike('landspeeder_desert_skiff');
    const transport = asBike('tcg_military_transport');
    ok(!!skiff && Math.abs(skiff[1] - 3) < 0.005, `the desert skiff races on its own box, ${skiff?.map((n) => n.toFixed(2)).join(' x ')} (3.00 m tall)`);
    ok(!!transport && Math.abs(transport[2] - 15) < 0.005, `the military transport on its own cut to ${transport?.map((n) => n.toFixed(2)).join(' x ')} (15.00 m long)`);
    for (const id of rows.filter(([, r]) => r.kind === 'podracer').map(([id]) => id).concat(['hoth_at_st', 'walker_at_xt', 'basilisk_war_droid', 'grievous_wheel_bike', 'tcg_republic_gunship'])) {
      const box = asBike(id);
      const own = boundsOf(id);
      if (!box || !own) {
        note(`${id}: not in the converted gallery`);
        continue;
      }
      const cut = box.some((n, i) => n < Math.abs(own.max[i] - own.min[i]) - 0.01);
      ok(cut && box.every((n, i) => n <= pod[i] + 1e-9), `${id} spawned as a bike races on its own box cut to the pod box (${box.map((n) => n.toFixed(1)).join(' x ')})`);
    }
    const atrt = asBike('walker_at_rt_camo');
    if (atrt) ok(atrt.every((n, i) => n === bike[i]), 'the AT-RT spawned as a bike races on the bike box');
    // The spawn's note, by the rule it was boxed by.
    const route = raceRoute({ id: 'koro2_speeder', kind: 'flyer', source: 'gallery' }, 'speederbike');
    const b = boundsOf('koro2_speeder');
    if (b) {
      const words = raceNote(route, raceBoxFor(route, b, pod, bike), b);
      ok(!!words && /races as a bike/.test(words) && /own box/.test(words), `the Koro-2 spawned as a bike says so: "${words}"`);
    }
  }
  ok(raceNote(raceRoute({ id: 'x', kind: 'flyer', source: 'gallery' }, 'flyer'), null, oneSeat) === null, 'a vehicle that does not race says nothing of it');
}

// --- what a spawn does about the race (raceSpecFor, the garage's whole answer) ------------------------------------------
{
  const pod = RACE_BASE.podracer.box;
  const bike = RACE_BASE.speederbike.box;
  const podDef = { id: 'test_pod', kind: 'podracer' as const, source: 'gallery', clipSpeeds: { run: 10 } };
  const bikeDef = { id: 'test_bike', kind: 'speederbike' as const, source: 'gallery' };
  const hoverDef = { id: 'test_hover', kind: 'flyer' as const, source: 'gallery' };
  const rigDef = { id: 'test_rig', kind: 'podracer' as const, source: 'rig' };
  const big = { min: [-5, 0, -5.5], max: [5, 3.5, 5.5] };
  const oneSeat = { min: [-0.45, 0, -2], max: [0.45, 1.2, 2] };
  const skiff = { min: [-2, 0, -4.5], max: [2, 3, 4.5] };
  const asBike = raceSpecFor(podDef, 'speederbike', big);
  ok(asBike.drive === 'bike' && asBike.hull === 'box' && !!asBike.raceBox && asBike.raceBox.every((n, i) => n <= pod[i] + 1e-9) && asBike.route.seat === 'pod' && asBike.route.clips === 'pod', `a pod-shaped def spawned as a bike: the bike drive, its own box cut to the pod box (${asBike.raceBox?.join(' x ')}), the pod's seat and clips`);
  const asPod = raceSpecFor(bikeDef, 'podracer', oneSeat);
  ok(asPod.drive === 'pod' && asPod.hull === 'box' && asPod.raceBox!.every((n, i) => n === pod[i]), 'a bike-shaped def spawned as a pod: the pod drive on the shared pod box');
  ok(raceSpecFor(bikeDef, 'speederbike', oneSeat).raceBox!.every((n, i) => n === bike[i]) && raceSpecFor(bikeDef, 'speederbike', skiff).raceBox!.join() === '4,3,9', 'a one-seat bike on the bike box, a nine-metre skiff on its own');
  const hover = raceSpecFor(hoverDef, 'flyer', skiff);
  ok(hover.drive === null && hover.hull === undefined && hover.raceBox === undefined && hover.note === null, 'a hover car at its own kind: no drive, nothing written into its spec');
  ok(raceSpecFor(rigDef, 'podracer', big).drive === null, 'a rig is never raced');
  RACE_TUNE.hull = 'mesh';
  const mesh = raceSpecFor(podDef, 'podracer', big);
  ok(mesh.drive === 'pod' && mesh.hull === 'mesh' && mesh.raceBox === undefined, "hull: 'mesh': the drive on its own hull, no race box");
  restore();
  tuneRace({ on: false });
  const off = [raceSpecFor(podDef, 'podracer', big), raceSpecFor(bikeDef, 'speederbike', oneSeat), raceSpecFor(hoverDef, 'speederbike', skiff)];
  ok(off.every((s) => s.drive === null && s.hull === undefined && s.raceBox === undefined && s.note === null), 'with the pass off a spawn attaches no drive and writes nothing into the spec, whatever the kind');
  restore();
  // The garage writes that answer and nothing else, into the spec and at the attach (text pins: the garage loads models).
  const garage = readFileSync(new URL('../../../src/vehicles/garage.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const writes = /const race = raceSpecFor\(def, kind, bounds\);\s*\n\s*if \(race\.hull\) spec\.hull = race\.hull;\s*\n\s*if \(race\.raceBox\) spec\.raceBox = race\.raceBox;/.test(garage);
  const attaches = /attachRace\(v, race\.drive, opts\.race \?\? \{ ground: null \}\);/.test(garage);
  const only = (garage.match(/attachRace\(/g) ?? []).length === 1 && !/spec\.raceBox = (?!race\.raceBox)/.test(garage) && !/spec\.hull = (?!race\.hull)/.test(garage);
  ok(writes && attaches && only, "(garage.ts: the spawn writes raceSpecFor's hull and box into the spec and attaches its drive, and nothing else does)");
}

restore();
console.log(`\nvehicleKinds: ${checks} checks passed`);
