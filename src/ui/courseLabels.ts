// The climbing course's labels (the owner's 2026-11-17: "if we can 'label' what I'm meant to test near each test geometry
// that would be helpful too"): a line of words over each piece's start saying what it is and what to try on it, as page
// text placed over the picture (crisp at any distance, nothing compiled, nothing in the world's passes). Stood with the
// course by `__debug.climbTest()` and taken down with it; only the nearest few in front of the camera are shown, so the
// screen never fills with them. Every number is ours, live through `COURSE_LABEL_TUNE`.

import * as THREE from 'three';

export const COURSE_LABEL_TUNE = {
  /** Labels further than this from the camera are not shown, metres. */
  reach: 30,
  /** At most this many are shown at once (the nearest). */
  most: 8,
  /** Fully shown inside this distance; fading out from here to `reach`, metres. */
  clear: 18,
  /** How high over a piece's start its label stands, metres. */
  lift: 2.3,
};

/** A label: where it stands in the world and its two lines. */
export interface CourseLabelAt {
  x: number;
  y: number;
  z: number;
  title: string;
  what: string;
}

interface Shown {
  el: HTMLDivElement;
  at: CourseLabelAt;
  /** Last written place on the screen (px) and opacity, so a still view writes nothing. */
  sx: number;
  sy: number;
  op: number;
  on: boolean;
}

export class CourseLabels {
  private readonly root: HTMLDivElement;
  private readonly items: Shown[] = [];
  private readonly v = new THREE.Vector3();
  /** Each frame's distances, kept (index by item). */
  private readonly dist: Float64Array;
  private readonly order: number[] = [];

  constructor(parent: HTMLElement, labels: readonly CourseLabelAt[]) {
    this.root = document.createElement('div');
    this.root.className = 'course-labels';
    // Over the picture, under every panel: placed absolutely at the page's corner with no z-index (the display's rule:
    // later elements of #ui paint over it in tree order). `#ui > *` takes no pointer events, and neither does this.
    this.root.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;';
    for (const at of labels) {
      const el = document.createElement('div');
      el.style.cssText =
        'position:absolute;left:0;top:0;display:none;transform-origin:50% 100%;white-space:nowrap;text-align:center;' +
        'font-size:13px;line-height:1.25;color:var(--ink);padding:3px 8px;border-radius:4px;' +
        'background:color-mix(in srgb, var(--void) 62%, transparent);border:1px solid var(--edge);';
      const t = document.createElement('div');
      t.textContent = at.title;
      t.style.cssText = 'font-weight:600;color:var(--accent);';
      const w = document.createElement('div');
      w.textContent = at.what;
      w.style.cssText = 'color:var(--muted);font-size:12px;';
      el.append(t, w);
      this.root.append(el);
      this.items.push({ el, at, sx: NaN, sy: NaN, op: NaN, on: false });
    }
    this.dist = new Float64Array(labels.length);
    for (let i = 0; i < labels.length; i++) this.order.push(i);
    // Straight after the overlay canvas (#ui's first child), so the canvas stays first and every panel paints over these.
    const first = parent.firstElementChild;
    if (first) first.after(this.root);
    else parent.append(this.root);
  }

  /** Place the nearest few in front of `camera` (its matrices as last drawn), and hide the rest. */
  frame(camera: THREE.PerspectiveCamera): void {
    const T = COURSE_LABEL_TUNE;
    const e = camera.matrixWorld.elements;
    const ex = e[12];
    const ey = e[13];
    const ez = e[14];
    for (let i = 0; i < this.items.length; i++) {
      const a = this.items[i].at;
      const dx = a.x - ex;
      const dy = a.y - ey;
      const dz = a.z - ez;
      this.dist[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    const d = this.dist;
    this.order.sort((p, q) => d[p] - d[q]);
    const w = window.innerWidth;
    const h = window.innerHeight;
    let shown = 0;
    for (let k = 0; k < this.order.length; k++) {
      const i = this.order[k];
      const it = this.items[i];
      let on = false;
      if (shown < T.most && d[i] <= T.reach) {
        this.v.set(it.at.x, it.at.y, it.at.z).project(camera);
        if (this.v.z > -1 && this.v.z < 1 && Math.abs(this.v.x) < 1.2 && Math.abs(this.v.y) < 1.2) {
          on = true;
          shown++;
          const sx = Math.round((this.v.x * 0.5 + 0.5) * w);
          const sy = Math.round((-this.v.y * 0.5 + 0.5) * h);
          const op = d[i] <= T.clear ? 1 : Math.max(0, Math.round(((T.reach - d[i]) / (T.reach - T.clear)) * 20) / 20);
          if (sx !== it.sx || sy !== it.sy) {
            it.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
            it.sx = sx;
            it.sy = sy;
          }
          if (op !== it.op) {
            it.el.style.opacity = String(op);
            it.op = op;
          }
        }
      }
      if (on !== it.on) {
        it.el.style.display = on ? 'block' : 'none';
        it.on = on;
      }
    }
  }

  /**
   * The interface shown again after the hide key (`App.setHudHidden`, which skipped `frame` while it was off): each
   * label's place and fade let go, so the next `frame` writes them afresh from this camera, and whether it stands taken
   * from the element itself, so a label the camera has left behind since is taken down on that frame.
   */
  refresh(): void {
    for (const it of this.items) {
      it.sx = Number.NaN;
      it.sy = Number.NaN;
      it.op = Number.NaN;
      it.on = it.el.style.display === 'block';
    }
  }

  /** Off the page. */
  dispose(): void {
    this.root.remove();
    this.items.length = 0;
  }
}
