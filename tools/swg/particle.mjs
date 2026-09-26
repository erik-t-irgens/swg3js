// Particle effect (.prt) reader and exporter, following the client's ParticleEffectDescription,
// ParticleEmitterGroupDescription, ParticleEmitterDescription, ParticleDescription(Quad|Mesh),
// ParticleTexture, ParticleTiming, WaveForm and ColorRamp loaders.
//
//   FORM PEFT > FORM 000N { [FORM PTIM], 0000 { int32 groups, [v2: float initialPlayBackRate,
//                          float initialPlayBackRateTime, float playBackRate, float scale] }, FORM EMGP... }
//   FORM EMGP > FORM 000N { [FORM PTIM], 0000 { int32 emitters }, FORM EMTR... }
//   FORM EMTR > FORM 00NN { [FORM PTIM], 16 x FORM WVFM (translation xyz, rotation xyz, distance,
//                          shape size, spread, generation rate, emit speed, inherit velocity %,
//                          cluster count, cluster radius, particle life, particle weight),
//                          0000 { version-dependent emitter fields }, FORM PTQD | FORM PTMH }
//   FORM PTQD > [FORM PTCL], FORM 000N { WVFM rotation, WVFM length, WVFM width, FORM PTEX, [v1: 0000 { bool8 linked }] }
//   FORM PTMH > [FORM PTCL], 0000 { cstring mesh }, WVFM scale, WVFM rotation xyz
//   FORM PTCL > FORM 000N { 0000 { cstring name, uint8 randomRotationDirection, ... }, CLRR colour,
//                          WVFM alpha, WVFM speed scale, [v3: WVFM relative rotation xyz], FORM PATT... }
//   FORM WVFM > 000N { int32 interpolation, [v1: int32 sample], [v2: float min, float max],
//                     int32 n, n x (float percent, float value, float randomA, float randomB) }
//   FORM CLRR > 000N { uint32 interpolation, [v1: uint32 sample], uint32 n, n x (float percent, r, g, b) }
//   FORM PTIM > 000N { float startDelayMin/Max, float loopDelayMin/Max, int32 loopCountMin/Max }
//   FORM PTEX > 0000 { cstring shader, int32 frameCount, frameStart, frameEnd, float frameUVSize,
//                     int32 framesPerColumn, float framesPerSecond, uint8 visible }
//
// Waveform values are evaluated over a percentage (emitter age for emitter curves, particle age
// for particle curves); the sample type says whether the random band is picked once per particle
// (initial) or every frame (continuous). Angles are turns (multiplied by 2 pi at runtime); the
// emitter's spread is in degrees. Quad length and width are half extents.
import { basename } from 'node:path';
import { childrenOf, isForm, parseIff, readCString } from './iff.mjs';

class R {
  constructor(buf) {
    this.b = buf;
    this.o = 0;
  }
  get left() {
    return this.b.length - this.o;
  }
  i32() {
    const v = this.b.readInt32LE(this.o);
    this.o += 4;
    return v;
  }
  u32() {
    const v = this.b.readUInt32LE(this.o);
    this.o += 4;
    return v;
  }
  f32() {
    const v = this.b.readFloatLE(this.o);
    this.o += 4;
    return v;
  }
  u8() {
    return this.b[this.o++];
  }
  bool() {
    return this.u8() !== 0;
  }
  str() {
    const { value, next } = readCString(this.b, this.o);
    this.o = next;
    return value.replace(/\\/g, '/');
  }
}

const version = (form) => parseInt(form.type, 10);
const forms = (node) => node.children.filter(isForm);
const chunks = (node) => node.children.filter((c) => !isForm(c));
const round = (v) => Math.round(v * 10000) / 10000;

function expectForm(node, type) {
  if (!isForm(node) || node.type !== type) throw new Error(`expected FORM ${type}, got ${isForm(node) ? `FORM ${node.type}` : node?.tag ?? 'nothing'}`);
  return node;
}

