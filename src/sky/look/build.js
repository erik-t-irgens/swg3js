// Turning a look into things on the stage: the meshes read from the owner's FBX files (normalised by
// their rim radius, domes turned to face the camera, the full sphere turned north up, shells riding
// their body at the survey's ratios), the textures read from the owner's PNGs, and one node material
// per layer with every colour control as a live uniform.

import * as THREE from 'three/webgpu';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import {
  uniform, texture, uv, attribute, vec2, vec3, vec4, float, mix, smoothstep, clamp, max, pow, dot, normalize, length,
  sqrt, abs, fract, normalViewGeometry, positionView, normalMap, hue, saturation, positionLocal, transformNormalToView,
  cameraPosition, cameraWorldMatrix, modelWorldMatrixInverse, sin,
} from 'three/tsl';
// (the atmosphere brief's wave A) the air round a body: its record, tables and march (airProfile.js), built as nodes
import * as TSL from 'three/tsl';
import { Fn, dFdx, dFdy, cross, sign, cos } from 'three/tsl';
import { airShader, cleanAir, recordOf, recordKey, makeTables, stepsOf, airUniformValues, airStartFor, airless } from './airProfile.js';
import { MESHES, HALOS, RINGS } from './looks.js';
import { GeneratedSet, sampleLatLong, hashBytes, glowKind, glowKinds, depthOn, blendedLavaColour, lightDialsOf, cycloneSites } from './generate.js';
import { weatherUniforms, syncWeather, stormDial, flashAt, flashLight, motionPhases, movedDir, movedUV, churnedDir, churnedUV, phaseOffsetDir, phaseOffsetUV, Storms } from './weather.js';

// Wave 4: the weather's clocks, set once a frame by the page (setWeatherTime): the motion's (it stands
// still when the stage's auto-spin is off, as the spin does) and the lightning's (always running), in
// seconds. A flash's listener (the thunder) hears each flash as it starts.
const weatherClock = { motion: 0, wall: 0 };
export function setWeatherTime(motion, wall) { weatherClock.motion = motion; weatherClock.wall = wall; }
let flashListener = null;
export function setFlashListener(fn) { flashListener = fn; }

// ---------------------------------------------------------------------------------------------
// The air (the atmosphere brief's wave A): each look's Air setting (Scattered, Painted or None, in its `air`), the
// viewer-wide choice that overrides it for a comparison (`all`: 'own', 'scattered' or 'painted') and the march's
// steps (the quality). A look with no `air` is Painted: every look saved before this wave draws what it drew.
const airChoice = { all: 'own', steps: 12 };
/** The viewer's choice: { all, quality } (a look built after it follows it; the page builds the ones on show again). */
export function setAirChoice({ all = airChoice.all, quality = null } = {}) {
  // ('none' for all is not offered on the page: the cost measure uses it)
  airChoice.all = all === 'scattered' || all === 'painted' || all === 'none' ? all : 'own';
  if (quality) airChoice.steps = stepsOf(quality);
  return { ...airChoice };
}
/** The air a look is drawn with when Scattered: its own, else its recipe's start (a generated look), else the Earth's. */
export function airOf(look) {
  if (look?.air) return look.air;
  const g = look?.generated;
  return g ? airStartFor(g.recipe, g.dials, { shaped: !!g.shape }) : { mode: 'scattered' };
}
/**
 * The form a look's air is drawn in now: its own setting (none: Painted), or the viewer's choice for all. Scattered is
 * drawn round a sphere with a surface; a dome (its light painted in), a sheet, a shaped body or gas alone keep their
 * painted air in this wave.
 */
export function airModeOf(look) {
  if (!look) return 'painted';
  const want = airChoice.all === 'own' ? (look.air?.mode === 'scattered' || look.air?.mode === 'none' ? look.air.mode : 'painted') : airChoice.all;
  if (want === 'none') return look.kind === 'sheet' ? 'painted' : 'none';
  if (want !== 'scattered') return 'painted';
  // (the critic) a body that cannot take the march keeps its painted air, unless its air is none at all (an airless
  // shaped moon): then a painted rim round it would be an outline round nothing, so it is drawn with none
  if (look.kind !== 'sphere' || look.generated?.shape || !look.layers?.surface?.on) return look.kind !== 'sheet' && airless(recordOf(cleanAir(airOf(look)))) ? 'none' : 'painted';
  return 'scattered';
}
// Each record's three tables, made once (some tens of milliseconds) and shared by every look of the same air.
const airTableCache = new Map();
function tablesFor(rec) {
  const key = recordKey(rec);
  let t = airTableCache.get(key);
  if (!t) {
    t = makeTables(rec);
    airTableCache.set(key, t);
    if (airTableCache.size > 32) airTableCache.delete(airTableCache.keys().next().value);
  }
  return t;
}
/** A look's air as tables (the place view's day wash reads the ground world's): its record's, made or shared. */
export function airTablesOf(air) { return tablesFor(recordOf(cleanAir(air))); }
const toHalf = (src, dst) => { for (let i = 0; i < src.length; i++) dst[i] = THREE.DataUtils.toHalfFloat(src[i]); return dst; };
function airTexture(data, w, h) {
  const t = new THREE.DataTexture(toHalf(data, new Uint16Array(data.length)), w, h, THREE.RGBAFormat, THREE.HalfFloatType);
  t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}
/** A built look's air: its uniforms (the record's numbers and the light's dials), its tables as textures, its march. */
function makeAir(look) {
  const a = cleanAir(airOf(look));
  const rec = recordOf(a);
  const tabs = tablesFor(rec);
  const tex = { T: airTexture(tabs.T, tabs.size.tw, tabs.size.th), MS: airTexture(tabs.MS, tabs.size.mw, tabs.size.mh), E: airTexture(tabs.E, tabs.size.ew, 1) };
  const v = airUniformValues(rec, a);
  const U = {
    bottom: uniform(v.bottom), top: uniform(v.top), ray: uniform(new THREE.Vector3(...v.ray)), rayH: uniform(v.rayH),
    mieS: uniform(v.mieS), mieA: uniform(v.mieA), mieH: uniform(v.mieH), mieG: uniform(v.mieG),
    // (wave B) the haze's colour: its scattering by channel as a share of mieS (airProfile.js's F.mieTintR..B)
    mieTint: uniform(new THREE.Vector3(...v.mieTint)),
    oz: uniform(new THREE.Vector3(...v.oz)), ozC: uniform(v.ozC), ozW: uniform(v.ozW), limb: uniform(v.limb), twilight: uniform(v.twilight),
    // where the body is (view space), how many km a scene unit is, the cloud deck's height (a share of the radius,
    // and its radius in km) and its turn against the ground, the clouds' relief in scene units
    centre: uniform(new THREE.Vector3(0, 0, -4)), kmPer: uniform(v.bottom), cloudH: uniform(0.002), cloudR: uniform(v.bottom * 1.002), cloudRot: uniform(new THREE.Vector2(1, 0)), bumpH: uniform(0.012),
    limbDark: uniform(a.limbDark), glint: uniform(a.glint), glintRough: uniform(a.glintRough), cloudRelief: uniform(a.cloudRelief), cloudForward: uniform(a.cloudForward), cloudShadow: uniform(a.cloudShadow),
    nightFill: uniform(a.nightFill),
  };
  const steps = airChoice.steps;
  return { a, key: tabs.key, tex, U, steps, shader: airShader(TSL, U, tex, steps), shell: null, cloudShadowNode: null, pending: 0 };
}
/** A built look's air brought to its look's dials: the uniforms at once, the tables (when the record moved) a moment after the dial stops. */
function syncAir(state) {
  const AIR = state.air;
  if (!AIR) return;
  const a = cleanAir(airOf(state.look));
  AIR.a = a;
  const rec = recordOf(a);
  const v = airUniformValues(rec, a);
  const U = AIR.U;
  U.bottom.value = v.bottom; U.top.value = v.top; U.ray.value.set(...v.ray); U.rayH.value = v.rayH;
  U.mieS.value = v.mieS; U.mieA.value = v.mieA; U.mieH.value = v.mieH; U.mieG.value = v.mieG;
  U.mieTint.value.set(...v.mieTint);
  U.oz.value.set(...v.oz); U.ozC.value = v.ozC; U.ozW.value = v.ozW; U.limb.value = v.limb; U.twilight.value = v.twilight;
  U.limbDark.value = a.limbDark; U.glint.value = a.glint; U.glintRough.value = a.glintRough;
  U.cloudRelief.value = a.cloudRelief; U.cloudForward.value = a.cloudForward; U.cloudShadow.value = a.cloudShadow;
  U.nightFill.value = a.nightFill;
  const ch =+state.look.layers.clouds?.height || 1.002;
  U.cloudH.value = Math.max(0.0001, ch - 1);
  U.cloudR.value = v.bottom * ch;
  if (AIR.shell) AIR.shell.scale.setScalar(v.top / v.bottom);
  const key = recordKey(rec);
  if (key !== AIR.key) {
    AIR.key = key;
    clearTimeout(AIR.pending);
    AIR.pending = setTimeout(() => {
      if (AIR.key !== key || AIR.disposed) return;
      const tabs = tablesFor(rec);
      toHalf(tabs.T, AIR.tex.T.image.data); AIR.tex.T.needsUpdate = true;
      toHalf(tabs.MS, AIR.tex.MS.image.data); AIR.tex.MS.needsUpdate = true;
      toHalf(tabs.E, AIR.tex.E.image.data); AIR.tex.E.needsUpdate = true;
      AIR.tablesMs = tabs.ms;
    }, 80);
  }
}
/** What a built look's air holds (for checks and the Look tab's words), or null. */
export function airInfo(state) {
  const AIR = state?.air;
  return { mode: state?.airMode || null, steps: AIR?.steps || null, key: AIR?.key || null, tablesMs: AIR?.tablesMs ?? null, tables: airTableCache.size };
}
import {
  ShapeSet, shapeKeyOf, shapeGeometry, shapeSurface, Field, fieldLayout, FIELD_TUNE, ringProfile, ringMesh, ringShadow, ringScatter,
} from './shapes.js';
import { shapeDialsOf, BELT_DIALS, RING_DIALS } from './partdials.js';
import { VolumeSet, buildVolume, syncVolume, updateVolume, disposeVolume } from './volume.js';

// Wave 5: a look's space volume's baked noise (volume.js), one set a look as the textures are, baked
// again in place when its seed or billows' size changes.
const volumeSets = new WeakMap();
async function acquireVolume(look) {
  let set = volumeSets.get(look);
  if (!set || set.disposed) { set = new VolumeSet(); volumeSets.set(look, set); }
  set.refs++;
  await set.bake(bakeRenderer, look.generated);
  return set;
}
function releaseVolume(set) {
  if (!set) return;
  set.refs--;
  if (set.refs <= 0) setTimeout(() => { if (set.refs <= 0 && !set.disposed) set.dispose(); }, 4000);
}
/** What a look's volume bake took and holds (for checks and the Look tab's words), or null. */
export function volumeInfo(look) {
  const set = volumeSets.get(look);
  return set && !set.disposed ? { lastMs: set.lastMs, bakes: set.bakes, key: set.key } : null;
}
/** A short name for every texel of a look's baked noise volume (the same seed must give the same one). */
export async function volumeHash(look) {
  const set = volumeSets.get(look);
  if (!set || set.disposed) return null;
  const px = await set.pixels(bakeRenderer);
  return px ? hashBytes(px) : null;
}

// ---------------------------------------------------------------------------------------------
// Generated looks: their textures are baked by generate.js with the stage's renderer, one set a look,
// shared by every place that shows that look, baked again in place when its seed or dials change.

let bakeRenderer = null;
export function setBakeRenderer(r) { bakeRenderer = r; }
const genSets = new WeakMap();

async function acquireGenerated(look, onStatus) {
  const gen = look.generated;
  const withClouds = !!look.layers.clouds.on;
  let set = genSets.get(look);
  if (!set || set.disposed || set.width !== gen.size) {
    set = new GeneratedSet(gen.size);
    genSets.set(look, set);
  }
  set.refs++;
  if (set.key !== GeneratedSet.keyOf(gen, withClouds)) {
    onStatus?.(`Baking ${look.name} (${set.width} x ${set.height})`);
    await set.bake(bakeRenderer, gen, { withClouds });
  }
  return set;
}

function releaseGenerated(set) {
  if (!set) return;
  set.refs--;
  if (set.refs <= 0) setTimeout(() => { if (set.refs <= 0 && !set.disposed) set.dispose(); }, 4000);
}

/** Bake a generated look again in place (its seed or a dial changed): every place showing it follows. */
export async function rebakeGenerated(look) {
  // (wave 5) a look's volume is baked again first; a look with only a volume answers with its time
  const vs = look.generated?.volume ? volumeSets.get(look) : null;
  const vms = vs && !vs.disposed ? await vs.bake(bakeRenderer, look.generated) : null;
  const set = genSets.get(look);
  if (!set || set.disposed || !look.generated || set.width !== look.generated.size) return vms;
  if (set.key === GeneratedSet.keyOf(look.generated, !!set.clouds)) return set.lastMs;
  return set.bake(bakeRenderer, look.generated, { withClouds: !!set.clouds });
}

