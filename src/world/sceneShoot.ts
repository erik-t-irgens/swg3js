// Rendering the owner's captured shots into the backdrops the creation and selection screens use.
//
// This is the one pass that turns seventeen compositions and sixty-seven hours into pictures. It
// runs in the game, because only the game can draw the game: the converter has the models and the
// terrain rules but not the sky, the water, the weather or the whole effects chain, and a backdrop
// that did not look like the world would be worse than no backdrop at all.
//
// Three things here are deliberate and would be easy to get wrong.
//
// **The pixels are read back, not taken off the canvas.** A WebGL canvas made without
// `preserveDrawingBuffer` -- which is every sane one, because keeping it costs a copy every frame
// forever -- may hand `toBlob` an empty picture, and whether it does depends on when the browser
// happens to composite. That failure is silent: sixty-seven black JPEGs and no error anywhere. So
// the frame is drawn and `readPixels` takes it immediately from the framebuffer, which cannot be
// wrong about what is in it.
//
// **Frames are drawn with the browser let go of in between.** Several of the effects need more
// than one frame before they are right -- the water's own visibility is a WebGL occlusion query,
// and WebGL answers one only after control has gone back to the browser, so a loop that draws ten
// frames in one task never gets an answer and the water draws with no reflection. The settle
// therefore yields to a real frame each time round.
//
// **The picture is rendered at the shot's own vertical angle.** Not wider. A perspective camera's
// vertical angle does not change with the window, so vertical margin can never be used; all the
// margin a window can ask for is sideways, and that is the aspect's. See `sceneBackdrop.ts`.

import * as THREE from 'three';
import type { SceneSpot } from '../data/scenes.ts';
import { sceneSpots, SCENE_SHOTS } from '../data/scenes.ts';
import { PLANETS } from '../data/planets.ts';
import { backdropPath, backdropRenderFor, hourLabel, type BackdropRender } from './sceneBackdrop.ts';

/**
 * The world a pack belongs to, and the zone within it if it has zones.
 *
 * A capture records the **pack** it was taken in, which is what the world calls itself; travelling
 * wants a planet and a zone. For a one-zone world those are the same word, and for a many-zoned one
 * (Kashyyyk's seven) they are not, so the answer is looked up rather than assumed.
 */
export function packPlanet(pack: string): { planet: string; zone?: string } | null {
  for (const p of PLANETS) {
    if (!p.zones?.length) {
      if (p.id === pack) return { planet: p.id };
      continue;
    }
    const z = p.zones.find((x) => x.pack === pack);
    if (z) return { planet: p.id, zone: z.id };
  }
  return null;
}

/** How wide a window the backdrops are rendered to cover. Past this they run out at the sides. */
export const SHOOT_TUNE = {
  /** Width over height of every rendered picture. 3:1 covers everything up to and including 21:9. */
  aspect: 3,
  /** The rendered height in pixels. The effects chain allocates several buffers of this size, so
   *  raising it costs video memory quadratically; 1440 is a screen's worth and is the default. */
  height: 1440,
  /** JPEG quality. A backdrop is behind a character and is not scrutinised; 0.9 is already generous. */
  quality: 0.9,
  /** Frames drawn, with the browser let go of between each, before a picture is taken. */
  settleFrames: 24,
  /** How long to wait for a world to stream in around the shot before giving up on it. */
  streamMs: 45000,
};

/**
 * What the sky was doing at the moment a picture was taken.
 *
 * Recorded rather than guessed, and it is what makes the figure belong in the shot: the live
 * character is lit by the same sun, from the same direction, in the same colour as the place
 * behind it. Without this a figure at sunset is lit at noon and reads as pasted on, however good
 * the picture is.
 */
export interface SceneLight {
  /** Unit vector toward the sun, in the world's axes, which are the shot's. */
  dir: [number, number, number];
  /** The key light's colour, as six hex digits with no hash. */
  main: string;
  /** How strong the key light stood at that hour. */
  mainScale: number;
  /** The ambient the sky filled the scene with. */
  ambient: string;
}

/** One hour of one shot, as the pass will render it. */
export interface ShootStep {
  key: string;
  /** The capture's own name, which is what the hour is keyed by. */
  name: string;
  hour: number;
  /** Where the picture goes, under the scenes folder. */
  path: string;
  /** What a button offering this hour says. */
  label: string;
  /** The sky at the moment it was taken, filled in by the pass and null until then. */
  light: SceneLight | null;
}

/** Everything to do for one world, so a world is loaded once however many shots stand in it. */
export interface ShootGroup {
  pack: string;
  spots: { spot: SceneSpot; steps: ShootStep[] }[];
}

/**
 * What the pass will do, worked out before any of it runs.
 *
 * Grouped by world and not by shot, because travelling between worlds is the expensive part: the
 * eleven captures on Corellia are two compositions in one world and must cost one load, not eleven.
 */
