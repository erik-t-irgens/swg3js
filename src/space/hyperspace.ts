// The hyperspace jump itself: a short countdown, then the game's own three stages timed from its
// files (scene/hyperspace.iff and the two warp effects, as the converter wrote them into space.json),
// with a tunnel of our own in place of the client's (hyperspaceTunnel.ts).
// Enter: the ship vanishes for the others, the hull speeds up to the scene's speed while the game's warp
// streaks play framed on it, and the tunnel closes round it from the tip back as the streaks peak.
// Transit (inside the closed tunnel, the world not drawn): the hull is held still and whoever is aboard
// its rooms may walk; inside the system it is moved at once, to another system the world is swapped
// under it with the hull, its rooms and its crew carried across; the world there is loaded and compiled
// while the tunnel runs, for at least TUNNEL_TIMES.min seconds. Exit: the tunnel opens from the tip, the
// others see the ship again, the hull brakes onto the arrival and is handed back.
//
// No DOM and no world here: everything goes through the host (App) and the hull (Vehicle), so a node
// test can drive the phases against fakes. Imports three and the pure math only.
import * as THREE from 'three';
import type { Destination, HyperspaceCatalogue, SpacePack, Vec3 } from './spaceData.ts';
import type { EffectHandle } from '../world/particles';
import {
  ALREADY_THERE,
  ENVIRONMENT_WAIT,
  EXIT_BRAKE,
  JUMP_COUNTDOWN,
  TUNNEL_TIMES,
  arrivalPose,
  brakeAt,
  enterSpeed,
  exitEnd,
  exitTravelled,
  hiddenToPeers,
  lookRotation,
  releaseAt,
  sceneOf,
  toGame,
  trackedCruise,
  transitAt,
  tunnelCover,
  type JumpScene,
  type TunnelCover,
} from './hyperspaceMath.ts';
import { arrivalAt, landmarksOf } from './spaceData.ts';

export type JumpPhase = 'idle' | 'countdown' | 'enter' | 'transit' | 'exit';

/** What the jump touches on a hull; `Vehicle` satisfies it, the test's fake does too. */
export interface JumpHull {
  /** Its matrixWorld frames the effects; the tunnel follows it. */
  readonly group: THREE.Object3D;
  /** Where it is, in the world (the game frame). */
  readonly pos: THREE.Vector3;
  readonly radius: number;
  readonly spec: { maxSpeed: number };
  cruise: number;
  held: boolean;
  jumpCruise: number | null;
  setGhost(on: boolean): void;
  /** Whether the hull is ghosted now, as the hull itself says (`Vehicle.ghosted`), for `describe`. */
  readonly ghosted?: boolean;
  /** Destroyed (`Vehicle.destroyed`): a destroyed ship cannot jump. */
  readonly destroyed?: boolean;
  teleport(pos: THREE.Vector3, quaternion: THREE.Quaternion, speed: number): void;
  launch(speed: number): void;
  readonly justHit: number;
}

/** The countdown line in the middle of the screen. */
export interface HyperspaceUiPort {
  banner(text: string | null): void;
}

/** The tunnel round the hull (the App's HyperspaceTunnel, sized for the hull and the jump camera). */
export interface TunnelPort {
  /** Round this hull from now on, hidden until a cover is set. */
  attach(hull: JumpHull): void;
  /** This frame's cover (0 none, 1 closed round the ship), whether it is opening, and the seconds its clock runs on. */
  set(cover: number, opening: boolean, dt: number): void;
  /** Gone: hidden, following nothing, the camera's far plane back. */
  detach(): void;
}

