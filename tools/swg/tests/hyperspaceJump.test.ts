// The hyperspace jump's phase machine (src/space/hyperspace.ts) against a fake host and a fake hull:
// the countdown and its banner (held still while the menu is open), cancelling, the enter stage's
// ghosting and veil, the transit inside a system (one teleport) and to another (one crossing), the
// exit's brake onto the arrival, the release at the right moment, and every way a jump can end early
// releasing a hull still in the world (and never touching one the world has disposed). Synthetic packs
// only: no number from the client's files.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Hyperspace, type HyperspaceHost, type JumpHull } from '../../../src/space/hyperspace.ts';
import { brakeAt, EXIT_BRAKE, exitEnd, releaseAt, sceneOf, transitAt, veilUpAt } from '../../../src/space/hyperspaceMath.ts';
import type { Destination, HyperspaceCatalogue, SpacePack } from '../../../src/space/spaceData.ts';
import type { EffectHandle } from '../../../src/world/particles';

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
  setGhost(on: boolean): void {
    if (this.disposed) throw new Error('unreachable');
    this.ghostCalls.push(on);
  }
  get ghosted(): boolean {
    return this.ghostCalls[this.ghostCalls.length - 1] === true;
  }
  teleport(p: THREE.Vector3, q: THREE.Quaternion, speed: number): void {
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
  /** 'null': travelled, nothing spawned. 'stay': returned null without travelling (nobody at the controls). 'throw': failed after the old world went. */
  cross?: 'hull' | 'null' | 'stay' | 'throw';
}

