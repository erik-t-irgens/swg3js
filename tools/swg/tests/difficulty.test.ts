// The owner's difficulty knob (src/world/difficulty.ts): one scale on the health and the blows of
// everything the world stands, kept in this browser, moved live from the Gameplay page and the
// console, and never on the player or another player.
//
// Three things are pinned. The arithmetic: a value outside the knob's ends is clamped, and a body the
// knob moves keeps the share of its health it had, so a fight under way does not jump. The page: its
// slider runs from end to end of the range the console clamps to, and its setting survives a reload.
// And the reach, read as text: every kind of body the world stands takes the scale when it is stood
// and again when the knob moves, and the player's own numbers never read it.
//
// A nest is built for real (it loads under node), which is the one body here that is not a mirror.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

// A stand-in for the browser's storage, which the settings reach for inside a try.
const bag = new Map<string, string>();
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => (bag.has(k) ? bag.get(k)! : null),
  setItem: (k: string, v: string) => void bag.set(k, v),
  removeItem: (k: string) => void bag.delete(k),
};

const { DIFFICULTY, DIFFICULTY_RANGE, applyDifficultyTo, clampDifficulty, rescaleBody, rescaledHealth, scaledByDifficulty, setDifficulty } = await import('../../../src/world/difficulty.ts');
const { DEFAULT_SETTINGS, loadSettings, saveSettings } = await import('../../../src/core/settings.ts');
const { GAMEPLAY } = await import('../../../src/ui/gameplayPage.ts');
const { WildNest } = await import('../../../src/world/wildNest.ts');
const { WildLife, WILD_TUNE } = await import('../../../src/world/wildLife.ts');
const THREE = await import('three');

// ------------------------------------------------------------------ the arithmetic
{
  ok(DIFFICULTY.scale === 1 && DEFAULT_SETTINGS.difficulty === 1, 'it starts at one: every body stands at its own numbers');
  ok(DIFFICULTY_RANGE.min > 0 && DIFFICULTY_RANGE.min < 1 && DIFFICULTY_RANGE.max >= 1, `its ends (${DIFFICULTY_RANGE.min} to ${DIFFICULTY_RANGE.max}) hold one, and never reach nothing`);
  ok(clampDifficulty(0) === DIFFICULTY_RANGE.min && clampDifficulty(99) === DIFFICULTY_RANGE.max && clampDifficulty(0.5) === 0.5, 'a value past either end is held at it');
  ok(clampDifficulty('lots') === 1 && clampDifficulty(NaN) === 1 && clampDifficulty(undefined) === 1 && clampDifficulty('0.25') === 0.25, 'and a value that is not a number is the data as it is');
  try {
    ok(setDifficulty(0.5) === 0.5 && DIFFICULTY.scale === 0.5 && scaledByDifficulty(1689) === 844.5, "set to a half, a level-116 Tusken's 1,689 health is 844.5");
    setDifficulty(-4);
    ok(DIFFICULTY.scale === DIFFICULTY_RANGE.min, 'and set below its end it is held there');
  } finally {
    setDifficulty(1);
  }
  ok(rescaledHealth(50, 100, 40) === 20, 'a body half dead is half dead after the knob moves');
  ok(rescaledHealth(100, 100, 250) === 250 && rescaledHealth(0, 100, 250) === 0, 'a whole one is whole, a dead one stays at nothing');
  ok(rescaledHealth(130, 100, 40) === 40 && rescaledHealth(-5, 100, 40) === 0, 'a health past either end of its whole is held inside the new one');
  ok(rescaledHealth(10, 0, 40) === 40 && rescaledHealth(NaN, 100, 40) === 40, 'and one with no whole to speak of is given the new whole outright');
}

// ------------------------------------------------------------------ the one rule every body keeps, and every list walked
{
  // Every kind of body the world stands moves by this one function when the knob does (a person or a
  // lair's creature, a fighter, a nest, the old wildlife), so it is the one tried here in full; the
  // classes are pinned below to call it with their own base number.
  const b = { hp: 50, maxHp: 100, dead: false };
  rescaleBody(b, 200, 0.5);
  ok(b.maxHp === 100 && b.hp === 50, "a body's whole is its own number at the scale, and a body half dead stays half dead");
  rescaleBody(b, 200, 1);
  ok(b.maxHp === 200 && b.hp === 100, 'turned back up it is still half dead, at its own whole');
  const mid = { hp: 30, maxHp: 120, dead: false };
  rescaleBody(mid, 120, 2);
  ok(mid.maxHp === 240 && mid.hp === 60, 'a fighter a quarter alive mid-fight is a quarter alive after, never healed to full');
  const gone = { hp: 0, maxHp: 80, dead: true };
  rescaleBody(gone, 80, 0.25);
  ok(gone.hp === 0 && gone.maxHp === 20, 'and a dead one stays at nothing');
  const told: number[] = [];
  applyDifficultyTo([{ applyDifficulty: (s: number) => void told.push(s) }, null, undefined, { applyDifficulty: (s: number) => void told.push(s * 10) }], 0.4);
  ok(told.join() === '0.4,4', 'every body in a list is told the scale, and a hole in the list is stepped over');
}

