// The trees' and rocks' collision from the client's own shapes (`tools/swg/extent.mjs`, the
// `floracollision` pass, src/world/floraCollision.ts and `Physics.createStaticPart`).
//
// The fault this pins: every collidable planting stood on one upright cylinder guessed from its
// model's box, and a wide tree's box is its canopy, so anything not three times as tall as it was wide
// was blocked at 80% of its width -- a 27 m column under a tall birch, 9 m under an oak -- and a
// forest of one tree per 16 m tile was solid. The client collided with each appearance's own
// collision extent: a trunk, a few cylinders round a rock, a box under a fallen log, a small mesh for
// a dead wroshyr, and nothing at all for a living one or a giant bush.
//
// The IFF trees below are built by hand to the layouts the retail files have (each one checked by
// dumping a real file); the planting arithmetic is checked against three's own matrix, and the
// colliders in a real Rapier world. The last section reads the converted packs when they carry the
// pass's file.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import * as THREE from 'three';
import { FLORA_COLLISION_VERSION as CONVERTER_VERSION, apprCollision, collisionExtentOf, floraCollisionFile, floraCollisionStatus, mirrorShapes, readExtent } from '../extent.mjs';
import { Physics, RAPIER } from '../../../src/core/physics.ts';
import { FLORA_COLLISION, FLORA_COLLISION_DEFAULTS, FLORA_COLLISION_VERSION, floraColliders, guessRadius, mergeFloraCollision, shapeParts, trunkRadius, type FloraCollision, type FloraShape } from '../../../src/world/floraCollision.ts';
import type { FloraChunkData } from '../../../src/world/floraBatch.ts';
import { blockedArea } from './floraBlock.ts';

let passed = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol = 1e-4) => Math.abs(a - b) <= tol;
const root = new URL('../../../', import.meta.url);
const src = (p: string) => readFileSync(new URL(p, root), 'utf8');

// ---------------------------------------------------------------------------------------------
// Hand-built IFF nodes, in the parser's own shape.
type Node = { tag: string; type?: string; children?: Node[]; data?: Buffer };
const form = (type: string, ...children: Node[]): Node => ({ tag: 'FORM', type, children });
const chunk = (tag: string, data: Buffer): Node => ({ tag, data });
const f32 = (...v: number[]) => {
  const b = Buffer.alloc(v.length * 4);
  v.forEach((x, i) => b.writeFloatLE(x, i * 4));
  return b;
};
const i32 = (...v: number[]) => {
  const b = Buffer.alloc(v.length * 4);
  v.forEach((x, i) => b.writeInt32LE(x, i * 4));
  return b;
};
const xcyl = (x: number, y: number, z: number, r: number, h: number) => form('XCYL', form('0000', chunk('CYLN', f32(x, y, z, r, h))));
const exsp = (x: number, y: number, z: number, r: number) => form('EXSP', form('0001', chunk('SPHR', f32(x, y, z, r))));
// The larger corner first, as every retail BOX stores it.
const exbx = (max: number[], min: number[]) => form('EXBX', form('0001', exsp(0, 0, 0, 9), chunk('BOX ', f32(...max, ...min))));
const cpst = (...kids: Node[]) => form('CPST', form('0000', ...kids));
const cmpt = (...kids: Node[]) => form('CMPT', form('0000', cpst(...kids)));
const dtal = (...kids: Node[]) => form('DTAL', form('0000', cpst(...kids)));
const cmsh = (verts: number[], idx: number[]) => form('CMSH', form('0000', form('IDTL', form('0000', chunk('VERT', f32(...verts)), chunk('INDX', i32(...idx))))));
const appr = (collision: Node) => form('APPR', form('0003', exbx([5, 9, 5], [-5, 0, -5]), collision, form('HPTS'), form('FLOR', chunk('DATA', Buffer.from([0])))));

