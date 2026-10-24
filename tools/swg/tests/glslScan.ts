// What a node test can say about a shader it cannot compile. Node compiles no GLSL, so a test that pins a
// shader by its text pins its words and not its program: the blade glow pass once declared `own` twice in
// one scope of `bladeLight`, which every GLSL compiler refuses, and the whole pass stayed unlinked in every
// browser while every test passed. These helpers are shared by the tests that read a shader's text
// (`bladeGlow.test.ts`, `ssao.test.ts`, `airShaders.test.ts`): one GLSL function's text, the source as one variant of
// its `#ifdef` branches would be compiled, and the one fault a compiler refuses that no type check here sees.
//
// And the volumetrics handoff's two checkers, ported (there is no Python on this machine, and theirs examined none of the
// game's own shader strings): a reserved word used as a name, unbalanced brackets, one of three's chunks included before
// what it reads is declared, a size written into the text, and a uniform a shader declares that its material does not
// (`reservedWords`, `unbalanced`, `chunkBeforeNeeds`, `sizesInText`, `uniformNames`).

/** One GLSL function's whole text, from its return type to its closing brace; '' when there is none. */
export function glslFunction(glsl: string, name: string): string {
  const m = new RegExp(`\\b\\w+\\s+${name}\\s*\\(`).exec(glsl);
  if (!m) return '';
  const open = glsl.indexOf('{', m.index + m[0].length);
  if (open < 0) return '';
  let depth = 0;
  for (let j = open; j < glsl.length; j++) {
    if (glsl[j] === '{') depth++;
    else if (glsl[j] === '}' && --depth === 0) return glsl.slice(m.index, j + 1);
  }
  return '';
}

/**
 * The source as it would be compiled with these names defined: each `#ifdef` / `#ifndef` keeps the branch
 * the names choose and drops the other, `#else` swapping them, `#endif` closing. Any other `#if` keeps its
 * first branch and drops every `#elif` and `#else` after it, which is enough for a scan and is said here so
 * nobody reads more into it. The kept lines are returned as they were, since `redeclared` steps over
 * directives itself.
 */
export function glslVariant(glsl: string, defined: ReadonlySet<string>): string {
  const out: string[] = [];
  // One entry per open conditional: whether its current branch is kept, and whether a branch of it already was.
  const stack: { keep: boolean; taken: boolean }[] = [];
  const kept = () => stack.every((s) => s.keep);
  for (const line of glsl.split('\n')) {
    const d = /^\s*#\s*(ifdef|ifndef|if|else|elif|endif)\b\s*(\w*)/.exec(line);
    if (!d) {
      if (kept()) out.push(line);
      continue;
    }
    if (d[1] === 'ifdef' || d[1] === 'ifndef' || d[1] === 'if') {
      const keep = d[1] === 'ifdef' ? defined.has(d[2]) : d[1] === 'ifndef' ? !defined.has(d[2]) : true;
      stack.push({ keep, taken: keep });
    } else if (d[1] === 'else' || d[1] === 'elif') {
      const top = stack[stack.length - 1];
      if (top) {
        top.keep = d[1] === 'else' && !top.taken;
        top.taken = top.taken || top.keep;
      }
    } else stack.pop();
  }
  return out.join('\n');
}

/**
 * Every name a GLSL source declares twice in one scope, as `function: name`. A small scanner and not a
 * compiler: it follows braces, a function's parameters (which share its body's scope in GLSL ES 3.00),
 * a for loop's own scope, and declarations of the built-in types, which is all these shaders write.
 * Where it is unsure it opens a new scope, so it can miss a fault but never invents one -- with one
 * exception it cannot see past: both branches of an `#ifdef` are read as one body, so a shader with
 * branches is scanned one variant at a time (`glslVariant`).
 */
