// Particle effect (.prt) reader: a synthetic effect in the newest layout and in the oldest one.
import assert from 'node:assert/strict';
import { form, chunk, W, encode, type Node } from './iffWriter.ts';
import { parseIff } from '../iff.mjs';
import { parseParticleEffect, parseWaveForm, effectRadius, blendFor, exportParticle, waveMax } from '../particle.mjs';

const wave = (points: number[][], v = 2, sample = 0) => {
  const w = new W().i32(0);
  if (v >= 1) w.i32(sample);
  if (v >= 2) w.f32(-1000).f32(1000);
  w.i32(points.length);
  for (const [p, val, a, b] of points) w.f32(p).f32(val).f32(a).f32(b);
  return form('WVFM', chunk(`000${v}`, w.bytes()));
};
const flat = (v: number) => wave([[0, v, 0, 0], [1, v, 0, 0]]);
const ramp = (points: number[][]) => {
  const w = new W().u32(0).u32(0).u32(points.length);
  for (const [p, r, g, b] of points) w.f32(p).f32(r).f32(g).f32(b);
  return form('CLRR', chunk('0001', w.bytes()));
};
const timing = (start = 0, loopDelay = 0, loops = -1) => form('PTIM', chunk('0001', new W().f32(start).f32(start).f32(loopDelay).f32(loopDelay).i32(loops).i32(loops).bytes()));
const texture = (shader: string, frames = 1, perColumn = 1, fps = -1) => form('PTEX', chunk('0000', new W().str(shader).i32(frames).i32(0).i32(frames - 1).f32(1 / perColumn).i32(perColumn).f32(fps).u8(1).bytes()));
const common = (name: string) => form('PTCL', form('0003', chunk('0000', new W().str(name).u8(1).i32(0).bytes()), ramp([[0, 1, 0.5, 0.1], [1, 0.2, 0.2, 0.2]]), wave([[0, 0, 0, 0], [0.2, 1, 0, 0], [1, 0, 0, 0]]), flat(1), flat(0), flat(0), flat(0)));
const quad = (name: string, shader: string) => form('PTQD', common(name), form('0001', wave([[0, 0, 0, 0], [1, 0.5, -0.1, 0.1]]), wave([[0, 0.2, 0, 0], [1, 0.8, 0, 0.2]]), flat(0.3), texture(shader, 4, 2, 8), chunk('0000', new W().u8(1).bytes())));

function emitterV14(name: string, desc: Node, extra: (w: W) => void = () => {}): Node {
  const w = new W().str(name).i32(1).i32(0).i32(1).u8(0).f32(3).f32(5).f32(40).u8(0).i32(1).i32(1).u8(1).i32(0).u8(1).i32(1).i32(0).str('').u8(0);
  w.u8(1).u8(0).f32(0.1).f32(0.6).f32(0.7).f32(0.2).f32(0.3).f32(0.5).f32(-1).f32(-1);
  w.i32(0).f32(0).f32(0).f32(0).f32(0).f32(0).f32(0).i32(0).i32(0).f32(0).f32(0).f32(0.25).u8(0).u8(0).f32(0).f32(0).f32(0).u8(1).u8(0);
  extra(w);
  return form('EMTR', form('0014', timing(0.5, 0, -1),
    flat(0), flat(1.5), flat(0), flat(0), wave([[0, 0, 0, 0], [1, 1, 0, 0]]), flat(0),
    flat(0), flat(0.4), flat(15), flat(2), wave([[0, 12, -2, 2], [1, 12, -2, 2]]), flat(0), flat(1), flat(0), flat(2.5), flat(-0.2),
    chunk('0000', w.bytes()), desc));
}

function effect(...emitters: Node[]): Buffer {
  const group = form('EMGP', form('0001', timing(), chunk('0000', new W().i32(emitters.length).bytes()), ...emitters));
  return Buffer.from(encode(form('PEFT', form('0002', timing(), chunk('0000', new W().i32(1).f32(1).f32(0).f32(1).f32(1.5).bytes()), group))));
}

