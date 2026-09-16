// The Force tab of the inventory: every power the game has, with the slot it sits in (the number
// keys 1 to 6), so a Jedi picks which powers to carry. The choice is kept with the character.
import { INVENTORY_TABS, tabStrip, wireTabs } from './tabs';
import { escapeHtml } from './catalogue';
import { POWERS, SLOT_COUNT } from '../combat/forcePowers';

export class ForceUi {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  /** The power in each slot, by id, or null for an empty slot. */
  loadout: (string | null)[] = [];
  open = false;
  /** A click on another tab: the game swaps the panels. */
  onTab: (id: string) => void = () => {};
  /** The loadout changed: the game gives it to the kit and keeps it with the character. */
  onChange: (loadout: (string | null)[]) => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'force';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="wardrobe-panel">
        <div class="wardrobe-header">
          ${tabStrip(INVENTORY_TABS, 'force')}
          <span class="count">the number keys 1 to 6 use what is in their slot</span>
          <button class="close">Close <b>I</b></button>
        </div>
        <div class="wardrobe-main"><div class="wardrobe-body weapons-body"></div></div>
      </div>`;
    parent.appendChild(this.root);
    this.body = this.root.querySelector('.weapons-body')!;
    this.root.querySelector('.close')!.addEventListener('click', () => this.hide());
    wireTabs(this.root, 'force', (id) => this.onTab(id));
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.hide();
    });
  }

  render(): void {
    const slotOf = (id: string) => this.loadout.indexOf(id);
    const rows = POWERS.map((p) => {
      const at = slotOf(p.id);
      const kind = p.kind === 'hold' ? 'hold' : p.kind === 'toggle' ? 'toggle' : 'tap';
      const buttons: string[] = [];
      for (let i = 0; i < SLOT_COUNT; i++) buttons.push(`<button data-power="${p.id}" data-slot="${i}"${at === i ? ' class="on"' : ''} title="${at === i ? 'take it out of this slot' : `put it in slot ${i + 1}`}">${i + 1}</button>`);
      return `<div class="force-row${at >= 0 ? ' held' : ''}"><div class="force-name">${escapeHtml(p.name)} <small>${kind} · ${escapeHtml(p.cost)}</small></div><div class="force-blurb">${escapeHtml(p.blurb)}</div><div class="cat-hands">${buttons.join('')}</div></div>`;
    });
    const slots: string[] = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      const id = this.loadout[i];
      const p = id ? POWERS.find((x) => x.id === id) : null;
      slots.push(`<span class="hand-slot"><b>${i + 1}</b> ${p ? escapeHtml(p.name) : '<em>empty</em>'}</span>`);
    }
    this.body.innerHTML = `<div class="in-hands">${slots.join('')}</div>${rows.join('')}`;
    for (const b of this.body.querySelectorAll<HTMLButtonElement>('button[data-power]')) {
      b.addEventListener('click', () => {
        const id = b.dataset.power!;
        const slot = Number(b.dataset.slot);
        const next = [...this.loadout];
        while (next.length < SLOT_COUNT) next.push(null);
        // The same slot again empties it; a power already elsewhere moves.
        const was = next.indexOf(id);
        if (was >= 0) next[was] = null;
        next[slot] = was === slot ? null : id;
        this.loadout = next;
        this.onChange(next);
        this.render();
      });
    }
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
