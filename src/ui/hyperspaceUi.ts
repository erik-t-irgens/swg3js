// The System Map: the pilot's choice of where to jump, opened from the ship menu's Hyperspace row and
// closed by the same key. The systems down the left (every space zone, the one flown in marked), the
// picked system's hyperspace points, stations and launch point in the middle by the game's own names,
// and the picked destination's description, distance and the Hyperspace button on the right. The
// window's words ("System Map", "Selected point", "Travel information") are the client's, written here
// in our own code.
//
// Also the jump's one piece of screen furniture, a plain element (no pass, no program, nothing to
// compile): the countdown line in the middle of the screen. The move itself is covered by the tunnel
// (hyperspaceTunnel.ts), drawn in the world.

import type * as THREE from 'three';
import type { HyperspaceUiPort } from '../space/hyperspace';
import type { Destination, HyperspaceCatalogue, HyperspaceSystem } from '../space/spaceData';
import { distanceText, toGame } from '../space/hyperspaceMath';

/** What the panel is opened with: where the player is, the catalogue (loaded on first open), the ship's place, and the jump's own refusals. */
export interface SystemMapContext {
  /** The zone flown in (`world.planet.id`). */
  here: string;
  catalogue: () => Promise<HyperspaceCatalogue>;
  /** The piloted ship's position in the game frame, or null. */
  shipAt: () => THREE.Vector3 | null;
  /** Why a destination cannot be jumped to now (`Hyperspace.why`), or null. */
  why: (d: Destination) => string | null;
}

const GLYPH: Record<Destination['kind'], string> = { point: '◇', station: '▣', launch: '○' };
/** How often the open panel reads the distances and the refusals afresh (the ship flies on underneath). */
const REFRESH_MS = 500;

/** A system has jump data when its pack is the hyperspace version (a v1 pack has no `hyperspace`). */
function converted(s: HyperspaceSystem): boolean {
  return !!s.pack?.hyperspace;
}

export class HyperspaceUi implements HyperspaceUiPort {
  readonly root: HTMLElement;
  onJump: (dest: Destination) => void = () => {};
  onClose: () => void = () => {};
  private readonly keyLabel: () => string;
  private readonly countEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly systemsEl: HTMLElement;
  private readonly pointsEl: HTMLElement;
  private readonly infoEl: HTMLElement;
  private readonly closeEl: HTMLButtonElement;
  private ctx: SystemMapContext | null = null;
  private catalogue: HyperspaceCatalogue | null = null;
  /** Bumped by every show and hide, so a catalogue that arrives after the panel was closed (or reopened elsewhere) is not drawn. */
  private generation = 0;
  private system: string | null = null;
  private pick: string | null = null;
  private timer: number | null = null;
  /** The live parts of the drawn lists, written by the refresh. */
  private distances: { dest: Destination; el: HTMLElement }[] = [];
  private goButton: HTMLButtonElement | null = null;
  private goWhy: HTMLElement | null = null;
  private travelEl: HTMLElement | null = null;
  /** A refusal from the last press of Hyperspace, shown until the pick changes. */
  private refusal: string | null = null;
  private lastBanner: string | null = null;

