// An effect placed at a size of its own (Map-maker II's seventh wave: an attachment's `size`, `EffectHandle.size`): every
// emitter of it plays at its effect's scale times the size, and an effect placed with no size plays exactly as a70487c's
// particle player played it -- its quads' corners the very numbers, frame by frame -- with that player loaded out of git
// beside today's (both through the repository's own TypeScript, `airLoader.mjs`, since the player carries a parameter
// property node's stripping refuses), the same random draws handed to both, or, where git cannot hand it over, as the
// traces recorded from it; a mesh emitter's models and a distance emitter's spacing take the size too; and an effect sized
// again where it stands (`ParticleEffects.resize`) plays exactly as one placed at that size. The effects are of our making.
//
// Run: node tools/swg/tests/effectSize.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractOldSrc, REPO } from './airTrees.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);
/** Where the wave began: main when Map-maker II's seventh wave started. */
const PRE_WAVE = 'a70487c';

// The random draws both players take, seeded and put back to the start before each run (the player keeps `Math.random`
// itself as it loads, so the stand-in goes in first).
let seed = 1;
Math.random = () => {
  seed = (seed * 1103515245 + 12345) >>> 0;
  return seed / 4294967296;
};

// One effect of our own: a cone of quads that rise, grow and spin, from a shape and a speed and a size that all scale.
const curve = (v: number, w = 0) => ({ interp: 0, sample: 1, points: [[0, v, w, 0], [1, v, w, 0]] });
const EFFECT = {
  version: 1,
  timing: { startDelay: [0, 0], loopDelay: [0, 0], loopCount: [-1, -1] },
  initialPlaybackRate: 1,
  initialPlaybackRateTime: 0,
  playbackRate: 1,
  scale: 1.5,
  groups: [
    {
      timing: { startDelay: [0, 0], loopDelay: [0, 0], loopCount: [-1, -1] },
      emitters: [
        {
          version: 11,
          timing: { startDelay: [0, 0], loopDelay: [0, 0], loopCount: [-1, -1] },
          translationX: curve(0.5),
          translationY: curve(1),
          translationZ: curve(-0.25),
          rotationX: curve(0),
          rotationY: curve(0),
          rotationZ: curve(0),
          distance: curve(0),
          shapeSize: curve(2, 2),
          spread: curve(30),
          rate: curve(20),
          speed: curve(1.5, 2.5),
          inheritVelocity: curve(0),
          clusterCount: curve(0),
          clusterRadius: curve(0),
          lifeTime: curve(1.5, 2.5),
          weight: curve(0),
          name: 'TEST',
          direction: 'up',
          generation: 'rate',
          shape: 'circle',
          loopImmediately: true,
          emitterLife: [3, 3],
          maxParticles: 128,
          oneShot: false,
          oneShotCount: [8, 8],
          randomInitialRotation: true,
          orientation: 'camera',
          visible: true,
          particleType: 'quad',
          sound: '',
          localSpace: false,
          groundCollision: false,
          killOnCollision: false,
          collisionHeight: 0,
          forwardKeep: [0.5, 0.5],
          upKeep: [0.5, 0.5],
          windResistance: 0,
          lod: [-1, -1],
          flocking: 'none',
          timeOfDayColor: 0.5,
          snapToTerrain: false,
          alignToTerrain: false,
          snapHeight: 0,
          firstImmediately: true,
          particle: {
            type: 'quad',
            name: 'TEST',
            randomRotationDirection: true,
            color: { interp: 0, sample: 0, points: [[0, 1, 0.5, 0.25], [1, 0.5, 0.5, 1]] },
            alpha: curve(0.8),
            speedScale: curve(1),
            relativeRotation: null,
            attachments: [],
            quad: {
              rotation: curve(45),
              length: { interp: 0, sample: 1, points: [[0, 0.5, 0, 0], [1, 2, 0, 0]] },
              width: { interp: 0, sample: 1, points: [[0, 0.25, 0, 0], [1, 1, 0, 0]] },
              texture: { frameCount: 1, frameStart: 0, frameEnd: 0, frameUVSize: 1, framesPerColumn: 1, framesPerSecond: -1, visible: true, file: 'particles/test_cloud.png', blend: 'alpha' },
              linked: false,
            },
          },
        },
      ],
    },
  ],
};
// Two more of our own, each one emitter of the first's shape: a mesh emitter (its model's scale curve and its particles'
// places both read the size), and a quad emitter that spawns by the distance its placement travels (`generation:
// 'distance'`, whose spacing reads the size), played on a placement moving along x.
const emitter0 = EFFECT.groups[0].emitters[0];
const MESH = {
  ...EFFECT,
  groups: [{ ...EFFECT.groups[0], emitters: [{ ...emitter0, name: 'MESH', particleType: 'mesh', particle: { type: 'mesh', name: 'MESH', randomRotationDirection: false, color: emitter0.particle.color, alpha: curve(1), speedScale: curve(1), relativeRotation: null, attachments: [], mesh: { file: 'particles/test_rock.glb', scale: { interp: 0, sample: 1, points: [[0, 0.5, 1.5, 0], [1, 1, 2, 0]] }, rotation: [curve(0.1), curve(0.2), curve(0.3)] } } }] }],
};
const DIST = {
  ...EFFECT,
  groups: [{ ...EFFECT.groups[0], emitters: [{ ...emitter0, name: 'DIST', generation: 'distance', rate: curve(0.75), lifeTime: curve(60), emitterLife: [600, 600], maxParticles: 4000, firstImmediately: false }] }],
};
const EFFECTS: Record<string, unknown> = { 'base/test.json': EFFECT, 'base/mesh.json': MESH, 'base/dist.json': DIST };
(globalThis as { fetch: unknown }).fetch = async (url: string) => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(EFFECTS[String(url)] ?? EFFECT)) });