/** WaveForm: { interp: 0 linear | 1 spline, sample: 0 initial | 1 continuous, min, max, points: [[percent, value, randomMin, randomMax]] }. */
export function parseWaveForm(node) {
  expectForm(node, 'WVFM');
  const chunk = chunks(node)[0];
  if (!chunk) throw new Error('WVFM without data');
  const v = parseInt(chunk.tag, 10);
  const r = new R(chunk.data);
  const wf = { interp: r.i32(), sample: 0, min: -Infinity, max: Infinity, points: [] };
  if (v >= 1) wf.sample = r.i32();
  if (v >= 2) {
    wf.min = r.f32();
    wf.max = r.f32();
  }
  const n = r.i32();
  for (let i = 0; i < n; i++) {
    const percent = r.f32();
    const value = r.f32();
    // Versions 0 and 1 wrote randomMax before randomMin; version 2 writes min then max.
    const a = r.f32();
    const b = r.f32();
    const [randomMin, randomMax] = v >= 2 ? [a, b] : [b, a];
    wf.points.push([round(percent), round(value), round(randomMin), round(randomMax)]);
  }
  if (!Number.isFinite(wf.min)) delete wf.min;
  if (!Number.isFinite(wf.max)) delete wf.max;
  return wf;
}

/** ColorRamp: { interp, sample: 0 all | 1 single, points: [[percent, r, g, b]] }. */
export function parseColorRamp(node) {
  expectForm(node, 'CLRR');
  const chunk = chunks(node)[0];
  if (!chunk) throw new Error('CLRR without data');
  const v = parseInt(chunk.tag, 10);
  const r = new R(chunk.data);
  const ramp = { interp: r.u32(), sample: 0, points: [] };
  if (v >= 1) ramp.sample = r.u32();
  const n = r.u32();
  for (let i = 0; i < n; i++) ramp.points.push([round(r.f32()), round(r.f32()), round(r.f32()), round(r.f32())]);
  return ramp;
}

function parseTiming(node) {
  expectForm(node, 'PTIM');
  const chunk = chunks(node)[0];
  const r = new R(chunk.data);
  return { startDelay: [round(r.f32()), round(r.f32())], loopDelay: [round(r.f32()), round(r.f32())], loopCount: [r.i32(), r.i32()] };
}

function parseTexture(node) {
  expectForm(node, 'PTEX');
  const chunk = chunks(node)[0];
  const r = new R(chunk.data);
  return { shader: r.str(), frameCount: r.i32(), frameStart: r.i32(), frameEnd: r.i32(), frameUVSize: round(r.f32()), framesPerColumn: r.i32(), framesPerSecond: round(r.f32()), visible: r.bool() };
}

function parseAttachment(node) {
  expectForm(node, 'PATT');
  const v = forms(node)[0];
  const chunk = chunks(v)[0];
  const r = new R(chunk.data);
  const path = r.str();
  const startPercent = [round(r.f32()), round(r.f32())];
  let spawn = 0;
  let killWithParticle = false;
  if (version(v) === 0) {
    for (let i = 0; i < 5; i++) r.i32();
    killWithParticle = r.bool();
  } else {
    killWithParticle = r.bool();
    spawn = r.u32();
  }
  return { path, startPercent, killWithParticle, spawn: ['created', 'dies', 'percent', 'collision'][spawn] ?? 'created' };
}

