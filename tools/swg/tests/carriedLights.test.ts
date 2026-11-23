// The lights the player carries (the sky and light fix round, maker L): the effects' pool, its held slots for lit blades, the
// eye's flag each light carries, the Carried lights and Blade light dials, the glow round the sun and the disc's size.
//   1. With the plain lights WebGL makes, the pool's flashes are the base's to the bit: the base's own `effects.ts` (6ad6060,
//      read out of git, its parameter property transpiled away) and the tree's are driven by one random run of flashes and
//      frames at 30, 60 and 144 frames a second, and every light's intensity, reach, colour and place are held equal by
//      `Object.is` after every call.
//   2. A lit blade held each frame lights at the light it asks, the same at 30, 60 and 144 frames a second, where the base's
//      flash asked every frame stacked to a share that moved with the frame rate (printed, and held to differ).
//   3. Shots and hits still light while blades are lit: a flash finds a slot beside one held blade and beside three; a blade's
//      slot is never a flash's; a slot a blade held last frame is not taken by a flash asked before the blade this frame; a
//      blade let go is dark from the frame's end; a fourth blade is refused.
//   4. The eye's flag: a carried light's flash and hold write 1, a ship's room light 0; the factor is `exposure^(-share · flag)`
//      and exactly 1 at a flag of 0 or a share of 0.
//   5. The dials: Carried lights, the top percentile and Blade light held to their ranges, in a group of the `exposure` set
//      whose keys are `exposure({ lights })`'s; the glow round the sun starts at each world's own haze's g, is held to its
//      range, leaves every fitted record as it was at the world's own g (`Object.is`) and sets every row's g where moved; the
//      twin's sky at a 5 km Tatooine haze draws a narrower bright aureole at a lower g; the Disc size dial is held to its range.
//   6. What only the game hands over, pinned as text: the torch and the pool made carried on WebGPU and as before on WebGL, the
//      blades holding on WebGPU and flashing on WebGL, the ship's room lights not carried, the nodes registered as
//      `carriedLights.ts` loads and that module reached through `start.ts`, the run handing the glow to the fit's worker.
//   7. The frame makes nothing: `carriedLightsAllocOwn.ts` (blades held, a fighter's held, shots now and then, a ship's room
//      light, the frame's end) in twelve fresh processes, three at a time. One copy of this suite at a time.
//
// Run: node tools/swg/tests/carriedLights.test.ts
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import * as THREE from 'three';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const SRC = join(ROOT, 'src');
const BASE = '6ad6060';

