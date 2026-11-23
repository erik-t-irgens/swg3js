// The generated bodies' shapes and the rocks round them (wave 2): an irregular body or a broken
// planet as a real 3D shape, belts, debris fields and a broken planet's stream of debris as real
// rocks near the camera, impostor cards in the middle distance and soft dust far off, and rings.
//
// Like generate.js this imports only three and three/tsl (and generate.js's noise), takes no state
// from the page (the renderer and the look's light uniforms are handed in), is deterministic (integer
// hashes, the same seed and dials make the same thing), and bakes once: a shape's maps, the rocks'
// meshes, their impostor atlas, the rocks' places and the rings' profile are made when a look is
// built or a dial that shapes them moves, never per frame. Per frame there is only the choice of
// which rocks are near enough to be drawn as rocks, into arrays kept for it (nothing allocated).

import * as THREE from 'three/webgpu';
import {
  Fn, Loop, uniform, uniformArray, float, vec2, vec3, vec4, uv, floor, fract, mix, clamp, abs, min, max, dot, cross, normalize, length, sqrt, pow, exp,
  sin, cos, atan, acos, select, texture, attribute, varying, positionGeometry, normalGeometry, instanceIndex, smoothstep,
  modelWorldMatrixInverse, cameraPosition, cameraWorldMatrix, screenCoordinate,
} from 'three/tsl';
import { noise3, worley, fbm4, fbm6, sampleLatLong } from './generate.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// The seed's numbers and a CPU noise (integer hashes, as the shader's), for the rocks and their places.

export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashI(x, y, z) {
  let h = (Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f)) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x846ca68b) >>> 0; h ^= h >>> 16;
  return h >>> 0;
}
function gradI(h, x, y, z) {
  const hh = h & 15;
  const u = hh < 8 ? x : y;
  const v = hh < 4 ? y : hh === 12 || hh === 14 ? x : z;
  return ((hh & 1) ? -u : u) + ((hh & 2) ? -v : v);
}
const quint = (t) => t * t * t * (t * (t * 6 - 15) + 10);
export function noiseJ(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const wx = quint(fx), wy = quint(fy), wz = quint(fz);
  const g = (a, b, d) => gradI(hashI(ix + a, iy + b, iz + d), fx - a, fy - b, fz - d);
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(g(0, 0, 0), g(1, 0, 0), wx), L(g(0, 1, 0), g(1, 1, 0), wx), wy), L(L(g(0, 0, 1), g(1, 0, 1), wx), L(g(0, 1, 1), g(1, 1, 1), wx), wy), wz);
}
function fbmJ(x, y, z, oct, gain = 0.5) {
  let s = 0, a = 1, n = 0, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noiseJ(x * f + i * 17.31, y * f - i * 9.77, z * f + i * 5.13); n += a; a *= gain; f *= 2.03; }
  return s / n;
}
const gauss = (r) => Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(TAU * r());
const smin = (a, b, k) => { const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (b - a)) / k)); return b + (a - b) * h - k * h * (1 - h); };
function unitFrom(r) {
  const z = r() * 2 - 1, a = r() * TAU, s = Math.sqrt(1 - z * z);
  return [s * Math.cos(a), z, s * Math.sin(a)];
}

// ---------------------------------------------------------------------------------------------
// An icosphere (indexed, unit radius): the irregular bodies' mesh (level 6) and the rocks' (level 3).

