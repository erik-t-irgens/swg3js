// The world editor's hand on its selection (DESIGN.md §2.6, §2.14): R held turns every picked thing about one pivot as one
// piece, each turn composed in the world's frame (`r * q`); Shift+R tips and rolls about the view's own level axes, but only
// while no move key is held (with one held Shift is the fast flight and R turns); F raises by metres with no reach; C held
// scales about the pivot by `exp(scalePerPx * px)`, mouse up larger. The total of a movement is the same at 20, 60 and 144
// frames a second. One thing alone turns to the bit as the placing hand's own `applyHold` turned it at the wave's start
// (`5a4e765`, read out of git), and today's `applyHold` still answers exactly as that one did.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';
import { PLACE_HOLD_TUNE, applyHold, applyHoldMany, holdState, manyHoldState, tumbleAxes, type HeldThing, type HoldKind, type ManyHoldKind, type ViewAxes } from '../../../src/world/placeHold.ts';
import { PROP_TUNE } from '../../../src/world/propPlace.ts';
import { shiftTips } from '../../../src/editor/editorKeys.ts';

const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const PRE_WAVE = '5a4e765';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);

const thing = (x: number, y: number, z: number, yaw = 0): HeldThing => {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return { x, y, z, turn: { x: q.x, y: q.y, z: q.z, w: q.w }, sx: 1, sy: 1, sz: 1 };
};
const axes: ViewAxes = { fx: 0, fz: -1, rx: 1, rz: 0 };
tumbleAxes(0.3, -0.9, 0, axes);
const PIVOT = { x: 2, y: 0, z: -3 };

{
  // Three things turned by R about the pivot as one piece.
  const things = [thing(0, 0, 0), thing(4, 1, -3, 0.5), thing(2, 2, -8, -1.2)];
  const before = things.map((t) => ({ p: new THREE.Vector3(t.x, t.y, t.z), q: new THREE.Quaternion(t.turn.x, t.turn.y, t.turn.z, t.turn.w) }));
  const h = manyHoldState();
  applyHoldMany(h, 'turn', 0, 0, 1 / 60, 1, axes, things, PIVOT, 0.004, 0);
  ok(applyHoldMany(h, 'turn', 0, -30, 1 / 60, 1, axes, things, PIVOT, 0.004, 0.016), 'R held with the mouse moved up turns what is picked');
  // The frame's turn, worked out by the single thing's own rule: about the world's up by turnDelta's angle.
  const one = thing(0, 0, 0);
  applyHold(holdState(), 'turn', 0, 0, 1 / 60, 1, axes, { turn: one.turn, lift: 0 }, null, 0, 0);
  const plain = { turn: { x: 0, y: 0, z: 0, w: 1 }, lift: 0 };
  const hs = holdState();
  applyHold(hs, 'turn', 0, 0, 1 / 60, 1, axes, plain, null, 0, 0);
  applyHold(hs, 'turn', 0, -30, 1 / 60, 1, axes, plain, null, 0, 0.016);
  const r = new THREE.Quaternion(plain.turn.x, plain.turn.y, plain.turn.z, plain.turn.w);
  const angle = 2 * Math.atan2(r.y, r.w);
  ok(angle < 0, `mouse up turns clockwise seen from above (${((angle * 180) / Math.PI).toFixed(2)}°)`);
  let worst = 0;
  let worstQ = 0;
  for (let i = 0; i < things.length; i++) {
    const want = before[i].p.clone().sub(new THREE.Vector3(PIVOT.x, PIVOT.y, PIVOT.z)).applyQuaternion(r).add(new THREE.Vector3(PIVOT.x, PIVOT.y, PIVOT.z));
    worst = Math.max(worst, want.distanceTo(new THREE.Vector3(things[i].x, things[i].y, things[i].z)));
    const wq = r.clone().multiply(before[i].q);
    const got = new THREE.Quaternion(things[i].turn.x, things[i].turn.y, things[i].turn.z, things[i].turn.w);
    worstQ = Math.max(worstQ, 1 - Math.abs(wq.dot(got)));
  }
  ok(worst < 1e-12, `each thing's place is turned about the pivot by the frame's one turn (worst ${worst.toExponential(1)} m off)`);
  ok(worstQ < 1e-14, "and each thing's own turn is that turn composed in the world's frame, r * q (not q * r)");
  const d01 = Math.hypot(things[0].x - things[1].x, things[0].y - things[1].y, things[0].z - things[1].z);
  ok(Math.abs(d01 - before[0].p.distanceTo(before[1].p)) < 1e-12, 'so the selection keeps its shape: the distance between two things is unchanged');
}

