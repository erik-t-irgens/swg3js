// The NPC tab of the spawner (B): the blaster turrets and the planet's creatures, stood in front
// of the player on demand rather than around the arrival point, with counts and a Remove all each.
import { SPAWNER_TABS, tabStrip, wireTabs } from './tabs';
import { escapeHtml, groupHtml } from './catalogue';

export interface NpcKind {
  id: string;
  label: string;
  blurb: string;
  /** How many stand on the world now. */
  count: () => number;
  /** Stand one ahead of the player; returns a line for the prompt. */
  spawn: () => string;
  /** Take every one away; returns how many. */
  clear: () => number;
}

export class NpcUi {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly count: HTMLElement;
  private kinds: NpcKind[] = [];
  open = false;
  /** A click on another tab: the game swaps the panels. */
  onTab: (id: string) => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'npcs';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="wardrobe-panel">
        <div class="wardrobe-header">
          ${tabStrip(SPAWNER_TABS, 'npcs')}
          <span class="count"></span>
          <button class="close">Close <b>B</b></button>
        </div>
        <div class="wardrobe-main"><div class="wardrobe-body weapons-body"></div></div>
      </div>`;
    parent.appendChild(this.root);
    this.body = this.root.querySelector('.weapons-body')!;
    this.count = this.root.querySelector('.count')!;
    this.root.querySelector('.close')!.addEventListener('click', () => this.hide());
    wireTabs(this.root, 'npcs', (id) => this.onTab(id));
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.hide();
    });
  }

  attach(kinds: NpcKind[]): void {
    this.kinds = kinds;
    this.render();
  }

  render(): void {
    const items = this.kinds.map((k) => {
      const n = k.count();
      return `<div class="cat-item${n ? ' held' : ''}" title="${escapeHtml(k.blurb)}"><span class="cat-name">${escapeHtml(k.label)} <small>${escapeHtml(k.blurb)}</small></span><span class="cat-hands">${n ? `<span class="cat-badge">${n} out</span>` : ''}<button data-spawn="${k.id}" title="stand one ahead of you">spawn</button>${n ? `<button data-clear="${k.id}" title="take every one away">clear</button>` : ''}</span></div>`;
    });
    this.body.innerHTML = groupHtml('npcs', 'NPCs', this.kinds.length, 'stood ahead of you, facing you; none appear on their own', true, items.join(''));
    this.count.textContent = `${this.kinds.reduce((n, k) => n + k.count(), 0) || 'none'} on the world`;
    for (const b of this.body.querySelectorAll<HTMLButtonElement>('button[data-spawn]')) {
      b.addEventListener('click', () => {
        const k = this.kinds.find((x) => x.id === b.dataset.spawn);
        if (k) this.count.textContent = k.spawn();
        this.render();
      });
    }
    for (const b of this.body.querySelectorAll<HTMLButtonElement>('button[data-clear]')) {
      b.addEventListener('click', () => {
        const k = this.kinds.find((x) => x.id === b.dataset.clear);
        if (k) this.count.textContent = `${k.clear()} removed`;
        this.render();
      });
    }
  }

  show(): void {
    this.open = true;
    this.root.classList.remove('hidden');
    this.render();
  }

  hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
  }

  toggle(): boolean {
    if (this.open) this.hide();
    else this.show();
    return this.open;
  }
}
