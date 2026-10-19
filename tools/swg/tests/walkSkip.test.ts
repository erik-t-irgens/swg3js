// The scene's matrix walk stepping over a body (the performance pass's third wave, `src/world/mobiles/bodyGroup.ts`), in
// node over a real three hierarchy: a `BodyGroup` with an `inner` group, a model, 48 bones, ten skinned meshes over one
// skeleton and a weapon holder on a hand bone, animated by a mixer from a clip made here, beside a plain group built and
// animated alike that the walk works out whole every frame. A culled frame walks none of the subtree and the first walk
// after it is shown works it out again; on every shown frame every bone's world matrix is bit for bit the always-walked
// body's; a frame the mixer and the root did not move is skipped as still and changes no matrix; a frame on which only
// `inner` moves (turned, lifted, faded) or only the weapon holder does is walked, every matrix still bit for bit, while the
// same write unmarked is shown to leave the body stale (the case a first audit of the writers would have missed); a body
// that does not mark its poses (a fighter) is never skipped as still; `walkWhole` works it out culled or not; and each
// switch at the old way walks everything. Then, read as text: every writer of a position, a turn or a scale of any node
// of a body under `src/world/mobiles/`, and every add of a node under one, is exactly the listed sites, each in a method
// that calls `posed()` (the files split on `\r?\n`, so a CRLF checkout bounds its methods as an LF one does); `npcs.ts`
// never marks its root still; and the readers of a body's world matrices there work them out themselves. Last, the frame
// report's switches and the walk's counters in `main.ts`, which the wave's before-and-after numbers rest on.
//
// Everything here is synthetic: numbers chosen for this test, nothing read from the game's files.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { BODY_WALK, BODY_WALK_STATS, BodyGroup, endBodyWalkFrame } from '../../../src/world/mobiles/bodyGroup.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const BONES = 48;
const MESHES = 10;

interface Body {
  root: THREE.Group;
  inner: THREE.Group;
  model: THREE.Group;
  bones: THREE.Bone[];
  holder: THREE.Group;
  gun: THREE.Mesh;
  mixer: THREE.AnimationMixer;
}

/** A clip of our own over some of the bones: turns, a lift and a sway, two seconds long, looping. */
function makeClip(): THREE.AnimationClip {
  const tracks: THREE.KeyframeTrack[] = [];
  const times = [0, 0.5, 1, 1.5, 2];
  for (const i of [1, 3, 7, 12, 20, 33, 47]) {
    const q = new THREE.Quaternion();
    const values: number[] = [];
    for (let k = 0; k < times.length; k++) {
      q.setFromEuler(new THREE.Euler(0.1 * Math.sin(k + i), 0.2 * Math.cos(k * 0.7 + i), 0.05 * k));
      values.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`b${i}.quaternion`, times, values));
  }
  tracks.push(new THREE.VectorKeyframeTrack('b0.position', times, [0, 0.9, 0, 0.02, 0.92, 0, 0, 0.94, 0.01, -0.02, 0.92, 0, 0, 0.9, 0]));
  return new THREE.AnimationClip('walk', 2, tracks);
}

const CLIP = makeClip();

/** One body under `parent`: its root (a `BodyGroup`, or a plain group for the body walked whole every frame). */
function makeBody(root: THREE.Group, parent: THREE.Object3D): Body {
  root.position.set(3, 0.9, -2);
  root.rotation.y = 0.4;
  const inner = new THREE.Group();
  inner.position.y = -0.9;
  inner.scale.setScalar(1.1);
  root.add(inner);
  const model = new THREE.Group();
  model.name = 'model';
  model.rotation.set(0.05, 0.1, 0);
  inner.add(model);
  const bones: THREE.Bone[] = [];
  for (let i = 0; i < BONES; i++) {
    const b = new THREE.Bone();
    b.name = `b${i}`;
    b.position.set(0.01 * (i % 5), i === 0 ? 0.9 : 0.06, 0.005 * (i % 3));
    if (i === 0) model.add(b);
    else bones[Math.floor((i - 1) / 2)].add(b);
    bones.push(b);
  }
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  for (let k = 0; k < MESHES; k++) {
    const g = new THREE.BoxGeometry(0.2, 0.3, 0.2);
    const n = g.getAttribute('position').count;
    const idx = new Float32Array(n * 4);
    const w = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) {
      idx[v * 4] = (k * 4 + v) % BONES;
      w[v * 4] = 1;
    }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(idx, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
    const m = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial());
    m.name = `part${k}`;
    model.add(m);
    m.bind(skeleton);
  }
  // The weapon in the hand, as `Mobile.equip` hangs it on a bone.
  const holder = new THREE.Group();
  holder.scale.setScalar(0.9);
  bones[BONES - 1].add(holder);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.6), new THREE.MeshBasicMaterial());
  gun.position.z = 0.3;
  holder.add(gun);
  parent.add(root);
  // What `Mobile.attach` and `Mobile.equip` do after hanging the model and the weapon: the nodes added since the walk
  // above have never been walked, so the next walk must be a whole one.
  if (root instanceof BodyGroup) root.posed();
  const mixer = new THREE.AnimationMixer(model);
  mixer.clipAction(CLIP).play();
  return { root, inner, model, bones, holder, gun, mixer };
}