{
  // Shift+R: a tip and a roll about the view's own level axes, given to all alike.
  const things = [thing(0, 0, 0), thing(3, 0, -3)];
  const h = manyHoldState();
  applyHoldMany(h, 'tumble', 0, 0, 1 / 60, 1, axes, things, PIVOT, 0.004, 0);
  applyHoldMany(h, 'tumble', 10, -20, 1 / 60, 1, axes, things, PIVOT, 0.004, 0.016);
  const a = new THREE.Quaternion(things[0].turn.x, things[0].turn.y, things[0].turn.z, things[0].turn.w);
  const b = new THREE.Quaternion(things[1].turn.x, things[1].turn.y, things[1].turn.z, things[1].turn.w);
  ok(1 - Math.abs(a.dot(b)) < 1e-14 && Math.abs(a.w) < 1, 'Shift+R tips and rolls every picked thing by the one turn');
  ok(shiftTips(true, false) && !shiftTips(true, true) && !shiftTips(false, false) && !shiftTips(false, true), 'Shift with R tips only while no move key is held; with one held Shift is the fast flight and R turns');
}

{
  // F: metres added to every thing, with no reach.
  const things = [thing(0, 0, 0), thing(1, 5, 1)];
  const h = manyHoldState();
  applyHoldMany(h, 'lift', 0, 0, 1 / 60, 1, axes, things, PIVOT, 0.004, 0);
  for (let i = 0; i < 400; i++) applyHoldMany(h, 'lift', 0, -200, 1 / 60, 1, axes, things, PIVOT, 0.004, i / 60);
  ok(things[0].y > PROP_TUNE.most && Math.abs(things[1].y - things[0].y - 5) < 1e-9, `F raises every thing alike, past the placing hand's ${PROP_TUNE.most} m reach (${things[0].y.toFixed(1)} m: the editor has no limits)`);
}

{
  // C: a scale about the pivot, mouse up larger.
  const things = [thing(4, 0, -3), thing(2, 2, -3)];
  const h = manyHoldState();
  applyHoldMany(h, 'scale', 0, 0, 1 / 60, 1, axes, things, PIVOT, 0.004, 0);
  ok(applyHoldMany(h, 'scale', 0, -50, 1 / 60, 1, axes, things, PIVOT, 0.004, 0.016), 'C held with the mouse moved up scales what is picked');
  const f = Math.exp(50 * 0.004);
  ok(Math.abs(things[0].sx - f) < 1e-12 && things[0].sx === things[0].sy && things[0].sy === things[0].sz, `by exp(scalePerPx × px), uniform (${things[0].sx.toFixed(4)})`);
  ok(Math.abs(things[0].x - (PIVOT.x + 2 * f)) < 1e-12 && Math.abs(things[1].y - 2 * f) < 1e-12, 'and every place is scaled about the pivot, so the selection grows as one piece');
  applyHoldMany(h, 'scale', 0, 50, 1 / 60, 1, axes, things, PIVOT, 0.004, 0.032);
  ok(Math.abs(things[0].sx - 1) < 1e-12 && Math.abs(things[0].x - 4) < 1e-12, 'mouse down by as much takes it back');
}

{
  // The same movement at three frame rates: 300 px up over one second, the hand's speed steady.
  const total = (fps: number, kind: ManyHoldKind, sideways: number) => {
    const t = thing(1, 0, 0);
    const h = manyHoldState();
    const n = fps;
    applyHoldMany(h, kind, 0, 0, 1 / fps, 1, axes, [t], PIVOT, 0.004, 0);
    for (let i = 0; i < n; i++) applyHoldMany(h, kind, sideways / n, -300 / n, 1 / fps, 1, axes, [t], PIVOT, 0.004, (i + 1) / fps);
    return t;
  };
  const diff = (p: HeldThing, q: HeldThing) => Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y), Math.abs(p.z - q.z), Math.abs(p.sx - q.sx), 1 - Math.abs(p.turn.x * q.turn.x + p.turn.y * q.turn.y + p.turn.z * q.turn.z + p.turn.w * q.turn.w));
  for (const kind of ['turn', 'tumble', 'lift', 'scale'] as const) {
    const a = total(20, kind, 0);
    const b = total(60, kind, 0);
    const c = total(144, kind, 0);
    const worst = Math.max(diff(a, b), diff(b, c));
    ok(worst < 1e-9, `${kind}: the same movement comes to the same place, turn and scale at 20, 60 and 144 frames a second (worst ${worst.toExponential(1)})`);
  }
  // A tip and a roll together are two turns about two axes a frame, which do not commute: the placing hand's own tumble
  // (`applyHold`) is the same, so a diagonal drag lands a little apart by frame rate, the way it always has. Said, not held.
  const d = diff(total(20, 'tumble', 120), total(144, 'tumble', 120));
  note(`a diagonal Shift+R drag (a tip and a roll a frame, as the placing hand's) differs by ${d.toFixed(4)} m on a 3 m arm between 20 and 144 frames a second`);
}

