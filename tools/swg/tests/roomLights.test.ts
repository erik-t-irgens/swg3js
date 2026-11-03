// The rooms' lights edited and placed (Map-maker II's wave of the rooms' lights), held in node:
//
//   1. DAY ONE: with no lights file and every dial at its first value, every room of every converted building is lit to the bit
//      as the commit before the wave lit it. The world's own `updateInteriorLights` and `roomLightPlan` of 0e2e226 are read out
//      of git and run against real three lights; the wave's `planRoomLights` and `RoomLightPool.apply` against lights of their
//      own; every intensity, colour, distance, decay, place and target compared by `Object.is`. Where git cannot answer, the
//      trace is held to a hash recorded from 0e2e226's own code. The SSAO program's text with no spot or casting slot is the
//      base's to the byte (held to a hash of it where git cannot answer), and its variants are scanned for what a GLSL compiler
//      refuses; the pool's default shape adds no light to the scene.
//   2. The lights files: the reader's every refusal and keep, a file read and written byte for byte, ids minted, the scopes.
//   3. The plan with edits: narrowest wins, an edit off, scaled, recoloured; a fill; lights added, a spot that takes only a spot
//      slot, a shadow taking a casting slot where one is built and lit without where none is (counted), a directional in place
//      of the room's parallel (its shadow never cast, counted), stale rows named, rows of one model reaching no other's rooms.
//   4. The pool: its shape's lights, a casting slot's map drawn only when the rooms' shadow pass asks (`autoUpdate` false for
//      good), the slots a plan lit listed for that pass, a shadow camera's far plane three's own to set (a map drawn at one
//      range and again at another takes the second's projection), the flicker on the shared clock as `flickerAt` answers, a
//      light the hand moves carried where the hand has it.
//   5. The dials: every one moved through the real tune, held to its range, the plan's version moved.
//   6. Wiring the game makes and no behaviour test can (the world, the main app, the effects), pinned as text. The world's own
//      lines are run in `roomLightsWorld.test.ts`.
//
// Run: node tools/swg/tests/roomLights.test.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { DEFAULT_POOL, NO_ROOM_EDITS, ROOM_LIGHT_TUNE, planRoomLights, roomLightPlan, type RoomLightCell } from '../../../src/world/roomLights.ts';
import { LightClock, ROOM_SHADOW_TUNE, RoomLightPool, roomPoolShape, sameShape, tuneRoomLights } from '../../../src/world/roomLightPool.ts';
import { FLICKER_CODE, FLICKER_TUNE, flickerAt, flickerSeed, hash01, valueNoise } from '../../../src/world/lightFlicker.ts';
import { RoomLightEdits } from '../../../src/world/roomLightEdits.ts';
import { ALL_ID_PREFIX, isCopyKey, lightsFileText, mintLightId, readLightRow, readLightsFile, specOfRow, type LightRow } from '../../../src/world/editFiles/lightsFile.ts';
import { readLightSpec } from '../../../src/story/lightSpec.ts';
import { ROOM_LIGHT_DIALS } from '../../../src/world/roomLightDials.ts';
import { sharedClock } from '../../../src/world/sharedClock.ts';
import { glslVariant, redeclared, reservedWords, unbalanced, undefinedCalls } from './glslScan.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

