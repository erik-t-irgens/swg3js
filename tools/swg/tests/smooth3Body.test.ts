// Climbing II, Smoothness III, items 3 and 3b (maker B), on the body's own frame (the grapple's harness on the real Rapier, the
// game's own `BodyShape`, `DuckPace` and the posture's hand-over), walking with W held at 30, 60, 144 and 240 frames a second:
//  - item 3 (`move.proneMin` 'opening'): the duck lies down only into a real opening: never at a slab's side (5 cm to 0.6 m), a
//    slab running into a hill, a slab past bumpy ground or a climbing wall's foot; under a free plate (0.9 to 1.2 m over the floor)
//    and into a crawlspace of 0.49 to 0.6 m it lies down once and goes on through; one lower than the lying body and its skin
//    over its feet (0.48 m and under: a lying body needs 0.48 and stalls under 0.479) is a wall, and the body stops before it,
//    never lying down where it then could not go in; a probe begun inside something answers nothing, says so and the
//    body does not lie down ('today': the room alone, as Smoothness II left it, noted);
//  - item 3b (`move.duckClip` 'clearance'): walking under a beam the duck wears the crouch clip whose head stands highest and
//    still clears the beam by `headSkin` (the crouched walk under 1.60 m, the sneak walk from 1.55 m to 1.30 m, lying down from
//    1.25 m), its capsule's top shrunk to that clip's head, the head never into the beam; 'one': the one crouch walk always.
// The crouch clips' heads are handed over as the player's `measureDeep` measures them on the human male (sneak 1.181 m, the
// crouched walk 1.50 m, the crouched run 1.49 m over the feet).
//
// Run: node tools/swg/tests/smooth3Body.test.ts
import assert from 'node:assert/strict';
import { TestBody, box, ground, heightChunk, makePhysics, type Physics } from './grappleBody.ts';
import { resetMoveTune, tuneMove, MOVE_TUNE } from '../../../src/anim/moveTune.ts';
import { resetClimbTune } from '../../../src/anim/climbTune.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const RATES = [30, 60, 144, 240] as const;
const HEADS = [Number.NaN, 1.181, 1.5, 1.49];

interface Walk {
  laid: number;
  z: number;
  said: string;
  inside: number;
  worn: Set<number>;
  into: number;
  tallest: number;
}
/** A walk from the origin with W held for `secs`, the scene built by `build`, the heads handed over as the game does. */
async function walk(build: (p: Physics) => void, fps: number, secs: number, tune: Record<string, unknown>, heads: boolean, roofY = Number.NaN, force = 0): Promise<Walk> {
  resetMoveTune();
  tuneMove(tune);
  const p = await makePhysics();
  build(p);
  p.stepOnce();
  const b = new TestBody(p);
  b.place(0, 0.5, 0);
  b.forward.set(0, 0, 1);
  b.right.set(-1, 0, 0);
  b.shapeIn.headOver = 0.17;
  b.shapeIn.deepHead = 1.5;
  if (heads) for (let k = 1; k < 4; k++) b.shapeIn.clipHeads[k] = HEADS[k];
  b.run(fps, 0.5);
  // (A probe begun inside something, forced: the world answers its first `force` start-clear tests with a hit.)
  const w = p.world as unknown as { intersectionWithShape: (...a: unknown[]) => unknown };
  const real = w.intersectionWithShape.bind(w);
  let left = force;
  if (force > 0) w.intersectionWithShape = (...a: unknown[]) => (left-- > 0 ? {} : real(...a));
  const W: Walk = { laid: 0, z: 0, said: '', inside: 0, worn: new Set(), into: Number.NEGATIVE_INFINITY, tallest: 0 };
  b.key('KeyW', true);
  b.run(fps, secs, () => {
    if (b.shape.roofSaid) W.said = b.shape.roofSaid;
    if (roofY === roofY && b.pos.z > 3.2 && b.pos.z < 5.8 && b.shape.kind === 0) {
      W.worn.add(b.shape.duckCls);
      const head = b.shape.duckCls > 0 ? b.shapeIn.clipHeads[b.shape.duckCls] : b.shape.tall + b.shapeIn.headOver;
      W.into = Math.max(W.into, b.pos.y - 0.04 + head - roofY);
      W.tallest = Math.max(W.tallest, b.shape.tall);
    }
    return false;
  });
  b.key('KeyW', false);
  W.laid = b.duck.laid;
  W.z = b.pos.z;
  W.inside = b.shape.inside;
  return W;
}

