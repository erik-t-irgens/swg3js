// Climbing II, Smoothness II, item 3 (`climb.bodyClear` 'spheres'; the owner, 2026-11-17: "when shimmying takes me around a
// corner, even a sharp corner, my body tends to phase through the wall. Maybe we can try to find a way to prevent my body
// clipping through anything using the mesh as either a collider or a guide"), and item 4's head (`move.duckHead` 'clear').
//
// The posed figure carries sixteen spheres on its bones: the head, the neck, the chest, the pelvis, each upper and lower arm
// and leg, the hands and the feet. Each is measured once from the rest mesh's own vertices (`measureSpheres`, at load: the
// vertices whose heaviest joint belongs to the part): a limb's middle is the middle of its bone's own segment and its
// radius how far its vertices stand from that segment, any other part's middle the mean of its vertices and its radius how
// far they stand from it (`SPHERE_SHARE` of them inside: the body's own surface, not its farthest knuckle). So the guide is
// the mesh, as the owner asked, and nothing of the figure's shape is typed.
//
// A frame of it (`BodySpheres`, the player's and the harness's alike): the spheres placed where the posed bones put them
// (`sample`), each asked of what stands still (one ball a sphere, a second only where the first met something, through the
// engine's query flags; a hand or a foot planted on a lip or a face skipped, its contact allowed), and the figure's root
// pushed out along each met thing's own face by enough to clear the deepest (`clearOut`): at once where it must go further
// out, eased back in as the need falls away (`clearEase`), never past `clearMost`. Nothing here makes an object on a frame:
// the engine's own answers are the only things made.
//
// Pure of the page: it names three, the engine's types and nothing of the game, so node runs it on the real Rapier.
import * as THREE from 'three';
import type { RAPIER } from '../core/physics.ts';

/** The parts, in this order everywhere: their joints (each owning every joint under it no other part names), and a limb's end. */
export const SPHERE_PARTS: readonly { readonly id: string; readonly own: readonly string[]; readonly end?: string; readonly flat?: boolean }[] = [
  { id: 'head', own: ['Head'] },
  { id: 'neck', own: ['neck'] },
  { id: 'chest', own: ['spine3', 'spine2', 'lClav', 'rClav'], flat: true },
  { id: 'pelvis', own: ['root', 'spine1'], flat: true },
  { id: 'lUpperArm', own: ['lArm'], end: 'lForeArm' },
  { id: 'lLowerArm', own: ['lForeArm', 'lUlna'], end: 'lWrist' },
  { id: 'lHand', own: ['lWrist'] },
  { id: 'rUpperArm', own: ['rArm'], end: 'rForeArm' },
  { id: 'rLowerArm', own: ['rForeArm', 'rUlna'], end: 'rWrist' },
  { id: 'rHand', own: ['rWrist'] },
  { id: 'lThigh', own: ['lThigh'], end: 'lShin' },
  { id: 'lShin', own: ['lShin'], end: 'lAnkle' },
  { id: 'lFoot', own: ['lAnkle', 'lToe'] },
  { id: 'rThigh', own: ['rThigh'], end: 'rShin' },
  { id: 'rShin', own: ['rShin'], end: 'rAnkle' },
  { id: 'rFoot', own: ['rAnkle', 'rToe'] },
];
export const SPHERE_COUNT = SPHERE_PARTS.length;
/** The parts' indices the callers ask by. */
export const SPH_HEAD = 0;
export const SPH_NECK = 1;
export const SPH_CHEST = 2;
export const SPH_L_HAND = 6;
export const SPH_R_HAND = 9;
export const SPH_L_FOOT = 12;
export const SPH_R_FOOT = 15;

/**
 * The share of a part's own vertices a sphere's radius holds (mechanics, not feel: 0.7, so the sphere is the part's own
 * surface, its bulk inside, and neither its farthest knuckle nor a chest's shoulders, which a sphere about its middle would
 * otherwise reach past the chest's front and back).
 */
export const SPHERE_SHARE = 0.7;

/** One part's sphere as measured: its anchor joint, its middle in that joint's bind frame, its radius in the bind's units. */
export interface SpherePart {
  readonly id: string;
  readonly anchor: string;
  /** The middle in the anchor joint's own bind frame. */
  readonly at: readonly [number, number, number];
  readonly radius: number;
  /** The anchor joint's bind frame's own scale (its radius is divided by it, so a scaled figure's spheres scale with it). */
  readonly bindScale: number;
  /** How many vertices it was measured from (nought: no sphere). */
  readonly vertices: number;
}

