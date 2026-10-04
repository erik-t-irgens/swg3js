// The waypoints in the world (src/ui/waypointHud.ts, src/world/waypointPlace.ts) and the Waypoints
// window's order (src/ui/waypointsUi.ts).
//
// What is pinned here:
//
//   - a mark is projected through a camera's own two matrices and drawn in its own shape: a diamond, a
//     diamond with a dot, a diamond with its foot notched; one well above or below you carries a caret
//     over or under it, pointing the way to go;
//   - the marks worked out are the nearest ten that are switched on, and the tracked one whatever its
//     distance;
//   - the tracked one off the screen is handed over to the edge arrow, on the ring inside the edge and
//     pointing the right way even from behind the camera, with its label inboard of it;
//   - a distance is said to ten metres under a kilometre and to a tenth of one beyond, and a label is
//     written only when that changes or the label moves a whole pixel: a still frame writes nothing;
//   - a mark stands on the ground the world already holds, then on ground made within the probe budget,
//     at the eye past the reach (never a probe for it) and in space, at a building's way in from outside
//     it and on the room's floor inside;
//   - a waypoint of your own is said to be reached once per approach, and never the moment it is set:
//     measured to the mark as it stands, so flying over one is not reaching it, armed again only past
//     twice the reach, and a room's only from inside that room.
//
// Everything here is synthetic: a stand-in for the page, a hand-made camera, a made-up building.
import assert from 'node:assert/strict';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// --- a stand-in for the page, counting every write a label takes ------------------------------------
let domWrites = 0;
function makeEl(): any {
  const kids: any[] = [];
  let text = '';
  let hidden = false;
  let transform = '';
  const el: any = {
    className: '',
    children: kids,
    appendChild(k: any) {
      kids.push(k);
      return k;
    },
    style: {},
  };
  Object.defineProperty(el, 'textContent', { get: () => text, set: (v) => ((text = String(v)), domWrites++) });
  Object.defineProperty(el, 'hidden', { get: () => hidden, set: (v) => ((hidden = !!v), domWrites++) });
  Object.defineProperty(el.style, 'transform', { get: () => transform, set: (v) => ((transform = String(v)), domWrites++) });
  return el;
}
(globalThis as any).document = { createElement: () => makeEl() };

const { WaypointHud, markShape, onScreen, waypointStep, waypointWords, markColour } = await import('../../../src/ui/waypointHud.ts');
const { WaypointPlaces, WaypointSpots, pickNearest, wayIn, MARK_PERSONAL, MARK_QUEST, MARK_ROOM } = await import('../../../src/world/waypointPlace.ts');
const { buildRoomGraph } = await import('../../../src/world/nav/navRooms.ts');
const { WAYPOINT_TUNE, tuneWaypointView } = await import('../../../src/story/waypoints.ts');
const { COL } = await import('../../../src/core/palette.ts');
const { orderRows } = await import('../../../src/ui/waypointsUi.ts');
const { HUD_SIZES } = await import('../../../src/ui/hudMath.ts');

// A camera at the origin looking down -Z, upright, a right angle of view (the same one hudIcons.test uses).
const view = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
const proj = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1.0002, -1, 0, 0, -0.2, 0] };
const camera = { matrixWorldInverse: view, projectionMatrix: proj };
const W = 800;
const H = 600;

/** An overlay that records what was asked of it. */
function recorder() {
  const calls: { op: string; n?: number; fill?: boolean; colour: number; pts?: number[] }[] = [];
  return {
    calls,
    line(_x1: number, _y1: number, _x2: number, _y2: number, _w: number, colour: number) {
      calls.push({ op: 'line', colour });
    },
    ring(_x: number, _y: number, _r: number, _w: number, colour: number) {
      calls.push({ op: 'ring', colour });
    },
    poly(pts: ArrayLike<number>, n: number, _w: number, colour: number, _a: number, _close = true, fill = false) {
      calls.push({ op: 'poly', n, fill, colour, pts: Array.from(pts).slice(0, n * 2) });
    },
  };
}

/** A source of marks, as `WaypointPlaces` hands them over. */
function source(marks: any[]) {
  return { marks, count: marks.length };
}
const mark = (o: Partial<Record<string, unknown>>) => ({ id: 'w1', name: 'a place', colour: 'accent', tracked: false, kind: MARK_PERSONAL, x: 0, y: 0, z: -20, how: 'ground', d: 20, ...o }) as any;

