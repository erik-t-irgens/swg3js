// Which imported clip the legs play for each way the body goes and each speed class, standing: the brief's
// "Locomotion" list as one table, and the three rules read off it. What turns the body (`turnDeg`): the travel's
// angle less the clip's own heading, so a clip made for the way moved leaves the body facing the view and a strafe
// used for a diagonal turns it 45 degrees. What a class moves at (`speedOf`, and `fillSpeeds` for a frame). And what
// another player's figure plays, worked out from what their game already sends (`peerPick`): how their travel lies
// against their heading gives the clip's heading, and their speed the class.
//
// A cell names its clip by gait where the brief lists several for one speed (the forward walk), and the whole table
// is keyed by posture, so the crouched and prone sets and the creator's gait are rows more and no new rule.
//
// Pure: the player's update, the peers' and the node tests all call these very functions. Every pick is made once,
// as this module loads, so asking for one on a frame makes nothing; and what a frame reads of a pick's speed it
// reads out of an array of its own (`fillSpeeds`, a pick's `slot`), never through a name worked out on the frame.

import type { LocoTune } from './locoTune.ts';

/** The speed classes: 1 walk, 2 jog, 3 run, 4 sprint. */
export type LocoClass = 1 | 2 | 3 | 4;
export const CLASS_NAMES: readonly string[] = ['', 'walk', 'jog', 'run', 'sprint'];

/** The eight ways the keys move a body, counted round to the left from forward in steps of 45 degrees. */
export const DIRS = ['F', 'FL', 'L', 'BL', 'B', 'BR', 'R', 'FR'] as const;
export type LocoDir = (typeof DIRS)[number];

/** The postures the table has rows for (standing, this wave) and the gaits it knows. */
export type LocoPosture = 'stand';
export type LocoGait = 'standard';
export const GAITS: readonly LocoGait[] = ['standard'];

/**
 * The states the sender's rig is put in and the wire carries: the walk class is `walk` and every other `run`,
 * whichever way the body goes. Both are names every build has a clip for (a build from before the classes, or a
 * figure without the imported clips, shows its own walk or run), and neither is one Jedi Academy's own legs use for
 * backing up (`walkBack`, `runBack`), so a figure that sends one of those is blocking or fighting and is shown that
 * game's back-pedal, never the table's.
 */
export type LocoState = 'walk' | 'run';

/** One cell of the table, resolved. */
export interface LocoPick {
  /** The pack's clip id and the game's name for it. */
  id: string;
  clip: string;
  /** The way the clip's own feet carry it, degrees, to the nearest 45 (0 forward, +90 left, 180 back). */
  heading: number;
  /** The way the keys ask, as an index into `DIRS`, and the class the cell is (a way with no sprint gives its run). */
  dir: number;
  cls: LocoClass;
  /** Which dial of `LocoTune.speed` the cell moves at, and its place in a frame's array of them (`fillSpeeds`). */
  group: keyof LocoTune['speed'];
  key: string;
  slot: number;
  /** The state the rig is put in for it. */
  state: LocoState;
  /** How far the body is turned from the view for it, degrees (+ left): the travel's angle less the clip's heading. */
  turn: number;
  /**
   * The sideways walk's choice (`LocoTune.sideWalkClip`) this cell belongs to (`SIDE_STRAFE`, `SIDE_DIAGONAL`,
   * `SIDE_FORWARD`), or -1 for a cell every choice shares: what the peers' side steps over when another is in force.
   */
  side: number;
}

/** A clip id, or one by gait. */
type Cell = string | Record<LocoGait, string>;
interface DirRows {
  group: keyof LocoTune['speed'];
  /** By class 1 to 3 (and 4 where the way has a sprint). */
  cells: Partial<Record<LocoClass, Cell>>;
  /** The jog while tired, where the way has one. */
  tired?: Cell;
  /**
   * With a blaster up (ready or aimed) and the tune's `gunSquare` on, the clip for every class of this way, where the
   * way's own cells would turn the body from the view: a diagonal's own jog clip, slowed for the walk and quickened
   * for the run. A body turned 45 degrees for a strafe cannot also hold a barrel on the crosshair (the spine has not
   * got the turn), so with a gun up it stays square to the view and its feet still go the way it does.
   */
  up?: Cell;
  /**
   * Sideways only: the walk class's clip under the two newer choices of `LocoTune.sideWalkClip` (the plain cell is
   * the third, 'strafe'): 'diagonal' the walked forward diagonal's own clip, 'forward' the forward walk.
   */
  sideWalk?: { diagonal: Cell; forward: Cell };
}

