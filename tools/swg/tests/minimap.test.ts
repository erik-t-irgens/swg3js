// The minimap's arithmetic (src/ui/minimap.ts): how many pixels a metre is at a reach, which way the
// arrow points for a heading and which way the picture turns with it, a waypoint put on the circle and
// pulled in to the rim when it is further than the reach, and the clock that decides whether it is
// drawn again -- which a player standing still must never move. Then the minimap itself, on a stand-in
// page and a 2D context that records what it is asked to draw, so the drawing and the clock are pinned
// together and not only apart; and what lies over its circle: the world's name at the top, the map's
// own pair of coordinates at the foot (written only when the rounded pair moves, and at most `locHz`
// times a second), and the mark for north on the rim, drawn before your arrow.
//
// Everything here is synthetic: numbers chosen for this test, nothing read from the game's files.
import assert from 'node:assert/strict';
import { MINIMAP_TUNE, MinimapClock, cityFadeSheet, facingAngle, makeMinimapPoint, minimapPoint, minimapScale, minimapTurn, tuneMinimap } from '../../../src/ui/minimap.ts';
import { CITY_TUNE } from '../../../src/story/cities.ts';
import { HUD_SIZES } from '../../../src/ui/hudMath.ts';
import { COL, colourOf } from '../../../src/core/palette.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------------------------------------------
// The scale and the turns.
{
  const k = minimapScale(HUD_SIZES.minimap, 800, MINIMAP_TUNE.rimInsetPx);
  ok(near(k, (HUD_SIZES.minimap / 2 - MINIMAP_TUNE.rimInsetPx) / 800), `the rim, less its inset, is the reach (${k.toFixed(4)} px a metre at 800 m)`);
  ok(minimapScale(HUD_SIZES.minimap, 3200, 3) < minimapScale(HUD_SIZES.minimap, 300, 3), 'a longer reach is fewer pixels a metre');
  ok(Number.isFinite(minimapScale(168, 0, 3)), 'and a reach of nothing does not divide by nothing');
  // The game's forward is (sin h, cos h); the map mirrors x and runs z up the screen.
  ok(near(facingAngle(0), 0), "a heading of nought faces the game's +z, which is the map's north: up the screen");
  ok(near(facingAngle(Math.PI), 180), 'a half turn faces down the screen');
  ok(near(facingAngle(Math.PI / 2), 270), 'a quarter turn faces left, since the map mirrors the game\'s x');
  ok(minimapTurn(1.3, true) === 0, 'north up, the picture never turns');
  ok(near(minimapTurn(Math.PI / 2, false), -270), 'heading up, it turns back by the way you face');
}

// ---------------------------------------------------------------------------------------------------
// A point on the circle.
{
  const p = makeMinimapPoint();
  const k = 0.1;
  minimapPoint(100, 0, k, 0, 80, p);
  ok(near(p.x, 10) && near(p.y, 0) && !p.clamped, 'a point a hundred metres east is ten pixels right');
  minimapPoint(0, 100, k, 0, 80, p);
  ok(near(p.y, -10), 'and one north is up the screen');
  minimapPoint(5000, 0, k, 0, 80, p);
  ok(p.clamped && near(p.x, 80) && near(p.y, 0), 'one past the reach is pulled in to the rim on its own bearing');
  minimapPoint(3000, 4000, k, 0, 80, p);
  ok(p.clamped && near(Math.hypot(p.x, p.y), 80) && near(p.x / p.y, -3 / 4), 'a diagonal keeps its bearing as it is pulled in');
  minimapPoint(0, 100, k, 90, 80, p);
  ok(near(p.x, 10) && near(p.y, 0, 1e-9), 'turned a quarter clockwise, north lands on the right');
  // Heading up: whatever you face lands straight up.
  const h = 0.7;
  const turn = minimapTurn(h, false);
  const fx = -Math.sin(h);
  const fz = Math.cos(h);
  // The game's forward (sin h, cos h) in the map's frame: x mirrored, z kept.
  minimapPoint(fx * 50, fz * 50, k, turn, 80, p);
  ok(near(p.x, 0, 1e-9) && p.y < 0, `with the map turning with you, the way you face is straight up (${p.x.toFixed(3)}, ${p.y.toFixed(3)})`);
}

