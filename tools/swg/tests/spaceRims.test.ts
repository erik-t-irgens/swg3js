// Space and the map (the GPU port's pass 2, wave 4b, maker C): the planets' air in a space zone, the Nebulae row and where a
// zone's volumes of gas stand, the volumes' mends, and the galaxy map's globes in his looks. The pure rules the drawing and the
// world read (`src/space/spaceAir.ts`, `nebulaForm.ts`, `loreStarts.js`, `src/ui/galaxyLooks.ts`), the dials through their
// setters, and the lines the WebGL path keeps as text. Where the converted packs are on this machine (read only) every zone's
// planets are named and placed as the viewer names them.
//
// Run: node tools/swg/tests/spaceRims.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RIM_LIT, RIM_PROFILE_SIZE, SPACE_RIM_TUNE, appearanceName, lookFormOf, lookRecordOf, ownRecordOf, paintedRimAt, rimProfile, spaceBodyAir, spacePlaceIds, tuneSpaceRims } from '../../../src/space/spaceAir.ts';
import { DEFAULT_VOLUMES, NEBULA_FORM_VALUES, VOLUME_FIXED, nebulaFormOf, occluderOf, stageDistance, volumeHang, volumePlacesOf, volumeTierOf } from '../../../src/space/nebulaForm.ts';
import { loreStart, skyDirection } from '../../../src/space/loreStarts.js';
import { MISSING } from '../../../src/sky/look/missing.js';
import { skyDirection as placesSkyDirection } from '../../../src/sky/system/places.js';
import { DEFAULT_USES } from '../../../src/sky/look/looks.js';
import { bodyRecord } from '../../../src/sky/bodies/bodyAir.ts';
import { recordKey, recordOf, airStartFor } from '../../../src/sky/look/airProfile.js';
import { GLOBE_TUNE, globePlaceOf, globePlanetIndex, halve, mapLookPlaces } from '../../../src/ui/galaxyLooks.ts';
import { planetTextureOf } from '../../../src/data/galaxy.ts';
import { SKY_BODIES, cleanBodiesFile } from '../../../src/sky/look/bodiesFile.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let checks = 0;
const ok = (cond: unknown, what: string): void => {
  assert.ok(cond, what);
  checks++;
};
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------- 1. which air a zone's planet has
{
  ok(spaceBodyAir('appearance/planet_tatooine.pln').kind === 'world' && (spaceBodyAir('appearance/planet_tatooine.pln') as { world: string }).world === 'tatooine', 'Tatooine in its zone is the ground world tatooine');
  ok((spaceBodyAir('appearance/planet_endor.pln') as { world?: string }).world === 'endor', "Endor's forest moon in its zone is the ground world endor");
  ok(spaceBodyAir('appearance/planet_gas_endor.pln').kind === 'giant' && spaceBodyAir('appearance/planet_yavin.pln').kind === 'giant', "Endor's gas giant and Yavin Prime are giants of air with no ground");
  ok(spaceBodyAir('appearance/planet_kessel.pln').kind === 'temperate' && spaceBodyAir('appearance/planet_ord_mantell.pln').kind === 'temperate', 'Kessel and Ord Mantell take a temperate world\'s air until a look of his names theirs');
  for (const moon of ['planet_naboo_moon', 'planet_tatooine_moon_02', 'planet_corl_moon_01', 'planet_ord_mantell_moon_03']) ok(spaceBodyAir(`appearance/${moon}.pln`).kind === 'airless', `${moon} has no air`);
  ok(appearanceName('appearance/planet_naboo.pln') === 'planet_naboo', 'an appearance is named by its file');
  // A ground world's rim from orbit is the very record its rim from a moon is drawn with: the same numbers, the same key.
  const fromOrbit = bodyRecord(spaceBodyAir('appearance/planet_naboo.pln'))!;
  const fromRori = bodyRecord({ kind: 'world', world: 'naboo' })!;
  ok(recordKey(fromOrbit) === recordKey(fromRori), "Naboo's record from its orbit is its record from Rori (one key, one bake of its tables)");
  ok(recordKey(ownRecordOf({ kind: 'giant' }, null)!) === recordKey(recordOf(airStartFor('gasgiant'))), "a giant with no look takes the viewer's giant start");
  const lookAir = { mode: 'scattered', visibilityKm: 12, hazeColour: '#ffd0a0' };
  ok(recordKey(ownRecordOf({ kind: 'temperate' }, lookAir)!) === recordKey(recordOf(lookAir)), "a world with no ground takes its look's own air where the file gives one");
  ok(lookRecordOf({ kind: 'airless' }, null) === null, 'a moon with no look has no air');
  ok(lookRecordOf({ kind: 'airless' }, lookAir) !== null && lookRecordOf({ kind: 'airless' }, { mode: 'none' }) === null, "a moon wearing a look with air takes that air, unless the look's air is None");
  ok(lookFormOf({ mode: 'painted' }) === 'painted' && lookFormOf(null) === null && lookFormOf({ mode: 'odd' }) === null, "a look's own form of air is read, nothing else");
}

