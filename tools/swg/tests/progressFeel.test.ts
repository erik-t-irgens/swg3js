// What the four core skills do to the player's own body, through the real movement and the real harm rule:
// Acrobatics 25's roll out of a fall, the roll's dodge, and Fortitude 75's last stand -- and that with nothing
// earned the harm rule is the one line it replaced, to the bit.
//
// The movement is `src/player/jkaMove.ts` itself, dropped from a height until it lands; the stats are
// `src/player/playerStats.ts` worked out from a TEST record; the harm is `src/player/harmRule.ts`, whose `takeHarm`
// is the whole of `Player.takeDamage` past god mode and is run here over a body carrying the real movement and the
// real stats. Where the game hands it what kind of loss a loss is -- a fall, the player's own blast, the
// surroundings -- is read out of the sources that load three. Nothing read from the game's files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { JkaMovement, UNIT, type MoveCommand } from '../../../src/player/jkaMove.ts';
import { PlayerStats } from '../../../src/player/playerStats.ts';
import { harmOf, newHarm, newHarmAsk, recordHarmKind, takeHarm, type HarmAsk, type HarmBody, type HarmKind } from '../../../src/player/harmRule.ts';
import { xpFor } from '../../../src/progress/core.ts';
import { emptyRecord } from '../../../src/progress/record.ts';
import { PROGRESS_RULES } from '../../../src/progress/tune.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** The stats a TEST record with this much Acrobatics XP makes. */
const statsAt = (acrobatics: number): PlayerStats => {
  const rec = emptyRecord('c1');
  if (acrobatics > 0) rec.core.acrobatics = acrobatics;
  const s = new PlayerStats();
  s.update(rec);
  return s;
};

/** A command running forward, crouched or not, carrying what the stats make of a fall. */
const cmdOf = (crouch: boolean, s: PlayerStats): MoveCommand => ({
  forward: new THREE.Vector3(0, 0, -1),
  right: new THREE.Vector3(1, 0, 0),
  fmove: 1,
  smove: 0,
  walk: false,
  crouch,
  roll: false,
  jump: false,
  jumpPressed: false,
  attack: false,
  speedScale: 1,
  fallSafeExtra: s.fallSafeExtra / UNIT,
  rollDivisor: s.rollDivisor,
  rollFree: s.rollFree,
  airAccel: s.airAccel,
});

/** Drop from a height and land: the harm taken, what the roll saved, and how far the landing says it fell. */
const drop = (height: number, crouch: boolean, s: PlayerStats): { harm: number; saved: number; fell: number } => {
  const jka = new JkaMovement();
  jka.forceLevel = 0;
  jka.reset();
  const pos = new THREE.Vector3(0, height, 0);
  const vel = new THREE.Vector3();
  const cmd = cmdOf(crouch, s);
  let grounded = false;
  let harm = 0;
  let saved = 0;
  let fell = 0;
  const force = { value: 100, spend: () => {} };
  for (let i = 0; i < 2000; i++) {
    const ev = jka.step(1 / 60, vel, pos, grounded, cmd, force);
    harm += ev.damage;
    saved += ev.rollSaved;
    if (ev.fell > 0) fell = ev.fell;
    pos.addScaledVector(vel, 1 / 60);
    if (pos.y <= 0) {
      if (grounded) break;
      pos.y = 0;
      grounded = true;
    }
  }
  return { harm, saved, fell };
};

