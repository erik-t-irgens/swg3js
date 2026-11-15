// The wave 2a polish's paces (the owner's first look, 2026-11-15), through the game's own code: what walking sideways
// plays under each of `sideWalkClip`'s three choices and how far the body turns for it; what a pace plays with a gun in
// hand out of combat (`gunCarry`: 'full', 'original', 'split') and how the body faces for it; the owner's speeds as the
// starts and which paces they push past the playback band on the human, the Bothan woman at 0.72 and the Wookiee at
// 1.28; and each pace's share of the feet-locked rate (`rate.byClass`). Each through `BodyLoco` and `PeerLoco` (the
// player's and the peers' records) at 30, 60 and 144 frames a second, each with a mutation of the new code shown to
// fail its check; and day one: every switch at its 'before' gives 62143fe's frame trace to the bit, that commit's
// modules loaded out of git, with a recorded digest for when git cannot answer.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { BodyLoco, CARRY_FULL, CARRY_NONE, CARRY_ORIGINAL, CARRY_SPLIT, carryOf, classShare, gunClassIndex, newLocoIn, type LocoIn, type LocoRig } from '../../../src/anim/bodyLoco.ts';
import { PISTOL_RUN, PISTOL_WALK, PeerIn, PeerLoco, PeerPistolCarry } from '../../../src/anim/peerLoco.ts';
import { CLIP_HEADING, SIDE_DIAGONAL, SIDE_FORWARD, SIDE_STRAFE, locoPick, peerPick, sideMode, tableClips, type LocoPick } from '../../../src/anim/locoTable.ts';
import { LOCO_TUNE_SHIPPED, tuneLoco, LOCO_TUNE, type LocoTune } from '../../../src/anim/locoTune.ts';
import { readPackIndex } from '../../../src/anim/mxaFile.ts';
import { planFit } from '../../../src/anim/fit.ts';
import { ALIGN_SHIPPED } from '../../../src/anim/mixamoMap.ts';
import { loadOldMany } from './oldModules.ts';
import { BEFORE_POLISH, STARTED_SPEEDS, beforeLocoTune, loadMutant } from './polishFixtures.ts';
import { glbSkeleton, repoRoot, speciesBodies, targetSkeleton } from './animFixtures.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const note = (what: string) => console.log(`note ${what}`);
const root = repoRoot(import.meta.url);
const text = (rel: string) => readFileSync(join(root, rel), 'utf8').replace(/\r\n/g, '\n');
const T = (): LocoTune => JSON.parse(JSON.stringify(LOCO_TUNE_SHIPPED)) as LocoTune;
const DEG = 180 / Math.PI;
/** The digest of the 'before' frame trace, recorded from 62143fe's own modules: what a checkout with no history is held to. */
const BEFORE_TRACE = '92b536e937a4bbe4';

/** A rig with every clip of the table, each clip's feet made for 3 m/s. */
const full: LocoRig = { has: () => true, speedOut: 0, readSpeed() { this.speedOut = 3; return true; } };

interface Keys { w?: boolean; s?: boolean; a?: boolean; d?: boolean; shift?: boolean; walk?: boolean }
type Loco = InstanceType<typeof BodyLoco>;
/** A body stepped a frame at a time, as the player's update steps its record. */
class Body {
  readonly tune: LocoTune;
  readonly loco: Loco;
  readonly f: LocoIn;
  private was: Keys = {};
  constructor(tune: LocoTune, Cls: new (t: never) => Loco = BodyLoco as never, make: () => LocoIn = newLocoIn) {
    this.tune = tune;
    this.loco = new Cls(tune as never);
    this.f = make();
    this.f.sprint = tune.speed.forward.sprint;
    this.f.pool = tune.stamina.pool;
  }
  step(dt: number, k: Keys, over: Partial<LocoIn> = {}): void {
    this.loco.keys(dt, !!k.shift, !!k.shift && !this.was.shift, !!k.walk, full);
    this.was = k;
    Object.assign(this.f, { dt, mz: (k.w ? 1 : 0) - (k.s ? 1 : 0), mx: (k.d ? 1 : 0) - (k.a ? 1 : 0), standing: true, grounded: true, swimming: false, fighting: false, aiming: false, gunUp: false, fightKeys: false, boost: 1, gunClass: -1 }, over);
    this.loco.plan(this.f);
    this.f.ground = this.loco.speed;
    this.loco.legs(full, this.f, false);
    this.loco.face(this.loco.faces(false));
  }
  run(seconds: number, k: Keys, fps: number, over: Partial<LocoIn> = {}): void {
    for (let i = 0; i < Math.round(seconds * fps); i++) this.step(1 / fps, k, over);
  }
}