// A shaped look's maps (shapes.js), one set a look as the textures are, baked again when its shape changes.
const shapeSets = new WeakMap();
async function acquireShape(look, onStatus) {
  let set = shapeSets.get(look);
  if (!set || set.disposed) { set = new ShapeSet(); shapeSets.set(look, set); }
  set.refs++;
  if (set.key !== shapeKeyOf(look.generated)) {
    onStatus?.(`Shaping ${look.name}`);
    await set.bake(bakeRenderer, look.generated);
  }
  return set;
}
function releaseShape(set) {
  if (!set) return;
  set.refs--;
  if (set.refs <= 0) setTimeout(() => { if (set.refs <= 0 && !set.disposed) set.dispose(); }, 4000);
}
/** What a look's parts took and hold, for the words on the Look tab and for checks. */
export function partsInfo(state) {
  const P = state?.parts;
  if (!P) return null;
  return {
    shapeMs: P.shape ? P.shape.lastMs : null,
    fields: P.fields.map((f) => ({ rocks: f.L.n, puffs: f.L.M, near: f.nearShown, extent: f.L.extent })),
    rings: !!P.ring,
    buildMs: P.buildMs,
  };
}

/**
 * What a generated look's materials are built for (its decks, its kinds of glow): a bake that changes
 * it (a dial taking the decks from none to some, a blend bringing lava to a living world) needs the
 * look built again, which needsRebuild tells.
 */
// (and what its parts are made of: a change to a part's shape, rocks or rings needs it built again too,
// which an undo learns here; a look without parts adds nothing to its key)
const partsKey = (g) => {
  const made = (list, part, kind) => (part ? [kind, ...list.filter((d) => !d.live).map((d) => part.dials[d.k])] : 0);
  return g.shape || g.belt || g.rings ? JSON.stringify([made(shapeDialsOf(g.shape?.kind), g.shape, g.shape?.kind), made(BELT_DIALS, g.belt, g.belt?.kind), made(RING_DIALS, g.rings, g.rings?.style)]) : '';
};
export const materialKeyOf = (look) => (look?.generated ? `${depthOn(look.generated) ? 'd' : ''}|${glowKinds(look.generated).join(',')}${partsKey(look.generated)}${look.generated.volume ? '|volume' : ''}` : '');
const builtKeys = new WeakMap();
export const needsRebuild = (look) => builtKeys.has(look) && builtKeys.get(look) !== materialKeyOf(look);

/** What the last bake of a generated look took, for the words on the Look tab. */
export function generatedInfo(look) {
  const set = genSets.get(look);
  if (!set || set.disposed) return null;
  return { width: set.width, height: set.height, lastMs: set.lastMs, firstMs: set.firstMs, bakes: set.bakes, lastFirst: !!set.lastFirst, clouds: !!set.clouds };
}

/** A short name for every texel of a generated look's texture (the same seed must give the same one). */
export async function generatedHash(look, which = 'surface') {
  const set = genSets.get(look);
  if (!set || set.disposed) return null;
  const px = await set.pixels(bakeRenderer, which);
  return px ? hashBytes(px) : null;
}

/** Every texel of a generated look's texture, with its size (for checks: a look at the bare map). */
export async function generatedPixels(look, which = 'surface') {
  const set = genSets.get(look);
  if (!set || set.disposed) return null;
  const px = await set.pixels(bakeRenderer, which);
  return px ? { width: set.width, height: set.height, px } : null;
}

// ---------------------------------------------------------------------------------------------
// The survey's notes on each texture (kind, projection, size), from textures.json.

let TEXINFO = {};
export function setTextureInfo(json) {
  TEXINFO = {};
  for (const t of json?.textures || []) TEXINFO[t.file] = t;
}
// Pictures the owner added from the page, with the kind he gave each (the file of choices' `pictures`):
// they are drawn as a surveyed picture of that kind would be. His kind wins over the survey's.
let ADDED = {};
export function setAddedPictures(pictures) {
  ADDED = {};
  for (const [name, p] of Object.entries(pictures || {})) {
    ADDED[name] = { file: name, kind: p.kind, added: p.added || '', projection: 'added by you', addedByOwner: true };
  }
}
export const texInfo = (name) => ADDED[name] || TEXINFO[name];
const DATA_KINDS = new Set(['normal', 'flow', 'mask']);
export const isDataTexture = (name) => DATA_KINDS.has(texInfo(name)?.kind);

function wrapFor(name) {
  const kind = texInfo(name)?.kind;
  const R = THREE.RepeatWrapping, C = THREE.ClampToEdgeWrapping;
  if (kind === 'sprite-baked' || kind === 'atmosphere' || kind === 'moons-sheet') return [C, C];
  if (kind === 'rings') return [C, R];
  if (kind === 'colour-unlit' || kind === 'clouds') return [R, C]; // lat-long: round in u, poles clamped in v
  return [R, R];
}

// ---------------------------------------------------------------------------------------------
// Thumbnails: the picture's colour regardless of its alpha (a 2D canvas would lose the colour
// wherever alpha is 0, as on Vardos alive), drawn through a tiny WebGL2 pass.

let thumbGL = null;
function thumbRenderer() {
  if (thumbGL !== null) return thumbGL;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('no webgl2');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, '#version 300 es\nout vec2 v;void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));v=p;gl_Position=vec4(p*2.-1.,0.,1.);}'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, '#version 300 es\nprecision mediump float;in vec2 v;uniform sampler2D t;out vec4 o;void main(){o=vec4(texture(t,v).rgb,1.);}'));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('thumb shader');
    thumbGL = { canvas, gl, prog };
  } catch {
    thumbGL = false;
  }
  return thumbGL;
}

function makeThumb(bitmap, flipped) {
  const w = bitmap.width, h = bitmap.height;
  const s = 220 / Math.max(w, h);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(w * s));
  out.height = Math.max(1, Math.round(h * s));
  const g = out.getContext('2d', { willReadFrequently: true });
  const T = thumbRenderer();
  if (T) {
    const { canvas, gl, prog } = T;
    canvas.width = out.width; canvas.height = out.height;
    gl.viewport(0, 0, out.width, out.height);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.useProgram(prog);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.deleteTexture(tex);
    // The bitmap was decoded upside down for the GPU (row 0 = the picture's bottom), which is what
    // the GL canvas shows the right way up; draw it straight across.
    g.drawImage(canvas, 0, 0);
  } else {
    g.save();
    if (flipped) { g.translate(0, out.height); g.scale(1, -1); }
    g.drawImage(bitmap, 0, 0, out.width, out.height);
    g.restore();
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Textures, cached by file name. Big maps (the two 4096 Ryloth cloud maps) shrink to 2048 on load.

const textures = new Map();
const BIG = 8_000_000;

// (the GPU port's pass 2, wave 4: the seam of design 2.10) The one hook every picture and mesh a look names is read
// through: its address, or null where it is not here. The viewer's is its server's imported folder (`/assets/`, as ever);
// the game's names only the photos the owner shipped (`public/sky/pictures/`) and nothing else, so a look of his imported
// pictures is not drawn there and its generated twin stands in, else SWG's picture. A picture or mesh not here fails as a
// missing file does (`: 404`), which is what every fallback here already reads.
const SOURCE = { of: (name) => '/assets/' + encodeURIComponent(name) };
/** The hook set (null: the viewer's own, the imported folder). */
export function setPictureSource(of) {
  SOURCE.of = typeof of === 'function' ? of : (name) => '/assets/' + encodeURIComponent(name);
}
/** Where a picture or mesh file is read from, or null where it is not here. */
export const pictureUrl = (name) => SOURCE.of(name);

export function loadTexture(name, onStatus) {
  if (!name) return Promise.resolve(null);
  let entry = textures.get(name);
  if (entry) { entry.used = performance.now(); return entry.promise; }
  entry = { used: performance.now(), value: null };
  entry.promise = (async () => {
    onStatus?.(`Loading ${name}`);
    const url = SOURCE.of(name);
    if (!url) throw new Error(`${name}: 404`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${name}: ${res.status} ${res.statusText}`);
    const blob = await res.blob();
    const info = texInfo(name)?.measured;
    const opts = { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' };
    let bitmap;
    let shrunk = false;
    const big = info && info.width * info.height > BIG;
    if (big) {
      const s = 2048 / Math.max(info.width, info.height);
      bitmap = await createImageBitmap(blob, { ...opts, resizeWidth: Math.round(info.width * s), resizeHeight: Math.round(info.height * s), resizeQuality: 'high' });
      shrunk = true;
    } else {
      bitmap = await createImageBitmap(blob, opts);
      if (bitmap.width * bitmap.height > BIG) {
        const s = 2048 / Math.max(bitmap.width, bitmap.height);
        const w = Math.round(bitmap.width * s), h = Math.round(bitmap.height * s);
        bitmap.close();
        bitmap = await createImageBitmap(blob, { ...opts, resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
        shrunk = true;
      }
    }
    const tex = new THREE.Texture(bitmap);
    tex.name = name;
    tex.flipY = false; // decoded upside down already, the same on both back ends
    const data = isDataTexture(name);
    tex.colorSpace = data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    const [ws, wt] = wrapFor(name);
    tex.wrapS = ws; tex.wrapT = wt;
    tex.anisotropy = 8;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    // An alpha the survey measured as empty (Vardos alive: 0..4) is ignored wherever a layer reads
    // "its alpha", so the picture never vanishes on a layer left at the default.
    const measuredAlpha = texInfo(name)?.measured?.alpha;
    const emptyAlpha = !!measuredAlpha && measuredAlpha.max <= 8;
    const value = { name, tex, isData: data, emptyAlpha, width: bitmap.width, height: bitmap.height, shrunk, thumb: makeThumb(bitmap, true), bitmap };
    entry.value = value;
    if (shrunk) console.info(`[viewer] ${name} shrunk to ${bitmap.width}x${bitmap.height} on load`);
    return value;
  })();
  entry.promise.catch(() => textures.delete(name));
  textures.set(name, entry);
  return entry.promise;
}

export function textureIfLoaded(name) {
  return textures.get(name)?.value || null;
}

// Forget one picture (its kind changed, so its wrapping and colour space may too): the next look built
// loads it again. The old copy is let go a moment later, once the rebuild that follows has replaced it.
export function forgetTexture(name) {
  const e = textures.get(name);
  if (!e) return;
  textures.delete(name);
  setTimeout(() => { e.value?.tex.dispose(); e.value?.bitmap?.close?.(); }, 3000);
}

// Keep GPU memory in bounds: forget the least recently used textures not in `keep`.
export function releaseTextures(keep, limit = 22) {
  if (textures.size <= limit) return;
  const list = [...textures.entries()].filter(([n, e]) => !keep.has(n) && e.value).sort((a, b) => a[1].used - b[1].used);
  while (textures.size > limit && list.length) {
    const [n, e] = list.shift();
    e.value.tex.dispose();
    e.value.bitmap?.close?.();
    textures.delete(n);
  }
}

// ---------------------------------------------------------------------------------------------
// Meshes. Each FBX is parsed once; sections are found by their names (the original material names).

const fbx = new Map();
function loadFBX(id, onStatus) {
  let p = fbx.get(id);
  if (p) return p;
  p = (async () => {
    onStatus?.(`Loading ${id}.fbx`);
    const url = SOURCE.of(id + '.fbx');
    if (!url) throw new Error(`${id}.fbx: 404`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${id}.fbx: ${res.status}`);
    const obj = new FBXLoader().parse(await res.arrayBuffer(), '');
    obj.updateMatrixWorld(true);
    const sections = [];
    obj.traverse((o) => {
      if (!o.isMesh) return;
      // Skinned sections are treated as static: the bones are at identity and each section sits on one.
      const g = new THREE.BufferGeometry();
      const src = o.geometry;
      for (const a of ['position', 'normal', 'uv', 'color', 'skinIndex']) if (src.attributes[a]) g.setAttribute(a, src.attributes[a].clone());
      if (src.index) g.setIndex(src.index.clone());
      g.applyMatrix4(o.matrixWorld);
      g.name = src.name || o.name;
      sections.push(g);
    });
    return sections;
  })();
  p.catch(() => fbx.delete(id));
  fbx.set(id, p);
  return p;
}

function section(sections, name) {
  return sections.find((g) => g.name === name) || sections.find((g) => g.name.replace(/ /g, '_') === name.replace(/ /g, '_')) || null;
}

// The frame of a body: the matrix that puts its rim centre at the origin, its rim radius at 1, a dome's
// facing axis on +Z with the picture upright, and the sphere's north (which sits at -Y) up.
const frames = new Map();
async function frameOf(meshId, onStatus) {
  if (frames.has(meshId)) return frames.get(meshId);
  const spec = MESHES[meshId];
  const sections = await loadFBX(meshId, onStatus);
  const surf = section(sections, spec.surface) || sections[0];
  surf.computeBoundingBox();
  const b = surf.boundingBox;
  const m = new THREE.Matrix4();
  let rim, depth = 1;
  if (spec.kind === 'sphere') {
    // Its true radius: the farthest vertex from the centre (the poles, at 6.5). The faceted
    // sphere's box is narrower than that across x and z, so its half-size would enlarge it.
    const c = b.getCenter(new THREE.Vector3());
    const pos = surf.attributes.position;
    let r2 = 0;
    for (let i = 0; i < pos.count; i++) {
      const dx = pos.getX(i) - c.x, dy = pos.getY(i) - c.y, dz = pos.getZ(i) - c.z;
      r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
    }
    rim = Math.sqrt(r2);
    m.makeTranslation(-c.x, -c.y, -c.z)
      .premultiply(new THREE.Matrix4().makeScale(1 / rim, 1 / rim, 1 / rim))
      .premultiply(new THREE.Matrix4().makeRotationZ(Math.PI));
  } else if (spec.facing === 'y') {
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    rim = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2;
    depth = (b.max.y - b.min.y) / rim;
    m.makeTranslation(-cx, -b.min.y, -cz)
      .premultiply(new THREE.Matrix4().makeScale(1 / rim, 1 / rim, 1 / rim))
      .premultiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)); // +Y to the viewer, -Z up
  } else {
    const cy = (b.min.y + b.max.y) / 2, cz = (b.min.z + b.max.z) / 2;
    rim = Math.max(b.max.y - b.min.y, b.max.z - b.min.z) / 2;
    depth = (b.max.x - b.min.x) / rim;
    m.makeTranslation(-b.min.x, -cy, -cz)
      .premultiply(new THREE.Matrix4().makeScale(1 / rim, 1 / rim, 1 / rim))
      .premultiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2)); // +X to the viewer, -Z to the right
  }
  const f = { matrix: m, rim, depth, sections };
  frames.set(meshId, f);
  return f;
}