const scene = new THREE.Scene();
const container = new THREE.Group();
container.name = 'mobiles';
scene.add(container);
const test = new BodyGroup(true);
const T = makeBody(test, container);
const R = makeBody(new THREE.Group(), container);

/** How many times the test body's subtree was walked: `inner`'s own walk, counted. */
let innerWalks = 0;
const innerWalk = T.inner.updateMatrixWorld.bind(T.inner);
T.inner.updateMatrixWorld = (force?: boolean) => {
  innerWalks++;
  innerWalk(force);
};

/** Whether every bone's, the holder's and the gun's world matrix is bit for bit the always-walked body's. */
function same(): boolean {
  const pairs: [THREE.Object3D, THREE.Object3D][] = T.bones.map((b, i): [THREE.Object3D, THREE.Object3D] => [b, R.bones[i]]);
  pairs.push([T.holder, R.holder], [T.gun, R.gun], [T.inner, R.inner]);
  for (const [a, b] of pairs) {
    const x = a.matrixWorld.elements;
    const y = b.matrixWorld.elements;
    for (let k = 0; k < 16; k++) if (!Object.is(x[k], y[k])) return false;
  }
  return true;
}

/** One frame: the mixer (when `mix`), the root moved (when `move`), the walk; answers how many times the subtree was walked. */
function frame(mix: number, move: boolean): number {
  if (mix > 0) {
    T.mixer.update(mix);
    R.mixer.update(mix);
    // What `Mobile.animate` does whenever the mixer runs.
    test.posed();
  }
  if (move) {
    T.root.position.x += 0.05;
    R.root.position.x += 0.05;
    T.root.rotation.y += 0.01;
    R.root.rotation.y += 0.01;
  }
  innerWalks = 0;
  scene.updateMatrixWorld();
  endBodyWalkFrame();
  return innerWalks;
}

// ---- 1. Shown, every frame walked or skipped, every matrix the always-walked body's. ----
{
  BODY_WALK.culled = true;
  BODY_WALK.still = true;
  ok(frame(0, false) === 1 && same(), 'the first walk after its model and weapon were hung is a whole one, and every world matrix is the always-walked body\'s');
  ok(frame(1 / 60, false) === 1 && same(), 'a frame its mixer ran is walked whole');
  ok(frame(0, false) === 0 && same() && BODY_WALK_STATS.lastStill === 1, 'a frame the mixer and the root did not move is skipped as still, and changes no matrix');
  ok(frame(0, true) === 1 && same(), 'a frame only the root moved is walked whole (its world matrix is no longer the one kept)');
  let walked = 0;
  let allSame = true;
  for (let f = 0; f < 240; f++) {
    // The tiers' own rhythm: the mixer every fourth frame, the root moving now and then.
    walked += frame(f % 4 === 0 ? 4 / 60 : 0, f % 37 === 5);
    allSame &&= same();
  }
  ok(allSame, 'over 240 frames of a mixer every fourth frame and a root that sometimes moves, every bone, the holder and the gun bit for bit the always-walked body\'s on every frame');
  ok(walked > 55 && walked < 80, `and the subtree walked only on the frames something moved (${walked} of 240)`);
}

