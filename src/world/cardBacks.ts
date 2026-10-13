// Each face of a leaf card takes the light on its own side: the mirror, run on a card's geometry as its model
// loads (`AssetPack.model`'s load callback and the baked places' loader, through `cardRule.ts`).
//
// **Why.** The client's back-to-back cards carry one normal: on most pairs both copies are the same three
// vertices wound the other way (49% of all unique card area), so the copy wound toward one side carries a
// normal pointing to the other. Drawn from its front only (the card rule), that copy is lit only by light on
// its far side -- the sun once it has crossed behind the tree, and never a torch held by the viewer. The
// client lit both copies by that one normal (it had no face test and no torch); the owner asked for each face
// to take the light on its own side. The converter is faithful to the client: it negates X on positions and
// normals and reverses the winding in the same step, so the fault is the data's, and it is turned here.
//
// **The rule.** A card is a sheet: triangles joined across a shared edge (by position, to ten micrometres)
// whose faces agree within 60 degrees, so the two copies of a back-to-back pair are always two sheets. A sheet
// whose stored normal, taken over its area, points against its own winding is mirrored: every corner normal
// reflected through that vertex's own plane in the sheet (the area-weighted faces of its triangles there),
// `n − 2(n·p)p`. A vertex the sheet shares with any other sheet is copied for it first, every attribute byte
// for byte; one it owns alone is mirrored in place. Reflection is linear, so on a flat sheet the mirrored copy
// is the exact mirror image of its twin at every point, the client's radial crown shading included, with no
// crease; on a bent sheet each corner is reflected through its own plane there, which is smooth and close to
// that mirror. Decided per sheet and never per triangle, which is what leaves no seam: 2 to 4% of card area
// lies on sheets whose triangles disagree about their side. A pair whose normals already face apart is left
// exactly as the client wrote it.
//
// **The plane is kept** on every vertex, as `cardPlane` (four signed bytes, normalised): the plane its normal
// was reflected through, nought where nothing was. The bake reflects through that very quantised plane,
// re-normalised, so reflecting again -- which the card rule's vertex line does to light by the client's own
// normal (`backs: 'stored'`) and the card light does for `sunSide: 'stored'` -- gives back the stored normal
// exactly, provided the reader normalises it too: the bytes over 127 are off unit length by up to 0.7%.
// **Every geometry a card material draws carries the attribute**, nought where the mirror passed it over,
// since a program attribute a geometry lacks reads whatever another program last left at its location.
//
// Not converted: the converter goes on writing the client's normals byte for byte, and this runs on the GLBs
// as they are. Measured over every pack: at most 0.34 MB a world (Kashyyyk's main zone), at most about 16 ms a
// world as its models load, every primitive under 0.8 ms but one placed wroshyr's at 3.2 ms.
//
// Pure apart from the thin geometry wrapper at the end, so a node test can mirror cards it built itself.
import * as THREE from 'three';

/** Two triangles join into one sheet when their faces agree within this (cos 60 degrees). */
export const SHEET_JOIN = 0.5;
/** Positions are welded to this many steps a metre (ten micrometres) to find a shared edge. */
const WELD = 1e5;

/** The sheets of one triangle list. */
export interface Sheets {
  /** Triangles and vertices. */
  nt: number;
  nv: number;
  /** Each triangle's unit face normal by its winding (three a triangle), and its area. */
  face: Float64Array;
  area: Float64Array;
  /** Each triangle's sheet. */
  sheetOf: Int32Array;
  /** How many sheets; each one's area-weighted face (unit, three a sheet), and whether it is mirrored. */
  count: number;
  plane: Float64Array;
  mirrored: Uint8Array;
  /** Each sheet's area-weighted mean of its corners' normals along their triangles' faces: under nought it faces against its winding. */
  across: Float64Array;
}

/**
 * The sheets of a triangle list: positions `P` and normals `N` three numbers a vertex, indices `I` three a
 * triangle. A sheet is mirrored when the area-weighted mean of its corners' stored normals along their own
 * triangle's face is under nought: its stored normal points against its winding over its area.
 */
