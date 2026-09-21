// The mark a bolt leaves and the speed it leaves the muzzle at, without a renderer and without a
// physics world: which family each gun's bolt is marked with and in what order the two questions
// are asked, that the one mapping from a name to a family has not drifted away from the marks
// system's own copy of it, the seam the marks system is registered through, and the one multiplier
// that moves every ground gun's speed while leaving the ships' own numbers exactly alone.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENGINE_UNIT, GUN_SPEED, GUNS, boltStretch, groundBoltSpeed, gunSpeedReport, tuneGunSpeed, type GunType } from '../../../src/combat/guns.ts';
import { SCARS, SCAR_FAMILIES, SCAR_STATS, clearScarStats, layScar, marksHold, scarFamilyFor, scarFamilyOf, scarReport, scarSink, setScars, tuneScars, type ScarFamily, type ScarSink } from '../../../src/combat/scars.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol: number, what: string) => ok(Math.abs(a - b) <= tol, `${what} (${a} vs ${b})`);

// The engine unit the guns and the bolts both fly by, read from where it lives rather than typed in
// again: a third copy here would let this test agree with itself while the game did something else.
const UNIT = ENGINE_UNIT;
/** What the tuning was before the test moved it, so every case starts from the shipped numbers. */
const SCARS_SHIPPED = { ...SCARS };
const SPEED_SHIPPED = { ...GUN_SPEED };
const restore = () => {
  tuneScars(SCARS_SHIPPED);
  tuneGunSpeed(SPEED_SHIPPED);
};

// --- which family a gun's bolt is marked with ---------------------------------------------------

// The gun's own type is asked first, because that is the classification the game already makes of
// every gun on the rack out of the client's own weapon table.
ok(scarFamilyOf('blaster') === 'bolt', 'a rifle leaves a plain bolt mark');
ok(scarFamilyOf('bryar') === 'bolt', 'a pistol leaves a plain bolt mark');
ok(scarFamilyOf('rocket') === 'rocket', 'a rocket launcher leaves a char');
ok(scarFamilyOf('slug') === 'slug', 'a slugthrower leaves a pit');
ok(scarFamilyOf('flamethrower') === 'flame', 'a flame gun leaves soot');
ok(scarFamilyOf('lightning') === 'lightning', 'a lightning gun leaves a fork');

// The weapon effect family is the fallback for a shot fired by something with no gun profile at
// all: a turret, a creature, a picture of somebody else's shot off the wire.
ok(scarFamilyOf(null, 'projectile_rifle') === 'slug', 'a projectile family with no gun type is a pit');
ok(scarFamilyOf(null, 'projectile_pistol') === 'slug', 'every projectile family is a pit');
ok(scarFamilyOf(null, 'rocket') === 'rocket', 'a rocket family with no gun type is a char');
ok(scarFamilyOf(null, 'bolt') === 'bolt', 'a bolt family with no gun type is a ring');
ok(scarFamilyOf(null, null) === 'bolt', 'a shot that names nothing at all still leaves a ring');
ok(scarFamilyOf(undefined, undefined) === 'bolt', 'and so does one that names nothing twice');

// The order is the whole of the rule, and it matters where the two disagree: the lightning rifle's
// own effect family is `rocket` (rocket 3 in the client's table is the lightning beam), and what it
// should leave on a wall is a fork and not a crater.
ok(scarFamilyOf('lightning', 'rocket') === 'lightning', "the gun's own type beats its effect family");
// The other way round: a gun whose type says nothing in particular takes its effect family.
ok(scarFamilyOf('blaster', 'projectile_rifle') === 'slug', 'and a type that names no family falls through to the effect family');
// Case is not a promise anybody made: the rack's ids and the pack's families are both hand-written.
ok(scarFamilyOf('SLUG') === 'slug', 'the type is read whatever its case');
ok(scarFamilyOf(null, 'Projectile_Rifle') === 'slug', 'and so is the family');

