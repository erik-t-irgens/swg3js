// The grapple's look (wave 2), against the game's own code: the rope's ribbon laid over random ropes allocates
// nothing and is never thinner than `minPx` on the screen at any ring; the sound step, which the game runs every frame
// for a player who may never fire, allocates nothing; and the left arm's aim (`aimArmBones`, what
// `CharacterRig.aimArm` runs) is the rig's old arithmetic to the bit at a weight of 1, leaves the clip's pose exactly
// as it stood at nought, and lies between the two at any weight between.
//
// The allocation measure is the nebula test's and test 17's: the young generation over many frames, read only after
// two turns of the loop (when the observer is told of a collection), the cleanest of three windows, each after a full
// collection, a re-warm and a minor collection. Without `--expose-gc` it says so and holds nothing of it.
//
// Run: node --expose-gc tools/swg/tests/grappleLook.test.ts
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import { PerformanceObserver, constants as perfConstants } from 'node:perf_hooks';
import * as THREE from 'three';
import { GRAPPLE_TUNE } from '../../../src/player/grapple.ts';
import { RopeRibbon } from '../../../src/player/grappleDraw.ts';
import { aimArmBones } from '../../../src/player/armAim.ts';
import { GrappleSounds, type GrappleJkaSource, type GrappleSoundHost, type GrappleSoundSource } from '../../../src/audio/grappleSounds.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);
let seed = 7;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

// --- the ribbon -----------------------------------------------------------------------------------------------
const POINTS = 40;
const ribbon = new RopeRibbon(POINTS, GRAPPLE_TUNE.sagSegments);
const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 9000);
camera.position.set(3, 2, 8);
camera.updateMatrixWorld();
// Random ropes made before anything is measured: the anchor, up to a few bends, the hand, and the slack.
const ROPES = 64;
const ropes: { pts: Float64Array; n: number; hand: { x: number; y: number; z: number }; slack: number }[] = [];
for (let r = 0; r < ROPES; r++) {
  const n = 1 + Math.floor(rand() * 6);
  const pts = new Float64Array(3 * POINTS);
  for (let i = 0; i < n; i++) {
    pts[3 * i] = (rand() - 0.5) * 200;
    pts[3 * i + 1] = rand() * 60;
    pts[3 * i + 2] = (rand() - 0.5) * 200;
  }
  ropes.push({ pts, n, hand: { x: (rand() - 0.5) * 20, y: rand() * 10, z: (rand() - 0.5) * 20 }, slack: rand() < 0.3 ? 0 : rand() * 3 });
}
let at = 0;
const lay = () => {
  const r = ropes[at];
  at = (at + 1) % ROPES;
  ribbon.slack = r.slack;
  ribbon.screenH = 1080;
  ribbon.lay(r.pts, r.n, r.hand, camera);
};

// Every ring at least `minPx` across on a 1080-line screen at its own distance from the camera.
{
  const pos = ribbon.mesh.geometry.getAttribute('position').array as Float32Array;
  const tan = Math.tan((camera.fov * Math.PI) / 360);
  let worst = Infinity;
  let rings = 0;
  for (let r = 0; r < ROPES; r++) {
    lay();
    for (let i = 0; i < ribbon.rings; i++) {
      const j = 6 * i;
      const cx = (pos[j] + pos[j + 3]) / 2;
      const cy = (pos[j + 1] + pos[j + 4]) / 2;
      const cz = (pos[j + 2] + pos[j + 5]) / 2;
      const dist = Math.hypot(cx - camera.position.x, cy - camera.position.y, cz - camera.position.z);
      const width = Math.hypot(pos[j + 3] - pos[j], pos[j + 4] - pos[j + 1], pos[j + 5] - pos[j + 2]);
      const perPx = (2 * dist * tan) / 1080;
      worst = Math.min(worst, width / perPx);
      rings++;
    }
  }
  // The positions are single precision: a width of 1.5 px is held to a few parts in a million of itself.
  ok(rings > ROPES && worst >= GRAPPLE_TUNE.minPx * (1 - 1e-4), `over ${ROPES} random ropes (${rings} rings) every ring is at least ${GRAPPLE_TUNE.minPx} px across at its own distance (the thinnest ${worst.toFixed(4)} px)`);
}

