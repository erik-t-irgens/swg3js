// Damage feedback (src/ui/hudFeedback.ts): the arc on the side a blow came from, the tick on the
// crosshair when you land one and the red tick and ring when you kill, and the numbers over heads
// that are off until they are asked for.
//
// What is pinned here is what cannot be seen from a hidden tab: the pools never grow, the angles are
// the right way round for a blow from each side, everything is gone when its time is up, the module
// writes nothing to the page in a frame with nothing happening, and a frame the game is not
// simulating draws nothing at all and takes what was up off the screen exactly once.
//
// A tiny stand-in for the browser's DOM counts every write it is given, and a stand-in for the
// overlay records every call, so both claims can be checked from outside rather than believed.
import assert from 'node:assert/strict';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// --- the stand-in DOM -------------------------------------------------------------------------------

const dom = { text: 0, style: 0, className: 0, attr: 0 };

const styleStore = (): Record<string, string> =>
  new Proxy({} as Record<string, string>, {
    get: (t, k: string) => t[k],
    set: (t, k: string, v: string) => {
      t[k] = v;
      dom.style++;
      return true;
    },
  });

class El {
  readonly children: El[] = [];
  parent: El | null = null;
  style = styleStore();
  private cls: string[] = [];
  private text = '';
  private off = false;
  readonly classList = {
    add: (name: string) => {
      if (this.cls.includes(name)) return;
      this.cls.push(name);
      dom.className++;
    },
    remove: (name: string) => {
      const i = this.cls.indexOf(name);
      if (i < 0) return;
      this.cls.splice(i, 1);
      dom.className++;
    },
    toggle: (name: string, on?: boolean) => {
      const want = on === undefined ? !this.cls.includes(name) : on;
      if (want) this.classList.add(name);
      else this.classList.remove(name);
      return want;
    },
    contains: (name: string) => this.cls.includes(name),
  };

  tag: string;

  constructor(tag: string) {
    this.tag = tag;
  }

  get className(): string {
    return this.cls.join(' ');
  }

  set className(v: string) {
    this.cls = v.split(/\s+/).filter(Boolean);
    dom.className++;
  }

  get hidden(): boolean {
    return this.off;
  }

  set hidden(v: boolean) {
    this.off = v;
    dom.attr++;
  }

  get textContent(): string {
    return this.text;
  }

  set textContent(v: string) {
    this.text = v;
    dom.text++;
  }

  appendChild(child: El): void {
    child.parent = this;
    this.children.push(child);
  }
}

(globalThis as any).document = { createElement: (tag: string) => new El(tag) };

// --- the stand-in overlay ---------------------------------------------------------------------------

interface Call {
  kind: 'arc' | 'line' | 'ring';
  x: number;
  y: number;
  r: number;
  from: number;
  to: number;
  width: number;
  colour: number;
  alpha: number;
}

const calls: Call[] = [];
const canvas = {
  arc: (x: number, y: number, r: number, from: number, to: number, width: number, colour: number, alpha: number) => {
    calls.push({ kind: 'arc', x, y, r, from, to, width, colour, alpha });
  },
  line: (x1: number, y1: number, x2: number, y2: number, width: number, colour: number, alpha: number) => {
    calls.push({ kind: 'line', x: x1, y: y1, r: 0, from: x2, to: y2, width, colour, alpha });
  },
  ring: (x: number, y: number, r: number, width: number, colour: number, alpha: number) => {
    calls.push({ kind: 'ring', x, y, r, from: 0, to: 0, width, colour, alpha });
  },
};
const COL = { ink: 1, bad: 10 };

const { FEEDBACK_TUNE, HudFeedback } = await import('../../../src/ui/hudFeedback.ts');
const { HUD_SIZES } = await import('../../../src/ui/hudMath.ts');

const DEFAULTS = { ...FEEDBACK_TUNE };

/** A feedback on a fresh parent, attached to the stand-in overlay, with the counters reset. */
const build = (): { f: InstanceType<typeof HudFeedback>; root: El } => {
  Object.assign(FEEDBACK_TUNE, DEFAULTS);
  calls.length = 0;
  dom.text = 0;
  dom.style = 0;
  dom.className = 0;
  dom.attr = 0;
  const parent = new El('div');
  const f = new HudFeedback(parent as unknown as HTMLElement);
  f.attach(canvas, COL);
  return { f, root: f.root as unknown as El };
};

