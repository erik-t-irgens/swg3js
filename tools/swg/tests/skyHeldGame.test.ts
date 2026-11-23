// The ground sky's wave 4b in the game (the GPU port's pass 2, wave 4b, maker B), each run as the game runs it:
//   1. the held bodies' plan (`heldBodies.ts`): SWG's stage 1 by default, the owner's saved `held` for a world his file names,
//      every number held, the picture from the world's pack or the shared sky pack;
//   2. a ground world's distant appearances (`groundDistant.ts`): the file's small frame scaled into the game's about the
//      layout's centre, turned by the file's yaw;
//   3. the sky view's and the haze's store (`airTables.ts`' `storeInto`): 1 by day, a power of two at night, so a moonlit
//      sky's light, under a half float's normals, keeps its ten bits, and a day's keeps its very bits;
//   4. the screen's dither (`ditherTune.ts`, the numbers' model of `dither.ts`'s graph): triangular, mean nought, a level
//      either way, and a dark ramp's eight-bit rings broken into grain;
//   5. the card's coverage, the band after the scenery and the dither on the canvas, as the files hold them (text);
//   6. a held body's card turned by its roll in the bodies' own frame.
//   node tools/swg/tests/skyHeldGame.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import * as TSL from 'three/tsl';
import { HELD_STAGE, fileHeldOf, heldNameOf, heldPictureOf, heldPlanOf, swgHeldOf } from '../../../src/sky/bodies/heldBodies.ts';
import { PLUME_TUNE, groundBasis, groundDistantOf, plumeReach } from '../../../src/sky/bodies/groundDistant.ts';
import { DITHER_FIXED, DITHER_TUNE, ditherLevels, ign, tuneDither } from '../../../src/sky/night/ditherTune.ts';
import { bodyCardMaterial, type SkyBodyCard } from '../../../src/sky/bodies/bodyCard.ts';
import { AIR } from '../../../src/sky/air/airApi.ts';
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