// ---- 2. `inner` and the holder moving while the mixer and the root stand still: the case the first audit missed. ----
{
  frame(1 / 60, false);
  frame(0, false);
  // Unmarked, as a writer that forgot `posed()` would leave it: the skip keeps last walk's matrices and the body is stale.
  T.inner.rotation.y = 0.3;
  R.inner.rotation.y = 0.3;
  const skipped = frame(0, false) === 0;
  ok(skipped && !same(), 'unmarked, a turn of `inner` under a still body is skipped and every bone is left where it was: the reason every writer must call posed()');
  test.posed();
  ok(frame(0, false) === 1 && same(), 'marked, the walk works it out whole and every bone is the always-walked body\'s again');
  const writes: [string, () => void][] = [
    ['inner eased round (the aim turn)', () => ((T.inner.rotation.y = 0.45), (R.inner.rotation.y = 0.45))],
    ['inner lifted (the step-up lag)', () => (T.inner.position.set(0, -0.8, 0.05), R.inner.position.set(0, -0.8, 0.05))],
    ['inner faded (a hologram\'s shrink)', () => (T.inner.scale.setScalar(0.6), R.inner.scale.setScalar(0.6))],
    ['the holder turned', () => (T.holder.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.7), R.holder.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.7))],
    ['the holder scaled', () => (T.holder.scale.setScalar(1.2), R.holder.scale.setScalar(1.2))],
  ];
  for (const [what, write] of writes) {
    frame(0, false);
    write();
    test.posed();
    ok(frame(0, false) === 1 && same(), `with the mixer and the root still, ${what} and marked: walked, every bone, the holder and the gun bit for bit the always-walked body's`);
  }
}

// ---- 3. Culled: none of the subtree walked, the first walk after it shown works it out again. ----
{
  test.culled = true;
  test.visible = false;
  let any = 0;
  for (let f = 0; f < 30; f++) any += frame(f % 2 === 0 ? 1 / 30 : 0, f % 7 === 3);
  ok(any === 0 && BODY_WALK_STATS.lastCulled === 1, 'a culled body walks none of its subtree, whatever its mixer and root do, and is counted as stepped over');
  ok(T.root.matrixWorld.equals(R.root.matrixWorld), "but its own matrix is composed every walk, so its root's world matrix stays this frame's");
  ok(!same(), 'its bones are left as they were, stale beside the always-walked body (nobody draws them)');
  test.culled = false;
  test.visible = true;
  test.matrixWorldNeedsUpdate = true;
  ok(frame(0, false) === 1 && same(), 'the first walk after it is shown works the whole body out again, even on a frame nothing posed it');
  ok(frame(0, false) === 0 && same(), 'and from then it is still again');
  // Culled again with its mixer and its root standing still the whole time, while a node under it is written with no
  // mark: nothing posed it, so only the cull itself can say its next walk is a whole one, which is the promise that a
  // shown body is always worked out whole however it was left while nobody drew it.
  test.culled = true;
  test.visible = false;
  frame(0, false);
  T.holder.position.x += 0.01;
  R.holder.position.x += 0.01;
  ok(frame(0, false) === 0, 'culled, a node written under it unmarked is not walked');
  test.culled = false;
  test.visible = true;
  test.matrixWorldNeedsUpdate = true;
  ok(frame(0, false) === 1 && same(), "shown again after a cull in which nothing posed it and its root stood still, its first walk is whole all the same (the cull's own reset, not a mixer's mark)");
  ok(frame(0, false) === 0 && same(), 'and it is still again after it');
}

// ---- 4. walkWhole, a body that does not mark its poses, and the switches at the old way. ----
{
  test.culled = true;
  frame(1 / 30, false);
  innerWalks = 0;
  test.walkWhole();
  ok(innerWalks === 1 && same(), 'walkWhole works a culled body out whole (a ragdoll built from its pose, a weapon hung in its hand)');
  test.culled = false;
  ok(frame(0, false) === 0 && same(), 'and that whole walk is kept: shown again with nothing posed since, the next frame is skipped as still and every matrix is right');
  const fighter = new BodyGroup();
  const F = makeBody(fighter, container);
  let fWalks = 0;
  const fw = F.inner.updateMatrixWorld.bind(F.inner);
  F.inner.updateMatrixWorld = (force?: boolean) => {
    fWalks++;
    fw(force);
  };
  frame(0, false);
  fWalks = 0;
  for (let f = 0; f < 10; f++) frame(0, false);
  ok(fWalks === 10 && fighter.still, "a body made without marking its poses (a fighter) is walked every frame although nothing posed it: `still` alone never skips it");
  container.remove(fighter);
  BODY_WALK.still = false;
  frame(0, false);
  ok(frame(0, false) === 1 && same(), 'walkStill at the old way: a still body is walked every frame');
  BODY_WALK.still = true;
  BODY_WALK.culled = false;
  test.culled = true;
  ok(frame(1 / 60, false) === 1 && same(), 'walkSkip at the old way: a culled body is walked every frame, and is the always-walked body\'s');
  test.culled = false;
  BODY_WALK.culled = true;
}

