// The rain of ours (the volumetrics' fourth wave, the design's §2.16): the precipitation pool (`airRain.ts`), its frame
// through the real `AirField.stepRain` with a stand-in renderer that records what its update was handed, the arithmetic
// the programs hold to (`airParticleMath.ts`) and the weather's hand-overs. Held here:
//
//   - the game's own sheets are thinned only while ours draws that fall, and are exactly what they were otherwise;
//   - the share drawn is the weather's fall times the page's density times the open sky, held to [0, 1];
//   - the streaks' colour is the sky's own ambient and main light at their own scales, the sun's height and the
//     overcast, nothing of ours but the brightness and where the sun's light comes in;
//   - a drop wrapped across the box by the program's own line, run, is the mirror's;
//   - the pool steps once a frame it falls, with the air's velocity where the field ran and the wind's inflow where it did
//     not (it falls on past a doorway while the air indoors stands still), at 144 frames a second as at 60;
//   - its anchor moves by whole metres and the move is owed the next update; it fills afresh after a clear;
//   - nothing steps or draws with no fall, the master off, or the field refused; a step of nothing leaves the drops
//     hanging, drawn as they stood;
//   - snow takes its own fall and its own follow; the weather's kill slack and ridden hull are the weather's own objects;
//   - a drop risen past the box's top wraps to its foot, so a camera coming down faster than the rain never empties it,
//     and a move past the box in one go fills it afresh (the program's own wrap and roof rules run as script);
//   - the share the world writes is the share the draw is handed, and a slot's own hash under it draws within a percent;
//   - the anchor's moves carried by the program's own rule leave a slow flake's world place where its own motion took it,
//     eight kilometres out at 60, 144 and 240 frames a second.
//
// Plain type stripping; synthetic numbers only.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { AirField, newAirFrameInput, type AirWorld } from '../../../src/world/volumetrics/airField.ts';
import { AIR_TUNE } from '../../../src/world/volumetrics/airTune.ts';
import type { GroundSample, GroundSampler } from '../../../src/world/volumetrics/airRaster.ts';
import { newVolTune } from '../../../src/world/volumetrics/volSettings.ts';
import { backlight, driftOver, fallShare, rainColourIn, rainRise, sheetFactor, slotDrawn, wrapBox, type RainLight } from '../../../src/world/volumetrics/airParticleMath.ts';
import { RAIN_DRAW_VERTEX, RAIN_UPDATE_FRAGMENT } from '../../../src/world/volumetrics/airParticleShaders.ts';
import { rainRows, RAIN_WIDTH, type RainHull } from '../../../src/world/volumetrics/airRain.ts';
import { airRand } from '../../../src/world/volumetrics/airSpawn.ts';
import { glslFunctions, glslFunctionText, glslHash } from './glslRun.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const here = dirname(fileURLToPath(import.meta.url));
const source = (p: string): string => readFileSync(join(here, '..', '..', '..', 'src', p), 'utf8').replace(/\r\n/g, '\n');

