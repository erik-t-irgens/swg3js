// The row under the world while you are playing: which songs this instrument has a part in, which
// one is chosen, whether it is sounding, and the eight flourishes.
//
// It is a row and not a panel, which is the one decision here worth writing down. A panel joins
// `anyPanelOpen`, and while any panel is open the game does not simulate at all -- so a panel would
// take the mouse *and* stop the player walking, and would cut off the very number keys the
// flourishes are played on, since every key path in the frame loop that reads a digit sits inside
// the no-panel guard. The dances already play their flourishes on 1 to 8 while the player dances,
// with no panel anywhere, and this is that same arrangement.
//
// It is shown by the Start Playing ability rather than by holding an instrument: picking up a
// mandoviol should not put a row of controls on the screen.
//
// It builds its own element and says what was pressed; it knows nothing about songs, stems or the
// mixer. Every colour on it is one of the eighteen.

const BAND_BAR_CSS = `
#band-bar { position: fixed; left: 50%; transform: translateX(-50%); bottom: 96px; display: flex; flex-direction: column; align-items: center; gap: 5px; pointer-events: none; }
#band-bar[hidden] { display: none; }
#band-bar .row { display: flex; align-items: center; gap: 6px; pointer-events: auto; background: color-mix(in srgb, var(--plate) 70%, transparent); border: 1px solid var(--rule); border-radius: 4px; padding: 5px 9px; }
#band-bar .what { font-size: 12px; letter-spacing: 0.03em; color: var(--ink); min-width: 12em; text-align: center; }
#band-bar button { font: inherit; font-size: 11px; letter-spacing: 0.04em; color: var(--muted); background: var(--panel); border: 1px solid var(--rule); border-radius: 3px; padding: 3px 7px; cursor: pointer; }
#band-bar button:hover { color: var(--ink); border-color: var(--edge); }
#band-bar button.on { color: var(--good); border-color: color-mix(in srgb, var(--good) 60%, transparent); }
#band-bar button[disabled] { opacity: 0.4; cursor: default; }
#band-bar .flourishes button { min-width: 22px; padding: 3px 0; }
#band-bar .songs { flex-wrap: wrap; max-width: min(640px, 90vw); justify-content: center; }
#band-bar .songs button { min-width: 26px; padding: 3px 5px; }
#band-bar .songs button.on { color: var(--accent); border-color: var(--accent); }
#band-bar .note { font-size: 11px; color: var(--muted); min-height: 1.2em; }
#band-bar .keys { font-size: 10px; letter-spacing: 0.05em; color: var(--muted); opacity: 0.85; }
`;

let styled = false;
function installStyle(): void {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = BAND_BAR_CSS;
  document.head.appendChild(style);
}

/** What the row is told to show. Every field is already in words: it works nothing out itself. */
export interface BandModel {
  /** The instrument and the song chosen, in words. */
  what: string;
  /** Every song this instrument has a part in, by number, in the order they are offered. */
  songs: readonly number[];
  /** Which of them is chosen. */
  song: number;
  playing: boolean;
  /** Which of the eight this song really wrote for this instrument. */
  has: readonly number[];
  note: string;
  /** The key the Start Playing ability sits on, for the line that says how to stop. */
  key: string;
}

export class BandBar {
  readonly root: HTMLElement;
  /** A song picked by number. */
  onPick: (song: number) => void = () => {};
  /** Start, or stop. */
  onPlay: () => void = () => {};
  /** One of the eight. */
  onFlourish: (n: number) => void = () => {};

  private readonly what: HTMLElement;
  private readonly note: HTMLElement;
  private readonly keys: HTMLElement;
  private readonly songRow: HTMLElement;
  private readonly play: HTMLButtonElement;
  private readonly flourishes: HTMLButtonElement[] = [];
  private last = '';
  private songsShown = '';
  writes = 0;

  constructor(parent: HTMLElement) {
    installStyle();
    this.root = document.createElement('div');
    this.root.id = 'band-bar';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="note"></div>
      <div class="row songs"></div>
      <div class="row">
        <span class="what"></span>
        <button class="play">Play</button>
      </div>
      <div class="row flourishes">${Array.from({ length: 8 }, (_, i) => `<button data-f="${i + 1}" title="flourish ${i + 1}">${i + 1}</button>`).join('')}</div>
      <div class="keys"></div>`;
    parent.appendChild(this.root);
    this.what = this.root.querySelector('.what')!;
    this.note = this.root.querySelector('.note')!;
    this.keys = this.root.querySelector('.keys')!;
    this.songRow = this.root.querySelector('.songs')!;
    this.play = this.root.querySelector('.play')!;
    this.play.addEventListener('click', () => this.onPlay());
    // The song buttons are rebuilt when the list of songs changes and not otherwise, so a click
    // listener per button is made once per instrument rather than once a frame.
    this.songRow.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-song]');
      if (b) this.onPick(Number(b.dataset.song));
    });
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-f]')) {
      this.flourishes.push(b);
      b.addEventListener('click', () => this.onFlourish(Number(b.dataset.f)));
    }
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /**
   * What the row says now, written only when it has changed: it is on the page and stands there for
   * as long as somebody is playing.
   *
   * `has` is which of the eight flourishes this song really wrote for this instrument, so a button
   * for one that does not exist is dead rather than silent.
   */
  show(m: BandModel): void {
    this.root.hidden = false;
    const songs = m.songs.join(',');
    if (songs !== this.songsShown) {
      this.songsShown = songs;
      this.writes++;
      this.songRow.innerHTML = m.songs.map((n) => `<button type="button" data-song="${n}" title="song ${n}">${n}</button>`).join('') || '<span class="note">no song has a part for it</span>';
    }
    const key = `${m.what}\0${m.playing}\0${m.note}\0${m.has.join(',')}\0${m.song}\0${m.key}`;
    if (key === this.last) return;
    this.last = key;
    this.writes++;
    this.what.textContent = m.what;
    this.note.textContent = m.note;
    this.keys.textContent = m.playing ? `1 to 8 flourish · ${m.key} stops` : `pick a song, then Play · ${m.key} closes this`;
    this.play.textContent = m.playing ? 'Stop' : 'Play';
    this.play.className = m.playing ? 'play on' : 'play';
    for (const b of this.songRow.querySelectorAll<HTMLElement>('button[data-song]')) b.classList.toggle('on', Number(b.dataset.song) === m.song);
    for (const [i, b] of this.flourishes.entries()) b.disabled = !m.playing || !m.has.includes(i + 1);
  }

  hide(): void {
    this.root.hidden = true;
    this.last = '';
    this.songsShown = '';
  }
}
