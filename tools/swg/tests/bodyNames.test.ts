// Save to game keeps a body's name (the GPU port's pass 2, wave 6, maker K; the brief's "a body of his own shows its name on the
// map, not its id"): the viewer's writer (`viewer/gameBodies.mjs`) carries an applied system's bodies as saved, and the game's
// reader (`src/sky/look/bodiesFile.ts`) dropped every string that was not a short plain word, so a name he typed with an
// apostrophe, a comma or an accent went, the clockwork named the body by its id, and the galaxy map's opened system showed
// the id. Here: the base's reader (1b2a6c6, read out of git) drops it and the map shows the id; today's keeps it and the map
// shows the name; a name that is a file's is still dropped.
//
// Run: node tools/swg/tests/bodyNames.test.ts
import assert from 'node:assert/strict';
import { atBase } from './atBase.ts';
// @ts-ignore a plain module of the viewer's
import { gameBodiesFile } from '../../../viewer/gameBodies.mjs';
import { cleanBodiesFile } from '../../../src/sky/look/bodiesFile.ts';
import { draftSystem } from '../../../src/sky/system/drafts.js';
import { GALAXY_SYSTEMS } from '../../../src/data/galaxy.ts';
import { OpenedSystem } from '../../../src/ui/galaxySystem.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let checks = 0;
const ok = (cond: boolean, msg: string): void => {
  assert.ok(cond, msg);
  checks++;
  console.log(`ok   ${msg}`);
};

const NAME = "Kalee's moon, the old";
const ACCENT = 'Écume';
const tatoo = JSON.parse(JSON.stringify(draftSystem('tatoo'))) as Any;
const home = tatoo.grounds.find((g: Any) => g.world === 'tatooine').body;
const proto = tatoo.bodies.find((b: Any) => b.kind === 'moon') ?? tatoo.bodies.find((b: Any) => b.id === home);
tatoo.bodies.push({ ...JSON.parse(JSON.stringify(proto)), id: 'moon9', kind: 'moon', name: NAME, parent: home, places: [], look: null, members: undefined });
tatoo.bodies.push({ ...JSON.parse(JSON.stringify(proto)), id: 'moon8', kind: 'moon', name: ACCENT, parent: home, places: [], look: null, members: undefined });
tatoo.bodies.push({ ...JSON.parse(JSON.stringify(proto)), id: 'moon7', kind: 'moon', name: 'his picture.png', parent: home, places: [], look: null, members: undefined });
const made = JSON.parse(JSON.stringify(gameBodiesFile({ looks: {}, uses: {}, starSystems: { tatoo: { applied: true, system: tatoo } } }, { at: 'now' })));
ok(made.systems.tatoo.bodies.some((b: Any) => b.name === NAME), 'the viewer\'s Save to game writes the body\'s name as he typed it');
const g = GALAXY_SYSTEMS.find((s) => s.id === 'tatoo')!;
const nameOn = (file: Any, id: string): string | undefined => OpenedSystem.open(g, file.systems, 'tatooine').bodies.find((b) => b.id === id)?.name;

const base = await atBase<{ cleanBodiesFile: typeof cleanBodiesFile }>('src/sky/look/bodiesFile.ts', '1b2a6c6');
ok(!!base, "the base's reader read out of git at 1b2a6c6");
const was = base!.cleanBodiesFile(made).file!;
ok(nameOn(was, 'moon9') === 'moon9' && nameOn(was, 'moon8') === 'moon8', `before: the game's reader dropped the names and the map named the bodies by their ids (${nameOn(was, 'moon9')}, ${nameOn(was, 'moon8')})`);
const now = cleanBodiesFile(made).file!;
ok(nameOn(now, 'moon9') === NAME && nameOn(now, 'moon8') === ACCENT, `now the map shows his names (${nameOn(now, 'moon9')}, ${nameOn(now, 'moon8')})`);
ok(nameOn(now, 'moon7') === 'moon7' && !JSON.stringify(now).includes('his picture.png'), "a name that is a picture's file name is still dropped");
ok(OpenedSystem.open(g, now.systems, 'tatooine').bodies.filter((b) => !['moon7', 'moon8', 'moon9'].includes(b.id)).every((b) => b.name === OpenedSystem.open(g, was.systems, 'tatooine').bodies.find((x) => x.id === b.id)?.name), 'every draft body keeps the name it had');

console.log(`\nbodyNames: ${checks} checks passed`);
