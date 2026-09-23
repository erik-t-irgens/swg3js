// Knowing what the shader compiler is doing, and standing up to a slow one.
//
// Three things live here, and nothing else in the game needs to know how any of them work:
//
//  1. `ProgramWatch` — which programs the renderer holds, which appeared on which frame and which
//     went, by id and by cache key. The renderer's own `info.programs.length` is a net figure: a
//     frame that made forty and dropped forty looks like a quiet one, and that is exactly the frame
//     worth catching. It is sampled once a frame, so the steady path allocates nothing and does no
//     more work than one index loop over the live list.
//  2. `readKey` — what actually makes one program differ from the next, read off three's own cache
//     key. Three joins the key with commas and NEITHER end of it is a fixed length: the front is a
//     shader id and then every define, and the last field of all is the material's own key, whose
//     default in three is the source text of its `onBeforeCompile`. So the fixed run in the middle
//     is found by anchoring on the one field that can only be one of three words and then checking
//     that the forty-odd fields which must be whole numbers are; a key that never passes is
//     reported unread rather than guessed at. Everything downstream — the console, the debug hook
//     and the counts grouped by light signature — reads the facts, never the string.
//  3. `probeCompiler` — how dear a program is on THIS machine, measured once behind the loading
//     screen. On the machine this work was done for, building one costs a flat third of a second
//     whatever the shader is, and a world holds a couple of hundred of them; on another machine the
//     same programs cost a millisecond each. Nothing about how the game looks may depend on the
//     answer: it decides only how hard the game paces itself and what the loading screen admits to.
//
// This file has no imports at all, on purpose: a node test drives every rule in it directly, and
// the one function that needs a GPU takes the context as an argument.

/** One live program, as three's `renderer.info.programs` reports it. */
export interface ProgramRow {
  id: number;
  name: string;
  cacheKey: string;
  /** The material type the program was built for (`MeshStandardMaterial`, `ShaderMaterial`, …). */
  type?: string;
  /** How many materials share it. */
  usedTimes?: number;
}

/**
 * Where the game was when a program appeared. Only `play` is a stall the player sees, and it is the
 * one figure this whole file exists to get right — so the four must be told apart by one rule in one
 * place (`App.shaderPhase`), never by each caller's own idea of what counts as playing:
 *
 *  - `boot` — no world at all: the select screen, the creator, the character preview's own context.
 *    The fourteen programs a session holds before it has ever loaded a planet are these.
 *  - `loading` — a loading screen is up, or a travel is under way: the player is waiting on purpose.
 *  - `covered` — the game is playing but the frame is not the player's to see: the effects switching
 *    over, or the white of a hyperspace jump, where programs are made deliberately and unseen.
 *  - `play` — a live frame with the world in front of the player. A program built here is a dropped
 *    frame at best, and on a slow compiler a freeze.
 */
export type ProgramPhase = 'boot' | 'loading' | 'play' | 'covered';

/**
 * Every number here is ours, and every one of them is about the machine rather than the game.
 *
 * `quickMs` and `slowMs` are the two ends of the probe's verdict. The machine this work was done
 * for measured about 300 ms a program with a half-removed display driver and about 2 ms once it was
 * reinstalled; a program Chrome's own disk cache serves back costs about 9 ms, and this machine
 * measures 9 to 10 ms in a tab that is not on screen. So anything under `quickMs` is a machine that
 * needs none of this, anything over `slowMs` is one where a careless frame is a visible freeze, and
 * the band between is a machine that wants the pacing but not the apology.
 *
 * `quickMs` is 20 rather than the 8 it was first written with, because 8 sits inside the spread of
 * a machine with nothing whatever wrong with it: measured here, a healthy driver came to 9.2 and
 * 9.8 ms and was called `fair`, which would have had the loading screen explaining itself to a
 * player who had nothing to wait for. Two hundred programs at 20 ms is four seconds behind a screen
 * that is up anyway; there is nothing to say until a program costs more than that.
 */
export const SHADER_TUNE = {
  /** Under this, a program is cheap enough that pacing is a formality and nothing is said. */
  quickMs: 20,
  /** At or over this, a program made on a live frame is a freeze the player will see. */
  slowMs: 60,
  /** How many trivial programs the probe may build. The first is always built; the rest only if the first was not quick. */
  probeMax: 3,
  /** How many programs a frame may build in ordinary play. One, so a slow compiler costs a dropped frame. */
  playBudget: 1,
  /** How many a frame may build while a loading screen is up and the player is waiting on purpose. */
  loadBudget: 8,
  /**
   * The same on a machine where a program is slow to build. Fewer, not more: behind a screen the
   * frames are nobody's to see, but the line under the title and the bar are, and eight programs at
   * a third of a second each is two and a half seconds in which the screen says nothing and moves
   * nothing — which is the very thing that makes a long load look like a hung one.
   */
  hardLoadBudget: 2,
  /**
   * How many distinct cache keys the watch remembers having built.
   *
   * It is a cap because nothing tells the watch when the renderer lets a program go, and the key it
   * remembers is not a short name: three's default is the whole source text of the material's
   * `onBeforeCompile`, which in this game is the shadow cascades' hook or the wet wrap's — kilobytes
   * apiece. Left alone, a session that travels between worlds all evening would hold every key it
   * ever saw, long after the renderer let the program go, and the two hooks that walk this map
   * (`remade`, `builtInPlay`) would grow slower with the session rather than with the live list.
   * Past this the least recently built is forgotten, and how many have been forgotten is reported
   * rather than hidden: a tally that has quietly lost its oldest rows is worse than one that says
   * so. Four hundred is comfortably more than the 245 a settled world holds.
   */
  historyMax: 400,
};

