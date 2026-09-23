// What a body on fire looks like, sounds like and does to the air around it.
//
// The burn itself is not here and is not new: every body that can be hurt already keeps a burn
// (`Hittable.afflict(dps, seconds)`, eaten down inside its own update on the world's simulated
// clock), and the flame thrower, its fireball, the acid sprayer and a spitting creature all set
// one. What was missing was any sign of it: a burning body took damage silently and invisibly.
//
// So this owns no timer. It reads `burningFor` off each body -- the seconds that body's own burn
// has left -- and hangs three things off it: one particle effect in the world at the body's feet,
// one plume for the heat haze, and one looping voice. Nothing else in the game knows about it.
//
// **Why it lives outside the bodies.** CLAUDE.md records the lesson from the lightsabers: a loop
// hung on something that stops being drawn outlives it. A mobile is culled as a whole group, so its
// own update simply stops being called while a hum is still playing; a mobile that dies off screen
// never gets a frame in which to put it out. A fire has exactly that shape and worse -- a placed
// particle effect left behind is a fire standing in the air where a creature used to be. The answer
// here is that nothing a body does can leave one: every frame this walks the world's own list of
// the living, marks what it finds burning, and takes down every handle it did **not** find. A body
// that dies, respawns, is culled out of the list, is disposed, or simply stops burning, loses its
// fire on the very next step, whether or not anything ever calls back to say so.
//
// Every number in `FIRE_TUNE` is ours. The archives say what a fire looks like; they say nothing
// about how many of them may burn at once, how far off one is worth drawing, how wide the hot air
// over a burning creature is, or which of the game's own fire loops a burning body should make --
// nothing in the archives ties any sound to a burning body at all. All of it is live through
// `__debug.fire({ ... })`.
//
// It allocates nothing in a steady frame and does no work at all past one field read per living
// body while nothing is burning. That holds on the paths where nothing works, too: a mixer that
// will not start a fire's loop (the pack is still coming, or simulated seconds are being stepped)
// is not asked again on the very next step, because the mixer writes down every refusal and eight
// burning bodies asking sixty times a second would fill its whole report by themselves. That is the
// lightsabers' own lesson twice over (`SaberSounds.keep`), and `FIRE_TUNE.retry` is this file's
// share of it.
import * as THREE from 'three';
import { plumeNoiseFrequency, type HeatPlumeSink } from './heatSources.ts';
import { OUTSIDE, type SoundSpace } from '../audio/distance.ts';
import type { LoopHost } from '../audio/emitters.ts';
import { fireLookLine } from '../player/fireLook.ts';

/**
 * What this needs of something that can be on fire. Every `Living` in the game answers it: the
 * creatures, the fighters, the catalogue's mobiles and the player. `burningFor` is the one addition
 * -- the seconds that body's own burn has left -- and it is optional, so a body that has never
 * heard of a burn simply never catches one.
 */
export interface BurningBody {
  readonly key: number;
  readonly label: string;
  /** Where it stands. The base of the fire; `halfHeight` says how far up its own body reaches. */
  readonly pos: { readonly x: number; readonly y: number; readonly z: number };
  readonly halfHeight: number;
  readonly dead: boolean;
  /** Seconds of burn left. 0, or absent, is not burning. */
  readonly burningFor?: number;
}

/** A handle to a placed effect. Opaque here; `ParticleEffects` hands back its own. */
export type FireHandle = object;

/**
 * The particle effects a fire is placed in. `ParticleEffects` answers it exactly as it stands, and
 * the one it must be given is `World.weaponFx`: that instance is made once with the app and
 * survives a planet change, while the planet's own `particles` is disposed and rebuilt on every
 * load, which would leave a handle pointing into a freed instance the moment anybody travelled.
 */
export interface FireEffects {
  place(file: string, matrix: THREE.Matrix4, contained: boolean, transient?: boolean, frame?: THREE.Matrix4 | null, solid?: boolean, options?: { sound?: boolean }): FireHandle;
  move(handle: FireHandle, matrix: THREE.Matrix4): void;
  remove(handle: FireHandle): void;
}

/** Whatever can make a particle effect ready before it is first placed (`ParticleEffects`). */
export interface FirePreparer {
  prepare(file: string, renderer?: unknown): Promise<boolean>;
}

/**
 * The mixer as the fires need it: the world's own looping API, plus the one field that says a
 * request would be thrown away before it was made. `advancing` is true while `__debug.advance` is
 * stepping simulated seconds, when `Mixer.play` records the request and starts nothing; asking then
 * costs an entry in the mixer's own 40-line report for every burning body on every simulated step,
 * which is exactly how a driven tab's report comes back full of nothing but fire. `AudioSystem`
 * satisfies it as it stands, and `SaberSounds` reads the same field for the same reason.
 */
export interface FireHost extends LoopHost {
  readonly advancing?: boolean;
}

