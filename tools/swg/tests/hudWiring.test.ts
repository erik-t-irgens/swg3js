// The wiring: that every piece of the display is actually reached by the game, and that the two
// walks it used to do every frame are off the frame path.
//
// The other tests in this group drive their own module against a stand-in and prove what it does.
// Nothing can drive `src/main.ts` that way — it reaches for a WebGL context, a physics world and a
// renderer in its constructor — so what is checked here is the one thing that can be: that the calls
// exist, in the file, in the shape the pieces need. That sounds thin until you count the ways this
// pass could quietly do nothing: a new setting with no case in `applySetting` never reaches the
// screen, a module built and never drawn shows nothing at all, a line of the test script left out
// means a whole file of checks is run by no one (which is exactly what happened once before), and a
// gather moved back onto the frame path costs the frame rate without changing a pixel.
//
// So this reads `src/main.ts`, `src/core/settings.ts`, `src/ui/hudPage.ts` and `package.json` as
// text and asks those questions of them. Nothing here is read from the game's own archives and no
// browser is needed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const main = read('src/main.ts');
const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

// --- every display setting reaches something -----------------------------------------------------
// `loadSettings` keeps a key whose type matches, the menu writes it, and `applySetting` is what turns
// a written key into a change on the screen. A key with no case there is a switch that does nothing
// until the page is reloaded, which is the sort of fault nobody notices from a hidden tab.
{
  const settings = read('src/core/settings.ts');
  const page = read('src/ui/hudPage.ts');
  const keys = [...settings.matchAll(/^\s+(hud[A-Za-z]+):/gm)].map((m) => m[1]);
  const unique = [...new Set(keys)];
  ok(unique.length >= 12, `the settings file declares the display's keys (${unique.length} found)`);
  for (const key of unique) {
    ok(main.includes(`case '${key}':`), `${key} has a case in applySetting`);
    ok(page.includes(`key: '${key}'`), `${key} has a knob on the Interface page`);
  }
}

// --- everything built is also drawn, cleared and emptied ------------------------------------------
// Each of these is a module this file owns the wiring of. A module that is made and never drawn is
// invisible; one that is never idled leaves what it drew standing over the death card, which the
// design names as the exact fault to avoid; one that is never cleared survives a travel.
{
  for (const [made, drawn] of [
    ['new ActionBar(', 'this.actions.set('],
    ['new HudFeedback(', 'this.feedback.draw('],
    ['new Nameplates(', 'this.plates.track('],
  ]) {
    ok(main.includes(made), `${made.slice(4, -1)} is built`);
    ok(main.includes(drawn), `${made.slice(4, -1)} is driven (${drawn})`);
  }
  for (const stop of ['this.feedback.idle()', 'this.hud.idle()', 'this.actions.clear()', 'this.plates.clear()', 'this.feedback.clear()']) {
    ok(main.includes(stop), `${stop} is called`);
  }
  // The overlay's own pieces: the on-foot crosshair and the damage shapes go through the same canvas,
  // so both must be attached to it or they draw nothing at all and say nothing about it.
  ok(main.includes('this.hud.attach(this.overlay, COL)'), 'the on-foot display is attached to the overlay');
  ok(main.includes('this.feedback.attach(this.overlay, COL)'), 'the damage feedback is attached to the overlay');
  // The keys on the slot caps: read once from the bindings and again when the Controls page moves one.
  ok(main.includes('this.hud.setInput(this.input)'), 'the display is given the bindings');
  ok(main.includes('onBindingsChanged(hudBindingsChanged)'), 'a rebind reaches the slot caps');
  ok(main.includes('this.actions.setBindings(this.input.bindings)'), 'the action bar is given the bindings');
}

