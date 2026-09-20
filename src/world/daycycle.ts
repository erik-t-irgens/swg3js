import * as THREE from 'three';
import { dayTune, registerDay, setDayNote, sharedClock } from './sharedClock.ts';
import { rand3 } from './weatherSchedule.ts';

/** The client's day: the clock runs 06:00 to 06:00, and the first 70% of it is daylight. */
const DAY_NIGHT_SPLIT = 0.7;
/** The client pitches its main light 22.5 degrees off the vertical before sweeping it: the sun's peak elevation. */
const SWG_LIGHT_ELEVATION = THREE.MathUtils.degToRad(90 - 22.5);

/** What the head-up display says while the day is not the shared clock's (kept strings, never built per frame). */
const DAY_HELD_NOTE = 'Time of day set from the console';
const DAY_FAST_NOTE = 'Day running fast';

/**
 * Where a planet's day sits against the shared clock, in days. Invented, and worked out from the
 * planet's own sun (its azimuth and its peak elevation, the two numbers the day is ever told about
 * a planet) so that it is the same number in every browser without anybody having to carry it: the
 * same planet is at the same hour for everyone, and the planets are not all at noon together.
 *
 * The salt is invented too, and chosen rather than picked out of the air: a hash of two numbers
 * spreads them no better than chance, and the first one tried put two of the game's planets at the
 * same hour to within half a second of a twelve-minute day. This one leaves the closest pair of the
 * thirteen suns the planet list actually has about a fortieth of a day apart, which the test
 * measures over that list so that a planet added later is noticed rather than quietly colliding.
 */
const PHASE_SALT = 29;

export function phaseFor(azimuth: number, maxElevation: number): number {
  const a = Math.round((Number.isFinite(azimuth) ? azimuth : 0) * 1000);
  const e = Math.round((Number.isFinite(maxElevation) ? maxElevation : 0) * 1000);
  const p = rand3(a, e, PHASE_SALT) * dayTune.phaseSpread;
  return p - Math.floor(p);
}

/** Time of day in [0, 1): 0 is midnight, 0.5 is noon. */
export class DayCycle {
  time = 0.36;
  dayLengthSeconds = 720;
  /** This planet's place in the shared day, in days. */
  phase = 0;
  /**
   * The time was set by hand (the console's `__debug.time`, the room air's sun aiming): the shared
   * clock stops driving the day until `__sharedDay({ release: true })`, exactly as the weather's
   * own console clock takes the weather out of the schedule until it is handed back.
   */
  held = false;
  /** The fast-forward key is down: the day is not the shared one while it is. */
  fast = false;
  /** What the last update left, so a write from anywhere else is noticed as a write. */
  private lastTime = 0.36;
  /** The wall clock at the last update, which is how a gap in the frames is told from a slow one. */
  private lastWallAt = 0;
  private noteNow = '';
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly moonDir = new THREE.Vector3(0, -1, 0);
  /** Direction to whichever body lights the world now: the sun by day, the moon by night. */
  readonly lightDir = new THREE.Vector3(0, 1, 0);
  /** True while the planet's own sky drives the light: the sun then follows the client's path. */
  swg = false;
  /** A fixed direction the light comes from (space: the zone's own main light), overriding the sun's arc. */
  fixed: THREE.Vector3 | null = null;
  /** 0 at night, 1 in full daylight. */
  daylight = 1;
  /** Peaks when the sun sits on the horizon. */
  sunset = 0;

  private azimuth: number;
  private maxElevation: number;

  // Written out rather than declared in the argument list: node's own type stripping, which is what
  // runs the tests, refuses a parameter property, and the day's arithmetic is tested there.
  constructor(azimuth: number, maxElevation: number) {
    this.azimuth = azimuth;
    this.maxElevation = maxElevation;
    this.phase = phaseFor(azimuth, maxElevation);
    registerDay(this);
  }

  configure(azimuth: number, maxElevation: number): void {
    this.azimuth = azimuth;
    this.maxElevation = maxElevation;
    this.phase = phaseFor(azimuth, maxElevation);
  }

  /** Hand the day back to the shared clock after the console has moved it. */
  release(): void {
    this.held = false;
    this.lastTime = this.time;
    this.tellNote();
  }