export interface FireTune {
  /** Ours: the switch. Off, a burn is exactly what it was before this -- damage and nothing else. */
  on: boolean;
  /**
   * Ours. How many burning bodies draw a fire at once. A pack of burning creatures would otherwise
   * be a dozen particle effects at once; the ones past the cap still burn and still take damage,
   * and the listing says how many are burning unseen rather than pretending there are none.
   */
  shown: number;
  /**
   * Ours. How many push a plume into the heat haze. The haze's whole budget is 48 plumes a frame,
   * shared with every engine in the world and a held flame thrower, so a pack of burning creatures
   * must not be able to spend it and dim the lava and the engines behind them.
   */
  heat: number;
  /** Ours. How many hold a looping voice: a mixer with a pool of 40 positional slots must not be filled by one fire each. */
  heard: number;
  /** Ours. Metres from the player past which a fire is not drawn, heard or heated. The body still burns. */
  range: number;
  /**
   * Ours. How a body already inside a cap is ranked against one that is not: its distance counts for
   * this share of itself. Without it two bodies a hair apart at the edge of a cap swap places every
   * frame, which is an effect placed and removed every frame -- or a voice started and stopped every
   * frame, leaving a drift of fading voices in the mixer's pool -- for as long as they both burn.
   *
   * It is applied to each of the three caps on its own, against whether that body was inside **that**
   * cap last step. Biasing one order by "has a fire" and reading the same order off for all three
   * gave the hold to the drawn cap alone: with `shown` above `heard` and `heat`, every body near
   * their edges already had a fire, so the bias cancelled between them and their order was plain
   * distance again -- which is the very churn this number exists to stop.
   */
  keep: number;
  /**
   * Ours. Seconds of burn left below which no fire is lit at all. A burn is set and eaten down, so
   * the tail of every one of them passes through a fraction of a frame; without this a burn that
   * ends on a tick boundary can place an effect and take it away again on the same step.
   */
  least: number;
  /**
   * Ours. **Extra** height for the fire on a big body, as a share of that body's whole height up
   * from its feet, added to whatever metres the file itself asks for.
   *
   * It is 0, and 0 is the answer for everything the game draws today: the file's own lift is the
   * whole of where a fire stands (`FIRE_LIFT` in `src/player/fireLook.ts`), and the client's own
   * burn is authored standing 1.5 m up from wherever it is put, which is a person's chest. Adding a
   * share of the body's height on top of that put every fire in the game over its own head. What
   * this is for is the one thing that measurement does not answer -- a burning bantha wears a
   * person-sized flame at its belly -- and it is left here, at nothing, as the one place a lift by
   * body size can go once the owner has seen a big creature alight.
   */
  lift: number;
  /** Ours. The hot air's near radius over a burning body, as a share of the body's whole height. */
  plumeRadius: number;
  /** Ours. And its far radius, at the top of the column: hot air spreads as it rises. */
  plumeTop: number;
  /** Ours. How far the column of hot air reaches, as a share of the body's whole height. */
  plumeLength: number;
  /** Ours. How hot: the haze's own cap is 2, a held flame thrower asks for 1.4, an engine rather less. */
  plumeIntensity: number;
  /** Ours. Metres a second the hot air rises, which is what carries the haze's noise up the column. */
  plumeFlow: number;
  /**
   * Ours, out of the game's own names. The fire loop a burning body makes. Nothing in the archives
   * ties a sound to a burning body, so this is a choice: the fire field's crackle, which is a
   * looping 3D template that carries at 20 m. The other candidate is the campfire's own small loop,
   * which is the same kind of sound at 3 m and is all but inaudible unless you are standing on it.
   */
  loopId: string;
  /** The client's own state chimes, which it plays at the player when a state goes on and off. Played for the player alone; they are 2D, so they sound at the ear. */
  chimeOn: string;
  chimeOff: string;
  /** Ours. Seconds a fire's voice takes to fade out when the burn ends, so a fire does not stop dead. */
  fade: number;
  /**
   * Ours. Seconds a fire whose loop the mixer would not start waits before asking again.
   *
   * The mixer answers 0 with no key in two states the game is really in -- the sound pack has not
   * landed yet, and simulated seconds are being stepped -- and it writes every refusal into the
   * 40-line report `__debug.audio().recent` is read out of. Without a wait, one burning creature
   * fills that report in three seconds and a driven tab can no longer see what the mixer did about
   * anything else. The lightsabers' hum waits half a second for the same reason; a fire waits longer
   * because there may be several of them asking at once and a crackle is a bed rather than a note.
   */
  retry: number;
  /**
   * Ours. Whether a placed fire also plays whatever sounds its own emitters name. Off: this plays
   * one loop per burning body and the effect stays silent, or a fire that carries its own crackle
   * would be heard twice. On is the way to hear what the client's effect names for itself.
   */
  fxSound: boolean;
  /**
   * Ours. Whether a fire's voice takes the ear's own room rather than the open world. On, which is
   * what the held-trigger loop already does: a fire in the room you are standing in is not muffled
   * by the wall rule. The price is that a fire in the next room is not muffled either, since nothing
   * here knows which room a burning creature is standing in.
   */
  earRoom: boolean;
}

/**
 * Every number of ours, live through `__debug.fire({ ... })`.
 *
 * The caps are the ones the brief asked for: eight fires drawn, six heated, six heard. Eight is
 * about as many burning bodies as can be on one screen without the picture becoming one sheet of
 * flame, and six plumes is an eighth of the heat haze's whole frame budget, which leaves the
 * engines, the lava and a held flame thrower the rest. None of the three has been seen or heard
 * from here.
 *
 * `lift` is 0 and means it: where a fire stands is the chosen file's own answer, and this is the
 * spare share of a body's height for the day a big creature is seen alight.
 */
export const FIRE_TUNE: FireTune = {
  on: true,
  shown: 8,
  heat: 6,
  heard: 6,
  range: 60,
  keep: 0.8,
  least: 0.2,
  lift: 0,
  plumeRadius: 0.22,
  plumeTop: 0.4,
  plumeLength: 1.6,
  plumeIntensity: 0.9,
  plumeFlow: 3,
  loopId: 'sound/pt_firefield_crackle.snd',
  chimeOn: 'sound/sta_onfire_on.snd',
  chimeOff: 'sound/sta_onfire_off.snd',
  fade: 0.4,
  retry: 1,
  fxSound: false,
  earRoom: true,
};

