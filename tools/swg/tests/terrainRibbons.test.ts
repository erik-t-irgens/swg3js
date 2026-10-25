// The terrain's ribbons (the volumetrics' fifth wave's survey, the owner's Q8: `ARIB`, `AffectorRibbon` in the generator,
// `src/swg/terrain/ribbons.ts`): the client's shapes built again -- n + 1 quads for n points, each end crossed by a flat
// normal, two meeting normals averaged and never made a unit again; an eight-cornered cap off the first point -- carried
// into the game's frame with each run's X turned over with the place's; the highest surface over a point with its flow
// along its run at the ribbon's velocity, nought in its cap; the triangles a mesh draws. The reader (`AffectorRibbon`)
// over ARIB forms built here from bytes, at versions 5, 4 and 2, every field in its place (so a field order swapped is
// caught on a machine with no pack). Over a converted Mustafar (when the pack is there): every ribbon and quad the survey
// counted, each at a velocity of one and a shader repeat of 64 or 128, falling along its points; and, said and not
// held, how much of them stands at or over our ground there (the client's own ribbon evidently lowered its ground, which
// ours does not: W5-notes).
//
// Plain type stripping.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gameRibbon, ribbonAt, ribbonCap, ribbonQuads, ribbonTriangles, terrainRibbons, type TerrainRibbon } from '../../../src/swg/terrain/ribbons.ts';
import { AffectorRibbon, FractalGroup, loadLayerItem } from '../../../src/swg/terrain/generator.ts';
import { parseIff } from '../../../src/swg/terrain/iff.ts';
import { chunk, encode, form, ihdr, W } from './iffWriter.ts';
import { REPO } from './airTrees.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, e = 1e-9): boolean => Math.abs(a - b) <= e;

// --- the quads ---
{
  const pts = [
    { x: 0, z: 0, h: 10 },
    { x: 10, z: 0, h: 8 },
    { x: 20, z: 10, h: 5 },
  ];
  const { quads, runs } = ribbonQuads(pts, 4);
  ok(quads.length === 4 * 12 && runs.length === 4 * 2, 'three points make four quads: one reaching back, two between, one reaching on');
  // The first reaches back half a width (2 m) behind the first point at its height.
  ok(near(quads[0], -2) && near(quads[2], -2) && near(quads[1], 10) && near(quads[3], -2) && near(quads[5], 2), "the first quad's back end stands half a width behind the first point, at its height, crossed square to its run");
  // Where the second and third segments meet (at (10, 0)), the normal is the mean of (0, -1) and the turned run's, not a unit.
  const d = Math.SQRT1_2;
  const nx = (0 + d) / 2;
  const nz = (-1 - d) / 2;
  ok(near(quads[12 + 6], 10 - nx * 2) && near(quads[12 + 8], 0 - nz * 2) && near(quads[24 + 0], 10 + nx * 2) && near(quads[24 + 2], 0 + nz * 2), 'where two segments meet their normals are averaged and never made a unit again, so the bend narrows the strip a little as the client\'s did');
  ok(near(runs[2], 1) && near(runs[3], 0) && near(runs[4], d) && near(runs[5], d), 'each quad carries its run, flat and a unit');
  ok(ribbonQuads([{ x: 0, z: 0, h: 0 }], 3).quads.length === 0, 'a single point makes nothing');
}

// --- the cap ---
{
  const cap = ribbonCap([{ x: 0, z: 0 }, { x: 0, z: -10 }], 2);
  ok(cap !== null && cap.length === 16, 'a cap is eight corners');
  let minZ = Infinity;
  for (let i = 0; i < 8; i++) minZ = Math.min(minZ, cap![i * 2 + 1]);
  ok(minZ >= -1e-9, 'standing off the first point on the side away from the second');
  ok(ribbonCap([{ x: 0, z: 0 }, { x: 0, z: -10 }], 0) === null, 'and none for a cap width of nought');
}

// --- the game's frame, the surface, the triangles ---
{
  const r: TerrainRibbon = {
    version: 5,
    points: [
      { x: 100, z: 50, h: 30 },
      { x: 100, z: 70, h: 20 },
    ],
    width: 6,
    shaderSize: 64,
    velocity: 1.5,
    capWidth: 4,
    familyId: 0,
    featherFunction: 0,
    featherDistance: 0.5,
    shader: 'wter_lava_01_slow',
    waterType: 1,
    name: 'test',
    quads: new Float64Array(0),
    runs: new Float64Array(0),
    cap: null,
    capHeight: 30,
  };
  const q = ribbonQuads(r.points, r.width);
  r.quads = q.quads;
  r.runs = q.runs;
  r.cap = ribbonCap(r.points, r.capWidth);
  // The game's X is the client's mirrored about a centre of 1000, its Z the client's less 0.
  const g = gameRibbon(r, (x) => 1000 - x, (z) => z);
  ok(near(g.quads[0], 1000 - r.quads[0]) && near(g.quads[2], r.quads[2]) && near(g.runs[2], -r.runs[2]) && near(g.runs[3], r.runs[3]), "carried into the game's frame: every corner by the world's own mirror, each run's X turned over with it");
  const out = { h: 0, fx: 0, fz: 0, type: 0 };
  ok(ribbonAt([g], 900, 60, out) && near(out.h, 25, 1e-6) && near(out.fx, 0) && near(out.fz, 1.5) && out.type === 1, `the surface half way down is half way between its points' heights (${out.h.toFixed(3)} m), flowing down its run at its velocity (${out.fx}, ${out.fz})`);
  ok(ribbonAt([g], 900, 45, out) && out.fx === 0 && out.fz === 0 && near(out.h, 30), "in the cap (past the first quad's back end) the pool stands at the first point's height and does not flow");
  ok(!ribbonAt([g], 950, 60, out), 'and off the ribbon there is none');
  const t = ribbonTriangles(g);
  ok(t.position.length === (3 * 4 + 8) * 3 && t.index.length === 3 * 6 + 6 * 3, 'its triangles: two a quad and six for the cap');
}