/** The shared particle description (FORM PTCL): colour, alpha, speed scale, relative rotation, attachments. */
function parseParticleCommon(node) {
  expectForm(node, 'PTCL');
  const v = forms(node)[0];
  const ver = version(v);
  const kids = v.children;
  const head = new R(kids[0].data);
  const name = head.str();
  const randomRotationDirection = head.u8() !== 0;
  if (ver === 1) head.str();
  let i = 1;
  const color = parseColorRamp(kids[i++]);
  const alpha = parseWaveForm(kids[i++]);
  const speedScale = parseWaveForm(kids[i++]);
  let relativeRotation = null;
  if (ver >= 3) relativeRotation = [parseWaveForm(kids[i++]), parseWaveForm(kids[i++]), parseWaveForm(kids[i++])];
  const attachments = [];
  for (; i < kids.length; i++) if (isForm(kids[i]) && kids[i].type === 'PATT') attachments.push(parseAttachment(kids[i]));
  return { name, randomRotationDirection, color, alpha, speedScale, relativeRotation, attachments };
}

function parseQuad(node) {
  expectForm(node, 'PTQD');
  const kids = node.children;
  let i = 0;
  let common;
  if (isForm(kids[0]) && kids[0].type === 'PTCL') {
    common = parseParticleCommon(kids[0]);
    i = 1;
    const v = kids[i];
    const ver = version(v);
    const k = v.children;
    const rotation = parseWaveForm(k[0]);
    const length = parseWaveForm(k[1]);
    const width = parseWaveForm(k[2]);
    const texture = parseTexture(k[3]);
    let linked = false;
    if (ver >= 1) linked = new R(chunks(v)[0].data).u8() !== 0;
    return { type: 'quad', ...common, quad: { rotation, length, width, texture, linked } };
  }
  // The oldest layout kept everything in the quad's own version form.
  const v = kids[0];
  const ver = version(v);
  const k = v.children;
  const head = new R(k[0].data);
  const name = head.str();
  let shader = null;
  if (ver === 0) shader = head.str();
  const randomRotationDirection = head.u8() !== 0;
  const rotation = parseWaveForm(k[1]);
  const length = parseWaveForm(k[2]);
  const width = parseWaveForm(k[3]);
  const color = parseColorRamp(k[4]);
  const alpha = parseWaveForm(k[5]);
  const speedScale = parseWaveForm(k[6]);
  const texture = ver >= 1 ? parseTexture(k[7]) : { shader, frameCount: 1, frameStart: 0, frameEnd: 0, frameUVSize: 1, framesPerColumn: 1, framesPerSecond: -1, visible: true };
  return { type: 'quad', name, randomRotationDirection, color, alpha, speedScale, relativeRotation: null, attachments: [], quad: { rotation, length, width, texture, linked: false } };
}

function parseMeshParticle(node) {
  expectForm(node, 'PTMH');
  const kids = node.children;
  const common = parseParticleCommon(kids[0]);
  const path = new R(kids[1].data).str();
  return { type: 'mesh', ...common, mesh: { path, scale: parseWaveForm(kids[2]), rotation: [parseWaveForm(kids[3]), parseWaveForm(kids[4]), parseWaveForm(kids[5])] } };
}

const DIRECTIONS = ['omni', 'directional'];
const SHAPES = ['circle', 'sphere', 'rectangle', 'cube', 'line', 'x'];
const ORIENTATIONS = ['camera', 'velocity', 'velocityBank', 'cameraMesh'];

