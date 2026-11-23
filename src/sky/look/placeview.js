// The place views. A space zone IN ORBIT: a ship's view from the zone's centre, the zone's stars where
// its file hangs them (its sun where the zone's sun is set), every planet and moon of the zone at its
// true angle and direction. A ground sky FROM THE GROUND: a horizon, the sun and moon riding the
// world's light at the hour, every extra body at its angle. Each body is its place's look (build.js),
// placed, sized, turned and lit by its place's own settings; a place with no look gets a grey stand-in
// (or, for a sun picture, a drawn sun). The camera stands at the centre and looks round.

import * as THREE from 'three/webgpu';
import { uniform, vec3, vec4, mix, smoothstep, pow, max, dot, normalize, positionLocal, float, exp, mx_noise_float } from 'three/tsl';
import { buildLook, updateLook, syncLook, disposeLook, domeOutline } from './build.js';
import { makeLook } from './looks.js';
import { placeDirection, placeLight, skyDirection, dayAt, yawPitchOf, bodyFrame } from '../system/places.js';
import { Storms, STORM_SLOTS, stormDial } from './weather.js';
// (the GPU port's pass 2, wave 4) "draw as the game does" with the game's own air, in place of the old gamelook.js
import { GAME, spaceSource, stageSource, gamePlanetOf } from './gameAir.ts';
import { DAY_NIGHT_SPLIT as DAY_SPLIT } from '../system/places.js';
import { volumeOccluders } from './volume.js';
// (looks run 2) the air in front of every body seen from the ground: one function, to be replaced by the game's real air
import { skyWash, WASH } from './skywash.js';
// (wave B) the drawn sun's own glow laid in front of a body beside it, from the very stops the sun is drawn with
import { sunGlowAt, SUN_DISC_STOPS, SUN_GLOW_STOPS } from './skywash.js';
// (the atmosphere brief's wave A) the ground world's own air for a Scattered body's wash
import { airWash } from './skywash.js';
import { airTablesOf, airOf } from './build.js';
// (the GPU port's pass 2, wave 4b) drawn as the game does, a body is held as the game holds it (`seenMost`)
import { BODY_TUNE } from '../bodies/bodyTier.ts';

/**
 * Wave 4, the ground's own storm: when the world we stand on has storm cells in its clouds (its planet
 * look's), flashes light the sky. A flash's place on the storm clock's sphere gives its bearing and its
 * distance (0.4 to 14 km; the cloud base 2.5 km up, so a near one is high and a far one low on the
 * sky); a near flash is bright and lights much of the sky, a far one is a faint glow low down.
 */
const CLOUD_BASE_KM = 2.5;
export function groundFlash(x, y, z, out) {
  const d = 0.4 + 13.6 * Math.pow((y + 1) / 2, 1.6);
  const el = Math.atan(CLOUD_BASE_KM / d);
  const az = Math.atan2(x, z);
  out.x = Math.sin(az) * Math.cos(el); out.y = Math.sin(el); out.z = Math.cos(az) * Math.cos(el);
  out.km = d;
  // brightness by distance, and how much of the sky one lights (radians across: about 40 degrees near,
  // 14 far; half that high). (The look tuner's pass:) a far storm's glow stays plain on a night sky, as
  // heat lightning does many miles off, so the fall with distance is gentle; a near one washes the whole
  // sky and the ground (`near`)
  out.k = 1 / (1 + d / 4);
  out.near = 1 / (1 + (d / 1.5) * (d / 1.5));
  out.size = 0.22 + 0.5 / (1 + d);
  return out;
}

/**
 * The ground's day: under a system of version 2, the day its sky state holds (where its sun really is); else SWG's at the hour.
 * (The GPU port's pass 2, wave 5) Drawn as the game does under the system the game follows (`gameAir.ts`' `SkyView`), the
 * game's own day, whatever the system's version.
 */
const dayOfSky = (sky, hours) => (sky && (sky.game || sky.model.version === 2) ? sky.out.day : dayAt(hours));
/** Under a world's system (system.js), a body's drawing distance follows its real distance, so nearer stays in front (a giant hides the sun). */
const systemDrawDistance = (d) => 1000 + 1800 * Math.min(1, Math.max(0, (Math.log10(Math.max(1e-9, d)) + 4) / 4.5));
const HIDDEN = { dir: { x: 0, y: -1, z: 0 }, shown: false, why: 'the world\'s system hides it (the system stands for it)', alpha: 0, j: -1 };

const DEG = Math.PI / 180;
/** Ground view: the sky's dome, the ground (writing depth, so what is below the horizon is hidden) and the bodies between them. */
const GROUND_SKY_R = 3000;
const GROUND_R = 900;
const GROUND_BODY_D = 1500;
/** Space view: the stars and the zone's star pictures far behind every body. */
const SPACE_STAR_R = 20000;
/** A zone's bodies keep their true angle; their distance is squeezed into the camera's reach in order, nearer staying nearer. */
const spaceDrawDistance = (d) => (8000 * Math.max(1, d)) / (Math.max(1, d) + 2000);

/** What a place with no look shows: a lit grey sphere (the words read it too). */
export const PLACEHOLDER = makeLook({
  name: '(no look)', kind: 'sphere', mesh: 'planet_01_mesh',
  layers: { surface: { on: true, tex: '', lit: true, tint: '#a4adb5' } },
  adjust: { ambient: 0.08, spin: 0 },
});
const isSunPicture = (name) => !!name && /^sun/.test(name);

// Our own soft discs and glows, drawn on a canvas (no picture of the game's).
const texCache = new Map();
function radialTexture(key, stops) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [t, a] of stops) grad.addColorStop(t, `rgba(255,255,255,${a})`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  texCache.set(key, tex);
  return tex;
}
// The disc of a sun picture fills a fifth of its square (flareMath.ts); a star's bright core fills 0.08
// of its square. The glows round them are ours: faint, falling off fast, so a star reads as a point of
// light with a haze and not as a lamp across a third of the sky (SWG's own glow pictures are not read).
// (wave B: the same stops skywash.js reads for the glow in front of a body)
const SUN_DISC = SUN_DISC_STOPS;
const SUN_GLOW = SUN_GLOW_STOPS;
const STAR_DISC = [[0, 1], [0.03, 0.95], [0.06, 0.4], [0.1, 0.08], [0.25, 0.01], [1, 0]];
const STAR_GLOW = [[0, 0.5], [0.04, 0.32], [0.12, 0.12], [0.3, 0.035], [0.6, 0.008], [1, 0]];

const quadGeom = new THREE.PlaneGeometry(1, 1);
function glowQuad(tex, colour, order) {
  const m = new THREE.MeshBasicNodeMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  m.color.set(colour);
  const q = new THREE.Mesh(quadGeom, m);
  q.renderOrder = order;
  q.frustumCulled = false;
  return q;
}

