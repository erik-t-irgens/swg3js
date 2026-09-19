// Wings and attachments at run time: where a part stands, what rides a wing, each wing's own clock,
// when the wings open, which muzzles are guns, how far open wings reach down, and the box a ship is
// framed on. Synthetic models only; no pack is read.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WING_HYSTERESIS, WING_ROOM_BAND, WING_RULE, WingSet, easeWing, poseWing, wingTopFactor, wingsWanted, type Wing } from '../../../src/vehicles/wings.ts';
import {
  MAX_PILOT_GUNS,
  PLACE_SIGN,
  anyHardpoint,
  applyPlace,
  collectGuns,
  frameExtents,
  hangAttachments,
  hardpointName,
  ownHardpoint,
  partOf,
  underPivot,
  wingDrop,
  type AttachmentDef,
} from '../../../src/vehicles/shipAssembly.ts';
import { GUN_MOUNT, GUN_MUZZLE } from '../../../src/vehicles/cockpitSeat.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const nearV = (a: THREE.Vector3, b: THREE.Vector3, eps = 1e-5) => a.distanceTo(b) < eps;
const show = (v: THREE.Vector3) => v.toArray().map((n) => n.toFixed(4)).join(', ');
const D = THREE.MathUtils.degToRad;

/** A hardpoint node as GLTFLoader leaves it: the colon stripped from the name, the original in userData. */
function hp(name: string, x = 0, y = 0, z = 0, rot?: THREE.Euler): THREE.Object3D {
  const o = new THREE.Object3D();
  o.name = `hp${name}`;
  o.userData.name = `hp:${name}`;
  o.position.set(x, y, z);
  if (rot) o.quaternion.setFromEuler(rot);
  return o;
}
/** A box mesh spanning the given extents. */
function box(minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number): THREE.Mesh {
  const g = new THREE.BoxGeometry(maxX - minX, maxY - minY, maxZ - minZ);
  g.translate((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial());
}
/** A part model: a group holding the given children, standing in for a GLB scene. */
function group(...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group();
  for (const c of children) g.add(c);
  return g;
}
/** A loader over factories by file name (each call a fresh copy, as the garage's clone is). */
function loader(models: Record<string, () => THREE.Object3D>): (file: string) => Promise<THREE.Object3D> {
  return async (file) => {
    const f = models[file];
    if (!f) throw new Error(`no model ${file}`);
    return f();
  };
}
const worldPos = (o: THREE.Object3D) => {
  o.updateWorldMatrix(true, false);
  return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
};
const find = (root: THREE.Object3D, name: string) => anyHardpoint(root, name)!;

// 1. applyPlace mirrors X and takes index 3 about Y, 5 about Z, with the signs of three's mirrored frame.
{
  const o = new THREE.Object3D();
  applyPlace(o, [1, 2, 3, 90, 0, 0]);
  ok(nearV(o.position, new THREE.Vector3(-1, 2, 3)), 'applyPlace: a place at x = 1 stands at x = -1 (the converter mirrors X)');
  const want = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0, 'YXZ'));
  ok(Math.abs(o.quaternion.dot(want)) > 1 - 1e-9, 'applyPlace: yaw 90 is Euler(0, -π/2, 0, YXZ)');
  applyPlace(o, [0, 0, 0, 0, 0, 90]);
  const roll = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -Math.PI / 2));
  ok(Math.abs(o.quaternion.dot(roll)) > 1 - 1e-9 && PLACE_SIGN.roll === -1 && PLACE_SIGN.yaw === -1, 'applyPlace: roll 90 is Euler(0, 0, -π/2)');
  ok(hardpointName(hp('engine_pos1')) === 'engine_pos1' && hardpointName(new THREE.Object3D()) === null, 'hardpointName reads the stripped hp: name from userData');
}