/** What the measure reads: the rest mesh in its own space, each vertex's heaviest joint, and the joints' bind frames there. */
export interface SphereSource {
  /** Vertex places, three a vertex, in the mesh's own (bind) space. */
  readonly positions: ArrayLike<number>;
  /** Each vertex's heaviest joint (an index into `names`), -1 for none. */
  readonly joint: ArrayLike<number>;
  readonly names: readonly string[];
  /** Each joint's parent (-1 for none). */
  readonly parents: readonly number[];
  /** Each joint's bind frame in the mesh's space (its inverse bind's inverse), sixteen column-major numbers a joint. */
  readonly bind: ArrayLike<number>;
}

/**
 * The share of a flat part's vertices (the chest, the pelvis) its radius holds along its thinnest way (mechanics: 0.9, so the
 * sphere's front and back are the chest's and the back's own surfaces).
 */
export const FLAT_SHARE = 0.9;

const SHARE_FLOOR = 8;
/** A face whose normal stands within this of square to the push's way asks nothing of it (mechanics: a cosine of 0.3, about 73 degrees: past it the push along the way to clear it would be more than three times its depth). */
const AXIS_LEAST = 0.3;

/** The unit axis a part's vertices spread least along about `mid` (the smallest eigenvector of their spread, Jacobi's turns). */
function thinnestAxis(pos: ArrayLike<number>, vs: readonly number[], mid: THREE.Vector3): THREE.Vector3 {
  const c = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const v of vs) {
    const x = pos[v * 3] - mid.x;
    const y = pos[v * 3 + 1] - mid.y;
    const z = pos[v * 3 + 2] - mid.z;
    c[0] += x * x;
    c[1] += x * y;
    c[2] += x * z;
    c[4] += y * y;
    c[5] += y * z;
    c[8] += z * z;
  }
  c[3] = c[1];
  c[6] = c[2];
  c[7] = c[5];
  const V = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 32; sweep++) {
    let p = 0;
    let q = 1;
    let big = Math.abs(c[1]);
    if (Math.abs(c[2]) > big) {
      big = Math.abs(c[2]);
      p = 0;
      q = 2;
    }
    if (Math.abs(c[5]) > big) {
      big = Math.abs(c[5]);
      p = 1;
      q = 2;
    }
    if (big < 1e-12) break;
    const app = c[p * 3 + p];
    const aqq = c[q * 3 + q];
    const apq = c[p * 3 + q];
    const th = 0.5 * Math.atan2(2 * apq, aqq - app);
    const cs = Math.cos(th);
    const sn = Math.sin(th);
    for (let k = 0; k < 3; k++) {
      const akp = c[k * 3 + p];
      const akq = c[k * 3 + q];
      c[k * 3 + p] = cs * akp - sn * akq;
      c[k * 3 + q] = sn * akp + cs * akq;
    }
    for (let k = 0; k < 3; k++) {
      const apk = c[p * 3 + k];
      const aqk = c[q * 3 + k];
      c[p * 3 + k] = cs * apk - sn * aqk;
      c[q * 3 + k] = sn * apk + cs * aqk;
    }
    for (let k = 0; k < 3; k++) {
      const vkp = V[k * 3 + p];
      const vkq = V[k * 3 + q];
      V[k * 3 + p] = cs * vkp - sn * vkq;
      V[k * 3 + q] = sn * vkp + cs * vkq;
    }
  }
  let least = 0;
  if (c[4] < c[least * 3 + least]) least = 1;
  if (c[8] < c[least * 3 + least]) least = 2;
  return new THREE.Vector3(V[least], V[3 + least], V[6 + least]).normalize();
}

