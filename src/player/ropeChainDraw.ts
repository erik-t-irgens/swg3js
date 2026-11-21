// The rope chain round, item 3 (maker B): a rope drawn as a chain (`climb.ropeLook` 'chain'). The hook's own ribbon already turns to
// face the view (src/player/grappleDraw.ts: two vertices a ring, the edges' normals bent round the cord so a lit material shades it
// as a cylinder: Half-Life 2's way), so this is that strip again, laid through the curve of the chain's points (src/player/
// ropeCurve.ts) rather than the hook's polyline, at a thickness of its own (`climb.ropeWidth`, never under the hook's `minPx` pixels
// across), with a twisted rope's strands of our own on it: a small picture made here once (`ropeTwistPicture`: three strands'
// bands, slanting across the face, no file of the game's), laid along the rope by each ring's place along it (`climb.ropeLay` a
// turn) and across the strip edge to edge.
//
// One material for every chained rope (`CHAIN_ROPE_MATERIAL`): the hook's rope's colour, roughness and metalness (followed each
// frame they are drawn, so the hook's look dials move both), the picture as its map, and a depth offset toward the view (the
// decals' rule: three turns the factor round under reversed depth and not the units, so the units are turned here), so where it
// lies on something (lifted `climb.ropeLift` off it by the curve) it never flickers into it. The offset is the whole material's:
// a few steps of depth, nothing that shows where the rope hangs in the air. It casts no shadow and writes depth, as the hook's.
// Nothing is built while playing: the player stands one strip of it in its scene hidden from the start (`chainRopeCarrier`), so
// every loading screen's warm-up compiles its program for the world's pass and the rooms' alike, and every rope's strip after is a
// geometry on the material already built. A lay writes kept arrays only and uploads them whole with a draw range.
import * as THREE from 'three';
import { CLIMB_TUNE } from '../anim/climbTune.ts';
import { REVERSED_DEPTH } from '../core/depthMode.ts';
import { GPU } from '../core/gpuSwitch.ts';
import { GRAPPLE_TUNE } from './grapple.ts';
import { GRAPPLE_MATERIAL } from './grappleDraw.ts';
import { CURVE_MOST, type RopeCurve } from './ropeCurve.ts';
import type { HangingRope } from './hangingRope.ts';

/** The depth offset's factor toward the view (a mechanic: one, the slope's own step, as the water mask's geometry takes). */
export const ROPE_DEPTH_FACTOR = -1;
/** And its units, toward the view, turned under reversed depth (a mechanic: two of the depth's least steps, as the marks take). */
export const ROPE_DEPTH_UNITS = REVERSED_DEPTH ? 2 : -2;
/** The twist's picture: texels along a lay and across the strip (a mechanic: enough for three soft bands, small enough to be nothing). */
export const TWIST_ALONG = 64;
export const TWIST_ACROSS = 16;
/** Strands a lay (a mechanic: a three-strand rope's). */
export const TWIST_STRANDS = 3;

/**
 * The twist's picture, made once: each texel's shade by where it falls across a strand (`TWIST_STRANDS` a lay along, a strand
 * advancing half a lay as it crosses the visible half of the rope edge to edge, so the bands slant as a laid rope's do), a strand's
 * crown light and the grooves between strands dark. Grey, in sRGB, laid over the rope's own colour.
 */
export function ropeTwistPicture(): Uint8Array {
  const out = new Uint8Array(TWIST_ALONG * TWIST_ACROSS * 4);
  for (let j = 0; j < TWIST_ACROSS; j++) {
    const v = (j + 0.5) / TWIST_ACROSS;
    for (let i = 0; i < TWIST_ALONG; i++) {
      const u = (i + 0.5) / TWIST_ALONG;
      const p = TWIST_STRANDS * (u + 0.5 * v);
      const f = p - Math.floor(p);
      // A strand's round crown, light in its middle, falling to the groove at its edges.
      const crown = Math.pow(Math.sin(Math.PI * f), 0.7);
      const shade = 0.42 + 0.58 * crown;
      const b = Math.round(255 * shade);
      const k = 4 * (j * TWIST_ALONG + i);
      out[k] = b;
      out[k + 1] = b;
      out[k + 2] = b;
      out[k + 3] = 255;
    }
  }
  return out;
}

