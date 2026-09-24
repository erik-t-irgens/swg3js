// The `scenes` command: building the small worlds the creation and selection screens stand a
// character in.
//
// It converts nothing from the archives. It reads the planet packs the other commands already
// wrote and makes smaller copies for a camera that never leaves one axis, so it takes no `@SWG`
// and no `--retail-only`, and it must run *after* the worlds it draws from. **The packs are read
// and never written**: every output path goes through `sceneOut`, which refuses anything outside
// `scenes/`, so deleting that folder puts the install back exactly as it was.
//
// What is deliberately **not** baked is the light. The hour is recorded and nothing else: the game
// sets its own clock to it and lets `DayCycle` and `SwgSky` do what they always do, so the sun, the
// sky's own colours, the fog and the drifting clouds are the world's rather than a snapshot of it.
// That is the whole reason these screens are three-dimensional at all.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { placesForRoster, sceneOut, scenePlan, textureTarget, SCENE_BAKE_TUNE } from './scenebake.mjs';
import { shrinkModel } from './sceneglb.mjs';

/** The shape written to `scenes/manifest.json`; the game reads nothing else to know what it has. */
export const SCENE_FORMAT = 1;

/** Read a converted world's snapshot and the sizes of the models it names. */
export function loadPack(root, pack) {
  const dir = path.join(root, pack);
  if (!existsSync(path.join(dir, 'layout.json')) || !existsSync(path.join(dir, 'manifest.json'))) return null;
  const layout = JSON.parse(readFileSync(path.join(dir, 'layout.json'), 'utf8'));
  const man = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const models = new Map();
  for (const list of Object.values(man.categories ?? {})) {
    if (!Array.isArray(list)) continue;
    for (const m of list) {
      if (!m?.id || !m.file) continue;
      const b = m.bounds;
      // The BOX chunk stores the larger corner first, so extents are taken componentwise.
      const size = b ? Math.max(Math.abs(b.max[0] - b.min[0]), Math.abs(b.max[1] - b.min[1]), Math.abs(b.max[2] - b.min[2])) : 3;
      models.set(m.id, { size, file: path.join(dir, m.file), triangles: m.triangles ?? 0, particle: !!m.particle });
    }
  }
  return { layout, models, dir };
}

/**
 * Which places to build.
 *
 * Named keys or worlds when the command line gives them; otherwise the roster rule -- the
 * creator's three, and one place for every other world that has one.
 */
export function choosePlaces(spots, creatorKeys, only) {
  if (only && only.length) {
    const want = new Set(only);
    return spots.filter((s) => want.has(s.key) || want.has(s.pack));
  }
  const keys = new Set(placesForRoster(spots, creatorKeys, [...new Set(spots.map((s) => s.pack))]));
  return spots.filter((s) => keys.has(s.key));
}

const round = (v) => Math.round(v * 100) / 100;

/**
 * Build the scenes.
 *
 * `spots` are the captured places gathered by `sceneSpots`, `creatorKeys` the three the creator
 * offers. Everything it writes lands under `<root>/scenes/`. It reports rather than prints, so the
 * command line owns the words and a test can run the whole thing and read the numbers back.
 */
