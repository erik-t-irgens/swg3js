// Working out what is in a creation or selection scene, and how big each of its textures needs to be.
//
// A scene is one of the owner's captured places (`src/data/scenes.ts`) rebuilt as a small world of
// its own: the character stands in it for real, so the sun of that hour lights them, the animated
// surfaces animate and the clouds move. What makes it small is that **the camera never leaves one
// axis**. It zooms in and out along the line the shot was captured on and nothing else, so what can
// ever be seen is a single frustum, and every texture in it is only ever viewed at one distance.
//
// Three measurements decided the shape of this, taken over the owner's own converted packs:
//
// - **77% of the bytes in these models are texture**, sized for walking up to a wall. Sizing each
//   one to the pixels it really covers takes the three creator places from 348 MB to 148 MB with
//   nothing visible changing.
// - **Culling harder barely helps.** Going from a 3-pixel to a 10-pixel cull drops 44% of the
//   models and 10% of the bytes: the weight is a handful of big near things no cull touches, and
//   geometry, which is the floor. So the cull is tuned for the *number* of models -- which is what
//   costs decodes and shader programs -- and the texture sizing is what is tuned for bytes.
// - **Places share models.** Seventeen places name 1,553 models between them and only 1,288 of
//   them are distinct, so the pool below is shared and a model is written once however many places
//   stand on it.
//
// Everything here is pure arithmetic over plain objects, so the node test runs the real rules
// rather than a mirror of them, and the converter is the only thing that touches a file.

import path from 'node:path';

/**
 * The one folder the bake may write into, under the assets root.
 *
 * **The planet packs are read and never written.** A scene's textures are re-encoded smaller,
 * which would be a catastrophe done in place: the world you actually play would quietly lose its
 * detail, with no way back short of converting every planet again. So the bake reads the packs and
 * writes copies here, and `sceneOut` below is the only thing in the converter that names an output
 * file, so there is nowhere else for a careless line to put one. Deleting this folder puts
 * everything back exactly as it was, which is the same promise every other optional pack makes.
 */
export const SCENES_DIR = 'scenes';

/**
 * Where a baked file goes: under the assets root, under `scenes`, and nowhere else.
 *
 * Refuses rather than sanitises. A part that climbs out, an absolute path, or a root that is not a
 * real place are all mistakes in the caller, and quietly rewriting them into something safe would
 * hide the mistake while the next one goes unchecked.
 */
export function sceneOut(root, ...parts) {
  if (typeof root !== 'string' || !root) throw new Error('the assets root is required');
  for (const p of parts) {
    if (typeof p !== 'string' || !p) throw new Error(`a path part must be a non-empty string, not ${JSON.stringify(p)}`);
    if (path.isAbsolute(p)) throw new Error(`a path part may not be absolute: ${p}`);
  }
  const base = path.resolve(root, SCENES_DIR);
  const full = path.resolve(base, ...parts);
  // `relative` is the honest test: it answers '..' or an absolute path for anything outside.
  const rel = path.relative(base, full);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`a scene may only be written under ${SCENES_DIR}/, not ${full}`);
  return full;
}

/**
 * Whether a path is one of the converted packs the bake reads. Nothing here ever opens one of
 * these for writing; this exists so the command can say plainly what it is reading and a test can
 * hold it to the line.
 */
export function isSourcePack(root, file) {
  const base = path.resolve(root);
  const scenes = path.resolve(base, SCENES_DIR);
  const full = path.resolve(file);
  const inRoot = !path.relative(base, full).startsWith('..');
  const inScenes = !path.relative(scenes, full).startsWith('..') && path.relative(scenes, full) !== '';
  return inRoot && !inScenes;
}

/**
 * Every invented number of the bake. None of these is the client's: the client never had a fixed
 * camera to size anything for. Live through the `scenes` command's own options.
 */