// ---------------------------------------------------------------------------------------------------
// The shapes and the projection.
{
  const out = new Float32Array(16);
  ok(markShape(MARK_PERSONAL, 100, 100, 7, out) === 4 && out[1] === 93 && out[2] === 107 && out[5] === 107 && out[6] === 93, 'a waypoint of your own is a diamond, seven pixels to each point');
  ok(markShape(MARK_QUEST, 100, 100, 7, out) === 4, "a quest's is the same diamond (its dot is drawn inside it)");
  const n = markShape(MARK_ROOM, 100, 100, 7, out);
  ok(n === 6 && out[7] < 107 && out[7] > 100, "a room's has its foot cut up into a notch");
  ok(onScreen(400, 300, false, W, H, 7) && !onScreen(400, 300, true, W, H, 7) && !onScreen(900, 300, false, W, H, 7), 'a point is on the screen only in front of the camera and inside the window');
  ok(markColour('warn') === COL.warn && markColour('not a colour') === COL.accent, "a mark wears its own palette colour, and anything else reads as the interface's own");
}

// ---------------------------------------------------------------------------------------------------
// The nearest ten, and the tracked one whatever its distance.
{
  const dist = new Float64Array(100);
  for (let i = 0; i < 100; i++) dist[i] = 1000 - i * 7;
  const out = new Int32Array(11);
  const used = new Uint8Array(100);
  const k = pickNearest(dist, 100, 10, 0, out, used);
  ok(k === 11, `ten nearest and the tracked one far beyond them (${k})`);
  let nearestFirst = true;
  for (let i = 1; i < 10; i++) if (dist[out[i]] < dist[out[i - 1]]) nearestFirst = false;
  ok(nearestFirst && out[0] === 99, 'nearest first');
  ok(out[10] === 0, 'with the tracked one last');
  const k2 = pickNearest(dist, 100, 10, 99, out, used);
  ok(k2 === 10, 'a tracked one already among the ten is not counted twice');
  ok(pickNearest(dist, 3, 10, -1, out, used) === 3, 'three waypoints are three marks');
}

// ---------------------------------------------------------------------------------------------------
// Distances in words, and the steps they are compared at.
{
  ok(waypointWords(4) === '0 m' && waypointWords(14) === '10 m' && waypointWords(15) === '20 m', 'under a kilometre to ten metres');
  ok(waypointWords(999) === '1000 m' && waypointWords(1000) === '1.0 km' && waypointWords(1449) === '1.4 km' && waypointWords(12345) === '12.3 km', 'from a kilometre on, to a tenth of one');
  ok(waypointWords(Number.NaN) === '' && waypointWords(-3) === '', 'and something that is not a distance is said as nothing');
  ok(waypointStep(11) === waypointStep(14) && waypointStep(14) !== waypointStep(16), 'two distances in one step are one step');
  ok(waypointStep(1040) === waypointStep(1049) && waypointStep(1049) !== waypointStep(1051), 'and in kilometres, a tenth');
  ok(waypointStep(990) !== waypointStep(1000), 'and the two kinds of step never meet');
}

