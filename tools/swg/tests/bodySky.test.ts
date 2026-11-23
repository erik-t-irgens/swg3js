// The moons and planets in the sky (the GPU port's pass 2, wave 4a, maker B; the design's 2.5, 2.6 and 2.10, the brief's
// items 5, 6 and 8): their air form by tier, the owner's condition that the ground never reads it, the 3% limb test between
// the ground path and the body path, which air a body has, the bake cache, and the cards' frame, each run as the game runs it.
//   node tools/swg/tests/bodySky.test.ts
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import * as TSL from 'three/tsl';
import { BODY_TIERS, BODY_TUNE, BODY_TUNE_RANGE, bodyFormOf, screenShareOf, tierRule, tuneBodies } from '../../../src/sky/bodies/bodyTier.ts';
import { bodyOfPicture, bodyRecord, bodyTablesKey, hasAir } from '../../../src/sky/bodies/bodyAir.ts';
import { BAKE_TUNE, BakeCache, idbStore, lookHash, type BakeStore } from '../../../src/sky/bodies/bakeCache.ts';
import { bodyCardMaterial, type SkyBodyCard } from '../../../src/sky/bodies/bodyCard.ts';
import { skyBodiesConsole } from '../../../src/sky/bodies/bodyConsole.ts';
import { TIER_KEYS, TIER_NAMES, tierValues } from '../../../src/ui/qualityTiers.ts';
import { AIR, AIR_SIZES, HAZE_REACH_M } from '../../../src/sky/air/airApi.ts';
import { F, airDialsOf, setVisibility, tuneAirDials, worldRecord, setHazeTint } from '../../../src/sky/air/airParams.ts';
import { AirLights, DEPTH_FLOATS, PSI_FLOATS, TWIN_DEPTH, TWIN_PSI, TWIN_STEPS, buildDepthTable, buildPsiTable, viewRadiance } from '../../../src/sky/air/airTwin.ts';
import * as V from '../../../src/sky/look/airProfile.js';
import { turnSkyBody } from '../../../src/world/skyBodies.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const text = (p: string): string => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------- 1. the tiers' rule (the design's table)
{
  ok(BODY_TIERS.length === TIER_NAMES.length, `one rule a tier (${TIER_NAMES.join(', ')})`);
  ok(BODY_TIERS[0].form === 'painted' && BODY_TIERS[1].form === 'scattered' && BODY_TIERS[1].shareMost === 0.25 && BODY_TIERS[2].form === 'scattered' && BODY_TIERS[2].steps === 12 && BODY_TIERS[3].form === 'scattered' && BODY_TIERS[3].steps === 16, 'Low Painted; Medium Scattered on bodies under a quarter of the screen; High Scattered (12 steps); Ultra 16 steps');
  ok(bodyFormOf(0, 0.01, null, true) === 'painted' && bodyFormOf(1, 0.1, null, true) === 'scattered' && bodyFormOf(1, 0.3, null, true) === 'painted' && bodyFormOf(2, 0.9, null, true) === 'scattered' && bodyFormOf(3, 2, null, true) === 'scattered', "a body's form by its tier and its share of the screen");
  ok(bodyFormOf(0, 0.01, 'scattered', true) === 'scattered' && bodyFormOf(3, 0.01, 'none', true) === 'none' && bodyFormOf(2, 0.1, 'scattered', false) === 'none', "a body's own form wins over the tier; a body with no air draws none");
  ok(bodyFormOf(2, 0.1, null, true, true) === 'painted' && bodyFormOf(3, 0.1, null, true, true) === 'painted' && bodyFormOf(0, 0.1, null, true, true) === 'painted' && bodyFormOf(2, 0.1, 'scattered', true, true) === 'scattered' && bodyFormOf(2, 0.1, null, false, true) === 'none', "SWG's flat picture draws Painted where the tier would scatter; the console's form still forces Scattered");
  ok(tierRule(-1) === BODY_TIERS[2] && tierRule(9) === BODY_TIERS[2], "a custom set of settings takes High's rule");
  const fov = Math.PI / 3;
  const asp = 16 / 9;
  const full = screenShareOf(Math.atan(Math.tan(fov / 2)), fov, asp);
  ok(Math.abs(full - Math.PI / 4 / asp) < 1e-12 && screenShareOf(0.01, fov, asp) < 1e-3, `a disc filling the screen's height covers π/4 over the aspect of it (${full.toFixed(4)}); a moon a sliver`);
  // Rori's Naboo (SWG's quad of size 1 at the sky's radius: 2,333 m wide at 3,500 m) at a 60-degree field is under a quarter.
  const naboo = screenShareOf(Math.atan(0.5 * (2333 / 3500) * BODY_TUNE.discFill), fov, asp);
  ok(naboo > 0.05 && naboo < 0.25, `Naboo in Rori's sky covers ${(naboo * 100).toFixed(1)}% of a 60-degree screen: Scattered on Medium`);
  const v0 = { ...BODY_TUNE };
  const said = tuneBodies({ sphere: 2, flatAlbedo: 0.5, form: 'painted', bogus: 1, discFill: 'x' });
  ok(BODY_TUNE.sphere === 1 && BODY_TUNE.flatAlbedo === 0.5 && BODY_TUNE.form === 'painted' && said.some((w) => /sphere: held to 1/.test(w)) && said.some((w) => /bogus: no such dial/.test(w)) && said.some((w) => /discFill: not a number/.test(w)), `the dials move through their setter, held to their ranges (${said.join('; ')})`);
  ok(tuneBodies({ form: 'sideways' }).some((w) => /form: one of tier/.test(w)) && BODY_TUNE.form === 'painted', 'an unknown form is refused');
  Object.assign(BODY_TUNE, v0);
  ok(Object.entries(BODY_TUNE_RANGE).every(([k, [lo, hi]]) => (BODY_TUNE as Any)[k] >= lo && (BODY_TUNE as Any)[k] <= hi) && BODY_TUNE.form === 'tier' && BODY_TUNE.sphere === 0, "every dial starts inside its range; the form starts at the tier's and the shading at SWG's flat picture (the design's rule until wave 5)");
}

// ---------------------------------------------------------------- 2. the ground is unchanged by the bodies' setting
{
  // Everything the ground path takes its settings from: the tier's values and the air's own sizes, steps and reach.
  const airTables = text('src/sky/air/airTables.ts');
  const tableSteps = /export const TABLE_STEPS = \{[\s\S]*?\} as const;/.exec(airTables)?.[0] ?? '';
  const ground = (tier: string): string =>
    JSON.stringify({ tier: tierValues(tier as Any, 2), sizes: AIR_SIZES, reach: HAZE_REACH_M, tableSteps, twin: { TWIN_DEPTH, TWIN_PSI, TWIN_STEPS } });
  const keep = BODY_TUNE.form;
  let same = true;
  for (const t of TIER_NAMES) {
    BODY_TUNE.form = 'scattered';
    const a = ground(t);
    BODY_TUNE.form = 'painted';
    const b = ground(t);
    BODY_TUNE.form = 'none';
    const c = ground(t);
    BODY_TUNE.form = 'tier';
    const d = ground(t);
    if (a !== b || b !== c || c !== d || tableSteps === '') same = false;
  }
  BODY_TUNE.form = keep;
  ok(same, "each tier's ground settings (the tier's values, the air's tables' sizes and steps, the twin's, the haze's reach) are identical whether the bodies are Scattered, Painted or none (the owner's condition)");
  ok(!(TIER_KEYS as readonly string[]).some((k) => /bod|scatter|paint/i.test(k)), "the bodies' form is no setting of the tier table's: the ground's settings cannot carry it");
  // No file of the ground path reads anything of the bodies: only the sky that makes the cards, the runtime, the world's and the
  // console's hand-overs and the bodies' own modules name `src/sky/bodies/`.
  const files: string[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|js)$/.test(n)) files.push(p);
    }
  };
  walk(join(ROOT, 'src'));
  // The debug menu's model names the console helper `skyBodies` under its "Sky and light" heading (the sky and light fix round):
  // a helper's name in a list, no read of the bodies' setting.
  const ALLOWED = new Set(['src/world/sky.ts', 'src/world/world.ts', 'src/core/gpu/start.ts', 'src/core/gpuSwitch.ts', 'src/main.ts', 'src/ui/debugModel.ts']);
  const readers: string[] = [];
  for (const f of files) {
    const r = relative(ROOT, f).replace(/\\/g, '/');
    if (r.startsWith('src/sky/bodies/')) continue;
    const t = readFileSync(f, 'utf8');
    if (/(from|import\()\s*['"][^'"]*sky\/bodies\/|\b(BODY_TUNE|BODY_TIERS|bodyFormOf|tuneBodies)\b|\bskyBodies\b(?!\.ts)/.test(t) && !ALLOWED.has(r)) readers.push(r);
  }
  // The world's own reads are its hand-over alone: the runtime's set, made, framed and let go.
  const worldLines = text('src/world/world.ts').split('\n').filter((l) => /skyBodies|sky\/bodies/.test(l) && !/^\s*(\/\/|\*|\/\*\*)/.test(l));
  ok(worldLines.length > 0 && worldLines.every((l) => /skyBodies(: GpuSkyBodySet \| null = null;| = set;| = null;|\.dispose\(|\.frame\(this\.camera\)| && this\.camera)|this\.skyBodies\)|GPU\.rt!\.skyBodies\.make\(cards\)/.test(l)), `the world's lines that name the bodies are its hand-over alone (${worldLines.length} lines: the set made, framed and let go)`);
  ok(readers.length === 0 && files.length > 500, `no file of the ground path (or anywhere else) reads the bodies' setting: ${readers.join(', ') || `none of ${files.length}`}`);
  const air = ['airTables.ts', 'airHaze.ts', 'airSee.ts', 'airSky.ts', 'airTwin.ts', 'airRun.ts', 'airFit.ts', 'airParams.ts'].map((n) => text(`src/sky/air/${n}`)).join('\n');
  ok(!/bodies|BODY_/.test(air), "the air's own files (its tables, haze, sky, twin, run, fit and record) never name the bodies");
}

// ---------------------------------------------------------------- 3. the 3% limb test: the ground path and the body path
{
  // A world's air seen past its limb from space: the ground path (the game's own sums, `viewRadiance` over its tables, 600
  // steps) and the body path (`airProfile.js`'s march over its tables, `marchAir`, the CPU half of the one file whose
  // `airShader` the card's graph is) along the same rays, tangent heights from the ground to the top every 0.25 km, the sun
  // from the side, behind, ahead and above; the limb as a pixel of it shows it is that light over its profile.
  // What this holds, plainly (the fixer of pass 2, wave 4a): the brief's 3% is met at Ultra's 16 steps and summed over the
  // limb's profile; High's 12 steps (where a new player starts) and Medium's 8 are held to 4% and 8%, and a single ray at 16
  // steps to 6%. Node runs no graph, so `airShader` itself is held to `marchAir` only by being written beside it in the one
  // file; the pictures of Naboo from Rori are its check on the card.
  const worlds: [string, number, [number, number, number]][] = [
    ['naboo', 40, [1, 1, 1]],
    ['tatooine', 25, [1, 0.9, 0.7]],
    ['mustafar', 8, [1, 0.9, 0.78]],
    ['corellia', 40, [1, 1, 1]],
  ];
  const worst: Record<number, { w: number; at: string }> = { 8: { w: 0, at: '' }, 12: { w: 0, at: '' }, 16: { w: 0, at: '' } };
  let rayWorst16 = 0;
  let rayAt = '';
  let tWorst = 0;
  for (const [id, vis, tint] of worlds) {
    const rec = worldRecord(id);
    setVisibility(rec, vis);
    setHazeTint(rec, tint[0], tint[1], tint[2]);
    const depth = new Float64Array(DEPTH_FLOATS);
    buildDepthTable(rec, depth);
    const psi = new Float64Array(PSI_FLOATS);
    buildPsiTable(rec, depth, psi);
    const tabs = V.makeTables(rec);
    const bottom = rec[F.bottom];
    const top = rec[F.top];
    const L = new AirLights();
    L.count = 1;
    L.live[0] = 1;
    L.top.set([1, 1, 1]);
    const g = new Float64Array(3);
    const tr = new Float64Array(3);
    const b = new Float64Array(6);
    for (const sun of [[0, 0, 1], [0.3, 0.2, 0.93], [0.2, 0, -0.98], [0, 0.6, 0.8]]) {
      const sl = Math.hypot(sun[0], sun[1], sun[2]);
      const s = [sun[0] / sl, sun[1] / sl, sun[2] / sl];
      L.dir.set(s);
      const sumG = [0, 0, 0];
      const sums: Record<number, number[]> = { 8: [0, 0, 0], 12: [0, 0, 0], 16: [0, 0, 0] };
      for (let h = 0.125; h < top - bottom; h += 0.25) {
        const r = top - 1e-6;
        const dx = (bottom + h) / r;
        const dy = -Math.sqrt(1 - dx * dx);
        viewRadiance(rec, depth, psi, r, dx, dy, 0, L, 600, Infinity, g, 0, tr);
        for (let c = 0; c < 3; c++) sumG[c] += g[c];
        for (const steps of [8, 12, 16]) {
          V.marchAir(rec, tabs, 0, r, 0, dx, dy, 0, s[0], s[1], s[2], steps, NaN, null, b);
          for (let c = 0; c < 3; c++) sums[steps][c] += b[c];
          if (steps === 16) {
            for (let c = 0; c < 3; c++) {
              const w = Math.abs(b[c] - g[c]) / Math.max(g[c], 1e-12);
              if (w > rayWorst16) {
                rayWorst16 = w;
                rayAt = `${id}, ${h.toFixed(2)} km up`;
              }
              tWorst = Math.max(tWorst, Math.abs(b[3 + c] - tr[c]));
            }
          }
        }
      }
      for (const steps of [8, 12, 16]) {
        for (let c = 0; c < 3; c++) {
          const w = Math.abs(sums[steps][c] - sumG[c]) / sumG[c];
          if (w > worst[steps].w) worst[steps] = { w, at: `${id}, the sun (${s.map((x) => x.toFixed(2)).join(', ')})` };
        }
      }
    }
  }
  ok(worst[16].w < 0.03, `the limb's light over its profile, the body path at Ultra's 16 steps against the ground path: within 3% in every channel on four worlds (grey, warm, ash and clear hazes) and four suns (worst ${(worst[16].w * 100).toFixed(2)}%, ${worst[16].at})`);
  ok(worst[12].w < 0.04 && worst[8].w < 0.08, `and at High's 12 steps within ${(worst[12].w * 100).toFixed(2)}%, at Medium's 8 within ${(worst[8].w * 100).toFixed(2)}% (held under 4% and 8%: the 3% is Ultra's alone)`);
  ok(rayWorst16 < 0.06 && tWorst < 0.02, `ray by ray at 16 steps every channel within ${(rayWorst16 * 100).toFixed(2)}% (${rayAt}: a ray grazing a few km up through the haze, where 16 squared steps cross its layer in three; held under 6%) and the light through within ${tWorst.toFixed(4)}`);
}

// ---------------------------------------------------------------- 4. which air a body has
{
  ok(bodyOfPicture('sky/cels_naboo.png').kind === 'world' && (bodyOfPicture('sky/cels_naboo.png') as Any).world === 'naboo' && (bodyOfPicture('sky/cels_corellia.png') as Any).world === 'corellia', "SWG's pictures of a ground world show that world");
  ok(bodyOfPicture('sky/cels_endor.png').kind === 'giant' && bodyOfPicture('sky/cels_cpoint_tralus.png').kind === 'temperate', "Endor's picture is its gas giant; Tralus a temperate world of no ground of ours");
  ok(['sky/moon_single.png', 'sky/moon_yellow.png', 'sky/cels_moon_tiel.png', 'sky/cels_moon_mercury.png', 'sky/cels_ice_moon.png', 'sky/cels_mars1.png', 'sky/cels_moon_earthy01.png'].every((f) => bodyOfPicture(f).kind === 'airless'), 'every moon picture is airless (a moon costs nothing: no march)');
  ok(['sky/sun_single.png', 'sky/cels_star_destroyer.png', null, ''].every((f) => bodyOfPicture(f).kind === 'none'), 'a sun picture (Mustafar keeps one in its moon slot) or a ship is no body: it keeps its flat picture');
  ok(hasAir({ kind: 'world', world: 'naboo' }) && hasAir({ kind: 'giant' }) && !hasAir({ kind: 'airless' }), 'a world, a giant and a temperate world have air; a moon none');
  // A ground world's body is that world's own record at its own dials: its ground sky and its rim change together.
  const n0 = bodyRecord({ kind: 'world', world: 'naboo' })!;
  const own = worldRecord('naboo');
  setVisibility(own, airDialsOf('naboo').visibilityKm);
  ok(own.every((v, i) => Object.is(v, n0[i])), "Naboo in another world's sky is Naboo's own record at its dials, number for number");
  tuneAirDials({ naboo: { hazeG: 0.8, visibilityKm: 25 } });
  const n1 = bodyRecord({ kind: 'world', world: 'naboo' })!;
  ok(n1[F.mieTintG] === 0.8 && Math.abs(3.912 / (n1[F.rayG] + n1[F.mieS] + n1[F.mieA]) - 25) < 1e-9 && bodyTablesKey(n1) !== bodyTablesKey(n0), "moving Naboo's dials moves its body's record (its haze and its colour) and so its tables' key");
  tuneAirDials({ naboo: { hazeG: 1, visibilityKm: 40 } });
  const giant = bodyRecord({ kind: 'giant' })!;
  ok(giant[F.bottom] === 60000 && giant[F.ozR] === 0 && bodyRecord({ kind: 'airless' }) === null, "a giant carries its look's own record (the viewer's start, 60,000 km, no ozone); a moon none");
}

// ---------------------------------------------------------------- 5. the bake cache
{
  ok(idbStore() === null, 'with no IndexedDB (node, a refused page) the cache keeps its session memo alone');
  ok(lookHash('a') === lookHash('a') && lookHash('a') !== lookHash('b') && /^[0-9a-f]{16}$/.test(lookHash('anything')), 'a look is keyed by a stable 64-bit hash of its numbers');
  ok(BakeCache.keyOf('air', 'x').includes(`v${BAKE_TUNE.version}`) && BAKE_TUNE.budgetMs === 200, `a key carries the cache's version; the budget is the brief's 200 ms a loading screen`);
  // A store of the test's own, and a clock it moves.
  const kept = new Map<string, ArrayBuffer[]>();
  const store: BakeStore = { get: async (k) => kept.get(k) ?? null, put: async (k, p) => void kept.set(k, p) };
  let clock = 0;
  let made = 0;
  const bake = (ms: number) => (): Float32Array[] => {
    made++;
    clock += ms;
    return [new Float32Array([1, 2, 3, 4]), new Float32Array([made])];
  };
  // The first arrival: two looks of 90 ms bake within the budget; a third, past it, waits for the next screen.
  const first = new BakeCache(store, () => clock);
  first.beginScreen();
  const a = await first.take(BakeCache.keyOf('air', 'naboo'), bake(90));
  const b = await first.take(BakeCache.keyOf('air', 'corellia'), bake(90));
  ok(a.how === 'baked' && b.how === 'baked' && made === 2 && kept.size === 2, 'a first arrival bakes its looks and keeps them in the store');
  const c = await first.take(BakeCache.keyOf('air', 'tralus'), bake(90));
  ok(c.how === 'baked' && made === 3, 'a bake begun with the budget not yet spent (180 of 200 ms) is made');
  const d = await first.take(BakeCache.keyOf('air', 'endor'), bake(90));
  ok(d.how === 'fallback' && d.parts === null && made === 3 && first.stats.waiting.length === 1 && first.stats.screenMs === 270, `a look asked once the screen's ${BAKE_TUNE.budgetMs} ms are spent is not made: its fallback shows, and it waits for the next screen (${first.stats.waiting.join(', ')})`);
  const e = await first.take(BakeCache.keyOf('air', 'naboo'), bake(90));
  ok(e.how === 'memo' && made === 3, "a look asked again in the session is the session's memo");
  first.beginScreen();
  const d2 = await first.take(BakeCache.keyOf('air', 'endor'), bake(90));
  ok(d2.how === 'baked' && made === 4 && first.stats.waiting.length === 0, 'the next loading screen bakes the look that waited');
  // The second arrival (a new session, the same browser): nothing baked, every look read from the store.
  const second = new BakeCache(store, () => clock);
  second.beginScreen();
  const ra = await second.take(BakeCache.keyOf('air', 'naboo'), bake(90));
  const rb = await second.take(BakeCache.keyOf('air', 'endor'), bake(90));
  ok(ra.how === 'stored' && rb.how === 'stored' && made === 4 && ra.parts![0][3] === 4 && rb.parts![1][0] === 4, 'the second arrival bakes nothing: every look comes back from the store, number for number');
  // A store that refuses: the bake is made and kept for the session alone.
  const broken: BakeStore = { get: async () => { throw new Error('refused'); }, put: async () => { throw new Error('refused'); } };
  const third = new BakeCache(broken, () => clock);
  const rc = await third.take('x', bake(10));
  const rd = await third.take('x', bake(10));
  ok(rc.how === 'baked' && rd.how === 'memo', 'a store that refuses every call is stepped over: the look is baked and kept in the memo');
}

// ---------------------------------------------------------------- 6. the cards: their material and their frame
{
  const map = new THREE.Texture();
  const painted = bodyCardMaterial(map, 'painted');
  const scattered = bodyCardMaterial(map, 'scattered');
  ok(painted.blending === THREE.CustomBlending && painted.blendSrc === THREE.OneFactor && painted.blendDst === THREE.OneMinusSrcAlphaFactor && painted.transparent && !painted.depthWrite && painted.userData.unlit === true && painted.userData.swgBodyMap === map, "a card blends premultiplied over (its alpha nought today, so a body adds its light to the sky behind it), writes no depth, is unlit and holds its picture");
  ok((painted as Any).isShaderMaterial && painted.fragmentShader !== scattered.fragmentShader && painted.vertexShader === scattered.vertexShader, "a card is a material three's WebGPU cannot draw until its stand-in is named (nothing built before the air's tables), the two forms' text apart so three keys them apart");
  // A real set of bodies over stand-in air tables (their graphs are built only when three compiles them).
  AIR.tables = { transmittanceToSpace: () => (TSL as Any).vec3(1), skyRadiance: () => (TSL as Any).vec3(0), nodes: { sunTop: (TSL as Any).vec3(1) } } as Any;
  const { SkyBodies } = await import('../../../src/sky/bodies/skyBody.ts');
  const group = new THREE.Group();
  const card = (file: string, width: number, glow: boolean): SkyBodyCard => {
    const m = new THREE.Texture();
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bodyCardMaterial(m, 'painted'));
    disc.scale.set(width, width, 1);
    group.add(disc);
    const g = glow ? new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial()) : null;
    if (g) group.add(g);
    return { disc, glow: g, file, map: m, air: bodyOfPicture(file), slot: 'celestial' };
  };
  const naboo = card('sky/cels_naboo.png', 2333, true);
  const moon = card('sky/moon_yellow.png', 1166, false);
  const set = await SkyBodies.make([naboo, moon]);
  const twins = group.children.filter((o) => o.name === 'sky body (scattered)') as THREE.Mesh[];
  ok(twins.length === 1 && twins[0].geometry === naboo.disc.geometry && (twins[0].material as Any).fragmentShader === scattered.fragmentShader && twins[0].userData.swgBodyCard === naboo.disc.userData.swgBodyCard, "a body with air gets its Scattered card beside its Painted one, on the same geometry and record; a moon none");
  ok(typeof (naboo.disc.material as Any).userData.gpuStandIn === 'function' && typeof (twins[0].material as Any).userData.gpuStandIn === 'function' && typeof (moon.disc.material as Any).userData.gpuStandIn === 'function', 'every card is told its stand-in once the tables exist, so the sky\'s build builds both forms');
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 10000);
  const place = (c: SkyBodyCard, d: THREE.Vector3): void => {
    c.disc.position.copy(d).multiplyScalar(3500);
    c.disc.visible = true;
    turnSkyBody(d, c.disc.quaternion);
    if (c.glow) c.glow.visible = true;
  };
  // A low sun, so both a body toward it and one opposite it stand above the land.
  const sun = new THREE.Vector3(0.6, 0.1, -0.79).normalize();
  AIR.frame.sunDir.copy(sun);
  AIR.frame.overcast = 0;
  // The body straight toward the sun: lit from behind (the sun beyond it, its far side lit); straight away: full.
  place(naboo, sun);
  place(moon, sun.clone().negate());
  BODY_TUNE.form = 'tier';
  // SWG's flat picture (the dial's start) keeps its painted shading: the tier draws it Painted, so no rim of the march stands
  // past its painted dark limb (the lead's fix after the review of pass 2, wave 4a). The checks below light it as a sphere.
  BODY_TUNE.sphere = 0;
  set.frame(cam);
  ok((set.report() as Any).bodies[0].form === 'painted' && !twins[0].visible && naboo.disc.visible, "under High with SWG's flat picture (sphere 0, the start) Naboo draws Painted: the march's rim does not follow the picture's painted shading");
  place(naboo, sun);
  place(moon, sun.clone().negate());
  BODY_TUNE.sphere = 1;
  set.frame(cam);
  const sN = naboo.disc.userData.swgBodyCard.sun as THREE.Vector3;
  const sM = moon.disc.userData.swgBodyCard.sun as THREE.Vector3;
  ok(Math.abs(sN.z + 1) < 1e-12 && Math.abs(sM.z - 1) < 1e-12, `the star in a card's frame: behind a body standing toward the sun (${sN.z.toFixed(6)}), toward the eye from one opposite it (${sM.z.toFixed(6)}): SWG's moon opposite the sun is full`);
  const st = naboo.disc.userData.swgBodyCard;
  const tanD = 0.5 * (2333 / 3500) * BODY_TUNE.discFill;
  ok(Math.abs(st.card.x - 2333 / 3500) < 1e-12 && Math.abs(st.card.y - tanD) < 1e-12 && Math.abs(st.a3.w - (st.a0.x * Math.sqrt(1 + tanD * tanD)) / tanD) < 1e-6, `a card's size and its disc's angular radius read off the card, the body's distance in km its radius over that radius's sine (${(st.a3.w / 1000).toFixed(0)} thousand km for Naboo)`);
  const r = set.report() as Any;
  ok(r.bodies[0].form === 'scattered' && twins[0].visible && !naboo.disc.visible && !naboo.glow!.visible && r.bodies[1].form === 'none' && moon.disc.visible, "under High (a custom set takes it) Naboo draws Scattered (its Scattered card up, its Painted card and SWG's halo down), the airless moon its one card");
  place(naboo, sun);
  BODY_TUNE.form = 'painted';
  set.frame(cam);
  ok(!twins[0].visible && naboo.disc.visible && naboo.glow!.visible, "Painted: the Painted card and SWG's halo, the Scattered card down");
  place(naboo, sun);
  BODY_TUNE.form = 'none';
  set.frame(cam);
  ok(!twins[0].visible && naboo.disc.visible && !naboo.glow!.visible, "None: the surface alone, no halo and no march");
  BODY_TUNE.form = 'tier';
  place(naboo, new THREE.Vector3(0.3, -0.5, -0.81).normalize());
  set.frame(cam);
  ok(!twins[0].visible && !naboo.disc.visible, 'a body under the land is drawn by neither card');
  // SWG's fade by the hour: left to the light by default (a body shows by day as its light against the blue makes it), kept
  // where the dial asks (the sky's own `place` hides it, and the card stays hidden).
  place(naboo, sun);
  naboo.disc.visible = false;
  set.frame(cam);
  ok(twins[0].visible && Math.abs(naboo.disc.userData.swgBodyCard.card.w - 1) < 1e-12, "with SWG's fade left to the light (the dial's start) a body SWG's ramp had hidden by day is up, at full presence but for storms");
  BODY_TUNE.swgFade = 1;
  place(naboo, sun);
  naboo.disc.visible = false;
  set.frame(cam);
  ok(!twins[0].visible && !naboo.disc.visible, "with SWG's fade kept, a body the sky's own place hid stays hidden");
  BODY_TUNE.swgFade = 0;
  // A body whose tables were not baked takes Painted until the next screen.
  const { bakeCache } = await import('../../../src/sky/bodies/skyBody.ts');
  const cache = bakeCache();
  cache.forgetMemo();
  cache.stats.screenMs = 0;
  const realBudget = BAKE_TUNE.budgetMs;
  BAKE_TUNE.budgetMs = 0;
  const late = card('sky/cels_corellia.png', 1166, false);
  const set2 = await SkyBodies.make([late]);
  BAKE_TUNE.budgetMs = realBudget;
  place(late, sun);
  set2.frame(cam);
  const r2 = set2.report() as Any;
  ok(r2.bodies[0].form === 'painted' && /not baked \(fallback\)/.test(r2.bodies[0].tables), `a body whose tables were put off draws Painted until the next loading screen (${r2.bodies[0].tables})`);
  BODY_TUNE.sphere = 0;
  // Let go: the twins out of the sky's group, their materials forgotten.
  const forgot: THREE.Material[] = [];
  set.dispose((m) => forgot.push(...m));
  ok(twins[0].parent === null && forgot.length === 1 && forgot[0] === twins[0].material && naboo.disc.userData.swgBodyCard === undefined, 'let go, the Scattered cards leave the sky and their materials are forgotten by the world');
  const words = skyBodiesConsole({ webgpu: true, ours: true, space: false, bodies: set2, bake: () => ({ ok: true }) }, { tune: { nightFill: 0 } });
  ok(Array.isArray((words.sky as Any).bodies) && /__debug\.skyBodies\(\{ tune: /.test(String(words.keep)) && /SWG's flat picture/.test(String(skyBodiesConsole({ webgpu: false, ours: true, space: false, bodies: null, bake: null }).said)), "the console says each body and the line that keeps the dials; on WebGL every body is SWG's flat picture");
}

// ---------------------------------------------------------------- 7. the world, the sky and the runtime hand it over (as text)
{
  const world = text('src/world/world.ts');
  ok(/await this\.loadNight\(sky, token\);[\s\S]{0,400}?await this\.loadBodies\(sky\);\s*if \(token !== this\.loadToken\) return;\s*this\.gpuSkyReady\(sky\);/.test(world), "the bodies are made ready behind the loading screen, after the air's tables and the night, before the sky is built (both forms with it)");
  ok(/this\.nightFrame\(camPos\);\s*\/\/[^\n]*\n\s*if \(this\.skyBodies && this\.camera\) this\.skyBodies\.frame\(this\.camera\);/.test(world), "their frame follows the sky's placing and the air's, on WebGPU under our sky alone");
  ok(/if \(GPU\.webgpu\) this\.dropNight\(\);\s*\/\/[^\n]*\n\s*if \(GPU\.webgpu\) this\.dropBodies\(\);/.test(world), 'they go with their sky');
  const sky = text('src/world/sky.ts');
  ok(/if \(GPU\.webgpu && skyOurs\(\) && !data\.space\) \{\s*const card = /.test(sky) && /\(disc as THREE\.Mesh\)\.material = bodyCardMaterial\(map, 'painted'\);/.test(sky) && /if \(air\.kind === 'none' \|\| !disc\) return;/.test(sky), "the sky makes its cards on WebGPU under our sky over a planet alone, every other body (a sun, a ship, WebGL's, SWG's sky's) its flat picture");
  const start = text('src/core/gpu/start.ts');
  ok(/skyBodies: \{\s*make: \(cards\) => SkyBodies\.make\(cards\),/.test(start), 'the runtime makes them (the WebGPU side alone)');
}

console.log(`\nbodySky: ${checks} checks passed`);
process.exit(0);
