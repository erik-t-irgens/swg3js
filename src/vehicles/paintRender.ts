// Paint renders off the main thread: the recipe renderer a ship's paint gives its customizer. A
// renderer of src/player/recipeWorker.ts with a worker of its own, made the first time a ship is
// painted, apart from the one characters render in, so neither queues behind the other; the main thread
// only posts a job and, when the answer lands, puts the texture on (the customizer's `put`, one upload).
// Where a module worker cannot be had, the same render runs here between frames, with a warning once:
// each then costs this thread its whole render (a fifth to four fifths of a second for a hull). No normal
// map is rendered for a ship: no ship recipe chooses one, and a normal map arriving on a material that had
// none would change its program.
import { makeRecipeRender } from '../player/recipeWorker.ts';

export const renderPaint = makeRecipeRender({ name: 'paint', cacheMB: 96, withNormal: false });