// ---- item 3 ------------------------------------------------------------------------------------------------------------------
const tan15 = Math.tan((15 * Math.PI) / 180);
const walls: [string, (p: Physics) => void][] = [];
for (const h of [0.05, 0.1, 0.2, 0.3, 0.45, 0.6]) walls.push([`a slab's side ${h} m`, (p) => { ground(p, 0); box(p, [-3, 0, 3], [3, h, 8], false); }]);
for (const h of [0.05, 0.15, 0.3]) walls.push([`a slab running into a 15 degree hill, its edge ${h} m`, (p) => { heightChunk(p, -32, -32, (_x, z) => Math.max(0, z - 1) * tan15); box(p, [-3, -1, 3], [3, tan15 * 2 + h, 8], false); }]);
walls.push(['bumpy ground, then a slab 0.3 m', (p) => { heightChunk(p, -32, -32, (x, z) => 0.06 * Math.sin(x * 3) * Math.cos(z * 2.7)); box(p, [-3, -0.2, 3], [3, 0.3, 8], false); }]);
walls.push(['a climbing wall\'s foot', (p) => { ground(p, 0); box(p, [-3, 0, 3], [3, 10, 4], false); }]);
for (const [what, build] of walls) {
  const lays: number[] = [];
  for (const fps of RATES) lays.push((await walk(build, fps, 4, { proneMin: 'opening' }, false)).laid);
  ok(lays.every((n) => n === 0), `${what}: never lies down at it (laid ${lays.join(', ')} at ${RATES.join(', ')} frames a second)`);
  const today: number[] = [];
  for (const fps of [60]) today.push((await walk(build, fps, 4, { proneMin: 'today' }, false)).laid);
  note(`${what}, 'today' @60: laid ${today[0]}`);
}
for (const u of [0.9, 1.0, 1.2]) {
  const build = (p: Physics) => { ground(p, 0); box(p, [-3, u, 3], [3, u + 0.3, 3.3], false); box(p, [-3, 0, 5.6], [3, 3, 6], false); };
  const lays: number[] = [];
  for (const fps of RATES) lays.push((await walk(build, fps, 4, { proneMin: 'opening' }, false)).laid);
  ok(lays.every((n) => n >= 1), `a free plate ${u} m over the floor (a wall 2.3 m on): an opening, lain down under (laid ${lays.join(', ')})`);
}
for (const u of [0.6, 0.55, 0.5]) {
  const build = (p: Physics) => { ground(p, 0); box(p, [-3, u, 3], [3, u + 0.3, 7], false); };
  const r = await Promise.all(RATES.map(async (fps) => walk(build, fps, 8, { proneMin: 'opening' }, false)));
  ok(r.every((w) => w.laid === 1 && w.z > 7), `a crawlspace ${u} m: lain down once and crawled through (laid ${r.map((w) => w.laid).join(', ')}, out at z ${r.map((w) => w.z.toFixed(1)).join(', ')})`);
}
// The review's question, whether a 0.46 to 0.48 m gap a lying body would fit is refused: a lying body needs 0.48 m (its 0.40 and
// the controller's own 4 cm under it and over it) and stalls under 0.479 at 144 frames a second, so the rule's start (the lying
// body's height and the skin over its feet, 0.49 m over the floor) crawls from 0.49 and stands before everything under it, the
// skin's centimetre over the controller's offset the owner's; asked from the floor alone (0.45) it laid the body down in front of
// 0.46 to 0.479 m and stalled it there. 'today' noted: Smoothness II lay down under 0.475 m and stalled at 144.
{
  const build = (p: Physics) => { ground(p, 0); box(p, [-3, 0.49, 3], [3, 0.79, 7], false); };
  const r = await Promise.all(RATES.map(async (fps) => walk(build, fps, 8, { proneMin: 'opening' }, false)));
  ok(r.every((w) => w.laid === 1 && w.z > 7), `a crawlspace 0.49 m: lain down once and crawled through (laid ${r.map((w) => w.laid).join(', ')}, out at z ${r.map((w) => w.z.toFixed(1)).join(', ')})`);
  const t = await walk((p) => { ground(p, 0); box(p, [-3, 0.475, 3], [3, 0.775, 7], false); }, 144, 6, { proneMin: 'today' }, false);
  note(`a crawlspace 0.475 m under 'today' @144: laid ${t.laid}, at z ${t.z.toFixed(2)} (a lying body there goes no further)`);
}
for (const u of [0.48, 0.475, 0.47, 0.46, 0.44, 0.4]) {
  const build = (p: Physics) => { ground(p, 0); box(p, [-3, u, 3], [3, u + 0.3, 7], false); };
  const r = await Promise.all(RATES.map(async (fps) => walk(build, fps, 6, { proneMin: 'opening' }, false)));
  ok(r.every((w) => w.laid === 0 && w.z < 3), `a crawlspace ${u} m, under the lying body and its skin: a wall, the body stops before it and never lies (laid ${r.map((w) => w.laid).join(', ')}, at z ${r.map((w) => w.z.toFixed(2)).join(', ')})`);
}
{
  const build = (p: Physics) => { ground(p, 0); box(p, [-3, 0.6, 3], [3, 0.9, 7], false); };
  for (const fps of RATES) {
    const w = await walk(build, fps, 4, { proneMin: 'opening' }, false, Number.NaN, 1_000_000);
    ok(w.laid === 0 && w.inside > 0 && /began inside something/.test(w.said), `@${fps}: a probe begun inside something answers nothing, says so and the body never lies down (${w.inside} such, "${w.said}")`);
  }
}