const icoCache = new Map();
function icosphereArrays(level) {
  if (icoCache.has(level)) return icoCache.get(level);
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map(([x, y, z]) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l]; });
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let l = 0; l < level; l++) {
    const mid = new Map();
    const m = (a, b) => {
      const key = a < b ? a * 4194304 + b : b * 4194304 + a;
      let i = mid.get(key);
      if (i === undefined) {
        const [x, y, z] = [verts[a][0] + verts[b][0], verts[a][1] + verts[b][1], verts[a][2] + verts[b][2]];
        const n = Math.hypot(x, y, z);
        i = verts.length;
        verts.push([x / n, y / n, z / n]);
        mid.set(key, i);
      }
      return i;
    };
    const nf = [];
    for (const [a, b, c] of faces) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    faces = nf;
  }
  const out = { pos: new Float32Array(verts.flat()), index: new Uint32Array(faces.flat()) };
  icoCache.set(level, out);
  return out;
}
const bodyGeoms = new Map();
/** A shaped body's mesh: a fine unit icosphere, pushed out per vertex by the shape's map. Shared, never disposed. */
export function shapeGeometry() {
  if (bodyGeoms.has(6)) return bodyGeoms.get(6);
  const a = icosphereArrays(6);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.pos, 3));
  g.setIndex(new THREE.BufferAttribute(a.index, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
  g.userData.shared = true;
  bodyGeoms.set(6, g);
  return g;
}

// ---------------------------------------------------------------------------------------------
// TSL helpers

const uvOfDir = (d) => {
  const lon = atan(d.x, d.z);
  const lat = atan(d.y, length(vec2(d.x, d.z)));
  return vec2(lon.div(TAU).add(0.5), lat.div(Math.PI).add(0.5));
};
const dirOfUV = (t) => {
  const lon = t.x.sub(0.5).mul(TAU);
  const lat = t.y.sub(0.5).mul(Math.PI);
  return { dir: vec3(cos(lat).mul(sin(lon)), sin(lat), cos(lat).mul(cos(lon))), lat, lon };
};
const qrot = (q, v) => { const t = cross(q.xyz, v).mul(2.0); return v.add(t.mul(q.w)).add(cross(q.xyz, t)); };
const qinv = (q, v) => qrot(vec4(q.xyz.negate(), q.w), v);
const sgn = (x) => select(x.greaterThanEqual(0.0), float(1), float(-1));
// the full sphere folded onto a square (octahedral), the y pole at its centre
const octEncode = (n) => {
  const s = abs(n.x).add(abs(n.y)).add(abs(n.z));
  const px = n.x.div(s), pz = n.z.div(s);
  const neg = n.y.lessThan(0.0);
  const fx = select(neg, float(1).sub(abs(pz)).mul(sgn(px)), px);
  const fz = select(neg, float(1).sub(abs(px)).mul(sgn(pz)), pz);
  return vec2(fx, fz).mul(0.5).add(0.5);
};
const octDecode = (e) => {
  const f = e.mul(2.0).sub(1.0);
  const y = float(1).sub(abs(f.x)).sub(abs(f.y));
  const t = clamp(y.negate(), 0.0, 1.0);
  return normalize(vec3(f.x.add(select(f.x.greaterThanEqual(0.0), t.negate(), t)), y, f.y.add(select(f.y.greaterThanEqual(0.0), t.negate(), t))));
};
// the frame a view along `v` is drawn in: the same for the atlas's bake and for the cards
const basisOf = (v) => {
  const up0 = select(abs(v.y).greaterThan(0.999), vec3(0, 0, 1), vec3(0, 1, 0));
  const right = normalize(cross(up0, v));
  return { right, up: cross(v, right) };
};
// a dither for fading one thing into another without sorting (interleaved gradient noise)
const ign = (p) => fract(float(52.9829189).mul(fract(dot(p, vec2(0.06711056, 0.00583715)))));
const toL = (c) => pow(max(c, 0.0), 2.2);

/**
 * (the atmosphere brief's wave B, its critic) A part's colour seen through the air in front of it, as the body's own is
 * (build.js: the share of its light that comes through, then the air's own light), only when the look was built for a
 * place (`LU.place`); an additive part (dust) takes the share only, its light being added to what is behind it. On the
 * close-up stage nothing is added, so its programs are what they were.
 */
function seenThrough(LU, colour, additive = false) {
  if (!LU.place) return colour;
  return additive ? colour.mul(LU.airTrans) : colour.mul(LU.airTrans).add(LU.airLight);
}

/** The light (toward the sun) and the camera in a mesh's own frame, from the look's view-space light. */
function frameNodes(LU) {
  return {
    Lo: normalize(modelWorldMatrixInverse.mul(vec4(cameraWorldMatrix.mul(vec4(LU.light, 0.0)).xyz, 0.0)).xyz),
    camO: modelWorldMatrixInverse.mul(vec4(cameraPosition, 1.0)).xyz,
  };
}
/** How deep `P` lies in the shadow of the body (a sphere of radius R at the origin): soft at its edge. */
export function planetShadow(P, Lo, R) {
  const b = dot(P, Lo);
  const c2 = max(dot(P, P).sub(b.mul(b)), 0.0);
  const inside = float(1).sub(smoothstep(R.mul(0.965), R.mul(1.025), sqrt(c2)));
  return select(b.lessThan(0.0).and(R.greaterThan(0.001)), inside, float(0));
}

// ---------------------------------------------------------------------------------------------
// Shapes: a body's radius by direction, baked into a lat-long map (half floats: r - 1, exposed rock,
// glow, depth below the old surface), and the normal of that surface (8 bits, mipmapped).

const SW = 1024, SH = 512;
const MAXF = SW / (4 * Math.PI);
const shapeKits = new Map();
let shapeQueue = Promise.resolve();

function shapeKit(kind, version) {
  const key = kind + '@' + version;
  if (shapeKits.has(key)) return shapeKits.get(key);
  const U = {
    so: uniform(new THREE.Vector3()), axes: uniform(new THREE.Vector3(1, 1, 1)), lumpF: uniform(1.5), lumpAmp: uniform(0.2), facets: uniform(0),
    planes: uniformArray(Array.from({ length: 6 }, () => new THREE.Vector4(0, 1, 0, 9)), 'vec4'),
    craters: uniformArray(Array.from({ length: 20 }, () => new THREE.Vector4(0, 1, 0, 0)), 'vec4'),
    wound: uniform(new THREE.Vector4(0, 0, 1, 0.8)), depth: uniform(0.4), ragged: uniform(0.6),
  };
  const maxF = float(MAXF);
  const make = (fn) => { const m = new THREE.NodeMaterial(); m.fragmentNode = Fn(fn)(); m.depthTest = false; m.depthWrite = false; m.name = 'shape-' + key; return m; };

  // (the planes and craters are the shader's own loops over arrays, not unrolled: it compiles quickly)
  // (version 2: the lumps without their finest octaves and the fine layer much fainter: a small body's
  // dust smooths the small scale, and at that scale the old one shaded as hard black speckle all over
  // the lit side whenever the sun was not overhead)
  const irregular = (dir) => {
    const v2 = version >= 2;
    const r = float(1).div(length(dir.div(U.axes))).toVar();
    r.mulAssign(float(1).add((v2 ? fbm4(dir, U.lumpF, U.so, maxF, float(0.5)) : fbm6(dir, U.lumpF, U.so, maxF, float(0.5))).mul(U.lumpAmp)));
    r.mulAssign(float(1).add(fbm4(dir, U.lumpF.mul(5.0), U.so.add(vec3(31.7, -12.2, 8.9)), maxF, float(0.55)).mul(v2 ? U.lumpAmp.mul(0.06).add(0.004) : U.lumpAmp.mul(0.2).add(0.01))));
    // flat faces where pieces split off: the surface cut back to each plane, softly
    Loop(U.planes.array.length, ({ i }) => {
      const P = U.planes.element(i);
      const dn = dot(dir, P.xyz);
      const rc = P.w.div(max(dn, 0.001));
      const k = float(0.05);
      const h = clamp(float(0.5).add(rc.sub(r).mul(0.5).div(k)), 0.0, 1.0);
      const cut = mix(rc, r, h).sub(k.mul(h).mul(float(1).sub(h)));
      r.assign(select(dn.greaterThan(0.001), mix(r, cut, U.facets), r));
    });
    // craters: a bowl and its raised rim, each as deep as about a fifth of its width
    const h = float(0).toVar();
    Loop(U.craters.array.length, ({ i }) => {
      const c = U.craters.element(i);
      const x = acos(clamp(dot(dir, c.xyz), -1.0, 1.0)).div(max(c.w, 0.0001));
      const bowl = select(x.lessThan(1.0), x.mul(x).sub(1.0), float(0));
      const rimT = x.sub(1.0).div(0.3);
      const rim = exp(rimT.mul(rimT).negate()).mul(0.2);
      h.addAssign(bowl.add(rim).mul(c.w).mul(0.4));
    });
    return vec4(r.mul(float(1).add(h)).sub(1.0), 0.0, 0.0, 0.0);
  };

  const broken = (dir) => {
    const W = U.wound.xyz, alpha = U.wound.w;
    const ang = acos(clamp(dot(dir, W), -1.0, 1.0));
    const wn = fbm6(dir, float(2.2), U.so, maxF, float(0.55));
    const cell = worley(dir.mul(7.0).add(U.so));
    const crack = float(1).sub(smoothstep(0.0, 0.07, cell.y.sub(cell.x)));
    // the edge frays with the noise and with whole blocks (cells) of crust broken away
    const ae = alpha.mul(float(1).add(wn.mul(U.ragged).mul(0.55)).add(cell.x.sub(0.45).mul(U.ragged).mul(0.22)));
    const x = ang.div(max(ae, 0.01));
    const inside = x.lessThan(1.0);
    const prof = sqrt(max(float(1).sub(x.mul(x)), 0.0));
    // fractured walls: terraces broken along the blocks
    const terr = floor(prof.mul(4.0).add(cell.x.mul(1.6)).add(wn)).div(4.0);
    const p2 = clamp(mix(prof, terr, U.ragged.mul(0.45)), 0.0, 1.0);
    const rough = fbm4(dir, float(9.0), U.so.add(vec3(5.1, 2.2, -7.3)), maxF, float(0.6));
    const D = U.depth.mul(p2).mul(float(1).add(rough.mul(0.4))).add(cell.x.mul(0.015).mul(U.depth).mul(smoothstep(0.0, 0.25, prof)));
    // just outside, the crust is cracked and sunk a little along the blocks' edges
    const rimZone = smoothstep(1.5, 1.0, x).mul(select(inside, float(0), float(1))).mul(U.ragged);
    const sink = rimZone.mul(crack.mul(0.012).add(cell.x.mul(0.008)));
    const Din = select(inside, max(D, 0.0), float(0));
    const r = float(1).sub(Din).sub(sink);
    const rock = max(smoothstep(1.04, 0.97, x), rimZone.mul(crack).mul(0.85));
    const glow = select(inside, max(smoothstep(0.8, 0.99, prof).mul(float(0.3).add(crack.mul(0.7))), crack.mul(smoothstep(0.35, 0.85, prof)).mul(0.45)), float(0));
    return vec4(r.sub(1.0), rock, glow, Din.add(sink));
  };

  // version 2 of the broken planet: the crust breaks into irregular blocks (a warped, finer lattice, so
  // no honeycomb shows), the fringe round the wound is crust stripped away in patches that thin out with
  // distance (not a net of cracks over half the body), and the glow keeps to the cracks at the bottom
  const broken2 = (dir) => {
    const W = U.wound.xyz, alpha = U.wound.w;
    const ang = acos(clamp(dot(dir, W), -1.0, 1.0));
    const wn = fbm6(dir, float(2.2), U.so, maxF, float(0.55));
    const wq = dir.add(vec3(
      fbm4(dir, float(3.0), U.so.add(vec3(11.3, 4.1, -2.7)), maxF, float(0.5)),
      fbm4(dir, float(3.0), U.so.add(vec3(-6.2, 9.9, 3.3)), maxF, float(0.5)),
      fbm4(dir, float(3.0), U.so.add(vec3(2.4, -8.8, 7.1)), maxF, float(0.5))).mul(0.16));
    const cell = worley(wq.mul(11.0).add(U.so));
    const crack = float(1).sub(smoothstep(0.0, 0.045, cell.y.sub(cell.x)));
    const ae = alpha.mul(float(1).add(wn.mul(U.ragged).mul(0.6)).add(cell.x.sub(0.45).mul(U.ragged).mul(0.18)));
    const x = ang.div(max(ae, 0.01));
    const inside = x.lessThan(1.0);
    // walls steep but never sheer (a sheer wall smears the ground's picture into radial streaks)
    const prof = max(float(1).sub(x.mul(x).mul(x)), 0.0);
    const terr = floor(prof.mul(5.0).add(cell.x.mul(1.2)).add(wn)).div(5.0);
    const p2 = clamp(mix(prof, terr, U.ragged.mul(0.25)), 0.0, 1.0);
    const rough = fbm4(dir, float(9.0), U.so.add(vec3(5.1, 2.2, -7.3)), maxF, float(0.6));
    const D = U.depth.mul(p2).mul(float(1).add(rough.mul(0.4))).add(cell.x.mul(0.015).mul(U.depth).mul(smoothstep(0.0, 0.25, prof)));
    const patchN = fbm4(dir, float(6.0), U.so.add(vec3(-3.3, 7.7, 1.9)), maxF, float(0.55));
    const fringe = select(inside, float(0), smoothstep(0.0, 0.1, patchN.add(0.18).sub(x.sub(1.0).mul(1.1))).mul(U.ragged));
    const sink = fringe.mul(crack.mul(0.01).add(0.007));
    const Din = select(inside, max(D, 0.0), float(0));
    const r = float(1).sub(Din).sub(sink);
    const rock = max(smoothstep(1.04, 0.97, x), fringe.mul(0.92));
    const glow = select(inside, smoothstep(0.86, 1.0, prof).mul(float(0.12).add(crack.mul(0.88))).add(crack.mul(smoothstep(0.55, 0.9, prof)).mul(0.22)), float(0));
    return vec4(r.sub(1.0), rock, glow, Din.add(sink));
  };

  const mainMat = make(() => {
    const { dir } = dirOfUV(uv());
    return kind === 'broken' ? (version >= 2 ? broken2(dir) : broken(dir)) : irregular(dir);
  });
  // the surface's normal, from the radius one texel either way (each read its own node, made here, so
  // the bake can point them all at the set's map before the first draw)
  const t = uv();
  const mainNodes = [];
  const rAtUV = (du, dv) => { const n = texture(new THREE.Texture(), t.add(vec2(du, dv)), float(0)); mainNodes.push(n); return n.r.add(1.0); };
  const tx = 1 / SW, ty = 1 / SH;
  const r0 = rAtUV(0, 0), rE = rAtUV(tx, 0), rW = rAtUV(-tx, 0), rN = rAtUV(0, ty), rS = rAtUV(0, -ty);
  const normalMat = make(() => {
    const { dir, lat, lon } = dirOfUV(t);
    const east = vec3(cos(lon), 0.0, sin(lon).negate());
    const north = vec3(sin(lat).negate().mul(sin(lon)), cos(lat), sin(lat).negate().mul(cos(lon)));
    const dE = rE.sub(rW).div(float(tx * 2 * TAU).mul(max(cos(lat), 0.01)));
    const dN = rN.sub(rS).div(ty * 2 * Math.PI);
    const nrm = normalize(dir.sub(east.mul(dE).add(north.mul(dN)).div(r0)));
    return vec4(nrm.mul(0.5).add(0.5), 1.0);
  });
  const kit = { U, mainMat, normalMat, mainNodes, quad: new THREE.QuadMesh(mainMat) };
  shapeKits.set(key, kit);
  return kit;
}

function shapeTargets() {
  const opt = { depthBuffer: false, colorSpace: THREE.NoColorSpace, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, format: THREE.RGBAFormat };
  const main = new THREE.RenderTarget(SW, SH, { ...opt, type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const normal = new THREE.RenderTarget(SW, SH, { ...opt, type: THREE.UnsignedByteType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, anisotropy: 8 });
  main.texture.name = 'shape'; normal.texture.name = 'shape-normal';
  return { main, normal };
}

const SHAPE_SALT = 7717;
/** Set a kit's numbers from a look's shape and seed (in JS, from the integer generator). */
function shapeNumbers(kit, gen) {
  const s = gen.shape, d = s.dials, U = kit.U;
  const r = rng(gen.seed * 9173 + SHAPE_SALT);
  U.so.value.set((r() - 0.5) * 200, (r() - 0.5) * 200, (r() - 0.5) * 200);
  if (s.kind === 'irregular') {
    const e = +d.elong, size = +d.size;
    const ax = [1 + 0.8 * e, 1 - 0.15 * e + (r() - 0.5) * 0.1 * e, 1 - 0.42 * e];
    const k = Math.cbrt(ax[0] * ax[1] * ax[2]);
    U.axes.value.set(ax[0] / k, ax[1] / k, ax[2] / k);
    U.lumpF.value = 0.85 + size * 1.5;
    U.lumpAmp.value = +d.lumps * (0.6 - 0.32 * size);
    U.facets.value = +d.facets;
    U.planes.array.forEach((v) => { const [x, y, z] = unitFrom(r); v.set(x, y, z, 0.62 + 0.3 * r() + 0.08 * size); });
    const n = Math.round(+d.craters * 20);
    U.craters.array.forEach((v, i) => {
      const [x, y, z] = unitFrom(r);
      const big = r();
      v.set(x, y, z, i < n ? (0.07 + 0.36 * big * big * big) * +d.craterSize * (1.25 - 0.5 * size) : 0);
    });
  } else {
    const yaw = (+d.woundYaw * Math.PI) / 180, pitch = (+d.woundPitch * Math.PI) / 180;
    U.wound.value.set(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw), (+d.woundSize * Math.PI) / 180);
    U.depth.value = +d.woundDepth;
    U.ragged.value = +d.ragged;
  }
}

/** The dials that shape the body (the colours and the glow are live: no bake). */
export const shapeKeyOf = (gen) => JSON.stringify([gen.seed, gen.shape.kind, gen.shape.version, Object.entries(gen.shape.dials).filter(([k]) => !LIVE_SHAPE.has(k) && !k.startsWith('stream'))]);
const LIVE_SHAPE = new Set(['rockColour', 'strataColour', 'glowColour', 'glow', 'streamDust', 'dustColour', 'streamColour']);

export class ShapeSet {
  constructor() {
    Object.assign(this, shapeTargets());
    this.key = '';
    this.refs = 0;
    this.lastMs = 0;
    this.disposed = false;
  }
  bake(renderer, gen) {
    const run = async () => {
      if (this.disposed) return 0;
      const t0 = performance.now();
      const kit = shapeKit(gen.shape.kind, gen.shape.version);
      shapeNumbers(kit, gen);
      for (const n of kit.mainNodes) n.value = this.main.texture;
      const prev = renderer.getRenderTarget();
      try {
        kit.quad.material = kit.mainMat; renderer.setRenderTarget(this.main); kit.quad.render(renderer);
        kit.quad.material = kit.normalMat; renderer.setRenderTarget(this.normal); kit.quad.render(renderer);
      } finally { renderer.setRenderTarget(prev); }
      await renderer.readRenderTargetPixelsAsync(this.normal, 0, 0, 1, 1);
      this.version = gen.shape.version || 1;
      this.key = shapeKeyOf(gen);
      this.lastMs = performance.now() - t0;
      return this.lastMs;
    };
    const p = shapeQueue.then(run, run);
    shapeQueue = p.catch(() => {});
    return p;
  }
  async pixels(renderer, which = 'main') {
    await shapeQueue;
    return renderer.readRenderTargetPixelsAsync(which === 'normal' ? this.normal : this.main, 0, 0, SW, SH);
  }
  dispose() { this.disposed = true; this.main.dispose(); this.normal.dispose(); }
}

const SHADOW_STEPS = [0.004, 0.01, 0.018, 0.03, 0.045, 0.065, 0.09, 0.125, 0.17, 0.23, 0.31, 0.42, 0.56, 0.75];

/**
 * What a shaped body's surface material needs from its maps: the vertex pushed out to the shape, the
 * shape's own normal, the map's channels, and the shadow the shape casts on itself (the sun's ray from
 * a point, marched outward: does it pass under the surface anywhere on its way?).
 */
export function shapeSurface(S) {
  const mainT = S.main.texture, nrmT = S.normal.texture;
  const rAt = (d) => texture(mainT, uvOfDir(d)).level(0).r.add(1.0);
  const g = normalize(positionGeometry);
  // version 2: a penumbra that widens with the distance to what casts it, and no shadow from bumps
  // finer than the mesh (they made hard black speckles across the lit side near the terminator)
  const v2 = (S.version || 1) >= 2;
  return {
    positionNode: g.mul(rAt(g)),
    normalAt: (d) => normalize(sampleLatLong(nrmT, d).xyz.mul(2.0).sub(1.0)),
    channels: (d) => sampleLatLong(mainT, d),
    selfShadow: (d, Lo, N) => {
      const P = d.mul(rAt(d)).add(N.mul(v2 ? 0.004 : 0.002));
      let sh = float(0);
      for (const s of v2 ? SHADOW_STEPS.slice(1) : SHADOW_STEPS) {
        const Q = P.add(Lo.mul(s));
        const rq = length(Q);
        sh = max(sh, clamp(rAt(Q.div(rq)).sub(rq).div(v2 ? 0.012 + s * 0.1 : 0.006 + s * 0.03), 0.0, 1.0));
      }
      return v2 ? smoothstep(0.0, 1.0, sh) : sh;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Rocks: four shapes a field, each a lumpy, broken stone, and an atlas of each seen from 256
// directions (colour, and surface direction with depth) for the cards that stand in for them.

const PROTOS = 4, VIEWS = 16, CELL = 48, ATLAS = 2 * VIEWS * CELL;

function rockArrays(seed, k, angular) {
  const r = rng(seed * 131 + k * 977 + 5);
  const a = icosphereArrays(3);
  const n = a.pos.length / 3;
  const ax = [1, 0.5 + 0.42 * r(), 0.36 + 0.42 * r()];
  const so = [r() * 100, r() * 100, r() * 100];
  const planes = [];
  const np = 3 + Math.floor(r() * 4);
  for (let i = 0; i < np; i++) planes.push([...unitFrom(r), 0.5 + 0.35 * r()]);
  const pos = new Float32Array(n * 3), shade = new Float32Array(n);
  let maxR = 0;
  const rads = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = a.pos[i * 3], y = a.pos[i * 3 + 1], z = a.pos[i * 3 + 2];
    const e = 1 / Math.hypot(x / ax[0], y / ax[1], z / ax[2]);
    let rad = e * (1 + 0.34 * fbmJ(x * 1.6 + so[0], y * 1.6 + so[1], z * 1.6 + so[2], 4)) + 0.05 * fbmJ(x * 5 + so[2], y * 5 + so[0], z * 5 + so[1], 3);
    for (const [px, py, pz, d] of planes) {
      const dn = x * px + y * py + z * pz;
      if (dn > 0.001) rad = rad + (smin(rad, d / dn, 0.06) - rad) * angular;
    }
    rads[i] = rad;
    maxR = Math.max(maxR, rad);
  }
  for (let i = 0; i < n; i++) {
    const rr = rads[i] / maxR;
    pos[i * 3] = a.pos[i * 3] * rr; pos[i * 3 + 1] = a.pos[i * 3 + 1] * rr; pos[i * 3 + 2] = a.pos[i * 3 + 2] * rr;
    // hollows a little darker, and a speckle of lighter and darker stone
    shade[i] = Math.min(1.15, Math.max(0.35, 0.62 + 0.4 * rr + 0.22 * fbmJ(a.pos[i * 3] * 7 + so[1], a.pos[i * 3 + 1] * 7, a.pos[i * 3 + 2] * 7 + so[0], 3)));
  }
  return { pos, shade, index: a.index };
}

function rockGeometry(arr) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr.pos, 3));
  g.setAttribute('shade', new THREE.BufferAttribute(arr.shade, 1));
  g.setIndex(new THREE.BufferAttribute(arr.index, 1));
  g.computeVertexNormals();
  return g;
}

const atlases = new Map();
/** The rock shapes and their atlas for a seed (shared by every field of that seed; counted). */
async function acquireRocks(renderer, seed, angular) {
  const key = `${seed}|${angular.toFixed(2)}`;
  let A = atlases.get(key);
  if (A) { A.refs++; await A.ready; return A; }
  A = { key, refs: 1, geoms: [], ready: null };
  atlases.set(key, A);
  A.ready = (async () => {
    for (let k = 0; k < PROTOS; k++) A.geoms.push(rockGeometry(rockArrays(seed, k, angular)));
    const opt = { depthBuffer: true, colorSpace: THREE.NoColorSpace, type: THREE.UnsignedByteType, format: THREE.RGBAFormat, generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping };
    A.colour = new THREE.RenderTarget(ATLAS, ATLAS, opt);
    A.normal = new THREE.RenderTarget(ATLAS, ATLAS, opt);
    const scene = new THREE.Scene();
    const meshesC = [], meshesN = [];
    for (let k = 0; k < PROTOS; k++) {
      const ig = new THREE.InstancedBufferGeometry();
      ig.index = A.geoms[k].index;
      for (const [n, at] of Object.entries(A.geoms[k].attributes)) ig.setAttribute(n, at);
      ig.instanceCount = VIEWS * VIEWS;
      const bx = k % 2, by = Math.floor(k / 2);
      const mat = (which) => {
        const m = new THREE.NodeMaterial();
        const fi = float(instanceIndex);
        const cy = floor(fi.div(VIEWS)), cx = fi.sub(cy.mul(VIEWS));
        const vc = octDecode(vec2(cx, cy).add(0.5).div(VIEWS));
        const { right, up } = basisOf(vc);
        const p = positionGeometry;
        const x = dot(p, right), y = dot(p, up), z = dot(p, vc);
        const u = float(bx * VIEWS).add(cx).add(0.5).add(x.mul(0.47)).div(2 * VIEWS);
        const v = float(by * VIEWS).add(cy).add(0.5).add(y.mul(0.47)).div(2 * VIEWS);
        m.vertexNode = vec4(u.mul(2).sub(1), v.mul(2).sub(1), float(0.5).sub(z.mul(0.49)), 1.0);
        const zv = varying(z);
        m.fragmentNode = which === 'colour'
          ? vec4(vec3(pow(max(varying(attribute('shade', 'float')), 0.0), 1 / 2.2)), 1.0)
          : vec4(normalize(varying(normalGeometry)).mul(0.5).add(0.5), zv.mul(0.5).add(0.5));
        m.side = THREE.DoubleSide;
        return m;
      };
      const mesh = new THREE.Mesh(ig, mat('colour'));
      mesh.frustumCulled = false;
      meshesC.push(mesh.material); meshesN.push(mat('normal'));
      scene.add(mesh);
    }
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const prev = renderer.getRenderTarget();
    const cc = new THREE.Color(); renderer.getClearColor(cc); const ca = renderer.getClearAlpha();
    try {
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(A.colour); renderer.render(scene, cam);
      scene.children.forEach((m, i) => { m.material = meshesN[i]; });
      // round the rocks, no direction and middle depth: the smaller mip levels then average toward a
      // shorter vector of the same way (normalised back), never toward a made-up direction
      renderer.setClearColor(0x808080, 0.5);
      renderer.setRenderTarget(A.normal); renderer.render(scene, cam);
    } finally {
      renderer.setRenderTarget(prev);
      renderer.setClearColor(cc, ca);
    }
    await renderer.readRenderTargetPixelsAsync(A.normal, 0, 0, 1, 1);
    for (const m of [...meshesC, ...meshesN]) m.dispose();
    scene.children.forEach((m) => m.geometry.dispose());
  })();
  await A.ready;
  return A;
}
function releaseRocks(A) {
  if (!A || --A.refs > 0) return;
  setTimeout(() => {
    if (A.refs > 0) return;
    atlases.delete(A.key);
    A.colour?.dispose(); A.normal?.dispose();
    for (const g of A.geoms) g.dispose();
  }, 4000);
}

// ---------------------------------------------------------------------------------------------
// Where the rocks are: a belt, a debris field or a broken planet's stream. Each rock: its place and
// size (iPos), its turn (iRot, a quaternion), its shape, brightness and colour mix (iMisc). And the
// dust: a few hundred soft puffs over the same places (dPos: place and size; dMisc: density, turn).

function sizeOf(r, lo, hi) { const u = r(); return lo * Math.pow(hi / lo, u * u * u); }
function quatFrom(r) {
  const u1 = r(), u2 = r() * TAU, u3 = r() * TAU;
  const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  return [a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3)];
}

