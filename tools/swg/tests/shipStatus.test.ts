// The flight display's own behaviour (src/ui/shipHud.ts): the ship's condition block, the pips per
// fitted part and the one message a part going down makes, the three arcs round the reticle, and the
// target's bracket becoming an edge arrow. Synthetic data only: no number from the client's files.
//
// The display is DOM, so the test stands a small stub of `document` and `window` under it and a
// recorder in place of the overlay canvas. That is what lets the rules the design fixes — a dash for
// a face the ship has none of, no boost span on a ship with no booster, the pips in the condition's
// own order, exactly one message per change of state, and no DOM write at all in a steady frame — be
// checked here rather than only by eye.
//
// The display wears `src/ui/hud.css`, so the stub carries a `classList`: what used to be a style
// string is now a class, and the states worth pinning (a dash, a hit, a pip low or down, an enemy or
// a friend, the ghost's `snap`) are checked as the classes they now are.
import assert from 'node:assert/strict';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---------------------------------------------------------------------------------------------
// The stubs. Enough of an element for what the display builds and writes, and nothing more.

class StubStyle {
  cssText = '';
  display = '';
  transform = '';
  color = '';
  left = '';
  top = '';
  marginLeft = '';
  setProperty(): void {}
}

class StubList {
  private readonly names = new Set<string>();
  private readonly owner: StubEl;
  constructor(owner: StubEl) {
    this.owner = owner;
  }
  add(name: string): void {
    this.names.add(name);
    this.sync();
  }
  remove(name: string): void {
    this.names.delete(name);
    this.sync();
  }
  toggle(name: string, on?: boolean): void {
    if (on === undefined) (this.names.has(name) ? this.remove(name) : this.add(name));
    else if (on) this.add(name);
    else this.remove(name);
  }
  contains(name: string): boolean {
    return this.names.has(name);
  }
  private sync(): void {
    this.owner.setClassName([...this.names].join(' '), false);
  }
  reset(value: string): void {
    this.names.clear();
    for (const part of value.split(/\s+/)) if (part) this.names.add(part);
  }
}

class StubEl {
  readonly style = new StubStyle();
  readonly children: StubEl[] = [];
  readonly classList: StubList = new StubList(this);
  id = '';
  private name = '';
  private text = '';
  get className(): string {
    return this.name;
  }
  set className(value: string) {
    this.setClassName(value, true);
  }
  setClassName(value: string, fromName: boolean): void {
    this.name = value;
    if (fromName) this.classList.reset(value);
  }
  get textContent(): string {
    return this.text;
  }
  set textContent(value: string) {
    this.text = value;
    if (value === '') this.children.length = 0;
  }
  appendChild(child: StubEl): StubEl {
    this.children.push(child);
    return child;
  }
  append(...kids: StubEl[]): void {
    for (const k of kids) this.appendChild(k);
  }
  remove(): void {}
}

(globalThis as Record<string, unknown>).document = { createElement: () => new StubEl() };
(globalThis as Record<string, unknown>).window = { innerWidth: 1600, innerHeight: 900 };

/** One overlay call, as the recorder keeps it. A line and a polygon keep their first point too. */
interface Op {
  kind: 'arc' | 'line' | 'ring' | 'poly';
  from: number;
  to: number;
  colour: number;
  alpha: number;
  n: number;
  x: number;
  y: number;
}

class Recorder {
  readonly ops: Op[] = [];
  arc(_cx: number, _cy: number, _r: number, from: number, to: number, _w: number, colour: number, alpha: number): void {
    this.ops.push({ kind: 'arc', from, to, colour, alpha, n: 0, x: 0, y: 0 });
  }
  line(x1: number, y1: number, _x2: number, _y2: number, _w: number, colour: number, alpha: number): void {
    this.ops.push({ kind: 'line', from: 0, to: 0, colour, alpha, n: 0, x: x1, y: y1 });
  }
  ring(cx: number, cy: number, _r: number, _w: number, colour: number, alpha: number): void {
    this.ops.push({ kind: 'ring', from: 0, to: 0, colour, alpha, n: 0, x: cx, y: cy });
  }
  poly(pts: ArrayLike<number>, n: number, _w: number, colour: number, alpha: number): void {
    this.ops.push({ kind: 'poly', from: 0, to: 0, colour, alpha, n, x: pts[0] as number, y: pts[1] as number });
  }
  clear(): void {
    this.ops.length = 0;
  }
}

