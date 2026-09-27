// The people who stand somewhere and stay there, driven headless.
//
// Where the real packs are converted it then stands a real town, which is the only way to know that
// numbers tuned on a fixture behave over four thousand rows half of which are indoors.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { StandingPeople, PEOPLE_TUNE, standsStill, type PeopleCreature, type PeopleDeps, type StandingRow } from '../../../src/world/standingPeople.ts';
import { intoWorld } from '../../../src/world/wildLife.ts';
import { hostileSides, sideOf } from '../../../src/combat/targets.ts';
import { childInWorld, type ChildPlace } from '../../../src/world/travelTerminal.ts';
import type { Aggression } from '../../../src/combat/kit.ts';
import type { MobileEntry } from '../../../src/world/mobiles/types.ts';
import { BRAIN_TUNE, clampWander, decide, keepPost, type BrainSelf, type Decision, type Post } from '../../../src/world/mobiles/brain.ts';
import { gravityFor, holdAir } from '../../../src/world/mobiles/airless.ts';
import { Physics, RAPIER } from '../../../src/core/physics.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}

interface Body {
  dead: boolean;
  removed: boolean;
  x: number;
  z: number;
  y: number | undefined;
  heading: number | undefined;
  inside: boolean;
  seed: number;
  homeX?: number;
  homeZ?: number;
  post?: Post | null;
  /** In a fight or holding a grudge (`Mobile.engaged`): never put down to make room. */
  engaged?: boolean;
  /** What it was stood as: part of the furniture, and with whose temper. */
  essential?: boolean;
  temper?: string;
  /** Which catalogue entry it is. */
  id?: string;
}

function game(over: Partial<PeopleDeps> = {}): { deps: PeopleDeps; bodies: Body[] } {
  const bodies: Body[] = [];
  const deps: PeopleDeps = {
    catalogue: () => ({ byId: (id: string) => ({ id, name: id, ready: true }) }) as never,
    spawn: (entry, at, inside, seed, essential, temper) => {
      const b: Body = { dead: false, removed: false, x: at.x, z: at.z, y: at.y, heading: at.heading, inside, seed, essential, temper, id: (entry as { id: string }).id };
      bodies.push(b);
      return b as never;
    },
    remove: (m) => {
      (m as unknown as Body).removed = true;
    },
    centre: () => ({ x: 0, z: 0 }),
    held: () => false,
    ...over,
  };
  return { deps, bodies };
}

/** The bodies still standing: stood, not taken down, not dead. */
const standing = (bodies: Body[]): Body[] => bodies.filter((b) => !b.removed && !b.dead);

const row = (over: Partial<StandingRow> = {}): StandingRow => ({ who: 'somebody', id: 'body', x: 0, y: 10, z: 0, heading: 0, cell: 0, respawn: 300, where: 'static_spawns', ...over });

// ------------------------------------------------------------------ who stands still

{
  // Read off the emulator's own pvp status bitmask, not guessed at: a body with no ATTACKABLE bit is
  // one no player could ever have struck, which is a vendor, a trainer or a quest-giver.
  const of = (pvp: string[] | undefined) => ({ id: 'x', stats: { core3: pvp ? { pvp } : undefined } }) as never;
  ok(standsStill(of(['NONE'])), 'a body the server marked unattackable stands still and cannot be hurt');
  ok(!standsStill(of(['ATTACKABLE'])), 'and one that could be attacked is an ordinary body');
  ok(!standsStill(of(['AGGRESSIVE', 'ATTACKABLE', 'ENEMY'])), 'however the bits are ordered');
  // A catalogue built with no emulator checkout carries no block at all, and then nobody is
  // essential and the game is exactly what it was.
  ok(!standsStill(of(undefined)), 'a catalogue with no emulator stats makes nobody essential');
  ok(!standsStill(null) && !standsStill(undefined), 'and nothing at all is nobody');

  // Over the real catalogue, if it is here: the count is checked against `aggression: passive`,
  // which is a **second field of the same data** and so an independent witness that the rule reads
  // the right thing. They are not identical and are not meant to be -- the bitmask says whether a
  // body may be struck and the aggression says how it behaves, and 11 of the 2,105 bodies with an
  // emulator row differ between the two. What matters is that they agree to within a couple of
  // percent, which a rule reading the wrong field could not do.
  const cat = join('assets-private', 'mobiles', 'catalogue.json');
  if (!existsSync(cat)) note('no mobiles catalogue here, so the rule is not checked against the real one');
  else {
    const file = JSON.parse(readFileSync(cat, 'utf8')) as Record<string, unknown>;
    const list = (Object.values(file).find((v) => Array.isArray(v) && v.length > 1000) ?? []) as { stats?: { aggression?: string; core3?: { pvp?: string[] } } }[];
    const withBits = list.filter((e) => Array.isArray(e.stats?.core3?.pvp));
    const essential = withBits.filter((e) => standsStill(e as never));
    const passive = withBits.filter((e) => e.stats?.aggression === 'passive');
    ok(essential.length > 0, `${essential.length} of the catalogue's ${withBits.length} bodies with an emulator row are essential`);
    const apart = Math.abs(essential.length - passive.length) / Math.max(1, passive.length);
    assert.ok(apart < 0.05, `and that is within a few of how many the same data calls passive (${essential.length} against ${passive.length})`);
    passed++;
    console.log(`ok   and within ${(apart * 100).toFixed(1)}% of how many the same data calls passive (${passive.length}), which is a second field agreeing`);
  }
}

// ------------------------------------------------------------------ what is taken and what is refused
{
  const p = new StandingPeople();
  p.adopt([row(), row({ x: 5 })]);
  ok(p.ready && p.last.rows === 2, 'the rows a pack carries are taken');

  // A row indoors whose room could not be resolved is a spot in a cell and nowhere on a planet.
  const half = new StandingPeople();
  half.adopt([row(), row({ cell: 4235585, room: null }), row({ cell: 4235586, room: 2 })]);
  ok(half.last.rows === 2, 'and one indoors whose room was never resolved is refused rather than stood in a field');
  half.adopt(null);
  ok(!half.ready, 'a pack with no rows at all leaves nothing standing');
}

// ------------------------------------------------------------------ standing, keeping, dropping
{
  const p = new StandingPeople();
  p.adopt(Array.from({ length: 12 }, (_, i) => row({ who: `p${i}`, x: i * 4 })));
  const { deps, bodies } = game();
  const at = new THREE.Vector3(0, 0, 0);

  p.step(1, 1, at, deps);
  ok(p.last.stood > 0 && p.last.stood <= PEOPLE_TUNE.perPass, `a pass stands ${p.last.stood}, never more than ${PEOPLE_TUNE.perPass}`);
  for (let i = 0; i < 8; i++) p.step(PEOPLE_TUNE.everySeconds + 0.1, 5 + i * 2, at, deps);
  ok(p.last.up > PEOPLE_TUNE.perPass, `over a few passes ${p.last.up} of them are up`);
  ok(p.last.up <= PEOPLE_TUNE.most, `and never more than ${PEOPLE_TUNE.most} at once`);

  const settled = p.last.up;
  p.step(PEOPLE_TUNE.everySeconds + 0.1, 40, at, deps);
  ok(p.last.stood === 0 && p.last.up === settled, 'standing still stands nobody new, so nothing churns');

  p.step(PEOPLE_TUNE.everySeconds + 0.1, 50, new THREE.Vector3(9000, 0, 9000), deps);
  ok(p.last.up === 0 && bodies.every((b) => b.removed), 'walking away puts every one of them down');
}

