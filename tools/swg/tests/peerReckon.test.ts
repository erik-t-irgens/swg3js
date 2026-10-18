// Another player's vehicle drawn where it is (src/net/peerReckon.ts, the racer's wave 4a): the picture moved by the
// velocity its own game sent and eased onto the last place carried forward by that state's age on the shared clock.
//
// The simulation is research2's own (the steady lag of a peer's picture at speed, measured: 44.5 m at 333 m/s with no
// delay, 62 m with 50 ms), run with the jitter the grapple's wave 3c learned to model: states sent from the sender's own
// frames ten a second, each place the sender's body as the physics' last fixed step left it, heard 50 ms on with 5 ms
// of jitter, and stamped as the game stamps a state it hears (as it arrives, or as the next frame starts on a main
// thread busy all frame long). Against it the old glide, run beside it, shows the lag the reckoning takes away; and the
// cases where nothing new may be used -- no clock shared, a state with no motion, an age no agreeing clock gives --
// glide exactly as before.
//
// Run: node --expose-gc tools/swg/tests/peerReckon.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import v8 from 'node:v8';
import { RECKON_TUNE, newReckonState, placeMoment, readReckon, reckonStepIn, reckonable, reckonsIn, tuneReckon, turnBack } from '../../../src/net/peerReckon.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const r3 = (n: number) => Number(n.toFixed(3));
const FIXED = 1 / 60;
const defaults = { ...RECKON_TUNE };

/** A truth the sender's vehicle is driven along, at sim time `t`: place and turn. */
type Truth = (t: number, p: THREE.Vector3, q: THREE.Quaternion) => void;

interface Sim {
  fps: number;
  speed: number;
  latency: number;
  jitter: number;
  stamp: 'arrival' | 'frame';
  truth?: Truth;
  /** The sender stamps its frame's own moment, not the moment its body's place was true (the fault this guards). */
  stampFrame?: boolean;
  /**
   * The sender takes the remainder behind off its frame's start but not the frame's own step, which the place it sends
   * (the frame before's step's) has not taken yet: what `App.motionForWire` stamped until review found it.
   */
  stampLate?: boolean;
  /**
   * The turn sent is written in frame time, as a race drive and a flown ship write theirs: the truth's own at the frame's
   * end, a frame ahead of the place the frame before's step left, carried back by the game's own `turnBack` unless
   * `noTurnBack` (the turn sent as written).
   */
  frameTurn?: boolean;
  noTurnBack?: boolean;
  /** The receiver has no clock shared (no server answering): nothing new may be used. */
  noClock?: boolean;
  /** The states carry no motion (a relay before `veh: 2`). */
  noMotion?: boolean;
  /** The receiver's clock stands this far from the sender's (ms). */
  clockOff?: number;
  seconds?: number;
  /** The sender's own frame rate (60 unless said): at 144 its frames run ahead of its fixed steps by the remainder. */
  senderFps?: number;
  /** States stop being sent after this many seconds (a hidden tab stops its game). */
  silentAfter?: number;
}

/**
 * Two browsers on one wall clock. The sender's frames at 60 fps step its body on the physics' fixed steps (a place
 * changes only on a step, the frame's start runs ahead of it by the accumulator's remainder) and send a state on the
 * first frame a tenth of a second after the last, in the game's own order: in the frame, before that frame's own
 * physics step (`App.stepNet` runs before `Physics.step`), so the place sent is the one the frame before's step left.
 * A state is the body's place and turn, its velocity and turn about straight up, and the moment its place was true,
 * stamped by the game's own `placeMoment` with the frame's own step and the remainder. The receiver's frames at `fps`
 * hear what has arrived, then step two pictures -- the reckoned one, and the old glide beside it -- and measure each
 * against the truth at the frame's moment.
 */
