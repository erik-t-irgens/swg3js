// The racing motion blur (2026-11-08): what the camera follows kept sharp by its own pixels (the mask) in the race view
// and a flown ship's chase, the race view's longer streaks, and its dials. The real velocity product and the real motion
// blur pass are built here with a stand-in renderer that records every draw and what each draw's uniforms held, over a
// small scene of the game's own shapes (a pod of two rigid meshes followed, the player on it, a vehicle passing). Held:
// the rule's table; the product drawing the whole of what is followed at nought under the mask and nothing of it
// otherwise; a mask with a hole (a part first seen, a follow over its draws) falling back to the cut for that frame; the
// pass reading the mask for the frame it draws, the race view's own K, taps, shutter and strength, the tile targets
// drawn into as far as that K needs; the dials moving the real table; and, against b4bfa5c's own three modules out of
// git, every view but the race view and the chase drawing exactly what it drew before.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { ACTOR_LAYER } from '../../../src/world/portalRender.ts';
import { FxMoverList, VelocityProduct } from '../../../src/core/fx/velocity.ts';
import { MotionBlurPass } from '../../../src/core/fx/motionBlur.ts';
import {
  FOLLOW_RULES,
  MAX_TILE_K,
  MOTION_TUNING,
  MOVER_LIMITS,
  blurRadiusFor,
  classifyMover,
  clamp,
  maskCut,
  masksFollowed,
  maxBlurRadiusPx,
  raceBlurRadiusPx,
  staticCut,
  tuneMotion,
  type FollowView,
  type MoverFacts,
} from '../../../src/core/fx/velocityMath.ts';
import { MOTION_DIALS } from '../../../src/core/fx/motionDials.ts';
import { vehicleDialsFor } from '../../../src/vehicles/raceDials.ts';
import { allDials, movedArgs, resetDials } from '../../../src/ui/dials.ts';
import { loadOldMany } from './oldModules.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const SHIPPED = JSON.parse(JSON.stringify(MOTION_TUNING)) as typeof MOTION_TUNING;
const restore = () => Object.assign(MOTION_TUNING, JSON.parse(JSON.stringify(SHIPPED)));

// ---- 1. The rule, the radii and the setter. ----
{
  const views: FollowView[] = ['race', 'chase', 'third', 'other'];
  const want: Record<string, boolean[]> = { auto: [true, true, false, false], cut: [false, false, false, false], mask: [true, true, true, false] };
  ok(FOLLOW_RULES.every((r) => views.every((v, i) => masksFollowed(r, v) === want[r][i])), 'auto masks the race view and the chase alone, cut nothing, mask every view from outside; first person and the cockpit never');
  ok(MOTION_TUNING.followRule === 'auto', 'the rule ships as auto');
  const c = maskCut({ x: -1, y: -1 });
  ok(c.x === MOTION_TUNING.maskCut[0] && c.y === MOTION_TUNING.maskCut[1] && c.x < c.y, "the mask's cut is the tune's, in order for the shaders' smoothstep");
  ok(raceBlurRadiusPx(900) === Math.round(MOTION_TUNING.raceRadiusOfHeight * 900) && raceBlurRadiusPx(100) === 8 && raceBlurRadiusPx(4000) === MAX_TILE_K, 'the race K is its share of the height, held to 8..128');
  ok(raceBlurRadiusPx(900) > maxBlurRadiusPx(900) && raceBlurRadiusPx(1440) > maxBlurRadiusPx(1440), "the race view's streaks start longer than every other view's");
  ok(blurRadiusFor('race', 900) === raceBlurRadiusPx(900) && blurRadiusFor('chase', 900) === maxBlurRadiusPx(900) && blurRadiusFor('third', 1440) === 36, "only the race view takes the race K; a chase keeps the game's");
  ok(tuneMotion({ followRule: 'nope' }).length === 1 && MOTION_TUNING.followRule === 'auto', 'a rule that is not one of the three is refused in words and nothing moves');
  ok(tuneMotion({ maskCutNear: 2, maskCutFull: 1 }).length === 1 && MOTION_TUNING.maskCut[0] === SHIPPED.maskCut[0], 'a mask cut out of order is refused');
  ok(tuneMotion({ raceShutter: 0 }).length === 1 && tuneMotion({ raceRadiusOfHeight: -1 }).length === 1 && tuneMotion({ raceStrength: -0.1 }).length === 1, 'a shutter of nought, a radius under nought and a strength under nought are refused');
  ok(tuneMotion({ followRule: 'mask', maskCutFull: 3, raceSamples: 99, raceStrength: 0 }).length === 0 && MOTION_TUNING.followRule === 'mask' && MOTION_TUNING.maskCut[1] === 3 && MOTION_TUNING.raceSamples === 32 && MOTION_TUNING.raceStrength === 0, 'good values are taken, the taps held to 32, a strength of nought allowed');
  restore();
  const base: MoverFacts = { kind: 'ridden', carried: true, hidden: false, inFrustum: true, historyValid: true, moved: 1, dt: 1 / 60, speed: 60, turn: 0, animated: 0, screenRadiusPx: 1 };
  ok(classifyMover({ ...base, mask: true }) === 'all' && classifyMover(base) === 'still' && classifyMover({ ...base, animated: 2 }) === 'animated', 'under the mask what the camera follows draws all of itself, never small; without it only its moving parts');
  ok(classifyMover({ ...base, mask: true, historyValid: false }) === 'fresh' && classifyMover({ ...base, mask: true, moved: 61 }) === 'jump', 'a follow with no history or one that jumped is no mask that frame');
}

