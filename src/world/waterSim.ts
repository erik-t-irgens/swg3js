// The interactive water surface: a height field stepped on the GPU inside a window that slides
// with the camera, forced by an overhead render of everything sitting in the water.
//
// The shape of a ripple comes from the shape of whatever made it. Each body puts a proxy mesh in
// a scene of its own, an orthographic camera looks straight down at the window, and the deepest
// fragment over each texel wins. What lands in the splat target is the body's real waterline
// section: a hull's keel line, a person's two legs. The step then treats that footprint as a
// boundary the surface is held down to rather than as a push, so the bow wave, the V of the wake
// and the water closing in astern all fall out of the wave equation instead of being authored.
//
// Cost is fixed: it does not care how many pixels of water are on screen, only how many bodies
// are in the window. The water shader reads one texel for both the ripple height and its slope,
// because the step writes the slope out of taps it already had.
import * as THREE from 'three';
import {
  courantOf, dampingFor, deepWaterWavelength, fastestRipple, maxWaveSpeed, realWavePeriod,
  realWaveSpeed, reliefFor, RIPPLE_HELP, rippleGroupSpeed, rippleHalfLife, ripplePeriod,
  ripplePhaseSpeed, ringPeriodSeconds, shallowWaterDepth, waveTerm,
} from './rippleMath.ts';

/**
 * Detail presets, keyed by grid size, which is what the setting stores. Grid and reach move
 * together so the knob is monotone in both cost and quality: a bigger window at the same grid
 * would be coarser, and a player should not have to reason about that trade.
 */
export const WATER_SIM_DETAIL: Readonly<Record<number, { grid: number; window: number }>> = {
  256: { grid: 256, window: 128 },   // 50 cm a texel
  512: { grid: 512, window: 192 },   // 37.5 cm
  768: { grid: 768, window: 224 },   // 29 cm
  1024: { grid: 1024, window: 256 }, // 25 cm
};

let SIM = 512;
let WINDOW = 192;
let TEXEL = WINDOW / SIM;
let HALF = WINDOW / 2;
/** The step runs at a fixed rate whatever the frame rate, or the wave speed rides on it. */
const FIXED_DT = 1 / 120;
const MAX_STEPS = 4;
/** Point impulses waiting for the next step. */
const MAX_POKES = 8;

/** The field the water shader samples: r ripple height, ba its slope per texel. */
export const WATER_SIM_TEX: { value: THREE.Texture | null } = { value: null };
/** Where the window is and how big: originX, originZ, metres across, metres a texel. */
export const WATER_SIM_WINDOW = { value: new THREE.Vector4(0, 0, WINDOW, TEXEL) };
/** How tall the interactive ripples stand, in metres of surface. */
export const WATER_SIM_RELIEF = { value: 0.5 };
/** 1 while the field is live. The water shader multiplies by it, because an unbound sampler reads
 *  as solid white and would otherwise tilt the whole surface when the sim is switched off. */
export const WATER_SIM_ON = { value: 0 };

/** The settings the sim reads. A subset of the game's, so a node test can hand it a plain object. */
export interface WaterSimSettings {
  /** Off frees the targets entirely and the water falls back to its swell and wind ripples. */
  waterRipples: boolean;
  /** Grid a side; a key of WATER_SIM_DETAIL. */
  waterRippleDetail: number;
  /** How tall ripples stand, 1 being the tuned height. */
  waterRippleHeight: number;
  /** How long they linger, 0 a dead pond to 1 a bathtub. */
  waterRipplePersistence: number;
}

const SIM_DEFAULTS: WaterSimSettings = {
  waterRipples: true,
  waterRippleDetail: 512,
  waterRippleHeight: 1,
  waterRipplePersistence: 0.85,
};

let settings: WaterSimSettings = { ...SIM_DEFAULTS };
let builtGrid = 0;

/** Hand the sim the live settings object; it reads it each step, so changes need no other call. */
export function configureWaterSim(s: WaterSimSettings): void {
  settings = s;
}

