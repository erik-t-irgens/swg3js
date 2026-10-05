// The appearance editor: species and gender, the shape sliders and the colours a character
// takes, on the inventory's own tab beside the clothing, with the doll turning beside them.
//
// With the creator's own table converted (`characters/customization.json`), the page is laid out as the
// game's creator was: its tabs in its order, its rows in theirs, under its words, a colour that follows
// another hidden behind it and written with it, a colour that sets others setting them, and each palette's
// creation colours first in the game's own columns. Which customizer key a row writes is decided in
// `creatorView` (creatorModel.ts) and nowhere here. Without the table the page is what it always was:
// every slider the pack has, then every colour, named by `variableLabel.ts`.
//
// The hairstyles are a grid of the converter's pictures in the backpack's own cells, at the top of the
// species' hair tab: this gender's styles in the game's order, the other gender's, then what the game never
// offered (hairGrid.ts decides which and in what order). One click wears a style, through the game's
// prepared path (`onHair`: loaded hidden, its colour carried over, settled and compiled before it shows).
//
// A colour row is a strip -- the colour now, then the colours the creator offered -- and a click on it opens
// the picker under the row (dyePicker.ts): the row's own palette, and for a garment, a hairstyle or a dye of
// ours every garment and creator palette there is, and for an eye colour every species' eyes. A worn piece's
// colours stand in one section a piece, under the game's name for it, a row a variable however many of its
// meshes read it (`itemSections`), and a pick writes every one of those meshes' keys.
import type { Character, SpeciesEntry, Wardrobe } from '../player/character.ts';
import { loadCustomizeFile } from '../player/customizer.ts';
import { INVENTORY_TABS, tabStrip, wireTabs } from './tabs.ts';
import { CharacterPreview } from './characterPreview.ts';
import { distinctLabels, plainLabel } from './variableLabel.ts';
import { CREATOR_TUNE, bareName, catalogueName, creatorTableNow, creatorView, hairNone, itemSections, loadCreatorTable, ownSection, packColours, packSliders, pickWrites, swatchLayout, type CreatorSpecies, type CreatorState, type CreatorTable, type CreatorView, type ItemColour, type ItemSection, type PackColour, type ViewRow } from './creatorModel.ts';
import { NO_HAIR, hairCells, withOursHair, type HairGrid, type HairItem } from './hairGrid.ts';
import { hairOfSpecies, pickedTint } from '../core/inventory.ts';
import { groupHtml, GroupState } from './catalogue.ts';
import { giveCellHtml } from './giveModel.ts';
import { DyePicker, allGarmentColours, countText, creatorPalettes, drawStrip, eyePalettes, garmentPalettes, pickKind, type PickerRow, type PickerSource, type PickerTab, type PickKind } from './dyePicker.ts';
import { isRawColour } from '../player/texrender.ts';

/** A row of the page that a strip, a scrub or the picker names by id: what a pick writes, and for a colour, what its picker shows. */
interface PageRow {
  id: string;
  write(value: number): void;
  current(values: Record<string, number>): number;
  /** A colour's picker row; none for a choice among textures. */
  colour?: PickerRow;
}

