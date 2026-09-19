// The nebulae a space zone holds, and the lightning they carry.
//
// Each zone's table is datatables/space/nebula/<zone>.iff, one row per nebula, with the columns the
// table declares: a name; a centre (x, y, z) and a radius in metres; a density; a `facingPercent`;
// four colours as separate alpha, red, green and blue columns (`facing` and `facingRamp`, `oriented`
// and `orientedRamp`); an ambient sound and its volume; a camera shake; three effect columns that are
// 0 on every retail row; the lightning columns (how often, how long, the damage band, the .ltn that
// draws it, its two colours, its two sounds, and the client and server hit effects); two environmental
// damage columns that are 0 on every retail row with an empty effect; and a `shaderIndex`.
//
// The centres are in the same frame as the station and hyperspace tables, so they are mirrored to
// (-X, Y, Z) here, as everything else converted is.
//
// What "facing" and "oriented" mean is INFERRED, not read from the client: `facingPercent` is taken as
// the share of a nebula's sheets that turn to face the camera, the rest keeping a fixed turn in the
// world, and each pair's "ramp" colour as the colour at the nebula's edge against its colour at the
// middle. Which shader `shaderIndex` picks is inferred too, from the order the client's executable
// lists the two nebula shaders in: 0 is the additive glow, 1 the blended mist.
//
// The lightning file (.ltn) is FORM LEFX > 0002: a FORM PTEX (a particle texture: the shader, then the
// flip-book's frame count, first and last frame, UV size, frames per column, frames per second and a
// visible byte, the layout particle.mjs reads), two FORM WVFM waveforms, and a 0000 chunk that starts
// with a float, then names the effect played where a bolt starts and the one where it ends, then 81
// bytes this converter does not read.
import { isForm, readCString } from './iff.mjs';
import { parseWaveForm } from './particle.mjs';

/**
 * The two nebula shaders, with the near shell's variants beside them. Both `_no_z` shaders name the
 * same MAIN texture as the sheet shader they belong to (checked against the retail archives), and
 * differ only in their effect, so a pack writes one image per kind and the shell points at it.
 */
export const NEBULA_SHADERS = {
  glow: { sheet: 'shader/pt_nebulae_gas_4_2.sht', shell: 'shader/pt_nebulae_gas_4_2_no_z.sht', blend: 'add', image: 'nebula/glow.png' },
  mist: { sheet: 'shader/pt_nebulae_gas_4_alpha_2.sht', shell: 'shader/pt_nebulae_gas_4_alpha_2_no_z.sht', blend: 'alpha', image: 'nebula/mist.png' },
};

/** Where a pack keeps the lightning's own picture. */
export const LIGHTNING_IMAGE = 'nebula/lightning.png';

/** Which of the two shaders a row's `shaderIndex` picks. Inferred (see the file's head), not read from the client. */
export function shaderKindOf(index) {
  return Number(index) === 1 ? 'mist' : 'glow';
}

const r4 = (x) => Math.round((Number(x) || 0) * 10000) / 10000;
const slashes = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^\//, '');
/** A client-frame coordinate in the game's frame: X mirrored, never a negative zero. */
const mirrorX = (x) => (x === 0 ? 0 : -x);

/** One of the table's four-column colours as [alpha, red, green, blue], each 0 to 1 as the table stores it. */
const colour = (row, prefix) => [r4(row[`${prefix}A`]), r4(row[`${prefix}R`]), r4(row[`${prefix}G`]), r4(row[`${prefix}B`])];

/**
 * A zone's nebulae from its table's rows. Each is
 * `{ name, at, radius, density, facingShare, facing: { colour, ramp }, oriented: { colour, ramp },
 *    jitter, shader, shaderIndex, sound, lightning, unused }`, with `at` mirrored to the game's frame
 * and `lightning` null where the row names no .ltn or never strikes. `unused` keeps the columns no
 * retail row fills (the reactor, engine and shield effects, and the environmental damage), so the
 * pack says what the table held without the game having to read them.
 */
export function parseNebulaTable(rows) {
  const out = [];
  for (const row of rows ?? []) {
    const name = String(row.name ?? '');
    const appearance = slashes(row.lightningAppearace);
    const every = r4(row.lightningFrequency);
    out.push({
      name,
      at: [mirrorX(Number(row.x) || 0), Number(row.y) || 0, Number(row.z) || 0],
      radius: r4(row.radius),
      density: r4(row.density),
      facingShare: r4(row.facingPercent),
      facing: { colour: colour(row, 'facing'), ramp: colour(row, 'facingRamp') },
      oriented: { colour: colour(row, 'oriented'), ramp: colour(row, 'orientedRamp') },
      jitter: r4(row.cameraJitter),
      shader: shaderKindOf(row.shaderIndex),
      shaderIndex: Number(row.shaderIndex) || 0,
      sound: { ambient: slashes(row.ambientSound) || null, volume: r4(row.ambientSoundVolume) },
      lightning:
        appearance && every > 0
          ? {
              appearance,
              every,
              maxSeconds: r4(row.lightningDurationMax),
              damage: [r4(row.lightningDamageMin), r4(row.lightningDamageMax)],
              colour: colour(row, 'lightning'),
              ramp: colour(row, 'lightningRamp'),
              sounds: { strike: slashes(row.lightningSound) || null, loop: slashes(row.lightningSoundLoop) || null },
              hit: { client: slashes(row.lightningHitEffectClient) || null, server: slashes(row.lightningHitEffectServer) || null },
            }
          : null,
      unused: {
        effectReactor: r4(row.effectReactor),
        effectEngine: r4(row.effectEngine),
        effectShields: r4(row.effectShields),
        environmentalDamageFrequency: r4(row.environmentalDamageFrequency),
        environmentalDamage: r4(row.environmentalDamage),
        environmentalDamageEffect: slashes(row.environmentalDamageEffect) || null,
      },
    });
  }
  return out;
}