// --- the arithmetic ---
{
  let exact = true;
  for (const thin of [0, 0.3, 1, 2, -1, Number.NaN]) if (!Object.is(sheetFactor(false, thin), 1)) exact = false;
  ok(exact, "the game's own sheets are exactly whole whenever ours does not draw that fall, whatever the thinning says");
  ok(sheetFactor(true, 1) === 0 && sheetFactor(true, 0.25) === 0.75 && sheetFactor(true, 2) === 0 && sheetFactor(true, -1) === 1, 'and thinned by the thinning, held to [0, 1], while it does');
  ok(fallShare(0.5, 1, 1) === 0.5 && fallShare(0.8, 0.5, 0.5) === 0.2 && fallShare(1, 3, 1) === 1 && fallShare(0.6, 1, 0) === 0 && fallShare(Number.NaN, 1, 1) === 0, "the share drawn: the weather's fall times the page's density times the open sky, held to [0, 1]");
  // At a quarter of the way up the sun's ease, where the ease (0.156) is not the straight line (0.25).
  const L: RainLight = { ambient: [0.2, 0.25, 0.3], ambientScale: 1.5, main: [1, 0.9, 0.8], mainScale: 2, sunY: 0.025, overcast: 0.4, sunUpTo: 0.1, bright: 1.2 };
  const out: [number, number, number] = [0, 0, 0];
  rainColourIn(L, out);
  const up = 0.25 * 0.25 * (3 - 2 * 0.25);
  const want = [0, 1, 2].map((i) => (L.ambient[i] * 1.5 + L.main[i] * 2 * up * 0.6) * 1.2);
  ok(Math.abs(up - 0.15625) < 1e-12 && out.every((v, i) => Math.abs(v - want[i]) < 1e-12), "the streaks' colour: the sky's ambient at its scale plus its main light at its scale, by the sun's height eased in (a smoothstep, not a straight line) and the overcast, times the brightness");
  rainColourIn({ ...L, sunY: 0.08 }, out);
  const up8 = 0.8 * 0.8 * (3 - 2 * 0.8);
  ok(out.every((v, i) => Math.abs(v - (L.ambient[i] * 1.5 + L.main[i] * 2 * up8 * 0.6) * 1.2) < 1e-12), 'and at four fifths of the way up (0.896, not 0.8)');
  rainColourIn({ ...L, sunY: -0.3 }, out);
  ok(out.every((v, i) => Math.abs(v - L.ambient[i] * 1.5 * 1.2) < 1e-12), 'with the sun under the horizon, the ambient alone');
  ok(Math.abs(backlight(1, 0.5, 1.5, 8) - 2) < 1e-12 && backlight(-0.7, 0.5, 1.5, 8) === 0.5, "against the sun a drop glows its lift over its base; away from it, its base alone");
  ok(RAIN_DRAW_VERTEX.includes('vRainColour = uRainColour * (uRainB.x + uRainB.y * pow(max(mu, 0.0), uRainB.z));'), "the draw's backlight is that line");
  const fn = glslFunctions(glslFunctionText(RAIN_UPDATE_FRAGMENT, 'wrapBox'), ['wrapBox'], { mod: (x: number, y: number) => x - y * Math.floor(x / y) });
  let same = true;
  for (const x of [-70, -32, -31.9, 0, 12.5, 31.99, 32, 33, 95]) if (Math.abs(fn.wrapBox(x, 32) - wrapBox(x, 32)) > 1e-12 || Math.abs(wrapBox(x, 32)) > 32) same = false;
  ok(same, "a drop wrapped across the box by the program's own line, run, is the mirror's, and stays inside it");
  ok(rainRows(16384) * RAIN_WIDTH === 16384 && rainRows(4096) * RAIN_WIDTH === 4096, "the drops' rows are the count over the width");
}

// --- the field, driven ---

interface RainDraw {
  p: [number, number, number, number];
  shift: [number, number, number, number];
  box: [number, number, number, number];
  anchor: [number, number, number, number];
  wind: [number, number];
  vel: boolean;
}

function standIn(): { renderer: THREE.WebGLRenderer; rains: RainDraw[]; names: string[] } {
  const rains: RainDraw[] = [];
  const names: string[] = [];
  let target: unknown = null;
  const gl = { getExtension: (): object => ({}), RED: 6403, RG: 33319, IMPLEMENTATION_COLOR_READ_FORMAT: 35739, getParameter: (): number => 6408 };
  const v4 = (q: THREE.Vector4): [number, number, number, number] => [q.x, q.y, q.z, q.w];
  const record = (material: THREE.Material): void => {
    names.push(material.name);
    if (material.name !== 'air.rain') return;
    const u = (material as THREE.ShaderMaterial).uniforms;
    const w = u.uWind.value as THREE.Vector2;
    rains.push({ p: v4(u.uRainP.value), shift: v4(u.uRainShift.value), box: v4(u.uRainBox.value), anchor: v4(u.uAnchor.value), wind: [w.x, w.y], vel: u.uVel.value !== null });
  };
  const renderer = {
    autoClear: true,
    getContext: () => gl,
    getRenderTarget: (): unknown => target,
    setRenderTarget: (t: unknown): void => {
      target = t;
    },
    getClearAlpha: (): number => 1,
    getClearColor: (c: THREE.Color): THREE.Color => c.setRGB(0, 0, 0),
    setClearColor: (): void => undefined,
    clear: (): void => undefined,
    getDrawingBufferSize: (v: THREE.Vector2): THREE.Vector2 => v.set(1920, 1080),
    render(obj: THREE.Object3D, cam: THREE.Camera): void {
      if ((obj as THREE.Scene).isScene) {
        (obj as THREE.Scene).onAfterRender(renderer as unknown as THREE.WebGLRenderer, obj as THREE.Scene, cam, null as never, null as never, null as never);
        return;
      }
      record((obj as THREE.Mesh).material as THREE.Material);
    },
    renderBufferDirect(_cam: THREE.Camera, _scene: THREE.Scene, _geo: THREE.BufferGeometry, material: THREE.Material): void {
      record(material);
    },
    compile: (): void => undefined,
    info: { programs: [] as unknown[] },
    properties: { get: (): object => ({}) },
  };
  return { renderer: renderer as unknown as THREE.WebGLRenderer, rains, names };
}

