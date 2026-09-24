// The long walk (`src/world/errand.ts`): the order, and the account that refuses to flatter it.
//
// Nothing here loads a pack, a rig or a physics world. The body is a struct this file drives by
// hand, so every answer below is one somebody can check by reading it -- which is the point, since
// the whole of this wave is an instrument for judging the next one and an instrument nobody can
// check is worth nothing.
//
// Two of the checks are not about this file at all and are the most important ones in it. The first
// drives the creatures' own `decide` with a moved home and a hostile standing on top of the body,
// and proves that rule 1 really is the order -- which is the claim the whole design rests on and
// the reason `brain.ts` is never opened. The second reads `layoutStream.ts`, `world.ts` and
// `terrain.ts` as text and fails if the two distances the verdict is made of have drifted from the
// running game's own, because an instrument whose idea of the streaming bubble is stale is one that
// says "arrived" about a body that walked through a mesa.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BRAIN_TUNE, decide, type BrainSelf, type BrainTarget } from '../../../src/world/mobiles/brain.ts';
import { ERRAND_TUNE, Errand, newErrandProbe, tuneErrand, type ErrandBody, type ErrandProbe, type ErrandWorld } from '../../../src/world/errand.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;
const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

/**
 * A body the test walks by hand. The only things the order ever touches are its two home numbers
 * and its state, and it starts in `idle` precisely so that the third of those writes is visible
 * rather than being the value it happened to hold already.
 */
class Walker implements ErrandBody {
  key = 7;
  label = 'test fighter';
  homeX = 0;
  homeZ = 0;
  x = 0;
  y = 0;
  z = 0;
  heading = 0;
  state = 'idle';
  held = 1;
  asking = true;
  stuck = 0;
  lifted = 0;
  liftedBy = 0;
  hp = 160;
  dead = false;
  plans = 0;
  failures = 0;

  holdReturn(): void {
    if (this.dead) return;
    this.state = 'return';
  }

  probe(out: ErrandProbe): void {
    out.x = this.x;
    out.y = this.y;
    out.z = this.z;
    out.heading = this.heading;
    out.state = this.state;
    out.held = this.held;
    out.asking = this.asking;
    out.stuck = this.stuck;
    out.lifted = this.lifted;
    out.liftedBy = this.liftedBy;
    out.grounded = true;
    out.inside = false;
    out.hp = this.hp;
    out.dead = this.dead;
    out.plans = this.plans;
    out.failures = this.failures;
  }
}

interface FakeWorld extends ErrandWorld {
  at(x: number, z: number): void;
  depth: number;
}

/** The world a walk is measured against: where the player stands, and how deep the water is. */
function fakeWorld(): FakeWorld {
  const w: FakeWorld = {
    playerX: 0,
    playerZ: 0,
    playerKnown: true,
    syncGrids: 0,
    depth: -5,
    at(x: number, z: number): void {
      w.playerX = x;
      w.playerZ = z;
    },
    waterOver(): number {
      return w.depth;
    },
  };
  return w;
}

/** Where the walk's clock stands: before the first step that is the moment the order was given. */
function clockOf(e: Errand): number {
  return e.startedAt + e.seconds;
}

/**
 * Step a body toward a point at `speed`, `dt` at a time, with the player riding `behind` metres back
 * along the line it is walking (Infinity: nobody follows, and the player stays at `parked`).
 */
function walk(e: Errand, b: Walker, w: FakeWorld, opts: { to: { x: number; z: number }; speed: number; dt: number; steps: number; behind: number; parked: number }): void {
  let now = clockOf(e);
  for (let i = 0; i < opts.steps && !e.done; i++) {
    now += opts.dt;
    const dx = opts.to.x - b.x;
    const dz = opts.to.z - b.z;
    const len = Math.hypot(dx, dz);
    const step = Math.min(len, opts.speed * opts.dt);
    if (len > 1e-9) {
      b.x += (dx / len) * step;
      b.z += (dz / len) * step;
      // A body walks the way it is pointing, which is the one number the track reads as steering.
      b.heading = Math.atan2(dx, dz);
    }
    if (Number.isFinite(opts.behind)) {
      const bl = Math.hypot(b.x - opts.to.x, b.z - opts.to.z);
      const ux = bl > 1e-9 ? (b.x - opts.to.x) / bl : 1;
      const uz = bl > 1e-9 ? (b.z - opts.to.z) / bl : 0;
      w.at(b.x + ux * opts.behind, b.z + uz * opts.behind);
    } else w.at(opts.parked, 0);
    e.step(now, w);
  }
}

