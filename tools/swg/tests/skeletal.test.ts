// A synthetic skeletal appearance: a two-joint skeleton, a skinned quad bound to both joints,
// and a one-second animation turning the child joint, written through the real writers and
// read back as a GLB with skin and animation.
import { form, chunk, W, encode } from './iffWriter.ts';
import { parseAnimation, parseMgn, parseSkeleton, poseAtFrame, qmul, skinData, skinnedPrimitives } from '../skeletal.mjs';
import { buildGlb } from '../glb.mjs';
import { parseIff } from '../iff.mjs';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`);
  if (!ok) failures++;
};
const near = (a: number, b: number, e = 1e-5) => Math.abs(a - b) < e;
const q = (w: number, x: number, y: number, z: number) => new W().f32(w).f32(x).f32(y).f32(z);
const id = [1, 0, 0, 0];

// skeleton: root at origin, child 1 m up, identity pre/post/bind rotations
const skt = Buffer.from(encode(form('SKTM', form('0002',
  chunk('INFO', new W().i32(2).bytes()),
  chunk('NAME', new W().str('root').str('child').bytes()),
  chunk('PRNT', new W().i32(-1).i32(0).bytes()),
  chunk('RPRE', new Uint8Array([...q(1, 0, 0, 0).bytes(), ...q(1, 0, 0, 0).bytes()])),
  chunk('RPST', new Uint8Array([...q(1, 0, 0, 0).bytes(), ...q(1, 0, 0, 0).bytes()])),
  chunk('BPTR', new W().f32(0).f32(0).f32(0).f32(0).f32(1).f32(0).bytes()),
  chunk('BPRO', new Uint8Array([...q(1, 0, 0, 0).bytes(), ...q(1, 0, 0, 0).bytes()])),
  chunk('JROR', new W().u32(0).u32(0).bytes())))));
const skeleton = parseSkeleton(parseIff(skt));
check('skeleton joints', skeleton.joints.length === 2 && skeleton.joints[1].parent === 0 && skeleton.joints[1].bindT[1] === 1);

// mesh: 4 positions (a quad from y=0 to y=2), bottom two weighted to root, top two to child
const mgn = Buffer.from(encode(form('SKMG', form('0004',
  chunk('INFO', new W().i32(1).i32(2).i32(1).i32(2).i32(4).i32(4).i32(1).i32(1).i32(0).i16(0).i16(0).i16(0).i16(0).bytes()),
  chunk('SKTM', new W().str('appearance/skeleton/test.skt').bytes()),
  chunk('XFNM', new W().str('root').str('child').bytes()),
  chunk('POSN', new W().f32(-1).f32(0).f32(0).f32(1).f32(0).f32(0).f32(1).f32(2).f32(0).f32(-1).f32(2).f32(0).bytes()),
  chunk('TWHD', new W().i32(1).i32(1).i32(1).i32(1).bytes()),
  chunk('TWDT', new W().i32(0).f32(1).i32(0).f32(1).i32(1).f32(1).i32(1).f32(1).bytes()),
  chunk('NORM', new W().f32(0).f32(0).f32(1).bytes()),
  form('PSDT',
    chunk('NAME', new W().str('shader/test.sht').bytes()),
    chunk('PIDX', new W().i32(4).i32(0).i32(1).i32(2).i32(3).bytes()),
    chunk('NIDX', new W().i32(0).i32(0).i32(0).i32(0).bytes()),
    chunk('TXCI', new W().i32(1).i32(2).bytes()),
    form('TCSF', chunk('TCSD', new W().f32(0).f32(0).f32(1).f32(0).f32(1).f32(1).f32(0).f32(1).bytes())),
    form('PRIM', chunk('INFO', new W().i32(1).bytes()), chunk('ITL ', new W().i32(2).i32(0).i32(1).i32(2).i32(0).i32(2).i32(3).bytes())))))));
const mesh = parseMgn(parseIff(mgn));
check('mesh shaders', mesh.shaders.length === 1 && mesh.shaders[0].vertexCount === 4 && mesh.shaders[0].triangles.length === 6);
const prims = skinnedPrimitives(mesh, skeleton);
const p0 = prims.groups[0].primitives[0];
check('vertex 2 bound to child', p0.joints[2 * 4] === 1 && near(p0.weights[2 * 4], 1), `${p0.joints[8]} ${p0.weights[8]}`);
check('uvs carried', p0.uvs !== null && near(p0.uvs[5], 1));

// animation: 2 frames at 1 fps; child rotates 90 degrees about Y between frames, root static translation +0.5 in x
const rot90 = [Math.SQRT1_2, 0, Math.SQRT1_2, 0];
const ans = Buffer.from(encode(form('KFAT', form('0003',
  chunk('INFO', new W().f32(1).i32(2).i32(2).i32(1).i32(1).i32(0).i32(1).bytes()),
  form('XFRM',
    chunk('XFIN', new W().str('root').i8(0).i32(0).u32(0).i32(0).i32(0).i32(0).bytes()),
    chunk('XFIN', new W().str('child').i8(1).i32(0).u32(0).i32(0).i32(0).i32(0).bytes())),
  form('AROT', chunk('QCHN', new Uint8Array([...new W().i32(2).i32(0).bytes(), ...q(1, 0, 0, 0).bytes(), ...new W().i32(1).bytes(), ...q(rot90[0], rot90[1], rot90[2], rot90[3]).bytes()]))),
  chunk('SROT', q(1, 0, 0, 0).bytes()),
  chunk('STRN', new W().f32(0.5).bytes())))));
const animation = parseAnimation(parseIff(ans));
check('animation header', animation.frameCount === 2 && animation.transforms.length === 2 && animation.rotationChannels[0].length === 2);
const pose1 = poseAtFrame(skeleton, animation, 1);
check('child rotated at frame 1', near(pose1[1].rotation[0], rot90[0]) && near(pose1[1].rotation[2], rot90[2]), JSON.stringify(pose1[1]));
check('root static translation', near(pose1[0].translation[0], 0.5));
check('quaternion product', (() => { const r = qmul(rot90, rot90); return near(r[0], 0) && near(r[2], 1); })());

// through the GLB writer
const skin = skinData(skeleton, [{ name: 'turn', animation }], { flipX: true });
check('mirrored child rotation', near(skin.clips[0].tracks[1].rotations[4 + 1], -rot90[2]) && near(skin.clips[0].tracks[1].rotations[4 + 3], rot90[0]));
const glb = buildGlb([{ name: 'test', groups: prims.groups }], { flipX: true, skin, animations: skin.clips });
const jsonLen = glb.readUInt32LE(12);
const json = JSON.parse(glb.toString('utf8', 20, 20 + jsonLen));
check('glb has skin', json.skins?.length === 1 && json.skins[0].joints.length === 2 && json.nodes[0].skin === 0, JSON.stringify(json.skins));
check('inverse bind matrices counted', json.accessors[json.skins[0].inverseBindMatrices].count === 2 && json.accessors[json.skins[0].inverseBindMatrices].type === 'MAT4');
check('glb has animation', json.animations?.length === 1 && json.animations[0].channels.length === 4);
check('joint attributes', json.meshes[0].primitives[0].attributes.JOINTS_0 !== undefined && json.meshes[0].primitives[0].attributes.WEIGHTS_0 !== undefined);
check('child is child of root node', json.nodes[json.skins[0].joints[0]].children?.[0] === json.skins[0].joints[1]);
console.log(failures ? `${failures} FAILURES` : 'all passed');
process.exit(failures ? 1 : 0);
