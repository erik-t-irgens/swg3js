// Every look's layers in the game (the GPU port's pass 2, wave 5, maker L): the look bodies' own code run in node with a
// stand-in renderer that draws nothing, and the pieces of the viewer's drawing it changed, each against what it was or what it
// stands for. Run: node tools/swg/tests/lookBodies.test.ts
//   1. the dials and their arithmetic (`lookBodyMath.ts`);
//   2. the storms: `step` and `stepWith` alike, a recorded storm played back as the live one draws it, the frame's uniforms;
//   3. the frame of a look (`updateLookWith`): the same turns, scrolls and light as three's own calls give;
//   4. the look bodies' frame (`LookBodies`): a card's turn, its camera, its card's matrix, its light and its size;
//   5. the pictured clouds' fine shell (`cutShell`): on the sphere above the body, its uv laid as on the coarse mesh;
//   6. his imported looks in development alone (`privateSky.ts`, `tools/dev/skyPrivate.mjs`);
//   7. which bodies wear a look (`lookWorld.ts`), and a space place he moved carried by Save to game and read back.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const M = await import('../../../src/sky/bodies/lookBodyMath.ts');
const W = await import('../../../src/sky/look/weather.js');
const B = await import('../../../src/sky/look/build.js');
const G = await import('../../../src/sky/look/generate.js');
const LB = await import('../../../src/sky/bodies/lookBody.ts');
const { BodyCardState } = await import('../../../src/sky/bodies/skyBody.ts');
const { AIR } = await import('../../../src/sky/air/airApi.ts');
const { turnSkyBody } = await import('../../../src/world/skyBodies.ts');
const PS = await import('../../../src/sky/look/privateSky.ts');
const LW = await import('../../../src/sky/bodies/lookWorld.ts');
const BF = await import('../../../src/sky/look/bodiesFile.ts');
const GB = await import('../../../viewer/gameBodies.mjs');
const PL = await import('../../../src/sky/system/places.js');
const SP = await import('../../../tools/dev/skyPrivate.mjs');

// ---------------------------------------------------------------- 1. the dials
{
  const T = M.LOOK_BODY_TUNE;
  ok(T.everyFrames === 1 && T.stillMoves === 0.0005 && T.samples === 4 && T.skyMost === 512 && T.spaceMost === 2048 && T.least === 64 && T.extraReach === 3500, 'the dials start where their reasons say');
  const before = { ...T };
  M.tuneLookBodies({ everyFrames: 99, samples: 2, skyMost: 1 });
  ok(T.everyFrames === 8 && T.samples === 4 && T.skyMost === 64, 'a move is held to its range, and the samples are 1 or 4');
  M.tuneLookBodies(before);
  ok(M.lookBodyPictureSize(0.001, 1440, 'sky') === 64 && M.lookBodyPictureSize(0.3, 1440, 'sky') === 512 && M.lookBodyPictureSize(0.9, 1440, 'space') === 2048, "a body's picture the power of two over its pixels, between the least and the use's most");
  const t = M.lookExtentTan(0.1, 2.45);
  ok(near(t, Math.tan(Math.asin(Math.sin(0.1) * 2.45 * 1.05))), "a card's reach its bounding sphere's angle from where the body fills its half angle");
  ok(near(M.lookExtentTan(1.4, 3), Math.tan((80 * Math.PI) / 180), 1e-12), 'a reach round the eye held under 80 degrees');
  ok(M.lookAirChoiceFor(0).all === 'painted' && M.lookAirChoiceFor(1).quality === 'low' && M.lookAirChoiceFor(2).quality === 'medium' && M.lookAirChoiceFor(3).quality === 'high' && M.lookAirChoiceFor(3).all === 'own', "the air's form by the tier: Low Painted, the rest each look's own, the march's steps the tier's");
  ok(M.lookSizeFor('sky', { generated: { size: 4096 } }) === 1024 && M.lookSizeFor('space', { generated: { size: 4096 } }) === 2048 && M.lookSizeFor('space', { generated: { size: 1024 } }) === 1024, "a look baked at its use's size, never over its own");
}

