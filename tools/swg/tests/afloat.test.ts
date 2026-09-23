// The one spring a floating body holds its line with. Pure arithmetic, so this runs exactly what
// the game runs -- the player's swim and every swimming or hovering creature both ask this function
// and nothing else.
//
// The case that matters is the one that was live until now: the sea is drawn as a moving surface
// and everything floating in it read the flat table underneath, so a crest rose over a swimmer's
// head and a trough dropped out from under its feet while the body held perfectly still.
import assert from 'node:assert/strict';
import { AFLOAT, afloatVelocity, tuneAfloat, type AfloatTune } from '../../../src/world/afloat.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const near = (a: number, b: number, eps: number): boolean => Math.abs(a - b) <= eps;
const tune = (patch: Partial<AfloatTune> = {}): AfloatTune => ({ ...AFLOAT, ...patch });

/**
 * A body driven by the spring against a surface it does not control, stepped at a fixed rate. This
 * is the player's loop with everything but the vertical taken out: ask for a speed, ease onto it
 * the way the swim does, move.
 */
function ride(surfaceAt: (t: number) => number, opts: { seconds: number; dt: number; depth: number; start?: number; t: AfloatTune }) {
  let y = opts.start ?? surfaceAt(0) - opts.depth;
  let vy = 0;
  let worstLag = 0;
  let above = 0;
  let below = 0;
  let steps = 0;
  for (let time = 0; time < opts.seconds; time += opts.dt) {
    const surface = surfaceAt(time);
    // Both real callers write this straight onto the body: the player assigns `vel.y` and a
    // creature hands it to `setLinvel`. Nothing eases it again, which is the whole point.
    vy = afloatVelocity(surface - opts.depth, y, vy, opts.dt, opts.t);
    y += vy * opts.dt;
    // Only judge it once the first second has settled: it starts on the line but the wave does not
    // start at rest, so the opening moment is a transient and not the thing being measured.
    if (time > 1) {
      const under = surface - y;
      worstLag = Math.max(worstLag, Math.abs(under - opts.depth));
      above = Math.max(above, opts.depth - under);
      below = Math.max(below, under - opts.depth);
      steps++;
    }
  }
  return { y, vy, worstLag, above, below, steps };
}

{
  // The shape is the creatures' own hold; the stiffness is not, and the next block is why.
  ok(AFLOAT.track === 8 && AFLOAT.damp === 0.3 && AFLOAT.speed === 6, 'the float spring is track 8, damp 0.3, capped at 6 m/s');
}

{
  // Why the creatures' own 2.5 was not simply reused. It is a good number against a target that
  // does not move -- a flyer's hover, a flat lake -- and it is measurably not one against a swell,
  // which is a thing nothing floated on until now. Both figures are measured below, not asserted
  // from theory, so a later session can see the trade rather than take it on trust.
  const wave = (t: number) => 20 + 0.75 * Math.sin((2 * Math.PI * t) / 8);
  const soft = ride(wave, { seconds: 40, dt: 1 / 60, depth: 1.1, t: tune({ track: 2.5 }) });
  const stiff = ride(wave, { seconds: 40, dt: 1 / 60, depth: 1.1, t: tune() });
  ok(soft.worstLag > 0.2, `the creatures old 2.5 is ${soft.worstLag.toFixed(3)} m out of step on an eight second swell`);
  ok(stiff.worstLag < soft.worstLag / 2, `and the float spring is less than half that (${stiff.worstLag.toFixed(3)} m)`);
}

{
  // The sign, which is the whole of it: below the line it rises, above it falls, on it with no
  // motion it asks for nothing at all, so flat water costs the body nothing.
  ok(afloatVelocity(10, 10, 0, 1 / 60) === 0, 'a body already on its line and still asks for nothing, so flat water is exactly what it was');
  ok(afloatVelocity(10, 9, 0, 1 / 60) > 0, 'below its line it asks to rise');
  ok(afloatVelocity(10, 11, 0, 1 / 60) < 0, 'above it it asks to fall');
  ok(near(afloatVelocity(10, 9.9, 0, 1 / 60), 0.8, 1e-9), 'and by the gap times the track, ten centimetres down being 0.8 m/s');
}

