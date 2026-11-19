// The rope chain round, maker B, item 3: a rope drawn as a chain. The curve laid through the chain's drawn points (src/player/
// ropeCurve.ts), the strip turned to the view through it with the twist's picture on it (src/player/ropeChainDraw.ts), and what
// only the game hands them, pinned as text (every behaviour test lays them for itself through the harness, `drawChained`, so a line
// lost from the game alone would pass every one of them). Files split on /\r?\n/ (a working copy may be CRLF).
//  - The curve passes through every knot to the bit (the drawn hands among them), turns smoothly where the chain's links kink, never
//    loops or overshoots between two knots a hand's width apart (centripetal), lifts a lying knot `climb.ropeLift` along its surface's
//    normal and moves no other, and lays each ring's place along the rope by the rings.
//  - The strip: each ring's two vertices across the view (square to the curve and to the way to the camera), `climb.ropeWidth` apart
//    near and never under the hook's least pixels far off, its normals unit and bent round the cord, the twist laid along by each
//    ring's place over `climb.ropeLay` and across edge to edge; its draw range the rings'; hidden by `hide`.
//  - One material for every chained rope: the twist's picture as its map (three slanting strands a lay, a strand's crown light and
//    its grooves dark), a depth offset toward the view (the units turned under reversed depth, as the decals' and marks'), no shadow;
//    the hook's rope's look followed (`followHookLook`).
//  - The game: one strip of it stood hidden in the scene at the player's making (`chainRopeCarrier`, so the warm-up builds its program
//    behind the loading screen); each rope's strip made with its ribbon and disposed with it; `drawRopes` draws each rope as its
//    chain's strip through `drawChained` where its chain is drawn (the straight ribbon hidden) and the hook's look followed first; the
//    harness lays its strips through the very same function.
//
// Run: node tools/swg/tests/climbRopeChainDraw.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { CLIMB_TUNE, resetClimbTune } from '../../../src/anim/climbTune.ts';
import { GRAPPLE_TUNE } from '../../../src/player/grapple.ts';
import { GRAPPLE_MATERIAL } from '../../../src/player/grappleDraw.ts';
import { RopeChain } from '../../../src/player/ropeChain.ts';
import { CURVE_MOST, CURVE_STEPS, RopeCurve } from '../../../src/player/ropeCurve.ts';
import { CHAIN_ROPE_MATERIAL, ChainRibbon, ROPE_DEPTH_FACTOR, ROPE_DEPTH_UNITS, TWIST_ACROSS, TWIST_ALONG, TWIST_STRANDS, chainRopeCarrier, followHookLook, ropeTwistPicture } from '../../../src/player/ropeChainDraw.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
resetClimbTune();

/** A chain whose drawn points are `pts` (three a point), normals `nrm` (nought: none), hands at `ga`, `gb`. */
function chainOf(pts: number[], nrm: number[] | null = null, ga = -1, gb = -1): RopeChain {
  const c = new RopeChain();
  const n = pts.length / 3;
  for (let i = 0; i < 3 * n; i++) {
    c.draw[i] = pts[i];
    c.drawN[i] = nrm ? nrm[i] : 0;
  }
  c.drawCount = n;
  c.gripA = ga;
  c.gripB = gb;
  return c;
}
const ring = (cv: RopeCurve, i: number) => [cv.ring[3 * i], cv.ring[3 * i + 1], cv.ring[3 * i + 2]];