// ---------------------------------------------------------------------------------------------
// The extent reader.
{
  ok(readExtent(form('NULL')).shapes.length === 0 && readExtent(form('NULL')).kind === 'NULL', 'NULL is nothing at all: walked through');
  const cyl = readExtent(xcyl(-0.225, -4.027, 0.1126, 1.5934, 18.6384));
  ok(cyl.kind === 'XCYL' && cyl.shapes.length === 1 && cyl.shapes[0].t === 'cyl' && near(cyl.shapes[0].r!, 1.5934) && near(cyl.shapes[0].h!, 18.6384) && near(cyl.shapes[0].c![1], -4.027), "a cylinder is its base, radius and height (the tall birch's own trunk: 1.59 m, from 4 m under the ground)");
  const ball = readExtent(exsp(0, 0.1153, 0, 0.4611));
  ok(ball.shapes[0].t === 'ball' && near(ball.shapes[0].r!, 0.4611), 'a sphere is its centre and radius');
  const box = readExtent(exbx([0.3916, 0.8767, 5.2317], [-0.3916, -0.44, -0.4296]));
  ok(box.shapes[0].t === 'box' && box.shapes[0].min!.every((v: number, k: number) => v < box.shapes[0].max![k]), 'a box takes its corners componentwise: the file stores the larger one first');
  ok(near(box.shapes[0].max![2], 5.2317) && near(box.shapes[0].min![1], -0.44), "and the box is the BOX chunk's, not the sphere beside it");
  const oak = readExtent(cmpt(xcyl(-0.478, -3.29, 0.167, 1.45, 9.05), exsp(-0.185, -1.715, -0.543, 3.66), exsp(1.17, -0.926, 1.516, 1.87)));
  ok(oak.kind === 'CMPT' && oak.shapes.map((s: FloraShape) => s.t).join() === 'cyl,ball,ball', "a compound is every shape in it (the oak's trunk and two spheres)");
  const rock = readExtent(dtal(xcyl(0, -0.7, 0, 3.3, 4), cmpt(xcyl(0.13, -0.7, 0.045, 2.64, 4), xcyl(1.68, -0.7, 1.26, 1.2, 4))));
  ok(rock.kind === 'DTAL' && rock.shapes.length === 2 && near(rock.shapes[0].r!, 2.64), "a detail extent leaves out its first child, the broad test round the rest");
  ok(readExtent(dtal(xcyl(0, 0, 0, 1, 2))).shapes.length === 1, 'and one with nothing after its broad test keeps that, rather than nothing');
  const mesh = readExtent(cmsh([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 1, 2, 0, 2, 3, 0, 9, 1, 1, 1, 2]));
  ok(mesh.shapes[0].t === 'mesh' && mesh.shapes[0].i!.length === 6, 'a mesh keeps its triangles, less one with a corner past the vertices and one with a corner twice');
  const odd = readExtent(cpst(xcyl(0, 0, 0, 1, 2), form('XOCL', form('0000'))));
  ok(odd.shapes.length === 1 && odd.unread.join() === 'XOCL', 'a kind this reader does not know is left out and named, never guessed at');
  ok(readExtent(xcyl(0, 0, 0, 0, 2)).shapes.length === 0, 'a cylinder of no radius is no shape');
}