/** The hard ceiling on every cap, and on the pool of kept records. */
export const FIRE_MAX = 32;

/** A fire the manager is keeping: one body, its handle, its voice and its plume's own noise phase. */
interface Burn {
  body: BurningBody;
  /** The effect placed for it, and the instance that placed it (a handle is only ever removed from the instance that made it). */
  handle: FireHandle | null;
  owner: FireEffects | null;
  /** Which file the handle was placed from, so a pack landing later replaces a fire already lit. */
  file: string;
  /** The mixer's key for its loop; 0 is none. */
  voice: number;
  /** The step clock's reading before which this one does not ask the mixer again, after a refusal. */
  retryAt: number;
  /** Which reading of the ear's room that voice was last given, so `setSpace` is called on a change and never in a steady frame. */
  spaceAt: number;
  /** The plume's own noise phase, advanced by this rather than worked out from a clock. */
  phase: number;
  /** The frame it was last seen burning on. A record not seen this frame is taken down. */
  mark: number;
  /** Squared metres from the player. */
  d2: number;
  /** Scratch: the same biased by `keep` for whichever cap is being chosen just now. */
  score: number;
  /** Where the fire stands in the world this frame: the body, its own share of its height, and then the metres the chosen file asks for. */
  x: number;
  y: number;
  z: number;
  /** Where the hot air stands: the body's own share of the way up it, with no per-file lift, since the plume is the body's and not the effect's. */
  baseY: number;
  /** The body's whole height, floored, which sizes the plume. */
  height: number;
  /** Whether it is inside each cap this step. */
  drawn: boolean;
  heard: boolean;
  heated: boolean;
  /** And whether it was inside each of them on the last one, which is what `keep` holds it there by. */
  wasDrawn: boolean;
  wasHeard: boolean;
  wasHeated: boolean;
}

/**
 * Which cap is being chosen, for the one selection pass that serves all three. Plain numbers rather
 * than an enum: node's type stripping runs the tests and an enum is not a type it can strip away.
 */
const CAP_DRAWN = 0;
const CAP_HEARD = 1;
const CAP_HEATED = 2;

/** One kept matrix: a fire is placed and moved with a plain translation and nothing else. */
const place = new THREE.Matrix4();

/** `ParticleEffects.move` reads only the position out of the matrix, so a scale or a turn written here would be lost on the first move: a fire is placed square to the world and stays that way. */
function translation(x: number, y: number, z: number): THREE.Matrix4 {
  return place.makeTranslation(x, y, z);
}

function finite(n: number): boolean {
  return Number.isFinite(n);
}

/** A cap as it is really applied: a whole number, never below nothing, never past the hard ceiling. */
export function fireCap(wanted: number, ceiling = FIRE_MAX): number {
  if (!Number.isFinite(wanted)) return 0;
  return Math.max(0, Math.min(Math.floor(ceiling), Math.floor(wanted)));
}

/**
 * Whether a body is burning as far as this is concerned: alive, with more of a burn left than the
 * least worth lighting. Pure, so the rule is one thing and the test reads it directly.
 */
export function isBurning(body: BurningBody | null | undefined, least = FIRE_TUNE.least): body is BurningBody {
  if (!body || body.dead) return false;
  const left = body.burningFor ?? 0;
  return Number.isFinite(left) && left > Math.max(0, least);
}

/** What the fires have done since the page opened, for the listing. Numbers only. */
export interface FireCounts {
  /** Effects placed and taken down, which in a steady scene stop rising. */
  placed: number;
  removed: number;
  /** Voices started and stopped. */
  voices: number;
  stopped: number;
  /** The player's own state chimes, both ways round. */
  chimes: number;
  /** Names the bank has not got, counted once each. */
  missing: number;
  /**
   * Times the mixer would not start a fire's loop -- the sound pack is still coming, or simulated
   * seconds are being stepped -- each of which then waits `FIRE_TUNE.retry` seconds rather than
   * asking again on the next step. It rising steadily while the game is playing normally means the
   * wait is doing its job on a bank that never landed; it rising sixty times a second would mean
   * this file was filling the mixer's own report by itself.
   */
  waited: number;
  /** Steps on which a fire would have been drawn and no file had been named. Steps, not bodies. */
  noFile: number;
  /** Plumes handed to the heat haze. */
  plumes: number;
  /** Calls into the effects or the mixer that threw; a fire that cannot be placed is simply not drawn. */
  refused: number;
}

/** What is burning and what is being done about it. */
export interface FireReport {
  on: boolean;
  /** Bodies burning right now, whatever the caps allow. */
  burning: number;
  /** And how many of them are drawn, heard and heating the air. */
  shown: number;
  heard: number;
  heated: number;
  /** How many are past each cap. They are still burning and still taking damage. */
  unseen: number;
  unheard: number;
  unheated: number;
  nearest: { label: string; key: number; metres: number; left: number } | null;
  file: string | null;
  why: string;
  loop: string;
  caps: { shown: number; heard: number; heat: number; range: number };
  counts: FireCounts;
}

/**
 * Every burning body's look, heat and sound. One of these for the session: `World` steps it inside
 * `stepLiving`, so `__debug.advance` exercises it exactly as the frame loop does, and the heat's own
 * provider reads the ranking it left.
 */
