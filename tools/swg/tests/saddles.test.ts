// Mount saddles: the skinned mesh's hardpoints (SKMG > HPTS), their trip through the skin data and
// the GLB writer as hp:<name> nodes under their joints, which appearance the saddle hardpoint is
// read from, the creatures manifest's saddle entry and status, and the run-time seat: the plan,
// the posed back and the saddle and seat hung on the skeleton. Plain node over the pure converter
// modules and src/vehicles/saddle.ts with three; the checks on the real pack skip without it.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { form, chunk, W, encode } from './iffWriter.ts';
import { parseMgn, qmul, skinData } from '../skeletal.mjs';
import { buildGlb } from '../glb.mjs';
import { parseIff } from '../iff.mjs';
import { readGlb, skinJoints } from '../glbclips.mjs';
import { pickSaddleHardpoint, saddleEntry, saddleStatus, satHardpoints } from '../saddles.mjs';
import { SADDLE_PLAYER, hangSaddle, hangOnBack, offBack, planSeat, posedBack, type SeatTarget } from '../../../src/vehicles/saddle.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, e = 1e-5) => Math.abs(a - b) <= e;
const nearAll = (a: ArrayLike<number>, b: ArrayLike<number>, e = 1e-5) => a.length === b.length && Array.from(a).every((v, i) => near(v, b[i], e));

type Quat = [number, number, number, number];
type Vec = [number, number, number];
/** Rotate a vector by a [w, x, y, z] quaternion. */
const qrot = (q: number[], v: Vec): Vec => {
  const p = qmul(qmul(q, [0, ...v]), [q[0], -q[1], -q[2], -q[3]]);
  return [p[1], p[2], p[3]];
};
const add = (a: number[], b: number[]): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
// SADDLE_PACK names another pack folder (a scratch conversion) for the pack checks.
const pack = process.env.SADDLE_PACK || join(root, 'assets-private');

// ---------------------------------------------------------------------------------------------
// 1. parseMgn reads HPTS: a STAT hardpoint and a "DYN " one.
const meshBytes = (extra: ReturnType<typeof form>[]) => Buffer.from(encode(form('SKMG', form('0004',
  chunk('INFO', new W().i32(1).i32(2).i32(1).i32(2).i32(4).i32(4).i32(1).i32(1).i32(0).i16(0).i16(0).i16(0).i16(0).bytes()),
  chunk('SKTM', new W().str('appearance/skeleton/test.skt').bytes()),
  chunk('XFNM', new W().str('root').str('spine1').bytes()),
  chunk('POSN', new W().f32(-1).f32(0).f32(0).f32(1).f32(0).f32(0).f32(1).f32(2).f32(0).f32(-1).f32(2).f32(0).bytes()),
  chunk('TWHD', new W().i32(1).i32(1).i32(1).i32(1).bytes()),
  chunk('TWDT', new W().i32(0).f32(1).i32(0).f32(1).i32(1).f32(1).i32(1).f32(1).bytes()),
  chunk('NORM', new W().f32(0).f32(0).f32(1).bytes()),
  ...extra,
  form('PSDT',
    chunk('NAME', new W().str('shader/test.sht').bytes()),
    chunk('PIDX', new W().i32(4).i32(0).i32(1).i32(2).i32(3).bytes()),
    chunk('NIDX', new W().i32(0).i32(0).i32(0).i32(0).bytes()),
    form('PRIM', chunk('INFO', new W().i32(1).bytes()), chunk('ITL ', new W().i32(2).i32(0).i32(1).i32(2).i32(0).i32(2).i32(3).bytes())))))));
const baseMesh = (extra: ReturnType<typeof form>[]) => parseMgn(parseIff(meshBytes(extra)));
{
  const hpts = form('HPTS',
    chunk('STAT', new W().i16(1).str('saddle').str('spine1').f32(0.0075).f32(0.707).f32(0.0075).f32(-0.707).f32(0.022).f32(-0.399).f32(0).bytes()),
    chunk('DYN ', new W().i16(1).str('hat').str('head').f32(1).f32(0).f32(0).f32(0).f32(0).f32(0.1).f32(0.2).bytes()));
  const mgn = baseMesh([hpts]);
  const [s, d] = mgn.hardpoints;
  ok(mgn.hardpoints.length === 2, 'HPTS: both chunks read');
  ok(s.name === 'saddle' && s.parent === 'spine1' && s.dynamic === false, 'STAT: the saddle on spine1, not dynamic');
  ok(nearAll(s.rotation, [0.0075, 0.707, 0.0075, -0.707]) && nearAll(s.position, [0.022, -0.399, 0]), 'STAT: rotation as [w,x,y,z] and position');
  ok(d.name === 'hat' && d.parent === 'head' && d.dynamic === true && nearAll(d.position, [0, 0.1, 0.2]), '"DYN ": the hat on the head, dynamic');
  ok(Array.isArray(baseMesh([]).hardpoints) && baseMesh([]).hardpoints.length === 0, 'a mesh with no HPTS has no hardpoints');
}