// ---------------------------------------------------------------------------
// 1. The order really is the brain's own first rule: nothing distracts a body whose home has moved.
// ---------------------------------------------------------------------------
{
  const self: BrainSelf = {
    key: 2,
    x: 0,
    y: 0,
    z: 0,
    heading: 0,
    homeX: 4801,
    homeZ: 0,
    side: 'fighter',
    aggression: 'aggressive',
    inside: false,
    big: false,
    reach: 1.9,
    ranged: 22,
    melee: false,
    halfHeight: 0.9,
    hpRatio: 1,
    state: 'idle',
    targetKey: null,
    stuck: 0,
    now: 100,
    wanderAt: 0,
    goal: null,
    until: 0,
    blockedSince: null,
    forgetKey: null,
    forgetUntil: 0,
  };
  // Somebody hostile standing on top of it, who hurt it a moment ago and could be shot this instant.
  const foe: BrainTarget = { key: 1, x: 1, y: 0, z: 1, halfHeight: 0.9, radius: 0.7, side: 'player', aggression: 'aggressive', dead: false, attackedMeAt: 99.5, hasLine: true };
  const d = decide(self, [foe], BRAIN_TUNE, () => 0.5);
  ok(d.state === 'return', 'a body whose home has moved answers "return" with a hostile standing on it');
  ok(d.pace === 'run', 'and runs');
  ok(d.targetKey === null, 'and takes no target');
  ok(d.clearMemory === true, 'and forgets who hurt it');
  ok(!!d.moveTo && near(d.moveTo.x, 4801) && near(d.moveTo.z, 0), 'and walks at the new home, which is the destination');

  const there: BrainSelf = { ...self, x: 4801 - BRAIN_TUNE.home * 0.5, state: 'return' };
  ok(decide(there, [], BRAIN_TUNE, () => 0.5).state !== 'return', `inside ${BRAIN_TUNE.home} m of the new home it stops running home`);
  const nearly: BrainSelf = { ...self, x: 4801 - BRAIN_TUNE.home * 2, state: 'return' };
  ok(decide(nearly, [], BRAIN_TUNE, () => 0.5).state === 'return', 'and outside it, it is still going');

  // Rule 1 is two clauses and the order needs both, which is the thing it is easiest to get wrong.
  // Since the home *is* the destination, `fromHome > leash` says only "the destination is further
  // off than the leash": an order to anything in sight never fires it, and the body falls through to
  // the wander rule and potters about its new neighbourhood -- an order that silently does nothing.
  // The second clause is what carries such an order, and the last stretch of every long one.
  const short: BrainSelf = { ...self, homeX: BRAIN_TUNE.leash / 2, homeZ: 0, x: 0, state: 'idle' };
  ok(decide(short, [], BRAIN_TUNE, () => 0.5).state !== 'return', `an order ${BRAIN_TUNE.leash / 2} m off never fires the leash, because the leash is ${BRAIN_TUNE.leash} m`);
  const held: BrainSelf = { ...short, state: 'return' };
  const hd = decide(held, [], BRAIN_TUNE, () => 0.5);
  ok(hd.state === 'return' && hd.pace === 'run', 'with the return state held it runs at it anyway');
  ok(!!hd.moveTo && near(hd.moveTo.x, BRAIN_TUNE.leash / 2), 'and at the destination, which is what makes a short order work at all');
  ok(decide({ ...self, homeX: 1, homeZ: 0, x: 0, state: 'return' }, [], BRAIN_TUNE, () => 0.5).state !== 'return', `and inside ${BRAIN_TUNE.home} m even the held state lets go, so an arrival is still the brain's own`);
}

