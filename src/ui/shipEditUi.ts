// A ship's edit page, opened from the garage's edit button: the ship turning on the left, and on
// the right its paint (the game's own patterns and palettes, where its shaders take them), every
// chassis slot with the components the game allowed in it grouped by the look each shows on this
// hull, and the droid or flight computer. Every change is kept with the character (the game
// debounces the writes) and shown on the preview; the ships already spawned are refitted, and the
// other players told, only when the page closes. The rules (grouping, what is kept as stock, the
// words) are in shipEditModel.ts, where the node tests hold them.
import type * as THREE from 'three';
import { SPAWNER_TABS, tabStrip } from './tabs';
import { escapeHtml } from './catalogue';
import { ShipPreview } from './shipPreview';
import { copyFit, paintCountText, paintLabel, pickComponent, pickPaintValue, slotChoices, slotCountText, slotSections, slotWord, type SlotOption } from './shipEditModel';
import { loadCustomizeFile } from '../player/customizer';
import type { Garage, VehicleDef } from '../vehicles/garage';
import type { ShipBuild } from '../vehicles/shipMounts';
import type { WingSet } from '../vehicles/wings';
import type { ShipPaint } from '../vehicles/shipPaint';
import { changedSlots, fitKey, samePaint, slotLabel, stockFit, type ComponentDef, type FitDef, type FitSlot, type ResolvedFit, type ShipFit } from '../vehicles/shipFit';

export interface ShipEditDeps {
  garage: () => Promise<Garage>;
  saved: (id: string) => ShipFit | null;
  /** Debounced by the game. */
  save: (id: string, fit: ShipFit) => void;
  /** The game's spawnVehicle, which writes the fits first. */
  spawn: (def: VehicleDef) => void;
  /** Write the fits, refit the player's spawned ships of this id, queue the hello. */
  closed: (def: VehicleDef) => void;
  /**
   * Keep the world's shadow-cascade records of some materials across a compile in the preview's context:
   * returns the function that puts them back (ShipPreview's `keepShadows`). Absent: nothing is kept.
   */
  keepShadows?: (materials: THREE.Material[]) => () => void;
}

/** What the preview shows now: the model's build record, its paint and the fit it wears. */
interface Shown {
  def: VehicleDef;
  build: ShipBuild | null;
  paint: ShipPaint | null;
  fit: ResolvedFit | null;
  /** The model's wings, so a restage adds the wings its new parts bring and drops those on parts taken down. */
  wings?: WingSet;
}

/** How long a slider waits for the value to settle before the preview repaints (ms). */
const SETTLE_MS = 120;

export class ShipEditUi {
  readonly root: HTMLElement;
  open = false;
  /** The stats line of a component in a slot, for the space combat's numbers; '' until something sets it. */
  statsFor: ((slot: string, component: ComponentDef) => string) | null = null;
  /** A click on a tab (or ‹ Garage): the game swaps the spawner's panels, closing this one. */
  onTab: (id: string) => void = () => {};
  private readonly body: HTMLElement;
  private readonly count: HTMLElement;
  private readonly previewBox: HTMLElement;
  private readonly busyNote: HTMLElement;
  private readonly wingsBox: HTMLInputElement;
  /** Made on the first show(), with its WebGL context: none is taken at boot. */
  private preview: ShipPreview | null = null;
  private garage: Garage | null = null;
  private def: VehicleDef | null = null;
  /** The fit being edited: a component per slot ('' empty), paint values and the droid; what is absent is stock. */
  private fit: ShipFit = stockFit();
  private resolved: ResolvedFit | null = null;
  private shown: Shown | null = null;
  /** The ship whose preview model is being built now, if any. */
  private building: VehicleDef | null = null;
  /** The latest fit the preview is to wear, and the pass bringing it there (one at a time; the last asked wins). */
  private want: ResolvedFit | null = null;
  private busy: Promise<void> | null = null;
  /** Each show() and each model build; a later one wins. */
  private loadGen = 0;
  /** The palettes' colours, by path (the ships pack's customize.json), loaded once. */
  private palettes: Promise<Record<string, number[][]>> | null = null;
  private paletteColors: Record<string, number[][]> = {};
  /** Sliders moved and not yet settled: their repaint timers, applied at once when the page closes. */
  private readonly settling = new Map<HTMLInputElement, number>();

