// The Galaxy tab of the map window: the galaxy drawn as a disc of stars with every system at its
// canon square (`galaxyView.ts`), the shuttle routes the converter read out of the client between
// them, and beside it a panel for the system picked — each of its worlds with its description, its
// cities and ports to jump to, its own ground map, a button to travel there, and, while you are at a
// ship's controls in space, a button to hyperspace into its orbit.
//
// The card list this tab used to be is still here, behind the List button, for reading and for the
// keyboard. Where a system hangs is ours, never the client's (the archives hold a picture of the
// galaxy but no positions on it); every place inside a world comes from that world's converted pack.

import * as THREE from 'three';
import { PLANETS, packIdOf, planetBelow, type PlanetDef } from '../data/planets';
import { destinationFor, drawnSystems, GALAXY_TUNE, loadGalaxyFile, planetTextureOf, systemOf, systemRoutes, worldsOf, zoneFor, type GalaxySystemDef } from '../data/galaxy';
import { loadSpacePack, type Destination, type HyperspaceCatalogue } from '../space/spaceData';
import { GALAXY_VIEW_TUNE, GalaxyView } from './galaxyView';

/**
 * A named place from a converted pack's pois.json, in SWG coordinates. `place` is the client's own
 * named place: a point with a description and no reach of its own, which is why it is drawn as a
 * dot and never as a ring. `desc` is the client's own words for it, where it has any.
 */
export interface Poi {
  name: string;
  x: number;
  z: number;
  r: number;
  kind: 'city' | 'starport' | 'shuttleport' | 'place' | 'landmark' | 'area' | 'region';
  desc?: string;
}

/** What the galaxy tab needs from the game to offer a jump into a system's orbit. */
export interface GalaxyDeps {
  baseUrl: string;
  /** Whether the player is at a ship's controls in space, so an orbit can be jumped to. */
  piloting: () => boolean;
  /** Every space zone's pack and destinations: the System Map's own catalogue, shared with it. */
  catalogue: () => Promise<HyperspaceCatalogue>;
  /** Why a destination cannot be jumped to now (`Hyperspace.why`), or null. */
  why: (d: Destination) => string | null;
  /** Start the jump: null when it began (and the map closes), else the refusal to show on the panel. */
  onHyperspace: (d: Destination) => string | null;
}

/** How often the open panel reads the refusals afresh (the ship flies on underneath). */
const REFRESH_MS = 500;

