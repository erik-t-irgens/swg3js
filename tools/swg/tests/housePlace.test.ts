// Putting a house on the ground: the patch it asks for, the ground test, and the spot ahead.
//
// The rules are pure, so this runs the real ones. Where the gallery pack is converted it then reads
// the real buildings' own boxes and reports what patch each asks for, which is the only way to know
// that numbers tuned on a fixture mean anything over the buildings the game really sold.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import {
  HOUSE_TUNE,
  blockedBy,
  blockerName,
  clearRadius,
  doorNote,
  groundVerdict,
  patchMiddle,
  patchOfBounds,
  patchOfFootprint,
  patchProbes,
  patchSize,
  spotAhead,
  turnLocal,
  type Patch,
  type Standing,
} from '../../../src/world/housePlace.ts';
import { modelReach } from '../../../src/world/floraClear.ts';
import { JUMP_APEX } from '../../../src/vehicles/surfaceRoom.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}

const flat = (probes: readonly { x: number; z: number }[], h = 10): number[] => probes.map(() => h);

// ---------------------------------------------------------------- the patch

{
  const p = patchOfBounds({ min: [-10, -16, -6], max: [10, 8, 14] });
  ok(p.hx === 10 && p.hz === 10, 'a box twenty metres each way asks for ten metres each way');
  ok(p.cx === 0 && p.cz === 4, "the middle of a box that reaches farther one way is not the building's origin");
  const s = patchSize(p);
  ok(s.x === 20 && s.z === 20, 'the size is twice the half-extents');
}

{
  // A mesh's BOX chunk holds the larger corner first and the packs written before that was noticed
  // carry the swap, so the corners are taken componentwise and never by which one came first.
  const a = patchOfBounds({ min: [-10, 0, -6], max: [10, 8, 14] });
  const b = patchOfBounds({ min: [10, 8, 14], max: [-10, 0, -6] });
  ok(a.hx === b.hx && a.hz === b.hz && a.cx === b.cx && a.cz === b.cz, 'a swapped box gives exactly the same patch');
}

{
  // Eight cells of eight metres with the origin on cell (3, 3): 64 m square, the origin a half cell
  // off the middle each way.
  const p = patchOfFootprint({ width: 8, height: 8, pivotX: 3, pivotZ: 3, cellWidth: 8, cellHeight: 8 });
  ok(p.hx === 32 && p.hz === 32, "a footprint's half-extents are its cells times its cell size, halved");
  ok(Math.abs(p.cx - 4) < 1e-9 && Math.abs(p.cz - 4) < 1e-9, 'the origin sits on the middle of the cell the pivot names');
  const mid = patchOfFootprint({ width: 3, height: 3, pivotX: 1, pivotZ: 1, cellWidth: 4, cellHeight: 4 });
  ok(Math.abs(mid.cx) < 1e-9 && Math.abs(mid.cz) < 1e-9, 'a pivot in the middle of an odd grid leaves no offset');
}

// ---------------------------------------------------------------- the probes

{
  const p: Patch = { hx: 10, hz: 10, cx: 0, cz: 0 };
  const probes = patchProbes(p, { x: 100, z: 200 }, 0, 0);
  ok(probes.length === 6, 'four corners, the middle and the doorstep');
  ok(probes[5].x === 100 && probes[5].z === 200, "the last probe is the building's own origin, which the verdict measures from");
  const xs = probes.map((q) => q.x).sort((a, b) => a - b);
  ok(xs[0] === 90 && xs[5] === 110, 'the corners reach the half-extent each way');
}

{
  // Turned a quarter turn, a patch that is long along z is long across x.
  const p: Patch = { hx: 4, hz: 20, cx: 0, cz: 0 };
  const probes = patchProbes(p, { x: 0, z: 0 }, Math.PI / 2, 0);
  const spanX = Math.max(...probes.map((q) => q.x)) - Math.min(...probes.map((q) => q.x));
  const spanZ = Math.max(...probes.map((q) => q.z)) - Math.min(...probes.map((q) => q.z));
  ok(Math.abs(spanX - 40) < 1e-6 && Math.abs(spanZ - 8) < 1e-6, 'a quarter turn swaps which way a patch is long');
}

{
  const p: Patch = { hx: 10, hz: 10, cx: 0, cz: 6 };
  const probes = patchProbes(p, { x: 0, z: 0 }, 0, 0);
  ok(probes[4].z === 6, "the offset moves the ground that is tested, not just the building's picture");
  ok(probes[5].z === 0, 'and leaves the doorstep where the building was asked for');
}

