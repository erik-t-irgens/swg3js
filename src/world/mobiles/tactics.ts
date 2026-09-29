// A person from the catalogue fighting the way a fighter does: its tier, where its feet go while its
// gun stays on you, somewhere to stand out of the line of fire, when it throws itself aside, and a
// count of all of it. The rules are the fighters' own (`src/world/npcs.ts`) and read the very same
// tables -- the ladder (`groundSkill.ts`), the movement (`groundStep.ts`), the cover search
// (`cover.ts`) and the evade (`evade.ts`) -- so one knob moves a fighter and a person alike.
//
// It exists as a file of its own for one reason: a fighter keeps these rules inline, pinned there by
// its own tests, while a mobile is a dynamic body with a brain it shares with every creature, and the
// two ways of standing a body up have nothing else in common. So the rules a person from the catalogue
// needs are written here once, in plain numbers, and `Mobile` supplies the body: it asks, this
// answers, and every ray is cast through the one `CoverDeps` adapter and the one shared searcher with
// its budget over every body in the world.
//
// Pure: no three, no rapier, no browser, and nothing allocated after it is made, so a node test drives
// it directly.
import { GROUND_STEP } from '../groundStep.ts';
import { coverDue, skillOfGroundTier, strafeShare, type GroundSkill } from '../groundSkill.ts';
import { askFromSkill, coverSearch, type CoverAsk, type CoverDeps, type CoverKind } from '../cover.ts';
import { EvadeClock, jumpLevelFor, type JumperKind } from '../evade.ts';
import { firePatterns, postureTransitionNames, type Posture, type Stance } from '../fighterStance.ts';
import type { AnimPack } from './types';

/** How near a spot counts as standing in it, metres: the mobiles' own arrival test (`Mobile.act`). */
export const COVER_ARRIVE = 0.5;

/** One low posture's loops: with nothing up, and with a blaster relaxed, ready and aimed. */
export interface PostureLoops {
  plain: string | null;
  relaxed: string | null;
  ready: string | null;
  aim: string | null;
}

/**
 * The low postures a pack can draw, resolved once when a body is hung: the kneel and the prone loops
 * for the blaster in its hands, the crouch's idle and walk with the walk's own speed, and the kneeling
 * and prone shots. Null for a pack that does not carry the set, which is every pack but the humanoid
 * table's own (`all_m.lat`, curated since pass 7): such a body never goes low at all.
 */
export interface LowClips {
  kneel: PostureLoops;
  prone: PostureLoops;
  crouch: string;
  crouchWalk: string | null;
  /** The crouch walk's own ground speed at scale 1, metres a second; 0 when the pack does not say. */
  crouchSpeed: number;
  fires: { kneel: string[]; prone: string[] };
  /** Whether it has any prone loop at all: the posture rule never lays a body down that cannot be drawn lying. */
  canProne: boolean;
}

/**
 * A logical name's first clip the animator really holds: the table names a clip per branch, slowest
 * first, so the first is the one that stands still.
 */
export function logicalClip(pack: Pick<AnimPack, 'logical'>, name: string, has: (clip: string) => boolean, index = 0): string | null {
  const list = pack.logical?.[name];
  if (!list || index >= list.length) return null;
  const c = list[index];
  return c && has(c) ? c : null;
}

/**
 * The low postures out of a pack's own logical names, for a body holding `kind` (a pistol, a rifle, or
 * nothing to carry). The names are the animation table's, the very ones the fighters ask their rigs
 * for; the shots are the ones `firePatterns` picks for a fighter in the same posture, whole-body clips
 * only, since a pack's additive recoils were authored over a standing body.
 */