// ---- 5. The writers and the readers, read as text. ----
{
  const dir = new URL('../../../src/world/mobiles/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  // Every file is split on `\r?\n`: a working copy checked out with CRLF line ends (git's autocrlf, as this one is) would
  // otherwise never show a method's closing `  }`, every method would run to the end of its file, and the audit below
  // would pass with any writer's `posed()` taken out (`runaway` holds that it never does).
  const src = (f: string) => readFileSync(new URL(f, dir), 'utf8');
  const isComment = (line: string) => /^\s*(\/\/|\*|\/\*)/.test(line);
  /** The method a line sits in: the nearest line above it opening a method at two spaces in, and its name. */
  const METHOD = /^ {2}(?:(?:private|protected|public|static|override|readonly|async) )*(?:get |set )?(?!(?:for|if|while|switch|return|catch|do|else)\b)([A-Za-z_$][\w$]*)\s*\(/;
  /** Methods whose end was never found: their body ran to the end of the file. */
  const runaway: string[] = [];
  const methodAt = (lines: string[], at: number): { name: string; body: string } => {
    let start = at;
    while (start >= 0 && !METHOD.test(lines[start])) start--;
    if (start < 0) {
      // A function of the module's own (spineFold's `foldSpine`).
      start = at;
      while (start >= 0 && !/^export function ([A-Za-z_$][\w$]*)/.test(lines[start])) start--;
      const name = start >= 0 ? /^export function ([A-Za-z_$][\w$]*)/.exec(lines[start])![1] : '?';
      let end = at;
      while (end < lines.length && lines[end] !== '}') end++;
      if (end >= lines.length) runaway.push(name);
      return { name, body: lines.slice(start, end + 1).join('\n') };
    }
    const name = METHOD.exec(lines[start])![1];
    let end = at;
    while (end < lines.length && lines[end] !== '  }') end++;
    if (end >= lines.length) runaway.push(name);
    return { name, body: lines.slice(start, end + 1).join('\n') };
  };
  const WRITE = /\b((?:this\.)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\.(position|quaternion|rotation|scale)(?:\.(?:set|copy|setScalar|setFromUnitVectors|setFromAxisAngle|setFromEuler|setFromRotationMatrix|premultiply|multiply|slerp|identity|add|sub|lerp|applyQuaternion|multiplyScalar|addScaledVector|fromArray|setX|setY|setZ)\s*\(|\.[xyzw]\s*[+\-*/]?=(?!=)|\s*=(?!=))/;
  const ADD = /\b(this\.inner|this\.group|hand|holder|this\.model|scene)\.add\(/;
  const found: string[] = [];
  const unmarked: string[] = [];
  for (const f of files) {
    const lines = src(f).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isComment(line)) continue;
      const w = WRITE.exec(line);
      const a = ADD.exec(line);
      if (!w && !a) continue;
      // `this.scale` and its like are the class's own numbers, never a node's.
      if (w && w[1] === 'this') continue;
      const target = w ? `${w[1]}.${w[2]}` : `${a![1]}.add`;
      // The root's own writes are compared as the walk reaches it (its world matrix against the one kept).
      if (f === 'mobile.ts' && /^this\.group\.(position|quaternion|rotation|scale)$/.test(target)) continue;
      // The blade's group hangs beside the body, under the manager's container, never under the root.
      if (/^(b\.group|blade\.group)/.test(target)) continue;
      // The manager's container takes a body's root and a blade's group; it is no node of a body.
      if (f === 'manager.ts' && target === 'this.group.add') continue;
      const m = methodAt(lines, i);
      found.push(`${f} ${m.name} ${target}`);
      if (f === 'spineFold.ts') continue;
      if (!m.body.includes('this.posed()')) unmarked.push(`${f} ${m.name} ${target}`);
    }
  }
  const expected = [
    'mobile.ts constructor this.inner.position',
    'mobile.ts constructor this.inner.scale',
    'mobile.ts constructor this.group.add',
    'mobile.ts attach this.inner.add',
    'mobile.ts equip holder.add',
    'mobile.ts equip holder.scale',
    'mobile.ts equip hand.add',
    'mobile.ts equip holder.quaternion',
    'mobile.ts equip muzzle.position',
    'mobile.ts equip holder.add',
    'mobile.ts update this.inner.scale',
    'mobile.ts stepDriven this.inner.scale',
    'mobile.ts dropAim this.inner.rotation',
    'mobile.ts aimPose this.inner.rotation',
    'mobile.ts easeLift this.inner.position',
    'mobile.ts dropLiftLag this.inner.position',
    'spineFold.ts foldSpine bone.quaternion',
    'spineFold.ts foldSpine bone.quaternion',
  ];
  const sorted = (xs: string[]) => [...xs].sort().join('\n');
  ok(sorted(found) === sorted(expected), `every writer of a position, a turn or a scale of a node under a body in src/world/mobiles/, and every add of a node under one, is a listed site (found:\n${sorted(found)})`);
  ok(unmarked.length === 0, `and every one of them is in a method that calls posed() (${unmarked.join('; ') || 'all marked'})`);
  ok(runaway.length === 0, `and every method the audit read ends where it ends, not at the end of its file (${runaway.join(', ') || 'none ran away'}), whatever the files' line ends`);
  // The spine fold writes bones in a function of its own: every call of it is in a method that calls posed().
  const mobile = src('mobile.ts');
  const mlines = mobile.split(/\r?\n/);
  const folds = mlines.map((l, i) => (!isComment(l) && /\bfoldSpine\(/.test(l) ? i : -1)).filter((i) => i >= 0);
  ok(folds.length >= 2 && folds.every((i) => methodAt(mlines, i).body.includes('this.posed()')), "every call of the spine fold, which writes the spine's bones, is in a method that calls posed()");
  // The mixer, the ragdoll and a re-bind of the skeletons each mark the body.
  ok(/a\.update\(this\.animAcc\);[\s\S]{0,600}this\.posed\(\);/.test(mlines.slice(mlines.findIndex((l) => l.includes('private animate(dt: number, tier: LodTier): void {'))).join('\n').slice(0, 1200)), 'a frame its mixer ran marks the body posed');
  ok(/this\.ragdoll\.update\(dt\);\s*this\.posed\(\);/.test(mobile), "a frame the ragdoll moved its bones marks the body posed");
  ok(/reshare\(share: boolean\): number \{[\s\S]{0,300}this\.posed\(\);/.test(mobile), 'and so does binding its meshes to other skeletons');
  ok(/readonly group = new BodyGroup\(true\);/.test(mobile) && /posed\(\): void \{\s*this\.group\.posed\(\);/.test(mobile), "a mobile's root is a BodyGroup that marks its poses, and `Mobile.posed` is the root's");
  // No body's root is walked by hand through the method the skip lives in: `walkWhole` is the whole walk.
  const byHand: string[] = [];
  for (const f of files) {
    const lines = src(f).split(/\r?\n/);
    lines.forEach((l, i) => {
      if (!isComment(l) && /\.group\.updateMatrixWorld\(/.test(l)) byHand.push(`${f}:${i + 1}`);
    });
  }
  ok(byHand.length === 0 && (mobile.match(/this\.group\.walkWhole\(\);/g) ?? []).length === 2, `nothing in the folder walks a body's root by hand (${byHand.join(', ') || 'none'}): the weapon's hanging and the ragdoll's start call walkWhole`);
  // The readers of a node's world matrix work it out themselves first.
  const loose: string[] = [];
  // The walk itself (`bodyGroup.ts`) composes the matrices the rest read.
  for (const f of files.filter((x) => x !== 'bodyGroup.ts')) {
    const lines = src(f).split(/\r?\n/);
    lines.forEach((l, i) => {
      if (isComment(l) || !/\.localToWorld\(|\.matrixWorld\b/.test(l)) return;
      const m = methodAt(lines, i);
      const before = m.body.slice(0, m.body.indexOf(l));
      if (!/updateWorldMatrix\(true|walkWhole\(\)/.test(before)) loose.push(`${f} ${m.name}: ${l.trim()}`);
    });
  }
  ok(loose.length === 0, `every reader of a world matrix in the folder works it out itself first (${loose.join('; ') || 'all do'})`);
  // The fighters' root: a BodyGroup that never marks its poses, and nothing in npcs.ts makes it still.
  const npcs = readFileSync(new URL('../../../src/world/npcs.ts', import.meta.url), 'utf8');
  ok(/readonly group = new BodyGroup\(\);/.test(npcs) && !/\.still\s*=(?!=)/.test(npcs), "a fighter's root is a BodyGroup made without marking its poses, and npcs.ts never sets `still`");
  // The manager writes the whole cull beside the group's visibility, and a body coming back has its whole walk asked for.
  const manager = src('manager.ts');
  ok(/m\.group\.visible = visible;\s*m\.group\.culled = !visible;\s*if \(visible\) m\.group\.matrixWorldNeedsUpdate = true;/.test(manager), "the manager's whole cull is the walk's: `culled` is set beside `group.visible`, and a body shown again is marked for a whole walk");
  ok(runaway.length === 0, `and no method read since ran to the end of its file (${runaway.join(', ') || 'none'})`);
}

// ---- 6. The frame report's switches and counters, read as text: what the before-and-after numbers rest on. ----
{
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8');
  /** A switch's registration, from its name to the next registration. */
  const reg = (key: string): string => {
    const at = main.indexOf(`registerPerfSwitch('${key}', {`);
    if (at < 0) return '';
    const next = main.indexOf('registerPerfSwitch(', at + 1);
    return main.slice(at, next < 0 ? at + 2000 : next);
  };
  ok(/get: \(\) => BODY_WALK\.culled, set: \(v\) => \(BODY_WALK\.culled = !!v\), values: \[false, true\]/.test(reg('walkSkip')), '`walkSkip` reads and writes the culled skip (`BODY_WALK.culled`), its first value the old way');
  ok(/get: \(\) => BODY_WALK\.still, set: \(v\) => \(BODY_WALK\.still = !!v\), values: \[false, true\]/.test(reg('walkStill')), '`walkStill` reads and writes the still skip (`BODY_WALK.still`), its first value the old way');
  ok(/get: \(\) => CROWD_SWITCHES\.emptyMeshes,\s*set: \(v\) => \{\s*CROWD_SWITCHES\.emptyMeshes = !!v;\s*this\.world\.mobiles\?\.applyEmpties\(\);\s*\},\s*values: \[false, true\]/.test(reg('emptyMeshes')), '`emptyMeshes` reads and writes its own switch and applies it to every body at once');
  ok(/get: \(\) => CROWD_SWITCHES\.moverList, set: \(v\) => \(CROWD_SWITCHES\.moverList = !!v\), values: \[false, true\]/.test(reg('moverList')), '`moverList` reads and writes its own switch');
  ok(/get: \(\) => CROWD_SWITCHES\.smallParts,\s*set: \(v\) => \{\s*CROWD_SWITCHES\.smallParts = !!v;\s*this\.world\.mobiles\?\.applySmallParts\(\);\s*\},\s*values: \[false, true\]/.test(reg('smallParts')), '`smallParts` reads and writes its own switch and applies it to every body at once');
  ok(main.includes("const crowdKeys = ['walkSkip', 'walkStill', 'emptyMeshes', 'moverList'] as const;") && reg('crowdExact').includes('get: crowdGet,'), '`crowdExact` flips exactly the four exact fixes, and reads them back');
  // The walk's counts: added to the report on a timed frame, then rolled every frame, timed or not, after the draw.
  const counted = main.indexOf('perf.count(CNT.bodiesWalked, BODY_WALK_STATS.walked);');
  const rolled = main.indexOf('endBodyWalkFrame();', counted);
  const frameEnd = main.indexOf('perf.frameEnd(performance.now(), this.frameCalls, simulate);', counted);
  ok(counted > 0 && main.includes('perf.count(CNT.bodiesSkipped, BODY_WALK_STATS.culled + BODY_WALK_STATS.still);'), "a timed frame reports the bodies the walk worked out whole and stepped over");
  ok(rolled > counted && frameEnd > rolled && frameEnd - rolled < 400 && (main.match(/\bendBodyWalkFrame\(\);/g) ?? []).length === 1, 'and the frame loop rolls the counts once a frame, after them and before the frame ends, so `crowd().walk` reads one frame and never a running total');
}

console.log(`\n${checks} checks passed`);