/**
 * The coupling between neighbouring texels, in **metres a second**, the same at every detail
 * setting.
 *
 * It used to be the step's own (c·dt/dx)² stored raw, and dx is a texel: the term therefore stood
 * for 1.90 m/s on the lowest detail, 1.42 on the default and 0.95 on the highest, so a quality
 * setting was changing how the water behaved. The default here is the number the default detail
 * always had (0.001 at 37.5 cm a texel and 1/120 s is 1.423 m/s), so nothing tuned by eye is thrown
 * away; `waveTerm` works the step's number out per preset and holds it under the stability limit,
 * saying so once if a number ever asks for more than the grid can carry.
 *
 * It is **not** the speed a ripple is seen to travel at, and it never was. The step multiplies the
 * whole update by the damping, which puts a spring under every texel as well as coupling it to its
 * neighbours, and at every wavelength a player can make out the spring is the stronger of the two:
 * a disturbance mostly rings where it stands, and what energy does carry goes at `carryMs` in the
 * report below — about 0.67 m/s at the tuned numbers, half this. `rippleMath.ts` has the arithmetic
 * and the node test steps the recurrence to check it.
 *
 * Console only, with draft and impact below: these are content tuning, not taste, and a player has
 * no way to judge them. `__debug.ripples()` prints what each one means and what the field really
 * does beside what real water of the same size would do.
 */
export const WATER_SIM_SPEED = { value: 1.423 };
/** How far a fully submerged body holds the surface down, in the field's own units: multiply by the
 *  ripple height in metres for the dip. */
export const WATER_SIM_DRAFT = { value: 0.55 };
/** How hard a fast arrival punches, in field units a step while it is still coming down. */
export const WATER_SIM_IMPACT = { value: 0.08 };

/** The speed the last warning was about, so a held speed says so once rather than every frame. */
let warnedSpeed = Number.NaN;
let warnedTexel = Number.NaN;

function warnIfHeld(speed: number, texel: number): void {
  // A speed that is not a number at all never reaches the field (`waveTerm` answers 0 for one), so
  // there is nothing to warn about — and warning would never stop, since NaN is equal to nothing,
  // including the NaN already warned about. `Object.is` is the same test that does hold for it.
  if (!Number.isFinite(speed)) return;
  const cap = maxWaveSpeed(texel, FIXED_DT);
  if (speed <= cap) return;
  if (Object.is(speed, warnedSpeed) && Object.is(texel, warnedTexel)) return;
  warnedSpeed = speed;
  warnedTexel = texel;
  console.warn(
    `water ripples: ${speed.toFixed(2)} m/s is more than a ${(texel * 100).toFixed(0)} cm grid can carry at ` +
    `${Math.round(1 / FIXED_DT)} steps a second, so it is held at ${cap.toFixed(2)} m/s. A coarser ripple ` +
    'detail setting carries a faster wave, not a finer one.',
  );
}

/** A body in the water. Move `object` each frame; the module reads its transform and nothing else. */
export interface SimBody {
  /** The proxy in the splat scene. Set its position, quaternion and scale to follow the real thing. */
  readonly object: THREE.Mesh;
  /** Metres the geometry must reach below the surface to displace fully. Roughly the body's draught. */
  draft: number;
  /** How hard it arrived, 0 to 1 on the caller's own scale, not a speed. Drives the impact impulse
   *  while it is still coming down: a crater rather than a ring. */
  velDown: number;
  /** Off for a body that has left the water, so it costs nothing. */
  active: boolean;
  dispose(): void;
}

const SPLAT_VERT = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SPLAT_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vWorld;
  uniform float uWaterY;
  uniform float uDraft;
  uniform float uVelDown;
  void main() {
    // How far this scrap of mesh sits under the surface, 0 at the waterline. MAX blending keeps
    // the deepest fragment over each texel, so the target holds the body's section, not its box.
    float sub = clamp((uWaterY - vWorld.y) / max(uDraft, 0.05), 0.0, 1.0);
    gl_FragColor = vec4(sub, uVelDown * step(0.001, sub), 0.0, 1.0);
  }
