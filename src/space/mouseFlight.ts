// Mouse flight for the ship the player flies. Under pointer lock the mouse moves a cursor of its own
// over the view, which stays wherever it is left (clamped to a ring). A small circle sits in the middle
// of the view: inside it the cursor aims the guns (they swing toward it, at most the circle's angle) and
// the ship does not turn; outside it the ship keeps turning toward the cursor, harder the further out,
// for as long as it is held there. The old stick drifted back to the middle whenever the mouse rested,
// so a turn needed the mouse kept moving and a pilot could not come round onto a fighter.
//
// Every number here is INVENTED and live through `__debug.flight(...)`. Pure: no three, no DOM; node's
// tests import it straight from source. Nothing allocates.
//
// The cursor is in half-heights of the view from the ship's boresight: +x right, +y down (as the screen's
// pixels go), so it keeps its place when the window changes size. With the view's vertical half-angle's
// tangent `tanHalf`, a cursor at (x, y) is the direction (x·tanHalf, -y·tanHalf, -1) in the frame of a view
// looking straight down the nose (cameras look down their -Z), whatever the window's aspect: the cockpit
// view exactly. The chase view lags the hull and looks a little under it, so the circle and the cursor are
// drawn where that direction lands on its screen and drift off the middle while the view catches a turn up;
// the aim and the stick stay the hull's.
import { PILOT_SKILL, type PilotSkill } from './pilot.ts';

export interface Cursor {
  x: number;
  y: number;
}

/** A stick in flyShip's senses: x > 0 turns right, y > 0 pushes the nose down; `turn` is its reach, 0..1. */
export interface FlightStick {
  x: number;
  y: number;
  turn: number;
}

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** The mouse flight's numbers (all invented), tuned live with `__debug.flight({ circleDeg: 6 })`. */
export const MOUSE_FLIGHT = {
  /** The aim circle's radius, degrees off the nose: the guns swing this far toward the cursor. */
  circleDeg: 5,
  /** The cursor's reach, degrees off the nose: the stick is full there. */
  ringDeg: 18,
  /** Just outside the circle, this share of the way on to the ring turns nothing (so an aim at the rim does not creep the nose). */
  deadZone: 0.04,
  /** The stick over the rest of the way: (share of the way)^curve, so a little past the rim is a gentle turn. */
  curve: 1.2,
  /** Where the guns' bolts cross with no target to range on (metres), and never nearer than this, so a target alongside does not swing the guns across the nose. */
  convergeM: 300,
  nearestM: 60,
  /** The aim within this of the target's lead (degrees): the bolts take the lead exactly. */
  snapDeg: 2,
  /** Cursor pixels per pixel of mouse movement (times the camera's sensitivity). */
  speed: 1,
};

export type MouseFlightTune = typeof MOUSE_FLIGHT;

const DEG = Math.PI / 180;

/** A cone of `deg` degrees off the boresight as a cursor radius (half-heights). */
export function radiusOf(deg: number, tanHalf: number): number {
  return Math.tan(Math.max(0, Math.min(80, deg)) * DEG) / Math.max(1e-6, tanHalf);
}

/** The aim circle's and the ring's radii (half-heights) for this view; the ring stays a twentieth past the circle (invented) whatever the tune, so there is always room to turn. */
export function circleRadius(tanHalf: number, t: MouseFlightTune = MOUSE_FLIGHT): number {
  return radiusOf(t.circleDeg, tanHalf);
}
export function ringRadius(tanHalf: number, t: MouseFlightTune = MOUSE_FLIGHT): number {
  return Math.max(radiusOf(t.ringDeg, tanHalf), circleRadius(tanHalf, t) * 1.05);
}

/**
 * The mouse's movement this step (pixels) moves the cursor, which is then kept inside the ring; it never
 * drifts back by itself. `invertY` reads a push forward as a move down, as the camera's own setting does.
 */
