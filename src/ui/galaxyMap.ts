import { PLANETS, type PlanetDef } from '../data/planets';

/** A named place from a converted pack's pois.json, in SWG coordinates. */
export interface Poi {
  name: string;
  x: number;
  z: number;
  r: number;
  kind: 'region' | 'starport' | 'shuttleport';
}

export class GalaxyMap {
  readonly root: HTMLElement;
  private currentId = '';
  private readonly pois = new Map<string, Promise<Poi[]>>();
  open = false;

  constructor(
    parent: HTMLElement,
    private readonly onTravel: (p: PlanetDef) => void,
    private readonly onTeleport: (p: PlanetDef, poi: Poi) => void,
  ) {
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
          <div class="pois"></div>
        </div>`;
      card.addEventListener('click', () => {
        if (p.id !== this.currentId) this.onTravel(p);
      });
      list.appendChild(card);
      void this.fillPois(p, card.querySelector('.pois')!);
    }
    this.root.querySelector('.close')!.addEventListener('click', () => this.hide());
  }

  /** Places from the planet's converted pack; a click there teleports instead of travelling. */
  private async fillPois(p: PlanetDef, holder: HTMLElement): Promise<void> {
    const pois = await this.loadPois(p.id);
    if (!pois.length) return;
    const title = document.createElement('div');
    title.className = 'pois-title';
    title.textContent = 'Places';
    holder.appendChild(title);
    for (const poi of pois) {
      const b = document.createElement('button');
      b.className = `poi ${poi.kind}`;
      b.type = 'button';
      b.textContent = poi.name;
      b.title = `${poi.kind} at ${poi.x.toFixed(0)}, ${poi.z.toFixed(0)}`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onTeleport(p, poi);
      });
      holder.appendChild(b);
    }
  }

  loadPois(planetId: string): Promise<Poi[]> {
    let p = this.pois.get(planetId);
    if (!p) {
      p = fetch(`${import.meta.env.BASE_URL}assets-private/${planetId}/pois.json`)
        .then(async (res) => {
          if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return [];
          const data = (await res.json()) as { pois?: Poi[] };
          return data.pois ?? [];
        })
        .catch(() => []);
      this.pois.set(planetId, p);
    }
    return p;
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
