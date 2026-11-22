// Skies in motion: one small clockwork model per system. Clockwork, not physics: every body goes round
// its parent at a steady speed on a circle (a period in days, a radius, a tilt and the line it tilts
// about, a starting angle); the sizes are angles set by eye; nothing far away is drawn unless asked.
//
// Our world spins and orbits. Its spin is worked out from the game's own day, so that the sun rises at
// 06:00, stands highest (67.5 degrees up) at 14:24 and sets at 22:48 whatever the orbits do: the sky is
// turned, at each moment, so that the sun lies exactly where daycycle.ts puts it, and every other body
// follows from where it really is. Time is counted on the sky's own clock (the game's day, whose night
// runs faster than its daylight), so a world locked to its giant (its spin equal to its orbit round
// it) keeps that giant still in its sky; a world that turns sees it rise and set.
//
// Pure and deterministic from a time value: the same time gives the same sky for every player of the
// shared clock. compileSystem allocates once; skyAt allocates nothing. No page state is read here.
//
// That is version 1, kept exactly as it was: a sky applied from it draws as it did. Version 2 (skies
// in motion II, at the end of this file) is one model per star system on the real clock:
//   - Time is real days since EPOCH_MS, the same for every player. Every body you do not stand on
//     moves at its own rates in real time: orbits in real days (each with its own tilt and the line
//     it tilts about), each body's own spin in real hours.
//   - The world you stand on turns at one steady rate, its whole day `dayHours` (2 to 6) long, so
//     its daylight and its night are each 1 to 3 hours at the equator. The play area sits at a
//     latitude and longitude; its axis leans `axialTilt` from its orbit, toward a fixed time of year
//     (`season`), and that lean turns with the year, so the sun's path never changes over the real
//     year: no seasons, ever. Its noon height is 90 - |latitude - declination|.
//   - A ground world locked to what it goes round (Yavin 4, Endor's forest moon, Talus) spins as it
//     orbits: its orbit round its parent is its game day (one turn against the sun each dayHours),
//     on a plane that keeps its lean against the sun, so the parent stands still in its sky at the
//     height its latitude and longitude give (overhead at the near point, low toward the edge, never
//     seen from the far side), phasing once a day: full at local midnight, hiding the sun at noon.
//   - One system per star holds every body; each ground world in it is a "where you stand" choice
//     (`grounds`). The bodies' places are lists, one per ground world (a copied sky, such as Otoh
//     Gunga's, takes its world's places by their names).
//   - Tatooine's twin suns are one body (kind 'pair') at the centre, its two suns side by side in the
//     sky of whoever looks, their line at a fixed angle to the sun's path, `separation` degrees
//     between their bright discs' edges, so they never overlap. The brighter casts the light.

import { SWG_LIGHT_ELEVATION, DAY_NIGHT_SPLIT, DISC_FILL } from './places.js';

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/** The recipe's versions: what version 1 does is never changed; a new rule is a new version. This file models up to this one. */
export const SYSTEM_VERSION = 2;
/** The height of the sky's pole: the sun's path (the celestial equator) peaks at 90 minus this, 67.5. */
export const POLE_ELEVATION = 90 - SWG_LIGHT_ELEVATION;
export const BODY_KINDS = ['star', 'planet', 'giant', 'moon', 'group'];
export const MAX_BODIES = 32;
export const MAX_MEMBERS = 8;
/** Night light: a full moon this many degrees across, straight overhead, lights the night at 1. */
export const NIGHT_REF_SIZE = 20;
/** A painted sheet of moons (a night-sky picture) is mostly empty sky: its moons fill about this share of its square. It hides no sun. */
export const SHEET_SHARE = 0.15;

// ---------------------------------------------------------------------------------------------
// time: T counts days on the sky's clock; its fraction is the game's light time n (0 at 06:00
// sunrise, 0.25 at 14:24 noon, 0.5 at 22:48 sunset, 0.75 at 02:24 midnight), as daycycle.ts runs it

/** daycycle.ts's normalised light time at an hour of the clock (places.js dayAt's `normalized`). */
export function dayShare(hours) {
  let t = hours / 24;
  t -= Math.floor(t);
  let r = t - 0.25;
  r -= Math.floor(r);
  const n = r < DAY_NIGHT_SPLIT ? 0.5 * (r / DAY_NIGHT_SPLIT) : 0.5 + 0.5 * ((r - DAY_NIGHT_SPLIT) / (1 - DAY_NIGHT_SPLIT));
  return n >= 1 ? 0 : n;
}
/** The sky's time at an hour of a calendar day (the hours before 06:00 belong to the night before). */
export function skyTime(day, hours) {
  let h = hours % 24;
  if (h < 0) h += 24;
  return day + dayShare(h) - (h < 6 ? 1 : 0);
}
/** The hour of the clock at a sky time. */
export function hoursOf(T) {
  const n = T - Math.floor(T);
  const r = n < 0.5 ? n * 2 * DAY_NIGHT_SPLIT : DAY_NIGHT_SPLIT + (n - 0.5) * 2 * (1 - DAY_NIGHT_SPLIT);
  let t = r + 0.25;
  t -= Math.floor(t);
  return t * 24;
}
/** The calendar day at a sky time: day d runs from its 00:00 (sky time d - 1 + the light time of 00:00). */
const MIDNIGHT_SHARE = 0.5 + 0.5 * ((0.75 - DAY_NIGHT_SPLIT) / (1 - DAY_NIGHT_SPLIT));
export function dayOf(T) {
  return Math.floor(T - MIDNIGHT_SHARE + 1e-9) + 1;
}

// ---------------------------------------------------------------------------------------------
// the recipe, checked: what a file or the page hands in is made whole and safe

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const idOk = (v) => typeof v === 'string' && /^[A-Za-z0-9_:#.\- ]{1,120}$/.test(v);
const str = (v, n = 80) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const num = (v, d, lo, hi) => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return d;
  const n = +v;
  if (!Number.isFinite(n)) return d;
  return n < lo ? lo : n > hi ? hi : n;
};
const hex = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null);

/** Each dial's range and start: the page's sliders read these too. */
export const DIALS = {
  period: { min: 0.05, max: 100000, start: 30, unit: ' d', log: true },
  radius: { min: 0.0005, max: 500, start: 1, unit: '', log: true },
  tilt: { min: -90, max: 90, start: 0, unit: '°', step: 0.5 },
  node: { min: -180, max: 180, start: 0, unit: '°', step: 1 },
  start: { min: -180, max: 180, start: 0, unit: '°', step: 1 },
  size: { min: 0.1, max: 120, start: null, unit: '°', step: 0.1 },
  turns: { min: -20, max: 20, start: 0, unit: '/d', step: 0.05 },
  brightness: { min: 0, max: 3, start: 1, unit: '', step: 0.01 },
  wobble: { min: 0, max: 20, start: 0, unit: '°', step: 0.1 },
  along: { min: -60, max: 60, start: 0, unit: '°', step: 0.1 },
  across: { min: -60, max: 60, start: 0, unit: '°', step: 0.1 },
  // version 2: where you stand, your world's day, the twin suns
  lat: { min: -89, max: 89, start: 0, unit: '°', step: 0.5 },
  lon: { min: -180, max: 180, start: 0, unit: '°', step: 0.5 },
  dayHours: { min: 2, max: 6, start: 4, unit: ' h', step: 0.05 },
  season: { min: -180, max: 180, start: 0, unit: '°', step: 1 },
  axialTilt: { min: 0, max: 90, start: 0, unit: '°', step: 0.5 },
  spinHours: { min: 1, max: 20000, start: 24, unit: ' h', log: true },
  separation: { min: 0, max: 20, start: 1.5, unit: '°', step: 0.05 },
  lineAngle: { min: -180, max: 180, start: -90, unit: '°', step: 1 },
  share: { min: 0, max: 1, start: 0.5, unit: '', step: 0.01 },
};
const wrap180 = (a) => {
  let x = (a + 180) % 360;
  if (x < 0) x += 360;
  return x - 180;
};

function cleanMember(raw) {
  if (!isObj(raw)) return null;
  const m = {
    name: str(raw.name), place: idOk(raw.place) ? raw.place : null, look: idOk(raw.look) ? raw.look : null,
    along: num(raw.along, 0, DIALS.along.min, DIALS.along.max), across: num(raw.across, 0, DIALS.across.min, DIALS.across.max),
    size: num(raw.size, null, DIALS.size.min, DIALS.size.max),
  };
  return m.place || m.look || m.name ? m : null;
}

