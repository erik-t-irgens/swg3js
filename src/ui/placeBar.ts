// The row under the world in the creator: which place the character is standing in, and at what
// hour of that place's day.
//
// The hours are the owner's own captures rather than a slider, which is deliberate. Every one of
// the sixty-seven was chosen by standing there and looking, and not one of them is at night: a free
// slider would offer a hundred times when a face cannot be seen at all, and would be handing the
// player a worse version of a judgement that has already been made.
//
// It builds its own element and says what was picked. It knows nothing about worlds, cameras or
// characters, so the screen can place it anywhere and a test can drive it with no game at all.

import { hourLabel } from '../world/scenePlaces.ts';

/** One place the bar can offer, as the scene manifest and the place's own file describe it. */
export interface BarPlace {
  key: string;
  /** What the world calls it, or null; the world's own name is the fallback. */
  place: string | null;
  pack: string;
  hours: { name: string; hour: number }[];
}

const PLACE_BAR_CSS = `
#place-bar { position: fixed; left: 0; bottom: 100px; display: flex; flex-direction: column; gap: 6px; padding: 0 18px; pointer-events: none; }
#place-bar[hidden] { display: none; }
#place-bar .row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; pointer-events: auto; }
#place-bar .what { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); min-width: 4.5em; }
#place-bar button { font: inherit; font-size: 11px; letter-spacing: 0.05em; color: var(--muted); background: var(--panel); border: 1px solid var(--rule); border-radius: 3px; padding: 4px 9px; cursor: pointer; }
#place-bar button:hover { color: var(--ink); border-color: var(--edge); }
#place-bar button[aria-pressed="true"] { color: var(--void); background: var(--accent); border-color: var(--accent); }
#place-bar button[disabled] { opacity: 0.45; cursor: default; }
`;

let styled = false;
function installStyle(): void {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = PLACE_BAR_CSS;
  document.head.appendChild(style);
}

/** A place's name for a button: what the world called it, else the world itself, tidied. */
export function placeName(p: BarPlace): string {
  if (p.place) return p.place;
  return p.pack.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The row itself. `onPlace` is asked for a whole different place, which costs a world load;
 * `onHour` only moves the clock, which costs nothing, and that difference is why they are two
 * callbacks and not one.
 */
export class PlaceBar {
  readonly element: HTMLElement = document.createElement('div');
  private places: BarPlace[] = [];
  private at = -1;
  private hourAt = 0;
  private busy = false;
  private readonly placesRow: HTMLElement;
  private readonly hoursRow: HTMLElement;

  constructor(
    private readonly onPlace: (key: string) => void,
    private readonly onHour: (hour: number) => void,
  ) {
    installStyle();
    this.element.id = 'place-bar';
    this.element.hidden = true;
    this.element.innerHTML = `
      <div class="row"><span class="what">Place</span><span class="place-list"></span></div>
      <div class="row"><span class="what">Hour</span><span class="hour-list"></span></div>`;
    this.placesRow = this.element.querySelector('.place-list') as HTMLElement;
    this.hoursRow = this.element.querySelector('.hour-list') as HTMLElement;
  }

  /** What the bar offers, and which of them is up now. */
  setPlaces(places: BarPlace[], showing: string | null): void {
    this.places = places;
    this.at = places.findIndex((p) => p.key === showing);
    this.hourAt = 0;
    this.element.hidden = places.length === 0;
    this.draw();
  }

  /**
   * Which hour is lit. Told rather than assumed, because the screen may open on the middle of a
   * place's day and the bar has no business deciding that for it.
   */
  setHour(hour: number): void {
    const p = this.places[this.at];
    if (!p) return;
    const i = p.hours.findIndex((h) => Math.abs(h.hour - hour) < 1e-6);
    if (i >= 0 && i !== this.hourAt) {
      this.hourAt = i;
      this.draw();
    }
  }

  /**
   * A world is loading. The whole row goes dead rather than the one button pressed: a second place
   * asked for while the first is still building would load two worlds over each other.
   */
  setBusy(busy: boolean): void {
    this.busy = busy;
    this.draw();
  }

  private draw(): void {
    const here = this.places[this.at];
    this.placesRow.textContent = '';
    for (const p of this.places) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = placeName(p);
      b.disabled = this.busy;
      b.setAttribute('aria-pressed', p.key === here?.key ? 'true' : 'false');
      b.addEventListener('click', () => {
        if (this.busy || p.key === this.places[this.at]?.key) return;
        this.onPlace(p.key);
      });
      this.placesRow.appendChild(b);
    }
    this.hoursRow.textContent = '';
    for (const [i, h] of (here?.hours ?? []).entries()) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = hourLabel(h.name, here!.key, h.hour);
      b.disabled = this.busy;
      b.setAttribute('aria-pressed', i === this.hourAt ? 'true' : 'false');
      b.addEventListener('click', () => {
        if (this.busy) return;
        this.hourAt = i;
        this.draw();
        this.onHour(h.hour);
      });
      this.hoursRow.appendChild(b);
    }
  }

  /** What is on the row now, for the console. */
  describe(): { place: string | null; hour: string | null; places: number; hours: number; busy: boolean } {
    const here = this.places[this.at];
    const h = here?.hours[this.hourAt];
    return { place: here?.key ?? null, hour: h ? hourLabel(h.name, here!.key, h.hour) : null, places: this.places.length, hours: here?.hours.length ?? 0, busy: this.busy };
  }
}
