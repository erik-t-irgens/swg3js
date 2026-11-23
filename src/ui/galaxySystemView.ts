// The galaxy map's opened system, drawn (the GPU port's pass 2, wave 5, maker M; the design's section 3, way 1): a picked
// system's sun glowing at its middle, its worlds and moons as globes in their looks (the pictures baked behind a loading
// screen, `galaxyLooks.ts`), their clouds turning, their painted rims and their rings, each lit from where its star truly is,
// with its orbit line, where the clockwork puts it now (`galaxySystem.ts`). On the map window's own WebGL renderer, made only
// with the game on WebGPU (where looks are baked and the opened system is offered), every mesh and material made with the
// view and compiled in its first frame, so opening a system builds no program and nothing on the game's device.
//
// Nothing here is made during a frame: a fixed pool of globes, rims, rings, orbit lines, glows and labels is made once; a
// system's opening lays its pictures and numbers on the pool and its closing frees the pictures it made.

import * as THREE from 'three';
import { colourHex, onPaletteChange } from '../core/palette.ts';
import { projectedBehind } from '../core/depthMode.ts';
import { SKY_MOTION } from '../sky/system/skyMotion.ts';
import { EPOCH_MS, DAY_MS } from '../sky/system/system.js';
import { GPU } from '../core/gpuSwitch.ts';
import { GLOBE_TUNE, type GlobePictures } from './galaxyLooks.ts';
import { MAX_GLOBES, MAX_SYSTEM_BODIES, SYSTEM_VIEW_TUNE, type OpenedSystem } from './galaxySystem.ts';

/** What a body of an opened system wears (worked out by the map as the system opens, never in a frame). */
export interface BodyWear {
  /** Its look's pictures (its own, freed as the system shuts), or null. */
  pics: GlobePictures | null;
  /** SWG's picture of it, shared with the galaxy's globe (never freed here), or null. */
  swg: THREE.Texture | null;
  /** Its painted rim's table, or null for none. */
  rim: Float32Array | null;
  /** Its rings (a generated look's `rings` part), or null. */
  rings: { seed: number; style: string; dials: Record<string, number | string> } | null;
  /** Its look's id, for the console. */
  look: string | null;
}

/** The map's light as a painted rim reads it (`galaxyView.ts`' `globeRimMaterial`): its way in the view's frame, its colour. */
interface RimLight {
  dir: { value: THREE.Vector3 };
  colour: { value: THREE.Color };
}

/** A label from the pool, with the pixels it was last placed at. */
type LabelEl = HTMLElement & { placedX?: number; placedY?: number };

