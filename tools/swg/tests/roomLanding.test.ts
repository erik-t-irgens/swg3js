// A shuttle landing in a room (step 9): Theed's transport comes down in the royal hangar on the hangar's
// own branch, through its door, and every other trip lands as it did.
//
// What is shown, and why each is worth showing:
//
//   1. Which pads a trip may land on: a shuttle standing in a room is a pad only for a hull of its own rig
//      whose rig has its branch (`padOfPort`'s `hullRig`), so the plain shuttle and a trip planned with
//      room pads switched off pass the hangar over as before, and the branch a trip lands with follows the
//      pad it lands on (`landMoodFor`, `RideRoute.landMood`) through a replan for a skip too.
//   2. The hull flies the branch the trip asks for (`RigHull.paths(lift, land)`), cached per pair, with its
//      own rule where none is asked or its rig has not got the one asked for.
//   3. Over the game's own packs: Theed Starport has a pad for a transport and none for the plain shuttle;
//      the hangar's own landing, flown onto that pad in the world's own frame, carries the hull's middle
//      through the hangar's door polygon (and its lift-off back out of it), at the moments the design
//      measured (the join near 8.07 s, the door near 17.1 s, down near 28.1 s); and the calm landing every
//      other transport flies would not come through that door at all.
//   4. The wiring in `main.ts`, `shuttleRide.ts` and `world.ts`, which drag three and the world in, as text.
//   5. The rooms' one pool of lights, lit for the hangar a hull is landing in while the player is in the
//      street, lights the hangar's rooms alone: the portal renderer's interior pass, run as written, draws
//      every other building's rooms with the pool dimmed and puts it back.
//
// Run: node tools/swg/tests/roomLanding.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { flyingRig, loadGlb, packRigs } from './rigFixtures.ts';
import { RigHull, assembleRigModel, hullJointOf, landingMood, landingMoodFor } from '../../../src/vehicles/rigHull.ts';
import { landMoodFor, padOfPort, padRefOf, planHop, planRoute, replanSkip, roomPadFor, type PadRef } from '../../../src/world/rideRoute.ts';
import { vehicleAt } from '../../../src/world/rigPath.ts';
import { portsOf, type PoiRow } from '../../../src/world/shuttle.ts';
import { travelThingsOf, type Ticket, type TravelRig, type TravelRow, type TravelThing } from '../../../src/world/travelTerminal.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}

