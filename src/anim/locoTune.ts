// Every number of feel the speed classes have (walking, jogging, running and sprinting on foot, standing), in one
// table. The owner decides these by hand: each is live through `__debug.loco({ tune: { ... } })` and a slider in the
// debug menu when `loco` is picked (`locoDials.ts`), and nothing here was chosen by measuring. A start is the brief's
// own number where it gave one, a clip's own measured speed where the clip decides, and otherwise the plainest thing
// that could be said for it, with the reason beside it.
//
// Pure: no three.js and nothing of the page, so the node tests move it as the console does.

export interface LocoTune {
  /**
   * The speed classes at all. Off, the body moves as it did before them: one run, Shift walks, and it turns the way
   * it runs. `localStorage['swg.loco'] = '0'` starts it off; `__debug.loco({ on })` flips it live.
   */
  on: boolean;
  /**
   * With a blaster up (ready or aimed), a diagonal plays its own jog clip at every class with the body square to the
   * view, where the brief's rule for a walked or run diagonal is the strafe (or the backward clip) with the body turned
   * 45 degrees. A default of ours, on: a body turned 45 degrees cannot also hold a barrel on the crosshair (the spine
   * has not got the turn), and the heading other players are sent would then disagree with the legs. Off is the
   * brief's rule with a blaster up too.
   */
  gunSquare: boolean;
  /**
   * What a fight's key does to a sprint (`SPRINT_ENDERS` in bodyLoco.ts: the attack, the other attack, a gun's other
   * trigger, the saber's throw, the block; never the six ability keys or the jump). 'ends', the owner's word of
   * 2026-11-15 ("maybe sprinting is interrupted if you attack like blocking does"): pressed or held while the class
   * asked is the sprint, it ends the sprint on that very frame and goes through, the body drops to the run (fighting
   * is capped at the run), and only a fresh double tap of Shift sprints again. 'muted' is the rule before it: the attack,
   * the other trigger and the throw do nothing while the body sprints, and a block or an aim caps the pace only while
   * held (let go with Shift still down, the sprint is back at once).
   */
  sprintFight: 'ends' | 'muted';
  /**
   * What walking sideways (the walk class to a side: Alt held, strafing) plays. 'diagonal', the default (the owner's
   * word of 2026-11-15: "use the walking forward + diagonal animation but rotate the body more"): the walked forward
   * diagonal's own clip, the strafe walk (`left_strafe_walking`, `right_strafe_walking`), with the body turned 45 degrees
   * further toward the travel than in the diagonal. That clip's own feet carry it straight sideways (its measured
   * heading is 89.8 degrees), so in the diagonal the body stands turned 45 degrees away from the travel and here it
   * stands square to the view, its legs stepping straight across. 'forward': the forward walk (`standard_walk`) with the
   * body turned the whole 90 degrees toward the travel, the torso taking back its share toward the view. 'strafe': the
   * slow strafe (`walk_strafe_left` / `_right`), as before (62143fe). With a blaster up and `gunSquare` on, 'forward'
   * plays the strafe walk square (a body turned 90 degrees cannot also hold a barrel on the crosshair).
   */
  sideWalkClip: 'diagonal' | 'forward' | 'strafe';
  /**
   * With a gun in hand and out of combat (not ready, not aimed: no shot, no aim), what a pace plays, by the kind of
   * gun. 'full': the imported clip drives the whole body, top and bottom, the gun swinging in the hand with it (the
   * owner's word for pistols: "just let the full animation take over top and bottom"). 'original': the movement the game
   * played with that gun out before the imported paces, the game's own carry walk and run (`loop_pistol_standing:speed1`
   * and `:speed2` for a pistol, `loop_rifle:speed1` and `:speed2` for the rest) on the whole body, the body turned the way
   * it runs as it was then, at the pace's own speed (the owner: "fall back to the original run cycle for carbines").
   * 'split': the imported legs under the gun's standing carry held still on the upper body, as 62143fe had it. In
   * combat nothing of this applies: the ready or aimed pose rides the imported legs as before.
   */
  gunCarry: { pistol: GunCarry; carbine: GunCarry; rifle: GunCarry; heavy: GunCarry };
  /**
   * Crouched (Ctrl held), the speed classes too (wave 2b, the owner's brief's "Crouching"): Alt held the slowest
   * (Sneak Walk (1)), nothing held the middle (Crouched Walking), Shift held the quickest (the game's own crouched walk,
   * `loop_crouched:speed1`); no sprint. Every way but backward plays the class's forward clip with the body turned toward
   * the travel (45 degrees on a diagonal, 90 sideways) and the head on the view; backward at every class is Jedi Academy's
   * `BOTH_CROUCH1WALKBACK` with the body facing the view. 'before' is the crouch of 7424bad: one clip, the game's own
   * crouched walk at its own pace (halved with Alt), the body turned the way it goes.
   */
  crouchRule: 'classes' | 'before';
  /**
   * Prone (Z), the speed classes too: Alt held the game's own crawl (today's), nothing held the low crawl (`low_crawl`),
   * Shift held the running crawl (`running_crawl`); no sprint, and no strafing clips, so the body turns the way it crawls
   * at every class (the owner's words). 'before' is 7424bad's prone: the game's crawl at its own pace.
   */
  proneRule: 'classes' | 'before';
  /**
   * Prone and backing up: 'today' turns the body round to crawl the way it goes, as 7424bad did; 'reverse' (the owner's
   * brief's experiment) keeps the body facing the view and plays the class's forward crawl backwards.
   */
  proneBack: 'today' | 'reverse';
  /**
   * The slope limit (wave 2b, the owner's brief's line 11 and his note of 2026-11-15, `src/player/slopeRule.ts`):
   * 'limit', a face steeper than `slope.climb` is never ground, on terrain and on every model's collider alike, and the
   * body slides down it under gravity. 'before' is 7424bad's: the controller called any face whose normal points up at
   * all ground, so the body stood on a face of any steepness and could jump on up it. Not while the grappling rope is
   * attached or in its fast flight after a let-go (the rope holds the body against a cliff as it always did), nor in the
   * water, riding, flying or in noclip, which never reach the feet's move.
   */
  slopeRule: 'limit' | 'before';
  /**
   * Jumping off a face too steep to stand on: 'refused', the start (the owner's "I can jump up it and land anywhere",
   * which is the fault being mended: a jump from a steep face was how a body went up it); 'allowed' gives the plain
   * jump off it as from the ground, straight up and kept along the face. Jedi Academy's own moves off a wall in the air
   * (a Jedi's rebound, wall run and flip) are the air's and are not this switch's.
   */
  slopeJump: 'refused' | 'allowed';
  slope: {
    /**
     * The climb limit, degrees: a face steeper than this is never ground, and the controller will not walk up it.
     * 55, the controller's own climb angle since the game had one (`Player.makeBody`).
     */
    climb: number;
    /**
     * The share of the world's gravity along the face a body slides with: 1, Jedi Academy's own rule (a plane too steep
     * to walk on is air there, and gravity clipped along it slides the body with no friction, PM_SlideMove); less is a
     * rougher face.
     */
    slide: number;
    /** Seconds the falling loop takes to come in as a slide begins: 0.18, the rig's own fade for any change of clip. */
    fade: number;
  };
  /**
   * Walking hurt (Walking (1), `walking_1`): on its feet, standing, with health under `below` of its pool, the walk class
   * plays the injured walk at `injured.speed` (forward, the forward diagonals and sideways, the body turned toward the
   * travel; backing up keeps its own walk). The jog, the run and the sprint are as ever: no speed cap, which would be a
   * rule of play and not of animation. `rule` 'off' is 7424bad's.
   */
  injured: {
    rule: 'walk' | 'off';
    /** The share of the health pool under which the walk is the injured walk: a quarter, the brief's "below a certain health threshold" made a number. */
    below: number;
    /**
     * What the injured walk moves the body at, m/s (the brief's `speed.injured`, kept in this group so the standing
     * speed table stays the owner's pinned paces): 0.57, the clip's own measured speed (0.573 by the importer; 0.564
     * fitted on the human male), so its feet are locked.
     */
    speed: number;
  };
  /**
   * Crouched speeds, metres a second, by class (`slow` Alt held, `normal` nothing held, `fast` Shift held), forward and
   * to the sides (the forward clip turned), and backing up. Started so ground speed rises with class: `normal` at 1.63,
   * what the body moved crouched at 7424bad on every converted species (the game's crouched walk's written speed,
   * 1.628); `slow` at 0.81, what Alt crouched moved at then (half of it, the game's own walk rule); `fast` at 2.2, the
   * quickest round speed the game's own clip can keep its feet at inside the playback band (1.6 times its measured 1.49
   * is 2.38). Backing up at three quarters of each, as the owner's standing back jog is of his forward jog (3 of 4).
   */
  crouch: {
    forward: { slow: number; normal: number; fast: number };
    back: { slow: number; normal: number; fast: number };
    /** Points a second the pool regains crouched by class: the two slower at the walk's rate (10), the quickest at the jog's (4), the brief's own split. */
    stamina: { slow: number; normal: number; fast: number };
  };
  /**
   * Prone speeds, metres a second, by class (`slow` Alt held, `normal` nothing held, `fast` Shift held; backing up the
   * same, whichever way `proneBack` turns the body): `slow` at 0.66, today's prone crawl (the game's crawl's own written
   * speed, 0.662); `normal` at 0.95, as fast as the low crawl's own feet can keep up inside the playback band's top
   * (0.61 times 1.6 is 0.98) and so quicker than today's; `fast` at 2.15, the running crawl's own speed on the human
   * male (2.187 by the importer, its fitted stride 2.15): feet locked.
   */
  prone: {
    forward: { slow: number; normal: number; fast: number };
    /** As crouched: the two slower at the walk's rate, the quickest at the jog's. */
    stamina: { slow: number; normal: number; fast: number };
  };
  /**
   * The speed the game's own clips' feet were made for on a figure of scale 1, metres a second, where the converter's
   * written number is not the stride: what each is played against for its rate (times the figure's own scale).
   * `crouched` (`loop_crouched:speed1`): 1.49, the importer's own measure (its stances' settled middles) on the human
   * male's converted rig, where the converter wrote 1.628. `crouchBack` (`BOTH_CROUCH1WALKBACK`): 1.39, the median of
   * its planted frames' foot speed (1.386; the converter wrote 1.373), since its feet settle for one span a stride and the
   * settled measure reads 3.71, which is no crouched walk's. `gameWalk` (the game's own walk, the `'game'` gait): 1.44,
   * the importer's measure (1.436), where the converter wrote 1.549. `injuredWalk` (the imported injured walk,
   * `walking_1`): 0.564, its index speed (0.573) fitted to the human male's legs (times 0.984), since the importer
   * marked no foot landing in it and the pack gives it no stride of its own to be played against.
   */
  made: { crouched: number; crouchBack: number; gameWalk: number; injuredWalk: number };
  /**
   * What each class moves the body at, metres a second, by the way it goes. Every start is the owner's own, pinned on
   * 2026-11-15 after he tried the paces ("the speed for sprint fast"), but the backward walks (1.28, the walking
   * backwards clip's own as the paces were made), which he did not name. The clips' playback rates follow the speeds so
   * the feet stay planted (`rate.byClass` at 1), inside `rate.min` to `rate.max`; where a pace's speed asks more of a
   * figure's clip than the band allows (the jog at 4 on a short figure), the clip plays at the band's edge and its feet
   * slide by the rest.
   */
  speed: {
    forward: {
      /** The owner's 1.66 (the forward walk, `standard_walk`). */
      walk: number;
      /** The owner's 4 (`slow_run`): what forward is with nothing held. */
      jog: number;
      /** The owner's 3.5 (`drunk_run_forward`): the jog while tired. */
      tired: number;
      /** The owner's 6 (`running`). */
      run: number;
      /** The owner's 7 (`fast_run`). */
      sprint: number;
    };
    /** Backing up: the walk 1.28 (the backward walk's own, not one he named), the owner's jog 3 and run 4. */
    back: { walk: number; jog: number; run: number };
    /** Sideways: the owner's walk 1.44 (whatever `sideWalkClip` plays), jog 4 and run 6. */
    side: { walk: number; jog: number; run: number };
    /** Forward and to a side: the owner's walk 1.66, jog 4 and run 6. */
    forwardDiag: { walk: number; jog: number; run: number };
    /** Back and to a side: the walk 1.28 (not one he named), the owner's jog 3 and run 4. */
    backDiag: { walk: number; jog: number; run: number };
  };
  /**
   * The band a clip's playback rate is held in while it follows the ground speed (ground speed over the speed the
   * clip's feet were made for). Started at 0.6 to 1.6: wide enough that a class's clip keeps its feet on the ground
   * from a little after it starts until Force Speed's first level, and no wider, since a walk played at three times
   * its rate is no walk. Under Force Speed the top is raised by the speed's own factor.
   */
  rate: {
    min: number;
    max: number;
    /**
     * How fast every clip's feet really go over the ground, as a share of what the pack's index says they do; raised
     * past 1, every clip plays that much slower for the same ground speed. The measure was mended (2026-11-15): the
     * index's speed is now read off each stance's settled middle (the heel and the toe both down and still) against the
     * ground the clip is carried on, never under the swaying hips or from a landing or lifting frame, and the fitted
     * stride is scaled by the legs' own lengths rather than the hips' height, so at 1 a planted foot keeps within 2% of
     * the ground on every clip of the table (the node test holds it). It stays for the eye.
     */
    feet: number;
    /**
     * Each class's clip played as a share of the rate that keeps its planted feet on the ground (the owner's word of
     * 2026-11-15: "make the speed for sprint fast and the animation can slide slightly ... default lock animations to
     * speed"). 1, the start of each, is locked, as before: a pace's speed moved keeps its feet planted. Under 1 the clip
     * plays slower than the body moves and the planted feet slide forward with it; over 1 the other way. Multiplies with
     * `feet` and stays inside `min` to `max`.
     */
    byClass: { walk: number; jog: number; run: number; sprint: number };
  };
  shift: {
    /** How long after Shift is let go the class drops by one, and again by one each such time until the jog, seconds. The brief's "after a moment": half a second. */
    dropDelay: number;
    /**
     * Shift let go and pressed again within this raises the class by one over the class it was let go at, seconds
     * (the run to the sprint). Counted from the let-go and judged against the class held then, so it is its own
     * number whatever the drop's delay is.
     */
    tapWindow: number;
  };
  stamina: {
    /** The pool. 100, as health is. */
    pool: number;
    /** A second of each class forward, points (the brief: sprinting burns, running holds, jogging regains slower, walking at the standard rate). */
    sprint: number;
    run: number;
    jog: number;
    /** Walking forward, and standing: the standard rate. */
    walk: number;
    /** Backward at any class, the walk too: the brief's "normal stamina regen". */
    back: number;
    /** Sideways and the forward diagonals from the jog up: the brief's "does not deplete stamina, but won't allow for stamina regen". */
    side: number;
    /**
     * Sideways and the forward diagonals at the walk: the standard rate. The owner's answer of 2026-11-15, "walking
     * sideways should give stamina back yes" (the brief's "won't allow for stamina regen" holds from the jog up,
     * `side`). Nought is the brief's line read to the letter.
     */
    sideWalk: number;
    /**
     * The most the pool regains a second in the air and in the water (nought: neither gives any back). What a class
     * spends it spends in the air too, so a sprint kept up by hopping costs what the sprint costs.
     */
    air: number;
    /** Emptied, the body is tired until the pool is back to this share of itself (the brief's 30%). */
    tiredUntil: number;
    /** How long the bar stays up after the pool is full again, seconds. */
    linger: number;
  };
  fade: {
    /** Between two of the walking and running clips, seconds, with the feet kept in step. */
    loco: number;
    /** Standing to moving and back, seconds. */
    idle: number;
    /** Into and out of Jedi Academy's own legs (the block, a swing), seconds. */
    jka: number;
  };
  turn: {
    /**
     * How much of a turned body's angle the torso takes back toward the view (the head's look takes what it can of
     * the rest). Half: a diagonal's 45 degrees is then 22 at the spine, which is the turn Jedi Academy's own torso
     * takes over angled legs.
     */
    torso: number;
    /** How fast the body comes round to where a clip wants it, a second (the game's own 14 for a body turning the way it runs). */
    rate: number;
    /**
     * With a blaster up over the classes' legs: how far the spine turns to bring the barrel onto the crosshair before
     * the body's own facing takes the rest, degrees. The game's own gun carries stand side-on and its aimed poses were
     * made over those; an imported clip keeps the hips square, so the same pose needs about twice the turn (66 degrees
     * measured for the rifle, against the 34 the spine takes over the game's own legs). Started at the most the spine
     * is ever given (69), so the body stays square to its legs and they carry it the way it really goes; lower, the
     * body turns for the aim instead and the legs cross their own travel by what it turned.
     */
    aimSpine: number;
  };
  fight: {
    /**
     * Under a block or a swing the legs are Jedi Academy's own, at the class's speed: its saber walk where that speed
     * is under this share of the point at which its walk played fast and its run played slow are equally far from
     * their own rates (the geometric mean of the two clips' own speeds), its run from there up. Started at that point
     * itself, 1: below it the walk's feet can keep to the ground and the run's cannot (the run at the jog's pace would
     * play under the half rate the game holds a clip above). Nought is the run at every class above the walk.
     */
    walkUnder: number;
  };
  peer: {
    /** How long another player's class must have stood before their figure changes clip for it, seconds: a body gathering speed passes through the slower classes' speeds for a few messages. */
    settle: number;
    /**
     * How far past the halfway line between two clips' ways another player's travel must lie before their legs change
     * way, degrees: ground that deflects a body (a slope climbed across, a wall slid along) turns its travel from its
     * heading by a few degrees, which must not flick its legs between two clips. A real change of way is 45 degrees.
     */
    hold: number;
  };
}

