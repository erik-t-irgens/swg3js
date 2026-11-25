// One draft per star system (skies in motion II, system.js version 2): every body the lore gives the
// worlds of the game, in its system, and each ground world in it a "where you stand" choice. Numbers
// from the lore research of 21 November (A:\swg3js\imported\skies2\systems.md, systems.json): a value
// named in a body's `src` comes from that source; every other number is our guess. A name is lore
// only where a source gives it; a body the lore has but never names is "unnamed"; a body of ours is
// marked "(ours)".
//
// A draft is never a world's sky: each world keeps SWG's sky until the owner presses Apply, and what
// he applies is copied into his file, so a later change here never moves a sky he has approved.
// Names and numbers only.
//
// Units: periods in real days, a body's own day (`spinHours`) in real hours, radii in astronomical
// units (a planet's orbit about 1, a moon's a few thousandths), angles in degrees, `start` the angle
// round its orbit at the epoch (1 January 2026). Sizes are angles in the sky set by eye: a body with a
// place in the world you stand on takes that place's own size (`sizes` sets one world's by hand);
// elsewhere it takes `size`. A ground world's game day (`dayHours`) defaults to its lore day over
// six, held between 2 and 6 hours. Its latitude and longitude are guesses from its climate (each
// ground's note says why). A locked ground world's longitude sets how high its parent stands.
//
// The first round's one-world drafts are kept in drafts1.js, unchanged, for a sky applied from one.

import { cleanSystem, defaultDayHours } from './system.js';
export { DRAFT_WORLDS as V1_WORLDS, draftFor as draftV1For, blankSystem as blankSystemV1, lockedStart } from './drafts1.js';

const star = (id, name, places, o = {}) => ({ id, kind: 'star', name, places, ...o });
const of = (kind) => (id, name, parent, places, period, radius, o = {}) => ({ id, kind, name, parent, places, period, radius, ...o });
const planet = of('planet'), giant = of('giant'), moon = of('moon'), station = of('station'), comet = of('comet'), belt = of('belt');

const SWAPI = 'SWAPI (Wookieepedia\'s Legends infobox)';
const CROWD = 'the Galactic Map Project\'s crowd list (low confidence)';
const STUDY = 'the Technical Commentaries\' film study';

