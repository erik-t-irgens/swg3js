// The world editor's looks and attachments as rules (Map-maker II's seventh wave, `src/editor/lookPick.ts`): a model's
// materials by name, the shell's first and each once; one material's look changed (a tint, a borrowed picture beside it, a
// borrowed material alone, cleared), in one spelling; an attachment hung where the aim met a row, in that row's own frame;
// one moved by the hand to the millimetre, its turn about its own up, its size multiplied, its defaults written absent --
// and the live carry's frame the very one the written attachment reads to; a mark's row in the file's frame; every row
// change a whole row that the file reader takes back as it is.
//
// Run: node tools/swg/tests/lookPick.test.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { attachAtHit, attachMoved, attachMovedFrame, lookWith, markRow, materialList, withAttachment, withAttachmentAt, withLooks } from '../../../src/editor/lookPick.ts';
import { attachLocal } from '../../../src/world/rowAttach.ts';
import { PLACEMENT_LIMITS, readPlacementRow, type PlacementRow, type RowAttach } from '../../../src/story/placements.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const named = (name: string, map = false) => {
  const m = new THREE.MeshStandardMaterial();
  m.name = name;
  if (map) m.map = new THREE.Texture();
  return m;
};

// ---- materialList ----
{
  const shell = named('wall', true);
  const room = named('floor');
  const copy = named('wall');
  const list = materialList([
    { material: room, cell: 2 },
    { material: shell, cell: 0 },
    { material: copy, cell: 1 },
    { material: [named('glass'), named('trim')], cell: -1 },
  ]);
  ok(list.map((m) => m.name).join(',') === 'wall,glass,trim,floor', `the shell's first, each name once (${list.map((m) => m.name).join(', ')})`);
  ok(list[0].material === shell && list[0].map && !list[1].map, "the shell's own material, and whether it draws a picture");
}

// ---- lookWith ----
{
  let mats = lookWith(undefined, 'body', { tint: '#FF0000' });
  ok(JSON.stringify(mats) === '[{"of":"body","tint":"#ff0000"}]', 'a tint set, written in lower case');
  mats = lookWith(mats, 'body', { map: 'props:sign/face' });
  ok(JSON.stringify(mats) === '[{"of":"body","tint":"#ff0000","map":"props:sign/face"}]', 'a borrowed picture beside it, in the one order');
  mats = lookWith(mats, '*', { tint: '#00ff00' });
  ok(mats!.length === 2 && mats![1].of === '*', 'another material\'s look kept, in its order');
  mats = lookWith(mats, 'body', { like: 'props:sign/face' });
  ok(JSON.stringify(mats![0]) === '{"of":"body","like":"props:sign/face"}', 'a borrowed material stands alone, in place of whatever was worn');
  mats = lookWith(mats, 'body', { tint: '#0000ff' });
  ok(JSON.stringify(mats![0]) === '{"of":"body","tint":"#0000ff"}', 'a tint on a borrowed material takes the borrowed material off');
  mats = lookWith(mats, 'body', { tint: null });
  ok(mats!.length === 1 && mats![0].of === '*', 'an entry left with nothing is taken out');
  ok(lookWith(mats, '*', { clear: true }) === undefined, 'and a list left with nothing is none, which is how a row writes it');
}

// ---- attachAtHit ----
{
  const base = new THREE.Matrix4().compose(new THREE.Vector3(10, 2, -4), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2), new THREE.Vector3(2, 2, 2));
  const at = attachAtHit(base, { x: 10, y: 4, z: -6 }, 0.5);
  // A point 2 m along the world's -z from a row turned a quarter about up and stood twice its size: 1 m along its +x.
  ok(at[0] === 1 && at[1] === 1.25 && at[2] === 0, `the hit in the row's own frame, to the millimetre, its scale taken in (${at.join(', ')})`);
}