// Every gun on the rack resolves to one of the five, and nothing falls off the end.
for (const type of Object.keys(GUNS) as GunType[]) {
  const family = scarFamilyOf(type, null);
  assert.ok(SCAR_FAMILIES.includes(family), `${type} marks with something that is not a family`);
}
checks++;
console.log(`ok   every gun on the rack marks with one of the five families`);

// One name, one family, and **one home** for that rule: `scarFamilyFor` here. It was written twice
// while this was being built -- once here and once in the marks system -- and the second copy was
// taken out at the merge, because the marks are asked for a family and draw it and have no business
// reading a gun's name. This is the check that nobody puts the second copy back: the marks system's
// own source is read as text and must hold no rule of this shape at all.
const marksSource = readFileSync(new URL('../../../src/world/marks.ts', import.meta.url), 'utf8');
ok(marksSource.indexOf('function scarFamilyFor') < 0, 'the marks system keeps no second copy of the name-to-family rule');
ok(!/if \(.*?'projectile'.*?\) return 'slug'/.test(marksSource), 'nor any rule of that shape written out under another name');
// And the one home is exported and reachable from a plain node test, which is why it lives on this
// side of the seam rather than in a module that would drag three and the audio bank in behind it.
ok(scarFamilyFor('projectile_rifle') === 'slug', 'a projectile family leaves a slug’s pit');
ok(scarFamilyFor('bolt') === 'bolt', 'the client’s bolt family a blaster scar');
ok(scarFamilyFor('rocket') === 'rocket', 'its rocket family a char');
ok(scarFamilyFor('flame') === 'flame', 'a flame soot');
ok(scarFamilyFor('lightning') === 'lightning', 'and lightning a fork');
ok(scarFamilyFor('') === 'bolt', 'a gun that names no family at all leaves the commonest scar rather than none');
ok(scarFamilyFor(null) === 'bolt', 'and so does one that names nothing');

// --- the seam -----------------------------------------------------------------------------------

restore();
clearScarStats();
setScars(null);
ok(scarSink() === null, 'nothing lays marks until something is registered');
ok(layScar('bolt', 1, 2, 3, 0, 1, 0, 7) === false, 'with nothing registered a bolt leaves nothing');
ok(SCAR_STATS.laid === 0 && SCAR_STATS.refused === 1, 'and the refusal is counted rather than thrown');

/** What the game's marks system is in this test: it writes down what it was handed. */
const seen: { family: ScarFamily; x: number; y: number; z: number; nx: number; ny: number; nz: number; owner: number }[] = [];
let lastAt: object | null = null;
let take = true;
const sink: ScarSink = {
  scar(family, at, normal, opts) {
    lastAt = at;
    seen.push({ family, x: at.x, y: at.y, z: at.z, nx: normal.x, ny: normal.y, nz: normal.z, owner: opts?.owner ?? -1 });
    return take;
  },
};
setScars(sink);
clearScarStats();

ok(layScar('rocket', 1, 2, 3, 0, 5, 0, 42) === true, 'a registered marks system takes the mark');
const first = seen[0];
ok(first.family === 'rocket', 'the family goes over');
near(first.x + first.y + first.z, 6, 1e-9, 'the place goes over');
near(first.ny, 5, 1e-9, 'the normal goes over as it came in, for the marks system to turn the quad on');
ok(first.owner === 42, 'and so does the collider that stopped the bolt, so a mark on a streamed thing can go when it does');
ok(SCAR_STATS.laid === 1 && SCAR_STATS.byFamily.rocket === 1, 'and it is counted under its own family');

// A bolt stopping dead-on inside something gives a normal of no length, and a quad with no normal
// is a quad edge-on to everything: it is refused here rather than handed on to be laid flat.
ok(layScar('bolt', 0, 0, 0, 0, 0, 0, 1) === false, 'a mark with no normal is refused');
ok(SCAR_STATS.refused === 1 && seen.length === 1, 'counted as refused, and never handed over');

