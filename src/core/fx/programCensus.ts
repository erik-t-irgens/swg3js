// Counting the shader programs a world makes, and naming what makes each one different.
//
// Making one GPU program is a flat cost on the machine, whatever the shader says: on the owner's
// it is about 300 ms of blocking work, and a world holds two hundred and more. So the first
// question is not "why is this program slow to build" but "why is there another program at all",
// and that question is answered by three's own cache key: two materials that key the same share
// one program, and two that key differently never can.
//
// Three joins the key out of an array (WebGLPrograms.getProgramCacheKey): the shader id, then
// every define as a name and a value, then a fixed run of parameters, then two bitmasks of
// booleans, the output colour space, and last the material's own `customProgramCacheKey`. Only
// the head and the tail are variable, so the fixed run is found by looking for the one token that
// can only be the precision ('highp', 'mediump' or 'lowp') with eleven light counts and two
// masks where they must be. Everything here reads that; nothing here changes it.
//
// The parameter order is three's and is pinned to the version in package.json (0.185). If three
// ever moves it, the anchor stops validating rather than lying: a program whose key cannot be
// read is reported as unread, and the count of unread programs is part of the answer.

/** The eleven light counts in the key, in three's order, and what they are called here. */
export const LIGHT_FIELDS = ['dir', 'point', 'spot', 'spotMaps', 'hemi', 'rectArea', 'dirShadow', 'pointShadow', 'spotShadow', 'spotShadowMaps', 'lightProbes'] as const;

export type LightField = (typeof LIGHT_FIELDS)[number];

/** How many lights of each kind the pass that built a program had. */
export type LightCounts = Record<LightField, number>;

/** The first bitmask three pushes, bit by bit (WebGLPrograms.getProgramCacheKeyBooleans). */
export const MASK_A = ['instancing', 'instancingColor', 'instancingMorph', 'matcap', 'envMap', 'normalMapObjectSpace', 'normalMapTangentSpace', 'clearcoat', 'iridescence', 'alphaTest', 'vertexColors', 'vertexAlphas', 'vertexUv1s', 'vertexUv2s', 'vertexUv3s', 'vertexTangents', 'anisotropy', 'alphaHash', 'batching', 'dispersion', 'batchingColor', 'gradientMap', 'packedNormalMap', 'vertexNormals'] as const;

/** The second bitmask. `fog` is the scene's, `useFog` the material's: both are in the key. */
export const MASK_B = ['fog', 'useFog', 'flatShading', 'logarithmicDepth', 'reversedDepth', 'skinning', 'morphTargets', 'morphNormals', 'morphColors', 'premultipliedAlpha', 'shadowMapEnabled', 'doubleSided', 'flipSided', 'useDepthPacking', 'dithering', 'transmission', 'sheen', 'opaque', 'pointsUvs', 'decodeVideoTexture', 'decodeVideoTextureEmissive', 'alphaToCoverage', 'lightProbeGrids', 'hasPositionAttribute'] as const;

/** Where each field sits in the fixed run, counted from the precision token. */
const AT = {
  precision: 0,
  outputColorSpace: 1,
  envMapMode: 2,
  envMapCubeUVHeight: 3,
  combine: 27,
  fogExp2: 28,
  sizeAttenuation: 29,
  morphTargetsCount: 30,
  morphAttributeCount: 31,
  lights: 32,
  shadowMapType: 43,
  toneMapping: 44,
  numClippingPlanes: 45,
  numClipIntersection: 46,
  depthPacking: 47,
  maskA: 48,
  maskB: 49,
  outputColorSpaceAgain: 50,
  custom: 51,
} as const;

const PRECISIONS = new Set(['highp', 'mediump', 'lowp']);

