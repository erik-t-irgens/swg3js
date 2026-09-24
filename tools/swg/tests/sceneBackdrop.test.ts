// Laying a rendered backdrop under a live camera so the two agree.
//
// The whole risk in drawing a character over a picture of a place is that the two projections
// disagree slightly and the feet leave the ground. Nobody can eyeball a one per cent error, so the
// arithmetic is pure and this sweeps it: the same direction must land in the same place in the
// picture and in the live view, at every window shape the owner might drag the game into.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { backdropFit, backdropPath, backdropRenderFor, hourLabel, isCreatorShot, orbitFor, sceneView, CREATOR_KEYS, ORBIT_EYE_HEIGHT, type BackdropRender } from '../../../src/world/sceneBackdrop.ts';
import { sceneSpots, SCENE_SHOTS } from '../../../src/data/scenes.ts';

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
  ok(hourLabel('tyrena-somethingelse', 'tyrena', 12) === 'Somethingelse', "a word nobody planned for is still the owner's and is shown, tidied, rather than replaced by a guess");
}

{
  // The paths, which must be their own even where two captures wanted the same word.
  const spots = sceneSpots();
  const paths = new Set<string>();
  for (const s of spots) for (const h of s.hours) paths.add(backdropPath(s.key, h.name));
  const shots = spots.reduce((n, s) => n + s.hours.length, 0);
  ok(paths.size === shots, `every hour of every shot has a path of its own (${paths.size} of ${shots})`);
  ok([...paths].every((p) => /^[\w.-]+\/[\w.-]+\.jpg$/.test(p)), 'and every one is a plain folder and file name, with nothing in it a file system would refuse');
  ok(backdropPath('theed-overlook', 'theed-overlook-midday') === 'theed-overlook/midday.jpg', "a shot's own name comes off the front, so the folder is the place and the file is the hour");
}

{
  // Moving a shot into the doll's own frame, where the figure's feet are the origin. Nothing about
  // the composition may change on the way: the same camera, the same distance, the same angles.
  const off: string[] = [];
  const turned: string[] = [];
  const stretched: string[] = [];
  for (const shot of SCENE_SHOTS) {
    const v = sceneView(shot);
    const world = Math.hypot(shot.camera.x - shot.stand.x, shot.camera.y - shot.stand.y, shot.camera.z - shot.stand.z);
    const local = Math.hypot(v.camera.x, v.camera.y, v.camera.z);
    if (Math.abs(world - local) > 1e-9) stretched.push(shot.name);

    // The look-at direction must be the same direction it was, or the camera is aimed elsewhere.
    const a = { x: shot.camera.look.x - shot.camera.x, y: shot.camera.look.y - shot.camera.y, z: shot.camera.look.z - shot.camera.z };
    const b = { x: v.look.x - v.camera.x, y: v.look.y - v.camera.y, z: v.look.z - v.camera.z };
    const la = Math.hypot(a.x, a.y, a.z) || 1;
    const lb = Math.hypot(b.x, b.y, b.z) || 1;
    if ((a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb) < 1 - 1e-12) off.push(shot.name);

    // The doll is modelled facing +Z, so the turn must leave +Z pointing away from the camera.
    const faceX = Math.sin(v.faceYaw);
    const faceZ = Math.cos(v.faceYaw);
    const awayX = -v.camera.x;
    const awayZ = -v.camera.z;
    const len = Math.hypot(awayX, awayZ) || 1;
    if (Math.abs(faceX - awayX / len) > 1e-9 || Math.abs(faceZ - awayZ / len) > 1e-9) turned.push(shot.name);
  }
  ok(stretched.length === 0, `the camera keeps its distance from the figure in every shot (${stretched.join(', ') || 'all 67'})`);
  ok(off.length === 0, `and points exactly where it pointed (${off.join(', ') || 'all 67'})`);
  ok(turned.length === 0, `and the figure is turned to face away from it, which is the facing it was captured at (${turned.join(', ') || 'all 67'})`);

  // The figure stands on the floor of the doll's frame, which is what makes the contact patch and
  // the feet meet: the camera is above the standing spot in every one of these.
  const below = SCENE_SHOTS.filter((s) => sceneView(s).camera.y <= 0);
  ok(below.length === 0, `the camera is above the ground the figure stands on in every shot (${below.map((b) => b.name).join(', ') || 'all 67'})`);
}