// ---------------------------------------------------------------------------------------------------
// The clock: standing still draws nothing; walking and turning draw when they would show.
{
  const clock = new MinimapClock();
  const k = minimapScale(168, 800, 3);
  ok(clock.wants(0, 0, 0, 1, k, true, 168), 'the first frame draws');
  clock.took(0, 0, 0, 1, k, true, 168);
  let drawn = 0;
  for (let i = 0; i < 600; i++) {
    if (clock.wants(0, 0, 0, 1, k, true, 168)) {
      drawn++;
      clock.took(0, 0, 0, 1, k, true, 168);
    }
  }
  ok(drawn === 0, 'ten seconds standing still draw nothing at all');
  const step = MINIMAP_TUNE.movePx / k;
  ok(!clock.wants(step * 0.9, 0, 0, 1, k, true, 168), `a step of less than half a pixel (${(step * 0.9).toFixed(2)} m) is not drawn`);
  ok(clock.wants(step * 1.1, 0, 0, 1, k, true, 168), 'and a step past it is');
  ok(!clock.wants(0, 0, MINIMAP_TUNE.turnDeg * 0.5, 1, k, true, 168) && clock.wants(0, 0, MINIMAP_TUNE.turnDeg * 1.5, 1, k, true, 168), `a turn under ${MINIMAP_TUNE.turnDeg} degree is not drawn, and one over it is`);
  ok(!clock.wants(0, 0, 359.6, 1, k, true, 168) || MINIMAP_TUNE.turnDeg <= 0.4, 'and a turn across north is measured the short way round');
  ok(clock.wants(0, 0, 0, 2, k, true, 168), 'a waypoint changed is drawn');
  ok(clock.wants(0, 0, 0, 1, k * 2, true, 168), 'so is a new reach');
  ok(clock.wants(0, 0, 0, 1, k, false, 168), 'and the map turned to face you');
  // A walk at a run, six metres a second for ten seconds at sixty frames: about as many drawings as
  // half-pixel steps, and nowhere near a frame each.
  const c2 = new MinimapClock();
  let n = 0;
  for (let f = 0; f < 600; f++) {
    const x = (f / 60) * 6;
    if (c2.wants(x, 0, 0, 1, k, true, 168)) {
      n++;
      c2.took(x, 0, 0, 1, k, true, 168);
    }
  }
  ok(n > 5 && n < 600 / 4, `ten seconds at a run draw ${n} times, not ${600}`);
  clock.reset();
  ok(clock.wants(0, 0, 0, 1, k, true, 168), 'and a reset draws on the next frame');
}