/** The sphere set measured off one rest mesh (or several, their vertices handed in together). */
export function measureSpheres(src: SphereSource): SpherePart[] {
  const n = src.names.length;
  // Each joint's part: itself or its nearest ancestor some part owns.
  const own = new Int32Array(n).fill(-1);
  const byName = new Map<string, number>();
  src.names.forEach((nm, i) => byName.set(nm, i));
  SPHERE_PARTS.forEach((p, k) => {
    for (const nm of p.own) {
      const j = byName.get(nm);
      if (j !== undefined) own[j] = k;
    }
  });
  const partOf = new Int32Array(n).fill(-1);
  for (let j = 0; j < n; j++) {
    for (let a = j, guard = 0; a >= 0 && guard < 256; a = src.parents[a], guard++) {
      if (own[a] >= 0) {
        partOf[j] = own[a];
        break;
      }
    }
  }
  const bindOf = (j: number): THREE.Matrix4 => new THREE.Matrix4().fromArray(src.bind as number[], j * 16);
  const nv = Math.floor(src.positions.length / 3);
  const lists: number[][] = SPHERE_PARTS.map(() => []);
  for (let v = 0; v < nv; v++) {
    const j = src.joint[v];
    if (!(j >= 0 && j < n)) continue;
    const k = partOf[j];
    if (k >= 0) lists[k].push(v);
  }
  const out: SpherePart[] = [];
  const p = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const ab = new THREE.Vector3();
  SPHERE_PARTS.forEach((part, k) => {
    const anchorName = part.own.find((nm) => byName.has(nm)) ?? part.own[0];
    const ai = byName.get(anchorName);
    const vs = lists[k];
    if (ai === undefined || vs.length < SHARE_FLOOR) {
      out.push({ id: part.id, anchor: anchorName, at: [0, 0, 0], radius: 0, bindScale: 1, vertices: 0 });
      return;
    }
    const A = bindOf(ai);
    const bindScale = new THREE.Vector3().setFromMatrixColumn(A, 0).length();
    const inv = A.clone().invert();
    const mid = new THREE.Vector3();
    const dist: number[] = [];
    const ei = part.end ? byName.get(part.end) : undefined;
    if (ei !== undefined) {
      // A limb: its segment from its own joint to its end's, its vertices' distance from it.
      a.setFromMatrixPosition(A);
      b.setFromMatrixPosition(bindOf(ei));
      ab.subVectors(b, a);
      const len2 = ab.lengthSq();
      mid.addVectors(a, b).multiplyScalar(0.5);
      for (const v of vs) {
        p.fromArray(src.positions as number[], v * 3);
        let t = len2 > 0 ? p.clone().sub(a).dot(ab) / len2 : 0;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        dist.push(p.distanceTo(a.clone().addScaledVector(ab, t)));
      }
    } else {
      for (const v of vs) mid.add(p.fromArray(src.positions as number[], v * 3));
      mid.multiplyScalar(1 / vs.length);
      if (part.flat) {
        // The torso is wide and shallow: a sphere as wide as its shoulders would stand well out of its chest and back, so its
        // radius is its thinnest way's (the vertices' spread along the axis they spread least along: front to back).
        const ax = thinnestAxis(src.positions, vs, mid);
        for (const v of vs) {
          p.fromArray(src.positions as number[], v * 3).sub(mid);
          const d = p.dot(ax);
          dist.push(d < 0 ? -d : d);
        }
      } else for (const v of vs) dist.push(p.fromArray(src.positions as number[], v * 3).distanceTo(mid));
    }
    dist.sort((x, y) => x - y);
    const share = part.flat ? FLAT_SHARE : SPHERE_SHARE;
    const radius = dist[Math.min(dist.length - 1, Math.floor(dist.length * share))];
    const at = mid.applyMatrix4(inv);
    out.push({ id: part.id, anchor: anchorName, at: [at.x, at.y, at.z], radius, bindScale, vertices: vs.length });
  });
  return out;
}

/** The measure's source from three's own skinned meshes (the body's, sharing one skeleton): their rest vertices and bind frames. */
export function sphereSourceOf(meshes: readonly THREE.SkinnedMesh[]): SphereSource | null {
  const first = meshes.find((m) => m.skeleton && m.geometry.getAttribute('position'));
  if (!first) return null;
  const bones = first.skeleton.bones;
  const names = bones.map((b) => b.name);
  const index = new Map<THREE.Bone, number>();
  bones.forEach((b, i) => index.set(b, i));
  const parents = bones.map((b) => (b.parent && index.has(b.parent as THREE.Bone) ? index.get(b.parent as THREE.Bone)! : -1));
  const bind = new Float64Array(bones.length * 16);
  const m = new THREE.Matrix4();
  first.skeleton.boneInverses.forEach((inv, i) => {
    m.copy(inv).invert();
    for (let e = 0; e < 16; e++) bind[i * 16 + e] = m.elements[e];
  });
  const pos: number[] = [];
  const joint: number[] = [];
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    const g = mesh.geometry;
    const P = g.getAttribute('position');
    const J = g.getAttribute('skinIndex');
    const W = g.getAttribute('skinWeight');
    if (!P || !J || !W || !mesh.skeleton) continue;
    // A mesh on another skeleton's order is read through its own bones' names.
    const own = mesh.skeleton.bones.map((b) => names.indexOf(b.name));
    for (let i = 0; i < P.count; i++) {
      let best = -1;
      let bw = 0;
      for (let c = 0; c < 4; c++) {
        const w = W.getComponent(i, c);
        if (w > bw) {
          bw = w;
          best = J.getComponent(i, c);
        }
      }
      // Into the bind's own space (three's skinning reads a bone's inverse bind against the bind matrix's carry of the vertex).
      v.fromBufferAttribute(P, i).applyMatrix4(mesh.bindMatrix);
      pos.push(v.x, v.y, v.z);
      joint.push(best >= 0 && best < own.length ? own[best] : -1);
    }
  }
  return { positions: pos, joint, names, parents, bind };
}