export function redeclared(glsl: string): string[] {
  const text = glsl
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/^\s*#[^\n]*/gm, ' ');
  const tokens = text.match(/[A-Za-z_]\w*|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+|\S/g) ?? [];
  const TYPES = new Set(['void', 'bool', 'int', 'uint', 'float', 'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4', 'uvec2', 'uvec3', 'uvec4', 'bvec2', 'bvec3', 'bvec4', 'mat2', 'mat3', 'mat4', 'sampler2D', 'sampler3D', 'samplerCube', 'sampler2DShadow', 'isampler2D', 'usampler2D']);
  const QUALIFIERS = new Set(['const', 'in', 'out', 'inout', 'highp', 'mediump', 'lowp', 'uniform', 'varying', 'attribute', 'flat', 'smooth', 'centroid']);
  const isIdent = (t: string | undefined) => !!t && /^[A-Za-z_]\w*$/.test(t) && !TYPES.has(t) && !QUALIFIERS.has(t);
  type Scope = { names: Set<string>; endsFor: Scope | null; forHeader: number; single: boolean };
  const scope = (): Scope => ({ names: new Set(), endsFor: null, forHeader: -1, single: false });
  const stack: Scope[] = [scope()];
  const out: string[] = [];
  let fnName = '';
  let paren = 0;
  let params: Scope | null = null;
  let paramsParen = -1;
  let paramsDone = false;
  let afterFor: Scope | null = null;
  const declare = (into: Scope, name: string) => {
    if (into.names.has(name)) out.push(`${fnName || '(global)'}: ${name}`);
    into.names.add(name);
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (afterFor && t !== '{') {
      // A loop whose body is one statement: its scope closes at that statement's end.
      afterFor.single = true;
      afterFor = null;
    }
    if (t === 'for' && tokens[i + 1] === '(') {
      const s = scope();
      s.forHeader = paren;
      stack.push(s);
      continue;
    }
    if (t === '(') {
      paren++;
      continue;
    }
    if (t === ')') {
      paren--;
      const top = stack[stack.length - 1];
      if (top.forHeader === paren && !top.single && afterFor === null && params === null) {
        top.forHeader = -1;
        afterFor = top;
      }
      if (params && paren === paramsParen) paramsDone = true;
      continue;
    }
    if (t === '{') {
      const s = scope();
      if (params && paramsDone) {
        s.names = params.names;
        params = null;
        paramsDone = false;
      } else if (afterFor) {
        s.endsFor = afterFor;
        afterFor = null;
      }
      stack.push(s);
      continue;
    }
    if (t === '}') {
      const s = stack.pop();
      if (s?.endsFor) stack.pop();
      if (stack.length === 1) fnName = '';
      continue;
    }
    if (t === ';') {
      const top = stack[stack.length - 1];
      if (top.single && paren === 0) stack.pop();
      if (params && paramsDone) {
        // A prototype, not a definition.
        params = null;
        paramsDone = false;
      }
      continue;
    }
    if (!TYPES.has(t) || !isIdent(tokens[i + 1])) continue;
    const name = tokens[i + 1];
    const next = tokens[i + 2];
    if (next === '(' && stack.length === 1) {
      // A function: overloads may share a name, so it is not declared; its parameters wait for its body.
      fnName = name;
      params = scope();
      paramsParen = paren;
      paramsDone = false;
      i++;
      continue;
    }
    if (params && !paramsDone) {
      declare(params, name);
      i++;
      continue;
    }
    if (next === '=' || next === ';' || next === ',' || next === '[' || next === ')') {
      declare(stack[stack.length - 1], name);
      i++;
    }
  }
  return out;
}

/** The text with its comments and preprocessor lines taken out: what the word checks read. */
function codeOf(glsl: string): string {
  return glsl
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/^\s*#[^\n]*/gm, ' ');
}

/**
 * GLSL ES 3.00's reserved words (the handoff's list), which a shader may not use as names. `flat`, `smooth` and `layout`
 * are reserved as names too but are qualifiers where they stand before a declaration or a `(`, which is allowed.
 */
