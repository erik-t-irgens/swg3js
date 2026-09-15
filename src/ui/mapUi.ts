// The map window (M): where you are. On a planet, the client's own map of it (the picture the
// game's planetary map showed) with its places marked and you on it, panned and zoomed with the
// mouse, an altitude under your mark when flying; in space, a three-axis picture of the zone's
// rocks, stations and ships round your own, turned and zoomed with the mouse. The galaxy, to
// travel, is the window's other tab.

import * as THREE from 'three';
import type { GalaxyMap, Poi } from './galaxyMap';

/** Where the player is and what is round them, read fresh every time the map draws. */
export interface MapSource {
  /** The world the player is on: its pack (for the map image and the places), its name, and whether it is a space zone. */
  here(): { packId: string; name: string; space: boolean };
  /** The player (or the ship they are in), in the game's coordinates: metres, heading in radians, and, when flying, the height over the ground. */
  player(): { x: number; y: number; z: number; heading: number; altitude: number | null };
  /** The pack's layout centre in the game's own coordinates (the snapshot's), which the map image and the places are in. */
  center(): { x: number; z: number } | null;
  pois(packId: string): Promise<Poi[]>;
  /** The zone's placed objects, in the game's coordinates: the rocks and the stations (named). */
  objects(): readonly { x: number; y: number; z: number; radius: number; station: boolean; name?: string }[];
  /** The ships about (and the player on foot), the player's own first, each named for the cursor. */
  ships(): { x: number; y: number; z: number; quaternion: THREE.Quaternion; mine: boolean; label: string }[];
  onTeleport(poi: Poi): void;
}

interface MapImage {
  image: HTMLImageElement;
  width: number;
}

type Tab = 'here' | 'galaxy';

/** A place drawn no larger than this (metres) is a dot; larger ones get a ring of their own size. */
const POI_RING_MIN = 200;

export class MapUi {
  readonly root: HTMLElement;
  private tab: Tab = 'here';
  private readonly hereBody: HTMLElement;
  private readonly readout: HTMLElement;
  private readonly canvas2d = document.createElement('canvas');
  private readonly canvas3d = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly images = new Map<string, Promise<MapImage | null>>();
  private image: MapImage | null = null;
  private imageFor = '';
  private pois: Poi[] = [];
  private poisFor = '';
  private frame = 0;
  private raf = 0;
  /** The 2D view: metres per screen pixel, and the map point (SWG metres) at the canvas centre. */
  private scale = 0;
  private readonly look = { x: 0, z: 0 };
  private followed = false;
  private dragging = false;
  private dragMoved = false;
  private lastX = 0;
  private lastY = 0;
  /** The 3D view. */
  private renderer3d: THREE.WebGLRenderer | null = null;
  private readonly scene3d = new THREE.Scene();
  private readonly camera3d = new THREE.PerspectiveCamera(50, 16 / 9, 1, 60000);
  private readonly orbit = { yaw: 0.6, pitch: 0.5, distance: 2500 };
  private readonly target3d = new THREE.Vector3();
  private rocks: THREE.Points | null = null;
  private readonly stations = new THREE.Group();
  private readonly shipMarks = new THREE.Group();
  private readonly drop: THREE.Line;
  private objectsFor = '';
  private objectCount = 0;
  private panning3d = false;
  /** What the cursor is over in the space view, named beside it. */
  private readonly tip = document.createElement('div');
  private readonly raycaster = new THREE.Raycaster();
  private readonly hover = { x: -1, y: -1 };

