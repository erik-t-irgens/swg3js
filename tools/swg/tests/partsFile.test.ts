// A parts pack's `parts.json` fetched and parsed once a folder for the session (src/player/partsFile.ts, the
// performance pass's second wave): two looks of one body asked for together share one fetch, a later one finds it
// parsed, a folder whose fetch failed (or came back as the page) is asked again, two folders are two files, and the
// module imports nothing of the character, which is why it can be tested here at all.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PARTS_FETCH, forgetPartsFiles, partsFile } from '../../../src/player/partsFile.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

const asked: string[] = [];
let answer: 'json' | 'page' | 'missing' | 'throw' = 'json';
PARTS_FETCH.fetch = async (url) => {
  asked.push(url);
  await new Promise((r) => setTimeout(r, 1));
  if (answer === 'throw') throw new Error('offline');
  const json = answer === 'json';
  return {
    ok: answer !== 'missing',
    headers: { get: (name: string) => (name === 'content-type' ? (json ? 'application/json' : 'text/html') : null) },
    json: async () => ({ parts: { body: { url } } }),
  };
};

const DIR = 'http://pack/characters/human_male/';
{
  forgetPartsFiles();
  asked.length = 0;
  const [a, b] = await Promise.all([partsFile(DIR), partsFile(DIR)]);
  ok(asked.length === 1 && asked[0] === `${DIR}parts.json`, 'two looks of one body asked for together share one fetch');
  ok(a !== null && a === b, 'and are handed the one parsed file');
  const c = await partsFile(DIR);
  ok(asked.length === 1 && c === a, 'a later look finds it parsed and fetches nothing');
  await partsFile('http://pack/characters/zabrak_female/');
  ok(asked.length === 2, 'another folder is a file of its own');
}
for (const failure of ['missing', 'page', 'throw'] as const) {
  forgetPartsFiles();
  asked.length = 0;
  answer = failure;
  const first = await partsFile(DIR);
  await new Promise((r) => setTimeout(r, 0));
  ok(first === null, `a folder whose file is ${failure === 'missing' ? 'missing' : failure === 'page' ? 'answered with the page' : 'not fetched at all'} has none`);
  answer = 'json';
  const again = await partsFile(DIR);
  ok(asked.length === 2 && again !== null, 'and is asked again by the next look, which finds it');
}
{
  const text = readFileSync(fileURLToPath(new URL('../../../src/player/partsFile.ts', import.meta.url)), 'utf8');
  ok(!/^import\s/m.test(text), 'the module imports nothing (the character cannot be loaded by a node test)');
  const character = readFileSync(fileURLToPath(new URL('../../../src/player/character.ts', import.meta.url)), 'utf8');
  ok(character.includes('await partsFile(dir)') && !/fetch\(`\$\{dir\}parts\.json`\)/.test(character), "the character reads its parts file through it, and fetches it nowhere of its own");
}

console.log(`\n${passed} checks passed`);