export type CompilerSpeed = 'quick' | 'fair' | 'slow' | 'unknown';

export interface CompilerVerdict {
  /** What one new program costs on this machine, in milliseconds; 0 until the probe has run. */
  msPerProgram: number;
  speed: CompilerSpeed;
  /** How many programs a frame may be built in play. */
  budget: number;
  /** True on a machine where everything that can be deferred should be. */
  hard: boolean;
  /** How many trivial programs the probe built, and what each cost. */
  samples: number[];
  /** Whether the probe has run at all this session. */
  measured: boolean;
  /** Why the probe did not run, when it did not. */
  why: string;
}

// ---------------------------------------------------------------------------------------------
// Reading three's cache key.
//
// `WebGLPrograms.getProgramCacheKey` builds an array and joins it with commas. Neither end of that
// array is a fixed length, which is the whole difficulty:
//
//  - the front is a shader id (or two custom ids) and then every define as a name and a value, so
//    counting forward lands nowhere;
//  - and the LAST field is the material's own `customProgramCacheKey`, whose default in three is
//    `this.onBeforeCompile.toString()` — the source text of the hook, commas, newlines and all. So
//    counting backward from the end lands nowhere either, and on this game, where nearly every
//    material carries a hook (the shadow cascades put one on and the wet wrap another), counting
//    back from the end read 168 of 169 live programs wrongly.
//
// What is fixed is the run of 51 fields between them, beginning at `precision`, which is always one
// of three words. So the run is found by trying each of those words as a starting point and then
// checking that every field in the run is one of the few things three can write there. A define
// whose value happened to be the word `highp`, or a hook whose source contained it, fails that
// check and the search goes on; a key that never passes it is reported unread rather than guessed
// at.
//
// What three really writes there was read off the running game rather than assumed, and the first
// cut of this file assumed it wrongly: it expected the word `undefined` where a field is unset and
// so read **none** of a world's 222 keys. `array.join()` writes an empty string for undefined and
// null, and three's own parameters are mostly not numbers at all — a map's UV set is
// `HAS_MAP && getChannel(...)`, so it is the word `false` when there is no such map and `uv`, `uv1`
// … when there is; `envMapMode` is `false` or a mapping number; `envMapCubeUVHeight` and `combine`
// are empty when unset; `fogExp2` and `sizeAttenuation` are always `true` or `false`; and
// `morphAttributeCount` is pushed but never set, so it is always empty. Only eighteen of the run's
// fields are whole numbers. The node test beside this reads three's own source for the order and
// drives the reader on keys captured from the running game, so the same mistake cannot be made
// twice in silence.

/** Where each field sits, counted forward from `precision`. */
const AT = {
  precision: 0,
  outputColorSpace: 1,
  envMapMode: 2,
  envMapCubeUVHeight: 3,
  /** 23 per-map UV-set fields, 4 to 26. */
  firstMapUv: 4,
  lastMapUv: 26,
  combine: 27,
  fogExp2: 28,
  sizeAttenuation: 29,
  morphTargetsCount: 30,
  morphAttributeCount: 31,
  numDirLights: 32,
  numPointLights: 33,
  numSpotLights: 34,
  numSpotLightMaps: 35,
  numHemiLights: 36,
  numRectAreaLights: 37,
  numDirLightShadows: 38,
  numPointLightShadows: 39,
  numSpotLightShadows: 40,
  numSpotLightShadowsWithMaps: 41,
  numLightProbes: 42,
  shadowMapType: 43,
  toneMapping: 44,
  numClippingPlanes: 45,
  numClipIntersection: 46,
  depthPacking: 47,
  mask1: 48,
  mask2: 49,
  rendererColorSpace: 50,
  /** The material's own key, which is everything from here to the end however many commas it holds. */
  custom: 51,
} as const;

/** The bits of the first of three's two boolean masks, by the name of the parameter each stands for. */
const MASK1 = { instancing: 0, matcap: 3, envMap: 4, alphaTest: 9, vertexColors: 10, vertexAlphas: 11, vertexTangents: 15, alphaHash: 17, batching: 18 } as const;
/** The bits of the second mask. */
const MASK2 = { fog: 0, useFog: 1, flatShading: 2, skinning: 5, morphTargets: 6, premultipliedAlpha: 9, shadowMapEnabled: 10, doubleSided: 11, flipSided: 12, dithering: 14, transmission: 15, opaque: 17, alphaToCoverage: 21 } as const;

/** What one program differs from the next by, read off its cache key. */
export interface KeyFacts {
  /** The light counts in the words the design uses: "4 dir, 4 point, 1 dirShadow, 3 spotShadows". */
  lights: string;
  dirLights: number;
  pointLights: number;
  spotLights: number;
  hemiLights: number;
  dirShadows: number;
  pointShadows: number;
  spotShadows: number;
  shadowMap: boolean;
  fog: boolean;
  skinning: boolean;
  instancing: boolean;
  alphaTest: boolean;
  vertexColors: boolean;
  envMap: boolean;
  /** Which face, in the word the design uses: a material that differs only by this is worth chasing. */
  side: 'front' | 'back' | 'double';
  /** The cube-UV height that CLAUDE.md warns is in the key: a reflective material whose environment changes height recompiles. */
  envHeight: string;
  toneMapping: string;
  clipping: number;
  /** The shadow cascades' own define, read off the defines rather than the whole key. */
  cascades: boolean;
  /** The wet-surface wrap, read off the front of the material's own key. */
  wet: boolean;
  /** Every define's name, in the order three wrote them: the head of the key, which is this game's own. */
  defines: string[];
  /** What the material added to the key itself, short enough to read and to group by. */
  custom: string;
  /**
   * How long the material's own key really is. Three's default is the source text of the material's
   * `onBeforeCompile`, so a material with a hook is keyed on the hook's whole source: worth knowing,
   * since two hooks that differ by a comment are two programs.
   */
  customLength: number;
}

