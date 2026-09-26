// The Core3 reference: what six commands read from the emulator's scripts, kept in the checkout so a
// launcher with no emulator converts exactly what a checkout with one does.
//
// The file is only worth keeping if it answers every question the way the folder would, so the
// essential test here is that comparison, made against the owner's own scripts wherever they are on
// this machine (`--core3`-style: CORE3 in the environment or in .env). Without them it is skipped with
// a note, and what is left checks the file itself and the encoding it is written in.
//
// Run: node tools/swg/tests/core3ref.test.ts

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORE3_READERS, CORE3_REF_DIR, core3Source, core3SourceFor, decodeValue, differs, encodeValue } from '../core3ref.mjs';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
function note(what: string): void {
  console.log(`note ${what}`);
}

// ---------------------------------------------------------------- the encoding

{
  const value = { a: new Map<unknown, unknown>([['x', new Set([1, 2])], [3, { deep: new Map([['y', [1, { z: null }]]]) }]]), b: [1, 'two', true, null] };
  const back = decodeValue(encodeValue(value));
  ok(back.a instanceof Map && back.a.get('x') instanceof Set && back.a.get(3).deep instanceof Map, 'Maps and Sets come back as Maps and Sets, nested, with number keys kept numbers');
  ok(differs(value, back) === null, 'and the whole value reads the same as it went in');
  const again = decodeValue(encodeValue(value));
  again.a.get(3).deep.set('y', 'changed');
  ok(back.a.get(3).deep.get('y') !== 'changed', 'every read is fresh objects, so a command that writes into what it is given cannot change the next read');
  ok(differs({ a: 1, gone: undefined }, { a: 1 }) === null, 'a key holding undefined is the same as no key, which is how JSON writes it and how every reader is read');
  ok(differs([1, 2], [1, 2, 3]) !== null && differs(new Map([['a', 1]]), new Map([['a', 2]])) !== null, 'and a real difference is found, with where it is');
  assert.throws(() => encodeValue([1, undefined]), /undefined/);
  ok(true, 'an array holding undefined is refused rather than written as null');
  assert.throws(() => encodeValue({ $map: [] }), /\$map/);
  ok(true, 'and so is a plain object carrying $map, which would come back as a Map');
  assert.throws(() => encodeValue({ n: NaN }), /not a number/);
  ok(true, 'and a NaN, which JSON would write as null');
}

// ---------------------------------------------------------------- the file in the checkout

const index = JSON.parse(readFileSync(join(CORE3_REF_DIR, 'index.json'), 'utf8'));
{
  ok(index.format === 1 && /AGPL/.test(index.note) && /never the scripts/.test(index.note), 'the reference says where it came from, under what licence, and that it holds data and not the scripts');
  for (const [name, r] of Object.entries(CORE3_READERS)) {
    ok(index.files[name] === r.file && existsSync(join(CORE3_REF_DIR, r.file)), `${name} has its file (${r.file})`);
  }
  ok(index.zones.includes('tatooine') && index.zones.includes('naboo') && index.zones.length >= 18, `the per-world readers are kept for every zone the scripts name (${index.zones.length})`);
}

{
  const src = core3Source();
  ok(src.kind === 'reference' && src.missing === null, 'with no folder named, a command reads the reference');
  ok(core3SourceFor({})?.kind === 'reference', 'and that is what a command asks for when it is given nothing');
  ok(core3SourceFor({ core3: 'none' }) === null, '--core3=none asks for no emulator data at all');
  const travel = src.readTravelBuildings();
  ok(travel instanceof Map && travel.size > 0, `the travel buildings are a Map, as the reader's are (${travel.size})`);
  // The travel reader's children carry a `model` of their own, so the mark is a field nothing writes.
  const kids = [...travel.values()][0];
  kids[0].writtenByACommand = true;
  ok([...src.readTravelBuildings().values()][0][0].writtenByACommand === undefined, 'a second read does not see what a command wrote into the first');
  const tatooine = src.readServerProps('tatooine');
  const nowhere = src.readServerProps('gallery');
  ok(Array.isArray(tatooine) && tatooine.length > 0, `a world the screenplays name has its props (${tatooine.length} on tatooine)`);
  ok(Array.isArray(nowhere) && nowhere.length === 0, 'and a world none of them names answers what the folder answers for it, which is nothing');
  const spawns = src.scanServerSpawns('corellia');
  ok(Array.isArray(spawns.objects) && Array.isArray(spawns.mobiles) && spawns.stats, 'the server spawns keep their shape, stats and all');
  const missing = core3Source({ refDir: join(fileURLToPath(new URL('.', import.meta.url)), 'no-such-reference') });
  ok(!!missing.missing, 'a release that lost the files says so, rather than answering nothing in silence');
}

// ---------------------------------------------------------------- the one that matters: the same answers as the folder

{
  let dir = process.env.CORE3 ?? '';
  const env = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (!dir && existsSync(env)) {
    for (const line of readFileSync(env, 'utf8').split(/\r?\n/)) {
      const m = /^\s*CORE3\s*=\s*(.*?)\s*$/.exec(line);
      if (m) dir = m[1].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  if (!dir || !existsSync(join(dir, 'object', 'building'))) {
    note('no Core3 scripts folder on this machine (CORE3), so the reference is not compared with one here');
  } else {
    const live = core3Source({ dir });
    const ref = core3Source();
    for (const [name, r] of Object.entries(CORE3_READERS)) {
      if (r.zone) {
        let worst: string | null = null;
        for (const z of [...index.zones, 'gallery', 'space_tatooine', 'nowhere at all']) {
          const d = differs(live[name](z), ref[name](z));
          if (d && !worst) worst = `${z}: ${d}`;
        }
        ok(worst === null, `${name} answers every zone as the folder does${worst ? ` -- ${worst}` : ''}`);
      } else {
        const d = differs(live[name](), ref[name]());
        ok(d === null, `${name} answers as the folder does${d ? ` -- ${d}` : ''}`);
      }
    }
  }
}

console.log(`\ncore3 reference: ${passed} checks passed`);