/** One drawn frame: the calls made are what is left in `calls`. */
const frame = (f: InstanceType<typeof HudFeedback>, dt = 1 / 60) => {
  calls.length = 0;
  f.update(dt);
  f.draw();
};

/** Run `seconds` of frames at 60 a second, drawing each one. */
const run = (f: InstanceType<typeof HudFeedback>, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) frame(f);
};

/** All the writes the page has taken since they were last zeroed. */
const writes = () => dom.text + dom.style + dom.className + dom.attr;
const zeroWrites = () => {
  dom.text = 0;
  dom.style = 0;
  dom.className = 0;
  dom.attr = 0;
};

/** The middle of the stand-in window, which is what the module lays itself out for with no `window`. */
const CX = 640;
const CY = 360;

// --- the pools --------------------------------------------------------------------------------------
{
  const { f, root } = build();
  ok(root.children.length === HUD_SIZES.numberPool, 'the number pool is made once, twelve elements, before a blow lands');
  for (let i = 0; i < 40; i++) f.hurt(1, 0, 0);
  frame(f, 0);
  ok(f.report().arcs === HUD_SIZES.damagePool, 'forty blows leave four arcs, never a fifth');
  ok(root.children.length === HUD_SIZES.numberPool, 'and no element was made for any of them');
}

// --- which way the arc points -------------------------------------------------------------------------
{
  const { f } = build();
  // The camera's own axes: right is world +X, up is +Y, and it looks down -Z, which is three's own.
  f.setCamera(1, 0, 0, 0, 1, 0, 0, 0, -1);
  const angleOfLast = () => {
    const arc = calls.filter((c) => c.kind === 'arc' && c.r > 100);
    assert.ok(arc.length >= 3, 'an arc is three strokes');
    return (arc[0].from + arc[0].to) / 2;
  };
  f.hurt(1, 0, 0);
  frame(f, 0);
  ok(Math.abs(angleOfLast() - 90) < 1e-6, 'a blow from the right draws its arc at three o’clock');
  const { f: g } = build();
  g.setCamera(1, 0, 0, 0, 1, 0, 0, 0, -1);
  g.hurt(-1, 0, 0);
  frame(g, 0);
  ok(Math.abs(angleOfLast() - 270) < 1e-6, 'and one from the left at nine');
  const { f: h } = build();
  h.setCamera(1, 0, 0, 0, 1, 0, 0, 0, -1);
  h.hurt(0, 0, 1);
  frame(h, 0);
  ok(Math.abs(angleOfLast() - 180) < 1e-6, 'a blow from behind draws at six, not at a rounding error either side of it');
  const { f: k } = build();
  k.setCamera(1, 0, 0, 0, 1, 0, 0, 0, -1);
  k.hurt(0, 0, -1);
  frame(k, 0);
  ok(Math.abs(angleOfLast()) < 1e-6, 'and one from straight ahead at twelve');
  // The arcs are struck on the middle of the window at the design's three radii.
  const arcs = calls.filter((c) => c.kind === 'arc');
  ok(arcs.length === 3 && arcs.every((c) => c.x === CX && c.y === CY), 'three strokes, all on the middle of the window');
  ok(arcs[0].r === HUD_SIZES.damageR1 && arcs[1].r === HUD_SIZES.damageR2 && arcs[2].r === HUD_SIZES.damageR3, 'at the three radii of the design');
  ok(arcs.every((c) => c.colour === COL.bad), 'and all three in the danger colour');
  ok(Math.abs(arcs[0].to - arcs[0].from - HUD_SIZES.damageSpan) < 1e-9, 'each spans the design’s seventy degrees');
}

// --- the arc follows the camera, or freezes ----------------------------------------------------------
{
  const { f } = build();
  f.setCamera(1, 0, 0, 0, 1, 0, 0, 0, -1);
  f.hurt(1, 0, 0);
  // Turn a quarter to the right: what was on the right is now ahead.
  f.setCamera(0, 0, -1, 0, 1, 0, 1, 0, 0);
  frame(f, 0);
  const mid = () => {
    const a = calls.filter((c) => c.kind === 'arc')[0];
    return (a.from + a.to) / 2;
  };
  ok(Math.abs(mid()) < 1e-6, 'with `followCamera` on, turning toward the blow brings its arc round to twelve');
  FEEDBACK_TUNE.followCamera = false;
  const { f: g } = build();
  FEEDBACK_TUNE.followCamera = false;
  g.setCamera(1, 0, 0, 0, 1, 0, 0, 0, -1);
  g.hurt(1, 0, 0);
  g.setCamera(0, 0, -1, 0, 1, 0, 1, 0, 0);
  frame(g, 0);
  ok(Math.abs(mid() - 90) < 1e-6, 'and with it off the arc stays where the blow landed');
  FEEDBACK_TUNE.followCamera = true;
}