// ---------------------------------------------------------------------------------------------------
// Drawing: a mark on the screen, the tracked one off it, and the labels.
{
  const hud = new WaypointHud(makeEl());
  const c = recorder();
  hud.attach(c);
  const ahead = mark({ id: 'w1', x: 0, y: 0, z: -20 });
  hud.draw(source([ahead]), camera, W, H, 0, 0, 0, false);
  const diamond = c.calls.find((x) => x.op === 'poly');
  ok(!!diamond && diamond.n === 4 && !diamond.fill, 'a waypoint ahead is a diamond, outlined');
  ok(Math.round(diamond!.pts![0]) === 400 && Math.round(diamond!.pts![1]) === 300 - HUD_SIZES.waypointMark, 'standing where the camera puts it');
  ok(hud.report().drawn === 1 && hud.report().labels === 1, 'drawn, and labelled as the nearest in view');

  c.calls.length = 0;
  const quest = mark({ id: 'q:own:x#a', kind: MARK_QUEST, tracked: true, z: -30 });
  hud.draw(source([quest]), camera, W, H, 0, 0, 0, false);
  ok(c.calls.some((x) => x.op === 'poly' && x.fill) && c.calls.some((x) => x.op === 'ring' && x.colour === COL.void), "a tracked quest's mark is filled, with its dot in the dark");

  // The carets: over a mark above you pointing up, under one below you pointing down, and none on one
  // within `heightHint` of you. A caret is the open three-point line; its middle point is its tip.
  const caretOf = () => c.calls.find((x) => x.op === 'poly' && x.n === 3 && !x.fill);
  const markY = () => c.calls.find((x) => x.op === 'poly' && x.n === 4)!.pts![3];
  c.calls.length = 0;
  hud.draw(source([mark({ id: 'w2', y: 12, z: -20 })]), camera, W, H, 0, 0, 0, false);
  const up = caretOf();
  ok(c.calls.filter((x) => x.op === 'poly').length === 2 && !!up, 'a mark standing well above you carries its caret');
  ok(!!up && up.pts![3] < up.pts![1] && up.pts![1] < markY(), `over it, pointing up (tip ${up ? Math.round(up.pts![3]) : '?'}, base ${up ? Math.round(up.pts![1]) : '?'}, mark ${Math.round(markY())})`);
  c.calls.length = 0;
  hud.draw(source([mark({ id: 'w2', y: -12, z: -20 })]), camera, W, H, 0, 0, 0, false);
  const down = caretOf();
  ok(!!down && down.pts![3] > down.pts![1] && down.pts![1] > markY(), `and one well below you carries one under it, pointing down (tip ${down ? Math.round(down.pts![3]) : '?'}, base ${down ? Math.round(down.pts![1]) : '?'}, mark ${Math.round(markY())})`);
  c.calls.length = 0;
  hud.draw(source([mark({ id: 'w2', y: WAYPOINT_TUNE.heightHint * 0.5, z: -20 })]), camera, W, H, 0, 0, 0, false);
  ok(!caretOf(), 'and one within the hint of your height carries none');

  // Behind the camera: the tracked one rides the ring as an arrow pointing back down the screen.
  c.calls.length = 0;
  const behind = mark({ id: 'w3', tracked: true, x: 0, y: 5, z: 40 });
  hud.draw(source([behind]), camera, W, H, 0, 0, 0, false);
  const arrow = c.calls.find((x) => x.op === 'poly' && x.n === 3 && x.fill);
  ok(!!arrow && c.calls.some((x) => x.op === 'line'), 'the tracked one behind you is the edge arrow and its tail');
  ok(hud.report().arrows === 1 && hud.report().drawn === 0, 'and no mark');
  // Which way it points, not merely where it stands: an arrow at the bottom edge has its tip below the
  // middle whichever way round it is drawn, so the tip is measured against its own base.
  const fromMiddle = (x: number, y: number) => Math.hypot(x - W / 2, y - H / 2);
  const tipOf = (a: { pts?: number[] }) => ({ x: a.pts![0], y: a.pts![1] });
  const baseOf = (a: { pts?: number[] }) => ({ x: (a.pts![2] + a.pts![4]) / 2, y: (a.pts![3] + a.pts![5]) / 2 });
  const tip = tipOf(arrow!);
  const base = baseOf(arrow!);
  ok(tip.y > base.y && Math.abs(tip.x - base.x) < 1, `pointing down the screen, toward behind (tip ${Math.round(tip.y)} below its base ${Math.round(base.y)})`);
  ok(fromMiddle(tip.x, tip.y) > fromMiddle(base.x, base.y), "and outward, away from the screen's middle");
  ok(hud.labelTexts().length === 1 && hud.labelTexts()[0].startsWith('w3'), 'its distance is labelled beside the arrow');
  // The label stands inboard of the arrow: between it and the middle, on the screen.
  const labelAt = (i: number) => {
    const m = /translate3d\(\s*(-?[0-9.]+)px,\s*(-?[0-9.]+)px/.exec(hud.root.children[i].style.transform);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: Number.NaN, y: Number.NaN };
  };
  const lb = labelAt(0);
  ok(fromMiddle(lb.x, lb.y) < fromMiddle(base.x, base.y) && lb.y >= 0 && lb.y <= H && Math.abs(lb.x - base.x) < 1, `with its label inboard of it, between the arrow and the middle (${Math.round(lb.x)}, ${Math.round(lb.y)})`);

  // Ahead but far off to the left: the arrow rides the left edge and points left.
  c.calls.length = 0;
  hud.draw(source([mark({ id: 'w5', tracked: true, x: -100, y: 0, z: -20 })]), camera, W, H, 0, 0, 0, false);
  const left = c.calls.find((x) => x.op === 'poly' && x.n === 3 && x.fill);
  ok(!!left, 'a tracked one ahead and far to the left is an arrow too');
  const lt = tipOf(left!);
  const lbse = baseOf(left!);
  ok(lt.x < lbse.x && Math.abs(lt.y - lbse.y) < 1 && lt.x < W / 4, `on the left edge, pointing left (tip ${Math.round(lt.x)}, base ${Math.round(lbse.x)})`);
  const ll = labelAt(0);
  ok(ll.x > lbse.x && fromMiddle(ll.x, ll.y) < fromMiddle(lbse.x, lbse.y), `its label inboard, to the right of the arrow (${Math.round(ll.x)})`);

  // One that is not tracked and is off the screen is simply not drawn.
  c.calls.length = 0;
  hud.draw(source([mark({ id: 'w4', x: 0, z: 40 })]), camera, W, H, 0, 0, 0, false);
  ok(c.calls.length === 0 && hud.report().labels === 0, 'an untracked waypoint out of sight draws nothing at all');

  // The switches: off, and off while flying.
  hud.setShown(true, false);
  c.calls.length = 0;
  hud.draw(source([ahead]), camera, W, H, 0, 0, 0, true);
  ok(c.calls.length === 0, 'flying with the marks switched off in flight draws nothing');
  hud.draw(source([ahead]), camera, W, H, 0, 0, 0, false);
  ok(c.calls.length > 0, 'and on foot they come back');
  hud.setShown(true, true);
}

