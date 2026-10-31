// The AI handoff's first three steps, as a ledger and three switches.
//
// The owner's AI handoff closes on one rule: "the sandbox ledger is the definition of
// done" -- mirror it as counters in the game, so each step is measured in the game's own levels rather than judged by
// eye. This is that mirror for the steps built so far, and nothing else:
//
//   1. **The wall tests.** Two bodies in one building -- or both outside -- were never tested for a wall between them,
//      and a body inside never saw the outer shell in any line test, which is "fighting in the wall" and shooting
//      through the door jamb (`wallBetween` in `nav/doorway.ts`, `Physics.segmentBlocked`'s `full`).
//   2. **Aim at the player's real posture.** Everything that shoots at the player aimed at a constant 0.9 m whatever
//      the player was doing, so a table hid nobody lying behind it (`PlayerTarget.halfHeight` in `world.ts`, and a
//      peer's posture off the state they send, `peerLow` in `net/remoteBodies.ts`).
//   3. **Route every move.** The standoff ring, the backing off and the run to cover steered straight at their point,
//      because the route was asked only outside the attack state; the slide's lean rewrote the heading after the
//      corner was chosen; and a tactical goal was picked first and walked into after (`Npc.act`, `GroundTactics`).
//
// **These three are bugs, not skill**, so every tier has them, tier 0 included: `GROUND_SKILL` decides how well a body
// fights, and none of it decides whether a wall is a wall.
//
// Each step has a switch here (`AI_FIX`), which is the comparison and nothing else reads it: off, that step's code is
// exactly the code it replaced, so `__debug.aiLedger({ fixes: { walls: false } })` measures the same scene the way it
// was. The counters are always kept -- what they cost is a few rays a thought for a body in a fight and one a blow
// landed -- and they read the truth the same way whatever the switches say, so a "before" and an "after" are the same
// ruler on two behaviours.
//
// Node-loadable: the physics comes in through `LedgerPhysics`, which `Physics` satisfies and a test builds round a
// real Rapier world.
import { Group, groups, RAPIER } from '../core/physics.ts';
import type { CellState } from './layoutStream.ts';
import { PLAYER_KEY, type Living } from '../combat/kit.ts';

/** The three steps, each one switch. On is the fix; off is the code it replaced, to the line. */
export interface AiFixes {
  /** Step 1: a wall test compares rooms and always asks the physics, and a line across the outer shell tests the shell. */
  walls: boolean;
  /** Step 2: the player is aimed at the middle of the capsule they are really wearing, and a peer at the posture they send. */
  posture: boolean;
  /** Step 3: every move is routed, a slide's lean is laid on its goal before the route, and a tactical goal is checked first. */
  route: boolean;
}

export const AI_FIX: AiFixes = { walls: true, posture: true, route: true };

/** What one kind of body did in its fights, counted as it happened. Seconds, or a count. */
export interface LedgerRow {
  /** Seconds spent in a fight: a live target, and chasing, attacking, in cover or staring at it. */
  fighting: number;
  /** Of those, seconds with a wall within `brush` of its side at waist height (`wallNear`). */
  brushing: number;
  /** Of those, seconds it asked to move and covered less than `pushShare` of it: leaning on something. */
  pushing: number;
  /** Of those, seconds attacking something with a wall between them (`seesLine`, shell and shut doors counted). */
  wallFight: number;
  /** Blows and bolts it landed on anything alive. */
  hits: number;
  /** Of those, the ones on a body it had no line to at the moment they landed. */
  unseen: number;
  /** Shots it fired. */
  shots: number;
  /** Tactical goals (a place on the standoff ring, a cover spot) refused before they were picked (step 3). */
  refused: number;
}

/** What the player was, to the guns: the shots at them, what landed, and how much of the time a shooter had a line. */
export interface LedgerPlayer {
  /** Shots fired at the player. */
  shotsAt: number;
  /**
   * Of those, the ones fired while the shooter had no line to the middle of the capsule the player was really wearing
   * (`seesLine`, measured as the shot left): a shot at a body crouched or lying behind something, which is what step 2
   * is about. Measured off the player's own capsule whatever `AI_FIX.posture` says.
   */
  hidden: number;
  /** Bolts and blows that landed on the player. */
  hitsOn: number;
  /** Seconds a body with a gun spent fighting the player, and of those the seconds it believed it had a line. */
  watched: number;
  line: number;
}

export interface AiLedger {
  /** The world's simulated clock when the counters were last cleared. */
  since: number;
  /** The fighters (`npcs.ts`), and the people and creatures from the catalogue (`mobiles/`). */
  fighters: LedgerRow;
  people: LedgerRow;
  player: LedgerPlayer;
}

