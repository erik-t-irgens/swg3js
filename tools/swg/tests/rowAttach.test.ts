// What hangs on the permanent rows (Map-maker II's seventh wave, `src/world/rowAttach.ts`): one holder stands every row's
// effects and sounds by the row's key, apart from the tiers. An effect is placed only on a look that finds its row within
// `reach` of the eye (made ready once a file, first), taken away past `reach` times `slack`; its matrix is its row's place,
// turn and scale times its own frame with the scale taken back out, its size its own times the row's largest axis; a sound
// joins the emitters at once and leaves with its row; a row moved by the editor carries what hangs on it and is put back
// when the edit ends; a size moved sizes the standing effect in place; the handles are a flat list written when something moved; a
// file made ready for a world that has gone places nothing in the next; and the editor's preview is made ready first.
//
// Run: node tools/swg/tests/rowAttach.test.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ATTACH_TUNE, RowAttachments, attachLocal, attachMatrix, rowMatrix } from '../../../src/world/rowAttach.ts';
import type { PlacementRow } from '../../../src/story/placements.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, e = 1e-9) => Math.abs(a - b) <= e;

interface H {
  file: string;
  m: THREE.Matrix4;
  size: number;
  contained: boolean;
  gone: boolean;
}
const log: string[] = [];
const placed: H[] = [];
const sounds = new Map<object, { t: string; x: number; y: number; z: number; inside: boolean }>();
let prepares = 0;
const pending: { file: string; done: (ok: boolean) => void }[] = [];
const holder = new RowAttachments<H>({
  fileOf: (ref) => (ref.startsWith('none:') ? null : `../${ref.replace(':', '/')}`),
  prepare: (file) => {
    prepares++;
    return new Promise<boolean>((resolve) => pending.push({ file, done: resolve }));
  },
  place: (file, m, contained, size) => {
    const h = { file, m: m.clone(), size, contained, gone: false };
    placed.push(h);
    log.push(`place ${file} ${size}`);
    return h;
  },
  move: (h, m) => h.m.copy(m),
  resize: (h, size) => {
    h.size = size.v;
    log.push(`resize ${h.file} ${size.v}`);
  },
  remove: (h) => {
    h.gone = true;
    log.push(`remove ${h.file}`);
  },
  sound: (owner, t, x, y, z, inside) => sounds.set(owner, { t, x, y, z, inside }),
  soundMove: (owner, x, y, z) => {
    const s = sounds.get(owner);
    if (s) Object.assign(s, { x, y, z });
  },
  soundOff: (owner) => sounds.delete(owner),
  fullOf: () => 12,
});
const flush = async (ok = true) => {
  while (pending.length) pending.shift()!.done(ok);
  await new Promise((r) => setTimeout(r, 0));
};
const live = () => placed.filter((h) => !h.gone);