  constructor(parent: HTMLElement, keyLabel: () => string) {
    this.keyLabel = keyLabel;
    this.root = document.createElement('div');
    this.root.id = 'hyperspace';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="ship-panel hyperspace-panel">
        <div class="ship-header">
          <h2>System Map</h2>
          <span class="ship-title"></span>
          <button class="close">Close</button>
        </div>
        <div class="ship-body">
          <div class="hs-grid">
            <div class="hs-col hs-systems"></div>
            <div class="hs-col hs-points"></div>
            <div class="hs-col hs-info"></div>
          </div>
          <p class="menu-hint">Arrows pick, Enter jumps. The jump counts down from 5; the ship menu cancels it. Points marked "made up" are ours: the game kept those on its servers.</p>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.titleEl = this.root.querySelector('.ship-title')!;
    this.systemsEl = this.root.querySelector('.hs-systems')!;
    this.pointsEl = this.root.querySelector('.hs-points')!;
    this.infoEl = this.root.querySelector('.hs-info')!;
    this.closeEl = this.root.querySelector<HTMLButtonElement>('.close')!;
    this.closeEl.addEventListener('click', () => this.onClose());
    // The countdown line goes first in the UI layer, so every later positioned child (the HUD, the prompt
    // line, every panel, the Escape menu, the death card, the loading screen) is drawn over it.
    this.countEl = document.createElement('div');
    this.countEl.id = 'hyperspace-count';
    this.countEl.className = 'hidden';
    parent.prepend(this.countEl);
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** Open for a zone; the catalogue loads on the first open ("reading the systems…" meanwhile) and is kept by the caller. */
  show(ctx: SystemMapContext): void {
    this.ctx = ctx;
    const gen = ++this.generation;
    this.root.classList.remove('hidden');
    this.closeEl.textContent = `Close (${this.keyLabel()})`;
    this.refusal = null;
    // Opened afresh in the system flown in, whatever was picked last time.
    this.system = ctx.here;
    this.pick = null;
    if (this.timer === null) this.timer = window.setInterval(() => this.refresh(), REFRESH_MS);
    this.titleEl.textContent = '';
    if (!this.catalogue) {
      this.systemsEl.innerHTML = '<p class="hs-head">Systems</p><div class="hs-empty">reading the systems…</div>';
      this.pointsEl.innerHTML = '';
      this.infoEl.innerHTML = '';
    } else this.render();
    ctx.catalogue().then(
      (c) => {
        if (gen !== this.generation) return;
        this.catalogue = c;
        this.render();
      },
      (err: unknown) => {
        if (gen !== this.generation) return;
        console.warn('hyperspace: the systems could not be read', err);
        if (!this.catalogue) this.systemsEl.innerHTML = '<p class="hs-head">Systems</p><div class="hs-empty">the systems could not be read</div>';
      },
    );
  }

  hide(): void {
    this.generation++;
    this.root.classList.add('hidden');
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** A refusal from the jump (the Hyperspace button pressed when it could not start), shown under the button. */
  note(text: string): void {
    this.refusal = text;
    this.refresh();
  }

  /** The countdown line in the middle of the screen, or none. Written only when it changes. */
  banner(text: string | null): void {
    if (text === this.lastBanner) return;
    this.lastBanner = text;
    if (text === null) {
      this.countEl.classList.add('hidden');
      this.countEl.textContent = '';
    } else {
      this.countEl.textContent = text;
      this.countEl.classList.remove('hidden');
    }
  }

  // ---- The lists ----

  private systemOf(id: string | null): HyperspaceSystem | null {
    return this.catalogue?.systems.find((s) => s.id === id) ?? null;
  }

  private picked(): Destination | null {
    const s = this.systemOf(this.system);
    return s?.destinations.find((d) => d.key === this.pick) ?? null;
  }

  /** Draw the three columns for the picked system and destination. */
  private render(): void {
    const cat = this.catalogue;
    const ctx = this.ctx;
    if (!cat || !ctx) return;
    if (!this.systemOf(this.system)) this.system = cat.systems[0]?.id ?? null;
    const sys = this.systemOf(this.system);
    if (sys && !sys.destinations.some((d) => d.key === this.pick)) this.pick = sys.destinations[0]?.key ?? null;
    const hereSys = this.systemOf(ctx.here);
    this.titleEl.textContent = `from ${hereSys?.title ?? ctx.here}`;

    // Systems.
    this.systemsEl.innerHTML = '<p class="hs-head">Systems</p>';
    for (const s of cat.systems) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `hs-row${s.id === this.system ? ' on' : ''}${converted(s) ? '' : ' off'}`;
      const name = document.createElement('span');
      name.className = 'hs-name';
      name.textContent = `${s.id === ctx.here ? '● ' : ''}${s.title}`;
      const count = document.createElement('span');
      count.className = 'hs-dist';
      count.textContent = converted(s) ? `(${s.destinations.length})` : 'not converted';
      b.append(name, count);
      b.addEventListener('click', () => this.pickSystem(s.id));
      this.systemsEl.appendChild(b);
    }

    // Points, stations and the launch point.
    this.distances = [];
    this.pointsEl.innerHTML = '<p class="hs-head">Points</p>';
    if (!sys) {
      this.pointsEl.insertAdjacentHTML('beforeend', '<div class="hs-empty">no systems</div>');
    } else if (!converted(sys)) {
      const p = document.createElement('div');
      p.className = 'hs-empty';
      p.textContent = 'This system is not converted for hyperspace yet: npm run swg -- space @SWG all assets-private --retail-only';
      this.pointsEl.appendChild(p);
    } else if (!sys.destinations.length) {
      this.pointsEl.insertAdjacentHTML('beforeend', '<div class="hs-empty">nowhere to jump to in this system</div>');
    } else {
      for (const d of sys.destinations) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `hs-row${d.key === this.pick ? ' on' : ''}`;
        const glyph = document.createElement('span');
        glyph.textContent = GLYPH[d.kind];
        const name = document.createElement('span');
        name.className = 'hs-name';
        name.textContent = d.name;
        b.append(glyph, name);
        if (d.invented) {
          const tag = document.createElement('span');
          tag.className = 'hs-made-up';
          tag.textContent = 'made up';
          tag.title = 'The game kept this place on its servers; this one is ours.';
          b.appendChild(tag);
        }
        const dist = document.createElement('span');
        dist.className = 'hs-dist';
        b.appendChild(dist);
        this.distances.push({ dest: d, el: dist });
        b.addEventListener('click', () => this.pickDestination(d.key));
        b.addEventListener('dblclick', () => this.jump());
        this.pointsEl.appendChild(b);
      }
    }

    // The one picked.
    this.infoEl.innerHTML = '<p class="hs-head">Selected point</p>';
    this.goButton = null;
    this.goWhy = null;
    this.travelEl = null;
    const d = this.picked();
    if (!d) {
      this.infoEl.insertAdjacentHTML('beforeend', '<div class="hs-empty">nothing picked</div>');
    } else {
      const h = document.createElement('h3');
      h.textContent = d.name;
      this.infoEl.appendChild(h);
      if (d.description && d.description.trim() !== d.name.trim()) {
        const desc = document.createElement('p');
        desc.className = 'hs-desc';
        desc.textContent = d.description;
        this.infoEl.appendChild(desc);
      }
      const notes: string[] = [];
      if (d.kind === 'station') notes.push('(landing at stations is not built yet)');
      if (d.invented) notes.push('Made up: the game kept this place on its servers, so it is placed by us.');
      for (const n of notes) {
        const p = document.createElement('p');
        p.className = 'hs-note';
        p.textContent = n;
        this.infoEl.appendChild(p);
      }
      const head = document.createElement('p');
      head.className = 'hs-head';
      head.textContent = 'Travel information';
      head.style.marginTop = '12px';
      this.infoEl.appendChild(head);
      this.travelEl = document.createElement('p');
      this.travelEl.className = 'hs-travel';
      this.infoEl.appendChild(this.travelEl);
      const row = document.createElement('div');
      row.className = 'ship-action';
      this.goButton = document.createElement('button');
      this.goButton.type = 'button';
      this.goButton.textContent = 'Hyperspace';
      this.goButton.addEventListener('click', () => this.jump());
      this.goWhy = document.createElement('span');
      this.goWhy.className = 'why';
      row.append(this.goButton, this.goWhy);
      this.infoEl.appendChild(row);
    }
    this.refresh();
    this.infoEl.scrollTop = 0;
    // Keep the picked row in view when the keys move it past the column's edge.
    this.pointsEl.querySelector<HTMLElement>('.hs-row.on')?.scrollIntoView({ block: 'nearest' });
    this.systemsEl.querySelector<HTMLElement>('.hs-row.on')?.scrollIntoView({ block: 'nearest' });
  }

