// What the `spawns` command writes for a standing person, a creature and a camp (pack format 2).
//
// The rules are pure (`tools/swg/spawnpack.mjs`), so this runs the real ones on rows, rooms and client
// data written here in the shapes the real ones use. Where the owner's packs are converted it then
// reads them and says what they hold, which is how the claims in the pack's own comments stay observed.
//
// Run: node tools/swg/tests/spawnPack.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { form, chunk, W, encode } from './iffWriter.ts';
import { loadBuildouts, mergeBuildouts } from '../buildout.mjs';
import { parseIff } from '../iff.mjs';
import { readClientChildren } from '../clientfx.mjs';
import { settleStatics } from '../core3.mjs';
import { SPAWNS_FORMAT, bodyFor, campPieces, drawnWho, gameOf, packRow, roomsOf } from '../spawnpack.mjs';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}

// ------------------------------------------------------------------ a buildout room, found by the id its table wrote
{
  // A buildout area with a building turned a quarter round, its cell (the table's own id -8), and the
  // snapshot it merges into. The server named that cell -8; the merge renumbers it.
  const dt = (cols: string[], types: string[], rows: W[]) =>
    Buffer.from(encode(form('DTII', form('0001',
      chunk('COLS', cols.reduce((w, c) => w.str(c), new W().i32(cols.length)).bytes()),
      chunk('TYPE', types.reduce((w, t) => w.str(t), new W()).bytes()),
      chunk('ROWS', new Uint8Array([...new W().i32(rows.length).bytes(), ...rows.flatMap((r) => [...r.bytes()])]))))));
  const names = ['object/building/tatooine/shared_cave.iff', 'object/cell/shared_cell.iff'];
  const crcs = [0x11111111, 0x22222222];
  const stng: number[] = [];
  const offsets: number[] = [];
  for (const n of names) {
    offsets.push(stng.length);
    for (const ch of n) stng.push(ch.charCodeAt(0));
    stng.push(0);
  }
  const cstb = Buffer.from(encode(form('CSTB', form('0000', chunk('DATA', new W().i32(2).bytes()), chunk('CRCT', crcs.reduce((w, c) => w.u32(c), new W()).bytes()), chunk('STRT', offsets.reduce((w, o) => w.i32(o), new W()).bytes()), chunk('STNG', new Uint8Array(stng))))));
  const cols = ['objid', 'container', 'shared_template_crc', 'cell_index', 'px', 'py', 'pz', 'qw', 'qx', 'qy', 'qz', 'radius', 'portal_layout_crc'];
  const types = ['i', 'i', 'i', 'i', 'f', 'f', 'f', 'f', 'f', 'f', 'f', 'f', 'i'];
  const row = (objid: number, container: number, crc: number, cell: number, px: number, py: number, pz: number, qw: number, qy: number, pob: number) =>
    new W().i32(objid).i32(container).i32(crc | 0).i32(cell).f32(px).f32(py).f32(pz).f32(qw).f32(0).f32(qy).f32(0).f32(30).i32(pob);
  const s2 = Math.SQRT1_2;
  const files = new Map<string, Buffer>([
    ['datatables/buildout/areas_tatooine.iff', dt(['area', 'x1', 'z1', 'x2', 'z2', 'eventRequired'], ['s', 'f', 'f', 'f', 'f', 's'], [new W().str('cave').f32(1000).f32(2000).f32(1100).f32(2100).str('')])],
    ['datatables/buildout/tatooine/cave.iff', dt(cols, types, [row(-7, 0, crcs[0], 0, 10, 50, 20, s2, s2, 0x99), row(-8, -7, crcs[1], 3, 0, 0, 0, 1, 0, 0)])],
    ['misc/object_template_crc_string_table.iff', cstb],
  ]);
  const vfs = { has: (p: string) => files.has(p), read: (p: string) => files.get(p)! };
  const b = loadBuildouts(vfs, 'tatooine');
  ok(b.nodes.some((n: { rawId?: number }) => n.rawId === -8), 'a buildout node keeps the id its table wrote beside the one it is given');
  const snap = mergeBuildouts({ version: '0001', templates: [], nodes: [] }, b);
  const rooms = roomsOf(snap);
  const room = rooms.get(-8);
  ok(!!room && room.cellIndex === 3 && Math.abs(room.pos[0] - 1010) < 1e-3 && Math.abs(room.pos[2] - 2020) < 1e-3, 'and its cell is found by that id, as the server named it, with its building\'s own place');
  // A person two metres along the room's own x, in that room, as the server wrote them.
  const person = { key: 'k1', who: 'squill', x: 2, y: 0.5, z: 0, heading: 0, cell: -8, respawn: 300, gated: false, where: 'caves', from: 'call' };
  const joined = new Map([['squill', { id: 'squill_body' }]]);
  const got = packRow(person, { joined, rooms, pools: new Map() });
  ok(!!got.row && got.row.room === 3 && Math.abs(got.row.x - 1010) < 1e-3 && Math.abs(got.row.z - 2018) < 1e-3 && got.row.y === 50.5, `so the people in a buildout's rooms stand in them (${got.row?.x.toFixed(2)}, ${got.row?.y}, ${got.row?.z.toFixed(2)})`);
  ok(packRow({ ...person, cell: 999 }, { joined, rooms, pools: new Map() }).lost === 'room', 'and a person in a room nobody holds is left out, said why');
  ok(packRow({ ...person, who: 'nobody' }, { joined, rooms, pools: new Map() }).lost === 'body', 'as is one this game has no body for');
}

