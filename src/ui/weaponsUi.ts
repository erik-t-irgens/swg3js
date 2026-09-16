// The weapons rack: every converted weapon by class, a row each with a button per hand it can go
// in. Picking one puts it in that hand and switches to the kit that fights with it.
import { INVENTORY_TABS, tabStrip, wireTabs } from './tabs';
import { GroupState, escapeHtml, groupHtml, prettyName } from './catalogue';
import { CLASS_LABELS, OFF_HAND, type WeaponCatalogue, type WeaponClass, type WeaponDef } from '../player/weapons';

const ORDER: WeaponClass[] = ['lightsaber', 'lightsaber2h', 'lightsaberStaff', 'sword1h', 'knife', 'fist', 'sword2h', 'polearm', 'pistol', 'carbine', 'rifle', 'heavy'];
/** What a class fights like, for its heading. */
const NOTES: Record<WeaponClass, string> = {
  lightsaber: 'one hand: fast, medium and strong styles',
  lightsaber2h: 'two hands: medium and strong',
  lightsaberStaff: 'a blade from each end: the staff style',
  sword1h: 'the single-blade styles; one in each hand fights dual',
  knife: 'the single-blade styles; one in each hand fights dual',
  fist: 'knucklers and the like: the fast style; one on each hand fights dual',
  sword2h: 'the single-blade styles; one in each hand fights dual',
  polearm: 'the staff style',
  pistol: 'each fires as its kind: hover an entry for what it does',
  carbine: 'each fires as its kind: hover an entry for what it does',
  rifle: 'each fires as its kind: hover an entry for what it does',
  heavy: 'each fires as its kind: hover an entry for what it does',
};

export class WeaponsUi {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly count: HTMLElement;
  private catalogue: WeaponCatalogue | null = null;
  private readonly groups = new GroupState();
  private lastFind = '';
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
  /** The blade colour worn now, and the game's choices; a pick goes to the game. */
  saberColor = '#3aa0ff';
  onSaberColor: (hex: string) => void = () => {};

  render(): void {
    const c = this.catalogue;
    if (!c) {
      this.count.textContent = '';
      this.body.innerHTML = `<p class="hint">No weapons converted yet: run <code>npm run swg -- weapons @SWG assets-private --retail-only</code>.</p>`;
      return;
    }
    const find = (this.root.querySelector('.find') as HTMLInputElement).value.trim().toLowerCase();
    if (find !== this.lastFind) this.groups.clear();
    this.lastFind = find;
    const groups = c.byClass();
    let shown = 0;
    const html: string[] = [];
    // What is in the hands, first, so it can be read without hunting for the marked entries.
    const inHands = [this.held.right, this.held.left].map((id, i) => {
      const w = id ? c.weapons.find((x) => x.id === id) : null;
      return `<span class="hand-slot"><b>${i ? 'left' : 'right'}</b> ${w ? escapeHtml(prettyName(w.id).name) : '<em>empty</em>'}</span>`;
    });
    html.push(`<div class="in-hands">${inHands.join('')}</div>`);
    // The blade: the game's own colours, and any colour at all.
    const colors = c.saberColors;
    html.push(`<h3 class="weapons-class">Blade colour <span>${colors.length ? `${colors.length} of the game's, or your own` : 'your own'}</span></h3><div class="blade-colours">${colors.map((h) => `<button class="swatch${h.toLowerCase() === this.saberColor.toLowerCase() ? ' on' : ''}" data-colour="${h}" style="background:${h}" title="${h}"></button>`).join('')}<label class="blade-own">own <input type="color" class="blade-custom" value="${this.saberColor}" /></label></div>`);
    for (const cls of ORDER) {
      const list = (groups.get(cls) ?? []).filter((w) => !find || w.id.toLowerCase().includes(find) || prettyName(w.id).name.toLowerCase().includes(find));
      if (!list.length) continue;
      shown += list.length;
      const heldHere = list.some((w) => w.id === this.held.right || w.id === this.held.left);
      const items = list.map((w) => {
        const inRight = this.held.right === w.id;
        const inLeft = this.held.left === w.id;
        const { name, tags } = prettyName(w.id);
        const left = OFF_HAND.has(w.class) ? `<button data-id="${w.id}" data-hand="left"${inLeft ? ' class="on"' : ''} title="${inLeft ? 'in the left hand: click to empty it' : 'left hand'}">L</button>` : '';
        return `<div class="cat-item${inRight || inLeft ? ' held' : ''}" title="${escapeHtml(w.id)} · ${w.length.toFixed(2)} m"><span class="cat-name">${escapeHtml(name)}${tags.length ? ` <small>${escapeHtml(tags.join(' '))}</small>` : ''}</span><span class="cat-hands"><button data-id="${w.id}" data-hand="right"${inRight ? ' class="on"' : ''} title="${inRight ? 'in the right hand: click to empty it' : 'right hand'}">R</button>${left}</span></div>`;
      });
      html.push(groupHtml(cls, CLASS_LABELS[cls], list.length, NOTES[cls], this.groups.isOpen(cls, !!find || heldHere), items.join('')));
    }
    if (c.skipped.length && !find) {
      const why = new Map<string, string[]>();
      for (const s of c.skipped) (why.get(s.why) ?? why.set(s.why, []).get(s.why)!).push(s.template.replace(/^object\/weapon\//, ''));
      const inner = [...why].map(([reason, list]) => `<details class="weapons-skipped"><summary>${escapeHtml(reason)} (${list.length})</summary><div>${escapeHtml(list.join(', '))}</div></details>`).join('');
      html.push(groupHtml('skipped', 'Not on the rack yet', c.skipped.length, 'kinds the game does not play yet', this.groups.isOpen('skipped', false), `<div class="cat-wide">${inner}</div>`));
    }
    this.body.innerHTML = html.join('');
    this.groups.wire(this.body);
    this.count.textContent = `${shown} of ${c.weapons.length} weapons`;
    for (const b of this.body.querySelectorAll<HTMLButtonElement>('button[data-colour]')) {
      b.addEventListener('click', () => {
        this.saberColor = b.dataset.colour!;
        this.onSaberColor(this.saberColor);
        this.render();
      });
    }
    this.body.querySelector<HTMLInputElement>('.blade-custom')?.addEventListener('input', (e) => {
      this.saberColor = (e.target as HTMLInputElement).value;
      this.onSaberColor(this.saberColor);
      for (const b of this.body.querySelectorAll<HTMLButtonElement>('button[data-colour]')) b.classList.toggle('on', b.dataset.colour!.toLowerCase() === this.saberColor.toLowerCase());
    });
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