// ---- 1. walking sideways ---------------------------------------------------------------------------------------------------
{
  const shipped = T();
  ok(shipped.sideWalkClip === 'diagonal' && sideMode(shipped) === SIDE_DIAGONAL, 'walking sideways ships as the walked forward diagonal\'s own clip (the owner\'s word)');
  for (const fps of [30, 60, 144]) {
    const seen: string[] = [];
    for (const [mode, clipL, clipR, turnL] of [['diagonal', 'left_strafe_walking', 'right_strafe_walking', 0], ['forward', 'standard_walk', 'standard_walk', 90], ['strafe', 'walk_strafe_left', 'walk_strafe_right', 0]] as const) {
      const t = T();
      t.sideWalkClip = mode;
      const b = new Body(t);
      b.run(1, { a: true, walk: true }, fps);
      const l = b.loco.pick!;
      const lTurn = Math.round(b.loco.turn * DEG);
      const lNow = b.loco.turnNow * DEG;
      const pool = b.loco.stamina.value;
      b.run(1, { d: true, walk: true }, fps);
      const r = b.loco.pick!;
      assert.ok(l.id === clipL && r.id === clipR && lTurn === turnL && Math.round(b.loco.turn * DEG) === -turnL, `${mode} at ${fps} fps: ${l.id} turned ${lTurn}, ${r.id} turned ${Math.round(b.loco.turn * DEG)}`);
      assert.ok(b.loco.speed === t.speed.side.walk && l.key === 'walk' && l.group === 'side' && l.state === 'walk', `${mode}: at the sideways walk's own speed and state`);
      assert.ok(Math.abs(lNow - turnL) < 0.5 && pool === t.stamina.pool, `${mode}: the body has come round (${lNow.toFixed(2)}) and the pool is full (walking sideways gives back)`);
      seen.push(`${mode}: ${l.id} ${lTurn}`);
    }
    ok(true, `at ${fps} fps walking sideways plays, by its choice: ${seen.join('; ')} (left; the right-hand clip and turn its mirror), at the sideways walk's speed and state, the body come round within a second and the pool full`);
  }
  // Turned by the very rule every pick is: the clip's own measured heading carries the body straight sideways.
  for (const side of [SIDE_DIAGONAL, SIDE_FORWARD]) {
    const p = locoPick(2, 1, false, 0, 'standard', side)!;
    ok(Math.abs(((p.turn + CLIP_HEADING[p.id] - 90 + 540) % 360) - 180) < 1e-9, `${side === SIDE_DIAGONAL ? 'diagonal' : 'forward'}: the body turned ${p.turn} degrees and the clip's own heading (${CLIP_HEADING[p.id]}) carry it straight to the left: the legs go the way the body does`);
  }
  const diagFL = locoPick(1, 1)!;
  const diagL = locoPick(2, 1, false, 0, 'standard', SIDE_DIAGONAL)!;
  ok(diagFL.id === diagL.id && diagL.turn - diagFL.turn === 45, `the walked forward diagonal's clip (${diagFL.id}, turned ${diagFL.turn}) is turned a further 45 degrees toward the travel walking straight sideways (${diagL.turn}): the strafe walk's own feet go straight across (its measured heading 89.8), so here it stands square`);
  // A blaster up: 'forward' plays the diagonal's clip square; the slow strafe stays the slow strafe.
  ok(locoPick(2, 1, false, 2, 'standard', SIDE_FORWARD)!.id === 'left_strafe_walking' && locoPick(2, 1, false, 2, 'standard', SIDE_FORWARD)!.turn === 0 && locoPick(2, 1, false, 2, 'standard', SIDE_STRAFE)!.id === 'walk_strafe_left' && locoPick(2, 1, false, 2, 'standard', SIDE_DIAGONAL)!.id === 'left_strafe_walking', 'with a blaster up the forward walk\'s quarter turn would take the barrel off the crosshair: that choice plays the diagonal\'s clip square; the slow strafe stays the slow strafe');
  ok(tableClips().length === 20 && [SIDE_STRAFE, SIDE_DIAGONAL, SIDE_FORWARD].every((s) => [2, 6].every((d) => tableClips().includes(locoPick(d, 1, false, 0, 'standard', s)!.id))), 'every choice plays a clip the table already names: a rig with the classes has them all');
  // Peers: their game sends nothing of the choice; this side's tune decides, and finds the sender's clip.
  for (const mode of ['diagonal', 'forward', 'strafe'] as const) {
    const t = T();
    t.sideWalkClip = mode;
    const sent = locoPick(2, 1, false, 0, 'standard', sideMode(t))!;
    for (const view of [0, 37, -120]) {
      const f = new PeerIn();
      const travel = (view + 90) / DEG;
      f.vx = Math.sin(travel) * t.speed.side.walk;
      f.vz = Math.cos(travel) * t.speed.side.walk;
      f.heading = (view + sent.turn) / DEG;
      f.speed = t.speed.side.walk;
      f.dt = 1 / 60;
      const got = new PeerLoco().resolve(t, full, 'walk', f);
      assert.ok(got?.id === sent.id, `a peer walking sideways under '${mode}' (view ${view}) is drawn with ${sent.id} (got ${got?.id})`);
    }
  }
  ok(true, 'another player walking sideways is drawn with the very clip their game plays, worked out from the heading they send (their body\'s, turned for the choice) and their travel, under this side\'s own choice: nothing new on the wire');
  const strafeOnly = T();
  strafeOnly.sideWalkClip = 'forward';
  ok(peerPick(strafeOnly, 'walk', 90, 0.6)?.id !== 'walk_strafe_left' && peerPick({ ...strafeOnly, sideWalkClip: 'strafe' }, 'walk', 90, 0.6)?.id === 'walk_strafe_left', 'and a cell of another choice is stepped over: under \'forward\' a slow walk to the left is never drawn as the slow strafe');
  // A mutation: the plan handed no choice plays the slow strafe whatever the dial says.
  const [mut] = await loadMutant(['src/anim/bodyLoco.ts'], ['src/anim/bodyLoco.ts'], [{ file: 'src/anim/bodyLoco.ts', from: "GUN_UP : PLAIN, 'standard', sideMode(tune));", to: 'GUN_UP : PLAIN);' }]);
  const mb = new Body(T(), (mut as { BodyLoco: new (t: never) => Loco }).BodyLoco, (mut as { newLocoIn: () => LocoIn }).newLocoIn);
  mb.run(0.5, { a: true, walk: true }, 60);
  ok(mb.loco.pick!.id === 'walk_strafe_left', 'a mutation that hands the plan no choice walks the slow strafe under \'diagonal\': the check above fails on it');
}

