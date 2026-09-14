// The garage: the gallery's vehicles and the animal mounts, by the kind each handles as, with a
// button to stand one beside you, and a way to try a model as another kind.
import { SPAWNER_TABS, tabStrip, wireTabs } from './tabs';
import type { Garage, VehicleDef } from '../vehicles/garage';
import type { VehicleKind } from '../vehicles/vehicle';

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
  open = false;
  /** A click on another tab: the game swaps the panels. */
  onTab: (id: string) => void = () => {};

  constructor(parent: HTMLElement, private readonly onSpawn: (def: VehicleDef, kind?: VehicleKind) => void, private readonly onClear: () => number) {
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
    this.root.querySelector('.close')!.addEventListener('click', () => this.hide());
    wireTabs(this.root, 'garage', (id) => this.onTab(id));
    this.root.querySelector('.clear')!.addEventListener('click', () => {
      const n = this.onClear();
      this.count.textContent = `${n} removed`;
    });
    this.root.querySelector('.find')!.addEventListener('input', () => this.render());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.hide();
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
    const groups = g.byKind();
    const html: string[] = [];
    let shown = 0;
    for (const k of KINDS) {
      const list = (groups.get(k.id) ?? []).filter((v) => !find || v.id.toLowerCase().includes(find));
      if (!list.length) continue;
      shown += list.length;
      html.push(`<h3 class="weapons-class">${k.label} <span>${list.length} · ${k.blurb}</span></h3>`);
      for (const v of list) {
        const other = KINDS.filter((o) => o.id !== v.kind).map((o) => `<option value="${o.id}">as ${o.label.toLowerCase()}</option>`).join('');
        html.push(`<div class="weapons-row"><span class="name">${v.label}${v.inferred ? '' : ' <em>(kind guessed)</em>'}</span><span class="reach">${v.source}</span><button data-id="${v.id}">spawn</button><select data-id="${v.id}"><option value="">try it as...</option>${other}</select></div>`);
      }
    }
    this.body.innerHTML = html.join('');
    this.count.textContent = `${shown} of ${g.vehicles.length}`;
    for (const b of this.body.querySelectorAll<HTMLButtonElement>('button[data-id]')) {
      b.addEventListener('click', () => {
        const def = g.vehicles.find((v) => v.id === b.dataset.id);
        if (def) this.onSpawn(def);
      });
    }
    for (const sel of this.body.querySelectorAll<HTMLSelectElement>('select[data-id]')) {
      sel.addEventListener('change', () => {
        const def = g.vehicles.find((v) => v.id === sel.dataset.id);
        if (def && sel.value) this.onSpawn(def, sel.value as VehicleKind);
        sel.value = '';
      });
    }
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