const { COL } = await import('../../../src/core/palette.ts');
const { HUD_SIZES, speedArc, makeSpeedArc, layout, makeLayout } = await import('../../../src/ui/hudMath.ts');
const shipHud = await import('../../../src/ui/shipHud.ts');
const { FLIGHT_RATE, ShipHud, WING_HELD, WING_NONE, WING_OPEN, STAND_ENEMY, has, newFlightView, newTargetView, partWord } = shipHud;

type Probe = {
  bars: { dashOn: boolean; cur: number; ghostAt: number; snap: boolean; ghostFor: number; flash: number; flashOn: boolean; px: number; root: StubEl }[];
  pips: { shown: boolean; share: number; down: boolean; warm: boolean; root: StubEl }[];
  writes: number;
  slotOf: string[];
  hullPct: StubEl;
  targetEl: StubEl;
  place: { w: number; h: number; arcR: number; cx: number; cy: number; scale: number; edgeInset: number };
};
const probe = (h: unknown): Probe => h as unknown as Probe;

/** A condition to hand over, filled in place as the game fills it. */
const status = (shieldF: number, shieldB: number, armF: number, armB: number, hull: number) => ({
  shield: [shieldF, shieldB] as [number, number],
  armour: [armF, armB] as [number, number],
  hull,
});

const part = (slot: string, share: number, down = false) => ({ slot, hp: share * 100, max: 100, down });

// ---------------------------------------------------------------------------------------------
// The words.
{
  ok(partWord('shield_0') === 'shield generator', 'shield_0 is the shield generator');
  ok(partWord('shield_1') === 'shield generator', 'the second shield slot is the same words');
  ok(partWord('droid_interface') === 'droid interface', 'the droid interface loses its underscore');
  ok(partWord('weapon_0') === 'gun 1', 'weapon_0 is gun 1, counting from one as a pilot would');
  ok(partWord('weapon_3') === 'gun 4', 'weapon_3 is gun 4');
  ok(partWord('engine') === 'engine', 'a plain slot is its own word');
  ok(partWord('reactor') === 'reactor', 'the reactor too');
}

// ---------------------------------------------------------------------------------------------
// A share against a maximum the ship has none of.
{
  ok(Number.isNaN(has(0, 0)), 'a layer whose maximum is 0 gives NaN, which the block draws as a dash');
  ok(has(0.5, 120) === 0.5, 'a layer the ship has keeps its share');
  ok(has(0.5, undefined) === 0.5, 'no maxima at all: the share is taken as it comes');
}

// ---------------------------------------------------------------------------------------------
// The condition block: a dash for a face the ship has none of, the hull's percentage, and the block
// fitting the window it is centred in at either end of the scale.
{
  const hud = new ShipHud(new StubEl() as never);
  const p = probe(hud);
  hud.setStatus(status(1, 1, 1, 1, 1), { shieldMax: [0, 120], armourMax: [80, 80] });
  ok(p.bars[0].dashOn, 'a front face with no shield shows a dash');
  ok(p.bars[0].root.classList.contains('none'), 'and the track it stands in is the stylesheet’s own dimmed one');
  ok(!p.bars[1].dashOn, 'the back face, which has one, shows its bar');
  ok(!p.bars[1].root.classList.contains('none'), 'and its track is not dimmed');
  ok(p.bars[1].root.classList.contains('shield'), 'a shield bar wears the shield layer’s class, which is where its colour comes from');
  ok(p.bars[4].root.classList.contains('chassis'), 'and the hull bar the chassis layer’s');
  ok(!p.bars[2].dashOn && !p.bars[3].dashOn, 'both armour faces show their bars');
  ok(!p.bars[4].dashOn, 'the hull always shows its bar');
  hud.setStatus(status(1, 1, 1, 1, 0.84), { shieldMax: [0, 120], armourMax: [80, 80] });
  ok(p.bars[4].cur > 0.83 && p.bars[4].cur < 0.85, 'the hull bar follows its share');
  ok(p.hullPct.textContent === '84%', 'and the hull’s percentage is written beside it');
  hud.setStatus(status(1, 1, 1, 1, 0.8412), { shieldMax: [0, 120], armourMax: [80, 80] });
  ok(p.hullPct.textContent === '84%', 'a share that rounds to the same percentage is not written again');

  // The block is three rows of a label, two bars and the gaps between them; centred, it must fit the
  // window at either end of the scale. (`layout().condition.w` counts one gap where the block has
  // two: it is the message column's neighbour, not this block's own width, and `hudMath.ts` is where
  // that is put right.)
  const S = HUD_SIZES;
  const L = makeLayout();
  for (const scale of [S.scaleMin, 1, S.scaleMax]) {
    layout(1280, 720, scale, L);
    const rowW = (S.shipLabelW + S.shipBarW * 2 + S.shipColGap * 2) * scale;
    ok(rowW + S.blockMargin * scale <= L.w, `the condition block’s widest row fits a 1280 px window at ${scale}×`);
  }
}

