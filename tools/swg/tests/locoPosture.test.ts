// Wave 2b of the animations (the owner's brief's "Crouching", "Prone" and "Walking forward", and his answers), through
// the game's own code: crouched and prone at three classes each by the keys standing uses (`BodyLoco`'s `posturePlan`,
// `posturePick`), each way's clip and the turn it asks of the body, each clip's rate (a game clip's against the tune's
// measured `made` speed at the figure's scale), the stamina by class, the prone crawl backing up under `proneBack`; the
// gait's clips (`locoPick`'s gait, the twins the peers are shown, a rig without a gait's clip walking the standard), its
// record field, the hello's word and the relay's; the Walk row and the doll's walk; the pack loading the rows' clips
// whatever its index marks; walking hurt (`injured`); other players crouched, prone, in a gait and hurt (`PeerLoco`). Each
// at 30, 60 and 144 frames a second where a clock is involved, each rule with a mutation of the new code shown to fail
// its check; the game's own crouched walk's stride measured off the converted rig the way the importer measures, where
// the rig is on this machine; and day one: every switch at its 'before' gives 7424bad's frame trace to the bit, that
// commit's modules loaded out of git, with a recorded digest for when git cannot answer.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { BodyLoco, newLocoIn, type LocoIn, type LocoRig } from '../../../src/anim/bodyLoco.ts';
import { PeerIn, PeerLoco } from '../../../src/anim/peerLoco.ts';
import { CROUCH, CROUCH_BACK, GAITS, GAME_CROUCHED, GAME_PRONE, GAME_WALK, PRONE, clipOfId, gaitIndex, gaitOf, gaitTwin, injuredPick, locoPick, moreClips, peerPick, posturePick, posturePicks, tableClips, type LocoGait } from '../../../src/anim/locoTable.ts';
import { LOCO_TUNE_SHIPPED, tuneLoco, type LocoTune } from '../../../src/anim/locoTune.ts';
import { MixamoPack, type PackIo } from '../../../src/anim/mixamoPack.ts';
import { readPackIndex } from '../../../src/anim/mxaFile.ts';
import { GAIT_LABELS, GAIT_WALK_SECONDS, GaitWalk, gaitRowHtml } from '../../../src/ui/gaitRow.ts';
import { loadOldMany } from './oldModules.ts';
import { loadMutant } from './polishFixtures.ts';
import { repoRoot, targetSkeleton } from './animFixtures.ts';
// @ts-expect-error the relay's own cleaner, plain JavaScript
import { cleanHello, GAITS as WIRE_GAITS } from '../../../server/wire.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const root = repoRoot(import.meta.url);
const text = (rel: string) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const T = (): LocoTune => JSON.parse(JSON.stringify(LOCO_TUNE_SHIPPED)) as LocoTune;
const DEG = 180 / Math.PI;
/** The commit wave 2b was built on (the polish round), whose modules the day-one trace is held to. */
const BEFORE_2B = '7424bad';
/** The digest of the 'before' frame trace, recorded from 7424bad's own modules: what a checkout with no history is held to. */
const BEFORE_TRACE = '0e79e9b68ea3308d';

/** A rig with every clip of the table and of wave 2b's rows, each clip's feet made for its own speed (`speeds`, else 3 m/s). */
function rigWith(speeds: Record<string, number> = {}, without: readonly string[] = []): LocoRig {
  return {
    has: (c: string) => !without.includes(c),
    speedOut: 0,
    readSpeed(c: string) {
      if (without.includes(c)) return false;
      this.speedOut = speeds[c] ?? 3;
      return true;
    },
  };
}
const full = rigWith();

interface Keys { w?: boolean; s?: boolean; a?: boolean; d?: boolean; shift?: boolean; walk?: boolean }
type Loco = InstanceType<typeof BodyLoco>;
/** A body stepped a frame at a time, as the player's update steps its record. */
class Body {
  readonly tune: LocoTune;
  readonly loco: Loco;
  readonly f: LocoIn;
  readonly rig: LocoRig;
  private was: Keys = {};
  legs: ReturnType<Loco['legs']> = null;
  constructor(tune: LocoTune, rig: LocoRig = full, Cls: new (t: never) => Loco = BodyLoco as never) {
    this.tune = tune;
    this.rig = rig;
    this.loco = new Cls(tune as never);
    this.f = newLocoIn();
    this.f.sprint = tune.speed.forward.sprint;
    this.f.pool = tune.stamina.pool;
  }
  step(dt: number, k: Keys, over: Partial<LocoIn> = {}): void {
    this.loco.keys(dt, !!k.shift, !!k.shift && !this.was.shift, !!k.walk, this.rig);
    this.was = k;
    const crouched = !!over.crouched;
    const prone = !!over.prone;
    Object.assign(this.f, { dt, mz: (k.w ? 1 : 0) - (k.s ? 1 : 0), mx: (k.d ? 1 : 0) - (k.a ? 1 : 0), standing: !crouched && !prone, crouched, prone, grounded: true, swimming: false, fighting: false, aiming: false, gunUp: false, fightKeys: false, boost: 1, gunClass: -1, hpShare: 1, scale: 1 }, over);
    this.loco.plan(this.f);
    this.f.ground = this.loco.speed;
    this.legs = this.loco.legs(this.rig, this.f, false);
    this.loco.face(this.loco.faces(false));
  }
  run(seconds: number, k: Keys, fps: number, over: Partial<LocoIn> = {}): void {
    for (let i = 0; i < Math.round(seconds * fps); i++) this.step(1 / fps, k, over);
  }
  /** Shift let go and pressed again quickly: the double tap that sprints standing. */
  tap(fps: number, k: Keys, over: Partial<LocoIn> = {}): void {
    this.run(0.3, { ...k, shift: true }, fps, over);
    this.run(0.05, { ...k, shift: false }, fps, over);
    this.run(0.3, { ...k, shift: true }, fps, over);
  }
}
const WAYS: [string, Keys, number][] = [['forward', { w: true }, 0], ['forward-left', { w: true, a: true }, 1], ['left', { a: true }, 2], ['back-left', { s: true, a: true }, 3], ['back', { s: true }, 4], ['back-right', { s: true, d: true }, 5], ['right', { d: true }, 6], ['forward-right', { w: true, d: true }, 7]];

