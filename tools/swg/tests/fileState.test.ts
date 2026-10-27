// What the world editor's bar says of a world's files (DESIGN.md §2.11's status op): each placement file and the track
// file as git sees it -- none, untracked, saved and not committed, committed on this branch, or the same on main --
// worked out by the very glue the dev server runs (`gitStates`) in a scratch repository of our own, so nothing of this
// one is touched; and git is only ever asked, never told: every call carries `--no-optional-locks`, and the scratch
// repository's index is not written by a status asked over a file whose time moved (which a plain `git status` refreshes).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileStateOf, statusAsk, statusFiles } from '../../../src/world/placementEdits.ts';

const glue = await import('../../../tools/dev/placementsEndpoint.mjs');
const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

{
  ok(fileStateOf({ exists: false, inHead: false, porcelain: null, sameAsMain: null }) === 'none', 'no file and none in HEAD: none');
  ok(fileStateOf({ exists: true, inHead: false, porcelain: '??', sameAsMain: null }) === 'untracked', 'a file git has never been told of: untracked');
  ok(fileStateOf({ exists: true, inHead: true, porcelain: ' M', sameAsMain: null }) === 'modified' && fileStateOf({ exists: false, inHead: true, porcelain: ' D', sameAsMain: null }) === 'modified' && fileStateOf({ exists: true, inHead: false, porcelain: 'A ', sameAsMain: null }) === 'modified', 'changed, taken away or added since HEAD: saved and not committed');
  ok(fileStateOf({ exists: true, inHead: true, porcelain: null, sameAsMain: false }) === 'committed' && fileStateOf({ exists: true, inHead: true, porcelain: null, sameAsMain: true }) === 'main', 'committed on this branch, or the same on main');
  const files = statusFiles('tatooine');
  ok(files.map((f) => f.path).join() === 'public/placements/story/tatooine.json,public/placements/world/tatooine.json,public/placements/removed/tatooine.json,public/placements/people/tatooine.json,public/placements/heights/tatooine.json,public/placements/paint/tatooine.json,public/placements/water/tatooine.json,public/placements/locations/tatooine.json,public/placements/looks/all.json,public/tracks/tatooine.json', `a world's status asks of every kind of edit file (Map-maker II's kinds, the looks every world's one file) and its track file (${files.map((f) => f.kind).join(', ')})`);
  const worlds = new Map([['tatooine', 'ground' as const]]);
  ok('world' in statusAsk({ op: 'status', world: 'tatooine' }, { worlds }) && !('world' in statusAsk({ op: 'status', world: '../x' }, { worlds })) && !('world' in statusAsk({ op: 'status', world: 'naboo' }, { worlds })), 'a status names a world there is, as a pack id');
}

{
  // Every call to git goes through one function, which carries --no-optional-locks.
  const src = fs.readFileSync(join(REPO, 'tools', 'dev', 'placementsEndpoint.mjs'), 'utf8').split(/\r?\n/).join('\n');
  ok(/execFile\('git', \['--no-optional-locks', \.\.\.args\]/.test(src), "the glue's one git call carries --no-optional-locks");
  ok((src.match(/execFile\(/g) ?? []).length === 1 && !/spawn\(|execSync|spawnSync/.test(src), 'and it is the only way the glue runs anything');
  ok(!/\b(add|commit|reset|checkout|stash|update-index|restore)\b'/.test(src), 'and asks nothing that writes: no add, commit, reset, checkout, stash or restore');
}

const scratch = mkdtempSync(join(tmpdir(), 'filestate-'));
try {
  const run = (args: string[]) => spawnSync('git', args, { cwd: scratch, encoding: 'utf8' });
  if (run(['init', '-q', '-b', 'main']).status !== 0) console.log('note git could not make a scratch repository: the states are not checked against git');
  else {
    const commit = (m: string) => run(['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', m]);
    const file = (rel: string, text: string) => {
      mkdirSync(join(scratch, rel, '..'), { recursive: true });
      writeFileSync(join(scratch, rel), text);
    };
    const W = 'test_world';
    const paths = statusFiles(W).map((f) => f.path);
    const [story, world, removed, people] = paths;
    const track = paths[paths.length - 1];
    // On main: the track committed. On a branch: the world file committed; the story file added later, saved and not
    // committed; the people file untracked; the removed file none.
    file(track, '{"t":1}');
    run(['add', track]);
    commit('main');
    run(['checkout', '-q', '-b', 'claude/test']);
    file(world, '{"w":1}');
    run(['add', world]);
    commit('branch');
    file(world, '{"w":1}');
    file(story, '{"s":1}');
    run(['add', story]);
    file(people, '{"p":1}');
    const index = join(scratch, '.git', 'index');
    // A file's time moved with its text the same: what a plain `git status` would refresh the index for.
    const later = new Date(Date.now() + 60_000);
    fs.utimesSync(join(scratch, world), later, later);
    const before = fs.readFileSync(index);
    const beforeTime = fs.statSync(index).mtimeMs;
    const states = await glue.gitStates(scratch, paths);
    const by = (p: string) => states.files.find((f: { path: string }) => f.path === p)?.state;
    ok(states.branch === 'claude/test' && states.main === 'main', `git says the branch and where main is read from (${states.branch}, ${states.main})`);
    ok(by(track) === 'main', 'a file the same on main: on main');
    ok(by(world) === 'committed', 'a file committed on this branch and not on main: committed');
    ok(by(story) === 'modified', 'a file added and not committed: saved, not committed');
    ok(by(people) === 'untracked', 'a file git has never been told of: untracked');
    ok(by(removed) === 'none', 'and no file at all: none');
    ok(Buffer.compare(before, fs.readFileSync(index)) === 0 && fs.statSync(index).mtimeMs === beforeTime, "and git's index is exactly as it was: nothing the editor asks writes it");
    // The control: a plain status, without the flag, over the same files.
    run(['status', '--porcelain=v1', '--', ...paths]);
    const plainWrote = Buffer.compare(before, fs.readFileSync(index)) !== 0 || fs.statSync(index).mtimeMs !== beforeTime;
    console.log(`note a plain git status over the same files ${plainWrote ? 'did write the index here, which the flag spared it' : 'wrote nothing here either (this git refreshed nothing)'}`);
    fs.rmSync(join(scratch, track));
    const gone = await glue.gitStates(scratch, paths);
    ok(gone.files.find((f: { path: string }) => f.path === track)?.state === 'modified', 'a committed file taken off the disk: saved, not committed');
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(`\n${checks} checks passed`);