export function cleanBody(raw) {
  if (!isObj(raw) || !idOk(raw.id)) return null;
  const kind = BODY_KINDS.includes(raw.kind) ? raw.kind : 'moon';
  const D = DIALS;
  const b = {
    id: raw.id, kind, name: str(raw.name) || raw.id,
    parent: idOk(raw.parent) ? raw.parent : null,
    place: kind !== 'group' && idOk(raw.place) ? raw.place : null,
    look: kind !== 'group' && idOk(raw.look) ? raw.look : null,
    drawn: raw.drawn !== false,
    period: num(raw.period, D.period.start, 0, D.period.max),
    radius: num(raw.radius, D.radius.start, D.radius.min, D.radius.max),
    tilt: num(raw.tilt, 0, D.tilt.min, D.tilt.max),
    node: wrap180(num(raw.node, 0, -360, 360)),
    start: wrap180(num(raw.start, 0, -360, 360)),
    size: num(raw.size, null, D.size.min, D.size.max),
    turns: num(raw.turns, 0, D.turns.min, D.turns.max),
    brightness: num(raw.brightness, 1, D.brightness.min, D.brightness.max),
    colour: hex(raw.colour),
    locked: raw.locked === true,
    wobble: num(raw.wobble, 0, D.wobble.min, D.wobble.max),
  };
  if (kind === 'group') b.members = (Array.isArray(raw.members) ? raw.members : []).slice(0, MAX_MEMBERS).map(cleanMember).filter(Boolean);
  return b;
}

/**
 * A system as a file or the page has it, checked: its bodies, each parent one of them and no loop, the
 * first star without a parent its sun (any other body without one goes round that sun), our world one
 * of its planets or moons. Null when it cannot be one. A recipe of a later version is kept as it is,
 * marked `future`, and never modelled here.
 */
export function cleanSystem(raw) {
  if (!isObj(raw)) return null;
  const version = Math.floor(+raw.version || 1);
  if (version > SYSTEM_VERSION) {
    const text = JSON.stringify(raw);
    return text.length < 200000 ? { ...JSON.parse(text), future: true } : null;
  }
  if (version === 2) return cleanSystem2(raw);
  const bodies = [];
  const ids = new Set();
  for (const r of (Array.isArray(raw.bodies) ? raw.bodies : []).slice(0, MAX_BODIES)) {
    const b = cleanBody(r);
    if (b && !ids.has(b.id)) { ids.add(b.id); bodies.push(b); }
  }
  const sun = bodies.find((b) => b.kind === 'star' && (!b.parent || !ids.has(b.parent))) || bodies.find((b) => b.kind === 'star');
  if (!sun) return null;
  sun.parent = null;
  const byId = new Map(bodies.map((b) => [b.id, b]));
  for (const b of bodies) {
    if (b === sun) continue;
    if (!b.parent || !byId.has(b.parent) || b.parent === b.id || byId.get(b.parent).kind === 'group') b.parent = sun.id;
  }
  // no loops: a chain that comes back on itself goes round the sun instead
  for (const b of bodies) {
    let at = b, steps = 0;
    while (at && at.parent && steps <= bodies.length) { at = byId.get(at.parent); steps++; }
    if (steps > bodies.length) b.parent = sun.id;
  }
  const world = byId.get(raw.world);
  if (!world || world.kind === 'star' || world.kind === 'group') return null;
  for (const b of bodies) if (b !== world) { b.locked = false; b.wobble = 0; }
  const hide = [];
  for (const h of Array.isArray(raw.hide) ? raw.hide : []) if (idOk(h) && !hide.includes(h) && hide.length < 64) hide.push(h);
  return { version: 1, name: str(raw.name) || 'System', draft: raw.draft === true, note: str(raw.note, 600), world: world.id, bodies, hide };
}

// ---------------------------------------------------------------------------------------------
// the model: the recipe in numbers, made once

const DEFAULT_SIZE = { star: 20, giant: 30, planet: 10, moon: 8, group: 5 };

/**
 * The recipe as arrays of numbers, parents before children, and the things the sky draws ("items":
 * every body but our world, a group's members each its own). `sizeOf(placeId)` gives a place's own
 * size for a body that takes it (its size left empty); `sheetOf(placeId)` says whether a place is a
 * painted sheet of moons rather than one body.
 */
export function compileSystem(sys, sizeOf = () => null, sheetOf = () => false, opts = {}) {
  if (sys.version === 2) return compileSystem2(sys, sizeOf, sheetOf, opts);
  const B = sys.bodies;
  const n = B.length;
  const index = new Map(B.map((b, i) => [b.id, i]));
  const order = new Int16Array(n);
  const seen = new Uint8Array(n);
  let k = 0;
  const visit = (i) => {
    if (seen[i]) return;
    seen[i] = 1;
    const p = index.get(B[i].parent);
    if (p !== undefined) visit(p);
    order[k++] = i;
  };
  for (let i = 0; i < n; i++) visit(i);
  const parent = new Int16Array(n).fill(-1);
  const period = new Float64Array(n), radius = new Float64Array(n), start = new Float64Array(n), wobble = new Float64Array(n);
  const basis = new Float64Array(9 * n); // u (the node line), v (in the plane), normal
  for (let i = 0; i < n; i++) {
    const b = B[i];
    parent[i] = index.get(b.parent) ?? -1;
    period[i] = b.period;
    radius[i] = b.radius;
    start[i] = b.start * DEG;
    wobble[i] = (b.wobble || 0) * DEG;
    const ti = b.tilt * DEG, om = b.node * DEG;
    const ci = Math.cos(ti), si = Math.sin(ti), co = Math.cos(om), so = Math.sin(om);
    basis.set([co, so, 0, -ci * so, ci * co, si, si * so, -si * co, ci], 9 * i);
  }
  const sunI = B.findIndex((b) => b.kind === 'star' && !b.parent);
  const worldI = index.get(sys.world);
  // Our world's spin against the stars, worked out from the one day against its sun. Locked to its
  // parent, its orbit round that parent is its spin, so one day against the sun is one orbit against it.
  const wp = parent[worldI];
  const yearOf = (i) => { let at = i; while (at >= 0 && parent[at] !== sunI) at = parent[at]; return at >= 0 ? period[at] : 0; };
  const year = yearOf(worldI);
  const lockable = wp >= 0 && wp !== sunI;
  const locked = lockable && B[worldI].locked;
  if (locked) {
    const Y = period[wp] > 0 && parent[wp] === sunI ? period[wp] : year;
    period[worldI] = Y > 0 ? 1 / (1 + 1 / Y) : 1;
  }
  const spinDays = locked ? period[worldI] : year > 0 ? 1 / (1 + 1 / year) : 1;

  // the items
  const items = [];
  for (let q = 0; q < n; q++) {
    const i = order[q];
    if (i === worldI) continue;
    const b = B[i];
    if (b.kind === 'group') {
      for (const m of b.members || []) {
        const own = m.size ?? (m.place ? sizeOf(m.place) : null);
        items.push({ body: i, place: m.place, look: m.look, name: m.name || b.name, size: own ?? DEFAULT_SIZE.group, along: m.along * DEG, across: m.across * DEG, star: false, drawn: b.drawn, turns: 0, member: true });
      }
    } else {
      const own = b.size ?? (b.place ? sizeOf(b.place) : null);
      items.push({ body: i, place: b.place, look: b.look, name: b.name, size: own ?? DEFAULT_SIZE[b.kind] ?? 8, along: 0, across: 0, star: b.kind === 'star', drawn: b.drawn, turns: b.turns, member: false, colour: b.colour, brightness: b.brightness });
    }
  }
  const m = items.length;
  const itemOf = new Map();
  for (let j = 0; j < m; j++) if (items[j].place && !itemOf.has(items[j].place)) itemOf.set(items[j].place, j);
  const itemBody = new Int16Array(m), itemSize = new Float64Array(m), itemAlong = new Float64Array(m), itemAcross = new Float64Array(m);
  const itemStar = new Uint8Array(m), itemDrawn = new Uint8Array(m), itemMember = new Uint8Array(m), itemBright = new Float64Array(m), itemSheet = new Uint8Array(m);
  for (let j = 0; j < m; j++) {
    const it = items[j];
    itemBody[j] = it.body;
    itemSize[j] = it.size;
    itemAlong[j] = Math.tan(it.along);
    itemAcross[j] = Math.tan(it.across);
    itemStar[j] = it.star ? 1 : 0;
    // a place linked twice is drawn once (its first link)
    itemDrawn[j] = it.drawn && (!it.place || itemOf.get(it.place) === j) ? 1 : 0;
    itemMember[j] = it.member ? 1 : 0;
    itemBright[j] = it.star ? it.brightness ?? 1 : 0;
    itemSheet[j] = !it.star && it.place && sheetOf(it.place) ? 1 : 0;
  }
  return {
    sys, n, m, order, parent, period, radius, start, wobble, basis, sunI, worldI, locked, lockable, spinDays, year,
    items, itemOf, hidden: new Set(sys.hide || []), itemBody, itemSize, itemAlong, itemAcross, itemStar, itemDrawn, itemMember, itemBright, itemSheet,
  };
}

