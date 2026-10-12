// Placing a building by hand: where the ghost stands, whether it may, the grid under it, the wheel
// and the turn buttons, and what the placing bar says about it.
//
// Everything here is pure -- the ghost's own three.js half is the drawing and decides nothing -- so
// this runs the real rules. Where a world is converted it then runs them over the real ground and
// reports what a player would actually be allowed to do with a real house.
//
// Run: node tools/swg/tests/placeGhost.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { GHOST_TUNE, PlacementGhost, ghostSpot, ghostVerdict, liftBy, outlineCells, turnBy, wheelReach, type GhostDeps } from '../../../src/world/placeGhost.ts';
import { HOUSE_TUNE, doorNote, patchOfFootprint, type Footprint } from '../../../src/world/housePlace.ts';

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
  // The lift is **inside** the ground test: the rise and the fall are measured from the floor it
  // leaves, so a doorstep the ground laps over can be lifted clear, a house hung over level ground
  // is refused for the ground falling away under it, and no amount of lifting turns a slope into a
  // spot it allows. How far the door then stands off the ground is a note and never a refusal.
  const patch = patchOfFootprint(HOUSE);
  const level = ghostVerdict(patch, { x: 0, z: 0 }, 0, flat(), 1.5);
  ok(level.ok && level.y === 11.5, 'a lift raises where it stands, once and only once, and the ground still takes it');
  ok(level.lift === 1.5, 'and the state carries the lift, for whoever puts it down');
  ok(level.note === doorNote(1.5) && !!level.note?.includes('out of reach of a plain jump'), 'and says the door is out of reach of a plain jump, without refusing it');
  const step = ghostVerdict(patch, { x: 0, z: 0 }, 0, flat(), 0.75);
  ok(step.ok && !!step.note?.includes('you will have to jump to get in'), 'three presses up is a jump to get in, and allowed');
  ok(ghostVerdict(patch, { x: 0, z: 0 }, 0, flat(), 0.5).note === null, 'two presses up is a step the feet climb, and says nothing');
  const hung = ghostVerdict(patch, { x: 0, z: 0 }, 0, flat(), 7);
  ok(!hung.ok && !!hung.why?.includes('falls'), 'seven metres up over level ground is refused for the ground falling away under it');
  // A doorstep the ground laps over: the far end of the patch stands over the rise at the ground,
  // and lifting the house by the difference clears it.
  const lapped: GhostDeps = { heightAt: (_x, z) => (z > 15 ? 10 + HOUSE_TUNE.rise + 0.3 : 10), waterAt: () => -Infinity, standing: () => [] };
  ok(!ghostVerdict(patch, { x: 0, z: 0 }, 0, lapped).ok, 'ground rising over the rise at the far end refuses the spot on the ground');
  ok(ghostVerdict(patch, { x: 0, z: 0 }, 0, lapped, 0.5).ok, 'and lifted clear of it the spot is allowed');
  // A spot refused for its slope is refused however it is lifted. Asked with a shed's one cell on a
  // long even ramp, which at each of these lifts stays within the rise and the fall of the floor, so
  // the slope is the only test that can refuse it: the house's own patch on a ramp that steep would
  // be refused for its rise first and say nothing about the slope.
  const shed = patchOfFootprint({ width: 1, height: 1, pivotX: 0, pivotZ: 0, cellWidth: 4, cellHeight: 4 });
  const ramp: GhostDeps = { heightAt: (x) => 10 + x * 0.3, waterAt: () => -Infinity, standing: () => [] };
  const lifts = [0, 0.25, -0.25, 2, -1.2];
  ok(
    lifts.every((l) => {
      const v = ghostVerdict(shed, { x: 0, z: 0 }, 0, ramp, l);
      return !v.ok && !!v.why?.includes('slopes');
    }),
    `and a spot the ground refuses for its slope is refused for its slope however it is lifted (${lifts.join(', ')} m)`,
  );
  const wet: GhostDeps = { heightAt: () => 10, waterAt: () => 12, standing: () => [] };
  ok(!ghostVerdict(patch, { x: 0, z: 0 }, 0, wet, 3).ok, 'a lake is still a lake with the house held over it');
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
  // Turned the way three turns the building: its own +z comes round to +x at a quarter turn, so the
  // long reach of 20 m past the origin lands on +x, as it does under the drawn house.
  const turned = outlineCells(HOUSE, HOUSE_ROWS, { x: 0, z: 0 }, Math.PI / 2);
  const xs = turned.flatMap((c) => c.corners.map((p) => p.x));
  ok(Math.abs(Math.min(...xs) + 12) < 1e-6 && Math.abs(Math.max(...xs) - 20) < 1e-6, "a quarter turn swaps which way the grid is long, three's way round");
}