// ---------------------------------------------------------------------------------------------
// 1b. satHardpoints over a fake archive: a .sat naming an .lmg (its finest level missing, the next
// one carrying the saddle), a plain .mgn carrying a player point, a mesh the archive lacks and one
// that does not parse; the skeleton is the .sat's first.
{
  const stat = (name: string, parent: string, y: number) => form('HPTS', chunk('STAT', new W().i16(1).str(name).str(parent).f32(1).f32(0).f32(0).f32(0).f32(0).f32(y).f32(0).bytes()));
  const files = new Map<string, Buffer>([
    ['appearance/mesh/beast_l1.mgn', meshBytes([stat('saddle', 'spine1', 0.4)])],
    ['appearance/mesh/beast_l2.mgn', meshBytes([stat('saddle', 'spine1', 9)])],
    ['appearance/mesh/beast_rider.mgn', meshBytes([stat('player', 'root', 0.2)])],
    ['appearance/mesh/beast_broken.mgn', Buffer.from(encode(form('SKMG', form('0004', chunk('INFO', new W().i32(1).bytes())))))],
    ['appearance/mesh/beast.lmg', Buffer.from(encode(form('MLOD', form('0000',
      chunk('NAME', new W().str('appearance/mesh/beast_l0.mgn').bytes()),
      chunk('NAME', new W().str('appearance/mesh/beast_l1.mgn').bytes()),
      chunk('NAME', new W().str('appearance/mesh/beast_l2.mgn').bytes())))))],
    ['appearance/beast_hue.sat', Buffer.from(encode(form('SMAT', form('0003',
      chunk('INFO', new W().i32(5).i32(2).i32(0).bytes()),
      chunk('MSGN', new W().str('appearance\\mesh\\beast.lmg').str('appearance/mesh/beast_rider.mgn').str('appearance/mesh/gone.mgn').str('appearance/mesh/gone.lmg').str('appearance/mesh/beast_broken.mgn').bytes()),
      chunk('SKTI', new W().str('appearance\\skeleton\\beast.skt').str('').str('appearance/skeleton/other.skt').str('root').bytes())))))],
  ]);
  const vfs = { has: (p: string) => files.has(p), read: (p: string) => { const b = files.get(p); if (!b) throw new Error(`no ${p}`); return b; } };
  const got = satHardpoints(vfs, 'appearance/beast_hue.sat');
  ok(got.skeleton === 'appearance/skeleton/beast.skt', "the skeleton is the .sat's first, slashes normalised");
  ok(got.hardpoints.length === 2, 'two hardpoints: the missing and unparseable meshes are passed over');
  const sad = got.hardpoints.find((h: { name: string }) => h.name === 'saddle');
  ok(!!sad && sad.mesh === 'appearance/mesh/beast_l1.mgn' && sad.parent === 'spine1' && near(sad.position[1], 0.4), "an .lmg's hardpoint comes from its finest level the archive holds, not a coarser one");
  const rider = got.hardpoints.find((h: { name: string }) => h.name === 'player');
  ok(!!rider && rider.mesh === 'appearance/mesh/beast_rider.mgn' && rider.parent === 'root' && near(rider.position[1], 0.2), "a plain .mgn's hardpoint is read with its mesh named");
  const pick = pickSaddleHardpoint({ own: [], ownSkeleton: 'appearance/skeleton/beast.skt', ownSat: 'appearance/beast.sat', listed: got.hardpoints, listedSkeleton: got.skeleton, listedSat: 'appearance/beast_hue.sat' });
  ok(pick?.hardpoint === sad && pick.from === 'appearance/beast_hue.sat', 'and pickSaddleHardpoint takes it from the listed appearance on the same skeleton');
}

// ---------------------------------------------------------------------------------------------
// 2-3. skinData: a child joint bound turned 90 degrees about X, and a hardpoint on it that undoes
// the turn stands upright and facing +Z in the model; a hardpoint on a missing joint is dropped.
const s45 = Math.SQRT1_2;
const skeleton = {
  joints: [
    { name: 'root', parent: -1, pre: [1, 0, 0, 0], post: [1, 0, 0, 0], bindT: [0, 0, 0], bindR: [1, 0, 0, 0] },
    { name: 'spine1', parent: 0, pre: [1, 0, 0, 0], post: [1, 0, 0, 0], bindT: [0, 1, 0], bindR: [s45, s45, 0, 0] },
  ],
};
const still = { frameCount: 2, fps: 30, transforms: [], rotationChannels: [], staticRotations: [], translationChannels: [], staticTranslations: [] };
const hpOn = { name: 'saddle', parent: 'SPINE1', rotation: [s45, -s45, 0, 0], position: [0.3, 0.5, 0], dynamic: false };
const skin = skinData(skeleton, [{ name: 'idle', animation: still }], { flipX: true, hardpoints: [hpOn, { name: 'lost', parent: 'nowhere', rotation: [1, 0, 0, 0], position: [0, 0, 0] }] });
{
  const h = skin.hardpoints[0];
  ok(skin.hardpoints.length === 1 && h.name === 'saddle' && h.joint === 1, 'the hardpoint lands on the child joint by name, whatever its case');
  ok(nearAll(h.translation, [-0.3, 0.5, 0]), 'its translation is mirrored in X as the joints are');
  const jointWorldQ = qmul(skin.joints[0].rotation, skin.joints[1].rotation);
  const world = qmul(jointWorldQ, h.rotation);
  const up = qrot(world, [0, 1, 0]);
  const fwd = qrot(world, [0, 0, 1]);
  ok(nearAll(up, [0, 1, 0], 1e-4) && nearAll(fwd, [0, 0, 1], 1e-4), 'a hardpoint that undoes its joint\'s turn stands upright and faces +Z in the model');
  ok(skin.droppedHardpoints.length === 1 && skin.droppedHardpoints[0] === 'lost', 'a hardpoint on a joint the skeleton lacks is dropped and named');
  const plain = skinData(skeleton, [{ name: 'idle', animation: still }], { flipX: true });
  ok(plain.hardpoints.length === 0 && plain.droppedHardpoints.length === 0, 'without hardpoints both lists are empty');
  ok(JSON.stringify(plain.joints) === JSON.stringify(skin.joints) && JSON.stringify(plain.inverseBind) === JSON.stringify(skin.inverseBind) && plain.clips.length === skin.clips.length && nearAll(plain.clips[0].tracks[1].rotations, skin.clips[0].tracks[1].rotations), 'the joints, bind matrices and clips are unchanged by the option');
}

