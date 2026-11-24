// The air round a body (the atmosphere brief's wave A, item 1; pass 2's design 2.6, "air round bodies"): one pure
// module the viewer's body shader is built from, and that the game's body path will import as it stands. A look's
// own air record, whose numbers mean what the game's record means (`src/sky/air/airParams.ts`: kilometres and
// coefficients per kilometre, laid out by the same `F`, starting from Hillaire's published Earth as that file does),
// three small tables made from it on the CPU (the sun's transmittance through the shell by Bruneton's mapping, the
// multiple scattering's share by Hillaire's method, and the sky's light on the ground by the sun's height), and a
// march through the shell, per pixel, of 8 to 16 steps by a quality setting: Rayleigh, Mie and ozone, each step lit
// through the transmittance table and the multiple-scattering table, integrated exactly over its own extinction.
// It gives both the limb's glow (rays that miss the body) and the aerial perspective over the disc (rays that end on
// it: the light the air adds in front, and the share of the body's own light that comes through), per unit of the
// sun's illuminance; the caller multiplies by the sun's (pi times the stage's sun power, so a white Lambert surface
// facing that sun reads the sun power, as the viewer's lighting always has).
//
// The method is Hillaire's ("A Scalable and Production Ready Sky and Atmosphere Rendering Technique", 2020) as the
// game's air carries it; written here from the method in the game's record's units.
//
// Pure: no three, no page. The JS half (the record, the tables, `marchAir`) is what the node tests and the place
// view's day wash run; the shader half (`airShader`) takes three's TSL namespace as an argument and builds the same
// march as nodes, so the two are one method.

// ---------------------------------------------------------------- the record (the game's own layout)

/**
 * Where each number of a record sits: `airParams.ts`'s `F`, number for number, then (the atmosphere brief's wave B)
 * three more the game's record does not have yet: the haze's colour (`mieTintR/G/B`). Each is that channel's Mie
 * scattering as a share of `mieS` (its brightest channel 1; 1, 1, 1 is a grey haze, the record as it was), while the
 * haze's extinction stays grey (`mieS + mieA` in every channel): a channel the haze scatters less, it absorbs more
 * (per channel, scattering `mieS * t` and absorption `mieA + mieS * (1 - t)`), as dust, ash and smoke do (large grains
 * dim every colour alike but scatter back mostly the colours they do not absorb). So a desert's dust can be warm, an
 * ash haze brown or dark, and the sun through either is dimmed, not tinted, by it. A record of the game's 25 numbers
 * (no colour) reads as 1, 1, 1 (`hazeTintOf`): pass 2's wave 4 extends the game's record by appending the same three.
 */
export const F = {
  bottom: 0, top: 1,
  rayR: 2, rayG: 3, rayB: 4, rayH: 5,
  mieS: 6, mieA: 7, mieH: 8, mieG: 9,
  ozR: 10, ozG: 11, ozB: 12, ozC: 13, ozW: 14,
  groundR: 15, groundG: 16, groundB: 17,
  sunR: 18, sunG: 19, sunB: 20, sunStrength: 21, sunRadius: 22,
  visShare: 23, mieAlbedo: 24,
  mieTintR: 25, mieTintG: 26, mieTintB: 27,
  // (the GPU port's pass 2, wave 6) the second aerosol layer, smoke and ash, appended as the haze's colour was: its
  // extinction and its scattering at the layer's peak, per km, red, green and blue (the extinction chromatic by its
  // Angstrom exponent, so the sun reddens through it), the layer's middle and half depth above the ground, km (a tent, as
  // the ozone's), its phase's g, and the glow from below (the lava's upward light the air scatters back down, as a share
  // of a strength-1 sun's illuminance at the top of the air, linear red, green and blue). All nought but the shape's
  // three: none, the record as it was (`SMOKE_NONE`).
  smokeER: 28, smokeEG: 29, smokeEB: 30,
  smokeSR: 31, smokeSG: 32, smokeSB: 33,
  smokeC: 34, smokeW: 35, smokeG: 36,
  glowR: 37, glowG: 38, glowB: 39,
};
/** The game's record's own count (`airParams.ts`), before the haze's colour. */
export const GAME_FIELD_COUNT = 25;
/** (pass 2, wave 6) The record's count before the smoke and ash: what a record with none is keyed by (`recordKey`). */
export const HAZE_FIELD_COUNT = 28;
export const AIR_FIELD_COUNT = 40;

// ---------------------------------------------------------------- the smoke and ash (pass 2, wave 6)

/**
 * The layer's none: no extinction, no scattering, no glow, and a finite shape (a tent 2 km up and 1.5 km either way, a
 * phase of 0.7) so nothing divides by nought where a reader works the tent whatever its strength.
 */
export const SMOKE_NONE = { c: 2, w: 1.5, g: 0.7 };
/**
 * The three wavelengths the record's channels stand for (nm): Bruneton's and Hillaire's red, green and blue, whose
 * Rayleigh coefficients (5.802, 13.558, 33.1 per Mm) are 550 nm's times (lambda / 550)^-4 to the third figure.
 */
export const SMOKE_NM = [680, 550, 440];
/**
 * The sun's illuminance at the top of the air, lux (`src/sky/night/galaxyDensity.ts`' `SUN_LUX`, held equal by
 * `airSmoke.test.ts`): the glow's lux are a share of it.
 */
export const SMOKE_SUN_LUX = 128000;
/**
 * Elsasser's diffusivity factor: diffuse light crossing a plane layer goes as though straight through 1.66 times its
 * vertical optical depth (the mean of 1 / cos over a Lambert hemisphere's flux, to the usual approximation), which is how
 * the glow from the lava below is dimmed on its way up to a height (`glowUp`).
 */
export const DIFFUSIVITY = 1.66;

/** Whether a record carries the smoke and ash (any extinction or any glow); a record of 28 numbers or fewer never does. */
export function hasSmoke(rec) {
  return rec.length > F.glowB && (rec[F.smokeER] > 0 || rec[F.smokeEG] > 0 || rec[F.smokeEB] > 0 || rec[F.glowR] > 0 || rec[F.glowG] > 0 || rec[F.glowB] > 0);
}

/** The tent's density at `h` km above the ground (1 at its middle `c`, nought `w` either side and beyond). */
export function smokeDensity(c, w, h) {
  const t = 1 - Math.abs(h - c) / (w > 1e-6 ? w : 1e-6);
  return t > 0 ? t : 0;
}

/**
 * The tent's column from far below up to `z` km (its peak taken as 1): its lower half's area grows as the square, its
 * upper half's as one less the square of what is left, `w` in all. The vertical column from the ground up is
 * `smokeColumnTo(c, w, inf) - smokeColumnTo(c, w, 0)`.
 */
export function smokeColumnTo(c, w, z) {
  const ww = w > 1e-6 ? w : 1e-6;
  let a = z - c + ww;
  a = a < 0 ? 0 : a > ww ? ww : a;
  let b = z - c;
  b = b < 0 ? 0 : b > ww ? ww : b;
  return (a * a) / (2 * ww) + b - (b * b) / (2 * ww);
}

/**
 * How many even steps the layer's column along a ray is summed by (`smokeColumnAlong`, the card's transmittance pass the
 * same): over only the stretch of the ray under the layer's top, so a tent lifted off the ground is crossed by all of them
 * (the haze's steps, laid by the square of their place from the ray's start, put some nine across Mustafar's plume at noon
 * and read its column 1.5% short, 15% in the light at 1.5 degrees; these read a 4,000-step sum within a few parts in ten
 * thousand from the zenith to the horizon).
 */
export const SMOKE_STEPS = 32;

/**
 * The tent's column (km of its peak's density) along a ray from `r` km from the centre with zenith cosine `mu` to the
 * top of the air (`bottom`, `top` its sphere's radii): the stretch of the ray inside the sphere of the layer's top is found
 * by the ray's quadratic and summed by `steps` even steps at their middles. A ray that never comes under the layer's top
 * sums nought. (Not a frame's: its answer crosses the call.)
 */
export function smokeColumnAlong(c, w, bottom, top, r, mu, steps = SMOKE_STEPS) {
  const ww = w > 1e-6 ? w : 1e-6;
  const discT = r * r * (mu * mu - 1) + top * top;
  const len = Math.max(0, -r * mu + Math.sqrt(discT > 0 ? discT : 0));
  const rt = bottom + c + ww;
  const d = r * r * (mu * mu - 1) + rt * rt;
  if (!(d > 0)) return 0;
  const s = Math.sqrt(d);
  let t1 = -r * mu - s;
  let t2 = -r * mu + s;
  if (t1 < 0) t1 = 0;
  if (t2 > len) t2 = len;
  if (!(t2 > t1)) return 0;
  const dt = (t2 - t1) / steps;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const t = t1 + (i + 0.5) * dt;
    const h = Math.sqrt(t * t + 2 * r * mu * t + r * r) - bottom;
    sum += smokeDensity(c, ww, h > 0 ? h : 0);
  }
  return sum * dt;
}

const PLANCK_H = 6.62607015e-34, LIGHT_C = 2.99792458e8, BOLTZ_K = 1.380649e-23;
const lobe = (l, mu, s1, s2) => { const t = (l - mu) / (l < mu ? s1 : s2); return Math.exp(-0.5 * t * t); };
/**
 * A black body's colour at `kelvin` as linear Rec. 709, luminance 1, into `out`: `src/sky/stars.ts`' `kelvinToLinear`
 * line for line (Planck's law over 380 to 780 nm at 5 nm through Wyman, Sloan and Shirley's fit of the CIE 1931
 * matching functions), here because this file imports nothing; `airSmoke.test.ts` holds the two to the bit.
 */
export function blackBody(kelvin, out) {
  const T = kelvin > 500 ? kelvin : 500;
  let X = 0, Y = 0, Z = 0;
  for (let nm = 380; nm <= 780; nm += 5) {
    const l = nm * 1e-9;
    const b = (2 * PLANCK_H * LIGHT_C * LIGHT_C) / (l ** 5 * (Math.exp((PLANCK_H * LIGHT_C) / (l * BOLTZ_K * T)) - 1));
    const x = 1.056 * lobe(nm, 599.8, 37.9, 31.0) + 0.362 * lobe(nm, 442.0, 16.0, 26.7) - 0.065 * lobe(nm, 501.1, 20.4, 26.2);
    const y = 0.821 * lobe(nm, 568.8, 46.9, 40.5) + 0.286 * lobe(nm, 530.9, 16.3, 31.1);
    const z = 1.217 * lobe(nm, 437.0, 11.8, 36.0) + 0.681 * lobe(nm, 459.0, 26.0, 13.8);
    X += b * x; Y += b * y; Z += b * z;
  }
  const r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  const g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  const bl = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  const rr = r > 0 ? r : 0, gg = g > 0 ? g : 0, bb = bl > 0 ? bl : 0;
  const lum = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
  const s = lum > 0 ? 1 / lum : 0;
  out[0] = rr * s; out[1] = gg * s; out[2] = bb * s;
  return out;
}