// ---------------------------------------------------------------------------------------------
// Where the collision extent is, and the chain it is looked for along.
{
  ok(apprCollision(form('DTLA', form('0007', appr(xcyl(0, 0, 0, 1, 2)))))?.type === 'XCYL', "the collision extent is the second form of APPR 0003, after the drawing extent");
  ok(apprCollision(form('MESH', form('0005', form('APPR', form('0002', exbx([1, 1, 1], [0, 0, 0]), form('HPTS')))))) === null, 'an older APPR carries none');
  const files = new Map<string, Node>([
    ['appearance/tree.apt', form('APT ', form('0000', chunk('NAME', Buffer.from('appearance/lod/tree.lod\0'))))],
    ['appearance/lod/tree.lod', form('DTLA', form('0007', appr(xcyl(0.5, -1, 0, 1.2, 10)), form('DATA', chunk('CHLD', Buffer.concat([i32(0), Buffer.from('mesh/tree_l0.msh\0')]))), chunk('INFO', Buffer.concat([i32(0), f32(0, 64)]))))],
    ['appearance/mesh/tree_l0.msh', form('MESH', form('0005', appr(form('NULL'))))],
    ['appearance/rock.apt', form('APT ', form('0000', chunk('NAME', Buffer.from('appearance/lod/rock.lod\0'))))],
    ['appearance/lod/rock.lod', form('DTLA', form('0007', appr(form('NULL')), form('DATA', chunk('CHLD', Buffer.concat([i32(0), Buffer.from('mesh/rock_l0.msh\0')]))), chunk('INFO', Buffer.concat([i32(0), f32(0, 64)]))))],
    ['appearance/mesh/rock_l0.msh', form('MESH', form('0005', appr(exsp(0, 0.5, 0, 0.8))))],
    ['appearance/bush.apt', form('APT ', form('0000', chunk('NAME', Buffer.from('appearance/mesh/bush.msh\0'))))],
    ['appearance/mesh/bush.msh', form('MESH', form('0005', appr(form('NULL'))))],
    ['appearance/lost.apt', form('APT ', form('0000', chunk('NAME', Buffer.from('appearance/mesh/gone.msh\0'))))],
  ]);
  // The parser reads bytes; these trees are serialised the IFF way so the reader parses them itself.
  const bytes = (n: Node): Buffer => {
    if (n.tag === 'FORM') {
      const body = Buffer.concat([Buffer.from(n.type!, 'latin1'), ...(n.children ?? []).map(bytes)]);
      const head = Buffer.alloc(8);
      head.write('FORM', 0, 'latin1');
      head.writeUInt32BE(body.length, 4);
      return Buffer.concat([head, body]);
    }
    const head = Buffer.alloc(8);
    head.write(n.tag, 0, 'latin1');
    head.writeUInt32BE(n.data!.length, 4);
    return Buffer.concat([head, n.data!]);
  };
  // Case and slashes do not matter to the archives (tre.mjs's own `norm`), so they do not here.
  const norm = (p: string) => p.toLowerCase().replace(/\\/g, '/');
  const vfs = { has: (p: string) => files.has(norm(p)), read: (p: string) => bytes(files.get(norm(p))!) };
  const tree = collisionExtentOf(vfs, 'appearance/tree.apt');
  ok(tree?.kind === 'XCYL' && tree.from === 'appearance/lod/tree.lod', "a tree's trunk is found on its .lod, before the mesh that says NULL");
  const rock = collisionExtentOf(vfs, 'appearance/rock.apt');
  ok(rock?.kind === 'EXSP' && rock.from === 'appearance/mesh/rock_l0.msh', "where the .lod says NULL the finest mesh's own is taken");
  const bush = collisionExtentOf(vfs, 'appearance/bush.apt');
  ok(bush?.kind === 'NULL' && bush.shapes.length === 0, 'a chain that says NULL everywhere is walked through');
  ok(collisionExtentOf(vfs, 'appearance/nothing.apt') === null, 'a chain that cannot be read at all is no word, which the game guesses');
  ok(collisionExtentOf(vfs, 'appearance/lost.apt')?.kind === 'NULL', 'a chain whose next file is missing says nothing more than it found');

  const file = floraCollisionFile(vfs, ['appearance\\Tree.apt', 'appearance/rock.apt', 'appearance/bush.apt', 'appearance/nothing.apt', 'appearance/bugs.prt']);
  ok(file.version === CONVERTER_VERSION && file.flipX === true && Object.keys(file.appearances).join() === 'appearance/tree.apt,appearance/rock.apt,appearance/bush.apt', 'the file keys each appearance as the game keys its flora models: forward slashes, lower case, no particle effect');
  ok(file.counts.byKind.XCYL === 1 && file.counts.byKind.EXSP === 1 && file.counts.byKind.NULL === 1 && file.unreadable?.join() === 'appearance/nothing.apt', 'it counts what it read and names what it could not');
  ok(file.appearances['appearance/tree.apt'].shapes[0].c[0] === -0.5, 'and writes the shapes mirrored in X, as the GLBs are');
  const defs = [{ appearance: 'appearance/tree.apt' }, { appearance: 'appearance/rock.apt' }, { appearance: 'appearance/nothing.apt' }];
  ok(floraCollisionStatus(null, defs).stale && floraCollisionStatus({ version: 0, appearances: {} }, defs).stale, 'status asks for the pass where a world has no file, or one of an older shape');
  ok(!floraCollisionStatus(file, defs).stale, 'and not for a file that has every planted appearance, or names it unreadable');
  ok(floraCollisionStatus(file, [...defs, { appearance: 'appearance/new_tree.apt' }]).stale, 'but again for a planted appearance the file never read (a world converted again since)');
  ok(floraCollisionStatus(null, []).line === null && !floraCollisionStatus(null, []).stale, 'a world with no flora is not asked about at all');
}