// ---------------------------------------------------------------- 2. the places as the viewer names them
{
  ok(JSON.stringify(spacePlaceIds('space_naboo', ['appearance/planet_naboo.pln', 'appearance/planet_naboo_moon.pln', 'appearance/planet_naboo_moon.pln', 'appearance/planet_naboo_moon.pln'])) === JSON.stringify(['space_naboo:planet_naboo', 'space_naboo:planet_naboo_moon#1', 'space_naboo:planet_naboo_moon#2', 'space_naboo:planet_naboo_moon#3']), 'a repeated appearance is counted from 1, a single one is not');
  const packs = join(ROOT, 'assets-private');
  const zones = existsSync(packs) ? readdirSync(packs).filter((z) => z.startsWith('space_') && existsSync(join(packs, z, 'space.json'))) : [];
  if (zones.length) {
    const named = new Set<string>();
    for (const z of zones) {
      const pack = JSON.parse(readFileSync(join(packs, z, 'space.json'), 'utf8')) as { planets: { appearance: string; texture?: string | null; size?: number }[] };
      for (const id of spacePlaceIds(z, pack.planets.map((p) => p.appearance))) named.add(id);
      // The map's globe stands for the planet whose picture the map shows today.
      const keys = [z.replace(/^space_/, '')];
      const i = globePlanetIndex(pack.planets, keys);
      const tex = planetTextureOf(pack as never, keys);
      ok((i < 0 && tex === null) || pack.planets[i]?.texture === tex, `${z}: the globe's planet is the one whose picture the map shows today`);
      if (i >= 0) ok(globePlaceOf(z, pack.planets, keys) === spacePlaceIds(z, pack.planets.map((p) => p.appearance))[i], `${z}: the globe's place is its planet's place`);
    }
    // Every space place the viewer's own choices name, in a zone converted here, is one of ours.
    for (const place of Object.keys(DEFAULT_USES)) {
      const zone = place.split(':')[0];
      // (the viewer's extra places, a Death Star over Endor, are not the zone's file's planets)
      if (!zone.startsWith('space_') || !zones.includes(zone) || !/:planet_/.test(place)) continue;
      ok(named.has(place), `the viewer's place ${place} is named the same way here`);
    }
  } else console.log('note: no converted space packs here: the places are held to the viewer\'s rule alone');
}