/**
 * The smoke and ash's dials (each `undefined` takes `SMOKE_DIAL_START`'s) laid into a record's twelve numbers: its
 * vertical optical depth at 550 nm from the ground up (`smokeDepth`; nought is none, and then the record is exactly
 * `SMOKE_NONE`'s) spread over the tent the middle and thickness make (`smokeHeightKm`, `smokeThickKm`, the thickness its
 * whole depth), its extinction by channel `(lambda / 550)^-smokeAngstrom`, its absorption `(1 - smokeAlbedo)` of the
 * green's extinction by channel `(lambda / 550)^-smokeBrown` (held under the extinction), the rest scattered; its phase
 * `smokeG`; and the glow from below, `glowLux` lux of a black body at `glowKelvin` as a share of `SMOKE_SUN_LUX`. A layer
 * wholly under the ground has no column and is none.
 */
export function smokeInto(rec, d) {
  const s = SMOKE_DIAL_START;
  const pick = (k) => { const v = d?.[k]; return typeof v === 'number' && Number.isFinite(v) ? v : s[k]; };
  const tau = pick('smokeDepth');
  const glow = pick('glowLux');
  const c = pick('smokeHeightKm');
  const w = pick('smokeThickKm') * 0.5;
  rec[F.smokeER] = rec[F.smokeEG] = rec[F.smokeEB] = 0;
  rec[F.smokeSR] = rec[F.smokeSG] = rec[F.smokeSB] = 0;
  rec[F.glowR] = rec[F.glowG] = rec[F.glowB] = 0;
  if (!(tau > 0) && !(glow > 0)) {
    rec[F.smokeC] = SMOKE_NONE.c; rec[F.smokeW] = SMOKE_NONE.w; rec[F.smokeG] = SMOKE_NONE.g;
    return rec;
  }
  rec[F.smokeC] = c;
  rec[F.smokeW] = w > 1e-3 ? w : 1e-3;
  rec[F.smokeG] = pick('smokeG');
  const col = smokeColumnTo(c, rec[F.smokeW], c + rec[F.smokeW]) - smokeColumnTo(c, rec[F.smokeW], 0);
  const e550 = tau > 0 && col > 1e-9 ? tau / col : 0;
  const alpha = pick('smokeAngstrom'), albedo = pick('smokeAlbedo'), brown = pick('smokeBrown');
  for (let k = 0; k < 3; k++) {
    const x = SMOKE_NM[k] / 550;
    const e = e550 * Math.pow(x, -alpha);
    const a0 = (1 - albedo) * e550 * Math.pow(x, -brown);
    const a = a0 < e ? (a0 > 0 ? a0 : 0) : e;
    rec[F.smokeER + k] = e;
    rec[F.smokeSR + k] = e - a;
  }
  if (glow > 0) {
    blackBody(pick('glowKelvin'), _c3);
    const share = glow / SMOKE_SUN_LUX;
    rec[F.glowR] = _c3[0] * share; rec[F.glowG] = _c3[1] * share; rec[F.glowB] = _c3[2] * share;
  }
  return rec;
}

/**
 * The smoke and ash's dials, their ranges and every world's start (the GPU port's pass 2, wave 6; feel is the owner's):
 * **none** to start (`smokeDepth` 0, `glowLux` 0), so every record and table is the base's; the rest are where a mixed
 * volcanic plume of ash and smoke stands when he raises the depth (the reasons in `airParams.ts`' `SMOKE_STARTS`, which
 * gives Mustafar its measured start).
 */
export const SMOKE_DIAL_START = {
  smokeDepth: 0, smokeAngstrom: 1, smokeAlbedo: 0.85, smokeBrown: 1.5, smokeHeightKm: 3, smokeThickKm: 5, smokeG: 0.7, glowLux: 0, glowKelvin: 1250,
};
/** Each dial's range (the sliders'; a value outside is held to it). */
export const SMOKE_DIAL_RANGE = {
  smokeDepth: [0, 6], smokeAngstrom: [-0.5, 3], smokeAlbedo: [0.3, 1], smokeBrown: [0, 6], smokeHeightKm: [0, 30], smokeThickKm: [0.2, 30], smokeG: [0, 0.95], glowLux: [0, 200], glowKelvin: [800, 3000],
};
/** The dials' names, in the order the menus show them. */
export const SMOKE_DIAL_NAMES = ['smokeDepth', 'smokeAngstrom', 'smokeAlbedo', 'smokeBrown', 'smokeHeightKm', 'smokeThickKm', 'smokeG', 'glowLux', 'glowKelvin'];

/** A record's haze colour into `out` (1, 1, 1 for a record of the game's 25 numbers, which has none). */
export function hazeTintOf(rec, out) {
  if (rec.length > F.mieTintB) { out[0] = rec[F.mieTintR]; out[1] = rec[F.mieTintG]; out[2] = rec[F.mieTintB]; }
  else out[0] = out[1] = out[2] = 1;
  return out;
}

/** Hillaire's Earth (`airParams.ts`'s EARTH): 6,360 km under 100 km of air; per km. */
export const EARTH = {
  bottom: 6360,
  top: 6460,
  rayleigh: [5.802e-3, 13.558e-3, 33.1e-3],
  rayleighHeight: 8,
  mieScatter: 3.996e-3,
  mieAbsorb: 4.4e-3,
  mieHeight: 1.2,
  mieG: 0.8,
  ozone: [0.65e-3, 1.881e-3, 0.085e-3],
  ozoneCentre: 25,
  ozoneHalfWidth: 15,
};
export const KOSCHMIEDER = 3.912;
const LUMA = [0.2126, 0.7152, 0.0722];
const luma3 = (a) => LUMA[0] * a[0] + LUMA[1] * a[1] + LUMA[2] * a[2];
const EARTH_RAY_LUMA = luma3(EARTH.rayleigh);

// ---------------------------------------------------------------- a look's air (what the file holds)

/** The three forms of a look's air: drawn by this module, the look's own painted layer (as before), or none. */
export const AIR_MODES = [
  ['scattered', 'Scattered (real air and light)'],
  ['painted', 'Painted (the look\'s own rim or halo, as before)'],
  ['none', 'None (no air drawn)'],
];

const R = (k, label, min, max, step, def, title, more = {}) => ({ k, label, type: 'range', min, max, step, def, reset: def, title, ...more });
const C = (k, label, def, title) => ({ k, label, type: 'color', def, reset: def, title });

/**
 * The air's dials (the owner's of 20 November: sky colour, haze, thickness and how fast it thins, ozone tint, limb and
 * twilight brightness), each in the record's own units, each starting at Hillaire's Earth with the game's clear day of
 * 40 km (`AIR_DIAL_START`); feel is his to move. `group` sorts them on the Look tab.
 */