  update(dt: number, fast: boolean): void {
    // Somebody wrote the time between updates: the console, or the room air hunting for the hour
    // its doorway faces the sun. Whoever did it meant it, so the shared clock lets go until it is
    // handed back, the same bargain the weather's own console clock strikes.
    if (this.time !== this.lastTime) this.held = true;
    this.fast = fast;
    // How long the frames have been away, which is not `dt`: the loop clamps its step to a
    // twentieth of a second, so a tab hidden for two minutes comes back with a step of 0.05 and two
    // minutes of wall clock behind it, and so does the first frame after a loading screen. Nothing
    // was on the screen in that gap, so the day is put right outright there and walked on every
    // ordinary frame -- including the frame a server is first heard from, which is drawn like any
    // other. One read of the wall clock a frame, nothing allocated, and nothing read when there is
    // no server to follow.
    const wallNow = sharedClock.wall();
    const away = (wallNow - this.lastWallAt) / 1000 - Math.max(0, dt);
    const stopped = this.lastWallAt === 0 || away > dayTune.gapSeconds;
    this.lastWallAt = wallNow;
    const shared = this.held || fast ? null : sharedClock.timeOfDay(this.dayLengthSeconds, this.phase);
    const step = (dt / this.dayLengthSeconds) * (fast ? 90 : 1);
    if (shared === null) this.time = (this.time + step) % 1;
    else if (!(dt > 0) || stopped) {
      // No time passed, or none of it was drawn: the world is being set up behind a loading screen,
      // an arrival is asking what the sky looks like, or the frames have been away. The right
      // answer is the shared one outright -- easing it would put the wrong sky on the first frame
      // after the screen, and nobody can have seen the sun move to it.
      this.time = shared;
    } else {
      let err = shared - this.time;
      err -= Math.floor(err + 0.5);
      let move: number;
      if (Math.abs(err) >= dayTune.snapAt) {
        // A correction rather than a drift: a first connect while playing, or the fast-forward key
        // let go. It is made by the shorter way round at `catchUp` times the day's own rate, which
        // is visible and over in seconds. Racing forward through a whole night instead, to keep the
        // sun from ever winding back, would take four times as long and be four times as strange.
        const most = step * dayTune.catchUp;
        move = Math.max(-most, Math.min(most, err));
      } else {
        // A drift: `err` is the whole way to the shared time, so moving by it lands on it, held
        // between a quarter of the day's own rate and `easeMax` times it. The sun hurries when it
        // is behind and dawdles when it is ahead, never stands still and never runs backwards.
        // Once it is there, `err` is one step every frame, which is the day's own rate again.
        move = Math.max(step * dayTune.minRate, Math.min(step * dayTune.easeMax, err));
      }
      this.time = (this.time + move) % 1;
    }
    if (this.time < 0) this.time += 1;
    this.lastTime = this.time;
    this.tellNote();
    const a = (this.time - 0.25) * Math.PI * 2;
    const k = Math.max(0.35, Math.sin(this.maxElevation));
    this.sunDir.set(Math.cos(a) * Math.sin(this.azimuth), Math.sin(a) * k, Math.cos(a) * Math.cos(this.azimuth)).normalize();
    this.moonDir.copy(this.sunDir).negate();
    this.moonDir.x += 0.25;
    this.moonDir.normalize();
    const y = this.sunDir.y;
    this.daylight = THREE.MathUtils.smoothstep(y, -0.1, 0.22);
    this.sunset = Math.exp(-Math.abs(y) * 9) * (y > -0.15 ? 1 : 0);
    if (this.fixed) {
      this.lightDir.copy(this.fixed).normalize();
      this.sunDir.copy(this.lightDir);
      this.moonDir.copy(this.lightDir).negate();
      this.daylight = 1;
      this.sunset = 0;
    } else if (this.swg) {
      // The client pitches its light 67.5 degrees, then yaws it half a turn per day and half a
      // turn per night about the pitched frame: the sun rises on the horizon, peaks at 67.5
      // degrees at midday and sets on the far side, and the moon follows the same arc by night.
      const n = this.normalized;
      const yaw = (n < 0.5 ? -Math.PI / 2 : -Math.PI * 1.5) + n * Math.PI * 2;
      const sp = Math.sin(SWG_LIGHT_ELEVATION);
      const cp = Math.cos(SWG_LIGHT_ELEVATION);
      this.lightDir.set(Math.sin(yaw), Math.cos(yaw) * sp, -Math.cos(yaw) * cp).normalize();
      if (this.isDay) {
        this.sunDir.copy(this.lightDir);
        this.moonDir.copy(this.lightDir).negate();
      } else {
        this.moonDir.copy(this.lightDir);
        this.sunDir.copy(this.lightDir).negate();
      }
      const r = this.ratio;
      this.daylight = r < DAY_NIGHT_SPLIT ? 1 - THREE.MathUtils.smoothstep(r, DAY_NIGHT_SPLIT - 0.04, DAY_NIGHT_SPLIT) : THREE.MathUtils.smoothstep(r, 0.96, 1);
      this.sunset = 0;
    } else {
      this.lightDir.copy(this.sunDir.y > 0.02 ? this.sunDir : this.moonDir);
    }
  }

  /**
   * The head-up display's line while the day is not the shared clock's. Two constant strings, and
   * the one in force is swapped only when the state changes: asking costs nothing every frame.
   */
  private tellNote(): void {
    const want = !sharedClock.shared ? '' : this.held ? DAY_HELD_NOTE : this.fast ? DAY_FAST_NOTE : '';
    if (want === this.noteNow) return;
    this.noteNow = want;
    setDayNote(want);
  }

  /** The client's time ratio: 0 at 06:00, wrapping at the next 06:00. */
  get ratio(): number {
    return (this.time - 0.25 + 1) % 1;
  }

  get isDay(): boolean {
    return this.ratio < DAY_NIGHT_SPLIT;
  }

  /** Day stretched over [0, 0.5) and night over [0.5, 1), which is how the client indexes its colour ramps. */
  get normalized(): number {
    const r = this.ratio;
    const n = r < DAY_NIGHT_SPLIT ? 0.5 * (r / DAY_NIGHT_SPLIT) : 0.5 + 0.5 * ((r - DAY_NIGHT_SPLIT) / (1 - DAY_NIGHT_SPLIT));
    return n >= 1 ? 0 : n;
  }

  /** Column of the 256-entry colour ramps for this moment. */
  get colorIndex(): number {
    return THREE.MathUtils.clamp(Math.floor(256 * this.normalized), 0, 255);
  }

  clock(): string {
    const mins = Math.floor(this.time * 24 * 60);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }
}
