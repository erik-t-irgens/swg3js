// What a shader says about its surface beyond its main texture: flip-books (root SWTS, a list of
// textures, and SWSH, a list of whole shaders), texture scrolling (TSNS) where the effect's vertex
// program applies it, split alpha (colour and alpha scrolled apart from one texture), glow (unlit
// screens, additive effects, and textures lit toward themselves by a mask), and the effect pass read
// at the offsets its version uses. `surfaceTexture` turns all of it into the texture entry `glb.mjs`
// writes; everything else here is a pure function over parsed IFF nodes or RGBA images.
// eff.mjs imports this module and re-exports `alphaModeFor` from it; nothing here imports eff.mjs.
import { childOf, childrenOf, findAll, find, isForm, parseIff, readCString } from './iff.mjs';
import { shaderTextures } from './sht.mjs';
import { decodeNormalMap, normalLayoutOf } from '../../src/swg/normalDecode.ts';

/**
 * Manifests written by this code carry it; `status` asks for a run when a pack's is older.
 *
 * 2: animated and glowing surfaces.
 * 3: every surface wears the gloss map its own shader names rather than a guess from the colour
 *    texture's alpha, a baked shader carries the surface fields it was getting none of, and glass
 *    blends rather than being cut out.
 * 4: the detail map, with the coordinate set of its own that the meshes have always carried, and
 *    how much of a surface is a mirror read from the texture and channel its own program names
 *    rather than always from the colour texture's alpha.
 * 5: the same as 4, mended. Every pack written at 4 gave a roughness of nought -- a perfect mirror --
 *    to all 1,710 shaders that name a specular texture of their own, because the image the two masks
 *    are written into took its size from a field the gloss reader does not carry and came out one
 *    pixel of NaN. Nothing else about a 4 is wrong, but a pack cannot be mended in place, so the
 *    number moves and `status` asks for every one of them again.
 * 6: a normal map is decoded by the slot it sits in, as the client's own programs decode it, and is
 *    written only where the program reads one; the shine is the mask the program itself multiplies its
 *    specular by (`specMaskOf`), carried in the metal-rough image's red with the roughness worked out
 *    from it, and every textured material says what highlight the client drew (`extras.swgSpec`: the
 *    MATL's specular colour and power and whether the program bends it into a band) and whether its
 *    shader has a reflection cube at all (`extras.swgCube`), a material without one being no metal; a
 *    normal map on the second coordinate set is drawn on it. The commands that wrote materials and no
 *    stamp (space, sandbox, creatures, player, parts, species, spawns, travel) carry this from 6 on.
 *    Every pass of an effect is read for the shine and the normal map, not only its first.
 */
export const MATERIAL_FORMAT = 6;

/**
 * Whether the models a file's record stands for are older than this material format: the record a command
 * wrote beside them last time (a manifest, a travel.json), read back. No record, or one carrying no stamp,
 * is older. A command that keeps a model because its file is already there must ask this first, or a run
 * the stamp asked for writes the stamp over the very models it was asked to redo, and nothing asks again.
 */
export function materialStale(record) {
  return !(Number(record?.materialFormat ?? 1) >= MATERIAL_FORMAT);
}

/** The glTF alpha mode an effect's pass state gives (a cut-out effect by name is a MASK too). */
export function alphaModeFor({ alphaBlend, alphaTest }, effectName = '') {
  const name = effectName.toLowerCase();
  if (alphaTest || /punchout|atest|alphatest|cutout/.test(name)) return 'MASK';
  if (alphaBlend) return 'BLEND';
  return 'OPAQUE';
}

/** A slot tag as stored in a chunk: four bytes, little-endian ("NIAM" on disk is MAIN). */
function tagAt(buf, offset = 0) {
  if (!buf || buf.length < offset + 4) return '????';
  return Buffer.from(buf.subarray(offset, offset + 4)).reverse().toString('latin1');
}

const slashes = (p) => p.replace(/\\/g, '/');