// ------------------------------------------------------------------ indoors is a different thing
{
  const p = new StandingPeople();
  p.adopt([row({ who: 'barman', cell: 4235585, room: 1, x: 10, y: 24.5, z: 10 })]);
  let built = false;
  const { deps, bodies } = game({ cellReady: () => built });
  const at = new THREE.Vector3(10, 0, 10);

  p.step(1, 1, at, deps);
  ok(bodies.length === 0 && p.last.waiting === 1, 'somebody in a room is not stood until that building is really built, or they fall through its floor');

  built = true;
  p.step(PEOPLE_TUNE.everySeconds + 0.1, 5, at, deps);
  ok(bodies.length === 1, 'and is stood once it is');
  ok(bodies[0].inside === true, 'stood as inside, which is what the ground check and the colliders follow');
  ok(bodies[0].y === 24.5, "and at the height the converter carried out of that room's own frame, not the terrain under the building");

  // Outdoors the height is the manager's to find, for the reason the wildlife learned the hard way.
  const out = new StandingPeople();
  out.adopt([row({ x: 3, z: 3 })]);
  const g2 = game();
  out.step(1, 1, new THREE.Vector3(3, 0, 3), g2.deps);
  ok(g2.bodies.length === 1 && g2.bodies[0].y === undefined, 'while outdoors no height is given at all, so the manager finds whatever is standing on that ground');
}

// ------------------------------------------------------------------ killed, and back on the server's own clock
{
  const p = new StandingPeople();
  p.adopt([row({ respawn: 300 })]);
  const { deps, bodies } = game();
  const at = new THREE.Vector3(0, 0, 0);
  p.step(1, 1, at, deps);
  ok(bodies.length === 1, 'one stood');

  bodies[0].dead = true;
  p.step(PEOPLE_TUNE.everySeconds + 0.1, 10, at, deps);
  ok(bodies.length === 1, 'killed, and not stood again at once');
  p.step(PEOPLE_TUNE.everySeconds + 0.1, 200, at, deps);
  ok(bodies.length === 1, 'nor a moment before its own wait is out');
  p.step(PEOPLE_TUNE.everySeconds + 0.1, 320, at, deps);
  p.step(PEOPLE_TUNE.everySeconds + 0.1, 322, at, deps);
  ok(bodies.length === 2, "and stood again once it is, on the row's own respawn rather than a number of ours");
}

// ------------------------------------------------------------------ a respawn of nought is never
{
  // The server ran a body's timer only when it was above nought: a bunker's boss, a trainer, an event's
  // visitor, written with nought, stayed down once killed. Read as "back in a second" they were stood
  // again at their posts on the very next pass.
  const p = new StandingPeople();
  p.adopt([row({ respawn: 0 }), row({ z: 3, respawn: 0 })]);
  const { deps, bodies } = game();
  const at = new THREE.Vector3(0, 0, 0);
  p.step(1, 1, at, deps);
  ok(bodies.length === 2, 'two stood whose rows say nought');
  bodies[0].dead = true;
  bodies[1].removed = true;
  for (let t = 10; t < 700; t += 2) p.step(PEOPLE_TUNE.everySeconds + 0.1, t, at, deps);
  ok(bodies.filter((b) => b.z === 0).length === 1 && p.last.down === 1, 'the one killed is never stood again');
  ok(bodies.filter((b) => b.z === 3).length === 2, 'while the one the game merely took away (fallen out of the world) comes straight back');
  p.step(PEOPLE_TUNE.everySeconds + 0.1, 800, new THREE.Vector3(9000, 0, 0), deps);
  p.step(PEOPLE_TUNE.everySeconds + 0.1, 802, at, deps);
  p.step(PEOPLE_TUNE.everySeconds + 0.1, 804, at, deps);
  ok(bodies.filter((b) => b.z === 0).length === 1, 'nor by walking away and coming back, which would be a respawn by another name');
}

// ------------------------------------------------------------------ what the town says about the one standing there
{
  // The body's catalogue entry is one creature's out of every one drawn as that body; the row's own
  // creature says its temper and whether it may be struck, and the town says who it stood still and
  // who it made part of the furniture whatever body they drew.
  const creatures = {
    guard: { game: { aggression: 'defensive', attackable: true } },
    trainer: { game: { aggression: 'passive', attackable: false } },
    stroller: { game: { aggression: 'aggressive', attackable: true } },
    odd: { game: { aggression: 'furious', attackable: 'yes' } },
  };
  const p = new StandingPeople();
  p.adopt(
    [
      row({ who: 'guard', id: 'furniture_body', z: 1, still: true }),
      row({ who: 'trainer', id: 'body', z: 2 }),
      row({ who: 'stroller', id: 'body', z: 3, peaceful: true }),
      row({ who: 'odd', id: 'body', z: 4 }),
      row({ who: 'nobody', id: 'furniture_body', z: 5 }),
      row({ who: 'constructor', id: 'body', z: 6 }),
    ],
    creatures,
  );
  const unstruck = { pvp: ['NONE'] };
  const { deps, bodies } = game({ catalogue: () => ({ byId: (id: string) => ({ id, name: id, ready: true, stats: id === 'furniture_body' ? { core3: unstruck } : {} }) }) as never });
  p.step(0, 0, new THREE.Vector3(0, 0, 0), deps, true);
  const at = (z: number) => bodies.find((b) => b.z === z)!;
  ok(bodies.length === 6, 'all six stand');
  ok(!at(1).essential && at(1).temper === 'defensive' && at(1).post?.kind === 'still', "a town's guard may be struck whatever its body's own entry says, keeps its own creature's temper, and never wanders off its spot");
  ok(at(2).essential === true, 'a trainer whose own creature may not be struck is part of the furniture, whatever its body could once be');
  ok(at(3).essential === true && at(3).post?.kind === 'near', 'one the town made unattackable whatever it drew is part of the furniture too');
  ok(!at(4).essential && at(4).temper === undefined, 'a creature whose numbers read as nothing this game knows stands as its body does');
  ok(at(5).essential === true && at(6).essential === false, 'as does a row whose creature the pack says nothing about, by its body\'s own entry, even one named like a language\'s own word');
}

