// The fights a character has, noticed for them (`src/progress/encounter.ts`), on a stand-in clock with stand-in
// members: how one opens, who is in it, what the player's own blows log, how it closes -- won, lost or broken --
// and the claim it hands over.
//
// What is pinned here, each because the design's critique found the first cut could not see it:
//
//   - it opens on a blow landed and on a blow taken, a bolt as much as a bite (a bolt never reaches the record's
//     own `damage`, so the game calls `struckBy` from the bolt's own path), and on a block or a dodge;
//   - a passive beast struck logs nothing and pays nothing, while a defensive creature shot dead before it bites
//     is in the fight and pays;
//   - with no server, a member killed by a burn (dead through `look`, with no blow reported), by a follower and by
//     the companion closes the fight won, and only what the player did is claimed;
//   - a peer, a follower and the companion never join;
//   - heavy counts blows and never a fall, the player's own blast or the surroundings, which never hold a fight open;
//   - the claim's `npc` is the creature and never the world's name for the body;
//   - a blow on a beast not yet in the fight is held, and logged once it joins.
//
// And then the two answers the game itself hands the fight (`src/world/encounterMembers.ts`), over bodies of the
// shapes the game holds with the real predicates, and the wiring in `main.ts` that feeds it, read out of the source.
//
// Synthetic: nothing read from the game's files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ENCOUNTER_TUNE, Encounters, poolBitOf, tuneEncounter, type MemberLook, type MemberWho } from '../../../src/progress/encounter.ts';
import type { EncounterClaim } from '../../../src/progress/payout.ts';
import { memberLook, memberWho, type MemberDeps } from '../../../src/world/encounterMembers.ts';
import type { Living } from '../../../src/combat/kit.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** A stand-in living thing: everything `who` and `look` read of a real one. */
interface Body {
  key: number;
  side: string;
  creature: string;
  npcId: string;
  level: number | null;
  dead: boolean;
  removed: boolean;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  threat: boolean;
  temper: string;
  follow?: boolean;
  companion?: boolean;
}

let nextKey = 2;
const body = (o: Partial<Body> = {}): Body => ({ key: nextKey++, side: 'wild', creature: 'test_kreetle', npcId: '', level: 10, dead: false, removed: false, x: 5, z: 5, hp: 100, maxHp: 100, threat: false, temper: 'defensive', ...o });

/** One stand-in game: a clock, the player's whole health, and every claim the fights hand over. */
function game() {
  const clock = { sim: 0, ms: 1_800_000_000_000 };
  const claims: EncounterClaim[] = [];
  const whys: string[] = [];
  let opened = 0;
  const enc = new Encounters<Body>({
    who: (t: Body, out: MemberWho) => {
      if (t.side === 'player' || t.follow || t.companion) return false;
      out.w = t.npcId;
      out.npc = t.creature;
      out.level = t.level;
      return true;
    },
    look: (t: Body, out: MemberLook) => {
      out.dead = t.dead;
      out.removed = t.removed;
      out.x = t.x;
      out.z = t.z;
      out.hp = t.hp;
      out.maxHp = t.maxHp;
      out.threat = !t.dead && t.threat;
      out.temper = t.temper;
      return true;
    },
    now: () => clock.ms,
    sim: () => clock.sim,
    planet: () => 'testworld',
    diff: () => 1,
    whole: () => 100,
    onOpen: () => void opened++,
    onClose: (c, why) => {
      claims.push(c);
      whys.push(why);
    },
    random: () => 0.5,
  });
  /** Simulated seconds pass, a tick every quarter second as the game ticks them. */
  const pass = (seconds: number) => {
    for (let t = 0; t < seconds; t += 0.25) {
      clock.sim += 0.25;
      clock.ms += 250;
      enc.tick(0, 0);
    }
  };
  return { clock, claims, whys, enc, pass, opened: () => opened };
}