function simulate(o: Sim) {
  const speed = o.speed;
  const truth: Truth = o.truth ?? ((t, p, q) => void (p.set(0, 1, speed * t), q.identity()));
  const sdt = 1 / (o.senderFps ?? 60);
  const fdt = 1 / o.fps;
  const seconds = o.seconds ?? 8;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // The sender.
  let sWall = 0;
  let sAcc = 0;
  let sSim = 0;
  let lastSent = -1;
  const body = new THREE.Vector3();
  const bodyQ = new THREE.Quaternion();
  truth(0, body, bodyQ);
  const queue: { arrive: number; veh: { p: number[]; q: number[]; vl?: number[]; yr?: number; at?: number } }[] = [];
  // The receiver.
  const reck = newReckonState();
  const pic = new THREE.Vector3();
  const picQ = new THREE.Quaternion();
  const glide = new THREE.Vector3();
  const glideQ = new THREE.Quaternion();
  const glideTarget = new THREE.Vector3();
  const glideTargetQ = new THREE.Quaternion();
  let first = true;
  const n = new Float64Array(3);
  const want = new THREE.Vector3();
  const wantQ = new THREE.Quaternion();
  const tmp = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  let rWall = 0;
  let sum = 0;
  let most = 0;
  let gSum = 0;
  let gMost = 0;
  let turnMost = 0;
  let count = 0;
  let reckoned = 0;
  let frames = 0;
  while (rWall < seconds) {
    rWall += fdt;
    // The sender's frames up to now, each perhaps sending and then stepping its body on the fixed steps.
    while (sWall + sdt <= rWall + 1e-12) {
      sWall += sdt;
      if ((o.silentAfter === undefined || sWall <= o.silentAfter) && sWall - lastSent >= 0.1 - 1e-9) {
        lastSent = sWall;
        // The velocity and turn the body really has now: the truth's own derivative at its sim time.
        truth(sSim + 1e-4, tmp, tmpQ);
        const vl = [(tmp.x - body.x) / 1e-4, (tmp.y - body.y) / 1e-4, (tmp.z - body.z) / 1e-4];
        const yaw0 = Math.atan2(2 * (bodyQ.x * bodyQ.z + bodyQ.w * bodyQ.y), 1 - 2 * (bodyQ.x * bodyQ.x + bodyQ.y * bodyQ.y));
        const yaw1 = Math.atan2(2 * (tmpQ.x * tmpQ.z + tmpQ.w * tmpQ.y), 1 - 2 * (tmpQ.x * tmpQ.x + tmpQ.y * tmpQ.y));
        let dy = yaw1 - yaw0;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        const yr = dy / 1e-4;
        // The frame's start on the shared clock, less the frame's own step (the body has not taken it yet) and the remainder
        // the body stood behind even that.
        const at = o.stampFrame ? sWall * 1000 : placeMoment(sWall * 1000, 0, o.stampLate ? 0 : sdt, sAcc);
        // The turn: the body's, beside its place; or, written in frame time, the truth's at the frame's end, carried back
        // over the frame's own step by the game's own arithmetic to the turn the body stood at beside its place.
        const sentQ = bodyQ.clone();
        if (o.frameTurn) {
          truth(sWall, tmp, sentQ);
          if (!o.noTurnBack) turnBack(sentQ, yr, sdt);
        }
        const veh = o.noMotion ? { p: body.toArray(), q: sentQ.toArray() } : { p: body.toArray(), q: sentQ.toArray(), vl, yr, at };
        queue.push({ arrive: sWall + o.latency + (rnd() * 2 - 1) * o.jitter, veh });
      }
      sAcc += sdt;
      while (sAcc >= FIXED - 1e-12) {
        sAcc -= FIXED;
        sSim += FIXED;
        truth(sSim, body, bodyQ);
      }
    }
    queue.sort((a, b) => a.arrive - b.arrive);
    while (queue.length && queue[0].arrive <= rWall) {
      const m = queue.shift()!;
      // Heard as it arrives, or as this frame starts on a thread busy all frame.
      const heard = o.stamp === 'frame' ? rWall : m.arrive;
      const shared = o.noClock ? Number.NaN : heard * 1000 + (o.clockOff ?? 0);
      readReckon(m.veh, shared, reck);
      glideTarget.set(m.veh.p[0], m.veh.p[1], m.veh.p[2]);
      glideTargetQ.set(m.veh.q[0], m.veh.q[1], m.veh.q[2], m.veh.q[3]);
      if (first) {
        pic.copy(glideTarget);
        picQ.copy(glideTargetQ);
        glide.copy(glideTarget);
        glideQ.copy(glideTargetQ);
        first = false;
      }
    }
    if (first) continue;
    frames++;
    // The reckoned picture, as `RemotePlayers.update` steps it; and the glide it replaced, `1 - exp(-dt / 0.1)`.
    n[0] = fdt;
    n[2] = o.noClock ? Number.NaN : rWall * 1000 + (o.clockOff ?? 0);
    const k = 1 - Math.exp(-fdt / 0.1);
    if (reckonsIn(reck, n)) {
      reckoned++;
      reckonStepIn(pic, picQ, reck, n);
    } else {
      pic.lerp(glideTarget, k);
      picQ.slerp(glideTargetQ, k);
    }
    glide.lerp(glideTarget, k);
    glideQ.slerp(glideTargetQ, k);
    if (rWall < 2) continue;
    // The truth at this frame's moment (the sender's sim keeps the wall's time: nothing here stalls).
    truth(rWall, want, wantQ);
    const off = pic.distanceTo(want);
    const gOff = glide.distanceTo(want);
    sum += off;
    most = Math.max(most, off);
    gSum += gOff;
    gMost = Math.max(gMost, gOff);
    turnMost = Math.max(turnMost, picQ.angleTo(wantQ));
    count++;
  }
  return { mean: sum / count, most, glideMean: gSum / count, glideMost: gMost, turnMost, reckoned, frames, pic, glide, glideTarget };
}

