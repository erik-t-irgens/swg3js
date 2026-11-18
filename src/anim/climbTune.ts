// Every number of feel the climbing has (wave 4 of the animations: ledges, and maker B's wall climbing and the hands'
// bracing beside them), in one table. The owner decides these by hand: each is live through
// `__debug.climb({ tune: { ... } })` and a slider in the debug menu when `climb` is picked (`climbDials.ts`), and
// nothing here was chosen by measuring. A start is the brief's own number where it gave one, the human male's measured
// clip where the clip decides (src/anim/ledgeClips.ts holds those measurements), and otherwise the plainest thing that
// could be said for it, with the reason beside it.
//
// Pure: no three.js and nothing of the page, so the node tests move it as the console does.
import { moveBefore, moveSmoothBefore, moveSmooth2Before, moveSmooth3Before } from './moveTune.ts';

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
  /**
   * Climbing II, the feedback round, item 1 (the owner, after playing: "The grab holds you too long"): 'share' a grab (the
   * jump's, E's from the ground, the grapple haul's hand-over) still starts its clip, but from `grabFreeAt` of its length on
   * the hang takes the keys: a shimmy, W, a hop, Space, the crouch's let-go and the look-away begin there, the body put on the
   * hang place and the grab blended into what was asked over the move's own blend (`ease`); a press made earlier in the grab
   * is kept until then. Nothing asked, the grab plays out as ever. 'whole': today's (the whole grab before any key).
   */
  grabFree: 'share' | 'whole';
  /** Item 1: the share of a grab's length after which the hang takes the keys (the round's start, 0.35: the hands are on the lip by then in the braced and free grabs). */
  grabFreeAt: number;
  /**
   * Item 2: 'why' a climb up refused says which test failed (the top's room for a crouched body at a depth in from the lip,
   * or the climb's own way out, up and in) and what it met (a placed thing's template, the course's solid, the ground, a
   * planting, a building's shell or room) and how far into it, on the message line, and in full on
   * `__debug.climb({ room: true })`. 'before': today's words ("No room to climb up here.").
   */
  roomSay: 'why' | 'before';
  /**
   * Item 2 (the owner's idea): 'fit' where today's climb up does not fit, a shorter one is tried before it is refused: its
   * end nearer the lip (down to half the capsule's radius in), the body tucked crouched where standing would meet something
   * on the way up (it stays crouched on the top until there is room, as after every climb), a lower way in over the lip (the
   * lift over it down to `liftLeast`), and all of them again with a brush of `roomBrush` allowed; a climb ending nearer or
   * tucked has its clip cut where its figure crouches on the top, the rest blended out. 'strict': today's (refused where the
   * whole climb does not fit).
   */
  roomRule: 'fit' | 'strict';
  /** Item 2: how far the body may brush what stands still on a short climb, metres (the round's start, 0.04: under a hand's thickness). */
  roomBrush: number;
  /** Item 2: the least lift over the lip a lower way in is tried down to, metres (ours: nought, the climb's own skin of 0.02 still under the feet; today's lift is 0.05). */
  liftLeast: number;
  /**
   * Climbing II, the smoothness round, item 1 (the owner: "I can't grab any of the ledges in the chimney section you made or
   * any ledges that are that shallow but I should be able to"): 'grab' a lip is the top edge of a face whose top runs back at
   * least `shelfMin` before anything rises behind it, with `handRoom` clear over it at the hands, whatever stands over or
   * behind it beyond that (a ladder's rung, a shelf with its next tier behind it, a window sill): the grab looks up a column
   * of the face for every such edge in its reach band and takes the one nearest the hands' own height, and a hop's probe
   * looks down a column through every top it passes and takes the one nearest the height it asks about. 'before': phase 2's
   * (a lip with anything over its band's head is no lip; a hop's probe takes the topmost top in its column).
   */
  shelves: 'grab' | 'before';
  /** Item 1: how far a top must run back from its edge before anything rises behind it, metres (the round's start, 0.12: the fingers' and a knuckle's depth). */
  shelfMin: number;
  /** Item 1: how much room over a top at the hands it must have, metres (the round's start, 0.15: a hand's thickness curled over it, and a little). */
  handRoom: number;
  /**
   * The smoothness round, items 2 and 3 (the owner's control design of 2026-11-17): 'cue' one grammar while hanging: a way
   * is asked by holding a key (W where the view looks: up at the wall, a side past `wayTurn`, behind past `lookStart`; A or D
   * their own side; S down), a hold in that way at a ladder-like distance (`ladderMin` to `ladderMax`) is climbed to by the
   * key alone, a lip further within the hop band is shown by the body (a pull-up, a lean, the reach back, the drop's hand
   * lowered) only while the key is held, and Space commits to what is shown; with nothing shown Space jumps a little off
   * (S with it, phase 2's down else off backward); W with nothing up climbs onto the top; a tap of the crouch key drops to
   * the lip beneath (within `dropMost`), held past `dropHold` it lets go fully. Nothing of it goes on the action bar.
   * 'before': phase 2's keys as they shipped.
   */
  hangKeys: 'cue' | 'before';
  /** Item 2: how far the view turns from the wall before W means that side, degrees (ours: 45, half way to square: looking along the wall is a side, looking at it is up). */
  wayTurn: number;
  /** Item 2: a hold in the asked way at least this far from the held one is ladder-like (climbed by the key alone), metres (the round's start, 0.3: nearer is the same hold). */
  ladderMin: number;
  /** Item 2: and no further than this, metres (the round's start, 1.1: the course's 0.75 and 1 m ladders are ladder-like, 1.25 m and over are hops). */
  ladderMax: number;
  /** Item 2: how far in front of or behind the held face a lip above or below may stand for W, S and the crouch's drop, metres (ours: 0.8, the owner's shelves step 0.6 back, and a hand more). */
  wayDepth: number;
  /** Item 2: how far into the hop clip's coil a cued hop's pose is held, a share of the coil (the hands leave the lip about 0.35 s in; ours: half of it, a slight pull-up readying the jump). */
  cueShare: number;
  /** Item 2: how long a cue eases in and out, seconds (ours: 0.2, the hang's own ease and a little more, so a cue never snaps). */
  cueEase: number;
  /** Item 2: how far a side's cue leans the hanging body that way, degrees (ours: 8, a slight lean: the weight shifted toward the hop, a shimmy still playing under it). */
  cueLean: number;
  /** Item 3: how far below the hang the crouch's drop reaches for a lip beneath, metres (the round's start, 2.5). */
  dropMost: number;
  /** Item 3: the crouch held past this lets go fully (and is no drop to the lip beneath), seconds (the round's start, 0.25: a tap is quicker). */
  dropHold: number;
  /**
   * The smoothness round, item 6 (found driving the extra rows: at a zigzag's top rung S with D took the wall's own top edge
   * level with the hands, 0.3 m back, over the rung 1 m down the owner asked for): 'below' a side's diagonal asked with W takes
   * only a lip over the held one, and asked with S only one under it, by at least the quarter metre the band up or down keeps
   * (a lip level with the hands is A's or D's alone); 'before' phase 2's band, 0.3 m either way of the hands' height.
   */
  diagonals: 'below' | 'before';
  /**
   * Climbing II, Smoothness II, item 1 (the owner: "our body will be in position in time for the animation's hand-touch to the
   * ledge ... with a natural slow-down near the top as if gravity is slowing me down"): 'timed' a hop, a grab and a step down
   * carry the body only between their clip's own moments (src/anim/handTimes.ts: the owner's where he gave them, else the
   * clip's measure): still on the held lip (or the ground) until the hands leave it, then through the air on a thrown body's
   * arc (constant acceleration: a quadratic way at an even pace, lifted `flightLift` of its length, an up hop slowing to its
   * top), on the new lip exactly as the clip's hands touch it, and still after; the clip's airborne stretch played at a rate
   * fitted to the way (`flightRateMin` to `flightRateMax`), the figure drawn with the clip's own travel put back so its hands
   * stay on a lip while the body is still. A let-go drop's clip is played by the owner's drops' rule (`dropRateLeast`).
   * 'before': the smoothness round's (the body carried over the whole clip).
   *
   * Climbing II, Smoothness III, item 1 (the owner: "the hopping timing for free hanging left/right is determining how quickly it
   * will take to get to the landing spot, so I'm going incredibly fast through the air ... do a near-correct physics calculation
   * that just knows what arc would be needed to complete that naturally and the correct speed, and hold the animation until
   * contact happens"): 'arc' a hop's flight takes the time the arc gives it, never the clip's: the body placed frame by frame on a
   * thrown body's arc under `flightGravity`, rising `arcRise` over the higher of its two ends (a drop to a lower lip falls from
   * rest), its time the rise's and the fall's; the clip played at its own rate before the hands leave and after they touch, and
   * its airborne stretch fitted to the flight: slowed to `flightRateMin` and then its frames just before the touch held (eased in
   * and out over `holdEase`) for as long as the flight lasts, sped up to `flightRateMax` at most (a flight shorter than that is
   * flown slower, never the clip hurried). Grabs and step downs as 'timed'.
   */
  hopFlight: 'arc' | 'timed' | 'before';
  /** Smoothness III, item 1: the gravity a hop's arc is worked out under, m/s^2 (the game's own on foot, Jedi Academy's 800 units: 20.32). */
  flightGravity: number;
  /** Item 1: how high a hop's arc rises over the higher of its two ends, metres (ours: the brief's own example, a 3 m hop taking about the time a 0.5 m rise and fall does). */
  arcRise: number;
  /** Item 1: how long the clip eases into and out of a held frame while it waits for the hands' contact, seconds (ours: 0.1, about three of the clip's own frames at 30 a second). */
  holdEase: number;
  /**
   * Smoothness III, item 2 (the owner: "the ledge checker doesn't check to see if my body will fit from the ledge to whatever is
   * beneath it. I clipped through the world by accidentally hopping down to one of the test track's base cubes"): 'fit' every
   * lip a grab, a hop, a cued hop, a drop and a step along a lip would take is tested for the body that will hang there: the
   * ground (the terrain's heightfield, which a shape test cannot find a body wholly under) and anything still under the hang,
   * felt for with one ray from over the lip down past the hanging feet in front of its face, and the move's way checked for the
   * ground as well as for solids; a lip whose hang meets the ground is no target (a lip within a body's hang of the ground is
   * stood on or dropped to, never hung from). 'none': Smoothness II's (only what a shape test finds).
   */
  targetRoom: 'fit' | 'none';
  /**
   * Smoothness III, item 4b (Smoothness II's 6b; the owner: "the animation for dropping down to a lower ledge while already on a
   * ledge seems to be repeating the left or right ledge jump animation"): 'drop' a drop to a lower lip (the crouch's tap, a cued
   * drop, S with Space down) plays a move of its own made of two parts of the owner's table (`DROP_PARTS`): the held kind's drop
   * clip from its start through the hands' release and on into the fall, then the catch clip for the lower hang's kind into the
   * hang, crossfaded over `transitionBlend`, the flight between timed by item 1; 'reverse' the hop up played backward (a hop's
   * arc reversed in time is still a fall); 'hop': Smoothness II's (the side hop toward the side it lands).
   */
  dropMove: 'drop' | 'reverse' | 'hop';
  /** Item 4b: each part's start and end, seconds into its clip (the owner's table, `DROP_PARTS`, names the clips). */
  dropParts: {
    bracedFrom: number;
    bracedTo: number;
    freeFrom: number;
    freeTo: number;
    catchBracedFrom: number;
    catchBracedTo: number;
    catchFreeFrom: number;
    catchFreeTo: number;
  };
  /**
   * Smoothness III, item 4 (the owner: "I also can't hop up/down while free hanging"): 'on' a free hang hops up to a lip above
   * past the ladder's range within `hopUp` (W, the cue and Space; W alone within the ladder's range as ever), on a move of its
   * own from the owner's table (`FREE_HOP_PARTS`): the braced hop up's upper body, its arms' reach and pull, over the free
   * hang's own hanging legs (his rule for hands with no wall: "use the animation's upper body, then just have the feet hang and
   * legs sway"), timed by item 1's arc; and drops down as a braced hang does, by item 4b's drop move. 'off': Smoothness II's (a
   * free hang hops up to nothing past the ladder's range: "a free hang has nothing to brace on to hop up").
   */
  freeHops: 'on' | 'off';
  /** Item 4: the free hop up's part of its clip, seconds (the owner's table, `FREE_HOP_PARTS`, names the clip). */
  freeHopParts: { from: number; to: number };
  /**
   * Smoothness III, item 4b (Smoothness II's 5b; the owner: "ladder climbing uses the wall climbing animation which is good but it
   * has a weird repeating hitch where it's not using the whole animation and hands don't take turns grabbing the next rung or
   * grip"): 'cycle' a ladder's climb plays the wall clip's whole cycle laid over two rungs, one hand reaching per rung in turn,
   * its phase driven by how far the body has climbed and never restarted per rung (held where it stands between two rungs while
   * the key is held), the clip's rate held within `ladderStretch` of its own (the body's pace from rung to rung follows from
   * it, so a near or far rung stretches the reach rather than snapping the clip); each reaching hand eased from where the clip
   * carries it onto its rung over the reach and held there while the other reaches. 'rung': Smoothness II's (the clip from its
   * start at every rung).
   */
  ladderCycle: 'cycle' | 'rung';
  /** Item 4b: how far a ladder's clip may be played off its own rate, a share either way (the brief's start, 0.2: ±20%). */
  ladderStretch: number;
  /** Item 4b: how far a free ladder's reaching hand is led out round the rungs' front at its reach's middle, metres (ours: 0.2). */
  ladderArc: number;
  /** Item 4b: how much of the way a reaching hand is led rather than carried by the clip at its reach's middle, a share (ours: 0.5). */
  ladderLead: number;
  /** Item 1: the slowest and quickest a clip's airborne stretch is played, of its own rate (ours: 0.7 and 1.5: slower is slow motion, quicker a snap). */
  flightRateMin: number;
  flightRateMax: number;
  /** Item 1: how high a hop's way rises over the straight way at its middle, a share of its length (ours: the band's own 0.1, a 3 m hop rising 0.3 m). */
  flightLift: number;
  /** Item 1: how much of a grab's clip before its touch frame is played as the reach, when the grab is caught in the air, seconds (ours: 0.2, about the owner's grabs' own reach before their touch). */
  grabLead: number;
  /** Item 1, the owner's drops' rule: the slowest a drop's stretch between the hands' release and the feet's touch is played, of its own rate (ours: 0.35); a longer fall holds the stretch's last frame until the feet meet the ground. */
  dropRateLeast: number;
  /**
   * Item 2 (the owner: "there's a freeze then a jump in the animation before going to the idle"): 'blend' every one-off into or
   * out of a hang or a wall climb crossfades straight into what follows, `transitionBlend` before its own end, the loop that
   * follows started at the phase whose pose is nearest the one-off's last; never through the clip that played before it.
   * 'before': the smoothness round's (the one-off's last frame held, then faded through the clip before it).
   */
  transitions: 'blend' | 'before';
  /** Item 2: how long a transition's crossfade is, seconds (ours: 0.25, a little more than the hang's own ease, so the loop is well under way as the one-off ends). */
  transitionBlend: number;
  /** Item 2's measure (`climb({ transitions: true })` and the tests): a bone faster than this many times the faster clip's own fastest is a jump (ours: 2). */
  poseJump: number;
  /**
   * Item 7 (the owner: "my camera can snap around and jump quickly in some movements while climbing or shimmying around
   * corners"): 'eased' while hanging, shimmying, hopping, climbing a wall or topping out, the camera follows the body through a
   * critically damped follow of `camEase`, and a pull-in at a wall is let out again eased; 'before' the body's own place.
   */
  camera: 'eased' | 'before';
  /** Item 7: how quickly the camera's follow catches the body, seconds (ours: 0.12, the follow settling in about a third of a second, never snapping). */
  camEase: number;
  /** Item 7: how long the camera, pulled in at once by a wall while climbing, takes to go back out, seconds (the race view's own 0.5). */
  camOut: number;
  /** Item 7's measure: a frame's change of the camera's place more than this many times the eased follow's own is a snap (ours: 3). */
  camJump: number;
  /**
   * Item 8 (the owner: "when grabbing a ledge that is already at an incline or decline, my hands should grab appropriately"):
   * 'each' each hand's target is the lip at that hand's own place along it from the grab's touch frame on, and where the lower
   * hand cannot reach its point the body hangs lower; 'before' the grab's hands on the line through the lip's middle.
   */
  slopeHands: 'each' | 'before';
  /**
   * Item 3 (the owner: "when shimmying takes me around a corner, even a sharp corner, my body tends to phase through the wall
   * ... using the mesh as either a collider or a guide"): 'spheres' the posed figure's sixteen spheres (src/player/bodySpheres.ts,
   * measured off the rest mesh at load) are asked of what stands still every frame it hangs, shimmies, hops, climbs a wall or
   * ducks, and the figure is pushed out of what they are in along its own face (a hand or a foot planted on its lip or face
   * allowed its contact); 'before' the smoothness round's (nothing asked).
   */
  bodyClear: 'spheres' | 'before';
  /** Item 3: how quickly the push eases back in once the need for it falls away, seconds (ours, 0.08: a few frames, so a corner rounded is let go of smoothly; it goes out at once). */
  clearEase: number;
  /** Item 3: the furthest the figure is pushed out, metres (ours, 0.3: about a forearm, past which the hands would leave the lip; a body deeper than that is the hang's own place at fault). */
  clearMost: number;
  /**
   * Item 5 (the owner: "when I reach the top, my hand in the animation sometimes can reach above the topmost ledge and grab air
   * ... dynamically grab lower or deeper in to make it grab actual wall"): 'grip' a wall climb's hand whose hold stands in air
   * (over the top, past a side, over a hole) is moved to the nearest real grip, down the face under the top or in over the top
   * onto its edge; 'before' the smoothness round's (a hand with no face under it left as the clip has it).
   */
  wallHands: 'grip' | 'before';
  /** Item 5: how far a hand in the air may be moved to find a grip, metres (ours, 0.9: a whole arm's reach and a hand, so a climb clip's hand stretched high over a wall's top still finds the lip under it, and no further). */
  gripSeek: number;
  /**
   * Item 6 (the owner: "the animation for jumping off the wall is slow and annoying ... use the JKA animation for wall grabbing
   * ... it's shorter and pushes me back further"): 'jka' Space off a wall climb, and S with Space off a braced hang where no hop
   * is cued, play Jedi Academy's BOTH_FORCEWALLREBOUND_BACK and push the body back off the face at Jedi Academy's own wall
   * rebound (src/player/jkaMove.ts's `JKA.jumpOffWallSpeed` back and `JKA.wallJumpStrength` up), facing the wall as it flies; 'before'
   * the smoothness round's jump off (`jump_from_wall`, turned round at its end).
   */
  pushOff: 'jka' | 'before';
  /** Item 6: the push back off the face, a share of Jedi Academy's own (ours, 1: Jedi Academy's 5.08 m/s). */
  pushBack: number;
  /** Item 6: the lift with it, a share of Jedi Academy's own (ours, 1: Jedi Academy's 8.53 m/s). */
  pushUp: number;
  /**
   * Climbing II, phase 3 (the owner's "a pole for swinging - swinging between perpendicular poles across a chasm like tomb
   * raider"): 'on' a still collider that is long, level and thin (`barThin`, `barLength`) with room under it for a hanging body
   * is a bar (src/player/barShape.ts), never a lip (the ledges' rays pass it), grabbed with E (src/player/barSwing.ts) and swung
   * on as a pendulum; 'off' phase 3's before, where a bar is whatever the ledge search makes of a thin box (the course's bars
   * caught free as a lip).
   */
  bars: 'on' | 'off';
  /** Phase 3: a bar's cross-section is under this, metres (the brief's start, 0.12: a hand's grip round it; the course's bars are 0.07 and its free beams, 0.2 by 0.3, stay lips). */
  barThin: number;
  /** Phase 3: and its length at least this, metres (the brief's start, 0.8: room for both hands and a shift along it; the course's bars are 4). */
  barLength: number;
  /** Phase 3: the swing is a pendulum under this gravity, m/s² (ours, 20.32: the game's own on foot, Jedi Academy's 800 units, as a hop's arc is). */
  swingGravity: number;
  /** Phase 3: W or S held at the swing's own phase pushes it on by this, rad/s² (ours, 4: W alone pumps a still hang to the largest swing in about four swings against the damping, W and S in turn in about two). */
  swingPump: number;
  /** Phase 3: the swing dies away by this, a second (ours, 0.35: let go of the keys, a swing halves in about four seconds and comes to a still hang). */
  swingDamp: number;
  /** Phase 3: the largest swing the keys pump to, degrees either side of straight down (ours, 70: short of the clip's own front, 84, so the pose has room past it). */
  swingMost: number;
  /** Phase 3: how much of the body's speed at the grab is carried into the swing (ours, 1: all of it, held to the largest swing). */
  swingCarry: number;
  /** Phase 3: A and D move the hands along the bar at this, m/s (ours, 0.6: a slow hand over hand, about the free shimmy's own 0.39 m in 1.4 s and a little more). */
  barShimmy: number;
  /** Phase 3: a grab from the ground or a standing jump or a fall carries the body onto the bar over this, seconds (ours, 0.25: the ledges' own grab's eases and a little more); a running jump's is the clip's own reach, 0.13. */
  barGrab: number;
  /**
   * Climbing II, phase 3 (maker B): 'fly' Space off a bar flies on the swing's own velocity and a little more (`barBoost`) in
   * `run_and_swing`'s flight, held by the bar on the physics' own steps: a bar within the band ahead of the hands along the
   * flight (`catchReach`, `catchSlack`) is caught into the clip's reach with the flight's speed carried into the new swing,
   * else the clip's landing where the feet meet ground or the falling clips where they do not; 'plain' maker A's let-go, the
   * swing's velocity handed to the movement with no boost, no catch and the falling clips.
   */
  barFlight: 'fly' | 'plain';
  /** Phase 3: Space off a bar adds this along the swing's own way, m/s (ours, 1: a let-go on the forward swing then reaches a bar 2 or 3 m on; 2.5 reaches 4 m, 4 reaches 5). */
  barBoost: number;
  /** Phase 3: in the flight a bar is caught this far ahead of the hands along the flight's way, metres (ours, 0.6: about what the flight covers in the clip's own 0.13 s reach). */
  catchReach: number;
  /** Phase 3: and within this of the hands above, below and to either side, metres (ours, 0.35: a hand's span and a little, as the hops' band is forgiving). */
  catchSlack: number;
  /** Phase 3: a blow of at least this much health knocks the body off the bar, straight down (ours, 25: a quarter of a whole health bar; the ledges have no such rule). */
  barKnock: number;
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

