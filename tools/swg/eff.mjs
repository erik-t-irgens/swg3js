// Shader effect (.eff) reader, following ShaderEffect / ShaderImplementation /
// ShaderImplementationPass loaders. We only need the first pass's render state:
//   FORM EFCT > 000N > DATA + FORM IMPL > 000N > [SCAP, OPTN] DATA + FORM PASS > 000N > DATA
// Pass DATA (versions 0005 and later, earlier ones share the prefix): int8 stages,
// int8 shadeMode, int8 fogMode, bool8 dither, bool8 zEnable, bool8 zWrite, int8 zCompare,
// bool8 alphaBlendEnable, int8 blendOp, int8 blendSrc, int8 blendDst, bool8 alphaTestEnable, ...
import { childrenOf, find, findAll, isForm } from './iff.mjs';

export function effectAlpha(root) {
  if (!isForm(root) || root.type !== 'EFCT') throw new Error(`Not an effect (got ${root.type ?? root.tag})`);
  let alphaBlend = false;
  let alphaTest = false;
  let version = null;
  // Check the first pass of every implementation: fixed-function and shader
  // implementations of the same effect can express the cut-out differently.
  for (const impl of findAll(root, 'IMPL')) {
    const pass = find(impl, 'PASS');
    if (!pass) continue;
    const v = pass.children.find(isForm);
    const data = v ? childrenOf(v, 'DATA')[0] : null;
    if (!v || !data || data.data.length < 12) continue;
    version = v.type;
    if (data.data[7] !== 0) alphaBlend = true;
    if (data.data[11] !== 0) alphaTest = true;
  }
  return { alphaBlend, alphaTest, version };
}

export function alphaModeFor({ alphaBlend, alphaTest }, effectName = '') {
  const name = effectName.toLowerCase();
  if (alphaTest || /punchout|atest|alphatest|cutout/.test(name)) return 'MASK';
  if (alphaBlend) return 'BLEND';
  return 'OPAQUE';
}
