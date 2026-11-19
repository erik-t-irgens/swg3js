// Climbing II, phase 6 (vaults and clambers), maker A's items 1 and 2, through the game's own movement and climbing on the real Rapier
// (the course's harness, `climbVaultsBody.ts`) at 30, 60, 144 and 240 frames a second while moving: a sprint at each `obstacle-*`
// piece and each clamber vaulting, diving or clambering by its height and depth as the rule says (the top between `vaultLow` and
// `vaultHigh` with ground within `vaultFar` vaulted by the clip whose hand's own height is nearest it, past `vaultDeep` dived over
// up to `diveHigh`; a waist-high ledge deeper than that clambered onto), begun before the face, the body put down past the far side
// (a clamber's on the top) on the ground and running on at the speed it came with, the same place at every rate from the vault's own
// clock (its frames, and its end to a millionth); a face too high for anything run into as today; the clamber cut while the sprint
// is held and played whole to standing when it is not ('run' with no sprint); 'run' vaulting a run; the speed classes' paces the
// switch reads held to the classes' own; and what only the game hands over (the player's dispatch, its sense after the wall's, the
// clocks, the figure's root, the harness's matching lines, the clip on the rig) pinned through the real code or as text.
//
// Run: node tools/swg/tests/climbVaults.test.ts
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import { join } from 'node:path';