// ---- 1. The curve ----
{
  // A rope hanging and kinking 90 degrees over an edge, with two hands close together on its upper span.
  const pts = [0, 10, 0, 0, 9.67, 0, 0, 9.5, 0, 0, 9.45, 0, 0, 9.2, 0, 0, 8.87, 0, 0.33, 8.87, 0, 0.66, 8.87, 0, 0.99, 8.87, 0];
  const nrm = new Array(pts.length).fill(0);
  // The last three lie on a ledge (their normal up).
  for (const k of [6, 7, 8]) nrm[3 * k + 1] = 1;
  const c = chainOf(pts, nrm, 2, 3);
  const cv = new RopeCurve();
  cv.lay(c);
  const n = c.drawCount;
  ok(cv.count === (n - 1) * CURVE_STEPS + 1, `the curve lays ${CURVE_STEPS} rings a span and its last knot (${cv.count} rings for ${n} knots)`);
  let exact = true;
  for (let j = 0; j < n; j++) {
    const lift = nrm[3 * j + 1] !== 0 ? CLIMB_TUNE.ropeLift : 0;
    const r = ring(cv, j * CURVE_STEPS);
    if (r[0] !== pts[3 * j] || r[1] !== pts[3 * j + 1] + lift || r[2] !== pts[3 * j + 2]) exact = false;
  }
  ok(exact, `every knot is a ring to the bit, a lying one lifted by ropeLift (${CLIMB_TUNE.ropeLift} m) along its normal and no other moved`);
  ok(cv.gripA === 2 * CURVE_STEPS && cv.gripB === 3 * CURVE_STEPS, "the hands' rings are their knots' (the drawn rope meets each hand exactly)");
  ok(cv.lifted === 3, `three knots lifted (${cv.lifted})`);
  // Between the two hands 5 cm apart, beside spans of 17 and 25 cm: no loop or overshoot (centripetal), every ring inside the hands' segment's box.
  let off = 0;
  for (let i = cv.gripA + 1; i < cv.gripB; i++) {
    const r = ring(cv, i);
    off = Math.max(off, Math.abs(r[0]), Math.abs(r[2]), Math.max(0, r[1] - 9.5), Math.max(0, 9.45 - r[1]));
  }
  ok(off < 1e-9, `between the two hands the curve keeps to their segment (off it by ${off.toExponential(1)} m)`);
  // Smooth where the links kink 90 degrees: no ring-to-ring turn anywhere near the polyline's own.
  let most = 0;
  for (let i = 1; i < cv.count - 1; i++) {
    const a = ring(cv, i - 1);
    const b = ring(cv, i);
    const d = ring(cv, i + 1);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [d[0] - b[0], d[1] - b[1], d[2] - b[2]];
    const cos = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (Math.hypot(...u) * Math.hypot(...v));
    most = Math.max(most, (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI);
  }
  // (A curve through the knots has the knot's own tangent there, square to neither link: the 90 degrees are turned over the rings
  // either side of it, never at one ring as the links turn them.)
  ok(most < 0.6 * 90, `the curve turns the links' 90-degree kink over the rings either side of it, never at one: at most ${most.toFixed(1)} degrees from one ring to the next`);
  let mono = true;
  for (let i = 1; i < cv.count; i++) if (!(cv.along[i] > cv.along[i - 1])) mono = false;
  let len = 0;
  for (let i = 1; i < cv.count; i++) len += Math.hypot(...ring(cv, i).map((v, k) => v - ring(cv, i - 1)[k]));
  ok(mono && cv.along[0] === 0 && Math.abs(cv.along[cv.count - 1] - len) < 1e-9, `each ring's place along the rope rises from nought at the anchor to the rings' own length (${len.toFixed(3)} m)`);
  CLIMB_TUNE.ropeLift = 0.03;
  cv.lay(c);
  ok(ring(cv, 7 * CURVE_STEPS)[1] === 8.87 + 0.03, 'the lift is the slider\'s (0.03 m)');
  resetClimbTune();
  const two = chainOf([0, 10, 0]);
  cv.lay(two);
  ok(cv.count === 0, 'a chain of one point lays no curve');
  ok(CURVE_MOST === (64 + 2 - 1) * CURVE_STEPS + 1, `room for the most points a chain keeps and the two hands (${CURVE_MOST} rings)`);
}

// ---- 2. The strip ----
{
  const pts: number[] = [];
  for (let i = 0; i < 24; i++) pts.push(0, 10 - (8 * i) / 23, 0);
  const c = chainOf(pts);
  const cv = new RopeCurve();
  cv.lay(c);
  const s = new ChainRibbon();
  const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 2000);
  cam.position.set(4, 6, 3);
  s.screenH = 1080;
  s.lay(cv, cam);
  const pos = s.mesh.geometry.getAttribute('position').array as Float32Array;
  const nrm = s.mesh.geometry.getAttribute('normal').array as Float32Array;
  const uv = s.mesh.geometry.getAttribute('uv').array as Float32Array;
  let square = 0;
  let width = Infinity;
  let unit = 0;
  let uvOff = 0;
  for (let i = 0; i < cv.count; i++) {
    const across = [pos[6 * i + 3] - pos[6 * i], pos[6 * i + 4] - pos[6 * i + 1], pos[6 * i + 5] - pos[6 * i + 2]];
    const w = Math.hypot(...across);
    width = Math.min(width, w);
    const mid = [(pos[6 * i] + pos[6 * i + 3]) / 2, (pos[6 * i + 1] + pos[6 * i + 4]) / 2, (pos[6 * i + 2] + pos[6 * i + 5]) / 2];
    const view = [cam.position.x - mid[0], cam.position.y - mid[1], cam.position.z - mid[2]];
    const vl = Math.hypot(...view);
    // Square to the rope (straight down here) and to the way to the camera.
    square = Math.max(square, Math.abs(across[1] / w), Math.abs((across[0] * view[0] + across[1] * view[1] + across[2] * view[2]) / (w * vl)));
    for (const k of [0, 3]) unit = Math.max(unit, Math.abs(Math.hypot(nrm[6 * i + k], nrm[6 * i + k + 1], nrm[6 * i + k + 2]) - 1));
    uvOff = Math.max(uvOff, Math.abs(uv[4 * i] - cv.along[i] / CLIMB_TUNE.ropeLay), Math.abs(uv[4 * i + 2] - cv.along[i] / CLIMB_TUNE.ropeLay), uv[4 * i + 1], Math.abs(uv[4 * i + 3] - 1));
  }
  ok(square < 1e-5, `each ring's two vertices lie across the view, square to the rope and to the way to the camera (worst ${square.toExponential(1)})`);
  ok(Math.abs(width - CLIMB_TUNE.ropeWidth) < 1e-6, `near, the strip is ropeWidth across (${width.toFixed(4)} m)`);
  ok(unit < 1e-5, 'its normals are unit');
  ok(uvOff < 1e-4, "the twist is laid along by each ring's place over ropeLay and across edge to edge");
  ok(s.mesh.geometry.drawRange.count === (cv.count - 1) * 6 && s.mesh.visible, `its draw range is its rings' (${cv.count - 1} quads), shown`);
  // Far off: never under the hook's least pixels across.
  cam.position.set(300, 6, 0);
  s.lay(cv, cam);
  const want = (2 * 300 * Math.tan((60 * Math.PI) / 360) * GRAPPLE_TUNE.minPx) / 1080;
  ok(Math.abs(s.widest - Math.hypot(300, 4) * (want / 300)) < 0.01 && s.widest > CLIMB_TUNE.ropeWidth, `300 m off it is held to the hook's ${GRAPPLE_TUNE.minPx} pixels across (${s.widest.toFixed(3)} m)`);
  s.hide();
  ok(!s.mesh.visible && s.rings === 0, '`hide` hides it');
  ok(s.mesh.castShadow === false && s.mesh.receiveShadow === true && s.mesh.frustumCulled === false, 'it casts no shadow, takes the sun\'s, and is never culled by its stale box');
}

