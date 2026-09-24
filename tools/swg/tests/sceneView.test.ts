// The creator's camera: in and out along one line, and up and down when it is close.
//
// The property that matters more than any other is the first one checked: **at full zoom out the
// camera is exactly where the shot put it**. The bake carries only what that one frustum can see,
// so a camera that ended up anywhere else at rest would be looking at ground nobody built.
import assert from 'node:assert/strict';
import { clampView, distanceFor, dragView, panRange, restView, viewPose, zoomBy, SCENE_VIEW_TUNE } from '../../../src/world/sceneView.ts';
import { orbitFor, ORBIT_EYE_HEIGHT } from '../../../src/world/scenePlaces.ts';
import { sceneSpots } from '../../../src/data/scenes.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps;

{
  // At rest, every captured place must put the camera back exactly where it was captured.
  const off: string[] = [];
  for (const spot of sceneSpots()) {
    const orbit = orbitFor(spot);
    const pose = viewPose(orbit, restView(), ORBIT_EYE_HEIGHT);
    // The pose is in the place's own frame, where the feet are the origin; the capture is in the
    // world's. The two agree when the offset from the eyes matches.
    const want = { x: spot.camera.x - spot.stand.x, y: spot.camera.y - (spot.stand.y + ORBIT_EYE_HEIGHT), z: spot.camera.z - spot.stand.z };
    const got = { x: pose.camera.x, y: pose.camera.y - ORBIT_EYE_HEIGHT, z: pose.camera.z };
    const err = Math.hypot(got.x - want.x, got.y - want.y, got.z - want.z);
    if (err > 1e-9) off.push(`${spot.key} ${err.toExponential(1)}`);
  }
  ok(off.length === 0, `at rest the camera is exactly where the shot put it, at all sixteen places (${off.join(', ') || 'exact'})`);
  ok(near(viewPose(orbitFor(sceneSpots()[0]), restView(), ORBIT_EYE_HEIGHT).look.y, ORBIT_EYE_HEIGHT), 'and it is looking at the eyes, not at the feet');
}

{
  // The zoom only ever comes nearer, and by the same proportion wherever it is.
  const far = 3.5;
  ok(near(distanceFor(0, far), far), 'zoom nought is the captured distance');
  ok(near(distanceFor(1, far), SCENE_VIEW_TUNE.minDistance), 'and zoom one is as close as the creator goes');
  let last = far;
  let monotone = true;
  for (let z = 0; z <= 1.0001; z += 0.05) {
    const d = distanceFor(z, far);
    if (d > last + 1e-12) monotone = false;
    last = d;
  }
  ok(monotone, 'and nothing in between ever moves the camera further out than it started');
  // Geometric: equal steps of zoom change the distance by equal ratios, so a notch feels the same
  // near and far. A linear zoom crawls when far and leaps when near, which reads as broken.
  const r1 = distanceFor(0.2, far) / distanceFor(0.1, far);
  const r2 = distanceFor(0.8, far) / distanceFor(0.7, far);
  ok(near(r1, r2, 1e-9), `a notch changes the distance by the same ratio wherever it is (${r1.toFixed(6)} against ${r2.toFixed(6)})`);
  // A shot captured closer than the near limit must not be turned inside out by it.
  ok(distanceFor(1, 0.3) <= 0.3 && distanceFor(1, 0.3) > 0, 'a shot already closer than the limit is never pushed outwards by it');
}