// ---------------------------------------------------------------- 2. the storms
{
  const U1 = W.weatherUniforms();
  const U2 = W.weatherUniforms();
  ok(U1.t === U1.tv.x || (U1.t && typeof U1.t.mul === 'function'), "the motion's clock is a vector's field");
  ok(U1.cellInv.every((u: Any) => u.value && u.value.isVector4), "each flash's size rides in a vector's field (written in place)");
  const a = new W.Storms(77, false);
  const b = new W.Storms(77, false);
  const rec = W.stormArgs();
  rec.cells = U2.cells;
  rec.sizes = U2.cellInv;
  let same = true;
  for (let i = 0; i < 1800; i++) {
    const now = i / 30;
    a.step(now, true, 2, 1.6, 0.07, U1.cells, U1.cellInv);
    rec.now = now;
    rec.on = true;
    rec.rate = 2;
    rec.bright = 1.6;
    rec.spread = 0.07;
    b.stepWith(rec);
    for (let k = 0; k < W.STORM_SLOTS; k++) {
      const p = U1.cells[k].value;
      const q = U2.cells[k].value;
      if (p.x !== q.x || p.y !== q.y || p.z !== q.z || p.w !== q.w || U1.cellInv[k].value.x !== U2.cellInv[k].value.x) same = false;
    }
  }
  ok(same && a.flashes === b.flashes && a.flashes > 50, `\`step\` and \`stepWith\` draw the same storm number for number (${a.flashes} flashes in a minute)`);
  // a recorded storm played back as the live one draws it: the same flashes lit at every moment (each slot a flash of the set)
  const live = new W.Storms(91, true);
  const taped = new W.Storms(91, true);
  const n = taped.record(3, 0.08, 120);
  const L = W.weatherUniforms();
  const P = W.weatherUniforms();
  const la = W.stormArgs();
  const pa = W.stormArgs();
  la.cells = L.cells;
  la.sizes = L.cellInv;
  pa.cells = P.cells;
  pa.sizes = P.cellInv;
  let agree = true;
  let lit = 0;
  for (let i = 0; i < 120 * 30; i++) {
    const now = i / 30;
    for (const r of [la, pa]) {
      r.now = now;
      r.on = true;
      r.rate = 3;
      r.bright = 1;
      r.spread = 0.08;
    }
    live.stepWith(la);
    taped.stepWith(pa);
    const key = (U: Any) => U.cells.map((c: Any, k: number) => (c.value.w > 1e-9 ? `${c.value.x.toFixed(9)},${c.value.y.toFixed(9)},${c.value.w.toFixed(9)},${U.cellInv[k].value.x.toFixed(6)}` : '')).filter(Boolean).sort().join('|');
    const kl = key(L);
    // (the first two seconds of a pass also show the end of the pass before, as a storm going round again would)
    if (now >= 2 && kl !== key(P)) agree = false;
    if (kl) lit++;
  }
  ok(agree && n > 100 && lit > 100, `a recorded storm played back lights the very flashes the live storm lights, at every frame of its two minutes (${n} flashes recorded, ${lit} frames lit)`);
  ok(read('src/sky/look/build.js').includes('if (state.storms && STORM_TAPE.on) state.storms.record(') && W.STORM_TAPE.on === false, "the game records its storms (`STORM_TAPE.on`, set by its makers), the viewer's step live");
}

// ---------------------------------------------------------------- 3. the frame of a look
B.setPictureSource(() => null);
const presetStorm = (G.presetLook('w3-naboo') as Any);
presetStorm.layers.clouds.storm = { on: true, rate: 2, bright: 3, spread: 0.07 };
presetStorm.layers.clouds.motion = { on: true, drift: 8, churn: 0.3, swirl: 0.25 };
{
  const look = (await import('../../../src/sky/look/looks.js')).makeLook(G.presetLook('yavin-prime') as Any);
  const built = await B.buildLook(look, { place: true });
  const cam = new THREE.PerspectiveCamera(20, 1, 0.1, 100);
  cam.position.set(0.3, 0.2, 4);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  const face = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.2, -0.4, 0.1));
  const fr = B.lookFrameRecord();
  fr.camera = cam;
  fr.clock = 37.25;
  fr.face = face;
  fr.lightWorld = new THREE.Vector3(0.3, 0.5, -0.8).normalize();
  fr.sunWorld = fr.lightWorld;
  fr.tilt = 17;
  fr.spin = 45;
  fr.sphereRadius = 0;
  B.updateLookWith(built, fr);
  const tilt = (17 * Math.PI) / 180;
  const qb = face.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt));
  const turns = (45 * 37.25) / 360;
  const qs = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, turns * Math.PI * 2, 0));
  const qa = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, tilt));
  const qeq = (p: THREE.Quaternion, q: THREE.Quaternion) => near(p.x, q.x, 1e-12) && near(p.y, q.y, 1e-12) && near(p.z, q.z, 1e-12) && near(p.w, q.w, 1e-12);
  ok(qeq(built.bill.quaternion, qb), "the billboard's turn written out is the face's times three's turn about z by the tilt");
  ok(qeq(built.spin.quaternion, qs) && near(built.spin.rotation.y, turns * Math.PI * 2), "the body's spin written out is three's turn about y, its Euler kept beside it");
  ok(qeq(built.axis.quaternion, qa) && near(built.axis.rotation.z, tilt), "the axis's tilt likewise");
  const tk = built.LU.tick.value;
  ok(near(tk.x, turns) && near(tk.y, turns * (+look.layers.clouds.spin || 0)) && near(tk.z, 37.25), "the surface's and the clouds' scrolls and the clock in the frame's vector");
  const Lv = fr.lightWorld.clone().transformDirection(cam.matrixWorldInverse);
  const lv = built.LU.light.value;
  ok(near(lv.x, Lv.x, 1e-12) && near(lv.y, Lv.y, 1e-12) && near(lv.z, Lv.z, 1e-12), "the light in view space written out is three's `transformDirection`");
  // the page's call is the same frame
  const built2 = await B.buildLook(look, { place: true });
  B.updateLook(built2, { camera: cam, clock: 37.25, sunWorld: fr.lightWorld, face, lightWorld: fr.lightWorld, tilt: 17, spin: 45 });
  ok(qeq(built2.bill.quaternion, built.bill.quaternion) && qeq(built2.spin.quaternion, built.spin.quaternion) && near(built2.LU.tick.value.x, tk.x), "the page's `updateLook` is `updateLookWith` with its options in the kept record");
  B.disposeLook(built);
  B.disposeLook(built2);
}

