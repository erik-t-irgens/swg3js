// The space body viewer: the library of looks, the inspector (a look's layers, a place's own settings,
// every place), the stage in its three views (a look close up as a preview, a space zone in orbit, a
// ground sky from the ground), and the file of choices. The stage is stage.js, a look's meshes and
// materials build.js, the places and SWG's rules places.js, the place views placeview.js, the lore's
// reading loreview.js (the lore itself is lore.js, read only), added pictures' rules pictures.js.

import * as THREE from 'three/webgpu';
import { createStage, frameCamera } from '../src/sky/look/stage.js';
import {
  buildLook, updateLook, syncLook, disposeLook, setTextureInfo, texInfo, textureIfLoaded, releaseTextures, setAddedPictures, forgetTexture,
  setBakeRenderer, rebakeGenerated, generatedInfo, generatedHash, generatedPixels, needsRebuild, partsInfo,
} from '../src/sky/look/build.js';
import {
  RECIPES, PRESETS, PRESET_ORDER, SHADING_DIALS, CLOUD_DIALS, SIZES, presetLook, cleanGenerated, randomSeed, bakeStats,
  LIGHT_DIALS, FEATURE_DIALS, MIX_DIALS, mixDialsOf, mixFrom, glowKind, glowKinds, presetDials, presetParts,
} from '../src/sky/look/generate.js';
// recipe version 2 (21 November): its cloud flecks and colour grade, and the colour matcher
import { GRADE_DIALS, CLOUD_SPOT_DIALS, recipeVersion } from '../src/sky/look/generate.js';
// recipe version 3 (looks run 2, living worlds): fine fray, lakes and cirrus streaks
import { CLOUD_STREAK_DIALS } from '../src/sky/look/generate.js';
// (the atmosphere brief's wave B) the planet features, a new version of every recipe
import { PART_DIALS, partsVersion } from '../src/sky/look/generate.js';
import { discStats, gradeToward, statsWords, compareStats } from '../src/sky/look/colourmatch.js';
import { SHAPE_KINDS, BELT_KINDS, RING_STYLES, shapeDialsOf, BELT_DIALS, RING_DIALS, newPart, startsOf, RING_STYLE_DIALS } from '../src/sky/look/partdials.js';
import { FIELD_TUNE } from '../src/sky/look/shapes.js';
import {
  PICTURE_KINDS, KIND_ORDER, nameProblem, plainName, sniffPicture, extFor, mimeFor, guessKind, cleanPictures, sizeWords, MAX_PICTURE_BYTES, PICTURE_EXT,
} from '../src/sky/look/pictures.js';
import { cleanLore, loreFor, systemFor, isOurs, kindLine, searchText, boldParts } from '../src/sky/look/loreview.js';
import {
  SLOTS, SLOT_NAMES, GROUPS, MESHES, HALOS, RINGS, defaultLooks, makeLook, EXTRA_PLACES, DEFAULT_USES, DEFAULT_USES_SINCE, MAIN_WORLDS,
} from '../src/sky/look/looks.js';
import {
  parseSkies, buildPlaces as buildPlaceList, unknownPlace, effective, cleanPlaceEdits, cleanZoneEdits, zoneSunDefaults, lightSourcesFor,
  placeDirection, placeLight, dayAt, clockText, directionWords, phaseOf, worldName,
} from '../src/sky/system/places.js';
import { PlaceView, PLACEHOLDER } from '../src/sky/look/placeview.js';
// (the atmosphere brief's wave B) the day wash's starting numbers, for its sliders' starts and resets
import { WASH } from '../src/sky/look/skywash.js';
import {
  DIALS as SYS_DIALS, KINDS as SYS_KINDS, MAX_BODIES2, MAX_MEMBERS, cleanSystem, compileSystem, makeSkyState, skyAt, skyTime,
  realDays, msOfRealDays, DAY_MS, localHour, timeAtHour, skyRuleFor, groundOf, noonHeight, daylightHours, declination,
} from '../src/sky/system/system.js';
import { DRAFT_SYSTEMS, draftSystem, draftSystemOf, blankSystem2, draftV1For } from '../src/sky/system/drafts.js';
import { Orrery } from '../src/sky/look/orrery.js';
import { setWeatherTime, setFlashListener } from '../src/sky/look/build.js';
import { STORM_DIALS, MOTION_DIALS } from '../src/sky/look/weather.js';
// (the GPU port's pass 2, wave 4) "draw as the game does" with the game's own air, in place of the old gamelook.js; a picture
// marked to ship with the game (pictures.js), Save to game's own writer's rules (its server's), and the game's planet names
import { GameLook, stageSource, viewerWorldOf } from '../src/sky/look/gameAir.ts';
import { shippable } from '../src/sky/look/pictures.js';
import { Thunder } from '../src/sky/look/thunder.js';
import { VOLUME_KINDS, VOLUME_DIALS } from '../src/sky/look/partdials.js';
import { VOLUME_QUALITIES, VOLUME_TIERS, setVolumeQuality, volumeFrame, volumeQualityState, volumeQualityChanges, measureTiers, volumeBakeCount } from '../src/sky/look/volume.js';
import { volumeInfo, volumeHash } from '../src/sky/look/build.js';
// the placeholders (21 November): a look for every lore body that has none of its own
import { placeholderLooks, placeholderFor, placeholderOfPlace } from '../src/sky/look/placeholders.js';
// (looks run 2) a placeholder he never touched stays a default: not written on Save, and an unchanged copy in his file is read as untouched
import { isUntouchedPlaceholder } from '../src/sky/look/placeholders.js';
// (looks run 2) a look of his pictures that are not in the imported folder (a player without his imports) falls back to its generated twin
import { twinOfLook, placeholderPrint, sameAsTable } from '../src/sky/look/placeholders.js';
import { isPastTwin } from '../src/sky/look/placeholders.js';
import { TWINS } from '../src/sky/look/generate.js';
// (the atmosphere brief's wave A) the air round the bodies: each look's Air setting and dials, the viewer's choice for all
import { AIR_DIALS, AIR_MODES, AIR_QUALITIES, cleanAir, airStartFor } from '../src/sky/look/airProfile.js';
import { setAirChoice, airModeOf, airOf, airInfo } from '../src/sky/look/build.js';
// (the GPU port's pass 2, wave 4) the one hook every picture and mesh is read through (build.js)
import { pictureUrl } from '../src/sky/look/build.js';
// (looks run 2, the review) a generated twin he has not touched is a default as a placeholder is: not written on
// Save and an unchanged copy in his file read as the table's, so a better twin later reaches him (one he edits is his)
// (the atmosphere brief's wave A) a copy in his file from before the air came (no `air`) that is the table's look but
// for its air is untouched too (sameAsTable), so the table's twin, air and all, reaches him
// (wave B) or a twin as an earlier table had it, saved unchanged before the twin was re-tuned (TWIN_PAST_PRINTS)
const isUntouchedDefault = (id, look, tableLook) => isUntouchedPlaceholder(id, look, tableLook)
  || (!!look && !!tableLook && PRESETS[tableLook.generated?.preset]?.group === TWINS && (sameAsTable(look, tableLook) || isPastTwin(id, look)));

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let S = null; // the stage
let placeView = null;

const FILE_VERSION = 2;

const state = {
  looks: {}, uses: {}, places: [], placesById: new Map(), skies: new Map(), files: [],
  placeEdits: {}, zoneEdits: {}, zoneSky: new Map(),
  pictures: {}, // pictures added from the page: { <file name>: { kind, added } }, saved with the choices
  lore: null, // lore.js, read only and never saved (loreview.js's cleanLore), or null without it
  mode: 'look', placeId: null, hours: params.has('time') ? +params.get('time') : 2, playing: false, speed: 1,
  currentId: null, current: null, backdrop: null, backdropHolder: new THREE.Group(),
  compareId: params.get('compare') || null, compare: null, // another look beside the previewed one (not saved)
  dirty: false, savedAt: null, build: 0, clock: +(params.get('clock') || 0), loadedVersion: null,
  openSlots: new Set(['surface']), closedGroups: new Set(), pick: null, readyAt: 0, frames: 0,
  // for the reset buttons: each look of no default as it was made or loaded, and the places' choices
  // as last loaded or saved (a place setting's reset goes back to that; its "SWG's" to SWG's)
  madeLooks: {}, saved: { uses: {}, placeEdits: {}, zoneEdits: {}, systems: {} },
  // skies in motion: the owner's systems ({ <world>: { applied, system } }, only what he touched),
  // the system clock's day, a world whose system is previewed from the ground (never saved), the
  // world the System tab shows, and a count that moves with every change (the models are made again)
  systems: {}, day: params.has('day') ? Math.max(0, Math.floor(+params.get('day') || 0)) : 0, preview: null, sysWorld: null, sysRev: 0, sysSpeed: 1,
  // skies in motion II: his systems of version 2 ({ <system id>: { applied, system } }), the system the
  // System tab shows and where it stands in each, and the real clock the skies of version 2 follow (the
  // moment shown, in ms; live: the wall's clock). A preview is now a system's id.
  starSystems: {}, madeStar: {}, sysId: null, sysStand: {}, realT: Date.now(), live: true, globeLon: 0, globeFor: null,
  // wave 4: the viewer's own switches (each a step of the history, kept in the file only when not at its start),
  // the weather's motion clock, and each world's colour ramp as the server hands it (null: none)
  viewer: null, weatherT: 0, ramps: new Map(),
};
// (wave 5: `volumes`, the space volumes' quality: auto by frame time, or a tier chosen)
// (the atmosphere brief's wave A: `airQuality`, the air's march by quality; `airAll`, its form for every look at once
// for a comparison, "as each look says" at its start and never written to the file)
// (the atmosphere brief's wave B: the day wash from the ground, on or off, and its numbers, skywash.js's WASH: how much
// of the sky lies in front of a body, how thick the air is against its own, how much a body dims by full day, and how
// much of the drawn sun's glow lies in front of one beside it; each a step of the history, written only off its start)
const VIEWER_DEFAULTS = { gameLook: false, thunder: false, thunderVolume: 0.5, volumes: 'auto', airQuality: 'medium', airAll: 'own', wash: true, washFront: WASH.inFront, washThick: WASH.thick, washDim: WASH.dayDim, washSun: WASH.sun };
/** (wave B) The wash's sliders: key, label, range, what it does. */
const WASH_DIALS = [
  ['washFront', 'In front', 0, 2, 0.01, 'How much of the sky\'s own light lies in front of a body (1: all of it, as the sky is the air\'s light with space behind it). A Painted body\'s and a Scattered body\'s alike'],
  ['washThick', 'Thickness', 0, 4, 0.01, 'The air between us and a body, against its own (1): how much of the body\'s light it takes on the way, more toward the horizon. A Scattered body\'s is the ground world\'s own air (its look\'s Air dials); this scales it'],
  ['washDim', 'Day dimming', 0, 1, 0.01, 'How much dimmer a body\'s own light looks by full day, the eye set for the bright sky (0: as by night)'],
  ['washSun', 'Sun\'s glow', 0, 3, 0.01, 'How much of the drawn sun\'s own glow lies in front of a body beside it (1: all of it, as the glow is the air\'s light round the sun; 0: none, so a moon by the sun is cut darker than the halo round it)'],
];
const clampNum = (v, lo, hi, def) => (v !== null && v !== undefined && v !== '' && Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : def);
const AIR_ALL = [['own', 'as each look says'], ['scattered', 'Scattered for all'], ['painted', 'Painted for all']];
const cleanViewer = (v) => ({
  gameLook: v?.gameLook === true,
  thunder: v?.thunder === true,
  thunderVolume: Number.isFinite(+v?.thunderVolume) && v?.thunderVolume !== null && v?.thunderVolume !== '' ? Math.max(0, Math.min(1, +v.thunderVolume)) : VIEWER_DEFAULTS.thunderVolume,
  volumes: VOLUME_QUALITIES.some(([k]) => k === v?.volumes) ? v.volumes : VIEWER_DEFAULTS.volumes,
  airQuality: AIR_QUALITIES.some(([k]) => k === v?.airQuality) ? v.airQuality : VIEWER_DEFAULTS.airQuality,
  airAll: AIR_ALL.some(([k]) => k === v?.airAll) ? v.airAll : VIEWER_DEFAULTS.airAll,
  wash: v?.wash !== false,
  ...Object.fromEntries(WASH_DIALS.map(([k, , lo, hi]) => [k, clampNum(v?.[k], lo, hi, VIEWER_DEFAULTS[k])])),
});
state.viewer = cleanViewer(null);
let gameLook = null;
const thunder = new Thunder();

// ---------------------------------------------------------------------------------------------
// small helpers

const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k);
  return e;
};
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setPath(o, p, v) {
  const ks = p.split('.');
  let a = o;
  for (let i = 0; i < ks.length - 1; i++) {
    if (a[ks[i]] == null) a[ks[i]] = {};
    a = a[ks[i]];
  }
  a[ks[ks.length - 1]] = v;
}
const fmt = (v, step) => {
  const n = +v;
  if (!isFinite(n)) return '';
  const d = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return n.toFixed(d);
};
async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
async function getText(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.text();
}
let statusTimer = 0;
function setStatus(msg, error = false) {
  const s = $('status');
  clearTimeout(statusTimer);
  if (!msg) { s.hidden = true; return; }
  s.hidden = false;
  s.textContent = msg;
  s.classList.toggle('error', !!error);
  if (error) console.warn('[viewer]', msg);
}
function setDirty(d) {
  state.dirty = d;
  state.sysRev++; // a place's size or a system's dial: the systems' models are made again
  const s = $('saveState');
  s.textContent = d ? 'Unsaved changes' : state.savedAt ? `Saved ${state.savedAt.replace('T', ' ').slice(0, 16)}` : 'Defaults (nothing saved yet)';
  s.classList.toggle('dirty', d);
  // every change ends in a step of the undo history, a moment after it stops moving
  if (d && !hist.applying) checkpointSoon();
}

// ---------------------------------------------------------------------------------------------
// Undo and redo: every change to the choices (the looks, which look each place uses, the places'
// own settings, the zones' suns, the places and zones of his own) is a step, kept a moment after it stops moving (a slider's drag is
// one step). Each step is the choices written out a look at a time, and a look unchanged from the step
// before shares that step's text, so a long history of small changes costs little. Pictures added
// from the page are not steps (they are files in the folder). Loading the file starts it afresh.

const HISTORY_MAX = 100;
const hist = { undo: [], redo: [], cur: null, savedCur: null, timer: 0, applying: false, busy: false };
const noUnderscore = (k, v) => (k.startsWith('_') ? undefined : v);

function snapshot() {
  const prev = hist.cur;
  const looks = new Map();
  for (const [id, l] of Object.entries(state.looks)) {
    const s = JSON.stringify(l, noUnderscore);
    const p = prev?.looks.get(id);
    looks.set(id, p === s ? p : s);
  }
  // `at`: the look on show, to go back to when an undo takes away the one on show (a copy, say)
  // (the owner's own zones and places are in each step too: left out, an undo back to the saved step
  // called the page saved while a place added since was not, and undid its look or sun without it)
  return { looks, uses: JSON.stringify(state.uses), places: JSON.stringify(state.placeEdits), zones: JSON.stringify(state.zoneEdits), added: JSON.stringify(state.added || null), systems: JSON.stringify(state.systems), starSystems: JSON.stringify(state.starSystems), viewer: JSON.stringify(state.viewer), at: state.currentId };
}
function sameSnap(a, b) {
  if (a.uses !== b.uses || a.places !== b.places || a.zones !== b.zones || a.added !== b.added || a.systems !== b.systems || a.starSystems !== b.starSystems || a.viewer !== b.viewer || a.looks.size !== b.looks.size) return false;
  for (const [id, s] of a.looks) if (b.looks.get(id) !== s) return false;
  return true;
}
function checkpointSoon() {
  // the first change of a step: the look on show as it began is the one to come back to
  if (!hist.timer && hist.cur) hist.cur.at = state.currentId;
  clearTimeout(hist.timer);
  hist.timer = setTimeout(checkpoint, 350);
  updateUndoButtons();
}
function checkpoint() {
  clearTimeout(hist.timer);
  hist.timer = 0;
  if (!hist.cur) return;
  const now = snapshot();
  if (!sameSnap(hist.cur, now)) {
    hist.undo.push(hist.cur);
    if (hist.undo.length > HISTORY_MAX) hist.undo.shift();
    hist.cur = now;
    hist.redo = [];
  }
  updateUndoButtons();
}
/** The history starts afresh from what was just loaded, and that is "saved". */
function resetHistory() {
  clearTimeout(hist.timer);
  hist.timer = 0;
  hist.undo = [];
  hist.redo = [];
  hist.cur = null;
  hist.cur = snapshot();
  hist.savedCur = hist.cur;
  updateUndoButtons();
}
function updateUndoButtons() {
  const u = $('undo'), r = $('redo');
  if (!u || !r) return;
  const nu = hist.undo.length + (hist.timer ? 1 : 0);
  u.disabled = !nu || hist.busy;
  r.disabled = !hist.redo.length || hist.timer !== 0 || hist.busy;
  u.title = nu ? `Undo the last change (Ctrl+Z): ${nu} step${nu > 1 ? 's' : ''} back` : 'Nothing to undo (Ctrl+Z)';
  r.title = hist.redo.length ? `Redo (Ctrl+Shift+Z or Ctrl+Y): ${hist.redo.length} step${hist.redo.length > 1 ? 's' : ''} forward` : 'Nothing to redo (Ctrl+Shift+Z or Ctrl+Y)';
}
async function undo() {
  if (hist.busy) return;
  if (hist.timer) checkpoint();
  if (!hist.undo.length) return;
  const to = hist.undo.pop();
  hist.redo.push(hist.cur);
  await applySnap(to);
}
async function redo() {
  if (hist.busy) return;
  if (hist.timer) checkpoint();
  if (!hist.redo.length) return;
  const to = hist.redo.pop();
  hist.undo.push(hist.cur);
  await applySnap(to);
}

/** What changed between two versions of a look: anything but a slider's number or a colour needs it built anew. */
function changeOf(a, b) {
  const res = { rebuild: false, names: false };
  const walk = (x, y, key) => {
    if (x === y || res.rebuild) return;
    if (key === 'name' || key === 'note' || key === 'group') { res.names = true; return; }
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      if (Array.isArray(x) !== Array.isArray(y)) { res.rebuild = true; return; }
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
        if (!(k in x) || !(k in y)) { res.rebuild = true; return; }
        walk(x[k], y[k], k);
      }
      return;
    }
    if (typeof x === 'number' && typeof y === 'number') return; // a slider: synced, baked when it is a dial
    const hex = /^#[0-9a-f]{6}$/i;
    if (typeof x === 'string' && typeof y === 'string' && hex.test(x) && hex.test(y)) return; // a colour
    res.rebuild = true; // a choice, a picture, a tick, or the shape changed
  };
  walk(a, b, '');
  return res;
}

/** Put the choices back as a step of the history had them, and redraw, rebuild or bake as that needs. */
async function applySnap(to) {
  const from = hist.cur;
  hist.busy = true;
  hist.applying = true;
  let rebuild = false, lookSet = false, names = false, usesChanged = false, addedChanged = false, systemsChanged = false;
  const changed = [];
  try {
    for (const id of from.looks.keys()) if (!to.looks.has(id)) { delete state.looks[id]; lookSet = true; }
    for (const [id, s] of to.looks) {
      const old = from.looks.get(id);
      if (old === s) continue;
      const next = JSON.parse(s);
      const cur = state.looks[id];
      if (!cur || old === undefined) { state.looks[id] = next; lookSet = true; continue; }
      const how = changeOf(JSON.parse(old), next);
      // in place, so the stage's built look and its baked textures stay this look's
      for (const k of Object.keys(cur)) if (!k.startsWith('_')) delete cur[k];
      Object.assign(cur, next);
      rebuild ||= how.rebuild;
      names ||= how.names;
      changed.push(id);
    }
    if (from.uses !== to.uses) { state.uses = JSON.parse(to.uses); usesChanged = true; }
    if (from.places !== to.places) state.placeEdits = JSON.parse(to.places);
    if (from.zones !== to.zones) state.zoneEdits = JSON.parse(to.zones);
    if (from.added !== to.added) { state.added = JSON.parse(to.added) || { zones: {}, places: [] }; addedChanged = true; makePlaces(); }
    if (from.systems !== to.systems) { state.systems = JSON.parse(to.systems) || {}; systemsChanged = true; }
    if (from.starSystems !== to.starSystems) { state.starSystems = JSON.parse(to.starSystems || '{}') || {}; systemsChanged = true; }
    if (from.viewer !== to.viewer && to.viewer) { state.viewer = cleanViewer(JSON.parse(to.viewer)); applyViewer(); }
    state.sysRev++;
    hist.cur = to;
    setDirty(to !== hist.savedCur);
  } finally {
    hist.applying = false;
  }
  try {
    if (lookSet || names || usesChanged || addedChanged) renderLibrary();
    if (lookSet || usesChanged || addedChanged) renderPlaces();
    // a place of his own come or gone: the place on show is built again (or left, when it went)
    if (addedChanged && state.mode === 'place') rebuild = true;
    // a system changed: its panel again, and a sky that follows it built again
    if (systemsChanged) { renderSystemPanel(); if (state.mode === 'place' && skyFollows(placeView.zone)) rebuild = true; }
    if (!state.looks[state.currentId]) {
      state.currentId = state.looks[to.at] ? to.at : state.looks.naboo ? 'naboo' : Object.keys(state.looks)[0];
      rebuild = true;
    }
    // a generated look's dials or seed: baked again in place (nothing happens when its bake is the same)
    if (!rebuild) {
      for (const id of changed) {
        const look = state.looks[id];
        if (!look?.generated) continue;
        const ms = await rebakeGenerated(look).catch(() => null);
        if ((ms === null && id === state.currentId) || needsRebuild(look)) rebuild = true;
        if (id === state.currentId) updateGenInfo(look);
      }
    }
    if (rebuild || usesChanged) {
      if (state.mode === 'place' && state.placesById.has(state.placeId)) await selectPlace(state.placeId, { rebuild: true, aim: false });
      else await show(state.currentId);
    } else {
      if (state.mode === 'place') for (const id of changed) placeView.syncLook(id);
      else syncNow();
      renderInspector();
      renderPlacePanel();
      renderPlaces();
      refreshWordsSoon();
    }
    setStatus(`${to === hist.savedCur ? 'Back to what is saved' : 'Done'}: ${hist.undo.length} step${hist.undo.length === 1 ? '' : 's'} to undo, ${hist.redo.length} to redo`);
    statusTimer = setTimeout(() => setStatus(''), 2500);
  } finally {
    hist.busy = false;
    updateUndoButtons();
  }
}

// ---- Reset: each control back to its own start, else its look's default or preset, else as made ----

let DEFAULTS = null;
const defaultsCache = () => (DEFAULTS ||= allDefaults());
const presetLooks = new Map();
const presetLookOf = (presetId) => {
  if (!PRESETS[presetId]) return null;
  if (!presetLooks.has(presetId)) presetLooks.set(presetId, finishLook(makeLook(presetLook(presetId))));
  return presetLooks.get(presetId);
};
/** A look as it was made (a copy, a new generated look) or as the file had it: the last resort of a reset. */
function noteMade(id) {
  if (state.looks[id]) state.madeLooks[id] = JSON.parse(JSON.stringify(state.looks[id], noUnderscore));
}
const sameValue = (a, b) => {
  if (a === b) return true;
  if (a === undefined || a === null || b === undefined || b === null) return false;
  if (typeof a !== 'boolean' && typeof b !== 'boolean' && a !== '' && b !== '' && Number.isFinite(+a) && Number.isFinite(+b)) return Math.abs(+a - +b) < 1e-6;
  return String(a).toLowerCase() === String(b).toLowerCase();
};
/** Where a control resets to: { value, from } or null. `at` is where its object sits in the look. */
function resetValue(desc, at) {
  if (desc.reset !== undefined) return { value: desc.reset, from: desc.resetFrom || 'its start' };
  if (at === null || at === undefined) return null;
  const id = state.currentId;
  const look = state.looks[id];
  const path = at + desc.k;
  const def = defaultsCache()[id];
  let v = def ? getPath(def, path) : undefined;
  if (v !== undefined) return { value: v, from: 'the default' };
  if (look?.generated) {
    v = getPath(presetLookOf(look.generated.preset), path);
    if (v !== undefined) return { value: v, from: `the preset "${PRESETS[look.generated.preset].name}"` };
  }
  v = state.madeLooks[id] ? getPath(state.madeLooks[id], path) : undefined;
  if (v !== undefined) return { value: v, from: 'as the look was made' };
  return null;
}
const showValue = (v) => (v === '' ? '(none)' : typeof v === 'number' ? String(+v.toFixed(4)) : String(v));
/** The small button back to a value: dimmed while the control already holds it. */
function resetButton(rv, current, onReset) {
  const b = el('button', { type: 'button', class: 'small rs', title: `Reset to ${showValue(rv.value)} (${rv.from})`, 'aria-label': 'Reset' }, '↺');
  b.disabled = sameValue(current, rv.value);
  b.addEventListener('click', () => { onReset(rv.value); b.disabled = true; });
  return b;
}

// ---------------------------------------------------------------------------------------------
// start

async function init() {
  if (params.get('ui') === '0') document.body.classList.add('noui');
  setStatus('Starting the renderer');
  try {
    S = await createStage($('view'), { forceWebGL: params.get('renderer') === 'webgl' });
  } catch (e) {
    setStatus('The renderer could not start: ' + e.message, true);
    throw e;
  }
  setBakeRenderer(S.renderer);
  $('rendererLabel').textContent = S.backend === 'WebGPU' ? 'WebGPU' : 'WebGL 2 (no WebGPU here)';
  $('dot').className = 'dot ' + (S.backend === 'WebGPU' ? 'ok' : 'warn');
  S.scene.add(state.backdropHolder);

  setStatus('Reading the folder and the survey');
  const [tj, files, sky] = await Promise.all([
    getJSON('/survey/textures.json').catch((e) => { console.warn('[viewer] survey textures.json:', e.message); return null; }),
    getJSON('/api/files'),
    getText('/survey/skybodies.txt').catch((e) => { console.warn('[viewer] skybodies.txt:', e.message); return ''; }),
    loadLore(),
    loadMissing(),
  ]);
  if (tj) { setTextureInfo(tj); window.__textureJSON = tj; }
  state.files = files.files;
  state.folder = files.folder;
  state.skies = parseSkies(sky);
  await loadSaved();
  makePlaces();

  placeView = new PlaceView(S, $('marks'), (id) => selectPlace(id, { aim: false }));
  placeView.onView = () => updatePlaceBar();
  gameLook = new GameLook(S);
  placeView.gameLook = gameLook;
  wireWeather();
  wireStage();
  wireAddPicture();
  renderLibrary();
  renderPlaces();
  S.renderer.setAnimationLoop(frame);

  // (a look of his pictures, where they are not here, shown as its twin)
  const asked = state.looks[params.get('look')] ? params.get('look') : 'naboo';
  const first = wornLookId(asked) || asked;
  // (a preview is a system's id; a world's name is taken for its system)
  if (params.get('preview')) state.preview = draftSystem(params.get('preview')) || state.starSystems[params.get('preview')] ? params.get('preview') : systemIdOf(params.get('preview'));
  if (params.get('system')) {
    state.currentId = first;
    openSystemView(params.get('system'), params.get('stand'));
  } else if (params.get('place') && state.placesById.has(params.get('place'))) {
    state.currentId = first;
    await selectPlace(params.get('place'));
  } else {
    await show(first, { frame: true });
  }
  if (params.get('tab')) showTab(params.get('tab'));
  // (the GPU port's pass 2, wave 4) a frame handed over from the game on the address (`?match=<its JSON, URL-encoded>`)
  if (params.get('match')) console.log('[viewer] match on the address:', JSON.stringify(await holdMatch(params.get('match'))));
}

/** Every place of every sky and zone, the owner's extra ones, and any a saved file names that no sky lists. */
function makePlaces() {
  // the owner's own zones as skies of their own (none from SWG's files), then his places with the extras
  for (const [id, s] of [...state.skies]) if (s.added) state.skies.delete(id);
  for (const [id, z] of Object.entries(state.added?.zones || {})) if (!state.skies.has(id)) state.skies.set(id, addedSky(id, z.title));
  const own = state.added?.places || [];
  const places = buildPlaceList(state.skies, [...EXTRA_PLACES, ...own]);
  for (const p of places) if (own.some((q) => q.id === p.id)) p.added = true;
  const ids = new Set(places.map((p) => p.id));
  for (const id of [...Object.keys(state.uses), ...Object.keys(state.placeEdits)]) {
    if (!ids.has(id)) { places.push(unknownPlace(id)); ids.add(id); }
  }
  for (const p of places) p.shortLabel = shortLabel(p);
  state.places = places;
  state.placesById = new Map(places.map((p) => [p.id, p]));
}