// --- a blow with no direction, and one given as an angle ----------------------------------------------
{
  const { f } = build();
  f.hurt(0, 0, 0);
  frame(f, 0);
  ok(calls.length === 0 && f.report().arcs === 0, 'a blow with no direction (a fall) draws no arc at all: the vignette is the whole of it');
  f.hurtAngle(45);
  frame(f, 0);
  const a = calls.filter((c) => c.kind === 'arc')[0];
  ok(a !== undefined && Math.abs((a.from + a.to) / 2 - 45) < 1e-9, 'an angle handed over directly is drawn at that angle');
}

// --- the arc fades and goes ----------------------------------------------------------------------------
{
  const { f } = build();
  f.hurt(1, 0, 0);
  frame(f, 0);
  const first = calls.filter((c) => c.kind === 'arc')[1].alpha;
  ok(Math.abs(first - HUD_SIZES.damageA2) < 1e-9, 'an arc lands at the design’s own alpha');
  run(f, HUD_SIZES.damageSeconds / 2);
  const half = calls.filter((c) => c.kind === 'arc')[1].alpha;
  ok(half < first && half > 0, 'and is fainter half way through its life');
  run(f, HUD_SIZES.damageSeconds);
  ok(f.report().arcs === 0 && calls.length === 0, 'and is gone, drawing nothing, once its 1.2 s is up');
}

// --- the tick on the crosshair --------------------------------------------------------------------------
{
  const { f } = build();
  frame(f, 0);
  ok(calls.length === 0, 'nothing is drawn before a shot of yours lands');
  f.hit(12, false, 7, 'bantha', 0, 0, 0);
  frame(f, 0);
  const ticks = calls.filter((c) => c.kind === 'line');
  ok(ticks.length === 4, 'a blow you land ticks the crosshair: four marks, one each way');
  ok(ticks.every((c) => c.colour === COL.ink), 'in the neutral ink, not the danger colour');
  ok(ticks.every((c) => c.x === CX || c.y === CY), 'on the crosshair itself');
  ok(!calls.some((c) => c.kind === 'ring'), 'and with no ring, which is the kill’s own mark');
  run(f, HUD_SIZES.hitTickSeconds + 0.05);
  ok(calls.length === 0, 'the tick is gone a tenth of a second later');
}

// --- the kill's tick and ring ----------------------------------------------------------------------------
{
  const { f } = build();
  f.hit(30, true, 7, 'bantha', 0, 0, 0);
  frame(f, 0);
  const ticks = calls.filter((c) => c.kind === 'line');
  const ring = calls.filter((c) => c.kind === 'ring');
  ok(ticks.length === 4 && ticks.every((c) => c.colour === COL.bad), 'a kill ticks in the danger colour instead');
  ok(ring.length === 1 && Math.abs(ring[0].r - HUD_SIZES.killRingFrom) < 1e-9, 'and throws a ring out of the middle, starting where the design starts it');
  run(f, HUD_SIZES.killTickSeconds / 2);
  const mid = calls.filter((c) => c.kind === 'ring')[0];
  ok(mid.r > HUD_SIZES.killRingFrom && mid.r < HUD_SIZES.killRingTo, 'the ring is on its way out half way through');
  run(f, HUD_SIZES.killTickSeconds);
  ok(calls.length === 0, 'and both are gone after the kill’s three tenths of a second');
}

// --- the crosshair is where the game says it is -------------------------------------------------------------
{
  const { f } = build();
  f.setCentre(100, 200);
  f.hit(5, false, 7, 'bantha', 0, 0, 0);
  frame(f, 0);
  const ticks = calls.filter((c) => c.kind === 'line');
  ok(ticks.every((c) => c.x === 100 || c.y === 200), 'the tick follows the boresight when it drifts off the middle');
  f.setCentre();
  f.hit(5, false, 7, 'bantha', 0, 0, 0);
  frame(f, 0);
  ok(calls.filter((c) => c.kind === 'line').every((c) => c.x === CX || c.y === CY), 'and goes back to the middle when it is not told otherwise');
}