/** The fake App: records what the jump asks of it; readyAround and crossZone resolve after some frames. */
function makeWorld(opts: Opts = {}) {
  const first = new FakeHull();
  const rec = { banners: [] as (string | null)[], veils: [] as boolean[], placed: [] as string[], removed: 0, moved: 0, cross: 0, closed: 0, afterTeleport: 0, spawned: [] as FakeHull[] };
  const state = { zone: 'space_a', ship: first as FakeHull | null, packHere: PACKS.space_a as SpacePack | null, catalogue: catalogue as HyperspaceCatalogue | null };
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
    afterTeleport: () => {
      rec.afterTeleport++;
    },
    crossZone: (zone, pose) => {
      rec.cross++;
      return after(opts.crossFrames ?? 5, () => {
        // App.travel returns null before travelling when nobody is at the controls: the old world stays.
        if (opts.cross === 'stay') return null;
        // The old world goes whatever comes of it; `travel` unloads it before the arrival can fail.
        drop(first);
        if (opts.cross === 'throw') throw new Error('synthetic travel failure');
        state.zone = zone;
        state.packHere = PACKS[zone] ?? null;
        if (opts.cross === 'null') {
          state.ship = null;
          return null;
        }
        const next = new FakeHull();
        next.pos.copy(pose.pos);
        next.group.position.copy(pose.pos);
        next.group.quaternion.copy(pose.quaternion);
        // Spawned held and ghosted where it arrives, for the jump to release (App.arriveInShip with hold).
        next.held = true;
        next.setGhost(true);
        alive.add(next);
        rec.spawned.push(next);
        state.ship = next;
        return next;
      });
    },
    closePanels: () => {
      rec.closed++;
    },
    ui: {
      veil: (on) => {
        rec.veils.push(on);
      },
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
  return { host, first, rec, state, alive, drop, tickWaits };
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

// 1. The countdown's banner: once per whole second, not at all while the menu is open (and it does not advance).
{
  const w = makeWorld();
  const h = new Hyperspace(w.host);
  ok(h.start(FAR_POINT) === null, 'a jump 6 km away in the same system starts');
  ok(h.phase === 'countdown' && w.rec.banners.length === 1 && /in 5$/.test(w.rec.banners[0] ?? ''), 'the banner shows 5 at once');
  ok(h.prompt === w.rec.banners[0], 'the prompt line reads the same as the banner');
  await framesFor(h, w, 2, true);
  ok(h.phase === 'countdown' && w.rec.banners.length === 1, 'two seconds with the menu open: no banner written, still counting');
  ok(!h.locksControls && !h.drives(w.first), 'nothing is locked or driven in the countdown');
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
  ok(h.phase === 'idle' && w.first.ghostCalls.length === 0, 'and nothing starts later');
}

// 3. A whole jump inside the system: the timeline, one teleport, the brake onto the arrival, the release.
{
  const w = makeWorld();
  const h = new Hyperspace(w.host);
  const hull = w.first;
  h.start(FAR_POINT);
  await untilPhase(h, w, 'enter');
  ok(hull.ghostCalls.length === 1 && hull.ghostCalls[0] === true, 'setGhost(true) at the start of the enter stage');
  ok(w.rec.closed === 1, 'the panels are closed at the start of the enter stage');
  ok(w.rec.placed[0] === 'fx/enter.json', 'the enter effect is placed on the hull');
  ok(h.locksControls && h.drives(hull) && h.prompt === 'jumping', 'from the enter stage the jump flies the hull and locks the controls');
  ok(h.describe().ghost === true, "describe().ghost reads the hull's own state: ghosted in the enter stage");
  // Through the enter stage, noting when the veil rises and when the transit begins.
  let t = 0;
  let veilAt = -1;
  let rising = 0;
  while (h.phase === 'enter') {
    await frame(h, w);
    t += DT;
    if (veilAt < 0 && w.rec.veils.includes(true)) veilAt = t;
    if (hull.jumpCruise !== null && hull.jumpCruise >= rising) rising = hull.jumpCruise;
  }
  ok(Math.abs(veilAt - veilUpAt(S)) <= DT * 1.5, `the veil rises at the streaks' peak (${veilAt.toFixed(3)} s, wanted ${veilUpAt(S)})`);
  ok(Math.abs(t - transitAt(S)) <= DT * 1.5 && h.veiled, `the transit starts under the veil (${t.toFixed(3)} s, wanted ${transitAt(S)})`);
  ok(rising === S.speed, `the enter stage reached the scene's speed (${rising})`);
  ok(hull.teleports === 1 && w.rec.moved === 1 && w.rec.afterTeleport === 1 && w.rec.cross === 0, 'inside the system: one teleport, the world moved once, no crossing');
  ok(w.rec.removed === 1, 'the enter effect is removed before the move');
  ok(h.drives(hull) && h.locksControls, 'still flown and locked in the transit');
  await untilPhase(h, w, 'exit');
  ok(!h.veiled && w.rec.veils[w.rec.veils.length - 1] === false, 'the veil lifts at the start of the exit');
  ok(w.rec.placed[1] === 'fx/exit.json', 'the exit effect is placed on the hull');
  ok(hull.teleports === 1, 'the transit ran once');
  const startPos = hull.pos.clone();
  // Through the exit: held until the brake, launched, tracked, released at releaseAt.
  let e = 0;
  let heldUntil = -1;
  let releasedAt = -1;
  let brakeEnd: number | null = null;
  const posAtRelease = new THREE.Vector3();
  while (h.phase === 'exit') {
    const wasHeld = hull.held;
    await frame(h, w);
    e += DT;
    if (wasHeld && !hull.held && heldUntil < 0) heldUntil = e;
    if (releasedAt < 0 && !h.locksControls) {
      releasedAt = e;
      posAtRelease.copy(hull.pos);
    }
    if (brakeEnd === null && h.describe().lastArrivalError !== null) brakeEnd = h.describe().lastArrivalError;
  }
  ok(Math.abs(heldUntil - brakeAt(S)) <= DT * 1.5 && hull.launches[0] === S.speed, `held in the tunnel until the brake (${heldUntil.toFixed(3)} s, wanted ${brakeAt(S)}), then launched at the scene's speed`);
  ok(brakeEnd !== null && brakeEnd < 2, `at the brake's end the hull is within 2 m of the arrival (${brakeEnd?.toFixed(3)} m)`);
  ok(Math.abs(releasedAt - releaseAt(S)) <= DT * 1.5, `control returns at releaseAt (${releasedAt.toFixed(3)} s, wanted ${releaseAt(S)})`);
  // Where the hull really is, against the point itself: at the brake's end it is on the point, and from there to the
  // release it carries on at the arrival cruise (the fake's 50 m/s), so it may be that far past it, and 2 m more.
  const pastEnd = 50 * (releaseAt(S) - brakeAt(S) - EXIT_BRAKE) + 2;
  const fromEnd = posAtRelease.distanceTo(new THREE.Vector3(0, 0, 6000));
  ok(fromEnd < pastEnd, `at the release the hull is ${fromEnd.toFixed(2)} m from the point (allowed ${pastEnd.toFixed(2)})`);
  ok(Math.abs(e - exitEnd(S)) <= DT * 1.5 && h.phase === 'idle', `the jump is over at exitEnd (${e.toFixed(3)} s)`);
  ok(hull.released && hull.cruise === 50, 'released: not held, last setGhost(false), jumpCruise null, cruising at the speed it had');
  const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(hull.group.quaternion);
  const toStation = new THREE.Vector3(3000, 0, 0).sub(hull.pos).normalize();
  ok(nose.dot(toStation) > 0.999, 'the hull arrives facing the station (game frame: the client X mirrored)');
  ok(startPos.distanceTo(new THREE.Vector3(0, 0, 6000)) > 100, 'it appeared short of the point and braked onto it');
  ok(h.describe().hits === 0 && !h.drives(hull) && h.prompt === null, 'no hits; the pilot has the hull again');
  ok(h.describe().ghost === false, 'and describe().ghost, read from the ship flown, is false once the jump is over');
  ok(w.rec.removed === 1, 'the exit effect is left to end by itself');
}

// 4. To another system: one crossing, the exit on the hull spawned there, released at releaseAt.
{
  const w = makeWorld({ crossFrames: 20, readyFrames: 10 });
  const h = new Hyperspace(w.host);
  ok(h.start(dest('space_b', 'space_b_0', [0, 0, 6000])) === null, 'a jump to another system starts');
  await untilPhase(h, w, 'transit');
  ok(w.rec.cross === 1 && w.first.teleports === 0, 'across systems: one crossing, no teleport');
  ok(h.drives(w.first), 'the transit drives whatever the pilot has');
  await untilPhase(h, w, 'exit');
  const next = w.rec.spawned[0];
  ok(!!next && w.rec.cross === 1, 'the hull spawned there is flown out');
  ok(h.drives(next) && !h.drives(w.first), 'the exit flies the new hull, not the old one');
  await untilPhase(h, w, 'idle');
  ok(next.released && (h.describe().lastArrivalError ?? 99) < 2, `the new hull is released on its arrival (${h.describe().lastArrivalError} m)`);
}

// 5. Every early end releases the hull: an abort in each phase, the hull lost, a crossing that comes back empty or fails, a late crossing.
{
  for (const phase of ['enter', 'transit', 'exit'] as const) {
    const w = makeWorld({ readyFrames: 30 });
    const h = new Hyperspace(w.host);
    h.start(FAR_POINT);
    await untilPhase(h, w, phase);
    await framesFor(h, w, 0.1);
    h.abort(`test in ${phase}`);
    ok(h.phase === 'idle' && w.first.released, `abort in the ${phase} stage releases the hull`);
    ok(!h.veiled && (w.rec.veils.length === 0 || w.rec.veils[w.rec.veils.length - 1] === false), `and leaves no veil up (${phase})`);
    ok(!h.locksControls && h.prompt === null, `and gives the controls back (${phase})`);
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
    ok(!h.veiled && (w.rec.veils.length === 0 || w.rec.veils[w.rec.veils.length - 1] === false), `and the veil is lifted (${phase})`);
    ok(!h.locksControls && h.prompt === null && !h.drives(w.first) && !h.drives({}), `and nothing is locked or driven afterwards (${phase})`);
  }
  {
    const w = makeWorld({ cross: 'null' });
    const h = new Hyperspace(w.host);
    h.start(dest('space_b', 'space_b_0', [0, 0, 6000]));
    await untilPhase(h, w, 'idle');
    ok(w.rec.cross === 1 && !h.veiled && w.rec.veils[w.rec.veils.length - 1] === false, 'a crossing that brings no hull: the jump ends with the veil lifted');
    ok(!h.locksControls && !h.drives({}), 'and nothing is locked or driven afterwards');
  }
  {
    // Returned null without travelling: the old hull is still in the world, and must not be left ghosted at jump speed.
    const w = makeWorld({ cross: 'stay' });
    const h = new Hyperspace(w.host);
    h.start(dest('space_b', 'space_b_0', [0, 0, 6000]));
    await untilPhase(h, w, 'idle');
    ok(w.rec.cross === 1 && !h.veiled && w.first.released && !w.first.ghosted && w.first.jumpCruise === null, 'a crossing that never travelled: the old hull is released, not left ghosted at jump speed');
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
    ok(w.rec.cross === 1 && h.phase === 'idle' && !h.veiled && w.rec.veils[w.rec.veils.length - 1] === false, 'a crossing that throws after the old world went: the jump ends with the veil lifted');
    ok(rejected === null && !h.locksControls && !h.drives({}) && !h.drives(w.first), `and nothing is thrown out of the transit, locked or driven (${rejected ? String(rejected) : 'none'})`);
  }
  {
    const w = makeWorld({ crossFrames: 40 });
    const h = new Hyperspace(w.host);
    h.start(dest('space_b', 'space_b_0', [0, 0, 6000]));
    await untilPhase(h, w, 'transit');
    await framesFor(h, w, 0.1);
    h.abort('the character left');
    await framesFor(h, w, 1);
    const late = w.rec.spawned[0];
    ok(h.phase === 'idle' && !!late && late.released, 'aborted while crossing: the hull that arrives late is released, not left held');
    ok(!h.drives(late), 'and the jump does not take it up');
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
  w.state.packHere = null;
  w.state.catalogue = null;
  w.state.zone = 'tatooine';
  ok(h.why(FAR_POINT) === 'only in space', 'on a planet: refused');
}

// 7. A slow frame while nothing is veiled is kept as the worst visible frame; hits stay 0 with no hit reported.
{
  const w = makeWorld();
  const h = new Hyperspace(w.host);
  h.start(FAR_POINT, 0.5);
  await untilPhase(h, w, 'enter');
  await frame(h, w, false, 0.030);
  ok(Math.abs(h.describe().worstVisibleFrameMs - 30) < 0.2, `a 30 ms frame in the enter stage is kept (${h.describe().worstVisibleFrameMs} ms)`);
  await untilPhase(h, w, 'idle');
  ok(h.describe().hits === 0, 'no hits when the hull reports none');
}

// Timeline sanity for the scene used above (the math module's own tests cover it in full).
ok(brakeAt(S) + EXIT_BRAKE <= releaseAt(S) && releaseAt(S) <= exitEnd(S), 'the synthetic scene\'s exit timeline is ordered');

console.log(`hyperspaceJump: ${checks} checks passed`);
