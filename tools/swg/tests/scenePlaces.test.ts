// Putting the game's own camera back into one of the owner's captured places.
//
// The creation and selection screens stand the character in the real world at one of these shots.
// Nobody can eyeball a camera that is a couple of degrees off, and one that is wrong is wrong at
// every place in the same way, so the arithmetic is pure and this sweeps it over all 67 captures.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { framePlace, hourLabel, isCreatorShot, orbitFor, packPlanet, CREATOR_KEYS, FRAME_ASPECT, ORBIT_EYE_HEIGHT } from '../../../src/world/scenePlaces.ts';
import { sceneSpots, SCENE_SHOTS } from '../../../src/data/scenes.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

{
  // Travelling. A world a capture names but the game cannot reach would fail after the screen had
  // already committed to showing that place.
  const lost = [...new Set(sceneSpots().map((s) => s.pack))].filter((p) => !packPlanet(p));
  ok(lost.length === 0, `every world a capture names is one the game can travel to (${lost.join(', ') || 'all twelve resolve'})`);
  const kash = packPlanet('kashyyyk_main');
  ok(kash !== null && kash.planet !== 'kashyyyk_main' && !!kash.zone, `a many-zoned world resolves to its planet and its zone rather than to its own pack name (${JSON.stringify(kash)})`);
  const plain = packPlanet('tatooine');
  ok(plain !== null && plain.planet === 'tatooine' && plain.zone === undefined, 'and a world with one zone is simply itself');
  ok(packPlanet('not_a_world') === null, 'a pack no world carries answers null rather than a half-filled trip');
}

{
  // The camera. The third-person camera stands at `focus + dir * distance` with
  // `dir = (sin yaw cos pitch, sin pitch, cos yaw cos pitch)`, and the focus is the **eyes**.
  let worstPos = 0;
  let worstAim = 0;
  let worstName = '';
  for (const shot of SCENE_SHOTS) {
    const o = orbitFor(shot);
    const cp = Math.cos(o.pitch);
    const back = { x: Math.sin(o.yaw) * cp * o.distance, y: Math.sin(o.pitch) * o.distance, z: Math.cos(o.yaw) * cp * o.distance };
    const want = { x: shot.camera.x - shot.stand.x, y: shot.camera.y - (shot.stand.y + ORBIT_EYE_HEIGHT), z: shot.camera.z - shot.stand.z };
    const err = Math.hypot(back.x - want.x, back.y - want.y, back.z - want.z);
    if (err > worstPos) {
      worstPos = err;
      worstName = shot.name;
    }
    const looked = Math.atan2(shot.camera.look.x - shot.camera.x, shot.camera.look.z - shot.camera.z);
    const gap = Math.abs((((((o.yaw + Math.PI - looked) * 180) / Math.PI) % 360) + 540) % 360 - 180);
    if (gap > worstAim) worstAim = gap;
  }
  ok(worstPos < 1e-9, `the orbit rebuilds every captured camera offset exactly (worst ${worstPos.toExponential(1)} m, ${worstName})`);
  ok(worstAim < 1, `and aims where the shot really looked (worst ${worstAim.toFixed(2)} degrees over all 67)`);
  const flat = orbitFor({ stand: { x: 0, y: -ORBIT_EYE_HEIGHT, z: 0 }, camera: { x: 0, y: 0, z: 0 } });
  ok(Number.isFinite(flat.yaw) && Number.isFinite(flat.pitch) && flat.distance > 0, 'and a camera standing exactly on the orbit answers numbers rather than dividing by nought');

  // The eye height is the camera's own number and not ours. Read as text, because this file is
  // pure and may not import the camera, and a copy that drifts is a bug that was really reported:
  // measured from the feet the pitch came out 23 degrees too steep at every one of these shots.
  const cameraSource = readFileSync(new URL('../../../src/core/camera.ts', import.meta.url), 'utf8');
  const declared = /const EYE_HEIGHT\s*=\s*([\d.]+)/.exec(cameraSource);
  ok(!!declared && Number(declared[1]) === ORBIT_EYE_HEIGHT, `the eye height matches the camera's own EYE_HEIGHT (${declared?.[1]} against ${ORBIT_EYE_HEIGHT})`);

  // What the old reading cost, kept as a number so nobody restores it thinking it was harmless.
  const theed = SCENE_SHOTS[0];
  const fromFeet = Math.asin((theed.camera.y - theed.stand.y) / Math.hypot(theed.camera.x - theed.stand.x, theed.camera.y - theed.stand.y, theed.camera.z - theed.stand.z));
  const tilt = ((fromFeet - orbitFor(theed).pitch) * 180) / Math.PI;
  ok(tilt > 15, `measuring from the feet instead tilts the view ${tilt.toFixed(1)} degrees further down, which is what was seen on screen`);
}