/** A shader path as the archives key it: backslashes, case, and exporter paths (c:\a_exported\shader\x.sht -> shader/x.sht). */
export function shaderPathOf(raw) {
  let p = slashes(String(raw ?? '').trim()).toLowerCase();
  // An exporter's absolute path: the file lives under shader/ by its own name.
  if (/^[a-z]:\//.test(p) || p.includes('/a_exported/')) p = `shader/${p.slice(p.lastIndexOf('/') + 1)}`;
  return p.replace(/^\.?\/+/, '');
}

/**
 * Timing form (DTST, DRTS, DPPT, DFST, DRFS) -> { mode: 'time'|'random'|'pingpong'|'frame'|'randomFrame', count, seconds: [min, max] }.
 * DTST [s,s] 'time'; DRTS [min(a,b), max(a,b)] 'random'; DPPT [min(a,b), max(a,b)] 'pingpong';
 * DFST 'frame', DRFS 'randomFrame', both [1/30, 1/30]. The names are the client's switcher classes
 * (DeltaTimeSwitcher, DeltaRandomTimeSwitcher, DeltaPingPongSwitcher, DeltaFrameSwitcher,
 * DeltaRandomFrameSwitcher); DRFT (random frame, random time) is read as a random frame with its range.
 * Null for anything else.
 */
export function timingOf(form) {
  if (!form || !isForm(form)) return null;
  const data = form.children.find((c) => !isForm(c))?.data;
  if (!data || data.length < 4) return null;
  const count = data.readInt32LE(0);
  const f = (i) => (data.length >= 8 + i * 4 ? data.readFloatLE(4 + i * 4) : NaN);
  const range = () => {
    const a = f(0);
    const b = f(1);
    if (!Number.isFinite(a)) return null;
    if (!Number.isFinite(b)) return [a, a];
    return [Math.min(a, b), Math.max(a, b)];
  };
  const perFrame = 1 / 30;
  switch (form.type) {
    case 'DTST': {
      const s = f(0);
      return Number.isFinite(s) ? { mode: 'time', count, seconds: [s, s] } : null;
    }
    case 'DRTS': {
      const r = range();
      return r ? { mode: 'random', count, seconds: r } : null;
    }
    case 'DPPT': {
      const r = range();
      return r ? { mode: 'pingpong', count, seconds: r } : null;
    }
    case 'DFST':
      return { mode: 'frame', count, seconds: [perFrame, perFrame] };
    case 'DRFS':
      return { mode: 'randomFrame', count, seconds: [perFrame, perFrame] };
    case 'DRFT':
      return { mode: 'randomFrame', count, seconds: range() ?? [perFrame, perFrame] };
    default:
      return null;
  }
}

/**
 * Where a pass's render state sits in its DATA chunk, by pass version (texrender's parsePassData
 * reads the same): versions 2 to 4 start with a pixel-shader byte, and from version 10 a heat byte
 * follows dither, so in both every field from z-enable on is one byte later than in 5 to 9.
 */
function passOffsets(version) {
  if (version === 0) return { zWrite: 4, alphaBlend: 6 };
  if (version === 1) return { zWrite: 8, alphaBlend: 10 };
  const o = version <= 4 || version >= 10 ? 1 : 0;
  return { zWrite: 5 + o, alphaBlend: 7 + o };
}

function readPass(passForm) {
  const pv = passForm?.children.find(isForm);
  const data = pv ? childOf(pv, 'DATA')?.data : null;
  if (!pv || !data) return null;
  const version = Number.parseInt(pv.type, 10);
  if (!Number.isFinite(version)) return null;
  const at = passOffsets(version);
  const test = at.alphaBlend + 4;
  if (data.length <= test) return null;
  return {
    pv,
    version,
    zWrite: data[at.zWrite] !== 0,
    alphaBlend: data[at.alphaBlend] !== 0,
    blendOp: data.readInt8(at.alphaBlend + 1),
    blendSrc: data.readInt8(at.alphaBlend + 2),
    blendDst: data.readInt8(at.alphaBlend + 3),
    alphaTest: data[test] !== 0,
    // A zero tag names no reference: the test compares against 0.
    alphaRefTag: data.length >= test + 5 && data.readUInt32LE(test + 1) !== 0 ? tagAt(data, test + 1) : null,
  };
}

/** A pass's programs and the texture tag each sampler register carries (its own PTXM records). */
function passPrograms(pv) {
  const pvsh = childOf(pv, 'PVSH');
  const vchunk = pvsh?.children.find((c) => !isForm(c));
  const vertexProgram = vchunk ? slashes(readCString(vchunk.data).value).toLowerCase() || null : null;
  let pixelProgram = null;
  const samplers = {};
  const ppsh = childOf(pv, 'PPSH');
  if (ppsh) {
    const pf = ppsh.children.find(isForm) ?? ppsh;
    const data = childOf(pf, 'DATA')?.data;
    if (data && data.length > 1) pixelProgram = slashes(readCString(data, 1).value).toLowerCase() || null;
    for (const ptxm of childrenOf(pf, 'PTXM')) {
      const c = ptxm.children.find((x) => !isForm(x))?.data;
      if (c && c.length >= 5) samplers[c[0]] = tagAt(c, 1);
    }
  }
  return { vertexProgram, pixelProgram, samplers };
}

/**
 * The first implementation's first pass, read at the offsets for its version (the implementations are
 * listed best first, so this is the one a modern client runs), plus whether any implementation's first
 * pass blends or tests (the rule `effectAlpha` has always used). Null when no implementation has a pass.
 *
 * `passes` is every pass of that same implementation, the first included, each with its own programs and
 * its own samplers: a blended surface is often drawn twice, its colour first and its highlight in a second
 * pass added over it (the long hair, the glass, the lenses: `h_alpha_specmap_aniso`'s second pass is
 * `specmap_aniso_light_pass_ps20`), and the second pass's samplers are its own -- one light-pass program
 * reads its mask from SPEC under one effect and from MASK under another.
 *  -> { version, zWrite, alphaBlend, blendOp, blendSrc, blendDst, alphaTest, alphaRefTag, additive,
 *       anyBlend, anyTest, lastVersion, vertexProgram, pixelProgram, samplers: { [register]: tag },
 *       passes: [{ vertexProgram, pixelProgram, samplers }] }
 */
export function passState(efctRoot) {
  if (!isForm(efctRoot) || efctRoot.type !== 'EFCT') throw new Error(`Not an effect (got ${efctRoot?.type ?? efctRoot?.tag})`);
  let first = null;
  let firstImpl = null;
  let anyBlend = false;
  let anyTest = false;
  let lastVersion = null;
  for (const impl of findAll(efctRoot, 'IMPL')) {
    const p = readPass(find(impl, 'PASS'));
    if (!p) continue;
    if (!first) {
      first = p;
      firstImpl = impl;
    }
    lastVersion = String(p.pv.type);
    if (p.alphaBlend) anyBlend = true;
    if (p.alphaTest) anyTest = true;
  }
  if (!first) return null;
  const { pv, ...state } = first;
  const own = passPrograms(pv);
  const passes = [own];
  for (const form of findAll(firstImpl, 'PASS').slice(1)) {
    const later = form.children.find(isForm);
    if (later) passes.push(passPrograms(later));
  }
  // Additive: destination One under the add operation (0); e_particle_subtract (operation 2) darkens instead.
  return { ...state, additive: state.alphaBlend && state.blendDst === 1 && state.blendOp === 0, anyBlend, anyTest, lastVersion, ...own, passes };
}

/**
 * Which texcoord sets a vertex program moves by textureScroll: { set0: 'xy'|'zw'|null, set1: ... }.
 * Each statement that adds `textureScroll.<swizzle>` names the set it writes by the number its target ends in.
 */
export function scrollSets(vshText) {
  const out = { set0: null, set1: null };
  if (!vshText) return out;
  const text = vshText.replace(/\/\/[^\n]*/g, '');
  for (const stmt of text.split(';')) {
    const hit = /textureScroll(?!\w)(?:\s*\.\s*([xyzw]+))?/.exec(stmt);
    if (!hit || /register\s*\(/.test(stmt)) continue;
    // Two components move a texcoord pair; one (holonet's vertex offsets) is not a UV use.
    const swizzle = hit[1] ?? 'xy';
    if (swizzle !== 'xy' && swizzle !== 'zw') continue;
    const eq = stmt.indexOf('=');
    if (eq < 0 || eq > hit.index) continue;
    const target = stmt.slice(0, eq).replace(/[+\-*/]$/, '').trim();
    // The target must be a texture coordinate output (textureCoordinateSet1, tcs0, oT1, texcoord0).
    const coord = /(?:textureCoordinateSet|texcoord|tcs|tc|oT)(\d*)\s*(?:\.[xyzw]+)?$/i.exec(target);
    if (!coord) continue;
    const set = coord[1] ? Number(coord[1]) : 0;
    if (set === 0 && !out.set0) out.set0 = swizzle;
    else if (set === 1 && !out.set1) out.set1 = swizzle;
  }
  return out;
}

/** The pixel program takes RGB from sampler 0 and alpha from sampler 1, both on the same tag (a_splitalpha). */
export function isSplitAlpha(pixelName, pixelText, samplers) {
  const s0 = samplers?.[0];
  if (!s0 || s0 !== samplers?.[1]) return false;
  const text = (pixelText ?? '').replace(/\/\/[^\n]*/g, '');
  // ps.1.x: the colour from t0, the alpha from t1's alpha.
  const asm = /r0\.rgb\s*,\s*t0\b/.test(text) && /r0\.a\s*,\s*t1\.a\b/.test(text);
  return asm || /splitalpha/i.test(pixelName ?? '');
}

/** The slot a sampler variable most likely reads, when its register is not declared in the program. */
function slotByVariable(name) {
  const n = name.toLowerCase();
  if (/spec/.test(n)) return 'SPEC';
  if (/emis/.test(n)) return 'EMIS';
  if (/normal|nrml|bump/.test(n)) return 'NRML';
  return 'MAIN';
}

/**
 * How an effect glows (table 3.5 of the design): null | { kind: 'full' } | { kind: 'add' } |
 * { kind: 'mask', slot: 'MAIN'|'EMIS'|'NRML'|'SPEC', channel: 'a'|'rgb' }.
 * HLSL programs are read for the `emisMask`/`emisMap` assignment and the sampler it samples, directly or
 * through the local most recently read before it (its register gives the tag); assembly for the first
 * `lrp rN.rgb, tK.a, tJ` whose tJ is on MAIN (sampler K's tag); otherwise the name decides.
 */
export function emissiveOf(effectName, pixelText, samplers) {
  const name = slashes(effectName ?? '').toLowerCase().replace(/^.*\//, '');
  const text = (pixelText ?? '').replace(/\/\/[^\n]*/g, '');
  if (/emisadd/.test(name)) return { kind: 'add' };
  if (/emis_?full/.test(name)) return { kind: 'full' };
  // Assembly: the lit colour lerps toward the texture itself (a sampler on MAIN) by a sampler's alpha.
  // An lrp toward the environment cube (ENVM, the envmask programs) is an environment mask, not a glow.
  let lrpGlow = null;
  for (const m of text.matchAll(/\blrp\s+r\d+\.rgb\s*,\s*t(\d+)\.a\s*,\s*t(\d+)\b/g)) {
    if (samplers?.[Number(m[2])] === 'MAIN') {
      lrpGlow = m;
      break;
    }
  }
  const hasEmisCode = /\bemis(?:Mask|Map)\s*=/.test(text) || !!lrpGlow;
  if (!/emis/.test(name) && !hasEmisCode) {
    // An unnamed (inline) effect: an additive program writes no alpha, an unlit one no light.
    if (/result\.a\s*=\s*0(?:\.0)?f?\s*;/.test(text) && /result\.rgb\s*=\s*tex2D/.test(text)) return { kind: 'add' };
    return null;
  }
  // HLSL: sampler variables to tags by their declared registers, locals to the samplers they read.
  const bySampler = new Map();
  for (const m of text.matchAll(/sampler\w*\s+(\w+)\s*:\s*register\s*\(\s*s(\d+)\s*\)/g)) {
    const tag = samplers?.[Number(m[2])];
    if (tag) bySampler.set(m[1], tag);
  }
  const slotOf = (samplerVar) => bySampler.get(samplerVar) ?? slotByVariable(samplerVar);
  const assign = /\bemis(?:Mask|Map)\s*=\s*([^;]+);/.exec(text);
  if (assign) {
    const rhs = assign[1];
    const direct = /tex2D\w*\s*\(\s*(\w+)[^)]*\)\s*\.\s*(rgb|a)\b/.exec(rhs);
    if (direct) return { kind: 'mask', slot: slotOf(direct[1]), channel: direct[2] };
    const viaLocal = /\b(\w+)\s*\.\s*(rgb|a)\b/.exec(rhs);
    if (viaLocal) {
      // The nearest read before the assignment: a program may reuse one local name in separate blocks
      // (a_specmap_bump_emismap reads `sample` from the diffuse map, then from the normal map for the mask).
      const reads = [...text.slice(0, assign.index).matchAll(new RegExp(`\\b${viaLocal[1]}\\s*=\\s*tex2D\\w*\\s*\\(\\s*(\\w+)`, 'g'))];
      if (reads.length) return { kind: 'mask', slot: slotOf(reads[reads.length - 1][1]), channel: viaLocal[2] };
    }
  }
  if (lrpGlow) return { kind: 'mask', slot: samplers?.[Number(lrpGlow[1])] ?? 'MAIN', channel: 'a' };
  if (/emismap/.test(name)) return { kind: 'mask', slot: 'MAIN', channel: 'a' };
  return null;
}

/**
 * Which texture and channel the environment mask comes from: null, or { slot, channel }.
 *
 * The client's envmask programs all end the same way -- `result.rgb = lerp(diffuseLitSurface,
 * envColor, envMask) + allSpecularLight` -- so `envMask` is how much of a surface is a mirror, and
 * in three's terms it is metalness with the scene's environment behind it. What differs, and what
 * cost this a real bug, is **where the mask comes from**:
 *
 *   a_envmask_specmap     envMask = tex2D(diffuseMap, tcs_MAIN).a          -- MAIN's alpha
 *   h_color2_envmask_*    envMask = tex2D(specular_envMap, tcs_MAIN).a     -- the MASK slot's alpha,
 *                         while MAIN's alpha is the *hue* mask for the two-tone customizing
 *
 * Read as MAIN's alpha everywhere, the whole hue family had a two-tone shape mask standing in for
 * its shininess -- which has nothing to do with it, and made a customizable armour piece mirror-
 * bright wherever its second colour happened to be.
 *
 * So it is read out of the program, exactly as `emissiveOf` reads the glow's, and falls back on
 * MAIN's alpha only for a shader whose program the archives lack.
 */
export function envMaskOf(pixelText, samplers) {
  const text = (pixelText ?? '').replace(/\/\/[^\n]*/g, '');
  // ENVM is the usual name for the cube a surface reflects; IRID is the same thing on the fourteen
  // iridescent shaders, which are drawn by the envmask programs with that slot bound to `envMap`.
  const isCube = (slot) => slot === 'ENVM' || slot === 'IRID';
  // Assembly (the whole `c_` family is ps.1.1): the lit colour lerps toward the environment cube by
  // a sampler's alpha, `lrp r0, t0.a, t1, r0` with t1 on ENVM. It is the mirror of the glow reader's
  // own assembly branch, which looks for an lrp toward MAIN instead, and the two must not be
  // confused: one is a sign that lights itself, the other is chrome.
  for (const m of text.matchAll(/\blrp\s+r\d+(?:\.\w+)?\s*,\s*t(\d+)\.a\s*,\s*t(\d+)\b/g)) {
    if (isCube(samplers?.[Number(m[2])])) return { slot: samplers?.[Number(m[1])] ?? 'MAIN', channel: 'a' };
  }
  // The same lerp with the mask taken through a register rather than straight off a sampler
  // (`mov r0, t0` then `lrp r0.rgb, r0.w, t1, r0`, which is the plainest of the palette effects):
  // the nearest move into that register before the lerp says which texture it really is.
  for (const m of text.matchAll(/\blrp\s+r\d+(?:\.\w+)?\s*,\s*r(\d+)\.[wa]\s*,\s*t(\d+)\b/g)) {
    if (!isCube(samplers?.[Number(m[2])])) continue;
    const moves = [...text.slice(0, m.index).matchAll(new RegExp(`\\bmov\\s+r${m[1]}(?:\\.\\w+)?\\s*,\\s*t(\\d+)\\b`, 'g'))];
    const from = moves.length ? samplers?.[Number(moves[moves.length - 1][1])] : undefined;
    return { slot: from ?? 'MAIN', channel: 'a' };
  }
  if (!/\benvMask\s*=/.test(text)) return null;
  const bySampler = new Map();
  for (const m of text.matchAll(/sampler\w*\s+(\w+)\s*:\s*register\s*\(\s*s(\d+)\s*\)/g)) {
    const tag = samplers?.[Number(m[2])];
    if (tag) bySampler.set(m[1], tag);
  }
  const slotOf = (v) => bySampler.get(v) ?? slotByVariable(v);
  const assign = /\benvMask\s*=\s*([^;]+);/.exec(text);
  if (!assign) return null;
  const rhs = assign[1];
  const direct = /tex(?:2D|CUBE)\w*\s*\(\s*(\w+)[^)]*\)\s*\.\s*(rgb|a)\b/.exec(rhs);
  if (direct) return { slot: slotOf(direct[1]), channel: direct[2] };
  const viaLocal = /\b(\w+)\s*\.\s*(rgb|a)\b/.exec(rhs);
  if (viaLocal) {
    // The nearest read before the assignment, for the same reason the glow's reader needs it: the
    // hue programs declare `sample` twice, once from the diffuse map and once from the mask.
    const reads = [...text.slice(0, assign.index).matchAll(new RegExp(`\\b${viaLocal[1]}\\s*=\\s*tex2D\\w*\\s*\\(\\s*(\\w+)`, 'g'))];
    if (reads.length) return { slot: slotOf(reads[reads.length - 1][1]), channel: viaLocal[2] };
  }
  return null;
}

/** Whether a program's own source is the HLSL kind (its first line says `//hlsl`) rather than ps.1.x assembly. */
const isHlsl = (source) => /^\s*\/\/\s*hlsl\b/i.test(source ?? '');
const isAsm = (source) => /^\s*ps\.\d/i.test((source ?? '').replace(/^(\s*\/\/[^\n]*\n)*/, ''));

/** HLSL sampler variables to the slots their registers carry, as the glow's and the mirror's readers map them. */
function samplerSlots(text, samplers) {
  const out = new Map();
  for (const m of text.matchAll(/sampler\w*\s+(\w+)\s*:\s*register\s*\(\s*s(\d+)\s*\)/g)) {
    const tag = samplers?.[Number(m[2])];
    if (tag) out.set(m[1], tag);
  }
  return out;
}

/** The sampler the nearest read of `local` before `at` took (a program may reuse one local name block by block). */
function nearestRead(text, local, at) {
  const reads = [...text.slice(0, at).matchAll(new RegExp(`\\b${local}\\s*=\\s*tex2D\\w*\\s*\\(\\s*(\\w+)`, 'g'))];
  return reads.length ? reads[reads.length - 1][1] : null;
}

/** A swizzle as the channel a scalar takes: `.a`/`.w` the alpha; `.rgb`, `.r` or a bare register the first component. */
const channelOf = (swizzle) => (/^[aw]$/.test(swizzle ?? '') ? 'a' : /^[gy]$/.test(swizzle ?? '') ? 'g' : /^[bz]$/.test(swizzle ?? '') ? 'b' : 'r');

/**
 * Which texture and channel a pixel program multiplies its specular by -- the shine's mask -- read the way
 * `envMaskOf` reads the mirror's and `emissiveOf` the glow's:
 *
 *   null                                   the program cannot be read (none named, not in the archives, or
 *                                          a shape this does not know), so the old rule stands for it
 *   { kind: 'none' }                       the program draws no specular at all
 *   { kind: 'unmasked', aniso }            a specular with nothing over it: the mask is one
 *   { kind: 'mask', slot, channel, aniso, squared }
 *
 * Why it is read rather than guessed from names and alphas: measured over the shaders the game uses, the
 * mask is SPEC's alpha on 2,428 (not its luminance, which is what was read), MAIN's alpha on 1,473, NRML's
 * alpha on 445 -- the whole two-tone cloth family, whose MAIN alpha is the hue mask -- MASK's red on 173,
 * MASK's alpha on 9 and DTLA's on 7; 196 are unmasked and 6,089 have no specular term at all. 2,099 of them
 * read another file or channel than the converter took, which is why shirts glinted in stripes.
 *
 * HLSL: the last `specularMask = ...` and the sampler it reads, directly or through the nearest read of the
 * local it names (a float set from `.rgb` keeps the first component, so those read red). `aniso` where the
 * program calls the client's band function; `squared` where the mask is in the specular already and the
 * result multiplies it in again (`allSpecularLight * specularMask`). Assembly: the vertex specular (`v1`)
 * or the specular constants followed through the registers to the first texture they are multiplied by,
 * a lookup (a `texm3x*tex` result or an LKUP table) being part of the specular and never its mask.
 */
export function specMaskOf(source, samplers) {
  if (typeof source !== 'string') return null;
  const text = source.replace(/\/\/[^\n]*/g, '');
  if (isHlsl(source)) {
    if (!/\ballSpecularLight\w*\b|\bmaterialSpecularPower\b|calculateFakeAnisotropicSpecularLighting/.test(text)) return { kind: 'none' };
    const aniso = /calculateFakeAnisotropicSpecularLighting\s*\(/.test(text);
    const assigns = [...text.matchAll(/\bspecularMask\s*=\s*([^;]+);/g)];
    if (!assigns.length) return /\ballSpecularLight\w*\s*=/.test(text) ? { kind: 'unmasked', aniso } : null;
    const assign = assigns[assigns.length - 1];
    const maskedInside = /\ballSpecularLight\w*\s*=[^;]*\bspecularMask\b/.test(text);
    const maskedAgain = /\ballSpecularLight\s*\*\s*specularMask\b/.test(text);
    const squared = maskedInside && maskedAgain;
    const slots = samplerSlots(text, samplers);
    const slotOf = (v) => slots.get(v) ?? slotByVariable(v);
    const rhs = assign[1];
    const direct = /tex2D\w*\s*\(\s*(\w+)[^)]*\)\s*\.\s*(\w+)/.exec(rhs);
    if (direct) return { kind: 'mask', slot: slotOf(direct[1]), channel: channelOf(direct[2]), aniso, squared };
    const via = /\b(\w+)\s*\.\s*(\w+)\b/.exec(rhs);
    const from = via ? nearestRead(text, via[1], assign.index) : null;
    if (from) return { kind: 'mask', slot: slotOf(from), channel: channelOf(via[2]), aniso, squared };
    return null;
  }
  if (!isAsm(text)) return null;
  // Assembly. A texture register that is a lookup holds part of the lighting and is never a mask.
  // A co-issued instruction is written on a line of its own after a `+`, or after it on the same line.
  const lines = text.split(/\r?\n/).map((l) => l.replace(/;.*$/, '').replace(/^\s*\+\s*/, '').trim()).filter(Boolean);
  const lookups = new Set();
  for (const l of lines) {
    const m = /^texm3x[23](?:tex|spec|vspec)\s+t(\d+)/i.exec(l);
    if (m) lookups.add(Number(m[1]));
  }
  for (const [r, tag] of Object.entries(samplers ?? {})) if (tag === 'LKUP') lookups.add(Number(r));
  const specRegs = new Set();
  const regOf = (s) => s.replace(/^-/, '').replace(/_bx2|_bias|_x2/g, '').split('.')[0];
  const specish = (s) => {
    const r = regOf(s);
    if (r === 'v1' || /^c\[(dot3LightSpecularColor|materialSpecularColor)\]$/.test(r)) return true;
    if (specRegs.has(r)) return true;
    const t = /^t(\d+)$/.exec(r);
    return !!t && lookups.has(Number(t[1])) && /\.[aw]$/.test(s);
  };
  const candidate = (s) => {
    const t = /^t(\d+)$/.exec(regOf(s));
    if (!t || lookups.has(Number(t[1]))) return null;
    return { register: Number(t[1]), channel: channelOf(s.split('.')[1]) };
  };
  let any = false;
  let mask = null;
  for (const l of lines) {
    const m = /^([a-z0-9_]+)\s+([^,\s]+)\s*,\s*(.+)$/i.exec(l);
    if (!m) continue;
    const op = m[1].toLowerCase().replace(/_(sat|x2|x4|d2)$/, '');
    if (!['mul', 'mad', 'add', 'sub', 'mov', 'lrp'].includes(op)) continue;
    const dst = regOf(m[2]);
    const src = m[3].split(',').map((s) => s.trim());
    const hot = src.map(specish);
    if (!hot.some(Boolean)) {
      specRegs.delete(dst);
      continue;
    }
    any = true;
    if (!mask && (op === 'mul' || op === 'mad')) {
      const [a, b] = [src[0], src[1]];
      const other = hot[0] && !hot[1] ? candidate(b) : hot[1] && !hot[0] ? candidate(a) : null;
      if (other) mask = other;
    }
    if (op !== 'lrp' || hot[1] || hot[2]) specRegs.add(dst);
  }
  if (!any) return { kind: 'none' };
  if (!mask) return { kind: 'unmasked', aniso: false };
  return { kind: 'mask', slot: samplers?.[mask.register] ?? null, channel: mask.channel, aniso: false, squared: false };
}

/**
 * Which slot a pixel program reads a normal map from, and how: null when it cannot be read (the old rule
 * stands), `{ kind: 'none' }` when it reads none, `{ kind: 'read', slot, layout }` otherwise. `layout` is
 * what the program does to it (`tex2DDxt5CompressedNormal` compressed, `signAndBias` or `_bx2` plain), which
 * over the retail archives is always what the slot says (`normalLayoutOf`); the converter decodes by the
 * slot and the test holds the two to each other. One program, one pass: `describeStatic` asks it of every
 * pass of the implementation (`firstPassThat`). 533 retail shaders name a normal map no pass reads, nearly
 * all of them the ground's dot3 shaders, whose program samples the map and never uses it; those carry none.
 */
export function normalReadOf(source, samplers) {
  if (typeof source !== 'string') return null;
  const text = source.replace(/\/\/[^\n]*/g, '');
  if (isHlsl(source)) {
    const slots = samplerSlots(text, samplers);
    const slotOf = (v) => slots.get(v) ?? slotByVariable(v);
    let m = /tex2DDxt5CompressedNormal\w*\s*\(\s*(\w+)/.exec(text);
    if (m) return { kind: 'read', slot: slotOf(m[1]), layout: 'compressed' };
    m = /signAndBias\s*\(\s*tex2D\w*\s*\(\s*(\w+)/.exec(text);
    if (m) return { kind: 'read', slot: slotOf(m[1]), layout: 'plain' };
    m = /signAndBias\s*\(\s*(\w+)\s*\.\s*(?:rgb|xyz)\s*\)/.exec(text);
    if (m) {
      const from = nearestRead(text, m[1], m.index);
      if (from) return { kind: 'read', slot: slotOf(from), layout: 'plain' };
    }
    return { kind: 'none' };
  }
  if (!isAsm(text)) return null;
  const m = /\btexm3x[23](?:pad|tex)\s+t\d+\s*,\s*t(\d+)_bx2/i.exec(text) ?? /\bdp3\w*\s+r\d+\s*,\s*t(\d+)_bx2\s*,\s*(?!t\1_bx2)/i.exec(text);
  return m ? { kind: 'read', slot: samplers?.[Number(m[1])] ?? null, layout: 'plain' } : { kind: 'none' };
}

/**
 * A shader's material (FORM MATS > version > TAG + MATL, the MAIN-tagged one, else the first): its
 * specular colour, the fourth of the MATL's four ARGB groups read as RGB, and its power, the seventeenth
 * float. The client's programs draw the highlight as that colour times the mask times (N·H) to that power
 * (`materialSpecularColor`, `materialSpecularPower`); 4,723 of the 4,726 the game uses have that group's
 * alpha at one. Null when the shader has none (five screens the game uses).
 */
export function materialOf(root) {
  const tagOf = (data) => (data && data.length >= 4 ? Buffer.from(data.subarray(0, 4)).reverse().toString('latin1') : null);
  let first = null;
  for (const mats of findAll(root, 'MATS')) {
    const v = mats.children.find(isForm) ?? mats;
    const tags = findAll(v, 'TAG ');
    const list = findAll(v, 'MATL');
    for (let i = 0; i < list.length; i++) {
      const b = list[i].data;
      if (!b || b.length < 68) continue;
      const f = (n) => Math.round(b.readFloatLE(n * 4) * 1e4) / 1e4;
      const got = { color: [f(13), f(14), f(15)], power: f(16) };
      if (!got.color.every(Number.isFinite) || !Number.isFinite(got.power)) continue;
      if (tagOf(tags[i]?.data) === 'MAIN') return got;
      first ??= got;
    }
  }
  return first;
}

/** A program file's own source: its PSRC chunk where it is an IFF (every retail .psh is), else the file as text. */
export function programSource(bytes) {
  if (!bytes) return null;
  try {
    const root = parseIff(bytes);
    const c = findAll(root, 'PSRC')[0] ?? findAll(root, 'VSRC')[0];
    if (c) return Buffer.from(c.data).toString('latin1').replace(/\0+$/, '');
  } catch {
    // Not an IFF: the file is the text.
  }
  return Buffer.from(bytes).toString('latin1');
}

/** Records of a shader's TSNS / ARVS / TCSS form: tag -> values. */
function records(v, formName, size, read) {
  const out = new Map();
  const f = childOf(v, formName);
  const data = f?.children.find((c) => !isForm(c))?.data;
  if (!data) return out;
  for (let o = 0; o + size <= data.length; o += size) out.set(tagAt(data, o), read(data, o + 4));
  return out;
}

const blank = (shader) => ({
  kind: null,
  shader,
  base: undefined,
  effect: null,
  inline: false,
  main: null,
  mainSlot: null,
  textures: [],
  pass: null,
  alphaRef: 0,
  scroll: null,
  split: false,
  emissive: null,
  envMask: null,
  // What the pixel program does with a specular mask and a normal map (`specMaskOf`, `normalReadOf`; null
  // where there is no program to read or it could not be read), and the shader's MATL (`materialOf`).
  specMask: null,
  normalRead: null,
  material: null,
  anim: null,
  timing: null,
  flip: null,
  programs: { vertex: null, pixel: null },
  records: { scroll: {}, alphaRefs: {}, texcoordSets: {} },
  notes: [],
});

/** A program's source text, read once per cache. */
function programText(vfs, path, cache) {
  if (!path) return null;
  const key = `\0program:${path}`;
  if (!cache.has(key)) cache.set(key, vfs.has(path) ? vfs.read(path).toString('latin1') : null);
  return cache.get(key);
}

/** A program's own source (its PSRC chunk), read once per cache; null when there is no such file. */
function programSourceOf(vfs, path, cache) {
  if (!path) return null;
  const key = `\0source:${path}`;
  if (!cache.has(key)) cache.set(key, vfs.has(path) ? programSource(vfs.read(path)) : null);
  return cache.get(key);
}

/**
 * What the passes of one implementation say together, out of what each says alone (`specMaskOf` or
 * `normalReadOf` per pass, in order): the first pass that draws the thing, read through its own samplers;
 * failing that, nothing, but only when every pass could be read -- a pass whose program cannot be read may be
 * the one that draws it, so the answer is then null and the old rule stands, as it does for a first pass
 * that cannot be read.
 */
export function firstPassThat(perPass, draws) {
  const hit = perPass.find((r) => r && draws(r));
  if (hit) return hit;
  return perPass.every(Boolean) ? perPass[0] ?? null : null;
}

/** An effect file's pass state, read once per cache. */
function effectState(vfs, path, cache) {
  const key = `\0effect:${path.toLowerCase()}`;
  if (!cache.has(key)) {
    let state = null;
    let note = null;
    try {
      if (vfs.has(path)) state = passState(parseIff(vfs.read(path)));
      else note = `effect ${path} not in the archives`;
    } catch (err) {
      note = `effect ${path} unreadable: ${err.message}`;
    }
    cache.set(key, { state, note });
  }
  return cache.get(key);
}

function describeStatic(vfs, ssht, out, cache) {
  const v = ssht.children.find(isForm);
  if (!v) return out;
  const nameChunk = childOf(v, 'NAME');
  const inline = childOf(v, 'EFCT');
  const t = shaderTextures(ssht);
  out.main = t.main;
  out.textures = t.slots.map((s) => ({ slot: s.slot, path: s.path }));
  out.mainSlot = t.slots.find((s) => s.path === t.main)?.slot ?? null;
  out.effect = nameChunk ? slashes(readCString(nameChunk.data).value) || null : null;
  out.inline = !nameChunk && !!inline;
  if (out.inline) {
    try {
      out.pass = passState(inline);
    } catch (err) {
      out.notes.push(`inline effect unreadable: ${err.message}`);
    }
  } else if (out.effect) {
    const e = effectState(vfs, out.effect, cache);
    out.pass = e.state;
    if (e.note) out.notes.push(e.note);
  }
  const scrolls = records(v, 'TSNS', 20, (d, o) => [0, 1, 2, 3].map((i) => Math.round(d.readFloatLE(o + i * 4) * 1e4) / 1e4));
  const refs = records(v, 'ARVS', 5, (d, o) => d[o]);
  const coordSets = records(v, 'TCSS', 5, (d, o) => d[o]);
  out.records = { scroll: Object.fromEntries(scrolls), alphaRefs: Object.fromEntries(refs), texcoordSets: Object.fromEntries(coordSets) };
  out.alphaRef = out.pass?.alphaRefTag ? (refs.get(out.pass.alphaRefTag) ?? 0) : 0;
  out.material = materialOf(ssht);
  const pass = out.pass;
  if (!pass) return out;
  out.programs = { vertex: pass.vertexProgram, pixel: pass.pixelProgram };
  const vsh = programText(vfs, pass.vertexProgram, cache);
  const psh = programText(vfs, pass.pixelProgram, cache);
  out.split = isSplitAlpha(pass.pixelProgram, psh, pass.samplers);
  out.emissive = emissiveOf(out.effect ?? (out.inline ? '' : pass.pixelProgram), psh, pass.samplers);
  out.envMask = envMaskOf(psh, pass.samplers);
  // Read from the program's own source rather than the file's bytes, since whether it is HLSL is in its
  // first line. A fixed-function pass names no program and is left to the old rules.
  //
  // **Every pass of the implementation, not only the first**, each through its own samplers: 83 of the
  // shaders the packs use are drawn in two passes, and on about 77 of them the highlight is the second
  // pass's alone (most of the long hairstyles, the glass, the lenses, the bacta gels), the first drawing the
  // blended colour and the second adding the light over it; one membrane reads its normal map only in its
  // second. Read off the first pass alone, all of those were written as drawing no highlight at all.
  const reads = (pass.passes ?? [pass]).map((p) => {
    const source = programSourceOf(vfs, p.pixelProgram, cache);
    return { spec: specMaskOf(source, p.samplers), normal: normalReadOf(source, p.samplers) };
  });
  out.specMask = firstPassThat(reads.map((r) => r.spec), (s) => s.kind !== 'none');
  out.normalRead = firstPassThat(reads.map((r) => r.normal), (n) => n.kind === 'read');
  const sets = scrollSets(vsh);
  const rates = scrolls.get(out.mainSlot ?? 'MAIN') ?? scrolls.get('MAIN');
  if (rates && sets.set0 === 'xy') {
    const alpha = out.split && sets.set1 === 'zw' && (rates[2] || rates[3]) ? [rates[2], rates[3]] : null;
    if (rates[0] || rates[1] || alpha) out.scroll = { map: [rates[0], rates[1]], alpha };
  }
  return out;
}

/**
 * Everything a shader file says about its surface, following SWTS and SWSH to their base (depth <= 3).
 *  -> { kind: 'SSHT'|'CSHD'|'SWTS'|'SWSH'|'OPST'|null, shader, base?, effect: string|null, inline: boolean,
 *       main: string|null, mainSlot, textures: [{ slot, path }], pass, alphaRef, scroll: { map: [u,v], alpha: [u,v]|null }|null,
 *       split: boolean, emissive, anim: { mode, seconds, frames: [path], missing: [path] }|null,
 *       timing, flip: { frames, missing: [path] }|null, programs: { vertex, pixel }, notes: [string] }
 * `anim` is null whenever a frame is missing (`flip.missing` names them); frame 1, if present, is still the main.
 */
export function describeSurface(vfs, shaderPath, cache = new Map(), depth = 0) {
  const key = shaderPathOf(shaderPath);
  if (cache.has(key)) return cache.get(key);
  const out = blank(key);
  if (!vfs.has(key)) {
    out.notes.push(`${key} not in the archives`);
    cache.set(key, out);
    return out;
  }
  const root = parseIff(vfs.read(key));
  out.kind = root.type;
  if (root.type === 'SWTS') describeTextureFlip(vfs, root, out, cache, depth);
  else if (root.type === 'SWSH') describeShaderFlip(vfs, root, out, cache, depth);
  else {
    const ssht = root.type === 'SSHT' ? root : findAll(root, 'SSHT')[0];
    if (ssht) describeStatic(vfs, ssht, out, cache);
    else {
      const t = shaderTextures(root);
      out.main = t.main;
      out.textures = t.slots.map((s) => ({ slot: s.slot, path: s.path }));
      out.mainSlot = t.slots.find((s) => s.path === t.main)?.slot ?? null;
    }
  }
  cache.set(key, out);
  return out;
}

/** Copy a described base into a flip-book's own description, arrays included. */
function adopt(out, base) {
  for (const k of ['effect', 'inline', 'main', 'mainSlot', 'pass', 'alphaRef', 'scroll', 'split', 'emissive', 'envMask', 'specMask', 'normalRead', 'material', 'programs', 'records']) out[k] = base[k];
  out.textures = base.textures.map((t) => ({ ...t }));
  out.notes.push(...base.notes);
}

function describeTextureFlip(vfs, root, out, cache, depth) {
  const v = root.children.find(isForm);
  if (!v) return;
  const nameChunk = childOf(v, 'NAME');
  const basePath = nameChunk ? shaderPathOf(readCString(nameChunk.data).value) : null;
  const timing = timingOf(v.children.find((c) => isForm(c) && c.type.startsWith('D')));
  out.timing = timing;
  const texts = childrenOf(v, 'TEXT').map((c) => ({ slot: tagAt(c.data, 0), path: readCString(c.data, 4).value }));
  out.base = basePath ?? undefined;
  if (basePath && depth < 3) {
    const base = describeSurface(vfs, basePath, cache, depth + 1);
    adopt(out, base);
    if (!base.kind) out.notes.push(`base ${basePath} not in the archives`);
  } else if (basePath) out.notes.push(`base ${basePath} is nested too deep`);
  if (!texts.length) {
    out.notes.push('a flip-book with no frames');
    return;
  }
  const baseSlot = out.mainSlot ?? 'MAIN';
  const frameSlot = texts[0].slot;
  const missing = texts.filter((t) => !vfs.has(t.path)).map((t) => t.path);
  out.flip = { frames: texts.length, missing };
  if (frameSlot !== baseSlot) {
    out.notes.push(`frames in slot ${frameSlot}, not the base's main ${baseSlot}: not animated`);
    return;
  }
  // Frame 1 replaces the base's main, in the texture list too, whether or not the rest are there.
  out.main = vfs.has(texts[0].path) ? texts[0].path : null;
  out.mainSlot = frameSlot;
  const i = out.textures.findIndex((t) => t.slot === frameSlot);
  if (i >= 0) out.textures[i] = { slot: frameSlot, path: texts[0].path };
  else out.textures.unshift({ slot: frameSlot, path: texts[0].path });
  if (missing.length) {
    out.notes.push(`${missing.length} of ${texts.length} frames missing: not animated`);
    return;
  }
  if (!timing) {
    out.notes.push('a timing form this converter does not know: not animated');
    return;
  }
  if (texts.length < 2) return;
  if (out.scroll) {
    out.notes.push('flip-book over a scrolling base: scroll ignored');
    out.scroll = null;
  }
  out.anim = { mode: timing.mode, seconds: timing.seconds, frames: texts.map((t) => t.path), missing: [] };
}

function describeShaderFlip(vfs, root, out, cache, depth) {
  const v = root.children.find(isForm);
  if (!v) return;
  const timing = timingOf(v.children.find((c) => isForm(c) && c.type.startsWith('D')));
  out.timing = timing;
  const names = childrenOf(v, 'NAME').map((c) => shaderPathOf(readCString(c.data).value));
  const present = names.filter((n) => vfs.has(n));
  out.flip = { frames: names.length, missing: names.filter((n) => !vfs.has(n)) };
  if (!present.length) {
    out.notes.push(`0/${names.length} frame shaders in the archives`);
    return;
  }
  if (depth >= 3) {
    out.notes.push('frame shaders nested too deep');
    return;
  }
  const frames = names.map((n) => (vfs.has(n) ? describeSurface(vfs, n, cache, depth + 1) : null));
  const first = frames.find(Boolean);
  out.base = first.shader;
  adopt(out, first);
  if (present.length < names.length) {
    out.notes.push(`${names.length - present.length} of ${names.length} frame shaders missing: not animated`);
    return;
  }
  if (!timing) {
    out.notes.push('a timing form this converter does not know: not animated');
    return;
  }
  if (frames.some((f) => f.effect !== first.effect || f.inline !== first.inline)) {
    out.notes.push('frame shaders use different effects: not animated');
    return;
  }
  if (frames.some((f) => !f.main || !vfs.has(f.main))) {
    out.notes.push('a frame shader has no main texture in the archives: not animated');
    return;
  }
  if (names.length < 2) return;
  if (out.scroll) {
    out.notes.push('flip-book over a scrolling base: scroll ignored');
    out.scroll = null;
  }
  out.anim = { mode: timing.mode, seconds: timing.seconds, frames: frames.map((f) => f.main), missing: [] };
}

// ---------------------------------------------------------------------------------------------
// Images: { width, height, rgba }. Colour arithmetic in linear light.

const SRGB_TO_LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function encodeSrgb(linear) {
  const l = linear <= 0 ? 0 : linear >= 1 ? 1 : linear;
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055;
  return Math.round(c * 255);
}

/** The colour with alpha forced to 255 (a split-alpha colour; a One/One additive surface). */
export function rgbOnly(img) {
  const rgba = new Uint8Array(img.rgba);
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return { width: img.width, height: img.height, rgba };
}

/** The alpha as grey (r = g = b = a, a = 255): three's alphaMap reads green. */
export function alphaAsGrey(img) {
  const rgba = new Uint8Array(img.width * img.height * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    const a = img.rgba[i + 3];
    rgba[i] = a;
    rgba[i + 1] = a;
    rgba[i + 2] = a;
    rgba[i + 3] = 255;
  }
  return { width: img.width, height: img.height, rgba };
}

/** The mask values at img's size (the mask sampled nearest) and their largest. */
function maskValues(img, mask, channel) {
  const m = new Float32Array(img.width * img.height);
  let max = 0;
  for (let y = 0; y < img.height; y++) {
    const my = Math.min(mask.height - 1, Math.floor((y * mask.height) / img.height));
    for (let x = 0; x < img.width; x++) {
      const mx = Math.min(mask.width - 1, Math.floor((x * mask.width) / img.width));
      const j = (my * mask.width + mx) * 4;
      const v = (channel === 'rgb' ? Math.max(mask.rgba[j], mask.rgba[j + 1], mask.rgba[j + 2]) : mask.rgba[j + 3]) / 255;
      m[y * img.width + x] = v;
      if (v > max) max = v;
    }
  }
  return { m, max };
}

/** Float32Array of m in [0,1] at img's size (mask resampled nearest); null when max m < 8/255. */
export function maskOf(img, mask, channel) {
  const { m, max } = maskValues(img, mask, channel);
  return max < 8 / 255 ? null : m;
}

/**
 * Split a texture into a lit base colour and a glow that add up to it in linear light:
 * lit.rgb = enc(dec(rgb)·(1−m)), emis.rgb = enc(dec(rgb)·m); lit.a = keepAlpha ? img.a : 255; emis.a = 255.
 */
export function splitGlow(img, m, keepAlpha) {
  const n = img.width * img.height;
  const lit = new Uint8Array(n * 4);
  const emis = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const k = m[i];
    for (let c = 0; c < 3; c++) {
      const l = SRGB_TO_LINEAR[img.rgba[i * 4 + c]];
      lit[i * 4 + c] = encodeSrgb(l * (1 - k));
      emis[i * 4 + c] = encodeSrgb(l * k);
    }
    lit[i * 4 + 3] = keepAlpha ? img.rgba[i * 4 + 3] : 255;
    emis[i * 4 + 3] = 255;
  }
  return { lit: { width: img.width, height: img.height, rgba: lit }, emis: { width: img.width, height: img.height, rgba: emis } };
}

/** Box-filter halving until the long side is <= max. */
export function fitRgba(img, max) {
  let cur = img;
  while (Math.max(cur.width, cur.height) > max && (cur.width > 1 || cur.height > 1)) {
    const w = Math.max(1, cur.width >> 1);
    const h = Math.max(1, cur.height >> 1);
    const out = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      const y0 = Math.min(cur.height - 1, y * 2);
      const y1 = Math.min(cur.height - 1, y * 2 + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.min(cur.width - 1, x * 2);
        const x1 = Math.min(cur.width - 1, x * 2 + 1);
        for (let c = 0; c < 4; c++) {
          const s = cur.rgba[(y0 * cur.width + x0) * 4 + c] + cur.rgba[(y0 * cur.width + x1) * 4 + c] + cur.rgba[(y1 * cur.width + x0) * 4 + c] + cur.rgba[(y1 * cur.width + x1) * 4 + c];
          out[(y * w + x) * 4 + c] = (s + 2) >> 2;
        }
      }
    }
    cur = { width: w, height: h, rgba: out };
  }
  return cur === img ? { width: img.width, height: img.height, rgba: img.rgba } : cur;
}

/** The glow images of one texture are capped at this size; its lit image with them, texel for texel. */
export const GLOW_MAX = 512;

/**
 * The one metalness-roughness image, out of the masks that feed it: **red is the client's own specular
 * mask** (what its program multiplies its highlight by; three never reads the red channel, so it costs
 * the look nothing until the runtime asks for it), green the roughness worked out from that mask, and
 * blue the environment mask, metalness. On 603 of the retail shaders the gloss and the mirror come from
 * two different textures of two different sizes, so each is sampled into the larger of the two.
 *
 * `gloss` is the mask texel by texel; `level` stands in for it as one byte over the whole image where the
 * mask is constant (one, for an unmasked program, or a full-white mask) and only the mirror varies; with
 * neither the shader has no specular at all and green is the flat roughness the image always carried.
 *
 * A source is `{ w, h, read(x, y) }` over 0..255, and **its size is checked rather than trusted**.
 * This lives here, out of the command that used to hold it inline, for one reason: read through a
 * field the reader does not have (`width` for `w`) the size comes out undefined, the image comes out
 * one pixel square, every sample is NaN, a Uint8Array writes NaN as nought, and nought in green is
 * roughness nought -- a perfect mirror on every surface with a gloss map of its own, which is 1,710
 * of the retail shaders. Nothing caught it because the tests pinned what the converter *decided* and
 * never what it *drew*, so the decision was right and the picture was a mirror.
 */
export function combineMasks({ gloss = null, level = null, env = null, reflective = false }) {
  const sized = (src, what) => {
    if (!src) return null;
    if (!(src.w > 0) || !(src.h > 0) || typeof src.read !== 'function') throw new Error(`the ${what} mask has no readable size (w=${src.w}, h=${src.h})`);
    return src;
  };
  const g = sized(gloss, 'gloss');
  const e = sized(env, 'environment');
  if (!g && !e) throw new Error('a metalness-roughness image needs at least one mask');
  const w = Math.max(g?.w ?? 1, e?.w ?? 1);
  const h = Math.max(g?.h ?? 1, e?.h ?? 1);
  const rgba = new Uint8Array(w * h * 4);
  // Nearest: the two masks are usually the same size, and where they are not this is a roughness
  // map, not a photograph.
  const at = (src, x, y) => src.read(Math.min(src.w - 1, Math.floor((x * src.w) / w)), Math.min(src.h - 1, Math.floor((y * src.h) / h)));
  const flat = typeof level === 'number' ? Math.min(255, Math.max(0, Math.round(level))) : null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = g ? at(g, x, y) : flat;
      rgba[i] = v ?? 0;
      // With no mask at all (a reflective shader that draws no highlight, or whose colour alpha is real
      // transparency), the roughness is the flat one this returned before the mask was read: 0.3 for
      // something reflective, 0.45 otherwise, written as a byte so the one image carries every channel.
      rgba[i + 1] = v !== null ? 255 - Math.round(v * 0.85) : reflective ? 77 : 115;
      rgba[i + 2] = e ? at(e, x, y) : reflective && g ? v : 0;
      rgba[i + 3] = 255;
    }
  }
  return { w, h, rgba };
}