function shortLabel(p) {
  if (p.space) return p.label.replace(/^[^:]*:\s*/, '');
  return p.label.replace(/^.*?(sky: )/, '').replace(/^.*?'s? /, '');
}

/**
 * The file of choices. Version 2 adds `places` (each place's own settings, only what differs from
 * SWG's) and `zones` (each space zone's sun, only what differs). A version 1 file has neither: its
 * looks and uses are kept and every place starts at SWG's values. `pictures` (the kind and the date
 * of each picture added from the page) may sit beside them in any version; a file without it loads
 * as it always did. Nothing of the lore is ever in it.
 */
/**
 * A look as makeLook gives it, with its generated part (if any) checked by generate.js: a generated
 * look is always a sphere, and its recipe, seed, dials and size are made whole and safe.
 */
function finishLook(look) {
  if (look.generated) {
    const g = cleanGenerated(look.generated);
    if (g) { look.generated = g; look.kind = 'sphere'; look.mesh = 'planet_01_mesh'; } else delete look.generated;
  }
  return look;
}

/** The defaults: the owner's looks (looks.js) and the generated test looks, one a preset. */
function allDefaults() {
  const out = defaultLooks();
  for (const id of PRESET_ORDER) out['generated:' + id] = finishLook(makeLook(presetLook(id)));
  // the placeholders of the lore's bodies (placeholders.js), each a generated look of recipe version 2
  for (const [id, part] of Object.entries(placeholderLooks({ presetLook, presetDials, PRESETS }))) out[id] = finishLook(makeLook(part));
  return out;
}
/**
 * (looks run 2) Whether the pictures a look is drawn from are here: its surface's picture and, for a body of
 * the imported folder's meshes, that mesh (the plain sphere is made by the page when its mesh is not there).
 * A generated look, or one that names no picture, always is.
 */
function picturesHere(look) {
  if (!look || look.generated) return true;
  const have = (name) => (state.files || []).some((f) => f.name === name);
  const tex = look.layers?.surface?.on !== false ? look.layers?.surface?.tex : '';
  if (tex && !have(tex)) return false;
  if (look.kind !== 'sheet' && look.mesh && look.mesh !== 'planet_01_mesh' && !have(look.mesh + '.fbx')) return false;
  return true;
}
/**
 * The look drawn for `lid`: itself while its pictures are here, else (a player without his imported pictures)
 * its generated twin (placeholders.js's twinOfLook), else null (it has none: the caller falls back further).
 */
function wornLookId(lid) {
  const look = state.looks[lid];
  if (!look || picturesHere(look)) return lid;
  const twin = twinOfLook(lid, look);
  return twin && state.looks[twin] ? twin : null;
}
/** A place's look: the owner's choice, else the placeholder of the lore body it stands for (null: none, or a drawn sun); each its twin where his pictures are not here. */
function placeLookId(pid) {
  const lid = state.uses[pid];
  if (lid && state.looks[lid]) { const w = wornLookId(lid); if (w) return w; }
  const ph = placeholderOfPlace(pid);
  return ph && state.looks[ph] ? wornLookId(ph) : null;
}
/** A system body with no look of its own (and no place): its placeholder, by its system, id, place or name; null for a star. */
function bodyPlaceholder(c, world, b, it) {
  if (it.star) return null;
  // (a group's member by its own name first, then as its group: the four moons of Adriana wear the group's)
  const tries = it.member ? [{ name: it.name, place: it.place }, { id: b.id, name: b.name }] : [{ id: b.id, name: b.name, place: it.place }];
  for (const body of tries) {
    const id = (c?.id && placeholderFor(c.id, body)) || placeholderFor(world, body);
    if (id && state.looks[id]) { const w = wornLookId(id); if (w) return w; }
  }
  return null;
}

async function loadSaved() {
  state.looks = allDefaults();
  state.uses = { ...DEFAULT_USES };
  state.placeEdits = {};
  state.zoneEdits = {};
  state.pictures = {};
  state.added = { zones: {}, places: [] };
  state.systems = {};
  state.starSystems = {};
  state.viewer = cleanViewer(null);
  state.preview = null;
  state.savedAt = null;
  state.loadedVersion = null;
  try {
    const r = await fetch('/space-bodies.json', { cache: 'no-store' });
    if (r.status === 200) {
      const saved = await r.json();
      // (a placeholder's copy unchanged from the table, this one's or an earlier one's, is not his: the
      // table's own stays, so a better placeholder later reaches it)
      const table = defaultsCache();
      for (const [id, l] of Object.entries(saved.looks || {})) {
        const made = finishLook(makeLook(l));
        if (isUntouchedDefault(id, made, table[id])) continue;
        state.looks[id] = made;
      }
      // A null saved before a default was added (DEFAULT_USES_SINCE) leaves that default in place.
      const savedAt = typeof saved.savedAt === 'string' ? saved.savedAt : '';
      for (const [k, v] of Object.entries(saved.uses || {})) {
        const since = DEFAULT_USES_SINCE[k];
        if (v == null && since && DEFAULT_USES[k] && savedAt < since) continue;
        state.uses[k] = v;
      }
      const version = +saved.version || 1;
      if (version >= 2) {
        state.placeEdits = cleanPlaceEdits(saved.places);
        state.zoneEdits = cleanZoneEdits(saved.zones);
      }
      state.pictures = cleanPictures(saved.pictures);
      state.added = cleanAdded(saved.added);
      state.systems = cleanSystems(saved.systems);
      state.starSystems = cleanStarSystems(saved.starSystems);
      state.viewer = cleanViewer(saved.viewer);
      state.loadedVersion = version;
      state.savedAt = saved.savedAt || 'earlier';
      console.log(`[viewer] loaded space-bodies.json version ${version}: ${Object.keys(saved.looks || {}).length} looks, ${Object.keys(saved.uses || {}).length} uses, ${Object.keys(state.placeEdits).length} places changed, ${Object.keys(state.zoneEdits).length} zone suns changed, ${Object.keys(state.pictures).length} added pictures`);
    }
  } catch (e) {
    setStatus('Could not read space-bodies.json: ' + e.message + ' (the defaults are shown)', true);
  }
  setAddedPictures(state.pictures);
  state.madeLooks = {};
  state.madeSystems = JSON.parse(JSON.stringify(state.systems));
  state.madeStar = JSON.parse(JSON.stringify(state.starSystems));
  const defs = defaultsCache();
  for (const id of Object.keys(state.looks)) if (!defs[id]) noteMade(id);
  noteSaved();
  if (gameLook) applyViewer();
  hist.applying = true; // loading is not a step
  setDirty(false);
  hist.applying = false;
  resetHistory();
}

/** The places' choices as the file now has them: what a place setting's reset goes back to. */
function noteSaved() {
  state.saved = JSON.parse(JSON.stringify({ uses: state.uses, placeEdits: state.placeEdits, zoneEdits: state.zoneEdits, systems: state.systems, starSystems: state.starSystems }));
}

/** lore.js, read once at start: missing or broken, the page simply shows no lore. */
async function loadLore() {
  try {
    const mod = await import('../src/sky/look/lore.js');
    state.lore = cleanLore(mod.LORE);
    if (state.lore) console.log(`[viewer] lore: ${state.lore.bodies.size} bodies, ${state.lore.systems.size} systems${state.lore.sample ? ' (a sample file)' : ''}`);
    else console.warn('[viewer] lore: lore.js has no LORE with bodies, so no lore is shown');
  } catch (e) {
    state.lore = null;
    console.log(`[viewer] lore: none shown (lore.js could not be read: ${e.message})`);
  }
}

async function save() {
  const out = { version: FILE_VERSION, savedAt: new Date().toISOString(), looks: {}, uses: {}, places: {}, zones: {}, pictures: {} };
  const table = defaultsCache();
  for (const [id, l] of Object.entries(state.looks)) {
    // a placeholder he has not touched stays a default, so it is not written (one he edits is his)
    if (isUntouchedDefault(id, l, table[id])) continue;
    out.looks[id] = { name: l.name, group: l.group, note: l.note, kind: l.kind, mesh: l.mesh, layers: l.layers, adjust: l.adjust };
    // a generated look: its recipe, seed, dials and size (the textures are made again on load)
    if (l.generated) out.looks[id].generated = l.generated;
    // (wave A) its air, only when it has one (a look without it is written exactly as before)
    if (l.air) out.looks[id].air = l.air;
  }
  for (const p of state.places) out.uses[p.id] = state.uses[p.id] ?? null;
  for (const [k, v] of Object.entries(state.uses)) if (!(k in out.uses)) out.uses[k] = v ?? null;
  out.places = cleanPlaceEdits(state.placeEdits);
  out.zones = cleanZoneEdits(state.zoneEdits);
  out.pictures = cleanPictures(state.pictures);
  // the owner's own zones and places, only when there are any (a file without them is as it was)
  const added = cleanAdded(state.added);
  if (Object.keys(added.zones).length || added.places.length) out.added = added;
  // the owner's systems, only when there are any (a file without them is as it was)
  const systems = cleanSystems(state.systems);
  // one made by a newer viewer goes back as it came (its `future` mark is this page's, not the file's)
  for (const e of Object.values(systems)) if (e.system?.future) delete e.system.future;
  if (Object.keys(systems).length) out.systems = systems;
  // his systems of version 2 (one per star), only when there are any
  const stars = cleanStarSystems(state.starSystems);
  for (const e of Object.values(stars)) if (e.system?.future) delete e.system.future;
  if (Object.keys(stars).length) out.starSystems = stars;
  // the viewer's own switches, only when one is not at its start (a file without them is as it was)
  const vw = cleanViewer(state.viewer);
  // (wave A: the air's choice for all is a comparison of the moment, never written; its quality is, off its start)
  delete vw.airAll;
  if (vw.airQuality === VIEWER_DEFAULTS.airQuality) delete vw.airQuality; // (so a file's viewer block is written as before)
  // (wave B) the day wash's settings likewise, each only off its start
  for (const k of ['wash', ...WASH_DIALS.map(([key]) => key)]) if (vw[k] === VIEWER_DEFAULTS[k]) delete vw[k];
  if (Object.keys(vw).some((k) => vw[k] !== VIEWER_DEFAULTS[k])) out.viewer = vw;
  try {
    const r = await fetch('/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out) });
    if (!r.ok) throw new Error(await r.text());
    const res = await r.json();
    state.savedAt = res.at;
    if (hist.timer) checkpoint();
    hist.savedCur = hist.cur;
    noteSaved();
    setDirty(false);
    updateUndoButtons();
    renderPlacePanel();
    const np = Object.keys(out.pictures).length;
    const ns = Object.keys(out.systems || {}).length + Object.keys(out.starSystems || {}).length;
    setStatus(`Saved ${Object.keys(out.looks).length} looks, ${Object.keys(out.uses).length} places, ${Object.keys(out.places).length} places' own settings${ns ? `, ${ns} world system${ns > 1 ? 's' : ''}` : ''} and ${Object.keys(out.zones).length} zone suns${np ? `, and the kinds of ${np} added picture${np > 1 ? 's' : ''}` : ''}`);
    statusTimer = setTimeout(() => setStatus(''), 3500);
  } catch (e) {
    setStatus('Save failed: ' + e.message, true);
  }
}

// ---------------------------------------------------------------------------------------------
// the stage

function wireStage() {
  const outs = [['az', 'azOut', '°'], ['el', 'elOut', '°'], ['phase', 'phOut', '°'], ['sunPower', 'spOut', '']];
  for (const [id, o, unit] of outs) {
    const inp = $(id);
    if (params.has(id)) inp.value = params.get(id);
    const upd = () => { $(o).textContent = (+inp.value).toFixed(id === 'sunPower' ? 2 : 0) + unit; };
    inp.addEventListener('input', upd);
    upd();
  }
  if (params.get('stars') === '0') $('stars').checked = false;
  if (params.get('spin') === '0') $('autospin').checked = false;
  S.stars.visible = $('stars').checked;
  $('stars').addEventListener('change', () => { S.stars.visible = $('stars').checked; });
  $('frame').addEventListener('click', frameCurrent);
  $('save').addEventListener('click', save);
  // (the GPU port's pass 2, wave 4) Save to game: the game's own bodies file, numbers only (saveToGame)
  $('saveGame')?.addEventListener('click', () => saveToGame());
  $('reload').addEventListener('click', async () => {
    if (state.dirty && !confirm('Drop the unsaved changes and load space-bodies.json again?')) return;
    await refreshFiles();
    await loadSaved();
    makePlaces();
    renderLibrary();
    renderPlaces();
    if (state.mode === 'place' && state.placesById.has(state.placeId)) await selectPlace(state.placeId, { rebuild: true });
    else await show(state.looks[state.currentId] ? state.currentId : 'naboo');
  });
  $('search').addEventListener('input', renderLibrary);
  for (const b of document.querySelectorAll('.tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab));
  $('newGen').addEventListener('click', newGeneratedLook);
  $('compare').addEventListener('change', () => {
    state.compareId = $('compare').value || null;
    if (state.mode === 'look') show(state.currentId, { frame: true });
  });
  $('matchLight').addEventListener('click', matchCompareLight);

  // the place views' bar: the hour (and play), the field of view, and the way back to the preview
  const time = $('time');
  time.value = state.hours;
  // (under a star system: the hour of the world's own day, the real moment moved within that day)
  time.addEventListener('input', () => { setHourOfWorld(+time.value); updatePlaceBar(); refreshWordsSoon(); });
  $('play').addEventListener('click', () => { state.playing = !state.playing; updatePlaceBar(); });
  $('speed').addEventListener('change', () => { state.speed = +$('speed').value; });
  $('fov').addEventListener('input', () => { placeView.view.fov = +$('fov').value; updatePlaceBar(); });
  $('backToLook').addEventListener('click', () => show(state.currentId && state.looks[state.currentId] ? state.currentId : 'naboo', { frame: true }));
  wireSystemStage();

  $('undo').addEventListener('click', undo);
  $('redo').addEventListener('click', redo);
  addEventListener('keydown', (e) => {
    // Ctrl+Z undo, Ctrl+Shift+Z or Ctrl+Y redo (a text box keeps its own undo of what is typed in it)
    if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[zy]$/i.test(e.key)) {
      const t = e.target;
      const typing = t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && /^(text|number|search)$/.test(t.type));
      if (typing || $('addDialog').open) return;
      e.preventDefault();
      if (e.key.toLowerCase() === 'y' || e.shiftKey) redo(); else undo();
      return;
    }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === 'f' || e.key === 'F') frameCurrent();
  });
  addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });
}

function showTab(tab) {
  if (!['look', 'place', 'places', 'system'].includes(tab)) return;
  for (const x of document.querySelectorAll('.tabs button')) x.setAttribute('aria-selected', x.dataset.tab === tab ? 'true' : 'false');
  $('lookPanel').hidden = tab !== 'look';
  $('placePanel').hidden = tab !== 'place';
  $('placesPanel').hidden = tab !== 'places';
  $('systemPanel').hidden = tab !== 'system';
  state.tab = tab;
  if (tab === 'system') renderSystemPanel();
}

function frameCurrent() {
  if (state.mode === 'system') { orrery.view.zoom = 1; orrery.view.yaw = -30; orrery.view.tilt = 58; return; }
  if (state.mode === 'place') { placeView.aim(); return; }
  if (!state.current) return;
  const s = +state.current.look.adjust.size || 1;
  if (state.compare) { frameCamera(S, compareGap() + Math.max(state.current.radius, state.compare.radius) * s); return; }
  frameCamera(S, state.current.radius * s);
}

// ---- Compare: another look beside the previewed one, at the same size, under the same sun ----

const compareGap = () => 1.15 * (+state.current?.look.adjust.size || 1) * Math.max(1.05, state.current?.radius || 1, state.compare?.radius || 1);

function layoutCompare() {
  const cur = state.current, c = state.compare;
  if (!cur) return;
  if (!c) { cur.root.position.set(0, 0, 0); return; }
  const g = compareGap();
  cur.root.position.set(-g, 0, 0);
  c.root.position.set(g, 0, 0);
  c.placeScale = +cur.look.adjust.size || 1;
  syncLook(c);
}

/** The compared look's painted light (a dome's), made the stage's sun, so both are lit alike. */
function matchCompareLight() {
  const c = state.compare;
  if (!c || c.look.kind !== 'dome') return;
  const A = c.look.adjust;
  const a = ((+A.lightAngle || 0) * Math.PI) / 180, e = ((+A.lightElev || 0) * Math.PI) / 180;
  const v = new THREE.Vector3(Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e)).transformDirection(S.camera.matrixWorld);
  const set = (id, val) => { const i = $(id); i.value = Math.round(val); i.dispatchEvent(new Event('input', { bubbles: true })); };
  set('phase', 0);
  set('el', (Math.asin(Math.max(-1, Math.min(1, v.y))) * 180) / Math.PI);
  set('az', (Math.atan2(v.x, v.z) * 180) / Math.PI);
}

function renderCompareSelect() {
  const sel = $('compare');
  const keep = state.compareId || '';
  sel.textContent = '';
  sel.append(el('option', { value: '', text: '(nothing)' }));
  const groups = new Map();
  for (const [id, l] of Object.entries(state.looks)) {
    const g = GROUPS.includes(l.group) ? l.group : 'Your own';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push([id, l.name]);
  }
  for (const g of GROUPS) {
    if (!groups.has(g)) continue;
    const og = el('optgroup', { label: g });
    for (const [id, name] of groups.get(g)) og.append(el('option', { value: id, text: name }));
    sel.append(og);
  }
  sel.value = state.looks[keep] ? keep : '';
  const look = state.looks[state.currentId];
  const near = look?.generated ? PRESETS[look.generated.preset]?.compare : null;
  $('compareHint').textContent = near && state.looks[near] && keep !== near ? `closest picture: ${state.looks[near].name}` : '';
  $('compareHint').onclick = near ? () => { sel.value = near; sel.dispatchEvent(new Event('change')); } : null;
  $('matchLight').hidden = !(state.compare && state.compare.look.kind === 'dome');
}

/** The bar under the stage, and the title over it, for the view in use. */
function updatePlaceBar() {
  const place = state.mode === 'place' ? state.placesById.get(state.placeId) : null;
  const sys = state.mode === 'system';
  $('sunbar').hidden = !!place || sys;
  $('placebar').hidden = !place;
  $('systembar').hidden = !sys;
  $('compareLine').hidden = !!place || sys;
  $('previewNote').hidden = !!place || sys;
  document.querySelector('.stage-buttons').hidden = sys;
  if (sys) { updateSystemBar(); return; }
  if (place) {
    const ground = !place.space;
    for (const n of document.querySelectorAll('.ground-only')) n.hidden = !ground;
    const follows = ground && skyFollows(place.zone);
    for (const n of document.querySelectorAll('.sys-only')) n.hidden = !follows;
    if (follows) { $('day').value = state.day; $('dayOut').textContent = String(state.day); }
    // the first round's day slider for a one-world sky; the real date and "now" under a star system
    updateClockBar(ground ? place.zone : null);
    if (ground) renderSkyRule(place.zone);
    $('timeOut').textContent = clockText(state.hours);
    if (+$('time').value !== state.hours) $('time').value = state.hours;
    $('play').textContent = state.playing ? 'Pause' : 'Play';
    $('play').setAttribute('aria-pressed', state.playing ? 'true' : 'false');
    $('fov').value = placeView.view.fov;
    $('fovOut').textContent = Math.round(placeView.view.fov) + '°';
    $('lookGroup').textContent = place.space ? `In orbit · ${state.skies.get(place.zone)?.title || worldName(place.zone)}` : `From the ground · ${worldName(place.zone)}`;
    $('lookName').textContent = place.label;
    $('hint').textContent = 'Drag to look round · wheel to narrow or widen the view · click a body to choose its place · F turns to the chosen one.';
  } else {
    const look = state.looks[state.currentId];
    $('lookGroup').textContent = look ? `${look.group} · preview` : ' ';
    $('lookName').textContent = look ? look.name : 'Choose a look';
    $('hint').textContent = 'A look close up. Drag to orbit · right-drag to pan · wheel to zoom · F frames. Spheres are lit by this stage\'s sun; domes carry their light painted in.';
  }
}

const sun = new THREE.Vector3();
function sunVector(az, elv, v) {
  const a = (az * Math.PI) / 180, e = (elv * Math.PI) / 180;
  return v.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
}

function tick(b, stageSun = false) {
  const A = b.look.adjust;
  const own = !stageSun && b.look.kind === 'sphere' && A.ownSun?.on;
  const az = (own ? +A.ownSun.az : +$('az').value) + +$('phase').value;
  const elv = own ? +A.ownSun.el : +$('el').value;
  sunVector(az, elv, sun);
  b.LU.sunPower.value = +$('sunPower').value;
  updateLook(b, { camera: S.camera, clock: state.clock, sunWorld: sun });
}

let last = performance.now();
let wordsClock = 0;
/** Wave 5: whether a space volume is drawn now (the place view's bodies, or the stage's looks). */
function volumesShown() {
  if (state.mode === 'system') return false;
  if (state.mode === 'place') {
    // (a plain loop: this runs every frame, and a frame makes nothing)
    const B = placeView?.bodies;
    if (B) for (let i = 0; i < B.length; i++) if (B[i].built?.vol && B[i].built.root.visible) return true;
    return false;
  }
  return !!(state.current?.vol || state.compare?.vol || state.backdrop?.vol);
}
let shownTierChange = -1;
/** The quality's words beside its dial: the tier drawn now (auto's choice). */
function showVolumeTier() {
  const q = volumeQualityState();
  shownTierChange = q.changed;
  const o = $('volTier');
  if (!o) return;
  o.textContent = q.mode === 'auto' ? `now ${q.tier}` : '';
  o.title = `${VOLUME_TIERS[q.tier].words}${q.mode === 'auto' ? ' (auto: steps down when frames take over 24 ms, back up when they take under 18 ms)' : ''}`;
}
const autospinBox = { el: null };
function frame() {
  const now = performance.now();
  const dt = Math.min(0.1, (now - last) / 1000);
  // wave 5: the frame's time for the space volumes' automatic quality (only while one is on show)
  volumeFrame(now - last, volumesShown());
  if (volumeQualityChanges() !== shownTierChange) showVolumeTier();
  last = now;
  const spinning = (autospinBox.el ||= $('autospin')).checked;
  if (spinning) { state.clock += dt; state.weatherT += dt; }
  // wave 4: the clouds' motion stands still with the spin; the lightning always runs
  setWeatherTime(state.weatherT, now / 1000);
  if (state.mode === 'system') {
    // the System view: the orrery on its own canvas, and nothing for the GPU to draw
    if (state.playing) advanceSystemClock(dt);
    drawSystem();
    state.frames++;
    if (state.readyAt && state.frames >= state.readyAt) {
      state.readyAt = 0;
      window.__viewerReady = { system: state.sysWorld, backend: S.backend, errors: [] };
      document.documentElement.dataset.ready = 'system ' + state.sysWorld;
    }
    return;
  }
  if (state.mode === 'place' && placeView.active) {
    // (the hours run SWG's clock, or under a star system the world's own day on the real clock)
    if (state.playing) advancePlaceClock(dt);
    placeView.frame(state.clock, now / 1000);
    // the words' "now" line follows the hour and the camera (and a live clock its hour and date)
    wordsClock += dt;
    if (wordsClock > 0.4) { wordsClock = 0; if (state.live && !state.playing) tickLiveClock(); refreshNowLine(); }
  } else {
    S.controls.update();
    if (state.current) tick(state.current, !!state.compare);
    if (state.backdrop) tick(state.backdrop);
    if (state.compare) tick(state.compare, true);
    // wave 4: drawn as the game does, the preview is a space zone in plain light
    if (gameLook.on) { stageSource(gameLook.source); gameLook.setGrade('', 'stage (a space zone in plain light)'); }
  }
  gameLook.render();
  state.frames++;
  if (state.readyAt && state.frames >= state.readyAt) {
    state.readyAt = 0;
    const what = state.mode === 'place' ? 'place ' + state.placeId : state.currentId;
    window.__viewerReady = { look: state.currentId, place: state.mode === 'place' ? state.placeId : null, backend: S.backend, errors: state.lastErrors || [] };
    document.documentElement.dataset.ready = what;
    console.log(`[viewer] ready: ${what} on ${S.backend}${state.lastErrors?.length ? ' with errors: ' + state.lastErrors.join('; ') : ''}`);
  }
}

function placeBackdrop() {
  const o = state.current?.look.adjust.over;
  if (!o) return;
  state.backdropHolder.position.set(+o.x || 0, +o.y || 0, +o.z || 0);
  state.backdropHolder.scale.setScalar(+o.size || 1);
}

/** The preview: a look close up on the dark stage, lit by the stage's own sun (not saved). */
async function show(id, { frame: doFrame = false } = {}) {
  // (looks run 2) a look of his pictures, where they are not here (a player without his imports), is shown as its twin
  const worn = wornLookId(id);
  if (worn && worn !== id) { console.info(`[viewer] ${id}: its pictures are not in the imported folder, so its twin ${worn} is shown`); id = worn; }
  const look = state.looks[id];
  if (!look) return;
  const token = ++state.build;
  const changed = state.currentId !== id;
  if (state.mode === 'system') leaveSystemView('look');
  const wasPlace = state.mode === 'place';
  state.currentId = id;
  if (changed) state.pick = null;
  if (wasPlace) {
    state.mode = 'look';
    state.playing = false;
    placeView.close();
    if (state.current) state.current.root.visible = true;
    state.backdropHolder.visible = true;
    S.stars.visible = $('stars').checked;
    showTab('look');
  }
  window.__viewerReady = null;
  delete document.documentElement.dataset.ready;
  updatePlaceBar();
  markLibrary();
  renderInspector();
  renderPlacePanel();
  setStatus('Building ' + look.name);
  look._errors = [];
  let built = null, back = null, cmp = null;
  try {
    built = await buildLook(look, { onStatus: (m) => token === state.build && setStatus(m) });
    const o = look.adjust.over;
    if (o?.look && o.look !== id && state.looks[o.look]) {
      state.looks[o.look]._errors = [];
      back = await buildLook(state.looks[o.look], { onStatus: (m) => token === state.build && setStatus(m) });
    }
    const cid = state.compareId;
    if (cid && cid !== id && state.looks[cid]) {
      state.looks[cid]._errors = [];
      cmp = await buildLook(state.looks[cid], { onStatus: (m) => token === state.build && setStatus(m) });
    }
  } catch (e) {
    console.error(e);
    if (token === state.build) setStatus(`Could not build ${look.name}: ${e.message}`, true);
    disposeLook(built);
    disposeLook(back);
    return;
  }
  if (token !== state.build || state.mode !== 'look') { disposeLook(built); disposeLook(back); disposeLook(cmp); return; }
  disposeLook(state.current);
  disposeLook(state.backdrop);
  disposeLook(state.compare);
  state.current = built;
  state.backdrop = back;
  state.compare = cmp;
  S.scene.add(built.root);
  if (back) { state.backdropHolder.add(back.root); placeBackdrop(); }
  if (cmp) S.scene.add(cmp.root);
  layoutCompare();
  renderCompareSelect();
  releaseTextures(new Set([...built.keep, ...(back ? back.keep : []), ...(cmp ? cmp.keep : [])]));
  if (doFrame || wasPlace) frameCurrent();
  tick(built, !!cmp);
  if (back) tick(back);
  if (cmp) tick(cmp, true);
  if (look.generated) updateGenInfo(look);
  try { await S.renderer.compileAsync(S.scene, S.camera); } catch (e) { console.warn('[viewer] compile:', e); }
  if (token !== state.build) return;
  renderInspector();
  const errs = [...(look._errors || []), ...(back ? state.looks[look.adjust.over.look]._errors || [] : []), ...(cmp ? cmp.look._errors || [] : [])];
  state.lastErrors = errs;
  if (errs.length) setStatus('Missing: ' + errs.join(' · '), true);
  else setStatus('');
  state.readyAt = state.frames + 4;
}

let rebuildTimer = 0;
function rebuildSoon() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => {
    if (state.mode === 'place') { if (placeView.usesLook(state.currentId)) selectPlace(state.placeId, { rebuild: true, aim: false }); }
    else show(state.currentId);
  }, 80);
}

function syncNow() {
  if (state.mode === 'place') { placeView.syncLook(state.currentId); return; }
  if (state.current) syncLook(state.current);
  placeBackdrop();
}

// ---------------------------------------------------------------------------------------------
// the library

function lookMatches(id, l, q) {
  if (!q) return true;
  const hay = [id, l.name, l.group, l.mesh, l.note, ...SLOTS.map((s) => (l.layers[s].on ? l.layers[s].tex : ''))].join(' ').toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

function renderLibrary() {
  const q = $('search').value.trim().toLowerCase();
  const lib = $('lib');
  lib.textContent = '';
  const used = new Set(Object.values(state.uses).filter(Boolean));
  const groups = new Map(GROUPS.map((g) => [g, []]));
  for (const [id, l] of Object.entries(state.looks)) {
    const g = groups.has(l.group) ? l.group : 'Your own';
    if (lookMatches(id, l, q)) groups.get(g).push([id, l]);
  }
  let total = 0;
  for (const [g, list] of groups) {
    if (!list.length) continue;
    total += list.length;
    const det = el('details', { open: q || !state.closedGroups.has(g) });
    det.addEventListener('toggle', () => { if (!q) det.open ? state.closedGroups.delete(g) : state.closedGroups.add(g); });
    det.append(el('summary', {}, el('span', { text: g }), el('span', { class: 'n', text: String(list.length) })));
    for (const [id, l] of list) {
      det.append(el('button', {
        type: 'button', class: 'entry' + (id === state.currentId ? ' current' : '') + (used.has(id) ? ' used' : ''), 'data-id': id,
        title: (used.has(id) ? 'Used by a place. ' : '') + (l.note || ''), onclick: () => show(id, { frame: true }),
      }, el('span', { class: 'name', text: l.name }), el('span', { class: 'kind', text: l.generated ? 'generated' : l.kind })));
    }
    lib.append(det);
  }
  $('count').textContent = `${total} of ${Object.keys(state.looks).length}`;
  renderCompareSelect();
}

/** A new generated look of the owner's own, from the preset of the generated look on show, else the desert's (any preset is one choice away). */
function newGeneratedLook() {
  let n = 1;
  while (state.looks['my-gen-' + n]) n++;
  const id = 'my-gen-' + n;
  const from = state.looks[state.currentId]?.generated?.preset || 'tatooine';
  state.looks[id] = finishLook(makeLook(presetLook(from, { name: `Generated planet ${n}`, group: 'Your own' })));
  noteMade(id);
  setDirty(true);
  renderLibrary();
  renderPlaces();
  show(id, { frame: true });
}

function markLibrary() {
  for (const b of document.querySelectorAll('.entry')) b.classList.toggle('current', b.dataset.id === state.currentId);
}

// ---------------------------------------------------------------------------------------------
// controls

/** A picture the owner added from the page (or gave a kind to): the survey never saw it. */
const isAdded = (name) => !!texInfo(name)?.addedByOwner;

function textureSelect(value, onPick) {
  const sel = el('select');
  sel.append(el('option', { value: '', text: '(none)' }));
  const order = KIND_ORDER;
  const byKind = new Map();
  for (const f of state.files) {
    if (!PICTURE_EXT.test(f.name)) continue;
    const k = texInfo(f.name)?.kind || 'unsorted';
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k).push(f.name);
  }
  const kinds = [...byKind.keys()].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  for (const k of kinds) {
    const og = el('optgroup', { label: k });
    for (const n of byKind.get(k)) og.append(el('option', { value: n, text: n.replace(/\.png$/, '') + (isAdded(n) ? '  (added)' : '') }));
    sel.append(og);
  }
  if (value && ![...sel.options].some((o) => o.value === value)) sel.append(el('option', { value, text: value + ' (not in the folder)' }));
  sel.value = value || '';
  sel.addEventListener('change', () => onPick(sel.value));
  return sel;
}

// One control row. desc: { k, label, type, min, max, step, options, struct, title, unit, pick, reset }
// `at` is where obj sits in the look ('', 'layers.surface.', 'generated.dials.' ...): a slider, colour or
// choice gets a small reset button, back to desc.reset, else the look's default or preset there, else
// the value the look had when it was made (resetValue).
function control(desc, obj, slot, at = null) {
  // (a setting a look has never had shows the value it is drawn with: `unset`, where a control gives one)
  const v = getPath(obj, desc.k) ?? desc.unset;
  const rv = desc.type === 'check' || desc.type === 'text' ? null : resetValue(desc, at);
  let rs = null, showIt = null;
  const commit = (val) => {
    setPath(obj, desc.k, val);
    setDirty(true);
    if (rs) rs.disabled = sameValue(val, rv.value);
    if (desc.after) desc.after(val);
    if (desc.struct) { rebuildSoon(); if (desc.rerender !== false) renderInspectorSoon(); } else syncNow();
  };
  const row = (...kids) => {
    if (rv && showIt) rs = resetButton(rv, v, (val) => { showIt(val); commit(val); });
    return el('div', { class: 'ctl', title: desc.title }, ...kids, rs || el('span'));
  };
  if (desc.type === 'check') {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = !!v;
    cb.addEventListener('change', () => commit(cb.checked));
    return el('div', { class: 'ctl check', title: desc.title }, el('label', {}, cb, desc.label));
  }
  const label = el('span', { text: desc.label, title: desc.title || desc.label });
  let input, out = el('output');
  if (desc.type === 'range') {
    input = el('input', { type: 'range', min: desc.min, max: desc.max, step: desc.step });
    input.value = v ?? desc.min;
    out.textContent = fmt(v, desc.step) + (desc.unit || '');
    input.addEventListener('input', () => { out.textContent = fmt(input.value, desc.step) + (desc.unit || ''); commit(+input.value); });
    showIt = (val) => { input.value = val; out.textContent = fmt(val, desc.step) + (desc.unit || ''); };
    // a double-click resets as the button beside it does
    input.addEventListener('dblclick', () => { if (rv) { showIt(rv.value); commit(rv.value); } });
  } else if (desc.type === 'color') {
    // The colour box keeps its own name: `input` is reused below for the row's layout, and a
    // listener that read `input.value` would read the row's div (undefined) once that happens.
    const picker = el('input', { type: 'color' });
    picker.value = v || '#ffffff';
    const code = el('code', { text: picker.value });
    showIt = (val) => { picker.value = val; code.textContent = picker.value; };
    picker.addEventListener('input', () => { code.textContent = picker.value; commit(picker.value); });
    const line = el('div', { class: 'colorline' }, picker, code);
    if (desc.pick) {
      const armed = state.pick === slot;
      line.append(el('button', {
        type: 'button', class: 'small' + (armed ? ' armed' : ''), title: 'Then click a point of the picture beside this layer',
        onclick: () => { state.pick = state.pick === slot ? null : slot; renderInspector(); },
      }, armed ? 'Click the picture' : 'Pick'));
      if ('EyeDropper' in window) {
        line.append(el('button', {
          type: 'button', class: 'small', title: 'Pick any colour on the screen',
          onclick: async () => { try { const r = await new window.EyeDropper().open(); picker.value = r.sRGBHex; code.textContent = r.sRGBHex; commit(r.sRGBHex); } catch { /* cancelled */ } },
        }, 'Screen'));
      }
    }
    input = line;
    out = el('span');
  } else if (desc.type === 'select') {
    input = el('select');
    for (const [val, text] of desc.options) input.append(el('option', { value: val, text }));
    input.value = v ?? '';
    input.addEventListener('change', () => commit(input.value));
    showIt = (val) => { input.value = val ?? ''; };
  } else if (desc.type === 'text') {
    input = el('input', { type: 'text', value: v ?? '' });
    input.addEventListener('change', () => { commit(input.value); if (desc.k === 'name') { $('lookName').textContent = input.value; renderLibrary(); } });
  } else if (desc.type === 'texture') {
    input = textureSelect(v, (val) => commit(val));
    showIt = (val) => { input.value = val ?? ''; };
  }
  return row(label, input, out);
}

let inspectorTimer = 0;
function renderInspectorSoon() {
  clearTimeout(inspectorTimer);
  inspectorTimer = setTimeout(renderInspector, 30);
}

const ALPHA = [['texture', 'its alpha'], ['none', 'none (opaque)'], ['luma', 'its brightness'], ['r', 'red'], ['g', 'green'], ['b', 'blue']];
const colourBlock = (opacityLabel = 'Opacity', max = 1) => [
  { k: 'opacity', label: opacityLabel, type: 'range', min: 0, max, step: 0.01, reset: 1 },
  { k: 'tint', label: 'Tint', type: 'color' },
  { k: 'hue', label: 'Hue shift', type: 'range', min: -180, max: 180, step: 1, unit: '°', reset: 0 },
  { k: 'sat', label: 'Saturation', type: 'range', min: 0, max: 2.5, step: 0.01, reset: 1 },
  { k: 'bright', label: 'Brightness', type: 'range', min: 0, max: 3, step: 0.01, reset: 1 },
  { k: 'contrast', label: 'Contrast', type: 'range', min: 0, max: 3, step: 0.01, reset: 1 },
];
const replaceBlock = [
  { k: 'replace.on', label: 'Replace a colour', type: 'check' },
  { k: 'replace.from', label: 'This colour', type: 'color', pick: true, title: 'The colour on the picture to replace: Pick, then click the picture beside this layer' },
  { k: 'replace.to', label: 'Becomes', type: 'color' },
  { k: 'replace.range', label: 'Range', type: 'range', min: 0, max: 1, step: 0.005, title: 'How far a colour may be from it and still be replaced fully' },
  { k: 'replace.soft', label: 'Softness', type: 'range', min: 0.001, max: 0.5, step: 0.001, title: 'How gently the replacement fades out beyond the range' },
  { k: 'replace.keep', label: 'Keep the picture\'s detail (shift the colour rather than paint over it)', type: 'check' },
];
const pictureBlock = ({ alpha = true, repeat = true, zoom = true, mask = true } = {}) => [
  ...(alpha ? [
    { k: 'alpha', label: 'Alpha from', type: 'select', options: ALPHA, struct: true },
    { k: 'alphaFloor', label: 'Alpha floor', type: 'range', min: 0, max: 0.5, step: 0.005, title: 'Alpha below this counts as none: clears junk outside a disc', reset: 0 },
  ] : []),
  ...(mask ? [{ k: 'mask', label: 'Disc mask', type: 'range', min: 0, max: 0.55, step: 0.001, title: 'A soft disc cut at this UV radius (0 = off)', reset: 0 }] : []),
  ...(zoom ? [{ k: 'zoom', label: 'Zoom picture', type: 'range', min: 0.5, max: 1.6, step: 0.005, title: 'Scales the picture about its centre: below 1 enlarges it', reset: 1 }] : []),
  ...(repeat ? [
    { k: 'repeat.0', label: 'Repeat across', type: 'range', min: 1, max: 16, step: 1, reset: 1 },
    { k: 'repeat.1', label: 'Repeat down', type: 'range', min: 1, max: 16, step: 1, reset: 1 },
  ] : []),
  { k: 'flipV', label: 'Flip vertically', type: 'check' },
];

// A generated look's layers: their pictures are baked, so only what works over a baked texture is
// offered (no texture, channel, repeat or zoom).
function generatedLayerControls(slot) {
  const main = [], subs = [];
  if (slot === 'surface') {
    main.push({ k: 'lit', label: 'Takes light', type: 'check' }, ...colourBlock());
    subs.push(['Colour replace', replaceBlock]);
  } else if (slot === 'normal') {
    main.push({ k: 'opacity', label: 'Relief strength', type: 'range', min: 0, max: 3, step: 0.01, reset: 1, title: 'How strongly the baked relief shades the surface: 0 flat, 1 as made, above 1 exaggerated' });
  } else if (slot === 'specular') {
    main.push({ k: 'opacity', label: 'Strength', type: 'range', min: 0, max: 3, step: 0.01, reset: 0.5 },
      { k: 'shine', label: 'Shininess', type: 'range', min: 2, max: 200, step: 1, reset: 60 },
      { k: 'tint', label: 'Colour', type: 'color' });
  } else if (slot === 'night') {
    main.push({ k: 'where', label: 'Shown', type: 'select', options: [['always', 'everywhere (it glows by day too)'], ['night', 'on the night side only']], struct: true },
      ...colourBlock('Strength', 4));
  } else if (slot === 'clouds') {
    main.push({ k: 'spin', label: 'Spin (x the body)', type: 'range', min: -3, max: 3, step: 0.05, reset: 1.15 },
      { k: 'height', label: 'Shell height', type: 'range', min: 1, max: 1.06, step: 0.0005, reset: 1.002 },
      { k: 'lit', label: 'Lit', type: 'check' },
      ...colourBlock());
    subs.push(['Cover', [{ k: 'alphaFloor', label: 'Cover floor', type: 'range', min: 0, max: 0.5, step: 0.005, reset: 0, title: 'Thin cloud below this is cleared' }]], ...weatherSubs());
  }
  return { main, subs };
}

// Wave 4: the weather of any look with clouds (its dials are live; the two ticks build the clouds again).
const unsetIsReset = (d) => (d.reset !== undefined ? { ...d, unset: d.reset } : d);
const weatherSubs = () => [['Storms and lightning', STORM_DIALS.map(unsetIsReset)], ['Motion', MOTION_DIALS.map(unsetIsReset)]];

const GEN_NOTES = {
  surface: 'Baked from the recipe (the dials above). These controls work over it, live, without a bake.',
  normal: 'The relief baked from the recipe\'s heights, lit by the sun: it shows best near the terminator.',
  specular: 'The sun\'s glint on water (and a little on ice or glassy lava), from the recipe\'s own mask.',
  night: 'The recipe\'s glow: molten rock (this layer\'s colour, shown as "Shown" says) or city lights (their colours are the Cities dials; on the night side only). A world with both keeps each its own: the lava glows by day and night, the cities by night.',
  clouds: 'The generated cloud layer on the cloud shell (its cover, size, swirl and storms are the Clouds dials above).',
};