// The ribbon's lay allocates nothing.
{
  const gc = (globalThis as { gc?: (o?: { type: 'minor' }) => void }).gc;
  if (!gc) note('run with node --expose-gc to measure the ribbon\'s allocation; held to nothing only then');
  else {
    let scavenges = 0;
    const watch = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
    });
    watch.observe({ entryTypes: ['gc'] });
    const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
    const tick = () => new Promise((r) => setImmediate(r));
    const settle = async () => {
      await tick();
      await tick();
    };
    const FRAMES = 100_000;
    for (let k = 0; k < 50_000; k++) lay();
    let best = { made: Infinity, scavenges: Infinity };
    for (let attempt = 0; attempt < 3; attempt++) {
      gc();
      await settle();
      for (let k = 0; k < 20_000; k++) lay();
      gc({ type: 'minor' });
      await settle();
      scavenges = 0;
      const before = young();
      for (let k = 0; k < FRAMES; k++) lay();
      const made = young() - before;
      await settle();
      if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges };
      if (best.scavenges === 0 && best.made <= 0) break;
    }
    watch.disconnect();
    const perFrame = best.scavenges > 0 ? Infinity : Math.max(0, best.made) / FRAMES;
    ok(best.scavenges === 0 && perFrame < 0.2, `the ribbon laid ${FRAMES} times over random ropes moves the young generation by ${perFrame.toFixed(3)} B a lay (${best.scavenges} collections; under 0.2)`);
  }
}

// The sound step, as the game calls it on every frame of the session, the select screen included, for a player who
// never fires: the hook's counts compared and nothing played, handed the velocity record (never a speed worked out in
// the call), with a Jedi Academy pack that has no melee whoosh (decided once, never asked again every frame).
{
  const gc = (globalThis as { gc?: (o?: { type: 'minor' }) => void }).gc;
  if (!gc) note("run with node --expose-gc to measure the sound step's allocation; held to nothing only then");
  else {
    let started = 0;
    const host: GrappleSoundHost = {
      bank: { available: true, template: () => null, offer: () => {} },
      play: () => ++started,
      loop: () => ++started,
      stop: () => {},
      setGain: () => {},
      isPlaying: () => false,
      prepare: () => {},
    };
    // The sabers' own lookup, its `.wav`/`.mp3` fall-back and all, over a pack that holds no melee whoosh.
    const files: Record<string, string> = { 'sound/weapons/saber/saberhum1.wav': 'x' };
    const lookup = (path: string): string | null => {
      if (files[path] !== undefined) return path;
      const other = path.endsWith('.wav') ? `${path.slice(0, -4)}.mp3` : null;
      return other && files[other] !== undefined ? other : null;
    };
    const jka: GrappleJkaSource = { jkaFile: lookup, jkaFiles: files };
    // The control: a pack that is another object every frame, so the whoosh is looked for every frame.
    const fresh: GrappleJkaSource = {
      jkaFile: lookup,
      get jkaFiles() {
        return { ...files };
      },
    };
    const source: GrappleSoundSource = {
      counts: { fires: 0, bites: 0, ratchets: 0, boosts: 0, slams: 0 },
      ratchetIn: true,
      attached: false,
      out: false,
      released: false,
      keys: { haul: false },
      lastSlam: { x: 0, y: 0, z: 0 },
      clock: 0,
    };
    const vel = { x: 0.5, y: -0.25, z: 3.125 };
    const hand = { x: 1, y: 2, z: 3 };
    const space = { building: -1, cell: -1 };
    const measure = async (sounds: GrappleSounds): Promise<number> => {
      let scavenges = 0;
      const watch = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if ((e as unknown as { detail?: { kind?: number } }).detail?.kind === perfConstants.NODE_PERFORMANCE_GC_MINOR) scavenges++;
      });
      watch.observe({ entryTypes: ['gc'] });
      const young = (): number => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
      const tick = () => new Promise((r) => setImmediate(r));
      const settle = async () => {
        await tick();
        await tick();
      };
      const step = () => {
        // The body moves under it, as a walking player's does.
        vel.x = -vel.x;
        sounds.step(source, hand, vel, space as never, true);
      };
      const FRAMES = 200_000;
      for (let k = 0; k < 50_000; k++) step();
      let best = { made: Infinity, scavenges: Infinity };
      for (let attempt = 0; attempt < 3; attempt++) {
        gc();
        await settle();
        for (let k = 0; k < 20_000; k++) step();
        gc({ type: 'minor' });
        await settle();
        scavenges = 0;
        const before = young();
        for (let k = 0; k < FRAMES; k++) step();
        const made = young() - before;
        await settle();
        if (scavenges < best.scavenges || (scavenges === best.scavenges && made < best.made)) best = { made, scavenges };
        if (best.scavenges === 0 && best.made <= 0) break;
      }
      watch.disconnect();
      return best.scavenges > 0 ? Infinity : Math.max(0, best.made) / FRAMES;
    };
    const kept = new GrappleSounds();
    kept.attach(host, jka);
    const perFrame = await measure(kept);
    const control = new GrappleSounds();
    control.attach(host, fresh);
    const perFrameControl = await measure(control);
    ok(perFrame < 0.2 && started === 0, `the sound step for a player who never fires, with a Jedi Academy pack that has no melee whoosh, moves the young generation by ${perFrame.toFixed(3)} B a frame (under 0.2) and plays nothing`);
    ok(perFrameControl > 8, `and with that pack looked at afresh every frame it allocates (${Number.isFinite(perFrameControl) ? `${perFrameControl.toFixed(1)} B a frame` : 'enough to run the young generation\'s collection'}): the measure sees what was taken out`);
  }
}

