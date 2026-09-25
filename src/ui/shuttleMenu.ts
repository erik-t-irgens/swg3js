// The shuttle menu: E at a starport or a shuttleport lists where a shuttle will take you and what
// the game charged for it, one button each, and the number keys pick too.
//
// Built exactly as the lift menu is, out of the ship panel's own classes and with no stylesheet of
// its own: every colour on it is one the game already uses, because it is the same panel.
//
// Which destinations there are, and what each costs, is `src/world/shuttle.ts` and the game's own
// tables; this only shows them.

export interface ShuttleChoice {
  label: string;
  /** What it costs, already in words. */
  fare: string;
  /** How far off it is, in words, for a place on this world; empty for another world. */
  away: string;
  /** Why it cannot be taken now, or empty. */
  why: string;
}

export class ShuttleMenu {
  readonly root: HTMLElement;
  onClose: () => void = () => {};
  onPick: (index: number) => void = () => {};
  private choices: ShuttleChoice[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'shuttle';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="ship-panel">
        <div class="ship-header">
          <h2>Shuttle</h2>
          <span class="ship-title"></span>
          <button class="close">Close (Esc)</button>
        </div>
        <div class="ship-body">
          <div class="shuttle-stops"></div>
          <p class="menu-hint">Where a shuttle will take you from here, at the fares the game charged; the number keys pick as well.</p>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.root.querySelector('.close')!.addEventListener('click', () => this.onClose());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.onClose();
    });
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(title: string, choices: ShuttleChoice[]): void {
    this.choices = choices;
    this.root.querySelector('.ship-title')!.textContent = title;
    const list = this.root.querySelector<HTMLElement>('.shuttle-stops')!;
    list.innerHTML = choices.length
      ? choices
          .map((c, i) => `<div class="ship-action"><button data-ride="${i}"${c.why ? ' disabled' : ''}>${i + 1}. ${c.label} &mdash; ${c.fare}</button><span class="why">${c.why || c.away}</span></div>`)
          .join('')
      : '<div class="ship-action"><span class="why">this port has nowhere to send you</span></div>';
    for (const b of list.querySelectorAll<HTMLButtonElement>('button[data-ride]')) b.addEventListener('click', () => this.onPick(Number(b.dataset.ride)));
    this.root.classList.remove('hidden');
  }

  /** A number key while open: the ride with that number, if there is one and it can be taken. */
  pickKey(n: number): boolean {
    const c = this.choices[n - 1];
    if (!c || c.why) return false;
    this.onPick(n - 1);
    return true;
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