// --- the two walks are off the frame path ---------------------------------------------------------
// Both of these used to run on every frame for a readout written a few times a second. Each is now
// behind a clock of its own; the shape checked is the clock, because that is what a later edit would
// take out by accident.
{
  for (const clock of ['this.promptClock -= rawDt', 'this.nearbyClock -= rawDt']) {
    ok(main.includes(clock), `${clock.split(' ')[0].trim()} counts down on the real clock`);
  }
  // Exactly one place asks for the nearest living thing's name, and it is inside the clock's branch.
  const nearby = [...main.matchAll(/this\.nearbyLabel\(/g)].length;
  ok(nearby === 1, `nearbyLabel is called from one place, not the frame (${nearby})`);
  const after = main.slice(main.indexOf('this.nearbyClock -= rawDt'));
  ok(after.indexOf('this.nearbyLabel(') < after.indexOf('this.hud.update('), 'the name is found inside the clock, before the display is written');
  // The conditions the long prompt used to ask for every frame are asked for in the gather and
  // nowhere else on the frame path. `elevatorsNear` was the worst of them: twice on one line, to
  // test and then to read. There are two uses left in the file — the gather, and the key that rides
  // the lift — and neither of them is written into the prompt line.
  const gatherAt = main.indexOf('private gatherPrompt(');
  ok(gatherAt > 0, 'the state is gathered in one place');
  // The method's real end, not a guessed length. It was 4,500 characters, which is a bound on how
  // much may be *written* rather than on what is being asked, and three separate changes have now
  // failed this check by adding a comment rather than by moving a call out of the gather. A method
  // ends at the first line that closes a brace at the class's own indent.
  // The line endings are the working copy's, so the closing brace is matched rather than spelled.
  const closes = /\r?\n {2}\}\r?\n/.exec(main.slice(gatherAt));
  ok(!!closes, "and the gather's own end is found rather than assumed");
  const gather = main.slice(gatherAt, gatherAt + (closes?.index ?? 0));
  ok(gather.includes('this.world.elevatorsNear('), 'the gather asks for the elevators near');
  ok(gather.includes('this.liftHere()'), 'the gather asks for the lift underfoot');
  ok(gather.includes('this.world.doorlessNear('), 'the gather asks for the doorless building near');
  ok(gather.includes('this.nearestVehicle()'), 'the gather asks for the nearest vehicle, once');
  ok(gather.includes('this.reachFromBoots()'), 'the gather asks what the boots can reach');
  // And the long line, which is the thing that used to do all five on every frame, now reads the
  // struct. If any of these five came back into it the saving would be gone with no other sign.
  const line = main.indexOf('const S8 = this.promptState;');
  ok(line > 0, 'the long prompt line reads the gathered state');
  const chain = main.slice(line, main.indexOf('this.hud.setPrompt(prompt)'));
  for (const asked of ['this.liftHere(', 'elevatorsNear(', 'doorlessNear(', 'nearestVehicle(', 'reachFromBoots(']) {
    ok(!chain.includes(asked), `the long line does not ask for ${asked.replace('this.', '').replace('(', '')} itself`);
  }
}

