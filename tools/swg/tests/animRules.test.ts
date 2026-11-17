// Which imported clip plays when (src/anim/animRules.ts), the table of feel behind it (animTune.ts), its dials
// (animDials.ts), and the hand-overs only the game makes, read as text: the player's update, the frame loop, the rig's
// loader and the peers do not load in node, so each line a rule reaches the game by is pinned whole.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ANIM_DIALS, animDialsFor } from '../../../src/anim/animDials.ts';
import { IMPACT_MUTES, MX, NO_LANDING, airLoop, impact, impactHold, jumpStart, landing, landingSpeed, landingYields, type Landing } from '../../../src/anim/animRules.ts';
import { ANIM_RANGES, ANIM_TUNE, ANIM_TUNE_SHIPPED, tuneAnim, watchTrims, type AnimTune } from '../../../src/anim/animTune.ts';
import { clipName, readPackIndex } from '../../../src/anim/mxaFile.ts';
import { tableClips } from '../../../src/anim/locoTable.ts';
import { ClipEventIndex } from '../../../src/audio/clipEvents.ts';
import { SLOT_ACTIONS } from '../../../src/combat/forcePowers.ts';
import { DEFAULT_BINDINGS } from '../../../src/core/input.ts';
import { UNIT } from '../../../src/player/jkaMove.ts';
import { allDials, movedArgs, resetDials, type NumberDial } from '../../../src/ui/dials.ts';
import { SHIPPED_DIRS } from '../../dev/shippedPublic.mjs';
import { repoRoot } from './animFixtures.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const root = repoRoot(import.meta.url);
const text = (rel: string) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const all = () => true;
const none = () => false;
const only = (...names: string[]) => (clip: string) => names.includes(clip);
const T: AnimTune = JSON.parse(JSON.stringify(ANIM_TUNE_SHIPPED));
const land = (over: Partial<Landing>): Landing => ({ speed: 5.7, harm: 0, force: false, rolled: false, jka: false, ...over });

// ---- the names ---------------------------------------------------------------------------------------------------------
{
  const index = readPackIndex(JSON.parse(text('public/anims/mixamo/index.json')));
  if (typeof index === 'string') throw new Error(index);
  const used = index.clips.filter((c) => c.use).map((c) => clipName(c.id)).sort();
  ok([...Object.values(MX), ...tableClips().map(clipName)].sort().join() === used.join(), `the clips the rules name, with the speed classes' table's, are exactly the clips the pack marks for the game's use (${used.length})`);
  ok(index.clips.find((c) => c.id === 'treading_water')!.loop && index.clips.find((c) => c.id === 'falling_idle')!.loop && index.clips.find((c) => c.id === 'flying')!.loop && index.clips.find((c) => c.id === 'floating')!.loop && index.clips.find((c) => c.id === 'falling')!.loop, 'the five the game loops are loops in the pack');
  ok(['falling_flat_impact', 'falling_to_landing', 'hard_landing', 'jumping_down', 'jumping_up'].every((id) => !index.clips.find((c) => c.id === id)!.loop && id in ANIM_TUNE.trim), 'and the five it plays once are one-offs, each with a trim on a dial');
}

// ---- a rig without the clips is asked the same and answers "as before" ----------------------------------------------------
{
  const asked: string[] = [];
  const has = (clip: string) => (asked.push(clip), false);
  const answers = [jumpStart(has, false, T), airLoop(has, true, false, false), airLoop(has, false, true, false), airLoop(has, false, false, false), impact(has, T), landing(has, land({ harm: 12 }), T), landing(has, land({ speed: 9 }), T), landing(has, land({ speed: 5 }), T), landing(has, land({ speed: 1 }), T)];
  ok(answers.every((a) => a === null) && asked.length >= 8, 'without the imported clips every rule answers null, which is the game as it was: no rule names a clip the rig has not got');
}

// ---- the jump ---------------------------------------------------------------------------------------------------------------
{
  const up = jumpStart(all, false, T);
  ok(up !== null && up.clip === MX.jump && up.from === T.trim.jumping_up && up.fade === T.jump.fade, 'a plain jump starts with the imported jump, from its trim, faded in over the jump\'s own dial');
  ok(jumpStart(all, true, T) === null, 'with Jedi Academy\'s animations in charge (the block held, a swing under way) the jump is that game\'s own');
}