{
  // The damping, which is what stops a body shooting out of the crest it was chasing.
  ok(afloatVelocity(10, 9.9, 2, 1 / 60) < afloatVelocity(10, 9.9, 0, 1 / 60), 'a body already rising asks for less than one starting from rest');
  ok(near(afloatVelocity(10, 9.9, 2, 1 / 60), 0.8 - 0.6, 1e-9), 'exactly its own rise times the damping less');
  ok(afloatVelocity(10, 10, 4, 1 / 60) < 0, 'and on its line but still rising it asks to come back down');
}

{
  // The cap, which is not decoration: `want` is a drawn surface and it can step a long way between
  // two frames for reasons that are not a wave -- a travel, the sea being switched on, a body
  // crossing from a lake to the open sea.
  ok(afloatVelocity(1000, 0, 0, 1 / 60) === AFLOAT.speed, 'a surface that jumps a kilometre still only asks for the cap');
  ok(afloatVelocity(-1000, 0, 0, 1 / 60) === -AFLOAT.speed, 'and the same downwards');
  ok(afloatVelocity(1000, 0, 0, 1 / 60, tune({ speed: 2 })) === 2, 'the cap is the tune s, not a constant');
}

{
  // And it never asks for a step that would carry the body past the line, which is what keeps a
  // knob turned up settling instead of ringing: this is a number somebody types into a console,
  // and an explicit step whose gain times the frame is over two oscillates for ever.
  const wild = tune({ track: 600, speed: 1e9 });
  const dt = 1 / 60;
  ok(near(afloatVelocity(10, 9.9, 0, dt, wild), 0.1 / dt, 1e-9), 'an absurd track lands exactly on the line rather than past it');
  ok(near(afloatVelocity(10, 10.1, 0, dt, wild), -0.1 / dt, 1e-9), 'and the same coming down onto it');
  let y = 0;
  let vy = 0;
  for (let i = 0; i < 400; i++) {
    vy = afloatVelocity(10, y, vy, dt, wild);
    y += vy * dt;
  }
  ok(near(y, 10, 1e-9), `so even at track 600 it settles on the line and stays (ended at ${y.toFixed(6)})`);
}

{
  // Nothing may throw or answer nonsense: this is asked every frame by the player and by every
  // swimming creature, and a point with no water over it answers -Infinity.
  ok(afloatVelocity(-Infinity, 5, 1.5, 1 / 60) === 1.5, 'no water over the point leaves the body doing whatever it was doing');
  ok(afloatVelocity(Number.NaN, 5, 1.5, 1 / 60) === 1.5, 'and so does a surface that is not a number');
  ok(afloatVelocity(10, Number.NaN, 1.5, 1 / 60) === 1.5, 'and a body whose own height is not a number');
  ok(near(afloatVelocity(10, 9.9, Number.NaN, 1 / 60), 0.8, 1e-9), 'a rise that is not a number is read as none rather than poisoning the answer');
  ok(Number.isFinite(afloatVelocity(10, 9.9, 0, 0)), 'and a step of no length at all still answers a real number');
  ok(Number.isFinite(afloatVelocity(10, 9.9, 0, Number.NaN)), 'as does a step that is not a number');
}