/** The roughness a constant mask byte gives, as `combineMasks` writes it into green: today's 0.85 slope, ours. */
export const roughnessOfMask = (level) => (255 - Math.round(level * 0.85)) / 255;

/**
 * The converter's readers of what a shader's surface is beyond its colour: its normal map and its shine,
 * each read the way the shader's own pixel program reads it (`normalReadOf`, `specMaskOf`). Made once per
 * run with the converter's own decoders, so the command and the node tests run the very same code; the
 * decoded masks and the written normal maps are kept for the run, since one is shared by dozens of shaders.
 *
 *   normalFor(path, slot)  -> { path, png, slot, layout } | null: the map decoded by its slot
 *                            (`src/swg/normalDecode.ts`, which the game's recolour runs too) and written as
 *                            plain tangent-space RGB, keyed on the path **and** the slot, since 21 files are
 *                            named in both slots by different shaders and are two different maps
 *   surfaceFor(effect, slots, main, alphaMode, opts) -> the factors, the metal-rough image and `spec` and
 *                            `cube` (glb.mjs writes those as `extras.swgSpec` and `extras.swgCube`)
 *   unread                   the shaders whose program could not be read and kept the old guess
 *
 * deps: { decodeDds, encodePng, loadEffect?(vfs, path) (texrender.mjs, for the stages' texture tags), log? }
 */
