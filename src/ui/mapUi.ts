// The map window (M): where you are. On a planet, the client's own map of it (the picture the
// game's planetary map showed) with its places marked and you on it, panned and zoomed with the
// mouse, an altitude under your mark when flying; in space, a three-axis picture of the zone's
// rocks, stations and ships round your own, turned, slid and zoomed with the mouse, its stations,
// hyperspace points, launch point, asteroid fields and nebulae drawn as layers that can be switched
// on and off, each with the client's own zone-map icon where the pack has it. The galaxy, to
// travel, is the window's other tab.
//
// The space view holds its own follow flag: it follows your ship until you slide the view, and F or
// the Follow button puts it back. Nothing three draws is made during a frame: every mark, shell,
// line, cone and label comes from a pool (`spaceMapLayers.ts`), grown to what a zone wants when its
// marks are read, and only moved after. The frame does still write a handful of strings, and only
// when what they say has changed: the readout, and a label whose name, layer or place in pixels is
// not the one it was placed at last.

import * as THREE from 'three';
import type { GalaxyMap, Poi } from './galaxyMap';
import { distanceText, drawnAsLine, drawnAsShell, hasLayer, LAYERS, MapView, marksOf, ObjectList, Pool, poolWants, ShipList, VIEW_TUNE, type LayerId, type MapMark, type MapPack, type ShipMark } from './spaceMapLayers.ts';

/** Where the player is and what is round them, read fresh every time the map draws. */
export interface MapSource {
  /** The world the player is on: its pack (for the map image and the places), its name, and whether it is a space zone. */
  here(): { packId: string; name: string; space: boolean };
  /** The player (or the ship they are in), in the game's coordinates: metres, heading in radians, and, when flying, the height over the ground. */
  player(): { x: number; y: number; z: number; heading: number; altitude: number | null };
  /** The pack's layout centre in the game's own coordinates (the snapshot's), which the map image and the places are in. */
  center(): { x: number; z: number } | null;
  pois(packId: string): Promise<Poi[]>;
  /** The zone's placed objects, in the game's coordinates: the rocks and the stations' hulls. Read once per zone, into the list the map owns. */
  objects(out: ObjectList): void;
  /** The ships about (and the player on foot), in any order, each named for the cursor, into the list the map owns. */
  ships(out: ShipList): void;
  /** The space zone's own pack (space.json), which the map's layers are read from; null on a planet and before it loads. */
  pack(): MapPack | null;
  /** Whether the player is at a ship's controls in space, so a place on the map can be jumped to. */
  piloting(): boolean;
  /**
   * Open the System Map to jump; `destination` is the place picked on the map (`<zone>:<id>`).
   * Nothing carries that pick into the System Map's own choice yet — it opens on the system flown
   * in with the first place in its list picked — so nothing built on this may assume it arrives
   * picked until the System Map takes one.
   */
  onHyperspace(destination: string): void;
  onTeleport(poi: Poi): void;
}

interface MapImage {
  image: HTMLImageElement;
  width: number;
}

type Tab = 'here' | 'galaxy';

/** A label from the pool, with the pixels it was last placed at: a mark that has not moved writes nothing. */
type LabelEl = HTMLElement & { placedX?: number; placedY?: number };

/** A place drawn no larger than this (metres) is a dot; larger ones get a ring of their own size. */
const POI_RING_MIN = 200;

/**
 * Invented: how big the space map draws what it shows, how easily it is clicked, and how often it
 * writes what changes slowly. Every number here is ours, tuned by eye against the zones' own
 * distances, and every one is live through
 * `__debug.spaceMap({ shipSize, pointSize, shipMin, pointMin, stationMin, stationScale, shellMin,
 * fieldOpacity, nebulaOpacity, pickPixels, pickLine, hoverMove, rockRetry, selectEvery })`; the
 * mouse's own numbers are `VIEW_TUNE` in `spaceMapLayers.ts`, tuned through the same call.
 */
const MARK_TUNE = {
  /** A ship's cone, as a share of the distance looked at, so it stays the same size on screen. */
  shipSize: 0.012,
  /** A hyperspace point's and the launch point's marker, the same way. */
  pointSize: 0.009,
  /** A ship's cone is never smaller than this many metres, so a close view still shows it. */
  shipMin: 12,
  /** A point's marker, the same way. */
  pointMin: 8,
  /** A station is drawn at its own size, but never smaller than this many metres. */
  stationMin: 80,
  /** How much of a station's own radius its mark is drawn at. */
  stationScale: 0.6,
  /** A field's or a nebula's shell is never smaller than this many metres. */
  shellMin: 50,
  /** How faint an asteroid field's shell is. */
  fieldOpacity: 0.16,
  /** How faint a nebula's shell is, over its own colour. */
  nebulaOpacity: 0.13,
  /** How near the cursor a mark's middle must be, in screen pixels, to be the one picked. */
  pickPixels: 12,
  /** A belt's line is picked within this share of the distance looked at (a few pixels' worth). */
  pickLine: 0.008,
  /** A rock is picked within this share of the distance looked at. */
  pickRock: 0.008,
  /** The cursor is asked again when the camera has moved this share of the distance looked at. */
  hoverMove: 0.002,
  /** Frames between tries at reading a zone's placed objects while none have arrived. */
  rockRetry: 30,
  /** Frames between writings of the picked mark's distance. */
  selectEvery: 15,
};

/** Invented: how many marks the map will name at once (the labels are HTML, made once and moved). */
const LABEL_POOL = 48;