// ------------------------------------------------------------------ the memory budget full, as the cap full
{
  // People stood on the way in hold the model memory; a nearer one whose body will not fit puts down
  // the farthest who between them give back enough, and nobody at all when they could not.
  let budget = 3;
  const up = (bs: Body[]) => bs.filter((b) => !b.removed && !b.dead).length;
  let bodies: Body[] = [];
  const short = () => Math.max(0, up(bodies) + 1 - budget);
  let freed = 1;
  const g = game({
    short: () => short(),
    frees: () => freed,
  });
  bodies = g.bodies;
  const refuse = g.deps.spawn;
  g.deps.spawn = (entry, at, inside, seed, essential, temper) => (short() > 0 ? 'the creature and NPC models already out fill their memory budget' : refuse(entry, at, inside, seed, essential, temper));
  const p = new StandingPeople();
  p.adopt([row({ who: 'far1', z: 100 }), row({ who: 'far2', z: 104 }), row({ who: 'far3', z: 60 }), row({ who: 'near', z: 1 }), row({ who: 'nearer', z: 0.5 })]);
  p.step(0, 0, new THREE.Vector3(0, 0, 100), g.deps, true);
  ok(up(bodies) === 3 && !bodies.some((b) => b.z < 50), 'three stood by the far ones fill the budget');
  freed = 0;
  p.step(0, 1, new THREE.Vector3(0, 0, 0), g.deps, true);
  ok(up(bodies) === 3 && bodies.every((b) => !b.removed), 'when putting them down would give nothing back, nobody is put down for nothing');
  freed = 1;
  p.step(0, 2, new THREE.Vector3(0, 0, 0), g.deps, true);
  const standingNow = bodies.filter((b) => !b.removed && !b.dead).map((b) => b.z).sort((a, b) => a - b);
  ok(standingNow.join() === '0.5,1,60', `walking up to the near ones, the farthest make room for them, farthest first (${standingNow.join(', ')})`);
  ok(p.last.swapped === 2, 'and each one put down is counted as a swap');
  const before = bodies.length;
  for (let t = 3; t < 12; t++) p.step(PEOPLE_TUNE.everySeconds + 0.1, t * 2, new THREE.Vector3(0, 0, 0), g.deps);
  ok(bodies.length === before, 'and standing there it settles: nothing is put down and stood again pass after pass');
  budget = 99;
}

// ------------------------------------------------------------------ the world holding still
{
  const p = new StandingPeople();
  p.adopt([row()]);
  let holding = true;
  const { deps, bodies } = game({ held: () => holding });
  p.step(10, 10, new THREE.Vector3(0, 0, 0), deps);
  ok(bodies.length === 0, 'a world holding still stands nobody');
  holding = false;
  p.step(10, 20, new THREE.Vector3(0, 0, 0), deps);
  ok(bodies.length === 1, 'and picks up when the hold comes off');
}

// ------------------------------------------------------------------ the frame: the snapshot's, carried into the world's
{
  // Tatooine's own layout centre, and Jabba's enforcer in the Hutt cave where the pack puts him: x and
  // z in the snapshot's frame, as every placed object is. Stood as written, every one of the game's
  // standing people was on the wrong side of the planet.
  //
  // His heading here is a made-up one in the snapshot's frame. The pack's own number for him (0.4189)
  // is not: it was written before the converter carried an indoor facing through the building's turn,
  // so it is his facing in the cave's own frame, and the cave is turned about 72 degrees. Which way a
  // person indoors faces is the converter's to get right (`intoRoom`, tested in core3.test.ts); what is
  // checked here is only that the runtime mirrors whatever snapshot heading it is handed.
  const centre = { x: -1376, z: -3576 };
  const raw = row({ who: 'jabba_enforcer', x: 5185.82, y: 38.83, z: 597.64, heading: 1.1, cell: 4235585, room: 1 });
  const world = intoWorld(raw.x, raw.z, centre);
  ok(Math.abs(world.x - -6561.82) < 1e-6 && Math.abs(world.z - 4173.64) < 1e-6, `the mirror every placed object goes through puts the row at (${world.x.toFixed(2)}, ${world.z.toFixed(2)})`);

  const p = new StandingPeople();
  p.adopt([raw]);
  ok(p.nearest(new THREE.Vector3(), 1).length === 0, 'before a pass has known the centre, a row is in no frame the console can speak of');
  // No centre yet (the pack's layout has not landed): nothing is stood anywhere.
  let known: { x: number; z: number } | null = null;
  const { deps, bodies } = game({ centre: () => known, cellReady: () => true });
  p.step(1, 1, new THREE.Vector3(world.x, 0, world.z), deps);
  ok(bodies.length === 0, 'with no centre known nobody is stood, rather than stood in the wrong frame');

  // Stood where the pack's own numbers say, read as the world's: the old reading, and nobody is there.
  known = centre;
  const wrong = new StandingPeople();
  wrong.adopt([raw]);
  const g2 = game({ centre: () => centre, cellReady: () => true });
  wrong.step(1, 1, new THREE.Vector3(raw.x, 0, raw.z), g2.deps);
  ok(g2.bodies.length === 0, 'standing at the unmirrored spot finds nobody, which is where every one of them used to stand');

  p.step(PEOPLE_TUNE.everySeconds + 0.1, 5, new THREE.Vector3(world.x, 0, world.z), deps);
  ok(bodies.length === 1, 'standing at the mirrored spot stands him');
  const b = bodies[0];
  ok(Math.abs(b.x - world.x) < 1e-6 && Math.abs(b.z - world.z) < 1e-6, `at the mirrored spot itself (${b.x.toFixed(2)}, ${b.z.toFixed(2)})`);
  ok(b.y === raw.y, 'at the height the pack gave, which the mirror leaves alone');
  ok(b.heading !== undefined && Math.abs(b.heading - -1.1) < 1e-9, `and facing the mirrored way, the snapshot's heading negated (${b.heading})`);
  ok(b.homeX === b.x && b.homeZ === b.z, 'with his home on his own spot, in the same frame');
  ok(b.post?.kind === 'near' && b.post.heading === b.heading && b.post.tune === PEOPLE_TUNE, 'and a post there that keeps him to it, facing the way he was stood');

  const near = p.nearest(new THREE.Vector3(world.x + 3, 0, world.z), 1)[0];
  ok(Math.abs(near.x - world.x) < 0.1 && near.away === 3 && near.indoors && near.y === 38.8 && near.room === 1, `and the console speaks of him in the world's frame, with his floor's height and room (${JSON.stringify(near)})`);
  const rep = p.report(new THREE.Vector3(world.x, 0, world.z + 4));
  ok(rep.length === 1 && rep[0].away === 4 && rep[0].up, 'and so does its report of who is standing');

  // Adopting the same pack again carries its rows again, once, and never twice over.
  const again = new StandingPeople();
  const rows = [raw];
  again.adopt(rows);
  const g3 = game({ centre: () => centre, cellReady: () => true });
  again.step(1, 1, new THREE.Vector3(world.x, 0, world.z), g3.deps);
  again.adopt(rows);
  again.step(1, 1, new THREE.Vector3(world.x, 0, world.z), g3.deps);
  ok(raw.x === 5185.82 && g3.bodies.length === 2 && g3.bodies.every((x) => Math.abs(x.x - world.x) < 1e-6), "the pack's own rows are left as it wrote them, so a second adoption is mirrored once and not twice");
}

