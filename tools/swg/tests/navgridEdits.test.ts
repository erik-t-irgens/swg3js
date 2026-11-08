// The walk grid follows the committed edit files (Map-maker II's fifth wave, DESIGN.md §2.8 as the owner's answer to Q7
// rewrote it: no run-time patch; the converter's bake reads a world's heights file, its water file and its world and story
// placements rows that stand solid, and the grid's key folds their text in, so `status` asks for `navgrid <world>` when
// any of them moves).
//
// Held here:
// - **Day one**: with no edit files the bake is the bake of 49e5960 (`tools/swg/navgrid.mjs` loaded out of git beside
//   today's, its relative imports and its one dynamic import pointed at today's files): the same four planes to the byte on
//   small converted worlds; and the key with no edit files is the key of 49e5960's `layoutKeyOf` on every grid on disk.
// - **The key**: a world's edit files fold into it with their line endings folded, a world with none keys as it did, and
//   `gridLayoutStale` names a grid baked from other files.
// - **The bake over edit files** (one world, one bake of all four kinds, against the plain bake): a raised wall of 60°
//   blocks its cells and one step round, exactly the cells the game's own arithmetic over the generator's poles and the
//   deltas says; a lake of ours deeper than 1.2 m blocks its cells and a shallow one none; a solid permanent house is
//   rasterised as a placed object is, unturned and turned by 1.2 rad (its footprint indoor where it rises, inside its own
//   turned box and nowhere past it, never its box blocked whole, the ground round it open, the outside point of every way
//   in on the ground open); a solid thing of the props catalogue in the story file blocks its cells, and scaled 2 along x
//   and a half along z spreads along each axis as scaled; a seat with no word blocks nothing and one that says `solid`
//   blocks; a flower bush whose own extent is NULL blocks nothing though its triangles stand in a body's band, and a tree
//   out of another world blocks its trunk alone; nothing the plain bake blocks is ever opened; the ground away from the
//   edits walks as it did.
// - **What the install lacks**: a solid row whose model is not in this install's packs folds into the key (`absent`), so
//   a grid baked before the gallery or another world was converted is asked for again once they are.
// - **The rules move whole**: `src/world/nav/gridRules.ts` imports nothing, and the bake names its rules from it.
//
// It reads the converted packs on disk (`assets-private`); a world not converted is said and stepped over.

import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { inflateRawSync, deflateRawSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { oldTexts, REPO } from './oldModules.ts';
import * as THREE from 'three';
import { GRID_EDIT_KINDS, NAV_FLAGS, SLOPE_CLIMB_DEGREES, SWIM_DEPTH, anyGridEdits, buildNavGrid, gridEditsOf, readGlbTriangles, soeRiverStamp, walkThroughTemplates } from '../navgrid.mjs';
import { gridLayoutStale, layoutKeyOf } from '../finalnames.mjs';
import { deltaBytes, heightsFileText, tileIdOf } from '../../../src/world/editFiles/heightsFile.ts';
import { waterFileText } from '../../../src/world/editFiles/waterFile.ts';
import { placementsFileText, toGame } from '../../../src/story/placements.ts';
import { isSeat, isTableTemplate } from '../../../src/world/rowSolid.ts';
import { buildRoomGraph } from '../../../src/world/nav/navRooms.ts';
import { DOOR_TUNE, exitsFrom } from '../../../src/world/nav/doorway.ts';
import { rasterParts, type PartShape, type RasterBake } from '../../../src/world/nav/gridRules.ts';
import { trackFileText, type TrackDef } from '../../../src/race/trackFile.ts';
import { courseCtx, drawTrack } from '../../../src/editor/courseEdit.ts';

let passed = 0;
function ok(cond: unknown, msg: string): void {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
}
function note(msg: string): void {
  console.log(`note ${msg}`);
}

const PACKS = join(REPO, 'assets-private');
const PLAIN = { world: 'none', texts: { heights: null, water: null, world: null, story: null } };
const wt = walkThroughTemplates();
/**
 * Whether a world's edits as the converter's own run reads them carry anything of the owner's: an edit file, or a drawn race
 * course in its track file (the race drawer's second wave: `gridEditsOf` reads `public/tracks` beside the placements folder,
 * which `anyGridEdits` leaves out since it gates the bake header's own stats). Read through `anyGridEdits` alone, a course
 * the owner draws on a world with no edit file (Dantooine, the hand list's first step) failed the every-grid loop below.
 */
const hasOwnerEdits = (e: ReturnType<typeof gridEditsOf> & { course?: string }): boolean => anyGridEdits(e) || (typeof e.course === 'string' && e.course !== '');

/** A grid's planes joined as nav.bin holds them (before the deflate). */
function planes(g: { nibbles: Uint8Array; coarse: Uint8Array; edges: Uint8Array; clear: Uint8Array }): Buffer {
  return Buffer.concat([g.nibbles, g.coarse, g.edges, g.clear].map((a) => Buffer.from(a)));
}
function nibbleOf(nibbles: Uint8Array, k: number): number {
  const b = nibbles[k >> 1];
  return k & 1 ? b >> 4 : b & 0x0f;
}
const walkable = (v: number): boolean => v >= 1 && v <= 14;

{
  // The rules moved whole into a file that imports nothing, which the bake (shipped) names.
  const rules = readFileSync(join(REPO, 'src/world/nav/gridRules.ts'), 'utf8');
  ok(!/^\s*import\s/m.test(rules) && !/\bimport\(/.test(rules), 'src/world/nav/gridRules.ts imports nothing (the bake and the game may both read it, and the release ships it alone)');
  const bake = readFileSync(join(REPO, 'tools/swg/navgrid.mjs'), 'utf8');
  ok(/from '\.\.\/\.\.\/src\/world\/nav\/gridRules\.ts'/.test(bake), "the bake takes its rules (the slope and water tests, the raster, the pack) from gridRules.ts");
  ok(/heightEdits\.lay\(heights, heights, cx - x0, -pole, cz \+ z0, pole, pnx, pnz\)/.test(bake), "the bake lays a heights file's deltas over its pole lattice as the game lays them where a grid enters a cache (`HeightEdits.lay`)");
  ok(/lakeTable\(row, \(x\) => cx - x, \(z\) => z - cz\)/.test(bake) && /surfaceOf\(ours, gx, gz\)/.test(bake), 'and makes the lakes of ours tables of the grid\'s frame by the very rule the game does (`lakeTable`, `surfaceOf`)');
  ok(/const r = rasterParts\(bake, rowFloraParts\(def, m, most, radius, height, row\.y, FLORA_COLLISION\)\);/.test(bake) && /from '\.\.\/\.\.\/src\/world\/floraShapes\.ts'/.test(bake), "a permanent flora row is stood by the game's own shapes for it (`rowFloraParts`, the function the streamer calls), never its triangles");
  ok(/if \(!def\.collision\) mergeFloraCollision\(\[def\], packs\.collisionOf\(found\.pack\)\);/.test(bake) && /const \{ radius, height \} = modelExtentOf\(def\.bounds\);/.test(bake), "with the shapes merged onto its def as the game merges them, and the guess's radius and height the loaded model's own (`modelExtentOf`)");
  const shapes = readFileSync(join(REPO, 'src/world/floraShapes.ts'), 'utf8');
  ok(!/^\s*import\s/m.test(shapes) && /export \{[^}]*rowFloraParts[^}]*\} from '\.\/floraShapes\.ts';/.test(readFileSync(join(REPO, 'src/world/floraCollision.ts'), 'utf8')), 'floraShapes.ts imports nothing (the release ships it for the bake), and the game names it through floraCollision.ts as it always did');
  ok(/modelExtentOf\(def\.bounds\)/.test(readFileSync(join(REPO, 'src/world/assetPack.ts'), 'utf8')), "a loaded model's radius and height are `modelExtentOf`'s, the very ones the bake hands `rowFloraParts`");
  const cli = readFileSync(join(REPO, 'tools/swg/cli.mjs'), 'utf8');
  ok(/const edits = gridEditsOf\(planet, undefined, packDir\);\s*const layoutKey = layoutKeyOf\(packDir, walkThrough, edits\);/.test(cli) && /buildNavGrid\(packDir, \{[^}]*edits[^}]*\}\)/.test(cli), 'navgrid reads the edit files once, with the pack folder (what of their rows the install lacks), and hands the same to the key and the bake');
  ok(/const navStale = gridLayoutStale\(navGrid, packDir, manifest, statusWalkThrough, gridEditsOf\(planet, undefined, packDir\)\);/.test(cli), 'and status asks the same key over them');
  ok(/const stale = there \? gridLayoutStale\(there, packDir, manifest, walkThrough, gridEditsOf\(planet, undefined, packDir\)\) : null;/.test(cli), 'as navgrid --skip-existing does');
}