const geoms = new Map();
async function bodyGeometry(meshId, which, onStatus) {
  const key = meshId + '|' + which;
  if (geoms.has(key)) return geoms.get(key);
  const spec = MESHES[meshId];
  let f;
  try {
    f = await frameOf(meshId, onStatus);
  } catch (e) {
    // (looks run 2, the review) a sphere whose mesh is not in the imported folder (a player without his
    // imports): our own sphere in the same frame (radius 1, north up), so a generated look, which is read
    // by direction alone, and the grey stand-in still draw. Only when the file is not there (a 404).
    if (spec?.kind !== 'sphere' || which !== 'surface' || !/: 404$/.test(e.message)) throw e;
    const g = new THREE.SphereGeometry(1, 192, 96);
    g.computeBoundingSphere();
    g.userData.depth = 1;
    g.userData.made = true;
    geoms.set(key, g);
    return g;
  }
  const name = which === 'shell' ? spec.shell : spec.surface;
  const raw = section(f.sections, name);
  if (!raw) { geoms.set(key, null); return null; }
  const g = raw.clone().applyMatrix4(f.matrix);
  g.deleteAttribute('skinIndex');
  g.computeBoundingSphere();
  g.userData.depth = f.depth;
  if (spec.kind !== 'sphere' && which === 'surface') g.userData.profile = domeProfile(g);
  geoms.set(key, g);
  return g;
}

// A dome's outline as the camera sees it. In its frame the dome faces +Z (toward the camera) with
// its rim radius 1 at z = 0, and it bulges toward the camera, so from close by its outline is wider
// than its rim. Each vertex is kept as (rho, z): its distance from the axis and its height toward
// the camera. Seen along the axis from `D` away at scale s, a vertex's angle off the axis is
// atan(s rho / (D - s z)); the widest is the outline. Only the upper hull of the (rho, z) points can
// be the widest for any view, so only it is kept (a few dozen points, read every frame).
function domeProfile(g) {
  const p = g.attributes.position;
  const pts = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    pts.push([Math.sqrt(x * x + y * y), p.getZ(i)]);
  }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const hull = [];
  for (const q of pts) {
    while (hull.length >= 2) {
      const o = hull[hull.length - 2], a = hull[hull.length - 1];
      if ((a[0] - o[0]) * (q[1] - o[1]) - (a[1] - o[1]) * (q[0] - o[0]) >= 0) hull.pop();
      else break;
    }
    hull.push(q);
  }
  return hull;
}

/**
 * Where a dome's outline is, seen along its axis, for an outline of half-angle `half` (radians):
 * the point of its profile that is widest, and the scale that makes the dome's base, `dist` away,
 * fill exactly that angle: s = dist tan(half) / max(rho + tan(half) z).
 */
export function domeOutline(profile, half, dist) {
  const T = Math.tan(half);
  let best = null, m = -Infinity;
  for (const q of profile) {
    const v = q[0] + T * q[1];
    if (v > m) { m = v; best = q; }
  }
  const scale = (dist * T) / m;
  return { scale, rho: best[0], z: best[1] };
}

// A lat-long UV for any dome: the un-squashed direction of each vertex, so a whole-sphere map
// (clouds, or a lat-long surface) can sit on a dome made for a circle picture. Front half: u 0.25..0.75.
const latlongCache = new WeakMap();
function withLatLongUV(g, depth) {
  if (latlongCache.has(g)) return latlongCache.get(g);
  const out = g.clone();
  const p = out.attributes.position;
  const uvs = new Float32Array(p.count * 2);
  const d = Math.max(depth, 0.05);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.set(p.getX(i), p.getY(i), p.getZ(i) / d).normalize();
    uvs[i * 2] = 0.5 + Math.atan2(v.x, v.z) / (Math.PI * 2);
    uvs[i * 2 + 1] = 0.5 + Math.asin(Math.max(-1, Math.min(1, v.y))) / Math.PI;
  }
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.computeBoundingSphere();
  latlongCache.set(g, out);
  return out;
}

// a sphere at clouds_01's own x1.002, fine enough that it never sags to the body (made once, shared)
let fineShell = null;
function fineCloudShell() {
  if (!fineShell) { fineShell = new THREE.SphereGeometry(1.002, 256, 128); fineShell.computeBoundingSphere(); }
  return fineShell;
}

async function cloudsSphereGeometry(onStatus) {
  const key = 'clouds_01_mesh';
  if (geoms.has(key)) return geoms.get(key);
  const f = await frameOf('planet_01_mesh', onStatus);
  const sections = await loadFBX('clouds_01_mesh', onStatus);
  const g = sections[0].clone().applyMatrix4(f.matrix); // rides the planet at the survey's x1.002
  g.computeBoundingSphere();
  geoms.set(key, g);
  return g;
}

async function haloGeometry(id, onStatus) {
  const key = 'halo|' + id;
  if (geoms.has(key)) return geoms.get(key);
  const spec = HALOS[id];
  if (!spec) return null;
  const f = await frameOf(spec.frameOf, onStatus);
  let raw;
  if (spec.section) raw = section(f.sections, spec.section);
  else raw = (await loadFBX(id, onStatus))[0];
  const g = raw.clone().applyMatrix4(f.matrix);
  g.computeBoundingSphere();
  geoms.set(key, g);
  return g;
}

// Rings: the menu ring in its dome's frame; the asteroid belts centred on their own fitted circle,
// their two arcs split by bone, the second turned half a turn so the pair closes the ring.
async function ringGeometry(id, onStatus) {
  const key = 'ring|' + id;
  if (geoms.has(key)) return geoms.get(key);
  const spec = RINGS[id];
  if (!spec) return null;
  let result;
  if (!spec.belt) {
    const f = await frameOf(spec.frameOf, onStatus);
    const raw = (await loadFBX(id, onStatus))[0];
    // The menu ring lies flat in its dome's XZ plane, and stays flat (+Y up) in the dome's frame.
    const g = raw.clone().applyMatrix4(f.matrix);
    g.computeBoundingSphere();
    result = [g];
  } else {
    const raw = (await loadFBX(id, onStatus))[0];
    const g0 = raw.index ? raw.toNonIndexed() : raw;
    const p = g0.attributes.position;
    // circle fit in XZ (Kasa): x^2+z^2 = 2ax + 2bz + c
    let sxx = 0, sxz = 0, szz = 0, sx = 0, sz = 0, sxr = 0, szr = 0, sr = 0, sy = 0;
    const n = p.count;
    for (let i = 0; i < n; i++) {
      const x = p.getX(i), z = p.getZ(i), r = x * x + z * z;
      sxx += x * x; sxz += x * z; szz += z * z; sx += x; sz += z; sxr += x * r; szr += z * r; sr += r; sy += p.getY(i);
    }
    const A = [[2 * sxx, 2 * sxz, sx], [2 * sxz, 2 * szz, sz], [2 * sx, 2 * sz, n]];
    const B = [sxr, szr, sr];
    const sol = solve3(A, B);
    const cx = sol[0], cz = sol[1], cy = sy / n;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += Math.hypot(p.getX(i) - cx, p.getZ(i) - cz);
    mean /= n;
    const s = 1.35 / mean;
    const m = new THREE.Matrix4().makeTranslation(-cx, -cy, -cz).premultiply(new THREE.Matrix4().makeScale(s, s, s));
    // split by bone
    const si = g0.attributes.skinIndex;
    const parts = new Map();
    for (let t = 0; t < n; t += 3) {
      const bone = si ? si.getX(t) : 0;
      if (!parts.has(bone)) parts.set(bone, []);
      parts.get(bone).push(t);
    }
    result = [];
    let k = 0;
    for (const tris of parts.values()) {
      const g = new THREE.BufferGeometry();
      for (const name of ['position', 'normal', 'uv', 'color']) {
        const a = g0.attributes[name];
        if (!a) continue;
        const arr = new Float32Array(tris.length * 3 * a.itemSize);
        let o = 0;
        for (const t of tris) for (let v = 0; v < 3; v++) for (let c = 0; c < a.itemSize; c++) arr[o++] = a.array[(t + v) * a.itemSize + c];
        g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
      }
      g.applyMatrix4(m);
      if (k === 1) g.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI));
      g.computeBoundingSphere();
      result.push(g);
      k++;
    }
  }
  geoms.set(key, result);
  return result;
}

function solve3(A, B) {
  const m = A.map((r, i) => [...r, B[i]]);
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[piv][c])) piv = r;
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let r = 0; r < 3; r++) {
      if (r === c) continue;
      const f = m[r][c] / m[c][c];
      for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
    }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

// ---------------------------------------------------------------------------------------------
// Uniforms. Colours the owner picks are kept as sRGB triples and the colour work is done in that
// (gamma) space, so a hue, contrast or colour replace means what it looks like on the picture.

const hexToSRGB = (hex, v = new THREE.Vector3()) => {
  const c = new THREE.Color();
  c.setStyle(hex || '#ffffff', THREE.NoColorSpace);
  return v.set(c.r, c.g, c.b);
};

function layerUniforms() {
  return {
    opacity: uniform(1), tint: uniform(new THREE.Vector3(1, 1, 1)), hue: uniform(0), sat: uniform(1), bright: uniform(1), contrast: uniform(1),
    repOn: uniform(0), repFrom: uniform(new THREE.Vector3()), repTo: uniform(new THREE.Vector3()), repRange: uniform(0.2), repSoft: uniform(0.1), repKeep: uniform(0),
    floor: uniform(0), mask: uniform(0), zoom: uniform(1), repeat: uniform(new THREE.Vector2(1, 1)), flipV: uniform(0), lit: uniform(1),
    shine: uniform(40), flipG: uniform(1), power: uniform(3), sunSide: uniform(0.75), rimH: uniform(1.035),
    flowStrength: uniform(0.015), flowSpeed: uniform(0.04), flowBias: uniform(0.72),
  };
}

export function syncLayerUniforms(U, L) {
  U.opacity.value = +L.opacity;
  hexToSRGB(L.tint, U.tint.value);
  U.hue.value = (+L.hue || 0) * Math.PI / 180;
  U.sat.value = +L.sat;
  U.bright.value = +L.bright;
  U.contrast.value = +L.contrast;
  const R = L.replace || {};
  U.repOn.value = R.on ? 1 : 0;
  hexToSRGB(R.from, U.repFrom.value);
  hexToSRGB(R.to, U.repTo.value);
  U.repRange.value = +R.range || 0;
  U.repSoft.value = Math.max(0.001, +R.soft || 0);
  U.repKeep.value = R.keep ? 1 : 0;
  U.floor.value = Math.min(0.99, +L.alphaFloor || 0);
  U.mask.value = +L.mask || 0;
  U.zoom.value = +L.zoom || 1;
  U.repeat.value.set(+L.repeat?.[0] || 1, +L.repeat?.[1] || 1);
  U.flipV.value = L.flipV ? 1 : 0;
  U.lit.value = L.lit === false ? 0 : 1;
  U.shine.value = +L.shine || 40;
  U.flipG.value = L.flipGreen ? -1 : 1;
  U.power.value = +L.power || 3;
  U.sunSide.value = L.sunSide ?? 0.75;
  U.rimH.value = +L.height || 1.035;
  if (L.flow) {
    U.flowStrength.value = +L.flow.strength || 0;
    U.flowSpeed.value = +L.flow.speed || 0;
    U.flowBias.value = +L.flow.bias || 0;
  }
}

// ---------------------------------------------------------------------------------------------
// Node helpers.

const LUMA = vec3(0.2126, 0.7152, 0.0722);
const toS = (c) => pow(max(c, 0.0), 1 / 2.2);
const toL = (c) => pow(max(c, 0.0), 2.2);

// Colour replace, hue, saturation, contrast, brightness and tint, in that order, in gamma space.
function adjust(rgbLinear, U) {
  let s = toS(rgbLinear);
  const d = length(s.sub(U.repFrom));
  const w = float(1).sub(smoothstep(U.repRange, U.repRange.add(U.repSoft), d)).mul(U.repOn);
  const target = mix(U.repTo, s.add(U.repTo.sub(U.repFrom)), U.repKeep);
  s = mix(s, max(target, 0.0), w);
  s = hue(s, U.hue);
  s = saturation(s, U.sat);
  s = max(s.sub(0.5).mul(U.contrast).add(0.5), 0.0);
  s = s.mul(U.bright).mul(U.tint);
  return toL(s);
}