/** Emitter fields, by data version (see ParticleEmitterDescription::load_00NN). */
function parseEmitterFields(ver, data) {
  const r = new R(data);
  const e = {
    name: '',
    direction: 'omni',
    generation: 'rate',
    shape: 'circle',
    loopImmediately: false,
    emitterLife: [0, 0],
    maxParticles: 0,
    oneShot: false,
    oneShotCount: [1, 1],
    randomInitialRotation: false,
    orientation: 'camera',
    visible: true,
    particleType: 'quad',
    sound: '',
    localSpace: false,
    groundCollision: false,
    killOnCollision: false,
    collisionHeight: 0,
    forwardKeep: [1, 1],
    upKeep: [1, 1],
    windResistance: 0,
    lod: [-1, -1],
    flocking: 'none',
    timeOfDayColor: 0,
    snapToTerrain: false,
    alignToTerrain: false,
    snapHeight: 0,
    firstImmediately: false,
  };
  if (ver >= 3) e.name = r.str();
  e.direction = DIRECTIONS[ver <= 2 ? r.u32() : r.i32()] ?? 'omni';
  if (ver >= 7) e.generation = r.i32() === 1 ? 'distance' : 'rate';
  e.shape = SHAPES[ver <= 2 ? r.u32() : r.i32()] ?? 'circle';
  e.loopImmediately = r.bool();
  const lifeMin = r.f32();
  e.emitterLife = [lifeMin, ver >= 9 ? r.f32() : lifeMin];
  e.maxParticles = r.f32();
  e.oneShot = r.bool();
  if (ver >= 7) e.oneShotCount = [r.i32(), r.i32()];
  e.randomInitialRotation = r.bool();
  if (ver === 0) e.orientation = r.bool() ? 'velocity' : 'camera';
  else e.orientation = ORIENTATIONS[ver <= 2 ? r.u32() : r.i32()] ?? 'camera';
  if (ver <= 5) r.bool(); // the retired inherit-transform flag
  e.visible = r.bool();
  if (ver <= 2) r.u32();
  else r.i32(); // particle description count, always 1
  if (ver >= 4) e.particleType = r.i32() === 1 ? 'mesh' : 'quad';
  if (ver >= 5) e.sound = r.str();
  if (ver >= 6) e.localSpace = r.bool();
  if (ver >= 7) {
    e.groundCollision = r.bool();
    if (ver >= 8) e.killOnCollision = r.bool();
    if (ver <= 11) r.f32(); // unused
    e.collisionHeight = r.f32();
    e.forwardKeep = [r.f32(), r.f32()];
    e.upKeep = [r.f32(), r.f32()];
    e.windResistance = r.f32();
  }
  if (ver >= 9) e.lod = [r.f32(), r.f32()];
  if (ver >= 10 && ver <= 11) {
    e.flocking = r.bool() ? 'air' : 'none';
    for (let i = 0; i < 7; i++) r.f32();
  }
  if (ver >= 11 && ver <= 11) e.timeOfDayColor = r.f32();
  if (ver >= 12) {
    e.flocking = ['none', 'air', 'ground', 'water'][r.i32()] ?? 'none';
    for (let i = 0; i < 6; i++) r.f32();
    r.i32();
    r.i32();
    r.f32();
    r.f32();
    e.timeOfDayColor = r.f32();
    e.snapToTerrain = r.bool();
    e.alignToTerrain = r.bool();
    e.snapHeight = r.f32();
    r.f32();
    r.f32();
  }
  if (ver >= 13) e.firstImmediately = r.bool();
  for (const k of ['emitterLife', 'oneShotCount', 'forwardKeep', 'upKeep', 'lod']) e[k] = e[k].map(round);
  for (const k of ['maxParticles', 'collisionHeight', 'windResistance', 'timeOfDayColor', 'snapHeight']) e[k] = round(e[k]);
  return e;
}

const EMITTER_CURVES = ['translationX', 'translationY', 'translationZ', 'rotationX', 'rotationY', 'rotationZ', 'distance', 'shapeSize', 'spread', 'rate', 'speed', 'inheritVelocity', 'clusterCount', 'clusterRadius', 'lifeTime', 'weight'];

function parseEmitter(node) {
  expectForm(node, 'EMTR');
  const v = forms(node)[0];
  const ver = version(v);
  const kids = [...v.children];
  let timing = null;
  if (isForm(kids[0]) && kids[0].type === 'PTIM') timing = parseTiming(kids.shift());
  const curves = {};
  for (const name of EMITTER_CURVES) curves[name] = parseWaveForm(kids.shift());
  const data = kids.shift();
  if (isForm(data)) throw new Error(`EMTR ${v.type}: expected the emitter data chunk`);
  const fields = parseEmitterFields(ver, data.data);
  const desc = kids.find(isForm);
  let particle = null;
  if (desc?.type === 'PTQD') particle = parseQuad(desc);
  else if (desc?.type === 'PTMH') particle = parseMeshParticle(desc);
  else throw new Error(`EMTR ${v.type}: no particle description`);
  fields.particleType = particle.type;
  return { version: ver, timing, ...curves, ...fields, particle };
}

