// The far ground's bake (the horizon pass, A:\swg3js\horizon\DESIGN.md §2.2): every converted world's raw ground -- its
// heights, its families on the client's 8 m pattern and its colour means -- made once from the near ground's own 2 m
// poles, over the map and a kilometre round it, and coarsely every 64 m out to 16 km past it, into
// `terrain/horizon.json` and `terrain/horizon.bin` beside the pack's terrain file. It reads only the pack's own files
// (the terrain, its bitmaps, its colour ramps, its layout and the building layers it names: no archive), lays nothing of
// the owner's (no heights file, no carve, no paint), runs out of Life Day's season, and writes nothing else.
//
// The generator runs in worker threads (`horizonWorker.mjs`) over squares of 128 poles 2 m apart with four of margin,
// exactly as the sampler makes its blocks, so every height is the near ground's own to the bit and every family the
// one the near ground draws. Run by hand until the rings ship on: `status` lists the bakes and asks for none.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { deflateSync } from 'node:zlib';
import { bitmapFiles, parseTerrainTemplate } from '../../src/swg/terrain/trn.ts';
import { GENERATOR_REVISION } from '../../src/swg/terrain/generator.ts';
import { BAKE_DEFAULTS, HORIZON_BIN, HORIZON_CARDS_BIN, HORIZON_CARDS_FORMAT, HORIZON_CARDS_JSON, HORIZON_FORMAT, HORIZON_JSON, encodeHeights, planBake, planCards, readCardsHeader, readHorizonHeader } from '../../src/world/horizon/horizonFile.ts';
import { groundShift } from '../../src/world/groundTiles.ts';

/** The colour ramps' file beside a pack's terrain (`COLOR_RAMP_FILE`). */
const RAMPS = 'terrain/colorramps.json';
/** Squares of this many poles a side, with this many of margin (bake2's measured setup: every height bit for bit). */
export const SQUARE = 128;
export const SQUARE_MARGIN = 4;

export function sha1Of(bytes) {
  return createHash('sha1').update(bytes).digest('hex');
}

/** The game's far tiles (`world.ts`'s `FAR_TILE` and `FAR_RES`): 512 m, 32 steps of 16 m a side. */
export const CARDS_FAR_TILE = 512;
export const CARDS_FAR_RES = 32;

/**
 * The far tree cards' jobs (§1b Q11, its review round): a job a row of the game's far tiles over the cards' lattice, each
 * tile at `groundChunkOrigin`'s place with the world's ground shift, so its samples are the far grid's own.
 */
export function cardsJobs(cards, centre) {
  const shift = groundShift(centre.x, centre.z);
  const size = CARDS_FAR_TILE;
  // The lattice's game extent (game x runs the other way from raw x; game z is raw z less the centre's).
  const gxa = centre.x - (cards.x0 + (cards.nx - 1) * cards.step);
  const gxb = centre.x - cards.x0;
  const gza = cards.z0 - centre.z;
  const gzb = cards.z0 + (cards.nz - 1) * cards.step - centre.z;
  const tx0 = Math.floor((gxa - shift.x) / size);
  const tx1 = Math.floor((gxb - shift.x) / size);
  const jobs = [];
  for (let tz = Math.floor((gza - shift.z) / size); tz <= Math.floor((gzb - shift.z) / size); tz++) jobs.push({ kind: 'cards', cards, centre, shift, tz, tx0, tx1, size, res: CARDS_FAR_RES });
  return jobs;
}