function layerControls(slot, look) {
  if (look.generated && GEN_NOTES[slot]) return generatedLayerControls(slot);
  const dome = look.kind === 'dome';
  const L = look.layers[slot];
  const tex = { k: 'tex', label: 'Texture', type: 'texture', struct: true };
  const main = [], subs = [];
  if (slot === 'surface') {
    main.push(tex);
    if (dome && MESHES[look.mesh]?.uv !== 'latlong') main.push({ k: 'uv', label: 'UV', type: 'select', options: [['mesh', 'the mesh\'s (a circle picture)'], ['latlong', 'lat-long, computed (a sphere map)']], struct: true });
    if (look.kind !== 'sheet') main.push({ k: 'lit', label: dome ? 'Takes light (for pictures with no light painted in)' : 'Takes light', type: 'check', title: dome
      ? 'Ticked, the surface is shaded by a light; unticked, it shows as painted. Which light: in the close-up preview, this look\'s painted-light angle (Adjust); at a place, that place\'s own light (Place tab: the world\'s moving sun, the zone\'s sun, a fixed angle, or "painted in", which is this look\'s painted-light angle).'
      : 'Ticked, the surface is shaded by a light; unticked, it shows as painted. Which light: in the close-up preview, the stage\'s sun; at a place, that place\'s own light (Place tab).' });
    main.push(...colourBlock());
    subs.push(['Colour replace', replaceBlock], ['Picture', pictureBlock()]);
  } else if (slot === 'normal') {
    main.push(tex, { k: 'opacity', label: 'Strength', type: 'range', min: 0, max: 3, step: 0.01, reset: 1 }, { k: 'flipGreen', label: 'Flip green', type: 'check' });
  } else if (slot === 'specular') {
    main.push(tex,
      { k: 'channel', label: 'Mask in', type: 'select', options: [['a', 'alpha (a _CS map)'], ['r', 'red'], ['g', 'green'], ['b', 'blue']], struct: true },
      { k: 'opacity', label: 'Strength', type: 'range', min: 0, max: 3, step: 0.01 },
      { k: 'shine', label: 'Shininess', type: 'range', min: 2, max: 200, step: 1 },
      { k: 'tint', label: 'Colour', type: 'color' });
  } else if (slot === 'night') {
    main.push(tex,
      { k: 'channel', label: 'Lights in', type: 'select', options: [['rgb', 'colour'], ['r', 'red'], ['g', 'green'], ['b', 'blue']], struct: true },
      { k: 'where', label: 'Shown', type: 'select', options: [['night', 'on the night side only'], ['always', 'everywhere'], ['under', 'under the surface\'s see-through parts']], struct: true },
      ...colourBlock('Strength', 4));
    subs.push(['Colour replace', replaceBlock], ['Picture', pictureBlock({ alpha: false, mask: false })]);
  } else if (slot === 'clouds') {
    main.push(tex,
      { k: 'source', label: 'Cover from', type: 'select', options: [['luma', 'brightness'], ['alpha', 'alpha'], ['r', 'red'], ['g', 'green'], ['b', 'blue']], struct: true },
      { k: 'spin', label: 'Spin (x the body)', type: 'range', min: -3, max: 3, step: 0.05, reset: 1.3 },
      { k: 'height', label: 'Shell height', type: 'range', min: 1, max: 1.06, step: 0.0005, reset: dome ? 1.004 : 1.002 },
      { k: 'lit', label: 'Lit', type: 'check' },
      ...colourBlock());
    subs.push(['Flow map', [
      { k: 'flow.on', label: 'Use a flow map', type: 'check', struct: true },
      { k: 'flow.tex', label: 'Flow texture', type: 'texture', struct: true },
      { k: 'flow.strength', label: 'Strength', type: 'range', min: 0, max: 0.1, step: 0.001 },
      { k: 'flow.speed', label: 'Speed', type: 'range', min: 0, max: 0.3, step: 0.005 },
      { k: 'flow.bias', label: 'Zero point', type: 'range', min: 0.3, max: 0.9, step: 0.005, title: 'The flow map\'s rest value (its mean is 185/255, not 128)' },
    ]], ['Colour replace', replaceBlock], ['Picture', [
      { k: 'alphaFloor', label: 'Cover floor', type: 'range', min: 0, max: 0.5, step: 0.005, reset: 0 },
      ...pictureBlock({ alpha: false, mask: false, zoom: false }),
    ]], ...weatherSubs());
  } else if (slot === 'overlay') {
    main.push(tex,
      { k: 'blend', label: 'Blend', type: 'select', options: [['normal', 'over (by its alpha)'], ['add', 'added (glow)']], struct: true },
      ...colourBlock());
    if (!MESHES[look.mesh]?.shell) main.push({ k: 'height', label: 'Shell height', type: 'range', min: 1, max: 1.03, step: 0.0005 });
    subs.push(['Colour replace', replaceBlock], ['Picture', pictureBlock()]);
  } else if (slot === 'atmosphere') {
    main.push({ k: 'form', label: 'Form', type: 'select', options: [['halo', 'halo mesh with a picture'], ['rim', 'rim glow (no picture)']], struct: true });
    if (L.form === 'rim') {
      main.push({ k: 'tint', label: 'Colour', type: 'color' },
        { k: 'opacity', label: 'Strength', type: 'range', min: 0, max: 3, step: 0.01 },
        { k: 'bright', label: 'Brightness', type: 'range', min: 0, max: 3, step: 0.01 },
        { k: 'power', label: 'Falloff', type: 'range', min: 0.5, max: 10, step: 0.1 },
        { k: 'height', label: 'Height', type: 'range', min: 1, max: 1.25, step: 0.001 },
        { k: 'sunSide', label: 'Sun side only', type: 'range', min: 0, max: 1, step: 0.01 });
    } else {
      main.push({ k: 'mesh', label: 'Halo mesh', type: 'select', options: Object.entries(HALOS).map(([id, h]) => [id, h.label]), struct: true }, tex, ...colourBlock());
      subs.push(['Colour replace', replaceBlock], ['Picture', pictureBlock({ repeat: false })]);
    }
  } else if (slot === 'rings') {
    main.push({ k: 'mesh', label: 'Ring mesh', type: 'select', options: Object.entries(RINGS).map(([id, r]) => [id, r.label]), struct: true }, tex,
      { k: 'tilt', label: 'Tilt', type: 'range', min: -90, max: 90, step: 1, unit: '°' },
      { k: 'roll', label: 'Roll', type: 'range', min: -90, max: 90, step: 1, unit: '°' },
      { k: 'scale', label: 'Scale', type: 'range', min: 0.5, max: 2.5, step: 0.01 },
      { k: 'spin', label: 'Spin (°/s)', type: 'range', min: -10, max: 10, step: 0.1 },
      ...colourBlock());
    subs.push(['Colour replace', replaceBlock], ['Picture', pictureBlock({ mask: false, zoom: false })]);
  }
  return { main, subs };
}

const NOTES = {
  normal: 'Uses the surface\'s UV, zoom and repeat. Two-channel maps have their Z rebuilt. A picture named as a normal map is not always one: check it on the stage.',
  specular: 'Uses the surface\'s UV, zoom and repeat. The alpha of a _CS map is its water mask.',
  night: 'Lights or illumination: on the night side only, everywhere, or under the surface where it is see-through (lava under cloud holes).',
  clouds: 'A shell with its own slow spin: on a sphere, clouds_01 at its x1.002; on a dome, a lat-long shell computed from the dome.',
  overlay: 'A picture painted for the dome\'s shell (a lit limb, cloud or haze): the mesh\'s own shell section where it has one.',
  atmosphere: 'Drawn additively: a halo mesh (riding the body at the survey\'s ratio) with a glow picture, or a rim glow.',
  rings: 'Lies in the body\'s equator; the planet hides its far half. The asteroid belts fade at their arcs\' ends.',
};

function texNote(name) {
  const t = texInfo(name);
  if (!name) return 'No texture.';
  const loaded = textureIfLoaded(name);
  if (!t || t.addedByOwner) {
    const file = state.files.find((f) => f.name === name);
    const dims = loaded ? `${loaded.width}x${loaded.height}${loaded.shrunk ? ' (shrunk on load)' : ''}` : '';
    const what = t ? `Added by you${t.added ? ' on ' + t.added.slice(0, 10) : ''}, as ${t.kind}.` : 'Not in the survey and given no kind yet: it is drawn as an "other" picture until you give it one.';
    return [name + '.', what, [dims, file ? sizeWords(file.size) : ''].filter(Boolean).join(', ')].filter(Boolean).join(' ');
  }
  const m = t.measured || {};
  const size = loaded ? `${loaded.width}x${loaded.height}${loaded.shrunk ? ` (shrunk from ${m.width}x${m.height})` : ''}` : `${m.width}x${m.height}`;
  return [`${t.kind}, ${t.projection}, ${size}.`, t.channels?.rgb ? `RGB: ${t.channels.rgb}.` : '', t.channels?.a ? `A: ${t.channels.a}.` : '', t.notes || ''].filter(Boolean).join(' ');
}

/** For a picture the survey never saw (one added from the page, or put in the folder by hand): its kind, changeable. */
function kindPicker(name) {
  const t = texInfo(name);
  if (!name || (t && !t.addedByOwner) || !state.files.some((f) => f.name === name)) return null;
  const sel = el('select', { 'aria-label': 'Its kind', title: 'What this picture is: decides how it is drawn (wrapped or clamped, colour or data) and where the texture lists show it. Saved with the choices.' });
  if (!t) sel.append(el('option', { value: '', text: '(no kind yet)' }));
  for (const [k, words] of PICTURE_KINDS) sel.append(el('option', { value: k, text: `${k}: ${words}` }));
  sel.value = t?.kind || '';
  sel.addEventListener('change', () => { if (sel.value) setPictureKind(name, sel.value); });
  const pick = el('label', { class: 'kindpick' }, el('span', { text: 'Its kind' }), sel);
  // (the GPU port's pass 2, wave 4) one he added: "ship with the game" or only on this machine (the default); a still never ships
  const rec = state.pictures[name];
  if (!rec) return pick;
  const ship = el('input', { type: 'checkbox', checked: !!rec.ship, disabled: !shippable(rec.kind), 'aria-label': 'Ship with the game' });
  ship.addEventListener('change', () => setPictureShip(name, ship.checked));
  const shipLine = el('label', { class: 'kindpick', title: shippable(rec.kind) ? 'Save to game copies this picture beside the game\'s bodies file, with a credits line naming you, for every player; unticked it stays on this machine (the default)' : 'A still from a film or a game is never shipped with the game' }, ship, el('span', { text: shippable(rec.kind) ? 'Ship with the game (else only on my machine)' : 'Only on my machine (a still never ships)' }));
  return el('div', {}, pick, shipLine);
}

function thumbFor(slot, layer, texName) {
  const src = textureIfLoaded(texName);
  const note = el('div', { class: 'texnote' }, texNote(texName), kindPicker(texName));
  if (!src) return el('div', { class: 'thumbwrap' }, note);
  const c = el('canvas', { width: src.thumb.width, height: src.thumb.height, title: state.pick === slot ? 'Click to take this colour' : texName });
  c.getContext('2d').drawImage(src.thumb, 0, 0);
  if (state.pick === slot) {
    c.classList.add('picking');
    c.addEventListener('click', (e) => {
      const r = c.getBoundingClientRect();
      const x = Math.floor(((e.clientX - r.left) / r.width) * src.thumb.width);
      const y = Math.floor(((e.clientY - r.top) / r.height) * src.thumb.height);
      const d = src.thumb.getContext('2d').getImageData(Math.max(0, x - 1), Math.max(0, y - 1), 3, 3).data;
      let rr = 0, gg = 0, bb = 0;
      for (let i = 0; i < d.length; i += 4) { rr += d[i]; gg += d[i + 1]; bb += d[i + 2]; }
      const hex = '#' + [rr, gg, bb].map((v) => Math.round(v / (d.length / 4)).toString(16).padStart(2, '0')).join('');
      layer.replace.from = hex;
      layer.replace.on = true;
      state.pick = null;
      setDirty(true);
      syncNow();
      renderInspector();
    });
  }
  return el('div', { class: 'thumbwrap' }, c, note);
}

function layerSection(slot, look) {
  const L = look.layers[slot];
  const det = el('details', { class: 'layer' + (L.on ? '' : ' off') });
  det.open = state.openSlots.has(slot);
  det.addEventListener('toggle', () => { if (det.open) state.openSlots.add(slot); else state.openSlots.delete(slot); });
  const cb = el('input', { type: 'checkbox', title: 'Show this layer' });
  cb.checked = !!L.on;
  cb.addEventListener('change', () => {
    L.on = cb.checked;
    det.classList.toggle('off', !L.on);
    setDirty(true);
    rebuildSoon();
  });
  const gen = !!(look.generated && GEN_NOTES[slot]);
  const texName = gen ? 'generated' : slot === 'atmosphere' && L.form === 'rim' ? 'rim glow' : (L.tex || '(no texture)').replace(/\.png$/, '');
  det.append(el('summary', {}, cb, el('span', { class: 'slot', text: SLOT_NAMES[slot] }), el('span', { class: 'tex', text: texName })));
  const body = el('div', { class: 'body' });
  if (gen) body.append(el('p', { class: 'note', text: GEN_NOTES[slot] }));
  else if (NOTES[slot]) body.append(el('p', { class: 'note', text: NOTES[slot] }));
  const { main, subs } = layerControls(slot, look);
  const showsPicture = !gen && !(slot === 'atmosphere' && L.form === 'rim');
  if (showsPicture) body.append(thumbFor(slot, L, L.tex));
  for (const d of main) body.append(control(d, L, slot, `layers.${slot}.`));
  for (const [title, list] of subs) {
    const sd = el('details', { class: 'sub' });
    const key = slot + ':' + title;
    sd.open = state.openSlots.has(key) || (title === 'Colour replace' && (L.replace?.on || state.pick === slot));
    sd.addEventListener('toggle', () => { if (sd.open) state.openSlots.add(key); else state.openSlots.delete(key); });
    sd.append(el('summary', { text: title }));
    for (const d of list) sd.append(control(d, L, slot, `layers.${slot}.`));
    body.append(sd);
  }
  det.append(body);
  return det;
}

function lookControls(look, id) {
  const A = look.adjust;
  const meshOptions = Object.entries(MESHES).filter(([, m]) => m.kind === look.kind).map(([mid, m]) => [mid, m.label]);
  const list = [
    { k: 'name', label: 'Name', type: 'text' },
    // a generated look is always a sphere on the full sphere mesh
    look.generated ? null : {
      k: 'kind', label: 'Kind', type: 'select', struct: true,
      options: [['dome', 'dome (light painted in, faces you)'], ['sphere', 'sphere (lit by the sun)'], ['sheet', 'sheet (a flat picture)']],
      after: (k) => { const first = Object.entries(MESHES).find(([, m]) => m.kind === k); if (first && MESHES[look.mesh]?.kind !== k) look.mesh = first[0]; },
    },
    look.generated ? null : { k: 'mesh', label: 'Mesh', type: 'select', options: meshOptions, struct: true },
    { k: 'adjust.size', label: 'Preview size', type: 'range', min: 0.1, max: 4, step: 0.01, reset: 1, after: () => { if (state.mode === 'look') frameCurrent(); }, title: 'The close-up preview only: at a place, the place\'s own Size sets the angle it fills' },
    { k: 'adjust.tilt', label: look.kind === 'sphere' ? 'Axial tilt (preview)' : 'Tilt (preview)', type: 'range', min: -90, max: 90, step: 0.5, unit: '°', reset: 0, title: 'The close-up preview only: each place has its own Tilt' },
    { k: 'adjust.spin', label: 'Spin (preview, °/s)', type: 'range', min: -20, max: 20, step: 0.1, reset: 2, title: 'The close-up preview only: each place has its own Spin. A sphere turns; a dome\'s lat-long layers scroll' },
  ];
  if (look.kind !== 'sheet') list.push({ k: 'adjust.ambient', label: 'Ambient', type: 'range', min: 0, max: 0.6, step: 0.005 });
  if (look.kind === 'dome') {
    list.push({ k: 'adjust.lightAngle', label: 'Painted light from', type: 'range', min: -180, max: 180, step: 1, unit: '°', title: 'For lit layers on a dome, wherever its place\'s light is "painted in": 0 = from the right, 90 = from the top, 180 = from the left (match the picture)' },
      { k: 'adjust.lightElev', label: 'Painted light height', type: 'range', min: 0, max: 89, step: 1, unit: '°' });
  }
  if (look.kind === 'sphere') {
    list.push({ k: 'adjust.glow', label: 'Night glow colour', type: 'color' },
      { k: 'adjust.glowStrength', label: 'Night glow strength', type: 'range', min: 0, max: 1, step: 0.005, reset: 0 },
      { k: 'adjust.ownSun.on', label: 'A sun of its own, on the preview stage only (instead of the stage\'s; the phase still swings it). At a place, the place\'s Light decides.', type: 'check' },
      { k: 'adjust.ownSun.az', label: 'Its sun azimuth', type: 'range', min: -180, max: 180, step: 1, unit: '°' },
      { k: 'adjust.ownSun.el', label: 'Its sun elevation', type: 'range', min: -89, max: 89, step: 1, unit: '°' });
  }
  if (look.kind === 'sheet') list.push({ k: 'adjust.showRects', label: 'Outline the moons the survey found', type: 'check', struct: true });
  return list.filter(Boolean);
}

// ---- a generated look's own section: its preset, seed, size and dials, and the last bake ----

let bakeTimer = 0;
/** A baked dial or the seed moved: bake again a moment after it stops moving. */
function scheduleBake(look) {
  setDirty(true);
  clearTimeout(bakeTimer);
  $('genInfo') && ($('genInfo').textContent = 'Baking soon…');
  bakeTimer = setTimeout(async () => {
    const ms = await rebakeGenerated(look).catch((e) => { setStatus('Bake failed: ' + e.message, true); return null; });
    if (ms === null) rebuildSoon(); // not on the stage yet: building it bakes it
    else {
      updateGenInfo(look);
      // the decks came or went, or a blend brought a second kind of glow: its materials are built anew
      if (needsRebuild(look)) rebuildSoon();
    }
  }, 250);
}

function updateGenInfo(look) {
  const box = $('genInfo');
  if (!box || state.looks[state.currentId] !== look) return;
  const i = generatedInfo(look);
  if (!i) { box.textContent = 'Not baked yet.'; return; }
  const ms = (v) => (v >= 1000 ? (v / 1000).toFixed(2) + ' s' : Math.round(v) + ' ms');
  box.textContent = `Baked at ${i.width} x ${i.height}${i.clouds ? ', with clouds' : ''}: ${ms(i.lastMs)}` +
    (i.bakes > 1 || !i.lastFirst ? ` (its first bake, the shaders made with it, took ${ms(i.firstMs)})` : ' (with the shaders made)') + '.';
}

/** Put a look back to one preset: its recipe, seed and dials, and the layers the preset sets. */
function applyPreset(look, presetId) {
  const fresh = finishLook(makeLook(presetLook(presetId)));
  look.generated = cleanGenerated({ ...fresh.generated, size: look.generated?.size || 2048 });
  for (const slot of ['surface', 'normal', 'specular', 'night', 'clouds', 'atmosphere']) look.layers[slot] = fresh.layers[slot];
  for (const k of ['ambient', 'glow', 'glowStrength']) look.adjust[k] = fresh.adjust[k];
}

// ---- the colour matcher (21 November): a look's lit disc against a reference's, in CIELAB ----

/**
 * The lit disc of a body on the close-up stage ('current' or 'compare'), measured (colourmatch.js's
 * discStats): drawn once more and read straight back from the canvas, inside the circle its sphere
 * fills (a little within it, so the air's rim is left out). Null at a place or with nothing on show.
 */
async function measureOnStage(which = 'current') {
  const b = which === 'compare' ? state.compare : state.current;
  if (!b || state.mode !== 'look') return null;
  const cam = S.camera, cv = S.renderer.domElement;
  const p = new THREE.Vector3();
  b.root.getWorldPosition(p);
  const R = which === 'compare' ? (b.placeScale || 1) : (+b.look.adjust.size || 1);
  const d = p.distanceTo(cam.position);
  const sp = p.clone().project(cam);
  const rpx = Math.tan(Math.asin(Math.min(1, R / d))) / Math.tan((cam.fov * Math.PI) / 360) * (cv.height / 2);
  const circle = { x: ((sp.x + 1) / 2) * cv.width, y: ((1 - sp.y) / 2) * cv.height, r: rpx * 0.96, R: rpx };
  // a sphere lit by the stage's sun is measured where that sun lights it (as tick aims it), so a dark
  // ground under bright clouds still counts; a dome's painted light is found by its brightness
  let sunView = null;
  if (b.look.kind === 'sphere') {
    const A = b.look.adjust;
    const own = which === 'current' && !state.compare && A.ownSun?.on;
    const v = sunVector((own ? +A.ownSun.az : +$('az').value) + +$('phase').value, own ? +A.ownSun.el : +$('el').value, new THREE.Vector3());
    // (the sun as seen from the body: the view's frame turned, its direction toward the sun)
    v.transformDirection(cam.matrixWorldInverse);
    sunView = { x: v.x, y: v.y, z: v.z };
  }
  // drawn and read in one go: a canvas's picture lasts only until the page yields
  gameLook.render();
  const c2 = new OffscreenCanvas(cv.width, cv.height);
  const x = c2.getContext('2d', { willReadFrequently: true });
  x.drawImage(cv, 0, 0);
  return discStats(x.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height, { circle, sun: sunView });
}

/**
 * A picture's lit disc, measured: one in the imported folder by its name, any URL of this page, or the
 * bytes themselves ({ b64, type }, for pictures the server does not serve). `circle` ({ x, y, r } as
 * fractions of the width, the height and the shorter side) keeps it to one body of a picture holding more.
 */
