// Turning and raising a thing in hand by holding a key and moving the mouse.
//
// The owner's own words: one button to turn it, one to raise and lower it, and while either is held
// the mouse moving up and down gives granular control. So a building or a prop in hand turns while the
// turn key is held (R by default) and rises and sinks while the height key is (F), by how far the mouse
// moves; a slow hand moves it a little at a time and a quick one a long way, so fine and coarse come
// from the hand itself and not from a second key. The wheel, while either key is held, steps to the
// old grid -- fifteen degrees, a quarter metre for a house and a tenth for a prop -- which is where an
// exact value lives now that the four step keys are gone. A press that moves nothing changes nothing.
//
// A prop also tips and rolls (shift with the turn key): up and down tip it about the view's own across
// axis, the top going away from you as the mouse goes up, and left and right roll it about the view's
// own along axis, the top going the way the mouse does.
//
// **The senses.** Mouse up turns it clockwise seen from above, which is a negative yaw in three's own
// sense, and raises it; both have a flip. A sideways drag does nothing unless `sideways` is on, when
// mouse right turns it clockwise as well. All of it is per pixel times a gain from the hand's speed in
// pixels a second, so the total of a movement does not depend on the frame rate it arrives at.
//
// And **a thing picked back up starts where it stood**: anchored there until the player walks or looks
// away by more than a little (`anchorReleased`), so a small turn of one already standing is a small
// turn and not a move to wherever the view happens to point.
//
// Every number is ours, in `PLACE_HOLD_TUNE`, live through `__debug.placeHold({ tune })`.
//
// What a frame of a hold does to the thing in hand is here too (`applyHold`), and which hold the keys
// make (`holdKindOf`), which way a notch of the wheel goes (`wheelDir`) and the view's own axes a prop
// tumbles about (`tumbleAxes`, `tumbleBy`), so the game only gathers the keys and the mouse and every
// sense and every sum is something a node test runs rather than a line of the game it reads.
//
// Pure: no three, no rapier, no DOM; it reads `propPlace.ts`'s turns, which are pure too. Rule for this
// file (node runs it with type stripping for the tests): no enum, no namespace, no constructor
// parameter properties, and every relative import carries its `.ts`.

import { PROP_TUNE, liftTo as propLiftTo, turnAbout, type PropTurn } from './propPlace.ts';

/** Every number of holding a key to turn or raise a thing in hand. All of them ours. */
export const PLACE_HOLD_TUNE = {
  /** Degrees a pixel at a slow hand: about the camera's own 0.0025 rad a pixel (0.143 degrees). */
  turnPerPx: 0.15,
  /** Metres a pixel at a slow hand, for a building and for a prop. */
  liftPerPxHouse: 0.005,
  liftPerPxProp: 0.003,
  /** Pixels a second at or under which the base rate holds. */
  knee: 400,
  /** Pixels a second at or over which the rate is `most` times the base. */
  fast: 2000,
  /** How much a quick flick multiplies the rate. */
  most: 4,
  /** Whether a sideways drag spins it as well (mouse right clockwise, as mouse up is). The owner wrote up and down. */
  sideways: false,
  /** Mouse up turns it anticlockwise instead. */
  flipTurn: false,
  /** Mouse up lowers it instead. */
  flipLift: false,
  /** The wheel's step with a key held: degrees, and metres for a building and a prop. */
  gridTurn: 15,
  gridLiftHouse: 0.25,
  gridLiftProp: 0.1,
  /** Seconds: a frame shorter than this counts as this long when the hand's speed is worked out. */
  dtFloor: 0.004,
  /** Metres the player may walk before a thing picked back up leaves the spot it stood on. */
  anchorMove: 0.3,
  /** Degrees the view may turn before it does. */
  anchorTurn: 3,
  /** Pixels a press on one of the bar's two buttons may move and still be a click (a step) rather than a drag. */
  barClickPx: 4,
};

export type PlaceHoldTune = typeof PLACE_HOLD_TUNE;