const ground: GroundSampler = {
  sample(_x: number, _z: number, out: GroundSample): boolean {
    out.h = 0;
    out.family = 1;
    out.medium = 1;
    out.tint = -1;
    return true;
  },
};

function rig(world: Partial<AirWorld> = {}) {
  const { renderer, rains, names } = standIn();
  const tune = newVolTune();
  tune.on = true;
  const field = new AirField(renderer, tune, { ground, boxes: null, hulls: [], ...world });
  field.raster.familyResponse = new Uint8Array([0, 0, 0, 0, 255, 255, 85, 255]);
  field.raster.familyColour = new Uint8Array([0, 0, 0, 0, 204, 168, 117, 255]);
  const inp = newAirFrameInput();
  inp.reading = true;
  inp.windHeading = 0.4;
  inp.windSpeed = 3;
  inp.sunY = 1;
  const f = field.rain.frame;
  /** A frame as the world runs one: the field's update, then the rain's frame written and stepped. */
  const frame = (dt: number, share = 0.6): RainDraw[] => {
    const from = rains.length;
    inp.dt = dt;
    inp.time += dt;
    field.update(inp);
    f.dt = dt;
    f.share = share;
    f.camX = inp.camX;
    f.camY = inp.camY + 1.7;
    f.camZ = inp.camZ;
    f.windX = Math.sin(inp.windHeading) * inp.windSpeed;
    f.windZ = Math.cos(inp.windHeading) * inp.windSpeed;
    field.stepRain();
    return rains.slice(from);
  };
  for (let i = 0; i < 400 && (field.raster.unknown > 0 || i < 4); i++) frame(1 / 60);
  return { field, tune, inp, rains, names, frame };
}

{
  const r = rig();
  const rain = r.field.rain;
  ok(rain.drawing && rain.mesh.visible && rain.stats.fills === 1 && rain.count === newVolTune().rainDetail, `falling: the pool made at its count (${rain.count} drops), filled once, drawn`);
  const one = r.frame(1 / 60);
  ok(one.length === 1 && one[0].p[2] === 1 && one[0].vel, 'a frame it falls on with the field running: one update, reading the air');
  let each = true;
  for (let i = 0; i < 144; i++) if (r.frame(1 / 144).length !== 1) each = false;
  ok(each, 'at 144 frames a second, exactly one update a frame');
  r.inp.where = 'a test: indoors';
  const door = r.frame(1 / 60);
  ok(door.length === 1 && door[0].p[2] === 0 && !door[0].vel && rain.drawing && Math.abs(door[0].wind[0] - Math.sin(0.4) * 3) < 1e-9, "a frame the field does not run (the camera in a building): it still falls past the doorway on the wind's inflow, reading no air");
  r.inp.where = null;
  const none = r.frame(1 / 60, 0);
  ok(none.length === 0 && !rain.drawing && !rain.mesh.visible, 'with no fall: nothing stepped, nothing drawn');
  r.frame(1 / 60);
  const hold = r.frame(0);
  ok(hold.length === 0 && rain.drawing && rain.mesh.visible, 'a step of nothing: no update, the drops hanging where they stood, still drawn');
  // The anchor: whole metres, the move owed the next update.
  r.frame(1 / 60);
  const a0 = rain.anchor.clone();
  r.inp.camX += 3.4;
  const moved = r.frame(1 / 60);
  ok(rain.anchor.x === a0.x + 3 && moved[0].shift[0] === 3 && moved[0].shift[1] === 0, 'the camera 3.4 m on: the anchor moves by its 3 whole metres, owed the update as a shift');
  const then = r.frame(1 / 60);
  ok(then[0].shift[0] === 0, 'and owed once');
  r.inp.camX += 0.4;
  const small = r.frame(1 / 60);
  ok(small[0].shift[0] === 1 && rain.anchor.x === a0.x + 4, 'a move that rounds over the next whole metre moves it by one');
  // Snow.
  rain.frame.snow = true;
  const flakes = r.frame(1 / 60);
  ok(flakes[0].p[3] === 1 && flakes[0].box[2] === AIR_TUNE.rain.snowFall && flakes[0].box[3] === AIR_TUNE.rain.snowTau, 'snow falls at its own speed and follows the air at its own pace');
  rain.frame.snow = false;
  // A clear fills afresh.
  const fills = rain.stats.fills;
  rain.clear();
  r.frame(1 / 60);
  ok(rain.stats.fills === fills + 1 && r.names.filter((n) => n === 'air.rain.fill').length >= 2, 'a clear fills the pool afresh at its next update');
  // The master off: nothing.
  r.tune.on = false;
  ok(r.frame(1 / 60).length === 0 && !rain.drawing && !rain.mesh.visible, 'with the master off: nothing stepped or drawn');
  r.tune.on = true;
  r.tune.rain = false;
  r.tune.snow = false;
  ok(r.frame(1 / 60).length === 0 && !rain.drawing, 'with the rain and the snow both off: nothing');
}