// ------------------------------------------------------------------ the nests standing in a real wild world
{
  // `WildLife.applyDifficulty` is the only way a live change reaches a nest already standing. A node test
  // has no world to build a nest's model in, so, as wildLife.test.ts does, a nest is hung on a standing
  // site by hand; everything else is the real wild world stepped about a player.
  const w = new WildLife();
  const manifest = {
    format: 1,
    creatures: { thing: { id: 'thing_model', level: 5, hp: 200, hpMax: 240, damage: [10, 14], diet: 'herbivore', kind: 'herbivore', aggressive: false, herd: true, pack: false, social: '' } },
    lairs: { L: { kind: 'creature_lair', mobiles: [{ who: 'thing', n: 1 }], boss: [], cap: 15, nest: 'nest.iff', building: '', people: false } },
    groups: { g: [{ lair: 'L', weight: 1, count: 15, size: 25, limit: -1, minDiff: 1, maxDiff: 8 }] },
  };
  const areas = Array.from({ length: 8 }, (_, i) => ({ name: `a${i}`, shape: 'circle' as const, x: Math.cos((i / 8) * Math.PI * 2) * 70, z: Math.sin((i / 8) * Math.PI * 2) * 70, r: 60, groups: ['g'], cap: 64 }));
  w.adopt({ format: 1, planet: 'w', areas, noSpawn: [], statics: [] } as never, manifest as never);
  const deps = {
    catalogue: () => ({ byId: (id: string) => ({ id, name: id, ready: true }) }),
    spawn: (_e: unknown, at: { x: number; z: number }) => ({ dead: false, removed: false, x: at.x, z: at.z, pos: { x: at.x, y: 0, z: at.z } }),
    remove: () => {},
    centre: () => ({ x: 0, z: 0 }),
    held: () => false,
  };
  const at = new THREE.Vector3(0, 0, 0);
  for (let i = 0; i < 4; i++) w.step(WILD_TUNE.everySeconds + 0.1, i * 2, at, deps as never);
  const standing = (w as unknown as { standing: Map<string, { nest: InstanceType<typeof WildNest> | null }> }).standing;
  const sites = [...standing.values()];
  ok(sites.length >= 2, `the wild world stands ${sites.length} sites about the player`);
  const whole = new WildNest('nest', 1000);
  const hurt = new WildNest('nest', 1000);
  hurt.damage(750);
  sites[0].nest = whole;
  sites[1].nest = hurt;
  try {
    setDifficulty(0.5);
    w.applyDifficulty(DIFFICULTY.scale);
    ok(whole.maxHp === 500 && whole.hp === 500, "the knob turned to a half reaches a nest standing in the world: half its whole");
    ok(hurt.maxHp === 500 && Math.abs(hurt.hp - 125) < 1e-9, 'and one already struck keeps its share, a quarter left of a smaller whole');
  } finally {
    setDifficulty(1);
    w.applyDifficulty(1);
    sites[0].nest = null;
    sites[1].nest = null;
  }
}

// ------------------------------------------------------------------ a real body the knob reaches: a nest
{
  try {
    setDifficulty(0.5);
    const nest = new WildNest('a lair', 3000);
    ok(nest.maxHp === 1500 && nest.hp === 1500, 'a nest built with the knob at a half has half its health');
    nest.damage(500);
    ok(nest.hp === 1000, 'and takes a blow as it always did');
    nest.applyDifficulty(1);
    ok(nest.maxHp === 3000 && Math.abs(nest.hp - 2000) < 1e-9, 'turned back up it is whole at its own number, still two thirds of the way there');
    nest.damage(5000);
    nest.applyDifficulty(0.25);
    ok(nest.dead && nest.hp === 0 && nest.maxHp === 750, 'and a nest knocked down stays down whatever the knob does');
  } finally {
    setDifficulty(1);
  }
}

// ------------------------------------------------------------------ the page and the setting
{
  const knob = GAMEPLAY.flatMap((g) => g.knobs).find((k) => k.key === 'difficulty');
  ok(!!knob && knob.kind === 'range', 'the Gameplay page has a slider for it');
  ok(knob!.min === DIFFICULTY_RANGE.min && knob!.max === DIFFICULTY_RANGE.max, "and it runs from end to end of the range the console clamps to, so the two can never disagree");
  ok(DEFAULT_SETTINGS.difficulty >= knob!.min! && DEFAULT_SETTINGS.difficulty <= knob!.max!, 'with its default inside it');
  ok(typeof knob!.hint === 'string' && /never scaled/.test(knob!.hint), 'and says that the player is never scaled');
  const s = loadSettings();
  s.difficulty = 0.6;
  saveSettings(s);
  ok(loadSettings().difficulty === 0.6, 'kept in this browser: a reload brings it back');
  bag.set('swg.settings', JSON.stringify({ difficulty: 'hard' }));
  ok(loadSettings().difficulty === 1, 'and a value saved as words falls back on one');
  bag.clear();
}