function beltDensity(u, gaps, gw) {
  if (u < 0 || u > 1) return 0;
  const edge = Math.min(1, u / 0.12) * Math.min(1, (1 - u) / 0.15);
  let d = edge * edge * (3 - 2 * edge);
  for (const g of gaps) { const t = (u - g) / Math.max(0.002, gw); d *= 1 - Math.exp(-t * t * 2); }
  return d;
}

/** Every rock and puff of a part, from its seed and dials. `kind`: 'belt', 'field' or 'stream'. */
export function fieldLayout(kind, seed, d, ver = 1) {
  const r = rng(seed * 6007 + (kind === 'stream' ? 41 : kind === 'field' ? 23 : 7));
  const so = [r() * 50, r() * 50, r() * 50];
  const n = Math.round(kind === 'stream' ? +d.streamCount : +d.count);
  const pos = new Float32Array(n * 4), rot = new Float32Array(n * 4), misc = new Float32Array(n * 4);
  const M = n ? (kind === 'belt' ? 1100 : kind === 'field' ? 700 : 900) : 0;
  const dPos = new Float32Array(M * 4), dMisc = new Float32Array(M * 4);
  let extent = 1;
  const variety = kind === 'stream' ? 0.4 : +d.variety;
  const put = (i, x, y, z, rad) => {
    pos[i * 4] = x; pos[i * 4 + 1] = y; pos[i * 4 + 2] = z; pos[i * 4 + 3] = rad;
    const q = quatFrom(r);
    rot.set(q, i * 4);
    misc[i * 4] = Math.floor(r() * PROTOS);
    misc[i * 4 + 1] = 1 + (r() - 0.5) * 0.5 * (0.4 + variety);
    misc[i * 4 + 2] = Math.min(1, Math.max(0, 0.5 + (r() - 0.5) * 1.6 * variety + 0.35 * noiseJ(x * 2 + so[0], y * 2, z * 2 + so[1])));
    misc[i * 4 + 3] = r();
  };
  let sample;
  if (kind === 'belt') {
    const gaps = [];
    const gr = rng(seed * 6007 + 99);
    for (let g = 0; g < Math.round(+d.gaps); g++) gaps.push(0.15 + 0.7 * gr());
    const inner = +d.inner, outer = Math.max(+d.outer, inner + 0.05), th = +d.thickness, clumps = +d.clumps;
    extent = outer;
    sample = (big) => {
      for (let tries = 0; tries < 60; tries++) {
        const rr = Math.sqrt(inner * inner + r() * (outer * outer - inner * inner));
        const u = (rr - inner) / (outer - inner);
        const a = r() * TAU;
        const x = rr * Math.cos(a), z = rr * Math.sin(a);
        let keep = beltDensity(u, gaps, +d.gapWidth) * (0.75 + 0.25 * fbmJ(u * 9 + so[0], so[1], so[2], 3) * 2);
        if (clumps > 0) keep *= 1 - clumps + clumps * Math.min(1, Math.max(0, 0.5 + 1.6 * noiseJ(x * 2.2 + so[2], z * 2.2 + so[0], so[1])));
        if (r() > keep) continue;
        return [x, gauss(r) * th * 0.25 * rr * (big ? 0.6 : 1), z];
      }
      return [inner, 0, 0];
    };
    for (let i = 0; i < n; i++) { const [x, y, z] = sample(false); put(i, x, y, z, sizeOf(r, +d.sizeMin, Math.max(+d.sizeMax, +d.sizeMin * 1.01))); }
    const w = (outer - inner);
    for (let j = 0; j < M; j++) {
      const [x, y, z] = sample(true);
      dPos.set([x, y * 0.5, z, w * (0.07 + 0.08 * r()) + th * 0.12 * outer], j * 4);
      dMisc.set([0.5 + 0.5 * r(), 0, 0, r() * TAU], j * 4);
    }
  } else if (kind === 'field') {
    const inner = +d.inner * 0, R = Math.max(+d.outer, 0.2), flat = Math.max(0.05, +d.thickness), clumps = +d.clumps;
    extent = R;
    const centres = [];
    for (let c = 0; c < 7; c++) { const [x, y, z] = unitFrom(r); const s = Math.cbrt(r()) * R * 0.75; centres.push([x * s, y * s * flat, z * s, R * (0.12 + 0.2 * r())]); }
    sample = () => {
      if (r() < clumps) {
        const c = centres[Math.floor(r() * centres.length)];
        return [c[0] + gauss(r) * c[3], c[1] + gauss(r) * c[3] * flat, c[2] + gauss(r) * c[3]];
      }
      const [x, y, z] = unitFrom(r);
      const s = R * Math.cbrt(r()) * (0.25 + 0.75 * Math.pow(r(), 0.3)) + inner;
      return [x * s, y * s * flat, z * s];
    };
    for (let i = 0; i < n; i++) { const [x, y, z] = sample(); put(i, x, y, z, sizeOf(r, +d.sizeMin, Math.max(+d.sizeMax, +d.sizeMin * 1.01))); }
    for (let j = 0; j < M; j++) {
      const [x, y, z] = sample();
      dPos.set([x, y, z, R * (0.12 + 0.12 * r())], j * 4);
      dMisc.set([0.4 + 0.6 * r(), 0, 0, r() * TAU], j * 4);
    }
  } else if (ver >= 2) {
    // the stream, version 2: the debris leaves along the body's way rather than straight out, as a flat
    // ribbon that widens slowly; most trails behind and a shorter arm leads ahead (a body torn apart sheds
    // both ways), the big blocks near the wound and the fine stuff far out
    const yaw = (+d.woundYaw * Math.PI) / 180, pitch = (+d.woundPitch * Math.PI) / 180;
    const W = new THREE.Vector3(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw));
    const p1 = new THREE.Vector3(0, 1, 0).cross(W);
    if (p1.lengthSq() < 1e-4) p1.set(1, 0, 0);
    p1.normalize();
    const p2 = new THREE.Vector3().crossVectors(W, p1);
    const tr = (+d.streamTrail * Math.PI) / 180;
    const T = p1.clone().multiplyScalar(Math.cos(tr)).addScaledVector(p2, Math.sin(tr));
    const Np = new THREE.Vector3().crossVectors(W, T).normalize();
    const L = +d.streamLength, sp = +d.streamSpread, cv = +d.streamCurve, alpha = (+d.woundSize * Math.PI) / 180, depth = +d.woundDepth;
    const rock = 0.02 * +d.streamRock;
    extent = 1 + L * 0.6;
    const arm = (sign, len, bend) => {
      const D = W.clone().multiplyScalar(0.32).addScaledVector(T, sign).normalize();
      return { D, B: new THREE.Vector3().crossVectors(Np, D).normalize(), len, bend };
    };
    const arms = [arm(1, L, cv), arm(-1, L * 0.45, -cv * 0.7)];
    const at = (t, wide, a) => {
      const c = W.clone().multiplyScalar(0.95).addScaledVector(a.D, t * a.len).addScaledVector(a.B, t * t * a.len * a.bend * 0.55);
      const s = (0.08 + sp * 0.7 * t) * Math.min(1, 0.4 + t * 3) * a.len * 0.16 * wide;
      return c.addScaledVector(a.B, gauss(r) * s).addScaledVector(Np, gauss(r) * s * 0.22).addScaledVector(a.D, gauss(r) * s * 0.5);
    };
    for (let i = 0; i < n; i++) {
      let p, t;
      const u = r();
      if (u < 0.1) {
        // rubble still sitting in and over the wound
        const a = Math.sqrt(r()) * alpha * 0.95, th = r() * TAU;
        const dir = W.clone().multiplyScalar(Math.cos(a)).addScaledVector(p1, Math.sin(a) * Math.cos(th)).addScaledVector(p2, Math.sin(a) * Math.sin(th));
        const x = a / alpha;
        p = dir.multiplyScalar(1 - depth * Math.sqrt(Math.max(0, 1 - x * x)) * (0.15 + 0.75 * r()) + 0.03 * r());
        t = 0;
      } else {
        t = Math.pow(r(), 1.15);
        p = at(t, 1, arms[u < 0.32 ? 1 : 0]);
      }
      put(i, p.x, p.y, p.z, sizeOf(r, rock * 0.1, rock * (2.8 - 2.0 * t)));
    }
    for (let j = 0; j < M; j++) {
      const a = arms[r() < 0.25 ? 1 : 0];
      const t = Math.pow(r(), 1.2);
      const p = at(t, 0.9, a);
      dPos.set([p.x, p.y, p.z, ((0.05 + sp * 0.55 * t) * a.len * 0.13 + 0.07) * 1.8], j * 4);
      dMisc.set([(0.5 + 0.5 * r()) * (1.1 - 0.45 * t), 0, 0, r() * TAU], j * 4);
    }
  } else {
    // the stream: from the wound, out and along, bending as it trails, fanning out as it goes
    const yaw = (+d.woundYaw * Math.PI) / 180, pitch = (+d.woundPitch * Math.PI) / 180;
    const W = new THREE.Vector3(Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw));
    const p1 = new THREE.Vector3(0, 1, 0).cross(W);
    if (p1.lengthSq() < 1e-4) p1.set(1, 0, 0);
    p1.normalize();
    const p2 = new THREE.Vector3().crossVectors(W, p1);
    const tr = (+d.streamTrail * Math.PI) / 180;
    const T = p1.clone().multiplyScalar(Math.cos(tr)).addScaledVector(p2, Math.sin(tr));
    const D = W.clone().multiplyScalar(0.6).addScaledVector(T, 0.8).normalize();
    const Np = new THREE.Vector3().crossVectors(W, T).normalize();
    const B = new THREE.Vector3().crossVectors(Np, D);
    const L = +d.streamLength, sp = +d.streamSpread, cv = +d.streamCurve, alpha = (+d.woundSize * Math.PI) / 180, depth = +d.woundDepth;
    const rock = 0.02 * +d.streamRock;
    extent = 1 + L * 0.6;
    const at = (t, wide) => {
      const c = W.clone().multiplyScalar(0.9).addScaledVector(D, t * L).addScaledVector(B, t * t * L * cv * 0.55);
      const s = (0.08 + sp * 0.95 * t) * Math.min(1, 0.25 + t * 4) * L * 0.16 * wide;
      return c.addScaledVector(B, gauss(r) * s).addScaledVector(Np, gauss(r) * s * 0.4).addScaledVector(D, gauss(r) * s * 0.35);
    };
    for (let i = 0; i < n; i++) {
      let p, t;
      if (r() < 0.12) {
        // rubble still sitting in and over the wound
        const a = Math.sqrt(r()) * alpha * 0.95, th = r() * TAU;
        const dir = W.clone().multiplyScalar(Math.cos(a)).addScaledVector(p1, Math.sin(a) * Math.cos(th)).addScaledVector(p2, Math.sin(a) * Math.sin(th));
        const x = a / alpha;
        p = dir.multiplyScalar(1 - depth * Math.sqrt(Math.max(0, 1 - x * x)) * (0.15 + 0.75 * r()) + 0.03 * r());
        t = 0;
      } else {
        t = Math.pow(r(), 1.7);
        p = at(t, 1);
      }
      put(i, p.x, p.y, p.z, sizeOf(r, rock * 0.12, rock * (2.6 - 1.6 * t)));
    }
    for (let j = 0; j < M; j++) {
      const t = Math.pow(r(), 1.3);
      const p = at(t, 0.8);
      dPos.set([p.x, p.y, p.z, ((0.05 + sp * 0.5 * t) * L * 0.12 + 0.06) * 1.6], j * 4);
      dMisc.set([(0.5 + 0.5 * r()) * (1.15 - 0.5 * t), 0, 0, r() * TAU], j * 4);
    }
  }
  return { n, pos, rot, misc, M, dPos, dMisc, extent };
}