const D = {
  tatoo: {
    name: 'Tatoo system',
    note: 'Tatoo I and Tatoo II drawn as one body at the centre, the two suns side by side in Tatooine\'s sky, their line square to the sun\'s path, Tatoo II below (it rises after Tatoo I and sets before it), never overlapping. Tatooine round them in 304 days with its three moons, each on its own orbit; the ringed gas giants Ohann and Adriana farther out, small points by eye. The night-sky sheet of three moons is hidden while this applies (the moons stand for it).',
    grounds: [
      { world: 'tatooine', body: 'tatooine', lat: 25, lon: 0, dayHours: defaultDayHours(23), season: 60, note: 'All desert: a world\'s dry belt sits near 20 to 30 degrees. A summer time of year: the twins stand high at noon (75 degrees).' },
      { world: 'tuskan_raid_encounter', copy: 'tatooine' }, { world: 'adventure1', copy: 'tatooine' }, { world: 'adventure2', copy: 'tatooine' }, { world: 'gallery', copy: 'tatooine' },
    ],
    bodies: [
      { id: 'twins', kind: 'pair', name: 'Tatoo I and Tatoo II', separation: 1.5, lineAngle: -90,
        members: [
          { name: 'Tatoo I', places: ['tatooine:sun'], colour: '#fff4e6', brightness: 1 },
          { name: 'Tatoo II', places: ['tatooine:sun2'], colour: '#ffe3bf', brightness: 0.8, size: 14.6 },
        ],
        src: { separation: 'the owner (18 November)', size: `${STUDY}: Tatoo II about 0.70 of Tatoo I`, colour: `${STUDY}: G1 and G2` },
        note: 'The real pair goes round itself in about 64 hours (the film study); drawn as one body it never does. The separation is the gap between their bright discs\' edges.' },
      planet('tatooine', 'Tatooine', 'twins', [], 304, 1.124, { spinHours: 23, axialTilt: 12, src: { period: SWAPI, spinHours: SWAPI } }),
      moon('ghomrassen', 'Ghomrassen', 'tatooine', ['tatooine:moon'], 29, 0.002189, { tilt: 4, node: 0, start: 150, locked: true, colour: '#cfcac0', src: { name: 'both continuities' } }),
      moon('guermessa', 'Guermessa', 'tatooine', ['tatooine:moon2'], 41, 0.002757, { tilt: 6, node: 120, start: 40, locked: true, colour: '#a89c88', src: { name: 'both continuities' } }),
      moon('chenini', 'Chenini', 'tatooine', ['tatooine:celestial:cels_moon_earthy01'], 13, 0.001282, { tilt: 3, node: 240, start: 270, locked: true, colour: '#8f8574', src: { name: 'both continuities' } }),
      giant('ohann', 'Ohann', 'twins', [], 1090, 2.633, { tilt: 1.5, node: 30, start: 140, size: 1, spinHours: 11, axialTilt: 27, colour: '#d9c9a3', src: { name: 'Legends' }, note: 'Second out, cream bands and a ring of ice. From Tatooine a bright point; drawn a little larger by eye.' }),
      giant('adriana', 'Adriana', 'twins', [], 2890, 5.045, { tilt: 2, node: 80, start: 250, size: 0.7, spinHours: 13, axialTilt: 18, colour: '#c9b48e', src: { name: 'Legends (Galaxy Guide 7)' }, note: 'Third and outermost, ringed, with four lifeless moons.' }),
      { id: 'adriana_moons', kind: 'group', name: 'Adriana\'s four moons (unnamed)', parent: 'adriana', period: 9, radius: 0.004, drawn: false,
        members: [{ name: 'First of four (unnamed)' }, { name: 'Second of four (unnamed)', along: 1 }, { name: 'Third of four (unnamed)', along: -1 }, { name: 'Fourth of four (unnamed)', across: 1 }],
        src: { count: 'Legends' }, note: 'Too small to see from Tatooine: in the model, not drawn.' },
    ],
    hide: ['tatooine:nightsky'],
  },

  naboo: {
    name: 'Naboo system',
    note: 'Naboo round its star in 312 days, with Rori, Ohma-D\'un, the small third moon and a fourth of ours (SWG\'s second moon over Rori). Naboo and Rori stand in the same system: from Rori, Naboo is exactly where Naboo\'s sky puts Rori. Rori turns (lore is silent; a moon so close would in truth be locked, which would hold Naboo still in Rori\'s sky: the owner\'s call).',
    grounds: [
      { world: 'naboo', body: 'naboo', lat: 35, lon: 0, dayHours: defaultDayHours(26), season: 0, note: 'Mild, green lake country round Theed: a temperate belt.' },
      { world: 'rori', body: 'rori', lat: 12, lon: 0, dayHours: defaultDayHours(24), season: 0, note: 'Wetter and swampier than Naboo, frequent rain: a warm, wet low latitude. Rori turns, so the longitude only sets where Naboo rises.' },
      { world: 'otoh_gunga', copy: 'naboo' },
    ],
    bodies: [
      star('sun', 'Naboo (the star)', ['naboo:sun', 'rori:sun'], { colour: '#fff2dc', note: 'Its name is only in a fan reference; lore gives it none.' }),
      planet('naboo', 'Naboo', 'sun', ['rori:celestial:cels_naboo'], 312, 0.9003, { spinHours: 26, axialTilt: 18, size: 2, src: { period: SWAPI, spinHours: SWAPI } }),
      moon('rori', 'Rori', 'naboo', ['naboo:moon'], 18, 0.001845, { tilt: 5, node: 20, start: 40, spinHours: 24, axialTilt: 4, colour: '#6b7550', src: { name: 'both continuities' } }),
      moon('ohma', 'Ohma-D\'un', 'naboo', ['naboo:moon2', 'rori:moon'], 27, 0.002417, { tilt: 3, node: 140, start: 160, locked: true, colour: '#7d7a5c', src: { name: 'both continuities' } }),
      moon('third', 'Third moon (unnamed in Legends; canon: Veruna)', 'naboo', ['naboo:celestial:cels_moon_mercury', 'rori:celestial:moon_single'], 9, 0.001162, { tilt: 8, node: 260, start: 280, locked: true, colour: '#8a8780', src: { name: 'canon only' } }),
      moon('fourth', 'A fourth moon (ours)', 'naboo', ['rori:moon2'], 45, 0.003398, { tilt: 6, node: 70, start: 70, locked: true, sizes: { naboo: 5, otoh_gunga: 5 }, colour: '#9aa7a8', note: 'Ours: SWG\'s second moon over Rori.' }),
    ],
  },

  corell: {
    name: 'Corellian system',
    note: 'Corell and the Five Brothers: Corellia with its three moons (Gus Treta the outermost), Drall, Tralus and Talus (the double world, Centerpoint Station half way between them) and Selonia, in that order out. Talus goes round Tralus locked, so Tralus stands still in Talus\'s sky (20 degrees up), phases through the day and hides the sun once a day. SWG\'s red fourth disc over Corellia stands for Drall (lore gives Corellia three moons). Talus\'s two moons are ours.',
    grounds: [
      { world: 'corellia', body: 'corellia', lat: 38, lon: 0, dayHours: defaultDayHours(25), season: 0, note: 'Temperate coast, fields and cities: a mild middle latitude.' },
      { world: 'talus', body: 'talus', lat: 42, lon: 62, dayHours: defaultDayHours(24), season: 0, note: 'Greener and cooler than Corellia. Locked: at 42 degrees and 62 east of the near point Tralus stands 20.4 degrees up, where SWG hangs it.' },
    ],
    bodies: [
      star('sun', 'Corell', ['corellia:sun', 'talus:sun'], { colour: '#fff0cf', src: { colour: 'the Archivum: a yellow G-class star' } }),
      planet('corellia', 'Corellia', 'sun', ['talus:celestial:cels_corellia'], 329, 0.9328, { spinHours: 25, axialTilt: 22, size: 1.2, src: { period: SWAPI, spinHours: SWAPI } }),
      moon('talon', 'Gus Talon', 'corellia', ['corellia:moon'], 21, 0.001855, { tilt: 4, node: 30, start: 20, locked: true, size: 0.4, src: { name: 'both continuities' } }),
      moon('treta', 'Gus Treta', 'corellia', ['corellia:moon2'], 34, 0.002558, { tilt: 6, node: 150, start: 200, locked: true, size: 0.4, src: { name: 'Legends (Suns of Fortune)', order: 'the Archivum: the outermost of three' } }),
      moon('gus', 'Corellia\'s third moon (unnamed in Legends; canon: Gus)', 'corellia', ['corellia:celestial:cels_moon_earthy01'], 11, 0.001206, { tilt: 2, node: 270, start: 110, locked: true, size: 0.4, src: { name: 'canon only' } }),
      planet('drall', 'Drall', 'sun', ['corellia:celestial:cels_mars1'], 392, 1.0, { tilt: 1, node: 10, start: 35, spinHours: 21, axialTilt: 20, size: 1.2, sizes: { corellia: 3 }, colour: '#7f9a76', src: { period: CROWD, spinHours: CROWD, name: 'Legends' }, note: 'Second out: forests, rivers, inland seas. SWG\'s red disc over Corellia stands for it; a look of its own would be green and blue.' }),
      planet('tralus', 'Tralus', 'sun', ['talus:celestial:cels_cpoint_tralus'], 392, 1.09, { tilt: 0.5, node: 0, start: 300, spinHours: 24, axialTilt: 18, size: 0.9, colour: '#7c9872', src: { period: CROWD, name: 'both continuities' }, note: 'Third out with Talus. From Talus SWG\'s picture shows it with Centerpoint.' }),
      planet('talus', 'Talus', 'tralus', [], 0, 0.003, { locked: true, wobble: 1.5, axialTilt: 4, size: 0.8, colour: '#7f9a78', src: { name: 'both continuities' }, note: 'Locked to Tralus: its orbit is its game day.' }),
      station('centerpoint', 'Centerpoint Station', 'tralus', [], 0, 0.0015, { follows: 'talus', share: 0.5, drawn: false, size: 0.3, src: { name: 'Legends' }, note: 'At the twins\' balance point, half way between them: drawn in SWG\'s picture of Tralus from Talus, a speck elsewhere.' }),
      planet('selonia', 'Selonia', 'sun', [], 355, 1.18, { tilt: 1.5, node: 200, start: 200, spinHours: 26, axialTilt: 24, size: 1.1, colour: '#6f94a8', src: { period: CROWD, spinHours: CROWD, name: 'both continuities' }, note: 'Fourth out (the crowd list\'s years do not rise with the order; the orbits do).' }),
      moon('talus_m1', 'Talus\'s moon (ours)', 'talus', ['talus:moon'], 13, 0.0008, { tilt: 4, node: 60, start: 60, locked: true, size: 0.3, colour: '#8e8c86', note: 'Ours: lore gives Talus no moon.' }),
      moon('talus_m2', 'Talus\'s second moon (ours)', 'talus', ['talus:moon2'], 24, 0.0012, { tilt: 7, node: 200, start: 230, locked: true, size: 0.3, colour: '#b0a483', note: 'Ours.' }),
    ],
  },

  dina: {
    name: 'Dantooine system',
    note: 'Dantooine, fourth out, round Dina in 378 days, with its two unnamed moons: the larger pale with a light purple glow, the lesser greenish.',
    grounds: [{ world: 'dantooine', body: 'dantooine', lat: 45, lon: 0, dayHours: defaultDayHours(25), season: 0, note: 'Rolling grassland and steppe: a cool temperate plain.' }],
    bodies: [
      star('sun', 'Dina', ['dantooine:sun'], { colour: '#fff1d2', src: { name: 'canon' } }),
      planet('dantooine', 'Dantooine', 'sun', [], 378, 1.023, { spinHours: 25, axialTilt: 26, src: { period: SWAPI, spinHours: SWAPI } }),
      moon('m1', 'Dantooine\'s larger moon (unnamed)', 'dantooine', ['dantooine:moon'], 24, 0.001812, { tilt: 5, node: 40, start: 30, locked: true, colour: '#b8a8c8', src: { colour: 'Legends text (seen in summaries): a light purple glow' } }),
      moon('m2', 'Dantooine\'s lesser moon (unnamed)', 'dantooine', ['dantooine:moon2'], 47, 0.002837, { tilt: 8, node: 190, start: 210, locked: true, colour: '#a8bca2', src: { colour: 'Legends text (seen in summaries): greenish' } }),
    ],
  },

  domir: {
    name: 'Dathomir system',
    note: 'Dathomir round the red star Domir in 491 days, with the four moons the lore counts (none named). SWG\'s sky shows two; the other two are drawn by eye.',
    grounds: [{ world: 'dathomir', body: 'dathomir', lat: 40, lon: 0, dayHours: defaultDayHours(24), season: 0, note: 'Twisted forest, swamp and mountain, cool and damp.' }],
    bodies: [
      star('sun', 'Domir', ['dathomir:sun'], { colour: '#ff9a72', src: { name: 'both continuities', colour: 'both continuities: its light is red' } }),
      planet('dathomir', 'Dathomir', 'sun', [], 491, 1.027, { spinHours: 24, axialTilt: 28, src: { period: SWAPI, spinHours: SWAPI } }),
      moon('m1', 'First moon (unnamed)', 'dathomir', ['dathomir:moon'], 16, 0.001475, { tilt: 3, node: 0, start: 90, locked: true, colour: '#c2a596', src: { count: 'the Archivum: four moons' } }),
      moon('m2', 'Second moon (unnamed)', 'dathomir', ['dathomir:moon2'], 31, 0.002292, { tilt: 9, node: 100, start: 250, locked: true, colour: '#b49a78' }),
      moon('m3', 'Third moon (unnamed)', 'dathomir', [], 8, 0.000929, { tilt: 5, node: 200, start: 10, locked: true, size: 4, colour: '#c4a8a0' }),
      moon('m4', 'Fourth moon (unnamed)', 'dathomir', [], 60, 0.003559, { tilt: 12, node: 300, start: 170, locked: true, size: 5, colour: '#6f6560' }),
    ],
  },

  endor: {
    name: 'Endor system',
    note: 'The forest moon goes round the gas giant Endor locked: the giant stands still 30 degrees up in its sky, turns its bands at its own 30-hour day, phases through the game day (full at midnight) and hides the sun once a day. Kef Bir and another of the giant\'s nine moons go round it farther out. The star is Ibleam (Legends); canon\'s second star is in the model, not drawn.',
    grounds: [
      { world: 'endor', body: 'forest', lat: 40, lon: 49, dayHours: defaultDayHours(18), season: 0, note: 'Towering conifer forest: a cool, wet temperate belt. Locked: at 40 degrees and 49 east of the near point the giant stands 30.2 degrees up, as SWG fixes it.' },
      { world: 'endor_asommers', copy: 'endor' },
    ],
    bodies: [
      star('sun', 'Ibleam', ['endor:sun'], { colour: '#fff0d8', src: { name: 'Legends' } }),
      star('sun2', 'Endor II (canon only)', [], { parent: 'sun', period: 20000, radius: 40, drawn: false, size: 2, colour: '#ffe8cc', brightness: 0.3, src: { name: 'canon' }, note: 'Canon makes the system a binary; against the game\'s single sun, so it is not drawn.' }),
      giant('giant', 'Endor (the gas giant)', 'sun', ['endor:celestial:cels_endor'], 402, 1.066, { spinHours: 30, axialTilt: 6, colour: '#c8d2dc', src: { period: `${SWAPI} (the forest moon\'s year)`, spinHours: CROWD } }),
      moon('forest', 'The forest moon', 'giant', [], 0, 0.01, { locked: true, wobble: 2, axialTilt: 3, src: { spinHours: `${SWAPI}: 18 hours` }, note: 'Locked by the owner\'s choice: its orbit is its game day.' }),
      moon('kefbir', 'Kef Bir (canon)', 'giant', ['endor:moon'], 2.6, 0.016, { tilt: 2, node: 40, start: 120, locked: true, colour: '#7f9cb0', src: { name: 'canon (2019)' } }),
      moon('m2', 'Another of the nine (canon names them; Legends does not)', 'giant', ['endor:moon2'], 7.1, 0.031, { tilt: 4, node: 220, start: 300, locked: true, colour: '#9a958c', src: { name: 'canon names all nine (The Rise of Skywalker: The Visual Dictionary)' } }),
    ],
  },

  yavin: {
    name: 'Yavin system',
    note: 'Yavin 4 goes round Yavin Prime locked: the giant stands still 40 degrees up in its sky, turns its bands, wobbles a little, phases through the game day (full at midnight) and hides the sun once a day. Yavin 8, Yavin 13 and a lesser moon go round the giant farther out; Fiddanl and the comet Stroiketcy round the star, small by eye.',
    grounds: [{ world: 'yavin4', body: 'yavin4', lat: 5, lon: 50, dayHours: defaultDayHours(24), season: 0, note: 'Hot jungle and fast rivers: near the equator. Locked: at 5 degrees and 50 east of the near point Yavin Prime stands 39.8 degrees up.' }],
    bodies: [
      star('sun', 'Yavin (the star)', ['yavin4:sun'], { colour: '#ffc890', src: { colour: 'Galaxy Guide 2: medium orange' } }),
      planet('fiddanl', 'Fiddanl', 'sun', [], 276, 0.7702, { tilt: 1, node: 0, start: 60, size: 0.6, spinHours: 18, axialTilt: 2, colour: '#b8a28a', src: { period: CROWD, spinHours: CROWD, name: 'Legends' }, note: 'Hot and lifeless, lost in the sun\'s glare.' }),
      comet('stroiketcy', 'Stroiketcy', 'sun', [], 3496, 4.185, { tilt: 14, node: 120, start: 170, size: 0.8, colour: '#e8eef2', src: { period: CROWD, name: 'Legends (Edge of Victory I)' }, note: 'A captured comet: a bright head (its faint tail is not drawn).' }),
      giant('prime', 'Yavin Prime', 'sun', ['yavin4:celestial:yavin_prime'], 4818, 5.183, { spinHours: 11, axialTilt: 3, colour: '#d9874a', src: { period: `${SWAPI} (Yavin 4\'s year)` }, note: 'A vast orange globe, streaky bands, no rings.' }),
      moon('yavin4', 'Yavin 4', 'prime', [], 0, 0.012, { locked: true, wobble: 2, axialTilt: 2, src: { spinHours: `${SWAPI}: 24 hours` }, note: 'Locked by the owner\'s choice (the film study finds it is not): its orbit is its game day.' }),
      moon('y8', 'Yavin 8', 'prime', ['yavin4:celestial:cels_ice_moon'], 3.2, 0.021, { tilt: 2, node: 60, start: 200, locked: true, colour: '#8f8a74', src: { name: 'Legends (Galaxy Guide 2)' } }),
      moon('y13', 'Yavin 13', 'prime', ['yavin4:moon'], 5.4, 0.028, { tilt: 3, node: 160, start: 40, locked: true, colour: '#b59a6e', src: { name: 'Legends (Galaxy Guide 2)' } }),
      moon('lesser', 'A lesser moon (one of the unnamed 26)', 'prime', ['yavin4:moon2'], 9.5, 0.04, { tilt: 5, node: 280, start: 300, locked: true, colour: '#8794a0', src: { count: 'the Archivum: 26 moons' } }),
    ],
  },

  karthakk: {
    name: 'Karthakk system',
    note: 'Lok round Karthakk in 316 days, with Khons, a second moon and SWG\'s third (ours); Maramere farther out, a blue point by eye. Nod Kartha (named only) and the Spine of Lok are in the model, not drawn.',
    grounds: [{ world: 'lok', body: 'lok', lat: 28, lon: 0, dayHours: defaultDayHours(24), season: 0, note: 'Hardened desert, plateaus, sulphur lakes: the dry belt.' }],
    bodies: [
      star('sun', 'Karthakk', ['lok:sun'], { colour: '#fff1d6', src: { name: 'Legends (RPGGamer\'s copy of Wookieepedia)' } }),
      planet('lok', 'Lok', 'sun', [], 316, 0.908, { spinHours: 24, axialTilt: 14, src: { period: 'RPGGamer\'s copy of Wookieepedia (316 local days)', spinHours: 'RPGGamer\'s copy of Wookieepedia' } }),
      moon('khons', 'Khons', 'lok', ['lok:moon'], 26, 0.0034, { tilt: 5, node: 30, start: 50, locked: true, colour: '#8d8a84', src: { name: 'Legends (Jedi Starfighter)' }, note: 'Which of the two lore moons is Khons is ours: the larger.' }),
      moon('m2', 'Lok\'s second moon (unnamed)', 'lok', ['lok:celestial:cels_moon_mercury'], 12, 0.002, { tilt: 3, node: 150, start: 190, locked: true, colour: '#87837c' }),
      moon('m3', 'A third moon (ours)', 'lok', ['lok:moon2'], 41, 0.0049, { tilt: 10, node: 260, start: 320, locked: true, colour: '#8a5c48', note: 'Ours: lore gives Lok two moons.' }),
      planet('maramere', 'Maramere', 'sun', [], 420, 1.098, { tilt: 1.5, node: 50, start: 110, size: 0.8, spinHours: 22, axialTilt: 20, colour: '#4f7fa0', src: { name: 'Legends' }, note: 'Ocean and mountains, home of the Mere; from Lok a blue star.' }),
      planet('nodkartha', 'Nod Kartha', 'sun', [], 600, 1.4, { start: 230, drawn: false, size: 0.5, src: { name: 'Legends' }, note: 'Named only, never described: not drawn.' }),
      belt('spine', 'The Spine of Lok', 'sun', [], 330, 0.95, { drawn: false, src: { name: 'SWG, listed by the Archivum' }, note: 'An asteroid formation: in the model, not drawn.' }),
    ],
  },

  kashyyyk: {
    name: 'Kashyyyk system',
    note: 'Kashyyyk round its star in 381 days, with its three moons (one orange); Trandosha passing by (its year 371 days), the gas giant Alaris farther out, small by eye. Wasskah and Alaris Prime are in the model, too small to draw. The night-sky sheet of two moons is hidden while this applies.',
    grounds: [
      { world: 'kashyyyk_main', body: 'kashyyyk', lat: 10, lon: 0, dayHours: defaultDayHours(26), season: 0, note: 'Immense wet forest: tropical, as the Legends record says.' },
      { world: 'kashyyyk_dead_forest', copy: 'kashyyyk_main' }, { world: 'kashyyyk_hunting', copy: 'kashyyyk_main' }, { world: 'kashyyyk_north_dungeons', copy: 'kashyyyk_main' },
      { world: 'kashyyyk_pob_dungeons', copy: 'kashyyyk_main' }, { world: 'kashyyyk_south_dungeons', copy: 'kashyyyk_main' },
    ],
    bodies: [
      star('sun', 'Kashyyyk (the star)', ['kashyyyk_main:sun'], { colour: '#fff2dc', src: { name: 'the Archivum gives the star the planet\'s name' } }),
      planet('kashyyyk', 'Kashyyyk', 'sun', [], 381, 1.029, { spinHours: 26, axialTilt: 6, src: { period: SWAPI, spinHours: SWAPI } }),
      moon('m1', 'A moon of Kashyyyk (unnamed)', 'kashyyyk', ['kashyyyk_main:moon'], 19, 0.003, { tilt: 4, node: 20, start: 15, locked: true, colour: '#c2b394', src: { count: 'the Archivum: three moons' } }),
      moon('m2', 'A second moon of Kashyyyk (unnamed)', 'kashyyyk', ['kashyyyk_main:celestial:cels_moon_earthy01'], 33, 0.0048, { tilt: 6, node: 140, start: 140, locked: true, colour: '#8c7a74' }),
      moon('m3', 'Kashyyyk\'s orange moon (unnamed)', 'kashyyyk', ['kashyyyk_main:celestial:cels_mars1'], 9, 0.002, { tilt: 3, node: 250, start: 260, locked: true, colour: '#c98a5a', src: { colour: 'the Archivum: one moon orange' } }),
      planet('trandosha', 'Trandosha', 'sun', ['kashyyyk_main:moon2'], 371, 1.2, { start: 4, spinHours: 25, axialTilt: 16, size: 1.5, colour: '#7f9a6e', src: { period: SWAPI, spinHours: SWAPI } }),
      moon('wasskah', 'Wasskah', 'trandosha', [], 15, 0.0015, { tilt: 4, drawn: false, size: 0.3, locked: true, colour: '#4f7048', src: { name: 'canon (The Clone Wars)' }, note: 'A speck beside Trandosha from Kashyyyk: not drawn.' }),
      giant('alaris', 'Alaris', 'sun', [], 2200, 3.311, { tilt: 1.5, node: 90, start: 75, size: 1, spinHours: 12, axialTilt: 12, colour: '#c4b28a', src: { name: 'Legends (Galactic Battlegrounds)' } }),
      moon('alarisprime', 'Alaris Prime', 'alaris', [], 6, 0.005, { tilt: 2, drawn: false, size: 0.3, locked: true, colour: '#5c7a50', src: { name: 'Legends and canon' }, note: 'Hidden by its giant in the lore; a speck from Kashyyyk: not drawn.' }),
    ],
    hide: ['kashyyyk_main:nightsky'],
  },

  mustafar: {
    name: 'Mustafar system',
    note: 'Mustafar round Priate in 412 days between the gas giants Jestefad (just inside, about 65 degrees from the sun, half lit) and Lefrani (just outside, about 130 degrees from it, gibbous), both on the same side, so they stand in the evening sky together. Both share Mustafar\'s year, so they stay close beside it as the lore keeps them (at other years the clockwork would carry them to the far side of the star). Nur goes round Mustafar (the owner\'s ask; canon also puts it round Jestefad).',
    grounds: [{ world: 'mustafar', body: 'mustafar', lat: 20, lon: 0, dayHours: defaultDayHours(36), season: 0, note: 'Volcanic everywhere, so the latitude is free; a fairly high sun suits the ash-light. Its 36-hour lore day makes the longest game day, 6 hours.' }],
    bodies: [
      star('sun', 'Priate', ['mustafar:sun'], { colour: '#ffd9b0', src: { name: 'canon' } }),
      giant('jestefad', 'Jestefad', 'sun', ['mustafar:celestial:jestefad'], 412, 1.0, { tilt: 1, node: 0, start: 15, spinHours: 10, axialTilt: 10, colour: '#a08a70', src: { name: 'both continuities' }, note: 'Inside Mustafar, almost its bigger twin; its field drives storms round Mustafar.' }),
      planet('mustafar', 'Mustafar', 'sun', [], 412, 1.084, { spinHours: 36, axialTilt: 8, src: { period: SWAPI, spinHours: SWAPI } }),
      moon('nur', 'Nur', 'mustafar', ['mustafar:moon'], 14, 0.0028, { tilt: 6, node: 60, start: 100, locked: true, colour: '#4a6478', src: { name: 'canon only (Jedi: Fallen Order)' }, note: 'No land, rough seas, the Inquisitors\' fortress.' }),
      giant('lefrani', 'Lefrani', 'sun', ['mustafar:celestial:lefrani'], 412, 1.3, { tilt: 2, node: 0, start: 10, spinHours: 13, axialTilt: 22, colour: '#8b8f98', src: { name: 'both continuities' }, note: 'Outside Mustafar, a fainter, cooler banded globe.' }),
    ],
  },

  hoth: {
    name: 'Hoth system',
    note: 'Hoth, sixth out, round its faint blue-white star in 549 days, leaning at least 20 degrees; a late winter time of year gives it a low sun (21 degrees at noon). SWG has no Hoth sky: the star is drawn by us, and the owner\'s night-sky sheet of three moons goes round as one group. The three moons themselves (unnamed) and the asteroid belt are in the model, not drawn: tick Drawn on each (and untick the sheet\'s group) to draw them one by one.',
    grounds: [{ world: 'hoth', body: 'hoth', lat: 55, lon: 0, dayHours: defaultDayHours(23), season: -45, note: 'Ice everywhere, so the latitude is free; a low sun suits it (daylight 1.5 hours, night 2.4).' }],
    bodies: [
      star('sun', 'Hoth (the star)', [], { colour: '#d6e6ff', size: 16, src: { colour: 'the Archivum: faint blue-white' } }),
      planet('hoth', 'Hoth', 'sun', [], 549, 1.8, { spinHours: 23, axialTilt: 20.2, src: { period: SWAPI, spinHours: SWAPI, axialTilt: `${STUDY}: at least 20.2 degrees` } }),
      { id: 'moons', kind: 'group', name: 'Hoth\'s three moons (the owner\'s sheet)', parent: 'hoth', period: 26, radius: 0.004, tilt: 6, start: 170,
        members: [{ name: 'The sheet of three moons', places: ['hoth:nightsky'], along: 0, across: 0 }] },
      moon('m1', 'Hoth\'s grey moon (unnamed)', 'hoth', [], 6, 0.00053, { tilt: 6, node: 0, start: 20, drawn: false, size: 6, locked: true, colour: '#9a9a98', src: { count: STUDY } }),
      moon('m2', 'Hoth\'s red moon (unnamed)', 'hoth', [], 3, 0.00033, { tilt: 4, node: 120, start: 200, drawn: false, size: 4, locked: true, colour: '#9a6a5c', src: { colour: STUDY } }),
      moon('m3', 'Hoth\'s small moon (unnamed)', 'hoth', [], 15, 0.00097, { tilt: 8, node: 240, start: 300, drawn: false, size: 2, locked: true, colour: '#8a5a50', src: { colour: STUDY } }),
      belt('belt', 'The Hoth asteroid belt', 'sun', [], 600, 1.9, { drawn: false, src: { name: 'both continuities' }, note: 'Close to Hoth, never between it and its star: in the model, not drawn.' }),
    ],
  },

  tive: {
    name: 'Taanab system',
    note: 'Taanab round the yellow star Tive (its year 594 days and its day 46 hours only in a crowd list), with its moon ringed with ice and SWG\'s two others (ours).',
    grounds: [{ world: 'taanab', body: 'taanab', lat: 30, lon: 0, dayHours: defaultDayHours(46), season: 0, note: 'Farm meadows, mild nearly all year (a small tilt fits).' }],
    bodies: [
      star('sun', 'Tive', ['taanab:sun'], { colour: '#fff0cc', src: { name: 'canon', colour: 'canon: yellow' } }),
      planet('taanab', 'Taanab', 'sun', [], 594, 1.383, { spinHours: 46, axialTilt: 4, src: { period: CROWD, spinHours: CROWD } }),
      moon('icemoon', 'Taanab\'s moon (unnamed), ringed with ice', 'taanab', ['taanab:moon'], 22, 0.0031, { tilt: 5, node: 30, start: 80, locked: true, colour: '#d6dce0', src: { look: 'Legends: a moon ringed with ice' } }),
      moon('m2', 'A second moon (ours)', 'taanab', ['taanab:moon2'], 37, 0.0045, { tilt: 7, node: 150, start: 220, locked: true, colour: '#9aa4ae', note: 'Ours.' }),
      moon('m3', 'A third moon (ours)', 'taanab', ['taanab:celestial:cels_moon_earthy01'], 64, 0.007, { tilt: 3, node: 270, start: 330, locked: true, colour: '#8c7f74', note: 'Ours.' }),
    ],
  },

  // (Skies of his own worlds, 24 November) A world of the owner's own, not of the game's: its ground is his Utapau world (his
  // worlds file's `ours_race_map_2`), which borrows another world's sky, so no SWG place stands for any body here and every one
  // is hung as the system's own. Lore of 24 November: the star's name is canon (Last Shot, 2018); the planet's day, year and
  // size are SWAPI's (from the Revenge of the Sith reference books); nine moons is the count Wookieepedia's system page gives
  // (canon's Databank says only that many moons ring it), none of them named. The "Fourth Moon of Utapau" of The Star Wars (the
  // comic of the first draft) is a moon of another Utapau, the Kessil system's, with five moons: not this world's, so none here
  // takes its name (the wave's fixer, 24 November). No other planet of the system is named in either.
  utapau: {
    name: 'Utapau system',
    note: 'Utapau round its star, also called Utapau, in 351 days, ringed by nine moons, several of them seen in its sky in the films: four drawn by eye, the other five in the model and not drawn, none named in the lore. The lore names no other planet of the system and gives its star no colour.',
    grounds: [
      { world: 'ours_race_map_2', body: 'utapau', lat: 28, lon: 0, dayHours: defaultDayHours(27), season: 0, note: 'Arid, windy scrubland and savanna over its sinkholes (SWAPI): the dry belt near 28 degrees. His own Utapau world.' },
    ],
    bodies: [
      star('sun', 'Utapau (the star)', [], { colour: '#fff1dc', size: 37, src: { name: 'canon (Last Shot): the star shares the planet\'s name' }, note: 'Lore gives it no colour or class: a sun like ours by eye. Its size 37 is the square of the borrowed sky\'s sun card his Utapau stands under (Lok\'s, 36.9 degrees), so the disc drawn is the plain star\'s, about our sun\'s.' }),
      planet('utapau', 'Utapau', 'sun', [], 351, 0.9738, { spinHours: 27, axialTilt: 12, src: { period: SWAPI, spinHours: SWAPI }, note: 'Its orbit\'s radius from its year about a star like ours by Kepler\'s third law, as every draft\'s (ours); its tilt by eye.' }),
      moon('m1', 'A moon of Utapau (unnamed)', 'utapau', [], 8.7, 0.0012, { tilt: 3, node: 20, start: 60, locked: true, size: 3, colour: '#b7ada0', src: { count: 'nine in all (Wookieepedia\'s system page)' }, note: 'The four drawn stand at the radii and periods a moon of a world of Earth\'s size would have (ours), their sizes by eye.' }),
      moon('m2', 'A second moon of Utapau (unnamed)', 'utapau', [], 16, 0.0018, { tilt: 5, node: 140, start: 200, locked: true, size: 4.5, colour: '#c9c2b4' }),
      moon('m3', 'A third moon of Utapau (unnamed)', 'utapau', [], 26, 0.0025, { tilt: 2, node: 260, start: 310, locked: true, size: 5, colour: '#a89f92' }),
      moon('fourth', 'A fourth moon of Utapau (unnamed)', 'utapau', [], 40, 0.0033, { tilt: 6, node: 80, start: 140, locked: true, size: 4, colour: '#9a9a96', note: 'Grey by eye (ours). The "Fourth Moon of Utapau" of The Star Wars (the comic of the first draft) circles the Kessil system\'s Utapau, another world: not this one.' }),
      { id: 'others', kind: 'group', name: 'Utapau\'s other five moons (unnamed)', parent: 'utapau', period: 70, radius: 0.005, drawn: false,
        members: [{ name: 'Fifth of nine (unnamed)' }, { name: 'Sixth of nine (unnamed)', along: 1 }, { name: 'Seventh of nine (unnamed)', along: -1 }, { name: 'Eighth of nine (unnamed)', across: 1 }, { name: 'Ninth of nine (unnamed)', across: -1 }],
        src: { count: 'nine in all (Wookieepedia\'s system page)' }, note: 'In the model, not drawn: the lore gives them nothing to draw.' },
    ],
  },
};

