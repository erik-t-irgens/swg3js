// The ship menu: what a pilot or a passenger can do with the ship they are in that no key does.
// Aboard a multi-crew ship E takes and leaves the controls and steps out, so the way into space
// and back is chosen here, and the passengers' way off the ship in space; the pilot's jump to
// hyperspace starts here (the System Map) and is cancelled here during its countdown; a station's
// dock is asked for and left here, and where there is one, the ultra cruise is switched on here.
//
// The menu itself knows nothing about any of them: every row is a label, a reason it cannot be
// pressed and a line of its own from `ShipStatus`, and one call back on `ShipSource`.

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
  /** The system's own name, in space ("Kessel System", "Deep Space"): what the status line says where there is no planet below. */
  zoneName?: string | null;
  /**
   * The hyperspace row: why a jump cannot be picked now (null when the System Map may be opened), the
   * countdown's words while one counts down (the row then cancels it), and whether a jump is running.
   */
  jump?: { canJump: string | null; counting: string | null; busy: boolean };
  /**
   * The docking row: what the button says now (Dock at a named station, Launch, Break off), why it
   * cannot be pressed, and a line about what is happening. Absent while nothing can dock at all.
   */
  dock?: DockRow;
  /** The ultra cruise row, filled by whatever owns the cruise; absent where there is none. */
  cruise?: DockRow;
  /** km/h. */
  speed: number;
}

/** A row that names itself: what the button says, why it is dead, and a line under it. */
export interface DockRow {
  label: string;
  why: string | null;
  note: string | null;
}

/**
 * The ultra cruise, as the ship menu asks for it. Whatever owns the cruise sets one of these on the
 * game; without one the row says the cruise is not built.
 */
export interface ShipCruise {
  /** What the row says now: its label, and why it cannot be pressed. */
  available(): DockRow;
  /** The row was pressed: start the cruise, or let go of it. */
  toggle(): void;
}

export interface ShipSource {
  status(): ShipStatus | null;
  goToSpace(): void;
  land(): void;
  eject(): void;
  /** The hyperspace row: opens the System Map, or cancels a countdown. */
  hyperspace?(): void;
  /** The docking row: ask for a dock, leave one, or break off a lane, whichever the row offers. */
  dock?(): void;
  /** The cruise row. */
  cruise?(): void;
}

type Row = 'space' | 'land' | 'eject' | 'hyperspace' | 'dock' | 'cruise';

export class ShipMenu {
  readonly root: HTMLElement;
  onClose: () => void = () => {};
  private timer: number | null = null;
  private readonly title: HTMLElement;
  private readonly status: HTMLElement;
  private readonly rows: Record<Row, { button: HTMLButtonElement; why: HTMLElement }>;

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
          <div class="ship-action"><button data-do="hyperspace">Hyperspace…</button><span class="why"></span></div>
          <div class="ship-action"><button data-do="dock">Dock</button><span class="why"></span></div>
          <div class="ship-action"><button data-do="cruise">Cruise</button><span class="why"></span></div>
          <p class="menu-hint">The ship holds still while this is open. Everyone aboard goes with the ship into space and back, standing where they stood. Hyperspace jumps to a point, a station or a planet's launch point, in this system or another. Docking flies the ship in along the station's own lane and puts it right, free; touching the controls breaks it off.</p>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.title = this.root.querySelector('.ship-title')!;
    this.status = this.root.querySelector('.ship-status')!;
    const row = (key: Row) => {
      const button = this.root.querySelector<HTMLButtonElement>(`button[data-do="${key}"]`)!;
      return { button, why: button.parentElement!.querySelector<HTMLElement>('.why')! };
    };
    this.rows = { space: row('space'), land: row('land'), eject: row('eject'), hyperspace: row('hyperspace'), dock: row('dock'), cruise: row('cruise') };
    this.rows.space.button.addEventListener('click', () => this.source.goToSpace());
    this.rows.land.button.addEventListener('click', () => this.source.land());
    this.rows.eject.button.addEventListener('click', () => this.source.eject());
    // A press cancels a countdown, which changes the row at once rather than at the next half-second read.
    this.rows.hyperspace.button.addEventListener('click', () => {
      this.source.hyperspace?.();
      if (this.open) this.update();
    });
    // Docking and the cruise change what their own row says the moment they are pressed, as the jump does.
    for (const key of ['dock', 'cruise'] as const) {
      this.rows[key].button.addEventListener('click', () => {
        this.source[key]?.();
        if (this.open) this.update();
      });
    }
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
    const set = (key: Row, label: string, why: string | null) => {
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
      set('hyperspace', 'Hyperspace…', 'not in a ship');
      set('dock', 'Dock', 'not in a ship');
      set('cruise', 'Cruise', 'not in a ship');
      return;
    }
    this.title.textContent = `${s.ship} · ${s.role === 'pilot' ? 'at the controls' : 'aboard as a passenger'}`;
    // A system with no planet below (Kessel, Ord Mantell, Deep Space) is named for itself.
    this.status.textContent = s.inSpace
      ? `${s.planetName ? `In orbit over ${s.planetName}` : `In ${s.zoneName ?? 'space'}`} · ${s.speed} km/h`
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
    // The jump: the System Map to pick where, "Cancel the jump" while it counts down, nothing while it runs.
    const jump = s.jump ?? { canJump: s.inSpace ? (pilotOnly ?? 'not available in this build') : 'only in space', counting: null, busy: false };
    if (jump.busy) set('hyperspace', 'jumping', 'the jump is under way');
    else if (jump.counting !== null) {
      set('hyperspace', 'Cancel the jump', null);
      this.rows.hyperspace.why.textContent = jump.counting;
    } else set('hyperspace', 'Hyperspace…', jump.canJump);
    // The dock and the cruise say what they can do themselves; a row nobody filled says it is not built.
    const dock = s.dock ?? { label: 'Dock', why: 'not built in this world', note: null };
    set('dock', dock.label, dock.why);
    if (dock.why === null && dock.note) this.rows.dock.why.textContent = dock.note;
    const cruise = s.cruise ?? { label: 'Cruise', why: 'not built yet: a sandbox system to fly across at speed', note: null };
    set('cruise', cruise.label, cruise.why);
    if (cruise.why === null && cruise.note) this.rows.cruise.why.textContent = cruise.note;
  }
}