/**
 * Every phase 2 switch put to its 'before' setting (today's climbing). Phase 1's climbing also had none of the feedback
 * round's (`CLIMB_FEEDBACK_BEFORE`), so those are put to theirs too: the wave 4 suites and `climbToday.test.ts`, which hold
 * phase 1's rules, ask this one call.
 */
export function climbTwoBefore(): void {
  const t = CLIMB_TUNE as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(CLIMB_TWO_BEFORE)) t[k] = v;
  climbFeedbackBefore();
}

/**
 * Climbing II, the feedback round (after phase 2, the owner's notes from playing): every switch it adds to the climbing, at
 * its other setting (the climbing as `12ae8ad` shipped it). `climbAfter.test.ts` holds phase 2's course with these so.
 */
export const CLIMB_FEEDBACK_BEFORE: Readonly<Record<string, string>> = {
  grabFree: 'whole',
  roomSay: 'before',
  roomRule: 'strict',
};

/**
 * The feedback round's switches at their other setting (`12ae8ad`'s climbing and body): the climbing's (`CLIMB_FEEDBACK_BEFORE`)
 * and the body's shape on foot (items 3 and 4, `MOVE_BEFORE` in `moveTune.ts`: prone the crouch's upright capsule, no duck).
 */
export function climbFeedbackBefore(): void {
  const t = CLIMB_TUNE as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(CLIMB_FEEDBACK_BEFORE)) t[k] = v;
  moveBefore();
  // `12ae8ad` had none of the smoothness round's either.
  climbSmoothBefore();
}