/** The systems with a draft, in the order the page lists them. */
export const DRAFT_SYSTEMS = Object.keys(D);

const cache = new Map();
/** A system's draft, checked and marked Draft (the same object each time: copy it before changing it). */
export function draftSystem(id) {
  if (!D[id]) return null;
  if (!cache.has(id)) cache.set(id, cleanSystem({ version: 2, id, draft: true, ...D[id] }));
  return cache.get(id);
}

/** The draft system that holds a ground world, or null. */
export function draftSystemOf(world) {
  for (const id of DRAFT_SYSTEMS) if (D[id].grounds.some((g) => g.world === world)) return id;
  return null;
}

/** A system of the owner's own to start from: the world's sun (its place when it has one) and the world, which he stands on. */
export function blankSystem2(world, name, sunPlace) {
  return cleanSystem({
    version: 2, id: null, draft: false, name: `${name}'s system`, note: '',
    grounds: [{ world, body: 'world', lat: 30, lon: 0, dayHours: 4, season: 0 }],
    bodies: [
      { id: 'sun', kind: 'star', name: 'The sun', places: sunPlace ? [sunPlace] : [], size: sunPlace ? null : 20 },
      { id: 'world', kind: 'planet', name, parent: 'sun', period: 365, radius: 1, spinHours: 24, axialTilt: 15 },
    ],
  });
}