export function surfaceReaders(vfs, { decodeDds, encodePng, loadEffect = null, log = () => {} }) {
  const norm = (p) => String(p ?? '').replace(/\\/g, '/').toLowerCase();
  const tagCache = new Map();
  /** The texture tags an effect's stages read (an effect reads ENVM even when its shader names no cube file). */
  const effectTags = (effect) => {
    const name = String(effect ?? '').toLowerCase();
    let tags = tagCache.get(name);
    if (!tags) {
      tags = new Set();
      try {
        const eff = effect && loadEffect ? loadEffect(vfs, effect.replace(/\\/g, '/')) : null;
        for (const pass of eff?.passes ?? []) for (const st of pass.stageList ?? []) if (st.textureTag) tags.add(st.textureTag);
      } catch {
        /* an effect the renderer cannot parse just reads no tags */
      }
      tagCache.set(name, tags);
    }
    return tags;
  };

  const planes = new Map();
  /**
   * One channel of a texture as a mask plane, `{ path, w, h, read, white }`, cached by file, channel and
   * squaring: 'a' the alpha, 'r' the red (a float set from `.rgb`), 'lum' the luminance (the old rule's
   * own gloss file). `white` where every texel is 255, which is a mask of one and needs no image.
   * Undefined when the file is missing or will not decode.
   */
  const planeOf = (path, channel, squared = false, img = null) => {
    const key = img ? null : `${norm(path)}|${channel}|${squared ? 2 : 1}`;
    if (key && planes.has(key)) return planes.get(key);
    let out;
    try {
      const src = img ?? (vfs.has(norm(path)) ? decodeDds(vfs.read(norm(path))) : null);
      if (src) {
        const n = src.width * src.height;
        const plane = new Uint8Array(n);
        let white = true;
        for (let i = 0; i < n; i++) {
          const p = src.rgba;
          let v = channel === 'a' ? p[i * 4 + 3] : channel === 'g' ? p[i * 4 + 1] : channel === 'b' ? p[i * 4 + 2] : channel === 'lum' ? Math.round(p[i * 4] * 0.2126 + p[i * 4 + 1] * 0.7152 + p[i * 4 + 2] * 0.0722) : p[i * 4];
          if (squared) v = Math.round((v * v) / 255);
          plane[i] = v;
          if (v !== 255) white = false;
        }
        const w = src.width;
        out = { path, w, h: src.height, read: (x, y) => plane[y * w + x], white };
      }
    } catch (err) {
      log(`mask ${path} skipped: ${err.message}`);
    }
    if (key) planes.set(key, out);
    return out;
  };

  /**
   * How much of a surface is a mirror, as a reader over whichever texture the shader's program named.
   * `envMaskOf` has read the slot and the channel out of the pixel program; this is only the reading.
   * A shader with no environment cube never gets here, and one whose program could not be read falls
   * back on the main texture's alpha, which is what 981 of the 1,400 really use.
   */
  const envSource = (slots, main, mainPath, envMask) => {
    const slot = envMask?.slot ?? 'MAIN';
    const channel = envMask?.channel ?? 'a';
    const pick = channel === 'a' ? 'a' : 'g';
    if (slot === 'MAIN') {
      const p = main.hasAlpha || channel !== 'a' ? planeOf(mainPath, pick, false, main) : null;
      return p ? { ...p, slot, channel } : null;
    }
    const named = (slots ?? []).find((s) => s.slot === slot);
    if (!named?.path) return null;
    const p = planeOf(named.path, pick);
    return p ? { ...p, slot, channel } : null;
  };

  const normals = new Map();
  const normalFor = (path, slot) => {
    const layout = normalLayoutOf(slot);
    if (!layout || !path) return null;
    const file = norm(path);
    const key = `${file}|${slot}`;
    if (normals.has(key)) return normals.get(key);
    let out = null;
    try {
      if (vfs.has(file)) {
        const dds = decodeDds(vfs.read(file));
        const rgba = decodeNormalMap(dds.rgba, dds.width, dds.height, layout);
        out = { path: `${file}#${slot.toLowerCase()}`, png: encodePng(dds.width, dds.height, rgba), slot, layout };
      }
    } catch (err) {
      log(`normal map ${path} skipped: ${err.message}`);
    }
    normals.set(key, out);
    return out;
  };

  const unread = new Set();
  const surfaceFor = (effect, slots, main, alphaMode, { alphaIsEmissive = false, envMask = null, described = null, shader = null, mainPath = null } = {}) => {
    const tags = effectTags(effect);
    const slotTags = new Set((slots ?? []).map((s) => s.slot));
    // IRID is an environment cube under another name: the fourteen iridescent shaders (the chitin armour
    // set) name their cube IRID and are then drawn by the very same program the envmask family uses, with
    // that slot bound to its `envMap` sampler. Left out of this test they were the one reflective family
    // in the game with no reflection at all.
    const cube = !!envMask || ['ENVM', 'IRID'].some((t) => slotTags.has(t) || tags.has(t));
    const material = described?.material ?? null;
    const mainFile = mainPath ?? described?.main ?? null;
    const mainSlot = described?.mainSlot ?? 'MAIN';
    const specOf = (mode, mask, extra = {}) => ({ mode, color: material ? [...material.color] : [0, 0, 0], power: material?.power ?? 0, mask, ...extra });
    const sm = described?.specMask ?? null;
    const env = cube ? envSource(slots, main, mainFile, envMask) : null;
    const envFrom = env ? `${env.slot}.${env.channel}` : null;
    const image = (gloss, level, maskKey) => {
      const { w, h, rgba } = combineMasks({ gloss, level, env, reflective: cube });
      return { png: encodePng(w, h, rgba), key: `${maskKey}|${env ? `${envFrom}:${norm(env.path)}` : 'no mirror'}` };
    };
    if (!sm) {
      // A program that cannot be read (none named, a fixed-function pass, not in the archives, or a shape
      // the reader does not know): the rule this converter used before it read programs, kept as it was,
      // logged and counted. The guess from the effect's name is part of that rule and goes with it.
      if (shader && !unread.has(shader)) {
        unread.add(shader);
        log(`shine of ${shader}: its pixel program (${described?.programs?.pixel ?? 'none'}) cannot be read, so the old rule stands`);
      }
      const name = String(effect ?? '').toLowerCase();
      const reflective = cube || /env|chrome|mirror|refl|irid/.test(name);
      const specular = reflective || slotTags.has('SPEC') || tags.has('SPEC') || /spec|gloss|shin|metal|glass/.test(name);
      const spec = specOf(specular ? 'phong' : 'none', 'unread');
      if (!specular) return { spec, cube };
      const specSlot = (slots ?? []).find((s) => s.slot === 'SPEC');
      const own = specSlot?.path && norm(specSlot.path) !== norm((slots ?? []).find((s) => s.slot === 'MAIN')?.path) ? planeOf(specSlot.path, 'lum') : null;
      const masked = main.hasAlpha && alphaMode === 'OPAQUE' && !alphaIsEmissive;
      const fallbackEnv = reflective && !env ? envSource(slots, main, mainFile, envMask) : env;
      if (!own && !masked && !fallbackEnv) return { spec, cube, metallic: cube ? 0.6 : 0, roughness: reflective ? 0.3 : 0.45 };
      const gloss = own ?? (masked ? planeOf(mainFile, 'a', false, main) : null);
      const { w, h, rgba } = combineMasks({ gloss, env: fallbackEnv, reflective });
      return { spec, cube, metallic: cube ? 1 : 0, roughness: 1, mr: { png: encodePng(w, h, rgba), key: `unread:${own ? norm(own.path) : masked ? 'MAIN.a' : 'flat'}|${fallbackEnv ? `${fallbackEnv.slot}.${fallbackEnv.channel}` : 'no mirror'}` }, ...(own ? { glossFrom: own.path } : {}), ...(fallbackEnv ? { envFrom: `${fallbackEnv.slot}.${fallbackEnv.channel}` } : {}) };
    }
    if (sm.kind === 'none') {
      // No highlight at all. A shader with a cube still reflects, by its mirror mask, at the flat roughness
      // a reflective surface always had; one without is a matt surface and carries nothing.
      const spec = specOf('none', 'none');
      if (!cube) return { spec, cube };
      if (!env) return { spec, cube, metallic: 0.6, roughness: 0.3 };
      return { spec, cube, metallic: 1, roughness: 1, mr: image(null, null, 'none'), envFrom };
    }
    const mode = sm.aniso ? 'aniso' : 'phong';
    let gloss = null;
    let maskName = sm.kind === 'mask' ? `${sm.slot}.${sm.channel}` : 'unmasked';
    if (sm.kind === 'mask') {
      // The texture the program names, in the channel it reads: the colour texture's own picture (painted,
      // where a ship's paint stands in for it), else that slot's file, read before anything is made of it
      // (NRML's alpha is the gloss of the two-tone cloth, whatever the normal map written from it becomes).
      const named = (slots ?? []).find((s) => s.slot === sm.slot);
      const isMain = sm.slot === mainSlot || (named?.path && mainFile && norm(named.path) === norm(described?.main));
      const plane = isMain ? planeOf(mainFile, sm.channel, sm.squared, main) : named?.path ? planeOf(named.path, sm.channel, sm.squared) : undefined;
      if (!plane) {
        log(`shine of ${shader ?? effect}: its mask ${maskName} names no texture the archives hold, so it is drawn unmasked`);
        maskName = `${maskName} (missing)`;
      } else if (!plane.white) gloss = plane;
    }
    const spec = specOf(mode, maskName, sm.squared ? { squared: true } : {});
    // A mask of one over the whole surface (no mask, or a full-white one) needs no image of its own.
    if (!gloss && !env) return cube ? { spec, cube, metallic: 0.6, roughness: roughnessOfMask(255) } : { spec, cube, metallic: 0, roughness: roughnessOfMask(255) };
    return {
      spec,
      cube,
      metallic: cube ? 1 : 0,
      roughness: 1,
      mr: image(gloss, gloss ? null : 255, `${maskName}${sm.squared ? '^2' : ''}${gloss ? `:${norm(gloss.path)}` : ''}`),
      ...(gloss && gloss.path && norm(gloss.path) !== norm(mainFile) ? { glossFrom: gloss.path } : {}),
      ...(env ? { envFrom } : {}),
    };
  };

  return { surfaceFor, normalFor, effectTags, unread };
}

