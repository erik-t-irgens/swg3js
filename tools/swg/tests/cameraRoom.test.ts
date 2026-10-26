// The world editor's camera room (DESIGN.md §2.2): a free camera flies through walls, so while the editor is on the room
// is re-decided every frame by the real streamer's `cameraRoomAt` with the editor's own floor rule -- the smallest room
// whose box holds the camera *and* whose own walkable floor has a triangle under it. Over synthetic buildings: in a
// room's box with its floor under it is in the room; inside an overhanging room's box with no floor under it is outside;
// flown from one room through a wall into the next it is in the second the frame it crosses; a building whose pack
// carries no floors is taken by its box and says so. `trackCell`, which the people and the fighters follow, is
// 5a4e765's to the character (loaded out of git), and the world makes a new room state only when the answer changes.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeStreamer, THREE } from './streamHarness.ts';

const { floorUnder, roomWords } = await import('../../../src/editor/cameraRoom.ts');

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const PRE_PASS = '5a4e765';
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');

/** A floor of two triangles covering x0..x1, z0..z1 at height y, as the pack carries a floor (ten numbers a triangle). */
function floorOf(x0: number, x1: number, z0: number, z1: number, y: number): { v: number[]; t: number[] } {
  const v = [x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1];
  const t = [0, 1, 2, 0, 1, -1, -1, 1, 1, 1, 0, 2, 3, 1, 0, -1, -1, 1, 1, 1];
  return { v, t };
}

const cell = (index: number, min: number[], max: number[], floor?: { v: number[]; t: number[] }) => ({ index, name: `r${index}`, bounds: { min, max }, ...(floor ? { floor } : {}) });

/** A building standing at the origin, unturned. */
function building(id: string, cells: ReturnType<typeof cell>[]) {
  const matrix = new THREE.Matrix4();
  return { model: { def: { id, cells } }, template: id, x: 0, z: 0, radius: 20, matrix, inverse: matrix.clone() };
}

const h = await makeStreamer();
const s = h.s as { buildings: Set<unknown> };
// Room 1: 10 by 10 m, floored all over. Room 2 beside it, smaller, overhanging its hull: floored only from x 5 to 8.
const hall = building('test_hall', [cell(0, [-6, -1, -6], [13, 5, 6]), cell(1, [-5, 0, -5], [5, 4, 5], floorOf(-5, 5, -5, 5, 0)), cell(2, [5, 0, -5], [12, 4, 5], floorOf(5, 8, -5, 5, 0))]);
s.buildings.add(hall);
const out = { building: null as unknown, cell: 0, byBox: false };
const at = new THREE.Vector3();
const ask = (x: number, y: number, z: number) => h.stream.cameraRoomAt(at.set(x, y, z), out as never, floorUnder);

ask(0, 1.5, 0);
ok(out.building === hall && out.cell === 1 && !out.byBox, 'a camera in a room\'s box with its floor under it is in that room');
ask(11, 1.5, 0);
ok(out.building === null, 'inside an overhanging room\'s box with no floor under it, it is outside');
ask(0, 5.2, 0);
ok(out.building === null, 'and over a room\'s roof, outside its box, it is outside');
ask(4.8, 1.5, 0);
ok(out.cell === 1, 'flown toward the wall, it is still in the first room');
ask(5.2, 1.5, 0);
ok(out.cell === 2, 'and in the second the frame it crosses into it through the wall, with no portal crossed');
ask(-2, -3, 0);
ok(out.building === null, 'under the floor (the floor over the camera, not under it) it is outside');

s.buildings.clear();
const bare = building('test_bare', [cell(0, [-6, -1, -6], [6, 5, 6]), cell(1, [-5, 0, -5], [5, 4, 5])]);
s.buildings.add(bare);
ask(0, 1.5, 0);
ok(out.building === bare && out.cell === 1 && out.byBox, 'a building whose pack carries no floors is taken by its box');
ok(roomWords(out as never).includes('by box'), `and says so (“${roomWords(out as never)}”)`);
ask(30, 1.5, 0);
ok(roomWords(out as never) === 'outside', 'away from every building, outside');

// The floor rule on its own: a triangle with no area in plan, a corner out of the list, the low line.
{
  const f = floorOf(0, 2, 0, 2, 1);
  ok(floorUnder(f, 1, 2, 0.5, 0) && !floorUnder(f, 1, 0.5, 0.5, 0), 'a floor counts only under the camera, never over it');
  ok(!floorUnder(f, 1, 2, 0.5, 1.5), 'nor under the room box\'s own floor line');
  ok(!floorUnder({ v: [0, 0, 0], t: [0, 7, 9, 0, 0, 0, 0, 0, 0, 0] }, 0, 1, 0, -1), 'a triangle naming a corner the list has not got is passed over');
  // Ten triangles of bare corners are thirty numbers, which is also three records of ten: the floor is read by the nav's
  // own reader, which tells them apart by the numbers, never the length. Guessed by the length, the strip's far end
  // read as no floor at all.
  const v: number[] = [];
  for (let i = 0; i <= 5; i++) v.push(i, 0, 0, i, 0, 1);
  const t: number[] = [];
  for (let i = 0; i < 5; i++) t.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
  ok(t.length === 30 && floorUnder({ v, t }, 4.7, 1, 0.2, -1) && floorUnder({ v, t }, 0.3, 1, 0.8, -1), "a floor of bare corners thirty numbers long is read as ten triangles, its far end under the camera too");
}

// trackCell is 5a4e765's, to the character.
{
  const body = (text: string) => {
    const t = text.replace(/\r\n/g, '\n');
    const at = t.indexOf('  trackCell(');
    assert.ok(at >= 0, 'found trackCell');
    return t.slice(at, t.indexOf('\n  }\n', at));
  };
  let old: string | null = null;
  try {
    old = execFileSync('git', ['--no-optional-locks', 'show', `${PRE_PASS}:src/world/layoutStream.ts`], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 });
  } catch {
    old = null;
  }
  const now = readFileSync(join(root, 'src/world/layoutStream.ts'), 'utf8');
  // Where git cannot answer (a shallow or archived checkout), the body is held to the hash of PRE_PASS's own, written
  // here once out of git (line endings folded to LF), never skipped.
  const PRE_PASS_TRACKCELL = 'b84b82b251c3945c5c4ab83f26a308752d78481a6338c574449419fac5383ed9';
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  if (old) ok(body(now) === body(old) && hash(body(old)) === PRE_PASS_TRACKCELL, `trackCell, which the people and the fighters follow, is ${PRE_PASS}'s to the character`);
  else ok(hash(body(now)) === PRE_PASS_TRACKCELL, `trackCell, which the people and the fighters follow, is ${PRE_PASS}'s to the character (held to its hash: git could not show ${PRE_PASS})`);
  const world = readFileSync(join(root, 'src/world/world.ts'), 'utf8').replace(/\r\n/g, '\n');
  ok(/else if \(!now \|\| now\.building !== a\.building \|\| now\.cell !== a\.cell\) this\.cellState = \{ building: a\.building, cell: a\.cell \};/.test(world), 'and the world makes a new room state only when the answer changes');
}

console.log(`\n${checks} checks passed`);
