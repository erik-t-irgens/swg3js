// The clouds' bugs, the night, the map in parts and the ships' ceiling (the GPU port's pass 3, wave 2, maker B):
//   1. what hangs at infinity (stars, the band, belts, sky bodies' cards, SWG's halos) draws into the colour behind the clouds,
//      by an own field three's key reads (`SKY_BEHIND`), never into the see-through layer the composite lays over the cloud;
//   3. the night: the ambient's height ratio says one where no light's way carries multiple scattering (every body down), the
//      base's ratio to the bit elsewhere; the floor and the drama reach the march;
//   4. the map kept wrapped in each layer's frame and refreshed in parts: a texel kept across a snap still reads its place (no
//      jump), the parts' rows cover each ring in their turns, and the card's arithmetic is the twin's line for line;
//   5. the ships' ceiling follows the low deck's fair-weather top, never under its least; speeders keep theirs.
//
// Run: node tools/swg/tests/cloudBugs.test.ts
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { SKY_BEHIND, layerKindOf, markSkyBehind, seeKindOf } from '../../../src/sky/air/airHazeMath.ts';
import { bodyCardMaterial } from '../../../src/sky/bodies/bodyCard.ts';
import { makeSkyBody } from '../../../src/world/skyBodies.ts';
import { CLOUD_LAYER_MAX, CLOUD_MAP_RINGS, CLOUD_STACK_FLOATS, CLOUD_TYPE_FLOATS, cleanLayer, newStackFrame, packStack, packTypes, type CloudLayer } from '../../../src/sky/clouds/cloudLayers.ts';
import {
  CLOUD_MAP_PARTS,
  CLOUD_MAP_TUNE,
  CloudMapFrame,
  PLAN_FLOATS,
  RING_FLOATS,
  TexelOut,
  evalRing,
  evalTexel,
  faceOffsetOf,
  planRings,
  relOfStore,
  ringStoreOf,
  sampleRing,
  sampleWrapped,
  unwrapRing,
} from '../../../src/sky/clouds/cloudMap.ts';
import { LIGHT_NUM, MS_KNOWN, ambientShareOf } from '../../../src/sky/clouds/cloudLight.ts';
import { CLOUD_LOOK, CLOUD_LOOK_RANGE } from '../../../src/sky/clouds/cloudShape.ts';
import { fairDeckTopOf } from '../../../src/sky/clouds/cloudCeiling.ts';
import { cloudStartFor } from '../../../src/sky/clouds/cloudClimate.ts';
import { SHIP_CEILING, setDeckTop, tuneShipCeiling } from '../../../src/vehicles/shipCeiling.ts';

let checks = 0;
const ok = (cond: boolean, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const root = new URL('../../../', import.meta.url);
const src = (p: string): string => readFileSync(new URL(p, root), 'utf8');

// ---------------------------------------------------------------------------------------------- 1. the sky behind the clouds

{
  const add = new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: false });
  const over = new THREE.MeshBasicMaterial({ transparent: true });
  const solid = new THREE.MeshBasicMaterial();
  ok(layerKindOf(add) === 'add' && layerKindOf(over) === 'over' && layerKindOf(solid) === 'solid', 'unmarked draws go into the layer by their blend, as before');
  markSkyBehind(add);
  markSkyBehind(over);
  markSkyBehind(solid);
  ok(layerKindOf(add) === 'keep' && layerKindOf(over) === 'keep', 'a blended draw marked at infinity keeps its colour (the sky behind the clouds), nothing into the layer');
  ok(layerKindOf(solid) === 'solid', 'a solid marked at infinity is still a solid');
  ok(seeKindOf(add) === 'add', "the haze's own rule still reads the blend's kind");
  // Three's render-object key: every own key of the material but those its rule leaves out (pinned from three's own text).
  const ro = readFileSync(new URL('node_modules/three/src/renderers/common/RenderObject.js', root), 'utf8');
  const m = /if \( (\/\^\(is\[A-Z\]\|_\)\|\^\([^)]*\)\$\/)\.test\( property \) \) continue;/.exec(ro);
  ok(m !== null, "three's material key rule found in its text");
  const rule = new RegExp(m![1].slice(1, -1));
  ok(Object.keys(add).includes(SKY_BEHIND) && !rule.test(SKY_BEHIND), "the mark is an own key three's material key reads (so it keys the graph and the pipeline apart)");
  ok(rule.test('userData'), "userData is a key three's rule leaves out (which is why the mark is not there)");
  const card = bodyCardMaterial(new THREE.Texture(), 'painted');
  ok((card as unknown as Record<string, unknown>)[SKY_BEHIND] === true && layerKindOf(card) === 'keep', "a sky body's card is drawn behind the clouds");
  const glow = makeSkyBody(new THREE.Texture(), 1, true);
  ok(layerKindOf(glow.material) === 'keep', "SWG's painted halo beside a body is drawn behind the clouds");
  // The sites three never builds in node: their marks pinned as text.
  ok(/function nightMaterial[\s\S]{0,700}return markSkyBehind\(m\);/.test(src('src/sky/night/nightGpu.ts')), "the night's material (the stars and the Milky Way's band) is marked");
  ok(/function beltMaterial[\s\S]{0,700}markSkyBehind\(m\);/.test(src('src/sky/night/beltBand.ts')), "the belts' band is marked");
  ok(/function premultipliedCard[\s\S]{0,900}return markSkyBehind\(m\);/.test(src('src/sky/bodies/lookBody.ts')), "a look body's card is marked");
  ok(/const k = layerKindOf\(builder\.material\);[\s\S]{0,200}if \(!intoLayer\(k\)\) return output;/.test(src('src/sky/air/airSee.ts')), "the colour output reads the layer's kind");
  ok(/class SeeLayerNode[\s\S]{0,400}const k = layerKindOf\(builder\.material\);/.test(src('src/sky/air/airSee.ts')), "the layer's own output reads the layer's kind");
  ok(/PIPELINE_NOW\.see = layerKindOf\(m\);/.test(src('src/core/gpu/patchMotion.ts')), "the layer's blend is chosen by the layer's kind as three makes the pipeline");
}