// ---- 3. The material and its picture ----
{
  ok(new ChainRibbon().mesh.material === CHAIN_ROPE_MATERIAL && new ChainRibbon().mesh.material === CHAIN_ROPE_MATERIAL, 'every strip is on the one material');
  const m = CHAIN_ROPE_MATERIAL;
  ok(m.polygonOffset && m.polygonOffsetFactor === ROPE_DEPTH_FACTOR && ROPE_DEPTH_FACTOR < 0 && m.polygonOffsetUnits === ROPE_DEPTH_UNITS && ROPE_DEPTH_UNITS === -2, `it is drawn with a depth offset toward the view (factor ${ROPE_DEPTH_FACTOR}, units ${ROPE_DEPTH_UNITS} with ordinary depth)`);
  const src = readFileSync(fileURLToPath(new URL('../../../src/player/ropeChainDraw.ts', import.meta.url)), 'utf8');
  ok(src.includes('export const ROPE_DEPTH_UNITS = REVERSED_DEPTH ? 2 : -2;'), '... its units turned round under reversed depth (three turns the factor and not the units, as the decals and marks know)');
  const t = m.map as THREE.DataTexture;
  ok(t instanceof THREE.DataTexture && t.image.width === TWIST_ALONG && t.image.height === TWIST_ACROSS && t.wrapS === THREE.RepeatWrapping && t.wrapT === THREE.ClampToEdgeWrapping && t.colorSpace === THREE.SRGBColorSpace && t.generateMipmaps, 'its map is the twist\'s picture, made here (no file), repeated along the rope and held across it, mipmapped');
  const p = ropeTwistPicture();
  // Along the first and last rows: TWIST_STRANDS crowns a lay, the grooves dark; the bands slant (shifted by half a lay over the face).
  const row = (j: number) => Array.from({ length: TWIST_ALONG }, (_, i) => p[4 * (j * TWIST_ALONG + i)]);
  const crowns = (r: number[]) => r.filter((v, i) => v > r[(i + TWIST_ALONG - 1) % TWIST_ALONG] && v >= r[(i + 1) % TWIST_ALONG]).length;
  const r0 = row(0);
  const r1 = row(TWIST_ACROSS - 1);
  ok(crowns(r0) === TWIST_STRANDS && crowns(r1) === TWIST_STRANDS && Math.min(...r0) < 120 && Math.max(...r0) > 240, `${TWIST_STRANDS} strands a lay, crowns light and grooves dark (${Math.min(...r0)} to ${Math.max(...r0)})`);
  const darkest = (r: number[]) => r.indexOf(Math.min(...r));
  const shift = ((darkest(r0) - darkest(r1) + TWIST_ALONG) % TWIST_ALONG) / TWIST_ALONG;
  const strand = 1 / TWIST_STRANDS;
  const slant = ((0.5 * (TWIST_ACROSS - 1)) / TWIST_ACROSS) % strand;
  ok(Math.abs((shift % strand) - slant) < 2 / TWIST_ALONG, `the strands slant across the face as a laid rope's do (a groove moved ${shift.toFixed(3)} of a lay edge to edge)`);
  GRAPPLE_MATERIAL.color.setHex(0x123456);
  GRAPPLE_MATERIAL.roughness = 0.4;
  followHookLook();
  ok(m.color.equals(GRAPPLE_MATERIAL.color) && m.roughness === 0.4 && m.metalness === GRAPPLE_MATERIAL.metalness, "it follows the hook's rope's look (colour, roughness, metalness)");
  GRAPPLE_MATERIAL.color.setHex(GRAPPLE_TUNE.ropeColour);
  GRAPPLE_MATERIAL.roughness = GRAPPLE_TUNE.ropeRoughness;
  followHookLook();
  const carrier = chainRopeCarrier();
  ok(carrier.material === m && !carrier.visible && carrier.geometry.drawRange.count === 0 && !!carrier.geometry.getAttribute('uv'), 'the warm-up\'s strip is on the material, hidden, never laid, with the strips\' own attributes (its program is theirs)');
}