// ---- attachMoved, attachMovedFrame ----
{
  const a: RowAttach = { fx: 'props:particles/f.json', at: [1, 2, 3] };
  const m = attachMoved(a, { dx: 0.0004, dy: -2, dz: 0, turn: Math.PI / 2, size: 1.5 });
  ok(m.at![0] === 1 && m.at![1] === 0 && m.at![2] === 3, 'a move to the millimetre');
  ok(Math.abs(m.q![0] - Math.SQRT1_2) < 1e-6 && Math.abs(m.q![2] - Math.SQRT1_2) < 1e-6 && m.q![1] === 0 && m.q![3] === 0, 'a turn about its own up, [w, x, y, z]');
  ok(m.size === 1.5, 'a size multiplied');
  const back = attachMoved(m, { dx: -1, dz: -3, turn: -Math.PI / 2, size: 1 / 1.5 });
  ok(back.at === undefined && back.q === undefined && back.size === undefined && JSON.stringify(back) === '{"fx":"props:particles/f.json"}', 'the origin, no turn and a size of 1 written absent');
  const far = attachMoved(a, { dx: 1e9 });
  ok(far.at![0] === PLACEMENT_LIMITS.attachReach, 'held within the backstop');
  const big = attachMoved({ fx: 'p:f.json', size: 50 }, { size: 100 });
  ok(big.size === PLACEMENT_LIMITS.sizeMax, 'and a size within its backstops');
  const snd = attachMoved({ snd: 'sound/x.snd' }, { dy: 1, turn: 1, size: 3 });
  ok(JSON.stringify(snd) === '{"snd":"sound/x.snd","at":[0,1,0]}', 'a sound takes a place and nothing else (no turn, no size)');
  // The carry's frame is the written attachment's as the holder stands it (`rowAttach.attachLocal`, the very function that
  // reads a written attachment's `at` and `q`), every number as the file will read it, so let go it does not jump.
  const out = new THREE.Matrix4();
  const sized = { v: 0.5 };
  for (const [b, c] of [
    [a, { dx: 0.0004, dy: -2, turn: 0.3, size: 1.5 }],
    [{ fx: 'p:f.json', q: [0.9, 0.1, 0.3, 0.2] as [number, number, number, number] }, { turn: -1.2, size: 0.25 }],
    [{ fx: 'p:f.json', q: [0.5, 0.5, 0.5, 0.5] as [number, number, number, number], at: [0, 0, 4] }, { turn: 2.1, dz: -1 }],
    [{ snd: 's/x.snd' }, { dx: 2, turn: 1, size: 9 }],
  ] as [RowAttach, Parameters<typeof attachMoved>[1]][]) {
    attachMovedFrame(b, c, out, sized);
    const w = attachMoved(b, c);
    const want = attachLocal(w, new THREE.Matrix4());
    const same = out.elements.every((e, i) => Math.abs(e - want.elements[i]) < 1e-12) && sized.v === (w.fx ? (w.size ?? 1) : 1);
    ok(same, `the live carry's frame and size are the written attachment's (${JSON.stringify(w)})`);
  }
}

// ---- Rows. ----
{
  const row = readPlacementRow({ id: 'lamp-1', kind: 'prop', pack: 'props', thing: 'lamp', x: 1, y: 2, z: 3, q: [1, 0, 0, 0], at: 5 }) as PlacementRow;
  const hung = withAttachment(row, { fx: 'props:particles/f.json', at: [0, 1, 0] }) as PlacementRow;
  ok(typeof hung === 'object' && hung.attach!.length === 1 && hung.at === undefined, 'an attachment hung: the row whole, its moment left for the endpoint to stamp');
  ok(JSON.stringify(readPlacementRow(hung)) === JSON.stringify(hung), 'and the file reader takes it back as it is');
  const full = { ...row, attach: Array.from({ length: PLACEMENT_LIMITS.attachments }, () => ({ snd: 'sound/x.snd' })) } as PlacementRow;
  ok(typeof withAttachment(full, { snd: 'sound/y.snd' }) === 'string', 'past the backstop it is refused in words');
  const off = withAttachmentAt(hung, 0, null);
  ok(off.attach === undefined, 'the last one taken off is none at all');
  const looked = withLooks(row, [{ of: '*', tint: '#123456' }]);
  ok(JSON.stringify(readPlacementRow(looked)) === JSON.stringify(looked) && withLooks(looked, undefined).mats === undefined, 'looks put on and taken off, read back as they are');
  const mark = { id: 'mark-1', ...markRow([{ fx: 'props:particles/f.json' }], { x: -5.0004, y: 2, z: 7 }, { x: 100, z: 50 }, 'raw', false, 1.5) } as PlacementRow;
  ok(mark.kind === 'mark' && mark.x === 105 && mark.z === 57 && mark.y === 2 && mark.ground === 1.5 && JSON.stringify(mark.q) === '[1,0,0,0]', `a mark's row in the file's frame (the layout's mirror), to the millimetre (${mark.x}, ${mark.z})`);
  ok(JSON.stringify(readPlacementRow(mark)) === JSON.stringify(mark), 'and the reader takes it as it is');
  const inside = markRow([{ snd: 'sound/x.snd' }], { x: 1, y: 2, z: 3 }, null, 'game', true, 9);
  ok(inside.inside === true && inside.ground === undefined && inside.x === 1, 'a mark in a room says so, with no ground; in the game\'s frame as it stands');
}

console.log(`\nlookPick: ${checks} checks passed`);
