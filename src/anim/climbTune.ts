// Every number of feel the climbing has (wave 4 of the animations: ledges, and maker B's wall climbing and the hands'
// bracing beside them), in one table. The owner decides these by hand: each is live through
// `__debug.climb({ tune: { ... } })` and a slider in the debug menu when `climb` is picked (`climbDials.ts`), and
// nothing here was chosen by measuring. A start is the brief's own number where it gave one, the human male's measured
// clip where the clip decides (src/anim/ledgeClips.ts holds those measurements), and otherwise the plainest thing that
// could be said for it, with the reason beside it.
//
// Pure: no three.js and nothing of the page, so the node tests move it as the console does.

export interface ClimbTune {
  /**
   * The ledges (maker A, the brief's item A): 'on' grabs a lip in the air, hangs from it braced or free, shimmies, hops,
   * climbs up, drops and jumps off; 'before' is the wave 3 commit's body to the bit (nothing is probed, nothing grabbed).
   */
  ledges: 'on' | 'before';
  /** The fastest fall a grab still takes, m/s (the brief's start): falling faster than this, a lip within reach is passed. */
  grabFall: number;
  /**
   * The hands' reach band over the feet, metres on the human male (scaled by the figure's own size): a lip whose grip
   * point (its top less `gripDrop`) stands between these over the body's feet can be grabbed. Measured from the rig in
   * node: the low end is the rest pose's head (1.62 m: the hands no lower than the face, arms bent), the high end the
   * free hang's own grip over its feet (2.285 m: the arms at full stretch, the shoulders up, as the free hang idle holds
   * them). A plain jump's apex is 0.8 m, so a standing jump grabs a lip whose top stands up to 3.15 m over the ground.
   */
  reachLow: number;
  reachHigh: number;
  /** How far ahead of the body's middle a face may stand for the hands to reach its lip, metres (the braced hang's own 0.38 m and an arm's bend more). */
  reachAhead: number;
  /**
   * How far under the lip's top the hands' grip point (between the wrist and the knuckles) hangs, metres on the human
   * male: measured off the climbs, whose feet end on the very top their hands started on (the braced climb 0.084, the
   * free climb 0.057, the step down into a free hang 0.038); their middle.
   */
  gripDrop: number;
  /** How far out from the face the grip point hangs, metres (the knuckles over the edge, the wrist out in front of it). */
  gripOut: number;
  /**
   * How far to the side a hop reaches for another lip, metres (the brief's start; the owner's to raise: its slider goes to
   * 8). The body is carried over whatever distance the lip found stands at, in the clip's own time.
   */
  hopSide: number;
  /** How far up a hop reaches for another lip, metres (the brief's start; its slider goes to 8 as well). */
  hopUp: number;
  /**
   * How steeply a lip may rise or fall along its length and still be shimmied along, degrees (the owner's addition while
   * wave 4 ran, his start): a shimmy goes on up or down a ramp's edge, a rock's rising lip or a stair's stringer up to this
   * either way and stops where the leading hand would reach a steeper part (each hand still grips the lip under it).
   */
  lipSlope: number;
  /**
   * How much of a sloping lip's own slope the hanging body is turned with, about its own front (0 none, 1 all of it):
   * ours, a start of half (his addition asked for "as much as looks natural", which is his to judge).
   */
  lipTilt: number;
  /** The shimmy's pace as a share of its clip's own (1: the clip's feet and hands keep their holds; braced 0.48 m/s, free 0.27 to 0.28 on the human male). */
  shimmy: number;
  /** How far ahead of the hand the shimmy feels for the lip's end, metres (a hand's width: the body stops with its leading hand still on). */
  edgeAhead: number;
  /** Stamina (wave 2a's pool, 100 points): what hanging drains a second, shimmying a second, and a hop at once (the brief's starts). */
  stamina: { hang: number; shimmy: number; hop: number };
  /** Seconds of a drop's let-go clip before the falling loop takes the body (the clip itself lands on its own ground, which the world's is not). */
  dropCut: number;
  /**
   * The jump off backward (S with Space, braced), m/s: back from the wall and up. From the clip's own flight (`jump_from_wall`
   * goes 1.79 m back and rises 0.96 m), under the game's own gravity (20.3 m/s^2): 6.25 up and 3.0 back land it there.
   */
  jumpBack: number;
  jumpUp: number;
  /** A free hang's drop with S and Space: how hard it pushes back off the lip, m/s (no clip of its own; a share of the jump's). */
  freePush: number;
  /** Seconds after letting go, jumping off or dropping during which the same lip is not grabbed again. */
  regrab: number;
  /** How long a change of the hands' and feet's placement eases in and out, seconds. */
  ease: number;
  /**
   * Wall climbing (maker B, the brief's item B; the owner's line 159: "a Breath of the Wild-like wall climbing system that
   * takes stamina"): 'on' climbs a face steeper than the climb limit and no steeper than upright after moving into it for
   * `wallStart`; 'before' is the wave 3 commit's body to the bit (nothing is felt for, nothing climbed).
   */
  wall: 'on' | 'before';
  /** How long W held into a climbable face starts the climb, seconds (the brief's start): a brush along a wall never does. */
  wallStart: number;
  /** The climb's speeds along the face, m/s (the brief's starts): up, down and sideways. The clips play at the rate that keeps their hands where they are. */
  wallSpeed: { up: number; down: number; side: number };
  /** Stamina on the wall a second (the brief's starts): climbing, and holding still. */
  wallStamina: { climb: number; still: number };
  /** The hands' bracing (the owner's brief's line 19), every number of its feel. */
  brace: BraceTune;
}