// 2. The ARC-170 lock: a wing's PSOR place stands its mount exactly on the hull's own wing hardpoint.
{
  const model = group(box(-1, 1, 0, 1, -3, 3), hp('wing1', 2.277, 0.394, 0.189));
  const defs: AttachmentDef[] = [{ kind: 'wing', file: 'arc_wing1', parent: null, hardpoint: null, place: [-2.277, 0.394, 0.189, 0, 0, 0], turn: { angle: -18, time: 3 } }];
  const a = await hangAttachments(model, defs, loader({ arc_wing1: () => group(box(-6, -0.3, 0, 0.1, -1, 1)) }));
  const mount = model.getObjectByName('mount:0')!;
  ok(!!mount && nearV(worldPos(mount), worldPos(find(model, 'wing1'))), `ARC-170: the wing's mount stands on hp:wing1 (${show(worldPos(mount))})`);
  ok(a.wings.length === 1 && near(a.wings.list[0].angle, D(18)) && a.wings.list[0].time === 3, 'ARC-170: one wing, turning 18° in three\'s frame over 3 s');
  ok(underPivot(a.parts[0]!, model) && a.hung === 1 && !a.unresolved.length, 'ARC-170: the wing part hangs under its pivot');
}

// 3. X-wing-like: parts hung on the wing's hardpoints turn with it, muzzle and glow alike.
{
  const model = group(box(-1, 1, -1.2, 1, -5, 5));
  const wing = () => group(box(0, 6.6, -0.6, 0.6, -3.7, -0.6), hp('engine_pos1', 4, 0, -3), hp('weapon1_pos1', 6.6, 0, 1));
  const engine = () => group(box(-0.5, 0.5, -0.5, 0.5, -2, 0), hp('engine_glow1', 0, 0, -1));
  const gun = () => group(box(-0.1, 0.1, -0.1, 0.1, 0, 2), hp('muzzle1', 0, 0, 2));
  const defs: AttachmentDef[] = [
    { kind: 'wing', file: 'wing', parent: null, hardpoint: null, place: [0, 0, 0, 0, 0, 0], turn: { angle: -14, time: 3 } },
    { kind: 'component', slot: 'engine', file: 'engine', parent: 0, hardpoint: 'engine_pos1' },
    { kind: 'component', slot: 'weapon_0', file: 'gun', parent: 0, hardpoint: 'weapon1_pos1' },
  ];
  const a = await hangAttachments(model, defs, loader({ wing, engine, gun }));
  const muzzle = find(model, 'muzzle1');
  const glow = find(model, 'engine_glow1');
  ok(nearV(worldPos(muzzle), new THREE.Vector3(6.6, 0, 3)) && nearV(worldPos(glow), new THREE.Vector3(4, 0, -4)), 'X-wing: closed, the muzzle and the glow stand where the closed foil puts them');
  a.wings.snap(true);
  const c = Math.cos(D(14));
  const s = Math.sin(D(14));
  ok(nearV(worldPos(muzzle), new THREE.Vector3(6.6 * c, 6.6 * s, 3)), `X-wing: open, the muzzle turned 14° with the foil (${show(worldPos(muzzle))})`);
  ok(nearV(worldPos(glow), new THREE.Vector3(4 * c, 4 * s, -4)), 'X-wing: open, the engine glow turned with it');
  const gq = glow.getWorldQuaternion(new THREE.Quaternion());
  ok(Math.abs(gq.dot(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), D(14)))) > 1 - 1e-9, 'X-wing: open, the glow node is turned 14° about Z');
  a.wings.snap(false);
  ok(nearV(worldPos(muzzle), new THREE.Vector3(6.6, 0, 3)) && nearV(worldPos(glow), new THREE.Vector3(4, 0, -4)), 'X-wing: closed again, everything is back');
  ok(find(model, 'weapon1_pos1').userData.mountUsed === true && a.parts[2]!.userData.hangsOn === 'weapon1_pos1' && a.parts[2]!.userData.slot === 'weapon_0', 'X-wing: the weapon hardpoint is marked used and the gun knows its mount and slot');
}

