// The galaxy, drawn: a disc of stars with every system we have standing in it at its canon square,
// the shuttle routes as faint lines between them, a ring round the system you are in and another
// round the one you have picked. Turned, slid and zoomed with the mouse, exactly as the space map is.
//
// It draws with the map window's own renderer, handed in each frame, so the game has no third WebGL
// context: the map's canvas is moved into this tab while it shows and back when it does not. Nothing
// here is made during a frame — every globe, ring, line and label is built when the view is built or
// when the routes arrive — and no texture or geometry is shared with the world's renderer, so the
// view never disposes anything the game is using.

import { projectedBehind } from '../core/depthMode.ts';
import { colourHex, onPaletteChange } from '../core/palette.ts';
import * as THREE from 'three';
import { drawnSystems, GALAXY_TUNE, systemPlace, type GalaxySystemDef, type GalaxyRoute } from '../data/galaxy.ts';
import { sampleDisc } from '../sky/night/galaxyDensity.ts';
// Pass 2, wave 4b (maker C): the globes in his looks, with cloud shells and painted rims, the game on WebGPU alone.
import { GPU } from '../core/gpuSwitch.ts';
import { GLOBE_TUNE, type GlobePictures } from './galaxyLooks.ts';
import { RIM_LIT, RIM_PROFILE_SIZE } from '../space/spaceAir.ts';

/**
 * Invented: how the galaxy view looks and how its mouse feels. Every number here is ours, and every
 * one is live through
 * `__debug.galaxy({ turnPerPixel, zoomStep, distanceMin, distanceMax, pitchLimit, far, pickPixels,
 * systemSize, ringScale, routeOpacity, startDistance, startPitch })`; the layout's own numbers
 * (`square`, `jitter`, `lift`, the disc) are `GALAXY_TUNE` in `src/data/galaxy.ts`, retuned through
 * the same call.
 */
