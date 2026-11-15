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
  'if for while return switch texture texture2D textureLod textureGrad texelFetch textureSize textureProj vec2 vec3 vec4 ivec2 ivec3 ivec4 uvec2 uvec3 uvec4 bvec2 bvec3 bvec4 mat2 mat3 mat4 float int uint bool max min clamp mix step smoothstep exp exp2 log log2 pow sqrt inversesqrt abs sign floor ceil fract mod round trunc dot cross length distance normalize reflect refract sin cos tan asin acos atan sinh cosh tanh degrees radians any all not isnan isinf lessThan lessThanEqual greaterThan greaterThanEqual equal notEqual fwidth dFdx dFdy transpose inverse determinant outerProduct floatBitsToInt intBitsToFloat floatBitsToUint uintBitsToFloat packHalf2x16 unpackHalf2x16 layout'.split(' '),
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

/** GLSL ES 3.00's own types, qualifiers and words a name never needs declaring for (beside `GLSL_CALLABLE`). */
const GLSL_WORDS = new Set(
  'const in out inout uniform varying attribute precision highp mediump lowp flat smooth void true false break continue discard else sampler2D sampler3D samplerCube sampler2DArray sampler2DShadow usampler2D isampler2D usampler2DArray gl_FragCoord gl_FragColor gl_Position gl_InstanceID gl_VertexID gl_FrontFacing struct return'.split(' '),
);
const GLSL_TYPE = /^(?:void|bool|int|uint|float|[biu]?vec[234]|mat[234](?:x[234])?|[iu]?sampler\w+|struct)$/;

/**
 * Every name a GLSL text declares after one of GLSL's own types (a variable, a parameter, a function, every name of a
 * comma list), added to `into`: what `undeclaredNames` counts as declared, handed out so a test can ask of one text (a
 * few lines the game writes into a shader of three's) whether another (the whole program round them) declares what
 * they read.
 */
export function declaredNames(glsl: string, into: Set<string> = new Set<string>()): Set<string> {
  const code = codeOf(glsl);
  // A type, then a name: every declaration, parameter and function; and every further name of a comma list after one.
  const decl = /\b([A-Za-z_]\w*)\s+([A-Za-z_]\w*)\s*([,;=)[(])/g;
  let m: RegExpExecArray | null;
  while ((m = decl.exec(code))) {
    if (!GLSL_TYPE.test(m[1])) continue;
    into.add(m[2]);
    if (m[3] === ',') {
      // `float a, b, c;` (never a parameter list, whose next word is a type)
      const rest = code.slice(decl.lastIndex).match(/^([^;(){}]*);/);
      if (rest) for (const w of rest[1].split(',')) {
        const n = w.trim().match(/^([A-Za-z_]\w*)/)?.[1];
        if (n && !GLSL_TYPE.test(n)) into.add(n);
      }
    }
  }
  return into;
}

/** The text between a `(` at `open` and the `)` that closes it; null when it never closes. */
function insideParens(text: string, open: number): string | null {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

/** How many arguments (or parameters) stand between a call's parentheses: its commas at depth nought, and one. */
function countArgs(inside: string): number {
  const s = inside.trim();
  if (s === '' || s === 'void') return 0;
  let depth = 0;
  let n = 1;
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) n++;
  }
  return n;
}

/** One definition of a GLSL function: what it answers and what it takes, qualifiers that change no call left out. */
function signatureOf(type: string, params: string): string {
  const list = params.trim() === '' || params.trim() === 'void' ? [] : params.split(',');
  const each = list.map((p) => {
    const words = p.replace(/\b(?:const|in|highp|mediump|lowp)\b/g, ' ').trim().split(/\s+/);
    // The last word is the parameter's name (with any array size on it); what is before it is its type, `out` or `inout` kept.
    const size = /\[[^\]]*\]$/.exec(words[words.length - 1])?.[0] ?? '';
    return `${words.slice(0, -1).join(' ')}${size}`;
  });
  return `${type}(${each.join(', ')})`;
}

/** What a GLSL text defines that a shader may call: each function's definitions by parameter count, and each macro that takes arguments. */
export interface GlslCallables {
  /** A name's parameter counts, one for each definition (overloads, and both arms of an `#ifdef`). */
  counts: Map<string, Set<number>>;
  /** A name's definitions as written, `float(vec3, inout vec3)` (a macro: `macro(2)`), sorted. */
  signatures: Map<string, string[]>;
}

/**
 * Every function a GLSL text defines and every macro with arguments it `#define`s, by name (comments aside; both
 * branches of an `#ifdef` are read, so a function defined two ways is both). Added to `into` when one is handed in, so
 * the chunks of a whole library can be gathered into one table.
 */