// --- the reader, over ARIB forms built from bytes ---
{
  const pts = [
    [1.5, 2.5, 10.25],
    [3.5, -4.5, 8.5],
    [7, 9, 6],
  ];
  const arib = (version: number): Uint8Array => {
    const w = new W().i32(pts.length);
    for (const [x, z, h] of pts) {
      w.f32(x).f32(z);
      if (version >= 3) w.f32(h);
    }
    w.f32(4.5);
    if (version <= 2) w.f32(99);
    if (version >= 1) w.f32(32).f32(1.75);
    if (version >= 4) w.f32(6.25);
    else w.i32(7);
    if (version >= 5) w.i32(14).i32(2).f32(0.4);
    w.str('wter_lava_test');
    if (version >= 2) w.i32(1);
    return encode(form('ARIB', form(`000${version}`, ihdr(`ribbon ${version}`), form('DATA', chunk('DATA', w.bytes())))));
  };
  const read = (version: number) => {
    const item = loadLayerItem(parseIff(arib(version)), new FractalGroup());
    return item instanceof AffectorRibbon ? item.ribbon : null;
  };
  const five = read(5);
  ok(
    !!five && five.version === 5 && five.points.length === 3 && five.points.every((p, i) => p.x === pts[i][0] && p.z === pts[i][1] && p.h === pts[i][2]) && five.width === 4.5 && five.shaderSize === 32 && five.velocity === 1.75 && five.capWidth === 6.25 && five.familyId === 14 && five.featherFunction === 2 && Math.abs(five.featherDistance - 0.4) < 1e-6 && five.shader === 'wter_lava_test' && five.waterType === 1,
    'a version-5 ribbon read from its bytes: each point its x, z and own height in that order, the width, the shader\'s repeat before the velocity, the cap\'s own width, the family and its feather, the shader and the water type',
  );
  const four = read(4);
  ok(!!four && four.points[2].h === 6 && four.capWidth === 6.25 && four.familyId === 0 && four.shader === 'wter_lava_test' && four.waterType === 1, 'version 4: its own cap width, no family');
  const two = read(2);
  ok(!!two && two.points.every((p, i) => p.x === pts[i][0] && p.z === pts[i][1] && p.h === 0) && two.width === 4.5 && two.shaderSize === 32 && two.velocity === 1.75 && two.capWidth === 4.5 && two.shader === 'wter_lava_test' && two.waterType === 1, "version 2: no height a point (each at nought), the old depth and forward direction stepped over, the cap the strip's own width");
}

// --- Mustafar, when the pack is there ---
{
  const dir = join(REPO, 'assets-private', 'mustafar');
  if (!existsSync(join(dir, 'terrain.trn'))) console.log('note Mustafar is not converted here: its ribbons are not read');
  else {
    const trn = await import('../../../src/swg/terrain/trn.ts');
    const t = trn.parseTerrainTemplate(new Uint8Array(readFileSync(join(dir, 'terrain.trn'))));
    const rs = terrainRibbons(t.generator);
    const quads = rs.reduce((n, r) => n + r.quads.length / 12, 0);
    ok(rs.length === 33 && quads === 513, `Mustafar's terrain holds ${rs.length} ribbons of ${quads} quads (the survey's 33 and 513), every one read`);
    const shaders = [...new Set(rs.map((r) => r.shader))].sort();
    ok(rs.every((r) => r.waterType === 1 && r.version === 5) && shaders.join() === 'wter_lava_01_fast,wter_lava_01_slow', `every one lava (type 1) at version 5, in two shaders (${shaders.join(', ')})`);
    const sizes = [...new Set(rs.map((r) => r.shaderSize))].sort((a, b) => a - b);
    ok(rs.every((r) => r.velocity === 1) && sizes.join() === '64,128', `every one at a velocity of one and a shader repeat of ${sizes.join(' or ')} m (the fields read in their places)`);
    let worstRise = 0;
    let falls = true;
    for (const r of rs) {
      if (!(r.points[r.points.length - 1].h < r.points[0].h)) falls = false;
      for (let i = 1; i < r.points.length; i++) worstRise = Math.max(worstRise, r.points[i].h - r.points[i - 1].h);
    }
    ok(falls && worstRise <= 2, `every one falls from its first point to its last, no step rising more than ${worstRise} m: the heights are each point's own and in order`);
    // Said, not held: how much of them our ground leaves showing (W5-notes: the client's ribbon must have lowered its
    // ground along it, which our generator, holding the affector inert, does not).
    const s = new trn.TerrainSampler(t);
    let corners = 0;
    let showing = 0;
    let ribbonsShowing = 0;
    for (const r of rs) {
      let any = false;
      for (let q = 0; q < r.quads.length; q += 3) {
        corners++;
        if (r.quads[q + 1] >= s.heightAt(r.quads[q], r.quads[q + 2]) - 1) {
          showing++;
          any = true;
        }
      }
      if (any) ribbonsShowing++;
    }
    console.log(`note ${showing} of the ribbons' ${corners} quad corners stand at or over our ground (within a metre), on ${ribbonsShowing} of the ${rs.length} ribbons: the rest are drawn under it`);
  }
}

console.log(`\n${checks} checks passed`);