export function lowClipsFor(pack: Pick<AnimPack, 'logical' | 'clips'>, kind: 'pistol' | 'rifle' | null, has: (clip: string) => boolean): LowClips | null {
  const kneelPlain = logicalClip(pack, 'loop_kneeling', has);
  const crouch = logicalClip(pack, 'loop_crouched', has);
  if (!kneelPlain || !crouch) return null;
  const crouchWalk = logicalClip(pack, 'loop_crouched', has, 1);
  let crouchSpeed = 0;
  if (crouchWalk) for (const c of pack.clips ?? []) if (c.name === crouchWalk) crouchSpeed = c.speed > 0 ? c.speed : 0;
  const loops = (posture: 'kneel' | 'prone', plain: string | null): PostureLoops => {
    if (!kind) return { plain, relaxed: null, ready: null, aim: null };
    const word = posture === 'kneel' ? 'kneeling' : 'prone';
    const names =
      kind === 'rifle'
        ? { relaxed: `loop_rifle_${word}`, ready: posture === 'kneel' ? 'loop_rifle_kneeling_combat' : 'loop_rifle_combat_prone', aim: posture === 'kneel' ? 'loop_rifle_kneeling_combat_aimed' : 'loop_rifle_combat_prone_aimed' }
        : { relaxed: `loop_pistol_${word}`, ready: `loop_pistol_combat_${word}`, aim: `loop_pistol_combat_${word}_aimed` };
    return { plain, relaxed: logicalClip(pack, names.relaxed, has), ready: logicalClip(pack, names.ready, has), aim: logicalClip(pack, names.aim, has) };
  };
  const shots = (posture: 'kneel' | 'prone'): string[] => {
    if (!kind) return [];
    for (const pattern of firePatterns(kind, posture)) {
      const found: string[] = [];
      for (const name of Object.keys(pack.logical ?? {})) {
        if (name.startsWith('add_') || !pattern.test(name)) continue;
        const clip = logicalClip(pack, name, has);
        if (clip) found.push(clip);
      }
      if (found.length) return found;
    }
    return [];
  };
  const prone = loops('prone', logicalClip(pack, 'loop_prone', has));
  return {
    kneel: loops('kneel', kneelPlain),
    prone,
    crouch,
    crouchWalk,
    crouchSpeed,
    fires: { kneel: shots('kneel'), prone: shots('prone') },
    canProne: !!(prone.plain ?? prone.relaxed ?? prone.ready ?? prone.aim),
  };
}

/** The loop a low posture stands in for a stance: the stance's own, else the nearest the pack has. */
export function lowLoop(c: LowClips, posture: Posture, stance: Stance): string | null {
  if (posture === 'crouch') return c.crouch;
  if (posture === 'stand') return null;
  const set = posture === 'kneel' ? c.kneel : c.prone;
  const want = stance === 'aim' ? set.aim : stance === 'ready' ? set.ready : set.relaxed;
  return want ?? set.ready ?? set.relaxed ?? set.aim ?? set.plain;
}

/** The game's own one-shot between two postures, as the pack names it, or null: `postureTransitionNames`, resolved. */
export function lowTransition(pack: Pick<AnimPack, 'logical'>, from: Posture, to: Posture, moving: boolean, has: (clip: string) => boolean): string | null {
  for (const name of postureTransitionNames(from, to, null, false, moving)) {
    const clip = logicalClip(pack, name, has);
    if (clip) return clip;
  }
  return null;
}

/** What a person has done in its fights, for the console and for the measurements: counted, never reset. */
export interface FightCounts {
  /** Shots fired, and those that struck something alive. */
  shots: number;
  hits: number;
  /** Times it went down on one knee, flat and into a crouch. */
  kneels: number;
  prones: number;
  crouches: number;
  /** Spots taken, and slides started. */
  covers: number;
  slides: number;
}

