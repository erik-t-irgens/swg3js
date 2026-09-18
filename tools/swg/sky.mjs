// Sky exporter: the client's per-planet environment (terrain/environment/<planet>.iff, FORM ENVM:
// sun, moons, extra celestials, stars, skybox, time lock) and its environment table
// (datatables/environment/<planet>.iff: one row per environment family and weather with the
// gradient sky texture, cloud layers, the colour ramp image, fog and the reflection cube maps)
// become <pack>/sky.json plus PNGs under <pack>/sky/.
//
// The colour ramp is a 256 x 8 (or 10) 32-bit image indexed by time of day: rows are ambient
// (alpha: celestial alpha), main light (alpha: scale), specular, fill, bounce, clear colour
// (alpha: sun and moon alpha), fog (alpha: star alpha), shadow, then back and tangent light.
import { basename, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { decodeDds, decodeDdsCube, isDdsCube } from './dds.mjs';
import { decodeTga } from './tga.mjs';
import { encodePng } from './png.mjs';
import { isForm, parseIff } from './iff.mjs';
import { parseDatatable } from './datatable.mjs';

/** Sequential reader over a chunk's bytes. */
class Cursor {
  constructor(buf) {
    this.buf = buf;
    this.o = 0;
  }
  string() {
    let end = this.o;
    while (end < this.buf.length && this.buf[end] !== 0) end++;
    const s = this.buf.toString('latin1', this.o, end);
    this.o = end + 1;
    return s;
  }
  f32() {
    const v = this.buf.readFloatLE(this.o);
    this.o += 4;
    return v;
  }
  i32() {
    const v = this.buf.readInt32LE(this.o);
    this.o += 4;
    return v;
  }
  u8() {
    return this.buf[this.o++];
  }
  vec3() {
    return [this.f32(), this.f32(), this.f32()];
  }
  get left() {
    return this.buf.length - this.o;
  }
}

/** Mirror an RGBA image horizontally in place. */
export function mirrorX(rgba, width, height) {
  const row = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    const o = y * width * 4;
    row.set(rgba.subarray(o, o + width * 4));
    for (let x = 0; x < width; x++) rgba.set(row.subarray((width - 1 - x) * 4, (width - x) * 4), o + x * 4);
  }
}

/** An RGBA image at half the size, each output texel the mean of a 2x2 block. */
export function halve(img) {
  const w = Math.max(1, img.width >> 1);
  const h = Math.max(1, img.height >> 1);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        const i0 = ((y * 2) * img.width + x * 2) * 4 + c;
        const i1 = i0 + 4;
        const i2 = i0 + img.width * 4;
        const i3 = i2 + 4;
        out[(y * w + x) * 4 + c] = (img.rgba[i0] + img.rgba[i1] + img.rgba[i2] + img.rgba[i3] + 2) >> 2;
      }
    }
  }
  return { width: w, height: h, rgba: out };
}

/**
 * A DDS cube map as six RGBA faces in the game's order (+X -X +Y -Y +Z -Z), converted to the
 * game's mirrored X axis (the two X faces swapped, every face flipped horizontally), alpha made
 * opaque, and halved until no wider than `max`. Throws when the file is not a cube map.
 *
 * The sky and the water both write their cubes through this, so a reflection map means the same
 * thing whichever command wrote it.
 * Returns { faces: [{ suffix, img }], size, source }.
 */
export function cubeFaces(bytes, max) {
  if (!isDdsCube(bytes)) throw new Error('not a cube map');
  const { faces } = decodeDdsCube(bytes);
  const order = [1, 0, 2, 3, 4, 5];
  const names = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];
  const out = [];
  for (let i = 0; i < 6; i++) {
    let img = faces[order[i]];
    while (img.width > max) img = halve(img);
    mirrorX(img.rgba, img.width, img.height);
    for (let k = 3; k < img.rgba.length; k += 4) img.rgba[k] = 255;
    out.push({ suffix: names[i], img });
  }
  return { faces: out, size: Math.min(max, faces[0].width), source: faces[0].width };
}

