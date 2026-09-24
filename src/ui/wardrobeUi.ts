// The Clothes (give) tab: everything this character's wardrobe carries, as pictures.
//
// It was thirteen dropdowns, one a body slot, each holding up to two hundred lines of text. The
// converter has baked a picture for every item since the backpack was built -- a human folder holds
// 1,063 wearables, of which 915 or 964 are listed with the switches as this panel opens them -- and
// this panel simply did not show them. Now it reads like the backpack, which is the one inventory
// screen in the game the owner already knows: a folding group a slot, a grid of picture cells inside
// it, a find box in the header, and an examine strip at the foot with the game's own name and
// description of whatever is picked, instead of a `title` tooltip.
//
// The pictures are `<img>`, baked by the converter and decoded off the main thread. A live 3D cell
// would compile a program per material on the main thread, which is the stall the whole game is
// built to avoid; only the doll beside the list draws anything, and it always has.
//
// What a pick does is unchanged. Putting something on takes off whatever held that slot, which is the
// rule the original game's paper doll enforces too, and "take this slot off" is the dropdowns' old
// "— none —" under another name.

import type { Character, Wardrobe } from '../player/character';
import { INVENTORY_TABS, tabStrip, wireTabs } from './tabs.ts';
import { CharacterPreview } from './characterPreview.ts';
import type { PreviewEffects } from './previewDof';
import { OTHER_GROUP, SLOT_GROUPS, slotGroupOf } from '../core/inventory.ts';
import { escapeHtml, groupShell, GroupState } from './catalogue.ts';
import { GIVE_TUNE, buildWardrobeView, countLine, giveCellHtml, openGroups, type GiveCell, type WardrobeView } from './giveModel.ts';

/** Equipment slots, in the order they read down a body, and the id fragments that name them (the backpack's rules own the list). */
const SLOTS = SLOT_GROUPS;
const OTHER = OTHER_GROUP;

/** The slot an item belongs in, by the first pattern its id fits. */
export const slotOf = slotGroupOf;

/** What each slot's heading says it is for. */
const SLOT_NOTE = 'a pick puts it on and takes off whatever held the slot';

export class WardrobeUi {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly find: HTMLInputElement;
  private readonly examine: HTMLElement;
  private readonly preview: CharacterPreview;
  /** The doll, for the console (__debug.previewDof). */
  get doll(): CharacterPreview {
    return this.preview;
  }
  /**
   * The lens settings every doll draws with (the wardrobe's and the creator's alike): the game keeps
   * them in step with Effects and Depth of field, reaching them through the panel it already has.
   */
  static get dollEffects(): PreviewEffects {
    return CharacterPreview.effects;
  }
  private character: Character | null = null;
  private catalogue: Wardrobe | null = null;
  open = false;
  /** A click on another tab: the game swaps the panels. */
  onTab: (id: string) => void = () => {};
  /**
   * Put a piece on through the game's equipment (the slot rules, the compile before it shows, and in the
   * world the piece given): true when it went on. Without it the panel dresses the character directly.
   */
  onWear: ((id: string) => Promise<boolean>) | null = null;
  /** Take worn parts off through the game's equipment, all in one step (saved with the character once); a note back. */
  onRemove: ((parts: string[]) => string) | null = null;
  /** In the world the panel is a developer's give tool; in the creator it only dresses. */
  developer = false;
  /** A pick of the panel's own is going through the equipment: it rebuilds once at the end, so `refresh` waits for it. */
  private picking = false;
  /** Which groups the player has opened or closed by hand. */
  private readonly groups = new GroupState();
  /** The view the body was last drawn from, and how many cells each group has drawn so far. */
  private view: WardrobeView | null = null;
  private readonly drawn = new Map<string, number>();
  /** The cell picked, by item id; the examine strip describes it. */
  private selected: string | null = null;
  private lastFind = '';
  private findTimer = 0;
  /** The character and the set of parts the doll was last cloned from; see `syncDoll`. */
  private dollFor: Character | null = null;
  private dollParts = '';

