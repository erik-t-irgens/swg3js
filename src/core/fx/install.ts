// Where every effect beyond the spine's own passes is registered on a new chain, before it warms
// its shaders. The game calls this once for each chain it builds, including the one built in the
// background when the Effects switch moves, so a chain always has every pass before its warm-up.
//
// Each effect adds its own field to `FxInstallDeps` and its own registration below. Every field is
// optional and belongs to one effect: an effect whose field is missing installs without it, or not
// at all, so a test may pass nothing.
import type { PostFX } from '../postfx';
import { ColorGradePass, GrainVignettePass } from './grade';
import { BladeGlowPass } from './bladeGlow';
import { installWaterReflections, type WaterFxSource } from './water';

export interface FxInstallDeps {
  /** The water bodies whose mask and reflections the effects draw (`World.waterBodies`). */
  water?: WaterFxSource;
}

export function installEffects(postfx: PostFX, deps: FxInstallDeps = {}): void {
  // The colour grade needs nothing from the game: it reads the sky through the frame context.
  postfx.registerPass(new ColorGradePass());
  postfx.registerPass(new GrainVignettePass());
  // The blades' light needs nothing from the game either: it reads the blades from the frame input.
  postfx.registerPass(new BladeGlowPass());
  // The water mask and the reflections, when the game has water bodies to give them.
  if (deps.water) installWaterReflections(postfx, deps.water);
}
