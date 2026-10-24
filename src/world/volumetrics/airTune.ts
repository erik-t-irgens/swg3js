// Every number the volumetrics pass invents or takes from the handoff's demos, in one table, live through
// `__debug.air({ tune })`; the numbers of feel among them are sliders too (`airDials.ts`). Each says where it is
// from: [demo] the handoff's demos, which the owner judged by eye at their own scale; [ours] invented here; [code]
// a fact of the game. Nothing in this table is a measurement of anybody's machine, and nothing here is chosen by
// measuring: a number of feel starts at the demo's value or one of ours with its reason, and the owner moves it.
//
// It is a literal of nested groups, each well under 128 keys: the engine moves an object of 128 keys or more out of
// itself, and a frame that reads one boxes what it reads (CLAUDE.md, the grapple's lesson). The frame reads the groups
// it needs by reference, never the whole table through a lookup by name.
//
// Pure: no three, nothing of the page, so the node tests read the very numbers the game runs on.

/** The classes of ground and how each answers the moving air: how far its pattern moves, how fast a mark heals, how deep it gives, how much dust it sheds. */
export interface GroundResponse {
  moves: number;
  heals: number;
  gives: number;
  dust: number;
}

/** Every class's numbers [demo `family_defaults.py`], with the two classes of ours (forest floor, wet shore sand). */
export const GROUND_RESPONSE_CLASSES = {
  sand: { moves: 1.0, heals: 1.0, gives: 1.0, dust: 1.0 },
  ash: { moves: 0.9, heals: 0.8, gives: 1.2, dust: 1.0 },
  snow: { moves: 0.8, heals: 0.6, gives: 1.8, dust: 0.7 },
  dirt: { moves: 0.4, heals: 0.9, gives: 0.6, dust: 0.6 },
  gravel: { moves: 0.2, heals: 1.0, gives: 0.3, dust: 0.3 },
  grass: { moves: 0.05, heals: 1.0, gives: 0.4, dust: 0.2 },
  mud: { moves: 0.35, heals: 0.2, gives: 2.6, dust: 0.0 },
  packed: { moves: 0.1, heals: 1.0, gives: 0.2, dust: 0.35 },
  rock: { moves: 0.0, heals: 1.0, gives: 0.0, dust: 0.12 },
  paved: { moves: 0.0, heals: 1.0, gives: 0.0, dust: 0.1 },
  // Ours (research3): forest floor, leaves and needles and moss; it hardly moves and sheds little.
  litter: { moves: 0.05, heals: 0.8, gives: 0.5, dust: 0.1 },
  // Ours (research3): wet shore sand, which takes a print and throws no dust at all.
  wetsand: { moves: 0.15, heals: 0.5, gives: 1.0, dust: 0.0 },
} as const satisfies Record<string, GroundResponse>;

export type GroundClass = keyof typeof GROUND_RESPONSE_CLASSES;

/** Every class name, in the table's order. */
export const GROUND_CLASS_NAMES = Object.keys(GROUND_RESPONSE_CLASSES) as GroundClass[];

