// The Housing tab: the buildings a character has standing, the deeds it owns, and what each deed
// would put down.
//
// A double-click on a deed takes it in hand and the world goes into placing: the ghost of the
// building appears, the grid the client itself drew goes under it, and the bar under the world offers
// the turns. Nothing about placing is decided here.
//
// "Your buildings" is at the top, and taking one down is asked in the page, never with the browser's
// own `window.confirm`: the row's button turns into a question with two answers, and the one that
// really does it stays shut for `HOUSING_TUNE.armMs`, so the click that asked cannot also answer.
// Whether a building is the server's or this browser's own is the game's business, not this panel's:
// it is handed rows and says which one was taken down.
//
// It is built exactly as the backpack is -- the inventory's own tab strip in the header, a list,
// an examine pane -- and carries no colours of its own, so it wears the same eighteen every other
// panel does.

import { INVENTORY_TABS, tabStrip, wireTabs } from './tabs.ts';
import { escapeHtml } from './catalogue.ts';
import { HOUSING_TUNE } from '../world/myBuildings.ts';

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

/** One of the character's own buildings standing on this world. */
export interface HousingBuilt {
  /** What a take-down names. */
  id: string;
  name: string;
  /** How far off and who keeps it, in one line. */
  line: string;
}

export interface HousingModel {
  cells: HousingCell[];
  /** What to say when there are none: not converted, or simply none owned. */
  note: string;
  /** How many buildings this character has standing, and the most it may have. */
  built: { now: number; most: number };
  /** The character's own buildings on this world, nearest first. */
  mine: HousingBuilt[];
  /** What to say under the heading when there are none. */
  mineNote: string;
}

export class HousingUi {
  readonly root: HTMLElement;
  open = false;
  onTab: (id: string) => void = () => {};
  /** A double-click, Enter, or the Place button: take this deed in hand. */
  onPlace: (id: string) => void = () => {};
  /** One of the character's own buildings, to be taken down: asked and answered in the page already. */
  onRemove: (id: string) => void = () => {};

  private readonly list: HTMLElement;
  private readonly examine: HTMLElement;
  private readonly count: HTMLElement;
  private model: HousingModel = { cells: [], note: '', built: { now: 0, most: 0 }, mine: [], mineNote: '' };
  private picked = '';
  /** The building whose take-down is being asked about, or ''. */
  private asking = '';
  /** Whether the answer that takes it down has been opened yet. */
  private armed = false;
  private armTimer = 0;

  /**
   * A close the player asked for -- the X button, or a click on the backdrop.
   *
   * It is not the same as `hide()`, which `App.closePanels()` calls on every panel at once and whose
   * callers decide the mouse for themselves. Only a close the player asked for hands the pointer
   * back, and nine panels had no way to say so: they called `hide()`, nothing cleared the input's
   * `captured`, and every key and the mouse stayed dead until some other panel's own key was pressed
   * twice. The panels that were already right do exactly this.
   */
  onClose: () => void = () => {};