// ---------------------------------------------------------------------------------------------------
// The minimap itself, on a stand-in page and a 2D context that records what it is asked to draw: that a
// still player redraws nothing, that a change of waypoints or a turn redraws once, that the picture is
// drawn about you, that heading up puts whatever you face straight up, that your arrow turns with you
// only while north is up, and that the city's name never outlives the minimap standing aside.
{
  let writes = 0;
  const ops: any[] = [];
  const ctx: any = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: '',
    imageSmoothingEnabled: true,
    setTransform() {},
    clearRect() {},
    save() {},
    restore() {},
    beginPath() {},
    clip() {},
    fillRect() {},
    moveTo(x: number, y: number) {
      ops.push({ op: 'moveTo', x, y });
    },
    lineTo(x: number, y: number) {
      ops.push({ op: 'lineTo', x, y });
    },
    closePath() {},
    // What each stroke and fill was laid in, and where each translate put the origin, so a mark drawn
    // in a colour the palette has not got, or away from the circle's middle, is seen.
    stroke() {
      ops.push({ op: 'stroke', style: ctx.strokeStyle });
    },
    fill() {
      ops.push({ op: 'fill', style: ctx.fillStyle });
    },
    translate(x: number, y: number) {
      ops.push({ op: 'translate', x, y });
    },
    arc(x: number, y: number, r: number) {
      ops.push({ op: 'arc', x, y, r });
    },
    rotate(a: number) {
      ops.push({ op: 'rotate', a });
    },
    drawImage(_img: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) {
      ops.push({ op: 'drawImage', sx, sy, sw, sh, dx, dy, dw, dh });
    },
  };
  const el = (tag: string): any => {
    let hidden = false;
    let text = '';
    let cls = '';
    const classes = new Set<string>();
    const e: any = {
      tag,
      /** How many times this element's text was written, so one line's writes can be told from the rest. */
      sets: 0,
      children: [] as any[],
      style: {},
      width: 0,
      height: 0,
      firstChild: null,
      appendChild(k: any) {
        e.children.push(k);
        return k;
      },
      insertBefore(k: any) {
        e.children.unshift(k);
        return k;
      },
      classList: {
        toggle(name: string, on: boolean) {
          if (on) classes.add(name);
          else classes.delete(name);
          writes++;
        },
        contains: (name: string) => classes.has(name),
      },
      getContext: () => (tag === 'canvas' ? ctx : null),
    };
    Object.defineProperty(e, 'hidden', { get: () => hidden, set: (v) => ((hidden = !!v), writes++) });
    Object.defineProperty(e, 'textContent', { get: () => text, set: (v) => ((text = String(v)), e.sets++, writes++) });
    Object.defineProperty(e, 'className', { get: () => cls, set: (v) => ((cls = String(v)), writes++) });
    return e;
  };
  (globalThis as any).document = { createElement: el, head: { appendChild() {} } };
  const { Minimap } = await import('../../../src/ui/minimap.ts');
  const { WaypointList, mapShareX, mapShareY } = await import('../../../src/ui/spaceMapLayers.ts');

  const panel = el('div');
  const hudRoot = el('div');
  const pic = { image: { width: 1024, height: 1024 }, frame: { width: 16384, x: 0, z: 0 } };
  let picture: typeof pic | null = pic;
  const mm = new Minimap(panel, hudRoot, () => picture as any);
  // Found by its class, not by its place: the circle's face (the canvas, with the name and the
  // coordinates laid over it) stands before it in the wrap.
  const byClass = (root: any, cls: string): any => {
    for (const k of root.children ?? []) {
      if (String(k.className).split(' ').includes(cls)) return k;
      const deeper = byClass(k, cls);
      if (deeper) return deeper;
    }
    return null;
  };
  const city = byClass(mm.root, 'hud-city');
  const view = { wanted: true, pack: 'p', x: 1000, z: 2000, heading: 0, range: 800, northUp: true, now: 100 };
  const half = HUD_SIZES.minimap / 2;
  const k = minimapScale(HUD_SIZES.minimap, view.range, MINIMAP_TUNE.rimInsetPx);
  const dots = () => ops.filter((o) => o.op === 'arc' && (o.r === MINIMAP_TUNE.dotPx || o.r === MINIMAP_TUNE.trackedDotPx));
  const lastRotate = () => [...ops].reverse().find((o) => o.op === 'rotate')?.a ?? 0;

  mm.update(view);
  ok(mm.showing && !mm.root.hidden && hudRoot.classList.contains('minimap-on') && mm.redraws === 1, 'with a picture it comes up, says so to the display, and draws once');
  const img = ops.find((o) => o.op === 'drawImage');
  const ux = mapShareX(pic.frame, view.x) * pic.image.width;
  const uy = mapShareY(pic.frame, view.z) * pic.image.height;
  ok(!!img && Math.abs(img.sx + img.sw / 2 - ux) < 1e-6 && Math.abs(img.sy + img.sh / 2 - uy) < 1e-6, `the patch of picture drawn is the one about you (${(img.sx + img.sw / 2).toFixed(1)}, ${(img.sy + img.sh / 2).toFixed(1)}), north at the top of the picture`);
  ok(Math.abs(img.dx + img.dw / 2) < 1e-6 && Math.abs(img.dy + img.dh / 2) < 1e-6, 'laid with you at the middle of the circle');

  const w0 = writes;
  for (let i = 0; i < 600; i++) mm.update(view);
  ok(mm.redraws === 1 && writes === w0, `ten seconds standing still: no drawing and no write (${mm.redraws} drawings)`);

  // A waypoint dead ahead, fifty metres up the way you face: the game's forward (sin h, cos h) is, in
  // the map's frame, x mirrored and z kept.
  const list = new WaypointList();
  const h = 0.7;
  list.begin();
  list.add('w1', 'ahead', 'warn', false, view.x - Math.sin(h) * 50, 0, view.z + Math.cos(h) * 50);
  mm.setWaypoints(list);
  view.heading = h;
  ops.length = 0;
  mm.update(view);
  ok(mm.redraws === 2, 'the waypoints and a turn together are one drawing');
  mm.update(view);
  mm.update(view);
  ok(mm.redraws === 2, 'and nothing more after it');
  const fa = facingAngle(h);
  const dn = dots()[0];
  ok(!!dn && Math.abs(dn.x - (half + 50 * k * Math.sin((fa * Math.PI) / 180))) < 1e-6 && Math.abs(dn.y - (half - 50 * k * Math.cos((fa * Math.PI) / 180))) < 1e-6, `north up, a waypoint ahead stands the way you face (${fa.toFixed(1)} degrees)`);
  ok(Math.abs(lastRotate() - (fa * Math.PI) / 180) < 1e-9, 'and your arrow is turned the way you face');

  view.northUp = false;
  ops.length = 0;
  mm.update(view);
  ok(mm.redraws === 3, 'turning the map to face you is one drawing');
  const du = dots()[0];
  ok(!!du && Math.abs(du.x - half) < 1e-6 && Math.abs(du.y - (half - 50 * k)) < 1e-6, `heading up, the waypoint ahead stands straight up from the middle (${du.x.toFixed(3)}, ${du.y.toFixed(3)})`);
  ok(lastRotate() === 0, 'and your arrow points straight up');
  ok(ops.some((o) => o.op === 'rotate' && Math.abs(o.a - (minimapTurn(h, false) * Math.PI) / 180) < 1e-9), 'with the picture turned back by the way you face');
  view.heading = h + ((MINIMAP_TUNE.turnDeg * 0.4) * Math.PI) / 180;
  mm.update(view);
  ok(mm.redraws === 3, `a turn under ${MINIMAP_TUNE.turnDeg} degree draws nothing`);
  view.heading = h + ((MINIMAP_TUNE.turnDeg * 1.5) * Math.PI) / 180;
  mm.update(view);
  ok(mm.redraws === 4, 'and one past it draws once');
  view.northUp = true;
  view.heading = h;
  mm.update(view);

  // The city's name: shown in two writes, and gone with the minimap when it stands aside, so that its
  // finished fade cannot play again from the top under the next world's map.
  const w1 = writes;
  mm.showCity('Mos Eisley');
  ok(writes - w1 === 2 && city.textContent === 'Mos Eisley' && /hud-city [ab]/.test(city.className), 'a city walked into is its name and a fade, two writes');
  view.wanted = false;
  mm.update(view);
  ok(!mm.showing && mm.root.hidden && !hudRoot.classList.contains('minimap-on'), 'out in space, say, it stands aside');
  ok(city.className === 'hud-city' && city.textContent === '' && mm.cityShown === '', 'and the name goes with it, fade and all');
  view.wanted = true;
  const w2 = writes;
  mm.update(view);
  ok(mm.showing && city.className === 'hud-city', 'back on a planet the minimap returns with no name waiting to fade in');
  mm.update(view);
  ok(writes - w2 === 2, `coming back is the two writes of showing it, and nothing for the name or for coordinates that have not moved (${writes - w2})`);
  mm.clearCity();
  ok(writes - w2 === 2, 'clearing a name that is not there writes nothing');

  // The way out to the select screen, where no frame runs: taken down outright.
  mm.showCity('Theed');
  mm.standDown();
  ok(!mm.showing && mm.root.hidden && !hudRoot.classList.contains('minimap-on') && city.className === 'hud-city', 'stood down, it is hidden, the help block has its place back and the name is gone');
  picture = null;
  mm.update(view);
  ok(!mm.showing, 'and a world with no picture never brings it up');

  // A second minimap, fresh, for what lies over the circle: the coordinates at its foot, the world's name
  // at its top and the mark for north on its rim.
  //
  // Its own counters are what `__debug.minimap()` reports as `writes` and `locWrites`, and they roll over
  // once a second on the wall clock, so that clock is a stand-in here, moved a frame at a time, and the
  // test keeps a second of its own beside it from what the stand-in page saw written. Every frame, the
  // minimap's last second must be the page's: a write that missed its counter would leave the console
  // reading nought while the page was being written.
  const realDateNow = Date.now;
  let wall = 5_000_000;
  Date.now = () => wall;
  picture = pic;
  const mm2 = new Minimap(el('div'), el('div'), () => picture as any);
  const v2 = { wanted: true, pack: 'p', x: 2400.3, z: -812.6, heading: 0, range: 800, northUp: true, now: 50 };
  const loc = byClass(mm2.root, 'hud-mm-loc');
  const name = byClass(mm2.root, 'hud-mm-name');
  const second = { start: wall, all: 0, loc: 0, lastAll: 0, lastLoc: 0, frames: 0, agreed: 0, busy: 0 };
  /** Something done to the minimap, its writes laid into the test's own second. */
  const act = (what: () => void) => {
    const w = writes;
    const s = loc.sets;
    what();
    second.all += writes - w;
    second.loc += loc.sets - s;
  };
  /** One frame: the clocks on, the test's second rolled exactly as the minimap's is, then the update. */
  const tick = (dt = 1 / 60) => {
    wall += dt * 1000;
    v2.now += dt;
    if (wall - second.start >= 1000) {
      second.lastAll = second.all;
      second.lastLoc = second.loc;
      second.all = 0;
      second.loc = 0;
      second.start = wall;
    }
    act(() => mm2.update(v2));
    second.frames++;
    if (mm2.writesLastSecond === second.lastAll && mm2.locWritesLastSecond === second.lastLoc) second.agreed++;
    if (second.lastLoc > 0) second.busy++;
  };
  const still = (frames: number) => {
    for (let f = 0; f < frames; f++) tick();
  };
  try {
    tick();
    ok(!!loc && loc.textContent === '2400, -813', `the coordinates over the foot of the circle are the map's own pair, rounded (${loc?.textContent})`);
    ok(mm2.locShown === '2400, -813', 'and the console reads the same words');
    {
      const w = writes;
      still(300);
      ok(writes === w, `five seconds standing still write nothing at all, the coordinates included (${writes - w})`);
      ok(mm2.writesLastSecond === 0 && mm2.locWritesLastSecond === 0, 'and the console says so: no writes in the last second, none of them the coordinates');
    }
    {
      // Standing still is not holding perfectly still: a hull on its springs or a body settling moves a
      // few tenths of a metre about a point, and the pair it rounds to has not moved, so nothing is written
      // and nothing is drawn.
      const s = loc.sets;
      const r = mm2.redraws;
      for (let f = 1; f <= 300; f++) {
        v2.x = 2400.3 + 0.15 * Math.sin(f * 0.7);
        v2.z = -812.8 + 0.15 * Math.cos(f * 0.9);
        tick();
      }
      ok(loc.sets === s && mm2.redraws === r, `a few tenths of a metre about one spot write nothing and draw nothing (${loc.sets - s} writes, ${mm2.redraws - r} drawings)`);
      v2.x = 2400.3;
      v2.z = -812.6;
      still(60);
    }
    {
      // A pair that moves inside the wait is held back, and must not be lost: standing still after it,
      // the first frame past the wait writes it, whatever the pair before it was.
      v2.x = 2401.2;
      tick();
      ok(loc.textContent === '2401, -813', `a pair moved after a long still is written at once (${loc.textContent})`);
      v2.x = 2402.2;
      tick();
      ok(loc.textContent === '2401, -813', 'one moved again inside the wait is held back');
      still(Math.ceil(60 / MINIMAP_TUNE.locHz) + 2);
      ok(loc.textContent === '2402, -813', `and written once the wait is over, though nothing moved since (${loc.textContent})`);
    }
    // Walks east in ten seconds at sixty frames, over distances that do not divide the write's own step:
    // a new pair nearly every frame, written at most `locHz` times a second, and the last one written once
    // the walk has ended is where it ended -- which a pair taken as written while it was held back would
    // miss at some of these and not at others.
    for (const metres of [93, 97, 100, 107]) {
      const x0 = v2.x;
      const before = loc.sets;
      for (let f = 1; f <= 600; f++) {
        v2.x = x0 + (metres * f) / 600;
        tick();
      }
      const walked = loc.sets - before;
      ok(walked > 1 && walked <= MINIMAP_TUNE.locHz * 10, `walking ${metres} metres in ten seconds writes the coordinates ${walked} times, no more than ${MINIMAP_TUNE.locHz * 10}`);
      still(30);
      ok(loc.textContent === `${Math.round(v2.x)}, ${Math.round(v2.z)}` && mm2.locShown === loc.textContent, `and the last pair written is where the walk ended (${loc.textContent})`);
      const settled = loc.sets;
      still(300);
      ok(loc.sets === settled, 'and once you stop, nothing more');
    }
    {
      const w = writes;
      act(() => mm2.setName('Tatooine'));
      ok(writes - w === 1 && !!name && name.textContent === 'Tatooine' && mm2.nameShown === 'Tatooine', "the world's name over the top of the circle is one write");
      act(() => mm2.setName('Tatooine'));
      ok(writes - w === 1, 'and the same name again is none');
      still(70);
    }
    ok(second.busy > 0, `the coordinates were counted in the console's figures while the walks went on (${second.busy} frames)`);
    ok(second.agreed === second.frames, `and every frame, the console's last second is the writes the page saw, the coordinates' among them (${second.agreed} of ${second.frames})`);
  } finally {
    Date.now = realDateNow;
  }
  {
    // North: a triangle with its tip on the rim, drawn before your arrow so the arrow is the last thing
    // turned. Facing east with the map turning with you, north is a quarter turn back, to your left.
    const rim = half - MINIMAP_TUNE.rimInsetPx;
    const rotates = () => ops.map((o, i) => ({ o, i })).filter((r) => r.o.op === 'rotate');
    const tipAfter = (i: number) => ops.slice(i + 1).find((o) => o.op === 'moveTo');
    ops.length = 0;
    v2.heading = 0.4;
    mm2.update(v2);
    let rs = rotates();
    let north = rs[rs.length - 2];
    let tip = north ? tipAfter(north.i) : null;
    ok(!!north && north.o.a === 0 && !!tip && near(tip.x, 0) && near(tip.y, -rim), `north up, the mark stands at the top with its tip on the rim (${tip ? `${tip.x.toFixed(2)}, ${tip.y.toFixed(2)}` : 'none'})`);
    // Turned about the circle's own middle, and laid in the palette's own two: the accent over a halo of
    // the darkest, as every mark on the display is.
    // The origin is moved to the middle just before the turn: an earlier translate (the picture's, inside
    // a save and restore of its own) is no place for the mark to stand.
    const moved = north ? ops[north.i - 1] : null;
    ok(!!moved && moved.op === 'translate' && near(moved.x, half) && near(moved.y, half), `the mark is turned about the middle of the circle (${moved ? `${moved.op} ${moved.x}, ${moved.y}` : 'nothing before it'})`);
    const laid = north ? ops.slice(north.i + 1) : [];
    const halo = laid.find((o) => o.op === 'stroke');
    const body = laid.find((o) => o.op === 'fill');
    ok(!!halo && halo.style === colourOf(COL.void) && !!body && body.style === colourOf(COL.accent), `in the accent over a halo of the darkest (${body?.style} over ${halo?.style})`);
    ok(near(rs[rs.length - 1].o.a, (facingAngle(0.4) * Math.PI) / 180), 'and your arrow, turned the way you face, is still the last thing turned');
    const east = -Math.PI / 2;
    ok(near(facingAngle(east), 90, 1e-9), 'a heading of minus a quarter turn faces east on the map, which mirrors the game\'s x');
    v2.northUp = false;
    v2.heading = east;
    ops.length = 0;
    mm2.update(v2);
    rs = rotates();
    north = rs[rs.length - 2];
    tip = north ? tipAfter(north.i) : null;
    ok(!!north && near(north.o.a, -Math.PI / 2, 1e-9) && !!tip && near(tip.x, 0) && near(tip.y, -rim), `heading up and facing east, the north mark is turned back a quarter, to your left, its tip still on the rim (${north ? ((north.o.a * 180) / Math.PI).toFixed(1) : 'none'} degrees)`);
    ok(rs[rs.length - 1].o.a === 0, 'and your arrow is still the last thing turned, straight up');
    const base = (i: number) => ops.slice(i + 1).find((o) => o.op === 'lineTo');
    const was = { northPx: MINIMAP_TUNE.northPx, northHalfPx: MINIMAP_TUNE.northHalfPx };
    const b0 = base(north.i);
    ok(!!b0 && near(b0.y, -rim + MINIMAP_TUNE.northPx) && near(Math.abs(b0.x), MINIMAP_TUNE.northHalfPx), `its base stands ${MINIMAP_TUNE.northPx} px in from the rim, ${2 * MINIMAP_TUNE.northHalfPx} px across`);
    tuneMinimap({ northPx: 9, northHalfPx: 5 });
    mm2.redraw();
    ops.length = 0;
    mm2.update(v2);
    rs = rotates();
    const b1 = base(rs[rs.length - 2].i);
    tuneMinimap(was);
    ok(!!b1 && near(b1.y, -rim + 9) && near(Math.abs(b1.x), 5), 'and the mark follows its tune');
  }
}

