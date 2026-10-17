// The race view (src/vehicles/raceView.ts): the mouse moving a heading target held within a lead of the nose, the
// camera trailing the hull and pulled out and widened with the speed, first person at the pilot's own eyes, and what
// blocks the view. The arithmetic is the module's; the hull that turns toward the target is the race drive's own
// (`RaceDrive`, stepped over stand-ins for the body and the physics, `raceStandIn.ts`); the camera is the game's own
// `ThirdPersonCamera`; what blocks the view is the game's own physics. The seated eye, the first person's turn and the
// blocker are the module's functions the game calls (`raceEyeOf`, `raceTurnOf`, `raceBlocked`), and `main.ts` is read
// for the lines that call them and that hand the view its frame's step.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { ThirdPersonCamera } from '../../../src/core/camera.ts';
import { Group, Physics, RAPIER, groups } from '../../../src/core/physics.ts';
import { RACE_BASE, RACE_TUNE, RACE_UPGRADES } from '../../../src/vehicles/raceTune.ts';
import { levelsAt, newBase, resolveRace, wrap } from '../../../src/vehicles/raceMath.ts';
import { RACE_BLOCK_MARGIN, easeFovOut, fovAt, frameRaceView, newRaceView, newRaceViewOut, pullAt, raceBlocked, raceEyeOf, raceTurnOf, releaseRaceView, steerRaceView, type RaceViewInput } from '../../../src/vehicles/raceView.ts';
import { SEATED_EYE_FALLBACK } from '../../../src/vehicles/cockpitSeat.ts';
import { standInRun } from './raceStandIn.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const r2 = (n: number) => Number(n.toFixed(2));
const D2R = Math.PI / 180;
const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = resolve(HERE, '../../..');
const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const RATES = [144, 60, 20] as const;
/** The commit the race drive's first wave started from: the camera as it stood before it. */
const PRE_WAVE = '4e1d42252cb054100b810ec258ddfe8676054020';
const T = RACE_TUNE;
const stock = resolveRace(RACE_BASE.podracer, levelsAt(0), 1, RACE_UPGRADES, newBase());

const input = (): RaceViewInput => ({ heading: 0, mouseDX: 0, k: 0.0025, keys: false, alt: false, orbitYaw: Math.PI, speed: 200, ceiling: stock.cap, seatY: 1, dt: 1 / 60 });

/**
 * A frame of play as the game runs it: the view's steering half, the drive handed its target (`drive.heading`) and
 * stepped (the race drive itself, its turn and all), then the view's camera half from the heading the drive left.
 */
function playFrame(run: ReturnType<typeof standInRun>, st: ReturnType<typeof newRaceView>, vin: RaceViewInput, out: ReturnType<typeof newRaceViewOut>, dt: number): void {
  vin.heading = run.race.heading;
  vin.dt = dt;
  steerRaceView(st, vin, T, out);
  run.drive.heading = Number.isNaN(out.target) ? null : out.target;
  run.frame(dt);
  vin.heading = run.race.heading;
  frameRaceView(st, vin, T, out);
}

