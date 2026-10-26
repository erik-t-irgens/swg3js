// The world editor's selection (DESIGN.md §2.6): a click picks the nearest pickable (nothing clears it), Shift with a click
// adds what is not picked and takes away what is, a box picks what has its middle inside it on the screen (Shift adds, Alt
// takes away), "all like this" picks the same thing within a reach or in the file, and the pivot is the one row's own
// origin or, for several, the bottom middle of the box round them all; each picked thing's world box is its model box at
// its scale, turned and placed, from the corners componentwise.
import assert from 'node:assert/strict';
import { Selection, boxMode, inBox, likeThis, pivotOf, worldBox } from '../../../src/editor/selection.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

{
  const s = new Selection();
  ok(s.click('a', false) && s.ids.join() === 'a', 'a click picks the row under the aim');
  ok(!s.click('a', false) && s.ids.join() === 'a', 'the same click again changes nothing');
  ok(s.click('b', false) && s.ids.join() === 'b', 'a click on another picks it in place of the first');
  ok(s.click('c', true) && s.ids.join() === 'b,c', 'Shift with a click adds what is not picked');
  ok(s.click('b', true) && s.ids.join() === 'c', 'and takes away what is');
  ok(!s.click(null, true) && s.ids.join() === 'c', 'Shift with a click on nothing changes nothing');
  const v = s.version;
  ok(s.click(null, false) && s.size === 0 && s.version > v, 'a plain click on nothing clears it, and says so by its version');
  s.pick(['x', 'y', 'z'], 'set');
  s.pick(['y'], 'take');
  s.pick(['w', 'x'], 'add');
  ok(s.ids.join() === 'x,z,w', `picks in place of, taken away and added keep the order picked (${s.ids.join()})`);
  s.keepOnly((id) => id !== 'z');
  ok(s.ids.join() === 'x,w' && !s.has('z'), 'an id naming nothing standing any more is let go');
  s.rename('w', 'w2');
  ok(s.ids.join() === 'x,w2' && s.has('w2') && !s.has('w'), 'an id renamed under it stays picked under its new name');
  ok(s.first === 'x', 'the first picked is what the bar names');
}

{
  ok(boxMode(false, false) === 'set' && boxMode(true, false) === 'add' && boxMode(false, true) === 'take' && boxMode(true, true) === 'take', 'a box picks in place of, with Shift adds, with Alt takes away');
  // A screen where a thing's middle is at (x * 10, z * 10) pixels.
  const things = [
    { id: 'a', x: 1, z: 1 },
    { id: 'b', x: 5, z: 5 },
    { id: 'c', x: 9, z: 2 },
    { id: 'behind', x: 3, z: 3 },
  ];
  const project = (t: { id: string; x: number; z: number }, out: Float64Array): boolean => {
    if (t.id === 'behind') return false;
    out[0] = t.x * 10;
    out[1] = t.z * 10;
    return true;
  };
  ok(inBox(things, { x0: 0, y0: 0, x1: 60, y1: 60 }, project).join() === 'a,b', 'a box picks what has its projected middle inside it');
  ok(inBox(things, { x0: 95, y0: 0, x1: 0, y1: 25 }, project).join() === 'a,c', 'either corner first');
  ok(!inBox(things, { x0: 0, y0: 0, x1: 100, y1: 100 }, project).includes('behind'), 'and never what is behind the eye');
}

{
  const rows = [
    { id: 'p1', pack: 'props', thing: 'chair', x: 0, z: 0 },
    { id: 'p2', pack: 'props', thing: 'chair', x: 5, z: 0 },
    { id: 'p3', pack: 'props', thing: 'chair', x: 50, z: 0 },
    { id: 'p4', pack: 'props', thing: 'table', x: 1, z: 0 },
    { id: 'w1', pack: 'world', model: 'tree', x: 2, z: 2 },
    { id: 'w2', pack: 'world', model: 'tree', from: 'naboo', x: 3, z: 3 },
    { id: 'w3', pack: 'world', model: 'tree', x: 4, z: 4 },
  ];
  ok(likeThis(rows, { pack: 'props', thing: 'chair' }, null, 0).join() === 'p1,p2,p3', 'all like this: the same props thing in the file');
  ok(likeThis(rows, { pack: 'props', thing: 'chair' }, { x: 0, z: 0 }, 10).join() === 'p1,p2', 'or within a reach of the first');
  ok(likeThis(rows, { pack: 'world', model: 'tree' }, null, 0).join() === 'w1,w3', "the same model out of the same world (another world's tree of that id is another thing)");
}

{
  const out = { x: 0, y: 0, z: 0 };
  ok(!pivotOf([], out), 'nothing picked has no pivot');
  ok(pivotOf([{ x: 3, y: 4, z: 5, lo: [2, 4, 4], hi: [4, 6, 6] }], out) && out.x === 3 && out.y === 4 && out.z === 5, "one row's pivot is its own origin");
  ok(
    pivotOf(
      [
        { x: 0, y: 1, z: 0, lo: [-1, 1, -1], hi: [1, 3, 1] },
        { x: 10, y: 2, z: 4, lo: [9, 2, 3], hi: [11, 5, 5] },
      ],
      out,
    ) &&
      out.x === 5 &&
      out.y === 1 &&
      out.z === 2,
    "several rows' pivot is the bottom middle of the box round them all",
  );
  const lo: [number, number, number] = [0, 0, 0];
  const hi: [number, number, number] = [0, 0, 0];
  // A box 2 x 1 x 4, its corners handed the other way round, scaled by 2 along X, turned a quarter about up, stood at (10, 0, 0).
  const s = Math.SQRT1_2;
  worldBox([1, 1, 2], [-1, 0, -2], 2, 1, 1, { x: 0, y: s, z: 0, w: s }, { x: 10, y: 0, z: 0 }, lo, hi);
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  ok(close(lo[0], 8) && close(hi[0], 12) && close(lo[2], -2) && close(hi[2], 2) && close(lo[1], 0) && close(hi[1], 1), `a world box takes the corners componentwise, the scale along the thing's own axes, then the turn and the place (${lo.map((v) => v.toFixed(2))} .. ${hi.map((v) => v.toFixed(2))})`);
}

console.log(`\n${checks} checks passed`);
