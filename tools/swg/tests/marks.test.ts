// The marks the world keeps, without a renderer: the ring shared out between the three kinds and
// the promise that no kind can push another out of it, the geometry of one quad laid on a surface,
// the saber stroke's own joining and breaking, a scar's size by the family of gun that left it, and
// the rule that a mark dies with whatever it was laid on.
//
// It builds real `Marks` objects and reads the real buffers rather than a mirror of the maths: the
// module loads under node exactly as `clash.ts` does, since nothing in it touches a GL context and
// the hand-drawn sheet is only ever fetched where there is a page to fetch it into.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MARKS, MARKS_BUILD_ONLY, MARK_WORLD, Marks, marks as theMarks, tuneMarks, type MarkPlace, type Vec3Like } from '../../../src/world/marks.ts';
import { SaberMarks } from '../../../src/combat/saberMarks.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol: number, what: string) => ok(Math.abs(a - b) <= tol, `${what} (${a.toFixed(4)} vs ${b.toFixed(4)})`);

const v = (x: number, y: number, z: number) => ({ x, y, z });
const UP = v(0, 1, 0);

// A footprint, asked for exactly as the game asks for one: through `place`, with its own size, its
// own life and the direction it runs in handed over as a vector. The marks system keeps no number
// of its own for a print -- a print's length, width and life are scaled by the body that left it
// and graded by the ground it was left in, so they belong to `PRINT_TUNE` in
// `src/world/footprints.ts` -- and the three below are written out here rather than imported,
// because this is a test of the marks and not of the feet.
const PRINT_LENGTH = 0.28;
const PRINT_WIDTH = 0.11;
const PRINT_LIFE = 45;
/** Heading nought, in the game's own convention: a body faces +z. */
const FACING = v(0, 0, 1);
const print = (m: Marks, at: Vec3Like, left: boolean, opts: MarkPlace = {}): boolean =>
  m.place('print', at, UP, PRINT_WIDTH, PRINT_LIFE, { along: FACING, aspect: PRINT_LENGTH / PRINT_WIDTH, mirror: left, ...opts });

/** The blended mesh's own position buffer, which is where every mark but a hot rim is written. */
const cornersOf = (m: Marks, slot: number): { x: number; y: number; z: number }[] => {
  const mesh = m.mesh.children[0] as THREE.Mesh;
  const pos = mesh.geometry.getAttribute('position');
  const out: { x: number; y: number; z: number }[] = [];
  for (let k = 0; k < 4; k++) out.push(v(pos.getX(slot * 4 + k), pos.getY(slot * 4 + k), pos.getZ(slot * 4 + k)));
  return out;
};
const gap = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);

// --- the ring, shared out ------------------------------------------------------------------------

{
  const m = new Marks();
  const r = m.report() as { kinds: Record<string, { capacity: number; kept: number }>; capacity: number; draws: number };
  const saber = r.kinds.saber.capacity;
  const scar = r.kinds.scar.capacity;
  const print = r.kinds.print.capacity;
  ok(saber + scar + print === MARKS.pieces, `the three ranges are the whole ring (${saber} + ${scar} + ${print} = ${MARKS.pieces})`);
  ok(scar === saber, 'the saber and the scars have the same share of it');
  ok(print < saber, 'the prints have the smallest share, as the tuning asks');
  ok(r.draws === 2, 'and all three kinds are drawn in two meshes whatever the number of them');
  const group = m.mesh as THREE.Object3D;
  ok(group.children.length === 2, 'two meshes, in one group the scene takes once');
  for (const child of group.children) {
    const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    ok(mesh.renderOrder === 3, `${mesh.name}: drawn after the world`);
    ok(mesh.material.depthWrite === false, `${mesh.name}: writes no depth`);
    ok(mesh.material.polygonOffset === true, `${mesh.name}: offset, so the ground never wins a tie against a mark`);
    ok(mesh.frustumCulled === false, `${mesh.name}: never culled, since its pieces are all over the world`);
  }
  m.dispose();
}

// --- no kind can push another out ----------------------------------------------------------------

