// The appearance editor: species and gender, the shape sliders and the colours a character
// takes, on the inventory's own tab beside the clothing, with the doll turning beside them.
import type { Character, SpeciesEntry } from '../player/character';
import { INVENTORY_TABS, tabStrip, wireTabs } from './tabs';
import { CharacterPreview } from './characterPreview';

export class AppearanceUi {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly preview: CharacterPreview;
  private character: Character | null = null;
  open = false;
  /** A click on another tab: the game swaps the panels. */
  onTab: (id: string) => void = () => {};
  /** Another species or gender picked: the game reloads the player as it. */
  onSpecies: (id: string) => void = () => {};
  private species: SpeciesEntry[] = [];
  private speciesId = '';

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
          <div class="wardrobe-preview"><div class="preview-hint">drag to turn · wheel to zoom</div></div>
          <div class="wardrobe-body"></div>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.body = this.root.querySelector<HTMLElement>('.wardrobe-body')!;
    this.preview = new CharacterPreview();
    this.root.querySelector<HTMLElement>('.wardrobe-preview')!.prepend(this.preview.canvas);
    this.root.querySelector('.close')!.addEventListener('click', () => this.hide());
    wireTabs(this.root, 'appearance', (id) => this.onTab(id));
    this.root.querySelector<HTMLSelectElement>('.species')!.addEventListener('change', (e) => {
      const id = (e.target as HTMLSelectElement).value;
      if (id && id !== this.speciesId) this.onSpecies(id);
    });
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


  /** Show a character: its sliders and colours, and the doll. */
  attach(character: Character): void {
    this.character = character;
    this.speciesId = character.manifest.id;
    const sel = this.root.querySelector<HTMLSelectElement>('.species')!;
    if (sel.value !== this.speciesId && [...sel.options].some((o) => o.value === this.speciesId)) sel.value = this.speciesId;
    this.build();
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
    const values = { ...(c?.manifest.values ?? {}), ...(c?.variableValues() ?? {}) };
    const rows: string[] = [];
    for (const v of vars) {
      const short = v.name.replace(/^.*\//, '');
      const current = values[v.name] ?? values[short] ?? v.default;
      const live = c?.canCustomize(v.name) ?? false;
      const dead = live ? '' : ' dead';
      if (v.kind === 'palette' && v.colors?.length) {
        // Swatches to click, and a slider under them to scrub through the palette.
        const swatches = v.colors.map((rgb, i) => `<button class="swatch${i === current ? ' on' : ''}" data-var="${v.name}" data-value="${i}" style="background:rgb(${rgb[0]},${rgb[1]},${rgb[2]})" title="${short} = ${i}"></button>`).join('');
        rows.push(`<div class="wardrobe-slot colour${dead}"><span class="slot-label">${prettyMorph(short)}</span><div class="palette"><div class="swatches">${swatches}</div><input type="range" class="scrub" min="0" max="${v.colors.length - 1}" step="1" value="${current}" data-var="${v.name}" /></div><span class="slot-count">${current + 1}/${v.colors.length}</span></div>`);
      } else if (v.kind === 'index' && (v.count ?? 0) > 0) {
        rows.push(`<label class="wardrobe-slot colour${dead}"><span class="slot-label">${prettyMorph(short)}</span><input type="range" class="choice" min="0" max="${(v.count ?? 1) - 1}" step="1" value="${current}" data-var="${v.name}" /><span class="slot-count">${current + 1}/${v.count}</span></label>`);
      }
    }
    if (!rows.length) return '';
    const anyLive = vars.some((v) => c?.canCustomize(v.name));
    const note = anyLive ? 'rendered live from the game\'s own palettes and blueprints' : 'this pack has no live recipes: run the converter\'s species command again, then these change live';
    return `<h3 class="wardrobe-section">Colours and features <span>${note}</span></h3>${rows.join('')}<div class="bake-hint"></div>`;
  }

  /** A colour or choice picked: rendered live when the pack has the recipe, else the bake command is shown. */
  private pick(name: string, value: number): void {
    const c = this.character;
    const hint = this.body.querySelector<HTMLElement>('.bake-hint');
    const short = name.replace(/^.*\//, '');
    if (c?.canCustomize(name)) {
      const n = c.setVariable(name, value);
      if (hint) hint.textContent = `${prettyMorph(short)} ${value}: ${n} texture${n === 1 ? '' : 's'} rendering`;
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
    const shape = this.shapeRows();
    const colours = this.colourRows();
    const c = this.character;
    this.root.querySelector<HTMLElement>('.count')!.textContent = c ? `${Object.keys(c.morphValues()).length} sliders · ${(c.manifest.variables ?? []).length} variables` : '';
    this.body.innerHTML = shape || colours ? `${shape}${colours}` : '<div class="wardrobe-empty">This character carries no shape sliders and lists no customization variables. A parts pack from the converter\'s <code>species</code> command has both.</div>';
    if (c) this.preview.refresh(c);
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

/** "blend_jaw" reads as "Jaw", "index_color_skin" as "Color skin". */
function prettyMorph(name: string): string {
  const s = name.replace(/^(blend|index|private)_/, '').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