{
  const p: Patch = { hx: 10, hz: 10, cx: 0, cz: 0 };
  const bare = patchProbes(p, { x: 0, z: 0 }, 0, 0);
  const wide = patchProbes(p, { x: 0, z: 0 }, 0, 5);
  ok(Math.max(...wide.map((q) => q.x)) === Math.max(...bare.map((q) => q.x)) + 5, 'the margin widens the patch that is tested');
}

// ---------------------------------------------------------------- the turn, against three itself
//
// The house and its ghost are turned by three (`rotation.set(0, yaw, 0)` on the ghost,
// `setFromAxisAngle(up, yaw)` on the house that stands), so three is the witness: every point the
// rules measure must be where three puts the same point of the building. The rules once turned the
// other way and agreed with the drawn house only at 0 and 180 degrees, and their own tests, which
// checked them only against themselves, never noticed.
{
  // An offset patch, so a turn the wrong way puts the middle somewhere else entirely.
  const p: Patch = { hx: 6, hz: 9, cx: 2.5, cz: 7 };
  const at = { x: 10, z: -4 };
  const reach = clearRadius(p);
  /**
   * Whether `blockedBy` measures from exactly `t`: a thing standing `reach + 1` out from `t` on each
   * side in turn, sized a hair either side of reaching the patch, is in the way at the larger size
   * and clear at the smaller only when the middle is within that hair of `t` along that side.
   */
  const measuresFrom = (yaw: number, t: { x: number; z: number }, eps = 1e-9): boolean => {
    for (const [ux, uz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const s = { x: t.x + ux * (reach + 1), z: t.z + uz * (reach + 1) };
      if (!blockedBy(p, at, yaw, [{ ...s, radius: 1 + eps }])) return false;
      if (blockedBy(p, at, yaw, [{ ...s, radius: 1 - eps }])) return false;
    }
    return true;
  };
  for (const yaw of [0, 0.65, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    const ref = new THREE.Object3D();
    ref.position.set(at.x, 0, at.z);
    ref.rotation.set(0, yaw, 0);
    ref.updateMatrixWorld(true);
    const middle = ref.localToWorld(new THREE.Vector3(p.cx, 0, p.cz));
    const probes = patchProbes(p, at, yaw);
    assert.ok(Math.abs(probes[4].x - middle.x) < 1e-9 && Math.abs(probes[4].z - middle.z) < 1e-9, `at ${yaw.toFixed(2)} rad the middle probe is where three puts the patch's middle`);
    // Every corner too, margin and all.
    const hx = p.hx + HOUSE_TUNE.margin;
    const hz = p.hz + HOUSE_TUNE.margin;
    const corners = [
      [-hx, -hz],
      [hx, -hz],
      [-hx, hz],
      [hx, hz],
    ];
    corners.forEach(([dx, dz], i) => {
      const c = ref.localToWorld(new THREE.Vector3(p.cx + dx, 0, p.cz + dz));
      assert.ok(Math.abs(probes[i].x - c.x) < 1e-9 && Math.abs(probes[i].z - c.z) < 1e-9, `at ${yaw.toFixed(2)} rad corner ${i} is where three puts it`);
    });
    assert.ok(measuresFrom(yaw, middle), `at ${yaw.toFixed(2)} rad what is in the way is measured from three's own middle`);
    // And the spot ahead: what lands the reach away along the body's heading is the building's
    // middle as three draws it once stood there.
    const from = { x: -3, z: 8 };
    const spot = spotAhead(from, yaw, p);
    const stood = new THREE.Object3D();
    stood.position.set(spot.x, 0, spot.z);
    stood.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    stood.updateMatrixWorld(true);
    const mid = stood.localToWorld(new THREE.Vector3(p.cx, 0, p.cz));
    const far = Math.max(HOUSE_TUNE.ahead, Math.hypot(p.hx, p.hz) + HOUSE_TUNE.margin + 2);
    assert.ok(Math.abs(mid.x - (from.x + Math.sin(yaw) * far)) < 1e-9 && Math.abs(mid.z - (from.z + Math.cos(yaw) * far)) < 1e-9, `at ${yaw.toFixed(2)} rad the spot ahead puts the drawn middle the reach along the heading`);
    const turned = turnLocal(p.cx, p.cz, yaw, { x: 0, z: 0 });
    assert.ok(Math.abs(at.x + turned.x - middle.x) < 1e-9 && Math.abs(at.z + turned.z - middle.z) < 1e-9, `at ${yaw.toFixed(2)} rad turnLocal is three's own turn`);
    const mid2 = patchMiddle(p, at, yaw, { x: 0, z: 0 });
    assert.ok(Math.abs(mid2.x - middle.x) < 1e-9 && Math.abs(mid2.z - middle.z) < 1e-9, `at ${yaw.toFixed(2)} rad patchMiddle, where the world is asked what stands, is three's own middle`);
  }
  passed++;
  console.log("ok   at five turns every probe, the middle measured for what is in the way and the spot ahead are where three draws the house");
  // The measure above can tell the two senses apart, or it proves nothing: the mirrored middle at a
  // quarter turn is not where `blockedBy` measures from.
  const q = Math.PI / 2;
  const wrong = { x: at.x + (p.cx * Math.cos(q) - p.cz * Math.sin(q)), z: at.z + (p.cx * Math.sin(q) + p.cz * Math.cos(q)) };
  ok(!measuresFrom(q, wrong), 'and the measure tells the old, mirrored middle from the true one');
  const out = { x: 0, z: 0 };
  ok(turnLocal(1, 2, 0.3, out) === out, 'turnLocal writes into the record it is handed rather than making one');
  ok(patchMiddle(p, at, 0.3, out) === out, 'and so does patchMiddle');
}

{
  // The ghost asks every frame, so the probes and the verdict can be written into records it keeps.
  // Kept or fresh, the answer must be the same, and a kept verdict must not carry a field over from
  // the frame before -- a refusal's words left on a spot that is allowed would read as a refusal.
  const p: Patch = { hx: 6, hz: 9, cx: 2.5, cz: 7 };
  const list: { x: number; z: number }[] = [];
  const first = patchProbes(p, { x: 3, z: 4 }, 0.4, HOUSE_TUNE.margin, list);
  const records = first.slice();
  const again = patchProbes(p, { x: -8, z: 1 }, 1.9, HOUSE_TUNE.margin, list);
  const fresh = patchProbes(p, { x: -8, z: 1 }, 1.9);
  ok(first === list && again === list && again.length === 6, 'the probes are written into the list handed over');
  ok(again.every((q, i) => q === records[i]), 'into the same six records, frame after frame');
  ok(again.every((q, i) => q.x === fresh[i].x && q.z === fresh[i].z), 'and they are exactly the probes a fresh list would hold');

  const probes = patchProbes({ hx: 10, hz: 10, cx: 0, cz: 0 }, { x: 0, z: 0 }, 0);
  const kept = groundVerdict(probes, flat(probes, 10), HOUSE_TUNE, 0);
  const rough = flat(probes, 10);
  rough[0] = 10 + HOUSE_TUNE.rise + 1;
  ok(groundVerdict(probes, rough, HOUSE_TUNE, 0.75, kept) === kept && !kept.ok && !!kept.why && !!kept.note, 'a verdict is written into the record handed over');
  groundVerdict(probes, flat(probes, 10), HOUSE_TUNE, 0, kept);
  ok(kept.ok && kept.why === null && kept.note === null && kept.rise === 0 && kept.y === 10, "and the next frame's answer leaves nothing of the last one standing in it");
}

// ---------------------------------------------------------------- the verdict

{
  const probes = patchProbes({ hx: 10, hz: 10, cx: 0, cz: 0 }, { x: 0, z: 0 }, 0);
  const v = groundVerdict(probes, flat(probes, 42));
  ok(v.ok && v.why === null, 'level ground takes a house');
  ok(v.y === 42, 'and stands it at the ground');
  ok(v.rise === 0 && v.sink === 0 && v.slope === 0, 'with nothing to report');
}

{
  const probes = patchProbes({ hx: 10, hz: 10, cx: 0, cz: 0 }, { x: 0, z: 0 }, 0);
  const h = flat(probes, 10);
  h[0] = 10 + HOUSE_TUNE.rise + 0.01;
  const v = groundVerdict(probes, h);
  ok(!v.ok && !!v.why && v.why.includes('over the doorstep'), 'ground standing over the doorstep refuses the spot, in words');
  ok(Math.abs(v.rise - (HOUSE_TUNE.rise + 0.01)) < 1e-9, 'and says by how much');
}

{
  // The rule is not symmetric, and this is the whole reason it is not one number: every one of
  // these buildings carries a foundation sixteen metres deep, so ground falling away shows nothing
  // and ground rising laps up a wall.
  const probes = patchProbes({ hx: 10, hz: 10, cx: 0, cz: 0 }, { x: 0, z: 0 }, 0);
  const up = flat(probes, 10);
  up[0] = 10 + (HOUSE_TUNE.rise + HOUSE_TUNE.sink) / 2;
  const down = flat(probes, 10);
  down[0] = 10 - (HOUSE_TUNE.rise + HOUSE_TUNE.sink) / 2;
  ok(!groundVerdict(probes, up).ok, 'ground that rises that far is refused');
  ok(groundVerdict(probes, down).ok, 'ground that falls the same distance is taken, because the foundation is under it');
}

{
  const probes = patchProbes({ hx: 10, hz: 10, cx: 0, cz: 0 }, { x: 0, z: 0 }, 0);
  const h = flat(probes, 10);
  h[0] = 10 - HOUSE_TUNE.sink - 0.01;
  const v = groundVerdict(probes, h);
  ok(!v.ok && !!v.why && v.why.includes('falls'), 'but ground that falls away far enough is refused too, in its own words');
}

{
  // The house is stood at its own doorstep, whatever the corners are doing.
  const probes = patchProbes({ hx: 10, hz: 10, cx: 0, cz: 0 }, { x: 0, z: 0 }, 0);
  const h = flat(probes, 10);
  h[1] = 11;
  h[2] = 8;
  h[5] = 9.5;
  const v = groundVerdict(probes, h);
  ok(v.y === 9.5, 'the house is stood at the ground under its own origin, not at the highest or the lowest corner');
}

{
  // A long even ramp: every probe within the rise and the sink of the doorstep, and still a tilt.
  // Neither of the other two tests can see it, which is the whole reason the slope is its own.
  const probes = patchProbes({ hx: 4, hz: 4, cx: 0, cz: 0 }, { x: 0, z: 0 }, 0, 0);
  const h = probes.map((q) => 10 + q.x * 0.3);
  const door = h[h.length - 1];
  ok(Math.max(...h) - door <= HOUSE_TUNE.rise && door - Math.min(...h) <= HOUSE_TUNE.sink, 'the ramp is within the rise and the sink');
  const v = groundVerdict(probes, h);
  ok(!v.ok && !!v.why && v.why.includes('slopes'), 'and is refused on its slope');
}

{
  const probes = patchProbes({ hx: 10, hz: 10, cx: 0, cz: 0 }, { x: 0, z: 0 }, 0);
  const h = flat(probes, 10);
  h[2] = Number.NaN;
  const v = groundVerdict(probes, h);
  ok(!v.ok && !!v.why && v.why.includes('not known'), 'ground the terrain cannot answer for is refused rather than guessed at');
}

{
  // Two probes on top of each other say nothing about slope: the run guard must skip them rather
  // than divide by nothing and call it vertical.
  const probes = [
    { x: 0, z: 0 },
    { x: 0.1, z: 0 },
    { x: 20, z: 0 },
  ];
  const v = groundVerdict(probes, [10, 11, 11]);
  ok(Number.isFinite(v.slope), 'a pair too close together is skipped rather than read as a cliff');
  ok(v.slope < 5, 'and the slope comes from the pair that is far enough apart');
}

// ---------------------------------------------------------------- the floor, and the door
//
// The player's lift is judged where the floor really stands: the rise and the fall are measured
// from `door + lift`. How far the door then stands off the ground is a note and never a refusal.
{
  const probes = patchProbes({ hx: 10, hz: 10, cx: 0, cz: 0 }, { x: 0, z: 0 }, 0);
  const h = flat(probes, 10);
  h[0] = 10 + HOUSE_TUNE.rise + 0.4;
  const low = groundVerdict(probes, h);
  ok(!low.ok && !!low.why?.includes('over the doorstep'), 'a corner rising past the rise refuses the spot at the ground');
  const lifted = groundVerdict(probes, h, HOUSE_TUNE, 0.41);
  ok(lifted.ok, 'and lifted by that much it is allowed, because the floor really is then within the rise of the ground');
  ok(Math.abs(lifted.y - 10.41) < 1e-9, 'and it stands at the floor, the lift in its height');
  ok(Math.abs(lifted.sink - 0.41) < 1e-9, 'with the doorstep ground falling the lift away under it');
}

{
  const probes = patchProbes({ hx: 10, hz: 10, cx: 0, cz: 0 }, { x: 0, z: 0 }, 0);
  const level = flat(probes, 10);
  const down = groundVerdict(probes, level, HOUSE_TUNE, -1);
  ok(down.ok && Math.abs(down.rise - 1) < 1e-9, 'lowering a house adds to the rise: the ground stands the drop over its floor');
  const buried = groundVerdict(probes, level, HOUSE_TUNE, -(HOUSE_TUNE.rise + 0.1));
  ok(!buried.ok && !!buried.why?.includes('over the doorstep'), 'and lowered past the rise it is refused for the ground it buries, in the rise\'s words');
  const hung = groundVerdict(probes, level, HOUSE_TUNE, 7);
  ok(!hung.ok && !!hung.why?.includes('falls'), 'a house lifted seven metres over level ground is refused in the fall\'s own words');
}

{
  // A slope is refused at any height, since a lift does not move it. Asked of the long even ramp,
  // whose every probe stays within the rise and the fall of the floor at each of these lifts, so the
  // slope is the only test that can refuse it: a steeper fixture would be refused for its rise or
  // its fall and say nothing about whether the slope minds the lift.
  const probes = patchProbes({ hx: 4, hz: 4, cx: 0, cz: 0 }, { x: 0, z: 0 }, 0, 0);
  const h = probes.map((q) => 10 + q.x * 0.3);
  const lifts = [0, 0.25, -0.25, 2, -1.2];
  const verdicts = lifts.map((l) => groundVerdict(probes, h, HOUSE_TUNE, l));
  ok(
    verdicts.every((v) => v.rise <= HOUSE_TUNE.rise && v.sink <= HOUSE_TUNE.sink),
    'the ramp stays within the rise and the fall of the floor at every one of these lifts',
  );
  ok(
    verdicts.every((v) => !v.ok && !!v.why?.includes('slopes')),
    `and it is refused for its slope at every one of them (${lifts.join(', ')} m)`,
  );
  ok(verdicts.every((v) => v.slope === verdicts[0].slope), 'and the slope it is refused for is the same whatever the lift');
}

{
  const probes = patchProbes({ hx: 10, hz: 10, cx: 0, cz: 0 }, { x: 0, z: 0 }, 0);
  const level = flat(probes, 10);
  const at = (lift: number) => groundVerdict(probes, level, HOUSE_TUNE, lift);
  ok(at(0).note === null && at(HOUSE_TUNE.doorStep).note === null, 'a door on the ground, or as high as a step the feet climb, says nothing');
  const jump = at(0.62);
  ok(jump.ok && jump.note === 'the door will stand 0.62 m over the ground: you will have to jump to get in', 'past the step the door needs a jump, said and not refused');
  const out = at(-0.62);
  ok(out.ok && out.note === 'the ground will stand 0.62 m over the doorstep: you will have to jump to get out', 'and lowered, the jump is the one out');
  const high = at(1.1);
  ok(high.ok && high.note === 'the door will stand 1.10 m over the ground, out of reach of a plain jump', 'past a plain jump the door is out of its reach, and still allowed');
  const deep = at(-1.1);
  ok(deep.ok && deep.note === 'the ground will stand 1.10 m over the doorstep, out of reach of a plain jump', 'lowered likewise');
  ok(at(7).note === doorNote(7) && !!at(7).note, 'a refused spot still carries what the door would have meant');
  ok(Math.abs(at(0.62).y - 10.62) < 1e-9 && Math.abs(at(-0.62).y - 9.38) < 1e-9, 'and its height is the floor, up or down');
  // The words are written once for a lift held still, and handed back after; moving either of the
  // two numbers they come from must write them again rather than say the last ones.
  ok(doorNote(0.7) === doorNote(0.7) && doorNote(0.7)!.includes('jump to get in'), 'a lift held still says the same words every frame');
  ok(doorNote(0.7, { ...HOUSE_TUNE, doorMost: 0.6 })!.includes('out of reach'), 'and a plain jump tuned lower than the lift says it is out of reach at once');
  ok(doorNote(0.7, { ...HOUSE_TUNE, doorStep: 0.75 }) === null, 'and a step tuned higher than the lift says nothing');
  ok(doorNote(0.7)!.includes('jump to get in'), 'and the numbers put back say the jump again');
}

{
  // The two door numbers are the player's own and not ours: the step the character controller
  // climbs without a jump, and the walk's plain jump. Read off the very sources they came from.
  ok(Math.abs(HOUSE_TUNE.doorMost - JUMP_APEX) < 0.01, `doorMost is the walk's own jump (${JUMP_APEX.toFixed(3)} m)`);
  const playerSrc = readFileSync(join('src', 'player', 'player.ts'), 'utf8');
  const step = /controller\.enableAutostep\(\s*([0-9.]+)\s*,/.exec(playerSrc);
  ok(!!step, "player.ts's character controller still climbs an autostep");
  ok(Number(step![1]) === HOUSE_TUNE.doorStep, `doorStep is the step the player's controller climbs (${step![1]} m)`);
}

// ---------------------------------------------------------------- the spot ahead

{
  const p: Patch = { hx: 4, hz: 4, cx: 0, cz: 0 };
  const at = spotAhead({ x: 0, z: 0 }, 0, p);
  // A body's heading, whose forward is (sin, cos): heading 0 faces +z. Read as the camera's yaw,
  // whose forward is the negative of that, every building landed behind the player's back.
  ok(Math.abs(at.x) < 1e-9 && Math.abs(at.z - HOUSE_TUNE.ahead) < 1e-9, 'facing heading 0 puts it down +z, which is where the body is looking');
  const right = spotAhead({ x: 0, z: 0 }, Math.PI / 2, p);
  ok(Math.abs(right.x - HOUSE_TUNE.ahead) < 1e-6 && Math.abs(right.z) < 1e-6, 'a quarter turn puts it down +x, as the body turns');
}

{
  // A big building goes farther out than a small one, or it is built on your head.
  const small = spotAhead({ x: 0, z: 0 }, 0, { hx: 3, hz: 3, cx: 0, cz: 0 });
  const large = spotAhead({ x: 0, z: 0 }, 0, { hx: 30, hz: 30, cx: 0, cz: 0 });
  ok(Math.hypot(large.x, large.z) > Math.hypot(small.x, small.z), 'a guild hall is put down farther away than a tent');
  ok(Math.hypot(large.x, large.z) >= 30, "and at least its own half-diagonal, so its wall is not where you stand");
}

{
  // The offset is taken off, so what lands `ahead` away is the middle of the building rather than
  // whichever corner its origin happens to sit on.
  const p: Patch = { hx: 10, hz: 10, cx: 0, cz: 10 };
  const at = spotAhead({ x: 0, z: 0 }, 0, p);
  const probes = patchProbes(p, at, 0, 0);
  const middle = probes[4];
  ok(Math.abs(Math.hypot(middle.x, middle.z) - Math.max(HOUSE_TUNE.ahead, Math.hypot(p.hx, p.hz) + HOUSE_TUNE.margin + 2)) < 1e-6, "the building's middle is what ends up the reach away");
}

{
  const r = clearRadius({ hx: 10, hz: 10, cx: 0, cz: 0 });
  ok(Math.abs(r - (Math.hypot(10, 10) + HOUSE_TUNE.margin)) < 1e-9, 'the flora is kept off the patch and its margin');
  ok(clearRadius({ hx: 30, hz: 30, cx: 0, cz: 0 }) > r, 'a bigger building keeps more of it off');
}

// ---------------------------------------------------------------- what is already standing there

{
  const p: Patch = { hx: 10, hz: 10, cx: 0, cz: 0 };
  const reach = clearRadius(p);
  ok(blockedBy(p, { x: 0, z: 0 }, 0, []) === null, 'an empty patch of ground is not blocked by anything');
  ok(!!blockedBy(p, { x: 0, z: 0 }, 0, [{ x: reach - 1, z: 0, radius: 1 }]), 'and one with something inside its circle is');
  ok(blockedBy(p, { x: 0, z: 0 }, 0, [{ x: reach + 2, z: 0, radius: 1 }]) === null, 'and one with something just clear of it is not');
  ok(blockedBy(p, { x: 0, z: 0 }, 0, [{ x: 1, z: 0, radius: 0 }]) === null, 'a thing with no size of its own blocks nothing, whatever it is standing on');
}

{
  // The nearest is what is answered, so the refusal names the thing a player can see themselves
  // standing next to rather than whichever happened to come first out of the region lists.
  const p: Patch = { hx: 5, hz: 5, cx: 0, cz: 0 };
  const hit = blockedBy(p, { x: 0, z: 0 }, 0, [
    { x: 0, z: 9, radius: 3, template: 'object/x/shared_far_thing.iff' },
    { x: 0, z: 2, radius: 3, template: 'object/x/shared_near_thing.iff' },
  ]);
  ok(hit?.template?.includes('near_thing') === true, 'the nearest thing in the way is the one named');
}

{
  // The patch's offset turns with the building, so what is in the way depends on which way you face.
  const p: Patch = { hx: 4, hz: 4, cx: 0, cz: 12 };
  const thing = [{ x: 0, z: 12, radius: 1 }];
  ok(!!blockedBy(p, { x: 0, z: 0 }, 0, thing), 'facing one way the building reaches the thing');
  ok(blockedBy(p, { x: 0, z: 0 }, Math.PI, thing) === null, 'and turned about it does not');
}

{
  // What the world is asked about must be round the same middle `blockedBy` measures from, or a
  // thing within reach of the far side of a house whose origin is metres off its middle is never
  // handed over to be measured. The ghost asks at the middle; `placeBuilding` (the console's house,
  // and the relay's try) is in a file node cannot load, so its call is read out of the source.
  const world = readFileSync(join('src', 'world', 'world.ts'), 'utf8');
  const body = world.slice(world.indexOf('async placeBuilding('), world.indexOf('unplaceBuilding(key: string)'));
  ok(
    /const mid = patchMiddle\(patch, at, yaw, \{ x: 0, z: 0 \}\);\s*const blocker = blockedBy\(patch, at, yaw, stream\.objectsNear\(mid\.x, mid\.z, clear\)\);/.test(body),
    "placeBuilding asks the world what stands round the patch's middle, where blockedBy measures from",
  );
  ok(!/objectsNear\(at\.x, at\.z/.test(body), 'and never round the doorstep');
}

{
  ok(blockerName('object/building/general/shared_cantina_tatooine.iff') === 'cantina tatooine', 'a refusal says what is in the way in words, out of the template');
  ok(blockerName(undefined) === 'something' && blockerName('') === 'something', 'and says something rather than nothing when it cannot');
  ok(blockerName('place/eisley-bay22_locker') === 'eisley bay22 locker', 'a permanent placement in the way is named by its id, in words');
}

// ---------------------------------------------------------------- the real buildings

{
  const manifest = join('assets-private', 'gallery', 'manifest.json');
  if (!existsSync(manifest)) {
    note('no gallery pack here, so the real buildings are not measured (npm run swg -- gallery @SWG assets-private --retail-only)');
  } else {
    const m = JSON.parse(readFileSync(manifest, 'utf8')) as {
      categories: Record<string, { id: string; bounds?: { min: number[]; max: number[] }; cells?: unknown[] }[]>;
    };
    const all = Object.values(m.categories).flat();
    const walkIn = all.filter((d) => (d.cells?.length ?? 0) > 1 && d.bounds);
    const houses = walkIn.filter((d) => /^ply_/.test(d.id));
    ok(houses.length > 0, `${houses.length} of the ${walkIn.length} walk-in buildings in the pack are ones players bought`);
    let widest = { id: '', r: 0 };
    let offset = { id: '', d: 0 };
    for (const d of houses) {
      const p = patchOfBounds(d.bounds!);
      const r = clearRadius(p);
      if (r > widest.r) widest = { id: d.id, r };
      const off = Math.hypot(p.cx, p.cz);
      if (off > offset.d) offset = { id: d.id, d: off };
      assert.ok(p.hx > 0.5 && p.hz > 0.5, `${d.id} has a patch with a real size`);
      // The reach is taken from the middle of the patch, so the building's own far corner must be
      // clear of where the player stands however far off its origin sits.
      const at = spotAhead({ x: 0, z: 0 }, 0, p);
      const probes = patchProbes(p, at, 0, 0);
      const nearest = Math.min(...probes.map((q) => Math.hypot(q.x, q.z)));
      assert.ok(nearest > 0.5, `${d.id} is not put down on top of the player (nearest corner ${nearest.toFixed(1)} m)`);
    }
    passed++;
    console.log(`ok   every one of the ${houses.length} buildings is put down clear of the player who placed it`);
    note(`widest patch: ${widest.id} keeps the flora off ${widest.r.toFixed(1)} m`);
    note(`furthest origin from its own middle: ${offset.id}, ${offset.d.toFixed(1)} m -- which is why the patch carries an offset at all`);
    // The roughness a real world would have to be within. Reported, not asserted: what it is worth
    // is the owner's to judge by standing one on a hillside.
    note(`a spot is refused past ${HOUSE_TUNE.rise} m of ground over the doorstep, ${HOUSE_TUNE.sink} m falling away, or ${HOUSE_TUNE.slope} degrees of tilt; all three are ours`);
  }
}

// ---------------------------------------------------------------- the real ground
//
// What the thresholds are worth cannot be argued from a fixture: a house is put down on a world's
// own ground, and the question is what share of that ground will take one. So where a world is
// converted this generates its ground -- the very generator the browser runs, out of the very file
// the pack carries -- and tries a real house's patch at a lattice of spots over it. Nothing here
// reads the archives and nothing compares the ground against itself: the ground is the ground, and
// what is measured is our own two numbers against it.
{
  const { existsSync: has } = await import('node:fs');
  const worlds = ['tatooine', 'naboo', 'corellia'].filter((p) => has(join('assets-private', p, 'terrain.trn')));
  if (!worlds.length) {
    note('no converted world here, so the thresholds are not measured against real ground');
  } else {
    const { parseTerrainTemplate, TerrainSampler } = await import('../../../src/swg/terrain/trn.ts');
    // A medium house's patch, read off the pack and written out so this runs without one.
    const patch: Patch = { hx: 11.8, hz: 13.0, cx: -0.5, cz: 3.1 };
    const reach = 2000;
    const step = 137; // a prime-ish stride, so the lattice does not land on the terrain's own grid
    const allBind = { over: 0, under: 0, steep: 0 };
    for (const planet of worlds) {
      const dir = join('assets-private', planet);
      const template = parseTerrainTemplate(new Uint8Array(readFileSync(join(dir, 'terrain.trn'))));
      const sampler = new TerrainSampler(template);
      let tried = 0;
      let took = 0;
      const by = { over: 0, under: 0, steep: 0 };
      for (let z = -reach; z <= reach; z += step) {
        for (let x = -reach; x <= reach; x += step) {
          const probes = patchProbes(patch, { x, z }, 0);
          const heights = probes.map((q) => sampler.heightAt(q.x, q.z));
          // Under the sea is not a spot at all and is no business of the ground test's.
          if (heights.some((h) => !Number.isFinite(h))) continue;
          const v = groundVerdict(probes, heights);
          tried++;
          if (v.ok) took++;
          else if (v.why!.includes('over the doorstep')) by.over++;
          else if (v.why!.includes('falls')) by.under++;
          else by.steep++;
        }
        sampler.invalidateAll();
      }
      const share = (100 * took) / Math.max(1, tried);
      assert.ok(tried > 100, `${planet}: enough spots were tried (${tried})`);
      // A threshold that takes almost nowhere is useless and one that takes everywhere is not a
      // test. Both ends are ours and both are wide, because what is wanted here is to catch a
      // number that is wrong by an order of magnitude, not to pin a tuning nobody has seen yet.
      assert.ok(share > 2, `${planet}: some of the open ground will take a house (${share.toFixed(1)}%)`);
      assert.ok(share < 99, `${planet}: the test refuses somewhere (${share.toFixed(1)}%)`);
      passed++;
      console.log(`ok   ${planet}: ${share.toFixed(1)}% of ${tried} spots across a 4 km square would take a medium house`);
      note(`     refused ${((100 * by.over) / tried).toFixed(0)}% for ground over the doorstep, ${((100 * by.under) / tried).toFixed(0)}% for ground falling away, ${((100 * by.steep) / tried).toFixed(0)}% for the slope`);
      // The one thing this really pins: all three tests must be doing work somewhere, or one of
      // them is the others in disguise, which is exactly what the first cut of this rule was.
      allBind.over += by.over;
      allBind.under += by.under;
      allBind.steep += by.steep;
    }
    ok(
      allBind.over > 0 && allBind.under > 0 && allBind.steep > 0,
      `all three tests refuse real ground somewhere (${allBind.over} over the doorstep, ${allBind.under} falling away, ${allBind.steep} too steep)`,
    );

    // And what the world already has standing on it. The layout is the very file the streamer reads
    // and the sizes are the models' own, so this is the same answer the game gives -- including the
    // mirror, which is the streamer's and not the pack's.
    for (const planet of worlds) {
      const dir = join('assets-private', planet);
      if (!has(join(dir, 'layout.json')) || !has(join(dir, 'manifest.json'))) continue;
      const layout = JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf8')) as {
        center: { x: number; z: number };
        objects: { model: string; template: string; x: number; z: number; radius: number; contained?: boolean }[];
      };
      const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { categories: Record<string, { id: string; bounds?: { min: number[]; max: number[] }; particle?: boolean }[]> };
      const sizeOf = new Map<string, number>();
      for (const d of Object.values(manifest.categories).flat()) sizeOf.set(d.id, d.particle ? Number.NaN : modelReach(d.bounds));
      const standing: Standing[] = [];
      for (const o of layout.objects) {
        if (o.contained) continue;
        // The model's own box and nothing else. The snapshot's radius is a load distance: taken as
        // a size it refused all of one world, and the commonest thing in the way on another was a
        // cloud of insects. See `LayoutStreamer.objectsNear`, which this is the mirror of.
        const radius = sizeOf.get(o.model) ?? Number.NaN;
        if (!(radius > 0)) continue;
        // The streamer's own mirror, which is where snapshot space and the world meet.
        standing.push({ x: -(o.x - layout.center.x), z: o.z - layout.center.z, radius, template: o.template });
      }
      let tried = 0;
      let blocked = 0;
      let worst = { name: '', n: 0 };
      const by = new Map<string, number>();
      for (let z = -reach; z <= reach; z += step) {
        for (let x = -reach; x <= reach; x += step) {
          tried++;
          const hit = blockedBy(patch, { x, z }, 0, standing);
          if (!hit) continue;
          blocked++;
          const name = blockerName(hit.template);
          const n = (by.get(name) ?? 0) + 1;
          by.set(name, n);
          if (n > worst.n) worst = { name, n };
        }
      }
      const share = (100 * blocked) / Math.max(1, tried);
      // Both ends are wide on purpose: this is to catch a rule that refuses a whole planet (which
      // is exactly what reading the snapshot's own radius as a size would do -- see floraClear.ts)
      // or one that never refuses anything at all.
      assert.ok(share < 60, `${planet}: what is already built does not refuse most of the world (${share.toFixed(1)}%)`);
      passed++;
      console.log(`ok   ${planet}: ${share.toFixed(1)}% of ${tried} spots have something of the world's own already standing there`);
      note(`     over ${standing.length} placed objects; the commonest thing in the way is "${worst.name}" (${worst.n} spots)`);
    }
  }
}

console.log(`\n${passed} checks passed`);
