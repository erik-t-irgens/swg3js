// A draft system for every world, assumed from the lore (lore.js and missing.js: which moons, which
// giant), with rough periods and tilts of our own. A draft is never a world's sky: each world keeps
// SWG's sky until the owner presses Apply, and what he applies is copied into his file, so a later
// change to a draft here never moves a sky he has approved. Names and numbers only.
//
// Units: periods in days of the game's clock, radii in the model's units (a planet's orbit about 1, a
// moon's a few thousandths), angles in degrees. A body linked to a place takes that place's look and,
// its size left empty, the place's own size.

import { cleanSystem } from './system.js';
import { dayShare } from './system.js';

const star = (id, name, place, o = {}) => ({ id, kind: 'star', name, place, ...o });
const planet = (id, name, place, period, radius, o = {}) => ({ id, kind: 'planet', name, place, parent: 'sun', period, radius, ...o });
const giant = (id, name, place, period, radius, o = {}) => ({ id, kind: 'giant', name, place, parent: 'sun', period, radius, ...o });
const moon = (id, name, place, parent, period, radius, o = {}) => ({ id, kind: 'moon', name, place, parent, period, radius, ...o });

/**
 * Where a world locked to its parent starts, for the sun to pass behind the parent at a given hour:
 * the world's orbit is a day against the sun, so its angle trails the parent's by the light time of
 * that hour (both orbits flat and from the same line).
 */
export const lockedStart = (parentStart, hours) => {
  const a = parentStart - 360 * dayShare(hours);
  return ((((a + 180) % 360) + 360) % 360) - 180;
};

