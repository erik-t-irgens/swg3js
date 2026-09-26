// Wrapping a material's compile hook, once, however many wrappers there are.
//
// **This file exists because of one bug, and it is worth stating plainly.** Two injections wrap
// `onBeforeCompile`: the wet surfaces and the detail map. Each one guarded itself by testing a marker
// on the material's **outermost** hook -- which is correct for the only wrapper there is, and wrong
// the moment there are two. The detail wrap went on the outside of the wet one, so on the next
// quarter-second material scan the wet wrap looked at the outermost hook, did not find its own
// marker, and wrapped again; then the detail wrap did the same. Every scan added one more copy of
// each injection, so a material's shader came out with its varyings, uniforms and functions declared
// two, three or six times over, the program would not compile, and every surface drawn with it was
// simply not drawn -- a world of see-through buildings and trees, and a `useProgram: program not
// valid` for every one of them.
//
// So there is one implementation of the dance now, and both callers share it:
//
//   - a hook keeps a link to the hook it wrapped (`WRAPPED`), so the guard can walk the **whole
//     chain** for its own mark instead of looking only at the top;
//   - the program key is taken once per material, before any wrap, and every wrapper prefixes it, so
//     two wraps give `detail|wet-object|<base>` and a third of either gives nothing new;
//   - a material whose hook something else **replaced** (the shadow cascades do, rather than
//     wrapping) has no mark anywhere in its chain, so it is wrapped again, which is what it needs.
//
// Pure: no three at run time, no DOM, so a node test can wrap a stand-in material, "scan" it a
// hundred times and count the declarations.

/** The hook a wrapper wrapped, so a guard can walk the chain rather than reading only the top. */
const WRAPPED = Symbol('swg.wrappedHook');
/** On every hook this file makes, so a chain of ours can be told from one somebody else replaced it with. */
const MINE = Symbol('swg.ourHook');

/** What a compiled shader looks like to an injection: the three fields every one of ours writes. */
export interface CompileShader {
  vertexShader: string;
  fragmentShader: string;
  uniforms: Record<string, { value: unknown }>;
}

/**
 * A compile hook, with the two things we hang on one: the hook it wrapped, and each wrapper's own
 * mark. The marks are read through an index signature because each caller brings a symbol of its own.
 */
type Hook = ((shader: CompileShader, renderer: unknown) => void) & Record<symbol, unknown>;

/** The material fields this touches. Deliberately not `THREE.Material`, so a node test can pass a plain one. */
export interface Wrappable {
  onBeforeCompile: (shader: never, renderer: never) => void;
  customProgramCacheKey: () => string;
}

/** The program key each material had before anything wrapped it: taken once, prefixed by every wrapper. */
const baseKeys = new WeakMap<object, () => string>();

/**
 * Whether `mark` is anywhere in a hook's chain.
 *
 * The chain and not the top: that distinction is the whole of the bug this file was written for. The
 * walk is bounded because a wrapper never links to itself and the chain is only ever as deep as the
 * number of injections (two).
 */
export function chainHas(hook: unknown, mark: symbol): boolean {
  for (let h = hook as Hook | undefined; typeof h === 'function'; h = h[WRAPPED] as Hook | undefined) if (h[mark]) return true;
  return false;
}

/**
 * Put `inject` on a material's compile hook once, after whatever was already there, and key its
 * program apart under `name`.
 *
 * Answers whether it wrapped, which is only for the tests and the console: a caller may run this on
 * every material scan and it does nothing after the first time. It must be called **before** the
 * material's program is first asked for, since the hook and the key are both part of that program's
 * identity -- which in this game means from `World.adoptMaterials`, in the same pass as the cascades'
 * own setup and never later.
 */
export function wrapCompile(mat: Wrappable, mark: symbol, name: string, inject: (shader: CompileShader) => void): boolean {
  const previous = mat.onBeforeCompile as unknown as Hook;
  if (chainHas(previous, mark)) return false;
  const hook = function swgInject(this: Wrappable, shader: CompileShader, renderer: unknown) {
    previous.call(this as never, shader as never, renderer as never);
    inject(shader);
  } as unknown as Hook;
  hook[mark] = true;
  hook[MINE] = true;
  hook[WRAPPED] = previous;
  mat.onBeforeCompile = hook as unknown as Wrappable['onBeforeCompile'];
  let base = baseKeys.get(mat);
  if (!base) {
    // Three's own default key is the source text of `onBeforeCompile`, which after a wrap is ours and
    // the same for every wrapped material -- so it has to be read before the first wrap, not after.
    base = mat.customProgramCacheKey;
    baseKeys.set(mat, base);
  }
  const key = base;
  // The names start afresh whenever the chain does. The cascades **replace** `onBeforeCompile` rather
  // than wrapping it, which throws our whole chain away, and a list that kept growing across that
  // would give the same material a different program key every time the cascades set up again -- a
  // second program built for nothing, which is the one cost this game is most careful about.
  const names = (previous as Hook)[MINE] ? (wrapNames.get(mat) ?? []) : [];
  names.push(name);
  wrapNames.set(mat, names);
  mat.customProgramCacheKey = () => `${names.join('|')}|${key.call(mat)}`;
  return true;
}

/** The wrappers on each material, in the order they went on: the program key is built from these. */
const wrapNames = new WeakMap<object, string[]>();

/** What is wrapped on a material, for the console. */
export function wrapsOn(mat: Wrappable): readonly string[] {
  return wrapNames.get(mat) ?? [];
}