// --- the arm --------------------------------------------------------------------------------------------------
// A synthetic chain: a root turned and scaled as a rig's is, a spine, a shoulder, the upper arm and the forearm, each
// with its own turn and place, posed afresh for every case.
const root = new THREE.Group();
const spine = new THREE.Bone();
const shoulder = new THREE.Bone();
const upper = new THREE.Bone();
const fore = new THREE.Bone();
const hand = new THREE.Bone();
root.add(spine);
spine.add(shoulder);
shoulder.add(upper);
upper.add(fore);
fore.add(hand);
spine.position.set(0, 1, 0);
shoulder.position.set(0.15, 0.4, 0);
upper.position.set(0.12, 0, 0);
fore.position.set(0.28, 0, 0);
hand.position.set(0.25, 0, 0);
const holder = new THREE.Group();
holder.add(root);
const randomTurn = (q: THREE.Quaternion, spread = Math.PI) => q.setFromEuler(new THREE.Euler((rand() - 0.5) * spread, (rand() - 0.5) * spread, (rand() - 0.5) * spread));
// The bind pose as the rig's constructor measures it: the rest axis in root space, the upper arm's turn relative to the
// root, the forearm's own.
randomTurn(spine.quaternion, 0.5);
randomTurn(shoulder.quaternion, 0.5);
randomTurn(upper.quaternion, 0.8);
randomTurn(fore.quaternion, 0.8);
root.scale.setScalar(0.95);
holder.updateMatrixWorld(true);
const rootInv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
const rest = fore.getWorldPosition(new THREE.Vector3()).sub(upper.getWorldPosition(new THREE.Vector3())).applyQuaternion(rootInv).normalize();
const bindToRoot = upper.getWorldQuaternion(new THREE.Quaternion()).premultiply(rootInv);
const bindLocal = fore.quaternion.clone();