export const AIR_DIALS = [
  R('radiusKm', 'Planet radius', 200, 80000, 10, EARTH.bottom, 'The body\'s radius in km: with the thickness and the heights below, how thick the air stands against its disc (Earth 6,360; a gas giant tens of thousands)', { unit: ' km', group: 'air' }),
  R('thicknessKm', 'Thickness', 5, 3000, 1, EARTH.top - EARTH.bottom, 'How high the air reaches above the ground, km (Earth\'s 100): the shell the glow is drawn in', { unit: ' km', group: 'air' }),
  R('rayleighHeightKm', 'How fast it thins', 0.5, 120, 0.1, EARTH.rayleighHeight, 'The clear air\'s scale height, km: its density falls by e every this many km (Earth 8). Larger: a taller, softer limb', { unit: ' km', group: 'air' }),
  C('skyColour', 'Sky colour', '#74abff', 'The clear air\'s colour (Rayleigh\'s: the blue of a clear sky, its three coefficients\' ratio); Earth\'s at its start', ),
  R('skyStrength', 'Sky strength', 0, 6, 0.01, 1, 'How much the clear air scatters, as a share of Earth\'s: 0 is no clear air at all', { unit: '×', group: 'air' }),
  R('visibilityKm', 'Haze (clear-day visibility)', 0.5, 1000, 0.5, 40, 'How far a dark thing stays seen through the haze near the ground (2% contrast), km: 40 is a very clear day; nearer is hazier, dustier; 1000 is no haze at all', { unit: ' km', group: 'air' }),
  R('hazeHeightKm', 'Haze height', 0.1, 60, 0.1, EARTH.mieHeight, 'The haze\'s scale height, km (Earth 1.2): taller haze reaches higher up the limb', { unit: ' km', group: 'air' }),
  R('hazeG', 'Haze forward glow', 0, 0.95, 0.01, EARTH.mieG, 'How strongly the haze throws light forward (its phase\'s g): a bright glow round the sun when seen against it', { group: 'air' }),
  R('hazeAlbedo', 'Haze brightness', 0.2, 1, 0.01, 0.9, 'The share of the light a haze particle meets that it scatters rather than absorbs: dust and ash lower, water haze higher', { group: 'air' }),
  // (wave B) the haze's own colour: its single-scattering albedo by channel (the brightest at the haze brightness, the
  // others absorbed more), so a dust, ash or smoke haze can be warm or brown rather than a grey or a sky-coloured fog
  { ...C('hazeColour', 'Haze colour', '#ffffff', 'The haze\'s own colour: the colour its grains scatter back, the rest absorbed (white for water haze, warm for desert dust, grey-brown or rust for ash and smoke). Its brightest channel scatters at the haze brightness above; how dark the haze is stays that dial\'s. The haze still dims every colour of what lies behind it alike'), group: 'air' },
  R('ozone', 'Ozone (twilight tint)', 0, 8, 0.01, 1, 'Ozone as a share of Earth\'s: it takes the orange out of the light that crosses the terminator, keeping twilight blue', { unit: '×', group: 'air' }),
  R('groundAlbedo', 'Ground bounce', 0, 1, 0.01, 0.2, 'How much light the ground sends back up into the air (for the air\'s own multiple scattering)', { group: 'air' }),
  R('limbBright', 'Limb brightness', 0, 4, 0.01, 1, 'The glow along the limb and the haze near it, against the physical air (1)', { unit: '×', group: 'air' }),
  R('twilightBright', 'Twilight brightness', 0, 4, 0.01, 1, 'The air\'s glow where the sun is low or just set (the band across the terminator), against the physical air (1)', { unit: '×', group: 'air' }),
  R('limbDark', 'Limb darkening', 0, 1, 0.01, 0, 'A thick gas body or a haze world grows darker toward its rim (Minnaert\'s law; 0 is a plain Lambert surface)', { group: 'light' }),
  R('glint', 'Ocean glint', 0, 3, 0.01, 1, 'The sun\'s reflection on water (the specular layer\'s mask), with the water\'s own Fresnel: 1 is physical; 0 none. Off with the specular layer', { unit: '×', group: 'light' }),
  // (wave A's critic) 0.45 rather than 0.3: the sea's slopes in a moderate wind (Cox and Munk's, about 0.2 rms) make a
  // smudge from orbit, where 0.3 (a glassy calm) drew a small hot spot that read as glare
  R('glintRough', 'Glint roughness', 0.02, 0.6, 0.005, 0.45, 'How rough the sea is at this scale: small is a tight bright smudge, large a wide soft one', { group: 'light' }),
  R('cloudRelief', 'Cloud relief', 0, 3, 0.01, 1, 'Clouds\' lit tops and darker sides away from the sun, from the cover\'s own shape', { unit: '×', group: 'light' }),
  R('cloudForward', 'Cloud silver edge', 0, 3, 0.01, 1, 'Thin cloud lit from behind (the sun beyond it) glows forward: the silver edge near the terminator', { unit: '×', group: 'light' }),
  R('cloudShadow', 'Cloud shadows', 0, 1, 0.01, 0.6, 'How dark the clouds\' shadows lie on the ground below them, cast along the sun\'s way from the deck\'s own height', { group: 'light' }),
  // (wave A's critic) the night side: a look's ambient is a painted fill that keeps its night half seen; under the real
  // air the night side is dark at the exposure of a lit disc (only city lights and lava stay), so only this share of
  // it is kept. A start, not a measurement: feel is his.
  R('nightFill', 'Night-side fill', 0, 1, 0.01, 0.15, 'How much of the look\'s own ambient light still lights its night side: 0 is as dark as space, 1 as the Painted form lit it (city lights and lava are their own and stay)', { group: 'light' }),
  // (the GPU port's pass 2, wave 6) the second aerosol layer, smoke and ash, the game's own dials of the same names
  // (`airParams.ts`); none to start (a depth of 0, no glow), so a look's air is drawn as before until it is raised
  // (its depth and the glow rebuild the look, `struct`: a look with none keeps the graph it always had, `build.js`' `makeAir`)
  R('smokeDepth', 'Smoke and ash: depth', ...SMOKE_DIAL_RANGE.smokeDepth, 0.01, SMOKE_DIAL_START.smokeDepth, 'How much the smoke and ash layer dims the sun straight overhead: its vertical optical depth at 550 nm (0: none, the air as before; 1 lets through about a third, as a thick eruption plume does)', { group: 'air', struct: true }),
  R('smokeAngstrom', 'Smoke and ash: fine (smoke) or coarse (ash)', ...SMOKE_DIAL_RANGE.smokeAngstrom, 0.05, SMOKE_DIAL_START.smokeAngstrom, 'Its Angstrom exponent: how much more it dims the blue than the red. About 2 for fine smoke (the sun through it reddens hard), near 0 for coarse ash (grey, every colour dimmed alike)', { group: 'air' }),
  R('smokeAlbedo', 'Smoke and ash: brightness', ...SMOKE_DIAL_RANGE.smokeAlbedo, 0.01, SMOKE_DIAL_START.smokeAlbedo, 'Its single-scattering albedo in the green: the share of the light it meets that it scatters rather than absorbs (ash about 0.9, smoke 0.8 to 0.9, soot lower: darker)', { group: 'air' }),
  R('smokeBrown', 'Smoke and ash: brown', ...SMOKE_DIAL_RANGE.smokeBrown, 0.05, SMOKE_DIAL_START.smokeBrown, 'How much more it absorbs the blue than the red (its absorption Angstrom exponent): 1 a grey soot, 2 a brown smoke, 3 to 6 browner still', { group: 'air' }),
  R('smokeHeightKm', 'Smoke and ash: height', ...SMOKE_DIAL_RANGE.smokeHeightKm, 0.1, SMOKE_DIAL_START.smokeHeightKm, 'The middle of the layer above the ground, km', { unit: ' km', group: 'air' }),
  R('smokeThickKm', 'Smoke and ash: thickness', ...SMOKE_DIAL_RANGE.smokeThickKm, 0.1, SMOKE_DIAL_START.smokeThickKm, 'How deep the layer is, km: it thickens from its bottom to its middle and thins to its top', { unit: ' km', group: 'air' }),
  R('smokeG', 'Smoke and ash: forward glow', ...SMOKE_DIAL_RANGE.smokeG, 0.01, SMOKE_DIAL_START.smokeG, 'How strongly it throws light forward (its phase\'s g): the glow round the sun seen through it', { group: 'air' }),
  R('glowLux', 'Glow from below', ...SMOKE_DIAL_RANGE.glowLux, 0.05, SMOKE_DIAL_START.glowLux, 'The lava\'s light the air above it scatters back down: the upward light at the ground, lux (0 none; a full moon gives 0.25 lux, a deep twilight a few). An orange night sky over lava', { unit: ' lx', group: 'air', struct: true }),
  R('glowKelvin', 'Glow colour', ...SMOKE_DIAL_RANGE.glowKelvin, 10, SMOKE_DIAL_START.glowKelvin, 'The lava\'s temperature, kelvin: 1,000 a deep red, 1,250 orange, 1,500 yellow-orange', { unit: ' K', group: 'air' }),
];
AIR_DIALS[3].group = 'air';
/** Every dial's start, by key. */
export const AIR_START = Object.fromEntries(AIR_DIALS.map((d) => [d.k, d.def]));
const DIAL_BY_KEY = Object.fromEntries(AIR_DIALS.map((d) => [d.k, d]));

/** A look's air made whole and safe: its form, then every dial held to its range (a dial it never had: its start). */
export function cleanAir(a) {
  const out = { mode: AIR_MODES.some(([m]) => m === a?.mode) ? a.mode : 'painted' };
  for (const d of AIR_DIALS) {
    const v = a?.[d.k];
    if (d.type === 'color') out[d.k] = typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d.def;
    else out[d.k] = v !== null && v !== undefined && v !== '' && Number.isFinite(+v) ? Math.min(d.max, Math.max(d.min, +v)) : d.def;
  }
  return out;
}

/** A dial's range, for the tests and the Look tab. */
export const airDial = (k) => DIAL_BY_KEY[k] || null;

/**
 * The air a generated twin or placeholder starts with, by its recipe (its own dials where they say something about
 * the air, as a gas giant's limb darkening does): physical properties of the ground and the air, the game's
 * `AIR_WORLDS` where it has them (a desert's dust, a temperate world's continental haze), never a look. Only the
 * numbers that differ from the start are written, so a look's air reads short.
 */