const SRC = join(REPO, 'src');
let OLD: string | null = null;
try {
  OLD = extractOldSrc(PRE_WAVE);
} catch (err) {
  note(`git cannot hand ${PRE_WAVE} over here (${err instanceof Error ? err.message : String(err)}): the day-one comparison is skipped`);
}
register(pathToFileURL(join(REPO, 'tools', 'swg', 'tests', 'airLoader.mjs')).href, import.meta.url, { data: { roots: [SRC, ...(OLD ? [OLD] : [])], packageBase: join(REPO, 'package.json') } });
const THREE = (await import('three')) as typeof import('three');
type P = typeof import('../../../src/world/particles.ts');
const NEW = (await import(pathToFileURL(join(SRC, 'world', 'particles.ts')).href)) as P;
const OLDP = OLD ? ((await import(pathToFileURL(join(OLD, 'world', 'particles.ts')).href)) as P) : null;

/** How an effect is played: which file, at what size (none: the player's old call), sized again after it loads, moving. */
interface Play {
  file?: string;
  size?: number | null;
  resizeTo?: number;
  /** Metres its placement moves along x a frame (the distance emitter's travel). */
  move?: number;
  frames?: number;
}

/**
 * Every frame's quads' corners (or, for the mesh effect, its model's instance matrices), and the live particles at the end,
 * after `frames` steps of 1/30 s of one effect placed at the origin.
 */