// ---- Acrobatics 25: a roll out of a fall from up to eight metres takes nothing ---------------------------------------
{
  const plain = statsAt(0);
  const at25 = statsAt(xpFor(25, PROGRESS_RULES));
  ok(plain.rollFree === 0 && at25.rollFree === 8, `Acrobatics 25 sets the free roll at eight metres (${at25.rollFree})`);
  const today8 = drop(8, true, plain);
  const free8 = drop(8, true, at25);
  ok(today8.harm > 0 && free8.harm === 0 && free8.saved > 0, `a crouched landing from 8 m takes ${today8.harm} today and nothing at Acrobatics 25, which saves ${free8.saved}`);
  ok(Math.abs(free8.fell - 8) < 0.5, `and the landing says how far it fell (${free8.fell.toFixed(2)} m)`);
  const unrolled9 = drop(9, false, at25);
  const rolled9 = drop(9, true, at25);
  ok(rolled9.harm > 0 && rolled9.harm === Math.round(unrolled9.harm / at25.rollDivisor), `from 9 m it takes the roll's share as ever (${rolled9.harm} of ${unrolled9.harm}, divided by ${at25.rollDivisor})`);
  ok(rolled9.saved === unrolled9.harm - rolled9.harm, `and what the roll saved is what it took off (${rolled9.saved})`);
  const today9 = drop(9, true, plain);
  ok(today9.saved === drop(9, false, plain).harm - today9.harm, "today's roll says what it saved too, which is what pays Acrobatics");
}

// ---- the roll's dodge, through the real movement and the harm rule ---------------------------------------------------
{
  const jka = new JkaMovement();
  jka.forceLevel = 0;
  jka.reset();
  ok(jka.rollElapsed === Infinity, 'not rolling, a roll has run for ever');
  const pos = new THREE.Vector3(0, 0, 0);
  const vel = new THREE.Vector3();
  const cmd = { ...cmdOf(false, statsAt(0)), roll: true };
  const force = { value: 100, spend: () => {} };
  jka.step(1 / 60, vel, pos, true, cmd, force);
  ok(jka.rolling && jka.rollElapsed === 0, 'a roll begun has run for nought');
  cmd.roll = false;
  for (let i = 0; i < 6; i++) jka.step(1 / 60, vel, pos, true, cmd, force);
  const early = jka.rollElapsed;
  for (let i = 0; i < 6; i++) jka.step(1 / 60, vel, pos, true, cmd, force);
  const late = jka.rollElapsed;
  const at100 = statsAt(xpFor(100, PROGRESS_RULES));
  ok(at100.rollIframes === 0.15 && statsAt(0).rollIframes === 0, `Acrobatics 100 dodges for 0.15 s, nothing earned for none (${at100.rollIframes})`);
  const ask = (o: Partial<HarmAsk>): HarmAsk => ({ hp: 80, amount: 20, taken: 1, force: false, kind: 'blow', god: false, rollElapsed: Infinity, iframes: 0, lastStand: false, ...o });
  const out = newHarm();
  ok(harmOf(ask({ rollElapsed: early, iframes: at100.rollIframes }), out).refused === 'dodge' && out.hp === 80, `a blow inside the window (${early.toFixed(3)} s in) is dodged and takes nothing`);
  ok(harmOf(ask({ rollElapsed: late, iframes: at100.rollIframes }), out).refused === null && out.hp === 60, `and one after it (${late.toFixed(3)} s in) lands`);
  ok(harmOf(ask({ rollElapsed: early, iframes: 0.15, kind: 'fall' }), out).refused === null && harmOf(ask({ rollElapsed: early, iframes: 0.15, kind: 'self' }), out).refused === null && harmOf(ask({ rollElapsed: early, iframes: 0.15, force: true }), out).refused === null, "a fall, the player's own blast and the console's kill are never dodged");
  ok(harmOf(ask({ god: true, rollElapsed: early, iframes: 0.15 }), out).refused === 'god', 'god mode answers first, as it always did');
}

// ---- last stand: once ---------------------------------------------------------------------------------------------------
{
  const out = newHarm();
  const a: HarmAsk = { hp: 30, amount: 50, taken: 1, force: false, kind: 'blow', god: false, rollElapsed: Infinity, iframes: 0, lastStand: true };
  harmOf(a, out);
  ok(out.hp === 1 && out.stood && out.lost === 29, 'a lethal blow with last stand armed leaves one point of health, and spends it');
  harmOf({ ...a, hp: 1, lastStand: false }, out);
  ok(out.hp === 0 && !out.stood, 'and the next one kills');
  ok(harmOf({ ...a, kind: 'fall' }, out).hp === 1, 'a lethal fall is stood through as a blow is');
  ok(harmOf({ ...a, kind: 'self' }, out).hp === 0 && harmOf({ ...a, force: true }, out).hp === 0, "never the player's own blast, nor the console's kill");
  ok(harmOf({ ...a, amount: 10 }, out).hp === 20 && !out.stood, 'a blow that does not kill leaves last stand armed');
}

