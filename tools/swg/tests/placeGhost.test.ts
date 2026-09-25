// Placing a building by hand: where the ghost stands, whether it may, the grid under it, and the
// wheel and the turn buttons.
//
// Everything here is pure -- the ghost's own three.js half is the drawing and decides nothing -- so
// this runs the real rules. Where a world is converted it then runs them over the real ground and
// reports what a player would actually be allowed to do with a real house.
//
// Run: node tools/swg/tests/placeGhost.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GHOST_TUNE, ghostSpot, ghostVerdict, liftBy, outlineCells, turnBy, wheelReach, type GhostDeps } from '../../../src/world/placeGhost.ts';
import { HOUSE_TUNE, patchOfFootprint, type Footprint } from '../../../src/world/housePlace.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}

/** The Corellia medium house's real grid: three cells by four, of eight metres, origin one cell in. */
const HOUSE: Footprint = { width: 3, height: 4, pivotX: 1, pivotZ: 1, cellWidth: 8, cellHeight: 8 };
const HOUSE_ROWS = ['HFF', 'FFF', 'FFF', 'FFF'];

const flat = (h = 10): GhostDeps => ({ heightAt: () => h, waterAt: () => -Infinity, standing: () => [] });

// ---------------------------------------------------------------- where it stands

{
  // The yaw is a body's heading, whose forward is (sin, cos) -- the comment at player.ts's
  // `enemyNear` is the witness. The camera's yaw is the exact opposite of it, and reading one as
  // the other is what put the ghost behind the player's back rather than in front of them.
  const at = ghostSpot({ x: 0, z: 0 }, 0, 20);
  ok(Math.abs(at.x) < 1e-9 && Math.abs(at.z - 20) < 1e-9, 'facing heading 0 the ghost is down +z, which is where the body faces');
  const right = ghostSpot({ x: 0, z: 0 }, Math.PI / 2, 20);
  ok(Math.abs(right.x - 20) < 1e-6 && Math.abs(right.z) < 1e-6, 'and a quarter turn puts it down +x');
  for (const yaw of [0, 0.7, 1.9, -2.4, 3.9]) {
    const spot = ghostSpot({ x: 3, z: -8 }, yaw, 12);
    const along = (spot.x - 3) * Math.sin(yaw) + (spot.z + 8) * Math.cos(yaw);
    assert.ok(Math.abs(along - 12) < 1e-6, `at heading ${yaw} the ghost is a full 12 m in front, not behind`);
  }
  passed++;
  console.log('ok   and at every heading it is the whole reach in front of the body, never behind it');
}

{
  // Unlike the automatic spot, the patch's own offset is **not** taken off: the player is pointing
  // at where the building's origin goes, and the building hangs off that wherever its shape puts it.
  const a = ghostSpot({ x: 5, z: 5 }, 0, 10);
  ok(a.x === 5 && a.z === 15, 'the ghost goes exactly where it is pointed, however the building is shaped');
}

{
  ok(wheelReach(20, 1) === 22 && wheelReach(20, -1) === 18, 'a notch of the wheel moves it a step');
  ok(wheelReach(GHOST_TUNE.far, 10) === GHOST_TUNE.far, 'and it never goes further than the far');
  ok(wheelReach(GHOST_TUNE.near, -10) === GHOST_TUNE.near, 'nor nearer than the near');
}

{
  const one = turnBy(0, 1);
  ok(Math.abs(one - (GHOST_TUNE.turn * Math.PI) / 180) < 1e-9, 'a press of a turn button turns it by the step');
  ok(Math.abs(turnBy(0, -1) - (Math.PI * 2 - (GHOST_TUNE.turn * Math.PI) / 180)) < 1e-9, 'and the other way round the other way');
  ok(turnBy(0, 360 / GHOST_TUNE.turn) < 1e-9, 'a whole turn comes back to where it started');
  for (let i = -40; i < 40; i++) {
    const y = turnBy(0, i);
    assert.ok(y >= 0 && y < Math.PI * 2, `a turn of ${i} presses stays inside one turn`);
  }
  passed++;
  console.log('ok   and it is never outside one turn, however many presses');
}

// ---------------------------------------------------------------- whether it may stand there

{
  const v = ghostVerdict(patchOfFootprint(HOUSE), { x: 0, z: 0 }, 0, flat());
  ok(v.ok && v.why === null, 'level ground with nothing on it takes a house');
  ok(v.y === 10, 'and the ghost stands at the ground');
  ok(v.clear > 0, 'and says how much ground it keeps to itself');
}