  constructor(parent: HTMLElement, private readonly onChange: () => void) {
    this.root = document.createElement('div');
    this.root.id = 'wardrobe';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="wardrobe-panel wide give-panel">
        <div class="wardrobe-header">
          ${tabStrip(INVENTORY_TABS, 'wardrobe')}
          <span class="count"></span>
          <input class="find" placeholder="find" spellcheck="false" />
          <label class="mixed-label" title="Pieces authored for the other gender's body share the skeleton, not the shape: some fit, some do not"><input type="checkbox" class="mixed" /> other gender's pieces too</label>
          <label class="mixed-label" title="The game's appearance table says this species cannot wear them; a pick here puts one on all the same"><input type="checkbox" class="blocked" /> pieces this species cannot wear</label>
          <button class="strip">Take everything off</button>
          <button class="close">Close <b>I</b></button>
        </div>
        <div class="wardrobe-main">
          <div class="wardrobe-preview"><div class="preview-hint">drag to turn · right-drag to pan · wheel to zoom · double-click to reset</div></div>
          <div class="wardrobe-body give-body"></div>
        </div>
        <div class="bp-examine"></div>
        <div class="bp-hint">double-click a piece to put it on · double-click what is worn to take that slot off · a piece with no picture is one this species wears unseen</div>
      </div>`;
    parent.appendChild(this.root);
    this.body = this.root.querySelector<HTMLElement>('.give-body')!;
    this.find = this.root.querySelector<HTMLInputElement>('.find')!;
    this.examine = this.root.querySelector<HTMLElement>('.bp-examine')!;
    this.preview = new CharacterPreview();
    this.root.querySelector<HTMLElement>('.wardrobe-preview')!.prepend(this.preview.canvas);
    this.root.querySelector('.close')!.addEventListener('click', () => this.hide());
    this.root.querySelector('.strip')!.addEventListener('click', () => void this.stripAll());
    this.root.querySelector('.mixed')!.addEventListener('change', () => this.build());
    this.root.querySelector('.blocked')!.addEventListener('change', () => this.build());
    wireTabs(this.root, 'wardrobe', (id) => this.onTab(id));
    // The find box is in the header and is never redrawn, so it keeps its focus while the body changes.
    this.find.addEventListener('input', () => {
      window.clearTimeout(this.findTimer);
      this.findTimer = window.setTimeout(() => this.build(), GIVE_TUNE.findMs);
    });
    // A click on the backdrop closes it; one inside must not.
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) {
        this.hide();
        return;
      }
      const cell = (e.target as HTMLElement).closest<HTMLElement>('.bp-cell[data-id]');
      if (cell) {
        this.select(cell.dataset.id!);
        return;
      }
      const more = (e.target as HTMLElement).closest<HTMLElement>('button[data-more]');
      if (more) {
        this.fill(more.dataset.more!, true);
        return;
      }
      const act = (e.target as HTMLElement).closest<HTMLElement>('button[data-act]');
      if (act) {
        // A button in a group's heading must not fold the group it sits in.
        if (act.closest('summary')) e.preventDefault();
        void this.act(act.dataset.act!);
      }
    });
    this.body.addEventListener('dblclick', (e) => {
      const cell = (e.target as HTMLElement).closest<HTMLElement>('.bp-cell[data-id]');
      if (!cell) return;
      this.select(cell.dataset.id!);
      void this.use(cell.dataset.id!);
    });
    // Enter on the cell under the keyboard does what a double-click does.
    this.body.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const cell = (e.target as HTMLElement).closest<HTMLElement>('.bp-cell[data-id]');
      if (!cell) return;
      e.preventDefault();
      this.select(cell.dataset.id!);
      void this.use(cell.dataset.id!);
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

  /** Attach a character and build the lists from the catalogue it can reach. */
  async attach(character: Character, baseUrl: string): Promise<void> {
    this.character = character;
    try {
      this.catalogue = await character.catalogue(baseUrl);
    } catch {
      this.catalogue = null;
    }
    this.build();
  }

  /**
   * What is worn now, read back off the character every time rather than remembered.
   *
   * A separate record of "what I put on" drifts the moment anything else changes it -- a removal
   * the character refuses, an item worn from the console -- and the panel then lies about the
   * body it is meant to describe. The character is the only thing that knows.
   *
   * Every worn piece is named, not one a slot: a shirt and a jacket are both the chest's, and a map
   * keyed by slot kept whichever was seen last, so one of the two showed as not worn at all.
   */
  private wornIds(): Set<string> {
    const out = new Set<string>();
    const c = this.character;
    if (!c) return out;
    // A character names what it wears by catalogue id, so there is nothing to translate. The pieces
    // it was converted wearing are named by mesh (`shirt_s03_m_l0`), not by catalogue id
    // (`shirt_s03`): dropping the gender and detail suffix names the item exactly, where guessing by
    // which item uses that mesh would pick one of the ten that share it.
    const ids = new Set(this.catalogue?.items.map((i) => i.id) ?? []);
    for (const part of c.status()) {
      if (part.body || !part.worn) continue;
      let id = part.name;
      if (!ids.has(id)) {
        const stripped = id.replace(/_[fm]_l\d+$/, '');
        if (ids.has(stripped)) id = stripped;
      }
      out.add(id);
    }
    return out;
  }

  /**
   * Build the doll again -- but only when the body it stands for really changed.
   *
   * `CharacterPreview.refresh` clones the character and its `dispose` frees the clone's geometry,
   * which `SkeletonUtils.clone` shares with the live character by reference, so every rebuild makes
   * the world's renderer upload the whole body's buffers again. That is the price of a change of
   * clothes and always was. It must not also be the price of a keystroke: the find box rebuilds the
   * list, and the list is not the body.
   *
   * The key is every part the character holds and whether it is on, so a change of body parts (the
   * Appearance tab, a species swapped under the same panel) rebuilds the doll as surely as a shirt
   * does. Colours and the shape sliders are not in it and need not be: the clone shares the
   * character's materials, and the doll copies the sliders across itself every frame.
   */
  private syncDoll(): void {
    const c = this.character;
    if (!c) return;
    const key = c
      .status()
      .map((p) => `${p.name}:${p.worn ? 1 : 0}`)
      .sort()
      .join('|');
    if (this.dollFor === c && this.dollParts === key) return;
    this.dollFor = c;
    this.dollParts = key;
    this.preview.refresh(c);
  }

  private build(): void {
    const w = this.catalogue;
    this.drawn.clear();
    if (!w) {
      this.root.querySelector<HTMLElement>('.count')!.textContent = '';
      this.view = null;
      this.body.innerHTML = `<div class="wardrobe-empty">No converted wardrobe for this character. Run <code>npm run swg -- wardrobe @SWG assets-private --retail-only</code> (and <code>--gender=female</code> for the women).</div>`;
      this.drawExamine();
      this.syncDoll();
      return;
    }
    const find = this.find.value.trim().toLowerCase();
    // A search shows its hits: choices made by hand while browsing are dropped while it lasts.
    if (find !== this.lastFind) this.groups.clear();
    this.lastFind = find;
    const manifest = this.character?.manifest;
    const own = (manifest?.gender ?? (/female/.test(manifest?.id ?? '') ? 'female' : 'male')).charAt(0);
    this.view = buildWardrobeView(w.items, {
      own,
      species: manifest?.id ?? '',
      mixed: this.root.querySelector<HTMLInputElement>('.mixed')?.checked ?? false,
      blocked: this.root.querySelector<HTMLInputElement>('.blocked')?.checked ?? false,
      find,
      worn: this.wornIds(),
      dir: this.character?.wardrobeDir ?? null,
      packPart: (id) => this.character?.packPartOf(id) != null,
    });
    const wanted = openGroups(this.view, find);
    const parts = this.view.groups.map((g) => {
      const note = g.wearing.length ? `wearing ${g.wearing.join(', ')}` : SLOT_NOTE;
      const actions = g.wearing.length ? `<span class="group-actions"><button data-act="off:${escapeHtml(g.id)}" title="take off what this slot holds">take off</button></span>` : '';
      return groupShell(g.id, g.label, g.cells.length, note, this.groups.isOpen(g.id, wanted.has(g.id)), actions);
    });
    // Where the list was is kept: every change of clothes rebuilds the body, and a list that jumped
    // back to the top each time would be unusable at a thousand pieces.
    const scroll = this.body.scrollTop;
    this.body.innerHTML = parts.join('') || `<div class="wardrobe-empty">${find ? `nothing in the wardrobe matches “${escapeHtml(find)}”` : 'no pieces to show'}</div>`;
    this.groups.wire(this.body);
    for (const d of this.body.querySelectorAll<HTMLDetailsElement>('details.cat-group[open]')) this.fill(d.dataset.key ?? '', false);
    this.body.scrollTop = scroll;
    this.note('');
    if (this.selected && !this.cell(this.selected)) this.selected = null;
    this.drawExamine();
    this.syncDoll();
  }

  /**
   * Draw a group's cells into its grid: its first page when it is opened, the next page when the
   * button under it is pressed.
   *
   * Which of the two it is has to be said, not guessed. Folding a group and unfolding it fires the
   * same `toggle` this listens to, and a guard that only refused a redraw of the *first* page let
   * every such fold append another page -- the group grew each time it was looked at.
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
    for (let i = from; i < to; i++) cells.push(cellHtml(g.cells[i], g.cells[i].id === this.selected));
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

  /** Pick a cell (or none): the examine strip shows it. */
  private select(id: string | null): void {
    this.selected = id && this.cell(id) ? id : null;
    for (const el of this.body.querySelectorAll<HTMLElement>('.bp-cell[data-id]')) el.classList.toggle('sel', el.dataset.id === this.selected);
    this.drawExamine();
  }

  /** The examine strip's buttons: put the picked piece on, or take a slot off. */
  private async act(what: string): Promise<void> {
    if (what.startsWith('off:')) {
      await this.choose(what.slice(4), '');
      return;
    }
    if (what === 'use' && this.selected) await this.use(this.selected);
  }

  /** A double-click, or Enter: put it on, or take its slot off when it is on the body already. */
  private async use(id: string): Promise<void> {
    const c = this.cell(id);
    if (!c) return;
    await this.choose(c.group, c.on ? '' : c.id);
  }

  /** Put on what was picked, having taken off whatever that slot held; '' takes the slot off. */
  private async choose(slot: string, id: string): Promise<void> {
    const c = this.character;
    if (!c) return;
    if (this.onWear && this.onRemove) {
      // Through the game's equipment: the arrangement rule takes off what the piece displaces (not
      // the panel's group), and an empty pick takes off every worn piece of this group.
      const refused: string[] = [];
      this.picking = true;
      try {
        if (id) {
          if (!(await this.onWear(id))) refused.push(id);
        } else {
          const parts = [...this.wornItems()].filter(([part, itemId]) => !/^hair_/.test(part) && slotOf(itemId) === slot).map(([part]) => part);
          if (parts.length) this.onRemove(parts);
        }
      } finally {
        this.picking = false;
      }
      this.build();
      this.note(refused.length ? `could not put on: ${refused.join(', ')}` : '');
      this.onChange();
      return;
    }
    const previous = [...this.wornIds()].find((x) => slotOf(x) === slot);
    const refused: string[] = [];
    if (previous && previous !== id) {
      // `previous` may be the display name of a mesh-keyed piece; take off whatever holds the slot.
      const held = c.status().filter((p) => p.worn && !p.body && slotOf(p.name) === slot);
      const keys = held.length ? held.map((p) => p.name) : [previous];
      for (const key of keys) if (!c.remove(key)) refused.push(key);
    }
    if (id) {
      const ok = (await c.wear(id)) || (await c.wearItem(id, this.baseUrl).catch((err) => {
        console.warn('wardrobe: could not wear', id, err);
        return false;
      }));
      if (!ok) refused.push(id);
    }
    // Re-read the body rather than assume the change took: an item the character would not put
    // down stays in its slot, and the panel must show that rather than the click.
    this.build();
    this.note(refused.length ? `could not change: ${refused.join(', ')}` : '');
    this.onChange();
  }

  private async stripAll(): Promise<void> {
    const c = this.character;
    if (!c) return;
    // Everything the character is actually wearing, not everything this panel put on.
    const refused: string[] = [];
    const worn = c.status().filter((part) => !part.body && part.worn).map((part) => part.name);
    if (this.onRemove) {
      // Through the equipment in one step: one save and one rebuild, not one per piece.
      this.picking = true;
      try {
        if (worn.length) this.onRemove(worn);
      } finally {
        this.picking = false;
      }
    } else for (const name of worn) if (!c.remove(name)) refused.push(name);
    this.build();
    this.note(refused.length ? `could not take off: ${refused.join(', ')}` : '');
    this.onChange();
  }

  /** The worn pieces (not the body) with the catalogue id each is, by part name. */
  private wornItems(): Map<string, string> {
    const out = new Map<string, string>();
    const c = this.character;
    if (!c) return out;
    const ids = new Set(this.catalogue?.items.map((i) => i.id) ?? []);
    for (const part of c.status()) {
      if (part.body || !part.worn) continue;
      const stripped = part.name.replace(/_[fm]_l\d+$/, '');
      out.set(part.name, ids.has(part.name) ? part.name : ids.has(stripped) ? stripped : part.name);
    }
    return out;
  }

  /** A line under the header when something did not go as asked. */
  private note(text: string): void {
    const el = this.root.querySelector<HTMLElement>('.count');
    if (!el) return;
    const parts = [this.view ? countLine(this.view) : '', this.developer ? 'developer: a pick gives the piece and puts it on' : '', text].filter(Boolean);
    el.textContent = parts.join(' · ');
    el.title = parts.join(' · ');
    el.classList.toggle('warn', !!text);
  }

  /** The foot of the panel: the game's own name and description of the piece picked. */
  private drawExamine(): void {
    const c = this.selected ? this.cell(this.selected) : undefined;
    if (!c) {
      this.examine.innerHTML = `<div class="bp-examine-empty">click a piece to read what the game says about it · double-click to put it on</div>`;
      return;
    }
    const pic = c.picture === 'icon' && c.icon ? `<img src="${escapeHtml(c.icon)}" decoding="async" alt="">` : `<span class="bp-initials">${escapeHtml(c.initials)}</span>`;
    const head = [escapeHtml(c.label), `<small>${escapeHtml(c.id)}</small>`].join(' ');
    const paragraphs = c.description.split(/\n\s*\n/).filter((p) => p.trim()).map((p) => `<p>${escapeHtml(p.trim())}</p>`).join('');
    const slot = [...SLOTS, OTHER].find((s) => s.id === c.group)?.label ?? c.group;
    // "Take this slot off" is only offered when the slot holds something: worn, it is what the piece's
    // own button does, and with the slot empty there would be nothing for it to take off.
    const wearing = this.view?.groups.find((g) => g.id === c.group)?.wearing.length ?? 0;
    const buttons = [c.on ? '' : `<button data-act="use">Wear</button>`, wearing ? `<button data-act="off:${escapeHtml(c.group)}">Take this slot off</button>` : ''].filter(Boolean).join('');
    this.examine.innerHTML = `<div class="bp-examine-pic" data-initials="${escapeHtml(c.initials)}">${pic}</div><div class="bp-examine-text"><div class="bp-examine-head">${head}</div>${c.note ? `<div class="bp-fit ${c.fit}">${escapeHtml(c.note)}</div>` : ''}<div class="bp-state">${escapeHtml(slot)}${c.on ? ' · worn' : ''}</div>${paragraphs || '<p class="bp-nodesc">The game says nothing more about it.</p>'}</div><div class="bp-actions">${buttons}</div>`;
  }

  /** Build the lists again from the character (the equipment changed what is worn); a pick of the panel's own rebuilds at its end instead. */
  refresh(): void {
    if (this.picking) return;
    this.build();
  }

  private baseUrl = '';
  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  /** The doll's state, for the console. */
  previewState(): unknown {
    return { build: this.preview.lastBuild, canvas: [this.preview.canvas.width, this.preview.canvas.height], frames: this.preview.frames, lastRender: this.preview.lastRender };
  }

  /** What the panel is showing, for the console: the counts the display rules worked out. */
  state(): { open: boolean; listed: number; shown: number; groups: number; opened: number; drawn: number; marked: number; noPicture: number; unseen: number; selected: string | null } {
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
      noPicture: v?.noPicture ?? 0,
      unseen: v?.unseen ?? 0,
      selected: this.selected,
    };
  }

  /** Say why there is nothing to show, in place of the lists. */
  explain(html: string): void {
    this.view = null;
    this.body.innerHTML = `<div class="wardrobe-empty">${html}</div>`;
    this.root.querySelector<HTMLElement>('.count')!.textContent = '';
    this.drawExamine();
  }

  show(): void {
    this.open = true;
    this.root.classList.remove('hidden');
    // The preview watches its own canvas for size, so there is nothing to measure here.
    this.preview.start();
  }

  hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
    this.preview.stop();
  }

  toggle(): boolean {
    if (this.open) this.hide();
    else this.show();
    return this.open;
  }
}

/** One picture cell of the Clothes tab: the shared markup, with the class a worn piece wears. */
function cellHtml(c: GiveCell, selected: boolean): string {
  return giveCellHtml(c, { selected, on: 'worn', more: c.fit === 'block' ? 'block' : '' });
}