// ------------------------------------------------------------------ the rows: keys, draws, both sides, routes
{
  const raw = [
    { world: 'naboo', who: null, respawn: 1, x: 10, y: 5, z: 10, heading: 0, cell: 0, still: true, peaceful: true, draw: [['Town.commoners', 0.8], ['Town.npcs', 0.2]], gated: false, where: 'cities', from: 'stationary' },
    { world: 'naboo', who: 'imp', respawn: 300, x: 20, y: 5, z: 20, heading: 90, cell: 0, still: true, gcw: [{ who: 'imp', mood: 'npc_imperial' }, { who: 'reb', mood: 'calm' }], gated: false, where: 'cities', from: 'gcw' },
    { world: 'naboo', who: 'droid', respawn: 0, x: 30, y: 5, z: 30, heading: 0, cell: 0, route: [{ x: 30, y: 5, z: 30, cell: 0, linger: false }, { x: 1, y: 0, z: 0, cell: 77, linger: true }], gated: false, where: 'cities', from: 'patrol' },
  ];
  type Settled = { key: string; from: string; x: number; z: number };
  const settled = settleStatics('naboo', raw).rows as Settled[];
  const reordered = settleStatics('naboo', [...raw].reverse()).rows as Settled[];
  // Each row against the same row read in the other order, not the set of keys against the set: a key
  // made from where a row sits in the file keeps the set and changes every row's own.
  ok(settled.every((r) => reordered.find((o) => o.from === r.from)?.key === r.key), 'a row\'s key is its own whatever order the rows are read in');
  const pools = new Map([['Town.commoners', ['commoner', 'no_body_here']], ['Town.npcs', ['artisan']]]);
  const joined = new Map<string, { id: string; bodies?: string[]; dress?: string[] }>([
    ['commoner', { id: 'c1', bodies: ['c1', 'c2', 'c3'], dress: ['commoner'] }],
    ['artisan', { id: 'a1' }],
    ['imp', { id: 'imp_body' }],
    ['reb', { id: 'reb_body' }],
    ['droid', { id: 'droid_body' }],
  ]);
  // A room turned a quarter round about the vertical: a point a metre along its own x is a metre along
  // the world's -z, which a route carried out without the turn would put a metre along +x instead.
  const q = [Math.cos(Math.PI / 4), 0, Math.sin(Math.PI / 4), 0];
  const rooms = new Map([[77, { cellIndex: 2, q, pos: [500, 10, 600] }]]);
  const [spot, guard, droid] = settled.map((r) => packRow(r, { joined, rooms, pools }).row);
  ok(spot.who === 'commoner' || spot.who === 'artisan', `a stationary spot stands somebody drawn from its lists (${spot.who})`);
  ok(packRow(settled[0], { joined, rooms, pools }).row.id === spot.id && packRow(settled[0], { joined, rooms, pools }).row.who === spot.who, 'and the same somebody every time the row is packed');
  ok(spot.who !== 'no_body_here', 'never a name this game has no body for');
  ok(spot.still && spot.peaceful && JSON.stringify(spot.draw) === JSON.stringify(raw[0].draw), 'the spot keeps its lists for the runtime to draw from again, and that the server stood it still and unstrikeable');
  ok(guard.who === 'imp' && guard.id === 'imp_body' && guard.gcw[1].id === 'reb_body' && guard.gcw[0].mood === 'npc_imperial', 'a guard stands as the Imperial side, both sides\' bodies written for the runtime to choose between');
  const rebOnly = packRow(settled[1], { joined: new Map([['reb', { id: 'reb_body' }]]), rooms, pools }).row;
  ok(rebOnly.who === 'reb' && rebOnly.mood === 'calm' && rebOnly.id === 'reb_body', 'and as the other side where the Imperial one has no body here');
  const at = droid.route[1];
  ok(droid.route.length === 2 && at.room === 2 && Math.abs(at.x - 500) < 1e-6 && Math.abs(at.z - 599) < 1e-6 && at.y === 10 && at.linger === true, `a route's point in a room is carried out of it through the room's own turn, like a person's place (${at.x.toFixed(3)}, ${at.z.toFixed(3)})`);
  const lostRoute = packRow(settled[2], { joined, rooms: new Map(), pools }).row;
  ok(!lostRoute.route && lostRoute.routeLost === true, 'and a route through a room nobody holds is left off and said so, the walker still standing');

  // A spot that can only draw the commoners: the body is one of the group's, and the row names it.
  const onlyCommoners = { ...settled[0], draw: [['Town.commoners', 1]] };
  const c = packRow(onlyCommoners, { joined, rooms, pools }).row;
  ok(c.who === 'commoner' && ['c1', 'c2', 'c3'].includes(c.id) && c.groups?.join() === 'commoner', `a dress group's body is one of the group's, drawn by the key, and the row names the group (${c.id})`);
}