const DEG = Math.PI / 180;

/** What a held key is doing to the thing in hand: spinning it, tipping and rolling it, or raising it. */
export type HoldKind = 'turn' | 'tumble' | 'lift';

/**
 * How much faster than the base rate a movement of `px` pixels over `dt` seconds goes: 1 at or under
 * the knee, `most` at or over `fast`, straight between. The speed is per second, so a hand moving at
 * one speed gets one gain whatever the frame rate.
 */
export function holdGain(px: number, dt: number, tune: PlaceHoldTune = PLACE_HOLD_TUNE): number {
  const v = Math.abs(px) / Math.max(dt, tune.dtFloor);
  const span = tune.fast - tune.knee;
  const t = span > 0 ? (v - tune.knee) / span : v > tune.knee ? 1 : 0;
  return 1 + (tune.most - 1) * Math.min(1, Math.max(0, t));
}

/**
 * The turn one frame of a held turn key makes, in radians, in three's sense (positive is anticlockwise
 * seen from above). Mouse up (`dy` below nought) is clockwise, so negative; `sens` is the mouse
 * sensitivity the camera already scales by, so a drag feels the same as looking round.
 */
export function turnDelta(dy: number, dx: number, dt: number, sens: number, tune: PlaceHoldTune = PLACE_HOLD_TUNE): number {
  const along = dy - (tune.sideways ? dx : 0);
  if (!along) return 0;
  const px = tune.sideways ? Math.hypot(dx, dy) : Math.abs(dy);
  const rad = along * tune.turnPerPx * holdGain(px, dt, tune) * sens * DEG;
  return tune.flipTurn ? -rad : rad;
}

/** The height one frame of a held height key makes, in metres: mouse up raises it. A sideways wobble moves nothing. */
export function liftDelta(dy: number, dt: number, sens: number, kind: 'house' | 'prop', tune: PlaceHoldTune = PLACE_HOLD_TUNE): number {
  if (!dy) return 0;
  const per = kind === 'house' ? tune.liftPerPxHouse : tune.liftPerPxProp;
  const m = -dy * per * holdGain(dy, dt, tune) * sens;
  return tune.flipLift ? -m : m;
}

/**
 * A prop's tumble for one frame, in radians, written into `out`: `tip` about the view's across axis
 * (the camera's right, `forward x up`) and `roll` about its along axis (the camera's forward, flat).
 * About the across axis a positive turn brings the top toward the viewer, so mouse up (`dy` below
 * nought) is negative and tips the top away; about the along axis a positive turn takes the top to
 * the right, so mouse right rolls it right.
 */
export function tumbleDeltas(dx: number, dy: number, dt: number, sens: number, tune: PlaceHoldTune, out: { tip: number; roll: number }): { tip: number; roll: number } {
  const g = holdGain(Math.hypot(dx, dy), dt, tune) * tune.turnPerPx * sens * DEG;
  out.tip = dy * g;
  out.roll = dx * g;
  return out;
}

/**
 * The next line of a grid strictly beyond `value` the way `dir` points (+1 up, -1 down), negatives
 * too. A value already on a line steps to the next one, and one a hair off a line (fifteen degrees
 * read back out of radians) counts as on it.
 */
export function stepToGrid(value: number, grid: number, dir: number): number {
  if (!(grid > 0) || !dir) return value;
  const n = value / grid;
  const k = dir > 0 ? Math.floor(n + 1e-9) + 1 : Math.ceil(n - 1e-9) - 1;
  return k * grid;
}

/** Where a thing picked back up stood, and where the player stood and looked when they picked it up. */
export interface PlaceAnchor {
  /** Whether it still holds. */
  on: boolean;
  x: number;
  y: number;
  z: number;
  /** Where the player stood, on the ground. */
  px: number;
  pz: number;
  /** Which way the view looked, as a body's heading. */
  yaw: number;
}