/** A main image handed in by deps.mainImage, as decodeDds gives one: `hasAlpha` from the answer, else read from its pixels. */
function paintedImage(img) {
  let hasAlpha = img.hasAlpha;
  if (typeof hasAlpha !== 'boolean') {
    hasAlpha = false;
    for (let i = 3; i < img.rgba.length; i += 4) {
      if (img.rgba[i] !== 255) {
        hasAlpha = true;
        break;
      }
    }
  }
  return { width: img.width, height: img.height, rgba: img.rgba, hasAlpha };
}

/**
 * The whole texture entry for one shader: what textureFor returned before, plus the new fields.
 * deps: { cache, decodeDds, encodePng, alphaFromEffect(effect, fallback),
 *         surfaceFor(effect, slots, dds, alphaMode, { alphaIsEmissive, envMask, described, shader, mainPath }),
 *         normalFor(path, slot), detailFor?(slots), glassNamed: RegExp, byName(effect), log, thumb?(width, height, rgba),
 *         mainImage?(shaderPath) -> { path, width, height, rgba, hasAlpha? } | null }.
 * With `thumb`, the entry carries a non-enumerable `thumb` made from the unsplit main image.
 * With `mainImage` answering (a customizable shader baked at its defaults, the ships command's paint),
 * that image replaces the main texture before every later step (the gloss mask, the glow split, the
 * opaque copy, the thumbnail) and the entry's path is the answer's, so a painted hull glows where its
 * painted colour does; answering null leaves the shader as its main texture has it. The answer's alpha
 * is the gloss mask (and a MAIN-alpha glow's mask), so it should be the chosen pattern's own alpha, as
 * the ships command's paint hands it. A flip-book is never painted: its answer is dropped with a note.
 */