/**
 * The table: the owner's brief, row for row. Sideways at the walk is the slow strafe (the brief's sideways
 * "speed 0", by the owner's answer); a forward diagonal's walk and run are the strafe walks and the strafes with the
 * body turned, and a backward diagonal's the backward clips with the body turned; the jogs have clips of their own,
 * the right-hand ones as the files are and the left-hand ones their mirror images.
 */
export const LOCO_TABLE: Record<LocoPosture, Record<LocoDir, DirRows>> = {
  stand: {
    F: { group: 'forward', cells: { 1: { standard: 'standard_walk' }, 2: 'slow_run', 3: 'running', 4: 'fast_run' }, tired: 'drunk_run_forward' },
    FL: { group: 'forwardDiag', cells: { 1: 'left_strafe_walking', 2: 'jog_forward_diagonal_mirrored', 3: 'left_strafe' }, up: 'jog_forward_diagonal_mirrored' },
    L: { group: 'side', cells: { 1: 'walk_strafe_left', 2: 'jog_strafe_left', 3: 'left_strafe' }, sideWalk: { diagonal: 'left_strafe_walking', forward: { standard: 'standard_walk' } } },
    BL: { group: 'backDiag', cells: { 1: 'walking_backwards', 2: 'jog_backward_diagonal_mirrored', 3: 'running_backward' }, up: 'jog_backward_diagonal_mirrored' },
    B: { group: 'back', cells: { 1: 'walking_backwards', 2: 'jog_backward', 3: 'running_backward' } },
    BR: { group: 'backDiag', cells: { 1: 'walking_backwards', 2: 'jog_backward_diagonal', 3: 'running_backward' }, up: 'jog_backward_diagonal' },
    R: { group: 'side', cells: { 1: 'walk_strafe_right', 2: 'jog_strafe_left_mirrored', 3: 'left_strafe_mirrored' }, sideWalk: { diagonal: 'right_strafe_walking', forward: { standard: 'standard_walk' } } },
    FR: { group: 'forwardDiag', cells: { 1: 'right_strafe_walking', 2: 'jog_forward_diagonal', 3: 'left_strafe_mirrored' }, up: 'jog_forward_diagonal' },
  },
};

/**
 * The way each clip's feet carry it, degrees, to the nearest 45: what the pack's index measures (`heading`), rounded.
 * Written out, since the table is read before the pack's index has been fetched; the node test holds every one to
 * the committed index's own measurement.
 */
export const CLIP_HEADING: Readonly<Record<string, number>> = {
  standard_walk: 0,
  slow_run: 0,
  drunk_run_forward: 0,
  running: 0,
  fast_run: 0,
  walking_backwards: 180,
  jog_backward: 180,
  running_backward: 180,
  left_strafe_walking: 90,
  right_strafe_walking: -90,
  walk_strafe_left: 90,
  walk_strafe_right: -90,
  jog_strafe_left: 90,
  jog_strafe_left_mirrored: -90,
  left_strafe: 90,
  left_strafe_mirrored: -90,
  jog_forward_diagonal: -45,
  jog_forward_diagonal_mirrored: 45,
  jog_backward_diagonal: -135,
  jog_backward_diagonal_mirrored: 135,
};

/** An angle in degrees brought into -180 (not included) to 180. */
export function wrapDeg(a: number): number {
  let d = a % 360;
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  return d;
}

/** A measured heading to its nominal: the nearest of 0, +-45, +-90, +-135 and 180. */
export function nominalHeading(deg: number): number {
  // A whole number of eighths of a turn (never a negative nought, which is no small integer and would be a number made).
  const eighths = Math.round(deg / 45) | 0;
  let d = (eighths * 45) % 360;
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  return d;
}

