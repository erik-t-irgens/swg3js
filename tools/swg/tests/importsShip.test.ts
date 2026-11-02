// Shipping an import is the owner's act (Map-maker II's tenth wave, DESIGN.md §2.12 "Committing"): the repository is public
// and its history permanent, so `--ship` refuses a model whose pictures or materials are named like the client's
// (`texture/`, `shader/`, `.dds`, `.sht`) and one whose record does not say `"ship": true`, and it writes into the shipped
// folder alone; without it nothing is ever written under `public/`. Run against a checkout of our own in a temporary
// folder (`runImport`'s `repo`), and once through the real command line into a folder of its own, which must leave this
// checkout's `public/` as it found it.
//
// Run: node tools/swg/tests/importsShip.test.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { looksClientish, runImport, shipNameRefusals } from '../imports.mjs';
import { cube, solidPng, writeRawGlb, type RawGltf } from './blenderGlb.ts';

let checks = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
}

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'swg-imports-ship-'));
const repo = join(tmp, 'checkout');
mkdirSync(repo, { recursive: true });
const sources = join(tmp, 'sources');
mkdirSync(sources, { recursive: true });

/** A painted box: its picture named as the test says, its material too. */
function box(picture: string, material = 'Paint'): RawGltf {
  return {
    materials: [{ name: material, pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0 } }],
    textures: [{ source: 0, sampler: 0 }],
    images: [{ name: picture, png: solidPng(4, [200, 120, 60, 255]) }],
    meshes: [{ name: 'Cube', primitives: [cube(0)] }],
    nodes: [{ name: 'Box', mesh: 0, translation: [0, 1, 0] }],
  };
}
function source(stem: string, doc: RawGltf, record?: Record<string, unknown>): string {
  const f = join(sources, `${stem}.glb`);
  writeFileSync(f, writeRawGlb(doc));
  if (record) writeFileSync(join(sources, `${stem}.import.json`), JSON.stringify(record));
  return f;
}
const said: string[] = [];
const log = (s: string) => void said.push(s);
const run = (o: Partial<Parameters<typeof runImport>[0]>) => {
  said.length = 0;
  return runImport({ input: null, out: null, repo, log, now: 1, ...o } as Parameters<typeof runImport>[0]);
};
const publicDir = join(repo, 'public');
const privateDir = join(repo, 'imports-private');
/** Every file under a folder, by its path inside it. */
const filesOf = (dir: string): string[] => {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string, at: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p, `${at}${e}/`);
      else out.push(`${at}${e}`);
    }
  };
  walk(dir, '');
  return out.sort();
};

{
  ok(looksClientish('texture/rock.dds') && looksClientish('shader\\x.sht') && looksClientish('wall_texture.DDS') && !looksClientish('my_wall') && !looksClientish('texturedstone'), 'what looks like the client\'s: its two folders and its two file kinds, never a word merely containing one');
  const named = shipNameRefusals({ images: [{ name: 'texture/rock.dds' }, { uri: 'pics/shader/wall.png' }], materials: [{ name: 'rock.sht' }], textures: [{ name: 'fine' }] });
  ok(named.length === 3, `every picture and material named so is named in the refusal (${named.length})`);
}