export function surfaceTexture(vfs, shaderPath, deps) {
  const log = deps.log ?? (() => {});
  const d = describeSurface(vfs, shaderPath, deps.cache ?? new Map());
  // 1. An invisible collidable surface: drawn as nothing, kept for the colliders built from it.
  if (/invisible/i.test(d.effect ?? '')) return { path: shaderPath, invisible: true, alphaMode: 'BLEND', opacity: 0, hasAlpha: false };
  if (d.flip?.missing.length) log(`flip-book ${shaderPath}: base ${d.base ?? '(none)'}, ${d.flip.missing.length} of ${d.flip.frames} frames missing`);
  // A painted main stands in for the shader's own texture, never for a shader the archives lack. A
  // flip-book keeps its own frames: the bake is of one image, and painting frame 1 alone would flicker
  // between the painted and the plain (no retail paint shader is a flip-book).
  let painted = d.kind ? deps.mainImage?.(shaderPath) ?? null : null;
  if (painted && d.anim) {
    log(`paint ${shaderPath} is a flip-book: drawn with its own frames, unpainted`);
    painted = null;
  }
  // 2. No main texture: drawn untextured, as before.
  if (!painted && (!d.main || !vfs.has(d.main))) return null;
  const decode = (p) => deps.decodeDds(vfs.read(p));
  const png = (img) => deps.encodePng(img.width, img.height, img.rgba);
  const main = painted ? paintedImage(painted) : decode(d.main);
  const mainPath = painted ? painted.path : d.main;
  const pass = d.pass;
  // 3. alphaMode keeps its meaning: the effect's own reading (any implementation's first pass).
  const alphaMode = d.inline ? alphaModeFor({ alphaBlend: !!pass?.anyBlend, alphaTest: !!pass?.anyTest }) : deps.alphaFromEffect(d.effect, deps.byName(d.effect));
  const result = { path: mainPath, png: png(main), hasAlpha: main.hasAlpha, alphaMode };
  if (deps.glassNamed?.test(`${shaderPath} ${d.main}`)) result.glass = true;

  // 4. Additive: unlit, and opaque when the source factor is One or SrcColor (three's additive is SrcAlpha/One).
  const additive = !!pass?.additive;
  const opaqueAdd = additive && (pass.blendSrc === 1 || pass.blendSrc === 2);
  if (additive) {
    result.blend = 'add';
    result.unlit = true;
  }
  const em = d.emissive;
  // 5. Translucent: blending (InvSrcAlpha) and testing without depth writes, for the looks that need it.
  //
  // **Glass is one of them.** The rule that keeps a blending shader a cut-out is right for foliage,
  // hair and fences -- three sorts transparency per object, and an instanced field of it draws far
  // over near -- but a lens is not a leaf: a visor's alpha is a mid grey everywhere and never
  // reaches opaque, so a half-threshold cut-out throws most of it away and leaves the wearer looking
  // out through two holes.
  //
  // Two ways in, because neither alone is enough. **By name** -- a window, a canopy, a visor, a lens
  // -- which is what catches a vehicle's windscreen and a pair of goggles. And **by the shape of the
  // alpha**, for the things nobody thought to name: a hair card's alpha is strands, opaque down the
  // middle of each and clear between, while a pane of anything is a mid grey over the whole of
  // itself and never reaches opaque. Measured over every blending shader in the archives that the
  // name does not already catch: at nine tenths mid-alpha and never opaque there are 117, and **not
  // one of them is hair or fur** -- the highest any of the 233 hair and fur shaders reaches is 82%,
  // so the line has eight points of daylight either side. What it finds is fountain water, bacta
  // tanks, medicine gels, crystals and energy shields.
  const glassy = result.glass || paneLike(main);
  const looksTranslucent = !!(d.scroll || d.split || em?.kind === 'full' || d.anim || glassy);
  if (!additive && alphaMode === 'MASK' && pass?.alphaBlend && pass.alphaTest && !pass.zWrite && pass.blendDst === 5 && looksTranslucent) {
    result.translucent = true;
    if (d.alphaRef > 0) result.alphaTest = Math.round((d.alphaRef / 255) * 1e4) / 1e4;
  }
  // 6. Emissive: unlit screens; a masked glow split into a lit and a glowing image.
  if (em?.kind === 'full') result.unlit = true;
  let glow = null;
  if (em?.kind === 'mask' && !result.unlit) {
    const own = em.slot === (d.mainSlot ?? 'MAIN');
    const slotPath = own ? d.main : d.textures.find((t) => t.slot === em.slot)?.path;
    if (!slotPath || !vfs.has(slotPath)) log(`glow mask ${em.slot} of ${shaderPath} is not in the archives: drawn unglowing`);
    else glow = { own, channel: em.channel, path: slotPath, image: own ? null : decode(slotPath), keepAlpha: !(own && em.channel === 'a') };
  }
  // Each image (the main, then every flip-book frame) gets the same treatment.
  const frames = d.anim ? d.anim.frames.map((p, i) => (i === 0 ? { path: mainPath, image: main } : { path: p, image: decode(p) })) : [{ path: mainPath, image: main }];
  let masks = null;
  if (glow) {
    masks = frames.map((f) => {
      const fitted = fitRgba(f.image, GLOW_MAX);
      return { fitted, ...maskValues(fitted, glow.own ? fitted : glow.image, glow.channel) };
    });
    // A flip-book glows in every frame or in none, so no frame ever takes the glow map away.
    if (Math.max(...masks.map((x) => x.max)) < 8 / 255) masks = null;
  }
  // The main's alpha is a glow mask, not a gloss mask, only when it is split into a glow (which matters
  // only to the old rule, kept for a program that cannot be read: a program that can be says itself which
  // texture it multiplies its specular by). The environment mask is handed over as the shader's own
  // program named it, rather than being guessed at: on 378 of the 1,400 shaders that have one it is not
  // in the main texture at all.
  Object.assign(result, deps.surfaceFor(d.effect, d.textures, main, alphaMode, { alphaIsEmissive: !!masks && !glow.keepAlpha, envMask: d.envMask, described: d, shader: shaderPath, mainPath }));
  // The normal map the program reads (in any of its passes), decoded by the slot it sits in; none where no
  // pass reads one (533 retail shaders name a map no pass samples, nearly all the ground's), and the first
  // one named where the program cannot be read, as before.
  const read = d.normalRead;
  const normalSlot = read ? (read.kind === 'read' ? d.textures.find((s) => s.slot === read.slot) ?? null : null) : d.textures.find((s) => /^(CNRM|NRML|DOT3)$/.test(s.slot)) ?? null;
  const normal = normalSlot ? deps.normalFor(normalSlot.path, normalSlot.slot) : null;
  // Which coordinate set each of these reads (the shader's TCSS). A normal map on the second set, where
  // the main is on the first, is drawn on it: the meshes carry it, and on 139 of the 324 vertex arrays
  // that draw such a shader it is not the first set scaled. Every other slot on a set the models do not
  // carry is drawn on the main's and said so (`sets`), counted by `status` and printed by `materials`.
  const sets = d.records?.texcoordSets ?? {};
  const mainSet = sets[d.mainSlot ?? 'MAIN'] ?? 0;
  const other = [];
  if (normal) {
    const set = sets[normalSlot.slot];
    if (set === 1 && mainSet === 0) result.normal = { ...normal, set: 1 };
    else {
      result.normal = normal;
      if (set !== undefined && set !== mainSet) other.push(`${normalSlot.slot} on set ${set}`);
    }
  }
  const sm = d.specMask;
  for (const slot of new Set([sm?.kind === 'mask' ? sm.slot : null, d.envMask?.slot ?? null].filter((s) => s && s !== (d.mainSlot ?? 'MAIN')))) {
    const set = sets[slot];
    if (set !== undefined && set !== mainSet) other.push(`${slot} on set ${set}`);
  }
  if (other.length) result.sets = other;
  // The detail map, which the client multiplies the diffuse texture by before lighting.
  //
  // Not a second diffuse and not a decal: every one of the detail effects' pixel programs is the
  // same line, `result.rgb = diffuseColor * detailColor * light` (the specmap ones add the specular
  // afterwards, so it is the diffuse term alone), and it reads a texture coordinate set of its own.
  // 1,369 of the retail shaders carry one over 281 distinct images, and 38% of a planet's placed
  // objects draw with one, so the surfaces with it are the concrete, marble, metal and rock a town
  // is built out of, which today are flat.
  const detail = deps.detailFor ? deps.detailFor(d.textures) : null;
  if (detail) result.detail = detail;
  const treat = (f, i) => {
    const out = {};
    if (opaqueAdd || d.split) out.rgb = { path: `${f.path}#rgb`, png: png(rgbOnly(f.image)) };
    if (masks) {
      const { fitted, m } = masks[i];
      const { lit, emis } = splitGlow(fitted, m, glow.keepAlpha);
      const maskKey = `${glow.own ? f.path : glow.path}:${glow.channel}`;
      out.lit = { path: `${f.path}#lit:${maskKey}`, png: png(lit) };
      out.emissive = { path: `${f.path}#emis:${maskKey}`, png: png(emis) };
    }
    return out;
  };
  Object.assign(result, treat(frames[0], 0));
  // 7. Split alpha: an opaque colour image and the alpha as grey, each scrolled on its own.
  if (d.split) result.alphaImage = { path: `${mainPath}#alpha`, png: png(alphaAsGrey(main)) };
  // 8. Scroll, and no shadow for anything blended.
  if (d.scroll) result.scroll = { map: [...d.scroll.map], alpha: d.scroll.alpha ? [...d.scroll.alpha] : null };
  if (result.blend || result.translucent) result.noShadow = true;
  // 9. Flip-book frames.
  if (d.anim && frames.length > 1) {
    const list = [];
    let anyAlpha = main.hasAlpha;
    frames.forEach((f, i) => {
      if (i === 0) {
        list.push({ path: result.path, png: result.png, hasAlpha: main.hasAlpha, ...(result.rgb ? { rgb: result.rgb } : {}), ...(result.lit ? { lit: result.lit, emissive: result.emissive } : {}) });
        return;
      }
      if (f.image.hasAlpha) anyAlpha = true;
      list.push({ path: f.path, png: png(f.image), hasAlpha: !!f.image.hasAlpha, ...treat(f, i) });
    });
    result.hasAlpha = anyAlpha;
    result.anim = { mode: d.anim.mode, seconds: [...d.anim.seconds], frames: list };
  }
  if (deps.thumb) Object.defineProperty(result, 'thumb', { value: deps.thumb(main.width, main.height, main.rgba), enumerable: false, configurable: true, writable: true });
  return result;
}

