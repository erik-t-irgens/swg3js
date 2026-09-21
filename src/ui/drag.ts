// Windows that move and size: a panel dragged by its header goes where it is put, a panel dragged by
// the grip in its bottom-right corner (or by its right or bottom edge) is made the size it is dragged
// to, and both are kept, in this browser, so the world behind a settings page or the map can be looked
// at while it is open and a list can be made as long as the screen allows. The overlay round a panel is
// clear; only the panel itself is drawn.
//
// All of it is event work. Nothing here runs in a frame: the page is written while a drag is under
// way, when a window is shown, and when the browser window changes size, and never otherwise. The
// arithmetic (where a window may stand, how small it may be, how the remembered boxes are read back)
// is in `windowBox.ts`, which a node test runs as it is.
//
// A window that has been sized carries the class `win-sized`, and that is the one switch the
// stylesheets hang the "fill the window" layouts on: a window at its own default size is laid out
// exactly as it always was, by its own rules, and only one somebody has sized trades its inner `vh`
// caps for the frame it is in. Double-clicking the grip gives the window its default size back.

import { clampPlace, fitRect, minFor, readSaved, resizeRect, writeSaved, type Edges, type Rect, type Saved, type Size } from './windowBox.ts';

const STORAGE_KEY = 'swg3js.panels';

function loadAll(): Record<string, Saved> {
  try {
    return readSaved(localStorage.getItem(STORAGE_KEY));
  } catch {
    return readSaved(null);
  }
}

function store(id: string, rec: Saved | null): void {
  try {
    const all = loadAll();
    if (rec) all[id] = rec;
    else delete all[id];
    localStorage.setItem(STORAGE_KEY, writeSaved(all));
  } catch {
    // No storage: the place and the size last this session.
  }
}

interface Win {
  readonly id: string;
  readonly root: HTMLElement;
  readonly panel: HTMLElement;
  readonly handle: HTMLElement;
  readonly marks: HTMLElement[];
  readonly min: Size;
  /** Where the top-left corner was put, or null while the layout places the window. */
  at: { x: number; y: number } | null;
  /** The size it was made, or null while it is at its own default size. */
  size: Size | null;
  /** A drag (of either kind) is under way. */
  busy: boolean;
}

const WINDOWS = new Map<string, Win>();
let resizeHeard = false;

function view(): Size {
  return { w: window.innerWidth, h: window.innerHeight };
}

/** The creator's full-size form takes the panel over: it is neither moved nor sized there. */
function takenOver(win: Win): boolean {
  return win.root.classList.contains('creation');
}

function setStyle(el: HTMLElement, name: string, value: string): void {
  if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
}

function setClass(el: HTMLElement, name: string, on: boolean): void {
  // Only when it differs: an `add` of a class already there still rewrites the attribute, which the
  // window's own observer would hear and answer by placing it again.
  if (el.classList.contains(name) !== on) el.classList.toggle(name, on);
}

const PLACED_PROPS = ['position', 'left', 'top', 'right', 'bottom', 'transform'] as const;
const SIZED_PROPS = ['width', 'height', 'max-width', 'max-height'] as const;

/** Put the window where it was put and make it the size it was made, kept on the screen. */
function apply(win: Win): void {
  const p = win.panel;
  const off = takenOver(win);
  if (!off && win.at && win.size) {
    const r = fitRect({ x: win.at.x, y: win.at.y, w: win.size.w, h: win.size.h }, win.min, view());
    setClass(p, 'win-sized', true);
    setStyle(p, 'width', `${Math.round(r.w)}px`);
    setStyle(p, 'height', `${Math.round(r.h)}px`);
    setStyle(p, 'max-width', 'none');
    setStyle(p, 'max-height', 'none');
    placeAt(p, r.x, r.y);
    return;
  }
  setClass(p, 'win-sized', false);
  for (const n of SIZED_PROPS) setStyle(p, n, '');
  if (!off && win.at) {
    // At its own size: measured as the layout makes it, then kept wholly on the screen.
    const c = clampPlace(win.at.x, win.at.y, p.offsetWidth, p.offsetHeight, view());
    placeAt(p, c.x, c.y);
    return;
  }
  for (const n of PLACED_PROPS) setStyle(p, n, '');
}