// ---- 5. a gun out, not fighting ------------------------------------------------------------------------------------------
{
  const t = T();
  ok(t.gunCarry.pistol === 'full' && t.gunCarry.carbine === 'original' && t.gunCarry.rifle === 'original' && t.gunCarry.heavy === 'original', 'a gun out of combat ships as the owner asked: a pistol\'s pace the whole clip, a carbine\'s (and a rifle\'s and a heavy weapon\'s) the game\'s own carry walk and run');
  ok(gunClassIndex('pistol') === 0 && gunClassIndex('carbine') === 1 && gunClassIndex('rifle') === 2 && gunClassIndex('heavy') === 3 && gunClassIndex('one_handed') === -1 && gunClassIndex('') === -1, 'the kinds of gun by the rack\'s own class names, nothing else a gun');
  for (const fps of [30, 60, 144]) {
    const rows: string[] = [];
    for (let cls = 0; cls < 4; cls++) {
      const b = new Body(t);
      b.run(0.8, { w: true, shift: true }, fps, { gunClass: cls });
      const want = carryOf(t, cls);
      const legs = b.loco.legs(full, b.f, false);
      assert.ok(b.loco.carry === want && b.loco.moves && b.loco.speed === t.speed.forward.run, `fps ${fps}, kind ${cls}: carry ${b.loco.carry}`);
      if (want === CARRY_ORIGINAL) assert.ok(legs === null && !b.loco.faces(false) && Math.abs(b.loco.turnNow) < 1e-9, 'original: no table legs, the body faces the way it runs');
      else assert.ok(legs !== null && b.loco.faces(false), 'full or split: the table\'s legs, facing by the table');
      // In combat (up, or aimed) nothing of it.
      b.run(0.2, { w: true, shift: true }, fps, { gunClass: cls, gunUp: true });
      assert.ok(b.loco.carry === CARRY_NONE && b.loco.legs(full, b.f, false) !== null, 'a gun up: the carry is none, the legs the table\'s as before');
      rows.push(`${['pistol', 'carbine', 'rifle', 'heavy'][cls]} ${want === CARRY_FULL ? 'full' : want === CARRY_ORIGINAL ? 'original' : 'split'}`);
    }
    ok(true, `at ${fps} fps a gun in hand and none up, at the run: ${rows.join(', ')}; 'original' hands no legs and the body faces the way it runs (the caller's old rule), the others the table's legs facing by the table; with the gun up (ready, aimed) none of it, as before`);
  }
  const split = T();
  split.gunCarry = { pistol: 'split', carbine: 'split', rifle: 'split', heavy: 'split' };
  const s = new Body(split);
  s.run(0.5, { w: true }, 60, { gunClass: 2 });
  ok(s.loco.carry === CARRY_SPLIT && s.loco.legs(full, s.f, false) !== null && s.loco.faces(false), '\'split\' is 62143fe\'s: the table\'s legs, facing by the table (the caller keeps the standing carry on the upper body)');
  const n = new Body(t);
  n.run(0.5, { w: true }, 60);
  ok(n.loco.carry === CARRY_NONE, 'and bare-handed there is no carry at all');
  ok(tuneLoco({ gunCarry: { pistol: 'split' } }).length === 0 && LOCO_TUNE.gunCarry.pistol === 'split' && tuneLoco({ gunCarry: { pistol: 'sideways' } }).length === 1 && tuneLoco({ gunCarry: { pistol: 'full' } }).length === 0, 'each kind\'s choice takes its three words and refuses any other');
  // A mutation: legs that ignore the carry hand the table's clip to an 'original' gun.
  const [mut] = await loadMutant(['src/anim/bodyLoco.ts'], ['src/anim/bodyLoco.ts'], [{ file: 'src/anim/bodyLoco.ts', from: 'this.carry === CARRY_ORIGINAL || !rig.has(pick.clip)', to: '!rig.has(pick.clip)' }]);
  const mb = new Body(T(), (mut as { BodyLoco: new (t: never) => Loco }).BodyLoco, (mut as { newLocoIn: () => LocoIn }).newLocoIn);
  mb.run(0.5, { w: true }, 60, { gunClass: 1 });
  ok(mb.loco.legs(full, mb.f, false) !== null, 'a mutation whose legs ignore the carry hands a carbine the table\'s clip: the check above fails on it');
  // The game's own carry: what 'original' plays, and its feet against the ground at each pace (the rig's own rate).
  const player = text('src/player/player.ts');
  ok(player.includes("rig.prefer(`gun${state}`, new RegExp(gun === 'pistol' ? `^loop_pistol_standing:speed${n}` : `^loop_rifle:speed${n}`));") && player.includes("gunWalk: [/^loop_rifle:speed1/, /^loop_pistol_standing:speed1/, 'walk', 'loop_walk'],") === false && text('src/player/rig.ts').includes("gunRun: [/^loop_rifle:speed2/, /^loop_pistol_standing:speed2/, 'run', 'loop_run'],"), '\'original\' is the state\'s own carry walk and run, as before the paces: the pistol\'s `loop_pistol_standing:speed1`/`:speed2` for a pistol and the rifle\'s `loop_rifle:speed1`/`:speed2` for a carbine, a rifle and a heavy weapon, played at the rig\'s own rate (the body\'s speed over the clip\'s, held 0.5 to 2.5)');
}