/** The little of a physics world the spheres ask (rapier's `World`). */
export interface SphereWorld {
  intersectionWithShape(shapePos: { x: number; y: number; z: number }, shapeRot: { x: number; y: number; z: number; w: number }, shape: RAPIER.Shape, filterFlags?: RAPIER.QueryFilterFlags, filterGroups?: number, filterExcludeCollider?: RAPIER.Collider): RAPIER.Collider | null;
}

/** The engine's ball maker and its kept contact, handed in once (so this file loads under node with no engine of its own). */
export interface SphereMakers {
  ball(radius: number): RAPIER.Shape;
  contact(): RAPIER.ShapeContact;
}

/** The little of a rig the spheres read: its root and a bone by name. */
export interface SphereRig {
  readonly root: THREE.Object3D;
  boneNamed(name: string): THREE.Bone | null;
}

const MAX_HITS = 32;

/**
 * The figure's spheres for one rig, placed and asked every frame they are wanted. Every number goes through a kept field or
 * array (no number crosses a call), and the engine's answers are the only things made.
 */
export class BodySpheres {
  /** The measured parts (empty until `use`). */
  parts: SpherePart[] = [];
  /** Each sphere's middle in the world, and its radius (scaled with the figure), as `sample` last left them. */
  readonly cx = new Float64Array(SPHERE_COUNT);
  readonly cy = new Float64Array(SPHERE_COUNT);
  readonly cz = new Float64Array(SPHERE_COUNT);
  readonly r = new Float64Array(SPHERE_COUNT);
  /** Whether each sphere stands (a part measured and its bone found). */
  readonly on = new Uint8Array(SPHERE_COUNT);
  /** Each sphere's deepest into anything still, as `clearOut` last measured it before its push (metres, nought for clear). */
  readonly depth = new Float64Array(SPHERE_COUNT);
  /** The same after the push (the measure the tests hold: what is left of each in anything still). */
  readonly after = new Float64Array(SPHERE_COUNT);
  /** The push laid on the figure's root now (the world's frame), and what this frame's spheres asked for. */
  readonly push = new THREE.Vector3();
  readonly want = new THREE.Vector3();
  /** Where the body stands in the open (its capsule's middle), written by the caller before a clear: out is toward it. */
  refX = 0.5;
  refY = 0.5;
  refZ = 0.5;
  /** The console's and the tests': engine asks and pushes. */
  asks = 0;
  pushes = 0;
  private bones: (THREE.Bone | null)[] = [];
  private readonly off = new Float64Array(SPHERE_COUNT * 3);
  private readonly rad = new Float64Array(SPHERE_COUNT);
  private readonly bs = new Float64Array(SPHERE_COUNT);
  private readonly balls: (RAPIER.Shape | null)[] = [];
  private readonly ballR = new Float64Array(SPHERE_COUNT);
  private hitN = 0;
  private readonly hx = new Float64Array(MAX_HITS);
  private readonly hy = new Float64Array(MAX_HITS);
  private readonly hz = new Float64Array(MAX_HITS);
  private readonly hd = new Float64Array(MAX_HITS);
  private readonly hs = new Int32Array(MAX_HITS);
  private readonly at = { x: 0.5, y: 0.5, z: 0.5 };
  private readonly still = { x: 0, y: 0, z: 0, w: 1 };
  private readonly p = new THREE.Vector3();
  private readonly makers: SphereMakers;
  private contact: RAPIER.ShapeContact | null = null;
  private rigNow: SphereRig | null = null;
  /** The world's frame's scale of the figure (its root's), read at `sample`. */
  private scaleNow = 0.5;

  constructor(makers: SphereMakers) {
    this.makers = makers;
    this.scaleNow = 1;
    this.topNow = Number.NaN;
    this.headFeet = 0;
    this.headTall = 0;
    this.headDt = 0;
    this.headHeld = 0;
    this.deepHeld = -1;
    for (let i = 0; i < SPHERE_COUNT; i++) this.balls.push(null);
  }

  /** The parts measured for this rig's figure, and its bones found (an event: a rig attached). */
  use(rig: SphereRig | null, parts: SpherePart[]): void {
    this.rigNow = rig;
    this.parts = parts;
    this.bones = [];
    this.deepHeld = -1;
    this.on.fill(0);
    for (let i = 0; i < SPHERE_COUNT; i++) {
      const p = parts[i];
      const b = rig && p && p.vertices > 0 ? rig.boneNamed(p.anchor) : null;
      this.bones.push(b);
      if (!b || !p) continue;
      this.on[i] = 1;
      this.off[i * 3] = p.at[0];
      this.off[i * 3 + 1] = p.at[1];
      this.off[i * 3 + 2] = p.at[2];
      this.rad[i] = p.radius;
      this.bs[i] = p.bindScale > 0 ? p.bindScale : 1;
    }
    this.reset();
  }