const _m = new THREE.Matrix4();
const _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
/** skyBodies.ts turnSkyBody: face the camera at the centre, upright to the horizon. */
function faceTurn(d, out) {
  _bz.set(-d.x, -d.y, -d.z);
  const h = Math.sqrt(d.x * d.x + d.z * d.z);
  if (h > 1e-6) _bx.set(-d.z / h, 0, d.x / h);
  else _bx.set(1, 0, 0);
  _by.crossVectors(_bz, _bx);
  _m.makeBasis(_bx, _by, _bz);
  return out.setFromRotationMatrix(_m);
}

// (the GPU port's pass 2, wave 4b) A held body's picture from its zone's sky pack (read only), kept by name; one not there (a
// pack converted before the Death Star's pictures were) a grey disc of our own in its place.
const heldTextures = new Map();
function heldTexture(zone, picture) {
  const key = `${zone}/${picture}`;
  if (heldTextures.has(key)) return heldTextures.get(key);
  const grey = radialTexture('heldstandin', [[0, 0.85], [0.44, 0.8], [0.46, 0.0], [1, 0]]);
  const tex = new THREE.Texture();
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.image = grey.image;
  tex.needsUpdate = true;
  tex.userData.standIn = true;
  const img = new Image();
  img.onload = () => { tex.image = img; tex.userData.standIn = false; tex.needsUpdate = true; };
  img.src = `/assets-private/${encodeURIComponent(zone)}/sky/${encodeURIComponent(picture)}.png`;
  heldTextures.set(key, tex);
  return tex;
}