/** What one program's cache key says about it. */
export interface KeyRead {
  /** 'standard', 'basic', 'sprite', 'depth'…, or 'custom' for a shader material with no shader id. */
  shaderId: string;
  /** Defines, in the order three wrote them: `USE_CSM`, `CSM_CASCADES`, the game's own. */
  defines: { name: string; value: string }[];
  lights: LightCounts;
  /** True of each boolean three set; the ones that are false are left out. */
  flags: string[];
  envMapCubeUVHeight: string;
  shadowMapType: string;
  toneMapping: string;
  clippingPlanes: string;
  /** The material's own key. `wet-object|…` is the wetness wrap; the rest is a compile hook's source. */
  custom: string;
  /** Our own short name for what the custom key holds: 'wet', 'hook', or '' for nothing of its own. */
  customKind: string;
}

function zeroLights(): LightCounts {
  const out = {} as LightCounts;
  for (const f of LIGHT_FIELDS) out[f] = 0;
  return out;
}

const isCount = (s: string | undefined): boolean => s !== undefined && /^\d+$/.test(s);
/** A field three writes as a whole number, or leaves unset (an empty token, or the word undefined). */
const isCountOrUnset = (s: string | undefined): boolean => s === '' || s === 'undefined' || isCount(s);
/** A map's UV set: `false` where the material has no such map, else the name of a channel. */
const isChannel = (s: string | undefined): boolean => s === 'false' || (s !== undefined && /^uv\d*$/.test(s));
/**
 * A field three writes as a boolean, or leaves unset. `fogExp2` is `!!fog && fog.isFogExp2`, which
 * on a scene with ordinary linear fog is neither true nor false but nothing at all, so this must
 * take an empty token as readily as a word.
 */
const isBool = (s: string | undefined): boolean => s === 'true' || s === 'false' || s === '' || s === 'undefined';

/**
 * Where the fixed run of parameters starts in a split key, or -1.
 *
 * Neither end of a key is a fixed length: the head is a shader id and then every define as a name
 * and a value, and the tail is the material's own key, whose default in three is the whole source
 * text of its compile hook, commas and newlines and all. So the run is found rather than counted
 * to: each token that reads as a precision is tried, and every field of the run that can only be
 * one shape is checked -- the twenty-three map channels (each `false` or the name of a UV set),
 * the two booleans, the morph counts, the eleven light counts, the shadow and tone-mapping kinds,
 * the clipping counts and the two masks. A define whose value happened to be `highp`, and that
 * word inside a hook's source, each fail the check and the search goes on past them.
 *
 * The shapes are three's (WebGLPrograms.getProgramCacheKeyParameters) and are pinned to the
 * version in package.json by the node test, against a key the running game really built. Checking
 * them rather than assuming them is the whole point: a map channel in this version is written
 * `false` when there is no map, not as a number, and a reader that expects a number there finds no
 * anchor in any key at all and reports a world of two hundred programs as unreadable.
 */