function layerUV(base, U, scroll) {
  const v = mix(base.y, float(1).sub(base.y), U.flipV);
  let p = vec2(base.x, v).sub(0.5).mul(U.zoom).add(0.5);
  if (scroll) p = p.add(vec2(scroll, 0));
  return p.mul(U.repeat);
}

function channel(smp, which, isData) {
  const raw = which === 'a' ? smp.a : which === 'r' ? smp.r : which === 'g' ? smp.g : smp.b;
  if (which === 'a' || isData) return raw;
  return pow(max(raw, 0.0), 1 / 2.2);
}

// The alpha a layer really reads: "its alpha" on a picture whose alpha is empty counts as none.
function alphaMode(mode, tex) {
  return mode === 'texture' && tex?.emptyAlpha ? 'none' : mode;
}

function alphaOf(smp, mode, isData, U) {
  let a;
  if (mode === 'none') a = float(1);
  else if (mode === 'luma') a = dot(isData ? smp.rgb : toS(smp.rgb), LUMA);
  else if (mode === 'r' || mode === 'g' || mode === 'b') a = channel(smp, mode, isData);
  else a = smp.a;
  return max(a.sub(U.floor), 0.0).div(float(1).sub(U.floor));
}

// A soft disc mask around the picture's centre (radius in UV units; 0 = off).
function discMask(base, U) {
  const r = length(base.sub(0.5));
  const cut = float(1).sub(smoothstep(U.mask.sub(0.006), U.mask.add(0.002), r));
  return mix(float(1), cut, smoothstep(0.0, 0.001, U.mask));
}

// The normal a dome's lit layers are shaded with. A dome stands for a sphere seen face on, but it is
// shallower than a half sphere, so its own normals turn away from the light too soon: lit from behind,
// it went dark where a sphere shows a crescent. Under a light from the world (a place's sun or fixed
// light: LU.sphereN = 1) each pixel is shaded with the normal of the sphere the dome stands for: the
// ray from the camera through the pixel meets a sphere of radius LU.sphereR round LU.centre (both in
// view space), so the lit share and the terminator are a sphere's. A ray that passes the sphere by
// takes the limb's normal. Under the look's own painted light (the preview, or a place set to "painted
// in", LU.sphereN = 0) the dome keeps its own normals, as the look was made with.
function impostorNormal(LU) {
  const rd = normalize(positionView);
  const C = LU.centre;
  const b = dot(rd, C);
  const p = C.sub(rd.mul(b)); // from the ray's nearest point to the centre
  const inside = max(LU.sphereR.mul(LU.sphereR).sub(dot(p, p)), 0.0);
  return normalize(p.negate().sub(rd.mul(sqrt(inside))));
}
function shadingNormal(LU, isDome) {
  if (!isDome) return normalViewGeometry;
  return normalize(mix(normalViewGeometry, impostorNormal(LU), LU.sphereN));
}

// ---------------------------------------------------------------------------------------------
// The air's parts of a material (wave A): the march to this pixel, the light that reaches a point through the air,
// clouds lit as clouds, and the sun's glint on water. Only a Scattered look's materials are built with any of them;
// a Painted one's are built exactly as before.

/**
 * A pixel's light seen through the body's air: its own (`out`, already lit) times the share that comes through, plus
 * the light the air adds in front (the march from where the view enters the air to this point), in the sun's units
 * (pi times the stage's sun power, so a white Lambert surface facing the sun reads the sun power), then the place's
 * brightness and the ground's air in front as before.
 */
function airFinish(AIR, LU, out) {
  return Fn(() => {
    const rd = normalize(positionView);
    const sEnd = length(positionView).sub(dot(AIR.U.centre, rd)).mul(AIR.U.kmPer);
    const m = AIR.shader.march(rd, AIR.U.centre, AIR.U.kmPer, normalize(LU.light), sEnd);
    const sunE = LU.sunColour.mul(LU.sunPower).mul(Math.PI);
    return vec4(out.mul(m.Tv).add(m.L.mul(sunE)).mul(LU.gain).mul(LU.airTrans).add(LU.airLight), 1.0);
  })();
}

/** The air round the body seen against space (and against whatever is behind it): the march through the whole shell, added. */
function airShellMaterial(LU, AIR) {
  const mat = basic({ transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending });
  mat.colorNode = Fn(() => {
    const rd = normalize(positionView);
    const m = AIR.shader.march(rd, AIR.U.centre, AIR.U.kmPer, normalize(LU.light), null);
    return vec4(m.L.mul(LU.sunColour.mul(LU.sunPower).mul(Math.PI)).mul(LU.gain).mul(LU.airTrans), 1.0);
  })();
  return mat;
}

/**
 * A cloud deck's shading normal from its cover's own shape: the cover read as a height (its relief dial times a share
 * of the body's radius, in scene units), bent into the geometric normal by its screen-space slope (Mikkelsen's
 * surface gradient), so a cloud's top faces up and its sides lean away; a flat cover leaves the normal as it was.
 */
function cloudNormal(N, cover, AIR) {
  const p = positionView;
  const dpx = dFdx(p), dpy = dFdy(p);
  const r1 = cross(dpy, N), r2 = cross(N, dpx);
  const det = dot(dpx, r1);
  const h = cover.mul(AIR.U.bumpH);
  const g = r1.mul(dFdx(h)).add(r2.mul(dFdy(h))).mul(sign(det));
  return normalize(abs(det).mul(N).sub(g).add(N.mul(1e-12)));
}

/**
 * The light on a cloud deck: the sun through the air down to the deck's height (it keeps the sun a little past the
 * ground's terminator, reddened), on the relief's normal a little wrapped (thick cloud), the forward lobe where thin
 * cloud has the sun beyond it (the silver edge), the sky's light, the look's ambient.
 */
function airCloudLight(AIR, LU, Ng, Nc, cover) {
  const Lv = normalize(LU.light);
  const V = normalize(positionView.negate());
  const lt = AIR.shader.lightAt(AIR.U.cloudR, dot(Ng, Lv));
  const lam = max(dot(Nc, Lv).add(0.15).div(1.15), 0.0);
  // Henyey and Greenstein's lobe (g 0.6) against the isotropic, toward the eye when the sun is beyond the cloud
  const cosT = dot(V, Lv).negate();
  const g = 0.6;
  const hg = float((1 - g * g)).div(pow(max(float(1 + g * g).sub(cosT.mul(2 * g)), 1e-4), 1.5));
  const thin = cover.mul(float(1).sub(cover)).mul(4.0);
  const silver = hg.mul(thin).mul(AIR.U.cloudForward).mul(0.12);
  return vec3(LU.ambient).mul(AIR.U.nightFill).add(LU.sunColour.mul(LU.sunPower).mul(lt.sun.mul(lam.add(silver)).add(lt.sky.mul(0.6))));
}

/**
 * The sun's glint on water: a microfacet reflection (Trowbridge and Reitz's spread by the roughness dial, Schlick's
 * Fresnel from water's 2% head on, Smith's shadowing), lit by the sun through the air, on the water's mask alone. In
 * the sun's units, so it is as bright as the sun's reflection is: a smudge that widens toward the limb.
 */
function airGlint(AIR, LU, Ng, mask, tint) {
  const Lv = normalize(LU.light);
  const V = normalize(positionView.negate());
  const H = normalize(Lv.add(V));
  const nh = max(dot(Ng, H), 0.0), nv = max(dot(Ng, V), 0.001), nl = max(dot(Ng, Lv), 0.0);
  const a = AIR.U.glintRough.mul(AIR.U.glintRough), a2 = a.mul(a);
  const dd = nh.mul(nh).mul(a2.sub(1.0)).add(1.0);
  const D = a2.div(dd.mul(dd).mul(Math.PI));
  const Fr = float(0.02).add(float(0.98).mul(pow(float(1).sub(max(dot(V, H), 0.0)), 5.0)));
  const k = a.mul(0.5);
  const G = nv.div(nv.mul(float(1).sub(k)).add(k)).mul(nl.div(nl.mul(float(1).sub(k)).add(k)));
  const sun = AIR.shader.lightAt(AIR.U.bottom, nl).sun;
  return tint.mul(LU.sunColour).mul(LU.sunPower).mul(sun).mul(D.mul(Fr).mul(G).div(nv.mul(4.0)).mul(Math.PI)).mul(mask).mul(AIR.U.glint);
}

// ---------------------------------------------------------------------------------------------
// Materials.

function basic(opts) {
  const m = new THREE.MeshBasicNodeMaterial();
  Object.assign(m, opts);
  return m;
}

function surfaceMaterial(look, LU, U, T, sec, AIR = null) {
  const L = look.layers;
  const base = uv();
  const scroll = sec.scroll ? LU.scroll : null;
  const suv = layerUV(base, U.surface, scroll);
  let colour, alpha;
  if (T.surface) {
    const smp = texture(T.surface.tex, suv);
    colour = adjust(smp.rgb, U.surface);
    alpha = alphaOf(smp, alphaMode(L.surface.alpha, T.surface), T.surface.isData, U.surface);
  } else {
    colour = adjust(vec3(0.18), U.surface);
    alpha = float(1);
  }
  const shape = discMask(base, U.surface);

  const isDome = look.kind === 'dome';
  const Ng = shadingNormal(LU, isDome);
  let Nb = Ng;
  if (L.normal.on && T.normal) {
    const n = texture(T.normal.tex, suv);
    const x = n.r.mul(2).sub(1);
    const y = n.g.mul(2).sub(1).mul(U.normal.flipG);
    const z = sqrt(max(float(1).sub(x.mul(x)).sub(y.mul(y)), 0.0)); // two-channel maps: rebuild Z
    Nb = normalMap(vec3(x, y, z).mul(0.5).add(0.5), vec2(U.normal.opacity, U.normal.opacity));
    // the map bends the mesh's own normal; on a dome the same bend is carried onto the shading normal
    if (isDome) Nb = normalize(Nb.sub(normalViewGeometry).add(Ng));
  }
  const Lv = normalize(LU.light);
  const ndlG = dot(Ng, Lv);
  const ndl = dot(Nb, Lv);
  const day = smoothstep(-0.06, 0.12, ndlG);
  let lightTerm;
  if (AIR) {
    // (wave A, a sphere of pictures) the sun through the air, the sky after sunset, Minnaert's limb darkening
    const lt = AIR.shader.lightAt(AIR.U.bottom, ndlG);
    const mn = pow(max(max(ndl, 0.0).mul(max(dot(Nb, normalize(positionView.negate())), 0.05)), 1e-5), AIR.U.limbDark.mul(0.8));
    lightTerm = vec3(LU.ambient).mul(AIR.U.nightFill).add(LU.sunColour.mul(LU.sunPower).mul(lt.sun.mul(max(ndl, 0.0).mul(mn)).add(lt.sky)));
  } else {
    const diffuse = max(ndl, 0.0).mul(day);
    // The sun's colour (a zone's sun is coloured; elsewhere it is white) tints the light it gives.
    lightTerm = vec3(LU.ambient).add(LU.sunColour.mul(diffuse.mul(LU.sunPower)));
  }
  let out = colour.mul(mix(vec3(1.0), lightTerm, U.surface.lit));
  const V = normalize(positionView.negate());

  if (L.specular.on && T.specular && AIR) {
    const m = channel(texture(T.specular.tex, suv), L.specular.channel, T.specular.isData);
    out = out.add(airGlint(AIR, LU, Ng, m, toL(U.specular.tint)).mul(U.surface.lit));
  } else if (L.specular.on && T.specular) {
    const m = channel(texture(T.specular.tex, suv), L.specular.channel, T.specular.isData);
    const H = normalize(Lv.add(V));
    const sp = pow(max(dot(Nb, H), 0.0), U.specular.shine).mul(m).mul(U.specular.opacity).mul(day).mul(LU.sunPower);
    out = out.add(toL(U.specular.tint).mul(LU.sunColour).mul(sp).mul(U.surface.lit));
  }

  const night = float(1).sub(smoothstep(-0.14, 0.08, ndlG));
  if (L.night.on && T.night) {
    const nuv = layerUV(base, U.night, scroll);
    const g = texture(T.night.tex, nuv);
    const ch = L.night.channel || 'rgb';
    // adjust() wants linear colour: an sRGB texture's rgb already is; a data texture's rgb, or one
    // channel read as a value, is gamma-like and is brought to linear first.
    const linear = ch === 'rgb' && !T.night.isData ? g.rgb : toL(ch === 'rgb' ? g.rgb : vec3(channel(g, ch, T.night.isData)));
    const lights = adjust(linear, U.night).mul(U.night.opacity);
    if (L.night.where === 'under') {
      out = mix(lights, out, alpha);
      alpha = float(1);
    } else if (L.night.where === 'always') {
      out = out.add(lights);
    } else {
      out = out.add(lights.mul(mix(float(1), night, U.surface.lit)));
    }
  }

  // The look's night-side glow (spheres): already full at the terminator and fading out only as the
  // sunlight grows, so twilight never shows as a dark band between the lit side and the glow; a
  // little stronger toward the limb.
  const fres = float(1).sub(max(dot(Ng, V), 0.0));
  const glowNight = float(1).sub(smoothstep(-0.15, 0.3, ndlG));
  out = out.add(LU.glow.mul(LU.glowStrength).mul(glowNight).mul(fres.mul(0.5).add(0.5)).mul(U.surface.lit));

  // Opaque only when nothing can make it see-through; otherwise blended, still writing depth so the
  // layers above it and the far half of a ring are hidden behind it.
  const opaque = alphaMode(L.surface.alpha, T.surface) === 'none' && +L.surface.opacity >= 1 && !(+L.surface.mask > 0);
  const mat = basic({ transparent: !opaque, depthWrite: true });
  mat.colorNode = AIR ? airFinish(AIR, LU, out) : vec4(out.mul(LU.gain).mul(LU.airTrans).add(LU.airLight), 1.0);
  mat.opacityNode = alpha.mul(shape).mul(U.surface.opacity);
  return mat;
}