const root = new URL('../../../', import.meta.url);
const text = (p: string): string => readFileSync(new URL(p, root), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- 1: which pads, and which branch

const thing = (over: Partial<TravelThing> = {}): TravelThing => ({ kind: 'shuttle', model: null, rig: 'transport', mood: 'calm', x: 0, y: 12, z: 0, yaw: 0, cell: 0, building: 'b', bx: 0, bz: 0, ...over });
const clips = { land: 'land', lift: 'take_off' };
const transport: TravelRig = { file: 'travel/t.glb', parts: [], moods: { calm: clips, theed: { land: 'land:theed', lift: 'take_off:theed' } }, seconds: { land: 26.6, take_off: 19.9, 'land:theed': 32.3, 'take_off:theed': 26.3 } };
const shuttle: TravelRig = { file: 'travel/s.glb', parts: [], moods: { '': clips }, seconds: { land: 20.8, take_off: 12 } };
const rigs = { transport, shuttle };
{
  const ports = [{ name: 'Theed Starport', x: 0, z: 0, kind: 'starport' as const }, { name: 'Keren Starport', x: 4000, z: 0, kind: 'starport' as const }];
  const hangar = thing({ cell: 5, mood: 'theed' });
  const keren = thing({ bx: 4000, x: 4010 });
  const things = [hangar, keren];
  const inRoom = padOfPort(things, ports, 'Theed Starport', 'naboo', rigs, undefined, 'transport');
  ok(!!inRoom && inRoom.cell === 5 && inRoom.mood === 'theed' && inRoom.rig === 'transport', "1: a transport's trip to a port whose shuttle stands in a room lands on that room's pad");
  ok(padOfPort(things, ports, 'Theed Starport', 'naboo', rigs, undefined, 'shuttle') === null, "... a trip flown with the plain shuttle passes it over: it is not that pad's rig");
  ok(padOfPort(things, ports, 'Theed Starport', 'naboo', rigs) === null && padOfPort(things, ports, 'Theed Starport', 'naboo', rigs, undefined, null) === null, '... and so does one planned with room pads switched off (no hull rig named), the old way');
  ok(padOfPort([thing({ cell: 5, mood: 'coruscant' })], ports, 'Theed Starport', 'naboo', rigs, undefined, 'transport') === null, "... nor is a room's pad whose branch the rig has not got ever landed at");
  ok(padOfPort(things, ports, 'Keren Starport', 'naboo', rigs, undefined, 'transport')?.cell === 0 && padOfPort(things, ports, 'Keren Starport', 'naboo', rigs)?.cell === 0, '... while a pad in the open is every trip\'s, as it always was');
  ok(roomPadFor(hangar, rigs, 'transport') && !roomPadFor(hangar, rigs, 'shuttle') && !roomPadFor(hangar, rigs, null) && !roomPadFor({ rig: 'transport', mood: 'toString' }, rigs, 'transport'), "the room rule is its own rig and a branch its rig really has (a name the object's prototype carries is no branch)");

  const from = padRefOf('naboo', 1, keren, ports, rigs, things);
  const open = padRefOf('naboo', 1, keren, ports, rigs, things);
  ok(landMoodFor(from, inRoom) === 'theed' && landMoodFor(from, open) === null && landMoodFor(from, null) === null, "a pad in a room lands on its own branch; a pad in the open leaves the branch to the hull's own rule");
  ok(landMoodFor({ rig: 'shuttle' }, inRoom) === null, '... and a hull of another rig is never given a room\'s branch');
  const ticket: Ticket = { id: 'r1', from: 'naboo', pack: 'naboo', to: 'Theed Starport', at: { x: 0, z: 0 }, price: 0, bought: 0 };
  const route = planRoute(ticket, from, inRoom, 'naboo')!;
  ok(route.landMood === 'theed' && route.legs.map((l) => l.kind).join(',') === 'board,lift,fly,land,off,leave' && route.to.pad?.cell === 5, `a trip to the room's pad lands on its branch (${route.landMood}) and is flown in and landed as any other (${route.legs.map((l) => l.kind).join(', ')})`);
  ok(planRoute({ ...ticket, to: 'Keren Starport' }, from, open, 'naboo')!.landMood === null, '... one to a pad in the open keeps the hull\'s own rule');
  const bare = planRoute(ticket, from, null, 'naboo')!;
  ok(bare.landMood === null && bare.legs.at(-1)?.kind === 'walkOff', '... and one with no pad there walks off at the port with nothing to land with');
  const across = planRoute({ ...ticket, pack: 'naboo2', trip: 'skip', skipSpace: true }, from, { ...inRoom!, pack: 'naboo2' }, 'naboo')!;
  const skip = replanSkip(across, 1, 'test');
  ok(across.landMood === 'theed' && skip.landMood === 'theed' && skip.legs.slice(1).map((l) => l.kind).join(',') === 'skip,land,off,leave', "a trip given up for a skip lands on the same pad with the same branch");
  ok(replanSkip(skip, 1, 'again').landMood === null && replanSkip(skip, 1, 'again').legs.at(-1)?.kind === 'walkOff', '... and one given up for the port on foot lands with nothing');
  const hop = planHop(from, inRoom!);
  ok(hop.landMood === 'theed' && planHop(from, inRoom!, false).landMood === null && planHop(from, open).landMood === null, "the console's hop onto a room's pad lands on its branch, and with room pads switched off as before");
  ok(JSON.stringify(structuredClone(route)) === JSON.stringify(route), 'and a trip is still plain data');
}

// ---------------------------------------------------------------- 2: the hull flies the branch asked for

{
  const fly = flyingRig();
  const moods = { calm: fly.clips, theed: fly.clips, '': fly.clips };
  ok(landingMoodFor(moods, 'theed', null) === 'calm' && landingMoodFor(moods, 'theed', 'theed') === 'theed' && landingMoodFor(moods, 'calm', 'theed') === 'theed', '2: a hull lands with the branch asked for, and with its own rule (calm) where none is');
  ok(landingMoodFor(moods, 'theed', 'coruscant') === landingMood(moods, 'theed') && landingMoodFor({ '': fly.clips }, '', 'theed') === '', "... and with its own rule where its rig has not got the one asked for");
  const assembled = assembleRigModel({ scene: fly.skeleton.scene.clone(true), animations: fly.skeleton.animations }, fly.pieces.map((p) => ({ joint: p.joint, model: p.model.clone(true) })), 'hold', fly.clips);
  const hull = new RigHull(assembled, fly.clips, moods);
  hull.frame();
  const own = hull.paths('theed');
  const asked = hull.paths('theed', 'theed');
  ok(!!own && !!asked && own.landMood === 'calm' && asked.landMood === 'theed' && own !== asked, "a hull's paths for a lift-off and a landing are flown per pair");
  ok(hull.paths('theed') === own && hull.paths('theed', 'theed') === asked && hull.paths('theed', null) === own, '... and each pair is made once and kept');
  hull.dispose();
}

// ---------------------------------------------------------------- 3: Theed's hangar, over the game's own packs

const packs = join(process.cwd(), 'assets-private');
const naboo = join(packs, 'naboo');
const need = ['travel.json', 'pois.json', 'layout.json', 'manifest.json'];
if (!need.every((f) => existsSync(join(naboo, f)))) note(`naboo is not converted with ${need.join(', ')}, so the hangar is not landed in: npm run swg -- travel @SWG assets-private --retail-only`);
else {
  const travel = JSON.parse(readFileSync(join(naboo, 'travel.json'), 'utf8')) as { rows: TravelRow[]; rigs?: Record<string, TravelRig> };
  const pois = JSON.parse(readFileSync(join(naboo, 'pois.json'), 'utf8')) as { center: { x: number; z: number }; pois?: PoiRow[] };
  const nabooRigs = travel.rigs ?? {};
  const things = travelThingsOf(travel.rows, pois.center);
  const ports = portsOf(pois.pois ?? [], pois.center);
  const pad = padOfPort(things, ports, 'Theed Starport', 'naboo', nabooRigs, undefined, 'transport');
  ok(!!pad && pad.cell === 5 && pad.rig === 'transport' && pad.mood === 'theed', `3: Theed Starport has a pad for a transport: its hangar's deck, cell ${pad?.cell}, on the ${pad?.mood} branch`);
  const lambda = padOfPort(things, ports, 'Theed Starport', 'naboo', nabooRigs, undefined, 'shuttle');
  const keren = padOfPort(things, ports, 'Keren Shuttleport', 'naboo', nabooRigs, undefined, 'shuttle');
  const shuttleFrom = keren ?? padRefOf('naboo', 0, thing({ rig: 'shuttle', mood: '' }), ports, nabooRigs);
  const walk = planRoute({ id: 'l', from: 'naboo', pack: 'naboo', to: 'Theed Starport', at: null, price: 0, bought: 0 }, shuttleFrom, lambda, 'naboo');
  ok(lambda === null && (!walk || walk.legs.at(-1)?.kind === 'walkOff'), `... and none for the plain shuttle: a lambda's trip to Theed still sets its passenger down at the port (${walk?.legs.map((l) => l.kind).join(', ') ?? 'no rigged pad to leave from'})`);

  // The hangar as the world stands it: its layout row's place and turn, as `LayoutStreamer` reads them.
  const layout = JSON.parse(readFileSync(join(naboo, 'layout.json'), 'utf8')) as { center: { x: number; z: number }; objects: { model: string; template: string; x: number; y: number; z: number; q: number[]; contained?: boolean }[] };
  const manifest = JSON.parse(readFileSync(join(naboo, 'manifest.json'), 'utf8')) as { categories: Record<string, { id: string; portals?: { v: number[][] }[]; cells?: { index: number; name?: string; bounds: { min: number[]; max: number[] }; portals?: { target: number; geometry: number }[] }[] }[]> };
  const hangarRow = travel.rows.find((r) => r.kind === 'shuttle' && r.cell > 0);
  // The building the row belongs to, by its template (a snapshot names it by its shared one) and its place:
  // a power generator stands on the hangar's very origin.
  const bare = (t: string): string => t.replace('/shared_', '/');
  const obj = hangarRow ? layout.objects.find((o) => !o.contained && bare(o.template) === bare(hangarRow.building) && Math.abs(o.x - hangarRow.bx) < 0.5 && Math.abs(o.z - hangarRow.bz) < 0.5) : undefined;
  let def: (typeof manifest.categories)[string][number] | undefined;
  for (const list of Object.values(manifest.categories)) for (const d of list) if (obj && d.id === obj.model) def = d;
  const rig = nabooRigs.transport;
  if (!pad || !obj || !def?.cells || !def.portals || !rig || !existsSync(join(packs, rig.file)) || !rig.parts.every((p) => existsSync(join(packs, p.file)))) note('the hangar, its model or the transport rig is not converted whole, so it is not landed in');
  else {
    const c = layout.center;
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(-(obj.x - c.x), obj.y, obj.z - c.z), new THREE.Quaternion(obj.q[1], -obj.q[2], -obj.q[3], obj.q[0]), new THREE.Vector3(1, 1, 1));
    const inverse = matrix.clone().invert();
    const deck = def.cells.find((x) => x.index === pad.cell)!;
    const doorLink = deck.portals?.find((p) => p.target === 0);
    const inBox = (v: THREE.Vector3, box: { min: number[]; max: number[] }, pad = 0.5): boolean =>
      [0, 1, 2].every((k) => v.getComponent(k) >= Math.min(box.min[k], box.max[k]) - pad && v.getComponent(k) <= Math.max(box.min[k], box.max[k]) + pad);
    const padLocal = new THREE.Vector3(pad.x, pad.y, pad.z).applyMatrix4(inverse);
    ok(inBox(padLocal, deck.bounds) && !!doorLink, `the pad stands on the ${deck.name ?? 'deck'}'s floor in the hangar's own frame (${padLocal.toArray().map((n) => n.toFixed(2)).join(', ')}), and that room has a door onto the world`);
    // The door, in the hangar's frame: a plane, and a basis in it for testing a point against the polygon.
    const verts = def.portals[doorLink!.geometry].v.map((v) => new THREE.Vector3(v[0], v[1], v[2]));
    const centroid = verts.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / verts.length);
    const normal = new THREE.Vector3();
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i].clone().sub(centroid);
      const b = verts[(i + 1) % verts.length].clone().sub(centroid);
      normal.add(a.cross(b));
    }
    normal.normalize();
    const u = new THREE.Vector3().subVectors(verts[0], centroid).projectOnPlane(normal).normalize();
    const w = new THREE.Vector3().crossVectors(normal, u);
    const flat = verts.map((v) => [v.clone().sub(centroid).dot(u), v.clone().sub(centroid).dot(w)]);
    /** How far inside the door polygon a point in its plane is, metres (negative outside): its distance to the nearest edge, signed. */
    const inside = (p: THREE.Vector3): number => {
      const x = p.clone().sub(centroid).dot(u);
      const y = p.clone().sub(centroid).dot(w);
      let odd = false;
      let edge = Infinity;
      for (let i = 0, j = flat.length - 1; i < flat.length; j = i++) {
        const [xi, yi] = flat[i];
        const [xj, yj] = flat[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
        const ex = xj - xi;
        const ey = yj - yi;
        const t = Math.max(0, Math.min(1, ((x - xi) * ex + (y - yi) * ey) / (ex * ex + ey * ey || 1)));
        edge = Math.min(edge, Math.hypot(x - (xi + ex * t), y - (yi + ey * t)));
      }
      return odd ? edge : -edge;
    };
    const side = (p: THREE.Vector3): number => p.clone().sub(centroid).dot(normal);

    const skeleton = loadGlb(join(packs, rig.file));
    const pieces = rig.parts.map((p) => ({ joint: p.joint, model: loadGlb(join(packs, p.file)).scene as THREE.Object3D }));
    const assembled = assembleRigModel({ scene: skeleton.scene.clone(true), animations: skeleton.animations }, pieces, hullJointOf(rig), rig.moods.theed);
    const hull = new RigHull(assembled, rig.moods.theed, rig.moods);
    const box = hull.frame()!;
    const theed = hull.paths('calm', 'theed');
    const calm = hull.paths('calm');
    const again = hull.paths('theed');
    ok(!!theed?.join && theed.landMood === 'theed' && calm?.landMood === 'calm' && again?.liftMood === 'theed' && !!again.cut, "the transport's hull lands with the hangar's branch when the trip asks, the calm one when it does not, and lifts off again on the hangar's branch");

    /** The hull's middle, where its room is followed from (`World.trackVehicleRoom`), in the hangar's frame. */
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const mid = (path: NonNullable<typeof theed>['land'], t: number): THREE.Vector3 => {
      vehicleAt(pad, path, t, hull.offset, p, q);
      return new THREE.Vector3(0, box.h / 2, 0).applyQuaternion(q).add(p).applyMatrix4(inverse);
    };
    /** Where a path's middle crosses the door's plane, the moment and the point, from `t0` on, every 60th of a second; and how far inside the polygon it is. */
    const crossings = (path: NonNullable<typeof theed>['land'], t0: number): { t: number; at: THREE.Vector3; margin: number }[] => {
      const out: { t: number; at: THREE.Vector3; margin: number }[] = [];
      let prev = mid(path, t0);
      for (let t = t0 + 1 / 60; t <= path.seconds + 1e-9; t += 1 / 60) {
        const now = mid(path, t);
        const a = side(prev);
        const b = side(now);
        if (a === 0 || a > 0 !== b > 0) {
          const k = a / (a - b);
          const at = prev.clone().lerp(now, k);
          out.push({ t: t - (1 - k) / 60, at, margin: inside(at) });
        }
        prev = now;
      }
      return out;
    };
    const land = crossings(theed!.land, theed!.join!.t);
    ok(land.length === 1 && land[0].margin > 0, `the hangar's own landing carries the hull's middle through the door's plane once, inside the door (${land.map((x) => `${x.t.toFixed(2)} s, ${x.margin.toFixed(1)} m in from its edge`).join('; ') || 'never'})`);
    // The hull's whole box, turned as it flies, seen along the door: every corner inside the doorway while
    // the box stands across the door's plane.
    let worst = Infinity;
    let straddled = 0;
    for (let t = theed!.join!.t; t <= theed!.land.seconds; t += 1 / 60) {
      vehicleAt(pad, theed!.land, t, hull.offset, p, q);
      const corners: THREE.Vector3[] = [];
      for (const cx of [-box.halfW, box.halfW]) for (const cy of [0, box.h]) for (const cz of [-box.halfL, box.halfL]) corners.push(new THREE.Vector3(cx, cy, cz).applyQuaternion(q).add(p).applyMatrix4(inverse));
      const sides = corners.map(side);
      if (!(Math.min(...sides) < 0 && Math.max(...sides) > 0)) continue;
      straddled++;
      for (const k of corners) worst = Math.min(worst, inside(k.clone().addScaledVector(normal, -side(k))));
    }
    ok(straddled > 0 && worst > 0, `... and its whole box (${(box.halfW * 2).toFixed(1)} x ${box.h.toFixed(1)} x ${(box.halfL * 2).toFixed(1)} m), for the ${straddled} sixtieths of a second it stands across the door's plane, is inside the doorway seen along it, ${worst.toFixed(2)} m to spare at the worst`);

    // The moments the design measured on the same rig: the join, the hull's origin at the door's plane, down.
    const origin = (t: number): THREE.Vector3 => {
      vehicleAt(pad, theed!.land, t, hull.offset, p, q);
      return p.clone().applyMatrix4(inverse);
    };
    let door = Number.NaN;
    for (let t = theed!.join!.t; t <= theed!.land.seconds && Number.isNaN(door); t += 1 / 60) if (side(origin(t)) * side(origin(theed!.join!.t)) <= 0) door = t;
    vehicleAt(pad, theed!.land, theed!.land.seconds, hull.offset, p, q);
    const parked = p.y;
    let down = Number.NaN;
    for (let t = theed!.join!.t; t <= theed!.land.seconds && Number.isNaN(down); t += 1 / 60) {
      vehicleAt(pad, theed!.land, t, hull.offset, p, q);
      if (p.y - parked <= 0.5) down = t;
    }
    ok(Math.abs(theed!.join!.t - 8.07) < 0.05 && Math.abs(door - 17.07) < 0.3 && Math.abs(down - 28.1) < 0.5, `the landing is taken up at ${theed!.join!.t.toFixed(2)} s (8.07), its origin comes through the door at ${door.toFixed(2)} s (17.1) and it is down at ${down.toFixed(2)} s (28.1): what the browser's measure is held to`);
    const out = crossings(again!.lift, 0);
    ok(out.length >= 1 && out[0].margin > 0 && out[0].t < again!.cut!.t, `empty again, it lifts off on the hangar's branch out through the same door (${out.map((x) => `${x.t.toFixed(2)} s, ${x.margin.toFixed(1)} m in`).join('; ')}), before its cut at ${again!.cut!.t.toFixed(2)} s`);
    const calmIn = crossings(calm!.land, calm!.join!.t).filter((x) => x.margin > 0);
    const calmEnd = mid(calm!.land, calm!.land.seconds);
    ok(calmIn.length === 0 && inBox(calmEnd, deck.bounds, 1), `while the calm landing every other transport flies ends on the same deck without ever coming through the door (${calmIn.length} crossings inside it): why a room's pad is landed on with its own branch`);
    hull.dispose();
  }
}