// The program's own lines, run as script (node compiles no GLSL).
{
  const U = RAIN_UPDATE_FRAGMENT;
  // A drop risen past the box's top wraps to its foot: a camera coming down faster than the rain never empties the box.
  const R = AIR_TUNE.rain;
  const box = { x: R.below, y: R.above };
  const fn = glslFunctions(glslFunctionText(U, 'rainRise'), ['rainRise'], { uRainBox: box, ceil: Math.ceil });
  let same = true;
  for (const y of [-4, 0, 17.9, 18, 18.01, 25, 40, 61, 300]) if (Math.abs(fn.rainRise(y) - rainRise(y, R.below, R.above)) > 1e-9 || fn.rainRise(y) > R.above || fn.rainRise(y) < -R.below - 1e-9) same = false;
  ok(same && rainRise(17, R.below, R.above) === 17 && Math.abs(rainRise(19, R.below, R.above) - (19 - R.below - R.above)) < 1e-12, "a drop risen past the box's top wraps to its foot (the program's line, run, is the mirror's), any other height as it is");
  // Fifty frames of a camera coming down 60 m a second (the rain falls 8): every drop still in the box with the wrap; with
  // the rule taken out (the control) every one of them stood above it, where nothing is drawn.
  const drops = Array.from({ length: 200 }, (_, i) => -R.below + ((i + 0.5) / 200) * (R.below + R.above));
  const kept = drops.slice();
  const lost = drops.slice();
  for (let f = 0; f < 50; f++) {
    for (let i = 0; i < kept.length; i++) {
      kept[i] = fn.rainRise(kept[i] + 1 - R.fall / 60);
      lost[i] = lost[i] + 1 - R.fall / 60;
    }
  }
  ok(kept.every((y) => y >= -R.below && y <= R.above) && lost.every((y) => y > R.above), `a camera coming down at 60 m/s keeps all 200 drops in the box (with the rule taken out, all ${lost.filter((y) => y > R.above).length} stood above it)`);
  ok(U.includes('pos.y = rainRise(pos.y);') && U.indexOf('pos.y = rainRise(pos.y);') > U.indexOf('pos += v * dt;') && U.indexOf('pos.y = rainRise(pos.y);') < U.indexOf('if (rainUnderRoof(pos.x, pos.y, pos.z)) reborn = true;'), 'the update wraps a drop as it moves it, before it asks the roofs');
  // Under a roof: the weather's own grid, absolute heights, nearest cell; outside it no answer.
  const roofs = [
    [0, 0, 6],
    [0, 12, 0],
  ];
  const env = {
    uAnchor: { x: 100, y: 3, z: 50, w: 0.15 },
    uRoofGrid: { x: 90, y: 40, z: 2, w: 3 },
    uRoofMap: null,
    vec2: (x: number, y = x) => ({ x, y }),
    ivec2: (v: { x: number; y: number }) => ({ x: Math.trunc(v.x), y: Math.trunc(v.y) }),
    texelFetch: (_m: unknown, c: { x: number; y: number }) => ({ r: roofs[c.y]?.[c.x] ?? 0 }),
  };
  const roof = glslFunctions(`${glslFunctionText(U, 'rainRoofCell')}\n${glslFunctionText(U, 'rainUnderRoof')}`, ['rainRoofCell', 'rainUnderRoof'], env);
  // Relative to the anchor (100, 3, 50): the grid's cell (2, 0) is 4..6 m east of the grid's corner (90, 40), a roof at 6 m.
  const under = (x: number, y: number, z: number): boolean => roof.rainUnderRoof(x, y, z) as unknown as boolean;
  ok(under(-5, 1, -9) && !under(-5, 3, -9) && !under(-9, 0, -9) && under(-9, -3.2, -9) && !under(-9, -2.9, -9), "a drop under its column's top in the weather's grid, by more than the kill slack, is under a roof; over it, or within the slack, it is not");
  ok((roof.rainRoofCell(-20, -20) as unknown as { x: number }).x === -1 && !under(-20, -20, -20) && !under(100, -50, 0), 'outside the grid there is no answer, and nothing is killed by it');
  ok(U.includes('if (rainUnderRoof(pos.x, pos.y, pos.z)) reborn = true;') && U.includes('pos = vec3((airRand(rs + 5u) * 2.0 - 1.0) * reach, uRainBox.y - airRand(rs + 6u), (airRand(rs + 7u) * 2.0 - 1.0) * reach);'), "a drop under a roof is born again within a metre of the box's top, anywhere across it");
  // The share drawn: a slot's own hash under the share, the program's own line run in unsigned 32-bit arithmetic.
  const D = RAIN_DRAW_VERTEX;
  const h = glslHash(D);
  const m = /bool rainSlotDrawn\(int i, float share\) \{\s*return airRand\(uint\(i\) \* (\d+)u \+ (\d+)u\) < share;\s*\}/.exec(D);
  ok(!!m && D.includes('bool drawn = s1.w > 0.5 && rainSlotDrawn(i, uRainD.y);'), "the draw shows a drop while its slot's own hash is under the share it is handed (uRainD.y)");
  const mul = Number(m?.[1] ?? 0);
  const add = Number(m?.[2] ?? 0);
  const drawnAt = (i: number, share: number): boolean => h.airRand((Math.imul(i, mul) + add) >>> 0) < share;
  for (const share of [0.1, 0.35, 0.6, 0.9]) {
    let n = 0;
    let agree = true;
    for (let i = 0; i < 16384; i++) {
      const d = drawnAt(i, share);
      if (d) n++;
      if (d !== slotDrawn(airRand((Math.imul(i, mul) + add) >>> 0), share)) agree = false;
    }
    ok(agree && Math.abs(n / 16384 - share) < 0.01, `at a share of ${share}, ${n} of 16,384 drops drawn (${((n / 16384) * 100).toFixed(2)}%), within a percent, each slot as the mirror says`);
  }
  ok(D.includes('vec4 tail = viewMatrix * (world - vec4(vel * uRainS.x, 0.0));') && D.includes('float wid = max(uRainS.y, uRainS.z * pixel);') && D.includes('if (al < wid) tail.xy = mv.xy - (al > 1e-6 ? along / al : vec2(0.0, 1.0)) * wid;'), "a streak of ours runs back from its head along its velocity by its seconds, at least its least pixels wide and never shorter on the screen than it is wide");
}