// ---- 2. The dials move the real table through the setter. ----
{
  ok(vehicleDialsFor('motionTune') === MOTION_DIALS && MOTION_DIALS.helper === 'motionTune', 'the debug menu finds the motion blur dials under motionTune');
  const dials = allDials(MOTION_DIALS);
  ok(['raceShutter', 'raceStrength', 'raceRadiusOfHeight', 'raceSamples', 'followRule', 'maskCutNear', 'maskCutFull'].every((k) => dials.some((d) => d.key === k)), 'the race view shutter, strength, streak and taps, the rule and the mask cut are dials');
  for (const d of dials) if (d.kind === 'number') d.set(Math.min(d.max, Math.max(d.min, d.get() * 1.5 + d.step)));
  const rule = dials.find((d) => d.key === 'followRule');
  if (rule?.kind === 'choice') rule.set('cut');
  ok(MOTION_TUNING.followRule === 'cut' && MOTION_TUNING.raceShutter !== SHIPPED.raceShutter && MOTION_TUNING.raceStrength !== SHIPPED.raceStrength && MOTION_TUNING.raceRadiusOfHeight !== SHIPPED.raceRadiusOfHeight, 'moving them writes MOTION_TUNING');
  const line = movedArgs(MOTION_DIALS);
  ok(/raceShutter:/.test(line) && /followRule: 'cut'/.test(line) && /maskCutFull:/.test(line), `the line they copy out is motionTune's own argument (${line.slice(0, 80)}...)`);
  resetDials(MOTION_DIALS);
  ok(JSON.stringify(MOTION_TUNING) === JSON.stringify(SHIPPED), 'reset puts every one back where the game shipped it');
  restore();
}

// ---- The stand-in renderer and the scene. ----
interface Draw { name: string; followed: number | null; cut: [number, number]; moving: number; prev: number[]; carry: number[]; world: number[]; mv: number[]; alphaMap: unknown; alphaTest: unknown }
interface Quad { material: string; target: string; viewport: number[] }
function stubRenderer(log: { draws: Draw[]; quads: Quad[] }) {
  const props = new WeakMap<object, object>();
  let rt: THREE.WebGLRenderTarget | null = null;
  const r = {
    info: { programs: [] as unknown[] },
    properties: { get: (m: object) => props.get(m) ?? (props.set(m, { currentProgram: { getUniforms() {}, diagnostics: { runnable: true } } }), props.get(m)!) },
    compile() {},
    getRenderTarget: () => rt,
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => {
      rt = t;
    },
    getClearColor: (c: THREE.Color) => c.set(0, 0, 0),
    getClearAlpha: () => 1,
    setClearColor() {},
    clear() {},
    render(scene: THREE.Object3D, camera: THREE.Camera) {
      if ((scene as THREE.Scene).isScene) scene.onAfterRender(r as unknown as THREE.WebGLRenderer, scene as THREE.Scene, camera, null as never, null as never, null as never);
      else log.quads.push({ material: ((scene as THREE.Mesh).material as THREE.Material).name, target: rt?.texture.name ?? 'screen', viewport: rt ? rt.viewport.toArray() : [] });
    },
    renderBufferDirect(_c: THREE.Camera, _s: THREE.Scene, _g: THREE.BufferGeometry, m: THREE.ShaderMaterial, o: THREE.Object3D) {
      const u = m.uniforms;
      log.draws.push({ name: o.name, followed: u.uFollowed ? (u.uFollowed.value as number) : null, cut: [u.uCut.value.x, u.uCut.value.y], moving: u.uMoving.value as number, prev: [...(u.uPrev.value as THREE.Matrix4).elements], carry: [...(u.uCarry.value as THREE.Matrix4).elements], world: [...o.matrixWorld.elements], mv: [...o.modelViewMatrix.elements], alphaMap: u.uAlphaMap?.value ?? null, alphaTest: u.uAlphaTest?.value ?? null });
    },
  };
  return r;
}

function box(name: string, s: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshStandardMaterial());
  m.name = name;
  m.layers.enable(ACTOR_LAYER);
  return m;
}

