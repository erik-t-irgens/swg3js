// The far ground's bake format (the horizon pass's first wave, DESIGN.md §2.2, §3): the heights' 16-bit row deltas in two
// byte planes back to the bit, the lattices (the ground's own every 8 m, the pattern's corners, the colour cells, the
// coarse every eighth fine sample, and the 16 m rule past `fineMost`), a header refused in words for each reason, and
// `horizonStatusOf`'s every reason, `status` listing the bake and asking for none (run with no install named, the late
// lesson). The bake itself is made of a pack copied into a folder of the test's own.
//
// Run: node tools/swg/tests/horizonFile.test.ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HORIZON_BIN, HORIZON_CARDS_BIN, HORIZON_CARDS_JSON, HORIZON_JSON, decodeHeights, decodeSteps, encodeHeights, planBake, planCards, readCardsHeader, readHorizonHeader, HORIZON_FORMAT } from '../../../src/world/horizon/horizonFile.ts';
import { GENERATOR_REVISION } from '../../../src/swg/terrain/generator.ts';
import { bitmapFiles, parseTerrainTemplate } from '../../../src/swg/terrain/trn.ts';
import { inflateSync } from 'node:zlib';
import { groundChunkOrigin, groundShift } from '../../../src/world/groundTiles.ts';
import { poleFar, terrainOf } from './horizonWorld.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// ---- the 16-bit store
{
  const nx = 37;
  const nz = 23;
  const h = new Float32Array(nx * nz);
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let k = 0; k < h.length; k++) h[k] = -320 + 900 * rnd();
  const e = encodeHeights(h, nx, nz);
  const back = decodeHeights(e.bytes, nx, nz, e.lo, e.q);
  const steps = decodeSteps(e.bytes, nx, nz);
  let worst = 0;
  let exact = true;
  for (let k = 0; k < h.length; k++) {
    worst = Math.max(worst, Math.abs(back[k] - h[k]));
    if (back[k] !== Math.fround(e.lo + e.q * steps[k])) exact = false;
  }
  ok(worst <= e.q / 2 + 1e-4, `the 16-bit store holds every height within half a step (${(e.q * 100).toFixed(2)} cm a step, worst ${(worst * 100).toFixed(2)} cm)`);
  ok(exact, 'and the decoder\'s float32 is exactly lo + q * stored');
  ok(e.bytes.length === nx * nz * 2 && e.bytes[nx * nz - 1] !== undefined, 'two byte planes, low then high, a sample each');
  const flat = encodeHeights(new Float32Array(16).fill(5), 4, 4);
  ok(flat.q === 1 && decodeHeights(flat.bytes, 4, 4, flat.lo, flat.q).every((v) => v === 5), 'a level section stores every sample at its one height');
}

// ---- the lattices
{
  const p = planBake(16384, { x: 1269, z: -3601 });
  const mod = (v: number, m: number) => ((v % m) + m) % m;
  // The ground's lattice in the raw frame: raw x congruent to centre.x - (centre.x mod 2), raw z to centre.z + (-centre.z mod 2).
  ok(mod(p.fine.x0 - (1269 - 1), 8) === 0 && mod(p.fine.z0 - (-3601 + 1), 8) === 0 && p.fine.step === 8, 'the heights stand on the ground\'s own lattice every 8 m (the chunks\' vertices and the far grids)');
  ok(p.fine.nx === 2305 || p.fine.nx === 2304, `the fine extent is the map and a kilometre round it (${p.fine.nx} samples a side)`);
  ok(p.ground.x0 % 8 === 0 && p.ground.step === 8 && p.colour.x0 % 8 === 0, 'the families on the pattern\'s corners and the colour cells centred on them');
  ok(mod(p.coarse.x0 - p.fine.x0, 64) === 0 && p.coarse.step === 64 && (p.coarse.nx === 769 || p.coarse.nx === 768), 'the coarse heights every eighth fine sample, out to 16 km past the map');
  const wide = planBake(32768, { x: 0, z: 0 });
  ok(wide.wide && wide.fine.step === 16 && wide.colour.step === 16 && wide.ground.step === 8 && wide.fine.nx <= 2305, `a 32 km world is baked at 16 m (${wide.fine.nx} a side), its families still every 8 m`);
}