{
  const m = new Marks();
  const capacity = (m.report() as { kinds: Record<string, { capacity: number }> }).kinds.scar.capacity;
  print(m, v(0, 0, 0), false);
  print(m, v(1, 0, 0), true);
  m.touch(0, v(0, 1, 0), v(0, 0, 1));
  // A firefight: one more scar than the scars' whole range holds.
  for (let i = 0; i < capacity + 5; i++) m.scar('bolt', v(i * 0.01, 2, 0), v(0, 0, 1));
  ok(m.countOf('scar') === capacity, 'the scars fill their own range and stop there');
  ok(m.countOf('print') === 2, 'and both footprints are still showing after it');
  ok(m.countOf('saber') === 1, 'and so is the blade’s burn');
  const r = m.report() as { kinds: Record<string, { pushedOut: number; laid: number }> };
  ok(r.kinds.scar.pushedOut === 5, 'the five the scars pushed out were their own, and the console says how many');
  ok(r.kinds.print.pushedOut === 0, 'the prints pushed nothing out at all');
  ok(r.kinds.scar.laid === capacity + 5, 'every scar asked for was laid');
  m.dispose();
}

// --- a piece past its life is not drawn ------------------------------------------------------------

{
  const m = new Marks();
  print(m, v(0, 0, 0), false);
  m.scar('bolt', v(3, 1, 0), v(0, 0, 1));
  ok(m.count() === 2, 'both are showing the moment they are laid');
  m.update(MARKS.scarLife + 0.5);
  ok(m.countOf('scar') === 0, 'a scar past its life is gone');
  ok(m.countOf('print') === 1, 'while a print, which lasts longer, is still there');
  m.update(PRINT_LIFE);
  ok(m.count() === 0, 'and past its own life the print goes too, with nothing swept on the processor');
  m.dispose();
}

// --- one quad, laid on a surface -------------------------------------------------------------------

{
  const m = new Marks();
  const first = (m.report() as { kinds: Record<string, { capacity: number }> }).kinds.saber.capacity;
  const at = v(2, 1.5, -3);
  const n = v(0, 0, 1);
  m.scar('bolt', at, n);
  const c = cornersOf(m, first);
  for (let k = 0; k < 4; k++) {
    const d = (c[k].x - at.x) * n.x + (c[k].y - at.y) * n.y + (c[k].z - at.z) * n.z;
    near(d, MARKS.lift, 1e-5, `corner ${k} lies in the surface, lifted off it by the one lift`);
  }
  near(gap(c[0], c[1]), MARKS.scarSize.bolt, 1e-5, 'a blaster scar is its family’s width across');
  near(gap(c[1], c[2]), MARKS.scarSize.bolt, 1e-5, 'and as long as it is wide');
  m.dispose();
}

// A scar's size is the family's, and the five are far enough apart to be told from one another.
{
  const m = new Marks();
  const first = (m.report() as { kinds: Record<string, { capacity: number }> }).kinds.saber.capacity;
  const families = ['bolt', 'rocket', 'slug', 'flame', 'lightning'] as const;
  for (let i = 0; i < families.length; i++) {
    m.scar(families[i], v(i, 1, 0), v(0, 0, 1));
    const c = cornersOf(m, first + i);
    near(gap(c[0], c[1]), MARKS.scarSize[families[i]], 1e-5, `a ${families[i]} scar is ${MARKS.scarSize[families[i]]} m across`);
  }
  ok(MARKS.scarSize.rocket / MARKS.scarSize.slug >= 4, 'a rocket’s char is at least four times a slug’s pit across, so the two read apart at twenty metres');
  m.dispose();
}

// A footprint is long, narrow, turned the way the body was going and mirrored for the other foot.
// It is asked for through `place`, exactly as the game asks for it: the marks system holds no
// length, width or life of its own for a print, since those are scaled by the body that left it and
// graded by the ground it was left in, and the direction it runs in is handed over as a vector so
// that neither side has to agree which way a heading turns (`facingOf` in `footprints.ts` is the
// one place that knows, and `footprints.test.ts` pins it).
{
  const m = new Marks();
  const r = m.report() as { kinds: Record<string, { capacity: number }> };
  const first = r.kinds.saber.capacity + r.kinds.scar.capacity;
  print(m, v(0, 0, 0), false);
  const c = cornersOf(m, first);
  near(gap(c[0], c[1]), PRINT_WIDTH, 1e-5, 'a print is the width it was asked for across');
  near(gap(c[1], c[2]), PRINT_LENGTH, 1e-5, 'and the length its aspect makes of it along');
  near((c[2].z - c[1].z) / PRINT_LENGTH, 1, 1e-5, 'the print’s length runs the way the body faces');
  near(c[0].y, MARKS.lift, 1e-6, 'and it lies flat on the ground, lifted off it by the one lift');
  print(m, v(0, 0, 0), true);
  const left = cornersOf(m, first + 1);
  near(left[0].x, -c[0].x, 1e-6, 'the other foot is the same print mirrored across its own length');
  near(gap(left[1], left[2]), PRINT_LENGTH, 1e-5, 'and is no shorter for it');
  m.dispose();
}

