// The backpack: what the character owns, as the game showed it, a picture and a name to each item.
// Two areas, "Worn and held" (the two hands, then every worn piece head to foot) and "Backpack" (the
// rest), and an examine pane with the game's own description of the item picked. A double-click puts
// on or takes off, as SWG's own inventory did; shift and a double-click puts a blade in the left hand.
//
// The pictures are baked by the converter and shown as <img>, decoded off the main thread: no GL, so
// opening the panel never compiles a shader. The panel is DOM, rebuilt on a change, never per frame.
import type { Fit } from '../core/inventory';
import { INVENTORY_TABS, tabStrip, wireTabs } from './tabs';
import { escapeHtml } from './catalogue';

export interface BackpackCell {
  key: string;
  kind: 'wear' | 'weapon';
  id: string;
  name: string;
  icon: string | null;
  where: 'pack' | 'worn' | 'right' | 'left';
  fit: Fit;
  missing: boolean;
  unseen: boolean;
  busy: boolean;
  isNew: boolean;
  kindText: string;
  slotsText: string;
  description: string;
  canLeft: boolean;
  /** Sort order within its area (lower first); ties by name. */
  order: number;
  /** What the examine pane says about the species' rule or a missing item ("Wookiees cannot wear this"). */
  fitNote?: string;
}

export interface BackpackModel {
  cells: BackpackCell[];
  note?: string;
  /** What each hand shows while empty: the class's stand-in ('the plain saber') or null. */
  standIn: { right: string | null; left: string | null };
  noWardrobe: boolean;
}

/** How long the Destroy button waits for its second click, ms. */
const DESTROY_WINDOW = 3000;

export class BackpackUi {
  readonly root: HTMLElement;
  open = false;
  /** A click on another tab: the game swaps the panels. */
  onTab: (id: string) => void = () => {};
  /** A double-click, Enter, or the Equip and Left hand buttons. */
  onUse: (key: string, hand?: 'left') => void = () => {};
  onDestroy: (key: string) => void = () => {};
  /**
   * The Trade button: ask whoever this player is standing by and looking at. Nothing here knows what
   * a trade is -- the wiring hands it to the ledger, which is what refuses it when there is no
   * server, nobody there, or they are past the game's own 8 m.
   */
  onTrade: () => void = () => {};