export function sheetsOf(P: ArrayLike<number>, N: ArrayLike<number>, I: ArrayLike<number>): Sheets {
  const nt = (I.length / 3) | 0;
  const nv = (P.length / 3) | 0;
  const face = new Float64Array(nt * 3);
  const area = new Float64Array(nt);
  const across = new Float64Array(nt);
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3];
    const b = I[t * 3 + 1];
    const c = I[t * 3 + 2];
    const ux = P[b * 3] - P[a * 3];
    const uy = P[b * 3 + 1] - P[a * 3 + 1];
    const uz = P[b * 3 + 2] - P[a * 3 + 2];
    const wx = P[c * 3] - P[a * 3];
    const wy = P[c * 3 + 1] - P[a * 3 + 1];
    const wz = P[c * 3 + 2] - P[a * 3 + 2];
    const gx = uy * wz - uz * wy;
    const gy = uz * wx - ux * wz;
    const gz = ux * wy - uy * wx;
    const gl = Math.hypot(gx, gy, gz);
    area[t] = gl / 2;
    const s = gl > 0 ? 1 / gl : 0;
    face[t * 3] = gx * s;
    face[t * 3 + 1] = gy * s;
    face[t * 3 + 2] = gz * s;
    let m = 0;
    for (let k = 0; k < 3; k++) {
      const v = I[t * 3 + k];
      const x = N[v * 3];
      const y = N[v * 3 + 1];
      const z = N[v * 3 + 2];
      const l = Math.hypot(x, y, z) || 1;
      m += (x * face[t * 3] + y * face[t * 3 + 1] + z * face[t * 3 + 2]) / l;
    }
    across[t] = m / 3;
  }
  // Weld positions so an edge can be keyed by two welded ids. Hashed into buckets and compared exactly, so two
  // places a hash happens to share are never taken for one.
  const weld = new Int32Array(nv);
  const qx = new Float64Array(nv);
  const qy = new Float64Array(nv);
  const qz = new Float64Array(nv);
  const buckets = new Map<number, number[]>();
  let welded = 0;
  const firstOf: number[] = [];
  for (let v = 0; v < nv; v++) {
    const x = Math.round(P[v * 3] * WELD);
    const y = Math.round(P[v * 3 + 1] * WELD);
    const z = Math.round(P[v * 3 + 2] * WELD);
    qx[v] = x;
    qy[v] = y;
    qz[v] = z;
    const h = (Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(z | 0, 83492791)) | 0;
    let list = buckets.get(h);
    if (!list) buckets.set(h, (list = []));
    let id = -1;
    for (const w of list) {
      const f = firstOf[w];
      if (qx[f] === x && qy[f] === y && qz[f] === z) {
        id = w;
        break;
      }
    }
    if (id < 0) {
      id = welded++;
      firstOf.push(v);
      list.push(id);
    }
    weld[v] = id;
  }
  const parent = new Int32Array(nt);
  for (let t = 0; t < nt; t++) parent[t] = t;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const edges = new Map<number, number[]>();
  for (let t = 0; t < nt; t++) {
    if (area[t] <= 1e-12) continue;
    for (let k = 0; k < 3; k++) {
      const p = weld[I[t * 3 + k]];
      const q = weld[I[t * 3 + ((k + 1) % 3)]];
      if (p === q) continue;
      const key = p < q ? p * welded + q : q * welded + p;
      const list = edges.get(key);
      if (!list) {
        edges.set(key, [t]);
        continue;
      }
      for (const o of list) {
        if (face[o * 3] * face[t * 3] + face[o * 3 + 1] * face[t * 3 + 1] + face[o * 3 + 2] * face[t * 3 + 2] > SHEET_JOIN) {
          const ra = find(o);
          const rb = find(t);
          if (ra !== rb) parent[ra] = rb;
        }
      }
      list.push(t);
    }
  }
  const sheetOf = new Int32Array(nt);
  const rootSheet = new Map<number, number>();
  const sumAcross: number[] = [];
  const sumFace: number[] = [];
  for (let t = 0; t < nt; t++) {
    const r = find(t);
    let s = rootSheet.get(r);
    if (s === undefined) {
      s = sumAcross.length;
      rootSheet.set(r, s);
      sumAcross.push(0);
      sumFace.push(0, 0, 0);
    }
    sheetOf[t] = s;
    sumAcross[s] += area[t] * across[t];
    sumFace[s * 3] += area[t] * face[t * 3];
    sumFace[s * 3 + 1] += area[t] * face[t * 3 + 1];
    sumFace[s * 3 + 2] += area[t] * face[t * 3 + 2];
  }
  const count = sumAcross.length;
  const plane = new Float64Array(count * 3);
  const mirrored = new Uint8Array(count);
  const acrossOf = new Float64Array(count);
  const areaOf = new Float64Array(count);
  for (let t = 0; t < nt; t++) areaOf[sheetOf[t]] += area[t];
  for (let s = 0; s < count; s++) {
    const l = Math.hypot(sumFace[s * 3], sumFace[s * 3 + 1], sumFace[s * 3 + 2]) || 1;
    plane[s * 3] = sumFace[s * 3] / l;
    plane[s * 3 + 1] = sumFace[s * 3 + 1] / l;
    plane[s * 3 + 2] = sumFace[s * 3 + 2] / l;
    mirrored[s] = sumAcross[s] < 0 ? 1 : 0;
    acrossOf[s] = areaOf[s] > 0 ? sumAcross[s] / areaOf[s] : 0;
  }
  return { nt, nv, face, area, sheetOf, count, plane, mirrored, across: acrossOf };
}

