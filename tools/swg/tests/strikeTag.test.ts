// What struck, held for the length of one blow (`src/combat/strikeTag.ts`): every skill but Acrobatics and
// Fortitude is paid only through it, since the `damage(amount, from, push, source)` contract says who struck and
// never with what. So what is pinned here is that each of the player's own strikes says what it is:
//
//   - `strikeAs` holds the kind for the call and puts back what was there, a throw and a nested hold included;
//   - the blade's sweep, run for real in a real physics world, lands the player's blow as `melee` and anybody
//     else's as nothing, and leaves the kind as it found it;
//   - every other site, in files that load three and cannot be run here, is read out of its source: the bolts (a
//     shot's own kind, a turned bolt the blade's, a bolt an NPC turned nobody's), the Bounty Hunter's guns,
//     grenades, charges, clouds, flame and beams, the Force, the fists, and the world's hit watch, which is where
//     the kind is read inside the call and handed to the fight;
//   - and Marksmanship 25's steady aim, which waits on a still aim, where the shot reads it.
//
// Synthetic: nothing read from the game's files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { STRIKE, strikeAs, type StrikeKind } from '../../../src/combat/strikeTag.ts';
import { BLADE_RADIUS, playerStrike, strikeSweep, type Striker } from '../../../src/combat/sweep.ts';
import type { Hittable, KitContext, Living } from '../../../src/combat/kit.ts';
import { Physics, RAPIER } from '../../../src/core/physics.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** A body that writes down what kind of blow it was dealt, read inside its own `damage`. */
const target = (pos = new THREE.Vector3()): Hittable & { seen: (StrikeKind | null)[] } => {
  const seen: (StrikeKind | null)[] = [];
  return { pos, halfHeight: 0.9, dead: false, seen, damage: () => void seen.push(STRIKE.kind) };
};

// ---- strikeAs ---------------------------------------------------------------------------------------------------------
{
  ok(STRIKE.kind === null, 'nobody says what struck until a blow does');
  const t = target();
  strikeAs('gun', t, 10);
  ok(t.seen.join() === 'gun' && STRIKE.kind === null, "a gun's blow is a gun's for the length of the call, and nothing after it");
  // A blast's loop holds its own kind round every blow; a single blow inside it is its own and the loop's comes back.
  STRIKE.kind = 'demolitions';
  strikeAs('melee', t, 1);
  ok(t.seen.at(-1) === 'melee' && STRIKE.kind === 'demolitions', 'a blow inside a held kind is its own, and the held one is back after it');
  strikeAs(null, t, 1);
  ok(t.seen.at(-1) === null && STRIKE.kind === 'demolitions', "and one that is nobody's (a bolt the player did not fire) is nobody's even there");
  STRIKE.kind = null;
  const bad: Hittable = { pos: new THREE.Vector3(), halfHeight: 1, dead: false, damage: () => { throw new Error('test: a body that throws'); } };
  assert.throws(() => strikeAs('launcher', bad, 1));
  ok(STRIKE.kind === null, 'a blow that throws still puts the kind back');
}

