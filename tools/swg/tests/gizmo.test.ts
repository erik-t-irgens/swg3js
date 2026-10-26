// The world editor's gizmo (DESIGN.md §2.6): which handles show for each held key (none: the three arrows and the ground
// square; R the yaw ring; Shift+R the pitch and roll rings; F the vertical arrow; C the scale boxes, one an axis on a prop);
// a handle is picked within `pick.hitPx` and not past it; a drag along a handle keeps the grabbed point under the cursor
// at three distances (an arrow by the nearest point of its line to the cursor's ray, the ground square by the level
// plane, a ring by the angle round the pivot -- face on from either side, and the pitch ring the right way on either
// side of the screen -- a scale box by the distance from it); and a frame of it (laid out, picked, dragged and drawn)
// makes nothing, measured in twelve processes of its own at once (`editorAllocOwn.ts gizmo`), whose windows drag every
// handle.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { H, HANDLES, beginDrag, dragTo, gizmoDrag, gizmoLayout, handlesFor, layoutGizmo, pickHandle, projectInto, ray3, rayThrough, screenView, worldAxes, type ScreenView } from '../../../src/editor/gizmo.ts';
import { drawGizmo } from '../../../src/ui/editorMarks.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** A view of a camera at `eye` looking at `at`, 1600 by 900 CSS pixels. */
function viewOf(eye: THREE.Vector3, at: THREE.Vector3): ScreenView {
  const cam = new THREE.PerspectiveCamera(60, 1600 / 900, 0.1, 5000);
  cam.position.copy(eye);
  cam.lookAt(at);
  cam.updateMatrixWorld();
  const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  const v = screenView();
  v.vp.set(vp.elements);
  v.inv.set(vp.clone().invert().elements);
  v.w = 1600;
  v.h = 900;
  v.ex = eye.x;
  v.ey = eye.y;
  v.ez = eye.z;
  const f = new THREE.Vector3();
  cam.getWorldDirection(f);
  v.fx = f.x;
  v.fy = f.y;
  v.fz = f.z;
  v.focal = 900 / (2 * Math.tan((60 * Math.PI) / 360));
  return v;
}

{
  const s = new Array(HANDLES.length).fill(false);
  const on = (list: boolean[]) => HANDLES.filter((_, i) => list[i]).join();
  ok(on(handlesFor('none', true, s)) === 'x,y,z,ground', 'no key held: the three move arrows and the ground square');
  ok(on(handlesFor('turn', true, s)) === 'yaw', 'R held: the yaw ring');
  ok(on(handlesFor('tumble', true, s)) === 'pitch,roll', 'Shift+R held: the pitch and roll rings');
  ok(on(handlesFor('lift', true, s)) === 'up', 'F held: the vertical arrow');
  ok(on(handlesFor('scale', true, s)) === 'scale,sx,sy,sz', 'C held on a prop: the scale box in the middle and a box an axis');
  ok(on(handlesFor('scale', false, s)) === 'scale', 'C held on anything else: the middle box alone');
}

{
  // Picking: within `hitPx` of an arrow, and not past it.
  const v = viewOf(new THREE.Vector3(10, 8, 20), new THREE.Vector3(0, 0, 0));
  const L = gizmoLayout();
  handlesFor('none', false, L.shown);
  layoutGizmo(v, { x: 0, y: 0, z: 0 }, worldAxes(), 90, L);
  const ax = L.ends[H.x * 2];
  const ay = L.ends[H.x * 2 + 1];
  const mx = (L.px + ax) / 2;
  const my = (L.py + ay) / 2;
  const dx = ax - L.px;
  const dy = ay - L.py;
  const len = Math.hypot(dx, dy);
  ok(len > 30 && len <= 91, `the X arrow is laid out at most the gizmo's size on the screen (${len.toFixed(1)} px)`);
  // A point off the arrow's middle at right angles, `d` pixels.
  const off = (d: number) => [mx - (dy / len) * d, my + (dx / len) * d];
  const [n1x, n1y] = off(9);
  const [f1x, f1y] = off(13);
  ok(pickHandle(L, n1x, n1y, 10) === H.x, 'a point 9 px off the X arrow picks it with a reach of 10');
  ok(pickHandle(L, f1x, f1y, 10) !== H.x, 'and 13 px off does not');
  ok(pickHandle(L, 5, 5, 10) === -1 && L.hot === -1, 'far from every handle, nothing');
  // The ground square: inside its four corners.
  const sq = L.square;
  const cx = (sq[0] + sq[2] + sq[4] + sq[6]) / 4;
  const cy = (sq[1] + sq[3] + sq[5] + sq[7]) / 4;
  ok(pickHandle(L, cx, cy, 10) === H.ground, 'inside the ground square picks it');
}