const PRECISIONS = ['highp', 'mediump', 'lowp'];

function whole(text: string | undefined): number {
  if (text === undefined) return -1;
  // `Number('')` is 0 and `Number(' 1 ')` is 1; neither is a field three wrote, so both are refused.
  if (text.length === 0 || text !== text.trim()) return -1;
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 && n < 100000 ? n : -1;
}

/** A whole number, or the empty field `array.join()` writes for an unset parameter. */
function wholeOrUnset(text: string | undefined): boolean {
  return text === '' || whole(text) >= 0;
}

/**
 * One of three's two boolean masks. They are whole numbers like every other count in the run, but
 * they are *bit fields* and run past two million, so they cannot be read with the small bound the
 * counts are read with: every real key in the game carries a mask of 8388608 or more.
 */
function maskField(text: string | undefined): number {
  if (text === undefined || text.length === 0 || text !== text.trim()) return -1;
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 && n <= 0x7fffffff ? n : -1;
}

/** The two words three writes for a boolean parameter. */
function boolField(text: string | undefined): boolean {
  return text === 'true' || text === 'false';
}

/**
 * A map's UV set: the word `false` where the material has no such map, or the channel name
 * `getChannel` makes — `uv` for channel 0 and `uv1`, `uv2` … above it.
 */
function uvField(text: string | undefined): boolean {
  if (text === 'false' || text === '') return true;
  if (text === undefined || !text.startsWith('uv')) return false;
  return text.length === 2 || whole(text.slice(2)) >= 0;
}

/**
 * Where the fixed run begins in a split key, or -1 when no place in it holds one.
 *
 * Each `highp`, `mediump` or `lowp` in the key is tried in turn, and every field of the run is
 * checked against the few things three can write in it: the UV sets against `false` and the channel
 * names, the two flags against `true` and `false`, and the eighteen counts against whole numbers.
 * One of those words inside a define or inside a hook's source text fails the check and the search
 * goes on to the next; a raw shader material, whose key has no such run at all, fails every one of
 * them and is reported unread.
 */
function findRun(parts: readonly string[]): number {
  for (let i = 0; i + AT.custom < parts.length; i++) {
    if (!PRECISIONS.includes(parts[i])) continue;
    // The environment map's kind and the height of its cube: a number when there is one, `false`
    // and empty when there is not.
    let good = (boolField(parts[i + AT.envMapMode]) || whole(parts[i + AT.envMapMode]) >= 0) && wholeOrUnset(parts[i + AT.envMapCubeUVHeight]);
    for (let u = AT.firstMapUv; good && u <= AT.lastMapUv; u++) good = uvField(parts[i + u]);
    // How an environment map is combined (unset on all but the old materials), then the two flags.
    if (good) good = wholeOrUnset(parts[i + AT.combine]) && boolField(parts[i + AT.fogExp2]) && boolField(parts[i + AT.sizeAttenuation]);
    // The morph targets, every light count, the shadow and tone-mapping kinds and the clipping: all
    // of them whole numbers. `morphAttributeCount` is pushed by three and never set, so it is empty.
    if (good) good = whole(parts[i + AT.morphTargetsCount]) >= 0 && wholeOrUnset(parts[i + AT.morphAttributeCount]);
    for (let w = AT.numDirLights; good && w <= AT.numClipIntersection; w++) good = whole(parts[i + w]) >= 0;
    // The depth packing is a number today and was a boolean before; both are allowed, since neither
    // is anything else. Then the two masks, which are always numbers.
    if (good) good = (wholeOrUnset(parts[i + AT.depthPacking]) || boolField(parts[i + AT.depthPacking])) && maskField(parts[i + AT.mask1]) >= 0 && maskField(parts[i + AT.mask2]) >= 0;
    if (good) return i;
  }
  return -1;
}

/** What a define is called: a name in the C preprocessor's sense, which is a JavaScript one too. */
const DEFINE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Every define's name, off the head of the key: a shader id and then each define as a name and a
 * value, both pushed into the same array and joined with commas.
 *
 * Two things about the head are not what they look like, and the first cut of this read both wrongly
 * by counting its length and taking the parity:
 *
 *  1. **How many ids it opens with is in the head itself, not in its length.** Three pushes one
 *     `shaderID` — a word, `physical`, `standard`, `sprite`, `depth` … — for a material built from
 *     its own shader library, and two numeric ids for one carrying its own pair of shaders. So the
 *     head opens with two ids exactly when its first field is a whole number, which a shader's name
 *     can never be and a define's name can never be either. Counting from the wrong one reads every
 *     define's value as its name.
 *  2. **A value may carry a comma.** `vec2(1,2)` is one value to three and two fields after the
 *     join, and from there on the pairs are one field out of step — which is what the parity trick
 *     really broke on, since an extra field flips the parity as surely as a second id does. Nothing
 *     in this game writes such a define today; this is what happens the day something does. The
 *     walk below steps two at a time while the field it lands on could be a name and one at a time
 *     while it could not, so a comma inside a value costs that one define's own name and nothing
 *     after it. A value that both carries a comma and whose tail reads as a name of its own (a
 *     `vec2(a,b)` written with words rather than numbers) would still shift the rest; the fields
 *     cannot be told apart at all in that case, and `__debug.shaders({ full: true, raw: true })`
 *     prints the whole key for anyone who needs to see it.
 */