  /** Whether a rig's spheres are in hand. */
  get ready(): boolean {
    return this.rigNow !== null && this.bones.length === SPHERE_COUNT;
  }

  /** No push (the figure stood somewhere new, a climb ended). */
  reset(): void {
    this.push.set(0, 0, 0);
    this.want.set(0, 0, 0);
    this.depth.fill(0);
    this.after.fill(0);
  }

  /** Every sphere's middle and radius from the bones as posed now (their world matrices brought up to date first by the caller). */
  sample(): void {
    const e = this.p;
    for (let i = 0; i < SPHERE_COUNT; i++) {
      const b = this.bones[i];
      if (!this.on[i] || !b) continue;
      const m = b.matrixWorld.elements;
      const o = i * 3;
      const x = this.off[o];
      const y = this.off[o + 1];
      const z = this.off[o + 2];
      e.x = m[0] * x + m[4] * y + m[8] * z + m[12];
      e.y = m[1] * x + m[5] * y + m[9] * z + m[13];
      e.z = m[2] * x + m[6] * y + m[10] * z + m[14];
      this.cx[i] = e.x;
      this.cy[i] = e.y;
      this.cz[i] = e.z;
      const s = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
      this.r[i] = (this.rad[i] * s) / this.bs[i];
    }
  }

  /** The highest a sphere among the head, the neck and the chest reaches now (the drawn body's top, `topOfUpper`), metres in the world; NaN for none. */
  topNow = 0.5;

  /** The drawn body's top into `topNow` (no number crosses a call). */
  topOfUpper(): void {
    let top = Number.NaN;
    for (let i = SPH_HEAD; i <= SPH_CHEST; i++) {
      if (!this.on[i]) continue;
      const t = this.cy[i] + this.r[i];
      if (!(t <= top)) top = t;
    }
    this.topNow = top;
  }

  /** Item 4's held top over the capsule's (`holdHead`): the caller's feet, the capsule's height and the frame's seconds in, the held answer out. */
  headFeet = 0.5;
  headTall = 0.5;
  headDt = 0.5;
  headHeld = 0.5;

  /**
   * Item 4: the drawn top (`topOfUpper`, from the spheres as `sample` left them) over the capsule's top, held over the walk's
   * bob into `headHeld`: the higher of now and what was held, falling back at `HEAD_FALL`, never over `HEAD_OVER_MOST`
   * (`headOverHeld`'s arithmetic, in fields). Nothing where no top is known.
   */
  holdHead(): void {
    this.topOfUpper();
    const top = this.topNow;
    if (!(top === top)) return;
    // (`Math.min` and `Math.max`, never a conditional write of the constant into a local: that boxes the stored number.)
    const over = Math.min(top - (this.headFeet + this.headTall), HEAD_OVER_MOST);
    this.headHeld = Math.max(over, this.headHeld - HEAD_FALL * this.headDt);
  }
  /**
   * Item 4: the drawn top over the feet (`headFeet`) at the duck's deepest, held over the walk's bob into `deepHeld` (the
   * higher of now and what was held, falling back at `HEAD_FALL`); below nought until it has been seen. The crouched walk's
   * clips carry the head well over the shrunk capsule (measured: 0.25 to 0.4 m on the human male), so a roof under this the
   * duck cannot pass under, and the body lies down for it instead (`BodyShape.lieTop`).
   */
  deepHeld = 0.5;
  holdDeep(): void {
    this.topOfUpper();
    const top = this.topNow;
    if (!(top === top)) return;
    this.deepHeld = Math.max(top - this.headFeet, this.deepHeld - HEAD_FALL * this.headDt);
  }
  /** A ball of sphere `i`'s radius now (made again only when its radius moves by a millimetre: an event). */
  private ball(i: number): RAPIER.Shape {
    const r = this.r[i];
    const was = this.balls[i];
    const d = r - this.ballR[i];
    if (was && d < 0.001 && d > -0.001) return was;
    const b = this.makers.ball(r > 0.005 ? r : 0.005);
    this.balls[i] = b;
    this.ballR[i] = r;
    return b;
  }

