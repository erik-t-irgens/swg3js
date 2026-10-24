// The ground variant's gates, in the JS mirror (src/world/volumetrics/airMath.ts's `groundShift`, `dentNormal`,
// `dentDarken`, `dustShade`; the volumetrics design's §9 Tests and §4.1 item 5): at each dial nought the output is the
// input by `Object.is` over random inputs -- negative zero among them -- and NaN and infinite fields; at one a known
// offset moves a sand layer's sample by its metres turned into the picture's frame with the mirror's sign
// (`uGroundFrame.z`) and a rock layer's not at all, which is the world point the offset names; a field's NaN or infinity
// is nought, never a NaN pixel. And the shader's lines are held to the mirror's as text, so neither moves alone.
//
// What node cannot do, the browser does: `__debug.air({ groundSelfTest: true })` draws the variant against this mirror.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dentDarken, dentNormal, dustShade, groundShift } from '../../../src/world/volumetrics/airMath.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

// A seeded generator, so a failure is the same failure next time.
let seed = 0x5eed1234;
const rand = (): number => {
  seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
  return (seed >>> 0) / 4294967296;
};
const ODD = [-0, 0, Number.NaN, Infinity, -Infinity, 1e-30, -1e30];
const anyNumber = (): number => (rand() < 0.25 ? ODD[Math.floor(rand() * ODD.length)] : (rand() - 0.5) * 10 ** (rand() * 6 - 3));
const N = 20000;

// --- every dial nought: the input, to the bit ---
{
  const out = { x: 1, y: 1 };
  const n3 = { x: 0, y: 0, z: 0 };
  let shift = true;
  let coord = true;
  let normal = true;
  let dark = true;
  let shade = true;
  let negZero = 0;
  for (let i = 0; i < N; i++) {
    const [ox, oz, moves, fade, fz, uv, c, d, nx, ny, nz, dx, dz, t, T] = Array.from({ length: 15 }, anyNumber);
    groundShift(ox, oz, moves, 0, fade, fz, out);
    if (!Object.is(out.x, 0) || !Object.is(out.y, 0)) shift = false;
    // The sample coordinate is `uv + shift`: the same number for every uv but a negative zero, which comes out a
    // positive one and which the texture lookup reads alike (the same texel either way).
    if (Object.is(uv, -0)) {
      negZero++;
      if (uv + out.x !== uv) coord = false;
    } else if (!Object.is(uv + out.x, uv)) coord = false;
    dentNormal(nx, ny, nz, dx, dz, t, 0, n3);
    if (!Object.is(n3.x, nx) || !Object.is(n3.y, ny) || !Object.is(n3.z, nz)) normal = false;
    if (!Object.is(dentDarken(c, d, 0), c)) dark = false;
    if (!Object.is(dustShade(c, T, 0, fade), c)) shade = false;
  }
  ok(shift, `the shift at the drift's dial nought is exactly a positive nought, over ${N} random offsets, moves, fades and frames (NaN and infinite among them)`);
  ok(coord && negZero > 0, `so the sample coordinate is the picture's own, to the bit (${negZero} negative zeros come out positive, the same texel)`);
  ok(normal, 'the normal at the prints\' dial nought is the one that came, to the bit, whatever the slopes and the texel');
  ok(dark, 'the colour at the prints\' dial nought is the one that came, to the bit, whatever the depth (negative zero and NaN colours included)');
  ok(shade, 'the light at the shade\'s dial nought is the one that came, to the bit, whatever the transmittance');
}
// And at a dial above nought where nothing is there to change: flat ground bends nothing, a clear sky shades nothing.
{
  const n3 = { x: 0, y: 0, z: 0 };
  let flat = true;
  let clear = true;
  let pressed = true;
  for (let i = 0; i < N; i++) {
    const [nx, ny, nz, light, c] = Array.from({ length: 5 }, anyNumber);
    const art = rand() * 1.5 + 0.01;
    dentNormal(nx, ny, nz, 0, 0, 0.0625, art, n3);
    if (!Object.is(n3.x, nx) || !Object.is(n3.y, ny) || !Object.is(n3.z, nz)) flat = false;
    if (!Object.is(dustShade(light, 1, art, 1), light)) clear = false;
    if (!Object.is(dentDarken(c, 0, art), c)) pressed = false;
  }
  ok(flat && clear && pressed, 'at any dial, flat ground bends no normal, a clear sky takes no light and no depth darkens anything, to the bit');
}