export class BurningBodies {
  private readonly records: Burn[] = [];
  /** Records taken down and kept for the next body that catches fire, so a burn starting allocates nothing. */
  private readonly spare: Burn[] = [];
  private readonly byBody = new Map<BurningBody, Burn>();
  /** Indices into `records`, nearest first, rebuilt each step by insertion; never a new array. */
  private readonly rank: number[] = [];
  /**
   * And the three caps' own orders, each chosen with `keep` against whether that body was inside
   * **that** cap last step. Three kept arrays rather than one, because one order cannot hold three
   * boundaries: a body inside the drawn cap and outside the heard one is held by the first and must
   * be free to lose the second.
   */
  private readonly drawRank: number[] = [];
  private readonly hearRank: number[] = [];
  private readonly heatRank: number[] = [];
  private frame = 0;
  /** Simulated seconds this has been stepped for, which is what a refused voice waits on. */
  private clock = 0;
  private fx: FireEffects | null = null;
  private host: FireHost | null = null;
  private file: string | null = null;
  /** Where the effect file came from, for the listing: the wiring says which of the two it picked. */
  private fileWhy = 'nothing has named a fire effect yet';
  /** Metres the effect file itself wants lifting by, which is not the same question as where on a body a fire stands. */
  private fileLift = 0;
  /** The space a fire's voice stands in: the ear's own while `earRoom` is on, else the open world. One kept object, never made in a frame. */
  private readonly space: SoundSpace = { building: OUTSIDE.building, cell: OUTSIDE.cell };
  private earBuilding = OUTSIDE.building;
  private earCell = OUTSIDE.cell;
  /** Bumped whenever the ear's room really changes: a voice is only ever told about a change. */
  private earVersion = 1;
  /** Whether the player was burning on the last step, which is what the two state chimes hang on. */
  private selfLit = false;
  private drawnCount = 0;
  private heardCount = 0;
  private heatCount = 0;
  /** Lifetime counts, for the listing. */
  readonly counts: FireCounts = { placed: 0, removed: 0, voices: 0, stopped: 0, chimes: 0, missing: 0, waited: 0, noFile: 0, plumes: 0, refused: 0 };
  /** Names the bank has not got, so each is counted once rather than once a frame. */
  private readonly missingSounds = new Set<string>();
  /**
   * The one options object handed to `loop`, refilled rather than made: the mixer spreads it into a
   * record of its own and copies the space out of it, so nothing here is kept by reference and a
   * fire starting costs no allocation at all.
   */
  private readonly loopArgs: { x: number; y: number; z: number; space: SoundSpace } = { x: 0, y: 0, z: 0, space: OUTSIDE };

  /** The effects a fire is placed in. Given once: it must be the instance that survives a planet change. */
  setEffects(fx: FireEffects | null): void {
    if (fx === this.fx) return;
    // Whatever was placed belongs to the old instance; it is taken down there before anything else.
    this.clear();
    this.fx = fx;
  }

  /**
   * The mixer. The three templates are asked for at once so the bank has them before anybody burns.
   *
   * A mixer swapped under a lit fire has every voice stopped in the mixer that started it, first and
   * while it is still the one this holds: a key only means anything to the mixer that handed it out,
   * and dropping them afterwards would zero the keys here and leave the loops playing over there.
   * Nothing calls it with null today; it is one line to be right about rather than a latent one.
   */
  attach(host: FireHost | null): void {
    if (host !== this.host) for (const r of this.records) this.dropVoice(r);
    this.host = host;
    if (!host) return;
    try {
      host.prepare([FIRE_TUNE.loopId, FIRE_TUNE.chimeOn, FIRE_TUNE.chimeOff]);
    } catch {
      // A mixer that cannot prepare is a mixer that will not play either; the voice path reports it.
    }
  }

  /**
   * Which file a fire is drawn from, in one word where it came from, and how far the file itself
   * wants lifting off the ground. Called when the weapons pack lands, and safe to call as often as
   * anybody likes. A file that changes takes down every fire already lit, so the next step lights
   * them again from the new one rather than leaving a mixture on the screen.
   *
   * `lift` is the **file's** question and not the body's: one effect is authored standing up from
   * where it is put and another about its own middle, and only whoever picked the file knows which.
   * Where on a body a fire stands is `FIRE_TUNE.lift`, which is a share of that body's height and
   * is the same whatever file is drawn.
   */
  setEffect(file: string | null, why = '', lift = 0): void {
    const next = file && file.length ? file : null;
    this.fileWhy = why || (next ? next : 'the pack names no fire effect');
    this.fileLift = Number.isFinite(lift) ? lift : 0;
    if (next === this.file) return;
    this.file = next;
    for (const r of this.records) this.dropHandle(r);
  }

  get effectFile(): string | null {
    return this.file;
  }

  /** Where the ear stands, so a fire in the room you are in is not muffled by the wall rule. Safe to call every frame: only a real change is passed on. */
  setEar(space: SoundSpace | null): void {
    const b = space ? space.building : OUTSIDE.building;
    const c = space ? space.cell : OUTSIDE.cell;
    if (b === this.earBuilding && c === this.earCell) return;
    this.earBuilding = b;
    this.earCell = c;
    this.earVersion++;
  }