// ---- opening, the members, and what each kind of blow logs -------------------------------------------------------
{
  const g = game();
  const kreetle = body({ temper: 'aggressive', threat: true });
  g.enc.struckBy(kreetle);
  ok(g.enc.isOpen && g.opened() === 1, 'a bite opens a fight');
  g.enc.hit(kreetle, 30, false, 'gun');
  kreetle.dead = true;
  g.enc.hit(kreetle, 70, true, 'gun');
  g.enc.tick(0, 0);
  ok(!g.enc.isOpen && g.claims.length === 1 && g.claims[0].outcome === 'won', 'and it closes won at the next look once everything in it is dead');
  const c = g.claims[0];
  ok(c.used.join() === 'marksmanship' && c.members.length === 1 && c.members[0].fought && c.members[0].dead && c.planet === 'testworld' && c.diff === 1, `a gun's blows log Marksmanship, and the claim names the member, the world and the difficulty (${c.used.join()})`);
  ok(/^e[0-9a-z]+$/.test(c.id) && c.at === g.clock.ms, `the claim's id is the close's shared time and a few figures (${c.id})`);
}
{
  const g = game();
  const shooter = body({ temper: 'aggressive', threat: true, creature: 'test_trooper' });
  // A bolt never reaches the record's `damage`: the game tells the fight from the bolt's own path, the same word.
  g.enc.struckBy(shooter);
  ok(g.enc.isOpen, 'a bolt that lands opens a fight as a bite does');
  g.enc.blocked(shooter);
  g.enc.dodged(shooter);
  g.enc.hit(shooter, 10, false, 'launcher');
  g.enc.hit(shooter, 10, false, 'force');
  shooter.dead = true;
  g.enc.tick(0, 0);
  const used = g.claims[0].used.join();
  ok(used === 'melee,demolitions,acrobatics', `a block logs Melee, a dodge Acrobatics, a launcher Demolitions, and the Force nothing (${used})`);
  ok(poolBitOf('deflect') === poolBitOf('melee') && poolBitOf('demolitions') === poolBitOf('launcher') && poolBitOf(null) === 0 && poolBitOf('force') === 0, "a turned bolt is the blade's, a grenade's is the launcher's pool, and nothing said is nothing");
}
{
  const g = game();
  const shooter = body({ temper: 'aggressive', threat: true });
  g.enc.blocked(shooter);
  ok(g.enc.isOpen, "a block of a member's bolt opens a fight too");
  const g2 = game();
  g2.enc.dodged(body({ temper: 'aggressive', threat: true }));
  ok(g2.enc.isOpen, 'and so does a dodge');
}

// ---- who is in it, and who never is ------------------------------------------------------------------------------
{
  const g = game();
  const bantha = body({ temper: 'passive', creature: 'test_bantha' });
  g.enc.hit(bantha, 50, false, 'gun');
  bantha.dead = true;
  g.enc.hit(bantha, 50, true, 'gun');
  g.enc.tick(0, 0);
  const c = g.claims[0];
  ok(c.outcome === 'won' && c.used.length === 0 && !c.members[0].fought, 'a passive beast struck and killed is in no fight: nothing is logged for it, and its claim pays nothing');
  tuneEncounter({ passivePays: 1 });
  const g2 = game();
  const other = body({ temper: 'passive' });
  g2.enc.hit(other, 50, false, 'gun');
  other.dead = true;
  g2.enc.tick(0, 0);
  ok(g2.claims[0].used.join() === 'marksmanship' && g2.claims[0].members[0].fought, "with the owner's switch turned on, one struck is in the fight and pays");
  tuneEncounter({ passivePays: 0 });
}
{
  const g = game();
  const deer = body({ temper: 'defensive', threat: false, creature: 'test_deer' });
  deer.dead = true;
  g.enc.hit(deer, 200, true, 'gun');
  g.enc.tick(0, 0);
  ok(g.claims[0].used.join() === 'marksmanship' && g.claims[0].members[0].fought, 'a defensive creature shot dead before it bites is in the fight, and pays');
}
{
  const g = game();
  const peer = body({ side: 'player' });
  const follower = body({ follow: true });
  const companion = body({ companion: true });
  g.enc.struckBy(peer);
  g.enc.hit(follower, 5, false, 'gun');
  g.enc.blocked(companion);
  g.enc.dodged(null);
  ok(!g.enc.isOpen && g.claims.length === 0, 'another player, a follower and the companion never join a fight, and a dodge of nobody opens none');
}
{
  const g = game();
  const wild = body({ npcId: 'wild:abcd1234:3', creature: 'test_kreetle', temper: 'aggressive', threat: true });
  g.enc.struckBy(wild);
  wild.dead = true;
  g.enc.tick(0, 0);
  const m = g.claims[0].members[0];
  ok(m.npc === 'test_kreetle' && m.w === 'wild:abcd1234:3', `the claim names the creature as what it is and keeps the world's name apart (${m.npc}, ${m.w})`);
}