/** A fresh anchor, holding nothing. */
export function placeAnchor(): PlaceAnchor {
  return { on: false, x: 0, y: 0, z: 0, px: 0, pz: 0, yaw: 0 };
}

/**
 * Whether a thing picked back up has been let go of where it stood: the player has walked more than
 * `anchorMove` from where they took it up, or the view has turned more than `anchorTurn`. Holding the
 * turn or the height key holds the camera still, so neither of those ever lets go of it.
 */
export function anchorReleased(a: PlaceAnchor, at: { x: number; z: number }, yaw: number, tune: PlaceHoldTune = PLACE_HOLD_TUNE): boolean {
  if (Math.hypot(at.x - a.px, at.z - a.pz) > tune.anchorMove) return true;
  const turn = Math.PI * 2;
  let d = (yaw - a.yaw) % turn;
  if (d > Math.PI) d -= turn;
  else if (d < -Math.PI) d += turn;
  return Math.abs(d) > tune.anchorTurn * DEG;
}

/**
 * The view's own two level axes, written into `out`, from the camera's direction in the world: `f`
 * forward along the ground and `r` its right (`forward x up`). False, and nothing written, when the
 * view looks straight up or down and there is no along to speak of (`tumbleAxes` stands the body's
 * heading in then).
 */
export function viewAxes(dx: number, dz: number, out: ViewAxes): boolean {
  const len = Math.hypot(dx, dz);
  if (!(len > 1e-6)) return false;
  out.fx = dx / len;
  out.fz = dz / len;
  out.rx = -out.fz;
  out.rz = out.fx;
  return true;
}

/** The view's level forward (`f`) and its right (`r`), on the ground. */
export interface ViewAxes {
  fx: number;
  fz: number;
  rx: number;
  rz: number;
}

/**
 * The axes a prop tumbles about, written into `out`: the camera's own direction in the world laid flat
 * (`dirX`, `dirZ`, never the camera's yaw, which aboard a hull is the hull's frame), and where the view
 * looks straight up or down and has no level forward, the body's `heading` standing in for it.
 */
export function tumbleAxes(dirX: number, dirZ: number, heading: number, out: ViewAxes): ViewAxes {
  if (!viewAxes(dirX, dirZ, out)) viewAxes(Math.sin(heading), Math.cos(heading), out);
  return out;
}

/**
 * A prop tipped by `tip` radians about the view's across axis and rolled by `roll` about its along axis,
 * composed in the world's frame (`r * q`) and written into `q` itself. In the senses `tumbleDeltas` gives:
 * a negative tip takes the top away from the viewer, a positive roll takes it to the viewer's right.
 */
export function tumbleBy(q: PropTurn, axes: ViewAxes, tip: number, roll: number): PropTurn {
  if (tip) turnAbout(q, axes.rx, 0, axes.rz, tip, q);
  if (roll) turnAbout(q, axes.fx, 0, axes.fz, roll, q);
  return q;
}

/**
 * Which hold the keys make: the turn key held turns it, or with shift tumbles it when it is a prop (a
 * building only spins); the height key held raises it; the turn key wins when both are held. The bar's
 * own two buttons ask the same with their own press standing for the key.
 */
export function holdKindOf(turnHeld: boolean, liftHeld: boolean, shift: boolean, prop: boolean): HoldKind | null {
  if (turnHeld) return prop && shift ? 'tumble' : 'turn';
  if (liftHeld) return 'lift';
  return null;
}

/**
 * Which way one notch of the wheel takes the value while a key is held, as `stepPlacingGrid` reads it
 * (+1 a larger yaw, which is anticlockwise seen from above, a positive tip, or a higher lift), for a notch
 * rolled up (`up` +1) or down (-1). Up on the wheel is up on the mouse: a turn clockwise, a tip away and a
 * lift up, and each flip the mouse has turns the wheel round with it.
 */
