// Laying a rendered backdrop under a live camera so the two agree.
//
// The whole risk in drawing a character over a picture of a place is that the two projections
// disagree slightly and the feet leave the ground. Nobody can eyeball a one per cent error, so the
// arithmetic is pure and this sweeps it: the same direction must land in the same place in the
// picture and in the live view, at every window shape the owner might drag the game into.
import assert from 'node:assert/strict';
import { backdropFit, backdropPath, backdropRenderFor, hourLabel, isCreatorShot, CREATOR_KEYS, type BackdropRender } from '../../../src/world/sceneBackdrop.ts';
import { sceneSpots } from '../../../src/data/scenes.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

const SHOT_FOV = 62;
const render: BackdropRender = backdropRenderFor(SHOT_FOV, 3, 1600);

{
  ok(render.fov === SHOT_FOV, "the picture is rendered at the shot's own vertical angle and no wider, because a window cannot ask for more of it");
  ok(render.aspect === 3 && render.width === 4800 && render.height === 1600, `and as wide as the widest window planned for (${render.width} by ${render.height})`);
  ok(backdropRenderFor(SHOT_FOV, 0.5, 1600).aspect === 1, 'an aspect narrower than square is refused rather than rendering a sliver');
}

{
  // The vertical is exact at every window shape, which is the point of not rendering it wider.
  for (const aspect of [0.6, 1, 1.333, 1.6, 1.777, 2, 2.35, 3]) {
    const fit = backdropFit(render, { fov: SHOT_FOV, aspect });
    ok(near(fit.scaleY, 1, 1e-12), `at ${aspect}:1 the picture's height registers exactly (${fit.scaleY.toFixed(6)})`);
  }
}

{
  // Sideways the margin shrinks as the window widens, and runs out exactly where it was built to.
  const wide = backdropFit(render, { fov: SHOT_FOV, aspect: 3 });
  ok(near(wide.scaleX, 1, 1e-12) && wide.covers, 'at the widest window planned for it covers with nothing to spare');
  const ultra = backdropFit(render, { fov: SHOT_FOV, aspect: 3.56 });
  ok(!ultra.covers && ultra.scaleX < 1, `and past it the picture runs out, which is reported rather than hidden (${ultra.scaleX.toFixed(3)})`);
  const ordinary = backdropFit(render, { fov: SHOT_FOV, aspect: 16 / 9 });
  ok(ordinary.covers && near(ordinary.scaleX, 3 / (16 / 9), 1e-12), `on an ordinary window it is drawn ${ordinary.scaleX.toFixed(2)} times the viewport wide, which is the centre crop the live camera sees`);
}

{
  // The registration itself, stated as what it is for: a direction off the middle must land at the
  // same fraction of the screen in the picture and in the live view.
  const halfTan = (deg: number): number => Math.tan((deg * Math.PI) / 360);
  for (const aspect of [1.333, 1.777, 2.35]) {
    const fit = backdropFit(render, { fov: SHOT_FOV, aspect });
    // A point 10 degrees right and 8 up, as each projection places it.
    const inPic = { x: Math.tan((10 * Math.PI) / 180) / (halfTan(render.fov) * render.aspect), y: Math.tan((8 * Math.PI) / 180) / halfTan(render.fov) };
    const inView = { x: Math.tan((10 * Math.PI) / 180) / (halfTan(SHOT_FOV) * aspect), y: Math.tan((8 * Math.PI) / 180) / halfTan(SHOT_FOV) };
    ok(near(inPic.x * fit.scaleX, inView.x, 1e-12) && near(inPic.y * fit.scaleY, inView.y, 1e-12), `at ${aspect}:1 a point ten degrees across lands in the same place in both (${(inPic.x * fit.scaleX).toFixed(6)} against ${inView.x.toFixed(6)})`);
  }
}

{
  // A live camera at some other field of view is the one way to get this wrong, so the arithmetic
  // says so plainly rather than quietly drawing the picture at the wrong size.
  const wrong = backdropFit(render, { fov: 75, aspect: 16 / 9 });
  ok(wrong.scaleY < 1 && !wrong.covers, "a live camera at the player's own field of view instead of the shot's does not register, and is reported as not covering");
  ok(backdropFit(render, { fov: 0, aspect: 0 }).scaleY > 0, 'and a field of view of nothing answers a number rather than dividing by nought');
}

{
  // The words on the buttons, which is what the owner's own names become.
  ok(hourLabel('theed-overlook-earlymorning', 'theed-overlook', 7.26) === 'Early morning', 'a known word is spelled the way a person reads it');
  ok(hourLabel('rori-swamp-sunsetbeautiful', 'rori-swamp', 21.15) === 'Sunset', 'and the owner saying a sunset was beautiful still reads as sunset');
  ok(hourLabel('rori-swamp-afternoon-late', 'rori-swamp', 20.14) === 'Late afternoon', 'a word the owner hyphenated reads the same as the one they ran together');
  ok(hourLabel('yavin4-only', 'yavin4', 19.65) === '19:39', 'a shot captured at one hour, named for being the only one, reads as the time, which is always true');
  ok(hourLabel('mustafar', 'mustafar', 13.5) === '13:30', 'and so does one whose name is only the world');
  ok(hourLabel('tyrena-somethingelse', 'tyrena', 12) === 'Somethingelse', 'a word nobody planned for is still the owner’s and is shown, tidied, rather than replaced by a guess');
}

{
  // The paths, which must be their own even where two captures wanted the same word.
  const spots = sceneSpots();
  const paths = new Set<string>();
  for (const s of spots) for (const h of s.hours) paths.add(backdropPath(s.key, h.name));
  const shots = spots.reduce((n, s) => n + s.hours.length, 0);
  ok(paths.size === shots, `every hour of every shot has a path of its own (${paths.size} of ${shots})`);
  ok([...paths].every((p) => /^[\w.-]+\/[\w.-]+\.jpg$/.test(p)), 'and every one is a plain folder and file name, with nothing in it a file system would refuse');
  ok(backdropPath('theed-overlook', 'theed-overlook-midday') === 'theed-overlook/midday.jpg', 'a shot’s own name comes off the front, so the folder is the place and the file is the hour');
}

{
  // The creator's short list, which is the owner's ask and must actually name shots that exist.
  const keys = new Set(sceneSpots().map((s) => s.key));
  const missing = CREATOR_KEYS.filter((k) => !keys.has(k));
  ok(CREATOR_KEYS.length === 3, 'the creator offers three places, as asked');
  ok(missing.length === 0, `and every one of them is a shot that was really captured (${missing.join(', ') || 'all three found'})`);
  ok(isCreatorShot(CREATOR_KEYS[0]) && !isCreatorShot('rori-swamp'), 'the selection screen’s other shots are not the creator’s');
}

console.log(`\n${passed} checks passed`);