function pictureMaterial(layer, Ut, tex, { scroll = null, additive = false, side = THREE.FrontSide, lit = null, fade = false, gain = null, air = null } = {}) {
  const base = uv();
  const puv = layerUV(base, Ut, scroll);
  let colour = vec3(0.5), alpha = float(1);
  if (tex) {
    const smp = texture(tex.tex, puv);
    colour = adjust(smp.rgb, Ut);
    alpha = alphaOf(smp, alphaMode(layer.alpha, tex), tex.isData, Ut);
  }
  if (lit) colour = colour.mul(mix(float(1), lit, Ut.lit));
  if (gain) colour = colour.mul(gain);
  // (looks run 2) the air in front by day (skywash.js): the picture's light through it, and where it is
  // laid over the sky by its alpha (not added to it) the air's own light, since the sky behind it is that air
  if (air) { colour = colour.mul(air.airTrans); if (!additive) colour = colour.add(air.airLight); }
  alpha = alpha.mul(discMask(base, Ut));
  if (fade) alpha = alpha.mul(attribute('color', 'vec3').x);
  const mat = basic({ transparent: true, depthWrite: false, side, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });
  mat.colorNode = vec4(colour, 1.0);
  mat.opacityNode = alpha.mul(Ut.opacity);
  return mat;
}

function cloudsMaterial(layer, U, LU, T, isDome, AIR = null) {
  const base = uv();
  const cuv0 = layerUV(base, U, isDome ? LU.cloudScroll : null);
  const read = (cuv) => {
    if (layer.flow?.on && T.flow) {
      const f = texture(T.flow.tex, cuv).rg.sub(U.flowBias).mul(2);
      const t = LU.clock.mul(U.flowSpeed);
      const p0 = fract(t), p1 = fract(t.add(0.5));
      const s0 = texture(T.clouds.tex, cuv.sub(f.mul(p0).mul(U.flowStrength)));
      const s1 = texture(T.clouds.tex, cuv.sub(f.mul(p1).mul(U.flowStrength)));
      return mix(s0, s1, abs(p0.mul(2).sub(1)));
    }
    return texture(T.clouds.tex, cuv);
  };
  let smp;
  // wave 4: the clouds' own motion, two reads along the moving air blended (weather.js), only when asked
  if (layer.motion?.on) {
    const W = LU.weather, M = motionPhases(W, phaseOffsetUV(cuv0)), cuvC = churnedUV(W, cuv0);
    smp = mix(read(movedUV(W, cuvC, M.a1)), read(movedUV(W, cuvC, M.a0)), M.w0);
  } else smp = read(cuv0);
  const src = layer.source || 'luma';
  const coverMode = alphaMode(src === 'alpha' ? 'texture' : src, T.clouds);
  const cover = alphaOf(smp, coverMode, T.clouds.isData, U);
  const colour = adjust(src === 'luma' || src === 'alpha' ? (T.clouds.isData ? toL(smp.rgb) : smp.rgb) : vec3(1), U);
  const Ng = shadingNormal(LU, isDome);
  const Lv = normalize(LU.light);
  // (wave A, a sphere's picture clouds, Scattered: lit as clouds, through the air, as a generated look's are)
  const shade = AIR ? airCloudLight(AIR, LU, Ng, cloudNormal(Ng, cover, AIR), cover) : vec3(LU.ambient).add(LU.sunColour.mul(max(dot(Ng, Lv), 0.0).mul(LU.sunPower)));
  const mat = basic({ transparent: true, depthWrite: false });
  let col = colour.mul(mix(vec3(1.0), shade, U.lit));
  // wave 4: lightning in the storm cells, inside the cloud's cover (weather.js), only when asked
  if (layer.storm?.on) col = col.add(flashLight(LU.weather, flashAt(LU.weather, isDome ? positionLocal : normalize(positionLocal), isDome), dot(Ng, Lv), colour, cover));
  mat.colorNode = AIR ? airFinish(AIR, LU, col) : vec4(col.mul(LU.gain).mul(LU.airTrans).add(LU.airLight), 1.0);
  mat.opacityNode = cover.mul(U.opacity).mul(discMask(base, U));
  return mat;
}

// A generated sphere's surface: its baked colour, relief, shine and glow, read per pixel from the
// direction in the body's frame (generate.js's sampleLatLong), lit as the pictured surface is, and with
// the shading a picture cannot carry: the haze of the air seen edge on (the atmosphere layer's colour),
// limb darkening for a gas body, and the back-scatter of bare dust (a full moon stays bright to its rim).
// A gas giant's decks (generate.js's depth): how far apart they stand at full spread, in body radii of
// the 0..1 deck height, and where along the ground toward the sun the shadow test looks (in units of
// that height: a deck's shadow reaches farthest near the terminator, where the sun is lowest).
const DEPTH_AMP = 0.014;
const SHADOW_STEPS = [0.5, 1.2, 2.2, 3.6, 5.5, 8, 11.5, 16];

function generatedSurfaceMaterial(look, LU, U, G, P = null, AIR = null) {
  const L = look.layers;
  const gen = look.generated;
  const dir0 = normalize(positionLocal);
  // wave 2's parts: a shape (its own surface, normals, self-shadow, exposed rock and glow) and rings
  // (their shadow on the body). A look without them builds exactly the material it always did.
  const SS = P?.shape ? shapeSurface(P.shape) : null;
  const ring = P?.ringProf ? P : null;
  const NsO = SS ? SS.normalAt(dir0) : null;
  const Lpart = SS || ring ? normalize(modelWorldMatrixInverse.mul(vec4(cameraWorldMatrix.mul(vec4(LU.light, 0.0)).xyz, 0.0)).xyz) : null;
  // with decks: the camera and the light in the body's frame, and each pixel's lookup moved toward the
  // viewer by its deck's height (parallax: toward the limb the upper decks ride over the lower)
  const depth = !!(G.more && depthOn(gen));
  let dir = dir0, A = null, hP = null, Lo = null;
  if (depth) {
    A = LU.depthSpread.mul(DEPTH_AMP);
    const camO = modelWorldMatrixInverse.mul(vec4(cameraPosition, 1.0)).xyz;
    const Vo = normalize(camO.sub(positionLocal));
    const h0 = sampleLatLong(G.more.texture, dir0).b;
    const Vt = Vo.sub(dir0.mul(dot(dir0, Vo)));
    dir = normalize(dir0.add(Vt.mul(h0.sub(0.5).mul(A).div(max(dot(dir0, Vo), 0.2)))));
    hP = sampleLatLong(G.more.texture, dir).b;
    Lo = normalize(modelWorldMatrixInverse.mul(vec4(cameraWorldMatrix.mul(vec4(LU.light, 0.0)).xyz, 0.0)).xyz);
  }
  const S = sampleLatLong(G.surface.texture, dir);
  let colour = adjust(toL(S.rgb), U.surface);
  const Ng = normalize(transformNormalToView(NsO || dir0));
  const Rr = sampleLatLong(G.relief.texture, dir);
  let Nb = Ng;
  let Ch = null;
  if (SS) {
    // the shape's own normal, the recipe's relief over it (none where the wound has bared the rock),
    // and the bared rock in its layers
    Ch = SS.channels(dir0);
    const rock = clamp(Ch.g, 0.0, 1.0);
    if (L.normal.on) Nb = normalize(transformNormalToView(NsO.add(Rr.rgb.mul(2).sub(1).sub(dir0).mul(U.normal.opacity).mul(float(1).sub(rock)))));
    const band = sin(Ch.a.mul(95.0).add(Rr.r.mul(4.0))).mul(0.5).add(0.5);
    const rockCol = mix(P.PU.rockColour, P.PU.strataColour, band.mul(0.85)).mul(Rr.g.mul(0.5).add(0.75));
    colour = mix(colour, rockCol, rock);
  } else if (depth) {
    // the decks' rises, baked as relief: lit on the sun's side, dark on the other
    const Nd = normalize(dir0.add(Rr.rgb.mul(2).sub(1).sub(dir).mul(LU.depthSpread.mul(LU.depthShade).mul(2.0))));
    Nb = normalize(transformNormalToView(Nd));
  } else if (L.normal.on) {
    const Nr = normalize(transformNormalToView(Rr.rgb.mul(2).sub(1)));
    Nb = normalize(Ng.add(Nr.sub(Ng).mul(U.normal.opacity)));
  }
  const Lv = normalize(LU.light);
  const V = normalize(positionView.negate());
  const ndlG = dot(Ng, Lv);
  const ndv = max(dot(Ng, V), 0.0);
  const day = smoothstep(-0.06, 0.12, ndlG);
  const mu0 = max(dot(Nb, Lv), 0.0);
  const mu = max(dot(Nb, V), 0.05);
  const lommel = mu0.mul(2).div(mu0.add(mu));
  // (Scattered: the day's edge is the air's, below, not this smoothstep)
  let diffuse = AIR ? mix(mu0, lommel, LU.dusty) : mix(mu0, lommel, LU.dusty).mul(day);
  let deckShade = null;
  if (depth) {
    // the upper decks' shadows on the lower: along the ground toward the sun, is any deck higher than
    // the sunbeam reaching this one? The lower the sun, the farther they reach.
    const sinE = dot(dir, Lo);
    const tanE = sinE.div(sqrt(max(float(1).sub(sinE.mul(sinE)), 0.0001)));
    const T = normalize(Lo.sub(dir.mul(sinE)).add(vec3(0.00001, 0.00002, 0.00003)));
    let shadow = float(0);
    for (const f of SHADOW_STEPS) {
      const s = A.mul(f);
      const hi = sampleLatLong(G.more.texture, normalize(dir.add(T.mul(s)))).b;
      const rise = hi.sub(hP).mul(A).sub(s.mul(tanE));
      shadow = max(shadow, clamp(rise.div(A.mul(0.15).add(0.000001)), 0.0, 1.0));
    }
    diffuse = diffuse.mul(float(1).sub(shadow.mul(LU.depthShade).mul(0.85)));
    // and the lower decks lie in the upper ones' shade a little, whatever the sun
    deckShade = float(1).sub(float(1).sub(hP).mul(LU.depthShade).mul(0.35));
  }
  // the shape's shadow on itself (a crater's wall, a lump, the wound's far side) and the rings' shadow
  if (SS) diffuse = diffuse.mul(float(1).sub(SS.selfShadow(dir0, Lpart, NsO)));
  if (ring) diffuse = diffuse.mul(float(1).sub(ringShadow(dir0, Lpart, ring.ringProf, ring.PU.ring)));
  let lightTerm;
  if (AIR) {
    // (wave A) the sun reaches the ground through the air, reddened and dimmed toward the terminator and gone past
    // it; the sky's own light after it has set; Minnaert's limb darkening (its dial); the clouds' shadows below them
    const lt = AIR.shader.lightAt(AIR.U.bottom, ndlG);
    const mn = pow(max(mu0.mul(mu), 1e-5), AIR.U.limbDark.mul(0.8));
    const csh = AIR.cloudShadowNode ? AIR.cloudShadowNode(dir0) : float(1);
    // (the critic) the look's ambient is a painted fill: under the real air only its night-side share is kept
    lightTerm = vec3(LU.ambient).mul(AIR.U.nightFill).add(LU.sunColour.mul(LU.sunPower).mul(lt.sun.mul(diffuse.mul(mn).mul(csh)).add(lt.sky.mul(csh.mul(0.3).add(0.7)))));
  } else {
    const limb = mix(float(1), pow(ndv, 0.45), LU.limbDark);
    lightTerm = vec3(LU.ambient).add(LU.sunColour.mul(diffuse.mul(LU.sunPower).mul(limb)));
  }
  let out = colour.mul(mix(vec3(1.0), lightTerm, U.surface.lit));
  if (deckShade) out = out.mul(mix(float(1), deckShade, U.surface.lit));
  // a broken planet's molten heart, glowing by day and night, white-hot where it is brightest
  if (SS) out = out.add(colour.mul(P.PU.glowColour).mul(P.PU.glow).mul(clamp(Ch.g, 0.0, 1.0)).mul(0.18).mul(U.surface.lit));
  if (SS) out = out.add(P.PU.glowColour.mul(Ch.b).add(vec3(1.0, 0.85, 0.6).mul(Ch.b.mul(Ch.b).mul(Ch.b)).mul(0.6)).mul(P.PU.glow).mul(1.4));

  if (L.specular.on && AIR) {
    // (wave A) the sun's reflection on the water's mask: a microfacet glint through the air, none on land
    out = out.add(airGlint(AIR, LU, Ng, S.a, toL(U.specular.tint)).mul(U.surface.lit));
  } else if (L.specular.on) {
    const H = normalize(Lv.add(V));
    // the sun's glint: tighter as the shininess rises, and brighter by as much, so it stays a glint
    const fres = float(0.3).add(pow(float(1).sub(ndv), 5.0).mul(0.7));
    const sp = pow(max(dot(Ng, H), 0.0), U.specular.shine).mul(U.specular.shine.div(40.0)).mul(S.a).mul(U.specular.opacity).mul(day).mul(LU.sunPower).mul(fres);
    out = out.add(toL(U.specular.tint).mul(LU.sunColour).mul(sp).mul(U.surface.lit));
  }

  // air seen edge on: toward the rim the surface fades into the lit atmosphere
  // (Scattered: the air itself does this, in airFinish, so none of the painted haze is laid on as well)
  if (!AIR) {
    const hz = clamp(pow(float(1).sub(ndv), 2.2).mul(LU.haze).mul(1.4), 0.0, 1.0);
    const hzLight = vec3(LU.ambient).add(LU.sunColour.mul(smoothstep(-0.25, 0.45, ndlG).mul(LU.sunPower)));
    out = mix(out, toL(U.atmosphere.tint).mul(hzLight), hz.mul(U.surface.lit));
  }

  // a haze world: a thick tinted haze over the whole disc, lit by the sun (a little past the
  // terminator, as high air is) and thickest toward the rim (none at all while its dial is 0)
  const veilAmt = clamp(LU.veil.mul(float(0.72).add(pow(float(1).sub(ndv), 1.5).mul(0.28))), 0.0, 1.0).mul(U.surface.lit);
  const veilLight = vec3(LU.ambient).add(LU.sunColour.mul(smoothstep(-0.3, 0.5, ndlG).mul(LU.sunPower)));
  out = mix(out, LU.veilColour.xyz.mul(veilLight), veilAmt);

  // a look with both city lights and lava (a living world with a molten one blended in, or the other
  // way round) has each in its own channel, each lit as it should be: the lava by day and night, in the
  // night layer's colour when the lava is the look's own and in the blended recipe's lava colour when
  // it came with the blend; the cities on the night side only, in their own colours
  const split = !!(G.more && glowKinds(gen).length > 1);
  if (L.night.on && split) {
    const Mx = sampleLatLong(G.more.texture, dir);
    const Iv = Mx.g;
    const lavaTint = glowKind(gen) === 'lava' ? toL(U.night.tint) : LU.lavaColour.xyz;
    out = out.add(lavaTint.mul(Iv).add(vec3(1.0, 0.72, 0.32).mul(Iv.mul(Iv).mul(Iv)).mul(0.7)).mul(U.night.opacity).mul(U.night.bright));
    const Ic = Mx.r;
    const emC = mix(LU.glowColour.xyz, LU.lightColour.xyz, smoothstep(0.15, 0.7, Ic)).mul(Ic).add(vec3(1.0, 0.9, 0.75).mul(Ic.mul(Ic).mul(Ic)).mul(0.35))
      .mul(LU.lightBright).mul(U.night.opacity).mul(U.night.bright).mul(float(1).sub(LU.veil.mul(0.6)));
    out = out.add(emC.mul(mix(float(1), float(1).sub(smoothstep(-0.12, 0.1, ndlG)), U.surface.lit)));
  }
  // molten rock: the night layer's colour, white-hot where it is hottest; shown everywhere or by night
  const gk = split ? null : glowKind(look.generated);
  if (L.night.on && gk === 'lava') {
    const I = Rr.a;
    const em = toL(U.night.tint).mul(I).add(vec3(1.0, 0.72, 0.32).mul(I.mul(I).mul(I)).mul(0.7)).mul(U.night.opacity).mul(U.night.bright);
    const night = float(1).sub(smoothstep(-0.14, 0.08, ndlG));
    out = L.night.where === 'night' ? out.add(em.mul(mix(float(1), night, U.surface.lit))) : out.add(em);
  }
  // city lights: the glow colour where they thin out, the light colour where they are dense, on the
  // night side only (the night layer's strength over them, dimmed under a thick haze)
  if (L.night.on && gk === 'lights') {
    const I = Rr.a;
    const em = mix(LU.glowColour.xyz, LU.lightColour.xyz, smoothstep(0.15, 0.7, I)).mul(I).add(vec3(1.0, 0.9, 0.75).mul(I.mul(I).mul(I)).mul(0.35))
      .mul(LU.lightBright).mul(U.night.opacity).mul(U.night.bright).mul(float(1).sub(LU.veil.mul(0.6)));
    const night = float(1).sub(smoothstep(-0.12, 0.1, ndlG));
    out = out.add(em.mul(mix(float(1), night, U.surface.lit)));
  }

  const glowNight = float(1).sub(smoothstep(-0.15, 0.3, ndlG));
  out = out.add(LU.glow.mul(LU.glowStrength).mul(glowNight).mul(float(1).sub(ndv).mul(0.5).add(0.5)).mul(U.surface.lit));

  const mat = basic({ transparent: false, depthWrite: true });
  // (Scattered: the body's own air in front of every pixel of it, then the ground's air as before)
  mat.colorNode = AIR ? airFinish(AIR, LU, out) : vec4(out.mul(LU.gain).mul(LU.airTrans).add(LU.airLight), 1.0);
  if (SS) mat.positionNode = SS.positionNode;
  return mat;
}