export const GALAXY_VIEW_TUNE = {
  /** Radians the view turns per pixel dragged. */
  turnPerPixel: 0.006,
  /** What one wheel notch multiplies the distance by. */
  zoomStep: 1.15,
  distanceMin: 60,
  distanceMax: 6000,
  /** How far up or down the view may be tipped, radians. */
  pitchLimit: 1.45,
  /** How far the view sees, in the map's units. */
  far: 40000,
  /** How near the cursor a system's middle must be, in screen pixels, to be the one picked. */
  pickPixels: 16,
  /** How big a system's globe is drawn. */
  systemSize: 9,
  /** The ring round a system, as a share of the globe. */
  ringScale: 2.4,
  /** How faint a shuttle route's line is. */
  routeOpacity: 0.32,
  /** Where the view starts, so the whole galaxy is in the frame. */
  startDistance: 1900,
  startPitch: 0.8,
  /**
   * How much of itself a world or a route keeps when it cannot be flown to from here. Invented.
   *
   * Not zero: a galaxy with only three lines on it says nothing about the galaxy. The muted ones are
   * still there to read and are plainly not on offer.
   */
  muteShare: 0.28,
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** A colour dimmed toward black by a share of itself, channel by channel. */
function mute(hex: number, share: number): number {
  const r = Math.round(((hex >> 16) & 0xff) * share);
  const g = Math.round(((hex >> 8) & 0xff) * share);
  const b = Math.round((hex & 0xff) * share);
  return (r << 16) | (g << 8) | b;
}

/**
 * Where the galaxy view looks. Its own, rather than the space map's: that one's distances are a space
 * zone's metres, and the galaxy is laid out in units of its own.
 */
export class GalaxyOrbit {
  readonly target = { x: 0, y: 0, z: 0 };
  readonly orbit = { yaw: 0.5, pitch: GALAXY_VIEW_TUNE.startPitch, distance: GALAXY_VIEW_TUNE.startDistance };

  /** The Reset button: the whole galaxy in the frame again. */
  reset(): void {
    this.target.x = 0;
    this.target.y = 0;
    this.target.z = 0;
    this.orbit.yaw = 0.5;
    this.orbit.pitch = GALAXY_VIEW_TUNE.startPitch;
    this.orbit.distance = GALAXY_VIEW_TUNE.startDistance;
  }

  turn(dx: number, dy: number): void {
    this.orbit.yaw -= dx * GALAXY_VIEW_TUNE.turnPerPixel;
    this.orbit.pitch = clamp(this.orbit.pitch + dy * GALAXY_VIEW_TUNE.turnPerPixel, -GALAXY_VIEW_TUNE.pitchLimit, GALAXY_VIEW_TUNE.pitchLimit);
  }

  /** Right- or middle-drag: the point looked at slides across the screen, in the camera's own axes. */
  pan(dx: number, dy: number, perPixel: number, rx: number, ry: number, rz: number, ux: number, uy: number, uz: number): void {
    this.target.x += (-dx * rx + dy * ux) * perPixel;
    this.target.y += (-dx * ry + dy * uy) * perPixel;
    this.target.z += (-dx * rz + dy * uz) * perPixel;
  }

  zoom(steps: number): void {
    const f = Math.pow(GALAXY_VIEW_TUNE.zoomStep, steps);
    this.orbit.distance = clamp(this.orbit.distance * f, GALAXY_VIEW_TUNE.distanceMin, GALAXY_VIEW_TUNE.distanceMax);
  }

  /** The wheel over a point: what is under the cursor stays under it. */
  zoomToward(steps: number, px: number, py: number, pz: number): void {
    const before = this.orbit.distance;
    this.zoom(steps);
    const k = this.orbit.distance / before;
    this.target.x = px + (this.target.x - px) * k;
    this.target.y = py + (this.target.y - py) * k;
    this.target.z = pz + (this.target.z - pz) * k;
  }

  centreOn(x: number, y: number, z: number): void {
    this.target.x = x;
    this.target.y = y;
    this.target.z = z;
  }
}

// ---------------------------------------------------------------- the painted rim (pass 2, wave 4b, maker C)

/** The map's light as the rims read it: its way in the view's frame and its colour times its intensity (shared uniforms). */
interface RimLight {
  dir: { value: THREE.Vector3 };
  colour: { value: THREE.Color };
}

/** A rim's table (`rimProfile`: RGBA, the limb's light by height) as a half-float picture the map's renderer filters. */
function rimTexture(profile: Float32Array): THREE.DataTexture {
  const out = new Uint16Array(profile.length);
  for (let i = 0; i < profile.length; i++) out[i] = THREE.DataUtils.toHalfFloat(profile[i]);
  const t = new THREE.DataTexture(out, profile.length / 4, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

/** No rim: a table of noughts. */
function blankRimTexture(): THREE.DataTexture {
  return rimTexture(new Float32Array(4));
}

/**
 * A globe's painted rim on the map's WebGL renderer: `spaceAir.ts`' `paintedRimAt` (the Painted form of a space planet's air) in
 * the map's frame, the limb's own light by height laid over `GLOBE_TUNE.rimHeight` of the globe, lit by the map's light. Its
 * mesh stands at the rim's reach, so the ground is its radius over that reach. Added over what is behind it.
 */
function globeRimMaterial(profile: THREE.Texture, light: RimLight): THREE.ShaderMaterial {
  const n = RIM_PROFILE_SIZE;
  return new THREE.ShaderMaterial({
    name: 'galaxy globe rim',
    uniforms: { uProfile: { value: profile }, uLightDir: light.dir, uLight: light.colour, uShell: { value: GLOBE_TUNE.rimHeight }, uStrength: { value: GLOBE_TUNE.rimStrength } },
    vertexShader: /* glsl */ `
      varying vec3 vView;
      varying vec3 vCentre;
      varying float vRadius;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = mv.xyz;
        vCentre = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vRadius = length((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uProfile;
      uniform vec3 uLightDir;
      uniform vec3 uLight;
      uniform float uShell;
      uniform float uStrength;
      varying vec3 vView;
      varying vec3 vCentre;
      varying float vRadius;
      void main() {
        vec3 rd = normalize(vView);
        vec3 P = rd * dot(vCentre, rd) - vCentre;
        float ground = vRadius / uShell;
        float b = length(P);
        float rho = b / ground;
        float u = clamp((rho - 1.0) / max(uShell - 1.0, 1e-6), 0.0, 1.0);
        vec3 prof = texture2D(uProfile, vec2(sqrt(u) * ${((n - 1) / n).toFixed(6)} + ${(0.5 / n).toFixed(6)}, 0.5)).rgb;
        float graze = sqrt(max(uShell - 1.0, 0.0) * 0.5);
        float inside = rho < 1.0 ? min(1.0, graze / sqrt(max(1.0 - rho * rho, 1e-6))) : 1.0;
        float outside = 1.0 - smoothstep(uShell * 0.999, uShell, rho);
        float lit = smoothstep(${RIM_LIT.from.toFixed(3)}, ${RIM_LIT.to.toFixed(3)}, dot(P / max(b, 1e-6), uLightDir));
        gl_FragColor = vec4(prof * uLight * (inside * outside * lit * uStrength), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** A label from the pool, with the pixels it was last placed at: one that has not moved writes nothing. */
type LabelEl = HTMLElement & { placedX?: number; placedY?: number };

/** Which of a label's three looks is on: plain, the system picked, or the system you are in. */
const enum LabelLook { Plain = 0, Picked = 1, Here = 2 }

interface Globe {
  sys: GalaxySystemDef;
  mesh: THREE.Mesh;
  material: THREE.MeshLambertMaterial;
  /**
   * Pass 2, wave 4b (maker C, `galaxyLooks.ts`): with the game on WebGPU, its cloud shell and its painted rim, made with the
   * view (so the first frame's compile links their two programs) and shown once its look's pictures are on it; null on WebGL.
   */
  clouds: THREE.Mesh | null;
  rim: THREE.Mesh | null;
  /** The pictures its look laid on it (its own, freed when another comes), or null while SWG's picture stands. */
  lookTextures: THREE.DataTexture[];
  /** SWG's picture (or the blank) kept while a look is worn, put back when the look goes. */
  swgMap?: THREE.Texture | null;
  label: LabelEl;
  at: THREE.Vector3;
  /** The three class names this label can wear, built once, so a frame never joins a string. */
  looks: readonly [string, string, string];
  /** Which one it is wearing, so a frame that changes nothing writes nothing. */
  look: LabelLook;
  /** The colour it wears when it is lit: its own, or white once its own picture is on it. */
  colour?: number;
}

export class GalaxyView {
  readonly orbit = new GalaxyOrbit();
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 16 / 9, 1, GALAXY_VIEW_TUNE.far);
  private readonly globes: Globe[] = [];
  private readonly routeLines: THREE.LineSegments;
  /** The routes that cannot be flown from here: the same lines, drawn dim rather than left out. */
  private readonly mutedLines: THREE.LineSegments;
  /** Which systems may be picked, or null for all of them. */
  private reachable: ReadonlySet<string> | null = null;
  private readonly here: THREE.Mesh;
  private readonly picked: THREE.Mesh;
  private readonly disc: THREE.Points;
  private readonly scratch = new THREE.Vector3();
  private readonly scratchNdc = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  /** A one-texel white picture every globe wears from the moment it is made, so a world's own picture is only ever a swap on the same channel and nothing compiles for it. */
  private readonly blank: THREE.DataTexture;
  private hereId: string | null = null;
  private pickedId: string | null = null;
  private routes: GalaxyRoute[] = [];
  private frames = 0;
  private compiled = false;
  /** Pass 2, wave 4b (maker C): the rims' blank table, the map's light as the rims read it (its view-space way, its colour). */
  private readonly blankRim = blankRimTexture();
  private readonly sunDir = new THREE.Vector3(0.4, 1, 0.6).normalize();
  private readonly rimLight: RimLight = { dir: { value: new THREE.Vector3(0, 1, 0) }, colour: { value: new THREE.Color(0xfff0dc).multiplyScalar(2.2) } };

  private readonly labelLayer: HTMLElement;

  constructor(labelLayer: HTMLElement) {
    this.labelLayer = labelLayer;
    this.blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this.blank.needsUpdate = true;
    // Two lights, made here and never added to or taken from the scene again, so no draw of this view
    // ever makes the renderer work a program out afresh.
    const sun = new THREE.DirectionalLight(0xfff0dc, 2.2);
    sun.position.set(0.4, 1, 0.6);
    this.scene.add(sun, new THREE.AmbientLight(0x6f86b4, 0.9));
    // The disc's material is made once and kept: a retune replaces only its geometry, so the star
    // count and the shape can be tried live without a program ever being worked out again.
    this.disc = new THREE.Points(this.buildDiscGeometry(), new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false }));
    this.disc.frustumCulled = false;
    this.scene.add(this.disc);
    const sphere = new THREE.SphereGeometry(1, 24, 16);
    // Pass 2, wave 4b (maker C): the looks' cloud shells and painted rims, only with the game on WebGPU (where looks are baked).
    const withLooks = GPU.webgpu;
    const rimSphere = withLooks ? new THREE.SphereGeometry(1, 32, 20) : null;
    for (const sys of drawnSystems()) {
      const material = new THREE.MeshLambertMaterial({ color: 0xb9c6d8, map: this.blank });
      const mesh = new THREE.Mesh(sphere, material);
      mesh.userData.system = sys.id;
      this.scene.add(mesh);
      let clouds: THREE.Mesh | null = null;
      let rim: THREE.Mesh | null = null;
      if (withLooks && rimSphere) {
        clouds = new THREE.Mesh(sphere, new THREE.MeshLambertMaterial({ map: this.blank, transparent: true, depthWrite: false }));
        clouds.visible = false;
        clouds.renderOrder = 1;
        this.scene.add(clouds);
        rim = new THREE.Mesh(rimSphere, globeRimMaterial(this.blankRim, this.rimLight));
        rim.visible = false;
        rim.renderOrder = 1;
        this.scene.add(rim);
      }
      const label = document.createElement('div') as LabelEl;
      label.innerHTML = '<i></i><b></b>';
      (label.lastElementChild as HTMLElement).textContent = sys.name.replace(/ system$/, '');
      const ours = sys.confidence === 'ours' || sys.confidence === 'invented' ? ' ours' : '';
      const looks = [`galaxy-label${ours}`, `galaxy-label on${ours}`, `galaxy-label here${ours}`] as const;
      label.className = looks[LabelLook.Plain];
      this.labelLayer.appendChild(label);
      this.globes.push({ sys, mesh, material, clouds, rim, lookTextures: [], label, at: new THREE.Vector3(), looks, look: LabelLook.Plain });
    }
    // The routes: one set of segments whose buffer is made when the file arrives (once a session).
    const routeGeometry = new THREE.BufferGeometry();
    routeGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    // The routes, the picked ring and the ring round where you are wear the palette's (the interface rewrite's second wave,
    // item 11: they were colours of their own; the ring round you is the map's own colour for you, `chassis`), and are
    // read again when a colour theme is switched (`repaint`). The globes and the lights are the galaxy's own.
    this.routeLines = new THREE.LineSegments(routeGeometry, new THREE.LineBasicMaterial({ color: colourHex('accent'), transparent: true, opacity: GALAXY_VIEW_TUNE.routeOpacity }));
    this.routeLines.frustumCulled = false;
    this.routeLines.visible = false;
    this.scene.add(this.routeLines);
    // The muted set, made here beside the lit one so that its program is linked on the same first
    // frame and lighting a different set of routes later never compiles anything.
    const mutedGeometry = new THREE.BufferGeometry();
    mutedGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    this.mutedLines = new THREE.LineSegments(mutedGeometry, new THREE.LineBasicMaterial({ color: colourHex('accent'), transparent: true, opacity: GALAXY_VIEW_TUNE.routeOpacity * GALAXY_VIEW_TUNE.muteShare }));
    this.mutedLines.frustumCulled = false;
    this.mutedLines.visible = false;
    this.scene.add(this.mutedLines);
    const ring = new THREE.RingGeometry(0.84, 1, 40);
    this.here = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: colourHex('chassis'), transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
    this.picked = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: colourHex('accent'), transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide }));
    this.here.renderOrder = 2;
    this.picked.renderOrder = 2;
    this.here.visible = false;
    this.picked.visible = false;
    this.scene.add(this.here, this.picked);
    this.place();
    onPaletteChange(() => this.repaint());
  }

  /** A colour theme switched: the routes and the two rings read the palette again. Never in a frame. */
  private repaint(): void {
    (this.routeLines.material as THREE.LineBasicMaterial).color.setHex(colourHex('accent'));
    (this.mutedLines.material as THREE.LineBasicMaterial).color.setHex(colourHex('accent'));
    (this.here.material as THREE.MeshBasicMaterial).color.setHex(colourHex('chassis'));
    (this.picked.material as THREE.MeshBasicMaterial).color.setHex(colourHex('accent'));
  }

  /**
   * The star disc the systems stand in: points drawn out of the galaxy's one density (`galaxyDensity.ts`'s `sampleDisc`, the
   * GPU port's pass 2, wave 3), the very function every system's night sky bakes its Milky Way from, so the band in the sky is
   * this disc seen from the system. It is ours: the archives hold a picture of the galaxy, but nothing that says where our
   * squares fall on it. Built here and built again by a retune, so the disc's own numbers can be tried live; only the buffers
   * are new, never a material.
   */
  private buildDiscGeometry(): THREE.BufferGeometry {
    const n = Math.max(0, Math.round(GALAXY_TUNE.discStars));
    const drawn = sampleDisc(n, 20030626);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // Bluer out at the rim, warmer in toward the middle: a look, not a measurement.
      const warm = 1 - Math.min(1, drawn.t[i]);
      col[i * 3] = 0.6 + warm * 0.35;
      col[i * 3 + 1] = 0.66 + warm * 0.2;
      col[i * 3 + 2] = 0.85;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(drawn.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }

  /** Every system put at its place, and every ring and globe sized: at build, and again after a retune. */
  private place(): void {
    for (const g of this.globes) {
      const p = systemPlace(g.sys);
      g.at.set(p.x, p.y, p.z);
      g.mesh.position.copy(g.at);
      g.mesh.scale.setScalar(GALAXY_VIEW_TUNE.systemSize);
      // Pass 2, wave 4b (maker C): its cloud shell and its painted rim about it.
      if (g.clouds) {
        g.clouds.position.copy(g.at);
        g.clouds.scale.setScalar(GALAXY_VIEW_TUNE.systemSize * GLOBE_TUNE.cloudHeight);
      }
      if (g.rim) {
        g.rim.position.copy(g.at);
        g.rim.scale.setScalar(GALAXY_VIEW_TUNE.systemSize * GLOBE_TUNE.rimHeight);
      }
    }
    const ring = GALAXY_VIEW_TUNE.systemSize * GALAXY_VIEW_TUNE.ringScale;
    this.here.scale.setScalar(ring);
    this.picked.scale.setScalar(ring * 1.25);
    (this.routeLines.material as THREE.LineBasicMaterial).opacity = GALAXY_VIEW_TUNE.routeOpacity;
    this.fillRoutes();
  }

  /**
   * Which systems can really be reached from where the player stands, or null for "all of them".
   *
   * It is a set handed in and never worked out here, and deliberately so: what is flyable is a
   * directed question with a fare, a starport rule and a "this build has no such world" rule, and
   * all three already live in one place. A second opinion drawn off the route file would light a
   * line the terminal beside it refuses to sell.
   *
   * Setting it moves no geometry and builds no program: the lit and the muted lines are two sets
   * that both exist from the start, and a globe's colour is a uniform.
   */
  setReachable(systems: ReadonlySet<string> | null): void {
    this.reachable = systems;
    this.fillRoutes();
    for (const g of this.globes) this.lightGlobe(g);
  }

  /** Whether a system may be picked at all. Everything may, until somebody says otherwise. */
  canPick(systemId: string): boolean {
    return !this.reachable || this.reachable.has(systemId) || systemId === this.hereId;
  }

  /** A globe's own colour, dimmed where it cannot be reached. */
  private lightGlobe(g: Globe): void {
    const lit = this.canPick(g.sys.id);
    const base = g.material.map && g.material.map !== this.blank ? 0xffffff : (g.colour ?? 0xb9c6d8);
    g.material.color.setHex(lit ? base : mute(base, GALAXY_VIEW_TUNE.muteShare));
  }

  /**
   * The route lines' ends, written into buffers made the first time a file gives more than they held.
   *
   * Two sets rather than one, because a line cannot be half a colour: the reachable ones go in the
   * lit set and everything else in the muted one, and both buffers are sized for every route so that
   * changing which is which never allocates.
   */
  private fillRoutes(): void {
    const want = this.routes.length * 2 * 3;
    const ends = (lines: THREE.LineSegments) => {
      let attr = lines.geometry.getAttribute('position') as THREE.BufferAttribute;
      if (attr.array.length < want) {
        attr = new THREE.BufferAttribute(new Float32Array(want), 3);
        lines.geometry.setAttribute('position', attr);
      }
      return attr;
    };
    const litAttr = ends(this.routeLines);
    const dimAttr = ends(this.mutedLines);
    let lit = 0;
    let dim = 0;
    for (const r of this.routes) {
      const a = this.globes.find((g) => g.sys.id === r.from);
      const b = this.globes.find((g) => g.sys.id === r.to);
      if (!a || !b) continue;
      // A route is lit when it touches the system the player is standing in and reaches one they can
      // really fly to. Everything else is drawn and muted rather than left out, so the shape of the
      // galaxy's own network is still there to read.
      const on = !this.reachable || ((r.from === this.hereId || r.to === this.hereId) && (this.reachable.has(r.from) || this.reachable.has(r.to)));
      const attr = on ? litAttr : dimAttr;
      let n = on ? lit : dim;
      attr.setXYZ(n++, a.at.x, a.at.y, a.at.z);
      attr.setXYZ(n++, b.at.x, b.at.y, b.at.z);
      if (on) lit = n;
      else dim = n;
    }
    litAttr.needsUpdate = true;
    dimAttr.needsUpdate = true;
    this.routeLines.geometry.setDrawRange(0, lit);
    this.mutedLines.geometry.setDrawRange(0, dim);
    this.routeLines.geometry.boundingSphere = null;
    this.mutedLines.geometry.boundingSphere = null;
    this.routeLines.visible = lit > 0;
    this.mutedLines.visible = dim > 0;
  }

  /** The shuttle routes, as lines between systems; handed over once the pack's own file has been read. */
  setRoutes(routes: GalaxyRoute[]): void {
    this.routes = routes;
    this.fillRoutes();
  }

  /**
   * A system's own globe: the picture its orbit's pack carries, and the colour worn until it arrives
   * (and instead of it, where the archives have no picture of that world). The picture is swapped on
   * the channel the globe already samples, so nothing is compiled for it.
   */
  setGlobe(systemId: string, colour: number, texture: THREE.Texture | null): void {
    const g = this.globes.find((x) => x.sys.id === systemId);
    if (!g) return;
    // The colour it would wear if it were lit, kept so that muting and un-muting are reversible:
    // written straight onto the material, a dimmed globe that later got its picture would keep the
    // dimming for ever.
    g.colour = colour;
    // Pass 2, wave 4b (maker C): under a look worn (`setGlobeLook`) SWG's picture is kept for when the look goes.
    if (g.swgMap !== undefined && g.lookTextures.length) g.swgMap = texture ?? this.blank;
    else g.material.map = texture ?? this.blank;
    this.lightGlobe(g);
  }

  /**
   * Pass 2, wave 4b (maker C, `galaxyLooks.ts`): a system's globe in its main world's baked look (its pictures, halved, laid on
   * this renderer as pictures of its own) with its turning cloud shell, or back in SWG's picture (`null`); and its painted rim
   * from its world's air (`rim`, the limb's table; null for none). Only with the game on WebGPU (the globes made their shells);
   * never in a frame: when the map asks its globes.
   */
  setGlobeLook(systemId: string, pics: GlobePictures | null, rim: Float32Array | null): void {
    const g = this.globes.find((x) => x.sys.id === systemId);
    if (!g || !g.clouds || !g.rim) return;
    for (const t of g.lookTextures) t.dispose();
    g.lookTextures.length = 0;
    const cloudMat = g.clouds.material as THREE.MeshLambertMaterial;
    if (pics) {
      const surface = new THREE.DataTexture(pics.surface, pics.width, pics.height, THREE.RGBAFormat);
      surface.colorSpace = THREE.SRGBColorSpace;
      surface.wrapS = THREE.RepeatWrapping;
      surface.generateMipmaps = true;
      surface.minFilter = THREE.LinearMipmapLinearFilter;
      surface.magFilter = THREE.LinearFilter;
      surface.needsUpdate = true;
      g.lookTextures.push(surface);
      if (g.swgMap === undefined) g.swgMap = g.material.map;
      g.material.map = surface;
      if (pics.clouds) {
        const c = new THREE.DataTexture(pics.clouds, pics.width, pics.height, THREE.RGBAFormat);
        c.colorSpace = THREE.SRGBColorSpace;
        c.wrapS = THREE.RepeatWrapping;
        c.generateMipmaps = true;
        c.minFilter = THREE.LinearMipmapLinearFilter;
        c.magFilter = THREE.LinearFilter;
        c.needsUpdate = true;
        g.lookTextures.push(c);
        cloudMat.map = c;
      } else cloudMat.map = this.blank;
      g.clouds.visible = !!pics.clouds;
    } else {
      if (g.swgMap !== undefined) g.material.map = g.swgMap;
      cloudMat.map = this.blank;
      g.clouds.visible = false;
    }
    const rimMat = g.rim.material as THREE.ShaderMaterial;
    if (rim) {
      const t = rimTexture(rim);
      g.lookTextures.push(t);
      rimMat.uniforms.uProfile.value = t;
    } else rimMat.uniforms.uProfile.value = this.blankRim;
    g.rim.visible = !!rim;
    this.lightGlobe(g);
  }

  /** The system the player is in, ringed on the map. */
  setCurrent(systemId: string | null): void {
    this.hereId = systemId;
  }

  /** The system picked, ringed and shown in the panel beside the map. */
  setPicked(systemId: string | null): void {
    this.pickedId = systemId;
  }

  get pick(): string | null {
    return this.pickedId;
  }

  /** The drawing camera's world matrix, whose first two columns are the right and up a slide uses. */
  get cameraMatrix(): ArrayLike<number> {
    return this.camera.matrixWorld.elements;
  }

  /** Where a system stands, for centring the view on it. */
  placeOf(systemId: string): THREE.Vector3 | null {
    return this.globes.find((g) => g.sys.id === systemId)?.at ?? null;
  }

  /** The system under a point on the canvas, by how near its middle is on screen, or null. */
  pickAt(x: number, y: number, width: number, height: number): string | null {
    let best: string | null = null;
    let bestD = GALAXY_VIEW_TUNE.pickPixels;
    for (const g of this.globes) {
      this.scratch.copy(g.at).project(this.camera);
      if (projectedBehind(this.scratch.z, this.camera)) continue;
      const d = Math.hypot((this.scratch.x * 0.5 + 0.5) * width - x, (-this.scratch.y * 0.5 + 0.5) * height - y);
      if (d < bestD) {
        bestD = d;
        best = g.sys.id;
      }
    }
    return best;
  }

  /** The point the wheel zooms toward: where the cursor's ray is at the distance looked at. */
  pointUnder(x: number, y: number, width: number, height: number, out: THREE.Vector3): THREE.Vector3 {
    this.scratchNdc.set((x / width) * 2 - 1, -(y / height) * 2 + 1);
    this.raycaster.setFromCamera(this.scratchNdc, this.camera);
    return this.raycaster.ray.at(this.orbit.orbit.distance, out);
  }

  /**
   * Laid out afresh after `__debug.galaxy({...})` moved a number, the star disc included: its own
   * four numbers are read only where it is built, so the geometry is built again and the old one
   * given back. The material is kept, so nothing is compiled and no set of the world's is touched
   * (this view's materials are its own and are in none of them).
   */
  retune(): void {
    this.camera.far = GALAXY_VIEW_TUNE.far;
    this.camera.updateProjectionMatrix();
    const old = this.disc.geometry;
    this.disc.geometry = this.buildDiscGeometry();
    old.dispose();
    this.place();
  }

  /** One frame, with the map window's own renderer. */
  draw(renderer: THREE.WebGLRenderer, width: number, height: number): void {
    if (this.camera.aspect !== width / height) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    const o = this.orbit.orbit;
    const t = this.orbit.target;
    this.camera.position.set(t.x + o.distance * Math.cos(o.pitch) * Math.sin(o.yaw), t.y + o.distance * Math.sin(o.pitch), t.z + o.distance * Math.cos(o.pitch) * Math.cos(o.yaw));
    this.camera.lookAt(t.x, t.y, t.z);
    this.camera.updateMatrixWorld(true);
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
    // The rings lie across the view, so they read as rings round a globe from any angle.
    const hereAt = this.hereId ? this.placeOf(this.hereId) : null;
    this.here.visible = !!hereAt;
    if (hereAt) {
      this.here.position.copy(hereAt);
      this.here.quaternion.copy(this.camera.quaternion);
    }
    const pickAt = this.pickedId ? this.placeOf(this.pickedId) : null;
    this.picked.visible = !!pickAt;
    if (pickAt) {
      this.picked.position.copy(pickAt);
      this.picked.quaternion.copy(this.camera.quaternion);
    }
    this.placeLabels(width, height);
    // Pass 2, wave 4b (maker C): the cloud shells turn on the clock, and the rims read the map's light in the view's frame.
    if (this.globes.length && this.globes[0].clouds) {
      const turn = ((performance.now() / 1000) * GLOBE_TUNE.cloudSpin) % (Math.PI * 2);
      for (const g of this.globes) if (g.clouds && g.clouds.visible) g.clouds.rotation.y = turn;
      this.rimLight.dir.value.copy(this.sunDir).transformDirection(this.camera.matrixWorldInverse);
    }
    // The first frame is the only one that may make programs, and it makes them all: after it, every
    // material this view has is linked, and a texture arriving later only swaps a picture. `compile`
    // walks what is visible, so the two rings and the route lines are shown for that one call even
    // when nothing is picked and no file has arrived; otherwise their programs would be built on
    // whatever later frame first shows one.
    if (!this.compiled) {
      this.compiled = true;
      const wasHere = this.here.visible;
      const wasPicked = this.picked.visible;
      const wasRoutes = this.routeLines.visible;
      const wasMuted = this.mutedLines.visible;
      this.here.visible = true;
      this.picked.visible = true;
      this.routeLines.visible = true;
      this.mutedLines.visible = true;
      // Pass 2, wave 4b (maker C): one cloud shell and one rim shown for the call, so their two programs are linked with the map's own.
      const first = this.globes[0];
      const wasClouds = first?.clouds?.visible ?? false;
      const wasRim = first?.rim?.visible ?? false;
      if (first?.clouds) first.clouds.visible = true;
      if (first?.rim) first.rim.visible = true;
      renderer.compile(this.scene, this.camera);
      if (first?.clouds) first.clouds.visible = wasClouds;
      if (first?.rim) first.rim.visible = wasRim;
      this.here.visible = wasHere;
      this.picked.visible = wasPicked;
      this.routeLines.visible = wasRoutes;
      this.mutedLines.visible = wasMuted;
    }
    renderer.render(this.scene, this.camera);
    this.frames++;
  }

  /** Each system's name beside its globe, written only when it moves or changes. */
  private placeLabels(width: number, height: number): void {
    for (const g of this.globes) {
      this.scratch.copy(g.at).project(this.camera);
      const on = this.scratch.z <= 1 && Math.abs(this.scratch.x) <= 1 && Math.abs(this.scratch.y) <= 1;
      if (g.label.hidden !== !on) g.label.hidden = !on;
      if (!on) continue;
      const px = Math.round((this.scratch.x * 0.5 + 0.5) * width) + 10;
      const py = Math.round((-this.scratch.y * 0.5 + 0.5) * height) - 9;
      if (g.label.placedX !== px || g.label.placedY !== py) {
        g.label.placedX = px;
        g.label.placedY = py;
        g.label.style.transform = `translate(${px}px, ${py}px)`;
      }
      // One of three class names built when the globe was: a frame joins no string and writes
      // nothing unless the label's look has actually changed.
      const look = g.sys.id === this.pickedId ? LabelLook.Picked : g.sys.id === this.hereId ? LabelLook.Here : LabelLook.Plain;
      if (g.look !== look) {
        g.look = look;
        g.label.className = g.looks[look];
      }
    }
  }

  /** What `__debug.galaxy()` reports. */
  describe(): Record<string, unknown> {
    return {
      systems: this.globes.length,
      routes: this.routes.length,
      here: this.hereId,
      picked: this.pickedId,
      frames: this.frames,
      discStars: this.disc.geometry.getAttribute('position')?.count ?? 0,
      target: { ...this.orbit.target },
      orbit: { ...this.orbit.orbit },
      places: Object.fromEntries(this.globes.map((g) => [g.sys.id, [Math.round(g.at.x), Math.round(g.at.y), Math.round(g.at.z)]])),
      // The fare on each line, the cheaper of the two directions: the map draws every route alike,
      // so this is the only place the game's own price is read back.
      fares: Object.fromEntries(this.routes.map((r) => [`${r.from}-${r.to}`, r.price])),
    };
  }
}