export interface HyperspaceHost {
  /** The zone the player is in (world.planet.id). */
  zone(): string;
  /** The ship the player flies, or null (App.pilotedShip). */
  ship(): JumpHull | null;
  /** Still in the world's vehicles. */
  alive(h: JumpHull): boolean;
  /** The System Map's catalogue once loaded, else null. */
  catalogue(): HyperspaceCatalogue | null;
  /** This zone's pack (world.spaceData). */
  packHere(): SpacePack | null;
  /** World.placeZoneEffect: transient, `local` in the hull's frame `frame` (kept by reference); the untextured quads are not drawn. */
  placeEffect(file: string, local: THREE.Matrix4, frame: THREE.Matrix4): EffectHandle | null;
  removeEffect(h: EffectHandle): void;
  /** World.hyperspaceEffects. */
  effects(): { enter: string | null; exit: string | null };
  /** World.jumpTo: stream the world round a far point at once. */
  moveWorld(to: THREE.Vector3): void;
  /** World.readyAround. */
  readyAround(to: THREE.Vector3, timeoutMs: number): Promise<boolean>;
  /**
   * World.settleCarried, after a jump to another system is ready round `to`: the new zone's reflections waited for (at most
   * `envMs`), then every material in the scene compiled once more, as a loading screen's settle does, so a program whose
   * key changed when the reflections came is built under the closed tunnel and not on the frame it opens.
   */
  settleCarried(to: THREE.Vector3, envMs: number, timeoutMs: number): Promise<boolean>;
  /** After the hull was moved: the camera let go of its old place, the effects' history reset, the respawn point moved. */
  afterTeleport(at: THREE.Vector3): void;
  /**
   * App.carryAcross: the world swapped for `zone`'s with this hull carried across it (its body, its rooms, whoever is in
   * them), put at `pose` still held and ghosted. The hull (the same one), or null when it could not be carried.
   */
  crossZone(zone: string, hull: JumpHull, pose: { pos: THREE.Vector3; quaternion: THREE.Quaternion }): Promise<JumpHull | null>;
  /** Whoever is aboard this hull's rooms now is its crew for the jump (null: the jump is over, nobody is kept). */
  holdCrew(hull: JumpHull | null): void;
  /** The crew held, stepped out of the rooms since (through a door in the tunnel), is put back aboard at the entry. */
  keepCrew(): void;
  /** The tunnel's program made ready before the jump (a key lookup unless something marked it for a rebuild). */
  prepareTunnel(): void;
  /** How many programs the renderer has (for the count made while the tunnel was closed), or 0. */
  programs(): number;
  closePanels(): void;
  tunnel: TunnelPort;
  ui: HyperspaceUiPort;
}

