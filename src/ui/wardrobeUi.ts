// The wardrobe panel: what the character is wearing, a slot at a time.
//
// The converted catalogue is a flat list of over a thousand items, so the panel groups them the
// way a person thinks about dressing -- a head, a chest, two arms, feet -- and each slot is a
// dropdown of everything that fits it. Putting something on takes off whatever held that slot,
// which is the rule the original game's paper doll enforces too.

import type { Character, CustomVariable, SpeciesEntry, Wardrobe } from '../player/character';
import { INVENTORY_TABS, tabStrip, wireTabs } from './tabs';
import { CharacterPreview } from './characterPreview';

/** Equipment slots, in the order they read down a body, and the id fragments that name them. */
const SLOTS: { id: string; label: string; match: RegExp }[] = [
  { id: 'hair', label: 'Hair', match: /^hair_/ },
  { id: 'head', label: 'Head', match: /helmet|_hat|^hat_|goggles|headwrap|mask|headdress|bonnet/ },
  { id: 'neck', label: 'Neck', match: /necklace|choker|pendant/ },
  { id: 'chest', label: 'Chest', match: /chest_plate|chest_armor|^shirt|_shirt|jacket|robe|vest|dress|bodysuit|bikini|apron|tunic|blouse|coat/ },
  { id: 'back', label: 'Back', match: /backpack|cape|bandolier|_pack/ },
  { id: 'bicep_l', label: 'Left bicep', match: /bicep_l$|bicep_left/ },
  { id: 'bicep_r', label: 'Right bicep', match: /bicep_r$|bicep_right/ },
  { id: 'bracer_l', label: 'Left bracer', match: /bracer_l$|bracer_left|wrist_l$/ },
  { id: 'bracer_r', label: 'Right bracer', match: /bracer_r$|bracer_right|wrist_r$/ },
  { id: 'hands', label: 'Hands', match: /glove/ },
  { id: 'waist', label: 'Waist', match: /^belt|_belt|sash/ },
  { id: 'legs', label: 'Legs', match: /leggings|^pants|_pants|skirt|kilt|shorts/ },
  { id: 'feet', label: 'Feet', match: /boots|shoes|sandals/ },
];
const OTHER = { id: 'other', label: 'Other', match: /.*/ };

/** The slot an item belongs in, by the first pattern its id fits. */
export function slotOf(id: string): string {
  for (const s of SLOTS) if (s.match.test(id)) return s.id;
  return OTHER.id;
}

export class WardrobeUi {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly preview: CharacterPreview;
  private character: Character | null = null;
  private catalogue: Wardrobe | null = null;
  open = false;
  /** A click on another tab: the game swaps the panels. */
  onTab: (id: string) => void = () => {};
  /** Another species or gender picked: the game reloads the player as it. */
  onSpecies: (id: string) => void = () => {};
  private species: SpeciesEntry[] = [];
  private speciesId = '';