// ---------------------------------------------------------------- 4: the wiring, as text

{
  const main = text('src/main.ts');
  const calls = main.match(/padOfPort\([^;]*\)/g) ?? [];
  ok(calls.length === 4 && calls.every((c) => c.includes('this.roomPadRig(from)')), `every trip the game plans asks for its pad with the rig it is flown with (${calls.length} of 4 calls)`);
  ok(/private roomPadRig\(from: PadRef\): string \| null \{\s*return RIDE_TUNE\.roomPads \? from\.rig : null;/.test(main), '... which is none at all with room pads switched off');
  ok(/planHop\(from, dest, RIDE_TUNE\.roomPads\)/.test(main), "the console's hop asks as well");
  ok(/if \(room > 0 && RIDE_TUNE\.roomPads\) this\.world\.enterRoom\(this\.rideOffAt\.set\(v\.pos\.x, v\.pos\.y \+ 1, v\.pos\.z\), room, true\);/.test(main), 'seated in a hull parked in a room, the passenger keeps that room, followed from wherever the seat stands');
  ok(/if \(room > 0 && RIDE_TUNE\.roomPads && !this\.world\.enterRoom\(this\.rideOffAt, room\)\) this\.world\.enterCellAt\(this\.rideOffAt\);/.test(main), '... and stepping off in one, they are in it at the foot of the ramp');
  ok(/this\.world\.hintRoomLight\(pad, pad\?\.cell \?\? 0\);/.test(main) && /holdRoomHeading\(this\.rideHeld, ride, RIDE_TUNE\.roomHeadingHold && ride\.roomLanding && !!this\.world\.vehicleRoomOf\(rh\), rh\.group\.quaternion\)/.test(main), "the room's lights are lit for a landing, and the passenger's view holds its heading once the hull is in the room (`holdRoomHeading`, which shuttleRide.test.ts flies)");
  const ride = text('src/world/shuttleRide.ts');
  const paths = ride.match(/rig\.paths\(this\.route\.mood[^)]*\)/g) ?? [];
  ok(paths.length === 3 && paths.every((c) => c.includes('this.landWith()')), `every landing the trip flies is the branch the route asks for (${paths.length} of 3)`);
  ok((ride.match(/this\.inRooms\(\)/g) ?? []).length >= 5 && !/, false\) : null;\n\s*this\.fxMood/.test(ride), "and every set of its sounds follows the rooms when either end of the trip is in one");
  const world = text('src/world/world.ts');
  ok(/enterRoom\(at: THREE\.Vector3, cell: number, carried = false\): boolean \{[\s\S]*?buildingWithRoom\(at, cell\)/.test(world), '`World.enterRoom` finds the room through `buildingWithRoom`, as a lift stop keeps its building');
  ok(/const state = this\.cellState && this\.cellState\.cell > 0 \? this\.cellState : hint/.test(world), "and the rooms' lights are the player's own room's first, the landing's only when they are in none");
  ok(/this\.portals\.hintedLights\.building = state !== null && state === hint \? state\.building : null;/.test(world) && /portals\.hintedLights\.dim = this\.dimRoomLights;/.test(world), "lit for a landing, the pool is named as that building's alone, with the world's own way to dim it");
}