// ---- The frames. ----
{
  const at: [number, number, number] = [1, 2, 3];
  const local = attachLocal({ fx: 'p:f.json', at, q: [Math.cos(0.25), 0, Math.sin(0.25), 0] }, new THREE.Matrix4());
  const p = new THREE.Vector3().setFromMatrixPosition(local);
  ok(p.x === 1 && p.y === 2 && p.z === 3, "an attachment's own place in its model's frame");
  // Its turn is the file's `[w, x, y, z]` taken as three's (x, y, z, w): half a radian about up turns its +x toward -z.
  const lq = new THREE.Quaternion().setFromRotationMatrix(local);
  const want = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);
  ok(Math.abs(lq.dot(want)) > 1 - 1e-12, `and its own turn, the file's [w, x, y, z] read as written (${lq.toArray().map((v) => v.toFixed(4)).join(', ')})`);
  const ax = new THREE.Vector3(1, 0, 0).transformDirection(attachLocal({ fx: 'p:f.json', q: [Math.SQRT1_2, Math.SQRT1_2, 0, 0] }, new THREE.Matrix4()));
  ok(near(ax.x, 1) && near(ax.y, 0) && near(ax.z, 0) && near(new THREE.Vector3(0, 1, 0).transformDirection(attachLocal({ fx: 'p:f.json', q: [Math.SQRT1_2, Math.SQRT1_2, 0, 0] }, new THREE.Matrix4())).z, 1), 'a turn about its x leaves x where it is and takes up to +z: the axis read from the second number, never the first');
  const row = { id: 'r', kind: 'prop', pack: 'props', thing: 't', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], scale: 2 } as PlacementRow;
  const base = rowMatrix(row, { x: 10, y: 0, z: -5, q: [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)] }, new THREE.Matrix4());
  const w = attachMatrix(base, attachLocal({ fx: 'p:f.json', at: [1, 0, 0] }, new THREE.Matrix4()), new THREE.Matrix4());
  const wp = new THREE.Vector3();
  const wq = new THREE.Quaternion();
  const ws = new THREE.Vector3();
  w.decompose(wp, wq, ws);
  // Turned a quarter about up: the model's +x goes to the world's -z, at twice its size: 2 m off the row's place.
  ok(near(wp.x, 10, 1e-9) && near(wp.z, -7, 1e-9), `it stands where the scaled, turned model puts it (${wp.x.toFixed(3)}, ${wp.z.toFixed(3)})`);
  ok(near(ws.x, 1, 1e-9) && near(ws.y, 1, 1e-9) && near(ws.z, 1, 1e-9), 'at its own size: the scale is taken back out');
  const mark = rowMatrix({ id: 'm', kind: 'mark', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], scale: 3 } as PlacementRow, { x: 1, y: 2, z: 3, q: [0, 0, 0, 1] }, new THREE.Matrix4());
  ok(near(new THREE.Vector3().setFromMatrixScale(mark).x, 1), 'a mark takes no scale');
}

// ---- Standing, looking, reach. ----
const rowA = { id: 'a', kind: 'prop', pack: 'props', thing: 't', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], scale: [1, 3, 2], attach: [{ fx: 'props:particles/fire.json', at: [0, 1, 0], size: 2 }, { snd: 'sound/hum.snd', at: [0, 2, 0] }] } as PlacementRow;
const markB = { id: 'b', kind: 'mark', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], inside: true, attach: [{ fx: 'props:particles/fire.json' }] } as PlacementRow;
{
  holder.stand('place/a', rowA, { x: 0, y: 0, z: 0, q: [0, 0, 0, 1] });
  ok(sounds.size === 1 && [...sounds.values()][0].t === 'sound/hum.snd', 'a sound joins the emitters at once');
  const s = [...sounds.values()][0];
  ok(near(s.y, 6), `at its place in the world, the row's scale under it (${s.y} m up: 2 m of a model stood three times its height)`);
  ok(placed.length === 0, 'an effect is placed only on a look');
  holder.update({ x: 1000, y: 0, z: 0 }, 1);
  ok(prepares === 0, 'and only where its row is within reach of the eye');
  holder.update({ x: 10, y: 0, z: 0 }, 1);
  ok(prepares === 1 && placed.length === 0, 'in reach, its file is made ready first, nothing placed until it is');
  holder.update({ x: 10, y: 0, z: 0 }, 1);
  ok(prepares === 1, 'and asked once, however many looks come meanwhile');
  await flush();
  ok(live().length === 1 && live()[0].file === '../props/particles/fire.json', 'made ready, it is placed (its file out of its own pack)');
  ok(live()[0].size === 2 * 3, `at its own size times its row's largest axis (${live()[0].size})`);
  holder.stand('place/b', markB, { x: 50, y: 1, z: 0, q: [0, 0, 0, 1] });
  holder.update({ x: 10, y: 0, z: 0 }, 1);
  ok(prepares === 1 && live().length === 2 && live()[1].contained, 'a file made ready once places the next at once, and a mark in a room is placed as contained');
  // Between looks nothing is asked: the clock.
  const n = log.length;
  holder.update({ x: 5000, y: 0, z: 0 }, 0.01);
  ok(log.length === n, 'between looks nothing at all');
  holder.update({ x: 0, y: 0, z: ATTACH_TUNE.reach * 1.05 }, 1);
  ok(live().length === 2, 'past the reach but inside its slack, an effect stands');
  holder.update({ x: 0, y: 0, z: ATTACH_TUNE.reach * ATTACH_TUNE.slack + 60 }, 1);
  ok(live().length === 0 && holder.placed === 0, 'past the slack, taken away');
  holder.update({ x: 10, y: 0, z: 0 }, 1);
  ok(live().length === 2 && prepares === 1, 'and placed again coming back, with no file made ready again');
}