  /**
   * One step. `bodies` is the world's own list of the living and `self` the player's own body, which
   * is passed apart because the list drops the player whenever they may not be attacked and a burn
   * must not be lost for that; a body in both is handled once. `at` is where the player stands,
   * which is what the caps are measured from.
   *
   * Allocates nothing: the records are pooled, the ranking and the three caps' orders are kept
   * arrays of indices sorted in place, the matrix handed to the effects is one kept matrix and the
   * options handed to the mixer are one kept object. A step on which nothing burns walks the list
   * once, reads one field per body and does nothing else at all.
   */
  update(dt: number, bodies: readonly BurningBody[] | null, self: BurningBody | null, at: { x: number; y: number; z: number } | null): void {
    if (!FIRE_TUNE.on) {
      if (this.records.length) this.clear();
      this.selfLit = false;
      return;
    }
    const mark = ++this.frame;
    this.clock += Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const least = Math.max(0, FIRE_TUNE.least);
    // The player first, so a body that is in the list as well is met once rather than twice.
    if (isBurning(self, least)) this.touch(self, mark);
    if (bodies) {
      for (let i = 0; i < bodies.length; i++) {
        const b = bodies[i];
        if (b === self || !isBurning(b, least)) continue;
        this.touch(b, mark);
      }
    }
    this.sweep(mark);
    this.rankAndSize(at);
    this.apply(dt);
    this.chime(self);
  }

  /** A body found burning this step: its record, made or reused, with where it stands written into it. */
  private touch(body: BurningBody, mark: number): void {
    let r = this.byBody.get(body);
    if (!r) {
      r = this.spare.pop() ?? { body, handle: null, owner: null, file: '', voice: 0, retryAt: 0, spaceAt: 0, phase: 0, mark: 0, d2: 0, score: 0, x: 0, y: 0, z: 0, baseY: 0, height: 1, drawn: false, heard: false, heated: false, wasDrawn: false, wasHeard: false, wasHeated: false };
      r.body = body;
      r.handle = null;
      r.owner = null;
      r.file = '';
      r.voice = 0;
      r.retryAt = 0;
      r.spaceAt = 0;
      r.phase = 0;
      r.drawn = false;
      r.heard = false;
      r.heated = false;
      r.wasDrawn = false;
      r.wasHeard = false;
      r.wasHeated = false;
      this.records.push(r);
      this.byBody.set(body, r);
    }
    r.mark = mark;
    const p = body.pos;
    const h = Math.max(0.5, Math.abs(body.halfHeight) * 2);
    r.height = h;
    r.x = p.x;
    // The body's own share first, which is 0 for everything the game draws today, and then the
    // metres the chosen file itself asks for, which is where a fire really stands. The plume is
    // placed on `baseY`: the hot air is the body's and takes nothing from the file.
    r.baseY = p.y + h * FIRE_TUNE.lift;
    r.y = r.baseY + this.fileLift;
    r.z = p.z;
  }

