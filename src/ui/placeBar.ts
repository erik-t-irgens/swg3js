// The row under the world in the creator: which place the character is standing in, and at what
// hour of that place's day.
//
// The hour is a slider over the whole day with a clock beside it and a play button, by the owner's
// decision: the first cut offered only the captured hours, because night shows no face, and the owner
// wanted the day itself. The sixty-seven captured hours are not thrown away -- each was chosen by
// standing there and looking -- so they are marks on the slider and small buttons beside it, one click
// from wherever the slider has been dragged. The arithmetic is `placeClock.ts`.
//
// A place opens with the day stopped on its captured hour. Dragging stops it too and moves it; play
// lets it run at the day's own rate, and the thumb follows it, written only when it has moved a whole
// step, so a running day costs the page a write every couple of seconds and a stopped one costs none.
// When a drag has rested a moment the bar says so (`onSettle`), and the reflections are taken again
// rather than waiting out their own clock.
//
// It builds its own element and says what was picked. It knows nothing about worlds, cameras or
// characters, so the screen can place it anywhere and a test can drive it with no game at all.

import { hourLabel } from '../world/scenePlaces.ts';
import { PLACE_CLOCK_TUNE, capturedAt, clockText, hourTicks, snapHour, thumbMoved, wrapHour } from './placeClock.ts';

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
#place-bar .play { min-width: 2.6em; }
#place-bar .hour-range { width: min(320px, 40vw); accent-color: var(--accent); }
#place-bar .hour-range[disabled] { opacity: 0.45; }
#place-bar .clock { font-size: 12px; letter-spacing: 0.06em; color: var(--ink); min-width: 3.4em; font-variant-numeric: tabular-nums; }
#place-bar .hour-list { display: inline-flex; gap: 4px; flex-wrap: wrap; }
#place-bar .hour-list button { padding: 2px 7px; font-size: 10px; }
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

/** The play button's two faces: the glyph that starts the day, and the one that stops it. */
const PLAY_GLYPH = '▶';
const PAUSE_GLYPH = '❚❚';

/**
 * The row itself. `onPlace` is asked for a whole different place, which costs a world load;
 * `onHour` only moves the clock, which costs nothing, and that difference is why they are two
 * callbacks and not one.
 */
export class PlaceBar {
  readonly element: HTMLElement = document.createElement('div');
  /** The day was let run (true) or stopped (false) from the play button. */
  onPlay: (playing: boolean) => void = () => {};
  /** A drag on the hour has rested, or a captured hour was picked: the sky has settled where it was put. */
  onSettle: () => void = () => {};
  /** How many times the page was written to by a running day, for the console. */
  writes = 0;
  private places: BarPlace[] = [];
  private at = -1;
  private hour = 12;
  private playing = false;
  private busy = false;
  /** The hour the thumb was last written at by a running day, so a frame that changes nothing writes nothing. */
  private written = Number.NaN;
  private settleTimer = 0;
  private readonly onPlace: (key: string) => void;
  private readonly onHour: (hour: number) => void;
  private readonly placesRow: HTMLElement;
  private readonly hoursRow: HTMLElement;
  private readonly range: HTMLInputElement;
  private readonly ticks: HTMLDataListElement;
  private readonly clock: HTMLElement;
  private readonly play: HTMLButtonElement;

  // Written out rather than declared in the argument list, as every file a node test may one day reach is.
  constructor(onPlace: (key: string) => void, onHour: (hour: number) => void) {
    this.onPlace = onPlace;
    this.onHour = onHour;
    installStyle();
    this.element.id = 'place-bar';
    this.element.hidden = true;
    const step = (PLACE_CLOCK_TUNE.stepMinutes / 60).toFixed(6);
    this.element.innerHTML = `
      <div class="row"><span class="what">Place</span><span class="place-list"></span></div>
      <div class="row"><span class="what">Hour</span>
        <button type="button" class="play" title="let the day run, or stop it" aria-pressed="false">${PLAY_GLYPH}</button>
        <input type="range" class="hour-range" min="0" max="24" step="${step}" value="12" list="place-bar-hours" aria-label="time of day" />
        <datalist id="place-bar-hours"></datalist>
        <span class="clock">12:00</span>
        <span class="hour-list"></span>
      </div>`;
    this.placesRow = this.element.querySelector('.place-list') as HTMLElement;
    this.hoursRow = this.element.querySelector('.hour-list') as HTMLElement;
    this.range = this.element.querySelector('.hour-range') as HTMLInputElement;
    this.ticks = this.element.querySelector('#place-bar-hours') as HTMLDataListElement;
    this.clock = this.element.querySelector('.clock') as HTMLElement;
    this.play = this.element.querySelector('.play') as HTMLButtonElement;
    // A hand on the hour stops the day where it is put, and the sky goes there on the next frame.
    this.range.addEventListener('input', () => {
      if (this.busy) return;
      // The thumb is where the hand put it and is not written back (24 would read back as 0 and jump
      // the thumb to the far end under the pointer).
      this.takeHour(wrapHour(Number(this.range.value)), false);
      window.clearTimeout(this.settleTimer);
      this.settleTimer = window.setTimeout(() => this.onSettle(), PLACE_CLOCK_TUNE.settleMs);
    });
    this.play.addEventListener('click', () => {
      if (this.busy) return;
      this.setPlaying(!this.playing);
      this.onPlay(this.playing);
    });
  }