  private readonly count: HTMLElement;
  private readonly find: HTMLInputElement;
  private readonly hands: HTMLElement;
  private readonly wornGrid: HTMLElement;
  private readonly packGrid: HTMLElement;
  private readonly packCount: HTMLElement;
  private readonly examine: HTMLElement;
  private readonly note: HTMLElement;
  private model: BackpackModel = { cells: [], standIn: { right: null, left: null }, noWardrobe: false };
  private selected: string | null = null;
  /** The key a first Delete (or Destroy click) armed, and until when. */
  private armed: { key: string; until: number } | null = null;
  private armTimer = 0;
  /** The newest item already scrolled to, so a re-render does not scroll again. */
  private shownNew: string | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'backpack';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="wardrobe-panel backpack-panel" tabindex="-1">
        <div class="wardrobe-header">
          ${tabStrip(INVENTORY_TABS, 'backpack')}
          <span class="count"></span>
          <input class="find" placeholder="find" />
          <button class="trade">Trade</button>
          <button class="close">Close <b>I</b></button>
        </div>
        <div class="backpack-main">
          <section class="bp-area bp-worn">
            <h3 class="bp-title">Worn and held</h3>
            <div class="bp-grid bp-hands" data-area="hands"></div>
            <div class="bp-grid" data-area="worn"></div>
          </section>
          <section class="bp-area bp-pack">
            <h3 class="bp-title">Backpack <span class="bp-pack-count"></span></h3>
            <div class="bp-grid" data-area="pack"></div>
          </section>
        </div>
        <div class="bp-examine"></div>
        <div class="bp-hint"><span class="bp-note"></span>double-click to put on or take off · shift+double-click: a blade to the left hand · Delete twice destroys</div>
      </div>`;
    parent.appendChild(this.root);
    this.count = this.root.querySelector('.count')!;
    this.find = this.root.querySelector('.find')!;
    this.hands = this.root.querySelector('[data-area="hands"]')!;
    this.wornGrid = this.root.querySelector('[data-area="worn"]')!;
    this.packGrid = this.root.querySelector('[data-area="pack"]')!;
    this.packCount = this.root.querySelector('.bp-pack-count')!;
    this.examine = this.root.querySelector('.bp-examine')!;
    this.note = this.root.querySelector('.bp-note')!;
    this.root.querySelector('.close')!.addEventListener('click', () => this.hide());
    this.root.querySelector('.trade')!.addEventListener('click', () => this.onTrade());
    wireTabs(this.root, 'backpack', (id) => this.onTab(id));
    this.find.addEventListener('input', () => this.render(this.model));
    // A click on the backdrop closes it; one inside must not.
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) {
        this.hide();
        return;
      }
      const cell = (e.target as HTMLElement).closest<HTMLElement>('.bp-cell[data-key]');
      if (cell) this.select(cell.dataset.key!);
      const act = (e.target as HTMLElement).closest<HTMLElement>('button[data-act]');
      if (act) this.act(act.dataset.act!);
    });
    this.root.addEventListener('dblclick', (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('.bp-cell[data-key]');
      if (!cell) return;
      const c = this.cell(cell.dataset.key!);
      if (!c) return;
      this.select(c.key);
      this.use(c, e.shiftKey);
    });
    // A picture that will not load shows the name's initials instead (error events do not bubble).
    this.root.addEventListener(
      'error',
      (e) => {
        const img = e.target as HTMLElement;
        if (img.tagName !== 'IMG' || !img.parentElement) return;
        const name = img.closest<HTMLElement>('.bp-cell')?.dataset.name ?? '';
        img.replaceWith(initials(name));
      },
      true,
    );
    this.root.addEventListener('keydown', (e) => this.key(e));
  }

  private cell(key: string): BackpackCell | undefined {
    return this.model.cells.find((c) => c.key === key);
  }

  private use(c: BackpackCell, left: boolean): void {
    if (c.missing || c.busy) return;
    this.onUse(c.key, left && c.canLeft ? 'left' : undefined);
  }

  /** The examine pane's buttons. */
  private act(what: string): void {
    const c = this.selected ? this.cell(this.selected) : undefined;
    if (!c) return;
    if (what === 'use') this.use(c, false);
    else if (what === 'left') this.use(c, true);
    else if (what === 'destroy') this.destroy(c);
  }

  /** Destroy asks twice: the first press arms it for three seconds, the second destroys. Not while it is being put on or taken up. */
  private destroy(c: BackpackCell): void {
    if (c.busy) return;
    const now = performance.now();
    if (this.armed && this.armed.key === c.key && now < this.armed.until) {
      this.armed = null;
      window.clearTimeout(this.armTimer);
      this.onDestroy(c.key);
      return;
    }
    this.armed = { key: c.key, until: now + DESTROY_WINDOW };
    window.clearTimeout(this.armTimer);
    this.armTimer = window.setTimeout(() => {
      this.armed = null;
      this.drawExamine();
    }, DESTROY_WINDOW);
    this.drawExamine();
  }

  /** Arrows move in the grid the selection is in; Enter uses (Shift+Enter to the left hand); Delete twice destroys. */
  private key(e: KeyboardEvent): void {
    if (e.target === this.find) return;
    const c = this.selected ? this.cell(this.selected) : undefined;
    if (e.key === 'Enter' && c) {
      e.preventDefault();
      this.use(c, e.shiftKey);
      return;
    }
    if (e.key === 'Delete' && c) {
      e.preventDefault();
      this.destroy(c);
      return;
    }
    if (!e.key.startsWith('Arrow')) return;
    e.preventDefault();
    const el = this.selected ? this.root.querySelector<HTMLElement>(`.bp-cell[data-key="${cssEscape(this.selected)}"]`) : null;
    const grid = el?.parentElement ?? this.packGrid;
    const cells = [...grid.querySelectorAll<HTMLElement>('.bp-cell[data-key]')];
    if (!cells.length) return;
    let i = el ? cells.indexOf(el) : -1;
    const top = cells[0].offsetTop;
    let cols = cells.findIndex((x) => x.offsetTop !== top);
    if (cols < 0) cols = cells.length;
    if (i < 0) i = 0;
    else if (e.key === 'ArrowRight') i = Math.min(cells.length - 1, i + 1);
    else if (e.key === 'ArrowLeft') i = Math.max(0, i - 1);
    else if (e.key === 'ArrowDown') i = Math.min(cells.length - 1, i + cols);
    else if (e.key === 'ArrowUp') i = Math.max(0, i - cols);
    this.select(cells[i].dataset.key!);
  }

  /** Draw the model; the selection, the find text and each grid's scroll are kept. */
  render(model: BackpackModel): void {
    this.model = model;
    const find = this.find.value.trim().toLowerCase();
    const matches = (c: BackpackCell) => !find || c.name.toLowerCase().includes(find) || c.id.toLowerCase().includes(find) || c.kindText.toLowerCase().includes(find);
    const byOrder = (a: BackpackCell, b: BackpackCell) => a.order - b.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    const worn = model.cells.filter((c) => c.where === 'worn').sort(byOrder);
    const right = model.cells.find((c) => c.where === 'right') ?? null;
    const left = model.cells.find((c) => c.where === 'left') ?? null;
    const pack = model.cells.filter((c) => c.where === 'pack').sort(byOrder);
    const shown = pack.filter(matches);
    const scroll = [this.wornGrid.scrollTop, this.packGrid.scrollTop];
    this.hands.innerHTML = [this.handHtml('right', right), this.handHtml('left', left)].join('');
    this.wornGrid.innerHTML = model.noWardrobe ? `<div class="bp-empty">no wardrobe converted: clothes cannot be shown</div>` : worn.map((c) => this.cellHtml(c)).join('') || `<div class="bp-empty">nothing worn</div>`;
    this.packGrid.innerHTML = shown.map((c) => this.cellHtml(c)).join('') || `<div class="bp-empty">${pack.length ? 'nothing matches' : 'empty'}</div>`;
    this.wornGrid.scrollTop = scroll[0];
    this.packGrid.scrollTop = scroll[1];
    const held = (right ? 1 : 0) + (left ? 1 : 0);
    this.count.textContent = `${model.cells.length} items · ${worn.length} worn · ${held} held`;
    this.packCount.textContent = `(${pack.length})`;
    this.note.textContent = model.note ? `${model.note} · ` : '';
    if (this.selected && !this.cell(this.selected)) this.selected = null;
    this.markSelected();
    this.drawExamine();
    // The newest item given glows for a moment and is scrolled into view, once.
    const fresh = model.cells.find((c) => c.isNew);
    if (fresh && fresh.key !== this.shownNew && this.open) {
      this.shownNew = fresh.key;
      this.root.querySelector<HTMLElement>(`.bp-cell[data-key="${cssEscape(fresh.key)}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  }

  private handHtml(hand: 'right' | 'left', c: BackpackCell | null): string {
    if (c) return this.cellHtml(c, `${hand} hand`);
    const stand = this.model.standIn[hand];
    return `<div class="bp-cell bp-hand empty"><span class="bp-pic"><span class="bp-initials">${hand === 'right' ? 'R' : 'L'}</span></span><span class="bp-name">${hand} hand<br><em>empty</em></span>${stand ? `<span class="bp-standin">using ${escapeHtml(stand)}</span>` : ''}</div>`;
  }

  private cellHtml(c: BackpackCell, label?: string): string {
    const cls = ['bp-cell', c.where === 'worn' ? 'worn' : '', c.where === 'right' || c.where === 'left' ? 'held' : '', c.fit === 'block' ? 'block' : '', c.fit === 'hide' || c.unseen ? 'hide' : '', c.missing ? 'missing' : '', c.busy ? 'busy' : '', c.isNew ? 'new' : '', c.key === this.selected ? 'sel' : ''].filter(Boolean).join(' ');
    const pic = c.icon ? `<img src="${escapeHtml(c.icon)}" loading="lazy" decoding="async" alt="">` : initials(c.name).outerHTML;
    const busy = c.busy ? `<span class="bp-busy">${c.kind === 'weapon' ? 'taking up...' : 'putting on...'}</span>` : '';
    const title = `${c.name}${c.fitNote ? ` · ${c.fitNote}` : ''}`;
    return `<button class="${cls}" data-key="${escapeHtml(c.key)}" data-name="${escapeHtml(c.name)}" title="${escapeHtml(title)}"><span class="bp-pic">${pic}${busy}</span><span class="bp-name">${label ? `<small>${label}</small><br>` : ''}${escapeHtml(c.name)}</span></button>`;
  }

  private markSelected(): void {
    for (const el of this.root.querySelectorAll<HTMLElement>('.bp-cell[data-key]')) el.classList.toggle('sel', el.dataset.key === this.selected);
  }

  /** Pick an item (or none): the examine pane shows it, and the keyboard moves from it. */
  select(key: string | null): void {
    this.selected = key && this.cell(key) ? key : null;
    if (this.armed && this.armed.key !== this.selected) this.armed = null;
    this.markSelected();
    this.drawExamine();
    if (this.selected) this.root.querySelector<HTMLElement>(`.bp-cell[data-key="${cssEscape(this.selected)}"]`)?.focus({ preventScroll: false });
  }

  private drawExamine(): void {
    const c = this.selected ? this.cell(this.selected) : undefined;
    if (!c) {
      this.examine.innerHTML = `<div class="bp-examine-empty">click an item to examine it</div>`;
      return;
    }
    const on = c.where !== 'pack';
    const pic = c.icon ? `<img src="${escapeHtml(c.icon)}" decoding="async" alt="">` : initials(c.name).outerHTML;
    const head = [escapeHtml(c.name), escapeHtml(c.kindText), c.slotsText ? escapeHtml(c.slotsText) : ''].filter(Boolean).join(' · ');
    const paragraphs = (c.description || '').split(/\n\s*\n/).filter((p) => p.trim()).map((p) => `<p>${escapeHtml(p.trim())}</p>`).join('');
    const state = c.busy ? (c.kind === 'weapon' ? 'taking up...' : 'putting on...') : c.where === 'right' || c.where === 'left' ? `in the ${c.where} hand` : c.where === 'worn' ? 'worn' : '';
    const armed = this.armed?.key === c.key;
    const useText = on ? (c.kind === 'weapon' ? 'Put away' : 'Take off') : 'Equip';
    const blocked = c.missing || (c.fit === 'block' && !on) || c.busy;
    const buttons = [
      `<button data-act="use"${blocked ? ' disabled' : ''}>${useText}</button>`,
      c.canLeft && c.where !== 'left' ? `<button data-act="left"${c.missing || c.busy ? ' disabled' : ''}>Left hand</button>` : '',
      `<button data-act="destroy" class="${armed ? 'armed' : ''}"${c.busy ? ' disabled' : ''}>${armed ? 'Destroy for good?' : 'Destroy'}</button>`,
    ].join('');
    this.examine.innerHTML = `<div class="bp-examine-pic">${pic}</div><div class="bp-examine-text"><div class="bp-examine-head">${head}</div>${c.fitNote ? `<div class="bp-fit ${c.fit}">${escapeHtml(c.fitNote)}</div>` : ''}${state ? `<div class="bp-state">${state}</div>` : ''}${paragraphs || '<p class="bp-nodesc">The game says nothing more about it.</p>'}${armed ? '<p class="bp-warn">Press Delete or Destroy again to destroy it for good.</p>' : ''}</div><div class="bp-actions">${buttons}</div>`;
  }

  show(): void {
    this.open = true;
    this.root.classList.remove('hidden');
    this.root.querySelector<HTMLElement>('.backpack-panel')?.focus({ preventScroll: true });
  }

  hide(): void {
    this.open = false;
    this.armed = null;
    window.clearTimeout(this.armTimer);
    this.root.classList.add('hidden');
  }

  toggle(): boolean {
    if (this.open) this.hide();
    else this.show();
    return this.open;
  }

  /** For the console: what is shown. */
  state(): { open: boolean; cells: number; pack: number; worn: number; selected: string | null; noIcon: number } {
    const cells = this.model.cells;
    return {
      open: this.open,
      cells: cells.length,
      pack: cells.filter((c) => c.where === 'pack').length,
      worn: cells.filter((c) => c.where === 'worn').length,
      selected: this.selected,
      noIcon: cells.filter((c) => !c.icon).length,
    };
  }
}

/** A name's initials in a circle, where there is no picture. */
function initials(name: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'bp-initials';
  const words = name.split(/[\s_-]+/).filter((w) => /[A-Za-z0-9]/.test(w));
  el.textContent = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
  return el;
}

/** A key for a CSS attribute selector (ids hold only word characters and colons, but quotes are escaped all the same). */
function cssEscape(s: string): string {
  return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');
}
