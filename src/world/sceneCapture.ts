// Capturing a place to stand a character in: the creation and selection screens' backdrops.
//
// The owner picks these by eye and nobody else can. So rather than have them read numbers off a
// screen and copy them down, they stand where they want, aim the camera, and run one call: this
// turns what the game is doing into a line they can paste straight back. It is a pure function of
// plain numbers so the shape of that line is node-tested rather than only looked at, and so the
// converter and the game can later read the same struct without either of them importing three.
//
// **Every angle in the captured record is degrees and every distance is metres**, because the
// owner reads these and a radian is not a thing anyone eyeballs. The game's own turn sense is kept
// (a heading of 0 faces -Z and rises anticlockwise, which is what `Player.heading` already is), so
// a captured heading can be handed straight back to a body without anybody converting anything.

/** Where a thing stands, in the game's own frame and the game's own turn sense. */
export interface ScenePose {
  x: number;
  y: number;
  z: number;
  /** Degrees; 0 faces -Z, rising anticlockwise, which is `Player.heading` in degrees. */
  heading: number;
}

/** One captured backdrop, as the owner pastes it and as the converter will later read it. */
export interface SceneShot {
  /** What the owner called it, or a name made from the world and the hour. */
  name: string;
  /** The pack this was captured in: a planet id, or a planet and zone for a space scene. */
  pack: string;
  /** The world's own name for where this is, when the pack knows one within reach. */
  place: string | null;
  /** True for a space zone, where there is no ground and the sky is the whole backdrop. */
  space: boolean;
  /** Where the figure stands. */
  stand: ScenePose;
  /** Where the camera stands, and the point it is pointed at. */
  camera: { x: number; y: number; z: number; look: { x: number; y: number; z: number }; fov: number };
  /**
   * The hour to pin the scene at, 0 to 24. **Pinned on purpose**: the day runs, so a scene that
   * did not carry its own hour would be the same place at noon one launch and at midnight the
   * next, and a creator where the face cannot be seen is a bad creator.
   */
  hour: number;
  /**
   * Where a ship stands in this scene, for the selection screen, or null. Captured from a vehicle
   * the owner has parked in shot rather than typed: park it where it looks right and it is taken.
   */
  ship: ScenePose | null;
}

const TAU = Math.PI * 2;
const round = (v: number, places = 2): number => {
  const f = 10 ** places;
  const r = Math.round(v * f) / f;
  // -0 reads as a mistake in a pasted line and is never meant.
  return Object.is(r, -0) ? 0 : r;
};

/** A heading in radians as whole-ish degrees in [0, 360), which is what a person reads. */
export function headingDegrees(radians: number): number {
  if (!Number.isFinite(radians)) return 0;
  const deg = ((radians * 360) / TAU) % 360;
  return round(deg < 0 ? deg + 360 : deg, 1);
}

/** The day's own 0..1 as an hour of the clock. The day starts at midnight, as `DayCycle` does. */
export function hourOf(dayTime: number): number {
  if (!Number.isFinite(dayTime)) return 12;
  const t = ((dayTime % 1) + 1) % 1;
  return round(t * 24, 2);
}

/**
 * What the capture reads, handed in as plain numbers so this file needs no three, no world and no
 * browser. A caller with no ship parked passes null for it, and a ground world passes `space`
 * false; nothing here guesses either.
 */
export interface CaptureInput {
  name?: string;
  pack: string;
  place?: string | null;
  space?: boolean;
  stand: { x: number; y: number; z: number; heading: number };
  camera: { x: number; y: number; z: number; forward: { x: number; y: number; z: number }; fov: number };
  /** How far down the camera's own forward the look-at point is put. The figure's distance, so the shot is framed on it. */
  lookAhead?: number;
  dayTime: number;
  ship?: { x: number; y: number; z: number; heading: number } | null;
}

/**
 * Turn what the game is doing into a record the owner can paste and the converter can later read.
 *
 * The look-at point is the camera's own forward carried `lookAhead` metres, and `lookAhead`
 * defaults to the distance from the camera to the figure, so a shot composed in the third-person
 * view is framed on the figure without the owner having to aim at their own feet.
 */
export function captureScene(input: CaptureInput): SceneShot {
  const { camera: c, stand: s } = input;
  const toFigure = Math.hypot(s.x - c.x, s.y - c.y, s.z - c.z);
  const ahead = Number.isFinite(input.lookAhead) && (input.lookAhead as number) > 0 ? (input.lookAhead as number) : Math.max(0.5, toFigure);
  const f = c.forward;
  const len = Math.hypot(f.x, f.y, f.z) || 1;
  const hour = hourOf(input.dayTime);
  return {
    name: input.name?.trim() || `${input.pack}-${String(Math.round(hour)).padStart(2, '0')}h`,
    pack: input.pack,
    place: input.place ?? null,
    space: !!input.space,
    stand: { x: round(s.x), y: round(s.y), z: round(s.z), heading: headingDegrees(s.heading) },
    camera: {
      x: round(c.x),
      y: round(c.y),
      z: round(c.z),
      look: { x: round(c.x + (f.x / len) * ahead), y: round(c.y + (f.y / len) * ahead), z: round(c.z + (f.z / len) * ahead) },
      fov: round(c.fov, 1),
    },
    hour,
    ship: input.ship ? { x: round(input.ship.x), y: round(input.ship.y), z: round(input.ship.z), heading: headingDegrees(input.ship.heading) } : null,
  };
}

/**
 * The one line the owner pastes back. JSON on purpose rather than anything prettier: it survives a
 * chat window, a text file and a copy button without a stray newline changing what it means, and
 * whoever reads it next needs no parser of ours.
 */
export function sceneLine(shot: SceneShot): string {
  return JSON.stringify(shot);
}

/** Read one back, refusing anything that is not the shape above rather than half-trusting it. */
export function readSceneLine(text: string): SceneShot | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  const o = v as Partial<SceneShot>;
  const pose = (p: unknown): p is ScenePose => {
    const q = p as Partial<ScenePose>;
    return !!q && ['x', 'y', 'z', 'heading'].every((k) => Number.isFinite((q as Record<string, unknown>)[k] as number));
  };
  if (!o || typeof o.pack !== 'string' || !o.pack || typeof o.name !== 'string') return null;
  if (!pose(o.stand) || !o.camera || !Number.isFinite(o.hour)) return null;
  const c = o.camera;
  if (![c.x, c.y, c.z, c.fov].every((n) => Number.isFinite(n)) || !c.look) return null;
  if (![c.look.x, c.look.y, c.look.z].every((n) => Number.isFinite(n))) return null;
  if (o.ship !== null && o.ship !== undefined && !pose(o.ship)) return null;
  return { ...(o as SceneShot), ship: o.ship ?? null, place: o.place ?? null, space: !!o.space };
}