export function glslCallables(glsl: string, into: GlslCallables = { counts: new Map(), signatures: new Map() }): GlslCallables {
  const text = glsl.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const add = (name: string, n: number, sig: string): void => {
    if (!into.counts.has(name)) into.counts.set(name, new Set());
    into.counts.get(name)!.add(n);
    const list = into.signatures.get(name) ?? [];
    if (!list.includes(sig)) list.push(sig);
    list.sort();
    into.signatures.set(name, list);
  };
  const def = /(?:^|[\n;}])[ \t]*(?:(?:highp|mediump|lowp)[ \t]+)?([A-Za-z_]\w*)[ \t]+([A-Za-z_]\w*)[ \t]*\(/g;
  let m: RegExpExecArray | null;
  while ((m = def.exec(text))) {
    if (!GLSL_TYPE.test(m[1]) && !/^[A-Z]/.test(m[1])) continue;
    const open = m.index + m[0].length - 1;
    const inside = insideParens(text, open);
    if (inside === null) continue;
    // A definition opens its body next; anything else is a prototype, a constructor or a call.
    if (!text.slice(open + inside.length + 2).trimStart().startsWith('{')) continue;
    add(m[2], countArgs(inside), signatureOf(m[1], inside));
  }
  const macro = /^[ \t]*#[ \t]*define[ \t]+([A-Za-z_]\w*)\(([^)]*)\)/gm;
  while ((m = macro.exec(text))) add(m[1], countArgs(m[2]), `macro(${countArgs(m[2])})`);
  return into;
}

/** One call a GLSL text makes of a name in a table of callables. */
export interface GlslCall {
  name: string;
  /** How many arguments it hands over. */
  args: number;
  /** The call as written, cut short. */
  text: string;
}

/**
 * Every call the code makes of a name `callables` defines (comments and directives aside; a definition is not a call):
 * what a test holds to the definitions' own parameter counts. Node compiles no GLSL, and a call handing a function of
 * three's the arguments its last version took compiles in no browser either (the water's mask twins, on three 0.187).
 */
// (`miscalls` below is the check; this is what it reads, handed out for a test that lists what is called.)
export function glslCalls(glsl: string, callables: GlslCallables, tight = false): GlslCall[] {
  const code = codeOf(glsl);
  const out: GlslCall[] = [];
  // `tight`: only a name with its parenthesis hard against it, for text that may be prose ("on average (and ...)").
  const call = tight ? /(?<![\w.$])([A-Za-z_]\w*)\(/g : /(?<![\w.$])([A-Za-z_]\w*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = call.exec(code))) {
    if (!callables.counts.has(m[1])) continue;
    const open = m.index + m[0].length - 1;
    const inside = insideParens(code, open);
    if (inside === null) continue;
    if (code.slice(open + inside.length + 2).trimStart().startsWith('{')) continue;
    out.push({ name: m[1], args: countArgs(inside), text: `${m[1]}(${inside.replace(/\s+/g, ' ').trim().slice(0, 120)})` });
  }
  return out;
}

/** The calls of `glslCalls` that hand a function a number of arguments none of its definitions takes, as `name(...): n against a/b`. */
export function miscalls(glsl: string, callables: GlslCallables): string[] {
  const out = new Set<string>();
  for (const c of glslCalls(glsl, callables)) {
    const counts = callables.counts.get(c.name)!;
    if (!counts.has(c.args)) out.add(`${c.text}: ${c.args} argument(s) against ${[...counts].sort().join(' or ')}`);
  }
  return [...out];
}

/**
 * A shader's text with every `#include <name>` given the chunk of that name out of `chunks`, chunks inside chunks too,
 * as three resolves them when it builds a program. A chunk nobody has is left as a comment naming it and counted in
 * `missing` when a list is handed in.
 */
export function resolveIncludes(text: string, chunks: Readonly<Record<string, string | undefined>>, missing?: string[], depth = 0): string {
  return text.replace(/^[ \t]*#include +<([\w\d./]+)>/gm, (_whole, name: string) => {
    const chunk = chunks[name];
    if (typeof chunk !== 'string') {
      missing?.push(name);
      return `/* no chunk ${name} */`;
    }
    return depth > 8 ? chunk : resolveIncludes(chunk, chunks, missing, depth + 1);
  });
}

/**
 * Every name the code reads that it never declares (comments and directives aside), less `known` (what the program round
 * it declares: three's uniforms and varyings, a host's globals): a name declared after a type (a variable, a parameter, a
 * function, every name of a comma list), a struct's member or a swizzle after a dot, and GLSL's own words are not reads.
 * Conservative by design: a name declared anywhere in the text counts as declared everywhere in it. Wave 3b's lesson: a
 * line naming `vNormal` in a flat-shaded program compiled in no browser and every node scan passed it.
 */
export function undeclaredNames(glsl: string, known: Iterable<string> = []): string[] {
  const code = codeOf(glsl);
  const declared = declaredNames(glsl, new Set<string>(known));
  let m: RegExpExecArray | null;
  const out = new Set<string>();
  const use = /(?<![\w.])([A-Za-z_]\w*)\b/g;
  while ((m = use.exec(code))) {
    const n = m[1];
    if (declared.has(n) || GLSL_CALLABLE.has(n) || GLSL_WORDS.has(n) || GLSL_TYPE.test(n) || RESERVED.has(n)) continue;
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
