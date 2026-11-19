// The page's address (the GPU port's pass 1, wave 1, item 11): `addressKept` in src/core/address.ts takes `planet`, `zone`
// and `class` off an old link and leaves every other switch exactly as it was typed; the game writes the address only
// through it (`App.updateUrl`), and the boot no longer reads `?class=`. And nothing else relies on the old address: the
// launcher's own link, the renderer's switch, the server's word and the README.
//
// Everything here is synthetic: made-up addresses. Run: node tools/swg/tests/address.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { addressKept, DROPPED_SWITCHES } from '../../../src/core/address.ts';
import { GPU, readRendererSwitch } from '../../../src/core/gpuSwitch.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const text = (rel: string) => readFileSync(join(REPO, rel), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- 1. the rule
{
  ok(DROPPED_SWITCHES.join() === 'planet,zone,class', 'the three switches the select screen took over, and no others');
  ok(addressKept('?planet=kashyyyk&zone=main&class=jedi') === '', 'the old address of an arrival comes off whole');
  ok(addressKept('?planet=naboo&renderer=webgl&class=bounty_hunter') === '?renderer=webgl', 'a renderer asked on the link stays on it');
  ok(addressKept('?server=ws%3A%2F%2F10.0.0.2%3A8787&word=kessel&planet=lok') === '?server=ws%3A%2F%2F10.0.0.2%3A8787&word=kessel', "a server and its word stay, their escapes as typed (the old address dropped them at the first arrival)");
  ok(addressKept('?norevz&planet=lok&lowfx=1') === '?norevz&lowfx=1', 'a switch typed without a value keeps no value, and the order is kept');
  ok(addressKept('?a=1&planet=2&b=3&zone=4&c=5&class=6') === '?a=1&b=3&c=5', 'every other part, in its order');
  ok(addressKept('?lowfx=1') === '?lowfx=1' && addressKept('?server=ws://h:8787') === '?server=ws://h:8787', 'an address with none of the three comes back as it was given');
  ok(addressKept('') === '' && addressKept('?') === '', 'and an empty one is empty');
  ok(addressKept('planet=lok&shadowStrays=1') === '?shadowStrays=1', 'with or without its question mark');
  ok(addressKept('?pl%61net=lok&cl%61ss=jedi&x=1') === '?x=1' && addressKept('?class&x=1') === '?x=1', 'a name is read as the browser reads it: escaped, or with no value, it is still the switch');
  ok(addressKept('?Planet=lok&planetary=1&classic=2') === '?Planet=lok&planetary=1&classic=2', 'and only those names: another case or a longer word is somebody else\'s switch');
  ok(addressKept('?%E0%A4%A=1&planet=x') === '?%E0%A4%A=1', 'a name that will not decode is kept as typed rather than throwing');
}

// ---------------------------------------------------------------- 2. the game writes the address through it, and reads no class
{
  const main = text('src/main.ts');
  const body = /  private updateUrl\(\): void \{\n([\s\S]*?)\n  \}/.exec(main)?.[1] ?? '';
  ok(/const next = addressKept\(location\.search\);/.test(body) && /if \(next === location\.search\) return;/.test(body) && /history\.replaceState\(history\.state, '', `\$\{location\.pathname\}\$\{next\}\$\{location\.hash\}`\);/.test(body), '`updateUrl` writes `addressKept` of the address, and only when that differs from it');
  ok(!/\?planet=\$\{|&class=\$\{|&zone=\$\{|&renderer=\$\{/.test(main), 'nothing writes a planet, a zone, a class or the renderer into the address any more');
  ok(!/params\.get\('class'\)|get\('planet'\)|get\('zone'\)/.test(main), 'and nothing reads one: `?class=` no longer picks the kit');
  ok(/    this\.setClass\('jedi'\);\n    this\.select\.show\(loadCharacters\(\)\);/.test(main), 'the boot stands the Jedi kit until a character is chosen');
  ok(/    this\.setClass\(c\.class\);\n/.test(main), "and the chosen character's own saved kit decides when it is played");
  ok((main.match(/this\.updateUrl\(\);/g) ?? []).length >= 1 && /import \{ addressKept \} from '\.\/core\/address\.ts';/.test(main), 'the address module is the one the game imports');
}

// ---------------------------------------------------------------- 3. nothing else relies on the old address
{
  // The launcher opens the game with a server and a word, which the game now keeps.
  const launcher = text('tools/launcher/main.mjs');
  ok(/\?server=/.test(launcher) && !/[?&](planet|class|zone)=/.test(launcher), "the launcher's link carries a server and a word, never a planet or a class");
  const link = new URL('http://127.0.0.1:47031/?server=ws%3A%2F%2F10.0.0.2%3A8787&word=kessel');
  ok(addressKept(link.search) === link.search, 'and the game leaves that link exactly as the launcher wrote it');
  // The renderer's switch is read at boot from the address as typed, before the game writes it, and a typed renderer
  // stays: the switch reads the same after the old words come off.
  readRendererSwitch('?planet=naboo&renderer=webgl&class=jedi');
  const before = `${GPU.asked}/${GPU.how}`;
  readRendererSwitch(addressKept('?planet=naboo&renderer=webgl&class=jedi'));
  ok(before === 'webgl/address' && `${GPU.asked}/${GPU.how}` === before, `the renderer's switch reads the same address with or without them (${before})`);
  // The server and the session read their own switches by name.
  ok(/new URLSearchParams\(location\.search\)\.get\('server'\)/.test(text('src/net/net.ts')) && /\.get\('word'\)/.test(text('src/net/session.ts')), 'the server and its word are read by their own names');
  const server = ['server/relay.mjs', 'server/identity.mjs', 'server/wire.mjs'].map(text).join('\n');
  ok(!/[?&](planet|class)=/.test(server), 'the server reads no address of the page at all');
  const readme = text('README.md');
  ok(!/`\?planet=|`\?class=bounty/.test(readme.replace(/an old link's `\?planet=`, `\?zone=` and `\?class=`/, '')), 'the README offers neither switch any more, and says an old link\'s three are taken off');
  ok(/an old link's `\?planet=`, `\?zone=` and `\?class=` are taken off it and pick nothing/.test(readme), 'in those words');
  ok(!/\?planet=gallery/.test(text('src/main.ts')) && !/\?planet=gallery/.test(text('tools/swg/cli.mjs')), "nor do the gallery's hints, which point at the galaxy map's travel instead");
}

console.log(`\naddress: ${checks} checks passed`);