/** The hands bracing against a wall, in a tight spot, in a crowd and in space (the brief's item B, its second half). */
export interface BraceTune {
  /** 'on' reaches the hands out as the brief says; 'before' is the wave 3 commit's arms to the bit (nothing is felt for). */
  rule: 'on' | 'before';
  /** A passage narrower than this, wall to wall at the shoulders, has both hands touch its sides while moving, metres (the brief's start). */
  tight: number;
  /** Another player, or one of the world's people or creatures, within reach at the shoulders has the hand on their side rest on them (the brief's start: on). */
  people: 'on' | 'off';
  /** Drifting in space, a surface within this of the chest has both hands reach to it and step along it, metres (the brief's start). */
  spaceReach: number;
  /** How long a hand takes to reach out or come back, seconds (eased by the frame's own seconds, so alike at every rate). */
  ease: number;
  /**
   * How far from the body's middle line, at the shoulders, a face is within a hand's reach, metres on the human male (his
   * arm from the shoulder joint, 0.56, and the shoulder's own 0.19 off the middle line, less a hand's width: 0.7).
   */
  reach: number;
  /** How hard the body must be moving into a face (the share of its move pointed into it) before a hand braces at all: a third, a glance along a wall never does. */
  press: number;
  /** The body's speed below which a tight spot or a crowd is not reached for (standing still among people is not passing them), m/s. */
  moving: number;
  /** Where on a face or a body the palm is put, metres over the feet on the human male (a little under the shoulders, 1.3). */
  height: number;
}

export const CLIMB_TUNE: ClimbTune = {
  ledges: 'on',
  grabFall: 12,
  reachLow: 1.62,
  reachHigh: 2.285,
  reachAhead: 0.75,
  gripDrop: 0.06,
  gripOut: 0.03,
  hopSide: 1.5,
  hopUp: 1.5,
  lipSlope: 35,
  lipTilt: 0.5,
  shimmy: 1,
  edgeAhead: 0.12,
  stamina: { hang: 3, shimmy: 5, hop: 12 },
  dropCut: 0.3,
  jumpBack: 3,
  jumpUp: 6.25,
  freePush: 1.5,
  regrab: 0.4,
  ease: 0.15,
  wall: 'on',
  wallStart: 0.25,
  wallSpeed: { up: 1, down: 1.2, side: 0.8 },
  wallStamina: { climb: 8, still: 4 },
  brace: { rule: 'on', tight: 1.4, people: 'on', spaceReach: 1.2, ease: 0.2, reach: 0.7, press: 0.35, moving: 0.4, height: 1.3 },
};

/** What the game shipped with: what a reset puts back. */
export const CLIMB_TUNE_SHIPPED: ClimbTune = JSON.parse(JSON.stringify(CLIMB_TUNE)) as ClimbTune;

/** Each number's range, by its path: what a typed value is held to, and a slider's ends. */
export const CLIMB_RANGES: Record<string, { min: number; max: number }> = {
  grabFall: { min: 0, max: 40 },
  reachLow: { min: 0.5, max: 3 },
  reachHigh: { min: 0.5, max: 3.5 },
  reachAhead: { min: 0.3, max: 1.5 },
  gripDrop: { min: 0, max: 0.3 },
  gripOut: { min: -0.1, max: 0.3 },
  hopSide: { min: 0, max: 8 },
  hopUp: { min: 0, max: 8 },
  lipSlope: { min: 0, max: 60 },
  lipTilt: { min: 0, max: 1 },
  shimmy: { min: 0.2, max: 3 },
  edgeAhead: { min: 0, max: 0.5 },
  'stamina.hang': { min: 0, max: 50 },
  'stamina.shimmy': { min: 0, max: 50 },
  'stamina.hop': { min: 0, max: 100 },
  dropCut: { min: 0, max: 1.5 },
  jumpBack: { min: 0, max: 12 },
  jumpUp: { min: 0, max: 15 },
  freePush: { min: 0, max: 8 },
  regrab: { min: 0, max: 3 },
  ease: { min: 0, max: 1 },
  wallStart: { min: 0, max: 2 },
  'wallSpeed.up': { min: 0.1, max: 4 },
  'wallSpeed.down': { min: 0.1, max: 4 },
  'wallSpeed.side': { min: 0.1, max: 4 },
  'wallStamina.climb': { min: 0, max: 50 },
  'wallStamina.still': { min: 0, max: 50 },
  'brace.tight': { min: 0.7, max: 3 },
  'brace.spaceReach': { min: 0.3, max: 3 },
  'brace.ease': { min: 0, max: 1 },
  'brace.reach': { min: 0.3, max: 1.2 },
  'brace.press': { min: 0, max: 1 },
  'brace.moving': { min: 0, max: 3 },
  'brace.height': { min: 0.8, max: 1.7 },
};