// --- 1: the steady lag gone, straight and steady --------------------------------------------------------------------
{
  for (const speed of [85, 97, 167]) {
    for (const fps of [60, 144, 30]) {
      const s = simulate({ fps, speed, latency: 0.05, jitter: 0.005, stamp: 'arrival' });
      ok(s.reckoned === s.frames && s.most < 0.001 * speed + 1e-6 && s.glideMean > 0.1 * speed, `1: ${speed} m/s at ${fps} fps, heard 50 ms on with 5 ms of jitter: the reckoned picture stands ${r3(s.mean)} m off the truth on average and ${r3(s.most)} at most, where the glide trailed it by ${r3(s.glideMean)} m (${r3(s.glideMost)} at most)`);
    }
  }
  // A main thread busy all frame, every state heard as the next frame starts: the moment a state was heard moves
  // nothing, since its age is read from the moment it was sent.
  for (const fps of [60, 144]) {
    const s = simulate({ fps, speed: 167, latency: 0.05, jitter: 0.005, stamp: 'frame' });
    ok(s.most < 0.2 && s.glideMean > 15, `1: 167 m/s at ${fps} fps, every state heard as the next frame starts: still ${r3(s.most)} m at most off the truth (the glide ${r3(s.glideMean)} m behind)`);
  }
  // Stamped with the sender's frame rather than the moment its body's place was true, the place is behind its stamp by
  // the frame's own step and the accumulator's remainder: the picture stands behind the truth by up to two steps' travel,
  // which the right stamp takes away -- the test sees the stamp.
  const wrong = simulate({ fps: 144, senderFps: 144, speed: 167, latency: 0.05, jitter: 0.005, stamp: 'arrival', stampFrame: true });
  const right = simulate({ fps: 144, senderFps: 144, speed: 167, latency: 0.05, jitter: 0.005, stamp: 'arrival' });
  ok(wrong.mean > 10 * right.mean + 0.05, `1: stamped with the sender's frame and not the moment its body's place was true, the picture stands ${r3(wrong.mean)} m off on average (with the right stamp ${r3(right.mean)}): the stamp the game sends is the place's own moment`);
  // With the remainder taken off and the frame's own step not, a state sent before its frame's step is carried a frame too
  // little: the picture stands the speed over the sender's frame rate behind, at every sender's frame rate.
  for (const senderFps of [144, 60, 30]) {
    const late = simulate({ fps: 144, senderFps, speed: 167, latency: 0.05, jitter: 0.005, stamp: 'arrival', stampLate: true });
    const fixed = simulate({ fps: 144, senderFps, speed: 167, latency: 0.05, jitter: 0.005, stamp: 'arrival' });
    ok(Math.abs(late.mean - 167 / senderFps) < 0.05 && fixed.most < 0.001 * 167 + 1e-6, `1: a sender at ${senderFps} fps whose stamp leaves out the frame's own step puts the picture ${r3(late.mean)} m behind (its speed over its frame rate, ${r3(167 / senderFps)}); with the step taken off, ${r3(fixed.most)} m at most`);
  }
}