// ---------------------------------------------------------------------------------------------
// A part's rocks on the stage: the near rocks (real meshes, up to NEAR_MAX of them, picked as the
// camera moves), every other rock as a card from the atlas, and the dust. The hand-over between a rock
// and its card, and between a card and nothing, is dithered over a band of on-screen sizes.

export const FIELD_TUNE = { nearPx: 22, nearMax: 700, farPx: 0.25 };
const QUAD = new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]);
const QUAD_INDEX = [0, 1, 2, 0, 2, 3];
const _inv = new THREE.Matrix4(), _cam = new THREE.Vector3(), _size = new THREE.Vector2();

function quadGeometry(count) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(QUAD, 3));
  g.setIndex(QUAD_INDEX);
  g.instanceCount = count;
  return g;
}

function rockLight(P, N, shade, misc, LU, FU, Lo, camO) {
  const albedo = mix(FU.colour, FU.colour2, misc.z).mul(misc.y).mul(shade);
  const mu0 = max(dot(N, Lo), 0.0);
  const mu = max(dot(N, normalize(camO.sub(P))), 0.05);
  const diff = mix(mu0, mu0.mul(2.0).div(mu0.add(mu)), 0.35);
  const sh = planetShadow(P, Lo, FU.planetR);
  const lit = vec3(LU.ambient).add(LU.sunColour.mul(diff.mul(LU.sunPower).mul(float(1).sub(sh))));
  // the broken planet's glowing heart lights the rubble nearest it
  const warm = FU.warm.xyz.mul(FU.warm.w).mul(exp(length(P.sub(FU.warmAt)).mul(-6.0))).mul(max(dot(N, normalize(FU.warmAt.sub(P))), 0.0).mul(0.8).add(0.2));
  return albedo.mul(lit).add(albedo.mul(warm)).mul(LU.gain);
}