// ---------------------------------------------------------------- 1. the held bodies' plan
{
  // A world's sky as the converter writes it: one body in three stages (synthetic names and numbers).
  const sky = [
    { picture: 'moon_stage1', stage: 1, yaw: 140, pitch: 30, size: 0.6, image: { file: 'sky/moon_stage1.png' } },
    { picture: 'moon_stage2', stage: 2, yaw: 140, pitch: 30, size: 0.6, image: { file: 'sky/moon_stage2.png' } },
    { picture: 'moon_stage3', stage: 3, yaw: 140, pitch: 30, size: 0.6, image: { file: 'sky/moon_stage3.png' } },
  ];
  ok(HELD_STAGE === 1, "SWG's sky is drawn at stage 1 where the owner names none (his answer: the half-built sphere)");
  const swg = swgHeldOf(sky);
  ok(swg.length === 1 && swg[0].picture === 'moon_stage1' && swg[0].stage === 1 && swg[0].from === 'swg' && swg[0].yawDeg === 140 && swg[0].pitchDeg === 30 && Math.abs(swg[0].size - 0.6) < 1e-9 && swg[0].rollDeg === 0 && swg[0].light === 1, "SWG's own: its stage-1 entry alone, at SWG's yaw, pitch and size, no roll, its light as converted");
  ok(heldNameOf('moon_stage1') === 'stage' && heldNameOf('moon_deathstar2') === 'deathstar' && heldNameOf('cels_ship') === 'ship', "a stage's body is named by what its stages share (the file's key: `deathstar`)");
  ok(swgHeldOf(null).length === 0 && swgHeldOf([{ picture: 'x', stage: 1, yaw: NaN, pitch: 0, size: 1 }]).length === 0 && swgHeldOf([{ picture: '../evil', stage: 1, yaw: 0, pitch: 0, size: 1 }]).length === 0, 'no list, a number that is not one, or a picture that is not a plain name: nothing hung');
  // The owner's saved file (the viewer's `held` key, the brief's shape).
  const held = { endor: { deathstar: { picture: 'moon_deathstar2', yawDeg: 520, pitchDeg: 95, size: 50, rollDeg: -200, light: 99 }, cruiser: { picture: 'cels_moncal_cruiser', yawDeg: 60, pitchDeg: 22, size: 0.25 }, bad: { picture: 'nope.png', yawDeg: 0, pitchDeg: 0, size: 1 }, worse: 'text' }, naboo: {} };
  const mine = fileHeldOf(held, 'endor')!;
  ok(mine.length === 2 && mine[0].name === 'deathstar' && mine[1].name === 'cruiser', "a world the file names holds what it lists, in order; a body whose picture or record does not read is left out");
  ok(mine[0].yawDeg === 160 && mine[0].pitchDeg === 90 && mine[0].size === 20 && mine[0].rollDeg === 160 && mine[0].light === 8 && mine[0].stage === 2 && mine[0].from === 'file', 'its numbers held: the angles brought round, the pitch to a quarter turn, the size and the light to their ranges; its stage read off the picture');
  ok(mine[1].rollDeg === 0 && mine[1].light === 1, 'a roll or a light the file leaves out is none and 1');
  ok(fileHeldOf(held, 'tatooine') === null && fileHeldOf(null, 'endor') === null && fileHeldOf([], 'endor') === null && fileHeldOf(held, 'naboo')!.length === 0, 'a world the file does not name keeps SWG (null); one it names with nothing holds nothing');
  ok(heldPlanOf('endor', sky, held).map((p) => p.picture).join() === 'moon_deathstar2,cels_moncal_cruiser' && heldPlanOf('endor', sky, null)[0].picture === 'moon_stage1' && heldPlanOf('endor', sky, { tatooine: {} })[0].picture === 'moon_stage1', "the file's list where it names the world; else SWG's stage 1");
  const shared = { cels_moncal_cruiser: { file: 'cels_moncal_cruiser.png' }, moon_stage2: { file: 'moon_stage2.png' }, evil: { file: '../x.png' } };
  ok(JSON.stringify(heldPictureOf('moon_stage2', sky, shared)) === JSON.stringify({ where: 'world', file: 'sky/moon_stage2.png' }), "a picture the world's own sky carries is read from the world's pack");
  ok(JSON.stringify(heldPictureOf('cels_moncal_cruiser', sky, shared)) === JSON.stringify({ where: 'shared', file: 'cels_moncal_cruiser.png' }) && heldPictureOf('evil', sky, shared) === null && heldPictureOf('missing', sky, shared) === null, 'else from the shared sky pack, a plain file name only; else nowhere');
}

// ---------------------------------------------------------------- 2. a ground world's distant appearances
{
  ok(PLUME_TUNE.scale === 160 && PLUME_TUNE.keepWithin === 24000 && PLUME_TUNE.on && plumeReach() === 120, 'the dials start at 160 m a unit, kept running 24 km out (a reach of 120)');
  const centre = { x: -5000, z: 6000 };
  // A cross of four round (-20, 20) in the file's frame, each turned to face out (synthetic numbers).
  const list = [
    { appearance: 'appearance/a.prt', direction: [-20, 0, 60], orientation: [0, 0, 0], infinite: false, planet: false, file: 'particles/fx_a.json' },
    { appearance: 'appearance/b.prt', direction: [20, 0, 20], orientation: [90, 0, 0], infinite: false, planet: false, file: 'particles/fx_b.json' },
    { appearance: 'appearance/c.prt', direction: [0, 0, 0], orientation: [0, 0, 0], infinite: false, planet: false, file: null },
    { appearance: 'appearance/p.apt', direction: [1, 1, 1], orientation: [0, 0, 0], infinite: true, planet: true, file: 'x' },
  ];
  const out = groundDistantOf(list, centre);
  ok(out.length === 2, 'each with a converted effect is stood; one with none, and a sky planet, are not');
  ok(out[0].at.join() === `${-5000 + 20 * 160},0,${60 * 160 - 6000}` && out[0].infinite === false && out[0].kind === 'feature', "its place is the file's times the scale, into the game's frame about the layout's centre (x the centre's less the client's, z the client's less the centre's), standing in the world");
  const b = out[1].basis;
  // The file's yaw of 90 turns the effect's forward (-Z) a quarter turn; mirrored once into the game's frame (X negated).
  ok(Math.abs(b[0] - 0) < 1e-6 && Math.abs(b[2] + 1) < 1e-6 && Math.abs(b[6] - 1) < 1e-6 && Math.abs(b[8]) < 1e-6 && Math.abs(b[4] - 1) < 1e-6, "its turn the file's yaw about the up axis, Ry Rx Rz as the converter reads a space terrain's, mirrored once (a quarter turn reads x' = -z, z' = x)");
  ok(groundBasis(0, 0, 0).join() === '1,0,0,0,1,0,0,0,1', 'no turn is no turn');
  ok(groundDistantOf(list, null).length === 0 && groundDistantOf(null, centre).length === 0 && groundDistantOf(list, centre, { ...PLUME_TUNE, on: false }).length === 0, 'no layout centre, no list, or the switch off: none');
  ok(groundDistantOf(list, centre, { ...PLUME_TUNE, scale: 100 })[0].at[0] === -5000 + 2000, 'the scale dial scales the places');
}