// ---------------------------------------------------------------------------------------------
// 4. buildGlb: hp:saddle is a child of the spine1 joint node, no skin joint, no scene root, no channel's target.
{
  const glb = buildGlb([], { flipX: true, skin, animations: skin.clips });
  const { json } = readGlb(glb);
  const hpIndex = json.nodes.findIndex((n: { name?: string }) => n.name === 'hp:saddle');
  const spine = json.nodes.findIndex((n: { name?: string }) => n.name === 'spine1');
  ok(hpIndex >= 0 && (json.nodes[spine].children ?? []).includes(hpIndex), 'hp:saddle is written under the spine1 joint node');
  ok(!json.skins[0].joints.includes(hpIndex), 'it is not a skin joint');
  ok(!json.scenes[0].nodes.includes(hpIndex), 'it is not a scene root');
  ok((json.animations ?? []).every((a: { channels: { target: { node: number } }[] }) => a.channels.every((c) => c.target.node !== hpIndex)), 'no animation channel targets it');
  ok(hpIndex > Math.max(...json.skins[0].joints), 'it comes after the joints, so no joint index moved');
  const plainGlb = buildGlb([], { flipX: true, skin: skinData(skeleton, [{ name: 'idle', animation: still }], { flipX: true }), animations: skinData(skeleton, [{ name: 'idle', animation: still }], { flipX: true }).clips });
  ok(!readGlb(plainGlb).json.nodes.some((n: { name?: string }) => /^hp:/.test(n.name ?? '')), 'a skin with no hardpoints writes no hp node');
}

// ---------------------------------------------------------------------------------------------
// 5. pickSaddleHardpoint
{
  const saddle = { name: 'saddle', parent: 'spine1', rotation: [1, 0, 0, 0], position: [0, 0, 0] };
  const other = { name: 'SADDLE', parent: 'spine2', rotation: [1, 0, 0, 0], position: [1, 1, 1] };
  const own = pickSaddleHardpoint({ own: [saddle], ownSkeleton: 'a.skt', ownSat: 'appearance/x.sat', listed: [other], listedSkeleton: 'a.skt', listedSat: 'appearance/x_hue.sat' });
  ok(own?.hardpoint === saddle && own.from === 'appearance/x.sat', "the converted appearance's own hardpoint wins");
  const listed = pickSaddleHardpoint({ own: [], ownSkeleton: 'Appearance\\Skeleton\\Bantha.skt', ownSat: 'appearance/bantha.sat', listed: [other], listedSkeleton: 'appearance/skeleton/bantha.skt', listedSat: 'appearance/bantha_hue.sat' });
  ok(listed?.hardpoint === other && listed.from === 'appearance/bantha_hue.sat', "the listed appearance's is used on the same skeleton, ignoring case and slashes (and SADDLE matches saddle)");
  ok(pickSaddleHardpoint({ own: [], ownSkeleton: 'a.skt', listed: [other], listedSkeleton: 'b.skt', listedSat: 'appearance/x_hue.sat' }) === null, 'refused when the skeleton files differ');
  ok(pickSaddleHardpoint({ own: [{ ...saddle, name: 'player' }], ownSkeleton: 'a.skt', listed: [], listedSkeleton: 'a.skt', listedSat: null }) === null, 'null when neither has a saddle');
}

// ---------------------------------------------------------------------------------------------
// 6. saddleEntry
{
  const e = saddleEntry({ appearance: 'appearance/mnt_saddle_body2_wide_s01.apt', file: 'creatures/saddles/mnt_saddle_body2_wide_s01.glb', player: [0.0002, 0.1639, -0.0596], joint: 'spine1', from: 'appearance/bantha_hue.sat' });
  ok(e !== null && e.appearance === 'appearance/mnt_saddle_body2_wide_s01.apt' && e.file === 'creatures/saddles/mnt_saddle_body2_wide_s01.glb' && e.joint === 'spine1' && e.from === 'appearance/bantha_hue.sat', 'the entry carries the appearance, file, joint and source');
  ok(e !== null && nearAll(e.player!, [-0.0002, 0.1639, -0.0596]), 'its player point is mirrored in X');
  const guessed = saddleEntry({ appearance: 'appearance/mnt_saddle_body1_wide_s01.apt', file: null, player: null, joint: null, from: 'appearance/ronto.sat' });
  ok(guessed !== null && guessed.joint === null && guessed.from === null && guessed.file === null && guessed.player === null, 'guessed: joint and from null; a failed saddle has file and player null');
  ok(saddleEntry({ appearance: 'appearance/basilisk_war_droid.sat', file: null, player: null, joint: null, from: null }) === null, "a .sat saddle appearance (the basilisk's own) is no entry");
  ok(saddleEntry({ appearance: undefined as unknown as string }) === null, 'no saddle in the tables is no entry');
}