/**
 * Climbing II, the smoothness round: every switch it adds to the climbing, at its other setting (the climbing as `d2d5bc4`
 * shipped it, the feedback round's). A later maker of the round adds its own switches here (the body's beside them in
 * `moveTune.ts`'s `MOVE_SMOOTH_BEFORE`), so one call puts the whole round back.
 */
export const CLIMB_SMOOTH_BEFORE: Readonly<Record<string, string>> = {
  shelves: 'before',
  hangKeys: 'before',
  // Maker B's: item 6.
  diagonals: 'before',
};

/** The smoothness round's switches at their other setting (the feedback round's climbing and body, `d2d5bc4`). */
export function climbSmoothBefore(): void {
  const t = CLIMB_TUNE as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(CLIMB_SMOOTH_BEFORE)) t[k] = v;
  moveSmoothBefore();
  // `d2d5bc4` had none of Smoothness II's either.
  climbSmooth2Before();
}

/**
 * Climbing II, Smoothness II: every switch it adds to the climbing, at its other setting (the climbing as the smoothness
 * round shipped it, `dd88180`). A later maker of the round adds its own here (the body's beside them in `moveTune.ts`), so one
 * call puts the whole round back.
 */
export const CLIMB_SMOOTH2_BEFORE: Readonly<Record<string, string>> = {
  hopFlight: 'before',
  transitions: 'before',
  camera: 'before',
  slopeHands: 'before',
  bodyClear: 'before',
  wallHands: 'before',
  pushOff: 'before',
};