{
  const f = source('rocky', box('texture/rock_a.dds'), { id: 'test_rocky', ship: true });
  const code = run({ input: f, ship: true });
  ok(code === 1 && said.some((s) => /named like the client's own/.test(s) && /texture\/rock_a\.dds/.test(s)), `--ship refuses a picture named like the client's, in words (${said.find((s) => /named like/.test(s))?.trim()})`);
  ok(!existsSync(publicDir), 'and writes nothing under public/');
  const g = source('shady', box('mine', 'shader/wall.sht'), { id: 'test_shady', ship: true });
  ok(run({ input: g, ship: true }) === 1 && said.some((s) => /the material "shader\/wall\.sht"/.test(s)) && !existsSync(publicDir), 'and a material named so');
}

{
  const f = source('plain', box('my_paint'), { id: 'test_plain', ship: false });
  ok(run({ input: f, ship: true }) === 1 && said.some((s) => /"ship": true/.test(s)) && !existsSync(publicDir), "--ship refuses a model whose record does not say it may ship, and writes nothing");
  const fresh = source('fresh', box('my_paint'));
  ok(run({ input: fresh, ship: true }) === 1 && !existsSync(join(sources, 'fresh.import.json')) && !existsSync(publicDir), 'and one with no record at all (no record is written for a refused one)');
  ok(run({ input: f, ship: true, out: join(tmp, 'elsewhere') }) === 1 && said.some((s) => /--ship writes into/.test(s)), '--ship writes into the shipped folder and nowhere else');
}

{
  // Without --ship: into the private folder, nothing under public/, a record written for a source with none.
  const f = source('Painted Box', box('my_paint'));
  ok(run({ input: f }) === 0 && filesOf(privateDir).some((p) => /^painted_box\.[0-9a-f]{8}\.glb$/.test(p)) && !existsSync(publicDir), `without --ship it writes into imports-private alone (${filesOf(privateDir).join(', ')})`);
  const rec = JSON.parse(readFileSync(join(sources, 'Painted Box.import.json'), 'utf8'));
  ok(rec.id === 'painted_box' && rec.ship === false && said.some((s) => /had no record/.test(s)), 'and writes the record beside a source that had none, with ship false');
}

{
  // With --ship and the owner's word: into public/imports and nowhere else.
  const f = source('shipped', box('my_paint'), { id: 'test_shipped', ship: true });
  const before = filesOf(privateDir);
  ok(run({ input: f, ship: true }) === 0, 'with --ship and "ship": true a clean model ships');
  const shipped = filesOf(join(publicDir, 'imports'));
  ok(shipped.includes('manifest.json') && shipped.includes('imports.json') && shipped.some((p) => /^test_shipped\.[0-9a-f]{8}\.glb$/.test(p)) && shipped.some((p) => /^icons\/test_shipped\.[0-9a-f]{8}\.png$/.test(p)), `into public/imports (${shipped.join(', ')})`);
  ok(filesOf(publicDir).every((p) => p.startsWith('imports/')) && filesOf(privateDir).join() === before.join(), 'and nowhere else');
  ok(said.some((s) => /commit .* when you mean it to reach players/.test(s)), 'and says that committing it is what reaches players');
  // Its private twin, made after: said to be shadowed by the shipped one.
  const twin = source('shipped_twin', box('my_paint'), { id: 'test_shipped', ship: false });
  ok(run({ input: twin }) === 0 && said.some((s) => /is shipped too/.test(s)), 'a private model under a shipped one\'s id is said to show nowhere until shipped or renamed');
}

{
  // The real command line, into a folder of its own: this checkout's public/ is as it was.
  const before = existsSync(join(REPO, 'public', 'imports'));
  const privateBefore = filesOf(join(REPO, 'imports-private')).join();
  const out = join(tmp, 'cli-out');
  const f = source('cli_box', box('my_paint'), { id: 'test_cli_box', ship: false });
  const text = execFileSync(process.execPath, [join(REPO, 'tools', 'swg', 'cli.mjs'), 'import', f, out], { encoding: 'utf8', cwd: REPO });
  ok(/1 of 1 made/.test(text) && filesOf(out).some((p) => /^test_cli_box\.[0-9a-f]{8}\.glb$/.test(p)), 'the command line imports into the folder it is given');
  ok(existsSync(join(REPO, 'public', 'imports')) === before && filesOf(join(REPO, 'imports-private')).join() === privateBefore, "and leaves this checkout's public/ and imports-private as they were");
  // (The command line is never run here with --ship: that writes into this checkout's own public/imports, which only the
  // owner asks for. Its refusals are the same function's, held above against a checkout of the test's own.)
}

rmSync(tmp, { recursive: true, force: true });
console.log(`\nimportsShip: ${checks} checks passed`);
