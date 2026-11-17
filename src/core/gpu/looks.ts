// The converted models' own looks on WebGPU (the GPU port's step 4): what the WebGL path injects into a classic material's
// program with `onBeforeCompile` (which three's WebGPU renderer never runs) given to the node copy three makes of it.
//
// Three makes that copy at one place, `renderer.library.fromMaterial` (once a pipeline is built, `fallback.ts` says how),
// and that place is wrapped here once more, after the fallback: a classic material's fresh copy is handed to each look
// part that applies to it, in the order of `LOOK_PARTS`. A part decides only by what is in the original material's cache
// key (its hook chain, which keys its program, and which maps it has), since three hands every render object whose key is
// equal one node builder state; whatever differs between such materials (a colour, a picture, a power) the part reads
// once an object, off the material three is drawing.
//
// Each part is a switch back to step 3's plain node copy, two ways: `localStorage['swg.gpu.<part>'] = '0'` and a reload
// leaves it out at load (the node copy is three's own, structurally), and `__debug.gpu({ look: { <part>: false } })` turns
// it off live as a uniform (the picture is the plain copy's; nothing is built). The parts of this step's first maker are
// `detail` (`gpuDetail.ts`), `spec` (`gpuSpec.ts`) and `env` (`gpuEnv.ts`, which is not a node copy's at all but the
// environment the registry hands every registered material); the leaf cards (`card`, `gpuCard.ts`) go on this list after them.

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** One look on the node copy. */
export interface LookPart {
  readonly name: string;
  /** Whether the part changes the node copy of this classic material: read only off what is in its cache key. */
  applies(material: Any): boolean;
  /** Change the fresh node copy (`node`) of `material`. */
  apply(node: Any, material: Any): void;
}

/** Whether each part was taken in at load (`swg.gpu.<part>` '0' leaves it out for the session). */
function atLoad(name: string): boolean {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem(`swg.gpu.${name}`) !== '0';
  } catch {
    return true;
  }
}

/** The parts taken in at load, read once. */
export const LOOKS_AT_LOAD = { spec: atLoad('spec'), env: atLoad('env'), detail: atLoad('detail'), card: atLoad('card') };

/**
 * The live switches (`__debug.gpu({ look: { spec, env, detail, card } })`), each read by its part as a uniform (or, for the
 * environment, by the world's capture). All on by default: the look the WebGL path draws. Not remembered.
 */
export const GPU_LOOKS = { spec: LOOKS_AT_LOAD.spec, env: LOOKS_AT_LOAD.env, detail: LOOKS_AT_LOAD.detail, card: LOOKS_AT_LOAD.card };

/** The parts on the node copy, in the order they go on (`gpuDetail.ts`'s colour first, then the highlight's lighting, then the leaf cards' changes to that lighting, `gpuCard.ts`). */
export const LOOK_PARTS: LookPart[] = [];

/** Counts for the console: node copies handed to the parts, and how many each part changed. */
export const LOOK_STATS = { copies: 0, byPart: new Map<string, number>() };

/** Wrap the node library's `fromMaterial` (after the fallback's wrap) so every fresh copy of a classic material meets the parts. */
export function installLooks(renderer: Any, parts: readonly LookPart[] = LOOK_PARTS): void {
  const lib = renderer.library;
  const from = lib.fromMaterial.bind(lib);
  lib.fromMaterial = (material: Any) => {
    const node = from(material);
    // The fallback hands back a stand-in it keeps (never a fresh copy) for what three cannot draw (a shader material, a
    // depth or distance material), and a node material is its own copy: only a classic material's fresh copy is the parts'.
    if (!node || node === material || material.isNodeMaterial || material.isShaderMaterial || material.isMeshDepthMaterial || material.isMeshDistanceMaterial) return node;
    LOOK_STATS.copies++;
    for (const p of parts) {
      if (!p.applies(material)) continue;
      p.apply(node, material);
      LOOK_STATS.byPart.set(p.name, (LOOK_STATS.byPart.get(p.name) ?? 0) + 1);
    }
    return node;
  };
}

/** The console's live switches: answers them as they stand. */
export function setLooks(o: Record<string, unknown>): typeof GPU_LOOKS {
  for (const k of Object.keys(GPU_LOOKS) as (keyof typeof GPU_LOOKS)[]) {
    const v = o[k];
    // A part left out at load cannot be switched on live: its node copies were built without it.
    if (typeof v === 'boolean') GPU_LOOKS[k] = v && LOOKS_AT_LOAD[k];
  }
  return GPU_LOOKS;
}

/** What the console says of the looks (`__debug.gpu().looks`). */
export function looksReport(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    atLoad: { ...LOOKS_AT_LOAD },
    live: { ...GPU_LOOKS },
    switches: "__debug.gpu({ look: { spec, env, detail, card } }) live (a uniform; nothing built); localStorage['swg.gpu.<part>'] = '0' and a reload leaves a part out (three's plain node copy)",
    nodeCopies: LOOK_STATS.copies,
    changedBy: Object.fromEntries(LOOK_STATS.byPart),
    ...extra,
  };
}