/** Where skyAt writes, made once for a model. Directions are in the sky's frame (+Y up, yaw 0 toward -Z). */
export function makeSkyState(model) {
  if (model.version === 2) return makeSkyState2(model);
  const { n, m } = model;
  return {
    T: NaN,
    pos: new Float64Array(3 * n), // each body in the system's own space (+Z the plane's north)
    unit: new Float64Array(3 * n), // each body's place on its orbit, as a unit vector from its parent
    angle: new Float64Array(n), // and its angle round that orbit (radians, from the node line)
    R: new Float64Array(9), // the system's space to our sky
    zenith: new Float64Array(3), // straight up from where we stand, in the system's space
    dir: new Float64Array(3 * m), // each item's direction in our sky
    light: new Float64Array(3 * m), // the direction from each item to the sun, in our sky
    lit: new Float64Array(m), // the share of each item's face we see lit
    dist: new Float64Array(m), // its distance from us, in the model's units
    cover: new Float64Array(m), // for a star: the share of its disc something nearer covers
    // (both start as fractions, so writing a fraction later never changes how the field is kept)
    daylight: 0.5, // the share of the stars' light reaching the ground (an eclipse takes some)
    night: 0.5, // night light: see nightBrightness
  };
}

/** The overlap of two discs of radius a and b whose centres are d apart (all angles in radians). */
function overlap(a, b, d) {
  if (d >= a + b) return 0;
  const lo = a < b ? a : b;
  if (d <= Math.abs(a - b)) return Math.PI * lo * lo;
  const ca = (d * d + a * a - b * b) / (2 * d * a), cb = (d * d + b * b - a * a) / (2 * d * b);
  const k = (-d + a + b) * (d + a - b) * (d - a + b) * (d + a + b);
  return a * a * Math.acos(ca < -1 ? -1 : ca > 1 ? 1 : ca) + b * b * Math.acos(cb < -1 ? -1 : cb > 1 ? 1 : cb) - 0.5 * Math.sqrt(k > 0 ? k : 0);
}

/** One body's part of the night light: its lit share, by its size against a 20° full moon, by its height. */
export function moonLight(lit, sizeDeg, sinUp) {
  if (!(sinUp > 0) || !(lit > 0)) return 0;
  const s = sizeDeg / NIGHT_REF_SIZE;
  return lit * s * s * sinUp;
}

/**
 * Night light from a sky at skyAt's moment: each moon's (and a giant's) lit share, by its size and its
 * height above the horizon, summed. 1 is a full 20-degree moon straight overhead; a full giant ("giantshine")
 * can give several. A plain function the game can call with the same model and state.
 */
export function nightBrightness(model, out) {
  let sum = 0;
  for (let j = 0; j < model.m; j++) {
    if (model.itemStar[j] || !model.itemDrawn[j]) continue;
    sum += moonLight(out.lit[j], model.itemSize[j], out.dir[3 * j + 1]) * (model.itemSheet[j] ? SHEET_SHARE : 1);
  }
  return sum;
}

const SIN_E = Math.sin(SWG_LIGHT_ELEVATION * DEG), COS_E = Math.cos(SWG_LIGHT_ELEVATION * DEG);
const PN_Y = Math.sin(POLE_ELEVATION * DEG), PN_Z = Math.cos(POLE_ELEVATION * DEG); // the pole: (0, PN_Y, PN_Z)

/** The whole sky at sky time T, written into `out` (makeSkyState). Allocates nothing. (Version 2: T is real days since EPOCH_MS.) */
export function skyAt(model, T, out) {
  if (model.version === 2) return skyAt2(model, T, out);
  const { n, order, parent, period, radius, start, wobble, basis } = model;
  const pos = out.pos, unit = out.unit, ang = out.angle;
  for (let q = 0; q < n; q++) {
    const i = order[q];
    const p = parent[i];
    const i3 = 3 * i;
    if (p < 0) {
      pos[i3] = pos[i3 + 1] = pos[i3 + 2] = 0;
      unit[i3] = unit[i3 + 1] = unit[i3 + 2] = 0;
      ang[i] = 0;
      continue;
    }
    const P = period[i];
    let a = start[i];
    if (P > 0) {
      const turns = T / P;
      a += (turns - Math.floor(turns)) * TAU;
      // a small swing about the steady pace (our world's wobble), through its middle at noon of day 0
      if (wobble[i] !== 0) a += wobble[i] * Math.sin((TAU * (T - 0.25)) / P);
    }
    ang[i] = a;
    const c = Math.cos(a), s = Math.sin(a), o = 9 * i;
    const ux = basis[o] * c + basis[o + 3] * s, uy = basis[o + 1] * c + basis[o + 4] * s, uz = basis[o + 2] * c + basis[o + 5] * s;
    unit[i3] = ux; unit[i3 + 1] = uy; unit[i3 + 2] = uz;
    const p3 = 3 * p, r = radius[i];
    pos[i3] = pos[p3] + r * ux;
    pos[i3 + 1] = pos[p3 + 1] + r * uy;
    pos[i3 + 2] = pos[p3 + 2] + r * uz;
  }

  // Our sky's frame: the sun's direction s and our axis A (the normal of our orbit, made square to s)
  // turned onto the game's sun at T and the sky's pole.
  const w3 = 3 * model.worldI, s3 = 3 * model.sunI;
  let sx = pos[s3] - pos[w3], sy = pos[s3 + 1] - pos[w3 + 1], sz = pos[s3 + 2] - pos[w3 + 2];
  let l = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
  sx /= l; sy /= l; sz /= l;
  const o = 9 * model.worldI;
  let ax = basis[o + 6], ay = basis[o + 7], az = basis[o + 8];
  let d = ax * sx + ay * sy + az * sz;
  ax -= d * sx; ay -= d * sy; az -= d * sz;
  l = Math.sqrt(ax * ax + ay * ay + az * az);
  if (l < 1e-9) { // the sun over our pole: any square axis will do
    ax = Math.abs(sz) < 0.9 ? -sy : 0; ay = Math.abs(sz) < 0.9 ? sx : -sz; az = Math.abs(sz) < 0.9 ? 0 : sy;
    l = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
  }
  ax /= l; ay /= l; az /= l;
  const cx = sy * az - sz * ay, cy = sz * ax - sx * az, cz = sx * ay - sy * ax; // s x A
  const f = T - Math.floor(T);
  const H = f * TAU - Math.PI / 2;
  const gx = Math.sin(H), gy = Math.cos(H) * SIN_E, gz = -Math.cos(H) * COS_E; // daycycle.ts's sun
  const qx = gy * PN_Z - gz * PN_Y, qy = gz * 0 - gx * PN_Z, qz = gx * PN_Y - gy * 0; // g x pole
  const R = out.R;
  R[0] = gx * sx + qx * cx; R[1] = gx * sy + qx * cy; R[2] = gx * sz + qx * cz;
  R[3] = gy * sx + PN_Y * ax + qy * cx; R[4] = gy * sy + PN_Y * ay + qy * cy; R[5] = gy * sz + PN_Y * az + qy * cz;
  R[6] = gz * sx + PN_Z * ax + qz * cx; R[7] = gz * sy + PN_Z * ay + qz * cy; R[8] = gz * sz + PN_Z * az + qz * cz;
  out.zenith[0] = R[3]; out.zenith[1] = R[4]; out.zenith[2] = R[5];

  // every item: its direction, the light on it, how much of it is lit, how far
  const dir = out.dir, light = out.light, lit = out.lit, dist = out.dist;
  for (let j = 0; j < model.m; j++) {
    const b3 = 3 * model.itemBody[j], j3 = 3 * j;
    let x = pos[b3] - pos[w3], y = pos[b3 + 1] - pos[w3 + 1], z = pos[b3 + 2] - pos[w3 + 2];
    l = Math.sqrt(x * x + y * y + z * z);
    dist[j] = l;
    if (l < 1e-12) { x = 0; y = 0; z = 1; l = 1; }
    x /= l; y /= l; z /= l;
    let dx = R[0] * x + R[1] * y + R[2] * z, dy = R[3] * x + R[4] * y + R[5] * z, dz = R[6] * x + R[7] * y + R[8] * z;
    if (model.itemMember[j]) {
      // a group's member keeps its place in the group: along and across the sky's turning, like a constellation
      let ex = PN_Y * dz - PN_Z * dy, ey = PN_Z * dx, ez = -PN_Y * dx;
      const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (el > 1e-9) {
        ex /= el; ey /= el; ez /= el;
        const nx = dy * ez - dz * ey, ny = dz * ex - dx * ez, nz = dx * ey - dy * ex;
        const ta = model.itemAlong[j], tc = model.itemAcross[j];
        dx += ta * ex + tc * nx; dy += ta * ey + tc * ny; dz += ta * ez + tc * nz;
        const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
        dx /= dl; dy /= dl; dz /= dl;
      }
    }
    dir[j3] = dx; dir[j3 + 1] = dy; dir[j3 + 2] = dz;
    if (model.itemStar[j]) {
      light[j3] = -dx; light[j3 + 1] = -dy; light[j3 + 2] = -dz;
      lit[j] = 1;
      continue;
    }
    let lx = pos[s3] - pos[b3], ly = pos[s3 + 1] - pos[b3 + 1], lz = pos[s3 + 2] - pos[b3 + 2];
    l = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;
    lx /= l; ly /= l; lz /= l;
    const kx = R[0] * lx + R[1] * ly + R[2] * lz, ky = R[3] * lx + R[4] * ly + R[5] * lz, kz = R[6] * lx + R[7] * ly + R[8] * lz;
    light[j3] = kx; light[j3 + 1] = ky; light[j3 + 2] = kz;
    // from the body we are back along dir: lit share (1 + cos(phase angle)) / 2
    lit[j] = (1 - (dx * kx + dy * ky + dz * kz)) / 2;
  }

  // eclipses: the share of each star's disc that something nearer covers, and the daylight left
  let lightSum = 0, lightAll = 0;
  for (let k = 0; k < model.m; k++) {
    out.cover[k] = 0;
    if (!model.itemStar[k] || !model.itemDrawn[k]) continue;
    const k3 = 3 * k;
    const rs = Math.atan(DISC_FILL * Math.tan((model.itemSize[k] * DEG) / 2)); // the bright disc of its square
    let covered = 0;
    for (let j = 0; j < model.m; j++) {
      if (model.itemStar[j] || model.itemSheet[j] || !model.itemDrawn[j] || dist[j] >= dist[k]) continue;
      const j3 = 3 * j;
      const c = dir[k3] * dir[j3] + dir[k3 + 1] * dir[j3 + 1] + dir[k3 + 2] * dir[j3 + 2];
      const sep = Math.acos(c < -1 ? -1 : c > 1 ? 1 : c);
      covered += overlap(rs, (model.itemSize[j] * DEG) / 2, sep);
    }
    const share = covered / (Math.PI * rs * rs);
    out.cover[k] = share > 1 ? 1 : share;
    lightAll += model.itemBright[k];
    lightSum += model.itemBright[k] * (1 - out.cover[k]);
  }
  out.daylight = lightAll > 0 ? lightSum / lightAll : 1;
  out.night = nightBrightness(model, out);
  out.T = T;
  return out;
}