async function measurePicture(src, { circle = null, ...opts } = {}) {
  let blob;
  if (src && typeof src === 'object' && src.b64) blob = new Blob([Uint8Array.from(atob(src.b64), (ch) => ch.charCodeAt(0))], { type: src.type || 'image/png' });
  else {
    // (wave 4) a picture of the imported folder through build.js's one hook, as every picture is read
    const url = /^(\/|https?:)/.test(src) ? src : pictureUrl(src);
    if (!url) throw new Error(`${src}: 404`);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${src}: ${r.status}`);
    blob = await r.blob();
  }
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0);
  const circ = circle ? { x: circle.x * bmp.width, y: circle.y * bmp.height, r: circle.r * Math.min(bmp.width, bmp.height) } : null;
  return discStats(x.getImageData(0, 0, bmp.width, bmp.height).data, bmp.width, bmp.height, { ...opts, circle: circ });
}

const GRADE_KEYS = ['gradeStrength', 'gradeLightness', 'gradeContrast', 'gradeHue', 'gradeWash', 'gradeWashColour'];
/**
 * Match a version 2 look's colours to a reference: measured stats, 'compare' (the look beside it on the
 * stage) or a picture (as measurePicture takes it). Each step measures the look on the stage, moves its
 * grade dials toward the reference (colourmatch.js's gradeToward), bakes and draws it again. The stage
 * holds still while it works. Every step is one change, so Ctrl+Z walks back through them.
 */
async function matchColours(look, ref, { steps = 4, use = {}, damp = 0.8, circle = null } = {}) {
  const g = look?.generated;
  if (!g || (g.version || 1) < 2) throw new Error('only a generated look of recipe version 2 has the colour grade');
  if (state.looks[state.currentId] !== look || state.mode !== 'look') throw new Error('show the look on the close-up stage first');
  const target = ref === 'compare' ? await measureOnStage('compare') : (ref && ref.L ? ref : await measurePicture(ref, { circle }));
  if (!target) throw new Error('nothing to match: no reference measured');
  const spin = $('autospin'), was = spin.checked;
  spin.checked = false;
  const settle = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  try {
    await settle();
    const before = await measureOnStage('current');
    let cur = before;
    const trail = [];
    for (let i = 0; i < steps; i++) {
      const next = gradeToward(cur, target, Object.fromEntries(GRADE_KEYS.map((k) => [k, g.dials[k]])), { damp, use });
      Object.assign(g.dials, next);
      setDirty(true);
      await rebakeGenerated(look);
      await settle();
      cur = await measureOnStage('current');
      trail.push({ grade: next, stats: cur });
    }
    renderInspectorSoon();
    return { target, before, after: cur, grade: Object.fromEntries(GRADE_KEYS.map((k) => [k, g.dials[k]])), trail, differences: { before: compareStats(before, target), after: compareStats(cur, target) } };
  } finally {
    spin.checked = was;
  }
}

/** The Colour group's matcher: a reference, Measure and Match, and the numbers before and after. */
function colourMatchBox(look) {
  const g = look.generated;
  const sel = el('select', { 'aria-label': 'Match to' });
  sel.append(el('option', { value: 'compare', text: 'the look beside it ("Compare with" over the stage)' }));
  for (const f of state.files || []) if (/\.(png|jpe?g)$/i.test(f.name)) sel.append(el('option', { value: f.name, text: 'picture: ' + f.name }));
  sel.value = state.matchRef && [...sel.options].some((o) => o.value === state.matchRef) ? state.matchRef : 'compare';
  sel.addEventListener('change', () => { state.matchRef = sel.value; });
  const words = el('p', { class: 'note gen-info', text: state.matchWords || 'Measures the lit part of each disc (lightness, colour strength and hue in CIELAB: their means and spreads), then moves the six dials above until this look\'s numbers meet the reference\'s, baking between steps. Each step can be undone (Ctrl+Z); ↺ beside each dial puts it back.' });
  const say = (t) => { state.matchWords = t; words.textContent = t; };
  const ref = () => (sel.value === 'compare' ? 'compare' : sel.value);
  const measure = async () => {
    try {
      const here = await measureOnStage('current');
      const there = ref() === 'compare' ? await measureOnStage('compare') : await measurePicture(ref());
      if (!there) { say('Nothing to measure it against: choose a look in "Compare with" over the stage, or a picture.'); return; }
      const dd = compareStats(here, there);
      say(`This look: ${statsWords(here)}. The reference: ${statsWords(there)}. Lightness ${dd.dL >= 0 ? '+' : ''}${dd.dL.toFixed(1)}, colour strength x${dd.Cratio.toFixed(2)}, hue ${dd.dh >= 0 ? '+' : ''}${dd.dh.toFixed(0)}°.`);
    } catch (e) { say('Could not measure: ' + e.message); }
  };
  const match = async () => {
    say('Matching: measuring, moving the dials and baking, four times…');
    try {
      const r = await matchColours(look, ref());
      say(`Matched. Before: ${statsWords(r.before)}. After: ${statsWords(r.after)}. The reference: ${statsWords(r.target)}.`);
    } catch (e) { say('Could not match: ' + e.message); }
  };
  const back = () => {
    const own = presetDials(g.preset, g.version || 1);
    for (const k of GRADE_KEYS) g.dials[k] = own[k];
    setDirty(true); scheduleBake(look); renderInspectorSoon();
    say('The colour dials are back at the preset\'s.');
  };
  return [
    el('div', { class: 'ctl', title: 'What to match this look\'s colours to' }, el('span', { text: 'Match to' }), sel, el('span'), el('span')),
    el('div', { class: 'row' },
      el('button', { type: 'button', class: 'small', title: 'Measure this look and the reference, and say how they differ', onclick: measure }, 'Measure'),
      el('button', { type: 'button', class: 'small', title: 'Move the six colour dials until this look measures as the reference does (four steps, each baked; Ctrl+Z undoes)', onclick: match }, 'Match colours'),
      el('button', { type: 'button', class: 'small', title: 'Put the six colour dials back as the preset has them', onclick: back }, '↺ Colour back to the preset')),
    words,
  ];
}

function generatedSection(look) {
  const g = look.generated;
  const out = [];
  out.push(el('h3', { text: 'Generated' }));
  out.push(el('p', { class: 'note', text: 'Made by our own code from a recipe, a seed and the dials below: no picture. It is baked into textures once, a moment after a dial or the seed stops moving; drawing it then costs no more than a picture. "Compare with" over the stage puts any other look beside it.' }));

  const presetOptions = (sel) => {
    const groups = new Map();
    for (const id of PRESET_ORDER) {
      const gname = PRESETS[id].group || 'The first test';
      if (!groups.has(gname)) groups.set(gname, el('optgroup', { label: gname }));
      groups.get(gname).append(el('option', { value: id, text: PRESETS[id].volume ? `${PRESETS[id].name} (space volume)` : `${PRESETS[id].name} (${RECIPES[PRESETS[id].recipe].name.toLowerCase()}${PRESETS[id].mix ? ' with ' + RECIPES[PRESETS[PRESETS[id].mix.preset].recipe].name.toLowerCase() : ''})` }));
    }
    for (const og of groups.values()) sel.append(og);
  };
  const preset = el('select', { 'aria-label': 'Preset' });
  presetOptions(preset);
  preset.value = g.preset;
  preset.addEventListener('change', () => {
    applyPreset(look, preset.value);
    setDirty(true);
    rebuildSoon();
    renderInspectorSoon();
    renderCompareSelect();
  });
  // the preset, seed, size and blend each reset to the look's default (or, for a look of no default,
  // as it was made); the seed to its preset's own
  const defGen = defaultsCache()[state.currentId]?.generated || state.madeLooks[state.currentId]?.generated || null;
  const genReset = (value, from, current, onReset) => (value === undefined ? el('span') : resetButton({ value, from }, current, onReset));
  out.push(el('div', { class: 'ctl', title: 'Start from a preset: its recipe, seed and dials, and the layers it sets' }, el('span', { text: 'Preset' }), preset, el('span'),
    genReset(defGen?.preset, defGen === state.madeLooks[state.currentId]?.generated ? 'as the look was made' : 'the default', g.preset, (v) => {
      applyPreset(look, v); setDirty(true); rebuildSoon(); renderInspectorSoon(); renderCompareSelect();
    })));
  out.push(el('div', { class: 'row' },
    el('button', { type: 'button', class: 'small', title: 'Put the recipe, seed, dials and layers back as the preset has them', onclick: () => { applyPreset(look, g.preset); setDirty(true); rebuildSoon(); renderInspectorSoon(); } }, 'Back to the preset'),
    el('span', { class: 'note', text: `Recipe: ${RECIPES[g.recipe].name}, version ${g.version || 1}${g.mix ? `; blended: ${RECIPES[g.mix.recipe].name}, version ${g.mix.version || 1}` : ''}` })));
  // (21 November) the recipe's version: a look keeps the one it was made with until it is moved here; a
  // later version's dials come in at the preset's starts, an earlier one drops them
  const verSel = el('select', { 'aria-label': 'Recipe version' });
  // (wave B) the planet features' version: 3, the living world's 4
  const verText = (v) => (v === 1 ? '1: the first' : v === 2 ? `2: spots${g.recipe === 'living' ? '' : ' (living worlds)'}, cloud flecks, colour grade`
    : v === partsVersion(g.recipe) ? `${v}: planet features (atolls, long lines, a fracture star, a great trench, glow specks, lace, smoky mottle, fine detail, a great cyclone)${g.recipe === 'living' ? '' : ', cirrus streaks'}`
    : `${v}: fine fray, lakes, cirrus streaks`);
  for (let v = 1; v <= recipeVersion(g.recipe); v++) verSel.append(el('option', { value: v, text: verText(v) }));
  verSel.value = g.version || 1;
  const setVersion = (v) => { const c = cleanGenerated({ ...g, version: +v }); g.version = c.version; g.dials = c.dials; setDirty(true); rebuildSoon(); renderInspectorSoon(); };
  verSel.addEventListener('change', () => setVersion(verSel.value));
  out.push(el('div', { class: 'ctl', title: 'The recipe\'s version. A saved look never changes by itself: it keeps its version until you move it here' }, el('span', { text: 'Recipe version' }), verSel, el('span'),
    genReset(PRESETS[g.preset]?.version || 1, `the preset "${PRESETS[g.preset]?.name}"`, g.version || 1, setVersion)));

  const seed = el('input', { type: 'number', min: 0, max: 999999, step: 1, value: g.seed, 'aria-label': 'Seed' });
  seed.addEventListener('change', () => { g.seed = Math.abs(Math.trunc(+seed.value || 0)) % 1000000; seed.value = g.seed; scheduleBake(look); });
  const dice = el('button', { type: 'button', class: 'small', title: 'A new seed: the same recipe and dials, another world' }, 'Dice');
  dice.addEventListener('click', () => { g.seed = randomSeed(); seed.value = g.seed; scheduleBake(look); });
  out.push(el('div', { class: 'ctl', title: 'The same seed and dials always make the same planet' }, el('span', { text: 'Seed' }), el('div', { class: 'colorline' }, seed, dice), el('span'),
    genReset(PRESETS[g.preset]?.seed, `the preset "${PRESETS[g.preset]?.name}"`, g.seed, (v) => { g.seed = v; seed.value = v; scheduleBake(look); })));

  // wave 5: gas alone draws no surface, so its recipe's dials are left out (turn its Surface layer on
  // to put a body inside the gas, and they come back)
  if (gasOnly(look)) {
    out.push(el('p', { class: 'note', text: 'Gas alone: no surface is drawn, so the recipe\'s dials are not shown (tick the Surface layer below to put a body inside it). The seed shapes the gas.' }));
    out.push(...partsSection(look));
    return out;
  }

  const size = el('select', { 'aria-label': 'Texture size' });
  for (const [w, h] of SIZES) size.append(el('option', { value: w, text: `${w} x ${h}${w === 2048 ? ' (start)' : w === 4096 ? ' (sharpest, slower to bake)' : ' (quick)'}` }));
  size.value = g.size;
  size.addEventListener('change', () => { g.size = +size.value; setDirty(true); rebuildSoon(); });
  out.push(el('div', { class: 'ctl', title: 'The size of the baked textures (each is a whole-sphere lat-long map)' }, el('span', { text: 'Texture size' }), size, el('span'),
    genReset(defGen?.size ?? 2048, defGen ? 'the default' : 'the start', g.size, (v) => { g.size = +v; size.value = v; setDirty(true); rebuildSoon(); })));
  out.push(el('p', { class: 'note gen-info', id: 'genInfo', text: 'Not baked yet.' }));

  // a dial resets to its preset's start (the blended recipe's to its own preset's); where and how a
  // blend shows, to the look's preset's blend when it is the same one, else the dial's start
  const own = presetDials(g.preset);
  const mixPreset = PRESETS[g.preset]?.mix?.preset === g.mix?.preset ? presetLookOf(g.preset)?.generated?.mix : null;
  const startOf = (d, obj) => {
    if (obj === g.dials) return { reset: own[d.k] ?? d.def, resetFrom: `the preset "${PRESETS[g.preset].name}"` };
    if (g.mix && obj === g.mix.dials) return { reset: presetDials(g.mix.preset)[d.k] ?? d.def, resetFrom: `the preset "${PRESETS[g.mix.preset].name}"` };
    if (g.mix && obj === g.mix && mixPreset) return { reset: mixPreset[d.k] ?? d.def, resetFrom: `the preset "${PRESETS[g.preset].name}"` };
    return { reset: d.def, resetFrom: 'the dial\'s start' };
  };
  const dial = (d, obj = g.dials) => ({ ...d, ...startOf(d, obj), after: d.live ? undefined : () => scheduleBake(look) });
  const group = (title, list, note, obj = g.dials, startClosed = false) => {
    const key = 'gen:' + title;
    const sd = el('details', { class: 'sub', open: startClosed ? state.openGroups?.has(key) : !state.closedGroups.has(key) });
    sd.addEventListener('toggle', () => {
      state.openGroups ||= new Set();
      if (sd.open) { state.closedGroups.delete(key); state.openGroups.add(key); } else { state.closedGroups.add(key); state.openGroups.delete(key); }
    });
    sd.append(el('summary', { text: title }));
    if (note) sd.append(el('p', { class: 'note', text: note }));
    for (const d of list) sd.append(control(dial(d, obj), obj, null, ''));
    return sd;
  };
  // the recipe's own dials, in their groups (a recipe without groups is one group of its name)
  const r = RECIPES[g.recipe];
  const byGroup = new Map();
  for (const d of [...r.dials, ...(r.lights ? LIGHT_DIALS : [])].filter((x) => !(x.since > (g.version || 1)))) {
    const t = d.group ? `${r.name}: ${d.group.toLowerCase()}` : r.name;
    if (!byGroup.has(t)) byGroup.set(t, []);
    byGroup.get(t).push(d);
  }
  let firstGroup = true;
  for (const [t, list] of byGroup) {
    const depthNote = 'The bands as cloud decks at different heights, the upper shading the lower and casting their shadows toward the terminator, riding over the lower toward the limb. None at 0 decks: then the bands are flat, as they always were. The decks are baked; the spread and the shading are live.';
    out.push(group(t, list, firstGroup ? 'Double-click a slider, or press ↺ beside it, to put it back to the preset\'s start. Ctrl+Z undoes any change.' : list.some((d) => d.k === 'depthLayers') ? depthNote : (list.some((d) => d.live) ? 'The colours and brightness are live (no bake); the night layer below shows the lights.' : '')));
    firstGroup = false;
  }
  if (r.relief > 0) out.push(group('Features', FEATURE_DIALS, 'Sinkholes, canyons and crater fields over any recipe: none while a count is at 0.', g.dials, true));
  // (wave B) the planet features, each its own group (closed until opened), at the version that has them
  if ((g.version || 1) >= partsVersion(g.recipe)) {
    const byPart = new Map();
    for (const d of PART_DIALS) { if (!byPart.has(d.group)) byPart.set(d.group, []); byPart.get(d.group).push(d); }
    for (const [t, list] of byPart) out.push(group(`Feature: ${t.toLowerCase()}`, list, list[0].groupNote, g.dials, true));
  } else out.push(el('p', { class: 'note', text: `Atolls, long lines, a fracture star, a great trench, glow specks, lace, a smoky mottle, fine detail and a great cyclone come with recipe version ${partsVersion(g.recipe)} (the Recipe version above).` }));
  out.push(group('Clouds', CLOUD_DIALS, look.layers.clouds.on ? 'The generated cloud layer (the Clouds layer below draws it).' : 'Tick the Clouds layer below to draw them.'));
  if ((g.version || 1) >= 2) {
    out.push(group('Clouds: flecks', CLOUD_SPOT_DIALS, 'Many small flecks and wisps of cloud between the masses (version 2): none at 0.'));
    if ((g.version || 1) >= 3) out.push(group('Clouds: streaks', CLOUD_STREAK_DIALS, 'Long thin streaks of high cloud combed along the winds (version 3): none at 0.'));
    const cg = group('Colour', GRADE_DIALS, 'The colour grade over the ground (version 2): calmer or stronger colours, lighter or darker, a hue turn, and a wash that pulls every colour toward one. Baked. "Match colours" below sets them all from a reference.');
    cg.append(...colourMatchBox(look));
    out.push(cg);
  }
  out.push(group('Shading (no bake)', SHADING_DIALS, 'Live: what the light does at the surface.'));
  out.push(...partsSection(look));

  // blending a second recipe in by region
  const blend = el('details', { class: 'sub', open: !!g.mix || state.openGroups?.has('gen:blend') });
  blend.addEventListener('toggle', () => { state.openGroups ||= new Set(); if (blend.open) state.openGroups.add('gen:blend'); else state.openGroups.delete('gen:blend'); });
  blend.append(el('summary', { text: 'Blend in a second recipe' }));
  blend.append(el('p', { class: 'note', text: 'Another preset\'s ground over parts of this one: in patches, on the high ground, toward the poles or on one hemisphere. Its own dials are below.' }));
  const mixSel = el('select', { 'aria-label': 'Blend in' });
  mixSel.append(el('option', { value: '', text: 'Nothing' }));
  presetOptions(mixSel);
  mixSel.value = g.mix?.preset || '';
  mixSel.addEventListener('change', () => {
    if (!mixSel.value) delete g.mix;
    else g.mix = mixFrom(mixSel.value, g.mix);
    scheduleBake(look);
    renderInspectorSoon();
    rebuildSoon(); // the night layer may come or go with the blended recipe's glow
  });
  // back to the default's blend (or as made): its preset and how it shows, or none
  const defMix = defGen ? defGen.mix || null : undefined;
  blend.append(el('div', { class: 'ctl', title: 'A preset whose recipe and dials are blended in' }, el('span', { text: 'Blend in' }), mixSel, el('span'),
    genReset(defMix === undefined ? undefined : defMix?.preset || '', defGen === state.madeLooks[state.currentId]?.generated ? 'as the look was made' : 'the default', g.mix?.preset || '', () => {
      if (defMix) g.mix = JSON.parse(JSON.stringify(defMix)); else delete g.mix;
      scheduleBake(look);
      renderInspectorSoon();
      rebuildSoon();
    })));
  if (g.mix) {
    for (const d of MIX_DIALS) blend.append(control(dial(d, g.mix), g.mix, null, ''));
    const mr = RECIPES[g.mix.recipe];
    blend.append(group(`Blended: ${mr.name}`, mixDialsOf(g.mix.recipe, g.mix.version || 1), 'The blended recipe\'s own dials.', g.mix.dials, true));
  }
  out.push(blend);
  return out;
}

/**
 * Wave 2's parts of a generated look: its shape (irregular or broken, with a broken planet's stream),
 * a belt or debris field, and rings. Each is chosen by kind (none at first), then has its dials: those
 * that reshape it rebuild the look (a moment), its colours, dust and glow are live. A dial resets to
 * the preset's value where the preset has that part, else to the part's start.
 */
function partsSection(look) {
  const g = look.generated;
  const pp = presetParts(g.preset);
  const out = [];
  const info = state.current?.look === look ? partsInfo(state.current) : null;
  const choose = (label, title, options, value, onPick) => {
    const sel = el('select', { 'aria-label': label });
    for (const [v, t] of options) sel.append(el('option', { value: v, text: t }));
    sel.value = value;
    sel.addEventListener('change', () => { onPick(sel.value); setDirty(true); rebuildSoon(); renderInspectorSoon(); });
    return el('div', { class: 'ctl', title }, el('span', { text: label }), sel, el('span'), el('span'));
  };
  const group = (key, title, note, list, obj, presetPart, over = {}) => {
    const sd = el('details', { class: 'sub', open: !state.closedGroups.has('part:' + key) });
    sd.addEventListener('toggle', () => { if (sd.open) state.closedGroups.delete('part:' + key); else state.closedGroups.add('part:' + key); });
    sd.append(el('summary', { text: title }));
    if (note) sd.append(el('p', { class: 'note', text: note }));
    const starts = startsOf(list, over);
    for (const d of list) {
      const fromPreset = presetPart && presetPart.dials[d.k] !== undefined;
      sd.append(control({ ...d, reset: fromPreset ? presetPart.dials[d.k] : starts[d.k], resetFrom: fromPreset ? `the preset "${PRESETS[g.preset].name}"` : 'the part\'s start', struct: !d.live, rerender: false }, obj, null, ''));
    }
    return sd;
  };
  const fresh = (part, kind, have) => (have && (have.kind || have.style) === kind ? JSON.parse(JSON.stringify(have)) : newPart(part, kind));

  out.push(el('h3', { text: 'Shape, belt and rings' }));
  out.push(el('p', { class: 'note', text: 'A real 3D shape instead of a sphere (the recipe is painted over it), rocks round the body, and rings. Rocks are real rocks near the camera, flat cards from a baked atlas of each rock in the middle distance, and soft dust far off. Shapes and rocks are made again when a dial that shapes them stops; colours, dust and glow are live.' }));
  if (info) {
    const bits = [];
    if (info.shapeMs != null) bits.push(`shape baked in ${Math.round(info.shapeMs)} ms`);
    for (const f of info.fields) bits.push(`${f.rocks} rocks (${f.near} drawn as rocks now) and ${f.puffs} puffs of dust`);
    if (info.rings) bits.push('rings');
    if (bits.length) out.push(el('p', { class: 'note gen-info', text: bits.join(' · ') + (info.buildMs != null ? ` · built in ${Math.round(info.buildMs)} ms` : '') + '.' }));
  }

  out.push(choose('Shape', 'A round body, an irregular one (an asteroid or small moon), or a broken planet', SHAPE_KINDS, g.shape?.kind || '', (v) => {
    if (v) g.shape = fresh('shape', v, pp.shape); else delete g.shape;
  }));
  if (g.shape) {
    const list = shapeDialsOf(g.shape.kind);
    const kindName = SHAPE_KINDS.find(([k]) => k === g.shape.kind)[1];
    out.push(group('shape', `Shape: ${kindName.toLowerCase()}`, g.shape.kind === 'broken' ? 'A piece torn away: the exposed rock in layers, the molten heart glowing at the bottom and in the cracks, the edge crumbling.' : 'Lumps, a long or round body, craters pressed in and flat faces where pieces split off. The surface recipe (best the bare moon) is painted over it.', list.filter((d) => !d.group), g.shape.dials, pp.shape?.kind === g.shape.kind ? pp.shape : null));
    const stream = list.filter((d) => d.group === 'Stream');
    if (stream.length) out.push(group('stream', 'Stream of debris', 'Rocks trailing from the wound: out, along and bending as they fall behind, fanning out as they go, with a haze of fine dust. 0 rocks: none.', stream, g.shape.dials, pp.shape?.kind === g.shape.kind ? pp.shape : null));
  }

  out.push(choose('Belt or field', 'Rocks in a belt round the body, or a debris field with no orbit (turn the Surface layer off for one with no body)', BELT_KINDS, g.belt?.kind || '', (v) => {
    if (v) g.belt = fresh('belt', v, pp.belt); else delete g.belt;
  }));
  if (g.belt) out.push(group('belt', g.belt.kind === 'field' ? 'Debris field' : 'Belt', 'Sizes and edges are in body radii. Many small rocks and few big ones; the gaps are clear lanes.', BELT_DIALS, g.belt.dials, pp.belt?.kind === g.belt.kind ? pp.belt : null));

  out.push(choose('Rings', 'Generated rings in the body\'s equator: dusty, icy or banded', RING_STYLES, g.rings?.style || '', (v) => {
    if (v) g.rings = fresh('rings', v, pp.rings); else delete g.rings;
  }));
  if (g.rings) out.push(group('rings', `Rings: ${g.rings.style}`, 'The body\'s shadow falls across them and theirs on the body. Dusty rings glow when seen toward the sun, icy ones are bright on their lit face.', RING_DIALS, g.rings.dials, pp.rings?.style === g.rings.style ? pp.rings : null, RING_STYLE_DIALS[g.rings.style]));
  out.push(...volumeSection(look, choose, group, fresh, pp));
  return out;
}

/**
 * Wave 5: a look's space volume, glowing gas drawn as a true volume (volume.js), round the body or with
 * no body (its Surface layer off). Every dial is live but the billows' size, which makes its noise volume
 * again a moment after it stops. Its quality is the "Gas" dial over the stage.
 */
function volumeSection(look, choose, group, fresh, pp) {
  const g = look.generated;
  const out = [];
  out.push(el('h3', { text: 'Space volume' }));
  out.push(el('p', { class: 'note', text: 'Glowing gas drawn as a true volume: each pixel\'s ray marched through 3D noise, the gas giving light and swallowing it, so stars and planets show through thin gas and vanish behind thick. Scenery seen from a zone (a nebula near a planet, a zone\'s backdrop, a storm round a dark heart), never flown into: place it with "Add your own places" on the Places tab. A body of the zone in its way hides the gas behind it; the gas in front veils it.' }));
  out.push(choose('Volume', 'Glowing gas round the body, or with no body (turn the Surface layer off)', VOLUME_KINDS, g.volume?.kind || '', (v) => {
    if (v) g.volume = fresh('volume', v, pp.volume); else delete g.volume;
  }));
  if (!g.volume) return out;
  const vi = volumeInfo(look);
  const q = volumeQualityState();
  out.push(el('p', { class: 'note gen-info', text: `Drawn now at ${VOLUME_TIERS[q.tier].words.toLowerCase()}${q.mode === 'auto' ? ' (auto)' : ''}.${vi ? ` Its noise volume (128 slices of 128 x 128, for Medium and Low) made in ${Math.round(vi.lastMs)} ms.` : ''}` }));
  const own = pp.volume?.kind === g.volume.kind ? pp.volume : null;
  out.push(group('volume', 'Gas', 'Colour runs from the thin gas\'s to the thick gas\'s. Glow is its own light, density what it swallows. The drift and the churn move it by uniforms, never a bake.', VOLUME_DIALS.filter((d) => !d.group), g.volume.dials, own));
  out.push(group('volume-heart', 'Heart (the Maw)', 'A dark heart with a glowing rim at the middle, the gas behind it bent round it a little. "The heart shows" at 0: none.', VOLUME_DIALS.filter((d) => d.group === 'Heart'), g.volume.dials, own));
  out.push(group('volume-flash', 'Lightning inside', 'Wave 4\'s storm flashes, inside the gas: each lights the gas round it, so they show where it is thick. Thunder follows the Thunder switch (off at the start).', VOLUME_DIALS.filter((d) => d.group === 'Lightning'), g.volume.dials, own));
  return out;
}
/** A look that is gas alone: a volume and no surface (its recipe draws nothing). */
const gasOnly = (look) => !!look.generated?.volume && !look.layers.surface.on && !look.layers.clouds.on;

function renderInspector() {
  const panel = $('lookPanel');
  const scroll = panel.scrollTop;
  panel.textContent = '';
  const id = state.currentId;
  const look = state.looks[id];
  if (!look) return;
  const defs = allDefaults();
  panel.append(el('p', { class: 'note', text: `A look: what a body is (its mesh, pictures, colours, clouds, rings). ${id} · ${look.group}` }));
  if (look.note) panel.append(el('p', { class: 'note', text: look.note }));
  panel.append(whereBox(id));
  const row = el('div', { class: 'row' });
  row.append(el('button', { type: 'button', class: 'small', onclick: duplicateLook, title: 'A copy under Your own, to try something without losing this' }, 'Duplicate'));
  if (defs[id]) row.append(el('button', { type: 'button', class: 'small', title: 'Put this look back as the defaults have it', onclick: () => { state.looks[id] = defs[id]; setDirty(true); renderLibrary(); show(id); } }, 'Reset to default'));
  else row.append(el('button', { type: 'button', class: 'small', title: 'Delete this look of your own', onclick: () => deleteLook(id) }, 'Delete'));
  if (look.adjust.alt && state.looks[look.adjust.alt]) {
    const alt = look.adjust.alt;
    row.append(el('button', { type: 'button', class: 'small', title: 'Show the other choice', onclick: () => show(alt, { frame: true }) }, 'Other choice: ' + state.looks[alt].name));
    const places = state.places.filter((p) => state.uses[p.id] === id);
    if (places.length) row.append(el('button', { type: 'button', class: 'small', title: 'Point every place that uses this look at the other choice', onclick: () => { for (const p of places) state.uses[p.id] = alt; setDirty(true); renderPlaces(); renderLibrary(); show(alt, { frame: true }); } }, 'Use it instead'));
  }
  panel.append(row);

  if (look.generated) { panel.append(...generatedSection(look)); updateGenInfo(look); }
  panel.append(...airSection(look, id));

  panel.append(el('h3', { text: 'Body' }));
  for (const d of lookControls(look, id)) panel.append(control(d, look, null, ''));

  // drawn behind (the Death Star II over Endor)
  panel.append(el('h3', { text: 'Drawn behind (preview only)' }));
  panel.append(el('p', { class: 'note', text: 'Another look drawn behind this one on the close-up stage. At a place, every body of the zone stands where its own place puts it.' }));
  const over = look.adjust.over;
  const sel = el('select');
  sel.append(el('option', { value: '', text: '(nothing)' }));
  for (const [oid, l] of Object.entries(state.looks)) if (oid !== id) sel.append(el('option', { value: oid, text: l.name }));
  sel.value = over?.look || '';
  sel.addEventListener('change', () => {
    look.adjust.over = sel.value ? { x: -2.6, y: -3.4, z: -9, size: 4.5, ...(look.adjust.over || {}), look: sel.value } : null;
    setDirty(true);
    rebuildSoon();
    renderInspectorSoon();
  });
  panel.append(el('div', { class: 'ctl', title: 'Another look drawn behind this one, as a place shows them together' }, el('span', { text: 'Look' }), sel, el('span')));
  if (over) {
    for (const d of [
      { k: 'adjust.over.x', label: 'Across', type: 'range', min: -20, max: 20, step: 0.1 },
      { k: 'adjust.over.y', label: 'Up', type: 'range', min: -20, max: 20, step: 0.1 },
      { k: 'adjust.over.z', label: 'Back', type: 'range', min: -60, max: 5, step: 0.1 },
      { k: 'adjust.over.size', label: 'Its size', type: 'range', min: 0.1, max: 20, step: 0.05 },
    ]) panel.append(control(d, look, null, ''));
  }

  panel.append(el('h3', { text: 'Layers' }));
  let slots = look.kind === 'sheet' ? ['surface'] : look.kind === 'sphere' ? SLOTS.filter((s) => s !== 'overlay') : SLOTS;
  // a generated look has night lights only where its recipe makes something glow
  if (look.generated && !glowKind(look.generated)) slots = slots.filter((s) => s !== 'night');
  for (const s of slots) panel.append(layerSection(s, look));
  panel.scrollTop = scroll;
}

/**
 * (the atmosphere brief's wave A) A look's Air setting and, Scattered, its air's dials (airProfile.js): live, each with
 * a reset (to the default's, else its kind's start) and a step of the undo history. A look that has never had one is
 * Painted, as it always drew; choosing Scattered writes its kind's starting air into it.
 */
function airSection(look, id) {
  const det = el('details', { class: 'sub', open: !state.closedGroups.has('air') });
  det.addEventListener('toggle', () => { if (det.open) state.closedGroups.delete('air'); else state.closedGroups.add('air'); });
  det.append(el('summary', { text: 'Air and light' }));
  const sphere = look.kind === 'sphere' && !look.generated?.shape;
  const own = look.air?.mode || 'painted';
  const drawn = airModeOf({ ...look, air: look.air });
  const def = defaultsCache()[id];
  const kindStart = look.generated ? airStartFor(look.generated.recipe, look.generated.dials, { shaped: !!look.generated.shape }) : { mode: 'scattered' };
  const base = cleanAir({ ...(def?.air || kindStart), mode: 'scattered' });
  const from = def?.air ? 'the default' : 'its kind\'s start';
  const all = state.viewer.airAll;
  det.append(el('p', { class: 'note', text: sphere
    ? `Scattered draws the air itself: a thin limb that glows where the sun lights it and fades across the terminator, the haze over the disc, the sun reaching the ground through it (reddened toward the terminator, the night side dark), clouds lit as clouds with their shadows, the glint on water. Painted draws the look's own rim or halo as before; None, no air. Drawn now: ${drawn}${all !== 'own' ? ` (the Air choice over the stage says "${(AIR_ALL.find(([k]) => k === all) || [all, `${all} for all`])[1]}")` : ''}.`
    : `This look's light is painted in (a dome or a sheet${look.generated?.shape ? ', or a shaped body' : ''}): its air is Painted or None in this wave. Drawn now: ${drawn}.` }));
  const modes = sphere ? AIR_MODES : AIR_MODES.filter(([m]) => m !== 'scattered');
  det.append(control({
    k: 'air.mode', label: 'Air', type: 'select', options: modes, struct: true, unset: 'painted',
    reset: def?.air?.mode || 'painted', resetFrom: def?.air ? 'the default' : 'its start (as it always drew)',
    title: 'Scattered: real air and light (airProfile.js). Painted: the look\'s own rim or halo, as it drew before. None: no air at all',
    after: (v) => {
      // first Scattered: the kind's starting air, written in so what is shown is what is drawn
      if (v === 'scattered' && look.air) for (const [k, val] of Object.entries(base)) if (k !== 'mode' && look.air[k] === undefined) look.air[k] = val;
      // (the atmosphere brief's wave B) back to Painted on a look whose default has no air (his own looks, and any look
      // made before the air came): Painted is the look as it always was, so no air block is left behind and the look
      // is written, and printed, exactly as before; the dials it had come back with an undo
      if (v === 'painted' && !def?.air && look.air) delete look.air;
    },
  }, look, null, ''));
  if (sphere && (own === 'scattered' || drawn === 'scattered')) {
    const cur = state.current?.look === look ? airInfo(state.current) : null;
    if (cur?.steps) det.append(el('p', { class: 'note gen-info', text: `The march: ${cur.steps} steps (the Air quality over the stage)${cur.tablesMs ? `; its tables made in ${cur.tablesMs.toFixed(0)} ms` : ''}. Units are the game's air record's: km, and per km.` }));
    for (const [g, title, note] of [['air', 'The air', 'Its numbers are the game\'s air record\'s, starting from Hillaire\'s Earth with a clear day of 40 km; the tables follow a moment after a dial stops.'], ['light', 'The light on it', 'What the light does at the surface and on the clouds.']]) {
      det.append(el('h4', { text: title }));
      det.append(el('p', { class: 'note', text: note }));
      for (const d of AIR_DIALS.filter((x) => x.group === g)) det.append(control({ ...d, k: 'air.' + d.k, unset: cleanAir(airOf(look))[d.k], reset: base[d.k], resetFrom: from }, look, null, ''));
    }
  }
  return [det];
}

function duplicateLook() {
  const id = state.currentId;
  const src = state.looks[id];
  let n = 1;
  while (state.looks['my-' + n]) n++;
  const nid = 'my-' + n;
  const copy = makeLook(JSON.parse(JSON.stringify({ ...src, _errors: undefined })));
  copy.name = src.name + ' (copy)';
  copy.group = 'Your own';
  state.looks[nid] = copy;
  noteMade(nid);
  setDirty(true);
  renderLibrary();
  renderPlaces();
  show(nid);
}

function deleteLook(id) {
  if (!confirm(`Delete "${state.looks[id].name}"?`)) return;
  delete state.looks[id];
  for (const [k, v] of Object.entries(state.uses)) if (v === id) state.uses[k] = null;
  setDirty(true);
  renderLibrary();
  renderPlaces();
  show('naboo', { frame: true });
}

// ---------------------------------------------------------------------------------------------
// places

function lookSelect(value, onPick) {
  const sel = el('select');
  sel.append(el('option', { value: '', text: '(unassigned)' }));
  const groups = new Map();
  for (const [id, l] of Object.entries(state.looks)) {
    const g = GROUPS.includes(l.group) ? l.group : 'Your own';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push([id, l.name]);
  }
  for (const g of GROUPS) {
    if (!groups.has(g)) continue;
    const og = el('optgroup', { label: g });
    for (const [id, name] of groups.get(g)) og.append(el('option', { value: id, text: name }));
    sel.append(og);
  }
  sel.value = value || '';
  if (value && sel.value !== value) { sel.append(el('option', { value, text: value + ' (missing look)' })); sel.value = value; }
  sel.addEventListener('change', () => onPick(sel.value || null));
  return sel;
}

let placesFilter = '';
function renderPlaces() {
  const panel = $('placesPanel');
  const scroll = panel.scrollTop;
  panel.textContent = '';
  panel.append(el('p', { class: 'note', text: 'Every place in the game\'s skies and space zones (from the survey\'s skybodies.txt), and the look each uses. A place is where the game shows a body; a look is what the body is. A place may point at any look: that is a stand-in. "View" shows the place where it will be, with its own settings (Place tab). Saved with the looks.' }));
  const search = el('input', { type: 'search', placeholder: 'Filter places, e.g. naboo or moon', value: placesFilter });
  search.addEventListener('input', () => { placesFilter = search.value; renderPlacesList(list); });
  panel.append(search);
  panel.append(addPlacesBox());
  const list = el('div');
  panel.append(list);
  renderPlacesList(list);
  panel.scrollTop = scroll;
}

// ---------------------------------------------------------------------------------------------
// places and zones of the owner's own (wave 2): saved in the file of choices under `added` (a file
// without it loads exactly as before). Each carries a lore line; one added from the lore list
// (missing.js, read only, never saved) shows that entry's whole lore. Adding and removing are undo steps.