// The field's frame for the rain: the share it is handed reaches the draw; the anchor's moves carried; a jump fills afresh.
{
  const r = rig();
  const rain = r.field.rain;
  const dd = rain.drawMaterial.uniforms.uRainD.value as THREE.Vector4;
  r.frame(1 / 60, 0.35);
  const a = dd.y;
  r.frame(1 / 60, 0.8);
  ok(Math.abs(a - 0.35) < 1e-12 && Math.abs(dd.y - 0.8) < 1e-12, `the share the world writes (rain.frame.share) is the share the draw is handed (${a}, ${dd.y})`);
  // A 10 m drop of the camera: the move owed, no fill; a 30 m drop (past the box's height): a jump, the pool filled afresh.
  r.frame(1 / 60);
  const fills = rain.stats.fills;
  r.inp.camY -= 10;
  const ten = r.frame(1 / 60);
  ok(ten[0].shift[1] === -10 && rain.stats.fills === fills, 'the camera 10 m down: the move owed the update (the drops wrapped into the box as they rise past it), the pool kept');
  r.inp.camY -= 30;
  const jumps = rain.stats.jumps;
  const thirty = r.frame(1 / 60);
  ok(rain.stats.jumps === jumps + 1 && rain.stats.fills === fills + 1 && thirty[0].shift[1] === 0, `30 m down in one go (past the box's ${AIR_TUNE.rain.below + AIR_TUNE.rain.above} m): a jump, the pool filled afresh about the camera and nothing owed`);
  r.inp.camX += 70;
  r.frame(1 / 60);
  ok(rain.stats.jumps === jumps + 2 && rain.stats.fills === fills + 2, `and 70 m across in one go (past the box's ${2 * AIR_TUNE.rain.reach} m): a jump too`);
  ok(source('world/volumetrics/airField.ts').includes('if (code === PLACE.jump) this.rain.clear();'), "and the window's own jump clears the rain as it clears the kick-up (a jump clears both pools)");
  // The moving air off: the rain still falls on the wind's inflow, its anchor placed, no air read.
  r.tune.air = false;
  const off = r.frame(1 / 60);
  ok(off.length === 1 && off[0].p[2] === 0 && !off[0].vel && rain.drawing, 'with the moving air off (volAir): still falling on the inflow, reading no air');
}
// The anchor's moves carried: a slow flake kept in float32 relative to the anchor, as the card keeps it, taken off by the
// program's own rule, stays where its own motion took it, eight kilometres out, at 60, 144 and 240 frames a second.
{
  ok(RAIN_UPDATE_FRAGMENT.includes('vec3 pos = s0.xyz - uRainShift.xyz;') && RAIN_UPDATE_FRAGMENT.includes('pos += v * dt;'), "the program takes the anchor's moves owed off a drop's place (s0 - uRainShift) before it moves it");
  const ride = (fps: number): { worst: number; moves: number; owedOnce: boolean } => {
    const r = rig();
    r.inp.camX = 8000;
    r.inp.camZ = -8000;
    for (let i = 0; i < 600 && (r.field.raster.unknown > 0 || i < 4); i++) r.frame(1 / fps);
    const v = [0.05, -0.02, 0.03];
    const start = [8001.5, 4.25, -7998.5];
    let p: number[] | null = null;
    let prev: RainDraw | null = null;
    let t = 0;
    let worst = 0;
    let moves = 0;
    let owedOnce = true;
    for (let i = 0; i < Math.round(fps * 3); i++) {
      r.inp.camX += 3 / fps;
      r.inp.camY += 1.5 / fps;
      r.inp.camZ -= 2 / fps;
      for (const d of r.frame(1 / fps)) {
        if (prev && (d.shift[0] !== d.anchor[0] - prev.anchor[0] || d.shift[1] !== d.anchor[1] - prev.anchor[1] || d.shift[2] !== d.anchor[2] - prev.anchor[2])) owedOnce = false;
        prev = d;
        if (!p) {
          p = [Math.fround(start[0] - d.anchor[0]), Math.fround(start[1] - d.anchor[1]), Math.fround(start[2] - d.anchor[2])];
          continue;
        }
        if (d.shift[0] !== 0 || d.shift[1] !== 0 || d.shift[2] !== 0) moves++;
        for (let c = 0; c < 3; c++) {
          p[c] = Math.fround(p[c] - Math.fround(d.shift[c]));
          p[c] = Math.fround(p[c] + Math.fround(v[c] * Math.fround(d.p[0])));
        }
        t += d.p[0];
        for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(d.anchor[c] + p[c] - (start[c] + v[c] * t)));
      }
    }
    return { worst, moves, owedOnce };
  };
  for (const fps of [60, 144, 240]) {
    const g = ride(fps);
    ok(g.worst < 0.005 && g.moves >= 8 && g.owedOnce, `${fps} frames a second, 8 km out, the anchor moved ${g.moves} times: a 5 cm/s flake carried by the moves owed stays where its own motion took it (worst ${(g.worst * 1000).toFixed(3)} mm off), each move owed exactly once`);
  }
  // The control: kept in the world's frame eight kilometres out, the same flake at 240 frames a second does not move.
  ok(Math.abs(driftOver(8000, 0.05, 3, 240)) < 0.01, 'kept in the world\'s frame instead, it stalls (the reason the pool keeps its own anchor)');
}

