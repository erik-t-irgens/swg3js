// Shader template (.sht) reader: enough to find the textures a mesh uses.
// FORM SSHT (optionally wrapped in FORM CSHD) contains FORM TXMS with one
// FORM TXM per texture slot: FORM 000x { DATA { uint32 tag, bool8 placeholder, ... }, NAME { dds path } }.
// The slot tag is written little-endian, so "MAIN" appears on disk as "NIAM".
import { childrenOf, findAll, readCString } from './iff.mjs';

function slotTag(data, version) {
  const off = version === '0000' ? 1 : 0;
  if (data.length < off + 4) return '????';
  return Buffer.from(data.subarray(off, off + 4)).reverse().toString('latin1');
}

/** Effect (.eff) path referenced by the shader, if any. */
export function shaderEffect(root) {
  for (const ssht of findAll(root, 'SSHT')) {
    for (const versionForm of ssht.children.filter((c) => c.tag === 'FORM')) {
      const name = childrenOf(versionForm, 'NAME')[0];
      if (name) return readCString(name.data).value;
    }
  }
  return null;
}

/**
 * Whether the effect uses the texture alpha for transparency. SWG keeps
 * specular and environment masks in the alpha channel of most diffuse maps,
 * so alpha only means cut-out or blending when the effect says so.
 */
export function effectAlphaMode(effect) {
  if (!effect) return 'OPAQUE';
  const e = effect.toLowerCase();
  if (/alpha|blend|transparen|glass|decal|foliage|leaf|leaves|fence|grate|wire/.test(e)) {
    return /blend|glass|transparen/.test(e) && !/atest|alphatest|cutout/.test(e) ? 'BLEND' : 'MASK';
  }
  return 'OPAQUE';
}

/** All texture slots of a shader, with the main (diffuse) slot resolved. */
export function shaderTextures(root) {
  const slots = [];
  for (const txm of findAll(root, 'TXM ')) {
    const versionForm = txm.children.find((c) => c.tag === 'FORM');
    if (!versionForm) continue;
    const data = childrenOf(versionForm, 'DATA')[0];
    const name = childrenOf(versionForm, 'NAME')[0];
    if (!data || !name) continue;
    slots.push({ slot: slotTag(data.data, versionForm.type), path: readCString(name.data).value });
  }
  const main = slots.find((s) => s.slot === 'MAIN') ?? slots.find((s) => !/^(NRML|DOT3|ENVM|CNRM|SPEC)$/.test(s.slot)) ?? slots[0] ?? null;
  return { main: main ? main.path : null, slots, effect: shaderEffect(root), alphaMode: effectAlphaMode(shaderEffect(root)) };
}