  /** What the bar offers, and which of them is up now. */
  setPlaces(places: BarPlace[], showing: string | null): void {
    this.places = places;
    this.at = places.findIndex((p) => p.key === showing);
    this.element.hidden = places.length === 0;
    this.draw();
  }

  /**
   * Which hour the day is at. Told rather than assumed, because the screen may open on the middle
   * of a place's day and the bar has no business deciding that for it.
   */
  setHour(hour: number): void {
    this.hour = wrapHour(hour);
    this.writeThumb();
    this.markCaptured();
  }

  /** Whether the day is running, as the play button shows it. Nothing is said back. */
  setPlaying(on: boolean): void {
    this.playing = on;
    this.play.textContent = on ? PAUSE_GLYPH : PLAY_GLYPH;
    this.play.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  /**
   * A running day, every frame: the thumb and the clock follow it, written only when it has moved a
   * whole step, so most frames write nothing at all.
   */
  follow(hour: number): void {
    if (!this.playing) return;
    if (!thumbMoved(this.written, hour)) return;
    this.hour = wrapHour(hour);
    this.writeThumb();
    this.markCaptured();
    this.writes++;
  }

  /**
   * A world is loading. The whole row goes dead rather than the one button pressed: a second place
   * asked for while the first is still building would load two worlds over each other.
   */
  setBusy(busy: boolean): void {
    this.busy = busy;
    this.draw();
  }

  /** An hour taken by hand: the slider, a captured hour's button, or the console. */
  takeHour(hour: number, moveThumb = true): void {
    this.hour = wrapHour(hour);
    this.setPlaying(false);
    this.writeThumb(moveThumb);
    this.markCaptured();
    this.onHour(this.hour);
  }

  private writeThumb(moveThumb = true): void {
    this.written = this.hour;
    if (moveThumb) {
      const snapped = snapHour(this.hour);
      if (Number(this.range.value) !== snapped) this.range.value = String(snapped);
    }
    const text = clockText(this.hour);
    if (this.clock.textContent !== text) this.clock.textContent = text;
  }

  /** The captured hour the clock is standing on, lit; none between them. */
  private markCaptured(): void {
    const here = this.places[this.at];
    const lit = here ? capturedAt(here.hours, this.hour) : -1;
    this.hoursRow.querySelectorAll('button').forEach((b, i) => {
      const want = i === lit ? 'true' : 'false';
      if (b.getAttribute('aria-pressed') !== want) b.setAttribute('aria-pressed', want);
    });
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
    // The captured hours: marks on the slider and a button each, so the owner's own judgement is
    // one click from wherever the slider has been dragged.
    this.ticks.textContent = '';
    for (const h of hourTicks(here?.hours ?? [])) {
      const o = document.createElement('option');
      o.value = String(h);
      this.ticks.appendChild(o);
    }
    this.hoursRow.textContent = '';
    for (const h of here?.hours ?? []) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = hourLabel(h.name, here!.key, h.hour);
      b.title = clockText(h.hour);
      b.disabled = this.busy;
      b.addEventListener('click', () => {
        if (this.busy) return;
        this.takeHour(h.hour);
        // A jump rather than a drag: the sky is where it was put at once.
        window.clearTimeout(this.settleTimer);
        this.onSettle();
      });
      this.hoursRow.appendChild(b);
    }
    this.range.disabled = this.busy;
    // The step as it stands now, so the console's knob reaches the slider the next time a place is drawn.
    this.range.step = (Math.max(1, PLACE_CLOCK_TUNE.stepMinutes) / 60).toFixed(6);
    this.play.disabled = this.busy;
    this.writeThumb();
    this.markCaptured();
  }

  /** What is on the row now, for the console. */
  describe(): { place: string | null; hour: string | null; clock: string; playing: boolean; places: number; hours: number; busy: boolean; writes: number } {
    const here = this.places[this.at];
    const i = here ? capturedAt(here.hours, this.hour) : -1;
    const h = i >= 0 ? here!.hours[i] : null;
    return {
      place: here?.key ?? null,
      hour: h ? hourLabel(h.name, here!.key, h.hour) : null,
      clock: clockText(this.hour),
      playing: this.playing,
      places: this.places.length,
      hours: here?.hours.length ?? 0,
      busy: this.busy,
      writes: this.writes,
    };
  }
}