function readDefines(head: readonly string[]): string[] {
  const defines: string[] = [];
  const start = whole(head[0]) >= 0 ? 2 : 1;
  for (let d = start; d < head.length - 1; ) {
    if (DEFINE_NAME.test(head[d])) {
      defines.push(head[d]);
      d += 2;
    } else d += 1;
  }
  return defines;
}

/**
 * Three's own default key, which is the source text of `Material.onBeforeCompile` — an empty method.
 * Nearly every material in a world writes it, so it means "this material added nothing of its own"
 * and is read as no key at all rather than as a key shared by two hundred programs.
 */
const EMPTY_HOOK = /^onBeforeCompile\s*\([^)]*\)\s*\{\s*\}$/;

/** A material's own key, collapsed to something a console line and a grouping can both use. */
function shortCustom(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat === 'undefined' || flat === '' || EMPTY_HOOK.test(flat)) return '';
  return flat.length <= 60 ? flat : `${flat.slice(0, 57)}…`;
}

/** True when a material added nothing of its own to the key (see `EMPTY_HOOK`). */
function noKeyOfItsOwn(text: string): boolean {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat === 'undefined' || flat === '' || EMPTY_HOOK.test(flat);
}

/**
 * What a cache key says the program is, or null when no part of it holds the fixed run.
 *
 * Null is not a failure worth a warning: a raw shader material writes a key of its own shape
 * entirely. Everything that shows these facts falls back to the name three gave the program, and
 * `__debug.shaders({ full: true })` prints the raw key of anything that could not be read, which is
 * the only way to find out why.
 */
export function readKey(cacheKey: string): KeyFacts | null {
  const parts = cacheKey.split(',');
  const i = findRun(parts);
  if (i < 0) return null;
  const at = (offset: number): string => parts[i + offset];
  const mask1 = maskField(at(AT.mask1));
  const mask2 = maskField(at(AT.mask2));
  const dir = whole(at(AT.numDirLights));
  const point = whole(at(AT.numPointLights));
  const spot = whole(at(AT.numSpotLights));
  const hemi = whole(at(AT.numHemiLights));
  const dirShadow = whole(at(AT.numDirLightShadows));
  const pointShadow = whole(at(AT.numPointLightShadows));
  const spotShadow = whole(at(AT.numSpotLightShadows));
  const bit1 = (b: number): boolean => (mask1 & (1 << b)) !== 0;
  const bit2 = (b: number): boolean => (mask2 & (1 << b)) !== 0;
  const doubleSided = bit2(MASK2.doubleSided);
  const flipSided = bit2(MASK2.flipSided);
  // Everything from here to the end is the material's own key, commas and all.
  const custom = parts.slice(i + AT.custom).join(',');
  const head = parts.slice(0, i);
  const defines = readDefines(head);
  return {
    lights: lightWords(dir, point, spot, hemi, dirShadow, pointShadow, spotShadow),
    dirLights: dir,
    pointLights: point,
    spotLights: spot,
    hemiLights: hemi,
    dirShadows: dirShadow,
    pointShadows: pointShadow,
    spotShadows: spotShadow,
    shadowMap: bit2(MASK2.shadowMapEnabled),
    fog: bit2(MASK2.fog),
    skinning: bit2(MASK2.skinning),
    instancing: bit1(MASK1.instancing),
    alphaTest: bit1(MASK1.alphaTest),
    vertexColors: bit1(MASK1.vertexColors),
    envMap: bit1(MASK1.envMap),
    side: doubleSided ? 'double' : flipSided ? 'back' : 'front',
    // Empty where the material's environment map is not a cube-UV one; three writes the height only
    // for those, and CLAUDE.md records why a change of it costs every such material its program.
    envHeight: at(AT.envMapCubeUVHeight) === '' ? 'none' : at(AT.envMapCubeUVHeight),
    toneMapping: at(AT.toneMapping),
    clipping: whole(at(AT.numClippingPlanes)),
    // The cascades write a define (`CSM.setupMaterial` sets `USE_CSM`), so they are looked for among
    // the defines rather than in the whole key: the key's tail is a hook's source text, which could
    // mention anything. The wet wrap writes the front of the material's own key.
    cascades: head.includes('USE_CSM'),
    wet: custom.startsWith('wet-object|') || custom.startsWith('swg-ground-wet-'),
    defines,
    custom: shortCustom(custom),
    customLength: noKeyOfItsOwn(custom) ? 0 : custom.length,
  };
}

/** The light counts in the words the design uses, leaving out whatever is zero. */
export function lightWords(dir: number, point: number, spot: number, hemi: number, dirShadow: number, pointShadow: number, spotShadow: number): string {
  let out = '';
  const add = (count: number, what: string): void => {
    if (count <= 0) return;
    out = out.length ? `${out}, ${count} ${what}` : `${count} ${what}`;
  };
  add(dir, 'dir');
  add(point, 'point');
  add(spot, 'spot');
  add(hemi, 'hemi');
  add(dirShadow, dirShadow === 1 ? 'dirShadow' : 'dirShadows');
  add(pointShadow, pointShadow === 1 ? 'pointShadow' : 'pointShadows');
  add(spotShadow, spotShadow === 1 ? 'spotShadow' : 'spotShadows');
  return out.length ? out : 'no lights';
}