function makeWorld() {
  const scene = new THREE.Scene();
  const pod = new THREE.Group();
  pod.name = 'pod';
  const body = box('pod.body', 2);
  const engine = box('pod.engine', 1);
  engine.position.set(1.5, 0, -2);
  pod.add(body, engine);
  const player = new THREE.Group();
  player.name = 'player';
  const figure = box('player.figure', 0.6);
  figure.position.y = 1.2;
  player.add(figure);
  const other = new THREE.Group();
  other.name = 'other';
  other.add(box('other.hull', 2));
  scene.add(pod, player, other);
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 9000);
  const collect = (out: FxMoverList) => {
    out.add(player, true, 'player');
    out.add(pod, true, 'ridden');
    out.add(other, false, 'vehicle');
  };
  return { scene, pod, player, other, engine, camera, collect };
}

type World = ReturnType<typeof makeWorld>;
const W = 1600;
const H = 900;
const depth = new THREE.DepthTexture(W, H);

function makeCtx(r: unknown, cam: THREE.PerspectiveCamera) {
  return {
    renderer: r,
    settings: { motionBlurStrength: 0.35, motionBlurObjects: true },
    camera: cam,
    dt: 1 / 60,
    frame: 0,
    width: W,
    height: H,
    near: cam.near,
    far: cam.far,
    view: new THREE.Matrix4(),
    proj: new THREE.Matrix4(),
    viewProj: new THREE.Matrix4(),
    invViewProj: new THREE.Matrix4(),
    prevView: new THREE.Matrix4(),
    prevProjView: new THREE.Matrix4(),
    tanHalfFov: new THREE.Vector2(),
    followFar: 0,
    followView: 'other' as FollowView,
    cameraCut: false,
    products: { velocity: null as THREE.Texture | null },
    depth,
  };
}
type Ctx = ReturnType<typeof makeCtx>;

/** A frame of a pod at 60 m/s with the camera trailing 12 m behind and 3 up, the other vehicle crossing 30 m ahead. */
function stepWorld(w: World, ctx: Ctx, f: number, view: FollowView): void {
  const z = -f;
  w.pod.position.set(0, 0, z);
  w.player.position.set(0, 0.5, z);
  w.other.position.set(-20 + f * 0.8, 0, z - 30);
  w.scene.updateMatrixWorld(true);
  w.camera.position.set(0, 3, z + 12);
  w.camera.lookAt(0, 1, z);
  w.camera.updateMatrixWorld(true);
  ctx.prevView.copy(f === 0 ? w.camera.matrixWorldInverse : ctx.view);
  ctx.view.copy(w.camera.matrixWorldInverse);
  ctx.proj.copy(w.camera.projectionMatrix);
  ctx.viewProj.multiplyMatrices(ctx.proj, ctx.view);
  ctx.invViewProj.copy(ctx.viewProj).invert();
  ctx.prevProjView.multiplyMatrices(ctx.proj, ctx.prevView);
  ctx.tanHalfFov.set(1 / ctx.proj.elements[0], 1 / ctx.proj.elements[5]);
  ctx.frame = f;
  ctx.followFar = 12 + 4;
  ctx.followView = view;
}

interface Rig {
  w: World;
  ctx: Ctx;
  log: { draws: Draw[]; quads: Quad[] };
  product: VelocityProduct;
  pass: MotionBlurPass;
}
type ProductCtor = new (postfx: unknown, collect: (out: FxMoverList) => void) => VelocityProduct;
type PassCtor = new () => MotionBlurPass;

function makeRig(Product: ProductCtor, Pass: PassCtor, dress?: (w: World) => void): Rig {
  const log = { draws: [] as Draw[], quads: [] as Quad[] };
  const r = stubRenderer(log);
  const w = makeWorld();
  dress?.(w);
  const postfx = { ctx: { renderer: r }, size: new THREE.Vector2(W, H), sceneDepth: depth };
  const product = new Product(postfx, w.collect);
  const pass = new Pass();
  (pass as { objects: boolean }).objects = true;
  (pass as { velocity?: unknown }).velocity = product;
  pass.setSize(W, H, {} as never);
  return { w, ctx: makeCtx(r, w.camera), log, product, pass };
}

/** One frame as the chain runs it: the product, then the pass prepared and drawn. Returns this frame's draws and quads. */
function frame(rig: Rig, f: number, view: FollowView): { draws: Draw[]; quads: Quad[] } {
  rig.log.draws.length = 0;
  rig.log.quads.length = 0;
  stepWorld(rig.w, rig.ctx, f, view);
  const ctx = rig.ctx as unknown as Parameters<VelocityProduct['render']>[0];
  rig.product.render(ctx);
  rig.ctx.products.velocity = rig.product.empty ? null : rig.product.texture;
  rig.pass.prepare(ctx);
  const target = new THREE.WebGLRenderTarget(1, 1);
  rig.pass.render(ctx, target, null);
  return { draws: rig.log.draws.slice(), quads: rig.log.quads.slice() };
}