// ---- 5b. 'original': how far its feet slide at each pace (measured, not tuned) ---------------------------------------------------
{
  // The rig plays a game clip at the body's speed over the speed the converter wrote for it (`parts.json`'s clipSpeeds),
  // held 0.5 to 2.5 (`CharacterRig.setState`); its feet carry the figure at what the clip's planted foot really does
  // (measured off the clip's own keys: the lower ankle while within 4 cm of its lowest, its backward speed against the
  // root) times the figure's size times that rate. A share of the body's speed: + the body outruns its feet (the feet
  // slide forward), - the feet outrun the body.
  const charDir = join(root, 'assets-private', 'characters');
  const id = 'human_male';
  const file = join(charDir, id, 'rig.glb');
  const parts = join(charDir, id, 'parts.json');
  if (!existsSync(file) || !existsSync(parts)) note(`no ${id} rig on disk: the game's carry clips' feet are not measured here`);
  else {
    const speeds = (JSON.parse(readFileSync(parts, 'utf8')) as { clipSpeeds?: Record<string, number> }).clipSpeeds ?? {};
    const fd = openSync(file, 'r');
    try {
      const head = Buffer.alloc(20);
      readSync(fd, head, 0, 20, 0);
      const jlen = head.readUInt32LE(12);
      const jb = Buffer.alloc(jlen);
      readSync(fd, jb, 0, jlen, 20);
      const g = JSON.parse(jb.toString('utf8')) as { nodes: { name?: string; extras?: { name?: string }; children?: number[]; translation?: number[]; rotation?: number[] }[]; skins: { joints: number[] }[]; accessors: { bufferView: number; byteOffset?: number; count: number; type: string }[]; bufferViews: { byteOffset?: number }[]; animations: { name: string; channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number }[] }[] };
      const binAt = 20 + jlen + 8;
      const acc = (i: number): Float32Array => {
        const a = g.accessors[i];
        const comps = a.type === 'SCALAR' ? 1 : a.type === 'VEC3' ? 3 : 4;
        const b = Buffer.alloc(a.count * comps * 4);
        readSync(fd, b, 0, b.length, binAt + (g.bufferViews[a.bufferView].byteOffset ?? 0) + (a.byteOffset ?? 0));
        const out = new Float32Array(a.count * comps);
        for (let k = 0; k < out.length; k++) out[k] = b.readFloatLE(k * 4);
        return out;
      };
      const nodes = g.nodes;
      const nameOf = (i: number) => nodes[i].extras?.name ?? nodes[i].name ?? `n${i}`;
      const parent = new Array<number>(nodes.length).fill(-1);
      nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (parent[c] = i)));
      const order: number[] = [];
      const seen = new Set<number>();
      const visit = (i: number) => {
        if (seen.has(i)) return;
        if (parent[i] >= 0) visit(parent[i]);
        seen.add(i);
        order.push(i);
      };
      for (let i = 0; i < nodes.length; i++) visit(i);
      const joints = g.skins[0].joints;
      const byName = new Map(joints.map((j) => [nameOf(j), j]));
      const feet = [byName.get('lAnkle')!, byName.get('rAnkle')!];
      const rootJ = joints[0];
      const qm = (a: number[], b: number[]) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
      const qr = (q: number[], v: number[]) => {
        const [x, y, z, w] = q;
        const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2];
        return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x];
      };
      const planted = (name: string): number => {
        const a = g.animations.find((x) => x.name === name)!;
        const rot = new Map<number, Float32Array>(), pos = new Map<number, Float32Array>();
        let times: Float32Array | null = null;
        for (const ch of a.channels) {
          const s = a.samplers[ch.sampler];
          times ??= acc(s.input);
          if (ch.target.path === 'rotation') rot.set(ch.target.node, acc(s.output));
          else if (ch.target.path === 'translation') pos.set(ch.target.node, acc(s.output));
        }
        const keys = times!.length;
        const tr: number[][][] = [[], []];
        for (let k = 0; k < keys; k++) {
          const wq: number[][] = [], wp: number[][] = [];
          for (const i of order) {
            const r = rot.get(i), t = pos.get(i);
            const q = r ? Array.from(r.subarray(Math.min(k, r.length / 4 - 1) * 4, Math.min(k, r.length / 4 - 1) * 4 + 4)) : nodes[i].rotation ?? [0, 0, 0, 1];
            const p = t ? Array.from(t.subarray(Math.min(k, t.length / 3 - 1) * 3, Math.min(k, t.length / 3 - 1) * 3 + 3)) : nodes[i].translation ?? [0, 0, 0];
            if (parent[i] < 0) {
              wq[i] = q;
              wp[i] = p;
            } else {
              const rp = qr(wq[parent[i]], p);
              wq[i] = qm(wq[parent[i]], q);
              wp[i] = [wp[parent[i]][0] + rp[0], wp[parent[i]][1] + rp[1], wp[parent[i]][2] + rp[2]];
            }
          }
          feet.forEach((f, j) => tr[j].push([wp[f][0] - wp[rootJ][0], wp[f][1], wp[f][2] - wp[rootJ][2]]));
        }
        const lowest = tr.map((t) => Math.min(...t.map((v) => v[1])));
        let sum = 0, n = 0;
        for (let k = 0; k + 1 < keys; k++) {
          const low = tr[0][k][1] <= tr[1][k][1] ? 0 : 1;
          if (tr[low][k][1] > lowest[low] + 0.04) continue;
          sum += -(tr[low][k + 1][2] - tr[low][k][2]) / (times![k + 1] - times![k]);
          n++;
        }
        return sum / n;
      };
      const t = T();
      const rows: string[] = [];
      const clamp = (v: number) => Math.min(2.5, Math.max(0.5, v));
      for (const [gun, base] of [['a pistol', 'loop_pistol_standing'], ['a carbine, a rifle or a heavy weapon', 'loop_rifle']] as const) {
        const walk = `${base}:speed1`, run = `${base}:speed2`;
        const feetWalk = planted(walk), feetRun = planted(run);
        assert.ok(feetWalk > 0.5 && feetRun > feetWalk && speeds[walk] > 0 && speeds[run] > 0, `${gun}: the carry clips measure (${feetWalk}, ${feetRun}) and have their written speeds`);
        const cells: string[] = [];
        for (const [fig, who] of [[1, 'human'], [0.72, 'Bothan woman'], [1.28, 'Wookiee']] as const) {
          const paces = ([['walk', t.speed.forward.walk, walk, feetWalk], ['back walk', t.speed.back.walk, walk, feetWalk], ['jog', t.speed.forward.jog, run, feetRun], ['back jog', t.speed.back.jog, run, feetRun], ['run', t.speed.forward.run, run, feetRun], ['sprint', t.speed.forward.sprint, run, feetRun]] as const).map(([pace, v, clip, ft]) => {
            const rate = clamp(v / speeds[clip]);
            return `${pace} ${v} (rate ${rate.toFixed(2)}) ${(((v - ft * fig * rate) / v) * 100).toFixed(0)}%`;
          });
          cells.push(`${who} at ${fig}: ${paces.join(', ')}`);
        }
        rows.push(`${gun} (${walk} written ${speeds[walk]}, its planted foot ${feetWalk.toFixed(3)} m/s; ${run} written ${speeds[run]}, ${feetRun.toFixed(3)}): ${cells.join('; ')}`);
      }
      note(`'original' on the human's rig, the share of the body's speed its feet slide at each pace (+ the body outruns them), the sideways and diagonal paces at the same share as the speed's own (the body turned to run): ${rows.join(' | ')}`);
      ok(rows.length === 2, 'the game\'s own carry walk and run measured on the human\'s rig: the slide at each pace noted (measured, not tuned)');
    } finally {
      closeSync(fd);
    }
  }
}