// ---- the header held to the build
{
  const p = planBake(4096, { x: 0, z: 0 });
  const header = {
    format: HORIZON_FORMAT,
    source: { generator: GENERATOR_REVISION, trn: { length: 1, sha1: 'x' }, inputs: 'y', centre: { x: 0, z: 0 }, layers: { sha1: 'z', list: [] }, lifeDay: false, made: 'poles' },
    fine: { ...p.fine, lo: 0, q: 1 },
    ground: p.ground,
    colour: p.colour,
    coarse: { ...p.coarse, lo: 0, q: 1 },
    sections: ['heights', 'families', 'colour', 'coarseHeights', 'coarseFamilies', 'coarseColour'].map((name, i) => ({ name, offset: i * 10, length: 10, size: 100 })),
  };
  const expect = { generator: GENERATOR_REVISION, centre: { x: 0, z: 0 }, binLength: 60 };
  ok('header' in readHorizonHeader(header, expect, 'w'), 'a whole header is read');
  const refused = (h: unknown, e = expect) => {
    const r = readHorizonHeader(h, e, 'w');
    return 'refused' in r ? r.refused : '';
  };
  ok(/newer/.test(refused({ ...header, format: HORIZON_FORMAT + 1 })), 'a newer format is refused in words');
  ok(/generator revision/.test(refused({ ...header, source: { ...header.source, generator: GENERATOR_REVISION + 1 } })) && /horizon assets-private --only=w/.test(refused({ ...header, source: { ...header.source, generator: GENERATOR_REVISION + 1 } })), "another generator's bake is refused, naming the command that makes another");
  ok(/centre/.test(refused(header, { ...expect, centre: { x: 8, z: 0 } })), 'a bake whose centre is not the layout\'s is refused');
  ok(/past the file's end/.test(refused(header, { ...expect, binLength: 55 })), 'a section reaching past the file\'s end is refused');
  ok(/not one/.test(refused(null)), 'and nothing at all is refused, not thrown');
}