  /** Every record not found burning this step: down it goes, this step, whatever became of the body. */
  private sweep(mark: number): void {
    const list = this.records;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.mark === mark) {
        list[w++] = r;
        continue;
      }
      this.retire(r);
    }
    list.length = w;
  }

  /**
   * Who is near enough to be worth anything, and which of them each cap takes.
   *
   * `rank` is the plain truth -- every record inside the range, nearest first -- and is what the
   * listing's `nearest` reads. The three caps are then chosen out of it one at a time, each with its
   * own hold: a body inside **that** cap last step is ranked at `keep` of its real distance for
   * **that** cap alone. One order biased by "has a fire" would have held the drawn cap and nothing
   * else, since with `shown` above `heard` and `heat` every body near their edges is drawn already
   * and the bias cancels between them; two bodies milling at nearly equal distance would then have
   * started and stopped a voice every frame apiece.
   */
  private rankAndSize(at: { x: number; y: number; z: number } | null): void {
    const rank = this.rank;
    rank.length = 0;
    const list = this.records;
    const range = Math.max(0, FIRE_TUNE.range);
    const far = range * range;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      // Last step's answers, kept before this step's are written: they are what `keep` holds by.
      r.wasDrawn = r.drawn;
      r.wasHeard = r.heard;
      r.wasHeated = r.heated;
      r.drawn = false;
      r.heard = false;
      r.heated = false;
      if (!finite(r.x) || !finite(r.y) || !finite(r.z)) {
        r.d2 = Infinity;
        continue;
      }
      if (at) {
        const dx = r.x - at.x;
        const dy = r.y - at.y;
        const dz = r.z - at.z;
        r.d2 = dx * dx + dy * dy + dz * dz;
      } else r.d2 = 0;
      if (r.d2 > far) continue;
      // Insertion, nearest first. The list is short and this allocates nothing.
      let k = rank.length;
      rank.push(i);
      while (k > 0 && list[rank[k - 1]].d2 > r.d2) {
        rank[k] = rank[k - 1];
        rank[k - 1] = i;
        k--;
      }
    }
    this.drawnCount = this.choose(CAP_DRAWN, fireCap(FIRE_TUNE.shown), this.drawRank);
    this.heardCount = this.choose(CAP_HEARD, fireCap(FIRE_TUNE.heard), this.hearRank);
    this.heatCount = this.choose(CAP_HEATED, fireCap(FIRE_TUNE.heat), this.heatRank);
  }

  /**
   * One cap's own pick, out of the records already inside the range: the `cap` nearest of them with
   * whoever was inside this cap last step counting as `keep` of their real distance. The chosen ones
   * are marked and how many there were is the answer; `into` is left holding this cap's order,
   * nearest first, which is what the heat haze's own pass reads later in the frame.
   */
  private choose(which: number, cap: number, into: number[]): number {
    into.length = 0;
    if (cap <= 0) return 0;
    const list = this.records;
    const rank = this.rank;
    const keep = Math.max(0, Math.min(1, FIRE_TUNE.keep));
    for (let i = 0; i < rank.length; i++) {
      const idx = rank[i];
      const r = list[idx];
      const held = which === CAP_DRAWN ? r.wasDrawn : which === CAP_HEARD ? r.wasHeard : r.wasHeated;
      r.score = held ? r.d2 * keep : r.d2;
      let k = into.length;
      into.push(idx);
      while (k > 0 && list[into[k - 1]].score > r.score) {
        into[k] = into[k - 1];
        into[k - 1] = idx;
        k--;
      }
    }
    const n = Math.min(cap, into.length);
    for (let i = 0; i < n; i++) {
      const r = list[into[i]];
      if (which === CAP_DRAWN) r.drawn = true;
      else if (which === CAP_HEARD) r.heard = true;
      else r.heated = true;
    }
    return n;
  }

  /** The effects and the voices brought into line with what the ranking decided, and the phases moved on. */
  private apply(dt: number): void {
    const list = this.records;
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const space = this.voiceSpace();
    let wanted = false;
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      // The noise phase rises with the hot air whether or not this one is drawing a plume, so a
      // fire that comes back inside the cap does not restart its noise from the beginning.
      if (step > 0) r.phase = (r.phase + step * FIRE_TUNE.plumeFlow * plumeNoiseFrequency(Math.max(0.05, r.height * FIRE_TUNE.plumeTop))) % 1;
      if (r.drawn) wanted = true;
      this.applyLook(r);
      this.applyVoice(r, space);
    }
    // Counted once for the step and not once per body: eight bodies alight on a pack converted
    // before this wave would otherwise add eight a frame and bury every other count in the listing.
    if (wanted && !this.file) this.counts.noFile++;
  }

  private applyLook(r: Burn): void {
    const fx = this.fx;
    const file = this.file;
    if (!r.drawn || !fx || !file) {
      this.dropHandle(r);
      return;
    }
    if (r.handle && r.owner === fx && r.file === file) {
      fx.move(r.handle, translation(r.x, r.y, r.z));
      return;
    }
    this.dropHandle(r);
    try {
      // Not transient: a fire stands until it is taken down, and `sound: false` keeps whatever the
      // effect's own emitters name out of the mixer, because one loop per burning body is played here.
      //
      // The price of not being transient is that `ParticleEffects` warms a standing effect up when
      // it wakes -- up to ten seconds of it run in the one frame, so a smoke column is already
      // standing when it comes into view -- and that is paid on the frame a body catches fire and
      // again each time one comes back inside the range or the cap. It also means a fire arrives
      // fully alight rather than catching. Transient is not the other reading: a transient effect
      // ends itself after one run, and the client's own burn loops, so it would put itself out.
      // Left as it is deliberately, and named here because it is the owner's to judge by eye.
      r.handle = fx.place(file, translation(r.x, r.y, r.z), false, false, null, false, { sound: FIRE_TUNE.fxSound });
      r.owner = fx;
      r.file = file;
      this.counts.placed++;
    } catch {
      r.handle = null;
      r.owner = null;
      this.counts.refused++;
    }
  }

  private applyVoice(r: Burn, space: SoundSpace): void {
    const host = this.host;
    // The drop comes first and the host's absence second: a record that keeps a key and is never
    // given the chance to let it go is a loop playing with nothing left to move or stop it, which is
    // the lightsabers' lesson in one line.
    if (!host || !r.heard) {
      this.dropVoice(r);
      return;
    }
    if (r.voice) {
      // A voice the mixer gave away (a nearer sound took its slot) is asked for again rather than
      // moved: `move` on a key nobody holds does nothing, and the fire would go quiet for good.
      if (host.isPlaying(r.voice)) {
        host.move(r.voice, r.x, r.y, r.z);
        // Only on a real change of room, and with an object of its own: the mixer keeps whatever it
        // is handed here by reference, so one shared object would tie every fire's room together.
        if (r.spaceAt !== this.earVersion) {
          r.spaceAt = this.earVersion;
          host.setSpace(r.voice, { building: space.building, cell: space.cell });
        }
        return;
      }
      r.voice = 0;
    }
    // Simulated seconds are being stepped: the mixer records the request and starts nothing, so
    // asking is a line in its report and no sound at all. Nothing waits on this -- the moment real
    // frames run again the fire asks and is heard.
    if (host.advancing) return;
    // And a refusal a moment ago is not asked about again until the wait is up. `Mixer.play` answers
    // 0 with no key whenever the sound pack has not landed, and every one of those answers goes into
    // the 40-line report a driven tab reads the mixer by: a burning creature asking sixty times a
    // second fills it in three seconds with nothing but its own refusals.
    if (this.clock < r.retryAt) return;
    const id = FIRE_TUNE.loopId;
    if (!this.available(host, id)) {
      r.retryAt = this.clock + Math.max(0, FIRE_TUNE.retry);
      return;
    }
    try {
      // The space handed to `loop` is copied by the mixer, so the kept one is safe here, and the
      // options themselves are one kept object refilled rather than made a fire at a time.
      const args = this.loopArgs;
      args.x = r.x;
      args.y = r.y;
      args.z = r.z;
      args.space = space;
      r.voice = host.loop(id, args);
      r.spaceAt = this.earVersion;
      if (r.voice) this.counts.voices++;
      else {
        this.counts.waited++;
        r.retryAt = this.clock + Math.max(0, FIRE_TUNE.retry);
      }
    } catch {
      r.voice = 0;
      this.counts.refused++;
      r.retryAt = this.clock + Math.max(0, FIRE_TUNE.retry);
    }
  }

  /**
   * The two state chimes, for the player alone: one as they catch fire and one as it goes out.
   * Nothing per tick.
   *
   * They follow the player's own burn and **not** whether they may be attacked. On the player's
   * body `dead` means noclipping, aboard a hull's rooms, in a panel or really dead as well, and a
   * walk up a boarding ramp must not sound as though the fire had gone out and then come back when
   * they step off again. Whether a player who has really died is still counted as burning is the
   * player's own body's answer, since it is the thing that keeps the burn: the game puts the fire
   * out where the body ends (`Player.startRagdoll`, `Player.reset`) and where the world does
   * (`World.unload`), all three in silence and none of them through here.
   *
   * The edge is a burn at all and not `FIRE_TUNE.least`, which is a rule about lighting an effect
   * for a fraction of a frame and has nothing to say about a state. Chiming at the least instead
   * sounded the all-clear a fifth of a second before the fire really went out, and a burn shorter
   * than the least made no sound at all either way.
   */
  private chime(self: BurningBody | null): void {
    const left = self ? (self.burningFor ?? 0) : 0;
    const lit = Number.isFinite(left) && left > 0;
    if (lit === this.selfLit) return;
    this.selfLit = lit;
    const host = this.host;
    if (!host) return;
    // Simulated seconds: nothing is played and nothing is counted as played.
    if (host.advancing) return;
    const id = lit ? FIRE_TUNE.chimeOn : FIRE_TUNE.chimeOff;
    if (!this.available(host, id)) return;
    try {
      // 2D templates: they carry no place, so they sound at the ear whatever the player is doing.
      // Counted only when the mixer really started one, so the listing cannot claim a chime nobody
      // heard.
      if (host.play(id)) this.counts.chimes++;
    } catch {
      this.counts.refused++;
    }
  }

  /** Whether the bank really has a template, counted once per name so a missing sound is said and not shouted. */
  private available(host: LoopHost, id: string): boolean {
    const bank = host.bank;
    // Before the bank has loaded nothing can be said about a name, so the mixer is left to decide.
    if (!bank || !bank.available) return true;
    if (bank.template(id)) return true;
    if (!this.missingSounds.has(id)) {
      this.missingSounds.add(id);
      this.counts.missing++;
    }
    return false;
  }

  private voiceSpace(): SoundSpace {
    const outside = !FIRE_TUNE.earRoom;
    this.space.building = outside ? OUTSIDE.building : this.earBuilding;
    this.space.cell = outside ? OUTSIDE.cell : this.earCell;
    return this.space;
  }

  /**
   * The frame's plumes, read off the ranking the last step left. It is called from inside the heat
   * haze's own pass, after the scene has drawn; a provider that throws loses only its own plumes,
   * which is the heat sources' own rule, and this is one provider for every fire in the world.
   */
  heatPlumes(sink: HeatPlumeSink): void {
    if (!FIRE_TUNE.on) return;
    // The heat cap's own order, chosen with its own hold, nearest first: if the haze's budget runs
    // out part way down it, the ones that lose their plume are the far ones.
    const rank = this.heatRank;
    const list = this.records;
    const n = Math.min(this.heatCount, rank.length);
    for (let i = 0; i < n; i++) {
      const r = list[rank[i]];
      if (!finite(r.x) || !finite(r.y) || !finite(r.z)) continue;
      const h = r.height;
      // A column of hot air standing on the body and spreading as it rises. It stands on the body
      // and not on the effect: a file that wants lifting a metre does not make the body's air start
      // a metre higher.
      if (!sink.push(r.x, r.baseY, r.z, 0, 1, 0, h * FIRE_TUNE.plumeLength, h * FIRE_TUNE.plumeRadius, h * FIRE_TUNE.plumeTop, FIRE_TUNE.plumeIntensity, r.phase)) return;
      this.counts.plumes++;
    }
  }

  private dropHandle(r: Burn): void {
    if (!r.handle) return;
    try {
      r.owner?.remove(r.handle);
      this.counts.removed++;
    } catch {
      this.counts.refused++;
    }
    r.handle = null;
    r.owner = null;
    r.file = '';
  }

  private dropVoice(r: Burn): void {
    if (!r.voice) return;
    try {
      this.host?.stop(r.voice, FIRE_TUNE.fade);
      this.counts.stopped++;
    } catch {
      this.counts.refused++;
    }
    r.voice = 0;
  }

  /** A record's fire put out and the record put back in the pool. */
  private retire(r: Burn): void {
    this.dropHandle(r);
    this.dropVoice(r);
    this.byBody.delete(r.body);
    r.drawn = false;
    r.heard = false;
    r.heated = false;
    r.wasDrawn = false;
    r.wasHeard = false;
    r.wasHeated = false;
    r.retryAt = 0;
    if (this.spare.length < FIRE_MAX) this.spare.push(r);
  }

  /**
   * Every fire out. The world's unload calls it, and so does the switch going off: a planet left
   * with something burning on it must not leave a handle in an instance the next world will draw,
   * nor a voice in the mixer with nothing to move it.
   */
  clear(): void {
    for (const r of this.records) this.retire(r);
    this.records.length = 0;
    this.rank.length = 0;
    this.drawRank.length = 0;
    this.hearRank.length = 0;
    this.heatRank.length = 0;
    this.byBody.clear();
    this.drawnCount = 0;
    this.heardCount = 0;
    this.heatCount = 0;
    this.selfLit = false;
  }

  /** How many are burning right now, whether they are shown or not. */
  get burning(): number {
    return this.records.length;
  }

  /**
   * What is burning and what is being done about it. The caps are the point of the listing: a body
   * past one is still burning and still taking damage, and `unseen`, `unheard` and `unheated` say
   * how many, rather than the furthest simply going missing.
   */
  report(): FireReport {
    const list = this.records;
    const n = list.length;
    let nearest: { label: string; key: number; metres: number; left: number } | null = null;
    if (this.rank.length) {
      const r = list[this.rank[0]];
      nearest = { label: r.body.label, key: r.body.key, metres: Number(Math.sqrt(r.d2).toFixed(1)), left: Number((r.body.burningFor ?? 0).toFixed(2)) };
    }
    return {
      on: FIRE_TUNE.on,
      burning: n,
      shown: this.drawnCount,
      heard: this.heardCount,
      heated: this.heatCount,
      unseen: Math.max(0, n - this.drawnCount),
      unheard: Math.max(0, n - this.heardCount),
      unheated: Math.max(0, n - this.heatCount),
      nearest,
      file: this.file,
      why: this.file ? this.fileWhy : `${this.fileWhy}: a burning body takes damage and shows nothing`,
      loop: FIRE_TUNE.loopId,
      caps: { shown: fireCap(FIRE_TUNE.shown), heard: fireCap(FIRE_TUNE.heard), heat: fireCap(FIRE_TUNE.heat), range: FIRE_TUNE.range },
      counts: this.counts,
    };
  }
}