// The effects' one import that will not load in node (the portal renderer), served from a stub as the rope suites serve it.
const portalSrc = readFileSync(join(SRC, 'world', 'portalRender.ts'), 'utf8');
const ACTOR_LAYER = Number(/export const ACTOR_LAYER = (\d+);/.exec(portalSrc)?.[1]);
const stub = `export const ACTOR_LAYER = ${ACTOR_LAYER}; export function markActor(o) { o.traverse((x) => x.layers.enable(${ACTOR_LAYER})); }`;
const stubUrl = 'data:text/javascript,' + encodeURIComponent(stub);
const hook = `export async function resolve(s, c, next) {
  if (s.endsWith('/portalRender.ts') || s.endsWith('/portalRender')) return { url: ${JSON.stringify(stubUrl)}, shortCircuit: true };
  return next(s, c);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { Effects, HOLD_MOST } = await import('../../../src/combat/effects.ts');
const { EYE_LIGHTS, EYE_LIGHTS_RANGE, carriedFactor, eyeLightsGroup, tuneEyeLights } = await import('../../../src/sky/eyeLights.ts');

/** The base's `effects.ts` out of git, its parameter property transpiled away and its imports made absolute. */
async function baseEffects(): Promise<typeof Effects> {
  const text = execFileSync('git', ['show', `${BASE}:src/combat/effects.ts`], { cwd: ROOT, encoding: 'utf8' });
  let js = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, useDefineForClassFields: true } }).outputText;
  const three = import.meta.resolve('three');
  js = js
    .replace(/from ['"]three['"]/g, `from ${JSON.stringify(three)}`)
    .replace(/from ['"]\.\.\/world\/portalRender['"]/g, `from ${JSON.stringify(stubUrl)}`)
    .replace(/from ['"]\.\.\/core\/fx\/bladeGlowMath\.ts['"]/g, `from ${JSON.stringify(pathToFileURL(join(SRC, 'core', 'fx', 'bladeGlowMath.ts')).href)}`);
  assert.ok(!/from ['"]\.\.?\//.test(js), 'every import of the base effects is absolute');
  return ((await import('data:text/javascript,' + encodeURIComponent(js))) as { Effects: typeof Effects }).Effects;
}

let checks = 0;
const ok = (cond: unknown, what: string): void => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};

type FX = InstanceType<typeof Effects>;
const pool = (e: FX): THREE.PointLight[] => e.lightPool as THREE.PointLight[];
const same = (a: THREE.PointLight, b: THREE.PointLight): boolean =>
  Object.is(a.intensity, b.intensity) && Object.is(a.distance, b.distance) && Object.is(a.color.r, b.color.r) && Object.is(a.color.g, b.color.g) && Object.is(a.color.b, b.color.b) && Object.is(a.position.x, b.position.x) && Object.is(a.position.y, b.position.y) && Object.is(a.position.z, b.position.z);

// ---------------------------------------------------------------- 1. WebGL's flashes are the base's
{
  const Base = await baseEffects();
  let seed = 7;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return seed / 4294967296;
  };
  const a = new Base(new THREE.Scene());
  const b = new Effects(new THREE.Scene());
  const at = new THREE.Vector3();
  let calls = 0;
  let differ = 0;
  const DT = [1 / 30, 1 / 60, 1 / 144];
  for (let frame = 0; frame < 6000; frame++) {
    const n = Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) {
      at.set(rnd() * 20 - 10, rnd() * 5, rnd() * 20 - 10);
      const colour = Math.floor(rnd() * 0xffffff);
      const intensity = 0.5 + rnd() * 30;
      const reach = 2 + rnd() * 20;
      const life = [0.06, 0.08, 0.1, 0.12, 0.25, 0.35][Math.floor(rnd() * 6)];
      a.flash(at, colour, intensity, reach, life);
      b.flash(at, colour, intensity, reach, life);
      calls++;
      for (let i = 0; i < 4; i++) if (!same(pool(a)[i], pool(b)[i])) differ++;
    }
    const dt = DT[Math.floor(rnd() * 3)];
    a.update(dt);
    b.update(dt);
    for (let i = 0; i < 4; i++) if (!same(pool(a)[i], pool(b)[i])) differ++;
  }
  ok(calls > 8000 && differ === 0, `WebGL's pool is the base's to the bit: ${calls} flashes over 6,000 frames at 30, 60 and 144 frames a second, every light's intensity, reach, colour and place equal after every call (${differ} apart)`);
}

