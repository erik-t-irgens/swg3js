// The loading screen: the planet's picture, grey and dim, filling in with colour from the left
// as the world streams in (the way Halo's did), with the planet's name, what is being waited
// for, and the percentage. The picture is the game's own loading screen for the planet when the
// converter's `loading` command has pulled it (assets-private/loading/<planet>.png, asked for only
// where that command's own index lists it); without one, a planet drawn from the planet's own sky
// colours over stars, on two canvases shown where the pictures stand, never encoded into an image
// (a readback of the whole canvas, 54 ms the first time).
import type { PlanetDef } from '../data/planets';
import { opaqueAt } from '../world/loadingTune.ts';
import { loadingPicture } from '../world/packFiles.ts';

export class LoadingScreen {
  readonly root: HTMLElement;
  private readonly grey: HTMLImageElement;
  private readonly colour: HTMLImageElement;
  /** The stand-in picture, drawn twice (the grey one and the one filling in), shown in place of the two images. */
  private readonly greyStand: HTMLCanvasElement;
  private readonly colourStand: HTMLCanvasElement;
  /** Whichever of the two colour layers is shown now: the one the reveal's clip is written to. */
  private colourShown: HTMLElement;
  /** Bumped at each world's picture asked for, so an answer that comes after another world's is dropped. */
  private pictureAsk = 0;
  private readonly edge: HTMLElement;
  private readonly title: HTMLElement;
  private readonly what: HTMLElement;
  private readonly blurb: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly pct: HTMLElement;
  /** Where the reveal is asked to be, and where it is drawn; it never goes back, and it glides. */
  private target = 0;
  private shown = 0;
  private raf = 0;
  private visible = false;
  private planetId = '';
  /** When the screen was last shown, and whether it has begun going away: what `opaque` reads. */
  private shownAt = 0;
  private hiding = false;
  /**
   * Told of every change the screen makes, with the page's own time: what the last trip's record is kept
   * from (`LoadingLog`, `__debug.loading()`). Nothing by default.
   */
  onChange: ((kind: 'on' | 'what' | 'off', text: string, now: number) => void) | null = null;

  constructor(parent: HTMLElement, private readonly baseUrl: string) {
    this.root = document.createElement('div');
    this.root.id = 'loading';
    this.root.innerHTML = `
      <img class="grey" alt="" draggable="false" />
      <img class="colour" alt="" draggable="false" />
      <canvas class="grey" width="1600" height="900" hidden></canvas>
      <canvas class="colour" width="1600" height="900" hidden></canvas>
      <div class="edge"></div>
      <div class="vignette"></div>
      <div class="caption">
        <div class="title"></div>
        <div class="what"></div>
        <div class="blurb"></div>
        <div class="progress"><div class="bar"></div></div>
        <div class="pct">0%</div>
      </div>`;
    parent.appendChild(this.root);
    this.grey = this.root.querySelector<HTMLImageElement>('img.grey')!;
    this.colour = this.root.querySelector<HTMLImageElement>('img.colour')!;
    this.greyStand = this.root.querySelector<HTMLCanvasElement>('canvas.grey')!;
    this.colourStand = this.root.querySelector<HTMLCanvasElement>('canvas.colour')!;
    this.colourShown = this.colour;
    this.edge = this.root.querySelector<HTMLElement>('.edge')!;
    this.title = this.root.querySelector<HTMLElement>('.title')!;
    this.what = this.root.querySelector<HTMLElement>('.what')!;
    this.blurb = this.root.querySelector<HTMLElement>('.blurb')!;
    this.bar = this.root.querySelector<HTMLElement>('.bar')!;
    this.pct = this.root.querySelector<HTMLElement>('.pct')!;
    this.colour.addEventListener('error', () => this.fallback());
  }

  get open(): boolean {
    return this.visible;
  }

  /**
   * Whether the screen covers the whole picture now: shown, its half-second fade in over, and not yet going
   * away (`opaqueAt`). Nothing behind it can be seen, so the world need not be drawn every frame
   * (`LOADING_TUNE.drawEveryMs`).
   */
  get opaque(): boolean {
    return opaqueAt(this.visible, this.hiding, this.shownAt, performance.now());
  }