// --- the numbers over heads ---------------------------------------------------------------------------------
{
  const { f, root } = build();
  const shown = () => root.children.filter((c) => !c.hidden);
  // A projector that puts every world point at one place on the screen, so the rise can be measured.
  f.setProjector((_x, _y, _z, out) => {
    out.x = 500;
    out.y = 300;
    return true;
  });
  f.hit(12, false, 7, 'bantha', 1, 2, 3);
  frame(f, 0);
  ok(shown().length === 0, 'the numbers are off until they are asked for: nothing is shown');
  f.setShown(true, true, true, true);
  f.hit(12, false, 7, 'bantha', 1, 2, 3);
  frame(f, 0);
  ok(shown().length === 1 && shown()[0].textContent === '12', 'with the setting on, a blow throws one number with the damage in it');
  const at = shown()[0].style.transform;
  f.hit(3, false, 7, 'bantha', 1, 2, 3);
  frame(f, 0);
  ok(shown().length === 1 && shown()[0].textContent === '15', 'a second blow on the same body inside the merge adds to it rather than throwing another');
  run(f, FEEDBACK_TUNE.numberMerge + 0.02);
  f.hit(4, false, 7, 'bantha', 1, 2, 3);
  frame(f, 0);
  ok(shown().length === 2, 'a blow after the merge has passed gets a number of its own');
  ok(shown()[0].style.transform !== at, 'a number rises: its transform has moved since it landed');
  run(f, FEEDBACK_TUNE.numberSeconds + 0.1);
  ok(shown().length === 0, 'and every number is off the screen once its 0.8 s is up');
  ok(root.children.length === HUD_SIZES.numberPool, 'the pool never grew');
}

// --- a number is not shown without a projector, and a kill's is marked ----------------------------------------
{
  const { f, root } = build();
  f.setShown(true, true, true, true);
  f.hit(9, false, 7, 'bantha', 1, 2, 3);
  frame(f, 0);
  ok(root.children.every((c) => c.hidden), 'with no way to put a world point on the screen, no number is shown');
  f.setProjector((_x, _y, _z, out) => {
    out.x = 10;
    out.y = 10;
    return true;
  });
  f.hit(9, true, 8, 'kliknik', 1, 2, 3);
  frame(f, 0);
  const live = root.children.filter((c) => !c.hidden);
  ok(live.length === 1 && live[0].className.includes('kill'), 'the number over a body you killed is marked as the kill it was');
  // Behind the camera: kept, and simply not drawn while it is back there.
  f.setProjector(() => false);
  frame(f, 0);
  ok(root.children.every((c) => c.hidden), 'a number behind the camera is not drawn');
}

// --- what it writes to the page ---------------------------------------------------------------------------------
{
  const { f } = build();
  f.setShown(true, true, false, true);
  f.hurt(1, 0, 0);
  f.hit(10, true, 7, 'bantha', 0, 0, 0);
  run(f, 2);
  zeroWrites();
  run(f, 1);
  ok(writes() === 0, 'a second of frames with nothing happening writes nothing at all to the page');
  f.hurt(0, 0, -1);
  f.hit(4, false, 7, 'bantha', 0, 0, 0);
  run(f, 1);
  ok(writes() === 0, 'and neither does an arc or a tick, which are drawn on the canvas and never in the page');
}

// --- a frame the game is not simulating ----------------------------------------------------------------------------
{
  const { f } = build();
  f.setShown(true, true, true, true);
  f.setProjector((_x, _y, _z, out) => {
    out.x = 200;
    out.y = 200;
    return true;
  });
  f.hurt(1, 0, 0);
  f.hit(7, true, 7, 'bantha', 0, 0, 0);
  frame(f, 0);
  ok(calls.length > 0 && f.report().numbers === 1, 'while the game is simulating the arc, the tick and the number are all up');
  calls.length = 0;
  f.idle();
  ok(calls.length === 0 && f.report().ops === 0 && f.report().arcs === 0, 'the moment it is not, nothing is drawn');
  zeroWrites();
  for (let i = 0; i < 120; i++) f.idle();
  ok(writes() === 0, 'and two seconds of not simulating write nothing: what was up was taken off exactly once');
  // Nothing is left standing to come back to.
  calls.length = 0;
  f.draw();
  ok(calls.length === 0, 'nothing is left over to be drawn on the next frame that does draw');
}