const ADDED_ID = /^[a-z0-9_]+(:[a-z0-9_#-]+)+$/;
const txt = (v, n = 600) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const numOr = (v) => (v === undefined || v === null || v === '' || !Number.isFinite(+v) ? undefined : +v);
function cleanAdded(raw) {
  const out = { zones: {}, places: [] };
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, z] of Object.entries(raw.zones || {})) {
    if (!/^space_[a-z0-9_]+$/.test(id) || !z || typeof z !== 'object') continue;
    out.zones[id] = { title: txt(z.title, 80) || worldName(id.replace(/^space_/, '')), lore: txt(z.lore), loreId: txt(z.loreId, 120) };
    if (typeof z.sunFrom === 'string') out.zones[id].sunFrom = txt(z.sunFrom, 120);
  }
  const seen = new Set();
  for (const p of Array.isArray(raw.places) ? raw.places : []) {
    if (!p || typeof p !== 'object' || !ADDED_ID.test(p.id || '') || seen.has(p.id)) continue;
    const zone = p.id.split(':')[0];
    const s = p.start || {};
    const start = {};
    for (const k of ['size', 'yaw', 'pitch', 'distance', 'azimuth', 'elevation']) { const v = numOr(s[k]); if (v !== undefined) start[k] = v; }
    if (['world-sun', 'zone-sun', 'fixed', 'painted'].includes(s.light)) start.light = s.light;
    seen.add(p.id);
    out.places.push({ id: p.id, zone, what: txt(p.what, 120) || p.id, kind: zone.startsWith('space_') ? 'body' : 'celestial', start, lore: txt(p.lore), loreId: txt(p.loreId, 120) });
  }
  return out;
}
/** The lore of a place of the owner's own: its lore-list entry in full, else its own line; null for none. */
function addedLore(p) {
  const own = p.added ? state.added.places.find((q) => q.id === p.id) : null;
  if (!own) return null;
  const e = own.loreId ? (state.missing || []).find((m) => m.id === own.loreId) : null;
  if (e) {
    const sources = (Array.isArray(e.sources) ? e.sources : []).map((s) => ({ title: txt(s?.title, 200), url: /^https:\/\/[^\s"'<>]+$/.test(s?.url || '') ? s.url : '' })).filter((s) => s.title || s.url);
    return { name: txt(e.name, 200), kind: txt(e.kind, 200), orbits: txt(e.orbits, 400), lore: txt(e.lore, 4000), look: txt(e.look, 2000), continuity: txt(e.continuity, 400), confidence: txt(e.confidence, 200), why: txt(e.why, 2000), sources };
  }
  return own.lore ? { name: own.what, kind: '', orbits: '', lore: own.lore, look: '', continuity: 'ours', confidence: '', why: '', sources: [] } : null;
}
const addedSky = (id, title) => ({
  id, space: true, title, planet: null, sunElev: 67.5, starCount: 0, nightSky: null,
  slots: { sun: null, sun2: null, moon: null, moon2: null }, cels: [], stars: [], bodies: [], lines: {}, added: true,
});

/** The lore list (missing.js): read once, never saved; missing or broken, the list is simply empty. */
async function loadMissing() {
  try {
    const mod = await import('../src/sky/look/missing.js');
    state.missing = (Array.isArray(mod.MISSING) ? mod.MISSING : []).filter((e) => e && typeof e.id === 'string' && e.placement?.start);
  } catch (e) {
    state.missing = [];
    console.log(`[viewer] lore list: none (missing.js could not be read: ${e.message})`);
  }
}
/** What one lore-list entry would add: its zone, the place's id, and whether this page can add it. */
function missingPlan(e) {
  const m = e.id.match(/^new:([a-z0-9_]+):([a-z0-9_]+)$/);
  if (!m) return { ok: false, why: 'its id is not a place' };
  const [, zone, name] = m;
  const s = e.placement.start;
  if (s.kind === 'zone-sun') return { ok: true, zone, sun: true, id: null };
  if (s.slot || s.kind === 'star') return { ok: false, zone, why: s.slot ? `it takes the sky's ${s.slot} slot, which a place added here cannot` : 'a star of the zone is not a body a place added here can be' };
  return { ok: true, zone, id: `${zone}:${name}` };
}
const loreAdded = (plan) => (plan.sun ? !!state.zoneEdits[plan.zone]?.sun && state.added.zones[plan.zone]?.sunFrom !== undefined : !!plan.id && state.added.places.some((p) => p.id === plan.id));

function addZone(id, title, lore, loreId = '') {
  if (!state.added.zones[id] && !state.skies.has(id)) state.added.zones[id] = { title: txt(title, 80) || worldName(id.replace(/^space_/, '')), lore: txt(lore), loreId };
}
function addPlace(p, look = '') {
  state.added.places = state.added.places.filter((q) => q.id !== p.id);
  state.added.places.push(p);
  if (look) state.uses[p.id] = look;
  afterAdding(p.id);
}
function afterAdding(selectId = null) {
  makePlaces();
  setDirty(true);
  renderPlaces();
  renderLibrary();
  if (selectId && state.placesById.has(selectId)) selectPlace(selectId);
}
function removeAdded(id) {
  state.added.places = state.added.places.filter((q) => q.id !== id);
  delete state.uses[id];
  delete state.placeEdits[id];
  const zone = id.split(':')[0];
  if (state.added.zones[zone] && !state.added.places.some((q) => q.zone === zone)) { delete state.added.zones[zone]; delete state.zoneEdits[zone]; }
  makePlaces();
  setDirty(true);
  renderPlaces();
}
function addFromLore(e) {
  const plan = missingPlan(e);
  if (!plan.ok) return;
  const s = e.placement.start;
  if (plan.zone.startsWith('space_')) addZone(plan.zone, worldName(plan.zone.replace(/^space_/, '')), '', '');
  if (plan.sun) {
    // the zone's light and star (Priate): the zone's sun, set where the entry suggests
    state.zoneEdits[plan.zone] = { ...(state.zoneEdits[plan.zone] || {}), sun: { ...(state.zoneEdits[plan.zone]?.sun || {}), yaw: s.yaw, pitch: s.pitch } };
    if (state.added.zones[plan.zone]) state.added.zones[plan.zone].sunFrom = e.id;
    afterAdding();
    setStatus(`${e.name}: the sun of ${plan.zone}, at yaw ${s.yaw}, pitch ${s.pitch} (the zone's sun on the Place tab).`);
    return;
  }
  const space = plan.zone.startsWith('space_');
  const start = space ? { size: s.size, yaw: s.yaw, pitch: s.pitch, distance: s.distance } : { size: s.size, yaw: s.yaw, pitch: s.pitch, ...(s.light ? { light: s.light } : {}) };
  addPlace({ id: plan.id, zone: plan.zone, what: e.name, kind: space ? 'body' : 'celestial', start, lore: txt(e.lore), loreId: e.id }, LORE_LOOKS[e.id] && state.looks[LORE_LOOKS[e.id]] ? LORE_LOOKS[e.id] : '');
}
// wave 5: a lore entry added with a look ready for it (the Maw: the Maelstrom's one preset)
const LORE_LOOKS = { 'new:space_light1:the_maw': 'generated:v-maelstrom' };

function addPlacesBox() {
  const box = el('details', { class: 'sub add-places', open: !!state.openGroups?.has('addPlaces') });
  box.addEventListener('toggle', () => { state.openGroups ||= new Set(); if (box.open) state.openGroups.add('addPlaces'); else state.openGroups.delete('addPlaces'); });
  const nZ = Object.keys(state.added.zones).length, nP = state.added.places.length;
  box.append(el('summary', { text: `Add your own places${nZ || nP ? ` (${nP} added${nZ ? `, ${nZ} new zone${nZ > 1 ? 's' : ''}` : ''})` : ''}` }));
  box.append(el('p', { class: 'note', text: 'A new space zone, or a body, belt or ring in any ground sky or zone (its look says which), each with a line of lore. Added places are saved in the file of choices; their size, place and light are on the Place tab like any other. Space zones are set pieces in the game: this is design data for later.' }));
  const field = (label, input) => el('div', { class: 'ctl' }, el('span', { text: label }), input, el('span'), el('span'));

  box.append(el('h4', { text: 'A space zone' }));
  const zid = el('input', { type: 'text', placeholder: 'mustafar (becomes space_mustafar)', 'aria-label': 'Zone name' });
  const ztitle = el('input', { type: 'text', placeholder: 'Mustafar', 'aria-label': 'Zone title' });
  const zlore = el('input', { type: 'text', placeholder: 'A line of lore', 'aria-label': 'Zone lore' });
  box.append(field('Zone', zid), field('Title', ztitle), field('Lore', zlore));
  box.append(el('button', { type: 'button', class: 'small', onclick: () => {
    const id = 'space_' + zid.value.trim().toLowerCase().replace(/^space_/, '').replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (id === 'space_') { setStatus('Give the zone a name first', true); return; }
    if (state.skies.has(id)) { setStatus(`${id} is there already`, true); return; }
    addZone(id, ztitle.value, zlore.value);
    afterAdding();
    setStatus(`${id} added: add its bodies below (or from the lore list).`);
  } }, 'Add the zone'));

  box.append(el('h4', { text: 'A body, belt or ring' }));
  const zsel = el('select', { 'aria-label': 'In which sky or zone' });
  const zones = [...state.skies.keys()].sort((a, b) => (b.startsWith('space_') - a.startsWith('space_')) || a.localeCompare(b));
  for (const z of zones) zsel.append(el('option', { value: z, text: z + (state.skies.get(z)?.added ? ' (yours)' : '') }));
  const pname = el('input', { type: 'text', placeholder: 'Nur, an ocean moon', 'aria-label': 'Its name' });
  const plook = lookSelect('', () => {});
  const plore = el('input', { type: 'text', placeholder: 'A line of lore', 'aria-label': 'Its lore' });
  box.append(field('In', zsel), field('Name', pname), field('Look', plook), field('Lore', plore));
  box.append(el('button', { type: 'button', class: 'small', onclick: () => {
    const zone = zsel.value;
    const what = pname.value.trim();
    if (!what) { setStatus('Give it a name first', true); return; }
    let id = `${zone}:${what.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'body'}`;
    for (let n = 2; state.placesById.has(id); n++) id = id.replace(/#\d+$/, '') + '#' + n;
    const space = zone.startsWith('space_');
    addPlace({ id, zone, what, kind: space ? 'body' : 'celestial', start: space ? { size: 8, yaw: 20, pitch: 15, distance: 1500 } : { size: 6, yaw: 30, pitch: 30 }, lore: txt(plore.value), loreId: '' }, plook.value);
  } }, 'Add the place'));

  // wave 5: a space volume as a zone's backdrop: far behind the zone's bodies and wide; its place, size
  // and light are then on the Place tab like any other (near a planet: add it as a place above instead)
  box.append(el('h4', { text: 'A space volume as a zone\'s backdrop' }));
  const bzone = el('select', { 'aria-label': 'Which zone' });
  for (const z of zones.filter((z) => z.startsWith('space_'))) bzone.append(el('option', { value: z, text: z + (state.skies.get(z)?.added ? ' (yours)' : '') }));
  const blook = el('select', { 'aria-label': 'Which volume' });
  for (const [id, l] of Object.entries(state.looks)) if (l.generated?.volume) blook.append(el('option', { value: id, text: l.name }));
  box.append(field('Zone', bzone), field('Volume', blook));
  box.append(el('button', { type: 'button', class: 'small', disabled: !blook.options.length, onclick: () => {
    const zone = bzone.value;
    if (!zone || !blook.value) return;
    let id = `${zone}:backdrop`;
    for (let n = 2; state.placesById.has(id); n++) id = `${zone}:backdrop#${n}`;
    addPlace({ id, zone, what: `${state.looks[blook.value].name} (backdrop)`, kind: 'body', start: { size: 80, yaw: 200, pitch: 10, distance: 200000 }, lore: '', loreId: '' }, blook.value);
    setStatus(`${id}: ${state.looks[blook.value].name} behind the zone, 80° wide; move it on the Place tab.`);
  } }, 'Add the backdrop'));

  box.append(el('h4', { text: 'Add from the lore list' }));
  if (!state.missing?.length) box.append(el('p', { class: 'note', text: 'No lore list here (missing.js).' }));
  else {
    box.append(el('p', { class: 'note', text: 'Bodies the lore gives that SWG\'s skies and zones do not show, each checked against its sources, with a suggested place (ours: the lore gives none). One click adds one there.' }));
    for (const e of state.missing) {
      const plan = missingPlan(e);
      const done = plan.ok && loreAdded(plan);
      const row = el('div', { class: 'place lore-add' + (done ? ' current' : '') });
      row.append(el('span', { class: 'id' }, el('strong', { text: e.name }), el('span', { class: 'what', text: `${e.kind} · ${plan.sun ? `the sun of ${plan.zone}` : plan.id || plan.zone}${plan.ok ? '' : ` · not here: ${plan.why}`}` })));
      row.append(el('button', { type: 'button', class: 'small', disabled: !plan.ok || done, title: e.placement.words || '', onclick: () => addFromLore(e) }, done ? 'Added' : 'Add'));
      box.append(row);
    }
  }
  return box;
}

function renderPlacesList(list) {
  list.textContent = '';
  const q = placesFilter.trim().toLowerCase();
  const zones = new Map();
  for (const p of state.places) {
    const lookName = state.looks[state.uses[p.id]]?.name || '';
    if (q && !`${p.id} ${p.what} ${lookName} ${searchText(loreFor(state.lore, p.id))}`.toLowerCase().includes(q)) continue;
    const z = p.zone;
    if (!zones.has(z)) zones.set(z, []);
    zones.get(z).push(p);
  }
  const zoneRank = (z) => (z.startsWith('space_') ? 0 : MAIN_WORLDS.includes(z) || EXTRA_PLACES.some((e) => e.zone === z) ? 1 : 2);
  const ordered = [...zones.keys()].sort((a, b) => zoneRank(a) - zoneRank(b) || a.localeCompare(b));
  const heads = ['Space zones', 'Ground skies', 'Other skies (tests and sub-zones)'];
  let shown = -1;
  let holder = list;
  for (const z of ordered) {
    const rank = zoneRank(z);
    if (rank !== shown) {
      shown = rank;
      if (rank === 2) {
        holder = el('details', { open: !!q });
        holder.append(el('summary', { class: 'subhead', text: heads[2] }));
        list.append(holder);
      } else {
        list.append(el('h3', { text: heads[rank] }));
        holder = list;
      }
    }
    const places = zones.get(z);
    const assigned = places.filter((p) => state.uses[p.id]).length;
    const det = el('details', { class: 'places-zone', open: rank < 2 || !!q });
    det.append(el('summary', {}, el('span', { text: z }), el('span', { class: 'n', text: `${assigned} of ${places.length} assigned` })));
    for (const p of places) {
      const cur = state.uses[p.id] || null;
      const changed = !!state.placeEdits[p.id];
      const row = el('div', { class: 'place' + (cur ? '' : ' unassigned') + (p.id === state.placeId && state.mode === 'place' ? ' current' : '') });
      const ln = loreName(p.id);
      row.append(el('span', { class: 'id' }, p.id, ln ? el('span', { class: 'lore-name', title: 'Its name in the lore (lore.js)', text: ln }) : null, el('span', { class: 'what', text: (p.what || '') + (changed ? ' · own settings changed' : '') + (p.invented ? ' · not in SWG\'s files' : '') })));
      row.append(lookSelect(cur, (v) => {
        state.uses[p.id] = v;
        row.classList.toggle('unassigned', !v);
        setDirty(true);
        renderLibrary();
        if (v === state.currentId || cur === state.currentId) renderInspectorSoon();
        if (state.mode === 'place' && placeView.zone === p.zone) selectPlace(state.placeId, { rebuild: true, aim: false });
      }));
      row.append(el('button', { type: 'button', title: p.space ? 'View it in orbit, where it will be' : 'View it from the ground, where it will be', onclick: () => selectPlace(p.id) }, 'View'));
      if (p.added) row.append(el('button', { type: 'button', class: 'small', title: 'Remove this place of your own (and its settings)', onclick: () => removeAdded(p.id) }, 'Remove'));
      det.append(row);
    }
    holder.append(det);
  }
}

// ---------------------------------------------------------------------------------------------
// a place: where the game shows a body, seen where it will be, with its own settings

/** A space zone's converted sky.json (its light colour), fetched once, read only; null where there is none. */
async function zoneSky(zone) {
  if (state.zoneSky.has(zone)) return state.zoneSky.get(zone);
  let json = null;
  // (a zone of the owner's own has no converted sky: not asked for, so no failed fetch is logged)
  if (/^space_[a-z0-9_]+$/.test(zone) && !state.skies.get(zone)?.added) {
    try {
      const r = await fetch(`/pack/${zone}/sky.json`, { cache: 'no-store' });
      if (r.ok) json = await r.json();
    } catch { /* none: white light */ }
  }
  state.zoneSky.set(zone, json);
  return json;
}

/**
 * (the GPU port's pass 2, wave 4) A world's air asked for once, for "draw as the game does" from its ground (gameAir.ts: the
 * game's record, fit and tables from its converted sky, through the server's `/assets-private/`); a world with none, or one
 * of his own, keeps the plain view. (The old viewer read the world's colour ramp here; the air stands in its place.)
 */
async function worldAir(world) {
  if (state.ramps.has(world)) return null;
  state.ramps.set(world, null);
  if (gameLook && /^[a-z0-9_]+$/.test(world) && !world.startsWith('space_') && !state.skies.get(world)?.added) gameLook.useWorld(world);
  return null;
}

/** Wave 4: the place in orbit that is the world we stand on (its space zone's planet of the same name). */
function worldPlaceOf(world) {
  const base = String(world).replace(/_main$/, '');
  const id = `space_${base}:planet_${base}`;
  if (state.placesById.has(id)) return id;
  const p = state.places.find((q) => q.zone === `space_${base}` && /:planet_/.test(q.id) && q.id.includes(base));
  return p ? p.id : null;
}

/** Wave 4: the viewer's switches as the state has them (on load, on undo, on a click). */
function applyViewer() {
  const v = state.viewer;
  if ($('gameLook')) $('gameLook').checked = v.gameLook;
  if ($('thunder')) $('thunder').checked = v.thunder;
  if ($('thunderVol')) { $('thunderVol').value = v.thunderVolume; $('thunderVolReset').disabled = Math.abs(v.thunderVolume - VIEWER_DEFAULTS.thunderVolume) < 1e-6; }
  if ($('volQuality')) { $('volQuality').value = v.volumes; $('volQualityReset').disabled = v.volumes === VIEWER_DEFAULTS.volumes; }
  setVolumeQuality(v.volumes);
  showVolumeTier();
  // (wave A) the air: every look's form at once for a comparison, and the march's quality; a change builds what is on show again
  if ($('airAll')) { $('airAll').value = v.airAll; $('airAllReset').disabled = v.airAll === VIEWER_DEFAULTS.airAll; }
  if ($('airQuality')) { $('airQuality').value = v.airQuality; $('airQualityReset').disabled = v.airQuality === VIEWER_DEFAULTS.airQuality; }
  setAirChoice({ all: v.airAll, quality: v.airQuality });
  // (wave B) the day wash: on or off (?wash=0 holds it off until the box is ticked) and its numbers, live
  if (placeView) {
    placeView.wash = v.wash && !placeView.washUrlOff;
    const W = placeView.washNumbers;
    W.inFront = v.washFront; W.thick = v.washThick; W.dayDim = v.washDim; W.sun = v.washSun;
  }
  if ($('washOn')) {
    $('washOn').checked = v.wash && !placeView?.washUrlOff;
    $('washOnReset').disabled = v.wash === VIEWER_DEFAULTS.wash && !placeView?.washUrlOff;
    for (const [k, , , , step] of WASH_DIALS) {
      $(k).value = v[k];
      $(k + 'Out').textContent = (+v[k]).toFixed(step < 0.1 ? 2 : 1);
      $(k + 'Reset').disabled = Math.abs(v[k] - VIEWER_DEFAULTS[k]) < 1e-9;
    }
    $('washBox').classList.toggle('off', !(v.wash && !placeView?.washUrlOff));
  }
  const ak = `${v.airAll}|${v.airQuality}`;
  if (airShownKey && ak !== airShownKey) rebuildAll();
  airShownKey = ak;
  if (gameLook) {
    gameLook.setOn(v.gameLook);
    if (v.gameLook && state.mode === 'place') {
      const p = state.placesById.get(state.placeId);
      if (p && !p.space && !state.ramps.has(p.zone)) worldAir(p.zone);
    }
  }
  // sound can start only from a click; on load a saved "on" waits for the first one
  if (v.thunder && thunderArmed) thunder.setEnabled(true);
  else if (!v.thunder) thunder.setEnabled(false);
  thunder.setVolume(v.thunderVolume);
}
let thunderArmed = false;
let airShownKey = '';
/** (wave A) What is on show built again (the air's choice for all, or its quality, moved). */
let rebuildAllTimer = 0;
function rebuildAll() {
  clearTimeout(rebuildAllTimer);
  rebuildAllTimer = setTimeout(() => {
    if (state.mode === 'place' && state.placesById.has(state.placeId)) selectPlace(state.placeId, { rebuild: true, aim: false });
    else if (state.mode === 'look' && state.currentId) show(state.currentId);
    renderInspectorSoon();
  }, 60);
}

function setViewer(key, value) {
  state.viewer[key] = value;
  applyViewer();
  setDirty(true);
}

function wireWeather() {
  $('gameLook').addEventListener('change', () => setViewer('gameLook', $('gameLook').checked));
  $('thunder').addEventListener('change', () => { thunderArmed = true; setViewer('thunder', $('thunder').checked); });
  $('thunderVol').addEventListener('input', () => setViewer('thunderVolume', +$('thunderVol').value));
  $('thunderVolReset').addEventListener('click', () => setViewer('thunderVolume', VIEWER_DEFAULTS.thunderVolume));
  // wave 5: the space volumes' quality (a step of the history like the other switches)
  $('volQuality').addEventListener('change', () => setViewer('volumes', $('volQuality').value));
  $('volQualityReset').addEventListener('click', () => setViewer('volumes', VIEWER_DEFAULTS.volumes));
  // (wave A) the air's form for all looks at once and its quality (steps of the history like the other switches)
  if ($('airAll')) {
    $('airAll').addEventListener('change', () => setViewer('airAll', $('airAll').value));
    $('airAllReset').addEventListener('click', () => setViewer('airAll', VIEWER_DEFAULTS.airAll));
    $('airQuality').addEventListener('change', () => setViewer('airQuality', $('airQuality').value));
    $('airQualityReset').addEventListener('click', () => setViewer('airQuality', VIEWER_DEFAULTS.airQuality));
  }
  // (wave B) the day wash's box: on or off and its four numbers, live, each with its reset (a double-click resets too)
  // and a step of the history (a drag is one step)
  if ($('washOn')) {
    $('washOn').addEventListener('change', () => { if (placeView) placeView.washUrlOff = false; setViewer('wash', $('washOn').checked); });
    $('washOnReset').addEventListener('click', () => { if (placeView) placeView.washUrlOff = false; setViewer('wash', VIEWER_DEFAULTS.wash); });
    for (const [k] of WASH_DIALS) {
      $(k).addEventListener('input', () => setViewer(k, +$(k).value));
      $(k).addEventListener('dblclick', () => setViewer(k, VIEWER_DEFAULTS[k]));
      $(k + 'Reset').addEventListener('click', () => setViewer(k, VIEWER_DEFAULTS[k]));
    }
  }
  addEventListener('pointerdown', () => { if (!thunderArmed) { thunderArmed = true; if (state.viewer.thunder) thunder.setEnabled(true); } }, { capture: true });
  // the thunder: in orbit and on the preview a flash on the side facing us gives a faint rumble; from the
  // ground only the ground's own storm is near enough (a moon's storms are a world away)
  setFlashListener((built, x, y, z, peak) => {
    if (!thunder.enabled) return;
    if (state.mode === 'place' && !placeView.space) return;
    if (!built.root.visible || (built.root.parent && !built.root.parent.visible)) return;
    // (a volume's flashes are inside its gas, seen from any side)
    if (built.look.kind !== 'dome' && !built.vol) {
      _fv.set(x, y, z).transformDirection(built.cloudSpin.matrixWorld);
      built.root.getWorldPosition(_fp);
      _fc.copy(S.camera.position).sub(_fp).normalize();
      if (_fv.dot(_fc) < 0.15) return;
    }
    thunder.strike({ inSpace: true, strength: peak });
  });
  // (the look tuner's pass) from the side the flash was on, as the view faced when it flashed (a little)
  placeView.onThunder = (km, strength, x, y, z) => {
    if (!thunder.enabled) return;
    S.camera.getWorldDirection(_fv);
    const h = Math.sqrt(x * x + z * z) || 1, fh = Math.sqrt(_fv.x * _fv.x + _fv.z * _fv.z) || 1;
    thunder.strike({ distanceKm: km, strength, pan: 0.6 * ((x / h) * (-_fv.z / fh) + (z / h) * (_fv.x / fh)) });
  };
  applyViewer();
}
const _fv = new THREE.Vector3(), _fp = new THREE.Vector3(), _fc = new THREE.Vector3();

const zoneSunSwg = (zone) => zoneSunDefaults(state.skies.get(zone), state.zoneSky.get(zone));
function zoneSun(zone) {
  const swg = zoneSunSwg(zone);
  return { ...swg, ...(state.zoneEdits[zone]?.sun || {}) };
}

/** Open a place where it will be: in orbit over its zone, or from its world's ground. */
async function selectPlace(id, { rebuild = false, aim = true } = {}) {
  const p = state.placesById.get(id);
  if (!p) return;
  const token = ++state.build;
  if (state.mode === 'system') leaveSystemView('place');
  // a preview of a system lasts while one of its own skies is shown (a rebuild of the sky on show is not leaving it)
  if (state.preview && state.preview !== systemIdOf(p.zone) && !rebuild) state.preview = null;
  const zoneChanged = placeView.zone !== p.zone;
  state.placeId = id;
  state.mode = 'place';
  state.pick = null;
  if (state.uses[id] && state.looks[state.uses[id]]) state.currentId = placeLookId(id) || state.uses[id];
  if (state.current) state.current.root.visible = false;
  if (state.compare) state.compare.root.visible = false;
  state.backdropHolder.visible = false;
  window.__viewerReady = null;
  delete document.documentElement.dataset.ready;
  if (aim && !p.space && !skyFollows(p.zone)) {
    // from the ground, choose an hour when the chosen body is in the sky if it is not now
    const now = placeDirection(p, effective(p, state.placeEdits), dayAt(state.hours));
    if (!now.shown) {
      if (p.kind === 'sun' || p.kind === 'sun2') state.hours = 14.4;
      else if (p.kind === 'moon' || p.kind === 'moon2') state.hours = 2.4;
    }
  }
  if (p.space) await zoneSky(p.zone);
  else if (state.viewer.gameLook) await worldAir(p.zone);
  if (token !== state.build) return;
  updatePlaceBar();
  showTab('place');
  renderPlacePanel();
  renderInspector();
  markLibrary();
  renderPlaces();
  setStatus(zoneChanged || rebuild ? `Building ${p.space ? 'the zone' : 'the sky'}: ${p.zone}` : '');
  const sky = state.skies.get(p.zone);
  const ctx = {
    lookOf: (pid) => { const lid = placeLookId(pid); return lid ? { id: lid, look: state.looks[lid] } : null; },
    effective: (place) => effective(place, state.placeEdits),
    zoneSun: (zone) => zoneSun(zone),
    hours: () => state.hours,
    starsOn: () => $('stars').checked,
    // under the world's system (applied, or previewed): the model at this moment
    sky: () => skyNow(p.zone),
    // a place standing for a star of a version 2 system (drawn as a sun even where SWG's slot has no picture)
    systemStar: (pid) => { const c = skyModel(p.zone); const j = c?.v2 ? c.model.itemOf.get(pid) : undefined; return j !== undefined && !!c.model.itemStar[j]; },
    onStatus: (m) => token === state.build && setStatus(m),
    // wave 4: the zone's sky file (its lights), and the look of the world we stand on (its clouds' storm cells light our
    // sky); (the GPU port's pass 2, wave 4) a world's sky drawn as the game does is its air's, gameAir.ts's, no ramp
    zoneSky: (zone) => state.zoneSky.get(zone) || null,
    worldLook: () => { const lid = worldPlace ? state.uses[worldPlace] : null; return lid ? state.looks[lid] || null : null; },
  };
  const worldPlace = p.space ? null : worldPlaceOf(p.zone);
  const places = [...state.places.filter((q) => q.zone === p.zone), ...(p.space ? [] : systemPlaces(p.zone))];
  state.skyItemsKey = p.space ? '' : skyItemsKey(p.zone);
  const lookOfPlace = ctx.lookOf;
  ctx.lookOf = (pid) => { const sp = places.find((q) => q.id === pid && q.systemBody); if (!sp) return lookOfPlace(pid); return sp.lookId && state.looks[sp.lookId] ? { id: sp.lookId, look: state.looks[sp.lookId] } : null; };
  const effOf = ctx.effective;
  ctx.effective = (place) => (place.systemBody ? place.swg : effOf(place));
  const sun = p.space ? zoneSunSwg(p.zone) : null;
  let ok;
  try {
    ok = await placeView.open({ zone: p.zone, space: p.space, places, stars: sun ? { groups: sun.groups, sunGroup: sun.sunGroup } : null, selected: id, ctx, rebuild, aim });
  } catch (e) {
    console.error(e);
    if (token === state.build) setStatus(`Could not build ${p.zone}: ${e.message}`, true);
    return;
  }
  if (!ok || token !== state.build) return;
  placeView.frame(state.clock);
  try { await S.renderer.compileAsync(S.scene, S.camera); } catch (e) { console.warn('[viewer] compile:', e); }
  if (token !== state.build) return;
  const errs = [];
  for (const b of placeView.bodies) {
    if (b.error) errs.push(`${b.place.id}: ${b.error}`);
    if (b.look?._errors?.length) errs.push(...b.look._errors);
  }
  state.lastErrors = [...new Set(errs)];
  setStatus(state.lastErrors.length ? 'Missing: ' + state.lastErrors.join(' · ') : '', !!state.lastErrors.length);
  updatePlaceBar();
  state.readyAt = state.frames + 4;
}

// ---- the owner's changes to a place: only what differs from SWG's is kept ----

const same = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : a === b);

function setPlaceEdit(p, field, value) {
  const e = (state.placeEdits[p.id] ||= {});
  if (same(value, p.swg[field])) delete e[field];
  else e[field] = value;
  if (!Object.keys(e).length) delete state.placeEdits[p.id];
  setDirty(true);
}
function setPlaceLightEdit(p, key, value) {
  const e = (state.placeEdits[p.id] ||= {});
  const l = (e.light ||= {});
  if (same(value, p.swg.light[key])) delete l[key];
  else l[key] = value;
  if (!Object.keys(l).length) delete e.light;
  if (!Object.keys(e).length) delete state.placeEdits[p.id];
  setDirty(true);
}
/** The Light row's "SWG's": the whole light back, its source and any fixed angle with it. */
function clearPlaceLight(p) {
  const e = state.placeEdits[p.id];
  if (!e || !e.light) return;
  delete e.light;
  if (!Object.keys(e).length) delete state.placeEdits[p.id];
  setDirty(true);
}
function setZoneSunEdit(zone, key, value) {
  const swg = zoneSunSwg(zone);
  const z = (state.zoneEdits[zone] ||= { sun: {} });
  if (same(value, swg[key])) delete z.sun[key];
  else z.sun[key] = value;
  if (!Object.keys(z.sun).length) delete state.zoneEdits[zone];
  setDirty(true);
}

/** One setting: a slider, its value, and a button back to SWG's value (lit while it differs). */
// Beside "SWG's" each place setting has a reset (↺) back to its value as last loaded or saved:
// `saved` that value, `onSet` setting it (the row's own setter).
function savedButton(saved, current, step, unit, onBack) {
  return resetButton({ value: saved, from: 'as saved' }, current, () => { onBack(saved); renderPlacePanel(); renderPlaces(); refreshWordsSoon(); });
}

function settingRow({ label, value, swgValue, savedValue, min, max, step, unit = '', from, changed, onSet, onReset, title }) {
  const input = el('input', { type: 'range', min, max, step });
  input.value = value;
  const out = el('output', { text: fmt(value, step) + unit });
  const swgText = swgValue === null || swgValue === undefined ? '' : fmt(swgValue, step) + unit;
  const reset = el('button', { type: 'button', class: 'small swg' + (changed ? ' changed' : ''), title: `Back to SWG's: ${swgText}${from ? ' (' + from + ')' : ''}` }, 'SWG\'s');
  reset.disabled = !changed;
  const back = savedValue === undefined ? el('span') : savedButton(savedValue, value, step, unit, onSet);
  input.addEventListener('input', () => {
    out.textContent = fmt(input.value, step) + unit;
    onSet(+input.value);
    const now = !same(+input.value, swgValue);
    reset.disabled = !now;
    reset.classList.toggle('changed', now);
    if (back.tagName === 'BUTTON') back.disabled = sameValue(+input.value, savedValue);
    refreshWordsSoon();
  });
  reset.addEventListener('click', () => { onReset(); renderPlacePanel(); renderPlaces(); });
  return el('div', { class: 'ctl pctl', title: title || '' }, el('span', { text: label, title: title || label }), input, out, reset, back);
}

function colourRow({ label, value, swgValue, savedValue, from, changed, onSet, onReset }) {
  const picker = el('input', { type: 'color' });
  picker.value = value;
  const code = el('code', { text: value });
  const reset = el('button', { type: 'button', class: 'small swg' + (changed ? ' changed' : ''), title: `Back to SWG's: ${swgValue}${from ? ' (' + from + ')' : ''}` }, 'SWG\'s');
  reset.disabled = !changed;
  const back = savedValue === undefined ? el('span') : savedButton(savedValue, value, 0, '', onSet);
  picker.addEventListener('input', () => {
    code.textContent = picker.value;
    onSet(picker.value);
    reset.disabled = picker.value.toLowerCase() === String(swgValue).toLowerCase();
    reset.classList.toggle('changed', !reset.disabled);
    if (back.tagName === 'BUTTON') back.disabled = sameValue(picker.value, savedValue);
    refreshWordsSoon();
  });
  reset.addEventListener('click', () => { onReset(); renderPlacePanel(); });
  return el('div', { class: 'ctl pctl' }, el('span', { text: label }), el('div', { class: 'colorline' }, picker, code), el('span'), reset, back);
}

const LIGHT_NAMES = {
  'world-sun': 'the world\'s moving sun',
  'zone-sun': 'the zone\'s sun',
  fixed: 'a fixed angle you set',
  painted: 'painted in (the look\'s own)',
};

function renderPlacePanel() {
  const panel = $('placePanel');
  if (!panel) return;
  const scroll = panel.scrollTop;
  panel.textContent = '';
  const p = state.mode === 'place' ? state.placesById.get(state.placeId) : null;
  if (!p) {
    panel.append(el('p', { class: 'note', text: 'No place is open. A place is where the game shows a body: a space zone\'s planet or moon, or a ground sky\'s sun, moon or extra body. Open one with "View" in All places, or "View there" on a look\'s page, and it is shown where it will be, with its own settings here.' }));
    return;
  }
  const e = effective(p, state.placeEdits);
  const edits = state.placeEdits[p.id] || {};
  panel.append(el('div', { class: 'place-head' }, el('strong', { text: p.label }), el('code', { text: p.id })));

  const words = placeWords(p);
  const box = el('div', { class: 'words' });
  box.append(el('h4', { text: 'Where it appears' }), el('p', { id: 'wordsWhere', text: words.where }));
  box.append(el('h4', { text: 'What lights it' }), el('p', { id: 'wordsLight', text: words.light }));
  box.append(el('p', { class: 'now', id: 'wordsNow', text: words.now }));
  panel.append(box);
  const lore = loreBox(p);
  if (lore) panel.append(lore);
  if (!p.space) panel.append(skyRuleBox(p.zone));

  // its look
  panel.append(el('h3', { text: 'Its look' }));
  const lookId = state.uses[p.id] || null;
  const look = state.looks[lookId];
  const sharers = lookId ? state.places.filter((q) => q.id !== p.id && state.uses[q.id] === lookId) : [];
  const pickLook = (v) => {
    state.uses[p.id] = v;
    if (v) state.currentId = v;
    setDirty(true);
    renderLibrary();
    renderPlaces();
    selectPlace(p.id, { rebuild: true, aim: false });
  };
  // back to the look this place had as saved
  const savedUse = state.saved.uses[p.id] ?? null;
  const useBack = resetButton({ value: savedUse || '', from: 'as saved' }, lookId || '', () => pickLook(savedUse && state.looks[savedUse] ? savedUse : null));
  useBack.title = `Reset to the look as saved: ${savedUse ? state.looks[savedUse]?.name || savedUse : '(unassigned)'}`;
  panel.append(el('div', { class: 'ctl' }, el('span', { text: 'Look' }), lookSelect(lookId, pickLook), el('span'), useBack));
  const row = el('div', { class: 'row' });
  if (look) {
    row.append(el('button', { type: 'button', class: 'small', title: 'Its layers, in the Look tab: changes show here at once', onclick: () => showTab('look') }, 'Edit this look'));
    row.append(el('button', { type: 'button', class: 'small', title: 'A copy of the look for this place alone, named for it: then changing it changes nothing else', onclick: () => ownCopy(p) }, 'Give this place its own copy'));
  }
  panel.append(row);
  if (look) panel.append(el('p', { class: 'note', text: sharers.length ? `"${look.name}" is also used by ${sharers.length} other place${sharers.length > 1 ? 's' : ''}: ${sharers.map((q) => q.id).join(', ')}. Editing the look changes them all; this page's settings change this place alone.` : `Only this place uses "${look.name}".` }));

  // its own settings
  panel.append(el('h3', { text: 'This place only' }));
  panel.append(el('p', { class: 'note', text: p.invented ? 'Not in SWG\'s files: every setting starts from our own starting value, and "SWG\'s" returns to it.' : 'Every setting starts from SWG\'s own value (hover "SWG\'s" to see it and where it comes from), and changes this place alone.' }));
  const savedEdits = state.saved.placeEdits[p.id] || {};
  const num = (field, label, min, max, step, unit, title) => {
    if (!p.fields.includes(field)) return;
    panel.append(settingRow({
      label, value: e[field], swgValue: p.swg[field], savedValue: savedEdits[field] ?? p.swg[field], min, max, step, unit, title, from: p.from?.[field], changed: edits[field] !== undefined,
      onSet: (v) => setPlaceEdit(p, field, v), onReset: () => setPlaceEdit(p, field, p.swg[field]),
    }));
  };
  num('size', 'Size', 0.1, 120, 0.1, '°', 'The angle it fills in the sky, across');
  if (p.space) {
    num('yaw', 'Direction: yaw', -180, 180, 0.1, '°', 'Round the zone: 0 ahead, 90 to the right');
    num('pitch', 'Direction: pitch', -89, 89, 0.1, '°', 'Up or down from the zone\'s level');
    num('distance', 'Distance', 10, Math.max(3000, Math.ceil((p.swg.distance || 600) * 3)), 1, '', 'How far out: decides which body is in front (the angle above stays its own)');
  } else if (p.kind === 'sun2' || p.kind === 'moon2') {
    num('yaw', 'Offset: yaw', -180, 180, 0.5, '°', 'Round the horizon from where the light is');
    num('pitch', 'Offset: pitch', -90, 90, 0.5, '°', 'Up or down from where the light is');
  } else if (p.kind === 'sun' || p.kind === 'moon') {
    panel.append(el('p', { class: 'note', text: `Its position is the light's: SWG's ${p.kind} slot rides the world's light ${p.kind === 'sun' ? 'by day' : 'by night'}, so it has no place of its own (move the hour under the stage).` }));
  } else {
    num('yaw', 'Position: yaw', -180, 180, 0.5, '°', 'Round the horizon: 0 ahead (-Z), 90 to the right');
    num('pitch', 'Position: pitch', -90, 180, 0.5, '°', 'Up from the horizon; past 90 it goes on over the top');
    if (p.cycle > 0) panel.append(el('p', { class: 'note', text: (p.pdir ?? 1) !== 0 ? `It circles the sky once every ${(p.cycle / 3600).toFixed(2)} hours of the client's day (SWG's cycle), starting from this pitch.` : 'SWG gives it a cycle but no direction to turn in, so it stays put.' }));
  }
  num('tilt', 'Tilt', -90, 90, 0.5, '°', 'A sphere\'s axis leans; a dome or picture turns in view. SWG\'s pictures do not lean: 0');
  num('spin', 'Spin', -20, 20, 0.1, '°/s', 'How fast it turns. SWG\'s sky pictures and zone planets do not turn: 0');
  num('brightness', 'Brightness', 0, 3, 0.01, '', 'This body\'s own brightness. SWG draws its pictures as they are: 1');

  // its light
  const sources = lightSourcesFor(p);
  const lsel = el('select');
  for (const s of sources) lsel.append(el('option', { value: s, text: LIGHT_NAMES[s] }));
  lsel.value = e.light.source;
  // Lit while anything of the light differs, a fixed angle kept from earlier included; it puts the
  // whole light back (source and angle), so nothing changed is left out of sight.
  const lchanged = !!edits.light;
  const swgLight = LIGHT_NAMES[p.swg.light.source] + (p.swg.light.source === 'fixed' ? ` from ${Math.round(p.swg.light.azimuth)}° round, ${Math.round(p.swg.light.elevation)}° toward you` : '');
  const lreset = el('button', { type: 'button', class: 'small swg' + (lchanged ? ' changed' : ''), title: `Back to SWG's: ${swgLight}${p.from?.light ? ' (' + p.from.light + ')' : ''}` }, 'SWG\'s');
  lreset.disabled = !lchanged;
  lsel.addEventListener('change', () => { setPlaceLightEdit(p, 'source', lsel.value); renderPlacePanel(); renderPlaces(); });
  lreset.addEventListener('click', () => { clearPlaceLight(p); renderPlacePanel(); renderPlaces(); });
  // the whole light (source and any angle) back as saved
  const savedLight = savedEdits.light ? JSON.stringify(savedEdits.light) : '';
  const lback = resetButton({ value: savedLight, from: 'as saved' }, edits.light ? JSON.stringify(edits.light) : '', () => {
    const pe = (state.placeEdits[p.id] ||= {});
    if (savedEdits.light) pe.light = JSON.parse(savedLight); else delete pe.light;
    if (!Object.keys(pe).length) delete state.placeEdits[p.id];
    setDirty(true);
    renderPlacePanel(); renderPlaces(); refreshWordsSoon();
  });
  lback.title = `Reset to the light as saved: ${LIGHT_NAMES[savedEdits.light?.source || p.swg.light.source]}`;
  panel.append(el('div', { class: 'ctl pctl', title: 'Where the light on this body comes from' }, el('span', { text: 'Light' }), lsel, el('span'), lreset, lback));
  const keptAngle = edits.light && (edits.light.azimuth !== undefined || edits.light.elevation !== undefined);
  if (e.light.source !== 'fixed' && keptAngle) {
    panel.append(el('p', { class: 'note', text: `A fixed angle you set (from ${Math.round(e.light.azimuth)}° round its disc, ${Math.round(e.light.elevation)}° toward you) is kept for when "${LIGHT_NAMES.fixed}" is chosen again, and is saved with this place. "SWG's" on the Light row clears it.` }));
  }
  if (e.light.source === 'fixed') {
    for (const [key, label, min, max, title] of [
      ['azimuth', 'Light: round the disc', -180, 180, 'Where round the body the light comes from, as you see it: 0 from the right, 90 from above, 180 from the left'],
      ['elevation', 'Light: toward you', -89, 89, 'How far toward you: 90 lights its whole face (full), 0 half of it, -90 lights only its far side (new)'],
    ]) {
      panel.append(settingRow({
        label, value: e.light[key], swgValue: p.swg.light[key], savedValue: savedEdits.light?.[key] ?? p.swg.light[key], min, max, step: 1, unit: '°', title, changed: edits.light?.[key] !== undefined,
        onSet: (v) => setPlaceLightEdit(p, key, v), onReset: () => setPlaceLightEdit(p, key, p.swg.light[key]),
      }));
    }
  }

  // a zone's sun
  if (p.space) {
    const z = zoneSun(p.zone);
    const swg = zoneSunSwg(p.zone);
    const zEdits = state.zoneEdits[p.zone]?.sun || {};
    panel.append(el('h3', { text: `The zone's sun (${p.zone})` }));
    panel.append(el('p', { class: 'note', text: `One sun for the whole zone: every body here whose Light is "the zone's sun" is lit from it, and its star picture moves with it. SWG's files never say which star is the sun: the game takes the brightest with a glow (${swg.sunGroup ? `yaw ${swg.sunGroup.yaw}, pitch ${swg.sunGroup.pitch}` : 'none here'}), and its colour is the zone's first light. A body whose look carries its light painted in (a menu circle, or a painted shell over its lit layers) shows little or none of this sun: the words at the top say which of its layers take it.` }));
    const zSaved = state.saved.zoneEdits[p.zone]?.sun || {};
    const zrow = (key, label, min, max, step, unit, title) => panel.append(settingRow({
      label, value: z[key], swgValue: swg[key], savedValue: zSaved[key] ?? swg[key], min, max, step, unit, title, from: swg.from[key], changed: zEdits[key] !== undefined,
      onSet: (v) => setZoneSunEdit(p.zone, key, v), onReset: () => setZoneSunEdit(p.zone, key, swg[key]),
    }));
    zrow('yaw', 'Sun: yaw', -360, 360, 0.5, '°', 'Round the zone: 0 ahead, 90 to the right');
    zrow('pitch', 'Sun: pitch', -89, 89, 0.5, '°', 'Up or down');
    panel.append(colourRow({
      label: 'Sun: colour', value: z.colour, swgValue: swg.colour, savedValue: zSaved.colour ?? swg.colour, from: swg.from.colour, changed: zEdits.colour !== undefined,
      onSet: (v) => setZoneSunEdit(p.zone, 'colour', v), onReset: () => setZoneSunEdit(p.zone, 'colour', swg.colour),
    }));
    zrow('brightness', 'Sun: brightness', 0, 3, 0.01, '', 'How strongly it lights the zone\'s bodies');
  }
  panel.scrollTop = scroll;
}

// ---- the words ----

/** What in a look takes light, and what carries its light painted in. */
function lightTakers(look) {
  if (!look) return { lit: [], painted: [] };
  if (look.kind === 'sheet') return { lit: [], painted: ['the picture'] };
  const L = look.layers;
  const lit = [], painted = [];
  const sphere = look.kind === 'sphere';
  if (L.surface.on) ((sphere ? L.surface.lit !== false : !!L.surface.lit) ? lit : painted).push('its surface');
  if (L.clouds.on && L.clouds.tex) (L.clouds.lit ? lit : painted).push('its clouds');
  if (!sphere && L.overlay.on) painted.push('its painted shell');
  if (L.night.on && L.night.where === 'night') lit.push('its night lights (on the dark side)');
  if (L.atmosphere.on) (L.atmosphere.form === 'rim' ? lit : painted).push(L.atmosphere.form === 'rim' ? 'its rim glow' : 'its halo picture');
  // wave 5: a space volume's gas glows of its own; its billows take the sun when its dial asks
  const vd = look.generated?.volume?.dials;
  if (vd) ((+vd.sunlit > 0 ? lit : painted)).push(+vd.sunlit > 0 ? 'its gas\'s sunlit billows' : 'its glowing gas (its own light)');
  return { lit, painted };
}
const andList = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
const deg1 = (v) => `${(+v).toFixed(1)}°`;

/** How opaque a dome's painted shell is over its lit layers (0 when it has none, or it only adds light). */
const shellCover = (look) => (look && look.kind === 'dome' && look.layers.overlay.on && look.layers.overlay.blend !== 'add' && +look.layers.overlay.opacity >= 0.3 ? +look.layers.overlay.opacity : 0);

/** A ground sky's sun picture with no look is drawn as a sun of ours (placeview.js), not lit. */
const drawnSun = (p, look) => !look && !p.space && /^sun/.test(p.picture || '');
/** What the stage really draws for a place: its look, else the lit grey stand-in (null for a drawn sun). */
const drawnLook = (p, look) => look || (drawnSun(p, look) ? null : PLACEHOLDER);

function placeWords(p) {
  const e = effective(p, state.placeEdits);
  const lookId = placeLookId(p.id);
  const look = state.looks[lookId] || null;
  const sharers = lookId ? state.places.filter((q) => q.id !== p.id && state.uses[q.id] === lookId) : [];
  const world = worldName(p.zone);
  const sky = state.skies.get(p.zone);
  const where = [];
  if (p.space) {
    where.push(`In orbit in ${sky?.title || world} (${p.zone}): what a ship sees from the zone's centre. It hangs ${directionWords(e.yaw, e.pitch)}, ${deg1(e.size)} across, ${Math.round(e.distance)} units out. The game hangs a zone's planets on the sky at their angle; the distance decides only which body is in front.`);
  } else {
    const ground = `From ${world}'s ground`;
    if (p.kind === 'sun') where.push(`${ground}, by day. SWG's sun slot rides the world's light: it rises at 06:00, is highest (67.5° up) at 14:24 and sets at 22:48; by night it waits below the ground. ${deg1(e.size)} across (the square SWG draws for it).`);
    else if (p.kind === 'moon') where.push(`${ground}, by night only. SWG's moon slot rides the world's light by night, along the arc the sun took by day: up from 22:48, highest at 02:24, gone at 06:00. ${deg1(e.size)} across.`);
    else if (p.kind === 'sun2') where.push(`${ground}, by day, kept ${deg1(e.yaw)} round and ${deg1(e.pitch)} up from the sun (SWG's second sun keeps that offset from the light). ${deg1(e.size)} across.`);
    else if (p.kind === 'moon2') where.push(`${ground}, by night, kept ${deg1(e.yaw)} round and ${deg1(e.pitch)} up from the moon (SWG's second moon keeps that offset from the light). ${deg1(e.size)} across.`);
    else if (p.kind === 'sheet') where.push(`${ground}: a picture of the night sky's moons, ${directionWords(e.yaw, e.pitch)}, ${deg1(e.size)} tall, day and night.`);
    else if (p.cycle > 0 && (p.pdir ?? 1) !== 0) where.push(`${ground}: it circles the sky once every ${(p.cycle / 3600).toFixed(2)} hours, from ${directionWords(e.yaw, e.pitch)}. ${deg1(e.size)} across.`);
    else where.push(`${ground}: fixed in the sky ${directionWords(e.yaw, e.pitch)}, day and night, ${deg1(e.size)} across. (SWG fades its extra bodies with the sky's colour ramp, which this viewer does not read: here it is always at full strength.)`);
  }
  // under its world's system (applied or previewed): where the system puts it
  systemWords(p, where);
  if (p.invented) where.push('This place is not in SWG\'s files: its starting place is ours.');
  if (look) where.push(`It shows the look "${look.name}"${sharers.length ? `, which ${sharers.length} other place${sharers.length > 1 ? 's' : ''} also use${sharers.length > 1 ? '' : 's'}: editing the look changes ${sharers.length > 1 ? 'all of them' : 'both'}, "Give this place its own copy" changes this one alone` : ', and no other place uses it'}.`);
  else where.push(`No look is chosen: the game would draw SWG's own ${p.space ? 'planet' : 'picture'} (${p.picture || 'none'}); ${!p.space && /^sun/.test(p.picture || '') ? 'a drawn sun' : 'a grey stand-in'} marks it here.`);

  const src = e.light.source;
  let light;
  if (src === 'world-sun') {
    light = `The world's moving sun: the light comes from wherever ${world}'s sun is at the hour (even below the horizon), so the lit side and the phase move through the day.`;
    if (p.kind === 'moon') light += ' SWG puts the moon slot exactly opposite the sun, so under this light it is always full; choose a fixed angle to give it a phase.';
    if (p.kind === 'sun') light += ' It is the sun itself, so this light shows all of its face.';
  } else if (src === 'zone-sun') {
    const z = zoneSun(p.zone);
    light = `The zone's sun: from ${directionWords(z.yaw, z.pitch)}, colour ${z.colour}, brightness ${(+z.brightness).toFixed(2)}. Move it below, and every body of this zone lit by the zone's sun follows.`;
  } else if (src === 'fixed') {
    light = `A fixed angle of its own: from ${Math.round(e.light.azimuth)}° round its disc as you see it (0 from the right, 90 from above) and ${Math.round(e.light.elevation)}° toward you. It never moves, so it looks the same at every hour.`;
  } else {
    const shown = drawnLook(p, look);
    light = shown && shown.kind === 'sphere'
      ? `Painted in: a sphere has no painted light, so it takes ${look ? 'its look\'s' : 'the stand-in\'s'} painted-light angle (${Math.round(+shown.adjust.lightAngle)}° round its disc, ${Math.round(+shown.adjust.lightElev)}° toward you) as a fixed angle.`
      : `Painted in: the look's own painted light (from ${Math.round(+(look?.adjust.lightAngle ?? 0))}° round its disc), the way its pictures carry it. Nothing in the world moves it.`;
  }
  const t = lightTakers(look);
  if (look) {
    if (!t.lit.length) light += ` None of "${look.name}"'s layers takes light (${andList(t.painted) || 'nothing is on'} ${t.painted.length > 1 ? 'carry' : 'carries'} the light painted into the picture), so what is chosen here changes nothing you can see: tick "Takes light" on its surface (Look tab), or use a sphere look.`;
    else {
      light += ` Of "${look.name}", ${andList(t.lit)} ${t.lit.length > 1 ? 'take' : 'takes'} this light${t.painted.length ? `; ${andList(t.painted)} ${t.painted.length > 1 ? 'keep' : 'keeps'} the light painted into the picture` : ''}.`;
      if (look.kind === 'dome' && src !== 'painted') light += ' A dome is shaded as the sphere it stands for, so its lit layers show the phase below.';
      const cover = shellCover(look);
      if (cover) light += ` But its painted shell is drawn over them at ${Math.round(cover * 100)}%, with its own light painted in, so it hides much of that phase whatever the light does: lower the painted shell's opacity (Look tab) to see more of it.`;
    }
  } else if (drawnSun(p, look)) {
    light += ' No look is chosen, so a sun of ours is drawn here: it gives its own light, and no light falls on it.';
  } else {
    light += ' No look is chosen, so the grey stand-in drawn here takes this light.';
  }
  return { where: where.join(' '), light, now: nowWords(p, e, look) };
}

/**
 * Where the body is at this hour (from the ground) and how much of it its light shows, for what the
 * stage really draws: its look, or with none the lit grey stand-in (or, for a sun picture, a drawn sun).
 */
function nowWords(p, e, look) {
  const day = p.space ? null : dayNow(p.zone);
  const sky = p.space ? null : skyNow(p.zone);
  const at = sky ? placeView.where({ place: p }, e, day, sky) : placeDirection(p, e, day);
  const when = p.space ? 'Now' : `At ${clockText(state.hours)}`;
  if (!at.shown) return `${when} it is not in the sky: ${at.why}.`;
  const sun = day ? `the sun is ${day.sun.y >= 0 ? Math.round(Math.asin(day.sun.y) * 180 / Math.PI) + '° up' : Math.round(-Math.asin(day.sun.y) * 180 / Math.PI) + '° below the horizon'}; ` : '';
  const yp = yawPitch(at.dir);
  const pos = p.space ? '' : `it is ${directionWords(yp.yaw, yp.pitch)}; `;
  if (drawnSun(p, look)) return `${when} ${sun}${pos}a sun of ours is drawn there, shining with its own light.`;
  const shown = drawnLook(p, look);
  const t = lightTakers(shown);
  if (!t.lit.length || (e.light.source === 'painted' && shown.kind !== 'sphere')) return `${when} ${sun}${pos}what shows is the light painted into it.`;
  let L = placeLight(p, e, day, p.space ? zoneSun(p.zone) : null, shown, at.dir);
  if (sky && at.j >= 0 && e.light.source === 'world-sun') { const k = 3 * at.j; L = { dir: { x: sky.out.light[k], y: sky.out.light[k + 1], z: sky.out.light[k + 2] } }; }
  if (!L.dir) return `${when} ${sun}${pos}what shows is the light painted into it.`;
  const ph = phaseOf(at.dir, L.dir);
  const cover = shellCover(shown);
  return `${when} ${sun}${pos}${cover ? 'its lit layers show' : 'it shows'} ${ph.word}, ${Math.round(ph.lit * 100)}% of its face lit${cover ? `, under its painted shell (${Math.round(cover * 100)}%), which keeps its own light` : ''}.`;
}
function yawPitch(d) {
  return { yaw: (Math.atan2(d.x, -d.z) * 180) / Math.PI, pitch: (Math.asin(Math.max(-1, Math.min(1, d.y))) * 180) / Math.PI };
}

let wordsTimer = 0;
function refreshWordsSoon() {
  clearTimeout(wordsTimer);
  wordsTimer = setTimeout(() => {
    const p = state.mode === 'place' ? state.placesById.get(state.placeId) : null;
    if (!p || !$('wordsWhere')) return;
    const w = placeWords(p);
    $('wordsWhere').textContent = w.where;
    $('wordsLight').textContent = w.light;
    $('wordsNow').textContent = w.now;
  }, 60);
}
function refreshNowLine() {
  refreshSkyNowLine();
  const p = state.mode === 'place' ? state.placesById.get(state.placeId) : null;
  const n = $('wordsNow');
  if (!p || !n || $('placePanel').hidden) return;
  const text = nowWords(p, effective(p, state.placeEdits), state.looks[state.uses[p.id]] || null);
  if (n.textContent !== text) n.textContent = text;
}

/** On a look's page: every place that shows it, each with a button to see it there. */
function whereBox(id) {
  const using = state.places.filter((p) => state.uses[p.id] === id);
  const box = el('div', { class: 'where' });
  box.append(el('h4', { text: using.length ? `Where this look appears: ${using.length} place${using.length > 1 ? 's' : ''}` : 'Where this look appears' }));
  if (!using.length) box.append(el('p', { class: 'note', text: 'No place uses it yet: choose it for a place in All places, or on a place\'s page.' }));
  for (const p of using) {
    const ln = loreName(p.id);
    box.append(el('div', { class: 'where-row' + (state.mode === 'place' && p.id === state.placeId ? ' current' : '') },
      el('span', { class: 'where-name' }, el('span', { class: 'where-label' }, el('strong', { text: p.label }), ln ? el('span', { class: 'lore-name', title: 'Its name in the lore (lore.js)', text: ln }) : null), el('code', { text: p.id })),
      el('button', { type: 'button', class: 'small', title: 'Show it where it will be, with its own settings (Place tab)', onclick: () => selectPlace(p.id) }, p.space ? 'View in orbit' : 'View from the ground')));
  }
  if (using.length > 1) box.append(el('p', { class: 'note', text: 'Editing this look changes every place above. To change one alone, open it and press "Give this place its own copy".' }));
  box.append(el('p', { class: 'note', text: state.mode === 'look'
    ? 'The stage shows this look close up: a preview. Its sun (the sliders under the stage) is not saved; each place has its own light, size and position on its page (Place tab).'
    : 'The stage shows a place; what you change here shows there at once, and at every other place above.' }));
  return box;
}

/** A copy of a place's look for that place alone, named for it. */
function ownCopy(p) {
  const srcId = state.uses[p.id];
  const src = state.looks[srcId];
  if (!src) return;
  let nid = 'own:' + p.id;
  for (let k = 2; state.looks[nid]; k++) nid = `own:${p.id}~${k}`;
  // (a generated look's recipe, seed, dials and parts go with it: left out, the copy was a bare sphere)
  const copy = finishLook(makeLook(JSON.parse(JSON.stringify({ name: src.name, group: src.group, note: src.note, kind: src.kind, mesh: src.mesh, layers: src.layers, adjust: src.adjust, ...(src.generated ? { generated: src.generated } : {}), ...(src.air ? { air: src.air } : {}) }))));
  copy.name = `${src.name.replace(/ \(only .*\)$/, '')} (only ${p.label})`;
  copy.group = 'Copies for one place';
  copy.note = `A copy of "${src.name}" for ${p.id} alone.${src.note ? ' ' + src.note : ''}`;
  state.looks[nid] = copy;
  noteMade(nid);
  state.uses[p.id] = nid;
  state.currentId = nid;
  setDirty(true);
  renderLibrary();
  renderPlaces();
  selectPlace(p.id, { rebuild: true, aim: false });
  setStatus(`"${copy.name}" is this place's own now: changing it changes nothing else.`);
  statusTimer = setTimeout(() => setStatus(''), 4000);
}

// ---------------------------------------------------------------------------------------------
// the lore (lore.js): read only, shown beside SWG's names, never saved

const loreName = (placeId) => loreFor(state.lore, placeId)?.name || '';

/** A lore text as the page's nodes: its **bold** marks (lore.js marks our own choices "**Ours:**") drawn bold, all as plain text. */
const loreText = (s) => boldParts(s).map((x) => (x.bold ? el('strong', { text: x.text }) : x.text));

/** The Lore box on a place's page, under the plain words; null (nothing shown) when lore.js has no entry for it. */
function loreBox(p) {
  const e = loreFor(state.lore, p.id) || addedLore(p);
  if (!e) return null;
  const box = el('div', { class: 'lore', id: 'loreBox' });
  box.append(el('h4', {}, 'Lore', state.lore?.sample ? el('span', { class: 'lore-sample', text: 'a sample lore file, not the real one' }) : null));
  const kl = kindLine(e);
  box.append(el('p', { class: 'lore-title' }, el('strong', { text: e.name || '(no name given)' }), kl ? el('span', { class: 'lore-kind', text: kl }) : null));
  if (e.lore) box.append(el('p', { class: 'lore-text' }, loreText(e.lore)));
  const sys = systemFor(state.lore, [p.zone, worldName(p.zone), state.skies.get(p.zone)?.title]);
  if (sys) box.append(el('p', { class: 'lore-system' }, el('span', { text: `${sys.name || 'Its system'}: ` }), loreText(sys.line)));
  if (e.look) box.append(el('h5', { text: 'How it should look' }), el('p', { class: 'lore-look' }, loreText(e.look)));
  const ours = isOurs(e.continuity);
  const meta = [];
  if (e.continuity && !ours) meta.push(`Continuity: ${e.continuity}`);
  if (e.confidence) meta.push(`Confidence: ${e.confidence}`);
  if (ours) box.append(el('p', { class: 'lore-ours', text: `Ours: no Star Wars source gives this${/^ours$/i.test(e.continuity) ? '' : ` (${e.continuity})`}; the name and the words are our own choice.` }));
  if (meta.length) box.append(el('p', { class: 'lore-meta', text: meta.join(' · ') }));
  if (e.why) box.append(el('p', { class: 'lore-why' }, el('span', { text: 'Why: ' }), loreText(e.why)));
  if (e.sources.length) {
    const list = el('p', { class: 'lore-sources' }, el('span', { text: e.sources.length > 1 ? 'Sources: ' : 'Source: ' }));
    e.sources.forEach((s, i) => {
      if (i) list.append(' · ');
      list.append(s.url ? el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', title: s.url, text: s.title || s.url }) : el('span', { text: s.title }));
    });
    box.append(list);
  }
  return box;
}

// ---------------------------------------------------------------------------------------------
// adding a picture: "Add a picture…" (a file picker) or a file dropped anywhere on the page, then its
// name and kind; the server writes it into the imported folder, never over a file already there.

const add = { file: null, type: null, width: 0, height: 0, url: null, name: '', kind: 'other', problem: '', message: '', busy: false };

async function refreshFiles() {
  try {
    const files = await getJSON('/api/files');
    state.files = files.files;
  } catch (e) {
    console.warn('[viewer] could not list the imported folder again:', e.message);
  }
}

function wireAddPicture() {
  $('addPicture').addEventListener('click', () => $('pictureFile').click());
  $('pictureFile').addEventListener('change', () => {
    const f = $('pictureFile').files[0];
    $('pictureFile').value = '';
    if (f) openAddDialog(f);
  });
  // A file dragged over any part of the page: a sign says where it goes, and dropping it opens the window.
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; $('dropZone').hidden = false; });
  addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) $('dropZone').hidden = true; });
  addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    $('dropZone').hidden = true;
    const f = e.dataTransfer.files[0];
    if (f) openAddDialog(f);
  });
  $('addDialog').addEventListener('close', () => { if (add.url) URL.revokeObjectURL(add.url); add.url = null; add.file = null; });
}