// --- 1: a flick and a sweep --------------------------------------------------------------------------------------
for (const fps of RATES) {
  const dt = 1 / fps;
  // A stock pod at its plain top, the throttle held, so its steering has its whole authority.
  const run = standInRun('pod', 'stock', 198);
  const st = newRaceView();
  const out = newRaceViewOut();
  const vin = input();
  let worstHull = 0;
  let worstCam = 0;
  let lastYaw = NaN;
  for (let i = 0; i < 4 * fps; i++) {
    vin.orbitYaw = i === 0 ? run.race.heading + Math.PI : st.yaw;
    // A flick of 175 degrees of mouse in one frame, then nothing.
    vin.mouseDX = i === 1 ? -(175 * D2R) / vin.k : 0;
    const before = run.race.heading;
    playFrame(run, st, vin, out, dt);
    worstHull = Math.max(worstHull, Math.abs(wrap(run.race.heading - before)));
    if (!Number.isNaN(lastYaw)) worstCam = Math.max(worstCam, Math.abs(wrap(st.yaw - lastYaw)));
    lastYaw = st.yaw;
  }
  const turned = run.race.heading / D2R;
  const capFrame = stock.maxTurn * D2R * dt;
  const camAllow = capFrame + T.camLook * T.steerLead * (1 - Math.exp(-dt / T.camLag)) + 1e-9;
  ok(Math.abs(turned - 33) <= 1.5, `1: a flick of 175 degrees of mouse turns a stock pod's own drive ${r2(turned)} degrees at ${fps} fps (33 +- 1.5)`);
  ok(worstHull <= capFrame + 1e-12 && worstCam <= camAllow, `1: the drive's hull never more than maxTurn a frame (${r2(worstHull / D2R)} of ${r2(capFrame / D2R)} degrees), the camera never more than that and its ease (${r2(worstCam / D2R)})`);
}
for (const fps of RATES) {
  const dt = 1 / fps;
  const run = standInRun('pod', 'stock', 198);
  const st = newRaceView();
  const out = newRaceViewOut();
  const vin = input();
  let total = 0;
  let at = Infinity;
  let worstTrail = 0;
  let t = 0;
  for (let i = 0; i < 4 * fps; i++) {
    vin.orbitYaw = i === 0 ? Math.PI : st.yaw;
    // Swept at 172 degrees a second (positive mouse turns the view's yaw down, the heading with it).
    vin.mouseDX = (172 * D2R * dt) / vin.k;
    const before = run.race.heading;
    playFrame(run, st, vin, out, dt);
    total += wrap(run.race.heading - before);
    t += dt;
    if (at === Infinity && Math.abs(total) >= Math.PI) at = t;
    // Once the turn is at the cap, how far the view trails the hull's own back.
    if (t > 1 && Math.abs(run.race.w) >= stock.maxTurn - 1e-9) worstTrail = Math.max(worstTrail, Math.abs(out.trail));
  }
  ok(at >= 2.0 && at <= 2.1, `1: a sweep at 172 degrees a second turns the pod's own drive 180 degrees in ${r2(at)} s at ${fps} fps (2.0 to 2.1)`);
  // --- 2: the trail ---
  ok(worstTrail < 5, `2: in a turn at the cap the camera trails the drive's hull by ${r2(worstTrail)} degrees at ${fps} fps (under 5)`);
}

// --- 3: the pull and the widening --------------------------------------------------------------------------------
{
  ok(pullAt(0.29, T) === 1 && pullAt(0, T) === 1 && Math.abs(pullAt(1, T) - 1.3) < 1e-12, '3: the pull is 1 under three-tenths of the ceiling and 1.3 at it');
  const width = (pull: number, fov: number) => 1 / (pull * Math.tan((fov / 2) * D2R));
  const share = width(pullAt(1, T), 60 + fovAt(1, T)) / width(1, 60);
  ok(Math.abs(share * 100 - 57) <= 2, `3: at the ceiling, widened by ${fovAt(1, T)} degrees, the pod shows at ${r2(share * 100)}% of its resting width on screen (57 +- 2)`);
  for (const fps of RATES) {
    const st = newRaceView();
    const out = newRaceViewOut();
    const vin = input();
    vin.dt = 1 / fps;
    vin.speed = vin.ceiling;
    let t = 0;
    frameRaceView(st, vin, T, out);
    const start = st.pull;
    // The first frame is the hand-over: count from it.
    while (t < 0.5 - 1e-9) {
      frameRaceView(st, vin, T, out);
      t += vin.dt;
    }
    const done = (st.pull - start) / (1.3 - start);
    ok(Math.abs(done - (1 - Math.exp(-0.5 / T.camPullEase))) < 0.01 && Math.abs(done - 0.57) < 0.02, `3: the pull's ease is ${r2(done * 100)}% done in half a second at ${fps} fps (57)`);
  }
}