/**
 * The .ltn's FORM PTEX chunk: a particle texture, field for field the layout particle.mjs's own
 * reader uses (that module does not export it, so this is a second reader of one layout and the two
 * must be changed together). The names are shortened for the pack, so `frames` here is
 * `frameCount` there, `uvSize` is `frameUVSize`, `perColumn` is `framesPerColumn` and `fps` is
 * `framesPerSecond`; a reader holding both a pack and a particle manifest is looking at the same
 * seven numbers under two sets of names.
 */
function parseTextureChunk(data) {
  const { value, next } = readCString(data, 0);
  const i32 = (o) => (o + 4 <= data.length ? data.readInt32LE(o) : 0);
  const f32 = (o) => (o + 4 <= data.length ? r4(data.readFloatLE(o)) : 0);
  return {
    shader: slashes(value),
    frames: i32(next),
    frameStart: i32(next + 4),
    frameEnd: i32(next + 8),
    uvSize: f32(next + 12),
    perColumn: i32(next + 16),
    fps: f32(next + 20),
    visible: next + 24 < data.length ? data[next + 24] !== 0 : true,
  };
}

/**
 * A lightning appearance (.ltn, FORM LEFX): its flip-book texture, its two waveforms, the float its
 * data chunk opens with (unresolved), and the two particle effects it plays where a bolt starts and
 * where it ends. `trailingBytes` counts what follows those two names and is not read. Null for
 * anything that is not a LEFX, or a LEFX without the chunk that names the effects.
 */
export function parseLightning(root) {
  if (!root || !isForm(root) || root.type !== 'LEFX') return null;
  const v = (root.children ?? []).find(isForm);
  if (!v) return null;
  const texForm = (v.children ?? []).find((c) => isForm(c) && c.type === 'PTEX');
  const waveforms = [];
  for (const c of v.children) {
    if (isForm(c) && c.type === 'WVFM') {
      try {
        waveforms.push(parseWaveForm(c));
      } catch {
        // A waveform the reader cannot make sense of is left out rather than losing the file.
      }
    }
  }
  const data = (v.children ?? []).find((c) => !isForm(c) && c.data && c.data.length >= 5)?.data ?? null;
  if (!data) return null;
  const value = r4(data.readFloatLE(0));
  const a = readCString(data, 4);
  const b = readCString(data, a.next);
  return {
    texture: texForm && texForm.children?.[0]?.data ? parseTextureChunk(texForm.children[0].data) : null,
    waveforms,
    value,
    start: slashes(a.value) || null,
    end: slashes(b.value) || null,
    trailingBytes: Math.max(0, data.length - b.next),
  };
}

/**
 * The look a pack writes for the two kinds of sheet: each kind's sheet shader with its effect and the
 * image the converter wrote for it, and the near shell's shader and effect beside it. `image(kind)`
 * gives the file the converter wrote, or null when it could not; `effect(shader)` gives a shader's
 * effect path, or null. The shell always points at its kind's own image, because both shaders name
 * the same texture.
 */
export function nebulaLook({ image, effect }) {
  const out = {};
  for (const [kind, s] of Object.entries(NEBULA_SHADERS)) {
    const file = image(kind) ?? null;
    out[kind] = {
      shader: s.sheet,
      effect: effect(s.sheet) ?? null,
      blend: s.blend,
      texture: file,
      shell: { shader: s.shell, effect: effect(s.shell) ?? null, texture: file },
    };
  }
  return out;
}

/**
 * What a zone's nebulae come to, for the converter's log and for `status`:
 * `{ count, glow, mist, striking, jitter, farthest }` (farthest is the furthest nebula edge from the
 * zone's middle, in metres).
 */
export function nebulaSummary(nebulae) {
  let glow = 0;
  let mist = 0;
  let striking = 0;
  let jitter = 0;
  let farthest = 0;
  for (const n of nebulae ?? []) {
    if (n.shader === 'mist') mist++;
    else glow++;
    if (n.lightning) striking++;
    jitter = Math.max(jitter, n.jitter ?? 0);
    farthest = Math.max(farthest, Math.hypot(...(n.at ?? [0, 0, 0])) + (n.radius ?? 0));
  }
  return { count: (nebulae ?? []).length, glow, mist, striking, jitter: r4(jitter), farthest: Math.round(farthest) };
}

/** Every nebula table in the archives, for the diagnostics: the one a zone uses is `space/nebula/<zone>.iff`. */
export const nebulaTableFor = (zone) => `datatables/space/nebula/${zone}.iff`;

/** Every LEFX a zone's rows name, once each and in the order they first appear. */
export function lightningFilesOf(nebulae) {
  const seen = [];
  for (const n of nebulae ?? []) {
    const p = n.lightning?.appearance;
    if (p && !seen.includes(p)) seen.push(p);
  }
  return seen;
}
