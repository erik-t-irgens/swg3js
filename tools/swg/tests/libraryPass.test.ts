// The `library` light pass (DESIGN.md §2.5, §4): over fixture packs labelled TEST it writes the world editor's index and
// its pictures; a model the props pack already pictures is reused, never drawn again; `status` lists the pass when its
// index is missing or older than a pack it read and never puts it among the asks; the rasteriser's ground clip leaves
// every pixel of a building under its ground line out (a synthetic box with a buried part), and with the clip off draws
// exactly what 5a4e765's `thumbnail.mjs` drew, byte for byte (loaded out of git); and a glowing material's picture is
// brighter by its glow.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { buildLibrary, libraryStatus, LIBRARY_FORMAT } from '../library.mjs';
import { renderThumbnail } from '../thumbnail.mjs';
import { buildGlb } from '../sceneglb.mjs';
import { LIBRARY_VERSION } from '../../../src/editor/libraryModel.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');

/** A box's triangles (12), its bottom at `y0`. */
function box(w: number, h: number, d: number, y0: number, dx = 0): { positions: Float32Array; indices: Uint32Array } {
  const x0 = dx - w / 2;
  const x1 = dx + w / 2;
  const z0 = -d / 2;
  const z1 = d / 2;
  const y1 = y0 + h;
  const p = [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1];
  const i = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2];
  return { positions: new Float32Array(p), indices: new Uint32Array(i) };
}

/** A GLB of one box, grey, as the converter writes a model. */
function glbOf(b: { positions: Float32Array; indices: Uint32Array }): Buffer {
  const pos = Buffer.from(b.positions.buffer);
  const idx = Buffer.from(b.indices.buffer);
  const bin = Buffer.concat([pos, idx]);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'test', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.length },
      { buffer: 0, byteOffset: pos.length, byteLength: idx.length },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: b.positions.length / 3, type: 'VEC3', min: [-50, -50, -50], max: [50, 50, 50] },
      { bufferView: 1, componentType: 5125, count: b.indices.length, type: 'SCALAR' },
    ],
  };
  return buildGlb(json, bin);
}