// ---------------------------------------------------------------------------------------------
// Mirroring, the guess, and the versions.
{
  const m = mirrorShapes([
    { t: 'cyl', c: [1, 2, 3], r: 1, h: 2 },
    { t: 'box', min: [-1, 0, 0], max: [3, 1, 1] },
    { t: 'mesh', v: [1, 0, 0, 2, 0, 0, 0, 0, 1], i: [0, 1, 2] },
  ]);
  ok(m[0].c[0] === -1 && m[1].min[0] === -3 && m[1].max[0] === 1, "a cylinder's base and a box's corners are mirrored in X, the box's corners swapped so min stays min");
  ok(m[2].v[0] === -1 && m[2].v[3] === -2 && m[2].i.join() === '0,2,1', "a mesh's vertices are mirrored and its triangles turned round so they still face out");
  ok(CONVERTER_VERSION === FLORA_COLLISION_VERSION, 'the converter writes the shape of file the game reads');
  const t = FLORA_COLLISION_DEFAULTS;
  ok(t.rule === 'client' && t.nullTrunk === false, 'shipped: the client\'s shapes, and a NULL extent walked through as the client did');
  // The old rule, verbatim: h > 2.2r ? min(max(0.3r, 0.25), 1.2) : max(0.8r, 0.3).
  const old = (r: number, h: number) => (h > 2.2 * r ? Math.min(Math.max(r * 0.3, 0.25), 1.2) : Math.max(r * 0.8, 0.3));
  let same = true;
  for (const [r, h] of [[0.2, 5], [4, 10], [13.7, 35], [0.5, 0.5], [1, 2.3], [30, 20]]) if (guessRadius(r, h, t) !== old(r, h)) same = false;
  ok(same, 'the guess is exactly the rule it replaces, for a pack with no file');
  ok(guessRadius(34.2, 61.5, t) > 27, `and it is the fault: the tall birch, 68 m of canopy across and 61 m tall, is blocked ${guessRadius(34.2, 61.5, t).toFixed(1)} m out`);
  ok(trunkRadius(100, t) === 1.2 && trunkRadius(0.1, t) === 0.25, "the guess's trunk is held between its two numbers");
}