function placeAt(p: HTMLElement, x: number, y: number): void {
  setStyle(p, 'position', 'fixed');
  setStyle(p, 'left', `${Math.round(x)}px`);
  setStyle(p, 'top', `${Math.round(y)}px`);
  // A panel the layout placed with an offset of its own (the trade window is centred by a transform,
  // the group's panel hangs from the right) is placed by its corner alone once it has been moved.
  setStyle(p, 'right', 'auto');
  setStyle(p, 'bottom', 'auto');
  setStyle(p, 'transform', 'none');
}

/** The box the window is shown in now, read off the page. */
function shown(win: Win): Rect {
  const r = win.panel.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

function remember(win: Win): void {
  if (!win.at) {
    store(win.id, null);
    return;
  }
  store(win.id, win.size ? { x: win.at.x, y: win.at.y, w: win.size.w, h: win.size.h } : { x: win.at.x, y: win.at.y });
}

/**
 * The click that ends a drag belongs to the drag. Without this, a drag let go over the clear overlay
 * would close the panel (every panel shuts on a click on its own backdrop), and one let go over the
 * world outside a panel that has no overlay (the group's, the trade window) would reach the canvas,
 * whose click takes the mouse back into the game. The click is dispatched in the same task as the
 * pointer's release, so a listener that stands for exactly that task catches it and nothing later.
 */
function swallowNextClick(): void {
  const stop = (ev: Event) => {
    ev.stopPropagation();
    ev.preventDefault();
    off();
  };
  const off = () => {
    window.removeEventListener('click', stop, true);
    window.clearTimeout(timer);
  };
  window.addEventListener('click', stop, true);
  const timer = window.setTimeout(off, 0);
}

/**
 * Whether the point is on a scrollbar of `from` or of anything above it up to and including `stop`.
 * A header that scrolls (the Escape menu's nav, once the window is short) and a list that runs along
 * the window's right or bottom edge each have a scrollbar the point may be on, and a press there is
 * for scrolling, never for moving or sizing the window. The bar is the part of the border box that is
 * neither border nor client area, on the right (vertical) or at the bottom (horizontal).
 */
function onScrollbar(x: number, y: number, from: Element | null, stop: Element): boolean {
  for (let el = from; el; el = el.parentElement) {
    if (el instanceof HTMLElement && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) {
      const r = el.getBoundingClientRect();
      const left = r.left + el.clientLeft;
      const top = r.top + el.clientTop;
      const barW = el.offsetWidth - el.clientWidth - el.clientLeft * 2;
      const barH = el.offsetHeight - el.clientHeight - el.clientTop * 2;
      if (barW > 0 && x >= left + el.clientWidth && x < left + el.clientWidth + barW && y >= top && y < top + el.clientHeight + barH) return true;
      if (barH > 0 && y >= top + el.clientHeight && y < top + el.clientHeight + barH && x >= left && x < left + el.clientWidth + barW) return true;
    }
    if (el === stop) break;
  }
  return false;
}

/**
 * The first element under the point that is not one of the window's own grips, inside the panel: what
 * a press would reach if the grips were not there.
 */
function beneath(win: Win, x: number, y: number): Element | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (win.marks.includes(el as HTMLElement)) continue;
    return win.panel.contains(el) ? el : null;
  }
  return null;
}

/**
 * A grip or an edge strip lying over a scrollbar in the panel (a list that runs along the window's
 * right edge, the bar's bottom arrow under the corner grip) stands aside while the pointer is over
 * that bar, so the press goes to the bar. It is heard only as the pointer moves over the strip, and
 * while it stands aside one listener waits for the pointer to leave the strip's box to bring it back;
 * nothing is written on any other move.
 */
function passOverScrollbars(win: Win, el: HTMLElement): void {
  let box: DOMRect | null = null;
  const back = (ev: PointerEvent) => {
    if (box && ev.clientX >= box.left && ev.clientX < box.right && ev.clientY >= box.top && ev.clientY < box.bottom && onScrollbar(ev.clientX, ev.clientY, beneath(win, ev.clientX, ev.clientY), win.panel)) return;
    window.removeEventListener('pointermove', back, true);
    box = null;
    setClass(el, 'win-pass', false);
  };
  el.addEventListener('pointermove', (ev) => {
    if (win.busy || box || ev.buttons !== 0) return;
    if (!onScrollbar(ev.clientX, ev.clientY, beneath(win, ev.clientX, ev.clientY), win.panel)) return;
    box = el.getBoundingClientRect();
    setClass(el, 'win-pass', true);
    window.addEventListener('pointermove', back, true);
  });
}