/** The way the keys ask as an index into `DIRS` (`mz` forward, `mx` to the right, each -1, 0 or 1), or -1 for none. */
export function dirOf(mz: number, mx: number): number {
  if (mz > 0) return mx < 0 ? 1 : mx > 0 ? 7 : 0;
  if (mz < 0) return mx < 0 ? 3 : mx > 0 ? 5 : 4;
  return mx < 0 ? 2 : mx > 0 ? 6 : -1;
}

/** The travel's angle from the view for a way, degrees (+ left). */
export function travelDeg(dir: number): number {
  return wrapDeg(dir * 45);
}

/** The highest class a way has: the sprint is forward's alone. */
export function topClass(dir: number): LocoClass {
  return dir === 0 ? 4 : 3;
}

/**
 * Where each dial of `LocoTune.speed` stands in a frame's array of them: one place a dial, in the tune's own order.
 * `fillSpeeds` writes them by name, so reading a pick's speed on a frame is one read of an array by a whole number.
 */
const SLOTS: Record<string, number> = {
  'forward.walk': 0, 'forward.jog': 1, 'forward.tired': 2, 'forward.run': 3, 'forward.sprint': 4,
  'back.walk': 5, 'back.jog': 6, 'back.run': 7,
  'side.walk': 8, 'side.jog': 9, 'side.run': 10,
  'forwardDiag.walk': 11, 'forwardDiag.jog': 12, 'forwardDiag.run': 13,
  'backDiag.walk': 14, 'backDiag.jog': 15, 'backDiag.run': 16,
};
/** How many speeds a tune has, and the forward jog's place among them (what standing still reads). */
export const SPEED_SLOTS = 17;
export const JOG_SLOT = 1;

/** Every class speed of a tune, into an array kept by the caller (`SPEED_SLOTS` long), each at its dial's place. */
export function fillSpeeds(tune: LocoTune, out: Float64Array): void {
  const s = tune.speed;
  out[0] = s.forward.walk;
  out[1] = s.forward.jog;
  out[2] = s.forward.tired;
  out[3] = s.forward.run;
  out[4] = s.forward.sprint;
  out[5] = s.back.walk;
  out[6] = s.back.jog;
  out[7] = s.back.run;
  out[8] = s.side.walk;
  out[9] = s.side.jog;
  out[10] = s.side.run;
  out[11] = s.forwardDiag.walk;
  out[12] = s.forwardDiag.jog;
  out[13] = s.forwardDiag.run;
  out[14] = s.backDiag.walk;
  out[15] = s.backDiag.jog;
  out[16] = s.backDiag.run;
}

/** The variants of a cell: plain, tired, a blaster up (ready or aimed) with the body kept square. */
export const PLAIN = 0, TIRED = 1, GUN_UP = 2;
const VARIANTS = 3;
/** The sideways walk's choices (`LocoTune.sideWalkClip`), by number: the slow strafe (as before), the walked diagonal's own clip, the forward walk. */
export const SIDE_STRAFE = 0, SIDE_DIAGONAL = 1, SIDE_FORWARD = 2;
const SIDES = 3;
/** A tune's sideways walk as a number (`SIDE_*`). */
export function sideMode(tune: LocoTune): number {
  const s = tune.sideWalkClip;
  return s === 'diagonal' ? SIDE_DIAGONAL : s === 'forward' ? SIDE_FORWARD : SIDE_STRAFE;
}
/** Every pick, made once: by posture, gait, way, class, variant and the sideways walk's choice. */
const PICKS: (LocoPick | null)[] = [];
/** And each of them once, in the order made: what the peers' side walks. */
const UNIQUE: LocoPick[] = [];
const at = (gait: number, dir: number, cls: number, variant: number, side: number) => (((gait * 8 + dir) * 5 + cls) * VARIANTS + variant) * SIDES + side;