// ---------------------------------------------------------------- 4. the look bodies' frame
{
  const stand: Any = { getRenderTarget: () => null, setRenderTarget() {}, render() {}, clear() {}, compileAsync: async () => {}, readRenderTargetPixelsAsync: async () => new Uint8Array(4), getClearColor: (c: THREE.Color) => c, getClearAlpha: () => 1, setClearColor() {}, getDrawingBufferSize: (v: THREE.Vector2) => v.set(1920, 1080) };
  const sky = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  sky.add(disc);
  const st = new BodyCardState(new THREE.Texture(), { pic: new THREE.Texture(), t: new THREE.Texture(), ms: new THREE.Texture(), e: new THREE.Texture() } as Any);
  disc.userData.swgBodyCard = st;
  const card: Any = { disc, glow: null, file: 'cels_naboo.dds', map: new THREE.Texture(), air: { kind: 'world', world: 'naboo' }, slot: 'celestial' };
  const ringed = (await import('../../../src/sky/look/looks.js')).makeLook(G.presetLook('w-geonosis') as Any);
  const plans: Any[] = [{ place: 'rori:celestial:cels_naboo', id: 'g', look: ringed, record: null, where: 'sky', card, item: -1, group: sky, order: -5, halfRad: 0.1, fovDeg: 60 }];
  LB.LOOK_BODY_IN.screenH = 1440;
  const set = await LB.LookBodies.make(stand, plans, 2);
  ok(set.count === 1 && disc.parent === sky && sky.children.length === 2, "a body's card hung in its group beside SWG's");
  // the card as the bodies' frame leaves it
  const dir = new THREE.Vector3(0.3, 0.6, -0.74).normalize();
  const R = 3500;
  disc.position.copy(dir).multiplyScalar(R);
  st.shown = true;
  st.dir.copy(dir);
  const hz = Math.hypot(dir.x, dir.z);
  st.right.set(-dir.z / hz, 0, dir.x / hz);
  st.up.crossVectors(dir.clone().negate(), st.right);
  st.card.y = Math.tan(0.1);
  st.card.w = 0.8;
  AIR.frame.sunDir.set(0.5, 0.2, 0.84).normalize();
  set.frame(null);
  const b = (set as Any).bodies[0];
  const want = new THREE.Quaternion();
  turnSkyBody(dir, want);
  const q = b.turn;
  ok(near(Math.abs(q.x * want.x + q.y * want.y + q.z * want.z + q.w * want.w), 1, 1e-12), "the body's turn written out is `turnSkyBody`'s");
  const e = b.cam.matrixWorld.elements;
  const back = dir.clone().negate();
  ok(near(e[0], st.right.x, 1e-12) && near(e[5], st.up.y, 1e-12) && near(e[8], back.x, 1e-12) && near(e[10], back.z, 1e-12), 'its camera turned as the card is (its columns right, up and back)');
  const inv = b.cam.matrixWorld.clone().invert().elements;
  ok(inv.every((v: number, i: number) => near(v, b.cam.matrixWorldInverse.elements[i], 1e-12)), "its camera's inverse the transpose written out");
  const tanC = b.cardV.x;
  const reach = Math.max(1, Number(b.built.radius) || 1);
  ok(tanC >= M.lookExtentTan(0.1, reach) && tanC <= M.lookExtentTan(0.1, reach) * 1.0101 && near(b.cam.fov, (2 * Math.atan(tanC) * 180) / Math.PI, 1e-9), "the card spans its camera's frustum, over the reach's tangent by a hundredth at most");
  const k = b.card.matrix.elements;
  ok(near(k[12], dir.x * R, 1e-9) && near(k[13], dir.y * R, 1e-9) && near(k[0], st.right.x * 2 * tanC * R, 1e-9) && b.card.matrixAutoUpdate === false, "its card at SWG's card's place, its width the frustum's at that distance (its matrix written, not composed)");
  ok(near(b.cardV.y, 0.8) && b.card.visible, "its card shown with SWG's card's presence (the storms' fade)");
  {
    // The picture's way up (the fixer of wave 5: the bodies hung upside down, lit from below with the star above). The card's
    // up and its camera's up are one direction, so what the camera saw at its top -- a light from +upV lights it, and on
    // WebGPU that is the picture's first row, where v is 0 -- must land on the card's top edge, where the plane's own v is 1:
    // the graphs read the picture at v turned over, the card's ray through the air at its own v, and the console's pictures
    // go out in the rows WebGPU reads back.
    const up = new THREE.Vector3(k[4], k[5], k[6]).normalize();
    ok(near(up.x, e[4], 1e-9) && near(up.y, e[5], 1e-9) && near(up.z, e[6], 1e-9) && near(up.dot(st.up), 1, 1e-9), "the card's up is its camera's up: the picture's top is the card's top");
    const plane = b.card.geometry as THREE.BufferGeometry;
    const pos = plane.attributes.position;
    const uvs = plane.attributes.uv;
    let topV = 1;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) topV = Math.min(topV, uvs.getY(i));
    ok(topV === 1, "the card's top edge is where its own v is 1");
    const lbt = read('src/sky/bodies/lookBody.ts');
    ok(/const pictureAt = \(at: Any\): Any => vec2\(at\.x, float\(1\)\.sub\(at\.y\)\);/.test(lbt), 'the picture is read at v turned over (`pictureAt`)');
    ok(lbt.includes("const imp = texture(picture, pictureAt(at)).toVar('lookImp');") && lbt.includes("const imp = texture(picture, pictureAt(uv())).toVar('lookImp');") && !/texture\(picture, (at|uv\(\))\)/.test(lbt), "both cards (a ground sky's and space's) read their picture so, and nothing reads it at the card's own v");
    ok(lbt.includes('const ty = at.y.sub(0.5).mul(c.x.mul(2));'), "the card's ray through the air keeps the card's own v (up is up)");
    ok(/const i = \(y \* w \+ x\) \* 4;\n\s+const o = i;/.test(lbt) && !lbt.includes('(h - 1 - y)'), "the console's pictures go out in the rows WebGPU reads back, the first at the top");
  }
  const L = b.lightW;
  ok(near(L.x, AIR.frame.sunDir.x) && near(L.z, AIR.frame.sunDir.z), "lit from the world's casting sun where no system is applied");
  st.shown = false;
  set.frame(null);
  ok(!b.card.visible, "its card hidden while SWG's card is down");
  // a still body is drawn again only when its light moves
  st.shown = true;
  set.frame(null);
  set.draw();
  const d0 = b.drawn;
  set.frame(null);
  set.draw();
  ok(b.moving ? b.drawn === d0 + 1 : b.drawn === d0, 'a still look drawn again only when it moves; a moving one on the cadence');
  // an applied system's motion: its light from where its star is, its size and its turn the item's
  const plans2: Any[] = [{ place: 'yavin4:system:x', id: 'p', look: (await import('../../../src/sky/look/looks.js')).makeLook(G.presetLook('moon') as Any), record: null, where: 'sky', card: null, item: 0, group: sky, order: -5, halfRad: 0.05, fovDeg: 60 }];
  const set2 = await LB.LookBodies.make(stand, plans2, 2);
  const motion: Any = { dir: new Float64Array([0, 0.5, -0.866]), light: new Float64Array([1, 0, 0]), spinTurn: new Float64Array([0.25]), items: [{ drawn: true, sizeDeg: 6, spinDeg: 900 }], T: 1 };
  AIR.frame.overcast = 0;
  set2.frame(motion);
  const b2 = (set2 as Any).bodies[0];
  ok(b2.up && near(b2.lightW.x, 1) && near(b2.half, (6 * Math.PI) / 360, 1e-12) && b2.fr.spin === 360 && near(b2.fr.clock, 0.25), "an extra body at the motion's direction and size, lit from its star, turned by its share of its own day");
  set.dispose(() => {});
  set2.dispose(() => {});
  ok(sky.children.length === 1 && LB.lookDrawnPlaces().size === 0, 'its card gone with its set, and no place left drawn whole');
}

