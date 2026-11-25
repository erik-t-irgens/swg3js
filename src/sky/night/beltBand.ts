// A belt seen from the ground, drawn as one band of the night sky's own (the GPU port's sky round, maker P: the brief's J, the
// owner's "Will I be able to see the Spine of Lok from Lok's surface?"). WebGPU's alone, made with the night (`NightSky`) behind
// the loading screen where the applied system draws a belt (its Drawn tick), so a world with none builds and draws nothing new.
//
// It is drawn in the Milky Way's way: a sphere about the camera behind every solid (`bandClip`, after the opaque world on the far
// plane, so the ground and anything in front hide it), added over the sky, times the air's transmittance toward each pixel so
// it fades into the horizon's haze, faded by the storms as the band is, and only while the night's stars are (pale and gone by
// day, as they are). Its numbers are the system's, turned by its own turn as the bodies and the stars are (`beltSky.ts`):
//   - the belt is a ring of dust round its middle, its radius the belt's, its half width `BELT_TUNE.width` of it across and its
//     half thickness `BELT_TUNE.thick` times its look's Thickness, both Gaussian; along each pixel's ray the ring's crossings are
//     found in the belt's plane (where the ray's foot meets the ring's circle) and each adds the dust it passes through (the
//     ring's width over how fast the ray crosses it, held by the ring's own curve where it grazes it, and by the slab's
//     thickness where it climbs out of it) at its height over the plane: so from inside or near it it is a band along the whole
//     sky in the belt's plane, its nearest stretch widest, and from far off a thin arc;
//   - each crossing is lit by the sun as a rough rock is (the Lambert sphere's phase, `(pi - a) cos a + sin a`, with the
//     opposition surge `BELT_TUNE.surge` within a few degrees of full), so it is brightest away from the sun, where its rocks
//     face us full, as Earth's gegenschein; and by the sun's light falling off with its distance from the sun against the
//     belt's own radius;
//   - its light `BELT_TUNE.lux` (cd/m2) times its look's dust and rocks, in its look's dust colour, the column saturating as an
//     optical depth does; a few brighter rocks (`BELT_TUNE.rocks`) stand among the dust in cells of the belt's own frame.
// Nothing here is a dial but `BELT_TUNE` (`beltSky.ts`): the shapes' constants are the method's.

import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import * as TSL from 'three/tsl';
import { AIR, AIR_UNITS, type AirTables } from '../air/airApi.ts';
import { SUN_LUX } from './galaxyDensity.ts';
import { SKY_BODIES } from '../look/bodiesFile.ts';
import { BELT_MOST, BELT_STRIDE, BELT_TUNE, type BeltKit } from '../system/beltSky.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const { Fn, abs, acos, asin, atan, clamp, cos, cross, dot, exp, float, floor, fract, max, min, normalize, positionLocal, select, sin, sqrt, uniform, vec2, vec3, vec4, renderGroup } = TSL as Any;

/** Where the band's sphere stands (inside the Milky Way's 4800, so it is drawn in front of it where both are). */
const BELT_SPHERE = 4700;
/** Its draw order: just after the Milky Way's (`BAND_ORDER` 900), before everything see-through. */
export const BELT_ORDER = 901;
/** The rocks' cells across the belt's frame: 0.4 degrees a cell along it, 0.4 across. */
const ROCK_CELLS = 900;
/** A rock's spread on the sky (radians): some 0.03 degrees, about a pixel at 1440 lines and a 60-degree field. */
const ROCK_SPREAD = 0.0005;
// (the sky round's fixer) a rock's light against the dust's where it stands is a dial now, `BELT_TUNE.rockGain` (`all.w`)
const SQRT_PI = Math.sqrt(Math.PI);
const NO_BELTS = new Float64Array(BELT_STRIDE * BELT_MOST);

/** One belt's look as the band reads it: its dust colour (linear), its dust and its rocks, its thickness. */
export interface BeltLook {
  readonly colour: [number, number, number];
  readonly dust: number;
  readonly thickness: number;
}

const lin = (hex: unknown, fallback: [number, number, number]): [number, number, number] => {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return fallback;
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
};