/** The rig's `aimArm` as it stood before the weight, written out: the arithmetic the weight of 1 must be to the bit. */
function oldAim(dir: THREE.Vector3, roll: number): void {
  const rootQ = new THREE.Quaternion();
  const parentQ = new THREE.Quaternion();
  const restWorld = new THREE.Vector3();
  const dirWorld = new THREE.Vector3();
  const alignQ = new THREE.Quaternion();
  const tmpQ = new THREE.Quaternion();
  root.getWorldQuaternion(rootQ);
  upper.parent!.getWorldQuaternion(parentQ);
  restWorld.copy(rest).applyQuaternion(rootQ);
  dirWorld.copy(dir).applyQuaternion(rootQ).normalize();
  alignQ.setFromUnitVectors(restWorld, dirWorld);
  if (roll !== 0) alignQ.multiply(tmpQ.setFromAxisAngle(dirWorld, roll));
  upper.quaternion.copy(parentQ).invert().multiply(alignQ).multiply(rootQ).multiply(bindToRoot);
  fore.quaternion.copy(bindLocal);
}

/** A fresh clip pose and a fresh place and turn for the whole figure. */
const pose = () => {
  randomTurn(spine.quaternion, 0.6);
  randomTurn(shoulder.quaternion, 0.6);
  randomTurn(upper.quaternion, 1.5);
  randomTurn(fore.quaternion, 1.5);
  randomTurn(holder.quaternion);
  holder.position.set((rand() - 0.5) * 100, rand() * 20, (rand() - 0.5) * 100);
  holder.updateMatrixWorld(true);
};
const same = (a: THREE.Quaternion, b: THREE.Quaternion) => Object.is(a.x, b.x) && Object.is(a.y, b.y) && Object.is(a.z, b.z) && Object.is(a.w, b.w);
{
  let bitForBit = 0;
  let untouched = 0;
  let between = 0;
  const CASES = 2000;
  const clipUpper = new THREE.Quaternion();
  const clipFore = new THREE.Quaternion();
  const want = new THREE.Quaternion();
  const wantFore = new THREE.Quaternion();
  for (let c = 0; c < CASES; c++) {
    pose();
    clipUpper.copy(upper.quaternion);
    clipFore.copy(fore.quaternion);
    const dir = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
    const roll = rand() < 0.5 ? 0 : (rand() - 0.5) * 2;
    oldAim(dir, roll);
    want.copy(upper.quaternion);
    wantFore.copy(fore.quaternion);
    // Weight 1: the old arithmetic to the bit.
    upper.quaternion.copy(clipUpper);
    fore.quaternion.copy(clipFore);
    aimArmBones(root, upper, fore, rest, bindToRoot, bindLocal, dir, roll, 1);
    if (same(upper.quaternion, want) && same(fore.quaternion, wantFore)) bitForBit++;
    // Weight 0: the clip's pose exactly as it stood.
    upper.quaternion.copy(clipUpper);
    fore.quaternion.copy(clipFore);
    aimArmBones(root, upper, fore, rest, bindToRoot, bindLocal, dir, roll, 0);
    if (same(upper.quaternion, clipUpper) && same(fore.quaternion, clipFore)) untouched++;
    // Between: the bone is as far round from the clip's pose as the weight says, of the whole way to the aim.
    const w = 0.1 + 0.8 * rand();
    upper.quaternion.copy(clipUpper);
    fore.quaternion.copy(clipFore);
    aimArmBones(root, upper, fore, rest, bindToRoot, bindLocal, dir, roll, w);
    const whole = clipUpper.angleTo(want);
    if (Math.abs(clipUpper.angleTo(upper.quaternion) - w * whole) < 1e-6 && Math.abs(upper.quaternion.angleTo(want) - (1 - w) * whole) < 1e-6) between++;
  }
  ok(bitForBit === CASES, `at a weight of 1 the arm's aim is the rig's old arithmetic to the bit, upper arm and forearm (${bitForBit} of ${CASES} random poses, places, aims and rolls)`);
  ok(untouched === CASES, `at a weight of nought the clip's pose is left exactly as it stood (${untouched} of ${CASES})`);
  ok(between === CASES, `and at any weight between, the upper arm is that share of the way from the clip's pose to the aim (${between} of ${CASES})`);
}

console.log(`\n${checks} checks passed`);