  constructor(parent: HTMLElement, private readonly onChange: () => void) {
    this.root = document.createElement('div');
    this.root.id = 'wardrobe';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="wardrobe-panel">
        <div class="wardrobe-header">
          ${tabStrip(INVENTORY_TABS, 'wardrobe')}
          <select class="species hidden" title="Species and gender"></select>
          <span class="count"></span>
          <button class="strip">Take everything off</button>
          <button class="close">Close <b>I</b></button>
        </div>
        <div class="wardrobe-main">
          <div class="wardrobe-preview"><div class="preview-hint">drag to turn · wheel to zoom</div></div>
          <div class="wardrobe-body"></div>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.body = this.root.querySelector<HTMLElement>('.wardrobe-body')!;
    this.preview = new CharacterPreview();
    this.root.querySelector<HTMLElement>('.wardrobe-preview')!.prepend(this.preview.canvas);
    this.root.querySelector('.close')!.addEventListener('click', () => this.hide());
    this.root.querySelector('.strip')!.addEventListener('click', () => void this.stripAll());
    this.root.querySelector<HTMLSelectElement>('.species')!.addEventListener('change', (e) => {
      const id = (e.target as HTMLSelectElement).value;
      if (id && id !== this.speciesId) this.onSpecies(id);
    });
    wireTabs(this.root, 'wardrobe', (id) => this.onTab(id));
    // A click on the backdrop closes it; one inside must not.
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.hide();
    });
  }

  /** The species the pack offers, for the picker in the header; hidden when there is only the one. */
  setSpecies(list: SpeciesEntry[], current: string): void {
    this.species = list;
    this.speciesId = current;
    const sel = this.root.querySelector<HTMLSelectElement>('.species')!;
    sel.classList.toggle('hidden', list.length < 2);
    sel.innerHTML = list.map((s) => `<option value="${s.id}"${s.id === current ? ' selected' : ''}>${s.species.replace(/_/g, ' ')} ${s.gender}</option>`).join('');
  }

  /** Attach a character and build the slot list from the catalogue it can reach. */
  async attach(character: Character, baseUrl: string): Promise<void> {
    this.character = character;
    this.speciesId = character.manifest.id;
    const sel = this.root.querySelector<HTMLSelectElement>('.species')!;
    if (sel.value !== this.speciesId && [...sel.options].some((o) => o.value === this.speciesId)) sel.value = this.speciesId;
    try {
      this.catalogue = await character.catalogue(baseUrl);
    } catch {
      this.catalogue = null;
    }
    this.build();
  }

  /**
   * The shape sliders: the mesh's blend targets, with a two-ended pair (blend_jaw_0, blend_jaw_1)
   * as one slider from -1 to 1 and a single target (blend_muscle) as one from 0 to 1.
   */
  private shapeRows(): string {
    const c = this.character;
    if (!c) return '';
    const values = c.morphValues();
    const names = Object.keys(values).sort();
    if (!names.length) return '';
    const seen = new Set<string>();
    const rows: string[] = [];
    for (const n of names) {
      if (seen.has(n)) continue;
      const pair = /^(.*)_0$/.exec(n);
      const other = pair ? `${pair[1]}_1` : null;
      if (other && other in values) {
        seen.add(n);
        seen.add(other);
        const v = values[other] - values[n];
        rows.push(`<label class="wardrobe-slot shape"><span class="slot-label">${prettyMorph(pair![1])}</span><input type="range" min="-1" max="1" step="0.02" value="${v.toFixed(2)}" data-lo="${n}" data-hi="${other}" /><span class="slot-count">${v.toFixed(2)}</span></label>`);
      } else {
        seen.add(n);
        rows.push(`<label class="wardrobe-slot shape"><span class="slot-label">${prettyMorph(n)}</span><input type="range" min="0" max="1" step="0.02" value="${values[n].toFixed(2)}" data-hi="${n}" /><span class="slot-count">${values[n].toFixed(2)}</span></label>`);
      }
    }
    return `<h3 class="wardrobe-section">Shape <span>${rows.length} sliders</span></h3>${rows.join('')}`;
  }

  /**
   * The colours and choices the species' skin, hair and eyes take. The textures were baked with
   * the pack's values by the converter, so a swatch is not applied live: picking one shows the
   * command that bakes the pack again with it.
   */
  private colourRows(): string {
    const c = this.character;
    const vars = c?.manifest.variables ?? [];
    if (!vars.length) return '';
    const values = c?.manifest.values ?? {};
    const rows: string[] = [];
    for (const v of vars) {
      const short = v.name.replace(/^.*\//, '');
      const current = values[v.name] ?? values[short] ?? v.default;
      if (v.kind === 'palette' && v.colors?.length) {
        const swatches = v.colors.map((rgb, i) => `<button class="swatch${i === current ? ' on' : ''}" data-var="${v.name}" data-value="${i}" style="background:rgb(${rgb[0]},${rgb[1]},${rgb[2]})" title="${short} = ${i}"></button>`).join('');
        rows.push(`<div class="wardrobe-slot colour"><span class="slot-label">${prettyMorph(short)}</span><div class="swatches">${swatches}</div><span class="slot-count">${v.colors.length}</span></div>`);
      } else if (v.kind === 'index') {
        const opts = Array.from({ length: v.count ?? 0 }, (_, i) => `<option value="${i}"${i === current ? ' selected' : ''}>${i + 1} of ${v.count}</option>`).join('');
        rows.push(`<label class="wardrobe-slot colour"><span class="slot-label">${prettyMorph(short)}</span><select data-var="${v.name}">${opts}</select><span class="slot-count">${v.count}</span></label>`);
      }
    }
    if (!rows.length) return '';
    return `<h3 class="wardrobe-section">Colours and features <span>baked by the converter: pick one for the command</span></h3>${rows.join('')}<div class="bake-hint"></div>`;
  }

  /** The command that bakes this character again with a variable set, shown under the swatches. */
  private showBake(name: string, value: number): void {
    const hint = this.body.querySelector<HTMLElement>('.bake-hint');
    if (!hint) return;
    const id = this.character?.manifest.id ?? 'human_male';
    hint.innerHTML = `<code>npm run swg -- species @SWG assets-private --retail-only --only=${id} --var=${name.replace(/^.*\//, '')}=${value}</code> bakes ${id} with this ${prettyMorph(name.replace(/^.*\//, '')).toLowerCase()}; live colours are not there yet.`;
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
    const shape = this.shapeRows();
    const colours = this.colourRows();
    if (!w) {
      this.root.querySelector<HTMLElement>('.count')!.textContent = '';
      this.body.innerHTML = `${shape}${colours}<div class="wardrobe-empty">No converted wardrobe for this character. Run <code>npm run swg -- wardrobe @SWG assets-private --retail-only</code> (and <code>--gender=female</code> for the women).</div>`;
      if (this.character) this.preview.refresh(this.character);
      this.wireShape();
      return;
    }
    const equipped = this.equippedNow();
    const bySlot = new Map<string, { id: string; label: string }[]>();
    for (const item of w.items) {
      const slot = slotOf(item.id);
      (bySlot.get(slot) ?? bySlot.set(slot, []).get(slot)!).push({ id: item.id, label: prettyName(item.id) });
    }
    for (const list of bySlot.values()) list.sort((a, b) => a.label.localeCompare(b.label));
    this.root.querySelector<HTMLElement>('.count')!.textContent = `${w.items.length} items`;
    const rows: string[] = [];
    for (const slot of [...SLOTS, OTHER]) {
      const list = bySlot.get(slot.id);
      if (!list?.length) continue;
      const current = equipped.get(slot.id) ?? '';
      const options = [`<option value="">— none —</option>`, ...list.map((i) => `<option value="${i.id}"${i.id === current ? ' selected' : ''}>${i.label}</option>`)];
      rows.push(`<label class="wardrobe-slot"><span class="slot-label">${slot.label}</span><select data-slot="${slot.id}">${options.join('')}</select><span class="slot-count">${list.length}</span></label>`);
    }
    this.body.innerHTML = `${shape}${colours}<h3 class="wardrobe-section">Clothing <span>${w.items.length} items</span></h3>${rows.join('')}`;
    if (this.character) this.preview.refresh(this.character);
    for (const sel of this.body.querySelectorAll<HTMLSelectElement>('select[data-slot]')) {
      sel.addEventListener('change', () => void this.choose(sel.dataset.slot!, sel.value));
    }
    this.wireShape();
  }

  private wireShape(): void {
    for (const input of this.body.querySelectorAll<HTMLInputElement>('input[type=range]')) {
      input.addEventListener('input', () => {
        const c = this.character;
        if (!c) return;
        const v = Number(input.value);
        if (input.dataset.lo) {
          c.setMorph(input.dataset.lo, Math.max(0, -v));
          c.setMorph(input.dataset.hi!, Math.max(0, v));
        } else c.setMorph(input.dataset.hi!, v);
        input.nextElementSibling!.textContent = v.toFixed(2);
        this.onChange();
      });
    }
    for (const b of this.body.querySelectorAll<HTMLButtonElement>('.swatch')) {
      b.addEventListener('click', () => {
        for (const o of this.body.querySelectorAll('.swatch.on')) o.classList.remove('on');
        b.classList.add('on');
        this.showBake(b.dataset.var!, Number(b.dataset.value));
      });
    }
    for (const sel of this.body.querySelectorAll<HTMLSelectElement>('select[data-var]')) {
      sel.addEventListener('change', () => this.showBake(sel.dataset.var!, Number(sel.value)));
    }
  }

  /** Put on what the dropdown says, having taken off whatever that slot held. */
  private async choose(slot: string, id: string): Promise<void> {
    const c = this.character;
    if (!c) return;
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
    for (const part of c.status()) {
      if (part.body || !part.worn) continue;
      if (!c.remove(part.name)) refused.push(part.name);
    }
    this.build();
    this.note(refused.length ? `could not take off: ${refused.join(', ')}` : '');
    this.onChange();
  }

  /** A line under the header when something did not go as asked. */
  private note(text: string): void {
    const el = this.root.querySelector<HTMLElement>('.count');
    if (!el) return;
    const total = this.catalogue ? `${this.catalogue.items.length} items` : '';
    el.textContent = text ? `${total} · ${text}` : total;
    el.classList.toggle('warn', !!text);
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

/** "blend_jaw" reads as "Jaw", "index_color_skin" as "Color skin". */
function prettyMorph(name: string): string {
  const s = name.replace(/^(blend|index|private)_/, '').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "armor_mandalorian_chest_plate" reads better as "Mandalorian chest plate". */
function prettyName(id: string): string {
  const words = id.replace(/^(armor|hair)_/, '').split('_');
  const text = words.join(' ').replace(/\bs(\d+)\b/g, '$1').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