// ---- the blade's sweep, in a real physics world -------------------------------------------------------------------------
{
  const physics = await Physics.create();
  const hit = target(new THREE.Vector3(0, 1, 0));
  const collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(0.6, 0.4).setTranslation(0, 1, 0));
  const map = new Map<number, Hittable>([[collider.handle, hit]]);
  // Scene queries see nothing until the world has stepped once.
  physics.stepOnce();
  const me = { key: 1, label: 'you', side: 'player', aggression: 'aggressive' } as unknown as Living;
  const ctx = {
    player: { pos: new THREE.Vector3(0, 0, 2), body: undefined, aboard: null, damageBoost: 1 },
    world: { playerTarget: me, hittableAt: (h: number) => map.get(h) },
    physics,
    effects: null,
  } as unknown as KitContext;
  const who = playerStrike(ctx, null, BLADE_RADIUS, 20, 5, 0xffffff, 0);
  const n = strikeSweep(who, { x: -1, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }, new Set<Hittable>());
  ok(n === 1 && hit.seen.join() === 'melee' && STRIKE.kind === null, `the player's blade cutting a body lands as melee, and leaves nothing said after (${hit.seen.join()})`);
  // Anybody else's striker says nothing: a fighter's swing is nobody's progress.
  const theirs: Striker = { physics, hittableAt: (h) => map.get(h), effects: null, source: null, from: new THREE.Vector3(), exclude: undefined, spare: null, radius: BLADE_RADIUS, damage: 5, push: 1, color: 0, now: 0 };
  strikeSweep(theirs, { x: -1, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }, new Set<Hittable>());
  ok(hit.seen.at(-1) === null && STRIKE.kind === null, "and a fighter's blade lands as nothing");
  STRIKE.kind = 'gun';
  strikeSweep(theirs, { x: -1, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }, new Set<Hittable>());
  ok(hit.seen.at(-1) === 'gun' && STRIKE.kind === 'gun', "leaving whatever was held as it was");
  STRIKE.kind = null;
}