// A generated cloud layer on the cloud shell: its baked brightness and cover, read by direction.
function generatedCloudsMaterial(U, LU, G, P = null, layer = null, AIR = null) {
  const dir = normalize(positionLocal);
  let Cs;
  // wave 4: the clouds' own motion, two reads along the moving air blended (weather.js), only when asked
  if (layer?.motion?.on) {
    const W = LU.weather, M = motionPhases(W, phaseOffsetDir(dir)), dirC = churnedDir(W, dir);
    Cs = mix(sampleLatLong(G.clouds.texture, movedDir(W, dirC, M.a1)), sampleLatLong(G.clouds.texture, movedDir(W, dirC, M.a0)), M.w0);
  } else Cs = sampleLatLong(G.clouds.texture, dir);
  let cover = max(Cs.a.sub(U.floor), 0.0).div(float(1).sub(U.floor));
  // no cloud over a broken planet's wound (none of this for a look without a shape)
  if (P?.shape) cover = cover.mul(float(1).sub(smoothstep(0.1, 0.6, shapeSurface(P.shape).channels(dir).g)));
  const colour = adjust(toL(Cs.rgb), U);
  const Ng = normalize(transformNormalToView(dir));
  const ndl = dot(Ng, normalize(LU.light));
  if (AIR) {
    // (wave A) clouds lit as clouds: lit tops and darker sides from the cover's own relief, the sun through the air
    // to the deck's height, the silver edge of thin cloud with the sun beyond it, the sky's light; the air in front
    const shade = airCloudLight(AIR, LU, Ng, cloudNormal(Ng, cover, AIR), cover);
    const mat = basic({ transparent: true, depthWrite: false });
    let col = colour.mul(mix(vec3(1.0), shade, U.lit));
    if (layer?.storm?.on) col = col.add(flashLight(LU.weather, flashAt(LU.weather, dir), ndl, colour, cover));
    mat.colorNode = airFinish(AIR, LU, col);
    mat.opacityNode = cover.mul(U.opacity);
    return mat;
  }
  // clouds stand high: they keep the sun a little past the ground's terminator
  const shade = vec3(LU.ambient).add(LU.sunColour.mul(max(ndl.add(0.06).div(1.06), 0.0).mul(LU.sunPower)));
  const mat = basic({ transparent: true, depthWrite: false });
  let col = colour.mul(mix(vec3(1.0), shade, U.lit));
  // wave 4: lightning in the storm cells (weather.js), only when asked
  if (layer?.storm?.on) col = col.add(flashLight(LU.weather, flashAt(LU.weather, dir), ndl, colour, cover));
  mat.colorNode = vec4(col.mul(LU.gain).mul(LU.airTrans).add(LU.airLight), 1.0);
  mat.opacityNode = cover.mul(U.opacity);
  return mat;
}

/**
 * (wave A) A generated look's clouds' shadow on its ground below: the cover read where the sun's way from this point
 * of the ground crosses the deck (its height over the sun's height there), in the clouds' own turn against the ground,
 * on the day side only. (Clouds' motion, when its tick is on, is not followed: the shadow is the cover at rest.)
 */
function generatedCloudShadow(AIR, LU, Uc, G) {
  return (dir0) => {
    const Lo = normalize(modelWorldMatrixInverse.mul(vec4(cameraWorldMatrix.mul(vec4(LU.light, 0.0)).xyz, 0.0)).xyz);
    const m0 = dot(dir0, Lo);
    const p = normalize(dir0.add(Lo.mul(AIR.U.cloudH.div(max(m0, 0.05)))));
    const cr = AIR.U.cloudRot;
    const pc = vec3(p.x.mul(cr.x).sub(p.z.mul(cr.y)), p.y, p.x.mul(cr.y).add(p.z.mul(cr.x)));
    const cv = sampleLatLong(G.clouds.texture, pc).a;
    const cover = max(cv.sub(Uc.floor), 0.0).div(float(1).sub(Uc.floor)).mul(Uc.opacity);
    return float(1).sub(cover.mul(AIR.U.cloudShadow).mul(smoothstep(-0.05, 0.1, m0)));
  };
}