// ---- 6. the owner's speeds and the band ---------------------------------------------------------------------------------
{
  const t = T();
  ok(JSON.stringify(t.speed) === JSON.stringify({ forward: { walk: 1.66, jog: 4, tired: 3.5, run: 6, sprint: 7 }, back: { walk: 1.28, jog: 3, run: 4 }, side: { walk: 1.44, jog: 4, run: 6 }, forwardDiag: { walk: 1.66, jog: 4, run: 6 }, backDiag: { walk: 1.28, jog: 3, run: 4 } }), 'the paces start at the owner\'s own speeds of 2026-11-15 (the backward walks, which he did not name, where they were)');
  const index = readPackIndex(JSON.parse(text('public/anims/mixamo/index.json')));
  if (typeof index === 'string') throw new Error(index);
  const speedOf = (id: string) => index.clips.find((c) => c.id === id)!.speed;
  // The legs' length against the source's, as the game fits it (`FitPlan.stride`): on the human's own skeleton where on disk.
  const human = speciesBodies(root).find((b) => b.id === 'human_male');
  const stride = planFit(index.bones, human ? glbSkeleton(human.body) : targetSkeleton(), ALIGN_SHIPPED).stride;
  const out: string[] = [];
  const figures: [string, number][] = [['human', 1], ['the Bothan woman', 0.72], ['the Wookiee', 1.28]];
  for (const [who, fig] of figures) {
    const past = new Set<string>();
    // Every cell a body can play: each way and class, the tired jog, and with a blaster up (kept square), under each sideways choice.
    for (const side of [SIDE_DIAGONAL, SIDE_FORWARD, SIDE_STRAFE]) {
      for (let dir = 0; dir < 8; dir++) {
        for (let cls = 1; cls <= 4; cls++) {
          for (const [tired, gun, label] of [[false, 0, ''], [true, 0, ''], [false, 2, ' (a blaster up)']] as const) {
            const p = locoPick(dir, cls, tired, gun, 'standard', side);
            if (!p || p.cls !== cls || ((tired || gun) && p === locoPick(dir, cls, false, 0, 'standard', side))) continue;
            const sp = (t.speed[p.group] as Record<string, number>)[p.key];
            const rate = sp / (speedOf(p.id) * stride * fig);
            if (rate < t.rate.min || rate > t.rate.max) past.add(`${['F', 'FL', 'L', 'BL', 'B', 'BR', 'R', 'FR'][dir]} ${p.key}${label}${p.side >= 0 ? ` (sideways '${['strafe', 'diagonal', 'forward'][p.side]}')` : ''} ${p.id} ${rate.toFixed(2)}`);
          }
        }
      }
    }
    out.push(`${who} at ${fig}: ${past.size ? [...past].join('; ') : 'none'}`);
  }
  note(`the paces whose playback rate the owner's speeds push past the band (${t.rate.min} to ${t.rate.max}, not moved), by figure (legs x${stride.toFixed(4)}; the slow strafe only under 'strafe'): ${out.join(' | ')}`);
  ok(out[1].includes('slow_run') && out[1].includes('1.77'), 'the jog at 4 on the short figure asks 1.77 of its clip, past the band\'s 1.6, as expected');
}