// The marks system may refuse one of its own accord (its share of the ring is spent, the sheet has
// not arrived). That is a refusal too and not a mark that was laid.
take = false;
ok(layScar('bolt', 0, 0, 0, 0, 1, 0, 1) === false, 'a marks system that says no is a refusal');
ok(SCAR_STATS.laid === 1 && SCAR_STATS.refused === 2, 'and is counted as one');
take = true;

// Nothing in a step may allocate, so the place and the normal are kept objects handed over again
// and again. Whatever answers must read what it needs and not hold it, which is what this pins.
const before = lastAt;
layScar('slug', 9, 9, 9, 1, 0, 0, 1);
ok(before !== null && lastAt === before, 'the same place object is handed over every time: nothing allocates in a step');
ok(seen[seen.length - 1].family === 'slug' && seen[seen.length - 1].x === 9, 'and what it says is this mark and not the last one');

// The switch: nothing is laid at all, which is the game exactly as it was before scars existed.
tuneScars({ on: 0 });
const laidBefore = SCAR_STATS.laid;
const seenBefore = seen.length;
ok(layScar('bolt', 0, 0, 0, 0, 1, 0, 1) === false, 'SCARS.on 0 lays nothing');
ok(SCAR_STATS.laid === laidBefore && seen.length === seenBefore, 'and asks the marks system for nothing at all');
restore();
ok(SCARS.on > 0, 'and the shipped switch comes back');
tuneScars({ on: -3 });
ok(SCARS.on === 0, 'a switch below nothing is nothing rather than a negative');
restore();

const report = scarReport();
ok(report.wired === true, 'the readout says whether anything is laying marks');
ok(report.on === true && report.byFamily.rocket === 1, 'what is switched on, and what each family has laid');
setScars(null);
ok(scarReport().wired === false, 'and says so when the marks go with the world');

// --- the guns' own speed ------------------------------------------------------------------------

restore();
// The switch the owner types: one multiplier back to 1 and every gun fires at exactly the speed its
// own weapon data gives it, to the last bit. Not "about": the multiplication by 1 is the identity.
tuneGunSpeed({ speed: 1 });
for (const g of Object.values(GUNS)) {
  for (const mode of [g.primary, g.alt]) {
    if (!mode || mode.speed <= 0) continue;
    assert.equal(groundBoltSpeed(mode.speed, UNIT), mode.speed * UNIT, `${g.type} is not exactly its own speed at a multiplier of 1`);
  }
}
checks++;
console.log(`ok   __debug.guns({ speed: 1 }) puts every gun back to exactly the speed its data gives it`);
assert.equal(boltStretch(), 1, 'a multiplier of 1 draws the bolt exactly the length it always was');
checks++;
console.log(`ok   and draws its bolt exactly the length it always was`);

restore();
// What makes these guns feel like the ones they were ported from is their speeds relative to one
// another. A multiplier keeps every one of those ratios; seventeen edited numbers would not.
const rifle = GUNS.blaster.primary.speed;
const slug = GUNS.slug.primary.speed;
const rocketSpeed = GUNS.rocket.primary.speed;
near(groundBoltSpeed(slug, UNIT) / groundBoltSpeed(rifle, UNIT), slug / rifle, 1e-9, 'the slugthrower keeps its multiple of the rifle');
near(groundBoltSpeed(rocketSpeed, UNIT) / groundBoltSpeed(rifle, UNIT), rocketSpeed / rifle, 1e-9, 'and the rocket keeps its fraction of it');
near(groundBoltSpeed(rifle, UNIT), rifle * UNIT * GUN_SPEED.ground, 1e-9, 'and the rifle itself is its own speed times the multiplier');

// A hitscan beam or a cone has no speed to multiply, and must not be given one.
assert.equal(groundBoltSpeed(0, UNIT), 0, 'a hitscan mode stays a hitscan mode');
assert.equal(groundBoltSpeed(-1, UNIT), 0, 'and a speed below nothing is nothing');
checks += 2;
console.log(`ok   a gun with no bolt speed is untouched`);