// ---------------------------------------------------------------------------------------------
// 7. saddleStatus
{
  const list = [
    { id: 'bantha', mount: true, riderPose: 'saddle_body2_wide', hardpoints: ['saddle'], saddle: { file: 'creatures/saddles/a.glb' } },
    { id: 'basilisk', mount: true, riderPose: 'vehicle_basilisk_war_droid', hardpoints: ['damage_1', 'Player'] },
    { id: 'ronto', mount: true, riderPose: 'saddle_body1_wide', hardpoints: [], saddle: { file: 'creatures/saddles/missing.glb' } },
    { id: 'sharnaff', mount: true, hardpoints: [] },
    { id: 'old', mount: true, riderPose: 'saddle_body1_wide' },
    { id: 'durni', hardpoints: [] },
    { id: 'wildrider', mount: false, hardpoints: ['player'] },
  ];
  const s = saddleStatus(list, (f: string) => f !== 'creatures/saddles/missing.glb');
  ok(s.onHardpoint === 1 && s.rider === 1 && s.guessed === 1 && s.none === 1, 'each mount is counted in exactly one kind');
  ok(s.wild === 2, 'the non-mounts are only in wild');
  ok(s.stale.length === 1 && s.stale[0] === 'old' && s.onHardpoint + s.rider + s.guessed + s.none + s.stale.length === 5, 'a saddle-pose mount without a saddle key is stale and in no count');
  ok(s.missingFiles.length === 1 && s.missingFiles[0] === 'creatures/saddles/missing.glb', 'a saddle file that is not there is named');
  const oldPack = saddleStatus([{ id: 'basilisk_war_droid', mount: true, riderPose: 'vehicle_basilisk_war_droid' }, { id: 'sharnaff', mount: true }], () => true);
  ok(oldPack.stale.length === 1 && oldPack.none === 1, 'a ridden mount written before hardpoints were is stale too; one with no rider pose is none');
}

// ---------------------------------------------------------------------------------------------
// 8. planSeat
{
  const def = { file: 'assets-private/creatures/saddles/a.glb', joint: 'spine1', player: [-0.0002, 0.164, -0.06] as [number, number, number] };
  const a = planSeat(['Saddle'], def);
  ok(a.from === 'saddle' && a.saddleFile === def.file && nearAll(a.offset, def.player) && a.pelvis, "a creature's own saddle hardpoint (in any case): the saddle plan, the pelvis on its player point");
  ok(planSeat(['saddle'], null).saddleFile === null && nearAll(planSeat(['saddle'], null).offset, SADDLE_PLAYER), 'with no saddle model the offset is the retail player point');
  const r = planSeat(['damage_1', 'player'], null);
  ok(r.from === 'rider' && r.saddleFile === null && nearAll(r.offset, [0, 0, 0]) && r.pelvis, 'its own player point: the rider plan');
  const g = planSeat([], { file: 'x.glb', joint: null, player: null });
  ok(g.from === 'guess' && g.saddleFile === 'x.glb' && nearAll(g.offset, SADDLE_PLAYER) && g.pelvis, 'a saddle and no hardpoint: guessed');
  const b = planSeat([], undefined);
  ok(b.from === 'back' && b.saddleFile === null && !b.pelvis, 'an old pack (no hardpoints, no saddle): the back, the rider\'s origin on it');
}