{
  // A drag along an arrow keeps the grabbed point under the cursor, at three distances from the eye.
  for (const dist of [5, 25, 120]) {
    const at = new THREE.Vector3(0, 0, 0);
    const eye = new THREE.Vector3(dist * 0.6, dist * 0.5, dist * 0.8);
    const v = viewOf(eye, at);
    const L = gizmoLayout();
    handlesFor('none', false, L.shown);
    layoutGizmo(v, at, worldAxes(), 90, L);
    for (const h of [H.x, H.z, H.y]) {
      // Grabbed at the middle of the arrow, dragged 40 px further along its own screen direction.
      const gx = (L.px + L.ends[h * 2]) / 2;
      const gy = (L.py + L.ends[h * 2 + 1]) / 2;
      const sx = L.ends[h * 2] - L.px;
      const sy = L.ends[h * 2 + 1] - L.py;
      const sl = Math.hypot(sx, sy);
      const r = ray3();
      rayThrough(v, gx, gy, r);
      const d = gizmoDrag();
      ok(beginDrag(d, L, h, v, at, gx, gy, r), `at ${dist} m the ${HANDLES[h]} arrow is grabbed`);
      const cx = gx + (sx / sl) * 40;
      const cy = gy + (sy / sl) * 40;
      rayThrough(v, cx, cy, r);
      dragTo(d, L, cx, cy, r);
      // The grabbed point, moved, projected: under the cursor.
      const grab = new THREE.Vector3(L.dirs[h * 3], L.dirs[h * 3 + 1], L.dirs[h * 3 + 2]).multiplyScalar(d.t0);
      const moved = grab.add(new THREE.Vector3(d.mx, d.my, d.mz));
      const out = new Float64Array(2);
      projectInto(v, moved.x, moved.y, moved.z, out, 0);
      const miss = Math.hypot(out[0] - cx, out[1] - cy);
      ok(miss < 0.5, `at ${dist} m a 40 px drag along the ${HANDLES[h]} arrow moves the selection ${Math.hypot(d.mx, d.my, d.mz).toFixed(3)} m, the grabbed point ${miss.toFixed(3)} px from the cursor`);
    }
    // The ground square: the level plane through the pivot under the cursor (grabbed inside its own corners, asserted).
    const r = ray3();
    const sq = L.square;
    const gx = (sq[0] + sq[2] + sq[4] + sq[6]) / 4;
    const gy = (sq[1] + sq[3] + sq[5] + sq[7]) / 4;
    ok(pickHandle(L, gx, gy, 10) === H.ground, `at ${dist} m the ground square's middle picks it`);
    rayThrough(v, gx, gy, r);
    const d = gizmoDrag();
    ok(beginDrag(d, L, H.ground, v, at, gx, gy, r), `at ${dist} m the ground square is grabbed`);
    const s0 = (at.y - r.oy) / r.dy;
    const g0 = new THREE.Vector3(r.ox + r.dx * s0, at.y, r.oz + r.dz * s0);
    rayThrough(v, gx + 50, gy + 30, r);
    dragTo(d, L, gx + 50, gy + 30, r);
    const out = new Float64Array(2);
    projectInto(v, g0.x + d.mx, g0.y + d.my, g0.z + d.mz, out, 0);
    ok(Math.hypot(out[0] - gx - 50, out[1] - gy - 30) < 0.5 && Math.abs(d.my) < 1e-9, `at ${dist} m the ground square moves along the level, the grabbed point under the cursor`);
  }
}

/**
 * A ring grabbed at a screen point and dragged to another: the grabbed point of the world (the cursor's ray met with the
 * ring's own plane) turned about the ring's axis by the drag's angle, projected. Answers where it lands and where it began.
 */
function ringDrag(v: ScreenView, L: ReturnType<typeof gizmoLayout>, h: number, pivot: THREE.Vector3, from: [number, number], to: [number, number]): { start: THREE.Vector2; landed: THREE.Vector2; d: ReturnType<typeof gizmoDrag> } {
  const axis = new THREE.Vector3(L.dirs[h * 3], L.dirs[h * 3 + 1], L.dirs[h * 3 + 2]);
  const r = ray3();
  rayThrough(v, from[0], from[1], r);
  const d = gizmoDrag();
  ok(beginDrag(d, L, h, v, pivot, from[0], from[1], r), `the ${HANDLES[h]} ring is grabbed`);
  const o = new THREE.Vector3(r.ox, r.oy, r.oz);
  const dir = new THREE.Vector3(r.dx, r.dy, r.dz);
  const t = pivot.clone().sub(o).dot(axis) / dir.dot(axis);
  const grabbed = o.add(dir.multiplyScalar(t));
  // Round the ring a few pixels at a time, as a hand drags it.
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const cx = from[0] + ((to[0] - from[0]) * i) / steps;
    const cy = from[1] + ((to[1] - from[1]) * i) / steps;
    rayThrough(v, cx, cy, r);
    dragTo(d, L, cx, cy, r);
  }
  const turned = grabbed.clone().sub(pivot).applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, d.angle)).add(pivot);
  const out = new Float64Array(2);
  projectInto(v, turned.x, turned.y, turned.z, out, 0);
  return { start: new THREE.Vector2(from[0], from[1]), landed: new THREE.Vector2(out[0], out[1]), d };
}