// ------------------------------------------------------------------ nearest first
{
  // A hand-made crowd the size of Corellia's busiest spot: 159 people inside the stand-in radius, in
  // the file in an order that has nothing to do with distance. The file order used to decide who
  // stood, so forty people fifty to seventy metres off stood while the ones beside the player never did.
  let s = 7;
  const rand = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const crowd = Array.from({ length: 159 }, (_, i) => {
    const a = rand() * Math.PI * 2;
    const d = 2 + rand() * (PEOPLE_TUNE.build - 4);
    // Mirrored in the fixture's own frame (centre 0,0): the rows are written as the snapshot writes them.
    return row({ who: `p${i}`, x: -Math.cos(a) * d, z: Math.sin(a) * d });
  });
  const dist = crowd.map((r) => Math.hypot(r.x, r.z));
  const order = dist.map((d, i) => ({ d, i })).sort((a, b) => a.d - b.d);
  const nearest40 = new Set(order.slice(0, PEOPLE_TUNE.most).map((o) => o.i));
  const at = new THREE.Vector3(0, 0, 0);

  const p = new StandingPeople();
  p.adopt(crowd);
  const { deps, bodies } = game();
  p.step(1, 1, at, deps);
  const first = new Set(bodies.map((b) => b.seed));
  ok(first.size === PEOPLE_TUNE.perPass && order.slice(0, PEOPLE_TUNE.perPass).every((o) => first.has(o.i)), `the first pass stands the ${PEOPLE_TUNE.perPass} nearest of 159`);
  for (let i = 0; i < 30; i++) p.step(PEOPLE_TUNE.everySeconds + 0.1, 3 + i * 2, at, deps);
  const up = new Set(standing(bodies).map((b) => b.seed));
  ok(up.size === PEOPLE_TUNE.most, `a crowd of 159 stands ${up.size}, the cap`);
  ok([...up].every((i) => nearest40.has(i)), 'and those are exactly the forty nearest');

  // Behind the loading screen the forced pass stands the whole cap at once, still nearest first.
  const forced = new StandingPeople();
  forced.adopt(crowd);
  const g = game();
  forced.step(0, 0, at, g.deps, true);
  const got = new Set(g.bodies.map((b) => b.seed));
  ok(got.size === PEOPLE_TUNE.most && [...got].every((i) => nearest40.has(i)), 'and a forced pass stands the forty nearest in one go');

  // One of them killed, with a nearer place free: the cap counts the living, not the dead waiting.
  const victim = g.bodies.find((b) => b.seed === order[0].i)!;
  victim.dead = true;
  forced.step(PEOPLE_TUNE.everySeconds + 0.1, 10, at, g.deps);
  ok(forced.last.up === PEOPLE_TUNE.most && forced.last.down === 1, `the dead wait to come back without holding a place in the cap (${forced.last.up} up, ${forced.last.down} down)`);
  ok(g.bodies.some((b) => b.seed === order[PEOPLE_TUNE.most].i), 'so the next nearest stands in the meantime');
}

// ------------------------------------------------------------------ nearest first, walking
{
  // A street 450 m long and 50 wide, three hundred people along it. Nearest first from one spot is
  // not enough: the people stood on the way in used to be kept until they were `drop` behind, so
  // after a short walk the cap was full of the street behind the player and nobody beside them stood.
  let s = 11;
  const rand = (): number => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  // Written as the snapshot writes them, x negated (the fixture's centre is 0,0), so the world's x
  // runs from 0 to 450.
  const street = Array.from({ length: 300 }, (_, i) => row({ who: `s${i}`, x: -(rand() * 450), z: (rand() - 0.5) * 50 }));
  const world = street.map((r) => ({ x: -r.x, z: r.z }));
  const p = new StandingPeople();
  p.adopt(street);
  const { deps, bodies } = game();
  const at = new THREE.Vector3(0, 0, 0);
  p.step(0, 0, at, deps, true);
  const atStart = standing(bodies);
  ok(atStart.length === PEOPLE_TUNE.most, `the cap stands at the start of the street (${atStart.length})`);
  // One of them is in a fight with the player, who walks off: that one is never put down to make room.
  const fighter = atStart.reduce((a, b) => (Math.hypot(b.x, b.z) > Math.hypot(a.x, a.z) ? b : a));
  fighter.engaged = true;

  // Walk 150 m down the street at a walk, a step every half second, then stand there a while.
  let t = 0;
  let swapped = 0;
  for (let x = 0; x <= 150; x += 0.75) {
    at.set(x, 0, 0);
    t += 0.5;
    p.step(0.5, t, at, deps);
    swapped += p.last.swapped;
  }
  for (let i = 0; i < 20; i++) {
    t += PEOPLE_TUNE.everySeconds + 0.1;
    p.step(PEOPLE_TUNE.everySeconds + 0.1, t, at, deps);
  }
  const up = standing(bodies);
  const upSeeds = new Set(up.map((b) => b.seed));
  const away = (i: number): number => Math.hypot(world[i].x - at.x, world[i].z - at.z);
  const order = world.map((_, i) => ({ d: away(i), i })).sort((a, b) => a.d - b.d);
  const nearest = order.slice(0, PEOPLE_TUNE.most);
  const nearestUp = nearest.filter((o) => upSeeds.has(o.i)).length;
  const free = up.filter((b) => !b.engaged);
  const farthest = Math.max(...free.map((b) => away(b.seed)));
  const waiting = order.filter((o) => o.d <= PEOPLE_TUNE.build && !upSeeds.has(o.i));
  const nearestWaiting = waiting.length ? waiting[0].d : Infinity;
  ok(up.length === PEOPLE_TUNE.most, `after walking 150 m the cap is still full (${up.length}), ${swapped} put down on the way to make room`);
  ok(atStart.filter((b) => b !== fighter).every((b) => b.removed), 'and none of the people stood at the start is still standing, although every one of them is nearer than `drop`');
  ok(farthest <= nearestWaiting + PEOPLE_TUNE.swapMargin + 1e-6, `and nobody standing is more than the margin farther off than anybody waiting: the farthest free one is ${farthest.toFixed(1)} m and the nearest waiting ${nearestWaiting.toFixed(1)} m`);
  ok(nearestUp >= PEOPLE_TUNE.most - 8, `so ${nearestUp} of the ${PEOPLE_TUNE.most} nearest are standing, where it was none before`);
  ok(!fighter.removed && upSeeds.has(fighter.seed), `while the one in a fight is still standing ${away(fighter.seed).toFixed(0)} m back: somebody you are fighting does not vanish`);
}