/** Smoothness II's switches at their other setting (the smoothness round's climbing, `dd88180`), the body's (`moveTune.ts`) with them. */
export function climbSmooth2Before(): void {
  // (`dd88180` had none of Smoothness III's either: put back first, so Smoothness II's own words below win where a switch is shared.)
  climbSmooth3Before();
  const t = CLIMB_TUNE as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(CLIMB_SMOOTH2_BEFORE)) t[k] = v;
  moveSmooth2Before();
}

/**
 * Climbing II, Smoothness III: every switch it adds to the climbing, at its other setting (the climbing as Smoothness II shipped
 * it, `c57c0a5`). A later maker of the round adds its own here (the body's beside them in `moveTune.ts`), so one call puts the
 * whole round back. Item 0 (no drop after topping out) is a fault mended with no switch.
 */
export const CLIMB_SMOOTH3_BEFORE: Record<string, string> = {
  hopFlight: 'timed',
  targetRoom: 'none',
  dropMove: 'hop',
  // Maker B's: items 4 and 4b (the free hops; the ladder's whole cycle).
  freeHops: 'off',
  ladderCycle: 'rung',
};

/** A later maker's own puts back (the body's switches, `moveTune.ts`), run after this round's climbing ones. */
export const CLIMB_SMOOTH3_ALSO: (() => void)[] = [];
// Maker B's: items 3 and 3b on the body (`move.proneMin`, `move.duckClip`).
CLIMB_SMOOTH3_ALSO.push(moveSmooth3Before);