/** One vertex attribute to carry through the mirror: its values and how many a vertex. */
export interface MirrorAttr {
  name: string;
  array: ArrayLike<number> & { length: number };
  itemSize: number;
}

/** What `mirrorBacks` made: every attribute again (copies appended), the new index, the packed planes and what it did. */
export interface MirrorResult {
  attrs: Map<string, Float32Array | Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array>;
  index: Uint32Array;
  /** `cardPlane`: four signed bytes a vertex, x y z of the plane normalised to 127, w 127 where mirrored; nought where nothing was. */
  plane: Int8Array;
  /** Vertices added (copies of shared ones), sheets mirrored, and the vertex count after. */
  added: number;
  mirroredSheets: number;
  total: number;
}

type TypedCtor = new (n: number) => Float32Array | Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array;

/**
 * Mirror every sheet that faces against its winding (`sheetsOf`). `normal` must be among `attrs` (three a
 * vertex); its copy in the answer is the mirrored one, and every other attribute is the input's, byte for
 * byte, at every vertex and at every copy's source.
 */
export function mirrorBacks(P: ArrayLike<number>, N: ArrayLike<number>, I: ArrayLike<number>, attrs: readonly MirrorAttr[], sh: Sheets = sheetsOf(P, N, I)): MirrorResult {
  const { nt, nv, sheetOf, mirrored, face, area } = sh;
  // Which sheets use each vertex: its first, and whether a second one does too.
  const first = new Int32Array(nv).fill(-1);
  const shared = new Uint8Array(nv);
  for (let t = 0; t < nt; t++) {
    const s = sheetOf[t];
    for (let k = 0; k < 3; k++) {
      const v = I[t * 3 + k];
      if (first[v] === -1) first[v] = s;
      else if (first[v] !== s) shared[v] = 1;
    }
  }
  const copyOf = new Map<number, number>();
  const src: number[] = [];
  const index = new Uint32Array(I.length);
  let mirroredSheets = 0;
  for (let s = 0; s < sh.count; s++) if (mirrored[s]) mirroredSheets++;
  for (let t = 0; t < nt; t++) {
    const s = sheetOf[t];
    for (let k = 0; k < 3; k++) {
      const v = I[t * 3 + k];
      if (mirrored[s] && shared[v]) {
        const key = v * sh.count + s;
        let c = copyOf.get(key);
        if (c === undefined) {
          c = nv + src.length;
          src.push(v);
          copyOf.set(key, c);
        }
        index[t * 3 + k] = c;
      } else index[t * 3 + k] = v;
    }
  }
  const total = nv + src.length;
  const out = new Map<string, Float32Array | Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array>();
  for (const a of attrs) {
    const Ctor = (a.array as unknown as { constructor: TypedCtor }).constructor;
    const arr = new Ctor(total * a.itemSize);
    for (let i = 0; i < nv * a.itemSize; i++) arr[i] = a.array[i];
    for (let j = 0; j < src.length; j++) for (let c = 0; c < a.itemSize; c++) arr[(nv + j) * a.itemSize + c] = a.array[src[j] * a.itemSize + c];
    out.set(a.name, arr);
  }
  // Each mirrored vertex's own plane: the area-weighted faces of its sheet's triangles meeting at it, so a bent
  // sheet is mirrored smoothly (the plane follows the bend) and a flat one exactly.
  const sum = new Float64Array(total * 3);
  const flag = new Uint8Array(total);
  for (let t = 0; t < nt; t++) {
    if (!mirrored[sheetOf[t]]) continue;
    for (let k = 0; k < 3; k++) {
      const v = index[t * 3 + k];
      flag[v] = 1;
      sum[v * 3] += area[t] * face[t * 3];
      sum[v * 3 + 1] += area[t] * face[t * 3 + 1];
      sum[v * 3 + 2] += area[t] * face[t * 3 + 2];
    }
  }
  const normal = out.get('normal') as Float32Array | undefined;
  const plane = new Int8Array(total * 4);
  for (let v = 0; v < total; v++) {
    if (!flag[v]) continue;
    let px = sum[v * 3];
    let py = sum[v * 3 + 1];
    let pz = sum[v * 3 + 2];
    let l = Math.hypot(px, py, pz);
    if (!(l > 0)) continue;
    // Written as the game reads it (four signed bytes, normalised), and the bake reflects through that very
    // quantised plane re-normalised, so reflecting again in the shader gives back the stored normal exactly.
    plane[v * 4] = Math.round((px / l) * 127);
    plane[v * 4 + 1] = Math.round((py / l) * 127);
    plane[v * 4 + 2] = Math.round((pz / l) * 127);
    plane[v * 4 + 3] = 127;
    px = plane[v * 4] / 127;
    py = plane[v * 4 + 1] / 127;
    pz = plane[v * 4 + 2] / 127;
    l = Math.hypot(px, py, pz) || 1;
    px /= l;
    py /= l;
    pz /= l;
    if (normal) {
      const x = normal[v * 3];
      const y = normal[v * 3 + 1];
      const z = normal[v * 3 + 2];
      const d = 2 * (x * px + y * py + z * pz);
      normal[v * 3] = x - d * px;
      normal[v * 3 + 1] = y - d * py;
      normal[v * 3 + 2] = z - d * pz;
    }
  }
  return { attrs: out, index, plane, added: src.length, mirroredSheets, total };
}