// ---- deaths nobody reported: a burn, a follower, the companion ---------------------------------------------------
{
  // A burn: its health falls in its own steps, seen a look at a time, and it dies with no blow reported at all.
  const g = game();
  const a = body({ temper: 'aggressive', threat: true });
  g.enc.struckBy(a);
  g.enc.hit(a, 20, false, 'gun');
  a.hp = 40;
  g.pass(0.25);
  const mid = (g.enc.report() as { members: { share: number }[] }).members[0].share;
  a.hp = 0;
  a.dead = true;
  g.pass(0.25);
  ok(mid === 0.4 && g.claims.length === 1 && g.claims[0].outcome === 'won' && g.claims[0].used.join() === 'marksmanship', `with no server, a member burning down is seen falling through look (${mid} of its health) and dead, and closes the fight won on the player's own blows`);
}
{
  // A follower's kill: the follower's own stray blow on the player and its blow on the foe join nothing (the
  // game's hit watch reports the player's blows alone), and the foe it killed is seen dead.
  const g = game();
  const a = body({ temper: 'aggressive', threat: true });
  const follower = body({ follow: true, temper: 'defensive' });
  g.enc.struckBy(a);
  g.enc.hit(a, 10, false, 'melee');
  g.enc.struckBy(follower);
  a.dead = true;
  g.pass(0.25);
  const c = g.claims[0];
  ok(c?.outcome === 'won' && c.members.length === 1 && c.used.join() === 'melee', "a member killed by a follower closes the fight won, the follower no member of it, claiming only the player's own blow");
}
{
  // The companion's kill: the companion caught by one of the player's own stray blows is no member either.
  const g = game();
  const a = body({ temper: 'aggressive', threat: true });
  const companion = body({ companion: true, temper: 'defensive' });
  g.enc.struckBy(a);
  g.enc.hit(companion, 5, false, 'gun');
  g.enc.dodged(a);
  a.dead = true;
  g.pass(0.25);
  const c = g.claims[0];
  ok(c?.outcome === 'won' && c.members.length === 1 && c.used.join() === 'acrobatics', "a member killed by the companion closes it won, a stray blow on the companion logging nothing");
}
{
  // Held, then logged: a grazing beast struck is held out of the fight, and turns on the player afterwards.
  const g = game();
  const bantha = body({ temper: 'passive', creature: 'test_bantha' });
  g.enc.hit(bantha, 20, false, 'gun');
  g.pass(0.25);
  const held = (g.enc.report() as { logged: string[]; members: { held: string[]; fought: boolean }[] });
  ok(held.logged.length === 0 && held.members[0].held.join() === 'marksmanship' && !held.members[0].fought, 'a blow on a passive beast is held, not logged');
  bantha.threat = true;
  g.pass(0.25);
  bantha.dead = true;
  g.pass(0.25);
  ok(g.claims[0]?.used.join() === 'marksmanship' && g.claims[0].members[0].fought, 'and once look sees it turn on the player it is in the fight, and the held blow is logged');
}
{
  const g = game();
  const a = body({ npcId: 'stood:tatooine:12', temper: 'aggressive', threat: true });
  g.enc.struckBy(a);
  g.enc.gone('stood:tatooine:12', 'dead');
  g.enc.tick(0, 0);
  ok(g.claims[0]?.outcome === 'won', "the server's word of a body another browser keeps dying closes it too");
}