/**
 * A short name for a program, for the one line the console writes when one is built during play.
 * Three's own `shaderName` is empty on most materials, so the type and what makes it differ carry
 * the rest of it.
 */
export function programLabel(row: ProgramRow, facts: KeyFacts | null): string {
  const named = row.name && row.name !== 'undefined' ? row.name : row.type || 'a material';
  if (!facts) return named;
  const marks: string[] = [];
  if (facts.skinning) marks.push('skinned');
  if (facts.instancing) marks.push('instanced');
  if (facts.side !== 'front') marks.push(facts.side + '-sided');
  if (facts.alphaTest) marks.push('alpha-tested');
  if (facts.cascades) marks.push('cascades');
  if (facts.wet) marks.push('wet');
  if (facts.custom && !facts.wet) marks.push(facts.custom);
  const tail = marks.length ? ` (${marks.join(', ')})` : '';
  return `${named} · ${facts.lights}${tail}`;
}

// ---------------------------------------------------------------------------------------------
// The watch.

/** What one sample of the live list found. The object is kept and filled in place. */
export interface SampleResult {
  made: number;
  dropped: number;
  live: number;
  /** The first new program of this sample, already in words; empty when nothing was made. */
  first: string;
  /** True when this sample did the full comparison rather than taking the cheap way out. */
  walked: boolean;
}

interface KeyRecord {
  made: number;
  label: string;
  firstAt: number;
  lastAt: number;
  phase: ProgramPhase;
}

/**
 * Which programs the renderer holds, sampled once a frame.
 *
 * The cheap path is the point. Three hands out program ids from one counter that only goes up, so
 * a sample whose highest id is the highest already seen, and whose length has not changed, made
 * nothing and dropped nothing — one index loop, no allocation, no set walked. Only a sample that
 * really changed pays for the comparison, and that frame has already lost its budget to the
 * driver.
 */
export class ProgramWatch {
  /** Every id live at the last sample. */
  private readonly seen = new Set<number>();
  /** Scratch for the ids live at this sample; kept so a changed sample allocates no set of its own. */
  private readonly live = new Set<number>();
  /**
   * The cache keys built, with how often each has been built and when it first was: the most
   * recently built `SHADER_TUNE.historyMax` of them, oldest first, since a Map walks in the order
   * its keys were put in and a rebuilt key is put in again at the end. See `historyMax` for why it
   * is capped at all.
   */
  private readonly history = new Map<string, KeyRecord>();
  /** How many keys the cap has dropped, so no figure read off the history is quietly short. */
  private forgotten = 0;
  private highestId = -1;
  private lastLength = -1;
  /** How many programs were built in each phase of the session. */
  private readonly byPhase: Record<ProgramPhase, number> = { boot: 0, loading: 0, play: 0, covered: 0 };
  private madeEver = 0;
  private droppedEver = 0;
  /** The result object, handed back filled rather than made afresh each frame. */
  private readonly result: SampleResult = { made: 0, dropped: 0, live: 0, first: '', walked: false };
  /** What has been built since the last `takeSince()`; the console's "what did that bench do" question. */
  private sinceMark = 0;

  /**
   * Take one sample. `rows` is the renderer's own live list, which is read and never kept.
   * `now` is a clock in milliseconds; the watch never reads one itself, so a test can drive it.
   */
  sample(rows: readonly ProgramRow[], phase: ProgramPhase, now: number): SampleResult {
    const out = this.result;
    out.made = 0;
    out.dropped = 0;
    out.live = rows.length;
    out.first = '';
    out.walked = false;
    // The cheap path: one pass for the highest id, no allocation and nothing kept.
    let highest = -1;
    for (let i = 0; i < rows.length; i++) if (rows[i].id > highest) highest = rows[i].id;
    if (highest <= this.highestId && rows.length === this.lastLength) return out;
    out.walked = true;
    this.highestId = highest;
    this.lastLength = rows.length;
    // Something really changed: compare by id, which is the only way to see a frame that made and
    // dropped in equal measure.
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (this.seen.has(row.id)) continue;
      out.made++;
      this.madeEver++;
      this.byPhase[phase]++;
      const facts = readKey(row.cacheKey);
      const label = programLabel(row, facts);
      if (!out.first) out.first = label;
      const had = this.history.get(row.cacheKey);
      if (had) {
        had.made++;
        had.lastAt = now;
        had.phase = phase;
        // Taken out and put back so the map's own order is "least recently built first", which is
        // what makes the eviction below one lookup rather than a walk.
        this.history.delete(row.cacheKey);
        this.history.set(row.cacheKey, had);
      } else {
        this.history.set(row.cacheKey, { made: 1, label, firstAt: now, lastAt: now, phase });
        if (this.history.size > SHADER_TUNE.historyMax) {
          const oldest = this.history.keys().next();
          if (!oldest.done) {
            this.history.delete(oldest.value);
            this.forgotten++;
          }
        }
      }
    }
    // What went: the live ids into a set kept for the purpose, then the previous sample's ids read
    // against it. Both sets are cleared and refilled rather than made afresh, since a world holds a
    // couple of hundred of these and a changed sample can come every frame while a world streams in.
    const live = this.live;
    live.clear();
    for (let i = 0; i < rows.length; i++) live.add(rows[i].id);
    for (const id of this.seen) {
      if (live.has(id)) continue;
      out.dropped++;
      this.droppedEver++;
    }
    this.seen.clear();
    for (const id of live) this.seen.add(id);
    return out;
  }

  /** How many programs have been built since this was last called. */
  takeSince(): number {
    const made = this.madeEver - this.sinceMark;
    this.sinceMark = this.madeEver;
    return made;
  }

  get totals(): { made: number; dropped: number; forgotten: number; keys: number; byPhase: Record<ProgramPhase, number> } {
    // `made` and `dropped` are counters and are exact for the whole session however long it runs.
    // `forgotten` and `keys` are about the per-key history alone, which is capped: anything read out
    // of `remade` or `builtInPlay` is the most recent `keys` of them, and `forgotten` is how many
    // older ones are no longer there to be read.
    return { made: this.madeEver, dropped: this.droppedEver, forgotten: this.forgotten, keys: this.history.size, byPhase: { ...this.byPhase } };
  }

  /**
   * The cache keys built more than once. A key here is a program the cache let go and something
   * asked for straight back, which is the whole cost again each time round.
   */
  remade(limit = 20): { made: number; label: string; key: string }[] {
    const out: { made: number; label: string; key: string }[] = [];
    for (const [key, rec] of this.history) if (rec.made > 1) out.push({ made: rec.made, label: rec.label, key });
    out.sort((a, b) => b.made - a.made);
    return out.slice(0, limit);
  }

  /**
   * What was built in `play`, newest first: the list to read after a stall.
   *
   * The time is when it was **last** built, not when it was first: a key first built behind a
   * loading screen and asked for again in play belongs at the top of this list for the moment it
   * cost a live frame, not buried at the bottom under the minute the world loaded.
   */
  builtInPlay(limit = 20): { label: string; at: number; made: number }[] {
    const out: { label: string; at: number; made: number }[] = [];
    for (const rec of this.history.values()) if (rec.phase === 'play') out.push({ label: rec.label, at: Math.round(rec.lastAt), made: rec.made });
    out.sort((a, b) => b.at - a.at);
    return out.slice(0, limit);
  }
}

