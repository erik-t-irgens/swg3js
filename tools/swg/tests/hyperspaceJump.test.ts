// The hyperspace jump's phase machine (src/space/hyperspace.ts) against a fake host and a fake hull:
// the countdown and its banner (held still while the menu is open), cancelling, the enter stage's
// ghosting, the tunnel closing round the ship, the others told not to show it, the transit inside a
// system (one teleport) and to another (the same hull carried across, its crew kept aboard), the
// tunnel's least time and a slow destination, the tunnel opening before the brake, the exit's brake onto
// the arrival, the release at the right moment, the pilot's view held until then, and every way a jump
// can end early releasing a hull still in the world (and never touching one the world has disposed),
// with the tunnel taken down. Then the tunnel's own arithmetic: its cover through the stages, the
// others' window, and that the jump camera and the hull sit inside it for any hull. Synthetic packs
// only: no number from the client's files.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Hyperspace, type HyperspaceHost, type JumpHull } from '../../../src/space/hyperspace.ts';
import {
  brakeAt,
  EXIT_BRAKE,
  exitEnd,
  hiddenToPeers,
  insideTunnel,
  jumpChaseBack,
  releaseAt,
  sceneOf,
  transitAt,
  TUNNEL_TIMES,
  tunnelCameraFar,
  tunnelClosingAt,
  tunnelCover,
  tunnelOpeningAt,
  tunnelSize,
} from '../../../src/space/hyperspaceMath.ts';
import type { Destination, HyperspaceCatalogue, SpacePack } from '../../../src/space/spaceData.ts';
import type { EffectHandle } from '../../../src/world/particles';

const TUNNEL_MIN = TUNNEL_TIMES.min;

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const DT = 1 / 60;
const ALREADY = 'Already at that point (test line).';

/** A synthetic v2 pack: a scene with round numbers of our own, one station, two points. */
function pack(zone: string, version = 2): SpacePack {
  return {
    version,
    zone,
    planet: null,
    title: `System ${zone}`,
    stations: [{ name: `station_${zone}`, title: `${zone} station`, description: '', model: 'st', x: -3000, y: 0, z: 0, radius: 300, approachClearance: 900 }],
    scenery: [],
    planets: [],
    arrival: { x: 0, y: 0, z: 6000, kind: 'point', point: `${zone}_0` },
    hyperspace:
      version < 2
        ? null
        : {
            points: [],
            scene: {
              source: 'scene/hyperspace.iff',
              scale: 1,
              enter: { seconds: 2, particle: 'a.prt', clientEffect: 'a.cef', value: 0, sound: 'a.snd' },
              transit: { limit: 10, speed: 600, fade: 0.4, sound: 'b.snd' },
              exit: { seconds: 5, particle: 'c.prt', clientEffect: 'c.cef', value: 0, sound: 'c.snd' },
            },
            effects: { enter: 'fx/enter.json', exit: 'fx/exit.json', timing: { enterPeak: 3, tunnelAt: 0.8, exitBurstAt: 3.5, exitClearAt: 4.6 } },
            messages: { alreadyAtPoint: ALREADY },
            frameCheck: { checked: 0, sameCloser: 0, mirroredCloser: 0, meanErrorSame: 0, meanErrorMirrored: 0 },
          },
  };
}

const PACKS: Record<string, SpacePack> = { space_a: pack('space_a'), space_b: pack('space_b'), space_old: pack('space_old', 1) };
const catalogue = {
  systems: Object.keys(PACKS).map((id) => ({ id, name: id, title: id, pack: PACKS[id], destinations: [] })),
  pack: (zone: string) => PACKS[zone] ?? null,
  find: () => null,
} as unknown as HyperspaceCatalogue;

function dest(zone: string, id: string, at: [number, number, number], kind: Destination['kind'] = 'point', radius = 0): Destination {
  return { key: `${zone}:${id}`, zone, id, kind, name: `${zone} ${id}`, description: '', at, radius, invented: false };
}

class FakeHull implements JumpHull {
  readonly group = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly radius = 10;
  readonly spec = { maxSpeed: 100 };
  cruise = 50;
  held = false;
  jumpCruise: number | null = null;
  justHit = 0;
  readonly ghostCalls: boolean[] = [];
  teleports = 0;
  readonly launches: number[] = [];
  /** Dropped from the fake world: like a disposed Vehicle, whose removed Rapier body throws `unreachable` when touched. */
  disposed = false;
  destroyed = false;
  setGhost(on: boolean): void {
    if (this.disposed) throw new Error('unreachable');
    this.ghostCalls.push(on);
  }
  get ghosted(): boolean {
    return this.ghostCalls[this.ghostCalls.length - 1] === true;
  }
  teleport(p: THREE.Vector3, q: THREE.Quaternion, speed: number): void {
    if (this.disposed) throw new Error('unreachable');
    this.pos.copy(p);
    this.group.position.copy(p);
    this.group.quaternion.copy(q);
    this.cruise = speed;
    this.teleports++;
  }
  launch(speed: number): void {
    this.cruise = speed;
    this.launches.push(speed);
  }
  /** A synthetic physics step: along the nose at the commanded cruise, unless held. */
  step(dt: number): void {
    if (this.held) return;
    const v = this.jumpCruise ?? this.cruise;
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(this.group.quaternion);
    this.pos.addScaledVector(f, v * dt);
    this.group.position.copy(this.pos);
  }
  get released(): boolean {
    return !this.held && this.ghostCalls[this.ghostCalls.length - 1] === false && this.jumpCruise === null;
  }
}