// ---------------------------------------------------------------------------------------------
// Reports: the converter's log lines and diagnostics.

const num = (v) => String(Math.round(v * 1e4) / 1e4);
const seconds = (s) => (s[0] === s[1] ? `${num(s[0])} s each` : `${num(s[0])} to ${num(s[1])} s each`);
const MODE_WORDS = { time: '', random: ', each frame timed at random', pingpong: ', forward then back', frame: ', one per drawn frame', randomFrame: ', frames picked at random' };

/** One line on what a texture entry does beyond its picture, for `materials` and `shader`. */
export function surfaceLine(entry, described = null) {
  if (!entry) return described?.notes.length ? `untextured; ${described.notes.join('; ')}` : 'untextured';
  if (entry.invisible) return 'invisible (collision only)';
  const groups = [];
  const look = [];
  if (entry.blend === 'add') look.push('additive');
  if (entry.translucent) look.push('translucent');
  if (entry.alphaTest) look.push(`alpha test ${Math.round(entry.alphaTest * 255)}/255`);
  if ((entry.blend || entry.translucent) && described?.pass && !described.pass.zWrite) look.push('no depth write');
  if (entry.noShadow) look.push('no shadow');
  if (look.length) groups.push(look.join(', '));
  const motion = [];
  if (entry.anim) motion.push(`flip-book ${entry.anim.frames.length} frames, ${seconds(entry.anim.seconds)}${MODE_WORDS[entry.anim.mode] ?? ''}`);
  if (entry.scroll) motion.push(`scrolls colour (${entry.scroll.map.map(num).join(',')})/s${entry.scroll.alpha ? `, alpha (${entry.scroll.alpha.map(num).join(',')})/s` : ''}`);
  if (entry.alphaImage) motion.push('split alpha');
  if (motion.length) groups.push(motion.join(', '));
  if (entry.unlit) groups.push('unlit');
  if (entry.emissive) {
    const em = described?.emissive;
    groups.push(`glows by ${em?.kind === 'mask' ? `${em.slot}.${em.channel}` : 'a mask'} (lit and glow images)`);
  }
  if (!groups.length) groups.push('as painted');
  if (described?.notes.length) groups.push(described.notes.join('; '));
  return groups.join('; ');
}

