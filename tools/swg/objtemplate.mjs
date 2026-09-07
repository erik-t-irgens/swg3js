// Object template (.iff) reader, following SharedObjectTemplate::load:
//   FORM <TYPE> > [FORM DERV > XXXX { cstring base template }] > FORM 00NN > PCNT { int32 n } + n x XXXX { cstring name, value }
// String values are int8 dataType (1 = SINGLE) then a cstring. Parameters not
// present are inherited from the base template chain.
import { childrenOf, isForm, readCString, parseIff } from './iff.mjs';
import { resolveToMesh } from './appearance.mjs';
import { parsePob } from './pob.mjs';

const SINGLE = 1;

export function readTemplate(root) {
  if (!isForm(root)) throw new Error('template root is not a FORM');
  let base = null;
  const params = new Map();
  for (const child of root.children) {
    if (!isForm(child)) continue;
    if (child.type === 'DERV') {
      const chunk = child.children.find((c) => !isForm(c));
      if (chunk) base = readCString(chunk.data).value.replace(/\\/g, '/');
      continue;
    }
    // Version form: PCNT then parameter chunks.
    for (const chunk of child.children) {
      if (isForm(chunk) || chunk.tag === 'PCNT') continue;
      const { value: name, next } = readCString(chunk.data);
      params.set(name, chunk.data.subarray(next));
    }
  }
  return { type: root.type, base, params };
}

export function stringParam(buf) {
  if (!buf || buf.length < 2 || buf[0] !== SINGLE) return null;
  return readCString(buf, 1).value.replace(/\\/g, '/');
}

/**
 * Resolve an object template to a static mesh path by following the DERV
 * chain for appearanceFilename, then unwrapping .pob (exterior cell), .apt and
 * .lod. Returns { mesh } or { skip: reason }.
 */
export function resolveTemplateMesh(vfs, templatePath, cache = new Map()) {
  if (cache.has(templatePath)) return cache.get(templatePath);
  let result;
  try {
    let appearance = null;
    let path = templatePath;
    let lastParams = [];
    for (let depth = 0; depth < 12 && path; depth++) {
      if (!vfs.has(path)) {
        // Server templates name their client twin; fall back to the shared_ naming convention.
        const guess = path.replace(/([^/]+)$/, 'shared_$1');
        if (path === templatePath && !/\/shared_[^/]+$/.test(path) && vfs.has(guess)) {
          path = guess;
          continue;
        }
        result = { skip: `template missing: ${path}` };
        break;
      }
      const t = readTemplate(parseIff(vfs.read(path)));
      lastParams = [...t.params.keys()];
      const a = stringParam(t.params.get('appearanceFilename'));
      if (a) {
        appearance = a;
        break;
      }
      // Server object templates link to the client template that holds the appearance.
      const shared = stringParam(t.params.get('sharedTemplate'));
      if (shared) {
        path = shared;
        continue;
      }
      if (!t.base) {
        const guess = templatePath.replace(/([^/]+)$/, 'shared_$1');
        if (path !== guess && vfs.has(guess)) {
          path = guess;
          continue;
        }
      }
      path = t.base;
    }
    if (!result) {
      if (!appearance) result = { skip: `no appearanceFilename (params: ${lastParams.slice(0, 6).join(', ') || 'none'})` };
      else result = resolveAppearanceToMesh(vfs, appearance);
    }
  } catch (err) {
    result = { skip: `error: ${err.message}` };
  }
  cache.set(templatePath, result);
  return result;
}

export function resolveAppearanceToMesh(vfs, appearance) {
  const lower = appearance.toLowerCase();
  if (lower.endsWith('.pob')) {
    if (!vfs.has(appearance)) return { skip: `pob missing: ${appearance}` };
    const pob = parsePob(parseIff(vfs.read(appearance)));
    const exterior = pob.cells[0]?.appearance;
    if (!exterior) return { skip: 'pob without exterior cell' };
    return resolveAppearanceToMesh(vfs, exterior);
  }
  if (lower.endsWith('.sat')) return { skip: 'skeletal appearance (.sat)' };
  if (lower.endsWith('.cmp')) return { skip: 'component appearance (.cmp)' };
  if (lower.endsWith('.prt')) return { skip: 'particle (.prt)' };
  if (!(lower.endsWith('.apt') || lower.endsWith('.lod') || lower.endsWith('.msh'))) return { skip: `appearance type ${lower.slice(lower.lastIndexOf('.'))}` };
  if (!vfs.has(appearance)) return { skip: `appearance missing: ${appearance}` };
  try {
    return { mesh: resolveToMesh(vfs, appearance) };
  } catch (err) {
    return { skip: `resolve failed: ${err.message}` };
  }
}