  /**
   * What sphere `i` is in now, into the hits (its deepest into each of up to two still things met: the face's own outward
   * normal and how deep), and its deepest into `depth[i]` or `after[i]` (`into`).
   */
  private ask(world: SphereWorld, i: number, flags: number, filter: number, into: Float64Array, record: boolean): void {
    into[i] = 0;
    const r = this.r[i];
    if (!(r > 0)) return;
    const at = this.at;
    at.x = this.cx[i];
    at.y = this.cy[i];
    at.z = this.cz[i];
    const ball = this.ball(i);
    const c = (this.contact ??= this.makers.contact());
    let skip: RAPIER.Collider | null = null;
    for (let pass = 0; pass < 2; pass++) {
      this.asks++;
      const col: RAPIER.Collider | null = skip ? world.intersectionWithShape(at, this.still, ball, flags as RAPIER.QueryFilterFlags, filter, skip) : world.intersectionWithShape(at, this.still, ball, flags as RAPIER.QueryFilterFlags, filter);
      if (!col) return;
      this.asks++;
      const got = col.contactShape(ball, at, this.still, 0, c);
      if (got) {
        const d = -got.distance;
        if (d > into[i]) into[i] = d;
        // A face whose outward way is away from the body (the sphere deep in one solid, or in two that meet: the nearer face of
        // the far one) is no way out: the body stands in the open, so out is toward it.
        const nx = got.normal1.x;
        const ny = got.normal1.y;
        const nz = got.normal1.z;
        const toward = (this.refX - at.x) * nx + (this.refY - at.y) * ny + (this.refZ - at.z) * nz;
        if (record && d > 0 && toward >= 0 && this.hitN < MAX_HITS) {
          const k = this.hitN++;
          this.hx[k] = nx;
          this.hy[k] = ny;
          this.hz[k] = nz;
          this.hd[k] = d;
          this.hs[k] = i;
        }
      }
      skip = col;
    }
  }

  /**
   * The way the figure may be pushed, across (the world's x and z, a unit), or nought for any way: a hanging figure only along
   * its lip and a figure on a wall only along its face, across (the caller's), so the push slides it along what its hands hold
   * and never off it.
   */
  axX = 0.5;
  axZ = 0.5;

  /**
   * `out` grown until every met face's ask is met (`passes` times over them all, so a corner's two faces both clear): out along
   * each face's own normal by its depth; with `level`, across only (a face too steep to say which way across is skipped); along
   * the push's way alone where one is set (a face standing along that way, |n.a| under `AXIS_LEAST`, is no ask of it), never for
   * a hand (`free`), which its own solve takes out whatever way.
   */
  private solve(out: THREE.Vector3, level: boolean, passes: number, free = false): void {
    const ax = free ? 0 : this.axX;
    const az = free ? 0 : this.axZ;
    const along = ax !== 0 || az !== 0;
    for (let pass = 0; pass < passes; pass++) {
      for (let k = 0; k < this.hitN; k++) {
        let nx = this.hx[k];
        let ny = this.hy[k];
        let nz = this.hz[k];
        const d = this.hd[k];
        if (along) {
          const c = nx * ax + nz * az;
          if (c < AXIS_LEAST && c > -AXIS_LEAST) continue;
          const p = out.x * ax + out.z * az;
          if (p * c < d) {
            const q = d / c;
            out.x = ax * q;
            out.y = 0;
            out.z = az * q;
          }
          continue;
        }
        if (level) {
          ny = 0;
          const l = Math.sqrt(nx * nx + nz * nz);
          if (!(l > 0.2)) continue;
          nx /= l;
          nz /= l;
        }
        const s = out.x * nx + out.y * ny + out.z * nz;
        if (s < d) {
          out.x += nx * (d - s);
          out.y += ny * (d - s);
          out.z += nz * (d - s);
        }
      }
    }
  }
  /** A reaching hand's way out (`handOut`): the world's frame, metres. */
  readonly handPush = new THREE.Vector3();

  /**
   * A hand that is not placed (reaching for its next hold, swung across a corner by its clip) asked of what stands still: where
   * it is in something, its way out (each met face's ask, as `clearOut` takes them, into `handPush`), true; the caller hands the
   * limbs' solve the hand's own grip moved that way, so the arm, not the whole figure, takes it out.
   */
  handOut(world: SphereWorld, i: number, flags: number, filter: number): boolean {
    this.hitN = 0;
    this.depth[i] = 0;
    if (!this.on[i]) return false;
    this.ask(world, i, flags, filter, this.depth, true);
    const w = this.handPush;
    w.set(0, 0, 0);
    if (this.hitN === 0) return false;
    this.solve(w, false, 2, true);
    return w.x !== 0 || w.y !== 0 || w.z !== 0;
  }