function parseGroup(node) {
  expectForm(node, 'EMGP');
  const v = forms(node)[0];
  const kids = [...v.children];
  let timing = null;
  if (isForm(kids[0]) && kids[0].type === 'PTIM') timing = parseTiming(kids.shift());
  const count = new R(kids.shift().data).i32();
  const emitters = kids.filter((k) => isForm(k) && k.type === 'EMTR').map(parseEmitter);
  if (emitters.length !== count) throw new Error(`EMGP: ${count} emitters declared, ${emitters.length} found`);
  return { timing, emitters };
}

/** Parse a particle effect file's IFF tree. */
export function parseParticleEffect(root) {
  expectForm(root, 'PEFT');
  const v = forms(root)[0];
  if (!v) throw new Error('PEFT without a version form');
  const kids = [...v.children];
  const effect = { version: version(v), timing: null, initialPlaybackRate: 1, initialPlaybackRateTime: 0, playbackRate: 1, scale: 1, groups: [] };
  if (isForm(kids[0]) && kids[0].type === 'PTIM') effect.timing = parseTiming(kids.shift());
  const head = new R(kids.shift().data);
  const count = head.i32();
  if (effect.version >= 2) {
    effect.initialPlaybackRate = round(head.f32());
    effect.initialPlaybackRateTime = round(head.f32());
    effect.playbackRate = round(head.f32());
    effect.scale = round(head.f32());
  }
  effect.groups = kids.filter((k) => isForm(k) && k.type === 'EMGP').map(parseGroup);
  if (effect.groups.length !== count) throw new Error(`PEFT: ${count} groups declared, ${effect.groups.length} found`);
  return effect;
}

/** Largest value a waveform can take (control point plus its random band). */
export function waveMax(wf) {
  let m = 0;
  for (const [, v, , rmax] of wf.points) m = Math.max(m, v + rmax);
  return m;
}

/** Rough radius of everything an effect can reach, for the pack's bounds. */
export function effectRadius(effect) {
  let r = 0;
  for (const g of effect.groups) {
    for (const e of g.emitters) {
      const offset = Math.hypot(waveMax(e.translationX), waveMax(e.translationY), waveMax(e.translationZ));
      const speed = waveMax(e.speed) * waveMax(e.particle.speedScale);
      const life = waveMax(e.lifeTime);
      const size = e.particle.type === 'quad' ? Math.max(waveMax(e.particle.quad.length), waveMax(e.particle.quad.width)) : waveMax(e.particle.mesh.scale);
      r = Math.max(r, offset + waveMax(e.shapeSize) + waveMax(e.distance) + speed * life + size + 0.5 * 9.8 * waveMax(e.weight) * life * life);
    }
  }
  return r * (effect.scale || 1);
}

/** Blend mode of a particle shader's effect: 'add' (dst ONE), 'alpha', or 'modulate' (dst source colour). */
export function blendFor(pass) {
  if (!pass || !pass.alphaBlend) return 'opaque';
  if (pass.blendDst === 1) return 'add';
  if (pass.blendDst === 2 || pass.blendSrc === 0) return 'modulate';
  return 'alpha';
}

/**
 * Convert one particle effect into the pack: particles/<id>.json plus the textures its quads
 * draw, as PNGs under particles/. `textureFor(shaderPath)` supplies { path, png } for a shader
 * and `passFor(shaderPath)` its effect's first fixed-function pass (for the blend mode).
 * `attach(prtPath)`, when given, converts an effect a particle carries (a PATT) and returns its
 * manifest entry ({ file } once converted, { failed } when it could not be, anything else while
 * it is still being converted further up the chain); its `file` is written onto the attachment,
 * which is what the game plays. Without it attachments keep only their path, as before.
 * Returns the manifest entry.
 */