/** The one for the session. */
export const burning = new BurningBodies();

/**
 * Make the fire's own effect ready before anything can be set alight: its batch built hidden in the
 * scene and its textures uploaded, so the loading screen's warm-up compiles it and no fire builds a
 * program on the frame it is first lit. The world's load calls it beside the Force's own, and a
 * second call over the same file prepares nothing again.
 */
export async function prepareFireEffect(fx: FirePreparer | null | undefined, renderer: unknown, file: string | null): Promise<boolean> {
  if (!fx || !file) return false;
  try {
    return await fx.prepare(file, renderer);
  } catch {
    return false;
  }
}

/**
 * The weapons rack, as far as the fire needs it: the one method that answers which fire a burning
 * body is drawn with. `WeaponCatalogue` satisfies it, and it is asked rather than the manifest read
 * because the rack works the answer out once and says the one console line about it once -- which
 * of the two answers a session got, and what to run if it is nothing. Saying that here as well
 * would say it twice.
 */
export interface FireLookSource {
  fireLook(): { file: string; lift: number } | null;
}

/** What a choice of fire came to, for the caller and the test. */
export interface FireLookTaken {
  /** The file the fires are drawn from now, or null while there is none to draw. */
  file: string | null;
  /** Whether the weapons rack was in hand at all when the choice was made. */
  known: boolean;
}

