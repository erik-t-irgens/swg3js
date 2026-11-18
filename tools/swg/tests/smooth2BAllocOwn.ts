// Climbing II, Smoothness II's maker B's own frames, measured with no collection between, the cleanest of four windows, each
// frame a function of its own reading kept fields, called from a loop kept out of the optimizer (wave 2a's lesson):
//  - the duck's head (item 4): the figure's spheres placed off its bones (`BodySpheres.sample`), the drawn top read
//    (`topOfUpper`) and held (`headOverHeld`) into a field, as the player's `duckFigure` does every frame on the feet;
//  - the climb's push and settle (item 3) asked of a world with nothing in it (`clearOut`, `settle`, a reaching hand's
//    `handOut`): the open air the push meets most frames, the engine's answers being the only things it ever makes.
// Run twelve at once by `smooth2BAlloc.test.ts`; prints one line of JSON.
import v8 from 'node:v8';
import { PerformanceObserver } from 'node:perf_hooks';
import * as THREE from 'three';
import { BodySpheres, SPHERE_PARTS, SPHERES_BODY, SPH_L_HAND, type SpherePart, type SphereWorld } from '../../../src/player/bodySpheres.ts';

let scavenges = 0;
new PerformanceObserver((l) => {
  scavenges += l.getEntries().length;
}).observe({ entryTypes: ['gc'] });
const turn = () => new Promise<void>((r) => setImmediate(r));
const young = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')!.space_used_size;

// A rig of our own: every part's anchor a bone, chained under a root, a little apart.
const group = new THREE.Group();
const root = new THREE.Group();
group.add(root);
const bones = new Map<string, THREE.Bone>();
let parent: THREE.Object3D = root;
const parts: SpherePart[] = SPHERE_PARTS.map((p, i) => {
  const b = new THREE.Bone();
  b.name = p.own[0];
  b.position.set(0.01 * i, 0.1, 0.02);
  parent.add(b);
  parent = b;
  bones.set(b.name, b);
  return { id: p.id, anchor: p.own[0], at: [0.01, 0.02, 0.03], radius: 0.05 + 0.005 * i, bindScale: 1, vertices: 40 };
});
const rig = { root, boneNamed: (n: string) => bones.get(n) ?? null };
const S = new BodySpheres({ ball: () => ({}) as never, contact: () => ({}) as never });
S.use(rig, parts);
const empty: SphereWorld = { intersectionWithShape: () => null };

class Run {
  held = 0.5;
  feetY = 0.5;
  tall = 1.6;
  i = 0;
}
const st = new Run();
// (The rig posed once: three's own matrices are three's, and a Vector3's fields are its own business.)
root.position.y = 0.013;
group.updateMatrixWorld(true);
st.held = 0;
st.feetY = 0;
function headFrame(): void {
  const s = st;
  s.i++;
  S.sample();
  S.headFeet = s.feetY;
  S.headTall = s.tall;
  S.headDt = 1 / 60;
  S.holdHead();
  // (And the duck's deepest read, the crouched walk's own head over the feet, which the player asks on the same frames ducked.)
  S.holdDeep();
}
function heads(n: number): void {
  for (let k = 0; k < n; k++) headFrame();
}
function clearFrame(): void {
  const s = st;
  s.i++;
  S.refX = 0;
  S.refY = 0.8;
  S.refZ = -1;
  S.axX = 0;
  S.axZ = 0;
  S.sample();
  S.clearOut(empty, SPHERES_BODY, 0, 0, 1 / 60, 0.08, 0.3, (s.i & 1) === 0);
  S.handOut(empty, SPH_L_HAND, 0, 0);
  S.settle(empty, SPHERES_BODY, 0, 0, 0.3);
}
function clears(n: number): void {
  for (let k = 0; k < n; k++) clearFrame();
}
// eslint-disable-next-line no-eval
eval('%NeverOptimizeFunction(heads)');
// eslint-disable-next-line no-eval
eval('%NeverOptimizeFunction(clears)');

interface Part {
  bytes: number;
  frames: number;
  clean: boolean;
}
async function measure(run: (n: number) => void, window: number): Promise<Part> {
  run(4000);
  let best: Part = { bytes: Number.POSITIVE_INFINITY, frames: window, clean: false };
  for (let tries = 0; tries < 4; tries++) {
    run(240);
    globalThis.gc!({ type: 'minor' } as never);
    await turn();
    await turn();
    const s0 = scavenges;
    const y0 = young();
    run(window);
    const y1 = young();
    await turn();
    await turn();
    if (scavenges === s0 && y1 - y0 < best.bytes) best = { bytes: y1 - y0, frames: window, clean: true };
  }
  return best;
}
const head = await measure(heads, 100000);
const clear = await measure(clears, 100000);
console.log(JSON.stringify({ head, clear, held: S.headHeld }));