function build(): void {
  const rows = LOCO_TABLE.stand;
  GAITS.forEach((gait, g) => {
    DIRS.forEach((name, dir) => {
      const row = rows[name];
      for (let cls = 1 as LocoClass; cls <= 4; cls = (cls + 1) as LocoClass) {
        // A way with no sprint gives its run.
        const eff = Math.min(cls, topClass(dir)) as LocoClass;
        for (let variant = 0; variant < VARIANTS; variant++) {
          for (let side = 0; side < SIDES; side++) {
            let cell = row.cells[eff];
            let key = CLASS_NAMES[eff];
            // A cell of one of the sideways walk's choices (the walk class sideways), or -1 for one every choice shares.
            let tag = -1;
            if (variant === TIRED && eff === 2 && row.tired) {
              cell = row.tired;
              key = 'tired';
            } else if (variant === GUN_UP && row.up) {
              // The class's own speed (its dial), on the clip that keeps the body square.
              cell = row.up;
            } else if (eff === 1 && row.sideWalk) {
              // Walking sideways: the slow strafe as before, the walked diagonal's own clip, or the forward walk with the
              // body turned. With a blaster up the forward walk's turn would take the barrel off the crosshair, so that
              // choice plays the diagonal's clip square (the slow strafe stays the slow strafe).
              tag = side;
              if (side === SIDE_DIAGONAL || (side === SIDE_FORWARD && variant === GUN_UP)) cell = row.sideWalk.diagonal;
              else if (side === SIDE_FORWARD) cell = row.sideWalk.forward;
            }
            if (!cell) {
              PICKS[at(g, dir, cls, variant, side)] = null;
              continue;
            }
            const id = typeof cell === 'string' ? cell : cell[gait];
            const heading = CLIP_HEADING[id];
            const state: LocoState = eff === 1 ? 'walk' : 'run';
            const made: LocoPick = { id, clip: `mx_${id}`, heading, dir, cls: eff, group: row.group, key, slot: SLOTS[`${row.group}.${key}`], state, turn: wrapDeg(travelDeg(dir) - heading), side: tag };
            // One object a cell, however many classes, variants and choices name it.
            const same = UNIQUE.find((p) => p.id === made.id && p.dir === made.dir && p.cls === made.cls && p.key === made.key && p.side === made.side);
            if (same) PICKS[at(g, dir, cls, variant, side)] = same;
            else {
              UNIQUE.push(Object.freeze(made));
              PICKS[at(g, dir, cls, variant, side)] = UNIQUE[UNIQUE.length - 1];
            }
          }
        }
      }
    });
  });
}
build();

/**
 * The clip for a way (`dirOf`) and a class: the tired jog in place of the forward jog while tired; with a blaster
 * up and kept square (`gun` `GUN_UP`) a diagonal's own jog clip at every class; and walking sideways, the clip of the
 * sideways walk's choice (`side`, `SIDE_*`: the slow strafe unless said). Null for no way.
 */
export function locoPick(dir: number, cls: number, tired = false, gun: number = PLAIN, gait: LocoGait = 'standard', side: number = SIDE_STRAFE): LocoPick | null {
  if (dir < 0 || dir > 7) return null;
  const g = Math.max(0, GAITS.indexOf(gait));
  const c = cls < 1 ? 1 : cls > 4 ? 4 : cls | 0;
  const s = side === SIDE_DIAGONAL || side === SIDE_FORWARD ? side : SIDE_STRAFE;
  // Tired wins forward (only the forward jog has a tired clip, and forward has no gun-up one of its own).
  const variant = tired && dir === 0 ? TIRED : gun === GUN_UP ? GUN_UP : tired ? TIRED : PLAIN;
  return PICKS[at(g, dir, c, variant, s)] ?? null;
}

/** What a pick moves the body at, m/s, by the tune's dials. (The console's and the tests': a frame reads `fillSpeeds`' array at the pick's `slot`.) */
export function speedOf(tune: LocoTune, pick: LocoPick): number {
  return (tune.speed[pick.group] as Record<string, number>)[pick.key];
}

/** Every clip id the table can name, once each: what the importer marks for the game to load, and what a rig must have. */
export function tableClips(): string[] {
  const out = new Set<string>();
  for (const p of UNIQUE) out.add(p.id);
  return [...out];
}

/** Every pick the table can give, once each (the tests and the peers' side walk them). */
export function allPicks(): readonly LocoPick[] {
  return UNIQUE;
}

/**
 * The states of another player that are walking or running on foot, standing, by the speed classes: what their
 * figure's legs are worked out for. Never `walkBack` or `runBack`: those are Jedi Academy's back-pedal under a block
 * or a swing, which the classes never send, and the figure plays that game's own clip for them.
 */