interface Opts {
  readyFrames?: number;
  crossFrames?: number;
  /** Frames settleCarried takes (the reflections, the whole-scene compile). */
  settleFrames?: number;
  /**
   * 'carry' (the default): the world swapped with the hull carried across and put at the pose. 'null': not carried and the
   * world left as it was. 'lost': the world swapped and the hull gone with the old one. 'throw': failed after the swap.
   */
  cross?: 'carry' | 'null' | 'lost' | 'throw';
}

/** The fake App: records what the jump asks of it; readyAround and crossZone resolve after some frames. */
function makeWorld(opts: Opts = {}) {
  const first = new FakeHull();
  const rec = {
    banners: [] as (string | null)[],
    placed: [] as string[],
    removed: 0,
    moved: 0,
    cross: 0,
    crossHull: null as JumpHull | null,
    closed: 0,
    afterTeleport: 0,
    attached: [] as JumpHull[],
    covers: [] as { cover: number; opening: boolean }[],
    detached: 0,
    held: [] as (JumpHull | null)[],
    kept: 0,
    prepared: 0,
    /** settleCarried's calls: where, the environment's wait and the time left. */
    settled: [] as { at: THREE.Vector3; envMs: number; ms: number }[],
    /** keepCrew's calls by the phase the jump was in. */
    keptIn: {} as Record<string, number>,
    /** The tunnel's last operation: 'attach', 'set' or 'detach'. */
    lastTunnel: '',
  };
  const state = { zone: 'space_a', ship: first as FakeHull | null, packHere: PACKS.space_a as SpacePack | null, catalogue: catalogue as HyperspaceCatalogue | null, programs: 100 };
  /** The jump this world is driven by, once made (for the phase keepCrew is called in). */
  const jump: { h: Hyperspace | null } = { h: null };
  const phaseOf = () => jump.h?.phase ?? 'none';
  const alive = new Set<JumpHull>([first]);
  /** The world drops a hull as World.disposeVehicle does: disposed first (its body removed), then out of the list. */
  const drop = (hl: FakeHull) => {
    hl.disposed = true;
    alive.delete(hl);
  };
  const waits: { left: number; fire: () => void }[] = [];
  const after = <T>(n: number, value: () => T) =>
    new Promise<T>((resolve, reject) =>
      waits.push({
        left: n,
        fire: () => {
          try {
            resolve(value());
          } catch (err) {
            reject(err);
          }
        },
      }),
    );
  const host: HyperspaceHost = {
    zone: () => state.zone,
    ship: () => state.ship,
    alive: (h) => alive.has(h),
    catalogue: () => state.catalogue,
    packHere: () => state.packHere,
    placeEffect: (file) => {
      rec.placed.push(file);
      return { file } as unknown as EffectHandle;
    },
    removeEffect: () => {
      rec.removed++;
    },
    effects: () => ({ enter: 'fx/enter.json', exit: 'fx/exit.json' }),
    moveWorld: () => {
      rec.moved++;
    },
    readyAround: () => after(opts.readyFrames ?? 3, () => true),
    settleCarried: (at, envMs, ms) => {
      rec.settled.push({ at: at.clone(), envMs, ms });
      return after(opts.settleFrames ?? 4, () => true);
    },
    afterTeleport: () => {
      rec.afterTeleport++;
    },
    crossZone: (zone, hull, pose) => {
      rec.cross++;
      rec.crossHull = hull;
      const h = hull as FakeHull;
      const mode = opts.cross ?? 'carry';
      // App.carryAcross swaps the world at once (World.loadCarrying) and puts the hull at the pose, then waits on the pack.
      if (mode !== 'null') {
        state.zone = zone;
        state.packHere = PACKS[zone] ?? null;
        if (mode === 'lost') {
          drop(h);
          state.ship = null;
        } else h.teleport(pose.pos, pose.quaternion, 0);
      }
      return after(opts.crossFrames ?? 5, () => {
        if (mode === 'throw') throw new Error('synthetic crossing failure');
        return mode === 'carry' ? hull : null;
      });
    },
    holdCrew: (hull) => {
      rec.held.push(hull);
    },
    keepCrew: () => {
      rec.kept++;
      const phase = phaseOf();
      rec.keptIn[phase] = (rec.keptIn[phase] ?? 0) + 1;
    },
    prepareTunnel: () => {
      rec.prepared++;
    },
    programs: () => state.programs,
    tunnel: {
      attach: (hull) => {
        rec.attached.push(hull);
        rec.lastTunnel = 'attach';
      },
      set: (cover, opening) => {
        rec.covers.push({ cover, opening });
        rec.lastTunnel = 'set';
      },
      detach: () => {
        rec.detached++;
        rec.lastTunnel = 'detach';
      },
    },
    closePanels: () => {
      rec.closed++;
    },
    ui: {
      banner: (text) => {
        rec.banners.push(text);
      },
    },
  };
  const tickWaits = () => {
    for (let i = waits.length - 1; i >= 0; i--) {
      if (--waits[i].left <= 0) {
        const w = waits.splice(i, 1)[0];
        w.fire();
      }
    }
  };
  return { host, first, rec, state, alive, drop, tickWaits, jump };
}

