// Climbing II, Smoothness II, item 1's drops after the round's review: a let-go drop's clip on the game's own rig
// (src/player/rig.ts's `CharacterRig`, the pack's ledge clips fitted to the human male), driven by the game's own lines: the
// hang's hand-over (`driveHangClips`) on the let-go frame, then every frame off the ledge the player's own drop call
// (`driveDropClip` in src/player/hangClips.ts, which the player's `ledgeClocks` and the harness's frame both call), through
// the grapple's harness on the real Rapier, at 30, 60, 144 and 240 frames a second:
//  - held at the feet's touch while still falling, the drawn clip stands at the touch to the microsecond at every rate (it
//    stood a frame past it before, by the rate);
//  - a drop into deep water ends as the body swims (it stood frozen in the drop's pose for good before), and so does one the
//    body stops falling for by any other way (`falling` false: the rope);
//  - a drop nothing drives any more (the player's frame on a path that runs no drop) is let go by the rig itself
//    (`DROP_LEASE`), and one held at the touch for ever is handed over at `DROP_HOLD_MOST`;
//  - the player's and the harness's calls pinned as text (deleting the player's call fails here).
//
// Run: node tools/swg/tests/smooth2Drop.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { join } from 'node:path';
import * as THREE from 'three';

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

const { CharacterRig } = await import('../../../src/player/rig.ts');
const { DROP_LEASE, driveDropClip, driveHangClips } = await import('../../../src/player/hangClips.ts');
const { MixamoPack } = await import('../../../src/anim/mixamoPack.ts');
const { LEDGE_IDS, ledgeClipName } = await import('../../../src/anim/ledgeClips.ts');
const { LEDGE_HANG, LEDGE_NONE } = await import('../../../src/player/ledge.ts');
const { resetClimbTune: resetShipped, climbSmooth3Before, tuneClimb } = await import('../../../src/anim/climbTune.ts');
// (Smoothness III's switches at their other setting too: this suite holds Smoothness II's climbing.)
const resetClimbTune = (): void => {
  resetShipped();
  climbSmooth3Before();
};
const { resetMoveTune: resetMoveShipped, moveSmooth3Before } = await import('../../../src/anim/moveTune.ts');
// (Smoothness III's body switches at their other setting too: this suite holds the body before it.)
const resetMoveTune = (): void => {
  resetMoveShipped();
  moveSmooth3Before();
};
const { handMoment } = await import('../../../src/anim/handTimes.ts');
const { glbSkeleton, speciesBodies, targetSkeleton } = await import('./animFixtures.ts');
const { REPO } = await import('./oldModules.ts');
const { TestBody, box, ground, makePhysics } = await import('./grappleBody.ts');
const { runUntil } = await import('./climbCourseBody.ts');
type Body = InstanceType<typeof TestBody>;
type Rig = InstanceType<typeof CharacterRig>;

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const RATES = [30, 60, 144, 240] as const;

const sp = speciesBodies(REPO).find((x) => x.id === 'human_male');
const target = sp ? glbSkeleton(sp.body) : targetSkeleton();
note(sp ? "the converted human male's skeleton" : "no converted human male here: the tests' own skeleton");
const packDir = join(REPO, 'public', 'anims', 'mixamo');
const pack = new MixamoPack({
  enabled: () => true,
  index: async () => readFileSync(join(packDir, 'index.json'), 'utf8'),
  clip: async (file: string) => {
    const b = readFileSync(join(packDir, file));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  },
  breath: async () => {},
  also: LEDGE_IDS,
  now: () => performance.now(),
});
const info = console.info;
console.info = () => {};
const clips = await pack.clipsFor(target as never, 'hands');
console.info = info;

function skeleton(): THREE.Group {
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.fromArray(target.base.p);
  inner.quaternion.fromArray(target.base.q);
  root.add(inner);
  const made: THREE.Bone[] = [];
  target.joints.forEach((j) => {
    const b = new THREE.Bone();
    b.name = j.name;
    b.position.fromArray(j.restP);
    b.quaternion.fromArray(j.restQ);
    made.push(b);
    (j.parent < 0 ? inner : made[j.parent]).add(b);
  });
  return root;
}