// ---------------------------------------------------------------------------------------------
// Hanging the shapes on a planting, through the planting's own matrix.
const model = (collision: FloraCollision | undefined, radius = 10, height = 20) => ({ radius, height, def: { id: 'm', collision } }) as never;
const planting = (models: unknown[], at: [number, number, number][], yaws: number[], scales: number[]): FloraChunkData => {
  const n = models.length;
  const mats = new Float32Array(n * 16);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    // Exactly what plantingData in src/world/flora.ts writes: a mirrored world turns the other way.
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaws[i]);
    m.compose(new THREE.Vector3(...at[i]), q, new THREE.Vector3(scales[i], scales[i], scales[i]));
    m.toArray(mats, i * 16);
  }
  return { n, models: models as never, mats, x: Float32Array.from(at.map((p) => p[0])), y: Float32Array.from(at.map((p) => p[1])), z: Float32Array.from(at.map((p) => p[2])), scale: Float32Array.from(scales), collidable: new Uint8Array(n).fill(1) };
};
{
  const birch: FloraCollision = { kind: 'XCYL', shapes: [{ t: 'cyl', c: [0.225, -4.0272, 0.1125], r: 1.5934, h: 18.6384 }] };
  const yaw = 1.1;
  const data = planting([model(birch, 34.2, 61.5)], [[100, 50, -30]], [yaw], [1.3]);
  const [col] = floraColliders(data, []);
  const p = col.parts![0];
  // Where three puts the shape's own middle, through the same matrix the tree is drawn with.
  const mid = new THREE.Vector3(0.225, -4.0272 + 18.6384 / 2, 0.1125).applyMatrix4(new THREE.Matrix4().fromArray(data.mats));
  ok(p.kind === 'cyl' && near(p.x, mid.x) && near(p.y, mid.y) && near(p.z, mid.z), 'a trunk stands where the drawn tree has it: its place, its mirrored turn and its scale through the planting\'s own matrix');
  ok(near(p.r, 1.5934 * 1.3) && near(p.hy, (18.6384 * 1.3) / 2), 'and is as wide and tall as the planting is scaled');
  ok(col.r < 3 && col.r > 1.5 * 1.3, `the birch now blocks ${col.r.toFixed(2)} m out where the guess blocked ${guessRadius(34.2 * 1.3, 61.5 * 1.3).toFixed(2)}`);

  const log: FloraCollision = { kind: 'EXBX', shapes: [{ t: 'box', min: [-0.39, -0.44, -0.43], max: [0.39, 0.88, 5.23] }] };
  const boxData = planting([model(log)], [[0, 0, 0]], [0.7], [1]);
  const bp = floraColliders(boxData, [])[0].parts![0];
  // The box's far corner, turned by the box's own quaternion, must be where the matrix puts it.
  const corner = new THREE.Vector3(0.39, 0.88, 5.23).applyMatrix4(new THREE.Matrix4().fromArray(boxData.mats));
  const centre = new THREE.Vector3(0, 0.22, 2.4).applyMatrix4(new THREE.Matrix4().fromArray(boxData.mats));
  const local = corner.clone().sub(centre).applyQuaternion(new THREE.Quaternion(0, bp.qy, 0, bp.qw).invert());
  ok(near(local.x, bp.hx) && near(local.y, bp.hy) && near(local.z, bp.hz), "a box is turned with the planting: its corner lands on the corner the drawn log has");

  const wroshyr: FloraCollision = { kind: 'CMSH', shapes: [{ t: 'mesh', v: [0, -1, 0, 4, -1, 0, 0, -1, 4, 0, 10, 0], i: [0, 1, 2, 0, 3, 1, 1, 3, 2, 2, 3, 0] }] };
  const mp = floraColliders(planting([model(wroshyr)], [[5, 1, 5]], [0], [2]), [])[0].parts![0];
  ok(mp.kind === 'mesh' && mp.verts!.length === 12 && near(mp.verts![3], 5 + 8) && near(mp.verts![10], 1 + 20) && mp.idx!.length === 12, 'a mesh has its vertices carried into the world and keeps its triangles');

  ok(floraColliders(planting([model(undefined, 34.2, 61.5)], [[0, 0, 0]], [0], [1]), []).every((c) => !c.parts && near(c.r, guessRadius(34.2, 61.5))), 'a model the pack has no word on stands on the guess, as it always did');
  const nothing = planting([model({ kind: 'NULL', shapes: [] }, 30, 120)], [[0, 0, 0]], [0], [1]);
  ok(floraColliders(nothing, []).length === 0, 'a model the client walked through stands on nothing');
  FLORA_COLLISION.nullTrunk = true;
  const trunk = floraColliders(nothing, []);
  ok(trunk.length === 1 && trunk[0].r === 1.2 && !trunk[0].parts, 'and on the guess\'s slim trunk with nullTrunk, if it is tall enough to be a tree');
  ok(floraColliders(planting([model({ kind: 'NULL', shapes: [] }, 6, 5)], [[0, 0, 0]], [0], [1]), []).length === 0, 'never a squat bush, which the guess would have called a rock');
  FLORA_COLLISION.nullTrunk = false;
  FLORA_COLLISION.rule = 'guess';
  ok(floraColliders(data, []).every((c) => !c.parts), "rule 'guess' puts the old cylinder back everywhere, for comparison");
  FLORA_COLLISION.rule = 'client';
  ok(shapeParts([{ t: 'cyl', c: [0, 0, 0], r: 0, h: 2 }, { t: 'ball', c: [0, 0, 0], r: -1 }, { t: 'mesh', v: [0, 0, 0], i: [0, 0, 0] }], data.mats, 0, 1).length === 0, 'a shape the engine could not take is left out');
}