const settle = () => new Promise<void>((r) => setImmediate(r));

/** One frame as the game runs it: the jump, then the vehicles' step, then the pending host work, then the microtasks. */
async function frame(h: Hyperspace, w: ReturnType<typeof makeWorld>, menuOpen = false, rawDt = DT): Promise<void> {
  h.update(DT, rawDt, menuOpen);
  w.state.ship?.step(DT);
  w.tickWaits();
  await settle();
}

async function framesFor(h: Hyperspace, w: ReturnType<typeof makeWorld>, seconds: number, menuOpen = false): Promise<void> {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) await frame(h, w, menuOpen);
}

async function untilPhase(h: Hyperspace, w: ReturnType<typeof makeWorld>, phase: string, limit = 60): Promise<number> {
  let n = 0;
  while (h.phase !== phase && n < limit / DT) {
    await frame(h, w);
    n++;
  }
  return n * DT;
}

const S = sceneOf(PACKS.space_a);
const FAR_POINT = dest('space_a', 'space_a_1', [0, 0, 6000]); // game (0, 0, 6000): 6 km ahead of a ship at the origin, facing the station at game (3000, 0, 0)
/** describe().cruise on every frame of the exit inside a system (section 3), which the exit into another system must match (section 4). */
const inSystemExit: (number | null)[] = [];
const near = (a: number, b: number, eps = DT * 1.5) => Math.abs(a - b) <= eps;

// 1. The countdown's banner: once per whole second, not at all while the menu is open (and it does not advance).
{
  const w = makeWorld();
  const h = new Hyperspace(w.host);
  ok(h.start(FAR_POINT) === null, 'a jump 6 km away in the same system starts');
  ok(h.phase === 'countdown' && w.rec.banners.length === 1 && /in 5$/.test(w.rec.banners[0] ?? ''), 'the banner shows 5 at once');
  ok(h.prompt === w.rec.banners[0], 'the prompt line reads the same as the banner');
  ok(w.rec.prepared === 1, "the tunnel's program is checked once, as the countdown begins (before the jump, never in it)");
  await framesFor(h, w, 2, true);
  ok(h.phase === 'countdown' && w.rec.banners.length === 1, 'two seconds with the menu open: no banner written, still counting');
  ok(!h.locksControls && !h.drives(w.first) && !h.holdsView(w.first) && !h.hiddenToPeers, 'nothing is locked, driven, held in view or hidden in the countdown');
  ok(w.rec.attached.length === 0 && w.rec.covers.length === 0, 'and no tunnel');
  const t = await untilPhase(h, w, 'enter');
  ok(Math.abs(t - 5) <= DT * 1.5, `the countdown ran its 5 seconds once the menu closed (${t.toFixed(3)} s)`);
  const texts = w.rec.banners.filter((b) => b !== null);
  ok(texts.length === 5 && texts.every((b, i) => b!.endsWith(`in ${5 - i}`)), `the banner was written once per whole second: ${texts.map((b) => b!.slice(-1)).join(' ')}`);
  ok(w.rec.banners[w.rec.banners.length - 1] === null, 'and cleared at the enter stage');
  h.abort('test done');
}

// 2. Cancelling the countdown touches nothing on the hull.
{
  const w = makeWorld();
  const h = new Hyperspace(w.host);
  h.start(FAR_POINT);
  await framesFor(h, w, 1);
  h.cancel('the pilot changed their mind');
  ok(h.phase === 'idle' && w.first.ghostCalls.length === 0 && w.first.jumpCruise === null && !w.first.held, 'cancel in the countdown: no setGhost, no jumpCruise, not held');
  ok(w.rec.banners[w.rec.banners.length - 1] === null && h.prompt === null, 'cancel clears the banner and the prompt');
  await framesFor(h, w, 6);
  ok(h.phase === 'idle' && w.first.ghostCalls.length === 0 && w.rec.attached.length === 0, 'and nothing starts later, no tunnel');
}