// ---- the air ----------------------------------------------------------------------------------------------------------------
{
  ok(airLoop(all, false, false, false) === MX.fall, 'a plain jump, a hop or a step off a ledge falls in the falling loop');
  ok(airLoop(all, false, true, false) === MX.float, 'after a flip, a Force jump or a wall move it floats');
  ok(airLoop(all, false, false, true) === null && airLoop(all, false, true, true) === null, 'with Jedi Academy\'s animations in charge the air is that game\'s own, Force or not');
  ok(airLoop(all, true, false, false) === MX.thrown && airLoop(all, true, true, true) === MX.thrown, 'and thrown from a wreck it is the long fall, whatever else is true');
  ok(airLoop(only(MX.fall), false, true, false) === null && airLoop(only(MX.float), false, false, false) === null, 'a loop the rig has not got is never stood in for by another: the game\'s own plays');
}

// ---- the landing ------------------------------------------------------------------------------------------------------------
{
  const soft = landing(all, land({ speed: 5.7 }), T);
  ok(soft !== null && soft !== NO_LANDING && soft.clip === MX.landSoft && soft.from === T.trim.jumping_down && soft.fade === T.land.fade, 'a hop on level ground (5.7 m/s) lands in the short landing');
  const long = landing(all, land({ speed: 11 }), T);
  ok(long !== null && long !== NO_LANDING && long.clip === MX.land && long.from === T.trim.falling_to_landing, 'a faster one that does no harm in the longer, from the brief\'s trim');
  const hard = landing(all, land({ speed: 14, harm: 20 }), T);
  ok(hard !== null && hard !== NO_LANDING && hard.clip === MX.landHard && hard.from === T.trim.hard_landing, 'and one that harms in the hard landing');
  const slowHarm = landing(all, land({ speed: 2, harm: 1, force: true }), T);
  ok(slowHarm !== null && slowHarm !== NO_LANDING && slowHarm.clip === MX.landHard, 'harm decides it, however slow, and for a Force user too');
  ok(landing(all, land({ speed: 3.5 }), T) === NO_LANDING && landing(all, land({ speed: 0 }), T) === NO_LANDING, 'under the least speed there is no landing clip at all: a kerb does not bob the knees');
  ok((landing(all, land({ speed: T.land.min }), T) as { clip: string }).clip === MX.landSoft && (landing(all, land({ speed: T.land.soft }), T) as { clip: string }).clip === MX.land && (landing(all, land({ speed: T.land.soft - 1e-9 }), T) as { clip: string }).clip === MX.landSoft, 'each line is taken from its own number up');
  ok(landing(all, land({ rolled: true, harm: 30, speed: 15 }), T) === null && landing(all, land({ jka: true, harm: 30 }), T) === null && landing(all, land({ jka: true }), T) === null, 'a roll and a landing mid-swing or behind a block are the game\'s own, harm or none');
  ok(landing(all, land({ force: true, speed: 9 }), T) === null && landing(all, land({ force: true, speed: 1 }), T) === null, 'as is a Force jump\'s that does no harm');
  ok(landing(only(MX.land), land({ speed: 5 }), T) === null && landing(only(MX.land), land({ speed: 1 }), T) === null && landing(only(MX.landSoft), land({ speed: 11 }), T) === null && landing(only(MX.land, MX.landSoft), land({ harm: 5 }), T) === null, 'a landing whose clip the rig has not got is null, never "nothing": the game\'s own rule then decides, as before');
  const moved: AnimTune = JSON.parse(JSON.stringify(T));
  moved.land.soft = 5;
  moved.land.min = 6;
  ok((landing(all, land({ speed: 5.7 }), moved) as unknown) === NO_LANDING, 'the lines are the table\'s, read at each landing: moved, the same hop lands otherwise');
  moved.land.min = 1;
  ok((landing(all, land({ speed: 5.7 }), moved) as { clip: string }).clip === MX.land, 'and otherwise again');
}
{
  ok(Math.abs(landingSpeed(2, UNIT) - 3.592) < 1e-3 && T.land.min > landingSpeed(2, UNIT) && T.land.min - landingSpeed(2, UNIT) < 0.02, `the least landing is the game's own line: its landing "delta" of 2 is ${landingSpeed(2, UNIT).toFixed(3)} m/s`);
  ok(landingSpeed(0, UNIT) === 0 && landingSpeed(-3, UNIT) === 0 && Math.abs(landingSpeed(8, UNIT) / landingSpeed(2, UNIT) - 2) < 1e-12, 'a delta is a speed squared: four times the delta is twice the speed, and none is none');
}
{
  ok(!landingYields(0, true, T) && !landingYields(T.land.moveCut - 0.01, true, T) && landingYields(T.land.moveCut, true, T) && landingYields(2, true, T), 'a landing gives way to a held move key once it has played its first part');
  ok(!landingYields(0.5, false, T) && !landingYields(99, false, T), 'and never to a body standing still');
  const never: AnimTune = JSON.parse(JSON.stringify(T));
  never.land.moveCut = 3;
  ok(!landingYields(2.9, true, never), 'with the dial at its top no landing is ever cut');
}