export function moveCursor(c: Cursor, dxPx: number, dyPx: number, halfHeightPx: number, sensitivity: number, invertY: boolean, tanHalf: number, t: MouseFlightTune = MOUSE_FLIGHT): Cursor {
  const k = (t.speed * sensitivity) / Math.max(1, halfHeightPx);
  c.x += dxPx * k;
  c.y += (invertY ? -dyPx : dyPx) * k;
  return clampTo(c, ringRadius(tanHalf, t));
}

/** A cursor kept within `r` of the middle (in place). */
export function clampTo(c: Cursor, r: number): Cursor {
  const d = Math.hypot(c.x, c.y);
  if (d > r && d > 0) {
    c.x *= r / d;
    c.y *= r / d;
  }
  return c;
}

/**
 * The stick the cursor asks for: nothing inside the circle and its dead zone; beyond, toward the cursor, rising
 * as (share of the way to the ring)^curve to full at the ring. Fills and returns `out`.
 */
export function stickFromCursor(c: Cursor, tanHalf: number, out: FlightStick, t: MouseFlightTune = MOUSE_FLIGHT): FlightStick {
  const d = Math.hypot(c.x, c.y);
  const rc = circleRadius(tanHalf, t);
  const rr = ringRadius(tanHalf, t);
  const start = rc + (rr - rc) * Math.max(0, Math.min(0.9, t.deadZone));
  if (d <= start || rr <= start) {
    out.x = 0;
    out.y = 0;
    out.turn = 0;
    return out;
  }
  const share = Math.min(1, (d - start) / (rr - start));
  const s = Math.pow(share, Math.max(0.2, t.curve));
  out.x = (c.x / d) * s;
  out.y = (c.y / d) * s;
  out.turn = s;
  return out;
}

/** Where the guns aim: the cursor, kept within the circle. Fills and returns `out`. */
export function aimCursor(c: Cursor, tanHalf: number, out: Cursor, t: MouseFlightTune = MOUSE_FLIGHT): Cursor {
  out.x = c.x;
  out.y = c.y;
  return clampTo(out, circleRadius(tanHalf, t));
}

/** Whether the cursor is inside the aim circle (the guns reach it). */
export function insideCircle(c: Cursor, tanHalf: number, t: MouseFlightTune = MOUSE_FLIGHT): boolean {
  return Math.hypot(c.x, c.y) <= circleRadius(tanHalf, t) + 1e-9;
}

/** The view direction through a cursor, in the camera's own frame (a unit vector; the camera looks down -Z). */
export function viewRay<T extends V3>(c: Cursor, tanHalf: number, out: T): T {
  const x = c.x * tanHalf;
  const y = -c.y * tanHalf;
  const n = Math.hypot(x, y, 1);
  out.x = x / n;
  out.y = y / n;
  out.z = -1 / n;
  return out;
}

/** The cursor that shows a camera-frame direction (the inverse of viewRay); null for a direction beside or behind the view. */
export function cursorOf(dir: V3, tanHalf: number, out: Cursor): Cursor | null {
  if (dir.z > -1e-6) return null;
  out.x = dir.x / (-dir.z * tanHalf);
  out.y = -dir.y / (-dir.z * tanHalf);
  return out;
}

/**
 * One gun's shot, in the world: the bolt from `from` toward the point `dist` metres out along the aim ray (`ray`, a
 * unit vector from the pilot's eye at `eye`), so every gun's bolts cross there, under the cursor; or, with the ray within
 * `snapRad` of the lead point `lead` as seen from the eye, straight at the lead. Fills `out` (a unit vector) and says
 * whether the lead was taken.
 */