// ------------------------------------------------------------------ the draws, as draws
{
  // Asserted by what they do over many keys rather than by repeating themselves: a function that
  // always gave the first body, or ignored the key, repeats itself perfectly.
  const creature = { id: 'p', bodies: ['p', 'q', 'r'] };
  const counts = new Map<string, number>();
  for (let i = 0; i < 300; i++) counts.set(bodyFor(creature, `key-${i}`), (counts.get(bodyFor(creature, `key-${i}`)) ?? 0) + 1);
  const shares = ['p', 'q', 'r'].map((b) => (counts.get(b) ?? 0) / 300);
  ok(shares.every((s) => s > 0.22 && s < 0.45), `over 300 keys a body is drawn from every one of a creature's three, near a third each (${shares.map((s) => s.toFixed(2)).join(', ')})`);
  ok(bodyFor(creature, 'key-7') === bodyFor(creature, 'key-7') && bodyFor({ id: 'solo' }, 'key-7') === 'solo', 'the same key always draws the same one, and a creature of one body is always it');

  // Four in five from the commoners, one in five from the rest.
  const pools = new Map([['A', ['a1', 'a2']], ['B', ['b1']]]);
  const joined = new Map([['a1', {}], ['a2', {}], ['b1', {}]]);
  const who = new Map<string, number>();
  for (let i = 0; i < 1000; i++) {
    const w = drawnWho({ key: `row-${i}`, draw: [['A', 0.8], ['B', 0.2]] }, pools, joined) as string;
    who.set(w, (who.get(w) ?? 0) + 1);
  }
  const fromA = ((who.get('a1') ?? 0) + (who.get('a2') ?? 0)) / 1000;
  ok(fromA > 0.75 && fromA < 0.85, `over a thousand spots ${(fromA * 100).toFixed(1)}% draw from the list the server drew four in five from`);
  ok((who.get('a1') ?? 0) > 250 && (who.get('a2') ?? 0) > 250, `and every name in that list is drawn (${who.get('a1')} and ${who.get('a2')})`);
  ok(drawnWho({ key: 'row-3', draw: [['A', 0.8], ['B', 0.2]] }, new Map([['A', ['nobody']], ['B', ['b1']]]), joined) === 'b1', 'a list with nobody this game has a body for is passed over for the next');

  // A guard of a creature with several bodies stands its own side's own draw, so a reader of `id` and a
  // reader of `gcw` stand the same body.
  const guards = new Map([['imp', { id: 'i1', bodies: ['i1', 'i2', 'i3'] }], ['reb', { id: 'r1', bodies: ['r1', 'r2'] }]]);
  let same = 0;
  const ids = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const row = packRow({ key: `g-${i}`, who: 'imp', x: 0, y: 0, z: 0, heading: 0, cell: 0, respawn: 300, gated: false, where: 'cities', from: 'gcw', gcw: [{ who: 'imp' }, { who: 'reb' }] }, { joined: guards, rooms: new Map(), pools: new Map() }).row;
    if (row.id === row.gcw[0].id) same++;
    ids.add(row.id);
  }
  ok(same === 100 && ids.size === 3, `over a hundred guards the body stood is the Imperial side's own every time (${same}), and all three of its bodies stand`);
}