// ---- 7. each pace's animation speed ---------------------------------------------------------------------------------------
{
  for (const fps of [30, 60, 144]) {
    const t = T();
    t.rate.byClass = { walk: 0.9, jog: 0.95, run: 0.85, sprint: 0.8 };
    const rows: string[] = [];
    for (const [k, cls] of [[{ w: true, walk: true }, 1], [{ w: true }, 2], [{ w: true, shift: true }, 3]] as const) {
      const b = new Body(t);
      b.run(0.8, k, fps);
      const locked = b.loco.speed / 3;
      const want = Math.min(t.rate.max, Math.max(t.rate.min, locked * classShare(t, cls)));
      assert.ok(Math.abs(b.loco.rate - want) < 1e-12, `fps ${fps} class ${cls}: rate ${b.loco.rate} against ${want}`);
      rows.push(`${['', 'walk', 'jog', 'run'][cls]} ${b.loco.rate.toFixed(3)} (locked ${locked.toFixed(3)} x ${classShare(t, cls)})`);
    }
    ok(true, `at ${fps} fps each pace plays its share of the feet-locked rate, held to the band: ${rows.join(', ')}`);
  }
  const one = T();
  const b = new Body(one);
  b.run(0.5, { w: true }, 60);
  ok(b.loco.rate === one.speed.forward.jog / 3 && Object.values(one.rate.byClass).every((v) => v === 1), 'at 1 (as shipped) the rate is the feet-locked one exactly: moving a pace\'s speed keeps its feet planted');
  const band = T();
  band.rate.byClass.sprint = 1.6;
  const s = new Body(band);
  s.run(0.5, { w: true, shift: true }, 60);
  s.run(0.2, { w: true }, 60);
  s.run(0.4, { w: true, shift: true }, 60);
  ok(s.loco.cls === 4 && s.loco.rate === band.rate.max, 'and inside the band whatever the share: a sprint asked for 1.6 times its locked rate plays at the band\'s top');
  // The peers' rate takes the same share.
  const pt = T();
  pt.rate.byClass.run = 0.8;
  const f = new PeerIn();
  f.vx = 0;
  f.vz = 6;
  f.heading = 0;
  f.speed = 6;
  f.dt = 1 / 60;
  const peer = new PeerLoco();
  peer.resolve(pt, full, 'run', f);
  ok(peer.pick?.cls === 3 && Math.abs(peer.rate - Math.min(pt.rate.max * 2, (6 / 3) * 0.8)) < 1e-12, 'another player\'s run plays at the same share of its locked rate');
  // A mutation: legs that leave the share out play locked whatever the dial says.
  const [mut] = await loadMutant(['src/anim/bodyLoco.ts'], ['src/anim/bodyLoco.ts'], [{ file: 'src/anim/bodyLoco.ts', from: 'const r = (f.ground / (natural * band.feet)) * share;', to: 'const r = f.ground / (natural * band.feet);' }]);
  const t2 = T();
  t2.rate.byClass.jog = 0.8;
  const mb = new Body(t2, (mut as { BodyLoco: new (t: never) => Loco }).BodyLoco, (mut as { newLocoIn: () => LocoIn }).newLocoIn);
  mb.run(0.5, { w: true }, 60);
  ok(mb.loco.rate === t2.speed.forward.jog / 3, 'a mutation that leaves the share out plays the jog locked at a share of 0.8: the checks above fail on it');
  ok(text('src/anim/locoDials.ts').includes("'Sprint: animation speed, 1 = feet locked'") && text('src/anim/locoDials.ts').includes("'Walk: animation speed, 1 = feet locked'"), 'each dial says what it is without the brief: "Sprint: animation speed, 1 = feet locked"');
}

