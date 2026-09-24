// The cover search (src/world/cover.ts), against a real physics world.
//
// Nothing here is a mirror of the game's physics: a real rapier world is built, real boxes are put
// in it, and the search is asked the real question with real rays. That is the whole reason the
// module takes its physics as a struct of functions -- `src/core/physics.ts` and rapier both load
// under node, so a rule about where a body can hide can be **tried** rather than reasoned about.
//
// Six things are pinned and two are measured.
//
// **The two kinds are really two kinds.** A crate three quarters of a metre high answers crouch
// cover -- a shot aimed where shots are aimed at a body on one knee is stopped and one aimed at a
// standing body goes over -- and a wall answers hard cover, and the same search tells them apart
// with two rays and nothing else.
//
// **A body's tier really chooses between them.** The same two blockers, the same body, the same
// threat: with `hardCost` nought the nearer wall wins and with it at two the crate does, which is
// the whole of "how well it uses cover" as a number.
//
// **The heights are the hitbox's and cannot drift.** They are `aimPointFor('crouch')` and
// `aimPointFor('stand')` out of `fighterStance.ts`, so the test moves the hitbox with the game's own
// knob and watches a spot that was cover stop being cover. A cover search whose heights were
// literals would silently go on answering the old shape.
//
// **A spot you cannot walk to is not cover**, and the case that decides it is subtle: the blocker
// the spot stands behind is *allowed* to be in the way, because the spot is on the far side of it by
// construction, while anything nearer than that blocker's own face is a wall between the two. Both
// halves are driven here, with a low fence a body can shoot over and not walk through, with a cliff
// edge, and with the baked grid's own region ranks.
//
// **Indoors costs nothing at all**, which is measured as rays not cast rather than asserted.
//
// **And the budget holds**, so a squad that engages on one frame does not search on one frame.
//
// Then the two measurements the design asked for: what one search really costs, and how that scales
// with how crowded the world is. Both are node's rather than the browser's, which is said again
// where the numbers are printed.
//
// Synthetic throughout: every box, height and place below is written in this file. Nothing comes
// from the game's own archives.
import assert from 'node:assert/strict';
import { Physics, RAPIER } from '../../../src/core/physics.ts';
import { FIGHTER_BODY, aimPointFor, tuneFighterBody } from '../../../src/world/fighterStance.ts';
import {
  COVER_TUNE,
  CoverSearch,
  askFromSkill,
  coverHeights,
  coverSearch,
  tuneCover,
  type Blocker,
  type CoverAsk,
  type CoverDeps,
} from '../../../src/world/cover.ts';
import { skillOfGroundTier } from '../../../src/world/groundSkill.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;

await Physics.create();

/** A box on the ground: where its middle is in the plane, how wide and deep its footprint, how tall. */
interface Box {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
}

interface Scene {
  physics: Physics;
  deps: CoverDeps;
  /** How many rays the deps has been asked for, so a test can measure "none". */
  rays: () => number;
}

/**
 * A world: one ground slab and a list of boxes, stepped once, because a rapier scene query sees
 * nothing at all until the world has stepped.
 *
 * `slab` is the ground's own half-extents and middle, so a scene can have an edge to walk off.
 */