  /** Close because the player asked, and give the mouse back. */
  private dismiss(): void {
    this.hide();
    this.onClose();
  }
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
    this.root.querySelector('.close')!.addEventListener('click', () => this.dismiss());
    wireTabs(this.root, 'housing', (id) => this.onTab(id));
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.dismiss();
    });
  }

  show(model: HousingModel): void {
    this.model = model;
    if (!model.cells.some((c) => c.id === this.picked)) this.picked = model.cells[0]?.id ?? '';
    // A building that came down while the question was up has nothing left to be asked about.
    if (this.asking && !model.mine.some((b) => b.id === this.asking)) this.stopAsking();
    this.draw();
    this.root.classList.remove('hidden');
    this.open = true;
  }

  hide(): void {
    this.root.classList.add('hidden');
    this.open = false;
    this.stopAsking();
  }

  /**
   * Ask about taking one building down, as its own Take down button does: what the pick-up key at a
   * building's doorstep opens the tab onto. False when that building is not on the list.
   */
  ask(id: string): boolean {
    if (!this.model.mine.some((b) => b.id === id)) return false;
    this.asking = id;
    this.armed = false;
    window.clearTimeout(this.armTimer);
    this.draw();
    // Shut for a moment, so the press that asked cannot also answer.
    this.armTimer = window.setTimeout(() => {
      if (this.asking !== id) return;
      this.armed = true;
      const b = this.list.querySelector<HTMLButtonElement>('.housing-really');
      if (b) {
        b.disabled = false;
        b.classList.remove('arming');
      }
    }, HOUSING_TUNE.armMs);
    return true;
  }

  /** What is being asked, for the console. */
  get askingAbout(): { id: string; armed: boolean } | null {
    return this.asking ? { id: this.asking, armed: this.armed } : null;
  }

  private stopAsking(): void {
    window.clearTimeout(this.armTimer);
    this.asking = '';
    this.armed = false;
  }

  private builtRows(): string {
    const m = this.model;
    const rows = m.mine
      .map((b) => {
        const asking = b.id === this.asking;
        const answer = asking
          ? `<div class="housing-confirm"><span class="housing-ask">Take ${escapeHtml(b.name)} down? Whatever stands in it goes with it.</span>` +
            `<button class="housing-keep" data-built="${escapeHtml(b.id)}">Keep it</button>` +
            `<button class="housing-really${this.armed ? '' : ' arming'}" data-built="${escapeHtml(b.id)}"${this.armed ? '' : ' disabled'}>Take it down</button></div>`
          : `<button class="housing-down" data-built="${escapeHtml(b.id)}">Take down</button>`;
        return (
          `<div class="housing-built${asking ? ' asking' : ''}">` +
          `<span class="housing-name">${escapeHtml(b.name)}</span>` +
          `<span class="housing-line">${escapeHtml(b.line)}</span>` +
          answer +
          `</div>`
        );
      })
      .join('');
    return `<h3 class="housing-head">Your buildings <span>${m.mine.length ? `${m.mine.length} standing on this world` : escapeHtml(m.mineNote)}</span></h3>${rows}`;
  }

  private draw(): void {
    const m = this.model;
    this.count.textContent = m.built.most ? `${m.built.now} of ${m.built.most} standing` : `${m.cells.length} deeds`;
    const deeds = m.cells.length
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
    this.list.innerHTML = `${this.builtRows()}<h3 class="housing-head">Deeds <span>double-click one to put it down</span></h3>${deeds}`;
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
    for (const b of this.list.querySelectorAll<HTMLButtonElement>('.housing-down')) b.addEventListener('click', () => this.ask(b.dataset.built!));
    for (const b of this.list.querySelectorAll<HTMLButtonElement>('.housing-keep')) {
      b.addEventListener('click', () => {
        this.stopAsking();
        this.draw();
      });
    }
    for (const b of this.list.querySelectorAll<HTMLButtonElement>('.housing-really')) {
      b.addEventListener('click', () => {
        const id = b.dataset.built!;
        if (!this.armed || this.asking !== id) return;
        this.stopAsking();
        this.draw();
        this.onRemove(id);
      });
    }
    const p = m.cells.find((c) => c.id === this.picked);
    this.examine.innerHTML = p
      ? `<h3>${escapeHtml(p.name)}</h3><p class="housing-line">${escapeHtml(p.line)}</p><p>${escapeHtml(p.desc || 'The game says nothing more about it.')}</p>` +
        `<p class="why">${escapeHtml(p.why)}</p>` +
        `<div class="ship-action"><button class="place"${p.why ? ' disabled' : ''}>Place it</button></div>` +
        `<p class="menu-hint">Double-click a deed to take it in hand. The wheel pushes it out and in, the two buttons under the world turn it, a click puts it down and Escape gives it up. A building of yours comes down from the list above, or from its own doorstep with the key that picks a prop back up.</p>`
      : '';
    this.examine.querySelector('.place')?.addEventListener('click', () => {
      if (p && !p.why) this.onPlace(p.id);
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