// ---------------------------------------------------------------------------------------------
// The ghost and the flash: a bar that falls flashes its layer's colour and hands the ghost to the
// stylesheet to ease down, rather than writing it every frame.
{
  const hud = new ShipHud(new StubEl() as never);
  const p = probe(hud);
  const max = { shieldMax: [120, 120], armourMax: [80, 80] };
  hud.setStatus(status(1, 1, 1, 1, 1), max);
  hud.update(1 / 60);
  ok(!p.bars[0].flashOn, 'nothing flashes while nothing has been hit');
  ok(p.bars[0].snap && p.bars[0].ghostAt === 1, 'a settled bar keeps its ghost under its own fill, with no ease on it');
  const before = p.writes;
  hud.setStatus(status(0.4, 1, 1, 1, 1), max);
  ok(p.bars[0].flashOn && p.bars[0].root.classList.contains('hit'), 'a shield that falls flashes its bar');
  ok(p.bars[0].flash > 0, 'the flash has time left on it');
  ok(!p.bars[0].snap && p.bars[0].ghostAt === p.bars[0].cur, 'the ghost is let go of and written once, for the stylesheet to walk down');
  ok(p.writes - before <= 5, `a whole hit costs a handful of writes, not one a frame (${p.writes - before})`);
  const during = p.writes;
  const ghostAt = p.bars[0].ghostAt;
  for (let i = 0; i < 20; i++) hud.update(1 / 60);
  ok(p.writes - during <= 1, `and the third of a second that follows writes only the flash going out (${p.writes - during})`);
  ok(p.bars[0].ghostAt === ghostAt, 'the ghost itself is not written again at all while it eases');
  for (let i = 0; i < 40; i++) hud.update(1 / 60);
  ok(!p.bars[0].flashOn, 'the flash goes out on its own');
  ok(p.bars[0].snap && p.bars[0].ghostFor === 0, 'and once the ease is over the ghost follows the fill again');
  hud.setStatus(status(0.9, 1, 1, 1, 1), max);
  ok(!p.bars[0].flashOn, 'a shield coming back does not flash: only a blow does');
  ok(p.bars[0].ghostAt === p.bars[0].cur, 'and the ghost rises with it, out of sight behind the fill');
}

