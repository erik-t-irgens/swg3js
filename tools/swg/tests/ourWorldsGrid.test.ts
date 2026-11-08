// A copy of yours' own walk grid (the race drawer's fourth wave, DESIGN.md §5c): `navgrid <copy> <dir>` bakes it from its
// source's pack under its own key into a folder of its own, never touching the source's grid, and `status` asks for it while
// it has none or its own edit files have moved past it. Proved on fixtures: a temporary packs folder whose one pack is the
// install's converted `watertabletest` reached through a junction (read, never written) and a temporary placements folder
// holding the worlds file; the owner's install is never baked.
//
// Run: node tools/swg/tests/ourWorldsGrid.test.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { worldsFileText } from '../../../src/world/editFiles/worldsFile.ts';
import { gridCopies, gridEditsOf, walkThroughTemplates } from '../navgrid.mjs';
import { gridLayoutStale } from '../finalnames.mjs';
import { REPO } from './oldModules.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (s: string) => console.log(`note ${s}`);

const SOURCE = 'watertabletest';
const COPY = 'ours_wtt_copy';
const src = join(REPO, 'assets-private', SOURCE);

{
  const root = mkdtempSync(join(tmpdir(), 'rd-w4-grid-'));
  try {
    const placed = join(root, 'placements');
    mkdirSync(join(placed, 'worlds'), { recursive: true });
    writeFileSync(join(placed, 'worlds', 'all.json'), worldsFileText([{ id: COPY, kind: 'copy', of: SOURCE, name: 'A copy' }]));
    const packs = join(root, 'packs');
    mkdirSync(packs);
    ok(gridCopies(packs, placed).length === 1 && gridCopies(packs, placed)[0].pack === SOURCE && gridCopies(packs, placed)[0].outDir === join(packs, COPY), "the worlds file's copy is baked from its source's pack into a folder of its own");
    ok(gridCopies(packs, null).length === 0, 'with no placements folder there is none');
    const cli = readFileSync(join(REPO, 'tools/swg/cli.mjs'), 'utf8').replace(/\r\n/g, '\n');
    ok(cli.includes("for (const c of gridCopies(dir)) {") && cli.includes("need(`navgrid ${c.id} ${dir}`, `${c.id} (a copy of ${c.pack}) has no walk grid of its own: bodies outdoors steer straight at their goal`);") && cli.includes('const stale = gridLayoutStale(grid, c.packDir, srcManifest, statusWalkThrough, gridEditsOf(c.id, undefined, c.packDir));'), 'status asks for a copy\'s grid while it has none, and while its own edit files have moved past it');
    if (!existsSync(join(src, 'layout.json'))) note(`${SOURCE} is not converted here: the bake of a copy is not run`);
    else {
      symlinkSync(src, join(packs, SOURCE), 'junction');
      const before = new Map(readdirSync(src).map((f) => [f, statSync(join(src, f)).mtimeMs]));
      const out = execFileSync(process.execPath, [join(REPO, 'tools/swg/cli.mjs'), 'navgrid', COPY, packs], { cwd: REPO, encoding: 'utf8', env: { ...process.env, SWG: '', SWG3JS_PLACEMENTS: placed }, stdio: ['ignore', 'pipe', 'pipe'] });
      const grid = JSON.parse(readFileSync(join(packs, COPY, 'nav.json'), 'utf8')) as { layoutKey?: string; nx: number };
      ok(grid.nx > 0 && existsSync(join(packs, COPY, 'nav.bin')) && out.includes(`${COPY}:`), 'the copy\'s grid is baked into its own folder');
      const after = new Map(readdirSync(src).map((f) => [f, statSync(join(src, f)).mtimeMs]));
      ok([...before].every(([f, t]) => after.get(f) === t) && after.size === before.size, "and nothing of its source's pack is written or added");
      const wt = walkThroughTemplates();
      const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
      ok(gridLayoutStale(grid, src, manifest, wt, gridEditsOf(COPY, placed, src)) === null, 'the grid baked is current by the very rule status asks');
      mkdirSync(join(placed, 'world'), { recursive: true });
      writeFileSync(join(placed, 'world', `${COPY}.json`), '{ "version": 1, "frame": "raw", "rows": [] }\n');
      ok(gridLayoutStale(grid, src, manifest, wt, gridEditsOf(COPY, placed, src)) !== null, "and stale once the copy's own edit files move");
    }
  } finally {
    // The junction let go of first, on its own (`rmdirSync` takes the link and never what it points at), so the removal of
    // the temporary folder can never reach into the install's pack.
    try {
      rmdirSync(join(root, 'packs', SOURCE));
    } catch {
      /* none was made */
    }
    rmSync(root, { recursive: true, force: true });
  }
}

console.log(`\nourWorldsGrid: ${checks} checks passed`);
