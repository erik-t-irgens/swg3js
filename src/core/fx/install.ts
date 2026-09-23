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
import { UnderwaterPass } from './underwater';
import { DepthOfFieldPass } from './dof';
import { DofGlowProduct, type DofGlowCollector } from './dofGlow';
import { VelocityProduct, type FxMoverList } from './velocity';
import type { MotionBlurPass } from './motionBlur';
import type { FxPass } from './pass';

export interface FxInstallDeps {
  /** The water bodies whose mask and reflections the effects draw (`World.waterBodies`). */
  water?: WaterFxSource;
  /** The lava tables and plume providers the heat haze draws. */
  heat?: HeatSources;
  /** What adds light at a shot and writes no depth (bolts, flashes, bursts, blade cores), for the depth of field's glow depth. */
  collectDofGlows?: DofGlowCollector;
  /** Every object that moves on its own this frame (App.collectMovers). Without it there is no object blur. */
  collectMovers?: (out: FxMoverList) => void;
  /**
   * Makes the pass that draws the specks drifting in the water (`UnderwaterSpecksPass`, which is the
   * game's own geometry and lives under `src/world/`). A factory rather than a pass, because a pass
   * belongs to one chain: the Effects switch builds a second chain in the background and disposes
   * the first, which would take a shared pass's geometry and program with it.
   */
  specks?: () => FxPass;
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
  // The look under water needs nothing from the game here either: it reads whether the camera is
  // under a surface, how deep, and which body's colour and opacity from the frame context, and asks
  // for no product. It draws on no frame the camera is dry. Where it sits in the chain is the
  // registry's (FX_PASSES), not this line's.
  postfx.registerPass(new UnderwaterPass());
  // The specks drifting in that water, when the game hands over a way to make them. They are drawn
  // after the lens rather than here, which is the registry's business and not this line's.
  if (deps.specks) postfx.registerPass(deps.specks());
  // The depth of field when aiming, with the glows' own depth when the game lists them.
  const dofGlow = deps.collectDofGlows ? new DofGlowProduct(postfx, deps.collectDofGlows) : null;
  if (dofGlow) postfx.registerProduct(dofGlow);
  postfx.registerPass(new DepthOfFieldPass(dofGlow));
  // Object motion blur, when the game lists what moves: the velocity product, and the blur told to ask for it.
  if (deps.collectMovers) {
    postfx.registerProduct(new VelocityProduct(postfx, deps.collectMovers));
    const blur = postfx.pass<MotionBlurPass>('motionBlur');
    if (blur) blur.objects = true;
  }
}