// ---------------------------------------------------------------------------------------------
// The pips: one per fitted part, in the condition's own order, crossing out when the part goes down,
// and exactly one message for each change of state.
{
  const hud = new ShipHud(new StubEl() as never);
  const p = probe(hud);
  const said: string[] = [];
  hud.messages = (kind, text) => said.push(`${kind}|${text}`);
  const max = { shieldMax: [120, 120], armourMax: [80, 80] };
  const parts = [part('reactor', 1), part('engine', 1), part('shield_0', 1), part('booster', 1), part('weapon_0', 1)];
  hud.setStatus(status(1, 1, 1, 1, 1), max, parts);
  ok(p.pips.filter((q) => q.shown).length === 5, 'five fitted parts, five pips');
  ok(!p.pips[5].shown, 'and the rest of the pool stays hidden');
  ok(p.slotOf[0] === 'reactor' && p.slotOf[4] === 'weapon_0', 'the pips are in the condition parts’ own order');
  ok(said.length === 0, 'a ship at full health says nothing');

  parts[1] = part('engine', 0, true);
  hud.setStatus(status(1, 1, 1, 1, 1), max, parts);
  ok(said.length === 1 && said[0] === 'hit you|engine down', 'a part going down makes exactly one line, in the code’s own words');
  ok(p.pips[1].down && p.pips[1].root.classList.contains('down'), 'and its pip crosses out');
  hud.setStatus(status(1, 1, 1, 1, 1), max, parts);
  hud.setStatus(status(1, 1, 1, 1, 1), max, parts);
  ok(said.length === 1, 'the frames after it say nothing more');

  parts[1] = part('engine', 1);
  hud.setStatus(status(1, 1, 1, 1, 1), max, parts);
  ok(said.length === 2 && said[1] === 'note|engine repaired', 'coming back makes one line of its own');
  ok(!p.pips[1].down && !p.pips[1].root.classList.contains('down'), 'and the cross goes');

  // A part at a quarter or less is warm; a refit that puts another slot in that place says nothing.
  parts[0] = part('reactor', 0.2);
  hud.setStatus(status(1, 1, 1, 1, 1), max, parts);
  ok(p.pips[0].warm && p.pips[0].root.classList.contains('low'), 'a part under a quarter goes to the caution colour');
  const refit = [part('reactor', 1), part('capacitor', 1, true)];
  hud.setStatus(status(1, 1, 1, 1, 1), max, refit);
  ok(said.length === 2, 'a refit that changes which part a pip shows makes no message');
  ok(p.pips.filter((q) => q.shown).length === 2, 'and the pips follow the new fit');
}

// ---------------------------------------------------------------------------------------------
// With the block switched off the parts are still watched: the pilot keeps the one line in words,
// which is what stands in for a hover that a locked pointer cannot give.
{
  const hud = new ShipHud(new StubEl() as never);
  const p = probe(hud);
  const said: string[] = [];
  hud.messages = (kind, text) => said.push(`${kind}|${text}`);
  const max = { shieldMax: [120, 120], armourMax: [80, 80] };
  const parts = [part('reactor', 1), part('engine', 1)];
  hud.setStatus(status(1, 1, 1, 1, 1), max, parts, false);
  ok((hud as unknown as { cond: StubEl }).cond.style.display === 'none', 'the block is not drawn');
  const quiet = p.writes;
  parts[1] = part('engine', 0, true);
  hud.setStatus(status(1, 0.5, 1, 1, 0.5), max, parts, false);
  ok(said.length === 1 && said[0] === 'hit you|engine down', 'and a part going down still says so');
  ok(p.writes === quiet, 'while nothing at all is written to a block nobody can see');
  hud.setStatus(status(1, 0.5, 1, 1, 0.5), max, parts, true);
  ok((hud as unknown as { cond: StubEl }).cond.style.display === 'flex', 'switched back on the block shows again');
  ok(p.pips[1].down, 'with the pip that went down while it was off already crossed out');
}