function scene(boxes: Box[], slab = { x: 60, z: 60, cx: 0, cz: 0 }): Scene {
  const physics = Physics.local();
  const world = physics.world;
  const ground = world.createCollider(RAPIER.ColliderDesc.cuboid(slab.x, 0.5, slab.z).setTranslation(slab.cx, -0.5, slab.cz));
  for (const b of boxes) world.createCollider(RAPIER.ColliderDesc.cuboid(b.w / 2, b.h / 2, b.d / 2).setTranslation(b.x, b.h / 2, b.z));
  physics.stepOnce();

  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  const centre = { x: 0, y: 0, z: 0 };
  const half = { x: 0, y: 0, z: 0 };
  const he = { x: 0, y: 0, z: 0 };
  let rays = 0;
  const deps: CoverDeps = {
    blockers(x: number, z: number, reach: number, out: Blocker[], cap: number): number {
      let n = 0;
      centre.x = x;
      centre.y = 4;
      centre.z = z;
      half.x = reach;
      half.y = 10;
      half.z = reach;
      // The ground is never a blocker. In the game the blockers come from the streamer's own placed
      // objects, so the terrain is not in the list to begin with; here it is one handle to skip.
      world.collidersWithAabbIntersectingAabb(centre, half, (c) => {
        if (c.handle === ground.handle) return true;
        if (n >= cap) return false;
        const e = c.halfExtents(he);
        if (!e) return true;
        const t = c.translation();
        const b = out[n++];
        b.x = t.x;
        b.z = t.z;
        b.radius = Math.max(e.x, e.z);
        b.topY = t.y + e.y;
        return true;
      });
      return n;
    },
    hit(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
      const dx = bx - ax;
      const dy = by - ay;
      const dz = bz - az;
      const len = Math.hypot(dx, dy, dz);
      if (!(len > 1e-6)) return Infinity;
      ray.origin.x = ax;
      ray.origin.y = ay;
      ray.origin.z = az;
      ray.dir.x = dx / len;
      ray.dir.y = dy / len;
      ray.dir.z = dz / len;
      rays++;
      const h = world.castRay(ray, len, true);
      return h ? h.timeOfImpact : Infinity;
    },
    floor(x: number, z: number, fromY: number, maxDrop: number): number {
      ray.origin.x = x;
      ray.origin.y = fromY;
      ray.origin.z = z;
      ray.dir.x = 0;
      ray.dir.y = -1;
      ray.dir.z = 0;
      rays++;
      const h = world.castRay(ray, maxDrop, true);
      return h ? fromY - h.timeOfImpact : Number.NaN;
    },
  };
  return { physics, deps, rays: () => rays };
}

/** An ask, written rather than built, exactly as a body keeps one. */
const ask: CoverAsk = { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, reach: 12, hardCost: 0, indoors: false };
const put = (bx: number, bz: number, tx: number, tz: number, reach = 12, hardCost = 0): CoverAsk => {
  ask.x = bx;
  ask.y = 0;
  ask.z = bz;
  ask.tx = tx;
  ask.ty = aimPointFor('stand');
  ask.tz = tz;
  ask.reach = reach;
  ask.hardCost = hardCost;
  ask.indoors = false;
  return ask;
};

/** A clock that moves on every call, so the per-step budget never turns a test away by accident. */
let clock = 0;
const tick = (): number => (clock += 1);

// --- 1: the two kinds ----------------------------------------------------------------------------

{
  const h = coverHeights();
  ok(h.low === aimPointFor('crouch') && h.stand === aimPointFor('stand'), `the two ray heights are the hitbox's own aim points (${h.low} m crouched, ${h.stand} m standing) and not literals of the search's`);

  const s = scene([{ x: 0, z: 0, w: 2, d: 2, h: 0.75 }]);
  const search = new CoverSearch();
  const spot = search.find(s.deps, put(0, 7, 0, -14), tick());
  ok(spot !== null, 'a body out in the open beside a low crate is given somewhere to stand');
  if (spot) {
    console.log(`     the spot: (${spot.x.toFixed(2)}, ${spot.y.toFixed(2)}, ${spot.z.toFixed(2)}), ${spot.kind}, ${spot.walk.toFixed(2)} m away, ${search.status().lastRays} rays`);
    ok(spot.kind === 'crouch', 'and a crate that is three quarters of a metre high is crouch cover: blocked where a kneeling body is aimed at, open where a standing one is');
    ok(spot.z > 0, 'the spot is on the far side of the crate from the threat, which is the whole idea');
    ok(near(spot.z, 1.55, 0.01), 'a body radius and a little air past the crate\'s own face');
    ok(near(spot.y, 0, 0.01), 'standing on the floor the search found under it rather than on the body\'s own height');
    ok(near(spot.walk, 7 - 1.55, 0.01), 'and the walk is the real distance to it');
  }

  // The same crate, with the hitbox moved: a crouched body aimed at 0.85 m is shot over the top of
  // a 0.75 m crate, so the spot is not cover any more and the search must say so.
  const was = FIGHTER_BODY.lowHalf;
  tuneFighterBody({ lowHalf: 0.5 });
  ok(coverHeights().low === aimPointFor('crouch') && coverHeights().low > 0.8, 'moving the crouched hitbox with the game\'s own knob moves the ray with it');
  ok(search.find(s.deps, put(0, 7, 0, -14), tick()) === null, 'and the crate stops being cover, because the search is asking about the body the game really shoots at');
  tuneFighterBody({ lowHalf: was });
  ok(search.find(s.deps, put(0, 7, 0, -14), tick()) !== null, 'and back again');

  const wall = scene([{ x: 0, z: 0, w: 3, d: 1, h: 2.2 }]);
  const hard = search.find(wall.deps, put(0, 7, 0, -14), tick());
  ok(hard !== null && hard.kind === 'hard', 'a wall over head height is hard cover: nothing reaches the body there and it cannot shoot back either');
}

