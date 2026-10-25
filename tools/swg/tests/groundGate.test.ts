// The ground variant's gates, in the JS mirror (src/world/volumetrics/airMath.ts's `sandOverlay`, `sandStrength`,
// `sandBlend`, `sandAlpha`, `dentNormal`, `dentDarken`, `dustShade`, `shadeTransmittance`; the volumetrics design's §10
// Tests and §4.1 item 5): at each dial nought the output is the input by `Object.is` over random inputs -- negative zero
// among them -- and NaN and infinite fields; the blowing sand of wave 2b answers its colour as it came wherever its
// alpha or its coverage is nought, so nothing is written where nothing blows; a field's NaN or infinity is nought, never
// a NaN pixel. And the shader's lines are held to the mirror's as text, so neither moves alone.
//
// What node cannot do, the browser does: `__debug.air({ groundSelfTest: true })` draws the variant against this mirror.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dentDarken, dentNormal, dustShade, sandAlpha, sandBlend, sandOverlay, sandStrength, shadeTransmittance } from '../../../src/world/volumetrics/airMath.ts';
import { AIR_TUNE } from '../../../src/world/volumetrics/airTune.ts';

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
  const n3 = { x: 0, y: 0, z: 0 };
  let sand = true;
  let normal = true;
  let dark = true;
  let shade = true;
  let negZero = 0;
  for (let i = 0; i < N; i++) {
    const [c, alpha, cov, colour, d, nx, ny, nz, dx, dz, t, T, fade] = Array.from({ length: 13 }, anyNumber);
    if (Object.is(c, -0)) negZero++;
    if (!Object.is(sandOverlay(c, alpha, cov, colour, 0), c)) sand = false;
    dentNormal(nx, ny, nz, dx, dz, t, 0, n3);
    if (!Object.is(n3.x, nx) || !Object.is(n3.y, ny) || !Object.is(n3.z, nz)) normal = false;
    if (!Object.is(dentDarken(c, d, 0), c)) dark = false;
    if (!Object.is(dustShade(c, T, 0, fade), c)) shade = false;
  }
  ok(sand && negZero > 0, `the colour at the sand's dial nought is the one that came, to the bit, over ${N} random colours, alphas, coverages and sand colours (NaN, infinite and ${negZero} negative zeros among them)`);
  ok(normal, 'the normal at the prints\' dial nought is the one that came, to the bit, whatever the slopes and the texel');
  ok(dark, 'the colour at the prints\' dial nought is the one that came, to the bit, whatever the depth (negative zero and NaN colours included)');
  ok(shade, 'the light at the shade\'s dial nought is the one that came, to the bit, whatever the transmittance');
}
// And at a dial above nought where nothing blows: an alpha or a coverage of nought (or one that is not a number), and the
// sand is not laid at all.
{
  let still = true;
  let bare = true;
  let unreadable = true;
  for (let i = 0; i < N; i++) {
    const [c, alpha, cov, colour] = Array.from({ length: 4 }, anyNumber);
    const art = rand() * 1.5 + 0.01;
    if (!Object.is(sandOverlay(c, 0, cov, colour, art), c) || !Object.is(sandOverlay(c, -0, cov, colour, art), c)) still = false;
    if (!Object.is(sandOverlay(c, alpha, 0, colour, art), c)) bare = false;
    if (!Object.is(sandOverlay(c, Number.NaN, cov, colour, art), c) || !Object.is(sandOverlay(c, alpha, Number.NaN, colour, art), c)) unreadable = false;
  }
  ok(still, 'where nothing blows (an alpha of nought) the colour is the one that came, to the bit, at any dial');
  ok(bare, 'over ground that does not blow (a coverage of nought: mud, wet sand, rock, paving) likewise');
  ok(unreadable, 'and an alpha or a coverage that is not a number lays nothing either');
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

// --- the blowing sand laid ---
{
  ok(Math.abs(sandOverlay(0.2, 0.5, 1, 0.8, 1) - 0.5) < 1e-12 && Math.abs(sandOverlay(0.2, 0.5, 0.5, 0.8, 1) - 0.35) < 1e-12, "laid, it is mix(colour, sand, alpha · coverage): a half over a whole sand layer halfway, over a half layer a quarter of the way");
  // The strength read off the phases: NaN or infinite offsets read nought, and a phase at its restart weighs nothing.
  ok(sandStrength(Number.NaN, Infinity, 0, 0, 0.4, 1.2, 1.6) === 0, 'an offsets field that reads NaN or infinite blows nothing');
  ok(Math.abs(sandStrength(4, 0, 12, 0, 0.4, 1.2, 1.6) - (4 * (2 / 1.6) + 12 * ((2 * 0.25) / 1.2))) < 1e-12, "the strength weighs each phase's carry by the cross-fade: 2/T in its first half, 2(1 − f)/t in its second");
  // The blend keeps a single sample's contrast: two samples a contrast c from the mean blend to c whatever the weights.
  let keeps = true;
  for (const fA of [0.05, 0.25, 0.5, 0.75, 0.95]) {
    const p = sandBlend(0.8, 0.8, fA);
    const wA = 1 - Math.abs(2 * fA - 1);
    const want = 0.5 + 0.3 / Math.sqrt(wA * wA + (1 - wA) * (1 - wA));
    if (Math.abs(p - want) > 1e-12) keeps = false;
  }
  ok(keeps && sandBlend(0.8, 0.2, 0.5) === 0.8, 'the two phases blend so their contrast holds (the variance-preserving blend), each weighted by where it is in its cycle');
  const S = AIR_TUNE.sand;
  ok(sandAlpha(0, 0.6, 1, 1, 1, S) === 0 && sandAlpha(1, 0.6, 1, 0, 1, S) === 0 && sandAlpha(1, 0.6, 1, 1, 0, S) === 0 && Math.abs(sandAlpha(1, 0.6, 1, 1, 1, S) - 0.6) < 1e-12, "its alpha is the dial times the opacity times the strength, cut into grains on red and patches on green");
}

// --- nothing it cannot read ---
{
  const n3 = { x: 0, y: 0, z: 0 };
  dentNormal(0, 1, 0, Number.NaN, -Infinity, 0.0625, 1, n3);
  ok(n3.x === 0 && n3.y === 1 && n3.z === 0, 'a dent field that reads NaN or infinite bends nothing');
  ok(dentDarken(0.5, Number.NaN, 1) === 0.5 && Number.isFinite(dentDarken(0.5, Infinity, 1)) && dustShade(0.5, Number.NaN, 1, 1) === 0.5, 'and darkens or shades nothing it cannot read, and never makes a NaN');
  ok(Math.abs(dentDarken(1, 1, 1) - (1 - 0.18)) < 1e-12 && Math.abs(dentDarken(1, 0.01, 1) - (1 - 0.06)) < 1e-12, 'a deep print is darker by the demo\'s 18% at most, a shallow one by its depth times the scale');
  ok(shadeTransmittance(Number.NaN) === 1 && shadeTransmittance(-2) === 1 && shadeTransmittance(Infinity) === 1 && Math.abs(shadeTransmittance(0.7) - Math.exp(-0.7)) < 1e-15, 'the light pass\'s depth at the ground reads as exp(−τ), and one it cannot read (or below nought) as no shade');
}

// --- the shader's lines are the mirror's ---
{
  const src = readFileSync(new URL('../../../src/world/volumetrics/airGround.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const tiles = readFileSync(new URL('../../../src/world/terrainTextures.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  ok(src.includes('vec2 gAirW = vec2( uGroundFrame.x - vGroundUV.x * 4.0 * uGroundFrame.z, vGroundUV.y * 4.0 - uGroundFrame.y );') && tiles.includes('vec2 gTerrain = vec2( uGroundFrame.x - gWorld.x, gWorld.z + uGroundFrame.y );') && tiles.includes('vGroundUV = vec2( uGroundFrame.z * gTerrain.x, gTerrain.y ) * 0.25;'), "the world point is the tile program's own picture coordinate worked back (the frame's z is one either way, its own inverse)");
  ok(!src.includes('gAirShiftX') && !src.includes('gAirPic') && !src.includes('vGroundUV + gAirShift'), "the ground's own picture is never moved: no layer's shift is left in the variant");
  ok(src.includes('float gAirFA = uAirPhase.x * uAirPhase.w;') && src.includes('float gAirFB = uAirPhase.y * uAirPhase.w;'), "each phase's share of its cycle is its own seconds over the cycle (phase A's from uAirPhase.x, phase B's from .y), as sandStrength's fA and fB");
  ok(src.includes("float gAirKA = gAirFA < 0.5 ? 2.0 * uAirPhase.w : 2.0 * ( 1.0 - gAirFA ) / max( uAirPhase.x, 1e-6 );") && src.includes("float gAirKB = gAirFB < 0.5 ? 2.0 * uAirPhase.w : 2.0 * ( 1.0 - gAirFB ) / max( uAirPhase.y, 1e-6 );") && src.includes('float gAirSpeed = length( gAirO.xy ) * gAirKA + length( gAirO.zw ) * gAirKB;'), "the shader's strength is sandStrength's: each phase's carry over its own time, weighted by its own cross-fade (kA and kB alike)");
  ok(src.includes('vec2 gAirP = 0.5 + ( gAirWA * ( gAirPa - 0.5 ) + gAirWB * ( gAirPb - 0.5 ) ) / sqrt( gAirWA * gAirWA + gAirWB * gAirWB );'), "its blend is sandBlend's");
  ok(src.includes('if ( uAirArt.x != 0.0 && gAirSandStr > 0.0 ) {') && src.includes('} else if ( gAirA > 0.0 ) {') && src.includes('diffuseColor.rgb = mix( diffuseColor.rgb, gAirSandColour, gAirA );'), "its colour is sandOverlay's: behind the dial, written only where it lays anything, mix(colour, sand, alpha · coverage)");
  ok(src.includes('float gAirCov = airBlows( vGroundLayers.x );') && src.includes('gAirCov = mix( gAirCov, airBlows( vGroundLayers.y ), gGroundW.x );') && src.includes('return min( r.r, r.a );'), "its coverage is each layer's min(moves, dust) through the tile's own mask weights");
  ok(src.includes('vec2 gAirD = gAirW;'), 'a dent is read where it was pressed, never dragged with the sand');
  ok(src.includes('if ( gAirDepth > 0.0 ) diffuseColor.rgb *= 1.0 - clamp( gAirDepth * uAirMisc.y, 0.0, uAirMisc.z );'), "the darkening is dentDarken's");
  ok(src.includes('gAirShade = 1.0 - uAirArt.z * uAirMisc.w * ( 1.0 - gAirT ) * gAirIn;') && src.includes('float gAirT = exp( -max( airFiniteOr( texture( uAirLight, gAirUv + uAirShift.zw ).r, 0.0 ), 0.0 ) );'), "the shade is dustShade's at shadeTransmittance's exp(−τ(0))");
  ok(src.includes('float airFiniteOr( const in float v, const in float d ) { return ( isnan( v ) || isinf( v ) ) ? d : v; }'), 'a depth that is not a number, or is infinite, shades nothing in the shader as in the mirror');
  ok(src.includes('gAirDentSlope = vec2( gAirDx, gAirDz ) * ( uAirArt.y * gAirDIn / ( 2.0 * uAirDentQ.y ) );') && src.includes('gAirN = normalize( gAirN + vec3( gAirDentSlope.x, 0.0, gAirDentSlope.y ) );'), "and the bend is dentNormal's: the depth's difference over two texels, times the dial, added to x and z and made a unit");
}

console.log(`\n${checks} checks passed`);