// A mark asked for by kind, place, size and life: the one call the other two packages use.
{
  const m = new Marks();
  const first = (m.report() as { kinds: Record<string, { capacity: number }> }).kinds.saber.capacity;
  ok(m.place('rocket', v(0, 0, 0), UP, 2, 5) === true, 'a mark by kind, by place, by size and by how long it lasts');
  const c = cornersOf(m, first);
  near(gap(c[0], c[1]), 2, 1e-5, 'the size asked for is the size laid');
  ok(m.countOf('scar') === 1, 'and it went into its kind’s own range');
  m.update(4);
  ok(m.countOf('scar') === 1, 'it is still there inside the life it was given');
  m.update(2);
  ok(m.countOf('scar') === 0, 'and gone the moment that life is up, whatever its family’s own life says');
  m.dispose();
}

// --- the saber's stroke, unchanged -------------------------------------------------------------------

{
  const m = new Marks();
  const wall = v(0, 0, 1);
  ok(m.touch(0, v(0, 1, 0), wall) === true, 'the first contact lays the stroke’s first piece');
  ok(m.touch(0, v(MARKS.step * 0.5, 1, 0), wall) === false, 'a contact nearer than the step lays nothing new');
  ok(m.touch(0, v(MARKS.step * 4, 1, 0), wall) === true, 'one further than the step joins the stroke');
  ok(m.countOf('saber') === 2, 'which is two pieces, not three: the contact under the step was joined to neither');
  ok(m.touch(0, v(MARKS.breakAt * 2, 1, 0), wall) === true, 'a contact past the break starts a stroke again');
  ok(m.countOf('saber') === 3, 'as a stub of its own');
  // A second blade keeps its own place in the world: one stroke's memory is never another's.
  ok(m.touch(1, v(5, 1, 0), wall) === true, 'a second blade starts its own stroke');
  ok(m.touch(1, v(5 + MARKS.step * 4, 1, 0), wall) === true, 'and joins to where that blade was, not where the first one was');
  ok(m.countOf('saber') === 5, 'five pieces between the two blades, and none of them in the scars’ range');
  ok(m.countOf('scar') === 0 && m.countOf('print') === 0, 'the blade wrote into its own range and nowhere else');
  m.dispose();
}

// A stroke joined over a corner keeps its whole length: the step between two contacts is never
// flattened into the surface, so the quad's two ends are exactly the two contacts.
{
  const m = new Marks();
  const first = 0;
  const a = v(0, 1, 0);
  const b = v(0.2, 1.1, 0);
  m.touch(0, a, v(0, 0, 1));
  m.touch(0, b, v(0, 0, 1));
  const c = cornersOf(m, first + 1);
  const along = gap(c[1], c[2]);
  near(along, gap(a, b), 1e-5, 'the stroke is exactly as long as the blade’s step');
  near(gap(c[0], c[1]), MARKS.width, 1e-6, 'and exactly the stroke’s own width across');
  m.dispose();
}

// --- a mark dies with what it was laid on -------------------------------------------------------------

{
  const m = new Marks();
  m.scar('bolt', v(0, 0, 0), UP, { owner: 7 });
  m.scar('bolt', v(1, 0, 0), UP, { owner: 7 });
  m.scar('bolt', v(2, 0, 0), UP);
  print(m, v(3, 0, 0), false, { owner: 7 });
  ok(m.countOf('scar') === 3 && m.countOf('print') === 1, 'four marks, three of them laid on one thing');
  ok(m.forget(7) === 3, 'that thing streams out and takes its three with it');
  ok(m.countOf('scar') === 1, 'the scar laid on the world itself is still there');
  ok(m.countOf('print') === 0, 'and the print that rode the same thing has gone');
  ok(m.forget(MARK_WORLD) === 0, 'nothing laid on the world is ever forgotten by this door');
  ok(m.forget(7) === 0, 'and forgetting the same thing twice takes nothing the second time');
  m.dispose();
}

// Collider handle 0 is a real collider and never the world. The engine hands handles out from zero
// and recycles them, so a sentinel of 0 would have made every mark laid on whichever prop held it
// look like a mark laid on the world: never counted, never forgotten, and left hanging in the air
// when that prop streamed out.
{
  ok(MARK_WORLD < 0, 'the world’s own sentinel is a number no collider handle can ever be');
  const m = new Marks();
  m.scar('bolt', v(0, 0, 0), UP, { owner: 0 });
  print(m, v(1, 0, 0), false, { owner: 0 });
  const owned = (m.report() as { owned: number }).owned;
  ok(owned === 2, 'a mark laid on handle 0 is counted as owned, not as one laid on the world');
  ok(m.forget(0) === 2, 'and streaming that thing out takes both of them down');
  ok(m.countOf('scar') === 0 && m.countOf('print') === 0, 'so nothing is left hanging where it stood');
  m.dispose();
}