// --- 2: the tier chooses between them ------------------------------------------------------------

{
  const s = scene([
    { x: 4, z: 5, w: 3, d: 1, h: 2.2 },
    { x: -4, z: 3, w: 3, d: 1, h: 0.75 },
  ]);
  const search = new CoverSearch();
  const greedy = search.find(s.deps, put(0, 10, 0, -20, 12, 0), tick());
  ok(greedy !== null && greedy.kind === 'hard' && greedy.x > 0, 'a body that cannot tell a firing position from a hole takes the nearest thing to stand behind, which here is the wall');
  const wise = search.find(s.deps, put(0, 10, 0, -20, 12, 2), tick());
  ok(wise !== null && wise.kind === 'crouch' && wise.x < 0, 'and a body whose tier is worth two metres of extra walk goes past it to the crate it can shoot back from');
  if (greedy && wise) console.log(`     greedy ${greedy.walk.toFixed(2)} m to the wall; wise ${wise.walk.toFixed(2)} m to the crate`);

  const ask5 = askFromSkill(put(0, 10, 0, -20), skillOfGroundTier(5));
  ok(ask5.hardCost === skillOfGroundTier(5).hardCost && ask5.reach === Math.min(COVER_TUNE.reach, skillOfGroundTier(5).coverWalk), 'the bridge from a tier to an ask is the two numbers and nothing else');
  const ask1 = askFromSkill(put(0, 10, 0, -20), skillOfGroundTier(1));
  ok(ask1.reach === skillOfGroundTier(1).coverWalk && ask1.reach < COVER_TUNE.reach, 'and a tier-1 body looks over less ground than the search is ever allowed to, so it is cheaper as well as worse');
  ok(search.find(s.deps, askFromSkill(put(0, 10, 0, -20), skillOfGroundTier(1)), tick()) === null, 'which is why it stands there in the open with cover six metres away it will not walk to');

  // The cap is applied where the distances are known, not by whoever fills the list: a filler that
  // hands the far blocker over first must not cost the body the near one.
  const backwards: CoverDeps = {
    ...s.deps,
    blockers(x: number, z: number, reach: number, out: Blocker[], cap: number): number {
      const n = s.deps.blockers(x, z, reach, out, cap);
      for (let i = 0, j = n - 1; i < j; i++, j--) {
        const t = out[i];
        out[i] = out[j];
        out[j] = t;
      }
      return n;
    },
  };
  const one = new CoverSearch();
  const solo = { ...COVER_TUNE, maxBlockers: 1 };
  const straight = one.find(s.deps, put(0, 10, 0, -20, 12, 0), tick(), solo);
  const ax = straight?.x ?? Number.NaN;
  const az = straight?.z ?? Number.NaN;
  const flipped = one.find(backwards, put(0, 10, 0, -20, 12, 0), tick(), solo);
  ok(straight !== null && flipped !== null && flipped.x === ax && flipped.z === az, 'and with room for one blocker only, the nearest is the one taken whichever order the filler hands them over in');
}

// --- 3: nothing to hide behind -------------------------------------------------------------------

{
  const empty = scene([]);
  const search = new CoverSearch();
  ok(search.find(empty.deps, put(0, 7, 0, -14), tick()) === null, 'out on open ground there is no cover and the search says so');
  ok(search.status().none === 1 && search.status().found === 0, 'and counts it as a look that found nothing rather than as a failure');

  const low = scene([{ x: 0, z: 0, w: 2, d: 2, h: 0.4 }]);
  const before = low.rays();
  ok(search.find(low.deps, put(0, 7, 0, -14), tick()) === null, 'a kerb four tenths of a metre high is not cover');
  ok(low.rays() === before, 'and costs no ray at all: a blocker too short for a crouched body is thrown out on its own height');

  const thin = scene([{ x: 0, z: 0, w: 0.3, d: 0.3, h: 2.5 }]);
  const before2 = thin.rays();
  ok(search.find(thin.deps, put(0, 7, 0, -14), tick()) === null, 'nor is a post narrower than the body that would hide behind it');
  ok(thin.rays() === before2, 'and that costs no ray either');
}

