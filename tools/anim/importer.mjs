// The importer: every FBX under a folder read, measured and written as the neutral clip pack the game ships
// (`public/anims/mixamo/`: an index and one `.mxa` a clip, src/anim/mxaFile.ts). It reads the folder and writes the
// pack and nothing else: no source file is copied, and nothing of the game's own files is read at all.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { PACK_FORMAT, PACK_FPS, clipSlug, encodeMxa, mirrorClip, readPackIndex } from '../../src/anim/mxaFile.ts';
import { analyzeClip } from './analyze.mjs';
import { readFbx, restDifference } from './fbx.mjs';
import { CLIPS, rowFor } from './mixamoClips.mjs';

/** A name as an id: lower case, every run of anything else one underscore (`Walking (1)` is `walking_1`). The game's own rule (`clipSlug`), so the console finds a clip by its file's name. */
export const slug = clipSlug;

/** Every FBX under a folder, as paths relative to it with forward slashes, sorted. */
export function fbxFiles(folder) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.fbx$/i.test(e.name)) out.push(relative(folder, p).split(sep).join('/'));
    }
  };
  walk(folder);
  return out.sort();
}

/**
 * Each file's id: its name's slug, and where two files share one, the files in a folder take that folder's slug in
 * front (`braced_hanging_idle`), a deeper folder's too if that is still not enough. Answers a map of file to id.
 */
export function idsFor(files) {
  const ids = new Map();
  const parts = (f) => f.replace(/\.fbx$/i, '').split('/').map(slug);
  let depth = new Map(files.map((f) => [f, 1]));
  for (let pass = 0; pass < 8; pass++) {
    const by = new Map();
    for (const f of files) {
      const p = parts(f);
      const id = p.slice(Math.max(0, p.length - depth.get(f))).join('_');
      ids.set(f, id);
      (by.get(id) ?? by.set(id, []).get(id)).push(f);
    }
    let clash = false;
    for (const group of by.values()) {
      if (group.length < 2) continue;
      for (const f of group) {
        // The file nearest the top keeps the plain name; the rest take one more folder in front.
        if (parts(f).length > depth.get(f)) {
          depth.set(f, depth.get(f) + 1);
          clash = true;
        }
      }
    }
    if (!clash) break;
  }
  const seen = new Map();
  for (const [f, id] of ids) {
    if (!id) throw new Error(`${f}: its name makes no id`);
    if (seen.has(id)) throw new Error(`${f} and ${seen.get(id)} both make the id ${id}`);
    seen.set(id, f);
  }
  return ids;
}

const r = (v, d) => Number(v.toFixed(d));
const hashOf = (bytes) => createHash('sha1').update(bytes).digest('hex').slice(0, 12);

/**
 * Import a folder. `out` is the pack's folder (made if need be; its old `.mxa` files that the new index does not name
 * are taken away). Answers the index and a report: every clip's numbers, the files whose rest pose differs from the
 * first's, the travel check, the trims, and the table's rows that named no file.
 */
