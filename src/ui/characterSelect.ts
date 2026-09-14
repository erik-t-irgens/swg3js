// The first screen: the characters kept in this browser as cards, one to play, one to delete,
// and a way to make another while there is room for it.
import { MAX_CHARACTERS, prettySpecies, type SavedCharacter } from '../core/characters';
import { PLANETS } from '../data/planets';

export class CharacterSelect {
  readonly root: HTMLElement;
  private list: SavedCharacter[] = [];
  onPlay: (c: SavedCharacter) => void = () => {};
  onCreate: () => void = () => {};
  onDelete: (c: SavedCharacter) => void = () => {};

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'start';
    this.root.className = 'overlay';
    this.root.innerHTML = `
      <div class="start-panel select">
        <h1>SWG3JS</h1>
        <div class="sub">Star Wars Galaxies, rebuilt for the browser. Ten worlds, one very ambitious side project.</div>
        <div class="chars"></div>
        <div class="select-foot">
          <button class="create">Create new character</button>
          <span class="room"></span>
        </div>
        <div class="controls">
          <div><b>WASD</b> move · <b>Mouse</b> look · <b>Wheel</b> zoom (all the way in: first person) · <b>Space</b> jump · <b>Ctrl</b> crouch · <b>Shift</b> walk · <b>LMB</b> attack · <b>RMB</b> block or rapid fire · <b>I</b> inventory · <b>B</b> spawner · <b>M</b> galaxy map · <b>H</b> help · <b>Esc</b> release mouse</div>
        </div>
      </div>`;
    parent.appendChild(this.root);
    this.root.querySelector('.create')!.addEventListener('click', () => {
      if (this.list.length < MAX_CHARACTERS) this.onCreate();
    });
  }

  /** Show the list as it is now. */
  show(list: SavedCharacter[]): void {
    this.list = list;
    const box = this.root.querySelector<HTMLElement>('.chars')!;
    if (!list.length) {
      box.innerHTML = `<div class="chars-empty">No characters yet. Make one: pick a species, shape and dress it, and choose the world it starts on.</div>`;
    } else {
      box.innerHTML = list
        .map((c) => {
          const planet = PLANETS.find((p) => p.id === c.planet);
          const where = planet ? `${planet.name}${c.zone && planet.zones?.length ? `: ${planet.zones.find((z) => z.id === c.zone)?.name ?? c.zone}` : ''}` : c.planet;
          const cls = c.class === 'jedi' ? 'Jedi' : 'Bounty Hunter';
          return `<div class="char" data-id="${c.id}" tabindex="0">
            <div class="char-name">${escapeHtml(c.name)}</div>
            <div class="char-line">${prettySpecies(c.species)} · ${cls}</div>
            <div class="char-line muted">${where}${c.pos ? '' : ' · new'}</div>
            <div class="char-line muted small">${c.played ? `last played ${ago(c.played)}` : 'never played'}</div>
            <button class="delete" title="Delete this character">×</button>
          </div>`;
        })
        .join('');
    }
    for (const card of box.querySelectorAll<HTMLElement>('.char')) {
      const c = list.find((x) => x.id === card.dataset.id)!;
      card.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.delete')) return;
        this.onPlay(c);
      });
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.onPlay(c);
      });
      card.querySelector('.delete')!.addEventListener('click', () => {
        if (window.confirm(`Delete ${c.name}? This cannot be undone.`)) this.onDelete(c);
      });
    }
    const full = list.length >= MAX_CHARACTERS;
    const create = this.root.querySelector<HTMLButtonElement>('.create')!;
    create.disabled = full;
    this.root.querySelector<HTMLElement>('.room')!.textContent = `${list.length} of ${MAX_CHARACTERS}`;
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.root.classList.add('hidden');
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }
}

function ago(t: number): string {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
