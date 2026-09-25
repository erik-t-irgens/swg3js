// The row under the world while an instrument is in your hands: which song, whether it is playing,
// and the eight flourishes.
//
// It is here because nothing else on the screen has room for it and because an instrument wants its
// own controls: the number keys are the ability slots and the emote wheel is the emote wheel, so a
// row of its own is the honest answer. It appears only while an instrument is held.
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
#band-bar .note { font-size: 11px; color: var(--muted); min-height: 1.2em; }
`;

let styled = false;
function installStyle(): void {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = BAND_BAR_CSS;
  document.head.appendChild(style);
}

export class BandBar {
  readonly root: HTMLElement;
  /** A step through the songs this instrument has a part in. */
  onSong: (step: number) => void = () => {};
  /** Start, or stop. */
  onPlay: () => void = () => {};
  /** One of the eight. */
  onFlourish: (n: number) => void = () => {};

  private readonly what: HTMLElement;
  private readonly note: HTMLElement;
  private readonly play: HTMLButtonElement;
  private readonly flourishes: HTMLButtonElement[] = [];
  private last = '';
  writes = 0;

  constructor(parent: HTMLElement) {
    installStyle();
    this.root = document.createElement('div');
    this.root.id = 'band-bar';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="note"></div>
      <div class="row">
        <button class="prev" title="the song before">&#9664;</button>
        <span class="what"></span>
        <button class="next" title="the song after">&#9654;</button>
        <button class="play">Play</button>
      </div>
      <div class="row flourishes">${Array.from({ length: 8 }, (_, i) => `<button data-f="${i + 1}" title="flourish ${i + 1}">${i + 1}</button>`).join('')}</div>`;
    parent.appendChild(this.root);
    this.what = this.root.querySelector('.what')!;
    this.note = this.root.querySelector('.note')!;
    this.play = this.root.querySelector('.play')!;
    this.root.querySelector('.prev')!.addEventListener('click', () => this.onSong(-1));
    this.root.querySelector('.next')!.addEventListener('click', () => this.onSong(1));
    this.play.addEventListener('click', () => this.onPlay());
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-f]')) {
      this.flourishes.push(b);
      b.addEventListener('click', () => this.onFlourish(Number(b.dataset.f)));
    }
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /**
   * What the row says now, written only when it has changed: it is on the page and an instrument is
   * held for minutes at a time.
   *
   * `has` is which of the eight flourishes this song really wrote for this instrument, so a button
   * for one that does not exist is dead rather than silent.
   */
  show(song: string, playing: boolean, note: string, has: readonly number[]): void {
    this.root.hidden = false;
    const key = `${song}\0${playing}\0${note}\0${has.join(',')}`;
    if (key === this.last) return;
    this.last = key;
    this.writes++;
    this.what.textContent = song;
    this.note.textContent = note;
    this.play.textContent = playing ? 'Stop' : 'Play';
    this.play.className = playing ? 'play on' : 'play';
    for (const [i, b] of this.flourishes.entries()) b.disabled = !playing || !has.includes(i + 1);
  }

  hide(): void {
    this.root.hidden = true;
    this.last = '';
  }
}