const row = (): LedgerRow => ({ fighting: 0, brushing: 0, pushing: 0, wallFight: 0, hits: 0, unseen: 0, shots: 0, refused: 0 });

export const AI_LEDGER: AiLedger = { since: 0, fighters: row(), people: row(), player: { shotsAt: 0, hidden: 0, hitsOn: 0, watched: 0, line: 0 } };

/**
 * The ruler's own numbers, live through `__debug.aiLedger({ tune: … })`. They are not feel -- nothing a body does
 * reads them -- but they are invented, so they move like everything else of ours.
 */
export interface LedgerTune {
  /** How near a wall counts as brushing it, metres past the body's own radius. */
  brush: number;
  /** How high over the feet the brushing rays are cast, metres: a wall and not a kerb, a table edge or the floor. */
  brushHeight: number;
  /** The share of a step asked for that a body must cover not to count as pushing into something. */
  pushShare: number;
  /**
   * The window a dynamic body's pushing is measured over, seconds: a person or creature moves only on the physics' own
   * whole sixtieths, so a frame of a fast screen between two steps covers nothing it asked for. A fighter's controller
   * answers the frame it is asked, and is measured a frame at a time.
   */
  pushWindow: number;
}

export const LEDGER_TUNE: LedgerTune = { brush: 0.12, brushHeight: 1.0, pushShare: 0.5, pushWindow: 0.25 };

/** Clear every counter, from the world's clock now. */
export function resetLedger(now: number): void {
  AI_LEDGER.since = now;
  Object.assign(AI_LEDGER.fighters, row());
  Object.assign(AI_LEDGER.people, row());
  Object.assign(AI_LEDGER.player, { shotsAt: 0, hidden: 0, hitsOn: 0, watched: 0, line: 0 });
}

/** Where everything aimed at the player before step 2, whatever the player was doing. */
export const OLD_PLAYER_MIDDLE = 0.9;

/**
 * Where everything that shoots at the player aims, over the feet (step 2, `PlayerTarget.halfHeight`): the middle of the
 * capsule the player is wearing this instant (`Player.colliderOffsetY`, which the crouch writes as the radius and the
 * half it wears), read off the player's own capsule and never copied. No capsule handed over, or `AI_FIX.posture` off,
 * is the constant it was.
 */
export function playerMiddle(capsule: { readonly colliderOffsetY: number } | null): number {
  return AI_FIX.posture && capsule ? capsule.colliderOffsetY : OLD_PLAYER_MIDDLE;
}

/**
 * The height over its feet the player's shots, and another player's, are taken to come from by anything that judges
 * cover against them (`Living.shotHeight`): the 0.9 everything took them to be before step 2, held whatever their
 * posture. Step 2 moved where they are **aimed at** -- 0.5 m while they crouch, kneel or lie prone, the middle of the
 * low capsule, which is at the hip -- and their gun did not go down to the hip with it, so cover judged against a shot
 * from there was cover they shoot over. Not a measurement of the player's muzzle: the number the cover search always
 * read for them, kept.
 */
export const PLAYER_SHOT_FROM = OLD_PLAYER_MIDDLE;

/**
 * The height over its feet a shot from `t` comes from, for anything that judges cover against it (`CoverAsk.ty`): its
 * own `shotHeight` where it says one (the player and another player, `PLAYER_SHOT_FROM`), else its aim point
 * (`halfHeight`), which is what every other threat has always been taken to shoot from.
 */
export function shotHeightOf(t: Living): number {
  const h = t.shotHeight;
  return h !== undefined ? h : t.halfHeight;
}

/** What the ledger asks of the physics: `Physics` answers both, and a node test's world does too. */
export interface LedgerPhysics {
  readonly world: RAPIER.World;
  readonly stillOrWall: (c: RAPIER.Collider) => boolean;
  segmentBlocked(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, inside: boolean, walls?: boolean, full?: boolean): boolean;
}

/**
 * Whether two things followed in `here` and `there` stand on different sides of an outer shell: one in a building and
 * the other out, or the two in different buildings. A line between them crosses at least one shell, which an indoor
 * ray leaves out, so such a line has to be tested against everything (`Physics.segmentBlocked`'s `full`). `there`
 * undefined is a thing nobody follows (another player's figure, a turret): nobody can say which side it is on, and
 * the old answer stands.
 */
export function acrossShell(here: CellState | null, there: CellState | null | undefined): boolean {
  if (there === undefined) return false;
  return (here ? here.building : null) !== (there ? there.building : null);
}

const lineFrom = { x: 0, y: 0, z: 0 };
const lineTo = { x: 0, y: 0, z: 0 };

/**
 * The ruler's line: whether a body at (ax, ay, az) followed in `here` has a clear line to a point (bx, by, bz) followed
 * in `there`, against what stands still **and a shut door**, the shell counted wherever the two are on different
 * sides of it. It is step 1's own rule, asked whatever `AI_FIX` says, so the ledger measures before and after alike.
 */