// ---------------------------------------------------------------------------
// 2. The two distances the verdict is made of are the running game's, not ours.
// ---------------------------------------------------------------------------
{
  const stream = src('../../../src/world/layoutStream.ts');
  const world = src('../../../src/world/world.ts');
  const terrain = src('../../../src/world/terrain.ts');
  const colliderRange = Number(/const COLLIDER_RANGE = (\d+)/.exec(stream)?.[1]);
  const physicsRadius = Number(/const PHYSICS_RADIUS = (\d+)/.exec(world)?.[1]);
  const chunk = Number(/export const CHUNK_SIZE = (\d+)/.exec(terrain)?.[1]);
  ok(Number.isFinite(colliderRange) && Number.isFinite(physicsRadius) && Number.isFinite(chunk), 'the three numbers are still spelled the way this test reads them');
  ok(ERRAND_TUNE.objectsWithin === colliderRange, `objectsWithin is layoutStream's own COLLIDER_RANGE (${colliderRange} m)`);
  ok(ERRAND_TUNE.terrainWithin === physicsRadius * chunk, `terrainWithin is PHYSICS_RADIUS x CHUNK_SIZE (${physicsRadius} x ${chunk} = ${physicsRadius * chunk} m)`);
  tuneErrand({ objectsWithin: 100000, terrainWithin: 100000 });
  ok(ERRAND_TUNE.objectsWithin === colliderRange && ERRAND_TUNE.terrainWithin === physicsRadius * chunk, 'and neither can be typed over from the console');
}

// ---------------------------------------------------------------------------
// 3. Giving the order moves the home; every step re-asserts it; ending never puts it back.
// ---------------------------------------------------------------------------
{
  const b = new Walker();
  const w = fakeWorld();
  const e = new Errand(b, { x: 300, z: 0, place: 'somewhere' }, 0, 5.2);
  e.begin(w);
  ok(b.homeX === 300 && b.homeZ === 0, 'the order moves the home onto the destination');
  ok(b.state === 'return', 'and puts the body on the way home, which is the clause that carries it inside the leash');
  b.homeX = -999;
  b.homeZ = -999;
  b.state = 'wander';
  e.step(0.1, w);
  ok(b.homeX === 300 && b.homeZ === 0, 'and a home moved under it is put back on the next step');
  ok(b.state === 'return', 'and so is a state moved under it, so nothing can quietly lift an order half way');
  ok(near(e.straight, 300), 'the straight line is measured from where the body stood');
  b.x = 150;
  e.step(0.2, w);
  e.finish('stopped', 5);
  ok(near(b.homeX, 150) && near(b.homeZ, 0), 'ending the order leaves home where the body stands');
  ok(b.homeX !== e.wasHomeX && b.homeX !== 300, 'never back at the start (the leash would fire and run it home) and no longer at the destination');
  ok(e.verdict === 'stopped by hand', 'and the verdict says a hand stopped it, not that anything was learned');
}

// ---------------------------------------------------------------------------
// 4. A walk taken beside the player is a result; the same walk taken alone is not.
// ---------------------------------------------------------------------------
{
  const b = new Walker();
  const w = fakeWorld();
  const e = new Errand(b, { x: 600, z: 0 }, 0, 5.2);
  e.begin(w);
  walk(e, b, w, { to: { x: 600, z: 0 }, speed: 5.2, dt: 0.25, steps: 2000, behind: 20, parked: 0 });
  ok(e.done && e.ended === 'arrived', 'it arrives');
  ok(e.proved, 'with the player twenty metres behind, every sample is inside the bubble');
  ok(e.verdict === 'arrived', 'and the verdict is the word "arrived"');
  ok(near(e.report().detour as number, 1, 0.02), 'it walked the straight line, so the detour is 1.00');
}
{
  const b = new Walker();
  const w = fakeWorld();
  const e = new Errand(b, { x: 600, z: 0 }, 0, 5.2);
  e.begin(w);
  // Nobody follows: the player stays at the start and the body walks out of the bubble.
  walk(e, b, w, { to: { x: 600, z: 0 }, speed: 5.2, dt: 0.25, steps: 2000, behind: Infinity, parked: 0 });
  ok(e.done && e.ended === 'arrived', 'the same walk taken alone also arrives');
  ok(!e.proved, 'but most of its samples were taken where nothing could stop it');
  ok(e.verdict === 'inconclusive', 'so the run refuses to call itself an arrival');
  ok(/Inconclusive/.test(e.why()), 'and says so in words rather than in a flag');
  const s = e.report().samples as { all: number; nothing: number; taken: number };
  ok(s.taken > 0 && s.nothing > s.all, 'the three buckets are counted and most of them are "nothing"');
}