export function airStartFor(recipe, dials = {}, { shaped = false } = {}) {
  const a = { mode: 'scattered' };
  const ld = +dials?.limbDark || 0;
  if (shaped) return { ...a, skyStrength: 0, visibilityKm: 1000, ozone: 0, thicknessKm: 5 };
  switch (recipe) {
    case 'gasgiant':
      // Jupiter's numbers in kind: a giant 60,000 km across whose visible cloud tops are the "ground", under a thin
      // clear air (a fifth of Earth's scattering, slowly thinning) and a faint high haze (a tenth of an optical depth),
      // so its bands keep their colours and the limb darkens (its own dial) rather than washing out; no ozone.
      return { ...a, radiusKm: 60000, thicknessKm: 1200, rayleighHeightKm: 27, skyStrength: 0.2, visibilityKm: 400, hazeHeightKm: 15, hazeG: 0.7, hazeAlbedo: 0.95, ozone: 0, groundAlbedo: 0.5, limbDark: ld || 0.5 };
    case 'desert':
      // sand and rock: a bright warm ground; dust absorbs more and throws forward less than water haze (AIR_WORLDS.tatooine)
      // (wave B) and its iron-stained grains absorb the blue more than the red: a warm dust (its albedo 0.85, 0.77, 0.61)
      return { ...a, visibilityKm: 25, hazeHeightKm: 1.6, hazeG: 0.7, hazeAlbedo: 0.85, hazeColour: '#fff3db', groundAlbedo: 0.35 };
    case 'ice':
      return { ...a, visibilityKm: 80, groundAlbedo: 0.7 };
    case 'flats':
      return { ...a, visibilityKm: 60, groundAlbedo: 0.6 };
    case 'volcanic':
      // black rock under ash, which absorbs much of what it meets (AIR_WORLDS.mustafar)
      // (wave B) a grey-brown ash, a little browner than it is grey (its albedo 0.7, 0.63, 0.55)
      return { ...a, visibilityKm: 14, hazeHeightKm: 2, hazeG: 0.7, hazeAlbedo: 0.7, hazeColour: '#fff3e4', groundAlbedo: 0.07 };
    case 'molten':
      // (wave B) a darker, browner ash and smoke over open lava (its albedo 0.6, 0.51, 0.42)
      return { ...a, visibilityKm: 8, hazeHeightKm: 3, hazeG: 0.7, hazeAlbedo: 0.6, hazeColour: '#ffeed9', groundAlbedo: 0.07 };
    case 'moon':
      // no air at all: the light alone (its terminator and its dusty back-scatter), nothing drawn round it
      return { ...a, skyStrength: 0, visibilityKm: 1000, ozone: 0, thicknessKm: 5 };
    default:
      // a temperate world: continental haze over a mixed land (DEFAULT_WORLD)
      return a;
  }
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function hexToLinear(hex, out) {
  const n = parseInt(String(hex).slice(1), 16) || 0;
  out[0] = srgbToLinear(((n >> 16) & 255) / 255);
  out[1] = srgbToLinear(((n >> 8) & 255) / 255);
  out[2] = srgbToLinear((n & 255) / 255);
  return out;
}
const _c3 = [0, 0, 0];

/** A fresh record at Hillaire's Earth (`airParams.ts`'s `newAirRecord`, number for number). */
export function newRecord() {
  const r = new Float64Array(AIR_FIELD_COUNT);
  r[F.bottom] = EARTH.bottom;
  r[F.top] = EARTH.top;
  r[F.rayR] = EARTH.rayleigh[0]; r[F.rayG] = EARTH.rayleigh[1]; r[F.rayB] = EARTH.rayleigh[2];
  r[F.rayH] = EARTH.rayleighHeight;
  r[F.mieS] = EARTH.mieScatter; r[F.mieA] = EARTH.mieAbsorb; r[F.mieH] = EARTH.mieHeight; r[F.mieG] = EARTH.mieG;
  r[F.ozR] = EARTH.ozone[0]; r[F.ozG] = EARTH.ozone[1]; r[F.ozB] = EARTH.ozone[2];
  r[F.ozC] = EARTH.ozoneCentre; r[F.ozW] = EARTH.ozoneHalfWidth;
  r[F.groundR] = r[F.groundG] = r[F.groundB] = 0.25;
  r[F.sunR] = r[F.sunG] = r[F.sunB] = 1;
  r[F.sunStrength] = 1;
  r[F.sunRadius] = (0.2666 * Math.PI) / 180;
  r[F.visShare] = 1;
  r[F.mieAlbedo] = 0.9;
  // (wave B) a grey haze: the game's record as it is
  r[F.mieTintR] = r[F.mieTintG] = r[F.mieTintB] = 1;
  // (pass 2, wave 6) no smoke or ash and no glow: the shape's three finite, everything else nought
  r[F.smokeC] = SMOKE_NONE.c; r[F.smokeW] = SMOKE_NONE.w; r[F.smokeG] = SMOKE_NONE.g;
  return r;
}

/** (wave B) A haze colour (hex) as the record's three shares: its linear channels over the brightest (white: 1, 1, 1). */
export function hazeTintFromHex(hex, out = [0, 0, 0]) {
  hexToLinear(hex, out);
  const m = Math.max(out[0], out[1], out[2]);
  if (!(m > 1e-6)) { out[0] = out[1] = out[2] = 1; return out; }
  out[0] /= m; out[1] /= m; out[2] /= m;
  return out;
}

/**
 * A look's air as a record (into `out`, made when not given): its planet and shell, Rayleigh from the sky's colour
 * (the ratio of the three coefficients, the colour's linear values over their luminance) and strength (Earth's
 * luminance times it), the haze from the visibility as `airParams.ts`'s `setVisibility` sets it (1000 km and over: no
 * haze), ozone as a share of Earth's with its layer at Earth's height scaled by how fast the air thins, the ground's
 * bounce. The sun is left white and of strength 1: the stage hands its own sun to the shader.
 */
export function recordOf(airIn, out = new Float64Array(AIR_FIELD_COUNT)) {
  const a = cleanAir(airIn);
  const fresh = newRecord();
  for (let i = 0; i < AIR_FIELD_COUNT; i++) out[i] = fresh[i];
  out[F.bottom] = a.radiusKm;
  out[F.top] = a.radiusKm + a.thicknessKm;
  hexToLinear(a.skyColour, _c3);
  const l = luma3(_c3);
  const k = l > 1e-6 ? (a.skyStrength * EARTH_RAY_LUMA) / l : 0;
  out[F.rayR] = _c3[0] * k; out[F.rayG] = _c3[1] * k; out[F.rayB] = _c3[2] * k;
  out[F.rayH] = a.rayleighHeightKm;
  const albedo = a.hazeAlbedo;
  out[F.mieAlbedo] = albedo;
  if (a.visibilityKm >= 1000) { out[F.mieS] = 0; out[F.mieA] = 0; }
  else {
    const want = KOSCHMIEDER / Math.max(0.05, a.visibilityKm) - out[F.rayG];
    const ext = want > 0 ? want : 0;
    out[F.mieS] = ext * albedo;
    out[F.mieA] = ext * (1 - albedo);
  }
  out[F.mieH] = a.hazeHeightKm;
  out[F.mieG] = a.hazeG;
  // (wave B) the haze's colour: its scattering by channel as a share of mieS, the extinction left grey
  hazeTintFromHex(a.hazeColour, _c3);
  out[F.mieTintR] = _c3[0]; out[F.mieTintG] = _c3[1]; out[F.mieTintB] = _c3[2];
  out[F.ozR] = EARTH.ozone[0] * a.ozone; out[F.ozG] = EARTH.ozone[1] * a.ozone; out[F.ozB] = EARTH.ozone[2] * a.ozone;
  const thin = a.rayleighHeightKm / EARTH.rayleighHeight;
  out[F.ozC] = EARTH.ozoneCentre * thin;
  out[F.ozW] = EARTH.ozoneHalfWidth * thin;
  out[F.groundR] = out[F.groundG] = out[F.groundB] = a.groundAlbedo;
  // (pass 2, wave 6) the smoke and ash and the glow from below (none to start)
  smokeInto(out, a);
  return out;
}

/** (pass 2, wave 6) How many of a record's numbers say what it is: 28 with no smoke or ash (the record as it was), else all. */
export function recordLength(rec) {
  return hasSmoke(rec) ? Math.min(rec.length, AIR_FIELD_COUNT) : Math.min(rec.length, HAZE_FIELD_COUNT);
}

/** A short name for a record's numbers (the tables are made again only when it moves). */
export function recordKey(rec) {
  let s = '';
  // (a record of the game's 25 numbers is keyed by those alone; (pass 2, wave 6) one with no smoke or ash by its 28, as
  // before the layer came, so every table kept by its key is found again)
  const n = recordLength(rec);
  for (let i = 0; i < n; i++) s += (i ? ',' : '') + (+rec[i]).toPrecision(7);
  return s;
}

/** Whether a record holds no air at all (nothing scatters or absorbs). */
export function airless(rec) {
  return !(rec[F.rayR] + rec[F.rayG] + rec[F.rayB] + rec[F.mieS] + rec[F.mieA] + rec[F.ozR] + rec[F.ozG] + rec[F.ozB] > 0);
}

// ---------------------------------------------------------------- the medium

const PI = Math.PI;
const RAYLEIGH_K = 3 / (16 * PI);
const MIE_K = 3 / (8 * PI);
const INV_4PI = 1 / (4 * PI);

export function rayleighPhase(c) { return RAYLEIGH_K * (1 + c * c); }
export function miePhase(c, g) {
  const g2 = g * g;
  const den = 1 + g2 - 2 * g * c;
  return (MIE_K * (1 - g2) * (1 + c * c)) / ((2 + g2) * den * Math.sqrt(den));
}

/**
 * The densities at height `h` km above the ground, into `m`: [Rayleigh, Mie, ozone], and (pass 2, wave 6) where `m` has
 * a fourth place and the record the layer, the smoke and ash's tent there (nought for a record without).
 */
export function densities(rec, h, m) {
  const hh = h > 0 ? h : 0;
  m[0] = rec[F.rayH] > 0 ? Math.exp(-hh / rec[F.rayH]) : 0;
  m[1] = rec[F.mieH] > 0 ? Math.exp(-hh / rec[F.mieH]) : 0;
  const o = rec[F.ozW] > 0 ? 1 - Math.abs(hh - rec[F.ozC]) / rec[F.ozW] : 0;
  m[2] = o > 0 ? o : 0;
  if (m.length > 3) m[3] = rec.length > F.glowB ? smokeDensity(rec[F.smokeC], rec[F.smokeW], hh) : 0;
  return m;
}

/**
 * (pass 2, wave 6) The glow from the lava below reaching a height `h` km, into `out` (red, green, blue, per unit of the
 * record's sun at the top of the air): the record's glow over its sun's strength, dimmed on its way up by the air under
 * the height (the clear air's and the haze's columns by their scale heights, the layer's by its tent, ozone left out
 * under its 25 km), crossed as diffuse light does (`DIFFUSIVITY`). Nought for a record without.
 */
export function glowUp(rec, h, out) {
  if (!(rec.length > F.glowB) || !(rec[F.glowR] > 0 || rec[F.glowG] > 0 || rec[F.glowB] > 0)) { out[0] = out[1] = out[2] = 0; return out; }
  const hh = h > 0 ? h : 0;
  const k = rec[F.sunStrength] > 1e-9 ? 1 / rec[F.sunStrength] : 0;
  const cR = rec[F.rayH] > 0 ? rec[F.rayH] * (1 - Math.exp(-hh / rec[F.rayH])) : 0;
  const cM = rec[F.mieH] > 0 ? rec[F.mieH] * (1 - Math.exp(-hh / rec[F.mieH])) : 0;
  const cS = smokeColumnTo(rec[F.smokeC], rec[F.smokeW], hh) - smokeColumnTo(rec[F.smokeC], rec[F.smokeW], 0);
  const mieT = rec[F.mieS] + rec[F.mieA];
  for (let j = 0; j < 3; j++) {
    const tau = rec[F.rayR + j] * cR + mieT * cM + rec[F.smokeER + j] * cS;
    out[j] = rec[F.glowR + j] * k * Math.exp(-DIFFUSIVITY * tau);
  }
  return out;
}
/**
 * What a scatterer sends any way of the glow it is lit by, per unit of its scattering and of the glow's illuminance: a
 * Lambert plane of exitance M below has a radiance of M / pi over the lower hemisphere's 2 pi sr, met by the isotropic phase
 * 1 / (4 pi), so M / (2 pi). Isotropic, as the light of a thick plume lit from below is once it has scattered a few times.
 */
export const GLOW_PHASE = 1 / (2 * Math.PI);

/** Whether a ray from `r` km with zenith cosine `mu` meets the ground ahead. */
export function hitsGround(r, mu, bottom) {
  return mu < 0 && r * r * (mu * mu - 1) + bottom * bottom >= 0;
}

/**
 * How softly the planet's shadow edge is drawn, in the zenith cosine about the horizon of a point: a few tenths of a
 * degree (the sun's own disc and the air's refraction blur it), so the shadow's edge in the air is not a step the
 * march's few samples would turn into bands.
 */
export const SHADOW_SOFT = 0.012;
/** The horizon's zenith cosine at `r` km (where the planet's edge stands below the level). */
export const horizonMu = (r, bottom) => -Math.sqrt(Math.max(0, 1 - (bottom / Math.max(r, bottom)) ** 2));
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** The share of the sun a point at `r` sees over the planet's edge (0 below it, 1 above, soft across it). */
export const sunShare = (r, mu, bottom) => smoothstep(-SHADOW_SOFT, SHADOW_SOFT, mu - horizonMu(r, bottom));

// (pass 2, wave 6) four places: the smoke and ash's tent in the fourth (`densities`)
const mS = new Float64Array(4);
const gU = [0, 0, 0];

/**
 * The optical depth (red, green, blue) from `r` toward zenith cosine `mu` to the top of the air, summed directly by
 * `steps` segments laid by the square of their place (the haze's thin layer at the start has most of them), as the
 * game's `columnDepths` does: the reference the table is held to. (Pass 2, wave 6) The smoke and ash's column is added
 * after, by channel, only where the record carries it, summed along the ray's stretch under the layer's top by its own
 * steps (`smokeColumnAlong`): a record without is summed as it always was, to the bit.
 */
export function opticalDepth(rec, r, mu, steps, out) {
  const top = rec[F.top], bottom = rec[F.bottom];
  const disc = r * r * (mu * mu - 1) + top * top;
  const len = Math.max(0, -r * mu + Math.sqrt(disc > 0 ? disc : 0));
  let tr = 0, tm = 0, to = 0, prev = 0;
  for (let i = 0; i < steps; i++) {
    const u = (i + 1) / steps;
    const e = len * u * u;
    const dt = e - prev;
    const t = prev + 0.5 * dt;
    prev = e;
    const rr = Math.sqrt(t * t + 2 * r * mu * t + r * r);
    densities(rec, rr - bottom, mS);
    tr += mS[0] * dt; tm += mS[1] * dt; to += mS[2] * dt;
  }
  const mieExt = rec[F.mieS] + rec[F.mieA];
  out[0] = rec[F.rayR] * tr + mieExt * tm + rec[F.ozR] * to;
  out[1] = rec[F.rayG] * tr + mieExt * tm + rec[F.ozG] * to;
  out[2] = rec[F.rayB] * tr + mieExt * tm + rec[F.ozB] * to;
  if (hasSmoke(rec)) {
    // the layer's column along the ray's stretch under its top, by its own even steps (`smokeColumnAlong`)
    const ts = smokeColumnAlong(rec[F.smokeC], rec[F.smokeW], bottom, top, r, mu);
    out[0] += rec[F.smokeER] * ts; out[1] += rec[F.smokeEG] * ts; out[2] += rec[F.smokeEB] * ts;
  }
  return out;
}

/** The sun's transmittance from `r` toward `mu` summed directly (with the planet's soft shadow), into `out`. */
export function transmittanceDirect(rec, r, mu, steps, out) {
  opticalDepth(rec, r, mu, steps, out);
  const s = sunShare(r, mu, rec[F.bottom]);
  out[0] = Math.exp(-out[0]) * s; out[1] = Math.exp(-out[1]) * s; out[2] = Math.exp(-out[2]) * s;
  return out;
}

// ---------------------------------------------------------------- the tables

/** The tables' sizes: the transmittance by Bruneton's mapping, the multiple scattering's share, the sky's light on the ground. */
export const TABLES = {
  transmittance: { width: 128, height: 32, steps: 40 },
  multiScatter: { width: 32, height: 32, dirs: 32, steps: 16 },
  irradiance: { width: 64, height: 1, rings: 6, azimuths: 12, steps: 16 },
};

/** Texture coordinates (on texel centres) of the transmittance table for (r, mu): Bruneton's mapping. */
export function transmittanceUv(r, mu, bottom, top, W, H, out) {
  const Hh = Math.sqrt(top * top - bottom * bottom);
  const rr = r > bottom ? (r < top ? r : top) : bottom;
  const rho = Math.sqrt(Math.max(0, rr * rr - bottom * bottom));
  const disc = rr * rr * (mu * mu - 1) + top * top;
  const d = Math.max(0, -rr * mu + Math.sqrt(Math.max(0, disc)));
  const dMin = top - rr, dMax = rho + Hh;
  let xMu = dMax > dMin ? (d - dMin) / (dMax - dMin) : 0;
  xMu = xMu < 0 ? 0 : xMu > 1 ? 1 : xMu;
  let xR = Hh > 0 ? rho / Hh : 0;
  xR = xR < 0 ? 0 : xR > 1 ? 1 : xR;
  out[0] = 0.5 / W + xMu * (1 - 1 / W);
  out[1] = 0.5 / H + xR * (1 - 1 / H);
  return out;
}

function bilinear(tab, W, H, u, v, out) {
  let x = u * W - 0.5, y = v * H - 0.5;
  x = x < 0 ? 0 : x > W - 1 ? W - 1 : x;
  y = y < 0 ? 0 : y > H - 1 ? H - 1 : y;
  const x0 = x | 0, y0 = y | 0;
  const x1 = x0 + 1 < W ? x0 + 1 : x0, y1 = y0 + 1 < H ? y0 + 1 : y0;
  const fx = x - x0, fy = y - y0;
  const a = (y0 * W + x0) * 4, b = (y0 * W + x1) * 4, c = (y1 * W + x0) * 4, d = (y1 * W + x1) * 4;
  for (let k = 0; k < 3; k++) {
    const t0 = tab[a + k] + (tab[b + k] - tab[a + k]) * fx;
    const t1 = tab[c + k] + (tab[d + k] - tab[c + k]) * fx;
    out[k] = t0 + (t1 - t0) * fy;
  }
  return out;
}

const uvS = [0, 0];
const odS = [0, 0, 0];

/**
 * The transmittance table (RGBA floats, alpha 1): each texel the optical depth to the top of the air summed directly
 * along its (r, mu), as its transmittance, with no planet in the way (whoever reads it adds the planet's shadow).
 */
export function buildTransmittance(rec, { width: W, height: H, steps } = TABLES.transmittance) {
  const out = new Float32Array(W * H * 4);
  const bottom = rec[F.bottom], top = rec[F.top];
  const Hh = Math.sqrt(top * top - bottom * bottom);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const xMu = i / (W - 1), xR = j / (H - 1);
      const rho = Hh * xR;
      const r = Math.sqrt(rho * rho + bottom * bottom);
      const dMin = top - r, dMax = rho + Hh;
      const d = dMin + xMu * (dMax - dMin);
      let mu = d === 0 ? 1 : (Hh * Hh - rho * rho - d * d) / (2 * r * d);
      mu = mu < -1 ? -1 : mu > 1 ? 1 : mu;
      opticalDepth(rec, r, mu, steps, odS);
      const o = (j * W + i) * 4;
      out[o] = Math.exp(-odS[0]); out[o + 1] = Math.exp(-odS[1]); out[o + 2] = Math.exp(-odS[2]); out[o + 3] = 1;
    }
  }
  return out;
}