// --- 4: the hand-overs -------------------------------------------------------------------------------------------
{
  const st = newRaceView();
  const out = newRaceViewOut();
  const vin = input();
  vin.heading = 0.4;
  vin.orbitYaw = 0.4 + Math.PI + 0.25;
  steerRaceView(st, vin, T, out);
  ok(Math.abs(wrap(out.target - (vin.orbitYaw - Math.PI))) < 1e-12, "4: into the race view, the target is the orbit's own aim (the pod is not turned)");
  const fromYaw = st.yaw;
  frameRaceView(st, vin, T, out);
  const want = vin.heading + Math.PI + T.camLook * 0.25;
  const eased = fromYaw + wrap(want - fromYaw) * (1 - Math.exp(-vin.dt / T.camLag));
  ok(fromYaw === vin.orbitYaw && Math.abs(st.yaw - eased) < 1e-12, "4: and its first frame's yaw is the orbit's, eased from there");
  vin.orbitYaw = 0.4 + Math.PI + 1.2;
  const st2 = newRaceView();
  steerRaceView(st2, vin, T, out);
  ok(Math.abs(wrap(out.target - (vin.heading + T.steerLead))) < 1e-12, '4: an orbit aimed past the lead hands over held within it');
  // Out of it: the orbit carries on from the race view's yaw, as the real camera keeps it.
  const cam = new ThirdPersonCamera(16 / 9);
  const stub = { locked: false, mouseDX: 0, mouseDY: 0, wheel: 0 } as never;
  const focus = new THREE.Vector3(0, 0, 0);
  cam.yaw = out.yaw;
  cam.update(stub, focus, null, 1 / 60, null, 1, 1.5);
  releaseRaceView(st);
  const kept = cam.yaw;
  cam.update(stub, focus, null, 1 / 60, null, 1, 1.5);
  ok(cam.yaw === kept && kept === out.yaw, "4: out of it, the orbit's yaw is the race view's");
}