{
  // A permanent flora row's own shapes rasterised (`rasterParts`), over a flat bake of 2 m cells: a cylinder standing in
  // the band blocks the cells its disc reaches and no other; one standing wholly over the band (a canopy's) blocks none; a
  // ball by its own span over each point; a box turned about up by three's own sense, its cells inside its turned
  // footprint; and a mesh by its triangles, as a placed object's are.
  const n = 40;
  const fresh = (): RasterBake => ({ nx: n, nz: n, x0: -40, z0: -40, cell: 2, flags: new Uint8Array(n * n), edgeNear: new Uint8Array(n * n), heightAt: () => 0, byBand: false, nearGround: new Set(), highest: new Map() });
  const part = (p: Partial<PartShape>): PartShape => ({ kind: 'cyl', x: 0, y: 0, z: 0, r: 0, hx: 0, hy: 0, hz: 0, qy: 0, qw: 1, verts: null, idx: null, ...p });
  const blocked = (b: RasterBake): number[] => {
    const out: number[] = [];
    for (let k = 0; k < n * n; k++) if (b.flags[k] & NAV_FLAGS.object) out.push(k);
    return out;
  };
  const middle = (k: number): [number, number] => [-40 + ((k % n) + 0.5) * 2, -40 + (Math.floor(k / n) + 0.5) * 2];
  {
    const b = fresh();
    rasterParts(b, [part({ kind: 'cyl', x: 3.1, z: -5.3, r: 1.7, y: 2, hy: 2 })]);
    const cells = blocked(b);
    const far = cells.every((k) => {
      const [mx, mz] = middle(k);
      return Math.hypot(mx - 3.1, mz + 5.3) <= 1.7 + Math.SQRT2;
    });
    let missed = 0;
    for (let k = 0; k < n * n; k++) {
      const [mx, mz] = middle(k);
      if (Math.hypot(mx - 3.1, mz + 5.3) < 1.7 - Math.SQRT2 && !(b.flags[k] & NAV_FLAGS.object)) missed++;
    }
    ok(cells.length >= 4 && far && missed === 0, `a trunk 1.7 m round standing in the band blocks the ${cells.length} cells its disc reaches, every one it covers and none past it`);
    const above = fresh();
    rasterParts(above, [part({ kind: 'cyl', x: 0, z: 0, r: 3, y: 8, hy: 2 })]);
    ok(blocked(above).length === 0, 'a cylinder wholly over a body (from 6 to 10 m) blocks nothing');
    const ball = fresh();
    rasterParts(ball, [part({ kind: 'ball', x: 0, z: 0, r: 3, y: 4.2 })]);
    // A ball 3 m round at 4.2 m reaches down to 1.2 m at its middle and stays over 1.6 m past 2.15 m from it.
    ok(blocked(ball).length > 0 && blocked(ball).every((k) => Math.hypot(...middle(k)) <= Math.sqrt(9 - (4.2 - 1.6) ** 2) + Math.SQRT2), "a ball by its own span over each point: only where it comes down into the band");
    const turnBox = 0.5;
    const box = fresh();
    rasterParts(box, [part({ kind: 'box', x: 10, z: 6, hx: 6, hy: 1, hz: 1.5, y: 1, qy: Math.sin(turnBox / 2), qw: Math.cos(turnBox / 2) })]);
    const o = new THREE.Object3D();
    o.position.set(10, 1, 6);
    o.rotation.y = turnBox;
    o.updateMatrixWorld(true);
    const inv = o.matrixWorld.clone().invert();
    const v = new THREE.Vector3();
    const boxCells = blocked(box);
    const inTurned = boxCells.every((k) => {
      const [mx, mz] = middle(k);
      v.set(mx, 1, mz).applyMatrix4(inv);
      return Math.abs(v.x) <= 6 + Math.SQRT2 && Math.abs(v.z) <= 1.5 + Math.SQRT2;
    });
    v.set(5, 1, 0).applyMatrix4(o.matrixWorld);
    const endK = Math.floor((v.z + 40) / 2) * n + Math.floor((v.x + 40) / 2);
    ok(boxCells.length >= 6 && inTurned && (box.flags[endK] & NAV_FLAGS.object) !== 0, `a log's box turned 0.5 rad about up blocks ${boxCells.length} cells, all inside its turned footprint (three's own turn), its far end among them`);
    const mesh = fresh();
    rasterParts(mesh, [part({ kind: 'mesh', verts: new Float32Array([-3, 0, -1, 3, 0, -1, 0, 2, 1]), idx: new Uint32Array([0, 1, 2]) })]);
    ok(blocked(mesh).length > 0, 'a mesh by its own triangles, as a placed object is');
  }
}