/** What a pace plays with a gun in hand out of combat (`LocoTune.gunCarry`). */
export type GunCarry = 'full' | 'original' | 'split';

export const LOCO_TUNE: LocoTune = {
  on: true,
  gunSquare: true,
  sprintFight: 'ends',
  sideWalkClip: 'diagonal',
  gunCarry: { pistol: 'full', carbine: 'original', rifle: 'original', heavy: 'original' },
  crouchRule: 'classes',
  proneRule: 'classes',
  proneBack: 'today',
  slopeRule: 'limit',
  slopeJump: 'refused',
  slope: { climb: 55, slide: 1, fade: 0.18 },
  injured:{ rule: 'walk', below: 0.25, speed: 0.57 },
  crouch: {
    forward: { slow: 0.81, normal: 1.63, fast: 2.2 },
    back: { slow: 0.61, normal: 1.22, fast: 1.65 },
    stamina: { slow: 10, normal: 10, fast: 4 },
  },
  prone: {
    forward: { slow: 0.66, normal: 0.95, fast: 2.15 },
    stamina: { slow: 10, normal: 10, fast: 4 },
  },
  made: { crouched: 1.49, crouchBack: 1.39, gameWalk: 1.44, injuredWalk: 0.564 },
  speed: {
    forward: { walk: 1.66, jog: 4, tired: 3.5, run: 6, sprint: 7 },
    back: { walk: 1.28, jog: 3, run: 4 },
    side: { walk: 1.44, jog: 4, run: 6 },
    forwardDiag: { walk: 1.66, jog: 4, run: 6 },
    backDiag: { walk: 1.28, jog: 3, run: 4 },
  },
  rate: { min: 0.6, max: 1.6, feet: 1, byClass: { walk: 1, jog: 1, run: 1, sprint: 1 } },
  shift: { dropDelay: 0.5, tapWindow: 0.35 },
  stamina: { pool: 100, sprint: -12, run: 0, jog: 4, walk: 10, back: 10, side: 0, sideWalk: 10, air: 0, tiredUntil: 0.3, linger: 1.5 },
  fade: { loco: 0.2, idle: 0.2, jka: 0.2 },
  turn: { torso: 0.5, rate: 14, aimSpine: 69 },
  fight: { walkUnder: 1 },
  peer: { settle: 0.25, hold: 12 },
};