// --- 5: first person ---------------------------------------------------------------------------------------------
{
  const main = src('../../../src/main.ts');
  // What the game calls (text pins: the camera half is the game's and runs in no node test): its first person is the
  // cockpit placed at the eye `raceEyeOf` gives, through the figure as `syncMount` hung it this frame.
  ok(/const eye = this\.raceEye\(this\.raceEyeW\);/.test(main) && /this\.cam\.cockpit\(this\.input, dt, eye, turn, v\.heading, zoom\);/.test(main), "5: (main.ts: the game's first person is the cockpit placed at the seated eye)");
  ok(/rig\?\.seatedPoints\(clip, out, this\.racePelvis\)/.test(main) && /return raceEyeOf\(found \? out : null, SEATED_EYE_FALLBACK, rig \? rig\.root\.scale\.y : 1, p\.group\.matrixWorld, out\);/.test(main), "5: (main.ts: the seated eye is raceEyeOf over the playing clip's first frame and the figure's own matrix)");
  // A pod whose cockpit joint rises 3.97 m in the 0.2 s fade between the idle and the run, at every start (and back at
  // every stop): the figure hangs on it, its matrix written each frame as the mount writes it, and `raceEyeOf` (the
  // module's own, which the game calls) carries the clip's eye through it; the cockpit is placed there with no ease.
  // What is measured: the camera against the eye worked out by hand from where the joint stands that frame, so an eye
  // read through last frame's matrix, or a cockpit that eased, is off by up to the joint's 0.33 m a frame.
  const clipEye = new THREE.Vector3(0, 0.708 + 0.95, 0.109);
  const jointY = (t: number) => (t < 0.5 ? 0 : t < 0.7 ? (3.97 * (t - 0.5)) / 0.2 : t < 1.5 ? 3.97 : t < 1.7 ? 3.97 - (3.97 * (t - 1.5)) / 0.2 : 0);
  for (const fps of RATES) {
    const dt = 1 / fps;
    const cam = new ThirdPersonCamera(16 / 9);
    cam.zoomTarget = 0;
    cam.distance = 0;
    const figure = new THREE.Group();
    const stub = { locked: false, mouseDX: 0, mouseDY: 0, wheel: 0 } as never;
    const turn = new THREE.Quaternion();
    const eye = new THREE.Vector3();
    const truth = new THREE.Vector3();
    let worst = 0;
    const st = newRaceView();
    const out = newRaceViewOut();
    const vin = input();
    vin.dt = dt;
    let focusLag = 0;
    for (let t = 0; t < 2; t += dt) {
      figure.position.set(0, 2 + jointY(t), 100 * t);
      figure.updateMatrixWorld(true);
      raceEyeOf(eye.copy(clipEye), SEATED_EYE_FALLBACK, 1, figure.matrixWorld, eye);
      cam.cockpit(stub, dt, eye, turn, 0, true);
      truth.set(clipEye.x, 2 + jointY(t) + clipEye.y, 100 * t + clipEye.z);
      worst = Math.max(worst, cam.camera.position.distanceTo(truth));
      vin.seatY = 1 + jointY(t);
      frameRaceView(st, vin, T, out);
      focusLag = Math.max(focusLag, Math.abs(out.focusY - vin.seatY));
    }
    ok(worst < 0.02, `5: at ${fps} fps the camera stands at the seated eye where the joint stands that frame, within 2 cm on every frame of a start and a stop (worst ${(worst * 100).toFixed(3)} cm)`);
    ok(focusLag > 1, `5: and the third person's focus over the same start eases with eyeEase (up to ${r2(focusLag)} m behind the joint)`);
  }
  {
    // With no clip eye, the stock seated eye scaled by the figure's height, through the same matrix.
    const m = new THREE.Matrix4().makeTranslation(1, 2, 3);
    const got = raceEyeOf(null, SEATED_EYE_FALLBACK, 1.1, m, new THREE.Vector3());
    const want = new THREE.Vector3().fromArray(SEATED_EYE_FALLBACK).multiplyScalar(1.1).add(new THREE.Vector3(1, 2, 3));
    ok(got.distanceTo(want) < 1e-12, '5: with no clip eye it is the stock seated eye scaled by the figure, through the same matrix');
  }
  // The first person's turn (`raceTurnOf`, which main.ts' raceTurn calls with fpRoll).
  ok(/return raceTurnOf\(v\.group\.quaternion, RACE_TUNE\.fpRoll, this\.raceEuler, out\);/.test(main), "5: (main.ts: the first person's turn is raceTurnOf of the hull's with fpRoll)");
  const hullQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.1, 0.7, 0.4, 'YXZ'));
  const scratchE = new THREE.Euler();
  const half = raceTurnOf(hullQ, 0.5, scratchE, new THREE.Quaternion());
  const back = new THREE.Euler().setFromQuaternion(half, 'YXZ');
  ok(Math.abs(back.z - 0.2) < 1e-9 && Math.abs(back.x + 0.1) < 1e-9 && Math.abs(back.y - 0.7) < 1e-9, '5: at fpRoll 0.5 the view keeps the heading and the pitch and half the roll');
  const whole = raceTurnOf(hullQ, 1, scratchE, new THREE.Quaternion());
  ok(Object.is(whole.x, hullQ.x) && Object.is(whole.y, hullQ.y) && Object.is(whole.z, hullQ.z) && Object.is(whole.w, hullQ.w), "5: and at fpRoll 1 it is the hull's own turn to the bit");
  // The field of view, widened in first person and back to the base when the speed is gone.
  const cam = new ThirdPersonCamera(16 / 9);
  cam.zoomTarget = 0;
  cam.distance = 0;
  const stub = { locked: false, mouseDX: 0, mouseDY: 0, wheel: 0 } as never;
  cam.speedFov = 10;
  cam.update(stub, new THREE.Vector3(), null, 1 / 60, new THREE.Vector3(0, 1.5, 0), 1, 1.5);
  const wide = cam.camera.fov;
  cam.speedFov = 0;
  cam.update(stub, new THREE.Vector3(), null, 1 / 60, new THREE.Vector3(0, 1.5, 0), 1, 1.5);
  ok(cam.firstPerson && wide === 70 && cam.camera.fov === 60, `5: first person widened to ${wide} degrees and back to ${cam.camera.fov} when the speed is gone`);
}