// ---- The editor's hand on a row and on one attachment. ----
{
  const h = live().find((x) => !x.contained)!;
  const m = new THREE.Matrix4().makeTranslation(100, 0, 0);
  holder.follow('place/a', m);
  ok(near(h.m.elements[12], 100) && near(h.m.elements[13], 1), "a row the editor moves carries its effect (its scale held as it was given)");
  const s = [...sounds.values()][0];
  ok(near(s.x, 100), 'and its sound');
  holder.restore('place/a');
  ok(near(h.m.elements[12], 0) && near(s.x, 0), 'put back where it was stood when the edit ends');
  const local = new THREE.Matrix4().makeTranslation(0, 5, 0);
  holder.followItem('place/a', 0, local, { v: 2 });
  ok(near(h.m.elements[13], 15) && !h.gone, "one attachment moved in its model's frame, nothing stood again (5 m up a model three times its height)");
  const placedBefore = placed.length;
  holder.followItem('place/a', 0, local, { v: 4 });
  const again = live().find((x) => !x.contained)!;
  ok(!h.gone && again === h && h.size === 4 * 3 && placed.length === placedBefore && log[log.length - 1] === `resize ${h.file} 12`, "a size moved sizes the standing effect in place, nothing placed again (C held: it plays on at the size being dialled)");
  const steps = log.length;
  holder.followItem('place/a', 0, local, { v: 4 });
  ok(!log.slice(steps).some((l) => l.startsWith('resize') || l.startsWith('place') || l.startsWith('remove')), 'and a step that leaves the size as it is asks nothing of the effect');
  const list = holder.handleList();
  ok(list.count === 3 && list.kind[1] === 1 && list.radius[1] === 12 && list.mark[2] === 1 && list.id[2] === 'b' && list.item[1] === 1, 'the handles: every attachment, a sound\'s kind and its full-volume radius, a mark\'s marked, its row\'s id and its index');
  ok(holder.handleList() === list, 'the same list, written only when something moved');
}

// ---- Dropping, the world going, the preview. ----
{
  holder.drop('place/a');
  ok(sounds.size === 0 && live().filter((x) => !x.contained).length === 0, "a row taken away takes its effects and sounds with it");
  // A file asked for in one world and answered after it went places nothing in the next.
  holder.stand('place/c', { id: 'c', kind: 'mark', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], attach: [{ fx: 'props:particles/smoke.json' }] } as PlacementRow, { x: 0, y: 0, z: 0, q: [0, 0, 0, 1] });
  holder.update({ x: 0, y: 0, z: 0 }, 1);
  ok(pending.length === 1, 'a new file asked to be made ready');
  holder.clear();
  ok(holder.rows === 0 && live().length === 0, 'the world going lets everything go while the particles still stand');
  await flush();
  ok(live().length === 0, 'and an answer that comes after it places nothing');
  holder.previewSet('props:particles/smoke.json', 1);
  ok(pending.length === 1 && live().length === 0, "the editor's preview is made ready first (the world's going forgot the file), never placed on a live frame");
  holder.previewMove(new THREE.Matrix4().makeTranslation(3, 4, 5));
  await flush();
  ok(live().length === 1 && near(live()[0].m.elements[13], 4), 'then placed where the hand last put it');
  holder.previewMove(new THREE.Matrix4().makeTranslation(7, 4, 5));
  ok(near(live()[0].m.elements[12], 7), 'and moved with the hand');
  holder.previewClear();
  ok(live().length === 0, 'and taken away with it');
  holder.previewSet('props:particles/smoke.json', 0);
  ok(live().length === 0 && pending.length === 0, 'a preview size of nought shows none');
  holder.previewSet('none:x.json', 1);
  ok(pending.length === 0, 'and a pack this install has not got shows none');
}

console.log(`\nrowAttach: ${checks} checks passed`);