/**
 * Invented: a spline field is drawn through at most this many control points. None read has more
 * than a dozen, so this is only a cap on what a line's buffer must hold.
 */
const SPLINE_POINTS = 64;

/**
 * Invented: the picture the marks stand in, read once when the map is built and therefore not live.
 * The grid is a little wider than a zone's own reach, a square every 500 m, and the axes are drawn
 * long enough to read against it; a shell is a sphere of this many segments, which is as coarse as
 * a wireframe can be before it stops reading as a ball.
 */
const MAP_BUILD = { gridSize: 24000, gridSquares: 48, axes: 1500, shellSegments: 16, shellRings: 10 };

/** The layers that are on when the map is first opened. */
const LAYERS_ON: readonly LayerId[] = ['stations', 'points', 'launch', 'fields', 'nebulae', 'ships'];

/** The colour each layer is drawn and named in, as three wants it and as CSS wants it. */
const LAYER_COLOURS: Record<LayerId, number> = { stations: 0xffd27f, points: 0x9fe8a0, launch: 0xffffff, fields: 0x9aa7b8, nebulae: 0xc08fff, ships: 0x7fd7ff };
const LAYER_CSS: Record<LayerId, string> = { stations: '#ffd27f', points: '#9fe8a0', launch: '#ffffff', fields: '#9aa7b8', nebulae: '#c08fff', ships: '#7fd7ff' };