const lerpColour = (a, b, t, out) => out.copy(a).lerp(b, Math.min(1, Math.max(0, t)));
const smooth = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class PlaceView {
  constructor(S, marksEl, onPick) {
    this.S = S;
    this.marksEl = marksEl;
    this.onPick = onPick;
    this.active = false;
    this.zone = null;
    this.space = false;
    this.selected = null;
    this.bodies = [];
    this.starQuads = [];
    this.view = { yaw: 0, pitch: 10, fov: 60 };
    this.saved = null;
    this.token = 0;
    this.lastDay = null;
    this.marks = new Map();
    this.markData = [];
    this.group = new THREE.Group();
    this.group.visible = false;
    this.bodiesGroup = new THREE.Group();
    this.starsGroup = new THREE.Group();
    this.group.add(this.bodiesGroup, this.starsGroup);
    S.scene.add(this.group);
    this.makeGround();
    this.wirePointer();
    // wave 4: the ground's own storm (its clock writes into these holders; the sky's uniforms are set from them)
    this.groundStorms = new Storms(0x51f15e, false);
    this.groundCells = Array.from({ length: STORM_SLOTS }, () => ({ value: new THREE.Vector4(0, 1, 0, 0) }));
    this._gf = { x: 0, y: 1, z: 0, km: 1, k: 1, near: 0, size: 0.3 };
    this._tf = { x: 0, y: 1, z: 0, km: 1, k: 1, near: 0, size: 0.3 };
    this.groundStorms.onFlash = (x, y, z, peak) => {
      const f = groundFlash(x, y, z, this._tf);
      // (the thunder falls off with distance by its own law: the flash's strength alone goes to it)
      if (this.onThunder) this.onThunder(f.km, peak, x, y, z);
    };
    this.onThunder = null;
    // wave 4: the game's grade, fed from here from the ground and in orbit (gameAir.ts since the GPU port's pass 2, wave 4), or null
    this.gameLook = null;
    this._sky = [0, 0, 0];
    // (looks run 2) the sky's light washed over every body by day, from the ground (skywash.js); off with
    // ?wash=0 or __viewer.wash(false), and its numbers (WASH) live there to move by eye
    // (wave B) on or off and its numbers are the viewer's own settings now (the Day wash box over the stage, each a step
    // of the history): the page hands them over (applyViewer); ?wash=0 still starts the page with it off, until the box
    // is ticked. Its numbers are this view's own copy, never the module's.
    this.washUrlOff = /[?&]wash=0\b/.test(globalThis.location?.search || '');
    this.wash = !this.washUrlOff;
    this.washNumbers = { ...WASH, depth: [...WASH.depth] };
    this._wash = { light: { r: 0, g: 0, b: 0 }, trans: { r: 1, g: 1, b: 1 } };
    this._washSky = null;
    // (wave B) the suns drawn this frame, for their glow in front of the bodies beside them (kept records)
    this._suns = [];
    this._sunN = 0;
    this._glowAdd = { r: 0, g: 0, b: 0 };
  }

  /**
   * (wave A) The air of the world we stand on, as tables: its planet look's own air (a look without one: its recipe's
   * start, or the Earth's at the game's clear day), made again only when that air changes.
   */
  groundAir() {
    const look = this.ctx.worldLook?.() || null;
    const air = airOf(look);
    const key = JSON.stringify(air);
    if (!this._gAir || this._gAir.key !== key) this._gAir = { key, tabs: airTablesOf(air) };
    return this._gAir.tabs;
  }

  /** The sky's state for skyWash: the dome's own uniforms' values (no copies made), with the daylight. */
  washSky() {
    const U = this.skyU;
    const s = this._washSky || (this._washSky = { zenith: null, horizon: null, sunDir: null, sunGlow: null, gZenith: null, gHorizon: null, glowAmt: 0, game: 0, zenithAt: GAME.skyZenithAt, daylight: 0 });
    s.zenith = U.zenith.value; s.horizon = U.horizon.value; s.sunDir = U.sunDir.value; s.sunGlow = U.sunGlow.value;
    s.gZenith = U.gZenith.value; s.gHorizon = U.gHorizon.value;
    s.glowAmt = U.glowAmt.value; s.game = U.game.value; s.daylight = this.dl ?? 0;
    return s;
  }

  // ---- the ground sky's dome and the ground ----
  makeGround() {
    const U = (this.skyU = {
      zenith: uniform(new THREE.Color(0x2f63a6)), horizon: uniform(new THREE.Color(0xa7c3dd)), ground: uniform(new THREE.Color(0x1c1913)),
      sunDir: uniform(new THREE.Vector3(0, 1, 0)), sunGlow: uniform(new THREE.Color(0xfff0d0)), glowAmt: uniform(0.5),
      // wave 4: the game's own sky (the ramp's fog at the horizon up to its clear colour), 0 or 1
      game: uniform(0), gZenith: uniform(new THREE.Color(0.5, 0.5, 0.6)), gHorizon: uniform(new THREE.Color(0.5, 0.5, 0.5)),
      // wave 4: the ground storm's flashes (direction and strength, and each one's size as 1/size^2)
      flash: Array.from({ length: STORM_SLOTS }, () => uniform(new THREE.Vector4(0, 1, 0, 0))),
      flashInv: Array.from({ length: STORM_SLOTS }, () => uniform(1)),
      flashColour: uniform(new THREE.Color(0.7, 0.75, 1)),
      flashAmb: uniform(0),
    });
    const d = normalize(positionLocal);
    let col = mix(U.horizon, U.zenith, pow(max(d.y, 0.0), 0.55));
    col = col.add(U.sunGlow.mul(pow(max(dot(d, normalize(U.sunDir)), 0.0), 18.0)).mul(U.glowAmt));
    col = mix(col, mix(U.gHorizon, U.gZenith, smoothstep(0.0, GAME.skyZenithAt, d.y)), U.game);
    // (the look tuner's pass) a flash lights a bank of cloud, never a round spot on a clear sky: its glow is
    // wider than tall (each flash's x and z are its bearing, its y the height of its centre), broken into
    // banks by a noise stretched along the horizon, with a faint wide halo; a near one also washes the
    // whole sky (flashAmb) and the ground
    let fl = float(0);
    const cl = max(float(1).sub(d.y.mul(d.y)), 0.0);
    const hx = d.x.div(max(cl.sqrt(), 1e-4)), hz = d.z.div(max(cl.sqrt(), 1e-4));
    for (let i = 0; i < STORM_SLOTS; i++) {
      const F = U.flash[i];
      const dy = d.y.sub(F.y);
      const e = float(2).mul(float(1).sub(hx.mul(F.x).add(hz.mul(F.z)))).mul(cl).add(dy.mul(dy).mul(7.0)).mul(U.flashInv[i]);
      fl = fl.add(F.w.mul(exp(e.negate()).add(exp(e.mul(-0.15)).mul(0.06))));
    }
    const bank = mx_noise_float(vec3(d.x.mul(5.0), d.y.mul(15.0), d.z.mul(5.0))).mul(0.7).add(mx_noise_float(vec3(d.x.mul(13.0), d.y.mul(34.0), d.z.mul(13.0)).add(3.7)).mul(0.3));
    const lump = mix(float(0.25), float(1.0), smoothstep(-0.35, 0.4, bank));
    col = col.add(U.flashColour.mul(fl.mul(lump).add(U.flashAmb.mul(mix(float(0.35), float(1.0), max(d.y, 0.0))))));
    const skyMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false });
    skyMat.colorNode = vec4(col, 1.0);
    // (pass 2, wave 4) kept: drawn as the game does, the dome wears the game's own sky while the world's air draws
    this.skyMat = skyMat;
    this.airDrawn = false;
    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(GROUND_SKY_R, 48, 24), skyMat);
    this.skyDome.renderOrder = -30;
    this.skyDome.frustumCulled = false;
    const gd = normalize(positionLocal);
    const groundMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
    groundMat.colorNode = vec4(mix(U.ground, U.horizon.mul(0.42), smoothstep(-0.07, 0.0, gd.y)).add(U.flashColour.mul(U.flashAmb.mul(0.3))), 1.0);
    // the lower half of a sphere about the camera: the horizon at exactly 0 degrees
    this.groundCap = new THREE.Mesh(new THREE.SphereGeometry(GROUND_R, 64, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), groundMat);
    // (the GPU port's pass 2, wave 5) kept: drawn as the game does, the ground wears the game's haze while the world's air draws
    this.groundCapMat = groundMat;
    this.nightGroup = null;
    this.groundCap.renderOrder = -20;
    this.groundCap.frustumCulled = false;
    this.group.add(this.skyDome, this.groundCap);
    this.cols = {
      dayZ: new THREE.Color(0x2f63a6), dayH: new THREE.Color(0xa7c3dd), nightZ: new THREE.Color(0x03060d), nightH: new THREE.Color(0x0d1626),
      dusk: new THREE.Color(0xd88a55), dayG: new THREE.Color(0x24201a), nightG: new THREE.Color(0x060606), tmp: new THREE.Color(),
      moonZ: new THREE.Color(0x1d3150), moonH: new THREE.Color(0x3a5272),
    };
  }

  // ---- the camera: stand at the centre and look round; the wheel narrows or widens the view ----
  wirePointer() {
    const canvas = this.S.renderer.domElement;
    let down = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      down = { x: e.clientX, y: e.clientY, yaw: this.view.yaw, pitch: this.view.pitch, moved: false, id: e.pointerId };
      canvas.setPointerCapture?.(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.active || !down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) down.moved = true;
      const k = this.view.fov / Math.max(200, canvas.clientHeight);
      // grab the sky: it follows the pointer
      this.view.yaw = down.yaw - dx * k;
      this.view.pitch = Math.max(-89, Math.min(89, down.pitch + dy * k));
    });
    const up = (e) => {
      if (!this.active || !down) return;
      const wasClick = !down.moved;
      canvas.releasePointerCapture?.(down.id);
      down = null;
      if (wasClick) this.pickAt(e.clientX, e.clientY);
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', () => { down = null; });
    canvas.addEventListener('wheel', (e) => {
      if (!this.active) return;
      e.preventDefault();
      this.view.fov = Math.max(5, Math.min(110, this.view.fov * Math.exp(e.deltaY * 0.0012)));
      this.onView?.();
    }, { passive: false });
  }

  applyCamera() {
    const cam = this.S.camera;
    cam.position.set(0, 0, 0);
    // (pass 2, wave 4) a frame handed over from the game, drawn as the game does from the ground of its world: the game's
    // camera's own turn and field of view (the game's world frame and this view's are one: y up, the noon light toward -z)
    const M = this.gameLook?.on && !this.space ? this.gameLook.match : null;
    if (M && gamePlanetOf(this.zone) === M.planet) {
      cam.quaternion.set(M.camera.qx, M.camera.qy, M.camera.qz, M.camera.qw);
      if (cam.fov !== M.camera.fov) { cam.fov = M.camera.fov; cam.updateProjectionMatrix(); }
      cam.updateMatrixWorld(true);
      return;
    }
    cam.rotation.order = 'YXZ';
    cam.rotation.set(this.view.pitch * DEG, -this.view.yaw * DEG, 0);
    if (cam.fov !== this.view.fov) { cam.fov = this.view.fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld(true);
  }

  // ---- open, build, close ----
  /**
   * Show a zone or a sky. `places` are every place of it; `ctx` hands over the settings:
   * lookOf(id), effective(place), zoneSun(zone), hours(), onStatus(text).
   */
  async open({ zone, space, places, stars, selected, ctx, rebuild = false, aim = true }) {
    const S = this.S;
    if (!this.active) {
      this.saved = {
        pos: S.camera.position.clone(), quat: S.camera.quaternion.clone(), fov: S.camera.fov, near: S.camera.near, far: S.camera.far,
        target: S.controls.target.clone(), starsScale: S.stars.scale.x,
      };
      S.controls.enabled = false;
      S.camera.near = 0.5;
      S.camera.far = 60000;
      S.camera.updateProjectionMatrix();
      this.active = true;
    }
    this.ctx = ctx;
    this.selected = selected;
    const changed = rebuild || this.zone !== zone;
    this.zone = zone;
    this.space = space;
    this.skyDome.visible = !space;
    this.groundCap.visible = !space;
    S.stars.scale.setScalar(space ? SPACE_STAR_R / 900 : 2.8);
    this.group.visible = true;
    let ok = true;
    if (changed) ok = await this.build(places, stars, ctx);
    if (aim) this.aim();
    return ok;
  }

  close() {
    if (!this.active) return;
    const S = this.S;
    this.active = false;
    this.group.visible = false;
    if (this.nightGroup) { this.nightGroup.removeFromParent(); this.nightGroup = null; }
    this.disposeBodies();
    this.clearStars();
    this.zone = null;
    for (const m of this.marks.values()) m.el.remove();
    this.marks.clear();
    const s = this.saved;
    if (s) {
      S.camera.position.copy(s.pos);
      S.camera.quaternion.copy(s.quat);
      S.camera.fov = s.fov;
      S.camera.near = s.near;
      S.camera.far = s.far;
      S.camera.updateProjectionMatrix();
      S.controls.target.copy(s.target);
      S.stars.scale.setScalar(s.starsScale || 1);
    }
    S.controls.enabled = true;
    S.controls.update();
  }

  async build(places, stars, ctx) {
    const token = ++this.token;
    const made = await Promise.all(places.map(async (p) => {
      const look = ctx.lookOf(p.id);
      const body = { place: p, lookId: look ? look.id : null, look: look ? look.look : null, built: null, glow: null, error: null };
      try {
        // (wave B, its critic: built for a place, so its rings and rocks are seen through the ground's air as its body is)
        if (look) body.built = await buildLook(look.look, { onStatus: ctx.onStatus, place: true });
        // (under a world's system, a star of it whose place has no picture of SWG's, as Dathomir's sun slot, is the drawn sun too)
        else if (!p.space && (isSunPicture(p.picture) || !!ctx.systemStar?.(p.id))) body.glow = this.sunGlow();
        else body.built = await buildLook(PLACEHOLDER, { onStatus: ctx.onStatus, place: true });
      } catch (e) {
        body.error = e.message;
        console.warn('[viewer] place', p.id, e);
        body.built = await buildLook(PLACEHOLDER, { place: true }).catch(() => null);
      }
      return body;
    }));
    if (token !== this.token) {
      for (const b of made) this.disposeBody(b);
      return false;
    }
    this.disposeBodies();
    this.bodies = made;
    for (const b of made) {
      if (b.built) {
        b.built.placeScale = 1;
        b.built.root.frustumCulled = false;
        this.bodiesGroup.add(b.built.root);
      }
      if (b.glow) this.bodiesGroup.add(b.glow.group);
    }
    this.clearStars();
    if (this.space && stars) {
      for (const g of stars.groups) {
        const isSun = stars.sunGroup && g.yaw === stars.sunGroup.yaw && g.pitch === stars.sunGroup.pitch;
        const holder = new THREE.Group();
        const glow = g.glowSize > 0 ? glowQuad(radialTexture('starglow', STAR_GLOW), 0xffffff, -8) : null;
        const disc = g.discSize > 0 ? glowQuad(radialTexture('stardisc', STAR_DISC), 0xffffff, -7) : null;
        if (glow) holder.add(glow);
        if (disc) holder.add(disc);
        this.starsGroup.add(holder);
        this.starQuads.push({ g, isSun, holder, glow, disc });
      }
    }
    return true;
  }

  sunGlow() {
    const group = new THREE.Group();
    const glow = glowQuad(radialTexture('sunglow', SUN_GLOW), 0xfff1d6, -6);
    const disc = glowQuad(radialTexture('sundisc', SUN_DISC), 0xfffaf0, -5);
    group.add(glow, disc);
    return { group, glow, disc };
  }

  /**
   * (the GPU port's pass 2, wave 4b) The bodies held still in this ground sky (the Death Star over Endor, any of SWG's sky
   * sprites he places: the page's `held`, else SWG's own placement): each a card of SWG's picture from the zone's sky pack
   * (`/assets-private/<zone>/sky/<picture>.png`, read only), facing the eye upright to the horizon at its yaw and pitch (the
   * sky's own convention, `skyDirection`), SWG's square of its size across, turned by its roll, its brightness by its light; a
   * picture not converted yet stands as a grey disc with the same size. `list` is `[{ id, picture, yawDeg, pitchDeg, size,
   * rollDeg, light }]`; called again whenever it changes. Drawn in front of the dome and behind the looks.
   */
  setHeld(list) {
    if (!this.heldGroup) {
      this.heldGroup = new THREE.Group();
      this.group.add(this.heldGroup);
      this.heldQuads = [];
    }
    for (const q of this.heldQuads) { q.removeFromParent(); q.material.dispose(); }
    this.heldQuads = [];
    this.heldGroup.visible = !this.space;
    if (this.space) return;
    const D = GROUND_BODY_D * 1.25;
    for (const h of list || []) {
      const dir = skyDirection(+h.yawDeg || 0, +h.pitchDeg || 0);
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.NormalBlending });
      m.color.setScalar(Math.max(0, +h.light || 0));
      m.map = heldTexture(this.zone, h.picture);
      const q = new THREE.Mesh(quadGeom, m);
      q.name = `held ${h.id}`;
      q.renderOrder = -6;
      q.frustumCulled = false;
      q.position.set(dir.x * D, dir.y * D, dir.z * D);
      faceTurn(dir, q.quaternion);
      q.rotateZ((+h.rollDeg || 0) * DEG);
      const w = (2 * D * Math.max(0.01, +h.size || 0)) / 3;
      q.scale.set(w, w, 1);
      q.userData.held = h;
      this.heldGroup.add(q);
      this.heldQuads.push(q);
    }
  }

  disposeBody(b) {
    if (b.built) disposeLook(b.built);
    if (b.glow) { b.glow.group.removeFromParent(); b.glow.glow.material.dispose(); b.glow.disc.material.dispose(); }
  }
  disposeBodies() {
    for (const b of this.bodies) this.disposeBody(b);
    this.bodies = [];
  }
  clearStars() {
    for (const s of this.starQuads) { s.holder.removeFromParent(); s.glow?.material.dispose(); s.disc?.material.dispose(); }
    this.starQuads = [];
  }

  /** Every body built from a look: its uniforms follow the look's sliders at once. */
  syncLook(lookId) {
    for (const b of this.bodies) if (b.built && b.lookId === lookId) syncLook(b.built);
  }
  usesLook(lookId) {
    return this.bodies.some((b) => b.lookId === lookId);
  }

  // ---- aiming ----
  /** Turn the camera onto the selected body; from the ground keep the horizon in view. */
  aim() {
    const b = this.bodies.find((x) => x.place.id === this.selected);
    if (!b) return;
    const e = this.ctx.effective(b.place);
    const sky = this.space ? null : this.ctx.sky?.() || null;
    const day = this.space ? null : dayOfSky(sky, this.ctx.hours());
    const at = this.where(b, e, day, sky);
    const { yaw, pitch } = yawPitchOf(at.dir);
    if (this.space) {
      this.view.fov = Math.max(40, Math.min(100, e.size * 2.6));
      this.view.yaw = yaw;
      this.view.pitch = pitch;
    } else {
      // Keep both the body and the horizon on the screen: the view spans from 14 degrees under the
      // horizon (the bar covers the stage's foot) to 4 over the body's top, widened as far as 110.
      const half = (e.size || 1) / 2;
      const top = pitch + half + 4;
      this.view.fov = Math.max(60, Math.min(110, Math.max(e.size * 2.2, top + 14)));
      this.view.yaw = yaw;
      if (!at.shown || pitch < -2) this.view.pitch = 12;
      else this.view.pitch = Math.max(0, Math.min(89, Math.max((top - 14) / 2, top - this.view.fov / 2)));
    }
    this.onView?.();
  }

  /**
   * Where a body is now: under its world's system (ctx.sky), where the system's model puts it (a place
   * the system hides is hidden; one it does not name keeps SWG's rule); else SWG's rule (places.js).
   */
  where(b, e, day, sky) {
    const p = b.place;
    // (the GPU port's pass 2, wave 5) a body only a system names stands nowhere until that system is read
    if (!sky && p.systemBody) return HIDDEN;
    if (sky) {
      if (sky.model.hidden.has(p.id)) return HIDDEN;
      const j = p.systemBody ? p.itemIndex : sky.model.itemOf.get(p.id);
      if (j !== undefined) {
        const o = sky.out, d = b._sd || (b._sd = { x: 0, y: 0, z: 0 });
        d.x = o.dir[3 * j]; d.y = o.dir[3 * j + 1]; d.z = o.dir[3 * j + 2];
        if (!sky.model.itemDrawn[j]) return HIDDEN;
        // a star fades in its last degrees above the horizon, as SWG's sun slot does
        const alpha = sky.model.itemStar[j] ? Math.min(1, Math.max(0, d.y / 0.08)) : 1;
        const shown = alpha > 0.002 && d.y > -0.3;
        return { dir: d, shown, why: shown ? '' : 'it is below the horizon', alpha, j };
      }
    }
    const at = placeDirection(p, e, day);
    at.j = -1;
    return at;
  }

  // ---- every frame ----
  frame(clock, wall = performance.now() / 1000) {
    if (!this.active) return;
    const S = this.S;
    this.applyCamera();
    const ctx = this.ctx;
    const sky = this.space ? null : ctx.sky?.() || null;
    // under a system of version 2 the day is where its sun really is; else SWG's light at the hour
    const day = this.space ? null : dayOfSky(sky, ctx.hours());
    this.lastDay = day;
    const zs = this.space ? ctx.zoneSun(this.zone) : null;
    const camera = S.camera;
    this.lastSky = sky;
    if (!this.space) { this.updateSky(day, sky); this.updateGroundStorm(day, wall); }
    else {
      S.stars.visible = ctx.starsOn();
      // (the GPU port's pass 2, wave 5) the game's night is a ground sky's
      if (this.nightGroup) { this.nightGroup.removeFromParent(); this.nightGroup = null; }
    }
    // wave 4: the game's grade for this frame, from the light the game would have here
    const G = this.gameLook;
    if (G && G.on) {
      // (the GPU port's pass 2, wave 5) in orbit, and while a world's air is not made, the eye stands at an exposure of 1 (it kept
      // the last ground sky's, as much as 15 stops after a night)
      if (this.space) { spaceSource(ctx.zoneSky?.(this.zone), G.source); G.setGrade(this.zone, 'space zone'); G.stageEye(); }
      // (pass 2, wave 4) from the ground the grade reads the world's own air at the hour (updateSky ran it this frame)
      else if (this.airDrawn) { G.airSource(G.source); G.setGrade(gamePlanetOf(this.zone), "the game's air"); }
      else {
        // a world whose air is not made (no converted sky, or not yet): a plain day's light, the night as the hour has it
        stageSource(G.source);
        G.source.space = false;
        G.source.night = 1 - (this.dl ?? 1);
        G.setGrade(this.zone, "neutral (the world's air not made)");
        G.stageEye();
      }
    }

    // the zone's stars; its sun where the zone's sun is set
    const marks = [];
    for (const s of this.starQuads) {
      const yaw = s.isSun && zs ? zs.yaw : s.g.yaw;
      const pitch = s.isSun && zs ? zs.pitch : s.g.pitch;
      const d = skyDirection(yaw, pitch);
      s.holder.position.set(d.x, d.y, d.z).multiplyScalar(SPACE_STAR_R * 0.95);
      faceTurn(d, s.holder.quaternion);
      const scale = (size) => 2 * SPACE_STAR_R * 0.95 * (size / 3); // a star's square is `size` half-wide 3 m out
      const tint = s.isSun && zs ? zs.colour : '#ffffff';
      const bright = s.isSun && zs ? zs.brightness : 1;
      if (s.glow) { s.glow.scale.setScalar(scale(s.g.glowSize)); s.glow.material.color.set(tint).multiplyScalar(bright); }
      if (s.disc) { s.disc.scale.setScalar(scale(s.g.discSize)); s.disc.material.color.set(tint).multiplyScalar(bright); }
      if (s.isSun) marks.push({ id: '__sun', label: 'the zone\'s sun', pos: s.holder.position, rad: SPACE_STAR_R * 0.95 * (Math.max(s.g.glowSize, s.g.discSize) * 0.2 / 3), sun: true });
    }

    let order = 0;
    this._sunN = 0;
    for (const b of this.bodies) {
      const p = b.place;
      const e = ctx.effective(p);
      b._washed = false;
      const at = this.where(b, e, day, sky);
      const holder = b.built ? b.built.root : b.glow?.group;
      if (!holder) continue;
      holder.visible = at.shown;
      if (!at.shown) { marks.push({ id: p.id, label: p.shortLabel || p.label, hidden: true }); continue; }
      const d = at.dir;
      const dist = this.space ? spaceDrawDistance(e.distance ?? 600) : at.j >= 0 ? systemDrawDistance(sky.out.dist[at.j]) - order++ * 0.01 : GROUND_BODY_D - order++ * 0.5;
      // under a system, the size its model has (its own dial, else its place's), so what is drawn is what hides the sun
      const half = Math.max(0.01, ((at.j >= 0 ? sky.model.itemSize[at.j] : e.size) || 1) / 2) * DEG;
      holder.position.set(d.x, d.y, d.z).multiplyScalar(dist);
      // The ring round it sits on its outline: the circle the camera's rays graze, `ringAt` along the
      // way to it and `ringRad` across (a flat picture's outline is its own edge).
      const ring = b._ring || (b._ring = new THREE.Vector3());
      let ringAt = dist, ringRad = dist * Math.tan(half);
      if (b.built) {
        const kind = b.built.look.kind;
        // Every body fills the place's angle with its outline. A sphere of radius r, dist away, fills
        // 2 asin(r / dist). A dome bulges toward the camera, so its outline is wider than its rim and
        // is read from its profile (domeOutline). A flat sheet fills 2 atan(r / dist).
        let r, sphereR = null;
        if (kind === 'sphere') {
          const h = Math.min(half, Math.PI / 2 - 0.01);
          r = dist * Math.sin(h);
          ringAt = dist * Math.cos(h) * Math.cos(h);
          ringRad = r * Math.cos(h);
        } else if (kind === 'dome' && b.built.profile) {
          const o = domeOutline(b.built.profile, Math.min(half, Math.PI / 2 - 0.05), dist);
          r = o.scale;
          ringAt = dist - o.z * r;
          ringRad = o.rho * r;
          sphereR = dist * Math.sin(Math.min(half, Math.PI / 2 - 0.01)); // the sphere it stands for
          // (wave 5: for a volume's gas, the sphere the dome stands for: the place's own angle, so a
          // picture's dark edge beyond its disc is covered by the gas behind it, as space would be)
          b._sphereR = sphereR;
        } else {
          r = dist * Math.tan(Math.min(half, Math.PI / 2 - 0.05));
        }
        b.built.placeScale = r;
        holder.scale.setScalar(r);
        let L = placeLight(p, e, day, zs, b.look || PLACEHOLDER, d);
        if (at.j >= 0 && e.light.source === 'world-sun') {
          // lit by the real sun, from where the body really is (its phase is the system's)
          const o = sky.out, k = 3 * at.j, ld = b._sl || (b._sl = { x: 0, y: 0, z: 0 });
          ld.x = o.light[k]; ld.y = o.light[k + 1]; ld.z = o.light[k + 2];
          L = { dir: ld, power: 1, colour: '#ffffff', painted: false };
        }
        b.built.LU.sunPower.value = L.power;
        // (read again only when it changes: a colour made or parsed each frame is garbage each frame)
        if (b._lc !== L.colour) { b._lc = L.colour; const c = new THREE.Color(L.colour); b.built.LU.sunColour.value.set(c.r, c.g, c.b); }
        b.built.LU.gain.value = (e.brightness ?? 1) * (at.alpha ?? 1);
        // (the GPU port's pass 2, wave 4b) drawn as the game does from the ground: the body held as the game holds it, its
        // white held to `seenMost` of the screen's white (below, once the air in front of it is known)
        const heldAsGame = !this.space && G && G.on && this.airDrawn;
        // the air in front of it, from the ground (none in orbit, or with the wash off)
        if (!this.space && this.wash) {
          // (wave A) a body whose air is Scattered takes the ground world's own air for what comes through
          const w = b.built.airMode === 'scattered' ? airWash(d, this.washSky(), this.groundAir(), this._wash, this.washNumbers) : skyWash(d, this.washSky(), this._wash, this.washNumbers);
          b.built.LU.airLight.value.set(w.light.r, w.light.g, w.light.b);
          b.built.LU.airTrans.value.set(w.trans.r, w.trans.g, w.trans.b);
          // (wave B) the drawn sun's glow in front of it is added once every sun of the frame is known (below)
          b._washed = true;
          const wd = b._wd || (b._wd = { x: 0, y: 0, z: 0 });
          wd.x = d.x; wd.y = d.y; wd.z = d.z;
        } else {
          b.built.LU.airLight.value.set(0, 0, 0);
          b.built.LU.airTrans.value.set(1, 1, 1);
        }
        // (the fixer of pass 2, wave 5) drawn as the game does, the body is seen through the game's own air as the game's card
        // sees it (`gameAir.ts`' `bodySeen`): lit by the star's light at the top of the air over pi, what comes through and the
        // air's light in front of it the twin's, in the scene's units the eye reads (the wash's own light, in its own units,
        // under the game's eye made Yavin Prime a flat white disc at dusk)
        const seen = heldAsGame ? (this._seen || (this._seen = { trans: new THREE.Vector3(), light: new THREE.Vector3(), star: new THREE.Vector3() })) : null;
        const seenAsGame = !!seen && G.bodySeen(d.x, d.y, d.z, seen);
        if (seenAsGame) {
          b._lc = null;
          b.built.LU.sunColour.value.copy(seen.star);
          b.built.LU.airTrans.value.copy(seen.trans);
          b.built.LU.airLight.value.copy(seen.light);
          b._washed = false;
        }
        if (heldAsGame) {
          // The game's rule (`skyBody.ts`, `BODY_TUNE.seenMost`): the light a white pixel of the body would send through the air,
          // times the eye's exposure, held to `seenMost` of the screen's white by one factor for the whole disc, so a moon at
          // dusk under an opening eye does not wash the frame white with its bloom and its features still read.
          const tr = b.built.LU.airTrans.value;
          const st = seenAsGame ? seen.star : null;
          const lum = st ? 0.2126 * tr.x * st.x + 0.7152 * tr.y * st.y + 0.0722 * tr.z * st.z : 0.2126 * tr.x + 0.7152 * tr.y + 0.0722 * tr.z;
          const white = L.power * lum * (b.built.LU.gain.value || 0) * G.U.exposure.value;
          const most = BODY_TUNE.seenMost;
          if (white > most) b.built.LU.gain.value *= most / white;
        }
        const face = faceTurn(d, b.built._face || (b.built._face = new THREE.Quaternion()));
        const lw = L.dir ? (b.built._light || (b.built._light = new THREE.Vector3())).set(L.dir.x, L.dir.y, L.dir.z) : null;
        // a body the system turns (a giant's bands): its turns a day on the sky's clock, else the place's own
        // spin (version 2: its own day in real time, degrees a real day, its clock held small)
        const v2 = at.j >= 0 && sky.model.version === 2;
        const spinDeg = v2 ? sky.model.itemSpin[at.j] : at.j >= 0 ? sky.model.items[at.j].turns * 360 : 0;
        let ck = clock;
        if (spinDeg) { ck = sky.out.T; if (v2) { const span = (360 / spinDeg) * 64; ck -= Math.floor(ck / span) * span; } }
        updateLook(b.built, { camera, clock: ck, sunWorld: lw || camera.position, face, lightWorld: lw, tilt: e.tilt, spin: spinDeg || e.spin, sphereRadius: sphereR });
      } else if (b.glow) {
        // (the GPU port's pass 2, wave 5) drawn as the game does from the ground, a sun is the air's own disc on the game's dome
        // (SWG's sun pictures are retired on WebGPU): its picture and glow are not drawn, nor laid in front of the bodies; its
        // mark stays where it stands
        if (!this.space && G && G.on && this.airDrawn) {
          b.glow.group.visible = false;
          ring.set(d.x, d.y, d.z).multiplyScalar(ringAt);
          marks.push({ id: p.id, label: p.shortLabel || p.label, pos: ring, rad: ringRad * 0.22, nolook: !b.lookId });
          continue;
        }
        faceTurn(d, b.glow.group.quaternion);
        const square = 2 * dist * Math.tan(half);
        const glowShare = p.swgSize > 0 ? (p.glowSize || 0) / p.swgSize : 1.4;
        b.glow.disc.scale.setScalar(square);
        b.glow.glow.scale.setScalar(square * Math.max(1, glowShare));
        // (version 2: a star's own strength too, so Tatoo II is the dimmer of the pair)
        const own = at.j >= 0 && sky.model.version === 2 ? Math.min(1.5, sky.model.itemBright[at.j]) : 1;
        const k = (e.brightness ?? 1) * (at.alpha ?? 1) * own;
        const tint = at.j >= 0 ? sky.model.items[at.j].colour : null;
        if ((tint || null) !== (b._tint || null)) {
          // a star's colour from its system, and back to the picture's own when it is taken away
          if (!b._tint0) b._tint0 = [b.glow.disc.material.color.clone(), b.glow.glow.material.color.clone()];
          if (tint) { b.glow.disc.material.color.set(tint); b.glow.glow.material.color.set(tint); }
          else { b.glow.disc.material.color.copy(b._tint0[0]); b.glow.glow.material.color.copy(b._tint0[1]); }
          b._tint = tint || null;
        }
        b.glow.disc.material.opacity = Math.min(1, k);
        b.glow.glow.material.opacity = Math.min(1, k) * 0.85;
        // (wave B) this sun as drawn, for its glow in front of the bodies beside it: its way, the tangent of its
        // glow's and its disc's half-size, and each one's colour times its opacity (the additive quads' own light)
        if (!this.space) {
          const s = this._suns[this._sunN] || (this._suns[this._sunN] = { x: 0, y: 1, z: 0, glowTan: 0, discTan: 0, glow: { r: 0, g: 0, b: 0 }, disc: { r: 0, g: 0, b: 0 } });
          this._sunN++;
          s.x = d.x; s.y = d.y; s.z = d.z;
          const th = Math.tan(half);
          s.discTan = th;
          s.glowTan = th * Math.max(1, glowShare);
          const gm = b.glow.glow.material, dm = b.glow.disc.material;
          s.glow.r = gm.color.r * gm.opacity; s.glow.g = gm.color.g * gm.opacity; s.glow.b = gm.color.b * gm.opacity;
          s.disc.r = dm.color.r * dm.opacity; s.disc.g = dm.color.g * dm.opacity; s.disc.b = dm.color.b * dm.opacity;
        }
        ringRad *= 0.22; // a sun picture's bright disc is a fifth of its square
      }
      ring.set(d.x, d.y, d.z).multiplyScalar(ringAt);
      marks.push({ id: p.id, label: p.shortLabel || p.label, pos: ring, rad: ringRad, nolook: !b.lookId });
    }
    // (wave B) the drawn sun's own glow lies in front of a body beside it as much as round it (it is the air's light about
    // the sun), so a moon near the sun is not a dark disc cut out of the halo: each washed body takes the glow of every
    // sun of the frame at its own way, times the Day wash's sun share
    if (this._sunN && this.washNumbers.sun > 0) {
      const add = this._glowAdd;
      for (const b of this.bodies) {
        if (!b._washed || !b.built) continue;
        add.r = add.g = add.b = 0;
        sunGlowAt(b._wd, this._suns, this._sunN, add, this.washNumbers.sun);
        if (add.r + add.g + add.b > 0) {
          const v = b.built.LU.airLight.value;
          v.set(v.x + add.r, v.y + add.g, v.z + add.b);
        }
      }
    }
    // wave 5: a space volume's gas stops at the zone's bodies in its way (each the sphere it fills)
    let vols = 0;
    for (let i = 0; i < this.bodies.length; i++) if (this.bodies[i].built?.vol) vols++;
    if (vols) {
      const occ = this._occ || (this._occ = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()]);
      let n = 0;
      for (let i = 0; i < this.bodies.length; i++) {
        const b = this.bodies[i];
        if (n >= 4 || !b.built || b.built.vol || !b.built.root.visible) continue;
        const k = b.built.look.kind;
        // a sphere fills its scale; a dome stands for the sphere of the place's angle
        // (out to its air, so its glow is never drawn over by gas behind it)
        const A = b.built.look.layers.atmosphere;
        const r = k === 'sphere' ? b.built.root.scale.x * (A?.on && A.form === 'rim' ? Math.max(1, +A.height || 1) : 1) : k === 'dome' ? b._sphereR || 0 : 0;
        if (!(r > 0)) continue;
        occ[n++].set(b.built.root.position.x, b.built.root.position.y, b.built.root.position.z, r);
      }
      for (let i = 0; i < this.bodies.length; i++) { const b = this.bodies[i]; if (b.built?.vol && b.built.root.visible) volumeOccluders(b.built.vol, occ, n); }
    }
    this.markData = marks;
    this.updateMarks(marks);
  }

  /**
   * The sky's colours at the hour. Under a world's system an eclipse dims the daylight (by the share of
   * the sun's light that reaches the ground), and the night light (moons and a giant) brightens the night.
   */
  updateSky(day, sky = null) {
    const U = this.skyU, C = this.cols;
    const s = day.sun.y;
    let dl = smooth(s, -0.12, 0.25);
    let dusk = s > -0.2 ? Math.exp(-Math.abs(s) * 7) : 0;
    if (sky) {
      const lightShare = 0.06 + 0.94 * sky.out.daylight;
      dl *= lightShare;
      dusk *= lightShare;
    }
    lerpColour(C.nightZ, C.dayZ, dl, U.zenith.value);
    lerpColour(C.nightH, C.dayH, dl, U.horizon.value);
    if (sky && sky.out.night > 0) {
      // the night light: a moonlit blue, as far as a bright full giant
      const lift = Math.min(1, sky.out.night / 2.5) * (1 - dl);
      U.zenith.value.lerp(C.moonZ, lift * 0.75);
      U.horizon.value.lerp(C.moonH, lift * 0.75);
    }
    U.horizon.value.lerp(C.dusk, dusk * 0.55);
    lerpColour(C.nightG, C.dayG, dl, U.ground.value);
    U.sunDir.value.set(day.sun.x, day.sun.y, day.sun.z);
    U.glowAmt.value = dl * 0.55 + dusk * 0.35;
    // the stars come out as the day goes
    this.S.stars.visible = this.ctx.starsOn() && dl < 0.35;
    this.dl = dl;
    // (the GPU port's pass 2, wave 4) drawn as the game does: the world's own air at the hour (gameAir.ts: the game's
    // record, fit, twin, tables and dome, on this sphere), the ground's far edge the air's horizon, and the stars shown
    // only below the level light the game hides them above; a world whose air is not made yet keeps this plain view
    U.game.value = 0;
    const G = this.gameLook;
    this.airDrawn = false;
    let night = null;
    let ground = null;
    if (G?.on) {
      const a = G.useWorld(this.zone);
      // (the GPU port's pass 2, wave 5) under the system the game follows, the day's unbroken count the page hands over
      if (G.frameAir(a, this.ctx.hours(), this.ctx.count ? this.ctx.count() : NaN)) {
        this.airDrawn = true;
        if (this.skyDome.material !== a.dome) this.skyDome.material = a.dome;
        U.horizon.value.copy(G.fog);
        U.glowAmt.value = 0;
        // this stage's star field is no part of the game's sky: none while the game's air draws; (wave 5) the game's own night
        // is (its stars at their physical light, the Milky Way, the towns' glow: `src/sky/night/`), and the ground is hazed as
        // the game's haze pass hazes a solid (`gameAir.ts`' `groundMaterial`)
        this.S.stars.visible = false;
        night = G.nightFor(this.zone);
        ground = G.groundMaterial();
      }
    }
    if (!this.airDrawn && this.skyDome.material !== this.skyMat) this.skyDome.material = this.skyMat;
    const gm = ground || this.groundCapMat;
    if (this.groundCap.material !== gm) this.groundCap.material = gm;
    if (this.nightGroup !== night) {
      this.nightGroup?.removeFromParent();
      this.nightGroup = night;
      if (night) this.group.add(night);
    }
  }

  /** Wave 4: the ground's own storm, when the world we stand on has storm cells (its planet look's clouds). */
  updateGroundStorm(day, wall) {
    const U = this.skyU;
    const L = this.ctx.worldLook?.()?.layers?.clouds || null;
    const on = !!(L && L.on && L.storm?.on);
    const cells = this.groundCells;
    this.groundStorms.step(wall, on, stormDial(L, 'rate', 1), stormDial(L, 'bright', 1.6), 0.3, cells);
    // (the colour is read again only when it changes: parsing it makes strings)
    if (on && L.storm.colour !== this._flashCol) { this._flashCol = L.storm.colour; U.flashColour.value.setStyle(/^#[0-9a-f]{6}$/i.test(L.storm.colour || '') ? L.storm.colour : '#d8e0ff'); }
    // a flash is a glow on the sky: strong by night, all but lost in the day's light
    const nightK = 0.1 + 0.9 * (1 - (this.dl ?? 0));
    let amb = 0;
    for (let i = 0; i < STORM_SLOTS; i++) {
      const c = cells[i].value, u = U.flash[i].value;
      if (!(c.w > 0)) { if (u.w !== 0) u.w = 0; continue; }
      const f = groundFlash(c.x, c.y, c.z, this._gf);
      // the shader reads the bearing (x, z, a unit along the ground) and the height of the centre (y)
      const ch = Math.sqrt(f.x * f.x + f.z * f.z) || 1;
      const w = c.w * nightK * 0.35;
      u.set(f.x / ch, f.y, f.z / ch, w * f.k);
      amb += w * f.near * 0.18;
      const sz = f.size * (0.7 + 0.3 * this.groundStorms.sizeOf(i));
      U.flashInv[i].value = 1 / (sz * sz);
    }
    if (U.flashAmb.value !== amb) U.flashAmb.value = amb;
  }

  // ---- the marks: a ring round the selected body, a name by every other ----
  updateMarks(items) {
    const host = this.marksEl;
    const cam = this.S.camera;
    const W = host.clientWidth, H = host.clientHeight;
    const seen = new Set();
    const v = new THREE.Vector3();
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    // A body faces the camera, so off the view's middle perspective draws it as a stretched, shifted
    // ellipse: the ring is fitted to its rim's four points as they land on the screen.
    const rim = (pos, rad) => {
      const len = pos.length() || 1;
      const f = bodyFrame({ x: pos.x / len, y: pos.y / len, z: pos.z / len });
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        v.set(pos.x + (f.right.x * a + f.up.x * b) * rad, pos.y + (f.right.y * a + f.up.y * b) * rad, pos.z + (f.right.z * a + f.up.z * b) * rad);
        if (v.dot(fwd) <= 0) return null;
        v.project(cam);
        const x = ((v.x + 1) / 2) * W, y = ((1 - v.y) / 2) * H;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, rx: (x1 - x0) / 2, ry: (y1 - y0) / 2 };
    };
    for (const it of items) {
      let m = this.marks.get(it.id);
      if (!m) {
        const elm = document.createElement('button');
        elm.type = 'button';
        elm.className = 'mark';
        const ring = document.createElement('span');
        ring.className = 'ring';
        const tag = document.createElement('span');
        tag.className = 'tag';
        elm.append(ring, tag);
        if (it.id !== '__sun') elm.addEventListener('click', () => this.onPick?.(it.id));
        host.append(elm);
        m = { el: elm, ring, tag, text: '' };
        this.marks.set(it.id, m);
      }
      seen.add(it.id);
      const sel = it.id === this.selected;
      const text = it.label + (it.nolook ? ' (no look)' : '');
      if (m.text !== text) { m.tag.textContent = text; m.text = text; }
      m.el.classList.toggle('sel', sel);
      m.el.classList.toggle('sun', !!it.sun);
      if (it.hidden || !it.pos) { m.el.hidden = true; continue; }
      const below = !this.space && it.pos.y < -GROUND_R * 0.01;
      const e = below ? null : rim(it.pos, it.rad || 1);
      if (!e || e.x < -0.2 * W || e.x > 1.2 * W || e.y < -0.2 * H || e.y > 1.2 * H) { m.el.hidden = true; continue; }
      m.el.hidden = false;
      const pad = sel ? 6 : 2;
      const rx = Math.max(5, e.rx) + pad, ry = Math.max(5, e.ry) + pad;
      m.r = Math.max(rx, ry);
      m.x = e.x;
      m.y = e.y;
      m.el.style.transform = `translate(${e.x.toFixed(1)}px, ${e.y.toFixed(1)}px)`;
      m.ring.style.width = `${(2 * rx).toFixed(1)}px`;
      m.ring.style.height = `${(2 * ry).toFixed(1)}px`;
      m.ring.style.left = `${(-rx).toFixed(1)}px`;
      m.ring.style.top = `${(-ry).toFixed(1)}px`;
      m.tag.style.top = `${(ry + 3).toFixed(1)}px`;
    }
    for (const [id, m] of this.marks) if (!seen.has(id)) { m.el.remove(); this.marks.delete(id); }
  }

  /** A click on the sky (not a drag) picks the smallest body whose ring holds it. */
  pickAt(cx, cy) {
    const host = this.marksEl.getBoundingClientRect();
    const x = cx - host.left, y = cy - host.top;
    let best = null;
    for (const [id, m] of this.marks) {
      if (id === '__sun' || m.el.hidden || m.r === undefined) continue;
      const d = Math.hypot(x - m.x, y - m.y);
      if (d <= m.r + 6 && (!best || m.r < best.r)) best = { id, r: m.r };
    }
    if (best) this.onPick?.(best.id);
  }
}
