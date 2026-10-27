// Map-maker II's groundwork (DESIGN.md §2.3, W0): the world editor's Tools list. One tool armed at a time, arming another
// disarms the first and a tool's key is a toggle; Escape, a thing taken in hand, the world going and leaving the editor
// let whatever is armed go (the editor's own calls, read as text, since the editor's entry does not load in node); while a
// tool is armed no click picks, no press boxes and the right button does not orbit, and with rows picked C held moves no
// row and the wheel steps no grid -- the holds come back the frame it is put down (the real editing class, round the
// stand-in editor of `editsHarness.ts`); and the scatter brush through the list paints and erases exactly the stroke it
// paints and erases on its own, by `Object.is` over every row written.
//
// Run: node tools/swg/tests/tools.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeHarness, propRow } from './editsHarness.ts';
import { ToolList, toolFrame, type ToolDef } from '../../../src/editor/tools.ts';
import { EditorBrush, brushNearOf, scatterTool, type BrushHost } from '../../../src/editor/editorBrush.ts';
import { libraryView, type LibraryEntry } from '../../../src/editor/libraryModel.ts';
import { marksView } from '../../../src/ui/editorMarks.ts';
import type { PlacementRow } from '../../../src/story/placements.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** A stand-in tool: armed and let go on its word, counting its frames. */
function standIn(id: string): ToolDef & { steps: number } {
  let armed = false;
  const t = {
    id,
    action: null,
    label: `tool ${id}`,
    steps: 0,
    armed: () => armed,
    arm: async () => {
      armed = true;
      return `${id} armed`;
    },
    disarm: () => {
      armed = false;
    },
    step() {
      t.steps++;
    },
    draw() {},
    owns: (b: string) => b === 'apply' || b === 'inverse',
  };
  return t as unknown as ToolDef & { steps: number };
}

{
  const list = new ToolList();
  const a = list.add(standIn('a'));
  const b = list.add(standIn('b'));
  let threw = false;
  try {
    list.add(standIn('a'));
  } catch {
    threw = true;
  }
  ok(threw, 'two tools of one name are refused');
  await list.arm('a');
  ok(a.armed() && !b.armed() && list.armedTool === a && list.toolArmed(), 'one tool armed');
  await list.arm('b');
  ok(!a.armed() && b.armed() && list.armedTool === b, 'arming another lets the first go');
  ok((await list.arm('b')) === 'tool b let go' && !list.toolArmed(), "a tool's key again lets it go (a toggle)");
  await list.arm('a');
  ok(list.disarmAll() && !list.toolArmed() && !list.disarmAll(), 'disarmAll lets whatever is armed go, and says whether anything was');
  ok((await list.arm('nope')) === 'no tool called nope', 'a tool that is not in the list is said so');
  const rep = list.report(() => 'X');
  ok(rep.length === 2 && rep[0].id === 'a' && rep.every((r) => r.armed === false), 'the report lists every tool, its key and whether it is armed');
}