/** A body braced on a wall of height `H` (its foot at `floor`, a sea's surface at `sea` or none), the rig handed to its frame. */
async function braced(H: number, floor: number, sea: number | null, fps: number): Promise<{ b: Body; rig: Rig; st: { posePlaying: string; hangFade: { fade: number }; ladderRate: { rate: number; fade: number } } }> {
  const p = await makePhysics();
  ground(p, floor);
  box(p, [-3, floor, 1], [3, H, 2.5]);
  p.stepOnce();
  (p as unknown as { acc: number }).acc = 0;
  const b = new TestBody(p);
  if (sea !== null) b.surface = () => sea;
  b.jka.forceLevel = 0;
  b.place(0, H - 1.6, 0.4);
  b.forward.set(0, 0, 1);
  b.right.set(-1, 0, 0);
  b.heading = 0;
  b.vel.set(0, -1, 0);
  b.grounded = false;
  b.key('KeyE', true);
  runUntil(b, fps, 3, () => b.ledge.phase === LEDGE_HANG);
  b.key('KeyE', false);
  runUntil(b, fps, 0.4, () => false);
  const rig = CharacterRig.fromCharacter({ group: skeleton(), clips } as never);
  const st = { posePlaying: '', hangFade: { fade: 0.15 }, ladderRate: { rate: 1, fade: 0.15 } };
  return { b, rig, st };
}

/** The crouch tap's frame (the hang's step, then the player's `animateHang`), then the rig handed to the frame's drop call. */
function letGo(b: Body, rig: Rig, st: Parameters<typeof driveHangClips>[3], fps: number): string {
  b.key('ControlLeft', true);
  b.frame(1 / fps);
  driveHangClips(rig, b.ledge, 1 / fps, st);
  b.key('ControlLeft', false);
  b.dropRig = rig;
  return b.ledge.dropId;
}

// ---- 1. held at the touch alike at every rate, played out and handed over on landing ---------------------------------------
for (const fps of RATES) {
  resetClimbTune();
  resetMoveTune();
  const { b, rig, st } = await braced(20, 0, null, fps);
  const id = letGo(b, rig, st, fps);
  const name = ledgeClipName(id);
  const tT = handMoment(id, 'touch');
  ok(!!id && rig.overrideName === name, `a 20 m fall @${fps}: let go into the drop's clip (${id})`);
  let heldAt = Number.NaN;
  let worstHeld = 0;
  let handed = false;
  for (let k = 0; k < Math.round(6 * fps); k++) {
    b.frame(1 / fps);
    rig.update(1 / fps);
    // (Held: the clock's rate this frame nought while the body still falls.)
    if (!b.grounded && b.ledge.dropId && rig.overrideName === name && b.ledge.dropRateNow === 0) {
      const at = rig.overrideAt();
      heldAt = at;
      worstHeld = Math.max(worstHeld, Math.abs(at - tT));
    }
    if (!b.ledge.dropId && rig.overrideName !== name) {
      handed = true;
      break;
    }
  }
  ok(heldAt === heldAt && worstHeld < 1e-6, `a 20 m fall @${fps}: the drawn clip held at the feet's touch (${tT} s) to the microsecond (${heldAt.toFixed(6)})`);
  ok(handed && b.grounded, `a 20 m fall @${fps}: played out after the landing and handed to the loop that follows`);
  b.physics.world.removeRigidBody(b.body);
}

// ---- 2. into deep water: the drop ends as the body swims ---------------------------------------------------------------------
for (const fps of RATES) {
  resetClimbTune();
  resetMoveTune();
  const { b, rig, st } = await braced(4, -8, 0, fps);
  const id = letGo(b, rig, st, fps);
  const name = ledgeClipName(id);
  let swimAt = -1;
  let endedAt = -1;
  for (let k = 0; k < Math.round(8 * fps); k++) {
    b.frame(1 / fps);
    rig.update(1 / fps);
    if (b.swimming && swimAt < 0) swimAt = k;
    if (swimAt >= 0 && endedAt < 0 && !b.ledge.dropId && rig.overrideName !== name) endedAt = k;
  }
  ok(!!id && swimAt >= 0 && endedAt >= swimAt && endedAt <= swimAt + 1, `into deep water @${fps}: the drop's clip handed to the swim the frame the body swims (swimming at ${swimAt}, ended at ${endedAt})`);
  ok(b.swimming && !b.ledge.dropId && rig.overrideName === null, `into deep water @${fps}: 8 s on, swimming with no drop and no one-off held (${rig.overrideName})`);
  b.physics.world.removeRigidBody(b.body);
}

// ---- 3. anything but falling (the rope): ended at once ---------------------------------------------------------------------
for (const fps of RATES) {
  resetClimbTune();
  resetMoveTune();
  const { b, rig, st } = await braced(20, 0, null, fps);
  const id = letGo(b, rig, st, fps);
  const name = ledgeClipName(id);
  for (let k = 0; k < Math.round(0.6 * fps); k++) {
    b.frame(1 / fps);
    rig.update(1 / fps);
  }
  const live = b.ledge.dropId === id && rig.overrideName === name;
  b.dropRig = null;
  // The rope caught: the player hands `falling` false (on the rope); the drop ends this frame and is handed to the rope's loop.
  driveDropClip(rig, b.ledge, 1 / fps, false, false);
  rig.update(1 / fps);
  ok(live && !b.ledge.dropId && rig.overrideName === null, `on the rope mid-fall @${fps}: the drop ended at once and handed over`);
  b.physics.world.removeRigidBody(b.body);
}