/** Smoothness III's switches at their other setting (Smoothness II's climbing, `c57c0a5`). */
export function climbSmooth3Before(): void {
  // (`c57c0a5` had none of phase 3's either: put back first, so Smoothness III's own words below win where a switch is shared.)
  climbBarsBefore();
  const t = CLIMB_TUNE as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(CLIMB_SMOOTH3_BEFORE)) t[k] = v;
  for (const f of CLIMB_SMOOTH3_ALSO) f();
}

/**
 * Climbing II, phase 3 (bars): every switch it adds, at its other setting (the climbing as Smoothness III shipped it, `955fb04`).
 * A later maker of the round adds its own here (`CLIMB_BARS_ALSO` for one beside the climbing's), so one call puts the whole
 * round back; `climbSmooth3Before` calls it first, so every older round's chain of puts back holds.
 */
export const CLIMB_BARS_BEFORE: Record<string, string> = {
  bars: 'off',
  // (Maker B: the flight off a bar, the catch and the landing; 'plain' maker A's let-go, which 'off' never reaches either.)
  barFlight: 'plain',
};

/** A later maker's own puts back (a switch outside the climbing's table), run after the phase's climbing ones. */
export const CLIMB_BARS_ALSO: (() => void)[] = [];

/** Phase 3's switches at their other setting (Smoothness III's climbing, `955fb04`). */
export function climbBarsBefore(): void {
  const t = CLIMB_TUNE as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(CLIMB_BARS_BEFORE)) t[k] = v;
  for (const f of CLIMB_BARS_ALSO) f();
}