// ---------------------------------------------------------------- 5. the pictured clouds' fine shell
{
  const src = new THREE.SphereGeometry(1, 24, 12);
  const g = B.cutShell(src, 4, 1.002);
  const p = g.attributes.position;
  let onSphere = true;
  for (let i = 0; i < p.count; i++) if (Math.abs(Math.hypot(p.getX(i), p.getY(i), p.getZ(i)) - 1.002) > 1e-6) onSphere = false;
  ok(onSphere && g.index.count === (src.index!.count / 3) * 16 * 3, 'every point of the cut on the sphere of 1.002, each triangle cut into 16');
  // the uv at a cut point is the coarse triangle's own interpolation there (the picture lands where it did)
  const t0 = src.index!.getX(0);
  const t1 = src.index!.getX(1);
  const t2 = src.index!.getX(2);
  const uv = src.attributes.uv;
  const w = [2 / 4, 1 / 4, 1 / 4];
  const wantU = uv.getX(t0) * w[0] + uv.getX(t1) * w[1] + uv.getX(t2) * w[2];
  const at11 = (1 * (2 * 4 + 3 - 1)) / 2 + 1;
  ok(near(g.attributes.uv.getX(at11), wantU, 1e-6), "a cut point's uv the coarse triangle's own at its place across it");
  let out = 0;
  const A = new THREE.Vector3();
  const Bv = new THREE.Vector3();
  const C = new THREE.Vector3();
  for (let i = 0; i < g.index.count; i += 3) {
    A.fromBufferAttribute(p, g.index.getX(i));
    Bv.fromBufferAttribute(p, g.index.getX(i + 1));
    C.fromBufferAttribute(p, g.index.getX(i + 2));
    if (Bv.clone().sub(A).cross(C.clone().sub(A)).dot(A) > 0) out++;
  }
  ok(out === g.index.count / 3, "every cut triangle faces out, wound as the coarse one");
  ok(read('src/sky/look/build.js').includes('await pictureCloudShell(onStatus)'), "a pictured look's clouds ride the fine cut (no more clouds_01's coarse shell)");
}