// 3. A whole jump inside the system: the tunnel's timeline, the others' window, one teleport, the least time inside,
//    the tunnel opening before the brake, the brake onto the arrival, the release, the view held until then.
{
  const w = makeWorld();
  const h = new Hyperspace(w.host);
  const hull = w.first;
  h.start(FAR_POINT);
  await untilPhase(h, w, 'enter');
  ok(hull.ghostCalls.length === 1 && hull.ghostCalls[0] === true, 'setGhost(true) at the start of the enter stage');
  ok(w.rec.closed === 1, 'the panels are closed at the start of the enter stage');
  ok(w.rec.placed[0] === 'fx/enter.json', 'the enter effect is placed on the hull');
  ok(w.rec.attached.length === 1 && w.rec.attached[0] === hull, 'the tunnel is put round the hull');
  ok(w.rec.held.length === 1 && w.rec.held[0] === hull, "whoever is in the hull's rooms is its crew for the jump");
  ok(h.locksControls && h.drives(hull) && h.prompt === 'jumping', 'from the enter stage the jump flies the hull and locks the controls');
  ok(h.holdsView(hull) && !h.holdsView(new FakeHull()), "the pilot's view is the jump's (behind this ship), and only this ship's");
  ok(h.hiddenToPeers && h.describe().hidden, 'the others are told not to show the ship from the first frame of the enter stage');
  ok(!h.crewFree, 'the crew stays put while the hull accelerates');
  ok(h.describe().ghost === true, "describe().ghost reads the hull's own state: ghosted in the enter stage");
  // Through the enter stage, noting when the tunnel starts to close, when it is closed and when the transit begins.
  let t = 0;
  let closingAt = -1;
  let closedAt = -1;
  let rising = 0;
  let monotonic = true;
  let lastCover = 0;
  while (h.phase === 'enter') {
    await frame(h, w);
    t += DT;
    const c = w.rec.covers[w.rec.covers.length - 1];
    if (c) {
      if (closingAt < 0 && c.cover > 0) closingAt = t;
      if (closedAt < 0 && c.cover >= 1) closedAt = t;
      if (c.cover < lastCover - 1e-9 || c.opening) monotonic = false;
      lastCover = c.cover;
    }
    if (hull.jumpCruise !== null && hull.jumpCruise >= rising) rising = hull.jumpCruise;
  }
  ok(near(closingAt, tunnelClosingAt(S)), `the tunnel starts to close at ${closingAt.toFixed(3)} s (wanted ${tunnelClosingAt(S).toFixed(3)})`);
  ok(near(t, transitAt(S)) && near(closedAt, transitAt(S)), `it is closed as the transit starts (${closedAt.toFixed(3)} s, transit at ${t.toFixed(3)}, wanted ${transitAt(S)})`);
  ok(monotonic, 'it only ever closes through the enter stage');
  ok(rising === S.speed, `the enter stage reached the scene's speed (${rising})`);
  ok(hull.teleports === 1 && w.rec.moved === 1 && w.rec.afterTeleport === 1 && w.rec.cross === 0, 'inside the system: one teleport, the world moved once, no crossing');
  ok(w.rec.removed === 1, 'the enter effect is removed before the move');
  ok(w.rec.kept >= 1, 'the crew is gathered before anything moves');
  ok(h.covered && h.crewFree && h.drives(hull) && h.locksControls && h.hiddenToPeers, 'in the transit: closed, the crew free to walk, the hull flown and still hidden');
  ok(hull.held, 'the hull is held still in the tunnel');
  const keptBefore = w.rec.kept;
  // Programs made while it is closed are counted (the destination's, made on purpose).
  w.state.programs += 3;
  const inside = await untilPhase(h, w, 'exit');
  ok(near(inside, TUNNEL_MIN, DT * 2.5), `ready after 3 frames, it still stays inside its least time (${inside.toFixed(3)} s, wanted ${TUNNEL_MIN})`);
  ok(w.rec.kept - keptBefore >= Math.round(TUNNEL_MIN / DT) - 2, `and keeps its crew aboard every frame (${w.rec.kept - keptBefore} times)`);
  ok(h.describe().tunnelPrograms === 3, `the programs made while it was closed are counted (${h.describe().tunnelPrograms})`);
  ok(w.rec.placed[1] === 'fx/exit.json', 'the exit effect is placed on the hull');
  ok(hull.teleports === 1, 'the transit ran once');
  ok(!h.crewFree && h.locksControls, 'out of the transit the crew is held again until control returns');
  const startPos = hull.pos.clone();
  // Through the exit: closed, then opening from its time, open at the brake; hidden until it opens; held until the brake,
  // launched, tracked, released at releaseAt.
  let e = 0;
  let openingAt = -1;
  let openAt = -1;
  let shownAt = -1;
  let heldUntil = -1;
  let releasedAt = -1;
  let viewUntil = -1;
  let brakeEnd: number | null = null;
  let falling = true;
  let lastOpen = 1;
  const posAtRelease = new THREE.Vector3();
  const tunnel: (number | null)[] = [];
  while (h.phase === 'exit') {
    const wasHeld = hull.held;
    if (wasHeld) tunnel.push(h.describe().cruise);
    await frame(h, w);
    e += DT;
    inSystemExit.push(h.describe().cruise);
    const c = w.rec.covers[w.rec.covers.length - 1];
    if (h.phase === 'exit') {
      if (!c.opening) falling = false;
      if (c.cover > lastOpen + 1e-9) falling = false;
      lastOpen = c.cover;
      if (openingAt < 0 && c.cover < 1) openingAt = e;
      if (openAt < 0 && c.cover <= 0) openAt = e;
    }
    if (shownAt < 0 && !h.hiddenToPeers) shownAt = e;
    if (wasHeld && !hull.held && heldUntil < 0) heldUntil = e;
    if (viewUntil < 0 && !h.holdsView(hull)) viewUntil = e;
    if (releasedAt < 0 && !h.locksControls) {
      releasedAt = e;
      posAtRelease.copy(hull.pos);
    }
    if (brakeEnd === null && h.describe().lastArrivalError !== null) brakeEnd = h.describe().lastArrivalError;
  }
  ok(falling, 'through the exit the tunnel only ever opens');
  ok(near(openingAt, tunnelOpeningAt(S)) && near(openAt, brakeAt(S)), `it opens from ${openingAt.toFixed(3)} s (wanted ${tunnelOpeningAt(S).toFixed(3)}) and is gone by the brake (${openAt.toFixed(3)} s, wanted ${brakeAt(S).toFixed(3)})`);
  ok(near(shownAt, tunnelOpeningAt(S)), `the others see the ship again as the tunnel opens (${shownAt.toFixed(3)} s)`);
  ok(near(heldUntil, brakeAt(S)) && hull.launches[0] === S.speed, `held in the tunnel until the brake (${heldUntil.toFixed(3)} s, wanted ${brakeAt(S)}), then launched at the scene's speed`);
  ok(tunnel.length > 0 && tunnel.every((c) => c === S.speed), `held, the jump's cruise reads the scene's speed (${[...new Set(tunnel)].join(', ')})`);
  ok(brakeEnd !== null && brakeEnd < 2, `at the brake's end the hull is within 2 m of the arrival (${brakeEnd?.toFixed(3)} m)`);
  ok(near(releasedAt, releaseAt(S)), `control returns at releaseAt (${releasedAt.toFixed(3)} s, wanted ${releaseAt(S)})`);
  ok(near(viewUntil, releaseAt(S)), `and the pilot's own view with it (${viewUntil.toFixed(3)} s)`);
  // Where the hull really is, against the point itself: at the brake's end it is on the point, and from there to the
  // release it carries on at the arrival cruise (the fake's 50 m/s), so it may be that far past it, and 2 m more.
  const pastEnd = 50 * (releaseAt(S) - brakeAt(S) - EXIT_BRAKE) + 2;
  const fromEnd = posAtRelease.distanceTo(new THREE.Vector3(0, 0, 6000));
  ok(fromEnd < pastEnd, `at the release the hull is ${fromEnd.toFixed(2)} m from the point (allowed ${pastEnd.toFixed(2)})`);
  ok(near(e, exitEnd(S)) && h.phase === 'idle', `the jump is over at exitEnd (${e.toFixed(3)} s)`);
  ok(hull.released && hull.cruise === 50, 'released: not held, last setGhost(false), jumpCruise null, cruising at the speed it had');
  ok(w.rec.lastTunnel === 'detach' && w.rec.held[w.rec.held.length - 1] === null, 'the tunnel is taken down and nobody is held aboard any more');
  const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(hull.group.quaternion);
  const toStation = new THREE.Vector3(3000, 0, 0).sub(hull.pos).normalize();
  ok(nose.dot(toStation) > 0.999, 'the hull arrives facing the station (game frame: the client X mirrored)');
  ok(startPos.distanceTo(new THREE.Vector3(0, 0, 6000)) > 100, 'it appeared short of the point and braked onto it');
  ok(h.describe().hits === 0 && !h.drives(hull) && h.prompt === null && !h.hiddenToPeers, 'no hits; the pilot has the hull again, shown to all');
  ok(h.describe().ghost === false && h.describe().carried === false, 'describe().ghost is false once the jump is over; nothing was carried');
  ok(w.rec.removed === 1, 'the exit effect is left to end by itself');
}