  constructor(
    parent: HTMLElement,
    readonly galaxy: GalaxyMap,
    private readonly source: MapSource,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'worldmap';
    this.root.className = 'overlay hidden';
    this.root.innerHTML = `
      <div class="map-panel">
        <div class="map-header">
          <h2>Map</h2>
          <div class="tabs"><button class="tab on" data-tab="here">Here</button><button class="tab" data-tab="galaxy">Galaxy</button></div>
          <span class="map-readout"></span>
          <button class="close">Close (M)</button>
        </div>
        <div class="map-body here"></div>
      </div>`;
    parent.appendChild(this.root);
    const panel = this.root.querySelector<HTMLElement>('.map-panel')!;
    this.hereBody = this.root.querySelector<HTMLElement>('.map-body.here')!;
    this.readout = this.root.querySelector<HTMLElement>('.map-readout')!;
    this.canvas2d.className = 'map2d';
    this.canvas3d.className = 'map3d';
    this.tip.className = 'map-tip';
    this.tip.hidden = true;
    this.hereBody.appendChild(this.canvas2d);
    this.hereBody.appendChild(this.canvas3d);
    this.hereBody.appendChild(this.tip);
    this.ctx = this.canvas2d.getContext('2d')!;
    // The galaxy tab's body: the cards, made by the galaxy map into the panel.
    galaxy.root.remove();
    panel.appendChild(galaxy.root);
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.tabs .tab')) b.addEventListener('click', () => this.showTab(b.dataset.tab as Tab));
    this.root.querySelector('.close')!.addEventListener('click', () => this.onClose());
    this.bind2d();
    this.bind3d();
    const drop = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.drop = new THREE.Line(drop, new THREE.LineDashedMaterial({ color: 0xff6a3d, dashSize: 40, gapSize: 25 }));
    this.scene3d.add(this.stations, this.shipMarks, this.drop);
    const grid = new THREE.GridHelper(24000, 48, 0x2d7fd6, 0x1a3a55);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    this.scene3d.add(grid, new THREE.AxesHelper(1500));
  }

  onClose: () => void = () => {};

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(tab: Tab = 'here'): void {
    this.root.classList.remove('hidden');
    this.followed = false;
    this.showTab(tab);
  }

  hide(): void {
    this.root.classList.add('hidden');
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  setCurrent(id: string, zone?: string): void {
    this.galaxy.setCurrent(id, zone);
  }

  private showTab(tab: Tab): void {
    this.tab = tab;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.tabs .tab')) b.classList.toggle('on', b.dataset.tab === tab);
    this.hereBody.hidden = tab !== 'here';
    if (tab === 'galaxy') this.galaxy.show();
    else this.galaxy.hide();
    this.readout.textContent = '';
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (tab === 'here') this.loop();
  }

  private loop(): void {
    if (!this.open || this.tab !== 'here') return;
    this.draw();
    this.raf = requestAnimationFrame(() => this.loop());
  }

  private draw(): void {
    const here = this.source.here();
    this.canvas2d.hidden = here.space;
    this.canvas3d.hidden = !here.space;
    if (here.space) this.draw3d();
    else this.draw2d(here.packId, here.name);
  }

  // ---- The planet: the client's map, panned and zoomed. ----

  private loadImage(packId: string): Promise<MapImage | null> {
    let p = this.images.get(packId);
    if (!p) {
      const base = `${import.meta.env.BASE_URL}assets-private/${packId}/`;
      p = fetch(`${base}map.json`)
        .then(async (res) => {
          if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
          const meta = (await res.json()) as { image: string; width: number };
          const image = new Image();
          await new Promise<void>((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error(`${meta.image} did not load`));
            image.src = `${base}${meta.image}`;
          });
          return { image, width: meta.width || 16384 };
        })
        .catch(() => null);
      this.images.set(packId, p);
    }
    return p;
  }

  /** Game coordinates to the map's (the snapshot's): the game mirrors X and recentres. */
  private toMap(x: number, z: number): { x: number; z: number } {
    const c = this.source.center() ?? { x: 0, z: 0 };
    return { x: c.x - x, z: z + c.z };
  }

  private fit(): void {
    const w = this.canvas2d.clientWidth || 900;
    const h = this.canvas2d.clientHeight || 560;
    const extent = this.image?.width ?? 16384;
    this.scale = extent / Math.min(w, h);
    const p = this.source.player();
    const m = this.toMap(p.x, p.z);
    this.look.x = m.x;
    this.look.z = m.z;
    this.followed = true;
  }