`;

const STEP_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uState;     // r h(t), g h(t-1), ba slope
  uniform sampler2D uSplat;     // r submersion, g downward speed
  uniform vec2  uTexel;
  uniform vec2  uScroll;        // whole texels the window moved, in uv
  uniform float uC2;
  uniform float uDamp;
  uniform float uDraft;
  uniform float uImpact;
  uniform vec4  uPokes[${MAX_POKES}];   // uv.xy, radius in texels, strength

  // The window slides with the camera, so a texel's previous value lives at an offset. The origin
  // is snapped to whole texels before this runs, so the offset is exact and nothing is resampled.
  vec4 readState(vec2 uv) {
    vec2 s = uv + uScroll;
    if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) return vec4(0.0);
    return texture2D(uState, s);
  }

  void main() {
    vec4 s = readState(vUv);
    float h = s.r;
    float hp = s.g;

    float hl = readState(vUv - vec2(uTexel.x, 0.0)).r;
    float hr = readState(vUv + vec2(uTexel.x, 0.0)).r;
    float hd = readState(vUv - vec2(0.0, uTexel.y)).r;
    float hu = readState(vUv + vec2(0.0, uTexel.y)).r;

    float lap = (hl + hr + hd + hu) - 4.0 * h;
    float hn = (2.0 * h - hp + uC2 * lap) * uDamp;

    vec4 sp = texture2D(uSplat, vUv);

    // A body in the water is a boundary, not a shove: inside its footprint the surface is held at
    // its draught, and the sim works out the bow wave and the wake. Astern the water springs back.
    float occ = clamp(sp.r, 0.0, 1.0);
    hn = mix(hn, -occ * uDraft, occ);

    // Something arriving fast punches a hole, which becomes a ring.
    hn -= sp.g * uImpact;

    for (int i = 0; i < ${MAX_POKES}; i++) {
      vec4 pk = uPokes[i];
      if (pk.w == 0.0) continue;
      float d = length((vUv - pk.xy) / uTexel);
      hn -= pk.w * exp(-(d * d) / max(pk.z * pk.z, 1.0));
    }

    // Soak up energy at the border, so the window's edge is not a wall waves bounce off and the
    // band where new water arrives has nothing in it to pop.
    vec2 e = min(vUv, 1.0 - vUv) / (14.0 * uTexel);
    float edge = clamp(min(e.x, e.y), 0.0, 1.0);
    hn *= mix(0.84, 1.0, edge);

    hn = clamp(hn, -6.0, 6.0);
    // The slope comes free: these four taps were needed for the laplacian anyway, so the water
    // shader gets height and slope from one fetch instead of finite-differencing for itself.
    gl_FragColor = vec4(hn, h, (hr - hl) * 0.5, (hu - hd) * 0.5);
  }
`;

interface Rig {
  stateA: THREE.WebGLRenderTarget;
  stateB: THREE.WebGLRenderTarget;
  splat: THREE.WebGLRenderTarget;
  read: THREE.WebGLRenderTarget;
  write: THREE.WebGLRenderTarget;
  splatScene: THREE.Scene;
  splatCam: THREE.OrthographicCamera;
  stepScene: THREE.Scene;
  stepCam: THREE.OrthographicCamera;
  stepMat: THREE.ShaderMaterial;
}

let rig: Rig | null = null;
let failed = false;
const bodies: SimBody[] = [];
const waterY = { value: 0 };
const pokes: THREE.Vector4[] = Array.from({ length: MAX_POKES }, () => new THREE.Vector4(0, 0, 1, 0));
let pokeNext = 0;
let accumulator = 0;
let originX = Number.NaN;
let originZ = Number.NaN;
const scroll = new THREE.Vector2();
const saveColor = new THREE.Color();
/** A still scroll, for every substep after the first. */
const ZERO = new THREE.Vector2();