/** The numbers of the pass. */
export const AIR_TUNE = {
  window: {
    /** Metres across the square that follows the camera [code: the ripples' own window at their default detail, `waterSim.ts`]. */
    size: 192,
    /** The share of the window, at each edge, across which what the window draws fades into its inflow [demo: the deck's 8% edge, `land.html:759`]. */
    edge: 0.08,
    /** A snapped origin that moves more than this share of the window in one frame is a jump: every field starts again at its inflow [ours]. */
    jump: 0.5,
    /** Rows and columns past those the window moved over that are filled again from the ground each frame [ours]. */
    stripMargin: 2,
    /** Milliseconds a frame spent asking cells still unknown (no chunk built yet) [ours]. */
    stripBudgetMs: 0.2,
  },
  obstacles: {
    /** How many windows across the solid boxes are gathered over [ours]. */
    gather: 1.5,
    /** The share of the window the window may drift before the boxes are gathered again [ours]. */
    regather: 0.25,
    /** Seconds between gathers whatever the drift, so a tier that loaded is taken in [ours]. */
    every: 4,
    /** The most boxes drawn; past it the nearest are kept and the rest counted [ours: 1.5 windows can hold about 2,000 where the densest town is]. */
    instances: 4096,
    /** A solid stops the air of a slab where it stands this far over the slab's floor, metres [demo `land.html:388`]. */
    over: 1,
    /**
     * A box wider than this either way (its half, metres) is not taken for a wall [ours]: a model box is the whole of a
     * compound, and the widest a town has are open ones -- Mos Eisley's starport is a box 160 m across and 48 m tall
     * round its own courtyard, which as a solid held every texel of the window and laid no dust anywhere near it.
     */
    widest: 40,
  },
  step: {
    /** Solver steps a second [ours]; the Low preset's rate is the setting's own. */
    rate: 60,
    /** At most this many steps a frame, however long the frame was [ours]. */
    most: 3,
  },
  solver: {
    /** The fastest the air may move, m/s [demo `land.html:207`]; above it a source shows as reach, width and impact. */
    cap: 40,
    /** The fastest the liquid may move, m/s [demo `water.html:176`] (from the fourth wave). */
    liquidCap: 30,
    /** The pressure kept between steps [demo, pitfall 3]. */
    keep: 0.8,
    /** Vorticity confinement at the demo's 0.86 m cell [demo Swirl 22]; applied as `swirl · swirlCell / cell` so the look holds across grids [ours]. */
    swirl: 22,
    /** The cell the swirl's number was set at, metres [demo: 110 m over 128 cells]. */
    swirlCell: 0.86,
    /** How fast the air's own motion dies, a second [demo `land.html:1809`]. */
    dissipation: 0.25,
    /** How fast the air is pulled toward the wind, a second [demo `land.html:1812`]. */
    relax: 0.45,
  },
  forces: {
    /** Velocity splats in one step's batch, two `vec4`s each [ours: 256 of D3D11's 1024 fragment vectors]. */
    splats: 128,
    /** Dust splats in a frame's batch [ours]. */
    dust: 32,
    /** Smoke splats in a step's batch (from the third wave) [ours]. */
    smoke: 32,
    /** Dent stamps in a draw (from the second wave) [ours]. */
    dents: 256,
    /** How many of the strongest engines take their whole 16 splats; the rest take 8 [ours]. */
    engineFull: 4,
  },
  wind: {
    /** The weather's wind speed taken as metres a second, times this [ours: the weather's `windSpeedScale` read as m/s, research1 §4.3]. */
    scale: 1,
    /** Gust cells about 29 m carried downwind, and a finer noise over them [demo `land.html:437-441`]. */
    gust: 0.8,
  },
  slabs: {
    /** A force at height y reaches a slab by exp(-((centre - y) / reach)²), metres [demo]. */
    reach: 1,
    /** Slab 0: from the ground to 3.5 m, its middle 1.5 m, its wind 0.72 of the weather's [demo `land.html:224`]. */
    floor: 0,
    ceiling: 3.5,
    centre: 1.5,
    windShare: 0.72,
  },
  dust: {
    /** Seconds the dust takes to settle: it decays as 1 / (1 + dt / settle) [demo `land.html:1850`]. */
    settle: 3,
    /** Dusty ground sheds this much dust a second in a storm, times the storm's level [ours]. */
    stormShed: 0.6,
    /** The storm's dust the window's inflow carries, times the storm's level [ours]. */
    stormInflow: 0.35,
    /** Metres the dust thins over above the ground: exp(-h / height) [demo `land.html:1144`]. */
    height: 1.8,
    /** The height it rises to as the storm rises, metres [ours]. */
    stormHeight: 12,
    /** How much light a unit of dust takes, a metre [demo `land.html:1144`]. */
    extinction: 0.55,
    /** The slope over which ground stops shedding, degrees: shed times 1 - smoothstep(from, to, slope) [ours, research3 Q8]. */
    slopeFrom: 25,
    slopeTo: 40,
    /** The colour dust takes where the ground's own is not known yet: the demo's sand, sRGB [demo `land.html:630`]. */
    fallbackColour: 0xcca875,
  },
  grains: {
    /** The pull on a grain thrown up, m/s² [ours: the world's own]. */
    gravity: 9.8,
    /** Seconds a grain lies on the ground before it fades [demo: the kick-up lingers]. */
    rest: 0.4,
    /** Grains a thermal detonator throws, scaled by radius / 7 [demo `land.html:1604`]. */
    blast: 300,
    /** Seconds a grain from a blast lives at most [demo `land.html:1609`]. */
    blastLife: 3,
  },
  light: {
    /** Metres a step of the march toward the sun is long: 0.64 · min(3.5, 0.75 / tan elevation) [demo `land.html:648`, `:1552`]. */
    step: 0.64,
    sunCap: 3.5,
    sunScale: 0.75,
    /** The steps the demo's reach was set at; fewer steps are lengthened by 26 / steps so the reach in metres holds [ours]. */
    refSteps: 26,
    /** How much a unit of dust takes from the sun on the way [demo `land.html:653`]. */
    dust: 0.55,
    /** The transmittance is exp(-k · sum) [demo `land.html:661`]. */
    k: 0.16,
  },
  volume: {
    /** The loop bound of the march: no setting asks for more [ours]. */
    maxSteps: 48,
    /** The ray is clipped to the window's lowest ground less this and its highest plus `above`, metres [demo's bands `land.html:1181`]. */
    below: 1.5,
    above: 20,
    /** Height-only taps that find where the ray lies inside the band of air [ours]. */
    findTaps: 8,
    /** Past the window, the inflow's dust is integrated in closed form along the rest of the ray to this far, metres [ours]. */
    farReach: 400,
    /** Seconds a source lifted dust before the pass says nothing is airborne and stands down [ours]. */
    airborneFor: 10,
    /** The share of the current march the history takes each frame [ours, pitfall 20]. */
    history: 0.1,
    /** The phase: 0.55 + 1.6 · max(mu, 0)^6 [demo `land.html:1162`]. */
    phaseBase: 0.55,
    phaseLift: 1.6,
    phasePower: 6,
    /** How much of the sky's own ambient lights the dust [ours]. */
    ambient: 1,
    /** How much the sun lights the dust, times the sun the scene is lit by [ours]. */
    sun: 1,
  },
  engine: {
    /** Exit speed by kind, times the engine's heat, m/s [ours]. */
    exitSpeeder: 28,
    exitFlyer: 35,
    exitPod: 45,
    exitShip: 60,
    /** The fastest exit [demo's top, `land.html:1394`]. */
    exitCap: 150,
    /** Reach of the free jet: 1.2 + 0.32 · exit, metres [demo `land.html:1437`]. */
    reachBase: 1.2,
    reachPerSpeed: 0.32,
    /** The jet's speed is held to this share of the cap [demo `land.html:1438`]. */
    capShare: 0.92,
    /** The nozzle: 0.3 + 0.012 · exit, metres [demo `land.html:1439`]. */
    nozzleBase: 0.3,
    nozzlePerSpeed: 0.012,
    /** The free jet widens this much a metre [demo `land.html:1454`]. */
    widen: 0.16,
    /** The free jet's push, times its speed, a second [demo `land.html:1456`]. */
    jetPush: 3,
    /** The impact's ring of shoves, metres out [demo `land.html:1493`]. */
    impactRing: 1.4,
    /** The impact's shoves, times its speed, a second [demo `land.html:1493`]. */
    impactPush: 2.4,
    /** How much of a slanted jet's impact goes the way it heads [demo `land.html:1492`]. */
    impactBias: 0.8,
    /** Dust from the impact, times its speed and the ground's dust, a second [demo `land.html:1495`]. */
    impactDust: 0.09,
    /** The impact reaches the ground within this many reaches [demo `land.html:1482`]. */
    impactReach: 1.25,
    /** The spread under a nozzle: clamp(1 - (h - spreadLow) / spreadSpan) · (spreadBase + speed / spreadSpeed) [demo `land.html:1717`]. */
    spreadLow: 0.5,
    spreadSpan: 3.4,
    spreadBase: 0.35,
    spreadSpeed: 12,
    /** The spread's ring of shoves, times its bite, a second [demo `land.html:1724`]. */
    spreadPush: 46,
    /** The spread's dust, times its bite and the ground's dust, a second [demo `land.html:1729`]. */
    spreadDust: 3.5,
    /**
     * A hovering ship's and a flyer's downwash straight down, exit m/s [ours]. The ship's is 40 rather than the design's
     * 30: the impact reaches the ground only within 1.25 reaches, and at 30 m/s (a reach of 10.8 m) a ship hovering at
     * 15 m -- one of the heights the design's own test asks to lift dust -- would stir nothing under it; at 40 the reach
     * is 14 m and the ground is met to 17.5 m. A number of feel all the same, and a dial.
     */
    downwashShip: 40,
    downwashFlyer: 18,
    /** The downwash is gone at this forward speed, m/s [ours]. */
    downwashFade: 25,
  },
  force: {
    /** A Force push's shove, m/s, and a pull's back toward the player [ours]. */
    push: 24,
    pull: 12,
    /** A repulse's ring of shoves, m/s [ours]. */
    repulse: 30,
    /** Metres up the column a power stirs [ours]. */
    column: 4,
    /** A power's dust, at this share of a blast's [ours]. */
    dustShare: 0.5,
  },
  blast: {
    /** A blast's ring of shoves: 22 of 75 m/s at 2 m [demo `land.html:1596-1598`], times push / 14 (the thermal detonator's) [ours]. */
    shoves: 22,
    shove: 75,
    ring: 2,
    pushRef: 14,
    /** Where the ring stands, as a share of the blast's own radius [ours]. */
    ringShare: 0.3,
    /** The dust a blast lifts: 3.2 at a thermal detonator's radius of 7, by radius / 7 [demo `land.html:1600`]. */
    dust: 3.2,
    radiusRef: 7,
    /** A wreck's blast: radius 6 + the hull's, push 14 [ours]. */
    wreckRadius: 6,
    wreckPush: 14,
  },
  /**
   * The ground's carried offsets (the second wave, the design's §2.7): how fast the air must blow before the sand's
   * pattern moves, how far it moves, and how it heals. The threshold is `min(W · liftOver + liftAdd, liftCap)` m/s, `W`
   * the weather's wind before any slab's share, so the planet's own breeze never moves sand and a jet does, and a real
   * gale's gusts still drift it [demo `land.html:1895`].
   */
  ground: {
    liftOver: 1.05,
    liftAdd: 1.5,
    liftCap: 13,
    /** The lift rises over this many m/s above the threshold: smoothstep(L, L + span, |v|) [demo `land.html:553`]. */
    liftSpan: 7,
    /** The pattern moves at the air's speed times this, times the lift and the ground's own "moves" [demo `land.html:554`]. */
    lift: 0.35,
    /** Where the lift passes this a texel's age starts again: it is being moved [demo `land.html:558`]. */
    ageReset: 0.04,
    /** Seconds a moved patch holds untouched before it heals [demo]. */
    hold: 2.5,
    /** Seconds it then takes to heal (three of its time constants, about 95% gone) [demo]. */
    heal: 6,
    /** How much darker pressed ground is at most [demo `land.html:939`], and the dent depth (metres) times this that reaches it. */
    darkening: 0.18,
    darkenScale: 6,
    /** How much of the sun the dust's shadow on the ground takes at most: the demo's mix(1, lit, 0.8) [demo `land.html:942`]. */
    shade: 0.8,
    /** A texel's age is counted in ticks of the 10 Hz clock, held under this (a half float holds every whole number to 2048) [ours]. */
    ageCap: 2000,
  },
  /**
   * The dents: footprints, a speeder's rut, a scour pit under a jet, a crater (the second wave, the design's §2.7). Every
   * depth is metres, times the ground's own "gives" where it is stamped [demo `land.html:671-729`, `:1594-1614`,
   * `:1715-1767`]. The field is a square of `square` metres round the camera, read with its last `squareEdge` metres
   * faded [ours].
   */
  prints: {
    /** A footprint, toe and heel, its length and width, metres, and how deep, times the body's own scale [demo `land.html:1764`]. */
    footAlong: 0.32,
    footAcross: 0.15,
    footDepth: 0.035,
    /** Seconds a print takes to fade on ground that heals at 1 (sand): exp(-0.1 · heals / fade) a tick of the 10 Hz clock [demo `land.html:727`]. */
    fade: 25,
    /** A speeder's rut, its bowl's radius, metres, and how deep it digs a second at a bite of 1 [demo `land.html:1730`: 0.0055 a frame at 60]. */
    bowl: 1.7,
    rut: 0.33,
    /** A scour pit under a jet: metres a second at an impact of 1 m/s [demo `land.html:1498`: 2.5e-5 a frame at 60, read a second]. */
    scour: 1.5e-3,
    /** The pit's radius, `nozzle + widen · distance to the ground + add`, metres [demo `land.html:1498`]. */
    scourWiden: 0.12,
    scourAdd: 0.5,
    /** A crater: `across · radius` across and `depth · radius` deep at a blast's radius [ours, the demo's 3.4 and 1.15 m at a thermal detonator's 7]. */
    craterAcross: 0.49,
    craterDepth: 0.16,
    /**
     * How far over the ground a blast still presses it, as a share of its radius: a crater as deep as above at the
     * ground, shallower the higher it went off, none past this (a ship destroyed in flight, a splash on a wall metres
     * up press nothing) [ours: half its radius, so a grenade bouncing at knee height or a speeder wrecked at its ride
     * height still digs, and a fighter overhead does not].
     */
    craterReach: 0.5,
    /** Metres across the dent square round the camera, and the metres at its edge a dent fades over [ours]. */
    square: 128,
    squareEdge: 4,
    /** A continuous stamp's path is laid at this share of its radius apart, so a rut is a trough and not a row of pits [ours]. */
    spacing: 0.5,
    /** A foot more than this many metres off the ground under it (a crate, a step) leaves a decal, not a dent [ours]. */
    groundGap: 0.75,
  },
};