  private bind2d(): void {
    const c = this.canvas2d;
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.dragMoved = false;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.dragMoved = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.look.x -= dx * this.scale;
      this.look.z += dy * this.scale;
    });
    const up = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      // A click, not a drag: on a place, jump there.
      if (!this.dragMoved) {
        const hit = this.poiAt(e.offsetX, e.offsetY);
        if (hit) this.source.onTeleport(hit);
      }
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', () => (this.dragging = false));
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      // Zoom about the cursor: the map point under it stays under it.
      const rect = c.getBoundingClientRect();
      const px = e.clientX - rect.left - rect.width / 2;
      const py = e.clientY - rect.top - rect.height / 2;
      const before = this.scale;
      this.scale = THREE.MathUtils.clamp(this.scale * (e.deltaY > 0 ? 1.18 : 1 / 1.18), 0.15, 60);
      this.look.x += px * (before - this.scale);
      this.look.z -= py * (before - this.scale);
    }, { passive: false });
    c.addEventListener('dblclick', () => this.fit());
  }

  /** The screen point of a map point, from the canvas's top left. */
  private toScreen(mx: number, mz: number): { x: number; y: number } {
    const w = this.canvas2d.clientWidth;
    const h = this.canvas2d.clientHeight;
    return { x: w / 2 + (mx - this.look.x) / this.scale, y: h / 2 - (mz - this.look.z) / this.scale };
  }

  private poiAt(x: number, y: number): Poi | null {
    let best: Poi | null = null;
    let bestD = 10;
    for (const p of this.pois) {
      const s = this.toScreen(p.x, p.z);
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  private draw2d(packId: string, name: string): void {
    const c = this.canvas2d;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    if (this.imageFor !== packId) {
      this.imageFor = packId;
      this.image = null;
      void this.loadImage(packId).then((img) => {
        if (this.imageFor === packId) {
          this.image = img;
          this.fit();
        }
      });
    }
    if (this.poisFor !== packId) {
      this.poisFor = packId;
      this.pois = [];
      void this.source.pois(packId).then((p) => {
        if (this.poisFor === packId) this.pois = p;
      });
    }
    if (!this.followed || !this.scale) this.fit();
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#060a12';
    ctx.fillRect(0, 0, w, h);
    const extent = this.image?.width ?? 16384;
    const tl = this.toScreen(-extent / 2, extent / 2);
    const px = extent / this.scale;
    if (this.image) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.image.image, tl.x, tl.y, px, px);
    } else {
      // No image converted: the ground's extent as a grid, a kilometre a square.
      ctx.strokeStyle = 'rgba(127,215,255,0.18)';
      ctx.lineWidth = 1;
      const step = 1000 / this.scale;
      for (let i = 0; i <= extent / 1000; i++) {
        ctx.beginPath();
        ctx.moveTo(tl.x + i * step, tl.y);
        ctx.lineTo(tl.x + i * step, tl.y + px);
        ctx.moveTo(tl.x, tl.y + i * step);
        ctx.lineTo(tl.x + px, tl.y + i * step);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgba(127,215,255,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(tl.x, tl.y, px, px);
    // The places: cities as rings the size of their reach with their names, the rest as dots
    // named once the map is close enough to read them.
    const labelsFrom = 20;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const p of this.pois) {
      const s = this.toScreen(p.x, p.z);
      if (s.x < -60 || s.y < -20 || s.x > w + 60 || s.y > h + 20) continue;
      const city = p.kind === 'city';
      const travel = p.kind === 'starport' || p.kind === 'shuttleport';
      const colour = city ? '#7fd7ff' : travel ? '#ffd27f' : p.kind === 'region' || p.kind === 'area' ? 'rgba(180,200,220,0.6)' : '#c8d8e8';
      const r = p.r / this.scale;
      if (city || (r > 6 && p.r >= POI_RING_MIN)) {
        ctx.strokeStyle = colour;
        ctx.lineWidth = city ? 1.5 : 1;
        ctx.beginPath();
        ctx.arc(s.x, s.y, Math.max(3, r), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(s.x, s.y, city ? 3 : 2, 0, Math.PI * 2);
      ctx.fill();
      // A city's name always; a port's or a landmark's once the map is close enough that it does not sit on the city's.
      if (city || this.scale < labelsFrom) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillText(p.name, s.x + 7, s.y + 1);
        ctx.fillStyle = colour;
        ctx.fillText(p.name, s.x + 6, s.y);
      }
    }
    // The player: an arrow the way they face (the map's X runs the other way from the game's).
    const p = this.source.player();
    const m = this.toMap(p.x, p.z);
    const s = this.toScreen(m.x, m.z);
    const ax = -Math.sin(p.heading);
    const ay = -Math.cos(p.heading);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(Math.atan2(ay, ax) + Math.PI / 2);
    ctx.fillStyle = '#ff6a3d';
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    if (p.altitude !== null) {
      const text = `${Math.round(p.altitude)} m up`;
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillText(text, s.x + 1, s.y + 17);
      ctx.fillStyle = '#ff6a3d';
      ctx.fillText(text, s.x, s.y + 16);
      ctx.textAlign = 'left';
    }
    this.readout.textContent = `${name} · ${Math.round(m.x)}, ${Math.round(m.z)}${p.altitude !== null ? ` · ${Math.round(p.altitude)} m up` : ''} · ${(this.scale * 100).toFixed(0)} m per 100 px · drag, wheel, double-click to centre, click a place to go`;
  }

  // ---- Space: the zone in three axes, turned and zoomed. ----

  private bind3d(): void {
    const c = this.canvas3d;
    c.addEventListener('pointerdown', (e) => {
      this.dragging = e.button === 0;
      this.panning3d = e.button === 2;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      c.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerleave', () => {
      this.hover.x = -1;
      this.tip.hidden = true;
    });
    c.addEventListener('pointermove', (e) => {
      this.hover.x = e.offsetX;
      this.hover.y = e.offsetY;
      if (!this.dragging && !this.panning3d) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (this.dragging) {
        this.orbit.yaw -= dx * 0.006;
        this.orbit.pitch = THREE.MathUtils.clamp(this.orbit.pitch + dy * 0.006, -1.4, 1.4);
      } else {
        // Slide the point looked at across the screen.
        const perPixel = (2 * this.orbit.distance * Math.tan(THREE.MathUtils.degToRad(this.camera3d.fov) / 2)) / Math.max(1, c.clientHeight);
        const right = new THREE.Vector3().setFromMatrixColumn(this.camera3d.matrixWorld, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(this.camera3d.matrixWorld, 1);
        this.target3d.addScaledVector(right, -dx * perPixel).addScaledVector(up, dy * perPixel);
        this.followed = false;
      }
    });
    const up = () => {
      this.dragging = false;
      this.panning3d = false;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.orbit.distance = THREE.MathUtils.clamp(this.orbit.distance * (e.deltaY > 0 ? 1.15 : 1 / 1.15), 60, 30000);
    }, { passive: false });
    c.addEventListener('dblclick', () => {
      this.followed = false;
    });
  }

  private rebuild3d(packId: string): void {
    this.objectsFor = packId;
    if (this.rocks) {
      this.scene3d.remove(this.rocks);
      this.rocks.geometry.dispose();
      (this.rocks.material as THREE.Material).dispose();
      this.rocks = null;
    }
    for (const s of [...this.stations.children]) {
      this.stations.remove(s);
      (s as THREE.Mesh).geometry.dispose();
    }
    const objects = this.source.objects();
    this.objectCount = objects.length;
    const pos: number[] = [];
    for (const o of objects) {
      if (o.station) {
        const m = new THREE.Mesh(new THREE.OctahedronGeometry(Math.max(80, o.radius * 0.6)), new THREE.MeshBasicMaterial({ color: 0xffd27f, wireframe: true }));
        m.position.set(o.x, o.y, o.z);
        m.name = o.name ?? 'station';
        this.stations.add(m);
      } else pos.push(o.x, o.y, o.z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.rocks = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9aa7b8, size: 3, sizeAttenuation: false }));
    this.scene3d.add(this.rocks);
  }

  private draw3d(): void {
    const c = this.canvas3d;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    if (!this.renderer3d) {
      this.renderer3d = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true });
      this.renderer3d.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    }
    const r = this.renderer3d;
    if (c.width !== Math.round(w * r.getPixelRatio()) || c.height !== Math.round(h * r.getPixelRatio())) {
      r.setSize(w, h, false);
      this.camera3d.aspect = w / h;
      this.camera3d.updateProjectionMatrix();
    }
    const here = this.source.here();
    // Built once per zone, and again while the zone's objects are still arriving.
    if (this.objectsFor !== here.packId || (this.objectCount === 0 && this.frame % 30 === 0)) this.rebuild3d(here.packId);
    // The ships: cones the way each points, the player's in orange; a dashed line from the player's down to the zone's plane.
    for (const s of [...this.shipMarks.children]) {
      this.shipMarks.remove(s);
      (s as THREE.Mesh).geometry.dispose();
    }
    const ships = this.source.ships();
    const size = Math.max(12, this.orbit.distance * 0.012);
    for (const s of ships) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(size * 0.5, size * 1.6, 8), new THREE.MeshBasicMaterial({ color: s.mine ? 0xff6a3d : 0x7fd7ff }));
      m.geometry.rotateX(Math.PI / 2);
      m.position.set(s.x, s.y, s.z);
      m.quaternion.copy(s.quaternion);
      m.name = s.label;
      this.shipMarks.add(m);
    }
    const me = ships.find((s) => s.mine) ?? { x: 0, y: 0, z: 0 };
    if (!this.followed) {
      this.target3d.set(me.x, me.y, me.z);
      this.followed = true;
    }
    const dropPos = this.drop.geometry.getAttribute('position') as THREE.BufferAttribute;
    dropPos.setXYZ(0, me.x, me.y, me.z);
    dropPos.setXYZ(1, me.x, 0, me.z);
    dropPos.needsUpdate = true;
    this.drop.computeLineDistances();
    const o = this.orbit;
    this.camera3d.position.set(this.target3d.x + o.distance * Math.cos(o.pitch) * Math.sin(o.yaw), this.target3d.y + o.distance * Math.sin(o.pitch), this.target3d.z + o.distance * Math.cos(o.pitch) * Math.cos(o.yaw));
    this.camera3d.lookAt(this.target3d);
    r.render(this.scene3d, this.camera3d);
    this.hover3d(w, h);
    const p = this.source.player();
    const heading = Math.round((THREE.MathUtils.radToDeg(p.heading) % 360 + 360) % 360);
    this.readout.textContent = `${here.name} · ${Math.round(-p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)} · heading ${heading}° · ${this.objectCount} objects · drag turns, right-drag slides, wheel zooms`;
    this.frame++;
  }

  /** Name what the cursor rests on: a rock, a station, a ship. */
  private hover3d(w: number, h: number): void {
    if (this.hover.x < 0 || this.dragging || this.panning3d) {
      this.tip.hidden = true;
      return;
    }
    const ndc = new THREE.Vector2((this.hover.x / w) * 2 - 1, -(this.hover.y / h) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera3d);
    // A dot is a few pixels wide: it is hit within a few pixels' worth of the distance to it.
    this.raycaster.params.Points.threshold = this.orbit.distance * 0.008;
    let label: string | null = null;
    const ships = this.raycaster.intersectObjects(this.shipMarks.children, false);
    if (ships.length) label = ships[0].object.name;
    if (!label) {
      const stations = this.raycaster.intersectObjects(this.stations.children, false);
      if (stations.length) label = stations[0].object.name;
    }
    if (!label && this.rocks) {
      const rocks = this.raycaster.intersectObject(this.rocks, false);
      if (rocks.length) label = 'asteroid';
    }
    if (!label) {
      this.tip.hidden = true;
      return;
    }
    this.tip.textContent = label;
    this.tip.hidden = false;
    this.tip.style.left = `${this.hover.x + 14}px`;
    this.tip.style.top = `${this.hover.y + 10}px`;
  }
}