// The weather's own objects, by reference.
{
  const hull: RainHull = { uKillSlack: { value: 0.15 }, uHullOn: { value: 0 }, uHullToLocal: { value: new THREE.Matrix4() }, uHullMin: { value: new THREE.Vector3() }, uHullMax: { value: new THREE.Vector3() } };
  const r = rig({ rainHull: hull });
  const u = r.field.rain.drawMaterial.uniforms;
  ok(u.uKillSlack === hull.uKillSlack && u.uHullOn === hull.uHullOn && u.uHullToLocal === hull.uHullToLocal && u.uHullMin === hull.uHullMin && u.uHullMax === hull.uHullMax, "the drops are discarded under a roof and inside the ridden hull by the weather's own uniform objects");
  hull.uKillSlack.value = 0.4;
  r.frame(1 / 60);
  const ra = r.field.rain.updateMaterial.uniforms.uAnchor.value as THREE.Vector4;
  ok(ra.w === 0.4, "and the update kills under a roof by the weather's slack as it stands");
  const m = r.field.rain.drawMaterial;
  ok(m.transparent && !m.depthWrite && m.userData.unlit === true && m.userData.dry === true && m.fog === false, 'its draw blended, writing no depth, unlit and dry (nothing adopts it), with no fog of three\'s in its key');
}

