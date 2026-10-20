// The garage: the gallery's vehicles and the animal mounts, by the kind each handles as, with a
// button to stand one beside you, and a way to try a model as another kind. Beside each skinned pod,
// the engines it is spawned on: its own, or any other skinned pod's (a pod put together from parts,
// src/vehicles/podHybrid.ts), kept in this browser.
import { SPAWNER_TABS, tabStrip, wireTabs } from './tabs';
import { GroupState, escapeHtml, groupHtml } from './catalogue';
import type { Garage, VehicleDef } from '../vehicles/garage';
import type { VehicleKind } from '../vehicles/vehicle';
import { isHalf } from '../vehicles/podHybrid.ts';

/** Where this browser keeps the engines chosen for each skinned pod: a convenience of the viewer's, never the character's. */
const ENGINES_KEY = 'swg3js.podEngines';

/** The engines chosen for each skinned pod, by its garage id; empty where storage is refused or holds nothing sensible. */
function readEngines(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(ENGINES_KEY) ?? '{}') as unknown;
    const out: Record<string, string> = Object.create(null) as Record<string, string>;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const [k, v] of Object.entries(raw as Record<string, unknown>)) if (typeof v === 'string' && v) out[k] = v;
    return out;
  } catch {
    return Object.create(null) as Record<string, string>;
  }
}

/** Keep the choices; a browser that refuses storage keeps them for the session only. */
function writeEngines(chosen: Record<string, string>): void {
  try {
    localStorage.setItem(ENGINES_KEY, JSON.stringify(chosen));
  } catch {
    // Storage refused (a private window, cleared site data): the choice holds until the page goes.
  }
}

const KINDS: { id: VehicleKind; label: string; blurb: string }[] = [
  { id: 'podracer', label: 'Podracers', blurb: 'fast, drifting, banking; the boost heats and burns out' },
  { id: 'speederbike', label: 'Speeder bikes', blurb: 'quick and grippy, a burst boost, a hop' },
  { id: 'ground', label: 'Ground vehicles and mounts', blurb: 'walkers and animals: slow, turn in place, on their feet' },
  { id: 'flyer', label: 'Flyers', blurb: 'flying cars and aircraft: look up and down, or Space and X, to climb and sink' },
  { id: 'ship', label: 'Ships', blurb: 'the player ships: W builds speed, the mouse pitches and turns, A/D roll; a first flight model' },
];