// ---- A. crouched ---------------------------------------------------------------------------------------------------------
{
  const t = T();
  ok(t.crouchRule === 'classes' && t.crouch.forward.slow < t.crouch.forward.normal && t.crouch.forward.normal < t.crouch.forward.fast && t.crouch.back.slow < t.crouch.back.normal && t.crouch.back.normal < t.crouch.back.fast, `crouched ships under the classes, ground speed rising with class (forward ${t.crouch.forward.slow}, ${t.crouch.forward.normal}, ${t.crouch.forward.fast}; back ${t.crouch.back.slow}, ${t.crouch.back.normal}, ${t.crouch.back.fast} m/s)`);
  for (const fps of [30, 60, 144]) {
    const seen: string[] = [];
    for (const [keys, cls, id] of [[{ walk: true }, 1, 'sneak_walk_1'], [{}, 2, 'crouched_walking'], [{ shift: true }, 3, GAME_CROUCHED]] as const) {
      for (const [name, way, dir] of WAYS) {
        const b = new Body(T());
        b.run(1, { ...way, ...keys }, fps, { crouched: true });
        const back = dir >= 3 && dir <= 5;
        const p = b.loco.pick!;
        const g = back ? b.tune.crouch.back : b.tune.crouch.forward;
        const want = cls === 1 ? g.slow : cls === 2 ? g.normal : g.fast;
        const travel = ((dir * 45 + 180) % 360) - 180;
        const turn = back ? ((travel - 180 + 540) % 360) - 180 : travel;
        assert.ok(p.id === (back ? CROUCH_BACK : id) && p.cls === cls && b.loco.posture === CROUCH && b.loco.speed === want, `${fps} fps, ${name}, class ${cls}: ${p.id} at ${b.loco.speed} (wanted ${back ? CROUCH_BACK : id} at ${want})`);
        assert.ok(Math.abs(b.loco.turn * DEG - turn) < 1e-9 && Math.abs(b.loco.turnNow * DEG - turn) < 0.5 && b.loco.faces(false) && p.state === (back ? 'crouchWalkBack' : 'crouchWalk') && b.legs === p, `${fps} fps, ${name}: the body turned ${(b.loco.turn * DEG).toFixed(1)} (wanted ${turn}), come round, facing by the table, in the state every build sends crouched`);
        if (dir === 0) seen.push(`${cls}: ${p.id} ${b.loco.speed} m/s`);
      }
    }
    ok(true, `at ${fps} fps crouched every class plays its clip forward and to every side with the body turned toward the travel (45 degrees on a diagonal, 90 sideways) and backing up Jedi Academy's walk back with the body to the view (45 on its diagonals), at the class's own speed: ${seen.join('; ')}`);
    // A double tap of Shift gives no sprint crouched: the quickest class, said.
    const tap = new Body(T());
    tap.tap(fps, { w: true }, { crouched: true });
    ok(tap.loco.cls === 3 && tap.loco.speed === tap.tune.crouch.forward.fast && !tap.loco.sprinting && /no sprint crouched/.test(tap.loco.refused), `at ${fps} fps a double tap of Shift crouched is the quickest class and no sprint, and says so (${tap.loco.refused})`);
    // The pool: the two slower classes give back at the walk's rate, the quickest at the jog's.
    for (const [keys, cls, rate] of [[{ walk: true }, 1, t.crouch.stamina.slow], [{}, 2, t.crouch.stamina.normal], [{ shift: true }, 3, t.crouch.stamina.fast]] as const) {
      const b = new Body(T());
      b.loco.stamina.value = 50;
      b.run(1, { w: true, ...keys }, fps, { crouched: true });
      assert.ok(Math.abs(b.loco.stamina.value - (50 + rate)) < 1e-6, `${fps} fps crouched class ${cls}: the pool from 50 to ${b.loco.stamina.value.toFixed(3)} in a second (wanted ${50 + rate})`);
    }
    ok(true, `at ${fps} fps the pool crouched regains ${t.crouch.stamina.slow}, ${t.crouch.stamina.normal} and ${t.crouch.stamina.fast} a second by class (the walk's, the walk's, the jog's)`);
  }
  // The rate: an imported clip against its stride on the figure, the game's own against the tune's measured speed at the figure's scale.
  const rig = rigWith({ mx_sneak_walk_1: 2.585, mx_crouched_walking: 1.347, [clipOfId(GAME_CROUCHED)]: 9, [clipOfId(CROUCH_BACK)]: 9 });
  const rateOf = (keys: Keys, scale: number) => {
    const b = new Body(T(), rig);
    b.run(0.5, keys, 60, { crouched: true, scale });
    return b.loco.rate;
  };
  const r = LOCO_TUNE_SHIPPED.rate;
  const clampR = (v: number) => Math.min(r.max, Math.max(r.min, v));
  const c = LOCO_TUNE_SHIPPED.crouch, m = LOCO_TUNE_SHIPPED.made;
  const rates = [rateOf({ w: true, walk: true }, 1), rateOf({ w: true }, 1), rateOf({ w: true, shift: true }, 1), rateOf({ w: true, shift: true }, 0.8), rateOf({ s: true }, 1)];
  ok(Math.abs(rates[0] - clampR(c.forward.slow / 2.585)) < 1e-12 && Math.abs(rates[1] - clampR(c.forward.normal / 1.347)) < 1e-12 && Math.abs(rates[2] - clampR(c.forward.fast / m.crouched)) < 1e-12 && Math.abs(rates[3] - clampR(c.forward.fast / (m.crouched * 0.8))) < 1e-12 && Math.abs(rates[4] - clampR(c.back.normal / m.crouchBack)) < 1e-12, `each crouched clip plays at the ground speed over the speed its feet were made for, held in the band: the sneak walk ${rates[0].toFixed(3)} (it needs ${(c.forward.slow / 2.585).toFixed(3)} on the human male and is held at the band's bottom, its feet sliding), the crouched walk ${rates[1].toFixed(3)}, the game's own crouched walk ${rates[2].toFixed(3)} against the tune's measured ${m.crouched} (the rig's own number never read: 9 here), ${rates[3].toFixed(3)} on a figure of scale 0.8, and the walk back ${rates[4].toFixed(3)}`);
  // 'before', and a rig without one of the set's clips: the crouch of 7424bad.
  for (const [why, tune, rg] of [["crouchRule 'before'", (() => { const x = T(); x.crouchRule = 'before'; return x; })(), full], ['a rig without the sneak walk', T(), rigWith({}, ['mx_sneak_walk_1'])]] as const) {
    const b = new Body(tune, rg);
    b.run(0.5, { w: true }, 60, { crouched: true });
    ok(!b.loco.rules && b.loco.posture === 0 && b.legs === null && !b.loco.faces(false) && b.loco.cls === 1, `${why}: crouched is the crouch before the classes (no rule, no legs, the body turned the way it goes)`);
  }
  // Mutations: the slower two classes swapped in the table; Shift held no longer the quickest.
  const [mt] = await loadMutant(['src/anim/locoTable.ts', 'src/anim/bodyLoco.ts'], ['src/anim/bodyLoco.ts'], [{ file: 'src/anim/locoTable.ts', from: "['', 'sneak_walk_1', 'crouched_walking', GAME_CROUCHED]", to: "['', 'crouched_walking', 'sneak_walk_1', GAME_CROUCHED]" }]);
  const mb = new Body(T(), full, (mt as { BodyLoco: new (t: never) => Loco }).BodyLoco);
  mb.run(0.5, { w: true, walk: true }, 60, { crouched: true });
  ok(mb.loco.pick!.id !== 'sneak_walk_1', `a mutation swapping the two slower clips plays ${mb.loco.pick!.id} with Alt held: the check above fails on it`);
  const [ms] = await loadMutant(['src/anim/bodyLoco.ts'], ['src/anim/bodyLoco.ts'], [{ file: 'src/anim/bodyLoco.ts', from: 'let cls = this.walkOn ? 1 : this.asked >= RUN ? 3 : 2;', to: 'let cls = this.walkOn ? 1 : this.asked > RUN ? 3 : 2;' }]);
  const msb = new Body(T(), full, (ms as { BodyLoco: new (t: never) => Loco }).BodyLoco);
  msb.run(0.5, { w: true, shift: true }, 60, { crouched: true });
  ok(msb.loco.cls === 2, 'a mutation that needs the sprint for the quickest class crouches at the middle one with Shift held: the check above fails on it');
}

