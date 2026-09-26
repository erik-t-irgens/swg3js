// Swoosh (.swh) reader and exporter: the ribbon a particle trails behind it.
//
// An entertainer's ribbon stick is a stick and one particle that never shows -- a quad written with
// alpha 0 for its whole life, standing at the stick's tip -- and that particle carries the ribbon as an
// attachment (a PATT naming `appearance/sw_red_ribbon.swh`). Every carried effect was converted as a
// particle effect, so this one failed with "expected FORM PEFT, got FORM SWSH" and the stick had
// nothing on it. The glow sticks, the sparkly streamers, the missiles' trails and the swords' swooshes
// are the same kind of file.
//
//   FORM SWSH > FORM 000N {
//     FORM PTEX                       the particle texture, exactly as a quad particle's (particle.mjs)
//     0000 {
//       float r, g, b, a              the ribbon's colour: RGBA, since the red streamer is (1, 0, 0, 1)
//       float width                   metres: 0.04 on the ribbons, 0.06 on the swords, 4 on a missile's trail
//       cstring appearance            an effect that goes with it (the sparkly streamers' sparks), or empty
//       uint8, uint8                  0 and 0 on every retail file
//       float, float                  unread (the first 0.5 to 100, the second -2.5 to 5)
//       int32, int32                  unread (0 to 6 each)
//       uint8                         unread (0 or 1)
//       int32, int32                  unread (1 to 3, and 1 on every file)
//       [v1: float rate, int32 samples, int32 subdivisions]
//     }
//   }
//
// All 89 retail files are one of these two versions and every one parses to the last byte (41 of
// 0000, 48 of 0001), which is checked on every run. The three fields version 0001 adds are read as
// how often the ribbon takes a point (30 or 20 a second), how many it keeps (10 to 100) and how many
// pieces each span between two points is drawn in (1 to 5): that reading is ours and not the client's,
// and it is made from what it gives -- a ribbon a third of a second long, a streamer two thirds, a
// missile's trail one and a half to three seconds and the healing tree's swirl three and a third, each
// what that effect looks like -- where reading the first unread float as the length would have left
// the skill-up swirl eighty seconds long. The unread fields are written into the pack as they stand, in
// file order, so a later reading needs no reconversion.
import { basename } from 'node:path';
import { isForm, parseIff, readCString } from './iff.mjs';
import { parseParticleTexture, particleTexture } from './particle.mjs';

const round = (v) => Math.round(v * 10000) / 10000;

/**
 * Parse a swoosh file's IFF tree.
 * -> { version, texture, color: [r, g, b, a], width, appearance: string|null, rate, samples, subdivisions, fields }
 */
export function parseSwoosh(root) {
  if (!isForm(root) || root.type !== 'SWSH') throw new Error(`expected FORM SWSH, got ${isForm(root) ? `FORM ${root.type}` : root?.tag ?? 'nothing'}`);
  const v = root.children.find(isForm);
  if (!v || !/^\d{4}$/.test(v.type)) throw new Error('SWSH without a version form');
  const version = parseInt(v.type, 10);
  if (version > 1) throw new Error(`SWSH version ${v.type} is not one this reads`);
  const ptex = v.children.find((c) => isForm(c) && c.type === 'PTEX');
  const data = v.children.find((c) => !isForm(c) && c.tag === '0000');
  if (!ptex || !data) throw new Error(`SWSH ${v.type} without its texture or its data`);
  const b = data.data;
  let o = 0;
  const need = (n) => {
    if (o + n > b.length) throw new Error(`SWSH ${v.type}: the data ends at byte ${b.length}, ${o + n - b.length} short`);
  };
  const f32 = () => (need(4), (o += 4), round(b.readFloatLE(o - 4)));
  const i32 = () => (need(4), (o += 4), b.readInt32LE(o - 4));
  const u8 = () => (need(1), b[o++]);
  const str = () => {
    const r = readCString(b, o);
    o = r.next;
    return r.value.replace(/\\/g, '/');
  };
  const color = [f32(), f32(), f32(), f32()];
  const width = f32();
  const appearance = str() || null;
  const fields = [u8(), u8(), f32(), f32(), i32(), i32(), u8(), i32(), i32()];
  const out = { version, texture: parseParticleTexture(ptex), color, width, appearance, rate: null, samples: null, subdivisions: null, fields };
  if (version >= 1) {
    out.rate = f32();
    out.samples = i32();
    out.subdivisions = i32();
  }
  if (o !== b.length) throw new Error(`SWSH ${v.type}: ${b.length - o} bytes left unread`);
  return out;
}