// ---- item 3b -----------------------------------------------------------------------------------------------------------------
const skin = MOVE_TUNE.headSkin;
// (Under 1.60 m the room is the crouched walk's head and its skin within a centimetre: the duck stoops as before where it is the clip's own or more.)
for (const [roof, want] of [[1.6, [2, 0]], [1.45, [1]], [1.35, [1]]] as const) {
  const build = (p: Physics) => { ground(p, 0); box(p, [-3, roof, 3], [3, roof + 0.3, 6], false); };
  for (const fps of RATES) {
    const w = await walk(build, fps, 6, { duckClip: 'clearance', duckHead: 'clear' }, true, roof);
    const worn = [...w.worn];
    ok(worn.length > 0 && worn.every((c) => (want as readonly number[]).includes(c)), `a beam ${roof} m @${fps}: the duck wears the ${want[0] === 2 ? 'crouched walk' : 'sneak walk'} under it (${worn.join('/')})`);
    ok(w.into <= 1e-3 - skin + 0.03, `a beam ${roof} m @${fps}: the worn clip's head stays under the beam by the skin (${(w.into * 100).toFixed(1)} cm over its underside at most)`);
    ok(w.laid === 0, `a beam ${roof} m @${fps}: walked under, never lain under (laid ${w.laid})`);
  }
}
for (const roof of [1.25, 1.1]) {
  const build = (p: Physics) => { ground(p, 0); box(p, [-3, roof, 3], [3, roof + 0.3, 6], false); };
  const r = await Promise.all(RATES.map(async (fps) => walk(build, fps, 8, { duckClip: 'clearance', duckHead: 'clear' }, true, roof)));
  ok(r.every((w) => w.laid >= 1), `a beam ${roof} m, under the sneak walk's head and its skin: lain under (laid ${r.map((w) => w.laid).join(', ')})`);
}
{
  const roof = 1.45;
  const build = (p: Physics) => { ground(p, 0); box(p, [-3, roof, 3], [3, roof + 0.3, 6], false); };
  const w = await walk(build, 60, 6, { duckClip: 'one', duckHead: 'clear' }, true, roof);
  ok([...w.worn].every((c) => c === 0), `'one': the duck wears the one crouch walk under a beam ${roof} m, as before (${[...w.worn].join('/')})`);
  const n = await walk(build, 60, 6, { duckClip: 'clearance', duckHead: 'clear' }, false, roof);
  ok([...n.worn].every((c) => c === 0), `'clearance' with no heads measured (no figure): the duck as before (${[...n.worn].join('/')})`);
}
// ---- the hand-overs only the game makes (the harness hands its heads over itself), pinned as text ------------------------------
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../../src/player/player.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  ok(/const heads = this\.shapeIn\.clipHeads;\n\s+heads\.fill\(Number\.NaN\);\n\s+for \(let cls = 1; cls <= 3; cls\+\+\) \{\n\s+const c = clipOfId\(CROUCH_CLIPS\[cls\]\);\n\s+if \(rig\.has\(c\)\) heads\[cls\] = rig\.posedHighest\(\[c\], DEEP_SAMPLES, measure\);/.test(src), "the player hands the duck every crouch clip's head by its class, measured on the rig (measureDeep)");
  ok(/if \(this\.shapeIn\.clipHeads\[2\] === this\.shapeIn\.clipHeads\[2\] && this\.deepRig !== rig\) this\.shapeIn\.clipHeads\.fill\(Number\.NaN\);/.test(src), 'and forgets them for another rig');
  ok(/this\.duck\.step\(this\.shape\.tall, [^\n]*this\.crouching, this\.shape\.duckCls\);/.test(src), "the duck's pace is handed the clip the shape wears (stepDuckPace)");
  ok(/lo\.crouchCls = this\.duck\.crouch && !this\.crouching \? this\.shape\.duckCls : 0;/.test(src), 'and the posture the same class while the duck crouches by itself, never under the crouch key');
  const harness = readFileSync(new URL('./grappleBody.ts', import.meta.url), 'utf8');
  ok(/this\.duck\.step\([^\n]*this\.shape\.duckCls\)/.test(harness), "the harness's mirror hands the duck's pace the same");
}
resetClimbTune();
resetMoveTune();
console.log(`smooth3Body: ${checks} checks passed`);
