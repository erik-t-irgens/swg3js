// Which drawn road a race-driven hull is on (the race drawer's second wave, `A:\swg3js\racedrawer\DESIGN.md` §2.8): its
// place on the spines kept by continuity, since height alone cannot say. A hull on the lower road thrown off a crest by an
// underpass can have its middle over the upper road's deck, and one on the upper road climbing to the crossing its middle
// under the deck until it is nearly at the top; read by height it would land on the one and fall through the other.
//
// As each plan begins (`step`), the passes at the hull's place (`CourseCarve.passesAt`, the runs of each path within its
// reach) are looked at: the one of the tracked path whose place along the path is within `jump` metres of where the hull was
// last tracked is kept (its edge and sample moved on); lost (off every road by more than its half width and shoulder, a put-back,
// a teleport) the hull is found again among the passes whose road covers it, the one whose surface is nearest the hull's own
// line and whose way is nearest its travel. Numbers ride a kept record (`TrackAsk`), never a call's arguments.
//
// Pure: imports the carve's store alone. Rule for this file (node runs it with type stripping): every import with its `.ts`
// extension, no enum, no namespace, no constructor parameter properties.

import { CourseCarve, deckAsk, type CarvePass, type DeckAsk } from '../swg/terrain/courseCarve.ts';

/** What a step asks and answers: the hull's place (raw frame), its line (the ground it expects), its travel, how far along a path it may have gone since, and the answer. */
export interface TrackAsk {
  x: number;
  z: number;
  line: number;
  ux: number;
  uz: number;
  jump: number;
  /** Tracked: on a road now, its track and path, its global edge and sample, its place along its path, and the deck there (-Infinity for none). */
  on: boolean;
  track: string;
  path: string;
  edge: number;
  sample: number;
  arc: number;
  deck: number;
}

/** An ask, made once. */
export function trackAsk(): TrackAsk {
  return { x: 0.5, z: 0.5, line: 0.5, ux: 0.5, uz: 0.5, jump: 30.5, on: false, track: '', path: '', edge: -1, sample: -1, arc: 0.5, deck: -Infinity };
}

/** How much a way a full turn from the travel counts against a pass, in metres of height: a pass the hull runs along beats one it crosses. Ours, a constant of the rule. */
const WAY_WEIGHT = 6;

/** The tracker: one per hull. */
export class CourseTracker {
  private readonly deck: DeckAsk = deckAsk();
  /** Steps it was kept by continuity, found again, or lost (the console's). */
  kept = 0;
  found = 0;
  lost = 0;

  /** Let go (a put-back, a teleport, the hull handed back): the next step finds the hull again. */
  reset(a: TrackAsk): void {
    a.on = false;
    a.track = '';
    a.path = '';
    a.edge = -1;
    a.sample = -1;
    a.deck = -Infinity;
  }

  /** One step (`ask` its place, line, travel and jump; its answer written back into it). Nothing made. */
  step(carve: CourseCarve, a: TrackAsk): void {
    const n = carve.passesAt(a.x, a.z);
    if (n === 0) {
      if (a.on) this.lost++;
      this.reset(a);
      return;
    }
    // Kept by continuity: the tracked path's pass whose place along the path is nearest where it was, within `jump`, and
    // still within its reach.
    let keep: CarvePass | null = null;
    let keepD = Infinity;
    if (a.on) {
      for (let k = 0; k < n; k++) {
        const p = carve.passAt(k);
        if (CourseCarve.trackOf(p) !== a.track || CourseCarve.pathOf(p) !== a.path) continue;
        if (!(p.d <= p.hw + p.sh)) continue;
        const arc = carve.arcOf(p);
        let gap = Math.abs(arc - a.arc);
        const len = carve.lengthOf(p);
        if (carve.closedOf(p) && len > 0 && len - gap < gap) gap = len - gap;
        if (gap <= a.jump && gap < keepD) {
          keepD = gap;
          keep = p;
        }
      }
    }
    let pick = keep;
    if (pick) this.kept++;
    else {
      // Found again: among the passes whose road covers the hull, the surface nearest its line and the way nearest its travel.
      let best = Infinity;
      for (let k = 0; k < n; k++) {
        const p = carve.passAt(k);
        if (!p.road) continue;
        // The spine's way at the pass: the right turned back, `(-rz, rx)`.
        const way = Math.abs(-p.rz * a.ux + p.rx * a.uz);
        const score = Math.abs(p.T - a.line) + (1 - way) * WAY_WEIGHT;
        if (score < best) {
          best = score;
          pick = p;
        }
      }
      if (pick) this.found++;
      else {
        if (a.on) this.lost++;
        this.reset(a);
        return;
      }
    }
    const p = pick!;
    a.on = true;
    a.track = CourseCarve.trackOf(p);
    a.path = CourseCarve.pathOf(p);
    a.edge = p.g;
    a.sample = p.i;
    a.arc = carve.arcOf(p);
    const d = this.deck;
    d.x = a.x;
    d.z = a.z;
    d.track = a.track;
    d.path = a.path;
    d.edge = a.edge;
    d.arc = a.arc;
    carve.deckOf(d);
    a.deck = d.out;
  }

  /** Where `deckHere` asks (raw frame), written by the caller, and what it found (-Infinity for none): fields, so no number crosses a call. */
  readonly at = { x: 0.5, z: 0.5, out: -Infinity };

  /** The tracked pass's deck at `at` (raw frame), into `at.out`: what the drawn deck reads under the footprint. */
  deckHere(carve: CourseCarve, a: TrackAsk): void {
    if (!a.on) {
      this.at.out = -Infinity;
      return;
    }
    const d = this.deck;
    d.x = this.at.x;
    d.z = this.at.z;
    d.track = a.track;
    d.path = a.path;
    d.edge = a.edge;
    d.arc = a.arc;
    carve.deckOf(d);
    this.at.out = d.out;
  }
}
