// The console on WebGPU (the GPU port's step 3): every helper of `__debug` that reaches under three's WebGL renderer
// (its programs, its context, a readback of the effects' target, a self-test drawing through a program of ours) answers in
// words here rather than throwing or reading numbers that mean nothing on WebGPU. Wrapped once, at boot, on WebGPU alone.
//
// The step's own versions of a helper (`own`, step 4: `specSelfTest`) go in first. Then three kinds: the helpers named
// in `WORDS_ONLY` are answered in words without being called (what they read does not
// exist on WebGPU); the ones in `WORDS_WHEN` are answered in words only when asked for what does not exist (a self-test,
// a picture compare) and called otherwise; every other helper is called as it is, and a throw, sync or async, comes back
// as words naming it. `perf()` is called and given WebGPU's own frame counters beside what it says.

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const NOT_YET = 'not on WebGPU yet';

/** Helpers that read only WebGL's own records (programs, links, the GL context, readbacks of a target, self-tests drawn through programs of ours). */
const WORDS_ONLY: Record<string, string> = {
  shaders: "WebGL's program records: WebGPU keeps pipelines, counted by __debug.gpu()",
  links: "WebGL's link machinery: no program links on WebGPU",
  skinnedLoad: "WebGL's float joints and morph ladder: WebGPU builds what a skinned mesh needs itself",
  renderInfo: "WebGL's program list and memory: __debug.gpu() says WebGPU's draws and pipelines",
  fxCheck: 'the effects chain is not made on WebGPU this step',
  ssao: 'the effects chain is not made on WebGPU this step',
  blackBox: "a readback of the effects' target: no effects chain on WebGPU this step",
  flareProbe: 'the lens flare is an effect: no effects chain on WebGPU this step',
  cardsSelfTest: 'draws through the leaf cards\' WebGL programs (step 4)',
  // The leaf cards' other two (the client's light, the leaf skip) are the WebGPU side's own (`own`, step 4); `cardsSelfTest`
  // above (the card rule under three's own light, on its WebGL stage) is not.
  swaySelfTest: "draws through the sway's WebGL program (a remake of the owner's)",
  grassShadowSelfTest: "draws through the grass's WebGL program (step 5)",
  groundSelfTest: "draws through the ground's WebGL tile program (step 5)",
  gradeSelfTest: 'the colour grade is an effect: no effects chain on WebGPU this step',
  waterFx: "the water's effects: no effects chain on WebGPU this step",
  passLog: "the WebGL portal renderer's per-pass counts: __debug.gpu() says the frame's draws",
};

/** Helpers answered in words only when asked for a self-test or a picture compare (the rest of what they do stands). */
const WORDS_WHEN: Record<string, (arg: Any) => boolean> = {
  personKeys: (a) => !!a && a.selfTest !== undefined,
  wind: (a) => !!a && a.selfTest !== undefined,
  horizon: (a) => !!a && a.selfTest !== undefined,
  crowd: (a) => !!a && a.compare !== undefined,
  shadowPass: (a) => !!a && a.compare !== undefined,
};

function words(name: string, why: string): Record<string, string> {
  return { webgpu: NOT_YET, helper: name, why, see: '__debug.gpu()' };
}

/**
 * `own`: helpers the WebGPU side answers with a version of its own (`specSelfTest`, drawn through the lighting model of
 * ours: step 4), put in place of the WebGL one before the wrap, so a throw in one still comes back as words.
 */
export function wrapConsole(debug: Record<string, Any>, frame: () => Record<string, unknown>, own: Record<string, (...args: Any[]) => unknown> = {}): void {
  for (const name of Object.keys(own)) if (typeof debug[name] === 'function') debug[name] = own[name];
  for (const name of Object.keys(debug)) {
    const f = debug[name];
    if (typeof f !== 'function') continue;
    // A helper the WebGPU side has a version of its own for (`own`) is called, never answered in words.
    if (WORDS_ONLY[name] && !(name in own)) {
      const why = WORDS_ONLY[name];
      debug[name] = () => words(name, why);
      continue;
    }
    const when = WORDS_WHEN[name];
    debug[name] = (...args: Any[]) => {
      if (when && when(args[0])) return words(name, 'asked for a self-test or a picture compare, which draws through WebGL');
      let out: Any;
      try {
        out = f.apply(debug, args);
      } catch (err) {
        return { ...words(name, 'it reached under three and threw'), error: String((err as Error)?.message ?? err).slice(0, 300) };
      }
      if (out && typeof out.then === 'function') {
        return (out as Promise<unknown>).then(
          (v) => (name === 'perf' && v && typeof v === 'object' ? { ...(v as object), webgpu: frame() } : v),
          (err) => ({ ...words(name, 'it reached under three and threw'), error: String((err as Error)?.message ?? err).slice(0, 300) }),
        );
      }
      if (name === 'perf' && out && typeof out === 'object') return { ...out, webgpu: frame() };
      return out;
    };
  }
}