// `forget` costs one lookup for a thing that carries no mark, which is what makes it safe to call
// from the streamer for every collider it drops. `scans` counts the times it really walked the ring.
{
  const m = new Marks();
  m.scar('bolt', v(0, 0, 0), UP, { owner: 7 });
  const before = (m.report() as { scans: number }).scans;
  for (let i = 100; i < 200; i++) m.forget(i);
  ok((m.report() as { scans: number }).scans === before, 'a streaming pass that drops a hundred untouched colliders walks the ring not once');
  ok(m.forget(7) === 1, 'the one that does carry a mark still loses it');
  ok((m.report() as { scans: number }).scans === before + 1, 'and that is the one walk it cost');
  ok(m.forget(7) === 0 && (m.report() as { scans: number }).scans === before + 1, 'asking again for the same thing walks nothing, since it is no longer carried');
  m.dispose();
}

// --- what is uploaded, and what is drawn -----------------------------------------------------------

// A mark writes the four vertices it touched and tells three exactly that, or every footprint laid
// while walking would re-upload all five buffers of the whole ring.
{
  const m = new Marks();
  const first = (m.report() as { kinds: Record<string, { capacity: number }> }).kinds.saber.capacity;
  const mesh = m.mesh.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
  const born = mesh.geometry.getAttribute('aBorn') as THREE.BufferAttribute;
  pos.updateRanges.length = 0;
  born.updateRanges.length = 0;
  m.scar('bolt', v(0, 0, 0), UP);
  ok(pos.updateRanges.length === 1, 'one window of the position buffer, not the whole of it');
  ok(pos.updateRanges[0].start === first * 4 * 3 && pos.updateRanges[0].count === 12, 'and it is exactly the four corners the mark wrote');
  ok(born.updateRanges[0].count === 4, 'the same four vertices of the birth times');
  m.scar('bolt', v(1, 0, 0), UP);
  ok(pos.updateRanges.length === 1, 'a second mark before the frame is drawn widens that window rather than adding another');
  ok(pos.updateRanges[0].count === 24, 'to cover both marks and nothing else');
  // Three empties the list once it has uploaded; the next mark starts a window again.
  pos.updateRanges.length = 0;
  m.scar('bolt', v(2, 0, 0), UP);
  ok(pos.updateRanges.length === 1 && pos.updateRanges[0].count === 12, 'and after a draw the next mark is one window of its own again');
  m.dispose();
}

// A mesh with nothing showing in it is not drawn at all -- but only once a program has been built
// for it, since `renderer.compile()` walks the scene by what is visible and a mesh hidden while the
// loading screen is up would compile on the first live frame instead.
{
  const m = new Marks();
  const blended = m.mesh.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  const additive = m.mesh.children[1] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  m.update(0.1);
  ok(blended.visible && additive.visible, 'both meshes are visible before anything is compiled, so the warm-up builds both programs');
  ok((m.report() as { draws: number }).draws === 2, 'and the readout says two draws, which is what it is');
  // What three itself calls as it builds the program.
  for (const mesh of [blended, additive]) mesh.material.onBeforeCompile({} as never, null as never);
  m.update(0.1);
  ok(!blended.visible && !additive.visible, 'compiled and empty, neither is drawn');
  ok((m.report() as { draws: number }).draws === 0, 'which the readout measures rather than assuming');
  m.scar('bolt', v(0, 0, 0), UP);
  ok(blended.visible && additive.visible, 'a bolt with a hot rim turns both on, on the frame it lands and not the frame after');
  ok((m.report() as { rims: { drawn: boolean } }).rims.drawn === true, 'and the readout says the rim is being drawn');
  m.update(MARKS.rimLife + 0.1);
  ok(!additive.visible, 'the rim goes out and its mesh stops being drawn');
  ok(blended.visible, 'while the scar it left is still showing, so the blended mesh is still drawn');
  m.update(MARKS.scarLife);
  ok(!blended.visible, 'and when the last mark is gone neither of them is drawn');
  m.dispose();
}

// --- the look numbers are in the tuning, not in the shader ---------------------------------------