export function wheelDir(kind: HoldKind, up: number, tune: PlaceHoldTune = PLACE_HOLD_TUNE): number {
  if (kind === 'turn') return tune.flipTurn ? up : -up;
  if (kind === 'tumble') return -up;
  return tune.flipLift ? -up : up;
}

/** A building turned to `yaw` radians, kept inside one turn, [0, 2π). */
export function turnTo(yaw: number): number {
  const turn = Math.PI * 2;
  const t = ((yaw % turn) + turn) % turn;
  // A hair under a whole turn is a whole turn, which is nought.
  return t >= turn ? 0 : t;
}

/** A lift kept within `most` metres either way and to the centimetre, which is what a server keeps of a building's height. */
export function keepLift(value: number, most: number): number {
  const v = Math.min(most, Math.max(-most, value));
  return Math.round(v * 100) / 100;
}

/**
 * A held placing key, and what it is doing: `which` is `turn`, `tumble` or `lift`, or null; `raw` is the
 * lift as the hand has moved it, unrounded, so a slow hand's few millimetres a frame add up rather than
 * each being rounded away (what the thing keeps is that, to the centimetre); `since` when this hold began;
 * `gain` the last frame's.
 */
export interface HoldState {
  which: HoldKind | null;
  since: number;
  raw: number;
  gain: number;
}

/** A hold with nothing held, for the game to keep. */
export function holdState(): HoldState {
  return { which: null, since: 0, raw: 0, gain: 1 };
}

/** One frame's tumble, kept: `applyHold` writes it and reads it back at once. */
const TUMBLE = { tip: 0, roll: 0 };

/**
 * One frame of a hold, into the thing in hand: `which` is what the keys (or the bar's buttons) make this
 * frame (`holdKindOf`) and `dx`, `dy` how far the mouse moved, in pixels. A change of hold starts it
 * afresh from the thing as it stands (`raw` from its lift as kept). Nothing is written for a frame that
 * moved nothing, so a press that moves nothing changes nothing. A prop spins about the world's up and
 * tumbles about `axes` (`tumbleAxes`); a building spins only, kept in one turn. A lift is kept unrounded
 * in the hold and to the centimetre on the thing, within the prop's own `most` or `houseMost`. Answers
 * whether it moved.
 */
export function applyHold(
  h: HoldState,
  which: HoldKind | null,
  dx: number,
  dy: number,
  dt: number,
  sens: number,
  axes: ViewAxes,
  prop: { turn: PropTurn; lift: number } | null,
  house: { yaw: number; lift: number } | null,
  houseMost: number,
  now: number,
  tune: PlaceHoldTune = PLACE_HOLD_TUNE,
): boolean {
  if (which !== h.which) {
    h.which = which;
    h.since = now;
    h.raw = prop ? prop.lift : house ? house.lift : 0;
  }
  if (!which || (!dx && !dy) || (!prop && !house)) return false;
  if (which === 'lift') {
    const d = liftDelta(dy, dt, sens, prop ? 'prop' : 'house', tune);
    if (!d) return false;
    h.gain = holdGain(dy, dt, tune);
    const most = prop ? PROP_TUNE.most : houseMost;
    h.raw = Math.min(most, Math.max(-most, h.raw + d));
    if (prop) prop.lift = propLiftTo(h.raw);
    else if (house) house.lift = keepLift(h.raw, houseMost);
    return true;
  }
  if (which === 'tumble') {
    if (!prop) return false;
    const t = tumbleDeltas(dx, dy, dt, sens, tune, TUMBLE);
    h.gain = holdGain(Math.hypot(dx, dy), dt, tune);
    tumbleBy(prop.turn, axes, t.tip, t.roll);
    return true;
  }
  const turn = turnDelta(dy, dx, dt, sens, tune);
  if (!turn) return false;
  h.gain = holdGain(tune.sideways ? Math.hypot(dx, dy) : dy, dt, tune);
  if (prop) turnAbout(prop.turn, 0, 1, 0, turn, prop.turn);
  else if (house) house.yaw = turnTo(house.yaw + turn);
  return true;
}