export class VehiclesUi {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly count: HTMLElement;
  private garage: Garage | null = null;
  private readonly groups = new GroupState();
  private lastFind = '';
  /** The engines chosen for each skinned pod, by its garage id (absent: its own). */
  private readonly engines = readEngines();
  open = false;
  /** A click on another tab: the game swaps the panels. */
  onTab: (id: string) => void = () => {};
  /** A ship's edit button (or a painted speeder's paint button): the game opens its edit page (components, droid and paint; a speeder's paint alone). */
  onEdit: (def: VehicleDef) => void = () => {};

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
  constructor(parent: HTMLElement, private readonly onSpawn: (def: VehicleDef, kind?: VehicleKind, engines?: string) => void, private readonly onClear: () => number) {
    this.root = document.createElement('div');
    this.root.id = 'garage';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="wardrobe-panel">
        <div class="wardrobe-header">
          ${tabStrip(SPAWNER_TABS, 'garage')}
          <span class="count"></span>
          <input class="find" placeholder="find" />
          <button class="clear">Remove all</button>
          <button class="close">Close <b>B</b></button>
        </div>
        <div class="wardrobe-main"><div class="wardrobe-body weapons-body"></div></div>
      </div>`;
    parent.appendChild(this.root);
    this.body = this.root.querySelector('.weapons-body')!;
    this.count = this.root.querySelector('.count')!;
    this.root.querySelector('.close')!.addEventListener('click', () => this.dismiss());
    wireTabs(this.root, 'garage', (id) => this.onTab(id));
    this.root.querySelector('.clear')!.addEventListener('click', () => {
      const n = this.onClear();
      this.count.textContent = `${n} removed`;
    });
    this.root.querySelector('.find')!.addEventListener('input', () => this.render());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.dismiss();
    });
  }

  attach(garage: Garage): void {
    this.garage = garage;
    this.render();
  }

  render(): void {
    const g = this.garage;
    if (!g) {
      this.body.innerHTML = `<p class="hint">Loading the garage...</p>`;
      return;
    }
    if (!g.vehicles.length) {
      this.body.innerHTML = `<p class="hint">Nothing to spawn: build the gallery (<code>npm run swg -- gallery @SWG assets-private --retail-only --jka=@JKA</code>) for the vehicles and the creatures pack for the mounts.</p>`;
      return;
    }
    const find = (this.root.querySelector('.find') as HTMLInputElement).value.trim().toLowerCase();
    if (find !== this.lastFind) this.groups.clear();
    this.lastFind = find;
    const groups = g.byKind();
    const halves = g.halves();
    const html: string[] = [];
    let shown = 0;
    for (const k of KINDS) {
      const list = (groups.get(k.id) ?? []).filter((v) => !find || v.id.toLowerCase().includes(find) || v.label.toLowerCase().includes(find));
      if (!list.length) continue;
      shown += list.length;
      const items = list.map((v) => {
        const other = KINDS.filter((o) => o.id !== v.kind).map((o) => `<option value="${o.id}">as ${escapeHtml(o.label.toLowerCase())}</option>`).join('');
        const tags = [v.source === 'ship' ? '' : v.source, v.inferred ? '' : 'kind guessed'].filter(Boolean).join(' · ');
        // A ship the pack gave a fit has an edit page; one converted before shows the spawn button only. A
        // speeder whose shaders take colours has the same page with its paint alone.
        const edit = v.kind === 'ship' && v.fit ? `<button data-edit="${v.id}" title="components, droid and paint">edit</button>` : v.fit?.paint ? `<button data-edit="${v.id}" title="its colours">paint</button>` : '';
        // A skinned pod's engines: its own, or any other skinned pod's, by the name the garage gives it.
        const mine = this.enginesFor(v.id);
        const engines = isHalf(v) && halves.length > 1 ? `<select data-engines="${v.id}" title="the engines it is spawned on"><option value="">own engines</option>${halves.filter((o) => o.id !== v.id).map((o) => `<option value="${o.id}"${o.id === mine ? ' selected' : ''}>${escapeHtml(o.label)} engines</option>`).join('')}</select>` : '';
        return `<div class="cat-item" title="${escapeHtml(v.id)}"><span class="cat-name">${escapeHtml(v.label)}${tags ? ` <small>${escapeHtml(tags)}</small>` : ''}</span><span class="cat-hands">${edit}${engines}<button data-id="${v.id}" title="stand one beside you">spawn</button><select data-id="${v.id}" title="try it as another kind"><option value="">as…</option>${other}</select></span></div>`;
      });
      html.push(groupHtml(k.id, k.label, list.length, k.blurb, this.groups.isOpen(k.id, !!find), items.join('')));
    }
    this.body.innerHTML = html.join('');
    this.groups.wire(this.body);
    this.count.textContent = `${shown} of ${g.vehicles.filter((v) => !v.npc).length}`;
    for (const b of this.body.querySelectorAll<HTMLButtonElement>('button[data-id]')) {
      b.addEventListener('click', () => {
        const def = g.vehicles.find((v) => v.id === b.dataset.id);
        if (def) this.onSpawn(def, undefined, this.enginesFor(def.id) || undefined);
      });
    }
    for (const sel of this.body.querySelectorAll<HTMLSelectElement>('select[data-engines]')) {
      sel.addEventListener('change', () => {
        const id = sel.dataset.engines ?? '';
        if (!id) return;
        if (sel.value) this.engines[id] = sel.value;
        else delete this.engines[id];
        writeEngines(this.engines);
      });
    }
    for (const b of this.body.querySelectorAll<HTMLButtonElement>('button[data-edit]')) {
      b.addEventListener('click', () => {
        const def = g.vehicles.find((v) => v.id === b.dataset.edit);
        if (def) this.onEdit(def);
      });
    }
    for (const sel of this.body.querySelectorAll<HTMLSelectElement>('select[data-id]')) {
      sel.addEventListener('change', () => {
        const def = g.vehicles.find((v) => v.id === sel.dataset.id);
        if (def && sel.value) this.onSpawn(def, sel.value as VehicleKind, this.enginesFor(def.id) || undefined);
        sel.value = '';
      });
    }
  }

  /** The engines chosen for a skinned pod in this browser ('' for its own), kept only while that pod is still a skinned pod of this garage. */
  enginesFor(id: string): string {
    const want = this.engines[id] ?? '';
    return want && this.garage?.halves().some((v) => v.id === want) ? want : '';
  }

  /** Every choice of engines kept in this browser, by pod, for the console. */
  enginesChosen(): Record<string, string> {
    return { ...this.engines };
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
