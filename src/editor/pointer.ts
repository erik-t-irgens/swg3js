// The world editor's pointer in Point mode (DESIGN.md §2.2): the game's `Input` records the mouse only while the pointer
// is locked and keeps no cursor at all, so with the cursor free the editor reads the canvas itself. Pointer events on
// the canvas write one kept record -- where the cursor is in CSS pixels, the buttons held, this frame's presses and
// releases, the wheel's notches over the canvas -- listened for from the editor's first entry and read only in Point
// mode. A press and release within `dragPx` is a click, past it a drag.
//
// Point never sets the game's `captured`: `held` refuses every action while it is set, and WASD would stop flying.
//
// The record and its rules are pure (`notePointer*`), so a node test drives them as the listeners do; `attachPointer`
// is the one place a DOM element is touched, and allocates nothing per event.
//
// Rule for this file (node runs it with type stripping): every import with its `.ts` extension, no enum, no namespace,
// no constructor parameter properties.

/** One pointer, as the editor reads it in Point mode. Kept and written in place. */
export interface PointerRecord {
  /** Where the cursor is over the canvas, CSS pixels from its top left. */
  x: number;
  y: number;
  /** Whether the cursor is over the canvas at all. */
  over: boolean;
  /** The buttons held, as `MouseEvent.buttons` (1 left, 2 right, 4 middle). */
  buttons: number;
  /** The buttons pressed and released this frame, as bit masks of the button (1 << button). */
  pressed: number;
  released: number;
  /** Where the left button went down, and whether the press has moved past `dragPx` since (a drag). */
  downX: number;
  downY: number;
  dragging: boolean;
  /** A left press and release this frame that never moved past `dragPx`: a click, and where. */
  clicked: boolean;
  clickX: number;
  clickY: number;
  /** The wheel's notches over the canvas this frame (positive towards the user, as `Input.wheel`). */
  wheel: number;
}

/**
 * A pointer with nothing held. Its places start as fractions (NaN: nowhere yet), since a field that starts whole boxes
 * every fraction written into it after.
 */
export function pointerRecord(): PointerRecord {
  return { x: Number.NaN, y: Number.NaN, over: false, buttons: 0, pressed: 0, released: 0, downX: Number.NaN, downY: Number.NaN, dragging: false, clicked: false, clickX: Number.NaN, clickY: Number.NaN, wheel: 0 };
}

/** The cursor moved, to `x`, `y` over the canvas: a press held further than `dragPx` from where it went down is a drag from now on. */
export function notePointerMove(p: PointerRecord, x: number, y: number, dragPx: number): void {
  p.x = x;
  p.y = y;
  p.over = true;
  // `Math.sqrt` written out: `Math.hypot` makes a number every call.
  const ex = x - p.downX;
  const ey = y - p.downY;
  if (p.buttons & 1 && !p.dragging && ex * ex + ey * ey > dragPx * dragPx) p.dragging = true;
}

/** A button went down over the canvas. */
export function notePointerDown(p: PointerRecord, button: number, x: number, y: number): void {
  p.x = x;
  p.y = y;
  p.over = true;
  p.buttons |= 1 << button;
  p.pressed |= 1 << button;
  if (button === 0) {
    p.downX = x;
    p.downY = y;
    p.dragging = false;
  }
}

/** A button came up: a left button that never dragged is a click, where it came up. */
export function notePointerUp(p: PointerRecord, button: number, x: number, y: number, dragPx: number): void {
  p.x = x;
  p.y = y;
  const ex = x - p.downX;
  const ey = y - p.downY;
  if (button === 0 && p.buttons & 1 && !p.dragging && ex * ex + ey * ey <= dragPx * dragPx) {
    p.clicked = true;
    p.clickX = x;
    p.clickY = y;
  }
  p.buttons &= ~(1 << button);
  p.released |= 1 << button;
  if (button === 0) p.dragging = false;
}

/** The wheel turned over the canvas, by one notch either way. */
export function notePointerWheel(p: PointerRecord, deltaY: number): void {
  if (deltaY) p.wheel += Math.sign(deltaY);
}

/** The frame's presses, releases, click and wheel spent: what the editor's step calls once it has read them. */
export function endPointerFrame(p: PointerRecord): void {
  p.pressed = 0;
  p.released = 0;
  p.clicked = false;
  p.wheel = 0;
}

/** What `attachPointer` needs of the canvas: a box to measure against and its own listeners. */
export interface PointerTarget {
  getBoundingClientRect(): { left: number; top: number };
  addEventListener(type: string, fn: (e: Event) => void, opts?: { passive?: boolean }): void;
  removeEventListener(type: string, fn: (e: Event) => void): void;
}

type Handler = (e: Event) => void;

/**
 * Listen for the canvas's pointer events into `p`, for as long as the editor lives (its first entry to its world's end):
 * a move, a press and a release, and the wheel, each writing the kept record and making nothing. `tune` is read at every
 * event, so the drag's distance moves live. Answers the way to stop listening.
 */
export function attachPointer(canvas: PointerTarget, p: PointerRecord, tune: { dragPx: number }): () => void {
  const at = (e: { clientX: number; clientY: number }, out: { x: number; y: number }) => {
    const r = canvas.getBoundingClientRect();
    out.x = e.clientX - r.left;
    out.y = e.clientY - r.top;
    return out;
  };
  const xy = { x: 0, y: 0 };
  const move = (e: { clientX: number; clientY: number }) => {
    at(e, xy);
    notePointerMove(p, xy.x, xy.y, tune.dragPx);
  };
  const down = (e: { clientX: number; clientY: number; button: number }) => {
    at(e, xy);
    notePointerDown(p, e.button, xy.x, xy.y);
  };
  const up = (e: { clientX: number; clientY: number; button: number }) => {
    at(e, xy);
    notePointerUp(p, e.button, xy.x, xy.y, tune.dragPx);
  };
  const leave = () => {
    p.over = false;
  };
  const wheel = (e: { deltaY: number }) => notePointerWheel(p, e.deltaY);
  canvas.addEventListener('pointermove', move as unknown as Handler);
  canvas.addEventListener('pointerdown', down as unknown as Handler);
  canvas.addEventListener('pointerup', up as unknown as Handler);
  canvas.addEventListener('pointerleave', leave as unknown as Handler);
  canvas.addEventListener('wheel', wheel as unknown as Handler, { passive: true });
  return () => {
    canvas.removeEventListener('pointermove', move as unknown as Handler);
    canvas.removeEventListener('pointerdown', down as unknown as Handler);
    canvas.removeEventListener('pointerup', up as unknown as Handler);
    canvas.removeEventListener('pointerleave', leave as unknown as Handler);
    canvas.removeEventListener('wheel', wheel as unknown as Handler);
  };
}
