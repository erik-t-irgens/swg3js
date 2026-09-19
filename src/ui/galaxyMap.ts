import { PLANETS, planetBelow, type PlanetDef } from '../data/planets';
import { loadSpacePack } from '../space/spaceData';

/** A named place from a converted pack's pois.json, in SWG coordinates. */
export interface Poi {
  name: string;
  x: number;
  z: number;
  r: number;
  kind: 'city' | 'starport' | 'shuttleport' | 'landmark' | 'area' | 'region';
}

/** The galaxy: a card per world to travel to, with the places on each to jump to. Lives in a tab of the map window. */
export class GalaxyMap {
  readonly root: HTMLElement;
  private currentId = '';
  private currentZone: string | undefined;
  private readonly pois = new Map<string, Promise<Poi[]>>();

  constructor(
    parent: HTMLElement,
    private readonly onTravel: (p: PlanetDef, zone?: string) => void,
    private readonly onTeleport: (p: PlanetDef, poi: Poi, zone?: string) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'galaxy-body hidden';
    this.root.innerHTML = `
      <p class="menu-hint">Choose a destination. Starports and shuttle tickets come later; for now the Force provides. A place under a world jumps straight to it.</p>
      <div class="planets"></div>`;
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
          <div class="meta">${p.space ? (planetBelow(p) ? 'Orbit · no gravity · flown in a ship' : 'Deep space · no gravity · flown in a ship') : `Gravity ${p.gravity} m/s² · ${p.creatures.name} country`}<span class="space-missing"></span></div>
          <div class="pois"></div>
        </div>`;
      card.addEventListener('click', () => {
        if (p.id !== this.currentId) this.onTravel(p);
      });
      void this.currentZone;
      list.appendChild(card);
      void this.fillPois(p, card.querySelector('.pois')!);
    }
  }

  /**
   * Places from the planet's converted pack; a click there teleports instead of travelling. A
   * planet split into zones gets one block per zone, headed by the zone itself.
   */
  private async fillPois(p: PlanetDef, holder: HTMLElement): Promise<void> {
    if (p.zones?.length) {
      for (const zone of p.zones) {
        const head = document.createElement('button');
        head.type = 'button';
        head.className = 'poi zone';
        head.textContent = zone.name;
        head.title = `zone of ${p.name}`;
        head.addEventListener('click', (e) => {
          e.stopPropagation();
          this.onTravel(p, zone.id);
        });
        holder.appendChild(head);
        const body = document.createElement('div');
        holder.appendChild(body);
        await this.fillPackPois(p, body, zone.pack, zone.id, true);
      }
      return;
    }
    await this.fillPackPois(p, holder, p.id, undefined, false);
  }

  private async fillPackPois(p: PlanetDef, holder: HTMLElement, packId: string, zone: string | undefined, collapsedCities: boolean): Promise<void> {
    const pois = await this.loadPois(packId);
    if (!pois.length) return;
    const chip = (poi: Poi) => {
      const b = document.createElement('button');
      b.className = `poi ${poi.kind}`;
      b.type = 'button';
      b.textContent = poi.name;
      b.title = `${poi.kind} at ${poi.x.toFixed(0)}, ${poi.z.toFixed(0)}`;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onTeleport(p, poi, zone);
      });
      return b;
    };
    const section = (label: string, list: Poi[], collapsed: boolean) => {
      if (!list.length) return;
      const title = document.createElement('button');
      title.type = 'button';
      title.className = 'pois-title';
      const body = document.createElement('div');
      body.className = 'pois-body';
      body.hidden = collapsed;
      const render = () => {
        title.textContent = `${body.hidden ? '▸' : '▾'} ${label} (${list.length})`;
      };
      title.addEventListener('click', (e) => {
        e.stopPropagation();
        body.hidden = !body.hidden;
        render();
      });
      render();
      for (const poi of list) body.appendChild(chip(poi));
      holder.appendChild(title);
      holder.appendChild(body);
    };
    const cities = pois.filter((x) => x.kind === 'city');
    const travel = pois.filter((x) => x.kind === 'starport' || x.kind === 'shuttleport');
    const landmarks = pois.filter((x) => x.kind === 'landmark' || x.kind === 'region');
    const areas = pois.filter((x) => x.kind === 'area');
    section('Cities', cities, collapsedCities);
    section('Travel', travel, cities.length > 0 || collapsedCities);
    section('Landmarks', landmarks, true);
    section('Regions', areas, true);
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

  setCurrent(id: string, zone?: string): void {
    this.currentId = id;
    this.currentZone = zone;
    this.root.querySelectorAll<HTMLElement>('.planet-card').forEach((c) => {
      c.classList.toggle('current', c.dataset.id === id);
    });
  }

  show(): void {
    this.root.classList.remove('hidden');
    this.markUnconverted();
  }

  /**
   * A space system with no pack at all (Kessel, Ord Mantell and Deep Space before the `space` run) would be travelled to
   * behind the loading screen into an empty zone: its card says so, with the command. Asked on every showing, since
   * `loadSpacePack` keeps no missing pack, so a conversion mid-session clears the note; a pack from before hyperspace
   * still flies and is not marked.
   */
  private markUnconverted(): void {
    for (const p of PLANETS) {
      if (!p.space) continue;
      const note = this.root.querySelector<HTMLElement>(`.planet-card[data-id="${p.id}"] .space-missing`);
      if (!note) continue;
      void loadSpacePack(import.meta.env.BASE_URL, p.id).then((pack) => {
        const text = pack ? '' : ` · not converted: npm run swg -- space @SWG all assets-private --retail-only`;
        if (note.textContent !== text) note.textContent = text;
      });
    }
  }

  hide(): void {
    this.root.classList.add('hidden');
  }
}
