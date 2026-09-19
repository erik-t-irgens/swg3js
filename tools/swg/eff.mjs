// Shader effect (.eff) reader, following ShaderEffect / ShaderImplementation /
// ShaderImplementationPass loaders. We only need the first pass's render state:
//   FORM EFCT > 000N > DATA + FORM IMPL > 000N > [SCAP, OPTN] DATA + FORM PASS > 000N > DATA
// Pass DATA (versions 0005 to 0009): int8 stages, int8 shadeMode, int8 fogMode, bool8 dither,
// bool8 zEnable, bool8 zWrite, int8 zCompare, bool8 alphaBlendEnable, int8 blendOp, int8 blendSrc,
// int8 blendDst, bool8 alphaTestEnable, ... From version 0010 a heat byte follows dither, and
// versions 0002 to 0004 start with a pixel-shader byte, so in both every field from zEnable on is one
// byte later. `passState` in surface.mjs reads them at the version's offsets.
import { isForm } from './iff.mjs';
import { passState } from './surface.mjs';

// alphaModeFor lives in surface.mjs (which does not import this file) and is re-exported here.
export { alphaModeFor } from './surface.mjs';

/** Whether any implementation's first pass blends or alpha-tests, read at its version's offsets. */
export function effectAlpha(root) {
  if (!isForm(root) || root.type !== 'EFCT') throw new Error(`Not an effect (got ${root.type ?? root.tag})`);
  const s = passState(root);
  return { alphaBlend: s?.anyBlend ?? false, alphaTest: s?.anyTest ?? false, version: s?.lastVersion ?? null };
}
