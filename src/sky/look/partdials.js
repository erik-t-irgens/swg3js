// The parts a generated look may carry besides its surface (wave 2 of the generated bodies): a
// shape (an irregular body, or a broken planet with its stream of debris), a belt or debris field of
// rocks, and rings. Plain data and the cleaning of saved choices only: no three, no page state.
//
// Each part has a version, as every recipe has: a look keeps the version it was made with, so an
// improved part is a new version and never changes what an older one makes. A look without a part
// is exactly what it was before parts existed.

const R = (k, label, min, max, step, def, title, more = {}) => ({ k, label, type: 'range', min, max, step, def, title, ...more });
const C = (k, label, def, title, more = {}) => ({ k, label, type: 'color', def, title, ...more });
const live = (d) => ({ ...d, live: true });

export const SHAPE_KINDS = [['', 'Round (as before)'], ['irregular', 'Irregular (asteroid, small moon)'], ['broken', 'Broken planet']];

export const IRREGULAR_DIALS = [
  R('size', 'Size', 0, 1, 0.01, 0.45, 'Rubble (0) to a small moon (1): the smaller the body, the lumpier it is and the larger its craters for its size'),
  R('lumps', 'Lumpiness', 0, 1, 0.01, 0.5, 'Big lumps and hollows'),
  R('elong', 'Elongation', 0, 1, 0.01, 0.35, 'Round (0) to a long potato (1)'),
  R('craters', 'Craters', 0, 1, 0.01, 0.5, 'How many craters are pressed into the shape'),
  R('craterSize', 'Crater size', 0.3, 2.5, 0.01, 1),
  R('facets', 'Broken faces', 0, 1, 0.01, 0.3, 'Flat faces where pieces split off'),
];

export const BROKEN_DIALS = [
  R('woundSize', 'Wound size', 10, 90, 1, 48, 'How much of the sphere is torn away, in degrees from the wound\'s centre', { unit: '°' }),
  R('woundYaw', 'Wound direction, round', -180, 180, 1, 70, 'Where on the body the wound is, round its axis', { unit: '°' }),
  R('woundPitch', 'Wound direction, up or down', -80, 80, 1, -15, undefined, { unit: '°' }),
  R('woundDepth', 'Wound depth', 0.05, 0.8, 0.01, 0.42, 'How deep the torn-out hollow goes, in body radii'),
  R('ragged', 'Ragged edge', 0, 1, 0.01, 0.65, 'A clean cut (0) to a crumbling, broken rim (1)'),
  live(C('rockColour', 'Exposed rock', '#3b3540')), live(C('strataColour', 'Rock layers', '#6b5d5c')),
  live(C('glowColour', 'Interior glow colour', '#ff7a2a')),
  live(R('glow', 'Interior glow', 0, 3, 0.01, 1, 'The molten heart showing at the bottom of the wound and in its cracks')),
  R('streamCount', 'Debris count', 0, 30000, 100, 9000, 'Rocks in the stream trailing from the wound', { group: 'Stream' }),
  R('streamLength', 'Stream length', 1, 14, 0.1, 7, 'In body radii', { group: 'Stream' }),
  R('streamSpread', 'Stream spread', 0, 1, 0.01, 0.45, 'How wide the stream fans out along its length', { group: 'Stream' }),
  R('streamTrail', 'Stream direction', -180, 180, 1, 40, 'Which way the stream leaves the wound, round the wound\'s centre', { unit: '°', group: 'Stream' }),
  R('streamCurve', 'Stream curve', -1, 1, 0.01, 0.3, 'How much the stream bends, as debris falling behind in orbit would', { group: 'Stream' }),
  R('streamRock', 'Rock size', 0.2, 3, 0.01, 1, undefined, { group: 'Stream' }),
  live(C('streamColour', 'Rock colour', '#5d586a', undefined, { group: 'Stream' })),
  live(R('streamDust', 'Dust glow', 0, 2, 0.01, 0.8, 'The haze of fine dust along the stream', { group: 'Stream' })),
  live(C('dustColour', 'Dust colour', '#7f90ff', undefined, { group: 'Stream' })),
];

export const BELT_KINDS = [['', 'None'], ['belt', 'A belt round the body'], ['field', 'A debris field (no orbit)']];