// ---------------------------------------------------------------- 3. the sky view's and the haze's store
{
  const airTables = text('src/sky/air/airTables.ts');
  // The store's arithmetic, read out of the file and run (the module itself imports three's WebGPU build).
  const fixed = /export const STORE_FIXED = (\{[^}]+\}) as const;/.exec(airTables)![1];
  const body = /export function storeInto\(f: \{ level: number \}, out: \{ x: number \}\): void \{([\s\S]*?)\n\}/.exec(airTables)![1];
  const storeInto = new Function('f', 'out', `const STORE_FIXED = ${fixed};${body}`) as (f: { level: number }, out: { x: number }) => void;
  const o = { x: 0.5 };
  const at = (level: number): number => {
    storeInto({ level }, o);
    return o.x;
  };
  ok(at(2.4) === 1 && at(0.05) === 1 && at(0.5) === 1, 'by day and into the dusk (the light on a level surface over 0.05) the tables are stored as they always were: times 1');
  const night = at(1e-6);
  ok(Number.isInteger(Math.log2(night)) && night > 1 && night * 1e-6 >= 0.025 && night * 1e-6 <= 0.05 && at(0) === 2 ** 20 && at(NaN) === 2 ** 20, `at night a power of two that brings the level light back to about 0.05 (${night} at 1e-6), at most 2^20`);
  // A half float's round trip, as the card stores the sky view and reads it back over the factor.
  const half = (v: number): number => THREE.DataUtils.fromHalfFloat(THREE.DataUtils.toHalfFloat(v));
  const moonlit = [1.03e-7, 1.31e-7, 1.77e-7, 2.4e-7];
  const err = (k: number): number => Math.max(...moonlit.map((v) => Math.abs(half(v * k) / k - v) / v));
  ok(err(1) > 0.1 && err(night) < 2e-3, `a moonlit sky's radiance (1e-7 in the scene's units) read back within ${(err(1) * 100).toFixed(0)}% stored bare (two bits: the stepped rings) and within ${(err(night) * 100).toFixed(2)}% stored times ${night}`);
  const day = [0.0031, 0.47, 3.2, 911];
  ok(day.every((v) => Object.is(half(v * 1) / 1, half(v)) && Object.is(half(v * 4) / 4, half(v))), 'a normal value stored times a power of two reads back to the very bits it would have read bare (so by day nothing moves)');
  ok(/vec4\(L\.mul\(gain\)\.mul\(storeK\), 1\)/.test(airTables) && /vec4\(L\.mul\(gain\)\.mul\(storeK\), Tr\.x/.test(airTables) && /\.level\(0\)\.rgb\.div\(storeK\);/.test(airTables) && /return vec4\(h\.rgb\.div\(storeK\), h\.a\);/.test(airTables) && /storeInto\(f, this\.uStore\);/.test(airTables), "the sky view and the haze volume store their light times it, every reader divides it back out (the haze's share through as it is), written each frame from the air's level light");
}