{
  const sloped: GhostDeps = { heightAt: (x) => 10 + x * 0.5, waterAt: () => -Infinity, standing: () => [] };
  const v = ghostVerdict(patchOfFootprint(HOUSE), { x: 0, z: 0 }, 0, sloped);
  ok(!v.ok && !!v.why, 'a slope is refused, in words');
}

{
  const wet: GhostDeps = { heightAt: () => 10, waterAt: () => 12, standing: () => [] };
  const v = ghostVerdict(patchOfFootprint(HOUSE), { x: 0, z: 0 }, 0, wet);
  ok(!v.ok && v.why === 'that is under water', 'a lake bed is refused although its ground is perfectly level');
}

{
  const patch = patchOfFootprint(HOUSE);
  const busy: GhostDeps = { heightAt: () => 10, waterAt: () => -Infinity, standing: (x, z) => [{ x, z, radius: 5, template: 'object/x/shared_a_cantina.iff' }] };
  const v = ghostVerdict(patch, { x: 0, z: 0 }, 0, busy);
  ok(!v.ok && v.why === 'something is already standing there', 'and so is a spot something is already standing on');
}

{
  // What the ghost asks about is the middle of the **building**, not the point it is pointed at:
  // the patch's own offset turns with it, so what is in the way depends on which way you face.
  const patch = patchOfFootprint(HOUSE);
  const asked: { x: number; z: number }[] = [];
  const spy: GhostDeps = {
    heightAt: () => 10,
    waterAt: () => -Infinity,
    standing: (x, z) => {
      asked.push({ x, z });
      return [];
    },
  };
  ghostVerdict(patch, { x: 0, z: 0 }, 0, spy);
  ok(Math.abs(asked[0].z - patch.cz) < 1e-6, 'facing one way it asks about the ground the building really covers');
  asked.length = 0;
  ghostVerdict(patch, { x: 0, z: 0 }, Math.PI, spy);
  ok(Math.abs(asked[0].z + patch.cz) < 1e-6, 'and turned about, the other side of it');
}

// ---------------------------------------------------------------- the player's own lift

{
  ok(liftBy(0, 1) === GHOST_TUNE.rise, 'a press raises it by a step');
  ok(Math.abs(liftBy(0, -1) + GHOST_TUNE.rise) < 1e-9, 'and the other key lowers it by one');
  ok(liftBy(0, 10_000) === GHOST_TUNE.most, 'however long it is held it never goes past the cap');
  ok(liftBy(0, -10_000) === -GHOST_TUNE.most, 'nor past it downward');
  for (let i = -60; i < 60; i++) {
    const l = liftBy(0, i);
    assert.ok(Math.abs(l) <= GHOST_TUNE.most + 1e-9, `${i} presses stays within the cap`);
    assert.ok(Math.abs(l / GHOST_TUNE.rise - Math.round(l / GHOST_TUNE.rise)) < 1e-9, `${i} presses lands on a whole step`);
  }
  passed++;
  console.log('ok   and every number of presses lands on a whole step inside the cap');
}

{
  // The lift moves where the building is put down and **not** what the ground is asked about: a
  // doorstep the ground laps over can be lifted clear, and no amount of lifting turns a slope the
  // ground refuses into a spot it allows.
  const patch = patchOfFootprint(HOUSE);
  const level = ghostVerdict(patch, { x: 0, z: 0 }, 0, flat(), 1.5);
  ok(level.ok && level.y === 11.5, 'a lift raises where it stands, and the ground still takes it');
  ok(level.lift === 1.5, 'and the state carries the lift, for whoever puts it down');
  const sloped: GhostDeps = { heightAt: (x) => 10 + x * 0.5, waterAt: () => -Infinity, standing: () => [] };
  const cheat = ghostVerdict(patch, { x: 0, z: 0 }, 0, sloped, 50);
  ok(!cheat.ok, 'and a spot the ground refuses is refused however high it is lifted');
  const wet: GhostDeps = { heightAt: () => 10, waterAt: () => 12, standing: () => [] };
  ok(!ghostVerdict(patch, { x: 0, z: 0 }, 0, wet, 20).ok, 'a lake is still a lake with the house held over it');
}

// ---------------------------------------------------------------- the grid