// 4. To another system: the same hull carried across (never disposed, never respawned), the exit flying it, released on
//    its arrival, reading the same cruise on every exit frame as inside a system.
{
  const w = makeWorld({ crossFrames: 20, readyFrames: 10 });
  const h = new Hyperspace(w.host);
  ok(h.start(dest('space_b', 'space_b_0', [0, 0, 6000])) === null, 'a jump to another system starts');
  await untilPhase(h, w, 'transit');
  await frame(h, w);
  ok(w.rec.cross === 1 && w.rec.crossHull === w.first, 'across systems: one crossing, handed the hull itself');
  ok(w.state.zone === 'space_b' && w.alive.has(w.first) && !w.first.disposed, 'the world is the other system now and the hull is still in it, never disposed');
  ok(h.drives(w.first) && h.crewFree && h.covered, 'the transit drives it, the crew walks, the tunnel is closed');
  await untilPhase(h, w, 'exit');
  ok(w.rec.cross === 1 && h.drives(w.first) && h.describe().carried, 'the exit flies the same hull, carried across');
  ok(w.rec.attached.length === 2 && w.rec.attached[1] === w.first, 'the tunnel is put round it again on the far side');
  ok(w.first.jumpCruise === S.speed && h.describe().cruise === S.speed, `it keeps the jump's cruise through the tunnel (${h.describe().cruise})`);
  const across: (number | null)[] = [];
  let lastError: number | null = null;
  while (h.phase === 'exit') {
    await frame(h, w);
    across.push(h.describe().cruise);
    if (h.describe().lastArrivalError !== null) lastError = h.describe().lastArrivalError;
  }
  ok(across.length === inSystemExit.length && across.every((c, i) => c === inSystemExit[i]), `the exit into another system reads the same cruise on every frame as the exit inside one (${across.length} frames against ${inSystemExit.length}; first difference at ${across.findIndex((c, i) => c !== inSystemExit[i])})`);
  ok(w.first.released && (lastError ?? 99) < 2, `the carried hull is released on its arrival (${lastError} m)`);
  ok(w.rec.lastTunnel === 'detach', 'and the tunnel is taken down');
}