/** Our test rooms' trace, recorded from 0e2e226's own world code (each room walked in turn with fresh lights): day one's hold where git cannot answer. */
const OURS_TRACE = 'd5af9f0a7871ecb0';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const BASE = '0e2e226';
const text = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const fromGit = (rel: string): string | null => {
  try {
    return execFileSync('git', ['-C', ROOT, 'show', `${BASE}:${rel}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n');
  } catch {
    return null;
  }
};

// ---- The buildings the converted packs carry (every pack's layout), and some of our own. ----

interface Building {
  id: string;
  cells: RoomLightCell[];
}
const buildings: Building[] = [];
{
  const dir = join(ROOT, 'assets-private');
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).sort()) {
      const f = join(dir, name, 'manifest.json');
      if (!existsSync(f)) continue;
      let m: { categories?: Record<string, unknown> };
      try {
        m = JSON.parse(readFileSync(f, 'utf8'));
      } catch {
        continue;
      }
      for (const v of Object.values(m.categories ?? {})) {
        if (!Array.isArray(v)) continue;
        for (const d of v as { id?: string; cells?: RoomLightCell[] }[]) if (d && Array.isArray(d.cells) && d.cells.some((c) => (c.lights ?? []).length)) buildings.push({ id: `${name}/${d.id}`, cells: d.cells });
      }
    }
  }
}
// Ours: a room of every kind of light, doorways both ways, a room opened on twice, more lamps than the pool.
const lamp = (x: number, y: number, z: number, c: number, l: number, q: number, col: [number, number, number]) => ({ type: 2, color: col, position: [x, y, z], direction: [0, 0, 1], attenuation: [c, l, q] });
const OURS: RoomLightCell[] = [
  { index: 0, lights: [] },
  {
    index: 1,
    portals: [{ target: 2 }, { target: 3 }, { target: 2 }, { target: 0 }],
    lights: [
      { type: 0, color: [0.1, 0.12, 0.08], position: [0, 0, 0], direction: [0, 0, 1], attenuation: [1, 0, 0] },
      { type: 1, color: [0.9, 0.8, 0.7], position: [1, 6, 2], direction: [0.3, -0.9, 0.1], attenuation: [1, 0, 0] },
      lamp(1, 2.5, 1, 1, 0.2, 0.01, [1, 0.9, 0.7]),
      lamp(-3, 2.2, 4, 0.5, 0.1, 0.05, [0.4, 0.5, 1]),
      lamp(5, 3, -2, 1, 0, 0.002, [1, 1, 1]),
    ],
  },
  { index: 2, portals: [{ target: 1 }], lights: [{ type: 0, color: [0.05, 0.02, 0.01], position: [0, 0, 0], direction: [0, 0, 1], attenuation: [1, 0, 0] }, ...Array.from({ length: 6 }, (_, i) => lamp(i, 2, -i, 1, 0.3 * i, 0.01, [0.8, 0.7 + i * 0.03, 0.5]))] },
  { index: 3, portals: [{ target: 1 }], lights: [{ type: 1, color: [0.2, 0.2, 0.3], position: [0, 9, 0], direction: [0, -1, 0], attenuation: [1, 0, 0] }, lamp(0, 2, 8, 2, 0.5, 0.2, [0.3, 1, 0.3])] },
];
buildings.push({ id: 'ours/rooms', cells: OURS });
const fromPacks = buildings.length - 1;

/** A building's matrix of the world: turned about every axis and moved, so a frame mixed up anywhere shows. */
const MATRIX = new THREE.Matrix4().compose(new THREE.Vector3(1234.5, -17.25, -880.125), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.11, 1.9, -0.07)), new THREE.Vector3(1, 1, 1));

// ---- 1. Day one. ----

const baseWorld = fromGit('src/world/world.ts');
const baseRules = fromGit('src/world/roomLights.ts');
type Lights = { points: THREE.PointLight[]; parallel: THREE.DirectionalLight; ambient: THREE.AmbientLight; cells: number[] };
const makeLights = (): Lights => ({
  points: Array.from({ length: 8 }, () => new THREE.PointLight(0xffffff, 0, 1, 2)),
  parallel: new THREE.DirectionalLight(0xffffff, 0),
  ambient: new THREE.AmbientLight(0xffffff, 0),
  cells: new Array(8).fill(-1),
});
/** Every value a set of lights holds, in one order: what the two are compared by. */
const trace = (L: Lights): number[] => {
  const out: number[] = [];
  for (const l of L.points) out.push(l.intensity, l.color.r, l.color.g, l.color.b, l.distance, l.decay, l.position.x, l.position.y, l.position.z);
  const p = L.parallel;
  out.push(p.intensity, p.color.r, p.color.g, p.color.b, p.position.x, p.position.y, p.position.z, p.target.position.x, p.target.position.y, p.target.position.z);
  out.push(L.ambient.intensity, L.ambient.color.r, L.ambient.color.g, L.ambient.color.b, ...L.cells);
  return out;
};
const sameTrace = (a: number[], b: number[]): number => {
  if (a.length !== b.length) return 0;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return i;
  return -1;
};

// The wave's way, through the very calls the world makes: `planRoomLights` with no edits on the default shape, `apply`.
const ours = makeLights();
const pool = new RoomLightPool(ours.points, ours.parallel, ours.ambient);
const lightOurs = (cells: RoomLightCell[], cell: number): void => {
  pool.clear();
  ours.cells.fill(-1);
  const plan = planRoomLights(cells, cell, ROOM_LIGHT_TUNE.ambientFloor, pool.shape, undefined);
  if (!plan) return;
  pool.apply(plan, MATRIX, ours.cells);
};

// Every room of every building, in turn, as a body walking them would light them (the lights a room leaves unlit keep their
// colour and place from the room before, in both).
const visits: { b: Building; cell: number }[] = [];
for (const b of buildings) for (const c of b.cells) if (c.index > 0) visits.push({ b, cell: c.index });
const hash = createHash('sha256');
let worst = -1;
let baseRan = false;
let baseOurs = '';
if (baseWorld && baseRules) {
  const body = /\n  private updateInteriorLights\(\): void \{\n([\s\S]*?)\n  \}\n/.exec(baseWorld)?.[1] ?? '';
  ok(body.includes('roomLightPlan(') && body.includes('INTERIOR_LIGHT_SCALE'), `${BASE}'s updateInteriorLights is read out of git (${body.split('\n').length} lines)`);
  const scale = Number(/const INTERIOR_LIGHT_SCALE = ([\d.]+);/.exec(baseWorld)?.[1]);
  const ambientScale = Number(/const INTERIOR_AMBIENT_SCALE = ([\d.]+);/.exec(baseWorld)?.[1]);
  const floor = Number(/const INTERIOR_AMBIENT_FLOOR = ([\d.]+);/.exec(baseWorld)?.[1]);
  ok(scale === ROOM_LIGHT_TUNE.lightScale && ambientScale === ROOM_LIGHT_TUNE.ambientScale && floor === ROOM_LIGHT_TUNE.ambientFloor, `the dials start at ${BASE}'s fixed numbers (lamps ${scale}, ambient ${ambientScale}, floor ${floor})`);
  // The base rule module, as it stood, into a temporary file node strips the types of.
  const tmp = mkdtempSync(join(tmpdir(), 'roomLights-base-'));
  const rulesFile = join(tmp, 'roomLights.ts');
  writeFileSync(rulesFile, baseRules.replace(/from '\.\/assetPack\.ts'/g, `from '${pathToFileURL(join(ROOT, 'src/world/assetPack.ts')).href}'`));
  const baseMod = (await import(pathToFileURL(rulesFile).href)) as { roomLightPlan: typeof roomLightPlan };
  rmSync(tmp, { recursive: true, force: true });
  const base = makeLights();
  const fn = new Function('THREE', 'roomLightPlan', 'INTERIOR_LIGHT_SCALE', 'INTERIOR_AMBIENT_SCALE', 'INTERIOR_AMBIENT_FLOOR', `return function () {\n${body}\n};`)(THREE, baseMod.roomLightPlan, scale, ambientScale, floor) as (this: unknown) => void;
  const self = { lightHint: { state: null }, cellState: null as { building: unknown; cell: number } | null, portals: null, interiorLightsFor: null, interiorPoints: base.points, fxLampCells: base.cells, interiorParallel: base.parallel, interiorAmbient: base.ambient, layoutStream: null };
  for (const v of visits) {
    self.cellState = { building: { model: { def: { cells: v.b.cells } }, matrix: MATRIX }, cell: v.cell };
    fn.call(self);
    lightOurs(v.b.cells, v.cell);
    const a = trace(base);
    const b = trace(ours);
    const at = sameTrace(a, b);
    if (at >= 0 && worst < 0) worst = at;
    if (at >= 0) console.log(`not alike: ${v.b.id} room ${v.cell} at value ${at}: ${a[at]} against ${b[at]}`);
    hash.update(Float64Array.from(b));
  }
  baseRan = true;
  // Our rooms alone with fresh lights, by the base's code: what the recorded trace is (and where git cannot answer, the hold).
  {
    const own = makeLights();
    const s2 = { ...self, interiorPoints: own.points, fxLampCells: own.cells, interiorParallel: own.parallel, interiorAmbient: own.ambient };
    const h = createHash('sha256');
    for (const c of OURS) {
      if (c.index === 0) continue;
      s2.cellState = { building: { model: { def: { cells: OURS } }, matrix: MATRIX }, cell: c.index };
      fn.call(s2);
      h.update(Float64Array.from(trace(own)));
    }
    baseOurs = h.digest('hex').slice(0, 16);
    ok(baseOurs === OURS_TRACE, `${BASE}'s own code lights our test rooms to the recorded trace ${OURS_TRACE} (${baseOurs})`);
  }
  ok(worst < 0, `DAY ONE: every room of ${fromPacks} converted buildings and ours (${visits.length} rooms walked in turn) is lit by the wave's plan and pool exactly as ${BASE}'s world lit it: every intensity, colour, distance, decay, place, target, the ambient and the lamps' cells, by Object.is`);
} else {
  for (const v of visits) {
    lightOurs(v.b.cells, v.cell);
    hash.update(Float64Array.from(trace(ours)));
  }
}
const digest = hash.digest('hex').slice(0, 16);
// The trace of ours' rooms alone, recorded from 0e2e226's own code: what holds day one where git cannot answer.
{
  const own = makeLights();
  const p2 = new RoomLightPool(own.points, own.parallel, own.ambient);
  const h = createHash('sha256');
  for (const c of OURS) {
    if (c.index === 0) continue;
    p2.clear();
    own.cells.fill(-1);
    const plan = planRoomLights(OURS, c.index, ROOM_LIGHT_TUNE.ambientFloor);
    if (plan) p2.apply(plan, MATRIX, own.cells);
    h.update(Float64Array.from(trace(own)));
  }
  const ownDigest = h.digest('hex').slice(0, 16);
  ok(ownDigest === OURS_TRACE, `day one where git cannot answer: our test rooms lit by the wave hash to ${ownDigest}, the trace ${BASE}'s own code made of them (${OURS_TRACE})${baseRan ? '' : ' (git did not answer: this is the hold)'}`);
}
console.log(`     (the whole walk's trace: ${digest}${baseRan ? '' : ', not compared'})`);

// The plan with no edits answers what the rule answered, the same numbers, every room.
{
  let alike = 0;
  for (const v of visits) {
    const a = roomLightPlan(v.b.cells, v.cell, 0.18);
    const b = planRoomLights(v.b.cells, v.cell, 0.18, DEFAULT_POOL, NO_ROOM_EDITS);
    if (!a || !b) continue;
    const same = a.ambient.every((x, i) => Object.is(x, b.ambient[i])) && a.points.length === b.points.length && a.points.every((p, i) => Object.is(p.at3, b.points[i].at3) && Object.is(p.range, b.points[i].range) && p.cell === b.points[i].cell && p.light.position.every((x, k) => Object.is(x, b.points[i].pos[k]))) && (a.parallel === null) === (b.parallel === null) && b.spots.length === 0 && b.pointShadows.length === 0;
    if (same) alike++;
  }
  ok(alike === visits.length, `the plan with no edits on the default shape is the rule's own plan in every one of ${visits.length} rooms (ambient, lamps, ranges, places, the parallel)`);
}
ok(sameShape(pool.shape, DEFAULT_POOL) && pool.all().length === 9 && pool.casters().length === 0, 'the default shape is the eight points and the parallel the world always had: no spot, no casting slot, nothing added to the scene');
ok(sameShape(roomPoolShape(0, 0), DEFAULT_POOL), "the Graphics page's two settings at nought build the default shape");

// The SSAO program with no spot or casting slot is the base's own text to the byte; its variants are scanned for what a
// compiler refuses (node compiles no GLSL: CLAUDE.md's lesson on tests that read a shader's text).
/** A hash of 0e2e226's GTAO template text (sha-256, its first sixteen hex, line endings folded): day one's hold where git cannot answer. */
const GTAO_TEXT = '82bf2961353ba248';
{
  const re = /export const SSAO_GTAO_FRAG = \/\* glsl \*\/ `([\s\S]*?)`;/;
  const now = text('src/core/fx/ssao.ts');
  const was = fromGit('src/core/fx/ssao.ts');
  const frag = re.exec(now)?.[1] ?? '';
  if (was) ok(frag.length > 1000 && frag === (re.exec(was)?.[1] ?? null), `the ambient occlusion's GTAO text is ${BASE}'s to the byte`);
  const fragHash = createHash('sha256').update(frag).digest('hex').slice(0, 16);
  ok(fragHash === GTAO_TEXT, `and hashes to the one recorded from ${BASE}'s (${fragHash})${was ? '' : ' (git did not answer: this is the hold)'}`);
  ok(/export function ssaoGtaoFrag\(roomSpots: number, roomCast = 0\): string \{\n  const n = [^\n]+\n  const c = [^\n]+\n  if \(n === 0 && c === 0\) return SSAO_GTAO_FRAG;/.test(now), 'with no spot and no casting slot the occlusion takes that very text (`ssaoGtaoFrag(0, 0)` answers the constant)');
  // The function's own text run over the raw template: its anchors found, each kind's function added once and called once.
  const fnText = /export function ssaoGtaoFrag\(roomSpots: number, roomCast = 0\): string \{([\s\S]*?)\n\}\n/.exec(now)?.[1] ?? '';
  const build = new Function('SSAO_GTAO_FRAG', 'SSAO_MAX_ROOM_SPOTS', 'SSAO_MAX_ROOM_CAST', `return function (roomSpots, roomCast = 0) {${fnText}};`)(frag, 6, 2) as (n: number, c?: number) => string;
  ok(build(0) === frag && build(0, 0) === frag, 'run as written, nought spots and nought casting points hands back the template itself');
  const two = build(2);
  ok(two !== frag && (two.match(/#define ROOM_SPOTS 2/g) ?? []).length === 1 && (two.match(/float roomSpotsDirect\(vec3 pw, vec3 nw\)/g) ?? []).length === 1 && (two.match(/\+ roomSpotsDirect\(pw, nw\);/g) ?? []).length === 1 && /uniform vec4 uRoomSpotPos\[ROOM_SPOTS\];/.test(two) && /uniform int uRoomSpotCount;/.test(two) && !/ROOM_CAST/.test(two), 'two spot slots: every anchor found, the spots read once, added to the rooms\' direct light once, and nothing of the casting points');
  const cast = build(0, 1);
  ok(cast !== frag && (cast.match(/#define ROOM_CAST 1/g) ?? []).length === 1 && (cast.match(/float roomCastDirect\(vec3 pw, vec3 nw\)/g) ?? []).length === 1 && (cast.match(/\+ roomCastDirect\(pw, nw\);/g) ?? []).length === 1 && /uniform vec4 uRoomCastPos\[ROOM_CAST\];/.test(cast) && /uniform vec2 uRoomCastLum\[ROOM_CAST\];/.test(cast) && !/ROOM_SPOTS/.test(cast), 'a casting point slot alone: its arrays and its function, added to the rooms\' direct light once, and nothing of the spots');
  const both = build(6, 2);
  ok(/\+ roomSpotsDirect\(pw, nw\) \+ roomCastDirect\(pw, nw\);/.test(both), "both: the spots' light and the casting points' added to the rooms' direct light");
  ok(/float lightFalloff\(/.test(frag) && both.indexOf('float lightFalloff(') < both.indexOf('float roomSpotsDirect(') && both.indexOf('float lightFalloff(') < both.indexOf('float roomCastDirect('), 'each calls the falloff the template defines, and after it is defined');
  // Scanned for what a compiler refuses, at half and full resolution: a name declared twice in a scope, a call to a function
  // the text does not define beyond the template's own (its chunks are spliced in at run time), a reserved word, a bracket.
  const baseCalls = new Set(undefinedCalls(frag));
  const baseReserved = new Set(reservedWords(frag));
  for (const [name, v] of [['one spot', build(1)], ['six spots', build(6)], ['one casting point', build(0, 1)], ['six spots and two casting points', build(6, 2)]] as const) {
    let twice: string[] = [];
    for (const d of [new Set<string>(), new Set(['AO_FULL'])]) twice = twice.concat(redeclared(glslVariant(v, d)));
    const calls = undefinedCalls(v).filter((c) => !baseCalls.has(c));
    const words = reservedWords(v).filter((w) => !baseReserved.has(w));
    const brackets = unbalanced(v);
    ok(twice.length === 0 && calls.length === 0 && words.length === 0 && brackets === unbalanced(frag), `the variant with ${name} declares no name twice in a scope, calls nothing it does not define, uses no reserved word and keeps its brackets${twice.length ? `: twice ${twice.join(', ')}` : ''}${calls.length ? `: calls ${calls.join(', ')}` : ''}`);
  }
  // The scanner tried on the very fault it is here for, planted in the spots' function.
  const v2 = build(2);
  const line = 'float c = dot(nw, ld);';
  const at = v2.indexOf(line, v2.indexOf('float roomSpotsDirect('));
  const planted = `${v2.slice(0, at)}${line}\n      float c = 0.0;${v2.slice(at + line.length)}`;
  ok(at > 0 && redeclared(glslVariant(planted, new Set())).includes('roomSpotsDirect: c'), "a name planted twice in the spots' function is found there");
}

// ---- 2. The lights files. ----

{
  const good = { id: 'candle-1', kind: 'light', scope: 'copy', copy: 'o:object/building/tatooine/shared_cantina_tatooine.iff@3331.5,5,-5001#2', model: 'cantina_tatooine', cell: 4, room: 'cantina', type: 'point', color: [1, 0.6, 0.3], brightness: 0.25, reach: 5, flicker: { shape: 'candle', rate: 5, depth: 0.35 }, pos: [1, 2, 3] };
  const r = readLightRow(good, false);
  ok(typeof r !== 'string' && r.kind === 'light' && r.flicker?.shape === 'candle' && r.pos?.[2] === 3, 'a light of one copy reads');
  const refuse = (v: Record<string, unknown>, shared: boolean, why: RegExp, what: string) => {
    const got = readLightRow(v, shared);
    ok(typeof got === 'string' && why.test(got), `refused: ${what} (${typeof got === 'string' ? got : 'read!'})`);
  };
  refuse({ ...good, id: 'all-x' }, false, /shared file/, "an id beginning all- in a world's file");
  refuse({ ...good, scope: 'all', id: 'x-1', copy: undefined }, false, /shared file/, "every copy everywhere in a world's file");
  refuse({ ...good, scope: 'world' }, true, /begins all-/, 'a plain id in the shared file');
  refuse({ ...good, copy: 'cantina' }, false, /copy is one of/, 'a copy key of no shape');
  refuse({ ...good, cell: 0 }, false, /cell is a room/, 'cell 0, the outside');
  refuse({ ...good, type: 'directional' }, false, /no reach/, 'a directional with a reach');
  refuse({ ...good, cone: [10, 20] }, false, /only a spot/, 'a point with a cone');
  refuse({ ...good, type: 'spot', cone: [40, 20] }, false, /inner angle/, 'a cone whose inner is wider than its outer');
  refuse({ ...good, flicker: { shape: 'candle', rate: 99, depth: 0.5 } }, false, /rate/, 'a flicker past its rate');
  refuse({ ...good, scale: 2 }, false, /no of, off or scale/, 'a light carrying a scale');
  refuse({ id: 'e-1', kind: 'edit', scope: 'world', model: 'm', cell: 1, room: 'r', of: 2 }, false, /does something/, 'an edit that does nothing');
  refuse({ id: 'e-1', kind: 'edit', scope: 'world', model: 'm', cell: 1, room: 'r', of: 2, brightness: 3 }, false, /no brightness/, 'an edit carrying a brightness');
  refuse({ id: 'f-1', kind: 'fill', scope: 'world', model: 'm', cell: 1, room: 'r', off: true }, false, /scale and color alone/, 'a fill switched off');
  refuse({ id: 'o-1', kind: 'edit', scope: 'outdoor', of: 1, off: true }, false, /outdoor row is a light/, 'an outdoor edit');
  refuse({ id: 'o-1', kind: 'light', scope: 'outdoor', model: 'm', type: 'point', color: [1, 1, 1], brightness: 1, reach: 4, pos: [1, 2, 3] }, false, /names no model/, 'an outdoor light naming a model');
  const shadowOff = readLightRow({ id: 'e-2', kind: 'edit', scope: 'world', model: 'm', cell: 1, room: 'r', of: 'all-lamp-1', shadow: false }, false);
  ok(typeof shadowOff !== 'string' && shadowOff.shadow === false && shadowOff.of === 'all-lamp-1', "an edit taking back a wider light's shadow, by that light's id, reads");
  const unknown: string[] = [];
  readLightRow({ ...good, glow: 2 }, false, unknown);
  ok(unknown.join() === 'candle-1.glow', 'a field this build does not read is kept out and named');
  // A file read and written again byte for byte.
  const rows = [good, { id: 'fill-cantina-1', kind: 'fill', scope: 'world', model: 'cantina_tatooine', cell: 4, room: 'cantina', scale: 0.5 }, { id: 'edit-cantina-1', kind: 'edit', scope: 'world', model: 'cantina_tatooine', cell: 4, room: 'cantina', of: 3, off: true }];
  const t1 = lightsFileText('tatooine', 'raw', rows);
  const read = readLightsFile(t1, 'tatooine', 'ground');
  ok(read.problem === null && read.rows.length === 3 && read.skipped.length === 0, 'a written file reads every row back');
  ok(lightsFileText('tatooine', 'raw', read.rows as unknown as Record<string, unknown>[]) === t1, 'and writes again byte for byte');
  ok(readLightsFile(t1, 'naboo', 'ground').problem !== null && readLightsFile(t1, 'tatooine', 'space').problem !== null && readLightsFile(t1, null, 'ground').problem !== null, "a file under another world's name, in another frame, or read as the shared file is refused whole");
  const shared = lightsFileText(null, 'raw', [{ id: 'all-lamp-1', kind: 'light', scope: 'all', model: 'cantina_tatooine', cell: 4, room: 'cantina', type: 'spot', color: [1, 1, 1], brightness: 1, reach: 8, pos: [0, 3, 0] }]);
  ok(!/"world"/.test(shared) && readLightsFile(shared, null, 'ground').rows.length === 1, 'the shared file names no world and reads');
  const twice = lightsFileText('tatooine', 'raw', [good, { ...good }]);
  ok(readLightsFile(twice, 'tatooine', 'ground').skipped.some((s) => /second row/.test(s.why)), 'a second row under one id is skipped and named');
  ok(mintLightId('Ceiling Lamp', new Set(['ceiling-lamp-1']), false) === 'ceiling-lamp-2' && mintLightId('lamp', new Set(), true) === `${ALL_ID_PREFIX}lamp-1` && mintLightId('all thing', new Set(), false) === 'room-all-thing-1', "ids are minted unique, the shared file's with all-, a world's never");
  ok(isCopyKey('place/house-3') && isCopyKey('o:object/building/x/shared_a.iff@1,2.5,-3') && !isCopyKey('house-3'), 'a copy is a content key or a permanent row');
  ok(typeof readLightSpec({ type: 'point', color: [1, 1, 1], brightness: 1, reach: 6, falloff: 2 }) !== 'string' && (readLightSpec({ type: 'point', color: [1, 1, 1], brightness: 1, reach: 6, falloff: 2 }) as { falloff?: number }).falloff === undefined, "the game's own falloff is written absent (one light, one spelling)");
}

// ---- 3. The plan with edits. ----

const row = (o: Partial<LightRow> & { id: string; kind: LightRow['kind'] }): LightRow => {
  const r = readLightRow({ scope: 'world', model: 'ours', cell: 1, room: 'one', ...o }, o.scope === 'all');
  if (typeof r === 'string') throw new Error(`${o.id}: ${r}`);
  return r;
};
const NAMED = OURS.map((c, i) => ({ ...c, name: ['out', 'one', 'two', 'three'][i] }));
const planWith = (world: LightRow[], all: LightRow[], shape = DEFAULT_POOL, copy: string | null = 'place/house-1', cell = 1) => {
  const e = new RoomLightEdits(world, all).forRoom(copy, 'ours', NAMED);
  return { plan: planRoomLights(NAMED, cell, 0.18, shape, e)!, e };
};
{
  const none = planRoomLights(NAMED, 1, 0.18)!;
  // Off, scaled, recoloured, a reach in place.
  const { plan } = planWith([row({ id: 'e-off', kind: 'edit', of: 2, off: true }), row({ id: 'e-scale', kind: 'edit', of: 3, scale: 2, color: [0, 1, 0], reach: 12 })], []);
  ok(!plan.points.some((p) => p.key === 'g:1:2') && none.points.some((p) => p.key === 'g:1:2'), "an edit off: the game's lamp lights nothing");
  const l3 = plan.points.find((p) => p.key === 'g:1:3')!;
  const n3 = none.points.find((p) => p.key === 'g:1:3')!;
  ok(l3.at3 === n3.at3 * 2 && l3.color[1] === 1 && l3.color[0] === 0 && l3.range === 12, "an edit scales, recolours and reaches a game lamp, the rest of it the game's");
  // Narrowest wins, whole: one copy's row over this world's over every world's.
  const w = row({ id: 'e-w', kind: 'edit', of: 3, scale: 3 });
  const c = row({ id: 'e-c', kind: 'edit', scope: 'copy', copy: 'place/house-1', of: 3, color: [1, 0, 0] });
  const a = row({ id: 'all-e', kind: 'edit', scope: 'all', of: 3, off: true });
  const both = planWith([w, c], [a]).plan.points.find((p) => p.key === 'g:1:3')!;
  ok(both.color[0] === 1 && both.at3 === n3.at3, "one copy's edit wins whole over this world's and every world's (its colour, and none of the wider scale)");
  ok(planWith([w, c], [a], DEFAULT_POOL, 'place/house-2').plan.points.find((p) => p.key === 'g:1:3')?.at3 === n3.at3 * 3, "another copy takes this world's");
  ok(!planWith([], [a]).plan.points.some((p) => p.key === 'g:1:3'), "with nothing narrower every world's edit stands");
  // A fill.
  const fill = planWith([row({ id: 'f', kind: 'fill', color: [0.5, 0.5, 0.5], scale: 2 })], []).plan;
  ok(Math.abs(fill.ambient[0] - (0.18 + 1 + 0.05 * 2)) < 1e-12, "a fill puts its colour in place of its room's own (the rooms its doorways open on keep theirs: room two, opened on twice, twice)");
  // A spot takes only a spot slot; with none built it is left and counted.
  const spot = row({ id: 'spot-1', kind: 'light', type: 'spot', color: [1, 1, 1], brightness: 1, reach: 8, pos: [0, 3, 0], cone: [20, 30] });
  const noSlot = planWith([spot], []).plan;
  ok(!noSlot.points.some((p) => p.key === 'spot-1') && noSlot.left.spots === 1, 'a spot with no spot slot built lights nothing and is counted (it never takes a point slot)');
  const withSlot = planWith([spot], [], roomPoolShape(2, 0)).plan;
  const s1 = withSlot.spots.find((p) => p.key === 'spot-1');
  ok(!!s1 && Math.abs(s1.angle - (30 * Math.PI) / 180) < 1e-12 && Math.abs(s1.penumbra - 1 / 3) < 1e-12 && s1.dir[1] === -1, "with a spot slot it is lit, its cone three's angle and penumbra, shining straight down unturned");
  // A shadow asked for takes a casting slot where one is built, else is lit without and counted.
  const asks = row({ id: 'lamp-s', kind: 'light', type: 'point', color: [1, 1, 1], brightness: 1, reach: 8, pos: [0, 3, 0], shadow: true });
  const s0 = planWith([asks], []).plan;
  ok(s0.points.some((p) => p.key === 'lamp-s' && p.asked && !p.shadow) && s0.left.shadowsRefused === 1, 'a shadow asked for with no casting slot: lit without one, counted');
  const s2 = planWith([asks], [], roomPoolShape(0, 1)).plan;
  ok(s2.pointShadows.some((p) => p.key === 'lamp-s' && p.shadow) && !s2.points.some((p) => p.key === 'lamp-s'), 'with a casting slot it casts');
  const gameShadow = planWith([row({ id: 'gs', kind: 'edit', of: 4, shadow: true })], [], roomPoolShape(0, 1)).plan;
  ok(gameShadow.pointShadows.some((p) => p.key === 'g:1:4'), "one of the game's own lamps asked for a shadow by an edit casts in a casting slot");
  // A directional in place of the room's parallel; switched off, the game's comes back.
  const sun = row({ id: 'sun-1', kind: 'light', type: 'directional', color: [1, 0.5, 0.2], brightness: 0.5, pos: [0, 5, 0] });
  const ps = planWith([sun], []).plan;
  ok(ps.parallel?.key === 'sun-1' && ps.parallel.scale === 0.5 && ps.parallel.dir[1] === -1, "a directional added is the room's parallel, at its share of the rooms' own");
  ok(planWith([sun, row({ id: 'sun-off', kind: 'edit', of: 'sun-1', scope: 'copy', copy: 'place/house-1', off: true })], []).plan.parallel?.key === 'g:1:1', "switched off for one copy by its id, the game's own parallel lights that copy again");
  // Stale rows named, never laid on another room.
  const stale = planWith([row({ id: 'e-stale', kind: 'edit', of: 2, off: true, room: 'elsewhere' })], []);
  ok(stale.e.stale.some((r) => r.id === 'e-stale') && stale.plan.points.some((p) => p.key === 'g:1:2'), 'a row whose room no longer bears its name is named stale and edits nothing');
  // Flicker seeds by the light and the copy, so two copies of a template flicker apart.
  const cand = row({ id: 'c-1', kind: 'light', type: 'point', color: [1, 1, 1], brightness: 1, reach: 4, pos: [0, 2, 0], flicker: { shape: 'candle', rate: 5, depth: 0.5 } });
  const k1 = planWith([cand], [], DEFAULT_POOL, 'place/house-1').plan.points.find((p) => p.key === 'c-1')!;
  const k2 = planWith([cand], [], DEFAULT_POOL, 'place/house-2').plan.points.find((p) => p.key === 'c-1')!;
  ok(k1.flicker === FLICKER_CODE.candle && k1.seed === flickerSeed('c-1@place/house-1') && k1.seed !== k2.seed, 'a flicker is seeded by its light and its copy');
  // Every lamp past the pool is left and counted.
  const many = Array.from({ length: 12 }, (_, i) => row({ id: `many-${i}`, kind: 'light', type: 'point', color: [1, 1, 1], brightness: 1, reach: 4, pos: [i, 2, 0] }));
  const full = planWith(many, []).plan;
  ok(full.points.length === 8 && full.left.points > 0, 'past the eight point slots a lamp is left and counted');
  ok(specOfRow(cand)?.flicker?.depth === 0.5, "a light row's own light reads back");
  // A directional asking for a shadow is lit without one on every shape and counted: a room's directional never casts.
  const sunS = row({ id: 'sun-s', kind: 'light', type: 'directional', color: [1, 1, 1], brightness: 1, pos: [0, 5, 0], shadow: true });
  for (const [name, sh] of [['the default shape', DEFAULT_POOL], ['one casting slot', roomPoolShape(0, 1)], ['the most casting slots', roomPoolShape(4, 2)]] as const) {
    const p = planWith([sunS], [], sh).plan;
    ok(p.parallel?.key === 'sun-s' && p.parallel.asked && !p.parallel.shadow && p.left.shadowsRefused === 1 && p.pointShadows.length === 0 && p.spotShadows.length === 0, `a directional asking for a shadow, on ${name}: the room's parallel, lit without one, counted, and no casting slot taken`);
  }
  const gameSun = planWith([row({ id: 'gp', kind: 'edit', of: 1, shadow: true })], [], roomPoolShape(0, 2)).plan;
  ok(gameSun.parallel?.key === 'g:1:1' && gameSun.parallel.asked && !gameSun.parallel.shadow && gameSun.left.shadowsRefused === 1, "the game's own parallel light asked for a shadow by an edit: lit without one and counted");
  // Rows of one model reach no other model's rooms, though the other's cells share every index and name: this world's row and
  // the shared file's row of `ours`, and a copy row naming the very copy key but `ours`, leave a building of `other` exactly
  // as no lights file at all would.
  const otherEdits = new RoomLightEdits(
    [row({ id: 'e-w2', kind: 'edit', of: 2, off: true }), row({ id: 'c-x', kind: 'edit', scope: 'copy', copy: 'place/house-1', of: 3, off: true }), row({ id: 'f-w2', kind: 'fill', color: [1, 0, 0] })],
    [row({ id: 'all-lamp-9', kind: 'light', scope: 'all', type: 'point', color: [1, 1, 1], brightness: 1, reach: 6, pos: [0, 2, 0] }), row({ id: 'all-e-9', kind: 'edit', scope: 'all', of: 4, scale: 3 })],
  ).forRoom('place/house-1', 'other', NAMED);
  const other = planRoomLights(NAMED, 1, 0.18, DEFAULT_POOL, otherEdits)!;
  const plain = planRoomLights(NAMED, 1, 0.18, DEFAULT_POOL, NO_ROOM_EDITS)!;
  ok(otherEdits.rows.length === 0 && JSON.stringify(other) === JSON.stringify(plain), "a building of another model whose rooms share every index and name is lit as with no lights file: no world, shared or copy row of `ours` reaches it");
  ok(JSON.stringify(planWith([row({ id: 'e-w2', kind: 'edit', of: 2, off: true })], []).plan) !== JSON.stringify(plain), "while the same world row does reach a building of `ours`");
}

// ---- 4. The pool. ----

{
  const L = makeLights();
  const scene = new THREE.Scene();
  const p = new RoomLightPool(L.points, L.parallel, L.ambient);
  ok(p.setShape(roomPoolShape(2, 1), scene, 1) && p.all().length === 9 + 1 + 1 + 1 && p.spots.length === 1 && p.spotShadows.length === 1 && p.casters().length === 2, 'a shape of two spots and one casting slot: a casting point, a plain spot and a casting spot');
  ok(!scene.children.some((o) => (o as THREE.DirectionalLight).isDirectionalLight && (o as THREE.DirectionalLight).castShadow), "and no casting directional: the room's parallel light never casts");
  ok(p.casters().every((l) => l.castShadow && l.shadow.autoUpdate === false && l.shadow.needsUpdate === true), "every casting slot casts at nought, its map drawn only when asked, and asks its map drawn once (the next shadow draw's)");
  ok(!p.setShape(roomPoolShape(2, 1), scene, 1), 'the same shape again changes nothing');
  const rows = [row({ id: 'lamp-s', kind: 'light', type: 'point', color: [1, 1, 1], brightness: 1, reach: 8, pos: [0, 3, 0], shadow: true }), row({ id: 'spot-1', kind: 'light', type: 'spot', color: [1, 0.5, 0], brightness: 2, reach: 6, pos: [1, 3, 1], cone: [20, 30], flicker: { shape: 'pulse', rate: 1, depth: 0.5 } })];
  const e = new RoomLightEdits(rows, []).forRoom('place/house-1', 'ours', NAMED);
  const plan = planRoomLights(NAMED, 1, 0.18, p.shape, e)!;
  p.apply(plan, MATRIX, L.cells);
  ok(p.casting && p.litN === 1 && p.litCasters[0] === p.pointShadows[0] && p.pointShadows[0].intensity === 9 * 1 * ROOM_LIGHT_TUNE.lightScale, "a lamp casting in its slot: lit as a game lamp of the same value at 3 m, and listed for the rooms' shadow pass");
  ok(p.casters().every((l) => l.shadow.autoUpdate === false), "and no casting slot's autoUpdate is ever true: the rooms' own shadow pass asks for the lit ones' maps");
  // Its shadow camera's far plane is three's to set, from the light's distance: the pool writes the distance alone. Three
  // works a point light's far out again only where `distance || camera.far` differs from `camera.far` (WebGLShadowMap,
  // its point face loop), and a spot's in `SpotLightShadow.updateMatrices` (run here, three's own); a far written beside
  // the distance kept the projection of the first range the map was drawn at.
  {
    const pt = p.pointShadows[0];
    const sp = p.spotShadows[0];
    const pointFace = (l: THREE.PointLight): void => {
      const cam = l.shadow.camera;
      const far = l.distance || cam.far;
      if (far !== cam.far) {
        cam.far = far;
        cam.updateProjectionMatrix();
      }
    };
    const farOf = (cam: THREE.PerspectiveCamera): number => {
      // A perspective projection's far plane from its matrix: m[10] = -(f + n) / (f - n), m[14] = -2 f n / (f - n), so
      // f = m[14] / (m[10] + 1).
      const m = cam.projectionMatrix.elements;
      return m[14] / (m[10] + 1);
    };
    const spotDraw = (): void => {
      sp.updateMatrixWorld();
      sp.target.updateMatrixWorld();
      sp.shadow.updateMatrices(sp);
    };
    const planAt = (pointReach: number, spotReach: number) => {
      const r = [row({ id: 'lamp-s', kind: 'light', type: 'point', color: [1, 1, 1], brightness: 1, reach: pointReach, pos: [0, 3, 0], shadow: true }), row({ id: 'spot-s', kind: 'light', type: 'spot', color: [1, 1, 1], brightness: 1, reach: spotReach, pos: [1, 3, 1], cone: [20, 30], shadow: true })];
      p.apply(planRoomLights(NAMED, 1, 0.18, p.shape, new RoomLightEdits(r, []).forRoom('place/house-1', 'ours', NAMED))!, MATRIX, L.cells);
    };
    // A first map at one range, then the plan moved to a far longer one (the cone the same): the projection follows.
    planAt(8, 6);
    pointFace(pt);
    spotDraw();
    const firstPoint = farOf(pt.shadow.camera);
    const firstSpot = farOf(sp.shadow.camera);
    planAt(30, 25);
    pointFace(pt);
    spotDraw();
    ok(Math.abs(firstPoint - 8) < 1e-6 && Math.abs(farOf(pt.shadow.camera) - 30) < 1e-6 && pt.shadow.camera.far === 30, `a casting point drawn at 8 m then planned to 30 m: its shadow projection's far plane follows (${firstPoint.toFixed(3)} then ${farOf(pt.shadow.camera).toFixed(3)})`);
    ok(Math.abs(firstSpot - 6) < 1e-6 && Math.abs(farOf(sp.shadow.camera) - 25) < 1e-6, `a casting spot drawn at 6 m then planned to 25 m, its cone the same: its projection follows by three's own update (${firstSpot.toFixed(3)} then ${farOf(sp.shadow.camera).toFixed(3)})`);
    ok(p.litN === 2 && p.litCasters[0] === pt && p.litCasters[1] === sp, "both listed for the rooms' shadow pass");
    ok(!/shadow\.camera\.far\s*=/.test(text('src/world/roomLightPool.ts')), "the pool never writes a shadow camera's far plane");
  }
  p.apply(plan, MATRIX, L.cells);
  const spot = p.spots[0];
  ok(spot.intensity === 9 * 2 * ROOM_LIGHT_TUNE.lightScale && Math.abs(spot.angle - Math.PI / 6) < 1e-12 && spot.color.g === 0.5, 'a spot lit in its slot');
  // The flicker on the shared clock: what `flickerAt` answers for its seed, times its planned intensity.
  const base = spot.intensity;
  p.step(12.3);
  const want = base * flickerAt(FLICKER_CODE.pulse, 1, 0.5, flickerSeed('spot-1@place/house-1'), 12.3);
  ok(Math.abs(spot.intensity - want) < 1e-12 && spot.intensity !== base, 'a frame flickers a light as the shared clock and its seed say');
  // The hand's light carried where the hand has it, in the building's frame.
  p.liveKey = 'lamp-s';
  p.livePos.set(2, 2, 2);
  p.step(12.3);
  const at = new THREE.Vector3(2, 2, 2).applyMatrix4(MATRIX);
  ok(p.pointShadows[0].position.distanceTo(at) < 1e-9, 'the light the hand moves stands where the hand has it');
  p.liveKey = '';
  p.clear();
  ok(p.casters().every((l) => l.intensity === 0 && l.shadow.autoUpdate === false) && !p.casting, 'cleared, every casting slot is at nought and draws no shadow');
  ok(p.setShape(DEFAULT_POOL, scene, 1) && p.all().length === 9 && scene.children.length === 0, 'back to the default shape every light it added is taken away');
  ok(roomPoolShape(0, 2).spotShadows === 0 && roomPoolShape(4, 2).spotShadows === 2 && roomPoolShape(4, 2).spots === 2 && roomPoolShape(1, 2).spotShadows === 1 && roomPoolShape(1, 2).spots === 0 && roomPoolShape(9, 9).spots + roomPoolShape(9, 9).spotShadows === 4 && !('parallelShadow' in roomPoolShape(0, 1)), "the setting's spots are every spot slot, of which as many cast as the shadow setting (never more than the spots); the settings held to the pool's most; no casting slot for the parallel");
  // A directional of ours lit at its share of the rooms' parallel; a game parallel at the tune's own number.
  const L2 = makeLights();
  const p2 = new RoomLightPool(L2.points, L2.parallel, L2.ambient);
  const sun = new RoomLightEdits([row({ id: 'sun-1', kind: 'light', type: 'directional', color: [1, 1, 1], brightness: 0.5, pos: [0, 5, 0] })], []).forRoom('place/house-1', 'ours', NAMED);
  p2.apply(planRoomLights(NAMED, 1, 0.18, p2.shape, sun)!, MATRIX, L2.cells);
  ok(L2.parallel.intensity === ROOM_LIGHT_TUNE.parallel * 0.5, `a directional of ours lights the room's parallel at its share (${L2.parallel.intensity})`);
  p2.apply(planRoomLights(NAMED, 1, 0.18, p2.shape)!, MATRIX, L2.cells);
  ok(Object.is(L2.parallel.intensity, ROOM_LIGHT_TUNE.parallel), "the game's own parallel at the tune's number itself");
  // A light hung on a placed row standing in a room joins its room's lights after the file's.
  const hung = { key: 'att:place/lamp-1#0', cell: 1, spec: { type: 'point' as const, color: [1, 1, 1] as [number, number, number], brightness: 0.5, reach: 6 }, pos: [0, 2, 0] as [number, number, number], where: 'place/house-1' };
  const withHung = new RoomLightEdits([row({ id: 'lamp-f', kind: 'light', type: 'point', color: [1, 1, 1], brightness: 1, reach: 8, pos: [1, 2, 1] })], []).forRoom('place/house-1', 'ours', NAMED, [hung]);
  const ph = planRoomLights(NAMED, 1, 0.18, DEFAULT_POOL, withHung)!;
  const ki = ph.points.findIndex((x) => x.key === 'lamp-f');
  const hi = ph.points.findIndex((x) => x.key === hung.key);
  ok(ki >= 0 && hi > ki && ph.points[hi].at3 === 0.5, "a light hung on a row in the room is lit after the file's own of that room");
  ok(new RoomLightEdits([], []).forRoom(null, 'ours', NAMED, [hung]).added(1).length === 1, 'and with no lights file at all it is lit still');
}

// ---- 4b. The flicker. ----

{
  // Each shape on its own: between one less its depth and one, the same at the same moment and seed, moving, and reaching the
  // ends of its range (a strobe and a broken tube both ends exactly, a pulse within a hundredth of its depth, a candle's
  // wander over most of it): a shape that never moved, or never dimmed, fails here alone.
  const depth = 0.6;
  for (const shape of ['candle', 'pulse', 'strobe', 'broken'] as const) {
    const code = FLICKER_CODE[shape];
    let last = Number.NaN;
    let inBounds = true;
    let moves = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 6000; i++) {
      const t = i * 0.0137;
      const v = flickerAt(code, 3, depth, 0x9e3779b1, t);
      if (!(v >= 1 - depth - 1e-12 && v <= 1 + 1e-12)) inBounds = false;
      if (v !== last) moves++;
      last = v;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      if (flickerAt(code, 3, depth, 0x9e3779b1, t) !== v) inBounds = false;
    }
    const exact = shape === 'strobe' || shape === 'broken';
    const reach = exact ? lo === 1 - depth && hi === 1 : shape === 'pulse' ? lo <= 1 - depth + 0.01 * depth && hi >= 1 - 0.01 * depth : hi - lo >= 0.6 * depth;
    ok(inBounds && moves >= 100 && reach, `the ${shape} flicker stays between one less its depth and one, the same at the same moment, moves (${moves} changes) and reaches its range (${lo.toFixed(3)} to ${hi.toFixed(3)})`);
  }
  ok(flickerAt(0, 3, 0.6, 7, 1.2) === 1 && flickerAt(FLICKER_CODE.candle, 3, 0, 7, 1.2) === 1, 'none, or a depth of nought, is one');
  // The candle's and the broken tube's noise written out in `flickerIn` is the reference helpers' to the bit.
  let same = true;
  for (let i = 0; i < 2000; i++) {
    const t = i * 0.031;
    const seed = (i * 2654435761) >>> 0;
    const x = t * 2.5;
    const want = 1 - 0.5 * (1 - ((1 - FLICKER_TUNE.candleFine) * valueNoise(x, seed) + FLICKER_TUNE.candleFine * valueNoise(x * FLICKER_TUNE.candleFineRate, (seed ^ 0x5bd1e995) >>> 0)));
    if (!Object.is(flickerAt(FLICKER_CODE.candle, 2.5, 0.5, seed, t), want)) same = false;
    const n = Math.floor(x);
    const f = x - n;
    let v = 1;
    if (hash01(n, seed) < FLICKER_TUNE.brokenShare && f < FLICKER_TUNE.brokenDrop) v = Math.floor((f / FLICKER_TUNE.brokenDrop) * (FLICKER_TUNE.brokenStutter * 2 + 1)) % 2 === 0 ? 0 : 1;
    if (!Object.is(flickerAt(FLICKER_CODE.broken, 2.5, 0.5, seed, t), 1 - 0.5 * (1 - v))) same = false;
  }
  ok(same, "the noise written out in the frame's flicker is the reference helpers' to the bit (candle and broken, 2000 moments)");
  ok(flickerSeed('a') !== flickerSeed('b') && flickerSeed('candle-1@place/house-1') === flickerSeed('candle-1@place/house-1'), "a light's seed is its key's, the same in every browser");
  // The world's one read of the shared clock a frame (`World.readWalk`) into a record answers what the plain read answers: the
  // shared clock's own walked seconds, never this machine's, the wall held for both.
  const wall = sharedClock.wall;
  try {
    sharedClock.wall = () => 1_793_600_000_123;
    const rec = new LightClock();
    sharedClock.walkSecondsIn(rec);
    ok(Object.is(rec.t, sharedClock.walkSeconds()) && rec.t === 1_793_600_000.123, `the clock read into the flicker's record is the shared clock's walked seconds (${rec.t})`);
  } finally {
    sharedClock.wall = wall;
  }
}

// ---- 5. The dials. ----

{
  const v0 = ROOM_LIGHT_TUNE.version;
  const said = tuneRoomLights({ lightScale: 4, flicker: { candleFine: 0.5 }, shadow: { pointBias: -0.01 } });
  ok(said.length === 0 && ROOM_LIGHT_TUNE.lightScale === 4 && FLICKER_TUNE.candleFine === 0.5 && ROOM_SHADOW_TUNE.pointBias === -0.01 && ROOM_LIGHT_TUNE.version === v0 + 1, 'the tune moves the dials, the flicker and the shadows, and plans the lit room again');
  ok(tuneRoomLights({ lightScale: 1e9 }).some((w) => /held to 100/.test(w)) && ROOM_LIGHT_TUNE.lightScale === 100, 'a dial is held to its range and says so');
  ok(tuneRoomLights({ glow: 1 }).some((w) => /no glow/.test(w)) && tuneRoomLights('x').length === 1, 'a key it has not got, or no object, is said back');
  let moved = 0;
  for (const g of ROOM_LIGHT_DIALS.groups) {
    for (const d of g.dials) {
      if (d.kind !== 'number') continue;
      const was = d.get();
      const to = Math.min(d.max, Math.max(d.min, was + d.step * 3));
      d.set(to);
      if (Math.abs(d.get() - to) < 1e-12) moved++;
      d.set(ROOM_LIGHT_DIALS.shipped.get(d.key) as number);
    }
  }
  const count = ROOM_LIGHT_DIALS.groups.reduce((n, g) => n + g.dials.length, 0);
  ok(moved === count && count >= 10, `every one of the ${count} sliders moves its number through the real tune and goes back`);
  tuneRoomLights({ lightScale: 3, flicker: { candleFine: 0.35 }, shadow: { pointBias: -0.004 } });
}

// ---- 6. The wiring the game makes, as text. ----

{
  const world = text('src/world/world.ts');
  ok(/const plan = planRoomLights\(cells, want\.cell, ROOM_LIGHT_TUNE\.ambientFloor, this\.roomPool\.shape, edits \?\? undefined\);/.test(world) && /this\.roomPool\.apply\(plan, b\.matrix, this\.fxLampCells\);/.test(world), 'the world plans the lit room by the wave\'s rule and puts it on its pool');
  ok(/if \(have && this\.roomPool\.needsStep\) this\.stepRoomLights\(\);\r?\n      return;/.test(world) && /private stepRoomLights\(\): void \{\r?\n\s*this\.readWalk\(\);\r?\n\s*this\.roomPool\.clock\.t = this\.frameWalk\.t;\r?\n\s*this\.roomPool\.step\(\);/.test(world), "a frame with nothing moved only flickers and moves what is lit, from the frame's one read of the shared clock");
  ok(/if \(this\.groundTilesMat\) \{\r?\n\s*this\.readWalk\(\);\r?\n\s*setGroundClock\(this\.frameWalk\.t\);/.test(world) && /^ {4}this\.walkTick\+\+;$/m.test(world) && (world.match(/sharedClock\.walkSecondsIn\(/g) ?? []).length === 1, "that one read a frame is shared with the cloud shadows' drift, read again only in a new frame (`walkTick`), and made nowhere else");
  ok(/this\.roomPool = new RoomLightPool\(this\.interiorPoints, this\.interiorParallel, this\.interiorAmbient\);/.test(world), 'the pool holds the very lights the world always had');
  const portal = text('src/world/portalRender.ts');
  ok(!/if \(!view && this\.roomShadowBuilding\) view = this\.roomShadowBuilding;/.test(portal) && /if \(this\.roomShadows && this\.roomShadows\.casterList\.length\) this\.renderRoomShadows\(scene, routes\);/.test(portal), "the lit building's rooms are drawn into the room lamps' maps by a pass of their own, never shown in the sun's (the pass itself is run in roomLightsWorld.test)");
  const main = text('src/main.ts');
  ok(/this\.world\.setRoomLightPool\(roomPoolShape\(this\.settings\.roomLightSpots, this\.settings\.roomLightShadows\)\);/.test(main) && /fx\.setRoomLights\(shape\.spots \+ shape\.spotShadows, shape\.pointShadows\);/.test(main), "the session builds the pool and the occlusion's spots and casting points from the Graphics page's two settings");
  ok(/const r = await this\.lightPoolCurtain\(words, async \(\) => \{\r?\n      this\.world\.setRoomLightPool\(shape\);\r?\n      this\.postfx\?\.setRoomLights\(shape\.spots \+ shape\.spotShadows, shape\.pointShadows\);\r?\n      await this\.postfx\?\.warmUp\(\);/.test(main), 'a shape moved in play is built behind a curtain, the effects warmed under it');
  ok(/case 'roomLightSpots':\r?\n      case 'roomLightShadows':\r?\n[^\n]*\n        void this\.applyRoomLightPool\(\);/.test(main), 'either setting moved builds the pool again');
  // While a screen is up for anything else the shape waits for it to lift, then takes a curtain of its own; only with no world
  // in at all is it set at once.
  const apply = /private async applyRoomLightPool\(\): Promise<string> \{([\s\S]*?)\n  \}\n/.exec(main)?.[1] ?? '';
  const atOnce = apply.indexOf('if (!this.inWorld) {');
  const waits = apply.indexOf('if (this.traveling) {');
  const curtain = apply.indexOf('await this.lightPoolCurtain(');
  ok(atOnce > 0 && waits > atOnce && curtain > waits && /this\.roomPoolWait \?\?= this\.waitForScreen\(\)\.then\(/.test(apply) && !/if \(!this\.inWorld \|\| this\.traveling\)/.test(apply), 'the pool is set at once only with no world in; under a screen up for anything else it waits for it to lift and then takes a curtain of its own');
  ok(/for \(let j = 0; j < lampN \+ rooms\.extraCount && n < MAX_LAMPS; j\+\+\) \{\r?\n\s+const i = j;\r?\n\s+const p = j < lampN \? rooms\.points\[j\] : rooms\.extra\[j - lampN\];/.test(text('src/world/roomAir.ts')), "the room's air reads the pool's other lamps too");
  ok(/fillRoomPoolUniforms\(g as unknown as RoomPoolUniforms, R, useRegion, this\.roomSpots, this\.roomCast\);/.test(text('src/core/fx/ssao.ts')), "the occlusion hands the pool's spots and casting points to its own arrays (the filling is run in roomLightsWorld.test)");
}

console.log(`\nroomLights: ${checks} checks passed`);