async function play(mod: P, opts: Play = {}): Promise<{ frames: number[][]; live: number }> {
  const { file = 'test.json', size = null, resizeTo, move = 0, frames = 90 } = opts;
  const dt = 1 / 30;
  seed = 1;
  const scene = new THREE.Scene();
  const fx = new mod.ParticleEffects(scene, 'base/');
  // The picture stood in (a loaded texture never asks a page for its image), and the mesh emitter's model a plain box.
  (fx as unknown as { textures: Map<string, unknown> }).textures.set('particles/test_cloud.png', new THREE.Texture());
  (fx as unknown as { meshModels: Map<string, unknown> }).meshModels.set('particles/test_rock.glb', [{ geometry: new THREE.BoxGeometry(1, 1, 1), material: new THREE.MeshBasicMaterial() }]);
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1000);
  camera.position.set(0, 3, 12);
  camera.lookAt(0, 2, 0);
  camera.updateMatrixWorld();
  const m = new THREE.Matrix4();
  const h = size === null ? fx.place(file, m, false) : fx.place(file, m, false, false, null, false, { size });
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  // Sized again where it stands, loaded and before its first step (the world editor's C held on its handle).
  if (resizeTo !== undefined) (fx as unknown as { resize(h: unknown, s: number): void }).resize(h, resizeTo);
  const out: number[][] = [];
  for (let i = 0; i < frames; i++) {
    if (move) fx.move(h, m.makeTranslation(move * (i + 1), 0, 0));
    fx.update(dt, camera, null);
    const meshes = (fx as unknown as { meshBatches: Map<string, { parts: THREE.InstancedMesh[] }> }).meshBatches;
    const mb = [...meshes.values()][0];
    if (mb) {
      // Sixteen numbers a particle, in the batch's order (the particles' own: a model's instances are never sorted).
      const inst = mb.parts[0];
      out.push(Array.from(inst.instanceMatrix.array.subarray(0, inst.count * 16)));
      continue;
    }
    const batches = (fx as unknown as { batches: Map<string, { positions: Float32Array }> }).batches;
    const b = [...batches.values()][0];
    // Four corners of three numbers a quad, the frame's quads first in the batch's buffer.
    out.push(b ? Array.from(b.positions.subarray(0, Math.min(b.positions.length, fx.quads * 12))) : []);
  }
  const live = fx.particlesOf(h);
  fx.dispose?.();
  return { frames: out, live };
}

const sameTrace = (a: number[][], b: number[][]): boolean => a.length === b.length && a.every((f, i) => f.length === b[i].length && f.every((v, k) => Object.is(v, b[i][k])));
/** A trace's own spelling, hashed: what a70487c's player made of each test effect, held where git cannot hand it over. */
const traceHash = (t: { frames: number[][]; live: number }): string => createHash('sha1').update(JSON.stringify(t)).digest('hex').slice(0, 16);
// Taken once by running a70487c's player over these very effects (the three runs below, with no size); today's held to
// them only when git cannot hand that player over, so the day one never passes on nothing.
const PRE_WAVE_TRACES = { test: '104f42ccb1a3ac76', mesh: 'be3f77f64417081b', dist: '5d0835af776b825d' };