// ---- The pass over fixture packs. ----
{
  const root = mkdtempSync(join(tmpdir(), 'swg-library-'));
  try {
    const bounds = { min: [-2, 0, -2], max: [2, 3, 2] };
    mkdirSync(join(root, 'props', 'icons'), { recursive: true });
    writeFileSync(join(root, 'props', 'icons', 'chair_m.png'), Buffer.from([0]));
    writeFileSync(join(root, 'props', 'manifest.json'), JSON.stringify({ version: 1, props: [{ id: 'test_chair', model: 'chair_m', name: 'TEST chair', group: 'furniture', template: 'object/tangible/test/shared_chair.iff', size: { w: 1, h: 1, d: 1 }, icon: 'icons/chair_m.png' }], models: [{ id: 'chair_m', file: 'chair.glb', icon: 'icons/chair_m.png', triangles: 12 }] }));
    mkdirSync(join(root, 'gallery'), { recursive: true });
    writeFileSync(join(root, 'gallery', 'house.glb'), glbOf(box(10, 20, 10, -16)));
    writeFileSync(join(root, 'gallery', 'manifest.json'), JSON.stringify({ planet: 'gallery', categories: { layout: [{ id: 'test_house', file: 'house.glb', bounds: { min: [-5, -16, -5], max: [5, 4, 5] }, triangles: 12, cells: [{ index: 0 }, { index: 1 }] }] } }));
    writeFileSync(join(root, 'gallery', 'gallery.json'), JSON.stringify({ sections: [{ id: 'houses', items: [{ model: 'test_house', label: 'TEST house', template: 'object/building/player/shared_test_house.iff' }] }, { id: 'weapons', items: [{ model: 'test_gun' }] }] }));
    mkdirSync(join(root, 'testworld'), { recursive: true });
    writeFileSync(join(root, 'testworld', 'rock.glb'), glbOf(box(4, 3, 4, 0)));
    writeFileSync(join(root, 'testworld', 'tree.glb'), glbOf(box(1, 8, 1, 0)));
    writeFileSync(join(root, 'testworld', 'manifest.json'), JSON.stringify({ planet: 'testworld', categories: { layout: [{ id: 'test_rock', file: 'rock.glb', bounds, triangles: 12 }, { id: 'chair_m', file: 'chair.glb', bounds, triangles: 12 }], flora: [{ id: 'test_tree', file: 'tree.glb', bounds: { min: [-3, 0, -3], max: [3, 8, 3] }, triangles: 12, familyName: 'TEST family' }] } }));
    writeFileSync(join(root, 'testworld', 'layout.json'), JSON.stringify({ planet: 'testworld', center: { x: 0, z: 0 }, radius: 100, objects: [{ template: 'object/static/test/shared_test_rock.iff', model: 'test_rock', x: 0, y: 0, z: 0, q: [1, 0, 0, 0], radius: 3 }, { template: 'object/static/test/shared_test_bench.iff', model: 'chair_m', x: 5, y: 0, z: 0, q: [1, 0, 0, 0], radius: 1 }] }));
    // The attachments' sources (Map-maker II's seventh wave): effects in two packs (one name in both, which the props pack
    // gives), one playing for ever and one not, and a sound bank whose one placed, endless loop that is no music is offered.
    const forever = { loopCount: [-1, -1] };
    const once = { loopCount: [1, 1] };
    mkdirSync(join(root, 'props', 'particles'), { recursive: true });
    mkdirSync(join(root, 'testworld', 'particles'), { recursive: true });
    writeFileSync(join(root, 'props', 'particles', 'pt_lamp_glow.json'), JSON.stringify({ timing: once, groups: [{ timing: once, emitters: [{ timing: forever }] }] }));
    writeFileSync(join(root, 'testworld', 'particles', 'pt_lamp_glow.json'), JSON.stringify({ timing: once, groups: [] }));
    writeFileSync(join(root, 'testworld', 'particles', 'fx_pt_fire_brazier.json'), JSON.stringify({ timing: forever, groups: [] }));
    writeFileSync(join(root, 'testworld', 'particles', 'pt_smoke_puff.json'), JSON.stringify({ timing: once, groups: [{ timing: once, emitters: [{ timing: once }] }] }));
    writeFileSync(join(root, 'testworld', 'particles', 'pt_broken.json'), '{ not json');
    mkdirSync(join(root, 'sounds'), { recursive: true });
    writeFileSync(
      join(root, 'sounds', 'sounds.json'),
      JSON.stringify({
        categories: { '1': 'ambient', '2': 'music', '3': 'voiceOver' },
        templates: {
          'sound/amb_hum.snd': { dim: 3, category: 1, loops: [-1, -1], full: 6 },
          'sound/amb_drone.snd': { dim: 3, category: 1, loops: [1, -1] },
          'sound/amb_once.snd': { dim: 3, category: 1, loops: [1, 1], full: 4 },
          'sound/ui_click.snd': { dim: 2, category: 1, loops: [-1, -1] },
          'sound/music_theme.snd': { dim: 3, category: 2, loops: [-1, -1], full: 20 },
          'sound/vo_line.snd': { dim: 3, category: 3, loops: [-1, -1] },
        },
      }),
    );

    const before = libraryStatus(root);
    ok(before.stale && /library: none/.test(before.line) && before.line.includes('npm run swg -- library'), `status says the index is missing, with the command (“${before.line}”)`);
    const r = buildLibrary({ root });
    ok(existsSync(join(root, 'library', 'library.json')), 'the pass writes the index');
    const index = JSON.parse(readFileSync(join(root, 'library', 'library.json'), 'utf8'));
    ok(index.version === LIBRARY_FORMAT && LIBRARY_FORMAT === LIBRARY_VERSION, `of the format the editor reads (${LIBRARY_FORMAT})`);
    const by = (s: string, id: string) => index.entries.find((e: { s: string; id: string }) => e.s === s && e.id === id);
    ok(!!by('props', 'test_chair') && !!by('buildings', 'test_house') && !!by('world', 'test_rock') && !!by('flora', 'test_tree'), 'it lists a props thing, a gallery building, a world model and a planting');
    ok(!index.entries.some((e: { m: string }) => e.m === 'test_gun'), "and nothing of the gallery's weapons");
    ok(existsSync(join(root, 'library', 'icons', 'gallery', 'test_house.png')) && existsSync(join(root, 'library', 'icons', 'testworld', 'test_rock.png')) && existsSync(join(root, 'library', 'icons', 'testworld', 'test_tree.png')), `and draws their pictures (${r.drawn} drawn)`);
    const bench = by('world', 'test_bench');
    ok(!!bench && bench.pic === 'props/icons/chair_m.png' && !existsSync(join(root, 'library', 'icons', 'testworld', 'chair_m.png')), 'a model the props pack pictures is reused, never drawn again');
    ok((by('flora', 'test_tree').f & 8) !== 0 && by('flora', 'test_tree').g === 'trees', 'a planting past the 1.2 m line is a tree');
    // The effects: once a name, the props pack's where it has one, grouped by their names, a loop flagged; one that does not read left out.
    const fx = index.entries.filter((e: { s: string }) => e.s === 'effects') as { p: string; id: string; m: string; n: string; g: string; f: number; pic: string | null }[];
    const fxOf = (id: string) => fx.find((e) => e.id === id);
    ok(fx.length === 3 && !fxOf('pt_broken'), `every effect that reads, once a name (${fx.map((e) => `${e.p}:${e.id}`).join(', ')})`);
    ok(fxOf('pt_lamp_glow')?.p === 'props' && fxOf('pt_lamp_glow')?.m === 'particles/pt_lamp_glow.json' && fxOf('fx_pt_fire_brazier')?.p === 'testworld', "a name both packs hold is the props pack's (every world reaches it), the rest their own pack's");
    ok(fxOf('pt_lamp_glow')?.g === 'light' && fxOf('fx_pt_fire_brazier')?.g === 'fire' && fxOf('pt_smoke_puff')?.g === 'smoke' && fxOf('fx_pt_fire_brazier')?.n === 'fire brazier', 'grouped by the words of their names, and named in words');
    ok((fxOf('pt_lamp_glow')!.f & 128) !== 0 && (fxOf('fx_pt_fire_brazier')!.f & 128) !== 0 && (fxOf('pt_smoke_puff')!.f & 128) === 0 && fx.every((e) => (e.f & 16) !== 0 && e.pic === null), 'one playing for ever (its own, a group\'s or an emitter\'s timing) is flagged a loop, and none has a picture');
    // The sounds: placed (three-dimensional), endless, and no music, voice-over or player's music; the radius kept.
    const snd = index.entries.filter((e: { s: string }) => e.s === 'sounds') as { p: string; id: string; m: string; g: string; f: number; r?: number }[];
    ok(snd.length === 2 && snd.some((e) => e.m === 'sound/amb_hum.snd' && e.id === 'amb_hum' && e.g === 'ambient' && e.r === 6 && (e.f & 128) !== 0 && e.p === 'sounds') && snd.some((e) => e.m === 'sound/amb_drone.snd' && e.r === 0), `of the bank, only the placed, endless loops that are no music or spoken line, each with its full-volume radius (${snd.map((e) => `${e.m} ${e.r}`).join(', ')})`);
    const now = libraryStatus(root);
    ok(!now.stale && /4 entries|entries/.test(now.line) && /effects 3/.test(now.line) && /sounds 2/.test(now.line), `then status says it is current (“${now.line}”)`);
    // An index made before the effects (its packs holding some) is asked for again in words.
    const noFx = { ...index, entries: index.entries.filter((e: { s: string }) => e.s !== 'effects' && e.s !== 'sounds') };
    writeFileSync(join(root, 'library', 'library.json'), JSON.stringify(noFx));
    const before7 = libraryStatus(root);
    ok(before7.stale && /has no effects or sounds/.test(before7.line) && before7.line.includes('npm run swg -- library'), `an index with no effects, where a pack has some, is listed again (“${before7.line}”)`);
    const r2 = buildLibrary({ root });
    ok(r2.drawn === 0 && r2.kept === r.drawn, `a second run draws nothing it already has (${r2.kept} kept)`);
    const later = new Date(Date.now() + 60_000);
    utimesSync(join(root, 'testworld', 'manifest.json'), later, later);
    const older = libraryStatus(root);
    ok(older.stale && older.line.includes('older than testworld'), `and lists it again once a pack it read is newer (“${older.line}”)`);
    // `status` lists the pass and never asks for it.
    const out = execFileSync(process.execPath, [join(repo, 'tools', 'swg', 'cli.mjs'), 'status', root, '--json'], { cwd: repo, encoding: 'utf8', env: { ...process.env, SWG: '' }, maxBuffer: 64 << 20 });
    const plan = JSON.parse(out) as { steps: { command: string }[] };
    ok(Array.isArray(plan.steps) && plan.steps.length > 0 && !plan.steps.some((s) => s.command === 'library'), `status never puts the pass among its asks (${plan.steps.length} steps, none of them library)`);
    const text = execFileSync(process.execPath, [join(repo, 'tools', 'swg', 'cli.mjs'), 'status', root], { cwd: repo, encoding: 'utf8', env: { ...process.env, SWG: '' }, maxBuffer: 64 << 20 });
    ok(/library: older than testworld/.test(text), 'and lists it in its words');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---- The ground clip, the clip off against 5a4e765, the glow. ----
{
  const above = { ...box(6, 4, 6, 0), color: [60, 200, 60] };
  // Its top a centimetre under the line: a face lying on the line itself is the ground's own and is drawn.
  const buried = { ...box(8, 9.99, 8, -10), color: [220, 30, 30] };
  const reddish = (p: { rgba: Uint8Array } | null) => {
    if (!p) return 0;
    let n = 0;
    for (let i = 0; i < p.rgba.length; i += 4) if (p.rgba[i + 3] > 0 && p.rgba[i] > 2 * p.rgba[i + 1] && p.rgba[i] > 40) n++;
    return n;
  };
  const opts = { size: 96, view: 'wear', yawDeg: 32, pitchDeg: 22, flipX: false };
  const clipped = renderThumbnail([above, buried], { ...opts, groundClip: 0 });
  const whole = renderThumbnail([above, buried], { ...opts });
  ok(!!clipped && reddish(clipped) === 0, 'with the ground clip, nothing of the buried part is drawn (no pixel of it)');
  ok(reddish(whole) > 100, `without it the buried part shows (${reddish(whole)} pixels)`);

  // 5a4e765's rasteriser, out of git, beside the png reader it imports. Only the loading is in the `try`: a picture that
  // differs is a failure, never a note. Where git cannot answer (a shallow or archived checkout), the pictures are held to
  // the hashes of 5a4e765's own, written here once from that very rasteriser over these very meshes.
  const PRE_PASS_PICTURES = [
    '52b9378df839c3565eafb66819e796cdc776f2b943667b659aad60163738bd98',
    '69c1ca0e5f615900240bc6bce5ae9c1287d2879055b6fd6b59c1ebd76a8a3341',
    'efa0f8c4c771a9124ac4069ebaed553016b728a7a874e7819b6a3e77a17afeab',
    '83f807c57a848ca359926fefa6ef08aaa723f3c2f32b3b255692d3bf340b2e2c',
  ];
  const meshes = [above, buried, { ...box(2, 9, 2, 0, 5), color: [168, 168, 168] }];
  const VIEWS = [{ view: 'wear', yawDeg: 32, pitchDeg: 22, flipX: false }, { view: 'wear' }, { view: 'held' }, { view: 'wear', yawDeg: 90, pitchDeg: 45 }];
  const pictureHash = (p: { width: number; height: number; rgba: Uint8Array } | null) => (p ? createHash('sha256').update(`${p.width}x${p.height}:`).update(Buffer.from(p.rgba)).digest('hex') : 'none');
  const dir = mkdtempSync(join(tmpdir(), 'swg-thumb-'));
  let prev: { renderThumbnail: typeof renderThumbnail } | null = null;
  try {
    const old = execFileSync('git', ['--no-optional-locks', 'show', '5a4e765:tools/swg/thumbnail.mjs'], { cwd: repo, encoding: 'utf8', maxBuffer: 64 << 20 });
    writeFileSync(join(dir, 'thumbnailOld.mjs'), old);
    copyFileSync(join(repo, 'tools', 'swg', 'png.mjs'), join(dir, 'png.mjs'));
    prev = (await import(pathToFileURL(join(dir, 'thumbnailOld.mjs')).href)) as { renderThumbnail: typeof renderThumbnail };
  } catch {
    prev = null;
  }
  try {
    let same = 0;
    for (let i = 0; i < VIEWS.length; i++) {
      const a = renderThumbnail(meshes, VIEWS[i] as never);
      if (prev) {
        const b = prev.renderThumbnail(meshes, VIEWS[i] as never);
        if (a && b && a.width === b.width && Buffer.from(a.rgba).equals(Buffer.from(b.rgba)) && pictureHash(b) === PRE_PASS_PICTURES[i]) same++;
      } else if (pictureHash(a) === PRE_PASS_PICTURES[i]) same++;
    }
    ok(same === VIEWS.length, `with the clip off it draws exactly what 5a4e765's rasteriser drew, byte for byte (${same} of ${VIEWS.length} views${prev ? '' : ', held to their hashes: git could not show 5a4e765'})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // A glow: a grey box with and without a bright emissive texture over the same faces.
  const uvs = new Float32Array(16).fill(0.5);
  const glowTex = { width: 2, height: 2, rgba: new Uint8Array([255, 220, 120, 255, 255, 220, 120, 255, 255, 220, 120, 255, 255, 220, 120, 255]) };
  const plain = renderThumbnail([{ ...box(4, 4, 4, 0), uvs, color: [90, 90, 90] }], opts);
  const lit = renderThumbnail([{ ...box(4, 4, 4, 0), uvs, color: [90, 90, 90], emissive: glowTex, emissiveFactor: [1, 1, 1] }], opts);
  const sum = (p: { rgba: Uint8Array } | null) => {
    let s = 0;
    if (p) for (let i = 0; i < p.rgba.length; i += 4) s += p.rgba[i] + p.rgba[i + 1] + p.rgba[i + 2];
    return s;
  };
  ok(sum(lit) > sum(plain) * 1.5, `a glowing material's picture is brighter by its glow (${(sum(lit) / Math.max(1, sum(plain))).toFixed(2)} times)`);
}

console.log(`\n${checks} checks passed`);