// --- 2: a vehicle that turns -----------------------------------------------------------------------------------------
{
  // A pod at full speed turning at its own most, ninety-five degrees a second, on a circle.
  const w = (95 * Math.PI) / 180;
  const speed = 167;
  const radius = speed / w;
  const up = new THREE.Vector3(0, 1, 0);
  const circle: Truth = (t, p, q) => {
    const a = w * t;
    p.set(radius - radius * Math.cos(a), 1, radius * Math.sin(a));
    q.setFromAxisAngle(up, a);
  };
  for (const fps of [60, 144, 30]) {
    const s = simulate({ fps, speed, latency: 0.05, jitter: 0.005, stamp: 'arrival', truth: circle });
    ok(s.most < 0.02 * speed && s.turnMost < 0.05 && s.glideMean > 10 * s.mean, `2: ${speed} m/s turning at 95 deg/s, ${fps} fps: the reckoned picture stays within ${r3(s.most)} m of the truth (${r3(s.mean)} on average) and its turn within ${r3((s.turnMost * 180) / Math.PI)} deg, where the glide trailed by ${r3(s.glideMean)} m`);
  }
  // With the turn left out the place is still reckoned, the turn eased toward each state as before: it lags the truth.
  tuneReckon({ turn: false });
  const flat = simulate({ fps: 60, speed, latency: 0.05, jitter: 0.005, stamp: 'arrival', truth: circle });
  tuneReckon({ turn: true });
  const turned = simulate({ fps: 60, speed, latency: 0.05, jitter: 0.005, stamp: 'arrival', truth: circle });
  ok(flat.turnMost > 5 * turned.turnMost, `2: with the turn not reckoned (turn false) the picture's turn trails the truth by up to ${r3((flat.turnMost * 180) / Math.PI)} deg, with it ${r3((turned.turnMost * 180) / Math.PI)}: the test sees the turn`);
  // A turn written in frame time (a race drive's, a flown ship's) is a frame ahead of the place the frame before's step
  // left: carried back over the frame's own step it stands beside the place, sent as written it leads the truth by a
  // frame's turning, a degree and a half at 95 degrees a second.
  const written = simulate({ fps: 60, speed, latency: 0.05, jitter: 0.005, stamp: 'arrival', truth: circle, frameTurn: true });
  const ahead = simulate({ fps: 60, speed, latency: 0.05, jitter: 0.005, stamp: 'arrival', truth: circle, frameTurn: true, noTurnBack: true });
  ok(written.turnMost < 0.005 && ahead.turnMost > 0.02 && written.most < 0.02 * speed, `2: a turn written in frame time, carried back by turnBack, stands within ${r3((written.turnMost * 180) / Math.PI)} deg of the truth; sent as written it leads by ${r3((ahead.turnMost * 180) / Math.PI)} deg: the test sees the turn carried back`);
  // turnBack is a turn about straight up, the other way, by the rate times the time.
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.7);
  turnBack(q, 2, 0.1);
  const want = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);
  // (Within what three's `angleTo`, an arc cosine near one, can tell apart.)
  ok(q.angleTo(want) < 1e-6 && Math.abs(q.y - want.y) < 1e-15 && Math.abs(q.w - want.w) < 1e-15, '2: turnBack(q, 2 rad/s, 0.1 s) takes 0.2 rad off a turn about straight up');
}