{
  // The camera is the **furthest out** the creator will let anyone zoom, so a shot whose camera is
  // inside the figure, or on the wrong side of it, would be a place with no view at all.
  const tooClose = SCENE_SHOTS.filter((s) => orbitFor(s).distance < 1);
  ok(tooClose.length === 0, `every shot leaves the camera at least a metre from the eyes, which is the zoom's far limit (${tooClose.map((s) => s.name).join(', ') || 'all 67'})`);
}

{
  // Where a thing lands on the screen of a shot: what says whether a parked ship is really in it.
  const mid = framePlace({ x: 0, y: 0, z: 0, look: { x: 0, y: 0, z: -1 }, fov: 62 }, { x: 0, y: 0, z: -10 }, 16 / 9);
  ok(mid.ahead && Math.abs(mid.x) < 1e-9 && Math.abs(mid.y) < 1e-9 && mid.inFrame, 'a point straight down the view lands dead centre');
  const behind = framePlace({ x: 0, y: 0, z: 0, look: { x: 0, y: 0, z: -1 }, fov: 62 }, { x: 0, y: 0, z: 10 }, 16 / 9);
  ok(!behind.ahead && !behind.inFrame, 'and one behind the camera says so rather than answering a fraction that means nothing');
  // The edge, worked from the projection itself: at the half-angle the answer must be exactly 1.
  const tv = Math.tan((62 * Math.PI) / 360);
  const edge = framePlace({ x: 0, y: 0, z: 0, look: { x: 0, y: 0, z: -1 }, fov: 62 }, { x: 0, y: tv * 10, z: -10 }, 16 / 9);
  ok(Math.abs(edge.y - 1) < 1e-9, `a point on the top of the frame reads exactly 1 (${edge.y.toFixed(12)})`);
  // A wider window shows more sideways, so the same point moves toward the middle.
  const narrow = framePlace({ x: 0, y: 0, z: 0, look: { x: 0, y: 0, z: -1 }, fov: 62 }, { x: 4, y: 0, z: -10 }, 16 / 9);
  const wide = framePlace({ x: 0, y: 0, z: 0, look: { x: 0, y: 0, z: -1 }, fov: 62 }, { x: 4, y: 0, z: -10 }, 3);
  ok(wide.x < narrow.x && Math.abs(narrow.x / wide.x - 3 / (16 / 9)) < 1e-9, `and a wider window brings it in by exactly the aspect's ratio (${narrow.x.toFixed(3)} at 16:9, ${wide.x.toFixed(3)} at 3:1)`);
  ok(FRAME_ASPECT === 16 / 9, 'the narrowest window worth judging against is an ordinary one');
}

{
  // The words on the hour buttons, which is what the owner's own capture names become.
  ok(hourLabel('theed-overlook-earlymorning', 'theed-overlook', 7.26) === 'Early morning', 'a known word is spelled the way a person reads it');
  ok(hourLabel('rori-swamp-sunsetbeautiful', 'rori-swamp', 21.15) === 'Sunset', 'and the owner saying a sunset was beautiful still reads as sunset');
  ok(hourLabel('rori-swamp-afternoon-late', 'rori-swamp', 20.14) === 'Late afternoon', 'a word the owner hyphenated reads the same as the one they ran together');
  ok(hourLabel('yavin4-only', 'yavin4', 19.65) === '19:39', 'a shot captured at one hour, named for being the only one, reads as the time, which is always true');
  ok(hourLabel('mustafar', 'mustafar', 13.5) === '13:30', 'and so does one whose name is only the world');
  ok(hourLabel('tyrena-somethingelse', 'tyrena', 12) === 'Somethingelse', "a word nobody planned for is still the owner's and is shown, tidied, rather than replaced by a guess");
  const spots = sceneSpots();
  const dull = spots.filter((s) => new Set(s.hours.map((h) => hourLabel(h.name, s.key, h.hour))).size !== s.hours.length);
  ok(dull.length === 0, `and no place has two hours whose buttons read alike (${dull.map((d) => d.key).join(', ') || 'all seventeen read apart'})`);
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