// --- newest layout ---------------------------------------------------------------------------
{
  const buf = effect(emitterV14('smoke', quad('puff', 'particle_smoke.sht')));
  const fx = parseParticleEffect(parseIff(buf));
  assert.equal(fx.version, 2);
  assert.equal(fx.scale, 1.5);
  assert.equal(fx.groups.length, 1);
  const e = fx.groups[0].emitters[0];
  assert.equal(e.version, 14);
  assert.equal(e.name, 'smoke');
  assert.equal(e.direction, 'directional');
  assert.equal(e.generation, 'rate');
  assert.equal(e.shape, 'sphere');
  assert.deepEqual(e.emitterLife, [3, 5]);
  assert.equal(e.maxParticles, 40);
  assert.equal(e.randomInitialRotation, true);
  assert.equal(e.orientation, 'camera');
  assert.equal(e.localSpace, false);
  assert.equal(e.groundCollision, true);
  assert.equal(e.killOnCollision, false);
  assert.equal(e.collisionHeight, 0.1);
  assert.deepEqual(e.forwardKeep, [0.6, 0.7]);
  assert.deepEqual(e.upKeep, [0.2, 0.3]);
  assert.equal(e.windResistance, 0.5);
  assert.deepEqual(e.lod, [-1, -1]);
  assert.equal(e.timeOfDayColor, 0.25);
  assert.equal(e.firstImmediately, true);
  assert.deepEqual(e.timing, { startDelay: [0.5, 0.5], loopDelay: [0, 0], loopCount: [-1, -1] });
  assert.equal(e.translationY.points[0][1], 1.5);
  assert.deepEqual(e.speed.points[0], [0, 12, -2, 2]);
  assert.equal(e.lifeTime.points[1][1], 2.5);
  assert.equal(e.weight.points[0][1], -0.2);
  assert.equal(e.particle.type, 'quad');
  assert.equal(e.particle.name, 'puff');
  assert.equal(e.particle.randomRotationDirection, true);
  assert.deepEqual(e.particle.color.points[0], [0, 1, 0.5, 0.1]);
  assert.equal(e.particle.alpha.points[1][1], 1);
  assert.equal(e.particle.relativeRotation?.length, 3);
  assert.equal(e.particle.quad.linked, true);
  assert.deepEqual(e.particle.quad.rotation.points[1], [1, 0.5, -0.1, 0.1]);
  assert.equal(e.particle.quad.texture.shader, 'particle_smoke.sht');
  assert.equal(e.particle.quad.texture.frameCount, 4);
  assert.equal(e.particle.quad.texture.framesPerColumn, 2);
  assert.equal(e.particle.quad.texture.framesPerSecond, 8);
  assert.equal(waveMax(e.speed), 14);
  // reach: translation 1.5 + shape 0.4 + distance 0 + speed 14 * life 2.5 + half length 1 (negative weight is lift), times the effect scale
  assert.ok(Math.abs(effectRadius(fx) - (1.5 + 0.4 + 14 * 2.5 + 1) * 1.5) < 1e-6, `radius ${effectRadius(fx)}`);

  // export: writes the description and the texture, tags the blend mode from the effect pass
  const written = new Map<string, Uint8Array | string>();
  const vfs = { has: (p: string) => p === 'appearance/pt_smoke.prt', read: () => buf };
  const entry = exportParticle(vfs, 'appearance/pt_smoke.prt', '/out', {
    textureFor: (sh: string) => (sh === 'shader/particle_smoke.sht' ? { path: 'texture/particle_smoke.dds', png: new Uint8Array([1, 2, 3]) } : null),
    passFor: () => ({ alphaBlend: true, blendSrc: 4, blendDst: 1 }),
    write: (f: string, b: Uint8Array | string) => written.set(f, b),
  });
  assert.equal(entry.id, 'fx_pt_smoke');
  assert.equal(entry.file, 'particles/fx_pt_smoke.json');
  assert.equal(entry.quads, 1);
  assert.equal(entry.particle, true);
  assert.deepEqual(entry.missingTextures, []);
  assert.ok(written.has('/out/particles/particle_smoke.png'));
  const json = JSON.parse(written.get('/out/particles/fx_pt_smoke.json') as string);
  assert.equal(json.groups[0].emitters[0].particle.quad.texture.file, 'particles/particle_smoke.png');
  assert.equal(json.groups[0].emitters[0].particle.quad.texture.blend, 'add');
}