{
  // A yaw ring seen face on from above (its axis toward the eye) and from below (away): either way the grabbed point is
  // carried round under the cursor -- a ring whose facing were taken as toward the eye always would turn it the wrong
  // way from below.
  for (const [name, eyeY] of [['above', 30], ['below', -30]] as const) {
    const pivot = new THREE.Vector3(0, 0, 0);
    const v = viewOf(new THREE.Vector3(0, eyeY, 0.001), pivot);
    const L = gizmoLayout();
    handlesFor('turn', false, L.shown);
    layoutGizmo(v, pivot, worldAxes(), 90, L);
    const at = (deg: number): [number, number] => [L.px + Math.cos((deg * Math.PI) / 180) * 90, L.py - Math.sin((deg * Math.PI) / 180) * 90];
    const to = at(60);
    const { landed, d } = ringDrag(v, L, H.yaw, pivot, at(0), to);
    ok(landed.distanceTo(new THREE.Vector2(to[0], to[1])) < 1, `the yaw ring seen from ${name}, dragged 60° round on the screen: the grabbed point lands under the cursor (${landed.distanceTo(new THREE.Vector2(to[0], to[1])).toFixed(3)} px off; it turned ${((d.angle * 180) / Math.PI).toFixed(1)}° about up)`);
  }
  // The pitch ring (about the view's level right), on either side of the screen's middle: one faces the eye, the other
  // away; on both the grabbed point moves the way the cursor does along the ring.
  for (const [side, px] of [['left', -4], ['right', 4]] as const) {
    const pivot = new THREE.Vector3(px, 0, 0);
    const v = viewOf(new THREE.Vector3(0, 2, 10), new THREE.Vector3(0, 0, 0));
    const L = gizmoLayout();
    handlesFor('tumble', false, L.shown);
    layoutGizmo(v, pivot, worldAxes(), 90, L);
    const ring = L.rings[1];
    const i = 8;
    const from: [number, number] = [ring[i * 2], ring[i * 2 + 1]];
    const tx = ring[(i + 1) * 2] - ring[(i - 1) * 2];
    const ty = ring[(i + 1) * 2 + 1] - ring[(i - 1) * 2 + 1];
    const tl = Math.hypot(tx, ty);
    const to: [number, number] = [from[0] + (tx / tl) * 6, from[1] + (ty / tl) * 6];
    const { start, landed, d } = ringDrag(v, L, H.pitch, pivot, from, to);
    const moved = landed.clone().sub(start);
    const asked = new THREE.Vector2(to[0] - from[0], to[1] - from[1]);
    // A ring seen aslant turns by the angle round the pivot on the screen, so its point keeps the cursor's way and not its
    // length: the way is the check (a facing taken wrongly sends it back against the cursor, cosine near -1).
    const cos = moved.dot(asked) / (moved.length() * asked.length() || 1);
    ok(cos > 0.8 && d.facing === (side === 'left' ? 1 : -1), `the pitch ring on the ${side} of the screen (facing ${d.facing > 0 ? 'the eye' : 'away'}): dragged 6 px along it, the grabbed point moves ${moved.length().toFixed(2)} px the cursor's way (cosine ${cos.toFixed(3)})`);
  }
}

{
  // A ring: the angle round the pivot on the screen, the way the cursor goes, facing the eye or not.
  const v = viewOf(new THREE.Vector3(0, 30, 0.001), new THREE.Vector3(0, 0, 0));
  const L = gizmoLayout();
  handlesFor('turn', false, L.shown);
  layoutGizmo(v, { x: 0, y: 0, z: 0 }, worldAxes(), 90, L);
  const r = ray3();
  const d = gizmoDrag();
  const a = (deg: number) => [L.px + Math.cos((deg * Math.PI) / 180) * 90, L.py - Math.sin((deg * Math.PI) / 180) * 90];
  const [x0, y0] = a(0);
  rayThrough(v, x0, y0, r);
  ok(beginDrag(d, L, H.yaw, v, { x: 0, y: 0, z: 0 }, x0, y0, r), 'the yaw ring is grabbed from above');
  for (const deg of [30, 60, 90, 120, 150, 180, 210]) {
    const [x, y] = a(deg);
    dragTo(d, L, x, y, r);
  }
  ok(Math.abs(d.angle - (210 * Math.PI) / 180) < 1e-6, `dragged round the ring, seen from above, by 210° counter-clockwise it turns 210° counter-clockwise, past half a turn (${((d.angle * 180) / Math.PI).toFixed(2)}°)`);
}