// 4. The B-wing lock: the body placed by roll 90 lies flat closed and hangs down open; a foil on the body's HARD hardpoint composes.
{
  const model = group(box(-0.871, 0.871, -0.89, 0.881, -2.2, 2.9));
  const hpRot = new THREE.Euler(0.1, 0.2, -0.3);
  const body = () => group(box(-1.154, 1.154, -15.384, 0.931, -1, 1), hp('engine1', 0, -4.823, 0), hp('wing_l1', -0.4, -9.5, 0.2, hpRot));
  const foil = () => group(box(-4.6, 0.2, -0.1, 0.1, -0.5, 0.5), hp('weapon2l', -4.419, 0, 0));
  const defs: AttachmentDef[] = [
    { kind: 'wing', file: 'body', parent: null, hardpoint: null, place: [0, 0, 0, 0, 0, 90], turn: { angle: -90, time: 3 } },
    { kind: 'wing', file: 'foil', parent: 0, hardpoint: 'wing_l1', place: null, turn: { angle: -90, time: 3 } },
  ];
  const a = await hangAttachments(model, defs, loader({ body, foil }));
  ok(a.wings.length === 2 && a.hung === 2, 'B-wing: the body and its nested foil are both wings');
  const engine = find(model, 'engine1');
  const gun = find(model, 'weapon2l');
  const expected = (e: number) => {
    const mBody = new THREE.Matrix4().makeRotationZ(-Math.PI / 2);
    const rz = new THREE.Matrix4().makeRotationZ(D(90) * easeWing(e));
    const mHp = new THREE.Matrix4().compose(new THREE.Vector3(-0.4, -9.5, 0.2), new THREE.Quaternion().setFromEuler(hpRot), new THREE.Vector3(1, 1, 1));
    return new THREE.Vector3(-4.419, 0, 0).applyMatrix4(mBody.multiply(rz).multiply(mHp).multiply(rz));
  };
  ok(nearV(worldPos(engine), new THREE.Vector3(-4.823, 0, 0)), `B-wing: closed, the engine lies out to the side, at (${show(worldPos(engine))})`);
  ok(nearV(worldPos(gun), expected(0)), 'B-wing: closed, the foil gun is where M_body · Rz · M_hp · Rz · p puts it');
  a.wings.snap(true);
  ok(nearV(worldPos(engine), new THREE.Vector3(0, -4.823, 0)), `B-wing: open, the engine hangs under the pod (${show(worldPos(engine))})`);
  ok(nearV(worldPos(gun), expected(1)), 'B-wing: open, the foil gun follows both turns');
  a.wings.snap(false);
}

// 5. Each wing on its own clock.
{
  const mk = (time: number): Wing => ({ pivot: new THREE.Object3D(), angle: 1, time, open: 0, label: `w${time}` });
  const set = new WingSet();
  for (let i = 0; i < 4; i++) set.add(mk(3));
  set.want = true;
  const dt = 1 / 60;
  for (let i = 0; i < 90; i++) set.step(dt);
  ok(set.list.every((w) => Math.abs(w.open - 0.5) <= 0.02), `timing: four 3 s wings are half open after 1.5 s (${set.list.map((w) => w.open.toFixed(3)).join(', ')})`);
  for (let i = 0; i < 90; i++) set.step(dt);
  ok(set.list.every((w) => w.open === 1), 'timing: and fully open after 3 s, not after 0.75 s');
  set.step(dt);
  ok(set.step(dt) === false, 'timing: step returns false once settled');
  const two = new WingSet();
  two.add(mk(2));
  two.add(mk(3));
  two.want = true;
  for (let i = 0; i < 120; i++) two.step(dt);
  ok(two.list[0].open === 1 && Math.abs(two.list[1].open - 2 / 3) < 0.01, 'timing: a 2 s wing is done at 2 s while a 3 s one stands at two thirds');
  const f = new WingSet();
  f.add(mk(3));
  f.add(mk(1));
  f.force = 'open';
  ok(f.target && !f.want, 'force: forced open, the target is open while the rule still says closed');
  for (let i = 0; i < 30; i++) f.step(dt);
  ok(near(f.reach, Math.max(easeWing(f.list[0].open), easeWing(f.list[1].open))) && near(f.reach, easeWing(0.5)), 'reach is the largest eased share (the 1 s wing, half open)');
  ok(near(f.progress, (f.list[0].open + f.list[1].open) / 2), 'progress is the mean linear share');
  f.force = null;
  f.snap(true);
  ok(f.want && f.list.every((w) => w.open === 1) && f.reach === 1, 'snap(true) opens every wing and sets want');
  const q = new THREE.Quaternion();
  poseWing(f.list[0], 0.5);
  ok(Math.abs(f.list[0].pivot.quaternion.dot(q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.5))) > 1 - 1e-9, 'poseWing turns the pivot about Z by the eased share of the angle');
}