const charStub = 'export class Character { static async load() { throw new Error("no pack in a test"); } }';
const hook = `import { existsSync } from 'node:fs';
export async function resolve(s, c, next) {
  if (s === './character' || s === './character.ts' || s.endsWith('/player/character') || s.endsWith('/player/character.ts')) {
    return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(charStub)}), shortCircuit: true };
  }
  if (s.startsWith('.') && !/\\.[a-z]+$/.test(s) && c.parentURL && existsSync(new URL(s + '.ts', c.parentURL))) return next(s + '.ts', c);
  return next(s, c);
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const THREE = await import('three');
const { vaultCourse, vaultRun, SPRINT_SHARE } = await import('./climbVaultsBody.ts');
const { standPiece, RATES } = await import('./climbCourseBody.ts');
const { climbCourse } = await import('../../../src/anim/climbCourse.ts');
const { MOVE_TUNE, resetMoveTune, tuneMove } = await import('../../../src/anim/moveTune.ts');
const { resetClimbTune } = await import('../../../src/anim/climbTune.ts');
const { VAULT_FACTS, VAULT_OVER, VAULT_CLIP_NAMES, VAULT_IDS } = await import('../../../src/anim/vaultClips.ts');
const { VAULT_PACE_RUN, VAULT_PACE_SPRINT, Vault, VaultIn } = await import('../../../src/player/vault.ts');
const { RUN, SPRINT } = await import('../../../src/anim/locoClass.ts');
const { LOCO_TUNE } = await import('../../../src/anim/locoTune.ts');
const { driveVaultClips, releaseVaultClip } = await import('../../../src/player/hangClips.ts');
const { CharacterRig } = await import('../../../src/player/rig.ts');
const { MixamoPack } = await import('../../../src/anim/mixamoPack.ts');
const { glbSkeleton, speciesBodies } = await import('./animFixtures.ts');
const { REPO } = await import('./oldModules.ts');
const { TestBody, box, ground, makePhysics, RAPIER } = await import('./grappleBody.ts');

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const text = (rel: string) => readFileSync(join(REPO, rel), 'utf8').replace(/\r\n/g, '\n');
const r3 = (v: number) => Math.round(v * 1000) / 1000;

resetMoveTune();
resetClimbTune();
const T = MOVE_TUNE;

// ---- what the rule says of a piece, from its own numbers --------------------------------------------------------------------------
type Want = { kind: 'vault' | 'dive' | 'clamber' | ''; clip: string };
function wanted(h: number, d: number): Want {
  if (d > T.vaultFar) return h >= T.clamberLow && h <= T.clamberHigh ? { kind: 'clamber', clip: 'running_jump' } : { kind: '', clip: '' };
  if (h < T.vaultLow || h > T.vaultHigh) return { kind: '', clip: '' };
  if (d > T.vaultDeep && h <= T.diveHigh) return { kind: 'dive', clip: 'jump_over' };
  // The vault whose hand's own height is nearest the top (the first of equals: `jumping_2` is `jumping_1`'s twin).
  let best = '';
  let e = Infinity;
  for (const id of VAULT_OVER) {
    const x = Math.abs(VAULT_FACTS[id].hand - h);
    if (x < e) {
      e = x;
      best = id;
    }
  }
  return { kind: 'vault', clip: best };
}

// ---- the course, at the shipped settings -----------------------------------------------------------------------------------------
const { runs } = await vaultCourse();
const pieces = climbCourse({}).pieces;
const sprints = runs.filter((r) => r.pace === 'sprint' && (r.id.startsWith('obstacle-') || r.id.startsWith('clamber-')));
ok(sprints.length === 14 * RATES.length, `a sprint at each of the 12 obstacles and 2 clambers at every rate (${sprints.length} runs)`);
for (const r of sprints) {
  const p = pieces.find((q) => q.id === r.id)!;
  const h = p.numbers.height as number;
  const d = p.numbers.clamber ? Infinity : (p.numbers.depth as number);
  const w = wanted(h, d);
  const took = r.counts.vaults + r.counts.dives + r.counts.clambers;
  if (!w.kind) {
    ok(took === 0 && r.verdict === 'high' && Math.abs(r.end[2] - (p.lips[0].a[2] - 0.39)) < 0.01, `${r.key}: a ${h} m top is too high for anything: run into as today (stopped at the face, ${r3(r.end[2])})`);
    continue;
  }
  ok(took === 1 && r.kind === w.kind && r.clip === w.clip, `${r.key}: a ${h} m top ${Number.isFinite(d) ? `${d} m deep` : 'that goes on'} is ${w.kind === 'vault' ? `vaulted by ${w.clip}` : w.kind === 'dive' ? 'dived over' : 'clambered onto'}`);
  ok(r.frames.length > 0 && r.frames[0].along < 0, `${r.key}: begun before the face (${r3(r.frames[0].along)} m from it)`);
  if (w.kind === 'clamber') ok(Math.abs(r.endY - h) < 1e-6 && r.endAlong > 0 && r.counts.cuts === 1, `${r.key}: put down on the top (${r3(r.endY)} m), ${r3(r.endAlong)} m in, cut at the second foot while the sprint is held`);
  else ok(r.endAlong > d && r.endY < 0.001 && r.endY > -0.06, `${r.key}: put down ${r3(r.endAlong - d)} m past the far side, on the ground (${r3(r.endY)} m)`);
  ok(Math.abs(r.speedAtEnd - r.speed) < 1e-9 && Math.abs(r.speed - LOCO_TUNE.speed.forward.sprint) < 0.01, `${r.key}: running on at the speed it came with (${r3(r.speedAtEnd)} m/s, the sprint's)`);
  ok(r.groundedAfter && r.speedAfter > 0.95 * r.speed, `${r.key}: half a second later on the ground and still sprinting (${r3(r.speedAfter)} m/s)`);
}
// Alike between the rates, from the moment it starts: the clip, its rate, the place it put the body down; and every frame of it
// against the 240 frames a second run's at the same clip time (the path is a function of the vault's clock, never of a frame).
for (const id of [...new Set(sprints.map((r) => r.id))]) {
  const by = RATES.map((fps) => sprints.find((r) => r.id === id && r.fps === fps)!);
  if (by[0].counts.vaults + by[0].counts.dives + by[0].counts.clambers === 0) {
    ok(by.every((r) => r.counts.vaults + r.counts.dives + r.counts.clambers === 0), `${id}: nothing at any rate`);
    continue;
  }
  const fine = by[by.length - 1];
  ok(by.every((r) => r.clip === fine.clip && Math.abs(r.rate - fine.rate) < 1e-9 && Math.abs(r.endAlong - fine.endAlong) < 1e-6 && Math.abs(r.endY - fine.endY) < 1e-3), `${id}: the same clip at every rate (${fine.clip}, at ${r3(fine.rate)}), put down at the same place to a millionth (${r3(fine.endAlong)} m from the face, ${r3(fine.endY)} up)`);
  let worstAlong = 0;
  let worstY = 0;
  for (const r of by.slice(0, -1)) {
    for (const fr of r.frames) {
      const k = fine.frames.findIndex((g) => g.t >= fr.t);
      if (k <= 0) continue;
      const a = fine.frames[k - 1];
      const b = fine.frames[k];
      const u = (fr.t - a.t) / (b.t - a.t);
      worstAlong = Math.max(worstAlong, Math.abs(fr.along - (a.along + (b.along - a.along) * u)));
      worstY = Math.max(worstY, Math.abs(fr.y - (a.y + (b.y - a.y) * u)));
    }
  }
  ok(worstAlong < 0.01 && worstY < 0.03, `${id}: every frame at 30, 60 and 144 on the 240 run's path at its own clip time (worst ${r3(worstAlong)} m along, ${r3(worstY)} m up: the feet's own height in the run-up)`);
  const starts = by.map((r) => r3(r.frames[0].along)).join(', ');
  note(`${id}: begun at ${starts} m from the face at 30, 60, 144, 240 (the run-up's own frames: a frame later at the lower rates, the clip started that much further in)`);
}
// A walk and a run (with 'sprint') stop as today: no vault, the body at the face.
for (const r of runs.filter((q) => q.pace !== 'sprint' && (q.id.startsWith('obstacle-') || q.id.startsWith('clamber-')))) {
  if (!(r.counts.vaults + r.counts.dives + r.counts.clambers === 0 && Math.abs(r.end[2] - (pieces.find((q) => q.id === r.id)!.lips[0].a[2] - 0.39)) < 0.01)) ok(false, `${r.key}: a ${r.pace} stops at the face`);
}
ok(true, "every walk and every run at every obstacle and clamber stops at the face, nothing vaulted (with 'sprint')");
// The braced lips: the 1.2 m one is a top the rule takes; the 1.8 and 2.4 m faces nothing does.
for (const r of runs.filter((q) => q.pace === 'sprint' && q.id.startsWith('lip-'))) {
  const took = r.counts.vaults + r.counts.dives + r.counts.clambers;
  if (r.id === 'lip-braced-1.2') ok(took === 1, `${r.key}: a 1.2 m braced top is taken (${r.kind} ${r.clip})`);
  else ok(took === 0 && r.verdict === 'high' && Math.abs(r.end[2] - 4.61) < 0.01, `${r.key}: a ${r.id.slice(11)} m face is too high: the wall as today`);
}

