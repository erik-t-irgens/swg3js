// The Props tab: every prop and every piece of furniture in the game, and a double-click takes one
// in hand to put down.
//
// Eight and a half thousand things is far too many to read as a list, so it is the give screen's own
// arrangement -- folding groups of pictures, a page at a time, with a find box over the lot and an
// examine strip at the foot. That is the one thing this game already has for a catalogue of that
// size, and it is reused rather than reinvented: the cells, the groups, the paging and the picture
// fallback are all `giveModel.ts`'s and `catalogue.ts`'s.
//
// Nothing about placing is decided here. A pick hands the id to the game and the world goes into
// placing, exactly as the Housing tab hands over a deed.
//
// It carries no colours of its own, so it wears the same eighteen every other panel does.

import { INVENTORY_TABS, tabStrip, wireTabs } from './tabs.ts';
import { GroupState, escapeHtml, groupShell } from './catalogue.ts';
import { GIVE_TUNE, buildPropView, giveCellHtml, openGroups, type GiveView, type PropRow } from './giveModel.ts';
import type { PropCatalogue, PropDef } from '../world/propCatalogue.ts';

export class PropsUi {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly count: HTMLElement;
  private readonly find: HTMLInputElement;
  private readonly examine: HTMLElement;
  private catalogue: PropCatalogue | null = null;
  private readonly groups = new GroupState();
  private lastFind = '';
  private view: GiveView | null = null;
  private readonly drawn = new Map<string, number>();
  private selected: string | null = null;
  private findTimer = 0;
  open = false;
  /** The prop in hand now, so its cell can be marked. */
  held: string | null = null;
  onTab: (id: string) => void = () => {};
  /** A double-click, Enter, or the Place button: take this prop in hand. */
  onPlace: (id: string) => void = () => {};
  /** The player asked to close: the mouse goes back to the game. */
  onClose: () => void = () => {};