/** The sun's transmittance from a table at (r, mu), the planet's soft shadow on it, into `out`. */
export function transmittanceAt(rec, tabs, r, mu, out) {
  transmittanceUv(r, mu, rec[F.bottom], rec[F.top], tabs.size.tw, tabs.size.th, uvS);
  bilinear(tabs.T, tabs.size.tw, tabs.size.th, uvS[0], uvS[1], out);
  const s = sunShare(r, mu, rec[F.bottom]);
  out[0] *= s; out[1] *= s; out[2] *= s;
  return out;
}

/** The multiple-scattering table's coordinates (on texel centres) for (r, muS). */
export function multiScatterUv(r, muS, bottom, top, W, H, out) {
  let x = 0.5 + 0.5 * muS, y = (r - bottom) / (top - bottom);
  x = x < 0 ? 0 : x > 1 ? 1 : x; y = y < 0 ? 0 : y > 1 ? 1 : y;
  out[0] = 0.5 / W + x * (1 - 1 / W);
  out[1] = 0.5 / H + y * (1 - 1 / H);
  return out;
}
export function multiScatterAt(rec, tabs, r, muS, out) {
  multiScatterUv(r, muS, rec[F.bottom], rec[F.top], tabs.size.mw, tabs.size.mh, uvS);
  return bilinear(tabs.MS, tabs.size.mw, tabs.size.mh, uvS[0], uvS[1], out);
}

/** `n` directions spread evenly over the sphere (a Fibonacci spiral), as x, y, z: the multiple scattering's rays. */
export function sphereDirections(n) {
  const out = new Float64Array(n * 3);
  const golden = PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const s = Math.sqrt(Math.max(0, 1 - y * y));
    out[i * 3] = Math.cos(golden * i) * s; out[i * 3 + 1] = y; out[i * 3 + 2] = Math.sin(golden * i) * s;
  }
  return out;
}

const tS = [0, 0, 0];
const tintS = [1, 1, 1];

/**
 * Hillaire's multiple-scattering share at `r` with the sun at zenith cosine `muS` (per unit of the sun's illuminance,
 * the isotropic phase included), as the game's `psiOf`: the second order the sphere of rays round the point gathers
 * (the ground's bounce at a ray's end included), over one less the share the medium hands on at each further order.
 */
export function multiScatterOf(rec, tabs, r, muS, dirs, steps, out) {
  const bottom = rec[F.bottom], top = rec[F.top];
  const sx = Math.sqrt(Math.max(0, 1 - muS * muS)), sy = muS;
  const mieS = rec[F.mieS], mieT = mieS + rec[F.mieA];
  // (wave B) the haze's scattering by channel (its extinction stays grey)
  hazeTintOf(rec, tintS);
  const mS0 = mieS * tintS[0], mS1 = mieS * tintS[1], mS2 = mieS * tintS[2];
  // (pass 2, wave 6) the smoke and ash's extinction and scattering, added after the rest where the record carries them
  const smoke = hasSmoke(rec);
  const n = dirs.length / 3;
  let L0 = 0, L1 = 0, L2 = 0, f0 = 0, f1 = 0, f2 = 0;
  for (let k = 0; k < n; k++) {
    const dx = dirs[k * 3], dy = dirs[k * 3 + 1], dz = dirs[k * 3 + 2];
    const ground = hitsGround(r, dy, bottom);
    let len;
    if (ground) len = Math.max(0, -r * dy - Math.sqrt(Math.max(0, r * r * (dy * dy - 1) + bottom * bottom)));
    else len = Math.max(0, -r * dy + Math.sqrt(Math.max(0, r * r * (dy * dy - 1) + top * top)));
    let T0 = 1, T1 = 1, T2 = 1, prev = 0;
    for (let i = 0; i < steps; i++) {
      const u = (i + 1) / steps;
      const e1 = len * u * u;
      const dt = e1 - prev;
      const t = prev + 0.5 * dt;
      prev = e1;
      const px = t * dx, py = r + t * dy, pz = t * dz;
      const rr = Math.sqrt(px * px + py * py + pz * pz);
      densities(rec, rr - bottom, mS);
      const sR0 = rec[F.rayR] * mS[0], sR1 = rec[F.rayG] * mS[0], sR2 = rec[F.rayB] * mS[0];
      let e0 = sR0 + mieT * mS[1] + rec[F.ozR] * mS[2];
      let ec1 = sR1 + mieT * mS[1] + rec[F.ozG] * mS[2];
      let e2 = sR2 + mieT * mS[1] + rec[F.ozB] * mS[2];
      transmittanceAt(rec, tabs, rr, (px * sx + py * sy) / rr, tS);
      let s0 = sR0 + mS0 * mS[1], s1 = sR1 + mS1 * mS[1], s2 = sR2 + mS2 * mS[1];
      if (smoke) {
        const dS = mS[3];
        e0 += rec[F.smokeER] * dS; ec1 += rec[F.smokeEG] * dS; e2 += rec[F.smokeEB] * dS;
        s0 += rec[F.smokeSR] * dS; s1 += rec[F.smokeSG] * dS; s2 += rec[F.smokeSB] * dS;
      }
      const st0 = Math.exp(-e0 * dt), st1 = Math.exp(-ec1 * dt), st2 = Math.exp(-e2 * dt);
      const g0 = e0 > 1e-12 ? (1 - st0) / e0 : dt, g1 = ec1 > 1e-12 ? (1 - st1) / ec1 : dt, g2 = e2 > 1e-12 ? (1 - st2) / e2 : dt;
      L0 += T0 * s0 * tS[0] * INV_4PI * g0; L1 += T1 * s1 * tS[1] * INV_4PI * g1; L2 += T2 * s2 * tS[2] * INV_4PI * g2;
      f0 += T0 * s0 * g0; f1 += T1 * s1 * g1; f2 += T2 * s2 * g2;
      T0 *= st0; T1 *= st1; T2 *= st2;
    }
    if (ground) {
      const gx = len * dx, gy = r + len * dy, gz = len * dz;
      const gr = Math.sqrt(gx * gx + gy * gy + gz * gz);
      const muG = (gx * sx + gy * sy) / gr;
      if (muG > 0) {
        transmittanceAt(rec, tabs, gr, muG, tS);
        L0 += (T0 * rec[F.groundR] * tS[0] * muG) / PI;
        L1 += (T1 * rec[F.groundG] * tS[1] * muG) / PI;
        L2 += (T2 * rec[F.groundB] * tS[2] * muG) / PI;
      }
    }
  }
  const inv = 1 / n;
  const m0 = f0 * inv, m1 = f1 * inv, m2 = f2 * inv;
  out[0] = (L0 * inv) / (1 - (m0 < 0.99 ? m0 : 0.99));
  out[1] = (L1 * inv) / (1 - (m1 < 0.99 ? m1 : 0.99));
  out[2] = (L2 * inv) / (1 - (m2 < 0.99 ? m2 : 0.99));
  return out;
}

