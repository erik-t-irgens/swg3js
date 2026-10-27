// The world editor's pointer in Point mode (DESIGN.md §2.2): a press and release within `pick.dragPx` is a click, past
// it a drag; the presses and releases are this frame's and spent at its end; the wheel is counted only from the canvas's
// own events (a wheel over the window scrolls the window and moves nothing); and nothing of the editor ever sets the
// game's `captured`, which would refuse every action and stop WASD flying. The pointer's own rules and its listeners
// are driven here exactly as the canvas drives them.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { attachPointer, endPointerFrame, notePointerDown, notePointerMove, notePointerUp, notePointerWheel, pointerRecord } from '../../../src/editor/pointer.ts';
import { EDITOR_TUNE } from '../../../src/editor/editorTune.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const drag = EDITOR_TUNE.pick.dragPx;

{
  const p = pointerRecord();
  notePointerDown(p, 0, 100, 100);
  notePointerMove(p, 100 + drag - 1, 100, drag);
  notePointerUp(p, 0, 100 + drag - 1, 100, drag);
  ok(p.clicked && !p.dragging && p.clickX === 100 + drag - 1, `a press and release within ${drag} px is a click`);
  ok((p.pressed & 1) === 1 && (p.released & 1) === 1, "and the frame's press and release are both said");
  endPointerFrame(p);
  ok(!p.clicked && p.pressed === 0 && p.released === 0 && p.wheel === 0, "spent at the frame's end");
  notePointerDown(p, 0, 50, 50);
  notePointerMove(p, 50 + drag + 2, 50, drag);
  ok(p.dragging, `a press moved past ${drag} px is a drag`);
  notePointerUp(p, 0, 50 + drag + 2, 50, drag);
  ok(!p.clicked && !p.dragging && p.buttons === 0, 'and its release is no click');
  endPointerFrame(p);
  notePointerDown(p, 2, 10, 10);
  ok(p.buttons === 4 && (p.pressed & 4) === 4 && !p.clicked, 'the right button is held and pressed, never a click');
  notePointerUp(p, 2, 10, 10, drag);
  ok(!p.clicked && p.buttons === 0, 'and released, still no click');
}

{
  // The listeners on a stand-in canvas: a wheel event reaches the record only through the canvas's own listener.
  type Fn = (e: unknown) => void;
  const listeners = new Map<string, Fn>();
  const canvas = {
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
    addEventListener: (type: string, fn: Fn) => void listeners.set(type, fn),
    removeEventListener: (type: string) => void listeners.delete(type),
  };
  const p = pointerRecord();
  const stop = attachPointer(canvas as never, p, EDITOR_TUNE.pick);
  ok(['pointermove', 'pointerdown', 'pointerup', 'pointerleave', 'wheel'].every((t) => listeners.has(t)), 'the canvas is listened to for moves, presses, releases, leaving and the wheel');
  listeners.get('pointermove')!({ clientX: 110, clientY: 220 });
  ok(p.x === 100 && p.y === 200 && p.over, 'the cursor is read in the canvas\'s own pixels');
  listeners.get('wheel')!({ deltaY: 120 });
  listeners.get('wheel')!({ deltaY: -3 });
  listeners.get('wheel')!({ deltaY: 40 });
  ok(p.wheel === 1, `the wheel over the canvas counts its notches (${p.wheel})`);
  // A wheel over the window is the window's own event: nothing of it reaches the canvas's listener, so nothing counts.
  endPointerFrame(p);
  ok(p.wheel === 0, 'and a frame with no wheel over the canvas counts none');
  listeners.get('pointerleave')!({});
  ok(!p.over, 'leaving the canvas is said');
  stop();
  ok(listeners.size === 0, 'and the listeners go when the editor lets go');
}