/**
 * A belt's look from the file (the system's look for it): a generated look's belt part, its dust colour and its rocks' colours
 * mixed by its dust, its dust and its rocks' count as its density, its thickness; a belt naming none a grey dust.
 */
export function beltLookOf(lookId: string | null): BeltLook {
  const look = lookId ? (SKY_BODIES.file?.looks[lookId] as Any) : null;
  const d = look?.generated?.belt?.dials ?? {};
  const dustC = lin(d.dustColour, [0.3, 0.27, 0.24]);
  const rockC = lin(d.colour, [0.19, 0.16, 0.13]);
  const dust = Number.isFinite(+d.dust) ? +d.dust : 0.5;
  const rocks = Number.isFinite(+d.count) ? +d.count / 12000 : 1;
  const k = dust / (dust + 0.25 * rocks + 1e-6);
  const colour: [number, number, number] = [dustC[0] * k + rockC[0] * (1 - k), dustC[1] * k + rockC[1] * (1 - k), dustC[2] * k + rockC[2] * (1 - k)];
  // the colour as a tint of luminance one (its brightness is the band's dial and its density)
  const l = 0.2126 * colour[0] + 0.7152 * colour[1] + 0.0722 * colour[2];
  const tint: [number, number, number] = l > 1e-6 ? [colour[0] / l, colour[1] / l, colour[2] / l] : [1, 1, 1];
  const thickness = Number.isFinite(+d.thickness) ? +d.thickness : 0.3;
  return { colour: tint, dust: dust + 0.25 * rocks, thickness };
}

interface BeltUniforms {
  /** A belt's plane's normal (xyz) and its radius (w, AU). */
  readonly n: THREE.Vector4[];
  /** The way to its middle (xyz) and that distance (w, AU). */
  readonly c: THREE.Vector4[];
  /** The way to the sun (xyz) and its distance (w, AU). */
  readonly s: THREE.Vector4[];
  /** Its half thickness and half width (AU), its density (its look's dust and rocks), drawn (1) or not. */
  readonly shape: THREE.Vector4[];
  /** Its tint (luminance one) and its rocks' share. */
  readonly tint: THREE.Vector4[];
  /** The band's light into the scene's units (cd/m2 to the scene's), the surge, the overcast's clear share, the storms' fade. */
  readonly all: THREE.Vector4;
}

function beltUniforms(): BeltUniforms {
  const v = (): THREE.Vector4[] => Array.from({ length: BELT_MOST }, () => new THREE.Vector4(0, 0, 0, 0));
  return { n: v(), c: v(), s: v(), shape: v(), tint: v(), all: new THREE.Vector4(0, 0, 0, 0) };
}

/** A cheap hash of a cell to 0..1 (its two corners of the belt's frame). */
const hash2 = (p: Any): Any => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));