// ---- the thrown fall's end ---------------------------------------------------------------------------------------------------
{
  const hit = impact(all, T);
  ok(hit !== null && hit.clip === MX.impact && hit.from === T.trim.falling_flat_impact && hit.fade === T.impact.fade && impact(none, T) === null, 'the thrown fall ends in the impact from the brief\'s trim; without it the body goes straight to lying, as before');
  ok(impactHold(1.2, T) === 1.2 && impactHold(-1, T) === 0, 'the keys are held for as long as the impact plays');
  const half: AnimTune = JSON.parse(JSON.stringify(T));
  half.impact.lock = 0.5;
  ok(impactHold(1.2, half) === 0.6, 'or the dial\'s share of it');
  half.impact.lock = 0;
  ok(impactHold(1.2, half) === 0, 'or not at all');
  half.impact.lock = 7;
  ok(impactHold(1.2, half) === 1.2, 'and never longer than it plays');
  ok(IMPACT_MUTES.length === 24 && IMPACT_MUTES.every((a) => a in DEFAULT_BINDINGS) && new Set(IMPACT_MUTES).size === 24, 'what is held is twenty-four of the game\'s own actions');
  ok(['forward', 'back', 'left', 'right', 'jump', 'crouch', 'prone', 'kneel', 'attack', 'altAttack', 'altFire', 'block', 'saberThrow'].every((a) => IMPACT_MUTES.includes(a)), 'moving, jumping, the postures and the fight');
  ok(SLOT_ACTIONS.length === 6 && SLOT_ACTIONS.every((a) => IMPACT_MUTES.includes(a)), 'every ability slot the kits read (a Force jump from one launched the body out of the impact while its keys were held)');
  ok(IMPACT_MUTES.includes('grappleFire') && ['emote1', 'emote2', 'emote3', 'emote4'].every((a) => IMPACT_MUTES.includes(a)), 'the grapple\'s shot, which hauls the body, and the emote keys, which would play over the impact');
  ok(['menu', 'inventory', 'map', 'mount', 'saberToggle', 'switchClass', 'emoteWheel', 'journal', 'debugMenu'].every((a) => !IMPACT_MUTES.includes(a)), 'and never a panel\'s key, nor the use key, the saber\'s switch or the class switch');
}