export type AirTune = typeof AIR_TUNE;

/** What `tuneAir` answers with: the words for anything it refused, and whether a number the field's targets were made from moved. */
export interface TuneAnswer {
  notes: string[];
  rebuild: boolean;
}

/**
 * A tune key whose number is spent when the window (or the dent square) is placed, so a move of it starts every field
 * again at the next step (a jump: class T, never a program).
 */
const REBUILD_KEYS = new Set(['window.size', 'prints.square']);

/**
 * Move numbers of the table, as `{ group: { key: value } }`: a number that is not finite, a key the table has not got,
 * or a group that is not one, is refused in words and nothing else moves for it. The loop bounds compiled into the
 * programs (the splats a batch holds, the volume's most steps) are not offered: a move of one would build a program.
 */
export function tuneAir(o: Record<string, unknown>): TuneAnswer {
  const notes: string[] = [];
  let rebuild = false;
  const T = AIR_TUNE as unknown as Record<string, Record<string, number>>;
  for (const [g, v] of Object.entries(o)) {
    const group = T[g];
    if (!group || typeof group !== 'object' || v === null || typeof v !== 'object') {
      notes.push(`air: no group "${g}" in the tune`);
      continue;
    }
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
      if (!(k in group)) {
        notes.push(`air: no number "${g}.${k}"`);
        continue;
      }
      if (typeof n !== 'number' || !Number.isFinite(n)) {
        notes.push(`air: ${g}.${k} must be a finite number`);
        continue;
      }
      if ((g === 'forces' && (k === 'splats' || k === 'dust' || k === 'dents')) || (g === 'volume' && k === 'maxSteps')) {
        notes.push(`air: ${g}.${k} is a loop bound compiled into the programs and is not moved live`);
        continue;
      }
      if (g === 'obstacles' && k === 'instances') {
        notes.push('air: obstacles.instances sizes the obstacles\' buffers, made once with the field for the session, and is not moved live');
        continue;
      }
      group[k] = n;
      if (REBUILD_KEYS.has(`${g}.${k}`)) rebuild = true;
    }
  }
  return { notes, rebuild };
}