// ---- the clamber played whole when the sprint is not held, and 'run' --------------------------------------------------------------
{
  tuneMove({ vault: 'run' });
  const p = pieces.find((q) => q.id === 'clamber-1')!;
  const s = await standPiece(p);
  for (const fps of RATES) {
    const r = vaultRun(s, fps, 'run');
    ok(r.kind === 'clamber' && r.counts.cuts === 0 && r.speedAtEnd === 0 && Math.abs(r.endY - 1) < 1e-6, `clamber-1@${fps}, 'run', a run: clambered onto and played whole to standing, the sprint not held (${r3(r.endAlong)} m in, ${r3(r.endY)} up)`);
  }
  const o = pieces.find((q) => q.id === 'obstacle-0.9x0.8')!;
  const so = await standPiece(o);
  const r = vaultRun(so, 60, 'run');
  ok(r.kind === 'vault' && Math.abs(r.speedAtEnd - r.speed) < 1e-9, `obstacle-0.9x0.8@60, 'run': a run vaults it too (${r.clip}), running on at its own ${r3(r.speed)} m/s`);
  const w = vaultRun(so, 60, 'walk');
  ok(w.counts.vaults === 0, "and a walk does not");
  resetMoveTune();
}

// ---- the switch's paces are the speed classes' own -------------------------------------------------------------------------------
ok(VAULT_PACE_RUN === RUN && VAULT_PACE_SPRINT === SPRINT, `the paces the switch reads are the speed classes' own (the run ${RUN}, the sprint ${SPRINT})`);
ok(Math.abs(SPRINT_SHARE * 250 * 0.0254 - LOCO_TUNE.speed.forward.sprint) < 1e-12, "the harness's sprint is the speed classes' sprint speed, as their share of Jedi Academy's run");