/** The client environment file (FORM ENVM 0000) as plain data, or null when the planet has none. */
export function parseEnvironmentFile(root) {
  if (!isForm(root) || root.type !== 'ENVM') return null;
  const v = root.children.find(isForm);
  const out = { sun: null, supplementalSun: null, moon: null, supplementalMoon: null, celestials: [], stars: null, nightSky: null, timeLock: null, skybox: null, distant: [] };
  const celestial = (c) => ({ shader: c.string(), size: c.f32(), glowShader: c.string(), glowSize: c.f32() });
  const distant = (form, planet) => {
    const chunk = form.children.find((x) => !isForm(x));
    if (!chunk) return null;
    const c = new Cursor(chunk.data);
    const d = { appearance: c.string(), direction: c.vec3(), orientation: [c.f32(), c.f32(), c.f32()], haloRoll: 0, haloScale: 1, infinite: false, flag: 0, planet };
    if (planet) {
      d.haloRoll = c.f32();
      d.haloScale = c.f32();
    }
    d.infinite = c.u8() !== 0;
    if (!planet && c.left >= 4) d.flag = c.i32();
    return d;
  };
  for (const ch of v?.children ?? []) {
    if (isForm(ch)) {
      if (ch.type === 'DIST') out.distant.push(distant(ch, false));
      else if (ch.type === 'PLAN') out.distant.push(distant(ch, true));
      continue;
    }
    const c = new Cursor(ch.data);
    switch (ch.tag) {
      case 'NSKY':
        out.nightSky = c.string();
        break;
      case 'STAR':
        out.stars = { colorRamp: c.string(), count: c.i32() };
        break;
      case 'SUN ':
        out.sun = celestial(c);
        break;
      case 'SSUN':
        out.supplementalSun = { ...celestial(c), yaw: c.f32(), pitch: c.f32() };
        break;
      case 'MOON':
        out.moon = celestial(c);
        break;
      case 'SMOO':
        out.supplementalMoon = { ...celestial(c), yaw: c.f32(), pitch: c.f32() };
        break;
      case 'CELS':
        out.celestials.push({ ...celestial(c), yaw: c.f32(), pitch: c.f32(), pitchDirection: c.f32(), cycleTime: c.f32() });
        break;
      case 'TLOK':
        out.timeLock = { locked: c.u8() !== 0, time: c.f32() };
        break;
      case 'SKYB':
        out.skybox = { cubeMap: c.u8() !== 0, mask: c.string() };
        break;
      default:
        break;
    }
  }
  out.distant = out.distant.filter(Boolean);
  return out;
}

/**
 * The effects every planet pack carries so any kind of weather can be asked for, lightest first.
 * A planet's own rows only name what its climate has; these let the game show rain on a desert.
 */
export const FORCE_EFFECTS = {
  rain: ['appearance/pt_rain_sheet_verylight.prt', 'appearance/pt_rain_sheet_light.prt', 'appearance/pt_rain_sheet_heavy.prt'],
  dust: ['appearance/pt_dust_storm_light.prt', 'appearance/pt_dust_storm.prt', 'appearance/pt_dust_storm_heavy.prt'],
  snow: ['appearance/pt_snow_lifeday.prt', 'appearance/pt_snow_storm_heavy.prt'],
};

/** What a camera effect is, from its file name: rain, snow, dust, fog, leaves, lightning, smoke or other. */
export function cameraEffectKind(path) {
  const n = String(path).replace(/^.*[\\/]/, '').toLowerCase();
  if (/snow/.test(n)) return 'snow';
  if (/rain/.test(n)) return 'rain';
  if (/dust|sand/.test(n)) return 'dust';
  if (/fog|mist/.test(n)) return 'fog';
  if (/leaf|leaves/.test(n)) return 'leaves';
  // The archives spell it both ways, and both must land here rather than reading as "light".
  if (/lightning|lighting/.test(n)) return 'lightning';
  if (/smoke|ash/.test(n)) return 'smoke';
  return 'other';
}