{
  // The editor's own calls: Escape, a thing taken in hand, the world going and leaving the editor each let the tool go.
  // Line endings folded (this checkout's working copies may be CRLF): a method's body ends at `\n  }\n`, and read unfolded it ran to the file's end.
  const src = readFileSync(new URL('../../../src/editor/editorEntry.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const body = (name: RegExp): string => {
    const m = name.exec(src);
    if (!m) return '';
    const start = m.index;
    const end = src.indexOf('\n  }\n', start);
    return src.slice(start, end);
  };
  ok(/this\.tools\.disarmAll\(\)/.test(body(/\n  escape\(\): boolean \{/)), 'Escape lets the armed tool go');
  ok(/this\.tools\.disarmAll\(\)/.test(body(/\n  worldGone\(\): void \{/)), 'the world going lets the armed tool go');
  ok(/this\.tools\.disarmAll\(\)/.test(body(/\n  private leaveBody\(/)), 'leaving the editor lets the armed tool go');
  ok(/this\.tools\.disarmAll\(\)/.test(body(/\n  (private )?(async )?take\(/)), 'a thing taken in hand lets the armed tool go');
  ok(/toolArmed: \(\) => me\.tools\.toolArmed\(\),/.test(src), 'the editing is told a tool is armed (the list, not the brush alone)');
  ok(/if \(this\.edits\.takesMouse && !armedTool\) this\.edits\.wheelStep\(-wheel\);/.test(src), "the wheel steps a hold's grid only while no tool is armed");
  ok(/else if \(armedTool\?\.size && input\.held\('editorScale'\)\)/.test(src), 'and C held with the wheel sizes the armed tool');
}

{
  // While a tool is armed: no click picks, no press boxes, the right button does not orbit; with rows picked, C held moves
  // no row (no hold is taken); put down, the hold comes back.
  let armed = false;
  const fly = makeHarness({ rows: [propRow('a', 0, 0)], toolArmed: () => armed });
  fly.e.sel.pick(['a'], 'set');
  armed = true;
  fly.input.heldActs.add('altAttack');
  fly.step();
  ok(!(fly.e as unknown as { orbiting: boolean }).orbiting, 'the right button does not orbit the selection with a tool armed');
  fly.input.heldActs.delete('altAttack');
  fly.step();
  const before = fly.rowOf('a')!;
  fly.input.heldActs.add('editorScale');
  for (let i = 0; i < 20; i++) {
    fly.input.mouseDY = -8;
    fly.step();
  }
  fly.input.mouseDY = 0;
  fly.input.heldActs.delete('editorScale');
  fly.step();
  await fly.settle();
  ok(fly.e.takesMouse === false && fly.rowOf('a')!.scale === before.scale && fly.batches.length === 0, 'with rows picked and a tool armed, C held and the mouse move no row and write nothing');
  ok(fly.e.sel.has('a'), 'and what is picked stays picked');
  armed = false;
  fly.input.heldActs.add('editorScale');
  fly.step();
  const takes = fly.e.takesMouse;
  for (let i = 0; i < 20; i++) {
    fly.input.mouseDY = -8;
    fly.step();
  }
  fly.input.mouseDY = 0;
  fly.input.heldActs.delete('editorScale');
  fly.step();
  await fly.settle();
  ok(takes && fly.rowOf('a')!.scale !== undefined, 'put down, C held takes its hold on the picked row again and scales it');
  const point = makeHarness({ rows: [propRow('a', 0, 0)], point: true, toolArmed: () => true });
  point.pointer.pressed = 1;
  point.pointer.buttons = 1;
  point.step();
  ok(!(point.e as unknown as { boxing: boolean }).boxing, 'a press in Point begins no box with a tool armed');
  point.pointer.buttons = 0;
  point.pointer.clicked = true;
  point.step();
  ok(point.e.sel.size === 0, 'and a click picks nothing');
}

{
  // The scatter brush through the list paints and erases the very stroke it does on its own: two harnesses over the same
  // files, one brush driven by its own frame and one by the list's tool frame, the stroke's seed alike (the clock held).
  const propEntry = (id: string): LibraryEntry => ({ s: 'props', p: 'props', id, m: '', n: null, g: '', t: null, sz: [0, 0, 0], tri: 0, pic: null, f: 0 });
  const VIEW = libraryView([propEntry('chair')]);
  const hostOver = (hh: ReturnType<typeof makeHarness>): BrushHost => ({
    edits: hh.e,
    source: async (key) => ({ key, id: 'chair', src: { kind: 'prop', pack: 'props', thing: 'chair', template: 'object/tangible/test/shared_chair.iff' } as never, bounds: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }, water: false }),
    near: (cx, cz, reach, keys) => brushNearOf({ view: VIEW, here: 'tatooine', rows: hh.host.standing(), placedOfRow: () => null, forEachPlacedIn: () => {}, boxOf: () => null }, cx, cz, reach, keys),
    ground: () => 0,
    water: () => Number.NaN,
    centre: () => ({ x: 0, z: 0 }),
    frame: () => 'raw',
    packId: () => 'tatooine',
    inSpace: () => false,
    dest: () => 'world',
    cameraYaw: () => 0,
    say: () => {},
  });
  const realNow = Date.now;
  Date.now = () => 1_800_000_000_000;
  try {
    const run = async (viaList: boolean): Promise<{ painted: PlacementRow[]; erased: PlacementRow[] }> => {
      const h = makeHarness({ rows: [propRow('old', 50, 50)] });
      const brush = new EditorBrush(hostOver(h));
      brush.set.set('props:chair', 1);
      const list = new ToolList();
      const tool = list.add(scatterTool(brush, () => brush.arm(null)));
      if (viaList) await list.arm('brush');
      else await brush.arm(null);
      const f = toolFrame();
      const frame = (apply: boolean, inverse: boolean) => {
        if (viaList) {
          f.apply = apply;
          f.inverse = inverse;
          f.x = 0;
          f.z = 0;
          f.valid = true;
          f.dt = 1 / 30;
          tool.step(f);
        } else {
          brush.ask.paint = apply;
          brush.ask.erase = inverse;
          brush.ask.cx = 0;
          brush.ask.cz = 0;
          brush.ask.valid = true;
          brush.ask.dt = 1 / 30;
          brush.frame();
        }
      };
      for (let i = 0; i < 30; i++) {
        frame(true, false);
        await h.settle();
      }
      frame(false, false);
      await h.settle();
      const painted = [...h.rowsOf('world').values()];
      for (let i = 0; i < 4; i++) {
        frame(false, true);
        await h.settle();
      }
      frame(false, false);
      await h.settle();
      const d = { marks: marksView(), radius: 0.5, ring() {} };
      tool.draw(d);
      return { painted, erased: [...h.rowsOf('world').values()] };
    };
    const own = await run(false);
    const listed = await run(true);
    const same = (a: PlacementRow[], b: PlacementRow[]) => a.length === b.length && a.every((r, i) => JSON.stringify(r) === JSON.stringify(b[i]) && Object.is(r.x, b[i].x) && Object.is(r.y, b[i].y) && Object.is(r.z, b[i].z));
    ok(own.painted.length > 1 && same(own.painted, listed.painted), `the scatter brush through the list paints the stroke it paints on its own, every row by Object.is (${own.painted.length - 1} painted)`);
    ok(same(own.erased, listed.erased) && own.erased.length < own.painted.length, `and erases what it erases on its own (${own.painted.length - own.erased.length} taken)`);
  } finally {
    Date.now = realNow;
  }
}

console.log(`\ntools: ${checks} checks passed`);
