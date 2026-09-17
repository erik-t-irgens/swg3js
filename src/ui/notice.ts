// One line over the game for work going on in the background that the player should know about:
// the Effects switch compiling every shader for the other path while the frames keep drawing the
// old way. Empty, it takes up nothing and catches no clicks.

export class Notice {
  private readonly el: HTMLElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'fx-notice';
    parent.appendChild(this.el);
  }

  set(text: string | null): void {
    this.el.textContent = text ?? '';
  }

  get text(): string {
    return this.el.textContent ?? '';
  }
}