// ---------------------------------------------------------------- 2. a held blade's light at any frame rate
const hilt = { pos: new THREE.Vector3(1, 1.6, 2), intensity: 2.2, distance: 6 };
const SABER = 0x66c8ff;
{
  const Base = await baseEffects();
  const rates = [30, 60, 144];
  const held: number[][] = [];
  const stacked: number[] = [];
  for (const fps of rates) {
    const dt = 1 / fps;
    const e = new Effects(new THREE.Scene());
    const seen: number[] = [];
    for (let f = 0; f < fps * 3; f++) {
      e.hold(hilt, SABER);
      e.update(dt);
      // What the frame draws: the pool's light after the frame's end.
      let sum = 0;
      for (const l of pool(e)) sum += l.intensity;
      seen.push(sum);
    }
    held.push(seen);
    const old = new Base(new THREE.Scene());
    let sum = 0;
    for (let f = 0; f < fps * 3; f++) {
      old.flash(hilt.pos, SABER, hilt.intensity, hilt.distance, 0.08);
      old.update(dt);
    }
    for (const l of pool(old)) sum += l.intensity;
    stacked.push(sum / hilt.intensity);
  }
  ok(held.every((s) => s.every((v) => Object.is(v, hilt.intensity * EYE_LIGHTS.blade))), `a held blade lights at the light it asks on every frame at 30, 60 and 144 frames a second (${hilt.intensity}, one slot)`);
  ok(stacked[2] > 2.5 * stacked[0] && Math.abs(stacked[1] - 1.9) < 0.15, `where the base's flash asked every frame stacked to ${stacked.map((s) => s.toFixed(2)).join(', ')} times it at 30, 60 and 144`);
  // The Blade light dial moves it, the same at every rate.
  tuneEyeLights({ blade: 1.9 });
  const e = new Effects(new THREE.Scene());
  e.hold(hilt, SABER);
  e.update(1 / 144);
  let lit = 0;
  for (const l of pool(e)) lit += l.intensity;
  ok(Math.abs(lit - 2.2 * 1.9) < 1e-12, `Blade light at 1.9 lights it at ${lit.toFixed(3)}`);
  tuneEyeLights({ blade: 1 });
}

// ---------------------------------------------------------------- 3. shots and hits beside lit blades
{
  const e = new Effects(new THREE.Scene());
  const shot = new THREE.Vector3(5, 1, 5);
  const lights = pool(e);
  const heldSlots = (): number => lights.filter((l) => l.intensity > 0 && l.color.getHex() === SABER).length;
  e.hold(hilt, SABER);
  e.flash(shot, 0xff8a50, 6, 4, 0.08);
  ok(lights.filter((l) => l.intensity > 0).length === 2 && heldSlots() === 1, 'a shot beside one lit blade takes a slot of its own, the blade keeps its');
  e.update(1 / 60);
  e.hold(hilt, SABER);
  e.flash(shot, 0x9fd4ff, 14, 7, 0.12);
  e.flash(shot, 0xff8a50, 10, 6, 0.1);
  e.flash(shot, 0xff8a50, 6, 4, 0.08);
  e.flash(shot, 0xff8a50, 6, 4, 0.08);
  ok(heldSlots() === 1 && lights.filter((l) => l.intensity > 0).length === 4, 'four shots in a frame beside a lit blade share the other three slots; the blade is never taken');
  e.update(1 / 60);
  // Three blades: one slot for the shots, the newest winning it.
  const b2 = { pos: new THREE.Vector3(-3, 1, 0), intensity: 2, distance: 5 };
  const b3 = { pos: new THREE.Vector3(3, 1, 0), intensity: 2, distance: 5 };
  const b4 = { pos: new THREE.Vector3(0, 1, 3), intensity: 2, distance: 5 };
  ok(e.hold(hilt, SABER) && e.hold(b2, SABER) && e.hold(b3, SABER) && !e.hold(b4, SABER) && e.heldNow === HOLD_MOST, `at most ${HOLD_MOST} blades hold a slot: a fourth is refused`);
  e.flash(shot, 0x00ff00, 6, 4, 0.08);
  e.flash(shot, 0x0000ff, 9, 4, 0.08);
  ok(heldSlots() === 3 && lights.filter((l) => l.color.getHex() === 0x0000ff && l.intensity === 9).length === 1 && lights.filter((l) => l.color.getHex() === 0x00ff00).length === 0, 'with three blades lit a shot still lights, in the fourth slot, the newest shot taking it from the older');
  e.update(1 / 60);
  // A shot asked before the blades this frame (a fighter shooting in the world's step, before the glows are held) never takes a
  // slot a blade held last frame.
  const was = lights.map((l) => l.intensity > 0 && l.color.getHex() === SABER);
  e.flash(shot, 0xff0000, 6, 4, 0.08);
  const took = lights.findIndex((l) => l.color.getHex() === 0xff0000);
  ok(took >= 0 && !was[took], "a shot asked before this frame's blades takes no slot a blade held last frame");
  e.hold(hilt, SABER);
  e.hold(b2, SABER);
  ok(lights.every((l, i) => (was[i] ? l.color.getHex() === SABER && l.intensity > 0 : i === took)) && lights[took].color.getHex() === 0xff0000 && lights[took].intensity === 6, 'and the blades held after it find their own slots again (the third, not held, still standing until the frame\'s end), the shot keeping its');
  e.update(1 / 60);
  ok(lights.filter((l) => l.color.getHex() === SABER && l.intensity > 0).length === 2, 'the third blade, not held this frame, is dark from the frame\'s end');
  e.update(1 / 60);
  ok(lights.filter((l) => l.color.getHex() === SABER && l.intensity > 0).length === 0, 'and a frame with no blade held leaves every blade slot dark');
}

