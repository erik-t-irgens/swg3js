// Wrapping a material's compile hook, and the bug that made this file necessary.
//
// **What went wrong.** Two injections wrap `onBeforeCompile`: the wet surfaces and the detail map.
// Each guarded itself by testing a marker on the material's outermost hook. That is right while there
// is one wrapper and wrong the instant there are two: the detail wrap went on the outside of the wet
// one, so at the next quarter-second material scan the wet wrap looked at the top of the chain, did
// not find its own marker, and wrapped again -- and then the detail wrap did the same. Every scan
// added one more copy of each injection. A material's shader came out declaring `vSwgDetailUv`,
// `vWetPos` and a dozen uniforms two, three or six times over, the program would not compile, and
// every surface drawn with it was simply not drawn: a world of see-through buildings and trees.
//
// So the test that matters is not "does one wrap work" -- that passed all along -- it is **scan it
// again and again with both wrappers and count the declarations**, which is what the game really does.

import { chainHas, wrapCompile, wrapsOn, type CompileShader, type Wrappable } from '../../../src/world/compileHooks.ts';

let checks = 0;
let bad = 0;
function ok(what: string, pass: boolean, note = ''): void {
  checks++;
  if (!pass) {
    bad++;
    console.log(`  FAIL ${what}${note ? `: ${note}` : ''}`);
  } else console.log(`ok   ${what}${note ? ` (${note})` : ''}`);
}

const WET = Symbol('wet');
const DETAIL = Symbol('detail');

/** A material as three has one before anything touches it: an empty hook and the default key. */
function material(): Wrappable {
  const m: Wrappable = {
    onBeforeCompile: function onBeforeCompile() {
      /* three's own empty method */
    },
    customProgramCacheKey: () => '',
  };
  return m;
}

/** The two injections, cut down to the declarations that collided. */
const wet = (s: CompileShader) => {
  s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWetPos;\nvarying vec3 vWetUp;');
  s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uWetness;\nvarying vec3 vWetPos;');
  s.uniforms.uWetness = { value: 0 };
};
const detail = (s: CompileShader) => {
  s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vSwgDetailUv;');
  s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D swgDetailMap;\nvarying vec2 vSwgDetailUv;');
  s.uniforms.swgDetailMap = { value: null };
};

