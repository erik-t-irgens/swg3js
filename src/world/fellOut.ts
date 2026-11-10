// Whether something has fallen out of the world: the player put back on the ground, a creature or a person taken away.
//
// The world's `floor` is one number a world (30 m under the lowest ground its own terrain makes, -700 m on a converted
// world), and it knows nothing of the ground the world editor sculpts: on the owner's flat world at 0 m every sculpted
// sinkhole deeper than 30 m put him back on the ground the moment he walked down into it. So falling out also asks the
// ground under the point itself (the sculpt's edits included): under the floor AND `FELL_UNDER` metres under the ground
// there. Wherever the ground stands at least `FELL_UNDER` over the floor (every unsculpted world) the second test follows
// from the first and the answer is the old one; only under sculpted ground below that does something have to fall
// further before it is caught. The ground is read only once the floor has been passed, so the test costs a comparison.

/** How far under the ground right below it something must be, besides under the world's floor, to have fallen out. */
export const FELL_UNDER = 30;

/** The little of a terrain the test reads (`Terrain` answers it; a stand-in with no `heightAt` keeps the floor alone). */
export interface FloorTerrain {
  floor: number;
  heightAt?(x: number, z: number): number;
}

/** Under the world's floor less `margin`, and under the ground at (x, z) by `FELL_UNDER` plus `margin`. */
export function fellOut(t: FloorTerrain, x: number, z: number, y: number, margin = 0): boolean {
  if (!(y < t.floor - margin)) return false;
  if (!t.heightAt) return true;
  const g = t.heightAt(x, z);
  return !(g === g) || y < g - FELL_UNDER - margin;
}
