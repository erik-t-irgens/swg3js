/**
 * One upload range kept per buffer attribute, for a buffer rewritten every frame.
 *
 * Three's `addUpdateRange` pushes a new `{ start, count }` object every call, and three empties the list
 * only when it uploads the attribute, which is only when something draws it. A particle batch is
 * refilled every frame whether or not anything draws it that frame -- the weather's own batches are
 * updated every frame and drawn only when the world is (a room with no exit in sight draws none of it,
 * and the console's `drawPass` off draws none at all) -- so each attribute's list grew by one object a
 * frame for as long as that lasted, and the frame it was drawn again three sorted the whole pile. So a
 * writer keeps one range of its own per attribute and hands it to three once per upload, widening it in
 * place while three has not taken it yet: the list never holds more than one, and nothing is made in a
 * frame. `marks.ts` keeps its windows the same way.
 *
 * No imports, so the node test holds the rule itself.
 */

/** A range of an attribute's array, in array elements, as three reads them. */
export interface UploadRange {
  start: number;
  count: number;
}

/**
 * Ask for `count` elements from `start` of an attribute to be uploaded, through `kept`, the one range
 * this writer keeps for that attribute's list (`attribute.updateRanges`). The caller still sets
 * `needsUpdate`. A list holding only `kept` has it widened; any other list (empty, since three uploaded
 * it, or holding ranges this writer did not put there) becomes `kept` alone, spanning everything the
 * list asked for and this call, so nothing asked for is ever lost.
 */
export function keepUploadRange(list: UploadRange[], kept: UploadRange, start: number, count: number): void {
  if (list.length === 1 && list[0] === kept) {
    const end = Math.max(kept.start + kept.count, start + count);
    kept.start = Math.min(kept.start, start);
    kept.count = end - kept.start;
    return;
  }
  let lo = start;
  let hi = start + count;
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (r.start < lo) lo = r.start;
    if (r.start + r.count > hi) hi = r.start + r.count;
  }
  kept.start = lo;
  kept.count = hi - lo;
  // Written by index rather than emptied and pushed, which would free the list's store.
  list[0] = kept;
  list.length = 1;
}