/** The sky's direction of a vector given in the system's space (for the page's drawings). */
export function toSky(out, x, y, z, into) {
  const R = out.R;
  into.x = R[0] * x + R[1] * y + R[2] * z;
  into.y = R[3] * x + R[4] * y + R[5] * z;
  into.z = R[6] * x + R[7] * y + R[8] * z;
  return into;
}

// =============================================================================================
// Version 2: one system per star on the real clock (see the head of this file)

/** The real clock's zero: 1 January 2026, 00:00 UTC. Version 2's time is real days since then. */
export const EPOCH_MS = Date.UTC(2026, 0, 1);
export const DAY_MS = 86400000;
/** Real days since the epoch at a moment (milliseconds, as Date.now() gives), and back. */
export const realDays = (ms) => (ms - EPOCH_MS) / DAY_MS;
export const msOfRealDays = (T) => EPOCH_MS + T * DAY_MS;

export const KINDS = ['star', 'pair', 'planet', 'giant', 'moon', 'group', 'station', 'comet', 'belt'];
export const MAX_BODIES2 = 48;
const STARLIKE = (k) => k === 'star' || k === 'pair';
const GROUND_KINDS = ['planet', 'moon', 'giant'];
const DEFAULT_SIZE2 = { star: 20, pair: 20, giant: 30, planet: 10, moon: 8, group: 5, station: 1, comet: 1, belt: 1 };

/** The game day a world turns in by default: its lore day over six, held between 2 and 6 hours. */
export function defaultDayHours(loreHours) {
  const h = +loreHours / 6;
  if (!(h > 0)) return 4;
  return Math.round((h < 2 ? 2 : h > 6 ? 6 : h) * 100) / 100;
}

const worldOk = (v) => typeof v === 'string' && /^[A-Za-z0-9_]{1,64}$/.test(v);
const frac = (x) => x - Math.floor(x);

function cleanPlaceList(v) {
  const out = [];
  for (const p of Array.isArray(v) ? v : typeof v === 'string' ? [v] : []) if (idOk(p) && p.includes(':') && !out.includes(p) && out.length < 12) out.push(p);
  return out;
}
function cleanSizes(v) {
  const o = {};
  if (isObj(v)) for (const [w, s] of Object.entries(v)) { const n = worldOk(w) ? num(s, null, DIALS.size.min, DIALS.size.max) : null; if (n !== null) o[w] = n; }
  return o;
}
function cleanSrc(v) {
  const o = {};
  if (isObj(v)) for (const [k, s] of Object.entries(v)) if (/^[A-Za-z]{1,20}$/.test(k) && typeof s === 'string' && s.trim()) o[k] = s.trim().slice(0, 80);
  return o;
}
function cleanMember2(raw) {
  if (!isObj(raw)) return null;
  const m = {
    name: str(raw.name), places: cleanPlaceList(raw.places ?? raw.place), look: idOk(raw.look) ? raw.look : null,
    along: num(raw.along, 0, DIALS.along.min, DIALS.along.max), across: num(raw.across, 0, DIALS.across.min, DIALS.across.max),
    size: num(raw.size, null, DIALS.size.min, DIALS.size.max),
  };
  return m.places.length || m.look || m.name ? m : null;
}
function cleanSun(raw, k) {
  const r = isObj(raw) ? raw : {};
  return {
    name: str(r.name) || (k ? 'Second sun' : 'First sun'), places: cleanPlaceList(r.places ?? r.place), look: idOk(r.look) ? r.look : null,
    size: num(r.size, null, DIALS.size.min, DIALS.size.max), colour: hex(r.colour), brightness: num(r.brightness, 1, DIALS.brightness.min, DIALS.brightness.max),
  };
}

function cleanBody2(raw) {
  if (!isObj(raw) || !idOk(raw.id)) return null;
  const kind = KINDS.includes(raw.kind) ? raw.kind : 'moon';
  const D = DIALS;
  const many = kind === 'group' || kind === 'pair';
  const b = {
    id: raw.id, kind, name: str(raw.name) || raw.id,
    parent: idOk(raw.parent) ? raw.parent : null,
    places: many ? [] : cleanPlaceList(raw.places ?? raw.place),
    look: many ? null : idOk(raw.look) ? raw.look : null,
    drawn: raw.drawn !== false,
    period: num(raw.period, D.period.start, 0, D.period.max),
    radius: num(raw.radius, D.radius.start, D.radius.min, D.radius.max),
    tilt: num(raw.tilt, 0, D.tilt.min, D.tilt.max),
    node: wrap180(num(raw.node, 0, -360, 360)),
    start: wrap180(num(raw.start, 0, -360, 360)),
    size: num(raw.size, null, D.size.min, D.size.max),
    sizes: cleanSizes(raw.sizes),
    spinHours: num(raw.spinHours, 0, 0, D.spinHours.max),
    axialTilt: num(raw.axialTilt, 0, D.axialTilt.min, D.axialTilt.max),
    brightness: num(raw.brightness, 1, D.brightness.min, D.brightness.max),
    colour: hex(raw.colour),
    locked: raw.locked === true,
    wobble: num(raw.wobble, 0, D.wobble.min, D.wobble.max),
    follows: idOk(raw.follows) ? raw.follows : null,
    share: num(raw.share, 0.5, D.share.min, D.share.max),
    src: cleanSrc(raw.src),
    note: str(raw.note, 300),
  };
  if (kind === 'group') b.members = (Array.isArray(raw.members) ? raw.members : []).slice(0, MAX_MEMBERS).map(cleanMember2).filter(Boolean);
  if (kind === 'pair') {
    const list = Array.isArray(raw.members) ? raw.members : [];
    b.members = [cleanSun(list[0], 0), cleanSun(list[1], 1)];
    b.separation = num(raw.separation, D.separation.start, D.separation.min, D.separation.max);
    b.lineAngle = wrap180(num(raw.lineAngle, D.lineAngle.start, -360, 360));
  }
  return b;
}

function cleanGround(raw) {
  if (!isObj(raw) || !worldOk(raw.world)) return null;
  const D = DIALS;
  return {
    world: raw.world, body: idOk(raw.body) ? raw.body : null, copy: worldOk(raw.copy) && raw.copy !== raw.world ? raw.copy : null,
    lat: num(raw.lat, null, D.lat.min, D.lat.max),
    lon: raw.lon === null || raw.lon === undefined || raw.lon === '' ? null : wrap180(num(raw.lon, 0, -360, 360)),
    dayHours: num(raw.dayHours, null, D.dayHours.min, D.dayHours.max),
    season: raw.season === null || raw.season === undefined || raw.season === '' ? null : wrap180(num(raw.season, 0, -360, 360)),
    note: str(raw.note, 300),
  };
}