// --- 4: indoors ----------------------------------------------------------------------------------

{
  const s = scene([{ x: 0, z: 0, w: 2, d: 2, h: 0.75 }]);
  const search = new CoverSearch();
  const before = s.rays();
  const inside = put(0, 7, 0, -14);
  inside.indoors = true;
  ok(search.find(s.deps, inside, tick()) === null, 'inside a building the search answers none');
  ok(s.rays() === before, 'and casts nothing: the props in there are not colliders, so a spot behind one would stop no bolts');
  ok(search.status().indoor === 1 && search.status().none === 0, 'and it is counted apart, because it means something quite different from looking and finding nothing');
}

// --- 5: a spot you cannot walk to ----------------------------------------------------------------

{
  // The body on the threat's own side of the crate: the spot is behind it, and walking there means
  // walking round the crate. The crate must not refuse its own spot.
  const s = scene([{ x: 0, z: 0, w: 2, d: 2, h: 0.75 }]);
  const search = new CoverSearch();
  const round = search.find(s.deps, put(0, -6, 0, -14), tick());
  ok(round !== null && round.z > 0, 'a body on the threat\'s side of a crate is sent round behind it: the crate itself is never taken for a wall in the way');

  // A low fence between the two. It is too short to be cover (nothing is fanned behind it) and tall
  // enough to stop a body walking, which is exactly the shape that must refuse the crate's spot.
  const fenced = scene([
    { x: 0, z: 0, w: 2, d: 2, h: 0.75 },
    { x: 0, z: -3, w: 24, d: 0.3, h: 0.55 },
  ]);
  ok(search.find(fenced.deps, put(0, -6, 0, -14), tick()) === null, 'put a fence between the body and that crate and the spot is refused: something nearer than the crate\'s own face is a wall');

  // A cliff: the ground runs out before the spot does.
  const cliff = scene([{ x: 0, z: 2.2, w: 2, d: 2, h: 0.75 }], { x: 60, z: 23, cx: 0, cz: -20 });
  ok(search.find(cliff.deps, put(0, -6, 0, -14), tick()) === null, 'and a spot out past the edge of the ground is refused, because there is nothing under it to stand on');

  // The baked grid's own ranks: the one thing that can say a place is on ground this ground is not
  // joined to at all, which neither ray can see.
  const walled: CoverDeps = { ...s.deps, sameGround: (_ax: number, _az: number, _bx: number, bz: number): boolean => bz < 0 };
  ok(search.find(walled, put(0, -6, 0, -14), tick()) === null, 'and a grid that says the far side is another walkable region refuses it, which no ray could have told');
  ok(search.find(s.deps, put(0, -6, 0, -14), tick()) !== null, 'with no grid at all the two rays are the whole answer and the body goes');
}

// --- 6: the budget -------------------------------------------------------------------------------

{
  const s = scene([{ x: 0, z: 0, w: 2, d: 2, h: 0.75 }]);
  const search = new CoverSearch();
  const step = tick();
  let ran = 0;
  for (let i = 0; i < 6; i++) if (search.find(s.deps, put(0, 7, 0, -14), step) !== null) ran++;
  ok(ran === COVER_TUNE.perStep, `only ${COVER_TUNE.perStep} of six bodies searched on one step, which is the budget`);
  ok(search.status().deferred === 6 - COVER_TUNE.perStep, 'and the rest were put off rather than answered wrongly');
  ok(search.find(s.deps, put(0, 7, 0, -14), tick()) !== null, 'the next step lets them in again');

  const a = search.find(s.deps, put(0, 7, 0, -14), tick());
  const b = search.find(s.deps, put(0, 7, 0, -14), tick());
  ok(a !== null && a === b, 'the answer is one kept object, refilled: a search allocates nothing for a body to hold');
}

// --- 7: the knob ---------------------------------------------------------------------------------