// A rim glow on a shell `h` times the body: strongest at the body's limb, fading inward over the
// disc and outward to nothing at the shell's edge (no hard outer edge). The distance from the
// centre on screen, in body radii, is read from the shell's view angle: d = h * sqrt(1 - (N.V)^2).
function rimMaterial(U, LU, isDome = false) {
  const Ng = normalViewGeometry;
  const V = normalize(positionView.negate());
  const Lv = normalize(LU.light);
  // the glow's shape follows the shell's own normals; which side the sun is on, the body's
  const Ns = shadingNormal(LU, isDome);
  const ndv = clamp(abs(dot(Ng, V)), 0.0, 1.0);
  const h = max(U.rimH, 1.001);
  const d = h.mul(sqrt(max(float(1).sub(ndv.mul(ndv)), 0.0)));
  const edge = sqrt(float(1).sub(float(1).div(h.mul(h)))); // N.V where the shell crosses the limb
  const inner = clamp(float(1).sub(ndv).div(float(1).sub(edge)), 0.0, 1.0);
  const outer = clamp(h.sub(d).div(h.sub(1.0)), 0.0, 1.0);
  const t = mix(inner, outer, smoothstep(0.995, 1.005, d));
  const sun = mix(float(1), smoothstep(-0.35, 0.55, dot(Ns, Lv)).mul(0.92).add(0.08), U.sunSide);
  const colour = toL(U.tint.mul(U.bright)).mul(LU.gain).mul(LU.airTrans);
  const mat = basic({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  mat.colorNode = vec4(colour, 1.0);
  mat.opacityNode = pow(t, U.power).mul(sun).mul(U.opacity);
  return mat;
}

// ---------------------------------------------------------------------------------------------
// A generated look's parts (shapes.js): its shape's maps, its rings, its belt or field and a broken
// planet's stream, each with its own uniforms; the colours, dust and glow are live (syncParts).

function fieldUniforms() {
  return {
    colour: uniform(new THREE.Vector3(0.4, 0.4, 0.4)), colour2: uniform(new THREE.Vector3(0.3, 0.3, 0.3)), dust: uniform(0.6), dustColour: uniform(new THREE.Vector3(0.5, 0.5, 0.5)),
    planetR: uniform(1), projScale: uniform(1000), nearPx: uniform(FIELD_TUNE.nearPx), farPx: uniform(FIELD_TUNE.farPx),
    warm: uniform(new THREE.Vector4(0, 0, 0, 0)), warmAt: uniform(new THREE.Vector3(0, 0, 1)),
  };
}
function partUniforms() {
  const v3 = () => uniform(new THREE.Vector3(1, 1, 1));
  return {
    rockColour: v3(), strataColour: v3(), glowColour: v3(), glow: uniform(1), belt: fieldUniforms(), stream: fieldUniforms(),
    ring: { inner: uniform(1.35), outer: uniform(2.3), opacity: uniform(0.75), c1: v3(), c2: v3(), bright: uniform(1), scatter: uniform(0.6), planetR: uniform(1) },
  };
}

async function buildParts(look, LU, groups, onStatus, bodyOn) {
  const gen = look.generated;
  if (!gen.shape && !gen.belt && !gen.rings) return null;
  const t0 = performance.now();
  const P = { PU: partUniforms(), fields: [], shape: null, ringProf: null, ring: null, extent: 1, bodyOn };
  if (gen.shape && bodyOn) P.shape = await acquireShape(look, onStatus);
  if (gen.rings && bodyOn) {
    P.ringProf = ringProfile(gen.seed, gen.rings.style, gen.rings.dials);
    P.ring = ringMesh(P.ringProf, LU, P.PU.ring);
    groups.axis.add(P.ring);
    P.extent = Math.max(P.extent, +gen.rings.dials.outer);
  }
  const field = async (kind, dials, salt, angular, parent, U) => {
    onStatus?.(`Placing ${look.name}'s rocks`);
    const f = new Field(fieldLayout(kind, gen.seed, dials, kind === 'stream' ? gen.shape.version : gen.belt.version), LU, U);
    P.fields.push(f);
    await f.build(bakeRenderer, gen.seed * 7 + salt, angular);
    parent.add(f.group);
    P.extent = Math.max(P.extent, Math.min(3, f.L.extent));
  };
  if (gen.belt) await field(gen.belt.kind, gen.belt.dials, 1, 0.55, groups.axis, P.PU.belt);
  if (gen.shape?.kind === 'broken' && bodyOn && +gen.shape.dials.streamCount > 0) await field('stream', gen.shape.dials, 2, 0.85, groups.spin, P.PU.stream);
  P.buildMs = performance.now() - t0;
  return P;
}

const _pc = new THREE.Color();
const setColour = (u, hex) => { _pc.setStyle(hex || '#808080'); u.value.set(_pc.r, _pc.g, _pc.b); };
function syncParts(state) {
  const P = state.parts;
  const gen = state.look.generated;
  if (!P || !gen) return;
  const PU = P.PU;
  const body = P.bodyOn ? 1 : 0;
  PU.belt.planetR.value = PU.stream.planetR.value = PU.ring.planetR.value = body;
  const s = gen.shape;
  if (s?.kind === 'broken') {
    const d = s.dials;
    setColour(PU.rockColour, d.rockColour); setColour(PU.strataColour, d.strataColour); setColour(PU.glowColour, d.glowColour);
    PU.glow.value = +d.glow || 0;
    setColour(PU.stream.colour, d.streamColour);
    PU.stream.colour2.value.copy(PU.stream.colour.value).multiplyScalar(0.55);
    PU.stream.dust.value = +d.streamDust || 0;
    setColour(PU.stream.dustColour, d.dustColour);
    const g = PU.glowColour.value;
    PU.stream.warm.value.set(g.x, g.y, g.z, (+d.glow || 0) * 0.9);
    const yaw = (+d.woundYaw * Math.PI) / 180, pitch = (+d.woundPitch * Math.PI) / 180, k = 1 - +d.woundDepth * 0.55;
    PU.stream.warmAt.value.set(Math.cos(pitch) * Math.sin(yaw) * k, Math.sin(pitch) * k, Math.cos(pitch) * Math.cos(yaw) * k);
  }
  if (gen.belt) {
    const d = gen.belt.dials;
    setColour(PU.belt.colour, d.colour); setColour(PU.belt.colour2, d.colour2);
    PU.belt.dust.value = +d.dust || 0;
    setColour(PU.belt.dustColour, d.dustColour);
  }
  if (gen.rings) {
    const d = gen.rings.dials, R = PU.ring;
    R.inner.value = +d.inner; R.outer.value = +d.outer; R.opacity.value = +d.opacity; R.bright.value = +d.bright;
    setColour(R.c1, d.colour1); setColour(R.c2, d.colour2);
    R.scatter.value = ringScatter(gen.rings.style);
  }
}

// ---------------------------------------------------------------------------------------------
// A look on the stage.

const SPHERE_ORDER = { surface: 0, clouds: 2, overlay: 3, atmosphere: 4, rings: 5 };

export async function buildLook(look, { onStatus, place = false } = {}) {
  const L = look.layers;
  const kind = look.kind;
  const root = new THREE.Group();
  root.name = look.name;
  const bill = new THREE.Group(); // faces the camera (domes, halos, sheets)
  const axis = new THREE.Group(); // a sphere's tilted axis
  const spin = new THREE.Group();
  const cloudSpin = new THREE.Group();
  const ringGroup = new THREE.Group();
  const ringSpin = new THREE.Group();
  axis.add(spin, cloudSpin, ringGroup);
  ringGroup.add(ringSpin);
  root.add(bill, axis);

  const LU = {
    light: uniform(new THREE.Vector3(0, 0, 1)),
    ambient: uniform(0.035), sunPower: uniform(1), glow: uniform(new THREE.Vector3()), glowStrength: uniform(0),
    scroll: uniform(0), cloudScroll: uniform(0), clock: uniform(0),
    // A place's own brightness (1 on the preview stage) and the colour of the sun lighting it.
    gain: uniform(1), sunColour: uniform(new THREE.Vector3(1, 1, 1)),
    // (looks run 2) the air in front of the body seen from the ground by day (skywash.js, set by the place
    // view): its own light, linear, and the share of the body's light that comes through. None elsewhere.
    airLight: uniform(new THREE.Vector3(0, 0, 0)), airTrans: uniform(new THREE.Vector3(1, 1, 1)),
    // A dome under a light from the world is shaded as the sphere it stands for (impostorNormal).
    sphereN: uniform(0), centre: uniform(new THREE.Vector3(0, 0, -1)), sphereR: uniform(1),
    // a generated look's live shading dials (generate.js's SHADING_DIALS)
    haze: uniform(0), limbDark: uniform(0), dusty: uniform(0), veil: uniform(0), veilColour: uniform(new THREE.Vector4()),
    // a generated look's city lights (generate.js's LIGHT_DIALS), linear
    lightColour: uniform(new THREE.Vector4(1, 0.6, 0.2, 1)), glowColour: uniform(new THREE.Vector4(1, 0.3, 0.05, 1)), lightBright: uniform(1),
    // a gas giant's decks (live), and the lava's colour when the lava came with a blend, linear
    depthSpread: uniform(0.5), depthShade: uniform(0.6), lavaColour: uniform(new THREE.Vector4(1, 0.4, 0.1, 1)),
    // wave 4: the storm cells' flashes and the clouds' own motion (weather.js)
    weather: weatherUniforms(),
  };
  // (the atmosphere brief's wave B, its critic) built for a place: a generated look's rings, belt rocks and their dust are
  // seen through the ground's air as its body is (shapes.js's `seenThrough`), so a ring is not left white beside a planet
  // reddened low in the night sky, nor a rock black against the day's blue. A JS flag, not a uniform: on the close-up stage
  // the programs are exactly what they were.
  if (place) LU.place = true;
  const U = {};
  for (const s of Object.keys(L)) U[s] = layerUniforms();

  // textures in use
  const T = {};
  const wanted = [];
  const want = (slot, name) => { if (name) wanted.push(loadTexture(name, onStatus).then((t) => { T[slot] = t; }).catch((e) => { console.warn('[viewer]', e.message); look._errors = (look._errors || []).concat(e.message); })); };
  const surfaceOn = L.surface.on;
  if (surfaceOn) want('surface', L.surface.tex);
  if (L.normal.on && kind !== 'sheet') want('normal', L.normal.tex);
  if (L.specular.on && kind !== 'sheet') want('specular', L.specular.tex);
  if (L.night.on && kind !== 'sheet') want('night', L.night.tex);
  if (L.clouds.on && kind !== 'sheet') { want('clouds', L.clouds.tex); if (L.clouds.flow?.on) want('flow', L.clouds.flow.tex); }
  if (L.overlay.on && kind === 'dome') want('overlay', L.overlay.tex);
  if (L.atmosphere.on && kind !== 'sheet' && L.atmosphere.form === 'halo') want('atmosphere', L.atmosphere.tex);
  if (L.rings.on && kind !== 'sheet') want('rings', L.rings.tex);
  await Promise.all(wanted);
  // a generated sphere's textures are baked, not read (its layers name no picture for them)
  // (a debris field with no body bakes no surface)
  // (and a space volume with no body bakes none either)
  const bodiless = (!!look.generated?.belt || !!look.generated?.volume) && !surfaceOn && !L.clouds.on;
  const G = look.generated && kind === 'sphere' && bakeRenderer && !bodiless ? await acquireGenerated(look, onStatus) : null;
  // (wave A) the form of its air now: Scattered builds the air round it (and no painted rim or halo), None neither
  const airMode = airModeOf(look);
  const AIR = airMode === 'scattered' && kind === 'sphere' && surfaceOn ? makeAir(look) : null;
  if (AIR && G && G.clouds && L.clouds.on) AIR.cloudShadowNode = generatedCloudShadow(AIR, LU, U.clouds, G);
  const atmosphereOn = L.atmosphere.on && airMode === 'painted';

  const add = (parent, geom, mat, order) => {
    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    parent.add(mesh);
    return mesh;
  };
  const keep = new Set(Object.values(T).filter(Boolean).map((t) => t.name));
  let radius = 1;
  let parts = null;
  let sheetAspect = 1;
  let profile = null; // a dome's outline profile (domeProfile)
  // Shells whose size is a slider (the clouds', a rim atmosphere's, an overlay's own copy): each mesh, its layer, and how the
  // slider maps to its scale. syncLook sets them, so moving the slider moves the shell at once, with no rebuild or bake.
  const shells = [];

  if (kind === 'sheet') {
    const t = T.surface;
    sheetAspect = t ? t.width / t.height : 1;
    const g = new THREE.PlaneGeometry(2 * sheetAspect, 2);
    if (surfaceOn) add(bill, g, pictureMaterial(L.surface, U.surface, t, { additive: true, gain: LU.gain, air: LU }), 0);
    radius = Math.max(sheetAspect, 1) * 1.05;
    if (look.adjust.showRects && t) {
      const rects = (await sheetRects(t.name)) || [];
      const pts = [];
      for (const r of rects) {
        // the survey's rectangles are in the stored picture's pixels, y down from the top
        const x0 = (r.x / r.W - 0.5) * 2 * sheetAspect, x1 = ((r.x + r.w) / r.W - 0.5) * 2 * sheetAspect;
        let y0 = (0.5 - r.y / r.H) * 2, y1 = (0.5 - (r.y + r.h) / r.H) * 2;
        if (L.surface.flipV) { y0 = -y0; y1 = -y1; }
        pts.push(x0, y0, 0.01, x1, y0, 0.01, x1, y0, 0.01, x1, y1, 0.01, x1, y1, 0.01, x0, y1, 0.01, x0, y1, 0.01, x0, y0, 0.01);
      }
      if (pts.length) {
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const lm = new THREE.LineBasicNodeMaterial({ color: 0x8fd3b5, transparent: true, opacity: 0.8, depthWrite: false });
        const lines = new THREE.LineSegments(lg, lm);
        lines.renderOrder = 6;
        bill.add(lines);
      }
    }
  } else if (kind === 'sphere') {
    const g = await bodyGeometry('planet_01_mesh', 'surface', onStatus);
    parts = look.generated && bakeRenderer ? await buildParts(look, LU, { axis, spin }, onStatus, !!G && surfaceOn) : null;
    if (parts) radius = Math.max(radius, parts.extent);
    const bodyGeom = parts?.shape ? shapeGeometry() : g;
    if (surfaceOn) add(spin, bodyGeom, G ? (AIR ? generatedSurfaceMaterial(look, LU, U, G, parts, AIR) : generatedSurfaceMaterial(look, LU, U, G, parts)) : (AIR ? surfaceMaterial(look, LU, U, T, { scroll: false }, AIR) : surfaceMaterial(look, LU, U, T, { scroll: false })), SPHERE_ORDER.surface);
    if (L.clouds.on && (G ? G.clouds : T.clouds)) {
      // A generated look's clouds are read by direction alone, so they ride a finely made sphere: on
      // clouds_01's coarser one the shell sagged below the body between its vertices once the clouds had
      // turned a little against the body, cutting dark lines along its meridians (wave 4 found it).
      const cg = G ? fineCloudShell() : await cloudsSphereGeometry(onStatus);
      const m = add(cloudSpin, cg, G ? (AIR ? generatedCloudsMaterial(U.clouds, LU, G, parts, L.clouds, AIR) : generatedCloudsMaterial(U.clouds, LU, G, parts, L.clouds)) : (AIR ? cloudsMaterial(L.clouds, U.clouds, LU, T, false, AIR) : cloudsMaterial(L.clouds, U.clouds, LU, T, false)), SPHERE_ORDER.clouds);
      // clouds_01 already sits at x1.002 the body: the shell height is its ratio to the body.
      shells.push({ mesh: m, slot: 'clouds', base: 1.002, fallback: 1.002 });
    }
    if (AIR) {
      // (wave A) the air's own shell, its far side drawn (so the body hides it wherever the body is), out to its top
      AIR.shell = add(axis, airShellGeometry(), airShellMaterial(LU, AIR), SPHERE_ORDER.atmosphere);
      radius = Math.max(radius, (AIR.U.top.value / AIR.U.bottom.value) * 1.002);
    }
    if (atmosphereOn) {
      if (L.atmosphere.form === 'rim') {
        const m = add(axis, g, rimMaterial(U.atmosphere, LU), SPHERE_ORDER.atmosphere);
        shells.push({ mesh: m, slot: 'atmosphere', base: 1, fallback: 1.035 });
        radius = Math.max(radius, +L.atmosphere.height || 1.035);
      } else if (T.atmosphere || L.atmosphere.tex === '') {
        const hg = await haloGeometry(L.atmosphere.mesh, onStatus);
        if (hg) {
          add(bill, hg, pictureMaterial(L.atmosphere, U.atmosphere, T.atmosphere, { additive: true, gain: LU.gain, air: LU }), SPHERE_ORDER.atmosphere);
          radius = Math.max(radius, hg.boundingSphere.radius);
        }
      }
    }
  } else {
    // dome
    const spec = MESHES[look.mesh] || MESHES.planetfrontend_01_mesh;
    const meshId = MESHES[look.mesh] ? look.mesh : 'planetfrontend_01_mesh';
    const surf = await bodyGeometry(meshId, 'surface', onStatus);
    const depth = surf.userData.depth;
    profile = surf.userData.profile || null;
    const latlongMesh = spec.uv === 'latlong';
    const surfGeom = L.surface.uv === 'latlong' && !latlongMesh ? withLatLongUV(surf, depth) : surf;
    const surfScroll = latlongMesh || L.surface.uv === 'latlong';
    if (surfaceOn) add(bill, surfGeom, surfaceMaterial(look, LU, U, T, { scroll: surfScroll }), 0);
    if (L.clouds.on && T.clouds) {
      const cg = latlongMesh ? surf : withLatLongUV(surf, depth);
      const m = add(bill, cg, cloudsMaterial(L.clouds, U.clouds, LU, T, true), 2);
      shells.push({ mesh: m, slot: 'clouds', base: 1, fallback: 1.004 });
    }
    if (L.overlay.on) {
      // the dome's own shell section where it has one (Naboo, D'Qar, Ryloth), else a copy of the surface
      const own = spec.shell ? await bodyGeometry(meshId, 'shell', onStatus) : null;
      const m = add(bill, own || surf, pictureMaterial(L.overlay, U.overlay, T.overlay, { additive: L.overlay.blend === 'add', gain: LU.gain, air: LU }), 3);
      if (!own) shells.push({ mesh: m, slot: 'overlay', base: 1, fallback: 1.002 });
    }
    if (atmosphereOn) {
      if (L.atmosphere.form === 'rim') {
        const m = add(bill, surf, rimMaterial(U.atmosphere, LU, true), 4);
        m.scale.setScalar(+L.atmosphere.height || 1.035);
      } else {
        const hg = await haloGeometry(L.atmosphere.mesh, onStatus);
        if (hg) {
          add(bill, hg, pictureMaterial(L.atmosphere, U.atmosphere, T.atmosphere, { additive: true, gain: LU.gain, air: LU }), 4);
          radius = Math.max(radius, Math.min(1.3, hg.boundingSphere.radius));
        }
      }
    }
  }

  if (L.rings.on && kind !== 'sheet') {
    const parts = await ringGeometry(L.rings.mesh, onStatus);
    if (parts) {
      const fade = RINGS[L.rings.mesh]?.belt;
      for (const g of parts) {
        add(ringSpin, g, pictureMaterial(L.rings, U.rings, T.rings, { side: THREE.DoubleSide, fade: fade && !!g.attributes.color, gain: LU.gain, air: LU }), 5);
        radius = Math.max(radius, g.boundingSphere.radius * (+L.rings.scale || 1));
      }
    }
  }

  // wave 5: a space volume (volume.js), round the body or with none, in the tilted axis
  let vol = null;
  const stateRef = { s: null };
  if (look.generated?.volume && kind === 'sphere' && bakeRenderer) {
    onStatus?.(`Making ${look.name}'s gas`);
    const vset = await acquireVolume(look);
    vol = buildVolume(look.generated, vset, axis, (x, y, z, peak) => { if (flashListener) flashListener(stateRef.s, x, y, z, peak); }, { body: !!L.surface.on });
    radius = Math.max(radius, 1.03 * vol.mesh.scale.x);
  }
  const state = { root, bill, axis, spin, cloudSpin, ringGroup, ringSpin, LU, U, look, radius, keep, textures: T, profile, gen: G, shells, parts, vol, air: AIR, airMode };
  stateRef.s = state;
  // wave 4: a storm clock for a look whose clouds have storm cells (seeded by its name, so each look
  // flashes in its own way), the flashes on a dome's disc or round a sphere
  state.hasClouds = kind !== 'sheet' && !!L.clouds.on && !!(G ? G.clouds : T.clouds);
  if (state.hasClouds && L.clouds.storm?.on) {
    let h = 2166136261;
    for (const ch of String(look.name || 'look')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    state.storms = new Storms(h >>> 0, kind === 'dome');
    state.storms.onFlash = (x, y, z, peak) => { if (flashListener) flashListener(state, x, y, z, peak); };
  }
  if (G || look.generated) builtKeys.set(look, materialKeyOf(look));
  syncLook(state);
  return state;
}

const rectsCache = { promise: null };
async function sheetRects(name) {
  if (!rectsCache.promise) rectsCache.promise = Promise.resolve(window.__textureJSON || null);
  const json = await rectsCache.promise;
  const key = name.replace(/\.png$/, '');
  const e = json?.nightSkyMoons?.[key];
  if (!e) return null;
  return e.moons.filter((m) => m.px > 4000).map((m) => ({ ...m, W: e.size[0], H: e.size[1] }));
}

// Push every slider's value into the uniforms (no rebuild).
export function syncLook(state) {
  const { look, U, LU } = state;
  for (const [slot, layer] of Object.entries(look.layers)) if (U[slot]) syncLayerUniforms(U[slot], layer);
  const A = look.adjust;
  LU.ambient.value = +A.ambient || 0;
  const c = new THREE.Color();
  c.setStyle(A.glow || '#000000'); // linear, added to linear light
  LU.glow.value.set(c.r, c.g, c.b);
  LU.glowStrength.value = +A.glowStrength || 0;
  const gd = look.generated?.dials;
  // (wave A: with its air None, no painted haze toward the limb either)
  LU.haze.value = gd && state.airMode !== 'none' ? +gd.haze || 0 : 0;
  LU.limbDark.value = gd ? +gd.limbDark || 0 : 0;
  LU.dusty.value = gd ? +gd.dusty || 0 : 0;
  LU.veil.value = gd ? +gd.veil || 0 : 0;
  c.setStyle(gd?.veilColour || '#b8a66a'); // linear, as the glow's
  LU.veilColour.value.set(c.r, c.g, c.b, 1);
  const ld = lightDialsOf(look.generated);
  if (ld) {
    c.setStyle(ld.lightColour || '#ffc47a'); LU.lightColour.value.set(c.r, c.g, c.b, 1);
    c.setStyle(ld.glowColour || '#ff8a30'); LU.glowColour.value.set(c.r, c.g, c.b, 1);
    LU.lightBright.value = Number.isFinite(+ld.lightBright) ? +ld.lightBright : 1;
  }
  LU.depthSpread.value = gd && Number.isFinite(+gd.depthSpread) ? +gd.depthSpread : 0.5;
  LU.depthShade.value = gd && Number.isFinite(+gd.depthShade) ? +gd.depthShade : 0.6;
  c.setStyle(blendedLavaColour(look.generated) || '#ff8a30'); // linear, as the city colours
  LU.lavaColour.value.set(c.r, c.g, c.b, 1);
  // At a place, the place's own size sets the scale (placeScale); the look's Size is the preview's.
  const s = state.placeScale ?? (+A.size || 1);
  state.root.scale.setScalar(s);
  if (state.ringGroup) {
    state.ringGroup.rotation.set((+look.layers.rings.tilt || 0) * Math.PI / 180, 0, (+look.layers.rings.roll || 0) * Math.PI / 180);
    state.ringGroup.scale.setScalar(+look.layers.rings.scale || 1);
  }
  // The shells' heights, live (they were set only when the look was built, so they waited for a rebuild or a bake).
  for (const sh of state.shells || []) sh.mesh.scale.setScalar((+look.layers[sh.slot].height || sh.fallback) / sh.base);
  // wave 4: the weather's dials, and where a generated look's spiral storms stand (its bake's own places)
  const cyc = look.generated && look.kind === 'sphere' ? cycloneSites(look.generated, state._cyc || (state._cyc = [])) : null;
  syncWeather(LU.weather, look.layers.clouds, cyc);
  if (state.storms) state.storms.setHints(cyc);
  syncParts(state);
  if (state.vol && look.generated?.volume) syncVolume(state.vol, look.generated);
  syncAir(state);
}

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _z = new THREE.Vector3(0, 0, 1);

// Every frame: face the camera, turn, scroll, and set the light in view space.
// At a place the caller hands over the place's own: `face` (the turn that faces the camera upright
// to the horizon, as the game turns a sky picture), `lightWorld` (the direction the light comes from,
// in the world, for spheres and domes alike), `tilt` and `spin`, and `sphereRadius`: the radius, in the
// world, of the sphere a dome stands for, round the root (its lit layers are shaded as that sphere's
// under `lightWorld`). Left out, the look's own are used (the preview stage): the camera's turn, the
// stage's sun for a sphere, a dome's painted light on the dome's own normals.
const _c = new THREE.Vector3();
export function updateLook(state, { camera, clock, sunWorld, face = null, lightWorld = null, tilt: tiltDeg = null, spin = null, sphereRadius = null }) {
  const { look, LU } = state;
  const A = look.adjust;
  const tilt = ((tiltDeg ?? +A.tilt) || 0) * Math.PI / 180;
  const spinDeg = (spin ?? +A.spin) || 0;
  // the root is never turned, so the billboard's own turn is the camera's (or the place's), rolled by the tilt
  _q.setFromAxisAngle(_z, tilt);
  state.bill.quaternion.copy(face || camera.quaternion).multiply(_q);
  state.axis.rotation.set(0, 0, tilt);
  const turns = (spinDeg * clock) / 360;
  state.spin.rotation.y = turns * Math.PI * 2;
  const cloudTurns = turns * (+look.layers.clouds.spin || 0);
  state.cloudSpin.rotation.y = cloudTurns * Math.PI * 2;
  state.ringSpin.rotation.y = ((+look.layers.rings.spin || 0) * clock / 360) * Math.PI * 2;
  LU.scroll.value = turns;
  LU.cloudScroll.value = cloudTurns;
  LU.clock.value = clock;
  // wave 4: the clouds' motion runs on the weather's clock; the lightning on the wall's
  LU.weather.t.value = weatherClock.motion;
  if (state.storms) {
    const C = look.layers.clouds;
    state.storms.step(weatherClock.wall, !!C.storm?.on, stormDial(C, 'rate', 1), stormDial(C, 'bright', 1.6), stormDial(C, 'spread', 0.07), LU.weather.cells, LU.weather.cellInv);
  }
  const impostor = !!lightWorld && look.kind === 'dome' && sphereRadius > 0;
  LU.sphereN.value = impostor ? 1 : 0;
  if (impostor) {
    state.root.getWorldPosition(_c).applyMatrix4(camera.matrixWorldInverse);
    LU.centre.value.copy(_c);
    LU.sphereR.value = sphereRadius;
  }
  if (lightWorld) {
    _v.copy(lightWorld).transformDirection(camera.matrixWorldInverse);
    LU.light.value.copy(_v);
  } else if (look.kind === 'sphere') {
    _v.copy(sunWorld).transformDirection(camera.matrixWorldInverse);
    LU.light.value.copy(_v);
  } else {
    const a = ((+A.lightAngle || 0) * Math.PI) / 180 + tilt;
    const e = ((+A.lightElev || 0) * Math.PI) / 180;
    LU.light.value.set(Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e));
  }
  // (wave A) the air: where the body is in the view, how many km a scene unit is, the clouds' turn against the ground
  if (state.air) {
    const AU = state.air.U;
    state.root.getWorldPosition(_c).applyMatrix4(camera.matrixWorldInverse);
    AU.centre.value.copy(_c);
    const rb = state.root.getWorldScale(_ws).x || 1;
    AU.kmPer.value = AU.bottom.value / rb;
    AU.bumpH.value = rb * 0.012 * AU.cloudRelief.value;
    const d = state.cloudSpin.rotation.y - state.spin.rotation.y;
    AU.cloudRot.value.set(Math.cos(d), Math.sin(d));
  }
  // which of the parts' rocks are near enough to be drawn as rocks
  if (state.parts) for (const f of state.parts.fields) f.update(camera, bakeRenderer);
  // wave 5: the volume's tier, drift, currents, lightning and the sun in its own frame
  if (state.vol) {
    // (one kept record handed over, so a frame makes nothing)
    const a = volArgs;
    a.motion = weatherClock.motion; a.wall = weatherClock.wall; a.lightWorld = lightWorld || sunWorld;
    a.sunPower = LU.sunPower.value; a.sunColour = LU.sunColour.value; a.gain = LU.gain.value;
    updateVolume(state.vol, a);
  }
}
const volArgs = { motion: 0, wall: 0, lightWorld: null, sunPower: 1, sunColour: null, gain: 1 };
const _ws = new THREE.Vector3();
// (wave A) the air's shell: a finely made sphere (its edge is the air's top, so its facets must not show)
let airShellGeom = null;
function airShellGeometry() { return (airShellGeom ||= new THREE.SphereGeometry(1, 160, 80)); }

export function disposeLook(state) {
  if (!state) return;
  if (state.air) {
    state.air.disposed = true;
    clearTimeout(state.air.pending);
    for (const t of Object.values(state.air.tex)) t.dispose();
    state.air = null;
  }
  if (state.gen) { releaseGenerated(state.gen); state.gen = null; }
  if (state.vol) { disposeVolume(state.vol); releaseVolume(state.vol.set); state.vol = null; }
  if (state.parts) {
    for (const f of state.parts.fields) f.dispose();
    releaseShape(state.parts.shape);
    state.parts.ringProf?.dispose();
    state.parts = null;
  }
  state.root.traverse((o) => {
    if (o.material) o.material.dispose();
    if (o.isLineSegments) o.geometry.dispose();
    if (o.geometry && o.geometry.type === 'PlaneGeometry') o.geometry.dispose();
  });
  state.root.removeFromParent();
}