// ---------------------------------------------------------------------------------------------
// Grouping the live list: what the count is made of.

export interface GroupedPrograms {
  live: number;
  /** How many keys this reads and how many it could not, so a count is never quietly short. */
  read: number;
  unread: number;
  groups: Record<string, { name: string; count: number }[]>;
}

/**
 * Every live program counted by each of the things that can make one differ from the next. This is
 * the figure the design wants before anything is collapsed: a light signature with one program in
 * it is a pass nothing warmed, and a dimension with two values where one would do is a saving.
 */
export function groupPrograms(rows: readonly ProgramRow[]): GroupedPrograms {
  const dims: Record<string, Map<string, number>> = {
    lights: new Map(),
    type: new Map(),
    side: new Map(),
    fog: new Map(),
    shadows: new Map(),
    skinning: new Map(),
    instancing: new Map(),
    alphaTest: new Map(),
    vertexColors: new Map(),
    envMap: new Map(),
    cascades: new Map(),
    wet: new Map(),
    custom: new Map(),
    // Three's default `customProgramCacheKey` is the source text of the material's `onBeforeCompile`,
    // so a material with a hook is keyed on the hook's whole source and two hooks that differ by a
    // comment are two programs. This counts how many are keyed that way and how long those keys are.
    hook: new Map(),
    defines: new Map(),
  };
  const bump = (dim: string, name: string): void => {
    const m = dims[dim];
    m.set(name, (m.get(name) ?? 0) + 1);
  };
  let read = 0;
  let unread = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const facts = readKey(row.cacheKey);
    bump('type', row.type || row.name || 'unnamed');
    if (!facts) {
      unread++;
      bump('lights', 'key not read');
      continue;
    }
    read++;
    bump('lights', facts.lights);
    bump('side', facts.side);
    bump('fog', facts.fog ? 'fog' : 'no fog');
    bump('shadows', facts.shadowMap ? 'shadow maps on' : 'shadow maps off');
    bump('skinning', facts.skinning ? 'skinned' : 'rigid');
    bump('instancing', facts.instancing ? 'instanced' : 'single');
    bump('alphaTest', facts.alphaTest ? 'alpha-tested' : 'no alpha test');
    bump('vertexColors', facts.vertexColors ? 'vertex colours' : 'no vertex colours');
    bump('envMap', facts.envMap ? `environment ${facts.envHeight}` : 'no environment');
    bump('cascades', facts.cascades ? 'cascades' : 'no cascades');
    bump('wet', facts.wet ? 'wet wrap' : 'dry');
    if (facts.custom) bump('custom', facts.custom);
    bump('hook', facts.customLength === 0 ? 'no key of its own' : facts.customLength > 60 ? 'keyed on a hook\'s source' : 'a short key of its own');
    for (let d = 0; d < facts.defines.length; d++) bump('defines', facts.defines[d]);
  }
  const groups: Record<string, { name: string; count: number }[]> = {};
  for (const dim of Object.keys(dims)) {
    const list: { name: string; count: number }[] = [];
    for (const [name, count] of dims[dim]) list.push({ name, count });
    list.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    groups[dim] = list;
  }
  return { live: rows.length, read, unread, groups };
}

// ---------------------------------------------------------------------------------------------
// The machine.