/**
 * A version 2 system checked: its bodies (each parent one of them and no loop, the first star or pair
 * without one its sun), and its ground worlds, each standing on one of its planets, moons or giants
 * (a copied sky stands where the world it copies stands, and takes that world's day and time of
 * year: one body turns at one rate). Null when there is no sun or no ground to stand on.
 */
function cleanSystem2(raw) {
  const bodies = [];
  const ids = new Set();
  for (const r of (Array.isArray(raw.bodies) ? raw.bodies : []).slice(0, MAX_BODIES2)) {
    const b = cleanBody2(r);
    if (b && !ids.has(b.id)) { ids.add(b.id); bodies.push(b); }
  }
  const sun = bodies.find((b) => STARLIKE(b.kind) && (!b.parent || !ids.has(b.parent))) || bodies.find((b) => STARLIKE(b.kind));
  if (!sun) return null;
  sun.parent = null;
  const byId = new Map(bodies.map((b) => [b.id, b]));
  for (const b of bodies) {
    if (b === sun) continue;
    const p = byId.get(b.parent);
    if (!p || b.parent === b.id || p.kind === 'group' || p.kind === 'belt') b.parent = sun.id;
  }
  for (const b of bodies) {
    let at = b, steps = 0;
    while (at && at.parent && steps <= bodies.length) { at = byId.get(at.parent); steps++; }
    if (steps > bodies.length) b.parent = sun.id;
  }
  // a station follows another body (sits a share of the way to it from its own parent): never itself,
  // the sun, a group, or a body that follows (no chains)
  for (const b of bodies) {
    const f = byId.get(b.follows);
    if (!f || f === b || f === sun || f.kind === 'group' || STARLIKE(f.kind) || f.follows) b.follows = null;
  }
  for (const b of bodies) if (b.follows) for (const c of bodies) if (c.follows === b.id) c.follows = null;
  const grounds = [];
  for (const r of Array.isArray(raw.grounds) ? raw.grounds : []) {
    const g = cleanGround(r);
    if (!g || grounds.some((x) => x.world === g.world) || grounds.length >= 16) continue;
    grounds.push(g);
  }
  // a copy of a copy, or of a world not here, is no copy; a ground stands on a body it can stand on
  for (const g of grounds) if (g.copy && !grounds.some((x) => x.world === g.copy && !x.copy)) g.copy = null;
  const kept = grounds.filter((g) => g.copy || (g.body && GROUND_KINDS.includes(byId.get(g.body)?.kind)));
  for (const g of kept) {
    if (g.copy) { g.body = null; g.dayHours = null; g.season = null; continue; }
    const b = byId.get(g.body);
    if (g.lat === null) g.lat = 0;
    if (g.lon === null) g.lon = 0;
    if (g.season === null) g.season = 0;
    if (g.dayHours === null) g.dayHours = defaultDayHours(b.spinHours || 24);
  }
  const final = kept.filter((g) => !g.copy || kept.some((x) => x.world === g.copy && !x.copy));
  if (!final.some((g) => !g.copy)) return null;
  // the wobble belongs to a ground world locked to what it goes round
  for (const b of bodies) if (!b.locked || !final.some((g) => g.body === b.id)) b.wobble = 0;
  const hide = [];
  for (const h of Array.isArray(raw.hide) ? raw.hide : []) if (idOk(h) && !hide.includes(h) && hide.length < 64) hide.push(h);
  return {
    version: 2, id: typeof raw.id === 'string' && /^[a-z0-9_]{1,40}$/.test(raw.id) ? raw.id : null,
    name: str(raw.name) || 'System', draft: raw.draft === true, note: str(raw.note, 900), bodies, grounds: final, hide,
  };
}

/** The ground worlds of a version 2 system, in its order. */
export const groundWorlds = (sys) => (sys?.version === 2 ? sys.grounds.map((g) => g.world) : sys?.world ? [] : []);

/** Where a world stands in a version 2 system, its copy taken from the world it copies (a new object), or null. */
export function groundOf(sys, world) {
  if (!sys || sys.version !== 2) return null;
  const g = sys.grounds.find((x) => x.world === world);
  if (!g) return null;
  if (!g.copy) return { ...g, base: g.world };
  const b = sys.grounds.find((x) => x.world === g.copy && !x.copy);
  if (!b) return null;
  return { world: g.world, copy: g.copy, base: b.world, body: b.body, lat: g.lat ?? b.lat, lon: g.lon ?? b.lon, dayHours: b.dayHours, season: b.season, note: g.note };
}

/** The sun's declination (degrees) on a world of axial tilt `tilt` at a fixed time of year `season` (0 an equinox, 90 the north's midsummer). */
export const declination = (tiltDeg, seasonDeg) => Math.asin(Math.sin(tiltDeg * DEG) * Math.sin(seasonDeg * DEG)) / DEG;
/** The sun's height at noon (degrees) from the latitude, the tilt and the time of year: 90 - |latitude - declination|. */
export const noonHeight = (latDeg, tiltDeg, seasonDeg) => 90 - Math.abs(latDeg - declination(tiltDeg, seasonDeg));
/** Hours of daylight and of night in a day of `dayHours` (the sun's centre above the horizon). */
export function daylightHours(latDeg, tiltDeg, seasonDeg, dayHours) {
  const d = declination(tiltDeg, seasonDeg) * DEG, f = latDeg * DEG;
  const c = -Math.tan(f) * Math.tan(d);
  const H0 = c <= -1 ? Math.PI : c >= 1 ? 0 : Math.acos(c);
  const day = (dayHours * H0) / Math.PI;
  return { day, night: dayHours - day };
}

/**
 * Which sky a world follows: his applied system of version 2 that holds it, else his applied one-world
 * system of version 1 (a sky he applied before systems were shared keeps what he applied until he
 * applies its system again), else SWG's. `v1` is the file's `systems` ({ world: { applied } }),
 * `holds(world)` the id of the version 2 system that holds the world, `v2` the file's `starSystems`.
 */
export function skyRuleFor(world, v1, v2, holds) {
  const id = holds(world);
  if (id && v2?.[id]?.applied === true) return { rule: 'system', id };
  if (v1?.[world]?.applied === true) return { rule: 'one-world', id: null };
  return { rule: 'swg', id: id || null };
}

/**
 * A version 2 system as numbers, seen from one of its ground worlds (`opts.world`, else its first).
 * `opts.placeExists(id)` says whether a place is in the viewer (a copied sky's places are its world's
 * by name). Every locked ground world in it orbits on its own game day, wherever we stand.
 */