// ---- 5c. another player's pistol carry is taken off when its reason goes ------------------------------------------------------
{
  // A rig's preferences as `CharacterRig.prefer` keeps them (rig.ts: set on a clip; on null deleted, and the state in force
  // picks again when asked to), the state's own list naming the rifle's carry first, as the rig's own does.
  class PreferStandIn {
    readonly pref = new Map<string, RegExp>();
    state = 'gunRun';
    repicks = 0;
    prefer(state: string, clip: RegExp | null, repick = false): void {
      if (clip) this.pref.set(state, clip);
      else if (this.pref.delete(state) && repick && state === this.state) this.repicks++;
    }
    /** The clip the state plays: its preference, else its own list's first (the rifle's). */
    plays(state: string): string {
      const p = this.pref.get(state);
      return p ? p.source : `^loop_rifle:speed${state === 'gunWalk' ? 1 : 2}`;
    }
  }
  // The frame's own arithmetic in remotePlayers: the relaxed carry's choice for their kind of gun, -1 where it does not
  // apply (a figure heard still has no legs that message).
  const relaxed = (tune: LocoTune, gunClass: number, legs: boolean) => (legs ? carryOf(tune, gunClass) : -1);
  const drive = (step: (rig: PreferStandIn, tune: LocoTune, state: string, gunClass: number, relaxedGun: number) => void) => {
    const tune = T();
    const rig = new PreferStandIn();
    const seen: string[] = [];
    const frame = (state: string, gunClass: number, legs = true) => {
      rig.state = state;
      step(rig, tune, state, gunClass, relaxed(tune, gunClass, legs));
      seen.push(rig.plays(state));
    };
    tune.gunCarry.pistol = 'original';
    frame('gunRun', 0); // a pistol, running out of combat
    frame('gunWalk', 0);
    frame('gunRun', 0, false); // a message heard standing still: no legs that frame
    const steady = seen.slice();
    frame('gunRun', 2); // the same peer now carries a rifle ('original': the state's own list)
    frame('gunWalk', 2);
    const rifle = seen.slice(steady.length);
    frame('gunRun', 0); // a pistol again
    tune.gunCarry.pistol = 'full'; // this side's choice for a pistol moved
    frame('gunRun', 0);
    const full = rig.plays('gunRun');
    return { steady, rifle, full, rig };
  };
  const live = new PeerPistolCarry();
  const ran = drive((rig, tune, state, gunClass, relaxedGun) => live.step(rig, tune, state, gunClass, relaxedGun));
  ok(ran.steady.every((s, i) => s === (i === 1 ? PISTOL_WALK.source : PISTOL_RUN.source)), `another player's relaxed pistol under 'original' plays the pistol's own carry walk and run, and a message heard standing still (no legs that frame) leaves it so: ${ran.steady.join(', ')}`);
  ok(ran.rifle.every((s) => /loop_rifle/.test(s)) && ran.rig.repicks >= 1, `the same player swapping to a rifle plays the rifle's carry (${ran.rifle.join(', ')}), the state in force picking again at once: the pistol's preference is taken off when the gun in their hand is no pistol`);
  ok(/loop_rifle/.test(ran.full) && ran.rig.pref.size === 0 && !live.held, `and when this side's choice for a pistol is no longer 'original' the preference is taken off too (the table's legs then put their own clip on the state, as before)`);
  // The mutation: the line the wave first had (the preference set, never taken off).
  const mutant = drive((rig, tune, state, gunClass, relaxedGun) => {
    if (relaxedGun === CARRY_ORIGINAL && gunClass === 0) rig.prefer(state, state === 'gunWalk' ? PISTOL_WALK : PISTOL_RUN);
  });
  ok(mutant.rifle.some((s) => /pistol/.test(s)), `the mutation is caught: with the preference never taken off, the peer swapped to a rifle goes on playing ${mutant.rifle.join(', ')}`);
  // Under 'split' (62143fe's), nothing is preferred at all.
  const split = new PeerPistolCarry();
  const sr = new PreferStandIn();
  const st = T();
  st.gunCarry.pistol = 'split';
  for (const [state, g] of [['gunRun', 0], ['gunWalk', 0], ['gunRun', 2]] as const) split.step(sr, st, state, g, relaxed(st, g, true));
  ok(sr.pref.size === 0 && sr.repicks === 0 && !split.held, 'under \'split\' (62143fe\'s) the peer\'s rig is asked for nothing, as it was');
}