const PEER_WALKS: readonly string[] = ['walk', 'gunWalk', 'gunReadyWalk', 'gunAimWalk'];
const PEER_RUNS: readonly string[] = ['run', 'gunRun', 'gunReadyRun', 'gunAimRun'];

/** Whether a peer's state is one the table answers for. */
export function peerLocoState(state: string): boolean {
  return PEER_WALKS.includes(state) || PEER_RUNS.includes(state);
}

/**
 * For a peer walking or running with a gun, the standing state of the same carry: its clip is what their upper body
 * keeps over the table's legs (relaxed, ready or aimed, as they stand when they stop). Null for a state with no gun.
 */
export function peerCarryState(state: string): 'gunIdle' | 'gunReadyIdle' | 'gunAimIdle' | null {
  if (!state.startsWith('gun')) return null;
  return state.startsWith('gunAim') ? 'gunAimIdle' : state.startsWith('gunReady') ? 'gunReadyIdle' : 'gunIdle';
}

/**
 * A figure sent `walk` or `run` going backward against its heading, on a rig without the table's clips (no pack, the
 * imported animations off): the state its own back-pedal is under, so it does not run forward while it slides back.
 * `rel` is the travel against the heading, degrees. Null leaves the state as sent.
 */
export function peerBackState(state: string, rel: number): 'walkBack' | 'runBack' | null {
  if (state !== 'walk' && state !== 'run') return null;
  return Math.abs(wrapDeg(rel)) > 112.5 ? (state === 'walk' ? 'walkBack' : 'runBack') : null;
}

/** What `peerPickIn` is asked: one kept record, so no number crosses the call. (Declared as fractions.) */
export class PeerAsk {
  /** How the figure's travel lies against the heading it sent, degrees (+ left). */
  rel = 0.5;
  /** How fast it goes, m/s. */
  speed = 0.5;
  /** The sideways walk's choice in force here (`SIDE_*`, `sideMode`): a cell of another choice is stepped over. */
  side = SIDE_STRAFE;
}

/**
 * What another player's legs play: `state` as their game sent it, and in `ask` how their travel lies against the
 * heading they sent and how fast they go; `speeds` the tune's class speeds (`fillSpeeds`). The clip is the table's
 * cell whose clip carries its feet the way nearest that travel (any of the eight: a state says the class's side of
 * the walk and nothing of the way) and whose class's speed is nearest; a state that says walk or run keeps the
 * answer to that side of the walk where the way has both. Null for a state the table does not answer for.
 */
export function peerPickIn(speeds: Float64Array, state: string, ask: PeerAsk): LocoPick | null {
  const walks = PEER_WALKS.includes(state);
  const runs = PEER_RUNS.includes(state);
  if (!walks && !runs) return null;
  const heading = nominalHeading(ask.rel);
  const speed = ask.speed;
  let best: LocoPick | null = null;
  let bestGap = Infinity;
  let any: LocoPick | null = null;
  let anyGap = Infinity;
  const side = ask.side;
  for (let i = 0; i < UNIQUE.length; i++) {
    const p = UNIQUE[i];
    if (p.heading !== heading) continue;
    if (p.side >= 0 && p.side !== side) continue;
    const d = speeds[p.slot] - speed;
    const gap = d < 0 ? -d : d;
    if (gap < anyGap) {
      anyGap = gap;
      any = p;
    }
    if (walks ? p.cls !== 1 : p.cls === 1) continue;
    if (gap < bestGap) {
      bestGap = gap;
      best = p;
    }
  }
  return best ?? any;
}

const PICK_SPEEDS = new Float64Array(SPEED_SLOTS);
const PICK_ASK = new PeerAsk();

/** `peerPickIn` for a tune and two numbers: the tests' and the console's way of asking. */
export function peerPick(tune: LocoTune, state: string, rel: number, speed: number): LocoPick | null {
  fillSpeeds(tune, PICK_SPEEDS);
  PICK_ASK.rel = rel;
  PICK_ASK.speed = speed;
  PICK_ASK.side = sideMode(tune);
  return peerPickIn(PICK_SPEEDS, state, PICK_ASK);
}