// ---------------------------------------------------------------- 6. his imported looks in development alone
{
  const src = PS.gamePictureSource('/base/');
  ok(src('pictures/my photo.png') === '/base/sky/pictures/my photo.png' && src('T_PlanetSullust_01_C.png') === null && src('planet_01_mesh.fbx') === null, "with nothing laid, a shipped photo's own path, and nothing of his imports");
  ok(PS.privateLookOf('rori:celestial:cels_naboo') === null, 'no imported look with nothing laid');
  const text = read('src/sky/look/privateSky.ts');
  ok(!/fetch\(|__dev\//.test(text.replace(/^\s*\/\/.*$/gm, '')), "the seam's own module asks for nothing and holds no address of the dev server's");
  const wt = read('src/world/world.ts');
  const asks = wt.match(/privateSkyDev\.ts/g) ?? [];
  ok(asks.length === 2 && (wt.match(/if \(import\.meta\.env\.DEV\) await \(await import\('\.\.\/sky\/look\/privateSkyDev\.ts'\)\)\.readPrivateSky\(\);/g) ?? []).length === 2, "the asking module reached only under `import.meta.env.DEV` (every build's false), twice: a sky's and a zone's");
  // laid as the dev server answers, a place wears his look where all it wears is in his folder
  PS.applyPrivateSky({ from: 'x', looks: { mine: { kind: 'sphere', layers: { surface: { on: true, tex: 'A.png' }, clouds: { on: true, tex: 'B.png' } } }, half: { kind: 'sphere', layers: { surface: { on: true, tex: 'A.png' }, clouds: { on: true, tex: 'Gone.png' } } } }, uses: { 'rori:moon': 'mine', 'rori:moon2': 'half' }, files: ['A.png', 'B.png'], meshes: {}, halos: {}, rings: {} }, '/dev/');
  ok(PS.privateLookOf('rori:moon')?.id === 'own:mine' && PS.privateLookOf('rori:moon2') === null && src('A.png') === '/dev/A.png', 'a place wears his look where every picture it wears is here, and the hook serves them');
  PS.applyPrivateSky({ why: 'none' }, '/dev/');
  ok(!PS.PRIVATE_SKY.on && src('A.png') === null, 'an answer that is none lays none');
  const vc = read('vite.config.ts');
  ok(/function privateSky\(\): Plugin \{[\s\S]{0,200}apply: 'serve'/.test(vc), "the dev server's seam hangs on the dev server alone (`apply: 'serve'`)");
  // the dev server's seam over a made file of choices and a made folder (read only)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lookbodies-'));
  const imported = path.join(dir, 'imported');
  fs.mkdirSync(imported);
  fs.writeFileSync(path.join(imported, 'Sky Picture.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const save = path.join(dir, 'choices.json');
  fs.writeFileSync(save, JSON.stringify({ looks: { mine: { kind: 'sphere', layers: { surface: { on: true, tex: 'Sky Picture.png' } } }, gen: { kind: 'sphere', generated: { recipe: 'moon', seed: 1, dials: {} }, layers: {} } }, uses: { 'rori:moon': 'mine', 'rori:moon2': 'gen' } }));
  const env = { SBV_SAVE: save, SBV_IMPORTED: imported, SBV_LOOKS: path.join(dir, 'none.json') };
  const before = fs.readFileSync(save, 'utf8');
  const got = await SP.privateSkyOf(Object.assign({}, (await import('../../../viewer/server.mjs')).viewerPaths(env, ROOT, ROOT)));
  ok(Object.keys(got.uses).join() === 'rori:moon' && got.files.join() === 'Sky Picture.png', 'the seam names his looks of pictures and the places that wear them (a generated look left to the Save to game)');
  const mw = SP.skyPrivateMiddleware(ROOT, env);
  const server = http.createServer((req, res) => mw(req, res, () => {
    res.statusCode = 404;
    res.end();
  }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as Any).port;
  const ask = (p: string, method = 'GET') => new Promise<number>((r) => {
    const q = http.request({ host: '127.0.0.1', port, path: p, method }, (res) => {
      res.resume();
      res.on('end', () => r(res.statusCode ?? 0));
    });
    q.end();
  });
  ok((await ask('/__dev/sky/imported/Sky%20Picture.png')) === 200 && (await ask('/__dev/sky/imported/..%2Fchoices.json')) === 404 && (await ask('/__dev/sky/imported/choices.json')) === 404, 'it serves a picture his folder holds by its plain name, and nothing else');
  ok((await ask('/__dev/sky/private', 'POST')) === 405 && fs.readFileSync(save, 'utf8') === before, 'it writes nothing (a write is refused, his file as it was)');
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------- 7. which bodies wear a look; a space place carried and read back
{
  const made = GB.gameBodiesFile({
    looks: { g: { name: 'A moon', kind: 'sphere', generated: { recipe: 'moon', seed: 3, dials: {} }, layers: {} } },
    uses: { 'rori:celestial:cels_naboo': 'g', 'space_naboo:planet_naboo': 'g' },
    places: { 'space_naboo:planet_naboo': { yaw: 40, pitch: 12, size: 30, distance: 900, tilt: 5 }, 'rori:moon': { yaw: 3 }, 'space_x:bad': 'no' },
  }, { at: 'now' });
  ok(JSON.stringify(made.places) === JSON.stringify({ 'space_naboo:planet_naboo': { yaw: 40, pitch: 12, size: 30, distance: 900 } }), 'Save to game carries a space place he moved, its yaw, pitch, size and distance alone');
  const c = BF.cleanBodiesFile(JSON.parse(JSON.stringify({ ...made, places: { ...made.places, 'space_naboo:planet_naboo#2': { pitch: 400, size: -3 }, 'rori:moon': { yaw: 1 } } })));
  ok(c.file!.places['space_naboo:planet_naboo#2'].pitch === 90 && c.file!.places['space_naboo:planet_naboo#2'].size === 0.01 && !c.file!.places['rori:moon'], "the game's reader holds each number to its range, and of a ground place keeps what the Place tab moves there (pass 2, wave 6: a moon's yaw is the day's, so a moon's yaw alone is dropped)");
  BF.SKY_BODIES.file = c.file;
  ok(BF.spacePlaceOf('space_naboo:planet_naboo')!.yaw === 40 && BF.spacePlaceOf('space_naboo:planet_moon') === null, 'a place read back by its id');
  const dir = { x: -0.3, y: 0.2, z: -0.93 };
  LW.placeSpaceBody(BF.spacePlaceOf('space_naboo:planet_naboo')!, dir);
  const yp = PL.yawPitchOf(dir);
  ok(near(yp.yaw, 40, 1e-9) && near(yp.pitch, 12, 1e-9), "the zone's planet turned to his yaw and pitch, as the viewer's places read a direction");
  ok(near((2 * Math.asin(LW.spaceBodyRadiusOf(30, 2600) / 2600) * 180) / Math.PI, 30, 1e-9), 'its radius where the zone hangs it gives back his size across');
  // which cards wear a look
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  disc.scale.setScalar(400);
  const disc2 = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  const cards: Any[] = [
    { disc, glow: null, file: 'sky/cels_naboo.png', map: null, air: { kind: 'world', world: 'naboo' }, slot: 'celestial' },
    { disc: disc2, glow: null, file: 'sky/moon_single.png', map: null, air: { kind: 'airless' }, slot: 'moon' },
  ];
  const sky = new THREE.Group();
  const plans = LW.skyLookPlans('rori', cards, sky, 60, LW.SKY_CARD_REACH, null, () => null);
  ok(plans.length === 1 && plans[0].place === 'rori:celestial:cels_naboo' && plans[0].record !== null && near(plans[0].halfRad, Math.atan(200 / 3500), 1e-12), "a card whose place wears a generated look drawn whole, its air its ground world's record, its size its card's");
  ok(LW.lookPlaces(plans).has('rori:celestial:cels_naboo'), "wave 4b's disc picture left out for a place drawn whole");
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(240, 8, 6), new THREE.MeshBasicMaterial());
  mesh.position.set(0, 0, -2600);
  const sp = LW.spaceLookPlans('space_naboo', ['appearance/planet_naboo.pln', 'appearance/planet_naboo_moon.pln'], [{ mesh, radius: 240, index: 0 }], sky, 60);
  ok(sp.length === 1 && sp[0].where === 'space' && sp[0].record !== null && near(sp[0].halfRad, Math.asin(240 / 2600), 1e-12), "a space planet wearing a look drawn whole, its air its ground world's");
  BF.SKY_BODIES.file = null;
}

// the game's lines: the bodies' card stands down for its look, the space planet's air is not made for one drawn whole
{
  const sb = read('src/sky/bodies/skyBody.ts');
  ok(sb.includes('if (st.lookDrawn) {\n        disc.visible = false;\n        if (twin) twin.visible = false;\n        if (glow) glow.visible = false;\n      }'), "a card its look draws stands down with its twin and halo");
  const wt = read('src/world/world.ts');
  ok(wt.includes('rimBodies.filter((b) => !drawnWhole.has(b.mesh))') && wt.includes('this.lookBodies?.draw();'), "the world makes no air shells for a planet drawn whole, and draws the looks before the scene's passes");
}

// ---------------------------------------------------------------- 8. the fixer of wave 5: the tiers, the kits' wait, the order
{
  const T = M.LOOK_BODY_TUNE;
  // the tier's share of the use's most: Low a quarter, Medium a half, High and Ultra whole; a moving look's cadence likewise
  ok(M.tierMost('space', 0) === T.spaceMost * T.lowShare && M.tierMost('space', 1) === T.spaceMost * T.mediumShare && M.tierMost('space', 2) === T.spaceMost && M.tierMost('sky', 3) === T.skyMost, `a body's most by the tier: space ${[0, 1, 2, 3].map((t) => M.tierMost('space', t)).join(', ')}, sky ${[0, 1, 2, 3].map((t) => M.tierMost('sky', t)).join(', ')}`);
  ok(M.lookBodyPictureSize(1.2, 1440, 'space', 0) === 512 && M.lookBodyPictureSize(1.2, 1440, 'space', 1) === 1024 && M.lookBodyPictureSize(1.2, 1440, 'space', 3) === 2048 && M.lookBodyPictureSize(1.2, 1440, 'space') === 2048, 'a planet filling the screen from orbit drawn at 512 on Low, 1024 on Medium, 2048 above (and 2048 where no tier is said)');
  ok(M.lookBodyPictureSize(0.001, 1440, 'sky', 0) === T.least && M.lookBodyPictureSize(0.3, 1440, 'sky', 0) === 128 && M.lookBodyPictureSize(0.3, 1440, 'sky', 2) === 512, 'a sky body at least `least`, at most 128 on Low and 512 above');
  ok(M.everyFor(0) === T.lowEvery && M.everyFor(1) === T.mediumEvery && M.everyFor(2) === T.everyFrames && M.everyFor(3) === T.everyFrames, `a moving look drawn every ${[0, 1, 2, 3].map((t) => M.everyFor(t)).join(', ')} frames by the tier`);
  const keep = { ...T };
  M.tuneLookBodies({ everyFrames: 6, kitWaitMs: -5, kitsAfterScreen: 99 });
  ok(M.everyFor(0) === 6 && T.kitWaitMs === 0 && T.kitsAfterScreen === 16, 'the cadence never quicker than `everyFrames`; the kits\' dials held to their ranges');
  Object.assign(T, keep);
  // (the fixer of wave 6: the owner's "one loading screen for everything") the kits' wait starts at a minute, a cap for the
  // extreme alone, and may be raised to five
  ok(T.kitWaitMs === 60000 && M.LOOK_BODY_RANGE.kitWaitMs[1] === 300000 && T.kitsAfterScreen === 2 && T.lowShare === 0.25 && T.mediumShare === 0.5 && T.lowEvery === 4 && T.mediumEvery === 2, "the fixers' dials start where their reasons say");
  // the kits: every kit a body the arrival shows wears is waited on, for what is left of the screen's wait in all, one the
  // screen's start did not ask (an extra body's preset) asked there and then; only with the wait at nought is such a kit put
  // off and asked once the screen is gone (as the map's opened systems' always are), the world leaving those bodies out
  const bake = read('src/sky/look/lookBake.ts');
  ok(/if \(!KITS\.has\(key\) && !\(waitMs > 0\)\) \{\n\s+askLaterFor\(key, genOf\(look, size\), size, clouds\);\n\s+return false;\n\s+\}\n\s+const kit = askKit\(renderer, key, genOf\(look, size\), size, clouds\);/.test(bake) && /export function askKitsLater\(renderer: Any\): number \{[\s\S]*?if \(n >= LOOK_BODY_TUNE\.kitsAfterScreen\) break;/.test(bake), 'a kit the screen did not ask is asked and waited on; put off (and asked once the screen is gone, a few at a time) only with no wait');
  // the arrival's own bakes (a sky card's disc, a space planet's picture) are given the whole wait; the map's globes keep the
  // bake cache's budget
  ok(/const budget = shown && LOOK_BODY_TUNE\.kitWaitMs > BAKE_TUNE\.budgetMs \? LOOK_BODY_TUNE\.kitWaitMs : BAKE_TUNE\.budgetMs;/.test(bake) && bake.includes('return bakeOnCard(this.renderer, key, look, size, clouds, budget - cache.stats.screenMs);'), "a shown look's bake waits its kit for what is left of the screen's whole wait");
  ok(read('src/sky/look/skyLooks.ts').includes('await looks.bake(hit.id, hit.look, LOOK_BAKE_TUNE.skySize, true, true);') && read('src/space/spaceRims.ts').includes('await looks.bake(hit.id, hit.look, LOOK_BAKE_TUNE.spaceSize, true, true);') && /const pics = await looks\.bake\(hit\.id, hit\.look, GLOBE_BAKE\);/.test(read('src/ui/galaxyLooks.ts')), "the sky's discs and the space planets are the arrival's (shown); the map's globes are not");
  const lbt = read('src/sky/bodies/lookBody.ts');
  ok(/const left = LOOK_BODY_TUNE\.kitWaitMs - \(performance\.now\(\) - t0\);\n\s+if \(await kitWithin\(renderer, look, Number\(gen\.size\) \|\| 1024, left\)\) kept\.push\(plan\);\n\s+else putOff\.push\(plan\.place\);/.test(lbt), "a screen waits for its bodies' kits `kitWaitMs` in all, and leaves out the bodies whose kits have not landed");
  const wt = read('src/world/world.ts');
  ok(/const lookPlans = planned\.length \? await GPU\.rt!\.lookBodies\.ready\(planned, putOff\) : planned;\n\s+if \(this\.swgSky !== sky\) return;/.test(wt) && /const lookPlans = planned\.length \? await GPU\.rt!\.lookBodies\.ready\(planned, putOff\) : planned;\n[^\n]*\n\s+const drawnWhole = new Set\(lookPlans\.map\(\(p\) => p\.mesh\)\);/.test(wt), "the sky's and the zone's bodies are planned from those kept alone (a body put off keeps its card, or its sphere and rims)");
  ok(read('src/main.ts').includes('if (GPU.webgpu && GPU.rt) GPU.rt.looks.askLater();'), 'the kits put off are asked as each screen goes');
  ok(/const pics = await looks\.bake\(hit\.id, hit\.look, GLOBE_BAKE, false\);/.test(read('src/ui/galaxyLooks.ts')), "the map's opened systems ask no kit under a screen");
  // the order: under an applied system a nearer body is drawn over a farther one where they overlap
  const S = await import('../../../src/sky/system/skyMotion.ts');
  ok(S.nearOrder(0.001) > S.nearOrder(0.01) && S.nearOrder(0.01) > S.nearOrder(5) && S.nearOrder(5) > 0 && S.nearOrder(0) < 1 && S.nearOrder(1e9) >= 0, 'nearer, later: the order share falls with distance, under one step of order');
  ok(/b\.card\.renderOrder = p\.card \? p\.card\.disc\.renderOrder : motion && motion\.dist && p\.item !== undefined && p\.item >= 0 \? p\.order \+ nearOrder\(motion\.dist\[p\.item\]\) : p\.order;/.test(lbt) && read('src/world/sky.ts').includes('const order = j >= 0 ? -5 + nearOrder(m.dist[j]) : -5;') && read('src/sky/bodies/skyBody.ts').includes('twin.renderOrder = disc.renderOrder;'), "a body's card, its look's and its twin take that order");
}

console.log(`\nlookBodies: ${checks} checks passed`);
process.exit(0);