/** How hard it falls, 0..1, from the name's "very light", "light" and "heavy". */
export function cameraEffectStrength(path) {
  const n = String(path).replace(/^.*[\\/]/, '').toLowerCase();
  if (/verylight/.test(n)) return 0.35;
  if (/_light(_|\.|$)/.test(n)) return 0.6;
  if (/heavy/.test(n)) return 1;
  return 0.7;
}

/**
 * Write the planet's sky data into the pack. `textureFor(shaderPath)` resolves a shader to
 * its main texture ({ png, alphaMode, hasAlpha }) the way meshes get theirs. `particleFor(prtPath)`
 * converts a row's camera effect into the pack and returns { file } or { failed }; without it the
 * rows still name their effect but no file is written.
 */
export function exportSky(vfs, planet, outDir, { textureFor, particleFor = null, log = console.error, space = null }) {
  const envPath = `terrain/environment/${planet}.iff`;
  const tablePath = `datatables/environment/${planet}.iff`;
  // A space zone's sky can stand on its terrain file alone (Kashyyyk's system has no environment file of its own).
  if (!vfs.has(envPath) && !vfs.has(tablePath) && !space) {
    log(`  sky: no ${envPath} or ${tablePath} in archives`);
    return null;
  }
  const skyDir = join(outDir, 'sky');
  mkdirSync(skyDir, { recursive: true });
  const written = new Map();
  const notes = [];
  const clean = (p) => p.replace(/\\/g, '/').replace(/^\//, '');
  const fileName = (path, suffix = '') => `sky/${basename(clean(path)).replace(/\.[^.]+$/, '')}${suffix}.png`;
  const write = (rel, img) => {
    writeFileSync(join(outDir, rel), encodePng(img.width, img.height, img.rgba));
    return rel;
  };
  const decodeImage = (path) => {
    const p = clean(path);
    if (!vfs.has(p)) throw new Error(`${p} not in archives`);
    const bytes = vfs.read(p);
    return /\.tga$/i.test(p) ? decodeTga(bytes) : decodeDds(bytes);
  };
  /** A plain texture as a PNG under sky/, alpha kept unless `opaque`. */
  const image = (path, { opaque = false, max = 1024 } = {}) => {
    if (!path) return null;
    const key = `${clean(path)}|${opaque}`;
    if (written.has(key)) return written.get(key);
    let rel = null;
    try {
      let img = decodeImage(path);
      while (img.width > max || img.height > max) img = halve(img);
      if (opaque) for (let i = 3; i < img.rgba.length; i += 4) img.rgba[i] = 255;
      rel = write(fileName(path), img);
    } catch (err) {
      notes.push(`${clean(path)}: ${err.message}`);
    }
    written.set(key, rel);
    return rel;
  };
  /**
   * A cube map as six PNGs in the game's face order (+X -X +Y -Y +Z -Z), already converted to
   * the game's mirrored X axis (faces swapped and flipped), and its size.
   */
  const cube = (path, max = 256) => {
    if (!path) return null;
    const p = clean(path);
    const key = `cube|${p}`;
    if (written.has(key)) return written.get(key);
    let out = null;
    try {
      if (!vfs.has(p)) throw new Error(`${p} not in archives`);
      const { faces, size } = cubeFaces(vfs.read(p), max);
      out = { faces: faces.map((f) => write(fileName(p, `_${f.suffix}`), f.img)), size };
    } catch (err) {
      notes.push(`${p}: ${err.message}`);
    }
    written.set(key, out);
    return out;
  };
  /** A shader's main texture as a PNG under sky/ (celestial bodies, cloud layers, the night sky). */
  const shaderImage = (shaderPath) => {
    if (!shaderPath) return null;
    const p = clean(shaderPath);
    const key = `shader|${p}`;
    if (written.has(key)) return written.get(key);
    let out = null;
    const path = [p, `shader/${p}`, `${p}.sht`].find((c) => vfs.has(c));
    if (!path) notes.push(`${p}: shader not in archives`);
    else {
      const tex = textureFor(path);
      if (!tex) notes.push(`${path}: no texture`);
      else {
        const rel = fileName(tex.path.replace(/#.*$/, ''));
        writeFileSync(join(outDir, rel), tex.png);
        out = { file: rel, alphaMode: tex.alphaMode, hasAlpha: !!tex.hasAlpha };
      }
    }
    written.set(key, out);
    return out;
  };
  /** The colour ramp image as base64 RGBA rows (256 wide), plus its row count. */
  const ramp = (path) => {
    if (!path) return null;
    try {
      const img = decodeImage(path);
      if (img.width !== 256) throw new Error(`colour ramp is ${img.width} wide, expected 256`);
      return { rows: img.height, rgba: Buffer.from(img.rgba).toString('base64') };
    } catch (err) {
      notes.push(`${clean(path)}: ${err.message}`);
      return null;
    }
  };

  /** A row's camera particle effect, converted into the pack when the caller can convert one. */
  const effect = (path) => {
    if (!path) return null;
    const source = clean(path);
    let file = null;
    if (particleFor) {
      const r = particleFor(source);
      if (r?.failed) notes.push(`${source}: ${r.failed}`);
      else file = r?.file ?? null;
    }
    return { source, file, kind: cameraEffectKind(source), strength: cameraEffectStrength(source) };
  };

  const sky = { planet, cycleSeconds: 86400, dayNightSplit: 0.7, sunElevationDegrees: 67.5, sun: null, supplementalSun: null, moon: null, supplementalMoon: null, celestials: [], stars: null, nightSky: null, timeLock: null, skybox: null, distant: [], space: null, weather: null, blocks: [] };
  const celestial = (c) => (c ? { ...c, image: shaderImage(c.shader), glowImage: shaderImage(c.glowShader) } : null);
  if (vfs.has(envPath)) {
    const env = parseEnvironmentFile(parseIff(vfs.read(envPath)));
    if (env) {
      sky.sun = celestial(env.sun);
      sky.supplementalSun = celestial(env.supplementalSun);
      sky.moon = celestial(env.moon);
      sky.supplementalMoon = celestial(env.supplementalMoon);
      sky.celestials = env.celestials.map(celestial);
      sky.timeLock = env.timeLock;
      sky.distant = env.distant;
      sky.nightSky = env.nightSky ? { shader: env.nightSky, image: shaderImage(env.nightSky) } : null;
      if (env.stars) {
        let colors = null;
        try {
          const img = decodeImage(env.stars.colorRamp);
          colors = { width: img.width, height: img.height, rgba: Buffer.from(img.rgba).toString('base64') };
        } catch (err) {
          notes.push(`${clean(env.stars.colorRamp)}: ${err.message}`);
        }
        sky.stars = { count: env.stars.count, colors };
      }
      if (!space && env.skybox?.mask) {
        if (env.skybox.cubeMap) sky.skybox = { cube: cube(env.skybox.mask.includes('/') ? env.skybox.mask : `texture/${env.skybox.mask}.dds`, 1024) };
        else {
          const sides = {};
          for (const side of ['front', 'right', 'back', 'left', 'top', 'bottom']) sides[side] = image(`texture/${env.skybox.mask}_${side}.dds`, { opaque: true });
          sky.skybox = { sides };
        }
      }
    }
  }
  if (space) {
    // A space zone: its terrain file's six-sided skybox, lights, dust and star sprites, and the
    // cube map it names for reflections; its star field over the environment file's.
    if (space.skybox) {
      const sides = {};
      for (const side of ['front', 'right', 'back', 'left', 'top', 'bottom']) sides[side] = image(`texture/${space.skybox}_${side}.dds`, { opaque: true });
      sky.skybox = { sides };
    }
    if (space.stars?.count) {
      let colors = sky.stars?.colors ?? null;
      if (!colors && space.stars.colorRamp) {
        try {
          const img = decodeImage(space.stars.colorRamp);
          colors = { width: img.width, height: img.height, rgba: Buffer.from(img.rgba).toString('base64') };
        } catch (err) {
          notes.push(`${clean(space.stars.colorRamp)}: ${err.message}`);
        }
      }
      sky.stars = { count: space.stars.count, colors };
    }
    sky.space = {
      clear: space.clear,
      ambient: space.ambient,
      lights: space.lights,
      dust: space.dust,
      celestials: space.celestials.map((c) => ({ ...c, image: shaderImage(c.shader) })),
      environmentMap: space.environmentMap ? cube(space.environmentMap) : null,
    };
  }
  if (vfs.has(tablePath)) {
    const table = parseDatatable(parseIff(vfs.read(tablePath)));
    const c = table.columns;
    for (const row of table.rows) {
      const v = (i) => row[c[i]];
      const str = (i) => (typeof v(i) === 'string' ? v(i) : '');
      const sound = (i) => (str(i) ? clean(str(i)) : null);
      const block = {
        name: str(0),
        weatherIndex: Number(v(1)) || 0,
        gradientSky: image(str(2), { opaque: true }),
        cloudBottom: str(3) ? { ...shaderImage(str(3)), size: Number(v(4)) || 0, speed: Number(v(5)) || 0 } : null,
        cloudTop: str(6) ? { ...shaderImage(str(6)), size: Number(v(7)) || 0, speed: Number(v(8)) || 0 } : null,
        ramp: ramp(str(9)),
        shadows: Number(v(10)) !== 0,
        fog: { enabled: Number(v(11)) !== 0, min: Number(v(12)) || 0, max: Number(v(13)) || 0 },
        // In space, what reflections see is the cube map the zone's terrain file names.
        dayEnvironment: sky.space?.environmentMap ?? cube(str(15)),
        nightEnvironment: sky.space?.environmentMap ?? cube(str(16)),
        windSpeedScale: Number(v(24)) || 1,
        // What the row makes fall around the camera, and the sounds the area plays (no audio system yet).
        cameraEffect: effect(str(14)),
        sounds: { day: [sound(17), sound(18)], night: [sound(19), sound(20)], music: { first: sound(21), sunrise: sound(22), sunset: sound(23) } },
      };
      sky.blocks.push(block);
    }
  }
  if (sky.blocks.length && !space) {
    sky.weather = {
      levels: Math.max(1, ...sky.blocks.map((b) => b.weatherIndex + 1)),
      effects: Object.fromEntries(Object.entries(FORCE_EFFECTS).map(([kind, list]) => [kind, list.map((p) => (vfs.has(p) ? effect(p)?.file ?? null : null))])),
    };
  }
  writeFileSync(join(outDir, 'sky.json'), JSON.stringify(sky));
  const cameraEffects = new Set(sky.blocks.map((b) => b.cameraEffect?.source).filter(Boolean));
  const effectKinds = [...new Set(sky.blocks.map((b) => b.cameraEffect?.kind).filter(Boolean))];
  const parts = [`${sky.blocks.length} environment blocks`, sky.sun ? 'sun' : 'no sun', sky.moon ? 'moon' : 'no moon', sky.skybox ? 'skybox' : 'gradient sky', sky.stars ? `${sky.stars.count} stars` : 'no stars', ...(sky.space ? [`${sky.space.lights.length} space lights`, `${sky.space.celestials.length} star sprites`] : []), ...(sky.blocks.length ? [`${cameraEffects.size} camera effect${cameraEffects.size === 1 ? '' : 's'}${effectKinds.length ? ` (${effectKinds.join(', ')})` : ''}`] : [])];
  log(`  sky: ${parts.join(', ')} -> sky.json${notes.length ? `; ${notes.length} problems: ${[...new Set(notes)].slice(0, 6).join('; ')}` : ''}`);
  return 'sky.json';
}