export function shootPlan(only?: readonly string[]): ShootGroup[] {
  const wanted = only && only.length ? new Set(only) : null;
  const groups = new Map<string, ShootGroup>();
  for (const spot of sceneSpots()) {
    if (wanted && !wanted.has(spot.key) && !wanted.has(spot.pack)) continue;
    let g = groups.get(spot.pack);
    if (!g) {
      g = { pack: spot.pack, spots: [] };
      groups.set(spot.pack, g);
    }
    g.spots.push({
      spot,
      steps: spot.hours.map((h) => ({ key: spot.key, name: h.name, hour: h.hour, path: backdropPath(spot.key, h.name), label: hourLabel(h.name, spot.key, h.hour), light: null })),
    });
  }
  return [...groups.values()];
}

/** How many pictures a plan will make, which is what the owner wants to know before starting. */
export function shootCount(plan: readonly ShootGroup[]): { worlds: number; shots: number; pictures: number } {
  let shots = 0;
  let pictures = 0;
  for (const g of plan) {
    shots += g.spots.length;
    for (const s of g.spots) pictures += s.steps.length;
  }
  return { worlds: plan.length, shots, pictures };
}

/**
 * The manifest the screens read: every shot, its camera, and where each hour's picture is. Written
 * by the pass rather than kept by hand, so a re-render at another size cannot leave the screens
 * registering against the size before it.
 */
export interface SceneManifest {
  version: number;
  render: BackdropRender;
  shots: {
    key: string;
    pack: string;
    place: string | null;
    stand: SceneSpot['stand'];
    camera: SceneSpot['camera'];
    ship: SceneSpot['ship'];
    hours: ShootStep[];
  }[];
}

export function sceneManifest(plan: readonly ShootGroup[], render: BackdropRender): SceneManifest {
  const shots: SceneManifest['shots'] = [];
  for (const g of plan) {
    for (const { spot, steps } of g.spots) {
      shots.push({ key: spot.key, pack: spot.pack, place: spot.place, stand: spot.stand, camera: spot.camera, ship: spot.ship, hours: steps });
    }
  }
  return { version: 1, render, shots };
}

/** What the pass needs of the game. Everything browser-shaped is here so the planning above is not. */
export interface ShootDeps {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  /** Draw one frame exactly as the game does, from wherever the camera now stands. */
  drawFrame: () => void;
  /** The renderer's size changed: the effects chain and the shadow cascades are told. */
  resized: () => void;
  /** The pack the world is showing now. */
  packId: () => string;
  /** Load a world by its pack id. Resolves when the pack is in. */
  goToPack: (pack: string) => Promise<void>;
  /** Stand the player at a point, so the world streams around the shot rather than around wherever they were. */
  placePlayer: (x: number, y: number, z: number) => void;
  /** Wait for everything in range of a point to be built and compiled. */
  readyAround: (at: THREE.Vector3, timeoutMs: number) => Promise<boolean>;
  /** Pin the time of day, 0 to 1. Holds the day until the pass gives it back. */
  holdDay: (t: number) => void;
  /** Let the day run again. */
  releaseDay: () => void;
  /** What the sky is doing now, read after the day has been pinned and the frames have settled. */
  readLight: () => SceneLight | null;
  /** The player's own figure, hidden while a picture is taken: the live one is drawn over the picture. */
  figure: THREE.Object3D;
  /** Say what is happening, since the pass takes minutes. */
  say: (line: string) => void;
}

export interface ShootResult {
  written: { path: string; bytes: number }[];
  failed: { path: string; why: string }[];
  seconds: number;
}

const yieldFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

/**
 * Take the picture that is on the framebuffer now.
 *
 * Read back rather than lifted off the canvas, and flipped as it is copied: GL counts rows from the
 * bottom and a 2D canvas from the top. Alpha is forced opaque, since the scene is drawn over a
 * transparent page and a backdrop must not be.
 */
async function grab(renderer: THREE.WebGLRenderer, w: number, h: number, quality: number): Promise<Blob> {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  renderer.setRenderTarget(null);
  const raw = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, raw);
  const flipped = new Uint8ClampedArray(w * h * 4);
  const stride = w * 4;
  for (let y = 0; y < h; y++) {
    const from = (h - 1 - y) * stride;
    flipped.set(raw.subarray(from, from + stride), y * stride);
  }
  for (let i = 3; i < flipped.length; i += 4) flipped[i] = 255;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context to encode the picture with');
  ctx.putImageData(new ImageData(flipped, w, h), 0, 0);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
  if (!blob) throw new Error('the picture would not encode');
  return blob;
}

/** Put a file into the scenes folder through the dev server, which is the only thing that may write there. */
async function put(path: string, body: Blob | string): Promise<number> {
  const res = await fetch(`assets-private/scenes/${path}`, { method: 'POST', body });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const said = (await res.json()) as { bytes?: number };
  return said.bytes ?? 0;
}