/** The galaxy tab's own styles, added once so nothing outside this file has to carry them. */
const GALAXY_CSS = `
.galaxy-bar { display: flex; align-items: center; gap: 8px; padding: 8px 18px 0; }
.galaxy-bar .hint { flex: 1 1 auto; font-size: 11px; color: var(--muted); }
.galaxy-bar button { padding: 3px 9px; font-size: 11px; color: var(--text); background: color-mix(in srgb, var(--pool) 30%, transparent); border: 1px solid var(--accent); border-radius: 4px; cursor: pointer; }
.galaxy-bar button.on { background: color-mix(in srgb, var(--pool) 70%, transparent); }
.galaxy-main { display: flex; flex: 1 1 auto; min-height: 0; gap: 10px; padding: 8px 14px 12px; }
.galaxy-main[hidden] { display: none; }
.galaxy-view { position: relative; flex: 1 1 auto; min-width: 0; min-height: 320px; background: var(--void); border: 1px solid var(--panel-border); border-radius: 8px; overflow: hidden; }
.galaxy-view .map3d { position: absolute; inset: 0; }
.galaxy-labels { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.galaxy-catch { position: absolute; inset: 0; cursor: grab; touch-action: none; }
.galaxy-catch:active { cursor: grabbing; }
.galaxy-note { position: absolute; left: 10px; bottom: 8px; font-size: 11px; color: var(--muted); pointer-events: none; }
.galaxy-label { position: absolute; left: 0; top: 0; display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--ink); text-shadow: 0 1px 2px var(--void); white-space: nowrap; }
.galaxy-label[hidden] { display: none; }
.galaxy-label i { display: block; width: 5px; height: 5px; background: currentColor; border-radius: 50%; }
.galaxy-label.on { color: var(--accent); }
.galaxy-label.here { color: var(--hot); }
.galaxy-label.ours b::after { content: ' *'; opacity: 0.7; }
.galaxy-info { width: 310px; flex: 0 0 auto; overflow-y: auto; padding: 10px 12px; font-size: 12px; background: color-mix(in srgb, var(--void) 70%, transparent); border: 1px solid var(--panel-border); border-radius: 8px; }
.galaxy-info h3 { margin: 0 0 2px; font-size: 15px; color: var(--accent); }
.galaxy-info .square { margin: 0 0 10px; font-size: 11px; color: var(--muted); }
.galaxy-world { padding: 8px 0; border-top: 1px solid color-mix(in srgb, var(--ink) 8%, transparent); }
.galaxy-world:first-of-type { border-top: 0; }
.galaxy-world h4 { margin: 0 0 1px; font-size: 13px; }
.galaxy-world .tag { font-size: 11px; color: var(--muted); }
.galaxy-world p { margin: 5px 0; color: var(--muted); line-height: 1.45; }
.ground-wrap { position: relative; width: 130px; height: 130px; margin: 6px 0; }
.galaxy-world img.ground { display: block; box-sizing: border-box; width: 100%; height: 100%; object-fit: fill; border: 1px solid var(--panel-border); border-radius: 4px; }
.ground-dot { position: absolute; width: 7px; height: 7px; margin: -3.5px 0 0 -3.5px; padding: 0; background: var(--accent); border: 1px solid color-mix(in srgb, var(--void) 70%, transparent); border-radius: 50%; cursor: pointer; }
.ground-dot.travel { background: var(--component); }
.ground-dot:hover { width: 9px; height: 9px; margin: -4.5px 0 0 -4.5px; }
.galaxy-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin: 6px 0 2px; }
.galaxy-actions button { padding: 3px 9px; font-size: 11px; color: var(--text); background: color-mix(in srgb, var(--pool) 35%, transparent); border: 1px solid var(--accent); border-radius: 4px; cursor: pointer; }
.galaxy-actions button[disabled] { opacity: 0.4; cursor: default; }
.galaxy-actions .why { font-size: 11px; color: var(--muted); }
.galaxy-body .planets[hidden] { display: none; }
`;

/** The galaxy: the map window's other tab. */
export class GalaxyMap {
  readonly root: HTMLElement;
  private currentId = '';
  private currentZone: string | undefined;
  private readonly pois = new Map<string, Promise<Poi[]>>();
  private readonly groundMaps = new Map<string, Promise<{ url: string; width: number } | null>>();
  private readonly view: GalaxyView;
  private readonly viewHolder: HTMLElement;
  private readonly catchLayer: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly infoEl: HTMLElement;
  private readonly cards: HTMLElement;
  private readonly listButton: HTMLButtonElement;
  private readonly mainEl: HTMLElement;
  private picked: GalaxySystemDef | null = null;
  private pickedShown = '';
  /** The jump rows on the panel, refreshed while the ship flies on. */
  private jumps: { dest: Destination | null; button: HTMLButtonElement; why: HTMLElement }[] = [];
  private catalogue: HyperspaceCatalogue | null = null;
  private timer: number | null = null;
  private dragging = false;
  private panning = false;
  private dragMoved = false;
  private lastX = 0;
  private lastY = 0;
  private globesAsked = false;
  private readonly scratch = new THREE.Vector3();
  private readonly textures = new THREE.TextureLoader();