/**
 * Two traps decide the formats, and both are silent when they bite. A float32 target is only
 * renderable with EXT_color_buffer_float, and blending into one needs EXT_float_blend on top —
 * rarer still, and the splat pass blends. So the field prefers float32 (a wave equation is
 * 2h − hPrev, which cancels badly at low precision) while the splat target is always half float,
 * whose blending and filtering are core in WebGL2.
 */
function pickTypes(renderer: THREE.WebGLRenderer): { state: THREE.TextureDataType; splat: THREE.TextureDataType } | null {
  const gl = renderer.getContext();
  const renderFloat = !!gl.getExtension('EXT_color_buffer_float');
  const renderHalf = !!gl.getExtension('EXT_color_buffer_half_float');
  const linearFloat = !!gl.getExtension('OES_texture_float_linear');
  if (!renderFloat && !renderHalf) return null;
  return {
    state: renderFloat && linearFloat ? THREE.FloatType : THREE.HalfFloatType,
    splat: THREE.HalfFloatType,
  };
}

function target(type: THREE.TextureDataType): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(SIM, SIM, {
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

function build(renderer: THREE.WebGLRenderer): Rig | null {
  const types = pickTypes(renderer);
  if (!types) {
    failed = true;
    return null;
  }
  const stateA = target(types.state);
  const stateB = target(types.state);
  const splat = target(types.splat);

  const splatCam = new THREE.OrthographicCamera(-HALF, HALF, HALF, -HALF, -400, 400);
  splatCam.userData.half = HALF;
  // Straight down, with screen up along −Z: screen x is world +X and screen y is world −Z, which
  // is the mapping the water shader undoes when it turns a world position into a window uv.
  splatCam.up.set(0, 0, -1);

  const stepMat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: STEP_FRAG,
    uniforms: {
      uState: { value: null },
      uSplat: { value: splat.texture },
      uTexel: { value: new THREE.Vector2(1 / SIM, 1 / SIM) },
      uScroll: { value: new THREE.Vector2() },
      // Stand-ins only: the step sets all four from the live knobs before it renders, on the very
      // call that built the rig. They are worked out the same way all the same, so nothing here
      // can drift from what the step does.
      uC2: { value: waveTerm(WATER_SIM_SPEED.value, TEXEL, FIXED_DT) },
      uDamp: { value: dampingFor(settings.waterRipplePersistence) },
      uDraft: { value: WATER_SIM_DRAFT.value },
      uImpact: { value: WATER_SIM_IMPACT.value },
      uPokes: { value: pokes },
    },
    depthTest: false,
    depthWrite: false,
  });

  const stepScene = new THREE.Scene();
  stepScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), stepMat));

  const built: Rig = {
    stateA, stateB, splat,
    read: stateA, write: stateB,
    splatScene: new THREE.Scene(),
    splatCam,
    stepScene,
    stepCam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
    stepMat,
  };
  for (const b of bodies) built.splatScene.add(b.object);

  const prev = renderer.getRenderTarget();
  for (const t of [stateA, stateB, splat]) {
    renderer.setRenderTarget(t);
    renderer.clear(true, false, false);
  }
  renderer.setRenderTarget(prev);

  WATER_SIM_TEX.value = stateA.texture;
  return built;
}