// ---------------------------------------------------------------------------------------------
// A steady frame writes nothing at all: the number `__debug.hud()` reports must be 0.
{
  const hud = new ShipHud(new StubEl() as never);
  const p = probe(hud);
  const max = { shieldMax: [120, 120], armourMax: [80, 80] };
  const parts = [part('reactor', 1), part('engine', 1)];
  const view = newFlightView();
  view.speed = 100;
  view.topSpeed = 200;
  view.boostTop = 240;
  view.wings = WING_OPEN;
  const t = newTargetView();
  t.name = 'a fighter';
  t.kind = 'Rebel Alliance · tier 3';
  t.x = 800;
  t.y = 450;
  t.size = 80;
  t.range = 1420;
  t.standing = STAND_ENEMY;
  for (let i = 0; i < 12; i++) {
    hud.setStatus(status(1, 1, 1, 1, 1), max, parts);
    hud.setFlight(view);
    hud.setTarget(t);
    hud.update(1 / 60);
  }
  const before = p.writes;
  for (let i = 0; i < 12; i++) {
    hud.setStatus(status(1, 1, 1, 1, 1), max, parts);
    hud.setFlight(view);
    hud.setTarget(t);
    hud.update(1 / 60);
  }
  ok(p.writes === before, `nothing on the screen changed and nothing was written (${p.writes - before})`);
  ok(p.targetEl.className === 'hud-tgt enemy', 'an enemy’s block wears the enemy class the stylesheet colours it by');
  t.active = false;
  hud.setTarget(t);
  ok(p.targetEl.className === 'hud-tgt enemy inactive', 'and one that cannot be fired on is dimmed by a class as well');
  t.active = true;
  // A number that moves is written once, not every frame.
  view.speed = 150;
  for (let i = 0; i < 30; i++) {
    hud.setFlight(view);
    hud.update(1 / 60);
  }
  const after = p.writes;
  for (let i = 0; i < 30; i++) {
    hud.setFlight(view);
    hud.update(1 / 60);
  }
  ok(p.writes === after, 'a speed that has settled is not written again');
}

// ---------------------------------------------------------------------------------------------
// The three arcs. A ship with no booster has neither the booster arc nor the boost span on the speed
// arc; a hull with no wing factor has no amber span; a gun that is down leaves a notch.
{
  const hud = new ShipHud(new StubEl() as never);
  const rec = new Recorder();
  hud.attach(rec, COL);
  const view = newFlightView();
  view.speed = 120;
  view.topSpeed = 200;
  view.boostTop = 200;
  view.wingFactor = 1;
  view.gunSlots = 0;
  view.hasBooster = false;
  view.wings = WING_NONE;
  hud.setFlight(view);
  hud.update(1 / 60);
  rec.clear();
  hud.draw();
  const boostRail = rec.ops.filter((o) => o.kind === 'arc' && o.from === HUD_SIZES.boostFrom);
  ok(boostRail.length === 0, 'a ship with no booster draws no booster arc');
  const wingBand = rec.ops.filter((o) => o.kind === 'arc' && o.colour === COL.warn);
  ok(wingBand.length === 0, 'a hull with no wing factor draws no amber span');
  const boostBand = rec.ops.filter((o) => o.kind === 'arc' && o.colour === COL.accent && o.alpha < 0.3);
  ok(boostBand.length === 0, 'and no cyan boost span, since its boost top is its plain top');
  const gunRail = rec.ops.filter((o) => o.kind === 'arc' && o.from === HUD_SIZES.gunsFrom);
  ok(gunRail.length === 0, 'a ship with no gun slots draws no guns arc');
  const ticks = rec.ops.filter((o) => o.kind === 'line' && o.colour === COL.ink && o.alpha === FLIGHT_RATE.tickAlpha);
  ok(ticks.length === 2, 'the speed arc always carries its two ticks');

  // The same hull with wings, a booster and four guns, one of them down.
  view.wingFactor = 0.95;
  view.boostTop = 260;
  view.hasBooster = true;
  view.boostShare = 0.62;
  view.gunSlots = 4;
  view.gunsDown = 1 << 2;
  hud.setFlight(view);
  rec.clear();
  hud.draw();
  ok(rec.ops.some((o) => o.kind === 'arc' && o.from === HUD_SIZES.boostFrom), 'with a booster the booster arc is drawn');
  ok(rec.ops.some((o) => o.kind === 'arc' && o.colour === COL.warn && o.alpha === 0.45), 'the amber span between the two ticks appears');
  ok(rec.ops.some((o) => o.kind === 'arc' && o.colour === COL.accent && o.alpha === 0.25), 'and the cyan boost span above the plain top');
  ok(rec.ops.some((o) => o.kind === 'arc' && o.colour === COL.void), 'a gun that is down leaves a notch');
  ok(rec.ops.some((o) => o.kind === 'line' && o.colour === COL.bad), 'with a hairline across it');
  ok(rec.ops.filter((o) => o.kind === 'arc' && o.colour === COL.void).length === 1, 'and only the one gun that is down');

  // A fit with more gun slots than the arc is cut into still shows every one of them: the slots past
  // the cap share the last slice, rather than a gun going down and nothing on the arc saying so.
  view.gunSlots = 16;
  view.gunsDown = 1 << 15;
  hud.setFlight(view);
  rec.clear();
  hud.draw();
  ok(rec.ops.filter((o) => o.kind === 'arc' && o.colour === COL.void).length === 1, 'a gun down past the twelfth slot still leaves a notch');
  view.gunSlots = 4;
  view.gunsDown = 0;

  // The needle is scaled to the boost top, so it never runs off the end of the arc.
  const arc = speedArc(260, 200, 260, 0.95, makeSpeedArc());
  ok(arc.share === 1, 'at the boost top the needle is at the end of the arc');
  ok(arc.angle === HUD_SIZES.speedTo, 'which is the arc’s own last degree');
  const over = speedArc(400, 200, 260, 0.95, makeSpeedArc());
  ok(over.share === 1, 'and past it the needle is clamped rather than running on');
}

