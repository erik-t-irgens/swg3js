// The story's checker reads the removal and people files beside the permanent placements (Map-maker II's twelfth wave,
// Map-maker I §8): `npm run story:check` warns, and never refuses, when a story object's template stands hidden within the
// game's find of its `near`, when a promoted row is taken away on a world, or when a promotion names one of the owner's
// placed people (an id of the shape the editor mints) that no people file holds; and it names every hide that finds nothing
// in a world's layout where this machine has it (a piece of a building's furniture is matched over its interiors' file,
// which a layout does not hold, and is not checked).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { objectKey, removalsFileText } from '../../../src/story/removals.ts';
import { peopleFileText } from '../../../src/story/placedPeople.ts';
import { OBJECT_FIND } from '../../../src/story/set.ts';
import { removalIssues, removalsOf } from '../../story/check.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const TEMPLATE = 'object/tangible/terminal/shared_terminal_mission.iff';
const OTHER = 'object/tangible/furniture/shared_chair.iff';

const dir = mkdtempSync(join(tmpdir(), 'mm2-w12-check-'));
try {
  mkdirSync(join(dir, 'removed'));
  mkdirSync(join(dir, 'people'));
  // Tatooine: a terminal hidden at (3476, -4694), one 40 m off, a chair hidden at the same place, a person removed, and a key
  // that finds nothing in the layout handed in; a piece of a building's furniture, which is never matched here.
  const hiddenHere = objectKey(TEMPLATE, 3476.2, 5, -4694.1);
  const hiddenFar = objectKey(TEMPLATE, 3476 + OBJECT_FIND + 10, 5, -4694);
  const chair = objectKey(OTHER, 3476, 5, -4694);
  const nothing = objectKey(TEMPLATE, 9000, 0, 9000);
  const piece = `${objectKey('object/building/tatooine/shared_cantina_tatooine.iff', 3400, 4, -4800)}/3`;
  writeFileSync(
    join(dir, 'removed', 'tatooine.json'),
    removalsFileText('tatooine', 'raw', [
      { id: hiddenHere, hide: true },
      { id: hiddenFar, hide: true },
      { id: chair, hide: true },
      { id: nothing, hide: true },
      { id: piece, hide: true },
      { id: 'p:2b2c346e6abc' },
      { id: `t:${OTHER}`, solid: false },
    ]),
  );
  writeFileSync(join(dir, 'people', 'tatooine.json'), peopleFileText('tatooine', 'raw', [{ id: 'kael-smuggler-1', body: 'human_male', x: 3500, y: 5, z: -4700, heading: 90 }]));
  // A world this game has not got, and a file that does not read.
  writeFileSync(join(dir, 'removed', 'nowhere.json'), removalsFileText('nowhere', 'raw', [{ id: 'p:abc' }]));
  writeFileSync(join(dir, 'people', 'naboo.json'), '{ not json');
  const layout = [
    { template: TEMPLATE, x: 3476.2, y: 5, z: -4694.1 },
    { template: TEMPLATE, x: 3476 + OBJECT_FIND + 10, y: 5, z: -4694 },
    { template: OTHER, x: 3476, y: 5, z: -4694 },
  ];
  const r = removalsOf(dir, { root: ROOT, layoutOf: (w: string) => (w === 'tatooine' ? layout : null) });
  const t = r.worlds.get('tatooine');
  ok(r.files === 4 && !!t, `the removal and people files are read by world (${r.files} files)`);
  ok(t!.hidden.length === 4 && t!.hidden.every((h: { id: string }) => h.id !== piece), "every hide of one of the world's own objects is kept with its template and place, a piece of a building's furniture apart");
  ok(t!.people.has('2b2c346e6abc') && t!.placed.has('kael-smuggler-1'), 'the people removed by key and the placed people by id');
  ok(r.checked === 1 && t!.missing?.length === 1 && t!.missing[0] === nothing, 'over the layout this machine has, the one hide that finds nothing is named');
  ok(r.notes.some((n: string) => n.includes(nothing) && /finds nothing/.test(n) && /warning/.test(n)), 'and said as a warning on its own line');
  ok(!r.notes.some((n: string) => n.includes(piece)), "a piece's own key is not matched over a layout, which holds no furniture");
  ok(r.notes.some((n: string) => /nowhere is not a world this game has/.test(n)) && r.notes.some((n: string) => /people\/naboo\.json/.test(n) && /refused/.test(n)), "a file of a world the game has not got, and one that does not read, are said");
  const none = removalsOf(join(dir, 'missing'), { root: ROOT });
  ok(none.files === 0 && none.worlds.size === 0 && none.notes.length === 0, 'a folder that is not there is none, and says nothing');

  // A set as the checker holds one: its objects and cast, each with where it was written.
  const src = (file: string) => ({ file, lines: new Map([['/template', 7], ['/near', 8], ['/row', 4]]) });
  const set = {
    objects: {
      'test:obj/here': { id: 'test:obj/here', world: 'tatooine', template: TEMPLATE, near: [3476, -4694], reach: 4, label: null, test: true, src: src('objects/here.jsonc') },
      'test:obj/other-world': { id: 'test:obj/other-world', world: 'naboo', template: TEMPLATE, near: [3476, -4694], reach: 4, label: null, test: true, src: src('objects/naboo.jsonc') },
      'test:obj/placed': { id: 'test:obj/placed', world: 'tatooine', template: 'place/test-crate', near: [3476, -4694], reach: 4, label: null, test: true, src: src('objects/placed.jsonc') },
      'test:obj/clear': { id: 'test:obj/clear', world: 'tatooine', template: 'object/tangible/terminal/shared_terminal_bank.iff', near: [3476, -4694], reach: 4, label: null, test: true, src: src('objects/clear.jsonc') },
    },
    cast: {
      'test:cast/removed': { id: 'test:cast/removed', row: 'row:2b2c346e6abc', world: 'tatooine', src: src('cast/removed.jsonc') },
      'test:cast/placed': { id: 'test:cast/placed', row: 'row:kael-smuggler-1', world: 'tatooine', src: src('cast/placed.jsonc') },
      'test:cast/gone': { id: 'test:cast/gone', row: 'row:kael-smuggler-2', world: 'tatooine', src: src('cast/gone.jsonc') },
      'test:cast/data': { id: 'test:cast/data', row: 'row:fae12606b5e6', world: 'tatooine', src: src('cast/data.jsonc') },
      'test:cast/own': { id: 'test:cast/own', world: 'tatooine', src: src('cast/own.jsonc') },
    },
  };
  const issues = removalIssues(set, r) as { level: string; file: string; line: number; message: string }[];
  const on = (file: string) => issues.filter((i) => i.file === file);
  ok(issues.every((i) => i.level === 'warning'), 'every one of them is a warning, never an error');
  ok(on('objects/here.jsonc').length === 1 && on('objects/here.jsonc')[0].line === 7 && /hides/.test(on('objects/here.jsonc')[0].message), `a story object whose template stands hidden within ${OBJECT_FIND} m of its near is warned of at its template, once (the copy ${OBJECT_FIND + 10} m off is not)`);
  ok(on('objects/naboo.jsonc').length === 0 && on('objects/placed.jsonc').length === 0 && on('objects/clear.jsonc').length === 0, "on another world, a permanent row's own id, or another template: nothing");
  ok(on('cast/removed.jsonc').length === 1 && on('cast/removed.jsonc')[0].line === 4 && /removed on tatooine/.test(on('cast/removed.jsonc')[0].message), 'a promoted row the removal file takes away is warned of at its row');
  ok(on('cast/placed.jsonc').length === 0, 'a promotion of a placed person a people file holds: nothing');
  ok(on('cast/gone.jsonc').length === 1 && /no people file holds kael-smuggler-2/.test(on('cast/gone.jsonc')[0].message), 'a promotion of a placed person no people file holds any more is warned of');
  ok(on('cast/data.jsonc').length === 0 && on('cast/own.jsonc').length === 0, "a promotion of one of the data's own rows, and a cast member stood by the story: nothing");

  // The command reads them from `--placements`, once for every folder, and the committed test set still has no error.
  const run = spawnSync(process.execPath, [join(ROOT, 'tools', 'story', 'check.mjs'), `--placements=${dir}`, join(ROOT, 'src', 'story', 'testSet')], { encoding: 'utf8' });
  ok(run.status === 0, `story:check over these files still passes the test set (it only warns): ${run.stderr.slice(0, 200)}`);
  ok(/4 removal or people files read/.test(run.stdout), 'and says what it read');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${checks} checks passed`);