// --- blend classification -------------------------------------------------------------------
assert.equal(blendFor({ alphaBlend: true, blendSrc: 4, blendDst: 5 }), 'alpha');
assert.equal(blendFor({ alphaBlend: true, blendSrc: 4, blendDst: 1 }), 'add');
assert.equal(blendFor({ alphaBlend: true, blendSrc: 0, blendDst: 2 }), 'modulate');
assert.equal(blendFor({ alphaBlend: false }), 'opaque');
assert.equal(blendFor(null), 'opaque');

// --- waveform versions -----------------------------------------------------------------------
{
  // version 1 wrote randomMax before randomMin
  const v1 = parseWaveForm(parseIff(Buffer.from(encode(wave([[0, 1, 0.5, 0.25]], 1, 1)))));
  assert.equal(v1.sample, 1);
  assert.deepEqual(v1.points[0], [0, 1, 0.25, 0.5]);
  const v2 = parseWaveForm(parseIff(Buffer.from(encode(wave([[0, 1, 0.25, 0.5]], 2)))));
  assert.deepEqual(v2.points[0], [0, 1, 0.25, 0.5]);
  assert.equal(v2.min, -1000);
}

// --- oldest layouts: emitter version 0 with a quad that keeps its shader in its own form -------
{
  const oldQuad = form('PTQD', form('0000', chunk('0000', new W().str('old').str('particle_fire.sht').u8(0).bytes()), flat(0), flat(0.5), flat(0.5), ramp([[0, 1, 1, 1]]), flat(1), flat(1)));
  const w = new W().u32(0).u32(0).u8(0).f32(2).f32(10).u8(0).u8(0).u8(1).u8(0).u8(1).u32(1);
  const em = form('EMTR', form('0000', flat(0), flat(0), flat(0), flat(0), flat(0), flat(0), flat(0), flat(0), flat(0), flat(5), flat(1), flat(0), flat(1), flat(0), flat(1), flat(0), chunk('0000', w.bytes()), oldQuad));
  const group = form('EMGP', form('0000', chunk('0000', new W().i32(1).bytes()), em));
  const root = form('PEFT', form('0000', chunk('0000', new W().i32(1).bytes()), group));
  const fx = parseParticleEffect(parseIff(Buffer.from(encode(root))));
  const e = fx.groups[0].emitters[0];
  assert.equal(e.version, 0);
  assert.equal(e.orientation, 'velocity');
  assert.deepEqual(e.emitterLife, [2, 2]);
  assert.equal(e.maxParticles, 10);
  assert.equal(e.particle.quad.texture.shader, 'particle_fire.sht');
  assert.equal(e.particle.name, 'old');
  assert.equal(fx.scale, 1);
}

// --- mesh particles ---------------------------------------------------------------------------
{
  const mesh = form('PTMH', common('rock'), chunk('0000', new W().str('appearance/mesh/rock.msh').bytes()), flat(1), flat(0), flat(0), flat(0));
  const fx = parseParticleEffect(parseIff(effect(emitterV14('rocks', mesh))));
  const e = fx.groups[0].emitters[0];
  assert.equal(e.particle.type, 'mesh');
  assert.equal(e.particle.mesh.path, 'appearance/mesh/rock.msh');
  assert.equal(e.particle.mesh.rotation.length, 3);
}

console.log('particle: ok');