// A label is written only when its words or its pixel change.
{
  const hud = new WaypointHud(makeEl());
  hud.attach(recorder());
  const m = mark({ id: 'w1', x: 0, y: 0, z: -200, tracked: true });
  hud.draw(source([m]), camera, W, H, 0, 0, 0, false);
  const first = domWrites;
  hud.draw(source([m]), camera, W, H, 0, 0, 0, false);
  ok(domWrites === first, 'a second frame with nothing moved writes nothing');
  hud.draw(source([m]), camera, W, H, 0, 0, -3, false);
  ok(domWrites === first, 'three metres nearer is the same ten-metre step, with the mark where it was on the screen: nothing');
  hud.draw(source([m]), camera, W, H, 0, 0, -8, false);
  ok(domWrites === first + 1, `eight metres nearer is a new step: one write, the words (${domWrites - first})`);
  hud.idle();
  ok(domWrites === first + 2, 'a frame that draws nothing takes the label down once');
  hud.idle();
  ok(domWrites === first + 2, 'and nothing more after that');
}

// Where a label stands, and that it moves only by whole pixels.
{
  const hud = new WaypointHud(makeEl());
  hud.attach(recorder());
  const at = () => {
    const m = /translate3d\(\s*(-?[0-9.]+)px,\s*(-?[0-9.]+)px/.exec(hud.root.children[0].style.transform);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: Number.NaN, y: Number.NaN };
  };
  // Twenty metres ahead the mark lands in the middle of the screen; a metre across at that distance is
  // twenty pixels with this camera, so a twentieth of a metre is a pixel.
  hud.draw(source([mark({ id: 'w1', x: 0, y: 0, z: -20 })]), camera, W, H, 0, 0, 0, false);
  const p = at();
  ok(p.x === 400 && p.y === 300, `a label stands at its mark's point on the screen, the stylesheet hanging it a mark's size below (${p.x}, ${p.y})`);
  const before = domWrites;
  hud.draw(source([mark({ id: 'w1', x: 0.02, y: 0, z: -20 })]), camera, W, H, 0, 0, 0, false);
  ok(domWrites === before && at().x === 400, 'a mark moved less than half a pixel moves no label and writes nothing');
  hud.draw(source([mark({ id: 'w1', x: 0.06, y: 0, z: -20 })]), camera, W, H, 0, 0, 0, false);
  ok(domWrites === before + 1 && at().x === 401, `one moved a whole pixel moves its label with one write (${domWrites - before}, at ${at().x})`);
  hud.draw(source([mark({ id: 'w1', x: 2, y: 1, z: -20 })]), camera, W, H, 0, 0, 0, false);
  ok(at().x === 440 && at().y === 285, `and it follows the mark wherever the camera puts it (${at().x}, ${at().y})`);
}