// ---------------------------------------------------------------- 4. the screen's dither
{
  ok(DITHER_TUNE.amount === 1, 'the dither starts at a level of 255 either way');
  ok(Math.abs(ign(0, 0)) < 1e-12 && ign(10, 3) >= 0 && ign(10, 3) < 1 && Math.abs(ign(1, 0) - ((52.9829189 * 0.06711056) % 1)) < 1e-9, "the noise is Jimenez's interleaved gradient, three's own sum");
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  const hist = new Array(8).fill(0);
  for (let f = 0; f < 4; f++) for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const d = ditherLevels(x, y, f, 1);
    if (d < min) min = d;
    if (d > max) max = d;
    sum += d;
    sum2 += d * d;
    n++;
    hist[Math.min(7, Math.floor((d + 1) * 4))]++;
  }
  const mean = sum / n;
  const sd = Math.sqrt(sum2 / n - mean * mean);
  ok(min >= -1 && max <= 1 && Math.abs(mean) < 0.01, `a level either way at most, its mean nought (${mean.toFixed(4)})`);
  ok(Math.abs(sd - 1 / Math.sqrt(6)) < 0.03 && hist[3] + hist[4] > 1.8 * (hist[0] + hist[7]), `triangular: its spread ${sd.toFixed(3)} (a triangle of a level either way, 0.408) and most of it near nought`);
  // A dark sky's ramp from 10 to 14 levels across 1,000 pixels: the canvas's rounding bare, and with the dither.
  const W = 1000;
  const runs = (dither: boolean): { longest: number; boxErr: number } => {
    const row: number[] = [];
    for (let x = 0; x < W; x++) {
      const v = 10 + (4 * x) / W;
      row.push(Math.round(v + (dither ? ditherLevels(x, 37, 5, 1) : 0)));
    }
    let longest = 0;
    let run = 1;
    for (let x = 1; x < W; x++) {
      run = row[x] === row[x - 1] ? run + 1 : 1;
      if (run > longest) longest = run;
    }
    let boxErr = 0;
    for (let x = 16; x < W - 16; x += 8) {
      let s = 0;
      for (let k = -16; k < 16; k++) s += row[x + k];
      boxErr = Math.max(boxErr, Math.abs(s / 32 - (10 + (4 * (x - 0.5)) / W)));
    }
    return { longest, boxErr };
  };
  const bare = runs(false);
  const dith = runs(true);
  ok(bare.longest >= 240 && dith.longest < 20, `the ramp's flat rings, ${bare.longest} pixels wide bare, are broken into grain (its longest flat run ${dith.longest})`);
  ok(dith.boxErr < 0.2 && bare.boxErr > 0.4, `and the light a few pixels round reads the ramp within ${dith.boxErr.toFixed(2)} of a level (bare: ${bare.boxErr.toFixed(2)})`);
  ok(DITHER_FIXED.frames === 64 && tuneDither(9).length === 1 && DITHER_TUNE.amount === 4 && tuneDither('x').length === 1 && tuneDither(1).length === 0 && DITHER_TUNE.amount === 1, 'the dial moves through its setter, held to 0 to 4');
  const chain = text('src/core/gpu/gpuChain.ts');
  const dither = text('src/sky/night/dither.ts');
  ok(/own\.setupOutput = function[\s\S]{0,200}ditheredOut\(\(NodeMaterial\.prototype[\s\S]{0,120}\.setupOutput\.call\(this, builder, out\), toCanvasNode\(\)\)/.test(chain), "the chain's last pass dithers after three's own output arithmetic, only onto the canvas");
  ok(/interleavedGradientNoise\(p\)/.test(dither) && /n1\.add\(n2\)\.sub\(1\)\.mul\(AMOUNT_NODE\.x\)\.div\(255\)/.test(dither) && /frameId\.mod\(DITHER_FIXED\.frames\)\)\.mul\(DITHER_FIXED\.frameStep\)/.test(dither), 'the graph is the model: two noises at their offsets, less one, times the dial, a level of 255');
}

