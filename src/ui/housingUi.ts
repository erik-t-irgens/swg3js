// The Housing tab: the deeds a character owns, and what each one would put down.
//
// A double-click takes a deed in hand and the world goes into placing: the ghost of the building
// appears, the grid the client itself drew goes under it, and the bar under the world offers the
// turns. Nothing about placing is decided here.
//
// It is built exactly as the backpack is -- the inventory's own tab strip in the header, a list,
// an examine pane -- and carries no colours of its own, so it wears the same eighteen every other
// panel does.

import { INVENTORY_TABS, tabStrip, wireTabs } from './tabs';
import { escapeHtml } from './catalogue';

/** One deed as the panel shows it. */
export interface HousingCell {
  /** The deed's own id, which is what the game is told to place. */
  id: string;
  name: string;
  /** How big it is, how many lots it takes and what it costs a day, in one line. */
  line: string;
  desc: string;
  /** Why it cannot be put down now (no model, the wrong world), or empty. */
  why: string;
  /** Already standing somewhere: how many of this one the character has up. */
  standing: number;
}

export interface HousingModel {
  cells: HousingCell[];
  /** What to say when there are none: not converted, or simply none owned. */
  note: string;
  /** How many buildings this character has standing, and the most it may have. */
  built: { now: number; most: number };
}

export class HousingUi {
  readonly root: HTMLElement;
  open = false;
  onTab: (id: string) => void = () => {};
  /** A double-click, Enter, or the Place button: take this deed in hand. */
  onPlace: (id: string) => void = () => {};
  /** Take one of the character's own buildings back down. */
  onRemove: (id: string) => void = () => {};

  private readonly list: HTMLElement;
  private readonly examine: HTMLElement;
  private readonly count: HTMLElement;
  private model: HousingModel = { cells: [], note: '', built: { now: 0, most: 0 } };
  private picked = '';

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'housing';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="wardrobe-panel">
        <div class="wardrobe-header">
          ${tabStrip(INVENTORY_TABS, 'housing')}
          <span class="count"></span>
          <button class="close">Close (I)</button>
        </div>
        <div class="wardrobe-body">
          <div class="housing-list"></div>
          <div class="housing-examine"></div>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.list = this.root.querySelector('.housing-list')!;
    this.examine = this.root.querySelector('.housing-examine')!;
    this.count = this.root.querySelector('.count')!;
    this.root.querySelector('.close')!.addEventListener('click', () => this.hide());
    wireTabs(this.root, 'housing', (id) => this.onTab(id));
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.hide();
    });
  }

  show(model: HousingModel): void {
    this.model = model;
    if (!model.cells.some((c) => c.id === this.picked)) this.picked = model.cells[0]?.id ?? '';
    this.draw();
    this.root.classList.remove('hidden');
    this.open = true;
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.open = false;
  }

  private draw(): void {
    const m = this.model;
    this.count.textContent = m.built.most ? `${m.built.now} of ${m.built.most} standing` : `${m.cells.length} deeds`;
    this.list.innerHTML = m.cells.length
      ? m.cells
          .map(
            (c) =>
              `<div class="housing-row${c.id === this.picked ? ' on' : ''}${c.why ? ' cannot' : ''}" data-deed="${escapeHtml(c.id)}">` +
              `<span class="housing-name">${escapeHtml(c.name)}</span>` +
              `<span class="housing-line">${escapeHtml(c.line)}</span>` +
              `${c.standing ? `<span class="housing-up">${c.standing} up</span>` : ''}` +
              `</div>`,
          )
          .join('')
      : `<p class="menu-hint">${escapeHtml(m.note)}</p>`;
    for (const row of this.list.querySelectorAll<HTMLElement>('.housing-row')) {
      row.addEventListener('click', () => {
        this.picked = row.dataset.deed!;
        this.draw();
      });
      row.addEventListener('dblclick', () => {
        const c = m.cells.find((x) => x.id === row.dataset.deed);
        if (c && !c.why) this.onPlace(c.id);
      });
    }
    const p = m.cells.find((c) => c.id === this.picked);
    this.examine.innerHTML = p
      ? `<h3>${escapeHtml(p.name)}</h3><p class="housing-line">${escapeHtml(p.line)}</p><p>${escapeHtml(p.desc || 'The game says nothing more about it.')}</p>` +
        `<p class="why">${escapeHtml(p.why)}</p>` +
        `<div class="ship-action"><button class="place"${p.why ? ' disabled' : ''}>Place it</button>` +
        `${p.standing ? '<button class="remove">Take one down</button>' : ''}</div>` +
        `<p class="menu-hint">Double-click a deed to take it in hand. The wheel pushes it out and in, the two buttons under the world turn it, a click puts it down and Escape gives it up.</p>`
      : '';
    this.examine.querySelector('.place')?.addEventListener('click', () => {
      if (p && !p.why) this.onPlace(p.id);
    });
    this.examine.querySelector('.remove')?.addEventListener('click', () => {
      if (p) this.onRemove(p.id);
    });
  }

  /** Enter while it is open: place what is picked, if it can be. */
  pickKey(): boolean {
    const p = this.model.cells.find((c) => c.id === this.picked);
    if (!p || p.why) return false;
    this.onPlace(p.id);
    return true;
  }
}