// ------------------------------------------------------------------ the counters say what the last pass did
{
  // Five in rooms whose buildings are not built, and two outdoors, all in range.
  const rows = [
    ...Array.from({ length: 5 }, (_, i) => row({ who: `in${i}`, x: i, cell: 4235585, room: 1 })),
    row({ who: 'out0', x: 20 }),
    row({ who: 'out1', x: 30 }),
  ];
  const p = new StandingPeople();
  p.adopt(rows);
  const { deps, bodies } = game({ cellReady: () => false });
  const at = new THREE.Vector3(0, 0, 0);
  p.step(1, 1, at, deps);
  ok(p.last.waiting === 5, `the five whose rooms are not built are counted as waiting (${p.last.waiting})`);
  ok(p.last.stood === 2 && bodies.length === 2, 'and do not use up the pass, so the two outdoors stand beside them');
  // A step that returns before it looks (too soon, not moved) leaves what the last pass said alone.
  p.step(0.1, 1.1, at, deps);
  ok(p.last.waiting === 5 && p.last.stood === 2, 'and a step that returns early leaves the counters alone, rather than reading nought');
}

// ------------------------------------------------------------------ respawning switched off
{
  const p = new StandingPeople();
  p.adopt([row({ respawn: 300 })]);
  const { deps, bodies } = game();
  const at = new THREE.Vector3(0, 0, 0);
  p.step(1, 1, at, deps);
  p.setRespawns(false);
  try {
    bodies[0].dead = true;
    p.step(PEOPLE_TUNE.everySeconds + 0.1, 10, at, deps);
    p.step(PEOPLE_TUNE.everySeconds + 0.1, 1000, at, deps);
    ok(bodies.length === 1 && p.last.down === 1, 'with respawning off a person killed is not stood again when the clock is out');
    p.step(PEOPLE_TUNE.everySeconds + 0.1, 1010, new THREE.Vector3(9000, 0, 9000), deps);
    p.step(PEOPLE_TUNE.everySeconds + 0.1, 1020, at, deps);
    ok(bodies.length === 1, 'nor by walking away and coming back, which would be a respawn by another name');
    p.setRespawns(true);
    p.step(PEOPLE_TUNE.everySeconds + 0.1, 1030, at, deps);
    p.step(PEOPLE_TUNE.everySeconds + 0.1, 1040, at, deps);
    ok(bodies.length === 2, 'and turned on again, one long dead comes back at once');

    // Taken away is not killed. The game takes a body away without a fight -- one that fell out of the
    // world, say -- and **disposing a mobile sets `dead` as well as `removed`**, so a test setting only
    // `removed` would pass while the real thing failed. What tells the two apart is the corpse: a kill
    // is dead and still there for a pass or more, a disposal is dead and gone in the same instant.
    p.setRespawns(false);
    const lost = bodies[1];
    lost.dead = true;
    lost.removed = true;
    p.step(PEOPLE_TUNE.everySeconds + 0.1, 1100, at, deps);
    ok(p.report(at)[0]?.dead === false, "a person the game took away is not reported as killed");
    p.step(PEOPLE_TUNE.everySeconds + 0.1, 1100 + 300 + 1, at, deps);
    p.step(PEOPLE_TUNE.everySeconds + 0.1, 1100 + 300 + 3, at, deps);
    ok(bodies.length === 3 && !bodies[2].removed, 'and comes back on its own clock with respawning off, where only somebody killed stays down');
  } finally {
    p.setRespawns(true);
  }

  // The live knob moves a number only for one of its own kind.
  const had = { most: PEOPLE_TUNE.most, postEvery: [...PEOPLE_TUNE.postEvery] };
  const moved = p.retune({ most: 12, postEvery: [4, 9], build: 'far', nonsense: 3, respawns: 'no' });
  ok(moved.join() === 'most,postEvery' && PEOPLE_TUNE.most === 12 && PEOPLE_TUNE.postEvery[1] === 9 && PEOPLE_TUNE.build === 110 && PEOPLE_TUNE.respawns === true, `the live knob moves what it is given of the right kind and nothing else (${moved.join()})`);
  p.retune({ most: had.most, postEvery: had.postEvery });
}

// ------------------------------------------------------------------ a post keeps a person to their spot
{
  const post = (kind: 'near' | 'still'): Post => ({ kind, heading: 1.2, tune: PEOPLE_TUNE });
  const blank = (over: Partial<Decision> = {}): Decision => ({ state: 'idle', targetKey: null, moveTo: null, pace: 'stand', posture: 'stand', cover: false, face: null, attack: null, emote: null, wanderAt: 0, goal: null, until: 0, blockedSince: null, forgetKey: null, forgetUntil: 0, clearMemory: false, ...over });
  const me = { x: 100, z: 50, homeX: 100, homeZ: 50, now: 40 };
  const r = (): number => 0.5;

  // The brain's own wander, twenty metres out, is drawn again inside the post along the same bearing.
  const g = { x: 120, z: 50 };
  const d = blank({ state: 'wander', goal: g, moveTo: g, face: g, pace: 'walk', wanderAt: 45 });
  keepPost(d, me, post('near'), 0, BRAIN_TUNE, r);
  const off = Math.hypot(g.x - me.homeX, g.z - me.homeZ);
  ok(off <= PEOPLE_TUNE.postRadius + 1e-9 && g.x > me.homeX, `a near post wanders ${off.toFixed(2)} m, inside its ${PEOPLE_TUNE.postRadius} m and the way the brain meant`);
  ok(d.wanderAt >= me.now + PEOPLE_TUNE.postEvery[0] && d.wanderAt <= me.now + PEOPLE_TUNE.postEvery[1], `and its next wander is ${(d.wanderAt - me.now).toFixed(1)} s off, the post's own clock rather than the brain's few seconds`);
  const inside = { x: 101, z: 50 };
  const d2 = blank({ state: 'wander', goal: inside, moveTo: inside, face: inside, pace: 'walk', wanderAt: 7 });
  keepPost(d2, me, post('near'), 7, BRAIN_TUNE, r);
  ok(inside.x === 101 && d2.wanderAt === 7, 'a wander already inside the post is left alone, and so is a clock the brain did not reset');

  // A fight is the brain's alone.
  const fight = blank({ state: 'chase', targetKey: 9, moveTo: { x: 140, z: 50 }, pace: 'run', wanderAt: 3 });
  keepPost(fight, me, post('still'), 3, BRAIN_TUNE, r);
  ok(fight.state === 'chase' && fight.moveTo?.x === 140, 'a post attacked fights like anything else: the chase is untouched');

  // Still: never wanders; walks back after a fight; turns back to the way it was stood.
  const s1 = blank({ state: 'wander', goal: { x: 120, z: 50 }, moveTo: { x: 120, z: 50 }, pace: 'walk' });
  keepPost(s1, me, post('still'), 0, BRAIN_TUNE, r);
  ok(s1.state === 'idle' && s1.goal === null && s1.pace === 'stand', 'a still post never takes a wander');
  const away = { ...me, x: 110 };
  const s2 = blank();
  keepPost(s2, away, post('still'), 0, BRAIN_TUNE, r);
  ok(s2.state === 'wander' && s2.goal?.x === me.homeX && s2.pace === 'walk', 'left ten metres off its spot by a fight, it walks back');
  const s3 = blank({ state: 'wander', goal: { x: me.homeX, z: me.homeZ }, moveTo: { x: me.homeX, z: me.homeZ }, pace: 'walk' });
  keepPost(s3, { ...me, x: 106 }, post('still'), 0, BRAIN_TUNE, r);
  ok(s3.state === 'wander', 'and that one walk is not cancelled on the way');
  const s4 = blank();
  keepPost(s4, me, post('still'), 0, BRAIN_TUNE, r);
  const facing = s4.face ? Math.atan2(s4.face.x - me.x, s4.face.z - me.z) : NaN;
  ok(Math.abs(facing - 1.2) < 1e-9, 'and home, it turns back to the way it was stood facing');

  // The brain itself, run for ten minutes with a near post: every step inside the post.
  const self: BrainSelf = { key: 5, x: 0, y: 0, z: 0, heading: 0, homeX: 0, homeZ: 0, side: 'neutral' as never, aggression: 'defensive', inside: false, big: false, reach: 1, ranged: 0, melee: true, halfHeight: 0.9, hpRatio: 1, state: 'idle', targetKey: null, stuck: 0, now: 0, wanderAt: 1, goal: null, until: 0, blockedSince: null, forgetKey: null, forgetUntil: 0 };
  let worst = 0;
  let wanders = 0;
  let last = -Infinity;
  let gap = Infinity;
  for (let t = 0; t < 600; t += 0.5) {
    self.now = t;
    const was = self.wanderAt;
    const dd = decide(self, []);
    keepPost(dd, self, post('near'), was);
    if (dd.state === 'wander' && dd.goal && self.state !== 'wander') {
      wanders++;
      gap = Math.min(gap, t - last);
      last = t;
      worst = Math.max(worst, Math.hypot(dd.goal.x, dd.goal.z));
      // It arrives at once, as if it had walked there.
      self.x = dd.goal.x;
      self.z = dd.goal.z;
    }
    self.state = dd.state;
    self.goal = dd.goal;
    self.wanderAt = dd.wanderAt;
  }
  ok(wanders > 10 && worst <= PEOPLE_TUNE.postRadius + 1e-9, `over ten minutes a near post stepped about ${wanders} times, never more than ${worst.toFixed(2)} m from its spot`);
  ok(gap >= PEOPLE_TUNE.postEvery[0] - 0.5, `and never sooner than ${gap.toFixed(1)} s after the last, the post's own clock`);

  // Indoors, anything's wander is pulled inside the indoor leash, the fighters' own rule.
  const far = { x: 30, z: 0 };
  const w = blank({ state: 'wander', goal: far, moveTo: far, face: far });
  clampWander(w, 0, 0, BRAIN_TUNE.leashInside * BRAIN_TUNE.wanderInsideShare);
  ok(Math.abs(far.x - BRAIN_TUNE.leashInside * BRAIN_TUNE.wanderInsideShare) < 1e-9, `a thirty-metre wander indoors is pulled to ${far.x} m, inside the ${BRAIN_TUNE.leashInside} m leash, so the body does not pace out and back`);
}