export const SCENE_BAKE_TUNE = {
  /**
   * How many pixels tall a thing must be, on a 1440-line screen, to be worth carrying. Below this
   * it is dropped. Chosen for the model count rather than the bytes, for the reason above.
   */
  cullPixels: 6,
  /**
   * Texels per pixel. 1 is a texel for every pixel the model covers, which is as sharp as the
   * source can be; the owner asked for soft distant detail, and 0.35 is that without the near
   * things going obviously soft.
   */
  quality: 0.35,
  /**
   * The widest window a scene is built for. Past this the cull's own edge comes into view, which
   * is the one failure here nobody could miss.
   *
   * 3.8 covers a 32:9 super-ultrawide with room to spare, and it is generous on purpose: measured
   * over the three creator places, widening all the way from 16:9 to 4.2:1 costs 9% more instances
   * and 11% more models, because what is added is only ever a sliver at each side. **A narrower
   * window needs no thought at all**: a perspective camera holds its vertical angle fixed and lets
   * the aspect widen the horizontal, so a taller window shows the same 62 degrees up and down and
   * strictly less across. Every window narrower than this one is a subset of it.
   */
  aspect: 3.8,
  /**
   * How much wider than the shot's own field of view to build, on both axes.
   *
   * The shot was captured at the owner's own setting and the creator's camera uses the shot's
   * angle, not the player's current one, so the two agree by construction. This is margin against
   * that stopping being true -- somebody raising the field of view in the settings, or a later
   * screen framing a little looser -- and at these prices it is cheaper than a rebake.
   */
  fovPad: 1.15,
  /** The screen the pixel rules are reckoned against. */
  screenHeight: 1440,
  /** No texture is shrunk below this, however far off the thing is: a 4-pixel wall reads as a colour. */
  minTexture: 16,
  /** Nothing is carried past this, whatever its size: the far haze swallows it. */
  farCap: 9000,
  /** How far past its own extent an object may sit outside the frustum and still be kept, in metres. */
  edgePad: 60,
};

/**
 * The six inward-facing planes of a shot's view.
 *
 * Built from the captured camera and look-at point rather than a matrix, so this needs no three and
 * no browser. The camera's right is taken against world up exactly as `lookAt` does, which is what
 * the game will use when it puts the camera back.
 */
export function frustumPlanes(camera, look, fov, aspect, far) {
  const f = { x: look.x - camera.x, y: look.y - camera.y, z: look.z - camera.z };
  const fl = Math.hypot(f.x, f.y, f.z) || 1;
  f.x /= fl;
  f.y /= fl;
  f.z /= fl;
  let r = { x: -f.z, y: 0, z: f.x };
  const rl = Math.hypot(r.x, r.y, r.z) || 1;
  r = { x: r.x / rl, y: r.y / rl, z: r.z / rl };
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  const tv = Math.tan((fov * Math.PI) / 360);
  const th = tv * aspect;
  const planes = [];
  const norm = (v) => {
    const l = Math.hypot(v.x, v.y, v.z) || 1;
    return { x: v.x / l, y: v.y / l, z: v.z / l };
  };
  const add = (n, p) => planes.push({ n, d: -(n.x * p.x + n.y * p.y + n.z * p.z) });
  add(f, { x: camera.x + f.x * 0.05, y: camera.y + f.y * 0.05, z: camera.z + f.z * 0.05 });
  add({ x: -f.x, y: -f.y, z: -f.z }, { x: camera.x + f.x * far, y: camera.y + f.y * far, z: camera.z + f.z * far });
  add(norm({ x: f.x + r.x / th, y: f.y + r.y / th, z: f.z + r.z / th }), camera);
  add(norm({ x: f.x - r.x / th, y: f.y - r.y / th, z: f.z - r.z / th }), camera);
  add(norm({ x: f.x + u.x / tv, y: f.y + u.y / tv, z: f.z + u.z / tv }), camera);
  add(norm({ x: f.x - u.x / tv, y: f.y - u.y / tv, z: f.z - u.z / tv }), camera);
  return planes;
}

/** Whether a point is inside every plane, allowed to sit `pad` metres outside each. */
export function inFrustum(planes, p, pad = 0) {
  for (const pl of planes) if (pl.n.x * p.x + pl.n.y * p.y + pl.n.z * p.z + pl.d < -pad) return false;
  return true;
}

/** How many pixels tall a thing of this size stands at this distance, on the reckoning screen. */
export function pixelSpan(size, distance, fov = 62, screenHeight = SCENE_BAKE_TUNE.screenHeight) {
  const perPixel = (2 * Math.tan((fov * Math.PI) / 360)) / Math.max(1, screenHeight);
  return size / Math.max(0.001, distance) / perPixel;
}

/**
 * The size to re-encode a texture at: a power of two, never larger than the source and never below
 * the floor.
 *
 * Powers of two on purpose. A texture halved repeatedly keeps its mip chain exact and resamples
 * cleanly, where an arbitrary size resamples every texel and costs more than it saves.
 */
export function textureTarget(sourceDim, pixels, tune = SCENE_BAKE_TUNE) {
  const src = Math.max(1, Math.round(sourceDim));
  const want = Math.max(tune.minTexture, pixels * tune.quality);
  let dim = tune.minTexture;
  while (dim < want && dim < src) dim *= 2;
  return Math.min(src, dim);
}