function compileSystem2(sys, sizeOf, sheetOf, opts) {
  const placeExists = opts.placeExists || (() => true);
  const g = groundOf(sys, opts.world) || groundOf(sys, sys.grounds.find((x) => !x.copy).world);
  const world = g.world;
  const B = sys.bodies;
  const n = B.length;
  const index = new Map(B.map((b, i) => [b.id, i]));
  const order = new Int16Array(n);
  const seen = new Uint8Array(n);
  let k = 0;
  const visit = (i) => {
    if (seen[i]) return;
    seen[i] = 1;
    const p = index.get(B[i].parent);
    if (p !== undefined) visit(p);
    const f = index.get(B[i].follows);
    if (f !== undefined) visit(f);
    order[k++] = i;
  };
  for (let i = 0; i < n; i++) visit(i);
  const parent = new Int16Array(n).fill(-1), follow = new Int16Array(n).fill(-1), yearOf = new Int16Array(n).fill(-1);
  const period = new Float64Array(n), radius = new Float64Array(n), start = new Float64Array(n), wobble = new Float64Array(n), share = new Float64Array(n);
  const axialTilt = new Float64Array(n), lockDay = new Float64Array(n), lockSeason = new Float64Array(n), bodySpin = new Float64Array(n);
  const basis = new Float64Array(9 * n);
  for (let i = 0; i < n; i++) {
    const b = B[i];
    parent[i] = index.get(b.parent) ?? -1;
    follow[i] = index.get(b.follows) ?? -1;
    share[i] = b.share;
    period[i] = b.period;
    radius[i] = b.radius;
    start[i] = b.start * DEG;
    axialTilt[i] = b.axialTilt * DEG;
    bodySpin[i] = b.locked ? b.period : b.spinHours / 24;
    const ti = b.tilt * DEG, om = b.node * DEG;
    const ci = Math.cos(ti), si = Math.sin(ti), co = Math.cos(om), so = Math.sin(om);
    basis.set([co, so, 0, -ci * so, ci * co, si, si * so, -si * co, ci], 9 * i);
  }
  const sunI = index.get(B.find((b) => STARLIKE(b.kind) && !b.parent).id);
  for (let i = 0; i < n; i++) { let at = i; while (at >= 0 && parent[at] !== sunI) at = parent[at]; yearOf[i] = at; }
  const lockable = (i) => parent[i] >= 0 && parent[i] !== sunI && !STARLIKE(B[parent[i]].kind) && follow[i] < 0;
  // every locked ground world: its orbit is its game day against the sun, its plane keeps its lean
  for (const x of sys.grounds) {
    if (x.copy) continue;
    const i = index.get(x.body);
    if (i === undefined || lockDay[i] > 0 || !B[i].locked || !lockable(i)) continue;
    lockDay[i] = x.dayHours / 24;
    lockSeason[i] = x.season * DEG;
    wobble[i] = B[i].wobble * DEG;
    bodySpin[i] = lockDay[i];
  }
  const worldI = index.get(g.body);
  const locked = lockDay[worldI] > 0;
  const base = sys.grounds.find((x) => x.world === g.base);
  const dayDays = base.dayHours / 24;
  // the year: the period of the world's own line of orbits round the sun
  const year = yearOf[worldI] >= 0 ? period[yearOf[worldI]] : 0;
  const spinDays = year > 0 ? 1 / (1 / dayDays + 1 / year) : dayDays; // against the stars

  // a body's place as this world sees it: its own, or (a copied sky) the copied world's by its name
  const placeFor = (list) => {
    const pre = world + ':';
    let id = list.find((p) => p.startsWith(pre)) || null;
    if (!id && g.copy) {
      const b = list.find((p) => p.startsWith(g.copy + ':'));
      if (b) { const mine = pre + b.slice(g.copy.length + 1); if (placeExists(mine)) id = mine; }
    }
    return id;
  };
  const sizeHere = (own, place, kind) => own.sizes?.[world] ?? (place ? sizeOf(place) : null) ?? own.size ?? DEFAULT_SIZE2[kind] ?? 8;

  const items = [];
  const pairs = [];
  for (let q = 0; q < n; q++) {
    const i = order[q];
    if (i === worldI) continue;
    const b = B[i];
    const spinDeg = bodySpin[i] > 0 ? 360 / bodySpin[i] : 0;
    if (b.kind === 'group') {
      for (const m of b.members || []) {
        const place = placeFor(m.places);
        items.push({ body: i, place, look: m.look, name: m.name || b.name, size: m.size ?? (place ? sizeOf(place) : null) ?? DEFAULT_SIZE2.group, along: m.along * DEG, across: m.across * DEG, star: false, drawn: b.drawn, member: true, spinDeg: 0, colour: b.colour, brightness: 0, pair: -1 });
      }
    } else if (b.kind === 'pair') {
      const a = items.length;
      b.members.forEach((m, mi) => {
        const place = placeFor(m.places);
        items.push({ body: i, place, look: m.look, name: m.name, size: m.size ?? (place ? sizeOf(place) : null) ?? DEFAULT_SIZE2.pair, along: 0, across: 0, star: true, drawn: b.drawn, member: false, spinDeg: 0, colour: m.colour, brightness: m.brightness, pair: mi ? a : -1 });
      });
      pairs.push({ a, b: a + 1, gap: b.separation * DEG, angle: b.lineAngle * DEG });
    } else {
      const place = placeFor(b.places);
      items.push({ body: i, place, look: b.look, name: b.name, size: sizeHere(b, place, b.kind), along: 0, across: 0, star: b.kind === 'star', drawn: b.drawn && b.kind !== 'belt', member: false, spinDeg, colour: b.colour, brightness: b.brightness, pair: -1 });
    }
  }
  const m = items.length;
  const itemOf = new Map();
  for (let j = 0; j < m; j++) if (items[j].place && !itemOf.has(items[j].place)) itemOf.set(items[j].place, j);
  const itemBody = new Int16Array(m), itemSize = new Float64Array(m), itemAlong = new Float64Array(m), itemAcross = new Float64Array(m), itemSpin = new Float64Array(m);
  const itemStar = new Uint8Array(m), itemDrawn = new Uint8Array(m), itemMember = new Uint8Array(m), itemBright = new Float64Array(m), itemSheet = new Uint8Array(m);
  const itemPair = new Int16Array(m).fill(-1);
  for (let j = 0; j < m; j++) {
    const it = items[j];
    itemBody[j] = it.body;
    itemSize[j] = it.size;
    itemAlong[j] = Math.tan(it.along);
    itemAcross[j] = Math.tan(it.across);
    itemStar[j] = it.star ? 1 : 0;
    itemDrawn[j] = it.drawn && (!it.place || itemOf.get(it.place) === j) ? 1 : 0;
    itemMember[j] = it.member ? 1 : 0;
    itemBright[j] = it.star ? it.brightness ?? 1 : 0;
    itemSheet[j] = !it.star && it.place && sheetOf(it.place) ? 1 : 0;
    itemSpin[j] = it.spinDeg;
    itemPair[j] = it.pair;
  }
  // the pair: its two suns' centres apart by both bright discs' half-widths and the gap between them
  const disc = (size) => Math.atan(DISC_FILL * Math.tan((size * DEG) / 2));
  const pairA = new Int16Array(pairs.length), pairB = new Int16Array(pairs.length), pairApart = new Float64Array(pairs.length), pairAngle = new Float64Array(pairs.length);
  pairs.forEach((p, k2) => { pairA[k2] = p.a; pairB[k2] = p.b; pairApart[k2] = disc(itemSize[p.a]) + disc(itemSize[p.b]) + p.gap; pairAngle[k2] = p.angle; });
  // the brighter star casts the light
  let casterJ = -1;
  for (let j = 0; j < m; j++) if (itemStar[j] && (casterJ < 0 || (itemDrawn[j] && !itemDrawn[casterJ]) || (itemDrawn[j] === itemDrawn[casterJ] && itemBright[j] > itemBright[casterJ]))) casterJ = j;
  return {
    version: 2, sys, world, ground: g, n, m, order, parent, follow, share, yearOf, period, radius, start, wobble, basis, axialTilt, lockDay, lockSeason, bodySpin,
    sunI, worldI, locked, lockable: lockable(worldI), dayDays, spinDays, year,
    lat: g.lat * DEG, lonDeg: g.lon, lon: g.lon * DEG, season: g.season * DEG,
    items, itemOf, hidden: new Set(sys.hide || []), itemBody, itemSize, itemAlong, itemAcross, itemStar, itemDrawn, itemMember, itemBright, itemSheet, itemSpin, itemPair,
    pairA, pairB, pairApart, pairAngle, casterJ,
  };
}

function makeSkyState2(model) {
  const { n, m } = model;
  const v = () => ({ x: 0, y: 1, z: 0 });
  return {
    T: NaN,
    pos: new Float64Array(3 * n), unit: new Float64Array(3 * n), angle: new Float64Array(n),
    basis: Float64Array.from(model.basis), // each orbit's frame now (a locked world's turns with its year)
    axis: new Float64Array(3 * n), // a ground world's spin axis, in the system's space
    psi: new Float64Array(n), // a locked world's steady turn round its parent (radians, 0 at the near point's noon)
    R: new Float64Array(9), zenith: new Float64Array(3), poleSky: new Float64Array(3),
    dir: new Float64Array(3 * m), light: new Float64Array(3 * m), lit: new Float64Array(m), dist: new Float64Array(m), cover: new Float64Array(m),
    daylight: 0.5, night: 0.5,
    hour: 0.5, // the play area's hour of its own day (0 to 24, 12 the sun's highest)
    sunJ: model.casterJ,
    // the day as the ground view reads it (places.js dayAt's shape, from where the sun really is)
    day: { hours: 0.5, time: 0.5, ratio: 0.5, isDay: false, normalized: 0.5, light: v(), sun: v(), moon: v(), clientTime: 0.5, slotAlpha: 0.5 },
  };
}

/** The play area's hour (0 to 24) at real time T: one steady turn every dayHours. */
export const localHour = (model, T) => 24 * frac(T / model.dayDays + model.lonDeg / 360);
/** The real time in the same day of the world as T at which its hour is `hour`. */
export const timeAtHour = (model, T, hour) => T - (localHour(model, T) / 24) * model.dayDays + (((hour % 24) + 24) % 24 / 24) * model.dayDays;

