// The burns a lightsaber leaves are no longer a system of their own: they are one of the three
// kinds of mark the world keeps, and every line that drew them now lives in `src/world/marks.ts`
// beside the bolts' scars and the feet's prints, sharing one ring of quads and two draws with them.
//
// This file is the old path, kept alive for the one line in `main.ts` that still says
// `new SaberMarks()`. It holds no logic and no numbers of its own -- a value with two homes drifts,
// and this project has learned that twice -- and the whole of it is the re-export below. The
// snippet that moves that line onto `marks` is in the wave's own notes; when it lands this file
// goes with it.
import { marks, type Marks } from '../world/marks.ts';

export { MARKS, MARKS_BUILD_ONLY, MARK_WORLD, Marks, marks, tuneMarks } from '../world/marks.ts';
export type { MarkGroup, MarkName, MarkPlace, MarksTune, ScarFamily, Vec3Like } from '../world/marks.ts';

/**
 * The old name, and the old `new`. A constructor that returns an object hands back that object, so
 * `new SaberMarks()` is the one set of marks itself and never a second one: two sets would each
 * hold a ring of their own and only whichever of them reached the scene would ever be seen, which
 * is exactly the bug a caller moving to `marks` at its own pace must not be able to write.
 */
export const SaberMarks = function SaberMarks(): Marks {
  return marks;
} as unknown as new () => Marks;