export class Field {
  /** `layout` from fieldLayout; `FU` the part's own uniforms (colours, dust, planet radius). */
  constructor(layout, LU, FU) {
    this.L = layout;
    this.LU = LU;
    this.FU = FU;
    this.group = new THREE.Group();
    this.rocks = null;
    this.near = [];
    this.flags = null;
    this.lastCam = new THREE.Vector3(1e9, 0, 0);
    this.frameNo = 0;
    this.lastSelect = -10;
    this.nearShown = 0;
    this.minDist = 1e9;
  }

  async build(renderer, seed, angular) {
    const L = this.L, LU = this.LU, FU = this.FU;
    if (L.n) {
      this.rocks = await acquireRocks(renderer, seed, angular);
      this.buildCards();
      this.buildNear();
    }
    if (L.M) this.buildDust();
    return this;
  }

  buildCards() {
    const L = this.L, LU = this.LU, FU = this.FU, A = this.rocks;
    const g = quadGeometry(L.n);
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(L.pos, 4));
    g.setAttribute('iRot', new THREE.InstancedBufferAttribute(L.rot, 4));
    g.setAttribute('iMisc', new THREE.InstancedBufferAttribute(L.misc, 4));
    this.flags = new Float32Array(L.n);
    const nearAttr = new THREE.InstancedBufferAttribute(this.flags, 1);
    nearAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iNear', nearAttr);
    this.nearAttr = nearAttr;
    const iPos = attribute('iPos', 'vec4'), iRot = attribute('iRot', 'vec4'), iMisc = attribute('iMisc', 'vec4'), iNear = attribute('iNear', 'float');
    const { Lo, camO } = frameNodes(LU);
    const toCam = camO.sub(iPos.xyz);
    const dist = max(length(toCam), 0.000001);
    const vL = qinv(iRot, toCam.div(dist));
    const cell = clamp(floor(octEncode(vL).mul(VIEWS)), 0.0, VIEWS - 1);
    const vcL = octDecode(cell.add(0.5).div(VIEWS));
    const B = basisOf(vcL);
    const rO = qrot(iRot, B.right), uO = qrot(iRot, B.up), vO = qrot(iRot, vcL);
    const pix = iPos.w.mul(FU.projScale).div(dist);
    const fadeNear = iNear.mul(smoothstep(FU.nearPx, FU.nearPx.mul(1.3), pix));
    const cover = smoothstep(FU.farPx, FU.farPx.mul(3.5), pix);
    const gone = fadeNear.greaterThan(0.999).or(cover.lessThan(0.002));
    const s = select(gone, float(0), iPos.w);
    const c = positionGeometry.xy;
    const m = new THREE.MeshBasicNodeMaterial();
    m.positionNode = iPos.xyz.add(rO.mul(c.x).add(uO.mul(c.y)).mul(s));
    const proto = iMisc.x;
    const by = floor(proto.mul(0.5)), bx = proto.sub(by.mul(2.0));
    const vUV = varying(vec2(bx.mul(VIEWS).add(cell.x).add(0.5).add(c.x.mul(0.47)), by.mul(VIEWS).add(cell.y).add(0.5).add(c.y.mul(0.47))).div(2 * VIEWS));
    const vC = varying(c), vFade = varying(fadeNear), vCover = varying(cover), vR = varying(rO), vU = varying(uO), vV = varying(vO);
    const vRot = varying(iRot), vPos = varying(iPos), vMisc = varying(iMisc);
    // (an atlas drawn by writing clip positions comes out upside down as three samples a render target,
    // on WebGPU and WebGL alike: seen by eye, every card lit from the wrong view until it was turned)
    const uvS = vec2(vUV.x, float(1).sub(vUV.y));
    const Ac = texture(A.colour.texture, uvS), Nd = texture(A.normal.texture, uvS);
    const dith = ign(screenCoordinate.xy);
    const show = Ac.a.greaterThan(0.5).and(dith.greaterThanEqual(vFade)).and(dith.lessThan(vCover));
    const nO = normalize(qrot(vRot, Nd.xyz.mul(2.0).sub(1.0)));
    const P = vPos.xyz.add(vR.mul(vC.x).add(vU.mul(vC.y)).add(vV.mul(Nd.w.mul(2.0).sub(1.0))).mul(vPos.w));
    // (the colour's smaller mip levels are its shade times its cover: divided back out)
    m.colorNode = vec4(seenThrough(LU, rockLight(P, nO, toL(Ac.r.div(max(Ac.a, 0.05))), vMisc, LU, FU, Lo, camO)), 1.0);
    m.opacityNode = select(show, float(1), float(0));
    m.alphaTest = 0.5;
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    this.cards = mesh;
    this.group.add(mesh);
  }

  buildNear() {
    const LU = this.LU, FU = this.FU, A = this.rocks;
    const cap = FIELD_TUNE.nearMax;
    for (let k = 0; k < PROTOS; k++) {
      const g = new THREE.InstancedBufferGeometry();
      g.index = A.geoms[k].index;
      for (const [n, at] of Object.entries(A.geoms[k].attributes)) g.setAttribute(n, at);
      const arrs = { pos: new Float32Array(cap * 4), rot: new Float32Array(cap * 4), misc: new Float32Array(cap * 4) };
      const attrs = {};
      for (const [name, key] of [['iPos', 'pos'], ['iRot', 'rot'], ['iMisc', 'misc']]) {
        attrs[key] = new THREE.InstancedBufferAttribute(arrs[key], 4);
        attrs[key].setUsage(THREE.DynamicDrawUsage);
        g.setAttribute(name, attrs[key]);
      }
      g.instanceCount = 0;
      const iPos = attribute('iPos', 'vec4'), iRot = attribute('iRot', 'vec4'), iMisc = attribute('iMisc', 'vec4');
      const { Lo, camO } = frameNodes(LU);
      const P = iPos.xyz.add(qrot(iRot, positionGeometry).mul(iPos.w));
      const pix = iPos.w.mul(FU.projScale).div(max(length(camO.sub(iPos.xyz)), 0.000001));
      const m = new THREE.MeshBasicNodeMaterial();
      m.positionNode = P;
      const vP = varying(P), vN = varying(qrot(iRot, normalGeometry)), vG = varying(positionGeometry), vMisc = varying(iMisc);
      const vFade = varying(smoothstep(FU.nearPx, FU.nearPx.mul(1.3), pix));
      const vShade = varying(attribute('shade', 'float'));
      const detail = noise3(vG.mul(7.0).add(vMisc.w.mul(37.0))).mul(0.16).add(noise3(vG.mul(19.0).add(vMisc.w.mul(11.0))).mul(0.08));
      m.colorNode = vec4(seenThrough(LU, rockLight(vP, normalize(vN), vShade.mul(float(1).add(detail)), vMisc, LU, FU, Lo, camO)), 1.0);
      m.opacityNode = select(ign(screenCoordinate.xy).lessThan(vFade), float(1), float(0));
      m.alphaTest = 0.5;
      const mesh = new THREE.Mesh(g, m);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      this.group.add(mesh);
      this.near.push({ mesh, g, arrs, attrs, count: 0 });
    }
  }

  buildDust() {
    const L = this.L, LU = this.LU, FU = this.FU;
    const g = quadGeometry(L.M);
    g.setAttribute('dPos', new THREE.InstancedBufferAttribute(L.dPos, 4));
    g.setAttribute('dMisc', new THREE.InstancedBufferAttribute(L.dMisc, 4));
    const dPos = attribute('dPos', 'vec4'), dMisc = attribute('dMisc', 'vec4');
    const { Lo, camO } = frameNodes(LU);
    const toCam = camO.sub(dPos.xyz);
    const dist = max(length(toCam), 0.000001);
    const vW = toCam.div(dist);
    const B = basisOf(vW);
    const c = positionGeometry.xy;
    const m = new THREE.MeshBasicNodeMaterial();
    m.positionNode = dPos.xyz.add(B.right.mul(c.x).add(B.up.mul(c.y)).mul(dPos.w));
    const ca = cos(dMisc.w), sa = sin(dMisc.w);
    const vUV = varying(vec2(c.x.mul(ca).sub(c.y.mul(sa)), c.x.mul(sa).add(c.y.mul(ca))).mul(0.5).add(0.5));
    const fadeNear = smoothstep(dPos.w.mul(0.4), dPos.w.mul(2.5), dist);
    const shadow = planetShadow(dPos.xyz, Lo, FU.planetR);
    const cosT = dot(vW, Lo).negate();
    const gg = 0.55;
    const hg = float(1 - gg * gg).div(pow(float(1 + gg * gg).sub(cosT.mul(2 * gg)), 1.5));
    const phase = float(0.3).add(hg.mul(0.22));
    const vLight = varying(phase.mul(float(1).sub(shadow.mul(0.93))));
    const vAmt = varying(dMisc.x.mul(fadeNear));
    const sprite = texture(dustSprite(), vUV).r;
    m.colorNode = vec4(seenThrough(LU, FU.dustColour.mul(LU.sunColour.mul(LU.sunPower).mul(vLight).add(LU.ambient)).mul(LU.gain), true), 1.0);
    m.opacityNode = sprite.mul(vAmt).mul(FU.dust).mul(0.07);
    m.transparent = true;
    m.depthWrite = false;
    m.blending = THREE.AdditiveBlending;
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    this.dust = mesh;
    this.group.add(mesh);
  }

  /**
   * Each frame: which rocks are near enough on screen to be drawn as rocks. Only while the camera
   * moves (or the view changes), at most every second frame, into the arrays kept for it.
   */
  update(camera, renderer) {
    this.frameNo++;
    const FU = this.FU;
    if (renderer) renderer.getDrawingBufferSize(_size);
    const fov = camera.isPerspectiveCamera ? camera.fov : 50;
    const K = (_size.y || 900) / (2 * Math.tan((fov * Math.PI) / 360));
    const kChanged = Math.abs(FU.projScale.value - K) > 0.5;
    // (the GPU port's pass 2, wave 5) written only when it moves: a number written into a float uniform's own `value` is a
    // number made, and the game measures its rocks every frame (a move under half a pixel's scale is no change to see)
    if (kChanged) FU.projScale.value = K;
    if (!this.L.n || !this.flags) return;
    _inv.copy(this.group.matrixWorld).invert();
    _cam.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(_inv);
    // (the GPU port's pass 2, wave 5) written out: a number handed back by a call the compiler does not build in is a number made
    const lc = this.lastCam, mx = _cam.x - lc.x, my = _cam.y - lc.y, mz = _cam.z - lc.z;
    const moved = mx * mx + my * my + mz * mz;
    const need = moved > (this.minDist * 0.03) ** 2 || kChanged;
    if (!need || this.frameNo - this.lastSelect < 2) return;
    this.lastSelect = this.frameNo;
    this.lastCam.copy(_cam);
    this.select(_cam.x, _cam.y, _cam.z, K);
  }

  select(cx, cy, cz, K) {
    const { n, pos, rot, misc } = this.L;
    const cap = FIELD_TUNE.nearMax;
    let T = (FIELD_TUNE.nearPx * 0.8) / K;
    let count = 0, minD2 = Infinity;
    for (let pass = 0; pass < 10; pass++) {
      const T2 = T * T;
      count = 0;
      minD2 = Infinity;
      for (let i = 0; i < n; i++) {
        const dx = pos[i * 4] - cx, dy = pos[i * 4 + 1] - cy, dz = pos[i * 4 + 2] - cz, rr = pos[i * 4 + 3];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < minD2) minD2 = d2;
        if (rr * rr > T2 * d2) count++;
      }
      if (count <= cap) break;
      T *= 1.3;
    }
    this.minDist = Math.max(1e-5, Math.sqrt(minD2));
    const T2 = T * T;
    for (const nb of this.near) nb.count = 0;
    const flags = this.flags;
    let shown = 0;
    for (let i = 0; i < n; i++) {
      const dx = pos[i * 4] - cx, dy = pos[i * 4 + 1] - cy, dz = pos[i * 4 + 2] - cz, rr = pos[i * 4 + 3];
      const isNear = rr * rr > T2 * (dx * dx + dy * dy + dz * dz);
      const nb = isNear ? this.near[misc[i * 4]] : null;
      if (nb && nb.count < cap) {
        const j = nb.count++ * 4, k = i * 4;
        for (let q = 0; q < 4; q++) { nb.arrs.pos[j + q] = pos[k + q]; nb.arrs.rot[j + q] = rot[k + q]; nb.arrs.misc[j + q] = misc[k + q]; }
        flags[i] = 1;
        shown++;
      } else flags[i] = 0;
    }
    for (const nb of this.near) {
      nb.g.instanceCount = nb.count;
      if (nb.count) { nb.attrs.pos.needsUpdate = true; nb.attrs.rot.needsUpdate = true; nb.attrs.misc.needsUpdate = true; }
    }
    this.nearAttr.needsUpdate = true;
    this.nearShown = shown;
  }

  dispose() {
    this.group.traverse((o) => { if (o.isMesh) { o.material.dispose(); if (o.geometry.isInstancedBufferGeometry) o.geometry.dispose(); } });
    this.group.removeFromParent();
    releaseRocks(this.rocks);
    this.rocks = null;
  }
}