// ---- with nothing earned, the one line it replaced ----------------------------------------------------------------------
{
  const out = newHarm();
  const bad: string[] = [];
  for (const hp of [100, 57.25, 1, 0.5, 0]) {
    for (const amount of [0, 0.3, 1 / 3, 20, 99.9, 150, 1e9]) {
      for (const taken of [1, 0.5, 0.3]) {
        harmOf({ hp, amount, taken, force: false, kind: 'blow', god: false, rollElapsed: 0, iframes: 0, lastStand: false }, out);
        if (!Object.is(out.hp, Math.max(0, hp - amount * taken))) bad.push(`${hp}-${amount}x${taken}`);
      }
    }
  }
  ok(bad.length === 0, `with no dodge and no last stand, health after a blow is today's line to the bit, even mid-roll (${bad.join(', ') || '105 cases'})`);
}

// ---- the glue `Player.takeDamage` runs, over a body with the real movement and the real stats -----------------------------
//
// `takeHarm` is the whole of `Player.takeDamage` past god mode: it reads the roll off the body's own `JkaMovement`, the
// dodge window off its own stats and last stand off the body, and writes the answer back. Run here with the real two.
{
  const rolling = (): JkaMovement => {
    const jka = new JkaMovement();
    jka.forceLevel = 0;
    jka.reset();
    const cmd = { ...cmdOf(false, statsAt(0)), roll: true };
    jka.step(1 / 60, new THREE.Vector3(), new THREE.Vector3(), true, cmd, { value: 100, spend: () => {} });
    return jka;
  };
  const harms: [number, HarmKind][] = [];
  const dodges: unknown[] = [];
  const bodyOf = (jka: JkaMovement, stats: PlayerStats, o: Partial<HarmBody> = {}): HarmBody => ({ hp: 80, lastStand: false, god: false, damageTaken: 1, jka, stats, onHarm: (lost, kind) => void harms.push([lost, kind]), onDodge: (s) => void dodges.push(s), ...o });
  const ask = newHarmAsk();
  const answer = newHarm();
  const at100 = statsAt(xpFor(100, PROGRESS_RULES));
  const shooter = { name: 'test_shooter' };
  const b = bodyOf(rolling(), at100);
  ok(!takeHarm(b, 20, false, 'blow', shooter, ask, answer) && b.hp === 80 && dodges[0] === shooter && harms.length === 0, "a blow just as a roll begins, at Acrobatics 100, is dodged off the body's own roll: nothing taken, the dodge said with whatever struck");
  ok(takeHarm(b, 20, false, 'env', null, ask, answer) && b.hp === 60 && harms.at(-1)?.[0] === 20 && harms.at(-1)?.[1] === 'env' && dodges.length === 1, "the surroundings in that same moment are not dodged: they land, and are told as the surroundings'");
  ok(takeHarm(b, 10, false, 'fall', null, ask, answer) && b.hp === 50 && harms.at(-1)?.[1] === 'fall', 'nor is a fall');
  const plain = bodyOf(rolling(), statsAt(0));
  ok(takeHarm(plain, 20, false, 'blow', shooter, ask, answer) && plain.hp === 60 && harms.at(-1)?.[1] === 'blow', 'with nothing earned the same blow mid-roll lands, as it always did');
  const still = bodyOf(new JkaMovement(), at100);
  ok(takeHarm(still, 20, false, 'blow', shooter, ask, answer) && still.hp === 60, 'and not rolling, it lands whatever is earned');
  const last = bodyOf(new JkaMovement(), at100, { hp: 30, lastStand: true });
  harms.length = 0;
  ok(takeHarm(last, 50, false, 'blow', shooter, ask, answer) && last.hp === 1 && !last.lastStand && harms[0]?.[0] === 29, 'last stand off the body: a lethal blow leaves one point, and the body is disarmed');
  ok(takeHarm(last, 50, false, 'blow', shooter, ask, answer) && last.hp === 0, 'so the next one kills: once');
  const lava = bodyOf(new JkaMovement(), at100, { hp: 3, lastStand: true });
  ok(takeHarm(lava, 10, false, 'env', null, ask, answer) && lava.hp === 1 && !lava.lastStand, "a lethal tick of the surroundings is stood through as a blow is");
  const own = bodyOf(new JkaMovement(), at100, { hp: 3, lastStand: true });
  ok(takeHarm(own, 10, false, 'self', null, ask, answer) && own.hp === 0 && own.lastStand, "never the player's own blast, which leaves last stand armed");
  const god = bodyOf(rolling(), at100, { god: true });
  ok(!takeHarm(god, 20, false, 'blow', shooter, ask, answer) && god.hp === 80, 'god mode refuses before any of it');
  ok(recordHarmKind(null, undefined) === 'env' && recordHarmKind(shooter, undefined) === 'blow' && recordHarmKind(null, { x: 1 }) === 'blow', "a loss through the player's record with nothing that struck and nowhere it came from is the surroundings'");
}