const D = {
  tatooine: {
    name: 'Tatoo system', world: 'tatooine',
    note: 'Twin suns (Tatoo II goes round Tatoo I), Tatooine round both in 304 days, and its three moons Ghomrassen, Guermessa and Chenini kept together as one group on one orbit. The night-sky sheet of three moons is hidden while this applies (the group stands for it).',
    bodies: [
      star('sun', 'Tatoo I', 'tatooine:sun', { colour: '#fff1d6' }),
      star('tatoo2', 'Tatoo II', 'tatooine:sun2', { parent: 'sun', period: 40, radius: 0.22, tilt: 25, start: 30, colour: '#ffe2b8', brightness: 0.8 }),
      planet('tatooine', 'Tatooine', null, 304, 1),
      { id: 'moons', kind: 'group', name: 'Tatooine\'s three moons', parent: 'tatooine', period: 29, radius: 0.004, tilt: 4, start: 150,
        members: [
          { name: 'Ghomrassen', place: 'tatooine:moon', along: 0, across: 0 },
          { name: 'Guermessa', place: 'tatooine:moon2', along: 9, across: 3 },
          { name: 'Chenini', place: 'tatooine:celestial:cels_moon_earthy01', along: -6, across: 5 },
        ] },
    ],
    hide: ['tatooine:nightsky'],
  },
  naboo: {
    name: 'Naboo system', world: 'naboo',
    note: 'Naboo round its star in 312 days, with its three moons: Rori, Ohma-D\'un and the small third moon. Each rises later every night and phases over its month.',
    bodies: [
      star('sun', 'Naboo (the star)', 'naboo:sun'),
      planet('naboo', 'Naboo', null, 312, 1),
      moon('rori', 'Rori', 'naboo:moon', 'naboo', 18, 0.003, { tilt: 5, start: 40 }),
      moon('ohma', 'Ohma-D\'un', 'naboo:moon2', 'naboo', 27, 0.0042, { tilt: 3, start: 160 }),
      moon('third', 'Third moon', 'naboo:celestial:cels_moon_mercury', 'naboo', 9, 0.0021, { tilt: 8, start: 280 }),
    ],
  },
  rori: {
    name: 'Naboo system, from Rori', world: 'rori',
    note: 'Rori turns: it goes round Naboo in 18 days (as in Naboo\'s draft) and spins once a day, so Naboo rises and sets, a little later each day, and phases over Rori\'s month. Naboo\'s other moons go round Naboo too.',
    bodies: [
      star('sun', 'Naboo (the star)', 'rori:sun'),
      planet('naboo', 'Naboo', 'rori:celestial:cels_naboo', 312, 1, { turns: 0.9 }),
      moon('rori', 'Rori', null, 'naboo', 18, 0.003, { tilt: 5, start: 40 }),
      moon('ohma', 'Ohma-D\'un', 'rori:moon', 'naboo', 27, 0.0042, { tilt: 3, start: 160 }),
      moon('third', 'Third moon', 'rori:celestial:moon_single', 'naboo', 9, 0.0021, { tilt: 8, start: 280 }),
      moon('fourth', 'A fourth moon (ours)', 'rori:moon2', 'naboo', 45, 0.0065, { tilt: 6, start: 70 }),
    ],
  },
  corellia: {
    name: 'Corellian system', world: 'corellia',
    note: 'Corellia round Corell in 329 days, with Gus Talon, Gus Treta, a small third moon and an orange fourth (ours).',
    bodies: [
      star('sun', 'Corell', 'corellia:sun'),
      planet('corellia', 'Corellia', null, 329, 1),
      moon('talon', 'Gus Talon', 'corellia:moon', 'corellia', 21, 0.003, { tilt: 4, start: 20 }),
      moon('treta', 'Gus Treta', 'corellia:moon2', 'corellia', 34, 0.0045, { tilt: 6, start: 200 }),
      moon('third', 'Third moon', 'corellia:celestial:cels_moon_earthy01', 'corellia', 11, 0.002, { tilt: 2, start: 110 }),
      moon('fourth', 'Orange moon (ours)', 'corellia:celestial:cels_mars1', 'corellia', 52, 0.006, { tilt: 9, start: 300 }),
    ],
  },
  talus: {
    name: 'Corellian system, from Talus', world: 'talus',
    note: 'Talus and Tralus are a pair: Talus goes round Tralus locked, so Tralus (with Centerpoint) stands still in Talus\'s sky, phases through the day and hides the sun at noon. Corellia is drawn by eye as it passes. Talus\'s two moons are ours.',
    bodies: [
      star('sun', 'Corell', 'talus:sun'),
      planet('tralus', 'Tralus, with Centerpoint', 'talus:celestial:cels_cpoint_tralus', 300, 0.95, { turns: 0.4 }),
      planet('talus', 'Talus', null, 0, 0.003, { parent: 'tralus', locked: true, wobble: 1.5, start: lockedStart(0, 14.4) }),
      planet('corellia', 'Corellia', 'talus:celestial:cels_corellia', 329, 1.05, { start: 8 }),
      moon('m1', 'Talus\'s moon (ours)', 'talus:moon', 'talus', 13, 0.0008, { tilt: 4, start: 60 }),
      moon('m2', 'Talus\'s second moon (ours)', 'talus:moon2', 'talus', 24, 0.0012, { tilt: 7, start: 230 }),
    ],
  },
  dantooine: {
    name: 'Dantooine system', world: 'dantooine',
    note: 'Dantooine round Dina in 378 days, with its two unnamed moons.',
    bodies: [
      star('sun', 'Dina', 'dantooine:sun'),
      planet('dantooine', 'Dantooine', null, 378, 1.1),
      moon('m1', 'The larger moon', 'dantooine:moon', 'dantooine', 24, 0.0032, { tilt: 5, start: 30 }),
      moon('m2', 'The lesser moon', 'dantooine:moon2', 'dantooine', 47, 0.005, { tilt: 8, start: 210 }),
    ],
  },
  dathomir: {
    name: 'Dathomir system', world: 'dathomir',
    note: 'Dathomir round the red star Domir in 491 days. Lore gives it four moons; SWG\'s sky shows two, so the other two are in the model but not drawn (tick "Drawn in the sky" and give each a look to show them).',
    bodies: [
      star('sun', 'Domir', 'dathomir:sun', { colour: '#ff9a7a' }),
      planet('dathomir', 'Dathomir', null, 491, 1.25),
      moon('m1', 'First moon', 'dathomir:moon', 'dathomir', 16, 0.0028, { tilt: 3, start: 90 }),
      moon('m2', 'Second moon', 'dathomir:moon2', 'dathomir', 31, 0.0043, { tilt: 9, start: 250 }),
      moon('m3', 'Third moon (no place)', null, 'dathomir', 8, 0.0018, { tilt: 5, start: 10, drawn: false, size: 4 }),
      moon('m4', 'Fourth moon (no place)', null, 'dathomir', 60, 0.0068, { tilt: 12, start: 170, drawn: false, size: 5 }),
    ],
  },
  endor: {
    name: 'Endor system', world: 'forest',
    note: 'The forest moon goes round the gas giant Endor locked, so the giant stands still in its sky, turns its bands, phases through the day (full at midnight) and hides the sun in the late afternoon. Kef Bir and another of the giant\'s nine moons go round the giant farther out.',
    bodies: [
      star('sun', 'Endor\'s sun', 'endor:sun'),
      giant('giant', 'Endor (the gas giant)', 'endor:celestial:cels_endor', 402, 4, { turns: 2.2 }),
      moon('forest', 'The forest moon', null, 'giant', 0, 0.01, { locked: true, wobble: 2, start: lockedStart(0, 17) }),
      moon('kefbir', 'Kef Bir', 'endor:moon', 'giant', 2.6, 0.016, { tilt: 2, start: 120 }),
      moon('m2', 'Another of the nine', 'endor:moon2', 'giant', 7.1, 0.031, { tilt: 4, start: 300 }),
    ],
  },
  kashyyyk_main: {
    name: 'Kashyyyk system', world: 'kashyyyk',
    note: 'Kashyyyk round its star in 381 days, with its three moons (one orange), and Trandosha passing by, drawn by eye. The night-sky sheet of two moons is hidden while this applies.',
    bodies: [
      star('sun', 'Kashyyyk (the star)', 'kashyyyk_main:sun'),
      planet('kashyyyk', 'Kashyyyk', null, 381, 1),
      moon('m1', 'A moon', 'kashyyyk_main:moon', 'kashyyyk', 19, 0.003, { tilt: 4, start: 15 }),
      moon('m2', 'A second moon', 'kashyyyk_main:celestial:cels_moon_earthy01', 'kashyyyk', 33, 0.0048, { tilt: 6, start: 140 }),
      moon('m3', 'The orange moon', 'kashyyyk_main:celestial:cels_mars1', 'kashyyyk', 9, 0.002, { tilt: 3, start: 260 }),
      planet('trandosha', 'Trandosha', 'kashyyyk_main:moon2', 500, 1.2, { start: 4 }),
    ],
    hide: ['kashyyyk_main:nightsky'],
  },
  lok: {
    name: 'Karthakk system', world: 'lok',
    note: 'Lok round its star in 322 days, with its two moons from the lore and SWG\'s third (ours).',
    bodies: [
      star('sun', 'Lok\'s sun', 'lok:sun'),
      planet('lok', 'Lok', null, 322, 0.95),
      moon('m1', 'The larger moon', 'lok:moon', 'lok', 26, 0.0034, { tilt: 5, start: 50 }),
      moon('m2', 'The second moon', 'lok:celestial:cels_moon_mercury', 'lok', 12, 0.002, { tilt: 3, start: 190 }),
      moon('m3', 'A third moon (ours)', 'lok:moon2', 'lok', 41, 0.0049, { tilt: 10, start: 320 }),
    ],
  },
  mustafar: {
    name: 'Mustafar system', world: 'mustafar',
    note: 'Mustafar round Priate in 412 days between the gas giants Jestefad (inside: seen by day near the sun, gibbous most of the time and a crescent only when it passes between, about every three years) and Lefrani (outside, by night), both drawn by eye, and its moon Nur.',
    bodies: [
      star('sun', 'Priate', 'mustafar:sun', { colour: '#ffd9b0' }),
      planet('mustafar', 'Mustafar', null, 412, 1),
      moon('nur', 'Nur', 'mustafar:moon', 'mustafar', 14, 0.0028, { tilt: 6, start: 100 }),
      giant('jestefad', 'Jestefad', 'mustafar:celestial:jestefad', 300, 0.82, { start: 25, turns: 2.5 }),
      giant('lefrani', 'Lefrani', 'mustafar:celestial:lefrani', 620, 1.3, { start: -10, turns: 1.8 }),
    ],
  },
  taanab: {
    name: 'Taanab system', world: 'taanab',
    note: 'Taanab round its sun in 360 days, with its moon ringed with ice and SWG\'s two others (ours).',
    bodies: [
      star('sun', 'Taanab\'s sun', 'taanab:sun'),
      planet('taanab', 'Taanab', null, 360, 1),
      moon('m1', 'The ice-ringed moon', 'taanab:moon', 'taanab', 22, 0.0031, { tilt: 5, start: 80 }),
      moon('m2', 'A second moon (ours)', 'taanab:moon2', 'taanab', 37, 0.0045, { tilt: 7, start: 220 }),
      moon('m3', 'A third moon (ours)', 'taanab:celestial:cels_moon_earthy01', 'taanab', 64, 0.007, { tilt: 3, start: 330 }),
    ],
  },
  yavin4: {
    name: 'Yavin system', world: 'yavin4',
    note: 'Yavin 4 goes round Yavin Prime locked: the giant stands still in its sky, turns its bands and wobbles a little, phases through the day (full at midnight, a crescent near noon) and hides the sun at noon. Yavin 8, Yavin 13 and a lesser moon go round the giant farther out.',
    bodies: [
      star('sun', 'Yavin (the star)', 'yavin4:sun', { colour: '#ffc48a' }),
      giant('prime', 'Yavin Prime', 'yavin4:celestial:yavin_prime', 4818, 5, { turns: 1.6 }),
      moon('yavin4', 'Yavin 4', null, 'prime', 0, 0.012, { locked: true, wobble: 2, start: lockedStart(0, 14.4) }),
      moon('y8', 'Yavin 8', 'yavin4:celestial:cels_ice_moon', 'prime', 3.2, 0.021, { tilt: 2, start: 200 }),
      moon('y13', 'Yavin 13', 'yavin4:moon', 'prime', 5.4, 0.028, { tilt: 3, start: 40 }),
      moon('lesser', 'A lesser moon', 'yavin4:moon2', 'prime', 9.5, 0.04, { tilt: 5, start: 300 }),
    ],
  },
  hoth: {
    name: 'Hoth system', world: 'hoth',
    note: 'Hoth round its blue-white star in 549 days. SWG has no Hoth sky: the star is drawn by us, and the owner\'s night-sky sheet of three moons goes round as one group (a painted picture: it moves, but shows no phase of its own).',
    bodies: [
      star('sun', 'Hoth (the star)', null, { colour: '#d6e6ff', size: 16 }),
      planet('hoth', 'Hoth', null, 549, 1.8),
      { id: 'moons', kind: 'group', name: 'Hoth\'s three moons', parent: 'hoth', period: 26, radius: 0.004, tilt: 6, start: 170,
        members: [{ name: 'The sheet of three moons', place: 'hoth:nightsky', along: 0, across: 0 }] },
    ],
  },
};

/** The worlds with a draft, in the order the page lists them. */
export const DRAFT_WORLDS = Object.keys(D);

const cache = new Map();
/** A world's draft, checked and marked Draft (the same object each time: copy it before changing it). */
export function draftFor(world) {
  if (!D[world]) return null;
  if (!cache.has(world)) cache.set(world, cleanSystem({ version: 1, draft: true, ...D[world] }));
  return cache.get(world);
}

/** A system of the owner's own to start from: the world's sun (its place when it has one) and the world. */
export function blankSystem(world, name, sunPlace) {
  return cleanSystem({
    version: 1, draft: false, name: `${name}'s system`, world: 'world', note: '',
    bodies: [
      { id: 'sun', kind: 'star', name: 'The sun', place: sunPlace || null, size: sunPlace ? null : 20 },
      { id: 'world', kind: 'planet', name, parent: 'sun', period: 365, radius: 1 },
    ],
  });
}