/** What describeSurface found, line by line, for the `shader` command. */
export function describeLines(d) {
  const lines = [];
  const kinds = { SSHT: 'static shader', CSHD: 'customizable shader', SWTS: 'flip-book of textures', SWSH: 'flip-book of shaders', OPST: 'OPST shader' };
  lines.push(`surface: ${d.kind ? `${d.kind} (${kinds[d.kind] ?? 'unknown form'})` : 'not in the archives'}${d.base ? `, base ${d.base}` : ''}`);
  if (d.timing) {
    const frames = d.flip ? `${d.flip.frames - d.flip.missing.length} of ${d.flip.frames} frames present` : 'no frames';
    lines.push(`  timing: ${d.timing.mode}, ${d.timing.count} frames, ${seconds(d.timing.seconds)}; ${frames}${d.anim ? '' : ' (not animated)'}`);
    for (const m of d.flip?.missing ?? []) lines.push(`    missing ${m}`);
  }
  lines.push(`  effect: ${d.inline ? '(inline)' : d.effect ?? '(none)'}`);
  const p = d.pass;
  if (p) {
    lines.push(`  pass: version ${p.version}, z-write ${p.zWrite ? 'on' : 'off'}, blend ${p.alphaBlend ? `on (${p.blendSrc}/${p.blendDst}${p.blendOp ? `, operation ${p.blendOp}` : ''}${p.additive ? ', additive' : ''})` : 'off'}, alpha test ${p.alphaTest ? 'on' : 'off'}, reference ${p.alphaRefTag ?? '-'} = ${d.alphaRef}; any implementation blends ${p.anyBlend ? 'yes' : 'no'}, tests ${p.anyTest ? 'yes' : 'no'}`);
    lines.push(`  programs: vertex ${p.vertexProgram ?? '(fixed function)'}, pixel ${p.pixelProgram ?? '(fixed function)'}${Object.keys(p.samplers).length ? `, samplers ${Object.entries(p.samplers).map(([r, t]) => `s${r}=${t}`).join(' ')}` : ''}`);
    // The implementation's later passes, each read for the shine and the normal map with its own samplers.
    (p.passes ?? []).slice(1).forEach((q, i) => lines.push(`  pass ${i + 2}: pixel ${q.pixelProgram ?? '(fixed function)'}${Object.keys(q.samplers).length ? `, samplers ${Object.entries(q.samplers).map(([r, t]) => `s${r}=${t}`).join(' ')}` : ''}`));
  } else lines.push('  pass: none read');
  lines.push(`  scroll: ${d.scroll ? `colour (${d.scroll.map.map(num).join(',')})/s${d.scroll.alpha ? `, alpha (${d.scroll.alpha.map(num).join(',')})/s` : ''}` : 'none'}; split alpha ${d.split ? 'yes' : 'no'}`);
  const em = d.emissive;
  lines.push(`  emissive: ${!em ? 'none' : em.kind === 'mask' ? `mask ${em.slot}.${em.channel}` : em.kind === 'add' ? 'additive' : 'full (unlit)'}`);
  // What the program does with a specular mask and a normal map, read as `specMaskOf` and `normalReadOf`
  // read them, and the MATL the highlight is drawn with.
  const sm = d.specMask;
  lines.push(`  specular: ${!sm ? 'program not read (the old rule stands)' : sm.kind === 'none' ? 'none in the program' : sm.kind === 'unmasked' ? `unmasked${sm.aniso ? ', the band' : ''}` : `mask ${sm.slot}.${sm.channel}${sm.squared ? ' squared' : ''}${sm.aniso ? ', the band' : ''}`}`);
  const nr = d.normalRead;
  lines.push(`  normal map: ${!nr ? 'program not read (the first one named)' : nr.kind === 'none' ? 'none read' : `${nr.slot} read ${nr.layout}, decoded by the slot ${normalLayoutOf(nr.slot) ?? '(not a normal slot)'}`}`);
  lines.push(`  material: ${d.material ? `specular ${d.material.color.join(',')} power ${d.material.power}` : 'no MATL'}; envmask ${d.envMask ? `${d.envMask.slot}.${d.envMask.channel}` : 'none'}`);
  const sets = Object.entries(d.records?.texcoordSets ?? {});
  if (sets.length) lines.push(`  coordinate sets: ${sets.map(([t, s]) => `${t} ${s}`).join(', ')}`);
  lines.push(`  main: ${d.main ?? '(none)'}${d.mainSlot ? ` (${d.mainSlot})` : ''}`);
  for (const n of d.notes) lines.push(`  note: ${n}`);
  return lines;
}

/** Counts over a pack's texture entries for the snapshot's `surfaces:` line. */
/**
 * Whether an image's alpha is a pane rather than a cut-out: mid-grey over nine tenths of itself and
 * never reaching opaque anywhere.
 *
 * The two numbers are ours and were chosen by measuring, not by taste. See the note at the
 * translucency decision for what the margin is.
 */
function paneLike(img) {
  if (!img?.rgba || !img.hasAlpha) return false;
  let mid = 0;
  let n = 0;
  let max = 0;
  // Every seventh pixel: the answer is a share over the whole image and does not move at that rate.
  for (let i = 3; i < img.rgba.length; i += 4 * 7) {
    const a = img.rgba[i];
    n++;
    if (a > max) max = a;
    if (a > 24 && a < 232) mid++;
  }
  return n > 0 && mid / n >= 0.9 && max < 250;
}

export function surfaceCounts(entries) {
  const c = { flipBooks: 0, scrolling: 0, unlit: 0, additive: 0, glowing: 0, glowBytes: 0, glossy: 0, glossMaps: 0, detailed: 0, detailMaps: 0, detailBytes: 0, mirrored: 0, mirrorElsewhere: 0, shineUnread: 0, otherSets: 0, normalSecondSet: 0 };
  const glow = new Map();
  const gloss = new Set();
  const detail = new Map();
  for (const t of entries ?? []) {
    if (!t || t.invisible) continue;
    if (t.anim) c.flipBooks++;
    if (t.scroll) c.scrolling++;
    if (t.unlit && t.blend !== 'add') c.unlit++;
    if (t.blend === 'add') c.additive++;
    // Read from the shader's **own** gloss texture rather than guessed from the diffuse alpha.
    if (t.glossFrom) {
      c.glossy++;
      gloss.add(t.glossFrom);
    }
    if (t.detail) {
      c.detailed++;
      detail.set(t.detail.path, t.detail.png.length);
    }
    // How much of it is a mirror, and how often that mask is somewhere other than the colour
    // texture's alpha -- which is the whole point of reading it off the program.
    if (t.envFrom) {
      c.mirrored++;
      if (t.envFrom !== 'MAIN.a') c.mirrorElsewhere++;
    }
    // What the reading of the programs could not do: a shader whose program could not be read keeps the
    // old guess at its shine, and a mask or a normal map on a coordinate set the models do not carry is
    // drawn on the main's. A normal map on the second set is drawn on it.
    if (t.spec?.mask === 'unread') c.shineUnread++;
    if (t.sets?.length) c.otherSets++;
    if (t.normal?.set === 1) c.normalSecondSet++;
    if (t.emissive) {
      c.glowing++;
      glow.set(t.emissive.path, t.emissive.png.length);
      for (const f of t.anim?.frames ?? []) if (f.emissive) glow.set(f.emissive.path, f.emissive.png.length);
    }
  }
  for (const n of glow.values()) c.glowBytes += n;
  for (const n of detail.values()) c.detailBytes += n;
  c.glossMaps = gloss.size;
  c.detailMaps = detail.size;
  return c;
}

export function surfaceCountsLine(c) {
  return `surfaces: ${c.flipBooks} flip-books, ${c.scrolling} scrolling, ${c.unlit} unlit, ${c.additive} additive, ${c.glowing} glowing (${(c.glowBytes / 1e6).toFixed(1)} MB of glow images), ${c.glossy} with the shader's own gloss map (${c.glossMaps} maps), ${c.detailed} with a detail map (${c.detailMaps} maps, ${(c.detailBytes / 1e6).toFixed(1)} MB), ${c.mirrored} reflective (${c.mirrorElsewhere} whose mirror mask is not the colour texture's alpha), ${c.normalSecondSet ?? 0} with a normal map on the second coordinate set, ${c.otherSets ?? 0} reading a mask or a normal map on a set the models do not carry, ${c.shineUnread ?? 0} whose program could not be read (shine by the old rule)`;
}

/**
 * What a texture entry says about its shine and its relief, for `shader` and `materials`: where the mask
 * comes from, the highlight the client drew (the MATL's colour and power, and a band where the program
 * bends it into one), whether there is a cube, and how the normal map is decoded and on which set.
 */
export function shineLine(entry, described = null) {
  if (!entry || entry.invisible) return null;
  const s = entry.spec;
  const num4 = (v) => String(Math.round(v * 1e4) / 1e4);
  const parts = [];
  if (!s) parts.push('shine: none written');
  else if (s.mode === 'none') parts.push(`shine: none (the program draws no highlight${s.mask === 'unread' ? '; program not read' : ''})`);
  else parts.push(`shine: ${s.mask === 'unread' ? 'mask by the old guess (program not read)' : s.mask === 'unmasked' ? 'unmasked (a mask of one)' : `mask ${s.mask}${s.squared ? ' squared' : ''}`}, ${s.mode === 'aniso' ? 'the band' : 'phong'}, colour ${s.color.map(num4).join(',')} power ${num4(s.power)}${described && !described.material ? ' (no MATL)' : ''}`);
  parts.push(entry.cube ? `cube (mirror mask ${entry.envFrom ?? 'flat'})` : 'no cube (no metal)');
  parts.push(entry.mr ? `metal-rough image, factors ${num4(entry.metallic ?? 0)}/${num4(entry.roughness ?? 0)}` : entry.roughness !== undefined ? `flat metal ${num4(entry.metallic ?? 0)} rough ${num4(entry.roughness)}` : 'no metal-rough');
  const read = described?.normalRead;
  if (entry.normal) parts.push(`normal map ${entry.normal.slot} decoded ${entry.normal.layout}${entry.normal.set === 1 ? ' on set 1' : ''}`);
  else if (read?.kind === 'read') parts.push(`normal map ${read.slot}: not in the archives`);
  else if (read?.kind === 'none' && described?.textures?.some((t) => /^(CNRM|NRML|DOT3)$/.test(t.slot))) parts.push('normal map named but never read by the program: not written');
  if (entry.sets?.length) parts.push(`drawn on the main set: ${entry.sets.join(', ')}`);
  return parts.join('; ');
}