// ---------------------------------------------------------------- 4. the eye's flag and factor
{
  class Flagged extends THREE.PointLight {
    carried = 1;
  }
  const e = new Effects(new THREE.Scene(), () => new Flagged(0x123456, 5, 9));
  const lights = pool(e) as Flagged[];
  ok(lights.every((l) => l instanceof Flagged && l.intensity === 0 && l.distance === 1 && l.color.getHex() === 0xffffff), "a carried pool's lights stand dark and white at reach 1, as the plain pool's do");
  const at = new THREE.Vector3(2, 1, 2);
  e.flash(at, 0xffffff, 3, 4, 0.08, false);
  const room = lights.findIndex((l) => l.intensity === 3);
  ok(room >= 0 && lights[room].carried === 0, "a ship's room light (`carried` false) writes the flag 0: the eye's dial leaves it alone");
  e.flash(at, 0xff8a50, 6, 4, 0.08);
  const shot = lights.findIndex((l) => l.intensity === 6);
  ok(shot >= 0 && shot !== room && lights[shot].carried === 1, 'a shot writes the flag 1');
  e.update(0.1);
  e.flash(at, 0xff8a50, 6, 4, 0.08, false);
  e.hold(hilt, SABER);
  const blade = lights.findIndex((l) => l.color.getHex() === SABER);
  ok(blade >= 0 && lights[blade].carried === 1, 'a held blade writes the flag 1, whatever its slot held before');
  const plain = new Effects(new THREE.Scene());
  plain.flash(at, 0xffffff, 3, 4, 0.08, false);
  ok(pool(plain).every((l) => !('carried' in l)), "WebGL's plain lights are never written a flag");
  // The factor the light node works on the card, `exposure^(-share · flag)`.
  const E = 2 ** 15.4;
  ok(Math.abs(carriedFactor(E, 1) * E - 1) < 1e-9, 'at Carried lights 1 a carried light under a night eye (+15.4 stops) reaches the screen as at an exposure of 1');
  ok(carriedFactor(E, 0) === 1 && carriedFactor(0.7, 0) === 1, 'a flag of 0 is a factor of exactly 1');
  tuneEyeLights({ carried: 0 });
  ok(carriedFactor(E, 1) === 1, 'Carried lights 0 lets a carried light take the whole exposure');
  tuneEyeLights({ carried: 0.5 });
  ok(Math.abs(Math.log2(carriedFactor(E, 1)) + 7.7) < 1e-9, 'and 0.5 takes back half the stops');
  tuneEyeLights({ carried: 1 });
  const node = readFileSync(join(SRC, 'core', 'gpu', 'carriedLights.ts'), 'utf8');
  ok(node.includes('exp2(log2(max(eyeExposureNode(), 1e-30)).mul(SHARE).mul(flag).negate())'), "the card's factor is the same sum (`exp2(-log2(exposure) · share · flag)`)");
}

