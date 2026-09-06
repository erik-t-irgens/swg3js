import { PLANETS, type PlanetDef } from '../data/planets';

export class GalaxyMap {
  readonly root: HTMLElement;
  private currentId = '';
  open = false;

  constructor(parent: HTMLElement, private readonly onTravel: (p: PlanetDef) => void) {
    this.root = document.createElement('div');
    this.root.id = 'galaxy-map';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="map-panel">
        <div class="map-header">
          <h2>Galaxy Map</h2>
          <span>Choose a destination. Starports and shuttle tickets come later; for now the Force provides.</span>
          <button class="close">Close (M)</button>
        </div>
        <div class="planets"></div>
      </div>`;
    parent.appendChild(this.root);
    const list = this.root.querySelector('.planets')!;
    for (const p of PLANETS) {
      const card = document.createElement('div');
      card.className = 'planet-card';
      card.dataset.id = p.id;
      const sky = `#${p.sky.top.toString(16).padStart(6, '0')}`;
      const ground = `#${p.palette.mid.toString(16).padStart(6, '0')}`;
      card.innerHTML = `
        <div class="globe" style="background: radial-gradient(circle at 35% 35%, ${sky} 0%, ${ground} 55%, #000 100%)"></div>
        <div class="card-body">
          <h3>${p.name}</h3>
          <div class="tag">${p.tagline}</div>
          <p>${p.description}</p>
          <div class="meta">Gravity ${p.gravity} m/s² · ${p.creatures.name} country</div>
        </div>`;
      card.addEventListener('click', () => {
        if (p.id !== this.currentId) this.onTravel(p);
      });
      list.appendChild(card);
    }
    this.root.querySelector('.close')!.addEventListener('click', () => this.hide());
  }

  setCurrent(id: string): void {
    this.currentId = id;
    this.root.querySelectorAll<HTMLElement>('.planet-card').forEach((c) => {
      c.classList.toggle('current', c.dataset.id === id);
    });
  }

  show(): void {
    this.open = true;
    this.root.classList.remove('hidden');
  }

  hide(): void {
    this.open = false;
    this.root.classList.add('hidden');
  }
}