  private dismiss(): void {
    this.hide();
    this.onClose();
  }

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'props';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="wardrobe-panel wide give-panel">
        <div class="wardrobe-header">
          ${tabStrip(INVENTORY_TABS, 'props')}
          <span class="count"></span>
          <input class="find" placeholder="find" spellcheck="false" />
          <button class="close">Close <b>I</b></button>
        </div>
        <div class="wardrobe-main"><div class="wardrobe-body props-body give-body"></div></div>
        <div class="bp-examine"></div>
        <div class="bp-hint">double-click to take one in hand · then the wheel moves it, the turn keys turn it and a click puts it down</div>
      </div>`;
    parent.appendChild(this.root);
    this.body = this.root.querySelector('.props-body')!;
    this.count = this.root.querySelector('.count')!;
    this.find = this.root.querySelector('.find')!;
    this.examine = this.root.querySelector('.bp-examine')!;
    this.root.querySelector('.close')!.addEventListener('click', () => this.dismiss());
    wireTabs(this.root, 'props', (id) => this.onTab(id));
    // The find box is in the header and is never redrawn, so it keeps its focus while the body changes.
    this.find.addEventListener('input', () => {
      window.clearTimeout(this.findTimer);
      this.findTimer = window.setTimeout(() => this.render(), GIVE_TUNE.findMs);
    });
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) {
        this.dismiss();
        return;
      }
      const target = e.target as HTMLElement;
      const more = target.closest<HTMLElement>('button[data-more]');
      if (more) {
        this.fill(more.dataset.more!, true);
        return;
      }
      const place = target.closest<HTMLElement>('button[data-place]');
      if (place) {
        e.preventDefault();
        e.stopPropagation();
        this.take(place.dataset.place!);
        return;
      }
      const cell = target.closest<HTMLElement>('.bp-cell[data-id]');
      if (cell) this.select(cell.dataset.id!);
    });
    this.body.addEventListener('dblclick', (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('.bp-cell[data-id]');
      if (!cell) return;
      this.select(cell.dataset.id!);
      this.take(cell.dataset.id!);
    });
    this.body.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const cell = (e.target as HTMLElement).closest<HTMLElement>('.bp-cell[data-id]');
      if (!cell) return;
      e.preventDefault();
      this.select(cell.dataset.id!);
      this.take(cell.dataset.id!);
    });
    // A group opened for the first time draws its cells ('toggle' does not bubble: caught going down).
    this.body.addEventListener(
      'toggle',
      (e) => {
        const d = e.target as HTMLDetailsElement;
        if (d?.tagName === 'DETAILS' && d.open) this.fill(d.dataset.key ?? '', false);
      },
      true,
    );
    // A picture that will not load shows the name's initials instead (error events do not bubble).
    this.root.addEventListener(
      'error',
      (e) => {
        const img = e.target as HTMLElement;
        if (img.tagName !== 'IMG' || !img.parentElement) return;
        const el = document.createElement('span');
        el.className = 'bp-initials';
        el.textContent = img.closest<HTMLElement>('[data-initials]')?.dataset.initials ?? '?';
        img.replaceWith(el);
      },
      true,
    );
  }

  attach(catalogue: PropCatalogue | null): void {
    this.catalogue = catalogue;
    this.render();
  }

  render(): void {
    const c = this.catalogue;
    this.drawn.clear();
    if (!c || !c.loaded) {
      this.count.textContent = '';
      this.view = null;
      this.body.innerHTML = `<p class="hint">${escapeHtml(c?.note || 'The props are still loading.')}</p>`;
      this.drawExamine();
      return;
    }
    const find = this.find.value.trim().toLowerCase();
    if (find !== this.lastFind) this.groups.clear();
    this.lastFind = find;
    const order = c.groups().map((g) => ({ id: g.id, label: g.label }));
    this.view = buildPropView(c.all as readonly PropRow[], { find, held: this.held, order, iconUrl: (p) => c.iconUrl(p) });
    const wanted = openGroups(this.view, find);
    const html: string[] = [];
    for (const g of this.view.groups) html.push(groupShell(g.id, g.label, g.cells.length, '', this.groups.isOpen(g.id, wanted.has(g.id))));
    if (!this.view.groups.length) html.push(`<div class="wardrobe-empty">nothing here matches “${escapeHtml(find)}”</div>`);
    // Where the list was is kept: at eight thousand entries a list that jumped to the top on every
    // pick would be unusable.
    const scroll = this.body.scrollTop;
    this.body.innerHTML = html.join('');
    this.groups.wire(this.body);
    for (const d of this.body.querySelectorAll<HTMLDetailsElement>('details.cat-group[open]')) this.fill(d.dataset.key ?? '', false);
    this.body.scrollTop = scroll;
    const v = this.view;
    const line = [
      v.shown === v.listed ? `${v.listed} props` : `${v.shown} of ${v.listed} props`,
      v.pictures < v.shown ? `${v.pictures} different pictures: a family shares one model` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    this.count.textContent = line;
    this.count.title = line;
    if (this.selected && !this.cell(this.selected)) this.selected = null;
    this.drawExamine();
  }

  /** Draw a group's cells: its first page when opened, the next when the button under it is pressed. */
  private fill(key: string, more: boolean): void {
    const g = this.view?.groups.find((x) => x.id === key);
    if (!g) return;
    let grid: HTMLElement | null = null;
    for (const el of this.body.querySelectorAll<HTMLElement>('[data-body]')) if (el.dataset.body === key) grid = el;
    if (!grid) return;
    if (!more && grid.querySelector('.bp-cell')) return;
    const from = this.drawn.get(key) ?? 0;
    if (from >= g.cells.length) return;
    const to = Math.min(g.cells.length, from + GIVE_TUNE.page);
    const cells: string[] = [];
    for (let i = from; i < to; i++) cells.push(giveCellHtml(g.cells[i], { on: 'held', selected: this.selected === g.cells[i].id }));
    grid.querySelector('.give-more')?.remove();
    grid.insertAdjacentHTML('beforeend', cells.join(''));
    if (to < g.cells.length) grid.insertAdjacentHTML('beforeend', `<div class="cat-wide give-more"><button data-more="${escapeHtml(key)}">show the next ${Math.min(GIVE_TUNE.page, g.cells.length - to)} of ${g.cells.length - to} more</button></div>`);
    this.drawn.set(key, to);
  }

  private cell(id: string): { id: string; name: string; note: string; description: string } | null {
    for (const g of this.view?.groups ?? []) for (const c of g.cells) if (c.id === id) return c;
    return null;
  }

  private select(id: string): void {
    this.selected = id;
    for (const el of this.body.querySelectorAll<HTMLElement>('.bp-cell')) el.classList.toggle('on', el.dataset.id === id);
    this.drawExamine();
  }

  private take(id: string): void {
    this.onPlace(id);
  }

  private drawExamine(): void {
    const c = this.selected ? this.cell(this.selected) : null;
    if (!c) {
      this.examine.innerHTML = `<span class="bp-none">pick one to read what it is</span>`;
      return;
    }
    const def: PropDef | null = this.catalogue?.find(c.id) ?? null;
    const bits = [c.note, def ? def.group : ''].filter(Boolean).join(' · ');
    this.examine.innerHTML = `<b>${escapeHtml(c.name)}</b>${bits ? ` <span class="bp-sub">${escapeHtml(bits)}</span>` : ''}${c.description ? `<span class="bp-desc">${escapeHtml(c.description)}</span>` : ''}<button data-place="${escapeHtml(c.id)}">Place</button>`;
  }

  show(): void {
    this.open = true;
    this.root.classList.remove('hidden');
    this.render();
  }

  hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
  }
}