// --- the lines in words ------------------------------------------------------------------------------------------
{
  const said: string[] = [];
  const { f } = build();
  f.messages = (kind, text) => said.push(`${kind}|${text}`);
  // Sixty blows of a fifth of a point each, which is what a flame thrower is.
  for (let i = 0; i < 60; i++) {
    f.hit(0.2, false, 7, 'bantha', 0, 0, 0);
    frame(f);
  }
  ok(said.length === 1, 'a weapon that hurts a fraction a frame says one line a second, not sixty');
  // Six tenths of a second of it, at a fifth of a point a frame: about seven points, in the body's name.
  const tally = /^you hit\|bantha: (\d+)$/.exec(said[0]);
  ok(tally !== null && Number(tally[1]) >= 5 && Number(tally[1]) <= 9, 'and the line carries what the body has taken since the last one, in the game’s own name for it');
  said.length = 0;
  f.hit(30, true, 7, 'bantha', 0, 0, 0);
  ok(said.length === 1 && said[0] === 'you hit|bantha killed', 'a kill says so at once, without waiting for the next line');
  said.length = 0;
  run(f, 2);
  ok(said.length === 0, 'and the body is forgotten afterwards, so nothing more is said about it');
  f.hit(10, false, 0, 'a test', 0, 0, 0);
  run(f, 2);
  ok(said.length === 0, 'a blow on nobody (the console’s own test) ticks the crosshair and is not gathered under a key of nothing');
  f.setShown(true, true, false, false);
  f.hit(10, false, 9, 'rancor', 0, 0, 0);
  run(f, 2);
  ok(said.length === 0, 'with the lines switched off nothing is said at all');
}

// --- the switches ---------------------------------------------------------------------------------------------------
{
  const { f } = build();
  ok(f.shown.arc && f.shown.tick && !f.shown.numbers && f.shown.lines, 'the arc, the tick and the lines start on and the numbers start off, as the owner settled');
  f.setShown(false, false, false, false);
  f.hurt(1, 0, 0);
  f.hit(10, true, 7, 'bantha', 0, 0, 0);
  frame(f, 0);
  ok(calls.length === 0, 'with everything off nothing is drawn, whatever happens');
}

// --- the knobs ------------------------------------------------------------------------------------------------------
{
  const { f } = build();
  const before = FEEDBACK_TUNE.numberRise;
  f.tune({ numberRise: 40, followCamera: false });
  ok(FEEDBACK_TUNE.numberRise === 40 && FEEDBACK_TUNE.followCamera === false, 'a knob written from the console reaches the table');
  f.tune({ numberRise: Number.NaN } as never);
  ok(FEEDBACK_TUNE.numberRise === 40, 'and a value that is not a number is refused rather than put into the geometry');
  f.tune({ arcAlpha: true } as never);
  ok(FEEDBACK_TUNE.arcAlpha === 1, 'as is a value of the wrong kind');
  FEEDBACK_TUNE.numberRise = before;
  FEEDBACK_TUNE.followCamera = true;
}

// --- a knob with something built behind it -----------------------------------------------------------------------------
{
  const { f, root } = build();
  f.setShown(true, true, true, true);
  f.setProjector((_x, _y, _z, out) => {
    out.x = 200;
    out.y = 200;
    return true;
  });
  const fades = (): string[] => {
    const seen: string[] = [];
    f.hit(20, false, 21, 'bantha', 1, 2, 3);
    for (let i = 0; i < 40; i++) {
      frame(f);
      const o = root.children.find((c) => !c.hidden)?.style.opacity;
      if (o && !seen.includes(o)) seen.push(o);
    }
    run(f, FEEDBACK_TUNE.numberSeconds);
    return seen;
  };
  f.tune({ numberSteps: 2 });
  const coarse = fades();
  ok(
    coarse.length > 0 && coarse.every((o) => o === '1.000' || o === '0.500' || o === '0.000'),
    'a fade written in two steps only ever writes the three opacities two steps have',
  );
  f.tune({ numberSteps: 8 });
  const fine = fades();
  ok(fine.some((o) => o !== '1.000' && o !== '0.500' && o !== '0.000'), 'and changing the step count at the console rebuilds the table rather than being written and ignored');
}

