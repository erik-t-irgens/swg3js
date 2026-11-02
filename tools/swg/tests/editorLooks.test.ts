// The world editor's looks and attachments as the editor drives them (Map-maker II's seventh wave, `EditorLooks` in
// src/editor/editorLooks.ts): the class itself round a stand-in editor that records every write, over the real attachments'
// holder. A borrowed picture its target cannot take is refused in words before anything is written; a borrowed material is
// written behind the curtain, a tint without it; R held on a picked attachment with the mouse moving carries it live and,
// let go, writes the very attachment `attachMoved` makes of the hold, once; C held sizes the standing effect in place; a
// nudge writes the axis it names; and a mark's last attachment taken off takes the mark out of its file, where any other
// row's leaves the row standing with none. And (Map-maker II's tenth wave) one of the owner's own imported models lends no
// look: clicked with the picker armed or chosen in the library, it is refused in words and nothing is written.
//
// Run: node tools/swg/tests/editorLooks.test.ts
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { EditorLooks, type LooksHost } from '../../../src/editor/editorLooks.ts';
import { attachMoved, withAttachmentAt } from '../../../src/editor/lookPick.ts';
import { ATTACH_TUNE, RowAttachments } from '../../../src/world/rowAttach.ts';
import { placementKey, type PlacementRow, type RowAttach, type RowLook } from '../../../src/story/placements.ts';
import type { RowChange } from '../../../src/editor/undo.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// A lamp whose body draws no picture and whose glass does, and a sign whose face lends one.
const named = (name: string, map: boolean): THREE.MeshStandardMaterial => {
  const m = new THREE.MeshStandardMaterial();
  m.name = name;
  if (map) m.map = new THREE.Texture();
  return m;
};
const geo = new THREE.BoxGeometry(1, 1, 1);
const lampPrims = [
  { material: named('body', false), geometry: geo, cell: -1 },
  { material: named('glass', true), geometry: geo, cell: -1 },
];
const face = named('face', true);

const rows = new Map<string, PlacementRow>();
const put = (r: PlacementRow) => rows.set(r.id, r);
put({ id: 'lamp-1', kind: 'prop', pack: 'world', model: 'lamp', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], attach: [{ fx: 'props:particles/fire.json', at: [0, 1, 0] }] } as PlacementRow);
put({ id: 'mark-1', kind: 'mark', x: 10, y: 0, z: 0, q: [1, 0, 0, 0], attach: [{ snd: 'sound/hum.snd' }] } as PlacementRow);
put({ id: 'mark-2', kind: 'mark', x: 20, y: 0, z: 0, q: [1, 0, 0, 0], attach: [{ snd: 'sound/hum.snd' }, { fx: 'props:particles/smoke.json' }] } as PlacementRow);

// The real holder, over a host that records what the particles are asked.
const asked: string[] = [];
const holder = new RowAttachments<{ file: string; size: number }>({
  fileOf: (ref) => ref.replace(':', '/'),
  prepare: async () => true,
  place: (file, _m, _c, size) => {
    asked.push(`place ${size}`);
    return { file, size };
  },
  move: () => {},
  resize: (h, size) => {
    h.size = size;
    asked.push(`resize ${size}`);
  },
  remove: () => asked.push('remove'),
  sound: () => {},
  soundMove: () => {},
  soundOff: () => {},
});
for (const r of rows.values()) holder.stand(placementKey(r.id), r, { x: r.x, y: r.y, z: r.z, q: [0, 0, 0, 1] });
holder.update({ x: 0, y: 0, z: 0 }, 1);
await new Promise((r) => setTimeout(r, 0));