export function buildMultiScatter(rec, tabs, { width: W, height: H, dirs: nd, steps } = TABLES.multiScatter) {
  const out = new Float32Array(W * H * 4);
  const dirs = sphereDirections(nd);
  const bottom = rec[F.bottom], top = rec[F.top];
  const tmp = [0, 0, 0];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const muS = (i / (W - 1)) * 2 - 1;
      const r = Math.min(bottom + (j / (H - 1)) * (top - bottom) + 0.001, top - 0.001);
      multiScatterOf(rec, tabs, r, muS, dirs, steps, tmp);
      const o = (j * W + i) * 4;
      out[o] = tmp[0]; out[o + 1] = tmp[1]; out[o + 2] = tmp[2]; out[o + 3] = 1;
    }
  }
  return out;
}

// Gauss and Legendre's nodes on [-1, 1] for the hemisphere's rings.
const GL6 = [-0.9324695142, -0.6612093865, -0.2386191861, 0.2386191861, 0.6612093865, 0.9324695142];
const GL6W = [0.1713244924, 0.3607615730, 0.4679139346, 0.4679139346, 0.3607615730, 0.1713244924];

/**
 * The sky's light on a level piece of ground (per unit of the sun's illuminance) by the sun's zenith cosine, from
 * -1 to 1 across the table: the air's own radiance gathered over the upper hemisphere (six rings by Gauss and
 * Legendre, each weighted by its cosine, twelve azimuths), each ray by `marchAir`. It is the twilight's light on the
 * ground once the sun has set, and the blue fill by day.
 */
export function buildIrradiance(rec, tabs, { width: W, rings, azimuths, steps } = TABLES.irradiance) {
  const out = new Float32Array(W * 4);
  const bottom = rec[F.bottom];
  const o = [0, bottom + 0.01, 0];
  const L = new Float64Array(6);
  for (let i = 0; i < W; i++) {
    const muS = (i / (W - 1)) * 2 - 1;
    const lx = Math.sqrt(Math.max(0, 1 - muS * muS)), ly = muS;
    let E0 = 0, E1 = 0, E2 = 0;
    for (let a = 0; a < rings; a++) {
      const mu = 0.5 + 0.5 * GL6[a];
      const w = 0.5 * GL6W[a] * mu * ((2 * PI) / azimuths);
      const s = Math.sqrt(Math.max(0, 1 - mu * mu));
      for (let b = 0; b < azimuths; b++) {
        const ph = ((b + 0.5) / azimuths) * 2 * PI;
        marchAir(rec, tabs, o[0], o[1], o[2], s * Math.cos(ph), mu, s * Math.sin(ph), lx, ly, 0, steps, NaN, null, L);
        E0 += w * L[0]; E1 += w * L[1]; E2 += w * L[2];
      }
    }
    out[i * 4] = E0; out[i * 4 + 1] = E1; out[i * 4 + 2] = E2; out[i * 4 + 3] = 1;
  }
  return out;
}
export function irradianceAt(tabs, muS, out) {
  const W = tabs.size.ew;
  let x = 0.5 + 0.5 * muS; x = x < 0 ? 0 : x > 1 ? 1 : x;
  return bilinear(tabs.E, W, 1, 0.5 / W + x * (1 - 1 / W), 0.5, out);
}

/** A record's three tables (made in some tens of milliseconds), with its key. */
export function makeTables(rec, sizes = TABLES) {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const tabs = {
    rec: Float64Array.from(rec),
    key: recordKey(rec),
    size: { tw: sizes.transmittance.width, th: sizes.transmittance.height, mw: sizes.multiScatter.width, mh: sizes.multiScatter.height, ew: sizes.irradiance.width },
    T: null, MS: null, E: null, ms: 0,
  };
  tabs.T = buildTransmittance(tabs.rec, sizes.transmittance);
  tabs.MS = buildMultiScatter(tabs.rec, tabs, sizes.multiScatter);
  tabs.E = buildIrradiance(tabs.rec, tabs, sizes.irradiance);
  tabs.ms = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  return tabs;
}

// ---------------------------------------------------------------- the march (the shader's own, on the CPU)

/** The gains of the owner's limb and twilight dials (1, 1: the physical air). */
export const NO_GAINS = { limb: 1, twilight: 1 };

/** The limb dial's weight for a ray whose nearest approach to the centre is `b` km: 0 over the disc's middle, 1 at the limb and beyond. */
export const limbWeight = (b, bottom) => smoothstep(0.75, 1.0, b / bottom);
/** The twilight dial's weight for the sun at zenith cosine `mu` at a point: 1 where it is low or just set, 0 high in the sky. */
export const twilightWeight = (mu) => 1 - smoothstep(-0.08, 0.15, mu);

const msS = [0, 0, 0];

/**
 * The march: from an eye at `o` (km from the body's centre) along the unit `d`, lit by the sun toward the unit `l`,
 * through the shell in `steps` steps; into `out` [0..2] the light the air adds (per unit of the sun's illuminance)
 * and [3..5] the share of what lies behind that comes through. The ray is taken from where it enters the air (or the
 * eye, inside it) to where it leaves it, meets the ground, or reaches `sEnd` (km along the ray past its nearest
 * approach to the centre, the shader's own measure: a surface's or a cloud's point; NaN for none). The steps are laid
 * by the square of their distance from the ray's lowest point, from both sides, so the thin dense air there has most
 * of them; each is integrated exactly over its own extinction. `gains` the limb and twilight dials (null: 1 and 1).
 * `lay` (the GPU port's pass 2, wave 4b) is the power the steps are laid by: 2, the square, the viewer's own and the start;
 * 1.5, the game's bodies' (`BODY_LAY`), which holds the game's ground path within 1.5% on the limb at 12 steps where the
 * square reads 3.45% (the square crowds the steps so near the lowest point that the haze's layer a few km up gets few).
 */
export function marchAir(rec, tabs, ox, oy, oz, dx, dy, dz, lx, ly, lz, steps, sEnd, gains, out, lay = 2) {
  const bottom = rec[F.bottom], top = rec[F.top];
  const tc = -(ox * dx + oy * dy + oz * dz);
  const px = ox + dx * tc, py = oy + dy * tc, pz = oz + dz * tc;
  const b2 = px * px + py * py + pz * pz;
  out[0] = out[1] = out[2] = 0;
  out[3] = out[4] = out[5] = 1;
  if (b2 >= top * top) return out;
  const hc = Math.sqrt(top * top - b2);
  const sCam = -tc;
  const s0 = Math.max(-hc, sCam);
  let s1 = hc;
  if (b2 < bottom * bottom) { const sg = -Math.sqrt(bottom * bottom - b2); if (sg > s0) s1 = sg; }
  if (sEnd === sEnd && sEnd < s1) s1 = sEnd;
  const len = s1 - s0;
  if (!(len > 0)) return out;
  const sStar = Math.min(Math.max(0, s0), s1);
  const La = sStar - s0, Lb = s1 - sStar;
  const a = La / len;
  const map = lay === 2
    ? (u) => (u < a ? sStar - La * ((a - u) / a) ** 2 : sStar + Lb * (a < 1 ? ((u - a) / (1 - a)) ** 2 : 0))
    : (u) => (u < a ? sStar - La * ((a - u) / a) ** lay : sStar + Lb * (a < 1 ? ((u - a) / (1 - a)) ** lay : 0));
  const mieS = rec[F.mieS], mieT = mieS + rec[F.mieA], g = rec[F.mieG];
  // (wave B) the haze's scattering by channel; its extinction (mieT) grey
  hazeTintOf(rec, tintS);
  const mS0 = mieS * tintS[0], mS1 = mieS * tintS[1], mS2 = mieS * tintS[2];
  const c = dx * lx + dy * ly + dz * lz;
  const pR = rayleighPhase(c), pM = miePhase(c, g);
  const gl = gains ? gains.limb : 1, gt = gains ? gains.twilight : 1;
  // (pass 2, wave 6) the smoke and ash and the glow from below, summed after the rest where the record carries them
  const smoke = hasSmoke(rec);
  const pS = smoke ? miePhase(c, rec[F.smokeG]) : 0;
  let L0 = 0, L1 = 0, L2 = 0, T0 = 1, T1 = 1, T2 = 1;
  let sA = map(0);
  for (let i = 0; i < steps; i++) {
    const sB = map((i + 1) / steps);
    const dt = sB - sA;
    const s = 0.5 * (sA + sB);
    sA = sB;
    const xx = px + dx * s, xy = py + dy * s, xz = pz + dz * s;
    const r = Math.sqrt(xx * xx + xy * xy + xz * xz);
    densities(rec, r - bottom, mS);
    const sR0 = rec[F.rayR] * mS[0], sR1 = rec[F.rayG] * mS[0], sR2 = rec[F.rayB] * mS[0];
    const sM0 = mS0 * mS[1], sM1 = mS1 * mS[1], sM2 = mS2 * mS[1];
    let e0 = sR0 + mieT * mS[1] + rec[F.ozR] * mS[2];
    let e1 = sR1 + mieT * mS[1] + rec[F.ozG] * mS[2];
    let e2 = sR2 + mieT * mS[1] + rec[F.ozB] * mS[2];
    const muS = (xx * lx + xy * ly + xz * lz) / r;
    transmittanceAt(rec, tabs, r, muS, tS);
    multiScatterAt(rec, tabs, r, muS, msS);
    const tw = 1 + (gt - 1) * twilightWeight(muS);
    let S0 = (tS[0] * (sR0 * pR + sM0 * pM) + msS[0] * (sR0 + sM0)) * tw;
    let S1 = (tS[1] * (sR1 * pR + sM1 * pM) + msS[1] * (sR1 + sM1)) * tw;
    let S2 = (tS[2] * (sR2 * pR + sM2 * pM) + msS[2] * (sR2 + sM2)) * tw;
    if (smoke) {
      const dS = mS[3];
      const sS0 = rec[F.smokeSR] * dS, sS1 = rec[F.smokeSG] * dS, sS2 = rec[F.smokeSB] * dS;
      e0 += rec[F.smokeER] * dS; e1 += rec[F.smokeEG] * dS; e2 += rec[F.smokeEB] * dS;
      S0 += (tS[0] * sS0 * pS + msS[0] * sS0) * tw;
      S1 += (tS[1] * sS1 * pS + msS[1] * sS1) * tw;
      S2 += (tS[2] * sS2 * pS + msS[2] * sS2) * tw;
      glowUp(rec, r - bottom, gU);
      S0 += (sR0 + sM0 + sS0) * gU[0] * GLOW_PHASE;
      S1 += (sR1 + sM1 + sS1) * gU[1] * GLOW_PHASE;
      S2 += (sR2 + sM2 + sS2) * gU[2] * GLOW_PHASE;
    }
    const st0 = Math.exp(-e0 * dt), st1 = Math.exp(-e1 * dt), st2 = Math.exp(-e2 * dt);
    L0 += T0 * S0 * (e0 > 1e-12 ? (1 - st0) / e0 : dt);
    L1 += T1 * S1 * (e1 > 1e-12 ? (1 - st1) / e1 : dt);
    L2 += T2 * S2 * (e2 > 1e-12 ? (1 - st2) / e2 : dt);
    T0 *= st0; T1 *= st1; T2 *= st2;
  }
  const lw = 1 + (gl - 1) * limbWeight(Math.sqrt(b2), bottom);
  out[0] = L0 * lw; out[1] = L1 * lw; out[2] = L2 * lw;
  out[3] = T0; out[4] = T1; out[5] = T2;
  return out;
}