/** The band's graph: every belt's dust and rocks along each pixel's ray, lit, through the air, added over the sky. */
function beltMaterial(tables: AirTables, u: BeltUniforms, clip: Any): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.name = 'gpu: belts';
  m.transparent = false;
  m.blending = THREE.AdditiveBlending;
  m.depthTest = true;
  m.depthWrite = false;
  m.fog = false;
  m.side = THREE.BackSide;
  m.userData.unlit = true;
  m.userData.dry = true;
  m.vertexNode = clip;
  const N = u.n.map((x) => uniform(x).setGroup(renderGroup));
  const C = u.c.map((x) => uniform(x).setGroup(renderGroup));
  const S = u.s.map((x) => uniform(x).setGroup(renderGroup));
  const SH = u.shape.map((x) => uniform(x).setGroup(renderGroup));
  const TI = u.tint.map((x) => uniform(x).setGroup(renderGroup));
  const ALL = uniform(u.all).setGroup(renderGroup);
  m.colorNode = Fn(() => {
    const d = normalize(positionLocal).toVar('beltDir');
    // every table read at the top
    const T = vec3(tables.transmittanceToSpace(d)).toVar('beltTr');
    let sum: Any = vec3(0);
    for (let k = 0; k < BELT_MOST; k++) {
      const n = N[k].xyz;
      const a = N[k].w;
      const c = C[k].xyz;
      const dC = C[k].w;
      const h = max(SH[k].x, 1e-6);
      const wr = max(SH[k].y, 1e-6);
      // the eye against the belt's middle: its foot in the plane (q) and its height over it (z0)
      const cn = dot(c, n);
      const q = c.sub(n.mul(cn)).mul(dC.negate()).toVar(`beltQ${k}`);
      const z0 = cn.mul(dC).negate();
      const rho2 = dot(q, q);
      const dz = dot(d, n).toVar(`beltDz${k}`);
      const dp = d.sub(n.mul(dz));
      const L2 = max(dot(dp, dp), 1e-6).toVar(`beltL2${k}`);
      const qd = dot(q, dp);
      const disc = qd.mul(qd).sub(L2.mul(rho2.sub(a.mul(a)))).toVar(`beltDisc${k}`);
      const sq = sqrt(max(disc, 0));
      // how fast the ray crosses the ring's radius (held where it grazes it by the ring's own curve)
      const rate = sqrt(max(disc, 0).div(a.mul(a)).add(L2.mul(wr).div(a.mul(2))));
      const pathRing = wr.mul(SQRT_PI).div(rate);
      const pathSlab = h.mul(SQRT_PI).div(max(abs(dz), 1e-4));
      const path = float(1).div(sqrt(float(1).div(pathRing.mul(pathRing)).add(float(1).div(pathSlab.mul(pathSlab)))));
      const sunW = S[k].xyz.mul(S[k].w);
      // one crossing at `s` (AU along the ray) with weight `w`: its dust, and its dust lit
      const cross1 = (s: Any, w: Any): [Any, Any] => {
        const z = z0.add(s.mul(dz)).div(h);
        const wz = exp(z.mul(z).negate()).mul(w).mul(select(s.greaterThan(0), float(1), float(0)));
        const toSun = sunW.sub(d.mul(s));
        const ls = max(sqrt(dot(toSun, toSun)), 1e-6);
        const ca = clamp(dot(toSun.div(ls), d.negate()), -1, 1);
        const al = acos(ca);
        const phase = float(Math.PI).sub(al).mul(ca).add(sin(al)).div(Math.PI).mul(float(1).add(ALL.y.mul(exp(al.div(-0.1)))));
        const fall = a.div(ls).mul(a.div(ls));
        const dust = path.mul(wz);
        return [dust, dust.mul(phase).mul(fall)];
      };
      const near = disc.greaterThanEqual(0);
      const s1 = qd.negate().add(sq).div(L2);
      const s2 = qd.negate().sub(sq).div(L2);
      // past the ring's edge (no crossing): its nearest approach, by how far outside the ring it passes
      const sStar = qd.negate().div(L2);
      const rmin = sqrt(max(rho2.sub(qd.mul(qd).div(L2)), 0));
      const gap = rmin.sub(a).div(wr);
      const wOut = exp(gap.mul(gap).negate());
      const [d1, l1] = cross1(s1, select(near, float(1), float(0)));
      const [d2, l2] = cross1(s2, select(near, float(1), float(0)));
      const [d3, l3] = cross1(sStar, select(near, float(0), wOut));
      const tau = d1.add(d2).add(d3).div(h.mul(2)).toVar(`beltTau${k}`);
      const lit = l1.add(l2).add(l3).div(h.mul(2));
      // saturating as an optical depth does, its light the lit share of what it holds
      const sat = float(1).sub(exp(tau.negate())).div(max(tau, 1e-6));
      const glow = lit.mul(sat).mul(SH[k].z).mul(SH[k].w);
      // a few brighter rocks in cells of the belt's own frame (its middle's way across the plane, the plane's normal)
      const e1 = normalize(c.sub(n.mul(cn)).add(vec3(1e-6, 0, 0)));
      const e2 = cross(n, e1);
      const lon = atan(dot(d, e2), dot(d, e1));
      const lat = asin(clamp(dz, -1, 1));
      const cell = vec2(floor(lon.mul(ROCK_CELLS / (2 * Math.PI))), floor(lat.mul(ROCK_CELLS / (2 * Math.PI))));
      const h1 = hash2(cell);
      const at = vec2(hash2(cell.add(17.3)), hash2(cell.add(41.9))).add(cell).mul((2 * Math.PI) / ROCK_CELLS);
      const off = vec2(lon, lat).sub(at);
      const spot = exp(dot(off, off).div(-2 * ROCK_SPREAD * ROCK_SPREAD));
      const rock = select(h1.lessThan(TI[k].w.mul(min(tau, 1))), spot.mul(ALL.w), float(0));
      sum = sum.add(TI[k].xyz.mul(glow.mul(float(1).add(rock))));
    }
    // cd/m2 into the scene's units, through the air, faded by the storms
    return vec4(sum.mul(ALL.x).mul(T).mul(ALL.z), 1);
  })();
  return m;
}