/** What the game shipped with: what a reset puts back. */
export const LOCO_TUNE_SHIPPED: LocoTune = JSON.parse(JSON.stringify(LOCO_TUNE)) as LocoTune;

/** Each number's range, by its path: what a typed value is held to, and a slider's ends. */
export const LOCO_RANGES: Record<string, { min: number; max: number }> = {
  'speed.forward.walk': { min: 0.3, max: 4 },
  'speed.forward.jog': { min: 0.5, max: 6 },
  'speed.forward.tired': { min: 0.5, max: 6 },
  'speed.forward.run': { min: 1, max: 10 },
  'speed.forward.sprint': { min: 1, max: 14 },
  'speed.back.walk': { min: 0.3, max: 4 },
  'speed.back.jog': { min: 0.5, max: 6 },
  'speed.back.run': { min: 1, max: 10 },
  'speed.side.walk': { min: 0.2, max: 4 },
  'speed.side.jog': { min: 0.5, max: 6 },
  'speed.side.run': { min: 1, max: 10 },
  'speed.forwardDiag.walk': { min: 0.3, max: 4 },
  'speed.forwardDiag.jog': { min: 0.5, max: 6 },
  'speed.forwardDiag.run': { min: 1, max: 10 },
  'speed.backDiag.walk': { min: 0.3, max: 4 },
  'speed.backDiag.jog': { min: 0.5, max: 6 },
  'speed.backDiag.run': { min: 1, max: 10 },
  'slope.climb': { min: 20, max: 85 },
  'slope.slide': { min: 0.05, max: 1 },
  'slope.fade': { min: 0, max: 1 },
  'injured.speed': { min: 0.2, max: 3 },
  'injured.below': { min: 0, max: 1 },
  'crouch.forward.slow': { min: 0.2, max: 4 },
  'crouch.forward.normal': { min: 0.2, max: 5 },
  'crouch.forward.fast': { min: 0.3, max: 6 },
  'crouch.back.slow': { min: 0.2, max: 4 },
  'crouch.back.normal': { min: 0.2, max: 5 },
  'crouch.back.fast': { min: 0.3, max: 6 },
  'crouch.stamina.slow': { min: -30, max: 60 },
  'crouch.stamina.normal': { min: -30, max: 60 },
  'crouch.stamina.fast': { min: -30, max: 60 },
  'prone.forward.slow': { min: 0.1, max: 3 },
  'prone.forward.normal': { min: 0.1, max: 4 },
  'prone.forward.fast': { min: 0.2, max: 5 },
  'prone.stamina.slow': { min: -30, max: 60 },
  'prone.stamina.normal': { min: -30, max: 60 },
  'prone.stamina.fast': { min: -30, max: 60 },
  'made.crouched': { min: 0.3, max: 4 },
  'made.crouchBack': { min: 0.3, max: 4 },
  'made.gameWalk': { min: 0.3, max: 4 },
  'made.injuredWalk': { min: 0.2, max: 3 },
  'rate.min': { min: 0.2, max: 1 },
  'rate.max': { min: 1, max: 3 },
  'rate.feet': { min: 0.8, max: 1.25 },
  'rate.byClass.walk': { min: 0.4, max: 1.6 },
  'rate.byClass.jog': { min: 0.4, max: 1.6 },
  'rate.byClass.run': { min: 0.4, max: 1.6 },
  'rate.byClass.sprint': { min: 0.4, max: 1.6 },
  'shift.dropDelay': { min: 0.05, max: 3 },
  'shift.tapWindow': { min: 0, max: 1.5 },
  'stamina.pool': { min: 10, max: 500 },
  'stamina.sprint': { min: -60, max: 0 },
  'stamina.run': { min: -30, max: 30 },
  'stamina.jog': { min: -30, max: 30 },
  'stamina.walk': { min: 0, max: 60 },
  'stamina.back': { min: -30, max: 60 },
  'stamina.side': { min: -30, max: 30 },
  'stamina.sideWalk': { min: -30, max: 60 },
  'stamina.air': { min: -30, max: 30 },
  'stamina.tiredUntil': { min: 0.01, max: 1 },
  'stamina.linger': { min: 0, max: 10 },
  'fade.loco': { min: 0, max: 1 },
  'fade.idle': { min: 0, max: 1 },
  'fade.jka': { min: 0, max: 1 },
  'turn.torso': { min: 0, max: 1 },
  'turn.rate': { min: 1, max: 40 },
  'turn.aimSpine': { min: 34, max: 69 },
  'fight.walkUnder': { min: 0, max: 2 },
  'peer.settle': { min: 0, max: 1 },
  'peer.hold': { min: 0, max: 22 },
};