/** What the file really is (by its first bytes, as the server checks), its size in pixels, and first guesses at its name and kind. */
async function openAddDialog(file) {
  if (add.busy) return;
  if (add.url) URL.revokeObjectURL(add.url);
  Object.assign(add, { file, type: null, width: 0, height: 0, url: null, problem: '', message: '', ship: false });
  let problem = '';
  let type = null;
  if (file.size > MAX_PICTURE_BYTES) problem = `"${file.name}" is ${sizeWords(file.size)} (${file.size.toLocaleString('en-GB')} bytes): a picture may be at most 64 MB (${MAX_PICTURE_BYTES.toLocaleString('en-GB')} bytes).`;
  else {
    type = sniffPicture(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
    if (!type) problem = `"${file.name}" is not a PNG or JPEG: its first bytes are not a picture's, so it cannot be added.`;
    else {
      try {
        const bm = await createImageBitmap(file);
        add.width = bm.width;
        add.height = bm.height;
        bm.close();
      } catch {
        problem = `"${file.name}" starts like a ${type === 'png' ? 'PNG' : 'JPEG'} but cannot be read as a picture.`;
      }
    }
  }
  add.type = problem ? null : type;
  add.problem = problem;
  if (!problem) add.url = URL.createObjectURL(file);
  add.name = plainName(file.name);
  add.kind = guessKind(file.name, add.width, add.height);
  renderAddDialog();
  const d = $('addDialog');
  if (!d.open) d.showModal();
  if (!problem) d.querySelector('#addName')?.focus();
}

function renderAddDialog() {
  const d = $('addDialog');
  d.textContent = '';
  const f = add.file;
  const form = el('form', { method: 'dialog' });
  form.append(el('h2', { id: 'addTitle', text: 'Add a picture' }));
  const facts = f ? [f.name, sizeWords(f.size), add.width ? `${add.width} x ${add.height}` : '', add.type ? add.type.toUpperCase() : ''].filter(Boolean).join(' · ') : '';
  const body = el('div', { class: 'add-body' });
  const preview = el('div', { class: 'add-preview' });
  if (add.url) preview.append(el('img', { src: add.url, alt: 'The picture to add' }));
  else preview.append(el('div', { class: 'add-noimage', text: 'No picture' }));
  preview.append(el('small', { text: facts }));
  body.append(preview);
  const fields = el('div', { class: 'add-fields' });
  const ext = add.type ? extFor(add.type) : '';
  const nameInput = el('input', { type: 'text', id: 'addName', value: add.name, maxlength: '100', spellcheck: 'false', autocomplete: 'off', disabled: !!add.problem });
  const nameNote = el('p', { class: 'note warn', id: 'addNameProblem' });
  const full = () => add.name.trim() + ext;
  const taken = () => state.files.find((x) => x.name.toLowerCase() === full().toLowerCase());
  const checkName = () => {
    add.name = nameInput.value;
    const pr = nameProblem(add.name.trim());
    const t = !pr && taken();
    nameNote.textContent = pr || (t ? `"${t.name}" is already in the imported folder, and a picture there is never replaced: give this one another name.` : '');
    go.disabled = !!(pr || t || add.problem || add.busy);
  };
  nameInput.addEventListener('input', checkName);
  fields.append(el('label', { class: 'add-row' }, el('span', { text: 'Name' }), el('span', { class: 'nameline' }, nameInput, el('code', { text: ext || '.png / .jpg' }))));
  fields.append(nameNote);
  const kindSel = el('select', { id: 'addKind', disabled: !!add.problem });
  for (const [k, words] of PICTURE_KINDS) kindSel.append(el('option', { value: k, text: `${k}: ${words}` }));
  kindSel.value = add.kind;
  fields.append(el('label', { class: 'add-row' }, el('span', { text: 'Kind' }), kindSel));
  // (the GPU port's pass 2, wave 4) "ship with the game" or only on this machine (the default); a still never ships
  const shipBox = el('input', { type: 'checkbox', id: 'addShip', checked: !!add.ship && shippable(add.kind), disabled: !!add.problem || !shippable(add.kind) });
  shipBox.addEventListener('change', () => { add.ship = shipBox.checked; });
  kindSel.addEventListener('change', () => { add.kind = kindSel.value; shipBox.disabled = !!add.problem || !shippable(add.kind); if (!shippable(add.kind)) shipBox.checked = add.ship = false; });
  fields.append(el('label', { class: 'add-row', title: 'Save to game copies a picture marked so beside the game\'s bodies file, with a credits line naming you; unmarked it stays on this machine. A still from a film or a game never ships.' }, el('span', { text: 'Ship' }), el('span', {}, shipBox, ' with the game (unticked: only on my machine)')));
  fields.append(el('p', { class: 'note', text: `It is written into the imported folder${state.folder ? ` (${state.folder})` : ''}, beside the others, and is in every texture list at once, under its kind, marked "added". A file already there is never replaced. Its kind and the date are kept in the file of choices when you save.` }));
  body.append(fields);
  form.append(body);
  form.append(el('p', { class: 'add-message' + (add.problem || add.message ? ' bad' : ''), id: 'addMessage', role: 'alert', text: add.problem || add.message }));
  const go = el('button', { type: 'button', class: 'primary', id: 'addGo' }, add.busy ? 'Adding…' : 'Add');
  go.addEventListener('click', doAdd);
  form.append(el('div', { class: 'row add-buttons' }, el('button', { type: 'button', id: 'addOther', onclick: () => $('pictureFile').click() }, 'Choose another file…'), el('span', { class: 'grow' }), el('button', { type: 'submit', value: 'cancel' }, 'Cancel'), go));
  form.append(el('p', { class: 'note add-help', text: 'From another computer through Chrome Remote Desktop: first send the file to this PC with the remote desktop\'s own file transfer (the side panel\'s "Upload file"; look for it on this PC\'s Desktop or in its Downloads folder), then choose it here or drop it on the page. Opened from another machine on the home network (SBV_SHARE=lan), this window sends a file straight from that machine.' }));
  d.append(form);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!go.disabled) doAdd(); } });
  checkName();
}

async function doAdd() {
  if (!add.file || !add.type || add.busy) return;
  const base = add.name.trim();
  const pr = nameProblem(base);
  if (pr) { add.message = pr; renderAddDialog(); return; }
  const name = base + extFor(add.type);
  add.busy = true;
  add.message = '';
  renderAddDialog();
  try {
    const r = await fetch('/picture?name=' + encodeURIComponent(name), { method: 'POST', headers: { 'Content-Type': mimeFor(add.type) }, body: add.file });
    const text = await r.text();
    if (!r.ok) {
      // the server's refusal, said on the page: already there (never replaced), not a picture, too large…
      add.message = (r.status === 409 ? 'Not added: ' : `Not added (${r.status}): `) + text;
      if (r.status === 409) await refreshFiles();
      return;
    }
    const res = JSON.parse(text);
    if (!state.files.some((x) => x.name === res.name)) state.files.push({ name: res.name, size: res.bytes });
    state.files.sort((a, b) => a.name.localeCompare(b.name));
    state.pictures[res.name] = { kind: add.kind, added: res.at };
    if (add.ship && shippable(add.kind)) state.pictures[res.name].ship = true;
    setAddedPictures(state.pictures);
    setDirty(true);
    add.busy = false;
    $('addDialog').close();
    renderInspector();
    setStatus(`Added "${res.name}" as ${add.kind}: it is in every texture list now, under ${add.kind}, marked "added". Save to keep its kind.`);
    statusTimer = setTimeout(() => setStatus(''), 6000);
    console.log(`[viewer] picture added: ${res.name} (${res.bytes} bytes) as ${state.pictures[res.name].kind}`);
  } catch (e) {
    add.message = 'Not added: ' + e.message;
  } finally {
    if (add.busy) { add.busy = false; if ($('addDialog').open) renderAddDialog(); }
  }
}

/** A picture's kind, set or changed on a layer (one added, or one put in the folder by hand). */
function setPictureKind(name, kind) {
  const prev = state.pictures[name];
  state.pictures[name] = { kind, added: prev?.added || new Date().toISOString() };
  // (pass 2, wave 4) its "ship with the game" mark kept, unless it is now a still (never shipped)
  if (prev?.ship && shippable(kind)) state.pictures[name].ship = true;
  setAddedPictures(state.pictures);
  forgetTexture(name);
  setDirty(true);
  rebuildSoon();
  renderInspectorSoon();
}

// ---------------------------------------------------------------------------------------------
// (the GPU port's pass 2, wave 4) Save to game, the "ship with the game" mark, and a frame handed over from the game.

/**
 * A picture he added marked "ship with the game" or back to "only on my machine" (the default); a still never ships. Kept
 * in the file of choices (`pictures`' `ship`), a step of the undo history as a kind is.
 */
function setPictureShip(name, ship) {
  const prev = state.pictures[name];
  if (!prev) return;
  const next = { kind: prev.kind, added: prev.added };
  if (ship && shippable(prev.kind)) next.ship = true;
  state.pictures[name] = next;
  setAddedPictures(state.pictures);
  setDirty(true);
  renderInspectorSoon();
}

/**
 * Save to game: the choices made into the game's own bodies file by the server (`viewer/gameBodies.mjs`): his generated
 * looks, the systems he applied, each ground world's air dials and which place wears which look, numbers only; his own
 * photos only where marked to ship; a credits line naming him. Written where the server's `SBV_GAME` says (the repo's
 * `public/sky/bodies.json` by default), which the game reads at its next loading screen and he commits as he does his maps.
 * His file of choices is not touched (Save choices is its own button).
 */
async function saveToGame() {
  const twins = {};
  for (const [id, l] of Object.entries(state.looks)) {
    const t = l && !l.generated ? twinOfLook(id, l) : null;
    if (t && state.looks[t]) twins[id] = t;
  }
  const uses = {};
  for (const p of state.places) {
    const lid = state.uses[p.id];
    if (lid && state.looks[lid]) uses[p.id] = lid;
  }
  const body = { looks: state.looks, uses, starSystems: state.starSystems, systems: state.systems, pictures: cleanPictures(state.pictures), worlds: MAIN_WORLDS, twins };
  try {
    const r = await fetch('/save-game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(await r.text());
    const res = await r.json();
    setStatus(`Saved to the game: ${res.looks} looks, ${res.uses} places, ${res.systems} applied system${res.systems === 1 ? '' : 's'}, the air of ${res.air} world${res.air === 1 ? '' : 's'}${res.pictures.length ? `, ${res.pictures.length} photo${res.pictures.length > 1 ? 's' : ''}` : ''} -> ${res.file}. The game reads it at its next loading screen; commit it as you do your maps.`);
    statusTimer = setTimeout(() => setStatus(''), 9000);
    return res;
  } catch (e) {
    setStatus('Save to game failed: ' + e.message, true);
    return { error: e.message };
  }
}

/**
 * A frame handed over from the game (`__debug.sky({ match })` answers it as `json`; localStorage is the game's own origin's,
 * so it travels as JSON): its world's ground sky, its hour, its camera's turn and field of view, its air and its eye, drawn
 * as the game does. `null` lets go. Also `?match=<the JSON, URL-encoded>` on the page's address.
 */
async function holdMatch(json) {
  if (!gameLook) return { error: 'the stage is not up yet' };
  let said;
  try {
    said = gameLook.setMatch(json);
  } catch (e) {
    return { error: 'not JSON: ' + e.message };
  }
  if (json === null || said.error) return said;
  const m = gameLook.match;
  const world = viewerWorldOf(m.planet);
  const p = state.places.find((q) => q.zone === world && !q.space);
  if (!p) return { ...said, error: `the viewer has no ground sky of ${world}` };
  state.hours = ((m.time % 1) + 1) % 1 * 24;
  if (!state.viewer.gameLook) setViewer('gameLook', true);
  await selectPlace(p.id, { aim: false });
  return { ...said, place: p.id, hours: Number(state.hours.toFixed(3)) };
}

// ---------------------------------------------------------------------------------------------
// Skies in motion: system.js the model, drafts.js the drafts, orrery.js the System view.
//
// Version 2 (21 November): one system per star (drafts.js), each ground world in it a "where you
// stand" choice, all on the real clock. A world's sky follows its system only after Apply, and Apply
// (and Back to SWG's sky) is for every ground world of the system at once; until then SWG's rule
// stands, and "See it from the ground" previews it without changing anything. His systems are saved
// under `starSystems`, each { applied, system }: the system is copied in on his first change or on
// Apply, so a later draft never moves a sky he has approved.
//
// Version 1 (the first round's `systems`, one per world) still loads and still draws: a world he
// applied then keeps that sky until he applies its shared system (system.js skyRuleFor). Applying it
// sets the old one aside for that world: kept in his file, not applied (Undo brings it back). A file
// without systems loads as it always did. Space zones never move.

let orrery = null;
const openBodies = new Set();
const GROUND_KINDS = ['planet', 'moon', 'giant'];

/** A saved file's `systems` (version 1, one per world): each world's applied mark and its system, checked (system.js). */
function cleanSystems(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [world, e] of Object.entries(raw)) {
    if (!/^[A-Za-z0-9_]{1,64}$/.test(world) || !e || typeof e !== 'object') continue;
    const o = { applied: e.applied === true };
    if (e.system) { const s = cleanSystem(e.system); if (s) o.system = s; }
    if (o.applied || o.system) out[world] = o;
  }
  return out;
}
/** A saved file's `starSystems` (version 2, one per star): each system's applied mark and its system, checked. */
function cleanStarSystems(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, e] of Object.entries(raw)) {
    if (!/^[a-z0-9_]{1,40}$/.test(id) || !e || typeof e !== 'object') continue;
    const o = { applied: e.applied === true };
    if (e.system) { const s = cleanSystem(e.system); if (s && (s.future || s.version === 2)) { if (!s.future) s.id = id; o.system = s; } }
    if (o.applied || o.system) out[id] = o;
  }
  return out;
}

// ---- which system holds a world, and which sky the world follows ----

/** The id of the star system that holds a ground world: one of his own first, else its draft's. */
function systemIdOf(world) {
  if (!world) return null;
  for (const [id, e] of Object.entries(state.starSystems)) if (e.system && !e.system.future && e.system.grounds.some((g) => g.world === world)) return id;
  return draftSystemOf(world);
}
/** A star system: his own as he left it, else its draft; null for one a newer viewer made. */
function starOf(id) {
  if (!id) return null;
  const s = state.starSystems[id]?.system;
  if (s) return s.future ? null : s;
  return draftSystem(id);
}
const starApplied = (id) => !!id && state.starSystems[id]?.applied === true && !!starOf(id);
/** A first-round system of a world: his, else (an applied mark kept without one) the first round's draft. */
function systemOfV1(world) {
  const s = state.systems[world]?.system;
  if (s) return s.future ? null : s;
  return draftV1For(world);
}
/** What a world's sky follows: its star system (applied, or previewed), a first-round sky he applied, or SWG's rule (null). */
function skyRule(world) {
  if (!world) return { rule: null, id: null };
  const id = systemIdOf(world);
  if (id && starOf(id) && (starApplied(id) || state.preview === id)) return { rule: 'system', id, preview: !starApplied(id) };
  const r = skyRuleFor(world, state.systems, state.starSystems, systemIdOf);
  if (r.rule === 'one-world' && systemOfV1(world)) return { rule: 'one-world', id };
  return { rule: null, id };
}
const skyFollows = (world) => !!skyRule(world).rule;

const sizeOfPlace = (id) => { const p = state.placesById.get(id); return p ? effective(p, state.placeEdits).size : null; };
const isSheet = (id) => state.placesById.get(id)?.kind === 'sheet';
const sysModels = new Map();
/** A star system seen from one of its ground worlds, as a model (made again after any change), with its state. */
function starModel(id, world) {
  const sys = starOf(id);
  if (!sys) return null;
  const at = sys.grounds.some((g) => g.world === world) ? world : sys.grounds[0].world;
  const key = id + '|' + at;
  let c = sysModels.get(key);
  if (!c || c.sys !== sys || c.rev !== state.sysRev) {
    const model = compileSystem(sys, sizeOfPlace, isSheet, { world: at, placeExists: (pid) => state.placesById.has(pid) });
    c = { sys, rev: state.sysRev, model, out: makeSkyState(model), v2: true, id, world: at };
    sysModels.set(key, c);
  }
  return c;
}
/** A first-round system as a model (its own clock: the game's day). */
function v1Model(world) {
  const sys = systemOfV1(world);
  if (!sys) return null;
  const key = 'v1|' + world;
  let c = sysModels.get(key);
  if (!c || c.sys !== sys || c.rev !== state.sysRev) {
    const model = compileSystem(sys, sizeOfPlace, isSheet);
    c = { sys, rev: state.sysRev, model, out: makeSkyState(model), v2: false, id: null, world };
    sysModels.set(key, c);
  }
  return c;
}
/** The real moment the skies of version 2 show, in real days since the epoch: the wall's clock while live. */
const v2Time = () => realDays(state.live ? Date.now() : state.realT);
function starAt(id, world, T = v2Time()) {
  const c = starModel(id, world);
  if (c && c.out.T !== T) skyAt(c.model, T, c.out);
  return c;
}
function v1At(world, T) {
  const c = v1Model(world);
  if (c && c.out.T !== T) skyAt(c.model, T, c.out);
  return c;
}
/** A world's sky now when it follows a system; else null (SWG's rule). */
function skyNow(world) {
  const r = skyRule(world);
  if (r.rule === 'system') return starAt(r.id, world);
  if (r.rule === 'one-world') return v1At(world, skyTime(state.day, state.hours));
  return null;
}
/** The day as the ground view reads it: where the world's system puts its sun, or SWG's at the hour. */
function dayNow(world) {
  const c = world ? skyNow(world) : null;
  return c?.v2 ? c.out.day : dayAt(state.hours);
}
/** The model a followed sky draws from (no moment needed). */
function skyModel(world) {
  const r = skyRule(world);
  return r.rule === 'system' ? starModel(r.id, world) : r.rule === 'one-world' ? v1Model(world) : null;
}

/** The bodies a followed system draws that no place stands for: places of the moment, never saved. */
function systemPlaces(world) {
  const c = skyModel(world);
  if (!c) return [];
  const out = [];
  c.model.items.forEach((it, j) => {
    if (it.place || !c.model.itemDrawn[j]) return;
    const b = c.model.sys.bodies[it.body];
    const tail = it.member ? '#' + j : b.kind === 'pair' ? '#' + (c.model.itemPair?.[j] >= 0 ? 2 : 1) : '';
    out.push({
      id: `system:${world}:${b.id}${tail}`, zone: world, space: false, kind: it.star ? 'sun' : 'celestial', picture: it.star ? 'sun_system' : null,
      label: `${possessiveName(world)} system: ${it.name}`, shortLabel: it.name, what: '', invented: true, cycle: 0, pdir: 1, fields: [], from: {},
      swg: { size: it.size, yaw: 0, pitch: 0, distance: null, tilt: 0, spin: 0, light: { source: 'world-sun', azimuth: 150, elevation: 25 }, brightness: 1 },
      systemBody: true, lookId: (it.look && wornLookId(it.look)) || bodyPlaceholder(c, world, b, it), itemIndex: j,
    });
  });
  return out;
}
const possessiveName = (world) => { const n = worldName(world); return n.endsWith('s') ? n + '\'' : n + '\'s'; };
/** What the ground view built for a world's sky: when it changes, the view is built again. */
function skyItemsKey(world) {
  const c = skyModel(world);
  if (!c) return 'swg';
  return (c.v2 ? 'v2:' + c.id : 'v1') + '/' + c.model.items.map((it, j) => `${it.place || ''}|${it.look || ''}|${c.model.itemDrawn[j]}|${it.star ? 1 : 0}`).join(',') + '/' + [...c.model.hidden].join(',');
}
function refreshSkyIfNeeded() {
  if (state.mode !== 'place' || !placeView.zone) return;
  if (skyItemsKey(placeView.zone) !== state.skyItemsKey) selectPlace(state.placeId, { rebuild: true, aim: false });
  else { updatePlaceBar(); refreshWordsSoon(); }
}