// ---------------------------------------------------------------------------------------------- 3. the night

{
  // The base's ambient share, loaded out of git (the wave's base), against the new one wherever a light is known.
  const dir = mkdtempSync(join(tmpdir(), 'cloudbugs-'));
  try {
    const old = execFileSync('git', ['show', '6b53d54:src/sky/clouds/cloudLight.ts'], { cwd: new URL('.', root), encoding: 'utf8' }).replace("from './cloudShape.ts'", `from '${pathToFileURL(new URL('src/sky/clouds/cloudShape.ts', root).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href}'`);
    const file = join(dir, 'cloudLightBase.ts');
    writeFileSync(file, old);
    const base = (await import(pathToFileURL(file).href)) as { ambientShareOf: typeof ambientShareOf };
    let same = true;
    let n = 0;
    for (const cam of [MS_KNOWN, 2e-7, 1e-5, 3e-3, 0.02, 0.1]) {
      for (const here of [0, 1e-7, 1e-4, 0.01, 0.05, 0.4]) {
        for (const h of [0, 0.3, 1]) {
          const a = base.ambientShareOf(LIGHT_NUM, here, cam, h, 0.45);
          const b = ambientShareOf(LIGHT_NUM, here, cam, h, 0.45);
          if (Math.abs(a - b) > 1e-12 * Math.max(1, Math.abs(a))) same = false;
          n++;
        }
      }
    }
    ok(same, `the ambient's height share is the base's wherever the light's way carries multiple scattering (${n} cases)`);
    const dark = ambientShareOf(LIGHT_NUM, 0, 0, 1, 0.45);
    const darkBase = base.ambientShareOf(LIGHT_NUM, 0, 0, 1, 0.45);
    ok(darkBase === 0.25 && dark === 1, `with every body down the ratio says one, where the base held it to a quarter (${darkBase} → ${dark})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const march = src('src/sky/clouds/cloudMarch.ts');
  ok(/multiScatterAt\(P0\.w, Ldir\.y\)/.test(march) && /multiScatterAt\(hKm, Ldir\.y\)/.test(march) && !/multiScatterAt\([^)]*n\.sunDir\.y\)/.test(march), "the march reads the height ratio along the night light's way (the sun by day), never the sun's under the horizon");
  ok(/\.add\(NIGHT\.xyz\)/.test(march), "the drama's share of the night's floor joins the clouds' ambient");
  ok(/const share = CLOUD_LOOK\.nightDrama \* Math\.min\(1, Math\.max\(0, sunDown\)\) \* INV_PI;\s*nv\.x = fl\.r \* share;\s*nv\.y = fl\.g \* share;\s*nv\.z = fl\.b \* share;/.test(march), 'the floor reaches the march as a sky radiance, times the drama eased in as the sun goes down');
  ok(/const ff = f\.floor;\s*ff\.r = fh\[0\];\s*ff\.g = fh\[1\];\s*ff\.b = fh\[2\];/.test(src('src/sky/air/airRun.ts')), "the air hands the night's floor on, as the land takes it");
  ok(CLOUD_LOOK.nightDrama === 0 && CLOUD_LOOK_RANGE.nightDrama[0] === 0 && CLOUD_LOOK_RANGE.nightDrama[1] >= 1, 'the night drama starts at nought, a real night, and reaches the land\'s floor at 1 (his option)');
}

// ---------------------------------------------------------------------------------------------- 4. the map kept wrapped, in parts

const T = { ...CLOUD_MAP_TUNE, cellLife: 0 };
const types = new Float32Array(CLOUD_TYPE_FLOATS);
packTypes(types);
function stackOf(layers: CloudLayer[]): { stack: Float32Array; n: number } {
  const f = newStackFrame();
  f.groundY = 0;
  f.level = 0;
  f.hour = 0;
  f.wet = 1;
  const stack = new Float32Array(CLOUD_STACK_FLOATS);
  return { stack, n: packStack(layers, f, stack) };
}
const frame = new CloudMapFrame();

{
  let inv = true;
  for (const n of [256, 512]) for (const base of [0, 1, 17, n / 2, n - 1]) for (let i = 0; i < n; i++) if (relOfStore(ringStoreOf(i, base, n), base, n) !== i - n / 2) inv = false;
  ok(inv, 'a stored texel names its offset from the centre corner, the inverse of where the twin\'s texel is kept, at every base');
  const L = cleanLayer({ name: 'cu', types: ['cumulus', 'stratocumulus'], shares: [1, 1], cover: [0.5, 0.5, 0.5, 0.5, 0.5] }, null);
  const { stack, n } = stackOf([L]);
  const drift = new Float64Array(CLOUD_LAYER_MAX * 4);
  drift[0] = 987654.3;
  drift[1] = -123456.7;
  const N = CLOUD_MAP_RINGS.near.size;
  const texel = CLOUD_MAP_RINGS.near.span / N;
  const camA = { camX: 40.25, camZ: -70.5 };
  // Over two near texels on x and three back on z: a snap.
  const camB = { camX: camA.camX + 2 * texel + 11, camZ: camA.camZ - 3 * texel - 7 };
  const pa = new Float64Array(PLAN_FLOATS);
  const pb = new Float64Array(PLAN_FLOATS);
  const ia = new Float64Array(CLOUD_LAYER_MAX * 4);
  const ib = new Float64Array(CLOUD_LAYER_MAX * 4);
  planRings(stack, n, camA, drift, T, pa, ia);
  planRings(stack, n, camB, drift, T, pb, ib);
  ok(ib[0] - ia[0] === 2 && ib[1] - ia[1] === -3, `the snap moved the near ring's corner two texels and three back (${ib[0] - ia[0]}, ${ib[1] - ia[1]})`);
  let small = 0;
  for (let k = 0; k < 2 * RING_FLOATS; k++) small = Math.max(small, Math.abs(pa[k]));
  ok(small <= 128000, `the plan the card reads stays small with the base in it (largest ${small}, the far ring's half)`);
  // The card's ring as frame A wrote it: the twin's centred ring stored where the wrapped ring keeps each texel.
  const ringA = evalRing(stack, types, pa, frame, T, 0, 0);
  const stored = new Uint8Array(N * N * 4);
  const bxA = pa[20];
  const bzA = pa[21];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const s = (ringStoreOf(j, bzA, N) * N + ringStoreOf(i, bxA, N)) * 4;
      for (let c = 0; c < 4; c++) stored[s + c] = ringA[(j * N + i) * 4 + c];
    }
  }
  const back = unwrapRing(stored, pa, 0, 0);
  ok(back.every((v, k) => v === ringA[k]), 'the wrapped ring unwrapped is the twin\'s ring, texel for texel');
  // No jump: a place read through the face before the snap and after it, with nothing rewritten, reads alike.
  const sa = new Float64Array(4);
  const sb = new Float64Array(4);
  const tw = new Float64Array(4);
  const ringB = evalRing(stack, types, pb, frame, T, 0, 0);
  let jump = 0;
  let twin = 0;
  let oldJump = 0;
  for (let k = 0; k < 600; k++) {
    // A world place within both rings, kept off the far edges.
    const wx = camA.camX + ((k * 7919) % 50000) - 25000;
    const wz = camA.camZ + ((k * 104729) % 50000) - 25000;
    sampleWrapped(stored, pa, 0, 0, wx - camA.camX, wz - camA.camZ, sa);
    sampleWrapped(stored, pb, 0, 0, wx - camB.camX, wz - camB.camZ, sb);
    jump = Math.max(jump, Math.abs(sa[0] - sb[0]), Math.abs(sa[3] - sb[3]));
    sampleRing(ringB, pb, 0, 0, wx - camB.camX, wz - camB.camZ, tw);
    twin = Math.max(twin, Math.abs(sb[0] - tw[0]));
    // What the old addressing would have read after the snap with nothing rewritten: the centred ring A through plan B.
    sampleRing(ringA, pb, 0, 0, wx - camB.camX, wz - camB.camZ, tw);
    oldJump = Math.max(oldJump, Math.abs(sa[0] - tw[0]));
  }
  ok(jump < 1e-9, `a place reads alike across the snap with nothing rewritten (worst ${jump.toExponential(2)}): no jump`);
  ok(twin <= 2 / 255 + 1e-9, `and is the twin's at the new frame within 2/255 (worst ${(twin * 255).toFixed(2)}/255)`);
  ok(oldJump > 0.05, `where the centred ring read through the new frame would have jumped (worst ${oldJump.toFixed(3)}): why the ring is wrapped`);
  // The parts: the card's rows (every parts-th from the turn, the near ring's turn the far's remainder) cover each ring in a cycle.
  for (const ring of [0, 1] as const) {
    const NR = ring === 0 ? CLOUD_MAP_RINGS.near.size : CLOUD_MAP_RINGS.far.size;
    const P = ring === 0 ? CLOUD_MAP_PARTS.near : CLOUD_MAP_PARTS.far;
    const seen = new Uint8Array(NR);
    let twice = 0;
    for (let turn = 0; turn < CLOUD_MAP_PARTS.far; turn++) {
      for (let jp = 0; jp < NR / P; jp++) {
        const j = jp * P + (turn % P);
        if (seen[j] && ring === 1) twice++;
        seen[j] = 1;
      }
    }
    ok(seen.every((v) => v === 1) && twice === 0, `the ${ring === 0 ? 'near' : 'far'} ring's every row is written once in ${P} turns (${P === 4 ? 'a quarter' : 'an eighth'} a frame)`);
  }
  // A snap refreshed by parts: the stored ring after B's parts, the strip come into the ring included, is B's.
  const S = stored.slice();
  const t = new TexelOut();
  for (let turn = 0; turn < CLOUD_MAP_PARTS.near; turn++) {
    for (let jp = 0; jp < N / CLOUD_MAP_PARTS.near; jp++) {
      const j = jp * CLOUD_MAP_PARTS.near + turn;
      for (let i = 0; i < N; i++) {
        evalTexel(stack, types, pb, frame, T, 0, 0, relOfStore(i, pb[20], N), relOfStore(j, pb[21], N), t);
        const o = (j * N + i) * 4;
        S[o] = Math.round(t.cover * 255);
        S[o + 1] = Math.round(t.mix * 255);
        S[o + 2] = Math.round(t.wet * 255);
        S[o + 3] = Math.round(t.top * 255);
      }
    }
  }
  const unB = unwrapRing(S, pb, 0, 0);
  ok(unB.every((v, k) => v === ringB[k]), 'after a snap, the near ring refreshed in its four parts is the twin\'s at the new frame, texel for texel');
  // The card's arithmetic, pinned: its row and its stored texel's offset (relOfStore), and the face's offsets (faceOffsetOf).
  const gpu = src('src/sky/clouds/cloudMapGpu.ts');
  ok(/const j = parts > 1 \? jp\.mul\(int\(parts\)\)\.add\(int\(extra\.w\)\.mod\(int\(parts\)\)\) : jp;/.test(gpu), "the card's row is every parts-th from the turn");
  ok(/const tx = float\(i\.sub\(int\(r5\.x\)\)\.add\(int\(N \/ 2 \+ N\)\)\.mod\(int\(N\)\)\.sub\(int\(N \/ 2\)\)\);/.test(gpu) && /const tz = float\(j\.sub\(int\(r5\.y\)\)/.test(gpu), "the card's stored texel names its offset as relOfStore does");
  ok(/v\.x = plan\[on\] \+ \(plan\[on \+ 20\] - HALF_N\) \* TEXEL_N;/.test(gpu) && /v\.w = plan\[of \+ 1\] \+ \(plan\[of \+ 21\] - HALF_F\) \* TEXEL_F;/.test(gpu), "the face's offsets are faceOffsetOf's");
  ok(Math.abs(faceOffsetOf(pb, 0, 0, 0) - (pb[0] + (pb[20] - N / 2) * texel)) < 1e-9, 'faceOffsetOf is the corner past plus the stored corner less half the ring');
  ok(/t\.wrapS = THREE\.RepeatWrapping;\s*t\.wrapT = THREE\.RepeatWrapping;/.test(gpu), 'the rings are sampled repeating');
  ok(/this\.nearPartNode, this\.farPartNode\]\);/.test(gpu), "the parts' computes are compiled with the whole rings', behind the screen");
  const run = src('src/sky/clouds/cloudRun.ts');
  ok(/let full = this\.fullWant \|\| this\.timeFull \|\| this\.fullVersion !== this\.version \|\| this\.frames - this\.lastDispatchFrame > 1;/.test(run) && /if \(d > 1 \|\| d < -1\) full = true;/.test(run), 'the whole map is written where a part would leave too much behind (asked, the stack, a missed dispatch, a jump past a texel)');
}