// ---------------------------------------------------------------------------------------------------
// Where a mark stands.
{
  const spots = new WaypointSpots();
  let made = 0;
  /** Where ground was made, so the far one can be seen never to have been asked for. */
  const madeAt: number[] = [];
  let inSpace = false;
  const deps = {
    cached: new Map<string, number>(),
    space: () => inSpace,
    groundCached(x: number, z: number) {
      return this.cached.get(`${x},${z}`) ?? null;
    },
    ground(x: number, _z: number) {
      made++;
      madeAt.push(x);
      return 42;
    },
    floor(_x: number, y: number, _z: number) {
      return y - 2;
    },
    room(_cell: string, _t: string, _x: number, _z: number, out: any) {
      out.found = false;
    },
  };
  const places = new WaypointPlaces();
  spots.begin();
  spots.add('w1', 'cached', 'accent', false, false, 10, 10, Number.NaN, '', '');
  spots.add('w2', 'made', 'accent', false, false, 20, 20, Number.NaN, '', '');
  spots.add('w3', 'made too', 'accent', false, false, 30, 30, Number.NaN, '', '');
  spots.add('w4', 'made three', 'accent', false, false, 40, 40, Number.NaN, '', '');
  spots.add('w5', 'far', 'accent', false, false, 5000, 0, Number.NaN, '', '');
  spots.add('w6', 'in space', 'accent', false, false, 50, 0, 77, '', '');
  deps.cached.set('10,10', 5);
  places.gather(spots, 0, 0, 0, 1.6, 0, deps);
  const by = (id: string) => places.marks.slice(0, places.count).find((m: any) => m.id === id)!;
  ok(by('w1').y === 5 && by('w1').how === 'ground', 'a mark stands on the ground the world already holds, for nothing');
  ok(made === WAYPOINT_TUNE.probesPerTick, `ground is made for no more than ${WAYPOINT_TUNE.probesPerTick} a gather (${made})`);
  ok(by('w4').how === 'eye' && by('w4').y === 1.6, 'one past the budget stands at the eye until its turn');
  ok(by('w5').how === 'eye', 'one past the reach stands at the eye: its bearing is what matters');
  ok(by('w6').y === 77 && by('w6').how === 'given', "one in space keeps the height it carries");
  places.gather(spots, 0, 0, 0, 1.6, 1, deps);
  ok(by('w4').how === 'ground' && by('w4').y === 42, 'the next gather makes the ground it had to wait for');
  ok(by('w5').how === 'eye', 'while the far one, with probes to spare now, still stands at the eye');
  const before = made;
  places.gather(spots, 0, 0, 0, 1.6, 2, deps);
  ok(made === before, 'and ground once made is kept, not made again every gather');
  places.gather(spots, 0, 0, 0, 1.6, 2 + WAYPOINT_TUNE.regroundEvery, deps);
  ok(made > before, `but asked for again after ${WAYPOINT_TUNE.regroundEvery} s`);
  ok(by('w5').how === 'eye' && !madeAt.includes(5000), `and ground is never made for one past the ${WAYPOINT_TUNE.groundReach} m reach, budget or no budget`);

  // The far one alone, with the whole budget to spend: still not one probe for it.
  const far = new WaypointSpots();
  far.begin();
  far.add('w5', 'far', 'accent', false, false, 5000, 0, Number.NaN, '', '');
  const asked = made;
  const alone = new WaypointPlaces();
  alone.gather(far, 0, 0, 0, 1.6, 0, deps);
  ok(alone.marks[0].how === 'eye' && made === asked, 'a far waypoint alone, every probe free, makes no ground either');

  // In space the ground is never asked at all, near or far: a space zone's is a plane 3 km down that is
  // never built, and a mark with no height of its own stands at the eye as a bearing.
  inSpace = true;
  const near = new WaypointSpots();
  near.begin();
  near.add('s1', 'heightless', 'accent', false, false, 30, 30, Number.NaN, '', '');
  deps.cached.set('30,30', -3000);
  const asked2 = made;
  const space = new WaypointPlaces();
  space.gather(near, 0, 100, 0, 101.6, 0, deps);
  ok(space.marks[0].how === 'eye' && space.marks[0].y === 101.6 && made === asked2, `in space a heightless mark stands at the eye (${space.marks[0].y}), never on the unbuilt ground`);
  inSpace = false;
}