const U = (p: MotionBlurPass, name: string) => (p as unknown as Record<string, Record<string, { value: unknown }>>)[name];

// ---- 3. The product and the pass under the rule. ----
{
  const rig = makeRig(VelocityProduct as unknown as ProductCtor, MotionBlurPass);
  for (let f = 0; f < 3; f++) frame(rig, f, 'race');
  const a = frame(rig, 3, 'race');
  const followed = a.draws.filter((d) => d.name.startsWith('pod.') || d.name.startsWith('player.'));
  const other = a.draws.filter((d) => d.name.startsWith('other.'));
  ok(rig.product.masked && rig.product.maskedOn(3) && !rig.product.maskedOn(2), 'in the race view the follow is a whole mask, for the frame being drawn alone');
  ok(followed.length === 3 && followed.every((d) => d.followed === 1), 'every mesh of the pod and its rider is drawn, at nought (uFollowed 1)');
  ok(followed.every((d) => d.cut[0] === MOTION_TUNING.maskCut[0] && d.cut[1] === MOTION_TUNING.maskCut[1]), "the product's cut is the mask's, not pushed past the follow");
  ok(other.length === 1 && other[0].followed === 0, 'a vehicle passing is drawn with its own motion, never as the follow');
  const ru = U(rig.pass, 'resolveU');
  const cut = ru.uCut.value as THREE.Vector2;
  ok(rig.pass.lastMasked && cut.x === MOTION_TUNING.maskCut[0] && cut.y === MOTION_TUNING.maskCut[1], "the pass reads the mask for this frame and the reprojection's cut shrinks to the lens");
  const kr = raceBlurRadiusPx(H);
  ok(ru.uMaxRadius.value === kr && rig.pass.tileSize === kr, `the race view smears up to its own K (${kr} px at ${H})`);
  const tw = Math.ceil(W / kr);
  const th = Math.ceil(H / kr);
  const tiles = a.quads.filter((q) => q.target === 'fx.motionBlur.tilesX' || q.target === 'fx.motionBlur.tiles' || q.target === 'fx.motionBlur.neighbours');
  ok(tiles.length === 3 && tiles[0].viewport.join() === `0,0,${tw},${H}` && tiles[1].viewport.join() === `0,0,${tw},${th}` && tiles[2].viewport.join() === `0,0,${tw},${th}`, 'the tile draws are cut to the tiles its K makes');
  const gu = U(rig.pass, 'gatherU');
  const nu = U(rig.pass, 'neighbourU');
  ok((gu.uTiles.value as THREE.Vector2).x === tw && (nu.uTiles.value as THREE.Vector2).y === th && gu.uK.value === kr, 'the neighbour max and the gather are told how many tiles there are, never the target');
  ok(gu.uSamples.value === MOTION_TUNING.raceSamples, "the gather takes the race view's taps");
  const s0 = ru.uScale.value as number;
  ok(s0 === 0.35 * MOTION_TUNING.raceStrength * (MOTION_TUNING.raceShutter / (1 / 60)), "the scale is the setting's strength times the race view's, over its shutter");
  tuneMotion({ raceStrength: 2, raceShutter: 1 / 30 });
  frame(rig, 4, 'race');
  ok(ru.uScale.value === 0.35 * 2 * ((1 / 30) / (1 / 60)), "the race view's strength and shutter move its scale");
  frame(rig, 5, 'third');
  ok(ru.uScale.value === 0.35 * clamp(MOTION_TUNING.shutter / (1 / 60), 0.25, 2), 'and nothing of any other view');
  restore();
  // A radius is the field's uv per frame times uScale, and a fixed speed moves dt of it a frame: in the race view uScale
  // times dt must not move with the frame rate, whatever the Shutter (at 144 Hz a ratio held to twice the frame read
  // 1/60 as 1/72 and every Shutter past it as nothing more). Every other view keeps the game's hold, as b4bfa5c.
  {
    const raceCtx = rig.ctx as unknown as Parameters<MotionBlurPass['prepare']>[0];
    for (const shutter of [1 / 60, 1 / 30]) {
      tuneMotion({ raceShutter: shutter });
      const per: number[] = [];
      for (const dt of [1 / 30, 1 / 60, 1 / 144]) {
        rig.ctx.dt = dt;
        rig.ctx.followView = 'race';
        rig.pass.prepare(raceCtx);
        per.push((ru.uScale.value as number) * dt);
      }
      const want = 0.35 * MOTION_TUNING.raceStrength * shutter;
      ok(per.every((p) => Math.abs(p / want - 1) < 1e-12), `race shutter 1/${Math.round(1 / shutter)}: the same streak a second at 30, 60 and 144 frames (${per.map((p) => p.toFixed(6)).join(', ')})`);
    }
    rig.ctx.dt = 1 / 144;
    rig.ctx.followView = 'third';
    rig.pass.prepare(raceCtx);
    ok(ru.uScale.value === 0.35 * 2, 'on foot at 144 frames the game keeps its own hold, twice the frame');
    rig.ctx.dt = 1 / 60;
    restore();
  }

  // A view from outside, not raced: the cut, nothing of the follow drawn, the game's own K.
  const b = frame(rig, 6, 'third');
  const want = staticCut(rig.ctx.followFar, { x: 0, y: 0 });
  ok(!rig.product.masked && !rig.pass.lastMasked && (ru.uCut.value as THREE.Vector2).x === want.x && (ru.uCut.value as THREE.Vector2).y === want.y, 'on foot or any view not raced, the depth cut as before');
  ok(b.draws.every((d) => !d.name.startsWith('pod.') && !d.name.startsWith('player.')), 'and the follow draws nothing (it is still)');
  ok(ru.uMaxRadius.value === maxBlurRadiusPx(H) && gu.uSamples.value === MOTION_TUNING.samples, "with the game's own K and taps");

  // A part that disappears and comes back is not drawable on the frame it comes back: the mask has a hole, so the cut.
  frame(rig, 7, 'race');
  rig.w.engine.visible = false;
  frame(rig, 8, 'race');
  ok(rig.product.masked, 'a part hidden is no hole (nothing of it is drawn)');
  rig.w.engine.visible = true;
  frame(rig, 9, 'race');
  ok(!rig.product.masked && !rig.pass.lastMasked && (ru.uCut.value as THREE.Vector2).x === staticCut(rig.ctx.followFar, { x: 0, y: 0 }).x, 'a part shown again cannot be drawn on that frame: the frame keeps the cut rather than smear it');
  frame(rig, 10, 'race');
  ok(rig.product.masked, 'and the mask is whole again on the next');

  // Rules and views.
  tuneMotion({ followRule: 'cut' });
  frame(rig, 11, 'race');
  ok(!rig.product.masked && !rig.pass.lastMasked, "the cut rule keeps the race view on the cut, the switch to compare");
  ok(ru.uMaxRadius.value === raceBlurRadiusPx(H), "with the race view's own longer streaks whatever the rule");
  tuneMotion({ followRule: 'mask' });
  frame(rig, 12, 'third');
  ok(rig.product.masked, 'the mask rule masks a view from outside on foot');
  frame(rig, 13, 'other');
  ok(!rig.product.masked, 'and never first person or the cockpit');
  restore();
  frame(rig, 14, 'chase');
  frame(rig, 15, 'chase');
  ok(rig.product.masked && ru.uMaxRadius.value === maxBlurRadiusPx(H), "a flown ship's chase takes the mask with the game's own K");

  // A follow over its draws is no mask; the mask's cap is its own, the moving parts' cap is the old one.
  const cap = MOVER_LIMITS.maxMaskDraws;
  MOVER_LIMITS.maxMaskDraws = 1;
  frame(rig, 16, 'race');
  const over = rig.product.stats(true);
  ok(!rig.product.masked && over.follow.overCap && over.list.filter((m) => m.carried).every((m) => m.result === 'still'), 'a follow that would take more draws than the cap keeps the cut that frame, classified by the old rule (still), never refused');
  // Over the cap with a part moving on the pod: the frame is b4bfa5c's, that part drawn with its own motion under the old cap.
  frame(rig, 30, 'race');
  rig.w.engine.position.x += 0.3;
  const moved = frame(rig, 31, 'race');
  rig.w.engine.position.x -= 0.3;
  const fol = moved.draws.filter((d) => d.name.startsWith('pod.') || d.name.startsWith('player.'));
  const cut31 = staticCut(rig.ctx.followFar, { x: 0, y: 0 });
  ok(!rig.product.masked && fol.length === 1 && fol[0].name === 'pod.engine' && fol[0].followed === 0 && fol[0].cut[0] === cut31.x && fol[0].cut[1] === cut31.y, 'and a part moving on it is drawn as before: its own motion, the depth cut, nothing else of the follow');
  MOVER_LIMITS.maxMaskDraws = cap;
  const carriedCap = MOVER_LIMITS.maxCarriedDraws;
  MOVER_LIMITS.maxCarriedDraws = 0;
  frame(rig, 40, 'race');
  frame(rig, 41, 'race');
  ok(rig.product.masked, "under the mask the follow is held to the mask's cap, not the moving parts'");
  frame(rig, 42, 'third');
  rig.w.engine.position.x += 0.3;
  frame(rig, 43, 'third');
  ok(rig.product.stats(true).list.some((m) => m.kind === 'ridden' && m.result === 'budget'), "out of the mask a part moving on the pod is held to the old cap, as before");
  rig.w.engine.position.x -= 0.3;
  MOVER_LIMITS.maxCarriedDraws = carriedCap;
  // The pass asks the product about the frame it is drawing: a texture handed on a frame the product did not draw is no mask.
  frame(rig, 44, 'race');
  frame(rig, 45, 'race');
  ok(rig.pass.lastMasked, 'masked on the frame the product drew');
  rig.ctx.frame = 46;
  rig.pass.prepare(rig.ctx as unknown as Parameters<MotionBlurPass['prepare']>[0]);
  ok(!rig.pass.lastMasked, 'a later frame the product did not draw reads no mask, whatever texture it is handed');

  // A race K below the game's sizes the targets for it, and the other views draw into part of them.
  tuneMotion({ raceRadiusOfHeight: 0.01 });
  frame(rig, 17, 'third');
  const k9 = raceBlurRadiusPx(H);
  const kn = maxBlurRadiusPx(H);
  const t = (rig.pass as unknown as { tiles: THREE.WebGLRenderTarget }).tiles;
  ok(t.width === Math.ceil(W / k9) && (gu.uTiles.value as THREE.Vector2).x === Math.ceil(W / kn) && t.viewport.z === Math.ceil(W / kn), 'a dial moved under the game K resizes the tiles for the smaller K on the next frame, and the other views use part of them');
  restore();
  frame(rig, 18, 'third');
  ok(t.width === Math.ceil(W / kn) && t.viewport.z === t.width, 'put back, the targets are the game K size and fill whole, as before');
}

