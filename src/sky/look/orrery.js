// The System view: an orrery of a system's model (system.js) on a plain 2D canvas, drawn readable
// (orbits spread out in order, bodies at sizes you can see) or at true scale (orbits as the model has
// them, bodies as big as the angle each fills from our world says). Orbits are lines; our world is
// marked, with a tick where we stand (it turns with the day). Drag a body along its orbit to move
// where it starts; drag the empty sky to turn the view, the wheel to zoom.

const TAU = Math.PI * 2;
const KIND_COLOUR = { star: '#ffd27a', pair: '#ffd27a', giant: '#d9a066', planet: '#7fb0d9', moon: '#b9bcc0', group: '#c9c2b0', station: '#c8d0d4', comet: '#e8eef2', belt: '#8c8478' };
const KIND_PX = { star: 11, pair: 9, giant: 8, planet: 6, moon: 4, group: 3, station: 2, comet: 2.5, belt: 2 };
// (version 2 of system.js: a locked world's orbit plane turns with its year, so the state's own frames are drawn)

export class Orrery {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hooks = hooks;
    this.view = { yaw: -30, tilt: 58, zoom: 1, centre: 'sun', trueScale: false };
    this.model = null;
    this.out = null;
    this.layoutFor = null;
    this.selected = -1;
    this.drag = null;
    this.drawnPos = null;
    this.screen = null;
    this.wire();
  }

  /** The readable orbits: each parent's children spread out in the order of their radii. */
  layout(model, base) {
    const n = model.n;
    const kids = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) if (model.parent[i] >= 0) kids[model.parent[i]].push(i);
    const r = new Float64Array(n);
    const step = new Float64Array(n);
    step[model.sunI] = base;
    const walk = (p, span) => {
      const list = kids[p].slice().sort((a, b) => model.radius[a] - model.radius[b]);
      const c = list.length;
      list.forEach((i, k) => {
        r[i] = span * (0.32 + (0.68 * (k + 1)) / c);
        step[i] = Math.max(10, ((span * 0.68) / c) * 0.5);
      });
      for (const i of list) walk(i, step[i]);
    };
    walk(model.sunI, base);
    return r;
  }

  setModel(model, out) {
    if (model !== this.model) {
      this.model = model;
      this.drawnPos = new Float64Array(3 * model.n);
      this.screen = new Float64Array(4 * model.n);
      this.layoutFor = null;
    }
    this.out = out;
  }

  project(x, y, z, cx, cy) {
    const v = this.view;
    const ps = Math.sin(v.yaw * Math.PI / 180), pc = Math.cos(v.yaw * Math.PI / 180);
    const ts = Math.sin(v.tilt * Math.PI / 180), tc = Math.cos(v.tilt * Math.PI / 180);
    const x1 = x * pc - y * ps, y1 = x * ps + y * pc;
    return [cx + x1 * v.zoom, cy - (y1 * ts + z * tc) * v.zoom, y1 * tc - z * ts];
  }

  /** Draw the model at its state's moment. `names` the bodies' names, `worldName` ours. */
  draw({ selected = -1, labels = true } = {}) {
    const { canvas, ctx, model: M, out: O } = this;
    if (!M || !O) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05080b';
    ctx.fillRect(0, 0, W, H);
    this.selected = selected;
    const base = 0.42 * Math.min(W, H);
    const key = `${base}|${M.n}`;
    if (this.layoutFor !== key) { this.readable = this.layout(M, base); this.layoutFor = key; }
    const B = M.sys.bodies;
    // true scale: the farthest orbit round the sun fills the same room as the readable one
    let far = 0;
    for (let i = 0; i < M.n; i++) if (M.parent[i] === M.sunI) far = Math.max(far, M.radius[i]);
    const perUnit = far > 0 ? base / far : 1;
    const rad = (i) => (this.view.trueScale ? M.radius[i] * perUnit : this.readable[i]);
    const dp = this.drawnPos;
    for (let q = 0; q < M.n; q++) {
      const i = M.order[q], p = M.parent[i];
      if (p < 0) { dp[3 * i] = dp[3 * i + 1] = dp[3 * i + 2] = 0; continue; }
      const r = rad(i);
      for (let a = 0; a < 3; a++) dp[3 * i + a] = dp[3 * p + a] + r * O.unit[3 * i + a];
    }
    const centreI = this.view.centre === 'world' ? M.worldI : this.view.centre === 'parent' ? Math.max(0, M.parent[M.worldI]) : M.sunI;
    const ox = dp[3 * centreI], oy = dp[3 * centreI + 1], oz = dp[3 * centreI + 2];
    const cx = W / 2, cy = H / 2 + 10;
    const P = (x, y, z) => this.project(x - ox, y - oy, z - oz, cx, cy);

    // the orbits (a body that follows another has none of its own)
    ctx.lineWidth = 1;
    const basis = O.basis || M.basis;
    const grounds = new Set();
    if (M.version === 2) for (const g of M.sys.grounds) if (!g.copy) { const gi = B.findIndex((b) => b.id === g.body); if (gi >= 0) grounds.add(gi); }
    for (let i = 0; i < M.n; i++) {
      const p = M.parent[i];
      if (p < 0 || (M.follow && M.follow[i] >= 0)) continue;
      const r = rad(i), o = 9 * i;
      const mine = i === M.worldI, sel = i === selected;
      ctx.strokeStyle = sel ? '#e3c26a' : mine ? '#6fd3a0' : grounds.has(i) ? '#4f8a70' : '#3b4d55';
      ctx.setLineDash(B[i].drawn === false || B[i].kind === 'belt' ? [3, 4] : []);
      ctx.beginPath();
      for (let k = 0; k <= 96; k++) {
        const a = (k / 96) * TAU, c = Math.cos(a), s = Math.sin(a);
        const x = dp[3 * p] + r * (basis[o] * c + basis[o + 3] * s);
        const y = dp[3 * p + 1] + r * (basis[o + 1] * c + basis[o + 4] * s);
        const z = dp[3 * p + 2] + r * (basis[o + 2] * c + basis[o + 5] * s);
        const [sx, sy] = P(x, y, z);
        if (k) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // the bodies, far first
    const S = this.screen;
    const list = [];
    for (let i = 0; i < M.n; i++) {
      const [sx, sy, depth] = P(dp[3 * i], dp[3 * i + 1], dp[3 * i + 2]);
      S[4 * i] = sx; S[4 * i + 1] = sy; S[4 * i + 2] = depth;
      let px = KIND_PX[B[i].kind] || 4;
      if (i === M.worldI) px = 6;
      if (this.view.trueScale && i !== M.worldI) {
        // as big as the angle it fills from our world: its distance from us times the half-angle
        const j = M.items.findIndex((it) => it.body === i);
        if (j >= 0) {
          const half = (M.itemSize[j] * Math.PI) / 360;
          const disc = M.itemStar[j] ? Math.atan(0.2 * Math.tan(half)) : half;
          px = Math.max(1.5, O.dist[j] * Math.tan(disc) * perUnit * this.view.zoom);
        }
      }
      S[4 * i + 3] = px;
      list.push(i);
    }
    list.sort((a, b) => S[4 * b + 2] - S[4 * a + 2]);
    const sx0 = S[4 * M.sunI], sy0 = S[4 * M.sunI + 1];
    ctx.font = '11px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const i of list) {
      const b = B[i];
      const x = S[4 * i], y = S[4 * i + 1], r = S[4 * i + 3];
      const colour = b.colour || (i === M.worldI ? '#7fe0a8' : KIND_COLOUR[b.kind] || '#aaa');
      ctx.globalAlpha = b.drawn === false && i !== M.worldI ? 0.45 : 1;
      if (b.kind === 'star' || b.kind === 'pair') {
        const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
        g.addColorStop(0, colour);
        g.addColorStop(0.3, colour + '88');
        g.addColorStop(1, colour + '00');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, r * 3, 0, TAU); ctx.fill();
      }
      if (b.kind === 'pair') {
        // the twin suns: one body, its two suns side by side
        const m0 = b.members?.[0], m1 = b.members?.[1];
        this.disc(x - r * 0.75, y, r * 0.8, m0?.colour || colour, null, 0);
        this.disc(x + r * 0.95, y + r * 0.35, r * 0.8 * Math.min(1, (m1?.size || 14) / (m0?.size || 20) + 0.15), m1?.colour || colour, null, 0);
      } else if (b.kind === 'group') {
        const k = Math.max(1, (b.members || []).length);
        for (let m = 0; m < k; m++) {
          const a = (m / k) * TAU + 0.6;
          this.disc(x + Math.cos(a) * 5, y + Math.sin(a) * 4, r, colour, sx0, sy0);
        }
      } else {
        this.disc(x, y, r, colour, b.kind === 'star' ? null : sx0, sy0);
      }
      ctx.globalAlpha = 1;
      if (grounds.has(i) && i !== M.worldI) {
        // another ground world of this system: you could stand there
        ctx.strokeStyle = '#4f8a70';
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.arc(x, y, r + 5, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (i === M.worldI) {
        ctx.strokeStyle = '#6fd3a0';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, r + 5, 0, TAU); ctx.stroke();
        // where we stand: straight up from us, as the day turns it
        const z0 = O.zenith;
        const [zx, zy] = this.project(z0[0], z0[1], z0[2], 0, 0);
        const zl = Math.hypot(zx, zy) || 1;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (zx / zl) * (r + 12), y + (zy / zl) * (r + 12)); ctx.stroke();
        ctx.fillStyle = '#6fd3a0';
        ctx.beginPath(); ctx.arc(x + (zx / zl) * (r + 12), y + (zy / zl) * (r + 12), 2.2, 0, TAU); ctx.fill();
        ctx.lineWidth = 1;
      }
      if (i === selected) {
        ctx.strokeStyle = '#e3c26a';
        ctx.beginPath(); ctx.arc(x, y, r + 8, 0, TAU); ctx.stroke();
      }
      if (labels) {
        ctx.fillStyle = i === M.worldI ? '#bff0d4' : grounds.has(i) ? '#9fd4b8' : '#c9d6d2';
        ctx.fillText(i === M.worldI ? `${b.name} (you are here)` : grounds.has(i) ? `${b.name} (a ground world)` : b.name, x + r + 9, y);
      }
    }
  }

  /** A disc lit from the sun's side on the screen: its far half in shadow. */
  disc(x, y, r, colour, sx, sy) {
    const ctx = this.ctx;
    ctx.fillStyle = colour;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    if (sx === null) return;
    const a = Math.atan2(sy - y, sx - x);
    ctx.fillStyle = 'rgba(3,6,10,0.72)';
    ctx.beginPath(); ctx.arc(x, y, r, a + Math.PI / 2, a + Math.PI * 1.5); ctx.fill();
  }

  /** The body under the pointer (screen px), or -1. */
  hit(px, py) {
    const M = this.model, S = this.screen;
    if (!M || !S) return -1;
    let best = -1, bd = Infinity;
    for (let i = 0; i < M.n; i++) {
      const d = Math.hypot(px - S[4 * i], py - S[4 * i + 1]);
      if (d <= Math.max(8, S[4 * i + 3] + 6) && d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /** The angle round body i's orbit nearest the pointer, and how far it is from where the body is now. */
  dragAngle(i, px, py) {
    const M = this.model, O = this.out, p = M.parent[i];
    if (p < 0) return 0;
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const dp = this.drawnPos, o = 9 * i;
    const basis = O.basis || M.basis;
    const r = this.view.trueScale ? null : this.readable[i];
    let far = 0;
    for (let k = 0; k < M.n; k++) if (M.parent[k] === M.sunI) far = Math.max(far, M.radius[k]);
    const rr = r ?? M.radius[i] * (far > 0 ? (0.42 * Math.min(W, H)) / far : 1);
    const centreI = this.view.centre === 'world' ? M.worldI : this.view.centre === 'parent' ? Math.max(0, M.parent[M.worldI]) : M.sunI;
    const ox = dp[3 * centreI], oy = dp[3 * centreI + 1], oz = dp[3 * centreI + 2];
    let best = 0, bd = Infinity;
    const near = (a) => {
      const c = Math.cos(a), s = Math.sin(a);
      const x = dp[3 * p] + rr * (basis[o] * c + basis[o + 3] * s);
      const y = dp[3 * p + 1] + rr * (basis[o + 1] * c + basis[o + 4] * s);
      const z = dp[3 * p + 2] + rr * (basis[o + 2] * c + basis[o + 5] * s);
      const [sx, sy] = this.project(x - ox, y - oy, z - oz, W / 2, H / 2 + 10);
      const d = (sx - px) ** 2 + (sy - py) ** 2;
      if (d < bd) { bd = d; best = a; }
    };
    // a degree at a time round the orbit, then a twentieth of one about the nearest (a whole degree
    // was a step of its own: a body clicked without moving was moved up to half a degree)
    for (let k = 0; k < 360; k++) near((k / 360) * TAU);
    const coarse = best;
    for (let k = -20; k <= 20; k++) near(coarse + (k / 20) * (TAU / 360));
    let delta = best - O.angle[i];
    delta -= Math.round(delta / TAU) * TAU;
    return (delta * 180) / Math.PI;
  }

  wire() {
    const c = this.canvas;
    const pos = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    c.addEventListener('pointerdown', (e) => {
      if (!this.model) return;
      const [x, y] = pos(e);
      const i = this.hit(x, y);
      c.setPointerCapture?.(e.pointerId);
      if (i >= 0) {
        this.hooks.onSelect?.(i);
        this.drag = { body: M_canDrag(this.model, i) ? i : -1, x, y, id: e.pointerId };
      } else {
        this.drag = { body: -1, view: true, x, y, yaw: this.view.yaw, tilt: this.view.tilt, id: e.pointerId };
      }
    });
    c.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d) return;
      const [x, y] = pos(e);
      if (d.view) {
        this.view.yaw = d.yaw + (x - d.x) * 0.4;
        this.view.tilt = Math.max(4, Math.min(90, d.tilt - (y - d.y) * 0.3));
        this.hooks.onView?.();
      } else if (d.body >= 0) {
        // a click is not a drag: the body moves only once the pointer has
        if (!d.moved && (x - d.x) ** 2 + (y - d.y) ** 2 < 16) return;
        d.moved = true;
        const delta = this.dragAngle(d.body, x, y);
        if (Math.abs(delta) > 0.05) this.hooks.onDrag?.(d.body, delta);
      }
    });
    const end = () => { if (this.drag) { this.drag = null; this.hooks.onDragEnd?.(); } };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.view.zoom = Math.max(0.05, Math.min(4000, this.view.zoom * Math.exp(-e.deltaY * 0.0015)));
      this.hooks.onView?.();
    }, { passive: false });
  }
}

/** A body can be dragged round its orbit when it has one of its own (not a locked ground world's, worked out from its day, nor a follower's). */
function M_canDrag(model, i) {
  return model.parent[i] >= 0 && !(model.lockDay && model.lockDay[i] > 0) && !(model.follow && model.follow[i] >= 0);
}