// ---------------------------------------------------------------- 3. the painted rim
{
  const rec = bodyRecord({ kind: 'world', world: 'naboo' })!;
  const t0 = performance.now();
  const p = rimProfile(rec);
  const ms = performance.now() - t0;
  ok(p.length === RIM_PROFILE_SIZE * 4, 'a rim table holds RGBA at each of its heights');
  ok(rimProfile(rec) === p, "a record's table is made once (kept by its numbers)");
  ok(ms < 200, `a rim table is made in ${ms.toFixed(1)} ms of the main thread (small tables: never the bake's)`);
  const lum = (i: number): number => 0.2126 * p[i * 4] + 0.7152 * p[i * 4 + 1] + 0.0722 * p[i * 4 + 2];
  ok(lum(0) > lum(RIM_PROFILE_SIZE >> 1) && lum(RIM_PROFILE_SIZE >> 1) > lum(RIM_PROFILE_SIZE - 1), "the limb's light falls with height through the shell");
  ok(lum(RIM_PROFILE_SIZE - 1) < lum(0) * 0.02, 'nearly nothing at the top of the air');
  ok(p[2] > p[0] && p[4 * 3 + 2] > p[4 * 3], "a temperate world's limb is blue (Rayleigh's)");
  ok(p[3] > 0.5 && p[(RIM_PROFILE_SIZE - 1) * 4 + 3] < 0.05, 'what it hides: most of what lies behind at the ground, nearly nothing at the top');
  const out = [0, 0, 0];
  const shell = rec[1] / rec[0];
  paintedRimAt(p, shell * 1.001, 1, shell, 1, out);
  ok(out[0] === 0 && out[1] === 0 && out[2] === 0, 'nothing past the top of the shell');
  paintedRimAt(p, 1.0005, -0.5, shell, 1, out);
  ok(out[2] === 0, 'nothing on the limb past twilight');
  paintedRimAt(p, 1.0005, 1, shell, 1, out);
  const lit = out[2];
  ok(lit > 0, 'the lit limb glows');
  paintedRimAt(p, 0.6, 1, shell, 1, out);
  ok(out[2] > 0 && out[2] < lit * 0.25, "over the disc the haze is the slant path's share of the grazing ray's");
  paintedRimAt(p, 1.0005, 1, shell, 2, out);
  ok(near(out[2], lit * 2, 1e-12), "the painted rim's strength scales it");
  ok(RIM_LIT.from < 0 && RIM_LIT.to > 0, 'the rim lights from just past twilight');
  // The dials, through their setter.
  const said = tuneSpaceRims({ painted: 99, off: 1, nope: 1 });
  ok(SPACE_RIM_TUNE.painted === 8 && SPACE_RIM_TUNE.off === 1 && said.some((s) => s.includes('held to 8')) && said.some((s) => s.includes('no such dial')), 'the rims\' dials are held to their ranges, and an unknown one is refused');
  tuneSpaceRims({ painted: 1, off: 0 });
  ok(SPACE_RIM_TUNE.painted === 1 && SPACE_RIM_TUNE.off === 0, 'the dials back at their starts');
}

// ---------------------------------------------------------------- 4. the Nebulae row and where the volumes stand
{
  ok(NEBULA_FORM_VALUES.tier === -1 && NEBULA_FORM_VALUES.off === 0 && NEBULA_FORM_VALUES.sheets === 1 && NEBULA_FORM_VALUES.volumes === 2, "the row's values");
  const want: Record<number, string> = { 0: 'sheets', 1: 'sheets', 2: 'volumes', 3: 'volumes', [-1]: 'volumes' };
  for (const t of [-1, 0, 1, 2, 3]) {
    ok(nebulaFormOf(-1, t) === want[t], `by the tier ${t}: ${want[t]} (only High starts on the volumes; a custom set takes High's)`);
    ok(nebulaFormOf(0, t) === 'off' && nebulaFormOf(1, t) === 'sheets' && nebulaFormOf(2, t) === 'volumes', `the row's own choice stands at tier ${t}`);
  }
  ok(volumeTierOf(0) === 'low' && volumeTierOf(1) === 'low' && volumeTierOf(2) === 'medium' && volumeTierOf(3) === 'medium' && volumeTierOf(-1) === 'medium', "the volumes march the viewer's baked Medium from High, its Low below, never its live High");
  const settings = readFileSync(join(ROOT, 'src/core/settings.ts'), 'utf8');
  ok(/nebulaForm: -1,/.test(settings), "the row starts on the tier's rule");
  // The lore's starts and the sky's directions are the viewer's own.
  for (const e of MISSING as { id: string; placement?: { start?: Record<string, number> } }[]) {
    const s = e.placement?.start;
    const got = loreStart(e.id);
    if (!s || !Number.isFinite(s.yaw) || !Number.isFinite(s.size)) continue;
    ok(got !== null && got.yaw === s.yaw && got.pitch === s.pitch && got.size === s.size, `${e.id}: its start as the lore gives it`);
  }
  for (const [yaw, pitch] of [[0, 0], [90, 10], [165, 20], [-51, -30]]) {
    const a = skyDirection(yaw, pitch);
    const b = placesSkyDirection(yaw, pitch);
    ok(a.x === b.x && a.y === b.y && a.z === b.z, `the sky's direction at yaw ${yaw}, pitch ${pitch} is places.js's`);
  }
  // No file: Kessel's Maw wears the Maelstrom where its lore entry starts it; no other zone has a volume.
  const kessel = [{ appearance: 'appearance/planet_kessel.pln', direction: [-450, -90, 190], size: 4.3622 }];
  const none = volumePlacesOf('space_light1', kessel, null, () => false);
  ok(none.length === 1 && none[0].place === 'new:space_light1:the_maw' && none[0].look === DEFAULT_VOLUMES['new:space_light1:the_maw'] && none[0].sizeDeg === 35 && !none[0].fromFile, "no file: the Maw's place wears the viewer's Maelstrom");
  const dir = skyDirection(165, 20);
  ok(near(none[0].dir.x, dir.x, 1e-12) && near(none[0].dir.y, dir.y, 1e-12) && near(none[0].dir.z, dir.z, 1e-12), 'it stands at its lore start');
  ok(volumePlacesOf('space_naboo', [], null, () => true).length === 0, 'a zone with no volume of its own has none');
  // The file names it: a look with gas, from the file; a look without, nothing (his choice stands).
  ok(volumePlacesOf('space_light1', kessel, { 'new:space_light1:the_maw': 'mine' }, (id) => id === 'mine')[0]?.fromFile === true, "the file's own look with gas, from the file");
  ok(volumePlacesOf('space_light1', kessel, { 'new:space_light1:the_maw': 'plain' }, () => false).length === 0, 'a look of his with no gas on the place: no volume');
  // A volume worn by a planet's own place stands where the planet hangs, at its angle.
  const onPlanet = volumePlacesOf('space_light1', kessel, { 'space_light1:planet_kessel': 'gas' }, () => true);
  ok(onPlanet.length === 2 && near(onPlanet[0].sizeDeg, (2 * Math.asin((4.3622 * 240) / 2600) * 180) / Math.PI, 1e-9), "a planet's own place: its angle across as the game sizes it");
  // Hung in the game: its angle kept; a planet in front of it stands where the viewer's stage has it, at its own angle.
  const v = none[0];
  const hang = volumeHang(v, VOLUME_FIXED.reach, { x: 0, y: 0, z: 0, w: 0 });
  const ang = Math.asin(hang.w / Math.hypot(hang.x, hang.y, hang.z));
  ok(near((2 * ang * 180) / Math.PI, 35, 1e-9), 'the ball covers its 35 degrees at the reach it hangs');
  ok(VOLUME_FIXED.reach + VOLUME_FIXED.reach * Math.sin(Math.PI / 2 - 0.01) < 9000, 'the widest ball stands inside the far plane');
  const o = occluderOf(v, VOLUME_FIXED.reach, { x: 1, y: 0, z: 0 }, 497, 0.4, { x: 0, y: 0, z: 0, w: 0 });
  ok(near(o.w / Math.hypot(o.x, o.y, o.z), 0.4, 1e-12), "a planet keeps its angle as the gas sees it");
  ok(near(Math.hypot(o.x, o.y, o.z) / VOLUME_FIXED.reach, stageDistance(497) / stageDistance(2600), 1e-12), "and stands in front of the gas or behind it as the viewer's stage stands it");
}

