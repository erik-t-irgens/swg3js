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


  private baseUrl = '';
  private hair: { id: string; label: string }[] = [];

  /** Show a character: its sliders and colours, and the doll. */
  attach(character: Character, baseUrl = ''): void {
    this.character = character;
    this.baseUrl = baseUrl;
    this.speciesId = character.manifest.id;
    const sel = this.root.querySelector<HTMLSelectElement>('.species')!;
    if (sel.value !== this.speciesId && [...sel.options].some((o) => o.value === this.speciesId)) sel.value = this.speciesId;
    this.build();
    // The hairstyles come from the wardrobe, which loads on its own time; the section fills in when it lands.
    void character.hairOptions(baseUrl).then((list) => {
      if (this.character !== character) return;
      this.hair = list;
      this.build();
    });
  }

  /** The hairstyle section: the species' own styles, either gender's, and none. */
  private hairRows(): string {
    const c = this.character;
    if (!c || !this.hair.length) return '';
    const worn = c.hairWorn();
    const options = [`<option value="">— none —</option>`, ...this.hair.map((h) => `<option value="${h.id}"${h.id === worn ? ' selected' : ''}>${h.label}</option>`)];
    return `<h3 class="wardrobe-section">Hair <span>${this.hair.length} styles for this species</span></h3><label class="wardrobe-slot"><span class="slot-label">Style</span><select class="hair-pick">${options.join('')}</select><span class="slot-count">${this.hair.length}</span></label>`;
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
    const seen = new Set<string>();
    const rows: string[] = [];
    // Height first: a scale over the model within the species' own range.
    rows.push(`<label class="wardrobe-slot shape"><span class="slot-label">Height</span><input type="range" class="height" min="0" max="1" step="0.01" value="${c.height.toFixed(2)}" /><span class="slot-count">${c.height.toFixed(2)}</span></label>`);
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
    if (!c) return '';
    const values = { ...(c.manifest.values ?? {}), ...c.variableValues() };
    const morphs = new Set(Object.keys(c.morphValues()).map((m) => m.replace(/_[01]$/, '')));
    // Live variables come from the pack's recipes, each private one scoped to its own mesh (a
    // shirt's colour 1 is not the pants' colour 1); a pack without recipes lists the manifest's.
    const worn = c.wornMeshes();
    const live = (c.customizer?.variables() ?? []).filter((v) => (!v.private || worn.has(v.mesh)) && !c.customizer!.isLinked(v.key));
    const manifestVars = c.manifest.variables ?? [];
    const rows: { key: string; name: string; private: boolean; mesh: string; kind: 'palette' | 'index'; colors?: number[][]; count?: number; default: number; live: boolean }[] = [];
    const short = (n: string) => n.replace(/^.*\//, '');
    for (const v of live) {
      const m = manifestVars.find((mv) => short(mv.name) === short(v.name) && mv.private === v.private);
      rows.push({ key: v.key, name: v.name, private: v.private, mesh: v.mesh, kind: v.kind, colors: v.colors ?? m?.colors, count: v.count ?? m?.count, default: v.default, live: true });
    }
    // What the manifest lists that no recipe reads live (a pack converted before live customization
    // lists everything so) still shows, dimmed, with the bake command behind it.
    for (const v of manifestVars) {
      for (const mesh of v.private && v.meshes?.length ? v.meshes : ['']) {
        if (v.private && live.length && !worn.has(mesh)) continue;
        if (rows.some((r) => r.private === v.private && short(r.name) === short(v.name) && (!v.private || r.mesh === mesh))) continue;
        if (v.private && live.length && c.customizer?.isLinked(`${mesh}|${v.name}`)) continue;
        rows.push({ key: v.private ? `${mesh}|${v.name}` : v.name, name: v.name, private: v.private, mesh, kind: v.kind, colors: v.colors, count: v.count, default: v.default, live: false });
      }
    }
    if (!rows.length) return '';
    const row = (v: (typeof rows)[number]): string => {
      const short = v.name.replace(/^.*\//, '');
      const current = values[v.key] ?? values[v.name] ?? values[short] ?? v.default;
      const dead = v.live ? '' : ' dead';
      const label = prettyMorph(short);
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
    const sections: string[] = [];
    // The owner's own: skin, hair, eyes and the like. A blend variable that a shape slider already
    // drives (blend_fat and the fat morph are one thing in the game) is left to that slider.
    const shared = rows.filter((v) => !v.private && !morphs.has(v.name.replace(/^.*\//, '')));
    const sharedRows = shared.map(row).filter(Boolean);
    if (sharedRows.length) sections.push(`<h3 class="wardrobe-section">Skin, hair and eyes <span>${rows.some((v) => v.live) ? "rendered live from the game's own palettes and blueprints" : "this pack has no live recipes: run the converter's species command again"}</span></h3>${sharedRows.join('')}`);
    // Each worn piece's own colours, in a section of its own.
    const byMesh = new Map<string, string[]>();
    for (const v of rows.filter((v) => v.private)) {
      const html = row(v);
      if (html) (byMesh.get(v.mesh) ?? byMesh.set(v.mesh, []).get(v.mesh)!).push(html);
    }
    for (const [mesh, list] of byMesh) sections.push(`<h3 class="wardrobe-section">${prettyMesh(mesh)} <span>its own colours</span></h3>${list.join('')}`);
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
    const shape = this.shapeRows();
    const colours = this.colourRows();
    const c = this.character;
    this.root.querySelector<HTMLElement>('.count')!.textContent = c ? `${Object.keys(c.morphValues()).length} sliders · ${(c.manifest.variables ?? []).length} variables` : '';
    const hair = this.hairRows();
    this.body.innerHTML = shape || colours || hair ? `${hair}${shape}${colours}` : '<div class="wardrobe-empty">This character carries no shape sliders and lists no customization variables. A parts pack from the converter\'s <code>species</code> command has both.</div>';
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
        if (input.dataset.lo) {
          c.setMorph(input.dataset.lo, Math.max(0, -v));
          c.setMorph(input.dataset.hi!, Math.max(0, v));
        } else c.setMorph(input.dataset.hi!, v);
        input.nextElementSibling!.textContent = v.toFixed(2);
        // The same variable may pick the skin's texture (the game's fat and muscle blueprints do): follow it, once the slider settles.
        const linked = c.customizer?.variables().find((cv) => !cv.private && cv.name.replace(/^.*\//, '') === input.dataset.hi && (cv.count ?? 0) > 1);
        if (linked) {
          window.clearTimeout(timer);
          timer = window.setTimeout(() => c.setVariable(linked.key, Math.round(Math.max(0, v) * ((linked.count ?? 1) - 1))), 150);
        }
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

/** "shirt_s03_m_l0" reads as "Shirt s03". */
function prettyMesh(mesh: string): string {
  const s = mesh.replace(/_[fm]_l\d+$/, '').replace(/_l\d+$/, '').replace(/_/g, ' ');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : 'Body';
}

/** "blend_jaw" reads as "Jaw", "index_color_skin" as "Color skin". */
function prettyMorph(name: string): string {
  const s = name.replace(/^(blend|index|private)_/, '').replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