// ---- the calm, a death, a travel ----------------------------------------------------------------------------------
{
  const g = game();
  const a = body({ temper: 'aggressive', threat: true });
  const b = body({ temper: 'aggressive', threat: true });
  g.enc.struckBy(a);
  g.enc.struckBy(b);
  a.dead = true;
  g.pass(1);
  ok(g.enc.isOpen, 'one of two down, the fight goes on');
  b.threat = false;
  g.pass(ENCOUNTER_TUNE.calm + 1);
  ok(g.claims.length === 1 && g.claims[0].outcome === 'won', 'gone quiet with one down and the other out of the fight, it is won');
}
{
  const g = game();
  const a = body({ temper: 'aggressive', threat: true });
  const b = body({ temper: 'aggressive', threat: true });
  g.enc.struckBy(a);
  g.enc.struckBy(b);
  a.dead = true;
  g.pass(ENCOUNTER_TUNE.calm + 1);
  ok(g.claims[0]?.outcome === 'broken', 'gone quiet with a foe still after the player, it is broken off');
}
{
  const g = game();
  const a = body({ temper: 'aggressive', threat: true });
  const b = body({ temper: 'aggressive', threat: true });
  g.enc.struckBy(a);
  g.enc.struckBy(b);
  a.dead = true;
  b.x = 500;
  g.pass(ENCOUNTER_TUNE.calm + 1);
  ok(g.claims[0]?.outcome === 'won', 'a living foe farther than the leave range is out of the fight');
}
{
  const g = game();
  const a = body({ temper: 'aggressive', threat: true });
  g.enc.struckBy(a);
  g.pass(ENCOUNTER_TUNE.calm + 1);
  ok(g.claims[0]?.outcome === 'broken', 'gone quiet with nothing down, it is broken off');
}
{
  const g = game();
  g.enc.struckBy(body({ temper: 'aggressive', threat: true }));
  g.enc.died();
  ok(g.claims[0]?.outcome === 'lost' && !g.enc.isOpen, 'the player dying loses it');
  const g2 = game();
  g2.enc.struckBy(body({ temper: 'aggressive', threat: true }));
  g2.enc.left();
  ok(g2.claims[0]?.outcome === 'broken', 'and a travel or the select screen breaks it off');
  g2.enc.left();
  g2.enc.died();
  ok(g2.claims.length === 1, 'with nothing open, neither does anything');
}

// ---- heavy: blows only ---------------------------------------------------------------------------------------------
{
  const run = (kind: 'blow' | 'fall' | 'self' | 'env', lost: number) => {
    const g = game();
    const a = body({ temper: 'aggressive', threat: true });
    g.enc.struckBy(a);
    g.enc.hurt(lost, kind);
    a.dead = true;
    g.enc.tick(0, 0);
    return g.claims[0].heavy;
  };
  ok(run('blow', 55) === true && run('blow', 40) === false, 'half the whole lost to blows makes a fight heavy, and less does not');
  ok(run('fall', 80) === false && run('self', 80) === false && run('env', 80) === false, "a fall, the player's own blast and the surroundings (lava, drowning, a fire's tick) never do, however much they take");
  // Nor do the surroundings keep a fight from going quiet: standing in lava is no fight.
  const quiet = game();
  quiet.enc.struckBy(body({ temper: 'aggressive', threat: true }));
  for (let i = 0; i < ENCOUNTER_TUNE.calm + 2; i++) {
    quiet.enc.hurt(5, 'env');
    quiet.pass(1);
  }
  ok(quiet.claims[0]?.outcome === 'broken', 'a lava tick a second does not hold a fight open: it goes quiet on its own calm');
  const g = game();
  g.enc.struckBy(body({ temper: 'aggressive', threat: true }));
  g.enc.hurt(90, 'blow');
  g.enc.died();
  ok(g.claims[0].heavy === false, 'and a fight lost is never heavy: Fortitude is for living through it');
}