  /**
   * The spheres in `mask` (bit i for sphere i) asked of what stands still, and the figure's root pushed out of what they are
   * in: the push each met face asks (`solve`: out along its own normal by the sphere's depth, along the push's way where one is
   * set, across only where `level`, a body on its feet never pushed into its floor), eased toward from the push in force
   * (`ease` seconds; at once where a face asks further out), and no further than `most` metres. `dt` the frame's. The spheres
   * are asked again after the push, into `after`.
   */
  clearOut(world: SphereWorld, mask: number, flags: number, filter: number, dt: number, ease: number, most: number, level: boolean): void {
    this.hitN = 0;
    for (let i = 0; i < SPHERE_COUNT; i++) {
      this.depth[i] = 0;
      if (this.on[i] && (mask >>> i) & 1) this.ask(world, i, flags, filter, this.depth, true);
    }
    // What this frame's faces ask, from no push.
    const w = this.want;
    w.set(0, 0, 0);
    this.solve(w, level, 2);
    const wl = Math.sqrt(w.x * w.x + w.y * w.y + w.z * w.z);
    if (wl > most && wl > 0) w.multiplyScalar(most / wl);
    // Eased back in; at once out (every face's ask held by the push laid on this frame).
    const P = this.push;
    const k = ease > 0 ? 1 - Math.exp(-dt / ease) : 1;
    P.x += (w.x - P.x) * k;
    P.y += (w.y - P.y) * k;
    P.z += (w.z - P.z) * k;
    this.solve(P, level, 1);
    const pl = Math.sqrt(P.x * P.x + P.y * P.y + P.z * P.z);
    if (pl > most && pl > 0) P.multiplyScalar(most / pl);
    if (pl < 1e-6) {
      P.set(0, 0, 0);
      this.after.fill(0);
      return;
    }
    this.pushes++;
    this.move(P);
    for (let i = 0; i < SPHERE_COUNT; i++) {
      this.after[i] = 0;
      if (this.on[i] && (mask >>> i) & 1) this.ask(world, i, flags, filter, this.after, false);
    }
  }

  private readonly scaleV = new THREE.Vector3();

  /** The push in force scaled by `f` (0..1), the figure's root moved back by what it gives up (a hand's reach asked it). */
  scalePush(f: number): void {
    const P = this.push;
    const v = this.scaleV;
    v.x = P.x * (f - 1);
    v.y = P.y * (f - 1);
    v.z = P.z * (f - 1);
    P.x *= f;
    P.y *= f;
    P.z *= f;
    this.move(v);
  }

  /** The figure's root moved by `v` in the world (into its parent's frame), and the spheres placed again. */
  private move(v: THREE.Vector3): void {
    const rig = this.rigNow;
    const root = rig ? rig.root : null;
    const parent = root ? root.parent : null;
    if (!root || !parent) return;
    const p = this.p;
    root.getWorldPosition(p);
    p.x += v.x;
    p.y += v.y;
    p.z += v.z;
    parent.worldToLocal(p);
    root.position.x = p.x;
    root.position.y = p.y;
    root.position.z = p.z;
    root.updateMatrixWorld(true);
    this.sample();
  }

  /**
   * The spheres in `mask`, placed where the bones stand now, asked of what stands still with no push (the tests' and the
   * console's measure, after the limbs' solves): into `after`, the worst returned (metres) and its sphere into `worstAt`.
   */
  measure(world: SphereWorld, mask: number, flags: number, filter: number): number {
    this.sample();
    let w = 0;
    this.worstAt = -1;
    for (let i = 0; i < SPHERE_COUNT; i++) {
      this.after[i] = 0;
      if (!this.on[i] || !((mask >>> i) & 1)) continue;
      this.ask(world, i, flags, filter, this.after, false);
      if (this.after[i] > w) {
        w = this.after[i];
        this.worstAt = i;
      }
    }
    return w;
  }

  /** The sphere `measure` last found deepest (-1 for none). */
  worstAt = -1;

  /** The residual push `settle` laid on the figure this frame (the world's frame), and the most it ever laid (the console's). */
  readonly rest = new THREE.Vector3();
  restMost = 0;

  /**
   * After the limbs' solves: the spheres in `mask` asked again, and what is still in something (a leg the feet's solve took
   * across a corner's other face) pushed out at once by what its faces ask (`solve`), held to `most` less the push already in
   * force; not kept (the next frame's pose is asked afresh). Into `after`.
   */
  settle(world: SphereWorld, mask: number, flags: number, filter: number, most: number): void {
    this.sample();
    this.hitN = 0;
    for (let i = 0; i < SPHERE_COUNT; i++) {
      this.after[i] = 0;
      if (this.on[i] && (mask >>> i) & 1) this.ask(world, i, flags, filter, this.after, true);
    }
    const w = this.rest;
    w.set(0, 0, 0);
    if (this.hitN === 0) return;
    this.solve(w, false, 2);
    const pl = this.push.length();
    const room = most - pl > 0 ? most - pl : 0;
    const wl = Math.sqrt(w.x * w.x + w.y * w.y + w.z * w.z);
    if (wl > room) {
      if (!(room > 0)) {
        w.set(0, 0, 0);
        return;
      }
      w.multiplyScalar(room / wl);
    }
    if (!(wl > 0)) return;
    if (wl > this.restMost) this.restMost = wl;
    this.move(w);
    for (let i = 0; i < SPHERE_COUNT; i++) {
      this.after[i] = 0;
      if (this.on[i] && (mask >>> i) & 1) this.ask(world, i, flags, filter, this.after, false);
    }
  }