// ---- the game's own crouched walk's stride, off the converted rig --------------------------------------------------------------
{
  const rigFile = join(root, 'assets-private', 'characters', 'human_male', 'rig.glb');
  if (!existsSync(rigFile)) note('no converted human male on this machine (assets-private/characters/human_male/rig.glb): the game crouched walk\'s stride is the tune\'s recorded 1.49');
  else {
    const measured = await measureGameClips(rigFile, ['loop_crouched:speed1', 'BOTH_CROUCH1WALKBACK', 'walk']);
    const [crouched, back, walk] = measured;
    ok(Math.abs(crouched.speed - LOCO_TUNE_SHIPPED.made.crouched) < 0.01 * crouched.speed && Math.abs(walk.speed - LOCO_TUNE_SHIPPED.made.gameWalk) < 0.01 * walk.speed, `measured off the human male's converted rig by the importer's own rule (its stances' settled middles): the game's crouched walk ${crouched.speed.toFixed(3)} m/s and its walk ${walk.speed.toFixed(3)} m/s, the tune's starts within 1% (${LOCO_TUNE_SHIPPED.made.crouched}, ${LOCO_TUNE_SHIPPED.made.gameWalk})`);
    ok(back.settled <= 2 && Math.abs(back.planted - LOCO_TUNE_SHIPPED.made.crouchBack) < 0.01 * back.planted, `Jedi Academy's crouched walk back settles for ${back.settled} spans (the settled measure reads ${back.speed.toFixed(3)} m/s, which is no crouched walk's), so the tune's start is its planted frames' median, ${back.planted.toFixed(3)} (within 1% of ${LOCO_TUNE_SHIPPED.made.crouchBack})`);
  }
}

// ---- B. prone ------------------------------------------------------------------------------------------------------------
{
  const t = T();
  ok(t.proneRule === 'classes' && t.proneBack === 'today' && t.prone.forward.slow < t.prone.forward.normal && t.prone.forward.normal < t.prone.forward.fast, `prone ships under the classes and backing up as today, ground speed rising with class (${t.prone.forward.slow}, ${t.prone.forward.normal}, ${t.prone.forward.fast} m/s)`);
  for (const fps of [30, 60, 144]) {
    for (const [keys, cls, id] of [[{ walk: true }, 1, GAME_PRONE], [{}, 2, 'low_crawl'], [{ shift: true }, 3, 'running_crawl']] as const) {
      for (const [name, way] of WAYS) {
        const b = new Body(T());
        b.run(0.6, { ...way, ...keys }, fps, { prone: true });
        const p = b.loco.pick!;
        const want = cls === 1 ? t.prone.forward.slow : cls === 2 ? t.prone.forward.normal : t.prone.forward.fast;
        assert.ok(p.id === id && b.loco.speed === want && !b.loco.faces(false) && b.loco.rate > 0 && p.state === 'proneMove' && b.loco.posture === PRONE, `${fps} fps prone ${name} class ${cls}: ${p.id} at ${b.loco.speed}, never facing by the table (the body turns the way it crawls), played forward`);
      }
    }
    ok(true, `at ${fps} fps prone plays the game's crawl, the low crawl and the running crawl by class at every way, the body left to turn the way it crawls (no strafing crawl), in the state every build sends prone`);
    // 'reverse': backing up, the class's forward crawl backwards with the body to the view.
    const tr = T();
    tr.proneBack = 'reverse';
    for (const [name, way, dir] of WAYS.filter(([, , d]) => d >= 3 && d <= 5)) {
      const b = new Body(tr);
      b.run(0.6, way, fps, { prone: true });
      const travel = ((dir * 45 + 180) % 360) - 180;
      assert.ok(b.loco.pick!.reverse && b.loco.pick!.id === 'low_crawl' && b.loco.rate < 0 && b.loco.faces(false) && Math.abs(b.loco.turn * DEG - (((travel - 180 + 540) % 360) - 180)) < 1e-9, `${fps} fps 'reverse' ${name}: the low crawl backwards (rate ${b.loco.rate.toFixed(3)}), the body facing the view turned ${(b.loco.turn * DEG).toFixed(1)}`);
      const armed = new Body(tr);
      armed.run(0.6, way, fps, { prone: true, gunClass: 2 });
      assert.ok(!armed.loco.pick!.reverse && armed.legs === null && !armed.loco.faces(false), `${fps} fps 'reverse' ${name} with a gun in hand: its own prone crawl has the legs, as today`);
    }
    ok(true, `at ${fps} fps under 'reverse' backing up prone plays the class's forward crawl backwards with the body to the view (45 degrees on the back diagonals), and a gun in hand keeps its own crawl and today's turn`);
  }
  // A gun in hand prone: the gun's own crawl has the legs at every class, at the class's speed.
  const armed = new Body(T());
  armed.run(0.5, { w: true, shift: true }, 60, { prone: true, gunClass: 0 });
  ok(armed.loco.speed === T().prone.forward.fast && armed.legs === null, 'prone with a gun in hand: the class\'s speed, and the gun\'s own prone crawl keeps the legs (the imported crawls hold no gun)');
  const before = T();
  before.proneRule = 'before';
  const bb = new Body(before);
  bb.run(0.5, { w: true }, 60, { prone: true });
  ok(!bb.loco.rules && bb.legs === null, "proneRule 'before': prone is the crawl before the classes");
  const [mp] = await loadMutant(['src/anim/bodyLoco.ts'], ['src/anim/bodyLoco.ts'], [{ file: 'src/anim/bodyLoco.ts', from: 'if (this.posture === PRONE) return this.rules && this.pick !== null && this.pick.reverse && !jka;', to: '' }]);
  const mpb = new Body(T(), full, (mp as { BodyLoco: new (t: never) => Loco }).BodyLoco);
  mpb.run(0.5, { a: true }, 60, { prone: true });
  ok(mpb.loco.faces(false), 'a mutation that lets prone face by the table faces a crawl to the left by it: the check above fails on it');
}

