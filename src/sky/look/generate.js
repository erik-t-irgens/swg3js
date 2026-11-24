// Generated planets: a body's surface (and its relief for the lighting, its water shine, its glowing
// parts and its clouds) made by our own code from a recipe, a seed and the recipe's dials, instead of
// a picture. Everything is worked out on the graphics card in three's TSL, by sampling 3D noise on the
// unit sphere (never 2D noise on the lat-long rectangle, so there is no seam at the date line and no
// pinching at the poles), and written once into lat-long textures; a look drawn with them then costs
// no more at play time than a pictured one.
//
// Deterministic: the noise is hashed with integer arithmetic (no sine hash), the seed's numbers are
// worked out in JS with an integer generator, so the same recipe, seed and dials make the same picture.
//
// This module imports only three and three/tsl and takes no state from the page: the renderer is handed
// in, and what it keeps (the bake materials of each recipe, the sets of baked textures) is its own.

import * as THREE from 'three/webgpu';
import { cleanParts, newPart } from './partdials.js';
// (the atmosphere brief's wave A) the air a generated twin starts with (pure: numbers only)
import { airStartFor } from './airProfile.js';
import { TWIN_AIR } from './airTuned.js';
// (the atmosphere brief's wave B) a twin's colour grade and its surface layer's brightness re-tuned under its Scattered air
import { TWIN_GRADE, TWIN_SURFACE } from './airTuned.js';
import {
  Fn, Loop, uniform, float, int, uint, vec2, vec3, vec4, mat3, uv, floor, fract, mix, clamp, abs, min, max,
  dot, cross, normalize, length, sqrt, pow, exp, sin, cos, atan, select, texture, fwidth, dFdx, dFdy, step,
} from 'three/tsl';
// (wave B: the planet features) the great cyclone's spiral
import { log } from 'three/tsl';
// (wave 6, maker C) the ring cities' arrays of numbers and the hexagonal lattice's wrap
import { uniformArray, mod } from 'three/tsl';

const TAU = Math.PI * 2;

// The Hermite step written out, so edges given high-to-low (a falling step) mean the same on every
// back end (GLSL leaves smoothstep with edge0 >= edge1 undefined).
const sstep = (a, b, x) => {
  const t = clamp(float(x).sub(a).div(float(b).sub(a)), 0.0, 1.0);
  return t.mul(t).mul(float(3).sub(t.mul(2)));
};

// ---------------------------------------------------------------------------------------------
// The seed's own numbers: an integer generator, the same on every machine.

function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// a direction on the sphere from two numbers in [0, 1); `latMax` keeps it within that latitude (radians)
function onSphere(u, v, latMin = -Math.PI / 2, latMax = Math.PI / 2) {
  const lon = u * TAU;
  const lat = Math.asin(Math.sin(latMin) + v * (Math.sin(latMax) - Math.sin(latMin)));
  return new THREE.Vector3(Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon));
}

// ---------------------------------------------------------------------------------------------
// Noise. A cell's hash is integer arithmetic (lowbias32 over the three cell numbers), its gradient one
// of Perlin's twelve, the blend quintic. Octaves are turned and shifted against each other so the
// lattice never lines up.

const hashCell = /*@__PURE__*/ Fn(([ix, iy, iz]) => {
  const h = uint(ix).mul(uint(0x8da6b343)).bitXor(uint(iy).mul(uint(0xd8163841))).bitXor(uint(iz).mul(uint(0xcb1ab31f))).toVar();
  h.assign(h.bitXor(h.shiftRight(uint(16))));
  h.assign(h.mul(uint(0x7feb352d)));
  h.assign(h.bitXor(h.shiftRight(uint(15))));
  h.assign(h.mul(uint(0x846ca68b)));
  h.assign(h.bitXor(h.shiftRight(uint(16))));
  return h;
}).setLayout({ name: 'genHashCell', type: 'uint', inputs: [{ name: 'ix', type: 'int' }, { name: 'iy', type: 'int' }, { name: 'iz', type: 'int' }] });

// three numbers in [0, 1) from one hash (its 10-bit thirds)
const hashFloats = (h) => vec3(
  float(h.bitAnd(uint(1023))),
  float(h.shiftRight(uint(10)).bitAnd(uint(1023))),
  float(h.shiftRight(uint(20)).bitAnd(uint(1023))),
).mul(1 / 1024);

function gradDot(h, x, y, z) {
  const hh = h.bitAnd(uint(15));
  const u = select(hh.lessThan(uint(8)), x, y);
  const v = select(hh.lessThan(uint(4)), y, select(hh.equal(uint(12)).or(hh.equal(uint(14))), x, z));
  const su = select(hh.bitAnd(uint(1)).equal(uint(0)), u, u.negate());
  const sv = select(hh.bitAnd(uint(2)).equal(uint(0)), v, v.negate());
  return su.add(sv);
}

export const noise3 = /*@__PURE__*/ Fn(([p]) => {
  const pi = floor(p).toVar();
  const f = p.sub(pi).toVar();
  const w = f.mul(f).mul(f).mul(f.mul(f.mul(6.0).sub(15.0)).add(10.0)).toVar();
  const ix = int(pi.x).toVar(), iy = int(pi.y).toVar(), iz = int(pi.z).toVar();
  const c = (a, b, d) => gradDot(hashCell(ix.add(int(a)), iy.add(int(b)), iz.add(int(d))), f.x.sub(float(a)), f.y.sub(float(b)), f.z.sub(float(d)));
  const x00 = mix(c(0, 0, 0), c(1, 0, 0), w.x);
  const x10 = mix(c(0, 1, 0), c(1, 1, 0), w.x);
  const x01 = mix(c(0, 0, 1), c(1, 0, 1), w.x);
  const x11 = mix(c(0, 1, 1), c(1, 1, 1), w.x);
  return mix(mix(x00, x10, w.y), mix(x01, x11, w.y), w.z);
}).setLayout({ name: 'genNoise3', type: 'float', inputs: [{ name: 'p', type: 'vec3' }] });

// Cellular noise: the distances to the nearest and second nearest of one jittered point a cell
// (F1, F2). F2 - F1 is small along the cells' borders: cracks, plates, lineae.
// (Loops here are the shader's own loops, not unrolled: the shader stays small and compiles quickly.)
export const worley = /*@__PURE__*/ Fn(([p]) => {
  const pi = floor(p).toVar();
  const f = p.sub(pi).toVar();
  const ix = int(pi.x).toVar(), iy = int(pi.y).toVar(), iz = int(pi.z).toVar();
  const F1 = float(9).toVar(), F2 = float(9).toVar();
  Loop(27, ({ i }) => {
    const a = int(i).div(9).sub(1), b = int(i).div(3).mod(3).sub(1), d = int(i).mod(3).sub(1);
    const j = hashFloats(hashCell(ix.add(a), iy.add(b), iz.add(d))).mul(0.85).add(0.075);
    const dd = length(vec3(float(a), float(b), float(d)).add(j).sub(f));
    F2.assign(select(dd.lessThan(F1), F1, min(F2, dd)));
    F1.assign(min(F1, dd));
  });
  return vec2(F1, F2);
}).setLayout({ name: 'genWorley', type: 'vec2', inputs: [{ name: 'p', type: 'vec3' }] });

// Each octave is the last one turned by a fixed rotation, scaled by the lacunarity and shifted, so the
// lattice never lines up (fixed numbers: part of the recipe, not the seed).
const LAC = 2.03;
const ROT = (() => {
  const m = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0.43, 0.81, -0.39).normalize(), 0.93);
  return mat3(new THREE.Matrix3().setFromMatrix4(m).multiplyScalar(LAC));
})();
const OCT_OFF = vec3(17.31, -9.77, 5.13);

// fbm, ridged and turbulent sums of octaves. `f0` the first octave's frequency on the unit sphere,
// `off` a shift (the seed's and the call's own), `maxF` the frequency above which octaves fade out
// (the texture's own limit, so nothing finer than a texel is written and nothing aliases), `gain`
// each octave's share of the one before.
function makeOctaves(name, octaves, kind) {
  return Fn(([p, f0, off, maxF, gain]) => {
    const sum = float(0).toVar();
    const norm = float(0).toVar();
    const amp = float(1).toVar();
    const wgt = float(1).toVar();
    const f = float(f0).toVar();
    const q = p.mul(f0).add(off).toVar();
    Loop(octaves, () => {
      const fade = clamp(maxF.sub(f).div(maxF.mul(0.4)), 0.0, 1.0);
      const n = noise3(q);
      if (kind === 'fbm') sum.addAssign(n.mul(amp).mul(fade));
      else if (kind === 'turb') sum.addAssign(abs(n).mul(amp).mul(fade));
      else {
        const s = float(1).sub(abs(n)).toVar();
        s.assign(s.mul(s).mul(wgt));
        wgt.assign(clamp(s.mul(1.8), 0.0, 1.0));
        sum.addAssign(s.mul(amp).mul(fade));
      }
      norm.addAssign(amp);
      amp.mulAssign(gain);
      f.mulAssign(LAC);
      q.assign(ROT.mul(q).add(OCT_OFF));
    });
    return sum.div(norm);
  }).setLayout({
    name, type: 'float',
    inputs: [{ name: 'p', type: 'vec3' }, { name: 'f0', type: 'float' }, { name: 'off', type: 'vec3' }, { name: 'maxF', type: 'float' }, { name: 'gain', type: 'float' }],
  });
}
export const fbm4 = makeOctaves('genFbm4', 4, 'fbm');
export const fbm6 = makeOctaves('genFbm6', 6, 'fbm');
const fbm9 = makeOctaves('genFbm9', 9, 'fbm');
const ridged9 = makeOctaves('genRidged9', 9, 'ridged');
const turb6 = makeOctaves('genTurb6', 6, 'turb');

// Domain warp: the point moved by three smooth fields, so shapes swirl and flow instead of showing
// the blobs of plain noise.
function warp(p, f, amt, off, maxF) {
  return p.add(vec3(
    fbm4(p, float(f), off.add(vec3(13.1, 7.3, 2.9)), maxF, float(0.5)),
    fbm4(p, float(f), off.add(vec3(-5.2, 17.7, 9.4)), maxF, float(0.5)),
    fbm4(p, float(f), off.add(vec3(3.3, -11.9, 21.5)), maxF, float(0.5)),
  ).mul(amt));
}

// A thin line where a field crosses zero, drawn `w` wide plus one texel (fwidth), so it never aliases.
const line = (n, w) => float(1).sub(sstep(0.0, float(w).add(fwidth(n)).add(0.000001), abs(n)));

// Rodrigues: p turned by angle a round the unit axis k.
const turnAbout = (p, k, a) => p.mul(cos(a)).add(cross(k, p).mul(sin(a))).add(k.mul(dot(k, p).mul(float(1).sub(cos(a)))));

const mix3 = (a, b, c, t) => mix(mix(a, b, sstep(0.0, 0.5, t)), c, sstep(0.5, 1.0, t));

// ---------------------------------------------------------------------------------------------
// The dials. Each recipe's own, the clouds' (any recipe), and the shading's (live: no bake needed).
// type 'range' or 'color'; `def` the start that already looks its best.

const R = (k, label, min, max, step, def, title) => ({ k, label, type: 'range', min, max, step, def, title });
const C = (k, label, def, title) => ({ k, label, type: 'color', def, title });

export const SHADING_DIALS = [
  R('haze', 'Haze toward the limb', 0, 1, 0.01, 0.35, 'Air seen edge on: the surface fades into the atmosphere\'s colour (the Atmosphere layer\'s colour) toward the rim, on the lit side'),
  R('limbDark', 'Limb darkening', 0, 1, 0.01, 0, 'A thick gas body grows darker toward its rim'),
  R('dusty', 'Dusty light (moon-like)', 0, 1, 0.01, 0, 'Bare dust and rock reflect light back the way it came: a full disc stays bright to its edge'),
  R('veil', 'Thick haze over the surface', 0, 1, 0.01, 0, 'A haze world (Titan, Nal Hutta): a tinted haze over the whole disc, lit by the sun and thickest toward the rim'),
  C('veilColour', 'Thick haze colour', '#b8a66a'),
].map((d) => ({ ...d, live: true }));

// City lights' colours and brightness: live (no bake), for the recipes that grow cities.
export const LIGHT_DIALS = [
  C('lightColour', 'City light colour', '#ffc47a', 'The lights themselves, at the hearts of the cities and along the roads'),
  C('glowColour', 'City glow colour', '#ff8a30', 'The fainter glow round them, where the lights thin out'),
  R('lightBright', 'City brightness', 0, 3, 0.01, 1),
].map((d) => ({ ...d, live: true, group: 'Cities' }));

// Features any recipe with relief can use (none when their count is 0, and then the recipe's bake is
// exactly what it was without them).
export const FEATURE_DIALS = [
  R('sinkholes', 'Sinkholes', 0, 1, 0.01, 0, 'Round shafts with shadowed walls and green floors (Utapau)'),
  R('sinkSize', 'Sinkhole size', 0.3, 3, 0.01, 1),
  C('sinkFloor', 'Sinkhole floor', '#5a7a3a'), C('sinkWall', 'Sinkhole walls', '#3c3a2c'),
  R('canyons', 'Canyons', 0, 1, 0.01, 0, 'Branching canyon systems cut into the ground'),
  R('canyonSize', 'Canyon size', 0.3, 3, 0.01, 1), C('canyonColour', 'Canyon floors and walls', '#6a3e2a'),
  R('craterField', 'Crater fields', 0, 1, 0.01, 0, 'Fields of craters in regions of the surface'),
  R('craterFieldSize', 'Crater size', 0.3, 3, 0.01, 1),
];

// Blending a second recipe in by region: its preset's dials, and where and how it shows.
export const MIX_DIALS = [
  { k: 'mode', label: 'Where it shows', type: 'select', def: 0, options: [['0', 'In patches'], ['1', 'On high ground'], ['2', 'Toward the poles'], ['3', 'On one hemisphere']] },
  R('amount', 'How much', 0, 1, 0.01, 0.35),
  R('edge', 'Edge sharpness', 0, 1, 0.01, 0.5, 'Soft blends to crisp borders'),
  R('scale', 'Patch size', 0.3, 3, 0.01, 1, 'Larger makes bigger patches (in patches only)'),
];

export const CLOUD_DIALS = [
  R('cloudCover', 'Cloud cover', 0, 1, 0.01, 0.45),
  R('cloudScale', 'Cloud size', 0.4, 2.5, 0.01, 1, 'Larger makes bigger cloud masses'),
  R('cloudSwirl', 'Swirl', 0, 1.5, 0.01, 0.6, 'How much the cloud masses curl and stream'),
  R('cloudStorms', 'Storm cells', 0, 8, 1, 3, 'Spiral storms in the middle latitudes'),
  R('cloudBands', 'Banding by latitude', 0, 1, 0.01, 0.6, 'Clear belts and cloudy belts, as winds sort them'),
];

// Recipe version 2 (21 November), for every recipe: its dials carry `since: 2`, so a look of version 1
// neither has them nor reads them (dialsOf below), and stays exactly as it was.
// Spotted cloud: many small flecks of cloud over the masses (none at 0).
export const CLOUD_SPOT_DIALS = [
  R('cloudSpots', 'Cloud flecks', 0, 1, 0.01, 0, 'Many small flecks and wisps of cloud scattered between the masses: none at 0'),
  R('cloudSpotScale', 'Fleck size', 0.3, 3, 0.01, 1, 'Larger makes bigger flecks'),
].map((d) => ({ ...d, since: 2 }));
// Recipe version 3 (looks run 2, living worlds only): long thin streaks of high cloud combed along the
// winds and curled with the masses (his Naboo's cirrus), none at 0.
export const CLOUD_STREAK_DIALS = [
  R('cloudStreaks', 'Cirrus streaks', 0, 1, 0.01, 0, 'Long thin streaks of high cloud combed along the winds, curling with the masses: none at 0'),
  R('cloudStreakScale', 'Streak length', 0.3, 3, 0.01, 1, 'Larger makes longer, broader streaks'),
].map((d) => ({ ...d, since: 3 }));
// The colour grade, on the baked colour (the ground's, not the clouds'), worked in the OKLab space so
// a hue can turn and colours can calm without their lightness moving. The owner, 21 November: things
// were a bit too saturated, so the new version starts calmer (colour strength under 1; a feel number,
// his to move). The colour matcher (colourmatch.js) sets all of these from a reference's measurement.
// (their keys all begin "grade", so none meets a recipe's own: the gas giant has its own "contrast")
export const GRADE_DIALS = [
  R('gradeStrength', 'Colour strength', 0, 2, 0.01, 0.8, 'How strong the colours are: grey at 0, as the recipe makes them at 1. Starts calmer than the first version, at 0.8'),
  R('gradeLightness', 'Lightness', 0.5, 2, 0.01, 1, 'The whole ground lighter or darker'),
  R('gradeContrast', 'Contrast', 0.5, 1.5, 0.01, 1, 'Light and dark further apart, or closer'),
  R('gradeHue', 'Hue turn', -60, 60, 1, 0, 'Every colour turned round the colour wheel, in degrees'),
  R('gradeWash', 'Wash', 0, 1, 0.01, 0, 'Every colour pulled toward the wash colour (as air seen from space unifies a world\'s tone): none at 0'),
  C('gradeWashColour', 'Wash colour', '#8a9cb0'),
].map((d) => ({ ...d, since: 2, group: 'Colour' }));

// (the atmosphere brief's wave B: the planet editor's missing features) What his imported pictures show that no
// recipe could make: atolls, long thin lines (dark or glowing), a radial fracture star, a great trench round the
// globe, glow specks and one great region, lacy branching growth, a smoky mottle, fine detail at the texture's own
// fineness, and one great cyclone in the clouds. Each its own group of dials, nothing at all while its first dial is
// at 0, built into a bake only when on (featureFlags), so a look leaving them at 0 bakes exactly what the version
// before made. They come in at a new version of every recipe: 3 (the living world's 4, as its 3 is the fine fray and
// the lakes), `sinceFor` naming a recipe's own version where it differs from `since`; a look saved at an older
// version never has them and never changes.
const PART = (group, note) => (d) => ({ ...d, since: 3, sinceFor: { living: 4 }, group, groupNote: note });
// (wave 6, maker C) a dial of recipe version 4 (the living world's 5): see RING_CITY_DIALS below
const V4 = (group, note) => (d) => ({ ...d, since: 4, sinceFor: { living: 5 }, group, groupNote: note });
export const PART_DIALS = [
  ...[
    R('atolls', 'Atolls', 0, 1, 0.01, 0, 'Many tiny islands in the open sea, each ringed by bright shallow water: none at 0'),
    R('atollSize', 'Atoll size', 0.3, 3, 0.01, 1, 'Larger makes bigger, fewer atolls'),
    R('atollIsle', 'Island in each', 0, 1, 0.01, 0.4, 'How much of each atoll is dry land: open rings of shallows at 0, a solid island ringed by them toward 1'),
    R('atollSpread', 'Gathered into archipelagos', 0, 1, 0.01, 0.6, 'Even over the sea at 0; gathered into chains and groups toward 1'),
    R('atollCoast', 'Shallows along every coast', 0, 1, 0.01, 0, 'Bright shallow water hugging every coast of the land, not only the atolls: none at 0'),
    C('atollColour', 'Shallows', '#36d6cc', 'The bright turquoise of the shallow water'), C('atollIsleColour', 'Islands', '#7a8a58'),
  ].map(PART('Atolls', 'Bright turquoise shallows ringing many tiny islands, over the sea only (his Scarif, Rori\'s water moon, Paintball). None at 0.')),
  ...[
    R('lines', 'Long lines', 0, 1, 0.01, 0, 'Long thin lines across the ground: none at 0'),
    R('lineScale', 'Line length', 0.3, 3, 0.01, 1, 'Larger makes longer, broader sweeping lines'),
    R('lineWidth', 'Line width', 0, 1, 0.01, 0.3),
    R('lineStraight', 'Straight lines', 0, 1, 0.01, 0, 'Some lines run straight, as great circles crossing the globe: none at 0, eight at 1'),
    R('lineBranch', 'Branching', 0, 1, 0.01, 0.4, 'Single sweeping lines at 0; lines that fork and join toward 1'),
    R('lineGlow', 'Glow', 0, 1, 0.01, 0, 'Dark lines at 0; glowing fissures toward 1 (they shine on the night side where the night layer is on)'),
    C('lineColour', 'Line colour', '#4a1c1a'),
  ].map(PART('Long lines', 'Long thin lines: dark branching lines (Ryloth\'s moon) or, with glow, glowing fissures (Fondor\'s red). None at 0.')),
  ...[
    R('star', 'Fracture star', 0, 1, 0.01, 0, 'One radial star of cracks round a central pit: none at 0'),
    R('starRays', 'Rays', 4, 24, 1, 12),
    R('starReach', 'Reach', 4, 90, 1, 24, 'How far the longest cracks run from the centre, in degrees'),
    R('starWidth', 'Crack width', 0, 1, 0.01, 0.35),
    R('starLat', 'Latitude', -90, 90, 1, 45), R('starLon', 'Longitude', -180, 180, 1, 0),
    C('starColour', 'Crack colour', '#5a3c2a'),
  ].map(PART('Fracture star', 'A radial fracture star of cracks (Jakku\'s). None at 0.')),
  // (wave 6, maker C) the cracks laid after the colour grade, in their own colour, with no mottle drifting it (his Jakku's star
  // drifted from the colour picked): none at 0
  ...[
    R('starKeep', 'Cracks keep their colour', 0, 1, 0.01, 0, 'The cracks drawn in their own colour after the colour grade, with no drift of tone (version 4): graded with the ground at 0'),
  ].map(V4('Fracture star', 'A radial fracture star of cracks (Jakku\'s). None at 0.')),
  ...[
    R('trench', 'Great trench', 0, 1, 0.01, 0, 'One great trench cut round the globe: none at 0'),
    R('trenchWidth', 'Width', 0.2, 3, 0.01, 1),
    R('trenchTilt', 'Tilt', -90, 90, 1, 25, 'How far its circle is tilted from the equator, in degrees'),
    R('trenchTurn', 'Turn', -180, 180, 1, 0, 'Which way its circle is tilted, in degrees of longitude'),
    R('trenchArc', 'How far round', 30, 360, 1, 360, 'Right round the globe at 360; a long gash of that many degrees below'),
    R('trenchWobble', 'Meander', 0, 1, 0.01, 0.3),
    C('trenchColour', 'Trench floor', '#1c2430'),
  ].map(PART('Great trench', 'A great trench round the globe, its walls shadowed by the relief (Starkiller Base). None at 0.')),
  ...[
    R('specks', 'Glow specks', 0, 1, 0.01, 0, 'Small bright specks scattered over the ground, glowing at night where the night layer is on: none at 0'),
    R('speckSize', 'Speck size', 0.3, 3, 0.01, 1),
    R('speckGlow', 'Glow at night', 0, 1, 0.01, 0.7),
    R('speckRegion', 'Only in the great region', 0, 1, 0.01, 0, 'Everywhere at 0; only inside the great region (below) at 1'),
    C('speckColour', 'Speck colour', '#46e2ff'),
    R('regionTint', 'Great region', 0, 1, 0.01, 0, 'One great region of the globe tinted its own colour: none at 0'),
    R('regionSize', 'Region size', 0, 1, 0.01, 0.35),
    C('regionColour', 'Region colour', '#1f4a1c'),
  ].map(PART('Glow specks and a great region', 'Local glow specks on dark land (Sullust\'s cyan, Pillio dead\'s green) and one great region of its own colour. None at 0.')),
  // (wave 6, maker C) a soft glow round each speck, so a scatter of specks reads at sky size (his Sullust's cyan): none at 0
  ...[
    R('speckHalo', 'Halo round each', 0, 1, 0.01, 0, 'A soft halo of the speck\'s colour round each one, so they read from far off (version 4): none at 0'),
  ].map(V4('Glow specks and a great region', 'Local glow specks on dark land (Sullust\'s cyan, Pillio dead\'s green) and one great region of its own colour. None at 0.')),
  ...[
    R('lace', 'Lacy growth', 0, 1, 0.01, 0, 'Lacy, branching growth over the ground: none at 0'),
    R('laceScale', 'Lace size', 0.3, 3, 0.01, 1),
    R('laceDetail', 'Threads', 0, 1, 0.01, 0.6, 'Soft blotches at 0; fine branching threads toward 1'),
    R('laceSea', 'Over the sea too', 0, 1, 0.01, 0, 'On the land only at 0; over the sea as well toward 1'),
    C('laceColour', 'Lace colour', '#2e5a24'),
  ].map(PART('Lacy growth', 'Lacy, branching vegetation (Athulla, Fondor\'s mottling). None at 0.')),
  // (wave 6, maker C) a two-tone lace: the ground between taken to the lace's own colour, and a second, bright tone where the lace
  // is thickest (his Fondor: dark maroon under a bright white mottle). Both none at 0; the start's second tone a warm white.
  ...[
    R('laceGround', 'Ground in the lace colour', 0, 1, 0.01, 0, 'The ground between the lace taken toward the lace\'s own colour, so the lace lies on a ground of its colour (version 4): none at 0'),
    R('laceTwoTone', 'Second tone', 0, 1, 0.01, 0, 'The thickest of the lace in a second colour, a mottle over the first (version 4): one tone at 0'),
    R('laceTwoShare', 'Second tone\'s share', 0, 1, 0.01, 0.4, 'How much of the lace takes the second tone'),
    C('laceColour2', 'Second tone colour', '#f2ece6'),
  ].map(V4('Lacy growth', 'Lacy, branching vegetation (Athulla, Fondor\'s mottling). None at 0.')),
  ...[
    R('mottle', 'Smoky mottle', 0, 1, 0.01, 0, 'Dark billows of smoke over the ground with pale wisps at their edges: none at 0'),
    R('mottleScale', 'Billow size', 0.3, 3, 0.01, 1),
    R('mottleSoft', 'Softness', 0, 1, 0.01, 0.5),
    C('mottleColour', 'Smoke', '#2a1e14'), C('mottleLight', 'Pale wisps', '#d8b060'),
  ].map(PART('Smoky mottle', 'A smoky mottle (Kessel). None at 0.')),
  // (wave 6, maker C) a rim of its own colour round each billow (his Resurgent's red-rimmed dark blotches): none at 0
  ...[
    R('mottleRim', 'Rim round each billow', 0, 1, 0.01, 0, 'A rim of its own colour round the edge of each dark billow (version 4): none at 0'),
    R('mottleRimWidth', 'Rim width', 0, 1, 0.01, 0.4),
    C('mottleRimColour', 'Rim colour', '#a8301c'),
  ].map(V4('Smoky mottle', 'A smoky mottle (Kessel). None at 0.')),
  ...[
    R('fineSpecks', 'Fine specks', 0, 1, 0.01, 0, 'Bright and dark specks at the texture\'s own fineness (best at the largest texture size): none at 0'),
    R('fineDark', 'Dark among them', 0, 1, 0.01, 0.5, 'All bright at 0, all dark at 1'),
    R('fineSize', 'Speck size', 0.5, 4, 0.01, 1, 'A few texels across at 1; larger makes coarser specks that still read at sky size'),
    R('fineGrain', 'Fine grain', 0, 1, 0.01, 0, 'A crisp grain over the whole ground at the finest scale: none at 0'),
  ].map(PART('Fine detail', 'Detail at the texture\'s own fineness, so a body carries the fine specks a picture has. None at 0.')),
  ...[
    R('greatStorm', 'Great cyclone', 0, 1, 0.01, 0, 'One great cyclone, larger and stronger than the storm cells, the clouds wound into it: none at 0'),
    R('greatStormSize', 'Cyclone size', 0.3, 3, 0.01, 1),
    R('greatStormLat', 'Latitude', -75, 75, 1, 30), R('greatStormLon', 'Longitude', -180, 180, 1, -30),
    R('greatStormArms', 'Arms wound', 0, 1, 0.01, 0.5, 'Loose arms at 0; tightly wound bands toward 1'),
  ].map(PART('Great cyclone', 'One great cyclone in the clouds (Ryloth, Paintball). Drawn by the Clouds layer. None at 0.')),
];
/** The version of a recipe that has the planet features (PART_DIALS). */
export const partsVersion = (recipe) => (recipe === 'living' ? 4 : 3);

// (the GPU port's pass 2, wave 6, maker C: city worlds and the planet maker's gaps) Recipe version 4 of every recipe (the living
// world's 5): ring cities and the cities' own glint (on the recipes that grow cities), soft hazy cloud, soft edges over the
// ground's colours, colour picked by its hue and kept in its hue when strong, and the smaller parts the critic's "cannot" list
// asked for (a two-tone lace, red-rimmed smoke, cracks that keep their colour, a halo round glow specks, a gas giant's softer and
// more varied bands). As at version 3, each is nothing at its start and built into a bake only when on, and a look saved at an
// older version never has them and never changes. Every start below is a feel number: the owner's to move.
/** The version of a recipe that has wave 6's parts (ring cities, soft cloud and edges, the colour pick): 4, the living world's 5. */
export const ringsVersion = (recipe) => (recipe === 'living' ? 5 : 4);
/** The ring cities' layouts, as the Layout dial offers them. */
export const RING_LAYOUTS = [['0', 'Concentric rings with spokes'], ['1', 'Broken gear arcs'], ['2', 'Hexagonal plates']];
// Ring cities (the recipes that grow cities: the whole-planet city and the living world): great hubs of rings inside rings with
// spokes from the centre, smaller satellite rings round them, long straight trunk lines between them along great circles; pale
// metal plates by day, a glow along the rings, spokes and trunks at night, a dim fill between (his Coruscant pictures).
// The starts (wave 6's critic J, against his three Coruscant pictures of 23 November; maker C's first starts in brackets): sixteen
// hubs of 10 degrees with four satellites each (12, 11 and 3: his night picture crowds some 25 to 30 ring towns of every size over
// the face we see, where 12 hubs with 3 satellites stood five or six; sixteen hubs, four satellites a hub and 10 degrees fill the
// 80 sites a look can hold, about a sixth of the globe in cities), six rings and eight spokes each (4: his hubs are rings inside
// rings, five to eight), the trunk lines at 1 (0.8: his night picture links every hub and most satellites), the lines 0.18 wide
// (0.35: his lines are hair-thin against a hub, where 0.35 read as bands from orbit), plates at 0.9 in a pale cream (0.6 and a
// lilac grey: his day picture's plates are the palest thing on the globe, cream over a blue-grey city), the rings' glow at 0.9
// and the fill at 0.1 (0.8 and 0.3: his night ground is near black between bright lines, and the fill's speckle read coarse),
// drawn sharp (he wants them sharp from orbit).
export const RING_CITY_DIALS = [
  R('ringCity', 'Ring cities', 0, 1, 0.01, 0, 'Great round cities of rings inside rings, plated in metal, alight along their rings at night: none at 0'),
  { k: 'ringLayout', label: 'Layout', type: 'select', def: 0, options: RING_LAYOUTS, title: 'Concentric rings crossed by spokes; rings broken into arcs like gears; or rings of hexagonal plates' },
  R('ringHubs', 'Great hubs', 1, 16, 1, 16, 'How many great ring cities stand on the globe'),
  R('ringHubSize', 'Hub size', 2, 30, 0.5, 10, 'The great hubs\' radius, in degrees of the globe (each one larger or smaller by its own number)'),
  R('ringRings', 'Rings in each', 2, 8, 1, 6, 'How many rings each great hub has inside its rim'),
  R('ringSpokes', 'Spokes', 0, 16, 1, 8, 'Spokes from each centre out to its rim: none at 0'),
  R('ringSatellites', 'Satellite rings', 0, 4, 1, 4, 'Smaller ring towns round each great hub: none at 0'),
  R('ringTrunks', 'Trunk lines', 0, 1, 0.01, 1, 'Long straight lines linking the hubs across the globe, and each satellite to its hub: none at 0, every hub linked toward 1'),
  R('ringWidth', 'Ring width', 0, 1, 0.01, 0.18, 'How wide the rings, spokes and trunk lines are'),
  R('ringPlates', 'Plate brightness', 0, 1, 0.01, 0.9, 'How bright the metal plates are by day against the city round them'),
  C('ringPlateColour', 'Plate colour', '#e8dccc', 'The metal plates\' colour by day (his pictures: a pale cream over a blue-grey city)'),
  R('ringGlow', 'Glow along the rings', 0, 1, 0.01, 0.9, 'The rings, spokes and trunk lines alight at night, in the city light colours'),
  R('ringFill', 'Glow between', 0, 1, 0.01, 0.1, 'The dim lights between the rings and over the rest of the city at night: dark at 0'),
  { k: 'ringSharp', label: 'Drawn', type: 'select', def: 1, options: [['0', 'Baked into the picture only'], ['1', 'Sharp at every size (drawn as the body is drawn)']], title: 'Sharp: the rings are drawn by the look\'s own material, so they stay sharp with the planet filling the screen; baked: they are as fine as the texture size' },
].map(V4('Ring cities', 'Great round cities of rings inside rings, with spokes, satellite rings and trunk lines between them; pale metal plates by day, alight along the rings at night. None while "Ring cities" is at 0. The night layer shows the glow; the city light colours are the Cities group\'s.'));
// The cities' own glint: the sun caught on their metal and glass alone (the ring cities' plates; on a whole-planet city every
// built-up place), with a colour, a sharpness and a strength of its own, land, sea and the water's shine left as they are. Live.
// The starts: none (his saved looks and every preset draw as before until he turns it up), sharpness 0.3 (wave 6's critic J; maker
// C's 0.45: his day picture's glint is a broad soft bright patch over the plates round the sun's point, nearer satin metal than
// glass), plates tilted 0.35 (so the glint breaks into a scatter of bright plates rather than one spot), a warm white (the critic;
// C's pale lilac white: his day picture's glint over the plates is warm, the plates cream).
export const CITY_GLINT_DIALS = [
  R('glintCity', 'City glint', 0, 1, 0.01, 0, 'The sun caught on the cities\' metal and glass alone: none at 0'),
  R('glintSharp', 'Sharpness', 0, 1, 0.01, 0.3, 'Satin metal at 0 (a broad soft sheen), polished glass toward 1 (a small bright glint)'),
  R('glintScatter', 'Plates tilted', 0, 1, 0.01, 0.35, 'Every plate tilted its own way, so the glint breaks into a scatter of bright plates: one smooth sheen at 0'),
  C('glintColour', 'Glint colour', '#fff4ea'),
].map((d) => ({ ...V4('City glint', 'The sun caught on the cities\' metal and glass alone, with a colour, sharpness and strength of its own; land, sea and the water\'s shine stay as they are. Live (no bake).')(d), live: true }));
// Soft hazy cloud (any recipe with clouds): the cloud's edges softened and its crisp erosion eased, and a thin even haze of cloud
// over everything (his Kamino and Rori: a deep sea seen through soft, hazy cloud). Both none at 0.
export const CLOUD_SOFT_DIALS = [
  R('cloudSoft', 'Soft edges', 0, 1, 0.01, 0, 'The cloud masses\' edges soft and hazy, their crisp ragged margins eased: crisp at 0'),
  R('cloudHaze', 'Thin haze', 0, 1, 0.01, 0, 'A thin, even haze of cloud over the whole globe, thicker where the masses gather: none at 0'),
].map(V4('Clouds: softness', 'Soft, hazy cloud (version 4): softened edges and a thin haze over everything. None at 0.'));
// Soft edges over the ground's colours (any recipe): the baked colour blended softly across its borders, so regions meet in soft
// gradients (his Tatooine, Geonosis and Kashyyyk), at a reach in degrees. None at 0.
export const SOFT_DIALS = [
  R('softEdges', 'Soft edges', 0, 1, 0.01, 0, 'The ground\'s colours blended softly across their borders, so regions meet in soft gradients: crisp at 0'),
  R('softWidth', 'How far', 0.2, 3, 0.01, 1, 'How far the blend reaches: about a degree of the globe at 1'),
].map(V4('Soft edges', 'The ground\'s colours blended softly across their borders (version 4), at the end of the bake: none at 0.'));
// The colour picked by its hue (any recipe): one hue range turned or made stronger alone (his Yavin 4's blue without turning its
// jungle, Athulla's green without its yellow), and strong colours kept in their hue when pushed past what a screen shows (Endor's
// strength raised without its hue turning). Each nothing at its start.
export const GRADE4_DIALS = [
  R('gradeHold', 'Keep hue when strong', 0, 1, 0.01, 0, 'A colour pushed past what the screen can show is clipped (and turns) at 0; toward 1 it is eased in, keeping its hue'),
  R('gradePickHue', 'Picked hue', 0, 360, 1, 220, 'The middle of the hue range the two dials below change, in degrees round the colour wheel (OKLab: about 30 red, 90 yellow, 140 green, 200 teal, 260 blue)'),
  R('gradePickWidth', 'Picked range', 5, 120, 1, 40, 'How wide the picked range is, in degrees'),
  R('gradePickTurn', 'Turn the picked hue', -60, 60, 1, 0, 'The picked range\'s colours turned round the wheel alone, in degrees: none at 0'),
  R('gradePickStrength', 'Picked strength', 0, 3, 0.01, 1, 'The picked range\'s colour strength alone: as the rest at 1'),
].map(V4('Colour', 'Colour picked by its hue, and kept in its hue when strong (version 4).'));

export const RECIPES = {
  gasgiant: {
    name: 'Banded gas giant', clouds: false, glow: false, relief: 0,
    dials: [
      C('c1', 'Zone colour (light)', '#ecdcc0'), C('c2', 'Middle colour', '#d2aa7c'), C('c3', 'Belt colour (dark)', '#9a6440'), C('c4', 'Accent colour', '#c27c50'),
      C('polar', 'Polar colour', '#8e8476'),
      R('bands', 'Band count', 4, 36, 1, 15), R('contrast', 'Band contrast', 0, 1.5, 0.01, 0.75),
      R('turbulence', 'Turbulence', 0, 1.5, 0.01, 0.7, 'How much the bands wave, curl and tear at their edges'),
      R('streaks', 'Fine streaks', 0, 1, 0.01, 0.5),
      R('storms', 'Storm count', 0, 8, 1, 4), R('stormSize', 'Storm size', 0.3, 2.5, 0.01, 1), C('stormColour', 'Storm colour', '#f0e4cf'),
      // Depth (wave 2): the bands as cloud decks at different heights. Off at 0 layers, and then the bake
      // is exactly the flat one it always was (the depth is a kit of its own, featureFlags below).
      ...[
        R('depthLayers', 'Cloud decks', 0, 8, 1, 0, 'The bands become stacked cloud decks at different heights, the upper shading the lower: none (flat, as before) at 0'),
        { ...R('depthSpread', 'Height spread', 0, 1, 0.01, 0.5, 'How far apart the decks stand: longer shadows toward the terminator, more parallax toward the limb'), live: true },
        { ...R('depthShade', 'Shading strength', 0, 1, 0.01, 0.6, 'How darkly the upper decks shade and shadow the lower'), live: true },
      ].map((d) => ({ ...d, group: 'Cloud depth' })),
      // (wave 6, maker C: version 4) softer bands and two more band colours (his Bespin: soft bands, not candy stripes). The
      // softness none at 0 (the bands as sharp as before); the two colours mixed in by a band field of their own, none at 0.
      ...[
        R('bandSoft', 'Soft bands', 0, 1, 0.01, 0, 'The steps between the bands softened into blends: as sharp as before at 0'),
        R('moreColours', 'More band colours', 0, 1, 0.01, 0, 'Two more colours mixed into the bands, band by band: the four above alone at 0'),
        C('c5', 'Fifth colour', '#d9b48c'), C('c6', 'Sixth colour', '#b68c6e'),
      ].map((d) => ({ ...d, group: 'Softer bands', since: 4 })),
    ],
  },
  desert: {
    name: 'Desert world', clouds: false, glow: false, relief: 0.012,
    dials: [
      C('sandLight', 'Sand, light', '#d5b78b'), C('sandDark', 'Sand, dark', '#b98a58'), C('rock', 'Rock colour', '#6b5442'), C('salt', 'Salt flats', '#ebe4d6'),
      R('duneScale', 'Dune size', 0.4, 2.5, 0.01, 1), R('duneDir', 'Dune direction', 0, 180, 1, 35, 'The second family of dunes\' crest direction, in degrees'),
      R('duneStrength', 'Dune strength', 0, 1, 0.01, 0.75), R('badlands', 'Badlands and ridges', 0, 1, 0.01, 0.4),
      R('saltFlats', 'Salt flats', 0, 1, 0.01, 0.35), R('variety', 'Colour variety', 0, 1.5, 0.01, 0.7),
    ],
  },
  ice: {
    name: 'Ice world', clouds: true, glow: false, relief: 0.03,
    dials: [
      C('snow', 'Snow', '#eef2f6'), C('ice', 'Blue ice', '#a9bdd0'), C('rock', 'Exposed rock', '#56524f'), C('crevasse', 'Crevasses', '#6d88a2'),
      R('ridges', 'Mountain ridges', 0, 1, 0.01, 0.5), R('rockShare', 'Exposed rock', 0, 1, 0.01, 0.45),
      R('crevasses', 'Crevasse lines', 0, 1, 0.01, 0.6), R('plains', 'Blue ice plains', 0, 1, 0.01, 0.45),
    ],
  },
  volcanic: {
    name: 'Volcanic world', clouds: true, glow: true, relief: 0.022,
    dials: [
      C('crust', 'Crust', '#2b2623'), C('ash', 'Ash plains', '#5a524b'), C('lava', 'Lava (by day)', '#ff6a1c'),
      R('lavaAmount', 'Lava lakes', 0, 1, 0.01, 0.45), R('rivers', 'Lava rivers', 0, 1, 0.01, 0.65), R('cracks', 'Glowing cracks', 0, 1, 0.01, 0.5),
    ],
  },
  terran: {
    name: 'Ocean, island or forest world', clouds: true, glow: false, relief: 0.016,
    dials: [
      R('land', 'Land (all ocean to continents)', 0, 1, 0.01, 0.25), R('islandScale', 'Island size', 0.4, 3, 0.01, 1, 'Smaller makes many small islands, larger few big landmasses'),
      C('deep', 'Deep water', '#0c2b4b'), C('shallow', 'Shallow water', '#1c6b8c'), C('shelf', 'Reef and shelf', '#3d9ea6'), C('beach', 'Beaches', '#d9cca2'),
      C('lowland', 'Lowland green', '#55783a'), C('forest', 'Forest', '#26472a'), C('dry', 'Dry land', '#a58f64', 'Steppe and desert, where the climate is dry'), C('highland', 'Highland and tundra', '#7d7259'),
      R('moisture', 'Forest cover', 0, 1, 0.01, 0.5), R('rivers', 'Rivers', 0, 1, 0.01, 0), R('snowline', 'Snow on high ground', 0, 1, 0.01, 0.35),
      R('iceCaps', 'Polar ice', 0, 1, 0.01, 0.2),
    ],
  },
  moon: {
    name: 'Cratered moon', clouds: false, glow: false, relief: 0.03,
    dials: [
      C('highland', 'Highlands', '#a3a09a'), C('mare', 'Maria (dark plains)', '#5e5b57'), C('rayColour', 'Fresh crater rays', '#d9d6d0'),
      R('maria', 'Maria', 0, 1, 0.01, 0.3), R('craters', 'Craters', 0, 1, 0.01, 0.65), R('craterSize', 'Crater size', 0.5, 2, 0.01, 1),
      R('rays', 'Rays', 0, 1, 0.01, 0.55),
    ],
  },
  // Wave 1 of the generated bodies: living worlds. One recipe for every living world, its biomes
  // falling out of a climate (temperature from latitude, height and the sun; wetness from the seas
  // and the winds), with cities grown where people would live.
  living: {
    name: 'Living world', clouds: true, glow: true, lights: true, relief: 0.018,
    dials: [
      ...[
        R('land', 'Land (all ocean to all land)', 0, 1, 0.01, 0.38), R('continentSize', 'Continent size', 0.4, 3, 0.01, 1, 'Smaller makes many small islands, larger few big landmasses'),
        R('mountains', 'Mountain ranges', 0, 1, 0.01, 0.5), R('rivers', 'Rivers', 0, 1, 0.01, 0.35),
      ].map((d) => ({ ...d, group: 'Land and sea' })),
      // version 2: land and sea in many small irregular patches (Naboo's picture), over the continents
      ...[
        R('spots', 'Spotted land and sea', 0, 1, 0.01, 0, 'Land and sea broken into many small irregular patches instead of continents: continents at 0, all patches at 1'),
        R('spotScale', 'Patch size', 0.3, 3, 0.01, 1, 'Larger makes bigger patches'),
        R('spotSpread', 'Patch spread', 0, 1, 0.01, 0.35, 'Even all over at 0; gathered into regions of mostly land and regions of mostly sea toward 1'),
        R('spotEdge', 'Patch edges', 0, 1, 0.01, 0.6, 'Soft, blotted edges at 0, crisp ones at 1'),
        R('spotVariety', 'Patch variety', 0, 1, 0.01, 0.5, 'How much each patch\'s own tone differs from its neighbours\''),
      ].map((d) => ({ ...d, group: 'Spots', since: 2 })),
      // version 3 (looks run 2): what his imported pictures show that version 2 could not make. The
      // patches' and coasts' edges broken at finer scales, and lakes: many small waters over the land,
      // finer than the patches (his Naboo's dark speckle). None of either at 0.
      ...[
        R('spotFray', 'Fine fray', 0, 1, 0.01, 0, 'The edges of the patches and coasts broken again at finer scales, ragged down to the smallest detail: smooth at 0'),
      ].map((d) => ({ ...d, group: 'Spots', since: 3 })),
      ...[
        R('lakes', 'Lakes', 0, 1, 0.01, 0, 'Many small lakes and pools scattered over the land, finer than the patches: none at 0'),
        R('lakeScale', 'Lake size', 0.2, 3, 0.01, 1, 'Larger makes bigger lakes (the smallest want the largest texture size to show)'),
        R('lakeSpread', 'Lake spread', 0, 1, 0.01, 0.4, 'Even all over at 0; gathered into lake districts toward 1'),
      ].map((d) => ({ ...d, group: 'Lakes', since: 3 })),
      ...[
        R('warmth', 'Warmth', 0, 1, 0.01, 0.6, 'The whole world\'s temperature: an ice world at 0, no ice anywhere toward 1'),
        R('tilt', 'Axial tilt', 0, 60, 1, 23, 'Degrees. More tilt spreads the sun\'s warmth toward the poles: smaller ice caps, milder high latitudes', ),
        R('wetness', 'Wetness', 0, 1, 0.01, 0.55, 'How much rain the winds carry inland: deserts at 0, jungle and swamp toward 1'),
        R('locked', 'Tidally locked', 0, 1, 0.01, 0, 'One side always faces its sun (longitude 0): a scorched day side, a frozen night side and a living twilight band between'),
      ].map((d) => ({ ...d, group: 'Climate' })),
      ...[
        C('deep', 'Deep water', '#0b2a48'), C('shallow', 'Shallow water', '#1b6488'), C('shelf', 'Reef and shelf', '#3a98a0'), C('beach', 'Beaches', '#d6c79c'),
        C('desert', 'Desert', '#cdb07c'), C('steppe', 'Steppe and savanna', '#a49a62'), C('grass', 'Grassland', '#6a8a3e'), C('forest', 'Forest', '#2c4f2a'),
        C('jungle', 'Jungle', '#1f4a1e'), C('swamp', 'Swamp', '#3c4a2a'), C('tundra', 'Tundra', '#7a7560'), C('scorched', 'Scorched ground', '#8c5634', 'Too hot for anything to grow'),
        C('rock', 'Bare rock', '#6a6258'), C('snow', 'Snow', '#eef2f6'), C('ice', 'Glacier ice', '#a9c0d6'), C('seaIce', 'Sea ice', '#d2dee8'),
      ].map((d) => ({ ...d, group: 'Colours' })),
      ...[
        R('cityDensity', 'Cities', 0, 1, 0.01, 0, 'How many cities: none at 0'),
        R('citySprawl', 'Sprawl', 0, 1, 0.01, 0.5, 'How far each city spreads, and how many roads link them'),
        { k: 'cityPattern', label: 'Pattern', type: 'select', def: 0, options: [['0', 'Sprawl'], ['1', 'Grid'], ['2', 'Hexagonal web']] },
      ].map((d) => ({ ...d, group: 'Cities' })),
    ],
  },
  molten: {
    name: 'Molten world', clouds: true, glow: true, relief: 0.022,
    dials: [
      C('rock', 'Rock', '#4c0f09'), C('flow', 'Young flows', '#8e1d0f'), C('ash', 'Ash', '#dac6c0'), C('smokeColour', 'Smoke', '#1e0605'), C('lava', 'Lava (by day)', '#ffa03a'),
      R('heat', 'Hot ground', 0, 1, 0.01, 0.6, 'How much of the ground glows dimly through its crust'),
      R('lavaAmount', 'Lava pools', 0, 1, 0.01, 0.35), R('rivers', 'Lava rivers', 0, 1, 0.01, 0.4),
      R('ashCover', 'Ash cover', 0, 1, 0.01, 0.3), R('smoke', 'Smoke', 0, 1, 0.01, 0.55, 'Great dark billows rolling off the hot ground'), R('fibres', 'Streaks', 0, 1, 0.01, 0.45, 'The ground scratched and torn along the winds and its own flows'),
    ],
  },
  flats: {
    name: 'Salt or crystal flats', clouds: true, glow: false, relief: 0.02,
    dials: [
      C('crust', 'Crust', '#eeeae6'), C('under', 'Ground beneath', '#a8341f'), C('rock', 'Rock', '#5a534d'), C('crystal', 'Fresh crystal', '#dce6ee'),
      R('crustCover', 'Crust cover', 0, 1, 0.01, 0.8), R('cracks', 'Cracks', 0, 1, 0.01, 0.5, 'The crust\'s polygons, the ground beneath showing in their seams'),
      R('streaks', 'Scrapes and streaks', 0, 1, 0.01, 0.4), R('ranges', 'Mountain ranges', 0, 1, 0.01, 0.4), R('crystalShine', 'Crystal shine', 0, 1, 0.01, 0.4),
    ],
  },
  cityworld: {
    name: 'Whole-planet city', clouds: true, glow: true, lights: true, relief: 0.004,
    dials: [
      C('base', 'Built-up colour', '#8c97a6'), C('lightTone', 'Light districts', '#b6bec8'), C('darkTone', 'Dark districts', '#4c5664'),
      R('density', 'Density', 0, 1, 0.01, 0.75), R('gridScale', 'District size', 0.4, 2.5, 0.01, 1),
      R('lanes', 'Traffic lanes', 0, 1, 0.01, 0.4, 'Long streaks of light round the world'), R('hubs', 'Hubs', 0, 1, 0.01, 0.5),
      R('dark', 'Dark zones', 0, 1, 0.01, 0.25), R('iceCaps', 'Polar ice', 0, 1, 0.01, 0),
    ],
  },
};
export const RECIPE_ORDER = ['gasgiant', 'desert', 'ice', 'volcanic', 'terran', 'moon', 'living', 'molten', 'flats', 'cityworld'];

// A recipe's version: saved with each generated look, so a look keeps the version it was made with
// when a recipe improves (the older versions' code stays, in SURFACES below). Looks saved before
// versions existed are version 1.
export const recipeVersion = (recipe) => Math.max(...Object.keys(SURFACES[recipe] || { 1: 0 }).map(Number));

export const SIZES = [[1024, 512], [2048, 1024], [4096, 2048]];

// ---------------------------------------------------------------------------------------------
// Presets, named for the worlds they suggest. Each is a whole starting look: the recipe and its dials,
// and the look's own layers (atmosphere, clouds, water shine, glow) set to suit it. `compare` is the
// closest imported picture, offered beside it.

export const PRESETS = {
  'yavin-prime': {
    name: 'Yavin Prime-like gas giant', recipe: 'gasgiant', seed: 4471, compare: 'yavin-prime',
    dials: { c1: '#efd2a8', c2: '#d79a62', c3: '#9a5232', c4: '#c4683c', polar: '#8a6a58', stormColour: '#f3dcc0', bands: 14, storms: 3, haze: 0.12, limbDark: 0.55 },
    layers: { atmosphere: { on: true, form: 'rim', tint: '#ffb07a', opacity: 0.45, power: 3.2, height: 1.03 } },
    adjust: { glow: '#ff2a10', glowStrength: 0.04, ambient: 0.01, spin: 1 },
  },
  'bespin': {
    name: 'Bespin-like gas giant', recipe: 'gasgiant', seed: 2210, compare: 'set:bespin',
    dials: { c1: '#f4e6d2', c2: '#e6c3a2', c3: '#c58f6c', c4: '#dcaa86', polar: '#a99a8c', stormColour: '#fbf2e6', bands: 18, contrast: 0.55, turbulence: 0.6, storms: 5, haze: 0.15, limbDark: 0.5 },
    layers: { atmosphere: { on: true, form: 'rim', tint: '#ffd8b8', opacity: 0.45, power: 3.2, height: 1.03 } },
    adjust: { ambient: 0.01, spin: 1 },
  },
  'tatooine': {
    name: 'Tatooine-like desert', recipe: 'desert', seed: 1977, compare: 'set:jakku',
    dials: { haze: 0.18, dusty: 0.2 },
    layers: { atmosphere: { on: true, form: 'rim', tint: '#ffdcb0', opacity: 0.4, power: 3.5, height: 1.025 } },
  },
  'hoth': {
    name: 'Hoth-like ice', recipe: 'ice', seed: 1980, compare: 'menu:hoth',
    dials: { cloudCover: 0.35, cloudStorms: 2, haze: 0.4 },
    layers: { atmosphere: { on: true, form: 'rim', tint: '#bfdcff', opacity: 0.7, power: 3, height: 1.035 }, clouds: { on: true, opacity: 0.9 }, specular: { on: true, opacity: 0.25, shine: 30, tint: '#eef4ff' } },
  },
  'mustafar': {
    name: 'Mustafar-like volcanic', recipe: 'volcanic', seed: 2005, compare: 'mustafar',
    dials: { lavaAmount: 0.3, cloudCover: 0.22, cloudScale: 1.4, cloudSwirl: 0.9, cloudStorms: 0, cloudBands: 0.2, haze: 0.05 },
    layers: {
      atmosphere: { on: true, form: 'rim', tint: '#b8562e', opacity: 0.25, power: 5, height: 1.025 },
      clouds: { on: true, opacity: 0.6, tint: '#7a706a', bright: 0.75 },
      night: { on: true, where: 'always', tint: '#ff4a0c', opacity: 1.8 },
      specular: { on: true, opacity: 0.25, shine: 60, tint: '#ffd0a0' },
    },
    adjust: { ambient: 0.01 },
  },
  'kamino': {
    name: 'Kamino-like ocean', recipe: 'terran', seed: 3322, compare: 'set:kamino',
    dials: { land: 0, deep: '#13314e', shallow: '#1f5a78', cloudCover: 0.62, cloudStorms: 5, cloudSwirl: 0.9, cloudScale: 1.15, haze: 0.45, iceCaps: 0.12 },
    layers: {
      atmosphere: { on: true, form: 'rim', tint: '#9cc6ff', opacity: 0.8, power: 3, height: 1.035 },
      clouds: { on: true, opacity: 0.95, tint: '#e8eef4' },
      specular: { on: true, opacity: 0.6, shine: 150, tint: '#fff4e0' },
    },
  },
  'naboo': {
    name: 'Naboo-like islands', recipe: 'terran', seed: 3132, compare: 'menu:naboo',
    dials: { land: 0.4, islandScale: 0.9, moisture: 0.75, highland: '#6e7748', shelf: '#3f9ea2', iceCaps: 0.15, cloudCover: 0.4, haze: 0.4 },
    layers: {
      atmosphere: { on: true, form: 'rim', tint: '#8fc0ff', opacity: 0.8, power: 3, height: 1.035 },
      clouds: { on: true, opacity: 0.95 },
      specular: { on: true, opacity: 0.6, shine: 150, tint: '#fff4e0' },
    },
  },
  'endor': {
    name: 'Endor-like forest moon', recipe: 'terran', seed: 1983, compare: 'menu:endor',
    dials: { land: 0.72, islandScale: 0.8, moisture: 0.85, rivers: 0.6, lowland: '#466f30', forest: '#1f4424', highland: '#5f6a44', snowline: 0.15, iceCaps: 0.1, cloudCover: 0.45, haze: 0.4 },
    layers: {
      atmosphere: { on: true, form: 'rim', tint: '#9ccaff', opacity: 0.75, power: 3, height: 1.035 },
      clouds: { on: true, opacity: 0.9 },
      specular: { on: true, opacity: 0.5, shine: 150, tint: '#fff4e0' },
    },
  },
  'moon': {
    name: 'Grey cratered moon', recipe: 'moon', seed: 1969, compare: 'ord-mantell-moon-03',
    dials: { haze: 0, dusty: 0.85 },
    layers: { atmosphere: { on: false } },
    adjust: { ambient: 0.008 },
  },
};
export const PRESET_ORDER = ['yavin-prime', 'bespin', 'tatooine', 'hoth', 'mustafar', 'kamino', 'naboo', 'endor', 'moon'];

// The worlds of wave 1, beside the nine above (which stay exactly as they were).
const WORLD = 'Generated worlds';
const cloudy = (opacity = 0.95, more = {}) => ({ on: true, opacity, ...more });
const air = (tint, opacity = 0.8, more = {}) => ({ on: true, form: 'rim', tint, opacity, power: 3, height: 1.035, ...more });
const sea = (opacity = 0.6) => ({ on: true, opacity, shine: 150, tint: '#fff4e0' });
const cityNight = { on: true, where: 'night', opacity: 1 };
Object.assign(PRESETS, {
  'w-naboo': {
    name: 'Naboo', recipe: 'living', seed: 3141, compare: 'set:naboo', group: WORLD,
    dials: { land: 0.5, continentSize: 1.1, mountains: 0.45, rivers: 0.55, warmth: 0.63, wetness: 0.78, grass: '#5f8a3c', forest: '#2e5a2a', swamp: '#40583a', cityDensity: 0.12, citySprawl: 0.3, cloudCover: 0.42, haze: 0.4 },
    layers: { atmosphere: air('#8fc0ff'), clouds: cloudy(), specular: sea(), night: cityNight },
  },
  'w-endor': {
    name: 'Endor', recipe: 'living', seed: 1983, compare: 'set:endor', group: WORLD,
    dials: { land: 0.82, continentSize: 0.85, mountains: 0.35, rivers: 0.55, warmth: 0.6, wetness: 0.85, grass: '#4e7434', forest: '#22462a', jungle: '#244a26', cloudCover: 0.45, haze: 0.4 },
    layers: { atmosphere: air('#9ccaff', 0.75), clouds: cloudy(0.9), specular: sea(0.5) },
  },
  'w-kashyyyk': {
    name: 'Kashyyyk', recipe: 'living', seed: 7731, compare: 'menu:kashyyyk', group: WORLD,
    dials: { land: 0.6, continentSize: 1.2, mountains: 0.4, rivers: 0.45, warmth: 0.74, wetness: 0.88, grass: '#5a7a32', forest: '#284a22', jungle: '#22502a', swamp: '#36502c', cityDensity: 0.05, citySprawl: 0.2, cloudCover: 0.5, haze: 0.4 },
    layers: { atmosphere: air('#94c4ff'), clouds: cloudy(), specular: sea(), night: { ...cityNight, opacity: 0.6 } },
  },
  'w-dantooine': {
    name: 'Dantooine', recipe: 'living', seed: 2550, group: WORLD,
    dials: { land: 0.72, continentSize: 1.3, mountains: 0.25, rivers: 0.35, warmth: 0.6, wetness: 0.62, grass: '#76687e', steppe: '#8e8478', forest: '#3e4640', desert: '#ab9c80', tundra: '#7e766e', deep: '#122c48', shallow: '#20587a', cloudCover: 0.35, haze: 0.3 },
    layers: { atmosphere: air('#a4c0ff', 0.65), clouds: cloudy(0.9), specular: sea(0.5) },
  },
  'w-felucia': {
    name: 'Felucia', recipe: 'living', seed: 6061, compare: 'menu:felucia', group: WORLD,
    dials: { land: 0.62, continentSize: 0.9, mountains: 0.3, rivers: 0.5, warmth: 0.8, wetness: 0.88, grass: '#8aa636', steppe: '#ad8236', forest: '#2a6c48', jungle: '#1e6040', swamp: '#6a5a3a', shallow: '#246e6a', shelf: '#3c9c8a', cloudCover: 0.5, haze: 0.35 },
    layers: { atmosphere: air('#b0e0c0', 0.55), clouds: cloudy(0.9), specular: sea() },
  },
  'w-dagobah': {
    name: 'Dagobah', recipe: 'living', seed: 1980, group: WORLD,
    dials: { land: 0.62, continentSize: 0.55, mountains: 0.12, rivers: 0.3, warmth: 0.76, wetness: 0.97, swamp: '#3a4a2c', jungle: '#2c3e22', forest: '#304428', grass: '#4e5a30', deep: '#1c2c2a', shallow: '#2c4238', shelf: '#3c5040', beach: '#5a5a40', cloudCover: 0.62, cloudSwirl: 0.4, cloudStorms: 0, haze: 0.35, veil: 0.3, veilColour: '#56664c' },
    layers: { atmosphere: air('#98b29a', 0.6), clouds: cloudy(0.85, { tint: '#b4bcaa' }), specular: sea(0.3) },
  },
  'w-utapau': {
    name: 'Utapau', recipe: 'living', seed: 4242, group: WORLD,
    dials: { land: 0.97, continentSize: 1.2, mountains: 0.25, rivers: 0, warmth: 0.56, wetness: 0.55, grass: '#94a464', steppe: '#b2b486', desert: '#c8bf98', forest: '#6f8048', tundra: '#a49c84', sinkholes: 0.6, sinkSize: 0.4, cloudCover: 0.4, cloudStorms: 2, haze: 0.45 },
    layers: { atmosphere: air('#86aaff', 0.8), clouds: cloudy(0.9), specular: sea(0.4) },
  },
  'w-ryloth': {
    name: 'Ryloth', recipe: 'living', seed: 7007, compare: 'set:ryloth', group: WORLD,
    dials: { land: 0.75, continentSize: 1.3, mountains: 0.55, rivers: 0.25, warmth: 0.55, wetness: 0.45, locked: 1, desert: '#a88e6a', scorched: '#86604a', steppe: '#8e8060', grass: '#6c6c44', rock: '#5e5850', cloudCover: 0.3, haze: 0.35 },
    layers: { atmosphere: air('#e8d8c0', 0.5), clouds: cloudy(0.85), specular: sea(0.4) },
    adjust: { spin: 0 },
  },
  'w-monca': {
    name: 'Mon Cala', recipe: 'living', seed: 5151, compare: 'set:kamino', group: WORLD,
    dials: { land: 0.12, continentSize: 0.45, mountains: 0.3, warmth: 0.64, wetness: 0.7, deep: '#0a2d52', shallow: '#16608a', shelf: '#2fa0b0', cityDensity: 0.4, citySprawl: 0.15, lightColour: '#d8ecff', glowColour: '#5aa8ff', cloudCover: 0.5, cloudStorms: 4, haze: 0.45 },
    layers: { atmosphere: air('#90c0ff'), clouds: cloudy(), specular: sea(0.7), night: cityNight },
  },
  'w-nalhutta': {
    name: 'Nal Hutta', recipe: 'living', seed: 8128, group: WORLD,
    dials: { land: 0.62, continentSize: 0.8, mountains: 0.2, rivers: 0.3, warmth: 0.78, wetness: 0.92, swamp: '#4a5030', jungle: '#3c4428', grass: '#6a6a3a', forest: '#3e4a2c', deep: '#2a3428', shallow: '#3e4a32', shelf: '#55603e', cityDensity: 0.3, citySprawl: 0.6, cloudCover: 0.5, haze: 0.35, veil: 0.24, veilColour: '#6e7448' },
    layers: { atmosphere: air('#bcbc84', 0.7), clouds: cloudy(0.85, { tint: '#e0dcc0' }), specular: sea(0.3), night: cityNight },
  },
  'w-vardos': {
    name: 'Vardos', recipe: 'living', seed: 9090, compare: 'set:vardos-alive', group: WORLD,
    dials: { land: 0.86, continentSize: 1.1, mountains: 0.4, rivers: 0.5, warmth: 0.6, wetness: 0.5, desert: '#663428', steppe: '#56241c', grass: '#4a1a18', forest: '#341210', jungle: '#3c1210', swamp: '#341814', tundra: '#6a4c40', rock: '#30201c', beach: '#80604a', deep: '#14223a', shallow: '#1c3a5a', shelf: '#2c4c6a', cityDensity: 0.3, citySprawl: 0.75, cityPattern: 2, lightColour: '#e8f0ff', glowColour: '#8ab0ff', lightBright: 1.2, cloudCover: 0.3, haze: 0.2 },
    layers: { atmosphere: air('#88a8ff', 0.6), clouds: cloudy(0.85), specular: sea(0.4), night: cityNight },
  },
  'w-hoth': {
    name: 'Hoth', recipe: 'living', seed: 1980, compare: 'menu:hoth', group: WORLD,
    dials: { land: 0.7, continentSize: 1.1, mountains: 0.6, rivers: 0, warmth: 0, wetness: 0.4, snow: '#eef2f7', ice: '#b2c6da', seaIce: '#d0dce8', rock: '#55524f', cloudCover: 0.35, cloudStorms: 2, haze: 0.4 },
    layers: { atmosphere: air('#bfdcff', 0.7), clouds: cloudy(0.9), specular: { on: true, opacity: 0.25, shine: 30, tint: '#eef4ff' } },
  },
  'w-mustafar': {
    name: 'Mustafar', recipe: 'molten', seed: 2005, compare: 'mustafar', group: WORLD,
    dials: { rivers: 0.35, smoke: 0.7, fibres: 0.3, lavaAmount: 0.42, cloudCover: 0.3, cloudScale: 1.3, cloudSwirl: 0.9, cloudStorms: 0, cloudBands: 0.2, haze: 0.1 },
    layers: {
      atmosphere: air('#c8502a', 0.35, { power: 4, height: 1.03 }),
      clouds: cloudy(0.6, { tint: '#d0b4aa', bright: 0.75 }),
      night: { on: true, where: 'always', tint: '#ff5a16', opacity: 1.0 },
      specular: { on: true, opacity: 0.2, shine: 60, tint: '#ffd0a0' },
    },
    adjust: { ambient: 0.012 },
  },
  'w-lok': {
    name: 'Lok', recipe: 'desert', seed: 3838, group: WORLD,
    dials: { sandLight: '#d9ac70', sandDark: '#b47a46', rock: '#5c4636', saltFlats: 0.15, haze: 0.18, dusty: 0.2 },
    mix: { preset: 'mustafar', mode: 0, amount: 0.3, edge: 0.45, scale: 1.1, dials: { lavaAmount: 0.3, rivers: 0.5 } },
    layers: { atmosphere: air('#ffd0a0', 0.4, { power: 3.5, height: 1.025 }), night: { on: true, where: 'always', tint: '#ff4a0c', opacity: 1.2 } },
  },
  'w-crait': {
    name: 'Crait', recipe: 'flats', seed: 2017, compare: 'menu:crait', group: WORLD,
    dials: { cracks: 0.25, streaks: 0.3, ranges: 0.3, cloudCover: 0.18, cloudStorms: 0, haze: 0.3 },
    layers: { atmosphere: air('#e4ecff', 0.5), clouds: cloudy(0.6), specular: { on: true, opacity: 0.3, shine: 40, tint: '#ffffff' } },
  },
  'w-ilum': {
    name: 'Ilum', recipe: 'flats', seed: 1138, group: WORLD,
    dials: { crust: '#e4edf6', under: '#7a8ca8', rock: '#68727e', crystal: '#bfe4ff', crustCover: 0.86, cracks: 0.35, streaks: 0.2, ranges: 0.35, crystalShine: 0.8, cloudCover: 0.3, haze: 0.35 },
    layers: { atmosphere: air('#b8d8ff', 0.7), clouds: cloudy(0.85), specular: { on: true, opacity: 0.45, shine: 60, tint: '#e8f6ff' } },
  },
  'w-coruscant': {
    name: 'Coruscant', recipe: 'cityworld', seed: 1001, group: WORLD,
    dials: { lightColour: '#ffa850', glowColour: '#ff6418', lightBright: 1.1, cloudCover: 0.32, cloudScale: 0.9, cloudStorms: 1, haze: 0.45 },
    layers: { atmosphere: air('#9cb8ff', 0.8), clouds: cloudy(0.55), specular: { on: true, opacity: 0.2, shine: 60, tint: '#e8f0ff' }, night: cityNight },
  },
});
PRESET_ORDER.push('w-naboo', 'w-endor', 'w-kashyyyk', 'w-dantooine', 'w-felucia', 'w-dagobah', 'w-utapau', 'w-ryloth', 'w-monca',
  'w-nalhutta', 'w-vardos', 'w-hoth', 'w-mustafar', 'w-lok', 'w-crait', 'w-ilum', 'w-coruscant');
// (wave 6, maker C) Coruscant of ring cities (recipe version 4), after his three pictures of 23 November: lilac-grey plates in great
// round hubs with satellite rings and trunk lines, a glint on the metal by day, orange-gold along the rings at night, soft cloud
// over all, in its own Scattered air. The Layout dial chooses concentric, gear or hexagonal cities. Its numbers are starts for
// the critic who follows and for the owner (his pictures: the built-up city a grey toward lilac and brown, the rings a little
// lighter, the night's lines gold over a dark ground, the clouds soft and patchy).
// (wave 6, its critic J, against his three pictures: the lit disc of his day picture at noon on the close-up stage, lightness
// 74.4, colour strength 5.7, hue 58 degrees; the maker's start read 48.7 / 12.4 / 288, a darker violet-blue ball, 30.6 apart. Now
// a blue-grey city (his day picture's ground between the plates) under cream plates (his palest thing on the globe), its grade
// lifted toward his day's lightness but kept well short of it so the plates read cream over a lilac-grey city (gradeLightness 1.4,
// plates at 1: 62.2 / 6.0 / 327, 14.8 apart; at 1.84 the mean came within 6.7 but the plates vanished into a near-white ground, and his
// day picture's mean is lifted by glare and cloud), more and softer cloud (his day picture is much cloud), a thinner sky (0.4 of
// Earth's: his ground reads grey, not blue, with a blue limb) and a warm city haze over 30 km; the ring cities as the recipe's
// starts now stand but the plates at their brightest, the glint stronger and broader (0.8 and 0.3: his day picture's bright patch
// over the plates).)
Object.assign(PRESETS, {
  'w-coruscant-rings': {
    name: 'Coruscant (ring cities)', recipe: 'cityworld', version: 4, seed: 1138, group: WORLD,
    dials: {
      base: '#7a7480', lightTone: '#9a94a0', darkTone: '#4a4652', density: 0.75, gridScale: 1, lanes: 0.2, hubs: 0, dark: 0.2,
      lightColour: '#ffb35c', glowColour: '#ff6a1e', lightBright: 1.2,
      ringCity: 1, ringLayout: 0, ringHubs: 16, ringHubSize: 10, ringRings: 6, ringSpokes: 8, ringSatellites: 4, ringTrunks: 1, ringWidth: 0.18,
      ringPlates: 1, ringPlateColour: '#e8dccc', ringGlow: 0.9, ringFill: 0.1, ringSharp: 1,
      glintCity: 0.8, glintSharp: 0.3, glintScatter: 0.35, glintColour: '#fff4ea',
      cloudCover: 0.4, cloudScale: 0.9, cloudStorms: 1, cloudSoft: 0.5, cloudHaze: 0.15, haze: 0.3,
      gradeStrength: 1.12, gradeLightness: 1.4,
    },
    layers: { atmosphere: air('#9cb8ff', 0.8), clouds: cloudy(0.6), night: cityNight },
    air: { skyStrength: 0.4, visibilityKm: 30, hazeHeightKm: 2, hazeColour: '#f4e8dc' },
  },
});
PRESET_ORDER.push('w-coruscant-rings');

// The shapes of wave 2 (partdials.js): irregular bodies, a broken planet, a debris field and rings.
// A preset's `shape`, `belt` and `rings` are the parts' dials over their starts.
const SHAPES = 'Generated shapes';
// (few fresh rays: on a small body they read as white specks scattered over the stone)
const rockyMoon = { highland: '#8f8b85', mare: '#5a5652', rayColour: '#b4b0a8', maria: 0.15, craters: 0.45, rays: 0.05, haze: 0, dusty: 0.6 };
const bare = { atmosphere: { on: false }, clouds: { on: false } };
Object.assign(PRESETS, {
  'w-polis-massa': {
    name: 'Polis Massa', recipe: 'moon', seed: 4019, group: SHAPES,
    dials: { ...rockyMoon, highland: '#8a7e72', mare: '#544a42', craterSize: 1.3 },
    shape: { kind: 'irregular', dials: { size: 0.2, lumps: 0.75, elong: 0.55, craters: 0.55, craterSize: 1.25, facets: 0.55 } },
    belt: { kind: 'field', dials: { count: 6000, sizeMin: 0.003, sizeMax: 0.08, colour: '#7c7066', colour2: '#4e4640', variety: 0.5, inner: 1.2, outer: 5.5, thickness: 0.4, gaps: 0, clumps: 0.45, dust: 0.08, dustColour: '#8a8076' } },
    layers: bare, adjust: { spin: 0.6 },
  },
  'w-kessel-moon': {
    name: 'Kessel\'s garrison moon', recipe: 'moon', seed: 8823, group: SHAPES,
    dials: { ...rockyMoon, craterSize: 1 },
    shape: { kind: 'irregular', dials: { size: 0.7, lumps: 0.45, elong: 0.62, craters: 0.7, craterSize: 1.1, facets: 0.15 } },
    layers: bare, adjust: { spin: 0.8 },
  },
  'w-small-moon': {
    name: 'A small moon', recipe: 'moon', seed: 2771, group: SHAPES,
    dials: { ...rockyMoon, highland: '#9a948a', mare: '#625c56' },
    shape: { kind: 'irregular', dials: { size: 0.45, lumps: 0.55, elong: 0.3, craters: 0.85, craterSize: 1.1, facets: 0.3 } },
    layers: bare, adjust: { spin: 0.8 },
  },
  'w-concord-dawn': {
    name: 'Concord Dawn', recipe: 'ice', seed: 6262, group: SHAPES,
    dials: { snow: '#cfc8ec', ice: '#9b9cd2', rock: '#3a3650', crevasse: '#6c72b0', ridges: 0.4, rockShare: 0.55, crevasses: 0, plains: 0.55, cloudCover: 0.3, cloudStorms: 1, haze: 0.35 },
    shape: { kind: 'broken', dials: { woundSize: 46, woundYaw: 45, woundPitch: -18, woundDepth: 0.36, ragged: 0.85, rockColour: '#2a2638', strataColour: '#4c4662', glowColour: '#ff5a22', glow: 0.45,
      streamCount: 16000, streamLength: 10, streamSpread: 0.6, streamTrail: 15, streamCurve: 0.35, streamRock: 1.1, streamColour: '#8a88ac', streamDust: 0.6, dustColour: '#5c72ff' } },
    layers: { atmosphere: air('#b4b0ff', 0.55), clouds: cloudy(0.6, { tint: '#e4e0ff' }) }, adjust: { spin: 0 },
  },
  'w-alderaan-graveyard': {
    name: 'Alderaan\'s graveyard', recipe: 'moon', seed: 1977, group: SHAPES,
    dials: { ...rockyMoon },
    // a planet's worth of rubble spread wide: mostly small stuff with black between, a few big blocks
    belt: { kind: 'field', dials: { count: 22000, sizeMin: 0.003, sizeMax: 0.12, colour: '#7a746c', colour2: '#4a3c34', variety: 0.75, inner: 1.1, outer: 6.5, thickness: 0.35, gaps: 0, clumps: 0.4, dust: 0.3, dustColour: '#8c8478' } },
    layers: { surface: { on: false }, normal: { on: false }, ...bare }, adjust: { spin: 0 },
  },
  'w-geonosis': {
    name: 'Geonosis', recipe: 'desert', seed: 2202, group: SHAPES,
    dials: { sandLight: '#d39a64', sandDark: '#a45e3a', rock: '#66392a', salt: '#d8b48e', saltFlats: 0.1, badlands: 0.65, variety: 0.8, haze: 0.25 },
    rings: { style: 'dusty', dials: { inner: 1.45, outer: 2.45, opacity: 0.5, bands: 0.45, fine: 0.35, gaps: 1, gapWidth: 0.03, colour1: '#b48c6a', colour2: '#6c5242', bright: 1 } },
    // ring-sized rocks: specks that glint, not pepper over the ring
    belt: { kind: 'belt', dials: { count: 14000, sizeMin: 0.001, sizeMax: 0.009, colour: '#a68670', colour2: '#6a5242', variety: 0.5, inner: 1.55, outer: 2.35, thickness: 0.04, gaps: 1, gapWidth: 0.05, clumps: 0.35, dust: 0.3, dustColour: '#b08a6c' } },
    layers: { atmosphere: air('#ffb27a', 0.45, { power: 3.5, height: 1.025 }) },
  },
});
PRESET_ORDER.push('w-polis-massa', 'w-kessel-moon', 'w-small-moon', 'w-concord-dawn', 'w-alderaan-graveyard', 'w-geonosis');

// Wave 5: space volumes (partdials.js's volume, drawn by volume.js), glowing gas with no body: a
// storm cloud with the Maw at its heart beside Kessel, and nebulae to stand near a few zones' planets.
// Their colours and shapes are starts for the owner to dial. (The recipe under them draws nothing:
// their surface, clouds and air are off.)
const VOLUMES = 'Generated space volumes';
const gasOnly = { surface: { on: false }, normal: { on: false }, atmosphere: { on: false }, clouds: { on: false } };
Object.assign(PRESETS, {
  'v-maelstrom': {
    name: 'Kessel\'s Maelstrom and the Maw', recipe: 'moon', seed: 1138, group: VOLUMES,
    dials: { ...rockyMoon },
    // billowing storm cloud wound round a dark heart, lightning running through it
    // (slate storm cloud with little light of its own: what colour it has is the heart's warm light on the
    // eye's wall and the sun's cold light on its outside, each shadowed by the billows between)
    volume: { kind: 'gas', dials: { scale: 1.15, colour1: '#56627e', colour2: '#aab6ce', glow: 0.16, density: 2.6, cover: 0.66, soft: 0.18, detail: 1.1, form: 0.85, core: 0.3,
      flatten: 0.5, lean: 55, swirl: 2.6, turb: 0.18, churn: 0.4, drift: 3, sunlit: 0.4, inner: 2.6, knots: 0.3, wisps: 0.4, dust: 0,
      maw: 0.75, mawSize: 0.085, rimColour: '#ffb46e', rim: 2.4, bend: 0.55, disc: 1.2,
      flashes: 1.6, flashBright: 3.2, flashColour: '#cfdcff', flashSize: 0.17 } },
    layers: gasOnly, adjust: { spin: 0 },
  },
  'v-veil-red': {
    name: 'Crimson veil (by Dathomir)', recipe: 'moon', seed: 6620, group: VOLUMES,
    dials: { ...rockyMoon },
    volume: { kind: 'gas', dials: { scale: 0.9, colour1: '#ff5a72', colour2: '#6a3cc8', glow: 1.0, density: 0.7, see: 0.15, cover: 0.48, soft: 0.25, detail: 1.5, form: 0.1, core: 0.1, flatten: 0.72, stretch: 1.6, turb: 0.22, churn: 0.25, drift: 1,
      inner: 1.0, knots: 0.85, wisps: 0.8, dust: 1.0 } },
    layers: gasOnly, adjust: { spin: 0 },
  },
  'v-veil-blue': {
    name: 'Blue veil (by Endor)', recipe: 'moon', seed: 4183, group: VOLUMES,
    dials: { ...rockyMoon },
    // (more lit than glowing, as a blue nebula is: starlight from within thrown back by its dust)
    volume: { kind: 'gas', dials: { scale: 1, colour1: '#86c2ff', colour2: '#3446c0', glow: 0.45, density: 0.8, see: 0.1, cover: 0.5, soft: 0.3, detail: 1.3, form: 0.3, core: 0.2, flatten: 0.6, stretch: 1.5, lean: 25, turb: 0.15, churn: 0.3, drift: -1.5, sunlit: 0.3,
      inner: 1.8, knots: 0.4, wisps: 1.0, dust: 0.8 } },
    layers: gasOnly, adjust: { spin: 0 },
  },
  'v-cloud-gold': {
    name: 'Gold dust cloud (by Lok)', recipe: 'moon', seed: 5309, group: VOLUMES,
    dials: { ...rockyMoon },
    volume: { kind: 'gas', dials: { scale: 1.3, colour1: '#ffc070', colour2: '#9a4420', glow: 0.45, density: 1.4, cover: 0.56, soft: 0.26, detail: 1.1, form: 0.6, core: 0.4, flatten: 0.8, stretch: 1.3, turb: 0.12, churn: 0.2, drift: 2, sunlit: 0.9,
      inner: 0.6, knots: 0.3, wisps: 0.6, dust: 1.4,
      flashes: 0.3, flashBright: 1.2, flashColour: '#ffe4c0' } },
    layers: gasOnly, adjust: { spin: 0 },
  },
});
PRESET_ORDER.push('v-maelstrom', 'v-veil-red', 'v-veil-blue', 'v-cloud-gold');

// Every preset above stays at recipe version 1, exactly as it was made: version 2 (spots, cloud flecks
// and the colour grade) came after them. A preset below that names no version takes the newest.
for (const id of PRESET_ORDER) PRESETS[id].version ??= 1;

// Version 2's first presets (21 November): Naboo remade spotted, from the owner's Naboo picture (the menu
// circle's, one of his imported pictures) and beside it SWG's own (the Naboo hung in Rori's sky,
// paler and greyer). Its pattern is the first's; its colours are each matched by measurement to its
// picture (colourmatch.js: lightness, colour strength and hue over the lit disc).
const SPOTTED = 'Generated worlds, version 2';
// Naboo's pattern, the same for both: half land and half sea in patches, mid-blue seas, olive greens,
// thin swirling cloud with many flecks.
const NABOO2 = {
  land: 0.5, continentSize: 1.1, mountains: 0.25, rivers: 0, warmth: 0.63, wetness: 0.7,
  deep: '#3a5f84', shallow: '#4f7a9c', shelf: '#5f90a0', beach: '#a8a88a', desert: '#8e9070', grass: '#7a8a58', forest: '#4e6646', steppe: '#8e9466', swamp: '#5a6848',
  spots: 1, spotScale: 1, spotSpread: 0.35, spotEdge: 0.6, spotVariety: 0.5,
  cloudCover: 0.46, cloudScale: 0.8, cloudSwirl: 1.3, cloudStorms: 2, cloudSpots: 0.7, cloudSpotScale: 0.8, haze: 0.4,
};
Object.assign(PRESETS, {
  'w2-naboo': {
    name: 'Naboo, spotted (his picture\'s colours)', recipe: 'living', version: 2, seed: 3141, compare: 'menu:naboo', group: SPOTTED,
    // (the grade the matcher found against the menu circle's Naboo beside it, six steps)
    // (the grade the matcher found against the menu circle's Naboo beside it on the stage, six steps from
    // an ungraded start: lightness 67.6 against 68.0, colour strength 15.9 against 16.7, hue 251° ± 14°
    // against 267° ± 15°; ungraded it was 48.6, 13.3 and 237° ± 46°)
    dials: { ...NABOO2, gradeStrength: 1.92, gradeLightness: 1.72, gradeWash: 0.7, gradeWashColour: '#93a7c2' },
    // (its clouds a little blue, as the picture's are: white through blue air)
    layers: { atmosphere: air('#8fc0ff'), clouds: cloudy(0.9, { tint: '#d6e4f2' }), specular: sea(0.35) },
  },
  'w2-naboo-swg': {
    name: 'Naboo, spotted (SWG\'s picture\'s colours)', recipe: 'living', version: 2, seed: 3141, compare: 'menu:naboo', group: SPOTTED,
    // (matched to SWG's picture, six steps from an ungraded start: lightness 52.2 against 52.2, colour
    // strength 14.0 against 14.1, hue 209° ± 18° against 215° ± 19°; ungraded it was 49.0, 12.6 and 195° ± 57°)
    dials: { ...NABOO2, gradeStrength: 1.73, gradeLightness: 1.11, gradeWash: 0.77, gradeWashColour: '#5e8389' },
    // (SWG's picture is a pale, even teal-grey: its air and clouds the same, so the grade can reach it)
    layers: { atmosphere: air('#a6c4c8', 0.6), clouds: cloudy(0.85, { tint: '#d0dcdc' }), specular: sea(0.25) },
  },
});
PRESET_ORDER.push('w2-naboo', 'w2-naboo-swg');

// Looks run 2 (21 November): generated twins of the owner's imported pictures, made by measuring both sides
// (colourmatch.js's colours, patternmatch.js's patterns) and moving the dials: numbers only, nothing of a
// picture in them. They are what a player without his imports sees in place of them.
export const TWINS = 'Generated twins of his imported pictures';
Object.assign(PRESETS, {
  'w3-naboo': {
    name: 'Naboo (twin of his imported Naboo)', recipe: 'living', version: 4, seed: 3141, compare: 'menu:naboo', group: TWINS,
    // (wave B: re-tuned with the planet features under its Scattered air, the lit disc at noon: lightness 68.9 / 67.8,
    // colour strength 17.3 / 13.9, hue 268 / 262 degrees, 4.0 apart (5.0 before), with fine specks and grain at the
    // texture's own fineness and one great cyclone in the upper left as his)
    // Version 3 against his Naboo, both measured as lit discs at 0.2 degrees a pixel (patternmatch.js), his
    // first and then version 2's spotted Naboo before and this after: the lighter ground 39% / 41% / 48% of
    // the lit disc in 2175 / 947 / 1705 patches, half of it in patches under 1/535 / 1/628 / 1/230 of the
    // sphere, its edges ragged 2.86 / 2.58 / 3.70 (dimension 1.72 / 1.33 / 1.50), dark specks (lakes)
    // 17.8k / 7.1k / 12.2k a sphere, bright flecks 13.2k / 3.7k / 9.0k, cloud 12% / 17% / 12% in masses of
    // 1/146 / 1/574 / 1/117 of the sphere, spectrum slope -2.33 / -2.81 / -2.28. Its finest lakes need the
    // largest texture (4096): at 2048 they are filtered away. Colours by the matcher, eleven steps:
    // lightness 69.6 / 72.3 / 69.6, colour strength 17.5 / 17.4 / 17.9, hue 269° / 253° / 265°.
    dials: {
      ...NABOO2, spots: 1, spotScale: 1, spotSpread: 0.55, spotFray: 1, lakes: 1, lakeScale: 0.3, lakeSpread: 0.3,
      cloudCover: 0.5, cloudScale: 1.3, cloudStreaks: 0.8, cloudStreakScale: 2.2, cloudSpots: 0.6, cloudSpotScale: 0.3,
      fineSpecks: 0.5, fineGrain: 0.5, fineDark: 0.6, greatStorm: 0.6, greatStormLat: 30, greatStormLon: -35,
      gradeStrength: 2, gradeLightness: 1.705, gradeHue: 21, gradeWash: 0.441, gradeWashColour: '#96aac6',
    },
    size: 4096,
    layers: { atmosphere: air('#8fc0ff'), clouds: cloudy(0.9, { tint: '#d6e4f2' }), specular: sea(0.35) },
  },
});
PRESET_ORDER.push('w3-naboo');

// The other twins (looks run 2, the look tuner): one for every imported picture of a planet, moon, gas giant
// or star surface, each found by measuring both sides and moving the dials (numbers only: nothing of a picture
// is in them). Colours by colourmatch.js's grade (gradeToward, over the lit disc for his circles and over the
// albedo for his whole-sphere maps), patterns by patternmatch.js's measures and by eye at orbit and sky size.
// Their numbers, his / the twin, are in the look tuner's proof page (local only).
// (wave B) Ryloth's twin as looks run 2 made it (living version 3): its ground and air are the re-tuned twin's start,
// and Dantooine's own version below is made from it as it was, so Dantooine does not move with the re-tune
const RYLOTH_V3 = {
  dials: { land: 0.9, continentSize: 1.3, mountains: 0.3, rivers: 0.2, spots: 0.8, spotScale: 1.2, warmth: 0.8, wetness: 0.15, desert: '#b08860', steppe: '#6a4a30', grass: '#9a9478', scorched: '#6a4a38', rock: '#5a4a40', cloudCover: 0.5, cloudScale: 1.1, cloudSwirl: 1.4, cloudStorms: 1, cloudSpots: 0.12, cloudStreaks: 0.3, cloudStreakScale: 1.6, haze: 0.4, gradeStrength: 1.03, gradeLightness: 1.692, gradeWashColour: '#d2cac9' },
  layers: { specular: { on: true, opacity: 0.4, tint: '#fff4e0', shine: 150 }, clouds: { on: true, opacity: 0.9, tint: '#f0f6ff' }, atmosphere: { opacity: 0.5, tint: '#e8dcc8' } },
};
Object.assign(PRESETS, {
  // (his / the twin, over the lit disc: lightness 75.8 / 75.8, colour strength 10.0 / 10.0, hue 42 / 68 degrees)
  // (pass 2, wave 6, its critic J: moved to version 4, its regions' borders softened, soft edges 0.7 over 2 degrees, and its grade
  // brought back to his mean; his / the twin over the lit disc at noon, lightness 75.3 / 74.9, colour strength 10.3 / 10.0, hue 44 /
  // 41 degrees, 0.7 apart as before)
  'twin-tatooine': { name: "Tatooine (twin of his Tatooine circle)", recipe: 'desert', version: 4, seed: 1977, compare: 'menu:tatooine', group: TWINS,
    dials: { sandLight: '#ccb698', sandDark: '#8a7278', rock: '#6a5a5e', salt: '#f2ece2', duneScale: 1.6, duneStrength: 0.3, badlands: 0.3, saltFlats: 0.03, variety: 0.85, haze: 0.25, dusty: 0.2, gradeStrength: 1.475, gradeLightness: 1.446, gradeHue: 11.505, gradeWash: 0.002, gradeWashColour: '#cbb7b1',
      softEdges: 0.7, softWidth: 2 },
    layers: { atmosphere: { opacity: 0.45, tint: '#ffe4c4', power: 3.5, height: 1.025 } }, size: 2048 },
  // (his / the twin, over the lit disc: lightness 74.8 / 74.8, colour strength 26.2 / 26.3, hue 62 / 72 degrees)
  // (pass 2, wave 6, its critic J: moved to version 4 for his picture's fracture star, up and to the left of the face as his, twenty
  // brown cracks reaching 30 degrees, kept in their own colour after the grade (the drift wave B met); his / the twin over the lit
  // disc at noon, lightness 74.3 / 72.6, colour strength 26.6 / 24.0, hue 62 / 73 degrees, 5.7 apart (5.8 before): the hue is the
  // twin's warm air's, which a grade cannot turn back)
  'twin-jakku': { name: "Jakku (twin of his Jakku circle)", recipe: 'desert', version: 4, seed: 3434, compare: 'menu:jakku', group: TWINS,
    dials: { sandLight: '#e8c294', sandDark: '#c89a6a', rock: '#8a6a50', salt: '#f0e0c8', duneScale: 1.6, duneStrength: 0.5, badlands: 0.08, saltFlats: 0.04, variety: 0.35, canyons: 0.15, canyonSize: 1.2, canyonColour: '#8a5a3a', haze: 0.25, dusty: 0.2, gradeStrength: 1.603, gradeLightness: 1.191, gradeWash: 1, gradeWashColour: '#ddaf8e',
      star: 0.8, starColour: '#6a4a32', starKeep: 1, starRays: 20, starReach: 30, starWidth: 0.5, starLat: 30, starLon: -35 },
    layers: { atmosphere: { opacity: 0.4, tint: '#ffd8b0', power: 3.5, height: 1.025 } }, size: 2048 },
  // (his / the twin, over the albedo: lightness 28.9 / 28.9, colour strength 30.4 / 30.2, hue 53 / 53 degrees)
  'twin-jakku-map': { name: "Jakku (twin of his Jakku map)", recipe: 'desert', version: 2, seed: 3435, compare: 'set:jakku', group: TWINS,
    dials: { sandLight: '#9a6a3c', sandDark: '#86562e', rock: '#6a4a30', salt: '#a87c50', duneStrength: 0.3, badlands: 0.15, saltFlats: 0.05, variety: 0.3, haze: 0.2, dusty: 0.2, gradeStrength: 0.95, gradeLightness: 0.762, gradeHue: -14.618, gradeWashColour: '#67381f' },
    layers: { atmosphere: { opacity: 0.4, tint: '#ffd8b0', power: 3.5, height: 1.025 } }, size: 2048 },
  // (wave B, re-tuned with the planet features under its Scattered air: his / the twin over the lit disc at noon,
  // lightness 57.2 / 56.4, colour strength 36.4 / 35.0, hue 75 / 71 degrees, 3.0 apart (5.2 before); dark specks
  // 6.0k / 7.3k a sphere (3.0k before), lighter patches 2485 / 2506 (364 before): a smoky mottle, fine specks and
  // a few yellow lights)
  'twin-kessel': { name: "Kessel (twin of his Kessel circle)", recipe: 'desert', version: 3, seed: 8823, compare: 'menu:kessel', group: TWINS,
    dials: { sandLight: '#a8783c', sandDark: '#5c3c1e', rock: '#34241a', salt: '#e0c890', duneScale: 0.7, duneStrength: 0.2, badlands: 0.25, saltFlats: 0.06, variety: 1, haze: 0.2, dusty: 0.15,
      mottle: 0.6, mottleScale: 0.45, mottleSoft: 0.7, mottleColour: '#22160a', mottleLight: '#806440', fineSpecks: 0.4, fineSize: 3, fineGrain: 0.6,
      // (wave B, its critic: the specks bright by day but not glowing: his Kessel's night side is dark, and glowing they
      // laid a glitter over its whole night half)
      specks: 0.12, speckSize: 0.6, speckColour: '#e0d070', speckGlow: 0,
      gradeStrength: 1.703, gradeLightness: 1.741, gradeWash: 0.08, gradeWashColour: '#aa824d' },
    layers: { atmosphere: { opacity: 0.35, tint: '#ffd090', power: 3.5, height: 1.025 }, night: { on: true, where: 'night', opacity: 0.8, tint: '#ffd060' } }, size: 2048 },
  // (his / the twin, over the lit disc: lightness 65.1 / 65.1, colour strength 43.3 / 43.3, hue 59 / 68 degrees)
  // (pass 2, wave 6, its critic J: moved to version 4, its blotches' borders softened, soft edges 0.6 over 1.5 degrees, its grade
  // brought back to his mean; his / the twin over the lit disc at noon, lightness 63.9 / 63.3, colour strength 43.6 / 42.8, hue 58 /
  // 58 degrees, 1.1 apart (1.5 before); his cream swirls are finer than any edge the part softens)
  'twin-geonosis': { name: "Geonosis (twin of his Geonosis circle)", recipe: 'desert', version: 4, seed: 2202, compare: 'menu:geonosis', group: TWINS,
    dials: { sandLight: '#e8a048', sandDark: '#a04018', rock: '#6a2010', salt: '#f0c070', duneScale: 0.9, duneStrength: 0.3, badlands: 0.25, saltFlats: 0.2, variety: 1, haze: 0.2, dusty: 0.15, gradeStrength: 1.399, gradeLightness: 1.312, gradeHue: -16.238, gradeWashColour: '#d48e5f',
      softEdges: 0.6, softWidth: 1.5 },
    layers: { atmosphere: { opacity: 0.4, tint: '#ffb070', power: 3.5, height: 1.025 } }, size: 2048 },
  // (his / the twin, over the lit disc: lightness 75.9 / 75.9, colour strength 12.0 / 12.1, hue 282 / 279 degrees)
  'twin-hoth': { name: "Hoth (twin of his Hoth circle)", recipe: 'ice', version: 2, seed: 1980, compare: 'menu:hoth', group: TWINS,
    dials: { snow: '#eef2f8', ice: '#b8c8e0', rock: '#8a8a98', crevasse: '#9aaac8', ridges: 0.12, rockShare: 0.04, crevasses: 0.03, plains: 0.5, cloudCover: 0.55, cloudScale: 1.7, cloudSwirl: 0.4, cloudStorms: 1, haze: 0.45, gradeStrength: 1.344, gradeLightness: 0.964, gradeWash: 1, gradeWashColour: '#b5bad1' },
    layers: { specular: { on: true, opacity: 0.2, tint: '#eef4ff', shine: 30 }, clouds: { on: true, opacity: 0.6, tint: '#e8f0ff' }, atmosphere: { tint: '#c8dcff' } }, size: 2048 },
  // (wave B, re-tuned with the planet features under its Scattered air: his / the twin over the lit disc at noon,
  // lightness 68.9 / 68.8, colour strength 18.3 / 15.3, hue 263 / 263 degrees, 3.0 apart (5.0 before): the great
  // trench round the globe, and fine specks)
  'twin-starkiller': { name: "Starkiller Base (twin of his circle)", recipe: 'ice', version: 3, seed: 2015, compare: 'menu:starkiller', group: TWINS,
    dials: { snow: '#a8b8cc', ice: '#7a94b8', rock: '#4a5468', crevasse: '#7a90b4', ridges: 0.3, rockShare: 0.15, crevasses: 0.3, plains: 0.8, canyons: 0.5, canyonSize: 2.5, canyonColour: '#2a3448', cloudCover: 0.25, cloudScale: 1.3, cloudStorms: 0, haze: 0.45,
      trench: 1, trenchWidth: 2.8, trenchTilt: 25, trenchTurn: 30, trenchColour: '#121a26', trenchWobble: 0.25, fineSpecks: 0.6, fineSize: 2.5, fineDark: 0.6, fineGrain: 0.5,
      gradeStrength: 2, gradeLightness: 1.182, gradeWash: 0.068, gradeWashColour: '#91abc8' },
    layers: { clouds: { on: true, opacity: 0.7, tint: '#e8f0ff' }, atmosphere: { tint: '#b8d0ff' } }, size: 2048 },
  // (his / the twin, over the lit disc: lightness 80.1 / 80.1, colour strength 7.5 / 4.4, hue 269 / 275 degrees)
  'twin-crait': { name: "Crait (twin of his Crait circle)", recipe: 'flats', version: 2, seed: 2017, compare: 'menu:crait', group: TWINS,
    dials: { crust: '#f0f2f6', under: '#c09090', rock: '#7a7a84', crystal: '#e0e8f4', crustCover: 0.95, cracks: 0.04, streaks: 0.3, ranges: 0.3, crystalShine: 0.3, cloudCover: 0.3, cloudStorms: 0, haze: 0.4, gradeStrength: 2, gradeLightness: 1.008, gradeWashColour: '#c0c7d4' },
    layers: { specular: { on: true, opacity: 0.3, shine: 40 }, clouds: { on: true, opacity: 0.6 }, atmosphere: { opacity: 0.6, tint: '#dce8ff' } }, size: 2048 },
  // (his / the twin, over the lit disc: lightness 75.8 / 75.8, colour strength 12.7 / 12.8, hue 229 / 224 degrees)
  'twin-endor-giant': { name: "Endor's gas giant (twin of his picture)", recipe: 'gasgiant', version: 2, seed: 4183, compare: 'set:endor-gas-giant', group: TWINS,
    dials: { c1: '#d8e8f0', c2: '#a8c4d4', c3: '#6a8aa4', c4: '#8ab0c4', polar: '#7a90a4', bands: 26, contrast: 0.35, turbulence: 0.4, streaks: 0.8, storms: 0, stormSize: 0.8, stormColour: '#e4f0f8', haze: 0.2, limbDark: 0.45, gradeStrength: 1.415, gradeLightness: 1.182, gradeWash: 0.759, gradeWashColour: '#a0c0cc' },
    layers: { atmosphere: { opacity: 0.45, tint: '#bcd8ff', power: 3.2, height: 1.03 } }, size: 2048 },
  // (his / the twin, over the lit disc: lightness 63.6 / 63.5, colour strength 42.9 / 42.7, hue 58 / 69 degrees)
  // (pass 2, wave 6, its critic J: moved to version 4, its bands soft blends rather than candy stripes (soft bands 0.8, band contrast
  // 0.35 for 0.45, turbulence 0.9) with two more colours mixed in (a pale cream and a rust, 0.6), its grade brought back to his
  // mean; his / the twin over the lit disc at noon, lightness 63.6 / 63.1, colour strength 43.0 / 42.0, hue 59 / 61 degrees, 1.9
  // apart (1.8 before))
  'twin-bespin': { name: "Bespin (twin of his Bespin circle)", recipe: 'gasgiant', version: 4, seed: 2210, compare: 'menu:bespin', group: TWINS,
    dials: { c1: '#f0c080', c2: '#e09850', c3: '#b06028', c4: '#d08040', polar: '#a07050', bands: 24, contrast: 0.35, turbulence: 0.9, streaks: 0.6, storms: 0, stormColour: '#f8dcb0', haze: 0.15, limbDark: 0.5, gradeStrength: 1.372, gradeLightness: 1.169, gradeHue: -18.659, gradeContrast: 0.949, gradeWash: 0.201, gradeWashColour: '#d1895a',
      bandSoft: 0.8, moreColours: 0.6, c5: '#f0d0a8', c6: '#b86838' },
    layers: { atmosphere: { opacity: 0.45, tint: '#ffc890', power: 3.2, height: 1.03 } }, size: 2048 },
  // (his / the twin, over the albedo: lightness 53.7 / 53.7, colour strength 62.0 / 61.8, hue 56 / 60 degrees)
  'twin-bespin-map': { name: "Bespin (twin of his Bespin map)", recipe: 'gasgiant', version: 2, seed: 2211, compare: 'set:bespin', group: TWINS,
    dials: { c1: '#e8a050', c2: '#d07828', c3: '#a04810', c4: '#c06420', polar: '#985030', bands: 20, contrast: 0.25, turbulence: 0.9, streaks: 0.7, storms: 0, stormColour: '#f0c080', haze: 0.15, limbDark: 0.5, gradeStrength: 1.043, gradeLightness: 0.985, gradeWash: 0.165, gradeWashColour: '#c76625' },
    layers: { atmosphere: { opacity: 0.45, tint: '#ffc890', power: 3.2, height: 1.03 } }, size: 2048, adjust: { spin: 1 } },
  // (his / the twin, over the lit disc: lightness 43.5 / 43.5, colour strength 45.7 / 45.7, hue 44 / 47 degrees)
  'twin-yavin-prime': { name: "Yavin Prime (twin of his painted Yavin Prime)", recipe: 'gasgiant', version: 2, seed: 4471, compare: 'set:yavin-prime', group: TWINS,
    dials: { c1: '#e89060', c2: '#c85a32', c3: '#8a2a14', c4: '#b04424', polar: '#7a3020', bands: 10, contrast: 0.3, turbulence: 1, streaks: 0.8, storms: 1, stormColour: '#f0a878', haze: 0.12, limbDark: 0.55, gradeStrength: 0.926, gradeLightness: 1.012, gradeWashColour: '#a34e34' },
    // (wave B, its critic: no glow of its own; his picture's night side is dark, and the glow filled it a flat red)
    layers: { atmosphere: { opacity: 0.4, tint: '#ff9a70', power: 3.2, height: 1.03 } }, size: 2048, adjust: { glow: '#ff2a10', glowStrength: 0, spin: 1 } },
  // (wave B, with the planet features: his / the twin over the lit disc at noon, lightness 55.8 / 55.8, colour strength
  // 4.7 / 4.7, 6.4 apart (6.8 before; the rest is the hue of a near-grey): straight glowing red fissures, on the night
  // side in the night layer's red)
  'twin-fondor-moon': { name: "Fondor moon, crescent (twin of his picture)", recipe: 'moon', version: 3, seed: 4040, compare: 'set:fondor-moon-1', group: TWINS,
    dials: { highland: '#9a9694', mare: '#6a6462', rayColour: '#c4c0bc', maria: 0.05, craters: 0.25, craterSize: 1.2, rays: 0.05, canyons: 0.15, canyonSize: 0.6, canyonColour: '#5a2a24', haze: 0, dusty: 0.6,
      // (wave B, its critic: thinner, paler fissures, pink-white by day as his, still glowing on the night side)
      lines: 0.45, lineStraight: 0.7, lineGlow: 0.55, lineColour: '#f0a090', lineWidth: 0.1,
      gradeStrength: 1.964, gradeLightness: 0.954, gradeWashColour: '#8a848a' },
    layers: { atmosphere: { on: false }, night: { on: true, where: 'night', opacity: 1, tint: '#ff7a60' } }, size: 2048 },
  // (his / the twin, over the lit disc: lightness 70.4 / 70.4, colour strength 3.7 / 3.7, hue 15 / 91 degrees)
  'twin-fondor-moon-4': { name: "Fondor moon, gibbous (twin of his picture)", recipe: 'moon', version: 2, seed: 4044, compare: 'set:fondor-moon-4', group: TWINS,
    dials: { highland: '#c8c4bc', mare: '#8a8680', rayColour: '#e4e0d8', maria: 0.08, craters: 0.85, craterSize: 0.7, rays: 0.1, haze: 0, dusty: 0.7, gradeStrength: 0.902, gradeLightness: 0.97, gradeWashColour: '#b2aaab' },
    layers: { atmosphere: { on: false } }, size: 2048 },
  // (wave B, with the planet features: his / the twin over the lit disc at noon, lightness 59.6 / 59.6, colour strength
  // 12.4 / 12.4, hue 287 / 308 degrees, 4.6 apart (7.0 before): long dark red lines that fork, fewer canyons)
  'twin-ryloth-moon': { name: "Ryloth's moon (twin of his picture)", recipe: 'moon', version: 3, seed: 7070, compare: 'set:ryloth-moon', group: TWINS,
    // (wave B, its critic: its greys bluer, his picture's blue-grey, where they read lilac: ΔE 4.6 to 1.3)
    dials: { highland: '#a9adbb', mare: '#83879a', rayColour: '#cdd0dc', maria: 0.1, craters: 0.3, rays: 0.03, canyons: 0.2, canyonSize: 0.6, canyonColour: '#5a2228', haze: 0, dusty: 0.6,
      lines: 0.75, lineBranch: 0.8, lineColour: '#5a1a18', lineWidth: 0.5, lineScale: 0.8,
      gradeStrength: 1.622, gradeLightness: 0.91, gradeWashColour: '#8c8ea3' },
    layers: { atmosphere: { on: false } }, size: 2048 },
  // (wave B, re-graded under its Scattered air with a grey cloud deck: his / the twin over the lit disc at noon,
  // lightness 60.9 / 61.9, colour strength 4.8 / 5.0, hue 284 / 295 degrees, 1.4 apart (31.7 before); cloud 42.5% /
  // 42.5% of the lit disc (none before), dark specks 12.7k / 12.4k a sphere (0.3k before): grey ground with dark
  // crusted lakes, fine specks, the deck)
  'twin-resurgent': { name: "The Resurgent's planet (twin of his picture)", recipe: 'volcanic', version: 3, seed: 5150, compare: 'set:resurgent', group: TWINS,
    dials: { crust: '#363636', ash: '#6e6c6a', lava: '#6a2414', lavaAmount: 0.45, rivers: 0.1, cracks: 0.1, cloudCover: 0.72, cloudScale: 0.5, cloudSwirl: 0.9, cloudStorms: 0, cloudSpots: 0.7, cloudSpotScale: 0.4, cloudStreaks: 0.3, haze: 0.8,
      fineSpecks: 0.7, fineSize: 2.5, fineGrain: 0.6, fineDark: 0.55,
      gradeStrength: 0.715, gradeLightness: 1.061, gradeWashColour: '#91939a' },
    layers: { night: { on: true, opacity: 0.4, tint: '#ff5a20' }, clouds: { on: true, opacity: 0.9, tint: '#c0c4c8' }, atmosphere: { opacity: 0.9, tint: '#9ab0e0' } }, size: 2048 },
  // (wave B, with the planet features, its albedo against his map: lightness 19.5 / 20.0, colour strength 13.5 / 13.5,
  // 1.4 apart (2.4 before); bright specks 7.9k / 7.6k a sphere (1.9k before): his scattered cyan glow specks)
  // (wave 6, maker C: moved to version 4, a halo round each cyan speck so they read at sky size; its disc's lightness 27.9 to 32.1,
  // his map's 39.1)
  'twin-sullust': { name: "Sullust (twin of his Sullust map)", recipe: 'volcanic', version: 4, seed: 6161, compare: 'set:sullust', group: TWINS,
    dials: { crust: '#141016', ash: '#3a1418', lava: '#ff3020', lavaAmount: 0.25, rivers: 0.5, cracks: 0.7, cloudCover: 0.35, cloudStorms: 0, haze: 0.2,
      specks: 0.6, speckSize: 0.8, speckColour: '#50e8f0', speckGlow: 0.8, speckHalo: 0.7,
      gradeStrength: 1.739, gradeLightness: 1.55, gradeWashColour: '#3c2a33' },
    layers: { night: { on: true, opacity: 0.8, tint: '#ff4020' }, clouds: { on: true, opacity: 0.6, tint: '#a89090' }, atmosphere: { opacity: 0.35, tint: '#c87a7a' } }, size: 2048 },
  // (wave B, re-tuned with the planet features, its albedo against his map: lightness 10.8 / 10.6, colour strength
  // 14.6 / 18.7, hue 124 / 136 degrees, 3.1 apart (11.9 before): one great dark-green region with pale green glow
  // specks in it over dark ground)
  'twin-pillio-dead': { name: "Pillio, dead (twin of his map)", recipe: 'volcanic', version: 3, seed: 6262, compare: 'set:pillio-dead', group: TWINS,
    dials: { crust: '#160e08', ash: '#2a1e12', lava: '#50e050', lavaAmount: 0.05, rivers: 0.1, cracks: 0.05, cloudCover: 0.3, cloudStorms: 0, haze: 0.2,
      regionTint: 1, regionSize: 0.55, regionColour: '#163e12', specks: 0.7, speckRegion: 0.7, speckColour: '#d0ffc0', speckSize: 2, speckGlow: 0.8, fineSpecks: 0.3,
      gradeStrength: 0.638, gradeLightness: 0.744, gradeWashColour: '#191f0d' },
    layers: { night: { on: true, opacity: 0.8, tint: '#40ff60' }, clouds: { on: true, opacity: 0.5, tint: '#8a9080' }, atmosphere: { opacity: 0.35, tint: '#8aa080' } }, size: 2048 },
  // (his / the twin, over the lit disc: lightness 74.4 / 74.1, colour strength 12.9 / 12.3, hue 249 / 247 degrees)
  // (pass 2, wave 6, its critic J: moved to version 5, its land's green picked stronger and kept in its hue (his land is a deep
  // forest green where the twin's read a pale blue-green), the land's borders a little softer and the cloud soft, its grade brought
  // back to his mean; his / the twin over the lit disc at noon, lightness 73.7 / 73.4, colour strength 13.1 / 12.9, hue 249 / 251
  // degrees, 0.6 apart as before)
  'twin-kashyyyk': { name: "Kashyyyk (twin of his Kashyyyk circle)", recipe: 'living', version: 5, seed: 7731, compare: 'menu:kashyyyk', group: TWINS,
    dials: { land: 0.4, continentSize: 1.1, mountains: 0.3, rivers: 0.2, spots: 0.3, warmth: 0.72, wetness: 0.85, grass: '#5a7a40', forest: '#2e5030', jungle: '#2a5432', cloudCover: 0.3, cloudScale: 1.1, cloudSwirl: 0.9, cloudStorms: 2, cloudSpots: 0.12, cloudStreaks: 0.7, cloudStreakScale: 1.6, haze: 0.4, gradeStrength: 0.729, gradeLightness: 1.989, gradeHue: 15.82, gradeWash: 0.218, gradeWashColour: '#a3bacb',
      softEdges: 0.4, softWidth: 1.2, cloudSoft: 0.6, cloudHaze: 0.1, gradePickHue: 140, gradePickWidth: 40, gradePickStrength: 1.8, gradeHold: 1 },
    layers: { specular: { on: true, opacity: 0.4, tint: '#fff4e0', shine: 150 }, clouds: { on: true, opacity: 0.9, tint: '#f0f6ff' }, atmosphere: { opacity: 0.8, tint: '#8fc0ff' } }, size: 2048 },
  // (his / the twin, over the lit disc: lightness 63.7 / 62.3, colour strength 13.5 / 15.2, hue 266 / 261 degrees)
  'twin-endor': { name: "Endor (twin of his Endor circle)", recipe: 'living', version: 3, seed: 1983, compare: 'menu:endor', group: TWINS,
    dials: { land: 0.55, continentSize: 0.8, mountains: 0.3, rivers: 0.2, spotScale: 0.7, spotFray: 0.6, warmth: 0.62, wetness: 0.85, grass: '#4a7a60', forest: '#2a5a48', jungle: '#2a5a48', cloudCover: 0.3, cloudScale: 1.1, cloudSwirl: 0.9, cloudStorms: 2, cloudSpots: 0.1, cloudStreaks: 0.5, cloudStreakScale: 1.6, haze: 0.6, gradeStrength: 0.299, gradeLightness: 1.161, gradeWashColour: '#8c9cb1' },
    layers: { specular: { on: true, opacity: 0.4, tint: '#fff4e0', shine: 150 }, clouds: { on: true, opacity: 0.85, tint: '#f0f6ff' }, atmosphere: { opacity: 0.8, tint: '#8fc0ff' } }, size: 2048 },
  // (his / the twin, over the lit disc: lightness 71.6 / 64.0, colour strength 19.9 / 19.4, hue 267 / 260 degrees)
  // (wave 6, maker C: moved to version 5, its blues alone turned 20 degrees toward his blue with the jungle left as it was; his /
  // the twin over the lit disc at noon, hue 267 / 258 degrees, 3.8 apart (6.8 before))
  // (wave 6, its critic J: the re-grade airTuned.js laid over it, strength 1.49, carried into its own dials as the maker's numbers
  // were drawn, since a twin at its recipe's newest version now takes its grade from its own dials alone: presetDials)
  'twin-yavin4': { name: "Yavin 4 (twin of his Yavin 4 circle)", recipe: 'living', version: 5, seed: 4444, compare: 'menu:yavin4', group: TWINS,
    dials: { land: 0.45, continentSize: 0.8, mountains: 0.3, rivers: 0.2, spots: 0.4, spotFray: 0.2, warmth: 0.75, wetness: 0.9, grass: '#3a7a60', forest: '#2a6050', jungle: '#2a6050', cloudCover: 0.3, cloudScale: 1.1, cloudSwirl: 0.9, cloudStorms: 2, cloudSpots: 0.1, cloudStreaks: 0.5, cloudStreakScale: 1.6, haze: 0.4, gradeStrength: 1.49, gradeLightness: 2, gradeWash: 0.459, gradeWashColour: '#9ab2d2',
      gradePickHue: 240, gradePickWidth: 40, gradePickTurn: 20, gradePickStrength: 1.2 },
    layers: { specular: { on: true, opacity: 0.4, tint: '#fff4e0', shine: 150 }, clouds: { on: true, opacity: 0.85, tint: '#f0f6ff' }, atmosphere: { opacity: 0.8, tint: '#8fc0ff' } }, size: 2048 },
  // (his / the twin, over the lit disc: lightness 67.1 / 66.7, colour strength 14.5 / 14.3, hue 131 / 140 degrees)
  'twin-felucia': { name: "Felucia (twin of his Felucia circle)", recipe: 'living', version: 3, seed: 6061, compare: 'menu:felucia', group: TWINS,
    dials: { land: 0.75, mountains: 0.3, rivers: 0.2, warmth: 0.78, wetness: 0.85, steppe: '#9a9a5a', grass: '#7a9a48', forest: '#3a6a38', jungle: '#2e6a3c', cloudCover: 0.35, cloudScale: 1.1, cloudSwirl: 0.9, cloudStorms: 2, cloudSpots: 0.12, cloudStreaks: 0.4, cloudStreakScale: 1.6, haze: 0.4, gradeStrength: 0.575, gradeLightness: 1.306, gradeWash: 0.163, gradeWashColour: '#9aa890' },
    layers: { specular: { on: true, opacity: 0.4, tint: '#fff4e0', shine: 150 }, clouds: { on: true, opacity: 0.9, tint: '#f0f6ff' }, atmosphere: { opacity: 0.55, tint: '#c0e8c8' } }, size: 2048 },
  // (his / the twin, over the lit disc: lightness 75.5 / 75.5, colour strength 7.5 / 10.1, hue 130 / 133 degrees)
  'twin-dqar': { name: "D'Qar (twin of his D'Qar circle)", recipe: 'living', version: 3, seed: 2828, compare: 'menu:dqar', group: TWINS,
    dials: { land: 0.82, continentSize: 1.2, mountains: 0.3, rivers: 0.2, warmth: 0.62, wetness: 0.75, steppe: '#9aa878', grass: '#7aa060', forest: '#4a7a48', cloudCover: 0.5, cloudScale: 1.1, cloudSwirl: 0.9, cloudSpots: 0.12, cloudStreaks: 0.5, cloudStreakScale: 1.6, haze: 0.3, gradeStrength: 0.597, gradeLightness: 1.303, gradeHue: -4.923, gradeWash: 0.144, gradeWashColour: '#b6bcb1' },
    layers: { specular: { on: true, opacity: 0.4, tint: '#fff4e0', shine: 150 }, clouds: { on: true, opacity: 0.9, tint: '#f0f6ff' }, atmosphere: { opacity: 0.8, tint: '#c8e0c8' } }, size: 2048 },
  // (his / the twin, over the lit disc: lightness 56.5 / 54.8, colour strength 22.4 / 22.2, hue 253 / 262 degrees)
  'twin-takodana': { name: "Takodana (twin of his Takodana circle)", recipe: 'living', version: 3, seed: 2626, compare: 'menu:takodana', group: TWINS,
    dials: { land: 0.4, continentSize: 0.9, mountains: 0.3, rivers: 0.2, spots: 0.8, spotScale: 0.7, spotFray: 0.8, lakes: 0.3, lakeScale: 0.5, warmth: 0.62, wetness: 0.8, deep: '#0e2a5a', shallow: '#1a4a8a', grass: '#3a7a40', forest: '#2a5a30', cloudCover: 0.15, cloudScale: 1.1, cloudSwirl: 0.9, cloudStorms: 2, cloudSpots: 0.3, cloudStreaks: 0.4, cloudStreakScale: 1.6, haze: 0.4, gradeStrength: 0.841, gradeLightness: 1.501, gradeWash: 0.101, gradeWashColour: '#658ca9' },
    layers: { specular: { on: true, opacity: 0.4, tint: '#fff4e0', shine: 150 }, clouds: { on: true, opacity: 0.85, tint: '#f0f6ff' }, atmosphere: { opacity: 0.8, tint: '#8fc0ff' } }, size: 2048 },
  // (wave B, with the planet features under its Scattered air: his / the twin over the lit disc at noon, lightness
  // 66.5 / 64.0, colour strength 13.7 / 12.8, hue 188 / 210 degrees, 5.7 apart (11.3 before): one great cyclone near
  // the middle of the face as his, the rest of the cloud thinner)
  'twin-paintball': { name: "The test world \"Paintball\" (twin of his circle)", recipe: 'living', version: 4, seed: 3030, compare: 'menu:paintball', group: TWINS,
    dials: { land: 0.3, continentSize: 0.5, mountains: 0.3, rivers: 0.2, spots: 0.6, spotScale: 0.8, warmth: 0.62, wetness: 0.65, deep: '#0a4a4a', shallow: '#1a6a60', shelf: '#3a9a80', cloudCover: 0.28, cloudScale: 1.1, cloudSwirl: 1.3, cloudSpots: 0.12, cloudStreaks: 0.6, cloudStreakScale: 1.6, haze: 0.4,
      // (wave B, its critic: the cyclone up off the sea's glint, which lit its clear eye into a bullseye at noon, and its
      // arms looser, a soft swirl as his)
      greatStorm: 0.7, greatStormSize: 1.3, greatStormLat: 20, greatStormLon: -8, greatStormArms: 0.3,
      gradeStrength: 2, gradeLightness: 1.962, gradeWash: 1, gradeWashColour: '#84a9a4' },
    layers: { specular: { on: true, opacity: 0.4, tint: '#fff4e0', shine: 150 }, clouds: { on: true, opacity: 0.9, tint: '#f0f6ff' }, atmosphere: { opacity: 0.8, tint: '#8fc0ff' } }, size: 2048 },
  // (wave B, re-tuned with the planet features under its Scattered air: his / the twin over the lit disc at noon,
  // lightness 81.9 / 77.2, colour strength 6.5 / 4.8, hue 42 / 67 degrees, 5.5 apart (7.4 before): one great cyclone
  // in the upper left as his, brown lines over the land, warmer cloud)
  'twin-ryloth': { name: "Ryloth (twin of his Ryloth circle)", recipe: 'living', version: 4, seed: 7007, compare: 'menu:ryloth', group: TWINS,
    dials: { ...RYLOTH_V3.dials, cloudCover: 0.42, greatStorm: 0.9, greatStormSize: 1.5, greatStormLat: 28, greatStormLon: -35, lines: 0.6, lineColour: '#5a3a20', lineBranch: 0.8, lineWidth: 0.7,
      gradeStrength: 2, gradeLightness: 1.959, gradeWashColour: '#d3cac7' },
    layers: { ...RYLOTH_V3.layers, clouds: { on: true, opacity: 0.9, tint: '#fff6ea' } }, size: 2048 },
  // (wave B, re-tuned with the planet features under its Scattered air: his / the twin over the lit disc at noon,
  // lightness 68.3 / 67.3, colour strength 23.4 / 20.1, hue 242 / 242 degrees, 3.5 apart (11.7 before); land 20% / 16%
  // of the lit disc (7% before): atolls, many tiny islands ringed by turquoise shallows, and shallows along the coasts)
  'twin-scarif': { name: "Scarif (twin of his Scarif circle)", recipe: 'living', version: 4, seed: 1616, compare: 'menu:scarif', group: TWINS,
    // (wave B, its critic: the small islands fewer, 0.15 where they were 1, and the atolls gathered into a few
    // archipelagos, 1, as his shallows are, where islands speckled the whole sea evenly: ΔE 0.7 to 0.3)
    dials: { land: 0.3, continentSize: 0.45, mountains: 0.3, rivers: 0.2, spots: 0.15, spotScale: 0.8, spotSpread: 0.7, spotEdge: 0.3, spotVariety: 1, warmth: 0.62, wetness: 0.65, deep: '#0a50a0', shallow: '#1a90d0', shelf: '#3ae0d0', beach: '#f0f0d0', grass: '#40a060', cloudCover: 0.3, cloudScale: 1.1, cloudSwirl: 0.9, cloudStorms: 2, cloudSpots: 0.12, cloudStreaks: 0.5, cloudStreakScale: 1.6, haze: 0.4,
      atolls: 0.9, atollSize: 0.8, atollIsle: 0.45, atollSpread: 1, atollColour: '#30e0d0', atollIsleColour: '#6a6a40', atollCoast: 0.6,
      gradeStrength: 1.255, gradeLightness: 1.79, gradeWash: 0.263, gradeWashColour: '#7aaec8' },
    layers: { specular: { on: true, opacity: 0.6, tint: '#fff4e0', shine: 150 }, clouds: { on: true, opacity: 0.9, tint: '#f0f6ff' }, atmosphere: { opacity: 0.8, tint: '#8fc0ff' } }, size: 2048 },
  // (his / the twin, over the lit disc: lightness 71.4 / 67.0, colour strength 25.4 / 21.9, hue 265 / 277 degrees)
  // (pass 2, wave 6, its critic J: moved to version 5, a deeper sea, #0a2660 where it was #0a2a70, under soft, hazy cloud (soft
  // edges 0.8, a thin haze 0.5, more of it, 0.72) where it was crisp-edged, its blues picked a little stronger and turned 8 degrees
  // toward his; his / the twin over the lit disc at noon, lightness 70.6 / 70.7, colour strength 25.8 / 23.5, hue 266 / 274 degrees,
  // 4.2 apart (2.1 before, with crisp cloud over an azure sea: his "cannot" item 1). The grade's strength stands at its end (2), so
  // the colour strength his navy asks under the twin's air is the air's to give)
  // (the fixer of wave 6: moved though its mean stands further from his picture than the old version's, because what his item 1
  // named was the pattern, soft hazy cloud over a deep navy sea, which only the new version draws; whether that outweighs the mean
  // is the owner's call: set `version: 3` and the old dials (`TWIN_PAST_DIALS`) back to keep the old twin)
  'twin-kamino': { name: "Kamino (twin of his Kamino circle)", recipe: 'living', version: 5, seed: 3322, compare: 'menu:kamino', group: TWINS,
    // (wave B, its critic: more cloud, 0.6, under a lighter air, so less of the disc is a flat bright sea)
    dials: { land: 0, mountains: 0.3, rivers: 0.2, warmth: 0.62, wetness: 0.65, deep: '#0a2660', shallow: '#14408a', cloudCover: 0.72, cloudSwirl: 1.1, cloudStorms: 4, cloudSpots: 0.15, cloudStreaks: 0.9, cloudStreakScale: 1.6, haze: 0.4, gradeStrength: 2, gradeLightness: 2, gradeContrast: 1.37, gradeWash: 0.675, gradeWashColour: '#8eb2dc',
      cloudSoft: 0.8, cloudHaze: 0.5, gradePickHue: 272, gradePickWidth: 50, gradePickTurn: -8, gradePickStrength: 1.5, gradeHold: 1 },
    layers: { specular: { on: true, opacity: 0.6, tint: '#fff4e0', shine: 150 }, clouds: { on: true, opacity: 0.9, tint: '#e4eeff' }, atmosphere: { opacity: 0.8, tint: '#8fc0ff' } }, size: 2048 },
  // (his / the twin, over the albedo: lightness 35.7 / 35.6, colour strength 30.9 / 30.9, hue 270 / 279 degrees)
  'twin-kamino-map': { name: "Kamino (twin of his Kamino map)", recipe: 'living', version: 3, seed: 3323, compare: 'set:kamino', group: TWINS,
    dials: { land: 0, mountains: 0.3, rivers: 0.2, spots: 1, spotScale: 1.5, spotVariety: 1, warmth: 1, wetness: 0.65, deep: '#1c3e7a', shallow: '#2a5494', cloudCover: 0, cloudSwirl: 1.1, cloudStorms: 4, haze: 0.15, gradeStrength: 0.791, gradeLightness: 1.19, gradeWashColour: '#265685' },
    layers: { specular: { on: true, opacity: 0.6, tint: '#fff4e0', shine: 150 }, clouds: { opacity: 0.9 }, atmosphere: { opacity: 0.5, tint: '#8fc0ff' } }, size: 2048 },
  // (his / the twin, over the lit disc: lightness 60.1 / 52.7, colour strength 12.6 / 12.1, hue 237 / 235 degrees)
  // (wave 6, maker C: moved to version 5, its soft hazy cloud over a darker teal sea and its teal picked stronger; his / the twin
  // over the lit disc at noon, lightness 60.2 / 60.1, colour strength 12.7 / 13.5, hue 237 / 232 degrees, 1.5 apart (13.7 before))
  // (wave 6, its critic J: those numbers were read off his own saved copy of this twin, which he has edited (land 0.48, rivers,
  // storms 8, 4096) and which his page keeps; the table's own look at the maker's dials read a flat pale teal ball, 7.8 apart. Now
  // a darker teal sea, more soft cloud with more storms (0.45 and 4, soft 0.6, a thin haze 0.15), its grade brought back to his
  // mean; the table's look against his picture at noon, lightness 60.2 / 60.3, colour strength 12.7 / 12.8, hue 237 / 243 degrees,
  // 1.2 apart (the base table's 60.4 / 12.6 / 242, 1.0 apart but a flat pale teal ball with its cloud near unseen: his item 2))
  'twin-rori': { name: "Rori from space (twin of his Rori picture)", recipe: 'living', version: 5, seed: 5353, compare: 'set:rori', group: TWINS,
    dials: { land: 0, continentSize: 0.5, mountains: 0.3, rivers: 0.2, warmth: 0.62, wetness: 0.65, deep: '#08303a', shallow: '#0e4250', cloudCover: 0.45, cloudScale: 1.1, cloudSwirl: 0.9, cloudStorms: 4, cloudSpots: 0.1, cloudStreaks: 0.8, cloudStreakScale: 1.6, haze: 0.4, gradeStrength: 0.596, gradeLightness: 1.828, gradeHue: -7.168, gradeWash: 0.74, gradeWashColour: '#7995a3',
      cloudSoft: 0.6, cloudHaze: 0.15, gradePickHue: 200, gradePickWidth: 50, gradePickStrength: 1.8 },
    layers: { specular: { on: true, opacity: 0.6, tint: '#fff4e0', shine: 150 }, clouds: { on: true, opacity: 0.85, tint: '#e0f0ff' }, atmosphere: { opacity: 0.5, tint: '#60c0e0' } }, size: 2048 },
  // (wave B, with the planet features under its Scattered air: his / the twin over the lit disc at noon, lightness
  // 54.7 / 54.4, colour strength 24.2 / 22.0, hue 307 / 307 degrees, 2.2 apart (5.2 before): a lacy purple mottle,
  // fine specks and a few reddish specks)
  'twin-fondor': { name: "Fondor (twin of his Fondor circle)", recipe: 'living', version: 4, seed: 4141, compare: 'menu:fondor', group: TWINS,
    dials: { land: 0.65, continentSize: 0.8, mountains: 0.3, rivers: 0.2, spots: 0.8, spotScale: 0.5, warmth: 0.62, wetness: 0.65, deep: '#2a2050', shallow: '#3a3070', desert: '#7a6a90', steppe: '#7a6090', grass: '#6a5088', forest: '#44306a', jungle: '#44306a', swamp: '#4a3a6a', cityDensity: 0.5, cloudCover: 0.2, cloudSwirl: 0.9, cloudStorms: 2, cloudStreaks: 0.1, haze: 0.4,
      lace: 0.4, laceColour: '#3a2a5a', laceDetail: 0.4, fineSpecks: 0.5, fineSize: 2, specks: 0.1, speckColour: '#ff7050', speckGlow: 0.5,
      gradeStrength: 1.082, gradeLightness: 1.565, gradeWashColour: '#8c7ca4' },
    layers: { specular: { on: true, opacity: 0.4, tint: '#fff4e0', shine: 150 }, night: { on: true, where: 'night' }, clouds: { on: true, opacity: 0.9 }, atmosphere: { opacity: 0.5, tint: '#a890ff' } }, size: 2048 },
  // (his / the twin, over the albedo: lightness 30.1 / 30.1, colour strength 25.9 / 25.9, hue 146 / 139 degrees)
  'twin-athulla': { name: "Athulla (twin of his Athulla map)", recipe: 'living', version: 3, seed: 1212, compare: 'set:athulla', group: TWINS,
    dials: { land: 0.68, continentSize: 0.8, mountains: 0.05, rivers: 0.2, spots: 1, spotScale: 2.4, spotEdge: 0.8, spotVariety: 1, spotFray: 0.6, warmth: 1, tilt: 45, wetness: 0.65, deep: '#1a6a5a', shallow: '#2a8a74', shelf: '#3a9a80', grass: '#3a6a28', forest: '#24481c', jungle: '#20441a', cloudCover: 0.15, cloudSwirl: 0.9, cloudStorms: 2, haze: 0.15, gradeStrength: 0.92, gradeLightness: 0.849, gradeWash: 0.526, gradeWashColour: '#294f30' },
    layers: { specular: { on: true, opacity: 0.4, tint: '#fff4e0', shine: 150 }, clouds: { on: true, opacity: 0.6 }, atmosphere: { opacity: 0.5, tint: '#8fc0ff' } }, size: 2048 },
  // (his / the twin, over the albedo: lightness 21.0 / 21.0, colour strength 9.9 / 9.6, hue 178 / 185 degrees)
  // (pass 2, wave 6, its critic J: moved to version 5, its teal picked stronger and kept in its hue, its grade brought back to his
  // look; against his own look wearing his map on the close-up stage at noon (set:pillio-alive, the like-for-like target for a map),
  // lightness 45.5 / 44.3, colour strength 17.6 / 15.8, hue 278 / 265 degrees, 4.4 apart (5.6 before). The teal his map holds reads
  // only where his look's air lets it; under the twin's the sea's blue still wins)
  'twin-pillio': { name: "Pillio, alive (twin of his map)", recipe: 'living', version: 5, seed: 1313, compare: 'set:pillio-alive', group: TWINS,
    dials: { land: 0.45, mountains: 0.05, rivers: 0.2, spots: 0.3, warmth: 1, tilt: 45, wetness: 0.65, deep: '#0a3040', shallow: '#1a4a5a', desert: '#9a6a38', steppe: '#7a5030', grass: '#4a4a28', forest: '#23361a', cloudCover: 0.1, cloudSwirl: 0.9, cloudStorms: 2, haze: 0.15, gradeStrength: 0.714, gradeLightness: 0.962, gradeWash: 0.231, gradeWashColour: '#2b3532',
      gradePickHue: 190, gradePickWidth: 40, gradePickStrength: 2.5, gradeHold: 1 },
    layers: { specular: { on: true, opacity: 0.4, tint: '#fff4e0', shine: 150 }, clouds: { on: true, opacity: 0.6 }, atmosphere: { opacity: 0.5, tint: '#8fc0ff' } }, size: 2048 },
  // (his / the twin, over the albedo: lightness 34.2 / 34.1, colour strength 17.5 / 15.4, hue 154 / 140 degrees)
  'twin-planet': { name: "The generic green planet (twin of his map)", recipe: 'living', version: 3, seed: 1010, compare: 'gen:planet-01', group: TWINS,
    dials: { land: 0.6, mountains: 0.05, rivers: 0.3, warmth: 1, tilt: 45, wetness: 0.65, deep: '#1a3a30', shallow: '#2a5a44', grass: '#4a7a4a', forest: '#2a5a3a', jungle: '#2a5a3a', cloudCover: 0.25, cloudSwirl: 0.9, cloudStorms: 2, haze: 0.15, gradeStrength: 0.721, gradeLightness: 0.849, gradeWash: 0.428, gradeWashColour: '#395744' },
    layers: { specular: { on: true, opacity: 0.4, tint: '#fff4e0', shine: 150 }, clouds: { on: true, opacity: 0.7 }, atmosphere: { opacity: 0.5, tint: '#8fc0ff' } }, size: 2048 },
  // (his / the twin, over the albedo: lightness 21.9 / 21.9, colour strength 34.3 / 34.3, hue 39 / 39 degrees)
  'twin-vardos': { name: "Vardos, alive (twin of his map)", recipe: 'living', version: 3, seed: 9090, compare: 'set:vardos-alive', group: TWINS,
    dials: { land: 0.85, continentSize: 1.1, mountains: 0.05, rivers: 0.2, warmth: 1, tilt: 60, wetness: 0.65, deep: '#14223a', shallow: '#1c3a5a', beach: '#80604a', desert: '#6a3428', steppe: '#5a281e', grass: '#4a1c18', forest: '#341210', jungle: '#3c1210', swamp: '#341814', tundra: '#6a3428', rock: '#30201c', snow: '#7a4030', cloudCover: 0.1, cloudSwirl: 0.9, cloudStorms: 2, haze: 0.15, gradeStrength: 1.15, gradeLightness: 0.953, gradeWash: 0.251, gradeWashColour: '#5d2116' },
    layers: { specular: { on: true, opacity: 0.4, tint: '#fff4e0', shine: 150 }, clouds: { on: true, opacity: 0.6 }, atmosphere: { opacity: 0.5, tint: '#c89080' } }, size: 2048 },
  // (his / the twin, over the albedo: lightness 16.3 / 16.4, colour strength 19.3 / 19.2, hue 38 / 43 degrees)
  'twin-vardos-dead': { name: "Vardos, dead (twin of his map)", recipe: 'living', version: 3, seed: 9191, compare: 'set:vardos-dead', group: TWINS,
    dials: { land: 0.7, continentSize: 1.1, mountains: 0.3, rivers: 0.2, spots: 0.6, spotVariety: 1, warmth: 1, tilt: 60, wetness: 0.3, deep: '#140c10', shallow: '#24141a', desert: '#5a3020', steppe: '#3a1a10', grass: '#3a1c14', forest: '#2a120c', tundra: '#5a3020', scorched: '#6a3020', rock: '#1a0c08', snow: '#6a3a28', cloudCover: 0.05, cloudSwirl: 0.9, cloudStorms: 2, haze: 0.15, gradeStrength: 0.839, gradeLightness: 0.874, gradeWash: 0.066, gradeWashColour: '#401f18' },
    layers: { specular: { on: true, opacity: 0.4, tint: '#fff4e0', shine: 150 }, clouds: { on: true, opacity: 0.5 }, atmosphere: { opacity: 0.5, tint: '#c08060' } }, size: 2048 },
});
// (the bodies' own versions of a twin: his look's colour controls on the picture carried onto the twin's surface)
Object.assign(PRESETS, {
  // (his / the twin, his look as drawn on the stage: lightness 36.2 / 34.2, colour strength 17.0 / 17.3, hue 227 / 230 degrees)
  'twin-rori-ground': { name: "Rori from the ground (twin of his Kamino map as he wears it)", recipe: 'living', version: 3, seed: 3324, compare: 'rori-ground', group: TWINS,
    // (his look's controls on the twin, then the grade moved toward his look as drawn on the stage, its sea's shine off as his has none)
    dials: { ...PRESETS['twin-kamino-map'].dials, haze: 0.05, gradeStrength: 1.146, gradeLightness: 1.522, gradeContrast: 1, gradeHue: 0, gradeWash: 0.151, gradeWashColour: '#2d5b69' },
    layers: { surface: { tint: '#7fb8a8', hue: -12, sat: 0.9, bright: 0.7 }, clouds: { on: false }, atmosphere: { opacity: 0.35, tint: '#7fe0ff' } }, size: 2048 },
  // (his / the twin, his look as drawn on the stage: lightness 31.4 / 29.6, colour strength 13.6 / 13.0, hue 269 / 270 degrees)
  'twin-nur': { name: "Nur (twin of his Kamino map as he wears it)", recipe: 'living', version: 3, seed: 3325, compare: 'nur', group: TWINS,
    dials: { ...PRESETS['twin-kamino-map'].dials, haze: 0.05, gradeStrength: 1.149, gradeLightness: 1.596, gradeContrast: 1, gradeHue: 0, gradeWash: 0.904, gradeWashColour: '#3c4b5f' },
    layers: { surface: { tint: '#9aabc4', sat: 0.65, bright: 0.7 }, clouds: { on: false }, atmosphere: { opacity: 0.3, tint: '#a8c4e8' } }, size: 2048 },
  // (his / the twin, his look as drawn on the stage: lightness 51.7 / 55.3, colour strength 11.0 / 9.1, hue 314 / 320 degrees)
  'twin-dantooine': { name: "Dantooine (twin of his Ryloth circle as he wears it)", recipe: 'living', version: 3, seed: 7008, compare: 'dantooine', group: TWINS,
    // (wave B: Ryloth's twin was re-tuned with the new features; Dantooine keeps the Ryloth it was made from, RYLOTH_V3)
    dials: { ...RYLOTH_V3.dials, gradeStrength: 1.372, gradeLightness: 0.748, gradeContrast: 1, gradeHue: 0, gradeWash: 0.401, gradeWashColour: '#827889' },
    layers: { ...RYLOTH_V3.layers, surface: { tint: '#dab1fb', hue: -20, sat: 1.05, bright: 0.78, contrast: 1.05 }, clouds: { on: true, opacity: 0.75, tint: '#c4bccc' }, atmosphere: { on: true, form: 'rim', opacity: 0.4, tint: '#e0d4ec' } }, size: 2048 },
  // (his / the twin, his look as drawn on the stage: lightness 44.5 / 46.0, colour strength 63.9 / 62.0, hue 44 / 47 degrees)
  'twin-yavin-prime-map': { name: "Yavin Prime (twin of his Bespin map as he wears it)", recipe: 'gasgiant', version: 2, seed: 4472, compare: 'yavin-prime', group: TWINS,
    dials: { ...PRESETS['twin-bespin-map'].dials },
    layers: { surface: { tint: '#ffd2b8', hue: -8, sat: 1.15, contrast: 1.05 }, atmosphere: { opacity: 0.45, tint: '#ffb080', power: 3.2, height: 1.03 } }, size: 2048, adjust: { glow: '#ff2a10', glowStrength: 0.05, ownSun: { on: true, az: -75, el: 12 }, spin: 1, ambient: 0.02 } },
});
export const TWIN_IDS = Object.keys(PRESETS).filter((id) => id.startsWith('twin-'));
PRESET_ORDER.push(...TWIN_IDS);

// A dial a version has: one marked `since` a later version is left out of the earlier ones.
// (wave B) a dial's version for a recipe: its `sinceFor` that recipe's, else its `since`
export const sinceOf = (d, recipe) => d.sinceFor?.[recipe] ?? d.since;
const inVersion = (version, recipe) => (d) => !(sinceOf(d, recipe) > (+version || 1));
/**
 * Every dial a recipe reads at a version (1 when none is given, as before versions had dials of their
 * own): its own, its lights', its features', the clouds' and the shading's, and from version 2 the
 * cloud flecks' and the colour grade's; from the planet features' version (partsVersion) theirs, last, so
 * every earlier version's list is exactly what it was.
 */
export function dialsOf(recipe, version = 1) {
  const r = RECIPES[recipe] || RECIPES.desert;
  // (wave 6, maker C) and from version 4 (the living world's 5) wave 6's, last: the ring cities and their glint on the recipes
  // that grow cities, soft cloud, soft edges and the colour pick on every recipe (each earlier version's list as it was)
  return [...r.dials, ...(r.lights ? LIGHT_DIALS : []), ...(r.relief > 0 ? FEATURE_DIALS : []), ...CLOUD_DIALS, ...CLOUD_SPOT_DIALS, ...CLOUD_STREAK_DIALS, ...SHADING_DIALS, ...GRADE_DIALS, ...PART_DIALS,
    ...(r.lights ? [...RING_CITY_DIALS, ...CITY_GLINT_DIALS] : []), ...CLOUD_SOFT_DIALS, ...SOFT_DIALS, ...GRADE4_DIALS].filter(inVersion(version, recipe));
}
/** The dials a recipe blended into another reads at a version: its own and its lights'. */
export function mixDialsOf(recipe, version = 1) {
  const r = RECIPES[recipe] || RECIPES.desert;
  return [...r.dials, ...(r.lights ? LIGHT_DIALS : [])].filter(inVersion(version, recipe));
}

/**
 * (Pass 2, wave 6, its fixer) The own dials of each twin moved to a newer recipe version this wave, as they stood before it
 * (1b2a6c6), and the version they stood at: an older-version look of such a twin that lacks a dial is filled, and a dial of it
 * reset, from these and the wave B re-grade, so every older version of the preset stays exactly as it was (the checker's
 * finding: the version 4 tuning reached them; the prints of the same looks stand in `placeholders.js`' `TWIN_PAST_PRINTS`).
 * Numbers and colours alone.
 */
const TWIN_PAST_DIALS = {
  'twin-tatooine': { version: 2, dials: { sandLight: '#ccb698', sandDark: '#8a7278', rock: '#6a5a5e', salt: '#f2ece2', duneScale: 1.6, duneStrength: 0.3, badlands: 0.3, saltFlats: 0.03, variety: 0.85, haze: 0.25, dusty: 0.2, gradeStrength: 0.957, gradeLightness: 1.332, gradeWash: 0.002, gradeWashColour: '#cbb7b1' } },
  'twin-jakku': { version: 2, dials: { sandLight: '#e8c294', sandDark: '#c89a6a', rock: '#8a6a50', salt: '#f0e0c8', duneScale: 1.6, duneStrength: 0.5, badlands: 0.08, saltFlats: 0.04, variety: 0.35, canyons: 0.15, canyonSize: 1.2, canyonColour: '#8a5a3a', haze: 0.25, dusty: 0.2, gradeStrength: 1.328, gradeLightness: 1.162, gradeWash: 1, gradeWashColour: '#ddaf8e' } },
  'twin-geonosis': { version: 2, dials: { sandLight: '#e8a048', sandDark: '#a04018', rock: '#6a2010', salt: '#f0c070', duneScale: 0.9, duneStrength: 0.3, badlands: 0.25, saltFlats: 0.2, variety: 1, haze: 0.2, dusty: 0.15, gradeStrength: 0.984, gradeLightness: 1.222, gradeWashColour: '#d48e5f' } },
  'twin-bespin': { version: 2, dials: { c1: '#f0c080', c2: '#e09850', c3: '#b06028', c4: '#d08040', polar: '#a07050', bands: 24, contrast: 0.45, streaks: 0.6, storms: 0, stormColour: '#f8dcb0', haze: 0.15, limbDark: 0.5, gradeStrength: 1.119, gradeLightness: 1.074, gradeWash: 0.201, gradeWashColour: '#d1895a' } },
  'twin-sullust': { version: 3, dials: { crust: '#141016', ash: '#3a1418', lava: '#ff3020', lavaAmount: 0.25, rivers: 0.5, cracks: 0.7, cloudCover: 0.35, cloudStorms: 0, haze: 0.2, specks: 0.6, speckSize: 0.8, speckColour: '#50e8f0', speckGlow: 0.8, gradeStrength: 1.739, gradeLightness: 1.55, gradeWashColour: '#3c2a33' } },
  'twin-kashyyyk': { version: 3, dials: { land: 0.4, continentSize: 1.1, mountains: 0.3, rivers: 0.2, spots: 0.3, warmth: 0.72, wetness: 0.85, grass: '#5a7a40', forest: '#2e5030', jungle: '#2a5432', cloudCover: 0.3, cloudScale: 1.1, cloudSwirl: 0.9, cloudStorms: 2, cloudSpots: 0.12, cloudStreaks: 0.7, cloudStreakScale: 1.6, haze: 0.4, gradeStrength: 0.561, gradeLightness: 1.955, gradeWash: 0.218, gradeWashColour: '#a3bacb' } },
  'twin-yavin4': { version: 3, dials: { land: 0.45, continentSize: 0.8, mountains: 0.3, rivers: 0.2, spots: 0.4, spotFray: 0.2, warmth: 0.75, wetness: 0.9, grass: '#3a7a60', forest: '#2a6050', jungle: '#2a6050', cloudCover: 0.3, cloudScale: 1.1, cloudSwirl: 0.9, cloudStorms: 2, cloudSpots: 0.1, cloudStreaks: 0.5, cloudStreakScale: 1.6, haze: 0.4, gradeStrength: 1.108, gradeLightness: 2, gradeWash: 0.459, gradeWashColour: '#9ab2d2' } },
  'twin-kamino': { version: 3, dials: { land: 0, mountains: 0.3, rivers: 0.2, warmth: 0.62, wetness: 0.65, deep: '#0a2a70', shallow: '#1a4aa0', cloudCover: 0.6, cloudSwirl: 1.1, cloudStorms: 4, cloudSpots: 0.15, cloudStreaks: 0.9, cloudStreakScale: 1.6, haze: 0.4, gradeStrength: 2, gradeLightness: 1.416, gradeWash: 0.675, gradeWashColour: '#8eb2dc' } },
  'twin-rori': { version: 3, dials: { land: 0, continentSize: 0.5, mountains: 0.3, rivers: 0.2, warmth: 0.62, wetness: 0.65, deep: '#0a3040', shallow: '#104a5a', cloudCover: 0.25, cloudScale: 1.1, cloudSwirl: 0.9, cloudStorms: 2, cloudSpots: 0.1, cloudStreaks: 0.8, cloudStreakScale: 1.6, haze: 0.4, gradeStrength: 0.637, gradeLightness: 2, gradeWash: 0.74, gradeWashColour: '#7995a3' } },
  'twin-pillio': { version: 3, dials: { land: 0.45, mountains: 0.05, rivers: 0.2, spots: 0.3, warmth: 1, tilt: 45, wetness: 0.65, deep: '#0a3040', shallow: '#1a4a5a', desert: '#9a6a38', steppe: '#7a5030', grass: '#4a4a28', forest: '#23361a', cloudCover: 0.1, cloudSwirl: 0.9, cloudStorms: 2, haze: 0.15, gradeStrength: 0.64, gradeLightness: 0.883, gradeWash: 0.231, gradeWashColour: '#2b3532' } },
};

/** The dials of a preset (at its own version, or at `version`): the recipe's starts with the preset's own over them. */
export function presetDials(presetId, version) {
  const p = PRESETS[presetId];
  const v = version ?? (p.version || recipeVersion(p.recipe));
  const out = {};
  for (const d of dialsOf(p.recipe, v)) out[d.k] = d.def;
  // (the fixer of pass 2, wave 6) a twin moved this wave asked at the version it stood at or older: its dials as they were
  const past = version !== undefined && version !== null && TWIN_PAST_DIALS[presetId] && v <= TWIN_PAST_DIALS[presetId].version ? TWIN_PAST_DIALS[presetId] : null;
  // (a preset's dial of a later version is left out: a version 1 look never holds a later one's)
  const later = new Set(dialsOf(p.recipe, 99).map((d) => d.k).filter((k) => !(k in out)));
  for (const [k, val] of Object.entries((past ? past.dials : p.dials) || {})) if (!later.has(k)) out[k] = val;
  // (the atmosphere brief's wave B) a generated twin's grade re-tuned under its Scattered air (airTuned.js), over its own:
  // its look and the reset of each of its dials alike (only dials its version has)
  // (pass 2, wave 6, its critic J) but not over a twin moved to its recipe's newest version: its grade is fitted under its air
  // with that version's parts and stands in its own dials (the re-grade was found for the older version's look, and laid over the
  // new one it put the mean back where the new parts had moved it: Kashyyyk 5.3 apart where its own grade reads 0.6)
  const g = p.group === TWINS && (past || (p.version || 1) < ringsVersion(p.recipe)) ? TWIN_GRADE[presetId] : null;
  if (g) for (const [k, val] of Object.entries(g)) if (k in out) out[k] = val;
  return out;
}

function cleanDials(list, src, base) {
  const dials = {};
  for (const d of list) {
    const v = src?.[d.k];
    const given = v !== null && v !== undefined && v !== '';
    if (d.type === 'color') dials[d.k] = typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : base[d.k];
    else if (d.type === 'select') dials[d.k] = given && d.options.some(([o]) => +o === +v) ? +v : base[d.k];
    else dials[d.k] = given && Number.isFinite(+v) ? Math.min(d.max, Math.max(d.min, +v)) : base[d.k];
  }
  return dials;
}
// a saved version the code knows; none saved means version 1, a newer one than the code has its newest
function versionIn(recipe, v) {
  const known = Object.keys(SURFACES[recipe]).map(Number);
  const n = Math.trunc(+v);
  if (v === undefined || v === null || !Number.isFinite(n)) return 1;
  return known.includes(n) ? n : n > Math.max(...known) ? Math.max(...known) : 1;
}
const firstPresetOf = (recipe) => PRESET_ORDER.find((id) => PRESETS[id].recipe === recipe);

function cleanMix(m) {
  if (!m || typeof m !== 'object' || !RECIPES[m.recipe]) return null;
  const recipe = m.recipe;
  const preset = PRESETS[m.preset]?.recipe === recipe ? m.preset : firstPresetOf(recipe);
  const version = versionIn(recipe, m.version);
  const out = { preset, recipe, version, dials: cleanDials(mixDialsOf(recipe, version), m.dials, presetDials(preset, version)) };
  return Object.assign(out, cleanDials(MIX_DIALS, m, Object.fromEntries(MIX_DIALS.map((d) => [d.k, d.def]))));
}

/** A second recipe to blend in, from a preset (its dials), keeping where and how much from `prev`. */
export function mixFrom(presetId, prev = null, over = {}) {
  const p = PRESETS[presetId];
  if (!p) return null;
  return cleanMix({ ...(prev || {}), preset: presetId, recipe: p.recipe, version: p.version || recipeVersion(p.recipe), dials: { ...presetDials(presetId), ...over } });
}

// (wave B) Whether a look's planet features glow (glowing lines or glow specks, at the version that has them): a recipe
// with no glow of its own then glows where they do, as lava does (the night layer's colour, by day and night or by
// night only). A look without them is what it always was.
const partsGlow = (gen) => (+gen.version || 1) >= partsVersion(gen.recipe)
  && (((+gen.dials?.lines || 0) > 0 && (+gen.dials?.lineGlow || 0) > 0) || ((+gen.dials?.specks || 0) > 0 && (+gen.dials?.speckGlow || 0) > 0));
/** What a look's glow is: molten rock ('lava'), city lights ('lights') or nothing. */
export function glowKind(gen) {
  const k = (r) => (RECIPES[r]?.glow ? (RECIPES[r].lights ? 'lights' : 'lava') : null);
  return gen ? k(gen.recipe) || (gen.mix ? k(gen.mix.recipe) : null) || (partsGlow(gen) ? 'lava' : null) : null;
}
/** Every kind of glow a look has, its own recipe's first: none, one, or both ('lights' and 'lava'). */
export function glowKinds(gen) {
  const k = (r) => (RECIPES[r]?.glow ? (RECIPES[r].lights ? 'lights' : 'lava') : null);
  if (!gen) return [];
  const out = [...new Set([k(gen.recipe), gen.mix ? k(gen.mix.recipe) : null].filter(Boolean))];
  return out.length || !partsGlow(gen) ? out : ['lava'];
}
/** The colour of a look's lava when its lava comes from the blended recipe ("Lava (by day)"), else null. */
export function blendedLavaColour(gen) {
  if (!gen?.mix) return null;
  const r = RECIPES[gen.mix.recipe];
  return r?.glow && !r.lights ? gen.mix.dials?.lava || null : null;
}
/** A gas giant's bands drawn as stacked decks (its Cloud decks dial above 0, on a recipe version that has them). */
export function depthOn(gen) {
  return !!gen && (+gen.dials?.depthLayers || 0) > 0 && !!DEPTH[`${gen.recipe}@${gen.version || 1}`];
}
/**
 * The extra channels a look's bake carries beside its three textures, or null: city lights (r) and
 * lava (g), each its own, when a look has both; the decks' height (b) when it has depth. A look
 * with neither bakes exactly what it always did, with nothing extra.
 */
export function extraChannels(gen) {
  const split = glowKinds(gen).length > 1, depth = depthOn(gen);
  // (wave 6, maker C) and the cities' metal for their glint (a), only at the version that has it: every older look as it was
  const metal = metalOn(gen);
  return split || depth || metal ? (metal ? { split, depth, metal } : { split, depth }) : null;
}
/** (wave 6, maker C) A look's ring cities are on: the version that has them, a recipe that grows cities, its dial above 0. */
export function ringsOn(gen) {
  return !!gen && (+gen.version || 1) >= ringsVersion(gen.recipe) && !!RECIPES[gen.recipe]?.lights && (+gen.dials?.ringCity || 0) > 0;
}
/** (wave 6, maker C) Its ring cities' layout: 0 concentric, 1 gears, 2 hexagonal. */
export function ringLayoutOf(gen) {
  const v = Math.round(+gen?.dials?.ringLayout || 0);
  return v === 1 || v === 2 ? v : 0;
}
/** (wave 6, maker C) Its ring cities are drawn by its own material at every size, not only baked (the Drawn dial). */
export function ringsSharp(gen) {
  return ringsOn(gen) && +gen.dials?.ringSharp === 1;
}
/**
 * (wave 6, maker C) A look carries its cities' metal for their glint (the extra channels' alpha): a whole-planet city at the
 * version that has it (every built-up place is metal), a living world with ring cities (their plates).
 */
export function metalOn(gen) {
  return !!gen && (+gen.version || 1) >= ringsVersion(gen.recipe) && (gen.recipe === 'cityworld' || ringsOn(gen));
}
/** The dials that hold a look's city light colours (its own, or its blended recipe's). */
export function lightDialsOf(gen) {
  if (!gen) return null;
  if (RECIPES[gen.recipe]?.lights) return gen.dials;
  return gen.mix && RECIPES[gen.mix.recipe]?.lights ? gen.mix.dials : null;
}

/** The generated part of a look, made whole and safe (unknown keys dropped, numbers clamped). */
export function cleanGenerated(g) {
  if (!g || typeof g !== 'object') return null;
  const recipe = RECIPES[g.recipe] ? g.recipe : 'desert';
  const preset = PRESETS[g.preset] && PRESETS[g.preset].recipe === recipe ? g.preset : firstPresetOf(recipe);
  // (the version first: a look holds the dials of its own version, and no later one's)
  const version = versionIn(recipe, g.version);
  const dials = cleanDials(dialsOf(recipe, version), g.dials, presetDials(preset, version));
  const size = SIZES.some(([w]) => w === +g.size) ? +g.size : 2048;
  const seed = Number.isFinite(+g.seed) ? Math.abs(Math.trunc(+g.seed)) % 1000000 : 1;
  const out = { recipe, version, preset, seed, dials, size };
  const mix = cleanMix(g.mix);
  if (mix) out.mix = mix;
  // wave 2's parts (a shape, a belt or field, rings): each only when the look has it, so a look
  // without them is cleaned to exactly what it was
  return Object.assign(out, cleanParts(g));
}

/** A preset's parts, at their starts with the preset's dials over them. */
export function presetParts(presetId) {
  const p = PRESETS[presetId];
  const out = {};
  if (p?.shape) out.shape = { ...newPart('shape', p.shape.kind), dials: { ...newPart('shape', p.shape.kind).dials, ...p.shape.dials } };
  if (p?.belt) out.belt = { ...newPart('belt', p.belt.kind), dials: { ...newPart('belt', p.belt.kind).dials, ...p.belt.dials } };
  if (p?.rings) out.rings = { ...newPart('rings', p.rings.style), dials: { ...newPart('rings', p.rings.style).dials, ...p.rings.dials } };
  if (p?.volume) out.volume = { ...newPart('volume', p.volume.kind), dials: { ...newPart('volume', p.volume.kind).dials, ...p.volume.dials } };
  return cleanParts(out);
}

export function randomSeed() {
  return 1 + Math.floor(Math.random() * 999999);
}

/** A starting look (as looks.js's makeLook takes it) for each preset. */
export function presetLook(presetId, extra = {}) {
  const p = PRESETS[presetId];
  const r = RECIPES[p.recipe];
  const layers = {
    surface: { on: true, tex: '', alpha: 'none', lit: true },
    normal: { on: r.relief > 0, tex: '', opacity: 1 },
    specular: { on: false, tex: '', opacity: 0.5, shine: 60 },
    night: { on: false, tex: '', where: 'always' },
    clouds: { on: false, tex: '', source: 'alpha', opacity: 0.95, spin: 1.15, height: 1.002, lit: true },
    atmosphere: { on: true, form: 'rim', tint: '#9cc6ff', opacity: 0.7, power: 3, height: 1.035 },
  };
  for (const [slot, l] of Object.entries(p.layers || {})) layers[slot] = { ...layers[slot], ...l };
  // (wave B) a twin whose grade stood at its range's end under its air: its surface layer's own brightness or colour
  // strength, live over the bake (airTuned.js)
  if (p.group === TWINS && TWIN_SURFACE[presetId]) layers.surface = { ...layers.surface, ...TWIN_SURFACE[presetId] };
  const mix = p.mix ? mixFrom(p.mix.preset, p.mix, p.mix.dials) : null;
  // (the atmosphere brief's wave A) a generated twin is a table default he has never saved, so it takes the air as a
  // new version of itself: Scattered, from its recipe's start (airProfile.js). Every other preset was made before
  // that wave and keeps what it drew (no air: Painted).
  // (wave A's critic) with the air tuned for that twin against his picture (airTuned.js)
  // (wave 6) and a preset made after it that asks for its own air (its `air`, over its recipe's start), likewise
  const air = p.group === TWINS ? { air: { ...airStartFor(p.recipe, presetDials(presetId), { shaped: !!p.shape }), ...(TWIN_AIR[presetId] || {}) } }
    : p.air ? { air: { ...airStartFor(p.recipe, presetDials(presetId), { shaped: !!p.shape }), ...p.air } } : {};
  return {
    ...air,
    name: p.name, group: p.group || 'Generated (a test)', kind: 'sphere', mesh: 'planet_01_mesh',
    // (a space volume's preset is gas alone: its recipe draws nothing, so the note names the gas)
    note: p.volume && !layers.surface.on
      ? 'Generated by our own code: glowing gas drawn as a true volume, with no surface and no picture. Its seed is at the top of this tab and its dials under "Space volume" below.'
      : `Generated by our own code from the "${r.name}" recipe${mix ? ` with the "${RECIPES[mix.recipe].name}" recipe blended in` : ''}: no picture. Its dials and seed are at the top of this tab; every layer's colour controls still apply over it.`,
    generated: { recipe: p.recipe, version: p.version || recipeVersion(p.recipe), preset: presetId, seed: p.seed, dials: presetDials(presetId), size: p.size || 2048, ...(mix ? { mix } : {}), ...presetParts(presetId) },
    layers,
    adjust: { ambient: 0.01, spin: 1.5, ...(p.adjust || {}) },
    ...extra,
  };
}

// ---------------------------------------------------------------------------------------------
// Sampling a baked lat-long texture on a sphere, per pixel from the direction (so the sphere mesh's
// own UVs, which pinch at its poles, are never used). The longitude is taken from whichever of two
// cuts is smooth across the pixel (no seam line where it wraps), and the texture's level of detail
// follows the sphere: across a pixel near a pole the longitude sweeps many texels that all stand for
// the same few metres, so its change is scaled by cos(latitude) and the pole stays as sharp as the
// rest instead of smearing into a blob.

export function sampleLatLong(tex, dirNode) {
  const d = normalize(dirNode);
  const lon = atan(d.x, d.z);
  const lat = atan(d.y, length(vec2(d.x, d.z)));
  const u1 = lon.div(TAU).add(0.5);
  const u2 = fract(u1.add(0.5)).sub(0.5);
  const u = select(fwidth(u1).greaterThan(fwidth(u2).add(0.0001)), u2, u1);
  const v = lat.div(Math.PI).add(0.5);
  const c = max(cos(lat), 0.0005);
  return texture(tex, vec2(u, v)).grad(vec2(dFdx(u).mul(c), dFdx(v)), vec2(dFdy(u).mul(c), dFdy(v)));
}

// ---------------------------------------------------------------------------------------------
// The recipes' surfaces. Each takes the direction (unit vec3) and returns { h (0..1, the height for
// the relief), albedo (sRGB, 0..1), spec (water or ice shine, 0..1), glow (0..1) }. X holds the
// shared numbers: maxF, so (the seed's shift), lat, and the storms' and craters' places.

function desert(dir, D, X) {
  const { maxF, so, slope } = X;
  // two warps: the broad swirl of the land, and a finer one that frays every edge
  const q = warp(dir, 1.0, 0.34, so, maxF).toVar();
  const q2 = warp(q, 3.2, 0.05, so.add(vec3(5, -5, 5)), maxF).toVar();
  // rock plateaus and badlands against the sand basins: crisp, fractal edges (a high-gain sum, cut sharp)
  const geo = fbm9(q2, float(1.1), so.add(vec3(11, 3, 7)), maxF, float(0.6)).toVar();
  const tb = mix(0.3, -0.25, D.badlands);
  // with bare rock on any steep face (escarpments, canyon walls), where sand cannot lie
  const rock = max(sstep(tb.sub(0.008).sub(fwidth(geo)), tb.add(0.008).add(fwidth(geo)), geo), sstep(0.45, 0.9, slope.mul(0.05)).mul(0.85)).toVar();
  const plateau = sstep(tb.add(0.02), tb.add(0.16), geo);
  const qm = warp(dir, 1.2, 0.18, so.add(vec3(-3, 3, 8)), maxF).toVar();
  const mount = ridged9(qm, float(3.0), so.add(vec3(-21, 5, 13)), maxF, float(0.62)).toVar();
  const wrinkle = ridged9(qm, float(11.0), so.add(vec3(4, -21, 9)), maxF, float(0.58)).toVar();
  // sand: pale and ruddy fields with crisp borders, dune seas, salt pans in the lowest basins
  const st = fbm9(q2, float(1.8), so.add(vec3(1, 2, 3)), maxF, float(0.58)).toVar();
  const ruddy = sstep(-0.03, 0.03, st.add(0.06)).mul(D.variety.min(1.0));
  // dark fields of basalt sand (as Mars's dark regions), their edges soft on the downwind side
  const darkN = fbm9(q, float(1.4), so.add(vec3(-13, 5, 2)), maxF, float(0.57)).toVar();
  const dark = sstep(0.07, 0.15, darkN.add(st.mul(0.25))).mul(D.variety.min(1.0)).mul(0.75);
  const pale = sstep(0.0, -0.05, st.add(0.3)).mul(D.variety.min(1.0));
  const ergN = fbm6(q, float(1.3), so.add(vec3(31, -9, 4)), maxF, float(0.55));
  const erg = sstep(-0.12, 0.05, ergN).mul(float(1).sub(rock));
  const basin = fbm9(q2, float(2.4), so.add(vec3(-7, 41, -3)), maxF, float(0.58)).toVar();
  const ts = mix(-0.55, -0.2, D.saltFlats);
  const salt = sstep(ts.add(0.006).add(fwidth(basin)), ts.sub(0.006), basin).mul(float(1).sub(rock)).mul(sstep(0.0, 0.02, D.saltFlats));
  const saltRim = sstep(ts.add(0.05), ts.add(0.006), basin).mul(float(1).sub(rock)).mul(float(1).sub(salt)).mul(sstep(0.0, 0.02, D.saltFlats));
  // dunes: crests drawn by ridged noise squeezed along one axis (so they run across it); one family
  // squeezed along the pole (crests east-west), one along an axis turned by the dial; regions choose
  // (never finer than the texture can hold: the squeezed axis runs at 5 times the frequency)
  const k = min(mix(22.0, 62.0, sstep(2.5, 0.4, D.duneScale)), maxF.mul(0.11));
  const th = D.duneDir.mul(Math.PI / 180);
  const ax = vec3(sin(th), cos(th), 0.0);
  const wob = fbm4(q, float(7.0), so.add(vec3(2, 2, 2)), maxF, float(0.5)).mul(0.8);
  const p1 = vec3(dir.x, dir.y.mul(5.0), dir.z).mul(k).add(so).add(wob);
  const p2 = dir.add(ax.mul(dot(dir, ax).mul(4.0))).mul(k).add(so.add(vec3(7, 7, 7))).add(wob);
  const d1 = pow(float(1).sub(abs(noise3(p1))), 2.5);
  const d2 = pow(float(1).sub(abs(noise3(p2))), 2.5);
  const fam = sstep(-0.12, 0.12, fbm4(q, float(2.0), so.add(vec3(-4, 9, 1)), maxF, float(0.5)));
  const dunes = mix(d1, d2, fam).mul(D.duneStrength).mul(erg).toVar();
  const mottle = fbm6(qm, float(10.0), so.add(vec3(9, 9, 9)), maxF, float(0.62)).toVar();
  const grain = fbm4(qm, float(45.0), so.add(vec3(-9, 3, 9)), maxF, float(0.6));
  const h = float(0.4).add(geo.mul(0.05)).add(rock.mul(0.035)).add(plateau.mul(0.035)).add(mount.mul(rock).mul(0.12))
    .add(wrinkle.mul(rock).mul(0.03)).add(dunes.mul(0.006)).sub(salt.mul(0.006));
  // colour: sand in three casts, dune crests lit and troughs shaded, the rock dark in its folds,
  // its edges and gullies filled with sand, the pans white with a grey rim
  let sand = mix(D.sandLight, D.sandDark, ruddy.mul(0.85));
  sand = mix(sand, mix(D.sandLight, vec3(0.94, 0.9, 0.82), 0.2), pale.mul(0.45));
  sand = mix(sand, mix(D.sandDark, D.rock, 0.55).mul(0.85), dark.mul(sstep(-0.2, 0.3, mottle).mul(0.4).add(0.6)));
  sand = sand.mul(mottle.mul(0.22).add(1.0)).mul(grain.mul(0.08).add(1.0)).mul(dunes.mul(0.16).add(0.92));
  const rockV = mix(D.rock.mul(0.72), D.rock.mul(1.25), sstep(0.2, 0.75, wrinkle)).mul(mottle.mul(0.3).add(1.0));
  const rockCol = mix(sand.mul(0.92), rockV, sstep(0.25, 0.55, wrinkle.mul(0.6).add(plateau.mul(0.5))));
  let col = mix(sand, rockCol, rock);
  col = mix(col, mix(D.salt, D.sandDark, 0.35), saltRim.mul(0.5));
  col = mix(col, D.salt.mul(mottle.mul(0.08).add(0.97)), salt);
  return { h, albedo: col, spec: salt.mul(0.25), glow: float(0) };
}

function ice(dir, D, X) {
  const { maxF, so, slope } = X;
  // a light warp only: an ice sheet's forms are broad and smooth, not swirled
  const q = warp(dir, 1.1, 0.28, so, maxF).toVar();
  const qf = warp(q, 4.5, 0.03, so.add(vec3(3, -6, 1)), maxF).toVar();
  const base = fbm9(qf, float(1.2), so.add(vec3(4, 8, 15)), maxF, float(0.52)).toVar();
  // mountain chains: long belts along the zero lines of a broad field (so they run on as ranges do,
  // instead of standing about as blobs), with ridged crests inside and foothills either side
  const chainN = fbm6(q, float(0.75), so.add(vec3(-16, 23, 42)), maxF, float(0.5)).toVar();
  const cw = mix(0.02, 0.16, D.ridges);
  const mreg = sstep(cw, cw.mul(0.25), abs(chainN)).mul(sstep(0.0, 0.02, D.ridges)).toVar();
  const foot = sstep(cw.mul(2.2), cw.mul(0.6), abs(chainN)).mul(sstep(0.0, 0.02, D.ridges)).toVar();
  const mount = ridged9(qf, float(3.6), so.add(vec3(9, -9, 9)), maxF, float(0.56)).toVar();
  const wrinkle = ridged9(qf, float(13.0), so.add(vec3(-2, 14, 6)), maxF, float(0.6)).toVar();
  const peaks = mount.mul(mreg).toVar();
  const h = float(0.42).add(base.mul(0.1)).add(peaks.mul(0.34)).add(mount.mul(foot).mul(0.08))
    .add(wrinkle.mul(foot).mul(0.05)).add(mount.mul(0.02));
  // rock bared where the ground is steep or the crest sharp (snow will not lie there), in ragged patches
  const grain = fbm6(qf, float(22.0), so.add(vec3(5, 5, -5)), maxF, float(0.62)).toVar();
  const rockT = mix(0.95, 0.3, D.rockShare);
  const rv = slope.mul(0.045).add(peaks.mul(0.55)).add(wrinkle.mul(foot).mul(0.25)).add(grain.mul(0.25)).toVar();
  const rock = sstep(rockT, rockT.add(0.1), rv).toVar();
  const dusted = sstep(rockT.sub(0.15), rockT, rv).mul(float(1).sub(rock));
  // blue ice: smooth wind-scoured plains, mostly in the lee of the ranges
  const tex = fbm6(q, float(5.0), so.add(vec3(1, 1, 9)), maxF, float(0.6)).toVar();
  const tp = mix(-0.32, 0.08, D.plains);
  const plains = sstep(tp.add(0.035), tp.sub(0.035), base.add(tex.mul(0.12))).mul(float(1).sub(mreg.mul(0.7))).mul(sstep(0.0, 0.02, D.plains)).toVar();
  // crevasse fields: the cracked borders of cells, where the ice is stretched near the ranges and plains
  const cq = warp(qf, 5.0, 0.1, so.add(vec3(3, 1, 4)), maxF).mul(34.0).add(so);
  const wv = worley(cq);
  const field = sstep(0.12, 0.35, fbm4(q, float(4.0), so.add(vec3(7, -7, 7)), maxF, float(0.5))).mul(max(plains, foot.mul(0.8)));
  const crev = line(wv.y.sub(wv.x), 0.01).mul(field).mul(D.crevasses).toVar();
  // wind-packed snow: faint streaks running east-west, as sastrugi do
  const streak = noise3(vec3(dir.x, dir.y.mul(6.0), dir.z).mul(min(30.0, maxF.mul(0.1))).add(so).add(wrinkle.mul(0.6)));
  // broad regions of older, greyer firn against fresh snow: the large-scale tone an ice sheet shows
  const firn = sstep(-0.08, 0.22, fbm6(q, float(1.6), so.add(vec3(3, -8, 2)), maxF, float(0.55)));
  let col = D.snow.mul(tex.mul(0.07).add(0.97)).mul(streak.mul(0.025).add(1.0));
  col = mix(col, D.snow.mul(vec3(0.86, 0.89, 0.94)), firn.mul(0.55));
  col = mix(col, D.snow.mul(vec3(0.82, 0.87, 0.94)), sstep(0.0, -0.3, base).mul(0.35));
  col = mix(col, D.ice.mul(tex.mul(0.12).add(1.0)), plains.mul(0.75));
  // rock: dark grey-brown, mottled, its edges dusted with snow
  const rockCol = mix(D.rock.mul(0.75), D.rock.mul(1.3), sstep(-0.25, 0.3, grain)).mul(tex.mul(0.3).add(1.0));
  col = mix(col, mix(col, rockCol, 0.35), dusted);
  col = mix(col, rockCol, rock);
  col = mix(col, D.crevasse, crev.mul(0.3));
  return { h: h.sub(crev.mul(0.004)), albedo: col, spec: plains.mul(0.6).add(0.1).mul(float(1).sub(rock)), glow: float(0) };
}

function volcanic(dir, D, X) {
  const { maxF, so } = X;
  // a light warp: flows and cracks run on in lines, they are not stirred into smears
  const q = warp(dir, 1.2, 0.3, so, maxF).toVar();
  const q2 = warp(q, 4.0, 0.05, so.add(vec3(6, -2, 9)), maxF).toVar();
  const base = fbm9(q2, float(1.4), so.add(vec3(7, 1, 3)), maxF, float(0.56)).toVar();
  const rng2 = ridged9(q2, float(2.8), so.add(vec3(-3, 11, 5)), maxF, float(0.58)).toVar();
  const h0 = float(0.45).add(base.mul(0.16)).add(rng2.mul(0.16)).toVar();
  // provinces of young, hot ground (fresh flows, open vents, cracks) against old cold ones
  const heat = fbm6(q, float(1.5), so.add(vec3(4, 0, -4)), maxF, float(0.5)).toVar();
  const hot = sstep(0.05, 0.35, heat).toVar();
  const low = sstep(0.08, -0.08, base).toVar();
  // lava lakes: few and small, in hot lowlands; a dark skin of plates on them, glowing at the seams
  const lakeN = fbm6(q2, float(3.2), so.add(vec3(-8, 2, 6)), maxF, float(0.55)).add(heat.mul(0.3)).sub(base.mul(0.5)).toVar();
  const lt = mix(0.5, 0.2, D.lavaAmount);
  const lakeOn = sstep(0.0, 0.03, D.lavaAmount);
  const lake = sstep(lt, lt.add(0.008).add(fwidth(lakeN)), lakeN).mul(lakeOn).toVar();
  const shore = sstep(lt.sub(0.035), lt, lakeN).mul(float(1).sub(lake)).mul(lakeOn);
  const wv = worley(q2.mul(40.0).add(so));
  const seam = line(wv.y.sub(wv.x), 0.03);
  // rivers: thin channels along the zero lines of a warped field, flowing in the hot provinces,
  // broken along their length where they have crusted over
  const rq = warp(q2, 3.0, 0.12, so.add(vec3(1, -7, 2)), maxF);
  const rv = fbm6(rq, float(2.2), so.add(vec3(-9, -9, 4)), maxF, float(0.55));
  const broken = sstep(-0.08, 0.15, fbm4(q2, float(9.0), so.add(vec3(2, 7, 7)), maxF, float(0.5)).add(hot.mul(0.15)));
  const riverOn = sstep(0.0, 0.05, D.rivers);
  const river = line(rv, D.rivers.mul(0.006)).mul(broken).mul(hot.mul(0.85).add(0.15)).mul(low.mul(0.5).add(0.5)).mul(riverOn).toVar();
  // feeder creeks, finer and dimmer
  const rv2 = fbm4(rq, float(6.0), so.add(vec3(5, 2, -8)), maxF, float(0.5));
  const creek = line(rv2, D.rivers.mul(0.003)).mul(broken).mul(hot).mul(low).mul(riverOn).mul(0.5);
  // cracks: a fine network of glowing seams over the hot ground (cell borders and noise lines)
  const wv2 = worley(q2.mul(24.0).add(so.add(vec3(3, 3, 3))));
  const patchy = sstep(-0.05, 0.25, fbm4(q2, float(6.0), so.add(vec3(1, 9, 1)), maxF, float(0.5)));
  const crack = line(wv2.y.sub(wv2.x), 0.025).mul(hot).mul(patchy).mul(D.cracks);
  const vein = line(fbm4(q2, float(18.0), so.add(vec3(-6, 4, 11)), maxF, float(0.5)), 0.002).mul(hot.mul(hot)).mul(patchy).mul(D.cracks).mul(0.7);
  const flick = fbm4(q2, float(14.0), so.add(vec3(8, 8, 1)), maxF, float(0.55)).mul(0.6).add(0.75);
  const lakeGlow = lake.mul(seam.mul(0.38).add(0.05)).add(shore.mul(0.7));
  const glow = clamp(max(max(river, creek), max(lakeGlow, max(crack.mul(0.32), vein.mul(0.28)))).mul(flick), 0.0, 1.0).toVar();
  const h = mix(h0, float(0.4), lake).sub(river.mul(0.006));
  // colour: black basalt, grey ash on the old high ground, rust on the old ranges, the young flows
  // darker still; molten rock by day where it glows
  const tex = fbm6(q2, float(7.0), so.add(vec3(2, 9, 2)), maxF, float(0.62)).toVar();
  const ashy = sstep(-0.02, 0.25, base.add(tex.mul(0.35))).mul(float(1).sub(hot.mul(0.7)));
  let col = mix(D.crust, D.ash, ashy).mul(tex.mul(0.4).add(1.0));
  col = mix(col, col.mul(vec3(1.35, 1.0, 0.8)), sstep(0.45, 0.8, rng2).mul(0.45).mul(float(1).sub(hot)));
  col = mix(col, D.crust.mul(0.7), hot.mul(0.45));
  col = mix(col, D.crust.mul(0.5), lake);
  col = mix(col, D.lava, glow.mul(glow));
  return { h, albedo: col, spec: lake.mul(0.3), glow };
}

function terran(dir, D, X) {
  const { maxF, so, lat } = X;
  const { slope } = X;
  const sc = D.islandScale;
  // a moderate warp for the continents' shapes, and a fine one that frays the coasts into bays and capes
  const q = warp(dir, float(1.2).div(sc), 0.38, so, maxF).toVar();
  const qc = warp(q, float(5.0).div(sc), 0.035, so.add(vec3(2, 9, -4)), maxF).toVar();
  const cont = fbm9(qc, float(1.1).div(sc), so.add(vec3(1, 2, 3)), maxF, float(0.56));
  const t = mix(0.42, -0.32, D.land).add(D.land.lessThan(0.005).select(1.0, 0.0));
  const lh = cont.sub(t).toVar();
  const isLand = sstep(fwidth(lh).negate(), fwidth(lh), lh);
  // mountain chains: belts along the zero lines of a broad field, ridged crests within, rising inland
  const chain = sstep(0.14, 0.03, abs(fbm6(q, float(0.9).div(sc), so.add(vec3(-15, 6, 2)), maxF, float(0.5))));
  const mount = ridged9(qc, float(3.4), so.add(vec3(-5, 5, 15)), maxF, float(0.56)).mul(chain.mul(0.85).add(0.15))
    .mul(sstep(0.0, 0.1, lh)).toVar();
  const rq = warp(qc, 4.0, 0.2, so.add(vec3(4, 4, -4)), maxF);
  // rivers: thin lines along the zero lines of a warped field, broken into reaches (a whole zero line is
  // a closed loop, which reads as an outline, not a river) and gone from the high ground
  const reach = sstep(-0.02, 0.18, fbm4(rq, float(2.5), so.add(vec3(6, -2, 3)), maxF, float(0.5)));
  const river = line(fbm6(rq, float(5.0), so.add(vec3(-1, -6, 2)), maxF, float(0.55)), D.rivers.mul(0.004))
    .mul(reach).mul(sstep(0.004, 0.03, lh)).mul(sstep(0.32, 0.12, lh.add(mount.mul(0.3)))).mul(sstep(0.0, 0.05, D.rivers));
  const land = max(lh, 0.0);
  const h = float(0.4).add(land.mul(0.6)).add(mount.mul(0.28)).sub(river.mul(0.01));
  // water: blue to deep with depth, with faint eddies; a shelf of lighter, greener water hugging the
  // coasts, narrow along most of them and broad only over a few banks and reefs
  const depth = max(lh.negate(), 0.0).toVar();
  const eddy = fbm6(q, float(5.0), so.add(vec3(9, 1, 1)), maxF, float(0.5));
  const bank = sstep(0.05, 0.3, fbm4(qc, float(2.5), so.add(vec3(-3, 3, 12)), maxF, float(0.5)));
  const shelfW = bank.mul(0.04).add(0.008);
  let water = mix(D.shallow, D.deep, sstep(0.0, 0.16, depth.add(eddy.mul(0.03))));
  water = water.mul(eddy.mul(0.1).add(1.0));
  water = mix(water, D.shelf, sstep(shelfW, shelfW.mul(0.15), depth).mul(bank.mul(0.45).add(0.4)));
  // land: a climate by latitude (wet at the equator, dry in the subtropics, wet again in the middle
  // latitudes, cold toward the poles), wetter near coasts and drier deep inland, broken up at every scale
  const alat = abs(X.lat);
  const tex = fbm6(qc, float(8.0), so.add(vec3(3, 3, 3)), maxF, float(0.58)).toVar();
  const fine = fbm6(qc, float(30.0), so.add(vec3(-7, 1, 5)), maxF, float(0.62)).toVar();
  const moist = fbm6(q, float(2.0), so.add(vec3(12, -3, 7)), maxF, float(0.52)).mul(0.8)
    .add(cos(alat.mul(7.2)).mul(0.14)).sub(lh.mul(0.5)).add(tex.mul(0.25)).add(D.moisture.sub(0.5).mul(0.7)).toVar();
  let landCol = mix(D.dry, mix(D.dry, D.lowland, 0.5), sstep(-0.32, -0.16, moist));
  landCol = mix(landCol, D.lowland, sstep(-0.18, -0.02, moist));
  landCol = mix(landCol, D.forest, sstep(-0.04, 0.16, moist.add(fine.mul(0.15))));
  // cold: tundra browns toward the poles and up the mountains
  const cold = sstep(0.95, 1.2, alat.add(tex.mul(0.15))).max(sstep(0.12, 0.3, lh.add(mount.mul(0.35))));
  landCol = mix(landCol, D.highland, cold.mul(0.85));
  // bare rock on the ranges' steep sides, darker in their folds
  const steep = sstep(0.35, 0.8, slope.mul(0.06).add(mount.mul(0.5)));
  landCol = mix(landCol, D.highland.mul(0.7), steep.mul(0.6));
  // the fine grain of fields, forests and valleys
  landCol = landCol.mul(fine.mul(0.28).add(1.0)).mul(tex.mul(0.12).add(1.0));
  const snowT = mix(0.9, 0.2, D.snowline);
  landCol = mix(landCol, vec3(0.93, 0.94, 0.95), sstep(snowT, snowT.add(0.08), lh.add(mount.mul(0.45)).add(fine.mul(0.06))).mul(sstep(0.0, 0.05, D.snowline)));
  landCol = mix(landCol, mix(D.beach, landCol, 0.35), sstep(0.0025, 0.0, lh).mul(sstep(0.0, 0.2, tex)).mul(0.7));
  landCol = mix(landCol, mix(D.shallow, D.deep, 0.5), river.mul(0.75));
  let col = mix(water, landCol, isLand);
  // polar ice, on land and sea alike, its edge ragged
  const capLat = mix(1.6, 1.0, D.iceCaps);
  const polar = sstep(capLat.sub(0.008), capLat.add(0.008), abs(lat).add(fbm6(q, float(3.0), so.add(vec3(-2, -2, 9)), maxF, float(0.6)).mul(0.12)).add(fine.mul(0.03)))
    .mul(sstep(0.0, 0.03, D.iceCaps));
  col = mix(col, vec3(0.92, 0.94, 0.96).mul(tex.mul(0.06).add(0.97)), polar);
  const spec = float(1).sub(isLand).add(river.mul(0.6)).mul(float(1).sub(polar));
  return { h, albedo: col, spec: clamp(spec, 0.0, 1.0), glow: float(0) };
}

// The banded gas giant, version 1, as two parts: its colour and the band numbers the colour came from
// (gasgiantCore), and the flat surface it has always made (gasgiant). The depth variant reads the
// same numbers for its decks' heights, so the colour is the same node graph either way.
function gasgiant(dir, D, X) {
  const g = gasgiantCore(dir, D, X);
  return { h: float(0.5), albedo: g.col, spec: float(0), glow: float(0) };
}

// The same colour with the bands as stacked cloud decks: the light zones ride highest and the dark
// belts lowest, each deck flat with a short rise to the next; the great storms tower over their
// bands, the white ovals stand a deck above theirs and the brown ones sink a deck below. Only the
// height changes (the relief and the extra height channel carry it; build.js shades with them).
function gasgiantDepth(dir, D, X, v4 = false) {
  const g = v4 ? gasgiantCore(dir, D, X, true) : gasgiantCore(dir, D, X);
  const n = max(D.depthLayers, 1.0);
  const x = clamp(float(1).sub(g.tt), 0.0, 1.0).mul(n).mul(0.9999);
  const deck = floor(x).add(sstep(0.8, 1.0, fract(x))).div(n).toVar();
  const step = float(1).div(n);
  deck.assign(mix(deck, min(deck.add(step.mul(0.6)), 1.0), sstep(0.0, 1.0, g.oval).mul(0.7)));
  deck.assign(max(deck.sub(sstep(0.0, 1.0, g.barge).mul(step).mul(0.5)), 0.0));
  deck.assign(mix(deck, 1.0, sstep(0.35, 0.9, g.stormMask)));
  return { h: deck.mul(0.9).add(0.05), albedo: g.col, spec: float(0), glow: float(0) };
}

// (wave 6) `v4`: version 4's softer bands and two more colours (its dials `bandSoft`, `moreColours`, `c5`, `c6`); left out, the graph
// is exactly what it was.
function gasgiant4(dir, D, X) {
  const g = gasgiantCore(dir, D, X, true);
  return { h: float(0.5), albedo: g.col, spec: float(0), glow: float(0) };
}
function gasgiantDepth4(dir, D, X) { return gasgiantDepth(dir, D, X, true); }
function gasgiantCore(dir, D, X, v4 = false) {
  const { maxF, so } = X;
  let p = dir;
  // storms: each turns the gas round its centre (a vortex), stronger toward the middle
  const stormMask = float(0).toVar();
  for (let i = 0; i < X.storms.length; i++) {
    const S = X.storms[i];
    const c = S.xyz;
    const rad = max(S.w, 0.00001);
    const d = length(p.sub(c));
    const a = exp(d.div(rad).pow(2).mul(-1.2)).mul(select(c.y.greaterThan(0.0), 1.0, -1.0)).mul(2.2).mul(sstep(0.0, 0.0001, S.w));
    p = turnAbout(p, c, a).toVar();
    // the oval: wider east-west
    const e = normalize(cross(vec3(0, 1, 0), c));
    const nn = cross(c, e);
    const de = dot(p.sub(c), e), dn = dot(p.sub(c), nn);
    const r = sqrt(de.div(rad.mul(1.6)).pow(2).add(dn.div(rad).pow(2)));
    stormMask.assign(max(stormMask, sstep(1.0, 0.55, r).mul(sstep(0.0, 0.0001, S.w))));
  }
  const lat = atan(p.y, length(vec2(p.x, p.z)));
  // the bands: a smooth random function of the latitude, with a regular alternation in it and finer
  // bands within; the steps between them sharpened, as the edges of belts and zones are
  const bandOf = (b) => fbm4(vec3(b.mul(0.55), 0.31, 0.77), float(1.0), so.add(vec3(0, 3, 0)), float(1000), float(0.55)).mul(1.6)
    .add(sin(b.mul(Math.PI)).mul(0.35))
    .add(fbm4(vec3(b.mul(2.4), 1.7, 0.2), float(1.0), so.add(vec3(0, -5, 0)), float(1000), float(0.5)).mul(0.45));
  // belts (the dark bands) are turbulent and the zones calm: the turbulence follows a first, unwaved
  // reading of the bands
  const belt0 = sstep(0.4, 0.7, clamp(bandOf(lat.mul(D.bands).div(Math.PI)).mul(0.9).add(0.5), 0.0, 1.0));
  const rough = belt0.mul(1.1).add(0.45);
  // turbulence: the latitude waved by noise squeezed along the pole, so it streams east-west; the
  // finest waves are curled by a warp of their own, as the eddies along a band's edge are
  const sp = vec3(p.x, p.y.mul(4.0), p.z);
  const w1 = fbm6(sp, float(2.2), so.add(vec3(1, 1, 1)), maxF, float(0.55));
  const cw = warp(vec3(p.x, p.y.mul(3.0), p.z), 6.0, float(0.05).mul(rough), so.add(vec3(2, -6, 2)), maxF).toVar();
  const w2 = fbm6(vec3(cw.x, cw.y.mul(2.2), cw.z), float(7.0), so.add(vec3(5, -3, 2)), maxF, float(0.6));
  const ce = warp(vec3(p.x, p.y.mul(2.0), p.z), 16.0, float(0.025).mul(rough), so.add(vec3(-4, 8, 1)), maxF);
  const w3 = fbm4(ce, float(18.0), so.add(vec3(1, -9, 6)), maxF, float(0.55));
  const latW = lat.add(D.turbulence.mul(w1.mul(0.1).add(w2.mul(0.065).mul(rough)).add(w3.mul(0.02).mul(rough))));
  const bx = latW.mul(D.bands).div(Math.PI);
  const tl = clamp(bandOf(bx).mul(D.contrast).mul(0.9).add(0.5), 0.0, 1.0);
  // (version 4: the steps between bands sharpened less as the bands soften, and the accent's edge widened with them)
  const tt = v4 ? mix(tl, sstep(0.2, 0.8, tl), float(0.55).mul(float(1).sub(D.bandSoft))) : mix(tl, sstep(0.2, 0.8, tl), 0.55);
  let col = mix3(D.c1, D.c2, D.c3, tt);
  const accN = fbm4(vec3(bx.mul(0.9), 2.1, 1.3), float(1.0), so.add(vec3(9, 0, 0)), float(1000), float(0.5));
  const acc = v4 ? sstep(float(0.25).sub(D.bandSoft.mul(0.2)), float(0.6).add(D.bandSoft.mul(0.25)), accN) : sstep(0.25, 0.6, accN);
  col = mix(col, D.c4, acc.mul(0.6));
  if (v4) {
    // two more colours, band by band (a band field of their own, which of the two by a second), softly as the bands are
    const more = fbm4(vec3(bx.mul(0.7), 4.3, -2.1), float(1.0), so.add(vec3(-13, 0, 4)), float(1000), float(0.5));
    const which = sstep(-0.25, 0.25, fbm4(vec3(bx.mul(1.3), -3.7, 5.2), float(1.0), so.add(vec3(6, -11, 2)), float(1000), float(0.5)));
    col = mix(col, mix(D.c5, D.c6, which), sstep(float(0.05).sub(D.bandSoft.mul(0.15)), float(0.3).add(D.bandSoft.mul(0.2)), more).mul(D.moreColours).mul(0.85));
  }
  // each band's colour drifts along its length (no band is the same all the way round)
  const along = fbm4(vec3(p.x, p.y.mul(9.0), p.z), float(2.5), so.add(vec3(-2, 0, 7)), maxF, float(0.5));
  col = col.mul(along.mul(0.22).add(1.0));
  // fine streaks along the flow, curled with it
  const st = fbm6(vec3(cw.x, cw.y.mul(5.0), cw.z), float(10.0), so.add(vec3(-7, 1, 3)), maxF, float(0.62)).toVar();
  col = col.mul(st.mul(D.streaks).mul(0.3).mul(rough).add(1.0));
  // small ovals in chains along the bands: white ones, and a few dark brown ones in the belts
  const ov = worley(vec3(cw.x, cw.y.mul(2.6), cw.z).mul(16.0).add(so));
  const chance = fbm4(vec3(p.x, p.y.mul(6.0), p.z), float(3.0), so.add(vec3(3, 12, -5)), maxF, float(0.5));
  const oval = sstep(0.26, 0.14, ov.x).mul(sstep(0.12, 0.24, chance)).mul(sstep(0.0, 1.0, D.storms)).toVar();
  col = mix(col, D.stormColour.mul(st.mul(0.2).add(1.0)), oval.mul(float(1).sub(belt0.mul(0.4))).mul(0.75));
  const barge = sstep(0.22, 0.12, ov.x).mul(sstep(0.2, 0.3, chance.negate())).mul(belt0).mul(sstep(0.0, 1.0, D.storms));
  col = mix(col, D.c3.mul(0.7), barge.mul(0.6));
  // storms: a darker collar, then the oval, its gas curled into a spiral inside
  const swirlTex = fbm4(vec3(p.x, p.y.mul(3.0), p.z), float(14.0), so.add(vec3(3, 3, -3)), maxF, float(0.6));
  col = mix(col, col.mul(0.8), sstep(0.0, 0.45, stormMask).mul(float(1).sub(sstep(0.45, 0.8, stormMask))).mul(0.6));
  col = mix(col, D.stormColour.mul(swirlTex.mul(0.5).add(st.mul(0.2)).add(0.95)), sstep(0.4, 0.95, stormMask).mul(0.92));
  // hazier poles, mottled with small vortices
  const pm = fbm6(p, float(12.0), so.add(vec3(6, -6, 6)), maxF, float(0.6));
  col = mix(col, D.polar.mul(pm.mul(0.35).add(1.0)), sstep(1.0, 1.35, abs(lat).add(w1.mul(0.08))).mul(0.85));
  return { col, tt, oval, barge, stormMask };
}

function moon(dir, D, X) {
  const { maxF, so } = X;
  const q = warp(dir, 1.0, 0.35, so, maxF).toVar();
  const q2 = warp(q, 3.0, 0.08, so.add(vec3(1, 7, 3)), maxF).toVar();
  // maria: dark flooded plains, their shores sharp and ragged
  const tm = mix(0.3, -0.25, D.maria);
  const mn = fbm9(q2, float(0.8), so.add(vec3(6, 6, 6)), maxF, float(0.58)).toVar();
  const mare = sstep(tm.sub(0.014).sub(fwidth(mn)), tm.add(0.014).add(fwidth(mn)), mn).mul(sstep(0.0, 0.03, D.maria)).toVar();
  const mareDeep = sstep(tm.add(0.02), tm.add(0.15), mn).mul(sstep(0.0, 0.03, D.maria));
  // craters of seven sizes: in each cell of a grid on the sphere, maybe one crater (bowl, rim, apron);
  // the small ones crowd the old highlands and are fewer on the younger maria
  const hc = float(0).toVar();
  const fresh = float(0).toVar();
  const size = D.craterSize;
  for (let k = 0; k < 8; k++) {
    const f = float(2.2 * Math.pow(1.6, k)).div(size);
    const o = so.mul(1 + k * 0.37);
    const res = craterOctave(dir.mul(f).add(o), D.craters.mul(0.5 + k * 0.05), int(k * 7919), o, f, float(k < 3 ? 0.45 : k < 5 ? 0.2 : 0));
    const sub = float(1).sub(mare.mul(k >= 4 ? 0.55 : 0.8));
    hc.addAssign(res.x.div(f).mul(sub).mul(fade(f, maxF)));
    fresh.assign(max(fresh, res.y.mul(fade(f, maxF)).mul(sub)));
  }
  // a few young craters whose rays reach far across the face
  const rays = float(0).toVar();
  for (let i = 0; i < X.craters.length; i++) {
    const S = X.craters[i];
    const c = S.xyz;
    const rad = max(S.w, 0.00001);
    const d = length(dir.sub(c));
    const r = d.div(rad);
    const t = normalize(dir.sub(c.mul(dot(dir, c))).add(vec3(0.00001)));
    const ang = noise3(t.mul(9.0).add(c.mul(31.0))).mul(0.5).add(0.5);
    const ang2 = noise3(t.mul(23.0).add(c.mul(17.0))).mul(0.5).add(0.5);
    const streak = pow(clamp(ang.mul(ang2).mul(2.2), 0.0, 1.0), 3.0);
    const reach = sstep(9.0, 1.2, r).mul(sstep(0.8, 1.3, r));
    rays.assign(max(rays, streak.mul(reach).mul(sstep(0.0, 0.0001, S.w))));
    const prof = craterProfile(r).mul(rad).mul(0.22).mul(sstep(0.0, 0.0001, S.w));
    hc.addAssign(prof);
    fresh.assign(max(fresh, sstep(1.4, 0.9, r).mul(sstep(0.0, 0.0001, S.w))));
  }
  const fine = fbm6(dir, float(4.0), so.add(vec3(1, 4, 1)), maxF, float(0.62)).toVar();
  const speck = fbm4(dir, float(30.0), so.add(vec3(4, 1, 4)), maxF, float(0.6));
  const h = float(0.5).add(hc.mul(12.0)).sub(mare.mul(0.012)).add(fine.mul(0.012));
  // highlands bright and mottled, maria darker (bluer where deepest), fresh craters and their rays bright
  const flows = fbm6(q, float(3.0), so.add(vec3(-6, 2, 8)), maxF, float(0.6));
  let col = mix(D.highland, D.mare, mare.mul(flows.mul(0.3).add(0.75)).add(mareDeep.mul(0.2)).min(1.0));
  // the maria are not flat: their flows show as faint tones and speckle
  col = col.mul(fine.mul(0.16).add(1.0)).mul(speck.mul(mare.mul(0.12).add(0.1)).add(1.0)).mul(flows.mul(mare).mul(0.2).add(1.0));
  col = mix(col, col.mul(vec3(0.95, 0.98, 1.06)), mareDeep.mul(0.6));
  col = mix(col, D.rayColour, clamp(rays.mul(D.rays).add(fresh.mul(0.55)), 0.0, 0.9));
  return { h, albedo: col, spec: float(0), glow: float(0) };
}
const fade = (f, maxF) => clamp(maxF.sub(f).div(maxF.mul(0.4)), 0.0, 1.0);

// A crater's height across its radius (r in radii): a bowl, a raised rim, a fading apron.
const craterProfile = (r, peak = 0) => {
  // the larger craters rebound into a central peak
  const bowl = float(1).sub(r.mul(r)).negate().mul(1.0).add(exp(r.div(0.2).pow(2).negate()).mul(peak)).mul(r.lessThan(1.0).select(1.0, 0.0));
  const rim = exp(r.sub(1.0).div(0.16).pow(2).negate()).mul(0.42);
  const apron = sstep(2.0, 1.0, r).mul(r.greaterThan(1.0).select(1.0, 0.0)).mul(0.12);
  return bowl.add(rim).add(apron);
};

// One size of craters: p is in cells; each cell maybe holds a crater (`density` its chance) of radius
// up to a quarter cell, its centre anywhere in the cell, so only the 8 nearest cells can reach p.
// Returns (height in cells, how fresh and bright the nearest is).
const craterOctave = /*@__PURE__*/ Fn(([p, density, salt, o, R, peak]) => {
  // the 27 cells round p: a crater's centre is moved onto the sphere (so every crater placed is seen
  // whole), and only the points lying within half a cell of the sphere are taken, so no centre moves
  // more than half a cell and every crater reaching p (its apron at most half a cell) is among them;
  // with fewer cells searched, a crater was cut off along a cell's face
  const b = floor(p).sub(1.0).toVar();
  const bx = int(b.x).toVar(), by = int(b.y).toVar(), bz = int(b.z).toVar();
  const hsum = float(0).toVar();
  const bright = float(0).toVar();
  Loop(27, ({ i }) => {
    const a = int(i).div(9), c = int(i).div(3).mod(3), d = int(i).mod(3);
    const h = hashCell(bx.add(a).add(salt), by.add(c), bz.add(d));
    const j = hashFloats(h);
    const h2 = hashFloats(hashCell(bz.add(d), bx.add(a).sub(salt), by.add(c).add(int(17))));
    const rel = b.add(vec3(float(a), float(c), float(d))).add(j).sub(o);
    const dist = max(length(rel), 0.0001);
    const centre = rel.div(dist).mul(R).add(o);
    const rad = mix(0.07, 0.24, h2.x.mul(h2.x));
    const on = h2.y.lessThan(density.mul(1.4)).and(abs(dist.sub(R)).lessThan(0.5)).select(1.0, 0.0);
    const r = length(p.sub(centre)).div(rad);
    // older craters (larger h2.z) are worn shallower; the young ones (h2.z small, below) keep it all
    const worn = float(1).sub(h2.z.mul(0.7));
    hsum.addAssign(craterProfile(r, peak).mul(rad).mul(0.28).mul(on).mul(worn));
    const young = h2.z.lessThan(0.12).select(1.0, 0.0);
    bright.assign(max(bright, sstep(1.35, 0.95, r).mul(on).mul(young.mul(0.8).add(0.12))));
  });
  return vec2(hsum, bright);
}).setLayout({ name: 'genCraters', type: 'vec2', inputs: [{ name: 'p', type: 'vec3' }, { name: 'density', type: 'float' }, { name: 'salt', type: 'int' }, { name: 'o', type: 'vec3' }, { name: 'R', type: 'float' }, { name: 'peak', type: 'float' }] });

// ---------------------------------------------------------------------------------------------
// Wave 1: living worlds, molten and salt worlds, the whole-planet city, features and mixing.

// v turned by a (radians, a JS number) about the pole: a positive turn moves it east
const rotY = (v, a) => vec3(v.x.mul(Math.cos(a)).add(v.z.mul(Math.sin(a))), v.y, v.z.mul(Math.cos(a)).sub(v.x.mul(Math.sin(a))));
// distance to the nearest whole number: a triangle wave, continuous, so lines drawn on it never alias
const tri = (x) => abs(fract(x.add(0.5)).sub(0.5));

// The nearest two of a scatter of sites on the sphere (cities, districts, sinkholes): `k` cells across
// the unit sphere, each cell maybe holding one (`prob` its chance), moved onto the sphere as the
// craters' centres are (prob may be a function of the site's direction, so sites cluster). Returns the distances (in cells), the two sites' directions and the nearest's
// own three numbers.
function nearSites(dir, k, prob, salt) {
  const p = dir.mul(k).toVar();
  const b = floor(p).sub(1.0).toVar();
  const bx = int(b.x).toVar(), by = int(b.y).toVar(), bz = int(b.z).toVar();
  const d1 = float(99).toVar(), d2 = float(99).toVar();
  const c1 = vec3(0, 1, 0).toVar(), c2 = vec3(0, 1, 0).toVar(), h1 = vec3(0).toVar();
  Loop(27, ({ i }) => {
    const a = int(i).div(9), c = int(i).div(3).mod(3), d = int(i).mod(3);
    const j = hashFloats(hashCell(bx.add(a).add(int(salt)), by.add(c), bz.add(d)));
    const j2 = hashFloats(hashCell(bz.add(d).sub(int(salt)), bx.add(a).add(int(911)), by.add(c)));
    const pt = b.add(vec3(float(a), float(c), float(d))).add(j.mul(0.9).add(0.05));
    const len = max(length(pt), 0.0001);
    const cn = pt.div(len);
    const on = j2.x.lessThan(typeof prob === 'function' ? prob(cn) : prob).and(abs(len.sub(k)).lessThan(0.5));
    const dd = length(p.sub(cn.mul(k)));
    const first = on.and(dd.lessThan(d1));
    const second = on.and(dd.lessThan(d2)).and(dd.greaterThanEqual(d1));
    d2.assign(select(first, d1, select(second, dd, d2)));
    c2.assign(select(first, c1, select(second, cn, c2)));
    d1.assign(select(first, dd, d1));
    c1.assign(select(first, cn, c1));
    h1.assign(select(first, j2, h1));
  });
  return { d1, d2, c1, c2, h1 };
}

// A site's own flat frame: (u, v) in cells round it, turned by its own angle.
function siteFrame(dir, S, k) {
  const e = normalize(cross(vec3(0.31, 0.95, 0.0), S.c1));
  const n = cross(S.c1, e);
  const rel = dir.sub(S.c1).mul(k);
  const a = S.h1.y.mul(TAU);
  const u0 = dot(rel, e), v0 = dot(rel, n);
  return { u: u0.mul(cos(a)).sub(v0.mul(sin(a))), v: u0.mul(sin(a)).add(v0.mul(cos(a))) };
}

// One city's shape round its centre (r in the city's radii): ragged roads out (sprawl), streets in a
// square grid (grid), or rings of hexagons with six spokes (the hexagonal web of Vardos).
function cityShape(dir, S, k, rr, pattern, so) {
  const f = siteFrame(dir, S, k);
  const uu = f.u.div(rr), vv = f.v.div(rr);
  const rad = length(vec2(uu, vv));
  const ang = atan(vv, uu);
  const wob = noise3(dir.mul(35.0).add(so)).mul(0.9);
  // (every pattern kept inside the city's own ground and broken by noise: long straight rays out of a
  // centre read as a drawn star from orbit, never as a city)
  const brk = sstep(-0.15, 0.15, noise3(dir.mul(90.0).add(so.mul(0.7))));
  const sprawl = line(rad.mul(sin(ang.mul(3.0).add(S.h1.z.mul(TAU)).add(wob))).div(3.0), 0.03).mul(sstep(0.9, 0.3, rad.add(wob.mul(0.3)))).mul(0.3).mul(brk);
  const gk = S.h1.z.mul(3.0).add(3.5);
  const grid = max(line(tri(uu.mul(gk)), 0.05), line(tri(vv.mul(gk)), 0.05)).mul(sstep(1.0, 0.45, max(abs(uu), abs(vv)).add(wob.mul(0.25))))
    .max(max(line(uu, 0.02), line(vv, 0.02)).mul(sstep(1.3, 0.4, rad)).mul(brk));
  const hd = max(abs(vv), abs(vv).mul(0.5).add(abs(uu).mul(0.8660254)));
  const rings = line(tri(hd.mul(3.0)), 0.04).mul(sstep(1.4, 0.8, hd.add(wob.mul(0.2))));
  const spokes = line(rad.mul(cos(ang.mul(3.0))).div(3.0), 0.02).mul(sstep(1.5, 0.2, rad)).mul(brk);
  const hex = max(rings, spokes);
  return select(pattern.lessThan(0.5), sprawl, select(pattern.lessThan(1.5), grid, hex));
}

// Fine points of light (one jittered point a cell) at about the texture's own fineness.
const lightDots = (dir, X, salt) => sstep(0.45, 0.12, worley(dir.mul(min(150.0, X.maxF.mul(0.85))).add(X.so.mul(1.3)).add(vec3(salt, -salt, salt * 0.5))).x);

// The nearest of one jittered point a cell (as worley's), with that cell's own two numbers in [0, 1):
// (F1, F2 - F1, first number, second number). A patchwork: every cell one patch, its numbers its own.
const worleyCell = /*@__PURE__*/ Fn(([p]) => {
  const pi = floor(p).toVar();
  const f = p.sub(pi).toVar();
  const ix = int(pi.x).toVar(), iy = int(pi.y).toVar(), iz = int(pi.z).toVar();
  const F1 = float(9).toVar(), F2 = float(9).toVar(), id = vec2(0).toVar();
  Loop(27, ({ i }) => {
    const a = int(i).div(9).sub(1), b = int(i).div(3).mod(3).sub(1), d = int(i).mod(3).sub(1);
    const hv = hashFloats(hashCell(ix.add(a), iy.add(b), iz.add(d))).toVar();
    const j = hv.mul(0.85).add(0.075);
    const dd = length(vec3(float(a), float(b), float(d)).add(j).sub(f));
    F2.assign(select(dd.lessThan(F1), F1, min(F2, dd)));
    id.assign(select(dd.lessThan(F1), fract(hv.yz.mul(7.31).add(hv.x.mul(3.17))), id));
    F1.assign(min(F1, dd));
  });
  return vec4(F1, F2.sub(F1), id);
}).setLayout({ name: 'genWorleyCell', type: 'vec4', inputs: [{ name: 'p', type: 'vec3' }] });

// Version 2's spots: land and sea in many small irregular patches, a patchwork of cells each land or sea
// by its own number (so the land dial is the share of patches that are land), warped about half a patch
// so no patch is a polygon, their edges frayed by a finer noise (crisp, or soft and blotted, by
// `spotEdge`); a broad field moves the share of land region by region (`spotSpread`). `tone` is each
// patch's own shift of colour.
function spotField(dir, D, X) {
  const { maxF, so } = X;
  const f = float(24.0).div(D.spotScale);
  const p0 = warp(dir, f.mul(0.3), float(0.55).div(f), so.add(vec3(-29, 17, 41)), maxF);
  const p = warp(p0, f.mul(1.1), float(0.3).div(f), so.add(vec3(19, -41, 3)), maxF).toVar();
  const cell = worleyCell(p.mul(f.mul(0.8)).add(so.mul(0.37))).toVar();
  // the blotches: a rough noise (much of its weight in its finer octaves, so it breaks into flecks of
  // every size rather than winding bands), each cell's own number nudging it up or down so neighbouring
  // blotches part instead of joining into a maze (fading to nothing toward the cell's border, so no
  // cell's outline shows)
  const inside = sstep(0.0, 0.35, cell.y);
  const blot = fbm6(p, f, so.add(vec3(31, -7, 19)), maxF, mix(0.5, 0.72, D.spotEdge));
  const region = fbm4(dir, float(1.4), so.add(vec3(-11, 23, 5)), maxF, float(0.5));
  const n = blot.add(cell.z.sub(0.5).mul(inside).mul(0.3)).add(region.mul(D.spotSpread.mul(0.8)));
  return { n, p, f, tone: cell.w.mul(2.0).sub(1.0).mul(inside.mul(0.6).add(0.4)) };
}

// Version 3's additions to the land's height field (before its sea level is read): the fine fray (a finer
// noise breaking the edges of the patches and coasts again, down to the smallest detail) and the lakes
// (small waters over the land, finer than the patches, even or gathered into districts, each carved a
// little under the sea's level so it takes the shallow water's colour). Both nothing at 0.
function v3Land(lh, dir, D, X, SP) {
  const { maxF, so } = X;
  const ff = SP.f.mul(3.0);
  const fray = fbm6(SP.p, ff, so.add(vec3(-17, 29, -3)), maxF, float(0.66));
  let out = lh.add(fray.mul(D.spotFray.mul(0.32)));
  const lf = float(60.0).div(D.lakeScale);
  const lp = warp(dir, lf.mul(0.35), float(0.45).div(lf), so.add(vec3(23, 5, -37)), maxF);
  const ln = fbm6(lp, lf, so.add(vec3(-5, 43, 11)), maxF, float(0.6))
    .add(fbm4(dir, float(2.2), so.add(vec3(14, -9, 27)), maxF, float(0.5)).mul(D.lakeSpread.mul(0.5)));
  const th = mix(0.42, -0.05, D.lakes);
  const lake = sstep(th, th.add(0.05), ln).mul(sstep(0.0, 0.02, D.lakes));
  out = mix(out, min(out, float(-0.035)), lake);
  return out;
}

function living(dir, D, X) { return livingCore(dir, D, X, false); }
// Version 2: the first with its spots (none at 0, and then its land is the first's), and the colour grade
// the bake lays over every version 2 (kitFor).
function living2(dir, D, X) { return livingCore(dir, D, X, true); }
// Version 3: the second with its fine fray and lakes (v3Land) and, in the cloud pass, cirrus streaks.
function living3(dir, D, X) { return livingCore(dir, D, X, true, true); }

function livingCore(dir, D, X, v2, v3 = false) {
  const { maxF, so, lat, slope } = X;
  const sc = D.continentSize;
  // the continents: a broad warp for their shapes, a fine one fraying the coasts
  const q = warp(dir, float(1.15).div(sc), 0.4, so, maxF).toVar();
  const qc = warp(q, float(4.5).div(sc), 0.04, so.add(vec3(2, 9, -4)), maxF).toVar();
  const cont = fbm9(qc, float(1.0).div(sc), so.add(vec3(1, 2, 3)), maxF, float(0.56)).toVar();
  const t = mix(0.5, -0.5, D.land).add(D.land.lessThan(0.005).select(1.0, 0.0)).sub(D.land.greaterThan(0.995).select(1.0, 0.0));
  // (version 2: the spots over the continents, by how spotted; their edges softened as `spotEdge` says)
  const SP = v2 ? spotField(dir, D, X) : null;
  const lh0 = v2 ? mix(cont.sub(t), SP.n.sub(t), D.spots) : cont.sub(t);
  const lh = (v3 ? v3Land(lh0, dir, D, X, SP) : lh0).toVar();
  const soft = v2 ? fwidth(lh).add(mix(0.05, 0.0, D.spotEdge).mul(D.spots)) : null;
  const isLand = (v2 ? sstep(soft.negate(), soft, lh) : sstep(fwidth(lh).negate(), fwidth(lh), lh)).toVar();
  // the land's broad shape (its first octaves): how far inland a point is, and what lies upwind
  const broad = (pp) => fbm4(pp, float(1.0).div(sc), so.add(vec3(1, 2, 3)), maxF, float(0.56)).sub(t);
  // (among spots every point is near a coast: inland and upwind weigh less the more spotted)
  const spotted = v2 ? float(1).sub(D.spots.mul(0.85)) : null;
  const inland = v2 ? sstep(0.02, 0.3, broad(q)).mul(spotted) : sstep(0.02, 0.3, broad(q));
  const alat = abs(lat);
  // winds: from the east in the tropics, from the west in the middle latitudes, from the east by the poles
  const west = sstep(0.42, 0.6, alat).mul(sstep(1.15, 0.98, alat));
  const upLand = v2 ? sstep(-0.05, 0.25, mix(broad(rotY(q, 0.3)), broad(rotY(q, -0.3)), west)).mul(spotted)
    : sstep(-0.05, 0.25, mix(broad(rotY(q, 0.3)), broad(rotY(q, -0.3)), west));
  // mountain ranges: belts along the zero lines of a broad field, ridged crests within, rising inland
  const chainN = fbm6(q, float(0.9).div(sc), so.add(vec3(-15, 6, 2)), maxF, float(0.5)).toVar();
  const cw = mix(0.03, 0.16, D.mountains);
  const mreg = sstep(cw, cw.mul(0.2), abs(chainN)).mul(sstep(0.0, 0.02, D.mountains)).toVar();
  const mount = ridged9(qc, float(3.4), so.add(vec3(-5, 5, 15)), maxF, float(0.56)).mul(mreg.mul(0.85).add(0.15))
    .mul(sstep(0.0, 0.1, lh)).mul(D.mountains.mul(0.8).add(0.2)).toVar();
  // rivers: thin lines along the zero lines of a warped field, broken into reaches, gone from the heights
  const rq = warp(qc, 4.0, 0.2, so.add(vec3(4, 4, -4)), maxF);
  const reach = sstep(-0.02, 0.18, fbm4(rq, float(2.5), so.add(vec3(6, -2, 3)), maxF, float(0.5)));
  const riverL = line(fbm6(rq, float(5.0), so.add(vec3(-1, -6, 2)), maxF, float(0.55)), D.rivers.mul(0.004))
    .mul(reach).mul(sstep(0.004, 0.03, lh)).mul(sstep(0.35, 0.12, lh.add(mount.mul(0.3)))).mul(sstep(0.0, 0.05, D.rivers));
  const tex = fbm6(qc, float(8.0), so.add(vec3(3, 3, 3)), maxF, float(0.58)).toVar();
  const fine = fbm6(qc, float(30.0), so.add(vec3(-7, 1, 5)), maxF, float(0.62)).toVar();
  const tn = fbm6(q, float(2.5), so.add(vec3(8, -4, 1)), maxF, float(0.55)).toVar();

  // temperature (0 freezing, 1 a warm tropic): by latitude, the tilt spreading the warmth poleward; on
  // a locked world by the angle to its sun; down with height
  const s = sin(alat);
  const base = D.warmth.sub(0.6).mul(3.0).add(1.2);
  const drop = mix(2.8, 1.6, D.tilt.div(60.0));
  const sun = dir.z;
  const Tair = mix(base.sub(drop.mul(s.mul(s).mul(s))), base.sub(0.6).add(sun.mul(2.2)), D.locked).add(tn.mul(0.35)).add(tex.mul(0.12)).toVar();
  const elev = sstep(0.05, 0.7, lh).mul(0.3).add(mount.mul(1.4));
  const T = Tair.sub(elev.mul(1.6)).toVar();
  // wetness: the dial, the wind belts (wet tropics, dry subtropics, wet middle latitudes; on a locked
  // world wettest at the twilight), dry deep inland and behind land upwind, wet behind sea
  const mn = fbm6(q, float(2.0), so.add(vec3(12, -3, 7)), maxF, float(0.52)).toVar();
  const belts = mix(cos(alat.mul(6.0)).mul(0.22), float(0.25).sub(abs(sun).mul(0.6)), D.locked);
  // (the drying inland and behind land weighs less on a wet world: its winds carry rain far inland)
  const inlandDry = float(0.1).sub(upLand.mul(0.35)).sub(inland.mul(0.45)).mul(float(1.2).sub(D.wetness));
  const M0 = D.wetness.sub(0.5).mul(1.3).add(belts).add(inlandDry)
    .add(mn.mul(0.55)).add(tex.mul(0.2)).add(fine.mul(0.06));
  // (version 2: each patch a little wetter or drier than its neighbours, so their greens differ)
  const M = (v2 ? M0.add(SP.tone.mul(D.spotVariety).mul(D.spots).mul(0.45)) : M0).toVar();

  // cities: where people would live (mild, not too dry, on coasts, rivers and flat lowlands)
  const kc = mix(3.0, 8.0, D.cityDensity);
  const S = nearSites(dir, kc, mix(0.3, 0.85, D.cityDensity), 4242);
  const rr = mix(0.12, 0.4, D.citySprawl).mul(S.h1.x.mul(0.9).add(0.55));
  const r = S.d1.div(rr).toVar();
  const habit = sstep(-0.2, 0.15, T).mul(sstep(2.2, 1.6, T)).mul(sstep(-0.75, -0.4, M));
  const river = riverL.mul(sstep(-0.1, 0.1, T)).mul(sstep(-0.5, -0.2, M)).toVar();
  const suit = isLand.mul(habit).mul(max(max(sstep(0.1, 0.0, lh), river.mul(2.0)), sstep(0.3, 0.06, lh.add(mount))).mul(0.75).add(0.25))
    .mul(float(1).sub(mreg.mul(0.6))).mul(sstep(0.0, 0.02, D.cityDensity)).toVar();
  const dots = lightDots(dir, X, 3.0).toVar();
  const fl = fbm4(dir, float(25.0), so.add(vec3(-4, 6, 2)), maxF, float(0.6)).toVar();
  // a city: points of light, dense at its heart and thinning out, its edge ragged, not round
  const field = pow(sstep(1.3, 0.0, r.mul(fl.mul(0.6).add(1.0))), 1.3).add(fl.mul(0.3));
  const lit = dots.mul(sstep(0.25, 0.7, field)).add(sstep(0.85, 1.2, field).mul(0.4));
  // (the pattern only where the city is: its streets, not a frame drawn round empty ground)
  const shape = cityShape(dir, S, kc, rr, D.cityPattern, so).mul(dots.mul(0.6).add(0.4)).mul(0.7).mul(sstep(1.5, 0.7, r));
  // towns: scattered points over all the habitable land, thicker near the cities
  const tq = fbm4(dir, float(9.0), so.add(vec3(11, -2, 6)), maxF, float(0.55));
  const towns = dots.mul(sstep(0.05, 0.3, tq.add(D.cityDensity.mul(0.3)).sub(0.12).add(sstep(3.0, 1.0, r).mul(0.15)))).mul(0.3);
  // roads to the next city along: the great circle between the two nearest, a faint dotted line
  const ln = normalize(cross(S.c1, S.c2).add(vec3(0.00001)));
  const between = dot(cross(S.c1, dir), ln).greaterThan(0.0).and(dot(cross(dir, S.c2), ln).greaterThan(0.0)).select(1.0, 0.0);
  const road = line(dot(dir, ln).mul(kc), 0.008).mul(between).mul(sstep(2.2, 1.2, S.d2)).mul(dots.mul(0.7).add(0.3)).mul(D.citySprawl.mul(0.6).add(0.4));
  const lights = lit.mul(0.75).add(shape.mul(0.8)).add(sstep(0.2, 0.0, r).mul(0.4)).add(towns).mul(suit)
    .add(road.mul(dots).mul(0.22).mul(isLand).mul(habit).mul(sstep(0.0, 0.02, D.cityDensity)));
  const area = sstep(1.2, 0.3, r).mul(suit);

  // the land's colour from its climate: desert, steppe, grassland, forest (jungle where hot), swamp in
  // hot wet lowlands, scorched ground, tundra; bare rock on steep ground
  const hotF = sstep(0.7, 1.35, T);
  let landCol = mix(D.desert, D.steppe, sstep(-0.42, -0.22, M));
  landCol = mix(landCol, D.grass, sstep(-0.16, 0.02, M));
  landCol = mix(landCol, mix(D.forest, D.jungle, hotF), sstep(0.12, 0.3, M.add(fine.mul(0.1))));
  const swamp = sstep(0.42, 0.6, M).mul(sstep(0.12, 0.03, lh)).mul(sstep(0.2, 0.6, T));
  landCol = mix(landCol, D.swamp.mul(fine.mul(0.3).add(1.0)), swamp);
  landCol = mix(landCol, D.scorched.mul(tex.mul(0.25).add(1.0)), sstep(2.0, 2.5, T.sub(M.mul(0.3))));
  landCol = mix(landCol, D.tundra, sstep(0.38, 0.08, T));
  const steep = sstep(0.35, 0.8, slope.mul(0.06).add(mount.mul(0.55)));
  landCol = mix(landCol, D.rock.mul(sstep(-0.2, 0.3, fine).mul(0.4).add(0.8)), steep.mul(0.75));
  landCol = landCol.mul(fine.mul(0.25).add(1.0)).mul(tex.mul(0.12).add(1.0));
  // built-up ground: greyer
  landCol = mix(landCol, vec3(dot(landCol, vec3(0.3, 0.5, 0.2))).mul(0.95), area.mul(0.45));
  // snow and land ice: older greyer firn against fresh snow, wind-scoured blue ice on low smooth ground,
  // crevasses near the ranges, rock where it is too steep for snow
  const snow = sstep(0.02, -0.2, T.add(fine.mul(0.06))).toVar();
  const firn = sstep(-0.1, 0.25, fbm6(q, float(1.6), so.add(vec3(3, -8, 2)), maxF, float(0.55)));
  const streak = noise3(vec3(dir.x, dir.y.mul(6.0), dir.z).mul(min(30.0, maxF.mul(0.1))).add(so).add(fine.mul(0.6)));
  const blue = sstep(0.05, -0.15, tex.add(lh.mul(0.8)).add(mount.mul(0.5)).sub(0.12)).mul(float(1).sub(mreg.mul(0.7)));
  const wv = worley(warp(qc, 5.0, 0.08, so.add(vec3(3, 1, 4)), maxF).mul(26.0).add(so));
  const crev = line(wv.y.sub(wv.x), 0.008).mul(mreg.mul(float(1).sub(sstep(0.3, 0.6, mount)))).mul(sstep(0.1, 0.35, fine.add(tex)));
  const rv = slope.mul(0.045).add(mount.mul(0.7)).add(fine.mul(0.25));
  const bare = sstep(0.55, 0.67, rv);
  const dusted = sstep(0.37, 0.55, rv).mul(float(1).sub(bare));
  let snowCol = D.snow.mul(tex.mul(0.06).add(0.97)).mul(streak.mul(0.03).add(1.0));
  snowCol = mix(snowCol, D.snow.mul(vec3(0.84, 0.88, 0.94)), firn.mul(0.5));
  snowCol = mix(snowCol, D.ice.mul(tex.mul(0.12).add(1.0)), blue.mul(0.7));
  const rockC = D.rock.mul(sstep(-0.25, 0.3, fine).mul(0.5).add(0.75));
  snowCol = mix(snowCol, mix(snowCol, rockC, 0.4), dusted);
  snowCol = mix(snowCol, rockC, bare);
  snowCol = mix(snowCol, D.ice.mul(0.75), crev.mul(0.4));
  landCol = mix(landCol, snowCol, snow);
  // (version 2: with coasts everywhere among spots, beaches only here and there)
  const beachAmt = sstep(0.004, 0.0, lh).mul(sstep(0.0, 0.2, tex)).mul(0.7).mul(float(1).sub(snow));
  landCol = mix(landCol, mix(D.beach, landCol, 0.35), v2 ? beachAmt.mul(float(1).sub(D.spots.mul(0.8))) : beachAmt);
  landCol = mix(landCol, mix(D.shallow, D.deep, 0.5), river.mul(0.75));

  // the sea: blue to deep with depth, faint eddies, a shelf hugging the coasts; frozen where too cold to
  // stay open, as pack ice in floes with dark leads between, broken toward its edge
  // (version 2: the spots' seas are shallow fields, so their depth is read steeper, their shelves
  // narrower, and each patch's water a little lighter or darker than the next)
  const depth = v2 ? max(lh.negate(), 0.0).mul(D.spots.mul(2.0).add(1.0)) : max(lh.negate(), 0.0);
  const eddy = fbm6(q, float(5.0), so.add(vec3(9, 1, 1)), maxF, float(0.5));
  const bank = sstep(0.05, 0.3, fbm4(qc, float(2.5), so.add(vec3(-3, 3, 12)), maxF, float(0.5)));
  const shelfW = bank.mul(0.04).add(0.008);
  let water = mix(D.shallow, D.deep, sstep(0.0, 0.18, depth.add(eddy.mul(0.03))));
  water = water.mul(eddy.mul(0.1).add(1.0));
  if (v2) water = water.mul(SP.tone.mul(D.spotVariety).mul(D.spots).mul(0.15).add(1.0));
  const shelfAmt = sstep(shelfW, shelfW.mul(0.15), depth).mul(bank.mul(0.45).add(0.4));
  water = mix(water, D.shelf, v2 ? shelfAmt.mul(float(1).sub(D.spots.mul(0.5))) : shelfAmt);
  const freeze = sstep(-0.25, -0.55, Tair.add(fine.mul(0.1))).toVar();
  // floes and leads only toward the ice's edge; the pack beyond is closed, its tone in broad patches
  const floes = worley(qc.mul(28.0).add(so.add(vec3(5, 5, 5))));
  const lead = line(floes.y.sub(floes.x), 0.02).mul(sstep(-0.85, -0.4, Tair)).mul(sstep(-0.1, 0.2, tex.add(fine.mul(0.5))));
  let iceCol = D.seaIce.mul(tex.mul(0.1).add(1.0)).mul(sstep(0.1, 0.5, floes.x).mul(0.06).add(0.97));
  iceCol = mix(iceCol, mix(water, D.seaIce, 0.35), lead.mul(0.7));
  water = mix(water, iceCol, freeze);

  const col = mix(water, landCol, isLand);
  // (version 2: spotted land lies low and flat, so the patches' edges cast no cliffs)
  const hl = v2 ? max(lh, 0.0).mul(float(1).sub(D.spots.mul(0.85))) : max(lh, 0.0);
  const h = float(0.4).add(hl.mul(0.55)).add(mount.mul(0.3)).sub(river.mul(0.01)).add(freeze.mul(float(1).sub(isLand)).mul(0.004));
  const spec = float(1).sub(isLand).mul(float(1).sub(freeze.mul(0.85))).add(river.mul(0.6)).add(snow.mul(isLand).mul(0.12));
  // (wave B: `depth`, how far below the sea's level, for the planet features' shallows; read only by them)
  return { h, albedo: col, spec: clamp(spec, 0.0, 1.0), glow: clamp(lights, 0.0, 1.0), water: float(1).sub(isLand).mul(float(1).sub(freeze)), cold: max(snow.mul(isLand), freeze), depth };
}

function molten(dir, D, X) {
  const { maxF, so } = X;
  const q = warp(dir, 1.1, 0.42, so, maxF).toVar();
  const q2 = warp(q, 4.0, 0.06, so.add(vec3(6, -2, 9)), maxF).toVar();
  const base = fbm9(q2, float(1.3), so.add(vec3(7, 1, 3)), maxF, float(0.56)).toVar();
  const rng2 = ridged9(q2, float(2.6), so.add(vec3(-3, 11, 5)), maxF, float(0.58)).toVar();
  // hot lowlands where the crust is thin, cold high ground
  const heatN = fbm6(q, float(1.4), so.add(vec3(4, 0, -4)), maxF, float(0.5)).sub(base.mul(0.6)).toVar();
  const hot = sstep(mix(0.35, -0.3, D.heat), mix(0.55, -0.1, D.heat), heatN).toVar();
  // the ground's rough, scratched grain, torn along the winds (short streaks, not long threads)
  const fq = warp(vec3(q2.x, q2.y.mul(1.8), q2.z), 6.0, 0.1, so.add(vec3(2, 2, -6)), maxF);
  const fibre = fbm6(fq, float(9.0), so.add(vec3(-5, 3, 1)), maxF, float(0.62)).mul(D.fibres.mul(1.2).add(0.2)).toVar();
  const grain = ridged9(q2, float(16.0), so.add(vec3(1, -1, 7)), maxF, float(0.6)).toVar();
  // ash: broad pale shrouds over the cooler ground, the red showing through where they thin
  const ashN = fbm6(q, float(0.9), so.add(vec3(9, -9, 2)), maxF, float(0.55)).add(fibre.mul(0.12)).add(grain.mul(0.08)).sub(hot.mul(0.15));
  const ash = sstep(mix(0.42, -0.2, D.ashCover), mix(0.56, -0.04, D.ashCover), ashN).mul(sstep(0.0, 0.02, D.ashCover)).toVar();
  // smoke: great dark billows rolling off the hot ground
  const sq = warp(q, 2.2, 0.35, so.add(vec3(-8, 6, 3)), maxF);
  const smokeN = fbm6(sq, float(1.7), so.add(vec3(3, 3, 3)), maxF, float(0.62)).add(hot.mul(0.12)).add(fibre.mul(0.05));
  const smoke = sstep(mix(0.4, -0.3, D.smoke), mix(0.6, -0.02, D.smoke), smokeN).mul(sstep(0.0, 0.02, D.smoke)).mul(float(1).sub(ash.mul(0.7))).toVar();
  // where it burns open: a few active fields on the hot ground; its rivers, cracks and pools only there
  const active = sstep(0.1, 0.3, fbm4(q, float(2.4), so.add(vec3(-6, 13, 2)), maxF, float(0.5)).add(heatN.mul(0.3))).mul(hot).toVar();
  const rq = warp(q2, 3.0, 0.12, so.add(vec3(1, -7, 2)), maxF);
  const broken = sstep(-0.1, 0.12, fbm4(q2, float(8.0), so.add(vec3(2, 7, 7)), maxF, float(0.5)));
  const river = line(fbm6(rq, float(2.4), so.add(vec3(-9, -9, 4)), maxF, float(0.55)), D.rivers.mul(0.006)).mul(broken).mul(active).mul(sstep(0.0, 0.05, D.rivers)).toVar();
  // fissures: wandering lines in short broken runs (a cell network of cracks reads as a drawn honeycomb)
  const fz = fbm4(warp(q2, 9.0, 0.03, so.add(vec3(5, 1, -3)), maxF), float(7.0), so.add(vec3(1, 9, 1)), maxF, float(0.5));
  const crack = line(fz, 0.01).mul(active).mul(sstep(0.0, 0.3, fbm4(q2, float(5.0), so.add(vec3(-4, 2, 8)), maxF, float(0.5))));
  const spotN = fbm6(q2, float(3.5), so.add(vec3(-8, 2, 6)), maxF, float(0.55)).add(heatN.mul(0.5));
  const lt = mix(0.55, 0.15, D.lavaAmount);
  const spot = sstep(lt, lt.add(0.1), spotN).mul(active.mul(0.7).add(0.3)).mul(sstep(0.0, 0.03, D.lavaAmount)).toVar();
  // a dim red through the thin crust over all the hot ground; bright only where the rock lies open
  const dim = hot.mul(0.08).mul(grain.mul(0.5).add(0.75)).add(active.mul(0.05));
  const open = max(max(river, crack.mul(0.6)), spot).mul(grain.mul(0.3).add(0.8));
  const glow = clamp(max(dim, open).mul(float(1).sub(ash.mul(0.75))).mul(float(1).sub(smoke.mul(0.8))), 0.0, 1.0).toVar();
  const h = float(0.45).add(base.mul(0.14)).add(rng2.mul(0.12)).add(grain.mul(0.01)).sub(river.mul(0.006)).sub(spot.mul(0.01));
  // deep crimson rock, redder over the hot ground, scratched and grained; pale ash; dark smoke
  let col = mix(D.rock, D.flow, sstep(-0.1, 0.7, hot.mul(0.6).add(fibre.mul(0.7)).add(grain.mul(0.25)))).mul(grain.mul(0.45).add(0.75)).mul(fibre.mul(0.35).add(1.0));
  col = mix(col, D.ash.mul(grain.mul(0.2).add(0.88)).mul(fibre.mul(0.2).add(1.0)), ash.mul(0.9));
  col = mix(col, D.smokeColour.mul(fibre.mul(0.5).add(1.0)), smoke.mul(0.85));
  col = mix(col, D.lava, glow.mul(glow));
  return { h, albedo: col, spec: spot.mul(0.25), glow };
}

function flats(dir, D, X) {
  const { maxF, so, slope } = X;
  const q = warp(dir, 1.0, 0.35, so, maxF).toVar();
  const q2 = warp(q, 4.0, 0.04, so.add(vec3(3, 7, -2)), maxF).toVar();
  const base = fbm9(q2, float(1.2), so.add(vec3(4, 8, 15)), maxF, float(0.54)).toVar();
  const chainN = fbm6(q, float(0.8), so.add(vec3(-16, 23, 42)), maxF, float(0.5));
  const cw = mix(0.02, 0.14, D.ranges);
  const mreg = sstep(cw, cw.mul(0.25), abs(chainN)).mul(sstep(0.0, 0.02, D.ranges)).toVar();
  const mount = ridged9(q2, float(3.6), so.add(vec3(9, -9, 9)), maxF, float(0.56)).mul(mreg).toVar();
  const fine = fbm6(q2, float(24.0), so.add(vec3(5, 5, -5)), maxF, float(0.62)).toVar();
  const tex = fbm6(q, float(6.0), so.add(vec3(1, 1, 9)), maxF, float(0.6)).toVar();
  // the crust lies in the low flats; the ground beneath shows on the rises
  const ct = mix(0.5, -0.5, D.crustCover);
  const cn = base.mul(-0.8).add(tex.mul(0.3)).add(fine.mul(0.05)).sub(mount.mul(0.5));
  const crust = sstep(ct, ct.add(0.05).add(fwidth(cn)), cn).toVar();
  // polygons of the crust, the ground beneath in their seams
  // (fine and faint: polygons a few kilometres across, never a crackle glaze over the whole disc)
  const wv = worley(q2.mul(min(140.0, maxF.mul(0.6))).add(so));
  const cracks = line(wv.y.sub(wv.x), 0.04).mul(D.cracks.mul(0.6)).mul(sstep(-0.1, 0.3, tex.add(fine.mul(0.4)))).toVar();
  // long scrapes and streaks along the winds, few and broken, not an even hatching
  const sk = min(40.0, maxF.mul(0.15));
  const sn = noise3(vec3(dir.x, dir.y.mul(5.0), dir.z).mul(sk).add(so).add(tex.mul(2.5))).mul(0.5).add(0.5);
  const streaks = sstep(0.66, 0.82, sn.add(fbm4(q, float(2.5), so.add(vec3(7, -7, 7)), maxF, float(0.5)).mul(0.6)).sub(0.08)).mul(D.streaks).toVar();
  const rv = slope.mul(0.045).add(mount.mul(0.6)).add(fine.mul(0.2));
  const rock = sstep(0.5, 0.62, rv).toVar();
  const dust = sstep(0.32, 0.5, rv).mul(float(1).sub(rock));
  const fresh = sstep(0.1, 0.4, tex.add(fine.mul(0.3)));
  const underC = D.under.mul(fine.mul(0.3).add(1.0)).mul(tex.mul(0.2).add(1.0));
  const crustC = mix(D.crust.mul(fine.mul(0.05).add(0.98)).mul(tex.mul(0.05).add(1.0)), D.crystal, fresh.mul(0.5));
  let col = mix(underC, crustC, crust);
  col = mix(col, underC.mul(0.9), max(cracks, streaks.mul(0.85)).mul(crust));
  const rockC = D.rock.mul(sstep(-0.25, 0.3, fine).mul(0.5).add(0.75));
  col = mix(col, mix(col, rockC, 0.5), dust);
  col = mix(col, rockC, rock);
  const h = float(0.42).add(base.mul(0.05)).add(mount.mul(0.32)).sub(crust.mul(0.003)).add(fine.mul(0.004));
  return { h, albedo: col, spec: crust.mul(float(1).sub(streaks)).mul(float(1).sub(rock)).mul(D.crystalShine).mul(fresh.mul(0.5).add(0.5)), glow: float(0) };
}

function cityworld(dir, D, X) {
  const { maxF, so, lat } = X;
  const q = warp(dir, 1.2, 0.3, so, maxF).toVar();
  const tone = fbm6(q, float(3.0), so.add(vec3(2, 5, 1)), maxF, float(0.55)).toVar();
  const fine = fbm6(dir, float(40.0), so.add(vec3(-3, 8, 2)), maxF, float(0.6)).toVar();
  // districts, each with its own grid of streets turned its own way, highways along their borders
  const kd = float(7.0).div(D.gridScale);
  const Sd = nearSites(dir, kd, float(0.95), 777);
  const f = siteFrame(dir, Sd, kd);
  const gk = Sd.h1.z.mul(10.0).add(10.0);
  const streets = max(line(tri(f.u.mul(gk)), 0.08), line(tri(f.v.mul(gk)), 0.08)).toVar();
  const avenues = max(line(tri(f.u.mul(gk.div(4.0))), 0.04), line(tri(f.v.mul(gk.div(4.0))), 0.04)).toVar();
  const border = line(Sd.d2.sub(Sd.d1), 0.025).toVar();
  // lanes: great circles of traffic round the world, broken into runs
  const lanes = float(0).toVar();
  for (let i = 0; i < X.lanes.length; i++) {
    const L = X.lanes[i];
    // each lane in runs of a few thousand kilometres, broken where the noise dips
    const run = sstep(0.0, 0.25, noise3(dir.mul(4.0).add(L.xyz.mul(19.0))));
    lanes.assign(max(lanes, line(dot(dir, L.xyz), 0.001).mul(run).mul(sstep(0.0, 0.0001, L.w))));
  }
  // hubs: no bright discs, but the city thickening, its lights and streets denser and brighter toward
  // a centre, its edge torn, broken arcs round it
  const Sh = nearSites(dir, float(3.2), D.hubs.mul(0.8), 313);
  const rh = Sh.d1.div(Sh.h1.x.mul(0.3).add(0.25)).toVar();
  const hubN = fbm4(dir, float(14.0), so.add(vec3(5, -7, 3)), maxF, float(0.6));
  const hubF = sstep(1.3, 0.0, rh.mul(hubN.mul(1.4).add(1.0))).toVar();
  const arcs = line(tri(rh.mul(2.5)), 0.03).mul(sstep(1.5, 0.4, rh)).mul(sstep(-0.05, 0.2, hubN.add(fine.mul(0.3))));
  const darkZ = sstep(0.2, 0.42, tone.negate().add(fine.mul(0.1))).mul(D.dark).toVar();
  const dots = lightDots(dir, X, 7.0).toVar();
  const hubOn = sstep(0.0, 0.02, D.hubs);
  const dens = D.density.mul(tone.mul(0.8).add(0.75)).mul(float(1).sub(darkZ)).add(hubF.mul(0.5).mul(hubOn)).toVar();
  const capLat = mix(1.6, 1.15, D.iceCaps);
  const polar = sstep(capLat.sub(0.01), capLat.add(0.01), abs(lat).add(tone.mul(0.1)).add(fine.mul(0.02))).mul(sstep(0.0, 0.03, D.iceCaps));
  const hub = hubF.mul(dots.mul(0.75).add(avenues.mul(dots.mul(0.6).add(0.4)).mul(0.12))).add(arcs.mul(dots.mul(0.5).add(0.5)).mul(0.15)).mul(hubOn);
  const glow = dots.mul(sstep(0.05, 0.8, dens.add(fine.mul(0.5)))).mul(0.55)
    .add(streets.mul(dens).mul(dots.mul(0.6).add(0.4)).mul(0.1)).add(avenues.mul(dens).mul(dots.mul(0.7).add(0.3)).mul(0.13)).add(border.mul(dots.mul(0.6).add(0.4)).mul(0.12).mul(dens.min(1.0)))
    .add(lanes.mul(D.lanes).mul(dots.mul(0.4).add(0.6)).mul(0.6)).add(hub);
  // by day: a built-up grey-blue, districts lighter and darker, the streets' faint lines
  let col = mix(D.darkTone, D.lightTone, sstep(-0.3, 0.3, tone.add(fine.mul(0.3))));
  col = mix(col, D.base, 0.5).mul(fine.mul(0.2).add(1.0));
  col = col.mul(float(1).sub(streets.mul(0.12))).mul(float(1).sub(avenues.mul(0.1))).mul(float(1).sub(border.mul(0.12)));
  col = mix(col, D.darkTone.mul(0.85), darkZ.mul(0.5));
  col = mix(col, D.lightTone.mul(1.1), hub.mul(0.25));
  col = mix(col, vec3(0.93, 0.94, 0.96), polar);
  const h = float(0.5).add(tone.mul(0.01)).add(fine.mul(0.004)).sub(streets.mul(0.002)).sub(avenues.mul(0.002));
  return { h, albedo: col, spec: float(0.12).mul(float(1).sub(polar)), glow: clamp(glow, 0.0, 1.0).mul(float(1).sub(polar)) };
}

// Features any recipe with relief can use, laid over its surface: crater fields, canyons, sinkholes.
// Only those whose count is above 0 are built into the bake (F says which).
function features(dir, s, D, X, F) {
  const { maxF, so } = X;
  let h = s.h, col = s.albedo;
  const land = float(1).sub(s.water || float(0)).toVar();
  if (F.crater) {
    const t = mix(0.7, -0.7, D.craterField);
    const region = sstep(t, t.add(0.25), fbm4(dir, float(1.6), so.add(vec3(-12, 7, 31)), maxF, float(0.5)).mul(1.6));
    const hc = float(0).toVar(), fresh = float(0).toVar();
    for (let k = 0; k < 4; k++) {
      const f = float(4.0 * Math.pow(1.7, k)).div(D.craterFieldSize);
      const o = so.mul(1 + k * 0.29).add(vec3(3.1 * k, -1.7, 2.3));
      const res = craterOctave(dir.mul(f).add(o), region.mul(0.55 - k * 0.05), int(k * 7919 + 101), o, f, float(k < 2 ? 0.35 : 0));
      hc.addAssign(res.x.div(f).mul(fade(f, maxF)));
      fresh.assign(max(fresh, res.y.mul(fade(f, maxF))));
    }
    h = h.add(hc.mul(10.0).mul(land));
    col = col.mul(clamp(hc.mul(40.0), -0.3, 0.15).mul(land).add(1.0));
    col = mix(col, col.mul(1.2), fresh.mul(0.4).mul(land));
  }
  if (F.canyon) {
    const cs = D.canyonSize;
    const cq = warp(dir, float(2.0).div(cs), 0.22, so.add(vec3(14, -6, 3)), maxF).toVar();
    const n = fbm6(cq, float(1.5).div(cs), so.add(vec3(-2, 19, 7)), maxF, float(0.55)).toVar();
    const t = mix(0.6, -0.6, D.canyons);
    const region = sstep(t, t.add(0.25), fbm4(dir, float(1.3), so.add(vec3(6, 6, -21)), maxF, float(0.5)).mul(1.6));
    const main = line(n, cs.mul(0.004));
    const wall = sstep(cs.mul(0.02), cs.mul(0.004), abs(n));
    const tn = fbm4(warp(cq, 6.0, 0.05, so.add(vec3(1, 2, 3)), maxF), float(5.0).div(cs), so.add(vec3(9, -4, 4)), maxF, float(0.55));
    const trib = line(tn, cs.mul(0.0025)).mul(sstep(0.09, 0.01, abs(n)));
    const cut = max(main, trib.mul(0.75)).mul(region).mul(land).toVar();
    const side = wall.mul(region).mul(land);
    h = h.sub(cut.mul(0.035)).sub(side.mul(0.008));
    col = mix(col, col.mul(0.78), side.mul(0.5));
    col = mix(col, D.canyonColour.mul(tn.mul(0.3).add(1.0)), cut.mul(0.85));
  }
  if (F.sink) {
    // clustered: thick in some regions, none in others (judged at each site, so none is cut in two)
    const sreg = (cn) => D.sinkholes.mul(0.7).mul(sstep(-0.1, 0.25, noise3(cn.mul(2.6).add(so)).add(D.sinkholes.mul(0.3)).sub(0.12)));
    const S = nearSites(dir, float(16.0).div(D.sinkSize), sreg, 2718);
    const r = S.d1.div(mix(0.14, 0.32, S.h1.x)).toVar();
    const inside = sstep(1.0, 0.9, r);
    // a small floor deep in the shaft, a broad shadowed wall round it (a flat green disc reads as a dot)
    const floorM = sstep(0.52, 0.4, r);
    const rim = sstep(1.5, 1.0, r).mul(float(1).sub(inside));
    const g = land.mul(float(1).sub(s.cold || float(0))).mul(sstep(0.0, 0.02, D.sinkholes));
    h = h.add(rim.mul(0.004).mul(g)).sub(inside.mul(0.05).mul(g));
    const fl = fbm4(dir, float(60.0), so.add(vec3(2, -2, 2)), maxF, float(0.6));
    col = mix(col, col.mul(1.06), rim.mul(0.4).mul(g));
    // the walls in shadow: the ground's own colour darkened toward the wall colour (pure dark walls
    // read as black dots from orbit)
    col = mix(col, mix(col.mul(0.62), D.sinkWall, 0.35).mul(fl.mul(0.3).add(1.0)), inside.mul(float(1).sub(floorM)).mul(g));
    col = mix(col, D.sinkFloor.mul(fl.mul(0.35).add(1.0)), floorM.mul(g));
  }
  return { h, albedo: col, spec: s.spec, glow: s.glow, water: s.water, cold: s.cold };
}

// Where a blended recipe shows: in patches of noise, on the high ground, toward the poles or on one
// hemisphere, its edge ragged; `amount` how much, `edge` how sharp.
function blendMask(dir, sA, X, M) {
  const { maxF, so, lat } = X;
  const pq = warp(dir, float(1.2).div(M.scale), 0.35, so.add(vec3(21, -13, 5)), maxF);
  const pn = fbm6(pq, float(1.4).div(M.scale), so.add(vec3(-31, 17, 9)), maxF, float(0.55));
  const jit = fbm6(pq, float(6.0), so.add(vec3(5, 31, -17)), maxF, float(0.6)).mul(0.14);
  const f = select(M.mode.lessThan(0.5), pn.mul(1.6), select(M.mode.lessThan(1.5), sA.h.sub(0.45).mul(4.0),
    select(M.mode.lessThan(2.5), abs(lat).div(Math.PI / 2).mul(2.0).sub(1.0), dir.z.negate()))).add(jit).toVar();
  const thr = mix(1.05, -1.05, M.amount);
  const w = mix(0.3, 0.004, M.edge).add(fwidth(f));
  return sstep(thr.sub(w), thr.add(w), f).mul(sstep(0.0, 0.01, M.amount));
}

// ---------------------------------------------------------------------------------------------
// (wave 6, maker C) Ring cities. Where they stand is worked out here in JS from the seed and the dials (ringSitesOf, pure: the
// same look gives the same cities on every machine), and handed to the card as arrays of numbers; what each point of the globe
// shows is one function of those numbers (ringLayer), run by the bake into the look's pictures and, when the look draws them
// sharp, by the look's own material at every pixel it draws (build.js), so the lines are as fine from orbit as the screen is.

/** At most this many ring sites (great hubs and their satellites) and trunk lines a look. */
export const MAX_RING_SITES = 80, MAX_RING_TRUNKS = 64;
const RING_TURN = new THREE.Vector3(0.31, 0.95, 0.07);
// a direction moved `ang` radians from `a` toward the side at `phi` round it (on the unit sphere)
function awayFrom(a, phi, ang, out = new THREE.Vector3()) {
  const e = new THREE.Vector3().crossVectors(RING_TURN, a).normalize();
  const n = new THREE.Vector3().crossVectors(a, e);
  const t = e.multiplyScalar(Math.cos(phi)).add(n.multiplyScalar(Math.sin(phi)));
  return out.copy(a).multiplyScalar(Math.cos(ang)).add(t.multiplyScalar(Math.sin(ang))).normalize();
}
const angleOf = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
/**
 * Where a look's ring cities stand (pure, from its seed and dials; none unless its ring cities are on): `sites` each
 * [x, y, z, chord radius] (the centre on the unit sphere and the radius as a chord), `meta` each [rings, spokes, turn, kind]
 * (kind 0 a great hub, 1 a satellite), `trunks` each [px, py, pz, cos half arc] (the pole of the great circle the line runs
 * along, and how far either side of its middle it runs) with `mids` each [x, y, z, width share] (its middle).
 */
export function ringSitesOf(gen) {
  const out = { sites: [], meta: [], trunks: [], mids: [] };
  if (!ringsOn(gen)) return out;
  const d = gen.dials;
  // its own generator, so nothing else of the look moves when its cities do
  const r = rng((gen.seed | 0) * 104729 + 71);
  const nh = Math.max(1, Math.min(16, Math.round(+d.ringHubs || 1)));
  const base = Math.max(2, Math.min(30, +d.ringHubSize || 8)) * Math.PI / 180;
  const placed = []; // { c, R }
  const fits = (c, R) => placed.every((p) => angleOf(c, p.c) > (R + p.R) * 1.12);
  // the great hubs: within 72 degrees of the equator, apart from each other
  for (let tries = 0; placed.length < nh && tries < 400; tries++) {
    const c = onSphere(r(), r(), -1.25, 1.25);
    const R = base * (0.6 + 0.8 * r());
    if (fits(c, R)) placed.push({ c, R, hub: true, k: Math.max(2, Math.round((+d.ringRings || 4) * (0.8 + 0.4 * r()))), s: Math.round((+d.ringSpokes || 0) * (0.7 + 0.6 * r())), a: r() * TAU });
  }
  const hubs = placed.slice();
  // their satellites: smaller rings a little beyond each hub's rim, each linked to its hub
  const sats = [];
  const ns = Math.max(0, Math.min(4, Math.round(+d.ringSatellites || 0)));
  for (const h of hubs) {
    const want = Math.round(ns * (0.5 + r()));
    for (let i = 0, tries = 0; i < want && tries < 24 && placed.length < MAX_RING_SITES; tries++) {
      const R = h.R * (0.2 + 0.25 * r());
      const c = awayFrom(h.c, r() * TAU, h.R * (1.3 + 0.7 * r()) + R);
      if (!fits(c, R)) continue;
      const s = { c, R, hub: false, k: Math.max(2, Math.round((+d.ringRings || 4) * 0.6)), s: Math.round((+d.ringSpokes || 0) * 0.5), a: r() * TAU, of: h };
      placed.push(s); sats.push(s); i++;
    }
  }
  for (const p of placed) {
    out.sites.push([p.c.x, p.c.y, p.c.z, 2 * Math.sin(p.R / 2)]);
    out.meta.push([p.k, p.s, p.a, p.hub ? 0 : 1]);
  }
  // the trunk lines: the hubs joined by their shortest links (a spanning tree, its shortest share by the dial), a few more toward 1,
  // and each satellite to its hub; each from rim to rim along the great circle through the two centres
  const tr = Math.max(0, Math.min(1, +d.ringTrunks || 0));
  if (tr > 0) {
    const edges = [];
    const inTree = [0];
    while (inTree.length < hubs.length) {
      let best = null;
      for (const i of inTree) for (let j = 0; j < hubs.length; j++) {
        if (inTree.includes(j)) continue;
        const a = angleOf(hubs[i].c, hubs[j].c);
        if (!best || a < best.a) best = { i, j, a };
      }
      inTree.push(best.j);
      edges.push(best);
    }
    edges.sort((x, y) => x.a - y.a);
    const links = edges.slice(0, Math.round(tr * edges.length)).map((e) => [hubs[e.i], hubs[e.j], 1]);
    // toward 1, each hub also to its nearest hub it is not yet linked to
    if (tr > 0.5) for (const h of hubs) {
      if (r() > (tr - 0.5) * 2) continue;
      let best = null;
      for (const o of hubs) {
        if (o === h || links.some(([a, b]) => (a === h && b === o) || (a === o && b === h))) continue;
        const a = angleOf(h.c, o.c);
        if (!best || a < best.a) best = { o, a };
      }
      if (best && best.a < Math.PI * 0.6) links.push([h, best.o, 1]);
    }
    for (const s of sats) links.push([s.of, s, 0.6]);
    for (const [a, b, w] of links) {
      if (out.trunks.length >= MAX_RING_TRUNKS) break;
      const ab = angleOf(a.c, b.c);
      if (ab < 1e-4) continue;
      const pole = new THREE.Vector3().crossVectors(a.c, b.c).normalize();
      // from a's rim to b's rim: the points a little inside each rim along the circle
      const start = a.c.clone().multiplyScalar(Math.cos(a.R * 0.95)).add(new THREE.Vector3().crossVectors(pole, a.c).multiplyScalar(Math.sin(a.R * 0.95))).normalize();
      const end = b.c.clone().multiplyScalar(Math.cos(b.R * 0.95)).add(new THREE.Vector3().crossVectors(b.c, pole).multiplyScalar(Math.sin(b.R * 0.95))).normalize();
      const half = angleOf(start, end) / 2;
      if (!(half > 1e-4) || a.R * 0.95 + b.R * 0.95 >= ab) continue;
      const mid = start.clone().add(end).normalize();
      out.trunks.push([pole.x, pole.y, pole.z, Math.cos(half)]);
      out.mids.push([mid.x, mid.y, mid.z, w]);
    }
  }
  return out;
}

/** The card's arrays a ring cities' function reads (one set for the bake, one a look's pictures for its material). */
export function ringUniforms() {
  return {
    sites: uniformArray(Array.from({ length: MAX_RING_SITES }, () => new THREE.Vector4(0, 1, 0, 0.0001)), 'vec4'),
    meta: uniformArray(Array.from({ length: MAX_RING_SITES }, () => new THREE.Vector4()), 'vec4'),
    trunks: uniformArray(Array.from({ length: MAX_RING_TRUNKS }, () => new THREE.Vector4(0, 1, 0, 2)), 'vec4'),
    mids: uniformArray(Array.from({ length: MAX_RING_TRUNKS }, () => new THREE.Vector4(0, 1, 0, 0)), 'vec4'),
    // x sites, y trunks, z layout, w the ring cities' strength
    counts: uniform(new THREE.Vector4()),
    // x width, y plate brightness, z glow along the rings, w glow between
    look: uniform(new THREE.Vector4()),
    // the plates' colour (sRGB), w whether the rings are baked into the pictures (0: the material draws them)
    plate: uniform(new THREE.Vector4(0.76, 0.74, 0.8, 1)),
  };
}
const _rc = new THREE.Color();
/** A look's ring cities written into one such set of arrays (at a bake: never in a frame). */
export function writeRings(RU, gen, { baked = true } = {}) {
  const S = ringSitesOf(gen);
  const d = gen?.dials || {};
  for (let i = 0; i < MAX_RING_SITES; i++) {
    const s = S.sites[i], m = S.meta[i];
    if (s) { RU.sites.array[i].set(s[0], s[1], s[2], s[3]); RU.meta.array[i].set(m[0], m[1], m[2], m[3]); } else { RU.sites.array[i].set(0, 1, 0, 0.0001); RU.meta.array[i].set(0, 0, 0, 0); }
  }
  for (let i = 0; i < MAX_RING_TRUNKS; i++) {
    const t = S.trunks[i], m = S.mids[i];
    if (t) { RU.trunks.array[i].set(t[0], t[1], t[2], t[3]); RU.mids.array[i].set(m[0], m[1], m[2], m[3]); } else { RU.trunks.array[i].set(0, 1, 0, 2); RU.mids.array[i].set(0, 1, 0, 0); }
  }
  RU.counts.value.set(S.sites.length, S.trunks.length, +d.ringLayout || 0, ringsOn(gen) ? Math.max(0, Math.min(1, +d.ringCity || 0)) : 0);
  RU.look.value.set(+d.ringWidth || 0, +d.ringPlates || 0, +d.ringGlow || 0, +d.ringFill || 0);
  _rc.setStyle(typeof d.ringPlateColour === 'string' ? d.ringPlateColour : '#c2bccb', THREE.NoColorSpace);
  RU.plate.value.set(_rc.r, _rc.g, _rc.b, baked ? 1 : 0);
}

// a line `w` wide (in the same units as `n`) drawn with its coverage kept when it is thinner than a pixel or a texel: a line a
// tenth of a pixel wide reads a tenth as strong, not a whole pixel (the ring cities are seen from a few pixels to a screen across)
const aaLine = (n, w) => {
  const fw = fwidth(n).add(0.000001);
  return float(1).sub(sstep(w.mul(0.5), w.mul(0.5).add(fw), abs(n))).mul(min(float(1), w.div(fw)));
};
// the distance from a point to the nearest of `S` spokes through the middle (in the same units as `rad`), with no seam where the
// angle wraps (|sin| of S half-turns is the same either side)
const spokeDist = (rad, ang, S) => rad.mul(abs(sin(ang.mul(S).mul(0.5)))).mul(2.0).div(max(S, 1.0));
const cellHash = (a, b, c) => hashFloats(hashCell(int(floor(a)), int(floor(b)), int(floor(c))));

/**
 * What the ring cities make of one point of the globe (`dir`, a unit vector in the body's frame), from the arrays `RU`:
 * `plate` (the metal plates' cover, 0..1), `tone` (each plate's own brightness, 0..1), `seam` (the darker lines between plates by
 * day), `lines` (the rings, spokes and trunk lines alight at night), `inside` (the cities' own ground), `tilt` (each plate's own
 * three numbers, for its glint). `layout` (0 concentric, 1 gears, 2 hexagonal) is the look's own, chosen when the graph is made, so a
 * program holds one layout's arithmetic alone (a kit and a material a layout: the Layout dial bakes and builds anew).
 */
export function ringLayer(dir, RU, layout = 0) {
  const best = float(9).toVar(), bi = int(0).toVar();
  // the site whose own radius holds this point nearest its middle (ringSitesOf keeps sites apart, so one site a point)
  Loop({ start: int(0), end: int(RU.counts.x), type: 'int', condition: '<' }, ({ i }) => {
    const s = RU.sites.element(i);
    const rr = length(dir.sub(s.xyz)).div(s.w);
    bi.assign(select(rr.lessThan(best), i, bi));
    best.assign(min(best, rr));
  });
  const s = RU.sites.element(bi).toVar(), m = RU.meta.element(bi).toVar();
  const c = s.xyz;
  const e = normalize(cross(vec3(0.31, 0.95, 0.07), c)), nn = cross(c, e);
  const rel = dir.sub(c).div(s.w);
  const u0 = dot(rel, e), v0 = dot(rel, nn);
  const ca = cos(m.z), sa = sin(m.z);
  const u = u0.mul(ca).sub(v0.mul(sa)).toVar(), v = u0.mul(sa).add(v0.mul(ca)).toVar();
  const rad = length(vec2(u, v)).toVar();
  const ang = atan(v, u).toVar();
  const K = max(m.x, 1.0), S = m.y;
  const kk = K.add(0.6);
  const id = float(bi).add(0.5);
  // the lines' width in the site's radii (a satellite's a little wider for its size, so it still reads)
  const W = RU.look.x.mul(0.05).add(0.012).mul(m.w.mul(0.5).add(1.0)).toVar();
  const disc = float(1).sub(sstep(1.0, float(1.0).add(fwidth(rad)).add(0.002), rad)).toVar();
  const t = rad.mul(kk).toVar();
  const spokesOn = step(0.5, S);
  const ringIx = floor(t.sub(0.6));
  let plate, tone, lines, seam, tilt;
  if (layout === 1) {
    // rings broken into arcs like gears: each band between two rings a run of arcs with gaps, the rim toothed
    const f = fract(t.sub(0.6));
    const bandD = abs(f.sub(0.5)).div(kk);
    const band = aaLine(bandD, float(0.62).div(kk)).mul(step(0.6, t));
    const hb = cellHash(id.mul(53.0), ringIx.add(5.0), float(7.0)).toVar();
    const arcsN = floor(hb.x.mul(5.0).add(3.0));
    const q = fract(ang.div(TAU)).mul(arcsN).add(hb.y);
    const gap = hb.z.mul(0.2).add(0.12);
    const qf = fract(q);
    const qw = fwidth(q).add(0.00001);
    const arcOn = sstep(float(1).sub(gap), float(1).sub(gap).sub(qw.mul(1.5)), qf).mul(sstep(0.0, qw.mul(1.5), qf));
    const teeth = step(abs(ringIx.sub(K.sub(1.0))), 0.5).mul(sstep(0.3, 0.2, tri(fract(ang.div(TAU)).mul(floor(K.mul(6.0).add(18.0)))))).mul(sstep(0.0, 0.06, f.sub(0.75))).mul(sstep(0.36, 0.3, f.sub(0.75)));
    const rings1 = max(aaLine(bandD.sub(float(0.31).div(kk)), W.mul(0.6)), aaLine(bandD, W.mul(0.5))).mul(band.max(teeth)).mul(arcOn.mul(0.85).add(0.15));
    const spokes1 = aaLine(spokeDist(rad, ang, floor(S.mul(0.5))), W.mul(1.4)).mul(sstep(0.45, 0.6, t)).mul(step(1.5, S)).mul(sstep(K.mul(0.75).add(0.6), K.mul(0.6).add(0.6), t));
    plate = max(band.mul(arcOn), teeth);
    tone = hb.w;
    lines = max(rings1, spokes1);
    seam = max(rings1.mul(0.6), aaLine(bandD.sub(float(0.31).div(kk)), W.mul(0.4)));
    tilt = hb;
  } else if (layout === 2) {
    // rings of hexagonal plates: a hexagonal lattice in the site's plane, cells about a ring wide, the outer ones thinning out
    const hp = vec2(u, v).mul(kk.mul(1.05));
    const sz = vec2(1.0, Math.sqrt(3));
    const ga = mod(hp, sz).sub(sz.mul(0.5)), gb = mod(hp.sub(sz.mul(0.5)), sz).sub(sz.mul(0.5));
    const g = select(dot(ga, ga).lessThan(dot(gb, gb)), ga, gb).toVar();
    const cid = hp.sub(g);
    const hx = max(dot(abs(g), vec2(0.5, Math.sqrt(3) / 2)), abs(g).x);
    const edgeD = float(0.5).sub(hx).div(kk.mul(1.05));
    const cellR = length(cid).div(kk.mul(1.05));
    const hh = cellHash(cid.x.mul(2.0).add(id.mul(131.0)), cid.y.mul(2.0).add(3.0), id.add(11.0)).toVar();
    const ringOfCell = floor(length(cid).add(0.5));
    const rings2 = aaLine(edgeD, W.mul(0.5)).mul(step(cellR, 1.02)).mul(mix(0.35, 1.0, step(0.5, fract(ringOfCell.mul(0.5)))));
    const spokes2 = aaLine(spokeDist(rad, ang, float(6.0)), W.mul(0.7)).mul(spokesOn).mul(sstep(0.3, 0.45, t));
    plate = step(cellR, 0.97).mul(step(cellR.mul(0.35).add(0.06), hh.y));
    tone = hh.x;
    lines = max(rings2, spokes2);
    seam = lines;
    tilt = hh;
  } else {
    // concentric rings crossed by spokes, the plates the cells between, a few left out
    const rings0 = aaLine(tri(t.sub(0.6)).div(kk), W).mul(step(0.1, t));
    const spokes0 = aaLine(spokeDist(rad, ang, S), W.mul(0.8)).mul(sstep(0.45, 0.6, t)).mul(spokesOn);
    const sector = floor(fract(ang.div(TAU)).mul(max(S, 1.0)));
    const hc0 = cellHash(id.mul(97.0), ringIx.add(17.0), sector.add(31.0)).toVar();
    // finer seams inside the plates: thirds of a ring, and a radial cut between the spokes (fine detail for a near view)
    const sub0 = max(aaLine(tri(t.mul(3.0)).div(kk.mul(3.0)), W.mul(0.3)), aaLine(spokeDist(rad, ang, max(S, 4.0).mul(3.0)), W.mul(0.25)).mul(sstep(0.6, 1.2, t))).mul(0.5);
    plate = step(0.12, hc0.y);
    tone = hc0.x;
    lines = max(rings0, spokes0);
    seam = max(lines, sub0);
    tilt = hc0;
  }
  plate = plate.mul(disc);
  lines = lines.mul(disc).toVar();
  seam = seam.mul(disc);
  // the trunk lines: arcs of great circles, from rim to rim, not drawn over a city's own ground; the loop keeps only the nearest
  // line's distance (in its own width's share), the line drawn once after it
  const near = float(9).toVar();
  Loop({ start: int(0), end: int(RU.counts.y), type: 'int', condition: '<' }, ({ i }) => {
    const tr = RU.trunks.element(i), md = RU.mids.element(i);
    const d = abs(dot(dir, tr.xyz)).div(max(md.w, 0.05));
    near.assign(select(dot(dir, md.xyz).greaterThanEqual(tr.w), min(near, d), near));
  });
  const TW = RU.look.x.mul(0.0035).add(0.0009);
  const outside = float(1).sub(disc);
  const trunks = aaLine(near, TW).mul(outside);
  const all = max(lines, trunks);
  return { plate, tone, seam, lines: all, inside: disc, tilt, trunks };
}

// The soft edges' taps (wave 6): a Vogel disc of 12, its points' offsets in the disc's radius
const SOFT_TAPS = Array.from({ length: 12 }, (_, k) => { const rr = Math.sqrt((k + 0.5) / 12), a = k * 2.39996323; return [rr * Math.cos(a), rr * Math.sin(a)]; });

// Version 4's grade (wave 6): version 2's, then one hue range turned and made stronger alone, and a colour that leaves what a
// screen can show eased back toward grey in its own hue (toward 1 of the hold) where it was clipped. At its starts (the hold 0,
// the turn 0, the strength 1) it is version 2's.
function grade4(srgb, D) {
  const lab = toOklab(srgb).toVar();
  const wash = toOklab(D.gradeWashColour);
  const L = float(0.5).add(lab.x.mul(D.gradeLightness).sub(0.5).mul(D.gradeContrast)).toVar();
  // the picked range, by the colour's own hue before any turn (a soft bump of the picked width round the picked hue)
  const h = atan(lab.z, lab.y).mul(180 / Math.PI);
  const dh = abs(mod(h.sub(D.gradePickHue).add(540.0), 360.0).sub(180.0));
  const pick = sstep(D.gradePickWidth, D.gradePickWidth.mul(0.4), dh).mul(sstep(0.0, 0.02, length(lab.yz)));
  const ang = D.gradeHue.add(D.gradePickTurn.mul(pick)).mul(Math.PI / 180);
  const ca = cos(ang), sa = sin(ang);
  const a0 = lab.y.mul(ca).sub(lab.z.mul(sa)), b0 = lab.y.mul(sa).add(lab.z.mul(ca));
  const ab = mix(vec2(a0, b0), wash.yz, D.gradeWash).mul(D.gradeStrength).mul(mix(float(1), D.gradePickStrength, pick)).toVar();
  const toRGB = (c) => { const lms = OK_LMS_.mul(vec3(L, c.x, c.y)); return OK_RGB.mul(lms.mul(lms).mul(lms)); };
  // the hold: the largest share of the colour that stays on the screen, found by halving (eight steps), and used where asked
  const lo = float(0).toVar(), hi = float(1).toVar();
  for (let k = 0; k < 8; k++) {
    const mid = lo.add(hi).mul(0.5);
    const cm = toRGB(ab.mul(mid));
    const inside = step(-0.0005, min(min(cm.x, cm.y), cm.z)).mul(step(max(max(cm.x, cm.y), cm.z), 1.0005));
    lo.assign(select(inside.greaterThan(0.5), mid, lo));
    hi.assign(select(inside.greaterThan(0.5), hi, mid));
  }
  const keep = mix(float(1), lo, D.gradeHold);
  return toSRGB(clamp(toRGB(ab.mul(keep)), 0.0, 1.0));
}

// Version 4's clouds (wave 6): version 3's (or 2's), their edges softened and crisp erosion eased by `cloudSoft`, and a thin haze
// of cloud over everything, thicker where the masses gather, by `cloudHaze`. Both nothing at 0.
function clouds4(dir, D, X) {
  const c = clouds3(dir, D, X, D.cloudSoft);
  const { maxF, so } = X;
  const broad = fbm4(dir, float(1.6), so.add(vec3(-23, 41, 7)), maxF, float(0.5));
  const haze = D.cloudHaze.mul(sstep(-0.35, 0.45, broad).mul(0.35).add(0.4)).mul(sstep(0.0, 0.01, D.cloudHaze));
  return { cover: clamp(max(c.cover, haze), 0.0, 1.0), bright: mix(c.bright, float(0.9), haze.mul(float(1).sub(c.cover))) };
}

// Each recipe's code by version: a look keeps the version it was saved with, so improving a recipe
// means adding its next version here, never changing one a look may use.
// Version 2 (21 November) of every recipe is its first's ground under the colour grade and with the
// cloud flecks (kitFor lays both on any version 2); the living world's also has its spots.
// (wave B) The planet features' version (partsVersion: 3, the living world's 4) is the version before's ground with
// the features laid over it (planetParts, in kitFor) and, in the cloud pass, the great cyclone.
// (wave 6, maker C) Version 4 (the living world's 5) is the version before's ground with wave 6's parts laid on in the kit (ring
// cities, soft edges, the colour pick, soft cloud) and, for the gas giant, its softer bands and two more colours.
const SURFACES = {
  desert: { 1: desert, 2: desert, 3: desert, 4: desert }, ice: { 1: ice, 2: ice, 3: ice, 4: ice }, volcanic: { 1: volcanic, 2: volcanic, 3: volcanic, 4: volcanic }, terran: { 1: terran, 2: terran, 3: terran, 4: terran },
  gasgiant: { 1: gasgiant, 2: gasgiant, 3: gasgiant, 4: gasgiant4 }, moon: { 1: moon, 2: moon, 3: moon, 4: moon },
  living: { 1: living, 2: living2, 3: living3, 4: living3, 5: living3 }, molten: { 1: molten, 2: molten, 3: molten, 4: molten }, flats: { 1: flats, 2: flats, 3: flats, 4: flats }, cityworld: { 1: cityworld, 2: cityworld, 3: cityworld, 4: cityworld },
};
// A recipe version's variant with depth (its decks), used only while its depth dial is above 0.
const DEPTH = { 'gasgiant@1': gasgiantDepth, 'gasgiant@2': gasgiantDepth, 'gasgiant@3': gasgiantDepth, 'gasgiant@4': gasgiantDepth4 };

// ---------------------------------------------------------------------------------------------
// (wave B) The planet features (PART_DIALS), laid over a recipe's ground after its features and blend. F says which
// are on; each part not on adds nothing to the bake. Every part keeps the ground's own water and shine where it
// leaves the ground alone; the atolls' islands are dry land.
const DEG = Math.PI / 180;
// a direction from latitude and longitude in degrees (the same frame as the bake's: longitude 0 toward +z)
const dirOfDeg = (la, lo) => vec3(cos(la.mul(DEG)).mul(sin(lo.mul(DEG))), sin(la.mul(DEG)), cos(la.mul(DEG)).mul(cos(lo.mul(DEG))));
// a unit frame round a direction (any direction, the poles included)
const frameOf = (c) => { const e = normalize(cross(vec3(0.31, 0.95, 0.07), c)); return { e, n: cross(c, e) }; };

function planetParts(dir, s, D, X, F) {
  const { maxF, so } = X;
  let h = s.h, col = s.albedo, spec = s.spec, glow = s.glow, water = s.water || float(0);
  const land = float(1).sub(water).toVar();
  // (wave 6, version 4) what is laid after the colour grade, each { m, c } (sRGB): none for every earlier version
  const post = [];
  // a shared mottle for the parts' own tones, so no part is a flat paint
  const tone = fbm4(dir, float(14.0), so.add(vec3(-21, 17, 3)), maxF, float(0.6)).toVar();

  if (F.atoll) {
    const sea = water.toVar();
    // a scatter of atoll sites, thick in some stretches of sea and none in others (judged at each site, so none
    // is cut in two); each with its own size, its outline broken by a noise so none is a circle
    const k = float(26.0).div(D.atollSize);
    const reg = (cn) => D.atolls.mul(0.85).mul(mix(float(1), sstep(-0.1, 0.35, noise3(cn.mul(2.3).add(so.mul(0.9)))), D.atollSpread));
    const S = nearSites(dir, k, reg, 5501);
    const rr = mix(0.16, 0.42, S.h1.x);
    const wob = fbm4(dir, k.mul(2.2), so.add(vec3(7, -3, 11)), maxF, float(0.55));
    const r = S.d1.div(rr).mul(wob.mul(0.6).add(1.0)).toVar();
    const isleR = D.atollIsle.mul(0.62).mul(S.h1.z.mul(0.8).add(0.45));
    const isle = sstep(isleR.add(0.05).add(fwidth(r)), isleR.sub(0.03), r).mul(sstep(0.0, 0.02, D.atollIsle)).toVar();
    const lagoon = sstep(1.0, 0.72, r).mul(float(1).sub(isle));
    const halo = sstep(1.75, 0.95, r).mul(float(1).sub(lagoon)).mul(float(1).sub(isle));
    const g = sea.mul(sstep(0.0, 0.02, D.atolls)).toVar();
    col = mix(col, mix(col, D.atollColour, 0.4), halo.mul(g));
    col = mix(col, D.atollColour.mul(tone.mul(0.25).add(1.0)), lagoon.mul(g).mul(0.92));
    col = mix(col, D.atollIsleColour.mul(tone.mul(0.35).add(1.0)), isle.mul(g));
    if (F.coast && s.depth) {
      // shallows hugging every coast: by the depth below the sea's level, broken where the noise dips
      const cw = D.atollCoast.mul(0.05).add(0.004);
      const coast = sstep(cw, cw.mul(0.1), s.depth).mul(sstep(-0.2, 0.15, tone)).mul(sea).mul(sstep(0.0, 0.02, D.atollCoast));
      col = mix(col, D.atollColour.mul(tone.mul(0.2).add(1.0)), coast.mul(0.85));
    }
    water = water.mul(float(1).sub(isle.mul(g)));
    spec = spec.mul(float(1).sub(isle.mul(g)));
    h = h.add(isle.mul(g).mul(0.004));
  } else if (F.coast && s.depth) {
    const cw = D.atollCoast.mul(0.05).add(0.004);
    const coast = sstep(cw, cw.mul(0.1), s.depth).mul(sstep(-0.2, 0.15, tone)).mul(water);
    col = mix(col, D.atollColour.mul(tone.mul(0.2).add(1.0)), coast.mul(0.85));
  }

  if (F.lines) {
    const ls = D.lineScale;
    const w = D.lineWidth.mul(0.004).add(0.0007).mul(sqrt(ls));
    const lq = warp(dir, float(1.1).div(ls), 0.09, so.add(vec3(-19, 5, 23)), maxF).toVar();
    // long sweeping lines: the zero lines of a broad, smooth field (little weight in its finer octaves, so they
    // sweep rather than wriggle), broken into long runs (the dial: how many runs)
    const n1 = fbm4(lq, float(1.4).div(ls), so.add(vec3(3, -17, 9)), maxF, float(0.32));
    const runN = fbm4(dir, float(2.0).div(ls), so.add(vec3(11, 13, -7)), maxF, float(0.5));
    const run = sstep(0.05, 0.22, runN.add(D.lines.mul(0.55)).sub(0.3));
    const sweep = line(n1, w).mul(run);
    // branches: a second field's zero lines, finer, shown only near the first lines (so they fork off them)
    const n2 = fbm4(warp(lq, float(3.0).div(ls), 0.04, so.add(vec3(2, 8, -5)), maxF), float(3.2).div(ls), so.add(vec3(-9, 4, 17)), maxF, float(0.4));
    const near = sstep(0.1, 0.0, abs(n1));
    const branch = line(n2, w.mul(0.7)).mul(near).mul(D.lineBranch).mul(sstep(-0.15, 0.1, runN.add(D.lines.mul(0.4)).sub(0.2)));
    // straight lines: great circles through the seed's own points (eight at most), each in a few long runs
    let straight = float(0);
    for (let i = 0; i < 8; i++) {
      const L = normalize(X.lanes[i].xyz);
      const on = step(float(i + 0.5), D.lineStraight.mul(8.0));
      const r2 = sstep(-0.05, 0.2, noise3(dir.mul(float(2.5).div(ls)).add(L.mul(23.0))));
      straight = max(straight, line(dot(dir, L), w.mul(0.8)).mul(r2).mul(on));
    }
    const lines = clamp(max(max(sweep, branch), straight), 0.0, 1.0).mul(sstep(0.0, 0.02, D.lines)).toVar();
    // a soft, darker fringe either side (the troughs' shadowed walls), then the line itself
    const fringe = max(line(n1, w.mul(3.5)).mul(run), straight.mul(0.5)).mul(sstep(0.0, 0.02, D.lines)).mul(float(1).sub(D.lineGlow.mul(0.6)));
    col = mix(col, col.mul(0.78), fringe.mul(0.45));
    const lc = mix(D.lineColour.mul(tone.mul(0.3).add(1.0)), D.lineColour.mul(1.6).add(vec3(0.12, 0.04, 0.02)), D.lineGlow);
    col = mix(col, lc, lines.mul(0.92));
    glow = max(glow, lines.mul(D.lineGlow));
    h = h.sub(lines.mul(0.004)).sub(fringe.mul(0.001));
  }

  if (F.star) {
    const c = dirOfDeg(D.starLat, D.starLon);
    const fr = frameOf(c);
    const th = atan(length(cross(dir, c)), dot(dir, c)).toVar();
    const phi = atan(dot(dir, fr.n), dot(dir, fr.e));
    const reach = D.starReach.mul(DEG);
    const N = floor(D.starRays.add(0.5));
    // the cracks wander as they run (a noise turning them), more the farther out
    const wob = fbm4(dir, float(7.0), so.add(vec3(4, -11, 6)), maxF, float(0.55)).mul(0.45).mul(clamp(th.div(reach), 0.0, 1.0));
    const a = phi.div(TAU).mul(N).add(wob).toVar();
    // each crack its own length and width (by its own number, the same either side of the angle's cut)
    const ia = floor(a.add(0.5));
    const idx = ia.sub(floor(ia.div(N)).mul(N));
    const rr = hashFloats(hashCell(int(idx), int(4111), int(13)));
    const len = reach.mul(rr.x.mul(0.75).add(0.4));
    const taper = sstep(len, len.mul(0.15), th);
    const dist = tri(a).mul(TAU).div(N).mul(sin(th));
    const wr = D.starWidth.mul(0.005).add(0.0008).mul(taper.mul(0.75).add(0.25)).mul(rr.y.mul(0.8).add(0.6));
    const ray = line(dist, wr).mul(taper).mul(sstep(reach.mul(0.02), reach.mul(0.08), th));
    // side cracks forking off each one partway out, and finer ones between
    const side = line(tri(a.mul(3.0).add(wob.mul(2.5))).mul(TAU).div(N.mul(3.0)).mul(sin(th)), wr.mul(0.55))
      .mul(sstep(len.mul(0.85), len.mul(0.35), th)).mul(sstep(len.mul(0.12), len.mul(0.3), th)).mul(0.75);
    // the pit at its heart, its rim a little raised
    const pit = sstep(reach.mul(0.075), reach.mul(0.035), th);
    const star = max(max(ray, side), pit).mul(D.star).toVar();
    const shade = line(dist, wr.mul(4.0)).mul(taper).mul(D.star);
    col = mix(col, col.mul(0.84), shade.mul(0.5));
    if (F.keep) {
      // (wave 6, version 4) the cracks laid after the grade in their own colour, with no drift of tone, as much as asked
      col = mix(col, D.starColour.mul(tone.mul(0.3).add(1.0)), star.mul(0.9).mul(float(1).sub(D.starKeep)));
      post.push({ m: star.mul(0.9).mul(D.starKeep), c: D.starColour });
    } else col = mix(col, D.starColour.mul(tone.mul(0.3).add(1.0)), star.mul(0.9));
    h = h.sub(star.mul(0.008)).add(sstep(reach.mul(0.12), reach.mul(0.075), th).mul(float(1).sub(pit)).mul(D.star).mul(0.002));
  }

  if (F.trench) {
    const tl = D.trenchTilt.mul(DEG), tu = D.trenchTurn.mul(DEG);
    // the circle's pole: the north pole tilted by `tilt` toward longitude `turn`; two directions in its plane
    const nrm = vec3(sin(tl).mul(sin(tu)), cos(tl), sin(tl).mul(cos(tu)));
    const b1 = vec3(cos(tu), 0.0, sin(tu).negate());
    const b2 = cross(nrm, b1);
    const meander = fbm4(dir, float(2.2), so.add(vec3(-8, 3, 17)), maxF, float(0.5)).mul(D.trenchWobble.mul(0.07));
    const w = D.trenchWidth.mul(0.024);
    const ragged = fbm6(dir, float(36.0), so.add(vec3(5, 19, -2)), maxF, float(0.62)).mul(w.mul(0.4));
    const x = abs(dot(dir, nrm).add(meander)).add(ragged).toVar();
    const psi = atan(dot(dir, b2), dot(dir, b1));
    const arc = D.trenchArc.mul(DEG / 2);
    const along = max(sstep(arc, arc.sub(0.3), abs(psi)), step(359.5, D.trenchArc)).toVar();
    const floorM = sstep(w.mul(0.55), w.mul(0.3), x).mul(along);
    const wall = sstep(w, w.mul(0.45), x).mul(along);
    const shoulder = sstep(w.mul(2.8), w.mul(1.0), x).mul(along);
    const tr = D.trench;
    // its shoulders broken and darker (scattered rubble), its walls dark, its floor the trench's own colour
    col = mix(col, col.mul(tone.mul(0.2).add(0.8)), shoulder.mul(0.4).mul(tr));
    col = mix(col, mix(col.mul(0.45), D.trenchColour, 0.6), wall.mul(tr));
    col = mix(col, D.trenchColour.mul(tone.mul(0.35).add(1.0)), floorM.mul(tr));
    h = h.sub(wall.mul(0.035).mul(tr)).add(shoulder.mul(float(1).sub(wall)).mul(0.004).mul(tr));
    spec = spec.mul(float(1).sub(wall.mul(tr)));
  }

  if (F.specks || F.region) {
    // the one great region: a broad patch of the globe, its edge ragged
    const rq = warp(dir, 1.0, 0.32, so.add(vec3(-41, 7, 13)), maxF);
    const rn = fbm6(rq, float(0.75), so.add(vec3(17, -23, 5)), maxF, float(0.55)).add(fbm4(dir, float(7.0), so.add(vec3(2, 2, -9)), maxF, float(0.6)).mul(0.06)).toVar();
    const rt = mix(0.4, -0.3, D.regionSize);
    const region = sstep(rt, rt.add(0.035).add(fwidth(rn)), rn).toVar();
    if (F.region) col = mix(col, D.regionColour.mul(tone.mul(0.35).add(1.0)), region.mul(D.regionTint));
    if (F.specks) {
      const f = float(110.0).div(D.speckSize);
      const wc = worleyCell(warp(dir, 5.0, 0.012, so.add(vec3(9, -9, 4)), maxF).mul(f).add(so.mul(0.61))).toVar();
      // in small clusters, thick in some places and none in others; all of them, or only in the region
      const cl = sstep(-0.12, 0.25, fbm4(dir, float(5.0), so.add(vec3(-5, 15, 8)), maxF, float(0.5)));
      const where = mix(float(1), region, D.speckRegion).mul(cl.mul(0.7).add(0.3));
      const on = select(wc.z.lessThan(D.specks.mul(0.65).mul(where)), float(1), float(0));
      const dot0 = sstep(0.34, 0.1, wc.x).mul(on).mul(wc.w.mul(0.6).add(0.4)).toVar();
      col = mix(col, D.speckColour.mul(wc.w.mul(0.3).add(0.85)), dot0.mul(0.95));
      glow = max(glow, dot0.mul(D.speckGlow));
      if (F.halo) {
        // (wave 6, version 4) a soft halo of the speck's colour round each, out to most of its cell, glowing as the speck does
        const halo = sstep(float(0.34).add(D.speckHalo.mul(0.5)), 0.12, wc.x).mul(on).mul(wc.w.mul(0.4).add(0.6)).mul(D.speckHalo).toVar();
        col = mix(col, D.speckColour.mul(wc.w.mul(0.2).add(0.8)), halo.mul(0.6));
        glow = max(glow, halo.mul(D.speckGlow).mul(0.55));
      }
    }
  }

  if (F.lace) {
    const ls = D.laceScale;
    const lq = warp(dir, float(1.8).div(ls), 0.28, so.add(vec3(31, -2, -17)), maxF);
    const lq2 = warp(lq, float(8.0).div(ls), 0.025, so.add(vec3(-3, 21, 6)), maxF);
    // threads: the crests of a ridged sum (thin, joined, forking); blotches: a plain sum
    const thr = ridged9(lq2, float(4.5).div(ls), so.add(vec3(13, 3, -29)), maxF, float(0.55));
    const blot = fbm6(lq, float(3.0).div(ls), so.add(vec3(-15, 9, 2)), maxF, float(0.6)).mul(1.2).add(0.5);
    const v = mix(blot, thr, D.laceDetail);
    const t = mix(0.9, 0.3, D.lace);
    const where = mix(land, float(1), D.laceSea);
    const lace = sstep(t, t.add(0.07), v).mul(where).mul(sstep(0.0, 0.02, D.lace)).toVar();
    // (wave 6, version 4) the ground between taken toward the lace's own colour first
    if (F.lace4) col = mix(col, D.laceColour.mul(tone.mul(0.3).add(0.85)), where.mul(D.laceGround).mul(float(1).sub(lace)));
    col = mix(col, D.laceColour.mul(tone.mul(0.3).add(1.0)), lace.mul(0.9));
    if (F.lace4) {
      // and the thickest of the lace in its second tone
      const t2 = t.add(mix(0.35, 0.01, D.laceTwoShare));
      const lace2 = sstep(t2, t2.add(0.05), v).mul(where).mul(D.laceTwoTone).mul(sstep(0.0, 0.02, D.lace));
      col = mix(col, D.laceColour2.mul(tone.mul(0.15).add(1.0)), lace2);
      spec = spec.mul(float(1).sub(lace2.mul(0.8)));
    }
    water = water.mul(float(1).sub(lace.mul(D.laceSea)));
    spec = spec.mul(float(1).sub(lace.mul(0.8)));
  }

  if (F.mottle) {
    const ms = D.mottleScale;
    const mq = warp(vec3(dir.x, dir.y.mul(1.5), dir.z), float(1.5).div(ms), 0.45, so.add(vec3(-6, 29, 1)), maxF).toVar();
    const broad = fbm6(mq, float(1.4).div(ms), so.add(vec3(9, -4, 21)), maxF, float(0.58));
    const billow = turb6(mq, float(4.0).div(ms), so.add(vec3(-17, 6, -6)), maxF, float(0.6)).toVar();
    const soft = mix(0.015, 0.12, D.mottleSoft);
    const t = mix(0.45, -0.3, D.mottle);
    const v = broad.add(billow.mul(0.5)).sub(0.15);
    const smoke = sstep(t.sub(soft), t.add(soft), v).mul(sstep(0.0, 0.02, D.mottle)).toVar();
    const pale = sstep(0.3, 0.5, billow).mul(sstep(t.add(soft.mul(3.0)), t, v)).mul(D.mottle);
    col = mix(col, D.mottleColour.mul(billow.mul(0.6).add(0.8)), smoke.mul(0.88));
    col = mix(col, D.mottleLight.mul(tone.mul(0.2).add(1.0)), pale.mul(0.55));
    if (F.rim) {
      // (wave 6, version 4) a rim of its own colour round each billow's edge, from a little outside it to its soft inside
      const rw = D.mottleRimWidth.mul(0.12).add(0.015);
      const edge = t.sub(soft);
      const rim = sstep(edge.sub(rw), edge.sub(rw.mul(0.3)), v).mul(sstep(t.add(soft).add(rw.mul(0.5)), t.add(soft.mul(0.3)), v)).mul(D.mottleRim);
      col = mix(col, D.mottleRimColour.mul(billow.mul(0.4).add(0.85)), rim.mul(0.9));
    }
  }

  if (F.fine) {
    // specks a few texels across at the texture's own fineness (maxF), each its own: bright or dark by its number
    const wc = worleyCell(dir.mul(maxF.mul(0.55).div(D.fineSize)).add(so.mul(1.7))).toVar();
    const on = select(wc.z.lessThan(D.fineSpecks.mul(0.55)), float(1), float(0));
    const spot = sstep(0.32, 0.1, wc.x).mul(on).toVar();
    const dark = select(wc.w.lessThan(D.fineDark), float(1), float(0));
    col = mix(col, col.mul(0.45), spot.mul(dark).mul(0.85));
    col = mix(col, col.mul(1.45).add(0.06), spot.mul(float(1).sub(dark)).mul(0.75));
    const grain = fbm4(dir, maxF.mul(0.32), so.add(vec3(27, -13, 8)), maxF, float(0.7));
    col = col.mul(grain.mul(D.fineGrain.mul(0.5)).add(1.0));
  }
  const res = { h, albedo: col, spec, glow, water: s.water ? water : s.water, cold: s.cold, depth: s.depth };
  if (post.length) res.post = post;
  return res;
}

// (wave 6, maker C) The ring cities and the cities' metal, laid over a look's ground after its features, blend and parts: the
// plates and seams after the colour grade in their own colour (`post`), the glow along the rings and the dim fill into the city
// lights, the metal for the glint. With the rings drawn by the material (`RU.plate.w` 0) the ground's glow is still dimmed to the
// fill and its metal kept, and the material lays the rings itself.
function cityParts(dir, s, D, X, F, recipe) {
  const RU = X.rings;
  const post = [...(s.post || [])];
  let { h, glow } = s;
  // a whole-planet city's built-up ground is metal where it is not ice (its shine, 0.12, is the built-up share)
  let metal = recipe === 'cityworld' ? clamp(s.spec.div(0.12), 0.0, 1.0).mul(0.3) : float(0);
  if (F.rings) {
    const R = ringLayer(dir, RU, F.ringLayout);
    const k = RU.counts.w.mul(float(1).sub(s.water || float(0))).toVar();
    const bake = RU.plate.w;
    const pc = RU.plate.xyz.mul(R.tone.mul(0.35).add(0.8)).mul(RU.look.y.mul(0.7).add(0.65));
    post.push({ m: R.plate.mul(k).mul(0.85).mul(bake), c: pc });
    post.push({ m: max(R.seam, R.trunks.mul(0.6)).mul(k).mul(0.5).mul(bake), c: pc.mul(0.55) });
    glow = max(max(glow.mul(mix(float(1), RU.look.w, k)), R.lines.mul(RU.look.z).mul(k).mul(bake)), R.plate.mul(RU.look.w).mul(0.25).mul(k).mul(bake));
    metal = max(metal, R.plate.mul(R.tone.mul(0.45).add(0.55)).mul(k).mul(bake));
    h = h.add(R.plate.mul(0.0015).mul(k).mul(bake)).sub(R.seam.mul(0.001).mul(k).mul(bake));
  }
  const out = { ...s, h, glow, metal };
  if (post.length) out.post = post;
  return out;
}

// The great cyclone over a version's clouds: the whole cloud field curled round one centre, then bands of thick
// cloud wound into it in a spiral, a dense wall round a clear eye. It turns one way in the north, the other south.
function greatCyclone(base) {
  return (dir, D, X) => {
    const { maxF, so } = X;
    const c = dirOfDeg(D.greatStormLat, D.greatStormLon);
    const fr = frameOf(c);
    const R = D.greatStormSize.mul(0.3);
    const x = length(dir.sub(c)).div(R).toVar();
    const hemi = select(c.y.greaterThanEqual(0.0), float(1), float(-1));
    const turn = exp(pow(x, 1.25).mul(-1.1)).mul(D.greatStorm.mul(5.5)).mul(hemi);
    const p = turnAbout(dir, c, turn);
    const cb = base(p, D, X);
    const ang = atan(dot(dir, fr.n), dot(dir, fr.e));
    const tight = mix(1.8, 5.5, D.greatStormArms);
    const sp = sin(ang.mul(2.0).add(log(x.add(0.03)).mul(tight).mul(hemi)));
    const er = fbm4(p, float(16.0), so.add(vec3(-7, 31, 2)), maxF, float(0.6));
    const er2 = fbm4(p, float(5.0), so.add(vec3(13, 3, -19)), maxF, float(0.55));
    const arm = sstep(-0.25, 0.55, sp.add(er.mul(0.9)).add(er2.mul(0.6))).mul(sstep(1.7, 0.6, x));
    const wall = sstep(0.42, 0.16, x.add(er.mul(0.08)));
    const eye = sstep(0.045, 0.1, x.add(er.mul(0.02)));
    const add = max(arm, wall).mul(clamp(D.greatStorm.mul(1.5), 0.0, 1.0)).mul(eye);
    const inside = sstep(1.6, 0.9, x).mul(D.greatStorm);
    const cover = max(cb.cover.mul(mix(float(1), eye, inside)), add.mul(0.97));
    return { cover: clamp(cover, 0.0, 1.0), bright: mix(cb.bright, float(1.0), wall.mul(0.5).mul(D.greatStorm)) };
  };
}

// Version 2's colour grade, in OKLab (Ottosson's): the sRGB colour taken to linear light, to OKLab,
// its lightness scaled and spread about the middle, its hue turned, every colour pulled toward the
// wash colour by the wash, its colour strength scaled; and back. (OKLab's lightness and hue hold while
// its chroma moves, so a calmer colour is the same shade, only greyer.)
const m3 = (...rows) => mat3(new THREE.Matrix3().set(...rows));
const OK_LMS = m3(0.4122214708, 0.5363325363, 0.0514459929, 0.2119034982, 0.6806995451, 0.1073969566, 0.0883024619, 0.2817188376, 0.6299787005);
const OK_LAB = m3(0.2104542553, 0.7936177850, -0.0040720468, 1.9779984951, -2.4285922050, 0.4505937099, 0.0259040371, 0.7827717662, -0.8086757660);
const OK_LMS_ = m3(1, 0.3963377774, 0.2158037573, 1, -0.1055613458, -0.0638541728, 1, -0.0894841775, -1.2914855480);
const OK_RGB = m3(4.0767416621, -3.3077115913, 0.2309699292, -1.2684380046, 2.6097574011, -0.3413193965, -0.0041960863, -0.7034186147, 1.7076147010);
const toLinear = (c) => mix(c.div(12.92), pow(c.add(0.055).div(1.055), vec3(2.4)), step(vec3(0.04045), c));
const toSRGB = (c) => mix(c.mul(12.92), pow(c, vec3(1 / 2.4)).mul(1.055).sub(0.055), step(vec3(0.0031308), c));
const toOklab = (srgb) => OK_LAB.mul(pow(max(OK_LMS.mul(toLinear(srgb)), vec3(0)), vec3(1 / 3)));
function grade(srgb, D) {
  const lab = toOklab(srgb).toVar();
  const wash = toOklab(D.gradeWashColour);
  const L = float(0.5).add(lab.x.mul(D.gradeLightness).sub(0.5).mul(D.gradeContrast));
  const ang = D.gradeHue.mul(Math.PI / 180);
  const ca = cos(ang), sa = sin(ang);
  const a0 = lab.y.mul(ca).sub(lab.z.mul(sa)), b0 = lab.y.mul(sa).add(lab.z.mul(ca));
  const ab = mix(vec2(a0, b0), wash.yz, D.gradeWash).mul(D.gradeStrength);
  const lms = OK_LMS_.mul(vec3(L, ab.x, ab.y));
  return toSRGB(clamp(OK_RGB.mul(lms.mul(lms).mul(lms)), 0.0, 1.0));
}
// How high the decks' relief normals are baked (height per unit of the 0..1 deck height, in body radii).
const DEPTH_RELIEF = 0.006;

// The shared cloud layer: masses from warped noise squeezed east-west, sorted into belts by latitude,
// curled round a few spiral storms with clear eyes. Returns (brightness, cover).
// (wave 6) `S`, version 4's softness (a node), softens the masses' edges and eases their crisp erosion; left out (every earlier
// version), the graph is exactly what it was.
function clouds(dir, D, X, S = null) {
  const { maxF, so } = X;
  let p = dir;
  const eye = float(1).toVar();
  for (let i = 0; i < X.cyclones.length; i++) {
    const S = X.cyclones[i];
    const c = S.xyz;
    const rad = max(S.w, 0.00001);
    const on = sstep(0.0, 0.0001, S.w);
    const d = length(p.sub(c));
    // the turn grows toward the centre but stays under a turn and a half, wobbled, so the arms are
    // ragged spirals rather than rings
    const wob = noise3(p.mul(18.0).add(c.mul(40.0))).mul(0.35).add(1.0);
    const a = exp(d.div(rad).pow(1.5).mul(-1.1)).mul(select(c.y.greaterThan(0.0), 1.0, -1.0)).mul(3.2).mul(wob).mul(on);
    p = turnAbout(p, c, a).toVar();
    eye.mulAssign(float(1).sub(sstep(0.12, 0.03, d.div(rad)).mul(on)));
  }
  const lat = atan(p.y, length(vec2(p.x, p.z)));
  const sc = D.cloudScale;
  const sp = vec3(p.x, p.y.mul(1.7), p.z);
  const q = warp(sp, float(1.6).div(sc), D.cloudSwirl.mul(0.32), so.add(vec3(40, 40, 40)), maxF);
  const n = fbm9(q, float(2.4).div(sc), so.add(vec3(-40, 12, 40)), maxF, float(0.56));
  const wisp = fbm6(vec3(q.x, q.y.mul(2.5), q.z), float(9.0).div(sc), so.add(vec3(3, 30, 3)), maxF, float(0.6));
  // belts: the equator's band, the dry subtropics, the stormy middle latitudes, the poles
  const al = abs(lat);
  const belt = sstep(0.22, 0.05, al).mul(0.9).add(sstep(0.3, 0.6, al).mul(sstep(1.35, 0.95, al)).mul(1.0)).add(sstep(1.2, 1.5, al).mul(0.6));
  const bias = mix(0.55, belt, D.cloudBands).sub(0.55).mul(0.32);
  const th = mix(0.42, -0.42, D.cloudCover);
  // the margins of the masses break into fields of small puffy cells (cumulus), and the edges are
  // eaten by a fine noise, so they are crisp and ragged rather than a soft blur
  const cells = worley(q.mul(float(30.0).div(sc)).add(so));
  const puff = sstep(0.75, 0.15, cells.x).toVar();
  const erode = fbm4(q, float(22.0).div(sc), so.add(vec3(17, -3, 8)), maxF, float(0.6));
  const v0 = n.add(bias).add(wisp.mul(0.25)).toVar();
  const margin = sstep(th.sub(0.16), th, v0).mul(sstep(th.add(0.2), th.add(0.04), v0));
  const v = S ? v0.add(puff.sub(0.5).mul(0.1).mul(margin).mul(float(1).sub(S))).add(erode.mul(0.1).mul(float(1).sub(S.mul(0.8))))
    : v0.add(puff.sub(0.5).mul(0.1).mul(margin)).add(erode.mul(0.1));
  const cover = S ? sstep(th.sub(0.04).sub(S.mul(0.22)), th.add(0.17).add(S.mul(0.3)), v).mul(eye) : sstep(th.sub(0.04), th.add(0.17), v).mul(eye);
  // thin streaks of high cloud in the open spaces, combed along the winds
  const cir = fbm6(vec3(q.x, q.y.mul(5.0), q.z), float(4.0).div(sc), so.add(vec3(-12, 4, 30)), maxF, float(0.58));
  const cirrus = sstep(0.12, 0.3, cir).mul(sstep(-0.05, 0.15, fbm4(q, float(1.5), so.add(vec3(8, 8, -8)), maxF, float(0.5)))).mul(0.22).mul(eye);
  const thick = sstep(th, th.add(0.4), v);
  // thin cloud is a veil of white, not grey: thick cloud only a little brighter
  return { cover: clamp(max(cover, cirrus), 0.0, 1.0), bright: thick.mul(0.14).add(0.86).mul(erode.mul(0.12).add(1.0)) };
}

// Version 2's clouds: the first's, with many small flecks and wisps of cloud between the masses (as on
// Naboo's picture), a little stretched east-west; none at 0.
function clouds2(dir, D, X, S = null) {
  const c = S ? clouds(dir, D, X, S) : clouds(dir, D, X);
  const { maxF, so } = X;
  const f = float(22.0).div(D.cloudSpotScale);
  const p = warp(vec3(dir.x, dir.y.mul(1.5), dir.z), f.mul(0.4), float(0.7).div(f), so.add(vec3(13, -31, 7)), maxF);
  const n = fbm6(p, f, so.add(vec3(-23, 11, 37)), maxF, float(0.62));
  const th = mix(0.4, 0.02, D.cloudSpots);
  const fleck = (S ? sstep(th, th.add(0.14).add(S.mul(0.3)), n) : sstep(th, th.add(0.14), n)).mul(sstep(0.0, 0.02, D.cloudSpots));
  return { cover: clamp(max(c.cover, fleck.mul(0.85)), 0.0, 1.0), bright: c.bright };
}

// Version 3's clouds (living worlds): the second's, with long thin streaks of high cloud combed along
// the winds (a noise stretched hard east-west and bent by a broad warp, so the streaks curl and fan as
// cirrus does), thin and bright; none at 0.
function clouds3(dir, D, X, S = null) {
  const c = S ? clouds2(dir, D, X, S) : clouds2(dir, D, X);
  const { maxF, so } = X;
  const sc = D.cloudStreakScale;
  const bent = warp(dir, float(1.3).div(sc), float(0.28), so.add(vec3(-31, 9, 17)), maxF);
  const q = warp(bent, float(5.0).div(sc), float(0.03), so.add(vec3(7, -19, 23)), maxF);
  const n = fbm6(vec3(q.x, q.y.mul(9.0), q.z), float(3.2).div(sc), so.add(vec3(21, 33, -9)), maxF, float(0.6));
  const where = sstep(-0.1, 0.25, fbm4(dir, float(1.2), so.add(vec3(-2, 17, 5)), maxF, float(0.5)));
  const th = mix(0.45, 0.08, D.cloudStreaks);
  const streak = sstep(th, th.add(0.16), n).mul(where.mul(0.6).add(0.4)).mul(sstep(0.0, 0.02, D.cloudStreaks)).mul(0.75);
  return { cover: clamp(max(c.cover, streak), 0.0, 1.0), bright: c.bright };
}

// ---------------------------------------------------------------------------------------------
// Baking. Four passes, each a full-screen quad into a lat-long target: the height (packed into two
// 8-bit channels for 16 bits) and the glow; the colour and the shine; the relief (the height's slope
// turned into the sphere's own normal, in the body's frame, so it needs no tangents and has no seam);
// the clouds. The bake materials are made once a recipe; a new seed or dial is only new uniforms.

const shared = {
  maxF: uniform(160), so: uniform(new THREE.Vector3()), texel: uniform(new THREE.Vector2(1 / 2048, 1 / 1024)),
  reliefAmp: uniform(0.02),
  storms: Array.from({ length: 8 }, () => uniform(new THREE.Vector4(0, 1, 0, 0))),
  cyclones: Array.from({ length: 8 }, () => uniform(new THREE.Vector4(0, 1, 0, 0))),
  craters: Array.from({ length: 6 }, () => uniform(new THREE.Vector4(0, 1, 0, 0))),
  lanes: Array.from({ length: 12 }, () => uniform(new THREE.Vector4(0, 1, 0, 0))),
  // (wave 6) the ring cities' arrays, written at each bake of a look that has them (ringSitesOf)
  rings: ringUniforms(),
};

const dirOfUV = (t) => {
  const lon = t.x.sub(0.5).mul(TAU);
  const lat = t.y.sub(0.5).mul(Math.PI);
  return { dir: vec3(cos(lat).mul(sin(lon)), sin(lat), cos(lat).mul(cos(lon))), lat, lon };
};

// `slope` is the baked height's steepness (height per radian), read in the colour pass from the height
// target the first pass wrote (so rock shows on steep ground and snow or sand lies on the flats); in
// the height pass itself it is nothing.
function contextAt(t, slope = float(0)) {
  const { dir, lat, lon } = dirOfUV(t);
  return { dir, lat, lon, X: { maxF: shared.maxF, so: shared.so, lat, slope, storms: shared.storms, cyclones: shared.cyclones, craters: shared.craters, lanes: shared.lanes, rings: shared.rings } };
}

// The slope is measured over a fixed angle (two texels of the 2048 size), so the same seed and dials
// put rock in the same places at every texture size.
const SLOPE_DU = 2 / 2048, SLOPE_DV = 2 / 1024;

const toUniform = (d, v) => (d.type === 'color' ? new THREE.Vector3().setFromColor(new THREE.Color().setStyle(v, THREE.NoColorSpace)) : +v);

// Which features a look builds into its bake (each only when its count is above 0).
function featureFlags(gen) {
  const on = (k) => (+gen.dials?.[k] || 0) > 0 && RECIPES[gen.recipe].relief > 0;
  // (wave B) the planet features, only at the version that has them (an older look has none of their dials)
  const pv = (+gen.version || 1) >= partsVersion(gen.recipe);
  const p = (k) => pv && (+gen.dials?.[k] || 0) > 0;
  const P = {
    atoll: p('atolls'), coast: p('atollCoast'), lines: p('lines'), star: p('star'), trench: p('trench'), specks: p('specks'), region: p('regionTint'),
    lace: p('lace'), mottle: p('mottle'), fine: p('fineSpecks') || p('fineGrain'), cyclone: p('greatStorm'),
  };
  P.parts = P.atoll || P.coast || P.lines || P.star || P.trench || P.specks || P.region || P.lace || P.mottle || P.fine;
  // (wave 6, maker C) wave 6's parts, only at the version that has them (none of them for an older look: its flags as they were)
  const v4 = (+gen.version || 1) >= ringsVersion(gen.recipe);
  if (v4) {
    const q = (k) => (+gen.dials?.[k] || 0) > 0;
    Object.assign(P, {
      keep: P.star && q('starKeep'), halo: P.specks && q('speckHalo'), lace4: P.lace && (q('laceGround') || q('laceTwoTone')), rim: P.mottle && q('mottleRim'),
      rings: ringsOn(gen), metal: metalOn(gen), soft: q('softEdges'),
      // (the ring cities' layout is a kit's own: one layout's arithmetic a program)
      ringLayout: ringLayoutOf(gen),
    });
  }
  return { sink: on('sinkholes'), canyon: on('canyons'), crater: on('craterField'), depth: depthOn(gen), ...P };
}
// (wave B) the letters of the planet features a kit has (none: the kit's key is exactly what it was)
// (wave 6) and wave 6's after them, each only when on: keep, halo, two-tone lace, rim, rings, metal, soft edges
const PART_KEYS = [['atoll', 'A'], ['coast', 'B'], ['lines', 'L'], ['star', 'S'], ['trench', 'T'], ['specks', 'P'], ['region', 'R'], ['lace', 'C'], ['mottle', 'M'], ['fine', 'F'], ['cyclone', 'Y'],
  ['keep', 'K'], ['halo', 'H'], ['lace4', 'W'], ['rim', 'E'], ['rings', 'G'], ['metal', 'X'], ['soft', 'O']];
// A bake kit a recipe version, blended recipe version and set of features: with none of the last two,
// the recipe's surface alone, exactly as it was before either existed. Depth ('d') is a kit of its own.
function kitKey(gen) {
  const F = featureFlags(gen);
  const parts = PART_KEYS.filter(([k]) => F[k]).map(([, l]) => l).join('');
  return `${gen.recipe}@${gen.version || 1}|${gen.mix ? gen.mix.recipe + '@' + (gen.mix.version || 1) : ''}|${F.sink ? 's' : ''}${F.canyon ? 'c' : ''}${F.crater ? 'k' : ''}${F.depth ? 'd' : ''}${parts ? '|' + parts : ''}${F.rings ? '#' + F.ringLayout : ''}`;
}

const bakeKits = new Map();

// (the GPU port's pass 2, wave 4b's fixer) The vertex stage three's `QuadMesh.render` swaps in for its draw (a triangle from the
// vertex index, no vertex buffer), read off three's own quad by handing its `render` a stand-in renderer. A kit's materials
// carry it as their own, so a pipeline asked for ahead (`warm`, through `compileAsync`, which takes the material as it stands)
// is the very one the bake's draws use: with the material's own vertex stage the warm built a program reading a position
// buffer, keyed apart from the draw's, and on a cold shader cache the draws then built theirs for a minute behind the screen.
// The draws are unchanged (three swaps in the same node and puts the same one back).
let QUAD_VERTEX;
function quadVertexNode() {
  if (QUAD_VERTEX === undefined) {
    QUAD_VERTEX = null;
    const q = new THREE.QuadMesh(new THREE.NodeMaterial());
    q.render({ render: (o) => { QUAD_VERTEX = o.material.vertexNode ?? null; } });
  }
  return QUAD_VERTEX;
}

function kitFor(gen) {
  const key = kitKey(gen);
  if (bakeKits.has(key)) return bakeKits.get(key);
  const recipe = gen.recipe;
  const ver = gen.version || 1;
  const D = {};
  for (const d of dialsOf(recipe, ver)) D[d.k] = uniform(toUniform(d, d.def));
  const F = featureFlags(gen);
  const own = (F.depth && DEPTH[`${recipe}@${gen.version || 1}`]) || SURFACES[recipe][gen.version || 1] || SURFACES[recipe][1];
  // a look with both city lights and lava keeps each its own: the height pass's spare alpha carries the
  // lava's share of the glow, and the extra pass splits the glow by it (a look with one kind is as before)
  const kinds = glowKinds(gen);
  const split = kinds.length > 1;
  const ownLava = RECIPES[recipe].glow && !RECIPES[recipe].lights;
  let D2 = null, M = null, surface = own;
  if (gen.mix || F.sink || F.canyon || F.crater || F.parts || F.rings || F.metal) {
    let second = null;
    if (gen.mix) {
      D2 = {};
      for (const d of mixDialsOf(gen.mix.recipe, gen.mix.version || 1)) D2[d.k] = uniform(toUniform(d, d.def));
      M = {};
      for (const d of MIX_DIALS) M[d.k] = uniform(+d.def);
      second = SURFACES[gen.mix.recipe][gen.mix.version || 1] || SURFACES[gen.mix.recipe][1];
    }
    surface = (dir, _D, X) => {
      let s = own(dir, D, X);
      let lavaShare = null;
      if (second) {
        const s2 = second(dir, D2, { ...X, so: X.so.add(vec3(37.0, -23.0, 11.0)) });
        const m = blendMask(dir, s, X, M).toVar();
        if (split) {
          // the blend's two glows, before they are mixed into one: which part of it is the lava
          const a = s.glow.mul(float(1).sub(m)), b = s2.glow.mul(m);
          const lava = ownLava ? a : b;
          lavaShare = clamp(lava.div(max(a.add(b), 0.00001)), 0.0, 1.0);
        }
        s = {
          h: mix(s.h, s2.h, m), albedo: mix(s.albedo, s2.albedo, m), spec: mix(s.spec, s2.spec, m), glow: mix(s.glow, s2.glow, m),
          water: mix(s.water || float(0), s2.water || float(0), m), cold: mix(s.cold || float(0), s2.cold || float(0), m),
        };
      }
      let out = F.sink || F.canyon || F.crater ? features(dir, s, D, X, F) : s;
      // (wave B) the planet features over all of that
      if (F.parts) out = planetParts(dir, { ...out, depth: s.depth }, D, X, F);
      // (wave 6, maker C) the ring cities and the cities' metal over everything
      if (F.rings || F.metal) out = cityParts(dir, out, D, X, F, recipe);
      if (lavaShare) out.lavaShare = lavaShare;
      return out;
    };
  }
  const make = (fn) => { const m = new THREE.NodeMaterial(); m.fragmentNode = Fn(fn)(); m.vertexNode = quadVertexNode(); m.depthTest = false; m.depthWrite = false; m.name = 'generate-' + recipe; return m; };

  // 1: height (16 bits in r, g) and glow (b)
  const heightMat = make(() => {
    const a = contextAt(uv());
    const sA = surface(a.dir, D, a.X);
    const hh = clamp(sA.h, 0.0, 0.99998).toVar();
    // (wave 6) its spare alpha carries the cities' metal where the look has it and no lava share
    return vec4(floor(hh.mul(255)).div(255), fract(hh.mul(255)), clamp(sA.glow, 0.0, 1.0), split && sA.lavaShare ? sA.lavaShare : F.metal && sA.metal ? clamp(sA.metal, 0.0, 1.0) : 1.0);
  });

  // the height's texture nodes are made here, outside the passes' functions (which run only when the
  // material is compiled), so the bake can point them at the size's height target beforehand
  const fieldNodes = [];
  const t = uv();
  const H = (du, dv) => {
    const n = texture(new THREE.Texture(), t.add(vec2(du, dv)));
    fieldNodes.push(n);
    return n;
  };
  const dec = (s) => s.r.add(s.g.div(255));

  // 2: colour (sRGB) and shine, knowing the slope of the height baked just before
  const se = H(SLOPE_DU, 0), sw = H(-SLOPE_DU, 0), sn = H(0, SLOPE_DV), ss = H(0, -SLOPE_DV);
  const v4 = ver >= ringsVersion(recipe);
  const colourMat = make(() => {
    const lat = t.y.sub(0.5).mul(Math.PI);
    const gE = dec(se).sub(dec(sw)).div(max(cos(lat), 0.02).mul(2 * SLOPE_DU * TAU));
    const gN = dec(sn).sub(dec(ss)).div(2 * SLOPE_DV * Math.PI);
    const b = contextAt(t, length(vec2(gE, gN)));
    const sB = surface(b.dir, D, b.X);
    // (version 2 and later: the colour grade over the ground's colour, blend and features included)
    const albedo = clamp(sB.albedo, 0.0, 1.0);
    // (wave 6: version 4's grade with its colour pick and hold, then what is laid after the grade in its own colour)
    let rgb = ver >= 2 ? (v4 ? grade4(albedo, D) : grade(albedo, D)) : albedo;
    if (sB.post) for (const p of sB.post) rgb = mix(rgb, clamp(p.c, 0.0, 1.0), clamp(p.m, 0.0, 1.0));
    return vec4(rgb, clamp(sB.spec, 0.0, 1.0));
  });

  // (wave 6, maker C) 2b: soft edges over the ground's colours (only for a look that has them): the colour pass drawn into a
  // picture of its own with its levels, read here at twelve points of a disc round each texel (a Vogel disc, each read at the
  // level of its spacing), their mean mixed in by the dial. Every older look draws its colour straight into its surface.
  const softSrc = F.soft ? texture(new THREE.Texture()) : null;
  const softMat = F.soft ? make(() => {
    const { dir, lat } = dirOfUV(t);
    const fr = frameOf(dir);
    const reach = D.softWidth.mul(Math.PI / 180);
    // the taps' spacing in texels of the 2048 size at the equator, as a level (the size's own share comes in by maxF)
    const lod = max(log(reach.mul(shared.maxF).mul(2.0).div(Math.sqrt(SOFT_TAPS.length)).div(max(cos(lat), 0.2))).div(Math.LN2), 0.0);
    let acc = vec4(0);
    for (const [a, b] of SOFT_TAPS) {
      const p = normalize(dir.add(fr.e.mul(a).add(fr.n.mul(b)).mul(reach)));
      const uu = atan(p.x, p.z).div(TAU).add(0.5), vv = atan(p.y, length(vec2(p.x, p.z))).div(Math.PI).add(0.5);
      acc = acc.add(softSrc.sample(vec2(uu, vv)).level(lod));
    }
    const own = softSrc.sample(t).level(0);
    return mix(own, acc.div(SOFT_TAPS.length), D.softEdges);
  }) : null;

  // 3: relief: the normal of the height field on the sphere, in the body's frame
  const tx = (k) => shared.texel.x.mul(k), ty = (k) => shared.texel.y.mul(k);
  const c0 = H(0, 0), ce = H(tx(1), 0), cw = H(tx(-1), 0), cn = H(0, ty(1)), cs = H(0, ty(-1));
  const reliefMat = make(() => {
    const { dir, lat, lon } = dirOfUV(t);
    const east = vec3(cos(lon), 0.0, sin(lon).negate());
    const north = vec3(sin(lat).negate().mul(sin(lon)), cos(lat), sin(lat).negate().mul(cos(lon)));
    const dE = dec(ce).sub(dec(cw)).div(shared.texel.x.mul(2 * TAU).mul(max(cos(lat), 0.002)));
    const dN = dec(cn).sub(dec(cs)).div(shared.texel.y.mul(2 * Math.PI));
    const nrm = normalize(dir.sub(east.mul(dE).add(north.mul(dN)).mul(shared.reliefAmp)));
    return vec4(nrm.mul(0.5).add(0.5), c0.b);
  });

  // 4: clouds (any recipe)
  const cloudsMat = make(() => {
    const k = contextAt(uv());
    // (wave 6: version 4, the living world's 5, softens them and lays a thin haze)
    const own = v4 ? clouds4 : ver >= 3 ? clouds3 : ver >= 2 ? clouds2 : clouds;
    // (wave B) the great cyclone, only while it is on
    const cl = (F.cyclone ? greatCyclone(own) : own)(k.dir, D, k.X);
    return vec4(vec3(cl.bright), cl.cover);
  });

  // 5: the extra channels (only for a look that has them, extraChannels): city lights in r and lava in
  // g, each its own (a look with one kind of glow keeps it in the relief's alpha, as before); the
  // decks' height in b. Read straight from the height pass's texel.
  const extra = extraChannels(gen);
  // (wave 6) and the cities' metal (a), only for a look that has it: from the height pass's alpha, or, where that carries the lava's
  // share, from the ring cities' plates alone
  const moreMat = extra ? make(() => {
    const g = c0.b;
    const lavaPart = split ? g.mul(c0.a) : kinds[0] === 'lava' ? g : float(0);
    const lightPart = split ? g.mul(float(1).sub(c0.a)) : kinds[0] === 'lights' ? g : float(0);
    if (extra.metal) {
      const metal = !split ? c0.a : F.rings ? (() => { const R = ringLayer(dirOfUV(t).dir, shared.rings, F.ringLayout); return R.plate.mul(R.tone.mul(0.45).add(0.55)).mul(shared.rings.counts.w).mul(shared.rings.plate.w); })() : float(0);
      return vec4(lightPart, lavaPart, extra.depth ? dec(c0) : float(0), metal);
    }
    return vec4(lightPart, lavaPart, extra.depth ? dec(c0) : float(0), 1.0);
  }) : null;

  const kit = { D, D2, M, heightMat, colourMat, reliefMat, cloudsMat, moreMat, fieldNodes, quad: new THREE.QuadMesh(heightMat), compiled: false };
  // (wave 6) the soft edges' pass and the picture node it reads, only for a look that has them
  if (softMat) { kit.softMat = softMat; kit.softSrc = softSrc; }
  bakeKits.set(key, kit);
  return kit;
}

function target(w, h, { mips = true, nearest = false } = {}) {
  const rt = new THREE.RenderTarget(w, h, {
    type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, colorSpace: THREE.NoColorSpace,
    generateMipmaps: mips, minFilter: nearest ? THREE.NearestFilter : mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
    magFilter: nearest ? THREE.NearestFilter : THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, anisotropy: mips ? 8 : 1,
  });
  rt.texture.name = 'generated';
  return rt;
}

// One height target a size, shared by every set (bakes run one at a time).
const fieldTargets = new Map();
function fieldTarget(w, h) {
  const key = w + 'x' + h;
  if (!fieldTargets.has(key)) fieldTargets.set(key, target(w, h, { mips: false, nearest: true }));
  return fieldTargets.get(key);
}
// (wave 6) One soft edges' picture a size (the colour pass's, with its levels), shared likewise; made only by a look with soft edges.
const softTargets = new Map();
function softTarget(w, h) {
  const key = w + 'x' + h;
  if (!softTargets.has(key)) softTargets.set(key, target(w, h));
  return softTargets.get(key);
}

// The seed's numbers: the noise's shift, the storms', cyclones' and young craters' places and sizes.
function seedUniforms(gen) {
  const r = rng(gen.seed * 7919 + 13);
  shared.so.value.set((r() - 0.5) * 200, (r() - 0.5) * 200, (r() - 0.5) * 200);
  const d0 = gen.dials;
  // a blended recipe's storms, rays and lanes are seeded from its own dials when the first recipe has
  // none of them (a look without a blend reads exactly what it always did)
  const m = gen.mix?.dials || {};
  const d = { storms: d0.storms ?? m.storms, stormSize: d0.stormSize ?? m.stormSize, rays: d0.rays ?? m.rays, craterSize: d0.craterSize ?? m.craterSize, cloudStorms: d0.cloudStorms, cloudScale: d0.cloudScale };
  // gas giant storms: one big, the rest smaller, within 60 degrees of the equator
  const ns = Math.round(+d.storms || 0);
  shared.storms.forEach((u, i) => {
    const c = onSphere(r(), r(), -1.05, 1.05);
    const size = (i === 0 ? 0.19 : 0.04 + r() * 0.06) * (+d.stormSize || 1);
    u.value.set(c.x, c.y, c.z, i < ns ? size : 0);
  });
  const nc = Math.round(+d.cloudStorms || 0);
  shared.cyclones.forEach((u, i) => {
    const south = r() < 0.5;
    const c = onSphere(r(), r(), south ? -1.05 : 0.3, south ? -0.3 : 1.05);
    u.value.set(c.x, c.y, c.z, i < nc ? (0.07 + r() * 0.07) * (+d.cloudScale || 1) : 0);
  });
  const rays = +d.rays || 0;
  shared.craters.forEach((u, i) => {
    const c = onSphere(r(), r());
    u.value.set(c.x, c.y, c.z, rays > 0.001 && i < 4 ? (0.012 + r() * 0.02) * (+d.craterSize || 1) : 0);
  });
  // the whole-planet city's traffic lanes: great circles (drawn after the numbers above, so the older
  // recipes' places stay where they were)
  const nl = gen.recipe === 'cityworld' || gen.mix?.recipe === 'cityworld' ? 12 : 0;
  shared.lanes.forEach((u, i) => {
    const c = onSphere(r(), r());
    u.value.set(c.x, c.y, c.z, i < nl ? 1 : 0);
  });
}

/**
 * Where a generated look's spiral storms stand and how wide each is, as `seedUniforms` places them for
 * the cloud bake: the same generator drawn in the same order, so the centres match the baked swirls
 * exactly (wave 4's turning storms read them; nothing here touches a bake). `out` is an array of up to
 * 8 [x, y, z, radius, sign] (sign +1 in the north, -1 in the south, as the bake turns its arms).
 */
export function cycloneSites(gen, out = []) {
  out.length = 0;
  if (!gen) return out;
  const r = rng(gen.seed * 7919 + 13);
  r(); r(); r();
  const d0 = gen.dials || {};
  for (let i = 0; i < 8; i++) { r(); r(); if (i !== 0) r(); }
  const nc = Math.round(+d0.cloudStorms || 0);
  for (let i = 0; i < 8; i++) {
    const south = r() < 0.5;
    const c = onSphere(r(), r(), south ? -1.05 : 0.3, south ? -0.3 : 1.05);
    if (i < nc) out.push([c.x, c.y, c.z, (0.07 + r() * 0.07) * (+d0.cloudScale || 1), c.y > 0 ? 1 : -1]);
  }
  return out;
}

let queue = Promise.resolve();
let bakeCount = 0;

/**
 * A set of baked textures for one look: surface (sRGB colour, shine in alpha), relief (the body-frame
 * normal, glow in alpha) and, when asked, clouds (brightness, cover in alpha). Bake again into the same
 * targets whenever the recipe, seed or dials change: every material sampling them sees the new ones.
 */
export class GeneratedSet {
  constructor(width) {
    const [w, h] = SIZES.find(([x]) => x === width) || SIZES[1];
    this.width = w;
    this.height = h;
    this.surface = target(w, h);
    this.relief = target(w, h);
    this.clouds = null;
    this.more = null; // the extra channels (extraChannels), only for a look that has them
    this.key = '';
    this.lastMs = 0;
    this.firstMs = 0;
    this.bakes = 0;
    this.refs = 0;
    this.disposed = false;
  }

  /** The key of what was baked: anything else needs a bake. */
  static keyOf(gen, withClouds) {
    const m = gen.mix;
    return JSON.stringify([gen.recipe, gen.version || 1, gen.seed, gen.size, !!withClouds, ...dialsOf(gen.recipe, gen.version || 1).filter((d) => !d.live).map((d) => gen.dials[d.k]),
      m ? [m.recipe, m.version || 1, ...MIX_DIALS.map((d) => +m[d.k]), ...mixDialsOf(m.recipe, m.version || 1).filter((d) => !d.live).map((d) => m.dials[d.k])] : 0]);
  }

  /**
   * Bake (queued after any bake already running). Resolves with the milliseconds it took. (Wave 6) `ringless`: a look whose ring
   * cities are drawn sharp by its material bakes its pictures without them (the material lays them); the set keeps their numbers
   * in `rings` for that material either way.
   */
  bake(renderer, gen, { withClouds = false, ringless = false } = {}) {
    const run = async () => {
      if (this.disposed) return 0;
      if (withClouds && !this.clouds) this.clouds = target(this.width, this.height);
      const t0 = performance.now();
      const kit = kitFor(gen);
      const first = !kit.compiled;
      const fill = (U, list, src) => {
        for (const d of list) {
          const u = U[d.k];
          const v = toUniform(d, src?.[d.k] ?? d.def);
          if (d.type === 'color') u.value.copy(v); else u.value = v;
        }
      };
      fill(kit.D, dialsOf(gen.recipe, gen.version || 1), gen.dials);
      if (kit.D2 && gen.mix) { fill(kit.D2, mixDialsOf(gen.mix.recipe, gen.mix.version || 1), gen.mix.dials); fill(kit.M, MIX_DIALS, gen.mix); }
      seedUniforms(gen);
      // (wave 6) the ring cities' numbers, for the bake and for the material (a look without them: none)
      if (ringsOn(gen) || this.rings) {
        writeRings(shared.rings, gen, { baked: !ringless });
        writeRings((this.rings ||= ringUniforms()), gen, { baked: !ringless });
      }
      shared.maxF.value = this.width / (4 * Math.PI);
      shared.texel.value.set(1 / this.width, 1 / this.height);
      shared.reliefAmp.value = depthOn(gen) ? DEPTH_RELIEF : RECIPES[gen.recipe].relief || (gen.mix ? RECIPES[gen.mix.recipe].relief : 0);
      const fields = fieldTarget(this.width, this.height);
      for (const n of kit.fieldNodes) n.value = fields.texture;
      // (wave 6) the soft edges' own picture, read by its pass
      const soft = kit.softMat ? softTarget(this.width, this.height) : null;
      if (soft) kit.softSrc.value = soft.texture;
      // the extra channels: made for a look that has them, dropped when it no longer does
      if (kit.moreMat && !this.more) this.more = target(this.width, this.height);
      if (!kit.moreMat && this.more) { this.more.dispose(); this.more = null; }
      const prev = renderer.getRenderTarget();
      const pass = (mat, rt) => { kit.quad.material = mat; renderer.setRenderTarget(rt); kit.quad.render(renderer); };
      try {
        pass(kit.heightMat, fields);
        if (kit.moreMat) pass(kit.moreMat, this.more);
        pass(kit.colourMat, soft || this.surface);
        if (soft) pass(kit.softMat, this.surface);
        pass(kit.reliefMat, this.relief);
        if (withClouds && this.clouds) pass(kit.cloudsMat, this.clouds);
      } finally {
        renderer.setRenderTarget(prev);
      }
      // wait for the card to finish, so the time is the bake's own
      await renderer.readRenderTargetPixelsAsync(withClouds && this.clouds ? this.clouds : this.relief, 0, 0, 1, 1);
      const ms = performance.now() - t0;
      kit.compiled = true;
      this.key = GeneratedSet.keyOf(gen, withClouds);
      this.lastMs = ms;
      if (first || !this.firstMs) this.firstMs = this.firstMs || ms;
      this.lastFirst = first;
      this.bakes++;
      bakeCount++;
      return ms;
    };
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    return p;
  }

  /**
   * (the GPU port's pass 2, wave 4b) Its bake's passes made ready on a renderer before it bakes: each pass's pipeline asked
   * for against a target of the format it draws into (`compileAsync`, the game's warm-up behind its loading screen), so the
   * bake that follows builds nothing in its draws. Resolves with the milliseconds it took (0 where the kit had baked
   * before). The viewer never calls it: its own renderer builds a kit at its first bake, as ever.
   */
  async warm(renderer, gen, { withClouds = false, again = false } = {}) {
    const kit = kitFor(gen);
    // each pass's ask kept until it lands, so a warm begun on one screen and not landed by its end is awaited by the next;
    // `again` asks once more (an ask that answers at once where its pipeline has landed: the game's probe of a slow kit)
    kit.warming ??= new Map();
    if (again) kit.warming.clear();
    // each pass asked against the very target this set's bake draws it into (the game's compile keys a pipeline by its target)
    if (withClouds && !this.clouds) this.clouds = target(this.width, this.height);
    if (kit.moreMat && !this.more) this.more = target(this.width, this.height);
    // the height's texture nodes pointed at the size's height target, as the bake points them (three writes a nearest-filtered
    // picture's read as a load, not a sample: the warm's program must read the picture the draws will hand it)
    // (wave 6) a look with soft edges draws its colour into the soft picture and its soft pass into the surface, as its bake does
    const soft = kit.softMat ? softTarget(this.width, this.height) : null;
    if (soft) kit.softSrc.value = soft.texture;
    const fields = fieldTarget(this.width, this.height);
    for (const n of kit.fieldNodes) n.value = fields.texture;
    const passes = [[kit.heightMat, fields],[kit.moreMat, this.more], [kit.colourMat, soft || this.surface], [kit.softMat || null, this.surface], [kit.reliefMat, this.relief], [withClouds ? kit.cloudsMat : null, this.clouds]].filter(([m, rt]) => m && rt);
    const t0 = performance.now();
    const prev = renderer.getRenderTarget();
    const asked = [];
    let fresh = 0;
    try {
      for (const [m, rt] of passes) {
        let p = kit.warming.get(m);
        if (!p) {
          renderer.setRenderTarget(rt);
          const q = new THREE.QuadMesh(m);
          p = Promise.resolve(renderer.compileAsync(q, q.camera)).catch(() => {});
          kit.warming.set(m, p);
          fresh++;
        }
        asked.push(p);
      }
    } finally {
      renderer.setRenderTarget(prev);
    }
    await Promise.all(asked);
    return fresh ? performance.now() - t0 : 0;
  }

  /** Every texel of one of its textures, for checks (same seed, same picture). */
  async pixels(renderer, which = 'surface') {
    const rt = which === 'clouds' ? this.clouds : which === 'relief' ? this.relief : which === 'more' ? this.more : this.surface;
    if (!rt) return null;
    await queue;
    return renderer.readRenderTargetPixelsAsync(rt, 0, 0, this.width, this.height);
  }

  dispose() {
    this.disposed = true;
    this.surface.dispose();
    this.relief.dispose();
    this.clouds?.dispose();
    this.more?.dispose();
  }
}

export const bakeStats = () => ({ bakes: bakeCount, kits: bakeKits.size });

/** FNV-1a over bytes: a short name for a picture's every texel. */
export function hashBytes(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