// ---- and where the game hands it its kinds, read out of the sources that load three ---------------------------------------
{
  const src = (rel: string): string => readFileSync(new URL(`../../../src/${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const player = src('player/player.ts');
  const take = player.slice(player.indexOf("takeDamage(amount: number, force = false, kind: HarmKind = 'blow', source: unknown = null): boolean {"));
  const takeBody = take.slice(0, take.indexOf('\n  }\n') + 4);
  ok(/\{\n\s+if \(this\.god && !force\) return false;\n\s+if \(!takeHarm\(this, amount, force, kind, source, this\.harmAsk, this\.harmAnswer\)\) return false;\n\s+this\.regenDelay = 5;\n\s+return true;\n\s+\}/.test(takeBody), 'Player.takeDamage asks god mode, then runs the glue above over itself, and holds regeneration off only for a blow that landed');
  ok(player.includes("if (ev.damage > 0) this.takeDamage(ev.damage, false, 'fall');") && player.includes('if (ev.rollSaved > 0) this.onRolled?.(ev.fell, ev.rollSaved);'), "a landing's harm is a fall, never a blow a roll could dodge, and a roll that saved some of it is told");
  ok(/if \(r\.damage > 0\) t\.damage\(r\.damage\);/.test(player) && /if \(r\.damage > 0\) world\.playerTarget\.damage\(r\.damage\);/.test(player) && /this\.playerTarget\.damage\(lavaTickDamage\(LAVA_HARM\.share, this\.playerMaxHp\)\);/.test(src('world/world.ts')), "a fire's tick, drowning and the lava reach the record with nothing that struck and nowhere it came from");
  const main = src('main.ts');
  ok((main.match(/recordHarmKind\(this\.hurtBy, from\)/g) ?? []).length === 2 && !main.includes("'blow', this.hurtBy"), "so both of the record's hurt paths, the frame's and __debug.advance's, call them the surroundings'");
  const hunter = src('combat/bountyHunter.ts');
  const self = hunter.split('\n').filter((l) => /\.takeDamage\(/.test(l));
  ok(self.length === 2 && self.every((l) => /, false, 'self'\);$/.test(l.trim())) && hunter.includes("p.takeDamage(cl.spec.dot ? cl.spec.dot.dps * 0.5 : 2, false, 'self')") && hunter.includes("player.takeDamage(damage * player.stats.blastSelf * (1 - dp / (radius * 0.7)), false, 'self')"), "the player's own cloud and own blast are the player's own doing, at both of the kit's sites");
}

console.log(`\n${checks} checks passed`);