/**
 * Whether a triangle list carries a lone horizontal pad: a sheet facing up or down (within 25 degrees) with no
 * sheet facing the other way within 20 cm of its middle along its normal and over its middle. Kashyyyk's giant
 * trees carry such pads, which drawn from their front alone vanish from underneath; `CARD_TUNE.lone: 'split'`
 * keeps any material drawing one double-sided rather than mirrored.
 */
export function hasLonePad(P: ArrayLike<number>, I: ArrayLike<number>, sh: Sheets): boolean {
  const n = sh.count;
  const cx = new Float64Array(n);
  const cy = new Float64Array(n);
  const cz = new Float64Array(n);
  const wa = new Float64Array(n);
  const lo = new Float64Array(n * 3).fill(Number.POSITIVE_INFINITY);
  const hi = new Float64Array(n * 3).fill(Number.NEGATIVE_INFINITY);
  for (let t = 0; t < sh.nt; t++) {
    const s = sh.sheetOf[t];
    const a = sh.area[t];
    for (let k = 0; k < 3; k++) {
      const v = I[t * 3 + k];
      cx[s] += (a * P[v * 3]) / 3;
      cy[s] += (a * P[v * 3 + 1]) / 3;
      cz[s] += (a * P[v * 3 + 2]) / 3;
      for (let c = 0; c < 3; c++) {
        const x = P[v * 3 + c];
        if (x < lo[s * 3 + c]) lo[s * 3 + c] = x;
        if (x > hi[s * 3 + c]) hi[s * 3 + c] = x;
      }
    }
    wa[s] += a;
  }
  for (let s = 0; s < n; s++) {
    if (!(wa[s] > 1e-6) || Math.abs(sh.plane[s * 3 + 1]) < 0.9) continue;
    const mx = cx[s] / wa[s];
    const my = cy[s] / wa[s];
    const mz = cz[s] / wa[s];
    let covered = false;
    for (let o = 0; o < n && !covered; o++) {
      if (o === s || !(wa[o] > 1e-6)) continue;
      const dot = sh.plane[s * 3] * sh.plane[o * 3] + sh.plane[s * 3 + 1] * sh.plane[o * 3 + 1] + sh.plane[s * 3 + 2] * sh.plane[o * 3 + 2];
      if (dot > -0.9) continue;
      const pad = 0.2;
      covered = mx >= lo[o * 3] - pad && mx <= hi[o * 3] + pad && my >= lo[o * 3 + 1] - pad && my <= hi[o * 3 + 1] + pad && mz >= lo[o * 3 + 2] - pad && mz <= hi[o * 3 + 2] + pad;
    }
    if (!covered) return true;
  }
  return false;
}