// ---- C. the gait ----------------------------------------------------------------------------------------------------------
{
  const F: Record<LocoGait, string> = { standard: 'standard_walk', masculine: 'walking', feminine: 'walking_2', heavy: 'dwarf_walk', game: GAME_WALK };
  for (const g of GAITS) {
    const fl = locoPick(1, 1, false, 0, g)!;
    const l = locoPick(2, 1, false, 0, g, 1)!;
    const lf = locoPick(2, 1, false, 0, g, 2)!;
    const pair = g === 'feminine' ? ['left_strafe_walk', 'right_strafe_walk'] : ['left_strafe_walking', 'right_strafe_walking'];
    assert.ok(locoPick(0, 1, false, 0, g)!.id === F[g] && fl.id === pair[0] && locoPick(7, 1, false, 0, g)!.id === pair[1] && l.id === pair[0] && lf.id === F[g] && Math.round(lf.turn) === 90, `${g}: the forward walk ${F[g]}, the walked diagonals and the sideways walk ${pair.join(' and ')}, the forward choice sideways the forward walk turned 90`);
    for (let dir = 0; dir < 8; dir++) for (let cls = 2; cls <= 4; cls++) assert.ok(locoPick(dir, cls, false, 0, g) === locoPick(dir, cls), `${g}: the jog and up are the standard's (way ${dir}, class ${cls})`);
  }
  ok(true, `the gaits walk in their own clips (${GAITS.map((g) => `${g} ${F[g]}`).join(', ')}), the feminine with the strafe walk pair of its own, every other with the standard's; the jog, the run and the sprint the same for every gait`);
  ok(tableClips().length === 20 && GAITS.length === 5 && GAITS[0] === 'standard' && gaitOf('heavy') === 'heavy' && gaitOf(undefined) === 'standard' && gaitOf('dancing') === 'standard' && gaitIndex('game') === 4 && gaitIndex(null) === 0, 'the standing table still names its own twenty clips, and a word not known (a record from before) is the standard');
  ok(moreClips().sort().join() === ['walking', 'walking_2', 'dwarf_walk', 'left_strafe_walk', 'right_strafe_walk', 'walking_1', 'sneak_walk_1', 'crouched_walking', 'low_crawl', 'running_crawl'].sort().join() && moreClips().every((id) => !tableClips().includes(id)), `wave 2b's rows name ten imported clips beyond the table (${moreClips().join(', ')}), which the game loads by name`);
  // Each pick's turn is the one rule: the travel less the clip's own heading.
  for (const p of [...posturePicks(), locoPick(1, 1, false, 0, 'feminine')!, locoPick(6, 1, false, 0, 'heavy', 2)!, injuredPick(2)!]) assert.ok(p.reverse || Math.abs(((((p.dir * 45 + 180) % 360) - 180 - p.heading - p.turn) % 360 + 540) % 360 - 180) < 1e-9, `${p.id} way ${p.dir}: turned ${p.turn} by the travel less its heading`);
  ok(true, 'every wave 2b pick is turned by the one rule every pick is (the travel less the clip\'s own heading), but the crawl played backwards');
  // The body's record: a gait set walks in it; a rig without the gait's clip walks the standard.
  for (const fps of [30, 60, 144]) {
    for (const g of GAITS) {
      const b = new Body(T(), rigWith({ walk: 1.549, mx_walking: 1.645 }));
      b.loco.setGait(g);
      b.run(0.5, { w: true, walk: true }, fps);
      const want = g === 'game' ? T().speed.forward.walk / T().made.gameWalk : g === 'masculine' ? T().speed.forward.walk / 1.645 : T().speed.forward.walk / 3;
      assert.ok(b.loco.pick!.id === F[g] && b.loco.gaitOn && Math.abs(b.loco.rate - Math.min(1.6, Math.max(0.6, want))) < 1e-12, `${fps} fps ${g}: ${b.loco.pick!.id} at rate ${b.loco.rate.toFixed(3)}`);
      b.run(0.5, { w: true }, fps);
      assert.ok(b.loco.pick!.id === 'slow_run', `${fps} fps ${g}: the jog is the standard's`);
    }
    const lacking = new Body(T(), rigWith({}, ['mx_dwarf_walk']));
    lacking.loco.setGait('heavy');
    lacking.run(0.5, { w: true, walk: true }, fps);
    ok(!lacking.loco.gaitOn && lacking.loco.pick!.id === 'standard_walk', `at ${fps} fps each gait's walk plays at the rate that locks its feet (the game's own walk against the tune's measured ${T().made.gameWalk}, never the rig's 1.549), and a rig without a gait's clip walks the standard`);
  }
  // A mutation: the plan hands the pick no gait.
  const [mg] = await loadMutant(['src/anim/bodyLoco.ts'], ['src/anim/bodyLoco.ts'], [{ file: 'src/anim/bodyLoco.ts', from: "this.gaitOn ? GAITS[this.gait] : 'standard', sideMode(tune));", to: "'standard', sideMode(tune));" }]);
  const mgb = new Body(T(), full, (mg as { BodyLoco: new (t: never) => Loco }).BodyLoco);
  mgb.loco.setGait('heavy');
  mgb.run(0.5, { w: true, walk: true }, 60);
  ok(mgb.loco.pick!.id === 'standard_walk', 'a mutation that hands the plan no gait walks the standard in the heavy gait: the check above fails on it');
  const [mpg] = await loadMutant(['src/anim/locoTable.ts', 'src/anim/peerLoco.ts'], ['src/anim/peerLoco.ts'], [{ file: 'src/anim/locoTable.ts', from: 'if (ask.gait > 0) return gaitTwin(got, ask.gait);', to: '' }]);
  const mpp = new (mpg as { PeerLoco: new () => InstanceType<typeof PeerLoco> }).PeerLoco();
  ok(mpp.resolve(T(), full, 'walk', Object.assign(new (mpg as { PeerIn: new () => PeerIn }).PeerIn(), { vx: 0, vz: 1.66, heading: 0, speed: 1.66, dt: 1 / 60, gait: gaitIndex('heavy'), hpShare: 1, scale: 1 }))?.id === 'standard_walk', 'and a mutation that takes no twin shows another player in the heavy gait the standard walk: the check below fails on it');
  // Other players: the gait their hello names, its twin of the walk the table finds, the standard where their rig has not got it.
  for (const g of GAITS) {
    const p = new PeerLoco();
    const f = new PeerIn();
    Object.assign(f, { vx: 0, vz: 1.66, heading: 0, speed: 1.66, dt: 1 / 60, gait: gaitIndex(g), hpShare: 1, scale: 1 });
    const got = p.resolve(T(), full, 'walk', f);
    assert.ok(got?.id === F[g], `another player walking in ${g}: ${got?.id}`);
    const side = new PeerLoco();
    Object.assign(f, { vx: 1.44, vz: 0 });
    const s = side.resolve(T(), full, 'walk', f);
    assert.ok(s?.id === (g === 'feminine' ? 'left_strafe_walk' : 'left_strafe_walking'), `another player walking sideways (to the left: +x against a heading of nought) in ${g}: ${s?.id}`);
  }
  const lackP = new PeerLoco();
  const lf = Object.assign(new PeerIn(), { vx: 0, vz: 1.66, heading: 0, speed: 1.66, dt: 1 / 60, gait: gaitIndex('feminine'), hpShare: 1, scale: 1 });
  ok(lackP.resolve(T(), rigWith({}, ['mx_walking_2']), 'walk', lf)?.id === 'standard_walk' && gaitTwin(locoPick(0, 1)!, 2).id === 'walking_2' && gaitTwin(locoPick(0, 2)!, 2) === locoPick(0, 2), 'another player is shown the walk of the gait their hello names (sideways too), the standard where this side\'s rig has not got its clip; a jog has no twin');
  // The record and the wire: the field read and written, the hello's word, the relay passing a known word and nothing else.
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  const { loadCharacters, saveCharacters } = await import('../../../src/core/characters.ts');
  const rec = { id: 'a', name: 'A', species: 'human_male', class: 'jedi', appearance: { morphs: {}, values: {}, height: 0.5 }, outfit: [], planet: 'tatooine', created: 1, played: 1 } as never;
  saveCharacters([rec, { ...(rec as object), id: 'b', gait: 'feminine' } as never]);
  const back = loadCharacters();
  ok(back.length === 2 && back[0].gait === undefined && gaitOf(back[0].gait) === 'standard' && back[1].gait === 'feminine' && gaitOf(back[1].gait) === 'feminine', 'a character\'s gait is a field of its record, written and read back; a record from before has none and walks the standard');
  const h = (gait: unknown) => cleanHello({ name: 'x', species: 'human_male', class: 'jedi', planet: 'tatooine', gait }) as { gait?: string };
  ok(JSON.stringify(WIRE_GAITS) === JSON.stringify(GAITS) && h('heavy').gait === 'heavy' && h('game').gait === 'game' && h('dancing').gait === undefined && h(7).gait === undefined && h(undefined).gait === undefined, 'the relay passes a hello\'s gait when it is one of the browser\'s own words, and drops anything else (a relay from before drops every one: the standard walk)');
  const main = text('src/main.ts');
  ok(main.includes("mood: c?.mood || undefined, gait: c?.gait && c.gait !== 'standard' ? c.gait : undefined };") && main.includes('this.player.loco.setGait(c.gait);') && main.includes("...(this.creatorGait !== 'standard' ? { gait: this.creatorGait } : {}),") && main.includes("    this.creatorGait = 'standard';\n    this.player.loco.setGait('standard');") && main.includes("    if (gait === 'standard') delete c.gait;\n    else c.gait = gait;\n    upsertCharacter(c);\n    this.queueHello();"), 'the game sends the gait in the hello (none for the standard), wears the record\'s at play, starts the creator on the standard and writes the creator\'s choice into the new record, and in play writes a pick on the record and says it in the next hello');
  ok(main.includes('this.appearanceUi.gait = {') && main.includes('set: (g) => this.setGait(gaitOf(g)),') && text('src/net/remotePlayers.ts').includes('PEER_IN.gait = gaitIndex(r.hello.gait);'), 'the appearance page (the creator\'s and the game\'s, never the dresser\'s) carries the Walk row through the game, and another player\'s gait is read off their hello');
  // The Walk row and the doll's walk.
  const row = gaitRowHtml('heavy');
  ok(GAITS.every((g) => row.includes(`<option value="${g}"`) && row.includes(GAIT_LABELS[g])) && row.includes('<option value="heavy" selected>') && (row.match(/selected/g) ?? []).length === 1 && row.includes('<span class="slot-label">Walk</span>'), 'the Walk row offers the five gaits under words of ours, the one in force selected');
  for (const fps of [30, 60, 144]) {
    const host: { onFrame: ((dt: number, model: THREE.Object3D) => void) | null } = { onFrame: null };
    const model = new THREE.Group();
    const bone = new THREE.Bone();
    bone.name = 'hips';
    model.add(bone);
    const clip = new THREE.AnimationClip('mx_walking', 1, [new THREE.QuaternionKeyframeTrack('hips.quaternion', [0, 0.5, 1], [0, 0, 0, 1, 0, 0.3826834, 0, 0.9238795, 0, 0, 0, 1])]);
    const walk = new GaitWalk(host);
    let done = 0;
    walk.start(clip, () => done++);
    let frames = 0;
    let turned = 0;
    let other: THREE.Object3D | null = null;
    while (host.onFrame && frames < 10 * fps) {
      const m = frames === Math.round(fps) ? (other = model.clone()) : (other ?? model);
      host.onFrame(1 / fps, m);
      frames++;
      if (Math.abs(m.getObjectByName('hips')!.quaternion.y) > 0.1) turned++;
    }
    assert.ok(done === 1 && host.onFrame === null && walk.playing === null && Math.abs(frames / fps - GAIT_WALK_SECONDS) < 1.5 / fps && turned > 0 && model.position.lengthSq() === 0, `${fps} fps: the doll walked ${frames} frames (${(frames / fps).toFixed(3)} s), bound afresh to a new copy of the figure, let go and done once`);
  }
  ok(true, `a gait picked on the Walk row plays its walk on the doll in place for ${GAIT_WALK_SECONDS} s at 30, 60 and 144 frames a second, follows a new copy of the figure the page takes meanwhile, and lets go`);
  // The pack: the rows' clips loaded whatever the index marks, and as before without them.
  const dir = join(root, 'public', 'anims', 'mixamo');
  const indexText = readFileSync(join(dir, 'index.json'), 'utf8');
  const index = readPackIndex(JSON.parse(indexText));
  if (typeof index === 'string') throw new Error(index);
  const io = (also?: readonly string[]): PackIo => ({
    enabled: () => true,
    index: async () => indexText,
    clip: async (file) => {
      const b = readFileSync(join(dir, file));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    },
    breath: async () => {},
    now: () => 0,
    ...(also ? { also } : {}),
  });
  const { info, warn } = console;
  console.info = console.warn = () => {};
  const human = targetSkeleton();
  const plain = (await new MixamoPack(io()).clipsFor(human, 'test')).map((c) => c.name);
  const more = (await new MixamoPack(io(moreClips())).clipsFor(human, 'test')).map((c) => c.name);
  console.info = info;
  console.warn = warn;
  const used = index.clips.filter((c) => c.use).length;
  ok(plain.length === used && more.length === used + moreClips().length && moreClips().every((id) => more.includes(`mx_${id}`) && !plain.includes(`mx_${id}`)), `the pack fits the clips its index marks (${used}), and with the game's own list beside them wave 2b's ten as well (${more.length}): nothing is reimported for them`);
  ok(text('src/anim/mixamoPack.ts').includes('also: [...moreClips(), ...STAIR_IDS],'), 'and the game hands its pack that list (and wave 3\'s stair clips beside it)');
}

