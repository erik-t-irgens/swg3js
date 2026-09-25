// The row under the world while a building is being placed: what is in hand, which way it faces,
// whether the ground will take it, and the two buttons that turn it.
//
// It is the only thing on the screen during a placement, because everything else about placing is
// the ghost itself: the outline on the ground says where, its colour says whether, and this says
// why not in words and offers the turns, which have nowhere else to live.
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
#placing-bar button { font: inherit; font-size: 11px; letter-spacing: 0.05em; color: var(--muted); background: var(--panel); border: 1px solid var(--rule); border-radius: 3px; padding: 4px 9px; cursor: pointer; }
#placing-bar button:hover { color: var(--ink); border-color: var(--edge); }
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

export class PlacingBar {
  readonly root: HTMLElement;
  onTurn: (presses: number) => void = () => {};
  onPlace: () => void = () => {};
  onCancel: () => void = () => {};

  private readonly what: HTMLElement;
  private readonly why: HTMLElement;
  private readonly go: HTMLButtonElement;
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
        <button class="turn-left" title="turn it left">&#9664; turn</button>
        <span class="what"></span>
        <button class="turn-right" title="turn it right">turn &#9654;</button>
        <button class="go">Place</button>
        <button class="cancel">Cancel (Esc)</button>
      </div>`;
    parent.appendChild(this.root);
    this.what = this.root.querySelector('.what')!;
    this.why = this.root.querySelector('.why')!;
    this.go = this.root.querySelector('.go')!;
    this.root.querySelector('.turn-left')!.addEventListener('click', () => this.onTurn(-1));
    this.root.querySelector('.turn-right')!.addEventListener('click', () => this.onTurn(1));
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
  show(name: string, ok: boolean, why: string | null): void {
    this.root.hidden = false;
    const key = `${name}\0${ok}\0${why ?? ''}`;
    if (key === this.last) return;
    this.last = key;
    this.writes++;
    this.what.textContent = name;
    this.why.textContent = ok ? 'the ground will take it' : (why ?? 'not here');
    this.why.className = `why ${ok ? 'good' : 'bad'}`;
    this.go.disabled = !ok;
  }

  hide(): void {
    this.root.hidden = true;
    this.last = '';
  }
}