// ---------------------------------------------------------------------------
// 5. The clocks: a body that leans for ever, and a body that is merely slow.
// ---------------------------------------------------------------------------
{
  const b = new Walker();
  const w = fakeWorld();
  const e = new Errand(b, { x: 4801, z: 0 }, 0, 5.2);
  e.begin(w);
  walk(e, b, w, { to: { x: 4801, z: 0 }, speed: 5.2, dt: 0.25, steps: Math.round(400 / (5.2 * 0.25)), behind: 20, parked: 0 });
  ok(!e.done, 'four hundred metres in, still walking');
  const wedgedAt = b.x;
  b.held = 0;
  let now = clockOf(e);
  for (let i = 0; i < 4000 && !e.done; i++) {
    now += 0.25;
    w.at(b.x - 20, 0);
    e.step(now, w);
  }
  ok(e.done && e.ended === 'stalled', `a body that stops making ground gives up after ${ERRAND_TUNE.stallSeconds} s`);
  ok(near(b.x, wedgedAt), 'where it wedged');
  const r = e.report() as { firstHeld: { t: number; left: number } | null };
  ok(!!r.firstHeld, 'and the report names where it first stopped getting through');
  ok(r.firstHeld !== null && r.firstHeld.left > 4000, 'with how far it still had to go');
  ok(/no side-step/.test(e.why()), 'and says why nothing freed it');
}
{
  // The other kind of stall, and the one the words used to get wrong: a body that stops closing on
  // the destination without ever leaning on anything. `firstHeld` is the only evidence of a wedge
  // there is, so with none of it the report must say what it measured and not name a cause.
  const b = new Walker();
  const w = fakeWorld();
  const e = new Errand(b, { x: 4801, z: 0 }, 0, 5.2);
  e.begin(w);
  walk(e, b, w, { to: { x: 4801, z: 0 }, speed: 5.2, dt: 0.25, steps: 200, behind: 20, parked: 0 });
  b.asking = false;
  let now = clockOf(e);
  for (let i = 0; i < 4000 && !e.done; i++) {
    now += 0.25;
    w.at(b.x - 20, 0);
    e.step(now, w);
  }
  ok(e.done && e.ended === 'stalled', 'a body that stops making ground without leaning still ends the order');
  ok(e.report().firstHeld === null, 'and nothing is recorded as where it stopped getting through');
  ok(!/no side-step/.test(e.why()), 'so the words do not blame the missing side-step');
  ok(/not a wedge/.test(e.why()), 'and say outright that this is not a wedge');
}
{
  // Three of the account's numbers are counters the body has kept since it was stood. A walk must
  // print its own share of them or the report's own "these must stay 0" is only true of a body
  // nothing has ever happened to.
  const b = new Walker();
  const w = fakeWorld();
  b.stuck = 4;
  b.lifted = 2;
  b.liftedBy = 1.7;
  const e = new Errand(b, { x: 600, z: 0 }, 0, 5.2);
  e.begin(w);
  walk(e, b, w, { to: { x: 600, z: 0 }, speed: 5.2, dt: 0.25, steps: 100, behind: 20, parked: 0 });
  const mid = e.report() as { stuck: number; lifted: number; liftedBy: number };
  ok(mid.stuck === 0 && mid.lifted === 0, 'a body stuck and lifted before the order hands none of that to the walk');
  ok(mid.liftedBy === 0, 'and the size of that old lift is not printed beside a clean run');
  b.stuck = 5;
  b.lifted = 3;
  b.liftedBy = 0.4;
  walk(e, b, w, { to: { x: 600, z: 0 }, speed: 5.2, dt: 0.25, steps: 2000, behind: 20, parked: 0 });
  const r = e.report() as { stuck: number; lifted: number; liftedBy: number };
  ok(r.stuck === 1 && r.lifted === 1, 'and what happens during the walk is counted, once each');
  ok(near(r.liftedBy, 0.4), 'with the size of the lift this walk really caused');
}
{
  // Which clause is holding the order is on the account, because the two hold for different reasons
  // and a reader who does not know that cannot tell a refused order from a carried one.
  const w = fakeWorld();
  const far = new Errand(new Walker(), { x: 600, z: 0 }, 0, 5.2);
  far.begin(w);
  ok(/leash/.test(String(far.report().carriedBy)), 'a long order says the leash is what carries it');
  const close = new Errand(new Walker(), { x: BRAIN_TUNE.leash / 2, z: 0 }, 0, 5.2);
  close.begin(w);
  ok(/return state/.test(String(close.report().carriedBy)), `and an order inside the ${BRAIN_TUNE.leash} m leash says it is the held return state`);
}
{
  const b = new Walker();
  const w = fakeWorld();
  const e = new Errand(b, { x: 50, z: 0 }, 0, 5.2);
  e.begin(w);
  ok(near(e.budget, ERRAND_TUNE.budgetFloor), 'a very short walk takes the floor as its budget, not a share of nothing');
}
{
  const b = new Walker();
  const w = fakeWorld();
  const e = new Errand(b, { x: 200, z: 0 }, 0, 5.2);
  e.begin(w);
  ok(near(e.budget, (200 / 5.2) * ERRAND_TUNE.budgetShare, 1e-6), 'a longer one takes a share of the straight line at the body\'s own run speed');
  // Creeping at a tenth of the run speed it never stops making ground, so only the clock ends it.
  walk(e, b, w, { to: { x: 200, z: 0 }, speed: 0.52, dt: 0.25, steps: 4000, behind: 20, parked: 0 });
  ok(e.done && e.ended === 'spent', 'a body that keeps creeping is ended by the budget and not by the stall clock');
  ok(e.verdict === 'spent', 'and the verdict is that word, not an arrival');
}