// --- the drift at one: the world point the offset names ---
{
  const out = { x: 0, y: 0 };
  const o = { x: 0.6, z: -0.35 };
  // The picture coordinate of a world point under a frame, `TILE_VERTEX`'s own line (`terrainTextures.ts`):
  // vGroundUV = vec2( frame.z · (frame.x − wx), wz + frame.y ) · 0.25.
  const pic = (wx: number, wz: number, fx: number, fy: number, fz: number) => ({ x: fz * (fx - wx) * 0.25, y: (wz + fy) * 0.25 });
  let sand = true;
  let rock = true;
  let half = true;
  for (const fz of [1, -1]) {
    for (let i = 0; i < 200; i++) {
      const wx = (rand() - 0.5) * 4000;
      const wz = (rand() - 0.5) * 4000;
      const fx = Math.round((rand() - 0.5) * 2000);
      const fy = Math.round((rand() - 0.5) * 2000);
      const here = pic(wx, wz, fx, fy, fz);
      const there = pic(wx + o.x, wz + o.z, fx, fy, fz);
      groundShift(o.x, o.z, 1, 1, 1, fz, out);
      if (Math.abs(here.x + out.x - there.x) > 1e-9 || Math.abs(here.y + out.y - there.y) > 1e-9) sand = false;
      groundShift(o.x, o.z, 0, 1, 1, fz, out);
      if (out.x !== 0 || out.y !== 0) rock = false;
      groundShift(o.x, o.z, 0.5, 1, 1, fz, out);
      const mid = pic(wx + o.x / 2, wz + o.z / 2, fx, fy, fz);
      if (Math.abs(here.x + out.x - mid.x) > 1e-9 || Math.abs(here.y + out.y - mid.y) > 1e-9) half = false;
    }
  }
  ok(sand, 'at the drift\'s dial one a sand layer (moves one) is sampled exactly where the offset\'s metres name, with the pictures either way round (uGroundFrame.z +1 and -1)');
  ok(rock, 'a rock layer (moves nought) is not moved at all');
  ok(half, 'and a layer that moves a half, half as far');
  groundShift(Number.NaN, Infinity, 1, 1, 1, 1, out);
  ok(out.x === 0 && out.y === 0, 'an offset field that reads NaN or infinite moves nothing');
  const n3 = { x: 0, y: 0, z: 0 };
  dentNormal(0, 1, 0, Number.NaN, -Infinity, 0.0625, 1, n3);
  ok(n3.x === 0 && n3.y === 1 && n3.z === 0, 'a dent field that reads NaN or infinite bends nothing');
  ok(dentDarken(0.5, Number.NaN, 1) === 0.5 && Number.isFinite(dentDarken(0.5, Infinity, 1)) && dustShade(0.5, Number.NaN, 1, 1) === 0.5, 'and darkens or shades nothing it cannot read, and never makes a NaN');
  ok(Math.abs(dentDarken(1, 1, 1) - (1 - 0.18)) < 1e-12 && Math.abs(dentDarken(1, 0.01, 1) - (1 - 0.06)) < 1e-12, 'a deep print is darker by the demo\'s 18% at most, a shallow one by its depth times the scale');
}

// --- the shader's lines are the mirror's ---
{
  const src = readFileSync(new URL('../../../src/world/volumetrics/airGround.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  ok(src.includes('vec2 gAirPic = vec2( -uGroundFrame.z * gAirO.x, gAirO.y ) * ( 0.25 * uAirArt.x );') && src.includes('gAirShiftX = gAirPic * airMoves( vGroundLayers.x );') && src.includes("gAirO = airFinite2( texture( uAirOffsets, gAirUv + uAirShift.xy ).xy ) * gAirIn;"), "the shader's shift is groundShift's: the offset made finite and faded, turned by the frame's sign, a quarter, the dial, the layer's moves");
  const tiles = readFileSync(new URL('../../../src/world/terrainTextures.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  ok(src.includes('vec2 gAirW = vec2( uGroundFrame.x - vGroundUV.x * 4.0 * uGroundFrame.z, vGroundUV.y * 4.0 - uGroundFrame.y );') && tiles.includes('vec2 gTerrain = vec2( uGroundFrame.x - gWorld.x, gWorld.z + uGroundFrame.y );') && tiles.includes('vGroundUV = vec2( uGroundFrame.z * gTerrain.x, gTerrain.y ) * 0.25;'), "and its world point is the tile program's own picture coordinate worked back (the frame's z is one either way, its own inverse)");
  ok(src.includes('if ( gAirDepth > 0.0 ) diffuseColor.rgb *= 1.0 - clamp( gAirDepth * uAirMisc.y, 0.0, uAirMisc.z );'), "the darkening is dentDarken's");
  ok(src.includes('gAirShade = 1.0 - uAirArt.z * uAirMisc.w * ( 1.0 - gAirT ) * gAirIn;') && src.includes('float gAirT = clamp( airFiniteOr( texture( uAirLight, gAirUv + uAirShift.zw ).r, 1.0 ), 0.0, 1.0 );'), "the shade is dustShade's");
  // A transmittance it cannot read: the mirror takes it as one (no shade), and so does the shader, through its own
  // helper (it read nought once, the most shade there is, while this test held the mirror's no shade).
  ok(src.includes('float airFiniteOr( const in float v, const in float d ) { return ( isnan( v ) || isinf( v ) ) ? d : v; }') && dustShade(0.5, Number.NaN, 1, 1) === 0.5 && dustShade(0.5, Infinity, 1, 1) === 0.5 && dustShade(0.5, -Infinity, 1, 1) === 0.5, 'a transmittance that is not a number, or is infinite, shades nothing in the mirror and in the shader alike: both read it as one');
  ok(src.includes('gAirDentSlope = vec2( gAirDx, gAirDz ) * ( uAirArt.y * gAirDIn / ( 2.0 * uAirDentQ.y ) );') && src.includes('gAirN = normalize( gAirN + vec3( gAirDentSlope.x, 0.0, gAirDentSlope.y ) );'), "and the bend is dentNormal's: the depth's difference over two texels, times the dial, added to x and z and made a unit");
}

console.log(`\n${checks} checks passed`);
