// What a long page keeps of how it was laid out, in this browser (the owner's ask of 2026-11-02, "it's getting difficult
// to use and scroll through"): which of its sections are folded, which of its sub-tabs was open last, and where its scroll
// stood, so a page drawn again stands where it stood. The world editor's window (the dev server's alone) and the Escape
// menu's Graphics page both use it.
//
// Every read and write of storage is in a try: a page whose storage refuses (a private window, cleared or blocked site
// data) draws exactly as it would with nothing kept, the defaults, and what is changed lasts the session. Nothing here runs
// in a frame; it is all clicks and redraws. Pure but for the elements it is handed, so a node test drives it through a
// stand-in page.

/** What each key holds this session, read once from storage (or never, where storage refuses): shared by every reader. */
const SESSION = new Map<string, Record<string, boolean>>();
const WORDS = new Map<string, string>();

/** A page's folds kept under one key: what was folded or unfolded by hand, over a default a section. */
export class FoldStore {
  readonly key: string;
  private readonly defaults: ReadonlySet<string>;

  /** `folded`: the sections that start folded (the owner's, a table where each page keeps it). */
  constructor(key: string, folded: Iterable<string> = []) {
    this.key = key;
    this.defaults = new Set(folded);
  }

  /** Whether a section stands folded now. */
  folded(id: string): boolean {
    const k = this.kept();
    return Object.prototype.hasOwnProperty.call(k, id) ? k[id] : this.defaults.has(id);
  }

  /** A section folded or unfolded by hand: kept, and only where it differs from its default. */
  set(id: string, folded: boolean): void {
    const k = this.kept();
    if (folded === this.defaults.has(id)) delete k[id];
    else k[id] = folded;
    try {
      if (Object.keys(k).length) localStorage.setItem(this.key, JSON.stringify(k));
      else localStorage.removeItem(this.key);
    } catch {
      // No storage: the session holds it.
    }
  }

  private kept(): Record<string, boolean> {
    let k = SESSION.get(this.key);
    if (k) return k;
    k = Object.create(null) as Record<string, boolean>;
    try {
      const v: unknown = JSON.parse(localStorage.getItem(this.key) ?? 'null');
      if (v && typeof v === 'object' && !Array.isArray(v)) for (const [id, f] of Object.entries(v)) if (typeof f === 'boolean') k[id] = f;
    } catch {
      // Unreadable or refused: the defaults.
    }
    SESSION.set(this.key, k);
    return k;
  }
}

/** A word kept under a key (a sub-tab last open), or null for none; read once a session. */
export function keptWord(key: string): string | null {
  if (WORDS.has(key)) return WORDS.get(key) || null;
  let v: string | null = null;
  try {
    v = localStorage.getItem(key);
  } catch {
    // Refused: nothing kept.
  }
  WORDS.set(key, v ?? '');
  return v || null;
}

/** A word kept under a key, for this browser (and the session, where storage refuses). */
export function keepWord(key: string, word: string): void {
  WORDS.set(key, word);
  try {
    localStorage.setItem(key, word);
  } catch {
    // No storage: the session holds it.
  }
}

/**
 * Where a scroller stands: the section (an element carrying `data-sec`, shown) holding the top of its view, and how far that
 * section's top stands from the scroller's top; with its plain scroll beside it, which is what is put back where no such
 * section stands again, or where no section holds the view's top at all.
 */
export interface ScrollMark {
  id: string | null;
  offset: number;
  top: number;
}

/**
 * The mark of where a scroller stands now. Only a section at the view's top is its mark: where the top of the view is in
 * something no section holds (the Here tab's own rows, the Tools list), that is what is under the eye and the plain scroll
 * keeps it, as it did before there were sections; a section further down the view, or below it, is never the mark, or the
 * view would follow it by however much what stood above it grew (the Here tab's rows growing from six to forty once jumped
 * it 4,000 px). A hidden scroller (no box) marks its plain scroll alone.
 */
export function scrollMark(scroller: HTMLElement): ScrollMark {
  const top = scroller.scrollTop;
  const box = scroller.getBoundingClientRect();
  const s = box.height > 0 ? sectionAt(scroller, box.top) : null;
  if (s) return { id: s.dataset.sec ?? null, offset: s.getBoundingClientRect().top - box.top, top };
  return { id: null, offset: 0, top };
}

/**
 * The section standing at the line `y` (the view's top, in the page's coordinates): of an element's own children the first
 * shown one reaching below the line (so a gap between two children counts for the one after it), if it is a section; if it
 * is only a box holding sections, the one at the line inside it; anything else holds the line and no section does.
 */
function sectionAt(el: HTMLElement, y: number): HTMLElement | null {
  for (const c of Array.from(el.children) as HTMLElement[]) {
    const r = c.getBoundingClientRect();
    if (r.height <= 0 || r.bottom <= y) continue;
    if (c.dataset.sec !== undefined) return c;
    return c.querySelector('[data-sec]') ? sectionAt(c, y) : null;
  }
  return null;
}

/**
 * A scroller drawn again (or shown again) put back where its mark stood: the same section at the same place where it still
 * stands, so what grew or shrank above it moves nothing under the eye; at the top where it was at the top; else its plain
 * scroll, which the browser holds inside what there is to scroll.
 */
export function restoreScroll(scroller: HTMLElement, mark: ScrollMark): void {
  if (mark.top <= 0) {
    if (scroller.scrollTop !== 0) scroller.scrollTop = 0;
    return;
  }
  if (mark.id !== null) {
    const box = scroller.getBoundingClientRect();
    for (const s of scroller.querySelectorAll<HTMLElement>('[data-sec]')) {
      if (s.dataset.sec !== mark.id) continue;
      const r = s.getBoundingClientRect();
      if (r.height <= 0 || box.height <= 0) break;
      scroller.scrollTop += r.top - box.top - mark.offset;
      return;
    }
  }
  scroller.scrollTop = mark.top;
}