/**
 * Item 4b: the owner's table of the parts a drop to a lower lip is made of (`climb.dropMove` 'drop'), by the held hang's kind
 * (the release) and the lower hang's kind (the catch). Each part's seconds are sliders (`climb.dropParts`); its clip a name of
 * the ledge clips the game asks the pack for (src/anim/ledgeClips.ts), so naming another part of another clip is one line here.
 * The release's hands leave at the clip's own moment (src/anim/handTimes.ts: the owner's 0.35 s for `braced_hang_drop`), the
 * catch's touch at its own (his 0.28 s for `jumping_to_hanging`); a free hang's catch is the free grab's (`jump_to_hang`, his
 * 0.26 s, "transitions into free hanging"), since the braced catch ends braced.
 */
export const DROP_PARTS: Readonly<{ braced: string; free: string; catchBraced: string; catchFree: string }> = {
  braced: 'braced_hang_drop',
  free: 'freehang_drop',
  catchBraced: 'jumping_to_hanging',
  catchFree: 'jump_to_hang',
};

/**
 * Smoothness III, item 4 (`climb.freeHops` 'on'): the owner's table of the free hop up, as `DROP_PARTS` is the drop's: the clip
 * whose upper body plays (its seconds the sliders `climb.freeHopParts`), played over the legs of the free hang's own idle (a
 * loop: its legs hang and sway as they do there). Its hands leave and touch at the clip's own moments (src/anim/handTimes.ts:
 * the owner's 0.46 s and 0.78 s for `braced_hang_hop_up`), the flight between them item 1's arc. Naming another clip's arms is
 * one line here.
 */