// ---------------------------------------------------------------------------------------------------
// The knob, and the city's fade written from its own numbers.
{
  const was = MINIMAP_TUNE.movePx;
  tuneMinimap({ movePx: -3 });
  ok(MINIMAP_TUNE.movePx === 0, 'a negative step is held at nought');
  tuneMinimap({ movePx: was });
  const hz = MINIMAP_TUNE.locHz;
  tuneMinimap({ locHz: 0 });
  ok(MINIMAP_TUNE.locHz > 0, `a rate of nought is held at ${MINIMAP_TUNE.locHz} a second, so the coordinates can never stop for good`);
  tuneMinimap({ locHz: hz });
  const sheet = cityFadeSheet();
  const total = CITY_TUNE.fadeIn + CITY_TUNE.hold + CITY_TUNE.fadeOut;
  ok(sheet.includes(`${total.toFixed(2)}s`), `the fade runs ${total} s in all`);
  ok(sheet.includes(`${((CITY_TUNE.fadeIn / total) * 100).toFixed(2)}%`) && sheet.includes(`${(((CITY_TUNE.fadeIn + CITY_TUNE.hold) / total) * 100).toFixed(2)}%`), 'in, held and out at the shares its numbers make');
  ok(sheet.includes('hud-city-a') && sheet.includes('hud-city-b'), 'under two names, so a new city starts its own from the top');
  ok(!/#[0-9a-f]{3,6}|rgba?\(/i.test(sheet), 'and it carries no colour');
}

console.log(`\n${checks} checks passed`);