/** The opened system's globe: its picture, its clouds turning over it, lit from its star (a sun lit by itself). */
function systemGlobeMaterial(blank: THREE.Texture, cloudTurn: { value: THREE.Vector2 }): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'galaxy system globe',
    uniforms: {
      uMap: { value: blank },
      uClouds: { value: blank },
      uCloudOn: { value: 0 },
      // One uniform every globe shares, written once a frame.
      uCloudTurn: cloudTurn,
      uColour: { value: new THREE.Color(1, 1, 1) },
      uLightDir: { value: new THREE.Vector3(0, 1, 0) },
      uLight: { value: SYSTEM_VIEW_TUNE.light },
      uAmbient: { value: SYSTEM_VIEW_TUNE.ambient },
      uStar: { value: 0 },
      uDim: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vN;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform sampler2D uClouds;
      uniform float uCloudOn;
      uniform vec2 uCloudTurn;
      uniform vec3 uColour;
      uniform vec3 uLightDir;
      uniform float uLight;
      uniform float uAmbient;
      uniform float uStar;
      uniform float uDim;
      varying vec3 vN;
      varying vec2 vUv;
      void main() {
        vec3 base = texture2D(uMap, vUv).rgb * uColour;
        vec4 c = texture2D(uClouds, vec2(vUv.x + uCloudTurn.x, vUv.y));
        base = mix(base, c.rgb, c.a * uCloudOn);
        float lam = max(dot(normalize(vN), uLightDir), 0.0);
        vec3 col = uStar > 0.5 ? base * uLight : base * uLight * (lam + uAmbient);
        gl_FragColor = vec4(col * uDim, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * A body's rings on the map: the viewer's own ring (`shapes.js`' `ringMesh`, in GLSL): its profile across the ring (density,
 * colour mix, brightness, `ringProfile`'s), lit from either face, thin dust throwing light forward, and the body's shadow
 * across it where the way to the star passes through the body.
 */
function systemRingMaterial(blank: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'galaxy system ring',
    uniforms: {
      uProfile: { value: blank },
      uInner: { value: 1.35 },
      uOuter: { value: 2.3 },
      uC1: { value: new THREE.Color(1, 1, 1) },
      uC2: { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 0.75 },
      uBright: { value: 1 },
      uScatter: { value: 0.6 },
      uLightDir: { value: new THREE.Vector3(0, 1, 0) },
      uNormal: { value: new THREE.Vector3(0, 1, 0) },
      uCentre: { value: new THREE.Vector3() },
      uRadius: { value: 1 },
      uLight: { value: SYSTEM_VIEW_TUNE.light },
      uAmbient: { value: SYSTEM_VIEW_TUNE.ambient },
    },
    vertexShader: /* glsl */ `
      uniform float uInner;
      uniform float uOuter;
      varying vec3 vP;
      varying vec3 vW;
      void main() {
        float r0 = length(position.xz);
        float rn = uInner + (r0 - 1.0) * (uOuter - uInner);
        vec3 P = vec3(position.x / r0 * rn, 0.0, position.z / r0 * rn);
        vP = P;
        vec4 w = modelMatrix * vec4(P, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uProfile;
      uniform float uInner;
      uniform float uOuter;
      uniform vec3 uC1;
      uniform vec3 uC2;
      uniform float uOpacity;
      uniform float uBright;
      uniform float uScatter;
      uniform vec3 uLightDir;
      uniform vec3 uNormal;
      uniform vec3 uCentre;
      uniform float uRadius;
      uniform float uLight;
      uniform float uAmbient;
      varying vec3 vP;
      varying vec3 vW;
      void main() {
        float u = (length(vP.xz) - uInner) / max(uOuter - uInner, 1e-4);
        vec4 pr = texture2D(uProfile, vec2(u, 0.5));
        float alpha = clamp(pr.r * uOpacity, 0.0, 0.995);
        vec3 colour = mix(uC2, uC1, pr.g) * (pr.b * 0.5 + 0.75);
        vec3 V = normalize(cameraPosition - vW);
        float lo = dot(uLightDir, uNormal);
        float vo = dot(V, uNormal);
        float mu0 = abs(lo);
        float mu = max(abs(vo), 0.02);
        float ls = mu0 * 2.0 / (mu0 + mu);
        float through = ls * ((1.0 - alpha) * 0.9 + 0.1) * 0.6;
        float fwd = pow(max(dot(-V, uLightDir), 0.0), 6.0) * uScatter * 1.5;
        float amount = (lo * vo > 0.0 ? ls : through) + fwd;
        vec3 oc = vW - uCentre;
        float b = dot(oc, uLightDir);
        float c = dot(oc, oc) - uRadius * uRadius;
        float sh = (b < 0.0 && b * b - c > 0.0) ? 1.0 : 0.0;
        gl_FragColor = vec4(colour * uBright * uLight * (uAmbient + amount * (1.0 - sh)), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

/** A sun's glow: a soft round picture, white, tinted by the sprite's colour. Made once. */
function glowTexture(): THREE.DataTexture {
  const N = 64;
  const px = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (x + 0.5) / N - 0.5;
      const dy = (y + 0.5) / N - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const a = r >= 1 ? 0 : Math.pow(1 - r, 2.2);
      const o = (y * N + x) * 4;
      px[o] = 255;
      px[o + 1] = 255;
      px[o + 2] = 255;
      px[o + 3] = Math.round(a * 255);
    }
  }
  const t = new THREE.DataTexture(px, N, N, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

interface GlobeSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}
interface BodySlot {
  rim: THREE.Mesh;
  rimLight: RimLight;
  ring: THREE.Mesh;
  ringMat: THREE.ShaderMaterial;
  orbit: THREE.Line;
  label: LabelEl;
  looks: [string, string, string];
  look: number;
  /** The first globe of the body (its label's and its rim's), or -1. */
  globe: number;
}

/** Which of an orbit's four line looks it wears: plain, a ground world's, the world you stand on, the body picked (plain numbers: node strips types, never enums). */
const OrbitLook = { Plain: 0, Ground: 1, Here: 2, Picked: 3 } as const;

/** The opened system on the map's renderer: a pool made once, laid as a system opens, moved each frame. */
export class SystemDraw {
  readonly group = new THREE.Group();
  /** The system opened, or null. */
  opened: OpenedSystem | null = null;
  /** The body picked in it, or -1. */
  pickedBody = -1;
  /** How far the disc has faded (0 the galaxy, 1 a system open), eased over `fadeSeconds`. */
  fade = 0;
  private readonly globes: GlobeSlot[] = [];
  private readonly bodies: BodySlot[] = [];
  private readonly glows: THREE.Sprite[] = [];
  private readonly orbitMats: THREE.LineBasicMaterial[];
  private readonly dashedMat: THREE.LineDashedMaterial;
  private readonly glowTex: THREE.DataTexture;
  /** The pictures this opening made (freed as it shuts). */
  private readonly made: THREE.Texture[] = [];
  private readonly scratch = new THREE.Vector3();
  private readonly at = new THREE.Vector3();
  private lastMs = Number.NaN;
  /** The clouds' turn (its `x`, a share of a turn), one uniform every globe shares: a vector's field written in place. */
  private readonly cloudTurn = { value: new THREE.Vector2() };
  /**
   * The frame's clock, written by the view before `fadeDisc` and `frame` read it (the shared clock's milliseconds), so no number
   * crosses a call; and the disc's own opacity, which the fade is a share of.
   */
  readonly now = { ms: 0 };
  readonly discFull: number;
  /** Which bodies wear rings and their globes' radii (laid as it opens). */
  private ringOn: Uint8Array = new Uint8Array(MAX_SYSTEM_BODIES);
  private readonly blank: THREE.Texture;
  private readonly makeRimTexture: (p: Float32Array) => THREE.DataTexture;
  private readonly blankRim: THREE.Texture;

  constructor(labelLayer: HTMLElement, blank: THREE.Texture, blankRim: THREE.Texture, rimColour: { value: THREE.Color }, makeRim: (profile: THREE.Texture, light: RimLight) => THREE.ShaderMaterial, makeRimTexture: (p: Float32Array) => THREE.DataTexture, discFull: number) {
    this.discFull = discFull;
    this.blank = blank;
    this.blankRim = blankRim;
    this.makeRimTexture = makeRimTexture;
    this.group.visible = false;
    const sphere = new THREE.SphereGeometry(1, 32, 20);
    const rimSphere = new THREE.SphereGeometry(1, 32, 20);
    const ringGeo = new THREE.RingGeometry(1, 2, 128, 1);
    ringGeo.rotateX(-Math.PI / 2);
    // The unit circle every orbit is laid from (its own frame written each frame), with the dashes' lengths along it.
    const circle = new THREE.BufferGeometry();
    const cp = new Float32Array(97 * 3);
    for (let k = 0; k <= 96; k++) {
      const a = (k / 96) * Math.PI * 2;
      cp[3 * k] = Math.cos(a);
      cp[3 * k + 1] = Math.sin(a);
    }
    circle.setAttribute('position', new THREE.BufferAttribute(cp, 3));
    const dash = new Float32Array(97);
    for (let k = 0; k <= 96; k++) dash[k] = (k / 96) * Math.PI * 2;
    circle.setAttribute('lineDistance', new THREE.BufferAttribute(dash, 1));
    // The orbits wear the palette's (the interface's colours): plain, a ground world's, yours, the one picked; dashed for a
    // belt and a body the sky does not draw.
    this.orbitMats = [
      new THREE.LineBasicMaterial({ color: colourHex('muted'), transparent: true, opacity: 0.32 }),
      new THREE.LineBasicMaterial({ color: colourHex('good'), transparent: true, opacity: 0.5 }),
      new THREE.LineBasicMaterial({ color: colourHex('chassis'), transparent: true, opacity: 0.85 }),
      new THREE.LineBasicMaterial({ color: colourHex('accent'), transparent: true, opacity: 0.9 }),
    ];
    this.dashedMat = new THREE.LineDashedMaterial({ color: colourHex('muted'), transparent: true, opacity: 0.3, dashSize: 0.06, gapSize: 0.08 });
    for (let k = 0; k < MAX_GLOBES; k++) {
      const mat = systemGlobeMaterial(blank, this.cloudTurn);
      const mesh = new THREE.Mesh(sphere, mat);
      mesh.visible = false;
      this.group.add(mesh);
      this.globes.push({ mesh, mat });
    }
    for (let i = 0; i < MAX_SYSTEM_BODIES; i++) {
      const rimLight: RimLight = { dir: { value: new THREE.Vector3(0, 1, 0) }, colour: rimColour };
      const rim = new THREE.Mesh(rimSphere, makeRim(blankRim, rimLight));
      rim.visible = false;
      rim.renderOrder = 1;
      this.group.add(rim);
      const ringMat = systemRingMaterial(blank);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.visible = false;
      ring.renderOrder = 2;
      ring.frustumCulled = false;
      this.group.add(ring);
      const orbit = new THREE.Line(circle, this.orbitMats[OrbitLook.Plain]);
      orbit.matrixAutoUpdate = false;
      orbit.frustumCulled = false;
      orbit.visible = false;
      this.group.add(orbit);
      const label = document.createElement('div') as LabelEl;
      label.innerHTML = '<i></i><b></b>';
      label.hidden = true;
      labelLayer.appendChild(label);
      this.bodies.push({ rim, rimLight, ring, ringMat, orbit, label, looks: ['galaxy-label', 'galaxy-label on', 'galaxy-label here'], look: 0, globe: -1 });
    }
    this.glowTex = glowTexture();
    for (let k = 0; k < 2; k++) {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffd27a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.visible = false;
      glow.renderOrder = 3;
      this.group.add(glow);
      this.glows.push(glow);
    }
    onPaletteChange(() => this.repaint());
  }

  /** A colour theme switched: the orbits read the palette again. Never in a frame. */
  private repaint(): void {
    this.orbitMats[OrbitLook.Plain].color.setHex(colourHex('muted'));
    this.orbitMats[OrbitLook.Ground].color.setHex(colourHex('good'));
    this.orbitMats[OrbitLook.Here].color.setHex(colourHex('chassis'));
    this.orbitMats[OrbitLook.Picked].color.setHex(colourHex('accent'));
    this.dashedMat.color.setHex(colourHex('muted'));
  }

  /**
   * One of each kind shown for the map's first frame's compile (a globe, a rim, a ring, a plain and a dashed orbit, a glow), so
   * every program an opened system draws with is linked with the map's own; `false` puts them back as they were.
   */
  showForCompile(on: boolean): void {
    this.group.visible = on || !!this.opened;
    if (this.opened) return;
    this.globes[0].mesh.visible = on;
    this.bodies[0].rim.visible = on;
    this.bodies[0].ring.visible = on;
    this.bodies[0].orbit.visible = on;
    this.bodies[1].orbit.visible = on;
    this.bodies[1].orbit.material = on ? this.dashedMat : this.orbitMats[OrbitLook.Plain];
    this.glows[0].visible = on;
  }

  /**
   * A system opened at its place in the galaxy (`at`): its pictures, rims and rings laid on the pool, its labels named. Never
   * in a frame (a click, or the console). `wear` is each body's, by its index.
   */
  open(opened: OpenedSystem, at: THREE.Vector3, wear: readonly (BodyWear | null)[]): void {
    this.close();
    this.opened = opened;
    this.pickedBody = -1;
    this.group.position.copy(at);
    this.group.visible = true;
    this.lastMs = Number.NaN;
    const nb = Math.min(opened.bodies.length, MAX_SYSTEM_BODIES);
    // The globes: each its body's pictures (its look's, else SWG's, else its colour), its clouds, its lean, its size.
    let glow = 0;
    for (let k = 0; k < this.globes.length; k++) {
      const slot = this.globes[k];
      const g = k < opened.globes.length ? opened.globes[k] : null;
      slot.mesh.visible = !!g;
      if (!g) continue;
      const body = opened.bodies[g.body];
      const w = wear[g.body] ?? null;
      const u = slot.mat.uniforms;
      let map: THREE.Texture | null = null;
      let clouds: THREE.Texture | null = null;
      if (w?.pics && g.member < 0) {
        map = this.picture(w.pics.surface, w.pics.width, w.pics.height);
        if (w.pics.clouds) clouds = this.picture(w.pics.clouds, w.pics.width, w.pics.height);
      } else if (w?.swg && g.member < 0) map = w.swg;
      u.uMap.value = map ?? this.blank;
      u.uClouds.value = clouds ?? this.blank;
      u.uCloudOn.value = clouds ? 1 : 0;
      (u.uColour.value as THREE.Color).setHex(map ? 0xffffff : g.colour);
      u.uStar.value = g.star ? 1 : 0;
      u.uDim.value = body.drawn ? 1 : 0.45;
      slot.mesh.scale.setScalar(g.radius);
      slot.mesh.rotation.set((body.axialTiltDeg * Math.PI) / 180, 0, 0);
      if (g.star && glow < this.glows.length) {
        const s = this.glows[glow++];
        s.visible = true;
        s.material.color.setHex(g.colour);
        s.scale.setScalar(g.radius * SYSTEM_VIEW_TUNE.starGlow * 2);
      }
    }
    for (let k = glow; k < this.glows.length; k++) this.glows[k].visible = false;
    // The bodies: each its rim, its rings, its orbit and its label.
    for (let i = 0; i < this.bodies.length; i++) {
      const slot = this.bodies[i];
      const body = i < nb ? opened.bodies[i] : null;
      slot.globe = body ? opened.globes.findIndex((g) => g.body === i) : -1;
      const w = body ? (wear[i] ?? null) : null;
      const r = slot.globe >= 0 ? opened.globes[slot.globe].radius : 0;
      // The rim.
      const rimMat = slot.rim.material as THREE.ShaderMaterial;
      if (body && w?.rim && slot.globe >= 0) {
        const t = this.makeRimTexture(w.rim);
        this.made.push(t);
        rimMat.uniforms.uProfile.value = t;
        slot.rim.scale.setScalar(r * GLOBE_TUNE.rimHeight);
        slot.rim.visible = true;
      } else {
        rimMat.uniforms.uProfile.value = this.blankRim;
        slot.rim.visible = false;
      }
      // The rings, their profile made by the viewer's own `ringProfile` (its module is the game's on WebGPU already).
      slot.ring.visible = false;
      this.ringOn[i] = 0;
      if (body && w?.rings && slot.globe >= 0) {
        const rings = w.rings;
        const ru = slot.ringMat.uniforms;
        const d = rings.dials;
        ru.uInner.value = Number(d.inner) || 1.35;
        ru.uOuter.value = Number(d.outer) || 2.3;
        ru.uOpacity.value = Number.isFinite(Number(d.opacity)) ? Number(d.opacity) : 0.75;
        ru.uBright.value = Number.isFinite(Number(d.bright)) ? Number(d.bright) : 1;
        (ru.uC1.value as THREE.Color).setStyle(typeof d.colour1 === 'string' ? d.colour1 : '#cdbb9c');
        (ru.uC2.value as THREE.Color).setStyle(typeof d.colour2 === 'string' ? d.colour2 : '#8a7864');
        ru.uRadius.value = r;
        const tilt = (body.axialTiltDeg * Math.PI) / 180;
        slot.ring.rotation.set(tilt, 0, 0);
        slot.ring.scale.setScalar(r);
        (ru.uNormal.value as THREE.Vector3).set(0, Math.cos(tilt), Math.sin(tilt));
        this.ringOn[i] = 1;
        this.ringProfile(i, rings);
      }
      // The orbit.
      if (body && body.orbit) {
        slot.orbit.visible = true;
        slot.orbit.material = body.dashed ? this.dashedMat : this.orbitMats[body.here ? OrbitLook.Here : body.ground ? OrbitLook.Ground : OrbitLook.Plain];
      } else slot.orbit.visible = false;
      // The label.
      const label = slot.label;
      if (body && slot.globe >= 0) {
        (label.lastElementChild as HTMLElement).textContent = body.here ? `${body.name} (you are here)` : body.name;
        slot.look = body.here ? 2 : 0;
        label.className = slot.looks[slot.look];
        label.placedX = undefined;
        label.placedY = undefined;
      } else label.hidden = true;
    }
  }

  /** A ring's profile from the viewer's own `ringProfile`, handed over by the WebGPU runtime as bytes (`GPU.rt.mapRings`). */
  private ringProfile(i: number, rings: { seed: number; style: string; dials: Record<string, number | string> }): void {
    try {
      const made = GPU.rt?.mapRings(rings.seed, rings.style, rings.dials);
      if (!made) return;
      // Its bytes on a picture of this renderer's three.
      const t = new THREE.DataTexture(made.data, made.width, 1, THREE.RGBAFormat);
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
      this.made.push(t);
      const slot = this.bodies[i];
      slot.ringMat.uniforms.uProfile.value = t;
      slot.ringMat.uniforms.uScatter.value = made.scatter;
      slot.ring.visible = this.ringOn[i] === 1;
    } catch (e) {
      console.warn('galaxy: a ring profile could not be made', e);
    }
  }

  /** A look's picture on this renderer (its own: freed as the system shuts). */
  private picture(px: Uint8Array, w: number, h: number): THREE.DataTexture {
    const t = new THREE.DataTexture(px, w, h, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = THREE.RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    this.made.push(t);
    return t;
  }

  /** The system shut: its pictures freed, the pool hidden, the labels gone. The disc comes back over `fadeSeconds`. */
  close(): void {
    this.opened = null;
    this.pickedBody = -1;
    for (const t of this.made) t.dispose();
    this.made.length = 0;
    for (const g of this.globes) {
      g.mesh.visible = false;
      g.mat.uniforms.uMap.value = this.blank;
      g.mat.uniforms.uClouds.value = this.blank;
    }
    for (const b of this.bodies) {
      b.rim.visible = false;
      (b.rim.material as THREE.ShaderMaterial).uniforms.uProfile.value = this.blankRim;
      b.ring.visible = false;
      b.ringMat.uniforms.uProfile.value = this.blank;
      b.orbit.visible = false;
      b.label.hidden = true;
      b.globe = -1;
    }
    for (const g of this.glows) g.visible = false;
    this.group.visible = false;
  }

  /** The body picked (its orbit lit, its label the picked one), or -1. Never in a frame. */
  pick(i: number): void {
    const o = this.opened;
    if (!o) return;
    this.pickedBody = i >= 0 && i < o.bodies.length ? i : -1;
    for (let k = 0; k < this.bodies.length && k < o.bodies.length; k++) {
      const b = o.bodies[k];
      const slot = this.bodies[k];
      if (b.orbit && !b.dashed) slot.orbit.material = this.orbitMats[k === this.pickedBody ? OrbitLook.Picked : b.here ? OrbitLook.Here : b.ground ? OrbitLook.Ground : OrbitLook.Plain];
      const look = k === this.pickedBody ? 1 : b.here ? 2 : 0;
      if (slot.look !== look) {
        slot.look = look;
        slot.label.className = slot.looks[look];
      }
    }
  }

  /**
   * The disc's opacity eased toward its share while a system is open and back while none is (`fadeSeconds`), written only when
   * it moves. `full` is the disc's own opacity. Read off the frame's clock (`ms`), held to a tenth of a second a step.
   */
  fadeDisc(material: THREE.PointsMaterial): void {
    const ms = this.now.ms;
    const dt = this.lastMs === this.lastMs ? (ms - this.lastMs) / 1000 : 0;
    this.lastMs = ms;
    const fs = SYSTEM_VIEW_TUNE.fadeSeconds;
    const step = (dt > 0 ? (dt < 0.1 ? dt : 0.1) : 0) / (fs > 1e-3 ? fs : 1e-3);
    const want = this.opened ? 1 : 0;
    if (this.fade < want) this.fade = this.fade + step > want ? want : this.fade + step;
    else if (this.fade > want) this.fade = this.fade - step < want ? want : this.fade - step;
    const o = this.discFull * (1 - this.fade * (1 - SYSTEM_VIEW_TUNE.discFade));
    if (material.opacity !== o) material.opacity = o;
  }

  /**
   * One frame of the opened system: its time (the ground's own when the player stands under it, else the shared clock's real
   * days), the clockwork moved there, every globe, rim, ring, orbit and label laid where it says, the clouds turned, the two
   * rings of the galaxy's (`here`, `picked`) put round the world you stand on and the body picked. Allocates nothing.
   */
  frame(camera: THREE.Camera, here: THREE.Mesh, picked: THREE.Mesh, width: number, height: number): void {
    const o = this.opened;
    if (!o) return;
    const ms = this.now.ms;
    const m = SKY_MOTION.now;
    if (m && o.id !== null && m.id === o.id && m.version === 2 && m.T === m.T) o.clock.T = m.T;
    else o.clock.T = (ms - EPOCH_MS) / DAY_MS;
    o.at();
    // Every number below is written into a field (a vector's `x`, a quaternion's `_x`, a matrix's `elements`): one handed to a
    // setter of three's, or a float uniform's own `value`, is a number made each frame (`testing.md`).
    const pos = o.pos;
    const light = o.light;
    // The clouds' turn on the clock (the galaxy's globes' own rate), a share of a turn.
    const turns = ((ms / 1000) * GLOBE_TUNE.cloudSpin) / (Math.PI * 2);
    this.cloudTurn.value.x = turns - Math.floor(turns);
    for (let k = 0; k < o.globes.length && k < this.globes.length; k++) {
      const g = o.globes[k];
      const b3 = 3 * g.body;
      const slot = this.globes[k];
      const p = slot.mesh.position;
      p.x = pos[b3] + g.offX;
      p.y = pos[b3 + 1];
      p.z = pos[b3 + 2] + g.offZ;
      const L = slot.mat.uniforms.uLightDir.value as THREE.Vector3;
      L.x = light[b3];
      L.y = light[b3 + 1];
      L.z = light[b3 + 2];
    }
    let glow = 0;
    for (let k = 0; k < o.globes.length && glow < this.glows.length; k++) {
      if (!o.globes[k].star) continue;
      this.glows[glow++].position.copy(this.globes[k].mesh.position);
    }
    const ie = camera.matrixWorldInverse.elements;
    const om = o.orbitM;
    const gp = this.group.position;
    let hereSlot = -1;
    for (let i = 0; i < this.bodies.length && i < o.bodies.length; i++) {
      const slot = this.bodies[i];
      if (slot.globe < 0) continue;
      const at = this.globes[slot.globe].mesh.position;
      const i3 = 3 * i;
      const lx = light[i3];
      const ly = light[i3 + 1];
      const lz = light[i3 + 2];
      if (slot.rim.visible) {
        slot.rim.position.copy(at);
        // The way to the star in the view's frame (the rim's): the view's turn on it, made unit.
        const d = slot.rimLight.dir.value;
        const vx = ie[0] * lx + ie[4] * ly + ie[8] * lz;
        const vy = ie[1] * lx + ie[5] * ly + ie[9] * lz;
        const vz = ie[2] * lx + ie[6] * ly + ie[10] * lz;
        const vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
        const k = vl > 1e-12 ? 1 / vl : 0;
        d.x = vx * k;
        d.y = vy * k;
        d.z = vz * k;
      }
      if (this.ringOn[i]) {
        slot.ring.position.copy(at);
        const ru = slot.ringMat.uniforms;
        const L = ru.uLightDir.value as THREE.Vector3;
        L.x = lx;
        L.y = ly;
        L.z = lz;
        (ru.uCentre.value as THREE.Vector3).copy(at).add(gp);
      }
      if (slot.orbit.visible) {
        const e = slot.orbit.matrix.elements;
        const k16 = 16 * i;
        for (let q = 0; q < 16; q++) e[q] = om[k16 + q];
        slot.orbit.matrixWorldNeedsUpdate = true;
      }
      if (o.bodies[i].here) hereSlot = i;
    }
    // The galaxy's two rings, round the world you stand on and the body picked, lying across the view, while its globe is small
    // on the screen (a globe come near reads by itself and its name).
    this.viewH = height;
    here.visible = hereSlot >= 0;
    if (hereSlot >= 0) here.visible = this.ringOver(here, this.globes[this.bodies[hereSlot].globe].mesh, camera, 0);
    const pb = this.pickedBody;
    picked.visible = pb >= 0 && this.bodies[pb].globe >= 0;
    if (picked.visible) picked.visible = this.ringOver(picked, this.globes[this.bodies[pb].globe].mesh, camera, 1);
    this.placeLabels(camera, width, height);
  }

  /** The view's height in pixels, written by the frame (the marker rings' size on the screen reads it). */
  private viewH = 1;

  /**
   * One of the galaxy's rings laid round a globe, across the view: the ring where you stand (`which` 0) 2.4 times its size, the
   * ring picked (1) 3 times, each number into its field (the choice a whole number: a fraction handed to a call is a number
   * made). Answers whether it shows: only while the globe stands under `markUnderPx` of radius on the screen.
   */
  private ringOver(ring: THREE.Mesh, globe: THREE.Mesh, camera: THREE.Camera, which: 0 | 1): boolean {
    const ce = camera.matrixWorld.elements;
    const gx = globe.position.x + this.group.position.x - ce[12];
    const gy = globe.position.y + this.group.position.y - ce[13];
    const gz = globe.position.z + this.group.position.z - ce[14];
    const d = Math.sqrt(gx * gx + gy * gy + gz * gz);
    // (No `Infinity` for the eye inside the globe: a fraction joined with a constant of that kind is a number made.)
    if (!(d > 1e-6)) return false;
    const px = ((globe.scale.x * camera.projectionMatrix.elements[5]) / d) * this.viewH * 0.5;
    if (!(px < SYSTEM_VIEW_TUNE.markUnderPx)) return false;
    ring.position.copy(globe.position).add(this.group.position);
    const q = ring.quaternion as unknown as { _x: number; _y: number; _z: number; _w: number };
    const c = camera.quaternion as unknown as { _x: number; _y: number; _z: number; _w: number };
    q._x = c._x;
    q._y = c._y;
    q._z = c._z;
    q._w = c._w;
    const s = globe.scale.x * (which === 1 ? 3 : 2.4);
    ring.scale.x = s;
    ring.scale.y = s;
    ring.scale.z = s;
    return true;
  }

  /** Each body's name beside its globe, written only when it moves (the projection worked out from the camera's matrices). */
  private placeLabels(camera: THREE.Camera, width: number, height: number): void {
    const o = this.opened;
    if (!o) return;
    const v = camera.matrixWorldInverse.elements;
    const pr = camera.projectionMatrix.elements;
    const gp = this.group.position;
    for (let i = 0; i < this.bodies.length && i < o.bodies.length; i++) {
      const slot = this.bodies[i];
      if (slot.globe < 0) continue;
      const at = this.globes[slot.globe].mesh.position;
      const x = at.x + gp.x;
      const y = at.y + gp.y;
      const z = at.z + gp.z;
      const vx = v[0] * x + v[4] * y + v[8] * z + v[12];
      const vy = v[1] * x + v[5] * y + v[9] * z + v[13];
      const vz = v[2] * x + v[6] * y + v[10] * z + v[14];
      const cw = pr[3] * vx + pr[7] * vy + pr[11] * vz + pr[15];
      const iw = cw !== 0 ? 1 / cw : 0;
      const nx = (pr[0] * vx + pr[4] * vy + pr[8] * vz + pr[12]) * iw;
      const ny = (pr[1] * vx + pr[5] * vy + pr[9] * vz + pr[13]) * iw;
      const nz = (pr[2] * vx + pr[6] * vy + pr[10] * vz + pr[14]) * iw;
      const on = nz <= 1 && Math.abs(nx) <= 1 && Math.abs(ny) <= 1;
      this.labelOn[i] = on ? 1 : 0;
      this.labelX[i] = (nx * 0.5 + 0.5) * width;
      this.labelY[i] = (-ny * 0.5 + 0.5) * height;
    }
    // (the fixer of wave 5) names that would overlap: the picked body's and yours kept first, then each in the system's order
    // (a world before its moons), a later one hidden while it stands within a row and a span of one kept; a name that would run
    // past the panel's right edge stands to the left of its globe (`labelRowPx`, `labelSpanPx`)
    const row = SYSTEM_VIEW_TUNE.labelRowPx;
    const span = SYSTEM_VIEW_TUNE.labelSpanPx;
    const n = this.bodies.length < o.bodies.length ? this.bodies.length : o.bodies.length;
    let kept = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < n; i++) {
        const slot = this.bodies[i];
        if (slot.globe < 0) continue;
        const first = slot.look !== 0;
        if ((pass === 0) !== first) continue;
        let on = this.labelOn[i] === 1;
        const sx = this.labelX[i];
        const sy = this.labelY[i];
        if (on && !first) {
          for (let k = 0; k < kept; k++) {
            const j = this.labelKept[k];
            const dx = sx - this.labelX[j];
            const dy = sy - this.labelY[j];
            if ((dy < 0 ? -dy : dy) < row && (dx < 0 ? -dx : dx) < span) {
              on = false;
              break;
            }
          }
        }
        if (slot.label.hidden !== !on) slot.label.hidden = !on;
        if (!on) continue;
        this.labelKept[kept++] = i;
        const left = sx + 10 + span > width;
        const px = left ? Math.round(sx) - 10 : Math.round(sx) + 10;
        const py = Math.round(sy) - 9;
        // a name standing to the left is anchored at its right end (marked as a negative place, so a move between sides writes)
        const mark = left ? -1 - px : px;
        if (slot.label.placedX !== mark || slot.label.placedY !== py) {
          slot.label.placedX = mark;
          slot.label.placedY = py;
          slot.label.style.transform = left ? `translate(${px}px, ${py}px) translateX(-100%)` : `translate(${px}px, ${py}px)`;
        }
      }
    }
  }

  /** Each body's name's place on the screen last worked (pixels), whether it is in view, and the names kept this frame. */
  private readonly labelX = new Float64Array(64);
  private readonly labelY = new Float64Array(64);
  private readonly labelOn = new Uint8Array(64);
  private readonly labelKept = new Int32Array(64);

  /** The body under a point on the canvas (its globe's middle, or its globe on screen), or -1. A click's, never a frame's. */
  pickAt(camera: THREE.Camera, x: number, y: number, width: number, height: number, pickPixels: number): number {
    const o = this.opened;
    if (!o) return -1;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < this.bodies.length && i < o.bodies.length; i++) {
      const slot = this.bodies[i];
      if (slot.globe < 0) continue;
      const mesh = this.globes[slot.globe].mesh;
      this.at.copy(mesh.position).add(this.group.position);
      this.scratch.copy(this.at).project(camera as THREE.PerspectiveCamera);
      if (projectedBehind(this.scratch.z, camera as THREE.PerspectiveCamera)) continue;
      const sx = (this.scratch.x * 0.5 + 0.5) * width;
      const sy = (-this.scratch.y * 0.5 + 0.5) * height;
      // The globe's radius on the screen: its edge projected.
      this.scratch.copy(this.at).addScaledVector((camera as THREE.PerspectiveCamera).up, mesh.scale.x).project(camera as THREE.PerspectiveCamera);
      const rpx = Math.abs((-this.scratch.y * 0.5 + 0.5) * height - sy);
      const d = Math.hypot(sx - x, sy - y);
      if (d <= Math.max(pickPixels, rpx + 4) && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /** Where a body's globe stands in the galaxy's frame, for centring the view on it; null for none. */
  placeOf(i: number, out: THREE.Vector3): THREE.Vector3 | null {
    const slot = this.bodies[i];
    if (!this.opened || !slot || slot.globe < 0) return null;
    return out.copy(this.globes[slot.globe].mesh.position).add(this.group.position);
  }

  /** What the console reads: the system as the map has it, with each body's wear and its globe's size. */
  describe(): Record<string, unknown> | null {
    const o = this.opened;
    if (!o) return null;
    const r = o.report();
    const bodies = r.bodies as Record<string, unknown>[];
    for (let i = 0; i < bodies.length && i < this.bodies.length; i++) {
      const slot = this.bodies[i];
      const g = slot.globe >= 0 ? this.globes[slot.globe] : null;
      bodies[i].globe = g ? Number(g.mesh.scale.x.toFixed(3)) : null;
      bodies[i].wears = g ? (g.mat.uniforms.uMap.value === this.blank ? 'colour' : this.made.includes(g.mat.uniforms.uMap.value as THREE.Texture) ? 'look' : 'swg') : null;
      bodies[i].clouds = g ? g.mat.uniforms.uCloudOn.value === 1 : false;
      bodies[i].rim = slot.rim.visible;
      bodies[i].rings = this.ringOn[i] === 1;
      bodies[i].ringShown = slot.ring.visible;
    }
    return { ...r, picked: this.pickedBody, fade: Number(this.fade.toFixed(3)), pictures: this.made.length, centre: [this.group.position.x, this.group.position.y, this.group.position.z].map((v) => Math.round(v)) };
  }
}
