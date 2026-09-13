// Clip bundles: animations lifted out of a GLB and put back must come back bit for bit, because
// the Jedi Academy clips a converted player carries cannot be rebuilt without a Jedi Academy
// install. A bundle is what makes the model safe to convert again.
import assert from 'node:assert/strict';
import { extractClips, replaceClips, skinJoints, writeGlb } from '../glbclips.mjs';
import { packClips, retargetClips, unpackClips } from '../clipbundle.mjs';

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`ok   ${name}`);
};

/** A GLB with a three-joint skin and no animations, for clips to be written onto. */
function emptyRig(): Buffer {
  const json = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    scene: 0,
    nodes: [
      { name: 'root', children: [1], rotation: [0, 0, 0, 1], translation: [0, 0, 0] },
      { name: 'spine', children: [2], rotation: [0, 0, 0, 1], translation: [0, 1, 0] },
      { name: 'head', rotation: [0, 0, 0, 1], translation: [0, 0.5, 0] },
    ],
    skins: [{ joints: [0, 1, 2] }],
    buffers: [{ byteLength: 0 }],
  };
  return writeGlb(json, Buffer.alloc(0));
}

const clip = (name: string, frames: number) => ({
  name,
  times: Float32Array.from({ length: frames }, (_, i) => i / 30),
  tracks: [0, 1, 2].map((j) => ({
    rotations: Float32Array.from({ length: frames * 4 }, (_, i) => {
      // A believable, non-unit-aligned quaternion per frame so normalisation would show up.
      const f = Math.floor(i / 4);
      const a = (f + j) * 0.13;
      return [Math.sin(a) * 0.3, Math.cos(a) * 0.4, Math.sin(a * 2) * 0.2, Math.cos(a * 0.5)][i % 4];
    }),
    translations: Float32Array.from({ length: frames * 3 }, (_, i) => (i % 3) * 0.25 + Math.floor(i / 3) * 0.01 + j),
  })),
});

const withClips = replaceClips(emptyRig(), [clip('BOTH_A1_T__B_', 5), clip('walk', 7)]);

check('a GLB round trips through a bundle unchanged', () => {
  const bundle = extractClips(withClips);
  assert.equal(bundle.clips.length, 2);
  assert.deepEqual(bundle.joints, ['root', 'spine', 'head']);
  const again = unpackClips(packClips(bundle));
  assert.equal(again.clips.length, 2);
  for (let c = 0; c < 2; c++) {
    assert.equal(again.clips[c].name, bundle.clips[c].name);
    assert.deepEqual([...again.clips[c].times], [...bundle.clips[c].times]);
    for (let t = 0; t < 3; t++) {
      assert.deepEqual([...again.clips[c].tracks[t].rotations], [...bundle.clips[c].tracks[t].rotations], `clip ${c} joint ${t} rotations`);
      assert.deepEqual([...again.clips[c].tracks[t].translations], [...bundle.clips[c].tracks[t].translations]);
    }
  }
});

check('applying a bundle to a fresh rig reproduces the original exactly', () => {
  const bundle = unpackClips(packClips(extractClips(withClips)));
  const joints = skinJoints(JSON.parse(withClips.toString('utf8', 20, 20 + withClips.readUInt32LE(12)).replace(/\0+$/, '')));
  const { clips, missing } = retargetClips(bundle, joints);
  assert.deepEqual(missing, []);
  const rebuilt = replaceClips(emptyRig(), clips);
  const before = extractClips(withClips);
  const after = extractClips(rebuilt);
  assert.equal(after.clips.length, before.clips.length);
  for (let c = 0; c < before.clips.length; c++) {
    for (let t = 0; t < 3; t++) {
      assert.deepEqual([...after.clips[c].tracks[t].rotations], [...before.clips[c].tracks[t].rotations], 'rotations are copied, never resampled');
      assert.deepEqual([...after.clips[c].tracks[t].translations], [...before.clips[c].tracks[t].translations]);
    }
  }
});

check('only the clips asked for are lifted', () => {
  const jka = extractClips(withClips, (n) => n.startsWith('BOTH_'));
  assert.deepEqual(jka.clips.map((c) => c.name), ['BOTH_A1_T__B_']);
});

check('a joint the bundle does not carry holds its bind pose', () => {
  const bundle = extractClips(withClips);
  const target = [
    { name: 'root', rotation: [1, 0, 0, 0], translation: [0, 0, 0] },
    { name: 'spine', rotation: [1, 0, 0, 0], translation: [0, 1, 0] },
    { name: 'extra_finger', rotation: [0.5, 0.5, 0.5, 0.5], translation: [1, 2, 3] },
  ];
  const { clips, missing } = retargetClips(bundle, target as never);
  assert.deepEqual(missing, ['extra_finger']);
  const t = clips[0].tracks[2];
  // The converter holds rotations w-first; glTF writes x,y,z,w.
  assert.deepEqual([...t.rotations.subarray(0, 4)], [0.5, 0.5, 0.5, 0.5]);
  assert.deepEqual([...t.translations.subarray(0, 3)], [1, 2, 3]);
});

check('a bundle carries what the GLB cannot say about its clips', () => {
  // Whether a clip loops lives in the manifest, not the GLB. Losing it is as bad as losing the
  // clip: every Jedi Academy attack would repeat instead of stopping on its last frame.
  const bundle = extractClips(withClips);
  const meta = { jkaClips: { BOTH_A1_T__B_: { loop: false, fps: 20, frames: 5 } }, clipSpeeds: { walk: 1.4 }, scale: 1 };
  const again = unpackClips(packClips({ ...bundle, meta }));
  assert.deepEqual(again.meta, meta);
  assert.equal(again.meta.jkaClips.BOTH_A1_T__B_.loop, false);
});

check('a bundle without metadata still unpacks', () => {
  const again = unpackClips(packClips(extractClips(withClips)));
  assert.equal(again.meta, null);
  assert.equal(again.clips.length, 2);
});

check('a bundle that is not one is refused', () => {
  assert.throws(() => unpackClips(Buffer.from('not a bundle at all')), /bad magic/);
});

console.log(`${passed} checks passed`);
