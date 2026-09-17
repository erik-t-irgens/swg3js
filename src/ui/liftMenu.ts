// The lift menu: E in a lift shaft lists the levels the shaft reaches (its doorways, and those
// of the shafts it opens into), one button each, the current one marked; a pick rides there,
// the number keys pick too. The shafts in the game had no car in the model, so the ride is the
// step out through the doorway of the level picked.

export interface LiftChoice {
  label: string;
  current: boolean;
}

export class LiftMenu {
  readonly root: HTMLElement;
  onClose: () => void = () => {};
  onPick: (index: number) => void = () => {};
  private choices: LiftChoice[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'lift';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="ship-panel">
        <div class="ship-header">
          <h2>Lift</h2>
          <span class="ship-title"></span>
          <button class="close">Close (Esc)</button>
        </div>
        <div class="ship-body">
          <div class="lift-stops"></div>
          <p class="menu-hint">The levels this shaft reaches, by the rooms they open into; the number keys pick as well.</p>
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

  show(title: string, choices: LiftChoice[]): void {
    this.choices = choices;
    this.root.querySelector('.ship-title')!.textContent = title;
    const list = this.root.querySelector<HTMLElement>('.lift-stops')!;
    // Top floor first, the way a lift's panel reads.
    list.innerHTML = choices
      .map((c, i) => `<div class="ship-action"><button data-stop="${i}"${c.current ? ' disabled' : ''}>${i + 1}. ${c.label}</button><span class="why">${c.current ? 'here' : ''}</span></div>`)
      .reverse()
      .join('');
    for (const b of list.querySelectorAll<HTMLButtonElement>('button[data-stop]')) b.addEventListener('click', () => this.onPick(Number(b.dataset.stop)));
    this.root.classList.remove('hidden');
  }

  /** A number key while open: the stop with that number, if there is one and it is not the current. */
  pickKey(n: number): boolean {
    const c = this.choices[n - 1];
    if (!c || c.current) return false;
    this.onPick(n - 1);
    return true;
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