// ---- 3b. The holes: a skinned rider whose variant builds or fails, a part re-parented, swapped or added, and the glow. ----
{
  // A skinned box of `morphs` morph targets: no rung of the ladder with morphs and no morph normals, so its variant is
  // met in play and goes on the queue.
  const skinnedBox = (name: string, morphs: number): THREE.SkinnedMesh => {
    const g = new THREE.BoxGeometry(0.4, 0.4, 0.4);
    const n = g.attributes.position.count;
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
    const wts = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) wts[i * 4] = 1;
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
    g.morphAttributes.position = Array.from({ length: morphs }, () => g.attributes.position.clone());
    const m = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial());
    const bone = new THREE.Bone();
    m.add(bone);
    m.bind(new THREE.Skeleton([bone]));
    m.updateMorphTargets();
    m.name = name;
    m.layers.enable(ACTOR_LAYER);
    return m;
  };
  const glowTex = new THREE.Texture();
  const glow = (name: string): THREE.Sprite => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.name = name;
    s.scale.setScalar(0.6);
    s.layers.enable(ACTOR_LAYER);
    return s;
  };
  const rig = makeRig(VelocityProduct as unknown as ProductCtor, MotionBlurPass, (w) => {
    w.player.add(skinnedBox('player.rider', 2));
    const g = glow('pod.glow');
    g.position.set(0, 0, 1.2);
    w.pod.add(g);
    w.other.add(glow('other.glow'));
  });
  // The world's queue, held: what is pushed is built only when the test says, and can be made to fail to link.
  type Job = { compile(o: THREE.Object3D, a: number, r: boolean): unknown; finish(o: THREE.Object3D): void };
  const held: { o: THREE.Object3D; own: Job }[] = [];
  rig.product.setQueue(((objects: THREE.Object3D[], _l: string, _u: boolean, own: Job) => {
    for (const o of objects) held.push({ o, own });
    return Promise.resolve();
  }) as never);
  const r = rig.ctx.renderer as { compile: () => void };
  const build = (fail: boolean) => {
    const was = r.compile;
    if (fail) r.compile = () => {
      throw new Error('test: the program did not link');
    };
    for (const h of held.splice(0)) {
      h.own.compile(h.o, 1, true);
      h.own.finish(h.o);
    }
    r.compile = was;
  };
  const ru = U(rig.pass, 'resolveU');
  const cutKept = (f: number) => {
    const want = staticCut(rig.ctx.followFar, { x: 0, y: 0 });
    const c = ru.uCut.value as THREE.Vector2;
    return !rig.product.masked && !rig.product.maskedOn(f) && !rig.pass.lastMasked && c.x === want.x && c.y === want.y;
  };
  const named = (d: { draws: Draw[] }, name: string) => d.draws.find((x) => x.name === name);

  for (let f = 0; f < 2; f++) frame(rig, f, 'race');
  const a = frame(rig, 2, 'race');
  ok(held.length === 1 && cutKept(2) && !named(a, 'player.rider'), "a skinned rider whose variant is still building is a hole: the frame keeps the cut and the rider is not drawn");
  build(false);
  const b = frame(rig, 3, 'race');
  const rider = named(b, 'player.rider');
  ok(rig.product.maskedOn(3) && rig.pass.lastMasked && rider?.followed === 1, 'built, the rider is drawn whole at nought and the mask stands');

  // The follow's engine glow: held sharp with it under the mask, a quad facing the camera that rides the follow's motion.
  const pg = named(b, 'pod.glow');
  ok(!!pg && pg.followed === 1 && pg.alphaMap === glowTex && pg.alphaTest === MOVER_LIMITS.glowAlphaTest, "the follow's glow sprite is drawn into the mask, cut by its own picture's alpha");
  const mv = pg!.mv;
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-6;
  ok(near(mv[0], 0.6) && near(mv[5], 0.6) && near(mv[10], 1) && [1, 2, 4, 6, 8, 9].every((i) => near(mv[i], 0)), 'its quad faces the camera at the sprite size, as three stands a sprite');
  const carried = new THREE.Matrix4().fromArray(pg!.carry).multiply(new THREE.Matrix4().fromArray(pg!.world));
  ok(carried.elements.every((e, i) => Math.abs(e - pg!.prev[i]) < 1e-6), "and last frame is its place carried by the follow's motion: nought of its own");
  ok(!named(b, 'other.glow'), "a glow on a vehicle the camera does not follow is never drawn");
  const c = frame(rig, 4, 'third');
  ok(!named(c, 'pod.glow') && !named(c, 'player.rider'), 'out of the mask no glow and no rider is drawn, as before');
  frame(rig, 5, 'race');
  frame(rig, 6, 'race');
  ok(rig.product.maskedOn(6), 'back in the race view the mask stands again');

  // A part whose variant fails to link: always a hole, so the cut, never a smear of it.
  const rider2 = skinnedBox('player.rider2', 3);
  rig.w.player.add(rider2);
  frame(rig, 7, 'race');
  ok(cutKept(7), 'a part added under the follow is a hole on the frame it is first seen');
  frame(rig, 8, 'race');
  ok(held.length === 1 && cutKept(8), 'and while its variant is wanted and building');
  build(true);
  frame(rig, 9, 'race');
  frame(rig, 10, 'race');
  ok(cutKept(9) && cutKept(10), 'a variant that failed to link keeps the cut for as long as the part is shown');
  rig.w.player.remove(rider2);
  frame(rig, 11, 'race');
  frame(rig, 12, 'race');
  ok(rig.product.maskedOn(12), 'taken off, the mask stands again');

  // Re-parented: out of date on that frame and first seen in its new place on the next.
  const body = rig.w.pod.children[0];
  body.attach(rig.w.engine);
  frame(rig, 13, 'race');
  ok(cutKept(13), 'a part re-parented under the follow keeps the cut that frame');
  frame(rig, 14, 'race');
  ok(cutKept(14), 'and the next, when it is first seen where it hangs now');
  const d15 = frame(rig, 15, 'race');
  ok(rig.product.maskedOn(15) && named(d15, 'pod.engine')?.followed === 1, 'then drawn into the mask again');
  rig.w.pod.attach(rig.w.engine);
  frame(rig, 16, 'race');
  frame(rig, 17, 'race');
  frame(rig, 18, 'race');

  // Its material swapped: out of date that frame.
  rig.w.engine.material = new THREE.MeshStandardMaterial();
  frame(rig, 19, 'race');
  ok(cutKept(19), "a part whose material is swapped keeps the cut that frame");
  frame(rig, 20, 'race');
  const d21 = frame(rig, 21, 'race');
  ok(rig.product.maskedOn(21) && named(d21, 'pod.engine')?.followed === 1, 'and the mask stands again once it is drawable');

  // A part added between rescans: counted on the frame it is added, never left out of the mask to smear.
  const st = (rig.product as unknown as { records: Map<THREE.Object3D, { stagger: number }> }).records.get(rig.w.pod)!.stagger;
  let n = 22;
  while ((n + st) % MOVER_LIMITS.rescanFrames === 0 || (n + 1 + st) % MOVER_LIMITS.rescanFrames === 0) n++;
  for (let f = 22; f < n; f++) frame(rig, f, 'race');
  ok(rig.product.maskedOn(n - 1), 'the mask stands before the part comes');
  const wing = box('pod.wing', 1);
  wing.position.set(-1.5, 0, -2);
  rig.w.pod.add(wing);
  frame(rig, n, 'race');
  ok(cutKept(n), `a part added on a frame no rescan was due (${n}) is a hole that frame, not left out of the mask`);
  const dn = frame(rig, n + 1, 'race');
  ok(rig.product.maskedOn(n + 1) && named(dn, 'pod.wing')?.followed === 1, 'and drawn into the mask on the next');
  // With no scan to spare that frame (the budget spent on others), a part added is still a hole: its scan is out of date.
  const scans = MOVER_LIMITS.maxScansPerFrame;
  MOVER_LIMITS.maxScansPerFrame = 0;
  rig.w.pod.add(box('pod.fin', 0.5));
  frame(rig, n + 2, 'race');
  ok(cutKept(n + 2), 'with no scan to spare, a part added keeps the cut until it is scanned');
  MOVER_LIMITS.maxScansPerFrame = scans;
  frame(rig, n + 3, 'race');
  const dl = frame(rig, n + 4, 'race');
  ok(rig.product.maskedOn(n + 4) && named(dl, 'pod.fin')?.followed === 1, 'scanned, it is drawn into the mask');
}

