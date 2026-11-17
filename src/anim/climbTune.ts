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
  /**
   * Climbing II, phase 2, item 1 (the owner's: "pressing or holding E/Use will actively try to grab the closest ledge if
   * it's close enough, and will also activate wall grabbing for climbing up/down walls so walking up to a wall doesn't make
   * you climb it automatically"). 'use': a lip is grabbed and a wall climb started only while the use key, handed to the
   * climb by the game's one use-key dispatch (`climbTakesUse`), is held: the first lip in the hands' reach (on the ground as
   * well as in the air), else a climbable face ahead within the start's reach, at once; walking into a wall or falling past
   * a lip does neither. 'auto': today's (a lip grabbed in the air by moving at it, a wall started by W pressed into it for
   * `wallStart`).
   */
  grab: 'use' | 'auto';
  /** Item 2: 'hop' W at a ledge hops up to a lip above (searched as `hops` says) where there is one, else climbs onto the top; 'before' W climbs onto the top. */
  wUp: 'hop' | 'before';
  /**
   * Item 3: 'jump' Space with nothing to hop to jumps a little up and off the wall (`offUp`, `offPush`), so a press always
   * does something; a lip to hop to is hopped to as ever. 'before': today's (Space alone climbs up, Space with a way to
   * nowhere says so and stays).
   */
  spaceOff: 'jump' | 'before';
  /**
   * Item 4: 'band' a hop's target is searched in the asked way with a tolerance either side and up and down: sideways out
   * to `hopSide` from the held lip's end, `hopUp` above to `hopDown` below, its face up to `hopDepth` in front of or behind
   * the held one's; up and down (W, S with Space) to `hopUp` and `hopDown`, `hopSlack` either side; the nearest good lip
   * taken, near and far alike, its way there arced by `hopArc`. 'before': today's look (sideways along the held face's
   * line, `hopSide` from the body; up straight over it).
   */
  hops: 'band' | 'before';
  /** Item 5: 'hands' a step up or down along a lip of at most `stepMax` is crossed hand by hand; 'before' a step is the lip's end (or a corner round its side). */
  steps: 'hands' | 'before';
  /**
   * The small jump off the wall (item 3), as a small jump from the ground: how high it rises, metres (ours: half a plain
   * jump's 0.8 m apex), and how hard it pushes off the face, m/s (the free hang's own push back, `freePush`'s start).
   */
  offUp: number;
  offPush: number;
  /** How far down a hop reaches for a lower lip, metres (item 4; ours: `hopUp`'s start, so up and down reach alike). */
  hopDown: number;
  /** How far to either side of straight up or down a hop up or down may land, metres (item 4; ours: about the hands' span and a hand more). */
  hopSlack: number;
  /** How far in front of or behind the held face a hop's target face may stand, metres (item 4; ours: a stepped wall's setback, 0.3, with room). */
  hopDepth: number;
  /** How far a hop's way rises at its middle, a share of its length (item 4; ours: a 3 m hop rises 0.3 m, so it reads as a leap). */
  hopArc: number;
  /** The tallest step up or down along a lip the hands cross (item 5; the owner's 0.5 m). */
  stepMax: number;
  /**
   * How far ahead of the body's middle the use key reaches for a lip (item 1, under 'use'; never less than `reachAhead`),
   * metres. Ours: as far as the wall climb's start feels for a face (0.8 upright, 0.93 at the climb limit) and a little more,
   * so a lip over a wall in reach is grabbed rather than climbed up to.
   */
  useReach: number;
  /**
   * Climbing II, item 6 (maker B): 'shimmy' A or D alone on a wall plays the braced hang's shimmy clips (left and right), at
   * the rate that keeps their hands where they are at the sideways speed; 'before' the up clip slowed to the sideways share.
   */
  wallSide: 'shimmy' | 'before';
  /**
   * Item 6: 'held' every hand and foot the clip plants on the face is held where it was planted (its hold, in the world) until
   * that limb's next reach, and only one limb reaches at a time (one lifted while another is still reaching stays held until
   * that one is planted again); a limb whose hold the body has moved `holdMost` from where its clip has it reaches anyway.
   * 'before' each limb is put on the face where the clip has it, frame by frame.
   */
  wallLimbs: 'held' | 'before';
  /**
   * Item 7: 'reach' braced and still, the view turned more than `lookStart` from the wall turns the spine toward it by
   * `lookTwist`; the leading hand (the side looked to) leaves the lip into a reach-back pose held from its hop clip's start
   * (`lookPose` seconds in), reaching `lookArm` of the way toward the view, the trailing hand staying; Space then hops to a lip
   * behind in the view's way (out to `hopBehind`, the band's slack and reach up and down), else the small jump off. 'before':
   * the hang holds the view free.
   */
  lookAway: 'reach' | 'before';
  /**
   * The faults phase 1 found (CLIMB1-notes), each mended behind its own switch. 'ramp': every corner along a lip turns the
   * hands' faces over the same span either side of it (`CORNER_RAMP`), found to under a millimetre, so the body's heading at a
   * place on a corner's lip is the place's and never the rail's history (the extra turn at a lip's end differed by frame
   * rate); 'before' as the rail's sampling put it.
   */
  corners: 'ramp' | 'before';
  /** 'hang': a top shallower than `topMin` behind its lip is no top to stand on (the climb up is refused in words and the body hangs, a wall climb's hang included); 'before': a top the crouched capsule fits on is climbed onto however thin. */
  thinTop: 'hang' | 'before';
  /** 'inclusive': a lip exactly as steep as `lipSlope` is shimmied along (a millimetre over a rail step for the rays' own rounding); 'before': refused at its foot. */
  slopeLimit: 'inclusive' | 'before';
  /** 'swept': a lip is grabbed where the hands' reach band passed it at any point of the frame's rise or fall, not only where the frame ended (the same grab at any frame rate); 'before': where the frame ended. */
  grabSweep: 'swept' | 'before';
  /** Item 6: how far a held limb may stand from where its clip has it before it reaches anyway, metres (ours: a forearm, 0.3). */
  holdMost: number;
  /** Item 7: how far the view turns from the wall before the look-away begins, degrees (ours: 100, a little past square to the wall, so a glance along it never lets go). */
  lookStart: number;
  /** Item 7: the most the spine turns toward the view, degrees (ours: 40, where a body hanging by one hand still has its hips to the wall; the rig's own clamp is 69). */
  lookTwist: number;
  /** Item 7: how far into the leading side's hop clip the reach-back pose is held, seconds (the clips' coil: the hips risen, the arms bent, the hands still on the lip; they leave at 0.35 to 0.45). */
  lookPose: number;
  /** Item 7: how much of the way the leading hand reaches toward the view (ours: 0.6; nought leaves it where the held pose has it). */
  lookArm: number;
  /** Item 7: how far behind a hop reaches, metres (ours: 3, twice the side hop's start, a leap with the whole body behind it). */
  hopBehind: number;
  /** The least depth behind a lip a top must have to be stood on (`thinTop`), metres (ours: 0.35, the body's own capsule radius). */
  topMin: number;
}

