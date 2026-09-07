// Shader effect (.eff) reader, following ShaderEffect / ShaderImplementation /
// ShaderImplementationPass loaders. We only need the first pass's render state:
//   FORM EFCT > 000N > DATA + FORM IMPL > 000N > [SCAP, OPTN] DATA + FORM PASS > 000N > DATA
// Pass DATA (versions 0005 and later, earlier ones share the prefix): int8 stages,
// int8 shadeMode, int8 fogMode, bool8 dither, bool8 zEnable, bool8 zWrite, int8 zCompare,
// bool8 alphaBlendEnable, int8 blendOp, int8 blendSrc, int8 blendDst, bool8 alphaTestEnable, ...
import { childrenOf, find, isForm } from './iff.mjs';

export function effectAlpha(root) {
  if (!isForm(root) || root.type !== 'EFCT') throw new Error(`Not an effect (got ${root.type ?? root.tag})`);
  const pass = find(root, 'PASS');
  if (!pass) return { alphaBlend: false, alphaTest: false, version: null };
  const version = pass.children.find(isForm);
  const data = version ? childrenOf(version, 'DATA')[0] : null;
  if (!version || !data || data.data.length < 12) return { alphaBlend: false, alphaTest: false, version: version?.type ?? null };
  return { alphaBlend: data.data[7] !== 0, alphaTest: data.data[11] !== 0, version: version.type };
}

export function alphaModeFor({ alphaBlend, alphaTest }) {
  if (alphaTest) return 'MASK';
  if (alphaBlend) return 'BLEND';
  return 'OPAQUE';
}