// 6. When the wings stand open.
{
  const saved = WING_RULE.speed;
  WING_RULE.speed = 'multiplier';
  ok(!wingsWanted(false, false, 100, 0, 50, 140, 0.95, false), 'multiplier: on the ground, closed');
  ok(wingsWanted(true, true, 0, 15, 140, 140, 0.95, false) && wingsWanted(true, true, 0, 15, 300, 140, 0.95, true), 'multiplier: airborne in space, open at any speed, top included');
  ok(!wingsWanted(true, false, 15.9, 15, 100, 140, 0.95, false) && wingsWanted(true, false, 16.1, 15, 100, 140, 0.95, false), `multiplier: closed, they open only above clearance + ${WING_ROOM_BAND} m`);
  ok(wingsWanted(true, false, 15.1, 15, 100, 140, 0.95, true) && !wingsWanted(true, false, 14.9, 15, 100, 140, 0.95, true), 'multiplier: open, they close only below the clearance');
  ok(wingsWanted(true, false, 0.2, 0, 100, 140, 0.95, false), 'multiplier: with no clearance, open at any height');
  ok(wingTopFactor(0.95, 0) === 1 && near(wingTopFactor(0.95, 1), 0.95) && near(wingTopFactor(0.95, 0.5), 0.975) && wingTopFactor(1, 1) === 1, 'multiplier: the top speed eases from 1 to the factor as the wings open');
  WING_RULE.speed = 'threshold';
  const top = 140;
  const limit = 0.95 * top;
  ok(wingsWanted(true, false, 100, 0, top / 2, top, 0.95, false), 'threshold: at half speed, open');
  ok(!wingsWanted(true, false, 100, 0, limit - 0.3, top, 0.95, false), 'threshold: closed just under the limit, stays closed');
  ok(wingsWanted(true, false, 100, 0, limit + 0.3, top, 0.95, true), 'threshold: open just over the limit, stays open');
  ok(!wingsWanted(true, false, 100, 0, top, top, 0.95, true), 'threshold: at top speed with 0.95, closed');
  ok(wingsWanted(true, false, 100, 0, top, top, 1, true), 'threshold: factor 1 at top speed, open stays open');
  ok(!wingsWanted(true, false, 100, 0, top + WING_HYSTERESIS + 0.1, top, 1, true), 'threshold: boosting past top + 0.5, closed');
  ok(wingTopFactor(0.95, 1) === 1 && wingTopFactor(0.95, 0.3) === 1, 'threshold: no top-speed cost');
  WING_RULE.speed = saved;
  WING_RULE.speed = 'multiplier';
}

// 7. Which muzzles are the pilot's guns (by the garage's own patterns).
{
  const isMuzzle = (n: string) => GUN_MUZZLE.test(n);
  const isMount = (n: string) => GUN_MOUNT.test(n);
  const model = group(box(-2, 2, 0, 2, -4, 4), hp('pilotmuzzle1', 0, 1, 4), hp('turretyaw1', 0, -0.2, 0));
  const defs: AttachmentDef[] = [
    { kind: 'component', slot: 'weapon_0', file: 'gun', parent: null, hardpoint: 'pilotmuzzle1' },
    { kind: 'component', slot: 'weapon_1', file: 'base', parent: null, hardpoint: 'turretyaw1' },
    { kind: 'carrier', file: 'body', parent: 1, hardpoint: 'turretpitch1' },
    { kind: 'carrier', file: 'barrel', parent: 2, hardpoint: 'turretbarrel1' },
  ];
  const models = {
    gun: () => group(box(-0.1, 0.1, -0.1, 0.1, 0, 1), hp('muzzle_01', 0, 0, 1)),
    base: () => group(box(-0.5, 0.5, -0.3, 0, -0.5, 0.5), hp('turretpitch1', 0, -0.3, 0)),
    body: () => group(box(-0.4, 0.4, -0.4, 0, -0.4, 0.4), hp('turretbarrel1', 0, -0.2, 0.3)),
    barrel: () => group(box(-0.05, 0.05, -0.05, 0.05, 0, 1), hp('muzzle1', 0, 0, 1)),
  };
  await hangAttachments(model, defs, loader(models));
  const guns = collectGuns(model, isMuzzle, isMount);
  ok(guns.length === 1 && hardpointName(guns[0].node) === 'muzzle_01' && !guns[0].turret, 'guns: the part hung on pilotmuzzle1 fires from its own muzzle_01; the hull\'s pilotmuzzle1 and the turret muzzle are not guns');
  ok(guns[0].hardpoint === 'pilotmuzzle1', 'guns: its hardpoint is its part\'s mount');
  const turretOnly = group(box(-2, 2, 0, 2, -4, 4), hp('turretyaw1', 0, -0.2, 0));
  await hangAttachments(turretOnly, defs.slice(1).map((d) => ({ ...d, parent: typeof d.parent === 'number' ? d.parent - 1 : d.parent })), loader(models));
  const tg = collectGuns(turretOnly, isMuzzle, isMount);
  ok(tg.length === 1 && tg[0].turret && tg[0].hardpoint === 'turretbarrel1', 'guns: with nothing else, the turret\'s barrel muzzle is used, marked a turret');
  const many = group(box(-1, 1, 0, 1, -20, 20));
  for (let i = 0; i < 20; i++) many.add(hp(`muzzle${i}`, i % 2 ? 1 : -1, 0, i));
  const mg = collectGuns(many, isMuzzle, isMount);
  ok(mg.length === MAX_PILOT_GUNS && mg.every((g) => g.node.position.z >= 4), `guns: 20 muzzles give ${MAX_PILOT_GUNS}, the forward-most`);
  const mounts = group(box(-1, 1, 0, 1, -2, 2), hp('weapon1', 1, 0, 1), hp('weapon2', -1, 0, 1));
  const mm = collectGuns(mounts, isMuzzle, isMount);
  ok(mm.length === 2 && mm[0].hardpoint === 'weapon1', 'guns: with no muzzles, the weapon mounts');
}