// ------------------------------------------------------------------ a room with no floor under it just now
{
  // A building's colliders come and go with the player's distance while a body's room goes on
  // answering from model data, so a person left in a building the player walked away from stands on
  // a floor that is not there. Tried on a real rapier body, since rapier loads under node: nothing
  // under it at all, which is exactly a room whose colliders have gone.
  await Physics.create();
  const physics = Physics.local();
  const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 24.5, 0));
  physics.world.createCollider(RAPIER.ColliderDesc.capsule(0.55, 0.35), body);
  // Already falling when the room loses its floor, as a body stepping off a stair would be.
  body.setLinvel({ x: 0.5, y: -3, z: 0 }, true);
  for (let i = 0; i < 120; i++) {
    holdAir(body);
    physics.stepOnce();
  }
  ok(Math.abs(body.translation().y - 24.5) < 1e-3 && body.gravityScale() === 0, `held for two seconds with nothing under it, it keeps its height (${body.translation().y.toFixed(3)} m)`);
  ok(body.translation().x > 0.5, 'and goes on walking along the floor it thinks it has, since only the fall is taken off');
  body.setGravityScale(gravityFor(false, false, false, false), true);
  for (let i = 0; i < 30; i++) physics.stepOnce();
  ok(body.translation().y < 24, 'let go, it falls again, which is what the floor coming back is for');

  // The gravity a body takes when its floor comes back or it is handed back from another browser.
  ok(gravityFor(true, false, false, false) === 0, 'no floor, no gravity');
  ok(gravityFor(false, true, false, false) === 0 && gravityFor(false, false, true, false) === 0, 'a swimmer and a living flyer take none either');
  ok(gravityFor(false, false, true, true) === 1, 'but a dead flyer falls, so a floor coming back under one that died without it does not hang the corpse in the air');
  ok(gravityFor(false, false, false, false) === 1, 'and anything else on the ground takes it all');

  // The wiring, read as text: `mobile.ts`, `manager.ts` and `world.ts` are browser modules that drag
  // the whole world in, and every line below compiles just as well deleted.
  const src = (p: string): string => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const mobile = src('world/mobiles/mobile.ts');
  const manager = src('world/mobiles/manager.ts');
  const worldSrc = src('world/world.ts');
  ok(/m\.setAirless\(held\.cell !== null && !\(this\.deps\.cellSolid\?\.\(held\.cell\) \?\? true\)\);/.test(manager), "the manager asks every frame whether a body's room has collision under it");
  // The mobiles' deps are the ones whose room falls back on nothing; the fighters' still fall back on
  // the player's, since a fighter is stood beside the player.
  ok(/cellAt: \(p\) => this\.layoutStream\?\.buildingAt\(p\) \?\? null,[\s\S]{0,700}cellSolid: \(state\) => this\.layoutStream\?\.cellsSolid\(state\) \?\? true,/.test(worldSrc), "the world answers it from the streamer's own colliders, and a body stood where no room holds it is in no room, never in the player's");
  ok((mobile.match(/if \(this\.airless\) holdAir\(this\.body\);/g) ?? []).length >= 2, 'a body in such a room is held after everything else that writes a velocity, alive and dead');
  ok(/if \(airless\) holdAir\(this\.body\);\s*else this\.body\.setGravityScale\(gravityFor\(false, this\.swimming, this\.flyer, this\.dead\), true\);/.test(mobile), 'and takes the gravity the rule gives when its floor comes back');
  ok(/setGravityScale\(gravityFor\(this\.airless, this\.swimming, this\.flyer, this\.dead\), true\)/.test(mobile), 'and when it is handed back from another browser');
  ok(/grounded = gd !== null \|\| this\.airless \|\|/.test(mobile), 'and counts as standing, so it does not play a fall');

  // The post and the indoor wander, which the brain's own tests reach only through a copy of `think`.
  ok(/const d = decide\(self, list\);\s*(?:\/\/[^\n]*\n\s*)*if \(this\.post\) keepPost\(d, self, this\.post, self\.wanderAt\);\s*if \(this\.inside\) clampWander\(d, this\.homeX, this\.homeZ, BRAIN_TUNE\.leashInside \* BRAIN_TUNE\.wanderInsideShare\);/.test(mobile), "a body's own thinking keeps a person to their post and every wander indoors inside the leash");

  // The hand-over's reading side, and what the hand-spawn cap and the NPC tab's clear may take.
  ok(/const named = npcNow\(\)\?\.readTarget\(want\) \?\? null;\s*if \(!named\) return;/.test(mobile) && /'key' in named \? t\.key === named\.key : \(t as \{ npcId\?: string \}\)\.npcId === named\.npc/.test(mobile), "a creature handed over reads who it was fighting through the wire's own rule, never as this browser's player");
  ok(/if \(m\.origin === 'spawned' && !this\.worldIds\.has\(m\)\) n\+\+;/.test(manager), "the hand-spawn cap counts only what was stood by hand, never the world's own bodies");
  ok(/if \(m\.origin !== 'spawned' \|\| this\.worldIds\.has\(m\)\) continue;/.test(manager), "and the NPC tab's clear never takes one of the world's");
  ok(/if \(!b \|\| b\.dead \|\| b\.removed \|\| b\.engaged\) continue;/.test(src('world/standingPeople.ts')) && /get engaged\(\): boolean \{/.test(mobile), 'and nobody in a fight is put down to make room for somebody nearer');

  // What the town says about each row reaches the body the world stands, and the budget can make room.
  ok(/standingPeople\.adopt\(wildLife\.peopleRows\(\) as StandingRow\[\], wildLife\.peopleCreatures\(\)\);/.test(worldSrc), "the world hands the people each creature's own numbers with the rows");
  ok(/spawn: \(entry, at, inside, seed, essential, temper\) =>\s*this\.mobiles\?\.spawn\(entry, at, \{ origin: 'spawned', seed, inside, worldId: `stood:\$\{seed\}`, essential, overrides: temper \? \{ aggression: temper \} : undefined \}\)/.test(worldSrc), "and stands each with its own creature's temper over its body's");
  ok(/short: \(entry\) => this\.mobiles\?\.budgetShort\(entry\) \?\? 0,\s*frees: \(m\) => this\.mobiles\?\.freedBy\(m\) \?\? 0,/.test(worldSrc), 'and tells them what the model memory budget is short of and what putting somebody down gives back');
  ok(/spawn\(entry, at, \{ origin: 'spawned', inside, worldId, essential, fixture: true \}\)/.test(worldSrc) && /const cost = budget \? this\.deps\.assets\.wouldCost\(entry, cat\) : 0;/.test(manager) && /this\.whyNot\(entry, cat, opts\.worldId \? 'world' : origin, !opts\.fixture\)/.test(manager), 'and a ticket collector is a fixture the memory budget never keeps off its pad');
}

