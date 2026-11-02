// The Graphics page laid out to be found (the owner's ask of 2026-11-02: "honestly so are the graphics options"): its
// sections under a handful of sub-tabs across its top, the Volumetrics sub-tab's sections folding, and a find box that
// filters every row on the page by its label and hint across every sub-tab, saying which sub-tab each match stands in.
//
// What is drawn is the menu's own rows (`knobRows`, handed in), wired by the menu's own `wireKnobs`, so every knob applies
// live, greys by what it `requires`, resets and is drawn again from the console exactly as it was; this file only says
// where each section stands and which are shown. Two tables are the owner's to regroup, one line each: `GRAPHICS_TABS`
// (the sub-tabs and their order) and `GRAPHICS_TAB_OF` (which sub-tab a section stands in); `GRAPHICS_FOLDED` says which
// start folded. A file of its own for the reason `floraPage.ts` is: a node test drives it through a stand-in page. Nothing
// here runs in a frame.

import { FoldStore, keepWord, keptWord } from './folds.ts';
import type { Knob } from './hudPage.ts';

/** A sub-tab: its id, its words, and whether its sections fold. */
export interface GraphicsTab {
  readonly id: string;
  readonly label: string;
  readonly folds?: boolean;
}

/** The sub-tabs, in the order they stand across the page (the owner's: moving one is one line). */
export const GRAPHICS_TABS: readonly GraphicsTab[] = [
  { id: 'picture', label: 'Picture and effects' },
  { id: 'shadows', label: 'Shadows and distance' },
  { id: 'flora', label: 'Flora' },
  { id: 'water', label: 'Water and weather' },
  { id: 'space', label: 'Space' },
  // Twelve sections and the longest of them: its sections fold.
  { id: 'volumetrics', label: 'Volumetrics', folds: true },
];

/**
 * Which sub-tab each section stands in, by the section's title (the owner's: moving a section is one line). A section
 * this table does not name stands in the sub-tab of the section before it, so one a later wave adds among the
 * Volumetrics sections stays among them.
 */
export const GRAPHICS_TAB_OF: Readonly<Record<string, string>> = {
  Picture: 'picture',
  Effects: 'picture',
  Shadows: 'shadows',
  'Distance and detail': 'shadows',
  Flora: 'flora',
  Water: 'water',
  Weather: 'water',
  Space: 'space',
  Volumetrics: 'volumetrics',
  'Dust in the picture': 'volumetrics',
  'The moving air': 'volumetrics',
  'Smoke and fog': 'volumetrics',
  'What the air carries besides dust': 'volumetrics',
  "The dust's look": 'volumetrics',
  'The ground, water and lava': 'volumetrics',
  "Over the game's own art": 'volumetrics',
  'The wind': 'volumetrics',
  'The clouds': 'volumetrics',
  "The clouds' look": 'volumetrics',
  'What stirs the air': 'volumetrics',
};

/**
 * The sections of a folding sub-tab that start folded (the owner's, one line): every Volumetrics section but the master's,
 * so the sub-tab opens on the master switch, the preset and a list of headings to open.
 */
export const GRAPHICS_FOLDED: readonly string[] = [
  'Dust in the picture',
  'The moving air',
  'Smoke and fog',
  'What the air carries besides dust',
  "The dust's look",
  'The ground, water and lava',
  "Over the game's own art",
  'The wind',
  'The clouds',
  "The clouds' look",
  'What stirs the air',
];

/** Where the page keeps, in this browser, the sub-tab open last and what is folded. */
export const GRAPHICS_TAB_KEY = 'swg.graphics.tab';
export const GRAPHICS_FOLDS_KEY = 'swg.graphics.folds';

