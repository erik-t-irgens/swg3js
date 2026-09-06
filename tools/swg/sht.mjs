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
  return { main: main ? main.path : null, slots };
}