// The nearest ten and the tracked one, through the gather.
{
  const spots = new WaypointSpots();
  spots.begin();
  for (let i = 0; i < 40; i++) spots.add(`w${i + 1}`, `n${i}`, 'accent', i === 39, false, i * 10 + 1, 0, 3, '', '');
  const places = new WaypointPlaces();
  places.gather(spots, 0, 0, 0, 1.6, 0, { space: () => false, groundCached: () => 0, ground: () => 0, floor: () => 0, room: (_c: string, _t: string, _x: number, _z: number, o: any) => (o.found = false) });
  ok(places.count === WAYPOINT_TUNE.marksMax + 1, `the gather works out ${WAYPOINT_TUNE.marksMax} marks and the tracked one (${places.count})`);
  ok(places.marks[places.count - 1].id === 'w40' && places.marks[places.count - 1].tracked, 'the tracked one last, four hundred metres off');
  ok(places.marks[0].id === 'w1', 'the nearest first');
}

// A room: from the street at its way in, from inside on its floor.
{
  // A building drawn by hand: outside (0) -> hall (1) -> cantina (2), each doorway a polygon in model space.
  const quad = (x: number, z: number) => ({ v: [[x - 1, 0, z], [x + 1, 0, z], [x + 1, 3, z], [x - 1, 3, z]], i: [0, 1, 2, 0, 2, 3] });
  const cells = [
    { index: 0, name: 'r0', bounds: { min: [-20, 0, -20], max: [20, 10, 20] }, portals: [{ geometry: 0, target: 1, passable: true }] },
    { index: 1, name: 'hall', bounds: { min: [-5, 0, 0], max: [5, 4, 10] }, portals: [{ geometry: 0, target: 0, passable: true }, { geometry: 1, target: 2, passable: true }] },
    { index: 2, name: 'cantina', bounds: { min: [-8, 0, 10], max: [8, 5, 30] }, portals: [{ geometry: 1, target: 1, passable: true }] },
  ];
  const graph = buildRoomGraph(cells as any, [quad(0, 0), quad(0, 10)] as any);
  const door = wayIn(graph, 2);
  ok(!!door && door.z === 0 && (door.a === 0 || door.b === 0), "the cantina's way in is the front door, the doorway from outside, not the hall's inner one");
  ok(wayIn(graph, 0) === null, 'and the outside has no way in to itself');

  const spots = new WaypointSpots();
  spots.begin();
  spots.add('w1', 'cantina', 'accent', false, false, 0, 20, Number.NaN, 'cantina', '');
  let inside = false;
  let inRoom: boolean | null = null;
  const deps = {
    space: () => false,
    groundCached: () => 0,
    ground: () => 0,
    floor: (_x: number, y: number) => y - 2.5,
    room(_cell: string, _t: string, _x: number, _z: number, out: any) {
      out.found = true;
      out.inside = inside;
      out.inRoom = inRoom ?? inside;
      out.door = !!door;
      out.doorX = door!.x;
      out.doorY = door!.y;
      out.doorZ = door!.z;
      out.top = 2.5;
    },
  };
  const places = new WaypointPlaces();
  places.gather(spots, 0, 0, -40, 1.6, 0, deps);
  ok(places.marks[0].how === 'door' && places.marks[0].z === 0 && places.marks[0].kind === MARK_ROOM, 'seen from the street, a room\'s mark stands at the building\'s way in');
  inside = true;
  places.gather(spots, 0, 0, 15, 1.6, 1, deps);
  ok(places.marks[0].how === 'room' && places.marks[0].y === 0 && places.marks[0].z === 20, "inside the building it stands on the room's own floor, at its point");

  // Reached only standing in that very room: three metres off it through a wall, in the next room of the
  // same building, is not there.
  const said: string[] = [];
  const rp = new WaypointPlaces();
  const walk = (z: number, t: number) => rp.gather(spots, 0, 0, z, 1.6, t, deps, (m: any) => said.push(m.name));
  inside = false;
  inRoom = null;
  walk(-40, 0);
  inside = true;
  inRoom = false;
  walk(17, 1);
  ok(said.length === 0, "a room's waypoint three metres off, from the next room, is not reached");
  inRoom = true;
  walk(18, 2);
  ok(said.length === 1 && said[0] === 'cantina', 'and is the moment you stand in the room itself');
  inRoom = null;
}