// ---------------------------------------------------------------- 5: lit for a landing, the hangar's rooms alone

{
  // The portal renderer draws every nearby building's rooms through their doors with the one pool of room
  // lights, which with the player in no room stands at nought. Lit for the hangar a shuttle is landing in,
  // every other building's interior pass must be drawn with the pool dimmed, and the pool put back after, so
  // only the hangar's rooms are lit -- as they all were before there was a hint. Read off the renderer's own
  // interior pass, driven with a fake renderer, since three's WebGL renderer is not to be had under node.
  const src = text('src/world/portalRender.ts');
  const body = /private renderRooms\(scene: THREE\.Scene, camera: THREE\.Camera, b: Building\): void \{[\s\S]*?\n  \}/.exec(src)?.[0] ?? '';
  ok(!!body && (src.match(/this\.renderRooms\(scene, camera, (view|b)\);/g) ?? []).length === 2 && !/this\.renderLayer\(scene, camera, INTERIOR_LAYER\);\n\s*(this\.showInterior|if \(this\.matrixOnce)/.test(src), '5: both interior passes, from inside and through the doors from outside, go through one call that dims the pool for any building it was not lit for');
  // That call, run as it stands against a record of the pool and a pass that reads it.
  type B = { name: string };
  const hangar: B = { name: 'hangar' };
  const cantina: B = { name: 'cantina' };
  const pool = { lit: 1 };
  const kept = { lit: 0 };
  const drawnWith: string[] = [];
  const self = {
    hintedLights: {
      building: hangar as B | null,
      dim: (on: boolean) => {
        if (on) {
          kept.lit = pool.lit;
          pool.lit = 0;
        } else pool.lit = kept.lit;
      },
    },
    renderLayer: (_s: unknown, _c: unknown, _l: number) => void drawnWith.push(String(pool.lit)),
  };
  const fn = new Function('INTERIOR_LAYER', `return function ${body.replace(/^\s*private /, '').replace(/\(scene: THREE\.Scene, camera: THREE\.Camera, b: Building\): void/, '(scene, camera, b)')}`)(1) as (this: typeof self, s: unknown, c: unknown, b: B) => void;
  fn.call(self, null, null, cantina);
  fn.call(self, null, null, hangar);
  self.hintedLights.building = null;
  fn.call(self, null, null, cantina);
  ok(drawnWith.join() === '0,1,1' && pool.lit === 1, `... the cantina's rooms seen through their door are drawn with the pool at nought and the hangar's with it lit, and with no hint every building's with the pool as it stands, which is put back after (${drawnWith.join(', ')})`);
}

console.log(`\nroom landing: ${passed} checks passed`);