// ---- the cap on members, and the console -----------------------------------------------------------------------------
{
  const g = game();
  for (let i = 0; i < ENCOUNTER_TUNE.membersMax + 5; i++) g.enc.struckBy(body({ temper: 'aggressive', threat: true }));
  const r = g.enc.report() as { members: unknown[] };
  ok(r.members.length === ENCOUNTER_TUNE.membersMax, `a fight holds at most ${ENCOUNTER_TUNE.membersMax} members`);
  g.enc.left();
  g.enc.notePaid(g.claims[0].id, { fortitude: 12 }, 'test');
  ok(g.enc.closed.length === 1 && g.enc.closed[0].paid?.fortitude === 12, 'a closed fight is kept for the console with what it was paid');
  for (let i = 0; i < ENCOUNTER_TUNE.kept + 3; i++) {
    g.enc.struckBy(body({ temper: 'aggressive', threat: true }));
    g.enc.left();
  }
  ok(g.enc.closed.length === ENCOUNTER_TUNE.kept, `and only the last ${ENCOUNTER_TUNE.kept}`);
}

// ---- the game's own answers: `who` and `look` over bodies of the shapes the game holds --------------------------------
//
// The cases above drive the fight with a stand-in `who` and `look`. These run the game's own two
// (`src/world/encounterMembers.ts`, which `main.ts` hands the fight) with the real predicates over bodies shaped as
// the game's are: the player's record, another player (side `player`), a follower (a body carrying `follow`), the
// companion, a lair's creature, a fighter and one of the old creatures.
{
  const at = (x = 0, z = 0) => ({ x, y: 0, z }) as never;
  const living = (o: Record<string, unknown>): Living => ({ key: nextKey++, label: 'somebody', side: 'wild', aggression: 'defensive', pos: at(5, 5), halfHeight: 0.9, dead: false, damage: () => {}, radiusToward: () => 0.4, ...o }) as unknown as Living;
  const player = living({ key: 1, label: 'you', side: 'player', aggression: 'aggressive' });
  const peer = living({ label: 'Someone Else', side: 'player', aggression: 'aggressive' });
  const follower = living({ side: 'civilian', aggression: 'defensive', follow: { slotX: 1, slotZ: 1 } });
  const companion = living({ side: 'civilian', aggression: 'defensive', creature: 'test_companion' });
  // A lair's creature: its row's own creature, its world name, its own level, and what it is fighting.
  let fightsUs = false;
  const kreetle = living({ side: 'wild', aggression: 'defensive', creature: 'test_kreetle', npcId: 'wild:abcd:2', level: 7, hp: 80, maxHp: 120, removed: false, fights: (ours: (k: number) => boolean) => fightsUs && ours(1) });
  const fighter = living({ side: 'fighter', aggression: 'aggressive', species: 'test_rodian' });
  const old = living({ side: 'wild', aggression: 'aggressive', def: { name: 'test_womp' }, label: 'a womp rat' });
  const deps: MemberDeps = { player: () => player, isCompanion: (t) => t === companion, ours: (k) => k === 1 };
  const who: MemberWho = { w: '', npc: '', level: null };
  ok(!memberWho(player, who, deps) && !memberWho(peer, who, deps) && !memberWho(follower, who, deps) && !memberWho(companion, who, deps), "the player's record, another player, a follower and the companion are never members, by the game's own predicates");
  ok(memberWho(kreetle, who, deps) && who.npc === 'test_kreetle' && who.w === 'wild:abcd:2' && who.level === 7, `a lair's creature is its row's own creature, under its world name, at its own level (${who.npc}, ${who.w}, ${who.level})`);
  ok(memberWho(fighter, who, deps) && who.npc === 'test_rodian' && who.w === '' && who.level === null, "a fighter is its species, with no world name and no level");
  ok(memberWho(old, who, deps) && who.npc === 'test_womp', "and one of the old creatures its own name");
  const look: MemberLook = { dead: false, removed: false, x: 0, z: 0, hp: 0, maxHp: 0, threat: false, temper: '' };
  memberLook(kreetle, look, deps);
  ok(!look.dead && !look.removed && look.hp === 80 && look.maxHp === 120 && !look.threat && look.temper === 'defensive', 'look reads its health, its temper, and a defensive creature that is fighting nobody as out of the fight');
  fightsUs = true;
  memberLook(kreetle, look, deps);
  ok(look.threat, 'one fighting the player is a threat');
  memberLook(old, look, deps);
  ok(look.threat, 'an aggressive wild thing is a threat on sight');
  (kreetle as { dead: boolean }).dead = true;
  memberLook(kreetle, look, deps);
  ok(look.dead && !look.threat, 'and a dead one is dead, and nobody\'s threat');

  // The fight itself over those answers: nobody of the player's side opens one, and a burn's kill is seen.
  (kreetle as { dead: boolean }).dead = false;
  fightsUs = false;
  const claims: EncounterClaim[] = [];
  let sim = 0;
  const enc = new Encounters<Living>({
    who: (t, out) => memberWho(t, out, deps),
    look: (t, out) => memberLook(t, out, deps),
    now: () => 1_800_000_000_000 + sim * 1000,
    sim: () => sim,
    planet: () => 'testworld',
    diff: () => 1,
    whole: () => 100,
    onClose: (c) => claims.push(c),
    random: () => 0.5,
  });
  enc.struckBy(peer);
  enc.hit(follower, 5, false, 'gun');
  enc.blocked(companion);
  enc.dodged(player);
  ok(!enc.isOpen, 'over the real answers, another player, a follower, the companion and the player open no fight');
  enc.hit(kreetle, 20, false, 'gun');
  ok(enc.isOpen, 'a defensive creature struck opens one');
  (kreetle as { dead: boolean; hp: number }).dead = true;
  (kreetle as { hp: number }).hp = 0;
  sim += 0.25;
  enc.tick(0, 0);
  ok(claims[0]?.outcome === 'won' && claims[0].members[0].npc === 'test_kreetle' && claims[0].used.join() === 'marksmanship', 'and dying of its burn, seen by the real look, closes it won');
}

