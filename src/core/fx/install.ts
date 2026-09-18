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
import { SsaoPass, ssaoHostFor } from './ssao';
import { installHeatHaze } from './heat';
import type { HeatSources } from '../../world/heatSources';
import { LensFlarePass } from './lensFlare';
import { LightShaftsPass } from './lightShafts';

export interface FxInstallDeps {
  /** The water bodies whose mask and reflections the effects draw (`World.waterBodies`). */
  water?: WaterFxSource;
  /** The lava tables and plume providers the heat haze draws. */
  heat?: HeatSources;
}

export function installEffects(postfx: PostFX, deps: FxInstallDeps = {}): void {
  // Ambient occlusion reads the frame's lights from the context and makes its region target (sharing
  // the scene's depth-stencil) from the chain: nothing from the game.
  postfx.registerPass(new SsaoPass(ssaoHostFor(postfx)));
  // The colour grade needs nothing from the game: it reads the sky through the frame context.
  postfx.registerPass(new ColorGradePass());
  postfx.registerPass(new GrainVignettePass());
  // The blades' light needs nothing from the game either: it reads the blades from the frame input.
  postfx.registerPass(new BladeGlowPass());
  // The lens flare needs nothing from the game either: it reads the sky's suns and clouds from the frame input.
  postfx.registerPass(new LensFlarePass(postfx.ctx.renderer));
  // The water mask and the reflections, when the game has water bodies to give them.
  if (deps.water) installWaterReflections(postfx, deps.water);
  // The heat haze, when the game hands over what gives off heat.
  if (deps.heat) installHeatHaze(postfx, deps.heat);
  // The room's air needs nothing from the game here: it reads RoomAir's frame through the frame context.
  postfx.registerPass(new LightShaftsPass());
}