// ---------------------------------------------------------------------------------------------
// 9-10. The run-time hanging, on three hierarchies.
const find = (rootNode: THREE.Object3D, name: string): THREE.Object3D | null => {
  let found: THREE.Object3D | null = null;
  const want = name.toLowerCase();
  rootNode.traverse((o) => {
    const n = ((o.userData as { name?: string }).name ?? o.name) || '';
    const m = /^hp[:_]?(.+)$/i.exec(n);
    if (!found && m && m[1].toLowerCase() === want) found = o;
  });
  return found;
};
const target = (frame: THREE.Object3D): SeatTarget => {
  const seat = new THREE.Object3D();
  frame.add(seat);
  return { seat, seatPelvis: false, seatFollows: false, saddle: null, seatFrom: null };
};
const hpNode = (name: string) => {
  const o = new THREE.Object3D();
  o.name = `hp${name}`;
  o.userData.name = `hp:${name}`;
  return o;
};
/** A frame holding a model with bones root > spine1 at (0, 2, 0) turned 20 degrees about Y. */
const rigged = () => {
  const frame = new THREE.Group();
  const model = new THREE.Group();
  frame.add(model);
  const rootBone = new THREE.Bone();
  rootBone.name = 'root';
  const spine = new THREE.Bone();
  spine.name = 'spine1';
  spine.position.set(0, 2, 0);
  spine.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(20));
  model.add(rootBone);
  rootBone.add(spine);
  return { frame, model, spine };
};
{
  // saddle plan with a saddle model
  const { frame, model, spine } = rigged();
  const hp = hpNode('saddle');
  hp.position.set(0.1, 0.3, -0.2);
  hp.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(10));
  spine.add(hp);
  const saddle = new THREE.Group();
  const player = hpNode('player');
  player.position.set(...SADDLE_PLAYER);
  saddle.add(player);
  const t = target(frame);
  const plan = planSeat(['saddle'], { file: 'x.glb', joint: 'spine1', player: SADDLE_PLAYER });
  const hung = hangSaddle(model, plan, saddle, find, frame, t);
  frame.updateMatrixWorld(true);
  const expected = new THREE.Vector3().applyMatrix4(new THREE.Matrix4().multiplyMatrices(spine.matrixWorld, hp.matrix).multiply(player.matrix));
  ok(t.seat.getWorldPosition(new THREE.Vector3()).distanceTo(expected) < 1e-6, "the seat's world place is joint x hardpoint x the saddle's player point");
  const q = spine.getWorldQuaternion(new THREE.Quaternion()).multiply(hp.quaternion).multiply(player.quaternion);
  ok(t.seat.getWorldQuaternion(new THREE.Quaternion()).angleTo(q) < 1e-6, 'and its turn is the three turns composed');
  ok(t.seat.parent === player && saddle.parent === hp && hung?.node === hp && hung.from === 'saddle', "the seat hangs on the saddle's player node, the saddle on the hardpoint");
  ok(t.seatPelvis && t.seatFollows && t.seatFrom === 'saddle' && t.saddle === saddle && saddle.userData.saddle === true, 'the target is marked: pelvis, follows, from the saddle, the saddle model');
}
{
  // saddle plan with the saddle model missing
  const { frame, model, spine } = rigged();
  const hp = hpNode('saddle');
  spine.add(hp);
  const t = target(frame);
  hangSaddle(model, planSeat(['saddle'], null), null, find, frame, t);
  ok(t.seat.parent === hp && nearAll(t.seat.position.toArray(), SADDLE_PLAYER) && t.saddle === null && t.seatPelvis, "no saddle model: the seat on the hardpoint at the retail player point");
}
{
  // rider plan
  const { frame, model, spine } = rigged();
  const own = hpNode('player');
  own.position.set(0, 0.5, -0.3);
  spine.add(own);
  const t = target(frame);
  const hung = hangSaddle(model, planSeat(['player'], null), null, find, frame, t);
  ok(t.seat.parent === own && nearAll(t.seat.position.toArray(), [0, 0, 0]) && t.seatFrom === 'rider' && hung?.from === 'rider' && t.seatPelvis, "the rider plan seats the pelvis on the creature's own player point");
}
{
  // The relay picture (Garage.visual): no target, so only the saddle is hung and no seat is touched.
  const { frame, model, spine } = rigged();
  const hp = hpNode('saddle');
  spine.add(hp);
  const saddle = new THREE.Group();
  saddle.add(hpNode('player'));
  const before = frame.children.length;
  const hung = hangSaddle(model, planSeat(['saddle'], { file: 'x.glb', joint: 'spine1', player: SADDLE_PLAYER }), saddle, find, frame, null);
  ok(hung?.node === hp && hung.from === 'saddle' && saddle.parent === hp && saddle.userData.saddle === true, 'no target: the saddle hangs on the hardpoint and is marked');
  ok(frame.children.length === before && hp.children.length === 1, 'no target: nothing else is added to the frame or the hardpoint');
}
{
  // The relay picture of a creature with its own rider point, and of a bare back.
  const { frame, model, spine } = rigged();
  const own = hpNode('player');
  spine.add(own);
  const before = frame.children.length;
  const rider = hangSaddle(model, planSeat(['player'], null), null, find, frame, null);
  ok(rider?.node === own && rider.from === 'rider' && own.children.length === 0, 'no target, the rider plan: its own player point, left empty');
  const back = hangSaddle(model, planSeat([], null), null, find, frame, null);
  ok(back === null && frame.children.length === before && own.children.length === 0, 'no target, the back plan: null and nothing hung');
}
/** A skinned box 1 m tall (y 0..1), every vertex on one bone, bound at rest; the bone is then lifted 2 m and moved 1 m forward. */
const skinnedBox = (boneName = 'spine') => {
  const frame = new THREE.Group();
  const model = new THREE.Group();
  frame.add(model);
  const geo = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  geo.translate(0, 0.5, 0);
  const n = geo.getAttribute('position').count;
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
  const w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) w[i * 4] = 1;
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
  const bone = new THREE.Bone();
  bone.name = boneName;
  mesh.add(bone);
  model.add(mesh);
  frame.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([bone]));
  bone.position.set(0, 2, 1);
  frame.updateMatrixWorld(true);
  return { frame, model, mesh, bone, geo };
};
{
  // 10. posedBack reads the posed, skinned body, not the rest-pose attribute
  const { frame, model } = skinnedBox();
  const p = posedBack(model, frame);
  ok(p !== null && near(p.y, 3, 1e-4) && near(p.z, 1, 1e-4) && near(p.x, 0, 1e-4), 'the posed back of a lifted skinned box is at y 3, z 1 (the rest attribute says y 1)');
  const plainFrame = new THREE.Group();
  const plainModel = new THREE.Group();
  const geo = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  geo.translate(0, 0.5, 0);
  plainModel.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial()));
  plainFrame.add(plainModel);
  const q = posedBack(plainModel, plainFrame);
  ok(q !== null && near(q.y, 1, 1e-4) && near(q.z, 0, 1e-4), "a plain mesh's back is its attribute's own top");
  ok(posedBack(new THREE.Group(), new THREE.Group()) === null, 'a model with no vertices has no back');
}
{
  // 10b. A neck held up over the middle of the body (the ronto's, bolle bol's and sharnaff's idles) is never the back: the
  // top is the body's, and the ear flap's rule (a bone under the head or a neck, whatever its name) applies to vertices too.
  const frame = new THREE.Group();
  const model = new THREE.Group();
  frame.add(model);
  const body = new THREE.BoxGeometry(1, 1, 3, 4, 4, 4);
  body.translate(0, 1.5, 0); // the back's top at y 2
  const neck = new THREE.BoxGeometry(0.3, 3, 0.3, 1, 4, 1);
  neck.translate(0, 3.5, 0); // a column over the middle, up to y 5
  const flap = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  flap.translate(0.1, 2.6, 0.1); // a vertex group on a bone under the neck, named for nothing
  const parts = [body, neck, flap];
  const geo = new THREE.BufferGeometry();
  const pos: number[] = [];
  const skinIndex: number[] = [];
  const skinWeight: number[] = [];
  parts.forEach((g, bone) => {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      // The body's vertices lean a little on the neck too: the heaviest bone decides.
      if (bone === 0) skinIndex.push(0, 1, 0, 0), skinWeight.push(0.7, 0.3, 0, 0);
      else skinIndex.push(bone, 0, 0, 0), skinWeight.push(0.8, 0.2, 0, 0);
    }
  });
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshBasicMaterial());
  const spine = new THREE.Bone();
  spine.name = 'Spine2';
  const neckBone = new THREE.Bone();
  neckBone.name = 'Neck1';
  const flapBone = new THREE.Bone();
  flapBone.name = 'LFlapBase';
  spine.add(neckBone);
  neckBone.add(flapBone);
  mesh.add(spine);
  model.add(mesh);
  frame.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton([spine, neckBone, flapBone]));
  frame.updateMatrixWorld(true);
  const p = posedBack(model, frame);
  ok(p !== null && near(p.y, 2, 1e-4), `a neck standing over the middle is not the back: the saddle goes on the body's top (y ${p?.y.toFixed(3)}, the neck reaches 5)`);
  ok(offBack(flapBone, model) && offBack(neckBone, model) && !offBack(spine, model), 'offBack: a neck, and a bone under it named for nothing, are off the back; the spine is not');
  // With nothing but a neck in the strip, its top is taken rather than nothing.
  const lone = new THREE.Group();
  const loneFrame = new THREE.Group();
  loneFrame.add(lone);
  const g2 = new THREE.BoxGeometry(0.3, 3, 0.3, 2, 4, 2); // a vertex on the middle line, inside the 0.1 m strip
  g2.translate(0, 1.5, 0);
  const n2 = g2.getAttribute('position').count;
  g2.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n2 * 4), 4));
  const w2 = new Float32Array(n2 * 4);
  for (let i = 0; i < n2; i++) w2[i * 4] = 1;
  g2.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w2, 4));
  const m2 = new THREE.SkinnedMesh(g2, new THREE.MeshBasicMaterial());
  const b2 = new THREE.Bone();
  b2.name = 'neck';
  m2.add(b2);
  lone.add(m2);
  loneFrame.updateMatrixWorld(true);
  m2.bind(new THREE.Skeleton([b2]));
  loneFrame.updateMatrixWorld(true);
  ok(near(posedBack(lone, loneFrame)?.y ?? Number.NaN, 3, 1e-4), 'a strip holding only the neck: its top, as before');
}
{
  // 9, guess: a new node on the bone nearest the posed back, at posedBack's point, carrying the saddle
  const { frame, model, bone } = skinnedBox();
  const expect = posedBack(model, frame)!;
  const saddle = new THREE.Group();
  const t = target(frame);
  const hung = hangSaddle(model, planSeat([], { file: 'x.glb', joint: null, player: null }), saddle, find, frame, t);
  frame.updateMatrixWorld(true);
  ok(hung !== null && hung.from === 'guess' && hung.node.parent === bone, 'guessed: a new node hung on the bone nearest the back');
  ok(hung !== null && hung.node.getWorldPosition(new THREE.Vector3()).distanceTo(expect) < 1e-5, "at posedBack's point");
  ok(saddle.parent === hung?.node && t.seatFrom === 'guess' && t.seatFollows && t.seatPelvis && nearAll(t.seat.position.toArray(), SADDLE_PLAYER), 'the saddle under it and the seat at the player point');
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(hung!.node.getWorldQuaternion(new THREE.Quaternion()));
  ok(up.y > 0.999, 'the guessed saddle starts upright');
}
{
  // 9, guess on the relay picture: no target, the saddle still rides the bone at posedBack's point
  const { frame, model, bone } = skinnedBox();
  const expect = posedBack(model, frame)!;
  const saddle = new THREE.Group();
  const hung = hangSaddle(model, planSeat([], { file: 'x.glb', joint: null, player: null }), saddle, find, frame, null);
  frame.updateMatrixWorld(true);
  ok(hung !== null && hung.from === 'guess' && hung.node.parent === bone && saddle.parent === hung.node, 'no target, guessed: a new node on the bone carries the saddle');
  ok(hung !== null && hung.node.getWorldPosition(new THREE.Vector3()).distanceTo(expect) < 1e-5 && saddle.children.length === 0, "at posedBack's point, with no seat under the saddle");
}
{
  // 9, back: returns null, the seat on a bone at posedBack's point, the rider's origin on it
  const { frame, model, bone } = skinnedBox();
  const expect = posedBack(model, frame)!;
  const t = target(frame);
  const hung = hangSaddle(model, planSeat([], null), null, find, frame, t);
  frame.updateMatrixWorld(true);
  ok(hung === null && t.seat.parent === bone && t.seat.getWorldPosition(new THREE.Vector3()).distanceTo(expect) < 1e-5, "back: the seat on the bone at posedBack's point");
  ok(!t.seatPelvis && t.seatFollows && t.seatFrom === 'back' && t.saddle === null, 'back: the origin names the seat, and it follows the bone');
  const plainFrame = new THREE.Group();
  const plainModel = new THREE.Group();
  const geo = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  geo.translate(0, 0.5, 0);
  plainModel.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial()));
  plainFrame.add(plainModel);
  const t2 = target(plainFrame);
  hangSaddle(plainModel, planSeat([], null), null, find, plainFrame, t2);
  ok(t2.seat.parent === plainFrame && !t2.seatFollows && near(t2.seat.position.y, 1, 1e-4), 'no bones: the seat stays under the frame, fixed, on the back');
  ok(hangOnBack(plainModel, new THREE.Object3D()) === null, 'hangOnBack leaves a node alone on a model with no skeleton');
}
{
  // hangOnBack prefers a spine over a nearer bone by name, never a limb, and allows the root
  const { frame, model, spine } = rigged();
  const leg = new THREE.Bone();
  leg.name = 'l_leg';
  leg.position.set(0, 2.9, 0);
  model.add(leg);
  const node = new THREE.Object3D();
  node.position.set(0, 2.95, 0);
  frame.add(node);
  const r = hangOnBack(model, node);
  ok(r !== null && r.bone === spine && node.parent === spine, 'a leg is never the back; the spine is taken');
  const low = new THREE.Object3D();
  frame.add(low);
  ok(hangOnBack(model, low)?.bone.name === 'root', 'the root is a candidate, as the game hangs saddles on it');
  // A bone under the head is the head's whatever it is called (the ronto's ear flap, the kliknik's pincer).
  const head = new THREE.Bone();
  head.name = 'Head';
  head.position.set(0, 1, 0);
  spine.add(head);
  const flap = new THREE.Bone();
  flap.name = 'LFlapBase';
  head.add(flap);
  const nearFlap = new THREE.Object3D();
  frame.add(nearFlap);
  frame.updateMatrixWorld(true);
  flap.getWorldPosition(nearFlap.position);
  ok(hangOnBack(model, nearFlap)?.bone === spine, 'a bone under the head is never the back, however it is named');
}

