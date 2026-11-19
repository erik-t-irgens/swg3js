// The class words gone (the GPU port's pass 1, wave 1, item 10): no "Jedi" or "Bounty Hunter" put on the screen as the
// character's class in ordinary play -- the display's kit name, the creator's Class choice, the select screen's line
// and its card's row -- while a new character is made with the Jedi kit, C still switches the kit, and a character saved
// with the Bounty Hunter's keeps it. The display is driven against a stand-in page that keeps every word written to it;
// the screens that cannot be built in node (the select screen, the creator's bar, the game) are read as text.
//
// Everything here is synthetic. Run: node tools/swg/tests/classWords.test.ts
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const text = (rel: string) => readFileSync(join(REPO, rel), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- a stand-in page that keeps every word written
const said: string[] = [];
type Any = any;
function el(): Any {
  const found = new Map<string, Any>();
  const e: Any = {
    style: new Proxy({ setProperty() {} } as Record<string, Any>, { set: () => true, get: (t, k) => t[String(k)] ?? '' }),
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    setAttribute(_k: string, v: string) {
      said.push(String(v));
    },
    appendChild: (k: Any) => k,
    append() {},
    querySelector(sel: string) {
      let hit = found.get(sel);
      if (!hit) found.set(sel, (hit = el()));
      return hit;
    },
    querySelectorAll: () => [],
  };
  for (const k of ['textContent', 'innerHTML', 'className', 'title']) {
    let v = '';
    Object.defineProperty(e, k, {
      get: () => v,
      set: (x) => {
        v = String(x);
        said.push(v);
      },
    });
  }
  let hidden = false;
  Object.defineProperty(e, 'hidden', { get: () => hidden, set: (x) => (hidden = !!x) });
  return e;
}
(globalThis as Any).document = { createElement: () => el(), documentElement: el() };
const { Hud } = await import('../../../src/ui/hud.ts');

/** A kit as the game hands it to the display, under its own name. */
function kitNamed(id: string, name: string): Any {
  return {
    id,
    name,
    slots: [{ key: '1', name: 'Thermal Detonator', cost: '1' }],
    resource: id === 'jedi' ? { label: 'Force', value: 50, max: 100 } : null,
    slotActive: () => false,
    slotCooldown: () => 0,
    charge: () => 0,
  };
}

// ---------------------------------------------------------------- 1. the display never writes the kit's name
{
  const hud = new Hud(el());
  for (const [id, name] of [['bounty_hunter', 'Bounty Hunter'], ['jedi', 'Jedi']]) {
    said.length = 0;
    const kit = kitNamed(id, name);
    hud.setKit(kit);
    for (let i = 0; i < 40; i++) hud.update(0.016, 1, 2, 3, kit, 80, 100, '12:00', '', false);
    const named = said.filter((w) => w.includes(name));
    ok(said.length > 0 && named.length === 0, `the display, handed the ${name} kit, writes ${said.length} things and never its name (${named.join(' | ') || 'none'})`);
  }
  const hudSrc = text('src/ui/hud.ts');
  ok(!/kit\.name|class-name|className\.textContent/.test(hudSrc), 'it has no element for the class and reads no kit name');
  ok(!/\.class-name\b/.test(text('src/style.css')), "and the page's rule for that element is gone");
}

// ---------------------------------------------------------------- 2. the creator, the select screen, the game
{
  const creator = text('src/ui/creatorBar.ts');
  ok(!/<select class="class">|Class <select|>Jedi<|>Bounty Hunter</.test(creator) && /onCreate: \(name: string, planet: string\) => void/.test(creator), "the creator's bar offers no class: a name and a world");
  const main = text('src/main.ts');
  ok(/const NEW_CHARACTER_KIT: ClassId = 'jedi';/.test(main) && /this\.creatorBar\.onCreate = \(name, planet\) => void this\.finishCreation\(name, NEW_CHARACTER_KIT, planet\)/.test(main), 'a new character is made with the Jedi kit');
  ok(/if \(input\.pressedAction\('switchClass'\)\) this\.setClass\(this\.kit\.id === 'jedi' \? 'bounty_hunter' : 'jedi'\);/.test(main), 'C still switches the kit, for testing');
  ok(/    this\.setClass\(c\.class\);\n/.test(main) && /class: cls,\n/.test(main), "a character keeps the kit it was saved with, the Bounty Hunter's included, and a new one's record carries the kit it was made with");
  const select = text('src/ui/characterSelect.ts');
  ok(!/classWords|cs-classline|\['Class',/.test(select), "the select screen's list line and its card name no class, and its card has no Class row");
  ok(/<span class="cs-entry-line">\$\{escapeHtml\(prettySpecies\(c\.species\)\)\}<\/span>/.test(select), 'its list line is the species alone');
  ok(/<b>H<\/b> hide the interface/.test(select) && !/<b>H<\/b> help/.test(select), "and its key line says what H does now");
  ok(!/cs-classline/.test(text('src/style.css')), "the class line's rules are gone with it");
}

// ---------------------------------------------------------------- 3. nowhere else in ordinary play
// Every string the interface writes, in every file under src/ui/, searched for either class's name standing as words. What
// is left is named, with why it is not the character's class in ordinary play: nothing (the Controls page's line for C is the
// developer's and names no class; the Interface page's crosshair switch, 'Crosshair as a Jedi', is named by what it is for).
// Jedi Academy, the other game, is a name and not a class.
{
  const dir = join(REPO, 'src', 'ui');
  const hits: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
    const lines = text(`src/ui/${f}`).split('\n');
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      for (const m of line.matchAll(/(['"`])((?:(?!\1).)*?)\1/g)) {
        const s = m[2];
        if (/\bBounty Hunter\b|\bJedi\b/.test(s) && !/Jedi Academy/.test(s)) hits.push(`${f}:${i + 1}: ${s.slice(0, 80)}`);
      }
    });
  }
  const allowed: RegExp[] = [];
  const left = hits.filter((h) => !allowed.some((a) => a.test(h)));
  ok(left.length === 0, `no string of the interface names either class (${left.join(' | ') || 'none'}); left on purpose: ${hits.filter((h) => !left.includes(h)).join(' | ') || 'nothing'}`);
  ok(/switchClass: 'Switch class \(developer\)',/.test(text('src/ui/menu.ts')), "the Controls page's line for C is the developer's, as the brief has it");
  ok(/key: 'hudJediCrosshair', label: 'Crosshair with the saber and the Force',/.test(text('src/ui/hudPage.ts')), 'the Interface page names its crosshair switch by what it is for, the saber and the Force, its setting as it was');
}

console.log(`\nclassWords: ${checks} checks passed`);
