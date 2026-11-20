// The action bar and the use prompt's look (the interface rewrite's second wave, items 7 and 8): what only the browser
// shows, pinned as text from the stylesheet the game ships (`src/ui/hud.css`), the markup the display builds
// (`src/ui/hud.ts`, `src/ui/prompt.ts`), and the Interface page's two new switches with their wiring in `src/main.ts`,
// which node cannot run and so reads as text. The writes and the cooldown's model are driven against stand-ins in
// `hudWrites.test.ts` and `promptRules.test.ts`; the twelve-process allocation measure of a frame with a fill running is
// `hudBars.test.ts`'s.
//
// Everything here is the game's own text and tables; nothing is read from the game's files. Run: node tools/swg/tests/hudKit.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const text = (rel: string) => readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const css = text('src/ui/hud.css');
const hud = text('src/ui/hud.ts');
const prompt = text('src/ui/prompt.ts');
const main = text('src/main.ts');
/** A rule's block in the stylesheet, by its selector as written. */
const block = (selector: string): string => new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\#:]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';

const { HUD_SIZES } = await import('../../../src/ui/hudMath.ts');
const { DEFAULT_SETTINGS, HUD_SLOT_LINES } = await import('../../../src/core/settings.ts');
const { INTERFACE } = await import('../../../src/ui/hudPage.ts');
const S = HUD_SIZES;