// --- 3: the cases that glide exactly as before -----------------------------------------------------------------------
{
  const noClock = simulate({ fps: 60, speed: 167, latency: 0.05, jitter: 0.005, stamp: 'arrival', noClock: true });
  ok(noClock.reckoned === 0 && noClock.pic.equals(noClock.glide), `3: with no clock shared nothing is reckoned, and the picture is the old glide to the bit (${r3(noClock.pic.distanceTo(noClock.glide))} m apart)`);
  const noMotion = simulate({ fps: 60, speed: 167, latency: 0.05, jitter: 0.005, stamp: 'arrival', noMotion: true });
  ok(noMotion.reckoned === 0 && noMotion.pic.equals(noMotion.glide), '3: a state with no motion in it (a relay before veh 2) is glided to, to the bit');
  const farClock = simulate({ fps: 60, speed: 167, latency: 0.05, jitter: 0.005, stamp: 'arrival', clockOff: 5000 });
  ok(farClock.reckoned === 0 && farClock.pic.equals(farClock.glide), `3: a clock five seconds out (every state heard older than trust's ${RECKON_TUNE.trust} s) is not believed, and the picture glides`);
  const early = simulate({ fps: 60, speed: 167, latency: 0.05, jitter: 0.005, stamp: 'arrival', clockOff: -2000 });
  ok(early.reckoned === 0 && early.pic.equals(early.glide), '3: nor is one that hears every state two seconds before it was sent');
  tuneReckon({ on: false });
  const off = simulate({ fps: 60, speed: 167, latency: 0.05, jitter: 0.005, stamp: 'arrival' });
  tuneReckon({ on: true });
  ok(off.reckoned === 0 && off.pic.equals(off.glide), '3: switched off, every picture glides exactly as before');
  // A clock a few tens of milliseconds out is believed, and the picture stands that far along the line.
  const near = simulate({ fps: 60, speed: 97, latency: 0.05, jitter: 0.005, stamp: 'arrival', clockOff: 30 });
  ok(near.reckoned === near.frames && Math.abs(near.mean - 0.03 * 97) < 0.05, `3: two clocks 30 ms apart are believed: the picture stands ${r3(near.mean)} m along the line, the clocks' difference times the speed (${r3(0.03 * 97)})`);
}

// --- 4: a peer gone quiet stands where its last state would have taken it --------------------------------------------
{
  const s = simulate({ fps: 60, speed: 97, latency: 0.05, jitter: 0.005, stamp: 'arrival', silentAfter: 3, seconds: 8 });
  const last = s.glideTarget;
  const lead = s.pic.z - last.z;
  ok(Math.abs(lead - 97 * RECKON_TUNE.most) < 0.05 && s.reckoned === s.frames, `4: states stopped at 3 s: the picture stands ${r3(lead)} m past the last place sent, ${RECKON_TUNE.most} s of its speed on, and stays there rather than gliding back to it`);
}

