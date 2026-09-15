// The ship menu: what a pilot or a passenger can do with the ship they are in that no key does.
// Aboard a multi-crew ship E takes and leaves the controls and steps out, so the way into space
// and back is chosen here, and the passengers' way off the ship in space. Docking will go here too.

/** Where the player stands with the ship, read afresh every half second while the menu is open. */
export interface ShipStatus {
  ship: string;
  role: 'pilot' | 'passenger';
  inSpace: boolean;
  flying: boolean;
  /** Metres over the ground, on a planet. */
  altitude: number | null;
  /** The height over the ground from which space is reached. */
  gateHeight: number;
  /** The orbit over this planet, when it has one. */
  spaceName: string | null;
  /** The planet under this orbit, in space. */
  planetName: string | null;
  /** km/h. */
  speed: number;
}

export interface ShipSource {
  status(): ShipStatus | null;
  goToSpace(): void;
  land(): void;
  eject(): void;
}

export class ShipMenu {
  readonly root: HTMLElement;
  onClose: () => void = () => {};
  private timer: number | null = null;
  private readonly title: HTMLElement;
  private readonly status: HTMLElement;
  private readonly rows: Record<'space' | 'land' | 'eject', { button: HTMLButtonElement; why: HTMLElement }>;

  constructor(parent: HTMLElement, private readonly source: ShipSource, private readonly keyLabel: () => string) {
    this.root = document.createElement('div');
    this.root.id = 'ship';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="ship-panel">
        <div class="ship-header">
          <h2>Ship</h2>
          <span class="ship-title"></span>
          <button class="close">Close</button>
        </div>
        <div class="ship-body">
          <p class="ship-status"></p>
          <div class="ship-action"><button data-do="space">Go to space</button><span class="why"></span></div>
          <div class="ship-action"><button data-do="land">Land</button><span class="why"></span></div>
          <div class="ship-action"><button data-do="eject">Eject</button><span class="why"></span></div>
          <div class="ship-action"><button disabled>Dock</button><span class="why">not built yet: two ships alongside in space, and a way across between them</span></div>
          <p class="menu-hint">The ship holds still while this is open. Everyone aboard goes with the ship into space and back, standing where they stood.</p>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.title = this.root.querySelector('.ship-title')!;
    this.status = this.root.querySelector('.ship-status')!;
    const row = (key: 'space' | 'land' | 'eject') => {
      const button = this.root.querySelector<HTMLButtonElement>(`button[data-do="${key}"]`)!;
      return { button, why: button.parentElement!.querySelector<HTMLElement>('.why')! };
    };
    this.rows = { space: row('space'), land: row('land'), eject: row('eject') };
    this.rows.space.button.addEventListener('click', () => this.source.goToSpace());
    this.rows.land.button.addEventListener('click', () => this.source.land());
    this.rows.eject.button.addEventListener('click', () => this.source.eject());
    this.root.querySelector('.close')!.addEventListener('click', () => this.onClose());
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(): void {
    this.root.classList.remove('hidden');
    this.root.querySelector('.close')!.textContent = `Close (${this.keyLabel()})`;
    this.update();
    if (this.timer === null) this.timer = window.setInterval(() => this.update(), 500);
  }

  hide(): void {
    this.root.classList.add('hidden');
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** The buttons that can be pressed now, and why the others cannot. */
  private update(): void {
    const s = this.source.status();
    const set = (key: 'space' | 'land' | 'eject', label: string, why: string | null) => {
      const r = this.rows[key];
      r.button.textContent = label;
      r.button.disabled = why !== null;
      r.why.textContent = why ?? '';
    };
    if (!s) {
      this.title.textContent = '';
      this.status.textContent = 'Not in a ship.';
      set('space', 'Go to space', 'not in a ship');
      set('land', 'Land', 'not in a ship');
      set('eject', 'Eject', 'not in a ship');
      return;
    }
    this.title.textContent = `${s.ship} · ${s.role === 'pilot' ? 'at the controls' : 'aboard as a passenger'}`;
    this.status.textContent = s.inSpace
      ? `In orbit over ${s.planetName ?? 'nothing'} · ${s.speed} km/h`
      : `${s.flying ? 'Flying' : 'Hovering'} ${s.altitude !== null ? `${Math.round(s.altitude)} m over the ground` : ''} · ${s.speed} km/h${s.spaceName ? ` · space is reached above ${s.gateHeight} m` : ''}`;
    const pilotOnly = s.role === 'pilot' ? null : "the pilot's call";
    set(
      'space',
      s.spaceName ? `Go to space: ${s.spaceName}` : 'Go to space',
      s.inSpace ? 'already in space' : !s.spaceName ? 'this world has no orbit to go to' : (pilotOnly ?? (s.altitude !== null && s.altitude >= s.gateHeight && s.flying ? null : `climb above ${s.gateHeight} m over the ground first`)),
    );
    set('land', s.planetName ? `Land on ${s.planetName}` : 'Land', !s.inSpace ? 'only from space; on a planet the ship lands where it is flown' : (pilotOnly ?? (s.planetName ? null : 'no planet below')));
    set(
      'eject',
      s.planetName ? (s.role === 'pilot' ? `Eject to ${s.planetName}, leaving the ship` : `Eject to ${s.planetName}`) : 'Eject',
      !s.inSpace ? 'only in space: on a planet, step out' : s.planetName ? null : 'no planet below',
    );
  }
}