// ---- every other site, read out of its source ----------------------------------------------------------------------------
{
  const src = (rel: string): string => readFileSync(new URL(`../../../src/${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const bolts = src('combat/bolts.ts');
  ok(/scar = 'bolt', kind = null \} = o;/.test(bolts) && /scar: scar \?\? null, kind, dodged: false \};/.test(bolts), "a bolt carries the kind it was fired with, nobody's when none is said");
  ok(/b\.source = w\.playerSource \?\? null;\s*(\/\/[^\n]*\n\s*)*b\.kind = 'deflect';/.test(bolts), "a bolt the player's blade turns is the blade's from then on");
  ok(/b\.source = typeof \(struck as Partial<Living>\)\.key === 'number' \? \(struck as Living\) : null;\s*(\/\/[^\n]*\n\s*)*b\.kind = null;/.test(bolts), "and one somebody else's blade turns is nobody's");
  ok(bolts.includes('strikeAs(b.kind, target, b.damage, tmp, b.push, b.source);') && !/target\.damage\(b\.damage/.test(bolts), "a bolt lands as its own kind, through strikeAs and nowhere else");
  ok((bolts.match(/if \(w\.dodge\?\.rolling && !b\.dodged && !b\.inert && b\.owner !== 'player'\) this\.noteDodge\(b, w, /g) ?? []).length === 2 && /b\.dodged = true;\s*d\.onDodge\(b\.source\);/.test(bolts), "somebody else's real bolt going by a rolling player is a dodge, once, on both of its ways past");

  const hunter = src('combat/bountyHunter.ts');
  ok(/function strikeKindOf\(gun: GunProfile\): StrikeKind \{\s*return gun\.type === 'rocket' \? 'launcher' : 'gun';\s*\}/.test(hunter), "a launcher's rocket is Demolitions' work and every other gun's shot Marksmanship's");
  ok(/const kind = strikeKindOf\(gun\);/.test(hunter) && /scar: scarFamilyOf\(gun\.type, fx\?\.id\),\s*kind,\s*onHit: \(p, target\) => \{\s*if \(mode\.splash\) this\.blast\(ctx, p, mode\.splash\.damage, mode\.splash\.radius, kind, mode\);/.test(hunter), "a gun's bolt and its splash carry the gun's kind");
  ok(hunter.includes('strikeAs(strikeKindOf(profile), target, damage, tmp, mode.push * (1 + level), world.playerTarget);') && hunter.includes('if (mode.splash) this.blast(ctx, end, mode.splash.damage, mode.splash.radius, strikeKindOf(profile), mode);'), 'and so do a hitscan shot and its splash');
  ok(hunter.includes("strikeAs('gun', target, mode.damage * dt, player.pos, 0, world.playerTarget);") && hunter.includes("strikeAs('gun', other, mode.damage * mode.chain.share * dt, player.pos, 0, world.playerTarget);"), "a beam and its chain are a gun's");
  ok(/STRIKE\.kind = 'gun';\s*try \{\s*for \(const c of this\.targets\(ctx\)\) \{[\s\S]{0,400}?c\.damage\(mode\.damage \* dt, player\.pos, 0, world\.playerTarget\);/.test(hunter), "a held stream's cone is a gun's, held round the whole loop");
  ok(/STRIKE\.kind = 'demolitions';\s*try \{\s*for \(const h of this\.targets\(ctx\)\) \{[\s\S]{0,300}?h\.damage\(cl\.spec\.damage \* 0\.1, cl\.pos, 0, ctx\.world\.playerTarget\);/.test(hunter), "a grenade's cloud stings as Demolitions'");
  ok(/private blast\(ctx: KitContext, at: THREE\.Vector3, damage: number, radius: number, kind: StrikeKind,/.test(hunter) && /STRIKE\.kind = kind;\s*try \{\s*for \(const c of this\.targets\(ctx\)\) \{[\s\S]{0,300}?c\.damage\(damage \* f \+ damage \* 0\.1, at, push \* f \+ 4, world\.playerTarget\);[\s\S]{0,400}?\} finally \{\s*STRIKE\.kind = was;/.test(hunter), 'a blast holds the kind it is handed round every body it reaches, and puts it back');
  ok(hunter.includes("this.blast(ctx, at, c.damage, c.radius, c.mode ? 'gun' : 'demolitions', c.mode,"), "a grenade's or a charge's detonation is Demolitions', a gun's mine a gun's");
  ok(hunter.includes('this.blast(ctx, tmp, mode.splash?.damage ?? mode.damage, mode.splash?.radius ?? 5, strikeKindOf(gun), mode, mode.push);'), "a shot fired into the ground at the feet blows up as the gun's kind");
  ok((hunter.match(/this\.blast\(/g) ?? []).length === 4, 'and those four are every blast the kit sets off');
  // Marksmanship 25: a still aim for a breath takes the steady share off the aimed spread, exactly 1 until then.
  ok(hunter.includes('this.aimStill = player.aiming && !player.moving ? this.aimStill + dt : 0;') && hunter.includes('const steady = player.aiming && this.aimStill >= PROGRESS_RULES.core.marksmanship.steadyAfter ? player.stats.steady : 1;') && hunter.includes('const base = ((player.aiming ? mode.aimSpread : mode.spread) * player.postureSpread * steady * Math.PI) / 180;'), "the aimed spread takes the steady share once the aim has been still long enough, and only then");

  const jedi = src('combat/jedi.ts');
  ok((jedi.match(/strikeAs\('force', /g) ?? []).length === 4 && !/[^.\w]\w+\.damage\(/.test(jedi.replace(/strikeAs\([^;]*;/g, '')), "every Force power's blow is the Force's, and the Jedi kit deals no blow any other way");
  ok(/const who = playerStrike\(ctx, frame, radius, damage, push, SABER_SPARK, now\);/.test(jedi) && /sweepCapsule\(ctx, a, b, spec\.radius, spec\.damage, this\.hit,/.test(src('combat/unarmed.ts')), "the saber and the fists strike through the player's striker, which is melee (run above)");
  const sweep = src('combat/sweep.ts');
  ok(/mine\.kind = 'melee';\s*return mine;/.test(sweep) && /if \(who\.kind\) STRIKE\.kind = who\.kind;\s*try \{\s*c\.damage\(who\.damage, who\.from, who\.push, who\.source\);\s*\} finally \{\s*STRIKE\.kind = was;/.test(sweep), "and that striker says so on every call, whatever a fighter's left in it");

  const world = src('world/world.ts');
  ok(/if \(!watch \|\| before \|\| source !== this\.playerTarget \|\| t === this\.playerTarget\) return;\s*watch\(t, amount, !before && t\.dead, STRIKE\.kind\);/.test(world), "the world's hit watch reads the kind inside the blow, for the player's own blows alone, and hands it to the fight");
}

console.log(`\n${checks} checks passed`);