// The drawn bolt grows with the speed, and is capped so nothing becomes a lance.
restore();
near(boltStretch(), GUN_SPEED.ground, 1e-9, 'at a share of one the bolt is drawn the whole multiplier longer');
tuneGunSpeed({ ground: 20 });
near(boltStretch(), GUN_SPEED.maxStretch, 1e-9, 'however fast the bolt, it is never drawn past the cap');
tuneGunSpeed({ ground: 2.5, stretchShare: 0 });
near(boltStretch(), 1, 1e-9, 'and a share of nothing leaves every bolt the length it always was');
restore();

// A speed below nothing is refused: a bolt that never leaves the muzzle is not a tuning.
tuneGunSpeed({ speed: 0 });
ok(GUN_SPEED.ground > 0, 'the multiplier can never be moved to nothing');
restore();
near(GUN_SPEED.ground, SPEED_SHIPPED.ground, 1e-9, 'and the shipped multiplier comes back');

const speeds = gunSpeedReport();
ok(speeds.guns.length > 10, 'the readout names every trigger that fires a bolt');
ok(speeds.guns.every((r) => r.now > r.was), 'and every one of them is faster than it was');
ok(speeds.guns[0].now < speeds.guns[speeds.guns.length - 1].now, 'sorted slowest first, so the order is read at a glance');
near(speeds.stretch, boltStretch(), 1e-9, 'and says what the bolt is stretched to');
// The readout is built on the very unit the bolts fly by, not on a copy of it: a second copy would
// let these two columns report a speed nothing in the game ever flew at.
for (const row of speeds.guns) {
  const mode = row.trigger === 'primary' ? GUNS[row.gun].primary : GUNS[row.gun].alt;
  assert.ok(mode, `${row.gun}'s ${row.trigger} is in the readout and not on the gun`);
  near(row.was, Number((mode.speed * ENGINE_UNIT).toFixed(2)), 1e-9, `${row.gun} ${row.trigger} was is its own data times the engine unit`);
}
restore();

// --- what may be marked and what may not --------------------------------------------------------

// A mark is a quad laid in the world once and never asked about its surface again, so it may only
// go on something that holds still: the ground, a wall, a building's shell, a streamed prop. On a
// corpse's settling limb or a crate somebody can shove it would slide out of the surface at once and
// then hang in the air for its whole life, since a streamed object's is the only handle anything
// ever forgets.
ok(marksHold({ parent: () => null }) === true, 'a collider with no body at all holds still (the terrain, a prop)');
ok(marksHold({ parent: () => ({ isFixed: () => true }) }) === true, 'and so does one on a fixed body');
ok(marksHold({ parent: () => ({ isFixed: () => false }) }) === false, 'a body that can move takes no mark: a corpse, a crate, a parked hull');
ok(marksHold(null) === false, 'and nothing at all takes none');

// --- the stretch is asked the same question the speed is ----------------------------------------

// `bolts.ts` cannot be imported here (it is three and rapier), so the one line that decides which
// bolts are drawn longer is read as text. It must test `metresPerSecond`, exactly as the speed does:
// gated on anything else -- whether the bolt has a projectile effect, say -- the stretch reaches a
// ship's bolt and a creature's spit, whose lengths are the game's own numbers, and the distance the
// ray leads by grows with it.
const boltsSource = readFileSync(new URL('../../../src/combat/bolts.ts', import.meta.url), 'utf8');
const stretchLine = boltsSource.split('\n').find((l) => l.includes('boltStretch()')) ?? '';
ok(stretchLine.includes('metresPerSecond === undefined'), 'the drawn length is gated on the same test the speed is');
ok(/const vel[^\n]*metresPerSecond \?\? groundBoltSpeed/.test(boltsSource), 'and the speed itself still takes the multiplier only where no speed was handed in');

console.log(`\n${checks} checks passed`);