  /** The parts that change as the ship flies: each row's distance, the travel line, and whether Hyperspace can be pressed. */
  private refresh(): void {
    const ctx = this.ctx;
    if (!ctx || !this.catalogue || !this.open) return;
    const ship = ctx.shipAt();
    const distanceTo = (d: Destination): number | null => {
      if (d.zone !== ctx.here || !ship) return null;
      const g = toGame(d.at);
      return Math.hypot(g[0] - ship.x, g[1] - ship.y, g[2] - ship.z);
    };
    for (const { dest, el } of this.distances) {
      const m = distanceTo(dest);
      el.textContent = dest.zone !== ctx.here ? 'another system' : m === null ? '' : distanceText(m);
    }
    const d = this.picked();
    if (!d || !this.goButton || !this.goWhy || !this.travelEl) return;
    const m = distanceTo(d);
    this.travelEl.textContent = d.zone !== ctx.here ? 'Another system: the loading screen comes between.' : m === null ? 'In this system.' : `In this system, ${distanceText(m)}.`;
    let why: string | null;
    try {
      why = ctx.why(d);
    } catch (err) {
      why = 'the jump is not available';
      console.warn('hyperspace: why failed', err);
    }
    this.goButton.disabled = why !== null;
    this.goWhy.textContent = why ?? this.refusal ?? '';
  }

  private pickSystem(id: string): void {
    if (id === this.system) return;
    this.system = id;
    this.pick = null;
    this.refusal = null;
    this.render();
  }

  private pickDestination(key: string): void {
    if (key === this.pick) return;
    this.pick = key;
    this.refusal = null;
    this.render();
  }

  private jump(): void {
    const d = this.picked();
    if (!d || !this.goButton || this.goButton.disabled) return;
    this.onJump(d);
  }

  /** Up and down move in the points, left and right between systems, Enter presses Hyperspace; only while open. */
  private onKey(e: KeyboardEvent): void {
    if (!this.open || !this.catalogue) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    const cat = this.catalogue;
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
      const list = this.systemOf(this.system)?.destinations ?? [];
      if (!list.length) return;
      const i = list.findIndex((d) => d.key === this.pick);
      const next = e.code === 'ArrowUp' ? Math.max(0, i - 1) : Math.min(list.length - 1, i + 1);
      this.pickDestination(list[next].key);
    } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      const i = cat.systems.findIndex((s) => s.id === this.system);
      const next = e.code === 'ArrowLeft' ? Math.max(0, i - 1) : Math.min(cat.systems.length - 1, i + 1);
      if (cat.systems[next]) this.pickSystem(cat.systems[next].id);
    } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      this.jump();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }
}