// ---- the sense's own refusals: not on the ground, nothing ahead, at a glance ----------------------------------------------------
{
  const P = await makePhysics();
  ground(P, 0);
  box(P, [-10, 0, 3], [10, 0.9, 3.8]);
  P.stepOnce();
  const b = new TestBody(P);
  b.place(0, 0, 0);
  const V = new Vault({ ray: () => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), capsule: (h, r) => new RAPIER.Capsule(h, r), cuboid: (x, y, z) => new RAPIER.Cuboid(x, y, z) });
  const vi = new VaultIn();
  vi.dt = 1 / 60;
  vi.vx = 0;
  vi.vz = 7;
  vi.grounded = true;
  vi.pace = VAULT_PACE_SPRINT;
  vi.scale = 1;
  vi.filter = b.filter;
  const at = (z: number) => {
    b.pos.set(0, 0, z);
    return V.sense(P.world as never, b, vi);
  };
  vi.grounded = false;
  ok(!at(1.2) && V.casts === 0, 'in the air: no vault, and nothing asked of the world');
  vi.grounded = true;
  vi.pace = VAULT_PACE_RUN;
  ok(!at(1.2) && V.casts === 0, "at the run under 'sprint': no vault, nothing asked");
  vi.pace = VAULT_PACE_SPRINT;
  ok(!at(-0.5) && V.verdict === 'waiting', 'met within the rays\' reach but too far yet for the clip\'s start: waiting');
  vi.vx = 7 * Math.sin(1);
  vi.vz = 7 * Math.cos(1);
  ok(!at(1) && V.verdict === 'glance', `met 57 degrees off square (past ${T.vaultAngle}): no vault`);
  vi.vx = 0;
  vi.vz = 7;
  ok(at(1.0) && V.kind === 'vault' && V.clip === 'jumping', 'met squarely within reach: vaulted');
}
// The landing a step down from the slab the obstacle stands on (the game's course: each piece on a slab 0.05 m over the ground
// round it, reaching `SLAB_MARGIN` past its solids, so a vault comes down beside the slab's edge): vaulted, and the body put down on
// the ground beyond; a landing where a wall stands is refused ('stand').
{
  const P = await makePhysics();
  ground(P, 0);
  box(P, [-10, 0, -20], [10, 0.05, 4.55]);
  box(P, [-1, 0.05, 3], [1, 0.95, 3.8]);
  P.stepOnce();
  const b = new TestBody(P);
  b.place(0, 0.05, 0);
  const V = new Vault({ ray: () => new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), capsule: (h, r) => new RAPIER.Capsule(h, r), cuboid: (x, y, z) => new RAPIER.Cuboid(x, y, z) });
  const vi = new VaultIn();
  vi.dt = 1 / 60;
  vi.vz = 7;
  vi.grounded = true;
  vi.pace = VAULT_PACE_SPRINT;
  vi.scale = 1;
  vi.filter = b.filter;
  b.pos.set(0, 0.05, 1);
  ok(V.sense(P.world as never, b, vi) && V.kind === 'vault' && Math.abs(V.y1) < 1e-3 && V.stretch === 0, `a landing a slab's step down beyond its edge (0.05 m): vaulted, and put down on the ground beyond (${r3(V.y1)} m), where its own flight takes it`);
  V.reset('test');
  // (A post beside the landing's own read down, inside the body standing there and a body's breadth further on.)
  box(P, [0.25, 0, 4.5], [0.45, 2, 5.4]);
  P.stepOnce();
  b.pos.set(0, 0.05, 1);
  ok(!V.sense(P.world as never, b, vi) && V.verdict === 'stand', 'a post where the landing would stand: refused (`stand`)');
}
// The same over ground falling away (the game's course on a slope: the slab 0.41 m over the ground beyond its end, as the driven
// tab's first vault met): the body standing at its own landing would be in the slab's edge, so it comes down the body's breadth
// further on, on the ground; run through the harness's own frames at every rate, it ends there clear of the edge and running on.
for (const fps of RATES) {
  const P = await makePhysics();
  ground(P, 0);
  box(P, [-10, -1, -30], [10, 0.41, 4.55]);
  box(P, [-1, 0.41, 3], [1, 1.31, 3.8]);
  P.stepOnce();
  const b = new TestBody(P);
  b.place(0, 0.41, -14);
  b.forward.set(0, 0, 1);
  b.right.set(-1, 0, 0);
  b.heading = 0;
  b.speedScale = SPRINT_SHARE;
  b.sprinting = true;
  b.key('KeyW', true);
  let began = false;
  let stretch = Number.NaN;
  let y1 = Number.NaN;
  for (let i = 0; i < 6 * fps; i++) {
    b.frame(1 / fps);
    if (b.vault.holding && !began) {
      began = true;
      stretch = b.vault.stretch;
      y1 = b.vault.y1;
    }
  }
  const v = Math.hypot(b.vel.x, b.vel.z);
  ok(began && Math.abs(y1) < 1e-3 && stretch >= 0.4 - 1e-9 && b.vault.endZ > 4.55 + 0.35 && b.pos.z > 8 && v > 6.9 && b.grounded, `@${fps}: over ground falling 0.41 m past the slab: vaulted, put down ${r3(b.vault.endZ - 3.8)} m past the far side on the ground beyond (the flight ${r3(stretch)} m longer), clear of the slab's edge, still sprinting (${r3(v)} m/s)`);
}

