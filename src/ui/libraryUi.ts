// The world editor's library (DESIGN.md §2.5): everything it can put down, as the Props tab shows its things -- the
// pictures the `library` pass baked, in folding groups, a page at a time -- with the sources down the side, a find box,
// a world to choose for the world models and the flora, Recent, Favourites and Used here (what this world's files already
// stand). A click takes an entry in hand.
//
// **No frame is stalled.** Only a group that is opened builds its cells, a page of `LIBRARY_TUNE.page` at a time, the
// next as its sentinel comes into view (`IntersectionObserver`); every picture is `<img loading="lazy"
// decoding="async">`, and an entry with none shows its name's initials (the give screen's own fallback). The search reads
// one pre-lowercased string a row (`libraryModel.ts`). No 3D context per entry and no preview pane: the pictures are the
// previews, and the thing in hand at the crosshair is the rest (the owner's answer, Q7).
//
// The dev server's alone: reached only through the editor's own dynamic import. Every colour is one of the eighteen.

import { LIBRARY_TUNE } from '../editor/editorTune.ts';
import { LIBRARY_SOURCES, SOURCE_WORDS, entryKey, entryName, groupsOf, packsOf, searchLibrary, type LibraryEntry, type LibraryKeep, type LibrarySource, type LibraryView } from '../editor/libraryModel.ts';

const LIBRARY_CSS = `
.lib { display: flex; gap: 8px; height: 100%; min-height: 0; }
.lib-src { display: flex; flex-direction: column; gap: 4px; flex: 0 0 104px; }
.lib-src button { font: inherit; font-size: 11px; letter-spacing: 0.04em; text-align: left; color: var(--muted); background: var(--panel); border: 1px solid var(--rule); border-radius: 3px; padding: 5px 7px; cursor: pointer; }
.lib-src button:hover { color: var(--ink); border-color: var(--edge); }
.lib-src button.on { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 60%, transparent); }
.lib-main { display: flex; flex-direction: column; gap: 6px; flex: 1 1 auto; min-width: 0; min-height: 0; }
.lib-top { display: flex; gap: 6px; align-items: center; }
.lib-top input, .lib-top select { font: inherit; font-size: 12px; color: var(--ink); background: var(--void); border: 1px solid var(--rule); border-radius: 3px; padding: 4px 6px; }
.lib-top input { flex: 1 1 auto; min-width: 0; }
.lib-say { font-size: 10px; letter-spacing: 0.04em; color: var(--muted); min-height: 1.2em; }
.lib-groups { flex: 1 1 auto; overflow-y: auto; min-height: 0; padding-right: 4px; }
.lib-group { border-top: 1px solid var(--rule); }
.lib-group summary { cursor: pointer; font-size: 11px; letter-spacing: 0.05em; color: var(--muted); padding: 5px 2px; }
.lib-group summary:hover { color: var(--ink); }
.lib-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(78px, 1fr)); gap: 6px; padding: 4px 0 8px; }
.lib-cell { position: relative; display: flex; flex-direction: column; align-items: center; gap: 3px; font: inherit; color: var(--ink); background: var(--panel); border: 1px solid var(--rule); border-radius: 3px; padding: 4px; cursor: pointer; }
.lib-cell:hover { border-color: var(--edge); }
.lib-cell.held { border-color: color-mix(in srgb, var(--accent) 70%, transparent); }
.lib-cell img, .lib-cell .lib-initials { width: 64px; height: 64px; object-fit: contain; }
.lib-cell .lib-initials { display: flex; align-items: center; justify-content: center; font-size: 18px; letter-spacing: 0.06em; color: var(--muted); background: var(--void); border-radius: 2px; }
.lib-cell .lib-name { font-size: 10px; line-height: 1.2; color: var(--muted); text-align: center; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lib-cell .lib-star { position: absolute; top: 2px; right: 4px; font-size: 12px; color: var(--muted); opacity: 0.5; }
.lib-cell .lib-star.on { color: var(--component); opacity: 1; }
.lib-more { height: 1px; }
`;

let styled = false;
function installStyle(): void {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = LIBRARY_CSS;
  document.head.appendChild(style);
}

/** What the library's grid needs of the editor. */
export interface LibraryHost {
  /** The library, worked out once (`libraryView`). Null until it has been read. */
  view(): LibraryView | null;
  /** Recent, Favourites and the hotbar. */
  keep: LibraryKeep;
  /** Where a picture is, from its path relative to `assets-private/`. */
  pictureUrl(pic: string): string;
  /** The world a source opens on (this world's own, or on a real-elevation world the one its ground borrows from). */
  defaultPack(source: LibrarySource): string | null;
  /** An entry clicked: take it in hand. */
  take(e: LibraryEntry): void;
  /** What is in hand now, by key, to mark its cell. */
  held(): string;
  /** A line under the find box (the index's state). */
  status(): string;
  /** The entries this world's files already stand, most used first (`usedHereKeys`). */
  usedHere(): string[];
}