/** What one geometry came to: whether it was mirrored, the sheets it turned, the vertices it added, and the milliseconds. */
export interface GeometryMirror {
  mirrored: boolean;
  sheets: number;
  added: number;
  ms: number;
}

/** The attribute every card geometry carries (the plane its normals were reflected through). */
export const CARD_PLANE = 'cardPlane';

/** A plane of nought on every vertex, for a card geometry the mirror passed over or left alone. Nothing where it has one already. */
export function zeroCardPlane(g: THREE.BufferGeometry): boolean {
  if (g.getAttribute(CARD_PLANE)) return false;
  const n = g.getAttribute('position')?.count ?? 0;
  g.setAttribute(CARD_PLANE, new THREE.BufferAttribute(new Int8Array(n * 4), 4, true));
  return true;
}

/** An attribute's values as one flat array of its own type, an interleaved one taken apart first. */
function flatOf(a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  return (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (a as THREE.InterleavedBufferAttribute).clone() : (a as THREE.BufferAttribute);
}

/**
 * Mirror one card geometry in place, before anything has drawn it: every attribute rewritten with the copies
 * appended, the index pointed at them, and `cardPlane` written. A geometry that already carries `cardPlane` is
 * passed over (GLTFLoader can hang one geometry on two card primitives, and a second run would find nothing
 * left to mirror and write nought over the plane the first one kept); one with blend targets, or with no
 * normal, gets a plane of nought and is left as it was.
 */
export function mirrorCardGeometry(g: THREE.BufferGeometry): GeometryMirror {
  const t0 = performance.now();
  const none = (): GeometryMirror => ({ mirrored: false, sheets: 0, added: 0, ms: performance.now() - t0 });
  if (g.getAttribute(CARD_PLANE)) return none();
  const pos = g.getAttribute('position');
  const nrm = g.getAttribute('normal');
  if (!pos || !nrm || Object.keys(g.morphAttributes).length) {
    zeroCardPlane(g);
    return none();
  }
  const nv = pos.count;
  const P = new Float64Array(nv * 3);
  const N = new Float32Array(nv * 3);
  for (let v = 0; v < nv; v++) {
    P[v * 3] = pos.getX(v);
    P[v * 3 + 1] = pos.getY(v);
    P[v * 3 + 2] = pos.getZ(v);
    N[v * 3] = nrm.getX(v);
    N[v * 3 + 1] = nrm.getY(v);
    N[v * 3 + 2] = nrm.getZ(v);
  }
  const index = g.getIndex();
  const I: ArrayLike<number> = index ? index.array : Uint32Array.from({ length: nv }, (_, i) => i);
  const sh = sheetsOf(P, N, I);
  let any = false;
  for (let s = 0; s < sh.count && !any; s++) if (sh.mirrored[s]) any = true;
  if (!any) {
    zeroCardPlane(g);
    return none();
  }
  const names = Object.keys(g.attributes);
  const flat = new Map<string, THREE.BufferAttribute>();
  const attrs: MirrorAttr[] = [];
  for (const name of names) {
    if (name === 'normal') {
      // A float copy, whatever the file stored it as, since it is the one rewritten.
      attrs.push({ name, array: N, itemSize: 3 });
      continue;
    }
    const a = flatOf(g.getAttribute(name) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute);
    flat.set(name, a);
    attrs.push({ name, array: a.array as ArrayLike<number> & { length: number }, itemSize: a.itemSize });
  }
  const r = mirrorBacks(P, N, I, attrs, sh);
  for (const name of names) {
    const arr = r.attrs.get(name)!;
    if (name === 'normal') g.setAttribute(name, new THREE.BufferAttribute(arr, 3));
    else {
      const a = flat.get(name)!;
      g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
    }
  }
  g.setAttribute(CARD_PLANE, new THREE.BufferAttribute(r.plane, 4, true));
  g.setIndex(new THREE.BufferAttribute(r.total > 65535 ? r.index : Uint16Array.from(r.index), 1));
  return { mirrored: true, sheets: r.mirroredSheets, added: r.added, ms: performance.now() - t0 };
}
