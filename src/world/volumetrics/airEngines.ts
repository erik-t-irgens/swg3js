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
// Types only from the vehicle, so the node tests drive it with stand-in hulls.
import type { Vehicle } from '../../vehicles/vehicle';
import { AIR_TUNE } from './airTune.ts';
import type { AirForces } from './airForces.ts';

/** Below this heat an engine stirs nothing: the plumes' own floor. */
const HEAT_MIN = 0.02;

/** What a hull is to the air: the few fields of a `Vehicle` this reads, so a test can hand it a stand-in. */
export type AirHull = Pick<Vehicle, 'engines' | 'engineHeat' | 'group' | 'spec' | 'airborne' | 'powered' | 'landed' | 'speed' | 'pos' | 'altitude'>;

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
  if (h.spec.ship) return (h.airborne || aboveFloor(h)) && h.powered && !h.landed ? E.downwashShip : 0;
  if (h.spec.kind === 'flyer') return aboveFloor(h) ? E.downwashFlyer : 0;
  return 0;
}

/**
 * Every engine of every hull into the forces, this frame's places. `skip` is a hull to leave out (none in this wave:
 * the hull the player rides stirs the air like any other; its box is kept clear of dust by the volume).
 */
export function pushEngines(hulls: readonly AirHull[], forces: AirForces): void {
  forces.beginFrame();
  if (!forces.active || !forces.fromEngines) return;
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
    // The downwash of a hull holding itself up (`downwashBase`, `aboveFloor`, written out).
    const fly = v.spec.fly;
    const up = !!fly && v.altitude > fly.floor + 0.05;
    const base = ship ? ((v.airborne || up) && v.powered && !v.landed ? E.downwashShip : 0) : kind === 'flyer' && up ? E.downwashFlyer : 0;
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