function compiled(m: Wrappable): CompileShader {
  const s: CompileShader = { vertexShader: '#include <common>\nvoid main() {}', fragmentShader: '#include <common>\nvoid main() {}', uniforms: {} };
  (m.onBeforeCompile as unknown as (sh: CompileShader, r: unknown) => void).call(m, s, null);
  return s;
}
const count = (text: string, decl: string) => (text.match(new RegExp(decl.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&'), 'g')) ?? []).length;

/** One quarter-second material scan, in the order `World.adoptMaterials` really does it. */
function scan(m: Wrappable): void {
  wrapCompile(m, WET, 'wet-object', wet);
  wrapCompile(m, DETAIL, 'detail', detail);
}

// ---- The bug itself -------------------------------------------------------------------------------

{
  const m = material();
  scan(m);
  const once = compiled(m);
  ok('one scan writes each declaration once', count(once.vertexShader, 'varying vec2 vSwgDetailUv;') === 1 && count(once.vertexShader, 'varying vec3 vWetPos;') === 1);

  // A hundred scans, which on the owner's machine is twenty-five seconds of standing still.
  for (let i = 0; i < 100; i++) scan(m);
  const s = compiled(m);
  ok('and a hundred more write it no more times', count(s.vertexShader, 'varying vec2 vSwgDetailUv;') === 1, `${count(s.vertexShader, 'varying vec2 vSwgDetailUv;')} copies`);
  ok('nor the wet varyings, which are the ones on the inside', count(s.vertexShader, 'varying vec3 vWetPos;') === 1, `${count(s.vertexShader, 'varying vec3 vWetPos;')} copies`);
  ok('nor the fragment uniforms of either', count(s.fragmentShader, 'uniform sampler2D swgDetailMap;') === 1 && count(s.fragmentShader, 'uniform float uWetness;') === 1);
  ok('both injections really ran', !!s.uniforms.uWetness && s.uniforms.swgDetailMap !== undefined);
  ok('the program is keyed once per wrapper, in the order they went on', m.customProgramCacheKey() === 'wet-object|detail|', m.customProgramCacheKey());
  ok('and the wrappers are named for the console', wrapsOn(m).join(',') === 'wet-object,detail', wrapsOn(m).join(','));
}
{
  // The guard is the chain and not the top, which is the whole of the difference. Written out here
  // so the check cannot pass by accident: the mark of the *inner* wrapper must still be findable.
  const m = material();
  wrapCompile(m, WET, 'wet-object', wet);
  const inner = m.onBeforeCompile;
  wrapCompile(m, DETAIL, 'detail', detail);
  ok('the outermost hook is the one that went on last', m.onBeforeCompile !== inner);
  ok('and the inner wrapper is still found through it', chainHas(m.onBeforeCompile, WET));
  ok('as is the outer one', chainHas(m.onBeforeCompile, DETAIL));
  ok('reading only the top would have missed the inner one (the bug)', !(m.onBeforeCompile as unknown as Record<symbol, unknown>)[WET]);
}
{
  // Either order, since nothing promises which injection the scan reaches first.
  const m = material();
  wrapCompile(m, DETAIL, 'detail', detail);
  wrapCompile(m, WET, 'wet-object', wet);
  for (let i = 0; i < 20; i++) {
    wrapCompile(m, DETAIL, 'detail', detail);
    wrapCompile(m, WET, 'wet-object', wet);
  }
  const s = compiled(m);
  ok('the other order is idempotent too', count(s.vertexShader, 'varying vec2 vSwgDetailUv;') === 1 && count(s.vertexShader, 'varying vec3 vWetPos;') === 1);
}
{
  // A wrapper answers whether it really wrapped, which is what a console count would read.
  const m = material();
  ok('the first wrap says it wrapped', wrapCompile(m, WET, 'wet-object', wet) === true);
  ok('and every one after says it did not', wrapCompile(m, WET, 'wet-object', wet) === false);
}

// ---- What the cascades do, which is replace rather than wrap ---------------------------------------

{
  // `CSM.setupMaterial` overwrites `onBeforeCompile`, so our chain is gone and the material needs
  // wrapping afresh -- the one case where re-wrapping is right, and the reason the guard cannot
  // simply be a set of materials already done.
  const m = material();
  scan(m);
  let cascade = 0;
  m.onBeforeCompile = function csm() {
    cascade++;
  };
  ok('a replaced hook carries none of our marks', !chainHas(m.onBeforeCompile, WET) && !chainHas(m.onBeforeCompile, DETAIL));
  scan(m);
  const s = compiled(m);
  ok('so the scan wraps it again', count(s.vertexShader, 'varying vec2 vSwgDetailUv;') === 1 && count(s.vertexShader, 'varying vec3 vWetPos;') === 1);
  ok('the cascades\' own hook still runs', cascade === 1);
  // And the key must be exactly what it was before, not a prefix longer. A key that grew every time
  // the cascades set up again would hand three a different program for the same material each time --
  // a second program built for nothing, which is the one cost this game is most careful about. The
  // first version of this check was written loosely enough to pass while the key really did grow.
  ok('the key is the same as before the re-wrap, not one prefix longer', m.customProgramCacheKey() === 'wet-object|detail|', m.customProgramCacheKey());
  ok('and the names are not doubled either', wrapsOn(m).join(',') === 'wet-object,detail', wrapsOn(m).join(','));
  // Twenty more cascade setups change nothing.
  for (let i = 0; i < 20; i++) {
    m.onBeforeCompile = function csmAgain() {
      cascade++;
    };
    scan(m);
  }
  ok('nor do twenty more', m.customProgramCacheKey() === 'wet-object|detail|', m.customProgramCacheKey());
  ok('and the shader is still written once each', count(compiled(m).vertexShader, 'varying vec2 vSwgDetailUv;') === 1);
}

// ---- Whatever came before still runs, in order ----------------------------------------------------

{
  const order: string[] = [];
  const m = material();
  m.onBeforeCompile = function first() {
    order.push('cascades');
  };
  wrapCompile(m, WET, 'wet-object', () => order.push('wet'));
  wrapCompile(m, DETAIL, 'detail', () => order.push('detail'));
  compiled(m);
  ok('the chain runs innermost first', order.join(' ') === 'cascades wet detail', order.join(' '));
}
{
  // Nothing may be wrapped onto three's own empty method twice through two materials sharing it:
  // the mark goes on the wrapper, which is made per material, never on the prototype's method.
  const shared = function onBeforeCompile() {
    /* three's own */
  };
  const a: Wrappable = { onBeforeCompile: shared, customProgramCacheKey: () => 'a' };
  const b: Wrappable = { onBeforeCompile: shared, customProgramCacheKey: () => 'b' };
  wrapCompile(a, WET, 'wet-object', wet);
  ok('wrapping one material leaves another sharing three\'s method alone', b.onBeforeCompile === shared);
  ok('and that one can still be wrapped', wrapCompile(b, WET, 'wet-object', wet) === true);
  ok('each keeps its own key', a.customProgramCacheKey() === 'wet-object|a' && b.customProgramCacheKey() === 'wet-object|b', `${a.customProgramCacheKey()} / ${b.customProgramCacheKey()}`);
}

console.log(`\ncompile hooks: ${checks} checks, ${bad} failed`);
if (bad) process.exit(1);
