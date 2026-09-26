/**
 * Whether one of an effect's emitters draws anything, which is what decides whether it is made at all.
 *
 * It is a file of its own, with no imports, because it is the rule that cost an evening: an emitter
 * this refuses is never built, never spawns a particle and so never reaches the drawing, which from
 * the outside is an effect that is placed and playing with nothing in it. When mesh particles were
 * added, the drawing was written and this was not, so every mesh emitter in the game was dropped
 * before it could spawn -- and the entertainer's ribbon stick, whose quads the client itself writes
 * with alpha nought for their whole life, is *only* mesh emitters, so it showed an empty hand while a
 * sparkler, which has real quads beside its mesh, showed its sparks and not its stick.
 *
 * Nothing here knows about three or about the rest of the runtime, so the node test holds the rule
 * itself rather than a copy of it.
 */

/** As much of an emitter as the rule reads: the converter's own shape, with everything else left out. */
export interface DrawableEmitter {
  /** Whether the emitter is switched on at all, which the client's own files sometimes are not. */
  visible?: boolean;
  particle?: {
    type?: string;
    quad?: { texture?: { file?: string | null; visible?: boolean; shader?: string | null } | null } | null;
    mesh?: { file?: string | null } | null;
  } | null;
}

/**
 * Whether this emitter puts anything on the screen.
 *
 * A **mesh** emitter draws when it names a model: one out of a pack converted before the models were
 * read carries only the path it had in the archives and really does draw nothing, so it is refused,
 * exactly as it was before mesh particles existed. A **quad** emitter draws when it has a texture that
 * is switched on, or -- for an effect placed `solid`, which is the hyperspace tunnel and nothing else
 * -- when it has no texture and no shader of its own, since that is the untextured quad the tunnel is
 * made of. Anything else draws nothing on its own account; it may still be kept for what its particles
 * carry, which is the caller's question because only the caller knows whether there is a host.
 */
export function emitterDrawn(e: DrawableEmitter, solid = false): boolean {
  const p = e.particle;
  if (!p) return false;
  if (p.type === 'mesh') return !!p.mesh?.file;
  const tex = p.type === 'quad' ? p.quad?.texture : undefined;
  if (tex?.file && tex.visible) return true;
  return !!solid && p.type === 'quad' && !tex?.shader;
}

/** Whether the effect will make this emitter at all: it draws, or its particles carry effects that do. */
export function emitterKept(e: DrawableEmitter, { solid = false, carries = false } = {}): boolean {
  if (e.visible === false) return false;
  return emitterDrawn(e, solid) || carries;
}