// 4b. A slow destination: the transit lasts until it is ready, however long past the least time.
{
  const readyFrames = Math.round((TUNNEL_MIN + 2.5) / DT);
  const w = makeWorld({ readyFrames });
  const h = new Hyperspace(w.host);
  h.start(FAR_POINT, 0);
  await untilPhase(h, w, 'transit');
  const inside = await untilPhase(h, w, 'exit');
  ok(inside > TUNNEL_MIN + 2 && inside < TUNNEL_MIN + 3, `a destination ready after ${(readyFrames * DT).toFixed(1)} s keeps the tunnel closed that long (${inside.toFixed(2)} s)`);
  await untilPhase(h, w, 'idle');
}

// 5. Every early end releases the hull and takes the tunnel down: an abort in each phase, the hull lost, a crossing that
//    comes back empty or fails, a late crossing.
{
  for (const phase of ['enter', 'transit', 'exit'] as const) {
    const w = makeWorld({ readyFrames: 30 });
    const h = new Hyperspace(w.host);
    h.start(FAR_POINT);
    await untilPhase(h, w, phase);
    await framesFor(h, w, 0.1);
    h.abort(`test in ${phase}`);
    ok(h.phase === 'idle' && w.first.released, `abort in the ${phase} stage releases the hull`);
    ok(w.rec.lastTunnel === 'detach' && !h.covered && !h.hiddenToPeers && w.rec.held[w.rec.held.length - 1] === null, `and takes the tunnel down, shows the ship, holds no crew (${phase})`);
    ok(!h.locksControls && h.prompt === null && !h.holdsView(w.first), `and gives the controls and the view back (${phase})`);
    await framesFor(h, w, 1);
    ok(h.phase === 'idle' && w.first.ghostCalls[w.first.ghostCalls.length - 1] === false, `and nothing comes back afterwards (${phase})`);
  }
  // A hull the world disposed mid-jump (shot down, removed): its body is gone and touching it throws, as a
  // removed Rapier body's does. The jump must end cleanly without touching it, and give everything back.
  for (const phase of ['enter', 'exit'] as const) {
    const w = makeWorld();
    const h = new Hyperspace(w.host);
    h.start(FAR_POINT);
    await untilPhase(h, w, phase);
    await framesFor(h, w, 0.5);
    w.drop(w.first);
    w.state.ship = null;
    let threw: unknown = null;
    try {
      await frame(h, w);
      await frame(h, w);
    } catch (err) {
      threw = err;
    }
    ok(threw === null && h.phase === 'idle', `a hull disposed in the ${phase} stage: the jump ends and no frame throws (${threw ? String(threw) : 'none'})`);
    ok(w.rec.lastTunnel === 'detach', `and the tunnel is taken down (${phase})`);
    ok(!h.locksControls && h.prompt === null && !h.drives(w.first) && !h.drives({}), `and nothing is locked or driven afterwards (${phase})`);
  }
  {
    // Not carried (App.carryAcross refused before swapping): the hull is still in the world, and must not be left ghosted.
    const w = makeWorld({ cross: 'null' });
    const h = new Hyperspace(w.host);
    h.start(dest('space_b', 'space_b_0', [0, 0, 6000]));
    await untilPhase(h, w, 'idle');
    ok(w.rec.cross === 1 && w.first.released && !w.first.ghosted && w.first.jumpCruise === null && w.rec.lastTunnel === 'detach', 'a hull that could not be carried: released where it is, not left ghosted at jump speed, the tunnel down');
  }
  {
    const w = makeWorld({ cross: 'lost' });
    const h = new Hyperspace(w.host);
    let threw: unknown = null;
    try {
      h.start(dest('space_b', 'space_b_0', [0, 0, 6000]));
      await untilPhase(h, w, 'idle');
    } catch (err) {
      threw = err;
    }
    ok(threw === null && w.rec.cross === 1 && h.phase === 'idle' && w.rec.lastTunnel === 'detach', 'a hull lost in the crossing: the jump ends, the tunnel down, and the gone hull is never touched');
    ok(!h.locksControls && !h.drives({}), 'and nothing is locked or driven afterwards');
  }
  {
    const w = makeWorld({ cross: 'throw' });
    const h = new Hyperspace(w.host);
    const warn = console.warn;
    console.warn = () => {};
    let rejected: unknown = null;
    const onRejection = (err: unknown) => {
      rejected = err;
    };
    process.on('unhandledRejection', onRejection);
    h.start(dest('space_b', 'space_b_0', [0, 0, 6000]));
    await untilPhase(h, w, 'idle');
    await settle();
    process.off('unhandledRejection', onRejection);
    console.warn = warn;
    ok(w.rec.cross === 1 && h.phase === 'idle' && w.rec.lastTunnel === 'detach' && w.first.released, 'a crossing that throws after the swap: the jump ends, the hull released, the tunnel down');
    ok(rejected === null && !h.locksControls && !h.drives({}) && !h.drives(w.first), `and nothing is thrown out of the transit, locked or driven (${rejected ? String(rejected) : 'none'})`);
  }
  {
    const w = makeWorld({ crossFrames: 40 });
    const h = new Hyperspace(w.host);
    h.start(dest('space_b', 'space_b_0', [0, 0, 6000]));
    await untilPhase(h, w, 'transit');
    await framesFor(h, w, 0.1);
    h.abort('the character left');
    ok(w.first.released, 'aborted while crossing: the hull is let go at once, in the world it was carried to');
    await framesFor(h, w, 1);
    ok(h.phase === 'idle' && w.first.released && !h.drives(w.first) && w.rec.lastTunnel === 'detach', 'and when the crossing answers late the jump does not take it up again');
  }
}