// ---------------------------------------------------------------------------------------------
// The boosting fill takes the burn's colour, and the booster's own arc with it.
{
  const hud = new ShipHud(new StubEl() as never);
  const rec = new Recorder();
  hud.attach(rec, COL);
  const view = newFlightView();
  view.speed = 240;
  view.topSpeed = 200;
  view.boostTop = 260;
  view.hasBooster = true;
  view.boostShare = 0.5;
  view.boosting = true;
  hud.setFlight(view);
  hud.update(1 / 60);
  rec.clear();
  hud.draw();
  ok(rec.ops.filter((o) => o.kind === 'arc' && o.colour === COL.hot).length === 2, 'boosting, the speed fill and the booster both go to the burn colour');
}

// ---------------------------------------------------------------------------------------------
// The cursor: inside the aim circle a diamond alone, outside it an arrow in the instrument's own
// colour — which is what tells it from the target's arrow at the edge — and always in the circle the
// display actually drew, not the one the hull worked out.
{
  const hud = new ShipHud(new StubEl() as never);
  const rec = new Recorder();
  hud.attach(rec, COL);
  const view = newFlightView();
  view.circle = 100;
  hud.setFlight(view);
  rec.clear();
  hud.draw();
  ok(rec.ops.filter((o) => o.kind === 'poly' && o.n === 4).length === 1, 'the cursor is a four-point diamond');
  ok(rec.ops.filter((o) => o.kind === 'poly' && o.n === 3).length === 0, 'and inside the circle it has no arrow behind it');

  view.inside = false;
  view.cx = 130;
  view.cy = 0;
  view.turn = 1;
  hud.setFlight(view);
  rec.clear();
  hud.draw();
  const arrow = rec.ops.filter((o) => o.kind === 'poly' && o.n === 3);
  ok(arrow.length === 1, 'pushed outside, the cursor grows an arrow');
  ok(arrow[0].colour === COL.accent, 'in the instrument’s own colour, not a target’s');
  ok(arrow[0].alpha > FLIGHT_RATE.arrowAlpha, 'brighter the harder the ship is turning');
  view.turn = 0;
  hud.setFlight(view);
  rec.clear();
  hud.draw();
  ok(Math.abs((rec.ops.find((o) => o.kind === 'poly' && o.n === 3)?.alpha ?? 0) - FLIGHT_RATE.arrowAlpha) < 1e-6, 'and dimmest when it is not turning at all');

  // A window taller than the arcs allow shrinks the drawn aim circle: the cursor is scaled into the
  // circle that was drawn, so it can never be shown outside a ring the game still counts it inside.
  const wide = new ShipHud(new StubEl() as never);
  const wideRec = new Recorder();
  wide.attach(wideRec, COL);
  const v2 = newFlightView();
  v2.circle = 400;
  v2.cx = 200;
  v2.cy = 0;
  v2.inside = false;
  wide.setFlight(v2);
  wideRec.clear();
  wide.draw();
  ok(probe(wide).place.arcR > 0 && HUD_SIZES.aimMax < v2.circle, 'the true aim circle is wider than the one the layout allows');
  ok(wideRec.ops.filter((o) => o.kind === 'poly' && o.n === 3).length === 0, 'and half a circle out in its own units is still inside the circle as drawn');
}