  constructor(parent: HTMLElement, private readonly deps: ShipEditDeps) {
    this.root = document.createElement('div');
    this.root.id = 'shipedit';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="wardrobe-panel wide">
        <div class="wardrobe-header">
          ${tabStrip(SPAWNER_TABS, 'garage')}
          <button class="back" title="back to the garage's list">‹ Garage</button>
          <span class="count"></span>
          <button class="stock" title="the game's stock components, no droid and the shaders' own paint">Stock</button>
          <button class="spawn" title="stand the ship as edited beside you">Spawn</button>
          <button class="close">Close <b>B</b></button>
        </div>
        <div class="wardrobe-main">
          <div class="wardrobe-preview ship-preview">
            <label class="preview-toggle"><input type="checkbox" class="wings" /> wings open</label>
            <span class="ship-busy"></span>
            <div class="preview-hint">drag to turn · right-drag to pan · wheel to zoom · double-click to reset</div>
          </div>
          <div class="wardrobe-body"></div>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.body = this.root.querySelector<HTMLElement>('.wardrobe-body')!;
    this.count = this.root.querySelector<HTMLElement>('.count')!;
    this.previewBox = this.root.querySelector<HTMLElement>('.ship-preview')!;
    this.busyNote = this.root.querySelector<HTMLElement>('.ship-busy')!;
    this.wingsBox = this.root.querySelector<HTMLInputElement>('input.wings')!;
    // Every tab leaves the page, the Garage tab included (back to the list).
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.tabs .tab')) b.addEventListener('click', () => this.onTab(b.dataset.tab!));
    this.root.querySelector('.back')!.addEventListener('click', () => this.onTab('garage'));
    this.root.querySelector('.close')!.addEventListener('click', () => this.hide());
    this.root.querySelector('.stock')!.addEventListener('click', () => this.toStock());
    this.root.querySelector('.spawn')!.addEventListener('click', () => {
      if (!this.def) return;
      // A slider still settling is part of what is stood out.
      this.settleNow();
      this.deps.spawn(this.def);
    });
    this.wingsBox.addEventListener('change', () => this.preview?.setWingsOpen(this.wingsBox.checked));
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.hide();
    });
  }

  /** The ship on the page, or null. */
  get current(): VehicleDef | null {
    return this.def;
  }

  /** For the console: what the page shows and the preview's state. */
  report(): { ship: string | null; fit: ShipFit; key: string | null; previewKey: string | null; pending: string[]; preview: ReturnType<ShipPreview['report']> | null } {
    return {
      ship: this.def?.id ?? null,
      fit: this.fit,
      key: this.resolved ? fitKey(this.resolved) : null,
      previewKey: this.shown?.fit ? fitKey(this.shown.fit) : null,
      pending: (this.shown?.build?.pending ?? []).map((p) => `${p.slot}: ${p.label} waits for ${p.hardpoint}`),
      preview: this.preview?.report() ?? null,
    };
  }

  /** Open the page on a ship: its fit as kept with the character, the preview built (or brought to it). */
  async show(def: VehicleDef): Promise<void> {
    const gen = ++this.loadGen;
    this.def = def;
    this.open = true;
    this.root.classList.remove('hidden');
    this.count.textContent = def.label;
    // The context is made now, the first time the page opens.
    if (!this.preview) {
      this.preview = new ShipPreview({ keepShadows: this.deps.keepShadows });
      this.previewBox.prepend(this.preview.canvas);
    }
    this.preview.start();
    this.body.innerHTML = '<div class="wardrobe-empty">Loading the garage…</div>';
    let garage: Garage;
    try {
      garage = await this.deps.garage();
    } catch (err) {
      if (gen !== this.loadGen) return;
      console.warn(`ship edit: ${def.id}: the garage could not be loaded`, err);
      this.body.innerHTML = `<div class="wardrobe-empty">The garage could not be loaded: ${escapeHtml(err instanceof Error ? err.message : String(err))}. Close the page and open it again to retry.</div>`;
      return;
    }
    if (gen !== this.loadGen) return;
    this.garage = garage;
    const fd = def.fit ?? null;
    this.fit = copyFit(this.deps.saved(def.id) ?? stockFit());
    this.resolved = fd ? garage.resolve(def, this.fit) : null;
    if (fd?.paint) {
      this.paletteColors = await this.loadPalettes();
      if (gen !== this.loadGen) return;
    }
    this.render();
    await this.showModel(def, gen);
  }

  /** Close the page: a slider still settling is applied, the preview stops drawing (its context and model are kept), and the game refits and tells the others. */
  hide(): void {
    if (!this.open) return;
    this.settleNow();
    this.open = false;
    this.root.classList.add('hidden');
    this.preview?.stop();
    this.loadGen++;
    const def = this.def;
    if (def) this.deps.closed(def);
  }

  /** Apply every slider still waiting to settle, at once (the page closes, or the ship is stood out). */
  private settleNow(): void {
    for (const [input, timer] of this.settling) {
      window.clearTimeout(timer);
      this.pickPaint(input.dataset.paint!, Number(input.value));
    }
    this.settling.clear();
  }

  /** Build the preview's model for this ship, or, when it already shows it, bring it to the page's fit. */
  private async showModel(def: VehicleDef, gen: number): Promise<void> {
    const preview = this.preview!;
    const garage = this.garage!;
    if (this.shown?.def === def) {
      if (this.resolved) this.request(this.resolved);
      return;
    }
    // Already being built (the page reopened on it while it loads): that build brings it to the page's fit when it lands.
    if (this.building === def) return;
    this.building = def;
    this.shown = null;
    this.want = null;
    preview.clear();
    this.setBusy('building…');
    try {
      const r = await garage.visualParts(def, { fit: this.resolved, prepare: (roots) => preview.prepare(roots), forget: () => {}, paintWait: 3000 });
      if (gen !== this.loadGen && this.def !== def) {
        // Another ship was opened meanwhile: this model is never shown.
        r.paint?.dispose();
        return;
      }
      // Painted before it is shown (a no-op when the garage already painted it: nothing changed renders nothing).
      if (r.paint && r.fit?.painted && !r.paint.custom) {
        this.setBusy('painting…');
        await r.paint.apply(r.fit.paint, 3000);
      }
      await preview.show(r.holder, r.wings, r.paint);
      this.shown = { def, build: r.build, paint: r.paint, fit: r.fit, wings: r.wings };
      this.renderNotes();
      // The page may have changed the fit while the model was built.
      if (this.def === def && this.resolved && r.fit && fitKey(r.fit) !== fitKey(this.resolved)) this.request(this.resolved);
    } catch (err) {
      console.warn(`ship edit: ${def.id}: the preview could not be built`, err);
    } finally {
      if (this.building === def) this.building = null;
      if (!this.busy) this.setBusy('');
    }
  }

  /**
   * Bring the preview to `next`: the last one asked wins, and one pass runs at a time. A fit asked for
   * after the pass's loop ended but before it let go (another continuation in between) starts the next pass.
   */
  private request(next: ResolvedFit): void {
    this.want = next;
    if (this.busy) return;
    const run: Promise<void> = this.pump().finally(() => {
      if (this.busy === run) this.busy = null;
      this.setBusy('');
      if (this.want && !this.busy) this.request(this.want);
    });
    this.busy = run;
  }

  /**
   * One pass per wanted fit: parts whose look changed (or the droid) are staged, compiled in the
   * preview's context and painted before one synchronous swap; a paint change alone only
   * repaints, which renders off the main thread and puts the texture on when it lands.
   */
  private async pump(): Promise<void> {
    while (this.want) {
      const next = this.want;
      this.want = null;
      const s = this.shown;
      const fd = s?.def.fit;
      if (!s || !fd || !s.fit || !s.build || !this.garage || !this.preview) continue;
      if (fitKey(s.fit) === fitKey(next)) continue;
      const preview = this.preview;
      try {
        const slots = changedSlots(fd, s.fit, next);
        if (slots.length) {
          this.setBusy('fitting…');
          const staged = await this.garage.restage(s.def, s.build, s.fit, next, s.paint, (roots) => preview.prepare(roots), s.wings);
          // The model was replaced meanwhile (another ship opened): the staged parts are never hung.
          if (this.shown !== s) continue;
          staged.commit();
        } else if (!samePaint(s.fit, next)) {
          this.setBusy('painting…');
          await s.paint?.apply(next.paint);
          if (this.shown !== s) continue;
        }
        s.fit = next;
      } catch (err) {
        console.warn(`ship edit: ${s.def.id}: the preview could not change`, err);
      }
      this.renderNotes();
    }
  }

  private setBusy(text: string): void {
    this.busyNote.textContent = text;
  }

  /**
   * The palettes' colours from the ships pack's customize.json (the one parse the ships' paint
   * shares, loadCustomizeFile); none when the pack has no paint. A failed load is tried again on
   * the next show.
   */
  private loadPalettes(): Promise<Record<string, number[][]>> {
    this.palettes ??= loadCustomizeFile(`${import.meta.env.BASE_URL}assets-private/ships/`).then((file) => {
      if (!file) {
        console.warn('ship edit: the ships pack has no customize.json: the palettes show no colours');
        this.palettes = null;
      }
      return (file?.palettes as Record<string, number[][]> | undefined) ?? {};
    });
    return this.palettes;
  }

  /** Back to stock: the game's components, no droid, the shaders' own paint (the paint's copies go). */
  private toStock(): void {
    const def = this.def;
    if (!def || !this.garage) return;
    this.fit = stockFit();
    this.commitFit();
    this.render();
  }

  /** The fit changed: kept (debounced by the game), resolved again, and the preview brought to it. */
  private commitFit(): void {
    const def = this.def;
    if (!def || !this.garage) return;
    this.deps.save(def.id, copyFit(this.fit));
    this.resolved = def.fit ? this.garage.resolve(def, this.fit) : null;
    if (this.resolved) this.request(this.resolved);
    this.renderCounts();
  }

  // --- the page -----------------------------------------------------------------------------

  private render(): void {
    const def = this.def;
    const fd = def?.fit ?? null;
    const g = this.garage;
    if (!def || !g) return;
    // The rows are made again: a slider still settling on the old rows is dropped (Stock overrides it; a new page flushed it on close).
    for (const timer of this.settling.values()) window.clearTimeout(timer);
    this.settling.clear();
    if (!fd || !this.resolved) {
      this.count.textContent = def.label;
      this.body.innerHTML = `<div class="wardrobe-empty">This ship was converted before ship customization, so it carries no slots or paint to edit. Convert the ships again: <code>npm run swg -- ships @SWG assets-private --retail-only</code>.</div>`;
      return;
    }
    const { fixed, visual, systems } = slotSections(fd);
    this.count.textContent = `${def.label}${fixed ? ` · ${fixed} fixed part${fixed === 1 ? '' : 's'}` : ''}`;
    const notes = this.resolved.notes.length ? `<div class="edit-note">${this.resolved.notes.map(escapeHtml).join('<br>')}</div>` : '';
    this.body.innerHTML = [
      `<h3 class="wardrobe-section">Paint <span>the game's own patterns and palettes</span></h3>${this.paintRows(fd)}`,
      `<h3 class="wardrobe-section">Components <span>what shows on the hull</span></h3>${notes}${visual.map((s) => this.slotRow(s)).join('') || '<div class="edit-note">Nothing this hull carries changes its look.</div>'}`,
      `<h3 class="wardrobe-section">Droid <span>an astromech in the socket, or a flight computer</span></h3>${this.droidRow(fd)}`,
      systems.length ? `<h3 class="wardrobe-section">Systems <span>no visible change; they matter in space combat</span></h3>${systems.map((s) => this.slotRow(s)).join('')}` : '',
    ].join('');
    this.wire();
    this.renderCounts();
    this.renderNotes();
  }

  private paintRows(fd: FitDef): string {
    if (!fd.paint || !fd.paint.variables.length) return `<div class="edit-note">This hull's paint is fixed in the game: its shaders take no colours.</div>`;
    const values = this.resolved?.paint ?? {};
    return fd.paint.variables
      .map((v) => {
        const value = values[v.name] ?? v.default;
        const label = paintLabel(v.name);
        const colors = v.kind === 'palette' && v.palette ? this.paletteColors[v.palette] : undefined;
        if (v.kind === 'palette' && colors?.length) {
          const swatches = colors.map((c, i) => `<button class="swatch${i === value ? ' on' : ''}" data-paint="${escapeHtml(v.name)}" data-value="${i}" style="background:rgb(${c[0]},${c[1]},${c[2]})" title="${escapeHtml(label)} ${i + 1}"></button>`).join('');
          return `<div class="wardrobe-slot colour" data-row="${escapeHtml(v.name)}"><span class="slot-label">${escapeHtml(label)}</span><div class="palette"><div class="swatches">${swatches}</div><input type="range" class="scrub" min="0" max="${colors.length - 1}" step="1" value="${value}" data-paint="${escapeHtml(v.name)}" /></div><span class="slot-count">${escapeHtml(paintCountText(v, value, colors.length))}</span></div>`;
        }
        const count = v.kind === 'index' ? (v.count ?? 1) : (v.size ?? 1);
        if (count < 2) return '';
        return `<label class="wardrobe-slot colour pattern" data-row="${escapeHtml(v.name)}"><span class="slot-label">${escapeHtml(label)}</span><input type="range" class="choice" min="0" max="${count - 1}" step="1" value="${value}" data-paint="${escapeHtml(v.name)}" /><span class="slot-count">${escapeHtml(paintCountText(v, value))}</span></label>`;
      })
      .join('');
  }

  /** A slot's row: a select of the components it takes, grouped by the look they show on this hull, "(empty)" last. */
  private slotRow(slot: FitSlot): string {
    const current = this.resolved?.components[slot.slot] ?? null;
    const choices = slotChoices(slot, this.garage!.components, current);
    const option = (o: SlotOption) => `<option value="${escapeHtml(o.name)}"${o.selected ? ' selected' : ''}>${escapeHtml(o.label)}${o.stock ? ' (stock)' : ''}</option>`;
    const groups = choices.groups.map((g) => (g.label === null ? g.options.map(option).join('') : `<optgroup label="${escapeHtml(g.label)}">${g.options.map(option).join('')}</optgroup>`)).join('');
    const extra = choices.extra !== null ? `<option value="${escapeHtml(choices.extra)}" selected>${escapeHtml(choices.extra)}</option>` : '';
    return `<label class="wardrobe-slot" data-row="${escapeHtml(slot.slot)}"><span class="slot-label">${escapeHtml(slotLabel(slot))}</span><select data-slot="${escapeHtml(slot.slot)}">${groups}${extra}<option value=""${choices.emptySelected ? ' selected' : ''}>(empty)</option></select><span class="slot-count"></span><span class="slot-stats"></span></label><div class="slot-note hidden" data-note="${escapeHtml(slot.slot)}"></div>`;
  }

  /** The droid row: an astromech in the socket (the hulls with one), else a flight computer, which shows nothing. */
  private droidRow(fd: FitDef): string {
    const g = this.garage!;
    const list = g.droids.filter((d) => d.kind === fd.droid);
    const current = this.resolved?.droid ?? '';
    const options = [`<option value=""${current === '' ? ' selected' : ''}>none</option>`, ...list.map((d) => `<option value="${escapeHtml(d.id)}"${d.id === current ? ' selected' : ''}>${escapeHtml(d.label)}</option>`)];
    const note = fd.droid === 'computer' ? `<div class="slot-note">no model: it sits in the ship's computer</div>` : list.some((d) => !d.model && !d.heads) ? `<div class="slot-note">a droid without a model in the pack is kept but not drawn</div>` : '';
    const empty = list.length ? '' : `<div class="slot-note">${fd.droid === 'astromech' ? 'no astromech models in the pack: convert the mobiles, then the ships again' : 'the pack lists no flight computers'}</div>`;
    return `<label class="wardrobe-slot" data-row="droid"><span class="slot-label">${fd.droid === 'astromech' ? 'Astromech' : 'Flight computer'}</span><select data-slot="droid">${options.join('')}</select><span class="slot-count"></span></label>${note}${empty}<div class="slot-note hidden" data-note="droid"></div>`;
  }

  private wire(): void {
    for (const sel of this.body.querySelectorAll<HTMLSelectElement>('select[data-slot]')) {
      sel.addEventListener('change', () => this.pickSlot(sel.dataset.slot!, sel.value));
    }
    for (const b of this.body.querySelectorAll<HTMLButtonElement>('.swatch[data-paint]')) {
      b.addEventListener('click', () => this.pickPaint(b.dataset.paint!, Number(b.dataset.value)));
    }
    for (const input of this.body.querySelectorAll<HTMLInputElement>('input[data-paint]')) {
      // The row follows the slider as it moves; the repaint waits for it to settle (or for the page to close).
      input.addEventListener('input', () => {
        this.showPaintValue(input.dataset.paint!, Number(input.value));
        const was = this.settling.get(input);
        if (was !== undefined) window.clearTimeout(was);
        this.settling.set(
          input,
          window.setTimeout(() => {
            this.settling.delete(input);
            this.pickPaint(input.dataset.paint!, Number(input.value));
          }, SETTLE_MS),
        );
      });
    }
  }

  /** A slot's component (or the droid) picked: '' leaves it empty; the stock one is kept as "stock" (absent). */
  private pickSlot(slot: string, value: string): void {
    const fd = this.def?.fit;
    if (!fd || !pickComponent(this.fit, fd, slot, value)) return;
    this.commitFit();
  }

  /** A paint value picked: the shader's own default is kept as absent. */
  private pickPaint(name: string, value: number): void {
    const fd = this.def?.fit;
    if (!fd || !pickPaintValue(this.fit, fd, name, value)) return;
    this.showPaintValue(name, value);
    this.commitFit();
  }

  /** A paint row's swatch, slider and count agree with a value. */
  private showPaintValue(name: string, value: number): void {
    const v = this.def?.fit?.paint?.variables.find((x) => x.name === name);
    const row = this.body.querySelector<HTMLElement>(`[data-row="${CSS.escape(name)}"]`);
    if (!v || !row) return;
    const input = row.querySelector<HTMLInputElement>('input[data-paint]');
    if (input && Number(input.value) !== value) input.value = String(value);
    for (const sw of row.querySelectorAll<HTMLElement>('.swatch')) sw.classList.toggle('on', Number(sw.dataset.value) === value);
    const count = row.querySelector<HTMLElement>('.slot-count');
    if (count) count.textContent = paintCountText(v, value, v.kind === 'palette' && input ? Number(input.max) + 1 : undefined);
  }

  /** Each slot's look, whether it is stock, and the stats line; the selects follow the resolved fit (a fixed fallback shows). */
  private renderCounts(): void {
    const fd = this.def?.fit;
    const r = this.resolved;
    const g = this.garage;
    if (!fd || !r || !g) return;
    for (const s of fd.slots) {
      if (s.fixed) continue;
      const row = this.body.querySelector<HTMLElement>(`[data-row="${CSS.escape(s.slot)}"]`);
      if (!row) continue;
      const name = r.components[s.slot] ?? null;
      const sel = row.querySelector<HTMLSelectElement>('select');
      if (sel && sel.value !== (name ?? '')) sel.value = name ?? '';
      const count = row.querySelector<HTMLElement>('.slot-count');
      if (count) count.textContent = slotCountText(s, name, r.looks[s.slot] ?? -1);
      const stats = row.querySelector<HTMLElement>('.slot-stats');
      const idx = name ? g.componentByName.get(name) : undefined;
      if (stats) stats.textContent = this.statsFor && idx !== undefined && g.components[idx] ? this.statsFor(s.slot, g.components[idx]) : '';
    }
    const droidRow = this.body.querySelector<HTMLElement>('[data-row="droid"]');
    const droidSel = droidRow?.querySelector<HTMLSelectElement>('select');
    if (droidSel && droidSel.value !== (r.droid ?? '')) droidSel.value = r.droid ?? '';
    const droidCount = droidRow?.querySelector<HTMLElement>('.slot-count');
    if (droidCount) droidCount.textContent = r.droid ? (fd.droid === 'astromech' ? 'in the socket' : 'no model') : 'stock';
  }

  /** Under each slot, the parts that wait for a mount nothing fitted carries (a booster on an engine that has no booster point). */
  private renderNotes(): void {
    const fd = this.def?.fit;
    if (!fd) return;
    const pending = this.shown?.def === this.def ? (this.shown?.build?.pending ?? []) : [];
    for (const el of this.body.querySelectorAll<HTMLElement>('[data-note]')) {
      const slot = el.dataset.note!;
      const waiting = pending.filter((p) => p.slot === slot);
      el.classList.toggle('hidden', waiting.length === 0);
      el.textContent = waiting.map((p) => `the ${slotWord(fd, p.slot)} has no mount here: nothing fitted carries ${p.hardpoint}`).join('; ');
    }
  }
}