// 6. The refusals: only in space, only the pilot, one at a time, a v2 pack, and "already there" inside a system only.
{
  const w = makeWorld();
  const h = new Hyperspace(w.host);
  ok(h.why(dest('space_a', 'near', [0, 0, 500])) === ALREADY, 'a point 500 m from the ship in its own system is refused with the pack\'s line');
  ok(h.why(dest('space_b', 'near', [0, 0, 500])) === null, 'the same coordinates in another system are accepted');
  ok(h.why(dest('space_a', 'station_x', [-1059, 0, 0], 'station', 382)) === ALREADY, 'a station whose stand-off end is 277 m from the ship is refused in its own system');
  ok(h.why(dest('space_a', 'station_y', [-4000, 0, 0], 'station', 300)) === null, 'a station 4 km off is not');
  ok(/convert the space zones again/.test(h.why(dest('space_old', 'p', [0, 0, 6000])) ?? ''), 'a system with no v2 pack asks for the conversion');
  ok(h.start(dest('space_a', 'near', [0, 0, 500])) === ALREADY && h.phase === 'idle', 'start refuses with the same line and nothing begins');
  h.start(FAR_POINT);
  ok(h.why(dest('space_b', 'p', [0, 0, 6000])) === 'already jumping', 'one jump at a time');
  h.cancel();
  w.state.ship = null;
  ok(h.why(FAR_POINT) === "the pilot's call", 'no ship at the controls: refused');
  w.state.ship = w.first;
  w.first.destroyed = true;
  ok(h.why(FAR_POINT) === 'the ship is destroyed' && h.start(FAR_POINT) === 'the ship is destroyed' && h.phase === 'idle', 'a destroyed ship cannot jump');
  w.first.destroyed = false;
  w.state.packHere = null;
  w.state.catalogue = null;
  w.state.zone = 'tatooine';
  ok(h.why(FAR_POINT) === 'only in space', 'on a planet: refused');
}

// 7. A slow frame while the tunnel is not closed is kept as the worst visible frame; hits stay 0 with no hit reported.
{
  const w = makeWorld();
  const h = new Hyperspace(w.host);
  h.start(FAR_POINT, 0.5);
  await untilPhase(h, w, 'enter');
  await frame(h, w, false, 0.030);
  ok(Math.abs(h.describe().worstVisibleFrameMs - 30) < 0.2, `a 30 ms frame in the enter stage is kept (${h.describe().worstVisibleFrameMs} ms)`);
  await untilPhase(h, w, 'transit');
  await frame(h, w, false, 0.080);
  ok(h.describe().worstVisibleFrameMs < 31, `an 80 ms frame inside the closed tunnel is not (${h.describe().worstVisibleFrameMs} ms)`);
  await untilPhase(h, w, 'idle');
  ok(h.describe().hits === 0, 'no hits when the hull reports none');
}

// 8. The tunnel's arithmetic.
{
  ok(brakeAt(S) + EXIT_BRAKE <= releaseAt(S) && releaseAt(S) <= exitEnd(S), 'the synthetic scene\'s exit timeline is ordered');
  const real = { enterSeconds: 2.2, exitSeconds: 5.2, speed: 900, fade: 0.4, limit: 35, enterPeak: 3.2, exitBurstAt: 4, exitClearAt: 5.011 };
  for (const [label, s] of [['a synthetic scene', S], ["the pack's numbers as converted", real]] as const) {
    ok(tunnelClosingAt(s) > 0 && tunnelClosingAt(s) < transitAt(s) && tunnelOpeningAt(s) > 0 && tunnelOpeningAt(s) < brakeAt(s), `closing inside the enter stage and opening before the brake (${label})`);
    const o = { cover: -1, opening: true };
    ok(tunnelCover('enter', 0, s, o).cover === 0 && tunnelCover('enter', transitAt(s), s, o).cover === 1 && tunnelCover('transit', 0, s, o).cover === 1, `closed by the transit (${label})`);
    ok(tunnelCover('exit', 0, s, o).cover === 1 && tunnelCover('exit', brakeAt(s), s, o).cover === 0 && tunnelCover('exit', 0, s, o).opening, `open by the brake (${label})`);
    ok(tunnelCover('idle', 3, s, o).cover === 0 && tunnelCover('countdown', 3, s, o).cover === 0 && !o.opening, `none outside the jump (${label})`);
    ok(tunnelCover('transit', 0, s, o) === o && tunnelCover('exit', 1, s, o) === o, `the cover is written into the object handed in, so a frame makes none (${label})`);
    ok(hiddenToPeers('enter', 0, s) && hiddenToPeers('transit', 99, s) && hiddenToPeers('exit', tunnelOpeningAt(s) - 0.01, s) && !hiddenToPeers('exit', tunnelOpeningAt(s), s) && !hiddenToPeers('countdown', 1, s), `the others' window: the enter stage's start to the opening (${label})`);
  }
  // The jump camera (the chase's offset, up by 0.32 of the distance back) and the hull's own box are inside the tunnel for
  // any hull, and the far plane reaches past the tip from the camera.
  for (const r of [0.5, 3, 7, 15, 40, 90, 250]) {
    const back = jumpChaseBack(r);
    const d = back / Math.hypot(1, 0.32);
    const size = tunnelSize(r, back);
    const cam: [number, number, number] = [0, 0.32 * d, -d];
    const hullPts: [number, number, number][] = [[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]];
    ok(insideTunnel(cam, size, 0.8) && hullPts.every((p) => insideTunnel(p, size, 0.8)), `a hull of radius ${r} m: the jump camera ${back.toFixed(1)} m behind and the hull are well inside the tunnel (radius ${size.radius.toFixed(1)} m, half-length ${size.length.toFixed(0)} m)`);
    const far = tunnelCameraFar(size, back, r);
    ok(far > Math.hypot(0.32 * d, size.length + d) && far > size.length + r * 2, `and the far plane (${far.toFixed(0)} m) reaches past its tip from the camera and from anywhere in the hull`);
  }
  ok(jumpChaseBack(7, TUNNEL_TIMES.zoom) === jumpChaseBack(7), 'the jump camera sits at its own fixed zoom by default');
  // The timing is live: a longer close starts the tunnel closing sooner, and the zoom moves the camera back.
  const kept = { ...TUNNEL_TIMES };
  const before = tunnelClosingAt(S);
  const back = jumpChaseBack(7);
  TUNNEL_TIMES.close += 0.5;
  TUNNEL_TIMES.zoom = 12;
  ok(near(tunnelClosingAt(S), Math.max(0, before - 0.5), 1e-9) && jumpChaseBack(7) > back, `TUNNEL_TIMES is read live (closing at ${tunnelClosingAt(S).toFixed(2)} s, was ${before.toFixed(2)})`);
  Object.assign(TUNNEL_TIMES, kept);
}