/**
 * Climbing II, phase 2: every switch the phase adds, at its 'before' setting (what each switch's other word is: today's
 * climbing, `1e7f577`). The course's digest of today (`climbToday.test.ts`) and the wave 4 suites, which test today's rules,
 * set them so; a later maker's switches join this table.
 */
export const CLIMB_TWO_BEFORE: Readonly<Record<string, string>> = {
  grab: 'auto',
  wUp: 'before',
  spaceOff: 'before',
  hops: 'before',
  steps: 'before',
  // Maker B's: items 6 and 7, and the faults phase 1 found.
  wallSide: 'before',
  wallLimbs: 'before',
  lookAway: 'before',
  corners: 'before',
  thinTop: 'before',
  slopeLimit: 'before',
  grabSweep: 'before',
};

/** Every phase 2 switch put to its 'before' setting (today's climbing). */
export function climbTwoBefore(): void {
  const t = CLIMB_TUNE as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(CLIMB_TWO_BEFORE)) t[k] = v;
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
  grab: 'use',
  wUp: 'hop',
  spaceOff: 'jump',
  hops: 'band',
  steps: 'hands',
  offUp: 0.4,
  offPush: 1.5,
  hopDown: 1.5,
  hopSlack: 0.75,
  hopDepth: 0.5,
  hopArc: 0.1,
  stepMax: 0.5,
  useReach: 0.95,
  wallSide: 'shimmy',
  wallLimbs: 'held',
  lookAway: 'reach',
  corners: 'ramp',
  thinTop: 'hang',
  slopeLimit: 'inclusive',
  grabSweep: 'swept',
  holdMost: 0.3,
  lookStart: 100,
  lookTwist: 40,
  lookPose: 0.3,
  lookArm: 0.6,
  hopBehind: 3,
  topMin: 0.35,
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
  offUp: { min: 0, max: 2 },
  offPush: { min: 0, max: 6 },
  hopDown: { min: 0, max: 8 },
  hopSlack: { min: 0, max: 3 },
  hopDepth: { min: 0, max: 2 },
  hopArc: { min: 0, max: 0.5 },
  stepMax: { min: 0, max: 1 },
  useReach: { min: 0.3, max: 2 },
  holdMost: { min: 0.05, max: 1 },
  lookStart: { min: 0, max: 180 },
  lookTwist: { min: 0, max: 69 },
  lookPose: { min: 0, max: 1.4 },
  lookArm: { min: 0, max: 1 },
  hopBehind: { min: 0, max: 8 },
  topMin: { min: 0, max: 1 },
};

/** The table's choices, by their path, and the words each takes. */
export const CLIMB_CHOICES: Readonly<Record<string, readonly string[]>> = {
  ledges: ['on', 'before'],
  wall: ['on', 'before'],
  'brace.rule': ['on', 'before'],
  'brace.people': ['on', 'off'],
  grab: ['use', 'auto'],
  wUp: ['hop', 'before'],
  spaceOff: ['jump', 'before'],
  hops: ['band', 'before'],
  steps: ['hands', 'before'],
  wallSide: ['shimmy', 'before'],
  wallLimbs: ['held', 'before'],
  lookAway: ['reach', 'before'],
  corners: ['ramp', 'before'],
  thinTop: ['hang', 'before'],
  slopeLimit: ['inclusive', 'before'],
  grabSweep: ['swept', 'before'],
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
