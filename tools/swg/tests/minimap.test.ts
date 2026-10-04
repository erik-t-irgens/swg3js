// The minimap's arithmetic (src/ui/minimap.ts): how many pixels a metre is at a reach, which way the
// arrow points for a heading and which way the picture turns with it, a waypoint put on the circle and
// pulled in to the rim when it is further than the reach, and the clock that decides whether it is
// drawn again -- which a player standing still must never move. Then the minimap itself, on a stand-in
// page and a 2D context that records what it is asked to draw, so the drawing and the clock are pinned
// together and not only apart.
//
// Everything here is synthetic: numbers chosen for this test, nothing read from the game's files.
import assert from 'node:assert/strict';
import { MINIMAP_TUNE, MinimapClock, cityFadeSheet, facingAngle, makeMinimapPoint, minimapPoint, minimapScale, minimapTurn, tuneMinimap } from '../../../src/ui/minimap.ts';
import { CITY_TUNE } from '../../../src/story/cities.ts';
import { HUD_SIZES } from '../../../src/ui/hudMath.ts';

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
    moveTo() {},
    lineTo() {},
    closePath() {},
    stroke() {},
    fill() {},
    translate() {},
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
    Object.defineProperty(e, 'textContent', { get: () => text, set: (v) => ((text = String(v)), writes++) });
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
  const city = mm.root.children[1];
  const view = { wanted: true, pack: 'p', x: 1000, z: 2000, heading: 0, range: 800, northUp: true };
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
  ok(writes - w2 === 2, `coming back is the two writes of showing it, and nothing for the name (${writes - w2})`);
  mm.clearCity();
  ok(writes - w2 === 2, 'clearing a name that is not there writes nothing');

  // The way out to the select screen, where no frame runs: taken down outright.
  mm.showCity('Theed');
  mm.standDown();
  ok(!mm.showing && mm.root.hidden && !hudRoot.classList.contains('minimap-on') && city.className === 'hud-city', 'stood down, it is hidden, the help block has its place back and the name is gone');
  picture = null;
  mm.update(view);
  ok(!mm.showing, 'and a world with no picture never brings it up');
}

// ---------------------------------------------------------------------------------------------------
// The knob, and the city's fade written from its own numbers.
{
  const was = MINIMAP_TUNE.movePx;
  tuneMinimap({ movePx: -3 });
  ok(MINIMAP_TUNE.movePx === 0, 'a negative step is held at nought');
  tuneMinimap({ movePx: was });
  const sheet = cityFadeSheet();
  const total = CITY_TUNE.fadeIn + CITY_TUNE.hold + CITY_TUNE.fadeOut;
  ok(sheet.includes(`${total.toFixed(2)}s`), `the fade runs ${total} s in all`);
  ok(sheet.includes(`${((CITY_TUNE.fadeIn / total) * 100).toFixed(2)}%`) && sheet.includes(`${(((CITY_TUNE.fadeIn + CITY_TUNE.hold) / total) * 100).toFixed(2)}%`), 'in, held and out at the shares its numbers make');
  ok(sheet.includes('hud-city-a') && sheet.includes('hud-city-b'), 'under two names, so a new city starts its own from the top');
  ok(!/#[0-9a-f]{3,6}|rgba?\(/i.test(sheet), 'and it carries no colour');
}

console.log(`\n${checks} checks passed`);