// ---------------------------------------------------------------- 7. the action bar
{
  ok(S.slotSize === 36 && S.slotW === 32 && S.slotGlyph === 20 && S.slotSize < 40 && S.slotGlyph < 28, `cells and marks smaller than they were: ${S.slotW} by ${S.slotSize}, the mark ${S.slotGlyph} (were 40 square and 28)`);
  ok(S.slotLineShare === 0.8 && S.pressInSeconds === 0.08 && S.pressOutSeconds === 0.2 && S.readyFlashSeconds === 0.33 && S.readyFlashGlow === 0.25 && S.coolDark === 0.6, "the second wave's defaults: lines at 80%, a press in over 80 ms and out over 200, the flash a third of a second a quarter brighter, the cooldown's dark the old wedge's 60%");
  const bar = block('.slots');
  ok(/background: var\(--plate\);/.test(bar) && /border-radius: calc\(var\(--hud-slot-radius, 6\) \* 1px \* var\(--hud-scale\)\);/.test(bar) && /overflow: hidden;/.test(bar) && !/gap:/.test(bar), 'one bar of the plate colour it was, slightly rounded, its cells touching');
  const cell = block('.slot');
  ok(/isolation: isolate;/.test(cell) && /flex-direction: column;/.test(cell) && !/border:/.test(cell) && !/background:/.test(cell), "each cell a layer of its own, mark over key, with no border or plate of its own (the bar's is the one)");
  ok(/\.slot \+ \.slot::before \{[^}]*height: calc\(var\(--hud-slot-line, 0\.8\) \* 100%\);[^}]*background: var\(--edge\);/.test(css) && /#hud\.lines-full \.slot \+ \.slot::before \{ top: 0; height: 100%; \}/.test(css), "a line between two cells at 80% of the bar's height, the full height while the display wears the switch's class");
  ok(/\.slot \.key \{\s*position: relative;[^}]*font-size: calc\(var\(--hud-slot-key, 9\)/.test(css) && !/\.slot \.key \{[^}]*text-shadow/.test(css), 'the key under the mark inside the bar, in flow, no hard outline');
  ok(!/\.slot \.cost|class="cost"|saberCost/.test(css + hud), 'no cost and no on or off word anywhere: the bar carries no numbers');
  ok(/el\.setAttribute\('title', s\.name\);/.test(hud) && /saber\.setAttribute\('title', 'Lightsaber'\);/.test(hud), "the ability's name still shows on hover (the cell's title)");
  ok(/\.slot:not\(\.ready\) > \.veil \{ transform: scaleY\(1\); \}/.test(css) && /\.slot > \.veil \{[^}]*color-mix\(in srgb, var\(--void\) calc\(var\(--hud-cool-dark, 0\.6\) \* 100%\), transparent\);[^}]*transform-origin: center top;[^}]*transform: scaleY\(0\);/.test(css), 'a cooldown darkens the whole cell the moment it is no longer ready');
  ok(/\.slot\.cool > \.veil \{ animation: hud-cool calc\(var\(--cool-s, 1\) \* 1s\) linear calc\(var\(--cool-at, 0\) \* -1s\) both; \}/.test(css) && /@keyframes hud-cool \{\s*from \{ transform: scaleY\(1\); \}\s*to \{ transform: scaleY\(0\); \}\s*\}/.test(css), "and its own colour fills back up from the bottom over the cooldown's time: one animation, its length and how far in it begins two properties");
  ok(/\.slots\.paused \.slot\.cool > \.veil \{ animation-play-state: paused; \}/.test(css), 'while the game stands still the fills hold, as the kit\'s cooldowns do');
  ok(/\.slot\.flash > \.glow \{ animation: hud-ready var\(--hud-ready-flash, 0\.33s\) ease-in-out; \}/.test(css) && /@keyframes hud-ready \{\s*0% \{ opacity: 0; \}\s*50% \{ opacity: var\(--hud-ready-glow, 0\.25\); \}\s*100% \{ opacity: 0; \}\s*\}/.test(css), 'ready: a short brighter flash, eased in and out, once as its class comes on');
  ok(/\.slot::after \{[^}]*background: var\(--void\);[^}]*opacity: 0;[^}]*transition: opacity var\(--hud-press-out, 0\.2s\) ease-out;/.test(css) && /\.slot\.pressed::after \{\s*opacity: var\(--hud-press-dark, 0\.45\);\s*transition: opacity var\(--hud-press-in, 0\.08s\) ease-in;\s*\}/.test(css), 'a press darkens the cell in a short ease and it comes back in a longer one');
  ok(!/conic-gradient/.test(css) && !/--cool,/.test(css) && !/setVar\(cell\.root, '--cool'/.test(hud), 'the turning wedge is gone');
  ok(/<i class="veil"><\/i><i class="glow"><\/i><svg class="ic"/.test(hud) && /<span class="key">\$\{esc\(key\)\}<\/span>`/.test(hud), "a cell's markup: the veil, the flash's light, the mark and the key, and nothing else");
}

// ---------------------------------------------------------------- 8. the use prompt
{
  const bar = block('.hud-acts');
  ok(/background: color-mix\(in srgb, var\(--panel\) calc\(var\(--hud-prompt-bg, 0\.5\) \* 100%\), transparent\);/.test(bar) && /border-radius: calc\(var\(--hud-prompt-radius, 8\)/.test(bar) && !/border:/.test(bar) && S.promptStrength === 0.5, 'one rounded see-through bar, the panel colour at about half strength, no border');
  ok(/opacity: 0;/.test(bar) && /transition: opacity var\(--hud-prompt-out, 0\.2s\) ease-in, width var\(--hud-prompt-width, 0\.18s\) ease;/.test(bar) && /\.hud-acts\.on \{\s*opacity: 1;\s*transition: opacity var\(--hud-prompt-in, 0\.15s\) ease-out, width var\(--hud-prompt-width, 0\.18s\) ease;\s*\}/.test(css), 'it fades in over about 150 ms and out over about 200, its width easing either way');
  ok(/width: var\(--hud-acts-w, auto\);/.test(bar) && /overflow: hidden;/.test(bar) && /\.hud-acts-in \{[^}]*width: max-content;/.test(css) && /new RO\(\(\) => this\.fit\(\)\)\.observe\(this\.row\)/.test(prompt) && /setProperty\('--hud-acts-w', `\$\{w\}px`\)/.test(prompt), "its width eases to its row's own, told it after the browser has laid the row out");
  ok(/\.hud-act > \.face \{[^}]*transition: opacity var\(--hud-prompt-swap, 0\.15s\) linear;/.test(css) && /\.hud-act > \.face\.b,\s*\.hud-act\.flip > \.face\.a,\s*\.hud-act\.none > \.face \{[^}]*position: absolute;[^}]*opacity: 0;/.test(css) && /\.hud-act\.flip:not\(\.none\) > \.face\.b \{\s*position: static;[^}]*opacity: 1;/.test(css), "a change of words cross-fades two faces, the one going out of the row's flow so the width eases to the one coming in");
  ok(/\.hud-act \+ \.hud-act:not\(\.none\)::before \{[^}]*height: calc\(var\(--hud-slot-line, 0\.8\) \* 100%\);[^}]*background: var\(--edge\);/.test(css) && /\.hud-acts\.lines-full \.hud-act \+ \.hud-act:not\(\.none\)::before \{ top: 0; height: 100%; \}/.test(css), "the action bar's thin lines between the actions, at the same height and by the same switch");
  const cap = block('.hud-cap');
  ok(/background: color-mix\(in srgb, var\(--ink\) calc\(var\(--hud-prompt-cap, 0\.12\) \* 100%\), transparent\);/.test(cap) && !/border:/.test(cap), 'the key in a small soft cap slightly lighter than the bar, no hard border');
  ok(/\.hud-act \.label \{ color: color-mix\(in srgb, var\(--ink\) calc\(var\(--hud-prompt-ink, 0\.85\) \* 100%\), transparent\); \}/.test(css) && S.promptInk === 0.85, 'the words in ink at about 85%');
  // Rule 2's own list (the selectors after its comment, up to its block), which the cap and the words have left.
  const rule2 = css.slice(css.indexOf('rule 2, for words'));
  const outlined = rule2.slice(rule2.indexOf('*/') + 2, rule2.indexOf('{'));
  ok(/\.hud-msg,/.test(outlined) && /text-shadow: 1px 0 0 var\(--void\)/.test(rule2.slice(rule2.indexOf('{'), rule2.indexOf('}'))) && !/hud-cap|hud-act/.test(outlined), 'and neither the cap nor the words carry the hard outline round each letter');
  ok(/\.hud-acts\.quiet \{\s*--hud-acts-s: calc\(var\(--hud-scale\) \* var\(--hud-prompt-quiet-size, 0\.9\)\);\s*bottom: calc\(var\(--hud-prompt-quiet-bottom, 168\) \* 1px \* var\(--hud-scale\)\);\s*\}/.test(css) && /\.hud-acts\.on\.quiet \{ opacity: var\(--hud-prompt-quiet, 0\.6\); \}/.test(css) && S.promptQuiet === 0.6 && S.promptQuietBottom > 159 && /\.prompt \{[^}]*bottom: calc\(200px \* var\(--hud-scale\)\);/.test(css) && S.promptQuietBottom + 26 * S.promptQuietSize < 200, 'aboard and in vehicles the same bar, quieter (about 60%), a little smaller, and raised clear of the flight display (its condition reaches 159 in the browser), the long line above it');
  ok(/left: 50%;/.test(bar) && /transform: translateX\(-50%\);/.test(bar) && !/\.align-(left|right)[^{]*\.hud-acts/.test(css), 'centred, in the same place whichever of its three places the block stands in');
  ok(/\.hud-acts\.blur \{ backdrop-filter: blur\(calc\(var\(--hud-prompt-blur, 6\) \* 1px\)\); \}/.test(css) && /#hud\.prompt-blur \.prompt \{ backdrop-filter: blur\(calc\(var\(--hud-prompt-blur, 6\) \* 1px\)\); \}/.test(css), 'the soft blur behind it is a class, and the long line takes it too');
  const line = block('.prompt');
  ok(/background: color-mix\(in srgb, var\(--panel\) calc\(var\(--hud-prompt-bg, 0\.5\) \* 100%\), transparent\);/.test(line) && !/border:/.test(line) && /color: color-mix\(in srgb, var\(--ink\) calc\(var\(--hud-prompt-ink, 0\.85\) \* 100%\), transparent\);/.test(line) && /animation: hud-prompt-up var\(--hud-prompt-in, 0\.15s\) ease-out;/.test(line) && /\.prompt b \{[^}]*background: color-mix\(in srgb, var\(--ink\) calc\(var\(--hud-prompt-cap, 0\.12\) \* 100%\), transparent\);/.test(css), 'the long "Full prompts" line takes the same look: the bar, the ink, its keys in the soft cap, fading in as it comes up');
  ok(/this\.root\.className = 'hud-acts';/.test(prompt) && /el\.className = 'hud-act none';/.test(prompt) && /face\('face a'\)/.test(prompt) && /face\('face b'\)/.test(prompt), "the bar's markup: a row of cells, each with two faces, out of the row until it has something to say");
}

// ---------------------------------------------------------------- the two switches, and their wiring
{
  const knobs = INTERFACE.flatMap((g) => g.knobs);
  const D = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
  const lines = knobs.find((k) => k.key === 'hudSlotLines');
  const blur = knobs.find((k) => k.key === 'hudPromptBlur');
  ok(!!lines && lines.kind === 'choice' && lines.choices!.map((c) => c.value).join() === HUD_SLOT_LINES.join() && D.hudSlotLines === 'short', "the lines' switch is a choice on the Interface page offering exactly the words the game takes, at 80% to begin with");
  ok(!!blur && blur.kind === 'toggle' && D.hudPromptBlur === false, 'the blur is a switch on it, off to begin with');
  const apply = /private applyHudSettings\(\): void \{([\s\S]*?)\n  \}/.exec(main)?.[1] ?? '';
  ok(/const linesFull = oneOf\(S\.hudSlotLines, HUD_SLOT_LINES, 'short'\) === 'full';/.test(apply) && /this\.hud\.setKitLook\(linesFull, S\.hudPromptBlur\);/.test(apply) && /this\.actions\.setLook\(linesFull, S\.hudPromptBlur\);/.test(apply), 'the game hands both bars the two switches whenever the settings are applied');
  const change = /case 'hudTrackerInFlight':([\s\S]*?)this\.applyHudSettings\(\);/.exec(main)?.[1] ?? '';
  ok(change.includes("case 'hudSlotLines':") && change.includes("case 'hudPromptBlur':"), 'and each applies them the moment it is moved on the page');
  ok(/\['promptBlur', 'hudPromptBlur'\]/.test(main) && /\['slotLines', 'hudSlotLines', HUD_SLOT_LINES\]/.test(main), '`__debug.hud({ promptBlur, slotLines })` sets them as the page does');
  ok(/if \(!hudOff\) this\.hud\.setLive\(simulate\);\n\s+if \(hudOff\) this\.hud\.rest\(\);\n\s+else \{\n\s+this\.hud\.setStamina\(/.test(main), 'the frame tells the display whether the game runs, before its update, so a pause holds the fills');
}

console.log(`\n${checks} checks passed`);