// ---------------------------------------------------------------- 5. the dials
{
  const words = tuneEyeLights({ carried: 2, top: 0.2, blade: -1, nope: 1 });
  ok(EYE_LIGHTS.carried === EYE_LIGHTS_RANGE.carried[1] && EYE_LIGHTS.top === EYE_LIGHTS_RANGE.top[0] && EYE_LIGHTS.blade === EYE_LIGHTS_RANGE.blade[0] && words.length === 4, `the dials are held to their ranges, and a dial nobody has is said: ${words.join('; ')}`);
  tuneEyeLights({ carried: 1, top: 0.96, blade: 1 });
  const g = eyeLightsGroup();
  ok(g.dials.map((d) => d.key).join() === 'lights.carried,lights.top,lights.blade', "the group's keys are `exposure({ lights: { carried, top, blade } })`'s");
  ok(EYE_LIGHTS.carried === 1 && EYE_LIGHTS.top === 0.96 && EYE_LIGHTS.blade === 1, 'and they start at 1, 0.96 and 1');
  const main = readFileSync(join(SRC, 'main.ts'), 'utf8');
  ok(main.includes("if (o && typeof o === 'object' && 'lights' in o) said.push(...tuneEyeLights(o.lights));"), "the exposure helper hands `lights` to the dials' own setter");

  const P = await import('../../../src/sky/air/airParams.ts');
  for (const id of ['tatooine', 'naboo', 'mustafar', 'dathomir', 'somewhere']) ok(P.airDialsOf(id).glow === P.airWorldOf(id).mieG, `${id}'s glow round the sun starts at its own haze's g (${P.airWorldOf(id).mieG})`);
  const held = P.tuneAirDials({ tatooine: { glow: 1.5 } });
  ok(P.airDialsOf('tatooine').glow === P.AIR_DIAL_RANGE.glow[1] && held.length === 1, `the glow is held to its range (${held.join('')})`);
  P.tuneAirDials({ tatooine: { glow: P.airWorldOf('tatooine').mieG } });
  const r = P.worldRecord('tatooine');
  const before = Float64Array.from(r);
  P.applyHazeDials('tatooine', r);
  ok(r.every((v, i) => Object.is(v, before[i])), "a world's record with its dials at the start is its record to the bit");

  const { fitWorld } = await import('../../../src/sky/air/airFit.ts');
  // A ramp of eight rows, a blue noon and a red dusk, as airHazeTint's rows are made: the fit has a hue and an ozone to find.
  const ramp = (): string => {
    const b = new Uint8Array(256 * 8 * 4);
    for (let row = 0; row < 8; row++) for (let i = 0; i < 256; i++) {
      const o = (row * 256 + i) * 4;
      const c = i < 128 ? [120, 160, 230] : [80, 60, 120];
      b[o] = c[0];
      b[o + 1] = c[1];
      b[o + 2] = c[2];
      b[o + 3] = 164;
    }
    return Buffer.from(b).toString('base64');
  };
  const blocks = [
    { name: 'global', weatherIndex: 0, ramp: { rows: 8, rgba: ramp() }, fog: { enabled: true, min: 0.0004, max: 0.0008 } },
    { name: 'global', weatherIndex: 1, ramp: { rows: 8, rgba: ramp() }, fog: { enabled: true, min: 0.002, max: 0.004 } },
  ];
  const sky = { planet: 'tatooine', sunElevationDegrees: 67.5, blocks } as never;
  const own = fitWorld(sky, 40);
  const ownAgain = fitWorld(sky, 40, null, undefined, undefined, undefined, P.airWorldOf('tatooine').mieG);
  ok(own.rows.length === 2 && own.rows.every((a, i) => a.record.every((v, k) => Object.is(v, ownAgain.rows[i].record[k])) && a.psi.every((v, k) => Object.is(v, ownAgain.rows[i].psi[k]))), "the fit handed the world's own g answers to the bit as the fit with none (records and multiple scattering)");
  const low = fitWorld(sky, 40, null, undefined, undefined, undefined, 0.5);
  ok(low.rows.every((a) => a.record[P.F.mieG] === 0.5) && low.rows.every((a, i) => a.record.every((v, k) => k === P.F.mieG || Object.is(v, own.rows[i].record[k]))), "a moved glow sets every row's g and nothing else of its record (the hue and ozone fitted at the world's own)");

  // The twin's sky round the sun at a 5 km Tatooine haze: where it falls to four times the sky a quarter turn away, by g.
  const T = await import('../../../src/sky/air/airTwin.ts');
  const aureole = (gv: number): { half: number; peak: number } => {
    const rec = P.worldRecord('tatooine');
    P.setVisibility(rec, 5);
    P.setHazeGlow(rec, gv);
    const depth = new Float64Array(T.DEPTH_FLOATS);
    T.buildDepthTable(rec, depth);
    const psi = new Float64Array(T.PSI_FLOATS);
    T.buildPsiTable(rec, depth, psi);
    const lights = new T.AirLights();
    const el = (30 * Math.PI) / 180;
    lights.count = 1;
    lights.dir.set([Math.cos(el), Math.sin(el), 0]);
    lights.top.set([1, 1, 1]);
    lights.live[0] = 1;
    const out = new Float64Array(3);
    const at = (deg: number): number => {
      const a = el + (deg * Math.PI) / 180;
      T.viewRadiance(rec, depth, psi, rec[P.F.bottom] + 0.002, Math.cos(a), Math.sin(a), 0, lights, 64, 1e9, out, 0, null);
      return 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
    };
    const far = at(60);
    let half = 0;
    for (const d of [0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32]) if (at(d) > 4 * far) half = d;
    return { half, peak: at(0.5) / far };
  };
  const a7 = aureole(0.7);
  const a5 = aureole(0.5);
  console.log(`     the 5 km haze's aureole: at g 0.7 over four times the far sky out to ${a7.half}° (its peak ${a7.peak.toFixed(1)} times it), at g 0.5 out to ${a5.half}° (peak ${a5.peak.toFixed(1)})`);
  ok(a5.peak < a7.peak / 2, 'a lower glow draws the aureole at a 5 km haze dimmer by the disc, by more than half');

  const S = await import('../../../src/sky/skyDials.ts');
  const said = S.tuneSky({ disc: { size: 50 } });
  ok(S.DISC_TUNE.size === S.SKY_TUNE_RANGE.disc.size[1] && said.length === 1, `Disc size is held to its range (${said.join('')})`);
  S.tuneSky({ disc: { size: 1 } });
  ok(S.DISC_TUNE.size === 1, 'and starts at 1, the star table\'s real size');
  const sky2 = readFileSync(join(SRC, 'sky', 'air', 'airSky.ts'), 'utf8');
  ok(sky2.includes('max(n.sunRadius.mul(size), capLeast)') && sky2.includes('max(n.sunRadius.mul(ratio).mul(size), capLeast)'), "the dome's discs take it, the caster and its companion, their light as a whole kept (`disc` spreads it over its area)");
}

