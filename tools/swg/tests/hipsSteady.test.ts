// The stairs wave, part A: the hips held steady (`ik.hips` 'steady'): the human male walked and jogged by the game's own
// movement, classes, sampler and feet (`hipsWalk.ts`, the player's order) up and down 10, 20 and 30 degree slopes at 30, 60
// and 144 frames a second, onto a kerb, and up and down a flight:
//  - the hips add no bob of their own: the hips' height in the world less the straight line through it along the travel,
//    lowest to highest, is the flat ground's within 2 cm on every slope, either way, walking or jogging (today's rule,
//    'before', beside: up to 27 cm more);
//  - no pop: that height moves no faster than it does on flat ground (a quarter more, and 5 cm a second);
//  - a planted foot slides no further than under today's rule (the walk's own pace slides its landing foot either way: the
//    classes' paces are the owner's, wave 2's);
//  - no knee is ever bent backward (behind its hip-to-ankle line).
//
// Run: node tools/swg/tests/hipsSteady.test.ts
import assert from 'node:assert/strict';
import { hipsRun, type Ground, type HipsRun } from './hipsWalk.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const cm = (m: number) => `${(m * 100).toFixed(1)} cm`;

const flat = new Map<string, HipsRun>();
for (const walk of [true, false]) for (const fps of [30, 60, 144]) flat.set(`${walk}${fps}`, await hipsRun({ kind: 'flat' }, walk, fps, 'steady'));
for (const [key, f] of flat) {
  const tag = `${key.startsWith('true') ? 'walking' : 'jogging'} on flat ground at ${key.replace(/^(true|false)/, '')} frames a second`;
  // The reviewer's case: the toe pointed at a heel strike lifted the heel and left the ball over the ground (2.5 cm).
  ok(f.floatFrames === 0, `${tag}: a planted foot stands within a centimetre of its ground (its lower sole point at worst ${cm(f.float)} over it)`);
  ok(f.sunk <= 0.025, `${tag}: no sole point sinks more than 2.5 cm into the ground (${cm(f.sunk)}: a swinging toe's own graze)`);
}
for (const walk of [true, false]) {
  const gait = walk ? 'walking' : 'jogging';
  for (const deg of [10, 20, 30]) {
    for (const way of [1, -1]) {
      const ground: Ground = { kind: 'slope', deg, way };
      for (const fps of [30, 60, 144]) {
        const f = flat.get(`${walk}${fps}`)!;
        const r = await hipsRun(ground, walk, fps, 'steady');
        const tag = `${gait} ${way > 0 ? 'up' : 'down'} ${deg} degrees at ${fps} frames a second`;
        ok(r.frames > 60 && Math.abs(r.line - f.line) <= 0.02, `${tag}: the hips bob ${cm(r.line)} about their line, the flat ground's ${cm(f.line)} (${r.line >= f.line ? 'adding' : 'taking'} ${cm(Math.abs(r.line - f.line))}; over the drawn root ${cm(r.bob)})`);
        ok(r.linePop <= 1.25 * f.linePop + 0.05, `${tag}: no pop (the hips move off their line at most ${r.linePop.toFixed(2)} m/s, the flat ground's ${f.linePop.toFixed(2)})`);
        ok(r.knee <= 0, `${tag}: no knee bent backward (each at least ${cm(-r.knee)} ahead of its hip-to-ankle line)`);
        // Within a centimetre, but for a frame or two where the drop is still easing in as the slope begins (a toe-off counts
        // the tip of the toes it is rolled onto as its lowest sole point: hipsWalk.ts).
        ok(r.floatFrames <= 4 && r.float <= 0.015, `${tag}: a planted foot stands within a centimetre of its ground (its lower sole point at worst ${cm(r.float)} over it, over a centimetre in ${r.floatFrames} frames)`);
        ok(r.sunk <= f.sunk + 0.01, `${tag}: no sole point, planted or swinging, sinks into the slope further than on flat ground (${cm(r.sunk)}, the flat ground's ${cm(f.sunk)})`);
        if (fps === 60) {
          const b = await hipsRun(ground, walk, fps, 'before');
          const fb = await hipsRun({ kind: 'flat' }, walk, fps, 'before');
          ok(r.slide <= b.slide + 0.01, `${tag}: a planted foot slides no further than under today's rule (${cm(r.slide)} against ${cm(b.slide)} over ${r.stances} stances)`);
          note(`${tag}, today's rule beside: the hips bob ${cm(b.line)} about their line (the flat ground's ${cm(fb.line)}, adding ${cm(b.line - fb.line)}), moving off it at most ${b.linePop.toFixed(2)} m/s`);
        }
      }
    }
  }
}
{
  // A kerb 15 cm high stepped onto, and a flight walked up and down: no pop where the capsule climbs.
  const f = flat.get('true60')!;
  const kerb = await hipsRun({ kind: 'kerb', h: 0.15 }, true, 60, 'steady', 6);
  const kerbB = await hipsRun({ kind: 'kerb', h: 0.15 }, true, 60, 'before', 6);
  ok(kerb.worldPop <= kerbB.worldPop && kerb.knee <= 0, `onto a kerb 15 cm high, walking: the hips climb it at most ${kerb.worldPop.toFixed(2)} m/s in the world (today's rule ${kerbB.worldPop.toFixed(2)}; on flat ground they move ${f.worldPop.toFixed(2)}), and no knee backward`);
  for (const way of [1, -1]) {
    const s = await hipsRun({ kind: 'stairs', tread: 0.28, riser: 0.17, way }, true, 60, 'steady', 12);
    const sb = await hipsRun({ kind: 'stairs', tread: 0.28, riser: 0.17, way }, true, 60, 'before', 12);
    ok(s.knee <= 0.005 && s.linePop < sb.linePop + 0.05, `walking ${way > 0 ? 'up' : 'down'} 0.28/0.17 stairs: the hips move off their line at most ${s.linePop.toFixed(2)} m/s (today's rule ${sb.linePop.toFixed(2)}), bob ${cm(s.line)} about it (today's ${cm(sb.line)}), no knee backward by more than 5 mm (${cm(Math.max(0, s.knee))})`);
  }
}
console.log(`hipsSteady: ${checks} checks passed`);