// ---- the clock: the hour of the world you stand on, and the real date ----

/** The model whose clock the bars show: the place's world under its star system, or the System view's. */
function clockModel() {
  if (state.mode === 'system') return state.sysId ? starModel(state.sysId, standOf(state.sysId)) : null;
  const p = state.mode === 'place' ? state.placesById.get(state.placeId) : null;
  if (!p || p.space) return null;
  const r = skyRule(p.zone);
  return r.rule === 'system' ? starModel(r.id, p.zone) : null;
}
/** The hour slider: under a star system, the hour of the world's own day (the real moment moves within that day); else SWG's hour. */
function setHourOfWorld(h) {
  h = ((+h % 24) + 24) % 24;
  const c = clockModel();
  if (c) { state.realT = msOfRealDays(timeAtHour(c.model, v2Time(), h)); state.live = false; }
  state.hours = h;
}
/** The date control: whole days from today, the world's hour kept. */
function setDateOffset(days) {
  const c = clockModel();
  const T = realDays(Date.now() + Math.round(+days || 0) * DAY_MS);
  state.realT = msOfRealDays(c ? timeAtHour(c.model, T, localHour(c.model, v2Time())) : T);
  state.live = false;
  syncHours();
}
/** "Now": both back on the clock (the hour and the date follow the wall from here). */
function clockNow() {
  state.live = true;
  state.realT = Date.now();
  syncHours();
}
/** The date shown, in calendar days from today (this PC's days). */
const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
const dateOffsetDays = () => Math.round((startOfDay(state.live ? Date.now() : state.realT) - startOfDay(Date.now())) / DAY_MS);
/** Under a star system, the hour the words and the slider show is the world's own. */
function syncHours() {
  const c = clockModel();
  if (c) state.hours = localHour(c.model, v2Time());
}
/** Play, from the ground: the world's hours run (its day as long as its dayHours), or SWG's hours. */
function advancePlaceClock(dt) {
  const c = clockModel();
  if (c) {
    state.realT = (state.live ? Date.now() : state.realT) + dt * state.speed * (c.model.dayDays / 24) * DAY_MS;
    state.live = false;
    syncHours();
  } else {
    let h = state.hours + dt * state.speed;
    while (h >= 24) { h -= 24; state.day++; }
    state.hours = h;
  }
  $('time').value = state.hours;
  $('timeOut').textContent = clockText(state.hours);
  if (!$('day').closest('label').hidden && +$('day').value !== state.day) { $('day').value = state.day; $('dayOut').textContent = String(state.day); }
  if (c) updateDateLine();
}
/** While live, from the ground: the world's hour and the date follow the wall's clock. */
function tickLiveClock() {
  if (!clockModel()) return;
  syncHours();
  if (Math.abs(+$('time').value - state.hours) > 0.01) $('time').value = state.hours;
  $('timeOut').textContent = clockText(state.hours);
  updateDateLine();
}
/** Play, in the System view: real time runs at the chosen rate. */
function advanceSystemClock(dt) {
  state.realT = (state.live ? Date.now() : state.realT) + dt * state.sysSpeed * DAY_MS;
  state.live = false;
  syncHours();
  updateSystemBar();
}
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "Sat 21 Nov 2026, 16:05" (this PC's time), the real moment shown. */
function dateWords(ms) {
  const d = new Date(ms);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function clockWords() {
  const ms = state.live ? Date.now() : state.realT;
  const off = dateOffsetDays();
  return `${dateWords(ms)}${state.live ? ' (now)' : off ? ` (${off > 0 ? '+' : ''}${off} day${Math.abs(off) === 1 ? '' : 's'})` : ''}`;
}
/** The ground bar's date line and its controls (under a star system), or the first round's day slider. */
function updateClockBar(world) {
  const r = world ? skyRule(world) : { rule: null };
  for (const n of document.querySelectorAll('.sys-only')) n.hidden = r.rule !== 'one-world';
  for (const n of document.querySelectorAll('.sys2-only')) n.hidden = r.rule !== 'system';
  if (r.rule === 'system') { syncHours(); updateDateLine(); }
}
function updateDateLine() {
  const d = $('date');
  if (!d) return;
  const off = dateOffsetDays();
  if (+d.value !== off) d.value = off;
  $('dateOut').textContent = clockWords();
  $('nowBtn').classList.toggle('on', state.live);
}

// ---- the owner's choices: each an undo step ----

const starEntry = (id) => (state.starSystems[id] ||= { applied: false });
/** A star system as his to change: the draft copied in on the first change. */
function editableStar(id) {
  const e = starEntry(id);
  if (!e.system) e.system = JSON.parse(JSON.stringify(starOf(id)));
  return e.system;
}
function tidyStar(id) {
  const e = state.starSystems[id];
  if (e && !e.applied && !e.system) delete state.starSystems[id];
}
function systemEdited(structure = false) {
  state.sysRev++;
  setDirty(true);
  if (structure) { renderSystemPanel(); if (state.mode === 'place') renderPlacePanel(); }
  refreshSkyIfNeeded();
}
/** Apply: every ground world of the system follows it (a first-round sky of one of them is set aside, kept in the file). */
function applyStar(id) {
  const e = starEntry(id);
  if (!e.system) e.system = JSON.parse(JSON.stringify(starOf(id)));
  e.applied = true;
  for (const g of e.system.grounds) if (state.systems[g.world]?.applied) state.systems[g.world].applied = false;
  if (state.preview === id) state.preview = null;
  systemEdited(true);
  const n = e.system.grounds.length;
  setStatus(`${e.system.name} now draws the sky of ${n > 1 ? `all ${n} of its ground worlds` : worldName(e.system.grounds[0].world)} (Save choices keeps it)`);
  statusTimer = setTimeout(() => setStatus(''), 4000);
}
/** Back to SWG's sky, for every ground world of the system (the system is kept). */
function unapplyStar(id) {
  const e = state.starSystems[id];
  if (!e) return;
  e.applied = false;
  tidyStar(id);
  systemEdited(true);
}
/** A first-round sky of one world set aside (kept in the file). */
function unapplyV1(world) {
  const e = state.systems[world];
  if (!e) return;
  e.applied = false;
  if (!e.system) delete state.systems[world];
  systemEdited(true);
}
function backToDraft(id) {
  const e = state.starSystems[id];
  if (!e || !draftSystem(id)) return;
  if (e.system && !e.system.draft && !confirm(`Replace your own ${e.system.name} with the draft?`)) return;
  if (e.applied) e.system = JSON.parse(JSON.stringify(draftSystem(id)));
  else delete e.system;
  tidyStar(id);
  systemEdited(true);
}
/** A system of his own for a world no draft holds: the world's sun and the world, which he stands on. */
function startOwn(world) {
  const id = 'own_' + world.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 36);
  if (state.starSystems[id]?.system && !confirm(`Start ${worldName(world)}'s system again from nothing? (Undo brings this one back.)`)) return id;
  const e = starEntry(id);
  const sunPlace = state.placesById.has(world + ':sun') ? world + ':sun' : null;
  e.system = blankSystem2(world, worldName(world), sunPlace);
  e.system.id = id;
  state.madeStar[id] = JSON.parse(JSON.stringify(e));
  state.sysSel = 'world';
  state.sysStand[id] = world;
  systemEdited(true);
  return id;
}
function previewStar(id, on) {
  const was = state.preview;
  state.preview = on ? id : null;
  renderSystemPanel();
  if (state.mode === 'place') {
    renderPlacePanel();
    // (only the sky on show of the system concerned is built again: another world's would end the preview)
    const zid = placeView.zone ? systemIdOf(placeView.zone) : null;
    if (zid && (zid === id || zid === was)) refreshSkyIfNeeded();
  }
}
/** This sky from the ground at this moment: previewed when not applied. */
async function seeFromGround(id, world = standOf(id)) {
  const sys = starOf(id);
  if (!sys) return;
  if (!starApplied(id)) state.preview = id;
  const M = starModel(id, world)?.model;
  const sel = sys.bodies.find((b) => b.id === state.sysSel);
  const j = sel && M ? M.items.findIndex((it) => M.sys.bodies[it.body].id === sel.id && it.place) : -1;
  const pid = (j >= 0 ? M.items[j].place : null) || M?.items.find((it) => it.place && state.placesById.has(it.place))?.place || state.places.find((q) => q.zone === world)?.id;
  if (!pid) { setStatus(`${worldName(world)} has no place in SWG's skies to stand on`, true); return; }
  state.playing = false;
  await selectPlace(pid);
}
/** The ground world the System tab stands on for a system: chosen, else the place on show, else its first. */
function standOf(id) {
  const sys = starOf(id);
  if (!sys) return null;
  const w = state.sysStand[id];
  if (w && sys.grounds.some((g) => g.world === w)) return w;
  const p = state.mode === 'place' ? state.placesById.get(state.placeId) : null;
  if (p && !p.space && sys.grounds.some((g) => g.world === p.zone)) return p.zone;
  return sys.grounds[0].world;
}

// ---- the ground view's line about its sky, and the place page's box ----

function skyRuleParts(world, box, { long = false } = {}) {
  const r = skyRule(world);
  const id = r.id;
  const btn = (text, title, fn, cls = 'small') => el('button', { type: 'button', class: cls, title, onclick: fn }, text);
  const name = possessiveName(world);
  if (id && state.starSystems[id]?.system?.future) { box.append(el('span', { text: `${name} system was made by a newer viewer: it is kept as it is, and SWG's sky is shown.` })); return; }
  if (!id || !starOf(id)) {
    if (r.rule === 'one-world') box.append(el('span', { text: long ? `${name} sky follows the one-world system you applied in the first round.` : 'Sky: your first-round system' }), btn('Back to SWG\'s sky', 'Set that first-round sky aside (it stays in your file)', () => unapplyV1(world)));
    else box.append(el('span', { text: long ? `${name} sky follows SWG's rule. It is in no system yet: make one of your own to see its bodies move.` : 'Sky: SWG\'s rule.' }), btn('Make a system…', 'A clockwork model of this world\'s sky, of your own', () => { openSystemView(startOwn(world), world); }));
    return;
  }
  const sys = starOf(id);
  const st = starStatus(id);
  const badge = el('span', { class: 'sysbadge ' + st.cls, text: st.word });
  const many = sys.grounds.length > 1 ? ` (and ${sys.grounds.length - 1} other ground world${sys.grounds.length > 2 ? 's' : ''})` : '';
  if (r.rule === 'system' && !r.preview) {
    box.append(el('span', { text: long ? `${name} sky follows ${sys.name}: every body in it moves as it says, on the real clock; ${worldName(world)} turns once every ${fmtNum(groundOf(sys, world).dayHours)} hours.` : `Sky: ${sys.name}` }), badge,
      btn('Back to SWG\'s sky', `Every ground world of ${sys.name} follows SWG's rule again${many} (the system is kept)`, () => unapplyStar(id)));
  } else if (r.rule === 'system') {
    box.append(el('strong', { text: 'Previewing its system' }), badge, el('span', { text: long ? `Not applied: nothing changes for ${worldName(world)}${many} until you apply it.` : 'not applied' }),
      btn('Apply', `Make the sky of every ground world of ${sys.name} follow it${many} (saved with the choices)`, () => applyStar(id), 'small primary'),
      btn('SWG\'s sky', 'Stop the preview: SWG\'s rule again', () => previewStar(id, false)));
  } else {
    const v1 = r.rule === 'one-world' || (state.systems[world]?.applied && systemOfV1(world));
    box.append(el('span', { text: long ? `${name} sky follows ${v1 ? 'the one-world system you applied in the first round' : 'SWG\'s rule'}. ${sys.name} waits for your review; nothing changes until you apply it.` : v1 ? 'Sky: your first-round system' : 'Sky: SWG\'s rule' }), badge,
      btn('Preview its system', `See this sky as ${sys.name} would draw it (nothing changes)`, () => previewStar(id, true)));
  }
  box.append(btn('System view', 'The whole system as an orrery, with its dials', () => openSystemView(id, world)));
  if (r.rule) box.append(el('span', { class: 'skynow', id: long ? 'skyNowBox' : 'skyNowLine' }));
}
function starStatus(id) {
  const e = state.starSystems[id];
  const s = e?.system;
  if (s?.future) return { word: 'Made by a newer viewer', cls: 'own', applied: false, future: true };
  const applied = starApplied(id);
  if (!s) return draftSystem(id) ? { word: applied ? 'Draft, applied' : 'Draft', cls: applied ? 'applied' : 'draft', applied, draft: true } : { word: 'No system', cls: '', applied: false, none: true };
  if (s.draft) return { word: applied ? 'Draft, applied' : 'Draft, edited', cls: applied ? 'applied' : 'draft', applied, draft: true, edited: true };
  return { word: applied ? 'Your own, applied' : 'Your own, not applied', cls: applied ? 'applied' : 'own', applied, own: true };
}
function renderSkyRule(world) {
  const box = $('skyRule');
  box.textContent = '';
  skyRuleParts(world, box);
  refreshSkyNowLine();
}
function skyRuleBox(world) {
  const box = el('div', { class: 'words skybox' });
  box.append(el('h4', { text: 'This world\'s sky' }));
  const line = el('div', { class: 'row' });
  skyRuleParts(world, line, { long: true });
  box.append(line);
  return box;
}
const altDeg = (o, j) => Math.round((Math.asin(Math.max(-1, Math.min(1, o.dir[3 * j + 1]))) * 180) / Math.PI);
function skyWords(c) {
  const o = c.out, M = c.model;
  const sj = c.v2 ? M.casterJ : M.items.findIndex((it) => it.body === M.sunI);
  const sunUp = sj >= 0 && o.dir[3 * sj + 1] > 0;
  const bits = [`night light ${o.night.toFixed(2)}`, sunUp ? `the sun ${altDeg(o, sj)}° up, daylight ${Math.round(o.daylight * 100)}%${o.daylight < 0.995 ? ' (an eclipse)' : ''}` : 'the sun is down'];
  const wp = M.parent[M.worldI];
  if (wp >= 0 && wp !== M.sunI) {
    const j = M.items.findIndex((it) => it.body === wp);
    if (j >= 0) bits.push(`${M.items[j].name} ${Math.round(o.lit[j] * 100)}% lit, ${altDeg(o, j)}° up`);
  }
  return bits.join(' · ');
}
function refreshSkyNowLine() {
  const p = state.mode === 'place' ? state.placesById.get(state.placeId) : null;
  const c = p && !p.space ? skyNow(p.zone) : null;
  for (const id of ['skyNowLine', 'skyNowBox']) {
    const n = $(id);
    if (n) n.textContent = c ? `${clockText(state.hours)}${c.v2 ? ` of ${worldName(p.zone)}'s day, ${clockWords()}` : `, day ${state.day}`}: ${skyWords(c)}` : '';
  }
}
/** The place page's words about a place under its world's system. */
function systemWords(p, where) {
  const sysSky = p.space ? null : skyNow(p.zone);
  if (!sysSky) return;
  const world = worldName(p.zone);
  const r = skyRule(p.zone);
  const sys = sysSky.model.sys;
  const how = r.rule === 'one-world' ? 'the first round\'s, applied' : r.preview ? 'previewed, not applied' : 'applied';
  const j = sysSky.model.itemOf.get(p.id);
  if (sysSky.model.hidden.has(p.id)) { where.length = 0; where.push(`From ${world}'s ground: hidden while its system (${how}) is its sky; the system stands for it.`); return; }
  if (j === undefined) { where.unshift(`Its world's system (${how}) does not name it, so SWG's rule places it.`); return; }
  const it = sysSky.model.items[j], body = sys.bodies[it.body];
  const round = sys.bodies.find((b) => b.id === body.parent);
  where.length = 0;
  const group = body.kind === 'group' ? `one of ${body.name}, moving together` : body.kind === 'pair' ? `${it.name}, one of ${body.name} (side by side, never overlapping)` : body.name;
  const orbit = round ? `, going round ${round.name}${body.period > 0 ? ` once in ${fmtNum(body.period)} ${sysSky.v2 ? 'real ' : ''}days` : ''}` : '';
  const clock = sysSky.v2 ? 'on the real clock, the same for every player' : 'the sun on the game\'s clock';
  const own = sysSky.v2 && sysSky.model.itemSpin[j] > 0 ? ` It turns once in ${fmtNum(360 / sysSky.model.itemSpin[j] * 24)} real hours.` : '';
  where.push(`From ${world}'s ground, where its system (${how}) puts it: ${group}${orbit}. Its direction and its phase follow where it and the sun really are, ${clock}.${own} ${deg1(sysSky.model.itemSize[j])} across.`);
}

// ---- the System view ----

function wireSystemStage() {
  orrery = new Orrery($('orrery'), {
    onSelect: (i) => { const b = starOf(state.sysId)?.bodies[i]; if (b) { state.sysSel = b.id; openBodies.add(state.sysId + ':' + b.id); renderSystemPanelSoon(); } },
    onDrag: (i, delta) => {
      const id = state.sysId;
      const bid = starOf(id)?.bodies[i]?.id;
      const t = bid && editableStar(id).bodies.find((x) => x.id === bid);
      if (!t) return;
      t.start = Math.round(((((t.start + delta + 180) % 360) + 360) % 360 - 180) * 10) / 10;
      systemEdited();
    },
    onDragEnd: () => renderSystemPanelSoon(),
  });
  $('day').addEventListener('input', () => { state.day = +$('day').value; $('dayOut').textContent = String(state.day); refreshWordsSoon(); refreshSkyNowLine(); });
  $('date').addEventListener('input', () => { setDateOffset(+$('date').value); updatePlaceBar(); refreshWordsSoon(); });
  $('nowBtn').addEventListener('click', () => { clockNow(); state.playing = false; updatePlaceBar(); refreshWordsSoon(); });
  $('sysTime').addEventListener('input', () => { setHourOfWorld(+$('sysTime').value); updateSystemBar(); });
  $('sysDate').addEventListener('input', () => { setDateOffset(+$('sysDate').value); updateSystemBar(); });
  $('sysNowBtn').addEventListener('click', () => { clockNow(); state.playing = false; updateSystemBar(); });
  $('sysPlay').addEventListener('click', () => { state.playing = !state.playing; updateSystemBar(); });
  $('sysSpeed').addEventListener('change', () => { state.sysSpeed = +$('sysSpeed').value; });
  $('trueScale').addEventListener('change', () => { orrery.view.trueScale = $('trueScale').checked; });
  $('sysCentre').addEventListener('change', () => { orrery.view.centre = $('sysCentre').value; });
  $('sysGround').addEventListener('click', () => seeFromGround(state.sysId));
  $('sysBack').addEventListener('click', () => show(state.currentId && state.looks[state.currentId] ? state.currentId : 'naboo', { frame: true }));
}
function updateSystemBar() {
  const c = clockModel();
  syncHours();
  const st = $('sysTime');
  if (Math.abs(+st.value - state.hours) > 1e-6) st.value = state.hours;
  const off = dateOffsetDays();
  if (+$('sysDate').value !== off) $('sysDate').value = off;
  $('sysTimeOut').textContent = c ? `${clockText(state.hours)} of ${worldName(c.world)}'s ${fmtNum(c.model.dayDays * 24)}-hour day` : clockText(state.hours);
  $('sysDateOut').textContent = clockWords();
  $('sysNowBtn').classList.toggle('on', state.live);
  $('sysPlay').textContent = state.playing ? 'Pause' : 'Play';
  $('sysPlay').setAttribute('aria-pressed', state.playing ? 'true' : 'false');
}
let sysWordsClock = 0;
function drawSystem() {
  const id = state.sysId;
  const c = id ? starAt(id, standOf(id)) : null;
  if (!c) return;
  orrery.setModel(c.model, c.out);
  orrery.draw({ selected: c.model.sys.bodies.findIndex((b) => b.id === state.sysSel) });
  if (state.live && !state.playing && ++sysWordsClock % 30 === 0) updateSystemBar();
  if (sysWordsClock % 12 === 0 || state.playing) {
    const n = $('sysNow');
    if (n) n.textContent = `${clockText(state.hours)} of ${worldName(c.world)}'s day, ${clockWords()}: ${skyWords(c)}.`;
  }
  if (state.playing) sysWordsClock++;
}
/** Open the System view on a system (its id, or a world it holds), standing on one of its ground worlds. */
function openSystemView(x, world = null) {
  if (!x) return;
  let id = starOf(x) ? x : systemIdOf(x);
  if (!id) id = startOwn(x);
  if (!starOf(id)) return;
  const sys = starOf(id);
  if (world && sys.grounds.some((g) => g.world === world)) state.sysStand[id] = world;
  else if (!starOf(x) && sys.grounds.some((g) => g.world === x)) state.sysStand[id] = x;
  state.sysId = id;
  state.sysWorld = standOf(id);
  if (state.mode === 'place') {
    placeView.close();
    if (state.current) state.current.root.visible = true;
    state.backdropHolder.visible = true;
  }
  state.build++;
  setStatus('');
  state.mode = 'system';
  state.playing = false;
  $('view').style.visibility = 'hidden';
  $('marks').hidden = true;
  $('orrery').hidden = false;
  $('lookGroup').textContent = `System · ${sys.name} · from ${worldName(standOf(id))} · ${starStatus(id).word}`;
  $('lookName').textContent = sys.name;
  $('hint').textContent = 'Drag a body along its orbit to move where it starts · drag the sky to turn the view · wheel to zoom · F puts the view back.';
  updatePlaceBar();
  showTab('system');
  markLibrary();
  state.readyAt = state.frames + 3;
}
function leaveSystemView(to) {
  $('orrery').hidden = true;
  $('view').style.visibility = '';
  $('marks').hidden = false;
  state.mode = to === 'place' ? 'place' : 'look';
  state.playing = false;
  if (to !== 'place') showTab('look');
}

// ---- the System tab ----

let sysPanelTimer = 0;
function renderSystemPanelSoon() { clearTimeout(sysPanelTimer); sysPanelTimer = setTimeout(renderSystemPanel, 30); }

/** The systems the tab lists: every draft, then his own. */
function systemList() {
  const set = new Set(DRAFT_SYSTEMS);
  for (const id of Object.keys(state.starSystems)) set.add(id);
  return [...set];
}

const fmtNum = (v) => { const a = Math.abs(v); return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : a >= 0.01 ? v.toFixed(3) : v.toPrecision(2); };

/** Where a setting resets to: the draft's value (for a system from the draft), else as made, else the dial's start. */
function sysResetValue(id, find, key) {
  const sys = starOf(id);
  const base = sys?.draft ? draftSystem(id) : state.madeStar[id]?.system || null;
  const v = base ? find(base) : undefined;
  if (v && v[key] !== undefined) return { value: v[key], from: sys?.draft ? 'the draft' : 'as made' };
  const d = SYS_DIALS[key];
  return d && d.start !== undefined ? { value: d.start, from: 'its start' } : null;
}

/** A dial of a system: a slider (on a log scale for periods and radii), its value, its ↺, and where its number comes from. */
function sysDial({ label, key, value, onSet, reset, title = '', disabled = false, emptyWord = '', src = null }) {
  const d = SYS_DIALS[key];
  const log = !!d.log;
  const toS = (v) => (log ? Math.log10(Math.max(d.min, v)) : v);
  const fromS = (s) => (log ? +(10 ** +s).toPrecision(4) : +s);
  const input = el('input', { type: 'range', min: toS(d.min), max: toS(d.max), step: log ? 0.001 : d.step || 0.1, title });
  const shown = value ?? null;
  input.value = shown === null ? toS(d.min) : toS(shown);
  input.disabled = disabled;
  const out = el('output', { text: shown === null ? emptyWord : fmtNum(shown) + d.unit });
  const rb = reset ? resetButton({ value: reset.value ?? '', from: reset.from }, shown ?? '', (v) => { onSet(v === '' ? null : v); renderSystemPanel(); }) : el('span');
  if (reset && reset.value === null) rb.title = `Reset to the place's own (${reset.from})`;
  if (disabled && rb.tagName === 'BUTTON') rb.disabled = true;
  input.addEventListener('input', () => {
    const v = fromS(input.value);
    out.textContent = fmtNum(v) + d.unit;
    onSet(v);
    if (rb.tagName === 'BUTTON') rb.disabled = sameValue(v, reset.value ?? '');
  });
  input.addEventListener('dblclick', () => { if (reset) { onSet(reset.value); renderSystemPanel(); } });
  const tip = src === null ? title : `${title}${title ? ' · ' : ''}${src ? 'Lore: ' + src : 'Our guess'}`;
  return el('div', { class: 'ctl' + (src === null ? '' : src ? ' lore' : ' guess'), title: tip }, el('span', { text: label, title: tip }), input, out, rb);
}

function renderSystemPanel() {
  const panel = $('systemPanel');
  if (!panel || panel.hidden) return;
  const scroll = panel.scrollTop;
  panel.textContent = '';
  let id = state.sysId;
  if (!id) { const p = state.mode === 'place' ? state.placesById.get(state.placeId) : null; if (p && !p.space) id = systemIdOf(p.zone); }
  const btn = (text, title, fn, cls = 'small') => el('button', { type: 'button', class: cls, title, onclick: fn }, text);
  const pick = el('select', { 'aria-label': 'System' });
  if (!id) pick.append(el('option', { value: '', text: '(choose a system)' }));
  for (const s of systemList()) { const sy = starOf(s); pick.append(el('option', { value: s, text: `${sy ? sy.name : s} · ${starStatus(s).word}` })); }
  pick.value = id || '';
  pick.addEventListener('change', () => { state.sysId = pick.value || null; if (state.mode === 'system' && state.sysId) openSystemView(state.sysId); else renderSystemPanel(); });
  panel.append(el('div', { class: 'ctl' }, el('span', { text: 'System' }), pick, el('span'), el('span')));
  panel.append(el('p', { class: 'note', text: 'One clockwork model per star, holding every body the lore gives it, on the real clock: every body you do not stand on moves at its own rates, the same for every player; the world you stand on turns once every few hours. A draft waits for every system; the skies of its ground worlds follow it only after you press Apply, which is for all of them at once. Space zones never move.' }));
  // a world on show that no system holds: make one of its own
  const p = state.mode === 'place' ? state.placesById.get(state.placeId) : null;
  if (p && !p.space && !systemIdOf(p.zone)) panel.append(el('div', { class: 'row' }, el('span', { text: `${worldName(p.zone)} is in no system. ` }), btn('Make one of its own', 'Its sun and the world, to add to', () => openSystemView(startOwn(p.zone), p.zone))));
  if (!id) return;
  state.sysId = id;
  const st = starStatus(id);
  if (st.future) { panel.append(el('p', { class: 'note', text: 'This system was made by a newer viewer: it is kept as it is in the file, and its worlds show SWG\'s sky.' })); return; }
  const sys = starOf(id);
  if (!sys) return;
  const world = standOf(id);
  const c = starAt(id, world);
  const M = c.model;
  state.sysWorld = world;
  panel.append(el('div', { class: 'place-head' }, el('strong', {}, sys.name, ' ', el('span', { class: 'sysbadge ' + st.cls, text: st.word })), el('code', { text: `${id} · ground worlds: ${sys.grounds.map((g) => g.world).join(', ')}` })));
  const many = sys.grounds.length > 1 ? ` (all ${sys.grounds.length} of its ground worlds)` : '';
  const row = el('div', { class: 'row' });
  if (st.applied) row.append(btn('Back to SWG\'s sky', `Every ground world of this system follows SWG's rule again${many} (the system is kept)`, () => unapplyStar(id)));
  else row.append(btn('Apply', `Make the sky of every ground world of this system follow it${many} (saved with the choices)`, () => applyStar(id), 'small primary'));
  row.append(btn('See it from the ground', `This sky from ${worldName(world)}'s ground, at this moment (a preview until applied)`, () => seeFromGround(id, world)));
  if (state.mode !== 'system') row.append(btn('System view', 'The whole system as an orrery', () => openSystemView(id, world)));
  if (draftSystem(id) && state.starSystems[id]?.system) row.append(btn('Back to the draft', 'Drop your changes to this system and take the draft again', () => backToDraft(id)));
  panel.append(row);
  panel.append(el('p', { class: 'note', text: st.applied ? `Applied: the skies of ${sys.grounds.map((g) => worldName(g.world)).join(', ')} follow the system below. Bodies it names move as it says; places it does not name keep SWG's rule; places it hides are hidden.` : `${st.draft ? (st.edited ? 'An edited draft' : 'A draft') : 'Your own system'}: not a sky until you apply it. ${sys.note || ''}` }));
  // first-round skies of its worlds, still drawn until this is applied
  const old = sys.grounds.filter((g) => state.systems[g.world]?.applied && systemOfV1(g.world));
  if (old.length) panel.append(el('p', { class: 'note warn', text: `${old.map((g) => worldName(g.world)).join(' and ')} still ${old.length > 1 ? 'draw' : 'draws'} the one-world sky you applied in the first round, until you apply this system: Apply sets ${old.length > 1 ? 'those' : 'it'} aside (kept in your file; Undo brings ${old.length > 1 ? 'them' : 'it'} back).` }, ...old.map((g) => btn(`Set ${worldName(g.world)}'s aside now`, 'Back to SWG\'s sky for that world, until you apply this system', () => unapplyV1(g.world)))));

  // where you stand
  const standSel = el('select', { 'aria-label': 'Where you stand' });
  for (const g of sys.grounds) standSel.append(el('option', { value: g.world, text: `${worldName(g.world)}${g.copy ? ` (a copy of ${worldName(g.copy)}'s sky)` : ` · on ${sys.bodies.find((b) => b.id === g.body)?.name}`}` }));
  standSel.value = world;
  standSel.addEventListener('change', () => { state.sysStand[id] = standSel.value; state.sysWorld = standSel.value; if (state.mode === 'system') openSystemView(id, standSel.value); else renderSystemPanel(); });
  panel.append(el('h3', { text: 'Where you stand' }));
  panel.append(el('div', { class: 'ctl' }, el('span', { text: 'Ground world' }), standSel, el('span'), el('span')));
  panel.append(groundEditor(id, sys, world, c));

  // its name
  const nameIn = el('input', { type: 'text', value: sys.name, 'aria-label': 'System name' });
  nameIn.addEventListener('change', () => { editableStar(id).name = nameIn.value.trim().slice(0, 80) || 'System'; systemEdited(true); });
  panel.append(el('div', { class: 'ctl' }, el('span', { text: 'Name' }), nameIn, el('span'), el('span')));

  panel.append(el('h3', { text: 'Its bodies' }));
  panel.append(el('p', { class: 'note', text: `Settings marked with a gold edge come from the lore (their source on hover); the rest are our guesses. A body's place is the place it takes in ${worldName(world)}'s sky; from another ground world choose it there.` }));
  for (const b of sys.bodies) panel.append(bodyEditor(id, sys, b, M, world));
  if (sys.bodies.length < MAX_BODIES2) {
    const add = el('div', { class: 'row' });
    const addBody = (kind) => {
      const s = editableStar(id);
      let k = 1;
      while (s.bodies.some((x) => x.id === `${kind}${k}`)) k++;
      const wid = groundOf(s, world).body;
      const parent = kind === 'moon' || kind === 'group' ? wid : s.bodies.find((x) => !x.parent).id;
      const b = { id: `${kind}${k}`, kind, name: `New ${kind}`, parent, places: [], look: null, drawn: true, period: kind === 'moon' || kind === 'group' ? 20 : kind === 'star' ? 60 : 500, radius: kind === 'moon' || kind === 'group' ? 0.004 : kind === 'star' ? 0.2 : 1.5, tilt: 0, node: 0, start: 0, size: kind === 'moon' ? 4 : 1, sizes: {}, spinHours: 0, axialTilt: 0, turns: 0, brightness: 1, colour: null, locked: false, wobble: 0, src: {}, note: '' };
      if (kind === 'group') b.members = [];
      s.bodies.push(b);
      state.sysSel = b.id;
      openBodies.add(id + ':' + b.id);
      systemEdited(true);
    };
    for (const k of ['moon', 'planet', 'giant', 'star', 'group']) add.append(btn(`+ ${k}`, `Add a ${k} to the system`, () => addBody(k)));
    panel.append(add);
  }

  // the places of this world it does not name
  const linked = new Set(M.items.map((it) => it.place).filter(Boolean));
  const free = state.places.filter((q) => q.zone === world && !linked.has(q.id));
  if (free.length) {
    panel.append(el('h3', { text: `${possessiveName(world)} places it does not name` }));
    panel.append(el('p', { class: 'note', text: 'While the system applies, these keep SWG\'s rule, unless hidden here (a sheet of moons the system stands for, say).' }));
    for (const q of free) {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = sys.hide.includes(q.id);
      cb.addEventListener('change', () => {
        const s = editableStar(id);
        s.hide = s.hide.filter((h) => h !== q.id);
        if (cb.checked) s.hide.push(q.id);
        systemEdited(true);
      });
      panel.append(el('div', { class: 'ctl check' }, el('label', {}, cb, ` Hide ${q.shortLabel || q.label} `, el('code', { text: q.id }))));
    }
  }
  panel.scrollTop = scroll;
}

/** Where you stand: the globe, the latitude and longitude, the world's day, its tilt and its time of year, and what they give. */
function groundEditor(id, sys, world, c) {
  const M = c.model;
  const g = groundOf(sys, world);
  const box = el('div', { class: 'words ground' });
  const raw = sys.grounds.find((x) => x.world === world);
  const base = sys.grounds.find((x) => x.world === g.base);
  const body = sys.bodies.find((b) => b.id === g.body);
  const setG = (w, k, v) => { const s = editableStar(id); const t = s.grounds.find((x) => x.world === w); if (t) { t[k] = v; systemEdited(); } };
  const setB = (k, v, structure = false) => { const s = editableStar(id); const t = s.bodies.find((x) => x.id === g.body); if (t) { t[k] = v; systemEdited(structure); } };
  const RG = (w, k) => sysResetValue(id, (s) => s.grounds.find((x) => x.world === w), k);
  const RB = (k) => sysResetValue(id, (s) => s.bodies.find((x) => x.id === g.body), k);
  box.append(el('h4', { text: `${worldName(world)}, on ${body.name}` }));
  if (raw.copy) box.append(el('p', { class: 'note', text: `A copy of ${worldName(raw.copy)}'s sky: it stands on ${body.name} on ${worldName(raw.copy)}'s day and time of year. Its latitude and longitude follow ${worldName(raw.copy)}'s unless you set its own here.` }));
  if (raw.note || base.note) box.append(el('p', { class: 'note', text: raw.note || base.note }));
  box.append(globeCanvas(id, sys, world, c));
  const latKey = raw.copy ? world : g.base, setLL = (k, v) => setG(latKey, k, v);
  box.append(sysDial({ label: 'Latitude', key: 'lat', value: g.lat, onSet: (v) => setLL('lat', v), reset: RG(latKey, 'lat'), title: 'How far north (or south) of its equator the play area sits: with the tilt and the time of year it sets how high the sun climbs. Click the globe to set it.', src: '' }));
  box.append(sysDial({ label: 'Longitude', key: 'lon', value: g.lon, onSet: (v) => setLL('lon', v), reset: RG(latKey, 'lon'), title: M.locked ? 'East of the point under what it is locked to: it sets how high that body stands (overhead at 0, on the horizon at 90, never seen past it)' : 'Where round its world the play area sits: it moves the hour of its day against the real clock', src: '' }));
  const day = base.dayHours;
  box.append(sysDial({ label: 'Day length', key: 'dayHours', value: day, onSet: (v) => setG(g.base, 'dayHours', v), reset: RG(g.base, 'dayHours'), title: `The whole day of ${body.name} as the game turns it, 2 to 6 hours (daylight and night each 1 to 3 at its equator). Its lore day is ${body.spinHours ? fmtNum(body.spinHours) + ' hours' : 'not known'}; the default is that over six, held to 2..6.`, disabled: !!raw.copy, src: '' }));
  box.append(sysDial({ label: 'Axial tilt', key: 'axialTilt', value: body.axialTilt, onSet: (v) => setB('axialTilt', v), reset: RB('axialTilt'), title: M.locked ? `How far its orbit round ${sys.bodies.find((b) => b.id === body.parent)?.name} leans from its parent's path round the sun (its spin axis is that orbit's)` : 'How far its spin axis leans from its orbit', src: body.src?.axialTilt || '' }));
  box.append(sysDial({ label: 'Time of year', key: 'season', value: base.season, onSet: (v) => setG(g.base, 'season', v), reset: RG(g.base, 'season'), title: 'Fixed for good: 0 an equinox, 90 the north\'s midsummer, -90 its midwinter, 180 the other equinox. The sun\'s path never changes over the real year.', disabled: !!raw.copy, src: '' }));
  if (M.lockable) {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = !!body.locked;
    cb.addEventListener('change', () => setB('locked', cb.checked, true));
    const rv = RB('locked');
    box.append(el('div', { class: 'ctl', title: 'Locked: it spins as it orbits, so what it goes round stands still in its sky (its orbit is its game day). Turning: what it goes round rises and sets.' },
      el('span', { text: 'Spin' }), el('label', { class: 'inline' }, cb, ` locked to ${sys.bodies.find((b) => b.id === body.parent)?.name}`), el('span', { text: body.locked ? 'LOCKED' : 'TURNING' }), rv ? resetButton(rv, !!body.locked, (v) => setB('locked', !!v, true)) : el('span')));
    if (body.locked) box.append(sysDial({ label: 'Wobble', key: 'wobble', value: body.wobble, onSet: (v) => setB('wobble', v), reset: RB('wobble'), title: 'How far what it is locked to swings back and forth each day', src: '' }));
  }
  // what they give
  const dl = daylightHours(g.lat, body.axialTilt, base.season, day);
  const nh = noonHeight(g.lat, body.axialTilt, base.season);
  const dec = declination(body.axialTilt, base.season);
  const rise = 12 - (12 * dl.day) / day, set = 12 + (12 * dl.day) / day;
  const out = [`The sun stands ${fmtNum(Math.min(90, nh))}° up at noon (declination ${fmtNum(dec)}°), up from ${clockText(rise)} to ${clockText(set)} of its day: ${fmtNum(dl.day)} hours of daylight and ${fmtNum(dl.night)} of night in its ${fmtNum(day)}-hour day.`];
  if (dl.day < 1 || dl.day > 3 || dl.night < 1 || dl.night > 3) out.push('That is outside 1 to 3 hours each: move the day, the latitude or the time of year to bring it back.');
  if (M.locked) {
    const pj = M.items.findIndex((it) => it.body === M.parent[M.worldI]);
    if (pj >= 0) {
      const a = Math.asin(Math.max(-1, Math.min(1, c.out.dir[3 * pj + 1]))) * 180 / Math.PI;
      const az = Math.atan2(c.out.dir[3 * pj], -c.out.dir[3 * pj + 2]) * 180 / Math.PI;
      out.push(`${M.items[pj].name} stands still ${fmtNum(a)}° up, ${directionWords(az, a).replace(/,.*$/, '')}, ${a < 0 ? 'below the horizon: this side never sees it' : 'phasing once a day (full at midnight) and passing in front of the sun once a day'}.`);
    }
  } else if (M.lockable) out.push(`It turns: ${sys.bodies.find((b) => b.id === body.parent)?.name} rises and sets, a little later each day.`);
  box.append(el('p', { class: 'now', text: out.join(' ') }));
  box.append(el('p', { class: 'now', id: 'sysNow', text: `${clockText(state.hours)} of ${worldName(world)}'s day, ${clockWords()}: ${skyWords(c)}.` }));
  return box;
}

/** The globe of the world you stand on: click to put the play area there, drag to turn it. */
function globeCanvas(id, sys, world, c) {
  const M = c.model;
  const g = groundOf(sys, world);
  const body = sys.bodies.find((b) => b.id === g.body);
  const W = 232, H = 196, R = 84, cx = W / 2, cy = H / 2 + 4, lean = 18 * Math.PI / 180;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cv = el('canvas', { class: 'globe', width: Math.round(W * dpr), height: Math.round(H * dpr), title: `${body.name}: click to put the play area there, drag to turn the globe` });
  cv.style.width = W + 'px';
  cv.style.height = H + 'px';
  const ctx = cv.getContext('2d');
  if (state.globeFor !== id + world) { state.globeFor = id + world; state.globeLon = g.lon; }
  const D = Math.PI / 180;
  const proj = (lat, lon) => {
    const f = lat * D, l = (lon - state.globeLon) * D;
    const x = Math.cos(f) * Math.sin(l), y = Math.cos(lean) * Math.sin(f) - Math.sin(lean) * Math.cos(f) * Math.cos(l), z = Math.sin(lean) * Math.sin(f) + Math.cos(lean) * Math.cos(f) * Math.cos(l);
    return [cx + R * x, cy - R * y, z];
  };
  const unproj = (px, py) => {
    const x = (px - cx) / R, y = (cy - py) / R, r2 = x * x + y * y;
    if (r2 > 1) return null;
    const z = Math.sqrt(1 - r2);
    const lat = Math.asin(Math.max(-1, Math.min(1, y * Math.cos(lean) + z * Math.sin(lean)))) / D;
    const lon = state.globeLon + Math.atan2(x, z * Math.cos(lean) - y * Math.sin(lean)) / D;
    return { lat, lon: ((((lon + 180) % 360) + 360) % 360) - 180 };
  };
  const line = (pts, style, width = 1, dash = []) => {
    ctx.strokeStyle = style; ctx.lineWidth = width; ctx.setLineDash(dash);
    ctx.beginPath();
    let on = false;
    for (const [a, b] of pts) { const [x, y, z] = proj(a, b); if (z < 0) { on = false; continue; } if (on) ctx.lineTo(x, y); else ctx.moveTo(x, y); on = true; }
    ctx.stroke();
    ctx.setLineDash([]);
  };
  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const base = body.colour || (M.locked ? '#4f6a45' : '#5a7a8c');
    const grad = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    grad.addColorStop(0, base); grad.addColorStop(1, '#0b1216');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    // a locked world's far side, which never sees what it is locked to
    if (M.locked) {
      ctx.fillStyle = 'rgba(0,0,0,0.42)';
      for (let lat = -87; lat <= 87; lat += 6) for (let lon = 93; lon <= 267; lon += 6) { const [x, y, z] = proj(lat, lon); if (z > 0) ctx.fillRect(x - 2.4, y - 2.4, 4.8, 4.8); }
    }
    for (let lat = -60; lat <= 60; lat += 30) line(Array.from({ length: 73 }, (_, k) => [lat, k * 5 - 180]), lat === 0 ? 'rgba(220,235,230,0.55)' : 'rgba(200,215,210,0.22)', lat === 0 ? 1.2 : 1);
    for (let lon = -180; lon < 180; lon += 30) line(Array.from({ length: 37 }, (_, k) => [k * 5 - 90, lon]), lon === 0 ? 'rgba(220,235,230,0.45)' : 'rgba(200,215,210,0.18)');
    // the sun's latitude at this time of year (where it stands overhead at noon)
    const dec = declination(body.axialTilt, sys.grounds.find((x) => x.world === g.base).season);
    if (Math.abs(dec) > 0.2) line(Array.from({ length: 73 }, (_, k) => [dec, k * 5 - 180]), 'rgba(255,214,122,0.6)', 1, [3, 3]);
    ctx.font = '10px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    if (M.locked) {
      const [x, y, z] = proj(0, 0);
      if (z > 0) { ctx.fillStyle = '#e3c26a'; ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); ctx.fillText(`under ${sys.bodies.find((b) => b.id === body.parent)?.name}`, x + 5, y - 7); }
    }
    const [px, py, pz] = proj(g.lat, g.lon);
    ctx.globalAlpha = pz > 0 ? 1 : 0.35;
    ctx.strokeStyle = '#6fd3a0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#bff0d4';
    ctx.fillText('play area', px + 8, py + 1);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(201,214,210,0.85)';
    ctx.fillText(`${fmtNum(g.lat)}°, ${fmtNum(g.lon)}°`, 6, H - 8);
    ctx.fillText('N', cx - 3, cy - R * Math.cos(lean) - 8);
  };
  draw();
  let down = null;
  cv.addEventListener('pointerdown', (e) => { const r = cv.getBoundingClientRect(); down = { x: e.clientX - r.left, y: e.clientY - r.top, lon: state.globeLon, moved: false }; cv.setPointerCapture?.(e.pointerId); });
  cv.addEventListener('pointermove', (e) => {
    if (!down) return;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left;
    if (!down.moved && Math.abs(x - down.x) < 4) return;
    down.moved = true;
    state.globeLon = down.lon - (x - down.x) * 0.8;
    draw();
  });
  cv.addEventListener('pointerup', (e) => {
    if (!down) return;
    const r = cv.getBoundingClientRect();
    const was = down;
    down = null;
    if (was.moved) return;
    const at = unproj(e.clientX - r.left, e.clientY - r.top);
    if (!at) return;
    const s = editableStar(id);
    const raw = s.grounds.find((x) => x.world === world);
    const t = raw.copy ? raw : s.grounds.find((x) => x.world === g.base);
    t.lat = Math.round(Math.max(-89, Math.min(89, at.lat)) * 2) / 2;
    t.lon = Math.round(at.lon * 2) / 2;
    systemEdited(true);
  });
  return cv;
}

function bodyEditor(id, sys, b, M, world) {
  const key = id + ':' + b.id;
  const isSun = !b.parent;
  const ground = sys.grounds.filter((g) => !g.copy && g.body === b.id);
  const isWorld = M.sys.bodies[M.worldI]?.id === b.id;
  const det = el('details', { class: 'layer sysbody' + (state.sysSel === b.id ? ' current' : '') });
  det.open = openBodies.has(key);
  det.addEventListener('toggle', () => { if (det.open) { openBodies.add(key); state.sysSel = b.id; } else openBodies.delete(key); });
  const parent = sys.bodies.find((x) => x.id === b.parent);
  const words = isWorld ? 'where you stand' : ground.length ? `a ground world (${ground.map((g) => worldName(g.world)).join(', ')})` : isSun ? 'the sun' : `${b.kind}${parent ? ', round ' + parent.name : ''}`;
  const here = (list) => list.find((p) => p.startsWith(world + ':'));
  const link = b.kind === 'group' ? `${(b.members || []).length} together` : b.kind === 'pair' ? 'two suns, side by side' : here(b.places) ? here(b.places).replace(/^[^:]*:/, '') : b.drawn ? (isWorld ? '' : 'no place here') : 'not drawn';
  det.append(el('summary', {}, el('span', { class: 'slot', text: b.name }), el('span', { class: 'tex', text: [words, link].filter(Boolean).join(' · ') })));
  const body = el('div', { class: 'body' });
  det.append(body);
  const s = () => editableStar(id).bodies.find((x) => x.id === b.id);
  const set = (k, v, structure = false) => { const t = s(); if (!t) return; t[k] = v; systemEdited(structure); };
  const R = (k) => sysResetValue(id, (sy) => sy.bodies.find((x) => x.id === b.id), k);
  const src = (k) => b.src?.[k] ?? '';
  const dial = (k, label, title, opts = {}) => body.append(sysDial({ label, key: k, value: b[k], onSet: (v) => set(k, v), reset: R(k), title, src: src(k), ...opts }));
  const check = (label, k, text, title) => {
    const cb = el('input', { type: 'checkbox' });
    cb.checked = !!b[k];
    cb.addEventListener('change', () => set(k, cb.checked, true));
    const rv = R(k);
    const rb = rv ? resetButton(rv, !!b[k], (v) => set(k, !!v, true)) : el('span');
    body.append(el('div', { class: 'ctl', title }, el('span', { text: label }), el('label', { class: 'inline' }, cb, ' ' + text), el('span'), rb));
  };
  const select = (label, value, options, onPick, rv) => {
    const sel = el('select', { 'aria-label': label });
    for (const [v, t] of options) sel.append(el('option', { value: v, text: t }));
    sel.value = value ?? '';
    sel.addEventListener('change', () => onPick(sel.value || null));
    const rb = rv ? resetButton({ value: rv.value ?? '', from: rv.from }, value ?? '', (v) => onPick(v || null)) : el('span');
    body.append(el('div', { class: 'ctl' }, el('span', { text: label }), sel, el('span'), rb));
  };
  // a list of places with this world's entry swapped
  const withPlace = (list, pid) => [...list.filter((q) => !q.startsWith(world + ':')), ...(pid ? [pid] : [])];
  const worldPlaces = state.places.filter((q) => q.zone === world);
  const placeOptions = [['', `(none in ${worldName(world)}'s sky: drawn with a look)`], ...worldPlaces.map((q) => [q.id, q.shortLabel || q.label])];

  if (b.note) body.append(el('p', { class: 'note', text: b.note }));
  const srcs = Object.entries(b.src || {});
  body.append(el('p', { class: 'note src', text: srcs.length ? `From the lore: ${srcs.map(([k, v]) => `${k === 'spinHours' ? 'its day' : k === 'axialTilt' ? 'its tilt' : k} (${v})`).join('; ')}. Every other number is our guess.` : 'Every number here is our guess.' }));
  const nameIn = el('input', { type: 'text', value: b.name, 'aria-label': 'Name' });
  nameIn.addEventListener('change', () => set('name', nameIn.value.trim().slice(0, 80) || b.id, true));
  body.append(el('div', { class: 'ctl' }, el('span', { text: 'Name' }), nameIn, el('span'), el('span')));
  if (!isSun) {
    const kinds = ground.length ? GROUND_KINDS : SYS_KINDS.filter((k) => k !== 'pair');
    select('Kind', b.kind, kinds.map((k) => [k, k]), (v) => { const t = s(); t.kind = v || 'moon'; if (t.kind === 'group' && !t.members) t.members = []; systemEdited(true); }, R('kind'));
    const below = new Set([b.id]);
    let grew = true;
    while (grew) { grew = false; for (const x of sys.bodies) if (x.parent && below.has(x.parent) && !below.has(x.id)) { below.add(x.id); grew = true; } }
    select('Goes round', b.parent, sys.bodies.filter((x) => !below.has(x.id) && x.kind !== 'group' && x.kind !== 'belt').map((x) => [x.id, x.name]), (v) => v && set('parent', v, true), R('parent'));
  }
  if (b.kind !== 'group' && b.kind !== 'pair' && !isWorld) {
    select(`Place in ${worldName(world)}'s sky`, here(b.places) || '', placeOptions, (v) => set('places', withPlace(b.places, v), true), placeReset(id, (sy) => sy.bodies.find((x) => x.id === b.id), here));
    if (!here(b.places)) {
      const ls = lookSelect(b.look, (v) => set('look', v, true));
      const rv = R('look');
      body.append(el('div', { class: 'ctl' }, el('span', { text: 'Look' }), ls, el('span'), rv ? resetButton({ value: rv.value ?? '', from: rv.from }, b.look ?? '', (v) => set('look', v || null, true)) : el('span')));
    }
    check('Drawn', 'drawn', 'in the sky', 'Drawn in the skies of its system\'s ground worlds (it stays in the model either way)');
  }
  if (!isSun) {
    const locked = M.lockDay?.[sys.bodies.indexOf(b)] > 0;
    if (locked) body.append(sysDial({ label: 'Period', key: 'period', value: M.lockDay[sys.bodies.indexOf(b)], onSet: () => {}, reset: null, disabled: true, title: 'Worked out: locked, it goes round once each game day against the sun', src: null }));
    else if (!b.follows) dial('period', 'Period', 'Real days to go round once (0 stands still)');
    if (!b.follows) dial('radius', 'Orbit size', 'How far out, in astronomical units (a planet\'s orbit about 1, a moon\'s a few thousandths). Decides directions and which body is in front; sizes in the sky are set by eye');
    if (!locked && !b.follows) {
      dial('tilt', 'Orbit tilt', 'How far its orbit leans from the system\'s plane: a moon wanders that far off the sun\'s line');
      dial('node', 'Tilt line', 'The line its orbit leans about, round the plane');
      dial('start', 'Starts at', 'Where round its orbit it is at the epoch, 1 January 2026 (or drag it in the System view)');
    }
    if (b.follows) {
      body.append(el('p', { class: 'note', text: `It sits ${Math.round(b.share * 100)}% of the way from ${parent?.name} to ${sys.bodies.find((x) => x.id === b.follows)?.name}.` }));
      dial('share', 'Share of the way', 'How far along the line between its parent and the body it follows');
    }
  }
  if (!isWorld && b.kind !== 'group' && b.kind !== 'pair') {
    const sz = b.sizes?.[world] ?? null;
    const pid = here(b.places);
    body.append(sysDial({ label: `Size from ${worldName(world)}`, key: 'size', value: sz ?? (pid ? sizeOfPlace(pid) : b.size), onSet: (v) => { const t = s(); if (!t) return; t.sizes = { ...(t.sizes || {}) }; if (v === null) delete t.sizes[world]; else t.sizes[world] = v; systemEdited(); }, reset: { value: null, from: pid ? 'its place\'s own' : 'its size elsewhere' }, title: `The angle it fills in ${worldName(world)}'s sky, by eye (reset: ${pid ? 'its place\'s own size' : 'its size where it has no place'})`, src: null }));
    if (!pid) dial('size', 'Size elsewhere', 'Its angle by eye in a sky where it has no place of its own', { src: null });
  }
  if (b.kind !== 'group' && b.kind !== 'pair' && !STAR_KINDS.includes(b.kind)) {
    if (!ground.length) check('Locked', 'locked', 'its day is its month', 'It turns once each time round (the same face to what it goes round); its look turns that slowly');
    if (!b.locked || ground.length) dial('spinHours', 'Its own day', `How long it takes to turn once, in real hours: its look turns at that rate seen from elsewhere${ground.length ? ' (where you stand on it, it turns at its game day instead)' : ''}`);
  }
  if (b.kind === 'star') dial('brightness', 'Brightness', 'Its share of the daylight (an eclipse of a bright star dims the day more; the brightest casts the light)');
  if (b.kind !== 'pair') {
    const col = el('input', { type: 'color', value: b.colour || '#ffffff' });
    col.addEventListener('input', () => set('colour', col.value));
    const crv = R('colour');
    body.append(el('div', { class: 'ctl' + (b.src?.colour ? ' lore' : ''), title: b.src?.colour ? 'Lore: ' + b.src.colour : '' }, el('span', { text: 'Colour' }), el('div', { class: 'colorline' }, col, el('code', { text: b.colour || '(its kind\'s)' })), el('span'),
      crv ? resetButton({ value: crv.value ?? '', from: crv.from }, b.colour ?? '', (v) => { set('colour', v || null); renderSystemPanel(); }) : el('span')));
  }
  if (b.kind === 'pair') pairEditor(id, b, body, world, placeOptions, withPlace, here);
  if (b.kind === 'group') {
    body.append(el('p', { class: 'note', text: 'Its members move as one along its orbit, keeping their places in the group (along and across the sky\'s turning), each lit by the real sun.' }));
    (b.members || []).forEach((m, mi) => {
      const setM = (k, v, structure = false) => { const t = s(); if (!t?.members?.[mi]) return; t.members[mi][k] = v; systemEdited(structure); };
      const MR = (k) => sysResetValue(id, (sy) => sy.bodies.find((x) => x.id === b.id)?.members?.[mi], k);
      select(`Member ${mi + 1}`, here(m.places || []) || '', placeOptions, (v) => setM('places', withPlace(m.places || [], v), true), placeReset(id, (sy) => sy.bodies.find((x) => x.id === b.id)?.members?.[mi], here));
      for (const [k, label, title] of [['along', 'Along', 'Its place along the group'], ['across', 'Across', 'Its place across the group'], ['size', 'Size', 'Its angle in our sky (empty: its place\'s own)']]) {
        body.append(sysDial({ label: `· ${label}`, key: k, value: m[k], onSet: (v) => setM(k, v), reset: MR(k), title, emptyWord: k === 'size' ? 'place' : '' }));
      }
      body.append(el('div', { class: 'row' }, btn2(`Remove member ${mi + 1}`, () => { const t = s(); t.members.splice(mi, 1); systemEdited(true); })));
    });
    if ((b.members || []).length < MAX_MEMBERS) body.append(el('div', { class: 'row' }, btn2('+ member', () => { const t = s(); (t.members ||= []).push({ name: '', places: [], look: null, along: 0, across: 0, size: 5 }); systemEdited(true); })));
  }
  if (!ground.length && !isSun) body.append(el('div', { class: 'row' }, btn2('Remove this body', () => {
    const t = editableStar(id);
    for (const x of t.bodies) { if (x.parent === b.id) x.parent = b.parent; if (x.follows === b.id) x.follows = null; }
    t.bodies = t.bodies.filter((x) => x.id !== b.id);
    systemEdited(true);
  })));
  return det;
}
const STAR_KINDS = ['star', 'pair'];
/** Where a body's (or a member's) place in this world's sky resets to: the draft's, or as he made it (`here` picks this world's from a list). */
function placeReset(id, find, here) {
  const r = sysResetValue(id, find, 'places');
  return r && Array.isArray(r.value) ? { value: here(r.value) || '', from: r.from } : null;
}
const btn2 =(text, fn) => el('button', { type: 'button', class: 'small', onclick: fn }, text);

/** Tatooine's twin suns: the gap between them, the angle of their line against the sun's path, and each sun. */
function pairEditor(id, b, body, world, placeOptions, withPlace, here) {
  const s = () => editableStar(id).bodies.find((x) => x.id === b.id);
  const R = (k) => sysResetValue(id, (sy) => sy.bodies.find((x) => x.id === b.id), k);
  body.append(el('p', { class: 'note', text: 'One body at the centre: its two suns stand side by side in the sky of whoever looks, their line at a fixed angle to the sun\'s path, so they never overlap and their shape is always there. The brighter casts the light.' }));
  const setP = (k, v) => { const t = s(); if (t) { t[k] = v; systemEdited(); } };
  body.append(sysDial({ label: 'Separation', key: 'separation', value: b.separation, onSet: (v) => setP('separation', v), reset: R('separation'), title: 'The gap between the two bright discs\' edges, so they never touch whatever their sizes', src: b.src?.separation || '' }));
  body.append(sysDial({ label: 'Line angle', key: 'lineAngle', value: b.lineAngle, onSet: (v) => setP('lineAngle', v), reset: R('lineAngle'), title: 'The second sun\'s side of the first, against the sun\'s path: -90 below it (it rises after and sets before), 0 ahead along the path, 90 above it', src: '' }));
  b.members.forEach((m, mi) => {
    const setM = (k, v, structure = false) => { const t = s(); if (!t?.members?.[mi]) return; t.members[mi][k] = v; systemEdited(structure); };
    const MR = (k) => sysResetValue(id, (sy) => sy.bodies.find((x) => x.id === b.id)?.members?.[mi], k);
    body.append(el('h4', { text: m.name + (mi === 0 ? ' (at the centre)' : ' (beside it)') }));
    const sel = el('select', { 'aria-label': 'Place' });
    for (const [v, t] of placeOptions) sel.append(el('option', { value: v, text: t }));
    sel.value = here(m.places) || '';
    sel.addEventListener('change', () => setM('places', withPlace(m.places, sel.value || null), true));
    const prv = placeReset(id, (sy) => sy.bodies.find((x) => x.id === b.id)?.members?.[mi], here);
    const prb = prv ? resetButton(prv, sel.value, (v) => setM('places', withPlace(m.places, v || null), true)) : el('span');
    body.append(el('div', { class: 'ctl' }, el('span', { text: `Place in ${worldName(world)}'s sky` }), sel, el('span'), prb));
    const pid = here(m.places);
    body.append(sysDial({ label: 'Size', key: 'size', value: m.size ?? (pid ? sizeOfPlace(pid) : null), onSet: (v) => setM('size', v), reset: { value: MR('size')?.value ?? null, from: MR('size')?.value == null ? 'its place\'s own' : 'the draft' }, title: 'The angle its square fills in the sky (its bright disc is a fifth of that)', src: mi === 1 ? b.src?.size || '' : '' }));
    body.append(sysDial({ label: 'Strength', key: 'brightness', value: m.brightness, onSet: (v) => setM('brightness', v, true), reset: MR('brightness'), title: 'Its light: the brighter of the two casts the light', src: '' }));
    const col = el('input', { type: 'color', value: m.colour || '#ffffff' });
    col.addEventListener('input', () => setM('colour', col.value));
    const crv = MR('colour');
    body.append(el('div', { class: 'ctl' + (b.src?.colour ? ' lore' : ''), title: b.src?.colour ? 'Lore: ' + b.src.colour : '' }, el('span', { text: 'Colour' }), el('div', { class: 'colorline' }, col, el('code', { text: m.colour || '(white)' })), el('span'),
      crv ? resetButton({ value: crv.value ?? '', from: crv.from }, m.colour ?? '', (v) => { setM('colour', v || null); renderSystemPanel(); }) : el('span')));
  });
}

window.addEventListener('error', (e) => console.error('[viewer] error:', e.message));
window.addEventListener('unhandledrejection', (e) => console.error('[viewer] unhandled:', e.reason?.message || e.reason));
window.__viewer = {
  // generated looks, for checks: the last bake, a rebake, a hash of every texel, the bake counter
  genInfo: (id) => generatedInfo(state.looks[id]),
  rebake: (id) => rebakeGenerated(state.looks[id]),
  genHash: (id, which) => generatedHash(state.looks[id], which),
  genPixels: (id, which) => generatedPixels(state.looks[id], which),
  bakeStats: () => bakeStats(),
  // wave 5, for checks: a look's noise volume (its bake and a hash of every texel), the quality now,
  // and each tier's cost on this card (the stage drawn with the volumes and without, at a given size)
  volInfo: (id) => volumeInfo(state.looks[id]),
  volHash: (id) => volumeHash(state.looks[id]),
  volBakes: () => volumeBakeCount(),
  quality: () => volumeQualityState(),
  setQuality: (m) => setViewer('volumes', m),
  volumeCost: async ({ width = 1600, height = 900, n = 24 } = {}) => {
    const R = S.renderer, size = R.getSize(new THREE.Vector2()), pr = R.getPixelRatio();
    const aspect = S.camera.aspect;
    R.setPixelRatio(1);
    R.setSize(width, height, false);
    S.camera.aspect = width / height;
    S.camera.updateProjectionMatrix();
    const vols = () => (state.mode === 'place' ? placeView.bodies.map((b) => b.built?.vol) : [state.current?.vol, state.compare?.vol, state.backdrop?.vol]).filter(Boolean);
    const draw = () => {
      if (state.mode === 'place') placeView.frame(state.clock, performance.now() / 1000);
      else { if (state.current) tick(state.current, !!state.compare); if (state.backdrop) tick(state.backdrop); if (state.compare) tick(state.compare, true); }
      gameLook.render();
    };
    try {
      return { width, height, backend: S.backend, ...(await measureTiers(R, draw, (on) => { for (const v of vols()) v.mesh.visible = on; }, { n })) };
    } finally {
      for (const v of vols()) v.mesh.visible = true;
      R.setPixelRatio(pr);
      R.setSize(size.x, size.y, false);
      S.camera.aspect = aspect;
      S.camera.updateProjectionMatrix();
      S.resize();
    }
  },
  // (the atmosphere brief's wave A) the air, for checks: what the look on show is drawn with, the choice for all and the
  // quality (as the pill over the stage sets them), and the cost of each form and quality: the view on show drawn `n`
  // times at a given size and timed to the card's own finish, built again for each, then put back as it was
  airInfo: () => ({ ...airInfo(state.current), choice: { all: state.viewer.airAll, quality: state.viewer.airQuality } }),
  setAir: async (all = 'own', quality = null) => {
    state.viewer.airAll = AIR_ALL.some(([k]) => k === all) ? all : 'own';
    if (quality) state.viewer.airQuality = AIR_QUALITIES.some(([k]) => k === quality) ? quality : 'medium';
    applyViewer();
    clearTimeout(rebuildAllTimer);
    if (state.mode === 'place' && state.placesById.has(state.placeId)) await selectPlace(state.placeId, { rebuild: true, aim: false });
    else if (state.mode === 'look') await show(state.currentId);
    return { all: state.viewer.airAll, quality: state.viewer.airQuality };
  },
  airCost: async ({ width = 1600, height = 900, n = 40, qualities = ['low', 'medium', 'high'], forms = ['painted', 'none', 'scattered'] } = {}) => {
    const R = S.renderer, size = R.getSize(new THREE.Vector2()), pr = R.getPixelRatio();
    const aspect = S.camera.aspect;
    const was = { all: state.viewer.airAll, quality: state.viewer.airQuality };
    const dev = R.backend?.device;
    const sync = dev ? () => dev.queue.onSubmittedWorkDone() : () => R.backend?.gl?.finish?.();
    const draw = () => {
      if (state.mode === 'place') placeView.frame(state.clock, performance.now() / 1000);
      else { if (state.current) tick(state.current, !!state.compare); if (state.backdrop) tick(state.backdrop); if (state.compare) tick(state.compare, true); }
      gameLook.render();
    };
    const rebuild = async () => {
      if (state.mode === 'place' && state.placesById.has(state.placeId)) await selectPlace(state.placeId, { rebuild: true, aim: false });
      else await show(state.currentId);
    };
    const out = {};
    try {
      R.setPixelRatio(1);
      for (const f of forms) {
        for (const q of f === 'scattered' ? qualities : [was.quality]) {
          state.viewer.airAll = f; state.viewer.airQuality = q;
          applyViewer();
          clearTimeout(rebuildAllTimer);
          await rebuild();
          R.setSize(width, height, false);
          S.camera.aspect = width / height;
          S.camera.updateProjectionMatrix();
          for (let i = 0; i < 12; i++) { draw(); await sync(); }
          const runs = [];
          for (let k = 0; k < 3; k++) {
            const t0 = performance.now();
            for (let i = 0; i < n; i++) draw();
            await sync();
            runs.push((performance.now() - t0) / n);
          }
          runs.sort((a, b) => a - b);
          out[f === 'scattered' ? `scattered:${q}` : f] = { frameMs: +runs[1].toFixed(3), runs: runs.map((x) => +x.toFixed(3)) };
        }
      }
    } finally {
      state.viewer.airAll = was.all; state.viewer.airQuality = was.quality;
      applyViewer();
      clearTimeout(rebuildAllTimer);
      R.setPixelRatio(pr);
      R.setSize(size.x, size.y, false);
      S.camera.aspect = aspect;
      S.camera.updateProjectionMatrix();
      S.resize();
      await rebuild();
    }
    return { width, height, n, backend: S.backend, mode: state.mode, look: state.currentId, place: state.mode === 'place' ? state.placeId : null, ...out };
  },
  compare: (id) => { state.compareId = id || null; return show(state.currentId, { frame: true }); },
  frameIt: () => frameCurrent(),
  get stage() { return S; },
  show: (id) => show(id, { frame: true }),
  // (the atmosphere brief's wave B) a place of the sky already open is built again (its looks may have changed under
  // it: a check sets a place's look and opens it), as is any other of the same zone; { rebuild: false } keeps it
  place: (id, { rebuild = null, aim = true } = {}) => {
    const p = state.placesById.get(id);
    const open = !!p && state.mode === 'place' && !!placeView?.active && placeView.zone === p.zone;
    return selectPlace(id, { rebuild: rebuild ?? open, aim });
  },
  // (under a star system the hour of the world's own day, as the Time slider does; else SWG's hour)
  setHours: (h) => { setHourOfWorld(h); updatePlaceBar(); refreshWordsSoon(); },
  setView: (v) => { Object.assign(placeView.view, v); updatePlaceBar(); },
  // (looks run 2) the sky's light washed over the bodies from the ground (skywash.js): on or off, and its numbers
  // (wave B) now the viewer's own settings (the Day wash box, a step of the history): `numbers` by the box's keys
  // (washFront, washThick, washDim, washSun) or skywash.js's (inFront, thick, dayDim, sun)
  wash: (on = true, numbers = null) => {
    const v = state.viewer, n = numbers || {};
    const pick = (a, b) => (n[a] !== undefined ? n[a] : n[b]);
    placeView.washUrlOff = false;
    state.viewer = cleanViewer({ ...v, wash: !!on, washFront: pick('washFront', 'inFront') ?? v.washFront, washThick: pick('washThick', 'thick') ?? v.washThick, washDim: pick('washDim', 'dayDim') ?? v.washDim, washSun: pick('washSun', 'sun') ?? v.washSun });
    applyViewer();
    setDirty(true);
    return { on: placeView.wash, ...placeView.washNumbers };
  },
  tab: (t) => showTab(t),
  // skies in motion, for checks: open a system's view (its id or a world, and where to stand), set the
  // first round's clock or the real one, read a world's sky now, apply or preview a system
  system: (x, stand) => openSystemView(x, stand),
  setClock: (day, hours) => { state.day = Math.max(0, Math.floor(day)); state.hours = ((+hours % 24) + 24) % 24; updatePlaceBar(); refreshWordsSoon(); },
  setReal: (ms) => { state.realT = +ms; state.live = false; syncHours(); updatePlaceBar(); refreshWordsSoon(); },
  setHourOfWorld: (h) => { setHourOfWorld(h); updatePlaceBar(); refreshWordsSoon(); },
  now: () => { clockNow(); updatePlaceBar(); refreshWordsSoon(); },
  applySystem: (id) => applyStar(id),
  previewSystem: (id, on = true) => previewStar(id, on),
  skyOf: (w) => {
    const c = skyNow(w) || (systemIdOf(w) ? starAt(systemIdOf(w), w) : null);
    return c && { follows: skyFollows(w), rule: skyRule(w).rule, system: systemIdOf(w), hour: c.v2 ? c.out.hour : state.hours, night: c.out.night, daylight: c.out.daylight, sunUp: c.v2 ? c.out.day.sun.y : null, status: systemIdOf(w) ? starStatus(systemIdOf(w)).word : 'none' };
  },
  get orrery() { return orrery; },
  // wave 4, for checks: the game's chain (its last grade and path), the thunder (its log), the storm
  // clocks of the look on show and its compared look, and the ground storm's
  get gameLook() { return gameLook; },
  get thunder() { return thunder; },
  storms: () => ({ current: state.current?.storms || null, compare: state.compare?.storms || null, ground: placeView?.groundStorms || null }),
  // the colour matcher (21 November), for the look tuner and checks: a disc on the stage measured, a
  // picture measured (a name in the imported folder, a URL, or { b64, type } bytes; `circle` keeps to
  // one body), and the look on show matched to measured stats, 'compare' or a picture
  measure: (which = 'current') => measureOnStage(which),
  measurePicture: (src, opts) => measurePicture(src, opts),
  matchTo: (ref, opts) => matchColours(state.looks[state.currentId], ref, opts),
  // (the GPU port's pass 2, wave 4) a frame handed over from the game (its `__debug.sky({ match })` answer's `json`, or the
  // JSON as text; null lets go), and Save to game without the button
  match: (json) => holdMatch(json),
  saveToGame: () => saveToGame(),
  state,
  get placeView() { return placeView; },
};
init().catch((e) => {
  console.error('[viewer] start failed:', e);
  setStatus('Start failed: ' + e.message, true);
});
