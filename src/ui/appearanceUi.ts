// The appearance editor: species and gender, the shape sliders and the colours a character
// takes, on the inventory's own tab beside the clothing, with the doll turning beside them.
//
// With the creator's own table converted (`characters/customization.json`), the page is laid out as the
// game's creator was: its tabs in its order, its rows in theirs, under its words, a colour that follows
// another hidden behind it and written with it, a colour that sets others setting them, and each palette's
// creation colours first in the game's own columns. Which customizer key a row writes is decided in
// `creatorView` (creatorModel.ts) and nowhere here. Without the table the page is what it always was:
// every slider the pack has, then every colour, named by `variableLabel.ts`.
import type { Character, SpeciesEntry } from '../player/character.ts';
import { INVENTORY_TABS, tabStrip, wireTabs } from './tabs.ts';
import { CharacterPreview } from './characterPreview.ts';
import { distinctLabels, plainLabel } from './variableLabel.ts';
import { CREATOR_TUNE, creatorTableNow, creatorView, hairNone, loadCreatorTable, ownSection, packColours, packSliders, pickWrites, swatchLayout, type CreatorState, type CreatorTable, type CreatorView, type ViewRow } from './creatorModel.ts';

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
  }

  /** The species the pack offers, for the picker in the header; hidden when there is only the one. */
  setSpecies(list: SpeciesEntry[], current: string): void {
    this.species = list;
    this.speciesId = current;
    const sel = this.root.querySelector<HTMLSelectElement>('.species')!;
    sel.classList.toggle('hidden', list.length < 2);
    sel.innerHTML = list.map((s) => `<option value="${s.id}"${s.id === current ? ' selected' : ''}>${s.species.replace(/_/g, ' ')} ${s.gender}</option>`).join('');
  }


  private baseUrl = '';
  private hair: { id: string; label: string }[] = [];
  /** The creator's own table, once it has arrived; null when it is not converted (the page then lays itself out as before). */
  private table: CreatorTable | null = null;
  /** What the page drew last from the table, and its rows by name, which the swatches and sliders name. */
  private view: CreatorView | null = null;
  private readonly rowsByName = new Map<string, ViewRow>();
  /** The last table row picked and every key it wrote, for the console. */
  private lastPick: { row: string; value: number; keys: string[]; followers: string[]; sets: string[] } | null = null;

  /** Show a character: its sliders and colours, and the doll. */
  attach(character: Character, baseUrl = ''): void {
    this.character = character;
    this.baseUrl = baseUrl;
    this.speciesId = character.manifest.id;
    const sel = this.root.querySelector<HTMLSelectElement>('.species')!;
    if (sel.value !== this.speciesId && [...sel.options].some((o) => o.value === this.speciesId)) sel.value = this.speciesId;
    this.table = creatorTableNow(baseUrl) ?? null;
    this.build();
    // The hairstyles come from the wardrobe, which loads on its own time; the section fills in when it lands.
    void character.hairOptions(baseUrl).then((list) => {
      if (this.character !== character) return;
      this.hair = list;
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

  /** The hairstyle section: the species' own styles, either gender's, and none. */
  private hairRows(): string {
    const c = this.character;
    if (!c || !this.hair.length) return '';
    return `<h3 class="wardrobe-section">Hair <span>${this.hair.length} styles for this species</span></h3>${this.hairPicker()}`;
  }

  /**
   * The style picker alone, which the table's hair tab opens with. No hair is offered only where the
   * game let the species go bald (`hairNone`): a Twi'lek, a Zabrak or a Trandoshan always has lekku, horns
   * or ridges. One already wearing none keeps that word, disabled, so the picker never claims a style
   * that is not on; once a style is on there is no way back to none.
   */
  private hairPicker(): string {
    const c = this.character;
    if (!c || !this.hair.length) return '';
    const worn = c.hairWorn();
    const none = hairNone(this.table?.species[c.manifest.id], this.hair.length > 0, !!worn);
    const lead = none === 'offer' ? [`<option value="">— none —</option>`] : none === 'shown' ? [`<option value="" disabled selected>— none —</option>`] : [];
    const options = [...lead, ...this.hair.map((h) => `<option value="${h.id}"${h.id === worn ? ' selected' : ''}>${h.label}</option>`)];
    return `<label class="wardrobe-slot"><span class="slot-label">Style</span><select class="hair-pick">${options.join('')}</select><span class="slot-count">${this.hair.length}</span></label>`;
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
   * The colours and choices the species' skin, hair and eyes take. The textures were baked with
   * the pack's values by the converter, so a swatch is not applied live: picking one shows the
   * command that bakes the pack again with it.
   */
  private colourRows(only?: (v: { key: string; private: boolean; mesh: string }) => boolean): string {
    const c = this.character;
    if (!c) return '';
    const values = { ...(c.manifest.values ?? {}), ...c.variableValues() };
    // Which rows and in which section is `packColours` (creatorModel.ts), which the node test runs; with the
    // creator's table, `only` keeps what its rows did not take (a worn garment's own colours).
    const cz = c.customizer;
    const { rows, shared, byMesh } = packColours({ live: cz?.variables() ?? [], manifest: c.manifest.variables ?? [], worn: c.wornMeshes(), isLinked: (k) => !!cz?.isLinked(k), morphs: Object.keys(c.morphValues()), only });
    if (!rows.length) return '';
    // A palette colour is named for what it colours (`variableLabel.ts`): the head's `index_color_2`
    // reads its eyes' palette and is "Eye Color", where it used to be "Color 2". A choice among
    // textures keeps the name it always had.
    const row = (v: (typeof rows)[number], named: string): string => {
      const short = v.name.replace(/^.*\//, '');
      const current = values[v.key] ?? values[v.name] ?? values[short] ?? v.default;
      const dead = v.live ? '' : ' dead';
      const label = v.kind === 'palette' ? named : prettyMorph(short);
      if (v.kind === 'palette' && v.colors?.length) {
        const swatches = v.colors.map((rgb, i) => `<button class="swatch${i === current ? ' on' : ''}" data-var="${v.key}" data-value="${i}" style="background:rgb(${rgb[0]},${rgb[1]},${rgb[2]})" title="${short} = ${i}"></button>`).join('');
        return `<div class="wardrobe-slot colour${dead}"><span class="slot-label">${label}</span><div class="palette"><div class="swatches">${swatches}</div><input type="range" class="scrub" min="0" max="${v.colors.length - 1}" step="1" value="${current}" data-var="${v.key}" /></div><span class="slot-count">${current + 1}/${v.colors.length}</span></div>`;
      }
      if ((v.count ?? 0) > 1) {
        const height = /height/i.test(short);
        return `<label class="wardrobe-slot colour${dead}"><span class="slot-label">${label}</span><input type="range" class="choice" min="0" max="${(v.count ?? 1) - 1}" step="1" value="${current}" data-var="${v.key}"${height ? ' data-height="1"' : ''} /><span class="slot-count">${current + 1}/${v.count}</span></label>`;
      }
      return '';
    };
    // One section's rows, each palette colour named and a second of the same name numbered.
    const drawn = (list: (typeof rows)[number][]): string[] => {
      const colours = list.filter((v) => v.kind === 'palette' && v.colors?.length);
      const names = distinctLabels(colours);
      return list.map((v) => row(v, names[colours.indexOf(v)] ?? '')).filter(Boolean);
    };
    const sections: string[] = [];
    // The owner's own: skin, hair, eyes and the like. A blend variable that a shape slider already
    // drives (blend_fat and the fat morph are one thing in the game) is left to that slider.
    const sharedRows = drawn(shared);
    if (sharedRows.length) sections.push(`<h3 class="wardrobe-section">Skin, hair and eyes <span>${rows.some((v) => v.live) ? "rendered live from the game's own palettes and blueprints" : "this pack has no live recipes: run the converter's species command again"}</span></h3>${sharedRows.join('')}`);
    // Each worn piece's own colours, in a section of its own.
    for (const [mesh, list] of byMesh) {
      const html = drawn(list);
      if (html.length) sections.push(`<h3 class="wardrobe-section">${prettyMesh(mesh)} <span>its own colours</span></h3>${html.join('')}`);
    }
    if (!sections.length) return '';
    return `${sections.join('')}<div class="bake-hint"></div>`;
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
    if (c?.canCustomize(name) || heightInput) {
      const n = c?.setVariable(name, value) ?? 0;
      if (hint) hint.textContent = heightInput ? `${prettyMorph(short)} ${value}` : `${prettyMorph(short)} ${value}: ${n} texture${n === 1 ? '' : 's'} rendering`;
      this.onChange();
    } else if (hint) {
      const id = c?.manifest.id ?? 'human_male';
      hint.innerHTML = `Not live in this pack. <code>npm run swg -- species @SWG assets-private --retail-only --only=${id} --var=${short}=${value}</code> bakes ${id} with this ${prettyMorph(short).toLowerCase()}; a pack converted now carries the live recipes.`;
    }
    // The row's swatch, slider and count agree.
    for (const row of this.body.querySelectorAll<HTMLElement>('.wardrobe-slot.colour')) {
      const input = row.querySelector<HTMLInputElement>('input[data-var]');
      if (!input || input.dataset.var !== name) continue;
      input.value = String(value);
      for (const sw of row.querySelectorAll<HTMLElement>('.swatch')) sw.classList.toggle('on', Number(sw.dataset.value) === value);
      const count = row.querySelector<HTMLElement>('.slot-count');
      if (count) count.textContent = `${value + 1}/${Number(input.max) + 1}`;
    }
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
    const view = this.tableView();
    this.view = view;
    this.rowsByName.clear();
    this.root.querySelector<HTMLElement>('.count')!.textContent = c ? `${Object.keys(c.morphValues()).length} sliders · ${(c.manifest.variables ?? []).length} variables` : '';
    if (!view) {
      // No table (or no live recipes): every slider the pack has, then every colour, as it always was.
      const shape = this.shapeRows();
      const colours = this.colourRows();
      const hair = this.hairRows();
      this.body.innerHTML = shape || colours || hair ? `${hair}${shape}${colours}` : '<div class="wardrobe-empty">This character carries no shape sliders and lists no customization variables. A parts pack from the converter\'s <code>species</code> command has both.</div>';
    } else this.body.innerHTML = this.tableRows(view);
    if (c) this.preview.refresh(c);
    this.wireShape();
    const pick = this.body.querySelector<HTMLSelectElement>('.hair-pick');
    pick?.addEventListener('change', () => {
      const ch = this.character;
      if (!ch) return;
      void ch.wearHair(pick.value || null, this.baseUrl).then(() => {
        this.preview.refresh(ch);
        this.build();
        this.onChange();
      });
    });
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
    for (const b of this.body.querySelectorAll<HTMLButtonElement>('.swatch[data-var]')) {
      b.addEventListener('click', () => this.pick(b.dataset.var!, Number(b.dataset.value)));
    }
    for (const input of this.body.querySelectorAll<HTMLInputElement>('input[data-var]')) {
      // A slider fires as it moves; the render waits for the value to settle for a moment.
      let timer = 0;
      input.addEventListener('input', () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => this.pick(input.dataset.var!, Number(input.value)), 120);
      });
    }
    // The table's rows, which name the row rather than a variable: a row may write several.
    for (const b of this.body.querySelectorAll<HTMLButtonElement>('.swatch[data-row]')) {
      b.addEventListener('click', () => this.pickRow(b.dataset.row!, Number(b.dataset.value)));
    }
    for (const input of this.body.querySelectorAll<HTMLInputElement>('input[data-row]')) {
      let timer = 0;
      input.addEventListener('input', () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => this.pickRow(input.dataset.row!, Number(input.value)), 120);
      });
    }
  }

  // ---- the creator's own table ------------------------------------------------------------------

  /** The view of the creator's table for the character shown, or null to lay the page out as before. */
  private tableView(): CreatorView | null {
    const c = this.character;
    // Without live recipes no colour can change here, and the old page says so and shows the bake.
    if (!c?.customizer || !this.table) return null;
    return creatorView(this.table.species[c.manifest.id], this.stateOf(c));
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

  /** The table's groups, each under the game's word, the style picker at the top of the hair tab, then each worn garment's own colours. */
  private tableRows(view: CreatorView): string {
    const c = this.character!;
    const values = { ...(c.manifest.values ?? {}), ...c.variableValues() };
    const morphs = c.morphValues();
    const out: string[] = [];
    let picker = this.hairPicker();
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
    // A species with hairstyles whose table has no hair tab still gets its picker, where it always was.
    if (picker) out.unshift(this.hairRows());
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
      const colours = s.colors;
      const lay = swatchLayout(s.palette, colours.length, this.table);
      const block = (from: number, to: number, cols: number): string => {
        let html = '';
        for (let i = from; i < to; i++) html += `<button class="swatch${i === current ? ' on' : ''}" data-row="${name}" data-value="${i}" style="background:rgb(${colours[i][0]},${colours[i][1]},${colours[i][2]})" title="${label} ${i + 1}"></button>`;
        return `<div class="swatches ramp" style="--swatch-cols:${cols}">${html}</div>`;
      };
      // The colours the game's creator offered, in its own columns; then every other colour the palette has.
      const more = lay.more ? `<div class="swatch-more">More colours</div>${block(lay.creation, colours.length, lay.moreColumns)}` : '';
      return `<div class="wardrobe-slot colour" data-row="${name}"><span class="slot-label">${label}</span><div class="palette">${block(0, lay.creation, lay.columns)}${more}<input type="range" class="scrub" min="0" max="${colours.length - 1}" step="1" value="${current}" data-row="${name}" /></div><span class="slot-count">${current + 1}/${colours.length}</span></div>`;
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
    if (hint) hint.textContent = `${r.label} ${value + 1}: ${n} texture${n === 1 ? '' : 's'} rendering`;
    this.onChange();
    this.syncRows();
  }

  /** Every table row's swatches, slider and count put back in step with the values (a pick sets others too). */
  private syncRows(): void {
    const c = this.character;
    if (!c) return;
    const values = { ...(c.manifest.values ?? {}), ...c.variableValues() };
    for (const el of this.body.querySelectorAll<HTMLElement>('.wardrobe-slot.colour[data-row]')) {
      const r = this.rowsByName.get(el.dataset.row!);
      if (!r) continue;
      const current = this.currentOf(r, values);
      const input = el.querySelector<HTMLInputElement>('input[data-row]');
      if (input) input.value = String(current);
      for (const sw of el.querySelectorAll<HTMLElement>('.swatch')) sw.classList.toggle('on', Number(sw.dataset.value) === current);
      const count = el.querySelector<HTMLElement>('.slot-count');
      if (count && input) count.textContent = `${current + 1}/${Number(input.max) + 1}`;
    }
  }

  /**
   * What the console's `__debug.creator()` shows: whether the table is in, how the page is laid out for
   * this character, each group with its row count, the rows that found nothing, what is hidden and why,
   * the followers and the links, and the last pick with every key it wrote.
   */
  report(c: Character | null, table: CreatorTable | null | undefined): Record<string, unknown> {
    const view = c && c === this.character && this.table === table ? this.view : c?.customizer && table ? creatorView(table.species[c.manifest.id], this.stateOf(c)) : null;
    return {
      loaded: table === undefined ? 'not yet' : !!table,
      format: table?.format ?? null,
      species: c?.manifest.id ?? null,
      inTable: !!(c && table?.species[c.manifest.id]),
      laidOut: view ? 'table' : 'packs',
      // The bald rule as the style picker takes it: whether it offers no hair, says none without offering it, or leaves it out.
      hairNone: c ? hairNone(table?.species[c.manifest.id], c === this.character ? this.hair.length > 0 : !!table?.species[c.manifest.id]?.hair?.length, !!c.hairWorn()) : null,
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