// ---- D. walking hurt -------------------------------------------------------------------------------------------------------
{
  const t = T();
  ok(t.injured.rule === 'walk' && t.injured.below === 0.25 && t.injured.speed === 0.57, `walking hurt ships on, under a quarter of the pool, at the injured walk's own speed (${t.injured.speed} m/s)`);
  for (const fps of [30, 60, 144]) {
    for (const [name, way, dir] of WAYS) {
      const b = new Body(T());
      b.run(0.6, { ...way, walk: true }, fps, { hpShare: 0.2 });
      const hurt = !(dir >= 3 && dir <= 5);
      const travel = ((dir * 45 + 180) % 360) - 180;
      assert.ok(hurt ? b.loco.injured && b.loco.pick!.id === 'walking_1' && b.loco.speed === t.injured.speed && Math.abs(b.loco.turn * DEG - travel) < 1e-9 : !b.loco.injured && b.loco.pick!.id === 'walking_backwards', `${fps} fps hurt walking ${name}: ${b.loco.pick!.id} at ${b.loco.speed}`);
    }
    const jog = new Body(T());
    jog.run(0.6, { w: true }, fps, { hpShare: 0.2 });
    const whole = new Body(T());
    whole.run(0.6, { w: true, walk: true }, fps, { hpShare: 0.3 });
    const gun = new Body(T());
    gun.run(0.6, { w: true, walk: true }, fps, { hpShare: 0.2, gunUp: true });
    const off = T();
    off.injured.rule = 'off';
    const offb = new Body(off);
    offb.run(0.6, { w: true, walk: true }, fps, { hpShare: 0.2 });
    ok(!jog.loco.injured && jog.loco.pick!.id === 'slow_run' && jog.loco.speed === t.speed.forward.jog && !whole.loco.injured && !gun.loco.injured && !offb.loco.injured && offb.loco.pick!.id === 'standard_walk', `at ${fps} fps hurt under a quarter the walk forward and to the sides is the injured walk at its own speed, the body turned toward the travel, and backing up its own walk; the jog unchanged (no cap), a quarter and more whole, a blaster up square, and 'off' as before`);
  }
  // Its rate: the pack gives the injured walk no stride (the importer marked no foot landing in it), so it is played
  // against the tune's own speed for it at the figure's scale, never at the clip's own rate whatever the ground.
  const noStride = rigWith({}, []);
  noStride.readSpeed = function (c: string) {
    if (c === 'mx_walking_1') return false;
    this.speedOut = 3;
    return true;
  };
  const hr = new Body(T(), noStride);
  hr.run(0.6, { w: true, walk: true }, 60, { hpShare: 0.2, scale: 1.11 });
  ok(Math.abs(hr.loco.rate - t.injured.speed / (t.made.injuredWalk * 1.11)) < 1e-12, `the injured walk plays at ${hr.loco.rate.toFixed(3)} on a figure of scale 1.11 (its speed ${t.injured.speed} over its feet's ${t.made.injuredWalk} at that scale): its feet locked though the pack has no stride for it`);
  // Other players hurt (their health heard): the forward walk is the injured walk.
  const p = new PeerLoco();
  const f = Object.assign(new PeerIn(), { vx: 0, vz: 0.57, heading: 0, speed: 0.57, dt: 1 / 60, gait: 0, hpShare: 0.1, scale: 1 });
  const hurt = p.resolve(T(), full, 'walk', f);
  f.hpShare = 0.9;
  const well = new PeerLoco().resolve(T(), full, 'walk', f);
  ok(hurt?.id === 'walking_1' && well?.id === 'standard_walk', 'another player whose health this side hears under a quarter walks hurt; whole, the standard');
  const [mi] = await loadMutant(['src/anim/bodyLoco.ts'], ['src/anim/bodyLoco.ts'], [{ file: 'src/anim/bodyLoco.ts', from: 'f.hpShare < tune.injured.below', to: 'f.hpShare > tune.injured.below' }]);
  const mib = new Body(T(), full, (mi as { BodyLoco: new (t: never) => Loco }).BodyLoco);
  mib.run(0.5, { w: true, walk: true }, 60, { hpShare: 0.2 });
  ok(!mib.loco.injured, 'a mutation that turns the share round walks whole when hurt: the check above fails on it');
}