// --- 6: day one --------------------------------------------------------------------------------------------------
{
  // The camera as it stood before the pass: out of git at the commit the pass started from (`PRE_WAVE`, fixed, so the
  // check stays one once the wave is committed), loaded beside today's. Where git cannot answer (a copy of the tree
  // with no history), today's is held to a hash of that camera's own 600-frame trace, measured from it and written here:
  // never to a copy of itself.
  let Old: typeof ThirdPersonCamera | null = null;
  try {
    let text = execFileSync('git', ['show', `${PRE_WAVE}:src/core/camera.ts`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n');
    text = text.replace(/from '(\.\.?\/[^']+)'/g, (_m, p: string) => `from '${pathToFileURL(resolve(REPO, 'src/core', p)).href}'`);
    text = text.replace(/from 'three'/g, `from '${import.meta.resolve('three')}'`);
    const dir = mkdtempSync(join(tmpdir(), 'raceview-'));
    const file = join(dir, 'camera.old.ts');
    writeFileSync(file, text);
    try {
      Old = ((await import(pathToFileURL(file).href)) as { ThirdPersonCamera: typeof ThirdPersonCamera }).ThirdPersonCamera;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch (err) {
    note(`6: the camera as it stood before the pass could not be read out of git (${(err as Error).message}): today's is held to the hash of that camera's own trace`);
  }
  /** FNV-1a over the bytes of each number, in order. */
  const hasher = () => {
    const buf = new Float64Array(1);
    const bytes = new Uint8Array(buf.buffer);
    let h = 0x811c9dc5;
    return {
      mix(n: number) {
        buf[0] = n;
        for (let k = 0; k < 8; k++) h = Math.imul(h ^ bytes[k], 0x01000193) >>> 0;
      },
      get value() {
        return h;
      },
    };
  };
  // The camera at PRE_WAVE, driven as below: its trace's hash with no blocker and with one (measured from it, once).
  const TRACE_HASH = { plain: 0x7e85feba, blocked: 0xd28ebd6a };
  for (const blocked of [false, true]) {
    const a = Old ? new Old(16 / 9) : null;
    const b = new ThirdPersonCamera(16 / 9);
    // A blocker that cuts the line on some frames and not others (the trace's own place decides), so its path is run.
    let cuts = 0;
    const blocker = blocked
      ? (from: THREE.Vector3, to: THREE.Vector3) => {
          if (Math.sin(to.z / 7) <= 0.3) return null;
          cuts++;
          return from.distanceTo(to) * 0.6;
        }
      : null;
    let same = true;
    let where = '';
    const ha = hasher();
    const hb = hasher();
    for (let i = 0; i < 600; i++) {
      const wheel = i === 100 ? -40 : i === 300 ? 40 : 0;
      const ia = { locked: true, mouseDX: Math.sin(i / 17) * 6, mouseDY: Math.cos(i / 23) * 4, wheel } as never;
      const ib = { locked: true, mouseDX: Math.sin(i / 17) * 6, mouseDY: Math.cos(i / 23) * 4, wheel } as never;
      const focus = new THREE.Vector3(Math.sin(i / 50) * 10, 0, i * 0.3);
      const eyes = new THREE.Vector3(focus.x, 1.6, focus.z);
      a?.update(ia, focus, blocker, 1 / 60, eyes, 1, 1.5);
      // The race build with the pass off: the widening is nought for good, written every frame as the game writes it.
      b.speedFov = 0;
      b.update(ib, focus, blocker, 1 / 60, eyes, 1, 1.5);
      const pb = b.camera.position;
      const qb = b.camera.quaternion;
      const nb = [pb.x, pb.y, pb.z, qb.x, qb.y, qb.z, qb.w, b.camera.fov];
      for (const n of nb) hb.mix(n);
      if (a) {
        const pa = a.camera.position;
        const qa = a.camera.quaternion;
        const na = [pa.x, pa.y, pa.z, qa.x, qa.y, qa.z, qa.w, a.camera.fov];
        for (const n of na) ha.mix(n);
        if (same && !na.every((n, k) => Object.is(n, nb[k]))) {
          same = false;
          where = `frame ${i}`;
        }
      }
    }
    const want = blocked ? TRACE_HASH.blocked : TRACE_HASH.plain;
    if (blocked) ok(cuts > 50, `6: (the blocker cut the line ${cuts} times over the trace)`);
    if (a) {
      note(`6: the camera at the pass's start traces to ${ha.value.toString(16)}${blocked ? ' with a blocker' : ''}`);
      ok(ha.value === want, `6: (the camera at the pass's start, out of git, traces to the hash written here${blocked ? ', with a blocker' : ''}: ${ha.value.toString(16)})`);
      ok(same, `6: with the pass off the orbit is the camera at the pass's start by Object.is over 600 frames, first person included${blocked ? ', with a blocker' : ''}${where ? ` (parted at ${where})` : ''}`);
    } else ok(hb.value === want, `6: with the pass off the orbit traces to the hash of the camera at the pass's start over 600 frames, first person included${blocked ? ', with a blocker' : ''} (${hb.value.toString(16)})`);
  }
  for (const fp of [false, true]) {
    const cam = new ThirdPersonCamera(16 / 9);
    if (fp) {
      cam.zoomTarget = 0;
      cam.distance = 0;
    }
    const stub = { locked: false, mouseDX: 0, mouseDY: 0, wheel: 0 } as never;
    cam.speedFov = 10;
    cam.update(stub, new THREE.Vector3(), null, 1 / 60, new THREE.Vector3(0, 1.5, 0), 1, 1.5);
    const wide = cam.camera.fov;
    cam.speedFov = 0;
    cam.update(stub, new THREE.Vector3(), null, 1 / 60, new THREE.Vector3(0, 1.5, 0), 1, 1.5);
    ok(wide === 70 && cam.camera.fov === 60, `6: a camera given speedFov 10 then 0 in ${fp ? 'first' : 'third'} person is widened and back to the base after`);
  }
  // Eased out after a race: back to nought exactly, and nothing asked of it after.
  const st = newRaceView();
  st.fov = 16;
  st.fitFov = 16;
  let refits = 0;
  for (let i = 0; i < 600; i++) if (easeFovOut(st, 1 / 60, T)) refits++;
  ok(st.fov === 0 && st.fitFov === 0 && refits <= 9 && !easeFovOut(st, 1 / 60, T), `6: the widening eases out to nought exactly, the cascades refitted ${refits} times on the way, and nothing after`);
}

// --- 7: what blocks the view -------------------------------------------------------------------------------------
{
  const physics = await Physics.create();
  // A corridor 20 m wide between bodiless cylinders 0.5 m across every 6 m (the flora's colliders' shape).
  for (let z = -100; z < 1400; z += 6) for (const x of [-10, 10]) physics.world.createCollider(RAPIER.ColliderDesc.cylinder(10, 0.25).setTranslation(x, 10, z).setCollisionGroups(groups(Group.exterior, Group.all)));
  physics.stepOnce();
  /** The race view's own blocker as main.ts' `raceBlock` makes it: the physics' block distance handed to `raceBlocked`. */
  const blockerFor = (st: { clear: number }, dtRef: { dt: number }) => (from: THREE.Vector3, to: THREE.Vector3) => {
    const len = from.distanceTo(to);
    const d = physics.blockDistance(from.x, from.y, from.z, to.x, to.y, to.z, false);
    return raceBlocked(st, len, d, dtRef.dt, T.camOut) ? st.clear + RACE_BLOCK_MARGIN : null;
  };
  const main = src('../../../src/main.ts');
  ok(/return raceBlocked\(this\.raceView, len, d, this\.raceDt, RACE_TUNE\.camOut\) \? this\.raceView\.clear \+ RACE_BLOCK_MARGIN : null;/.test(main), "7: (main.ts: the game's blocker is raceBlocked over the physics' block distance, as here)");
  for (const fps of [20, 60, 144]) {
    const dt = 1 / fps;
    const cam = new ThirdPersonCamera(16 / 9);
    cam.pitch = 0.32;
    const st = { clear: Infinity };
    const ref = { dt };
    const block = blockerFor(st, ref);
    const stub = { locked: false, mouseDX: 0, mouseDY: 0, wheel: 0 } as never;
    let under = 0;
    let pulled = 0;
    let frames = 0;
    for (let t = 0; t < 3; t += dt) {
      // The pod at full speed down the middle, the view behind it swinging a little either side as a turn would lean it.
      const focus = new THREE.Vector3(Math.sin(t * 2) * 3, 1.2, t * 333);
      cam.yaw = Math.PI + Math.sin(t * 1.3) * 0.8;
      const scale = (Math.max(cam.distance, 15 + T.raceClear) * 1.3) / cam.distance;
      cam.update(stub, focus, block, dt, null, scale, 1.5);
      frames++;
      if (cam.orbitDistance < 0.5 * cam.distance * scale) under++;
      if (cam.orbitDistance < 0.98 * cam.distance * scale) pulled++;
    }
    note(`7: at ${fps} fps, down a corridor of trunks at full speed, the view stood under half its own distance ${r2((100 * under) / frames)}% of the time and was pulled in at all ${r2((100 * pulled) / frames)}% (${under} and ${pulled} of ${frames} frames)`);
  }
  // A wall across the view pulls it in at once; once clear it goes back out over camOut.
  {
    const dt = 1 / 60;
    const cam = new ThirdPersonCamera(16 / 9);
    cam.pitch = 0.2;
    const st = { clear: Infinity };
    const block = blockerFor(st, { dt });
    const stub = { locked: false, mouseDX: 0, mouseDY: 0, wheel: 0 } as never;
    const focus = new THREE.Vector3(0, 1.2, 2000);
    for (let i = 0; i < 30; i++) cam.update(stub, focus, block, dt, null, 1.3, 1.5);
    const free = cam.orbitDistance;
    const wall = physics.world.createCollider(RAPIER.ColliderDesc.cuboid(20, 20, 0.5).setTranslation(0, 1, 2000 - free * 0.5).setCollisionGroups(groups(Group.exterior, Group.all)));
    physics.stepOnce();
    cam.update(stub, focus, block, dt, null, 1.3, 1.5);
    const pulled = cam.orbitDistance;
    physics.world.removeCollider(wall, true);
    physics.stepOnce();
    let t = 0;
    let at63 = Infinity;
    while (t < 3) {
      cam.update(stub, focus, block, dt, null, 1.3, 1.5);
      t += dt;
      if (at63 === Infinity && cam.orbitDistance >= pulled + 0.63 * (free - pulled)) at63 = t;
    }
    ok(pulled < free * 0.6, `7: a wall across the view pulls it in at once (${r2(free)} to ${r2(pulled)} m in one frame)`);
    ok(Math.abs(at63 - T.camOut) < 0.05 && Math.abs(cam.orbitDistance - free) < 0.05, `7: and once clear it goes back out over camOut (63% back in ${r2(at63)} s, all the way to ${r2(cam.orbitDistance)} m)`);
  }
}

// --- 8: what the game hands the view -----------------------------------------------------------------------------
{
  // Every ease of the camera half reads the frame's step off the record; the game writes it there on every call. Left
  // unwritten, the record kept the half second it was made with, and every ease ran near-instant at every frame rate.
  const main = src('../../../src/main.ts');
  const body = /private raceInput\(v: Vehicle, race: RaceDrive, keys: boolean, alt: boolean, dt: number\): RaceViewInput \{\s*\n\s*const ri = this\.raceIn;\s*\n\s*ri\.dt = dt;/.test(main);
  const calls = [...main.matchAll(/this\.raceInput\(([^)]*)\)/g)].map((m) => m[1].split(',').length);
  ok(body && calls.length >= 3 && calls.every((n) => n === 5), `8: (main.ts: raceInput writes the frame's step into the record, and each of its ${calls.length} calls hands one)`);
  // And what it does with it: the same pull eased from the first frame with the record's step left at its half second
  // and with the frame's own, at 144 fps: the one reaches its target in a few frames, the other in its 0.6 s.
  const eased = (dt: number) => {
    const st = newRaceView();
    const out = newRaceViewOut();
    const vin = input();
    vin.speed = vin.ceiling;
    vin.dt = dt;
    for (let i = 0; i < 4; i++) frameRaceView(st, vin, T, out);
    return st.pull;
  };
  ok(eased(1 / 144) < 1.03 && eased(0.5) > 1.25, `8: four frames at 144 fps pull the view out to ${r2(eased(1 / 144))} with the frame's step, and to ${r2(eased(0.5))} with the record's half second`);
  // The cascades are fitted after the camera has written this frame's field of view (they read it as they fit).
  const place = /private placeRaceView\(.*\): void \{\s*\n\s*if \(this\.placeRaceCamera\(v, blocked, dt, eyes\)\) this\.world\.onCameraResized\(\);/.test(main);
  const orbit = /this\.cam\.update\(input, player\.worldPos, blocked, dt, eyes, player\.grapple\.camScaleNow, player\.eyeHeight\);\s*\n\s*\/\/ Fitted to the frustum the update has just given the camera, never to last frame's\.\s*\n\s*if \(refit\) this\.world\.onCameraResized\(\);/.test(main);
  ok(place && orbit, '8: (main.ts: the cascades are refitted after the camera writes the field of view, in the race view and as it eases out)');
}

console.log(`\nraceView: ${checks} checks passed`);