// ---------------------------------------------------------------------------------------------
// 11-12. The converted creatures pack, when it was converted with saddles.
const manifestPath = join(pack, 'creatures', 'manifest.json');
type Creature = { id: string; file: string; mount?: boolean; riderPose?: string; hardpoints?: string[]; bounds?: { min: number[]; max: number[] }; saddle?: { file: string | null; joint: string | null; from: string | null; player: number[] | null } };
if (!existsSync(manifestPath)) console.log('skip the creatures pack checks: no assets-private/creatures/manifest.json');
else {
  const creatures = (JSON.parse(readFileSync(manifestPath, 'utf8')) as { creatures: Creature[] }).creatures;
  if (!creatures.some((c) => Array.isArray(c.hardpoints))) console.log('skip the creatures pack checks: the pack was converted before saddles were (run the creatures command)');
  else {
    for (const c of creatures) if (c.mount && /^saddle_/.test(c.riderPose ?? '')) ok(!!c.saddle, `${c.id}: a saddle pose has a saddle entry`);
    for (const c of creatures) if (c.saddle?.player) ok(nearAll(c.saddle.player, SADDLE_PLAYER, 0.01), `${c.id}: the saddle's player point is the retail one`);
    for (const id of ['bantha', 'kaadu', 'bol', 'rancor']) ok(/_hue\.sat$/.test(creatures.find((c) => c.id === id)?.saddle?.from ?? ''), `${id}: its saddle hardpoint was read from the _hue appearance`);
    const s = saddleStatus(creatures, (f: string) => existsSync(join(pack, f)));
    ok(s.onHardpoint === 22 && s.guessed === 25 && s.rider === 1 && s.none === 4 && s.wild === 5 && s.stale.length === 0, `status: ${s.onHardpoint} on the hardpoint, ${s.guessed} guessed, ${s.rider} rider, ${s.none} none, ${s.wild} wild, ${s.stale.length} stale (22/25/1/4, 5, 0)`);
    ok(s.missingFiles.length === 0, 'every saddle file is in the pack');
    // 12. Every hp:saddle and hp:player composed at the idle's first keys stands upright, faces the nose and is above the floor.
    const acc = (json: any, bin: Buffer, i: number) => {
      const a = json.accessors[i];
      const bv = json.bufferViews[a.bufferView];
      const n = ({ SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 } as Record<string, number>)[a.type];
      return new Float32Array(bin.buffer, bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0), a.count * n);
    };
    let seen = 0;
    for (const c of creatures) {
      const file = join(pack, c.file);
      if (!existsSync(file)) continue;
      const { json, bin } = readGlb(readFileSync(file));
      const hps = (json.nodes as { name?: string; rotation?: number[]; translation?: number[] }[]).map((n, i) => ({ n, i })).filter(({ n }) => /^hp:(saddle|player)$/i.test(n.name ?? ''));
      if (!hps.length) continue;
      seen++;
      const joints = skinJoints(json);
      // skinJoints gives each joint's bind rotation as [w, x, y, z] already.
      const local = joints.map((j: { rotation: number[]; translation: number[] }) => ({ q: j.rotation.slice(), t: j.translation.slice() }));
      const idle = (json.animations ?? []).find((a: { name: string }) => a.name === 'idle' || a.name === 'loop_stand:speed0');
      for (const ch of idle?.channels ?? []) {
        const ji = joints.findIndex((j: { node: number }) => j.node === ch.target.node);
        if (ji < 0) continue;
        const out = acc(json, bin, idle.samplers[ch.sampler].output);
        if (ch.target.path === 'rotation') local[ji].q = [out[3], out[0], out[1], out[2]];
        else if (ch.target.path === 'translation') local[ji].t = [out[0], out[1], out[2]];
      }
      const world: { q: number[]; t: Vec }[] = [];
      joints.forEach((j: { parent: number }, i: number) => {
        const L = local[i];
        if (j.parent < 0) world[i] = { q: L.q, t: L.t as Vec };
        else {
          const P = world[j.parent];
          world[i] = { q: qmul(P.q, L.q), t: add(P.t, qrot(P.q, L.t as Vec)) };
        }
      });
      for (const { n, i } of hps) {
        const parent = joints.findIndex((j: { node: number }) => (json.nodes[j.node].children ?? []).includes(i));
        const J = world[parent];
        const r = n.rotation ?? [0, 0, 0, 1];
        const q = qmul(J.q, [r[3], r[0], r[1], r[2]]);
        const pos = add(J.t, qrot(J.q, (n.translation ?? [0, 0, 0]) as Vec));
        const up = qrot(q, [0, 1, 0]);
        const fwd = qrot(q, [0, 0, 1]);
        ok(parent >= 0 && up[1] > 0.9 && fwd[2] > 0.9 && pos[1] > (c.bounds?.min[1] ?? -Infinity), `${c.id}: ${n.name} at the idle stands upright (${up[1].toFixed(2)}), faces the nose (${fwd[2].toFixed(2)}) and is above the floor (y ${pos[1].toFixed(2)})`);
      }
    }
    ok(seen >= 23, `${seen} creature models carry a saddle or rider point (23 expected)`);
  }
}