{
  // Standing somebody back in a captured place: the three numbers the game's own orbiting camera
  // takes must reproduce the offset that was captured, or they are put somewhere else entirely.
  let worstPos = 0;
  let worstAim = 0;
  let worstName = '';
  for (const shot of SCENE_SHOTS) {
    const o = orbitFor(shot);
    const cp = Math.cos(o.pitch);
    // The camera stands at focus + dir * distance, and the focus is the eyes, not the feet.
    const back = { x: Math.sin(o.yaw) * cp * o.distance, y: Math.sin(o.pitch) * o.distance, z: Math.cos(o.yaw) * cp * o.distance };
    const want = { x: shot.camera.x - shot.stand.x, y: shot.camera.y - (shot.stand.y + ORBIT_EYE_HEIGHT), z: shot.camera.z - shot.stand.z };
    const err = Math.hypot(back.x - want.x, back.y - want.y, back.z - want.z);
    if (err > worstPos) {
      worstPos = err;
      worstName = shot.name;
    }
    // And the way it then looks: back toward the figure, which is half a turn from the offset.
    const looked = Math.atan2(shot.camera.look.x - shot.camera.x, shot.camera.look.z - shot.camera.z);
    const gap = Math.abs(((((o.yaw + Math.PI - looked) * 180) / Math.PI) % 360 + 540) % 360 - 180);
    if (gap > worstAim) worstAim = gap;
  }
  ok(worstPos < 1e-9, `the orbit rebuilds every captured camera offset exactly (worst ${worstPos.toExponential(1)} m, ${worstName})`);
  ok(worstAim < 1, `and aims where the shot really looked (worst ${worstAim.toFixed(2)} degrees over all 67)`);
  const flat = orbitFor({ stand: { x: 0, y: -ORBIT_EYE_HEIGHT, z: 0 }, camera: { x: 0, y: 0, z: 0 } });
  ok(Number.isFinite(flat.yaw) && Number.isFinite(flat.pitch) && flat.distance > 0, 'and a camera standing exactly on the orbit answers numbers rather than dividing by nought');

  // The eye height is the camera's own number and not ours. Read as text, because this file is
  // pure and may not import the camera, and a copy that drifts is the bug the owner reported:
  // measured from the feet the pitch came out 23 degrees too steep at every one of these shots.
  const cameraSource = readFileSync(new URL('../../../src/core/camera.ts', import.meta.url), 'utf8');
  const declared = /const EYE_HEIGHT\s*=\s*([\d.]+)/.exec(cameraSource);
  ok(!!declared && Number(declared[1]) === ORBIT_EYE_HEIGHT, `the eye height matches the camera's own EYE_HEIGHT (${declared?.[1]} against ${ORBIT_EYE_HEIGHT})`);

  // What the old reading cost, kept as a number so nobody restores it thinking it was harmless.
  const theed = SCENE_SHOTS[0];
  const fromFeet = Math.asin((theed.camera.y - theed.stand.y) / Math.hypot(theed.camera.x - theed.stand.x, theed.camera.y - theed.stand.y, theed.camera.z - theed.stand.z));
  const fromEyes = orbitFor(theed).pitch;
  ok(((fromFeet - fromEyes) * 180) / Math.PI > 15, `measuring from the feet instead tilts the view ${(((fromFeet - fromEyes) * 180) / Math.PI).toFixed(1)} degrees further down, which is what was seen`);
}

{
  // The creator's short list, which is the owner's ask and must actually name shots that exist.
  const keys = new Set(sceneSpots().map((s) => s.key));
  const missing = CREATOR_KEYS.filter((k) => !keys.has(k));
  ok(CREATOR_KEYS.length === 3, 'the creator offers three places, as asked');
  ok(missing.length === 0, `and every one of them is a shot that was really captured (${missing.join(', ') || 'all three found'})`);
  ok(isCreatorShot(CREATOR_KEYS[0]) && !isCreatorShot('rori-swamp'), "the selection screen's other shots are not the creator's");
}

console.log(`\n${passed} checks passed`);