// ------------------------------------------------------------------ a creature's own numbers
{
  const entry = { kind: 'npc', stats: { sizeClass: 'medium', reach: 2, aggression: 'defensive', ranged: null, attackCooldown: 1.6, tags: [] } };
  const low = gameOf({ name: 'child', level: 8, ham: [180, 200], damage: [20, 30], pvp: ['ATTACKABLE'], creature: [], weapons: ['unarmed'] }, entry);
  const high = gameOf({ name: 'elder', level: 116, ham: [30000, 35000], damage: [800, 900], pvp: ['AGGRESSIVE', 'ATTACKABLE', 'ENEMY'], creature: ['PACK'], weapons: ['tusken_ranged', 'tusken_melee'] }, entry);
  ok(!!low && !!high && high.level === 116 && low.level === 8 && high.hp > low.hp * 5 && high.damage > low.damage, `two creatures drawn as one body keep their own numbers (${low?.hp} and ${high?.hp} health, ${low?.damage} and ${high?.damage} a blow)`);
  ok(high?.aggression === 'aggressive' && low?.aggression === 'defensive' && high.attackable && low.attackable, 'and their own temper');
  ok(high?.ranged !== null && low?.ranged === null, 'the one that carries a gun shoots, the one that fights with its hands does not');
  ok(gameOf({ name: 'vendor', level: 5, ham: [100, 100], damage: [1, 2], pvp: [], creature: [], weapons: [] }, entry)?.attackable === false, 'and one nobody may strike says so');
  ok(gameOf(undefined, entry) === null, 'with no record of its own a creature carries none rather than a guess');
  // KILLER and STALKER are not tempers: the server attacks a player of no faction on sight only for
  // the AGGRESSIVE bit, reads KILLER only to finish off somebody already down and STALKER only to see
  // through a mask. Read as tempers they had nine hundred of the towns' own people opening fire.
  const guard = gameOf({ name: 'guard', level: 20, ham: [900, 1000], damage: [50, 60], pvp: ['ATTACKABLE'], creature: ['KILLER', 'STALKER'], weapons: ['guard_rifle'] }, entry);
  ok(guard?.aggression === 'defensive' && guard.killer === true && guard.stalker === true, 'a body that is KILLER and STALKER but not AGGRESSIVE waits to be struck, and carries both flags beside its temper');
  const hunter = gameOf({ name: 'hunter', level: 20, ham: [900, 1000], damage: [50, 60], pvp: ['AGGRESSIVE', 'ATTACKABLE'], creature: [], weapons: [] }, entry);
  ok(hunter?.aggression === 'aggressive' && hunter.killer === undefined, 'while one whose pvp bits say AGGRESSIVE attacks on sight');
}

// ------------------------------------------------------------------ a camp's pieces, out of its client data
{
  const f17 = (vals: Record<number, number>) => {
    const w = new W();
    for (let i = 0; i < 17; i++) w.f32(vals[i] ?? 0);
    return w.bytes();
  };
  const withName = (name: string, vals: Record<number, number>) => new Uint8Array([...new W().str(name).bytes(), ...f17(vals)]);
  const cldf = encode(form('CLDF', form('0000',
    chunk('CHLD', withName('appearance/poi_corl_tent_med.apt', { 0: -1, 2: 5.5, 3: 90 })),
    chunk('CHLD', withName('appearance/eqp_camping_cot.apt', { 0: -3.4, 2: -1.4 })),
    chunk('CHL2', withName('object/static/structure/general/shared_streetlamp_small_red_style_01.iff', { 0: 5.6, 2: -5.8 })),
    chunk('CHLD', withName('appearance/pt_campfire_s01.prt', { 1: 0.2 })),
    chunk('CHLD', withName('appearance/some_droid.sat', {})),
  )));
  const children = readClientChildren(parseIff(Buffer.from(cldf)));
  const { pieces, skipped } = campPieces(children);
  ok(pieces.length === 3 && skipped === 1, `a camp is the things its client data hangs: ${pieces.length} pieces, the skinned body left out and counted`);
  ok(pieces[0].name === 'appearance/poi_corl_tent_med.apt' && pieces[0].place[2] === 5.5 && pieces[0].angles[0] === 90, 'each with its place and its turn in the camp\'s own frame, degrees as the file writes them');
  ok(pieces[2].template?.endsWith('streetlamp_small_red_style_01.iff') && !pieces.some((p: { name?: string }) => /\.prt$/.test(p.name ?? '')), 'a template child is a piece by its template, and a particle is an effect and never a piece');
}

