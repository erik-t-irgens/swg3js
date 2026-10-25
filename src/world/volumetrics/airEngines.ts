// Every running engine of `world.vehicles` into the force API, once a frame: ships, speeders, pods and NPC ships alike,
// the `vehiclePlumes` shape (`src/vehicles/enginePlumes.ts`). Each engine's nozzle is its glow's world matrix, worked
// out afresh (a matrix read before the draw is last frame's, the racer's lesson), and its exhaust leaves along the
// hull's -Z, as the plumes have it. The exit speed is the kind's, times the heat the glows and the haze already read.
//
// **A hull that holds itself up blows down as well** (the design's §2.10): every hull's exhaust is its -Z, so a level
// ship hovering at 5 m or more -- how this game's ships hover -- would stir nothing; so a ship that is airborne or
// riding its springs above its band's floor, powered and not landed, and a flyer above its floor, add one engine from
// the middle of the underside straight down, at the downwash's exit, fading to nothing in forward flight.
//
// **The hull's velocity is its nose times its speed**, as the NPC brain reads every ship's: `body.linvel()` makes an
// object a call. A hull whose group is hidden (an NPC ship still being prepared) stirs nothing.
//
// **And from the sixth wave, what no hull of this world is** (the design's §2.12, §14): another player's ride from where
// this screen draws it (`RemotePlayers.nearRides`, a kept record), with a thrust of ours by its kind, since no engine heat
// crosses the wire -- driven and not set down, from the rear of its box along its tail while it moves, and blowing down
// under it while a ship or a flyer stands clear of the ground -- and a stood shuttle's engines while a flame its clip
// lights is in its window (`ShuttleRigs.jetsInto`), straight down from each joint, so every screen's pad is blasted on
// the same shared instant the flames light. Nothing of anybody's is sent for either.
//
// Types only from the vehicle, so the node tests drive it with stand-in hulls.
import type { Vehicle } from '../../vehicles/vehicle';
import { AIR_TUNE } from './airTune.ts';
import type { AirForces } from './airForces.ts';
import { RIDE_FLAG, RIDE_KIND, type NearRides } from '../../net/nearRides.ts';

/** A stood shuttle's engines lit this frame, into a kept record: each one's joint in the world and its key. */
export interface ShuttleJets {
  n: number;
  x: Float64Array;
  y: Float64Array;
  z: Float64Array;
  /** Each jet's source (its joint's id times 64 and its place among the clip's flames): steady while its window is open. */
  key: Float64Array;
}

/** A fresh record holding at most `most` jets. */
export function newShuttleJets(most = 16): ShuttleJets {
  const m = Math.max(1, Math.floor(most));
  return { n: 0, x: new Float64Array(m), y: new Float64Array(m), z: new Float64Array(m), key: new Float64Array(m) };
}

/** Below this heat an engine stirs nothing: the plumes' own floor. */
const HEAT_MIN = 0.02;

/** What a hull is to the air: the few fields of a `Vehicle` this reads, so a test can hand it a stand-in. */
export type AirHull = Pick<Vehicle, 'engines' | 'engineHeat' | 'group' | 'spec' | 'airborne' | 'powered' | 'landed' | 'speed' | 'pos' | 'altitude'> & { readonly rig?: Vehicle['rig'] };

/**
 * Whether a hull rides its springs above the floor of its flying band: how a ship stopped in the air and a flying car
 * hold themselves up (`Vehicle`'s own `flying`, `altitude > fly.floor + 0.05`). A ship lifted from rest with Space and
 * left there never counts as `airborne` (that is cruising past 4 m/s, or having flown), and its corners all read
 * grounded at any height, so neither of those says it is up: the first browser smoke found an X-wing at 15 m stirring
 * nothing.
 */
export function aboveFloor(h: AirHull): boolean {
  const fly = h.spec.fly;
  return !!fly && Number.isFinite(h.altitude) && h.altitude > fly.floor + 0.05;
}

/** The exit speed for a hull's kind, before its heat [ours]. */
export function kindExit(kind: string, ship: boolean): number {
  const E = AIR_TUNE.engine;
  if (ship || kind === 'ship') return E.exitShip;
  if (kind === 'podracer') return E.exitPod;
  if (kind === 'flyer') return E.exitFlyer;
  return E.exitSpeeder;
}

/** Whether a hull holds itself up in the air and so blows down under it, and the downwash's base exit if it does (0 when not). */
export function downwashBase(h: AirHull): number {
  const E = AIR_TUNE.engine;
  // A shuttle on its travel rig: its rig's flames are its jets (`pushEngines`).
  if (h.rig) return 0;
  if (h.spec.ship) return (h.airborne || aboveFloor(h)) && h.powered && !h.landed ? E.downwashShip : 0;
  if (h.spec.kind === 'flyer') return aboveFloor(h) ? E.downwashFlyer : 0;
  return 0;
}