export class AppearanceUi {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly preview: CharacterPreview;
  /** The doll, for the console (__debug.previewDof). */
  get doll(): CharacterPreview {
    return this.preview;
  }
  private character: Character | null = null;
  open = false;
  /** A click on another tab: the game swaps the panels. */
  onTab: (id: string) => void = () => {};
  /** Another species or gender picked: the game reloads the player as it. */
  onSpecies: (id: string) => void = () => {};
  private species: SpeciesEntry[] = [];
  private speciesId = '';

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
  constructor(parent: HTMLElement, private readonly onChange: () => void) {
    this.root = document.createElement('div');
    this.root.id = 'appearance';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="wardrobe-panel wide">
        <div class="wardrobe-header">
          ${tabStrip(INVENTORY_TABS, 'appearance')}
          <select class="species hidden" title="Species and gender"></select>
          <span class="count"></span>
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
    this.root.querySelector('.close')!.addEventListener('click', () => this.dismiss());
    wireTabs(this.root, 'appearance', (id) => this.onTab(id));
    this.root.querySelector<HTMLSelectElement>('.species')!.addEventListener('change', (e) => {
      const id = (e.target as HTMLSelectElement).value;
      if (id && id !== this.speciesId) this.onSpecies(id);
    });
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.dismiss();
    });
    // The hairstyles' cells and the colour rows' strips, listened to once on the body, which every build fills again.
    this.body.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const strip = target.closest<HTMLElement>('canvas.dye-strip[data-pick]');
      if (strip) {
        this.togglePicker(strip.dataset.pick!);
        return;
      }
      const cell = target.closest<HTMLElement>('.hair-grid .bp-cell[data-id]');
      if (cell) this.pickHair(cell);
    });
    this.body.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const cell = (e.target as HTMLElement).closest<HTMLElement>('.hair-grid .bp-cell[data-id]');
      if (!cell) return;
      e.preventDefault();
      this.pickHair(cell);
    });
    // A picture that will not load shows the style's number instead, as the backpack's do (error events do not bubble).
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

  /**
   * Put a hairstyle on, or none (`null`): the game's prepared path (`App.wearHairPrepared`), whose answer is
   * what to say. Unset, the character puts it on at once, which is right only where no world draws it.
   */
  onHair: ((id: string | null) => Promise<string>) | null = null;

  /** The species the pack offers, for the picker in the header; hidden when there is only the one. */
  setSpecies(list: SpeciesEntry[], current: string): void {
    this.species = list;
    this.speciesId = current;
    const sel = this.root.querySelector<HTMLSelectElement>('.species')!;
    sel.classList.toggle('hidden', list.length < 2);
    sel.innerHTML = list.map((s) => `<option value="${s.id}"${s.id === current ? ' selected' : ''}>${s.species.replace(/_/g, ' ')} ${s.gender}</option>`).join('');
  }


  private baseUrl = '';
  /** The species' hairstyles out of the wardrobe (both genders'), and the folder their pictures are in. */
  private hair: HairItem[] = [];
  private hairDir: string | null = null;
  /** The grid drawn last, for the console. */
  private hairGrid: HairGrid | null = null;
  /** The style being put on ('' for none) while it loads: its cell is busy and every cell's click waits. */
  private hairBusy: string | null = null;
  /** The hair groups opened or shut by hand, so a rebuild keeps them so. */
  private readonly hairGroups = new GroupState();
  /** The creator's own table, once it has arrived; null when it is not converted (the page then lays itself out as before). */
  private table: CreatorTable | null = null;
  /** What the page drew last from the table, and its rows by name, which the strips and sliders name. */
  private view: CreatorView | null = null;
  private readonly rowsByName = new Map<string, ViewRow>();
  /** The last table row picked and every key it wrote, for the console. */
  private lastPick: { row: string; value: number; keys: string[]; followers: string[]; sets: string[] } | null = null;
  /** The page's colour rows (and a worn piece's choices) by id, which the strips, the scrubs and the picker name. */
  private readonly picks = new Map<string, PageRow>();
  /** The picker open under a row, and that row's id: one at a time, made when its strip is clicked. */
  private picker: DyePicker | null = null;
  private pickerId: string | null = null;
  /** The wardrobe's catalogue (the game's names for what is worn), and the palettes its recipes carry (the picker's Garments). */
  private items: Wardrobe['items'] = [];
  private wardrobePalettes: Record<string, number[][]> | null = null;

  /** Show a character: its sliders and colours, and the doll. */
  attach(character: Character, baseUrl = ''): void {
    if (this.character !== character) {
      // Another character's styles and pictures are not this one's; the same one's stand until its catalogue answers again.
      this.hair = [];
      this.hairDir = null;
      this.hairBusy = null;
      this.hairGroups.clear();
      this.items = [];
      this.wardrobePalettes = null;
      this.closePicker();
    }
    this.character = character;
    this.baseUrl = baseUrl;
    this.speciesId = character.manifest.id;
    const sel = this.root.querySelector<HTMLSelectElement>('.species')!;
    if (sel.value !== this.speciesId && [...sel.options].some((o) => o.value === this.speciesId)) sel.value = this.speciesId;
    this.table = creatorTableNow(baseUrl) ?? null;
    this.build();
    // The hairstyles, the pieces' names and the garment palettes come from the wardrobe, which loads on its
    // own time (its recipes are the customizer's own parse, already in hand); the page fills in when it lands.
    void character
      .catalogue(baseUrl)
      .then(async (w) => {
        const dir = character.wardrobeDir;
        const file = dir ? await loadCustomizeFile(dir) : null;
        return { items: w.items, palettes: file?.palettes ?? null };
      })
      .catch(() => ({ items: [] as Wardrobe['items'], palettes: null }))
      .then(({ items, palettes }) => {
        if (this.character !== character) return;
        this.hair = hairOfSpecies(items as HairItem[], character.speciesName);
        this.hairDir = character.wardrobeDir;
        this.items = items;
        this.wardrobePalettes = palettes;
        this.build();
      });
    // The creator's table is fetched once a session; the page lays itself out again when it lands.
    void loadCreatorTable(baseUrl).then((table) => {
      if (this.character !== character || table === this.table) return;
      this.table = table;
      this.build();
    });
  }

  /** Draw the page again from the character as it stands (a knob moved in the console). */
  refresh(): void {
    if (this.character) this.build();
  }

  /** The hairstyle section of a page without a hair tab: its heading, then the grid (`hairGridHtml`'s). */
  private hairSection(grid: string): string {
    if (!grid) return '';
    return `<h3 class="wardrobe-section">Hair <span>${this.hairGrid?.styles ?? 0} styles for this species</span></h3>${grid}`;
  }

  /**
   * The grid of styles alone, which the table's hair tab opens with: a folding group each (this gender's,
   * the other's, what the game never offered), each cell a picture and "Style N", the worn one marked. No
   * hair is a cell for every species (`hairNone`), the Twi'lek, Zabrak and Trandoshan the game kept from
   * going bald included. A group opens on its own when it is the first or holds the worn style; one the
   * player opened or shut stays so.
   */
  private hairGridHtml(): string {
    const c = this.character;
    if (!c || !this.hair.length) {
      this.hairGrid = null;
      return '';
    }
    const grid = hairCells(this.table, this.hair, c.speciesName, c.genderName, c.hairWorn(), this.hairDir);
    this.hairGrid = grid;
    if (!grid.groups.length) return '';
    const busy = this.hairBusy;
    const groups = grid.groups.map((g, i) => {
      const wanted = i === 0 || g.cells.some((x) => x.on);
      const inner = g.cells.map((x) => giveCellHtml(x, { on: 'worn', selected: false, ...(busy === x.id ? { more: 'busy', corner: '<span class="bp-busy">putting on</span>' } : {}) })).join('');
      return groupHtml(`hair:${g.id}`, g.label, g.cells.filter((x) => x.id !== NO_HAIR).length, g.note, this.hairGroups.isOpen(`hair:${g.id}`, wanted), inner);
    });
    return `<div class="hair-grid${busy !== null ? ' busy' : ''}">${groups.join('')}</div>`;
  }

  /**
   * A style's cell clicked: it goes on through `onHair` (none, for the cell for no hair), its cell busy while
   * it loads and every other click ignored meanwhile, and the page is drawn again from the character once
   * it is on; a style that did not go on says why under the page. A click on what is already worn does nothing.
   */
  private pickHair(cell: HTMLElement): void {
    const c = this.character;
    if (!c || this.hairBusy !== null) return;
    const id = cell.dataset.id ?? NO_HAIR;
    const want = id || null;
    const before = c.hairWorn();
    if (want === before) return;
    this.hairBusy = id;
    cell.classList.add('busy');
    cell.querySelector('.bp-pic')?.insertAdjacentHTML('beforeend', '<span class="bp-busy">putting on</span>');
    cell.closest('.hair-grid')?.classList.add('busy');
    const wear = this.onHair ?? ((style: string | null) => c.wearHair(style, this.baseUrl).then((on) => (on ? 'on' : 'not in this wardrobe')));
    void wear(want)
      .catch((err: unknown) => `could not put it on: ${err instanceof Error ? err.message : String(err)}`)
      .then((said) => {
        this.hairBusy = null;
        if (this.character !== c) return;
        this.build();
        // Saved only when the style really changed: one that did not load, or was dropped because the
        // character went (to the select screen, out of the creator) while it loaded, writes nothing into
        // whichever record is current by now -- the same rig may be dressing the next one.
        if (c.hairWorn() !== before) this.onChange();
        const hint = this.body.querySelector<HTMLElement>('.bake-hint');
        if (hint && c.hairWorn() !== want) hint.textContent = said;
      });
  }

  /** Say why there is nothing to edit, in place of the sliders. */
  explain(html: string): void {
    this.character = null;
    this.body.innerHTML = `<div class="wardrobe-empty">${html}</div>`;
    this.root.querySelector<HTMLElement>('.count')!.textContent = '';
  }

  private shapeRows(): string {
    const c = this.character;
    if (!c) return '';
    const values = c.morphValues();
    const rows: string[] = [];
    // Height first: a scale over the model within the species' own range.
    rows.push(`<label class="wardrobe-slot shape"><span class="slot-label">Height</span><input type="range" class="height" min="0" max="1" step="0.01" value="${c.height.toFixed(2)}" /><span class="slot-count">${c.height.toFixed(2)}</span></label>`);
    for (const s of packSliders(Object.keys(values))) {
      if (s.lo) {
        const v = values[s.hi] - values[s.lo];
        rows.push(`<label class="wardrobe-slot shape"><span class="slot-label">${prettyMorph(s.name)}</span><input type="range" min="-1" max="1" step="0.02" value="${v.toFixed(2)}" data-lo="${s.lo}" data-hi="${s.hi}" /><span class="slot-count">${v.toFixed(2)}</span></label>`);
      } else {
        rows.push(`<label class="wardrobe-slot shape"><span class="slot-label">${prettyMorph(s.name)}</span><input type="range" min="0" max="1" step="0.02" value="${values[s.hi].toFixed(2)}" data-hi="${s.hi}" /><span class="slot-count">${values[s.hi].toFixed(2)}</span></label>`);
      }
    }
    return `<h3 class="wardrobe-section">Shape <span>${rows.length} sliders</span></h3>${rows.join('')}`;
  }

  /**
   * The colours and choices the species' skin, hair and eyes take, then each worn piece's own. A colour
   * no live recipe reads (a pack converted before the recipes) shows dimmed, and picking one shows the
   * command that bakes the pack again with it.
   */
  private colourRows(only?: (v: { key: string; private: boolean; mesh: string }) => boolean): string {
    const c = this.character;
    if (!c) return '';
    const values = this.valuesNow();
    // Which rows and in which section is `packColours` (creatorModel.ts), which the node test runs; with the
    // creator's table, `only` keeps what its rows did not take (a worn garment's own colours).
    const cz = c.customizer;
    const { rows, shared } = packColours({ live: cz?.variables() ?? [], manifest: c.manifest.variables ?? [], worn: c.wornMeshes(), isLinked: (k) => !!cz?.isLinked(k), morphs: Object.keys(c.morphValues()), only });
    // Each key's own resting value, for what a garment's pick is to its thing.
    const restOf = new Map((cz?.variables() ?? []).map((x) => [x.key, x.default]));
    if (!rows.length) return '';
    // A worn piece's colours in one section a piece, named by the game, a row a variable (`itemSections`).
    const hairs = new Set(c.hairsWorn());
    const parts = c.status().map((p) => ({ ...p, hair: hairs.has(p.name) }));
    const { sections: pieces, loose } = itemSections(
      rows.filter((v) => v.private),
      parts,
      (key) => catalogueName(this.items, key),
    );
    const sectionOf = new Map<string, ItemSection>(pieces.map((s) => [s.item, s]));
    // A palette colour is named for what it colours (`variableLabel.ts`): the head's `index_color_2`
    // reads its eyes' palette and is "Eye Color", where it used to be "Color 2". A choice among
    // textures keeps the name it always had.
    const row = (v: PackColour | ItemColour, named: string): string => {
      const short = v.name.replace(/^.*\//, '');
      const current = values[v.key] ?? values[v.name] ?? values[short] ?? v.default;
      const dead = v.live ? '' : ' dead';
      const label = v.kind === 'palette' ? named : prettyMorph(short);
      const piece = 'item' in v ? sectionOf.get(v.item) : undefined;
      const keys = 'item' in v ? v.keys : [v.key];
      const id = piece ? `item:${piece.item}:${bareName(v.name)}` : `var:${v.key}`;
      const at = (vals: Record<string, number>) => vals[v.key] ?? vals[v.name] ?? vals[short] ?? v.default;
      // A piece's colour writes every one of its meshes' keys; the owner's own writes its one, as it always did, and so
      // does a colour no live recipe reads, which shows the command that bakes it instead. A garment's colour is
      // also the thing's own (`onItemColour`): the default of every mesh it writes given back is no colour of the
      // thing's at all, each mesh's own default -- the meshes of one piece may rest at different ones.
      const thing = piece && !piece.body && !piece.hair ? { part: piece.item, bare: bareName(v.name), defaults: keys.map((k) => restOf.get(k) ?? v.default) } : undefined;
      const write = piece && v.live ? (x: number) => this.pickKeys(keys, x, label, v.colors, thing) : (x: number) => this.pick(v.key, x);
      if (v.kind === 'palette' && v.colors?.length) {
        const kind = pickKind({ palette: v.palette, garment: !!piece && !piece.body && !piece.hair, hair: !!piece?.hair });
        const layout = swatchLayout(v.palette, v.colors.length, this.table);
        this.register({ id, write, current: at, colour: { label, kind, colors: v.colors, layout, defaultValue: v.default, current: () => at(this.valuesNow()), pick: write } });
        return this.colourHtml(id, label, v.colors, current, kind, dead);
      }
      if ((v.count ?? 0) > 1) {
        if (piece) {
          this.register({ id, write, current: at });
          return `<label class="wardrobe-slot colour${dead}" data-pick="${esc(id)}"><span class="slot-label">${label}</span><input type="range" class="choice" min="0" max="${(v.count ?? 1) - 1}" step="1" value="${current}" data-pick="${esc(id)}" /><span class="slot-count">${current + 1}/${v.count}</span></label>`;
        }
        const height = /height/i.test(short);
        return `<label class="wardrobe-slot colour${dead}"><span class="slot-label">${label}</span><input type="range" class="choice" min="0" max="${(v.count ?? 1) - 1}" step="1" value="${current}" data-var="${v.key}"${height ? ' data-height="1"' : ''} /><span class="slot-count">${current + 1}/${v.count}</span></label>`;
      }
      return '';
    };
    // One section's rows, each palette colour named and a second of the same name numbered.
    const drawn = (list: (PackColour | ItemColour)[]): string[] => {
      const colours = list.filter((v) => v.kind === 'palette' && v.colors?.length);
      const names = distinctLabels(colours);
      return list.map((v) => row(v, names[colours.indexOf(v)] ?? '')).filter(Boolean);
    };
    const sections: string[] = [];
    // The owner's own: skin, hair, eyes and the like. A blend variable that a shape slider already
    // drives (blend_fat and the fat morph are one thing in the game) is left to that slider.
    const sharedRows = drawn(shared);
    if (sharedRows.length) sections.push(`<h3 class="wardrobe-section">Skin, hair and eyes <span>${rows.some((v) => v.live) ? "rendered live from the game's own palettes and blueprints" : "this pack has no live recipes: run the converter's species command again"}</span></h3>${sharedRows.join('')}`);
    // Each worn piece's own colours, in a section of its own under the game's name for it.
    for (const s of pieces) {
      const html = drawn(s.rows);
      if (html.length) sections.push(`<h3 class="wardrobe-section">${esc(s.label ?? prettyMesh(s.mesh))} <span>its own colours</span></h3>${html.join('')}`);
    }
    // A colour of a mesh no worn piece draws, under its mesh, as every piece's used to be.
    const byMesh = new Map<string, PackColour[]>();
    for (const v of loose) if (v.private) (byMesh.get(v.mesh) ?? byMesh.set(v.mesh, []).get(v.mesh)!).push(v);
    for (const [mesh, list] of byMesh) {
      const html = drawn(list);
      if (html.length) sections.push(`<h3 class="wardrobe-section">${prettyMesh(mesh)} <span>its own colours</span></h3>${html.join('')}`);
    }
    if (!sections.length) return '';
    return `${sections.join('')}<div class="bake-hint"></div>`;
  }

  /** The values in force: the pack's, with whatever has been set over them. */
  private valuesNow(): Record<string, number> {
    const c = this.character;
    return c ? { ...(c.manifest.values ?? {}), ...c.variableValues() } : {};
  }

  /** A row the strips, scrubs and picker name. */
  private register(row: PageRow): void {
    this.picks.set(row.id, row);
  }

  /** A colour row: its strip, which opens the picker, a scrub through its own palette (not for a dye), and its count. */
  private colourHtml(id: string, label: string, colors: number[][], current: number, kind: PickKind, dead: string): string {
    const raw = isRawColour(current);
    const scrub = kind !== 'dye' && colors.length > 1 ? `<input type="range" class="scrub" min="0" max="${colors.length - 1}" step="1" value="${raw ? 0 : current}" data-pick="${esc(id)}" />` : '';
    const count = kind === 'dye' && !raw ? 'undyed' : countText(current, colors);
    return `<div class="wardrobe-slot colour${dead}" data-pick="${esc(id)}"><span class="slot-label">${label}</span><div class="palette"><canvas class="dye-strip" data-pick="${esc(id)}" title="${esc(label)}: every colour it can take"></canvas>${scrub}</div><span class="slot-count">${count}</span></div>`;
  }

  /**
   * A worn piece's colour or choice picked: every one of its meshes' keys, as the game kept a private colour on
   * the object, and for a garment the thing's own colour as well (`onItemColour`), which is where it is kept.
   */
  private pickKeys(keys: readonly string[], value: number, label: string, colors?: number[][], thing?: { part: string; bare: string; defaults: number[] }): void {
    const c = this.character;
    if (!c) return;
    let n = 0;
    for (const k of keys) n += c.setVariable(k, value);
    const hint = this.body.querySelector<HTMLElement>('.bake-hint');
    if (hint) hint.textContent = `${label} ${colors ? countText(value, colors) : value + 1}: ${n} texture${n === 1 ? '' : 's'} rendering`;
    if (thing) this.onItemColour?.(thing.part, thing.bare, pickedTint(value, thing.defaults));
    this.onChange();
    this.syncRows();
  }

  /**
   * A worn garment's colour picked: the part it is worn under, the variable's bare name and the value, or
   * null for its own colour back. The game makes it the worn copy's own (`Equipment.setTint`); unset, or
   * with no character played (the creator, whose colours go onto the new character's things when it is
   * made), the colour lives on the meshes alone.
   */
  onItemColour: ((part: string, bare: string, value: number | null) => void) | null = null;

  /** Open the picker under a row, or close it when it is the one open. */
  private togglePicker(id: string, tab?: PickerTab): void {
    if (this.pickerId === id && !tab) {
      this.closePicker();
      return;
    }
    this.closePicker();
    const r = this.picks.get(id);
    const el = [...this.body.querySelectorAll<HTMLElement>('.wardrobe-slot[data-pick]')].find((x) => x.dataset.pick === id);
    if (!r?.colour || !el) return;
    const p = new DyePicker(r.colour, this.pickerSource());
    p.onClose = () => this.closePicker();
    p.mount(el);
    if (tab && tab !== p.tab) p.show(tab);
    el.classList.add('picking');
    this.picker = p;
    this.pickerId = id;
  }

  private closePicker(): void {
    this.picker?.close();
    this.picker = null;
    this.pickerId = null;
    for (const el of this.body.querySelectorAll('.wardrobe-slot.picking')) el.classList.remove('picking');
  }

  /** Every palette the picker offers beyond a row's own: the wardrobe's garment palettes, the creator's, every species' eyes, and the All grid. */
  private pickerSource(): PickerSource {
    const pals = this.wardrobePalettes;
    const garments = garmentPalettes(pals);
    return { garments, creator: creatorPalettes(this.table, pals), eyes: eyePalettes(this.table), all: pals ? allGarmentColours(garments, pals) : [] };
  }

  /** Every colour row's strip drawn from the value it holds now. */
  private drawStrips(): void {
    for (const cv of this.body.querySelectorAll<HTMLCanvasElement>('canvas.dye-strip[data-pick]')) {
      const r = this.picks.get(cv.dataset.pick!);
      if (r?.colour) drawStrip(cv, r.colour);
    }
  }

  /** What the console's `__debug.dye()` reads of the page: the picker open, on which row and tab. */
  pickerState(): { open: string | null; tab: PickerTab | null; rows: number } {
    return { open: this.pickerId, tab: this.picker?.tab ?? null, rows: [...this.picks.values()].filter((r) => r.colour).length };
  }

  /** A colour or choice picked: rendered live when the pack has the recipe, else the bake command is shown. */
  private pick(name: string, value: number): void {
    const c = this.character;
    const hint = this.body.querySelector<HTMLElement>('.bake-hint');
    const short = name.replace(/^.*\//, '');
    const heightInput = this.body.querySelector<HTMLInputElement>(`input[data-height][data-var="${CSS.escape(name)}"]`);
    if (heightInput) {
      // Height scales the whole character; the game maps the variable's range onto a size band.
      c?.setHeight(value / Math.max(1, Number(heightInput.max)));
    }
    const shown = isRawColour(value) ? countText(value, []) : String(value);
    if (c?.canCustomize(name) || heightInput) {
      const n = c?.setVariable(name, value) ?? 0;
      if (hint) hint.textContent = heightInput ? `${prettyMorph(short)} ${value}` : `${prettyMorph(short)} ${shown}: ${n} texture${n === 1 ? '' : 's'} rendering`;
      this.onChange();
    } else if (hint) {
      const id = c?.manifest.id ?? 'human_male';
      hint.innerHTML = isRawColour(value)
        ? `Not live in this pack, and only a live recipe takes a colour from outside its palette: a pack converted now carries the live recipes.`
        : `Not live in this pack. <code>npm run swg -- species @SWG assets-private --retail-only --only=${id} --var=${short}=${value}</code> bakes ${id} with this ${prettyMorph(short).toLowerCase()}; a pack converted now carries the live recipes.`;
    }
    // A choice's slider and count agree; the colour rows are put in step with the values below.
    for (const row of this.body.querySelectorAll<HTMLElement>('.wardrobe-slot.colour')) {
      const input = row.querySelector<HTMLInputElement>('input[data-var]');
      if (!input || input.dataset.var !== name) continue;
      input.value = String(value);
      const count = row.querySelector<HTMLElement>('.slot-count');
      if (count) count.textContent = `${value + 1}/${Number(input.max) + 1}`;
    }
    this.syncRows();
  }

  /**
   * What each slot holds, read back off the character every time rather than remembered.
   *
   * A separate record of "what I put on" drifts the moment anything else changes it -- a removal
   * the character refuses, an item worn from the console -- and the panel then lies about the
   * body it is meant to describe. The character is the only thing that knows.
   */
  private build(): void {
    const c = this.character;
    // A picker open across a rebuild opens again under the same row, on the same tab, if the row is still there.
    const reopen = this.pickerId;
    const reopenTab = this.picker?.tab;
    this.closePicker();
    this.picks.clear();
    const view = this.tableView();
    this.view = view;
    this.rowsByName.clear();
    this.root.querySelector<HTMLElement>('.count')!.textContent = c ? `${Object.keys(c.morphValues()).length} sliders · ${(c.manifest.variables ?? []).length} variables` : '';
    if (!view) {
      // No table (or no live recipes): every slider the pack has, then every colour, as it always was.
      const shape = this.shapeRows();
      const colours = this.colourRows();
      const hair = this.hairSection(this.hairGridHtml());
      this.body.innerHTML = shape || colours || hair ? `${hair}${shape}${colours}` : '<div class="wardrobe-empty">This character carries no shape sliders and lists no customization variables. A parts pack from the converter\'s <code>species</code> command has both.</div>';
    } else this.body.innerHTML = this.tableRows(view);
    if (c) this.preview.refresh(c);
    this.wireShape();
    this.hairGroups.wire(this.body);
    this.drawStrips();
    if (reopen && this.picks.get(reopen)?.colour) this.togglePicker(reopen, reopenTab);
    const height = this.body.querySelector<HTMLInputElement>('input.height');
    height?.addEventListener('input', () => {
      const ch = this.character;
      if (!ch) return;
      ch.setHeight(Number(height.value));
      height.nextElementSibling!.textContent = Number(height.value).toFixed(2);
      this.onChange();
    });
  }

  private wireShape(): void {
    for (const input of this.body.querySelectorAll<HTMLInputElement>('input[data-hi]')) {
      let timer = 0;
      input.addEventListener('input', () => {
        const c = this.character;
        if (!c) return;
        const v = Number(input.value);
        // A slider the game ran the other way (a female's torso) is turned round before it reaches the morphs.
        const reverse = input.dataset.reverse === '1';
        const m = reverse ? (input.dataset.lo ? -v : 1 - v) : v;
        if (input.dataset.lo) {
          c.setMorph(input.dataset.lo, Math.max(0, -m));
          c.setMorph(input.dataset.hi!, Math.max(0, m));
        } else c.setMorph(input.dataset.hi!, m);
        input.nextElementSibling!.textContent = v.toFixed(2);
        // The same variable may pick the skin's texture (the game's fat and muscle blueprints do): follow it, once the slider settles.
        // Each end of a pair is its own morph, so each end follows its own (a weight slider's skinny and fat).
        const ends: [string, number][] = input.dataset.lo ? [[input.dataset.lo, Math.max(0, -m)], [input.dataset.hi!, Math.max(0, m)]] : [[input.dataset.hi!, m]];
        const linked = ends.map(([name, amount]) => [c.customizer?.variables().find((cv) => !cv.private && cv.name.replace(/^.*\//, '') === name && (cv.count ?? 0) > 1), amount] as const).filter(([cv]) => !!cv);
        if (linked.length) {
          window.clearTimeout(timer);
          timer = window.setTimeout(() => {
            for (const [cv, amount] of linked) c.setVariable(cv!.key, Math.round(Math.max(0, amount) * ((cv!.count ?? 1) - 1)));
          }, 150);
        }
        this.onChange();
      });
    }
    for (const input of this.body.querySelectorAll<HTMLInputElement>('input[data-var]')) {
      // A slider fires as it moves; the render waits for the value to settle for a moment.
      let timer = 0;
      input.addEventListener('input', () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => this.pick(input.dataset.var!, Number(input.value)), 120);
      });
    }
    // The table's choices, which name the row rather than a variable: a row may write several.
    for (const input of this.body.querySelectorAll<HTMLInputElement>('input[data-row]')) {
      let timer = 0;
      input.addEventListener('input', () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => this.pickRow(input.dataset.row!, Number(input.value)), 120);
      });
    }
    // A colour row's scrub through its own palette, and a worn piece's choice: whatever the row writes.
    for (const input of this.body.querySelectorAll<HTMLInputElement>('input[data-pick]')) {
      let timer = 0;
      input.addEventListener('input', () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => this.picks.get(input.dataset.pick!)?.write(Number(input.value)), 120);
      });
    }
  }

  // ---- the creator's own table ------------------------------------------------------------------

  /** The view of the creator's table for the character shown, or null to lay the page out as before. */
  private tableView(): CreatorView | null {
    const c = this.character;
    // Without live recipes no colour can change here, and the old page says so and shows the bake.
    if (!c?.customizer || !this.table) return null;
    return creatorView(this.entryOf(c, this.table, this.hair.length > 0), this.stateOf(c));
  }

  /** The table's row for a character's species, with the hair tab of ours where the game gave it none (the Sullustan's). */
  private entryOf(c: Character, table: CreatorTable, hasHairObjects: boolean): CreatorSpecies | null | undefined {
    return withOursHair(table, table.species[c.manifest.id], c.speciesName, hasHairObjects);
  }

  /** What the view is worked out from: the character's sliders, live variables, body, worn hair. */
  private stateOf(c: Character): CreatorState {
    const status = c.status();
    // A mesh with several materials loads as several meshes, the second onwards suffixed; the recipes name the first.
    const names = (list: string[]) => list.flatMap((n) => [n, n.replace(/_\d+$/, '')]);
    const hairKey = c.hairWorn();
    return {
      morphs: c.morphValues(),
      bodyMorphs: c.manifest.parts.filter((p) => p.body).flatMap((p) => p.morphs ?? []),
      variables: c.customizer?.variables() ?? [],
      bodyMeshes: names(status.filter((p) => p.body).flatMap((p) => p.meshNames)),
      hairMeshes: hairKey ? names(status.find((p) => p.name === hairKey)?.meshNames ?? []) : [],
      hasHairObjects: this.hair.length > 0,
    };
  }

  /** The table's groups, each under the game's word, the grid of styles at the top of the hair tab, then each worn garment's own colours. */
  private tableRows(view: CreatorView): string {
    const c = this.character!;
    const values = { ...(c.manifest.values ?? {}), ...c.variableValues() };
    const morphs = c.morphValues();
    const out: string[] = [];
    let picker = this.hairGridHtml();
    for (const g of view.groups) {
      const rows: string[] = [];
      for (const r of g.rows) {
        this.rowsByName.set(r.name, r);
        const html = this.tableRow(r, values, morphs);
        if (html) rows.push(html);
      }
      const lead = g.hair ? picker : '';
      if (lead) picker = '';
      if (!rows.length && !lead) continue;
      out.push(`<h3 class="wardrobe-section">${esc(g.label)}${g.ours ? ' <span>ours: what the pack has and the game never showed</span>' : ''}</h3>${lead}${rows.join('')}`);
    }
    // A species with hairstyles whose table has no hair tab still gets its grid, where the picker always was.
    if (picker) out.unshift(this.hairSection(picker));
    // Each worn garment's own colours (and a hairstyle's that no row names), as they always were.
    const garments = this.colourRows((v) => ownSection(view, v));
    out.push(garments || '<div class="bake-hint"></div>');
    return out.join('');
  }

  /** One row of the table. */
  private tableRow(r: ViewRow, values: Record<string, number>, morphs: Record<string, number>): string {
    const label = esc(r.label);
    const name = esc(r.name);
    if (r.type === 'scale') {
      const h = this.character!.height;
      return `<label class="wardrobe-slot shape"><span class="slot-label">${label}</span><input type="range" class="height" min="0" max="1" step="0.01" value="${h.toFixed(2)}" /><span class="slot-count">${h.toFixed(2)}</span></label>`;
    }
    if (r.type === 'slider') {
      const step = r.discrete ? 1 : 0.02;
      const reverse = r.reverse ? ' data-reverse="1"' : '';
      if (r.lo) {
        const v = (r.reverse ? -1 : 1) * ((morphs[r.hi!] ?? 0) - (morphs[r.lo] ?? 0));
        return `<label class="wardrobe-slot shape" data-row="${name}"><span class="slot-label">${label}</span><input type="range" min="-1" max="1" step="${step}" value="${v.toFixed(2)}" data-lo="${esc(r.lo)}" data-hi="${esc(r.hi!)}"${reverse} /><span class="slot-count">${v.toFixed(2)}</span></label>`;
      }
      const raw = morphs[r.hi!] ?? 0;
      const v = r.reverse ? 1 - raw : raw;
      return `<label class="wardrobe-slot shape" data-row="${name}"><span class="slot-label">${label}</span><input type="range" min="0" max="1" step="${step}" value="${v.toFixed(2)}" data-hi="${esc(r.hi!)}"${reverse} /><span class="slot-count">${v.toFixed(2)}</span></label>`;
    }
    const s = r.shows;
    if (!s) return '';
    const current = this.currentOf(r, values);
    if (s.kind === 'palette' && s.colors?.length) {
      // The strip opens the picker, whose Own tab holds the colours the game's creator offered in its own
      // columns, then every other colour the palette has; a hair or an eye colour offers more (`pickKind`).
      const id = `row:${r.name}`;
      const kind = pickKind({ palette: s.palette, row: r.name });
      const layout = swatchLayout(s.palette, s.colors.length, this.table);
      const write = (v: number) => this.pickRow(r.name, v);
      this.register({ id, write, current: (vals) => this.currentOf(r, vals), colour: { label: r.label, kind, colors: s.colors, layout, defaultValue: s.default, current: () => this.currentOf(r, this.valuesNow()), pick: write } });
      return this.colourHtml(id, label, s.colors, current, kind, '');
    }
    if ((s.count ?? 0) > 1) {
      return `<label class="wardrobe-slot colour" data-row="${name}"><span class="slot-label">${label}</span><input type="range" class="choice" min="0" max="${s.count! - 1}" step="1" value="${current}" data-row="${name}" /><span class="slot-count">${current + 1}/${s.count}</span></label>`;
    }
    return '';
  }

  /** A row's value now: its first key's. */
  private currentOf(r: ViewRow, values: Record<string, number>): number {
    const s = r.shows;
    const key = r.keys[0];
    const short = (s?.name ?? key ?? '').replace(/^.*\//, '');
    return values[key] ?? (s ? values[s.name] : undefined) ?? values[short] ?? s?.default ?? 0;
  }

  /**
   * A colour or choice of the table picked: the row's keys, then the rows that follow it with the same
   * value, then (with `linkSelf`) the colours it also sets with the same index.
   */
  private pickRow(name: string, value: number): void {
    const c = this.character;
    const r = this.rowsByName.get(name);
    if (!c || !r) return;
    // Which keys and in what order is `pickWrites` (creatorModel.ts), which the node test runs.
    let n = 0;
    for (const k of pickWrites(r)) n += c.setVariable(k, value);
    this.lastPick = { row: name, value, keys: [...r.keys], followers: [...r.followers], sets: CREATOR_TUNE.linkSelf ? [...r.sets] : [] };
    const hint = this.body.querySelector<HTMLElement>('.bake-hint');
    if (hint) hint.textContent = `${r.label} ${r.shows?.kind === 'palette' ? countText(value, r.shows.colors ?? []) : value + 1}: ${n} texture${n === 1 ? '' : 's'} rendering`;
    this.onChange();
    this.syncRows();
  }

  /** Every row's strip, slider and count put back in step with the values (a pick sets others too), and the picker's outline with them. */
  private syncRows(): void {
    const c = this.character;
    if (!c) return;
    const values = this.valuesNow();
    for (const el of this.body.querySelectorAll<HTMLElement>('.wardrobe-slot.colour[data-row]')) {
      const r = this.rowsByName.get(el.dataset.row!);
      if (!r) continue;
      const current = this.currentOf(r, values);
      const input = el.querySelector<HTMLInputElement>('input[data-row]');
      if (input) input.value = String(current);
      const count = el.querySelector<HTMLElement>('.slot-count');
      if (count && input) count.textContent = `${current + 1}/${Number(input.max) + 1}`;
    }
    for (const el of this.body.querySelectorAll<HTMLElement>('.wardrobe-slot[data-pick]')) {
      const r = this.picks.get(el.dataset.pick!);
      if (!r) continue;
      const current = r.current(values);
      const raw = isRawColour(current);
      const input = el.querySelector<HTMLInputElement>('input[data-pick]');
      if (input && !raw) input.value = String(current);
      const count = el.querySelector<HTMLElement>('.slot-count');
      if (count) count.textContent = r.colour ? (r.colour.kind === 'dye' && !raw ? 'undyed' : countText(current, r.colour.colors)) : `${current + 1}/${Number(input?.max ?? 0) + 1}`;
      const strip = el.querySelector<HTMLCanvasElement>('canvas.dye-strip');
      if (strip && r.colour) drawStrip(strip, r.colour);
    }
    this.picker?.refresh();
  }

  /**
   * What the console's `__debug.creator()` shows: whether the table is in, how the page is laid out for
   * this character, each group with its row count, the rows that found nothing, what is hidden and why,
   * the followers and the links, and the last pick with every key it wrote.
   */
  report(c: Character | null, table: CreatorTable | null | undefined): Record<string, unknown> {
    const view = c && c === this.character && this.table === table ? this.view : c?.customizer && table ? creatorView(this.entryOf(c, table, !!table.species[c.manifest.id]?.hair?.length), this.stateOf(c)) : null;
    return {
      loaded: table === undefined ? 'not yet' : !!table,
      format: table?.format ?? null,
      species: c?.manifest.id ?? null,
      inTable: !!(c && table?.species[c.manifest.id]),
      laidOut: view ? 'table' : 'packs',
      // No hair is offered to every species; what the game's own table said of this one is beside it.
      hairNone: c ? hairNone(table?.species[c.manifest.id], c === this.character ? this.hair.length > 0 : !!table?.species[c.manifest.id]?.hair?.length) : null,
      groups: view?.groups.map((g) => ({ id: g.id, label: g.label, rows: g.rows.length, ...(g.ours ? { ours: true } : {}) })) ?? [],
      unresolved: view?.unresolved ?? [],
      hidden: view?.hidden ?? [],
      duplicates: view?.duplicates ?? [],
      followers: view?.following ?? [],
      links: view?.groups.flatMap((g) => g.rows.filter((r) => r.sets.length).map((r) => ({ row: r.name, sets: r.sets }))) ?? [],
      lastPick: this.lastPick,
      tune: { ...CREATOR_TUNE },
    };
  }

  show(): void {
    this.open = true;
    this.root.classList.remove('hidden');
    this.preview.start();
    // A strip drawn while the page was hidden had no width to measure.
    this.drawStrips();
  }

  hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
    this.preview.stop();
    this.closePicker();
  }

  toggle(): boolean {
    if (this.open) this.hide();
    else this.show();
    return this.open;
  }
}

/** "shirt_s03_m_l0" reads as "Shirt s03". */
function prettyMesh(mesh: string): string {
  const s = mesh.replace(/_[fm]_l\d+$/, '').replace(/_l\d+$/, '').replace(/_/g, ' ');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Body';
}

/** "blend_jaw" reads as "Jaw", "index_texture_1" as "Texture 1": a shape or a choice's name, tidied. */
function prettyMorph(name: string): string {
  return plainLabel(name);
}

/** Text put in the page as text. */
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : '&quot;'));
}