// ---------------------------------------------------------------------------
// 6. What must be on the account: the track, the death, and the real detour.
// ---------------------------------------------------------------------------
{
  const b = new Walker();
  const w = fakeWorld();
  tuneErrand({ sampleEvery: 1, trackRows: 16 });
  const e = new Errand(b, { x: 600, z: 0 }, 0, 5.2);
  e.begin(w);
  ok(e.track().length === 1, 'the first row is taken the moment the order is given');
  walk(e, b, w, { to: { x: 600, z: 0 }, speed: 5.2, dt: 0.25, steps: 2000, behind: 20, parked: 0 });
  const rows = e.track();
  ok(rows.length === 16, 'the track stops at its cap rather than growing without end');
  const s = e.report().samples as { taken: number; rows: number; trackFull: boolean };
  ok(s.taken > s.rows && s.trackFull, 'and says that it was full, so no count is quietly short');
  ok(rows[0].t === 0 && rows[1].t === 1 && rows[2].t === 2, 'the rows are one simulated second apart');
  ok(rows.every((r) => r.solid === 'all'), 'each row says what was solid around the body at that moment');
  ok(rows[0].toGoal > rows[15].toGoal, 'and how far it still had to go');
  ok(rows.slice(1).every((r) => Math.abs(r.bearing) <= 1), 'and which way its nose was against the line to the goal');
  ok(Math.abs(rows[0].bearing) === 90, 'the first row is taken before it has turned, so its nose is still where it was stood');
  tuneErrand({ trackRows: 4096 });
}
{
  const b = new Walker();
  const w = fakeWorld();
  const e = new Errand(b, { x: 4801, z: 0 }, 0, 5.2);
  e.begin(w);
  walk(e, b, w, { to: { x: 4801, z: 0 }, speed: 5.2, dt: 0.25, steps: 400, behind: 20, parked: 0 });
  b.hp = 0;
  b.dead = true;
  e.step(clockOf(e) + 0.25, w);
  ok(e.done && e.ended === 'died', 'a body that dies on the way ends the walk as a death');
  ok(/does not fight back/.test(e.why()), 'and the words say why it could not defend itself');
  const hp = e.report().hp as { start: number; lowest: number };
  ok(hp.start === 160 && hp.lowest === 0, 'with the health it started and finished on');
}
{
  const b = new Walker();
  const w = fakeWorld();
  // A detour walks away from the goal for a minute, which is exactly what the stall clock is for,
  // so it is lifted for this one check rather than the check being written round it.
  tuneErrand({ stallSeconds: 600 });
  const e = new Errand(b, { x: 0, z: 400 }, 0, 5.2);
  e.begin(w);
  walk(e, b, w, { to: { x: 300, z: 0 }, speed: 5.2, dt: 0.25, steps: 400, behind: 20, parked: 0 });
  walk(e, b, w, { to: { x: 0, z: 400 }, speed: 5.2, dt: 0.25, steps: 800, behind: 20, parked: 0 });
  ok(e.done && e.ended === 'arrived', 'a body that goes round arrives');
  ok(near(e.report().travelled as number, 800, 3), 'the ground covered is summed every step, not between samples');
  ok(near(e.report().detour as number, 2, 0.02), 'so the detour is the real one: 2.00 for a 400 m line walked 800 m');
  tuneErrand({ stallSeconds: 45 });
}