export function anchorOf(tokens: string[]): number {
  for (let i = 0; i < tokens.length; i++) {
    if (!PRECISIONS.has(tokens[i])) continue;
    if (i + AT.custom > tokens.length) continue;
    let ok = true;
    for (let k = 0; k < LIGHT_FIELDS.length; k++) {
      if (!isCount(tokens[i + AT.lights + k])) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    for (let k = AT.envMapCubeUVHeight + 1; k < AT.combine; k++) {
      if (!isChannel(tokens[i + k])) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (!isBool(tokens[i + AT.fogExp2]) || !isBool(tokens[i + AT.sizeAttenuation])) continue;
    if (!isCount(tokens[i + AT.morphTargetsCount]) || !isCountOrUnset(tokens[i + AT.morphAttributeCount])) continue;
    if (!isCountOrUnset(tokens[i + AT.envMapCubeUVHeight]) || !isCountOrUnset(tokens[i + AT.combine])) continue;
    if (!isCount(tokens[i + AT.maskA]) || !isCount(tokens[i + AT.maskB])) continue;
    if (!isCount(tokens[i + AT.shadowMapType]) || !isCount(tokens[i + AT.toneMapping])) continue;
    if (!isCount(tokens[i + AT.numClippingPlanes]) || !isCount(tokens[i + AT.numClipIntersection])) continue;
    return i;
  }
  return -1;
}

function bits(mask: string, names: readonly string[]): string[] {
  const n = Number(mask);
  const out: string[] = [];
  for (let i = 0; i < names.length; i++) if (n & (1 << i)) out.push(names[i]);
  return out;
}

/** Read one cache key, or null when the fixed run cannot be found (a three that has moved on). */
export function readKey(cacheKey: string): KeyRead | null {
  const tokens = cacheKey.split(',');
  const at = anchorOf(tokens);
  if (at < 0) return null;
  const lights = zeroLights();
  LIGHT_FIELDS.forEach((f, k) => {
    lights[f] = Number(tokens[at + AT.lights + k]);
  });
  // A shader material with no shader id pushes two custom ids instead of one name; either way the
  // defines that follow are pairs, so the head is whatever is left once they are taken in twos.
  const headLooksNamed = at >= 1 && !/^\d+$/.test(tokens[0]);
  const head = headLooksNamed ? 1 : Math.min(2, at);
  const defines: { name: string; value: string }[] = [];
  for (let i = head; i + 1 < at; i += 2) defines.push({ name: tokens[i], value: tokens[i + 1] });
  const custom = tokens.slice(at + AT.custom).join(',');
  return {
    shaderId: headLooksNamed ? tokens[0] : 'custom',
    defines,
    lights,
    flags: [...bits(tokens[at + AT.maskA], MASK_A), ...bits(tokens[at + AT.maskB], MASK_B)],
    envMapCubeUVHeight: tokens[at + AT.envMapCubeUVHeight] ?? '',
    shadowMapType: tokens[at + AT.shadowMapType] ?? '',
    toneMapping: tokens[at + AT.toneMapping] ?? '',
    clippingPlanes: tokens[at + AT.numClippingPlanes] ?? '',
    custom,
    customKind: custom.startsWith('wet-object|') ? 'wet' : custom.trim() ? 'hook' : '',
  };
}

/**
 * The light set a program was built under, as one short line. This is the thing to count: a
 * material drawn in two passes with different lights needs two programs whether or not its shader
 * reads a light at all, because three puts the counts in every key.
 */
export function lightSignature(lights: LightCounts): string {
  const parts: string[] = [];
  for (const f of LIGHT_FIELDS) if (lights[f]) parts.push(`${lights[f]} ${f}`);
  return parts.length ? parts.join(', ') : 'no lights';
}

/** One light signature the world's programs were built under, with the counts behind it. */
export interface LightSet {
  lights: string;
  counts: LightCounts;
  programs: number;
}

/** A light signature that covers two others which do not cover each other, and which two. */
export interface CombinedLight {
  lights: string;
  of: [string, string];
  programs: number;
}

/** True when `whole` has at least as many of every kind of light as `part`. */
function covers(whole: LightCounts, part: LightCounts): boolean {
  return LIGHT_FIELDS.every((f) => whole[f] >= part[f]);
}

/**
 * The light signatures that cover two others which do not cover each other.
 *
 * This is the census answering the question that started it. The game draws each frame in passes,
 * and each pass shows the camera one set of lights: the world's (the sun, its cascades, the fill
 * and what the pool has lent out of doors) or a building's rooms' (its parallel light and its
 * lamps). Three puts the light counts in every program's key, so a material drawn in two passes
 * costs two programs, and that is the price of the design rather than a fault in it. But a
 * signature that holds all of one pass's lights AND all of another's is no pass the game has: it
 * is one camera that was shown both at once, and every program built under it is one that no frame
 * will ever draw with.
 *
 * Covering rather than adding, because the two sets are not disjoint: the point lights are one
 * fixed pool everything borrows from, so a camera shown the world and a building together sees
 * twelve of them and not the world's four plus the rooms' twelve. Two sets that do not cover each
 * other are two real passes; a set with no lights at all is never taken as one of the two, or
 * every signature would read as itself and nothing.
 */
export function combinedLights(sets: LightSet[]): CombinedLight[] {
  const lit = sets.filter((s) => LIGHT_FIELDS.some((f) => s.counts[f] > 0));
  const out: CombinedLight[] = [];
  for (const whole of lit) {
    let found = false;
    for (let i = 0; i < lit.length && !found; i++) {
      for (let k = i + 1; k < lit.length && !found; k++) {
        const a = lit[i];
        const b = lit[k];
        if (a === whole || b === whole) continue;
        if (!covers(whole.counts, a.counts) || !covers(whole.counts, b.counts)) continue;
        // Two sets where one covers the other are one pass and a smaller view of it, not two.
        if (covers(a.counts, b.counts) || covers(b.counts, a.counts)) continue;
        out.push({ lights: whole.lights, of: [a.lights, b.lights], programs: whole.programs });
        found = true;
      }
    }
  }
  return out.sort((x, y) => y.programs - x.programs);
}

/** The least a program must look like to be counted (three's `renderer.info.programs` rows). */
export interface ProgramRow {
  id?: number;
  name?: string;
  type?: string;
  cacheKey: string;
  usedTimes?: number;
}

export interface CensusGroup {
  /** What to call this family of programs: the material's name, else its type, else the shader id. */
  label: string;
  programs: number;
  /** Materials sharing these programs, summed. */
  used: number;
  /** One line per program in the family: its light signature and what else marks it out. */
  variants: { lights: string; marks: string; used: number; id: number }[];
  /** The tokens that differ between the family's keys, named where the name is known. */
  differBy: string[];
}

export interface Census {
  programs: number;
  unread: number;
  /** How many programs each light signature accounts for, most first. */
  byLight: { lights: string; programs: number }[];
  /** How many programs each material family accounts for, most first. */
  groups: CensusGroup[];
  /** Families with more than one program, which is where a cut can be made. */
  split: number;
  /**
   * Light signatures that hold two of the others at once: a camera shown two passes' lights
   * together, and programs no frame draws with. Empty is the answer that should stand.
   */
  combined: CombinedLight[];
  /** How many programs those signatures account for: the cut this census asks for first. */
  combinedPrograms: number;
}

/** A program's marks other than its lights: what would have to change for it to share. */
export function marksOf(read: KeyRead): string {
  const marks: string[] = [];
  if (read.defines.some((d) => d.name === 'USE_CSM')) marks.push('cascades');
  if (read.customKind) marks.push(read.customKind);
  for (const f of ['alphaTest', 'vertexColors', 'skinning', 'instancing', 'doubleSided', 'flipSided', 'fog', 'useFog', 'shadowMapEnabled', 'envMap', 'opaque', 'premultipliedAlpha', 'morphTargets']) {
    if (read.flags.includes(f)) marks.push(f);
  }
  if (read.envMapCubeUVHeight) marks.push(`cubeUV ${read.envMapCubeUVHeight}`);
  if (read.toneMapping && read.toneMapping !== '0') marks.push(`tone ${read.toneMapping}`);
  if (read.clippingPlanes && read.clippingPlanes !== '0') marks.push(`clip ${read.clippingPlanes}`);
  return marks.join(' ');
}

/** What is different between two keys of one family, by position, named where the name is known. */
export function namesOfDifference(keys: string[]): string[] {
  if (keys.length < 2) return [];
  const split = keys.map((k) => k.split(','));
  const at = split.map(anchorOf);
  const named = new Set<string>();
  // Lined up on the anchor rather than on token 0: two keys of one family can have different
  // numbers of defines, and then every later token would read as different.
  for (let k = 1; k < split.length; k++) {
    if (at[0] < 0 || at[k] < 0) {
      named.add('unread');
      continue;
    }
    if (split[0].slice(0, at[0]).join(',') !== split[k].slice(0, at[k]).join(',')) named.add('defines');
    for (let i = 0; i <= AT.custom; i++) {
      const a = split[0][at[0] + i];
      const b = split[k][at[k] + i];
      if (a === b) continue;
      if (i >= AT.lights && i < AT.lights + LIGHT_FIELDS.length) named.add(`lights (${LIGHT_FIELDS[i - AT.lights]})`);
      else if (i === AT.maskA || i === AT.maskB) {
        const before = new Set(bits(a ?? '0', i === AT.maskA ? MASK_A : MASK_B));
        for (const f of bits(b ?? '0', i === AT.maskA ? MASK_A : MASK_B)) if (!before.delete(f)) named.add(f);
        for (const f of before) named.add(f);
      } else if (i === AT.custom) named.add('own key');
      else named.add(nameOfIndex(i));
    }
    if (split[0].slice(at[0] + AT.custom).join(',') !== split[k].slice(at[k] + AT.custom).join(',')) named.add('own key');
  }
  return [...named];
}

function nameOfIndex(i: number): string {
  for (const [name, index] of Object.entries(AT)) if (index === i) return name;
  if (i >= 4 && i <= 26) return 'a texture channel';
  return `token ${i}`;
}

/**
 * Group every live program by the material family it belongs to and say, for each family with
 * more than one, what the second one is for. The rows are data: nothing here is decided by it.
 */
export function census(rows: readonly ProgramRow[]): Census {
  const byLight = new Map<string, LightSet>();
  const groups = new Map<string, { used: number; keys: string[]; variants: CensusGroup['variants'] }>();
  let unread = 0;
  for (const row of rows) {
    const read = readKey(row.cacheKey);
    const label = (row.name || row.type || (read ? read.shaderId : '?')) as string;
    const g = groups.get(label) ?? groups.set(label, { used: 0, keys: [], variants: [] }).get(label)!;
    g.used += row.usedTimes ?? 1;
    g.keys.push(row.cacheKey);
    if (!read) {
      unread++;
      g.variants.push({ lights: 'unread', marks: '', used: row.usedTimes ?? 1, id: row.id ?? -1 });
      continue;
    }
    const sig = lightSignature(read.lights);
    const set = byLight.get(sig) ?? byLight.set(sig, { lights: sig, counts: read.lights, programs: 0 }).get(sig)!;
    set.programs++;
    g.variants.push({ lights: sig, marks: marksOf(read), used: row.usedTimes ?? 1, id: row.id ?? -1 });
  }
  const out: CensusGroup[] = [];
  for (const [label, g] of groups) out.push({ label, programs: g.keys.length, used: g.used, variants: g.variants, differBy: namesOfDifference(g.keys) });
  out.sort((a, b) => b.programs - a.programs || b.used - a.used);
  const sets = [...byLight.values()].sort((a, b) => b.programs - a.programs);
  const combined = combinedLights(sets);
  return {
    programs: rows.length,
    unread,
    byLight: sets.map(({ lights, programs }) => ({ lights, programs })),
    groups: out,
    split: out.filter((g) => g.programs > 1).length,
    combined,
    combinedPrograms: combined.reduce((n, c) => n + c.programs, 0),
  };
}

// Where this is read from: `__debug.shaders()` hands it the renderer's own live program list, and
// answers `combinedPrograms` whether or not the family list was asked for. It had a console hook of
// its own for a while (`__shaderFamilies()`, installed from wherever the renderer happened to be),
// because the question this file exists to answer is asked of a running world or it is not asked at
// all: against invented keys it is a node test, which is a proof of the reading and no answer about
// the game. But three hooks for one subject is two too many, so the game's one shader hook carries
// it and nothing here installs anything.