// ---- the wiring, read out of the file that loads three ---------------------------------------------------------------
//
// `main.ts` cannot run here, so what feeds the fight is read out of it: every hurt path tells the fight, the hit watch
// hands over what struck, the player's own hooks are hung, a death loses it, every way out of a world breaks it off, and
// the fight is looked at four times a second after the story's own step, in the frame and in `__debug.advance`.
{
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const body = (signature: string): string => {
    const at = main.indexOf(signature);
    assert.ok(at >= 0, `no ${signature} in main.ts`);
    let i = main.indexOf('{', at + signature.length - 1);
    const start = i;
    let depth = 0;
    for (; i < main.length; i++) {
      if (main[i] === '{') depth++;
      else if (main[i] === '}' && --depth === 0) break;
    }
    return main.slice(start, i + 1);
  };
  ok(body('private encounterWho(t: Living, out: MemberWho): boolean').includes('return memberWho(t, out, this.memberDeps);') && body('private encounterLook(t: Living, out: MemberLook): boolean').includes('return memberLook(t, out, this.memberDeps);'), "the game's who and look are the two answers tested above");
  ok(/player: \(\) => this\.world\.playerTarget,\s*isCompanion: \(t\) => isMobileBody\(t\) && this\.companion\.isBody\(t\),\s*ours: \(key\) => this\.companionOurs\(key\),/.test(main) && /private readonly companionOurs = \(key: number\): boolean => key === this\.world\.playerTarget\.key \|\| this\.world\.followers\.hasKey\(key\);/.test(main), 'handed the player, the companion keeper and the player\'s side');
  ok(/who: \(t, out\) => this\.encounterWho\(t, out\),\s*look: \(t, out\) => this\.encounterLook\(t, out\),/.test(main) && main.includes('sim: () => this.world?.simTime ?? 0,'), "and the fight is handed them, on the world's simulated clock");
  const wrapper = body('target.damage = (amount: number, from?: THREE.Vector3, _push?: number, source?: Living | null): void =>');
  ok(wrapper.indexOf('if (source && source !== target) this.encounters.struckBy(source);') > wrapper.indexOf('if (isFollowerSource(source)) return;') && wrapper.indexOf('this.encounters.struckBy(source)') < wrapper.indexOf('innerDamage(amount, from)'), "a blow on the player's record tells the fight before it costs anything, a follower's never");
  const shot = body('onPlayerHit: (dmg, from, source) =>');
  ok(shot.indexOf('if (source) this.encounters.struckBy(source);') > shot.indexOf('if (isFollowerSource(source)) return;') && shot.indexOf('this.encounters.struckBy(source)') < shot.indexOf("player.takeDamage(dmg, false, 'blow', source ?? null)"), 'a bolt, which never reaches the record, tells the fight itself before its blow lands, and names its source to the roll');
  ok(body('block: (bolt, hit, out) =>').includes('if (held && !bolt.inert) this.encounters.blocked(bolt.source);'), 'a bolt turned away is a block of its shooter');
  ok(body('this.world.watchPlayerHits((hit, amount, killed, kind) =>').includes('this.encounters.hit(hit, amount, killed, kind);'), "the player's own blows go to the fight with what struck");
  ok(main.includes('this.player.onHarm = (lost, kind) => this.encounters.hurt(lost, kind);') && main.includes('this.player.onDodge = (source) => this.encounters.dodged(source as Living | null);') && /this\.progress\.task\(\{ id: [^\n]*, at, kind: 'roll', fell, saved \}\);/.test(body('this.player.onRolled = (fell, saved) =>')),"the player's harm, dodges and landing rolls are hung on the player");
  ok(body('private die(): void').includes('this.encounters.died();'), 'dying loses the fight');
  for (const [what, sig] of [
    ['a travel', 'private async travel(planet: PlanetDef, zoneId?: string, ship?: ShipCrossing, opts?: TravelOpts): Promise<Vehicle | null>'],
    ['a jump to another system', 'private async carryAcross(zone: string, hull: Vehicle, pose: { pos: THREE.Vector3; quaternion: THREE.Quaternion }): Promise<Vehicle | null>'],
    ['the way to the select screen', 'private switchToSelect(): void'],
  ] as const) {
    const b = body(sig);
    ok(/this\.encounters\.left\(\);\s*this\.teacher = null;/.test(b), `${what} breaks the fight off and leaves the trainer behind`);
  }
  const carry = body('private async carryAcross(zone: string, hull: Vehicle, pose: { pos: THREE.Vector3; quaternion: THREE.Quaternion }): Promise<Vehicle | null>');
  ok(carry.indexOf('this.encounters.left();') < carry.indexOf('this.world.loadCarrying('), 'and the jump does it before the world it was in goes');
  ok(/this\.stepStory\(rawDt, simulate\);\s*(\/\/[^\n]*\n\s*)*this\.stepProgress\(rawDt, simulate\);/.test(main) && /this\.stepStory\(dt, true\);\s*(\/\/[^\n]*\n\s*)*this\.stepProgress\(dt, true\);/.test(main), 'the fight is stepped right after the story, in the frame loop and in __debug.advance');
  const step = body('private stepProgress(dt: number, simulate: boolean): void');
  ok(step.indexOf('this.encounters.tick(at.x, at.z);') > step.indexOf('if (!simulate || this.dying) return;'), 'and looked at only while the game simulates');
  ok(main.includes('if (!fresh) this.encounters.gone(id, why);'), "the server's word of a kept body going reaches the fight");
  ok(/onOpen: \(\) => \{\s*this\.player\.lastStand = reached\(this\.progress\.record, 'fortitude', 75, PROGRESS_RULES\);\s*\},\s*onClose: \(claim\) => \{\s*this\.player\.lastStand = false;\s*const o = this\.progress\.claim\(claim\);/.test(main), 'last stand is armed as a fight opens with Fortitude 75 and put down as it closes, which hands the claim over');
}

console.log(`\n${checks} checks passed`);