// ---------------------------------------------------------------------------
// 7. Water is counted, because nothing in `npcs.ts` knows what it is.
// ---------------------------------------------------------------------------
{
  const b = new Walker();
  const w = fakeWorld();
  const e = new Errand(b, { x: 300, z: 0 }, 0, 5.2);
  e.begin(w);
  w.depth = 2;
  walk(e, b, w, { to: { x: 300, z: 0 }, speed: 5.2, dt: 0.25, steps: 2000, behind: 20, parked: 0 });
  const water = e.report().water as { wet: number; deep: number };
  ok(water.wet > 0 && water.deep === water.wet, 'a walk across a lake bed counts every sample as wet and as deep');
  ok((e.report().caveats as string[]).some((c) => /water/.test(c)), 'and the account carries the caveat that a fighter has no water sense');
  ok((e.report().caveats as string[]).some((c) => /side-step/.test(c)), 'and that it has no side-step');
  ok((e.report().caveats as string[]).some((c) => /fight back/.test(c)), 'and that it will not fight back');
  // The one that keeps the next wave readable: "inside the bubble" is not "everything was solid".
  ok((e.report().caveats as string[]).some((c) => /small props/.test(c)), 'and that small props and anything inside a building are never solid at any distance');
}
{
  // And that caveat is a claim about the running game, so it is read off it rather than asserted:
  // the streamer's collider loop skips a radius under its own floor and everything contained.
  const stream = src('../../../src/world/layoutStream.ts');
  ok(/const COLLIDER_MIN_RADIUS = /.test(stream), 'the streamer still has a minimum radius below which nothing is given collision');
  ok(/o\.contained \|\| o\.radius < COLLIDER_MIN_RADIUS/.test(stream), 'and still skips both that and everything a building contains, whatever the distance');
}

// ---------------------------------------------------------------------------
// 8. A walk with nobody to measure against is the worst case, not a free pass.
// ---------------------------------------------------------------------------
{
  const b = new Walker();
  const w = fakeWorld();
  w.playerKnown = false;
  const e = new Errand(b, { x: 300, z: 0 }, 0, 5.2);
  e.begin(w);
  walk(e, b, w, { to: { x: 300, z: 0 }, speed: 5.2, dt: 0.25, steps: 2000, behind: 20, parked: 0 });
  ok(!e.proved, 'with the player dead or gone, nothing says what was solid, so nothing is proved');
  const s = e.report().samples as { noPlayer: number; nothing: number };
  ok(s.noPlayer > 0 && s.nothing >= s.noPlayer, 'those samples are counted apart and read as the worst case');
  ok(e.track().every((r) => r.solid === 'no player'), 'and the track says so rather than printing a distance it does not have');
}

// The probe writes rather than builds: the struct handed in is the one filled.
{
  const b = new Walker();
  const p = newErrandProbe();
  b.x = 12;
  b.hp = 99;
  b.probe(p);
  ok(p.x === 12 && p.hp === 99, "a probe is written into the caller's own struct");
}

console.log(`\n${checks} checks passed`);