export function bakeScenes({ root, spots, creatorKeys, only = null, tune = SCENE_BAKE_TUNE, log = () => {} }) {
  const chosen = choosePlaces(spots, creatorKeys, only);
  if (!chosen.length) throw new Error('no captured place matched, so nothing would be built');

  const packs = new Map();
  const missingPacks = [];
  for (const pack of new Set(chosen.map((s) => s.pack))) {
    const p = loadPack(root, pack);
    if (p) packs.set(pack, p);
    else missingPacks.push(pack);
  }
  const ready = chosen.filter((s) => packs.has(s.pack));
  if (!ready.length) throw new Error(`none of those worlds is converted yet (${missingPacks.join(', ')})`);
  const plan = scenePlan(ready, packs, tune);

  // A rebuild starts clean: a place dropped from the list, or a model no longer in shot, must not
  // be left behind pretending to belong to this bake.
  const base = sceneOut(root, '.');
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });

  let bytesBefore = 0;
  let bytesAfter = 0;
  let shrunk = 0;
  const failed = [];
  for (const [key, want] of plan.pool) {
    const model = packs.get(want.pack)?.models.get(want.model);
    if (!model) {
      failed.push({ key, why: 'the pack no longer carries it' });
      continue;
    }
    try {
      const src = readFileSync(model.file);
      bytesBefore += src.length;
      const out = shrinkModel(src, (sourceDim, isMask) => {
        const target = textureTarget(sourceDim, want.pixels, tune);
        // A cut-out gets a floor of its own: averaging alpha down is what thins a frond away.
        return isMask ? Math.max(target, Math.min(sourceDim, tune.maskMinTexture)) : target;
      });
      const dest = sceneOut(root, 'models', want.pack, `${want.model}.glb`);
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, out.buf);
      bytesAfter += out.buf.length;
      shrunk += out.images.filter((i) => i.to !== undefined && i.from !== undefined && i.to < i.from).length;
    } catch (e) {
      failed.push({ key, why: String(e?.message ?? e) });
    }
  }

  const places = [];
  for (const p of plan.places) {
    const spot = ready.find((s) => s.key === p.key);
    const doc = {
      key: p.key,
      pack: p.pack,
      place: spot.place ?? null,
      stand: spot.stand,
      camera: spot.camera,
      ship: spot.ship ?? null,
      hours: spot.hours.map((h) => ({ name: h.name, hour: h.hour })),
      // Each instance is in the place's own frame, so the active place always sits at the world
      // origin and nothing is ever far enough out for a float to lose centimetres.
      instances: p.instances.map((i) => ({ m: `${p.pack}/${i.model}`, p: [round(i.x), round(i.y), round(i.z)], q: i.q })),
      // The placed particle effects, kept with their places. Nothing draws them yet: they are not
      // meshes, so there is nothing here to shrink, and recording them is what lets whatever draws
      // them later do it without another bake.
      effects: p.effects.map((i) => ({ m: `${p.pack}/${i.model}`, p: [round(i.x), round(i.y), round(i.z)], q: i.q })),
    };
    writeFileSync(sceneOut(root, `${p.key}.json`), JSON.stringify(doc));
    places.push({ key: p.key, pack: p.pack, instances: p.instances.length, effects: p.effects.length, models: p.nearest.size, dropped: p.dropped });
    log(`scenes: ${p.key} — ${p.instances.length} instances, ${p.nearest.size} models${p.effects.length ? `, ${p.effects.length} effects recorded` : ''}`);
  }

  const manifest = {
    format: SCENE_FORMAT,
    // Stated so the game can tell a scene built for a narrower window than the one it is drawn in.
    builtFor: { aspect: tune.aspect, fovPad: tune.fovPad, quality: tune.quality, cullPixels: tune.cullPixels },
    creator: creatorKeys.filter((k) => places.some((p) => p.key === k)),
    places,
    /**
     * The planet packs these scenes lean on, which they read rather than copy.
     *
     * Only the placed objects needed shrinking: they carry textures sized for walking up to a
     * wall, and a fixed camera never does. The ground, the sky, the water, the flora and the
     * particle effects need no such thing -- they are already small, they are already on the disk
     * beside this, and copying them would have added 12 to 27 MB a world to say the same thing
     * twice. So a scene names its world and the game loads that world's own terrain rules, sky and
     * effects exactly as it does in play, which is also what keeps the clouds moving.
     */
    packs: [...new Set(places.map((p) => p.pack))],
    models: plan.pool.size,
    bytes: bytesAfter,
  };
  writeFileSync(sceneOut(root, 'manifest.json'), JSON.stringify(manifest, null, 1));
  return { manifest, bytesBefore, bytesAfter, shrunk, failed, missingPacks };
}