/**
 * The reference the march is held to: the same ray summed directly, `steps` even steps, each step's sunlight by a
 * direct optical-depth sum (no table), the multiple scattering's share from its table (it has no direct sum: it is a
 * table by nature), no dials. Slow; for the tests.
 */
export function marchDirect(rec, tabs, ox, oy, oz, dx, dy, dz, lx, ly, lz, steps, sEnd, out, sunSteps = 200, withMs = true) {
  const bottom = rec[F.bottom], top = rec[F.top];
  const tc = -(ox * dx + oy * dy + oz * dz);
  const px = ox + dx * tc, py = oy + dy * tc, pz = oz + dz * tc;
  const b2 = px * px + py * py + pz * pz;
  out[0] = out[1] = out[2] = 0; out[3] = out[4] = out[5] = 1;
  if (b2 >= top * top) return out;
  const hc = Math.sqrt(top * top - b2);
  const s0 = Math.max(-hc, -tc);
  let s1 = hc;
  if (b2 < bottom * bottom) { const sg = -Math.sqrt(bottom * bottom - b2); if (sg > s0) s1 = sg; }
  if (sEnd === sEnd && sEnd < s1) s1 = sEnd;
  const len = s1 - s0;
  if (!(len > 0)) return out;
  const mieS = rec[F.mieS], mieT = mieS + rec[F.mieA], g = rec[F.mieG];
  // (wave B) the haze's scattering by channel, read straight from the record's three numbers (no shared helper)
  const k0 = rec.length > F.mieTintB ? rec[F.mieTintR] : 1, k1 = rec.length > F.mieTintB ? rec[F.mieTintG] : 1, k2 = rec.length > F.mieTintB ? rec[F.mieTintB] : 1;
  const c = dx * lx + dy * ly + dz * lz;
  const pR = rayleighPhase(c), pM = miePhase(c, g);
  // (pass 2, wave 6) the smoke and ash and the glow, summed where the record carries them (no shared step with the march)
  const smoke = hasSmoke(rec);
  const pS = smoke ? miePhase(c, rec[F.smokeG]) : 0;
  const gD = [0, 0, 0];
  const dt = len / steps;
  let L0 = 0, L1 = 0, L2 = 0, O0 = 0, O1 = 0, O2 = 0;
  const td = [0, 0, 0];
  for (let i = 0; i < steps; i++) {
    const s = s0 + (i + 0.5) * dt;
    const xx = px + dx * s, xy = py + dy * s, xz = pz + dz * s;
    const r = Math.sqrt(xx * xx + xy * xy + xz * xz);
    densities(rec, r - bottom, mS);
    const sR0 = rec[F.rayR] * mS[0], sR1 = rec[F.rayG] * mS[0], sR2 = rec[F.rayB] * mS[0];
    const sM0 = mieS * k0 * mS[1], sM1 = mieS * k1 * mS[1], sM2 = mieS * k2 * mS[1];
    let e0 = sR0 + mieT * mS[1] + rec[F.ozR] * mS[2];
    let e1 = sR1 + mieT * mS[1] + rec[F.ozG] * mS[2];
    let e2 = sR2 + mieT * mS[1] + rec[F.ozB] * mS[2];
    // (the layer's density read here: the direct transmittance below sums its own densities into the same scratch)
    const dS = mS[3];
    const muS = (xx * lx + xy * ly + xz * lz) / r;
    transmittanceDirect(rec, r, muS, sunSteps, td);
    if (withMs) multiScatterAt(rec, tabs, r, muS, msS); else msS[0] = msS[1] = msS[2] = 0;
    let J0 = td[0] * (sR0 * pR + sM0 * pM) + msS[0] * (sR0 + sM0);
    let J1 = td[1] * (sR1 * pR + sM1 * pM) + msS[1] * (sR1 + sM1);
    let J2 = td[2] * (sR2 * pR + sM2 * pM) + msS[2] * (sR2 + sM2);
    if (smoke) {
      const sS0 = rec[F.smokeSR] * dS, sS1 = rec[F.smokeSG] * dS, sS2 = rec[F.smokeSB] * dS;
      e0 += rec[F.smokeER] * dS; e1 += rec[F.smokeEG] * dS; e2 += rec[F.smokeEB] * dS;
      glowUp(rec, r - bottom, gD);
      J0 += td[0] * sS0 * pS + msS[0] * sS0 + (sR0 + sM0 + sS0) * gD[0] * GLOW_PHASE;
      J1 += td[1] * sS1 * pS + msS[1] * sS1 + (sR1 + sM1 + sS1) * gD[1] * GLOW_PHASE;
      J2 += td[2] * sS2 * pS + msS[2] * sS2 + (sR2 + sM2 + sS2) * gD[2] * GLOW_PHASE;
    }
    // the view's transmittance to the middle of this step
    const v0 = Math.exp(-(O0 + 0.5 * e0 * dt)), v1 = Math.exp(-(O1 + 0.5 * e1 * dt)), v2 = Math.exp(-(O2 + 0.5 * e2 * dt));
    L0 += v0 * J0 * dt;
    L1 += v1 * J1 * dt;
    L2 += v2 * J2 * dt;
    O0 += e0 * dt; O1 += e1 * dt; O2 += e2 * dt;
  }
  out[0] = L0; out[1] = L1; out[2] = L2;
  out[3] = Math.exp(-O0); out[4] = Math.exp(-O1); out[5] = Math.exp(-O2);
  return out;
}

// ---------------------------------------------------------------- the light on the body (the shader's, on the CPU)

/**
 * The sunlight and skylight a point of the ground (or of a cloud deck at `r` km) receives, per unit of the sun's
 * illuminance, into `out` [0..2] the sun's share that reaches it through the air (reddened and dimmed toward the
 * terminator, nothing past it) and [3..5] the sky's light on it (the twilight after the sun has set).
 */
export function lightAt(rec, tabs, r, muS, out) {
  transmittanceAt(rec, tabs, r, muS, tS);
  out[0] = tS[0]; out[1] = tS[1]; out[2] = tS[2];
  irradianceAt(tabs, muS, tS);
  out[3] = tS[0]; out[4] = tS[1]; out[5] = tS[2];
  return out;
}

// ---------------------------------------------------------------- the shader half

/**
 * The march and the light as TSL nodes. `T` is three's TSL namespace (`import * as TSL from 'three/tsl'`), `U` the
 * look's air uniforms (`airUniforms`'s shape, three's uniform nodes), `tex` the three tables as texture objects
 * ({ T, MS, E }), `steps` the march's count (8, 12 or 16). Every table read is `textureSampleLevel` (never the implicit
 * kind, so the loop and its selects are allowed to read them). The march must be called inside a `Fn` (it makes its
 * own variables and loop): it returns `{ L, Tv }`. `lay` the power the steps are laid by (`marchAir`'s): 2, the square
 * (the viewer's, and the start: its graph as it always was), or 1.5 (the game's bodies', u times its square root).
 */
