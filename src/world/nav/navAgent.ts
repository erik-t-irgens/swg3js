// One body's path: the corners still to walk, and the rules about when to ask for new ones.
//
// The corners are kept in the world's own frame, because a building never moves; nothing here is
// allocated after the agent is made, and the whole of it is numbers, so the node test can walk a
// body down a path it drew by hand and count the plans.
//
// A path is asked for when the room or the building changes, and otherwise only when the corners
// have run out or the goal has moved further than `goalMoved` -- and then never more often than
// once every `every` seconds on the simulated clock. So a body standing still with a still goal and
// a path in hand asks for nothing at all, and a body sitting on the end of its path asks twice a
// second rather than on every frame. A search that found nothing sets the body back for `retry`
// seconds rather than being tried again on the next frame.
import { NAV_TUNE, type NavTune } from './navMesh.ts';

export class NavAgent {
  /** x, z of each corner still to walk, in the world's frame, oldest first. */
  readonly corners = new Float64Array(NAV_TUNE.corners * 2);
  count = 0;
  /** The first corner not yet reached. */
  at = 0;
  /** The simulated second the last search ran. */
  planAt = -Infinity;
  /** Where the goal stood when the path was planned. */
  goalX = Number.NaN;
  goalZ = Number.NaN;
  /**
   * The **placed** building and the room the path was planned in; a change in either throws the
   * path away. It is the placed object and not the model it was loaded from, because two copies of
   * one building stand in two places and the corners here are in the world's own frame: keyed on
   * the model, a body that left one copy and entered the other would walk at corners belonging to a
   * building down the street.
   */
  building: object | null = null;
  cell = -1;
  /** Whether the last search found nothing. */
  failed = false;
  /** Searches asked for and searches that found nothing, for the console. */
  plans = 0;
  failures = 0;
  /** The corner handed back, written rather than made. */
  readonly out = { x: 0, z: 0 };

  clear(): void {
    this.count = 0;
    this.at = 0;
    this.goalX = Number.NaN;
    this.goalZ = Number.NaN;
    this.failed = false;
  }

  /**
   * Whether a fresh search is due now.
   *
   * Only two things ask for one: the path has been walked out, or the goal has moved further than
   * `goalMoved` from where it stood when the path was planned. Both are then held to one search
   * every `every` seconds, which is what makes `every` a rate and not a trigger -- read as a
   * trigger it fires on every frame a body stands on the end of its path, which is the commonest
   * state a body loitering at a doorway is in, and one such body would spend the whole of the
   * world's budget for ever.
   *
   * A body whose room or building has changed asks at once and is never held back: its corners are
   * in the wrong room, and walking at them is worse than walking at nothing. A search that found
   * nothing waits `retry`, which is longer.
   */
  wants(building: object | null, cell: number, goalX: number, goalZ: number, now: number, tune: NavTune = NAV_TUNE): boolean {
    if (building !== this.building || cell !== this.cell) return true;
    const since = now - this.planAt;
    if (this.failed) return since >= tune.retry;
    const walkedOut = this.at >= this.count;
    const moved = !(Math.abs(goalX - this.goalX) <= tune.goalMoved && Math.abs(goalZ - this.goalZ) <= tune.goalMoved);
    if (!walkedOut && !moved) return false;
    return since >= tune.every;
  }

  /** What a search found: `count` corners already written into `corners`, or 0 for nothing. */
  took(building: object | null, cell: number, goalX: number, goalZ: number, now: number, count: number): void {
    this.building = building;
    this.cell = cell;
    this.goalX = goalX;
    this.goalZ = goalZ;
    this.planAt = now;
    this.count = Math.max(0, Math.min(count, Math.floor(this.corners.length / 2)));
    this.at = 0;
    this.plans++;
    this.failed = this.count === 0;
    if (this.failed) this.failures++;
  }

  /** Corners the body has reached are dropped. Returns whether one is left to walk to. */
  advance(x: number, z: number, tune: NavTune = NAV_TUNE): boolean {
    const reach = tune.reach * tune.reach;
    while (this.at < this.count) {
      const dx = this.corners[this.at * 2] - x;
      const dz = this.corners[this.at * 2 + 1] - z;
      if (dx * dx + dz * dz > reach) break;
      this.at++;
    }
    return this.at < this.count;
  }

  /** The corner to walk at, or null when the path is walked out. Its own object, never a new one. */
  corner(): { x: number; z: number } | null {
    if (this.at >= this.count) return null;
    this.out.x = this.corners[this.at * 2];
    this.out.z = this.corners[this.at * 2 + 1];
    return this.out;
  }
}
