// `__debug.skyBodies(...)` (the GPU port's pass 2, wave 4a, maker B): what the moons and planets of the sky draw, and their
// dials. Pure: the world's set and the bake cache's words are handed in, so nothing of three's WebGPU build is reached here.
import { BODY_TIERS, BODY_TUNE, tuneBodies } from './bodyTier.ts';
import { BAKE_TUNE } from './bakeCache.ts';

export interface BodyConsoleContext {
  webgpu: boolean;
  ours: boolean;
  space: boolean;
  bodies: { report(): Record<string, unknown> } | null;
  /** The bake cache's words; `forget` lets its session memo go (the next screen reads the browser's storage). */
  bake: ((forget: boolean) => Record<string, unknown>) | null;
}

/**
 * No argument: each body (its picture, what it shows, its air form this frame and why, its tables and how they were had, its
 * share of the screen), the tier's rule, the dials and the line that keeps them. `{ tune: { sphere, flatAlbedo, sphereAlbedo,
 * discFill, limb, twilight, nightFill, form } }` moves the dials (`form`: 'tier', 'scattered', 'painted' or 'none', every body
 * at once: the prover's switch); `{ bake: 'forget' }` lets the session's bakes go from memory, so the next loading screen
 * reads them from the browser's storage; `{ bakeBudgetMs }` the bakes' budget a screen (200 to start; 0 puts every bake off).
 */
export function skyBodiesConsole(ctx: BodyConsoleContext, o?: Record<string, unknown>): Record<string, unknown> {
  if (!ctx.webgpu || !ctx.ours || ctx.space) {
    return { said: "the moons and planets are drawn as lit cards on WebGPU under our sky over a planet; here every body is SWG's flat picture as it always was" };
  }
  const said: string[] = [];
  if (o && typeof o === 'object') {
    if (o.tune !== undefined) said.push(...tuneBodies(o.tune as Record<string, unknown>));
    if (o.form !== undefined) said.push(...tuneBodies({ form: o.form }));
    if (typeof o.off === 'boolean') said.push(...tuneBodies({ off: o.off ? 1 : 0 }));
    if (o.bake === 'forget' && ctx.bake) ctx.bake(true);
    // The prover's: the bakes' budget a loading screen, held to 0 to 5,000 ms (0 puts every bake off to its fallback).
    if (o.bakeBudgetMs !== undefined) {
      const n = Number(o.bakeBudgetMs);
      if (Number.isFinite(n)) BAKE_TUNE.budgetMs = n < 0 ? 0 : n > 5000 ? 5000 : n;
      else said.push('bakeBudgetMs: not a number');
    }
  }
  const line = `__debug.skyBodies({ tune: ${JSON.stringify(BODY_TUNE)} })`;
  return {
    ...(said.length ? { said } : {}),
    sky: ctx.bodies ? ctx.bodies.report() : 'no bodies on this sky (none made, or the air has no tables yet)',
    tiers: BODY_TIERS.map((r, i) => ({ tier: ['low', 'medium', 'high', 'ultra'][i], ...r, shareMost: Number.isFinite(r.shareMost) ? r.shareMost : 'any' })),
    tune: { ...BODY_TUNE },
    bakeBudgetMs: BAKE_TUNE.budgetMs,
    bake: ctx.bake ? ctx.bake(false) : null,
    // The fixer of pass 2, wave 4a: what is live and what waits for a screen, so a dial moved is not read as doing nothing.
    when: "every dial here is live; a body world's own air (its clear-day visibility and haze colour, `__debug.sky({ air })`) is taken with its tables at the loading screen, so moved, it shows on the body at the next one",
    keep: line,
  };
}
