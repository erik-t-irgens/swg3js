// The horizon pass's W4 review round: what the world hands the far ground at an edit's end, as pure rules node runs.
//
// `RingCardDebt`: the far cards the rings stand (`World.ringCardTiles`) that an edit's end must stand again on the ground it
// moved, owed by tile -- each once however many of the edit's rectangles meet it -- and stood only once the far ground's
// bake under them is laid. A course's change is laid over the bake a frame's share at a time (`HorizonField.stepCourse`),
// and the near ground's own queue can empty first (a course far from every cached block), so cards stood at the near
// ground's end stood on the uncarved bake and nothing stood them again.
//
// `horizonPaintKeys`: the paint's 512 m tiles a landing hands the far ground to make again.
import { groundChunkOrigin, type GroundShift } from '../groundTiles.ts';
import { rectMeetsChunk } from '../groundRewrite.ts';

/** A rectangle of the game's frame. */
export interface CardRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export class RingCardDebt {
  /** The tiles (`"tx,tz"`) owed. */
  readonly owed = new Set<string>();
  /** Cards stood again (the console's). */
  stood = 0;

  /**
   * Every standing tile (`keys`, `"tx,tz"`) whose far grid the first `n` rectangles meet owed (a tile of `size` metres, its
   * grid reaching `pole` past each side, as `World.ringCardsAgainIn` asked). Answers how many were owed anew.
   */
  oweIn(keys: Iterable<string>, rects: readonly CardRect[], n: number, shift: GroundShift, size: number, pole: number): number {
    if (n <= 0) return 0;
    let added = 0;
    for (const key of keys) {
      if (this.owed.has(key)) continue;
      const comma = key.indexOf(',');
      const o = groundChunkOrigin(Number(key.slice(0, comma)), Number(key.slice(comma + 1)), shift, size);
      for (let k = 0; k < n; k++) {
        const r = rects[k];
        if (!rectMeetsChunk(o.x, o.z, size, r.x0, r.z0, r.x1, r.z1, pole)) continue;
        this.owed.add(key);
        added++;
        break;
      }
    }
    return added;
  }

  /**
   * The owed tiles still standing stood again, each once (`again`), once nothing of the far ground's bake waits to be laid
   * (`waiting`, `HorizonField.live.courseWaiting`); nothing while something does. A tile let go meanwhile is dropped.
   * Answers how many were stood.
   */
  release(waiting: number, standing: ReadonlySet<string>, again: (tx: number, tz: number) => void): number {
    if (waiting > 0 || this.owed.size === 0) return 0;
    let n = 0;
    for (const key of this.owed) {
      if (!standing.has(key)) continue;
      const comma = key.indexOf(',');
      again(Number(key.slice(0, comma)), Number(key.slice(comma + 1)));
      n++;
    }
    this.owed.clear();
    this.stood += n;
    return n;
  }

  /** Nothing owed (the rings let go, a new world). */
  clear(): void {
    this.owed.clear();
  }
}

/**
 * The paint's tiles a landing hands the far ground (`World.landPaint`): where the palette's families moved, every tile the
 * paint holds besides the tiles that moved (an entry's family moves every cell that names it); else the family and colour
 * tiles that moved, or none. A flora tile moves no family and is never handed over.
 */
export function horizonPaintKeys(familiesMoved: boolean, fam: Iterable<number>, col: Iterable<number>, paintFam: Iterable<number> | null, paintCol: Iterable<number> | null): number[] {
  const out = [...fam, ...col];
  if (familiesMoved && paintFam && paintCol) out.push(...paintFam, ...paintCol);
  return out;
}