export function seesLine(physics: LedgerPhysics, here: CellState | null, there: CellState | null | undefined, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  lineFrom.x = ax;
  lineFrom.y = ay;
  lineFrom.z = az;
  lineTo.x = bx;
  lineTo.y = by;
  lineTo.z = bz;
  return !physics.segmentBlocked(lineFrom, lineTo, !!here, true, acrossShell(here, there));
}

/** The brushing rays, kept: eight round a body, written into one ray and never made. */
const brushRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
const BRUSH_DIRS = 8;
/** Indoors the ground and the outer shells are left out, as every other indoor ray leaves them; outdoors only the ground is. */
const BRUSH_INSIDE = groups(Group.all, Group.all & ~(Group.terrain | Group.exterior));
const BRUSH_OUTSIDE = groups(Group.all, Group.all & ~Group.terrain);

/**
 * Whether a wall stands within `reach` of a body's middle line, at `LEDGER_TUNE.brushHeight` over its feet: eight
 * rays, flat, against what stands still and a shut door. The ground is never a wall here -- a slope would be brushed
 * all day -- and indoors the shells are left out as a body indoors leaves them out.
 */
export function wallNear(physics: LedgerPhysics, x: number, y: number, z: number, reach: number, inside: boolean): boolean {
  if (!(reach > 0)) return false;
  const r = brushRay;
  r.origin.x = x;
  r.origin.y = y + LEDGER_TUNE.brushHeight;
  r.origin.z = z;
  const filter = inside ? BRUSH_INSIDE : BRUSH_OUTSIDE;
  for (let i = 0; i < BRUSH_DIRS; i++) {
    const a = (i / BRUSH_DIRS) * Math.PI * 2;
    r.dir.x = Math.sin(a);
    r.dir.y = 0;
    r.dir.z = Math.cos(a);
    if (physics.world.castRay(r, reach, true, undefined, filter, undefined, undefined, physics.stillOrWall)) return true;
  }
  return false;
}

/** The world's half of what a landed blow is measured with: set by the world, read by every body's `damage`. */
export const LEDGER_WORLD: { physics: LedgerPhysics | null; cellOf: ((t: Living) => CellState | null | undefined) | null; now: () => number } = {
  physics: null,
  cellOf: null,
  now: () => 0,
};

/** Something that keeps a row of the ledger: a fighter, a person or creature from the catalogue. */
export interface LedgerKeeper {
  readonly ledgerRow: LedgerRow;
}

/**
 * A blow or a bolt from `source` landing on `target`, measured as it lands: counted on the striker's own row, and as
 * unseen when the striker had no line to it (`seesLine`, from the striker's middle to the target's). Only a body that
 * keeps a row is counted -- a fighter, a person or creature from the catalogue -- so the player's own blows and
 * another player's go by. One ray a blow; nothing made.
 */
export function noteLanded(source: Living | null | undefined, target: Living): void {
  const keeper = source as (Living & Partial<LedgerKeeper>) | null | undefined;
  const r = keeper?.ledgerRow;
  if (!keeper || !r || keeper === target || keeper.key === target.key) return;
  r.hits++;
  if (target.key === PLAYER_KEY) AI_LEDGER.player.hitsOn++;
  const physics = LEDGER_WORLD.physics;
  if (!physics) return;
  const cellOf = LEDGER_WORLD.cellOf;
  const here = cellOf ? cellOf(keeper) : undefined;
  const there = cellOf ? cellOf(target) : undefined;
  if (!seesLine(physics, here ?? null, there, keeper.pos.x, keeper.pos.y + keeper.halfHeight, keeper.pos.z, target.pos.x, target.pos.y + target.halfHeight, target.pos.z)) r.unseen++;
}

/**
 * A shot fired by `shooter` from (fx, fy, fz), its muzzle, at `target`, counted on the shooter's row; at the player,
 * counted as one at the player, and as hidden when the muzzle had no line to the middle of the capsule the player really
 * wears (`capsule.colliderOffsetY`, read whatever step 2's switch says, so the ruler is the same before and after). One
 * ray a shot at the player.
 */
export function noteShot(shooter: Living & LedgerKeeper, target: Living, fx: number, fy: number, fz: number): void {
  shooter.ledgerRow.shots++;
  if (target.key !== PLAYER_KEY) return;
  const p = AI_LEDGER.player;
  p.shotsAt++;
  const physics = LEDGER_WORLD.physics;
  if (!physics) return;
  const capsule = (target as Living & { capsule?: { readonly colliderOffsetY: number } | null }).capsule;
  const middle = capsule ? capsule.colliderOffsetY : target.halfHeight;
  const cellOf = LEDGER_WORLD.cellOf;
  const here = cellOf ? cellOf(shooter) : undefined;
  const there = cellOf ? cellOf(target) : undefined;
  if (!seesLine(physics, here ?? null, there, fx, fy, fz, target.pos.x, target.pos.y + middle, target.pos.z)) p.hidden++;
}