// ---- 4. Day one: every view but the race view and the chase draws what b4bfa5c drew. ----
{
  const trace = (rig: Rig) => {
    const out: unknown[] = [];
    for (const [f, view] of [[0, 'third'], [1, 'third'], [2, 'third'], [3, 'other'], [4, 'other'], [5, 'third']] as [number, FollowView][]) {
      const d = frame(rig, f, view);
      const ru = U(rig.pass, 'resolveU');
      const tiles = [U(rig.pass, 'tileXU').uK.value, U(rig.pass, 'tileYU').uK.value, U(rig.pass, 'gatherU').uK.value, U(rig.pass, 'gatherU').uSamples.value];
      out.push({
        draws: d.draws.map((x) => [x.name, x.cut, x.moving, x.prev, x.carry]),
        quads: d.quads,
        resolve: [(ru.uCut.value as THREE.Vector2).toArray(), ru.uScale.value, ru.uMaxRadius.value, ru.uObjects.value],
        tiles,
      });
      drawn += d.draws.length;
      quads += d.quads.length;
    }
    return createHash('sha256').update(JSON.stringify(out)).digest('hex').slice(0, 16);
  };
  let drawn = 0;
  let quads = 0;
  const today = trace(makeRig(VelocityProduct as unknown as ProductCtor, MotionBlurPass));
  ok(drawn >= 4 && quads === 6 * 5, `the trace is no empty one: ${drawn} velocity draws and every one of the pass's five draws on six frames`);
  // Recorded from b4bfa5c's own motionBlur.ts, velocity.ts and velocityMath.ts over this very trace.
  const RECORDED = '51d06ed073e5969f';
  const old = await loadOldMany(['src/core/fx/motionBlur.ts', 'src/core/fx/velocity.ts', 'src/core/fx/velocityMath.ts'], ['src/core/fx/velocity.ts', 'src/core/fx/motionBlur.ts'], 'b4bfa5c');
  if (old) {
    const [ov, ob] = old as [{ VelocityProduct: ProductCtor }, { MotionBlurPass: PassCtor }];
    const before = trace(makeRig(ov.VelocityProduct, ob.MotionBlurPass));
    ok(before === RECORDED, `b4bfa5c's own modules still make the recorded trace (${before})`);
  } else console.log('note: git could not hand b4bfa5c over; held to the recorded trace alone');
  ok(today === RECORDED, `on foot and first person the product and the pass write exactly what b4bfa5c wrote, draw for draw and uniform for uniform (${today})`);
}

