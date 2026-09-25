// The arithmetic of a window that can be moved and sized: where it may stand, how small it may get,
// and how what is remembered about it is read back. No DOM here and nothing imported, so the node
// test (`tools/swg/tests/windowBox.test.ts`) runs it exactly as the game does.
//
// Every size is in CSS pixels, border to border (a sized window is `box-sizing: border-box`), which
// is what `getBoundingClientRect` measures and what Windows' 125% and 150% scaling already divides out.

/** A width and a height. */
export interface Size {
  w: number;
  h: number;
}

/** A window's box on the screen. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * What is remembered about one window: where its top-left corner was put, and, once it has been
 * sized, how big it was made. A window that has only been moved has no `w`/`h`, which is exactly the
 * record the game kept before windows could be sized, so the old records are the new format as they
 * stand and nothing has to be rewritten to read them.
 */
export interface Saved {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

/**
 * The smallest each window may be dragged to, chosen so that its header and its main controls still
 * fit: the header's title, its tabs (which wrap onto a second line in a sized window rather than
 * being cut off) and its close button, and at least a few rows of whatever it lists. They are ours,
 * measured against the panels' own markup at the default text size; a window the browser is smaller
 * than is given the browser's size instead, since a minimum that pushed a window off the screen
 * would be worse than one that is not met.
 */
export const WINDOW_MIN: Readonly<Record<string, Readonly<Size>>> = Object.freeze({
  map: { w: 520, h: 320 },
  ship: { w: 420, h: 220 },
  hyperspace: { w: 620, h: 320 },
  // The inventory's five tabs alone are 647 px wide at the default text size (measured), and a tab
  // strip does not wrap inside itself, so every panel that carries it is at least that plus its padding.
  wardrobe: { w: 680, h: 320 },
  weapons: { w: 680, h: 300 },
  garage: { w: 520, h: 280 },
  npcs: { w: 600, h: 320 },
  appearance: { w: 680, h: 360 },
  backpack: { w: 680, h: 440 },
  shipedit: { w: 680, h: 420 },
  force: { w: 680, h: 280 },
  menu: { w: 600, h: 360 },
  lift: { w: 340, h: 200 },
  // A shuttle's rows carry a place name and a fare, so it wants more width than a lift's floors and
  // more height: a starport on the busiest world offers eighteen of them.
  shuttle: { w: 460, h: 300 },
  group: { w: 220, h: 150 },
  trade: { w: 520, h: 320 },
});

/** The minimum of a window this table does not name. */
export const DEFAULT_MIN: Readonly<Size> = Object.freeze({ w: 280, h: 160 });

export function minFor(id: string): Size {
  const m = Object.prototype.hasOwnProperty.call(WINDOW_MIN, id) ? WINDOW_MIN[id] : DEFAULT_MIN;
  return { w: m.w, h: m.h };
}

/** Names a table read back from storage must never take as a key. */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Read what the game remembered, from the text storage holds (or null when it holds nothing). Old
 * `{ x, y }` records come through untouched; a size that is not a positive number is dropped and the
 * place kept; a record with no usable place is dropped whole. Anything that is not JSON reads as
 * nothing remembered at all. The table is built without a prototype, so a key read back from a file
 * is never a way into the language's own objects.
 */
export function readSaved(text: string | null | undefined): Record<string, Saved> {
  const out = Object.create(null) as Record<string, Saved>;
  if (!text) return out;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return out;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (FORBIDDEN.has(id) || !v || typeof v !== 'object') continue;
    const r = v as Record<string, unknown>;
    if (!finite(r.x) || !finite(r.y)) continue;
    const rec: Saved = { x: r.x, y: r.y };
    if (finite(r.w) && finite(r.h) && r.w > 0 && r.h > 0) {
      rec.w = r.w;
      rec.h = r.h;
    }
    out[id] = rec;
  }
  return out;
}

/** The text to put back in storage: whole pixels, and a size only where the window was sized. */
export function writeSaved(all: Record<string, Saved>): string {
  const plain: Record<string, Saved> = {};
  for (const id of Object.keys(all)) {
    if (FORBIDDEN.has(id)) continue;
    const r = all[id];
    const rec: Saved = { x: Math.round(r.x), y: Math.round(r.y) };
    if (finite(r.w) && finite(r.h)) {
      rec.w = Math.round(r.w);
      rec.h = Math.round(r.h);
    }
    plain[id] = rec;
  }
  return JSON.stringify(plain);
}

/**
 * A size kept between the window's minimum and the browser's own size. The browser wins over the
 * minimum: a window that cannot be made as small as its minimum is made the browser's size and shows
 * less, which it scrolls.
 */
export function clampSize(w: number, h: number, min: Size, view: Size): Size {
  return {
    w: Math.max(0, Math.min(Math.max(w, min.w), view.w)),
    h: Math.max(0, Math.min(Math.max(h, min.h), view.h)),
  };
}

/** A top-left corner that keeps a box of this size wholly on the screen (the top left first, if it cannot). */
export function clampPlace(x: number, y: number, w: number, h: number, view: Size): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(view.w - w, x)),
    y: Math.max(0, Math.min(view.h - h, y)),
  };
}

/** A remembered box as it is shown in a browser of this size: sized within its bounds, then kept on the screen. */
export function fitRect(r: Rect, min: Size, view: Size): Rect {
  const s = clampSize(r.w, r.h, min, view);
  const p = clampPlace(r.x, r.y, s.w, s.h, view);
  return { x: p.x, y: p.y, w: s.w, h: s.h };
}

/** Which edges a sizing drag moves: the right edge, the bottom edge, or both (the corner's grip). */
export interface Edges {
  right: boolean;
  bottom: boolean;
}

/**
 * The box a sizing drag has made, from the box it started on and how far the pointer has gone. The
 * top-left corner stays where it is while the far edge fits between it and the browser's edge; only
 * when the minimum would not fit there does the window slide back to keep all of itself on the screen.
 */
export function resizeRect(start: Rect, dx: number, dy: number, edges: Edges, min: Size, view: Size): Rect {
  const want = { w: edges.right ? start.w + dx : start.w, h: edges.bottom ? start.h + dy : start.h };
  const room = { w: Math.max(min.w, view.w - start.x), h: Math.max(min.h, view.h - start.y) };
  const s = clampSize(Math.min(want.w, room.w), Math.min(want.h, room.h), min, view);
  const p = clampPlace(start.x, start.y, s.w, s.h, view);
  return { x: p.x, y: p.y, w: s.w, h: s.h };
}