/** A locked ground world on its orbit at T: the plane square to its axis, the axis leaning toward its fixed time of year. */
function lockedOrbit(M, i, T, out) {
  const pos = out.pos, unit = out.unit, ob = out.basis, ax = out.axis;
  const p3 = 3 * M.parent[i], s3 = 3 * M.sunI, yb = 9 * M.yearOf[i];
  const Nx = M.basis[yb + 6], Ny = M.basis[yb + 7], Nz = M.basis[yb + 8];
  let sx = pos[s3] - pos[p3], sy = pos[s3 + 1] - pos[p3 + 1], sz = pos[s3 + 2] - pos[p3 + 2];
  let d = sx * Nx + sy * Ny + sz * Nz;
  sx -= d * Nx; sy -= d * Ny; sz -= d * Nz;
  let l = Math.sqrt(sx * sx + sy * sy + sz * sz);
  if (l < 1e-12) { sx = M.basis[yb]; sy = M.basis[yb + 1]; sz = M.basis[yb + 2]; l = 1; }
  sx /= l; sy /= l; sz /= l;
  const ex = Ny * sz - Nz * sy, ey = Nz * sx - Nx * sz, ez = Nx * sy - Ny * sx;
  const e = M.axialTilt[i], ls = M.lockSeason[i];
  const ce = Math.cos(e), se = Math.sin(e), sl = Math.sin(ls), cl = Math.cos(ls);
  const Ax = ce * Nx + se * (sl * sx + cl * ex), Ay = ce * Ny + se * (sl * sy + cl * ey), Az = ce * Nz + se * (sl * sz + cl * ez);
  // u: away from the sun, in the plane square to the axis; v = A x u
  let ux = -sx, uy = -sy, uz = -sz;
  d = ux * Ax + uy * Ay + uz * Az;
  ux -= d * Ax; uy -= d * Ay; uz -= d * Az;
  l = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
  ux /= l; uy /= l; uz /= l;
  const vx = Ay * uz - Az * uy, vy = Az * ux - Ax * uz, vz = Ax * uy - Ay * ux;
  const psi = TAU * frac(T / M.lockDay[i]) - Math.PI;
  const a = psi + M.wobble[i] * Math.sin(psi);
  const c = Math.cos(a), s = Math.sin(a), i3 = 3 * i, o = 9 * i;
  unit[i3] = c * ux + s * vx; unit[i3 + 1] = c * uy + s * vy; unit[i3 + 2] = c * uz + s * vz;
  const r = M.radius[i];
  pos[i3] = pos[p3] + r * unit[i3]; pos[i3 + 1] = pos[p3 + 1] + r * unit[i3 + 1]; pos[i3 + 2] = pos[p3 + 2] + r * unit[i3 + 2];
  out.angle[i] = a;
  out.psi[i] = psi;
  ob[o] = ux; ob[o + 1] = uy; ob[o + 2] = uz; ob[o + 3] = vx; ob[o + 4] = vy; ob[o + 5] = vz; ob[o + 6] = Ax; ob[o + 7] = Ay; ob[o + 8] = Az;
  ax[i3] = Ax; ax[i3 + 1] = Ay; ax[i3 + 2] = Az;
}