// ---- the table -----------------------------------------------------------------------------------------------------------------
{
  // The numbers (the table's choices, its words, are held by animPolish.test.ts).
  const flat = (t: AnimTune) => Object.entries(t).flatMap(([g, v]) => (v && typeof v === 'object' ? Object.entries(v as Record<string, unknown>).filter(([, n]) => typeof n === 'number').map(([k, n]) => [`${g}.${k}`, n as number] as const) : []));
  ok(flat(ANIM_TUNE).every(([k, v]) => ANIM_RANGES[k] !== undefined && v >= ANIM_RANGES[k].min && v <= ANIM_RANGES[k].max) && Object.keys(ANIM_RANGES).length === flat(ANIM_TUNE).length, 'every number of the table has a range, and stands inside it');
  ok(JSON.stringify(ANIM_TUNE) === JSON.stringify(ANIM_TUNE_SHIPPED), 'nothing has moved the table: it is what ships');
  ok(Math.round(ANIM_TUNE_SHIPPED.trim.falling_to_landing * 30) === 7 && Math.round(ANIM_TUNE_SHIPPED.trim.hard_landing * 30) === 16 && ANIM_TUNE_SHIPPED.trim.falling_flat_impact * 30 >= 11 && ANIM_TUNE_SHIPPED.trim.falling_flat_impact * 30 <= 12, 'the three trims the brief gives are the brief\'s frames at 30 a second: 7, 16, and between 11 and 12');
  const told: string[][] = [];
  watchTrims((ids) => told.push([...ids]));
  ok(tuneAnim({ land: { soft: 8 } }).length === 0 && ANIM_TUNE.land.soft === 8 && told.length === 0, 'a number is set by its group and name, and one that is no trim tells nobody');
  ok(tuneAnim({ trim: { hard_landing: 0.6, jumping_down: 0.1 }, land: { min: 4 } }).length === 0 && told.length === 1 && told[0].join() === 'hard_landing,jumping_down', 'trims moved are told once a call, by id, to whoever holds fitted clips');
  ok(tuneAnim({ trim: { hard_landing: 0.6 } }).length === 0 && told.length === 1, 'and a trim set to what it is tells nobody');
  const held = tuneAnim({ land: { soft: 99 }, impact: { lock: -2 } });
  ok(ANIM_TUNE.land.soft === 20 && ANIM_TUNE.impact.lock === 0 && held.length === 2 && held.every((w) => /held to/.test(w)), 'a number past its range is held to it, in words');
  const refused = [...tuneAnim({ nope: { a: 1 } }), ...tuneAnim({ land: { nope: 1 } }), ...tuneAnim({ land: { soft: 'fast' } }), ...tuneAnim({ land: 4 }), ...tuneAnim(7), ...tuneAnim({ land: { soft: NaN } }), ...tuneAnim({ __proto__: { x: 1 }, constructor: { soft: 1 } })];
  ok(refused.length === 7 && ANIM_TUNE.land.soft === 20, `anything else is refused in words and sets nothing (${refused.length} refusals)`);
  watchTrims(null);
  tuneAnim(JSON.parse(JSON.stringify(ANIM_TUNE_SHIPPED)));
  ok(JSON.stringify(ANIM_TUNE) === JSON.stringify(ANIM_TUNE_SHIPPED), 'and the shipped table handed back whole puts every number back');
}

// ---- the dials -------------------------------------------------------------------------------------------------------------------
{
  const set = animDialsFor('anim');
  ok(set === ANIM_DIALS && set !== null && set.helper === 'anim' && animDialsFor('race') === null && animDialsFor('') === null, 'the debug menu is handed the dials when `anim` is picked, and nothing for another helper');
  // The numbers' sliders (the choices beside them are animPolish.test.ts's).
  const dials = allDials(ANIM_DIALS).filter((d) => d.kind === 'number') as NumberDial[];
  const keys = dials.map((d) => d.key).sort();
  ok(keys.join() === Object.keys(ANIM_RANGES).map((k) => `tune.${k}`).sort().join() && allDials(ANIM_DIALS).every((d) => d.kind === 'number' || d.kind === 'choice'), `every number of the table is one slider, and nothing is anything but a slider or a choice (${dials.length})`);
  ok(dials.every((d) => d.min === ANIM_RANGES[d.key.slice(5)].min && d.max === ANIM_RANGES[d.key.slice(5)].max && d.get() === ANIM_DIALS.shipped.get(d.key)), 'each over its number\'s own range, reading what ships');
  const softDial = dials.find((d) => d.key === 'tune.land.soft')!, trimDial = dials.find((d) => d.key === 'tune.trim.hard_landing')!;
  softDial.set(8.5);
  trimDial.set(0.7);
  ok(ANIM_TUNE.land.soft === 8.5 && softDial.get() === 8.5 && ANIM_TUNE.trim.hard_landing === 0.7, 'a slider moves the table the rules read');
  const line = movedArgs(ANIM_DIALS);
  ok(/tune/.test(line) && /soft/.test(line) && /8\.5/.test(line) && /hard_landing/.test(line) && !/moveCut/.test(line), `and the line the menu copies out names what moved, as the console takes it (${line})`);
  ok(softDial.text!(7) === 'a fall of about 1.2 m' && trimDial.text!(0.533) === '16.0 frames', 'a landing speed is said as the fall that gives it and a trim in the brief\'s frames');
  resetDials(ANIM_DIALS);
  ok(JSON.stringify(ANIM_TUNE) === JSON.stringify(ANIM_TUNE_SHIPPED), 'the menu\'s reset puts the table back');
}