// ---- the clip on the rig, by the vault's own clock --------------------------------------------------------------------------------
{
  const body = speciesBodies(REPO).find((x) => x.id === 'human_male');
  if (!body || !existsSync(body.body)) note('the human male is not converted here: the clip on the rig is not tried');
  else {
    const target = glbSkeleton(body.body);
    const packDir = join(REPO, 'public', 'anims', 'mixamo');
    const pack = new MixamoPack({
      enabled: () => true,
      index: async () => readFileSync(join(packDir, 'index.json'), 'utf8'),
      clip: async (file: string) => {
        const bb = readFileSync(join(packDir, file));
        return bb.buffer.slice(bb.byteOffset, bb.byteOffset + bb.byteLength) as ArrayBuffer;
      },
      breath: async () => {},
      also: [...VAULT_IDS],
      now: () => performance.now(),
    });
    const info = console.info;
    console.info = () => {};
    const clips = await pack.clipsFor(target as never, 'vaults');
    console.info = info;
    const root = new THREE.Group();
    const inner = new THREE.Group();
    inner.position.fromArray(target.base.p);
    inner.quaternion.fromArray(target.base.q);
    root.add(inner);
    const bones: InstanceType<typeof THREE.Bone>[] = [];
    target.joints.forEach((j) => {
      const bn = new THREE.Bone();
      bn.name = j.name;
      bn.position.fromArray(j.restP);
      bn.quaternion.fromArray(j.restQ);
      bones.push(bn);
      (j.parent < 0 ? inner : bones[j.parent]).add(bn);
    });
    const rig = CharacterRig.fromCharacter({ group: root, clips } as never);
    const st = { posePlaying: '', hangFade: { fade: 0.15 }, ladderRate: { rate: 1, fade: 0.15 } };
    const P = await makePhysics();
    ground(P, 0);
    box(P, [-1, 0, 3], [1, 0.9, 3.8]);
    P.stepOnce();
    const b = new TestBody(P);
    b.place(0, 0, 1);
    const V = b.vault;
    const vi = new VaultIn();
    vi.dt = 1 / 60;
    vi.vz = 7;
    vi.grounded = true;
    vi.pace = VAULT_PACE_SPRINT;
    vi.scale = 1;
    vi.filter = b.filter;
    ok(V.sense(P.world as never, b, vi), 'a vault begun for the rig');
    let heldAll = true;
    let frames = 0;
    // In the game's own order (`vaultFrame`): the frame it began, its step with nothing advanced, then the clip handed over.
    V.step(b, vi, false);
    driveVaultClips(rig as never, V, 0, st as never);
    ok(rig.overrideName === VAULT_CLIP_NAMES[V.clip] && Math.abs(rig.overrideAt() - V.t) < 1e-9, `its clip taken up by the rig at the vault's own start, after the frame's step as the game takes it (${r3(V.t)} s)`);
    while (V.holding && frames < 600) {
      V.step(b, vi, true);
      driveVaultClips(rig as never, V, 1 / 60, st as never);
      frames++;
      if (V.holding && Math.abs(rig.overrideAt() - V.t) > 1e-9) heldAll = false;
    }
    ok(heldAll && frames > 10, `the clip held at the vault's own clock on each of its ${frames} frames (no number handed across a call: the rig's own field)`);
    ok(V.ended && rig.overrideName === null, 'at its end the clip crossfaded out into the run (the rig carries no one-off)');
    // Let go of under way (stood elsewhere): the held clip let go of where nothing else did.
    b.place(0, 0, 1);
    ok(V.sense(P.world as never, b, vi), 'a second vault begun');
    V.step(b, vi, false);
    driveVaultClips(rig as never, V, 0, st as never);
    V.reset('stood elsewhere');
    releaseVaultClip(rig as never, V);
    ok(rig.overrideName === null && !V.dropped, 'a vault let go of under way lets go of its held clip on the next clocks (`releaseVaultClip`)');
  }
}