/** What the page keeps between its drawings: the sub-tab, the find, the folds and each sub-tab's scroll. */
export class GraphicsLayout {
  /** The sub-tab open, remembered in this browser (the first where none is kept or the kept one is gone). */
  tab: string;
  /** What the find box holds; '' for none. Kept while the menu stands on the page, put down when it leaves. */
  find = '';
  readonly folds = new FoldStore(GRAPHICS_FOLDS_KEY, GRAPHICS_FOLDED);
  /** Where each sub-tab's scroll stood, to stand there again when it comes back. */
  readonly scrolls = new Map<string, number>();

  constructor() {
    const kept = keptWord(GRAPHICS_TAB_KEY);
    this.tab = GRAPHICS_TABS.some((t) => t.id === kept) ? (kept as string) : GRAPHICS_TABS[0].id;
  }
}

/** Every section's sub-tab, in the page's order: the table's word, else the sub-tab of the section before it. */
export function graphicsTabs(titles: readonly string[]): string[] {
  const out: string[] = [];
  let last = GRAPHICS_TABS[0].id;
  for (const title of titles) {
    const named = Object.prototype.hasOwnProperty.call(GRAPHICS_TAB_OF, title) ? GRAPHICS_TAB_OF[title] : null;
    last = named && GRAPHICS_TABS.some((t) => t.id === named) ? named : last;
    out.push(last);
  }
  return out;
}