/**
 * Render every backdrop the plan asks for.
 *
 * The order is the plan's: one world at a time, every composition in it, every hour of each. The
 * renderer is resized once per picture rather than once per pass, because a window resize during
 * the pass would otherwise leave the rest of the pictures at the old size without saying so.
 */
export async function runShoot(deps: ShootDeps, only?: readonly string[]): Promise<ShootResult> {
  const plan = shootPlan(only);
  const counted = shootCount(plan);
  const render = backdropRenderFor(SCENE_SHOTS[0]?.camera.fov ?? 62, SHOOT_TUNE.aspect, SHOOT_TUNE.height);
  const started = performance.now();
  const written: ShootResult['written'] = [];
  const failed: ShootResult['failed'] = [];
  deps.say(`shoot: ${counted.pictures} pictures, ${counted.shots} shots, ${counted.worlds} worlds, at ${render.width} by ${render.height}`);

  // What to put back when this is over, whether it ends well or not.
  const camera = deps.camera;
  const before = {
    fov: camera.fov,
    aspect: camera.aspect,
    pos: camera.position.clone(),
    quat: camera.quaternion.clone(),
    ratio: deps.renderer.getPixelRatio(),
    size: deps.renderer.getSize(new THREE.Vector2()),
    figureVisible: deps.figure.visible,
  };
  const at = new THREE.Vector3();
  const look = new THREE.Vector3();

  try {
    for (const group of plan) {
      if (deps.packId() !== group.pack) {
        deps.say(`shoot: going to ${group.pack}`);
        await deps.goToPack(group.pack);
      }
      for (const { spot, steps } of group.spots) {
        // The player stands where the shot does, so the world streams in around the shot rather
        // than around wherever the last one left them.
        deps.placePlayer(spot.stand.x, spot.stand.y, spot.stand.z);
        at.set(spot.camera.x, spot.camera.y, spot.camera.z);
        look.set(spot.camera.look.x, spot.camera.look.y, spot.camera.look.z);
        const ready = await deps.readyAround(at, SHOOT_TUNE.streamMs);
        if (!ready) deps.say(`shoot: ${spot.key} did not finish streaming in ${(SHOOT_TUNE.streamMs / 1000) | 0}s; taking it as it stands`);

        for (const step of steps) {
          try {
            deps.holdDay(step.hour / 24);
            // The figure is taken out of the picture entirely. Three skips an invisible object
            // before the shadow pass looks at it, so this drops its shadow with it, which is what
            // is wanted: the live figure over the picture casts its own.
            deps.figure.visible = false;
            deps.renderer.setPixelRatio(1);
            deps.renderer.setSize(render.width, render.height, false);
            deps.resized();
            camera.fov = spot.camera.fov;
            camera.aspect = render.aspect;
            camera.position.copy(at);
            camera.lookAt(look);
            camera.updateProjectionMatrix();
            // Settle. Each frame gives the browser back, or the occlusion queries the water's own
            // visibility rides on are never answered and the reflections never draw.
            for (let i = 0; i < SHOOT_TUNE.settleFrames; i++) {
              camera.position.copy(at);
              camera.lookAt(look);
              deps.drawFrame();
              await yieldFrame();
            }
            camera.position.copy(at);
            camera.lookAt(look);
            deps.drawFrame();
            // Read after the settle, never before it: the sky blends its rows over several frames
            // and the light on the first frame after the hour moved is the hour before's.
            step.light = deps.readLight();
            const blob = await grab(deps.renderer, render.width, render.height, SHOOT_TUNE.quality);
            const bytes = await put(step.path, blob);
            written.push({ path: step.path, bytes });
            deps.say(`shoot: ${step.path} (${(bytes / 1048576).toFixed(2)} MB) ${written.length}/${counted.pictures}`);
          } catch (e) {
            failed.push({ path: step.path, why: String((e as Error).message ?? e) });
            deps.say(`shoot: ${step.path} failed: ${(e as Error).message ?? e}`);
          } finally {
            deps.figure.visible = before.figureVisible;
          }
        }
      }
    }
    // The manifest last, so a pass that stopped part way leaves the screens reading the pictures
    // that were really written last time rather than a list of ones that are not there.
    if (!only) {
      try {
        await put('manifest.json', JSON.stringify(sceneManifest(plan, render), null, 1));
        deps.say('shoot: manifest written');
      } catch (e) {
        failed.push({ path: 'manifest.json', why: String((e as Error).message ?? e) });
      }
    }
  } finally {
    deps.releaseDay();
    deps.figure.visible = before.figureVisible;
    deps.renderer.setPixelRatio(before.ratio);
    deps.renderer.setSize(before.size.x, before.size.y, false);
    deps.resized();
    camera.fov = before.fov;
    camera.aspect = before.aspect;
    camera.position.copy(before.pos);
    camera.quaternion.copy(before.quat);
    camera.updateProjectionMatrix();
  }
  return { written, failed, seconds: Math.round((performance.now() - started) / 100) / 10 };
}
