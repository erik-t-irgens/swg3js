// The rope chain round (the owner's ask of 2026-11-18): the round's own digest (`climbRopeChainAfter`), begun by maker A (items 1
// and 2: the chain, and a body on it). The course's `rope` piece stood as the game's `climbTest` stands it and three scenes run
// through the game's own movement and climbing on real Rapier at 30, 60, 144 and 240 frames a second (tools/swg/tests/
// climbRopeChainBody.ts): 'free' (the rope let go of at 0.3 rad across the pit, left alone 40 s), 'lying' (a rope 10.5 m long, its
// tail on the pit's floor, let go of at 0.25 rad, 30 s) and 'held' (phase 4's session: run off the edge, E at the rope, a still
// hang, a climb, a pumped swing, let alone, D, a climb down, pumped again, Space letting go). Each frame is the harness's `frame`
// and then its `drawRopes` (the player's: the chains stepped over the frame's physics steps and laid for drawing).
//  - With every switch of the round at its other setting (`climbRopeLookBefore`, phase 5's rope): every frame's body (its place,
//    velocity, the rope's phase, mode, way down, give, angle, speed and drawn angle) and the rope as it is drawn ('straight': the
//    anchor, the hands, the end) are `6e59ce8`'s to the bit, both digests recorded from that commit's own code (a git archive of
//    it in the maker's scratch folder) before the round's code ran a frame.
//  - At the round's shipped settings ('chain'): the body is the very same to the bit (nothing of the chain feeds back), and the
//    drawn chain (its points as laid, the hands' places in them) is as recorded from this run; and every frame, at every rate, no
//    point of the chain stands under the ground or inside any of the piece's solids, a held rope's drawn line passes through its
//    hands, the span above the hands holds the swing's length (the anchor to the pin), and the free rope ends vertical.
// Maker B adds the round's drawing (item 3) beside these: every frame of every run the harness lays each rope's strip as the player
// lays it (`drawChained`: the chain's curve, src/player/ropeCurve.ts, and the strip turned to a camera stood beside the rope,
// src/player/ropeChainDraw.ts), and
//  - with the round's switches at their other setting no strip is ever shown (the rope drawn straight, as the digests above say);
//  - at the shipped settings: the drawn strip (its rings' middles, as uploaded, and the twist's places along) is as recorded from
//    this run (`STRIP`); every knot of the curve is the chain's drawn point to the bit, lifted `climb.ropeLift` along its surface's
//    normal where it lies on something and not moved where it does not; the strip's rings at the hands are within a centimetre of
//    each drawn hand at every frame of every rate; no ring's middle stands under the ground or inside a solid by more than the
//    chain's radius; and the free rope's strip at each whole second of physics steps is the same at 30 and 240 frames a second
//    within a millimetre.
//
// Run: node tools/swg/tests/climbRopeChainAfter.test.ts
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { CLIMB_TUNE, climbRopeLookBefore, resetClimbTune } from '../../../src/anim/climbTune.ts';
import { CHAIN_RADIUS } from '../../../src/player/ropeChain.ts';
import { CURVE_STEPS } from '../../../src/player/ropeCurve.ts';
import { RATES, SLAB_LIFT } from './climbCourseBody.ts';
import { bodyRow, chainRow, chainSession, ropeSolids, straightRow, type ChainScene } from './climbRopeChainBody.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** `6e59ce8`'s own (recorded 2026-11-18 at that commit's code, nothing of the round yet written): the body, and the rope drawn straight. */
const BEFORE: Record<ChainScene, { frames: number; body: string; drawn: string }> = {
  free: { frames: 18960, body: '1f5562a535d839e66c0b46706a3044e31f028a1871e457e926c75a1401a12bab', drawn: '7f20e0221d1fc97e0ce237e16c98c88e2d3e7bb1defa57efb65c6745293511db' },
  lying: { frames: 14220, body: 'f86ec0523f3992badc7195df5eb0fb6dd6d54a7f524b1afa0c9d56794a58c4ca', drawn: '9b7825df962d743fe025c4f54702f22a048be17aa961e601a1796cc191b9c4b3' },
  held: { frames: 11124, body: '11cc4dcbdbf26929a5fb94fd7f4d51133d94230d501925521a7fd0495df03c26', drawn: '4b691b1c4893fc68fb4d8724d48e068c860e6a6d29a6e8f40a5c2f5c8005e07e' },
};
/** The round's shipped settings, maker A's: the drawn chain (recorded from this run's first pass, 2026-11-18). */
const CHAIN: Record<ChainScene, string> = {
  free: '04c4d4e60dc27aa676a1b731e2a230abc38be662f3ab99187156b3dd7a7b08be',
  lying: '2cdb736b6fd5644dc191c793afc6decd482bbc8e443417438471bf3e4729d1ba',
  // (The fixer's: each step pinned on the swing's own and the pin begun only between steps; maker A's first was ef06352097112c45.)
  held: '58e1d0844fbd302a5279f4254fb08c925713c1681428b7dafbcc2a91f91df4ff',
};
/** Maker B's: the drawn strip at the shipped settings (its rings' middles as uploaded, and the twist's places along), recorded from this run's first pass, 2026-11-18. */
const STRIP: Record<ChainScene, string> = {
  free: 'e251a689f6a3ab69b77caa5bee25654e779a0d85aea237ae96b8da4a50fca38a',
  lying: '4c35417e750402d287ef0c6fc712453d96deab6a357bee8ca49d13864044582e',
  // (The fixer's: each step pinned on the swing's own and the pin begun only between steps; maker B's first was 8cda82544a7881b3.)
  held: 'c6d4fe48d011c5741c84f156b4c5d53b1643d7c68bc44c53a71ed994295d443f',
};

/** Maker B: how far a point stands inside the piece's solids or under the ground's top, metres (nought outside all). */
function depthIn(x: number, y: number, z: number): number {
  let most = y < GROUND ? GROUND - y : 0;
  for (const s of SOLIDS) {
    if (x > s.min[0] && x < s.max[0] && y > s.min[1] && y < s.max[1] && z > s.min[2] && z < s.max[2]) {
      const d = Math.min(x - s.min[0], s.max[0] - x, y - s.min[1], s.max[1] - y, z - s.min[2], s.max[2] - z);
      if (d > most) most = d;
    }
  }
  return most;
}

/** A point inside any of the piece's solids by more than `tol` (metres), or under the ground's top (and the radius) by more. */
const SOLIDS = ropeSolids();
const GROUND = -SLAB_LIFT;
function intrudes(x: number, y: number, z: number, tol: number): string {
  if (y < GROUND + CHAIN_RADIUS - tol) return 'the ground';
  for (const s of SOLIDS) {
    if (x > s.min[0] + tol && x < s.max[0] - tol && y > s.min[1] + tol && y < s.max[1] - tol && z > s.min[2] + tol && z < s.max[2] - tol) return s.role;
  }
  return '';
}

const row = new Float64Array(14);
const draw = new Float64Array(3 * 70);
const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
/** Maker B: a strip's ring `i`'s middle (the two vertices as uploaded, float32), into `at`. */
const ringAt = (pos: ArrayLike<number>, i: number, at: number[]) => {
  at[0] = (pos[6 * i] + pos[6 * i + 3]) / 2;
  at[1] = (pos[6 * i + 1] + pos[6 * i + 4]) / 2;
  at[2] = (pos[6 * i + 2] + pos[6 * i + 5]) / 2;
};
const at3 = [0, 0, 0];
/** Maker B: the free rope's strip at each whole second, by rate (its rings' middles), to hold 30 against 240. */
const freeSeconds = new Map<number, Map<number, Float64Array>>();
for (const scene of ['free', 'lying', 'held'] as ChainScene[]) {
  for (const off of [true, false]) {
    resetClimbTune();
    if (off) climbRopeLookBefore();
    const hb = createHash('sha256');
    const hd = createHash('sha256');
    const hs = createHash('sha256');
    let frames = 0;
    // Maker B's checks of the drawn strip.
    let stripShown = 0;
    let knotMiss = 0;
    let liftedKnots = 0;
    let gripRingMiss = 0;
    let gripRingWorst = 0;
    let ringIns = 0;
    let ringInFirst = '';
    let cornerCuts = 0;
    let cornerWorst = 0;
    let linkWorst = 0;
    let pastLink = 0;
    // The shipped run's own checks, at every frame of every rate.
    let worstIn = '';
    let ins = 0;
    let drawnIns = 0;
    let handMiss = 0;
    let spanMiss = 0;
    let heldFrames = 0;
    let lyingAtEnd = 0;
    let endOff = 0;
    const rows: string[] = [];
    for (const fps of RATES) {
      const seconds = new Map<number, Float64Array>();
      if (scene === 'free' && !off) freeSeconds.set(fps, seconds);
      const run = await chainSession(scene, fps, (b, r, f) => {
        bodyRow(b, row);
        hb.update(new Uint8Array(row.buffer));
        const k = off ? straightRow(r, draw) : chainRow(r, draw);
        hd.update(new Uint8Array(draw.buffer, 0, k * 8));
        // Maker B: the strip as the player lays it (the harness's `drawRopes`, given the camera).
        const strip = b.chainStrips.get(r);
        if (strip?.mesh.visible) stripShown++;
        const c = r.chain;
        if (off || !c || !c.live) return;
        if (strip && strip.mesh.visible) {
          const curve = b.ropeCurve;
          const pos = strip.mesh.geometry.getAttribute('position').array as Float32Array;
          const uv = strip.mesh.geometry.getAttribute('uv').array as Float32Array;
          hs.update(new Uint8Array(pos.buffer, 0, strip.rings * 6 * 4));
          hs.update(new Uint8Array(uv.buffer, 0, strip.rings * 4 * 4));
          // Every knot of the curve: the chain's drawn point, lifted along its normal where it lies on something, else as it stands.
          const lift = CLIMB_TUNE.ropeLift;
          for (let j = 0; j < c.drawCount; j++) {
            const nx = c.drawN[3 * j];
            const ny = c.drawN[3 * j + 1];
            const nz = c.drawN[3 * j + 2];
            const lie = nx !== 0 || ny !== 0 || nz !== 0;
            if (lie) liftedKnots++;
            const q = j * CURVE_STEPS;
            const ex = c.draw[3 * j] + (lie ? nx * lift : 0);
            const ey = c.draw[3 * j + 1] + (lie ? ny * lift : 0);
            const ez = c.draw[3 * j + 2] + (lie ? nz * lift : 0);
            if (curve.ring[3 * q] !== ex || curve.ring[3 * q + 1] !== ey || curve.ring[3 * q + 2] !== ez) knotMiss++;
          }
          // The strip's rings at the hands, as uploaded: within a centimetre of each drawn hand.
          if (c.gripA >= 0) {
            ringAt(pos, curve.gripA, at3);
            const da = Math.hypot(at3[0] - c.handA[0], at3[1] - c.handA[1], at3[2] - c.handA[2]);
            ringAt(pos, curve.gripB, at3);
            const db = Math.hypot(at3[0] - c.handB[0], at3[1] - c.handB[1], at3[2] - c.handB[2]);
            gripRingWorst = Math.max(gripRingWorst, da, db);
            if (!(da < 0.01 && db < 0.01)) gripRingMiss++;
          }
          // No ring's middle under the ground or inside a solid by more than the chain's radius, unless the chain's own straight link
          // between the same two knots goes in at least as deep there (a link cuts a corner the rope sweeps across, which the chain's
          // points alone are kept out of: the curve, bowing out round it, cuts it less).
          for (let i = 0; i < strip.rings; i++) {
            ringAt(pos, i, at3);
            const d = depthIn(at3[0], at3[1], at3[2]);
            if (d <= CHAIN_RADIUS) continue;
            // (The links round its span: the span's own and its neighbours', the four knots the curve there is laid through.)
            const j = Math.min(Math.floor(i / CURVE_STEPS), c.drawCount - 2);
            let link = 0;
            for (let s = Math.max(0, j - 1); s <= Math.min(c.drawCount - 2, j + 1); s++) {
              for (let u = 1; u < 32; u++) {
                const t = u / 32;
                const R = curve.ring;
                const q0 = 3 * s * CURVE_STEPS;
                const q1 = 3 * (s + 1) * CURVE_STEPS;
                link = Math.max(link, depthIn(R[q0] + (R[q1] - R[q0]) * t, R[q0 + 1] + (R[q1 + 1] - R[q0 + 1]) * t, R[q0 + 2] + (R[q1 + 2] - R[q0 + 2]) * t));
              }
            }
            // (Never in where the links round it are clear: the curve makes no cut of its own. Where they cut a corner the rope sweeps
            // across, the curve has no hull to keep it on their side, and its bow by its four knots falls a few millimetres either side
            // of their chord: measured 8.8 mm past it at most, on a tail whipping past the platform's edge after a let-go, against a
            // cut of the links' own of 77 mm. A centimetre: the cut is the chain's, at its points' spacing; the curve adds under that.)
            if (link === 0 || d > link + 0.01) {
              ringIns++;
              ringInFirst ||= `ring ${i} ${(d * 1000).toFixed(1)} mm in, its link ${(link * 1000).toFixed(1)} mm, at ${at3.map((v) => v.toFixed(3)).join(', ')}, frame ${f} at ${fps}`;
            } else {
              cornerCuts++;
              cornerWorst = Math.max(cornerWorst, d);
              linkWorst = Math.max(linkWorst, link);
              pastLink = Math.max(pastLink, d - link);
            }
          }
          // The free rope at each whole second of the physics' steps (frame f's end at (f + 1) / fps).
          if (scene === 'free' && ((f + 1) % fps) === 0) {
            const keep = new Float64Array(3 * strip.rings);
            for (let i = 0; i < strip.rings; i++) {
              ringAt(pos, i, at3);
              keep[3 * i] = at3[0];
              keep[3 * i + 1] = at3[1];
              keep[3 * i + 2] = at3[2];
            }
            seconds.set((f + 1) / fps, keep);
          }
        }
        for (let i = 1; i < c.n; i++) {
          const w = intrudes(c.px[i], c.py[i], c.pz[i], 0.001);
          if (w) {
            ins++;
            worstIn ||= `${w} (point ${i} at ${c.px[i].toFixed(3)}, ${c.py[i].toFixed(3)}, ${c.pz[i].toFixed(3)})`;
          }
        }
        for (let i = 1; i < c.drawCount; i++) if (intrudes(c.draw[3 * i], c.draw[3 * i + 1], c.draw[3 * i + 2], CHAIN_RADIUS)) drawnIns++;
        // (Every frame the body holds the rope, the grab's own before the pin begins on the swing's first step among them: the fixer.)
        if (r.held) {
          heldFrames++;
          // The hands (no rig: the grip on the rope's line at the frame's own time) are points of the drawn line.
          const g = r.gripS + r.e;
          const sn = Math.sin(r.thDraw);
          const gx = r.ax + g * sn * r.fx;
          const gy = r.ay - g * Math.cos(r.thDraw);
          const gz = r.az + g * sn * r.fz;
          const m = c.gripA;
          const d = m < 0 ? Infinity : Math.hypot(c.draw[3 * m] - gx, c.draw[3 * m + 1] - gy, c.draw[3 * m + 2] - gz);
          if (!(d < 0.01)) handMiss++;
          // The span above the hands holds the swing's length: the anchor to the pin is its place along the chain.
          const span = Math.hypot(c.pinX - r.ax, c.pinY - r.ay, c.pinZ - r.az);
          // (Not before the pin has begun, on the swing's first step after the grab: it then stands nowhere yet.)
          if (c.pinOn && !c.pinFresh && Math.abs(span - c.pinS) > 0.001) spanMiss++;
        }
      }, camera);
      frames += run.frames;
      const c = run.rope.chain;
      if (!off && c && c.live) {
        let most = 0;
        let lying = 0;
        for (let i = 1; i < c.n; i++) {
          most = Math.max(most, Math.hypot(c.px[i] - run.rope.ax, c.pz[i] - run.rope.az));
          if (c.touch[i]) lying++;
        }
        if (scene === 'free') endOff = Math.max(endOff, most);
        if (scene === 'lying') lyingAtEnd = Math.min(lyingAtEnd || Infinity, lying);
        rows.push(`${fps}: ${run.held ? `held, climbed ${run.climbed.toFixed(2)} m, swung to ${((run.most * 180) / Math.PI).toFixed(1)} degrees, ${run.letGo ? 'let go' : 'not let go'}; ` : ''}farthest point off the anchor's vertical at the end ${most.toFixed(3)} m, ${lying} lying`);
      }
    }
    const body = hb.digest('hex');
    const drawn = hd.digest('hex');
    const strip = hs.digest('hex');
    const want = BEFORE[scene];
    if (off) {
      console.log(`     ${scene}, the round's switches at their other settings: ${frames} frames, body ${body}, drawn ${drawn}`);
      ok(frames === want.frames && body === want.body, `${scene}: with the round's switches at their other settings every frame of the body is 6e59ce8's to the bit (${frames} frames, ${body.slice(0, 16)})`);
      ok(drawn === want.drawn, `${scene}: ... and the rope is drawn straight as 6e59ce8 drew it, to the bit (${drawn.slice(0, 16)})`);
      ok(stripShown === 0, `${scene}: ... and no strip of the chained look is ever shown (${stripShown} frames)`);
      continue;
    }
    console.log(`     ${scene}, the drawn strip at the shipped settings: ${strip}`);
    ok(stripShown === frames, `${scene}: at the shipped settings the rope is drawn as a strip through its chain's curve at every frame of every rate (${stripShown} of ${frames})`);
    ok(knotMiss === 0, `${scene}: every knot of the curve is the chain's drawn point to the bit, lifted ${CLIMB_TUNE.ropeLift} m along its surface's normal where it lies on something (${liftedKnots} lifted knot-frames) and not moved where it does not (${knotMiss} missed)`);
    ok(ringIns === 0, `${scene}: no ring of the strip stands under the ground or inside any of the piece's solids by more than the chain's radius, but where the chain's own straight link between the same knots goes in deeper (a corner the rope sweeps across: ${cornerCuts} ring-frames, the strip at most ${(cornerWorst * 1000).toFixed(1)} mm in where the links went ${(linkWorst * 1000).toFixed(1)}, and at most ${(pastLink * 1000).toFixed(1)} mm past its links)${ringIns ? ` (${ringIns} in where their links are clear or a centimetre past them: first ${ringInFirst})` : ''}`);
    if (scene === 'lying') ok(liftedKnots > 1000, `lying: the tail lying on the floor is drawn lifted off it (${liftedKnots} lifted knot-frames)`);
    if (scene === 'held') ok(gripRingMiss === 0, `held: the drawn strip's rings at the hands are within a centimetre of each drawn hand at every frame of every rate (worst ${(gripRingWorst * 1000).toFixed(3)} mm, ${gripRingMiss} missed)`);
    if (scene === 'free') {
      const a = freeSeconds.get(30)!;
      const z = freeSeconds.get(240)!;
      let worst = 0;
      let compared = 0;
      for (const [t, ra] of a) {
        const rz = z.get(t);
        if (!rz || rz.length !== ra.length) continue;
        compared++;
        for (let i = 0; i < ra.length; i++) worst = Math.max(worst, Math.abs(ra[i] - rz[i]));
      }
      ok(compared >= 39 && worst < 0.001, `free: the strip at each whole second of the physics' steps is the same at 30 and 240 frames a second within a millimetre (${compared} seconds, worst ${(worst * 1000).toFixed(4)} mm)`);
    }
    if (STRIP[scene]) ok(strip === STRIP[scene], `${scene}: ... and every frame of the drawn strip is as it was to the bit (${strip.slice(0, 16)})`);
    else console.log(`     (no strip digest recorded for ${scene} yet)`);
    console.log(`     ${scene}, at the shipped settings: ${frames} frames, body ${body}, drawn chain ${drawn}`);
    ok(frames === want.frames && body === want.body, `${scene}: at the shipped settings ('chain') every frame of the body is still 6e59ce8's to the bit: nothing of the chain feeds back (${frames} frames, ${body.slice(0, 16)})`);
    ok(ins === 0, `${scene}: no point of the chain stands under the ground or inside any of the piece's solids by more than a millimetre at any frame of any rate${ins ? ` (${ins}: first ${worstIn})` : ''}`);
    ok(drawnIns === 0, `${scene}: ... nor any point of it as drawn by more than its radius (${drawnIns})`);
    if (scene === 'held') {
      ok(heldFrames > 1000 && handMiss === 0, `held: on the rope (${heldFrames} frames) the drawn line passes through the hands within a centimetre at every frame of every rate (${handMiss} missed)`);
      ok(spanMiss === 0, `held: ... and the span above them holds the swing's length (the anchor to the pin, its place along the chain) within a millimetre (${spanMiss} missed); ${rows.join('; ')}`);
    }
    if (scene === 'free') ok(endOff < 0.01, `free: let alone 40 s the chain settles to a vertical line, every point within a centimetre of the anchor's vertical at every rate (${rows.join('; ')})`);
    if (scene === 'lying') ok(lyingAtEnd >= 2, `lying: the rope's tail lies on the pit's floor at the end, at every rate (${rows.join('; ')})`);
    ok(drawn === CHAIN[scene], `${scene}: ... and every frame of the drawn chain is as it was to the bit (${drawn.slice(0, 16)})`);
  }
}
resetClimbTune();
console.log(`climbRopeChainAfter: ${checks} checks passed`);