/**
 * Take the fire off the weapons rack: ask it which file a burning body is drawn with, tell the
 * manager, and make that file ready before anybody can be set alight.
 *
 * **It is called twice on purpose**, and the second call is not a belt. The rack is fetched once at
 * boot and the first world's load races it -- `main.ts` says exactly that where the Force beam's own
 * look has the same problem, and `jedi.ts` re-runs `prepareForceEffects` when the rack lands for the
 * same reason. A load that reached this with no rack in hand would otherwise stand at "no fire" for
 * the whole session on that planet and draw nothing for every burn, with the console line blaming a
 * pack that is perfectly good. So it is called at the world's load **and** where the rack lands.
 *
 * With no rack in hand it draws nothing and waits, and asks nobody to say anything about it: which
 * of the two answers a session got is the rack's own line, said once, the first time it is asked.
 * Preparing the same file twice prepares nothing again.
 */
export async function adoptFireLook(fx: FirePreparer | null | undefined, renderer: unknown, rack: FireLookSource | null | undefined, into = burning): Promise<FireLookTaken> {
  const known = !!rack;
  const look = rack ? rack.fireLook() : null;
  const file = look?.file ?? null;
  into.setEffect(file, known ? fireLookLine(look) : 'the weapons rack has not landed yet; a fire is chosen the moment it does', look?.lift ?? 0);
  await prepareFireEffect(fx, renderer, file);
  return { file, known };
}

/** What `__debug.fire({ ... })` may write. */
export type FireTuneOptions = Partial<FireTune>;

/**
 * Write the live numbers from the console. Each key is taken only with a value of its own kind and,
 * for a number, only a finite one; anything else is stepped over without comment, so one typo
 * cannot empty the block. The caps are floored to whole bodies and held under the hard ceiling.
 */
export function tuneFire(opts?: FireTuneOptions): FireTune {
  if (!opts) return FIRE_TUNE;
  const into = FIRE_TUNE as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(opts)) {
    if (!(k in FIRE_TUNE)) continue;
    const was = into[k];
    if (typeof v !== typeof was) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    into[k] = v;
  }
  FIRE_TUNE.shown = fireCap(FIRE_TUNE.shown);
  FIRE_TUNE.heard = fireCap(FIRE_TUNE.heard);
  FIRE_TUNE.heat = fireCap(FIRE_TUNE.heat);
  FIRE_TUNE.range = Math.max(0, FIRE_TUNE.range);
  FIRE_TUNE.least = Math.max(0, FIRE_TUNE.least);
  FIRE_TUNE.keep = Math.max(0, Math.min(1, FIRE_TUNE.keep));
  FIRE_TUNE.fade = Math.max(0, FIRE_TUNE.fade);
  FIRE_TUNE.retry = Math.max(0, FIRE_TUNE.retry);
  return FIRE_TUNE;
}

/** The defaults, so a run that has moved the numbers can be put back without a reload. */
const FIRE_DEFAULTS: FireTune = { ...FIRE_TUNE };

/** Put every number back where it started (the console, and the node test between blocks). */
export function resetFireTune(): FireTune {
  Object.assign(FIRE_TUNE, FIRE_DEFAULTS);
  return FIRE_TUNE;
}