/** A word for an attribute or a tag's text. */
function escaped(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

/**
 * The page's sub-tabs, find box and sections, every section in its sub-tab and in the page's order: each a `gfx-sec`
 * carrying its sub-tab and its title, its heading (which says its sub-tab while a find shows it) and its rows. Which are
 * shown is `showGraphics`'s, so this is the same text whatever is shown. The find box is a plain text field, not a search
 * field, whose clearing cross the browser draws in a colour of its own; Escape is its clear.
 */
export function graphicsMarkup(sections: readonly { title: string; knobs: readonly Knob[] }[], rows: (knobs: readonly Knob[]) => string, layout: GraphicsLayout): string {
  const tabsOf = graphicsTabs(sections.map((s) => s.title));
  const bar = `<div class="gfx-bar"><div class="gfx-tabs">${GRAPHICS_TABS.map((t) => `<button type="button" data-gfx-tab="${t.id}">${escaped(t.label)}</button>`).join('')}</div><input class="gfx-find" type="text" placeholder="Find a setting" spellcheck="false" value="${escaped(layout.find)}" /></div>`;
  const none = '<p class="menu-hint gfx-none gfx-out">Nothing on the page matches. Escape in the box clears it.</p>';
  const body = sections
    .map((s, i) => {
      const tab = GRAPHICS_TABS.find((t) => t.id === tabsOf[i])!;
      return `<div class="gfx-sec${tab.folds ? ' gfx-folds' : ''}" data-gfx-tab="${tab.id}" data-sec="${escaped(s.title)}"><h3>${escaped(s.title)}<span class="gfx-in">${escaped(tab.label)}</span></h3><div class="gfx-rows">${rows(s.knobs)}</div></div>`;
    })
    .join('');
  return `${bar}${none}${body}`;
}

/** The find's words, each to be found in a row's label or hint, any case. */
export function findTerms(find: string): string[] {
  return find.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Whether a row's words hold every term of a find. */
export function rowMatches(text: string, terms: readonly string[]): boolean {
  const t = text.toLowerCase();
  return terms.every((w) => t.includes(w));
}

/**
 * The page shown as the layout says: with no find, the sub-tab's sections alone, a folded one by its heading; with a
 * find, every section of every sub-tab holding a row that matches, folded or not, with only its matching rows, each
 * heading saying its sub-tab. Writes classes only, never the page's text, so it is called after every change.
 */
export function showGraphics(page: HTMLElement, layout: GraphicsLayout): void {
  const terms = findTerms(layout.find);
  const finding = terms.length > 0;
  page.classList.toggle('gfx-finding', finding);
  for (const b of page.querySelectorAll<HTMLElement>('.gfx-tabs button[data-gfx-tab]')) b.classList.toggle('on', !finding && b.dataset.gfxTab === layout.tab);
  let shown = 0;
  for (const sec of page.querySelectorAll<HTMLElement>('.gfx-sec')) {
    let any = false;
    for (const k of sec.querySelectorAll<HTMLElement>('.knob')) {
      const hit = !finding || rowMatches(k.querySelector<HTMLElement>('.knob-label')?.textContent ?? '', terms);
      k.classList.toggle('gfx-out', !hit);
      if (hit) any = true;
    }
    const folded = sec.classList.contains('gfx-folds') && layout.folds.folded(sec.dataset.sec ?? '');
    sec.classList.toggle('gfx-folded', !finding && folded);
    sec.querySelector<HTMLElement>('.gfx-rows')?.classList.toggle('gfx-out', !finding && folded);
    const on = finding ? any : sec.dataset.gfxTab === layout.tab;
    sec.classList.toggle('gfx-out', !on);
    if (on) shown++;
  }
  page.querySelector<HTMLElement>('.gfx-none')?.classList.toggle('gfx-out', !(finding && shown === 0));
}

/** What the page's own wiring needs of the menu: its scroller (the menu's body) and its interface sound. */
export interface GraphicsHooks {
  scroller: HTMLElement;
  sound(action: 'select'): void;
}

/**
 * The sub-tabs, the find box and the folding headings wired: a sub-tab clicked shows it (its scroll as it was left) and is
 * remembered, the find filters as it is typed and Escape in the box clears it and stops there (it never reaches the
 * menu's own Escape), and a folding heading folds and unfolds, remembered.
 */
export function wireGraphics(page: HTMLElement, layout: GraphicsLayout, hooks: GraphicsHooks): void {
  showGraphics(page, layout);
  for (const b of page.querySelectorAll<HTMLButtonElement>('.gfx-tabs button[data-gfx-tab]')) {
    b.addEventListener('click', () => {
      const t = b.dataset.gfxTab ?? '';
      const finding = findTerms(layout.find).length > 0;
      if (t === layout.tab && !finding) return;
      if (!finding) layout.scrolls.set(layout.tab, hooks.scroller.scrollTop);
      layout.tab = t;
      layout.find = '';
      const find = page.querySelector<HTMLInputElement>('.gfx-find');
      if (find) find.value = '';
      keepWord(GRAPHICS_TAB_KEY, t);
      showGraphics(page, layout);
      hooks.scroller.scrollTop = layout.scrolls.get(t) ?? 0;
      hooks.sound('select');
      b.blur();
    });
  }
  const find = page.querySelector<HTMLInputElement>('.gfx-find');
  if (find) {
    find.addEventListener('input', () => {
      const was = findTerms(layout.find).length > 0;
      if (!was) layout.scrolls.set(layout.tab, hooks.scroller.scrollTop);
      layout.find = find.value;
      showGraphics(page, layout);
      // Back to the sub-tab's own page when the find is emptied by hand.
      if (was && !findTerms(layout.find).length) hooks.scroller.scrollTop = layout.scrolls.get(layout.tab) ?? 0;
    });
    find.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      // The box's own Escape: it clears the find and gives the keyboard back, and the menu never hears it.
      e.preventDefault();
      e.stopPropagation();
      const was = findTerms(layout.find).length > 0;
      find.value = '';
      layout.find = '';
      showGraphics(page, layout);
      if (was) hooks.scroller.scrollTop = layout.scrolls.get(layout.tab) ?? 0;
      find.blur();
    });
  }
  for (const sec of page.querySelectorAll<HTMLElement>('.gfx-sec.gfx-folds')) {
    const h = sec.querySelector<HTMLElement>('h3');
    h?.addEventListener('click', () => {
      if (findTerms(layout.find).length) return;
      const id = sec.dataset.sec ?? '';
      layout.folds.set(id, !layout.folds.folded(id));
      showGraphics(page, layout);
    });
  }
}
