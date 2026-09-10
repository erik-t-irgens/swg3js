import * as THREE from 'three';

/** The client's day: the clock runs 06:00 to 06:00, and the first 70% of it is daylight. */
const DAY_NIGHT_SPLIT = 0.7;
/** The client pitches its main light 22.5 degrees off the vertical before sweeping it: the sun's peak elevation. */
const SWG_LIGHT_ELEVATION = THREE.MathUtils.degToRad(90 - 22.5);

/** Time of day in [0, 1): 0 is midnight, 0.5 is noon. */
export class DayCycle {
  time = 0.36;
  dayLengthSeconds = 720;
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly moonDir = new THREE.Vector3(0, -1, 0);
  /** Direction to whichever body lights the world now: the sun by day, the moon by night. */
  readonly lightDir = new THREE.Vector3(0, 1, 0);
  /** True while the planet's own sky drives the light: the sun then follows the client's path. */
  swg = false;
  /** 0 at night, 1 in full daylight. */
  daylight = 1;
  /** Peaks when the sun sits on the horizon. */
  sunset = 0;

  constructor(private azimuth: number, private maxElevation: number) {}

  configure(azimuth: number, maxElevation: number): void {
    this.azimuth = azimuth;
    this.maxElevation = maxElevation;
  }

  update(dt: number, fast: boolean): void {
    this.time = (this.time + (dt / this.dayLengthSeconds) * (fast ? 90 : 1)) % 1;
    const a = (this.time - 0.25) * Math.PI * 2;
    const k = Math.max(0.35, Math.sin(this.maxElevation));
    this.sunDir.set(Math.cos(a) * Math.sin(this.azimuth), Math.sin(a) * k, Math.cos(a) * Math.cos(this.azimuth)).normalize();
    this.moonDir.copy(this.sunDir).negate();
    this.moonDir.x += 0.25;
    this.moonDir.normalize();
    const y = this.sunDir.y;
    this.daylight = THREE.MathUtils.smoothstep(y, -0.1, 0.22);
    this.sunset = Math.exp(-Math.abs(y) * 9) * (y > -0.15 ? 1 : 0);
    if (this.swg) {
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