// --- 5: one step for the picture and the rope ------------------------------------------------------------------------
{
  // The picture is stepped on three's own vector and quaternion, the grapple's rope on plain records: the same numbers,
  // the same arithmetic, the same answer to the bit.
  const reck = newReckonState();
  readReckon({ p: [3, 1, -7], q: [0, Math.sin(0.4), 0, Math.cos(0.4)], vl: [12.5, -0.25, 97], yr: 1.3, at: 1_760_000_000_000 }, 1_760_000_000_060, reck);
  const n = new Float64Array([1 / 144, 0, 1_760_000_000_075]);
  ok(reckonsIn(reck, n) && Math.abs(n[1] - 0.075) < 1e-9 && reckonable(reck, n[2]), `5: a state heard 60 ms after it was sent is believed, and its age now is ${r3(n[1])} s`);
  const p = new THREE.Vector3(2.75, 1.1, -7.5);
  const q = new THREE.Quaternion(0.01, 0.38, -0.02, 0.92).normalize();
  const pp = { x: p.x, y: p.y, z: p.z };
  const pq = { x: q.x, y: q.y, z: q.z, w: q.w };
  reckonStepIn(p, q, reck, n);
  reckonStepIn(pp, pq, reck, n);
  ok(Object.is(p.x, pp.x) && Object.is(p.y, pp.y) && Object.is(p.z, pp.z) && Object.is(q.x, pq.x) && Object.is(q.y, pq.y) && Object.is(q.z, pq.z) && Object.is(q.w, pq.w), '5: stepped on three\'s objects and on plain records alike, the place and the turn are equal by Object.is');
  ok(!reckonable(undefined, n[2]) && !reckonable(reck, Number.NaN), '5: nothing to reckon from, or no clock, is not reckonable');
}

// --- 6: the moment a place was true ----------------------------------------------------------------------------------
{
  ok(placeMoment(1_000_000, 4, 1 / 64, 0.01) === 1_000_000 - 4 - 1000 / 64 - 10, '6: the frame\'s start on the shared clock, less the frame so far, the frame\'s own step still to come and the bodies\' remainder behind it');
  ok(placeMoment(1_000_000, -3, -1, -1) === 1_000_000, '6: a frame that has not begun yet, or a step or a remainder below nought, takes nothing off');
  // And the game stamps with it so: the frame's own step handed in, read before the frame's physics step.
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  ok(/const at = placeMoment\(sharedClock\.now\(\) - sharedClock\.lagNow\(\), performance\.now\(\) - frameAt, dt, this\.physics\.behind\);/.test(main) && /this\.stepNet\(dt, tFrame\);[\s\S]*this\.physics\.step\(dt\);/.test(main), "6: the game stamps a state with the frame's own step and the remainder, and sends it before that frame's physics step");
}

// --- 7: nothing made ---------------------------------------------------------------------------------------------------
{
  const gc = (globalThis as { gc?: (o?: { type: 'minor' }) => void }).gc;
  if (!gc) ok(true, '7: run with --expose-gc to measure the reckoning\'s step making nothing');
  else {
    const reck = newReckonState();
    readReckon({ p: [0, 1, 0], q: [0, 0, 0, 1], vl: [0, 0, 97], yr: 0.5, at: 1000 }, 1040, reck);
    const p = { x: 0.5, y: 0.5, z: 0.5 };
    const q = { x: 0.5, y: 0.5, z: 0.5, w: 0.5 };
    p.x = 0;
    p.y = 1;
    p.z = 0;
    q.x = 0;
    q.y = 0;
    q.z = 0;
    q.w = 1;
    const n = new Float64Array(3);
    const step = (i: number) => {
      n[0] = 1 / 144;
      n[2] = 1040 + (i % 100);
      if (reckonsIn(reck, n)) reckonStepIn(p, q, reck, n);
    };
    for (let i = 0; i < 200_000; i++) step(i);
    const young = () => v8.getHeapSpaceStatistics().find((s) => s.space_name === 'new_space')?.space_used_size ?? 0;
    let best = Infinity;
    for (let attempt = 0; attempt < 3; attempt++) {
      gc({ type: 'minor' });
      const before = young();
      for (let i = 0; i < 1_000_000; i++) step(i);
      best = Math.min(best, young() - before);
    }
    ok(best < 0.05 * 1_000_000, `7: a million steps of a reckoned picture make ${Math.max(0, best)} bytes (the cleanest of three)`);
  }
}

Object.assign(RECKON_TUNE, defaults);
console.log(`\npeerReckon: ${checks} checks passed`);