// ---------------------------------------------------------------- the ghost against three itself
//
// The ghost is drawn by three, turned by `rotation.set(0, yaw, 0)`; the ground under it and the
// middle what is in the way is measured from must be where three puts the same points. At 0 and
// 180 degrees the old, mirrored turn agreed with it, which is why this is asked at a quarter turn.
{
  const yaw = Math.PI / 2;
  const at = { x: 30, z: -12 };
  const patch = patchOfFootprint(HOUSE);
  const ref = new THREE.Object3D();
  ref.position.set(at.x, 0, at.z);
  ref.rotation.set(0, yaw, 0);
  ref.updateMatrixWorld(true);

  const asked: { x: number; z: number }[] = [];
  const spy: GhostDeps = {
    heightAt: () => 10,
    waterAt: () => -Infinity,
    standing: (x, z) => {
      asked.push({ x, z });
      return [];
    },
  };
  const state = ghostVerdict(patch, at, yaw, spy);
  const middle = ref.localToWorld(new THREE.Vector3(patch.cx, 0, patch.cz));
  ok(asked.length === 1 && Math.abs(asked[0].x - middle.x) < 1e-9 && Math.abs(asked[0].z - middle.z) < 1e-9, "at a quarter turn what is in the way is asked about at three's own middle of the building");

  // The grid: every corner's ground is asked for where three draws that corner.
  const heights: { x: number; z: number }[] = [];
  const ghost = new PlacementGhost();
  ghost.place(state, HOUSE, HOUSE_ROWS, (x, z) => {
    heights.push({ x, z });
    return 10 + x * 0.01;
  });
  const want = outlineCells(HOUSE, HOUSE_ROWS, { x: 0, z: 0 }, 0).flatMap((c) => c.corners.map((p) => ref.localToWorld(new THREE.Vector3(p.x, 0, p.z))));
  ok(heights.length === want.length && want.length === 48, 'the grid asks the ground under every corner of every cell, once');
  ok(
    heights.every((h, i) => Math.abs(h.x - want[i].x) < 1e-9 && Math.abs(h.z - want[i].z) < 1e-9),
    "and asks it where three draws that corner under the turned house, not at its mirror image",
  );

  // The cells are worked out once for a footprint and kept: the grid is drawn every frame.
  const kept = ghost.outline;
  ok(!!kept && kept.length === 12, 'the ghost keeps the footprint\'s cells');
  ghost.place({ ...state, yaw: 0.3, x: 5 }, { ...HOUSE }, [...HOUSE_ROWS], () => 10);
  ok(ghost.outline === kept, 'and a frame with the same footprint, handed over afresh as a deed does, works none of them out again');
  // The same grid with other rows, which real deeds are: Corellia's small house is the medium's three
  // by four of eight metres with a whole row of hard edge. Kept by its size alone, the small house's
  // grid would be drawn with the medium's one hard cell.
  ghost.place(state, { ...HOUSE }, ['HHH', 'FFF', 'FFF', 'FFF'], () => 10);
  ok(ghost.outline !== kept && ghost.outline?.filter((c) => c.hard).length === 3, 'and the same grid with other rows works its own cells out');
  const smallHouse = ghost.outline;
  ghost.place(state, { ...HOUSE }, HOUSE_ROWS, () => 10);
  ok(ghost.outline !== smallHouse && ghost.outline?.filter((c) => c.hard).length === 1, 'and so does going back to the first');
  const dotted: Footprint = { width: 3, height: 1, pivotX: 1, pivotZ: 0, cellWidth: 8, cellHeight: 8 };
  ghost.place(state, dotted, ['F.F'], () => 10);
  ok(ghost.outline !== kept && ghost.outline?.length === 2, 'and another footprint works its own out');
  ghost.dispose();
}

// ---------------------------------------------------------------- the bar's words
//
// The bar is on the page, so it is driven here against a stand-in for the little of the page it
// touches. Its whole promise is two things: a note is said beside an allowed spot only, in the
// accent, and a frame that changes nothing it says writes nothing -- the note included.
{
  class StandIn {
    hidden = false;
    textContent = '';
    className = '';
    disabled = false;
    id = '';
    innerHTML = '';
    private readonly found = new Map<string, StandIn>();
    appendChild<T>(child: T): T {
      return child;
    }
    querySelector(selector: string): StandIn {
      let el = this.found.get(selector);
      if (!el) {
        el = new StandIn();
        this.found.set(selector, el);
      }
      return el;
    }
    addEventListener(): void {}
  }
  const page = globalThis as unknown as { document?: unknown };
  const had = page.document;
  page.document = { createElement: () => new StandIn(), head: new StandIn() };
  try {
    const { PlacingBar } = await import('../../../src/ui/placingBar.ts');
    const parent = new StandIn();
    const bar = new PlacingBar(parent as unknown as HTMLElement);
    const why = (bar.root as unknown as StandIn).querySelector('.why');
    const keys = { left: 'Q', right: 'E', up: 'R', down: 'F' };
    const jump = doorNote(0.75)!;
    const reach = doorNote(1.5)!;

    bar.show('Medium House', true, null, keys, 0.75, null, jump);
    ok(why.textContent === jump && why.className === 'why note', 'an allowed spot with a note says the note, in the accent');
    const after = bar.writes;
    bar.show('Medium House', true, null, keys, 0.75, null, jump);
    ok(bar.writes === after, 'and the same frame again writes nothing');
    bar.show('Medium House', true, null, keys, 0.75, null, reach);
    ok(bar.writes === after + 1 && why.textContent === reach, 'a note that changes is written, once');

    bar.show('Medium House', false, 'that is under water', keys, 0.75, null, jump);
    ok(why.textContent === 'that is under water' && why.className === 'why bad', 'a refused spot says only why, never the note');
    const refused = bar.writes;
    bar.show('Medium House', false, 'that is under water', keys, 0.75, null, reach);
    ok(bar.writes === refused, 'and a note moving under a refusal, which is not shown, writes nothing');

    bar.show('Medium House', true, null, keys, 0, null, null);
    ok(why.textContent === 'the ground will take it' && why.className === 'why good', 'an allowed spot with nothing to say is the plain green');
  } finally {
    if (had === undefined) delete page.document;
    else page.document = had;
  }
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