/**
 * What one brand-new program costs here, measured by building trivial ones and then asking the
 * driver whether they linked — which is the call that blocks until it has really finished. Linking
 * without asking is nearly free on every machine and says nothing.
 *
 * Each probe's source carries a constant nobody has used before, so the browser's own program cache
 * cannot answer from disk: a cached program comes back in single-figure milliseconds and would tell
 * a slow machine it was a fast one. The first probe that really links is always built. A second and
 * third are built only when that first one was not quick, so the machine that needs none of this
 * pays for one trivial link and the machine that does pays twice more to be sure.
 *
 * A probe that did not link is no sample at all, never a fast one: `linkOnce` answers -1 both for a
 * context that would not build a program and for one whose driver refused the link, and a refusal
 * is timed in a fraction of a millisecond — which, taken as a measurement, would tell the very
 * machine this file exists for that it was the quickest in the world. A failure does not stop the
 * probe either: it is one of the `max` tries and the next one is still made, so a driver that
 * stumbles once is still measured.
 *
 * Nothing here binds, uses or draws with a program, so the renderer's own state cache is untouched
 * and the caller needs no save and restore.
 */
export function probeCompiler(gl: WebGLRenderingContext | WebGL2RenderingContext, seed: number, max = SHADER_TUNE.probeMax): number[] {
  const samples: number[] = [];
  for (let i = 0; i < Math.max(1, max); i++) {
    const ms = linkOnce(gl, seed + i * 7919);
    // Not a sample: the context would not build a program, or the driver would not link one.
    if (ms < 0) continue;
    samples.push(ms);
    // The first answer that is really an answer, and a quick one, is the whole probe.
    if (samples.length === 1 && ms < SHADER_TUNE.quickMs) break;
  }
  return samples;
}

/**
 * Build one throw-away program and time the blocking part. -1 when the context would not build one
 * **or when the program did not link**, which is not a fast machine and must never be read as one.
 */
function linkOnce(gl: WebGLRenderingContext | WebGL2RenderingContext, seed: number): number {
  // A number no other shader has carried, written into both stages so neither can be served from a
  // cache: the fragment's own copy is multiplied into the colour so nothing optimises it away.
  const mark = (((seed >>> 0) % 900000) + 100000) / 1000000;
  const k = mark.toFixed(6);
  const vs = `attribute vec3 position;\nuniform mat4 projectionMatrix;\nuniform mat4 modelViewMatrix;\nvoid main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position * ${k}, 1.0); }`;
  const fs = `precision mediump float;\nvoid main(){ gl_FragColor = vec4(${k}, ${k}, ${k}, 1.0); }`;
  const v = gl.createShader(gl.VERTEX_SHADER);
  const f = gl.createShader(gl.FRAGMENT_SHADER);
  const p = gl.createProgram();
  if (!v || !f || !p) {
    if (v) gl.deleteShader(v);
    if (f) gl.deleteShader(f);
    if (p) gl.deleteProgram(p);
    return -1;
  }
  let ms = -1;
  try {
    gl.shaderSource(v, vs);
    gl.shaderSource(f, fs);
    gl.compileShader(v);
    gl.compileShader(f);
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    const t0 = now();
    gl.linkProgram(p);
    // The link itself returns at once on every machine; this is the call that waits for the driver.
    // Its ANSWER matters as much as its delay: a link the driver refuses comes back in a fraction of
    // a millisecond, and timing it without reading it would file that fraction as this machine's
    // cost and call a driver too sick to link four lines of GLSL the quickest one going. So a
    // refusal is no sample, exactly as a context that would not make a program is none.
    const linked = gl.getProgramParameter(p, gl.LINK_STATUS);
    ms = linked ? now() - t0 : -1;
  } catch {
    ms = -1;
  }
  gl.detachShader(p, v);
  gl.detachShader(p, f);
  gl.deleteShader(v);
  gl.deleteShader(f);
  gl.deleteProgram(p);
  return ms;
}