// ------------------------------------------------------------------ the reach, read as text
{
  const src = (p: string): string => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const mobile = src('world/mobiles/mobile.ts');
  const manager = src('world/mobiles/manager.ts');
  const npcs = src('world/npcs.ts');
  const creatures = src('world/creatures.ts');
  const nest = src('world/wildNest.ts');
  const wild = src('world/wildLife.ts');
  const world = src('world/world.ts');
  const main = src('main.ts');
  const menu = src('ui/menu.ts');
  const player = src('player/player.ts');
  // Each body's own method is the one rule above with its own base number, and each manager walks its
  // whole list with the one walk above: a method emptied or a loop dropped fails here, not on the owner.
  const method = (text: string, body: string): boolean => new RegExp(`applyDifficulty\\(scale: number\\): void \\{\\s*${body}\\s*\\}`).test(text);
  ok(/this\.maxHp = scaledByDifficulty\(this\.baseHp\);\s*this\.hp = this\.maxHp;/.test(mobile) && /this\.blow = scaledByDifficulty\(this\.baseBlow\);/.test(mobile), "a catalogue body (a person, a lair's creature, what an admin stood) is stood at the scale, health and blow");
  ok(method(mobile, 'rescaleBody\\(this, this\\.baseHp, scale\\);\\s*this\\.blow = this\\.baseBlow \\* scale;'), 'and moved with the knob, keeping its share of health, its blow with it');
  ok(/this\.dead = false;\s*this\.deadTimer = 0;\s*this\.hp = this\.maxHp;/.test(mobile), 'and comes back from a death at its whole at the scale');
  ok(method(manager, 'applyDifficultyTo\\(this\\.live, scale\\);'), 'the mobiles manager tells every body out, the standing people and the lairs\' creatures among them');
  ok(/maxHp = scaledByDifficulty\(HP\);\s*hp = this\.maxHp;/.test(npcs) && (npcs.match(/scaledByDifficulty\(/g) ?? []).length >= 4, "a fighter's health and every blow it lands, gun and blade alike");
  ok(method(npcs, 'rescaleBody\\(this, HP, scale\\);') && method(npcs, 'applyDifficultyTo\\(this\\.npcs, scale\\);'), 'and every fighter out moves with the knob, keeping its share, never healed to full');
  ok(/this\.maxHp = scaledByDifficulty\(def\.hp\);\s*this\.hp = this\.maxHp;/.test(creatures) && method(creatures, 'rescaleBody\\(this, this\\.def\\.hp, scale\\);') && method(creatures, 'applyDifficultyTo\\(this\\.creatures, scale\\);'), 'the old wildlife is stood at the scale and moves with it');
  ok(/\n\s*this\.hp = this\.maxHp;\s*this\.stunned = 0;/.test(creatures) && !/this\.hp = this\.def\.hp/.test(creatures), "and comes back from a death at its whole at the scale, never the planet's own number (twice its bar at a half)");
  ok(/foe\.damage\(scaledByDifficulty\(this\.def\.damage\)/.test(creatures) && /onAttack\(scaledByDifficulty\(this\.def\.damage\)/.test(creatures), 'and bites at the scale, whoever it bites');
  ok(/this\.maxHp = scaledByDifficulty\(hp\);\s*this\.hp = this\.maxHp;/.test(nest) && method(nest, 'rescaleBody\\(this, this\\.baseHp, scale\\);'), 'a nest is built at the scale and moves with it');
  ok(/for \(const rec of this\.standing\.values\(\)\) rec\.nest\?\.applyDifficulty\(scale\);/.test(wild), 'and the wild world tells every nest standing (tried for real above)');
  ok(/applyDifficulty\(\): void \{\s*const scale = DIFFICULTY\.scale;\s*this\.mobiles\?\.applyDifficulty\(scale\);\s*this\.npcs\?\.applyDifficulty\(scale\);\s*this\.creatures\?\.applyDifficulty\(scale\);\s*wildLife\.applyDifficulty\(scale\);/.test(world), 'the world walks every kind of body it stands, and the nests, when the knob moves');
  ok(/case 'difficulty':\s*(?:\/\/[^\n]*\n\s*)*setDifficulty\(S\.difficulty\);\s*this\.world\.applyDifficulty\(\);/.test(main), 'the slider moves it live');
  ok(/setDifficulty\(S\.difficulty\);/.test(main.slice(0, main.indexOf('private applySetting'))), 'and the kept value is in force before anything is stood');
  ok(/difficulty: \(x\?: number\) => \{/.test(main), 'and the console has `__debug.difficulty(x)`');
  ok(menu.includes("page === 'gameplay'") && (menu.split('data-page="gameplay"').length - 1) >= 2 && /const all = \[[^\]]*GAMEPLAY/.test(menu), 'the menu builds the Gameplay page, has two ways to it, and wires its knob');
  ok(!/difficulty/i.test(player), "and the player's own numbers never read it");
}

console.log(`\n${passed} checks passed`);