  constructor(
    parent: HTMLElement,
    private readonly onTravel: (p: PlanetDef, zone?: string) => void,
    private readonly onTeleport: (p: PlanetDef, poi: Poi, zone?: string) => void,
    private readonly deps: GalaxyDeps,
  ) {
    if (!document.getElementById('galaxy-map-style')) {
      const style = document.createElement('style');
      style.id = 'galaxy-map-style';
      style.textContent = GALAXY_CSS;
      document.head.appendChild(style);
    }
    this.root = document.createElement('div');
    this.root.className = 'galaxy-body hidden';
    this.root.innerHTML = `
      <div class="galaxy-bar">
        <span class="hint">Drag turns, right-drag slides, wheel zooms, click a system. Where the systems hang is ours, from the published grid, not from the game's own files; a name with a star beside it is placed by us.</span>
        <button type="button" class="reset">Reset view</button>
        <button type="button" class="list">List</button>
      </div>
      <div class="galaxy-main">
        <div class="galaxy-view">
          <div class="galaxy-labels"></div>
          <div class="galaxy-catch"></div>
          <div class="galaxy-note"></div>
        </div>
        <div class="galaxy-info"></div>
      </div>
      <p class="menu-hint" hidden>Choose a destination. Starports and shuttle tickets come later; for now the Force provides. A place under a world jumps straight to it.</p>
      <div class="planets" hidden></div>`;
    parent.appendChild(this.root);
    this.viewHolder = this.root.querySelector<HTMLElement>('.galaxy-view')!;
    this.catchLayer = this.root.querySelector<HTMLElement>('.galaxy-catch')!;
    this.noteEl = this.root.querySelector<HTMLElement>('.galaxy-note')!;
    this.infoEl = this.root.querySelector<HTMLElement>('.galaxy-info')!;
    this.mainEl = this.root.querySelector<HTMLElement>('.galaxy-main')!;
    this.cards = this.root.querySelector<HTMLElement>('.planets')!;
    this.listButton = this.root.querySelector<HTMLButtonElement>('.list')!;
    this.view = new GalaxyView(this.root.querySelector<HTMLElement>('.galaxy-labels')!);
    this.listButton.addEventListener('click', () => this.toggleList());
    this.root.querySelector<HTMLButtonElement>('.reset')!.addEventListener('click', () => this.view.orbit.reset());
    this.bindMouse();
    this.buildCards();
    this.showSystem(null);
  }

  // ---- The cards: the list this tab used to be, kept for reading and for the keyboard ----

