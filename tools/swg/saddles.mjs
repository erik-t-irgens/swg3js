// Mount saddles: where a creature's saddle hangs and what the creatures pack says of it.
//
// A rideable creature's skinned mesh carries a `saddle` hardpoint under one of its joints
// (SKMG > HPTS, read by parseMgn). For the bantha, kaadu, bol and rancor only the `_hue`
// appearance the mount tables list carries it; the plain appearance their templates name has the
// same skeleton and geometry and none, so the hardpoint is read from the listed one when both are
// built on one skeleton file. The saddle model itself is the `.apt` the tables name; every retail
// saddle has one hardpoint, `player`, which is where the rider's pelvis goes.
import { parseIff } from './iff.mjs';
import { finestLevelWithGeometry } from './lmglevel.mjs';
import { parseLmg, parseMgn, parseSat } from './skeletal.mjs';

const norm = (s) => String(s ?? '').replace(/\\/g, '/').replace(/^\//, '').toLowerCase();

/** A skeletal appearance's body hardpoints, from each mesh's finest level with geometry, and its first skeleton file. */
export function satHardpoints(vfs, satPath) {
  const read = (p) => parseIff(vfs.read(p));
  const sat = parseSat(read(satPath));
  const hardpoints = [];
  for (const name of sat.meshes) {
    try {
      let file = name;
      let mgn = null;
      if (/\.lmg$/i.test(file)) {
        if (!vfs.has(file)) continue;
        ({ file, mgn } = finestLevelWithGeometry(parseLmg(read(file)), { has: (l) => vfs.has(l), load: (l) => parseMgn(read(l)) }));
      }
      if (!file || !vfs.has(file)) continue;
      mgn ??= parseMgn(read(file));
      for (const hp of mgn.hardpoints ?? []) hardpoints.push({ ...hp, mesh: file });
    } catch {
      // A mesh that does not parse carries no hardpoint the converter could use.
    }
  }
  return { skeleton: sat.skeletons[0]?.file ?? '', hardpoints };
}

/**
 * Where a mount's saddle hangs (pure): the converted appearance's own `saddle` hardpoint, else the
 * one the mount tables' listed appearance carries when it is built on the same skeleton file
 * (compared lower-cased, slashes normalised), else none. Names compare case-insensitively.
 * `ownSat` is the converted appearance's path, returned as `from` when its own hardpoint wins.
 */
export function pickSaddleHardpoint({ own = [], ownSkeleton = '', ownSat = null, listed = [], listedSkeleton = '', listedSat = null }) {
  const saddleOf = (list) => (list ?? []).find((h) => String(h.name ?? '').toLowerCase() === 'saddle') ?? null;
  const mine = saddleOf(own);
  if (mine) return { hardpoint: mine, from: ownSat ?? '' };
  const theirs = saddleOf(listed);
  if (theirs && listedSat && norm(ownSkeleton) !== '' && norm(ownSkeleton) === norm(listedSkeleton)) return { hardpoint: theirs, from: listedSat };
  return null;
}

/** Four decimals: centimetres and better, and a manifest that reads. */
const round4 = (n) => Math.round(n * 10000) / 10000;

/**
 * The creature manifest's saddle entry (pure), or null when the tables name no `.apt` saddle
 * (a basilisk's saddle appearance is its own .sat; a creature outside the tables has none).
 * `player` is the saddle's player hardpoint as the mesh holds it (the game's space); it is
 * mirrored in X here, as the converter mirrors the saddle model.
 */
export function saddleEntry({ appearance, file = null, player = null, joint = null, from = null }) {
  if (!appearance || !/\.apt$/i.test(String(appearance))) return null;
  return {
    appearance: String(appearance).replace(/\\/g, '/'),
    file: file ?? null,
    joint: joint ?? null,
    from: joint ? (from ?? null) : null,
    player: player && player.length >= 3 ? [round4(-player[0]) || 0, round4(player[1]), round4(player[2])] : null,
  };
}

/**
 * What `status` says of a creatures manifest (pure). Counts entries with `mount: true` only, each
 * in exactly one kind, checked in this order: `stale` (converted before saddles were: a saddle
 * pose with no `saddle` entry, or a ridden mount with no `hardpoints` list at all), `onHardpoint`
 * (its own `saddle` hardpoint), `rider` (its own `player` hardpoint), `guessed` (a saddle with no
 * hardpoint, hung on the back) and `none`. `wild` counts the rest, which are never in the others.
 * `missingFiles` lists each saddle file `exists` denies.
 */
export function saddleStatus(creatures, exists = () => true) {
  const out = { onHardpoint: 0, guessed: 0, rider: 0, none: 0, wild: 0, stale: [], missingFiles: [] };
  for (const c of creatures ?? []) {
    if (c?.mount !== true) {
      out.wild++;
      continue;
    }
    const names = new Set((c.hardpoints ?? []).map((h) => String(h).toLowerCase()));
    const pose = String(c.riderPose ?? '');
    const hasSaddle = c.saddle !== undefined && c.saddle !== null;
    if ((pose.startsWith('saddle_') && !('saddle' in c)) || (pose && !Array.isArray(c.hardpoints))) out.stale.push(c.id);
    else if (names.has('saddle')) out.onHardpoint++;
    else if (names.has('player')) out.rider++;
    else if (hasSaddle) out.guessed++;
    else out.none++;
    if (hasSaddle && c.saddle.file && !exists(c.saddle.file)) out.missingFiles.push(c.saddle.file);
  }
  return out;
}
