// The Weapons (give) tab: every converted weapon, as pictures, a folding group a class.
//
// It was 587 rows of small text with an `R` and an `L` at the end of each and everything worth
// knowing -- the id, the reach, the game's own description -- hidden in a `title` tooltip. The
// weapons command has baked a picture for every one of them since the backpack was built (224
// different pictures across the 587, because a family of weapons shares one model), and this panel
// simply did not show them. It now reads like the backpack: a picture and a name to each entry, a
// find box that was already there, and an examine strip at the foot carrying the name, the class,
// the reach and the description in words.
//
// The pictures are `<img>`, baked by the converter and decoded off the main thread; nothing here
// touches a GL context, so opening the panel compiles nothing.
//
// What a pick does is unchanged: it puts the weapon in that hand and switches to the kit that fights
// with it, and picking what is already held empties the hand.
import { INVENTORY_TABS, tabStrip, wireTabs } from './tabs.ts';
import { GroupState, escapeHtml, groupHtml, groupShell } from './catalogue.ts';
import { GIVE_TUNE, buildWeaponView, giveCellHtml, openGroups, weaponName, type GiveCell, type GiveView } from './giveModel.ts';
import { CLASS_LABELS, OFF_HAND, type WeaponCatalogue, type WeaponClass, type WeaponDef } from '../player/weapons.ts';

// The instruments and the dancer's props come last, because they are the groups here that fight
// with nothing. They are in this panel at all because it is the panel that gives you a thing to
// hold, and both are exactly that: the only music in this game is the music players make with an
// instrument, and a sparkler is a sparkler.
const ORDER: WeaponClass[] = ['lightsaber', 'lightsaber2h', 'lightsaberStaff', 'sword1h', 'knife', 'fist', 'sword2h', 'polearm', 'pistol', 'carbine', 'rifle', 'heavy', 'thrown', 'instrument', 'entertainer'];
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
  pistol: 'each fires as its kind: click one to read what it does',
  carbine: 'each fires as its kind: click one to read what it does',
  rifle: 'each fires as its kind: click one to read what it does',
  heavy: 'each fires as its kind: click one to read what it does',
  thrown: 'not held: the Skills tab puts the grenades in the number slots, and each flies as its own model',
  instrument: 'not a weapon: hold one and its own part of a song plays, which is the only music in this game',
  entertainer: "not a weapon: the dancer's ribbons, sparklers, glowsticks and batons. Most of them are a particle effect rather than a model, which is what the game made them",
};

/** The class groups in the order the rack reads, for the display rules. */
const GROUP_ORDER = ORDER.map((id) => ({ id, label: CLASS_LABELS[id] }));

