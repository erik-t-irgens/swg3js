// A small label at the top of the screen while the dev server's placement editor would keep what is put down
// for good: whenever the Props and Housing tabs' switch is on Permanent, or the thing in hand is going to one of
// the two files, even with nothing in hand. It says which file in the badge's own words, handed over by the
// game, so it carries none of its own; written to the page only when what it says changes. It is a child of
// `#ui` after the overlay canvas and has no stacking order of its own, so it paints over the canvas in tree
// order, as every panel does. Made only on the dev server.

const EDIT_CHIP_CSS = `
#edit-chip { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); padding: 2px 9px; font-size: 11px; letter-spacing: 0.1em; color: var(--accent); background: var(--panel); border: 1px solid color-mix(in srgb, var(--accent) 60%, transparent); border-radius: 3px; pointer-events: none; white-space: nowrap; }
#edit-chip[hidden] { display: none; }
`;

export class EditChip {
  readonly root: HTMLElement;
  private said: string | null = null;
  /** How many times the page was written to. */
  writes = 0;

  constructor(parent: HTMLElement) {
    const style = document.createElement('style');
    style.textContent = EDIT_CHIP_CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'edit-chip';
    this.root.hidden = true;
    parent.appendChild(this.root);
  }

  /** What it says, or null to stand aside: the page is written only when that changes. */
  show(text: string | null): void {
    if (text === this.said) return;
    this.said = text;
    this.writes++;
    this.root.hidden = text === null;
    this.root.textContent = text ?? '';
  }

  /** What it says now, or null. */
  get text(): string | null {
    return this.said;
  }
}