{
  const cells = outlineCells(HOUSE, HOUSE_ROWS, { x: 0, z: 0 }, 0);
  ok(cells.length === 12, 'every cell of a three by four grid is drawn');
  ok(cells.filter((c) => c.hard).length === 1, 'and the one the file marks as a hard edge is marked apart');
  ok(cells.every((c) => c.corners.length === 4), 'each as a quad');
  const xs = cells.flatMap((c) => c.corners.map((p) => p.x));
  const zs = cells.flatMap((c) => c.corners.map((p) => p.z));
  ok(Math.min(...xs) === -12 && Math.max(...xs) === 12, 'the grid is 24 m across, as the footprint says');
  ok(Math.min(...zs) === -12 && Math.max(...zs) === 20, 'and reaches 12 m one way and 20 the other from the origin, which is what the pivot means');
}

{
  const dotted: Footprint = { width: 3, height: 1, pivotX: 1, pivotZ: 0, cellWidth: 8, cellHeight: 8 };
  const cells = outlineCells(dotted, ['F.F'], { x: 0, z: 0 }, 0);
  ok(cells.length === 2, 'a cell the file marks as nothing is not drawn at all');
}

{
  const turned = outlineCells(HOUSE, HOUSE_ROWS, { x: 0, z: 0 }, Math.PI / 2);
  const xs = turned.flatMap((c) => c.corners.map((p) => p.x));
  ok(Math.abs(Math.min(...xs) + 20) < 1e-6 && Math.abs(Math.max(...xs) - 12) < 1e-6, 'a quarter turn swaps which way the grid is long');
}

// ---------------------------------------------------------------- the real ground

{
  const worlds = ['tatooine', 'naboo', 'corellia'].filter((p) => existsSync(join('assets-private', p, 'terrain.trn')));
  const deedPack = join('assets-private', 'deeds.json');
  if (!worlds.length || !existsSync(deedPack)) {
    note('no converted world or no deeds.json, so the real ground is not measured');
  } else {
    const { parseTerrainTemplate, TerrainSampler } = await import('../../../src/swg/terrain/trn.ts');
    const pack = JSON.parse(readFileSync(deedPack, 'utf8')) as { deeds: { id: string; model: string | null; foot: { w: number; h: number; px: number; pz: number; cw: number; ch: number; rows: string[] } | null }[] };
    // The three sizes a player really buys, smallest to biggest.
    const picked = ['corellia_house_small_deed', 'corellia_house_medium_deed', 'corellia_house_large_deed']
      .map((id) => pack.deeds.find((d) => d.id === id))
      .filter((d): d is NonNullable<typeof d> => !!d?.foot);
    ok(picked.length > 0, `${picked.length} real house deeds to try on real ground`);
    for (const planet of worlds) {
      const template = parseTerrainTemplate(new Uint8Array(readFileSync(join('assets-private', planet, 'terrain.trn'))));
      const sampler = new TerrainSampler(template);
      const deps: GhostDeps = { heightAt: (x, z) => sampler.heightAt(x, z), waterAt: () => -Infinity, standing: () => [] };
      const line: string[] = [];
      for (const d of picked) {
        const f: Footprint = { width: d.foot!.w, height: d.foot!.h, pivotX: d.foot!.px, pivotZ: d.foot!.pz, cellWidth: d.foot!.cw, cellHeight: d.foot!.ch };
        const patch = patchOfFootprint(f);
        let tried = 0;
        let took = 0;
        for (let z = -2000; z <= 2000; z += 211) {
          for (let x = -2000; x <= 2000; x += 211) {
            const v = ghostVerdict(patch, { x, z }, 0, deps);
            if (!Number.isFinite(v.y)) continue;
            tried++;
            if (v.ok) took++;
          }
          sampler.invalidateAll();
        }
        const share = (100 * took) / Math.max(1, tried);
        assert.ok(tried > 50, `${planet}: enough spots tried for ${d.id}`);
        line.push(`${d.id.replace('corellia_house_', '').replace('_deed', '')} ${share.toFixed(0)}%`);
      }
      passed++;
      console.log(`ok   ${planet}: a real house finds ground on it — ${line.join(', ')}`);
    }
    note(`the tests are the ground's own: no more than ${HOUSE_TUNE.rise} m of it over the doorstep, ${HOUSE_TUNE.sink} m falling away, ${HOUSE_TUNE.slope} degrees of tilt`);
    note('a bigger house finds less ground than a smaller one, which is what a footprint is for');
  }
}

console.log(`\n${passed} checks passed`);