// ---- what only the game hands over, pinned as text --------------------------------------------------------------------------------
{
  const pl = text('src/player/player.ts');
  ok(pl.includes("    if (this.wall.holding) {\n      this.wallFrame(dt, input, cam, world);\n      return;\n    }\n    // Climbing II, phase 6: over (or onto) an obstacle (`Vault`), the vault has the body in place of the movement. Never under\n    // `move.vault` 'off', where nothing ever vaults.\n    if (this.vault.holding) {\n      this.vaultFrame(dt, input, cam, true);\n      return;\n    }"), "the player's update: a vault under way has the body in place of the movement, right after the wall's");
  ok(pl.includes("    if (this.senseWall(dt, input, move, wasGrounded, atControls)) {\n      this.wallFrame(dt, input, cam, world);\n      return;\n    }\n    // Climbing II, phase 6:") && pl.includes('    if (this.senseVault(dt, atControls)) {\n      this.vaultFrame(dt, input, cam, false);\n      return;\n    }'), "the player's update: the vault sensed after the move, after everything the use key takes (the wall's start the last of them), its first frame run with nothing advanced");
  ok(pl.includes('    releaseVaultClip(this.rig, this.vault);\n    this.vault.tick(dt);\n  }'), "the player's clocks: a vault let go of under way lets go of its clip, and its drawn offset eases out");
  ok(pl.includes('    if (rig && (this.vaultRooted || this.vault.offset)) {\n      if (this.vault.offset) this.applyVaultRoot();') && pl.includes('    rig.root.position.y += V.offY;\n    rig.root.position.z = V.offFwd;'), "the figure drawn on the clip's own path against the body (`applyVaultRoot`, in `placeVisual`)");
  ok(pl.includes("    this.pole.reset('stood elsewhere');\n    // (Phase 6: nor a vault.)\n    this.vault.reset('stood elsewhere');") && pl.includes("    if (this.vault.holding) this.vault.reset('off the feet');"), 'stood elsewhere, or off the feet: nothing vaults');
  ok(pl.includes('    vi.pace = this.loco.rules && this.loco.moves ? this.loco.cls : 0;') && pl.includes("    vi.sprintHeld = this.loco.asked > 3 && input.held('speedUp') && input.held('forward');") && !/vaultFrame[\s\S]{0,400}this\.loco\.keys\(/.test(pl), "the body's pace the speed classes' own, and the sprint held the class the vault began at, with Shift and W still down (the speed keys read by the movement alone, once a frame)");
  const gb = text('tools/swg/tests/grappleBody.ts');
  ok(gb.includes("    if (this.vault.holding) {\n      this.vaultFrame(dt, true);\n      return;\n    }") && gb.includes('      if (this.vault.sense(this.physics.world as unknown as VaultWorld, this, vi)) {\n        this.takenByVault();\n        this.vaultFrame(dt, false);\n        return;\n      }') && gb.includes('    this.vault.tick(dt);'), "the harness steps the vault in the player's own places");
  ok(gb.indexOf('if (this.wall.sense(') < gb.indexOf('if (this.vault.sense(') && pl.indexOf('if (this.senseWall(') < pl.indexOf('if (this.senseVault('), 'in both, the vault after the wall');
}
resetMoveTune();
resetClimbTune();
console.log(`climbVaults: ${checks} checks passed`);