// ---- day one: every switch at 'before' is 62143fe's, frame for frame --------------------------------------------------------
{
  const FILES = ['src/anim/bodyLoco.ts', 'src/anim/locoClass.ts', 'src/anim/locoTable.ts', 'src/anim/locoTune.ts', 'src/anim/peerLoco.ts'];
  const old = await loadOldMany(FILES, ['src/anim/bodyLoco.ts', 'src/anim/locoTune.ts', 'src/anim/peerLoco.ts'], BEFORE_POLISH);
  const trace = (mods: { BodyLoco: new (t: never) => Loco; newLocoIn: () => LocoIn; PeerLoco: new () => InstanceType<typeof PeerLoco>; PeerIn: new () => PeerIn }, tune: unknown): string[] => {
    const rows: string[] = [];
    const n = (v: unknown) => (typeof v === 'number' ? (Object.is(v, -0) ? '-0' : String(v)) : String(v));
    for (const fps of [30, 60, 144]) {
      const b = new mods.BodyLoco(tune as never);
      const f = mods.newLocoIn();
      f.sprint = 6.35;
      f.pool = 100;
      let was = false;
      const step = (seconds: number, k: Keys, over: Record<string, unknown> = {}) => {
        for (let i = 0; i < Math.round(seconds * fps); i++) {
          const dt = 1 / fps;
          b.keys(dt, !!k.shift, !!k.shift && !was, !!k.walk, full);
          was = !!k.shift;
          Object.assign(f, { dt, mz: (k.w ? 1 : 0) - (k.s ? 1 : 0), mx: (k.d ? 1 : 0) - (k.a ? 1 : 0), standing: true, grounded: true, swimming: false, fighting: false, aiming: false, gunUp: false, fightKeys: false, boost: 1, ground: 0 }, over);
          b.plan(f);
          f.ground = b.speed * 0.97;
          const legs = b.legs(full, f, !!over.fighting);
          b.face(b.faces(!!over.fighting));
          b.fadeFor(legs !== null, !!over.fighting, f.mz !== 0 || f.mx !== 0);
          rows.push([b.asked, b.cls, b.speed, b.sprinting, b.refused, b.pick?.id ?? '-', b.dir, b.moves, b.legsOn, b.rate, b.turn, b.turnNow, b.turnStep, b.fadeNow, b.stamina.value, b.stamina.tired, legs?.id ?? '-'].map(n).join(' '));
        }
      };
      // Every way at every class, walking sideways both ways, a gun out (a kind the old record never read) and up.
      step(0.5, { w: true });
      step(0.5, { w: true, shift: true });
      step(0.2, { w: true });
      step(0.6, { w: true, shift: true });
      step(0.4, { a: true, walk: true });
      step(0.4, { d: true, walk: true });
      step(0.4, { w: true, a: true, walk: true });
      step(0.4, { s: true, d: true, walk: true });
      step(0.4, { w: true, shift: true }, { gunClass: 1 });
      step(0.4, { a: true, walk: true }, { gunClass: 0 });
      step(0.3, { d: true, shift: true }, { gunClass: 2, gunUp: true });
      step(0.3, { s: true, a: true }, { gunClass: 3 });
      step(0.3, {});
    }
    // Other players: every state, way and speed sweep.
    for (const state of ['walk', 'run', 'gunWalk', 'gunRun', 'gunAimRun']) {
      const p = new mods.PeerLoco();
      const f = new mods.PeerIn();
      for (let i = 0; i < 240; i++) {
        const turn = i * 0.05;
        const speed = 0.4 + (i % 40) * 0.16;
        f.vx = Math.sin(turn) * speed;
        f.vz = Math.cos(turn) * speed;
        f.heading = 0.3;
        f.speed = speed;
        f.dt = 1 / 60;
        const got = p.resolve(tune as never, full, state, f);
        rows.push([state, got?.id ?? '-', p.rate, p.rel].map(n).join(' '));
      }
    }
    return rows;
  };
  const today = { BodyLoco: BodyLoco as never, newLocoIn, PeerLoco, PeerIn };
  const now = trace(today, beforeLocoTune());
  const digest = createHash('sha1').update(now.join('\n')).digest('hex').slice(0, 16);
  if (old) {
    const [ob, ot, op] = old as [{ BodyLoco: new (t: never) => Loco; newLocoIn: () => LocoIn }, { LOCO_TUNE_SHIPPED: LocoTune }, { PeerLoco: new () => InstanceType<typeof PeerLoco>; PeerIn: new () => PeerIn }];
    const then = trace({ BodyLoco: ob.BodyLoco, newLocoIn: ob.newLocoIn, PeerLoco: op.PeerLoco, PeerIn: op.PeerIn }, JSON.parse(JSON.stringify(ot.LOCO_TUNE_SHIPPED)));
    const first = now.findIndex((r, i) => r !== then[i]);
    ok(now.length === then.length && first < 0, `under every switch at 'before' (the slow strafe, every gun split, every share 1, the speeds as started) the record and the peers' are ${BEFORE_POLISH}'s, frame for frame at 30, 60 and 144 frames a second (${now.length} rows, every number by Object.is)${first >= 0 ? `: row ${first} is ${now[first]} against ${then[first]}` : ''}`);
    ok(JSON.stringify(ot.LOCO_TUNE_SHIPPED.speed) === JSON.stringify(STARTED_SPEEDS), `and ${BEFORE_POLISH}'s shipped speeds are the ones 'before' names`);
    note(`the 'before' trace's digest is ${digest} (BEFORE_TRACE, which a checkout with no history is held to)`);
  } else note(`git cannot hand over ${BEFORE_POLISH}'s modules here: the 'before' trace is held to the digest recorded from them`);
  if (BEFORE_TRACE) ok(digest === BEFORE_TRACE, `and its digest is the one recorded from ${BEFORE_POLISH}'s own modules (${digest})`);
  else assert.ok(old, 'a recorded digest, or git');
}

// ---- the wiring, as text ---------------------------------------------------------------------------------------------------------
{
  const player = text('src/player/player.ts');
  const peers = text('src/net/remotePlayers.ts');
  ok(player.includes("lo.gunClass = this.classId === 'bounty_hunter' && this.hasGunClips && !this.fists ? gunClassIndex(this.gunClass) : -1;") && player.includes('rig.setState(state, speed, gunUpper ?? (this.loco.carry === CARRY_FULL ? null : this.gunCarry(rig, gun)), this.legOpts);') && player.includes('} else rig.setState(state, speed, gunUpper, fo);'), 'the player hands the plan the kind of gun in hand, and with \'full\' hands the legs\' clip no upper body; \'original\' (no legs) takes the line it always had, the state\'s own carry');
  ok(peers.includes("const relaxedGun = legs !== null && peerCarryState(state) === 'gunIdle' ? carryOf(LOCO_TUNE, r.gunClass) : -1;") && peers.includes('if (relaxedGun === CARRY_ORIGINAL) legs = null;') && peers.includes('upper = relaxedGun === CARRY_FULL ? null : r.carryClip;') && peers.includes('r.gunClass = right ? gunClassIndex(right.class) : -1;') && peers.includes('r.pistolCarry.step(rig, LOCO_TUNE, state, r.gunClass, relaxedGun);') && peers.includes('pistolCarry: new PeerPistolCarry(),') && peers.indexOf('r.pistolCarry.step(') > peers.indexOf('if (relaxedGun === CARRY_ORIGINAL) legs = null;') && peers.indexOf('r.pistolCarry.step(') < peers.indexOf('rig.prefer(state, legs.clip);'), 'another player\'s relaxed carry takes this side\'s choice for the kind of gun in their right hand (read off the weapon their hello names): nothing new on the wire');
}

console.log(`\n${checks} checks passed`);