// The hand-overs only the game makes (each behaviour test above makes them for itself).
{
  const world = source('world/world.ts');
  ok(/air\.update\(inp\);\n(?:\s*\/\/[^\n]*\n)*\s*air\.stepRain\(\);/.test(world), "the world steps the rain straight after the field's frame, on every path out of it");
  ok(world.includes('this.weather.rainSheetScale = sheetFactor(drew && !air.rain.frame.snow, VOL_TUNE.rainThin);') && world.includes('this.weather.snowSheetScale = sheetFactor(drew && air.rain.frame.snow, VOL_TUNE.snowThin);') && world.includes('this.weather.airRainDraws = drew;'), "and hands the weather whether ours draws and the sheets' two factors");
  ok(/if \(!air \|\| !this\.camera\) \{\n\s+this\.weather\.stormSheetScale = 1;\n\s+this\.weather\.rainSheetScale = 1;\n\s+this\.weather\.snowSheetScale = 1;\n\s+this\.weather\.airRainDraws = false;/.test(world), 'with no field, the weather is told today\'s every frame');
  ok(world.includes('const hung = air.rain.mesh.parent === this.weather.scene;') && world.includes('!hung || !VOL_TUNE.on'), "the rain falls only while its mesh is hung in the weather's scene, so the sheets are never thinned for a rain that is not drawn");
  ok(world.includes('rainHull: PARTICLE_UNIFORMS') && source('world/weather.ts').includes('export const PARTICLE_UNIFORMS = {'), "the field is handed the weather's own particle uniforms");
  const weather = source('world/weather.ts');
  ok(weather.includes("if (ch.kind === 'rain' && this.rainSheetScale !== 1) ch.handle.rateScale *= this.rainSheetScale;") && weather.includes("if (ch.kind === 'snow' && this.snowSheetScale !== 1) ch.handle.rateScale *= this.snowSheetScale;"), "the weather thins its rain and snow channels by the factors, and does not touch them at exactly 1");
  ok(weather.includes('if ((falling || fx.quads > 0 || wet || this.airRainDraws) && !high) {') && weather.includes('if (!this.drawPass || !fx || (fx.quads === 0 && !this.airRainDraws)) return;'), 'and keeps its roof grid and its pass for our drops while they draw');
  ok(weather.includes('for (let i = 0; i < this.airMaterials.length; i++) passStencil(this.airMaterials[i], portalView);'), "our rain takes the weather pass's stencil (through the exits only, from inside a building)");
}

console.log(`\n${checks} checks passed`);