// ---- other players crouched and prone -------------------------------------------------------------------------------------
{
  const t = T();
  for (const fps of [30, 60, 144]) {
    const p = new PeerLoco();
    const f = new PeerIn();
    const at = (state: string, vx: number, vz: number, heading: number, speed: number, seconds: number) => {
      let got: ReturnType<PeerLoco['resolve']> = null;
      for (let i = 0; i < Math.round(seconds * fps); i++) {
        Object.assign(f, { vx, vz, heading, speed, dt: 1 / fps, gait: 0, hpShare: 1, scale: 1 });
        got = p.resolve(t, full, state, f);
      }
      return got;
    };
    const slow = at('crouchWalk', 0, t.crouch.forward.slow, 0, t.crouch.forward.slow, 0.5);
    const mid = at('crouchWalk', 0, t.crouch.forward.normal, 0, t.crouch.forward.normal, 0.5);
    const back = at('crouchWalkBack', 0, -t.crouch.back.fast, 0, t.crouch.back.fast, 0.5);
    const crawl = at('proneMove', 0, t.prone.forward.fast, 0, t.prone.forward.fast, 0.5);
    const rev = at('proneMove', 0, -t.prone.forward.normal, 0, t.prone.forward.normal, 0.5);
    ok(slow?.id === 'sneak_walk_1' && mid?.id === 'crouched_walking' && back?.id === CROUCH_BACK && back.cls === 3 && crawl?.id === 'running_crawl' && rev?.id === 'low_crawl' && rev.reverse && p.rate < 0, `at ${fps} fps another player crouched or prone is shown the class whose speed is nearest the one sent (each change standing ${t.peer.settle} s first), crouched backing up Jedi Academy's walk back, and a crawl heard going backward against its heading played backwards (rate ${p.rate.toFixed(3)})`);
  }
  const before = T();
  before.crouchRule = 'before';
  ok(new PeerLoco().resolve(before, full, 'crouchWalk', Object.assign(new PeerIn(), { vx: 0, vz: 1.6, heading: 0, speed: 1.6, dt: 1 / 60, gait: 0, hpShare: 1, scale: 1 })) === null && peerPick(t, 'crouchWalk', 0, 1) === null, "under 'before' another player crouched plays their state's own clip, as before; the standing table never answers for a crouch");
}