const RESERVED = new Set(
  'half double fixed input output filter active asm cast class common enum extern external goto inline interface long namespace noinline partition public resource row_major short sizeof static superp template this typedef union unsigned using volatile packed sample smooth flat centroid layout invariant precise subroutine noperspective buffer shared coherent restrict readonly writeonly'.split(
    ' ',
  ),
);
const QUALIFIER_WORDS = new Set(['flat', 'smooth', 'centroid', 'invariant', 'layout']);

/** Every reserved word the text uses as a name (comments and directives aside; a qualifier in its place allowed). */
export function reservedWords(glsl: string): string[] {
  const code = codeOf(glsl);
  const out = new Set<string>();
  const re = /\b([A-Za-z_]\w*)\b(\s*\(?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const w = m[1];
    if (!RESERVED.has(w)) continue;
    const after = code.slice(m.index + w.length).match(/^\s*(\S+)/)?.[1] ?? '';
    // A qualifier stands before a type or a qualifier list: `flat out vec2 x;`, `layout(location = 0) out ...`.
    if (QUALIFIER_WORDS.has(w) && (w === 'layout' ? after.startsWith('(') : /^(in|out|varying|uniform|highp|mediump|lowp|float|int|uint|vec|ivec|uvec|mat)/.test(after))) continue;
    out.add(w);
  }
  return [...out].sort();
}

/** Whether the code's braces and parentheses are unbalanced (comments and directives aside); the bracket that is off, or ''. */
export function unbalanced(glsl: string): string {
  const code = codeOf(glsl);
  const count = (c: string): number => code.split(c).length - 1;
  if (count('{') !== count('}')) return `{ ${count('{')} against } ${count('}')}`;
  if (count('(') !== count(')')) return `( ${count('(')} against ) ${count(')')}`;
  if (count('[') !== count(']')) return `[ ${count('[')} against ] ${count(']')}`;
  return '';
}

/** Names three's own chunks reach for, which the surrounding shader must have declared before including them. */
const CHUNK_NEEDS: Readonly<Record<string, readonly string[]>> = {
  fog_vertex: ['mvPosition'],
  worldpos_vertex: ['transformed'],
  normal_fragment_maps: ['normal'],
  dithering_fragment: ['gl_FragColor'],
};

/** Every chunk the text includes before declaring what it reads, as `chunk: name`. */
export function chunkBeforeNeeds(glsl: string): string[] {
  const out: string[] = [];
  for (const [chunk, names] of Object.entries(CHUNK_NEEDS)) {
    const at = glsl.indexOf(`#include <${chunk}>`);
    if (at < 0) continue;
    const before = glsl.slice(0, at);
    for (const n of names) if (!new RegExp(`\\b${n}\\b`).test(before)) out.push(`${chunk}: ${n}`);
  }
  return out;
}

/**
 * Every number written into the code that is one of `sizes` (a grid, a field, a window), as the literal and where it
 * stands; a number only as an array's size (`[128]`) or a loop's bound (`< 48`, `<= 48`) is allowed, which is the one
 * place a `MAX_*` constant may appear.
 */
export function sizesInText(glsl: string, sizes: readonly number[]): string[] {
  const code = codeOf(glsl);
  const out: string[] = [];
  const re = /(?<![\w.])(\d+(?:\.\d*)?|\.\d+)(?![\w.])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const v = Number(m[1]);
    if (!sizes.includes(v)) continue;
    const before = code.slice(Math.max(0, m.index - 3), m.index);
    const after = code.slice(m.index + m[1].length, m.index + m[1].length + 1);
    if (before.endsWith('[') && after === ']') continue;
    if (/<=?\s?$/.test(before)) continue;
    out.push(`${m[1]} at "${code.slice(Math.max(0, m.index - 24), m.index + m[1].length + 8).replace(/\s+/g, ' ').trim()}"`);
  }
  return out;
}