// ---- a bake of a copied pack, and status over it
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const packs = process.env.SWG3JS_PACKS || join(repo, 'assets-private');
const source = join(packs, 'kashyyyk_main');
if (!existsSync(join(source, 'terrain.trn'))) {
  console.log('note kashyyyk_main is not converted here: the bake and status checks are left out');
} else {
  const dir = mkdtempSync(join(tmpdir(), 'horizon-file-'));
  try {
    const to = join(dir, 'kashyyyk_main');
    const files = new Set(['terrain.trn', 'layout.json', 'terrain/shaders.json', 'terrain/colorramps.json', 'manifest.json']);
    const t = parseTerrainTemplate(new Uint8Array(readFileSync(join(source, 'terrain.trn'))));
    for (const b of bitmapFiles(t)) files.add(b.file);
    const layout = JSON.parse(readFileSync(join(source, 'layout.json'), 'utf8'));
    for (const o of layout.objects ?? []) if (o.layer && !o.contained) files.add(o.layer);
    for (const f of files) {
      if (!existsSync(join(source, f))) continue;
      mkdirSync(dirname(join(to, f)), { recursive: true });
      copyFileSync(join(source, f), join(to, f));
    }
    const hz = await import('../horizon.mjs');
    ok(hz.horizonStatusOf('kashyyyk_main', to).stale === 'missing', 'status reads a world with no bake as missing');
    const r = await hz.bakeHorizon(to, 'kashyyyk_main', { threads: 4 });
    ok(!r.skipped && r.fine.step === 8 && existsSync(join(to, HORIZON_JSON)), `the bake is made (${r.fine.nx} x ${r.fine.nz} at 8 m, ${r.mb.toFixed(2)} MB in ${(r.wall / 1000).toFixed(1)} s)`);
    ok(hz.horizonStatusOf('kashyyyk_main', to).stale === null, 'and status reads it as current');
    // The far tree cards' file (the fifth wave, §1b Q11): written beside every bake, read against it, made alone with
    // `cardsOnly` for a bake made before it (the bake left byte for byte), and named by status, never asked for.
    const cardsHead = JSON.parse(readFileSync(join(to, HORIZON_CARDS_JSON), 'utf8'));
    const bakeHead = JSON.parse(readFileSync(join(to, HORIZON_JSON), 'utf8'));
    const cr = readCardsHeader(cardsHead, bakeHead, GENERATOR_REVISION, statSync(join(to, HORIZON_CARDS_BIN)).size);
    const lat = planCards(bakeHead.fine, bakeHead.source.centre);
    ok(!('refused' in cr) && cr.header.cards.nx === lat.nx && cr.header.cards.x0 === lat.x0, `the bake writes its far tree cards' file beside it, read against it (${r.cards.nx} x ${r.cards.nz}, ${r.cardsWithFamily} with a far family, ${r.cardsMb.toFixed(2)} MB)`);
    const bakeBytes = readFileSync(join(to, HORIZON_BIN));
    rmSync(join(to, HORIZON_CARDS_JSON));
    const missing = hz.horizonStatusOf('kashyyyk_main', to);
    ok(missing.stale === null && missing.cards === 'missing' && /no far tree cards \(by hand: npm run swg -- horizon assets-private --only=kashyyyk_main --cards-only\)/.test(missing.line ?? ''), "a bake with no cards' file is current, the cards named missing with the command that makes them");
    const r2 = await hz.bakeHorizon(to, 'kashyyyk_main', { threads: 4, cardsOnly: true });
    ok(r2.cardsOnly === true && readFileSync(join(to, HORIZON_BIN)).equals(bakeBytes) && hz.horizonStatusOf('kashyyyk_main', to).cards === null, `--cards-only writes the cards alone (${(r2.wall / 1000).toFixed(1)} s), the bake byte for byte as it was`);
    // h5's review round: the cards' samples are what a far tile's cards read (`SwgTerrain.farGrid`: the far grid's own 16 m
    // generation), sample for sample over every far tile the lattice reaches, never the near ground's 2 m poles.
    {
      const ch = JSON.parse(readFileSync(join(to, HORIZON_CARDS_JSON), 'utf8'));
      const K = inflateSync(readFileSync(join(to, HORIZON_CARDS_BIN)).subarray(ch.section.offset, ch.section.offset + ch.section.length));
      const Lc = ch.cards;
      const ctr = bakeHead.source.centre;
      const swg = await terrainOf(to);
      const sh = groundShift(ctr.x, ctr.z);
      let n = 0;
      let famOff = 0;
      let colOff = 0;
      let withFam = 0;
      let poles = 0;
      let poleOff = 0;
      const tx0 = Math.floor((ctr.x - (Lc.x0 + (Lc.nx - 1) * 16) - sh.x) / 512);
      const tx1 = Math.floor((ctr.x - Lc.x0 - sh.x) / 512);
      const tz0 = Math.floor((Lc.z0 - ctr.z - sh.z) / 512);
      const tz1 = Math.floor((Lc.z0 + (Lc.nz - 1) * 16 - ctr.z - sh.z) / 512);
      for (let tz = tz0; tz <= tz1; tz++)
        for (let tx = tx0; tx <= tx1; tx++) {
          const o = groundChunkOrigin(tx, tz, sh, 512);
          const g = swg.farGrid(o.x, o.z, 512, 32, true)!;
          for (let j = 1; j <= 32; j++)
            for (let i = 1; i <= 32; i++) {
              const gx = o.x + (i - 1) * 16;
              const gz = o.z + (j - 1) * 16;
              const li = (ctr.x - gx - Lc.x0) / 16;
              const lk = (gz + ctr.z - Lc.z0) / 16;
              if (li < 0 || lk < 0 || li >= Lc.nx || lk >= Lc.nz) continue;
              const k = (lk * Lc.nx + li) * 4;
              const s = j * 35 + i;
              n++;
              if (g.radialFar[s * 2]) withFam++;
              if (K[k + 3] !== g.radialFar[s * 2]) famOff++;
              if (K[k] !== g.colors[s * 3] || K[k + 1] !== g.colors[s * 3 + 1] || K[k + 2] !== g.colors[s * 3 + 2]) colOff++;
              // The 2 m poles a far tile's cards never read, on the tiles round the middle (what the old bake took).
              if (Math.abs(tx - (tx0 + tx1) / 2) <= 1 && Math.abs(tz - (tz0 + tz1) / 2) <= 1) {
                poles++;
                if (poleFar(swg, ctr.x - gx, gz + ctr.z) !== g.radialFar[s * 2]) poleOff++;
              }
            }
        }
      ok(n > 10000 && withFam > 0 && famOff === 0 && colOff === 0, `every card sample is the far grid's own, family and colour, over ${(tx1 - tx0 + 1) * (tz1 - tz0 + 1)} far tiles (${n} samples, ${withFam} with a far family; ${famOff} families and ${colOff} colours off)`);
      console.log(`note the near ground's 2 m poles name another far family than the far grid at ${poleOff} of ${poles} samples round the middle (what format 1 baked)`);
    }
    writeFileSync(join(to, HORIZON_CARDS_JSON), JSON.stringify({ ...cardsHead, source: { ...cardsHead.source, generator: GENERATOR_REVISION + 1 } }));
    ok(/generator revision/.test(String(hz.horizonStatusOf('kashyyyk_main', to).cards)), "another generator's cards are stale");
    writeFileSync(join(to, HORIZON_CARDS_JSON), JSON.stringify({ ...cardsHead, source: { ...cardsHead.source, trn: { ...cardsHead.source.trn, sha1: '0' } } }));
    ok(/another terrain file/.test(String(hz.horizonStatusOf('kashyyyk_main', to).cards)), 'and cards of another terrain file');
    writeFileSync(join(to, HORIZON_CARDS_JSON), JSON.stringify(cardsHead));
    ok(hz.HORIZON_STATUS_ASKS === false, 'status asks no player for a bake this wave (its one word, for the wave that turns the rings on)');
    const json = JSON.parse(readFileSync(join(to, HORIZON_JSON), 'utf8'));
    const write = (o: unknown) => writeFileSync(join(to, HORIZON_JSON), JSON.stringify(o));
    write({ ...json, source: { ...json.source, generator: GENERATOR_REVISION + 1 } });
    ok(/generator revision/.test(hz.horizonStatusOf('kashyyyk_main', to).stale ?? ''), "status calls another generator's bake stale");
    write({ ...json, source: { ...json.source, trn: { ...json.source.trn, sha1: '0' } } });
    ok(/terrain file moved/.test(hz.horizonStatusOf('kashyyyk_main', to).stale ?? ''), 'and one of another terrain file');
    write({ ...json, source: { ...json.source, inputs: '0' } });
    ok(/bitmap/.test(hz.horizonStatusOf('kashyyyk_main', to).stale ?? ''), 'and one whose bitmaps, ramps or layer files moved');
    write({ ...json, source: { ...json.source, layers: { ...json.source.layers, sha1: '0' } } });
    ok(/building layers/.test(hz.horizonStatusOf('kashyyyk_main', to).stale ?? ''), 'and one whose building layers moved');
    write({ ...json, source: { ...json.source, centre: { x: 1, z: 1 } } });
    ok(/centre/.test(hz.horizonStatusOf('kashyyyk_main', to).stale ?? ''), 'and one whose centre is not the layout\'s');
    write({ ...json, format: HORIZON_FORMAT - 1 });
    ok(/older/.test(hz.horizonStatusOf('kashyyyk_main', to).stale ?? ''), 'and one of an older format');
    write(json);
    const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [cli, 'status', dir], { encoding: 'utf8', maxBuffer: 16 * 1048576, env: { ...process.env, SWG: '', SWG3JS_PLACEMENTS: '' } });
    const out = run.stdout ?? '';
    ok(run.status === 0 && /kashyyyk_main/.test(out) && /far-ground bake \(8 m/.test(out), 'status ran and lists the bake');
    ok(!/swg -- horizon /.test(out), 'and asks for no bake (nothing asks a player to bake until the rings ship on)');
    hz.removeHorizon(to);
    const run2 = spawnSync(process.execPath, [cli, 'status', dir], { encoding: 'utf8', maxBuffer: 16 * 1048576, env: { ...process.env, SWG: '', SWG3JS_PLACEMENTS: '' } });
    ok(/no far-ground bake \(by hand: npm run swg -- horizon assets-private --only=kashyyyk_main\)/.test(run2.stdout ?? '') && !/swg -- horizon assets-private\s*$/m.test(run2.stdout ?? ''), 'a world with none is listed with the command that makes one, still never asked for');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// h5's review round: on a world whose coarse grid's filters name another far family than its 2 m poles (Yavin 4's jungle;
// measured 89 of 1,280 samples on five tiles), the bake's own cards job (`horizonWorker.mjs`'s `cardsJob`, run here on
// the pack as it stands, nothing written) gives the far grid's family and colour at every sample of the middle row of far
// tiles, and the 2 m poles the format 1 bake took would not.
{
  const pick = ['yavin4', 'endor', 'dathomir'].find((w) => existsSync(join(packs, w, 'terrain.trn')) && existsSync(join(packs, w, HORIZON_JSON)));
  if (!pick) console.log('note no jungle world with a bake here: the cards job against the far grid on one is left out');
  else {
    const dir = join(packs, pick);
    const hz = await import('../horizon.mjs');
    const wk = await import('../horizonWorker.mjs');
    const head = JSON.parse(readFileSync(join(dir, HORIZON_JSON), 'utf8'));
    const ctr = head.source.centre;
    const Lc = planCards(head.fine, ctr);
    const jobs = hz.cardsJobs(Lc, ctr);
    const mid = jobs[jobs.length >> 1];
    const midTx = (mid.tx0 + mid.tx1) >> 1;
    const job = { ...mid, tx0: midTx - 2, tx1: midTx + 2 };
    const res = wk.cardsJob(wk.loadBakeSampler(dir), job);
    const swg = await terrainOf(dir);
    const sh = groundShift(ctr.x, ctr.z);
    let n = 0;
    let off = 0;
    let poleOff = 0;
    let fam = 0;
    for (let tx = job.tx0; tx <= job.tx1; tx++) {
      const o = groundChunkOrigin(tx, job.tz, sh, 512);
      const g = swg.farGrid(o.x, o.z, 512, 32, true)!;
      for (let j = 1; j <= 32; j++)
        for (let i = 1; i <= 32; i++) {
          const gx = o.x + (i - 1) * 16;
          const gz = o.z + (j - 1) * 16;
          const li = (ctr.x - gx - Lc.x0) / 16;
          const lk = (gz + ctr.z - Lc.z0) / 16;
          if (li < 0 || li >= Lc.nx || lk < res.kj0 || lk >= res.kj0 + res.K.length / (Lc.nx * 4)) continue;
          const k = ((lk - res.kj0) * Lc.nx + li) * 4;
          const s = j * 35 + i;
          n++;
          if (g.radialFar[s * 2]) fam++;
          if (res.K[k + 3] !== g.radialFar[s * 2] || res.K[k] !== g.colors[s * 3] || res.K[k + 1] !== g.colors[s * 3 + 1] || res.K[k + 2] !== g.colors[s * 3 + 2]) off++;
          if ((j & 3) === 0 && (i & 3) === 0 && poleFar(swg, ctr.x - gx, gz + ctr.z) !== g.radialFar[s * 2]) poleOff++;
        }
    }
    ok(n === 5 * 32 * 32 && fam > 0 && off === 0 && res.off === 0, `${pick}: the cards job's every sample is the far grid's own, family and colour (${n} samples on five far tiles, ${fam} with a far family, ${off} off)`);
    ok(poleOff > 0, `and the 2 m poles a format 1 bake took name another family at ${poleOff} of the ${n / 16} checked: the fixture tells the two apart`);
  }
}

console.log(`\nhorizonFile: ${checks} checks passed`);