export class WeaponsUi {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly count: HTMLElement;
  private readonly find: HTMLInputElement;
  private readonly examine: HTMLElement;
  private catalogue: WeaponCatalogue | null = null;
  private readonly groups = new GroupState();
  private lastFind = '';
  /** The view the body was last drawn from, and how many cells each group has drawn so far. */
  private view: GiveView | null = null;
  private readonly drawn = new Map<string, number>();
  private selected: string | null = null;
  private findTimer = 0;
  open = false;
  /** A click on another tab: the game swaps the panels. */
  onTab: (id: string) => void = () => {};

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
  constructor(parent: HTMLElement, private readonly onPick: (def: WeaponDef | null, hand: 'right' | 'left') => void) {
    this.root = document.createElement('div');
    this.root.id = 'weapons';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="wardrobe-panel wide give-panel">
        <div class="wardrobe-header">
          ${tabStrip(INVENTORY_TABS, 'weapons')}
          <span class="count"></span>
          <span class="dev-note" title="The backpack (the first tab) is where owned weapons are taken up and put away">developer: a pick gives the weapon and puts it in that hand</span>
          <input class="find" placeholder="find" spellcheck="false" />
          <button class="empty">Empty hands</button>
          <button class="close">Close <b>I</b></button>
        </div>
        <div class="wardrobe-main"><div class="wardrobe-body weapons-body give-body"></div></div>
        <div class="bp-examine"></div>
        <div class="bp-hint">double-click to put it in the right hand · shift+double-click, or the <b>L</b> on the picture, for the left · picking what is held empties the hand</div>
      </div>`;
    parent.appendChild(this.root);
    this.body = this.root.querySelector('.weapons-body')!;
    this.count = this.root.querySelector('.count')!;
    this.find = this.root.querySelector('.find')!;
    this.examine = this.root.querySelector('.bp-examine')!;
    this.root.querySelector('.close')!.addEventListener('click', () => this.dismiss());
    wireTabs(this.root, 'weapons', (id) => this.onTab(id));
    this.root.querySelector('.empty')!.addEventListener('click', () => {
      this.onPick(null, 'right');
      this.onPick(null, 'left');
      this.render();
    });
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
      const hand = target.closest<HTMLElement>('button[data-hand]');
      if (hand) {
        e.preventDefault();
        e.stopPropagation();
        this.take(hand.dataset.id!, hand.dataset.hand as 'right' | 'left');
        return;
      }
      const cell = target.closest<HTMLElement>('.bp-cell[data-id]');
      if (cell) {
        this.select(cell.dataset.id!);
        return;
      }
      const more = target.closest<HTMLElement>('button[data-more]');
      if (more) {
        this.fill(more.dataset.more!, true);
        return;
      }
      const colour = target.closest<HTMLElement>('button[data-colour]');
      if (colour) {
        this.saberColor = colour.dataset.colour!;
        this.onSaberColor(this.saberColor);
        for (const b of this.body.querySelectorAll<HTMLButtonElement>('button[data-colour]')) b.classList.toggle('on', b.dataset.colour!.toLowerCase() === this.saberColor.toLowerCase());
      }
    });
    this.body.addEventListener('dblclick', (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('.bp-cell[data-id]');
      if (!cell) return;
      this.select(cell.dataset.id!);
      this.take(cell.dataset.id!, e.shiftKey ? 'left' : 'right');
    });
    this.body.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const cell = (e.target as HTMLElement).closest<HTMLElement>('.bp-cell[data-id]');
      if (!cell) return;
      e.preventDefault();
      this.select(cell.dataset.id!);
      this.take(cell.dataset.id!, e.shiftKey ? 'left' : 'right');
    });
    this.body.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      if (!el.classList.contains('blade-custom')) return;
      this.saberColor = el.value;
      this.onSaberColor(this.saberColor);
      for (const b of this.body.querySelectorAll<HTMLButtonElement>('button[data-colour]')) b.classList.toggle('on', b.dataset.colour!.toLowerCase() === this.saberColor.toLowerCase());
    });
    // A group opened for the first time draws its cells ('toggle' does not bubble: caught on the way down).
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

  attach(catalogue: WeaponCatalogue | null): void {
    this.catalogue = catalogue;
    this.render();
  }

  /** What is in each hand, to mark in the lists. */
  held: { right: string | null; left: string | null } = { right: null, left: null };
  /** The blade colour worn now, and the game's choices; a pick goes to the game. */
  saberColor = '#3aa0ff';
  onSaberColor: (hex: string) => void = () => {};

  render(): void {
    const c = this.catalogue;
    this.drawn.clear();
    if (!c) {
      this.count.textContent = '';
      this.view = null;
      this.body.innerHTML = `<p class="hint">No weapons converted yet: run <code>npm run swg -- weapons @SWG assets-private --retail-only</code>.</p>`;
      this.drawExamine();
      return;
    }
    const find = this.find.value.trim().toLowerCase();
    // A search shows its hits: choices made by hand while browsing are dropped while it lasts.
    if (find !== this.lastFind) this.groups.clear();
    this.lastFind = find;
    this.view = buildWeaponView(c.weapons, {
      find,
      right: this.held.right,
      left: this.held.left,
      offHand: OFF_HAND as ReadonlySet<string>,
      order: GROUP_ORDER,
      iconUrl: (w) => c.iconUrl(w as WeaponDef),
    });
    const wanted = openGroups(this.view, find);
    const html: string[] = [];
    // What is in the hands, first, so it can be read without hunting for the marked entries.
    // Named from the catalogue rather than from the cells: the find box may have filtered the very
    // weapon in the hand out of the lists, and the hand line must still say what it is holding.
    const inHands = (['right', 'left'] as const).map((hand) => {
      const id = this.held[hand];
      const def = id ? c.weapons.find((w) => w.id === id) : null;
      return `<span class="hand-slot"><b>${hand}</b> ${def ? escapeHtml(weaponName(def).name) : id ? escapeHtml(id) : '<em>empty</em>'}</span>`;
    });
    html.push(`<div class="in-hands">${inHands.join('')}</div>`);
    // The blade: the game's own colours, and any colour at all.
    const colors = c.saberColors;
    html.push(`<h3 class="weapons-class">Blade colour <span>${colors.length ? `${colors.length} of the game's, or your own` : 'your own'}</span></h3><div class="blade-colours">${colors.map((h) => `<button class="swatch${h.toLowerCase() === this.saberColor.toLowerCase() ? ' on' : ''}" data-colour="${h}" style="background:${h}" title="${h}"></button>`).join('')}<label class="blade-own">own <input type="color" class="blade-custom" value="${this.saberColor}" /></label></div>`);
    for (const g of this.view.groups) {
      const cls = g.id as WeaponClass;
      html.push(groupShell(g.id, g.label, g.cells.length, NOTES[cls] ?? '', this.groups.isOpen(g.id, wanted.has(g.id))));
    }
    if (!this.view.groups.length) html.push(`<div class="wardrobe-empty">nothing on the rack matches “${escapeHtml(find)}”</div>`);
    if (c.skipped.length && !find) {
      const why = new Map<string, string[]>();
      for (const s of c.skipped) (why.get(s.why) ?? why.set(s.why, []).get(s.why)!).push(s.template.replace(/^object\/weapon\//, ''));
      const inner = [...why].map(([reason, list]) => `<details class="weapons-skipped"><summary>${escapeHtml(reason)} (${list.length})</summary><div>${escapeHtml(list.join(', '))}</div></details>`).join('');
      html.push(groupHtml('skipped', 'Not on the rack yet', c.skipped.length, 'kinds the game does not play yet', this.groups.isOpen('skipped', false), `<div class="cat-wide">${inner}</div>`));
    }
    // Where the list was is kept: taking a weapon up rebuilds the body, and a list that jumped back
    // to the top each time would be unusable at nearly six hundred entries.
    const scroll = this.body.scrollTop;
    this.body.innerHTML = html.join('');
    this.groups.wire(this.body);
    for (const d of this.body.querySelectorAll<HTMLDetailsElement>('details.cat-group[open]')) this.fill(d.dataset.key ?? '', false);
    this.body.scrollTop = scroll;
    const v = this.view;
    // The pictures are worth saying out loud: a family of weapons shares one model, so 587 entries
    // wear 224 different pictures and two cells side by side can look identical. Words are what tell
    // them apart -- the name, and under it the id's own part where the name alone would not.
    const line = [
      v.shown === v.listed ? `${v.listed} weapons` : `${v.shown} of ${v.listed} weapons`,
      v.pictures < v.shown ? `${v.pictures} different pictures: a family shares one model` : '',
      v.marked ? `${v.marked} showing the id's own part, their names being alike` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    // The header's count is one line that gives way before the buttons do, so the whole of it is on
    // the element as well for a window too narrow to print it.
    this.count.textContent = line;
    this.count.title = line;
    if (this.selected && !this.cell(this.selected)) this.selected = null;
    this.drawExamine();
  }