{
  const m = new Marks();
  const material = (m.mesh.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>).material;
  const u = material.uniforms;
  m.update(0);
  ok(u.uEdge.value === MARKS.edge, 'the edge the shape fades out over is the tuning’s');
  ok(u.uScarWeight.value === MARKS.scarWeight, 'how hard a scar is laid over what is under it is the tuning’s');
  ok(u.uPrintWeight.value === MARKS.printWeight, 'and so is a print’s');
  ok(u.uCoolAlpha.value === MARKS.coolAlpha, 'and what is left of a mark once its edge has cooled');
  const hot = u.uScarHot.value as THREE.Vector3;
  near(hot.x, ((MARKS.colour.scarHot >> 16) & 255) / 255, 1e-6, 'a colour reaches the shader as the number typed, with nothing converted');
  const wasColour = MARKS.colour.scarHot;
  tuneMarks({ colour: { scarHot: 0x00ff00 }, edge: 0.5, printWeight: 0.3 });
  m.update(0);
  near(hot.y, 1, 1e-6, 'and a colour moved from the console is on the next frame’s draw');
  ok(u.uEdge.value === 0.5 && u.uPrintWeight.value === 0.3, 'as are the weights and the edge');
  const report = m.report() as { tune: { colour: Record<string, number> } };
  ok(report.tune.colour.scarHot === 0x00ff00, 'and the readout carries the colours, so nothing about a mark’s look is out of reach');
  tuneMarks({ colour: { scarHot: wasColour }, edge: 0.78, printWeight: 0.55 });
  m.dispose();
}

// The blade's own ring is the one its own file held: a stroke lays a piece every `step`, so the
// share is how much of a long drag the world can still be holding while its life runs.
{
  const m = new Marks();
  const saber = (m.report() as { kinds: Record<string, { capacity: number }> }).kinds.saber.capacity;
  ok(saber === 900, `the blade keeps the 900 pieces it always had (${saber})`);
  near((saber * MARKS.step) / 1, 10.8, 0.01, 'which is ten metres and more of dragged stroke, as before');
  m.dispose();
}

// --- what this system does not keep a number or a rule for ---------------------------------------

// Two things were written here while the wave was being built and were taken out at the merge,
// because each already had a home and a value with two homes drifts. A print's length, width and
// life belong to whoever lays the print (`PRINT_TUNE` in `src/world/footprints.ts`), since they are
// scaled by the body and graded by the ground; a gun name's scar family belongs to the gun side
// (`scarFamilyFor` in `src/combat/scars.ts`), which knows both a gun's own type and its weapon
// effect family. This is the check that neither comes back.
{
  ok(!('printLength' in MARKS), 'the marks keep no length of their own for a print');
  ok(!('printWidth' in MARKS), 'nor a width');
  ok(!('printLife' in MARKS), 'nor a life, so `__debug.marks()` offers no number that moves no print');
  tuneMarks({ printLife: 90 });
  ok(!('printLife' in MARKS), 'and writing one from the console adds none');
  // What a print *looks* like where it is drawn is still the marks': how hard it is laid over what
  // is under it, and what colour it cools to. Those have no second home anywhere.
  ok(typeof MARKS.printWeight === 'number', 'how hard a print is laid over the ground is still the marks’ own');
}

// --- the knob -------------------------------------------------------------------------------------

{
  const wasLife = MARKS.scarLife;
  const wasSize = MARKS.scarSize.bolt;
  const wasPieces = MARKS.pieces;
  const refused: string[] = [];
  tuneMarks({ scarLife: 60, scarSize: { bolt: 0.4 }, pieces: 50, rims: 2 }, refused);
  ok(MARKS.scarLife === 60, 'a number the console moves takes effect at once');
  ok(MARKS.scarSize.bolt === 0.4, 'and so does one family’s own size');
  ok(MARKS.pieces === wasPieces, 'a number spent when the meshes were built is not written');
  ok(refused.indexOf('pieces') >= 0 && refused.indexOf('rims') >= 0, 'it is refused by name instead, so nothing reports a change that did not happen');
  for (const key of MARKS_BUILD_ONLY) ok(key in MARKS, `${key} is a real number of the tuning and not a name that has gone`);
  tuneMarks({ scarLife: -5 });
  ok(MARKS.scarLife > 0, 'a life of nothing is floored rather than dividing by nought in the shader');
  tuneMarks({ scarLife: wasLife, scarSize: { bolt: wasSize } });
  ok(MARKS.scarLife === wasLife && MARKS.scarSize.bolt === wasSize, 'and everything goes back where it was');
}

// --- the old name -----------------------------------------------------------------------------------

ok((new SaberMarks() as unknown) === theMarks, 'the old name hands back the one set of marks and never a second ring');
ok(typeof theMarks.mesh === 'object' && (theMarks.mesh as THREE.Object3D).children.length === 2, 'and what the scene takes from it is both meshes at once');

console.log(`\n${checks} checks passed`);