// ---- 4. a drop nothing drives any more is let go by the rig; one held for ever is handed over at the backstop -------------
for (const fps of RATES) {
  resetClimbTune();
  resetMoveTune();
  const { b, rig, st } = await braced(20, 0, null, fps);
  const id = letGo(b, rig, st, fps);
  const name = ledgeClipName(id);
  b.dropRig = null;
  // (The player's frame stops driving the drop: mounted, in noclip, aboard. The rig alone runs.)
  let gone = -1;
  for (let k = 0; k < Math.round(2 * fps); k++) {
    rig.update(1 / fps);
    if (rig.overrideName !== name) {
      gone = (k + 1) / fps;
      break;
    }
  }
  ok(!!id && gone > 0 && gone <= DROP_LEASE + 1 / fps + 1e-9, `a drop nobody drives @${fps}: the rig lets it go itself after ${gone.toFixed(3)} s (the lease ${DROP_LEASE} s)`);
  b.physics.world.removeRigidBody(b.body);
}
for (const fps of [30, 240]) {
  resetClimbTune();
  resetMoveTune();
  const { b, rig, st } = await braced(20, 0, null, fps);
  const id = letGo(b, rig, st, fps);
  b.dropRig = null;
  // Never landing (the clocks alone, the body never meeting anything): held at the touch, then handed over.
  let cutAt = -1;
  for (let k = 0; k < Math.round(16 * fps); k++) {
    b.ledge.tick(1 / fps);
    driveDropClip(rig, b.ledge, 1 / fps, false, true);
    rig.update(1 / fps);
    if (!b.ledge.dropId) {
      cutAt = (k + 1) / fps;
      break;
    }
  }
  ok(!!id && cutAt > 10 && cutAt < 11.5 && rig.overrideName === null, `a fall that never lands @${fps}: held at the touch and handed to the falling loop at the backstop (${cutAt.toFixed(2)} s)`);
  b.physics.world.removeRigidBody(b.body);
}

// ---- 5. 'before': no drop by the rule at all -------------------------------------------------------------------------------
for (const fps of [30, 144]) {
  resetClimbTune();
  resetMoveTune();
  tuneClimb({ hopFlight: 'before' });
  const { b, rig, st } = await braced(4, 0, null, fps);
  const id = letGo(b, rig, st, fps);
  ok(id === '' && b.ledge.phase === LEDGE_NONE, `under 'before' @${fps}: let go with no drop by the rule (the cut as ever)`);
  b.physics.world.removeRigidBody(b.body);
}
resetClimbTune();

// ---- 6. the calls, as text: the player's `ledgeClocks` and the harness's frame -----------------------------------------------
{
  const text = (p: string) => readFileSync(join(REPO, p), 'utf8').replace(/\r\n/g, '\n');
  const player = text('src/player/player.ts');
  const harness = text('tools/swg/tests/grappleBody.ts');
  const hangClips = text('src/player/hangClips.ts');
  const at = player.indexOf('  private ledgeClocks(dt: number): void {');
  const clocks = at >= 0 ? player.slice(at, player.indexOf('\n  }\n', at)) : '';
  const tick = 'if (this.ledge.tick(dt)) this.heading = this.ledge.turnNow;';
  const call = 'driveDropClip(this.rig, this.ledge, dt, this.grounded, !this.swimming && !this.grapple.attached && !this.grapple.released);';
  ok(clocks.indexOf(tick) >= 0 && clocks.indexOf(call) > clocks.indexOf(tick), "the player's `ledgeClocks`: the ledge's tick, then the drop's call with the body's grounded and whether it still falls");
  ok(!/dropClocks|overrideSeek|overrideRate|blendOut|yieldOverride/.test(clocks), "the player's `ledgeClocks` keeps no copy of the drop's lines (they are `driveDropClip`'s)");
  const hcall = 'driveDropClip(this.dropRig, this.ledge, dt, this.grounded, !this.swimming && !(this.hooks && (g.attached || g.released)));';
  ok(harness.indexOf(tick) >= 0 && harness.indexOf(hcall) > harness.indexOf(tick), "the harness's frame: the same call in the same place");
  ok(hangClips.includes('rig.holdOverride(ledgeClipName(L.dropId), DROP_LEASE);') && hangClips.includes('if (L.dropId) rig.holdOverride(name, DROP_LEASE);'), "the drop's hold is a lease, renewed every frame the drop is driven");
}

console.log(`\nsmooth2Drop: ${checks} checks passed`);