  /** Show the screen for a planet (or none: a starfield), with a title and what is being waited for. */
  show(planet: PlanetDef | null, title: string, what: string): void {
    // A screen already up and covering stays covering; one coming up fades in from here.
    if (!this.visible || this.hiding) this.shownAt = performance.now();
    this.visible = true;
    this.hiding = false;
    this.target = 0;
    this.shown = 0;
    this.title.textContent = title.toUpperCase();
    this.what.textContent = what;
    this.onChange?.('on', title, performance.now());
    this.onChange?.('what', what, performance.now());
    this.blurb.textContent = planet?.description ?? '';
    const id = planet?.id ?? '';
    if (id !== this.planetId) {
      this.planetId = id;
      this.planet = planet;
      const ask = ++this.pictureAsk;
      if (planet) {
        // The picture only where the `loading` command's own index lists one (ten worlds of every one the game has),
        // the stand-in otherwise: every other world's screen asked for a picture that could only miss.
        void loadingPicture(planet, this.baseUrl).then((src) => {
          if (ask !== this.pictureAsk) return;
          if (src) this.showPicture(src);
          else this.fallback();
        });
      } else this.fallback();
    }
    this.draw();
    this.root.classList.add('on');
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private planet: PlanetDef | null = null;

  /** What the wait is on now, under the title. */
  setWhat(what: string): void {
    this.what.textContent = what;
    this.onChange?.('what', what, performance.now());
  }

  /** Progress, 0 to 1. A lower value than before is ignored: the reveal never runs backwards. */
  setProgress(p: number): void {
    this.target = Math.max(this.target, Math.min(1, Math.max(0, p)));
  }

  /**
   * Fill to the end and fade away. `quick` goes at once, without the reveal's glide to the edge and its 180 ms:
   * a race start's short course curtain, which is a moment and not a journey.
   */
  async hide(opts: { quick?: boolean } = {}): Promise<void> {
    this.target = 1;
    this.hiding = true;
    if (!opts.quick) {
      // Let the reveal reach the edge before the screen goes, so the picture is seen whole for a moment.
      const t0 = performance.now();
      while (this.shown < 0.995 && performance.now() - t0 < 900) await new Promise((r) => setTimeout(r, 16));
      await new Promise((r) => setTimeout(r, 180));
    } else {
      this.shown = 1;
      this.draw();
    }
    this.visible = false;
    this.root.classList.remove('on');
    this.onChange?.('off', '', performance.now());
  }

  private tick = (): void => {
    this.raf = 0;
    if (!this.visible) return;
    // A glide toward the target: quick when far, settling when near, and a slow creep while
    // nothing reports, so a long wait still looks alive.
    const gap = this.target - this.shown;
    this.shown += gap * 0.08 + (gap > 0 ? 0.0004 : 0);
    if (this.shown > this.target) this.shown = this.target;
    this.draw();
    this.raf = requestAnimationFrame(this.tick);
  };

  private draw(): void {
    const p = this.shown;
    const right = (1 - p) * 100;
    this.colourShown.style.clipPath = `inset(0 ${right}% 0 0)`;
    this.edge.style.left = `${p * 100}%`;
    this.edge.style.opacity = p > 0.002 && p < 0.998 ? '1' : '0';
    this.bar.style.width = `${p * 100}%`;
    this.pct.textContent = `${Math.round(p * 100)}%`;
  }

  /** The game's own picture for the planet, in both layers, with the stand-in's canvases put away. */
  private showPicture(src: string): void {
    this.grey.src = src;
    this.colour.src = src;
    this.showLayers(false);
  }

  /** Which pair stands: the two images, or the two canvases of the stand-in. The reveal's clip follows the shown one. */
  private showLayers(standIn: boolean): void {
    this.grey.hidden = standIn;
    this.colour.hidden = standIn;
    this.greyStand.hidden = !standIn;
    this.colourStand.hidden = !standIn;
    this.colourShown = standIn ? this.colourStand : this.colour;
    this.draw();
  }

  /**
   * No picture for the planet: draw one from its sky, a world hanging in the dark, on the two canvases themselves (the
   * same picture twice, each drawn from the same seed), which stand where the images would. Encoding it into an image
   * for the two `<img>`s read the whole canvas back first, 54 ms the first time.
   */
  private fallback(): void {
    const greyCtx = this.greyStand.getContext('2d');
    const colourCtx = this.colourStand.getContext('2d');
    if (!greyCtx || !colourCtx) return;
    this.paintStandIn(greyCtx, this.greyStand.width, this.greyStand.height);
    this.paintStandIn(colourCtx, this.colourStand.width, this.colourStand.height);
    this.showLayers(true);
  }

  /** The stand-in picture of the planet now shown, drawn into one canvas. */
  private paintStandIn(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const planet = this.planet;
    const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
    ctx.fillStyle = '#04070d';
    ctx.fillRect(0, 0, w, h);
    // Stars, seeded by the planet so the same sky comes back for it.
    let seed = (planet?.seed ?? 7) * 7919 + 13;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 900; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const r = rnd() * 1.4 + 0.2;
      ctx.globalAlpha = 0.35 + rnd() * 0.65;
      ctx.fillStyle = rnd() < 0.15 ? '#bcd3ff' : '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // The planet: lit from the upper left in its own sky and ground colours, its far side dark.
    const sky = planet?.sky;
    const light = sky ? hex(sky.horizon) : '#c9d6e6';
    const mid = planet ? hex(planet.palette.mid) : '#6c8aa8';
    const deep = planet ? hex(planet.palette.slope) : '#2a3d55';
    const cx = w * 0.62;
    const cy = h * 0.58;
    const R = h * 0.42;
    const glow = ctx.createRadialGradient(cx, cy, R * 0.98, cx, cy, R * 1.12);
    glow.addColorStop(0, sky ? `${hex(sky.top)}88` : '#88aaff66');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.12, 0, Math.PI * 2);
    ctx.fill();
    const body = ctx.createRadialGradient(cx - R * 0.45, cy - R * 0.45, R * 0.1, cx, cy, R);
    body.addColorStop(0, light);
    body.addColorStop(0.45, mid);
    body.addColorStop(0.8, deep);
    body.addColorStop(1, '#05080c');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    // A band or two of weather, the same colour lighter, for the eye to catch.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 5; i++) {
      const y = cy - R + (i + 0.7) * (R * 2) / 6 + (rnd() - 0.5) * 30;
      ctx.beginPath();
      ctx.ellipse(cx, y, R * (0.7 + rnd() * 0.35), 6 + rnd() * 16, (rnd() - 0.5) * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