  /**
   * Draw a group's cells into its grid: its first page when it is opened, the next page when the
   * button under it is pressed. Which of the two it is has to be said, not guessed -- folding a
   * group and unfolding it fires the same `toggle`, and a guard that only refused a redraw of the
   * first page let every such fold append another page.
   */
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
    for (let i = from; i < to; i++) cells.push(this.cellHtml(g.cells[i]));
    grid.querySelector('.give-more')?.remove();
    grid.insertAdjacentHTML('beforeend', cells.join(''));
    if (to < g.cells.length) grid.insertAdjacentHTML('beforeend', `<div class="cat-wide give-more"><button data-more="${escapeHtml(key)}">show the next ${Math.min(GIVE_TUNE.page, g.cells.length - to)} of ${g.cells.length - to} more</button></div>`);
    this.drawn.set(key, to);
  }

  private cell(id: string): GiveCell | undefined {
    for (const g of this.view?.groups ?? []) {
      const c = g.cells.find((x) => x.id === id);
      if (c) return c;
    }
    return undefined;
  }

  /** One picture cell: the shared markup, with the left-hand button in the picture's corner. */
  private cellHtml(c: GiveCell): string {
    // The off-hand mark is both a badge and a button: it says the class may go in the left hand and puts it there.
    const left = OFF_HAND.has(c.group as WeaponClass) ? `<button class="give-off${c.tag === 'left hand' ? ' on' : ''}" data-id="${escapeHtml(c.id)}" data-hand="left" title="${c.tag === 'left hand' ? 'in the left hand: click to empty it' : 'put it in the left hand'}">L</button>` : '';
    // A grenade is listed but not held: the Skills tab throws it from a number slot.
    return giveCellHtml(c, { selected: c.id === this.selected, on: 'held', more: c.group === 'thrown' ? 'give-listing' : '', corner: left });
  }

  /** Pick a cell (or none): the examine strip shows it. */
  private select(id: string | null): void {
    this.selected = id && this.cell(id) ? id : null;
    for (const el of this.body.querySelectorAll<HTMLElement>('.bp-cell[data-id]')) el.classList.toggle('sel', el.dataset.id === this.selected);
    this.drawExamine();
  }

  /** Put a weapon in a hand, or empty that hand when it is the one already there. */
  private take(id: string, hand: 'right' | 'left'): void {
    const def = this.catalogue?.weapons.find((w) => w.id === id);
    // A grenade is thrown from a number slot, never held: its cells were a listing before the
    // pictures and they stay one.
    if (!def || def.class === 'thrown') return;
    this.onPick(this.held[hand] === def.id ? null : def, hand);
    this.render();
  }

  /** The foot of the panel: the game's own name, class, reach and description of the weapon picked. */
  private drawExamine(): void {
    const c = this.selected ? this.cell(this.selected) : undefined;
    if (!c) {
      this.examine.innerHTML = `<div class="bp-examine-empty">click a weapon to read what the game says about it · double-click to take it up</div>`;
      return;
    }
    const pic = c.picture === 'icon' && c.icon ? `<img src="${escapeHtml(c.icon)}" decoding="async" alt="">` : `<span class="bp-initials">${escapeHtml(c.initials)}</span>`;
    const head = `${escapeHtml(c.label)} <small>${escapeHtml(c.id)}</small>`;
    const paragraphs = c.description.split(/\n\s*\n/).filter((p) => p.trim()).map((p) => `<p>${escapeHtml(p.trim())}</p>`).join('');
    const thrown = c.group === 'thrown';
    const canLeft = OFF_HAND.has(c.group as WeaponClass);
    const buttons = thrown
      ? ''
      : [
          `<button data-id="${escapeHtml(c.id)}" data-hand="right">${c.tag === 'right hand' ? 'Empty the right hand' : 'Right hand'}</button>`,
          canLeft ? `<button data-id="${escapeHtml(c.id)}" data-hand="left">${c.tag === 'left hand' ? 'Empty the left hand' : 'Left hand'}</button>` : '',
        ]
          .filter(Boolean)
          .join('');
    const cls = CLASS_LABELS[c.group as WeaponClass] ?? c.group;
    this.examine.innerHTML = `<div class="bp-examine-pic" data-initials="${escapeHtml(c.initials)}">${pic}</div><div class="bp-examine-text"><div class="bp-examine-head">${head}</div><div class="bp-state">${escapeHtml(cls)}${c.note ? ` · ${escapeHtml(c.note)}` : ''}</div>${paragraphs || '<p class="bp-nodesc">The game says nothing more about it.</p>'}</div><div class="bp-actions">${buttons}</div>`;
  }

  /** What the panel is showing, for the console. */
  state(): { open: boolean; listed: number; shown: number; groups: number; opened: number; drawn: number; marked: number; pictures: number; selected: string | null } {
    const v = this.view;
    let drawn = 0;
    for (const n of this.drawn.values()) drawn += n;
    return {
      open: this.open,
      listed: v?.listed ?? 0,
      shown: v?.shown ?? 0,
      groups: v?.groups.length ?? 0,
      opened: this.body.querySelectorAll('details.cat-group[open]').length,
      drawn,
      marked: v?.marked ?? 0,
      pictures: v?.pictures ?? 0,
      selected: this.selected,
    };
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
