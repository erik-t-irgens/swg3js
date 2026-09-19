// The wardrobe panel: what the character is wearing, a slot at a time.
//
// The converted catalogue is a flat list of over a thousand items, so the panel groups them the
// way a person thinks about dressing -- a head, a chest, two arms, feet -- and each slot is a
// dropdown of everything that fits it. Putting something on takes off whatever held that slot,
// which is the rule the original game's paper doll enforces too.

import type { Character, Wardrobe } from '../player/character';
import { INVENTORY_TABS, tabStrip, wireTabs } from './tabs';
import { CharacterPreview } from './characterPreview';
import type { PreviewEffects } from './previewDof';
import { OTHER_GROUP, SLOT_GROUPS, fitFor, slotGroupOf } from '../core/inventory';
import { escapeHtml } from './catalogue';

/** Equipment slots, in the order they read down a body, and the id fragments that name them (the backpack's rules own the list). */
const SLOTS = SLOT_GROUPS;
const OTHER = OTHER_GROUP;

/** The slot an item belongs in, by the first pattern its id fits. */
export const slotOf = slotGroupOf;

export class WardrobeUi {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
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

  constructor(parent: HTMLElement, private readonly onChange: () => void) {
    this.root = document.createElement('div');
    this.root.id = 'wardrobe';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="wardrobe-panel">
        <div class="wardrobe-header">
          ${tabStrip(INVENTORY_TABS, 'wardrobe')}
          <span class="count"></span>
          <label class="mixed-label" title="Pieces authored for the other gender's body share the skeleton, not the shape: some fit, some do not"><input type="checkbox" class="mixed" /> other gender's pieces too</label>
          <label class="mixed-label" title="The game's appearance table says this species cannot wear them; a pick here puts one on all the same"><input type="checkbox" class="blocked" /> pieces this species cannot wear</label>
          <button class="strip">Take everything off</button>
          <button class="close">Close <b>I</b></button>
        </div>
        <div class="wardrobe-main">
          <div class="wardrobe-preview"><div class="preview-hint">drag to turn · right-drag to pan · wheel to zoom · double-click to reset</div></div>
          <div class="wardrobe-body"></div>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.body = this.root.querySelector<HTMLElement>('.wardrobe-body')!;
    this.preview = new CharacterPreview();
    this.root.querySelector<HTMLElement>('.wardrobe-preview')!.prepend(this.preview.canvas);
    this.root.querySelector('.close')!.addEventListener('click', () => this.hide());
    this.root.querySelector('.strip')!.addEventListener('click', () => void this.stripAll());
    this.root.querySelector('.mixed')!.addEventListener('change', () => this.build());
    this.root.querySelector('.blocked')!.addEventListener('change', () => this.build());
    wireTabs(this.root, 'wardrobe', (id) => this.onTab(id));
    // A click on the backdrop closes it; one inside must not.
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.hide();
    });
  }

  /** Attach a character and build the slot list from the catalogue it can reach. */
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
   * What each slot holds, read back off the character every time rather than remembered.
   *
   * A separate record of "what I put on" drifts the moment anything else changes it -- a removal
   * the character refuses, an item worn from the console -- and the panel then lies about the
   * body it is meant to describe. The character is the only thing that knows.
   */
  private equippedNow(): Map<string, string> {
    const out = new Map<string, string>();
    const c = this.character;
    if (!c) return out;
    // A character names what it wears the same way the dropdowns do -- by catalogue id -- so
    // there is nothing to translate. Mapping back from mesh names used to collapse the ten
    // necklaces that share one mesh into whichever had been seen last.
    // The pieces the character was converted wearing are named by mesh (shirt_s03_m_l0), not by
    // catalogue id (shirt_s03). Dropping the gender and detail suffix names the item exactly --
    // guessing instead by which item uses that mesh would pick one of the ten that share it.
    const ids = new Set(this.catalogue?.items.map((i) => i.id) ?? []);
    for (const part of c.status()) {
      if (part.body || !part.worn) continue;
      let id = part.name;
      if (!ids.has(id)) {
        const stripped = id.replace(/_[fm]_l\d+$/, '');
        if (ids.has(stripped)) id = stripped;
      }
      out.set(slotOf(id), id);
    }
    return out;
  }

  private build(): void {
    const w = this.catalogue;
    if (!w) {
      this.root.querySelector<HTMLElement>('.count')!.textContent = '';
      this.body.innerHTML = `<div class="wardrobe-empty">No converted wardrobe for this character. Run <code>npm run swg -- wardrobe @SWG assets-private --retail-only</code> (and <code>--gender=female</code> for the women).</div>`;
      if (this.character) this.preview.refresh(this.character);
      return;
    }
    const equipped = this.equippedNow();
    const worn = new Set(equipped.values());
    // A piece authored for the other gender's body fits this one only sometimes (the meshes
    // share a skeleton, not a shape), so those stay out of the lists unless asked for.
    const own = (this.character?.manifest.gender ?? (/female/.test(this.character?.manifest.id ?? '') ? 'female' : 'male')).charAt(0);
    const mixed = this.root.querySelector<HTMLInputElement>('.mixed')?.checked ?? false;
    // Pieces the game's appearance table says this species cannot wear stay out unless asked for
    // (a piece the species' own pack carries is always wearable: it is worn as that part).
    const showBlocked = this.root.querySelector<HTMLInputElement>('.blocked')?.checked ?? false;
    const species = this.character?.manifest.id ?? '';
    let hidden = 0;
    let blocked = 0;
    const seen = new Set<string>();
    const bySlot = new Map<string, { id: string; label: string; title: string }[]>();
    for (const item of w.items) {
      if (item.kind === 'hair' || /^hair_/.test(item.id)) continue; // the appearance tab's
      // A repeated id is one item: the first entry is the one the game dresses.
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      const other = !!item.gender && item.gender.charAt(0) !== own;
      if (other && !mixed && !worn.has(item.id)) {
        hidden++;
        continue;
      }
      const cannot = fitFor(item.fit, species, this.character?.packPartOf(item.id) != null) === 'block';
      if (cannot && !showBlocked && !worn.has(item.id)) {
        blocked++;
        continue;
      }
      const slot = slotOf(item.id);
      const name = item.name?.trim() || prettyName(item.id);
      const label = `${name}${other ? ` (${item.gender === 'f' ? "women's" : "men's"})` : ''}${cannot ? ' (cannot wear)' : ''}`;
      (bySlot.get(slot) ?? bySlot.set(slot, []).get(slot)!).push({ id: item.id, label, title: item.description ? `${item.id}: ${item.description}` : item.id });
    }
    // The game gives many items one name ("Plain Shirt" twice, "Helmet" seven times): those carry their id too.
    for (const list of bySlot.values()) {
      const count = new Map<string, number>();
      for (const i of list) count.set(i.label, (count.get(i.label) ?? 0) + 1);
      for (const i of list) if ((count.get(i.label) ?? 0) > 1) i.label = `${i.label} [${i.id}]`;
      list.sort((a, b) => a.label.localeCompare(b.label));
    }
    this.hiddenNote = [hidden ? `${hidden} of the other gender's hidden` : '', blocked ? `${blocked} this species cannot wear hidden` : ''].filter(Boolean).join(' · ');
    this.shownCount = seen.size - hidden - blocked;
    this.note('');
    const rows: string[] = [];
    for (const slot of [...SLOTS, OTHER]) {
      const list = bySlot.get(slot.id);
      if (!list?.length) continue;
      const current = equipped.get(slot.id) ?? '';
      const options = [`<option value="">— none —</option>`, ...list.map((i) => `<option value="${escapeHtml(i.id)}" title="${escapeHtml(i.title)}"${i.id === current ? ' selected' : ''}>${escapeHtml(i.label)}</option>`)];
      rows.push(`<label class="wardrobe-slot"><span class="slot-label">${slot.label}</span><select data-slot="${slot.id}">${options.join('')}</select><span class="slot-count">${list.length}</span></label>`);
    }
    this.body.innerHTML = rows.join('');
    if (this.character) this.preview.refresh(this.character);
    for (const sel of this.body.querySelectorAll<HTMLSelectElement>('select[data-slot]')) {
      sel.addEventListener('change', () => void this.choose(sel.dataset.slot!, sel.value));
    }
  }

  /** Put on what the dropdown says, having taken off whatever that slot held. */
  private async choose(slot: string, id: string): Promise<void> {
    const c = this.character;
    if (!c) return;
    if (this.onWear && this.onRemove) {
      // Through the game's equipment: the arrangement rule takes off what the piece displaces (not
      // the dropdown's group), and "none" takes off every worn piece of this group.
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
    const previous = this.equippedNow().get(slot);
    const refused: string[] = [];
    if (previous && previous !== id) {
      // `previous` may be the display name of a mesh-keyed piece; take off whatever holds the slot.
      const held = c.status().filter((p) => p.worn && !p.body && slotOf(p.name) === slot);
      const keys = held.length ? held.map((p) => p.name) : this.partNames(previous);
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
    // down stays in its slot, and the dropdown must show that rather than the click.
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

  /** How many items the lists show, and what they leave out, for the header. */
  private shownCount = 0;
  private hiddenNote = '';

  /** A line under the header when something did not go as asked. */
  private note(text: string): void {
    const el = this.root.querySelector<HTMLElement>('.count');
    if (!el) return;
    const parts = [this.catalogue ? `${this.shownCount || this.catalogue.items.length} items` : '', this.hiddenNote, this.developer ? 'developer: a pick gives the piece and puts it on' : '', text].filter(Boolean);
    el.textContent = parts.join(' · ');
    el.classList.toggle('warn', !!text);
  }

  /** Build the lists again from the character (the equipment changed what is worn); a pick of the panel's own rebuilds at its end instead. */
  refresh(): void {
    if (this.picking) return;
    this.build();
  }

  /** A thing is taken off by the same name it was put on by. */
  private partNames(id: string): string[] {
    return [id];
  }

  private baseUrl = '';
  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  /** The doll's state, for the console. */
  previewState(): unknown {
    return { build: this.preview.lastBuild, canvas: [this.preview.canvas.width, this.preview.canvas.height], frames: this.preview.frames, lastRender: this.preview.lastRender };
  }

  /** Say why there is nothing to show, in place of the slot list. */
  explain(html: string): void {
    this.body.innerHTML = `<div class="wardrobe-empty">${html}</div>`;
    this.root.querySelector<HTMLElement>('.count')!.textContent = '';
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

/** "armor_mandalorian_chest_plate" reads better as "Mandalorian chest plate". */
function prettyName(id: string): string {
  const words = id.replace(/^(armor|hair)_/, '').split('_');
  const text = words.join(' ').replace(/\bs(\d+)\b/g, '$1').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