// ---- day one: every switch at 'before' is 7424bad's, frame for frame -----------------------------------------------------------
{
  const FILES = ['src/anim/bodyLoco.ts', 'src/anim/locoClass.ts', 'src/anim/locoTable.ts', 'src/anim/locoTune.ts', 'src/anim/peerLoco.ts'];
  const old = await loadOldMany(FILES, ['src/anim/bodyLoco.ts', 'src/anim/locoTune.ts', 'src/anim/peerLoco.ts'], BEFORE_2B);
  const beforeTune = (base: LocoTune): LocoTune => {
    const x = JSON.parse(JSON.stringify(base)) as LocoTune;
    x.crouchRule = 'before';
    x.proneRule = 'before';
    x.proneBack = 'today';
    x.injured.rule = 'off';
    return x;
  };
  const trace = (mods: { BodyLoco: new (t: never) => Loco; newLocoIn: () => LocoIn; PeerLoco: new () => InstanceType<typeof PeerLoco>; PeerIn: new () => PeerIn }, tune: unknown): string[] => {
    const rows: string[] = [];
    const n = (v: unknown) => (typeof v === 'number' ? (Object.is(v, -0) ? '-0' : String(v)) : String(v));
    for (const fps of [30, 60, 144]) {
      const b = new mods.BodyLoco(tune as never);
      const f = mods.newLocoIn();
      f.sprint = 7;
      f.pool = 100;
      let was = false;
      const step = (seconds: number, k: Keys, over: Record<string, unknown> = {}) => {
        for (let i = 0; i < Math.round(seconds * fps); i++) {
          const dt = 1 / fps;
          b.keys(dt, !!k.shift, !!k.shift && !was, !!k.walk, full);
          was = !!k.shift;
          const crouched = !!over.crouched, prone = !!over.prone;
          Object.assign(f, { dt, mz: (k.w ? 1 : 0) - (k.s ? 1 : 0), mx: (k.d ? 1 : 0) - (k.a ? 1 : 0), standing: !crouched && !prone && !over.kneel, crouched, prone, grounded: true, swimming: false, fighting: false, aiming: false, gunUp: false, fightKeys: false, boost: 1, ground: 0, gunClass: -1, hpShare: 1, scale: 1 }, over);
          b.plan(f);
          f.ground = b.speed * 0.97;
          const legs = b.legs(full, f, false);
          b.face(b.faces(false));
          b.fadeFor(legs !== null, false, f.mz !== 0 || f.mx !== 0);
          rows.push([b.asked, b.cls, b.speed, b.sprinting, b.refused, b.pick?.id ?? '-', b.dir, b.moves, b.legsOn, b.rate, b.turn, b.turnNow, b.turnStep, b.fadeNow, b.stamina.value, b.stamina.tired, legs?.id ?? '-'].map(n).join(' '));
        }
      };
      // Standing, crouched, prone and kneeling at every key, hurt and whole, and back on the feet.
      step(0.5, { w: true });
      step(0.4, { w: true, walk: true }, { hpShare: 0.1 });
      step(0.4, { w: true, a: true, walk: true }, { hpShare: 0.1 });
      step(0.4, { w: true }, { crouched: true });
      step(0.4, { w: true, walk: true }, { crouched: true });
      step(0.4, { s: true, shift: true }, { crouched: true });
      step(0.4, { a: true }, { crouched: true });
      step(0.4, { w: true }, { prone: true });
      step(0.4, { s: true, shift: true }, { prone: true });
      step(0.4, { d: true, walk: true }, { prone: true });
      step(0.3, { w: true }, { kneel: true });
      step(0.4, { w: true, shift: true });
      step(0.3, {});
    }
    for (const state of ['walk', 'run', 'crouchWalk', 'crouchWalkBack', 'proneMove']) {
      const p = new mods.PeerLoco();
      const f = new mods.PeerIn();
      for (let i = 0; i < 200; i++) {
        const turn = i * 0.05;
        const speed = 0.3 + (i % 40) * 0.12;
        f.vx = Math.sin(turn) * speed;
        f.vz = Math.cos(turn) * speed;
        f.heading = 0.3;
        f.speed = speed;
        f.dt = 1 / 60;
        // What a hello and the health say (a field 7424bad never read): a gait and hurt, which 'before' must not show.
        Object.assign(f, { gait: 0, hpShare: i % 3 === 0 ? 0.1 : 1, scale: 1 });
        const got = p.resolve(tune as never, full, state, f);
        rows.push([state, got?.id ?? '-', p.rate, p.rel].map(n).join(' '));
      }
    }
    return rows;
  };
  const now = trace({ BodyLoco: BodyLoco as never, newLocoIn, PeerLoco, PeerIn }, beforeTune(LOCO_TUNE_SHIPPED));
  const digest = createHash('sha1').update(now.join('\n')).digest('hex').slice(0, 16);
  if (old) {
    const [ob, ot, op] = old as [{ BodyLoco: new (t: never) => Loco; newLocoIn: () => LocoIn }, { LOCO_TUNE_SHIPPED: LocoTune }, { PeerLoco: new () => InstanceType<typeof PeerLoco>; PeerIn: new () => PeerIn }];
    const then = trace({ BodyLoco: ob.BodyLoco, newLocoIn: ob.newLocoIn, PeerLoco: op.PeerLoco, PeerIn: op.PeerIn }, JSON.parse(JSON.stringify(ot.LOCO_TUNE_SHIPPED)));
    const first = now.findIndex((r, i) => r !== then[i]);
    ok(now.length === then.length && first < 0, `under every switch at 'before' (crouched and prone 'before', backing up prone 'today', walking hurt 'off', the standard gait) the record and the peers' are ${BEFORE_2B}'s, frame for frame at 30, 60 and 144 frames a second, crouched, prone, kneeling and hurt frames among them (${now.length} rows, every number by Object.is)${first >= 0 ? `: row ${first} is ${now[first]} against ${then[first]}` : ''}`);
    note(`the 'before' trace's digest is ${digest} (BEFORE_TRACE, which a checkout with no history is held to)`);
  } else note(`git cannot hand over ${BEFORE_2B}'s modules here: the 'before' trace is held to the digest recorded from them`);
  if (BEFORE_TRACE) ok(digest === BEFORE_TRACE, `and its digest is the one recorded from ${BEFORE_2B}'s own modules (${digest})`);
  else assert.ok(old, 'a recorded digest, or git');
  // And a gait or hurt alone moves nothing under the off answers: the tune's switches tuned through `tuneLoco` as the console does.
  const tuned = T();
  const words = [...tuneLoco({ crouchRule: 'before' }), ...tuneLoco({ crouchRule: 'sideways' })];
  ok(words.length === 1 && /crouchRule takes 'classes' or 'before'/.test(words[0]), `the switches take only their words (${words[0]})`);
  void tuned;
}

console.log(`\n${checks} checks passed`);