/** The band made with the night where the applied system draws a belt (WebGPU, behind the loading screen). */
export class BeltBand {
  readonly mesh: THREE.Mesh;
  private readonly u = beltUniforms();
  private readonly looks: BeltLook[];
  readonly count: number;
  readonly names: readonly string[];
  constructor(kit: BeltKit, clip: Any) {
    const tables = AIR.tables;
    if (!tables) throw new Error("the belts' band needs the air's tables");
    this.count = Math.min(kit.count, BELT_MOST);
    this.names = kit.names.slice(0, this.count);
    this.looks = kit.looks.slice(0, this.count).map((id) => beltLookOf(id));
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(BELT_SPHERE, 48, 24), beltMaterial(tables, this.u, clip));
    this.mesh.name = 'night: belts';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = BELT_ORDER;
    for (let k = 0; k < this.count; k++) {
      const t = this.looks[k].colour;
      this.u.tint[k].set(t[0], t[1], t[2], 0);
    }
  }

  /**
   * Once a night frame: each belt's numbers from the motion's (`SkyMotion.belts`, the sky's frame) and the dials, written into
   * the vectors' own fields. Allocates nothing.
   */
  frame(motion: { readonly belts: Float64Array; readonly beltCount: number } | null): void {
    const B = BELT_TUNE;
    // (its numbers read off the records here: a number handed across a call is a number made)
    const belts = motion !== null ? motion.belts : NO_BELTS;
    const count = motion !== null ? motion.beltCount : 0;
    const overcast = AIR.frame.overcast;
    for (let k = 0; k < BELT_MOST; k++) {
      const sh = this.u.shape[k];
      if (k >= count || k >= this.count) {
        sh.w = 0;
        continue;
      }
      const o = k * BELT_STRIDE;
      const n = this.u.n[k];
      n.x = belts[o];
      n.y = belts[o + 1];
      n.z = belts[o + 2];
      const a = belts[o + 7];
      n.w = a;
      const c = this.u.c[k];
      c.x = belts[o + 3];
      c.y = belts[o + 4];
      c.z = belts[o + 5];
      c.w = belts[o + 6];
      const s = this.u.s[k];
      s.x = belts[o + 8];
      s.y = belts[o + 9];
      s.z = belts[o + 10];
      s.w = belts[o + 11];
      const look = this.looks[k];
      sh.x = a * B.thick * look.thickness;
      sh.y = a * B.width;
      sh.z = look.dust;
      sh.w = belts[o + 13];
      this.u.tint[k].w = B.rocks;
    }
    const all = this.u.all;
    all.x = (B.lux * AIR_UNITS.scene) / SUN_LUX;
    all.y = B.surge;
    const oc = overcast > 0 ? (overcast < 1 ? overcast : 1) : 0;
    all.z = 1 - oc;
    all.w = B.rockGain;
  }

  report(): Record<string, unknown> {
    return { belts: this.names, looks: this.looks, tune: { ...BELT_TUNE } };
  }

  dispose(forget?: (materials: Iterable<THREE.Material>) => void): void {
    this.mesh.removeFromParent();
    forget?.([this.mesh.material as THREE.Material]);
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
  }
}