// 8. Old packs and mixed lists: a def without `parent` is hung by name, anywhere.
{
  const model = group(box(-1, 1, -1.2, 1, -5, 5));
  const wing = () => group(box(0, 6.6, -0.6, 0.6, -3.7, -0.6), hp('weapon1_pos1', 6.6, 0, 1));
  const gun = () => group(box(-0.1, 0.1, -0.1, 0.1, 0, 2), hp('muzzle1', 0, 0, 2));
  const arc = () => group(box(-6, -0.3, 0, 0.1, -1, 1));
  const defs: AttachmentDef[] = [
    { kind: 'wing', file: 'wing', transform: null, hinge: [0, 0, 0, 0, 0, 0], angle: -14, time: 3 },
    { kind: 'component', slot: 'weapon', file: 'gun', hardpoint: 'weapon1_pos1' },
    { kind: 'component', slot: 'weapon', file: 'gun', hardpoint: 'weapon1_pos1' },
    { kind: 'wing', file: 'arc', transform: null, hinge: [-2.277, 0.394, 0.189, 0, 0, 0], angle: -18, time: 3 },
    { kind: 'component', slot: 'engine', file: 'gun', hardpoint: 'nowhere' },
  ];
  const before = model.children.length;
  const a = await hangAttachments(model, defs, loader({ wing, gun, arc }));
  ok(a.parts[1] !== null && underPivot(a.parts[1]!, model) && a.parts[1]!.parent === find(model, 'weapon1_pos1'), 'legacy: a gun on weapon1_pos1, which only the wing carries, hangs under the wing\'s hardpoint');
  ok(a.parts[2] === a.parts[1] && a.hung === 3, 'legacy: the same gun twice on the same hardpoint hangs once');
  const mount = model.getObjectByName('mount:3')!;
  ok(!!mount && nearV(mount.position, new THREE.Vector3(2.277, 0.394, 0.189)) && !!model.getObjectByName('wing:3') && a.wings.length === 2, 'legacy: a wing with a hinge and an angle gets a mount at the (mirrored) hinge and a pivot');
  ok(a.parts[4] === null && a.unresolved.length === 1 && /nowhere/.test(a.unresolved[0]) && model.children.length === before + 2, 'legacy: a hardpoint nothing carries is left off, never hung at the origin');
  const mixed = group(box(-1, 1, 0, 1, -2, 2));
  const treeWing = () => group(box(0, 3, -0.1, 0.1, -1, 1), hp('weapon1', 3, 0, 0));
  const m = await hangAttachments(mixed, [
    { kind: 'wing', file: 'treeWing', parent: null, hardpoint: null, place: [0, 0, 0, 0, 0, 0], turn: { angle: -10, time: 3 } },
    { kind: 'component', slot: 'weapon', file: 'gun', hardpoint: 'weapon1' },
  ], loader({ treeWing, gun }));
  ok(m.parts[1]!.parent === find(mixed, 'weapon1') && underPivot(m.parts[1]!, mixed), 'mixed: a legacy def after a tree wing hangs under the tree wing\'s hardpoint');
}