/** The game's own clips measured off a converted rig the importer's way (tools/anim/analyze.mjs), with each planted frame's foot speed as a second look. */
async function measureGameClips(file: string, names: string[]): Promise<{ speed: number; planted: number; settled: number }[]> {
  // @ts-expect-error the importer's own measure, plain JavaScript
  const { analyzeClip } = await import(pathToFileURL(join(root, 'tools', 'anim', 'analyze.mjs')).href);
  const fd = openSync(file, 'r');
  const size = fstatSync(fd).size;
  const head = Buffer.alloc(20);
  readSync(fd, head, 0, 20, 0);
  const jsonLen = head.readUInt32LE(12);
  const jb = Buffer.alloc(jsonLen);
  readSync(fd, jb, 0, jsonLen, 20);
  const g = JSON.parse(jb.toString('utf8')) as { nodes: { name?: string; extras?: { name?: string }; children?: number[]; rotation?: number[]; translation?: number[] }[]; animations: { name?: string; extras?: { name?: string }; channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number }[] }[]; accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean }[]; bufferViews: { byteOffset?: number; byteStride?: number }[] };
  const binStart = 20 + jsonLen + 8;
  const bin = Buffer.alloc(size - binStart);
  readSync(fd, bin, 0, size - binStart, binStart);
  closeSync(fd);
  const COMP: Record<number, [number, (b: Buffer, o: number) => number, number]> = { 5126: [4, (b, o) => b.readFloatLE(o), 1], 5122: [2, (b, o) => b.readInt16LE(o), 32767], 5123: [2, (b, o) => b.readUInt16LE(o), 65535], 5120: [1, (b, o) => b.readInt8(o), 127], 5121: [1, (b, o) => b.readUInt8(o), 255] };
  const NUM: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const accessor = (i: number) => {
    const a = g.accessors[i];
    const bv = g.bufferViews[a.bufferView];
    const [bytes, read, norm] = COMP[a.componentType];
    const n = NUM[a.type];
    const stride = bv.byteStride || bytes * n;
    const out = new Float64Array(a.count * n);
    const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = norm === 1 ? read(bin, base + k * stride + c * bytes) : Math.max(-1, read(bin, base + k * stride + c * bytes) / norm);
    return { out, n, count: a.count };
  };
  const nodes = g.nodes;
  const parent = new Array<number>(nodes.length).fill(-1);
  nodes.forEach((nd, i) => (nd.children ?? []).forEach((c) => (parent[c] = i)));
  const depth = (i: number) => { let d = 0; for (let p = parent[i]; p >= 0; p = parent[p]) d++; return d; };
  const order = nodes.map((_, i) => i).sort((a, b) => depth(a) - depth(b) || a - b);
  const q = new THREE.Quaternion(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), v = new THREE.Vector3();
  const restLocal = nodes.map((nd) => ({ q: new THREE.Quaternion().fromArray(nd.rotation ?? [0, 0, 0, 1]), p: new THREE.Vector3().fromArray(nd.translation ?? [0, 0, 0]) }));
  const world = (local: { q: THREE.Quaternion; p: THREE.Vector3 }[]) => {
    const wq: THREE.Quaternion[] = [], wp: THREE.Vector3[] = [];
    for (const i of order) {
      if (parent[i] < 0) {
        wq[i] = local[i].q.clone();
        wp[i] = local[i].p.clone();
      } else {
        wq[i] = wq[parent[i]].clone().multiply(local[i].q);
        wp[i] = local[i].p.clone().applyQuaternion(wq[parent[i]]).add(wp[parent[i]]);
      }
    }
    return { wq, wp };
  };
  const rest = world(restLocal);
  const MIX: Record<string, string> = { lAnkle: 'LeftFoot', lToe: 'LeftToeBase', rAnkle: 'RightFoot', rToe: 'RightToeBase', root: 'Hips' };
  const nameOf = (i: number) => nodes[i].extras?.name ?? nodes[i].name ?? `n${i}`;
  const out: { speed: number; planted: number; settled: number }[] = [];
  for (const want of names) {
    const anim = g.animations.find((a) => (a.extras?.name ?? a.name) === want);
    if (!anim) throw new Error(`the rig has no ${want}`);
    const tracks = new Map<string, { times: Float64Array; vals: Float64Array; n: number }>();
    let end = 0;
    for (const ch of anim.channels) {
      const s = anim.samplers[ch.sampler];
      const ti = accessor(s.input), vi = accessor(s.output);
      end = Math.max(end, ti.out[ti.count - 1]);
      tracks.set(`${ch.target.node}:${ch.target.path}`, { times: ti.out, vals: vi.out, n: vi.n });
    }
    const sample = (tr: { times: Float64Array; vals: Float64Array; n: number }, t: number, intoQ: THREE.Quaternion | null, intoV: THREE.Vector3 | null) => {
      const { times, vals, n } = tr;
      let k = 0;
      while (k < times.length - 2 && times[k + 1] < t) k++;
      const u = times.length < 2 ? 0 : Math.min(1, Math.max(0, (t - times[k]) / (times[k + 1] - times[k] || 1)));
      if (n === 4) {
        qa.fromArray(vals, k * 4);
        qb.fromArray(vals, Math.min(times.length - 1, k + 1) * 4);
        intoQ!.slerpQuaternions(qa, qb, u);
      } else intoV!.set(vals[k * 3] + (vals[(k + 1) * 3] - vals[k * 3]) * u, vals[k * 3 + 1] + (vals[(k + 1) * 3 + 1] - vals[k * 3 + 1]) * u, vals[k * 3 + 2] + (vals[(k + 1) * 3 + 2] - vals[k * 3 + 2]) * u);
    };
    const fps = 60;
    const frames = Math.max(2, Math.round(end * fps) + 1);
    const bones = order.map((i) => ({ name: MIX[nameOf(i)] ?? nameOf(i), parent: parent[i] < 0 ? -1 : order.indexOf(parent[i]), rest: rest.wp[i].toArray() }));
    const quats = new Float64Array(frames * bones.length * 4);
    const travel = new Float64Array(frames * 3);
    const poses: Float64Array[] = [];
    for (let fr = 0; fr < frames; fr++) {
      const t = (fr / (frames - 1)) * end;
      const local = nodes.map((_, i) => {
        const r = tracks.get(`${i}:rotation`), p = tracks.get(`${i}:translation`);
        const lq = restLocal[i].q.clone(), lp = restLocal[i].p.clone();
        if (r) sample(r, t, lq, null);
        if (p) sample(p, t, null, lp);
        return { q: lq, p: lp };
      });
      const w = world(local);
      const pose = new Float64Array(bones.length * 3);
      order.forEach((i, b) => {
        q.copy(w.wq[i]).multiply(qa.copy(rest.wq[i]).invert());
        quats.set([q.x, q.y, q.z, q.w], (fr * bones.length + b) * 4);
        pose.set(w.wp[i].toArray(), b * 3);
        if (parent[i] < 0) travel.set(v.copy(w.wp[i]).sub(rest.wp[i]).toArray(), fr * 3);
      });
      poses.push(pose);
    }
    const a = analyzeClip({ frames, duration: (frames - 1) / fps, bones: bones.length, quats, travel }, bones, { ground: true });
    const speeds: number[] = [];
    for (const nm of ['LeftFoot', 'RightFoot']) {
      const bi = bones.findIndex((b) => b.name === nm);
      let low = Infinity;
      for (const p of poses) low = Math.min(low, p[bi * 3 + 1]);
      for (let fr = 1; fr < frames - 1; fr++) {
        if (poses[fr][bi * 3 + 1] - low > 0.035) continue;
        const vy = ((poses[fr + 1][bi * 3 + 1] - poses[fr - 1][bi * 3 + 1]) * fps) / 2;
        if (Math.abs(vy) > 0.45) continue;
        speeds.push(Math.hypot(((poses[fr + 1][bi * 3] - poses[fr - 1][bi * 3]) * fps) / 2, ((poses[fr + 1][bi * 3 + 2] - poses[fr - 1][bi * 3 + 2]) * fps) / 2));
      }
    }
    speeds.sort((x, y) => x - y);
    out.push({ speed: a.speed, planted: speeds.length ? speeds[speeds.length >> 1] : 0, settled: a.middle.L.length + a.middle.R.length });
  }
  return out;
}