// ---------------------------------------------------------------------------------------------
// 13. With SADDLE_RIG=1 only (it reads the 200 MB rig): the saddle poses' root is the saddle's player point.
if (process.env.SADDLE_RIG !== '1') console.log('skip the rig check: set SADDLE_RIG=1 to read the human rig');
else {
  const rigFile = join(pack, 'characters', 'human_male', 'rig.glb');
  const partsFile = join(pack, 'characters', 'human_male', 'parts.json');
  if (!existsSync(rigFile) || !existsSync(partsFile)) console.log('skip the rig check: no human_male rig in the pack');
  else {
    const { json, bin } = readGlb(readFileSync(rigFile));
    const rootNode = json.nodes.findIndex((n: { name?: string }) => n.name === 'root');
    const poses = (json.animations as { name: string; channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { output: number }[] }[]).filter((a) => a.name === 'loop_riding' || a.name.startsWith('loop_riding:saddle_body'));
    ok(poses.length >= 7, `${poses.length} saddle poses in the rig`);
    for (const a of poses) {
      const ch = a.channels.find((c) => c.target.node === rootNode && c.target.path === 'translation');
      const acc = ch ? json.accessors[a.samplers[ch.sampler].output] : null;
      const bv = acc ? json.bufferViews[acc.bufferView] : null;
      const t = acc && bv ? new Float32Array(bin.buffer, bin.byteOffset + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0), 3) : null;
      ok(!!t && nearAll(Array.from(t), SADDLE_PLAYER, 0.005), `${a.name}: the root at frame 0 is the saddle's player point (${t ? Array.from(t).map((n) => n.toFixed(3)).join(', ') : 'no track'})`);
    }
    const variants = (JSON.parse(readFileSync(partsFile, 'utf8')) as { variants?: Record<string, { values: string[] }> }).variants ?? {};
    for (const pose of ['saddle_body1_wide', 'saddle_body1_medium', 'saddle_body1_narrow', 'saddle_body2_wide', 'saddle_body2_medium', 'saddle_body2_narrow', 'saddle_body3_wide']) {
      ok(Object.entries(variants).some(([k, v]) => k.startsWith('loop_riding') && v.values.includes(pose)), `${pose} is named under loop_riding`);
    }
  }
}

console.log(`${checks} checks passed`);