// --- the blows ------------------------------------------------------------------------------------
// Nine places in the game hurt the player. Every one of them now goes through the one helper that
// flashes the screen and places the arc, so a tenth cannot be added that flashes without a side and
// the direction cannot be lost at one site while the other eight keep it.
{
  const raw = [...main.matchAll(/this\.hud\.hurt\(/g)].length;
  ok(raw === 1, `the red flash is raised from one place (${raw})`);
  const helper = main.indexOf('private hurtFrom(');
  ok(helper > 0, 'that place is hurtFrom');
  ok(main.slice(helper, helper + 1200).includes('this.feedback.hurt('), 'hurtFrom places the arc as well as the flash');
  const sites = [...main.matchAll(/this\.hurtFrom\(/g)].length;
  ok(sites >= 9, `every blow on the player goes through it (${sites} sites, the helper included)`);
  // The two that carry a real direction, which is what makes the arc worth having at all.
  ok(main.includes('this.hurtFrom(from ?? this.hurtSource)'), 'a blow from something alive carries where it stood');
  ok(main.includes('onPlayerHit: (dmg, from)'), "a bolt carries where it was when it reached you");
  // And the hook the other way: what you hurt.
  ok(main.includes('this.world.watchPlayerHits('), 'the blows you land are heard through the world');
}

// --- the test script ------------------------------------------------------------------------------
// Once before, a whole file of checks was run by nothing: it was written and never added here.
// This is the check that cannot be forgotten, since forgetting it is what it tests.
{
  const hud = pkg.scripts['test:hud'] ?? '';
  ok(hud.length > 0, 'there is a test:hud script');
  for (const name of ['palette', 'hudMath', 'messages', 'shipStatus', 'hudWrites', 'hudSettings', 'promptRules', 'hudIcons', 'hudFeedback', 'hudPage', 'hudWiring']) {
    ok(hud.includes(`tests/${name}.test.ts`), `test:hud runs ${name}.test.ts`);
  }
  ok((pkg.scripts['test:all'] ?? '').includes('test:hud'), 'test:all runs test:hud');
}

// --- the invented numbers are reachable ------------------------------------------------------------
// Every number this file invents is said to be invented, kept beside the others of its kind, and
// reachable from the console. The last of those is the one an edit can break silently.
{
  const table = main.slice(main.indexOf('const HUD_WIRING = '), main.indexOf('const HUD_WIRING = ') + 200);
  for (const name of ['gunBits', 'heatIsHeadroom', 'promptHz', 'nearbyHz', 'hurtRange']) {
    ok(table.includes(name), `${name} is in the one table of this file's invented numbers`);
    ok(main.includes(`opts.wiring.${name}`), `${name} can be set from __debug.hud({ wiring: … })`);
  }
  // The other packages' tables are reachable through the same call, which is the whole point of it
  // being one call: a value that cannot be tried cannot be judged from a screen nobody here can see.
  for (const knob of ['opts.feedback', 'opts.prompt', 'opts.plates', 'opts.flight', 'opts.messages', 'opts.sizes']) {
    ok(main.includes(knob), `__debug.hud takes ${knob.slice(5)}`);
  }
}

// --- nothing of a world you have left, and nothing over a panel ------------------------------------
// Each of these is a value that outlives the thing it describes unless it is put back by hand. They
// are checked in the file because none of them can be driven: the frame loop needs a renderer.
{
  // The feedback ages on the real clock and runs through a travel, so a blow landed a moment before
  // one would name the planet left behind. It is cleared where the ship's own display is cleared.
  const arriveAt = main.indexOf('private arrive(');
  ok(arriveAt > 0, 'a planet is arrived at in one place');
  const arrive = main.slice(arriveAt, arriveAt + 1200);
  ok(arrive.includes('this.feedback.clear()'), 'a travel clears the damage feedback');
  // The three readings kept beside the struct: the struct's own reset does not reach them.
  const leaveAt = main.indexOf('private switchToSelect(');
  ok(leaveAt > 0, 'a world is left in one place');
  const leave = main.slice(leaveAt, main.indexOf('this.select.show(', leaveAt));
  for (const field of ["this.nearbyName = ''", 'this.promptLiftStops = 0', "this.promptDoorless = ''", "this.promptGate = ''", 'this.zoneGates.clear()']) {
    ok(leave.includes(field), `${field.split(' ')[0].slice(5)} is put back when a world is left`);
  }
  // Which world's gates these are belongs to the world's own load and not to the prompt gather: the
  // gather runs six early returns deep on the on-foot path, so pointed at from there the key would
  // consult the world left behind for the first frames after every arrival.
  {
    const arriveAt2 = main.indexOf('private arrive(');
    const body = main.slice(arriveAt2, arriveAt2 + 1600);
    ok(body.includes('this.zoneGates.use('), "a world's own gates are pointed at when the world loads");
    const gatherAt = main.indexOf('private gatherGate(');
    ok(gatherAt > 0 && !main.slice(gatherAt, gatherAt + 1600).includes('zoneGates.use('), 'and never from the prompt gather');
  }
  // The plate's switch is asked before the call, not inside it: an "off" switch that still builds the
  // argument list turns nothing off.
  ok(main.includes('if (simulate && this.settings.hudNameplate) {'), 'the plates are not tracked at all with the plate switched off');
  // The long line is written only while the game is simulating. Half of its branches read the
  // eighth-of-a-second struct, which is emptied on the frame the game stops, and half read the
  // player directly: written over a panel the line would disagree with itself.
  ok(main.includes('const full = this.settings.hudFullPrompts && simulate;'), 'the long prompt line is written only while the game simulates');
  ok(main.includes('prompt = this.jumpPrompt('), "a jump's own line still reaches the prompt element");
}

// --- what the bar actually shows, row by row -------------------------------------------------------
// The rules are pure and every input is a plain value, so the whole of the bar can be driven here
// rather than read by hand: each row fills the state exactly as `App.gatherPrompt` fills it for that
// situation, resolves each slot's binding through the game's own defaults and spells the cap with the
// game's own `keyLabel`, including the bar's one-key-one-cap rule. The expected strings are the table
// in the hand-off, which is the point: a cap that changes, a key that moves, an action that stops
// being offered or a fifth that pushes a fourth off the end all fail here instead of being noticed on
// a screen. (They were noticed on no screen: two rows of the hand-derived table were wrong.)
{
  const { fillActions, newPromptActions, newPromptState, resetPromptState } = await import('../../../src/ui/promptRules.ts');
  const { keyLabel } = await import('../../../src/ui/hud.ts');
  // The bindings, read out of the source: `src/core/input.ts` declares a class with a parameter
  // property, which node will not strip, so it cannot be imported. A binding renamed there and not
  // here leaves the bar with a cap it cannot resolve, and this is what fails instead of the screen.
  const BINDINGS: Record<string, string[]> = (() => {
    const src = read('src/core/input.ts');
    const body = /export const DEFAULT_BINDINGS[^{]*\{([\s\S]*?)\n\};/.exec(src);
    assert.ok(body, 'the bindings table was found in src/core/input.ts');
    const out: Record<string, string[]> = {};
    for (const m of body[1].matchAll(/^\s{2}([A-Za-z0-9_]+):\s*\[([^\]]*)\]/gm)) {
      out[m[1]] = m[2]
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    }
    return out;
  })();
  ok(Object.keys(BINDINGS).length > 20, `the bindings table parsed (${Object.keys(BINDINGS).length} actions)`);
  // The one key with no binding of its own. It is read from the file it lives in, so moving it there
  // moves this table with it rather than leaving the bar naming a key nothing presses.
  const cut = /export const CUT_ENGINES_KEY = '([A-Za-z0-9]+)'/.exec(read('src/vehicles/landing.ts'));
  assert.ok(cut, 'the engine-cut key was found');
  const CUT = cut[1];
  ok(keyLabel(CUT) === 'J', `the engine cut's cap is ${keyLabel(CUT)}`);

  const slots = newPromptActions(4);
  const state = newPromptState();
  /** The bar, in words, for a state filled as the gather fills it: the cells the game would show. */
  const bar = (fill: (s: ReturnType<typeof newPromptState>, v: ReturnType<typeof newPromptState>['vehicle']) => void, live = true): string => {
    const s = resetPromptState(state);
    s.live = live;
    fill(s, s.vehicle);
    const n = fillActions(s, slots);
    const seen: string[] = [];
    const parts: string[] = [];
    for (let i = 0; i < n; i++) {
      const a = slots[i];
      const code = a.action ? (BINDINGS[a.action]?.[0] ?? '') : a.code;
      // The bar drops a second action that came to the same key; the rules cannot see that.
      if (code && seen.includes(code)) continue;
      seen.push(code);
      parts.push(`${keyLabel(code)} ${a.label}`);
    }
    return parts.join(' | ');
  };
  type Fill = Parameters<typeof bar>[0];
  const ship = (v: ReturnType<typeof newPromptState>['vehicle'], o: Partial<ReturnType<typeof newPromptState>['vehicle']> = {}) =>
    Object.assign(v, { kind: 'air', ship: true, powered: true, canLand: true, cutKey: CUT }, o);

  const rows: [string, Fill, string][] = [
    // On foot.
    ['nothing about', () => {}, ''],
    ['a speeder in reach', (s) => void (s.near = 'mount'), 'E mount'],
    ['a speeder on its back', (s) => void (s.near = 'flip'), 'E flip it upright'],
    ['a ship with a room in reach', (s) => void (s.near = 'board'), 'E board'],
    ['standing in a lift shaft', (s) => void (s.lift = true), 'E the lift'],
    ['at an elevator, going up', (s) => void (s.elevator = 'up'), 'E up a level'],
    ['at an elevator, going down', (s) => void (s.elevator = 'down'), 'E down a level'],
    ['beside a building with no way in', (s) => void (s.doorless = true), 'E go inside'],
    // A port's three things. This table had no row for any of them, which is exactly why all three
    // wore one word, "the shuttle", for as long as they did.
    ['at a ticket terminal', (s) => void (s.travel = 'terminal'), 'E the ticket terminal'],
    ['at the ticket collector', (s) => void (s.travel = 'collector'), 'E the ticket collector'],
    ['at a ship terminal', (s) => void (s.travel = 'ship'), 'E the ship terminal'],
    ['a terminal and a lift shaft at once', (s) => void ((s.travel = 'terminal'), (s.lift = true)), 'E the lift'],
    // The gate between two of a world's zones. The cap says what happens; where it goes is a place
    // name, which is said on the message line as you come to it and never worn by a cap.
    ['at a gate between two zones', (s) => void (s.gate = 'travel'), 'E through the gate'],
    ['at a gate the pack names nowhere for', (s) => void (s.gate = 'nowhere'), 'E the gate (nowhere)'],
    ['a gate and a speeder at once', (s) => void ((s.gate = 'travel'), (s.near = 'mount')), 'E mount'],
    ['a gate and a lift shaft at once', (s) => void ((s.gate = 'travel'), (s.lift = true)), 'E the lift'],
    ['a gate with the ship menu on offer', (s) => void ((s.gate = 'travel'), (s.shipMenu = 'here')), 'E through the gate | P ship menu'],
    ['a lift shaft and a speeder at once', (s) => void ((s.lift = true), (s.near = 'mount')), 'E the lift'],
    ['noclip', (s) => void (s.noclip = true), 'N noclip off | = faster | - slower'],
    // Aboard a ship's rooms, and out in space on foot.
    ['aboard the rooms', (s) => void (s.aboard = true), 'E step out'],
    ['aboard, at the controls', (s) => void ((s.aboard = true), (s.atControls = true)), 'E take the controls'],
    ['aboard in space', (s) => void ((s.aboard = true), (s.shipMenu = 'here')), 'E step out | P ship menu'],
    ['boots on a surface', (s) => void ((s.boots = true), (s.shipMenu = 'here')), 'E boots off | Space let go | P ship menu'],
    ['boots, a ship beside you', (s) => void ((s.boots = true), (s.bootsReach = true), (s.shipMenu = 'here')), 'E climb in | Space let go | P ship menu'],
    ['adrift', (s) => void ((s.eva = true), (s.shipMenu = 'here')), 'E gravity boots | Q brake | P ship menu'],
    ['adrift beside a ship with a room', (s) => void ((s.eva = true), (s.near = 'board'), (s.shipMenu = 'here')), 'E board | Q brake | P ship menu'],
    // Riding and flying.
    ['a speeder', (s, v) => void ((s.mounted = true), Object.assign(v, { kind: 'ground', airborne: true, hop: true, boost: true })), 'E dismount | Space hop | Shift boost'],
    ['a fighter hovering on a planet', (s, v) => void ((s.mounted = true), ship(v, { airborne: true })), 'E leave | Ctrl bring it down | J cut the engines'],
    ['in flight, wings shut', (s, v) => void ((s.mounted = true), ship(v, { airborne: true, wings: true })), 'E leave | Ctrl bring it down | J cut the engines | U open the wings'],
    ['in flight, wings open', (s, v) => void ((s.mounted = true), ship(v, { airborne: true, wings: true, wingsOpen: true })), 'E leave | Ctrl bring it down | J cut the engines | U close the wings'],
    ['landed', (s, v) => void ((s.mounted = true), ship(v, { landed: true })), 'E leave | W lift off'],
    ['landed, in space', (s, v) => void ((s.mounted = true), (s.shipMenu = 'here'), ship(v, { landed: true, space: true })), 'E leave | W lift off | P ship menu'],
    ['setting down', (s, v) => void ((s.mounted = true), ship(v, { holding: true })), 'E leave'],
    ['high enough for space', (s, v) => void ((s.mounted = true), (s.shipMenu = 'altitude'), ship(v, { airborne: true })), 'E leave | P ship menu | Ctrl bring it down | J cut the engines'],
    ['in space, nothing under it', (s, v) => void ((s.mounted = true), (s.shipMenu = 'here'), ship(v, { airborne: true, space: true, guns: true })), 'E leave | P ship menu | Tab next target'],
    ['in space, something under it', (s, v) => void ((s.mounted = true), (s.shipMenu = 'here'), ship(v, { airborne: true, space: true, setDownNear: true, guns: true })), 'E leave | J set it down | P ship menu | Tab next target'],
    ["at a bridge's controls", (s, v) => void ((s.piloting = true), ship(v, { airborne: true, guns: true })), 'E let go | Ctrl bring it down | J cut the engines | Tab next target'],
    // A jump holds the controls; its own countdown is on the prompt line, not the bar.
    ['the countdown', (s) => void (s.jump = 'waiting'), ''],
    ['the tunnel, at the controls', (s) => void (s.jump = 'piloting'), 'E let go'],
    ['the tunnel, beside the controls', (s) => void (s.jump = 'controls'), 'E take the controls'],
    ['the tunnel, in a lift shaft', (s) => void ((s.jump = 'lift'), (s.lift = true)), 'E the lift'],
  ];
  for (const [name, fill, want] of rows) {
    const got = bar(fill);
    ok(got === want, `${name}: ${got === '' ? '(nothing)' : got}`);
  }
  // A panel, the map, the death card: the state is not live and nothing at all is offered, whatever
  // was underfoot when the game stopped simulating.
  ok(bar((s) => void ((s.near = 'mount'), (s.lift = true)), false) === '', 'a panel, the map, the death card: (nothing)');
}

console.log(`\n${checks} checks passed`);