/** The ship's own speed on arrival is kept, but never slower than this or faster than space's top speed (m/s). */
const EXIT_CRUISE_MIN = 40;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export class Hyperspace {
  phase: JumpPhase = 'idle';
  /** The effects' turn about the hull's Y in degrees, and how far ahead of the hull they are placed (metres along the nose), for checking by eye (__debug.jumpFx). */
  fxTurn = 0;
  fxAhead = 0;

  private readonly host: HyperspaceHost;
  /** Seconds into the present phase (the countdown's seconds left while counting). */
  private t = 0;
  private dest: Destination | null = null;
  private destPack: SpacePack | null = null;
  private scene: JumpScene | null = null;
  /** The hull the jump flies: taken at the start of enter; carried to another system, it is the same one. */
  private hull: JumpHull | null = null;
  /** The cruise when the jump began, and the one the ship arrives at. */
  private c0 = 0;
  private exitCruise = EXIT_CRUISE_MIN;
  /** The jump's cruise as the enter stage left it (the scene's speed): the hull keeps it through the tunnel. */
  private tunnelCruise = 0;
  /** Bumped by every abort: a transit's late result is dropped when its token has gone stale. */
  private token = 0;
  private enterFx: EffectHandle | null = null;
  private exitFx: EffectHandle | null = null;
  /** The destination is loaded round the arrival: the exit begins once the tunnel has run its least time. */
  private ready = false;
  /** The hull came through a change of system the same hull (its rooms and crew with it). */
  private carried = false;
  /** This frame's tunnel, as last handed to the host. */
  private cover = 0;
  private braking = false;
  /** The exit stage's time on the frame the brake began. */
  private brakeFrom = 0;
  private brakeDone = false;
  private released = false;
  /** The whole second shown last in the countdown (the banner is written when it changes). */
  private shownSecond = -1;
  private countText: string | null = null;
  private hits = 0;
  private lastArrivalError: number | null = null;
  private worstVisibleFrameMs = 0;
  private sameZone = false;
  /** The renderer's programs when the tunnel closed (-1 while it is not closed), and how many were made while it was. */
  private programsAtClose = -1;
  private tunnelPrograms = 0;

  // Kept scratch objects: nothing is allocated per frame.
  /** Where the hull appears (so that braking brings it to `end`), where the jump ends, and the way it faces, game frame. */
  private readonly startAt = new THREE.Vector3();
  private readonly end = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly turn = new THREE.Quaternion();
  private readonly local = new THREE.Matrix4();
  private readonly ahead = new THREE.Matrix4();
  private readonly along = new THREE.Vector3();
  private readonly coverOut: TunnelCover = { cover: 0, opening: false };

  constructor(host: HyperspaceHost) {
    // Stored only: nothing on the host is called from here (it is built in App's constructor).
    this.host = host;
  }

  /** Begin the countdown; null when it has begun, else why it cannot. */
  start(dest: Destination, countdown = JUMP_COUNTDOWN): string | null {
    const why = this.why(dest);
    if (why) return why;
    this.dest = dest;
    this.destPack = this.packOf(dest.zone);
    this.scene = sceneOf(this.destPack);
    this.phase = 'countdown';
    this.t = Math.max(0, countdown);
    this.shownSecond = -1;
    this.showCount();
    // The tunnel's program is in the cache from the loading screen; this only builds it if something marked it since.
    this.host.prepareTunnel();
    return null;
  }

  /** Why a destination cannot be jumped to now, or null: the same rules as `start`, for the panel. */
  why(dest: Destination): string | null {
    const host = this.host;
    const here = host.zone();
    const inSpace = !!host.packHere() || !!host.catalogue()?.systems.some((s) => s.id === here);
    if (!inSpace) return 'only in space';
    const ship = host.ship();
    if (!ship) return "the pilot's call";
    if (ship.destroyed) return 'the ship is destroyed';
    if (this.phase !== 'idle') return 'already jumping';
    const pack = this.packOf(dest.zone);
    if (!pack || (pack.version ?? 1) < 2 || !pack.hyperspace) return 'convert the space zones again: npm run swg -- space @SWG all assets-private --retail-only';
    // Only inside a system is a jump refused for distance: every orbit's launch point is the origin, and a jump between orbits always goes.
    if (dest.zone === here) {
      const s = sceneOf(pack);
      const cruise = clamp(ship.cruise, EXIT_CRUISE_MIN, Math.max(EXIT_CRUISE_MIN, ship.spec.maxSpeed * 2));
      const pose = arrivalPose({ kind: dest.kind, at: toGame(dest.at), radius: dest.radius }, landmarksOf(pack), [ship.pos.x, ship.pos.y, ship.pos.z], cruise, s);
      const [ex, ey, ez] = pose.end;
      if (Math.hypot(ex - ship.pos.x, ey - ship.pos.y, ez - ship.pos.z) < ALREADY_THERE) return pack.hyperspace.messages?.alreadyAtPoint ?? 'already there';
    }
    return null;
  }

  /** The countdown only: nothing else has happened yet, so nothing is undone. */
  cancel(why?: string): void {
    if (this.phase !== 'countdown') return;
    this.phase = 'idle';
    this.dest = null;
    this.countText = null;
    this.host.ui.banner(null);
    if (why) console.info(`hyperspace: cancelled (${why})`);
  }

  /** At any phase: remove the effects and the tunnel, release the hull, go idle, and drop any transit's late result. */
  abort(why: string): void {
    if (this.phase === 'idle') return;
    const counting = this.phase === 'countdown';
    this.token++;
    this.removeEffects();
    this.host.ui.banner(null);
    const hull = this.hull;
    // A hull no longer in the world has had its body removed: there is nothing to release, and touching it throws.
    if (hull && !counting && this.host.alive(hull)) this.releaseHull(hull);
    this.finish();
    console.info(`hyperspace: the jump ${counting ? 'was called off' : 'ended early'} (${why})`);
  }

  /** Once a frame while not travelling. `menuOpen` holds the countdown still; the later phases run on (the physics does). */
  update(dt: number, rawDt: number, menuOpen: boolean): void {
    switch (this.phase) {
      case 'idle':
        return;
      case 'countdown':
        if (menuOpen) return;
        this.t -= dt;
        if (this.t > 0) {
          this.showCount();
          return;
        }
        this.beginEnter();
        return;
      case 'enter':
        this.updateEnter(dt, rawDt);
        return;
      case 'transit':
        this.t += dt;
        this.showTunnel(dt);
        this.host.keepCrew();
        // Loaded round the arrival and inside long enough: out through the far end on this frame.
        if (this.ready && this.t >= TUNNEL_TIMES.min) this.beginExit();
        return;
      case 'exit':
        this.updateExit(dt, rawDt);
        return;
    }
  }

  /** Whether this vehicle is flown by the jump this frame (the pilot's input is ignored). In the transit, whatever the pilot has. */
  drives(v: unknown): boolean {
    if (v === null || v === undefined) return false;
    if (this.phase === 'transit') return true;
    return (this.phase === 'enter' || this.phase === 'exit') && !this.released && v === this.hull;
  }

  /** Enter, transit and exit up to the release: P and the ship menu do nothing, and E only what `crewFree` allows. */
  get locksControls(): boolean {
    return this.phase === 'enter' || this.phase === 'transit' || (this.phase === 'exit' && !this.released);
  }

  /** In the closed tunnel, whoever is aboard may walk the rooms, work the lifts and take or let go of the controls (never the door). */
  get crewFree(): boolean {
    return this.phase === 'transit';
  }

  /** Whether the view of this vehicle's pilot is the jump's (behind the ship, fixed): the hull the jump flies, until control returns. */
  holdsView(v: unknown): boolean {
    return v !== null && v !== undefined && v === this.hull && this.locksControls;
  }

  /** The tunnel is closed round the ship: the world is not drawn, and programs made now are the destination's, made on purpose. */
  get covered(): boolean {
    return this.phase !== 'idle' && this.phase !== 'countdown' && this.cover >= 1;
  }

  /** Whether the others should not see the ship now (the relay's jumping flag): from the enter stage until the tunnel opens. */
  get hiddenToPeers(): boolean {
    return !!this.scene && hiddenToPeers(this.phase, this.t, this.scene);
  }

  /** The countdown or "jumping" for the prompt line, or null. */
  get prompt(): string | null {
    if (this.phase === 'countdown') return this.countText;
    return this.locksControls ? 'jumping' : null;
  }

  describe(): { phase: JumpPhase; t: number; dest: string | null; cruise: number | null; ghost: boolean; tunnel: number; covered: boolean; hidden: boolean; carried: boolean; tunnelPrograms: number; hits: number; lastArrivalError: number | null; worstVisibleFrameMs: number } {
    const hull = this.hull;
    return {
      phase: this.phase,
      t: Math.round(this.t * 100) / 100,
      dest: this.dest?.key ?? null,
      cruise: hull ? Math.round(hull.jumpCruise ?? hull.cruise) : null,
      // Read from the hull, not inferred from the phase, so a hull left ghosted (or never ghosted) shows.
      ghost: !!(hull ?? this.host.ship())?.ghosted,
      tunnel: Math.round(this.cover * 100) / 100,
      covered: this.covered,
      hidden: this.hiddenToPeers,
      carried: this.carried,
      tunnelPrograms: this.tunnelPrograms,
      hits: this.hits,
      lastArrivalError: this.lastArrivalError === null ? null : Math.round(this.lastArrivalError * 100) / 100,
      worstVisibleFrameMs: Math.round(this.worstVisibleFrameMs * 10) / 10,
    };
  }

  /** The destination system's pack: the catalogue's, or for this system the world's own. */
  private packOf(zone: string): SpacePack | null {
    const fromCatalogue = this.host.catalogue()?.pack(zone) ?? null;
    if (fromCatalogue) return fromCatalogue;
    return zone === this.host.zone() ? this.host.packHere() : null;
  }

  /** The countdown's line, written when the whole second shown changes (never per frame). */
  private showCount(): void {
    const n = Math.max(1, Math.ceil(this.t - 1e-6));
    if (n === this.shownSecond) return;
    this.shownSecond = n;
    this.countText = `Hyperspace to ${this.dest?.name ?? 'the point'} in ${n}`;
    this.host.ui.banner(this.countText);
  }

  /** The countdown ran out: the pilot's controls go, the hull is ghosted, the enter effect plays framed on it, the tunnel is readied round it. */
  private beginEnter(): void {
    const host = this.host;
    const dest = this.dest;
    const hull = host.ship();
    this.countText = null;
    host.ui.banner(null);
    if (!dest || !hull) {
      this.finish();
      console.info('hyperspace: no ship to jump');
      return;
    }
    host.closePanels();
    const s = (this.scene = sceneOf(this.destPack));
    this.hull = hull;
    this.c0 = hull.cruise;
    this.exitCruise = clamp(this.c0, EXIT_CRUISE_MIN, Math.max(EXIT_CRUISE_MIN, hull.spec.maxSpeed * 2));
    this.sameZone = dest.zone === host.zone();
    // Where the jump ends and where the hull must appear so that braking brings it there, in the game frame.
    const pack = this.destPack;
    const approach: Vec3 | null = this.sameZone ? [hull.pos.x, hull.pos.y, hull.pos.z] : arrivalAt(pack);
    const pose = arrivalPose({ kind: dest.kind, at: toGame(dest.at), radius: dest.radius }, pack ? landmarksOf(pack) : [], approach, this.exitCruise, s);
    this.startAt.fromArray(pose.start);
    this.end.fromArray(pose.end);
    this.forward.fromArray(pose.forward);
    this.turn.fromArray(lookRotation(pose.forward));
    this.hits = 0;
    this.lastArrivalError = null;
    this.worstVisibleFrameMs = 0;
    this.ready = false;
    this.carried = false;
    this.cover = 0;
    this.programsAtClose = -1;
    this.tunnelPrograms = 0;
    this.braking = false;
    this.brakeDone = false;
    this.released = false;
    hull.setGhost(true);
    hull.jumpCruise = this.c0;
    host.holdCrew(hull);
    host.tunnel.attach(hull);
    this.enterFx = this.placeOn(hull, host.effects().enter);
    this.phase = 'enter';
    this.t = 0;
  }

  private updateEnter(dt: number, rawDt: number): void {
    const hull = this.hull!;
    const s = this.scene!;
    if (!this.host.alive(hull)) {
      this.abort('the ship was lost');
      return;
    }
    this.watch(hull, rawDt);
    // Someone who walks out of a door while the hull speeds up is put back at once, not a second later at 900 m/s.
    this.host.keepCrew();
    this.t += dt;
    hull.jumpCruise = enterSpeed(this.t, this.c0, s);
    if (this.t >= transitAt(s)) {
      this.phase = 'transit';
      this.t = 0;
      this.tunnelCruise = hull.jumpCruise ?? s.speed;
      this.showTunnel(dt);
      void this.transit(this.token);
      return;
    }
    this.showTunnel(dt);
  }

  /**
   * The move, inside the closed tunnel, once per jump. The hull is held still (the crew walk a still room). Inside a system
   * it is put at the arrival's start and the world streamed there; to another system the world is swapped under it, the
   * hull carried across with its rooms and its crew and put at the start there. Either way the world round the start is
   * loaded and compiled before the tunnel opens (the exit waits for `ready`). A stale token (an abort meanwhile) drops the
   * result; an exception aborts.
   */
  private async transit(mine: number): Promise<void> {
    const host = this.host;
    const s = this.scene!;
    const dest = this.dest!;
    try {
      this.removeEnter();
      const hull = this.hull!;
      // Nobody left outside a door before anything moves.
      host.keepCrew();
      hull.held = true;
      if (this.sameZone) {
        hull.teleport(this.startAt, this.turn, 0);
        host.afterTeleport(this.startAt);
        host.moveWorld(this.startAt);
      } else {
        // Between frames, not inside the one that began the transit: the world is swapped with nothing half-stepped on it.
        await Promise.resolve();
        if (this.token !== mine) return;
        const next = await host.crossZone(dest.zone, hull, { pos: this.startAt, quaternion: this.turn });
        if (this.token !== mine) {
          // Aborted while crossing: a hull that came back is let go, not left held (the abort released the one it had).
          if (next && host.alive(next)) this.releaseHull(next);
          return;
        }
        if (!next) {
          // Not carried: the abort below releases the hull if it is still in the world, and takes the tunnel down.
          this.abort('the ship could not be carried across');
          return;
        }
        this.carried = next === hull;
        this.hull = next;
        // Held, with the cruise the tunnel had, so the exit reads and flies the same as inside a system.
        next.held = true;
        next.jumpCruise = this.tunnelCruise;
        host.tunnel.attach(next);
        host.afterTeleport(this.startAt);
      }
      const t0 = performance.now();
      let ready = await host.readyAround(this.startAt, s.limit * 1000);
      if (this.token !== mine) return;
      if (!this.sameZone) {
        // The new zone's reflections come after its first compiles: everything compiled once more under the tunnel.
        const left = Math.max(1000, s.limit * 1000 - (performance.now() - t0));
        ready = (await host.settleCarried(this.startAt, ENVIRONMENT_WAIT * 1000, left)) && ready;
        if (this.token !== mine) return;
      }
      if (!ready) console.warn('hyperspace: the destination was not ready in time');
      if (!this.hull || !host.alive(this.hull)) {
        this.abort('the ship was lost');
        return;
      }
      this.ready = true;
    } catch (err) {
      console.warn('hyperspace: the jump failed', err);
    } finally {
      if (this.token === mine && this.phase === 'transit' && !this.ready) this.abort('the jump failed');
    }
  }

  /** Out of the transit: the exit effect placed on the hull, still held in the closed tunnel until it opens ahead. */
  private beginExit(): void {
    const hull = this.hull!;
    this.phase = 'exit';
    this.t = 0;
    this.exitFx = this.placeOn(hull, this.host.effects().exit);
  }

  private updateExit(dt: number, rawDt: number): void {
    const hull = this.hull!;
    const s = this.scene!;
    if (!this.host.alive(hull)) {
      this.abort('the ship was lost');
      return;
    }
    this.watch(hull, rawDt);
    this.t += dt;
    this.showTunnel(dt);
    if (!this.released) this.host.keepCrew();
    if (!this.braking && this.t >= brakeAt(s)) {
      // Out of the opened tunnel at the scene's speed, braking onto the arrival as the stars burst past. The
      // brake's clock starts on this frame, so the curve begins where the hull does.
      this.braking = true;
      this.brakeFrom = this.t;
      hull.held = false;
      hull.launch(s.speed);
    }
    if (this.braking && !this.brakeDone) {
      const u = this.t - this.brakeFrom;
      if (u >= EXIT_BRAKE) {
        // How far the hull is from where the braking curve has it now: at the brake's end that is the
        // arrival, carried on at the arrival cruise for the part of a frame that ran past it.
        this.brakeDone = true;
        this.along.copy(this.startAt).addScaledVector(this.forward, exitTravelled(u, this.exitCruise, s));
        this.lastArrivalError = hull.pos.distanceTo(this.along);
        hull.jumpCruise = this.exitCruise;
      } else {
        const done = this.along.subVectors(hull.pos, this.startAt).dot(this.forward);
        hull.jumpCruise = trackedCruise(u, done, this.exitCruise, s);
      }
    }
    if (!this.released && this.t >= releaseAt(s)) {
      // Control comes back as the game's exit tunnel starts to dissolve.
      this.released = true;
      if (!this.brakeDone) {
        this.brakeDone = true;
        this.lastArrivalError = hull.pos.distanceTo(this.end);
      }
      this.releaseHull(hull);
    }
    if (this.t >= exitEnd(s)) {
      // The exit effect is transient and ends by itself; the jump is over.
      this.exitFx = null;
      this.finish();
    }
  }

  /** This frame's tunnel to the host (the cover from the phase and its clock), and the programs made while it is closed. */
  private showTunnel(dt: number): void {
    const s = this.scene;
    if (!s) return;
    const c = tunnelCover(this.phase, this.t, s, this.coverOut);
    this.cover = c.cover;
    this.host.tunnel.set(c.cover, c.opening, dt);
    if (c.cover >= 1) {
      const n = this.host.programs();
      if (this.programsAtClose < 0) this.programsAtClose = n;
      else this.tunnelPrograms = Math.max(this.tunnelPrograms, n - this.programsAtClose);
    }
  }

  /** The hits (none, a ghosted hull skips the test) and the worst frame seen while the tunnel is not closed. */
  private watch(hull: JumpHull, rawDt: number): void {
    if (hull.justHit > 0) this.hits++;
    const ms = rawDt * 1000;
    if (this.cover < 1 && ms > 16 && ms > this.worstVisibleFrameMs) this.worstVisibleFrameMs = ms;
  }

  /** One of the jump's effects, framed on the hull: turned `fxTurn` about its Y and `fxAhead` along its nose. */
  private placeOn(hull: JumpHull, file: string | null): EffectHandle | null {
    if (!file) return null;
    this.local.makeRotationY(THREE.MathUtils.degToRad(this.fxTurn));
    this.local.multiply(this.ahead.makeTranslation(0, 0, this.fxAhead));
    hull.group.updateMatrixWorld(true);
    return this.host.placeEffect(file, this.local, hull.group.matrixWorld);
  }

  private removeEnter(): void {
    if (this.enterFx) this.host.removeEffect(this.enterFx);
    this.enterFx = null;
  }

  private removeEffects(): void {
    this.removeEnter();
    if (this.exitFx) this.host.removeEffect(this.exitFx);
    this.exitFx = null;
  }

  /** Let a hull go: not held, not ghosted, its own throttle again at the arrival cruise. */
  private releaseHull(h: JumpHull): void {
    h.held = false;
    h.setGhost(false);
    h.jumpCruise = null;
    h.cruise = this.exitCruise;
  }

  /** Back to idle (the hull, if any, already released): the tunnel taken down, nobody held aboard. */
  private finish(): void {
    this.host.tunnel.detach();
    this.host.holdCrew(null);
    this.phase = 'idle';
    this.t = 0;
    this.hull = null;
    this.dest = null;
    this.destPack = null;
    this.countText = null;
    this.cover = 0;
    this.ready = false;
    this.programsAtClose = -1;
    this.enterFx = null;
    this.exitFx = null;
  }
}