/** Put a body in the water. Its geometry is the footprint, so pass the real hull where there is one. */
export function addSimBody(geometry: THREE.BufferGeometry, draft = 1): SimBody {
  const mat = new THREE.ShaderMaterial({
    vertexShader: SPLAT_VERT,
    fragmentShader: SPLAT_FRAG,
    uniforms: {
      uWaterY: waterY,
      uDraft: { value: draft },
      uVelDown: { value: 0 },
    },
    // MAX keeps the deepest fragment per texel rather than adding them up, so a body's own
    // overlapping triangles do not stack into a hole far deeper than the body is.
    blending: THREE.CustomBlending,
    blendEquation: THREE.MaxEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const object = new THREE.Mesh(geometry, mat);
  object.frustumCulled = false;
  object.matrixAutoUpdate = true;

  const body: SimBody = {
    object,
    get draft() { return mat.uniforms.uDraft.value as number; },
    set draft(v: number) { mat.uniforms.uDraft.value = v; },
    get velDown() { return mat.uniforms.uVelDown.value as number; },
    set velDown(v: number) { mat.uniforms.uVelDown.value = v; },
    active: true,
    dispose() {
      const i = bodies.indexOf(body);
      if (i >= 0) bodies.splice(i, 1);
      rig?.splatScene.remove(object);
      mat.dispose();
    },
  };
  bodies.push(body);
  rig?.splatScene.add(object);
  return body;
}

/** A point impulse: rain, a bolt striking the surface, something thrown in. */
export function pokeWaterSim(x: number, z: number, strength: number, radiusM = 0.6): void {
  if (Number.isNaN(originX)) return;
  const u = (x - originX) / WINDOW;
  const v = 1 - (z - originZ) / WINDOW;
  if (u < 0 || u > 1 || v < 0 || v > 1) return;
  pokes[pokeNext].set(u, v, Math.max(1, radiusM / TEXEL), strength);
  pokeNext = (pokeNext + 1) % MAX_POKES;
}

/** True once the field exists, so callers can fall back where the hardware cannot run it. */
export function waterSimReady(): boolean {
  return !!rig && !failed;
}

/**
 * Step the field. Call once a frame, after the bodies have been moved and before the scene is
 * drawn. The window centres on the camera, snapped to whole texels so sliding it costs nothing.
 */
export function stepWaterSim(
  renderer: THREE.WebGLRenderer,
  cameraX: number,
  cameraZ: number,
  surfaceY: number,
  dt: number,
): void {
  if (failed) return;

  // Off: give the targets back and tell the water shader to ignore the field.
  if (!settings.waterRipples) {
    if (rig) disposeWaterSim();
    WATER_SIM_ON.value = 0;
    return;
  }

  // A detail change resizes the grid and the window together, which means new targets.
  const preset = WATER_SIM_DETAIL[settings.waterRippleDetail] ?? WATER_SIM_DETAIL[512];
  if (rig && builtGrid !== preset.grid) disposeWaterSim();
  if (!rig) {
    SIM = preset.grid;
    WINDOW = preset.window;
    TEXEL = WINDOW / SIM;
    HALF = WINDOW / 2;
    rig = build(renderer);
    if (!rig) return;
    builtGrid = preset.grid;
  }

  WATER_SIM_ON.value = 1;
  WATER_SIM_RELIEF.value = reliefFor(settings.waterRippleHeight);
  // The wave term is worked out from a speed in metres a second and this preset's texel, so the
  // detail setting changes how finely the surface is resolved and not how fast it moves.
  rig.stepMat.uniforms.uC2.value = waveTerm(WATER_SIM_SPEED.value, TEXEL, FIXED_DT);
  warnIfHeld(WATER_SIM_SPEED.value, TEXEL);
  // Persistence is eased into the damping factor, whose useful span is narrow and whose top end
  // must stay below 1 or the field never settles.
  rig.stepMat.uniforms.uDamp.value = dampingFor(settings.waterRipplePersistence);
  rig.stepMat.uniforms.uDraft.value = WATER_SIM_DRAFT.value;
  rig.stepMat.uniforms.uImpact.value = WATER_SIM_IMPACT.value;

  // Snap the origin to whole texels. A fractional slide would resample the whole field through a
  // bilinear filter every frame and smear the simulation into porridge within a second.
  const nx = Math.round((cameraX - HALF) / TEXEL) * TEXEL;
  const nz = Math.round((cameraZ - HALF) / TEXEL) * TEXEL;
  if (Number.isNaN(originX)) {
    originX = nx;
    originZ = nz;
  }
  // Reading the old state at the same world point means moving u with the origin, and v against
  // it, because the window's v runs the opposite way to world Z.
  scroll.set((nx - originX) / WINDOW, -(nz - originZ) / WINDOW);
  originX = nx;
  originZ = nz;

  waterY.value = surfaceY;
  WATER_SIM_WINDOW.value.set(originX, originZ, WINDOW, TEXEL);

  const cx = originX + HALF;
  const cz = originZ + HALF;
  rig.splatCam.left = -HALF; rig.splatCam.right = HALF;
  rig.splatCam.top = HALF; rig.splatCam.bottom = -HALF;
  rig.splatCam.position.set(cx, surfaceY + 200, cz);
  rig.splatCam.lookAt(cx, surfaceY, cz);
  rig.splatCam.updateProjectionMatrix();

  for (const b of bodies) b.object.visible = b.active;

  const prevTarget = renderer.getRenderTarget();
  const prevAutoClear = renderer.autoClear;
  const prevAlpha = renderer.getClearAlpha();
  renderer.getClearColor(saveColor);
  renderer.autoClear = false;
  renderer.setClearColor(0x000000, 1);

  // Everything in the water, straight down into the window.
  renderer.setRenderTarget(rig.splat);
  renderer.clear(true, false, false);
  renderer.render(rig.splatScene, rig.splatCam);

  // A fixed step, however long the frame was, so the wave speed does not ride on the frame rate
  // and a hitch cannot push the scheme past what it can hold.
  accumulator = Math.min(accumulator + dt, FIXED_DT * MAX_STEPS);
  let steps = 0;
  while (accumulator >= FIXED_DT && steps < MAX_STEPS) {
    accumulator -= FIXED_DT;
    steps++;
    // Only the first step of a frame carries the scroll and the pokes; the rest continue in place.
    (rig.stepMat.uniforms.uScroll.value as THREE.Vector2).copy(steps === 1 ? scroll : ZERO);
    rig.stepMat.uniforms.uState.value = rig.read.texture;
    renderer.setRenderTarget(rig.write);
    renderer.render(rig.stepScene, rig.stepCam);
    const swap = rig.read;
    rig.read = rig.write;
    rig.write = swap;
    if (steps === 1) for (const p of pokes) p.w = 0;
  }

  renderer.setRenderTarget(prevTarget);
  renderer.autoClear = prevAutoClear;
  renderer.setClearColor(saveColor, prevAlpha);

  WATER_SIM_TEX.value = rig.read.texture;
}


/**
 * What the field is doing and what every one of its numbers means, for the console:
 * `__debug.ripples()`. Every figure here is either read straight off the live settings or is plain
 * arithmetic from `rippleMath.ts`, which a node test sweeps; nothing is measured off the GPU.
 *
 * It answers in metres and seconds on purpose, and it answers about the field the game really
 * steps rather than about the wave equation the step is written from. `speedMs` is the coupling
 * knob; **`carryMs` is the number to trust** — the fastest a ripple's energy actually travels, at
 * the wavelength `carryWaveM`, with the damping's spring taken into account. `ringPeriodS` is how
 * long a big, slow disturbance takes to swing through once, which is what it does instead of
 * travelling. `compare` puts the field's own speed and swing beside a real deep-water wave of the
 * very same length, so "does it look realistic" is a comparison rather than a squint. `halfLifeS`
 * is persistence with a stopwatch on it, `reliefM` is ripple height in metres, `holdDownM` is how
 * far a fully submerged body pulls the surface under, and `help` says what each knob does in words.
 *
 * It answers with the sim off as well, from the settings as they stand, so a number can be tried
 * before the water is in front of you.
 */
export function waterSimDebug(): Record<string, unknown> {
  const preset = WATER_SIM_DETAIL[settings.waterRippleDetail] ?? WATER_SIM_DETAIL[512];
  const texel = rig ? TEXEL : preset.window / preset.grid;
  const asked = WATER_SIM_SPEED.value;
  const speed = Number.isFinite(asked) ? Math.max(0, asked) : 0;
  const damp = dampingFor(settings.waterRipplePersistence);
  const relief = reliefFor(settings.waterRippleHeight);
  const term = waveTerm(speed, texel, FIXED_DT);
  const carry = fastestRipple(damp, term, texel, FIXED_DT);
  const r = (v: number, n = 2): number => (Number.isFinite(v) ? +v.toFixed(n) : v);
  const detail: Record<string, unknown> = {};
  for (const key of Object.keys(WATER_SIM_DETAIL)) {
    const p = WATER_SIM_DETAIL[Number(key)];
    const t = p.window / p.grid;
    const c = fastestRipple(damp, waveTerm(speed, t, FIXED_DT), t, FIXED_DT);
    detail[key] = {
      texelCm: r(t * 100, 1), reachM: p.window,
      capMs: r(maxWaveSpeed(t, FIXED_DT)), carryMs: r(c.speedMs, 3),
    };
  }
  // The field's own behaviour at a few sizes, beside real deep water of the same size. `oursMs` is
  // the group speed — where the energy goes — and `phaseMs` is the crest sliding, which runs away
  // with the wavelength and is why the phase speed is no use as an answer.
  const compare = [0.75, 1.5, 3, 6, 12].map((waveM) => ({
    waveM,
    oursMs: r(rippleGroupSpeed(damp, term, waveM, texel, FIXED_DT), 3),
    realMs: r(realWaveSpeed(waveM), 3),
    phaseMs: r(ripplePhaseSpeed(damp, term, waveM, texel, FIXED_DT), 2),
    oursSwingS: r(ripplePeriod(damp, term, waveM, texel, FIXED_DT), 3),
    realSwingS: r(realWavePeriod(waveM), 3),
  }));
  return {
    on: !!rig,
    failed,
    grid: rig ? SIM : 0,
    windowM: rig ? WINDOW : preset.window,
    texelCm: r(texel * 100, 1),
    bodies: bodies.length,
    active: bodies.filter((b) => b.active).length,
    originX: r(originX, 1),
    originZ: r(originZ, 1),
    // What the coupling is set to, and what the grid will carry.
    speedMs: r(speed, 3),
    speedCapMs: r(maxWaveSpeed(texel, FIXED_DT)),
    waveTerm: +term.toFixed(5),
    courant: r(courantOf(speed, texel, FIXED_DT), 3),
    // What the field really does. The damping is a spring as well as friction, so a ripple carries
    // at carryMs rather than at speedMs, and a long one rings at ringPeriodS instead of going
    // anywhere. Both fall out of the step's own roots; the node test steps it to check them.
    carryMs: r(carry.speedMs, 3),
    carryWaveM: r(carry.waveM, 2),
    ringPeriodS: r(ringPeriodSeconds(damp, FIXED_DT), 3),
    carryLikeWaveM: r(deepWaterWavelength(carry.speedMs)),
    carryLikeDepthM: r(shallowWaterDepth(carry.speedMs), 2),
    compare,
    // How tall, how long-lived, how deep a body sits.
    heightSetting: settings.waterRippleHeight,
    reliefM: r(relief, 3),
    persistence: settings.waterRipplePersistence,
    damping: r(damp, 5),
    halfLifeS: r(rippleHalfLife(damp, FIXED_DT), 3),
    draft: WATER_SIM_DRAFT.value,
    holdDownM: r(relief * WATER_SIM_DRAFT.value, 3),
    impact: WATER_SIM_IMPACT.value,
    punchMPerStep: r(relief * WATER_SIM_IMPACT.value, 3),
    detail,
    help: RIPPLE_HELP,
  };
}

/** Free the targets; the bodies outlive it and re-attach if the sim is built again. */
export function disposeWaterSim(): void {
  if (!rig) return;
  rig.stateA.dispose();
  rig.stateB.dispose();
  rig.splat.dispose();
  rig.stepMat.dispose();
  rig = null;
  builtGrid = 0;
  WATER_SIM_TEX.value = null;
  WATER_SIM_ON.value = 0;
  originX = Number.NaN;
  accumulator = 0;
}