// ------------------------------------------------------------------ the packs, where they are converted
{
  const man = join('assets-private', 'spawns', 'manifest.json');
  if (!existsSync(man)) note('no spawns pack converted here, so only the rules above were run');
  else {
    const m = JSON.parse(readFileSync(man, 'utf8'));
    if (m.format !== SPAWNS_FORMAT) note(`the spawns pack here is format ${m.format}; run spawns again for format ${SPAWNS_FORMAT}`);
    else {
      const creatures = Object.values(m.creatures) as { game?: object; bodies?: string[] }[];
      ok(creatures.filter((c) => c.game).length > creatures.length * 0.95, `nearly every creature carries its own numbers (${creatures.filter((c) => c.game).length} of ${creatures.length})`);
      const camps = Object.values(m.camps ?? {}) as unknown[][];
      ok(camps.length > 90 && camps.reduce((n, l) => n + l.length, 0) > 900, `${camps.length} camps are their pieces, ${camps.reduce((n, l) => n + l.length, 0)} of them`);
      type PackRow = { key: string; who: string; id: string; still?: boolean; gcw?: { who: string; id?: string }[] };
      const byCreature = m.creatures as Record<string, { bodies?: string[]; game?: { aggression?: string }; aggressive?: boolean }>;
      let rows = 0;
      let keys = 0;
      let still = 0;
      let guards = 0;
      let guardsOwn = 0;
      const idsOf = new Map<string, Set<string>>();
      const rowsOf = new Map<string, number>();
      for (const w of ['tatooine', 'corellia', 'naboo']) {
        const f = join('assets-private', w, 'spawns.json');
        if (!existsSync(f)) continue;
        const p = JSON.parse(readFileSync(f, 'utf8')) as { statics: PackRow[] };
        rows += p.statics.length;
        keys += new Set(p.statics.map((r) => r.key)).size;
        still += p.statics.filter((r) => r.still).length;
        ok(p.statics.every((r) => r.id && r.who), `${w}: every row names a body a format-1 reader can stand`);
        for (const r of p.statics) {
          if (!idsOf.has(r.who)) idsOf.set(r.who, new Set());
          idsOf.get(r.who)!.add(r.id);
          rowsOf.set(r.who, (rowsOf.get(r.who) ?? 0) + 1);
          const side = r.gcw?.findIndex((s) => s.who === r.who) ?? -1;
          if (side >= 0) {
            guards++;
            if (r.gcw![side].id === r.id) guardsOwn++;
          }
        }
      }
      if (rows) {
        ok(keys === rows && still > 1000, `the three busiest worlds carry ${rows} rows, each with a key of its own, ${still} of them the towns' still people`);
        ok(guards > 100 && guardsOwn === guards, `every one of their ${guards} guards stands its own side's own body (${guardsOwn})`);
        // A creature that may be several bodies and stands in a good many rows stands as more than one of them.
        const varied = [...rowsOf].filter(([who, n]) => n >= 10 && (byCreature[who]?.bodies?.length ?? 0) > 1);
        const showing = varied.filter(([who]) => (idsOf.get(who)?.size ?? 0) > 1).length;
        ok(varied.length > 5 && showing >= varied.length * 0.95, `${showing} of the ${varied.length} creatures of several bodies standing in ten rows or more stand as more than one of them`);
        ok([...idsOf].every(([who, ids]) => !byCreature[who]?.bodies || [...ids].every((id) => byCreature[who].bodies!.includes(id))), 'and every body a row stands is one of its creature\'s own');
      }
      // A creature's own temper is the server's AGGRESSIVE bit and nothing else: never KILLER or STALKER.
      const tempers = Object.values(byCreature).filter((c) => c.game);
      ok(tempers.every((c) => (c.game!.aggression === 'aggressive') === !!c.aggressive), `every creature's own temper agrees with its pvp bits (${tempers.filter((c) => c.game!.aggression === 'aggressive').length} aggressive of ${tempers.length})`);
    }
  }
}

console.log(`\nspawns pack: ${passed} checks passed`);