/** The grips hang last in the panel, so they are drawn over everything in it without a z-index of their own. */
function marksLast(win: Win): void {
  const last = win.marks[win.marks.length - 1];
  if (win.panel.lastElementChild !== last) win.panel.append(...win.marks);
}

function mark(className: string, title: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.setAttribute('aria-hidden', 'true');
  if (title) el.title = title;
  return el;
}

/**
 * Let the panel inside `root` be moved by its handle and sized by its corner and its right and bottom
 * edges. The panel is placed by the layout until it is moved; from then on it sits at a fixed place,
 * kept within the browser window and remembered under `id`, with its size too once it is sized. An
 * overlay in its `creation` form (the character creator, which sizes the panel to the screen) leaves
 * the panel where and as big as the layout makes it.
 */
export function draggable(root: HTMLElement, panelSelector: string, handleSelector: string, id: string): void {
  const panel = root.matches(panelSelector) ? root : root.querySelector<HTMLElement>(panelSelector);
  const handle = panel?.querySelector<HTMLElement>(handleSelector) ?? root.querySelector<HTMLElement>(handleSelector);
  if (!panel || !handle || WINDOWS.has(id)) return;
  handle.classList.add('drag-handle');
  panel.classList.add('win');
  const edgeR = mark('win-edge win-edge-r', '');
  const edgeB = mark('win-edge win-edge-b', '');
  const grip = mark('win-grip', 'drag to size · double-click for the default size');
  const rec = loadAll()[id];
  const win: Win = {
    id,
    root,
    panel,
    handle,
    marks: [edgeR, edgeB, grip],
    min: minFor(id),
    at: rec ? { x: rec.x, y: rec.y } : null,
    size: rec && rec.w !== undefined && rec.h !== undefined ? { w: rec.w, h: rec.h } : null,
    busy: false,
  };
  WINDOWS.set(id, win);
  panel.append(...win.marks);

  // ---- moving, by the header ----
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || takenOver(win) || win.busy) return;
    // A control in the header is for pressing, not for dragging by.
    if ((e.target as HTMLElement).closest('button, input, select, textarea, label, a')) return;
    // Nor is a scrollbar in it (the Escape menu's nav, which is its handle, scrolls once the window is short).
    if (onScrollbar(e.clientX, e.clientY, e.target as Element, handle)) return;
    const start = shown(win);
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    let moved = false;
    let ended = false;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    win.busy = true;
    const move = (ev: PointerEvent) => {
      const x = ev.clientX - dx;
      const y = ev.clientY - dy;
      if (!moved && x === start.x && y === start.y) return;
      moved = true;
      win.at = { x, y };
      apply(win);
    };
    // The release, a cancel, or the capture taken away with neither reaching the handle: whichever
    // comes first ends the drag, and the others find it ended.
    const up = (ev: PointerEvent) => {
      if (ended) return;
      ended = true;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      handle.removeEventListener('lostpointercapture', up);
      if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
      win.busy = false;
      if (!moved) return;
      // What is kept is where it is shown, so a window pushed against an edge is remembered there.
      const r = shown(win);
      win.at = { x: r.x, y: r.y };
      remember(win);
      swallowNextClick();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
    handle.addEventListener('lostpointercapture', up);
  });

  // ---- sizing, by the grip and the two far edges ----
  const sizeBy = (el: HTMLElement, edges: Edges) => {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || takenOver(win) || win.busy) return;
      // Nothing under the grip sees this press: not the panel's own backdrop, not the world.
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      win.busy = true;
      const start = shown(win);
      const sx = e.clientX;
      const sy = e.clientY;
      let moved = false;
      let ended = false;
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - sx;
        const dy = ev.clientY - sy;
        if (!moved && dx === 0 && dy === 0) return;
        moved = true;
        // The first move pins the window where it stands, so its top-left corner holds still while
        // the far edges follow the pointer; a window the overlay centres would otherwise grow both ways.
        const r = resizeRect(start, dx, dy, edges, win.min, view());
        win.at = { x: r.x, y: r.y };
        win.size = { w: r.w, h: r.h };
        apply(win);
      };
      const up = (ev: PointerEvent) => {
        if (ended) return;
        ended = true;
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        el.removeEventListener('lostpointercapture', up);
        if (el.hasPointerCapture(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
        win.busy = false;
        if (!moved) return;
        remember(win);
        swallowNextClick();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    });
    passOverScrollbars(win, el);
  };
  sizeBy(grip, { right: true, bottom: true });
  sizeBy(edgeR, { right: true, bottom: false });
  sizeBy(edgeB, { right: false, bottom: true });
  // The window's own default size again; where it was put is kept.
  grip.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!win.size) return;
    win.size = null;
    apply(win);
    remember(win);
  });

  // Placed again whenever the window is shown (the overlay's class, or the panel's own for the two
  // windows that hide the panel rather than an overlay) or the creator takes it over.
  new MutationObserver(() => {
    if (win.busy) return;
    marksLast(win);
    apply(win);
  }).observe(root, { attributes: true, attributeFilter: ['class'] });
  if (panel !== root) new MutationObserver(() => {
    if (!win.busy) apply(win);
  }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  if (!resizeHeard) {
    resizeHeard = true;
    // One listener for every window: the browser window shrinking keeps each open one on the screen.
    window.addEventListener('resize', () => {
      for (const w of WINDOWS.values()) apply(w);
    });
  }
  apply(win);
}