/** The space view's own styles, added once so nothing outside this file has to carry them. */
const SPACE_MAP_CSS = `
.map-layers { position: absolute; left: 10px; top: 10px; display: flex; flex-direction: column; gap: 3px; padding: 8px 10px; font-size: 11px; color: var(--text); background: color-mix(in srgb, var(--void) 72%, transparent); border: 1px solid var(--panel-border); border-radius: 6px; }
.map-layers[hidden] { display: none; }
.map-layers label { display: flex; align-items: center; gap: 6px; cursor: pointer; white-space: nowrap; }
.map-layers .follow { margin-top: 5px; padding: 3px 8px; font-size: 11px; background: color-mix(in srgb, var(--pool) 35%, transparent); color: var(--text); border: 1px solid var(--accent); border-radius: 4px; cursor: pointer; }
.map-layers .follow.on { background: color-mix(in srgb, var(--pool) 70%, transparent); }
.map-labels { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.map-labels[hidden] { display: none; }
.map-label { position: absolute; left: 0; top: 0; display: flex; align-items: center; gap: 4px; padding: 1px 5px 1px 3px; font-size: 11px; color: var(--text); text-shadow: 0 1px 2px var(--void); white-space: nowrap; }
.map-label[hidden] { display: none; }
.map-label i { display: block; width: 14px; height: 14px; background: no-repeat center / contain; border-radius: 2px; }
.map-label i.plain { width: 6px; height: 6px; margin: 0 4px; background: currentColor; }
.map-select { position: absolute; right: 10px; top: 10px; width: 230px; padding: 9px 11px; font-size: 11px; color: var(--text); background: color-mix(in srgb, var(--void) 82%, transparent); border: 1px solid var(--panel-border); border-radius: 6px; }
.map-select[hidden] { display: none; }
.map-select h4 { margin: 0 0 3px; font-size: 13px; color: var(--accent); }
.map-select p { margin: 0 0 6px; color: var(--muted); line-height: 1.45; max-height: 7.5em; overflow: hidden; }
.map-select button { margin-right: 5px; padding: 3px 8px; font-size: 11px; background: color-mix(in srgb, var(--pool) 35%, transparent); color: var(--text); border: 1px solid var(--accent); border-radius: 4px; cursor: pointer; }
.map-select button[disabled] { opacity: 0.4; cursor: default; }
`;

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
  /** Where the space view looks and whether it follows the ship: its own flag, never the 2D map's. */
  private readonly view = new MapView();
  private rocks: THREE.Points | null = null;
  /** The marks, in three groups so the cursor can be asked what it rests on without walking the scene. */
  private readonly markGroup = new THREE.Group();
  private readonly shellGroup = new THREE.Group();
  private readonly shipMarks = new THREE.Group();
  private readonly splineGroup = new THREE.Group();
  /** The groups a pick asks, in the order it asks them, so asking makes no array. */
  private readonly pickGroups: THREE.Group[] = [];
  private readonly drop: THREE.Line;
  private objectsFor = '';
  private objectCount = 0;
  private panning3d = false;
  /** What the cursor is over in the space view, named beside it. */
  private readonly tip = document.createElement('div');
  private readonly raycaster = new THREE.Raycaster();
  private readonly hover = { x: -1, y: -1 };
  /** True while the cursor has moved since the last time the map asked what is under it. */
  private hoverMoved = false;
  /** Where the camera stood when the cursor was last asked: it moves under a still cursor while the view follows. */
  private readonly hoverCam = new THREE.Vector3();
  // The zone's marks, read from its pack once per zone, and what is picked out of them.
  private marks: MapMark[] = [];
  private marksFor = '';
  /** False while the zone's pack has given no station: the placed hulls stand in for them meanwhile. */
  private hasStationMark = false;
  /** The pack the marks were read from: a zone's pack arrives after the zone does, and never changes after. */
  private packSeen: MapPack | null = null;
  private selected: MapMark | null = null;
  private selectedShown = '';
  /** False while the picked mark's distance line has not been written since the pick changed. */
  private selectFresh = true;
  private readonly layersOn = new Set<LayerId>(LAYERS_ON);
  // The lists the game fills each frame, and the pools that draw them.
  private readonly shipList = new ShipList();
  private readonly objectList = new ObjectList();
  private markPool!: Pool<THREE.Mesh>;
  private shellPool!: Pool<THREE.Mesh>;
  private shipPool!: Pool<THREE.Mesh>;
  private splinePool!: Pool<THREE.Line>;
  private labelPool!: Pool<HTMLElement>;
  /** The marks' own looks: one material a layer, made once. */
  private readonly markMaterials = new Map<LayerId, THREE.MeshBasicMaterial>();
  private readonly shipMine = new THREE.MeshBasicMaterial({ color: 0xff6a3d });
  private readonly shipOther = new THREE.MeshBasicMaterial({ color: 0x7fd7ff });
  /** The layer bar, the labels over the canvas, and the panel for what is picked. */
  private readonly layerBar = document.createElement('div');
  private readonly labelLayer = document.createElement('div');
  private readonly selectBox = document.createElement('div');
  private followButton!: HTMLButtonElement;
  /** Each layer's zone-map icon as a CSS background, '' while it is still loading or the pack has none. */
  private readonly icons = new Map<LayerId, string>();
  /** Scratch, so projecting a mark to the screen and casting a ray through the cursor allocate nothing. */
  private readonly scratch = new THREE.Vector3();
  private readonly scratchNdc = new THREE.Vector2();
  /** What the space view's readout last said, part by part, so a frame that says the same writes nothing. */
  private readonly said = { name: '', x: 0, y: 0, z: 0, heading: 0, objects: -1, follow: false };

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
    this.labelLayer.className = 'map-labels';
    this.labelLayer.hidden = true;
    this.hereBody.appendChild(this.labelLayer);
    this.buildLayerBar();
    this.buildSelectBox();
    this.hereBody.appendChild(this.tip);
    this.ctx = this.canvas2d.getContext('2d')!;
    // The galaxy tab's body, made by the galaxy map into the panel. The 3D canvas is shared with the
    // space view and moved between the two bodies as the tabs change, so the window keeps one
    // renderer and the game one map context; the galaxy takes the mouse through a layer of its own
    // over the canvas, so the space view's own listeners never see a galaxy drag.
    galaxy.root.remove();
    panel.appendChild(galaxy.root);
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.tabs .tab')) b.addEventListener('click', () => this.showTab(b.dataset.tab as Tab));
    this.root.querySelector('.close')!.addEventListener('click', () => this.onClose());
    this.bind2d();
    this.bind3d();
    const drop = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    // A dashed line needs the distance along it at each end. `computeLineDistances` builds a new
    // attribute every time it is called, which a frame must not do, so the attribute is made here
    // and the far end's distance is written straight into it each frame.
    drop.setAttribute('lineDistance', new THREE.BufferAttribute(new Float32Array(2), 1));
    this.drop = new THREE.Line(drop, new THREE.LineDashedMaterial({ color: 0xff6a3d, dashSize: 40, gapSize: 25 }));
    this.scene3d.add(this.markGroup, this.shellGroup, this.splineGroup, this.shipMarks, this.drop);
    this.pickGroups.push(this.markGroup, this.shellGroup, this.splineGroup);
    const grid = new THREE.GridHelper(MAP_BUILD.gridSize, MAP_BUILD.gridSquares, 0x2d7fd6, 0x1a3a55);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    this.scene3d.add(grid, new THREE.AxesHelper(MAP_BUILD.axes));
    this.buildPools();
    // F follows the ship again. The window has the mouse while the map is open, so the game reads no
    // key of its own meanwhile; this listener does nothing unless the space view is the one showing.
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyF' || !this.open || this.tab !== 'here' || this.canvas3d.hidden) return;
      this.view.followShip();
      e.preventDefault();
    });
  }

  /** The layer boxes and the Follow button, made once. */
  private buildLayerBar(): void {
    // The space view's own styles live with the view rather than in the sheet every other panel shares.
    if (!document.getElementById('space-map-style')) {
      const style = document.createElement('style');
      style.id = 'space-map-style';
      style.textContent = SPACE_MAP_CSS;
      document.head.appendChild(style);
    }
    this.layerBar.className = 'map-layers';
    this.layerBar.hidden = true;
    for (const layer of LAYERS) {
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = this.layersOn.has(layer.id);
      box.addEventListener('change', () => {
        if (box.checked) this.layersOn.add(layer.id);
        else this.layersOn.delete(layer.id);
        if (this.selected && !this.layersOn.has(this.selected.layer)) this.select(null);
      });
      label.appendChild(box);
      label.appendChild(document.createTextNode(layer.label));
      this.layerBar.appendChild(label);
      void this.loadIcon(layer.id, layer.icon);
    }
    this.followButton = document.createElement('button');
    this.followButton.className = 'follow on';
    this.followButton.textContent = 'Follow (F)';
    this.followButton.addEventListener('click', () => this.view.followShip());
    this.layerBar.appendChild(this.followButton);
    this.hereBody.appendChild(this.layerBar);
  }

  /** The panel for what is picked on the space map, made once; its text is written when the pick changes. */
  private buildSelectBox(): void {
    this.selectBox.className = 'map-select';
    this.selectBox.hidden = true;
    this.selectBox.innerHTML = '<h4></h4><p class="where"></p><p class="desc"></p><button class="centre">Centre</button><button class="jump">Hyperspace…</button>';
    this.selectBox.querySelector<HTMLButtonElement>('.centre')!.addEventListener('click', () => {
      const m = this.selected;
      if (m) this.view.centreOn(m.x, m.y, m.z);
    });
    this.selectBox.querySelector<HTMLButtonElement>('.jump')!.addEventListener('click', () => {
      const d = this.selected?.destination;
      if (d && this.source.piloting()) this.source.onHyperspace(d);
    });
    this.hereBody.appendChild(this.selectBox);
  }

  /**
   * The zone-map icon a layer is drawn with, from the pack the `space` command writes. A pack
   * converted before the icons (and a dev server that answers a missing file with its index page)
   * simply leaves the layer with a plain coloured dot.
   */
  private loadIcon(layer: LayerId, name: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const url = `${import.meta.env.BASE_URL}assets-private/space_ui/${name}.png`;
      const img = new Image();
      img.onload = () => {
        this.icons.set(layer, `url("${url}")`);
        resolve();
      };
      img.onerror = () => resolve();
      img.src = url;
    });
  }

  /** Every drawn thing the space view can want, made the first frame that wants it and moved after. */
  private buildPools(): void {
    for (const layer of LAYERS) this.markMaterials.set(layer.id, new THREE.MeshBasicMaterial({ color: LAYER_COLOURS[layer.id], wireframe: true }));
    const markGeometry = new THREE.OctahedronGeometry(1);
    this.markPool = new Pool<THREE.Mesh>(
      () => {
        const m = new THREE.Mesh(markGeometry, this.markMaterials.get('stations')!);
        this.markGroup.add(m);
        return m;
      },
      (m, on) => (m.visible = on),
    );
    const shellGeometry = new THREE.SphereGeometry(1, MAP_BUILD.shellSegments, MAP_BUILD.shellRings);
    this.shellPool = new Pool<THREE.Mesh>(
      () => {
        // A shell owns its material, because a nebula wears its own colour; it is made once and only
        // ever has its colour and its opacity written. It is drawn from the back as well as the
        // front, so a nebula the view is inside still shows, and can still be named and picked.
        const m = new THREE.Mesh(shellGeometry, new THREE.MeshBasicMaterial({ color: 0x9aa7b8, wireframe: true, transparent: true, opacity: MARK_TUNE.fieldOpacity, depthWrite: false, side: THREE.DoubleSide }));
        this.shellGroup.add(m);
        return m;
      },
      (m, on) => (m.visible = on),
    );
    const cone = new THREE.ConeGeometry(0.5, 1.6, 8);
    cone.rotateX(Math.PI / 2);
    this.shipPool = new Pool<THREE.Mesh>(
      () => {
        const m = new THREE.Mesh(cone, this.shipOther);
        this.shipMarks.add(m);
        return m;
      },
      (m, on) => (m.visible = on),
    );
    this.splinePool = new Pool<THREE.Line>(
      () => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPLINE_POINTS * 3), 3));
        const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x9aa7b8, transparent: true, opacity: 0.5 }));
        line.frustumCulled = false;
        this.splineGroup.add(line);
        return line;
      },
      (l, on) => (l.visible = on),
    );
    this.labelPool = new Pool<HTMLElement>(
      () => {
        const el = document.createElement('div');
        el.className = 'map-label';
        el.innerHTML = '<i></i><b></b>';
        this.labelLayer.appendChild(el);
        return el;
      },
      (el, on) => (el.hidden = !on),
    );
  }

  onClose: () => void = () => {};

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  show(tab: Tab = 'here'): void {
    this.root.classList.remove('hidden');
    this.followed = false;
    this.view.followShip();
    this.attachDebug();
    this.showTab(tab);
  }

  /**
   * `__debug.spaceMap()` the first time the map opens: the view's state and the numbers we invented for
   * it, and an object retunes them live. The hook is added here rather than where the rest of `__debug`
   * is built, so nothing outside this file carries the map's own knobs.
   */
  private attachDebug(): void {
    const w = window as unknown as { __debug?: Record<string, unknown> };
    if (!w.__debug || w.__debug.spaceMap) return;
    w.__debug.spaceMap = (tune?: Partial<typeof MARK_TUNE> & Partial<typeof VIEW_TUNE>) => {
      if (tune) {
        for (const k of Object.keys(MARK_TUNE) as (keyof typeof MARK_TUNE)[]) {
          const v = tune[k];
          if (typeof v === 'number' && Number.isFinite(v)) MARK_TUNE[k] = v;
        }
        for (const k of Object.keys(VIEW_TUNE) as (keyof typeof VIEW_TUNE)[]) {
          const v = tune[k];
          if (typeof v === 'number' && Number.isFinite(v)) VIEW_TUNE[k] = v;
        }
      }
      return {
        follow: this.view.follow,
        target: { ...this.view.target },
        orbit: { ...this.view.orbit },
        layers: [...this.layersOn],
        marks: this.marks.length,
        selected: this.selected?.name ?? null,
        icons: this.icons.size,
        pools: { marks: this.markPool.made, shells: this.shellPool.made, splines: this.splinePool.made, ships: this.shipPool.made, labels: this.labelPool.made, shipEntries: this.shipList.made },
        tune: { ...MARK_TUNE, ...VIEW_TUNE },
      };
    };
  }

  hide(): void {
    this.root.classList.add('hidden');
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    // The galaxy tab reads the jump's refusals on a clock of its own while it shows: closing the
    // window on that tab stops it, and opening it again starts it.
    this.galaxy.hide();
  }

  setCurrent(id: string, zone?: string): void {
    this.galaxy.setCurrent(id, zone);
  }

  private showTab(tab: Tab): void {
    this.tab = tab;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('.tabs .tab')) b.classList.toggle('on', b.dataset.tab === tab);
    this.hereBody.hidden = tab !== 'here';
    if (tab === 'galaxy') {
      // The one 3D canvas goes to whichever tab is drawing. It keeps its context across the move, and
      // the renderer is sized from whatever holds it on the next frame.
      this.canvas3d.hidden = false;
      this.galaxy.attachCanvas(this.canvas3d);
      this.galaxy.show();
    } else {
      this.hereBody.insertBefore(this.canvas3d, this.labelLayer);
      this.galaxy.hide();
    }
    this.readout.textContent = '';
    // The space view only writes the line when what it says has changed, so emptying it here has to
    // forget what it last said or it would never be written again.
    this.said.objects = -1;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.loop();
  }

  private loop(): void {
    if (!this.open) return;
    if (this.tab === 'galaxy') this.galaxy.drawView(this.mapRenderer());
    else this.draw();
    this.raf = requestAnimationFrame(() => this.loop());
  }

  /**
   * The map window's own renderer, made on the first frame that wants it. The space view makes the
   * same one where it draws first; whichever tab is opened first builds it, and both draw with it.
   */
  private mapRenderer(): THREE.WebGLRenderer {
    if (!this.renderer3d) {
      this.renderer3d = new THREE.WebGLRenderer({ canvas: this.canvas3d, antialias: true, alpha: true });
      this.renderer3d.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    }
    return this.renderer3d;
  }

  private draw(): void {
    const here = this.source.here();
    this.canvas2d.hidden = here.space;
    this.canvas3d.hidden = !here.space;
    this.layerBar.hidden = !here.space;
    this.labelLayer.hidden = !here.space;
    if (!here.space) {
      this.selectBox.hidden = true;
      this.tip.hidden = true;
    }
    // The world is asked once a frame and handed on, rather than asked again by the space view.
    if (here.space) this.draw3d(here.packId, here.name);
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
      this.panning3d = e.button === 2 || e.button === 1;
      this.dragMoved = false;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      c.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerleave', () => {
      this.hover.x = -1;
      this.hoverMoved = true;
      this.tip.hidden = true;
    });
    c.addEventListener('pointermove', (e) => {
      this.hover.x = e.offsetX;
      this.hover.y = e.offsetY;
      this.hoverMoved = true;
      if (!this.dragging && !this.panning3d) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) this.dragMoved = true;
      if (this.dragging) this.view.turn(dx, dy);
      else {
        // Slide the point looked at across the screen: the camera's own right and up, and the metres
        // one pixel covers at the distance looked at.
        const perPixel = (2 * this.view.orbit.distance * Math.tan(THREE.MathUtils.degToRad(this.camera3d.fov) / 2)) / Math.max(1, c.clientHeight);
        const m = this.camera3d.matrixWorld.elements;
        this.view.pan(dx, dy, perPixel, m[0], m[1], m[2], m[4], m[5], m[6]);
      }
    });
    const up = (e: PointerEvent) => {
      const clicked = this.dragging && !this.dragMoved;
      this.dragging = false;
      this.panning3d = false;
      // A click, not a drag: what is under it is picked, and empty space clears the pick.
      if (clicked) this.select(this.markAt(e.offsetX, e.offsetY));
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', () => {
      this.dragging = false;
      this.panning3d = false;
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const steps = e.deltaY > 0 ? 1 : -1;
      // The wheel always zooms toward the point under the cursor, so what is under it stays under
      // it. While the view follows a ship this reads as a zoom about the ship: the next frame puts
      // the point looked at back on it before the camera is placed.
      this.rayThrough(e.offsetX, e.offsetY);
      this.raycaster.ray.at(this.view.orbit.distance, this.scratch);
      this.view.zoomToward(steps, this.scratch.x, this.scratch.y, this.scratch.z);
    }, { passive: false });
    c.addEventListener('dblclick', (e) => {
      const m = this.markAt(e.offsetX, e.offsetY);
      if (m) {
        this.select(m);
        this.view.centreOn(m.x, m.y, m.z);
      }
    });
  }

  /** The picking ray through a point on the space canvas, into the raycaster (nothing allocated). */
  private rayThrough(x: number, y: number): void {
    const w = this.canvas3d.clientWidth || 1;
    const h = this.canvas3d.clientHeight || 1;
    this.scratchNdc.set((x / w) * 2 - 1, -(y / h) * 2 + 1);
    this.raycaster.setFromCamera(this.scratchNdc, this.camera3d);
  }

  /** The mark under a point on the space canvas, nearest first, or null. */
  private markAt(x: number, y: number): MapMark | null {
    // A mark is small on screen — a hyperspace point is a few pixels tall at any zoom — so the pick
    // is made in screen space first: the nearest mark's middle within `pickPixels` of the cursor
    // wins, whatever it is drawn as. (The ray's own `params` are per shape and did nothing here.)
    const w = this.canvas3d.clientWidth || 1;
    const h = this.canvas3d.clientHeight || 1;
    let best: MapMark | null = null;
    let bestD = MARK_TUNE.pickPixels;
    for (let i = 0; i < this.marks.length; i++) {
      const mk = this.marks[i];
      if (!this.layersOn.has(mk.layer)) continue;
      this.scratch.set(mk.x, mk.y, mk.z).project(this.camera3d);
      if (this.scratch.z > 1) continue;
      const d = Math.hypot((this.scratch.x * 0.5 + 0.5) * w - x, (-this.scratch.y * 0.5 + 0.5) * h - y);
      if (d < bestD) {
        bestD = d;
        best = mk;
      }
    }
    if (best) return best;
    // Then the ray, for the big things one clicks anywhere on: a shell's wall, or a belt's line.
    this.rayThrough(x, y);
    this.raycaster.params.Line.threshold = this.view.orbit.distance * MARK_TUNE.pickLine;
    for (const group of this.pickGroups) {
      const hits = this.raycaster.intersectObjects(group.children, false);
      for (const hit of hits) {
        if (!hit.object.visible) continue;
        const i = hit.object.userData.markIndex as number | undefined;
        if (i !== undefined && i >= 0 && this.marks[i]) return this.marks[i];
      }
    }
    return null;
  }

  /** Pick a mark (or nothing): the panel beside the map says what it is and what can be done with it. */
  private select(mark: MapMark | null): void {
    this.selected = mark;
    this.selectBox.hidden = !mark;
    this.selectFresh = false;
    if (!mark) {
      this.selectedShown = '';
      return;
    }
    if (this.selectedShown === mark.key) return;
    this.selectedShown = mark.key;
    this.selectBox.querySelector('h4')!.textContent = mark.name + (mark.invented ? ' (made up)' : '');
    this.selectBox.querySelector('.desc')!.textContent = mark.description;
    const jump = this.selectBox.querySelector<HTMLButtonElement>('.jump')!;
    jump.hidden = !mark.destination;
  }

  /** The zone's rocks as one cloud of points; its stations and the rest are marks from its pack. */
  private rebuild3d(packId: string): void {
    this.objectsFor = packId;
    if (this.rocks) {
      this.scene3d.remove(this.rocks);
      this.rocks.geometry.dispose();
      (this.rocks.material as THREE.Material).dispose();
      this.rocks = null;
    }
    this.objectList.begin();
    this.source.objects(this.objectList);
    this.objectCount = this.objectList.length;
    const pos = new Float32Array(this.objectList.length * 3);
    let n = 0;
    for (let i = 0; i < this.objectList.length; i++) {
      const o = this.objectList.items[i];
      if (o.station) continue;
      pos[n++] = o.x;
      pos[n++] = o.y;
      pos[n++] = o.z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, n), 3));
    this.rocks = new THREE.Points(g, new THREE.PointsMaterial({ color: 0x9aa7b8, size: 3, sizeAttenuation: false }));
    this.scene3d.add(this.rocks);
    // While the zone's pack has named no station, its placed hulls stand in for them: they are
    // counted here, where they arrive, rather than by the frame that first draws them.
    if (!this.hasStationMark) this.markPool.grow(poolWants(this.marks, LABEL_POOL).marks + this.stationObjects());
  }

  /** The zone's marks, read from its pack once: it is fetched once per zone and never changes after. */
  private rebuildMarks(packId: string, pack: MapPack | null): void {
    this.marksFor = packId;
    this.packSeen = pack;
    this.marks = marksOf(pack);
    this.hasStationMark = hasLayer(this.marks, 'stations');
    // Everything this zone wants is made here, with the zone's marks, rather than by whichever frame
    // first wants one more than any frame before it.
    const wants = poolWants(this.marks, LABEL_POOL);
    this.markPool.grow(wants.marks + (this.hasStationMark ? 0 : this.stationObjects()));
    this.shellPool.grow(wants.shells);
    this.splinePool.grow(wants.splines);
    this.labelPool.grow(wants.labels);
    // Whatever was picked belonged to the zone left behind.
    this.select(null);
  }

  /** How many of the zone's placed objects are a station's hull: what stands in while the pack has none. */
  private stationObjects(): number {
    let n = 0;
    for (let i = 0; i < this.objectList.length; i++) if (this.objectList.items[i].station) n++;
    return n;
  }

  private draw3d(packId: string, name: string): void {
    const c = this.canvas3d;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    if (!this.renderer3d) {
      this.renderer3d = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true });
      this.renderer3d.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    }
    const r = this.renderer3d;
    const resized = c.width !== Math.round(w * r.getPixelRatio()) || c.height !== Math.round(h * r.getPixelRatio());
    if (resized || this.camera3d.far !== VIEW_TUNE.far) {
      if (resized) {
        r.setSize(w, h, false);
        this.camera3d.aspect = w / h;
      }
      this.camera3d.far = VIEW_TUNE.far;
      this.camera3d.updateProjectionMatrix();
    }
    // Built once per zone, and again while the zone's objects are still arriving.
    if (this.objectsFor !== packId || (this.objectCount === 0 && this.frame % Math.max(1, MARK_TUNE.rockRetry) === 0)) this.rebuild3d(packId);
    const pack = this.source.pack();
    if (this.marksFor !== packId || this.packSeen !== pack) this.rebuildMarks(packId, pack);
    // The ships: cones the way each points, the player's in orange. Your own always shows, so the view
    // has something to follow even with the ships layer off.
    this.shipList.begin();
    this.source.ships(this.shipList);
    this.shipPool.begin();
    const shipsOn = this.layersOn.has('ships');
    const shipSize = Math.max(MARK_TUNE.shipMin, this.view.orbit.distance * MARK_TUNE.shipSize);
    let me: ShipMark | null = null;
    for (let i = 0; i < this.shipList.length; i++) {
      const s = this.shipList.items[i];
      if (s.mine) me = s;
      if (!shipsOn && !s.mine) continue;
      const m = this.shipPool.take();
      m.position.set(s.x, s.y, s.z);
      m.quaternion.set(s.qx, s.qy, s.qz, s.qw);
      m.scale.setScalar(shipSize);
      m.material = s.mine ? this.shipMine : this.shipOther;
      m.name = s.label;
    }
    this.shipPool.end();
    // A dashed line from your own mark down to the zone's plane, so its height reads.
    this.drop.visible = !!me;
    if (me) {
      const dropPos = this.drop.geometry.getAttribute('position') as THREE.BufferAttribute;
      dropPos.setXYZ(0, me.x, me.y, me.z);
      dropPos.setXYZ(1, me.x, 0, me.z);
      dropPos.needsUpdate = true;
      // The dashes run from the plane up to the mark: the near end is 0 and stays 0.
      const dropDist = this.drop.geometry.getAttribute('lineDistance') as THREE.BufferAttribute;
      dropDist.setX(1, Math.abs(me.y));
      dropDist.needsUpdate = true;
      this.view.frameShip(me.x, me.y, me.z);
    }
    const o = this.view.orbit;
    const t = this.view.target;
    this.camera3d.position.set(t.x + o.distance * Math.cos(o.pitch) * Math.sin(o.yaw), t.y + o.distance * Math.sin(o.pitch), t.z + o.distance * Math.cos(o.pitch) * Math.cos(o.yaw));
    this.camera3d.lookAt(t.x, t.y, t.z);
    // The labels are placed from this frame's camera, so its matrices are brought up to date before
    // the marks are laid out rather than by the render that follows them.
    this.camera3d.updateMatrixWorld(true);
    this.camera3d.matrixWorldInverse.copy(this.camera3d.matrixWorld).invert();
    this.drawMarks(w, h);
    this.followButton.classList.toggle('on', this.view.follow);
    r.render(this.scene3d, this.camera3d);
    this.hover3d();
    // The picked mark's distance is written four times a second, and at once when the pick changes.
    if (this.frame % Math.max(1, MARK_TUNE.selectEvery) === 0 || !this.selectFresh) {
      this.refreshSelect(me);
      this.selectFresh = true;
    }
    this.sayWhere(name);
    this.frame++;
  }

  /** The line under the header: only written when what it says has changed. */
  private sayWhere(name: string): void {
    const p = this.source.player();
    const x = Math.round(-p.x);
    const y = Math.round(p.y);
    const z = Math.round(p.z);
    const heading = Math.round((THREE.MathUtils.radToDeg(p.heading) % 360 + 360) % 360);
    const s = this.said;
    if (s.name === name && s.x === x && s.y === y && s.z === z && s.heading === heading && s.objects === this.objectCount && s.follow === this.view.follow) return;
    s.name = name;
    s.x = x;
    s.y = y;
    s.z = z;
    s.heading = heading;
    s.objects = this.objectCount;
    s.follow = this.view.follow;
    const follow = this.view.follow ? 'following' : 'free (F follows)';
    this.readout.textContent = `${name} · ${x}, ${y}, ${z} · heading ${heading}° · ${this.objectCount} objects · ${follow} · drag turns, right-drag slides, wheel zooms, click names`;
  }

  /** Every mark of every layer that is on: its shape from a pool, and its name beside it. */
  private drawMarks(w: number, h: number): void {
    this.markPool.begin();
    this.shellPool.begin();
    this.splinePool.begin();
    this.labelPool.begin();
    const pointSize = Math.max(MARK_TUNE.pointMin, this.view.orbit.distance * MARK_TUNE.pointSize);
    for (let i = 0; i < this.marks.length; i++) {
      const mk = this.marks[i];
      if (!this.layersOn.has(mk.layer)) continue;
      if (drawnAsLine(mk)) {
        // A belt is its own shape: the table's radius is how thick it is, not how far it reaches,
        // so a shell of that radius at its centre would be a ball at one end of it.
        const line = this.splinePool.take();
        const spline = mk.spline!;
        const n = Math.min(spline.length, SPLINE_POINTS);
        if (line.userData.splineKey !== mk.key) {
          line.userData.splineKey = mk.key;
          const attr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
          for (let k = 0; k < n; k++) attr.setXYZ(k, spline[k][0], spline[k][1], spline[k][2]);
          attr.needsUpdate = true;
          line.geometry.setDrawRange(0, n);
          // The line is picked by a ray, which asks the geometry for a sphere round it once.
          line.geometry.boundingSphere = null;
        }
        line.userData.markIndex = i;
      } else if (drawnAsShell(mk)) {
        const shell = this.shellPool.take();
        shell.position.set(mk.x, mk.y, mk.z);
        shell.scale.setScalar(Math.max(MARK_TUNE.shellMin, mk.radius));
        const mat = shell.material as THREE.MeshBasicMaterial;
        // The table's colours are the ones the game's artists picked on screen, so they are read as sRGB.
        if (mk.colour) mat.color.setRGB(mk.colour[0], mk.colour[1], mk.colour[2], THREE.SRGBColorSpace);
        else mat.color.setHex(LAYER_COLOURS[mk.layer]);
        mat.opacity = mk.layer === 'nebulae' ? MARK_TUNE.nebulaOpacity : MARK_TUNE.fieldOpacity;
        shell.userData.markIndex = i;
      } else {
        const mesh = this.markPool.take();
        mesh.position.set(mk.x, mk.y, mk.z);
        mesh.scale.setScalar(mk.layer === 'stations' ? Math.max(MARK_TUNE.stationMin, mk.radius * MARK_TUNE.stationScale) : pointSize);
        mesh.material = this.markMaterials.get(mk.layer)!;
        mesh.userData.markIndex = i;
      }
      this.placeLabel(mk, w, h);
    }
    // A zone's pack arrives after the zone itself, and a zone may have none: while it has given no
    // station, the hulls the game placed stand in for them, so the map never shows nothing where a
    // station is. They carry no name, so nothing can be picked out of them.
    if (this.layersOn.has('stations') && !this.hasStationMark) {
      for (let i = 0; i < this.objectList.length; i++) {
        const o = this.objectList.items[i];
        if (!o.station) continue;
        const mesh = this.markPool.take();
        mesh.position.set(o.x, o.y, o.z);
        mesh.scale.setScalar(Math.max(MARK_TUNE.stationMin, o.radius * MARK_TUNE.stationScale));
        mesh.material = this.markMaterials.get('stations')!;
        mesh.userData.markIndex = -1;
      }
    }
    this.markPool.end();
    this.shellPool.end();
    this.splinePool.end();
    this.labelPool.end();
  }

  /** A mark's name and icon over the canvas, while it is on screen and the labels are not all taken. */
  private placeLabel(mk: MapMark, w: number, h: number): void {
    if (this.labelPool.used >= LABEL_POOL) return;
    this.scratch.set(mk.x, mk.y, mk.z).project(this.camera3d);
    if (this.scratch.z > 1 || Math.abs(this.scratch.x) > 1 || Math.abs(this.scratch.y) > 1) return;
    const el = this.labelPool.take();
    const icon = el.firstElementChild as HTMLElement;
    const text = el.lastElementChild as HTMLElement;
    if (text.textContent !== mk.name) text.textContent = mk.name;
    if (el.dataset.layer !== mk.layer) {
      el.dataset.layer = mk.layer;
      el.style.color = LAYER_CSS[mk.layer];
    }
    // The client's own zone-map icon where the pack has it; a plain dot in the layer's colour where it does not.
    const url = this.icons.get(mk.layer) ?? '';
    const want = url ? '' : 'plain';
    if (icon.className !== want) icon.className = want;
    if (icon.style.backgroundImage !== url) icon.style.backgroundImage = url;
    // A label that has not moved a whole pixel is left alone, so a still picture writes no styles.
    const at = el as LabelEl;
    const px = Math.round((this.scratch.x * 0.5 + 0.5) * w) + 8;
    const py = Math.round((-this.scratch.y * 0.5 + 0.5) * h) - 8;
    if (at.placedX !== px || at.placedY !== py) {
      at.placedX = px;
      at.placedY = py;
      el.style.transform = `translate(${px}px, ${py}px)`;
    }
  }

  /** What is picked: where it is, how far off, and whether it can be jumped to from here. */
  private refreshSelect(me: ShipMark | null): void {
    const mk = this.selected;
    if (!mk) return;
    const away = me ? distanceText(Math.hypot(mk.x - me.x, mk.y - me.y, mk.z - me.z)) : '';
    const size = mk.radius > 0 ? ` · ${distanceText(mk.radius)} across at its middle` : '';
    const lanes = mk.lanes > 0 ? ` · ${mk.lanes} docking ${mk.lanes === 1 ? 'lane' : 'lanes'}` : '';
    this.selectBox.querySelector('.where')!.textContent = `${Math.round(-mk.x)}, ${Math.round(mk.y)}, ${Math.round(mk.z)}${away ? ` · ${away} off` : ''}${size}${lanes}`;
    const jump = this.selectBox.querySelector<HTMLButtonElement>('.jump')!;
    if (!jump.hidden) jump.disabled = !this.source.piloting();
  }

  /** Name what the cursor rests on: a rock, a mark, a ship. Asked again only once the cursor has moved. */
  private hover3d(): void {
    if (this.hover.x < 0 || this.dragging || this.panning3d) {
      this.tip.hidden = true;
      return;
    }
    // The picture moves under a still cursor while the view follows a ship, so what is named is
    // asked again when the camera has moved a little as well as when the cursor has — but only a
    // few times a second, since asking is the one thing here that makes anything (three hands back
    // an array of what a ray met).
    const near = this.view.orbit.distance * MARK_TUNE.hoverMove;
    const drifted = this.frame % Math.max(1, MARK_TUNE.selectEvery) === 0 && this.camera3d.position.distanceToSquared(this.hoverCam) > near * near;
    if (!this.hoverMoved && !drifted) return;
    this.hoverMoved = false;
    this.hoverCam.copy(this.camera3d.position);
    // The ships first: a nebula's shell can be kilometres across and would otherwise name every
    // ship inside it.
    this.rayThrough(this.hover.x, this.hover.y);
    let label: string | null = null;
    for (const hit of this.raycaster.intersectObjects(this.shipMarks.children, false)) {
      if (!hit.object.visible) continue;
      label = hit.object.name;
      break;
    }
    if (!label) {
      const mark = this.markAt(this.hover.x, this.hover.y);
      if (mark) label = mark.name;
    }
    if (!label && this.rocks) {
      // A rock is one point: it is hit within a few pixels' worth of the distance looked at.
      this.rayThrough(this.hover.x, this.hover.y);
      this.raycaster.params.Points.threshold = this.view.orbit.distance * MARK_TUNE.pickRock;
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