/** Version 2's sky at real time T (days since EPOCH_MS). Allocates nothing. */
function skyAt2(M, T, out) {
  const { n, order, parent, period, radius, start, basis } = M;
  const pos = out.pos, unit = out.unit, ang = out.angle;
  for (let q = 0; q < n; q++) {
    const i = order[q];
    const p = parent[i];
    const i3 = 3 * i;
    if (p < 0) {
      pos[i3] = pos[i3 + 1] = pos[i3 + 2] = 0;
      unit[i3] = unit[i3 + 1] = unit[i3 + 2] = 0;
      ang[i] = 0;
      continue;
    }
    if (M.lockDay[i] > 0) { lockedOrbit(M, i, T, out); continue; }
    const p3 = 3 * p;
    const f = M.follow[i];
    if (f >= 0) {
      // a share of the way from its parent to the body it follows (Centerpoint between the twins)
      const f3 = 3 * f, k = M.share[i];
      let x = k * (pos[f3] - pos[p3]), y = k * (pos[f3 + 1] - pos[p3 + 1]), z = k * (pos[f3 + 2] - pos[p3 + 2]);
      pos[i3] = pos[p3] + x; pos[i3 + 1] = pos[p3 + 1] + y; pos[i3 + 2] = pos[p3 + 2] + z;
      const l = Math.sqrt(x * x + y * y + z * z) || 1;
      unit[i3] = x / l; unit[i3 + 1] = y / l; unit[i3 + 2] = z / l;
      ang[i] = 0;
      continue;
    }
    const P = period[i];
    let a = start[i];
    if (P > 0) { const turns = T / P; a += (turns - Math.floor(turns)) * TAU; }
    ang[i] = a;
    const c = Math.cos(a), s = Math.sin(a), o = 9 * i;
    const ux = basis[o] * c + basis[o + 3] * s, uy = basis[o + 1] * c + basis[o + 4] * s, uz = basis[o + 2] * c + basis[o + 5] * s;
    unit[i3] = ux; unit[i3 + 1] = uy; unit[i3 + 2] = uz;
    const r = radius[i];
    pos[i3] = pos[p3] + r * ux; pos[i3 + 1] = pos[p3 + 1] + r * uy; pos[i3 + 2] = pos[p3 + 2] + r * uz;
  }

  // where we stand: the axis A, the play area's meridian m (the direction of its noon), its zenith
  const w = M.worldI, w3 = 3 * w, s3 = 3 * M.sunI;
  let Ax, Ay, Az, mx, my, mz;
  if (M.locked) {
    Ax = out.axis[w3]; Ay = out.axis[w3 + 1]; Az = out.axis[w3 + 2];
    const o = 9 * w, psi = out.psi[w];
    const c = Math.cos(psi), s = Math.sin(psi);
    // toward the parent as the steady turn has it (the wobble swings the parent itself about this)
    const rx = -(c * out.basis[o] + s * out.basis[o + 3]), ry = -(c * out.basis[o + 1] + s * out.basis[o + 4]), rz = -(c * out.basis[o + 2] + s * out.basis[o + 5]);
    const cL = Math.cos(M.lon), sL = Math.sin(M.lon);
    const kx = Ay * rz - Az * ry, ky = Az * rx - Ax * rz, kz = Ax * ry - Ay * rx;
    mx = cL * rx + sL * kx; my = cL * ry + sL * ky; mz = cL * rz + sL * kz;
  } else {
    const yb = 9 * M.yearOf[w];
    const Nx = basis[yb + 6], Ny = basis[yb + 7], Nz = basis[yb + 8];
    const vx = pos[s3] - pos[w3], vy = pos[s3 + 1] - pos[w3 + 1], vz = pos[s3 + 2] - pos[w3 + 2];
    let d = vx * Nx + vy * Ny + vz * Nz;
    let sx = vx - d * Nx, sy = vy - d * Ny, sz = vz - d * Nz;
    let l = Math.sqrt(sx * sx + sy * sy + sz * sz);
    if (l < 1e-12) { sx = basis[yb]; sy = basis[yb + 1]; sz = basis[yb + 2]; l = 1; }
    sx /= l; sy /= l; sz /= l;
    const ex = Ny * sz - Nz * sy, ey = Nz * sx - Nx * sz, ez = Nx * sy - Ny * sx;
    const e = M.axialTilt[w], ce = Math.cos(e), se = Math.sin(e), sl = Math.sin(M.season), cl = Math.cos(M.season);
    Ax = ce * Nx + se * (sl * sx + cl * ex); Ay = ce * Ny + se * (sl * sy + cl * ey); Az = ce * Nz + se * (sl * sz + cl * ez);
    out.axis[w3] = Ax; out.axis[w3 + 1] = Ay; out.axis[w3 + 2] = Az;
    // the sun square to the axis, then the meridian turned from it by the sun's hour angle (0 at noon)
    d = vx * Ax + vy * Ay + vz * Az;
    let px = vx - d * Ax, py = vy - d * Ay, pz = vz - d * Az;
    l = Math.sqrt(px * px + py * py + pz * pz);
    if (l < 1e-12) { px = ex; py = ey; pz = ez; l = 1; }
    px /= l; py /= l; pz /= l;
    const H = TAU * frac(T / M.dayDays + M.lonDeg / 360) - Math.PI;
    const qx = Ay * pz - Az * py, qy = Az * px - Ax * pz, qz = Ax * py - Ay * px;
    const cH = Math.cos(H), sH = Math.sin(H);
    mx = cH * px + sH * qx; my = cH * py + sH * qy; mz = cH * pz + sH * qz;
  }
  const cf = Math.cos(M.lat), sf = Math.sin(M.lat);
  const Zx = cf * mx + sf * Ax, Zy = cf * my + sf * Ay, Zz = cf * mz + sf * Az;
  const Ex = Ay * mz - Az * my, Ey = Az * mx - Ax * mz, Ez = Ax * my - Ay * mx; // east
  const Nlx = Zy * Ez - Zz * Ey, Nly = Zz * Ex - Zx * Ez, Nlz = Zx * Ey - Zy * Ex; // north = up x east
  const R = out.R;
  // the sky's frame: +X west (the sun sets toward +X, as SWG's does), +Y up, +Z north
  R[0] = -Ex; R[1] = -Ey; R[2] = -Ez;
  R[3] = Zx; R[4] = Zy; R[5] = Zz;
  R[6] = Nlx; R[7] = Nly; R[8] = Nlz;
  out.zenith[0] = Zx; out.zenith[1] = Zy; out.zenith[2] = Zz;
  const PX = R[0] * Ax + R[1] * Ay + R[2] * Az, PY = R[3] * Ax + R[4] * Ay + R[5] * Az, PZ = R[6] * Ax + R[7] * Ay + R[8] * Az;
  out.poleSky[0] = PX; out.poleSky[1] = PY; out.poleSky[2] = PZ;
  out.hour = localHour(M, T);

  // every item: its direction, the light on it, how much of it is lit, how far
  const dir = out.dir, light = out.light, lit = out.lit, dist = out.dist;
  let l;
  for (let j = 0; j < M.m; j++) {
    const b3 = 3 * M.itemBody[j], j3 = 3 * j;
    let x = pos[b3] - pos[w3], y = pos[b3 + 1] - pos[w3 + 1], z = pos[b3 + 2] - pos[w3 + 2];
    l = Math.sqrt(x * x + y * y + z * z);
    dist[j] = l;
    if (l < 1e-12) { x = 0; y = 0; z = 1; l = 1; }
    x /= l; y /= l; z /= l;
    let dx = R[0] * x + R[1] * y + R[2] * z, dy = R[3] * x + R[4] * y + R[5] * z, dz = R[6] * x + R[7] * y + R[8] * z;
    if (M.itemMember[j]) {
      // a group's member keeps its place in the group, along and across the sky's turning
      let ex = PY * dz - PZ * dy, ey = PZ * dx - PX * dz, ez = PX * dy - PY * dx;
      const el = Math.sqrt(ex * ex + ey * ey + ez * ez);
      if (el > 1e-9) {
        ex /= el; ey /= el; ez /= el;
        const nx = dy * ez - dz * ey, ny = dz * ex - dx * ez, nz = dx * ey - dy * ex;
        const ta = M.itemAlong[j], tc = M.itemAcross[j];
        dx += ta * ex + tc * nx; dy += ta * ey + tc * ny; dz += ta * ez + tc * nz;
        const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
        dx /= dl; dy /= dl; dz /= dl;
      }
    }
    dir[j3] = dx; dir[j3 + 1] = dy; dir[j3 + 2] = dz;
    if (M.itemStar[j]) {
      light[j3] = -dx; light[j3 + 1] = -dy; light[j3 + 2] = -dz;
      lit[j] = 1;
      continue;
    }
    let lx = pos[s3] - pos[b3], ly = pos[s3 + 1] - pos[b3 + 1], lz = pos[s3 + 2] - pos[b3 + 2];
    l = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;
    lx /= l; ly /= l; lz /= l;
    const kx = R[0] * lx + R[1] * ly + R[2] * lz, ky = R[3] * lx + R[4] * ly + R[5] * lz, kz = R[6] * lx + R[7] * ly + R[8] * lz;
    light[j3] = kx; light[j3 + 1] = ky; light[j3 + 2] = kz;
    lit[j] = (1 - (dx * kx + dy * ky + dz * kz)) / 2;
  }
  // the twin suns: the second beside the first, along a line at a fixed angle to the sun's path
  // (0 ahead along it, 90 toward the pole in our sky, -90 away from it: rising after and setting before)
  const hemi = M.lat < 0 ? -1 : 1;
  for (let k = 0; k < M.pairA.length; k++) {
    const a3 = 3 * M.pairA[k], b3 = 3 * M.pairB[k];
    const dx = dir[a3], dy = dir[a3 + 1], dz = dir[a3 + 2];
    let tx = dy * PZ - dz * PY, ty = dz * PX - dx * PZ, tz = dx * PY - dy * PX; // d x pole: the way the sky turns it
    let tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (tl < 1e-9) { tx = 1; ty = 0; tz = 0; tl = 1; }
    tx /= tl; ty /= tl; tz /= tl;
    const pd = PX * dx + PY * dy + PZ * dz;
    let nx = PX - pd * dx, ny = PY - pd * dy, nz = PZ - pd * dz;
    let nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (nl < 1e-9) { nx = dy * tz - dz * ty; ny = dz * tx - dx * tz; nz = dx * ty - dy * tx; nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1; }
    nx *= hemi / nl; ny *= hemi / nl; nz *= hemi / nl;
    const ca = Math.cos(M.pairAngle[k]), sa = Math.sin(M.pairAngle[k]);
    const ox = ca * tx + sa * nx, oy = ca * ty + sa * ny, oz = ca * tz + sa * nz;
    const cc = Math.cos(M.pairApart[k]), sc = Math.sin(M.pairApart[k]);
    const qx = cc * dx + sc * ox, qy = cc * dy + sc * oy, qz = cc * dz + sc * oz;
    dir[b3] = qx; dir[b3 + 1] = qy; dir[b3 + 2] = qz;
    light[b3] = -qx; light[b3 + 1] = -qy; light[b3 + 2] = -qz;
  }

  // eclipses: the share of each star's disc that something nearer covers, and the daylight left
  let lightSum = 0, lightAll = 0;
  for (let k = 0; k < M.m; k++) {
    out.cover[k] = 0;
    if (!M.itemStar[k] || !M.itemDrawn[k]) continue;
    const k3 = 3 * k;
    const rs = Math.atan(DISC_FILL * Math.tan((M.itemSize[k] * DEG) / 2));
    let covered = 0;
    for (let j = 0; j < M.m; j++) {
      if (M.itemStar[j] || M.itemSheet[j] || !M.itemDrawn[j] || dist[j] >= dist[k]) continue;
      const j3 = 3 * j;
      const c = dir[k3] * dir[j3] + dir[k3 + 1] * dir[j3 + 1] + dir[k3 + 2] * dir[j3 + 2];
      const sep = Math.acos(c < -1 ? -1 : c > 1 ? 1 : c);
      covered += overlap(rs, (M.itemSize[j] * DEG) / 2, sep);
    }
    const sh = covered / (Math.PI * rs * rs);
    out.cover[k] = sh > 1 ? 1 : sh;
    lightAll += M.itemBright[k];
    lightSum += M.itemBright[k] * (1 - out.cover[k]);
  }
  out.daylight = lightAll > 0 ? lightSum / lightAll : 1;
  out.night = nightBrightness(M, out);

  // the day as the ground view reads it: SWG's light time (0 sunrise, 0.25 noon, 0.5 sunset, 0.75
  // midnight) from where the casting sun really is, so the game's colour ramp and slots follow it
  const day = out.day, c3 = 3 * (M.casterJ >= 0 ? M.casterJ : 0);
  const sx = M.m ? dir[c3] : 0, sy = M.m ? dir[c3 + 1] : 1, sz = M.m ? dir[c3 + 2] : 0;
  let sd = sx * PX + sy * PY + sz * PZ;
  sd = sd < -1 ? -1 : sd > 1 ? 1 : sd;
  const tanD = sd / Math.sqrt(1 - sd * sd + 1e-12);
  let cH0 = -Math.tan(M.lat) * tanD;
  cH0 = cH0 < -1 ? -1 : cH0 > 1 ? 1 : cH0;
  let H0 = Math.acos(cH0);
  H0 = H0 < 1e-3 ? 1e-3 : H0 > Math.PI - 1e-3 ? Math.PI - 1e-3 : H0;
  const Hn = (out.hour / 24) * TAU - Math.PI;
  let nrm;
  if (Hn >= -H0 && Hn <= H0) nrm = 0.25 + (0.25 * Hn) / H0;
  else nrm = 0.5 + (0.5 * ((Hn < 0 ? Hn + TAU : Hn) - H0)) / (TAU - 2 * H0);
  nrm = nrm < 0 ? 0 : nrm >= 1 ? 0 : nrm;
  day.normalized = nrm;
  day.isDay = nrm < 0.5;
  day.ratio = nrm < 0.5 ? nrm * 2 * DAY_NIGHT_SPLIT : DAY_NIGHT_SPLIT + (nrm - 0.5) * 2 * (1 - DAY_NIGHT_SPLIT);
  day.hours = out.hour;
  day.time = out.hour / 24;
  day.clientTime = day.ratio * 86400;
  day.sun.x = sx; day.sun.y = sy; day.sun.z = sz;
  const k = day.isDay ? 1 : -1;
  day.light.x = k * sx; day.light.y = k * sy; day.light.z = k * sz;
  day.moon.x = -sx; day.moon.y = -sy; day.moon.z = -sz;
  const al = day.light.y / 0.08;
  day.slotAlpha = al < 0 ? 0 : al > 1 ? 1 : al;
  out.sunJ = M.casterJ;
  out.T = T;
  return out;
}