/**
 * Forget every window's place and size (or one window's, by id), and put each back where and as big
 * as its own layout makes it. The Interface page's reset button calls this.
 */
export function resetWindows(id?: string): void {
  if (id === undefined) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // No storage: there was nothing kept to forget.
    }
  } else store(id, null);
  for (const w of WINDOWS.values()) {
    if (id !== undefined && w.id !== id) continue;
    w.at = null;
    w.size = null;
    apply(w);
  }
}

/** One window, as `__debug.windows()` reports it. */
export interface WindowReport {
  id: string;
  /** Shown on the screen now. */
  open: boolean;
  /** Moved from where the layout puts it, and sized from its own default. */
  placed: boolean;
  sized: boolean;
  /** The box it is shown in, in CSS pixels (0s while it is hidden). */
  box: Rect;
  /** The smallest it may be dragged to. */
  min: Size;
  /** What storage holds for it. */
  saved: Saved | null;
  /** Wholly inside the browser window (always true for a hidden one). */
  onScreen: boolean;
  /** Something inside it is wider than it, which would scroll it sideways. */
  overflowX: boolean;
}

/**
 * Every window, for the console: `__debug.windows()`. `{ set: { id, x, y, w, h } }` moves and sizes one
 * as a drag would (w and h left out: its own size), `{ reset: true }` forgets them all and
 * `{ reset: 'map' }` one; the answer is the table as it then stands, with the browser's own size.
 */
export function windowsDebug(o?: { set?: { id: string; x: number; y: number; w?: number; h?: number }; reset?: boolean | string }): { view: Size; dpr: number; windows: WindowReport[] } {
  if (o?.reset === true) resetWindows();
  else if (typeof o?.reset === 'string') resetWindows(o.reset);
  const s = o?.set;
  if (s) {
    const w = WINDOWS.get(s.id);
    if (w && Number.isFinite(s.x) && Number.isFinite(s.y)) {
      w.at = { x: s.x, y: s.y };
      w.size = typeof s.w === 'number' && typeof s.h === 'number' ? { w: s.w, h: s.h } : null;
      if (w.size) {
        const r = fitRect({ x: s.x, y: s.y, w: w.size.w, h: w.size.h }, w.min, view());
        w.size = { w: r.w, h: r.h };
      }
      apply(w);
      remember(w);
    }
  }
  const all = loadAll();
  const v = view();
  const windows: WindowReport[] = [];
  for (const w of WINDOWS.values()) {
    const r = shown(w);
    // A fixed-position panel has no offset parent, so "laid out at all" is whether it has a box.
    const open = !w.root.classList.contains('hidden') && !w.panel.classList.contains('hidden') && r.w > 0 && r.h > 0;
    const box = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
    windows.push({
      id: w.id,
      open,
      placed: !!w.at,
      sized: !!w.size,
      box,
      min: { w: w.min.w, h: w.min.h },
      saved: all[w.id] ?? null,
      onScreen: !open || (box.x >= 0 && box.y >= 0 && box.x + box.w <= v.w + 0.5 && box.y + box.h <= v.h + 0.5),
      overflowX: open && w.panel.scrollWidth > w.panel.clientWidth + 1,
    });
  }
  return { view: v, dpr: window.devicePixelRatio || 1, windows };
}