// The stand-in editor: the keys, the cursor, the files' rows, and every write recorded.
const held = new Set<string>();
const pressed = new Set<string>();
const input = { held: (a: string) => held.has(a), pressedAction: (a: string) => pressed.has(a), mouseDX: 0, mouseDY: 0 };
const writes: { label: string; changes: RowChange[] }[] = [];
const said: { words: string; ok: boolean }[] = [];
const curtains: string[] = [];
let picked: string[] = [];
// A piece of one of the owner's own imported models (the tenth wave), which lends no look.
const importedPiece = named('hut:Paint', true);
let donorPacksUsed = 0;
const stream = {
  placedOf: (key: string) => (rows.has(key.replace(/^place\//, '')) ? { model: 'lamp', pack: undefined } : null),
  modelFor: async () => ({ primitives: lampPrims }),
  loadedModelOf: () => ({ primitives: lampPrims }),
  lookOf: (mats: readonly RowLook[] | undefined) => (mats ? { mats, sig: '' } : undefined),
  loadLook: async () => {},
  donorOf: (ref: string) => (ref === 'props:sign/face' ? { material: face, geometry: geo, skinned: false } : null),
  donorRefOf: (m: THREE.Material) => (m === face ? 'props:sign/face' : null),
  donorIsImported: (m: THREE.Material) => m === importedPiece,
  useDonorPack: () => void donorPacksUsed++,
};
const host: LooksHost = {
  input: input as never,
  point: () => false,
  pointer: () => ({ x: 0, y: 0, over: true }),
  rowFor: (id) => {
    const row = rows.get(id);
    return row ? { row, layer: 'world', label: id } : null;
  },
  picked: () => picked,
  pickOnly: (id) => {
    picked = id ? [id] : [];
  },
  putRows: async (label, changes) => {
    writes.push({ label, changes });
    return `${label}: written`;
  },
  say: (words, ok) => said.push({ words, ok }),
  stream: () => stream as never,
  attachments: () => holder as never,
  frame: () => 'game',
  centre: () => null,
  curtain: async (detail, work) => {
    curtains.push(detail);
    return work();
  },
  grid: () => 0.25,
  refresh: () => {},
};
const looks = new EditorLooks(host);

// ---- Looks: refused before a write, the curtain for a borrowed material alone. ----
{
  picked = ['lamp-1'];
  const refused = await looks.setLook('body', { map: 'props:sign/face' }, 'borrow a picture');
  ok(writes.length === 0 && /has no picture to take another's/.test(refused) && said.some((s) => !s.ok && /has no picture/.test(s.words)), `a borrowed picture onto a material with no picture is refused in words, nothing written ("${refused}")`);
  await looks.setLook('glass', { map: 'props:sign/face' }, 'borrow a picture');
  ok(writes.length === 1 && curtains.length === 0 && JSON.stringify(writes[0].changes[0].after?.mats) === '[{"of":"glass","map":"props:sign/face"}]', 'one it can take is written as one change of the row, with no curtain (a picture keeps its program)');
  await looks.setLook('body', { tint: '#C04020' }, 'tint');
  ok(writes.length === 2 && curtains.length === 0 && JSON.stringify(writes[1].changes[0].after?.mats) === '[{"of":"body","tint":"#c04020"}]', 'a tint likewise, written as the file spells it');
  await looks.setLook('glass', { like: 'props:sign/face' }, 'borrow a material');
  ok(writes.length === 3 && curtains.length === 1 && JSON.stringify(writes[2].changes[0].after?.mats) === '[{"of":"glass","like":"props:sign/face"}]', 'a borrowed material is written behind the editor\'s curtain (it may need a program of its own)');
  picked = [];
}

// ---- One of the owner's own imported models lends no look (the tenth wave): refused in words whichever way it is offered. ----
{
  writes.length = 0;
  said.length = 0;
  picked = ['lamp-1'];
  looks.armPick('glass', 'texture');
  const clicked = await looks.pickFrom(importedPiece);
  ok(writes.length === 0 && /imported models lends no picture or material/.test(clicked) && said.some((s) => !s.ok && s.words === clicked), `a surface of an imported model clicked with the picker armed is refused in words, nothing written ("${clicked}")`);
  let asked = 0;
  const importsPack = { imported: true, root: '/imports-private/', model: async () => void asked++ };
  const offered = await looks.offerEntry('TEST hut', importsPack as never, 'imports-private', 'hut');
  ok(writes.length === 0 && /imported models lends no picture or material/.test(offered) && asked === 0 && donorPacksUsed === 0, 'and so is an imported model chosen in the library, before its pack is lent or its model loaded');
  await looks.pickFrom(face);
  ok(writes.length === 1 && JSON.stringify(writes[0].changes[0].after?.mats) === '[{"of":"glass","map":"props:sign/face"}]', "and the picker, still armed, takes the game's own surface clicked after");
  picked = [];
}

// ---- R held on a picked attachment: carried live, and written once as `attachMoved` makes it. ----
{
  writes.length = 0;
  looks.pickAttachment('lamp-1', 0);
  held.add('placeTurn');
  let turned = 0;
  for (const dx of [12, -3, 20, 7]) {
    input.mouseDX = dx;
    input.mouseDY = 0;
    turned += dx * ATTACH_TUNE.turnPerPx;
    looks.keys();
  }
  ok(looks.takesMouse && writes.length === 0 && input.mouseDX === 0, 'a hold under way has the mouse (the camera holds still) and writes nothing');
  held.delete('placeTurn');
  input.mouseDX = 0;
  looks.keys();
  await new Promise((r) => setTimeout(r, 0));
  const base = rows.get('lamp-1')!.attach![0];
  const want = withAttachmentAt(rows.get('lamp-1')!, 0, attachMoved(base, { dx: 0, dy: 0, dz: 0, turn: turned, size: 1 }));
  ok(writes.length === 1 && writes[0].label === 'move an attachment' && JSON.stringify(writes[0].changes[0].after) === JSON.stringify(want) && !looks.takesMouse, `let go, the attachment is written once, exactly as the hold moved it (${JSON.stringify(writes[0]?.changes[0].after?.attach)})`);
}

// ---- C held: the standing effect sized in place, never placed again. ----
{
  writes.length = 0;
  asked.length = 0;
  held.add('editorScale');
  for (const dy of [-30, -40]) {
    input.mouseDX = 0;
    input.mouseDY = dy;
    looks.keys();
  }
  ok(asked.length > 0 && asked.every((a) => a.startsWith('resize')) && writes.length === 0, `C held sizes the standing effect where it plays, frame by frame, and places nothing again (${asked.join('; ')})`);
  held.delete('editorScale');
  input.mouseDY = 0;
  looks.keys();
  await new Promise((r) => setTimeout(r, 0));
  const size = writes[0]?.changes[0].after?.attach?.[0].size ?? 0;
  ok(writes.length === 1 && Math.abs(size - Number(Math.exp(70 * ATTACH_TUNE.sizePerPx).toFixed(4))) < 1e-9, `and let go the size is written once (${size})`);
}

// ---- A nudge: along the row's own axes, a grid step. ----
{
  writes.length = 0;
  looks.pickAttachment('lamp-1', 0);
  pressed.add('editorNudgeFwd');
  looks.keys();
  pressed.clear();
  pressed.add('editorNudgeUp');
  looks.keys();
  pressed.clear();
  await new Promise((r) => setTimeout(r, 0));
  const at0 = rows.get('lamp-1')!.attach![0].at ?? [0, 0, 0];
  const fwd = writes[0]?.changes[0].after?.attach?.[0].at;
  const up = writes[1]?.changes[0].after?.attach?.[0].at;
  ok(writes.length === 2 && JSON.stringify(fwd) === JSON.stringify([at0[0], at0[1], at0[2] - 0.25]) && JSON.stringify(up) === JSON.stringify([at0[0], at0[1] + 0.25, at0[2]]), `forward nudges it a grid step along its model's -z, up a step along its +y (${JSON.stringify(fwd)}, ${JSON.stringify(up)})`);
}

// ---- Taken off: a mark's last takes the mark out, any other row's leaves the row. ----
{
  writes.length = 0;
  await looks.removeAttachment('mark-1', 0);
  ok(writes.length === 1 && writes[0].label === 'take a mark out' && writes[0].changes[0].after === null, 'a mark\'s only attachment taken off takes the mark out of its file (a mark with nothing is no row)');
  await looks.removeAttachment('mark-2', 1);
  const kept = writes[1]?.changes[0].after as PlacementRow | null;
  ok(writes.length === 2 && !!kept && kept.kind === 'mark' && kept.attach?.length === 1 && (kept.attach[0] as RowAttach).snd === 'sound/hum.snd', 'one of a mark\'s two taken off leaves the mark with the other');
  await looks.removeAttachment('lamp-1', 0);
  const lamp = writes[2]?.changes[0].after as PlacementRow | null;
  ok(writes.length === 3 && !!lamp && lamp.attach === undefined && lamp.model === 'lamp', 'and a row\'s last taken off leaves the row standing with none');
}

console.log(`\neditorLooks: ${checks} checks passed`);