/** GLSL ES 3.00's own functions, constructors and keywords that stand before a `(` (what a shader may call without defining). */
const GLSL_CALLABLE = new Set(
  'if for while return switch texture texture2D textureLod textureGrad texelFetch textureSize textureProj vec2 vec3 vec4 ivec2 ivec3 ivec4 uvec2 uvec3 uvec4 bvec2 bvec3 bvec4 mat2 mat3 mat4 float int uint bool max min clamp mix step smoothstep exp exp2 log log2 pow sqrt inversesqrt abs sign floor ceil fract mod round trunc dot cross length distance normalize reflect refract sin cos tan asin acos atan sinh cosh tanh degrees radians any all not isnan isinf lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual fwidth dFdx dFdy transpose inverse determinant outerProduct floatBitsToInt intBitsToFloat packHalf2x16 unpackHalf2x16 layout'.split(' '),
);

/**
 * Every function the code calls that is neither GLSL's own nor defined in the text (comments and directives aside): a
 * pass that calls a helper only another pass's text defines compiles in no browser, and node compiles nothing (the
 * dust pass once called `finite4` with no `finite4` of its own and stayed unlinked).
 */
export function undefinedCalls(glsl: string): string[] {
  const code = codeOf(glsl);
  const defined = new Set<string>();
  const def = /\b[A-Za-z_]\w*\s+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = def.exec(code))) defined.add(m[1]);
  const out = new Set<string>();
  const call = /\b([A-Za-z_]\w*)\s*\(/g;
  while ((m = call.exec(code))) {
    const n = m[1];
    if (GLSL_CALLABLE.has(n) || defined.has(n)) continue;
    out.add(n);
  }
  return [...out].sort();
}

/** Every uniform a GLSL text declares, by name (arrays by their name alone). */
export function uniformNames(glsl: string): string[] {
  const out = new Set<string>();
  const re = /^\s*uniform\s+(?:(?:highp|mediump|lowp)\s+)?\w+\s+(\w+)\s*(?:\[[^\]]*\])?\s*;/gm;
  const plain = codeOf(glsl);
  let m: RegExpExecArray | null;
  while ((m = re.exec(plain))) out.add(m[1]);
  return [...out].sort();
}

/**
 * The handoff's second checker, ported to this repository's own shape: in a TypeScript source, every write
 * `<name>.uniforms.<key>` and, through an alias `const <a> = <x>.<name>.uniforms;` (or `= this.<name>.uniforms;`),
 * every `<a>.<key>`, each with the materials it may be written to (an alias name reused for several materials in
 * several functions stands for all of them, and a key is accepted if any of them declares it, as the handoff's did),
 * so a test can hold each to the uniforms the material really has.
 */
export function uniformWrites(ts: string): { materials: string[]; key: string; via: string }[] {
  const out: { materials: string[]; key: string; via: string }[] = [];
  const seen = new Set<string>();
  const add = (materials: string[], key: string, via: string) => {
    const k = `${materials.join('/')}.${key}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ materials, key, via });
  };
  const direct = /\b(\w+)\.uniforms\.(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = direct.exec(ts))) add([m[1]], m[2], `${m[1]}.uniforms`);
  const aliases = new Map<string, Set<string>>();
  const alias = /const (\w+) = (?:[\w.]*\.)?(\w+)\.uniforms;/g;
  while ((m = alias.exec(ts))) {
    if (!aliases.has(m[1])) aliases.set(m[1], new Set());
    aliases.get(m[1])!.add(m[2]);
  }
  for (const [a, mats] of aliases) {
    const use = new RegExp(`\\b${a}\\.((?:u|t)[A-Z]\\w*)\\b`, 'g');
    let u: RegExpExecArray | null;
    while ((u = use.exec(ts))) add([...mats].sort(), u[1], a);
  }
  return out;
}