export const FREE_HOP_PARTS: Readonly<{ upper: string; legs: string }> = {
  upper: 'braced_hang_hop_up',
  legs: 'free_hang_hanging_idle',
};

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
  grabFree: 'share',
  grabFreeAt: 0.35,
  roomSay: 'why',
  roomRule: 'fit',
  roomBrush: 0.04,
  liftLeast: 0,
  shelves: 'grab',
  shelfMin: 0.12,
  handRoom: 0.15,
  hangKeys: 'cue',
  wayTurn: 45,
  ladderMin: 0.3,
  ladderMax: 1.1,
  wayDepth: 0.8,
  cueShare: 0.5,
  cueEase: 0.2,
  cueLean: 8,
  dropMost: 2.5,
  dropHold: 0.25,
  diagonals: 'below',
  hopFlight: 'arc',
  flightGravity: 20.32,
  arcRise: 0.5,
  holdEase: 0.1,
  targetRoom: 'fit',
  dropMove: 'drop',
  // The owner's drops' parts (item 4b): the braced release from its start on a quarter second past its hands' release (his 0.35
  // s), well before its feet would meet its own ground (his 0.81); the free release likewise past its measured release (0.233)
  // and short of its feet's touch (0.533); each catch from its own start ("starts by falling/approaching the ledge") to its end.
  dropParts: { bracedFrom: 0, bracedTo: 0.6, freeFrom: 0, freeTo: 0.45, catchBracedFrom: 0, catchBracedTo: 1.5, catchFreeFrom: 0, catchFreeTo: 2 },
  freeHops: 'on',
  // The free hop up's part (item 4): the braced hop up whole, its arms' coil, reach, pull and catch.
  freeHopParts: { from: 0, to: 1.667 },
  ladderCycle: 'cycle',
  ladderStretch: 0.2,
  ladderArc: 0.2,
  ladderLead: 0.5,
  flightRateMin: 0.7,
  flightRateMax: 1.5,
  flightLift: 0.1,
  grabLead: 0.2,
  dropRateLeast: 0.35,
  transitions: 'blend',
  transitionBlend: 0.25,
  poseJump: 2,
  camera: 'eased',
  camEase: 0.12,
  camOut: 0.5,
  camJump: 3,
  slopeHands: 'each',
  bodyClear: 'spheres',
  clearEase: 0.08,
  clearMost: 0.3,
  wallHands: 'grip',
  gripSeek: 0.9,
  pushOff: 'jka',
  pushBack: 1,
  pushUp: 1,
  bars: 'on',
  barThin: 0.12,
  barLength: 0.8,
  swingGravity: 20.32,
  swingPump: 4,
  swingDamp: 0.35,
  swingMost: 70,
  swingCarry: 1,
  barShimmy: 0.6,
  barGrab: 0.25,
  barFlight: 'fly',
  barBoost: 1,
  catchReach: 0.6,
  catchSlack: 0.35,
  barKnock: 25,
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
  grabFreeAt: { min: 0, max: 1 },
  roomBrush: { min: 0, max: 0.15 },
  liftLeast: { min: 0, max: 0.05 },
  shelfMin: { min: 0.02, max: 1 },
  handRoom: { min: 0.02, max: 0.6 },
  wayTurn: { min: 0, max: 180 },
  ladderMin: { min: 0, max: 3 },
  ladderMax: { min: 0, max: 3 },
  wayDepth: { min: 0, max: 2 },
  cueShare: { min: 0, max: 1 },
  cueEase: { min: 0, max: 1 },
  cueLean: { min: 0, max: 30 },
  dropMost: { min: 0, max: 8 },
  dropHold: { min: 0.05, max: 2 },
  flightRateMin: { min: 0.2, max: 1 },
  flightRateMax: { min: 1, max: 4 },
  flightLift: { min: 0, max: 0.5 },
  grabLead: { min: 0, max: 0.6 },
  dropRateLeast: { min: 0.05, max: 1 },
  transitionBlend: { min: 0, max: 1 },
  poseJump: { min: 1, max: 10 },
  camEase: { min: 0, max: 1 },
  camOut: { min: 0, max: 2 },
  camJump: { min: 1, max: 10 },
  clearEase: { min: 0, max: 1 },
  clearMost: { min: 0, max: 0.8 },
  gripSeek: { min: 0, max: 1.2 },
  pushBack: { min: 0, max: 3 },
  pushUp: { min: 0, max: 3 },
  flightGravity: { min: 1, max: 60 },
  arcRise: { min: 0.05, max: 3 },
  holdEase: { min: 0, max: 0.5 },
  'dropParts.bracedFrom': { min: 0, max: 1.667 },
  'dropParts.bracedTo': { min: 0, max: 1.667 },
  'dropParts.freeFrom': { min: 0, max: 1.333 },
  'dropParts.freeTo': { min: 0, max: 1.333 },
  'dropParts.catchBracedFrom': { min: 0, max: 1.5 },
  'dropParts.catchBracedTo': { min: 0, max: 1.5 },
  'dropParts.catchFreeFrom': { min: 0, max: 2 },
  'dropParts.catchFreeTo': { min: 0, max: 2 },
  'freeHopParts.from': { min: 0, max: 1.667 },
  'freeHopParts.to': { min: 0, max: 1.667 },
  ladderStretch: { min: 0, max: 1 },
  ladderArc: { min: 0, max: 0.6 },
  ladderLead: { min: 0, max: 1 },
  barThin: { min: 0.02, max: 0.4 },
  barLength: { min: 0.2, max: 4 },
  swingGravity: { min: 1, max: 60 },
  swingPump: { min: 0, max: 12 },
  swingDamp: { min: 0, max: 3 },
  swingMost: { min: 5, max: 85 },
  swingCarry: { min: 0, max: 1.5 },
  barShimmy: { min: 0, max: 3 },
  barGrab: { min: 0.02, max: 1 },
  barBoost: { min: 0, max: 6 },
  catchReach: { min: 0, max: 1.5 },
  catchSlack: { min: 0.05, max: 1 },
  barKnock: { min: 0, max: 200 },
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
  grabFree: ['share', 'whole'],
  roomSay: ['why', 'before'],
  roomRule: ['fit', 'strict'],
  shelves: ['grab', 'before'],
  hangKeys: ['cue', 'before'],
  diagonals: ['below', 'before'],
  hopFlight: ['arc', 'timed', 'before'],
  targetRoom: ['fit', 'none'],
  dropMove: ['drop', 'reverse', 'hop'],
  freeHops: ['on', 'off'],
  ladderCycle: ['cycle', 'rung'],
  transitions: ['blend', 'before'],
  camera: ['eased', 'before'],
  slopeHands: ['each', 'before'],
  bodyClear: ['spheres', 'before'],
  wallHands: ['grip', 'before'],
  pushOff: ['jka', 'before'],
  bars: ['on', 'off'],
  barFlight: ['fly', 'plain'],
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