/** The yaw the game reads a layout object's turn as (`world.ts`'s `yawOf`). */
export function yawOf(q) {
  const [w, x, y, z] = q;
  return Math.atan2(2 * (x * z + w * y), 1 - 2 * (x * x + y * y));
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * What a world's bake reads and keys on, without running anything: the terrain, the layout's centre and its building
 * layers (every layout object with `layer` and not `contained`, by index, file, place and yaw: `world.ts`'s own filter),
 * and the SHA-1 over every bitmap the terrain names, the colour ramps file and each layer file's bytes, in that order.
 * Null with why where the world cannot be baked (no terrain, no layout with terrain, no version-4 ground pictures, tiles
 * not 4 m).
 */
export function bakeInputs(packDir) {
  const trnPath = join(packDir, 'terrain.trn');
  if (!existsSync(trnPath)) return { why: 'no terrain.trn' };
  const layout = readJson(join(packDir, 'layout.json'));
  if (!layout?.terrain || !layout.center) return { why: 'its layout names no terrain' };
  const shaders = readJson(join(packDir, 'terrain/shaders.json'));
  if (!shaders || (shaders.version ?? 0) < 4) return { why: 'its ground pictures are older than terrain shaders version 4 (the albedo reads the tile arrays)' };
  const trn = readFileSync(trnPath);
  let template;
  try {
    template = parseTerrainTemplate(new Uint8Array(trn));
  } catch (err) {
    return { why: `terrain.trn not read (${err.message})` };
  }
  if (template.tileWidthInMeters !== 4) return { why: `its tiles are ${template.tileWidthInMeters} m, not the 4 m the rings draw` };
  const h = createHash('sha1');
  const bitmaps = [];
  for (const b of bitmapFiles(template)) {
    const f = join(packDir, b.file);
    if (existsSync(f)) {
      h.update(readFileSync(f));
      bitmaps.push(b);
    }
  }
  if (existsSync(join(packDir, RAMPS))) h.update(readFileSync(join(packDir, RAMPS)));
  const list = [];
  (layout.objects ?? []).forEach((o, li) => {
    if (!o.layer || o.contained) return;
    if (!existsSync(join(packDir, o.layer))) return;
    list.push([li, o.layer, o.x, o.z, yawOf(o.q)]);
  });
  for (const l of list) h.update(readFileSync(join(packDir, l[1])));
  return {
    trn,
    template,
    centre: { x: layout.center.x, z: layout.center.z },
    layers: { sha1: sha1Of(Buffer.from(JSON.stringify(list))), list },
    inputs: h.digest('hex'),
    mapWidth: template.mapWidthInMeters,
  };
}

/** One worker per thread, each loading the world once, fed jobs from one queue. */
function runJobs(packDir, jobs, threads, log) {
  return new Promise((resolve, reject) => {
    const results = new Array(jobs.length);
    let next = 0;
    let done = 0;
    let failed = null;
    const n = Math.max(1, Math.min(threads, jobs.length));
    const workers = [];
    const feed = (w) => {
      if (failed) return;
      if (next >= jobs.length) {
        void w.terminate();
        return;
      }
      const i = next++;
      w.postMessage({ i, job: jobs[i] });
    };
    for (let k = 0; k < n; k++) {
      const w = new Worker(new URL('./horizonWorker.mjs', import.meta.url), { workerData: { packDir } });
      workers.push(w);
      w.on('message', (m) => {
        if (m.ready) {
          feed(w);
          return;
        }
        results[m.i] = m;
        done++;
        if (log && (done % 16 === 0 || done === jobs.length)) log(done, jobs.length);
        if (done === jobs.length) {
          // Every thread let go, or the ones still waiting for a job would keep the process alive.
          for (const x of workers) void x.terminate();
          resolve(results);
        } else feed(w);
      });
      w.on('error', (err) => {
        failed = err;
        for (const x of workers) void x.terminate();
        reject(err);
      });
    }
  });
}

/**
 * A world's bake made and written (`terrain/horizon.json` and `.bin`, each beside itself and renamed over its own name).
 * Answers what it came to.
 */
export async function bakeHorizon(packDir, world, opts = {}) {
  const inp = bakeInputs(packDir);
  if (inp.why) return { world, skipped: inp.why };
  const threads = opts.threads ?? Math.max(1, Math.min(16, cpus().length - 1));
  const plan = planBake(inp.mapWidth, inp.centre, opts);
  const t0 = performance.now();
  const { fine, ground, colour, coarse } = plan;
  // The far tree cards' samples (the fifth wave, §1b Q11), made with every bake, and alone with `cardsOnly` (a bake made
  // before it stays as it is: only the cards' own two files are written).
  const cards = planCards(fine, inp.centre);
  const cardsOnly = !!opts.cardsOnly;
  // The fine jobs: rows of squares across the fine extent, each keeping the rows whose raw z falls in it.
  const lo = Math.min(fine.x0, ground.x0, colour.x0, fine.z0, ground.z0, colour.z0);
  const hi = Math.max(fine.x0 + (fine.nx - 1) * fine.step, ground.x0 + (ground.nx - 1) * 8, colour.x0 + (colour.nx - 1) * colour.step, fine.z0 + (fine.nz - 1) * fine.step, ground.z0 + (ground.nz - 1) * 8, colour.z0 + (colour.nz - 1) * colour.step);
  const span = SQUARE * 2;
  const s0 = lo - (((lo % 2) + 2) % 2);
  const squares = Math.ceil((hi - s0 + 2) / span);
  const jobs = [];
  if (!cardsOnly) for (let r = 0; r < squares; r++) jobs.push({ kind: 'fine', s0, squares, row: r, fine, ground, colour });
  // The coarse jobs: rows of 64 m grids of 64 samples with two of margin.
  const crow = 64;
  if (!cardsOnly) for (let j0 = 0; j0 < coarse.nz; j0 += crow) jobs.push({ kind: 'coarse', coarse, j0, j1: Math.min(coarse.nz, j0 + crow) });
  // The cards' jobs (§1b Q11, its review round): a row of far tiles a job, each the far grid the game makes for it.
  for (const job of cardsJobs(cards, inp.centre)) jobs.push(job);
  const results = await runJobs(packDir, jobs, threads, opts.progress);
  const H = new Float32Array(fine.nx * fine.nz);
  const F = new Uint8Array(ground.nx * ground.nz);
  const C = new Uint8Array(colour.nx * colour.nz * 3);
  const K = new Uint8Array(cards.nx * cards.nz * 4);
  const CH = new Float32Array(coarse.nx * coarse.nz);
  const CF = new Uint8Array(coarse.nx * coarse.nz);
  const CC = new Uint8Array(coarse.nx * coarse.nz * 3);
  let cpu = 0;
  let wideFamilies = 0;
  for (const m of results) {
    cpu += m.ms;
    wideFamilies += m.wide ?? 0;
    if (m.kind === 'cards') {
      if (m.off) throw new Error(`${world}: ${m.off} far grid samples fell between the cards' lattice's samples`);
      K.set(m.K, m.kj0 * cards.nx * 4);
    } else if (m.kind === 'fine') {
      H.set(m.H, m.hj0 * fine.nx);
      F.set(m.F, m.gj0 * ground.nx);
      C.set(m.C, m.cj0 * colour.nx * 3);
    } else {
      CH.set(m.H, m.j0 * coarse.nx);
      CF.set(m.F, m.j0 * coarse.nx);
      CC.set(m.C, m.j0 * coarse.nx * 3);
    }
  }
  const dir = join(packDir, 'terrain');
  mkdirSync(dir, { recursive: true });
  const put = (file, data) => {
    const tmp = join(packDir, `${file}.tmp`);
    writeFileSync(tmp, data);
    renameSync(tmp, join(packDir, file));
  };
  const trn = { length: inp.trn.length, sha1: sha1Of(inp.trn) };
  const at = new Date().toISOString();
  // The far tree cards' file, its own (§1b Q11): one deflated section of the cards' samples.
  const kz = deflateSync(K, { level: 6 });
  put(HORIZON_CARDS_BIN, kz);
  put(HORIZON_CARDS_JSON, JSON.stringify({ format: HORIZON_CARDS_FORMAT, source: { generator: GENERATOR_REVISION, trn, centre: inp.centre, at }, cards, section: { offset: 0, length: kz.length, size: K.length } }, null, 1));
  const cardsMb = kz.length / 1048576;
  let families = 0;
  for (let i = 3; i < K.length; i += 4) if (K[i]) families++;
  if (cardsOnly) return { world, wall: performance.now() - t0, cpu, mb: 0, cardsMb, cards, cardsWithFamily: families, fine, coarse, wide: plan.wide, wideFamilies, threads, cardsOnly: true };
  const fh = encodeHeights(H, fine.nx, fine.nz);
  const chh = encodeHeights(CH, coarse.nx, coarse.nz);
  const raw = [
    ['heights', fh.bytes],
    ['families', F],
    ['colour', C],
    ['coarseHeights', chh.bytes],
    ['coarseFamilies', CF],
    ['coarseColour', CC],
  ];
  const parts = [];
  const sections = [];
  let offset = 0;
  for (const [name, bytes] of raw) {
    const z = deflateSync(bytes, { level: 6 });
    parts.push(z);
    sections.push({ name, offset, length: z.length, size: bytes.length });
    offset += z.length;
  }
  const header = {
    format: HORIZON_FORMAT,
    source: { generator: GENERATOR_REVISION, trn, inputs: inp.inputs, centre: inp.centre, layers: inp.layers, lifeDay: false, made: 'poles', at },
    fine: { ...fine, lo: fh.lo, q: fh.q },
    ground,
    colour,
    coarse: { ...coarse, lo: chh.lo, q: chh.q },
    sections,
  };
  const bin = Buffer.concat(parts);
  put(HORIZON_BIN, bin);
  put(HORIZON_JSON, JSON.stringify(header, null, 1));
  return { world, wall: performance.now() - t0, cpu, mb: bin.length / 1048576, cardsMb, cards, cardsWithFamily: families, fine, coarse, wide: plan.wide, wideFamilies, threads };
}

/**
 * What `status` says of a world's bake (§2.2): a line, and why it is stale or missing, or nothing for a world the bake
 * does not answer for. It never asks for one (§2.0 item 6: nothing asks a player to bake until the rings ship on); the
 * line carries the command that makes one.
 */
export function horizonStatusOf(planet, packDir) {
  const inp = bakeInputs(packDir);
  if (inp.why) return { line: null, why: null, stale: null };
  let cmd = `npm run swg -- horizon assets-private --only=${planet}`;
  const jsonPath = join(packDir, HORIZON_JSON);
  const binPath = join(packDir, HORIZON_BIN);
  if (!existsSync(jsonPath) || !existsSync(binPath)) return { line: `no far-ground bake (by hand: ${cmd})`, why: null, stale: 'missing' };
  const json = readJson(jsonPath);
  // Wave h6a: a world baked at 4 m is made again at 4 m.
  if (json?.fine?.step === 4) cmd += ' --step=4';
  const read = readHorizonHeader(json, { generator: GENERATOR_REVISION, centre: inp.centre, binLength: statSync(binPath).size }, planet);
  let stale = null;
  if ('refused' in read) stale = read.refused;
  else {
    const s = read.header.source;
    if (s.trn.length !== inp.trn.length || s.trn.sha1 !== sha1Of(inp.trn)) stale = 'the terrain file moved';
    else if (s.inputs !== inp.inputs) stale = 'a bitmap, the colour ramps or a building layer file moved';
    else if (s.layers?.sha1 !== inp.layers.sha1) stale = 'the building layers moved';
  }
  if (stale) return { line: `far-ground bake STALE: ${stale} (by hand: ${cmd})`, why: null, stale };
  const f = read.header.fine;
  // The far tree cards' file beside it (the fifth wave, §1b Q11): named, and never asked for (the Graphics page's option
  // that reads it starts off).
  const cards = cardsStatusOf(packDir, read.header);
  return { line: `far-ground bake (${f.step} m, ${f.nx} x ${f.nz}${read.header.source.made === 'grid' ? ', quick' : ''}; ${cards.words}${cards.stale ? ` (by hand: ${cmd} --cards-only)` : ''})`, why: null, stale: null, cards: cards.stale };
}

/**
 * The far tree cards' file beside a current bake (§1b Q11): what `status` says of it (`words`), and why it would be made
 * again (`stale`: missing, refused), or null where it is current.
 */
export function cardsStatusOf(packDir, header) {
  const jp = join(packDir, HORIZON_CARDS_JSON);
  const bp = join(packDir, HORIZON_CARDS_BIN);
  if (!existsSync(jp) || !existsSync(bp)) return { words: 'no far tree cards', stale: 'missing' };
  const read = readCardsHeader(readJson(jp), header, GENERATOR_REVISION, statSync(bp).size);
  if ('refused' in read) return { words: `far tree cards STALE: ${read.refused}`, stale: read.refused };
  return { words: `far tree cards ${read.header.cards.nx} x ${read.header.cards.nz}`, stale: null };
}

/**
 * Whether `status` asks a player for the offered worlds' bakes (§2.0 item 6, §7): false until the wave that turns the rings
 * on by default; the plan of that ask (after `radial`, every world a player is offered, never a `PlanetDef.extra`
 * developer world) stands in `status` behind it, so turning it on is this one word. On since the rings went on for everyone
 * (the owner, 2026-11-09).
 */
export const HORIZON_STATUS_ASKS = true;

/** The bake's files taken away (the tests' and a by-hand clean), the far tree cards' with them. */
export function removeHorizon(packDir) {
  for (const f of [HORIZON_JSON, HORIZON_BIN, HORIZON_CARDS_JSON, HORIZON_CARDS_BIN]) rmSync(join(packDir, f), { force: true });
}

export { BAKE_DEFAULTS };