// ---------------------------------------------------------------------------------------------
// The target: a bracket of four corners on the screen, an edge arrow off it, and no bars on a target
// that cannot be fired on.
{
  const hud = new ShipHud(new StubEl() as never);
  const p = probe(hud);
  const rec = new Recorder();
  hud.attach(rec, COL);
  const view = newFlightView();
  hud.setFlight(view);
  const t = newTargetView();
  t.name = 'a fighter';
  t.kind = 'Rebel Alliance · tier 3';
  t.x = 800;
  t.y = 450;
  t.size = 80;
  t.range = 1420;
  t.standing = STAND_ENEMY;
  hud.setTarget(t);
  rec.clear();
  hud.draw();
  const fresh = rec.ops.filter((o) => o.kind === 'line' && o.colour === COL.bad)[0];
  // Past the lock, so the corners have closed onto the box.
  for (let i = 0; i < 40; i++) hud.update(1 / 60);
  hud.setTarget(t);
  rec.clear();
  hud.draw();
  const corners = rec.ops.filter((o) => o.kind === 'line' && o.colour === COL.bad);
  ok(corners.length === 8, 'an enemy on the screen is four L-corners, two legs each, in the enemy colour');
  ok(Math.abs(fresh.x - corners[0].x) > 1, 'and they close onto it as the lock takes, rather than standing where they started');
  ok(Math.abs(fresh.x - corners[0].x) <= HUD_SIZES.lockFrom * p.place.scale + 1e-6, 'by exactly the distance the lock opens them');
  ok(rec.ops.every((o) => o.kind !== 'poly' || o.n === 4), 'and no edge arrow while it is on the screen');
  ok(p.bars.length === 5, 'the ship’s own five bars are the condition block’s');

  // A new target opens its corners again.
  t.name = 'another fighter';
  hud.setTarget(t);
  rec.clear();
  hud.draw();
  ok(Math.abs(rec.ops.filter((o) => o.kind === 'line' && o.colour === COL.bad)[0].x - fresh.x) < 1e-6, 'a target taken afresh opens its corners again');
  t.name = 'a fighter';

  // Behind the camera: the bracket becomes one triangle and a tail.
  t.behind = true;
  t.x = 900;
  t.y = 400;
  hud.setTarget(t);
  rec.clear();
  hud.draw();
  const tri = rec.ops.filter((o) => o.kind === 'poly' && o.n === 3 && o.colour === COL.bad);
  ok(tri.length === 1, 'a target behind the camera is one arrow at the edge');
  ok(rec.ops.filter((o) => o.kind === 'line' && o.colour === COL.bad).length === 1, 'with one short tail and no corners');
  const m = (hud as unknown as { mark: { x: number; y: number; off: boolean } }).mark;
  ok(m.off, 'the mark says it was clamped');
  ok(Math.abs(m.x - p.place.w / 2) >= p.place.w / 2 - p.place.edgeInset - 1 || Math.abs(m.y - p.place.h / 2) >= p.place.h / 2 - p.place.edgeInset - 1, 'and the arrow sits on the inset box, not in the middle of the screen');

  // Off the screen to the right: the arrow rides inside the window's own edge.
  t.behind = false;
  t.x = 4000;
  t.y = 450;
  hud.setTarget(t);
  rec.clear();
  hud.draw();
  ok(rec.ops.filter((o) => o.kind === 'poly' && o.n === 3).length === 1, 'a target off the side is an arrow too');
  ok(p.place.w === 1600 && p.place.h === 900, 'the layout is the window the stub reports');
}

// ---------------------------------------------------------------------------------------------
// A target that cannot be fired on: the three bars go to dashes.
{
  const hud = new ShipHud(new StubEl() as never);
  const t = newTargetView();
  t.name = 'a fighter';
  t.x = 800;
  t.y = 450;
  t.shield = 0.7;
  t.armour = 1;
  t.hull = 0.6;
  t.active = false;
  hud.setTarget(t);
  const bars = (hud as unknown as { targetBars: { dashOn: boolean; dash: unknown }[] }).targetBars;
  ok(bars.length === 3, 'the target block carries three bars: shields, armour and hull');
  ok(bars.every((b) => b.dashOn), 'a target in a jump or dead shows no bars at all');
  ok(bars.every((b) => b.dash === null), 'and they are too short for a dash glyph, so they show the dimmed track alone');
  t.active = true;
  hud.setTarget(t);
  ok(bars.every((b) => !b.dashOn), 'and they come back the moment it can be fired on');
}