{
  ok(tuneCover({ reach: 20 }).reach === 20, 'the search\'s numbers move live');
  ok(tuneCover({ maxBlockers: 999 }).maxBlockers === 24, 'a count past what the scratch holds is capped rather than taken, since a buffer that overflowed would count spots it does not hold');
  ok(tuneCover({ spots: 99 }).spots === 7, 'and so is the fan');
  ok(tuneCover({ reach: Number.NaN }).reach === 20, 'anything that is not a finite number is left alone');
  tuneCover({ reach: 12, maxBlockers: 6, spots: 3 });
  ok(COVER_TUNE.reach === 12 && COVER_TUNE.maxBlockers === 6 && COVER_TUNE.spots === 3, 'and back to the shipped numbers for the measurements below');
  ok(coverSearch.tune === COVER_TUNE, 'the one shared searcher reads the same table, so the knob reaches every body at once');
}

// --- 8: what it costs, measured ------------------------------------------------------------------
//
// A town of boxes, drawn from one seed so the numbers are the same on every machine, and a body put
// down at random in it with something shooting at it from twenty-five metres away. Node's figures,
// on this machine, not the browser's: a ray in the browser's own host has never been timed and the
// design says as much.

let seed = 0x2545f491;
const rnd = (): number => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000;
};

/** A square of props: waist-high crates, chest-high blocks and walls, the mix a camp or a street is. */
function town(n: number, span: number): Box[] {
  const out: Box[] = [];
  for (let i = 0; i < n; i++) {
    const kind = rnd();
    const h = kind < 0.45 ? 0.7 + rnd() * 0.4 : kind < 0.8 ? 1.2 + rnd() * 0.8 : 2.5 + rnd() * 3.5;
    const w = 0.8 + rnd() * 3.2;
    const d = 0.8 + rnd() * 3.2;
    out.push({ x: (rnd() - 0.5) * span, z: (rnd() - 0.5) * span, w, d, h });
  }
  return out;
}

interface Measured {
  found: number;
  crouch: number;
  rays: number;
  cands: number;
  blockers: number;
  us: number;
}

/** Somewhere a body could really be standing: on the ground, not on top of a crate or inside one. */
function stand(s: Scene, span: number): { x: number; z: number } {
  for (let i = 0; i < 40; i++) {
    const x = (rnd() - 0.5) * span;
    const z = (rnd() - 0.5) * span;
    if (Math.abs(s.deps.floor(x, z, 8, 12)) < 0.2) return { x, z };
  }
  return { x: 0, z: 0 };
}

function measure(s: Scene, runs: number, span: number, reach: number, hardCost = 0): Measured {
  const search = new CoverSearch();
  // A wide budget: this is measuring what one search costs, not what the budget lets through.
  const was = COVER_TUNE.perStep;
  tuneCover({ perStep: 1e6 });
  // Warm the engine's own paths before the clock starts, or the first dozen searches are the JIT's.
  for (let i = 0; i < 200; i++) {
    const p = stand(s, span);
    search.find(s.deps, put(p.x, p.z, p.x + 25, p.z, reach, hardCost), tick());
  }
  search.forget();
  // The bodies are drawn first, so the clock below times the search and not the drawing.
  const spots: number[] = [];
  for (let i = 0; i < runs; i++) {
    const p = stand(s, span);
    const a = rnd() * Math.PI * 2;
    spots.push(p.x, p.z, p.x + Math.cos(a) * 25, p.z + Math.sin(a) * 25);
  }
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) search.find(s.deps, put(spots[i * 4], spots[i * 4 + 1], spots[i * 4 + 2], spots[i * 4 + 3], reach, hardCost), tick());
  const ms = performance.now() - t0;
  const st = search.status();
  tuneCover({ perStep: was });
  return { found: st.found / runs, crouch: st.crouch / Math.max(1, st.found), rays: st.rays / runs, cands: st.candidates / runs, blockers: st.blockers / runs, us: (ms * 1000) / runs };
}