const SWITCHES: readonly string[] = ['on', 'gunSquare'];
/** The switches that take one of their words, and the words. */
const CARRIES: readonly GunCarry[] = ['full', 'original', 'split'];
export const LOCO_CHOICES: Readonly<Record<string, readonly string[]>> = {
  sprintFight: ['ends', 'muted'],
  sideWalkClip: ['diagonal', 'forward', 'strafe'],
  crouchRule: ['classes', 'before'],
  proneRule: ['classes', 'before'],
  proneBack: ['today', 'reverse'],
  slopeRule: ['limit', 'before'],
  slopeJump: ['refused', 'allowed'],
  'injured.rule': ['walk', 'off'],
  'gunCarry.pistol': CARRIES,
  'gunCarry.carbine': CARRIES,
  'gunCarry.rifle': CARRIES,
  'gunCarry.heavy': CARRIES,
};

/**
 * Set numbers of the table from a nested object (`{ speed: { forward: { run: 5.2 } }, shift: { dropDelay: 0.8 } }`),
 * each held to its range; the two switches take true or false, and a choice one of its words. Answers words for
 * anything held, refused or not known; nothing is saved.
 */
export function tuneLoco(patch: unknown): string[] {
  const words: string[] = [];
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return ['tune takes an object: { speed: { forward: { run: 5.2 } } }'];
  const walk = (at: Record<string, unknown>, values: Record<string, unknown>, path: string): void => {
    for (const [key, raw] of Object.entries(values)) {
      const here = path ? `${path}.${key}` : key;
      if (key === '__proto__' || key === 'constructor' || key === 'prototype' || !Object.prototype.hasOwnProperty.call(at, key)) {
        words.push(`no ${here}`);
        continue;
      }
      const now = at[key];
      if (now && typeof now === 'object') {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) words.push(`${here} takes an object of its numbers`);
        else walk(now as Record<string, unknown>, raw as Record<string, unknown>, here);
        continue;
      }
      if (SWITCHES.includes(here)) {
        // True or false, or the words the debug menu's dial shows (so the line it copies out sets what it says).
        const want = raw === 'on' ? true : raw === 'off' ? false : raw;
        if (typeof want !== 'boolean') words.push(`${here} takes true or false`);
        else at[key] = want;
        continue;
      }
      const words2 = LOCO_CHOICES[here];
      if (words2) {
        if (typeof raw !== 'string' || !words2.includes(raw)) words.push(`${here} takes ${words2.map((w) => `'${w}'`).join(' or ')}`);
        else at[key] = raw;
        continue;
      }
      const range = LOCO_RANGES[here];
      if (!range) {
        words.push(`no ${here}`);
        continue;
      }
      if (typeof raw !== 'number' || !Number.isFinite(raw)) {
        words.push(`${here} takes a number`);
        continue;
      }
      const v = Math.min(range.max, Math.max(range.min, raw));
      if (v !== raw) words.push(`${here} held to ${v} (${range.min} to ${range.max})`);
      at[key] = v;
    }
  };
  walk(LOCO_TUNE as unknown as Record<string, unknown>, patch as Record<string, unknown>, '');
  return words;
}

/** Whether the classes stood on at load: off only for a stored '0'. A page that refuses storage has them on. */
export function locoSwitchOn(read: () => string | null): boolean {
  try {
    return read() !== '0';
  } catch {
    return true;
  }
}

/** `localStorage` key: '0' starts the game with the speed classes off. */
export const LOCO_SWITCH = 'swg.loco';