// ---------------------------------------------------------------- 5. the card, the band and the order, as the files hold them
{
  const body = text('src/sky/bodies/skyBody.ts');
  ok(/m\.opacityNode = float\(1\);/.test(body), "the card's alpha is its graph's own (three would multiply it by the opacity the sky writes for SWG's fade)");
  ok(/const covered = mix\(cover, flat\.a, clamp\(a5\.y, 0, 1\)\)/.test(body) && /return vec4\(own\.mul\(opacity\)\.add\(skyBack\.mul\(alpha\)\), alpha\);/.test(body) && /const skyBack = \(tables \? vec3\(tables\.skyRadiance\(dW\)\) : vec3\(0\)\)/.test(body), "a body covers what is behind it (its disc, or a held body's picture), the sky's own light along the ray put back over what it covers");
  const card = bodyCardMaterial(new THREE.Texture(), 'painted');
  ok(card.blending === THREE.CustomBlending && card.blendSrc === THREE.OneFactor && card.blendDst === THREE.OneMinusSrcAlphaFactor && card.transparent && !card.depthWrite, "its blend is premultiplied over (one and one less its alpha), in the see-through list, writing no depth");
  const night = text('src/sky/night/nightGpu.ts');
  ok(/export const BAND_ORDER = 900;/.test(night) && /this\.band\.renderOrder = BAND_ORDER;/.test(night) && /m\.depthTest = true;\s*m\.vertexNode = bandClip\(reversed\);/.test(night) && /return vec4\(clip\.xy, reversed \? float\(0\) : clip\.w, clip\.w\);/.test(night), 'the band is drawn after the opaque world, tested against its depth, its vertices on the far plane (nought under reversed depth)');
  ok(/this\.stars\.renderOrder = -7;/.test(night) && card.transparent, "the stars before every solid as before, and the bodies (see-through, drawn after every opaque thing) after the band, so a body covers both");
}

// ---------------------------------------------------------------- 6. a held body's card turned by its roll, in the bodies' own frame
{
  AIR.tables = { transmittanceToSpace: () => (TSL as Any).vec3(1), skyRadiance: () => (TSL as Any).vec3(0), nodes: { sunTop: (TSL as Any).vec3(1) } } as Any;
  const { SkyBodies } = await import('../../../src/sky/bodies/skyBody.ts');
  const dir = new THREE.Vector3(0.55, 0.5, 0.66).normalize();
  const roll = 0.4;
  const quaternion = turnSkyBody(dir, new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
  const map = new THREE.Texture();
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bodyCardMaterial(map, 'painted'));
  disc.scale.set(1400, 1400, 1);
  disc.position.copy(dir).multiplyScalar(3500);
  const c: SkyBodyCard = { disc, glow: null, file: 'moon_station1', map, air: { kind: 'airless' }, slot: 'celestial', held: { name: 'station', picture: 'moon_station1', light: 1.5, rollRad: roll, dir, quaternion } };
  const set = await SkyBodies.make([c]);
  AIR.frame.sunDir.set(0, 1, 0);
  set.frame(new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 10000));
  const st = disc.userData.swgBodyCard as Any;
  const qx = new THREE.Vector3(1, 0, 0).applyQuaternion(disc.quaternion);
  const qy = new THREE.Vector3(0, 1, 0).applyQuaternion(disc.quaternion);
  ok(disc.visible && disc.quaternion.angleTo(quaternion) < 1e-9, 'a held body hangs at its own turn, its roll in it');
  ok(qx.distanceTo(st.right) < 1e-6 && qy.distanceTo(st.up) < 1e-6 && Math.abs(st.dir.dot(dir) - 1) < 1e-9, "its card's frame turns with it (the quad's +X its right, +Y its up), so its picture is read where it is drawn");
  ok(st.a5.y === 1 && st.a5.z === 1.5, 'it covers by its picture\'s own outline and shines by its light dial');
  const r = set.report() as Any;
  ok(r.bodies[0].held.name === 'station' && r.bodies[0].held.rollDeg === Number(((roll * 180) / Math.PI).toFixed(2)), 'the console says it');
}

console.log(`\nskyHeldGame: ${checks} checks passed`);