// ------------------------------------------------------------------ a real town, where converted
{
  const f = join('assets-private', 'tatooine', 'spawns.json');
  const lay = join('assets-private', 'tatooine', 'layout.json');
  if (!existsSync(f) || !existsSync(lay)) {
    note('no converted pack here, so the rules above stand on their own');
  } else {
    const pack = JSON.parse(readFileSync(f, 'utf8')) as { statics: StandingRow[] };
    const centre = (JSON.parse(readFileSync(lay, 'utf8')) as { center: { x: number; z: number } }).center;
    const p = new StandingPeople();
    p.adopt(pack.statics);
    const indoors = pack.statics.filter((r) => r.cell).length;
    note(`a real world carries ${pack.statics.length} people, ${indoors} of them indoors; ${p.last.rows} are standable`);
    ok(p.last.rows > 100, 'which is a world with people in it');

    // Stand the densest place on the planet, in the world's own frame, and see what it costs. The rows
    // measured are the ones the pass takes, in its order, so a body's seed is its index here too.
    const kept = pack.statics.filter((r) => !(r.cell && (r.room === null || r.room === undefined)));
    const world = kept.map((r) => intoWorld(r.x, r.z, centre));
    let best = { x: 0, z: 0, n: 0 };
    for (const r of world) {
      let n = 0;
      for (const o of world) if (Math.hypot(o.x - r.x, o.z - r.z) < PEOPLE_TUNE.build) n++;
      if (n > best.n) best = { x: r.x, z: r.z, n };
    }
    note(`the busiest spot has ${best.n} people within ${PEOPLE_TUNE.build} m of it`);
    const { deps, bodies } = game({ centre: () => centre, cellReady: () => true });
    const at = new THREE.Vector3(best.x, 0, best.z);
    for (let i = 0; i < 30; i++) p.step(PEOPLE_TUNE.everySeconds + 0.1, i * 2, at, deps);
    note(`standing in it put ${p.last.up} up (${p.last.indoors} of them indoors) from ${bodies.length} stood in all`);
    ok(p.last.up <= PEOPLE_TUNE.most, `and never more than ${PEOPLE_TUNE.most} at once, however crowded the place is`);
    ok(p.last.up > 0, 'with somebody really standing there');
    const up = standing(bodies).map((b) => Math.hypot(b.x - at.x, b.z - at.z));
    const farthest = Math.max(...up);
    const left = world.map((w, i) => ({ d: Math.hypot(w.x - at.x, w.z - at.z), i })).filter((o) => o.d <= PEOPLE_TUNE.build && !bodies.some((b) => b.seed === o.i));
    const nearestLeft = Math.min(...left.map((o) => o.d), Infinity);
    ok(farthest <= nearestLeft + 1e-6, `and the ones standing are the nearest: the farthest is ${farthest.toFixed(1)} m and the nearest left standing nobody is ${Number.isFinite(nearestLeft) ? nearestLeft.toFixed(1) : 'none'} m`);

    // **The frame, against a witness that is not this code.** Every check above works its expected
    // places out with the same `intoWorld` the pass uses, so they show only that the two agree; a pack
    // that one day wrote its rows already in the world's frame would pass all of them while the game
    // mirrored every person twice. The client's own placed objects are a second source -- the
    // snapshot, not the emulator's scripts -- and the streamer carries them into the world by its own
    // arithmetic (`LayoutStreamer`, written out here). People stand among things: nine in ten of this
    // world's rows are within thirty metres of one as the pack writes both.
    const layoutObjects = (JSON.parse(readFileSync(lay, 'utf8')) as { objects: { x: number; z: number }[] }).objects;
    const cellOf = (x: number, z: number): string => `${Math.floor(x / 50)},${Math.floor(z / 50)}`;
    const grid = new Map<string, { x: number; z: number }[]>();
    for (const o of layoutObjects) {
      const w = { x: -(o.x - centre.x), z: o.z - centre.z };
      const k = cellOf(w.x, w.z);
      const list = grid.get(k);
      if (list) list.push(w);
      else grid.set(k, [w]);
    }
    const nearThing = (x: number, z: number): boolean => {
      const gx = Math.floor(x / 50);
      const gz = Math.floor(z / 50);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const o of grid.get(`${gx + i},${gz + j}`) ?? []) if (Math.hypot(o.x - x, o.z - z) < 30) return true;
      return false;
    };
    const framed = p.nearest(at, p.last.rows);
    const amongThings = framed.filter((r) => nearThing(r.x, r.z)).length / framed.length;
    const unframed = kept.filter((r) => nearThing(r.x, r.z)).length / kept.length;
    ok(framed.length === kept.length && amongThings > 0.8, `the people as the pass frames them stand among the client's own placed objects: ${(amongThings * 100).toFixed(0)}% within 30 m of one`);
    // A few do by chance -- with the towns read, the mirror of one town's thousand people falls here and
    // there among another place's things -- so the witness is how far apart the two shares are.
    ok(unframed < 0.1 && amongThings > unframed * 8, `while read as the pack writes them, in the world's frame, ${(unframed * 100).toFixed(1)}% do, which is where every one of them used to stand`);

    // And walking through it, which is where the cap stopped being nearest first: stood 90 m west of
    // the busiest spot and walked 180 m east through it at a walk.
    const walk = new StandingPeople();
    walk.adopt(pack.statics);
    const g = game({ centre: () => centre, cellReady: () => true });
    const here = new THREE.Vector3(best.x - 90, 0, best.z);
    walk.step(0, 0, here, g.deps, true);
    let t = 0;
    for (let x = -90; x <= 90; x += 2.5) {
      here.set(best.x + x, 0, best.z);
      t += 0.5;
      walk.step(0.5, t, here, g.deps);
    }
    for (let i = 0; i < 20; i++) {
      t += PEOPLE_TUNE.everySeconds + 0.1;
      walk.step(PEOPLE_TUNE.everySeconds + 0.1, t, here, g.deps);
    }
    const upNow = new Set(standing(g.bodies).map((b) => b.seed));
    const order = world.map((w, i) => ({ d: Math.hypot(w.x - here.x, w.z - here.z), i })).sort((a, b) => a.d - b.d);
    const nearestUp = order.slice(0, PEOPLE_TUNE.most).filter((o) => upNow.has(o.i)).length;
    const farUp = Math.max(...[...upNow].map((i) => Math.hypot(world[i].x - here.x, world[i].z - here.z)));
    const firstWaiting = order.find((o) => o.d <= PEOPLE_TUNE.build && !upNow.has(o.i))?.d ?? Infinity;
    note(`after walking 180 m through it, ${nearestUp} of the ${PEOPLE_TUNE.most} nearest are standing`);
    ok(farUp <= firstWaiting + PEOPLE_TUNE.swapMargin + 1e-6, `and nobody standing is more than the margin farther off than anybody waiting (${farUp.toFixed(1)} m against ${Number.isFinite(firstWaiting) ? firstWaiting.toFixed(1) : 'none'} m)`);
  }
}

