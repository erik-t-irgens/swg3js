// Where every effect beyond the spine's own passes is registered on a new chain, before it warms
// its shaders. The game calls this once for each chain it builds, including the one built in the
// background when the Effects switch moves, so a chain always has every pass before its warm-up.
//
// Each effect adds its own field to `FxInstallDeps` and its own registration below. Every field is
// optional and belongs to one effect: an effect whose field is missing installs without it, or not
// at all, so a test may pass nothing.
import type { PostFX } from '../postfx';

export interface FxInstallDeps {
  // Nothing yet: each effect adds the one optional field it needs from the game here.
}

export function installEffects(_postfx: PostFX, _deps: FxInstallDeps = {}): void {
  // Nothing beyond the spine yet.
}