export function airShader(T, U, tex, steps, lay = 2) {
  const { float, vec2, vec3, dot, sqrt, max, min, clamp, exp, abs, mix, select, smoothstep, texture, Loop, If } = T;
  const TW = TABLES.transmittance.width, TH = TABLES.transmittance.height;
  const MW = TABLES.multiScatter.width, MH = TABLES.multiScatter.height;
  const EW = TABLES.irradiance.width;
  const bottom = U.bottom, top = U.top;

  const transmit = (r, mu) => {
    const Hh = sqrt(max(top.mul(top).sub(bottom.mul(bottom)), 1e-6));
    const rr = clamp(r, bottom, top);
    const rho = sqrt(max(rr.mul(rr).sub(bottom.mul(bottom)), 0.0));
    const disc = rr.mul(rr).mul(mu.mul(mu).sub(1.0)).add(top.mul(top));
    const d = max(rr.negate().mul(mu).add(sqrt(max(disc, 0.0))), 0.0);
    const dMin = top.sub(rr), dMax = rho.add(Hh);
    const xMu = clamp(d.sub(dMin).div(max(dMax.sub(dMin), 1e-6)), 0.0, 1.0);
    const xR = clamp(rho.div(Hh), 0.0, 1.0);
    const uv = vec2(xMu.mul(1 - 1 / TW).add(0.5 / TW), xR.mul(1 - 1 / TH).add(0.5 / TH));
    const hz = sqrt(max(float(1).sub(bottom.div(max(r, bottom)).pow(2.0)), 0.0)).negate();
    return texture(tex.T, uv).level(0).rgb.mul(smoothstep(-SHADOW_SOFT, SHADOW_SOFT, mu.sub(hz)));
  };
  const multi = (r, mu) => {
    const x = clamp(mu.mul(0.5).add(0.5), 0.0, 1.0);
    const y = clamp(r.sub(bottom).div(top.sub(bottom)), 0.0, 1.0);
    return texture(tex.MS, vec2(x.mul(1 - 1 / MW).add(0.5 / MW), y.mul(1 - 1 / MH).add(0.5 / MH))).level(0).rgb;
  };
  const sky = (mu) => {
    const x = clamp(mu.mul(0.5).add(0.5), 0.0, 1.0);
    return texture(tex.E, vec2(x.mul(1 - 1 / EW).add(0.5 / EW), 0.5)).level(0).rgb;
  };
  const RK = 3 / (16 * Math.PI), MK = 3 / (8 * Math.PI);

  /**
   * The march along the view ray `rd` (view space, unit) past a body whose centre is `C` (view space, scene units),
   * `kmPer` km a scene unit, ending at `sEnd` (km past the nearest approach; null: the top or the ground), lit by the
   * sun toward `Ls` (view space, unit). Returns { L, Tv, b } (b the nearest approach, km).
   */
  const march = (rd, C, kmPer, Ls, sEnd = null) => {
    const tc = dot(C, rd);
    const P = rd.mul(tc).sub(C).mul(kmPer); // from the centre to the nearest approach, km
    const b2 = dot(P, P);
    const top2 = top.mul(top), bot2 = bottom.mul(bottom);
    const hc = sqrt(max(top2.sub(b2), 0.0));
    const sCam = tc.mul(kmPer).negate();
    const s0 = max(hc.negate(), sCam);
    const sg = sqrt(max(bot2.sub(b2), 0.0)).negate();
    let s1 = select(b2.lessThan(bot2).and(sg.greaterThan(s0)), sg, hc);
    if (sEnd) s1 = min(s1, sEnd);
    const len = max(s1.sub(s0), 0.0);
    const sStar = clamp(float(0), s0, max(s1, s0));
    const La = sStar.sub(s0), Lb = max(s1, s0).sub(sStar);
    const a = clamp(La.div(max(len, 1e-6)), 0.0, 1.0);
    const map = (u) => {
      const ua = a.sub(u).div(max(a, 1e-6));
      const ub = u.sub(a).div(max(float(1).sub(a), 1e-6));
      // 1.5: u times its root (never a pow of nought); 2: the square, the graph as it always was.
      const pa = lay === 1.5 ? ua.mul(sqrt(max(ua, 0.0))) : ua.mul(ua);
      const pb = lay === 1.5 ? ub.mul(sqrt(max(ub, 0.0))) : ub.mul(ub);
      return select(u.lessThan(a), sStar.sub(La.mul(pa)), sStar.add(Lb.mul(pb)));
    };
    const c = dot(rd, Ls);
    const pR = c.mul(c).add(1.0).mul(RK);
    const g = U.mieG, g2 = g.mul(g);
    const den = g2.add(1.0).sub(g.mul(2.0).mul(c));
    const pM = float(MK).mul(float(1).sub(g2)).mul(c.mul(c).add(1.0)).div(g2.add(2.0).mul(den).mul(sqrt(den)));
    const mieT = U.mieS.add(U.mieA);
    // (pass 2, wave 6) the smoke and ash and the glow from below, where the caller hands their uniforms (`smokeE` and the
    // rest): the graph of a caller that hands none is the one it always was
    const smoke = !!U.smokeE;
    const pS = smoke ? (() => {
      const gS = U.smokeG, gS2 = gS.mul(gS);
      const denS = gS2.add(1.0).sub(gS.mul(2.0).mul(c));
      return float(MK).mul(float(1).sub(gS2)).mul(c.mul(c).add(1.0)).div(gS2.add(2.0).mul(denS).mul(sqrt(denS)));
    })() : null;
    const L = vec3(0).toVar();
    const Tv = vec3(1).toVar();
    const sA = map(float(0)).toVar();
    const active = len.greaterThan(0.0).and(b2.lessThan(top2));
    Loop(steps, ({ i }) => {
      // (dt and s are kept as variables before sA moves on: a node is an expression, read where it is used)
      const sB = map(float(i).add(1.0).div(steps)).toVar();
      const dt = select(active, sB.sub(sA), float(0)).toVar();
      const s = sA.add(sB).mul(0.5).toVar();
      sA.assign(sB);
      const x = P.add(rd.mul(s));
      const r = max(sqrt(dot(x, x)), bottom.mul(0.999));
      const h = max(r.sub(bottom), 0.0);
      const dR = exp(h.negate().div(max(U.rayH, 1e-4)));
      const dM = exp(h.negate().div(max(U.mieH, 1e-4)));
      const dO = max(float(1).sub(abs(h.sub(U.ozC)).div(max(U.ozW, 1e-4))), 0.0);
      const sR = U.ray.mul(dR);
      // (wave B) the haze's scattering by channel (its colour); the extinction below stays grey
      const sM = U.mieTint ? U.mieTint.mul(U.mieS.mul(dM)) : U.mieS.mul(dM);
      let ext = sR.add(mieT.mul(dM)).add(U.oz.mul(dO));
      const muS = dot(x, Ls).div(r);
      const tw = mix(float(1), U.twilight, float(1).sub(smoothstep(-0.08, 0.15, muS)));
      const tT = transmit(r, muS), mT = multi(r, muS);
      let S = tT.mul(sR.mul(pR).add(sM.mul(pM))).add(mT.mul(sR.add(sM))).mul(tw);
      if (smoke) {
        // the layer's tent, its extinction and scattering, its light by its own phase and the multiple scattering's share,
        // and the glow from below dimmed on its way up (`glowUp`), every scatterer sending `GLOW_PHASE` of it; all of it
        // behind a branch on the uniforms (a layer or a glow at all: the red channel of either), so a body whose record has
        // none pays nothing for it (measured: Naboo from Rori at High, 11% of the screen, +0.011 ms with the sums always run)
        const extV = ext.toVar();
        const SV = S.toVar();
        If(U.smokeE.x.add(U.glow.x).greaterThan(0.0), () => {
          const dS = max(float(1).sub(abs(h.sub(U.smokeC)).div(max(U.smokeW, 1e-6))), 0.0);
          const sS = U.smokeS.mul(dS);
          extV.addAssign(U.smokeE.mul(dS));
          SV.addAssign(tT.mul(sS.mul(pS)).add(mT.mul(sS)).mul(tw));
          const col = (z) => {
            const w = max(U.smokeW, 1e-6);
            const a = clamp(z.sub(U.smokeC).add(w), 0.0, w);
            const bb = clamp(z.sub(U.smokeC), 0.0, w);
            return a.mul(a).div(w.mul(2.0)).add(bb).sub(bb.mul(bb).div(w.mul(2.0)));
          };
          const cR = U.rayH.mul(float(1).sub(exp(h.negate().div(max(U.rayH, 1e-4)))));
          const cM = U.mieH.mul(float(1).sub(exp(h.negate().div(max(U.mieH, 1e-4)))));
          const cS = col(h).sub(col(float(0)));
          const tauUp = U.ray.mul(cR).add(mieT.mul(cM)).add(U.smokeE.mul(cS));
          const up = U.glow.mul(exp(tauUp.mul(-DIFFUSIVITY)));
          SV.addAssign(sR.add(sM).add(sS).mul(up).mul(GLOW_PHASE));
        });
        ext = extV;
        S = SV;
      }
      const st = exp(ext.mul(dt).negate());
      const gain = select(ext.greaterThan(vec3(1e-9)), float(1).sub(st).div(max(ext, vec3(1e-9))), vec3(dt));
      L.addAssign(Tv.mul(S).mul(gain));
      Tv.mulAssign(st);
    });
    const b = sqrt(b2);
    const lw = mix(float(1), U.limb, smoothstep(0.75, 1.0, b.div(bottom)));
    return { L: L.mul(lw), Tv, b, P, s0, s1 };
  };

  /** The point `x` (km from the centre, view space): the sun's share reaching it through the air, and the sky's light on it. */
  const lightAt = (r, muS) => ({ sun: transmit(r, muS), sky: sky(muS) });

  return { march, lightAt, transmit, multi, sky };
}

/** The look's air uniforms' starting values (the build makes them three uniforms of these shapes). */
export function airUniformValues(rec, a) {
  return {
    bottom: rec[F.bottom], top: rec[F.top],
    ray: [rec[F.rayR], rec[F.rayG], rec[F.rayB]], rayH: rec[F.rayH],
    mieS: rec[F.mieS], mieA: rec[F.mieA], mieH: rec[F.mieH], mieG: rec[F.mieG],
    oz: [rec[F.ozR], rec[F.ozG], rec[F.ozB]], ozC: rec[F.ozC], ozW: rec[F.ozW],
    limb: a.limbBright, twilight: a.twilightBright,
    // (wave B) the haze's colour (1, 1, 1 for a record without one)
    mieTint: hazeTintOf(rec, [1, 1, 1]),
    // (pass 2, wave 6) the smoke and ash (none for a record without) and the glow from below over the record's sun
    ...smokeUniformValues(rec),
  };
}

/**
 * (pass 2, wave 6) The smoke and ash's uniforms' values for a record (none for a record of 28 numbers or fewer): its
 * extinction and scattering at its peak, its middle and half depth, its phase, and its glow per unit of the record's sun.
 */
export function smokeUniformValues(rec) {
  const has = rec.length > F.glowB;
  const k = has && rec[F.sunStrength] > 1e-9 ? 1 / rec[F.sunStrength] : 0;
  return {
    smokeE: has ? [rec[F.smokeER], rec[F.smokeEG], rec[F.smokeEB]] : [0, 0, 0],
    smokeS: has ? [rec[F.smokeSR], rec[F.smokeSG], rec[F.smokeSB]] : [0, 0, 0],
    smokeC: has ? rec[F.smokeC] : SMOKE_NONE.c,
    smokeW: has ? rec[F.smokeW] : SMOKE_NONE.w,
    smokeG: has ? rec[F.smokeG] : SMOKE_NONE.g,
    glow: has ? [rec[F.glowR] * k, rec[F.glowG] * k, rec[F.glowB] * k] : [0, 0, 0],
  };
}

/** The quality settings: the march's steps. */
export const AIR_QUALITIES = [['low', 'Low (8 steps)', 8], ['medium', 'Medium (12 steps)', 12], ['high', 'High (16 steps)', 16]];
export const stepsOf = (q) => (AIR_QUALITIES.find(([k]) => k === q) || AIR_QUALITIES[1])[2];