export function gunAim(from: V3, eye: V3, ray: V3, dist: number, lead: V3 | null, snapRad: number, out: V3): boolean {
  let px = eye.x + ray.x * dist;
  let py = eye.y + ray.y * dist;
  let pz = eye.z + ray.z * dist;
  let snapped = false;
  if (lead) {
    const lx = lead.x - eye.x;
    const ly = lead.y - eye.y;
    const lz = lead.z - eye.z;
    const ll = Math.hypot(lx, ly, lz);
    if (ll > 1e-6) {
      const cos = (lx * ray.x + ly * ray.y + lz * ray.z) / ll;
      if (cos >= Math.cos(snapRad)) {
        px = lead.x;
        py = lead.y;
        pz = lead.z;
        snapped = true;
      }
    }
  }
  const dx = px - from.x;
  const dy = py - from.y;
  const dz = pz - from.z;
  const n = Math.hypot(dx, dy, dz);
  if (n < 1e-6) {
    out.x = ray.x;
    out.y = ray.y;
    out.z = ray.z;
  } else {
    out.x = dx / n;
    out.y = dy / n;
    out.z = dz / n;
  }
  return snapped;
}

/**
 * A shot kept within `maxRad` of the nose: a direction further off is turned toward the nose onto the cone's edge (one
 * straight behind comes out along the nose). `dir` and `nose` are unit vectors; `dir` is changed in place. Says whether
 * it was turned. Whatever the eye, the lead or the view does, no bolt leaves further off the nose than this.
 */
export function coneClamp(dir: V3, nose: V3, maxRad: number): boolean {
  const c = dir.x * nose.x + dir.y * nose.y + dir.z * nose.z;
  if (c >= Math.cos(maxRad)) return false;
  let px = dir.x - nose.x * c;
  let py = dir.y - nose.y * c;
  let pz = dir.z - nose.z * c;
  const pl = Math.hypot(px, py, pz);
  if (pl < 1e-9) {
    dir.x = nose.x;
    dir.y = nose.y;
    dir.z = nose.z;
    return true;
  }
  px /= pl;
  py /= pl;
  pz /= pl;
  const cm = Math.cos(maxRad);
  const sm = Math.sin(maxRad);
  dir.x = nose.x * cm + px * sm;
  dir.y = nose.y * cm + py * sm;
  dir.z = nose.z * cm + pz * sm;
  return true;
}

/**
 * The cursor as a direction in the hull's own frame (x left, y up, z the nose): the cursor is measured about the hull's
 * boresight, as a view looking straight down the nose from the pilot's eye would show it (the cockpit view exactly),
 * so the chase camera's lag and tilt never move where the guns aim or which way the stick turns. Fills `out`.
 */
export function hullRay<T extends V3>(c: Cursor, tanHalf: number, out: T): T {
  viewRay(c, tanHalf, out);
  // The camera's frame looking down the nose is the hull's turned half a turn about Y: x and z change sign.
  out.x = -out.x;
  out.z = -out.z;
  return out;
}

/** What `__debug.flight` sets: the mouse flight's numbers and, per tier, the NPC pilots' skill. */
export interface FlightTuneInput extends Partial<MouseFlightTune> {
  npc?: Record<number, Partial<PilotSkill>>;
}

/**
 * Set any of the mouse flight's numbers (finite ones only) and any tier's skill, and return them all as they now
 * stand. Allocates (console only).
 */
export function flightTune(opts: FlightTuneInput = {}): { flight: MouseFlightTune; npc: Record<number, PilotSkill> } {
  const f = MOUSE_FLIGHT as Record<string, number>;
  for (const [k, v] of Object.entries(opts)) if (k !== 'npc' && typeof v === 'number' && Number.isFinite(v) && typeof f[k] === 'number') f[k] = v;
  if (opts.npc) {
    for (const [tier, change] of Object.entries(opts.npc)) {
      const s = PILOT_SKILL[Number(tier)] as unknown as Record<string, number> | undefined;
      if (!s || !change) continue;
      for (const [k, v] of Object.entries(change)) if (typeof v === 'number' && Number.isFinite(v) && typeof s[k] === 'number') s[k] = v;
    }
  }
  const npc: Record<number, PilotSkill> = {};
  for (const [tier, s] of Object.entries(PILOT_SKILL)) npc[Number(tier)] = { ...s };
  return { flight: { ...MOUSE_FLIGHT }, npc };
}