// a soft, frayed puff of dust (64 x 64, made once)
let spriteTex = null;
function dustSprite() {
  if (spriteTex) return spriteTex;
  const N = 64, data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1;
    const r2 = u * u + v * v;
    const fall = Math.max(0, 1 - r2);
    const n = 0.75 + 0.25 * fbmJ(u * 2.5 + 3.1, v * 2.5 - 1.7, 0.37, 4) * 2;
    const val = Math.max(0, Math.min(1, fall * fall * n));
    const i = (y * N + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = Math.round(val * 255); data[i + 3] = 255;
  }
  spriteTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  spriteTex.generateMipmaps = true;
  spriteTex.minFilter = THREE.LinearMipmapLinearFilter;
  spriteTex.magFilter = THREE.LinearFilter;
  spriteTex.colorSpace = THREE.NoColorSpace;
  spriteTex.needsUpdate = true;
  return spriteTex;
}

// ---------------------------------------------------------------------------------------------
// Rings: a profile across the ring (density, colour mix, brightness) baked from the dials into a
// 1024 x 1 texture, drawn on a flat annulus lit from either face, with the body's shadow across it;
// the rings' shadow falls on the body too (ringShadow, used by the body's surface).

const RING_SCATTER = { dusty: 1.6, icy: 0.3, banded: 0.55 };
export function ringProfile(seed, style, d) {
  const N = 1024, data = new Uint8Array(N * 4);
  const r = rng(seed * 3001 + 17);
  const so = [r() * 50, r() * 50, r() * 50];
  const gaps = [];
  for (let g = 0; g < Math.round(+d.gaps); g++) gaps.push([0.12 + 0.8 * r(), +d.gapWidth * (0.5 + r())]);
  for (let i = 0; i < N; i++) {
    const u = (i + 0.5) / N;
    const edge = Math.min(1, u / 0.04) * Math.min(1, (1 - u) / 0.06);
    let broad = fbmJ(u * 5 + so[0], so[1], so[2], 3) * 2;
    if (style === 'banded') broad = Math.round(broad * 2.5) / 2.5 * 0.8 + broad * 0.2;
    const fine = fbmJ(u * 90 + so[1], so[2], so[0], 3) * 2;
    let dens = (0.62 + 0.38 * Math.tanh(broad * (0.5 + 1.8 * +d.bands))) * (1 + (style === 'dusty' ? 0.35 : 0.6) * +d.fine * fine);
    dens *= style === 'dusty' ? 0.7 + 0.3 * u : 1;
    for (const [g, w] of gaps) { const t = (u - g) / Math.max(0.002, w); dens *= 1 - 0.97 * Math.exp(-t * t * 1.5); }
    dens *= edge;
    const mixC = Math.min(1, Math.max(0, 0.5 + 0.55 * fbmJ(u * 3 + so[2], so[0], so[1], 3) * 2 * (style === 'banded' ? 1.3 : 0.8)));
    const bright = Math.min(1, Math.max(0, 0.5 + 0.35 * fine));
    data[i * 4] = Math.round(Math.min(1, Math.max(0, dens)) * 255);
    data[i * 4 + 1] = Math.round(mixC * 255);
    data[i * 4 + 2] = Math.round(bright * 255);
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}
export const ringKeyOf = (gen) => JSON.stringify([gen.seed, gen.rings.style, gen.rings.version, ['bands', 'fine', 'gaps', 'gapWidth'].map((k) => gen.rings.dials[k])]);
export const ringScatter = (style) => RING_SCATTER[style] ?? 0.6;

const ringGeoms = new Map();
export function ringMesh(prof, LU, RU) {
  if (!ringGeoms.has('r')) {
    const g = new THREE.RingGeometry(1, 2, 384, 1);
    g.rotateX(-Math.PI / 2);
    g.userData.shared = true;
    ringGeoms.set('r', g);
  }
  const m = new THREE.MeshBasicNodeMaterial();
  // the shared annulus (1 to 2) stretched to the ring's edges in the vertex
  const p0 = positionGeometry;
  const rad0 = length(p0.xz);
  const radN = RU.inner.add(rad0.sub(1.0).mul(RU.outer.sub(RU.inner)));
  const P = vec3(p0.x.div(rad0).mul(radN), 0.0, p0.z.div(rad0).mul(radN));
  m.positionNode = P;
  const vP = varying(P);
  const { Lo, camO } = frameNodes(LU);
  const u = length(vP.xz).sub(RU.inner).div(RU.outer.sub(RU.inner));
  const pr = texture(prof, vec2(u, 0.5));
  const alpha = clamp(pr.r.mul(RU.opacity), 0.0, 0.995);
  const colour = mix(RU.c2, RU.c1, pr.g).mul(pr.b.mul(0.5).add(0.75));
  const V = normalize(camO.sub(vP));
  const mu0 = abs(Lo.y), mu = max(abs(V.y), 0.02);
  const sameSide = Lo.y.mul(V.y).greaterThan(0.0);
  const ls = mu0.mul(2.0).div(mu0.add(mu));
  // the lit face reflects; seen from the unlit face, light comes through where the ring is thin,
  // and fine dust throws light forward (bright seen toward the sun)
  const through = ls.mul(float(1).sub(alpha).mul(0.9).add(0.1)).mul(0.6);
  const fwd = pow(max(dot(V.negate(), Lo), 0.0), 6.0).mul(RU.scatter).mul(1.5);
  const amount = select(sameSide, ls, through).add(fwd);
  const sh = planetShadow(vP, Lo, RU.planetR);
  const lit = vec3(LU.ambient).add(LU.sunColour.mul(amount.mul(LU.sunPower).mul(float(1).sub(sh))));
  m.colorNode = vec4(seenThrough(LU, colour.mul(lit).mul(RU.bright).mul(LU.gain)), 1.0);
  m.opacityNode = alpha;
  m.transparent = true;
  m.depthWrite = false;
  m.side = THREE.DoubleSide;
  const mesh = new THREE.Mesh(ringGeoms.get('r'), m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return mesh;
}
/** How much of the sun the rings take from a point of the body (in the body's frame, rings round its y axis). */
export function ringShadow(P, Lo, prof, RU) {
  const t = P.y.negate().div(select(abs(Lo.y).lessThan(0.0001), float(0.0001), Lo.y));
  const Q = P.add(Lo.mul(t));
  const u = length(Q.xz).sub(RU.inner).div(RU.outer.sub(RU.inner));
  const a = texture(prof, vec2(clamp(u, 0.0, 1.0), 0.5)).level(1).r.mul(RU.opacity);
  const onRing = t.greaterThan(0.0).and(u.greaterThan(0.0)).and(u.lessThan(1.0));
  return select(onRing, a.mul(0.9), float(0));
}
