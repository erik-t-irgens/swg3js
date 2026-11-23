// His looks and his saved air in the game (the GPU port's pass 2, wave 4b, maker A; the brief's part A): the game's reader of
// the viewer's Save to game (`src/sky/look/bodiesFile.ts`) with its new `held` key, the viewer's air dials mapped onto the
// game's (`gameAirOf`) and made each named world's air behind a loading screen (`applyFileAir`, the record's own fields laid by
// `airParams.ts`'s `worldRecord`, handed to the fit's worker), the looks' pictures (`lookPictures.ts`: which look a place wears,
// its key, its size, the sky card's disc picture), the bake cache's pictures (`bakeCache.ts`'s `takeBytes`), and what the
// sky's cards wear (`skyLooks.ts`).
//
// What it holds:
//   - **no file, no change**: with no file, and with a file that names no world, nothing is touched (the dials, their count,
//     the record's fields), and every world's record, column densities, multiple scattering, sky radiance and fitted rows are
//     the base's (0746ccd, written out of git and run beside the tree's) to the bit; a file that named a world and then no
//     longer does puts its dials back and leaves the record as the base's again;
//   - **the mapping**: the twins set the game's dials exactly as the live dials do, the named fields land on the record as the
//     viewer's own `recordOf` lays them, the haze colour is the viewer's own `hazeTintFromHex` to the bit, everything else is
//     listed as the viewer's;
//   - **held bodies**: numbers and one word of a known picture, held to their ranges, anything else dropped;
//   - **the pictures**: place ids as the viewer names them, keys moving with the look's numbers, the disc picture where the
//     card's sphere reads it (north up, longitude 0 to the eye, its coverage), the surface layer's tone;
//   - **the bake cache's pictures**: memo, storage, budget, a refused bake kept nowhere;
//   - **the sky's cards**: a card wearing a look handed over with its disc picture and listed for the drawing, every other card
//     the very object the sky made, nothing baked with no file;
//   - the world's lines: the read awaited and the air applied before the world's air is made, the looks worn inside the
//     bodies' load before they are made, let go with them, all on WebGPU alone; the runtime hands the bake.
//   node tools/swg/tests/skyLooks.test.ts
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractOldSrc, REPO } from './airTrees.ts';