/** The twist's picture as a texture, made once: repeated along the rope, held across it, mipmapped. */
function twistTexture(): THREE.DataTexture {
  const t = new THREE.DataTexture(ropeTwistPicture(), TWIST_ALONG, TWIST_ACROSS, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.name = 'climbing rope twist';
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** The one material every rope drawn as a chain is drawn with (see the file). */
export const CHAIN_ROPE_MATERIAL = new THREE.MeshStandardMaterial({
  map: twistTexture(),
  color: GRAPPLE_TUNE.ropeColour,
  roughness: GRAPPLE_TUNE.ropeRoughness,
  metalness: GRAPPLE_TUNE.ropeMetalness,
  polygonOffset: true,
  polygonOffsetFactor: ROPE_DEPTH_FACTOR,
  // Three turns the factor round under reversed depth but not the units, which would then push the rope away instead of forward (WebGLState.setPolygonOffset): so the units turn round here.
  polygonOffsetUnits: ROPE_DEPTH_UNITS,
});
CHAIN_ROPE_MATERIAL.name = 'climbing rope';

/** The material's look as the hook's rope's (its colour, roughness, metalness: uniforms only), written where it moved. */
export function followHookLook(): void {
  const m = CHAIN_ROPE_MATERIAL;
  const h = GRAPPLE_MATERIAL;
  if (!m.color.equals(h.color)) m.color.copy(h.color);
  if (m.roughness !== h.roughness) m.roughness = h.roughness;
  if (m.metalness !== h.metalness) m.metalness = h.metalness;
}

/** A rope's strip as a chain: kept arrays sized once for the most rings a curve lays, a draw range for the rings used. */
export class ChainRibbon {
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly nrm: Float32Array;
  private readonly uv: Float32Array;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly nrmAttr: THREE.BufferAttribute;
  private readonly uvAttr: THREE.BufferAttribute;
  rings = 0;
  /** The screen's height in pixels for the next `lay` (a field, as the hook's ribbon keeps it: a number handed across a call is made anew). */
  screenH = 1080;
  /**
   * The widest the last lay drew a ring, metres, how many of its knots were lifted off a surface, and how many hands it passes through
   * (the console's). (The fractions start as fractions and are put to nought in the constructor: a field begun as a small integer
   * boxes every fraction written into it after.)
   */
  widest = 0.5;
  lifted = 0;
  hands = 0;

  constructor() {
    const max = CURVE_MOST;
    this.pos = new Float32Array(max * 2 * 3);
    this.nrm = new Float32Array(max * 2 * 3);
    this.uv = new Float32Array(max * 2 * 2);
    const quads = max - 1;
    const index = max * 2 > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
    for (let i = 0; i < quads; i++) {
      const l0 = 2 * i;
      const r0 = 2 * i + 1;
      const l1 = 2 * i + 2;
      const r1 = 2 * i + 3;
      // As the hook's: counter-clockwise from the camera whatever way the rope runs.
      index[6 * i] = l0;
      index[6 * i + 1] = r0;
      index[6 * i + 2] = l1;
      index[6 * i + 3] = r0;
      index[6 * i + 4] = r1;
      index[6 * i + 5] = l1;
    }
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.nrmAttr = new THREE.BufferAttribute(this.nrm, 3);
    this.uvAttr = new THREE.BufferAttribute(this.uv, 2);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.nrmAttr.setUsage(THREE.DynamicDrawUsage);
    this.uvAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('normal', this.nrmAttr);
    g.setAttribute('uv', this.uvAttr);
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, CHAIN_ROPE_MATERIAL);
    this.mesh.name = 'climbing rope';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    this.widest = 0;
    this.handOff = 0;
    // On WebGPU the motion output is handed each vertex's change since the last frame (pass 1, wave 5): it is laid here, in place.
    if (GPU.webgpu) GPU.rt!.motion.laid(this.mesh, this.pos);
  }

  /** How far the strip's rings at the hands stood from the hands as drawn at the last lay, metres (`drawChained`'s; the console's). */
  handOff = 0.5;

  /** Nothing drawn. */
  hide(): void {
    this.mesh.visible = false;
    this.rings = 0;
    this.handOff = 0;
  }

  /**
   * `handOff`: the farther of rings `ia` and `ib`'s middles, as uploaded, from the hands `a` and `b` (three numbers each); nought with
   * no hand (`ia` -1). Written into the field and never handed back (a number handed back across a call not built in is made anew).
   */
  measureHands(ia: number, ib: number, a: Float64Array, b: Float64Array): void {
    if (ia < 0) {
      this.handOff = 0;
      return;
    }
    const pos = this.pos;
    let dx = (pos[6 * ia] + pos[6 * ia + 3]) / 2 - a[0];
    let dy = (pos[6 * ia + 1] + pos[6 * ia + 4]) / 2 - a[1];
    let dz = (pos[6 * ia + 2] + pos[6 * ia + 5]) / 2 - a[2];
    const da = dx * dx + dy * dy + dz * dz;
    dx = (pos[6 * ib] + pos[6 * ib + 3]) / 2 - b[0];
    dy = (pos[6 * ib + 1] + pos[6 * ib + 4]) / 2 - b[1];
    dz = (pos[6 * ib + 2] + pos[6 * ib + 5]) / 2 - b[2];
    const db = dx * dx + dy * dy + dz * dz;
    this.handOff = Math.sqrt(da > db ? da : db);
  }

  /**
   * Lay the strip through `curve`'s rings, turned to `camera`: each ring's two vertices across the view (the curve's tangent crossed
   * with the way to the camera), `climb.ropeWidth` apart or the hook's least pixels on a screen `screenH` tall; the edges' normals
   * bent round the cord; the twist's picture along by each ring's place along the rope over `climb.ropeLay`, across edge to edge.
   * Writes kept arrays only.
   */
  lay(curve: RopeCurve, camera: THREE.PerspectiveCamera): void {
    const n = curve.count;
    const R = curve.ring;
    const A = curve.along;
    // (`ribbonWidth`'s arithmetic written out: its answer handed back across a call would be a number made each ring.)
    const ropeW = CLIMB_TUNE.ropeWidth;
    const screenH = this.screenH > 1 ? this.screenH : 1;
    const perM = (2 * Math.tan((camera.fov * Math.PI) / 360) * GRAPPLE_TUNE.minPx) / screenH;
    const lay = CLIMB_TUNE.ropeLay > 1e-3 ? CLIMB_TUNE.ropeLay : 1e-3;
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    const pos = this.pos;
    const nrm = this.nrm;
    const uv = this.uv;
    let widest = 0;
    for (let i = 0; i < n; i++) {
      const a = i > 0 ? i - 1 : 0;
      const b = i < n - 1 ? i + 1 : n - 1;
      let tx = R[3 * b] - R[3 * a];
      let ty = R[3 * b + 1] - R[3 * a + 1];
      let tz = R[3 * b + 2] - R[3 * a + 2];
      let tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (!(tl > 0)) tl = 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      const x = R[3 * i];
      const y = R[3 * i + 1];
      const z = R[3 * i + 2];
      let vx = cx - x;
      let vy = cy - y;
      let vz = cz - z;
      let dist = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (!(dist > 0)) dist = 1;
      vx /= dist;
      vy /= dist;
      vz /= dist;
      // Across the view: the tangent crossed with the way to the camera.
      let sx = ty * vz - tz * vy;
      let sy = tz * vx - tx * vz;
      let sz = tx * vy - ty * vx;
      const sl = Math.sqrt(sx * sx + sy * sy + sz * sz);
      if (sl < 1e-9) {
        sx = 1;
        sy = 0;
        sz = 0;
      } else {
        sx /= sl;
        sy /= sl;
        sz /= sl;
      }
      const least = perM * dist;
      const width = least > ropeW ? least : ropeW;
      if (width > widest) widest = width;
      const half = width * 0.5;
      const j = 6 * i;
      pos[j] = x - sx * half;
      pos[j + 1] = y - sy * half;
      pos[j + 2] = z - sz * half;
      pos[j + 3] = x + sx * half;
      pos[j + 4] = y + sy * half;
      pos[j + 5] = z + sz * half;
      // The edges' normals bent out round the cord, toward the camera between them: a cylinder's shading.
      let lx = vx - sx;
      let ly = vy - sy;
      let lz = vz - sz;
      let ll = Math.sqrt(lx * lx + ly * ly + lz * lz);
      if (!(ll > 0)) ll = 1;
      lx /= ll;
      ly /= ll;
      lz /= ll;
      let rx = vx + sx;
      let ry = vy + sy;
      let rz = vz + sz;
      let rl = Math.sqrt(rx * rx + ry * ry + rz * rz);
      if (!(rl > 0)) rl = 1;
      rx /= rl;
      ry /= rl;
      rz /= rl;
      nrm[j] = lx;
      nrm[j + 1] = ly;
      nrm[j + 2] = lz;
      nrm[j + 3] = rx;
      nrm[j + 4] = ry;
      nrm[j + 5] = rz;
      // The twist: along by the ring's place along the rope, a lay a repeat; across, edge to edge.
      const u = A[i] / lay;
      const k = 4 * i;
      uv[k] = u;
      uv[k + 1] = 0;
      uv[k + 2] = u;
      uv[k + 3] = 1;
    }
    this.rings = n;
    this.widest = widest;
    this.lifted = curve.lifted;
    this.hands = curve.gripA < 0 ? 0 : curve.gripB !== curve.gripA ? 2 : 1;
    this.posAttr.needsUpdate = true;
    this.nrmAttr.needsUpdate = true;
    this.uvAttr.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, n > 1 ? (n - 1) * 6 : 0);
    this.mesh.visible = n > 1;
  }
}