// ---- One thing alone against the placing hand at the wave's start. ----

type ApplyHold = typeof applyHold;
async function preWave(): Promise<{ applyHold: ApplyHold; holdState: typeof holdState } | null> {
  let text: string;
  try {
    text = execFileSync('git', ['show', `${PRE_WAVE}:src/world/placeHold.ts`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\r\n/g, '\n');
  } catch {
    return null;
  }
  const dir = mkdtempSync(join(tmpdir(), 'editorhand-prewave-'));
  try {
    const t = text.replace(/from '(\.\.?\/[^']+)'/g, (_m, p: string) => `from '${pathToFileURL(resolve(REPO, 'src/world', p)).href}'`);
    writeFileSync(join(dir, 'placeHold.ts'), t);
    return (await import(pathToFileURL(join(dir, 'placeHold.ts')).href)) as { applyHold: ApplyHold; holdState: typeof holdState };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

{
  const old = await preWave();
  if (!old) note(`git could not hand over placeHold.ts as it stood at ${PRE_WAVE}: one thing alone is held to today's applyHold only`);
  else ok(old.applyHold !== applyHold, `the placing hand as it stood at ${PRE_WAVE} is read out of git and loaded beside today's`);
  const reference = old ?? { applyHold, holdState };
  // A hand's movement: up, a quick flick, sideways, down; with a tumble's sideways too.
  const moves: [number, number, number][] = [];
  for (let i = 0; i < 200; i++) moves.push([Math.sin(i * 0.3) * 7, Math.cos(i * 0.17) * 12 - 3, i % 7 === 0 ? 1 / 144 : i % 3 === 0 ? 1 / 20 : 1 / 60]);
  for (const kind of ['turn', 'tumble'] as const) {
    const start = thing(3, 1, -2, 0.7);
    const many = thing(3, 1, -2, 0.7);
    const single = { turn: { ...start.turn }, lift: 0 };
    const hs = reference.holdState();
    const hm = manyHoldState();
    let worst = 0;
    let bit = true;
    for (let i = 0; i < moves.length; i++) {
      const [dx, dy, dt] = moves[i];
      reference.applyHold(hs, kind as HoldKind, dx, dy, dt, 1, axes, single, null, 0, i * dt);
      applyHoldMany(hm, kind, dx, dy, dt, 1, axes, [many], { x: many.x, y: many.y, z: many.z }, 0.004, i * dt);
      for (const c of ['x', 'y', 'z', 'w'] as const) if (!Object.is(single.turn[c], many.turn[c])) bit = false;
      worst = Math.max(worst, Math.hypot(many.x - 3, many.y - 1, many.z + 2));
    }
    ok(bit, `${kind}: one thing alone, turned about its own place, turns to the bit as the placing hand turned it at ${old ? PRE_WAVE : 'today'} over 200 frames at three rates`);
    ok(worst < 1e-12, `${kind}: and stays where it stands (${worst.toExponential(1)} m)`);
  }
  if (old) {
    // Today's applyHold over the same hand, a prop's turn, tumble and lift and a building's turn and lift, to the bit.
    let same = true;
    for (const kind of ['turn', 'tumble', 'lift'] as const) {
      const a = { turn: { x: 0, y: 0.2, z: 0, w: Math.sqrt(1 - 0.04) }, lift: 0.3 };
      const b = { turn: { ...a.turn }, lift: 0.3 };
      const ha = old.holdState();
      const hb = holdState();
      const houseA = { yaw: 1, lift: 0 };
      const houseB = { yaw: 1, lift: 0 };
      const ha2 = old.holdState();
      const hb2 = holdState();
      for (let i = 0; i < moves.length; i++) {
        const [dx, dy, dt] = moves[i];
        old.applyHold(ha, kind, dx, dy, dt, 1, axes, a, null, 0, i);
        applyHold(hb, kind, dx, dy, dt, 1, axes, b, null, 0, i);
        if (kind !== 'tumble') {
          old.applyHold(ha2, kind, dx, dy, dt, 1, axes, null, houseA, 4, i);
          applyHold(hb2, kind, dx, dy, dt, 1, axes, null, houseB, 4, i);
        }
      }
      for (const c of ['x', 'y', 'z', 'w'] as const) if (!Object.is(a.turn[c], b.turn[c])) same = false;
      if (!Object.is(a.lift, b.lift) || !Object.is(houseA.yaw, houseB.yaw) || !Object.is(houseA.lift, houseB.lift)) same = false;
    }
    ok(same, `today's applyHold (the placing hand's) answers to the bit as it did at ${PRE_WAVE}: the wave added applyHoldMany beside it and changed nothing of it`);
  }
  ok(PLACE_HOLD_TUNE.turnPerPx > 0, 'the hand reads the placing hand\'s own tune');
}

console.log(`\n${checks} checks passed`);