// ---------------------------------------------------------------------------------------------- 5. the ships' ceiling

{
  const naboo = cloudStartFor('naboo', 'naboo', null).layers;
  const top = fairDeckTopOf(naboo);
  setDeckTop(top);
  ok(SHIP_CEILING.now > 3200 && SHIP_CEILING.now < 4000, `Naboo's ceiling is about 3.5 km: its low deck's fair top ${Math.round(top)} m plus 1,000 (${Math.round(SHIP_CEILING.now)} m)`);
  const raised = naboo.map((l, i) => (i === naboo.findIndex((x) => x.on && x.base === Math.min(...naboo.filter((y) => y.on).map((y) => y.base))) ? { ...l, base: l.base + 500 } : l));
  setDeckTop(fairDeckTopOf(raised));
  ok(Math.abs(SHIP_CEILING.now - (top + 500 + 1000)) < 1e-6, 'it follows the low deck as he raises it');
  setDeckTop(Number.NaN);
  ok(SHIP_CEILING.now === 1500, 'with no deck known it is the least, the old 1,500 m');
  const low = naboo.map((l) => ({ ...l, base: Math.min(l.base, 100), thickness: Math.min(l.thickness, 200) }));
  setDeckTop(fairDeckTopOf(low));
  ok(SHIP_CEILING.now === 1500, 'never under the least');
  tuneShipCeiling({ least: 2000 });
  ok(SHIP_CEILING.now === 2000, 'the least is a dial');
  tuneShipCeiling({ least: 1500, above: 1000 });
  ok(Number.isNaN(fairDeckTopOf(naboo.map((l) => ({ ...l, on: false })))), 'no layer on, no deck');
  // Storm towers grow only with the weather: the fair top is the fair type's column, not the towers'.
  const dant = cloudStartFor('dantooine', 'dantooine', null).layers;
  const lowD = dant.filter((l) => l.on).sort((a, b) => a.base - b.base)[0];
  ok(fairDeckTopOf(dant) < lowD.base + lowD.thickness || lowD.thickness <= 1500, `a deck with storm towers tops out at its fair type (${Math.round(fairDeckTopOf(dant))} m, the deck ${lowD.base} + ${lowD.thickness})`);
  const veh = src('src/vehicles/vehicle.ts');
  ok(/fly: \{ climb: big \? 6 : 10, ceiling: 1500, floor: 1\.5, deck: true \}/.test(veh), "a ship's ceiling is the dial");
  ok(/hoverCar \? \{ climb: 6, ceiling: 60, floor: 0\.5 \} : \{ climb: 14, ceiling: 260, floor: 0\.5 \}/.test(veh), "speeders keep their own ceilings");
  ok((veh.match(/s\.fly!?\.deck === true \? SHIP_CEILING\.now : s\.fly!?\.ceiling/g) ?? []).length === 2, "both the held height and the nose's ease read it as a field");
  ok(/const SPACE_GATE_HEIGHT = 1100;/.test(src('src/main.ts')), 'space is still offered above 1,100 m, under the least ceiling');
  ok(/setDeckTop\(fairDeckTopOf\(next\)\);/.test(src('src/sky/clouds/cloudRun.ts')), 'the stack he sets hands the deck in');
}

console.log(`\ncloudBugs: ${checks} checks passed`);