// ---------------------------------------------------------------- 5. the volumes' mends (`volume.js`)
{
  const vol = readFileSync(join(ROOT, 'src/sky/look/volume.js'), 'utf8');
  ok(/export const NEAR_FADE = \{ from: 0\.15, to: 0\.7 \};/.test(vol) && /const near = smoothstep\(NEAR_FADE\.from, NEAR_FADE\.to, t\);/.test(vol), "the near side of a wide veil thins (NEAR_FADE), the march reading it");
  ok(/export const SHOULDER = \{ white: 0\.08, most: 0\.5 \};/.test(vol) && /min\(m\.sub\(f\), SHOULDER\.most\)\.mul\(SHOULDER\.white\)/.test(vol) && !/m\.sub\(f\)\.mul\(0\.22\)/.test(vol), "the shoulder's grey is held (the Maelstrom's heart keeps its colour)");
  ok(/export const HOT_EDGE = \{ colour: \[1\.0, 0\.82, 0\.6\], share: 0\.35 \};/.test(vol) && /HOT_EDGE\.share/.test(vol) && !/vec3\(1\.0, 0\.94, 0\.86\)/.test(vol), "the hot disc's inner edge warms toward a warm white");
  // The shoulder's arithmetic (the march's last lines, in numbers): the heart's ring, its rim colour times nearly four.
  const shoulder = (G: number[], white: number, most: number): number[] => {
    const m = Math.max(...G);
    const f = m > 0.7 ? 0.7 + 0.3 * (1 - Math.exp((m - 0.7) / -0.3)) : m;
    const g = Math.min(m - f, most) * white;
    return G.map((c) => (c * f) / m + g);
  };
  const ring = [3.7, 1.69, 0.59];
  const sat = (c: number[]): number => (Math.max(...c) - Math.min(...c)) / Math.max(...c);
  const before = shoulder(ring, 0.22, Infinity);
  const after = shoulder(ring, 0.08, 0.5);
  ok(sat(before) < 0.55 && sat(after) > 0.75, `the heart's ring kept its colour: saturation ${sat(before).toFixed(2)} before, ${sat(after).toFixed(2)} after`);
}