  private buildCards(): void {
    for (const p of PLANETS) {
      const card = document.createElement('div');
      card.className = 'planet-card';
      card.dataset.id = p.id;
      const sky = `#${p.sky.top.toString(16).padStart(6, '0')}`;
      const ground = `#${p.palette.mid.toString(16).padStart(6, '0')}`;
      card.innerHTML = `
        <div class="globe" style="background: radial-gradient(circle at 35% 35%, ${sky} 0%, ${ground} 55%, var(--void) 100%)"></div>
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
      this.cards.appendChild(card);
      void this.fillPois(p, card.querySelector('.pois')!);
    }
  }

  /** The List button: the cards in place of the picture, for reading and for the keyboard. */
  private toggleList(): void {
    const on = this.cards.hidden;
    this.cards.hidden = !on;
    this.mainEl.hidden = on;
    const hint = this.root.querySelector<HTMLElement>('.menu-hint');
    if (hint) hint.hidden = !on;
    this.listButton.classList.toggle('on', on);
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
      // The client's own description where the place has one, and where it has not, what it is and
      // where. A `title` is the browser's own tooltip: nothing is drawn and nothing is measured.
      b.title = poi.desc ? `${poi.desc}\n${poi.x.toFixed(0)}, ${poi.z.toFixed(0)}` : `${poi.kind} at ${poi.x.toFixed(0)}, ${poi.z.toFixed(0)}`;
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
    const places = pois.filter((x) => x.kind === 'place');
    const landmarks = pois.filter((x) => x.kind === 'landmark' || x.kind === 'region');
    const areas = pois.filter((x) => x.kind === 'area');
    section('Cities', cities, collapsedCities);
    section('Travel', travel, cities.length > 0 || collapsedCities);
    // The client's own named places stand ahead of the emulator's landmarks, and open on a world
    // with no cities (the lava world, the tree world's zones), where they are the only names there
    // are and the card would otherwise be headings and nothing else. A starport does not close it:
    // the tree world's main zone has one, and closing it there is exactly the case this is for.
    section('Places', places, cities.length > 0);
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

  /**
   * A world's own ground map picture, from its pack, with the ground width the picture covers; null
   * where none is converted. The width is what puts a city on it: the picture spans the ground from
   * -width/2 to +width/2 both ways, with the places' own coordinates already in that frame.
   */
  private groundMap(packId: string): Promise<{ url: string; width: number } | null> {
    let p = this.groundMaps.get(packId);
    if (!p) {
      const base = `${this.deps.baseUrl}assets-private/${packId}/`;
      p = fetch(`${base}map.json`)
        .then(async (res) => {
          if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
          const meta = (await res.json()) as { image?: string; width?: number };
          return meta.image ? { url: `${base}${meta.image}`, width: Number(meta.width) || 16384 } : null;
        })
        .catch(() => null);
      this.groundMaps.set(packId, p);
    }
    return p;
  }

  /**
   * The world's ground map on the panel with its cities and ports dotted on it, each dot the same
   * jump the chips below make. Every dot is placed as a share of the picture, so the picture's size
   * on the panel does not matter, and a place outside the ground the picture covers is left off.
   */
  private async addGroundMap(box: HTMLElement, after: HTMLElement, planet: PlanetDef, packId: string, zone: string | undefined): Promise<void> {
    const meta = await this.groundMap(packId);
    if (!meta || !box.isConnected) return;
    const wrap = document.createElement('div');
    wrap.className = 'ground-wrap';
    const img = document.createElement('img');
    img.className = 'ground';
    img.src = meta.url;
    img.alt = `${planet.name} from above`;
    wrap.appendChild(img);
    box.insertBefore(wrap, after.nextSibling);
    const pois = await this.loadPois(packId);
    if (!wrap.isConnected) return;
    const extent = meta.width;
    // The cities and the ports, and on a world with no cities the client's own named places as well,
    // since there they are the names the world has: the lava world would be blank without them and
    // the tree world's main zone would be one starport among nine places it does not draw. A world
    // with cities is left as it was, or its thumbnail fills with dots.
    const dotted = pois.filter((p) => p.kind === 'city' || p.kind === 'starport' || p.kind === 'shuttleport');
    const withPlaces = pois.some((p) => p.kind === 'city') ? dotted : [...dotted, ...pois.filter((p) => p.kind === 'place')];
    for (const poi of withPlaces) {
      const travel = poi.kind === 'starport' || poi.kind === 'shuttleport';
      const left = (poi.x + extent / 2) / extent;
      const top = (extent / 2 - poi.z) / extent;
      if (!(left >= 0 && left <= 1 && top >= 0 && top <= 1)) continue;
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = travel ? 'ground-dot travel' : 'ground-dot';
      dot.title = `${poi.name} · ${poi.kind}`;
      dot.style.left = `${(left * 100).toFixed(2)}%`;
      dot.style.top = `${(top * 100).toFixed(2)}%`;
      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onTeleport(planet, poi, zone);
      });
      wrap.appendChild(dot);
    }
  }

  // ---- The picture: the mouse, the globes and the routes ----

  private bindMouse(): void {
    const c = this.catchLayer;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      this.dragging = e.button === 0;
      this.panning = e.button === 1 || e.button === 2;
      this.dragMoved = false;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      c.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.dragging && !this.panning) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.dragMoved = true;
      if (this.dragging) this.view.orbit.turn(dx, dy);
      else {
        const perPixel = (2 * this.view.orbit.orbit.distance * Math.tan((50 * Math.PI) / 360)) / Math.max(1, this.viewHolder.clientHeight);
        const m = this.viewMatrix();
        this.view.orbit.pan(dx, dy, perPixel, m[0], m[1], m[2], m[4], m[5], m[6]);
      }
    });
    c.addEventListener('pointerup', (e) => {
      const clicked = this.dragging && !this.dragMoved;
      this.dragging = false;
      this.panning = false;
      if (!clicked) return;
      const id = this.view.pickAt(e.offsetX, e.offsetY, this.viewHolder.clientWidth || 1, this.viewHolder.clientHeight || 1);
      this.showSystem(id ? (drawnSystems().find((s) => s.id === id) ?? null) : null);
    });
    c.addEventListener('pointercancel', () => {
      this.dragging = false;
      this.panning = false;
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.view.pointUnder(e.offsetX, e.offsetY, this.viewHolder.clientWidth || 1, this.viewHolder.clientHeight || 1, this.scratch);
      this.view.orbit.zoomToward(e.deltaY > 0 ? 1 : -1, this.scratch.x, this.scratch.y, this.scratch.z);
    }, { passive: false });
    c.addEventListener('dblclick', (e) => {
      const id = this.view.pickAt(e.offsetX, e.offsetY, this.viewHolder.clientWidth || 1, this.viewHolder.clientHeight || 1);
      const at = id ? this.view.placeOf(id) : null;
      if (at) this.view.orbit.centreOn(at.x, at.y, at.z);
    });
  }

  /** The drawing camera's own right and up, for sliding the view; the view keeps them for us. */
  private viewMatrix(): ArrayLike<number> {
    return this.view.cameraMatrix;
  }

  /** The map window's canvas, moved into this tab while it shows: the game keeps one map renderer. */
  attachCanvas(canvas: HTMLElement): void {
    this.viewHolder.prepend(canvas);
  }

  /**
   * One frame of the galaxy, with the map window's own renderer. The renderer is the space view's as
   * well, and each tab sizes it to its own holder on the frame it draws: the drawing buffer is the
   * only thing that changes, so moving between the tabs costs nothing but a resize.
   */
  drawView(renderer: THREE.WebGLRenderer): void {
    const w = this.viewHolder.clientWidth;
    const h = this.viewHolder.clientHeight;
    if (!w || !h || this.mainEl.hidden) return;
    const ratio = renderer.getPixelRatio();
    // Compared the way three sizes the buffer (it floors): compared rounded, a holder whose width times
    // 1.25 or 1.5 ends in more than a half set the size again on every frame, which throws the
    // buffer away each time.
    if (renderer.domElement.width !== Math.floor(w * ratio) || renderer.domElement.height !== Math.floor(h * ratio)) renderer.setSize(w, h, false);
    this.view.draw(renderer, w, h);
  }

  /** Each system's globe: the picture its own orbit's pack carries, else its world's colour. Asked once. */
  private askGlobes(): void {
    if (this.globesAsked) return;
    this.globesAsked = true;
    for (const sys of drawnSystems()) {
      const worlds = worldsOf(sys);
      const first = worlds[0];
      if (!first) continue;
      const colour = first.planet.palette.mid;
      this.view.setGlobe(sys.id, colour, null);
      const zone = zoneFor(sys, first.planet);
      if (!zone) continue;
      void loadSpacePack(this.deps.baseUrl, zone).then((pack) => {
        const path = planetTextureOf(pack, [first.planet.id, sys.id, zone.replace(/^space_/, '')]);
        if (!path) return;
        this.textures.load(
          `${this.deps.baseUrl}assets-private/${zone}/${path}`,
          (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            this.view.setGlobe(sys.id, colour, tex);
          },
          undefined,
          () => {},
        );
      });
    }
    void loadGalaxyFile(this.deps.baseUrl).then((file) => {
      const routes = systemRoutes(file);
      this.view.setRoutes(routes);
      this.noteEl.textContent = routes.length
        ? `${routes.length} shuttle routes, from the game's own fares`
        : 'No shuttle routes yet: npm run swg -- maps @SWG assets-private --retail-only';
    });
  }

  // ---- The panel beside the map ----

  /** Pick a system (or nothing): the panel writes its worlds, and the view rings it. */
  private showSystem(sys: GalaxySystemDef | null): void {
    this.picked = sys;
    this.view.setPicked(sys?.id ?? null);
    const key = sys ? sys.id : '';
    if (this.pickedShown === key && sys) return;
    this.pickedShown = key;
    this.jumps = [];
    this.infoEl.replaceChildren();
    if (!sys) {
      const p = document.createElement('p');
      p.className = 'square';
      p.textContent = 'Click a system to see its worlds.';
      this.infoEl.appendChild(p);
      return;
    }
    const h = document.createElement('h3');
    h.textContent = sys.name;
    const square = document.createElement('p');
    square.className = 'square';
    const where = sys.grid ? `Grid ${sys.grid}` : 'Off the grid';
    const sure = sys.confidence === 'good' ? '' : sys.confidence === 'fair' ? ' · square not certain' : sys.confidence === 'ours' ? ' · placed by us' : ' · made up';
    square.textContent = `${where}${sure}${sys.note ? ` ${sys.note}` : ''}`;
    this.infoEl.append(h, square);
    for (const { def, planet } of worldsOf(sys)) {
      this.infoEl.appendChild(this.worldBlock(sys, def.noOrbit ?? null, planet));
    }
    this.refresh();
  }

  /** One world on the panel: what it is, where to go on it, and the two ways to get there. */
  private worldBlock(sys: GalaxySystemDef, noOrbit: string | null, planet: PlanetDef): HTMLElement {
    const box = document.createElement('div');
    box.className = 'galaxy-world';
    const h = document.createElement('h4');
    h.textContent = planet.name;
    const tag = document.createElement('div');
    tag.className = 'tag';
    tag.textContent = planet.tagline;
    const desc = document.createElement('p');
    desc.textContent = planet.description;
    box.append(h, tag, desc);
    // The world's own ground map, small, with its cities and ports dotted on it, where its pack has
    // one. A world split into zones shows the first zone's map and jumps into that zone.
    if (!planet.space) {
      const zone = planet.zones?.length ? planet.zones[0].id : undefined;
      void this.addGroundMap(box, desc, planet, packIdOf(planet, zone), zone);
    }
    const actions = document.createElement('div');
    actions.className = 'galaxy-actions';
    const travel = document.createElement('button');
    travel.type = 'button';
    travel.textContent = planet.space ? 'Fly there' : 'Travel';
    travel.disabled = planet.id === this.currentId;
    travel.addEventListener('click', () => this.onTravel(planet));
    actions.appendChild(travel);
    const jump = document.createElement('button');
    jump.type = 'button';
    jump.textContent = 'Hyperspace to orbit';
    const why = document.createElement('span');
    why.className = 'why';
    if (noOrbit) {
      jump.hidden = true;
      why.textContent = noOrbit;
    } else {
      jump.addEventListener('click', () => this.jumpTo(jump));
      this.jumps.push({ dest: null, button: jump, why });
      jump.disabled = true;
    }
    actions.append(jump, why);
    // Flying to a space zone the `space` command has not written would drop you into an empty zone
    // behind the loading screen. The card list carries this note too, but the cards are behind the
    // List button now, so the panel has to say it where the button to fly there is.
    if (planet.space) {
      const missing = document.createElement('span');
      missing.className = 'why';
      actions.appendChild(missing);
      void loadSpacePack(this.deps.baseUrl, planet.id).then((pack) => {
        if (pack || !missing.isConnected) return;
        missing.textContent = 'not converted: npm run swg -- space @SWG all assets-private --retail-only';
      });
    }
    box.appendChild(actions);
    // The places on it: the same chips the card list shows, teleported to as they are there.
    const places = document.createElement('div');
    places.className = 'pois';
    box.appendChild(places);
    if (!planet.space) void this.fillPois(planet, places);
    // The jump's own destination, once the catalogue is in.
    if (!noOrbit) {
      const row = this.jumps[this.jumps.length - 1];
      void this.deps.catalogue().then((cat) => {
        this.catalogue = cat;
        row.dest = destinationFor(sys, planet, cat);
        this.refresh();
      }, () => {});
    }
    return box;
  }

  /** Press: the game starts the jump and closes the map, or hands the refusal back to the panel. */
  private jumpTo(button: HTMLButtonElement): void {
    const row = this.jumps.find((j) => j.button === button);
    if (!row?.dest) return;
    const why = this.deps.onHyperspace(row.dest);
    if (why !== null) row.why.textContent = why;
  }

  /** What changes while the ship flies on: whether each jump can be pressed, and why not. */
  private refresh(): void {
    if (this.root.classList.contains('hidden')) return;
    for (const row of this.jumps) {
      if (!row.dest) {
        row.button.disabled = true;
        const text = this.catalogue ? 'This system is not converted for hyperspace yet.' : 'reading the systems…';
        if (row.why.textContent !== text) row.why.textContent = text;
        continue;
      }
      let note: string | null;
      try {
        note = this.deps.piloting() ? this.deps.why(row.dest) : 'Only from a ship\'s controls in space.';
      } catch (err) {
        note = 'the jump is not available';
        console.warn('galaxy: why failed', err);
      }
      row.button.disabled = note !== null;
      const text = note ?? `to ${row.dest.name}`;
      if (row.why.textContent !== text) row.why.textContent = text;
    }
  }

  setCurrent(id: string, zone?: string): void {
    this.currentId = id;
    this.currentZone = zone;
    void this.currentZone;
    this.view.setCurrent(systemOf(id)?.id ?? null);
    this.cards.querySelectorAll<HTMLElement>('.planet-card').forEach((c) => {
      c.classList.toggle('current', c.dataset.id === id);
    });
    // A world travelled to while the panel is open: its Travel button is the one that changes.
    if (this.picked) {
      this.pickedShown = '';
      this.showSystem(this.picked);
    }
  }

  show(): void {
    this.root.classList.remove('hidden');
    this.askGlobes();
    this.attachDebug();
    this.markUnconverted();
    // The system flown in is the one picked, the first time the tab is opened on it.
    if (!this.picked) this.showSystem(systemOf(this.currentId));
    if (this.timer === null) this.timer = window.setInterval(() => this.refresh(), REFRESH_MS);
    this.refresh();
  }

  /**
   * `__debug.galaxy()`: where every system stands, what is drawn and what is picked, and the numbers we
   * invented for the layout and the view, which an object retunes live. The hook is added here rather
   * than where the rest of `__debug` is built, so nothing outside this file carries the galaxy's knobs.
   */
  private attachDebug(): void {
    const w = window as unknown as { __debug?: Record<string, unknown> };
    if (!w.__debug || w.__debug.galaxy) return;
    w.__debug.galaxy = (tune?: Partial<typeof GALAXY_TUNE> & Partial<typeof GALAXY_VIEW_TUNE>) => {
      if (tune) {
        for (const k of Object.keys(GALAXY_TUNE) as (keyof typeof GALAXY_TUNE)[]) {
          const v = tune[k];
          if (typeof v === 'number' && Number.isFinite(v)) GALAXY_TUNE[k] = v;
        }
        for (const k of Object.keys(GALAXY_VIEW_TUNE) as (keyof typeof GALAXY_VIEW_TUNE)[]) {
          const v = tune[k];
          if (typeof v === 'number' && Number.isFinite(v)) GALAXY_VIEW_TUNE[k] = v;
        }
        this.view.retune();
      }
      return { ...this.view.describe(), tune: { ...GALAXY_TUNE, ...GALAXY_VIEW_TUNE } };
    };
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
      const note = this.cards.querySelector<HTMLElement>(`.planet-card[data-id="${p.id}"] .space-missing`);
      if (!note) continue;
      void loadSpacePack(import.meta.env.BASE_URL, p.id).then((pack) => {
        const text = pack ? '' : ` · not converted: npm run swg -- space @SWG all assets-private --retail-only`;
        if (note.textContent !== text) note.textContent = text;
      });
    }
  }

  hide(): void {
    this.root.classList.add('hidden');
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }
}
