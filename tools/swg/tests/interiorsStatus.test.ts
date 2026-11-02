// What `status` asks for of the interior layout files' wave, run as a child over packs made up here (never assets-private):
// the `interiors` pass on a world with a layout and no file, and again on one whose file is older than its layout; the
// placed `sounds` once the file stands pieces and the sounds were written before it; the `props` while the props pack has
// no `interiorFormat`; and the `ships` while a hull read its interior layout file as an appearance. Each ask is checked to
// come from a status that ran (a JSON emptied by a throw inside `packStatus` asks for nothing, which would pass a test that
// only says "nothing asked"), and each one's way out is checked too: the same folder made right asks for it no more.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MATERIAL_FORMAT } from '../surface.mjs';
import { PROPS_INTERIOR_FORMAT, PROPS_PACK_VERSION, PROPS_SKELETAL_FORMAT } from '../props.mjs';
import { INTERIORS_PACK_VERSION } from '../ilf.mjs';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
type Step = { command: string; reasons: string[] };

/** What `status --json` asks for on a folder, and whether it ran at all (a plan with steps, read from a clean exit). */
function asked(dir: string): Step[] {
  const run = spawnSync(process.execPath, [cli, 'status', dir, '--json'], { encoding: 'utf8', maxBuffer: 64 * 1048576, env: { ...process.env, SWG: '' } });
  let plan: { steps?: Step[] } = {};
  try {
    plan = JSON.parse(run.stdout);
  } catch {
    plan = {};
  }
  assert.ok(run.status === 0 && Array.isArray(plan.steps) && plan.steps.length > 0, `status ran over the folder and said what to do (exit ${run.status}; ${String(run.stderr).slice(0, 300)})`);
  return plan.steps ?? [];
}
const why = (steps: Step[], command: string, words: RegExp) => steps.filter((s) => s.command === command).some((s) => s.reasons.some((r) => words.test(r)));

const dir = mkdtempSync(join(tmpdir(), 'swg3js-interiors-status-'));
try {
  const json = (rel: string, v: unknown) => {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), JSON.stringify(v));
  };
  const age = (rel: string, seconds: number) => {
    const t = new Date(Date.now() + seconds * 1000);
    utimesSync(join(dir, rel), t, t);
  };
  const T = 'object/building/tatooine/shared_cantina_tatooine.iff';
  json('tatooine/manifest.json', { planet: 'tatooine', categories: {} });
  json('tatooine/layout.json', { planet: 'tatooine', center: { x: 0, z: 0 }, objects: [{ template: T, model: 'cantina', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], radius: 40 }] });
  const pieces = [[0, 'object/soundobject/shared_soundobject_cantina_large.iff', '', 'snd', 2, 0, 2, 0, 1, 0, 0, 0]];
  const interiors = { version: INTERIORS_PACK_VERSION, planet: 'tatooine', templates: { [T]: { file: 'interiorlayout/cantina.ilf', model: 'cantina', pieces } }, buildings: [{ row: 0, key: `o:${T}@0,0,0`, template: T }], defs: [] };
  // A props pack of today's shape but for the mark this wave adds, and a ships pack with one hull read the old way.
  json('props/manifest.json', { version: PROPS_PACK_VERSION, materialFormat: MATERIAL_FORMAT, skeletalFormat: PROPS_SKELETAL_FORMAT, props: [], models: [], skipped: [] });
  json('ships/manifest.json', { ships: [{ id: 'yt1300', template: 'object/ship/player/shared_player_yt1300.iff', interior: { pob: 'interiorlayout/space/yt1300.ilf', failed: 'Not in archives: appearance/interiorlayout/space/yt1300.ilf' }, attachments: [], chassis: null }], skipped: [] });

  // 1. No file: asked for, the world named.
  let steps = asked(dir);
  ok(why(steps, 'interiors', /tatooine \(none\)/), "a world with a layout and no interiors file asks for the pass, naming the world");
  ok(why(steps, 'props', /interior layout files/), 'a props pack with no `interiorFormat` asks for the props again');
  ok(why(steps, 'ships', /yt1300 read its interior layout file as an appearance/), 'a hull that read its interior layout file as an appearance asks for the ships again');

  // 2. A file older than its layout: asked for again.
  json('tatooine/interiors.json', interiors);
  age('tatooine/interiors.json', -60);
  steps = asked(dir);
  ok(why(steps, 'interiors', /tatooine \(older than tatooine\/layout\.json\)/), 'an interiors file older than its layout is asked for again');
  // A file of another shape is asked for too.
  json('tatooine/interiors.json', { ...interiors, version: INTERIORS_PACK_VERSION + 1 });
  age('tatooine/interiors.json', 60);
  ok(why(asked(dir), 'interiors', /tatooine \(older\)/), 'and one of another shape');

  // 3. A fresh file standing a sound object, beside placed sounds written before it: the sounds are asked for.
  json('tatooine/interiors.json', interiors);
  age('tatooine/interiors.json', 60);
  json('tatooine/sounds.json', { format: 1, planet: 'tatooine', frame: 'snapshot', emitters: [], pobs: {}, surfaces: {}, rooms: {} });
  age('tatooine/sounds.json', 120);
  steps = asked(dir);
  ok(!why(steps, 'interiors', /tatooine/), 'a fresh interiors file is asked for no more');
  ok(why(steps, 'sounds', /before its buildings' interior layout files/), "placed sounds with no mark of the file beside it are asked for again, whatever their age");
  json('tatooine/sounds.json', { format: 1, planet: 'tatooine', frame: 'snapshot', interiors: INTERIORS_PACK_VERSION, emitters: [], pobs: {}, surfaces: {}, rooms: {} });
  age('tatooine/sounds.json', 30);
  ok(why(asked(dir), 'sounds', /before its buildings' interior layout files/), 'and with the mark, while they are older than the file');
  age('tatooine/sounds.json', 120);

  // 4. Each made right: asked for no more.
  json('props/manifest.json', { version: PROPS_PACK_VERSION, materialFormat: MATERIAL_FORMAT, skeletalFormat: PROPS_SKELETAL_FORMAT, interiorFormat: PROPS_INTERIOR_FORMAT, props: [], models: [], skipped: [] });
  json('ships/manifest.json', { ships: [{ id: 'yt1300', template: 'object/ship/player/shared_player_yt1300.iff', interior: null, furniture: [], attachments: [], chassis: null }], skipped: [] });
  age('tatooine/interiors.json', 200);
  age('tatooine/sounds.json', 300);
  steps = asked(dir);
  ok(!why(steps, 'interiors', /./) && !why(steps, 'sounds', /interior layout/) && !why(steps, 'props', /interior layout files/) && !why(steps, 'ships', /interior layout file as an appearance/), 'with the file fresh, the sounds after it, the props marked and the hull read right, none of the four is asked for again');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${checks} checks passed`);