/**
 * Every engine of every hull into the forces, this frame's places, then (the sixth wave) every other player's ride in
 * `rides` and every stood shuttle's jet in `jets`, where the world hands them (each its own function, so the hulls'
 * loop is compiled as it was). The hull the player rides stirs the air like any other; its box is kept clear of dust by
 * the volume.
 */
export function pushEngines(hulls: readonly AirHull[], forces: AirForces, rides: NearRides | null = null, jets: ShuttleJets | null = null): void {
  forces.beginFrame();
  if (!forces.active || !forces.fromEngines) return;
  if (rides !== null && rides.n > 0) pushRides(rides, forces);
  if (jets !== null && jets.n > 0) pushJets(jets, forces);
  // Every number goes to the forces in their kept array: a number handed across a call the compiler did not build in
  // is a number made, a frame, an engine (the rule `airForces.ts` states). `kindExit`, `exitSpeed`, `downwashBase` and
  // `downwashExit` are the same lines, which the node test holds this to.
  const a = forces.arg;
  const E = AIR_TUNE.engine;
  for (let i = 0; i < hulls.length; i++) {
    const v = hulls[i];
    if (!v.group.visible) continue;
    v.group.updateWorldMatrix(true, false);
    const g = v.group.matrixWorld.elements;
    // The nose is the group's +Z; the exhaust leaves along -Z.
    let nx = g[8];
    let nz = g[10];
    const nl = Math.sqrt(nx * nx + g[9] * g[9] + nz * nz);
    if (nl > 1e-6) {
      nx /= nl;
      nz /= nl;
    }
    const speed = v.speed;
    const vx = nx * speed;
    const vz = nz * speed;
    const ship = !!v.spec.ship;
    const kind = v.spec.kind;
    const heat = v.engineHeat;
    const count = v.engines.length;
    if (heat > HEAT_MIN && count) {
      const kindSpeed = ship || kind === 'ship' ? E.exitShip : kind === 'podracer' ? E.exitPod : kind === 'flyer' ? E.exitFlyer : E.exitSpeeder;
      let exit = kindSpeed * (Number.isFinite(heat) ? heat : 0);
      if (exit > E.exitCap) exit = E.exitCap;
      // A pod's several spots a side each take their share; any other hull's engines each its own.
      const half = count / 2;
      const share = kind === 'podracer' ? exit / (half > 1 ? half : 1) : exit;
      for (let k = 0; k < count; k++) {
        const o = v.engines[k].object;
        o.updateWorldMatrix(true, false);
        const m = o.matrixWorld.elements;
        a[0] = m[12];
        a[1] = m[13];
        a[2] = m[14];
        a[3] = -g[8];
        a[4] = -g[9];
        a[5] = -g[10];
        a[6] = share;
        a[7] = vx;
        a[8] = vz;
        // The source a rut or a pit is gathered under between ticks: this hull and this engine, steady for its life.
        a[9] = v.group.id * 64 + (k < 62 ? k : 62);
        forces.engineArgs();
      }
    }
    // The downwash of a hull holding itself up (`downwashBase`, `aboveFloor`, written out). A shuttle on its travel rig
    // (`rig`) blows none of its own: its rig's flames are its jets (`ShuttleRigs.jetsInto` walks the flown hull's set as it
    // walks a stood one's), so the shuttle a passenger rides stirs the pad as every other screen's stood shuttle does, once.
    const fly = v.spec.fly;
    const up = !!fly && v.altitude > fly.floor + 0.05;
    const base = v.rig ? 0 : ship ? ((v.airborne || up) && v.powered && !v.landed ? E.downwashShip : 0) : kind === 'flyer' && up ? E.downwashFlyer : 0;
    if (base > 0) {
      let t = Math.abs(speed) / E.downwashFade;
      t = t > 0 ? (t < 1 ? t : 1) : 0;
      const exit = base * (1 - t * t * (3 - 2 * t));
      if (exit > 0.5) {
        const b = v.spec.bounds;
        a[0] = v.pos.x;
        a[1] = v.pos.y + (b.min[1] < b.max[1] ? b.min[1] : b.max[1]);
        a[2] = v.pos.z;
        a[3] = 0;
        a[4] = -1;
        a[5] = 0;
        a[6] = exit;
        a[7] = vx;
        a[8] = vz;
        a[9] = v.group.id * 64 + 63;
        forces.engineArgs();
      }
    }
  }
}

