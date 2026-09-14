// The weapons rack: every converted weapon by class, a row each with a button per hand it can go
// in. Picking one puts it in that hand and switches to the kit that fights with it.
import { INVENTORY_TABS, tabStrip, wireTabs } from './tabs';
import { CLASS_LABELS, ONE_HANDED, type WeaponCatalogue, type WeaponClass, type WeaponDef } from '../player/weapons';

const ORDER: WeaponClass[] = ['pistol', 'carbine', 'rifle', 'heavy', 'sword1h', 'knife', 'sword2h', 'polearm', 'lightsaber'];

export class WeaponsUi {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly count: HTMLElement;
  private catalogue: WeaponCatalogue | null = null;
  open = false;
  /** A click on another tab: the game swaps the panels. */
  onTab: (id: string) => void = () => {};

  constructor(parent: HTMLElement, private readonly onPick: (def: WeaponDef | null, hand: 'right' | 'left') => void) {
    this.root = document.createElement('div');
    this.root.id = 'weapons';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="wardrobe-panel">
        <div class="wardrobe-header">
          ${tabStrip(INVENTORY_TABS, 'weapons')}
          <span class="count"></span>
          <input class="find" placeholder="find" />
          <button class="empty">Empty hands</button>
          <button class="close">Close <b>I</b></button>
        </div>
        <div class="wardrobe-main"><div class="wardrobe-body weapons-body"></div></div>
      </div>`;
    parent.appendChild(this.root);
    this.body = this.root.querySelector('.weapons-body')!;
    this.count = this.root.querySelector('.count')!;
    this.root.querySelector('.close')!.addEventListener('click', () => this.hide());
    wireTabs(this.root, 'weapons', (id) => this.onTab(id));
    this.root.querySelector('.empty')!.addEventListener('click', () => {
      this.onPick(null, 'right');
      this.onPick(null, 'left');
      this.render();
    });
    this.root.querySelector('.find')!.addEventListener('input', () => this.render());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.hide();
    });
  }

  attach(catalogue: WeaponCatalogue | null): void {
    this.catalogue = catalogue;
    this.render();
  }

  /** What is in each hand, to mark in the list. */
  held: { right: string | null; left: string | null } = { right: null, left: null };

  render(): void {
    const c = this.catalogue;
    if (!c) {
      this.count.textContent = '';
      this.body.innerHTML = `<p class="hint">No weapons converted yet: run <code>npm run swg -- weapons @SWG assets-private --retail-only</code>.</p>`;
      return;
    }
    const find = (this.root.querySelector('.find') as HTMLInputElement).value.trim().toLowerCase();
    const groups = c.byClass();
    let shown = 0;
    const html: string[] = [];
    for (const cls of ORDER) {
      const list = (groups.get(cls) ?? []).filter((w) => !find || w.id.toLowerCase().includes(find));
      if (!list.length) continue;
      shown += list.length;
      html.push(`<h3 class="weapons-class">${CLASS_LABELS[cls]} <span>${list.length}</span></h3>`);
      for (const w of list) {
        const inRight = this.held.right === w.id;
        const inLeft = this.held.left === w.id;
        html.push(`<div class="weapons-row${inRight || inLeft ? ' held' : ''}"><span class="name">${w.id.replace(/_/g, ' ')}</span><span class="reach">${w.length.toFixed(2)} m</span><button data-id="${w.id}" data-hand="right"${inRight ? ' class="on"' : ''}>${inRight ? 'in right hand' : 'right hand'}</button>${ONE_HANDED.has(w.class) ? `<button data-id="${w.id}" data-hand="left"${inLeft ? ' class="on"' : ''}>${inLeft ? 'in left hand' : 'left hand'}</button>` : ''}</div>`);
      }
    }
    if (c.skipped.length) {
      const why = new Map<string, string[]>();
      for (const s of c.skipped) (why.get(s.why) ?? why.set(s.why, []).get(s.why)!).push(s.template.replace(/^object\/weapon\//, ''));
      html.push(`<h3 class="weapons-class">Not on the rack yet <span>${c.skipped.length}</span></h3>`);
      for (const [reason, list] of why) html.push(`<details class="weapons-skipped"><summary>${reason} (${list.length})</summary><div>${list.join(', ')}</div></details>`);
    }
    this.body.innerHTML = html.join('');
    this.count.textContent = `${shown} of ${c.weapons.length} weapons`;
    for (const b of this.body.querySelectorAll<HTMLButtonElement>('button[data-id]')) {
      b.addEventListener('click', () => {
        const def = c.weapons.find((w) => w.id === b.dataset.id);
        const hand = b.dataset.hand as 'right' | 'left';
        if (!def) return;
        this.onPick(this.held[hand] === def.id ? null : def, hand);
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

  toggle(): boolean {
    if (this.open) this.hide();
    else this.show();
    return this.open;
  }
}