// ---------------------------------------------------------------------------------------------
// The wings' word, and the display going quiet out of a ship.
{
  const hud = new ShipHud(new StubEl() as never);
  const rec = new Recorder();
  hud.attach(rec, COL);
  const view = newFlightView();
  view.wings = WING_HELD;
  hud.setFlight(view);
  const wing = (hud as unknown as { wingWord: StubEl }).wingWord;
  ok(wing.textContent === 'wings waiting for room', 'a low wing held shut says so');
  view.wings = WING_OPEN;
  hud.setFlight(view);
  ok(wing.textContent === 'wings open', 'and open wings say that');
  view.wings = WING_NONE;
  hud.setFlight(view);
  ok(wing.textContent === '', 'a hull with no wings says nothing');
  rec.clear();
  hud.draw();
  ok(rec.ops.length > 0, 'in a ship the display draws');
  ok(hud.report().ops > 0, 'and says how many shapes it drew');
  hud.setFlight(null);
  rec.clear();
  hud.draw();
  ok(rec.ops.length === 0, 'out of one it draws nothing at all');
  hud.idle();
  ok(hud.report().ops === 0, 'and on a frame the overlay is not drawn at all the count goes with it');
  hud.clear();
  ok(probe(hud).pips.every((q) => !q.shown), 'clearing takes every pip down with it');
}

// ---------------------------------------------------------------------------------------------
// A resize is taken on the next frame, not in the middle of one.
{
  const hud = new ShipHud(new StubEl() as never);
  const p = probe(hud);
  const wide = 1920;
  (globalThis as Record<string, unknown>).window = { innerWidth: wide, innerHeight: 1080 };
  hud.update(1 / 60);
  ok(p.place.w === wide && p.place.h === 1080, 'the layout follows the window');
  ok(p.place.cx === wide / 2, 'and the reticle with it');
  hud.setScale(1.5);
  ok(hud.report().scale === 1.5, 'a change of scale is taken as well');
  ok(p.bars.length === 5 && p.pips.length === 16, 'and the blocks are built again at the new size');
  (globalThis as Record<string, unknown>).window = { innerWidth: 1600, innerHeight: 900 };
}

// ---------------------------------------------------------------------------------------------
// The overlay is never asked for anything before it is attached.
{
  const hud = new ShipHud(new StubEl() as never);
  const view = newFlightView();
  view.gunSlots = 2;
  hud.setFlight(view);
  hud.update(1 / 60);
  hud.draw();
  ok(hud.report().ops === 0, 'with no overlay attached the display draws nothing and still answers the console');
  ok(hud.report().attached === false, 'and says so');
}

// ---------------------------------------------------------------------------------------------
// The numbers this file invents are reachable live, and only they are.
{
  const hud = new ShipHud(new StubEl() as never);
  const was = hud.tune({}).speedHz;
  ok(hud.tune({ speedHz: 2 }).speedHz === 2, 'the speed readout’s rate is one call away');
  hud.tune({ speedHz: was });
  ok(hud.tune({}).speedHz === was, 'and it goes back');
  ok(hud.tune({ notAKnob: 3 } as never).speedHz === was, 'a name that is not in the table is ignored rather than added');
  ok((hud.tune({} as never) as unknown as Record<string, unknown>).notAKnob === undefined, 'so a typo cannot put a number where the display would look for one');
  ok(hud.tune({ arrowAlpha: Number.NaN }).arrowAlpha === 0.45, 'and a value that is not a finite number is ignored too');
  hud.setScale(1.5);
  ok(hud.report().scale === 1.5, 'the HUD scale reaches the display');
  hud.setScale(9);
  ok(hud.report().scale === HUD_SIZES.scaleMax, 'and is clamped to the ends the design fixes');
}

console.log(`\n${checks} checks passed`);