let checks = 0;
const ok = (cond: unknown, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** The commit the wave was cut from. */
const BASE = '0746ccd';
const OLD = extractOldSrc(BASE);
const NEW = join(REPO, 'src');
process.on('exit', () => {
  try {
    rmSync(dirname(OLD), { recursive: true, force: true });
  } catch {
    /* a temporary folder the system clears in its own time */
  }
});
register(pathToFileURL(join(REPO, 'tools', 'swg', 'tests', 'airLoader.mjs')).href, import.meta.url, { data: { roots: [OLD, NEW], packageBase: join(REPO, 'package.json') } });

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async (root: string, path: string): Promise<Any> => await import(pathToFileURL(join(root, path)).href);
const OP = await load(OLD, 'sky/air/airParams.ts');
const OT = await load(OLD, 'sky/air/airTwin.ts');
const OF = await load(OLD, 'sky/air/airFit.ts');
const NP = await load(NEW, 'sky/air/airParams.ts');
const NT = await load(NEW, 'sky/air/airTwin.ts');
const NF = await load(NEW, 'sky/air/airFit.ts');
const B = await load(NEW, 'sky/look/bodiesFile.ts');
const LP = await load(NEW, 'sky/look/lookPictures.ts');
const SL = await load(NEW, 'sky/look/skyLooks.ts');
const BC = await load(NEW, 'sky/bodies/bakeCache.ts');
const V = await load(NEW, 'sky/look/airProfile.js');
const THREE = await import('three');

function sameBits(a: ArrayLike<number>, b: ArrayLike<number>, n = Math.max(a.length, b.length)): boolean {
  if (a.length < n || b.length < n) return false;
  for (let i = 0; i < n; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}

const WORLDS = [...Object.keys(OP.AIR_WORLDS), 'yavin4', 'unknown_world'];

/** Everything of the air's dials and fields as text, and the dials' count. */
const airState = (): string => JSON.stringify({ dials: NP.AIR_DIALS, version: NP.AIR_DIAL_STATE.version, fields: NP.AIR_FILE_FIELDS, oz: NP.AIR_OZONE });

/** The base against the tree over every world: records, column densities, multiple scattering, radiance, twin frames, fits. */
function sameAsBase(what: string): void {
  let rec = true;
  let tab = true;
  let views = 0;
  const lightsO = new OT.AirLights();
  const lightsN = new NT.AirLights();
  const oO = new Float64Array(3);
  const oN = new Float64Array(3);
  const tO = new Float64Array(3);
  const tN = new Float64Array(3);
  for (const id of WORLDS) {
    const vis = NP.airDialsOf(id).visibilityKm;
    const o = OP.worldRecord(id);
    OP.setVisibility(o, OP.airDialsOf(id).visibilityKm);
    OP.applyHazeDials(id, o);
    const n = NP.worldRecord(id);
    NP.setVisibility(n, vis);
    NP.applyHazeDials(id, n);
    if (!sameBits(o, n)) rec = false;
    const dO = new Float64Array(OT.DEPTH_FLOATS);
    const dN = new Float64Array(NT.DEPTH_FLOATS);
    OT.buildDepthTable(o, dO);
    NT.buildDepthTable(n, dN);
    const pO = new Float64Array(OT.PSI_FLOATS);
    const pN = new Float64Array(NT.PSI_FLOATS);
    OT.buildPsiTable(o, dO, pO);
    NT.buildPsiTable(n, dN, pN);
    if (!sameBits(dO, dN) || !sameBits(pO, pN)) tab = false;
    for (const sunEl of [40, 2]) {
      const se = (sunEl * Math.PI) / 180;
      for (const L of [lightsO, lightsN]) {
        L.count = 1;
        L.dir.set([Math.cos(se), Math.sin(se), 0, 0, 1, 0, 0, 1, 0]);
        L.top.set([1, 1, 1, 0, 0, 0, 0, 0, 0]);
        L.live.set([1, 0, 0]);
      }
      for (const [el, az] of [[80, 0], [10, 90], [1, 180], [-5, 30]]) {
        const e = (el * Math.PI) / 180;
        const z = (az * Math.PI) / 180;
        OT.viewRadiance(o, dO, pO, o[OP.F.bottom] + 0.02, Math.cos(e) * Math.cos(z), Math.sin(e), Math.cos(e) * Math.sin(z), lightsO, 24, Infinity, oO, 0, tO);
        NT.viewRadiance(n, dN, pN, n[NP.F.bottom] + 0.02, Math.cos(e) * Math.cos(z), Math.sin(e), Math.cos(e) * Math.sin(z), lightsN, 24, Infinity, oN, 0, tN);
        views++;
        if (!sameBits(oO, oN) || !sameBits(tO, tN)) tab = false;
      }
    }
  }
  ok(rec, `${what}: every world's record (${WORLDS.length} worlds, at its dials) is the base's (${BASE}) to the bit`);
  ok(tab, `${what}: every world's column densities, multiple scattering and ${views} views of its sky are the base's to the bit`);
  // The fit, as the worker runs it, handed what the page hands it.
  let fit = true;
  let rows = 0;
  const ramp = (c: [number, number, number]): string => {
    const b = new Uint8Array(256 * 8 * 4);
    for (let i = 0; i < b.length; i += 4) {
      b[i] = c[0];
      b[i + 1] = c[1];
      b[i + 2] = c[2];
      b[i + 3] = 164;
    }
    return Buffer.from(b).toString('base64');
  };
  for (const id of ['tatooine', 'naboo', 'mustafar']) {
    const sky = { planet: id, sunElevationDegrees: 67.5, blocks: [
      { name: 'global', weatherIndex: 0, ramp: { rows: 8, rgba: ramp([110, 150, 230]) }, fog: { enabled: true, min: 0.0004, max: 0.0008 } },
      { name: 'global', weatherIndex: 1, ramp: { rows: 8, rgba: ramp([110, 150, 230]) }, fog: { enabled: true, min: 0.002, max: 0.004 } },
    ] };
    const d = NP.airDialsOf(id);
    const askO = { id: 1, sky, visibilityKm: d.visibilityKm, gradients: {}, hazeTint: [d.hazeR, d.hazeG, d.hazeB] };
    const askN = { ...askO, fileFields: NP.AIR_FILE_FIELDS[id] ?? null };
    const a = OF.fitReply(askO);
    const b = NF.fitReply(askN);
    if (a.records.length !== b.records.length || !sameBits(a.depth, b.depth)) fit = false;
    for (let i = 0; i < a.records.length; i++) {
      rows++;
      if (!sameBits(a.records[i], b.records[i]) || !sameBits(a.psis[i], b.psis[i])) fit = false;
    }
  }
  ok(fit, `${what}: the fit's ${rows} rows over three worlds, as the page asks the worker (the tree's ask with its fields), are the base's to the bit`);
}

// ---------------------------------------------------------------- 1. no file, no change

{
  const before = airState();
  const r = B.applyFileAir(null);
  ok(airState() === before && Object.keys(r).length === 0, 'with no file, the saved air touches nothing: no dial moved, their count not stepped, no field laid');
  sameAsBase('no file');
}
// A file of every other kind but naming no world.
const NOWORLD = B.cleanBodiesFile({ version: 1, made: 'x', credits: 'c', looks: { a: { name: 'A', kind: 'sphere', layers: {}, generated: { recipe: 'living', seed: 1, dials: {}, size: 1024 } } }, uses: {}, systems: {}, air: {}, pictures: {}, held: {} }).file;
{
  const before = airState();
  B.SKY_BODIES.file = NOWORLD;
  const r = B.applyFileAir();
  ok(NOWORLD && airState() === before && Object.keys(r).length === 0, 'a file naming no world touches nothing either');
  ok(LP.lookOfPlace('rori:celestial:cels_naboo') === null, 'and no place wears a look by it');
  sameAsBase('a file naming no world');
}

// ---------------------------------------------------------------- 2. the mapping

{
  for (const hex of ['#ffffff', '#fff3db', '#fff3e4', '#ffeed9', '#000000', '#8a9cb0', '#123456', '#ff0000']) {
    const mine = B.hazeSharesOf(hex);
    const theirs = V.hazeTintFromHex(hex, [0, 0, 0]);
    ok(mine && sameBits(mine, theirs), `the haze colour ${hex} is the viewer's own three shares to the bit (${mine?.map((x: number) => x.toFixed(4)).join(', ')})`);
  }
  const air = { mode: 'scattered', radiusKm: 7000, thicknessKm: 120, rayleighHeightKm: 10, skyColour: '#6a9fff', skyStrength: 1.2, visibilityKm: 30, hazeHeightKm: 2, hazeG: 0.75, hazeAlbedo: 0.8, hazeColour: '#fff3db', ozone: 1.5, groundAlbedo: 0.3, limbBright: 1.4, twilightBright: 0.9, limbDark: 0.1, nightFill: 0.2 };
  const g = B.gameAirOf(air);
  ok(g.dials.visibilityKm === 30 && sameBits([g.dials.hazeR, g.dials.hazeG, g.dials.hazeB], V.hazeTintFromHex('#fff3db', [0, 0, 0])), "the twins: the haze's visibility and colour become the game's own dials");
  ok(JSON.stringify(g.fields) === JSON.stringify({ radiusKm: 7000, thicknessKm: 120, rayleighHeightKm: 10, hazeHeightKm: 2, hazeG: 0.75, hazeAlbedo: 0.8, groundAlbedo: 0.3 }), 'the record fields it names, each as given');
  ok(['skyColour', 'skyStrength', 'ozone', 'limbBright', 'twilightBright', 'limbDark', 'nightFill', 'mode'].every((k) => g.viewerOnly.includes(k)), `the rest are listed as the viewer's: ${g.viewerOnly.join(', ')}`);
  ok(B.gameAirOf({ visibilityKm: 1000 }).dials.visibilityKm === 300 && B.gameAirOf({ visibilityKm: 0.01 }).dials.visibilityKm === 0.2, "the visibility held to the game's range (the viewer's 1000, no haze, is the game's 300, whose haze is nought)");
  ok(B.gameAirOf({ thicknessKm: 1e9, hazeG: -3 }).fields.thicknessKm === 3000 && B.gameAirOf({ hazeG: -3 }).fields.hazeG === 0, "a field held to the viewer's own range");
  // The fields on the record as the viewer's recordOf lays them.
  const id = 'naboo';
  NP.setAirFileFields(id, g.fields);
  const n = NP.worldRecord(id);
  NP.setVisibility(n, g.dials.visibilityKm);
  const v = V.recordOf(air);
  const F = NP.F;
  ok(n[F.bottom] === v[F.bottom] && n[F.top] === v[F.top] && n[F.rayH] === v[F.rayH] && n[F.ozC] === v[F.ozC] && n[F.ozW] === v[F.ozW], "the radius, the thickness, how fast it thins and the ozone's layer with it are the viewer's record's numbers to the bit");
  ok(n[F.mieH] === v[F.mieH] && n[F.mieG] === v[F.mieG] && n[F.mieAlbedo] === v[F.mieAlbedo] && n[F.groundR] === v[F.groundR] && n[F.groundG] === v[F.groundG] && n[F.groundB] === v[F.groundB], "the haze's height, glow and brightness and the ground's bounce likewise");
  const ext = n[F.rayG] + n[F.mieS] + n[F.mieA];
  ok(Math.abs(ext - NP.KOSCHMIEDER / 30) < 1e-12 && Math.abs(n[F.mieS] / (n[F.mieS] + n[F.mieA]) - 0.8) < 1e-12, `the haze's scattering and absorption from the same visibility and albedo: the surface's extinction ${ext.toFixed(6)} per km sees 30 km, 0.8 of the haze's share scattered (the clear air's own Rayleigh in it is the world's: the game fits its colour, the viewer's sky colour stays the viewer's)`);
  NP.setAirFileFields(id, null);
  ok(sameBits(NP.worldRecord(id), OP.worldRecord(id)), 'the fields taken off, the record is the base again');
}

// ---------------------------------------------------------------- 3. the saved air made a world's air, and put back

{
  const file = B.cleanBodiesFile({ version: 1, looks: {}, uses: {}, air: { naboo: { mode: 'scattered', visibilityKm: 12, hazeColour: '#ffd8a8', hazeHeightKm: 3, groundAlbedo: 0.25 } } }).file;
  const v0 = NP.AIR_DIAL_STATE.version;
  B.SKY_BODIES.file = file;
  const r = B.applyFileAir();
  const d = NP.airDialsOf('naboo');
  ok(d.visibilityKm === 12 && sameBits([d.hazeR, d.hazeG, d.hazeB], V.hazeTintFromHex('#ffd8a8', [0, 0, 0])) && NP.AIR_DIAL_STATE.version > v0, "a file naming Naboo sets Naboo's visibility and haze colour as the live dials set them (their count stepped, so a run in being follows)");
  ok(NP.AIR_FILE_FIELDS.naboo?.hazeHeightKm === 3 && NP.AIR_FILE_FIELDS.naboo?.groundAlbedo === 0.25 && r.naboo, "and lays the fields it names on Naboo's record");
  const rec = NP.worldRecord('naboo');
  ok(rec[NP.F.mieH] === 3 && rec[NP.F.groundG] === 0.25, "Naboo's record (its ground sky's base and its body's seen from Rori) carries them");
  ok(sameBits(NP.worldRecord('rori'), OP.worldRecord('rori')) && NP.airDialsOf('rori').visibilityKm === 40, 'a world the file does not name is as before');
  // The worker is handed them: its fit's records carry the fields.
  const sky = { planet: 'naboo', sunElevationDegrees: 67.5, blocks: [{ name: 'global', weatherIndex: 0, ramp: null, fog: { enabled: false, min: 0, max: 0 } }] };
  const fields = { ...NP.AIR_FILE_FIELDS.naboo };
  NP.setAirFileFields('naboo', null);
  const reply = NF.fitReply({ id: 1, sky, visibilityKm: 12, gradients: {}, fileFields: fields });
  ok(reply.records[0][NP.F.mieH] === 3 && NP.AIR_FILE_FIELDS.naboo?.hazeHeightKm === 3, "the fit's worker is handed the fields in its ask and lays them in its own copy before the fit: its rows carry them");
  const keep = NF.fitReply({ id: 2, sky, visibilityKm: 12, gradients: {} });
  ok(keep.records[0][NP.F.mieH] === 3, 'an ask without the fields (a node test, an older page) leaves the copy as it was');
  // The owner moves the visibility live, then the next screen's file drops Naboo: his move stays, the haze colour goes back.
  NP.tuneAirDials({ naboo: { visibilityKm: 25 } });
  B.SKY_BODIES.file = NOWORLD;
  B.applyFileAir();
  const back = NP.airDialsOf('naboo');
  ok(back.visibilityKm === 25 && back.hazeR === 1 && back.hazeG === 1 && back.hazeB === 1 && !NP.AIR_FILE_FIELDS.naboo, 'a later file that no longer names Naboo puts back what it set (the haze colour to grey, the fields off) and keeps what he moved since (the visibility)');
  NP.tuneAirDials({ naboo: { visibilityKm: 40 } });
  sameAsBase('after a file named Naboo and the next did not');
}

// ---------------------------------------------------------------- 4. held bodies

{
  const raw = {
    version: 1,
    looks: {},
    held: {
      endor: {
        deathstar: { picture: 'moon_deathstar2', yawDeg: 150, pitchDeg: 95, size: 0.8, rollDeg: 12, light: 1.5, note: 'a word of his' },
        cruiser: { picture: 'cels_moncal_cruiser.dds', yawDeg: 'x' },
        bad: { picture: 'his_own_picture.png' },
      },
      'Bad World': { a: { picture: 'moon_deathstar1' } },
      tatooine: { 'no-id!': { picture: 'moon_deathstar1' } },
    },
  };
  const c = B.cleanBodiesFile(raw);
  const h = c.file.held;
  ok(h.endor?.deathstar && JSON.stringify(h.endor.deathstar) === JSON.stringify({ picture: 'moon_deathstar2', yawDeg: 150, pitchDeg: 90, size: 0.8, rollDeg: 12, light: 1.5 }), 'a held body kept as numbers and one known picture, its pitch held to 90, a word of his dropped');
  ok(h.endor?.cruiser && h.endor.cruiser.picture === 'cels_moncal_cruiser' && h.endor.cruiser.yawDeg === 140 && h.endor.cruiser.size === 0.6, "a picture named with its extension is SWG's name; a number not a number takes SWG's placement's");
  ok(!h.endor?.bad && !h['Bad World'] && !h.tatooine && c.dropped >= 4, `a picture not of the sky pack, a world or a body of no plain id, are dropped (${c.dropped} dropped)`);
  ok(JSON.stringify(B.cleanBodiesFile({ version: 1 }).file.held) === '{}', 'a file without the key holds none (an older viewer\'s file reads as before)');
  B.SKY_BODIES.file = c.file;
  ok(B.heldBodiesOf('endor')?.deathstar?.picture === 'moon_deathstar2' && B.heldBodiesOf('naboo') === null, "a world's held bodies by the file, none for a world it does not name");
  ok(JSON.stringify(B.bodiesReport().file.held) === JSON.stringify({ endor: ['deathstar', 'cruiser'] }), "the console's report names them");
  ok(B.HELD_DEATH_STAR.picture === 'moon_deathstar1' && B.HELD_DEATH_STAR.yawDeg === 140 && B.HELD_DEATH_STAR.pitchDeg === 30 && B.HELD_DEATH_STAR.size === 0.6, "SWG's placement at stage 1 is what a held body starts from");
  const text = readFileSync(join(REPO, 'src', 'sky', 'look', 'bodiesFile.ts'), 'utf8');
  ok(/cleanHeld\(b, HELD_DEATH_STAR, count\)/.test(text), 'the reader cleans each held body by the one rule');
}

// ---------------------------------------------------------------- 4b. held bodies from the viewer's Save to game, and SWG's fallbacks

{
  const G = await import(pathToFileURL(join(REPO, 'viewer', 'gameBodies.mjs')).href);
  ok(JSON.stringify(G.HELD_PICTURES) === JSON.stringify(B.HELD_PICTURES) && JSON.stringify(G.HELD_RANGE) === JSON.stringify(B.HELD_RANGE) && JSON.stringify(G.HELD_START) === JSON.stringify(B.HELD_DEATH_STAR), "the viewer's writer and the game's reader hold one list of pictures, one set of ranges and SWG's placement alike");
  const made = G.gameBodiesFile({ looks: {}, uses: {}, held: { endor: { deathstar: { picture: 'moon_deathstar2', yawDeg: 150, pitchDeg: 30, size: 0.6, rollDeg: 12, light: 1 }, cruiser: { picture: 'cels_moncal_cruiser', yawDeg: 140, pitchDeg: 31, size: 0.5, rollDeg: 0, light: 1.2, note: 'x' } }, kashyyyk_main: { sd: { picture: 'cels_star_destroyer' } }, naboo: {} } }, { at: 'now' });
  ok(JSON.stringify(Object.keys(made.held)) === JSON.stringify(['endor', 'kashyyyk']) && made.held.endor.cruiser.note === undefined && made.held.kashyyyk.sd.yawDeg === 140, "Save to game writes the held bodies by the game's world (Kashyyyk's sky as `kashyyyk`), numbers and the picture alone, a number left out SWG's placement's, a world with none left out");
  const back = B.cleanBodiesFile(JSON.parse(JSON.stringify(made)));
  ok(back.dropped === 0 && JSON.stringify(back.file.held) === JSON.stringify(made.held), "the game's reader reads them back as written, nothing dropped");
  ok(G.gameBodiesFile({ looks: {}, uses: {} }, { at: 'now' }).held === undefined, 'a page with no held bodies writes no key (the file as before)');
  const P = await load(NEW, 'sky/look/placeholders.js');
  const sky = readFileSync(join(REPO, 'tools', 'swg', 'sky.mjs'), 'utf8');
  const named = new Set([...sky.matchAll(/\{ name: '([a-z0-9_]+)', use: 'fallback'/g)].map((m) => m[1]));
  const all = Object.values(P.SWG_FALLBACKS).flat() as string[];
  ok(named.size >= 5 && all.every((n) => named.has(n)), `every SWG fallback the placeholders name is a picture the converter writes (${[...new Set(all)].join(', ')})`);
  ok(P.swgFallbackOf('corell', 'drall')[0] === 'cels_earth_01' && P.swgFallbackOf('corell', 'selonia')[0] === 'cels_earth_01' && P.swgFallbackOf('tive', 'icemoon')[0] === 'moon_taan' && P.swgFallbackOf('hoth', 'm2')[0] === 'pln_ice_planetoid_main' && P.swgFallbackOf('yavin', 'y8')[0] === 'pln_ice_planetoid_main' && P.swgFallbackOf('lok', 'lok').length === 2, "Selonia and Drall, Taanab's moon, Hoth's moons and Yavin 8, and Lok's two unused layers each name SWG's picture");
}

// ---------------------------------------------------------------- 5. the looks' pictures

{
  ok(LP.skyPlaceId('rori', 'celestial', 'textures/cels_naboo.dds') === 'rori:celestial:cels_naboo' && LP.skyPlaceId('talus', 'celestial', 'CELS_CPOINT_TRALUS.DDS') === 'talus:celestial:cels_cpoint_tralus', 'a celestial card is its sky and its picture, as the viewer names the place');
  ok(LP.skyPlaceId('mustafar', 'celestial', 'cels_bespin.dds', 2) === 'mustafar:celestial:cels_bespin#2' && LP.skyPlaceId('naboo', 'moon', 'x.dds') === 'naboo:moon' && LP.skyPlaceId('kashyyyk_main', 'moon2', 'y') === 'kashyyyk_main:moon2', 'a second of one picture takes its number; a moon is its slot');
  ok(LP.viewerSkyOf('kashyyyk') === 'kashyyyk_main' && LP.viewerSkyOf('adventure2') === 'hoth' && LP.viewerSkyOf('rori') === 'rori', "the viewer's sky of a game world");
  const look = { name: 'Naboo', kind: 'sphere', layers: { clouds: { on: true, opacity: 0.9 } }, adjust: {}, generated: { recipe: 'living', version: 4, seed: 3141, dials: { land: 0.4 }, size: 4096 }, air: null };
  const file = B.cleanBodiesFile({ version: 1, looks: { 'generated:w3-naboo': look, photo: { name: 'P', layers: { surface: { tex: '' } } } }, uses: { 'rori:celestial:cels_naboo': 'generated:w3-naboo', 'naboo:moon': 'photo' } }).file;
  B.SKY_BODIES.file = file;
  const hit = LP.lookOfPlace('rori:celestial:cels_naboo');
  ok(hit?.id === 'generated:w3-naboo' && hit.look.generated.seed === 3141, 'a place wears its look by the file when the look is a generated one');
  ok(LP.lookOfPlace('naboo:moon') === null && LP.lookOfPlace('lok:moon') === null, "a look of photos alone, or a place the file does not name, wears SWG's picture");
  ok(LP.lookBakeSize(hit.look, LP.LOOK_BAKE_TUNE.skySize) === 1024 && LP.lookBakeSize(hit.look, LP.LOOK_BAKE_TUNE.spaceSize) === 2048 && LP.lookBakeSize({ generated: { size: 1024 } }, 4096) === 1024, "the bake's size: the use's at most, the look's own at most");
  ok(LP.lookHasClouds(hit.look) && !LP.lookHasClouds({ layers: {} }), 'clouds are baked where the look has its clouds on');
  const k1 = LP.lookPicturesKey(hit.look, 1024, true);
  const k2 = LP.lookPicturesKey(JSON.parse(JSON.stringify(hit.look)), 1024, true);
  const moved = JSON.parse(JSON.stringify(hit.look));
  moved.generated.dials.land = 0.41;
  ok(k1 === k2 && k1 !== LP.lookPicturesKey(moved, 1024, true) && k1 !== LP.lookPicturesKey(hit.look, 2048, true) && k1 !== LP.lookPicturesKey(hit.look, 1024, false) && k1.startsWith('look:v'), "the key: the same numbers find the same bake; a moved dial, another size or no clouds another");
  // A made lat-long: red by longitude (0 at -180°, 255 at +180°), green by latitude (0 south, 255 north), blue 0; clouds none.
  const W = 64;
  const H = 32;
  const surface = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    surface[i] = Math.round(((x + 0.5) / W) * 255);
    surface[i + 1] = Math.round(((y + 0.5) / H) * 255);
    surface[i + 2] = 0;
    surface[i + 3] = 255;
  }
  const pics = { id: 'm', key: 'k', width: W, height: H, surface, clouds: null, how: 'baked' };
  const S = 64;
  const disc = LP.discPicture(pics, { name: 'm', kind: 'sphere', layers: {}, adjust: {}, generated: null, air: null }, { size: S, fill: 0.9, faceLonDeg: 0, tiltDeg: 0 });
  const at = (x: number, y: number): number[] => Array.from(disc.subarray((y * S + x) * 4, (y * S + x) * 4 + 4));
  const c = at(S / 2, S / 2);
  ok(Math.abs(c[0] - 128) <= 3 && Math.abs(c[1] - 128) <= 6 && c[3] === 255, `the disc's middle is longitude 0 at the equator (${c.join(', ')})`);
  const right = at(Math.round(S / 2 + 0.45 * S * 0.7), S / 2);
  ok(right[0] > c[0] + 30, `east lies to the right (red ${right[0]} against ${c[0]})`);
  const top = at(S / 2, Math.round(S / 2 + 0.45 * S * 0.7));
  ok(top[1] > c[1] + 30, `north is up, the picture's later rows (green ${top[1]} against ${c[1]})`);
  ok(at(1, 1)[3] === 0 && at(S - 2, S / 2)[3] === 0 && at(S / 2, 1)[3] === 0 && at(S / 2, 2)[3] > 0 && at(S / 2, 2)[3] < 255, "outside the disc's fill nothing is covered, its rim a texel soft");
  const toned = LP.discPicture(pics, { name: 'm', kind: 'sphere', layers: { surface: { tint: '#808080' } }, adjust: {}, generated: null, air: null }, { size: S, fill: 0.9, faceLonDeg: 0, tiltDeg: 0 });
  const tc = Array.from(toned.subarray((S / 2 * S + S / 2) * 4, (S / 2 * S + S / 2) * 4 + 4));
  ok(Math.abs(tc[0] - Math.round(c[0] * (128 / 255))) <= 1, `the surface layer's tone is laid as the viewer lays it (a grey tint halves it: ${tc[0]} from ${c[0]})`);
  const turned = LP.discPicture(pics, { name: 'm', kind: 'sphere', layers: {}, adjust: {}, generated: null, air: null }, { size: S, fill: 0.9, faceLonDeg: 90, tiltDeg: 0 });
  const tm = Array.from(turned.subarray((S / 2 * S + S / 2) * 4, (S / 2 * S + S / 2) * 4 + 4));
  ok(Math.abs(tm[0] - 191) <= 4, `the face's longitude turns the body (90° to the eye: red ${tm[0]}, three quarters)`);
}

// ---------------------------------------------------------------- 6. the bake cache's pictures

{
  let clock = 0;
  const kept = new Map<string, ArrayBuffer[]>();
  const store = { get: async (k: string) => kept.get(k) ?? null, put: async (k: string, p: ArrayBuffer[]) => void kept.set(k, p) };
  const cache = new BC.BakeCache(store, () => clock);
  cache.beginScreen();
  let made = 0;
  const make = async (): Promise<Uint8Array[]> => {
    made++;
    clock += 150;
    return [new Uint8Array([1, 2, 3, 4])];
  };
  const a = await cache.takeBytes('look:v1:a', make);
  ok(a.how === 'baked' && made === 1 && cache.stats.screenMs === 150, "a first bake is made, its awaited time counted against the screen's budget");
  const b = await cache.takeBytes('look:v1:a', make);
  ok(b.how === 'memo' && made === 1 && b.parts === a.parts, 'the same key again answers from the memo');
  const c = await cache.takeBytes('look:v1:b', make);
  ok(c.how === 'baked' && made === 2 && cache.stats.screenMs === 300, 'a second look begun under the budget is baked');
  const d = await cache.takeBytes('look:v1:c', make);
  ok(d.how === 'fallback' && d.parts === null && made === 2 && cache.stats.waiting.includes('look:v1:c'), "a look begun past the budget is put off to the next screen (SWG's picture until then)");
  const fresh = new BC.BakeCache(store, () => clock);
  fresh.beginScreen();
  const e = await fresh.takeBytes('look:v1:a', make);
  ok(e.how === 'stored' && made === 2 && e.parts[0][2] === 3, 'a new session reads it from the storage: the second arrival bakes nothing');
  const refused = await fresh.takeBytes('look:v1:z', async () => null);
  ok(refused.how === 'fallback' && !fresh.has('look:v1:z') && !kept.has('look:v1:z'), 'a bake that answers nothing is kept nowhere');
  ok(fresh.bytesIfHad('look:v1:a') === e.parts && fresh.bytesIfHad('look:v1:q') === null, 'what the memo has, without a bake or the storage');
  // The fixer of pass 2, wave 4b: pictures let go from the memo once their reader has them, where the storage holds them; the
  // next ask reads them back (no bake); a store that refused them keeps them in the memo, so the session never loses a look.
  ok(fresh.dropBytes('look:v1:a') && fresh.bytesIfHad('look:v1:a') === null, 'pictures the storage holds are let go from the memo');
  const back = await fresh.takeBytes('look:v1:a', make);
  ok(back.how === 'stored' && made === 2 && back.parts[0][3] === 4, 'and the next ask reads them back from the storage: nothing baked');
  const refusing = new BC.BakeCache({ get: async () => null, put: async () => { throw new Error('refused'); } }, () => clock);
  refusing.beginScreen();
  const r1 = await refusing.takeBytes('look:v1:r', make);
  ok(r1.how === 'baked' && !refusing.dropBytes('look:v1:r') && refusing.bytesIfHad('look:v1:r') === r1.parts, 'where the storage refused them they stay in the memo');
}

// ---------------------------------------------------------------- 7. what the sky's cards wear

{
  const look = { name: 'Naboo', kind: 'sphere', layers: {}, adjust: {}, generated: { recipe: 'living', seed: 1, dials: {}, size: 1024 }, air: null };
  B.SKY_BODIES.file = B.cleanBodiesFile({ version: 1, looks: { nab: look }, uses: { 'rori:celestial:cels_naboo': 'nab' } }).file;
  const pic = new THREE.Texture();
  const card = (file: string, slot: string): Any => ({ disc: new THREE.Mesh(), glow: null, file, map: pic, air: { kind: 'world', world: 'naboo' }, slot });
  const cards = [card('cels_naboo.dds', 'celestial'), card('moon_rori.dds', 'moon')];
  const asked: string[] = [];
  const W = 32;
  const looks = {
    bake: async (id: string, l: Any, most: number) => {
      asked.push(`${id}@${most}`);
      return { id, key: 'k', width: W, height: W / 2, surface: new Uint8Array(W * (W / 2) * 4).fill(200), clouds: null, how: 'baked' };
    },
    baked: () => null,
    forget: () => {},
    report: () => ({}),
    // The fixer of pass 2, wave 4b: the bake's own pictures let go once the disc is made (the storage keeps them).
    released: [] as string[],
    release(l: Any, most: number) {
      this.released.push(`${l.name}@${most}`);
    },
    warmed: [] as string[],
    began: 0,
    warm(l: Any, most: number) {
      this.warmed.push(`${l.name}@${most}`);
      return Promise.resolve();
    },
    beginScreen() {
      this.began++;
    },
  };
  ok(SL.warmZoneLooks('rori', looks) === 1 && looks.warmed[0] === `Naboo@${LP.LOOK_BAKE_TUNE.skySize}` && SL.warmZoneLooks('naboo', looks) === 0 && SL.warmZoneLooks('', looks) === 0, "a screen's start asks for the kit of each look its zone's places wear, and nothing for a zone the file does not name");
  const worn = await SL.wearSkyLooks('rori', cards, looks);
  ok(looks.began === 1, "the looks begin the screen's budget whole");
  ok(asked.length === 1 && asked[0] === `nab@${LP.LOOK_BAKE_TUNE.skySize}`, "only the card whose place names a look is baked, at the sky's size");
  ok(looks.released.length === 1 && looks.released[0] === `Naboo@${LP.LOOK_BAKE_TUNE.skySize}`, "and its bake's pictures are let go once its disc picture is made (the fixer's: the memo kept every bake all session)");
  ok(worn.cards[0] !== cards[0] && worn.cards[0].map !== pic && worn.cards[0].map.image.width === LP.LOOK_BAKE_TUNE.discSize && worn.cards[0].disc === cards[0].disc, 'it is handed over wearing its disc picture, the same disc mesh');
  ok(worn.cards[1] === cards[1], 'every other card is the very card the sky made');
  ok(SL.skyLookOf(cards[0].disc)?.id === 'nab' && SL.skyLookOf(cards[0].disc)?.albedo === 1 && SL.skyLookOf(cards[1].disc) === null, 'the card wearing a look is listed for the drawing (lit as a sphere, its colours its albedo)');
  ok(worn.cards[0].map.colorSpace === THREE.SRGBColorSpace && worn.cards[0].map.generateMipmaps === true, 'its picture is sRGB with mips, as SWG\'s pictures are');
  SL.dropSkyLooks(worn);
  ok(SL.skyLookOf(cards[0].disc) === null, 'let go with its sky');
  const none = await SL.wearSkyLooks('rori', cards, { ...looks, bake: async () => null });
  ok(none.cards[0] === cards[0] && none.textures.length === 0, "a bake put off past the budget leaves the card in SWG's picture");
  B.SKY_BODIES.file = null;
  asked.length = 0;
  looks.began = 0;
  const nofile = await SL.wearSkyLooks('rori', cards, looks);
  ok(asked.length === 0 && looks.began === 0 && nofile.cards.every((c: Any, i: number) => c === cards[i]) && SL.warmZoneLooks('rori', looks) === 0, 'with no file nothing is baked or asked for, the budget untouched, and every card is as the sky made it');
}

// ---------------------------------------------------------------- 8. the world's lines and the runtime's

{
  const w = readFileSync(join(REPO, 'src', 'world', 'world.ts'), 'utf8');
  ok(/this\.skyLookSky = basePack;\s*if \(GPU\.webgpu && this\.bodiesRead\) \{\s*await this\.bodiesRead;\s*if \(token !== this\.loadToken\) return;\s*applyFileAir\(\);\s*\}\s*\/\/ The weather's effects/.test(w), "the screen's read is awaited and its saved air applied on WebGPU alone, before the weather and the world's air are made");
  const lb = w.slice(w.indexOf('private async loadBodies(sky: SwgSky)'), w.indexOf('private dropBodies(): void'));
  ok(/const worn = await wearSkyLooks\(this\.skyLookSky, cards, GPU\.rt!\.looks\);\s*const set = await GPU\.rt!\.skyBodies\.make\(worn\.cards\);/.test(lb) && /dropSkyLooks\(worn\);/.test(lb), 'the looks are worn inside the bodies\' load, before the bodies are made, and let go if the sky went meanwhile');
  const db = w.slice(w.indexOf('private dropBodies(): void'), w.indexOf('private dropBodies(): void') + 400);
  ok(/dropSkyLooks\(this\.skyLooks\);/.test(db), 'and let go with the bodies');
  ok(/if \(GPU\.webgpu\) this\.bodiesRead = readBodiesFile\(\)\.catch\(\(\) => null\);\s*(\/\/[^\n]*\n\s*)*if \(GPU\.webgpu && this\.bodiesRead\) void this\.bodiesRead\.then\(\(\) => warmZoneLooks\(this\.packId, GPU\.rt!\.looks\)\);/.test(w), "the zone's kits are asked for as soon as the screen's read lands, never awaited, on WebGPU alone");
  const s = readFileSync(join(REPO, 'src', 'core', 'gpu', 'start.ts'), 'utf8');
  ok(/import \{ LookBaker \} from '\.\.\/\.\.\/sky\/look\/lookBake\.ts';/.test(s) && /looks: \(\(\) => \{\s*const baker = new LookBaker\(renderer\);/.test(s), 'the runtime makes one baker a session on the game\'s renderer');
  const bake = readFileSync(join(REPO, 'src', 'sky', 'look', 'lookBake.ts'), 'utf8');
  ok(/cache\.takeBytes\(key, \(\) => bakeOnCard\(this\.renderer, key, look, size, clouds, BAKE_TUNE\.budgetMs - cache\.stats\.screenMs\)\)/.test(bake) && /\.warm\(renderer, gen, \{ withClouds: clouds, again: !!had \}\)/.test(bake) && /set\.dispose\(\);/.test(bake), "a bake goes through the bake cache's budget, its kit waited on for what the budget has left, its targets freed after the read-back");
  ok(/if \(!landed\) \{[\s\S]{0,300}return null;/.test(bake) && /if \(!drawn\(surface\)/.test(bake), 'a kit not landed within the budget, or a read-back that came back empty, bakes nothing and keeps nothing');
  ok(/landed = kit\.clean;/.test(bake) && /ask\.clean = took < LOST_AFTER_MS;/.test(bake) && /if \(had && \(!had\.done \|\| had\.clean\)\) return had;/.test(bake), "an ask answered only at the warm-up's own bound is not a landing: the next bake asks again before it draws");
  // The kit's ask: each pass's pipeline asked once and kept until it lands, so a later screen awaits the same asks.
  const gen = readFileSync(join(REPO, 'src', 'sky', 'look', 'generate.js'), 'utf8');
  ok(/kit\.warming \?\?= new Map\(\);/.test(gen) && /p = Promise\.resolve\(renderer\.compileAsync\(q, q\.camera\)\)\.catch\(\(\) => \{\}\);\s*kit\.warming\.set\(m, p\);/.test(gen), "the viewer's bake gains a warm of its kit for the game, each pass's ask kept until it lands");
}

// ---------------------------------------------------------------- the kit's warm is the bake's own pipelines (the wave's fixer)
{
  // The checker's blocker: a kit warmed ahead and landed, the bake's draws still built their own pipelines for a minute on a
  // cold shader cache. Three's `QuadMesh.render` swaps its own vertex stage in for the draw (a triangle from the vertex index),
  // and `compileAsync` took the material as it stood (a position buffer): a program apart. Held by the game's own code over a
  // stand-in renderer: every pass the warm asks for and every pass the bake draws carries three's draw-time vertex stage, the
  // height passes' pictures pointed at the height target before either, each pass against its own target.
  const THREE = await import('three/webgpu');
  const G = await import('../../../src/sky/look/generate.js');
  let drawVertex: unknown = 'unset';
  new THREE.QuadMesh(new THREE.NodeMaterial()).render({ render: (o: { material: { vertexNode: unknown } }) => { drawVertex = o.material.vertexNode; } } as never);
  const asked: { v: unknown; rt: unknown; mat: unknown }[] = [];
  const drawn: { v: unknown; rt: unknown; mat: unknown }[] = [];
  const stand = {
    rt: null as unknown,
    getRenderTarget() { return this.rt; },
    setRenderTarget(t: unknown) { this.rt = t; },
    compileAsync(q: { material: { vertexNode: unknown } }) { asked.push({ v: q.material.vertexNode, rt: this.rt, mat: q.material }); return Promise.resolve(); },
    render(q: { material: { vertexNode: unknown } }) { drawn.push({ v: q.material.vertexNode, rt: this.rt, mat: q.material }); },
    readRenderTargetPixelsAsync: async () => new Uint8Array(4),
  };
  const gen = { ...(G.presetLook('naboo').generated as Record<string, unknown>), size: 1024 };
  const set = new G.GeneratedSet(1024);
  await set.warm(stand, gen, { withClouds: true, again: true });
  await set.bake(stand, gen, { withClouds: true });
  ok(drawVertex !== 'unset' && drawVertex !== null && drawVertex !== undefined, "three's quad swaps a vertex stage of its own in for its draw (the stand-in renderer read it)");
  ok(asked.length >= 4 && asked.every((a) => a.v === drawVertex && a.rt), `every pass the warm asks for carries the draw's vertex stage, against a target (${asked.length} passes)`);
  ok(drawn.length === asked.length && drawn.every((d) => d.v === drawVertex) && drawn.every((d) => asked.some((a) => a.mat === d.mat && a.rt === d.rt)), `and the bake draws those very materials into those very targets with the same stage (${drawn.length} draws)`);
  ok(/const fields = fieldTarget\(this\.width, this\.height\);\s*for \(const n of kit\.fieldNodes\) n\.value = fields\.texture;\s*const passes = \[\[kit\.heightMat, fields\]/.test(readFileSync(join(REPO, 'src', 'sky', 'look', 'generate.js'), 'utf8')), "the warm points the height passes' pictures at the height target first, as the bake does (a nearest picture is read by a load, not a sample)");
  set.dispose();
}

console.log(`\nskyLooks: ${checks} checks passed`);
