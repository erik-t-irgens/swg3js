// What the grapple draws: the rope as a lit ribbon laid on the CPU every frame, and the dart. Both stand on
// one shared `MeshStandardMaterial` that every rope in the game uses, built once with the player and hidden,
// so the ordinary warm-up compiles them for the world's pass and the rooms' alike and nothing is ever built
// on a live frame (the design's §3.12).
//
// The ribbon is the polyline (anchor, bends, hand) laid into kept arrays, two vertices a ring, turned toward
// the camera with its two edge normals bent out round the cord so a lit material shades it as a cylinder. It
// is held to at least `minPx` pixels across, because a 2 cm cord is one pixel at 19 m on 1080 lines and would
// vanish and twinkle further off. Fixed spans are straight (a rope bends round an edge only while pulled);
// the free span is hung by the constraint's own slack, never by where the drawn hand happens to be, and drawn
// straight inside the taut band. It is uploaded whole with a draw range, never with an upload range pushed:
// a buffer refilled every frame and not always drawn grows three's list of ranges without end.
//
// Neither casts a shadow (a third of a texel would cast a crawling dotted line, and a depth program would
// be one more to warm), and both stay opaque and depth-writing, out of the movers the motion blur draws.
import * as THREE from 'three';
import { GRAPPLE_TUNE, setGrappleLook } from './grapple.ts';
import { len3, ribbonWidth, sagOf } from './grappleMath.ts';

/** The one material every rope and dart in the game is drawn with. Its colour, roughness and metalness are uniforms: tuning them builds nothing. */
export const GRAPPLE_MATERIAL = new THREE.MeshStandardMaterial({ color: GRAPPLE_TUNE.ropeColour, roughness: GRAPPLE_TUNE.ropeRoughness, metalness: GRAPPLE_TUNE.ropeMetalness });
GRAPPLE_MATERIAL.name = 'grapple rope';

setGrappleLook(() => {
  GRAPPLE_MATERIAL.color.setHex(GRAPPLE_TUNE.ropeColour);
  GRAPPLE_MATERIAL.roughness = GRAPPLE_TUNE.ropeRoughness;
  GRAPPLE_MATERIAL.metalness = GRAPPLE_TUNE.ropeMetalness;
});

/** The ribbon: kept arrays sized once for the most rings a rope can have, a draw range for the rings used. */
export class RopeRibbon {
  readonly mesh: THREE.Mesh;
  readonly maxRings: number;
  private readonly sagSegments: number;
  private readonly pos: Float32Array;
  private readonly nrm: Float32Array;
  private readonly posAttr: THREE.BufferAttribute;
  private readonly nrmAttr: THREE.BufferAttribute;
  /** The rings' centres for this frame, laid before the vertices. */
  private readonly ring: Float64Array;
  rings = 0;

  /** `maxPoints` is the most rope points (anchor and bends) a rope keeps; the free span adds `sagSegments`. */
  constructor(maxPoints: number, sagSegments: number) {
    this.sagSegments = Math.max(1, Math.round(sagSegments));
    this.maxRings = maxPoints + this.sagSegments + 2;
    this.pos = new Float32Array(this.maxRings * 2 * 3);
    this.nrm = new Float32Array(this.maxRings * 2 * 3);
    this.ring = new Float64Array(this.maxRings * 3);
    const quads = this.maxRings - 1;
    const index = this.maxRings * 2 > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
    for (let i = 0; i < quads; i++) {
      const l0 = 2 * i;
      const r0 = 2 * i + 1;
      const l1 = 2 * i + 2;
      const r1 = 2 * i + 3;
      // Counter-clockwise from the camera whatever way the rope runs: each ring's side is the tangent across the view.
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
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.nrmAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('normal', this.nrmAttr);
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, GRAPPLE_MATERIAL);
    this.mesh.name = 'grapple rope';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
  }

  /** Nothing drawn. */
  hide(): void {
    this.mesh.visible = false;
    this.rings = 0;
  }

  /**
   * The free span's slack and the screen's height in pixels for the next `lay`, written by the caller: a number
   * handed as an argument to a call that is not inlined is a fresh number each frame, and a field is not.
   */
  slack = 0.5;
  screenH = 1080;