// ---- the foot marks' way in ----------------------------------------------------------------------------------------------------------
{
  const index = new ClipEventIndex();
  ok(!index.ready && index.eventsFor('mx_running', 'whole', 'human_male') === null, 'an index that has taken nothing knows nothing of an imported clip');
  const added = index.addClips({ mx_running: [{ name: 'event_footstep', f: 0.6 }, { name: 'event_footstep', f: 0.1 }], 'jka:BOTH_RUN1': [{ name: 'event_footstep', f: 0.2 }], mx_empty: [], '': [{ name: 'event_footstep', f: 0.5 }] });
  ok(added === 1 && index.addClips({}) === 0, 'the footsteps take a clip\'s marks by its name; one with none, a nameless one and Jedi Academy\'s own are left out');
  // And can find them again: by the clip's own name, for whichever half of the body plays it and whatever the body is,
  // with no sounds pack ever read (the index is "ready" on the marks alone).
  const found = index.eventsFor('mx_running', 'whole', 'human_male');
  ok(index.ready && found !== null && found.length === 2 && found[0].f === 0.1 && found[1].f === 0.6 && found.every((e) => e.kind === 'foot' && e.name === 'footstep'), 'the footsteps find an imported clip\'s marks by the clip\'s own name, as foot events in the order they fall, with no sounds pack read at all');
  ok(index.eventsFor('mx_running', 'lower', null) === found && index.eventsFor('mx_running', 'whole', 'wookiee_male') === found && index.eventsFor('mx_walking', 'whole', 'human_male') === null && index.eventsFor('mx_empty', 'whole', null) === null, 'for any body and either way the clip is played, and nothing for a clip that handed none over');
  index.addClips({ mx_running: [{ name: 'event_footstep', f: 0.3 }] });
  ok(index.eventsFor('mx_running', 'whole', null)!.length === 1, 'a clip handed over again takes the newer marks');
}