/**
 * Convert one swoosh into the pack: particles/swh_<name>.json, its texture written as a quad
 * particle's is (shared through `textures`), and the effect it names converted through `attach`.
 * Returns the manifest entry, shaped as a particle effect's is so the caches and the logs take it.
 */
export function exportSwoosh(vfs, swhPath, outDir, { textureFor, passFor, textures = new Map(), write, log = () => {}, attach = null }) {
  const path = swhPath.replace(/\\/g, '/');
  if (!vfs.has(path)) throw new Error(`Not in archives: ${path}`);
  const s = parseSwoosh(parseIff(vfs.read(path)));
  const id = `swh_${basename(path).replace(/\.swh$/i, '')}`;
  const missing = [];
  const tex = particleTexture(s.texture, outDir, { textureFor, passFor, textures, write, log });
  if (tex) {
    s.texture.file = tex.file;
    s.texture.blend = tex.blend;
  } else if (s.texture.shader) missing.push(s.texture.shader);
  let appearance = null;
  if (s.appearance) {
    appearance = { path: s.appearance };
    if (attach) {
      let r = null;
      try {
        r = attach(s.appearance);
      } catch (err) {
        r = { failed: err.message };
      }
      if (r?.file) appearance.file = r.file;
      else if (r?.failed) {
        appearance.failed = r.failed;
        log(`  the effect ${s.appearance} a ribbon carries was skipped: ${r.failed}`);
      }
    }
  }
  const json = { kind: 'swoosh', ...s, appearance };
  write(`${outDir}/particles/${id}.json`, JSON.stringify(json));
  const reach = round(Math.max(1, s.width * 4));
  return { id, source: path, file: `particles/${id}.json`, particle: true, swoosh: true, bounds: { min: [-reach, 0, -reach], max: [reach, reach, reach] }, triangles: 0, emitters: 0, quads: 0, meshes: 0, missingTextures: missing, ...(appearance?.file ? { attached: 1 } : {}) };
}

/**
 * The carried ribbons a pack's converted effects name and could not convert, from the JSON on disk:
 * a pack converted before swooshes were read carries each one as an attachment with no file and the
 * failure above. Reads only the files that mention a `.swh` at all, so a pack with none costs a
 * directory listing and a string test a file.
 */
export function swooshStatus(particlesDir, { readdirSync, readFileSync, existsSync }) {
  const out = { carriers: 0, ribbons: 0, missing: 0 };
  if (!existsSync(particlesDir)) return out;
  for (const f of readdirSync(particlesDir)) {
    if (!f.endsWith('.json') || f.startsWith('swh_')) continue;
    let text;
    try {
      text = readFileSync(`${particlesDir}/${f}`, 'utf8');
    } catch {
      continue;
    }
    if (!text.includes('.swh')) continue;
    let j;
    try {
      j = JSON.parse(text);
    } catch {
      continue;
    }
    let carries = false;
    for (const g of j.groups ?? []) {
      for (const e of g.emitters ?? []) {
        for (const a of e.particle?.attachments ?? []) {
          if (!/\.swh$/i.test(a.path ?? '')) continue;
          carries = true;
          out.ribbons++;
          if (!a.file) out.missing++;
        }
      }
    }
    if (carries) out.carriers++;
  }
  return out;
}