export const BELT_DIALS = [
  R('count', 'Rock count', 100, 40000, 100, 12000),
  R('sizeMin', 'Smallest rocks', 0.0005, 0.05, 0.0005, 0.002, 'In body radii'),
  R('sizeMax', 'Largest rocks', 0.002, 0.4, 0.001, 0.03, 'In body radii: there are many small rocks and few big ones'),
  live(C('colour', 'Rock colour', '#7a6e62')), live(C('colour2', 'Second rock colour', '#4e4a4a')),
  R('variety', 'Colour variety', 0, 1, 0.01, 0.5),
  R('inner', 'Inner edge', 1.1, 8, 0.01, 2, 'In body radii (a debris field: its hollow middle)'),
  R('outer', 'Outer edge', 1.2, 12, 0.01, 3, 'In body radii (a debris field: its size)'),
  R('thickness', 'Thickness', 0, 1, 0.01, 0.06, 'How far the rocks stray above and below the belt\'s plane (a debris field: how flattened it is, 1 round)'),
  R('gaps', 'Gaps', 0, 6, 1, 2, 'Clear lanes in the belt'),
  R('gapWidth', 'Gap width', 0, 0.3, 0.005, 0.06),
  R('clumps', 'Clumping', 0, 1, 0.01, 0.3, 'Rocks gathered into clusters'),
  live(R('dust', 'Dust', 0, 2, 0.01, 0.6, 'The soft dust band that carries the belt far off')),
  live(C('dustColour', 'Dust colour', '#9a8e80')),
];

export const RING_STYLES = [['', 'None'], ['dusty', 'Dusty'], ['icy', 'Icy'], ['banded', 'Banded']];

export const RING_DIALS = [
  R('inner', 'Inner edge', 1.05, 3, 0.01, 1.35, 'In body radii'),
  R('outer', 'Outer edge', 1.2, 5, 0.01, 2.3, 'In body radii'),
  R('bands', 'Banding', 0, 1, 0.01, 0.6, 'Broad bands of thicker and thinner ring'),
  R('fine', 'Fine ringlets', 0, 1, 0.01, 0.5),
  R('gaps', 'Gaps', 0, 6, 1, 2), R('gapWidth', 'Gap width', 0, 0.2, 0.005, 0.04),
  live(R('opacity', 'Opacity', 0, 1, 0.01, 0.75)),
  live(C('colour1', 'Colour', '#cdbb9c')), live(C('colour2', 'Second colour', '#8a7864')),
  live(R('bright', 'Brightness', 0, 3, 0.01, 1)),
];

// what each style starts from (its dials over the starts above)
export const RING_STYLE_DIALS = {
  dusty: { opacity: 0.45, bands: 0.35, fine: 0.25, gaps: 1, gapWidth: 0.03, colour1: '#b59a7c', colour2: '#7a6450' },
  icy: { opacity: 0.85, bands: 0.6, fine: 0.7, gaps: 2, gapWidth: 0.04, colour1: '#e6e2da', colour2: '#a8a2a0' },
  banded: { opacity: 0.8, bands: 1, fine: 0.4, gaps: 4, gapWidth: 0.05, colour1: '#d8c2a0', colour2: '#6e5a48' },
};