const plain = await play(NEW);
const quads = plain.frames.reduce((n, f) => n + f.length / 12, 0);
ok(quads > 100, `today's player plays the test effect (${quads} quads over 90 frames)`);
const plainMesh = await play(NEW, { file: 'mesh.json' });
const plainDist = await play(NEW, { file: 'dist.json', move: 0.4, frames: 150 });
ok(plainMesh.frames.reduce((n, f) => n + f.length / 16, 0) > 100 && plainDist.live > 20, `and the mesh effect draws its model (${plainMesh.frames.reduce((n, f) => n + f.length / 16, 0)} instances over 90 frames), and the distance effect spawns as it travels (${plainDist.live} particles over 60 m)`);
if (OLDP) {
  const then = await play(OLDP);
  const thenMesh = await play(OLDP, { file: 'mesh.json' });
  const thenDist = await play(OLDP, { file: 'dist.json', move: 0.4, frames: 150 });
  ok(sameTrace(then.frames, plain.frames) && sameTrace(thenMesh.frames, plainMesh.frames) && thenDist.live === plainDist.live && sameTrace(thenDist.frames, plainDist.frames), `with no size an effect plays exactly as ${PRE_WAVE}'s player played it, every quad's corners and every model's matrix every frame, and every distance-spawned particle (hashes ${traceHash(then)}, ${traceHash(thenMesh)}, ${traceHash(thenDist)})`);
  ok(traceHash(then) === PRE_WAVE_TRACES.test && traceHash(thenMesh) === PRE_WAVE_TRACES.mesh && traceHash(thenDist) === PRE_WAVE_TRACES.dist, `and that player's traces are the ones recorded here for a machine where git cannot hand it over`);
} else {
  ok(traceHash(plain) === PRE_WAVE_TRACES.test && traceHash(plainMesh) === PRE_WAVE_TRACES.mesh && traceHash(plainDist) === PRE_WAVE_TRACES.dist, `git cannot hand ${PRE_WAVE}'s player over: with no size an effect plays as the traces recorded from it (${traceHash(plain)}, ${traceHash(plainMesh)}, ${traceHash(plainDist)})`);
}
const one = await play(NEW, { size: 1 });
ok(sameTrace(one.frames, plain.frames), 'a size of 1 is no size at all');
const two = await play(NEW, { size: 2 });
// Sized again in place (`ParticleEffects.resize`, the world editor's C on an attachment's handle): from that moment it
// plays exactly as one placed at that size, the same draws, nothing placed again.
const resized = await play(NEW, { size: 1, resizeTo: 2 });
ok(sameTrace(resized.frames, two.frames), 'an effect sized again where it stands plays exactly as one placed at that size, every quad every frame');
// The mesh emitter at size 2: every instance's matrix twice the size-1 one's in its place and its scale (its turn as it
// was), the same draws in the same order.
const meshTwo = await play(NEW, { file: 'mesh.json', size: 2 });
let meshWorst = 0;
let meshCount = 0;
for (let i = 0; i < plainMesh.frames.length; i++) {
  const a = plainMesh.frames[i];
  const b = meshTwo.frames[i];
  if (a.length !== b.length) {
    meshWorst = Infinity;
    break;
  }
  for (let k = 0; k < a.length; k++) {
    // Column-major: the first twelve are the scaled turn, the last four the place and 1; every one but the last doubles.
    const want = k % 16 === 15 ? a[k] : a[k] * 2;
    meshWorst = Math.max(meshWorst, Math.abs(b[k] - want) / Math.max(1, Math.abs(want)));
    meshCount++;
  }
}
ok(Number.isFinite(meshWorst) && meshWorst < 1e-5 && meshCount > 1000, `at a size of 2 a mesh emitter's every model stands twice as far out and twice as big, the same draws (worst ${meshWorst.toExponential(2)} over ${meshCount} numbers)`);
// The distance emitter at size 2: its spacing is the rate times the root of its scale, so the same travel spawns the
// root of two fewer, to a particle or two of the fractions carried between frames.
const distTwo = await play(NEW, { file: 'dist.json', move: 0.4, frames: 150, size: 2 });
ok(Math.abs(distTwo.live * Math.SQRT2 - plainDist.live) <= 2 && distTwo.live < plainDist.live, `at a size of 2 a distance emitter spawns the root of two fewer over the same travel (${plainDist.live} at its own size, ${distTwo.live} at twice it)`);
// The camera turns every quad to face it, so a corner is the quad's middle plus its spans; all of it scales with the size,
// and the middle's place with it (its origin at the world's): every corner twice as far from the origin, to float precision.
// The batch draws its quads far to near from the camera, which the larger effect orders otherwise, so each frame's quads are
// compared as sets (sorted by their middles).
const sorted = (f: number[], k: number): number[][] => {
  const qs: number[][] = [];
  for (let i = 0; i + 12 <= f.length; i += 12) qs.push(f.slice(i, i + 12).map((v) => v * k));
  const mid = (q: number[]) => q[0] + q[3] + q[6] + q[9] + 1e-3 * (q[1] + q[4] + q[7] + q[10]);
  return qs.sort((a, b) => mid(a) - mid(b));
};
let worst = 0;
let count = 0;
for (let i = 0; i < plain.frames.length; i++) {
  if (plain.frames[i].length !== two.frames[i].length) {
    worst = Infinity;
    break;
  }
  const a = sorted(plain.frames[i], 2);
  const b = sorted(two.frames[i], 1);
  for (let q = 0; q < a.length; q++) {
    for (let k = 0; k < 12; k++) {
      worst = Math.max(worst, Math.abs(b[q][k] - a[q][k]) / Math.max(1, Math.abs(a[q][k])));
      count++;
    }
  }
}
ok(Number.isFinite(worst) && worst < 1e-5 && count > 1000, `at a size of 2 every corner of every quad stands twice as far out, the same draws, the same count (worst ${worst.toExponential(2)} over ${count} numbers)`);

if (OLD) rmSync(dirname(OLD), { recursive: true, force: true });
console.log(`\neffectSize: ${checks} checks passed`);
