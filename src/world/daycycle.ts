import * as THREE from 'three';

/** Time of day in [0, 1): 0 is midnight, 0.5 is noon. */
export class DayCycle {
  time = 0.36;
  dayLengthSeconds = 720;
  readonly sunDir = new THREE.Vector3(0, 1, 0);
  readonly moonDir = new THREE.Vector3(0, -1, 0);
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
  }

  clock(): string {
    const mins = Math.floor(this.time * 24 * 60);
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }
}