// ---------------------------------------------------------------- 6. what only the game hands over
{
  const main = readFileSync(join(SRC, 'main.ts'), 'utf8').split(/\r?\n/).map((l) => l.trim());
  const pair = (gpu: string, gl: string, what: string): void => {
    const i = main.indexOf(gpu);
    ok(i >= 0 && main.indexOf(gpu, i + 1) < 0 && main[i + 1] === gl, what);
  };
  pair('if (GPU.webgpu) this.torch = GPU.rt!.carried.spot(0xfff1d6, 0, TORCH_TUNE.distance, TORCH_TUNE.angle, TORCH_TUNE.penumbra, TORCH_TUNE.decay);', 'else this.torch = new THREE.SpotLight(0xfff1d6, 0, TORCH_TUNE.distance, TORCH_TUNE.angle, TORCH_TUNE.penumbra, TORCH_TUNE.decay);', 'the torch is a carried spot on WebGPU, the old spot on WebGL');
  pair('if (GPU.webgpu) this.effects = new Effects(this.scene, () => GPU.rt!.carried.point());', 'else this.effects = new Effects(this.scene);', "the pool's lights are carried on WebGPU, plain on WebGL");
  pair('if (GPU.webgpu) this.holdBladeLights();', 'else if (!this.bladeGlowOwnsLight()) for (const spot of player.lightSpots()) this.effects.flash(spot.pos, player.saberColor, spot.intensity, spot.distance, 0.08);', "the player's blades hold their slots on WebGPU and flash as before on WebGL");
  ok(main.includes('else for (let i = all - 1; i >= 0; i--) this.effects.flash(npcGlow[i].pos, npcGlow[i].color, 2, 5, 0.08);') && main.includes('this.effects.hold(fighterSpot, npcGlow[i].color);'), "the fighters' glows hold on WebGPU, flash as before on WebGL");
  ok(main.some((l) => l.endsWith('this.effects.flash(l.pos, l.color, l.intensity, l.distance, 0.08, false);') && l.includes('player.aboard.roomLights(')), "a ship's room lights are flashed uncarried (they light the room the eye adapts to)");
  const start = readFileSync(join(SRC, 'core', 'gpu', 'start.ts'), 'utf8');
  ok(start.includes("import { CARRIED_LIGHTS } from './carriedLights.ts';") && start.includes('carried: CARRIED_LIGHTS,'), 'the runtime hands the game the makers, reached through start.ts');
  const node = readFileSync(join(SRC, 'core', 'gpu', 'carriedLights.ts'), 'utf8');
  ok(node.includes('(CarriedPointLight as Any).registerNode(CarriedPointLightNode);') && node.includes('(CarriedSpotLight as Any).registerNode(CarriedSpotLightNode);'), "each carried light's node is registered as its module loads, before any material is built");
  const run = readFileSync(join(SRC, 'sky', 'air', 'airRun.ts'), 'utf8');
  ok(run.includes('glow: this.glowSet };') && run.includes('setHazeGlow(this.base, dials.glow);') && run.includes('|| dials.glow !== this.glowSet;'), "the run sets the world's glow at its start, hands it to the fit's worker and asks again when it moves");
}