// Wave 5: a space volume, glowing gas drawn as a true volume (volume.js): a nebula near a planet or
// behind a zone, or a storm cloud with a dark heart (Kessel's Maelstrom and the Maw). Scenery seen from
// a zone, never flown into. Every dial but the billows' size is live (uniforms); the size is baked into
// the noise volume the cheaper tiers read, a moment after it stops.
export const VOLUME_KINDS = [['', 'None'], ['gas', 'Glowing gas (a nebula, a storm cloud)']];
const H = { group: 'Heart' }, F = { group: 'Lightning' };
export const VOLUME_DIALS = [
  R('scale', 'Billow size', 0.4, 2.5, 0.01, 1, 'Few large shapes (small) to many small billows (large): the noise volume is made again when this stops'),
  live(C('colour1', 'Colour, thick gas', '#ff6a4a')), live(C('colour2', 'Colour, thin gas', '#5a40d0', 'The same as the first for one colour')),
  live(R('glow', 'Glow', 0, 4, 0.01, 1, 'The light the gas gives off of its own')),
  live(R('density', 'Density', 0, 4, 0.01, 1, 'How much light the gas swallows: a thin veil (low) to thick dark cloud (high)')),
  live(R('see', 'Stars and planets show through', 0, 1, 0.01, 0, 'More of what is behind the gas shows through it (its glow stays)')),
  live(R('cover', 'Fill', 0, 1, 0.01, 0.5, 'How much of its space the gas fills')),
  live(R('soft', 'Softness', 0.02, 1, 0.01, 0.3, 'Hard-edged billows (low) to soft haze (high)')),
  live(R('detail', 'Detail', 0, 2, 0.01, 0.8, 'How much the small billows break up the large shapes')),
  live(R('form', 'Wispy or billowing', 0, 1, 0.01, 0.3, 'Wisps and filaments (0) to rounded storm billows (1)')),
  live(R('core', 'Gathered to the heart', -1, 2, 0.01, 0.6, 'Thicker toward the middle (above 0) or hollow (below)')),
  live(R('flatten', 'Flattened', 0.1, 1, 0.01, 1, 'Round (1) to a thin sheet (0.1)')),
  live(R('stretch', 'Stretched', 1, 3, 0.01, 1, 'Drawn out along one axis')),
  live(R('lean', 'Tipped toward us', -90, 90, 1, 0, 'Its plane (the flattening, the swirl, the heart\'s hot ring) tipped from edge on (0) to face on (90), wherever it is placed', { unit: '°' })),
  live(R('reach', 'Reach round a body', 1.2, 8, 0.01, 3, 'With a body inside the gas (its Surface layer on): how far the gas reaches, in the body\'s radii; the body hides the gas behind it (gas alone takes no notice)')),
  live(R('swirl', 'Swirl', -6, 6, 0.01, 0, 'Wound round its heart, as a storm is, inner parts more')),
  live(R('turb', 'Turbulence', 0, 0.5, 0.005, 0.15, 'How far the gas is pushed about by its own currents')),
  live(R('churn', 'Churn', 0, 2, 0.01, 0.3, 'How fast the currents change (moved by uniforms, never baked)')),
  live(R('drift', 'Drift', -30, 30, 0.1, 2, 'It turns slowly about its axis', { unit: '°/min' })),
  live(R('sunlit', 'Lit by the sun', 0, 2, 0.01, 0, 'Its billows lit from the sun\'s side, as a cloud is, their far sides in their own shadow (0: its own glow only)')),
  live(R('inner', 'Lit from its heart', 0, 3, 0.01, 0.5, 'A light at its middle (hot stars, or the Maw\'s glow): the faces turned to it glow, the far sides fall into shadow, so it has depth')),
  live(R('knots', 'Bright knots', 0, 1, 0.01, 0.5, 'Its own glow gathered into the thickest gas, as a real nebula\'s is (0: even glow throughout)')),
  live(R('wisps', 'Faint outer wisps', 0, 2, 0.01, 0.6, 'The thinnest gas reaching out past the bright body, so it fades into space rather than ending at a skin')),
  live(R('dust', 'Dark dust lanes', 0, 2, 0.01, 0, 'Dark lanes of dust through the gas, swallowing its light and giving none')),
  live(R('maw', 'The heart shows', 0, 1, 0.01, 0, 'A dark heart with a glowing rim, the light bent round it a little (0: none)', H)),
  live(R('mawSize', 'Heart size', 0.02, 0.3, 0.001, 0.09, 'In the volume\'s radius', H)),
  live(C('rimColour', 'Rim colour', '#ffb070', undefined, H)),
  live(R('rim', 'Rim glow', 0, 6, 0.01, 2, undefined, H)),
  live(R('bend', 'Light bent round it', 0, 1, 0.01, 0.5, 'How much the gas behind the heart is bent round it', H)),
  live(R('disc', 'Hot gas falling in', 0, 3, 0.01, 1, 'A flat ring of hot gas wound round the heart, the side coming at us brighter; bent over the heart\'s top as the light is bent', H)),
  live(R('flashes', 'Flashes a second', 0, 4, 0.01, 0, 'Lightning inside the gas, wave 4\'s storm flashes (0: none); thunder follows the Thunder switch', F)),
  live(R('flashBright', 'Flash brightness', 0, 6, 0.01, 1.6, undefined, F)),
  live(C('flashColour', 'Flash colour', '#d8e0ff', undefined, F)),
  live(R('flashSize', 'Flash size', 0.03, 0.5, 0.001, 0.14, 'The patch of gas one flash lights, in the volume\'s radius', F)),
];