// Reached, once per approach.
{
  const spots = new WaypointSpots();
  spots.begin();
  spots.add('w1', 'home', 'accent', false, false, 0, 0, Number.NaN, '', '');
  const said: string[] = [];
  const deps = { space: () => false, groundCached: () => 0, ground: () => 0, floor: () => 0, room: (_c: string, _t: string, _x: number, _z: number, o: any) => (o.found = false) };
  const places = new WaypointPlaces();
  const at = (z: number, t: number, y = 0) => places.gather(spots, 0, y, z, 1.6, t, deps, (m: any) => said.push(m.name));
  at(0, 0);
  ok(said.length === 0, 'a waypoint set where you stand is not reached at once');
  at(1, 1);
  ok(said.length === 0, 'nor while you stay beside it');
  at(100, 2);
  at(5, 3);
  ok(said.length === 1 && said[0] === 'home', 'walking away and back reaches it, once');
  at(3, 4);
  at(6, 5);
  ok(said.length === 1, 'and not again while you are still at it');
  at(100, 6);
  at(2, 7);
  ok(said.length === 2, 'a second approach is a second arrival');
  // Pacing about just past the reach does not say it again: it is armed only past twice the reach.
  const R = WAYPOINT_TUNE.reachSay;
  at(R * 3.75, 8);
  at(R * 0.6, 9);
  ok(said.length === 3, 'a third approach, from well out, is said');
  at(R * 1.25, 10);
  at(R * 0.6, 11);
  ok(said.length === 3, `stepping out to ${R * 1.25} m and back in, inside twice the reach, says nothing`);
  at(R * 2.5, 12);
  at(R * 0.6, 13);
  ok(said.length === 4, `out past ${R * 2} m and back is an arrival again`);
  // Over it, high up: measured to the mark on the ground, a ship three hundred metres over the spot has
  // not reached it, and neither has one coming down to within the reach of it.
  at(100, 14);
  at(0, 15, 300);
  ok(said.length === 4, 'flying three hundred metres over a marked spot does not reach it');
  at(0, 16, R * 0.5);
  ok(said.length === 5, 'coming down to within the reach of it does');
}

// The knob takes the view's numbers and never the data's.
{
  const max = WAYPOINT_TUNE.max;
  const was = WAYPOINT_TUNE.marksMax;
  tuneWaypointView({ marksMax: 4.4, max: 5 } as never);
  ok(WAYPOINT_TUNE.marksMax === 4 && WAYPOINT_TUNE.max === max, 'the view knob moves a mark count and leaves the hundred alone');
  tuneWaypointView({ marksMax: was, nearRound: 0 });
  ok(WAYPOINT_TUNE.nearRound > 0, 'and a rounding step can never be nought');
  tuneWaypointView({ nearRound: 10 });
}

// The window's order: this world first by distance, then each other world together.
{
  const row = (id: string, here: boolean, d: number, worldName: string, name: string) => ({ id, name, world: worldName, worldName, here, d, distance: '', colour: 'accent', on: true, tracked: false, room: '' });
  const order = orderRows([row('a', false, Infinity, 'Tatooine', 'zeta'), row('b', true, 300, 'Naboo', 'far'), row('c', true, 20, 'Naboo', 'near'), row('d', false, Infinity, 'Corellia', 'x'), row('e', false, Infinity, 'Tatooine', 'alpha')]).map((r) => r.id);
  ok(order.join('') === 'cbdea', `this world's nearest first, then the others by world and by name (${order.join('')})`);
}

console.log(`\n${checks} checks passed`);