{
  // The pan: nothing at the far limit, the whole range when close.
  ok(panRange(0) === 0, 'at the captured camera the view cannot slide at all, so the composition is exactly itself');
  ok(near(panRange(1), SCENE_VIEW_TUNE.panMax), 'and at full zoom it slides the whole way');
  ok(panRange(0.5) > 0 && panRange(0.5) < SCENE_VIEW_TUNE.panMax, 'growing in between rather than appearing at a threshold, which would jump the view');
  const wide = clampView({ zoom: 0, pan: 5, spin: 0 });
  ok(wide.pan === 0, 'a pan asked for at the far limit is held at nothing rather than obeyed');
  const close = clampView({ zoom: 1, pan: 5, spin: 0 });
  ok(near(close.pan, SCENE_VIEW_TUNE.panMax), 'and one asked for past the range is held at the range');
  // Zooming back out has to bring the pan home with it, or the composition would not be restorable.
  const panned = clampView({ zoom: 1, pan: SCENE_VIEW_TUNE.panMax, spin: 0 });
  const out = clampView({ ...panned, zoom: 0 });
  ok(out.pan === 0, 'and zooming back out brings the pan home, so the captured shot is always reachable again');
}

{
  // What the pan is for: the face. These shots are over the shoulder, so the near end of the line
  // is the back of a head; the face comes from turning the figure and sliding the view up.
  const orbit = orbitFor(sceneSpots()[0]);
  const closeUp = viewPose(orbit, clampView({ zoom: 1, pan: SCENE_VIEW_TUNE.panMax, spin: Math.PI }), ORBIT_EYE_HEIGHT);
  ok(closeUp.distance < 1, `zoomed in the camera is within a metre of what it is looking at (${closeUp.distance.toFixed(2)} m)`);
  ok(closeUp.look.y > ORBIT_EYE_HEIGHT, `and looking above the eye line, which is where a head is (${closeUp.look.y.toFixed(2)} m)`);
  const rest = viewPose(orbit, restView(), ORBIT_EYE_HEIGHT);
  ok(closeUp.distance < rest.distance / 2, 'and much closer than the shot it started from');
}

{
  // The drags, and which button does what.
  const turned = dragView(restView(), 100, 0, false);
  ok(turned.spin !== 0 && turned.pan === 0, 'a left drag turns the figure and nothing else');
  const slid = dragView({ zoom: 1, pan: 0, spin: 0 }, 0, 100, true);
  ok(slid.pan > 0 && slid.spin === 0, 'a right drag slides the view and nothing else');
  ok(dragView(restView(), 0, 100, true).pan === 0, 'and a right drag at the far limit does nothing, since there is nowhere to slide to');
  const spun = dragView({ zoom: 0, pan: 0, spin: 6.2 }, -100, 0, false);
  ok(spun.spin >= 0 && spun.spin < Math.PI * 2, `a figure spun past a full turn keeps a sane number (${spun.spin.toFixed(3)})`);
  let v = restView();
  for (let i = 0; i < 200; i++) v = dragView(v, 37, 0, false);
  ok(v.spin >= 0 && v.spin < Math.PI * 2, 'however many turns it is given');
}

{
  // The wheel.
  let v = restView();
  for (let i = 0; i < 100; i++) v = zoomBy(v, 1);
  ok(v.zoom === 1, 'winding all the way in stops at the closest the creator goes');
  for (let i = 0; i < 100; i++) v = zoomBy(v, -1);
  ok(v.zoom === 0 && v.pan === 0, 'and all the way back out returns the captured shot, pan and all');
  ok(zoomBy(restView(), 1).zoom > 0, 'one notch moves it');
}

{
  // Nothing here may answer with a number that is not one.
  const bad = clampView({ zoom: Number.NaN, pan: Number.POSITIVE_INFINITY, spin: Number.NaN });
  ok(Number.isFinite(bad.zoom) && Number.isFinite(bad.pan) && Number.isFinite(bad.spin), 'a view made of nonsense is answered with real numbers rather than passed on');
  const pose = viewPose({ yaw: 0, pitch: 0, distance: 0 }, restView(), ORBIT_EYE_HEIGHT);
  ok(Number.isFinite(pose.camera.x) && Number.isFinite(pose.distance), 'and a shot with no distance at all does not divide by nought');
}

console.log(`\n${passed} checks passed`);