// ---------------------------------------------------------------------------------------------
// The file onto the pack, as floors.json goes on.
{
  const defs: { appearance?: string; collision?: FloraCollision }[] = [{ appearance: 'appearance\\Decd_Tree.apt' }, { appearance: 'appearance/rock.apt' }, { appearance: '__proto__' }, {}];
  const file = { version: FLORA_COLLISION_VERSION, appearances: JSON.parse('{"appearance/decd_tree.apt":{"kind":"XCYL","shapes":[{"t":"cyl","c":[0,0,0],"r":1,"h":2}]},"__proto__":{"kind":"NULL","shapes":[]}}') };
  ok(mergeFloraCollision(defs, file) === 2 && defs[0].collision?.kind === 'XCYL' && !defs[1].collision, 'each def takes its own entry by its appearance, slashes and case as the game keys it');
  ok(defs[2].collision?.kind === 'NULL' && Object.getPrototypeOf(defs[2]) === Object.prototype, "a key that is one of the language's own names is only a key");
  const fresh = [{ appearance: 'appearance/decd_tree.apt' }] as { appearance: string; collision?: FloraCollision }[];
  ok(mergeFloraCollision(fresh, { ...file, version: 99 }) === 0 && !fresh[0].collision, 'a file of another shape is passed over whole');
  ok(mergeFloraCollision(fresh, null) === 0 && mergeFloraCollision(fresh, 'nonsense') === 0, 'and so is no file at all');
}

// ---------------------------------------------------------------------------------------------
// In a real physics world.
{
  const physics = await Physics.create();
  const oak: FloraCollision = { kind: 'CMPT', shapes: [{ t: 'cyl', c: [-0.4784, -3.2868, 0.1674], r: 1.4515, h: 9.0479 }, { t: 'ball', c: [-0.1849, -1.7152, -0.5427], r: 3.662 }, { t: 'ball', c: [1.1723, -0.9262, 1.5159], r: 1.8698 }] };
  const log: FloraCollision = { kind: 'EXBX', shapes: [{ t: 'box', min: [-0.39, -0.44, -0.43], max: [0.39, 0.88, 5.23] }] };
  const dead: FloraCollision = { kind: 'CMSH', shapes: [{ t: 'mesh', v: [-2, -1, -2, 2, -1, -2, 2, -1, 2, -2, -1, 2, 0, 12, 0], i: [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4, 0, 2, 1, 0, 3, 2] }] };
  const data = planting([model(oak, 6.9, 11), model(log, 2.9, 1.3), model(dead, 8, 30), model({ kind: 'NULL', shapes: [] }, 40, 150)], [[0, 0, 0], [40, 0, 0], [80, 0, 0], [120, 0, 0]], [0, 0, 0, 0], [1, 1, 1, 1]);
  const cols = floraColliders(data, []);
  let made = 0;
  for (const c of cols) for (const part of c.parts ?? []) if (physics.createStaticPart(part)) made++;
  ok(cols.length === 3 && made === 5, `the oak's trunk and two spheres, the log's box and the dead tree's mesh are stood up (${made}), and the living giant is nothing`);
  // A query sees nothing until the world has stepped once.
  physics.stepOnce();
  const hits = (x: number, y: number, z: number, dx: number, dz: number, len: number) => physics.world.castRay(new RAPIER.Ray({ x, y, z }, { x: dx, y: 0, z: dz }), len, true) !== null;
  // A walker 1 m up, coming at the oak from 8 m off: the guess blocked a column 5.5 m round it.
  ok(hits(-8, 1, 0, 1, 0, 16), 'a walker heading through the oak meets it');
  ok(!hits(-8, 1, 4.5, 1, 0, 16), `and passes 4.5 m to the side of it, well inside where the guess stood (${guessRadius(6.9, 11).toFixed(1)} m)`);
  ok(hits(40, 0.2, -3, 0, 1, 10) && !hits(40, 0.2, 7, 0, 1, 3), 'the fallen log is solid along itself and nothing beyond its end');
  ok(hits(74, 1, 0, 1, 0, 12) && !hits(74, 11.5, 2.5, 1, 0, 12), "the dead tree is solid at its foot and narrows as its own mesh does");
  ok(!hits(100, 1, 0, 1, 0, 40), 'the living giant is walked through');
  ok(physics.createStaticPart({ kind: 'mesh', x: 0, y: 0, z: 0, r: 0, hx: 0, hy: 0, hz: 0, qy: 0, qw: 1, verts: new Float32Array(9), idx: Uint32Array.from([0, 1, 2]) }) === null, 'a mesh with no triangle left after cleaning is no collider rather than a panic');
  ok(physics.createStaticPart({ kind: 'box', x: 0, y: 0, z: 0, r: 0, hx: 1, hy: 0, hz: 1, qy: 0, qw: 1, verts: null, idx: null }) === null && physics.createStaticPart({ kind: 'ball', x: Number.NaN, y: 0, z: 0, r: 1, hx: 0, hy: 0, hz: 0, qy: 0, qw: 1, verts: null, idx: null }) === null, 'nor is a flat box or a ball somewhere that is not a place');
}