{
  // The key: edit files fold in with their line endings folded; none, and it is the key it was.
  const dir = join(PACKS, 'watertabletest');
  if (!existsSync(join(dir, 'layout.json'))) note('watertabletest is not converted: the key over edit files is not checked here');
  else {
    const none = layoutKeyOf(dir, wt, null);
    ok(layoutKeyOf(dir, wt, PLAIN) === none, 'a world with no edit files keys exactly as it did before them');
    const water = waterFileText('watertabletest', [{ id: 'a', kind: 'lake', h: 1, points: [[0, 0], [10, 0], [10, 10]], shader: null }]);
    const withLf = { world: 'watertabletest', texts: { ...PLAIN.texts, water } };
    const withCrlf = { world: 'watertabletest', texts: { ...PLAIN.texts, water: water.replace(/\n/g, '\r\n') } };
    const k1 = layoutKeyOf(dir, wt, withLf);
    ok(k1 !== none, 'a water file moves the key');
    ok(layoutKeyOf(dir, wt, withCrlf) === k1, 'and its line endings do not (a checkout with core.autocrlf keys as the one that wrote it)');
    for (const kind of GRID_EDIT_KINDS) {
      const one = { world: 'watertabletest', texts: { ...PLAIN.texts, [kind]: '{}' } };
      ok(layoutKeyOf(dir, wt, one) !== none && layoutKeyOf(dir, wt, one) !== layoutKeyOf(dir, wt, { world: 'x', texts: { ...PLAIN.texts, [kind === 'heights' ? 'water' : 'heights']: '{}' } }), `a ${kind} file moves the key, and not as another kind's same text does`);
    }
    ok(gridLayoutStale({ layoutKey: none }, dir, null, wt, withLf) !== null, 'a grid baked with no edit files is stale once the world has one');
    ok(gridLayoutStale({ layoutKey: k1 }, dir, null, wt, withLf) === null, 'and a grid baked from the files the world has is not');
    ok(gridLayoutStale({}, dir, null, wt, withLf) !== null && gridLayoutStale({}, dir, null, wt, PLAIN) === null, 'a grid with no key is stale only where the world has edit files');
    ok(!anyGridEdits(PLAIN) && anyGridEdits(withLf), 'anyGridEdits says whether there is one');

    // A solid row whose model this install lacks (a gallery house it has not converted, another world's model) folds into
    // the key: the grid baked without it is asked for again the day the install holds it.
    const rows = (model: string, from?: string) => placementsFileText('watertabletest', 'raw', [{ id: 'w5-key', kind: 'building', pack: from ? 'world' : 'gallery', model, ...(from ? { from } : {}), x: 0, y: 0, z: 0, q: [1, 0, 0, 0] } as never]);
    const folder = mkdtempSync(join(tmpdir(), 'mm2-w5-key-'));
    try {
      const write = (text: string) => {
        mkdirSync(join(folder, 'world'), { recursive: true });
        writeFileSync(join(folder, 'world', 'watertabletest.json'), text);
      };
      write(rows('no_such_house_w5'));
      const lacking = gridEditsOf('watertabletest', folder, dir);
      ok(lacking.absent?.join() === 'gallery/no_such_house_w5', `a row naming a model this install lacks is named (${lacking.absent?.join()})`);
      const keyLacking = layoutKeyOf(dir, wt, lacking);
      // (The pack folder also hands its terrain's rivers' stamp, the sixth wave's, which watertabletest's terrain has.)
      ok(keyLacking !== layoutKeyOf(dir, wt, { world: 'watertabletest', texts: lacking.texts, soeRivers: lacking.soeRivers }), 'and folds into the key, so the grid baked while it is lacking is asked for again once it is there');
      if (existsSync(join(PACKS, 'gallery', 'manifest.json'))) {
        write(rows('ply_corl_house_sm_s01_fp1'));
        const held = gridEditsOf('watertabletest', folder, dir);
        ok(held.absent?.length === 0 && layoutKeyOf(dir, wt, held) === layoutKeyOf(dir, wt, { world: 'watertabletest', texts: held.texts, soeRivers: held.soeRivers }), 'a row whose model the install holds names nothing, and keys as the files alone');
      }
      write(rows('anything', 'no_such_world_w5'));
      ok(gridEditsOf('watertabletest', folder, dir).absent?.join() === 'no_such_world_w5/anything', "a row out of a world this install has not converted is named under that world");
      // A mark (Map-maker II's seventh wave: an effect or a sound with no model) stands nothing: no model is looked for, none named.
      write(placementsFileText('watertabletest', 'raw', [{ id: 'mark-1', kind: 'mark', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], attach: [{ fx: 'props:particles/fire.json' }] } as never]));
      ok(gridEditsOf('watertabletest', folder, dir).absent?.length === 0, 'a mark in the files is no solid row, and names no model the install lacks');
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
    // A drawn course in the track file beside a placements folder (the owner's first step on a world with no edit file)
    // takes the every-grid loop's edit-files branch: the stamp is read, `anyGridEdits` stays false, and the key moves.
    const root = mkdtempSync(join(tmpdir(), 'rd-w2-navedits-'));
    try {
      const placed = join(root, 'placements');
      mkdirSync(placed);
      mkdirSync(join(root, 'tracks'));
      const t = drawTrack('road', 'Road', [{ x: -60, z: 0, y: 5 }, { x: 60, z: 0, y: 5 }], false, courseCtx(() => 5)) as TrackDef;
      writeFileSync(join(root, 'tracks', 'watertabletest.json'), trackFileText('watertabletest', 'raw', [t]));
      const drawn = gridEditsOf('watertabletest', placed, dir) as ReturnType<typeof gridEditsOf> & { course?: string };
      ok(!anyGridEdits(drawn) && hasOwnerEdits(drawn) && layoutKeyOf(dir, wt, drawn) !== layoutKeyOf(dir, wt, gridEditsOf('watertabletest', null, dir)), "a drawn course alone (no edit file) counts as the owner's edits in the every-grid loop, and moves the key");
      const gateOnly = { ...t } as TrackDef;
      delete (gateOnly as { course?: unknown }).course;
      writeFileSync(join(root, 'tracks', 'watertabletest.json'), trackFileText('watertabletest', 'raw', [gateOnly]));
      ok(!hasOwnerEdits(gridEditsOf('watertabletest', placed, dir) as ReturnType<typeof gridEditsOf> & { course?: string }), 'and a file of gate-only tracks does not');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}

/** The old navgrid.mjs and finalnames.mjs out of git (49e5960), their relative imports at today's files, kept until the end. */
const OLD = '49e5960';
async function oldBake(): Promise<{ buildNavGrid: typeof buildNavGrid; layoutKeyOf: typeof layoutKeyOf; done: () => void } | null> {
  const files = ['tools/swg/navgrid.mjs', 'tools/swg/finalnames.mjs'];
  const texts = oldTexts(files, OLD);
  if (!texts) return null;
  const tmp = mkdtempSync(join(tmpdir(), 'mm2-w5-old-'));
  for (const f of files) {
    const from = resolve(REPO, f, '..');
    const point = (p: string): string => pathToFileURL(resolve(from, p)).href;
    // Its imports, its one dynamic import and every path it works out from its own place (`import.meta.url`: the names
    // list's manifests) at today's tree.
    const text = texts
      .get(f)!
      .replace(/from '(\.\.?\/[^']+)'/g, (_m, p: string) => `from '${point(p)}'`)
      .replace(/import\('(\.\.?\/[^']+)'\)/g, (_m, p: string) => `import('${point(p)}')`)
      .replace(/import\.meta\.url/g, `'${pathToFileURL(resolve(REPO, f)).href}'`);
    writeFileSync(join(tmp, f.split('/').pop()!), text);
  }
  const nav = await import(pathToFileURL(join(tmp, 'navgrid.mjs')).href);
  const fin = await import(pathToFileURL(join(tmp, 'finalnames.mjs')).href);
  return { buildNavGrid: nav.buildNavGrid, layoutKeyOf: fin.layoutKeyOf, done: () => rmSync(tmp, { recursive: true, force: true }) };
}

const old = await oldBake();
try {
  if (!old) note(`git could not hand over ${OLD}'s bake: the day-one comparison is not made here`);
  else {
    // Day one: the bake of 49e5960 and today's, with no edit files, on the small converted worlds.
    let compared = 0;
    for (const w of ['watertabletest', 'rivertest', 'umbra', 'kashyyyk_main']) {
      const dir = join(PACKS, w);
      if (!existsSync(join(dir, 'nav.json'))) continue;
      const a = await old.buildNavGrid(dir, { walkThrough: wt });
      // From the sixth wave the terrain's own wet rivers are water to the bake (rivertest's and watertabletest's), so the
      // comparison with the bake before them leaves them out (`soeRivers: false`); riverGrid.test holds what they add.
      const b = await buildNavGrid(dir, { walkThrough: wt, edits: PLAIN, soeRivers: false });
      ok(planes(a).equals(planes(b)), `${w}: today's bake with no edit files (and the terrain's own rivers left out) is 49e5960's to the byte (${planes(b).length} bytes)`);
      const disk = inflateRawSync(readFileSync(join(dir, 'nav.bin')));
      // A world whose terrain has rivers is on disk as baked with them (the sixth wave's conversion; riverGrid.test holds it).
      const rivers = soeRiverStamp(dir) !== '';
      const full = rivers ? await buildNavGrid(dir, { walkThrough: wt, edits: PLAIN }) : b;
      if (planes(full).equals(disk)) ok(true, `${w}: and ${rivers ? "with its terrain's own rivers " : ''}is the grid on disk`);
      else note(`${w}: the grid on disk was baked from something else (a converter run since?)`);
      compared++;
    }
    if (!compared) note('no small converted world: the day-one bake is not compared');
    // Every grid on disk: the key with no edit files is 49e5960's key. The edits as the converter's own run reads them (with
    // the pack's folder, so a terrain with rivers carries its stamp, the sixth wave's): such a world keys anew by design,
    // and is held to the key of its own grid on disk rather than to 49e5960's.
    let keys = 0;
    let stale = 0;
    const editWorlds: string[] = [];
    const riverWorlds: string[] = [];
    for (const name of existsSync(PACKS) ? readdirSync(PACKS) : []) {
      const dir = join(PACKS, name);
      if (!existsSync(join(dir, 'nav.json')) || !existsSync(join(dir, 'layout.json'))) continue;
      const edits = gridEditsOf(name, undefined, dir) as ReturnType<typeof gridEditsOf> & { soeRivers?: string; course?: string };
      if (hasOwnerEdits(edits)) {
        editWorlds.push(name);
        ok(layoutKeyOf(dir, wt, edits) !== layoutKeyOf(dir, wt, PLAIN), `${name} has committed edit files: its key folds them in`);
        continue;
      }
      const head = JSON.parse(readFileSync(join(dir, 'nav.json'), 'utf8')) as { layoutKey?: string };
      if (edits.soeRivers) {
        riverWorlds.push(name);
        assert.notEqual(layoutKeyOf(dir, wt, edits), old.layoutKeyOf(dir, wt), `${name}: its terrain's own rivers fold their stamp into its key`);
      } else assert.equal(layoutKeyOf(dir, wt, edits), old.layoutKeyOf(dir, wt), `${name}: the key with no edit files is 49e5960's`);
      if (head.layoutKey && head.layoutKey !== layoutKeyOf(dir, wt, edits)) stale++;
      keys++;
    }
    ok(keys > 0 || !existsSync(PACKS), `every grid on disk of a world with no edit files keys as 49e5960 keyed it, the terrain's own rivers' stamp aside (${keys} grids${riverWorlds.length ? `, ${riverWorlds.join(' and ')} with the stamp` : ''}${stale ? `, ${stale} stale for their own reasons` : ''})`);
    if (editWorlds.length) note(`worlds with committed edit files, whose grids status asks for again: ${editWorlds.join(', ')}`);
  }
} finally {
  old?.done();
}

{
  // The bake over edit files, on one small world, against its plain bake.
  const world = 'watertabletest';
  const dir = join(PACKS, world);
  if (!existsSync(join(dir, 'nav.json')) || !existsSync(join(PACKS, 'gallery', 'manifest.json'))) note(`${world} or the gallery is not converted: the bake over edit files is not checked here`);
  else {
    const layout = JSON.parse(readFileSync(join(dir, 'layout.json'), 'utf8')) as { center: { x: number; z: number }; terrain?: string; objects: { layer?: string }[] };
    ok(!layout.objects.some((o) => o.layer), `${world} stands no building's terrain layer (the poles below are the generator's own)`);
    const trn = await import('../../../src/swg/terrain/trn.ts');
    const template = trn.parseTerrainTemplate(new Uint8Array(readFileSync(join(dir, layout.terrain ?? 'terrain.trn'))));
    for (const b of trn.bitmapFiles(template)) {
      const f = join(dir, b.file);
      if (existsSync(f)) trn.attachBitmap(template, b.familyId, new Uint8Array(readFileSync(f)));
    }
    const sampler = new trn.TerrainSampler(template);
    const plain = await buildNavGrid(dir, { walkThrough: wt, edits: PLAIN });
    const { nx, nz, cell, x0, z0 } = plain.header as { nx: number; nz: number; cell: number; x0: number; z0: number };
    const cx = layout.center.x;
    const cz = layout.center.z;
    const W = (nx * cell) / 4;
    ok(cell === 2 && Number.isInteger(W), 'a 2 m grid, its poles on whole raw poles');
    // Raw pole (px, pz) is game pole (W - px, pz + W); cell (i, j) spans game poles i..i+1, j..j+1.
    const rawGround = (px: number, pz: number): number => sampler.heightAt(px * 2, pz * 2);
    const cellOfGame = (gx: number, gz: number): [number, number] => [Math.floor((gx - x0) / cell), Math.floor((gz - z0) / cell)];
    // Three raw tiles of open ground (every cell of the tile and the one round it walkable in the plain bake, no slope).
    const openTile = (tx: number, tz: number): boolean => {
      for (let pz = tz * 32 - 2; pz <= tz * 32 + 33; pz++) {
        for (let px = tx * 32 - 2; px <= tx * 32 + 33; px++) {
          const i = W - px;
          const j = pz + W;
          if (i < 0 || j < 0 || i >= nx || j >= nz) return false;
          const k = j * nx + i;
          if (!walkable(nibbleOf(plain.nibbles, k)) || plain.flags[k]) return false;
        }
      }
      return true;
    };
    const TILES = 8;
    const tiles: [number, number][] = [];
    for (let r = 0; r < 16 && tiles.length < TILES; r++) {
      for (let tz = -r; tz <= r && tiles.length < TILES; tz += 3) {
        for (let tx = -r; tx <= r && tiles.length < TILES; tx += 3) {
          if (tiles.some(([a, b]) => Math.abs(a - tx) < 3 && Math.abs(b - tz) < 3)) continue;
          if (openTile(tx, tz)) tiles.push([tx, tz]);
        }
      }
    }
    ok(tiles.length === TILES, `${TILES} tiles of open ground found (${tiles.map(([a, b]) => `${a},${b}`).join(' ')})`);
    const [wall, deep, shallow, house, turnedTile, propTile, floraTile, theaterTile] = tiles;
    // The wall: a ramp along raw x at 60°, a delta rising 2 tan 60° a pole from local pole 10, held at 20 m.
    const rise = 2 * Math.tan((60 * Math.PI) / 180);
    const wallD = new Float32Array(32 * 32);
    for (let lz = 0; lz < 32; lz++) for (let lx = 0; lx < 32; lx++) wallD[lz * 32 + lx] = Math.min(20, Math.max(0, (lx - 10) * rise));
    const deltaAt = (px: number, pz: number): number => {
      const lx = px - wall[0] * 32;
      const lz = pz - wall[1] * 32;
      return lx >= 0 && lx < 32 && lz >= 0 && lz < 32 ? wallD[lz * 32 + lx] : 0;
    };
    const heightsText = heightsFileText(world, [{ id: tileIdOf(wall[0], wall[1]), d: deflateRawSync(Buffer.from(deltaBytes(wallD))).toString('base64'), on: '00000000' }]);
    // The lakes: a square 44 m across in the deep tile at its highest ground and 3 m more, and one in the shallow tile at
    // its lowest ground and half a metre.
    const lakeOver = (t: [number, number], from: 'deep' | 'shallow'): { id: string; kind: 'lake'; h: number; points: [number, number][]; shader: null } => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let pz = t[1] * 32; pz <= t[1] * 32 + 32; pz++) {
        for (let px = t[0] * 32; px <= t[0] * 32 + 32; px++) {
          const g = rawGround(px, pz);
          lo = Math.min(lo, g);
          hi = Math.max(hi, g);
        }
      }
      const x = t[0] * 64;
      const z = t[1] * 64;
      return { id: `lake-${from}`, kind: 'lake', h: from === 'deep' ? hi + 3 : lo + 0.5, points: [[x + 10, z + 10], [x + 54, z + 10], [x + 54, z + 54], [x + 10, z + 54]], shader: null };
    };
    const lakes = [lakeOver(deep, 'deep'), lakeOver(shallow, 'shallow')];
    const waterText = waterFileText(world, lakes);
    // The houses: a gallery house with rooms at a tile's middle on the ground, unturned; the theater (whose footprint is long
    // and off its origin, where the small house's is a square about it) unturned in one tile and turned about up by 1.2 rad
    // in another (no quarter, so a turn the wrong way round or none at all shows); and the house standing in a room (a room's
    // furniture, as a contained object is), which rasterises nothing outdoors.
    const HOUSE = 'ply_corl_house_sm_s01_fp1';
    const THEATER = 'ply_corl_theater_s01';
    const hx = house[0] * 64 + 32;
    const hz = house[1] * 64 + 32;
    const hy = sampler.heightAt(hx, hz);
    const turn = 1.2;
    const tx2 = turnedTile[0] * 64 + 32;
    const tz2 = turnedTile[1] * 64 + 32;
    const tx3 = theaterTile[0] * 64 + 32;
    const tz3 = theaterTile[1] * 64 + 32;
    const houseRow = { id: 'w5-house', kind: 'building', pack: 'gallery', model: HOUSE, x: hx, y: hy, z: hz, q: [1, 0, 0, 0] as [number, number, number, number] };
    const theaterRow = { id: 'w5-theater', kind: 'building', pack: 'gallery', model: THEATER, x: tx3, y: sampler.heightAt(tx3, tz3), z: tz3, q: [1, 0, 0, 0] as [number, number, number, number] };
    const turnedRow = { id: 'w5-turned', kind: 'building', pack: 'gallery', model: THEATER, x: tx2, y: sampler.heightAt(tx2, tz2), z: tz2, q: [Math.cos(turn / 2), 0, Math.sin(turn / 2), 0] as [number, number, number, number] };
    // The props: a solid thing of the props catalogue at its own size (in the story file) and at a scale of 2 along x and a
    // half along z (in the world file), and a seat with no word (passable, as the game stands it) and one that says
    // `solid: true`. Chosen from the catalogue by what they are, the first of each by id.
    const props = JSON.parse(readFileSync(join(PACKS, 'props', 'manifest.json'), 'utf8')) as { props: { id: string; template: string; file?: string; bounds?: { min: number[]; max: number[] }; size?: { w: number; h: number; d: number } }[] };
    const there = (p: { file?: string }): boolean => !!p.file && existsSync(join(PACKS, 'props', p.file));
    const byId = [...props.props].sort((a, b) => (a.id < b.id ? -1 : 1));
    // A thing whose own triangles in a body's band spread 3 m or more along both of its axes, so each scale shows.
    const bandSpread = (p: { file?: string }): boolean => {
      const tri = readGlbTriangles(join(PACKS, 'props', p.file!));
      let x0b = Infinity;
      let x1b = -Infinity;
      let z0b = Infinity;
      let z1b = -Infinity;
      for (let k = 0; k + 2 < tri.positions.length; k += 3) {
        const y = tri.positions[k + 1];
        if (y < 0.6 || y > 1.5) continue;
        x0b = Math.min(x0b, tri.positions[k]);
        x1b = Math.max(x1b, tri.positions[k]);
        z0b = Math.min(z0b, tri.positions[k + 2]);
        z1b = Math.max(z1b, tri.positions[k + 2]);
      }
      return x1b - x0b >= 3 && z1b - z0b >= 3;
    };
    const solidThing = byId.find((p) => there(p) && !isSeat(p.template) && !isTableTemplate(p.template) && p.size && p.size.w >= 4 && p.size.w <= 8 && p.size.d >= 4 && p.size.d <= 8 && p.size.h >= 1.8 && p.size.h <= 8 && Math.min(p.bounds!.min[1], p.bounds!.max[1]) > -0.2 && bandSpread(p));
    const seat = byId.find((p) => there(p) && isSeat(p.template) && p.size && p.size.h >= 0.8 && p.size.h <= 1.5 && Math.min(p.bounds!.min[1], p.bounds!.max[1]) > -0.1);
    const at = (t: [number, number], u: number, v: number) => {
      const x = t[0] * 64 + u;
      const z = t[1] * 64 + v;
      return { x, y: sampler.heightAt(x, z), z };
    };
    const propRows = [
      solidThing && { id: 'w5-prop', kind: 'prop', pack: 'props', thing: solidThing.id, ...at(propTile, 16, 16), q: [1, 0, 0, 0] },
      solidThing && { id: 'w5-prop-scaled', kind: 'prop', pack: 'props', thing: solidThing.id, ...at(propTile, 48, 16), q: [1, 0, 0, 0], scale: [2, 1, 0.5] },
      seat && { id: 'w5-seat', kind: 'prop', pack: 'props', thing: seat.id, ...at(propTile, 16, 48), q: [1, 0, 0, 0] },
      seat && { id: 'w5-seat-solid', kind: 'prop', pack: 'props', thing: seat.id, ...at(propTile, 48, 48), q: [1, 0, 0, 0], solid: true },
    ];
    // The flora: this world's own flower bush, whose extent is NULL (the client walked through it) while its triangles stand
    // in a body's band, and a Naboo eucalyptus out of another world (`from`), whose extent is its trunk's cylinder.
    const nabooFlora = existsSync(join(PACKS, 'naboo', 'manifest.json')) && existsSync(join(PACKS, 'naboo', 'flora-collision.json'));
    const floraRows = [
      { id: 'w5-bush', kind: 'prop', pack: 'world', model: 'shrb_flowerbush_sm', ...at(floraTile, 16, 32), q: [1, 0, 0, 0] },
      nabooFlora && { id: 'w5-tree', kind: 'prop', pack: 'world', model: 'ever_eucalyptus_med', from: 'naboo', ...at(floraTile, 48, 32), q: [1, 0, 0, 0] },
    ];
    const worldText = placementsFileText(world, 'raw', [
      houseRow,
      theaterRow,
      turnedRow,
      { id: 'w5-inside', kind: 'building', pack: 'gallery', model: HOUSE, x: hx - 300, y: hy, z: hz, q: [1, 0, 0, 0], inside: true },
      ...propRows.slice(1),
      ...floraRows,
    ].filter(Boolean) as never[]);
    // One solid row in the story file (the unscaled prop): the bake reads both files.
    const storyText = propRows[0] ? placementsFileText(world, 'raw', [propRows[0]] as never[]) : null;
    if (!solidThing || !seat) note(`the props catalogue lacks ${!solidThing ? 'a solid thing of 4 to 8 m' : ''}${!solidThing && !seat ? ' and ' : ''}${!seat ? 'a seat' : ''}: those rows are not checked`);
    if (!nabooFlora) note('naboo is not converted with its flora collision: the trunk of another world is not checked');
    const edits = { world, texts: { heights: heightsText, water: waterText, world: worldText, story: storyText } };
    const said: string[] = [];
    const g = await buildNavGrid(dir, { walkThrough: wt, edits, log: (l: string) => said.push(l) });
    const stats = (g.header as { stats: { edits?: { tiles: number; lakes: number; rows: number; floraRows: number; rowsMissing: number; absent: string[] } } }).stats;
    // The houses (3), the props but the passable seat (3), the bush and the tree (2): the room's row and the seat stand nothing.
    const wantRows = 3 + (solidThing ? 2 : 0) + (seat ? 1 : 0) + 1 + (nabooFlora ? 1 : 0);
    ok(stats.edits?.tiles === 1 && stats.edits.lakes === 2 && stats.edits.rows === wantRows && stats.edits.floraRows === 1 + (nabooFlora ? 1 : 0) && stats.edits.rowsMissing === 0 && stats.edits.absent.length === 0, `the bake read one tile, two lakes and ${wantRows} solid rows out in the open, of the world file and the story file both, its flora by their own shapes (${JSON.stringify(stats.edits)}), and says so in its header`);
    ok(!('edits' in (plain.header as { stats: object }).stats), "and a world with none writes the header it always did");

    // Nothing opened: a cell the plain bake does not let a body walk is never walkable over the edits.
    let opened = 0;
    for (let k = 0; k < nx * nz; k++) if (!walkable(nibbleOf(plain.nibbles, k)) && walkable(nibbleOf(g.nibbles, k))) opened++;
    ok(opened === 0, 'not one cell the plain bake blocks is opened by the edit files');

    // The wall: the cells whose poles step past the slope test's limit, by the generator's own poles with the deltas laid
    // as the game lays them (`fround(raw + d)`), are exactly its slope cells there; each of them and one step round blocked.
    const limit = Math.tan((SLOPE_CLIMB_DEGREES * Math.PI) / 180);
    const pole = (i: number, j: number): number => {
      const px = W - i;
      const pz = j - W;
      const d = deltaAt(px, pz);
      // The bake's lattice is single precision, and a delta is laid over it as `fround(raw + d)`.
      const raw = Math.fround(rawGround(px, pz));
      return d ? Math.fround(raw + d) : raw;
    };
    let expected = 0;
    let wrong = 0;
    const steepCells: number[] = [];
    for (let pz = wall[1] * 32 - 3; pz <= wall[1] * 32 + 34; pz++) {
      for (let px = wall[0] * 32 - 3; px <= wall[0] * 32 + 34; px++) {
        const i = W - px;
        const j = pz + W;
        const h = pole(i, j);
        const dx = Math.abs(pole(i + 1, j) - h);
        const dz = Math.abs(pole(i, j + 1) - h);
        const dd = Math.abs(pole(i + 1, j + 1) - h) / Math.SQRT2;
        const steep = Math.max(dx, dz, dd) / 2 > limit;
        const k = j * nx + i;
        const flagged = (g.flags[k] & NAV_FLAGS.slope) !== 0;
        if (steep) {
          expected++;
          steepCells.push(k);
        }
        if (steep !== flagged) wrong++;
      }
    }
    ok(expected > 64 && wrong === 0, `the 60° wall: exactly the ${expected} cells the poles say are steep are its slope cells (${wrong} differ)`);
    let ringOpen = 0;
    for (const k of steepCells) {
      for (const n of [k, k - 1, k + 1, k - nx, k + nx]) if (walkable(nibbleOf(g.nibbles, n))) ringOpen++;
    }
    ok(ringOpen === 0, 'each of them blocked, and one step round it (the body\'s own margin)');
    // The flat top of the wall stands 20 m up and walks.
    const [ti, tj] = [W - (wall[0] * 32 + 24), wall[1] * 32 + 16 + W];
    ok(walkable(nibbleOf(g.nibbles, tj * nx + ti)), 'and the flat ground on top of it walks');

    // The lakes: a cell whose middle stands well inside the deep lake is water, well outside it never; the shallow lake
    // blocks nothing.
    const inRect = (gx: number, gz: number, t: [number, number], pad: number): number => {
      // The lake's square in the game's frame: raw x from t*64+10 to +54 is game x from cx - t*64 - 54 to cx - t*64 - 10.
      const ax = cx - t[0] * 64 - 54;
      const bx = cx - t[0] * 64 - 10;
      const az = t[1] * 64 + 10 - cz;
      const bz = t[1] * 64 + 54 - cz;
      if (gx > ax + pad && gx < bx - pad && gz > az + pad && gz < bz - pad) return 1;
      if (gx < ax - pad || gx > bx + pad || gz < az - pad || gz > bz + pad) return -1;
      return 0;
    };
    let inside = 0;
    let insideWet = 0;
    let outsideWet = 0;
    let shallowWet = 0;
    for (const [t, deepOne] of [[deep, true], [shallow, false]] as const) {
      const [i0, j0] = cellOfGame(cx - t[0] * 64 - 70, t[1] * 64 - 6 - cz);
      const [i1, j1] = cellOfGame(cx - t[0] * 64 + 6, t[1] * 64 + 70 - cz);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = j * nx + i;
          const where = inRect(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell, t, 2);
          const wet = (g.flags[k] & NAV_FLAGS.water) !== 0;
          if (!deepOne) {
            if (wet) shallowWet++;
            continue;
          }
          if (where === 1) {
            inside++;
            if (wet && !walkable(nibbleOf(g.nibbles, k))) insideWet++;
          } else if (where === -1 && wet) outsideWet++;
        }
      }
    }
    ok(inside > 300 && insideWet === inside, `a lake of ours 3 m over its highest ground (its level ${lakes[0].h.toFixed(2)} m): all ${inside} cells well inside it are water and blocked`);
    ok(outsideWet === 0, 'and not one cell well outside it');
    ok(shallowWet === 0, `a lake of ours half a metre over its lowest ground (under ${SWIM_DEPTH} m) blocks nothing`);

    // A row's place in the game's frame as the game stands it (`toGame`, the very read of a row the streamer stands): its
    // matrix, built by three, and its inverse, so a cell's middle is read in the row's own frame.
    const frameOf = (row: { x: number; y: number; z: number; q: [number, number, number, number]; scale?: number | number[] }): { m: THREE.Matrix4; inv: THREE.Matrix4 } => {
      const p = toGame(row as never, { x: cx, z: cz }, 'raw');
      const s = Array.isArray(row.scale) ? row.scale : [row.scale ?? 1, row.scale ?? 1, row.scale ?? 1];
      const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion(p.q[0], p.q[1], p.q[2], p.q[3]), new THREE.Vector3(s[0], s[1], s[2]));
      return { m, inv: m.clone().invert() };
    };
    const local = new THREE.Vector3();

    // The houses: rasterised as a placed object is, through their own rooms and triangles and their own turn: each one's
    // footprint indoor where it rises, inside its own turned box and nowhere outside it, never its whole box blocked, the
    // ground round it open as it was, and the outside point of every way in on the ground open (`exitsFrom`, the very
    // points the game walks a body to before it hands it to the rooms' own floors).
    const gal = JSON.parse(readFileSync(join(PACKS, 'gallery', 'manifest.json'), 'utf8')) as { categories: Record<string, { id: string; bounds: { min: number[]; max: number[] }; cells?: unknown[]; portals?: unknown[] }[]> };
    const galDefs = Object.values(gal.categories).flat();
    if (!galDefs.some((e) => e.id === HOUSE) || !galDefs.some((e) => e.id === THEATER)) note(`the gallery has no ${HOUSE} or ${THEATER}: the houses are not checked`);
    else {
      // Each house's footprint cells read in its own frame: the turned theater's must be the unturned one's, turned with it.
      const footLocal = new Map<string, [number, number][]>();
      for (const [row, label] of [[houseRow, 'the small house, unturned'], [theaterRow, 'the theater, unturned'], [turnedRow, `the theater, turned ${turn} rad about up`]] as const) {
        const def = galDefs.find((e) => e.id === row.model)!;
        const bmin = [0, 1, 2].map((a) => Math.min(def.bounds.min[a], def.bounds.max[a]));
        const bmax = [0, 1, 2].map((a) => Math.max(def.bounds.min[a], def.bounds.max[a]));
        const graph = buildRoomGraph(def.cells as never, def.portals as never);
        const foot: [number, number][] = [];
        footLocal.set(row.id, foot);
        const { m, inv } = frameOf(row);
        const pos = new THREE.Vector3().setFromMatrixPosition(m);
        // Out to the box's farthest corner and 10 m more, in the game's frame.
        const reach = Math.hypot(Math.max(-bmin[0], bmax[0]), Math.max(-bmin[2], bmax[2])) + 10;
        const [i0, j0] = cellOfGame(pos.x - reach, pos.z - reach);
        const [i1, j1] = cellOfGame(pos.x + reach, pos.z + reach);
        let boxCells = 0;
        let indoor = 0;
        let indoorOut = 0;
        let blocked = 0;
        let ringCells = 0;
        let ringChanged = 0;
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const k = j * nx + i;
            local.set(x0 + (i + 0.5) * cell, pos.y, z0 + (j + 0.5) * cell).applyMatrix4(inv);
            const out = Math.max(bmin[0] - local.x, local.x - bmax[0], bmin[2] - local.z, local.z - bmax[2]);
            const isIndoor = (g.flags[k] & NAV_FLAGS.indoor) !== 0;
            if (out < 0) {
              boxCells++;
              if (isIndoor) indoor++;
              if (nibbleOf(g.nibbles, k) === 0) blocked++;
            } else if (out > 4) {
              ringCells++;
              if (walkable(nibbleOf(g.nibbles, k)) !== walkable(nibbleOf(plain.nibbles, k))) ringChanged++;
            }
            // A footprint cell's middle may stand up to half a cell's diagonal past the box, never more.
            if (isIndoor && out > cell) indoorOut++;
            if (isIndoor) foot.push([local.x, local.z]);
          }
        }
        ok(indoor > 10 && indoorOut === 0, `${label}, a solid row: ${indoor} of its turned box's ${boxCells} cells are its footprint (indoor) where it rises over the ground, and not one beyond its own turned box`);
        ok(blocked < boxCells, `never its whole box blocked (${blocked} of ${boxCells} box cells blocked)`);
        ok(ringCells > 50 && ringChanged === 0, `the ground 4 m round its turned box walks as it did (${ringCells} cells)`);
        // Its ways in on the ground, and each one's outside point open.
        const exits = exitsFrom(graph, def.portals as never, m, DOOR_TUNE.step).filter((e) => Math.abs(e.sill - sampler.heightAt(cx - e.outX, e.outZ + cz)) < 1);
        // The world's own open ground (its largest region) stands a few metres from every outside point: what the game's goal
        // snap (`OUTDOOR_TUNE.goalSnap`, 40 m) pulls a body's goal at that point onto before the walk through the doorway. The
        // cell under the point itself is not open on this house, unturned or turned, and that is the bake's own rule and not
        // this wave's: a 2 m cell takes the entry's own geometry (its porch, its frame) as an object, and turned off the
        // grid's axes the cell holding the doorstep also holds room geometry and reads as the footprint, as on every copy the
        // snapshot places. Measured and said (`swallowed`), never asserted open.
        let swallowed = 0;
        let near = 0;
        for (const e of exits) {
          const [oi, oj] = cellOfGame(e.outX, e.outZ);
          if (g.flags[oj * nx + oi] & NAV_FLAGS.indoor) swallowed++;
          let best = Infinity;
          for (let dj = -4; dj <= 4; dj++) {
            for (let di = -4; di <= 4; di++) {
              if (nibbleOf(g.nibbles, (oj + dj) * nx + oi + di) !== 1) continue;
              best = Math.min(best, Math.hypot(x0 + (oi + di + 0.5) * cell - e.outX, z0 + (oj + dj + 0.5) * cell - e.outZ));
            }
          }
          near = Math.max(near, best);
        }
        ok(exits.length > 0 && near <= 4 * cell, `and every way in on the ground (${exits.length}) has the world's own open ground within ${near.toFixed(1)} m of its outside point, ${DOOR_TUNE.step} m out (${swallowed} of those points' own cells read as the footprint)`);
      }
      // The theater's two footprints in their own frames: each cell of one within a cell's diagonal of a cell of the other, but
      // for a tenth the 2 m grid's own cut may move. Its footprint is long and off its origin (where the small house's is a
      // square about it, which a turn barely moves), so rasterised unturned the turned one's would be the unturned one's
      // turned back the other way and fall well short.
      const share = (a: [number, number][], b: [number, number][]): number => a.filter(([x, z]) => b.some(([u, v]) => Math.hypot(x - u, z - v) <= cell * Math.SQRT2)).length / Math.max(1, a.length);
      const turnedFoot = footLocal.get(turnedRow.id)!;
      const plainFoot = footLocal.get(theaterRow.id)!;
      const there1 = share(turnedFoot, plainFoot);
      const there0 = share(plainFoot, turnedFoot);
      ok(there1 >= 0.9 && there0 >= 0.9, `the turned theater's footprint, read in its own frame, is the unturned one's (${(there1 * 100).toFixed(0)}% and ${(there0 * 100).toFixed(0)}% of each within a cell's diagonal of the other's)`);
      const [ri, rj] = cellOfGame(cx - (hx - 300), hz - cz);
      ok(walkable(nibbleOf(g.nibbles, rj * nx + ri)) === walkable(nibbleOf(plain.nibbles, rj * nx + ri)) && !(g.flags[rj * nx + ri] & NAV_FLAGS.indoor), "a row standing in a room (`inside`) is a room's furniture and rasterises nothing outdoors");
    }

    // What a row blocked: the cells within `reach` of its place that are objects' over the edits and not in the plain bake,
    // and how far they spread along the game's x and z.
    const added = (row: { x: number; z: number }, reach: number): { cells: number; xs: number; zs: number; far: number } => {
      const gx = cx - row.x;
      const gz = row.z - cz;
      const [i0, j0] = cellOfGame(gx - reach, gz - reach);
      const [i1, j1] = cellOfGame(gx + reach, gz + reach);
      let cells = 0;
      let lo = [Infinity, Infinity];
      let hi = [-Infinity, -Infinity];
      let far = 0;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = j * nx + i;
          if (!(g.flags[k] & NAV_FLAGS.object) || plain.flags[k] & NAV_FLAGS.object) continue;
          cells++;
          lo = [Math.min(lo[0], i), Math.min(lo[1], j)];
          hi = [Math.max(hi[0], i), Math.max(hi[1], j)];
          far = Math.max(far, Math.hypot(x0 + (i + 0.5) * cell - gx, z0 + (j + 0.5) * cell - gz));
        }
      }
      return { cells, xs: cells ? (hi[0] - lo[0] + 1) * cell : 0, zs: cells ? (hi[1] - lo[1] + 1) * cell : 0, far };
    };
    if (solidThing) {
      const plainOne = added(propRows[0]!, 12);
      const scaled = added(propRows[1]!, 12);
      ok(plainOne.cells >= 2, `the solid thing (${solidThing.id}, ${solidThing.size!.w} by ${solidThing.size!.d} m), a row of the story file, blocks ${plainOne.cells} cells (${plainOne.xs} by ${plainOne.zs} m): the bake reads the story file`);
      ok(scaled.xs >= plainOne.xs + cell && scaled.zs <= plainOne.zs && scaled.zs < scaled.xs, `scaled 2 along x and a half along z it spreads ${scaled.xs} by ${scaled.zs} m against ${plainOne.xs} by ${plainOne.zs}: each scale on its own axis`);
    }
    if (seat) {
      ok(added(propRows[2]!, 6).cells === 0, `a seat (${seat.id}) with no word is passable, as the game stands it: it rasterises nothing`);
      ok(added(propRows[3]!, 6).cells >= 1, 'and the same seat whose row says `solid: true` blocks its cells');
    }
    {
      // The bush: by its triangles it would stand in a body's band; by its own NULL extent, as the game stands it, it blocks
      // nothing.
      const wm = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as { categories: { flora?: { id: string; file: string }[] } };
      const bush = wm.categories.flora?.find((d) => d.id === 'shrb_flowerbush_sm');
      const tri = bush ? readGlbTriangles(join(dir, bush.file)) : null;
      let inBand = 0;
      if (tri) for (let k = 1; k < tri.positions.length; k += 3) if (tri.positions[k] > 0.55 && tri.positions[k] < 1.55) inBand++;
      ok(inBand > 0 && added(floraRows[0] as { x: number; z: number }, 6).cells === 0, `a flower bush whose triangles stand in a body's band (${inBand} corners) and whose own extent is NULL blocks nothing, as the game walks through it`);
      if (nabooFlora) {
        const tree = added(floraRows[1] as { x: number; z: number }, 12);
        ok(tree.cells >= 1 && tree.far <= 0.36 + 0.14 + cell * Math.SQRT1_2, `a Naboo eucalyptus out of another world blocks its trunk's cylinder alone: ${tree.cells} cells, none past ${tree.far.toFixed(2)} m of its trunk, where its canopy reaches 5 m`);
      }
    }

    // Away from the tiles the ground walks as it did.
    let changed = 0;
    const near = (k: number): boolean => {
      const j = Math.floor(k / nx);
      const i = k - j * nx;
      const px = W - i;
      const pz = j - W;
      return tiles.some(([tx, tz]) => px >= tx * 32 - 8 && px <= tx * 32 + 40 && pz >= tz * 32 - 8 && pz <= tz * 32 + 40);
    };
    for (let k = 0; k < nx * nz; k++) if (walkable(nibbleOf(plain.nibbles, k)) !== walkable(nibbleOf(g.nibbles, k)) && !near(k)) changed++;
    ok(changed === 0, 'everywhere away from the edits the ground walks exactly as the plain bake has it');
    ok(said.some((l) => /heights file: 1 tiles laid/.test(l)) && said.some((l) => new RegExp(`permanent rows: ${wantRows} solid rows rasterised`).test(l)), 'and the bake says what it read');
  }
}

console.log(`navgridEdits: ${passed} checks passed`);