// ---- the hand-overs only the game makes --------------------------------------------------------------------------------------------
{
  const player = text('src/player/player.ts');
  const main = text('src/main.ts');
  const rig = text('src/player/rig.ts');
  const peers = text('src/net/remotePlayers.ts');
  const has = (src: string, line: string) => src.includes(line);
  const count = (src: string, part: string) => src.split(part).length - 1;

  // The body's memory and every rule's hand-over to the rig are `BodyAnim` (src/anim/bodyAnim.ts), which
  // animBody.test.ts drives; what is pinned here is each of the player's calls on it, whole, and that nothing of it is
  // left behind in the player's own lines.
  const body = text('src/anim/bodyAnim.ts');
  ok(has(player, 'private readonly anim = new BodyAnim(ANIM_TUNE, UNIT);') && !/\b(jumpStart|landingYields|landingSpeed|impactHold|airLoop|NO_LANDING)\b/.test(player) && !/\bimpact\(/.test(player) && !/\blanding\(/.test(player), 'the player keeps one record of what its body remembers for the imported clips, over the game\'s own table of feel, and asks no rule itself');
  ok(has(player, 'if (!this.anim.jump(rig, this.jkaActing)) this.playOnce(this.jumpClip(\'JUMP\', false), 0.05);') && /if \(ev\.jumped\) \{\n[^}]*if \(!this\.anim\.jump\(rig, this\.jkaActing\)\)/.test(player), 'the player\'s jump is the record\'s when it is the imported one, else the jump it always played');
  ok(/if \(ev\.landed !== null\) \{\n(\s+\/\/[^\n]*\n)+\s+const how = this\.anim\.land\(rig, ev\.landed, ev\.damage, ev\.forceLanded, ev\.rolled !== null, this\.saber\.busy \|\| this\.jkaActing\);\n\s+if \(how === 'before' && ev\.landed >= 2 && !ev\.rolled && !this\.saber\.busy\) this\.playOnce\(this\.jumpClip\('LAND', ev\.forceLanded\), 0\.06\);\n\s+\}/.test(player), 'every landing the step reports, however gentle, is handed over whole (how fast, the fall\'s harm, the step\'s Force word, a roll, a swing or the block); "before" plays the old landing by the old rule, to the letter');
  ok(/this\.anim\.stepped\(stepGrounded\);\n\s+if \(ev\.jumped\) \{/.test(player) && /const ev = this\.jka\.step\(dt, this\.vel, this\.pos, stepGrounded, c,[^\n]*\n\s+if \(slopeJumped\) ev\.jumped = true;\n\s+const rig = this\.rig;\n(\s+\/\/[^\n]*\n)+\s+this\.anim\.stepped\(stepGrounded\);/.test(player), 'the record is told of every step of the movement, with the ground the step itself was handed, before any of the step\'s events (and a jump off a steep face, wave 2b, is one of them)');
  ok(/\n      \/\/ An imported landing gives way to the keys once it has shown its start\.\n      this\.anim\.cut\(rig, dt, moving\);\n/.test(player) && count(player, 'this.anim.cut(') === 1, 'a landing\'s cut is asked on every frame the movement is stepped, with the frame\'s own step and whether a move key is held');
  ok(has(player, 'this.jkaActing = this.hasJkaClips && (this.blocking || fighting);'), 'Jedi Academy\'s animations are in charge only while blocking or fighting, and only on a rig that has them');
  ok(has(player, 'if (ev.special || ev.flip || ev.forceJumpStarted) this.anim.forceMove();') && /\/\/ A Force user's air, as a held jump's is\.\n\s+this\.anim\.forceMove\(\);\n  \}/.test(player) && count(player, 'this.anim.forceMove();') === 2, 'the air is a Force user\'s from a flip, a Force jump, a wall move and a launch');
  ok(/if \(this\.flung && this\.grounded\) \{\n\s+this\.prone = true;\n\s+this\.vel\.x = 0;\n\s+this\.vel\.z = 0;\n(\s+\/\/[^\n]*\n)+\s+this\.anim\.hitGround\(this\.rig\);\n\s+\}/.test(player), 'the thrown fall\'s end lies the body down and hands the impact to the record');
  ok(/this\.grounded = false;\n\s+this\.anim\.fling\(\);\n\s+this\.prone = false;/.test(player) && has(player, 'get flung(): boolean {\n    return this.anim.flung;') && !/this\.flung = /.test(player), 'thrown is the record\'s word, set by `fling` and by nothing else');
  ok(/\n    this\.anim\.tick\(dt\);\n/.test(player) && has(player, 'get impactLocked(): boolean {\n    return this.anim.impactLocked;'), 'the hold runs down with the player\'s own update');
  ok(count(player, 'this.anim.drop();') === 5 && count(player, 'this.jka.holdApex(this.pos.y);\n    this.anim.drop();\n    this.slope.reset();') === 2 && /this\.jka\.holdApex\(this\.pos\.y\);\n\s+this\.anim\.drop\(\);\n\s+this\.slope\.reset\(\);/.test(player) && /this\.grounded = true;\n\s+this\.anim\.drop\(\);/.test(player) && /this\.jka\.reset\(\);\n\s+this\.anim\.drop\(\);/.test(player) && /this\.submerged = false;\n(\s+\/\/[^\n]*\n)+\s+this\.anim\.drop\(\);/.test(player), 'and everything held is dropped wherever the body is stood, reset or mounted, and where a ledge or a wall takes it (wave 4)');
  ok(has(body, '  drop(): void {\n    this.force = false;\n    this.jumped = false;\n    this.thrown = false;\n    this.impactLeft = 0;\n    this.impactOwed = false;\n    this.landClip = null;\n    this.noFall = true;\n  }'), 'a thrown fall with the rest: it does not follow the body to its next respawn or arrival');
  ok(/if \(this\.swimming\) \{\n[\s\S]{0,600}?\n\s+this\.rig\?\.stopOverride\(\);\n(\s+\/\/[^\n]*\n)+\s+this\.anim\.swim\(\);\n\s+this\.saber\.holster\(\);/.test(player) && count(player, 'this.anim.swim();') === 1, 'every swimming frame says so: water ends a thrown fall and the air\'s memory, and the plunge is no landing on the shore');
  ok(/\} else if \(this\.grounded\) \{\n(\s+\/\/[^\n]*\n)+\s+this\.anim\.onGround\(\);/.test(player), 'and under the movement that reports no landings the ground says so itself');
  ok(has(player, 'rig.prefer(\'float\', MX.tread);\n      // Still under the water the tread too, under the owner\'s rule (`ANIM_TUNE.swim.rule`); the swimming stroke before.\n      rig.setState(moving || (this.submerged && ANIM_TUNE.swim.rule !== \'owner\') ? \'swim\' : \'float\', speed, this.blocking && this.hasJkaClips ? stance : null);') && has(player, 'this.rig?.prefer(\'float\', MX.adrift);'), 'still in the water the float is the tread (still under the water too, under the owner\'s rule; the stroke there before), and adrift in space the flying loop');
  ok(has(player, '    else if (!this.grounded) {\n') && has(player, 'this.anim.rope = this.grapple.attached;\n      this.anim.vy = this.vel.y;\n      const loop = this.anim.air(rig, this.jkaActing);\n      if (this.flung && !loop) rig.setState(\'swim\', 3);\n      else {\n        rig.prefer(\'air\', loop ?? this.jumpClip(\'INAIR\', this.jka.isForceJumping));\n        // Sliding down a face too steep to stand on, the falling loop comes in over the slope\'s own fade (wave 2b).\n        this.slideFade.fade = LOCO_TUNE.slope.fade;\n        rig.setState(\'air\', 0, null, this.slope.sliding ? this.slideFade : undefined);\n      }'), 'in the air it asks the record for the loop: thrown without the long fall it flails as it always did, and otherwise plays the answer, else the in-air pose it always held (wave 2b: over the fade of the slope dials while the body slides)');
  ok(has(player, 'this.correctAim(dt, gunUp, rig.armSource().startsWith(\'mx_\'));') && has(player, 'if (this.sinceShot < 0.35) return;\n    // Held where it stands') && /\n    if \(importedArms\) return;\n    const right = this\.reach\.right;/.test(player), 'and the aim\'s correction is held where it stands, as through a shot, while an imported clip has the arms');
  ok(has(rig, '  yieldOverride(fade = 0.15): void {') && has(rig, '    this.override = null;\n    this.current = ending;\n    this.state = null;\n    this.upperName = null;\n    if (state) this.setState(state, 0, upper);\n    if (this.current === ending) ending.fadeOut(fade);\n    else if (this.current) ending.crossFadeTo(this.current, fade, false);') && has(body, 'rig.yieldOverride(this.tune.land.moveFade);') && !has(body, 'stopOverride'), 'a landing cut short gives way through the rig\'s own way out into the state as it stands, never the plain stop');

  ok(has(main, 'private stepImpactKeys(): void {\n    if (this.player.impactLocked) this.input.mute(IMPACT_MUTES as readonly Action[]);\n  }') && count(main, 'this.stepImpactKeys();') === 2, 'the game mutes the impact\'s actions while the hold lasts, at two places');
  ok(/this\.stepImpactKeys\(\);\n[^\n]*\n\s+if \(!this\.placing && !this\.propPlacing\) this\.stepGrappleKeys\(\);/.test(main) && /this\.stepImpactKeys\(\);\n[^\n]*\n[^\n]*\n\s+if \(!this\.map\.open && !this\.anyPanelOpen\(\) && !this\.placing && !this\.propPlacing\) this\.stepGrappleKeys\(\);/.test(main), 'the frame loop and the console\'s advance, each before the grapple\'s keys and so before anything reads one');
  ok(has(main, 'IMPORTED_CLIPS.provider = (skeleton, label) => MIXAMO.clipsFor(skeleton, label);\nvoid MIXAMO.load();') && has(main, 'const MIXAMO = mixamoPack(browserIo({ text: (path, init) => fetchPublic(path, init, import.meta.env.BASE_URL), bytes: (path, query) => fetchPublicBytes(path, query, import.meta.env.BASE_URL) }))!;'), 'the game makes its one pack over its own asks of its public files (the build\'s own list, every ask kept for the console), hands the rigs\' loader its fits, and begins the load as it starts');
  ok(has(main, 'void MIXAMO.load().then(() => this.feet.index.addClips(MIXAMO.footEvents()));') && has(main, 'this.feet.index.addClips(MIXAMO.footEvents());\n    }'), 'the clips\' foot marks go to the footsteps once the pack is in, and again when the console fetches another clip');
  ok(has(main, 'animDialsFor(helper) ??') && has(main, 'anim: (arg?: string | AnimDebugOptions, loop = true) => this.animDebug(arg, loop),'), 'the debug menu asks for the dials, and `__debug.anim` is the one helper');
  ok(has(main, 'if (o.tune !== undefined) words.push(...tuneAnim(o.tune));') && has(main, 'const n = MIXAMO.setAlign(o.align, words);') && has(main, 'rig.play(exact, { loop, hold: !loop });'), 'which sets the table through the dials\' own setter, flips the alignment in place (saying a group that is none), and plays a clip by name as it always did');
  // The console's own lines, each of which a slip would break with nothing else to say so.
  ok(has(main, '    if (o.stop) {\n      rig?.stopOverride();\n      words.push(\'stopped\');\n    }'), '`stop` ends a played clip');
  ok(has(main, '    const none = MIXAMO.unavailable();\n    if (none) return { ...(words.length ? { words } : {}), error: none, state: MIXAMO.state };\n    const ids = MIXAMO.matching(word);'), '`play` with no pack to play from (the switch off, a build without it) says that, before it looks for a clip');
  ok(has(main, '    if (!rig.has(name)) {\n      const clip = await MIXAMO.clipFor(id, rig.restSkeleton(), rig.character?.manifest.id ?? \'player\');'), 'a clip the rig has already is played as it is: only one it has not got is fetched and fitted');
  ok(has(main, '    const start = from === \'trim\' ? (tuned ?? row.trimStart) : typeof from === \'number\' && from > 0 ? from : 0;\n    const seconds = now.play(name, { loop: looping, hold: !looping, from: start });') && has(main, '    const looping = loop ?? row.loop;'), 'and it starts where it was asked to: at its trim (the dial\'s, else its row\'s), at a number of seconds, else at its start, looping as its row says unless told');
  ok(has(main, 'this.remotes.adrift = !!this.world.planet.space;'), 'the peers are told whether the world has ground');

  ok(count(rig, 'await attachImportedClips(rig, ') === 2 && has(rig, 'const clips = await Promise.race([fitting, late]);\n    if (clips) rig.addClips(clips, IMPORTED_CLIPS.strides);\n    else void fitting.then((c) => rig.addClips(c, IMPORTED_CLIPS.strides));'), 'both of the rig loader\'s paths hand a rig its clips (each walking or running one with its stride) before it is returned, bounded, and late ones are added when they land');
  ok(has(rig, "  air: ['mx_falling_idle', 'BOTH_INAIR1', 'jump', 'fall', 'loop_jump', 'sneak_pose', 'idle', 'stand'],") && has(rig, "  float: ['mx_treading_water', 'float', 'loop_swimming:speed0', 'swim', 'idle'],"), 'the air and the still water name the imported loop first, and after it exactly what they named before');
  ok(has(peers, "else if (state === 'float') rig.prefer('float', this.adrift && !r.aboard ? MX.adrift : MX.tread);"), 'a peer who floats is adrift where the world has no ground and they are in no hull, and treading otherwise');

  ok((SHIPPED_DIRS as readonly string[]).includes('anims') && text('tools/launcher/pack.mjs').includes('const ANIM_CLIP = /^anims\\/[^/]+\\/[^/]+\\.mxa$/;'), 'a build\'s own list of what it ships takes the pack\'s folder, and a release takes its clip files');
  const walk = (dir: string): string[] => readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
  const packFiles = walk('public/anims');
  ok(packFiles.length > 50 && packFiles.every((f) => /^public\/anims\/mixamo\/(index\.json|[a-z0-9_]+\.mxa)$/.test(f)) && [...walk('tools/anim'), ...walk('src/anim')].every((f) => /\.(mjs|ts|md)$/.test(f)), `the checkout holds the pack and the code and no source file: an index and ${packFiles.length - 1} clips, nothing else`);
  const tracked = text('package.json');
  ok(/"anims": "node tools\/anim\/cli\.mjs"/.test(tracked) && /"test:anim": /.test(tracked) && /"test:all": "[^"]*test:anim/.test(tracked), 'the importer is `npm run anims`, and its suites run in `test:anim`, which `test:all` runs');
}

console.log(`\n${checks} checks passed`);