export class GroundTactics {
  /** Which rung it fights on: 0 is none at all, which is every mobile there was before any of this. */
  tier = 0;
  /**
   * Its tier's own row, held as the object and never copied, as a fighter holds its own: the knob
   * writes each row in place and a body that had taken the numbers out would stop hearing it.
   */
  skill: GroundSkill | null = null;
  /** How high it jumps (`jumpLevelFor`): 0 for nothing, a plain hop, or a Force jump's first or second level. */
  jumpLevel = 0;
  /** The spot it is making for or standing in, and which kind; null when it is not using cover at all. */
  coverKind: CoverKind | null = null;
  coverX = 0;
  coverY = 0;
  coverZ = 0;
  private coverAt = -Infinity;
  private coverFor = 0;
  private coverUntil = 0;
  private coverSettled = false;
  /** Until when a hole it cannot shoot out of is worth nothing to it: see `Npc.hardRestAt`, whose rule this is. */
  private hardRestAt = -Infinity;
  /** What the search said about the spot, for the console only (the searcher refills its own answer). */
  private coverWalk = 0;
  private coverWhy = 0;
  private coverWhich = -1;
  /** What one cover search is asked; one per body, written into. */
  private readonly ask: CoverAsk = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, reach: 0, hardCost: 0, indoors: false };
  /** Where its feet go this frame when that is not the brain's own point: a cover spot or a place on the ring. */
  readonly walkTo = { x: 0, z: 0 };
  /**
   * Whether this frame's travel is a slide -- sideways round the ring, the gun staying where it is --
   * rather than a move to somewhere, which turns the body and takes the gun with it.
   */
  leanOnly = false;
  private strafeSide: number;
  private strafeAt = 0;
  private slideUntil = 0;
  /** Its evade and jump clocks, and how often it has rolled, hopped and jumped. */
  readonly evade = new EvadeClock();
  readonly counts: FightCounts = { shots: 0, hits: 0, kneels: 0, prones: 0, crouches: 0, covers: 0, slides: 0 };

  constructor(side = 1) {
    this.strafeSide = side < 0 ? -1 : 1;
  }

  /**
   * Put it on a rung: 0 or less is no tier at all, the mobile this game had before. Its jump comes
   * with it, by what it is and whether it holds a lightsaber.
   */
  setTier(tier: number, kind: JumperKind, saber: boolean): void {
    this.tier = Number.isFinite(tier) ? Math.max(0, Math.round(tier)) : 0;
    this.skill = this.tier <= 0 ? null : skillOfGroundTier(this.tier);
    this.jumpLevel = jumpLevelFor(this.tier, kind, saber);
    if (!this.skill) this.dropCover(0, false);
  }

  /** Whether its tier has earned facing and travel as two numbers: its strafe share, as a fighter's. */
  get split(): boolean {
    return !!this.skill && this.skill.strafe > 0;
  }

  /** The most its feet may sit off its gun while it slides: the angle whose sine is its strafe, under the legs' own ceiling. */
  get slideLean(): number {
    const s = this.skill ? Math.min(1, Math.max(0, this.skill.strafe)) : 0;
    return Math.min(GROUND_STEP.legMax, Math.asin(s));
  }

  /** Whether it is standing in the spot it took, to within `COVER_ARRIVE`. */
  inSpot(x: number, z: number): boolean {
    return this.coverKind !== null && Math.hypot(this.coverX - x, this.coverZ - z) <= COVER_ARRIVE;
  }

  /**
   * Somewhere to stand out of the line of fire, and whether it is making for one now: `Npc.stepCover`,
   * rule for rule. `wants` is the brain's own `d.cover`; the target's aim point is where a shot would
   * come from. Every refusal a fighter makes is the caller's (a tier, a gun, out of doors), and this
   * answers only when to look, what to ask and how long to believe it. Writes `walkTo` when it answers yes.
   */
  stepCover(now: number, deps: CoverDeps, x: number, y: number, z: number, targetKey: number, tx: number, ty: number, tz: number, wants: boolean, indoors: boolean): boolean {
    const skill = this.skill;
    if (!skill) {
      this.coverKind = null;
      return false;
    }
    const ask = this.ask;
    ask.x = x;
    ask.y = y;
    ask.z = z;
    ask.tx = tx;
    ask.ty = ty;
    ask.tz = tz;
    ask.indoors = indoors;
    askFromSkill(ask, skill);
    // Just out of a hole: one is worth nothing at any price for a while.
    if (now < this.hardRestAt) ask.hardCost = Infinity;
    const due = coverDue(skill, now - this.coverAt);
    if (this.coverKind !== null) {
      if (this.coverFor !== targetKey) {
        this.coverKind = null;
        this.coverSettled = false;
      } else {
        const near = Math.hypot(this.coverX - x, this.coverZ - z) <= COVER_ARRIVE;
        if (near) this.holdCover(now, this.coverKind);
        if (now > this.coverUntil) this.dropCover(now, true);
        else if (due && near) {
          this.coverAt = now;
          this.coverKind = coverSearch.test(deps, ask, this.coverX, this.coverY, this.coverZ);
          this.holdCover(now, this.coverKind);
        }
      }
    }
    if (this.coverKind !== null) return this.walkToSpot();
    if (!due || !wants) return false;
    this.coverAt = now;
    // Already behind something: it claims where it stands, or the ring would slide it back out.
    const here = coverSearch.test(deps, ask, x, y, z);
    if (here !== null) {
      if (here === 'hard' && now < this.hardRestAt) return false;
      this.takeCover(now, x, y, z, here, targetKey, 0, 0, -1);
      this.holdCover(now, here);
      return this.walkToSpot();
    }
    const spot = coverSearch.find(deps, ask, now);
    if (!spot) return false;
    this.takeCover(now, spot.x, spot.y, spot.z, spot.kind, targetKey, spot.walk, spot.score, spot.blocker);
    return this.walkToSpot();
  }

  private walkToSpot(): boolean {
    this.walkTo.x = this.coverX;
    this.walkTo.z = this.coverZ;
    this.leanOnly = false;
    return true;
  }

  private takeCover(now: number, x: number, y: number, z: number, kind: CoverKind, against: number, walk: number, score: number, which: number): void {
    this.coverX = x;
    this.coverY = y;
    this.coverZ = z;
    this.coverKind = kind;
    this.coverFor = against;
    this.coverUntil = now + GROUND_STEP.coverHold;
    this.coverSettled = false;
    this.coverWalk = walk;
    this.coverWhy = score;
    this.coverWhich = which;
    this.counts.covers++;
  }

  /** Cover it can shoot out of is renewed while it holds; a hole gets `hardFor` once; a spot no longer cover ends now. */
  private holdCover(now: number, kind: CoverKind | null): void {
    if (kind === 'crouch') this.coverUntil = now + GROUND_STEP.coverHold;
    else if (kind === null) this.coverUntil = now;
    else if (!this.coverSettled) {
      this.coverSettled = true;
      this.coverUntil = now + GROUND_STEP.hardFor;
    }
  }

  /** Let a spot go; a hole it really sat in starts the rest (`rest` false for a body that has simply stopped fighting). */
  dropCover(now: number, rest = true): void {
    if (rest && this.coverKind === 'hard' && this.coverSettled) this.hardRestAt = now + GROUND_STEP.hardRest;
    this.coverKind = null;
    this.coverSettled = false;
  }

  /**
   * Where a tiered gunner stands while it shoots: on a ring round what it is fighting at its own slot,
   * sliding sideways on its tier's duty cycle -- `Npc.stepStandoff`, rule for rule, with the gun's own
   * `range` for the ring and the body's own `stride` for how far ahead the point is put. Writes `walkTo`
   * and `leanOnly` and answers whether it has anywhere to be. `shooting` is the brain saying shoot;
   * `lineChase` a chase with the shot clear, which is the only chase a ring may hold.
   */
  stepStandoff(now: number, x: number, z: number, tx: number, tz: number, gap: number, key: number, shooting: boolean, lineChase: boolean, range: number, stride: number, rand: () => number = Math.random): boolean {
    const skill = this.skill;
    if (!skill || !(gap > 1e-3) || !(range > 0)) return false;
    if (!shooting && !lineChase) return false;
    const ring = Math.max(1, range * GROUND_STEP.standoff);
    const band = Math.max(1, ring * 0.15);
    const ux = (x - tx) / gap;
    const uz = (z - tz) / gap;
    const slot = (((key * 0.6180339887498949) % 1) - 0.5) * 2 * GROUND_STEP.ringSpread;
    const cs = Math.cos(slot);
    const sn = Math.sin(slot);
    let vx = tx + (ux * cs - uz * sn) * ring - x;
    let vz = tz + (ux * sn + uz * cs) * ring - z;
    const off = Math.hypot(vx, vz);
    if (off > band) {
      vx /= off;
      vz /= off;
    } else {
      vx = 0;
      vz = 0;
    }
    // A duty cycle and not a state: a body that slid on every frame it shot would never kneel.
    if (now - this.strafeAt >= GROUND_STEP.flipEvery) {
      this.strafeAt = now;
      if (rand() < 0.4) this.strafeSide = -this.strafeSide;
      const slide = rand() < skill.strafe;
      this.slideUntil = slide ? now + GROUND_STEP.slideFor : now;
      if (slide && strafeShare(skill, true, gap) > 0) this.counts.slides++;
    }
    const side = now < this.slideUntil ? strafeShare(skill, true, gap) * this.strafeSide : 0;
    vx += -uz * side;
    vz += ux * side;
    const len = Math.hypot(vx, vz);
    if (!(len > 1e-3)) return false;
    this.leanOnly = gap >= ring * GROUND_STEP.closeIn;
    const step = Math.max(2, stride);
    this.walkTo.x = x + (vx / len) * step;
    this.walkTo.z = z + (vz / len) * step;
    return true;
  }

  /** A fresh life, or a body taken over by another browser: nothing it was doing carries on. */
  reset(): void {
    this.coverKind = null;
    this.coverSettled = false;
    this.coverAt = -Infinity;
    this.hardRestAt = -Infinity;
    this.slideUntil = 0;
    this.leanOnly = false;
    this.evade.reset();
  }

  /** For the console: its tier, its jump, where its cover is and what it has done. */
  status(now: number, x: number, z: number): Record<string, unknown> {
    const r = (n: number): number => Number(n.toFixed(1));
    return {
      tier: this.tier,
      jump: this.jumpLevel,
      cover: this.coverKind ? { kind: this.coverKind, away: r(Math.hypot(this.coverX - x, this.coverZ - z)), walk: r(this.coverWalk), score: r(this.coverWhy), blocker: this.coverWhich, holdsFor: r(Math.max(0, this.coverUntil - now)), settled: this.coverSettled } : null,
      restsFor: r(Math.max(0, this.hardRestAt - now)),
      sliding: now < this.slideUntil,
      counts: { ...this.counts, rolls: this.evade.rolls, hops: this.evade.hops, jumps: this.evade.jumps },
    };
  }
}