export function importFolder(folder, out, { log = () => {} } = {}) {
  const src = resolve(folder);
  const dst = resolve(out);
  if (!existsSync(src) || !statSync(src).isDirectory()) throw new Error(`${src} is not a folder`);
  if (dst === src || dst.startsWith(src + sep)) throw new Error('the pack is never written into the folder it is imported from');
  const files = fbxFiles(src);
  if (!files.length) throw new Error(`no .fbx under ${src}`);
  const ids = idsFor(files);
  const clips = [];
  const restDiffers = [];
  const failed = [];
  let first = null;
  for (const file of files) {
    const id = ids.get(file);
    let read;
    try {
      read = readFbx(readFileSync(join(src, file)));
    } catch (err) {
      failed.push({ file, why: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (!first) first = { file, ...read };
    else {
      const diff = restDifference(first, read);
      if (diff) {
        // A file made for another skeleton cannot share the pack's one rest pose: said, and left out.
        restDiffers.push({ file, why: diff });
        continue;
      }
    }
    log(`  read ${file}`);
    clips.push({ id, file, clip: read.clip, source: read.source });
  }
  if (!first) throw new Error(`none of the ${files.length} files could be read: ${failed[0]?.why ?? ''}`);
  const bones = first.bones.map((b) => ({ name: b.name, parent: b.parent, rest: b.rest.map((v) => r(v, 6)) }));
  const names = bones.map((b) => b.name);

  mkdirSync(dst, { recursive: true });
  const rows = [];
  const report = [];
  const written = new Set();
  const emit = (id, clip, table, source, mirrorOf) => {
    const a = analyzeClip(clip, bones, { ground: table.ground });
    const loop = table.loop ?? a.loop;
    const bytes = encodeMxa(clip);
    const fileName = `${id}.mxa`;
    writeFileSync(join(dst, fileName), bytes);
    written.add(fileName);
    const trimStart = table.trimStart;
    if (!(trimStart >= 0 && trimStart < clip.duration)) throw new Error(`${id}: a trim of ${trimStart} s is not inside its ${clip.duration.toFixed(3)} s`);
    let level;
    if (table.level) {
      let sum = 0;
      for (let f = 0; f < clip.frames; f++) sum += clip.travel[f * 3 + 1];
      level = r(sum / clip.frames, 4);
    }
    const row = {
      id,
      file: fileName,
      frames: clip.frames,
      duration: r(clip.duration, 5),
      loop,
      travelNet: a.travelNet.map((v) => r(v, 4)),
      speed: r(a.speed, 3),
      heading: r(a.heading, 1),
      feet: a.feet,
      trimStart,
      ...(level !== undefined ? { level } : {}),
      ...(mirrorOf ? { mirrorOf } : {}),
      use: table.use && !mirrorOf,
      source,
      hash: hashOf(bytes),
    };
    rows.push(row);
    const level2 = Math.hypot(row.travelNet[0], row.travelNet[2]);
    report.push({
      id,
      frames: row.frames,
      duration: row.duration,
      loop,
      loopSaid: a.loop,
      endAngle: r(a.endAngle, 1),
      travel: r(level2, 2),
      rise: row.travelNet[1],
      speed: row.speed,
      heading: row.heading,
      marks: a.feet.length,
      use: row.use,
      trimStart,
      // Where the lower foot stands over the floor as a one-off starts, and when a foot first comes down.
      footAtStart: r(a.footHeightAt(trimStart), 3),
      firstDown: a.feet.length ? a.feet[0].t : null,
      // For a clip that travels and loops: what its feet say against what its hips did.
      travelSpeed: loop && level2 > 0.3 ? r(level2 / clip.duration, 3) : null,
      bytes: bytes.length,
      mirrorOf: mirrorOf ?? null,
      level: level ?? null,
    });
  };
  for (const c of clips) {
    const table = rowFor(c.id);
    emit(c.id, c.clip, table, c.file, null);
    if (table.mirror) emit(`${c.id}_mirrored`, mirrorClip(c.clip, names), table, c.file, c.id);
  }
  const have = new Set(clips.map((c) => c.id));
  const tableUnused = Object.keys(CLIPS).filter((id) => !have.has(id));

  const index = { format: PACK_FORMAT, fps: PACK_FPS, bones, clips: rows };
  const checked = readPackIndex(JSON.parse(JSON.stringify(index)));
  if (typeof checked === 'string') throw new Error(`the index just made cannot be read back: ${checked}`);
  // One clip a line, so a re-import's difference can be read.
  const text = `{\n  "format": ${index.format},\n  "fps": ${index.fps},\n  "bones": [\n${bones.map((b) => `    ${JSON.stringify(b)}`).join(',\n')}\n  ],\n  "clips": [\n${rows.map((c) => `    ${JSON.stringify(c)}`).join(',\n')}\n  ]\n}\n`;
  writeFileSync(join(dst, 'index.json'), text);
  // A clip the folder no longer gives leaves no file behind.
  const stale = readdirSync(dst).filter((n) => /\.mxa$/i.test(n) && !written.has(n));
  for (const n of stale) rmSync(join(dst, n));

  return { index, report, restDiffers, failed, tableUnused, stale, files: files.length, restFile: first.file, source: first.source, bytes: report.reduce((s, c) => s + c.bytes, 0) + Buffer.byteLength(text) };
}

/** The report as the lines the command prints. */
export function reportLines(result, out) {
  const lines = [];
  const { report } = result;
  lines.push(`${result.files} files read; ${report.length} clips written to ${out} (${(result.bytes / 1048576).toFixed(2)} MB), ${result.index.bones.length} bones, ${result.index.fps} frames a second.`);
  lines.push(`The rest pose is ${basename(result.restFile)}'s (${result.source.bones} bones in the file, ${result.source.fps} frames a second).`);
  lines.push('');
  lines.push('id                                   frames  seconds  loop  travel  speed  heading  marks  use');
  for (const c of report) {
    lines.push(
      `${c.id.padEnd(36)} ${String(c.frames).padStart(6)}  ${c.duration.toFixed(3).padStart(7)}  ${(c.loop ? (c.loopSaid ? 'yes' : 'yes*') : c.loopSaid ? 'no*' : 'no').padEnd(4)}  ${c.travel.toFixed(2).padStart(6)}  ${c.speed.toFixed(2).padStart(5)}  ${c.speed >= 0.1 ? c.heading.toFixed(0).padStart(7) : '      -'}  ${String(c.marks).padStart(5)}  ${c.use ? 'yes' : ''}`,
    );
  }
  lines.push('(loop with a star: the table said so over what the first and last poses say; travel is the hips\' level net displacement, metres; speed is by the planted feet, m/s; heading 0 forward, +90 left)');
  // Only a clip whose feet were measured: a hang that shuffles along a ledge travels too, on no ground.
  const travels = report.filter((c) => c.travelSpeed !== null && !c.mirrorOf && c.speed >= 0.1);
  if (travels.length) {
    lines.push('');
    lines.push('The clips that travel and loop, their feet against their hips:');
    for (const c of travels) {
      const off = c.travelSpeed > 0 ? (c.speed / c.travelSpeed - 1) * 100 : 0;
      lines.push(`  ${c.id}: ${c.travel.toFixed(2)} m in ${c.duration.toFixed(3)} s is ${c.travelSpeed.toFixed(2)} m/s; the feet say ${c.speed.toFixed(2)} (${off >= 0 ? '+' : ''}${off.toFixed(0)}%)${Math.abs(off) > 15 ? '  ** more than 15% apart' : ''}`);
    }
  }
  const starts = report.filter((c) => c.use && !c.loop);
  if (starts.length) {
    lines.push('');
    lines.push('Where each one-off the game plays starts (the lower foot over the source\'s floor at its trim, and when a foot first comes down):');
    for (const c of starts) lines.push(`  ${c.id}: from ${c.trimStart.toFixed(3)} s the foot stands ${c.footAtStart.toFixed(2)} m up${c.firstDown !== null ? `; a foot comes down at ${c.firstDown.toFixed(2)} s` : '; no foot comes down'}`);
  }
  const levelled = report.filter((c) => c.level !== null);
  for (const c of levelled) lines.push(`  ${c.id}: rides ${c.level.toFixed(2)} m over its rest height on average; the fitter takes that out.`);
  lines.push('');
  if (result.restDiffers.length) {
    lines.push('Left out, their rest pose is not the first file\'s:');
    for (const d of result.restDiffers) lines.push(`  ${d.file}: ${d.why}`);
  } else lines.push('Every file\'s rest pose is the first\'s: the same joints, each within a millimetre and a tenth of a degree.');
  for (const f of result.failed) lines.push(`Could not be read: ${f.file} (${f.why})`);
  if (result.tableUnused.length) lines.push(`The table names clips no file gave: ${result.tableUnused.join(', ')}`);
  if (result.stale.length) lines.push(`Taken away, no file gives them any more: ${result.stale.join(', ')}`);
  return lines;
}

/** Where the pack goes unless told otherwise: the checkout's own `public/anims/mixamo`. */
export function defaultOut(here) {
  return resolve(dirname(here), '..', '..', 'public', 'anims', 'mixamo');
}