/**
 * One rope drawn as a chain this frame, as the player's `drawRopes` and the node harness both draw it: its chain's drawn points
 * (laid this frame by `RopeChains.frame`) laid as a curve through `curve` (one kept for every rope, laid in turn) and `strip` turned
 * to `camera` through it, on a screen `screenH` pixels tall. False, and the strip hidden, where the rope has no chain drawn (not yet
 * laid, or under 'straight'): it is then drawn as phase 4 drew it.
 */
export function drawChained(r: HangingRope, strip: ChainRibbon, curve: RopeCurve, camera: THREE.PerspectiveCamera, screenH: number): boolean {
  const c = r.chain;
  if (!c || !c.live || c.drawCount < 2) {
    if (strip.mesh.visible) strip.hide();
    return false;
  }
  curve.lay(c);
  strip.screenH = screenH;
  strip.lay(curve, camera);
  // How far the strip's rings at the hands stand from the hands as drawn (the rig's, where a body holds it), as uploaded: the console's word.
  strip.measureHands(curve.gripA, curve.gripB, c.handA, c.handB);
  return true;
}

/**
 * The strip the player stands in its scene hidden from the start, never laid: so every loading screen's warm-up finds the chained
 * rope's material on a mesh of its own shape and compiles its program, and no rope stood later (the course's, the console's) builds
 * one on a live frame.
 */
export function chainRopeCarrier(): THREE.Mesh {
  const r = new ChainRibbon();
  r.mesh.name = 'climbing rope (warm-up)';
  return r.mesh;
}