export function exportParticle(vfs, prtPath, outDir, { textureFor, passFor, textures = new Map(), write, log = () => {}, attach = null, meshFor = null, meshes: meshCache = new Map() }) {
  const path = prtPath.replace(/\\/g, '/');
  if (!vfs.has(path)) throw new Error(`Not in archives: ${path}`);
  const effect = parseParticleEffect(parseIff(vfs.read(path)));
  const id = `fx_${basename(path).replace(/\.prt$/i, '')}`;
  let quads = 0;
  let meshes = 0;
  const missing = [];
  let attached = 0;
  for (const g of effect.groups) {
    for (const e of g.emitters) {
      // The effects each particle carries (a trailing dust wisp, a falling leaf, the next link of a
      // lightning chain): converted into the same pack, their file noted for the game to play.
      if (attach) {
        for (const a of e.particle.attachments ?? []) {
          if (!a.path) continue;
          let r = null;
          try {
            r = attach(a.path.replace(/\\/g, '/'));
          } catch (err) {
            r = { failed: err.message };
          }
          if (r?.file) {
            a.file = r.file;
            attached++;
          } else if (r?.failed) {
            a.failed = r.failed;
            log(`  attached effect ${a.path} skipped: ${r.failed}`);
          }
        }
      }
      // A particle that draws a **mesh** rather than a billboard. 297 of the 2,097 retail effects have
      // one and 119 are nothing else, so those drew nothing at all while this was skipped: the
      // entertainer's ribbon stick is the plainest case, since its quads are written with alpha 0 for
      // their whole life and the stick you hold is entirely the mesh. Its appearance is converted into
      // the same pack and its file written on the emitter, exactly as a texture's is.
      if (e.particle.type !== 'quad') {
        meshes++;
        const mp = String(e.particle.mesh?.path ?? '').replace(/\\/g, '/');
        if (!mp || !meshFor) continue;
        let entry = meshCache.get(mp);
        if (entry === undefined) {
          entry = null;
          try {
            entry = meshFor(mp) ?? null;
          } catch (err) {
            log(`  particle mesh ${mp} skipped: ${err.message}`);
          }
          meshCache.set(mp, entry);
        }
        if (entry?.file) e.particle.mesh.file = entry.file;
        else missing.push(mp);
        continue;
      }
      quads++;
      const tex = e.particle.quad.texture;
      if (!tex.shader) continue;
      const shader = tex.shader.toLowerCase().startsWith('shader/') ? tex.shader : `shader/${tex.shader}`;
      let entry = textures.get(shader);
      if (entry === undefined) {
        entry = null;
        try {
          const t = textureFor(shader);
          if (t?.png) {
            const file = `particles/${basename(t.path).replace(/\.dds$/i, '')}.png`;
            write(`${outDir}/${file}`, t.png);
            entry = { file, blend: blendFor(passFor(shader)) };
          }
        } catch (err) {
          log(`  particle texture ${shader} skipped: ${err.message}`);
        }
        textures.set(shader, entry);
      }
      if (entry) {
        tex.file = entry.file;
        tex.blend = entry.blend;
      } else missing.push(shader);
    }
  }
  const radius = round(effectRadius(effect));
  write(`${outDir}/particles/${id}.json`, JSON.stringify(effect));
  const meshFiles = [...meshCache.values()].filter((m) => m?.file).length;
  return { id, source: path, file: `particles/${id}.json`, particle: true, bounds: { min: [-radius, 0, -radius], max: [radius, radius, radius] }, triangles: 0, emitters: quads + meshes, quads, meshes, ...(meshFiles ? { meshFiles } : {}), missingTextures: missing, ...(attached ? { attached } : {}) };
}