/** The three lists that are not sources. */
type Tab = LibrarySource | 'recent' | 'favourites' | 'used';

/** The library's grid of pictures. */
export class LibraryUi {
  readonly root: HTMLElement;
  private readonly host: LibraryHost;
  private readonly groupsEl: HTMLElement;
  private readonly find: HTMLInputElement;
  private readonly packSel: HTMLSelectElement;
  private readonly sayEl: HTMLElement;
  private readonly srcButtons = new Map<Tab, HTMLButtonElement>();
  private tab: Tab = 'props';
  private pack: string | null = null;
  private findTimer = 0;
  private observer: IntersectionObserver | null = null;
  /** Each open group's entries and how many pages it has shown, by its sentinel. */
  private readonly pending = new Map<Element, { list: LibraryEntry[]; page: number; grid: HTMLElement }>();
  /** Cells drawn, for `editor()`'s count. */
  cells = 0;

  constructor(parent: HTMLElement, host: LibraryHost) {
    installStyle();
    this.host = host;
    const root = document.createElement('div');
    root.className = 'lib';
    root.innerHTML = '<div class="lib-src"></div><div class="lib-main"><div class="lib-top"><input type="search" placeholder="find (/)" spellcheck="false"><select hidden></select></div><div class="lib-say"></div><div class="lib-groups"></div></div>';
    parent.appendChild(root);
    this.root = root;
    const src = root.querySelector<HTMLElement>('.lib-src')!;
    const tabs: [Tab, string][] = [...LIBRARY_SOURCES.map((s) => [s, SOURCE_WORDS[s]] as [Tab, string]), ['recent', 'Recent'], ['favourites', 'Favourites'], ['used', 'Used here']];
    for (const [t, words] of tabs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = words;
      b.addEventListener('click', () => {
        this.setTab(t);
        b.blur();
      });
      src.appendChild(b);
      this.srcButtons.set(t, b);
    }
    this.find = root.querySelector<HTMLInputElement>('.lib-top input')!;
    this.packSel = root.querySelector<HTMLSelectElement>('.lib-top select')!;
    this.sayEl = root.querySelector<HTMLElement>('.lib-say')!;
    this.groupsEl = root.querySelector<HTMLElement>('.lib-groups')!;
    this.find.addEventListener('input', () => {
      window.clearTimeout(this.findTimer);
      this.findTimer = window.setTimeout(() => this.render(), 120);
    });
    // Escape in the find box gives the keyboard back to the world, so WASD flies again.
    this.find.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.find.blur();
    });
    this.packSel.addEventListener('change', () => {
      this.pack = this.packSel.value || null;
      this.render();
      this.packSel.blur();
    });
    this.groupsEl.addEventListener('click', (e) => this.clicked(e));
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver((seen) => {
        for (const s of seen) if (s.isIntersecting) this.morePage(s.target);
      }, { root: this.groupsEl });
    }
    this.setTab('props');
  }

  /** The find box, focused (the `/` key). */
  focusFind(): void {
    this.find.focus();
    this.find.select();
  }

  /** Whether the find box has the keyboard (the game's keys are then the box's). */
  get typing(): boolean {
    return document.activeElement === this.find;
  }

  /** Show a source, or Recent, or Favourites. */
  setTab(t: Tab): void {
    this.tab = t;
    for (const [k, b] of this.srcButtons) b.classList.toggle('on', k === t);
    this.pack = t === 'world' || t === 'flora' ? this.host.defaultPack(t) : null;
    this.render();
  }

  /** Draw the groups again (the index arrived, a search changed, a tab moved). */
  render(): void {
    for (const s of this.pending.keys()) this.observer?.unobserve(s);
    this.pending.clear();
    this.groupsEl.replaceChildren();
    this.cells = 0;
    const v = this.host.view();
    this.sayEl.textContent = this.host.status();
    if (!v) return;
    const t = this.tab;
    // The world chooser: the packs this source's entries come from.
    if (t === 'world' || t === 'flora') {
      const packs = packsOf(v.entries, t);
      if (this.pack && !packs.includes(this.pack)) packs.unshift(this.pack);
      this.packSel.hidden = false;
      this.packSel.replaceChildren(...packs.map((p) => new Option(p, p, false, p === this.pack)));
      if (!this.pack && packs.length) this.pack = packs[0];
      this.packSel.value = this.pack ?? '';
    } else this.packSel.hidden = true;
    const q = this.find.value;
    let list: LibraryEntry[];
    if (t === 'recent' || t === 'favourites' || t === 'used') {
      const keys = t === 'recent' ? this.host.keep.recent : t === 'favourites' ? this.host.keep.favourites : this.host.usedHere();
      list = keys.map((k) => v.byKey.get(k)).filter((e): e is LibraryEntry => !!e);
      if (q.trim()) {
        const words = q.toLowerCase().split(/\s+/).filter(Boolean);
        list = list.filter((e) => words.every((w) => `${entryName(e)} ${e.id}`.toLowerCase().includes(w)));
      }
      this.group(t === 'recent' ? 'Recent' : t === 'favourites' ? 'Favourites' : 'Used here (in this world\'s files)', list, true);
      return;
    }
    list = searchLibrary(v, t, q, t === 'world' || t === 'flora' ? this.pack : null);
    const groups = groupsOf(list);
    const by = new Map<string, LibraryEntry[]>();
    for (const e of list) {
      const g = by.get(e.g);
      if (g) g.push(e);
      else by.set(e.g, [e]);
    }
    // A search opens every group it found something in; a plain browse opens the first.
    for (let i = 0; i < groups.length; i++) this.group(`${groups[i].id} (${groups[i].count})`, by.get(groups[i].id) ?? [], !!q.trim() || i === 0);
    if (!groups.length) this.sayEl.textContent = `${this.host.status()} · nothing found`;
  }

  /** One folding group: its cells built only once it is open, a page at a time. */
  private group(title: string, list: LibraryEntry[], open: boolean): void {
    const d = document.createElement('details');
    d.className = 'lib-group';
    const s = document.createElement('summary');
    s.textContent = title;
    d.appendChild(s);
    const grid = document.createElement('div');
    grid.className = 'lib-grid';
    d.appendChild(grid);
    const more = document.createElement('div');
    more.className = 'lib-more';
    d.appendChild(more);
    let built = false;
    const build = (): void => {
      if (built) return;
      built = true;
      this.pending.set(more, { list, page: 0, grid });
      this.morePage(more);
      this.observer?.observe(more);
    };
    d.addEventListener('toggle', () => {
      if (d.open) build();
    });
    this.groupsEl.appendChild(d);
    if (open) {
      d.open = true;
      build();
    }
  }

  /** The next page of a group, as its sentinel comes into view. */
  private morePage(sentinel: Element): void {
    const p = this.pending.get(sentinel);
    if (!p) return;
    const size = Math.max(1, LIBRARY_TUNE.page);
    const start = p.page * size;
    if (start >= p.list.length) {
      this.observer?.unobserve(sentinel);
      this.pending.delete(sentinel);
      return;
    }
    const held = this.host.held();
    const frag = document.createDocumentFragment();
    for (const e of p.list.slice(start, start + size)) frag.appendChild(this.cell(e, held));
    p.grid.appendChild(frag);
    p.page++;
  }

  /** One entry's cell: its picture or its initials, its name, its star. */
  private cell(e: LibraryEntry, held: string): HTMLElement {
    const key = entryKey(e);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'lib-cell';
    if (key === held) b.classList.add('held');
    b.dataset.key = key;
    const name = entryName(e);
    b.title = `${name}\n${e.id}${e.t ? `\n${e.t}` : ''}\n${e.p}`;
    if (e.pic) {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.decoding = 'async';
      img.alt = '';
      img.src = this.host.pictureUrl(e.pic);
      img.addEventListener('error', () => img.replaceWith(initials(name)), { once: true });
      b.appendChild(img);
    } else b.appendChild(initials(name));
    const n = document.createElement('span');
    n.className = 'lib-name';
    n.textContent = name;
    b.appendChild(n);
    const star = document.createElement('span');
    star.className = 'lib-star';
    star.textContent = '★';
    star.dataset.star = '1';
    if (this.host.keep.favourites.includes(key)) star.classList.add('on');
    b.appendChild(star);
    this.cells++;
    return b;
  }

  private clicked(e: MouseEvent): void {
    const t = e.target as HTMLElement | null;
    const cell = t?.closest<HTMLElement>('.lib-cell');
    if (!cell) return;
    const key = cell.dataset.key ?? '';
    const v = this.host.view();
    const entry = v?.byKey.get(key);
    // The focus goes back to the page, so the keys fly again.
    cell.blur();
    if (!entry) return;
    if (t?.dataset.star) {
      const on = this.host.keep.toggleFavourite(key);
      t.classList.toggle('on', on);
      return;
    }
    for (const c of this.groupsEl.querySelectorAll('.lib-cell.held')) c.classList.remove('held');
    cell.classList.add('held');
    this.host.take(entry);
  }

  dispose(): void {
    this.observer?.disconnect();
    window.clearTimeout(this.findTimer);
    this.root.remove();
  }
}

/** A name's initials, where an entry has no picture. */
function initials(name: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'lib-initials';
  el.textContent =
    name
      .split(/[\s_-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '?';
  return el;
}