// ---- 5. The programs and the wiring, as text. ----
{
  const pass = new MotionBlurPass();
  const frag = (name: string) => pass.materials().map((m) => m.material as THREE.ShaderMaterial).find((m) => m.name === name)!.fragmentShader;
  ok(frag('fx.motionBlur.tileX').includes(`i < ${MAX_TILE_K}; i++`) && frag('fx.motionBlur.tileX').includes('if ( i >= uK ) break;'), "the tile max's loop reaches the race K and stops at the frame's");
  ok(frag('fx.motionBlur.neighbour').includes('ivec2 size = ivec2( uTiles );') && !frag('fx.motionBlur.neighbour').includes('textureSize( tTiles'), 'the neighbour max clamps to the tiles drawn, never the target');
  ok(frag('fx.motionBlur.gather').includes('ivec2 tsize = ivec2( uTiles );') && !frag('fx.motionBlur.gather').includes('textureSize( tNeighbours'), 'and so does the gather');
  const vsrc = readFileSync(new URL('../../../src/core/fx/velocity.ts', import.meta.url), 'utf8');
  ok(vsrc.includes('float w = max( smoothstep( uCut.x, uCut.y, vViewZ ), uMoving ) * ( 1.0 - uFollowed );') && vsrc.includes('u.uFollowed.value = rec.carried && this.masked ? 1 : 0;'), 'the velocity program takes the camera out of the follow only while it is the mask');
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8');
  ok(main.includes('f.followView = this.followView;'), 'the frame hands the effects the view');
  ok(main.includes("this.followView = this.cam.firstPerson || jumpView || this.jumpTunnel.shown ? 'other' : 'chase';"), "a flown ship's chase is 'chase', its cockpit and a jump 'other'");
  ok(main.includes("if (!this.cam.firstPerson && !(this.talkNow || this.talkCam.blend > 0)) this.followView = raced ? 'race' : 'third';"), "the race view is 'race' only from outside and out of a conversation");
  const placeAt = main.indexOf('private placeCamera(');
  ok(placeAt > 0 && main.indexOf("this.followView = 'other';", placeAt) - placeAt < 400, "every frame starts at 'other' before the editor's eye can return");
  const install = readFileSync(new URL('../../../src/core/fx/install.ts', import.meta.url), 'utf8');
  ok(install.includes('blur.velocity = velocity;'), 'the pass is handed the product it asks');
}

console.log(`${passed} checks passed`);