// 9. What rides a pivot, and how far open wings reach down.
{
  const model = group(box(-0.9, 0.9, 0, 1.8, -2, 2));
  const a = await hangAttachments(model, [{ kind: 'wing', file: 'body', parent: null, hardpoint: null, place: [0, 0, 0, 0, 0, 0], turn: { angle: -90, time: 3 } }], loader({ body: () => group(box(-15, 0, -0.05, 0.05, -1, 1)) }));
  const hullMesh = model.children[0];
  const bodyMesh = a.parts[0]!.children[0];
  ok(underPivot(bodyMesh, model) && !underPivot(hullMesh, model), 'underPivot: the wing\'s mesh turns with it, the hull\'s does not');
  ok(partOf(bodyMesh, model) === a.parts[0] && partOf(hullMesh, model) === null, 'partOf: the wing\'s mesh belongs to the wing, the hull\'s to nothing');
  const drop = wingDrop(model, a.wings);
  ok(Math.abs(drop - 15) < 0.1 && a.wings.list[0].open === 0 && !a.wings.want, `wingDrop: a body swinging from flat to 15 m down reaches ${drop.toFixed(2)} m, and the wings are closed again`);
  ok(ownHardpoint(model, 'nothing') === null, 'ownHardpoint: an unknown name finds nothing');
}

// 10. Framing on the hull, not on a wing lying to one side.
{
  const pivot = new THREE.Group();
  pivot.userData.wingPivot = true;
  pivot.add(box(-15.4, 0.93, -0.1, 0.1, -1, 1));
  const bwing = group(box(-0.87, 0.87, -0.89, 0.89, -2.2, 2.9), pivot);
  const f = frameExtents(bwing, () => true)!;
  ok(near(f.cx, 0) && near(f.cz, 0.35) && near(f.halfW, 15.4) && Math.abs(f.reach - 8.2) < 0.05 && near(f.minY, -0.89) && near(f.h, 1.78), `framing: the B-wing is centred on its pod (cx ${f.cx.toFixed(2)}, cz ${f.cz.toFixed(2)}, half-width ${f.halfW.toFixed(2)}, reach ${f.reach.toFixed(2)})`);
  const plain = group(box(-0.87, 0.87, -0.89, 0.89, -2.2, 2.9), box(-15.4, 0.93, -0.1, 0.1, -1, 1));
  const p = frameExtents(plain, () => true)!;
  ok(near(p.cx, (-15.4 + 0.93) / 2) && near(p.halfW, (15.4 + 0.93) / 2), `framing: with no pivot, the whole box's centre as before (cx ${p.cx.toFixed(2)})`);
  const l = new THREE.Group();
  l.userData.wingPivot = true;
  l.add(box(1, 5, -0.1, 0.1, -1, 1));
  const r = new THREE.Group();
  r.userData.wingPivot = true;
  r.add(box(-5, -1, -0.1, 0.1, -1, 1));
  const sym = group(box(-1, 1, 0, 1, -3, 3), l, r);
  const s = frameExtents(sym, () => true)!;
  ok(near(s.cx, 0) && near(s.cz, 0) && near(s.halfW, 5) && near(s.halfL, 3), 'framing: a symmetric hull with mirrored foils keeps the hull\'s centre and the foils\' half-width');
  const fl = new THREE.Group();
  fl.userData.wingPivot = true;
  fl.add(box(1, 6, -0.1, 0.1, -7, 1));
  const fr = new THREE.Group();
  fr.userData.wingPivot = true;
  fr.add(box(-6, -1, -0.1, 0.1, -7, 1));
  const xw = group(box(-1, 1, 0, 1, -5, 5), fl, fr);
  const x = frameExtents(xw, () => true)!;
  ok(near(x.cx, 0) && near(x.cz, -1) && near(x.halfL, 6) && near(x.halfW, 6), `framing: foils whose engines reach behind the fuselage keep the whole box's centre along (cz ${x.cz.toFixed(2)}, half-length ${x.halfL.toFixed(2)}), as the X-wing framed before`);
  ok(frameExtents(group(new THREE.Object3D()), () => true) === null, 'framing: nothing included, no box');
}