// --- a kill does not swallow the next blow's tick -------------------------------------------------------------------------
{
  const { f } = build();
  f.hit(30, true, 7, 'bantha', 0, 0, 0);
  run(f, HUD_SIZES.killTickSeconds / 3);
  f.hit(4, false, 8, 'kliknik', 0, 0, 0);
  frame(f, 0);
  const ticks = calls.filter((c) => c.kind === 'line');
  ok(ticks.length === 4 && ticks.every((c) => c.colour === COL.ink), 'shooting something a moment after a kill ticks fresh rather than showing the kill’s fading red');
  ok(calls.some((c) => c.kind === 'ring'), 'and the kill’s ring goes on expanding underneath it, as it was thrown');
}

// --- the arc stays inside the window ----------------------------------------------------------------------------------------
{
  const { f } = build();
  f.setLayout(1280, 720);
  f.hurt(1, 0, 0);
  frame(f, 0);
  const wide = calls.filter((c) => c.kind === 'arc').map((c) => c.r);
  ok(wide[2] === HUD_SIZES.damageR3, 'on a window with room to spare the arc is drawn at the design’s own radii');
  const { f: g } = build();
  g.setLayout(520, 360);
  g.hurt(1, 0, 0);
  frame(g, 0);
  const tight = calls.filter((c) => c.kind === 'arc').map((c) => c.r);
  const room = 360 / 2 - HUD_SIZES.damageWidth / 2;
  ok(tight.length === 3 && tight[2] < room, 'on a short window the three are drawn in so the outer one cannot leave the screen');
  ok(tight[0] < tight[1] && tight[1] < tight[2], 'and they are drawn in together, so the band keeps its shape rather than closing up');
  ok(Math.abs(tight[0] / tight[2] - HUD_SIZES.damageR1 / HUD_SIZES.damageR3) < 1e-9, 'at the design’s own proportions');
}

// --- the window is told, not polled ---------------------------------------------------------------------------------------
{
  const { f } = build();
  f.setLayout(900, 500);
  f.hit(5, false, 7, 'bantha', 0, 0, 0);
  frame(f, 0);
  ok(calls.filter((c) => c.kind === 'line').every((c) => c.x === 450 || c.y === 250), 'a window size handed over puts the crosshair in the middle of that window');
  f.setCentre(100, 100);
  f.setLayout(800, 600);
  f.hit(5, false, 7, 'bantha', 0, 0, 0);
  frame(f, 0);
  ok(calls.filter((c) => c.kind === 'line').every((c) => c.x === 100 || c.y === 100), 'and a resize does not take back a crosshair the game is placing itself');
}

// --- what the console is told ------------------------------------------------------------------------------------------------
{
  const { f, root } = build();
  f.setShown(true, true, true, true);
  f.setProjector((_x, _y, _z, out) => {
    out.x = 300;
    out.y = 300;
    return true;
  });
  ok(f.report().tick === -1 && f.report().kill === -1, 'before anything has happened the console is told neither has');
  f.hit(9, true, 7, 'bantha', 1, 2, 3);
  run(f, 0.5);
  f.idle();
  const after = f.report();
  ok(after.tick >= 0.4 && after.kill >= 0.4, 'and a panel opened after a kill does not make it say no blow has ever landed');
  ok(root.children.every((c) => c.hidden), 'though everything it had up is off the screen');
  const { f: g } = build();
  g.setShown(true, true, true, true);
  g.setProjector((_x, _y, _z, out) => {
    out.x = 300;
    out.y = 300;
    return true;
  });
  g.hit(9, false, 7, 'bantha', 1, 2, 3);
  frame(g, 0);
  ok(g.report().writesNow > 0 && g.report().writes === 0, 'writes are counted in a window like the rest of the display’s: this second so far, and nothing yet for the last full one');
  run(g, 1.1);
  ok(g.report().writes > 0, 'and a full second later the window has come round');
  g.clear();
  ok(g.report().tick === -1 && g.report().kill === -1, 'leaving the world forgets the blows as well as the shapes');
}

console.log(`\n${checks} checks passed`);