// ---- 4. The game's hand-overs, as text ----
{
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8').split(/\r?\n/).join('\n');
  const player = read('../../../src/player/player.ts');
  const harness = read('./grappleBody.ts');
  ok(/const carrier = chainRopeCarrier\(\);\n\s*scene\.add\(carrier\);\n\s*markActor\(carrier\);/.test(player), "the player stands the chained rope's warm-up strip in its scene at its making, an actor, so every warm-up builds its program");
  ok(/const strip = new ChainRibbon\(\);\n\s*this\.ropeScene\.add\(strip\.mesh\);\n\s*markActor\(strip\.mesh\);\n\s*this\.chainRibbons\.set\(r, strip\);/.test(player), "each rope stood is given its strip beside its ribbon");
  ok(/const strip = this\.chainRibbons\.get\(r\);\n\s*if \(strip\) \{\n\s*strip\.mesh\.removeFromParent\(\);\n\s*strip\.mesh\.geometry\.dispose\(\);\n\s*this\.chainRibbons\.delete\(r\);/.test(player), '... and it goes with the rope, its geometry disposed (the material is every chained rope\'s and stays)');
  ok(/const chained = this\.stepRopeChains\(\);\n\s*if \(chained\) followHookLook\(\);/.test(player), "`drawRopes` follows the hook's look once the chains are stepped");
  ok(/if \(chained && strip && drawChained\(r, strip, this\.ropeCurve, camera, screenH\)\) \{/.test(player), "... and draws each rope as its chain's strip through `drawChained`");
  ok(/if \(!chained \|\| !drawChained\(r, s, this\.ropeCurve, cam, 1080\)\) s\.hide\(\);/.test(harness), 'the harness lays its strips through the very same function');
}

resetClimbTune();
console.log(`climbRopeChainDraw: ${checks} checks passed`);