// ------------------------------------------------------------------ nobody at a starport opens fire, where converted
{
  // Stand, with the pass itself, the people round every ticket collector on every converted world, as
  // the game would stand them arriving there, and ask the game's own rule who would pick a fight with
  // a player of no faction on sight. The towns hold a few creatures the server really did make
  // aggressive; none of them may be close enough to a collector to see a passenger step off.
  const catFile = join('assets-private', 'mobiles', 'catalogue.json');
  const manFile = join('assets-private', 'spawns', 'manifest.json');
  const man = existsSync(manFile) ? (JSON.parse(readFileSync(manFile, 'utf8')) as { format: number; creatures: Record<string, PeopleCreature> }) : null;
  if (!existsSync(catFile) || !man || man.format < 2) note('no format-2 spawns pack and catalogue here, so the starports are not checked');
  else {
    const entries = new Map((JSON.parse(readFileSync(catFile, 'utf8')) as { entries: MobileEntry[] }).entries.map((e) => [e.id, e]));
    const catalogue = () => ({ byId: (id: string) => entries.get(id) ?? null }) as never;
    const player = { side: 'player' as const, aggression: 'defensive' as const };
    let collectors = 0;
    let stood = 0;
    const near: string[] = [];
    let townHostile = 0;
    for (const w of ['tatooine', 'corellia', 'naboo', 'talus', 'rori', 'lok', 'dantooine', 'dathomir', 'endor', 'yavin4']) {
      const pf = join('assets-private', w, 'spawns.json');
      const tf = join('assets-private', w, 'travel.json');
      if (!existsSync(pf) || !existsSync(tf)) continue;
      const rows = (JSON.parse(readFileSync(pf, 'utf8')) as { statics: StandingRow[] }).statics;
      for (const c of (JSON.parse(readFileSync(tf, 'utf8')) as { rows: (ChildPlace & { kind: string })[] }).rows.filter((r) => r.kind === 'collector')) {
        collectors++;
        const p = new StandingPeople();
        p.adopt(rows, man.creatures);
        const g = game({ catalogue, cellReady: () => true });
        const spot = childInWorld(c, { x: 0, z: 0 });
        p.step(0, 0, new THREE.Vector3(spot.x, 0, spot.z), g.deps, true);
        stood += g.bodies.length;
        for (const b of g.bodies) {
          const e = entries.get(b.id!)!;
          if (b.essential || !hostileSides({ side: sideOf(e), aggression: (b.temper as Aggression | undefined) ?? e.stats?.aggression ?? 'defensive' }, player)) continue;
          const d = Math.hypot(b.x - spot.x, b.z - spot.z);
          if (d <= BRAIN_TUNE.aggro) near.push(`${w}: ${b.id} ${d.toFixed(0)} m`);
        }
      }
      // The whole of the towns as well, for the note: the few the server itself made aggressive.
      const p = new StandingPeople();
      p.adopt(rows.filter((r) => r.where === 'cities'), man.creatures);
      const g = game({ catalogue, cellReady: () => true });
      const had = { most: PEOPLE_TUNE.most, build: PEOPLE_TUNE.build, drop: PEOPLE_TUNE.drop };
      PEOPLE_TUNE.most = 1e6;
      PEOPLE_TUNE.build = 1e6;
      PEOPLE_TUNE.drop = 2e6;
      p.step(0, 0, new THREE.Vector3(0, 0, 0), g.deps, true);
      Object.assign(PEOPLE_TUNE, had);
      for (const b of g.bodies) {
        const e = entries.get(b.id!)!;
        if (!b.essential && hostileSides({ side: sideOf(e), aggression: (b.temper as Aggression | undefined) ?? e.stats?.aggression ?? 'defensive' }, player)) townHostile++;
      }
    }
    note(`${townHostile} of the towns' own people pick a fight with a player of no faction on sight, every one of them a creature the server itself made aggressive`);
    ok(collectors > 20 && stood > collectors * 10, `round ${collectors} ticket collectors the pass stood ${stood} people`);
    ok(near.length === 0, `and not one of them within the ${BRAIN_TUNE.aggro} m a body looks for a fight in picks one with a player stepping off a shuttle${near.length ? `: ${near.join(', ')}` : ''}`);
  }
}

console.log(`\n${passed} checks passed`);
