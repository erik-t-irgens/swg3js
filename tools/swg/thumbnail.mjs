// Item pictures for the backpack, baked at conversion by a small software rasterizer, so an icon
// costs the game nothing but an <img>: a live 3D cell would compile a program per material on the
// main thread, the stall the whole game is built to avoid. The client drew each inventory cell as a
// live view of the model; its archives hold no icons.
//
// Pure: meshes in, RGBA out (tools/swg/tests/thumbnail.test.ts). Positions arrive in the client's
// own frame and X is negated first, as the converter's GLBs are, so a picture reads as the model
// does in the game.
import { decodePng } from './png.mjs';

const GREY = [168, 168, 168];

/** An RGBA image box-reduced by whole factors of two until its longer side is at most `max` (128). */
export function thumbTexture(width, height, rgba, max = 128) {
  let f = 1;
  while (Math.ceil(Math.max(width, height) / f) > max) f *= 2;
  const w = Math.max(1, Math.ceil(width / f));
  const h = Math.max(1, Math.ceil(height / f));
  const out = new Uint8Array(w * h * 4);
  if (f === 1) {
    out.set(rgba.subarray ? rgba.subarray(0, w * h * 4) : rgba.slice(0, w * h * 4));
    return { width: w, height: h, rgba: out };
  }
  for (let y = 0; y < h; y++) {
    const y0 = y * f, y1 = Math.min(height, y0 + f);
    for (let x = 0; x < w; x++) {
      const x0 = x * f, x1 = Math.min(width, x0 + f);
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = y0; sy < y1; sy++) {
        let i = (sy * width + x0) * 4;
        for (let sx = x0; sx < x1; sx++, i += 4) {
          r += rgba[i];
          g += rgba[i + 1];
          b += rgba[i + 2];
          a += rgba[i + 3];
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * w + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }
  return { width: w, height: h, rgba: out };
}

/** The alpha a texture entry is cut at in a picture: a cut-out's own, a blended surface's faint parts, else none. */
function alphaTestOf(entry) {
  if (!entry.hasAlpha) return 0;
  if (entry.alphaMode === 'MASK') return typeof entry.alphaTest === 'number' && entry.alphaTest > 0 ? entry.alphaTest : 0.5;
  // A picture has no blending: a blended surface is drawn where it is mostly there.
  if (entry.alphaMode === 'BLEND') return 0.25;
  return 0;
}

/**
 * The converter's mesh groups ({ shader, primitives: [{ positions, normals, uvs, indices }] }) with their texture
 * entries (textureFor / skinnedTexture results: { png, hasAlpha, alphaMode, invisible?, thumb? }) as renderThumbnail
 * meshes. A texture is read from the entry's non-enumerable `thumb` (below); an entry without one (a test's, or an
 * old cache) is decoded with decodePng and reduced; an invisible entry drops its group; a texture that does not
 * decode draws flat grey. An additive surface (a glow, drawn as light added to what is behind it) drops its group
 * too: a picture has nothing behind it, and drawn solid it is a dark card.
 */
export function iconMeshes(groups, textures) {
  const get = (shader) => (textures instanceof Map ? textures.get(shader) : textures?.[shader]) ?? null;
  const images = new Map();
  const imageOf = (entry) => {
    if (images.has(entry)) return images.get(entry);
    let img = null;
    const t = entry.thumb;
    if (t && t.width > 0 && t.height > 0 && t.rgba?.length >= t.width * t.height * 4) img = t;
    else if (entry.png) {
      const d = decodePng(entry.png);
      if (d) img = thumbTexture(d.width, d.height, d.rgba);
    }
    const tex = img ? { width: img.width, height: img.height, rgba: img.rgba, alphaTest: alphaTestOf(entry) } : null;
    images.set(entry, tex);
    return tex;
  };
  const out = [];
  for (const g of groups ?? []) {
    const entry = get(g.shader);
    if (entry?.invisible || entry?.blend === 'add') continue;
    const texture = entry ? imageOf(entry) : null;
    for (const p of g.primitives ?? []) {
      if (!p?.positions?.length || !p.indices?.length) continue;
      out.push({ positions: p.positions, normals: p.normals ?? null, uvs: p.uvs ?? null, indices: p.indices, texture, ...(texture ? {} : { color: GREY }) });
    }
  }
  return out;
}

const rad = (d) => (d * Math.PI) / 180;

/** Row-major 3x3 multiply. */
function mul(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}

/**
 * The view as a rotation whose rows are the picture's right, its up and the direction towards the viewer, in the
 * model's frame after the X flip. `bounds` are the flipped model's.
 */
function viewMatrix(view, bounds, { yawDeg, pitchDeg, tiltDeg }) {
  if (view === 'weapon') {
    const ext = [0, 1, 2].map((k) => bounds.max[k] - bounds.min[k]);
    const along = ext.indexOf(Math.max(...ext));
    const rest = [0, 1, 2].filter((k) => k !== along);
    // Looking down the thinnest axis; the third is the picture's up before the tilt.
    const thin = ext[rest[0]] <= ext[rest[1]] ? rest[0] : rest[1];
    const up = rest[0] === thin ? rest[1] : rest[0];
    // The far end: the extreme of the longest axis farther from the grip at the origin (Player.equip's rule).
    const sign = Math.abs(bounds.max[along]) >= Math.abs(bounds.min[along]) ? 1 : -1;
    const X = [0, 0, 0];
    const Y = [0, 0, 0];
    X[along] = sign;
    Y[up] = 1;
    const Z = [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]];
    const c = Math.cos(rad(tiltDeg)), s = Math.sin(rad(tiltDeg));
    // Turned in the picture's plane so the far end points up and right.
    const X2 = X.map((v, k) => c * v - s * Y[k]);
    const Y2 = X.map((v, k) => s * v + c * Y[k]);
    return [...X2, ...Y2, ...Z];
  }
  const cy = Math.cos(rad(yawDeg)), sy = Math.sin(rad(yawDeg));
  const cp = Math.cos(rad(pitchDeg)), sp = Math.sin(rad(pitchDeg));
  const ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  // Tilted down: the top leans towards the viewer, who looks on it from a little above.
  const rx = [1, 0, 0, 0, cp, -sp, 0, sp, cp];
  return mul(rx, ry);
}

/**
 * Draw meshes into a square RGBA picture. meshes: [{ positions, normals?, uvs?, indices, texture?: { width, height,
 * rgba, alphaTest } | null, color?: [r,g,b] }]. view 'wear': the model from the front (+Z, the way it faces), turned
 * yawDeg about Y and tilted pitchDeg down; view 'weapon': side on (looking down its thinnest axis) with its longest axis
 * across, the far end (the extreme farther from the grip at the origin, as Player.equip reads it) to the right, the
 * whole turned tiltDeg so the tip points up and right. X is negated first (the converter's GLB flip), so the picture
 * reads as the model does in the game. Orthographic, fitted to 88% of the square, z-buffered, both faces drawn with
 * the normal turned to the viewer, lit ambient + (1 - ambient) * max(0, n.L), textures sampled bilinear (they arrive
 * at most 128 px, see thumbTexture), alpha-tested at `alphaTest` when > 0 (alpha is ignored otherwise). Rendered at
 * size * supersample and box-filtered down (premultiplied). In the 'wear' view a pair worn far apart (gloves at the
 * two hands of the bind pose) is drawn with its sides moved in towards the middle. Returns null when fewer than
 * minCoverage of the pixels are covered. `flipX: false` draws the client's own frame, unflipped, for a model written
 * with --no-flip (a GLB in the client's left-handed frame), so the picture is never the mirror of what the game shows.
 */
export function renderThumbnail(meshes, { size = 96, supersample = 2, view = 'wear', yawDeg = 20, pitchDeg = 12,
  tiltDeg = 30, light = [-0.45, 0.65, 0.6], ambient = 0.42, minCoverage = 0.004, flipX = true } = {}) {
  const list = (meshes ?? []).filter((m) => m?.positions?.length >= 3 && m.indices?.length >= 3);
  if (!list.length) return null;
  const ss = Math.max(1, Math.round(supersample));
  const S = size * ss;
  // The converter's GLB flip: X negated, on positions and normals alike.
  const sx = flipX === false ? 1 : -1;

  // The model's bounds after the flip, over the vertices the triangles use.
  const bmin = [Infinity, Infinity, Infinity];
  const bmax = [-Infinity, -Infinity, -Infinity];
  for (const m of list) {
    const p = m.positions;
    for (let t = 0; t < m.indices.length; t++) {
      const i = m.indices[t] * 3;
      const x = sx * p[i], y = p[i + 1], z = p[i + 2];
      if (x < bmin[0]) bmin[0] = x;
      if (x > bmax[0]) bmax[0] = x;
      if (y < bmin[1]) bmin[1] = y;
      if (y > bmax[1]) bmax[1] = y;
      if (z < bmin[2]) bmin[2] = z;
      if (z > bmax[2]) bmax[2] = z;
    }
  }
  if (!bmin.every(Number.isFinite) || !bmax.every(Number.isFinite)) return null;
  // A worn pair (gloves, a pair of bracers) sits at the two hands of the bind pose, far apart: drawn where it is, each
  // piece is a speck. When nothing crosses the middle and the gap between the sides is wider than either side, each
  // side is moved in towards the middle until the gap is a tenth of the wider side.
  let pull = 0;
  if (view === 'wear') {
    let leftMax = -Infinity, leftMin = Infinity, rightMin = Infinity, rightMax = -Infinity;
    for (const m of list) {
      const p = m.positions;
      for (let t = 0; t < m.indices.length; t++) {
        const x = sx * p[m.indices[t] * 3];
        if (x < 0) {
          if (x > leftMax) leftMax = x;
          if (x < leftMin) leftMin = x;
        } else {
          if (x < rightMin) rightMin = x;
          if (x > rightMax) rightMax = x;
        }
      }
    }
    const widest = Math.max(leftMax - leftMin, rightMax - rightMin);
    const gap = rightMin - leftMax;
    if (Number.isFinite(gap) && Number.isFinite(widest) && widest > 0 && gap > widest) pull = (gap - 0.1 * widest) / 2;
    if (pull > 0) {
      bmin[0] += pull;
      bmax[0] -= pull;
    }
  }
  const R = viewMatrix(view, { min: bmin, max: bmax }, { yawDeg, pitchDeg, tiltDeg });
  const L = (() => {
    const n = Math.hypot(light[0], light[1], light[2]) || 1;
    return [light[0] / n, light[1] / n, light[2] / n];
  })();

  // Every mesh's vertices in view space (x right, y up, z towards the viewer), and their normals.
  const views = list.map((m) => {
    const p = m.positions;
    const n = m.normals && m.normals.length === p.length ? m.normals : null;
    const count = p.length / 3;
    const v = new Float32Array(count * 3);
    const nv = n ? new Float32Array(count * 3) : null;
    for (let i = 0; i < count; i++) {
      let x = sx * p[i * 3];
      if (pull > 0) x += x < 0 ? pull : -pull;
      const y = p[i * 3 + 1], z = p[i * 3 + 2];
      v[i * 3] = R[0] * x + R[1] * y + R[2] * z;
      v[i * 3 + 1] = R[3] * x + R[4] * y + R[5] * z;
      v[i * 3 + 2] = R[6] * x + R[7] * y + R[8] * z;
      if (nv) {
        const a = sx * n[i * 3], b = n[i * 3 + 1], c = n[i * 3 + 2];
        nv[i * 3] = R[0] * a + R[1] * b + R[2] * c;
        nv[i * 3 + 1] = R[3] * a + R[4] * b + R[5] * c;
        nv[i * 3 + 2] = R[6] * a + R[7] * b + R[8] * c;
      }
    }
    return { v, n: nv };
  });

  // Fit the picture: the view-space extent of the model at 88% of the square, centred.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  list.forEach((m, k) => {
    const v = views[k].v;
    for (let t = 0; t < m.indices.length; t++) {
      const i = m.indices[t] * 3;
      if (v[i] < x0) x0 = v[i];
      if (v[i] > x1) x1 = v[i];
      if (v[i + 1] < y0) y0 = v[i + 1];
      if (v[i + 1] > y1) y1 = v[i + 1];
    }
  });
  const span = Math.max(x1 - x0, y1 - y0);
  if (!(span > 0) || !Number.isFinite(span)) return null;
  const scale = (0.88 * S) / span;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;

  const color = new Float32Array(S * S * 3);
  const depth = new Float32Array(S * S).fill(-Infinity);
  const covered = new Uint8Array(S * S);
  const texel = [0, 0, 0, 0];

  const sample = (tex, u, v) => {
    const w = tex.width, h = tex.height, d = tex.rgba;
    let fx = u * w - 0.5, fy = v * h - 0.5;
    if (!Number.isFinite(fx) || !Number.isFinite(fy)) fx = fy = 0;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const ax = fx - ix, ay = fy - iy;
    const xa = ((ix % w) + w) % w, xb = (xa + 1) % w;
    const ya = ((iy % h) + h) % h, yb = (ya + 1) % h;
    const i00 = (ya * w + xa) * 4, i10 = (ya * w + xb) * 4, i01 = (yb * w + xa) * 4, i11 = (yb * w + xb) * 4;
    for (let c = 0; c < 4; c++) {
      const top = d[i00 + c] * (1 - ax) + d[i10 + c] * ax;
      const bottom = d[i01 + c] * (1 - ax) + d[i11 + c] * ax;
      texel[c] = top * (1 - ay) + bottom * ay;
    }
    return texel;
  };

  list.forEach((m, k) => {
    const { v, n } = views[k];
    const uv = m.uvs && m.texture ? m.uvs : null;
    const tex = uv ? m.texture : null;
    const base = m.color ?? GREY;
    const idx = m.indices;
    for (let t = 0; t + 2 < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const ax = (v[a * 3] - cx) * scale + S / 2, ay = S / 2 - (v[a * 3 + 1] - cy) * scale, az = v[a * 3 + 2];
      const bx = (v[b * 3] - cx) * scale + S / 2, by = S / 2 - (v[b * 3 + 1] - cy) * scale, bz = v[b * 3 + 2];
      const qx = (v[c * 3] - cx) * scale + S / 2, qy = S / 2 - (v[c * 3 + 1] - cy) * scale, qz = v[c * 3 + 2];
      const area = (bx - ax) * (qy - ay) - (by - ay) * (qx - ax);
      if (!(Math.abs(area) > 1e-12)) continue;
      // The face's normal, towards the viewer: the shading when the mesh has no normals of its own.
      const e1 = [v[b * 3] - v[a * 3], v[b * 3 + 1] - v[a * 3 + 1], v[b * 3 + 2] - v[a * 3 + 2]];
      const e2 = [v[c * 3] - v[a * 3], v[c * 3 + 1] - v[a * 3 + 1], v[c * 3 + 2] - v[a * 3 + 2]];
      let fn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const fl = Math.hypot(fn[0], fn[1], fn[2]) || 1;
      fn = fn.map((x) => x / fl);
      if (fn[2] < 0) fn = fn.map((x) => -x);
      const minX = Math.max(0, Math.floor(Math.min(ax, bx, qx)));
      const maxX = Math.min(S - 1, Math.ceil(Math.max(ax, bx, qx)));
      const minY = Math.max(0, Math.floor(Math.min(ay, by, qy)));
      const maxY = Math.min(S - 1, Math.ceil(Math.max(ay, by, qy)));
      for (let py = minY; py <= maxY; py++) {
        const sy = py + 0.5;
        for (let px = minX; px <= maxX; px++) {
          const sx = px + 0.5;
          const w0 = ((bx - sx) * (qy - sy) - (by - sy) * (qx - sx)) / area;
          const w1 = ((qx - sx) * (ay - sy) - (qy - sy) * (ax - sx)) / area;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-7 || w1 < -1e-7 || w2 < -1e-7) continue;
          const z = w0 * az + w1 * bz + w2 * qz;
          const o = py * S + px;
          if (z <= depth[o]) continue;
          let r = base[0], g = base[1], bl = base[2];
          if (tex) {
            const u = w0 * uv[a * 2] + w1 * uv[b * 2] + w2 * uv[c * 2];
            const vv = w0 * uv[a * 2 + 1] + w1 * uv[b * 2 + 1] + w2 * uv[c * 2 + 1];
            const s = sample(tex, u, vv);
            if (tex.alphaTest > 0 && s[3] < tex.alphaTest * 255) continue;
            r = s[0];
            g = s[1];
            bl = s[2];
          }
          let nx = fn[0], ny = fn[1], nz = fn[2];
          if (n) {
            const mx = w0 * n[a * 3] + w1 * n[b * 3] + w2 * n[c * 3];
            const my = w0 * n[a * 3 + 1] + w1 * n[b * 3 + 1] + w2 * n[c * 3 + 1];
            const mz = w0 * n[a * 3 + 2] + w1 * n[b * 3 + 2] + w2 * n[c * 3 + 2];
            const ml = Math.hypot(mx, my, mz);
            if (ml > 1e-6) {
              const f = mz < 0 ? -1 / ml : 1 / ml;
              nx = mx * f;
              ny = my * f;
              nz = mz * f;
            }
          }
          const shade = ambient + (1 - ambient) * Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
          depth[o] = z;
          covered[o] = 1;
          color[o * 3] = r * shade;
          color[o * 3 + 1] = g * shade;
          color[o * 3 + 2] = bl * shade;
        }
      }
    }
  });

  // Box-filter down, premultiplied: an edge pixel keeps its share of coverage as alpha.
  const rgba = new Uint8Array(size * size * 4);
  let coverage = 0;
  const n2 = ss * ss;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, count = 0;
      for (let j = 0; j < ss; j++) {
        for (let i = 0; i < ss; i++) {
          const o = (y * ss + j) * S + (x * ss + i);
          if (!covered[o]) continue;
          r += color[o * 3];
          g += color[o * 3 + 1];
          b += color[o * 3 + 2];
          count++;
        }
      }
      if (!count) continue;
      const q = (y * size + x) * 4;
      rgba[q] = Math.min(255, Math.round(r / count));
      rgba[q + 1] = Math.min(255, Math.round(g / count));
      rgba[q + 2] = Math.min(255, Math.round(b / count));
      rgba[q + 3] = Math.round((255 * count) / n2);
      coverage += count / n2;
    }
  }
  coverage /= size * size;
  if (coverage < minCoverage) return null;
  return { width: size, height: size, rgba, coverage };
}