// ---------------------------------------------------------------- 6. the galaxy map's globes
{
  const px = new Uint8Array([0, 0, 0, 255, 4, 8, 12, 255, 8, 16, 24, 255, 12, 24, 36, 255]);
  const h = halve(px, 2, 2);
  ok(h.length === 4 && h[0] === 6 && h[1] === 12 && h[2] === 18 && h[3] === 255, 'a picture halved by its 2-by-2 means');
  ok(GLOBE_TUNE.size === 512 && GLOBE_TUNE.rimHeight > 1 && GLOBE_TUNE.cloudHeight > 1, "the globes' starts");
  const was = SKY_BODIES.file;
  const c = cleanBodiesFile({ version: 1, looks: { 'generated:naboo': { name: 'Naboo', generated: { recipe: 'terran', seed: 3, dials: {}, size: 1024 }, layers: {}, adjust: {} } }, uses: { 'space_naboo:planet_naboo': 'generated:naboo', 'space_naboo:planet_naboo_moon#1': 'generated:naboo', 'rori:celestial:cels_naboo': 'generated:naboo' } });
  SKY_BODIES.file = c.file;
  const places = mapLookPlaces();
  SKY_BODIES.file = was;
  ok(places.length === 1 && places[0] === 'space_naboo:planet_naboo', "the map bakes each zone's main worlds' looks the file names, never a moon's or a ground sky's");
  const view = readFileSync(join(ROOT, 'src/ui/galaxyView.ts'), 'utf8');
  ok(/const withLooks = GPU\.webgpu;/.test(view) && /if \(withLooks && rimSphere\) \{/.test(view), 'the cloud shells and the rims are made with the game on WebGPU alone (WebGL keeps its globes)');
  ok(/if \(first\?\.clouds\) first\.clouds\.visible = true;/.test(view) && /if \(first\?\.rim\) first\.rim\.visible = true;/.test(view), "their two programs are compiled with the map's own on its first frame");
  ok(view.includes(`smoothstep(\${RIM_LIT.from.toFixed(3)}, \${RIM_LIT.to.toFixed(3)}`) && view.includes('graze / sqrt(max(1.0 - rho * rho, 1e-6))'), "the globe's rim is the space planets' painted rule");
}

// ---------------------------------------------------------------- 7. the WebGL path keeps its lines
{
  const w = readFileSync(join(ROOT, 'src/world/world.ts'), 'utf8');
  const lines = w.split('\n').map((l) => l.trim());
  const mine = ['if (GPU.webgpu) rimBodies.push(', 'if (GPU.webgpu && rimBodies.length) {', 'if (GPU.webgpu) this.dropSpaceRims();', 'if (GPU.webgpu && this.spaceRims && this.camera) this.spaceRimsFrame(this.spaceRims, this.camera);', 'if (GPU.webgpu) await this.loadVolumes(token);', 'if (GPU.webgpu) this.dropVolumes();', 'if (GPU.webgpu && this.spaceData) this.spaceNebulaFrame(camPos, dt);', 'if (GPU.webgpu && !(await bakeMapLooks(() => token !== this.loadToken))) return null;'];
  for (const m of mine) ok(lines.some((l) => l.startsWith(m)), `world.ts: "${m}" is a guard of WebGPU's alone`);
  ok(/import type \{ GpuSpaceRimSet, GpuSpaceVolumeSet \} from '\.\.\/core\/gpuSwitch\.ts';/.test(w), "world.ts takes the runtime's types alone");
  const air = w.indexOf('airFrame(camera: THREE.PerspectiveCamera): void {');
  ok(air > 0 && w.slice(air, air + 600).includes('if (v && v.shown) v.draw(camera, GPU.rt!.taa.sceneSize(this.volumeSize));'), "the volumes' half-size march is drawn only where they stand and are shown (never on WebGL, which makes none), the scene's size handed in a kept vector");
  const menu = readFileSync(join(ROOT, 'src/main.ts'), 'utf8');
  ok(menu.includes("if (key === 'nebulaForm' && !GPU.webgpu) return { hide: true };"), 'the Nebulae row is left off the page on WebGL');
}

console.log(`\nspaceRims: ${checks} checks passed`);