  /** The console's (`__debug.climb().spheres`): the spheres' state in words and centimetres (an event: makes what it answers). */
  report(): Record<string, unknown> {
    let worst = 0;
    let part = '';
    for (let i = 0; i < SPHERE_COUNT; i++) {
      if (this.after[i] > worst) {
        worst = this.after[i];
        part = this.parts[i]?.id ?? '';
      }
    }
    const cm = (v: number) => Math.round(v * 1000) / 10;
    return {
      ready: this.ready,
      parts: this.parts.filter((p) => p.vertices > 0).map((p) => `${p.id} ${cm(p.radius)} cm`),
      pushCm: cm(this.push.length()),
      settleCm: cm(this.rest.length()),
      settleMostCm: cm(this.restMost),
      leftInWallCm: cm(worst),
      leftInWall: part,
      headOverCm: cm(this.headHeld),
      deepHeadCm: this.deepHeld > 0 ? cm(this.deepHeld) : null,
      head: this.on[SPH_HEAD] ? [this.cx[SPH_HEAD], this.cy[SPH_HEAD], this.cz[SPH_HEAD], this.r[SPH_HEAD]].map((v) => Math.round(v * 1000) / 1000) : null,
      pushes: this.pushes,
      asks: this.asks,
    };
  }

  /** The worst sphere left in anything still after the push (the tests' and the console's measure), metres. */
  worstAfter(mask: number): number {
    let w = 0;
    for (let i = 0; i < SPHERE_COUNT; i++) if ((mask >>> i) & 1 && this.after[i] > w) w = this.after[i];
    return w;
  }
}

/** Smoothness II, item 4: how fast the drawn top over the capsule's, held over the walk's bob, falls back, m/s (mechanics: 0.2, a centimetre's bob held over a stride). */
export const HEAD_FALL = 0.2;
/** Item 4: the most the drawn top is taken to stand over the capsule's, metres (mechanics: 0.35, over every species' standing head; a pose caught between two shapes, a lie-down's first frame, never runs the duck away). */
export const HEAD_OVER_MOST = 0.35;

/**
 * Item 4: the drawn figure's top (`topOfUpper`) over the capsule's top (its feet's height and how tall it is), held over the
 * walk's bob: the higher of now and what was held, falling back at `HEAD_FALL` (`dt` the frame's). The player's and the tests'.
 */
export function headOverHeld(top: number, feetY: number, tall: number, held: number, dt: number): number {
  return Math.max(Math.min(top - (feetY + tall), HEAD_OVER_MOST), held - HEAD_FALL * dt);
}

/** Every sphere's bit. */
export const SPHERES_ALL = (1 << SPHERE_COUNT) - 1;
/** Every sphere but the hands' and the feet's (a climb plants them on its lip and its face). */
export const SPHERES_BODY = SPHERES_ALL & ~((1 << SPH_L_HAND) | (1 << SPH_R_HAND) | (1 << SPH_L_FOOT) | (1 << SPH_R_FOOT));

/** The arms' four spheres (each hangs from a hand on a lip or reaching for one: the arm's own solve takes it, never the figure). */
export const SPHERES_ARMS = (1 << 4) | (1 << 5) | (1 << 7) | (1 << 8);
/** The trunk's and the legs' (the head, the neck, the chest, the pelvis, the thighs and the shins): what pushes the figure out. */
export const SPHERES_TRUNK = SPHERES_BODY & ~SPHERES_ARMS;

/**
 * The spheres that push a climbing figure out: the trunk's, the arms' and the legs', and the feet while they are not planted on
 * the face (the limbs' `wallW`: planted, they are allowed their contact). The hands are their own solves' (`handOut`): an arm in
 * the side of a corner pushes the figure along the lip, its hands sliding along with it.
 */
export function climbMask(feet: number): number {
  let mask = SPHERES_BODY;
  if (!(feet > 0.01)) mask |= (1 << SPH_L_FOOT) | (1 << SPH_R_FOOT);
  return mask;
}

/** The spheres a climb's measure holds: every one but a hand placed on its lip or face and the feet planted on the face. */
export function climbMeasureMask(handL: number, handR: number, feet: number): number {
  let mask = SPHERES_BODY;
  if (!(handL > 0.01)) mask |= 1 << SPH_L_HAND;
  if (!(handR > 0.01)) mask |= 1 << SPH_R_HAND;
  if (!(feet > 0.01)) mask |= (1 << SPH_L_FOOT) | (1 << SPH_R_FOOT);
  return mask;
}