// A stand-in is left off when a component fills its slot, and hung when none does; a tree def never falls to the origin.
{
  const model = group(box(-2, 2, 0, 1, -4, 4), hp('engine1', 0, 0.5, -4));
  const models = { none: () => group(box(-1, 1, 0, 1, -5, -3)), engine: () => group(box(-1, 1, 0, 1, -5, -3)) };
  const filled = await hangAttachments(model, [
    { kind: 'carrier', source: 'CHLD', file: 'none', parent: null, hardpoint: null, place: [0, 0, 0, 0, 0, 0], standInFor: 'engine' },
    { kind: 'component', slot: 'engine', file: 'engine', parent: null, hardpoint: 'engine1' },
  ], loader(models));
  ok(filled.parts[0] === null && filled.hung === 1 && !filled.unresolved.length, 'stand-in: yt1300_engine_none is left off when the engine slot is filled');
  const empty = await hangAttachments(group(box(-2, 2, 0, 1, -4, 4)), [{ kind: 'carrier', source: 'CHLD', file: 'none', parent: null, hardpoint: null, place: [0, 0, 0, 0, 0, 0], standInFor: 'engine' }], loader(models));
  ok(empty.parts[0] !== null && empty.hung === 1, 'stand-in: kept when nothing fills the slot');
  const weaponFills = await hangAttachments(group(box(-2, 2, 0, 1, -4, 4), hp('weapon1')), [
    { kind: 'carrier', file: 'none', parent: null, standInFor: 'weapon' },
    { kind: 'component', slot: 'weapon_0', file: 'engine', parent: null, hardpoint: 'weapon1' },
  ], loader(models));
  ok(weaponFills.parts[0] === null, 'stand-in: weapon_0 fills what a weapon stand-in stands for');
  const failed = await hangAttachments(group(box(-2, 2, 0, 1, -4, 4), hp('engine1', 0, 0.5, -4)), [
    { kind: 'carrier', source: 'CHLD', file: 'none', parent: null, hardpoint: null, place: [0, 0, 0, 0, 0, 0], standInFor: 'engine' },
    { kind: 'component', slot: 'engine', file: 'broken', parent: null, hardpoint: 'engine1' },
  ], loader(models));
  ok(failed.parts[0] !== null && failed.parts[1] === null && failed.hung === 1 && failed.unresolved.length === 1, 'stand-in: hung after all when the listed component fails to load');
  const noHp = await hangAttachments(group(box(-2, 2, 0, 1, -4, 4)), [
    { kind: 'component', slot: 'engine', file: 'engine', parent: null, hardpoint: 'engine_missing' },
    { kind: 'carrier', source: 'CHLD', file: 'none', parent: null, hardpoint: null, place: [0, 0, 0, 0, 0, 0], standInFor: 'engine' },
  ], loader(models));
  ok(noHp.parts[1] !== null && noHp.parts[0] === null && noHp.hung === 1, 'stand-in: hung after all when the listed component\'s hardpoint is missing');
  const lost = group(box(-2, 2, 0, 1, -4, 4));
  const count = lost.children.length;
  const t = await hangAttachments(lost, [
    { kind: 'component', slot: 'engine', file: 'engine', parent: null, hardpoint: 'engine_missing' },
    { kind: 'carrier', file: 'none', parent: 0, hardpoint: null, place: [0, 1, 0, 0, 0, 0] },
    { kind: 'carrier', file: 'broken', parent: null, hardpoint: null },
  ], loader(models));
  ok(t.parts.every((x) => x === null) && t.unresolved.length === 3 && lost.children.length === count, `tree: a missing hardpoint, an orphan and a model that fails are all left off (${t.unresolved.join('; ')})`);
  const shared = await hangAttachments(group(box(-2, 2, 0, 1, -4, 4), hp('weapon1')), [
    { kind: 'component', slot: 'weapon_0', file: 'engine', parent: null, hardpoint: 'weapon1', sharedWith: ['weapon_2'] },
    { kind: 'component', slot: 'weapon_1', file: 'engine', parent: null, hardpoint: 'weapon1' },
  ], loader(models));
  ok(shared.hung === 1 && shared.parts[1] === shared.parts[0] && JSON.stringify(shared.parts[0]!.userData.sharedWith) === '["weapon_2","weapon_1"]', 'duplicates: the same part twice on one hardpoint hangs once and records the other slot');
}

console.log(`wings: ${checks} checks passed`);