// ---------------------------------------------------------------- 7. the frame makes nothing
{
  interface Answer {
    frames: number;
    made: number;
    scavenges: number;
    held: number;
  }
  const file = fileURLToPath(new URL('./carriedLightsAllocOwn.ts', import.meta.url));
  const runOne = (): Promise<Answer> =>
    new Promise((res, rej) => {
      const child = spawn(process.execPath, ['--expose-gc', '--allow-natives-syntax', file], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (code) => {
        const line = out.trim().split('\n').pop() ?? '';
        if (code !== 0) {
          rej(new Error(`the allocation child exited ${code}: ${err.trim().split('\n').find((l) => /Error/.test(l)) ?? line}`));
          return;
        }
        try {
          res(JSON.parse(line));
        } catch {
          rej(new Error(`the allocation child printed nothing that reads: ${line || '(nothing)'}`));
        }
      });
    });
  const PROCESSES = 12;
  const AT_ONCE = Math.max(1, Math.min(6, Number(process.env.SWG_ALLOC_AT_ONCE) || 3));
  const all: Answer[] = [];
  while (all.length < PROCESSES) all.push(...(await Promise.all(Array.from({ length: Math.min(AT_ONCE, PROCESSES - all.length) }, () => runOne()))));
  ok(all.every((a) => a.held === 2), 'each child held two blades a frame');
  for (let i = 0; i < all.length; i++) {
    const a = all[i];
    const per = Math.max(0, a.made) / a.frames;
    ok(a.scavenges === 0 && per < 0.05, `process ${i + 1} of 12: the pool's frame makes ${Math.max(0, a.made)} bytes over ${a.frames} frames (${per.toFixed(3)} a frame)${a.scavenges ? `, ${a.scavenges} collections in the cleanest window` : ''}`);
  }
}

console.log(`\ncarriedLights: ${checks} checks passed`);