{
  // A scale box: twice as far from the pivot on the screen, twice the size.
  const v = viewOf(new THREE.Vector3(10, 8, 20), new THREE.Vector3(0, 0, 0));
  const L = gizmoLayout();
  handlesFor('scale', true, L.shown);
  layoutGizmo(v, { x: 0, y: 0, z: 0 }, worldAxes(), 90, L);
  const r = ray3();
  const d = gizmoDrag();
  ok(beginDrag(d, L, H.scale, v, { x: 0, y: 0, z: 0 }, L.px + 30, L.py, r), 'the middle scale box is grabbed 30 px out');
  dragTo(d, L, L.px + 60, L.py, r);
  ok(Math.abs(d.scale - 2) < 1e-9, `twice as far out scales it twice (${d.scale})`);
  const ex = L.ends[H.sx * 2] - L.px;
  const ey = L.ends[H.sx * 2 + 1] - L.py;
  ok(beginDrag(d, L, H.sx, v, { x: 0, y: 0, z: 0 }, L.px + ex, L.py + ey, r), "the X axis's box is grabbed at its end");
  dragTo(d, L, L.px + ex * 1.5, L.py + ey * 1.5, r);
  ok(Math.abs(d.scale - 1.5) < 1e-9, `half as far again along its own screen direction scales its axis by 1.5 (${d.scale.toFixed(4)})`);
}

{
  // Drawn: every shown handle makes strokes on the overlay, a ring a polygon of its own kept points.
  const v = viewOf(new THREE.Vector3(10, 8, 20), new THREE.Vector3(0, 0, 0));
  const L = gizmoLayout();
  handlesFor('tumble', false, L.shown);
  layoutGizmo(v, { x: 0, y: 0, z: 0 }, worldAxes(), 90, L);
  const polys: number[] = [];
  drawGizmo({ line() {}, ring() {}, poly: (_pts, n) => polys.push(n) }, L, 2);
  ok(polys.length === 2 && polys.every((n) => n === 32), 'Shift+R draws its two rings, each a polygon of 32 points');
}

{
  // A frame of it makes nothing, twelve processes at once, every one asserted (the aim's own measure, with the gizmo in it).
  const file = fileURLToPath(new URL('./editorAllocOwn.ts', import.meta.url));
  const run = () =>
    new Promise<{ frames: number; made: number; scavenges: number; gizmo: number; grabBytes: number; branches?: Record<string, number>; skipped?: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', file, 'gizmo'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (code) => {
        const line = out.trim().split('\n').pop() ?? '';
        if (code !== 0) {
          const lines = err.trim().split('\n');
          reject(new Error(`the allocation child exited ${code}: ${lines.find((l) => /Error/.test(l))?.trim() ?? lines.pop() ?? line}`));
          return;
        }
        try {
          resolve(JSON.parse(line));
        } catch {
          reject(new Error(`the allocation child printed nothing that reads: ${line || '(nothing)'}`));
        }
      });
    });
  const all = await Promise.all(Array.from({ length: 12 }, run));
  const skipped = all.find((a) => a.skipped);
  if (skipped) console.log(`note the allocation measure was skipped: ${skipped.skipped}`);
  else {
    for (let i = 0; i < all.length; i++) {
      const a = all[i];
      ok(a.scavenges === 0 && a.made < 0.1 * a.frames && a.gizmo > 0, `process ${i + 1} of 12: a frame of the gizmo (laid out, picked, dragged, a selection's boxes and the gizmo drawn, ${a.gizmo} frames with it shown) makes ${Math.max(0, a.made)} bytes over ${a.frames} frames (${(Math.max(0, a.made) / a.frames).toFixed(3)} a frame, ${a.scavenges} collections)`);
    }
    // Every handle the game can drag was dragged in the measured windows (the spiral the cursor takes crosses each), or the
    // measure says "every branch" of a drag it never ran.
    const b = all[0].branches ?? {};
    const missed = HANDLES.filter((name) => !(b[name] > 0));
    ok(missed.length === 0, `the measured windows drag every handle: ${HANDLES.map((name) => `${name} ${b[name] ?? 0}`).join(', ')}`);
    // A grab is a press, never a frame: code run that seldom stays unoptimised and makes its numbers, which is said, and
    // held to a few hundred bytes a press so a grab that began making a list would show.
    const g = Math.max(...all.map((a) => a.grabBytes));
    ok(g >= 0 && g < 400, `a grab (once a press, run unoptimised) makes at most ${g} bytes`);
  }
}

console.log(`\n${checks} checks passed`);