// 9. The least time inside is read live, and a jump inside a system never runs the carried settle.
{
  const kept = TUNNEL_TIMES.min;
  TUNNEL_TIMES.min = 2;
  const w = makeWorld();
  const h = new Hyperspace(w.host);
  w.jump.h = h;
  h.start(FAR_POINT, 0);
  await untilPhase(h, w, 'transit');
  const inside = await untilPhase(h, w, 'exit');
  TUNNEL_TIMES.min = kept;
  ok(near(inside, 2, DT * 2.5), `with the least time set to 2 s the transit lasts ${inside.toFixed(3)} s`);
  ok(w.rec.settled.length === 0, 'inside a system nothing is compiled again: the world was never swapped');
  ok((w.rec.keptIn.enter ?? 0) >= Math.round(transitAt(S) / DT) - 2, `the crew is kept aboard through the enter stage too (${w.rec.keptIn.enter ?? 0} frames)`);
  await untilPhase(h, w, 'idle');
}

// 10. To another system the tunnel stays closed until the carried settle is done (the reflections, the last compile),
//     however long that takes past the least time, and it is asked once, at the arrival's start, within the scene's limit.
{
  const settleFrames = Math.round((TUNNEL_MIN + 1.5) / DT);
  const w = makeWorld({ crossFrames: 5, readyFrames: 5, settleFrames });
  const h = new Hyperspace(w.host);
  w.jump.h = h;
  h.start(dest('space_b', 'space_b_0', [0, 0, 6000]), 0);
  await untilPhase(h, w, 'transit');
  const inside = await untilPhase(h, w, 'exit');
  const expected = (5 + 5 + settleFrames) * DT;
  ok(inside >= TUNNEL_MIN + 1.5 && near(inside, expected, DT * 4), `the transit waits for the carried settle (${inside.toFixed(2)} s, about ${expected.toFixed(2)})`);
  const call = w.rec.settled[0];
  ok(w.rec.settled.length === 1 && call.envMs === 5000 && call.ms >= 1000 && call.ms <= S.limit * 1000, `settled once, waiting up to 5 s for the reflections, within the scene's limit (${call?.ms.toFixed(0)} ms left)`);
  ok(call.at.distanceTo(w.first.pos) < 1e-6 && w.first.held, "round the arrival's start, where the hull was put and is held until the tunnel opens");
  ok(h.describe().carried, 'the same hull, carried');
  await untilPhase(h, w, 'idle');
  ok(w.first.released, 'and released on arrival');
}

// 11. An abort while the carried settle runs drops its late answer.
{
  const w = makeWorld({ crossFrames: 3, readyFrames: 3, settleFrames: 60 });
  const h = new Hyperspace(w.host);
  w.jump.h = h;
  h.start(dest('space_b', 'space_b_0', [0, 0, 6000]), 0);
  await untilPhase(h, w, 'transit');
  await framesFor(h, w, 0.3);
  ok(w.rec.settled.length === 1, 'the settle is under way');
  h.abort('the character left');
  await framesFor(h, w, 1.5);
  ok(h.phase === 'idle' && w.first.released && !h.drives(w.first) && w.rec.lastTunnel === 'detach', 'aborted in the settle: released, and its late answer does not start an exit');
}

console.log(`hyperspaceJump: ${checks} checks passed`);