{
  const SPAN = 120;
  const RUNS = 4000;
  console.log('\n  How one search scales with how crowded the world is (reach 12 m, six blockers by three spots):');
  console.log('  props | offered  | candidates | rays | found | of those crouch |   us | ms for ten bodies');
  console.log('  ------+----------+------------+------+-------+-----------------+------+------------------');
  const costs: number[] = [];
  const founds: number[] = [];
  for (const n of [0, 50, 200, 800]) {
    const s = scene(town(n, SPAN), { x: SPAN, z: SPAN, cx: 0, cz: 0 });
    const m = measure(s, RUNS, SPAN, 12);
    costs.push(m.us);
    founds.push(m.found);
    console.log(`  ${String(n).padStart(5)} |   ${m.blockers.toFixed(2).padStart(6)} |   ${m.cands.toFixed(2).padStart(8)} | ${m.rays.toFixed(1).padStart(4)} | ${(m.found * 100).toFixed(0).padStart(4)}% |     ${(m.crouch * 100).toFixed(0).padStart(11)}% | ${m.us.toFixed(1).padStart(4)} | ${((m.us * 10) / 1000).toFixed(3)}`);
  }
  ok(founds[0] === 0, 'an empty world offers nothing, every time');
  ok(founds[1] > 0.5 && founds[2] > founds[1], 'and the more there is standing about the more often a body finds somewhere to stand');
  ok(founds[2] > 0.9 && founds[3] > 0.9, 'in a town it is nearly every time -- which it was not until the nearest blockers were kept rather than whichever the broad phase walked first, a change worth eight points of this figure at a wide reach and twenty-five in a crowd');
  const worst = Math.max(...costs);
  ok(worst < 250, `the dearest search measured is ${worst.toFixed(1)} us, so ten bodies landing on one frame is ${((worst * 10) / 1000).toFixed(2)} ms and the budget of ${COVER_TUNE.perStep} caps it at ${((worst * COVER_TUNE.perStep) / 1000).toFixed(2)} ms`);
  ok(costs[3] < costs[1] * 6, `and it is nearly flat in how crowded the world is (${costs[1].toFixed(1)} us at fifty props against ${costs[3].toFixed(1)} us at eight hundred), because the cost is the rays and a ray is not`);

  // What a tier's `hardCost` really buys, over four thousand searches rather than over the one
  // hand-built pair above: how much of the cover a body takes is cover it can shoot back out of.
  console.log('\n  What a tier\'s hardCost does to the cover a body actually takes (200 props, reach 12):');
  console.log('  hardCost | found | of those crouch |   us');
  console.log('  ---------+-------+-----------------+------');
  const mix = scene(town(200, SPAN), { x: SPAN, z: SPAN, cx: 0, cz: 0 });
  const crouchShare: number[] = [];
  for (const cost of [0, 3, 8]) {
    const m = measure(mix, RUNS, SPAN, 12, cost);
    crouchShare.push(m.crouch);
    console.log(`  ${String(cost).padStart(8)} |  ${(m.found * 100).toFixed(0).padStart(3)}% |     ${(m.crouch * 100).toFixed(0).padStart(11)}% |   ${m.us.toFixed(1)} us`);
  }
  ok(crouchShare[2] > crouchShare[0] * 1.5, `a tier that is worth eight metres of extra walk takes crouch cover ${(crouchShare[2] * 100).toFixed(0)}% of the time against ${(crouchShare[0] * 100).toFixed(0)}% for one that cannot tell -- which is "how well it uses cover" as one number`);

  console.log('\n  And with the reach and the fan moved (200 props):');
  console.log('  reach | blockers x spots | candidates | rays |   us | found');
  console.log('  ------+------------------+------------+------+------+------');
  const dense = scene(town(200, SPAN), { x: SPAN, z: SPAN, cx: 0, cz: 0 });
  for (const [reach, blockers, spots] of [
    [6, 6, 3],
    [12, 4, 2],
    [12, 6, 3],
    [12, 8, 3],
    [12, 6, 5],
    [20, 8, 3],
  ] as [number, number, number][]) {
    tuneCover({ reach, maxBlockers: blockers, spots });
    const m = measure(dense, RUNS, SPAN, reach);
    console.log(`  ${String(reach).padStart(5)} |      ${blockers} x ${spots}         |   ${m.cands.toFixed(2).padStart(8)} | ${m.rays.toFixed(1).padStart(4)} | ${m.us.toFixed(1).padStart(4)} | ${(m.found * 100).toFixed(0).padStart(3)}%`);
  }
  tuneCover({ reach: 12, maxBlockers: 6, spots: 3 });
  ok(COVER_TUNE.reach === 12, 'the shipped numbers are back');
}

console.log(`\n${checks} checks passed`);