  /**
   * Lay the rope: `fixed` holds `count` world points (the anchor, then each bend, the last of them the pivot),
   * and the free span runs from the pivot to the drawn `hand`, sagging by `slack` past the taut band. Turned to
   * `camera`, at least `minPx` across on a screen `screenH` pixels tall. Writes kept arrays only.
   */
  lay(fixed: Float64Array, count: number, hand: { x: number; y: number; z: number }, camera: THREE.PerspectiveCamera): void {
    const T = GRAPPLE_TUNE;
    const hx = hand.x;
    const hy = hand.y;
    const hz = hand.z;
    const slack = this.slack;
    const screenH = this.screenH;
    const ring = this.ring;
    const maxFixed = this.maxRings - this.sagSegments - 1;
    const nFixed = Math.max(1, Math.min(count, maxFixed));
    let n = 0;
    for (let i = 0; i < nFixed; i++) {
      ring[3 * n] = fixed[3 * i];
      ring[3 * n + 1] = fixed[3 * i + 1];
      ring[3 * n + 2] = fixed[3 * i + 2];
      n++;
    }
    // The free span, from the pivot to the hand: straight inside the taut band, else a shallow parabola.
    const px = ring[3 * (n - 1)];
    const py = ring[3 * (n - 1) + 1];
    const pz = ring[3 * (n - 1) + 2];
    const span = len3(hx - px, hy - py, hz - pz);
    const sag = sagOf(span, slack - T.tautBand);
    const segs = sag > 1e-4 ? this.sagSegments : 1;
    for (let s = 1; s <= segs; s++) {
      const t = s / segs;
      ring[3 * n] = px + (hx - px) * t;
      ring[3 * n + 1] = py + (hy - py) * t - 4 * sag * t * (1 - t);
      ring[3 * n + 2] = pz + (hz - pz) * t;
      n++;
    }
    this.rings = n;
    const cx = camera.position.x;
    const cy = camera.position.y;
    const cz = camera.position.z;
    const fov = camera.fov;
    const pos = this.pos;
    const nrm = this.nrm;
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      let tx = ring[3 * b] - ring[3 * a];
      let ty = ring[3 * b + 1] - ring[3 * a + 1];
      let tz = ring[3 * b + 2] - ring[3 * a + 2];
      const tl = len3(tx, ty, tz) || 1;
      tx /= tl;
      ty /= tl;
      tz /= tl;
      const x = ring[3 * i];
      const y = ring[3 * i + 1];
      const z = ring[3 * i + 2];
      let vx = cx - x;
      let vy = cy - y;
      let vz = cz - z;
      const dist = len3(vx, vy, vz) || 1;
      vx /= dist;
      vy /= dist;
      vz /= dist;
      // Across the view: the tangent crossed with the way to the camera.
      let sx = ty * vz - tz * vy;
      let sy = tz * vx - tx * vz;
      let sz = tx * vy - ty * vx;
      const sl = len3(sx, sy, sz);
      if (sl < 1e-9) {
        sx = 1;
        sy = 0;
        sz = 0;
      } else {
        sx /= sl;
        sy /= sl;
        sz /= sl;
      }
      const half = ribbonWidth(dist, fov, screenH, T) * 0.5;
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
      const ll = len3(lx, ly, lz) || 1;
      lx /= ll;
      ly /= ll;
      lz /= ll;
      let rx = vx + sx;
      let ry = vy + sy;
      let rz = vz + sz;
      const rl = len3(rx, ry, rz) || 1;
      rx /= rl;
      ry /= rl;
      rz /= rl;
      nrm[j] = lx;
      nrm[j + 1] = ly;
      nrm[j + 2] = lz;
      nrm[j + 3] = rx;
      nrm[j + 4] = ry;
      nrm[j + 5] = rz;
    }
    this.posAttr.needsUpdate = true;
    this.nrmAttr.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, Math.max(0, n - 1) * 6);
    this.mesh.visible = n > 1;
  }
}

/** One geometry of several, their triangles laid end to end (positions and normals; no index). */
function joinGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of flat) total += g.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  let at = 0;
  for (const g of flat) {
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const n = g.getAttribute('normal') as THREE.BufferAttribute;
    pos.set(p.array as Float32Array, at * 3);
    nrm.set(n.array as Float32Array, at * 3);
    at += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return out;
}

/**
 * The dart, ours: a head of three prongs `dartSize` long along its own +Z, merged into one geometry on the
 * rope's material, so it costs no program of its own. Built with the player, hidden.
 */
export function dartMesh(size = GRAPPLE_TUNE.dartSize): THREE.Mesh {
  const s = Math.max(0.02, size);
  const shaft = new THREE.CylinderGeometry(s * 0.07, s * 0.07, s, 6).rotateX(Math.PI / 2);
  const head = new THREE.ConeGeometry(s * 0.16, s * 0.3, 6).rotateX(Math.PI / 2).translate(0, 0, s * 0.62);
  const parts = [shaft, head];
  for (let i = 0; i < 3; i++) {
    // Each prong leans back from the head and out, a third of a turn apart.
    const prong = new THREE.CylinderGeometry(s * 0.035, s * 0.05, s * 0.45, 4).translate(0, s * 0.225, 0);
    prong.rotateX(Math.PI * 0.8);
    prong.rotateZ((i * 2 * Math.PI) / 3);
    prong.translate(0, 0, s * 0.45);
    parts.push(prong);
  }
  const g = joinGeometries(parts);
  for (const p of parts) p.dispose();
  const m = new THREE.Mesh(g, GRAPPLE_MATERIAL);
  m.name = 'grapple dart';
  m.frustumCulled = false;
  m.castShadow = false;
  m.receiveShadow = true;
  m.visible = false;
  return m;
}