/**
 * Other players' rides into the forces (`AIR_TUNE.peers`, every number ours): a ride somebody drives and has not set
 * down blows from the rear of its box along its tail while it moves faster than `runFrom`, at its kind's exit times how
 * hard it is reckoned to run (`idle` at a standstill, all of it from `fullAt`); and a ship or a flyer whose underside
 * stands more than `hover` over the floor its kind flies from (a hull of ours's `aboveFloor`, read off the ground under
 * it) blows down as a hull of ours does, from the middle of its underside, fading to nothing in forward flight. A
 * creature ridden stirs nothing. Every place is read off the picture's own box in the picture's own frame
 * (`nearRides.ts`). Every number goes to the forces in their kept array.
 */
export function pushRides(r: NearRides, forces: AirForces): void {
  const a = forces.arg;
  const E = AIR_TUNE.engine;
  const P = AIR_TUNE.peers;
  const before = forces.engineCount;
  for (let i = 0; i < r.n; i++) {
    const kind = r.kind[i];
    if (kind === RIDE_KIND.none) continue;
    const fl = r.flags[i];
    if ((fl & RIDE_FLAG.driven) === 0 || (fl & RIDE_FLAG.landed) !== 0) continue;
    const ship = kind === RIDE_KIND.ship;
    const flyer = kind === RIDE_KIND.flyer;
    const vx = r.vx[i];
    const vz = r.vz[i];
    const flat = Math.sqrt(vx * vx + vz * vz);
    // The middle of the underside: under the box's middle, its lowest y over the place.
    const ux = r.x[i] + r.cx[i];
    const uz = r.z[i] + r.cz[i];
    const low = r.y[i] + r.low[i];
    // Holding itself up: its underside over the ground under it (the forces' own raster) by more than its kind's floor
    // and `hover`, as a hull of ours of that kind is above its floor (`aboveFloor`).
    let up = false;
    if (ship || flyer) {
      a[0] = ux;
      a[1] = low;
      a[2] = uz;
      a[3] = r.floor[i] + P.hover;
      up = forces.overGroundArgs();
    }
    if (flat > P.runFrom) {
      // The nose is the turn's +Z: (2(xz + wy), 2(yz − wx), 1 − 2(x² + y²)); the exhaust leaves along -Z.
      const qx = r.qx[i];
      const qy = r.qy[i];
      const qz = r.qz[i];
      const qw = r.qw[i];
      const nx = 2 * (qx * qz + qw * qy);
      const ny = 2 * (qy * qz - qw * qx);
      const nz = 1 - 2 * (qx * qx + qy * qy);
      let s = flat / (P.fullAt > 1e-3 ? P.fullAt : 1e-3);
      s = s < 1 ? s : 1;
      const heat = P.idle + (1 - P.idle) * s;
      const kindExit = ship ? P.ship : kind === RIDE_KIND.pod ? P.pod : flyer ? P.flyer : P.speeder;
      let exit = kindExit * heat;
      if (exit > E.exitCap) exit = E.exitCap;
      const back = r.half[i] * P.rear;
      a[0] = r.x[i] + r.cx[i] - nx * back;
      a[1] = r.y[i] + r.cy[i] - ny * back;
      a[2] = r.z[i] + r.cz[i] - nz * back;
      a[3] = -nx;
      a[4] = -ny;
      a[5] = -nz;
      a[6] = exit;
      a[7] = vx;
      a[8] = vz;
      a[9] = r.key[i] * 64;
      forces.engineArgs();
    }
    if (up) {
      const base = ship ? E.downwashShip : E.downwashFlyer;
      let t = flat / E.downwashFade;
      t = t > 0 ? (t < 1 ? t : 1) : 0;
      const exit = base * (1 - t * t * (3 - 2 * t));
      if (exit > 0.5) {
        a[0] = ux;
        a[1] = low;
        a[2] = uz;
        a[3] = 0;
        a[4] = -1;
        a[5] = 0;
        a[6] = exit;
        a[7] = vx;
        a[8] = vz;
        a[9] = r.key[i] * 64 + 63;
        forces.engineArgs();
      }
    }
  }
  forces.counts.peers += forces.engineCount - before;
}

/**
 * A stood shuttle's lit engines into the forces: straight down from each joint at `engine.exitShuttle` (held to the
 * engines' cap), as still as the pad under it. Every number in the forces' kept array.
 */
export function pushJets(j: ShuttleJets, forces: AirForces): void {
  const a = forces.arg;
  const E = AIR_TUNE.engine;
  const exit = E.exitShuttle < E.exitCap ? E.exitShuttle : E.exitCap;
  const before = forces.engineCount;
  for (let i = 0; i < j.n; i++) {
    a[0] = j.x[i];
    a[1] = j.y[i];
    a[2] = j.z[i];
    a[3] = 0;
    a[4] = -1;
    a[5] = 0;
    a[6] = exit;
    a[7] = 0;
    a[8] = 0;
    a[9] = j.key[i];
    forces.engineArgs();
  }
  forces.counts.shuttles += forces.engineCount - before;
}