{
  // The real claim, and the reason this exists: a body rides a wave instead of letting it wash
  // over. An eight-second swell a metre and a half from trough to crest is the open sea's own
  // shape; the player's swim depth is 1.1 m.
  const wave = (t: number) => 20 + 0.75 * Math.sin((2 * Math.PI * t) / 8);
  const r = ride(wave, { seconds: 40, dt: 1 / 60, depth: 1.1, t: tune() });
  ok(r.steps > 2000, `the ride really ran (${r.steps} steps judged)`);
  ok(r.worstLag < 0.12, `the body holds its line within 12 cm of a 1.5 m swell (worst ${r.worstLag.toFixed(3)} m)`);
  ok(r.above < 0.12, `it never rides up out of the water (worst ${r.above.toFixed(3)} m proud of where it should sit)`);

  // And what it replaces: a body that reads the flat table holds one height while the sea moves
  // around it by the whole wave, which is the bug in one number.
  const flat = 20 - 1.1;
  let worstFlat = 0;
  for (let t = 0; t < 40; t += 1 / 60) worstFlat = Math.max(worstFlat, Math.abs(wave(t) - flat - 1.1));
  ok(worstFlat > 0.7, `reading the flat table instead is out by the wave itself (${worstFlat.toFixed(3)} m)`);
  ok(r.worstLag < worstFlat / 3, 'so the spring is better than the plane by more than a factor of three');
}

{
  // A short steep chop is the hard case: the stiffer the wave the further behind a spring falls,
  // and the honest thing is to say by how much rather than to claim it is exact.
  const chop = (t: number) => 20 + 0.35 * Math.sin((2 * Math.PI * t) / 2.5);
  const r = ride(chop, { seconds: 30, dt: 1 / 60, depth: 1.1, t: tune() });
  ok(r.worstLag < 0.16, `a 2.5 s chop is followed within 16 cm (worst ${r.worstLag.toFixed(3)} m)`);
  const stiff = ride(chop, { seconds: 30, dt: 1 / 60, depth: 1.1, t: tune({ track: 12 }) });
  ok(stiff.worstLag < r.worstLag, 'and a stiffer track follows it closer, which is what the knob is for');
}

{
  // A slow frame must not change where the body ends up. The game clamps dt to a twentieth of a
  // second, so that is the worst step this can be asked at.
  const wave = (t: number) => 20 + 0.75 * Math.sin((2 * Math.PI * t) / 8);
  const fast = ride(wave, { seconds: 40, dt: 1 / 60, depth: 1.1, t: tune() });
  const slow = ride(wave, { seconds: 40, dt: 1 / 20, depth: 1.1, t: tune() });
  ok(slow.worstLag < 0.12, `at a twentieth of a second it still holds within 12 cm (worst ${slow.worstLag.toFixed(3)} m)`);
  ok(Math.abs(slow.y - fast.y) < 0.5, 'and ends the ride within half a metre of where the fast one did');
}

{
  // The body must settle rather than ring: dropped in from ten metres under, it comes up to its
  // line and stops there instead of bouncing out of the water.
  const still = () => 20;
  const r = ride(still, { seconds: 20, dt: 1 / 60, depth: 1.1, start: 10, t: tune() });
  ok(near(r.y, 18.9, 0.02), `it settles on its line from ten metres under (ended at ${r.y.toFixed(3)}, wanted 18.9)`);
  ok(r.above < 0.05, `and does not overshoot out of the water on the way (worst ${r.above.toFixed(3)} m)`);
  ok(Math.abs(r.vy) < 0.05, 'and is at rest when it gets there');
}

{
  // The knob writes and reports, and refuses anything that is not a real number, since it is typed
  // into a console by hand.
  const before = { ...AFLOAT };
  ok(tuneAfloat({ track: 4 }).track === 4, 'the knob writes a number');
  ok(tuneAfloat({ damp: Number.NaN }).damp === before.damp, 'and refuses one that is not a number');
  ok(tuneAfloat({ speed: Infinity }).speed === before.speed, 'and refuses an infinite one');
  ok(tuneAfloat().track === 4, 'asking with nothing reports without changing');
  tuneAfloat(before);
  ok(AFLOAT.track === 8 && AFLOAT.damp === 0.3 && AFLOAT.speed === 6, 'and the table is put back for whatever runs next');
}

console.log(`\n${passed} checks passed`);