function now(): number {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

/** Which band a measured cost falls in. */
export function classifyCompiler(msPerProgram: number): CompilerSpeed {
  if (!(msPerProgram > 0)) return 'unknown';
  if (msPerProgram < SHADER_TUNE.quickMs) return 'quick';
  if (msPerProgram < SHADER_TUNE.slowMs) return 'fair';
  return 'slow';
}

/**
 * The middle sample, which a single slow neighbour cannot move.
 *
 * An even number of samples has no middle sample of its own, so it takes the middle *between* the
 * two innermost. Reaching for `sorted[length / 2]` alone, as this did, is the LARGER of those two —
 * which turns the median's whole purpose inside out on a pair: the one thing it is here to throw
 * away is the outlier, and on two samples it would keep it and throw the good one away. A pair is
 * reachable whenever a probe links once, fails once and links again (the failure is no sample), and
 * the measurement this defence was written for was a 121.7 ms first link on a machine that did the
 * same work in 7.5 ms twice straight afterwards.
 */
export function middleOf(samples: readonly number[]): number {
  if (!samples.length) return 0;
  const sorted = samples.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The verdict a set of probe samples comes to, or the unmeasured one when there are none. */
export function verdictFrom(samples: readonly number[], why = ''): CompilerVerdict {
  const ms = middleOf(samples);
  const speed = classifyCompiler(ms);
  return {
    msPerProgram: Number(ms.toFixed(2)),
    speed,
    budget: SHADER_TUNE.playBudget,
    hard: speed === 'slow',
    samples: samples.slice(),
    measured: samples.length > 0,
    why: samples.length ? '' : why || 'not measured yet',
  };
}

/**
 * What one program cost, in the fewest figures that still say it: whole milliseconds once there are
 * ten of them, one decimal under that and never a trailing nought, since "about 7.50 ms" reads as a
 * measurement to four figures that nothing here could stand behind.
 */
function eachMs(v: CompilerVerdict): string {
  if (v.msPerProgram >= 10) return `${Math.round(v.msPerProgram)} ms`;
  return `${Number(v.msPerProgram.toFixed(1))} ms`;
}

/** The verdict as one sentence for the console, said once a session. */
export function verdictLine(v: CompilerVerdict): string {
  if (!v.measured) return `shaders: this machine was not measured (${v.why}); programs are paced to ${v.budget} a frame in play`;
  const each = eachMs(v);
  const counted = `${v.samples.length} probe${v.samples.length === 1 ? '' : 's'}`;
  if (v.speed === 'quick') return `shaders: this machine builds a new program in about ${each} (${counted}); nothing to work around`;
  if (v.speed === 'fair') return `shaders: this machine builds a new program in about ${each} (${counted}); programs are paced to ${v.budget} a frame in play`;
  return `shaders: this machine builds a new program in about ${each} (${counted}), which is slow enough to be seen as a freeze; programs are paced to ${v.budget} a frame in play and everything that can wait for a loading screen does`;
}

/**
 * What the loading screen says while it is building programs. On a quick machine this is the line
 * it always said; on a slow one it says why the wait is long and that it is a first visit's price,
 * because a thirty-second wait with a reason is a different thing from one that looks hung.
 */
export function loadingLine(done: number, total: number, v: CompilerVerdict): string {
  return `compiling shaders, ${done} of ${total} objects${machineAside(v)}`;
}

/**
 * What to add to a line about compiling when the machine is slow enough to be worth explaining, and
 * nothing at all when it is not. Anything that tells the player it is building shaders can end with
 * this and say the same thing in the same words: the loading screen, and the notice the Effects
 * switch puts up while it compiles the other variants in the background.
 *
 * It names the shader program every time, and never says "each one". Both lines this is added to
 * count *objects* just before it ("compiling shaders, 40 of 1403 objects"), so "each one" attaches
 * to the nearest counted noun and invites the player to multiply: 1403 objects at 305 ms is seven
 * minutes, against the couple of hundred programs a world really makes and a wait five times
 * shorter. A number a player can multiply into a figure five times too large is worse than the bare
 * count it was added to.
 */
export function machineAside(v: CompilerVerdict): string {
  if (!v.measured || v.speed === 'quick') return '';
  const each = eachMs(v);
  if (v.speed === 'fair') return ` · each new shader program takes about ${each} here; most of these objects share one already built`;
  return ` · each new shader program takes about ${each} here; most of these objects share one already built, so a first visit is slow and the next is quicker`;
}

/** The same verdict for a settings page, where there is no console to have said it once. */
export function verdictNote(v: CompilerVerdict): string {
  if (!v.measured) return '';
  const each = eachMs(v);
  if (v.speed === 'quick') return `Your browser builds a new shader in about ${each}, which is as it should be.`;
  if (v.speed === 'fair') return `Your browser builds a new shader in about ${each}. The game builds at most one a frame in play so that it costs a dropped frame rather than a pause.`;
  return `Your browser takes about ${each} to build a single shader, which is far longer than it should be and is a fault of the graphics driver rather than of the game. Loading a world for the first time is slow because of it; in play the game builds at most one a frame, so what you feel is a dropped frame rather than a pause. A newer graphics driver usually cures it.`;
}

// ---------------------------------------------------------------------------------------------
// The one verdict the session keeps.
//
// It is a module-level value on purpose: the pacing wants it from inside the streamer and the
// spawn paths, which have no line back to the game object, and it is one measurement of one
// machine rather than anything about a world.

let held: CompilerVerdict = verdictFrom([], 'not measured yet');
let probed = false;

/** What was measured, or the unmeasured verdict. Never throws and never measures anything itself. */
export function compilerVerdict(): CompilerVerdict {
  return held;
}

/**
 * How many new programs may be built on one frame: the number the program queue holds to.
 *
 * In play it is one, on every machine, since it costs a quick machine nothing to obey and it is
 * the whole difference between a dropped frame and a freeze on a slow one. Behind a loading screen
 * it is the loading allowance, or the smaller hard one where the machine is slow enough that a
 * frame's worth of building would leave the screen still and silent for seconds at a time.
 */
export function shaderBudget(loading = false): number {
  if (loading) return held.hard ? SHADER_TUNE.hardLoadBudget : SHADER_TUNE.loadBudget;
  return held.budget;
}

/** True on a machine slow enough that everything which can be deferred should be. */
export function pacingHard(): boolean {
  return held.hard;
}

/**
 * Measure this machine, once a session, behind a loading screen. Answers the verdict either way,
 * so a caller can say it in one line without asking whether it ran.
 */
export function measureCompiler(gl: WebGLRenderingContext | WebGL2RenderingContext | null, opts: { inPlay?: boolean; seed?: number } = {}): CompilerVerdict {
  if (probed) return held;
  if (opts.inPlay) {
    held = verdictFrom([], 'the probe never runs in play');
    return held;
  }
  probed = true;
  if (!gl) {
    held = verdictFrom([], 'no drawing context');
    return held;
  }
  const seed = opts.seed ?? Math.floor(Math.random() * 0x7fffffff);
  let samples: number[] = [];
  try {
    samples = probeCompiler(gl, seed);
  } catch {
    samples = [];
  }
  held = verdictFrom(samples, 'the probe could not build a program');
  return held;
}

/** For a test, and for the console's `shaders({ probe: 'again' })`: forget the measurement. */
export function forgetCompilerMeasurement(): void {
  probed = false;
  held = verdictFrom([], 'not measured yet');
}