/** The table's choices, by their path, and the words each takes. */
export const CLIMB_CHOICES: Readonly<Record<string, readonly string[]>> = {
  ledges: ['on', 'before'],
  wall: ['on', 'before'],
  'brace.rule': ['on', 'before'],
  'brace.people': ['on', 'off'],
};

/**
 * Set numbers of the table from a nested object (`{ grabFall: 10, stamina: { hang: 2 } }`), each held to its range, and
 * its choices to their words (`{ ledges: 'before' }`). Answers words for anything held, refused or not known; nothing
 * is saved. A table another maker adds to (a group of its own beside these) is set the same way: its numbers' ranges and
 * its choices' words go in `CLIMB_RANGES` and `CLIMB_CHOICES` by their dotted paths.
 */
export function tuneClimb(patch: unknown): string[] {
  const words: string[] = [];
  if (!patch || typeof patch !== 'object') return ['tune takes an object: { grabFall: 10, stamina: { hang: 2 } }'];
  const walk = (table: Record<string, unknown>, values: Record<string, unknown>, path: string): void => {
    for (const [key, raw] of Object.entries(values)) {
      const at = path ? `${path}.${key}` : key;
      if (!Object.prototype.hasOwnProperty.call(table, key)) {
        words.push(`no ${at}`);
        continue;
      }
      const choices = CLIMB_CHOICES[at];
      if (choices) {
        if (typeof raw !== 'string' || !choices.includes(raw)) words.push(`${at} takes ${choices.map((w) => `'${w}'`).join(' or ')}`);
        else table[key] = raw;
        continue;
      }
      const now = table[key];
      if (now && typeof now === 'object') {
        if (!raw || typeof raw !== 'object') words.push(`${at} takes an object of its numbers`);
        else walk(now as Record<string, unknown>, raw as Record<string, unknown>, at);
        continue;
      }
      const range = CLIMB_RANGES[at];
      if (!range) {
        words.push(`no ${at}`);
        continue;
      }
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        words.push(`${at} takes a number`);
        continue;
      }
      const v = Math.min(range.max, Math.max(range.min, raw));
      if (v !== raw) words.push(`${at} held to ${v} (${range.min} to ${range.max})`);
      table[key] = v;
    }
  };
  walk(CLIMB_TUNE as unknown as Record<string, unknown>, patch as Record<string, unknown>, '');
  return words;
}

/** Everything back as the game shipped it. */
export function resetClimbTune(): void {
  const put = (to: Record<string, unknown>, from: Record<string, unknown>): void => {
    for (const [k, v] of Object.entries(from)) {
      if (v && typeof v === 'object') put(to[k] as Record<string, unknown>, v as Record<string, unknown>);
      else to[k] = v;
    }
  };
  put(CLIMB_TUNE as unknown as Record<string, unknown>, CLIMB_TUNE_SHIPPED as unknown as Record<string, unknown>);
}

/**
 * What a hang mutes for the frame, by action, before anything reads a key (the frame loop's and `__debug.advance`'s
 * `stepLedgeKeys`): the fight, the postures, the saber's switch and the use key, none of which a body hanging by its hands
 * can do. Left alone: the moves, the jump and the crouch (the hang's own keys), the grapple's fire (its refusal says so in
 * words), the panels and the camera.
 */
export const LEDGE_MUTES: readonly string[] = [
  'attack', 'altAttack', 'altFire', 'block', 'saberThrow', 'saberStyle', 'saberToggle',
  'slot1', 'slot2', 'slot3', 'slot4', 'slot5', 'slot6', 'prone', 'kneel', 'mount',
  // The emotes (their wheel and the four arrows) and the class switch: a body hanging by its hands plays no emote over the
  // hang's pose and changes no kit (the fix round's; `App.playEmote` refuses a climb as well, for the band's and the console's).
  'emoteWheel', 'emote1', 'emote2', 'emote3', 'emote4', 'switchClass',
];