// shape 2: the broken planet's crust breaks in patches, not a net of cracks; its glow keeps to the
// wound's bottom; its stream runs along the body's way, trailing and leading; softer self-shadow
export const PART_VERSION = { shape: 2, belt: 1, rings: 1, volume: 1 };

const pick = (list, v) => (list.some(([k]) => k === v) ? v : '');
export const shapeDialsOf = (kind) => (kind === 'broken' ? BROKEN_DIALS : kind === 'irregular' ? IRREGULAR_DIALS : []);
export const startsOf = (list, over = {}) => ({ ...Object.fromEntries(list.map((d) => [d.k, d.def])), ...over });

function cleanList(list, src, base) {
  const out = {};
  for (const d of list) {
    const v = src?.[d.k];
    const given = v !== null && v !== undefined && v !== '';
    if (d.type === 'color') out[d.k] = typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : base[d.k];
    else out[d.k] = given && Number.isFinite(+v) ? Math.min(d.max, Math.max(d.min, +v)) : base[d.k];
  }
  return out;
}
const versionOf = (part, v) => (Number.isFinite(+v) && +v >= 1 && +v <= PART_VERSION[part] ? Math.trunc(+v) : 1);

/** A look's parts made whole and safe; each one absent (and so nothing at all) when it is off. */
export function cleanParts(g) {
  const out = {};
  if (g?.shape && pick(SHAPE_KINDS, g.shape.kind)) {
    const kind = g.shape.kind;
    out.shape = { kind, version: versionOf('shape', g.shape.version), dials: cleanList(shapeDialsOf(kind), g.shape.dials, startsOf(shapeDialsOf(kind))) };
  }
  if (g?.belt && pick(BELT_KINDS, g.belt.kind)) {
    out.belt = { kind: g.belt.kind, version: versionOf('belt', g.belt.version), dials: cleanList(BELT_DIALS, g.belt.dials, startsOf(BELT_DIALS)) };
    if (out.belt.dials.outer < out.belt.dials.inner + 0.05) out.belt.dials.outer = Math.min(12, out.belt.dials.inner + 0.05);
  }
  if (g?.rings && pick(RING_STYLES, g.rings.style)) {
    const base = startsOf(RING_DIALS, RING_STYLE_DIALS[g.rings.style]);
    out.rings = { style: g.rings.style, version: versionOf('rings', g.rings.version), dials: cleanList(RING_DIALS, g.rings.dials, base) };
    if (out.rings.dials.outer < out.rings.dials.inner + 0.05) out.rings.dials.outer = Math.min(5, out.rings.dials.inner + 0.05);
  }
  // wave 5: a space volume, only when the look has one (a look without one cleans to what it was)
  if (g?.volume && pick(VOLUME_KINDS, g.volume.kind)) {
    out.volume = { kind: g.volume.kind, version: versionOf('volume', g.volume.version), dials: cleanList(VOLUME_DIALS, g.volume.dials, startsOf(VOLUME_DIALS)) };
  }
  return out;
}

/** A new part at its starts (a shape of a kind, a belt of a kind, rings of a style). */
export function newPart(part, kind) {
  if (part === 'shape') return kind ? { kind, version: PART_VERSION.shape, dials: startsOf(shapeDialsOf(kind)) } : null;
  if (part === 'belt') return kind ? { kind, version: PART_VERSION.belt, dials: startsOf(BELT_DIALS, kind === 'field' ? { inner: 1.1, outer: 2.2, thickness: 0.7, gaps: 0, clumps: 0.5 } : {}) } : null;
  if (part === 'rings') return kind ? { style: kind, version: PART_VERSION.rings, dials: startsOf(RING_DIALS, RING_STYLE_DIALS[kind]) } : null;
  if (part === 'volume') return kind ? { kind, version: PART_VERSION.volume, dials: startsOf(VOLUME_DIALS) } : null;
  return null;
}
