// The people who stand somewhere and stay there, driven headless.
//
// Where the real packs are converted it then stands a real town, which is the only way to know that
// numbers tuned on a fixture behave over four thousand rows half of which are indoors.
import assert from 'node:assert/strict';
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { GCW_SIDES, STAYS_DOWN_SECONDS, StandingPeople, PEOPLE_TUNE, overridesOf, personFor, postFor, seedOfRow, standPlaceOf, standsStill, weaponsOf, type PeopleCreature, type PeopleDeps, type PersonSpawn, type PlanContext, type StandingRow } from '../../../src/world/standingPeople.ts';
import { moodIdleName, moodOfRow, pickMoodClip, withMood, type RigVariants } from '../../../src/world/mobiles/moodIdle.ts';
import { buildingWithRoomIn, offRoomBox, ROOM_SLACK, type RoomBuilding } from '../../../src/world/roomOf.ts';
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
  /** Everything else it was stood with: its own numbers, mood, weapons and room. */
  how?: PersonSpawn;
}

function game(over: Partial<PeopleDeps> = {}): { deps: PeopleDeps; bodies: Body[] } {
  const bodies: Body[] = [];
  const deps: PeopleDeps = {
    catalogue: () => ({ byId: (id: string) => ({ id, name: id, ready: true }) }) as never,
    spawn: (entry, at, how) => {
      const b: Body = { dead: false, removed: false, x: at.x, z: at.z, y: at.y, heading: at.heading, inside: how.inside, seed: how.index, essential: how.essential, temper: how.overrides?.aggression, id: (entry as { id: string }).id, how };
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

/**
 * What putting a set of bodies down gives back, counted of the set as the game counts it: `each(b)` for
 * every body in it, and `together` more once every body `with` picks is in it (a piece of a look only
 * those bodies share, which none of them gives back alone).
 */
function setFrees(each: (b: Body) => number, together?: { with: ((b: Body) => boolean)[]; bytes: number }): Pick<PeopleDeps, 'freeStart' | 'frees'> {
  const set: Body[] = [];
  return {
    freeStart: () => {
      set.length = 0;
    },
    frees: (m) => {
      set.push(m as unknown as Body);
      let n = 0;
      for (const b of set) n += each(b);
      if (together && together.with.every((pick) => set.some(pick))) n += together.bytes;
      return n;
    },
  };
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

// ------------------------------------------------------------------ a body somebody else has for now
{
  // A person following the player (src/world/followers.ts) walks with them, as far from its own row as
  // they are: the pass must put it down for nothing -- not its distance, not to make room for somebody
  // nearer, not for model memory, not for a change of the side holding the towns -- and count it under
  // neither cap, while its row stays its row, so a follower killed comes back at its post on the row's own
  // clock. Each case below is built to come out otherwise with the hook taken away from the line it pins.
  const held = new Set<Body>();
  const keeps = (m: unknown): boolean => held.has(m as Body);
  const next = PEOPLE_TUNE.everySeconds + 0.1;
  const at = new THREE.Vector3(0, 0, 0);
  const far = (metres: number) => new THREE.Vector3(0, 0, PEOPLE_TUNE.drop + metres);

  // Its distance.
  const p = new StandingPeople();
  p.adopt([row({ who: 'guard', z: 0 }), row({ who: 'far', z: 60 })]);
  const { deps, bodies } = game({ keeps });
  p.step(1, 1, at, deps);
  const guard = bodies.find((b) => b.z === 0)!;
  ok(!!guard && !guard.removed, 'one stood');
  held.add(guard);
  // The player walks it far off: past `drop` from its row, which would put anybody else down.
  p.step(next, 10, far(200), deps);
  ok(!guard.removed && p.last.up >= 1, 'a body the followers hold is not put down however far the player takes it from its row');
  // Back at its row while it still follows: the row's body is the one following, and nobody is stood there
  // a second time (put down for its distance, the row would have been stood afresh here).
  p.step(next, 12, at, deps);
  ok(bodies.filter((b) => b.z === 0).length === 1 && !guard.removed, 'back at its row while it follows, nobody is stood there a second time');
  // Handed back far off, it is its row's again, and goes on that very pass.
  p.step(next, 14, far(400), deps);
  held.delete(guard);
  p.step(next, 16, far(400), deps);
  ok(guard.removed && p.last.dropped === 1, 'handed back, it is put down for its distance on the next pass, like anybody else');

  // Killed while it follows: its row waits its own clock, as a post's always did, and then comes back.
  const q = new StandingPeople();
  q.adopt([row({ who: 'guard', respawn: 30 })]);
  const g2 = game({ keeps });
  q.step(1, 1, at, g2.deps);
  const f = g2.bodies[0];
  held.add(f);
  q.step(next, 5, far(50), g2.deps);
  f.dead = true;
  held.delete(f);
  q.step(next, 8, at, g2.deps);
  ok(g2.bodies.length === 1, 'a follower killed far from its post is not stood again there at once');
  q.step(next, 40, at, g2.deps);
  ok(g2.bodies.length === 2 && !g2.bodies[1].removed, "it is stood again at its post on the row's own clock");

  const was = PEOPLE_TUNE.most;
  try {
    // The cap: a held body takes no place under it, so with room for one and that one following the
    // player, somebody nearer is still stood -- and the follower is not put down for them either.
    PEOPLE_TUNE.most = 1;
    const r = new StandingPeople();
    r.adopt([row({ who: 'kept', z: 80 }), row({ who: 'near', z: 1 })]);
    const g3 = game({ keeps });
    r.step(1, 1, new THREE.Vector3(0, 0, 80), g3.deps);
    const kept = g3.bodies.find((b) => b.z === 80)!;
    ok(!!kept && g3.bodies.length === 1, 'with room for one, one is stood');
    held.add(kept);
    r.step(next, 5, at, g3.deps);
    ok(!kept.removed && g3.bodies.some((b) => b.z === 1 && !b.removed), 'a held body takes no place under the cap: somebody nearer is stood beside it, and it is not put down for them');
    held.delete(kept);

    // A swap: the cap full of others, the farthest of them makes room for somebody nearer, and never a held
    // body standing farther off still.
    PEOPLE_TUNE.most = 2;
    const s = new StandingPeople();
    s.adopt([row({ who: 'kept', z: 80 }), row({ who: 'mid', z: 40 }), row({ who: 'near', z: 1 })]);
    const g4 = game({ keeps });
    s.step(1, 1, new THREE.Vector3(0, 0, 80), g4.deps);
    const keptB = g4.bodies.find((b) => b.z === 80)!;
    const mid = g4.bodies.find((b) => b.z === 40)!;
    ok(!!keptB && !!mid && g4.bodies.length === 2, 'with room for two, the two nearest are stood');
    held.add(keptB);
    PEOPLE_TUNE.most = 1;
    s.step(next, 5, at, g4.deps);
    ok(!keptB.removed && mid.removed && g4.bodies.some((b) => b.z === 1 && !b.removed) && s.last.swapped === 1, 'the cap full, the farthest who is not held is put down for somebody nearer, never the held body farther still');
    held.delete(keptB);
  } finally {
    PEOPLE_TUNE.most = was;
  }

  // Model memory: short for somebody nearer, the farthest who are not held give it back, never a held body.
  {
    const m = memory({ held: 5, far: 5, near: 5 });
    m.deps.keeps = keeps;
    const t = new StandingPeople();
    t.adopt([row({ who: 'held', id: 'held', z: 110 }), row({ who: 'far', id: 'far', z: 104 }), row({ who: 'near', id: 'near', z: 0 })]);
    t.step(0, 0, new THREE.Vector3(0, 0, 200), m.deps, true);
    ok(m.standingIds() === 'far,held', `two far people stand (${m.standingIds()})`);
    m.fill();
    const heldBody = m.body('held')!;
    held.add(heldBody);
    t.step(0, 1, at, m.deps, true);
    ok(m.standingIds() === 'held,near' && !heldBody.removed, `short of memory for the near one, the far one who is not held gives it back, and the held one farther still is not put down (${m.standingIds()})`);
    held.delete(heldBody);
  }

  // The side holding the towns: its guards standing now are put down for the other side's, but not one
  // that is following the player, which goes on following on the side it took.
  {
    const creatures: Record<string, PeopleCreature> = {
      officer: { id: 'o0', game: { attackable: true, aggression: 'defensive' } },
      rebel: { id: 'r0', game: { attackable: true, aggression: 'defensive' } },
    };
    const gcw = [{ who: 'officer', id: 'o1' }, { who: 'rebel', id: 'r1' }];
    const t = new StandingPeople();
    t.adopt([row({ key: 'feed00a1', who: 'officer', id: 'o1', x: -2, gcw }), row({ key: 'feed00a2', who: 'officer', id: 'o1', x: 2, gcw })], creatures, { world: 'heldside' });
    const g5 = game({ keeps });
    try {
      t.step(0, 0, at, g5.deps, true);
      const a = g5.bodies.find((b) => b.x === -2)!;
      const b = g5.bodies.find((b) => b.x === 2)!;
      ok(!!a && !!b && t.side === 'imperial', 'two Imperial guards stand');
      held.add(a);
      t.setSide('rebel', g5.deps);
      ok(!a.removed && b.removed, 'the towns changing hands put down the guard standing, never the one following the player');
      held.delete(a);
    } finally {
      delete GCW_SIDES.heldside;
    }
  }
}

// ------------------------------------------------------------------ a world of copies stands only the copy the player is in
{
  // `PeopleDeps.scope` (`World.inCopy`): the instances zone parks sixteen corvettes side by side, a few
  // hundred metres apart, and only the copy the player is in has its crew stood. Each half is pinned: nobody
  // the scope leaves out is stood however near, a body standing when the scope moves off it is put down as
  // one past `drop` would be, and one the followers hold never is.
  // Along z, which the world's frame keeps as the rows have it (it mirrors x), and the scope is asked in the world's frame.
  let inCopy = (z: number): boolean => z < 50;
  const held = new Set<Body>();
  const p = new StandingPeople();
  p.adopt([row({ who: 'here', z: 0 }), row({ who: 'there', z: 60 }), row({ who: 'follower', z: 2 })]);
  const { deps, bodies } = game({ scope: (_x, _y, z) => inCopy(z), keeps: (m) => held.has(m as unknown as Body) });
  const at = new THREE.Vector3(0, 0, 30);
  ok(Math.abs(60 - at.z) < PEOPLE_TUNE.build, 'the next copy\'s row is near enough to be stood by distance alone');
  p.step(1, 1, at, deps, true);
  ok(bodies.some((b) => b.z === 0) && bodies.some((b) => b.z === 2) && !bodies.some((b) => b.z === 60), 'nobody is stood outside the copy the player is in, however near');
  const follower = bodies.find((b) => b.z === 2)!;
  held.add(follower);
  inCopy = (z) => z > 50;
  p.step(PEOPLE_TUNE.everySeconds + 0.1, 5, at, deps, true);
  ok(bodies.find((b) => b.z === 0)!.removed, 'the copy left behind has its crew put down');
  ok(!follower.removed, 'except whoever follows the player, which the followers hold');
  ok(bodies.some((b) => b.z === 60 && !b.removed), 'and the copy now in scope has its own stood');
  // With no scope at all (every other world) nobody is left out.
  const q = new StandingPeople();
  q.adopt([row({ who: 'a', z: 0 }), row({ who: 'b', z: 60 })]);
  const g2 = game();
  q.step(1, 1, at, g2.deps, true);
  ok(g2.bodies.length === 2, 'and a world with no scope stands everybody near, as it always did');
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

// ------------------------------------------------------------------ shared with a server
{
  // Every browser stands the same people from the same rows; shared with a server, one every other
  // browser has seen die is down here too until the server's wait is out (`downFor`), and somebody who
  // may be fought comes back as the same person every life, since the lives are each browser's own count.
  const creatures = { somebody: { id: 'body', bodies: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8'], game: { aggression: 'defensive', attackable: true } } };
  const rows = [row({ respawn: 30 }), row({ z: 3, respawn: 0 })];
  let down = 50;
  let seeding = true;
  const p = new StandingPeople();
  p.adopt(rows, creatures as never);
  const { deps, bodies } = game({ downFor: (id) => (id.endsWith(':0') ? down : 0), seeding: () => seeding });
  const at = new THREE.Vector3(0, 0, 0);
  p.step(0, 0, at, deps, true);
  ok(bodies.length === 1 && bodies[0].z === 3, 'somebody every other browser has seen die is not stood here while the server holds them down');
  ok(bodies[0].how?.respawn === STAYS_DOWN_SECONDS, `and a row that never comes back asks the server to hold its death for the longest it holds any (${bodies[0].how?.respawn} s), not a second`);
  down = 0;
  p.step(PEOPLE_TUNE.everySeconds + 0.1, 2, at, deps);
  const first = bodies.find((b) => b.z === 0)!;
  ok(!!first && first.how?.respawn === 30, 'once it is out they stand, asking their own row\'s wait');
  const lives: string[] = [first.id!];
  let t = 2;
  for (let life = 0; life < 4; life++) {
    bodies.filter((b) => b.z === 0 && !b.dead).forEach((b) => (b.dead = true));
    for (let k = 0; k < 4; k++) {
      t += 20;
      p.step(PEOPLE_TUNE.everySeconds + 0.1, t, at, deps);
    }
    const now = bodies.filter((b) => b.z === 0 && !b.dead && !b.removed).pop();
    if (now) lives.push(now.id!);
  }
  ok(lives.length === 5 && lives.every((id) => id === lives[0]), `shared, the same person comes back every life, so no two browsers draw two people under one name (${lives.join(', ')})`);
  // The control: alone, the same row draws its bodies afresh each life.
  seeding = false;
  const alone: string[] = [];
  for (let life = 0; life < 4; life++) {
    bodies.filter((b) => b.z === 0 && !b.dead).forEach((b) => (b.dead = true));
    for (let k = 0; k < 4; k++) {
      t += 20;
      p.step(PEOPLE_TUNE.everySeconds + 0.1, t, at, deps);
    }
    const now = bodies.filter((b) => b.z === 0 && !b.dead && !b.removed).pop();
    if (now) alone.push(now.id!);
  }
  ok(new Set(alone).size > 1, `while alone each life draws again, as it always did (${alone.join(', ')})`);
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
    ...setFrees(() => freed),
  });
  bodies = g.bodies;
  const refuse = g.deps.spawn;
  g.deps.spawn = (entry, at, how) => (short() > 0 ? 'the creature and NPC models already out fill their memory budget' : refuse(entry, at, how));
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

// ------------------------------------------------------------------ what a set gives back, together
/**
 * A model memory made of each body's own bytes and one piece `sharers` hold between them, counted once
 * while any of them stands: what `short` is worked out from, and a spawn refused while it is short.
 */
function memory(own: Record<string, number>, sharers: string[] = [], piece = 0) {
  let bodies: Body[] = [];
  let budget = Infinity;
  const upId = (id: string) => bodies.some((b) => b.id === id && !b.removed && !b.dead);
  const pieceUp = () => sharers.some(upId);
  const used = () => bodies.filter((b) => !b.removed && !b.dead).reduce((n, b) => n + own[b.id!], 0) + (pieceUp() ? piece : 0);
  const short = (entry: MobileEntry) => Math.max(0, used() + own[entry.id] + (sharers.includes(entry.id) && !pieceUp() ? piece : 0) - budget);
  const g = game({ short, ...setFrees((b) => own[b.id!], sharers.length ? { with: sharers.map((id) => (b: Body) => b.id === id), bytes: piece } : undefined) });
  bodies = g.bodies;
  const plain = g.deps.spawn;
  g.deps.spawn = (entry, at, how) => (short(entry as MobileEntry) > 0 ? 'the budget is full' : plain(entry, at, how));
  const standingIds = () => bodies.filter((b) => !b.removed && !b.dead).map((b) => b.id!).sort().join();
  const body = (id: string) => bodies.find((b) => b.id === id && !b.removed && !b.dead) ?? null;
  return { deps: g.deps, upId, standingIds, body, fill: () => (budget = used()) };
}
{
  // Two far people of one species share its body between them (5): neither gives it back alone, and
  // added up one by one the three far people (1 each) come nowhere near the 6 the near one needs, but
  // the two together do. The third far one, of another body, is not needed and stays.
  const m = memory({ far1: 1, far2: 1, far3: 1, near: 6 }, ['far1', 'far2'], 5);
  const p = new StandingPeople();
  p.adopt([row({ who: 'far1', id: 'far1', z: 100 }), row({ who: 'far2', id: 'far2', z: 104 }), row({ who: 'far3', id: 'far3', z: 90 }), row({ who: 'near', id: 'near', z: 0 })]);
  p.step(0, 0, new THREE.Vector3(0, 0, 180), m.deps, true);
  ok(m.standingIds() === 'far1,far2,far3', `three far people stand, and the near one is out of range (${m.standingIds()})`);
  m.fill();
  p.step(0, 1, new THREE.Vector3(0, 0, 0), m.deps, true);
  ok(m.standingIds() === 'far3,near', `the two who share a body are put down together for the near one, which one by one they could never make room for, and the third stays (${m.standingIds()})`);
  ok(p.last.swapped === 2, 'two put down, not three');
}
{
  // The farthest gives back a little and the next a lot: once the next alone is enough, the farthest
  // is let stay rather than put down for nothing.
  const m = memory({ farthest: 1, far: 5, near: 5 });
  const p = new StandingPeople();
  p.adopt([row({ who: 'farthest', id: 'farthest', z: 110 }), row({ who: 'far', id: 'far', z: 104 }), row({ who: 'near', id: 'near', z: 0 })]);
  p.step(0, 0, new THREE.Vector3(0, 0, 200), m.deps, true);
  ok(m.standingIds() === 'far,farthest', `two far people stand (${m.standingIds()})`);
  m.fill();
  p.step(0, 1, new THREE.Vector3(0, 0, 0), m.deps, true);
  ok(m.standingIds() === 'farthest,near', `only the one whose memory is needed is put down, though the farther one was counted first (${m.standingIds()})`);
  ok(p.last.swapped === 1, 'one put down');
}
{
  // Nobody of its own far enough off to give back what a near one needs: nobody is put down, and the
  // pass says how much it was short, for the people of ours (`src/world/ambient/`) to give back. A pass
  // that really ran is numbered, so the shortfall is answered once.
  const m = memory({ far1: 1, far2: 1, near: 6 });
  const p = new StandingPeople();
  p.adopt([row({ who: 'far1', id: 'far1', z: 100 }), row({ who: 'far2', id: 'far2', z: 104 }), row({ who: 'near', id: 'near', z: 0 })]);
  p.step(0, 0, new THREE.Vector3(0, 0, 200), m.deps, true);
  m.fill();
  const before = p.last.pass;
  p.step(0, 1, new THREE.Vector3(0, 0, 0), m.deps, true);
  ok(m.standingIds() === 'far1,far2' && p.last.short === 1 && p.last.shortBytes === 6, `short of 6 with only 2 farther off to give back, nobody is put down and the pass says so (${p.last.short} row short by ${p.last.shortBytes})`);
  ok(p.last.pass === before + 1, 'and the pass is numbered');
  p.step(0.1, 1.1, new THREE.Vector3(0, 0, 0), m.deps);
  ok(p.last.pass === before + 1 && p.last.shortBytes === 6, "a step that returns before it looks neither numbers a pass nor forgets the last one's shortfall");
  p.unload();
  ok(p.last.short === 0 && p.last.shortBytes === 0, 'and a world unloaded is short of nothing');
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
  ok(/cellAt: \(p, room\) => \(room !== undefined \? this\.layoutStream\?\.buildingWithRoom\(p, room\) : null\) \?\? this\.layoutStream\?\.buildingAt\(p\) \?\? null,[\s\S]{0,700}cellSolid: \(state\) => this\.layoutStream\?\.cellsSolid\(state\) \?\? true,/.test(worldSrc), "the world answers it from the streamer's own colliders, a body stood with the data's own room takes that room, and one stood where no room holds it is in no room, never in the player's");
  ok(/held\.cell = this\.deps\.cellAt\(m\.pos, opts\.room\);/.test(manager), "and the manager seeds a body's cell from the room it was stood with");
  ok((mobile.match(/if \(this\.airless\) holdAir\(this\.body\);/g) ?? []).length >= 2, 'a body in such a room is held after everything else that writes a velocity, alive and dead');
  ok(/if \(airless\) holdAir\(this\.body\);\s*else this\.body\.setGravityScale\(gravityFor\(false, this\.swimming, this\.flyer, this\.dead\), true\);/.test(mobile), 'and takes the gravity the rule gives when its floor comes back');
  ok(/setGravityScale\(gravityFor\(this\.airless, this\.swimming, this\.flyer, this\.dead\), true\)/.test(mobile), 'and when it is handed back from another browser');
  // Written out, or through `standingOn` (groundProbe.ts, whose own test holds that an airless body stands).
  ok(/grounded = gd !== null \|\| this\.airless \|\||grounded = standingOn\(this\.grounded, gd !== null, this\.airless,/.test(mobile), 'and counts as standing, so it does not play a fall');

  // The post and the indoor wander, which the brain's own tests reach only through a copy of `think`.
  // A town's walker keeps to its round instead, and its home moves onto the round before the clamp.
  ok(/const d = decide\(self, list\);\s*(?:\/\/[^\n]*\n\s*)*if \(follow\) keepFollow\(d, self, follow\);\s*else if \(this\.patrol\) \{\s*keepPatrol\(d, self, this\.patrol(?:, [^;]*)?\);\s*this\.homeX = this\.patrol\.anchor\.x;\s*this\.homeZ = this\.patrol\.anchor\.z;\s*\} else if \(this\.post\) keepPost\(d, self, this\.post, self\.wanderAt\);\s*if \(this\.inside\) clampWander\(d, this\.homeX, this\.homeZ, BRAIN_TUNE\.leashInside \* BRAIN_TUNE\.wanderInsideShare\);/.test(mobile), "a body's own thinking keeps a person to their post (a walker to its round, a follower to its place behind the player) and every wander indoors inside the leash");

  // The hand-over's reading side, and what the hand-spawn cap and the NPC tab's clear may take.
  ok(/const named = npcNow\(\)\?\.readTarget\(want\) \?\? null;\s*if \(!named\) return;/.test(mobile) && /'key' in named \? t\.key === named\.key : \(t as \{ npcId\?: string \}\)\.npcId === named\.npc/.test(mobile), "a creature handed over reads who it was fighting through the wire's own rule, never as this browser's player");
  ok(/if \(m\.origin === 'spawned' && !this\.worldIds\.has\(m\)\) n\+\+;/.test(manager), "the hand-spawn cap counts only what was stood by hand, never the world's own bodies");
  ok(/if \(m\.origin !== 'spawned' \|\| this\.worldIds\.has\(m\)\) continue;/.test(manager), "and the NPC tab's clear never takes one of the world's");
  ok(/if \(!b \|\| b\.dead \|\| b\.removed \|\| b\.engaged \|\| s\.essential !== essential \|\| deps\?\.keeps\?\.\(b\)\) continue;/.test(src('world/standingPeople.ts')) && /get engaged\(\): boolean \{/.test(mobile), 'and nobody in a fight is put down to make room for somebody nearer, nor anybody of the other cap, nor anybody following the player');

  // What the town says about each row reaches the body the world stands, and the budget can make room.
  ok(/const people = wildLife\.peopleRows\(\) as StandingRow\[\];\s*standingPeople\.adopt\(people\.length \? \[\.\.\.people, \.\.\.conversationPack\.standRows\(this\.packId\)\] : people, wildLife\.peopleCreatures\(\), wildLife\.peopleExtras\(\)\);/.test(worldSrc), "the world hands the people each creature's own numbers with the rows (and the heralds the conversations stand beside them), and the towns' lists and weapon groups beside them");
  // The name is the person's own (`stood:<world>:<index>`, unique across worlds so the server can hold it
  // once), and the row's respawn goes with it, which is how long its post stays empty once it dies.
  ok(/spawn: \(entry, at, how\) =>\s*this\.mobiles\?\.spawn\(entry, at, \{\s*origin: 'spawned',\s*seed: how\.seed,\s*inside: how\.inside,\s*worldId: how\.id,\s*essential: how\.essential,\s*overrides: how\.overrides,\s*mood: how\.mood,\s*weapons: how\.weapons,\s*weaponGroups: how\.weaponGroups,\s*room: how\.room,\s*respawn: how\.respawn,\s*\}\)/.test(worldSrc), "and stands each with its own creature's numbers, mood, weapons and room over its body's");
  ok(/stoodId\(i: number\): string \{\s*return `stood:\$\{this\.extras\.world \|\| 'here'\}:\$\{i\}`;/.test(src('world/standingPeople.ts')), 'under a name of its own that says which world it stands on');
  ok(/holds: \(id\) => \{\s*const e = this\.mobileCatalogue\?\.byId\(id\);\s*return !!e && !!this\.mobiles\?\.holdsBody\(e\);\s*\},/.test(worldSrc), 'and tells them which bodies are already built, so an unattackable crowd can lean on them');
  ok(/short: \(entry\) => this\.mobiles\?\.budgetShort\(entry\) \?\? 0,\s*freeStart: \(\) => this\.mobiles\?\.freeStart\(\),\s*frees: \(m\) => this\.mobiles\?\.frees\(m\) \?\? 0,/.test(worldSrc), 'and tells them what the model memory budget is short of and what putting a set of people down gives back, counted of the set');
  ok(/spawn\(entry, at, \{ origin: 'spawned', inside, worldId, essential, fixture: true \}\)/.test(worldSrc) && /const cost = budget \? this\.deps\.assets\.wouldCost\(entry, cat\) : 0;/.test(manager) && /this\.whyNot\(entry, cat, opts\.worldId \? 'world' : origin, !opts\.fixture\)/.test(manager), 'and a ticket collector is a fixture the memory budget never keeps off its pad');
}

// ------------------------------------------------------------------ the mood a row stands in
{
  // The human species rig's own table, as its parts manifest writes it (a few rows of it): a branch is
  // named for its first value, and a shared branch answers for every value in its list.
  const variants: RigVariants = {
    idle: { variable: 'gender', values: ['o', 'm'] },
    'idle:worried': { variable: 'mood', values: ['worried', 'nervous'] },
    'idle:npc_sad': { variable: 'mood', values: ['npc_sad', 'sad'] },
    'idle:npc_sitting_chair': { variable: 'mood', values: ['npc_sitting_chair'] },
    'idle:npc_sitting_table': { variable: 'mood', values: ['npc_sitting_table', 'npc_sitting_table_eating'] },
    'skill_action_1:dance_18': { variable: 'mood', values: ['sad'] },
  };
  const clips = new Set(Object.keys(variants));
  const hasClip = (c: string) => clips.has(c);
  ok(moodIdleName('npc_sad', variants, hasClip) === 'idle:npc_sad', 'a mood named for its branch takes that branch');
  ok(moodIdleName('sad', variants, hasClip) === 'idle:npc_sad' && moodIdleName('nervous', variants, hasClip) === 'idle:worried', 'a mood a shared branch lists takes that branch, never a branch of another state that lists it too');
  ok(moodIdleName('npc_sitting_table_eating', variants, hasClip) === 'idle:npc_sitting_table', "a town's eating customer sits at the table");
  ok(moodIdleName('conversation', variants, hasClip) === null && moodIdleName('neutral', variants, hasClip) === null, 'a mood with no branch has no lent idle: the body keeps its own');
  ok(moodIdleName('o', variants, hasClip) === null, "and a gender's value is never taken for a mood");
  ok(moodIdleName(undefined, variants, hasClip) === null && moodIdleName('sad', null, () => false) === null, 'no mood, or no rig, lends nothing');
  ok(moodOfRow({ mood: 'happy' }) === 'happy' && moodOfRow({ sit: true }) === 'npc_sitting_chair' && moodOfRow({ sit: true, mood: 'npc_sitting_table' }) === 'npc_sitting_table' && moodOfRow({}) === null, "a giver the server sat down sits in a chair unless its row says how");

  // Whoever is posed off their feet keeps to the spot; the rest keep the post their row gives.
  ok(postFor({ heading: 0 }, 'npc_sitting_chair').kind === 'still' && postFor({ heading: 0, sit: true }).kind === 'still' && postFor({ heading: 0 }, 'sad').kind === 'near' && postFor({ heading: 0, still: true }, 'sad').kind === 'still', 'a seated person, a sat giver and a still row never wander; a sad one may step about');
  const seated = postFor({ heading: 0.7 }, 'npc_sitting_table');
  const blank: Decision = { state: 'wander', targetKey: null, moveTo: { x: 10, z: 0 }, pace: 'walk', posture: 'stand', cover: false, face: { x: 10, z: 0 }, attack: null, emote: null, wanderAt: 1, goal: { x: 10, z: 0 }, until: 0, blockedSince: null, forgetKey: null, forgetUntil: 0, clearMemory: false };
  keepPost(blank, { x: 0, z: 0, homeX: 0, homeZ: 0, now: 0 }, seated, 0);
  ok(blank.state === 'idle' && blank.goal === null && blank.pace === 'stand', 'and the brain offering one a wander is turned down: a still post never wanders');

  // The pass hands the mood on, and the real rig answers for the moods the towns really use.
  const p = new StandingPeople();
  p.adopt([row({ who: 'drinker', mood: 'npc_standing_drinking' }), row({ who: 'giver', z: 2, sit: true }), row({ who: 'talker', z: 4, mood: 'conversation' })]);
  const { deps, bodies } = game();
  p.step(0, 0, new THREE.Vector3(0, 0, 0), deps, true);
  ok(bodies.find((b) => b.z === 0)?.how?.mood === 'npc_standing_drinking' && bodies.find((b) => b.z === 2)?.how?.mood === 'npc_sitting_chair' && bodies.find((b) => b.z === 4)?.how?.mood === 'conversation', 'the pass stands each in its mood, a sat giver in the chair');
  ok(bodies.find((b) => b.z === 2)?.post?.kind === 'still' && bodies.find((b) => b.z === 0)?.post?.kind === 'near', 'and the one sat down keeps to its seat, while a drinker may step about');
  // Lending the idle: the clip picked out of whichever rig is already parsed, and laid over the body's
  // extras. Clips here are names and nothing else, which is all either reads of them.
  const clip = (name: string) => ({ name });
  const human = [clip('idle'), clip('idle:npc_sad'), clip('idle:npc_sitting_chair'), clip('BOTH_A1_T__B_')];
  const rodian = [clip('idle'), clip('idle:npc_sad')];
  const rigs = new Map([
    ['/assets-private/characters/rodian_male/rig.glb', rodian],
    ['/assets-private/characters/human_male/rig.glb', human],
  ]);
  const tables = new Map<string, RigVariants>([
    ['/assets-private/characters/rodian_male/rig.glb', variants],
    ['/assets-private/characters/human_male/rig.glb', variants],
  ]);
  ok(pickMoodClip('sad', rigs, tables, 'human_male') === human[1], "a mood is lent out of the body's own species' rig when it is in, its shared branch and all");
  ok(pickMoodClip('sad', rigs, tables, 'wookiee_male') === rodian[1], 'else out of whichever rig is in, every humanoid sharing the one skeleton');
  ok(pickMoodClip('npc_sitting_chair', rigs, tables, 'rodian_male') === null && pickMoodClip('npc_sitting_chair', rigs, tables, 'human_male') === human[2], 'a branch the rig does not really carry is no answer, whatever its table says');
  ok(pickMoodClip('conversation', rigs, tables) === null && pickMoodClip('sad', new Map(), tables) === null, 'and a mood with no branch, or no rig in yet, lends nothing');
  const extras = { clips: new Map([['BOTH_A1_T__B_', human[3]]]), roles: { attacks: ['BOTH_A1_T__B_'], rangedStance: 'rifle_ready' }, carry: 'rifle' as const, carried: true, ranged: { range: 20, additive: false } };
  const moody = withMood(extras as never, human[1] as never)!;
  ok(moody.clips?.get('idle:npc_sad') === human[1] && moody.clips?.get('BOTH_A1_T__B_') === human[3], "the lent idle is added to what the body plays, beside the clips it was lent already");
  ok(moody.roles?.idle === 'idle:npc_sad' && moody.roles?.attacks?.[0] === 'BOTH_A1_T__B_' && moody.roles?.rangedStance === 'rifle_ready', 'its idle role points at the lent clip, and every other role is kept');
  ok(moody.carry === 'rifle' && moody.carried === true && moody.ranged?.range === 20 && extras.roles.rangedStance === 'rifle_ready' && !('idle' in extras.roles), "its carry and its gun's range are kept, and the extras it was handed are left as they were");
  ok(withMood(extras as never, null) === (extras as never) && withMood(undefined, human[1] as never)?.roles?.idle === 'idle:npc_sad', 'nothing to lay over is the extras themselves, and a body with none still takes the mood');

  const rigFile = join('assets-private', 'characters', 'human_male', 'parts.json');
  const rigGlb = join('assets-private', 'characters', 'human_male', 'rig.glb');
  const tat = join('assets-private', 'tatooine', 'spawns.json');
  if (!existsSync(rigFile) || !existsSync(tat)) note('no species rig or spawns pack here, so the real moods are not checked');
  else {
    const parts = JSON.parse(readFileSync(rigFile, 'utf8')) as { variants?: RigVariants; clips?: string[] };
    const rig = parts.variants ?? {};
    // What the rig really carries, which is not the branch table: the GLB's own animations where it is
    // here (its JSON chunk, read without the 200 MB behind it), else the manifest's list of them.
    let clipNames: Set<string>;
    let from = 'the manifest';
    if (existsSync(rigGlb)) {
      const fd = openSync(rigGlb, 'r');
      try {
        const head = Buffer.alloc(20);
        readSync(fd, head, 0, 20, 0);
        const len = head.readUInt32LE(12);
        const json = Buffer.alloc(len);
        readSync(fd, json, 0, len, 20);
        clipNames = new Set(((JSON.parse(json.toString('utf8')) as { animations?: { name?: string }[] }).animations ?? []).map((a) => a.name ?? ''));
        from = 'the GLB';
      } finally {
        closeSync(fd);
      }
    } else clipNames = new Set(parts.clips ?? []);
    const rows = (JSON.parse(readFileSync(tat, 'utf8')) as { statics: StandingRow[] }).statics;
    const moods = rows.map((r) => moodOfRow(r)).filter((m): m is string => !!m);
    const lent = moods.filter((m) => moodIdleName(m, rig, (c) => clipNames.has(c)));
    const listed = moods.filter((m) => moodIdleName(m, rig, (c) => c in rig));
    note(`${moods.length} of the world's ${rows.length} rows carry a mood; ${lent.length} of them take a branch of the human rig (${clipNames.size} clips in ${from}), the rest keep their own idle`);
    ok(lent.length > 0 && lent.length < moods.length, 'some moods take a branch and some are the plain idle under another name, as the table has them');
    ok(lent.length === listed.length, `and every branch the table names for a mood is a clip ${from} really carries (${lent.length} of ${listed.length})`);
    ok(moods.every((m) => m !== 'sad' || moodIdleName(m, rig, (c) => clipNames.has(c)) === 'idle:npc_sad'), "every one of the world's sad people is lent the sad idle");
  }

  // The wiring, read as text: the body is attached in its mood, the mood out of an already-parsed rig.
  const src = (p: string): string => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const manager = src('world/mobiles/manager.ts');
  const character = src('player/character.ts');
  ok(/const r = m\.attach\(gotModel, gotPack, withMood\(plan\?\.extras \?\? undefined, this\.moodIdle\(entry, packInfo, opts\.mood, hologram\)\)\);/.test(manager), 'the manager attaches every body with its mood laid over its extras');
  ok(/if \(!mood \|\| hologram \|\| packInfo\?\.hierarchy !== 'all_b'\) return null;\s*return Character\.parsedRigMood\(mood, entry\.species \?\? undefined\);/.test(manager), 'a person on the humanoid skeleton, never a creature or a hologram, is lent it from a parsed rig');
  ok(/static parsedRigMood\(mood: string, prefer\?: string\): THREE\.AnimationClip \| null \{\s*return pickMoodClip\(mood, rigClipsParsed, rigVariantsParsed, prefer\);/.test(character) && /rigClipsParsed\.set\(rigUrl, rig\.animations\);\s*rigVariantsParsed\.set\(rigUrl, manifest\.variants \?\? \{\}\);/.test(character), "which is the rig's own parsed clips and its own branch table, kept together as the rig is parsed");
}

// ------------------------------------------------------------------ who stands at a row, life after life
{
  const creatures: Record<string, PeopleCreature> = {
    commoner: { id: 'c0', bodies: ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'], game: { attackable: false, aggression: 'passive' } },
    thug: { id: 't0', bodies: ['t0', 't1', 't2'], game: { attackable: true, aggression: 'aggressive' } },
    trainer: { id: 'tr', game: { attackable: false } },
    officer: { id: 'o0', bodies: ['o0', 'o1'], game: { attackable: true, aggression: 'defensive', level: 30, hp: 700, damage: 31, ranged: { range: 20, additive: false } } },
    rebel: { id: 'r0', bodies: ['r0', 'r1'], game: { attackable: true, aggression: 'defensive', level: 28, hp: 690, damage: 30, ranged: null } },
  };
  const pools = { 'Town.stationaryCommoners': ['commoner'], 'Town.stationaryNpcs': ['thug', 'trainer', 'nobody_we_know'] };
  const ctx = (over: Partial<PlanContext> = {}): PlanContext => ({ creatures, pools, side: 'imperial', reuse: PEOPLE_TUNE.reuseLook, ...over });
  const crowd = (key: string): StandingRow => row({ key, who: 'commoner', id: 'c3', draw: [['Town.stationaryCommoners', 0.8], ['Town.stationaryNpcs', 0.2]], peaceful: true });

  const first = personFor(crowd('a1b2c3d4e5f6'), 0, ctx());
  ok(first.who === 'commoner' && first.id === 'c3', "a crowd row's first life is who and what the converter drew for it");
  ok(JSON.stringify(personFor(crowd('a1b2c3d4e5f6'), 3, ctx())) === JSON.stringify(personFor(crowd('a1b2c3d4e5f6'), 3, ctx())), 'and any later life is the same draw every time it is asked, in every browser');
  const lives = new Set(Array.from({ length: 12 }, (_, l) => `${personFor(crowd('a1b2c3d4e5f6'), l + 1, ctx()).who}/${personFor(crowd('a1b2c3d4e5f6'), l + 1, ctx()).id}`));
  ok(lives.size > 3, `a row killed and come back draws again: twelve lives stood ${lives.size} different people`);

  // The server's own split: four in five of the stationary crowd are its commoners.
  let fromCommoners = 0;
  let known = true;
  const n = 4000;
  for (let i = 0; i < n; i++) {
    const w = personFor(crowd((0x10000000 + i * 7919).toString(16) + 'ab'), 1, ctx());
    if (w.who === 'commoner') fromCommoners++;
    if (w.who === 'nobody_we_know') known = false;
  }
  ok(Math.abs(fromCommoners / n - 0.8) < 0.03, `the draws keep the server's split: ${((fromCommoners / n) * 100).toFixed(1)}% of ${n} later lives are commoners`);
  ok(known, 'and a name no creature in the fleet answers to is never drawn');

  // A dress group's creature is a pool of bodies: the draw is stable, spreads over the pool, and an
  // unattackable crowd leans on the bodies already built.
  const group = (key: string, life: number, holds?: (id: string) => boolean) => personFor(row({ key, who: 'commoner', id: 'c0', peaceful: true }), life, ctx({ holds }));
  const spread = new Set(Array.from({ length: 60 }, (_, i) => group((0x20000000 + i * 104729).toString(16), 1).id));
  ok(spread.size >= 5, `a dress group's bodies are drawn from its whole pool (${spread.size} of 6 over sixty rows)`);
  const built = new Set(['c4']);
  let reused = 0;
  for (let i = 0; i < 2000; i++) if (group((0x30000000 + i * 104729).toString(16), 1, (id) => built.has(id)).id === 'c4') reused++;
  ok(Math.abs(reused / 2000 - (PEOPLE_TUNE.reuseLook + (1 - PEOPLE_TUNE.reuseLook) / 6)) < 0.05, `an unattackable crowd takes a body already built ${((reused / 2000) * 100).toFixed(0)}% of the time, which is its ${PEOPLE_TUNE.reuseLook} share and the pool's own chance besides`);
  let thugReuse = 0;
  for (let i = 0; i < 400; i++) if (personFor(row({ key: (0x40000000 + i * 7).toString(16), who: 'thug', id: 't0' }), 0, ctx({ holds: (id) => id === 't2' })).id === 't2') thugReuse++;
  ok(thugReuse === 0, 'while somebody who may be fought always stands as the body drawn for them');

  // A guard's row: the side holding the world, and the other where that side has no body.
  const guard = row({ key: 'feedfacecafe', who: 'officer', id: 'o1', gcw: [{ who: 'officer', id: 'o1' }, { who: 'rebel', id: 'r1', mood: 'angry' }] });
  const imp = personFor(guard, 0, ctx());
  const reb = personFor(guard, 0, ctx({ side: 'rebel' }));
  ok(imp.who === 'officer' && imp.id === 'o1' && reb.who === 'rebel' && reb.id === 'r1' && reb.mood === 'angry', "a guard's row stands the Imperial side unless the world is the rebels', each with its own body and mood");
  const lonely = row({ who: 'officer', id: 'o1', gcw: [{ who: 'officer', id: 'o1' }, { who: 'rebel' }] });
  ok(personFor(lonely, 0, ctx({ side: 'rebel' })).who === 'officer', 'and a side the data gives no body stands the other rather than nobody');

  // Its own numbers, weapons and whether it may be struck.
  ok(personFor(guard, 0, ctx()).essential === false && personFor(row({ who: 'trainer', id: 'tr' }), 0, ctx()).essential === true && personFor(row({ who: 'stranger', id: 'x' }), 0, ctx()).essential === null, 'a creature that may be struck is not furniture, one that may not is, and one the fleet says nothing of is left to its body');
  const o = overridesOf(creatures.officer)!;
  ok(o.level === 30 && o.hp === 700 && o.damage === 31 && o.aggression === 'defensive' && o.ranged?.range === 20, "a creature's own numbers become the body's overrides");
  ok(overridesOf(creatures.rebel)!.ranged === null, 'and one that does not shoot is told so, rather than taking its body\'s gun');
  ok(overridesOf({ game: { hp: 'lots', level: -Infinity, aggression: 'furious' } }) === undefined && overridesOf(null) === undefined, 'a number that is not a number is never an override');
  ok(weaponsOf({ weapons: ['tusken_ranged', 'unarmed', 7] })?.join() === 'tusken_ranged,unarmed' && weaponsOf({}) === undefined, "and its weapons, first and second, as the emulator wrote them");
  ok(seedOfRow({ key: 'a1b2c3d4e5f6' }, 9) === 0xa1b2c3d4 && seedOfRow({}, 9) === 9, "a row rolls from its key's first eight figures, whatever its place in the list");

  // The pass: the numbers, the weapons, the room, a patroller at the first point of its walk, and the
  // two caps apart. A patroller's points are mirrored with the row.
  GCW_SIDES.testworld = 'rebel';
  try {
    const p = new StandingPeople();
    const patrol = row({ who: 'thug', id: 't0', x: -5, z: 0, route: [{ x: -6, y: 11, z: 1, room: 3, linger: false }, { x: -9, y: 11, z: 1, linger: true }] });
    p.adopt([guard, patrol, row({ who: 'trainer', id: 'tr', x: -1, z: 0, cell: 77, room: 2 })], creatures, { world: 'testworld', pools, weaponGroups: { g: ['object/weapon/x.iff'] } });
    const { deps, bodies } = game();
    p.step(0, 0, new THREE.Vector3(0, 0, 0), deps, true);
    const g = bodies.find((b) => b.id === 'r1');
    ok(!!g && g.how?.overrides?.level === 28 && g.how.overrides.ranged === null && g.how.mood === 'angry', "the world named the rebels', so its guard stands the rebel side with the rebel's own numbers");
    ok(g?.how?.weaponGroups?.g?.[0] === 'object/weapon/x.iff' && g.how.weapons === undefined, 'and the weapon groups are handed on with it, beside a creature that names none');
    const pt = bodies.find((b) => b.id === 't0');
    ok(!!pt && pt.x === 6 && pt.z === 1 && pt.y === 11 && pt.inside && pt.how?.room === 3, `a patroller stands at the first point of its walk, mirrored with the row, in that point's room (${pt?.x}, ${pt?.z})`);
    const tr = bodies.find((b) => b.id === 'tr');
    ok(!!tr && tr.essential === true && tr.how?.room === 2 && tr.inside, "and a person indoors is stood with its own room, which seeds the body's cell");
    ok(p.side === 'rebel' && p.report(new THREE.Vector3()).some((r) => r.who === 'rebel' && r.mood === 'angry'), 'and the console says who stands and in what mood');
  } finally {
    delete GCW_SIDES.testworld;
  }

  // Forty who may be fought and forty who may not, apart.
  const had = { most: PEOPLE_TUNE.most, mostEssential: PEOPLE_TUNE.mostEssential };
  PEOPLE_TUNE.most = 5;
  PEOPLE_TUNE.mostEssential = 4;
  try {
    const p = new StandingPeople();
    const rows = [...Array.from({ length: 10 }, (_, i) => row({ who: 'thug', id: 't0', x: -i - 1, key: `aa${i}0000000` })), ...Array.from({ length: 10 }, (_, i) => row({ who: 'trainer', id: 'tr', x: i + 1, z: 1, key: `bb${i}0000000` }))];
    p.adopt(rows, creatures);
    const { deps, bodies } = game();
    p.step(0, 0, new THREE.Vector3(0, 0, 0), deps, true);
    const up = standing(bodies);
    ok(up.filter((b) => !b.essential).length === 5 && up.filter((b) => b.essential).length === 4, `the two caps fill apart: ${up.filter((b) => !b.essential).length} who may be fought and ${up.filter((b) => b.essential).length} of the furniture`);
    ok(Math.max(...up.filter((b) => !b.essential).map((b) => Math.abs(b.x))) === 5 && Math.max(...up.filter((b) => b.essential).map((b) => Math.abs(b.x))) === 4, 'each the nearest of its own kind');
  } finally {
    Object.assign(PEOPLE_TUNE, had);
  }

  // Killed and come back is the next life, which draws again; walked away and back is the same body.
  const p = new StandingPeople();
  p.adopt([crowd('c0ffee000001')], creatures, { pools });
  const { deps, bodies } = game();
  const at = new THREE.Vector3(0, 0, 0);
  p.step(0, 0, at, deps, true);
  const firstBody = bodies[0].id;
  p.step(PEOPLE_TUNE.everySeconds + 0.1, 10, new THREE.Vector3(9000, 0, 0), deps);
  p.step(PEOPLE_TUNE.everySeconds + 0.1, 12, at, deps);
  ok(bodies.length === 2 && bodies[1].id === firstBody, 'walking away and back stands the same body again');
  bodies[1].dead = true;
  const seen = new Set<string>();
  let t = 20;
  for (let life = 0; life < 8; life++) {
    for (let k = 0; k < 3; k++) p.step(PEOPLE_TUNE.everySeconds + 0.1, (t += 400), at, deps);
    const last = bodies[bodies.length - 1];
    seen.add(`${last.how?.overrides?.aggression ?? ''}:${last.id}`);
    last.dead = true;
  }
  ok(bodies.length === 10 && seen.size > 2, `killed and come back eight times, the row stood ${seen.size} different bodies`);
}

// ------------------------------------------------------------------ a row rolls from its key, wherever it sits in the pack
{
  // Every draw a body makes (its weapon off its list, a blade's colour) comes from the seed it is stood
  // with, so the seed must be its key's and never its place in the list: a pack converted again with
  // its rows in another order would otherwise re-arm the whole town.
  const rows = [row({ who: 'a', key: 'a1b2c3d4e5f60001', x: -1 }), row({ who: 'b', key: '0badf00d77770002', x: -2 }), row({ who: 'c', x: -3 })];
  const seeds = (list: StandingRow[]): Map<string, { seed: number; index: number }> => {
    const p = new StandingPeople();
    p.adopt(list);
    const { deps, bodies } = game();
    p.step(0, 0, new THREE.Vector3(0, 0, 0), deps, true);
    return new Map(bodies.map((b) => [list[b.how!.index].who, { seed: b.how!.seed, index: b.how!.index }]));
  };
  const first = seeds(rows);
  ok(first.get('a')?.seed === seedOfRow(rows[0], 0) && first.get('a')?.seed === 0xa1b2c3d4 && first.get('b')?.seed === 0x0badf00d, "a keyed row is stood with its key's seed");
  const again = seeds([rows[2], rows[1], rows[0]]);
  ok(again.get('a')?.seed === first.get('a')?.seed && again.get('b')?.seed === first.get('b')?.seed && again.get('a')?.index !== first.get('a')?.index, 'and with the same seed when the pack lists it somewhere else');
  ok(first.get('c')?.seed === 2 && again.get('c')?.seed === 0, 'while a row with no key (a pack older than keys) rolls from its place, as it always did');
}

// ------------------------------------------------------------------ a world's side, handed over live
{
  const creatures: Record<string, PeopleCreature> = {
    officer: { id: 'o0', game: { attackable: true, aggression: 'defensive' } },
    rebel: { id: 'r0', game: { attackable: true, aggression: 'defensive' } },
    baker: { id: 'bk', game: { attackable: false } },
  };
  const guard = row({ key: 'feed0001', who: 'officer', id: 'o1', x: -2, gcw: [{ who: 'officer', id: 'o1' }, { who: 'rebel', id: 'r1' }] });
  const baker = row({ key: 'feed0002', who: 'baker', id: 'bk', x: -4 });
  const p = new StandingPeople();
  p.adopt([guard, baker], creatures, { world: 'sidetest' });
  const { deps, bodies } = game();
  const at = new THREE.Vector3(0, 0, 0);
  try {
    p.step(0, 0, at, deps, true);
    const imp = bodies.find((b) => b.id === 'o1')!;
    const bk = bodies.find((b) => b.id === 'bk')!;
    ok(p.side === 'imperial' && !!imp && !!bk, 'a world nobody named stands the Imperial guard');
    ok(p.setSide('rebel', deps) === 'rebel' && p.side === 'rebel' && GCW_SIDES.sidetest === 'rebel', 'handed to the rebels through the knob, the world is theirs and says so');
    ok(imp.removed && !bk.removed, "and the Imperial guard is put down at once, while the baker is left where he stands");
    p.step(0.1, 1, at, deps);
    const reb = bodies.find((b) => b.id === 'r1');
    ok(!!reb && !reb.removed && bodies.filter((b) => b.id === 'bk').length === 1, "the next pass stands the rebel at the guard's post, and nobody stands the baker twice");
    ok(p.setSide('rebel', deps) === 'rebel' && !reb!.removed, 'handing it to the side that already holds it puts nobody down');
  } finally {
    delete GCW_SIDES.sidetest;
  }
}

// ------------------------------------------------------------------ a patroller, and where it is measured from
{
  // A patroller stands at the first point of its walk where that lies near its own row, which is where
  // it is: so that is where every distance is measured from. A first point far from its row is a
  // script's slip (a power droid on Talus six kilometres from its own route), and stands at the row.
  ok(standPlaceOf(row({ x: 10, z: 0, route: [{ x: 12, y: 3, z: 1, room: 4 }] })).x === 12 && standPlaceOf(row({ x: 10, z: 0, route: [{ x: 12, y: 3, z: 1, room: 4 }] })).room === 4, 'a first point near its row is where a patroller stands, in its room');
  const slip = standPlaceOf(row({ x: 505, z: -3026, route: [{ x: 505, y: 0, z: 3025 }] }));
  ok(slip.x === 505 && slip.z === -3026 && !slip.inside, `one ${Math.round(3025 + 3026)} m from its row stands at the row, as the server stood every patroller`);
  ok(standPlaceOf(row({ x: 0, z: 0, cell: 9, room: 2 })).inside && standPlaceOf(row({ x: 0, z: 0, cell: 9, room: 2 })).room === 2 && !standPlaceOf(row({})).inside, 'and anybody else at its own spot, in its own room');

  // Two patrollers, each 45 m from its own row: one whose row is out of range but whose walk begins in
  // it, and one the other way round. Written as the snapshot writes them (x negated; the centre is 0,0).
  const inward = row({ who: 'inward', x: -150, z: 0, route: [{ x: -105, y: 0, z: 0 }] });
  const outward = row({ who: 'outward', x: -100, z: 0, route: [{ x: -145, y: 0, z: 0 }] });
  const faraway = row({ who: 'slip', x: -90, z: 0, route: [{ x: -90, y: 0, z: 6000 }] });
  const p = new StandingPeople();
  p.adopt([inward, outward, faraway]);
  const { deps, bodies } = game();
  p.step(0, 0, new THREE.Vector3(0, 0, 0), deps, true);
  ok(bodies.some((b) => b.x === 105) && !bodies.some((b) => Math.abs(b.x - 145) < 1e-9 || b.x === 100), `the one whose walk begins in range is stood there, and the one whose walk begins out of it is not, whatever their rows say (${bodies.map((b) => b.x).join(', ')})`);
  ok(bodies.some((b) => b.x === 90 && b.z === 0), 'and the slip is stood at its own row, in range, not six kilometres off');
  const near = p.nearest(new THREE.Vector3(100, 0, 0), 3);
  ok(near[0].x === 105 && near[0].away === 5, `the console measures a patroller from where it stands, which is where \`go\` takes the player (${JSON.stringify(near[0])})`);
  ok(p.report(new THREE.Vector3(100, 0, 0)).some((r) => r.away === 5), 'and so does its report of who is standing');
  // Walked 60 m past the far one's own spot, it is dropped by where it stands.
  p.step(PEOPLE_TUNE.everySeconds + 0.1, 2, new THREE.Vector3(105 + PEOPLE_TUNE.drop + 1, 0, 0), deps);
  ok(bodies.find((b) => b.x === 105)!.removed, 'and put down past `drop` from where it stands');
  const was = PEOPLE_TUNE.routeReach;
  try {
    ok(p.retune({ routeReach: 10 }).join() === 'routeReach' && p.nearest(new THREE.Vector3(150, 0, 0), 1)[0].x === 150, 'with the reach turned down live, a patroller 45 m from its walk stands at its row again');
  } finally {
    p.retune({ routeReach: was });
  }
}

// ------------------------------------------------------------------ one cap full, the memory short: nobody put down for nothing
{
  // The furniture's cap is full and nobody of its kind is far enough off to make room; the only people
  // standing far off are of the other kind, and the model memory is short. A row of the full kind must
  // not put those down for memory and then not be stood: they would stand again on the next pass and go
  // again on the one after, for as long as the player stood there.
  const creatures: Record<string, PeopleCreature> = { vendor: { id: 'v', game: { attackable: false } }, thug: { id: 't', game: { attackable: true } } };
  const had = { most: PEOPLE_TUNE.most, mostEssential: PEOPLE_TUNE.mostEssential };
  PEOPLE_TUNE.mostEssential = 2;
  try {
    const rows = [
      row({ key: 'e0000001', who: 'vendor', id: 'v', x: -1 }),
      row({ key: 'e0000002', who: 'vendor', id: 'v', x: -2 }),
      row({ key: 'e0000003', who: 'vendor', id: 'v', x: -3 }),
      row({ key: 'f0000001', who: 'thug', id: 't', x: -80 }),
      row({ key: 'f0000002', who: 'thug', id: 't', x: -90 }),
    ];
    let budget = 99;
    let bodies: Body[] = [];
    const up = (): number => bodies.filter((b) => !b.removed && !b.dead).length;
    const g = game({ short: () => Math.max(0, up() + 1 - budget), ...setFrees(() => 1) });
    bodies = g.bodies;
    const p = new StandingPeople();
    p.adopt(rows, creatures);
    const at = new THREE.Vector3(0, 0, 0);
    p.step(0, 0, at, g.deps, true);
    ok(up() === 4 && bodies.filter((b) => b.essential).length === 2 && bodies.filter((b) => !b.essential).length === 2, 'two of the furniture at their cap, and two thugs far off, stand');
    budget = up();
    const before = bodies.length;
    for (let t = 1; t < 8; t++) p.step(PEOPLE_TUNE.everySeconds + 0.1, t * 2, at, g.deps);
    ok(bodies.length === before && bodies.every((b) => !b.removed), `with the budget full, the third of the furniture puts nobody down for memory it could not be stood with (${bodies.length - before} stood, ${bodies.filter((b) => b.removed).length} put down, over seven passes)`);
    ok(p.last.up === 4 && p.last.swapped === 0, 'and the counts hold still, pass after pass');
  } finally {
    Object.assign(PEOPLE_TUNE, had);
  }

  // With the cap full and one of its own kind far enough off to make room, that one goes for the memory
  // first -- it goes anyway -- and nobody else need go. A vendor in a room waits for its building while
  // the rest stand, then comes in with the budget full.
  PEOPLE_TUNE.mostEssential = 2;
  try {
    const rows = [
      row({ key: 'e1000001', who: 'vendor', id: 'v', x: -60 }),
      row({ key: 'e1000002', who: 'vendor', id: 'v', x: -2 }),
      row({ key: 'f1000001', who: 'thug', id: 't', x: -90 }),
      row({ key: 'e1000003', who: 'vendor', id: 'v', x: -1, cell: 5, room: 1 }),
    ];
    let budget = 99;
    let built = false;
    let bodies: Body[] = [];
    const up = (): number => bodies.filter((b) => !b.removed && !b.dead).length;
    const short = (): number => Math.max(0, up() + 1 - budget);
    const g = game({ short, ...setFrees(() => 1), cellReady: () => built });
    bodies = g.bodies;
    const plain = g.deps.spawn;
    g.deps.spawn = (entry, at, how) => (short() > 0 ? 'the budget is full' : plain(entry, at, how));
    const p = new StandingPeople();
    p.adopt(rows, creatures);
    const at = new THREE.Vector3(0, 0, 0);
    p.step(0, 0, at, g.deps, true);
    ok(up() === 3 && p.last.waiting === 1, 'three stand, and the one in a room waits for its building');
    budget = up();
    built = true;
    p.step(PEOPLE_TUNE.everySeconds + 0.1, 2, at, g.deps);
    const standingNow = bodies.filter((b) => !b.removed && !b.dead).map((b) => b.x).sort((x, y) => x - y);
    ok(standingNow.join() === '1,2,90', `the nearer one of the furniture takes the far one's place and its memory, and the thug far off stays standing (${standingNow.join(', ')})`);
    ok(p.last.swapped === 1, 'one put down, not two');
  } finally {
    Object.assign(PEOPLE_TUNE, had);
  }
}

// ------------------------------------------------------------------ the room the data names, among overlapping boxes
{
  // Two buildings, one turned a quarter about y and moved; each has room 1, a big hall, and room 2, a
  // bar whose box sits inside the hall's. A person the data puts in the bar is in the bar, although the
  // hall's box holds the same point; the building whose bar holds the point wins over one that merely
  // has a bar.
  const building = (x: number, z: number, yaw: number, cells: RoomBuilding['model']['def']['cells']): RoomBuilding & { name: string } => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
    return { name: `at ${x},${z}`, x, z, radius: 30, inverse: m.clone().invert(), model: { def: { cells } } };
  };
  const cells = [
    { index: 0, bounds: { min: [-30, -1, -30], max: [30, 10, 30] } },
    { index: 1, bounds: { min: [-20, 0, -20], max: [20, 8, 20] } },
    // The larger corner written first, as a mesh's BOX holds them.
    { index: 2, bounds: { min: [4, 3, 4], max: [0, 0, 0] } },
  ];
  const a = building(100, 0, 0, cells);
  const b = building(130, 0, Math.PI / 2, cells);
  const all = [a, b];
  const at = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  ok(offRoomBox(2, 1, 2, cells[2].bounds) === 0 && Math.abs(offRoomBox(7, 1, 2, cells[2].bounds) - 3) < 1e-9, 'a point inside a box is nought from it, and one outside is its distance, whichever corner came first');
  ok(buildingWithRoomIn(all, at(102, 1, 2), 2) === a, "a person the data puts at a's bar is in a's bar, though a's hall holds the point as well");
  ok(buildingWithRoomIn(all, at(102, 1, 2), 1) === a, 'and one it puts in the hall at the same spot is in the hall');
  // In b's frame, turned a quarter: its bar at local (0..4, 0..4) is world x 130..134, z -4..0.
  ok(buildingWithRoomIn(all, at(131, 1, -2), 2) === b, 'the turned building finds its own bar through its own frame');
  // a's bar runs from world x 100 to 104.
  ok(buildingWithRoomIn(all, at(104 + ROOM_SLACK - 0.5, 1, 2), 2) === a && buildingWithRoomIn(all, at(104 + ROOM_SLACK + 0.5, 1, 2), 2) === null, `a place rounded out of its room by under ${ROOM_SLACK} m is still in it, and one further out is in no room the data can name`);
  ok(buildingWithRoomIn(all, at(102, 1, 2), 7) === null && buildingWithRoomIn(all, at(102, 1, 2), 0) === null, 'a room no building near has is no answer, nor is room nought, which is outside');
  ok(buildingWithRoomIn(all, at(500, 1, 2), 2) === null, 'nor a building too far off to hold the point');
  const layout = readFileSync(new URL('../../../src/world/layoutStream.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  ok(/buildingWithRoom\(pos: THREE\.Vector3, room: number\): CellState \| null \{\s*const best = buildingWithRoomIn\(this\.buildings, pos, room\);\s*return best \? \{ building: best, cell: room \} : null;/.test(layout), 'and the streamer answers with it, over the buildings it holds');
}

// ------------------------------------------------------------------ a real town, where converted
{
  const f = join('assets-private', 'tatooine', 'spawns.json');
  const lay = join('assets-private', 'tatooine', 'layout.json');
  if (!existsSync(f) || !existsSync(lay)) {
    note('no converted pack here, so the rules above stand on their own');
  } else {
    const pack = JSON.parse(readFileSync(f, 'utf8')) as { planet?: string; pools?: Record<string, string[]>; statics: StandingRow[] };
    const centre = (JSON.parse(readFileSync(lay, 'utf8')) as { center: { x: number; z: number } }).center;
    // Adopted exactly as the world adopts it: the rows with the fleet's creatures and the rest of the
    // pack beside them, which is what says who of them is part of the furniture and so which cap each
    // counts against. A pack older than format 2 carries no creatures, and then only the rows the town
    // made peaceful are the furniture.
    const manFile = join('assets-private', 'spawns', 'manifest.json');
    const man = existsSync(manFile) ? (JSON.parse(readFileSync(manFile, 'utf8')) as { format: number; creatures: Record<string, PeopleCreature>; weaponGroups?: Record<string, string[]> }) : null;
    const creatures = man && man.format >= 2 ? man.creatures : null;
    const extras = { world: pack.planet ?? 'tatooine', pools: pack.pools ?? null, weaponGroups: man?.weaponGroups ?? null };
    const adopted = (): StandingPeople => {
      const s = new StandingPeople();
      s.adopt(pack.statics, creatures, extras);
      return s;
    };
    const p = adopted();
    const indoors = pack.statics.filter((r) => r.cell).length;
    note(`a real world carries ${pack.statics.length} people, ${indoors} of them indoors; ${p.last.rows} are standable`);
    ok(p.last.rows > 100, 'which is a world with people in it');

    // Where each of the rows the pass takes stands, in the world's own frame, and which cap it counts
    // against, worked out as the pass works them out; a body's seed is its row's index here too.
    const kept = pack.statics.filter((r) => !(r.cell && (r.room === null || r.room === undefined)));
    const world = kept.map((r) => standPlaceOf({ ...r, ...intoWorld(r.x, r.z, centre), route: r.route?.map((q) => ({ ...q, ...intoWorld(q.x, q.z, centre) })) }));
    const ctx: PlanContext = { creatures, pools: extras.pools, side: 'imperial', reuse: 0 };
    const furniture = kept.map((r) => personFor(r, 0, ctx).essential ?? false);
    const busiest = (want: (i: number) => boolean): { x: number; z: number; n: number } => {
      let best = { x: 0, z: 0, n: 0 };
      for (const r of world) {
        let n = 0;
        for (let i = 0; i < world.length; i++) if (want(i) && Math.hypot(world[i].x - r.x, world[i].z - r.z) < PEOPLE_TUNE.build) n++;
        if (n > best.n) best = { x: r.x, z: r.z, n };
      }
      return best;
    };
    const best = busiest(() => true);
    note(`the busiest spot has ${best.n} people within ${PEOPLE_TUNE.build} m of it`);

    // Stood about a spot a while: each cap on its own kind, full wherever its kind is crowded enough to
    // fill it, and each the nearest of its own kind.
    const standAt = (spot: { x: number; z: number }, what: string): void => {
      const s = adopted();
      const { deps, bodies } = game({ centre: () => centre, cellReady: () => true });
      const at = new THREE.Vector3(spot.x, 0, spot.z);
      for (let i = 0; i < 30; i++) s.step(PEOPLE_TUNE.everySeconds + 0.1, i * 2, at, deps);
      const up = standing(bodies);
      const d = (i: number) => Math.hypot(world[i].x - at.x, world[i].z - at.z);
      for (const kind of [false, true]) {
        const cap = kind ? PEOPLE_TUNE.mostEssential : PEOPLE_TUNE.most;
        const mine = up.filter((b) => !!b.essential === kind);
        const inRange = world.map((_, i) => i).filter((i) => furniture[i] === kind && d(i) <= PEOPLE_TUNE.build);
        const name = kind ? 'of the furniture' : 'who may be fought';
        ok(mine.length === Math.min(cap, inRange.length), `${what}: ${mine.length} ${name} stand of ${inRange.length} in range, their cap ${cap} on their own kind`);
        const upSet = new Set(mine.map((b) => b.seed));
        const farthest = Math.max(-Infinity, ...mine.map((b) => d(b.seed)));
        const nearestLeft = Math.min(Infinity, ...inRange.filter((i) => !upSet.has(i)).map(d));
        ok(farthest <= nearestLeft + 1e-6, `and they are the nearest of their kind: the farthest standing is ${Number.isFinite(farthest) ? farthest.toFixed(1) : 'none'} m, the nearest left ${Number.isFinite(nearestLeft) ? nearestLeft.toFixed(1) : 'none'} m`);
      }
      ok(up.length > 0 && s.last.up === up.length, `${what}: ${s.last.up} up in all (${s.last.indoors} of them indoors) from ${bodies.length} stood`);
    };
    standAt(best, 'the busiest spot');
    const fought = busiest((i) => !furniture[i]);
    const still = busiest((i) => furniture[i]);
    note(`the spot most crowded with people who may be fought has ${fought.n} of them; the one most crowded with the furniture has ${still.n}`);
    if (creatures) ok(fought.n > PEOPLE_TUNE.most && still.n > PEOPLE_TUNE.mostEssential, 'both crowded past their caps, so each cap is really filled from real rows');
    standAt(fought, 'crowded with those who may be fought');
    standAt(still, 'crowded with the furniture');
    const at = new THREE.Vector3(best.x, 0, best.z);
    p.step(0, 0, at, game({ centre: () => centre, cellReady: () => true }).deps, true);

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
    const walk = adopted();
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
    // Each kind against its own: the furniture never waits on those who may be fought, nor they on it.
    for (const kind of [false, true]) {
      const cap = kind ? PEOPLE_TUNE.mostEssential : PEOPLE_TUNE.most;
      const order = world.map((w, i) => ({ d: Math.hypot(w.x - here.x, w.z - here.z), i })).filter((o) => furniture[o.i] === kind).sort((a, b) => a.d - b.d);
      const nearestUp = order.slice(0, cap).filter((o) => upNow.has(o.i)).length;
      const farUp = Math.max(-Infinity, ...order.filter((o) => upNow.has(o.i)).map((o) => o.d));
      const firstWaiting = order.find((o) => o.d <= PEOPLE_TUNE.build && !upNow.has(o.i))?.d ?? Infinity;
      const name = kind ? 'of the furniture' : 'who may be fought';
      note(`after walking 180 m through it, ${nearestUp} of the ${cap} nearest ${name} are standing`);
      ok(farUp <= firstWaiting + PEOPLE_TUNE.swapMargin + 1e-6, `and nobody ${name} standing is more than the margin farther off than anybody of their kind waiting (${Number.isFinite(farUp) ? farUp.toFixed(1) : 'none'} m against ${Number.isFinite(firstWaiting) ? firstWaiting.toFixed(1) : 'none'} m)`);
    }
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
