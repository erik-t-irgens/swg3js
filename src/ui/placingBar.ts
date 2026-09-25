// The row under the world while a building is being placed: what is in hand, which way it faces,
// how far it has been lifted, whether the ground will take it, and the keys that move it.
//
// It is the only thing on the screen during a placement, because everything else about placing is
// the ghost itself: the outline on the ground says where, its colour says whether, and this says
// why not in words and names the keys.
//
// **The keys are the way in and the buttons are the second way.** While the game holds the pointer
// lock there is no cursor to click a button with, so each of the four carries the cap of the key
// that does the same thing and a player never has to find the mouse. The buttons still work for
// anybody whose pointer is free, which is why they are here at all.
//
// It builds its own element and says what was pressed. It knows nothing about deeds, worlds or
// ghosts, so a test can drive it with no game at all. Every colour on it is one of the eighteen.

const PLACING_BAR_CSS = `
#placing-bar { position: fixed; left: 50%; transform: translateX(-50%); bottom: 96px; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 0 18px; pointer-events: none; }
#placing-bar[hidden] { display: none; }
#placing-bar .row { display: flex; align-items: center; gap: 8px; pointer-events: auto; background: color-mix(in srgb, var(--plate) 70%, transparent); border: 1px solid var(--rule); border-radius: 4px; padding: 6px 10px; }
#placing-bar .what { font-size: 12px; letter-spacing: 0.04em; color: var(--ink); }
#placing-bar .why { font-size: 11px; letter-spacing: 0.03em; color: var(--muted); min-height: 1.2em; text-align: center; pointer-events: none; }
#placing-bar .why.bad { color: var(--bad); }
#placing-bar .why.good { color: var(--good); }
#placing-bar .lift { font-size: 11px; letter-spacing: 0.04em; color: var(--accent); min-width: 3.6em; text-align: center; }
#placing-bar button { font: inherit; font-size: 11px; letter-spacing: 0.05em; color: var(--muted); background: var(--panel); border: 1px solid var(--rule); border-radius: 3px; padding: 4px 9px; cursor: pointer; }
#placing-bar button:hover { color: var(--ink); border-color: var(--edge); }
#placing-bar button .cap { color: var(--ink); opacity: 0.75; }
#placing-bar button.go { color: var(--good); border-color: color-mix(in srgb, var(--good) 60%, transparent); }
#placing-bar button.go[disabled] { color: var(--muted); border-color: var(--rule); }
#placing-bar button[disabled] { opacity: 0.45; cursor: default; }
`;

let styled = false;
function installStyle(): void {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = PLACING_BAR_CSS;
  document.head.appendChild(style);
}

/** What the four keys are called just now. The bar spells them; it never decides them. */
export interface PlacingKeys {
  left: string;
  right: string;
  up: string;
  down: string;
}

export class PlacingBar {
  readonly root: HTMLElement;
  onTurn: (presses: number) => void = () => {};
  onLift: (presses: number) => void = () => {};
  onPlace: () => void = () => {};
  onCancel: () => void = () => {};

  private readonly what: HTMLElement;
  private readonly why: HTMLElement;
  private readonly lift: HTMLElement;
  private readonly go: HTMLButtonElement;
  private readonly caps: Record<keyof PlacingKeys, HTMLElement>;
  /** What was last written, so a frame that changes nothing writes nothing. */
  private last = '';
  /** How many times the page was written to, for `__debug.hud`'s own counting. */
  writes = 0;

  constructor(parent: HTMLElement) {
    installStyle();
    this.root = document.createElement('div');
    this.root.id = 'placing-bar';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="why"></div>
      <div class="row">
        <button class="turn-left" title="turn it left">&#9664; <span class="cap cap-left"></span></button>
        <button class="lift-down" title="lower it">&#9660; <span class="cap cap-down"></span></button>
        <span class="lift"></span>
        <button class="lift-up" title="raise it">&#9650; <span class="cap cap-up"></span></button>
        <span class="what"></span>
        <button class="turn-right" title="turn it right"><span class="cap cap-right"></span> &#9654;</button>
        <button class="go">Place</button>
        <button class="cancel">Cancel (Esc)</button>
      </div>`;
    parent.appendChild(this.root);
    this.what = this.root.querySelector('.what')!;
    this.why = this.root.querySelector('.why')!;
    this.lift = this.root.querySelector('.lift')!;
    this.go = this.root.querySelector('.go')!;
    this.caps = {
      left: this.root.querySelector('.cap-left')!,
      right: this.root.querySelector('.cap-right')!,
      up: this.root.querySelector('.cap-up')!,
      down: this.root.querySelector('.cap-down')!,
    };
    this.root.querySelector('.turn-left')!.addEventListener('click', () => this.onTurn(-1));
    this.root.querySelector('.turn-right')!.addEventListener('click', () => this.onTurn(1));
    this.root.querySelector('.lift-up')!.addEventListener('click', () => this.onLift(1));
    this.root.querySelector('.lift-down')!.addEventListener('click', () => this.onLift(-1));
    this.go.addEventListener('click', () => this.onPlace());
    this.root.querySelector('.cancel')!.addEventListener('click', () => this.onCancel());
  }

  get open(): boolean {
    return !this.root.hidden;
  }

  /**
   * What the bar says now. Written only when it has changed, because a placement moves every frame
   * the mouse does and the bar is on the page rather than on the overlay canvas.
   */
  show(name: string, ok: boolean, why: string | null, keys?: PlacingKeys, lift = 0): void {
    this.root.hidden = false;
    const k = keys ?? { left: '', right: '', up: '', down: '' };
    const height = lift === 0 ? 'on the ground' : `${lift > 0 ? '+' : ''}${lift.toFixed(2)} m`;
    const key = `${name}\0${ok}\0${why ?? ''}\0${k.left}${k.right}${k.up}${k.down}\0${height}`;
    if (key === this.last) return;
    this.last = key;
    this.writes++;
    this.what.textContent = name;
    this.why.textContent = ok ? 'the ground will take it' : (why ?? 'not here');
    this.why.className = `why ${ok ? 'good' : 'bad'}`;
    this.lift.textContent = height;
    for (const which of ['left', 'right', 'up', 'down'] as (keyof PlacingKeys)[]) this.caps[which].textContent = k[which];
    this.go.disabled = !ok;
  }

  hide(): void {
    this.root.hidden = true;
    this.last = '';
  }
}