// ---------------------------------------------------------------------------------------------
// The wiring.
{
  const flora = src('src/world/flora.ts');
  ok(/floraColliders\(data, colliders\)/.test(flora) && !/h > 2\.2 \* r/.test(flora), "the planter builds a chunk's colliders through the one rule, and the guess lives only there");
  const world = src('src/world/world.ts');
  ok(/if \(p\.parts\) \{\s*for \(const part of p\.parts\) \{\s*const col = this\.physics\.createStaticPart\(part\);/.test(world), "a chunk's physics stands up each planting's own shapes");
  ok(/refreshFloraColliders\(\): void/.test(world) && /floraData,/.test(world), 'and keeps each chunk\'s plantings so the console can rebuild them');
  const pack = src('src/world/assetPack.ts');
  ok(/flora-collision\.json/.test(pack) && /mergeFloraCollision\(manifest\.categories\.flora/.test(pack), 'the pack merges flora-collision.json at load, as it does floors.json');
  const physicsSrc = src('src/core/physics.ts');
  ok(/case 'mesh': \{[\s\S]*?cleanTrimesh\(p\.verts, p\.idx\)[\s\S]*?TRIMESH_FLAGS/.test(physicsSrc), 'a mesh shape goes through cleanTrimesh and TRIMESH_FLAGS, as every trimesh does');
  const cli = src('tools/swg/cli.mjs');
  ok(/case 'floracollision':/.test(cli) && /const collision = writeFloraCollision\(vfs, outDir, manifest\.categories\.flora\)/.test(cli), 'the pass is a command of its own, and the snapshot and flora runs write the same file');
  ok(/need\(`floracollision <swg-dir> \$\{dir\} --retail-only`/.test(cli), 'status asks for it');
  const plan = src('tools/swg/convertPlan.mjs');
  ok(/floracollision: \{ order: [\d.]+, lock: 'pack', needs: \['snapshot', 'flora'\]/.test(plan), 'the conversion plan knows it, and that it waits for the worlds');
  ok(/floracollision: '/.test(src('tools/launcher/plan.mjs')), 'and the launcher has words for it');
  const main = src('src/main.ts');
  ok(/this\.world\.refreshFloraColliders\(\)/.test(main) && /collision: \{ tune: \{ \.\.\.FLORA_COLLISION \}/.test(main), '`__debug.flora({ collision })` moves the rule and reports it');
  ok(/`collision: \{ rule: 'guess' \}`/.test(src('README.md')) || /collision: \{ rule: 'guess' \}/.test(src('README.md')), "README's Debugging row names it");
}

// ---------------------------------------------------------------------------------------------
// What the pass wrote, where there are converted packs.
{
  const packs = new URL('assets-private/', root);
  const worlds = existsSync(packs) ? readdirSync(packs).filter((w) => existsSync(new URL(`${w}/flora-collision.json`, packs))) : [];
  if (!worlds.length) console.log('note: no converted world carries flora-collision.json yet; run the floracollision pass to check the packs');
  else {
    const kinds = new Map<string, string>();
    let missing = 0;
    let planted = 0;
    // Each model's ground taken from a walker, one planting of it at scale 1, by both rules: the game's own
    // colliders (`floraColliders`) under the measurement `floraBlock.ts` makes over whole worlds.
    const area = { guess: 0, client: 0, models: 0, bigger: 0 };
    const named = new Map<string, { guess: number; client: number }>();
    for (const w of worlds) {
      const file = JSON.parse(readFileSync(new URL(`${w}/flora-collision.json`, packs), 'utf8'));
      const manifest = JSON.parse(readFileSync(new URL(`${w}/manifest.json`, packs), 'utf8'));
      ok(file.version === FLORA_COLLISION_VERSION && file.flipX === true, `${w}: the file is the shape the game reads`);
      for (const d of manifest.categories?.flora ?? []) {
        if (!d.appearance) continue;
        planted++;
        const key = String(d.appearance).replace(/\\/g, '/').toLowerCase();
        const e = file.appearances[key];
        if (!e) {
          if (!(file.unreadable ?? []).includes(key)) missing++;
          continue;
        }
        if (kinds.has(key)) continue;
        kinds.set(key, e.kind);
        const r = Math.max(d.bounds.max[0] - d.bounds.min[0], d.bounds.max[2] - d.bounds.min[2]) / 2;
        const h = d.bounds.max[1] - Math.min(0, d.bounds.min[1]);
        const one = planting([model(e, r, h)], [[0, 0, 0]], [0.3], [1]);
        FLORA_COLLISION.rule = 'guess';
        const g = floraColliders(one, []).reduce((a, c) => a + blockedArea(c, 0, 0.1), 0);
        FLORA_COLLISION.rule = 'client';
        const c = floraColliders(one, []).reduce((a, col) => a + blockedArea(col, 0, 0.1), 0);
        area.models++;
        area.guess += g;
        area.client += c;
        if (c > g * 1.05) area.bigger++;
        if (/decd_tallbirch\.apt$|decd_oaktreeleaves\.apt$|decd_wroshyr_tree_dead01\.apt$|rock_plain_white\.apt$/.test(key)) named.set(key.replace(/^appearance\//, ''), { guess: g, client: c });
      }
    }
    ok(missing === 0, `every one of the ${planted} flora models the worlds plant has the client's word in its world's file`);
    const tally = new Map<string, number>();
    for (const k of kinds.values()) tally.set(k, (tally.get(k) ?? 0) + 1);
    console.log(`     the ${kinds.size} appearances planted: ${[...tally.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join(', ')}`);
    ok(kinds.size > 0 && (tally.get('NULL') ?? 0) > 0 && (tally.get('XCYL') ?? 0) > 0, 'and they are the kinds the client authored: trunks, and the plants it walked through');
    for (const [k, v] of named) console.log(`     ${k}: ${v.guess.toFixed(1)} m2 taken from a walker by the guess, ${v.client.toFixed(1)} by the client's shapes`);
    ok(area.models > 0 && area.client < area.guess / 3, `over the ${area.models} models, the client's shapes take ${area.client.toFixed(0)} m2 of ground from a walker where the guess took ${area.guess.toFixed(0)} (${area.bigger} models block more than they did: rocks whose own cylinders reach their whole width where the guess stopped at 80%, and giant trees whose trunks are wider than the guess's 1.2 m cap)`);
    const birch = named.get('decd_tallbirch.apt');
    if (birch) ok(birch.client < birch.guess / 50, `the tall birch blocks its trunk (${birch.client.toFixed(1)} m2) where the guess blocked ${birch.guess.toFixed(0)} m2`);
  }
}

console.log(`\nfloraCollision: ${passed} checks passed`);