/**
 * The snapshot frame is mirrored in X and centred on the layout's middle, exactly as
 * `LayoutStreamer` does it. Stated once here so the bake and the game cannot disagree about where
 * a thing stands.
 */
export function placedAt(o, centre) {
  return { x: -(o.x - centre.x), y: o.y, z: o.z - centre.z };
}

/**
 * What one place is made of: every instance the fixed camera can see, and how close each distinct
 * model is ever seen.
 *
 * `models` maps a model id to `{ size }` -- the widest extent of its own box, which is what decides
 * how many pixels it covers. `layout` is the planet's snapshot as the pack carries it.
 */
export function planPlace(spot, layout, models, tune = SCENE_BAKE_TUNE) {
  const cam = spot.camera;
  // Built wider than the shot on both axes, and at the widest window planned for. The pixel rules
  // below still use the shot's **own** angle, because how big a thing really looks is a fact about
  // the shot and not about how much margin the cull was given.
  const built = Math.min(170, cam.fov * (tune.fovPad ?? 1));
  const planes = frustumPlanes(cam, cam.look, built, tune.aspect, tune.farCap);
  const instances = [];
  const nearest = new Map();
  let dropped = 0;
  let missing = 0;
  for (const o of layout.objects) {
    // A thing inside a building is never seen from out here: the building's own shell hides it.
    if (o.contained) continue;
    const m = models.get(o.model);
    if (!m) {
      missing++;
      continue;
    }
    const at = placedAt(o, layout.center);
    const d = Math.hypot(at.x - cam.x, at.y - cam.y, at.z - cam.z);
    if (d > 1 && pixelSpan(m.size, d, cam.fov, tune.screenHeight) < tune.cullPixels) {
      dropped++;
      continue;
    }
    if (!inFrustum(planes, at, Math.min(m.size, tune.edgePad))) {
      dropped++;
      continue;
    }
    // Kept in the place's own frame, with the standing spot as the origin: the active place always
    // sits at the world origin, so nothing is ever far enough out for a float to lose centimetres.
    instances.push({ model: o.model, x: at.x - spot.stand.x, y: at.y - spot.stand.y, z: at.z - spot.stand.z, q: o.q });
    const px = pixelSpan(m.size, Math.max(1, d), cam.fov, tune.screenHeight);
    nearest.set(o.model, Math.max(nearest.get(o.model) ?? 0, px));
  }
  return { key: spot.key, pack: spot.pack, instances, nearest, dropped, missing };
}

/**
 * The whole bake: the places asked for, and the one pool of models they share.
 *
 * A model wanted by two places is written once, at the **larger** of the two sizes, because the
 * place that sees it closest is the one that decides. That is why the pool is worked out across
 * every place before a single file is written.
 */
export function scenePlan(spots, packs, tune = SCENE_BAKE_TUNE) {
  const places = [];
  /** model id -> { pack, pixels } */
  const pool = new Map();
  for (const spot of spots) {
    const pack = packs.get(spot.pack);
    if (!pack) continue;
    const plan = planPlace(spot, pack.layout, pack.models, tune);
    places.push(plan);
    for (const [id, px] of plan.nearest) {
      const key = `${spot.pack}/${id}`;
      const had = pool.get(key);
      if (!had || px > had.pixels) pool.set(key, { pack: spot.pack, model: id, pixels: px });
    }
  }
  return { places, pool, tune };
}

/**
 * Which places a given roster needs resident.
 *
 * The owner's rule, and the reason the bake is affordable at all: the creator offers three places,
 * and the selection screen only ever shows a character on the world it is really standing on. So
 * what must be in memory at once is those three plus one place per world any saved character is
 * on -- typically four to six, not every world in the game. A character on a world with no place
 * falls back to the plain doll, which is what every screen did before any of this.
 */
export function placesForRoster(spots, creatorKeys, characterPacks) {
  const want = new Set(creatorKeys);
  const byPack = new Map();
  for (const s of spots) if (!byPack.has(s.pack)) byPack.set(s.pack, s.key);
  // A creator place already covers its own world, so a character standing there adds nothing.
  const covered = new Set(spots.filter((s) => want.has(s.key)).map((s) => s.pack));
  for (const pack of characterPacks) {
    if (covered.has(pack)) continue;
    const key = byPack.get(pack);
    if (key) want.add(key);
  }
  return [...want];
}