/** A body's fight this frame, counted: `dt` seconds in it, and what was true of it for those seconds. */
export function noteFight(r: LedgerRow, dt: number, brushing: boolean, pushing: boolean, wallFight: boolean): void {
  r.fighting += dt;
  if (brushing) r.brushing += dt;
  if (pushing) r.pushing += dt;
  if (wallFight) r.wallFight += dt;
}

/**
 * A dynamic body's pushing, judged over a window and not a frame: where the window began, how long it has run and the
 * ground the body asked for in it. A person or creature from the catalogue moves only on the physics' own whole
 * sixtieths, so a frame of a fast screen between two steps covers nothing it asked for, and judged a frame at a time it
 * would be "pushing" on most frames at 144 a second. One per body, written into.
 */
export interface PushWatch {
  fromX: number;
  fromZ: number;
  clock: number;
  asked: number;
}

export function newPushWatch(): PushWatch {
  return { fromX: 0, fromZ: 0, clock: 0, asked: 0 };
}

/** A body out of its fight: the window begins again at its next frame in one. */
export function clearPush(w: PushWatch): void {
  w.clock = 0;
  w.asked = 0;
}

/**
 * One frame of a body in a fight: `dt` seconds of it, asking for `commanded` metres a second, standing at (x, z) after
 * the frame's step. Once the window has run `LEDGER_TUNE.pushWindow` seconds it is judged -- it asked for more than a
 * few centimetres and covered less than `pushShare` of them -- and the whole window goes on `r.pushing`, and the next
 * begins where the body stands.
 */
export function stepPush(w: PushWatch, r: LedgerRow, dt: number, commanded: number, x: number, z: number): void {
  if (w.clock === 0) {
    w.fromX = x;
    w.fromZ = z;
  }
  w.clock += dt;
  w.asked += commanded * dt;
  if (w.clock < LEDGER_TUNE.pushWindow) return;
  const dx = x - w.fromX;
  const dz = z - w.fromZ;
  const covered = Math.sqrt(dx * dx + dz * dz);
  if (w.asked > 0.05 && covered < w.asked * LEDGER_TUNE.pushShare) r.pushing += w.clock;
  w.clock = 0;
  w.asked = 0;
}

/** The ledger as the console prints it: every count, and each fight count as a share of the fight as well. */
export function ledgerReport(now: number): Record<string, unknown> {
  const share = (n: number, of: number): number => (of > 0 ? Number((n / of).toFixed(3)) : 0);
  const rowOut = (r: LedgerRow) => ({
    fighting: Number(r.fighting.toFixed(1)),
    brushing: Number(r.brushing.toFixed(1)),
    brushingShare: share(r.brushing, r.fighting),
    pushing: Number(r.pushing.toFixed(1)),
    pushingShare: share(r.pushing, r.fighting),
    wallFight: Number(r.wallFight.toFixed(1)),
    wallFightShare: share(r.wallFight, r.fighting),
    hits: r.hits,
    unseen: r.unseen,
    unseenShare: share(r.unseen, r.hits),
    shots: r.shots,
    refused: r.refused,
  });
  const p = AI_LEDGER.player;
  return {
    seconds: Number((now - AI_LEDGER.since).toFixed(1)),
    fixes: { ...AI_FIX },
    fighters: rowOut(AI_LEDGER.fighters),
    people: rowOut(AI_LEDGER.people),
    player: { shotsAt: p.shotsAt, hidden: p.hidden, hiddenShare: share(p.hidden, p.shotsAt), hitsOn: p.hitsOn, watched: Number(p.watched.toFixed(1)), line: Number(p.line.toFixed(1)), lineShare: share(p.line, p.watched) },
    tune: { ...LEDGER_TUNE },
  };
}

/** Move the switches and the ruler's numbers; a switch only by a switch and a number only by a number. */
export function tuneLedger(opts: { fixes?: Partial<AiFixes>; tune?: Partial<LedgerTune> } | null | undefined): void {
  if (!opts) return;
  for (const k of Object.keys(AI_FIX) as (keyof AiFixes)[]) {
    const v = opts.fixes?.[k];
    if (typeof v === 'boolean') AI_FIX[k] = v;
  }
  for (const k of Object.keys(LEDGER_TUNE) as (keyof LedgerTune)[]) {
    const v = opts.tune?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) LEDGER_TUNE[k] = Math.max(0, v);
  }
}