{
  // A button let go off the canvas (over the editor's window, outside the page): the canvas never hears its release, and
  // read off the record alone the brush painted again, with no button down, the moment the cursor came back over it.
  type Fn = (e: unknown) => void;
  const on = new Map<string, Fn>();
  const page = new Map<string, Fn>();
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    addEventListener: (type: string, fn: Fn) => void on.set(type, fn),
    removeEventListener: (type: string) => void on.delete(type),
  };
  const win = { addEventListener: (type: string, fn: Fn) => void page.set(type, fn), removeEventListener: (type: string) => void page.delete(type) };
  const p = pointerRecord();
  const stop = attachPointer(canvas as never, p, EDITOR_TUNE.pick, win as never);
  ok(page.has('pointerup'), "the page is listened to for its own releases");
  // The left button pressed on the canvas, held over the window, let go there.
  on.get('pointerdown')!({ clientX: 100, clientY: 100, button: 0 });
  on.get('pointerleave')!({});
  page.get('pointerup')!({ button: 0 });
  ok(p.buttons === 0 && (p.released & 1) === 1 && !p.clicked, 'let go over the window, the button is up and said released, never a click');
  endPointerFrame(p);
  on.get('pointermove')!({ clientX: 110, clientY: 110, buttons: 0 });
  ok(p.over && p.buttons === 0, 'and back over the canvas nothing is held');
  // The right button pressed, the page let go of outside it (no release anywhere): the first move back reads the page's word.
  on.get('pointerdown')!({ clientX: 100, clientY: 100, button: 2 });
  ok(p.buttons === 4, 'the right button held (the record keeps 1 << button)');
  on.get('pointerleave')!({});
  on.get('pointermove')!({ clientX: 120, clientY: 120, buttons: 0 });
  ok(p.buttons === 0 && (p.released & 4) === 4, 'let go outside the page, the first move back over the canvas lets it go');
  endPointerFrame(p);
  // A button still held as the cursor comes back stays held, by the page's own order (2 right, 4 middle).
  on.get('pointerdown')!({ clientX: 100, clientY: 100, button: 2 });
  on.get('pointerdown')!({ clientX: 100, clientY: 100, button: 1 });
  on.get('pointermove')!({ clientX: 101, clientY: 100, buttons: 2 | 4 });
  ok(p.buttons === (4 | 2), 'a button really held stays held, read in the page\'s own order');
  on.get('pointermove')!({ clientX: 102, clientY: 100, buttons: 4 });
  ok(p.buttons === 2 && (p.released & 4) === 4, 'and one of two let go together is let go by the move the page tells it with');
  // A release the canvas did hear is not let go twice by the page's own.
  endPointerFrame(p);
  on.get('pointerup')!({ clientX: 102, clientY: 100, button: 1 });
  const once = p.released;
  page.get('pointerup')!({ button: 1 });
  ok(once === 2 && p.released === 2 && p.buttons === 0, "the page's release of a button the canvas already let go of changes nothing");
  stop();
  ok(page.size === 0, 'and the page is let go of with the canvas');
}

{
  // Nothing of the editor sets `captured` (`freeMouse` would): text, over every file of it.
  const here = dirname(fileURLToPath(import.meta.url));
  const root = join(here, '..', '..', '..');
  const editorDir = join(root, 'src', 'editor');
  const files = [...readdirSync(editorDir).map((f) => join(editorDir, f)), ...['editorWindow.ts', 'libraryUi.ts', 'editorBar.ts', 'editorMarks.ts'].map((f) => join(root, 'src', 'ui', f))];
  const setters = files.filter((f) => /\.captured\s*=|freeMouse\(/.test(readFileSync(f, 'utf8')));
  ok(setters.length === 0, `Point never sets the game's captured: no file of the editor writes it or frees the mouse (${files.length} files read)`);
  const entry = readFileSync(join(editorDir, 'editorEntry.ts'), 'utf8');
  ok(/release: \(\) => host\.input\.releaseLock\(\)/.test(entry) && /lock: \(\) => host\.input\.requestLock\(\)/.test(entry), 'Point is entered by letting the lock go and Fly by asking for it again');
}

console.log(`\n${checks} checks passed`);
