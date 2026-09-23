// The burning manager: which bodies are picked, the caps, and when a handle is dropped.
//
// Every number here is either one of ours out of `FIRE_TUNE` or one invented for this file; the
// archives say nothing about any of it. What is being checked is the *rules*, and the one that
// matters most is the last group: **a fire must never be left standing in the air**. A body that
// dies, respawns, is disposed, drops out of the world's list, walks past the range, falls outside
// the cap or simply stops burning loses its effect and its voice on the very next step, and nothing
// the body itself does -- or fails to do, which is the lightsabers' own lesson -- is relied on.
//
// The manager is driven directly rather than mirrored: the fakes below are the three seams it has
// (the particle effects, the mixer and the heat haze's plume sink), so what runs here is the file
// the game runs.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { adoptFireLook, BurningBodies, FIRE_MAX, FIRE_TUNE, fireCap, isBurning, prepareFireEffect, resetFireTune, tuneFire, type BurningBody, type FireEffects, type FireHandle, type FireHost } from '../../../src/world/burning.ts';
import type { HeatPlumeSink } from '../../../src/world/heatSources.ts';

let passed = 0;
const ok = (cond: boolean, msg: string) => {
  assert.ok(cond, msg);
  passed++;
  console.log(`ok   ${msg}`);
};
const close = (a: number, b: number, msg: string, eps = 1e-9) => ok(Math.abs(a - b) <= eps, `${msg} (${a} ~ ${b})`);

// --- the fakes: the three seams, and nothing else --------------------------------------------------

interface Placed {
  file: string;
  x: number;
  y: number;
  z: number;
  sound: boolean | undefined;
  live: boolean;
}

class FakeFx implements FireEffects {
  readonly all: Placed[] = [];
  moves = 0;
  removes = 0;
  throwOnPlace = false;
  place(file: string, matrix: THREE.Matrix4, _contained: boolean, _transient?: boolean, _frame?: THREE.Matrix4 | null, _solid?: boolean, options?: { sound?: boolean }): FireHandle {
    if (this.throwOnPlace) throw new Error('the pack is not there');
    const e = matrix.elements;
    const h: Placed = { file, x: e[12], y: e[13], z: e[14], sound: options?.sound, live: true };
    this.all.push(h);
    return h;
  }
  move(handle: FireHandle, matrix: THREE.Matrix4): void {
    const h = handle as Placed;
    const e = matrix.elements;
    h.x = e[12];
    h.y = e[13];
    h.z = e[14];
    this.moves++;
  }
  remove(handle: FireHandle): void {
    (handle as Placed).live = false;
    this.removes++;
  }
  get live(): Placed[] {
    return this.all.filter((h) => h.live);
  }
}

interface Voice {
  id: string;
  x: number;
  y: number;
  z: number;
  space: { building: number; cell: number };
}

class FakeHost {
  keys = 0;
  readonly voices = new Map<number, Voice>();
  readonly started: string[] = [];
  readonly asked: string[] = [];
  readonly oneShots: string[] = [];
  readonly prepared: string[] = [];
  readonly stopped: number[] = [];
  readonly fades: (number | undefined)[] = [];
  moves = 0;
  spaceWrites = 0;
  /**
   * The mixer's own two refusals, which are real states the game is in and not faults: `refuse` is
   * "0 and no key" (the sound pack has not landed), `advancing` is `__debug.advance` stepping
   * simulated seconds, where the mixer writes the request down and starts nothing.
   */
  refuse = false;
  advancing = false;
  /** Null: the bank has not loaded and says nothing. A set: only these names exist. */
  names: Set<string> | null = null;
  readonly grid = {};
  readonly bank = {
    available: false,
    sources: null,
    template: (id: string): unknown => (this.names ? (this.names.has(id) ? {} : null) : {}),
  };
  prepare(ids: Iterable<string>): void {
    for (const id of ids) this.prepared.push(id);
  }
  play(id: string): number {
    this.asked.push(id);
    if (this.refuse) return 0;
    this.oneShots.push(id);
    return ++this.keys;
  }
  loop(id: string, o: { x?: number; y?: number; z?: number; space?: { building: number; cell: number } } = {}): number {
    this.asked.push(id);
    if (this.refuse) return 0;
    const k = ++this.keys;
    this.voices.set(k, { id, x: o.x ?? 0, y: o.y ?? 0, z: o.z ?? 0, space: o.space ?? { building: -1, cell: -1 } });
    this.started.push(id);
    return k;
  }
  stop(key: number, fade?: number): void {
    this.voices.delete(key);
    this.stopped.push(key);
    this.fades.push(fade);
  }
  move(key: number, x: number, y: number, z: number): void {
    this.moves++;
    const v = this.voices.get(key);
    if (v) {
      v.x = x;
      v.y = y;
      v.z = z;
    }
  }
  setGain(): void {}
  setSpace(key: number, space: { building: number; cell: number }): void {
    this.spaceWrites++;
    const v = this.voices.get(key);
    if (v) v.space = space;
  }
  isPlaying(key: number): boolean {
    return this.voices.has(key);
  }
}

class FakeSink implements HeatPlumeSink {
  readonly rows: number[][] = [];
  max = 99;
  push(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, length: number, r0: number, r1: number, intensity: number, phase: number): boolean {
    if (this.rows.length >= this.max) return false;
    this.rows.push([ox, oy, oz, dx, dy, dz, length, r0, r1, intensity, phase]);
    return true;
  }
}

/** A body of the shape every `Living` in the game already is, with the burn written on it. */
interface Body extends BurningBody {
  key: number;
  label: string;
  pos: { x: number; y: number; z: number };
  halfHeight: number;
  dead: boolean;
  burningFor: number;
}
let nextKey = 2;
const body = (label: string, x: number, z = 0, left = 3, height = 1.8): Body => ({ key: nextKey++, label, pos: { x, y: 0, z }, halfHeight: height / 2, dead: false, burningFor: left });
const HERE = { x: 0, y: 0, z: 0 };
const DT = 1 / 60;
const FILE = 'effects/fire.json';

/** A manager with all three seams wired, and its numbers back where they started. */
const rig = (file: string | null = FILE) => {
  resetFireTune();
  const fx = new FakeFx();
  const host = new FakeHost();
  const b = new BurningBodies();
  b.setEffects(fx);
  b.attach(host as unknown as FireHost);
  b.setEffect(file, file ? 'the pack has one' : '');
  return { b, fx, host };
};

// --- the two pure rules ----------------------------------------------------------------------------

resetFireTune();
ok(!isBurning(null) && !isBurning(undefined), 'nothing is not burning');
ok(!isBurning({ key: 2, label: 'x', pos: HERE, halfHeight: 1, dead: false }), 'a body that has never heard of a burn is not burning');
ok(isBurning({ key: 2, label: 'x', pos: HERE, halfHeight: 1, dead: false, burningFor: 3 }), 'and one with three seconds left is');
ok(!isBurning({ key: 2, label: 'x', pos: HERE, halfHeight: 1, dead: true, burningFor: 3 }), 'a corpse is not burning, whatever its own timer still says');
ok(!isBurning({ key: 2, label: 'x', pos: HERE, halfHeight: 1, dead: false, burningFor: Number.NaN }), 'a burn that is not a number is not a burn');
ok(!isBurning({ key: 2, label: 'x', pos: HERE, halfHeight: 1, dead: false, burningFor: FIRE_TUNE.least }), 'the least itself is not enough: the tail of every burn passes through it');
ok(isBurning({ key: 2, label: 'x', pos: HERE, halfHeight: 1, dead: false, burningFor: FIRE_TUNE.least + 1e-6 }), 'and a hair over it is');
ok(isBurning({ key: 2, label: 'x', pos: HERE, halfHeight: 1, dead: false, burningFor: 0.01 }, 0), 'with no least at all, any burn at all counts');

ok(fireCap(8) === 8 && fireCap(8.9) === 8, 'a cap is a whole number of bodies, rounded down');
ok(fireCap(-3) === 0, 'a cap below nothing is nothing');
ok(fireCap(Number.NaN) === 0, 'a cap that is not a number is nothing');
ok(fireCap(9999) === FIRE_MAX, 'and one past the ceiling is the ceiling, so a typo cannot fill the frame');

// --- nothing burning costs nothing -------------------------------------------------------------------

{
  const { b, fx, host } = rig();
  const cold = [body('a', 1), body('b', 2), body('c', 3)];
  for (const c of cold) c.burningFor = 0;
  for (let i = 0; i < 10; i++) b.update(DT, cold, null, HERE);
  ok(fx.all.length === 0 && fx.moves === 0 && fx.removes === 0, 'ten steps with nothing burning place, move and remove nothing');
  ok(host.started.length === 0 && host.oneShots.length === 0, 'and start no sound of any kind');
  const sink = new FakeSink();
  b.heatPlumes(sink);
  ok(sink.rows.length === 0, 'and hand the heat haze no plumes');
  ok(b.report().burning === 0 && b.report().shown === 0, 'and the listing says so');
  ok(host.prepared.length === 3, 'attaching the mixer asks the bank for the three templates up front, so nobody waits for a sample at the moment they catch fire');
}

// --- one body: the look, the sound and the heat --------------------------------------------------------

{
  const { b, fx, host } = rig();
  const c = body('a creature', 4, 0, 3, 2);
  b.update(DT, [c], null, HERE);
  ok(fx.all.length === 1, 'a body that catches fire is given one effect');
  ok(fx.all[0].file === FILE, 'from the file it was told about');
  ok(fx.all[0].sound === false, 'placed silent, because one loop a burning body is played here and an effect that carries its own crackle would otherwise be heard twice');
  close(fx.all[0].x, 4, 'at the body');
  close(fx.all[0].y, 0, 'at the height the chosen file asks for and not a centimetre more, which for the client\'s own burn is the feet, because that effect is authored standing a person\'s height up from wherever it is put');
  ok(host.started.length === 1 && host.started[0] === FIRE_TUNE.loopId, 'and one looping voice, the fire loop');
  c.pos.x = 6;
  b.update(DT, [c], null, HERE);
  ok(fx.all.length === 1 && fx.moves === 1, 'the next step moves that effect rather than placing another');
  close(fx.live[0].x, 6, 'onto where the body has walked to');
  ok(host.moves === 1, 'and moves the voice with it');
  ok(host.spaceWrites === 0, 'and writes no room, because the ear has not left the one it was in');
  const sink = new FakeSink();
  b.heatPlumes(sink);
  ok(sink.rows.length === 1, 'and the heat haze is given one plume for it');
  const p = sink.rows[0];
  close(p[3], 0, 'which stands straight up');
  close(p[4], 1, 'along the world Y');
  close(p[6], 2 * FIRE_TUNE.plumeLength, 'as long as the body is tall, times our own share');
  ok(p[8] > p[7], 'and wider at the top than at the bottom: hot air spreads as it rises');
  close(p[9], FIRE_TUNE.plumeIntensity, 'at our own intensity');
  const first = p[10];
  b.update(1, [c], null, HERE);
  const sink2 = new FakeSink();
  b.heatPlumes(sink2);
  ok(sink2.rows[0][10] !== first, 'and its noise phase is carried forward by the step rather than worked out from a clock');
}

// --- the five ways a fire must go out ------------------------------------------------------------------

{
  // 1. The burn simply ends.
  const { b, fx, host } = rig();
  const c = body('a creature', 3);
  b.update(DT, [c], null, HERE);
  const key = host.keys;
  c.burningFor = 0;
  b.update(DT, [c], null, HERE);
  ok(fx.live.length === 0 && fx.removes === 1, 'a burn that ends takes its effect down on the very next step');
  ok(host.stopped.length === 1 && host.stopped[0] === key, 'and its voice with it');
  ok(b.report().burning === 0, 'and the listing forgets it');
}
{
  // 2. The body dies, with its own timer still running.
  const { b, fx } = rig();
  const c = body('a creature', 3);
  b.update(DT, [c], null, HERE);
  c.dead = true;
  b.update(DT, [c], null, HERE);
  ok(fx.live.length === 0, 'a body that dies burning does not go on burning');
}
{
  // 3. The body is gone from the world's list altogether: disposed, culled out, unloaded. This is
  //    the one the lightsabers' lesson is about -- nothing calls back to say so, and nothing needs to.
  const { b, fx, host } = rig();
  const c = body('a creature', 3);
  b.update(DT, [c], null, HERE);
  b.update(DT, [], null, HERE);
  ok(fx.live.length === 0 && fx.removes === 1, 'a body that is simply no longer in the list loses its fire on the next step, with nothing having told anybody');
  ok(host.voices.size === 0, 'and its voice is stopped rather than left playing in the air where it stood');
}
{
  // 4. The body respawns: the manager is keyed on the body, so the old record goes and a new one
  //    is made. (The catalogue's own respawn clears the burn as well, which is checked as case 1.)
  const { b, fx } = rig();
  const c = body('a creature', 3);
  b.update(DT, [c], null, HERE);
  const reborn = body('a creature', 3);
  b.update(DT, [reborn], null, HERE);
  ok(fx.removes === 1 && fx.live.length === 1, 'a body replaced by a fresh one of its own kind takes the old fire down and lights a new one');
  ok(fx.live[0] !== fx.all[0], 'and it really is a new handle');
}
{
  // 5. The world is left.
  const { b, fx, host } = rig();
  b.update(DT, [body('a', 1), body('b', 2)], null, HERE);
  ok(fx.live.length === 2, 'two burning bodies, two fires');
  b.clear();
  ok(fx.live.length === 0 && host.voices.size === 0, 'and leaving the world puts every one of them out');
  ok(b.report().burning === 0, 'with nothing left on the books');
  const sink = new FakeSink();
  b.heatPlumes(sink);
  ok(sink.rows.length === 0, 'and no plume left behind for the heat haze to draw');
}

// --- a travel: the handle belongs to the instance that made it -------------------------------------------

{
  const { b, fx } = rig();
  b.update(DT, [body('a', 1)], null, HERE);
  const other = new FakeFx();
  b.setEffects(other);
  ok(fx.live.length === 0 && fx.removes === 1, 'handing the manager another effects instance takes every fire down in the one that made it');
  ok(other.all.length === 0, 'and places nothing in the new one until the next step');
}
{
  // A pack landing after somebody is already alight replaces the fire rather than leaving a mixture.
  const { b, fx } = rig(null);
  const c = body('a creature', 2);
  b.update(DT, [c], null, HERE);
  ok(fx.all.length === 0, 'with no file named, a burning body is still burning and simply shows nothing');
  ok(b.report().counts.noFile > 0, 'and the listing counts the steps it could not draw');
  ok(b.report().why.includes('shows nothing'), 'and says so in words rather than reading as though nothing were on fire');
  b.setEffect(FILE, 'the pack has one');
  b.update(DT, [c], null, HERE);
  ok(fx.live.length === 1 && fx.live[0].file === FILE, 'and the moment a file is named the fire is lit from it');
  b.setEffect('effects/other.json', 'the fallback');
  b.update(DT, [c], null, HERE);
  ok(fx.removes === 1 && fx.live.length === 1 && fx.live[0].file === 'effects/other.json', 'a file that changes under a lit fire replaces it rather than leaving two');
}
{
  // Where a fire stands is the **file's** answer and nothing is added to it: one effect is authored
  // standing up from where it is put and another about its own middle, and only whoever picked the
  // file knows which. `FIRE_TUNE.lift` is the other question -- extra height for a big body -- and
  // it is 0, because adding a share of the body's height to a file that already lifts itself put
  // every fire in the game over its own head.
  const { b, fx } = rig();
  const c = body('a creature', 0, 0, 3, 2);
  b.setEffect(FILE, 'a file that sits about its own middle', 1);
  b.update(DT, [c], null, HERE);
  close(fx.live[0].y, 1, 'a file that says it wants lifting a metre is lifted a metre, and that is the whole of it');
  const sink = new FakeSink();
  b.heatPlumes(sink);
  close(sink.rows[0][1], 0, 'and the hot air stands on the body, because a file that wants lifting does not make the body hotter higher up');
}
{
  // And the knob is still there for the day a big creature is seen alight.
  const { b, fx } = rig();
  tuneFire({ lift: 0.5 });
  const c = body('a bantha', 0, 0, 3, 4);
  b.setEffect(FILE, 'a file that wants nothing added', 0);
  b.update(DT, [c], null, HERE);
  close(fx.live[0].y, 2, 'a share of the body\'s height is added on top of the file\'s own when the knob asks for one: half way up a four-metre creature is two metres');
  const sink = new FakeSink();
  b.heatPlumes(sink);
  close(sink.rows[0][1], 2, 'and the hot air follows the body\'s share, which is the body\'s own question, rather than the file\'s metres');
  resetFireTune();
}

// --- the caps -----------------------------------------------------------------------------------------

{
  const { b, fx, host } = rig();
  tuneFire({ shown: 3, heard: 2, heat: 2 });
  const many: Body[] = [];
  for (let i = 1; i <= 12; i++) many.push(body(`b${i}`, i * 2));
  b.update(DT, many, null, HERE);
  const r = b.report();
  ok(r.burning === 12, 'twelve bodies are burning');
  ok(r.shown === 3 && r.unseen === 9, 'three of them are drawn and the listing says the other nine are burning unseen rather than pretending they are not there');
  ok(r.heard === 2 && r.unheard === 10, 'two are heard');
  ok(r.heated === 2 && r.unheated === 10, 'and two are heating the air');
  ok(fx.live.length === 3, 'three effects, and no more');
  ok(host.voices.size === 2, 'two voices, and no more');
  const xs = fx.live.map((h) => h.x).sort((a, c) => a - c);
  ok(xs[0] === 2 && xs[1] === 4 && xs[2] === 6, `and they are the nearest three (at ${xs.join(', ')} metres), not the first three met`);
  const sink = new FakeSink();
  b.heatPlumes(sink);
  ok(sink.rows.length === 2, 'the heat haze is given two plumes');
  close(sink.rows[0][0], 2, 'the nearest first');
  close(sink.rows[1][0], 4, 'then the next');
  // A pack of burning creatures must not be able to spend the haze's whole frame budget.
  ok(FIRE_TUNE.heat <= 48, 'and the cap is under the whole heat budget by construction');
  resetFireTune();
}
{
  // The sink filling up (every engine in the world got there first) stops the run rather than
  // spinning through what is left.
  const { b } = rig();
  tuneFire({ heat: 4 });
  b.update(DT, [body('a', 1), body('b', 2), body('c', 3), body('d', 4)], null, HERE);
  const sink = new FakeSink();
  sink.max = 1;
  b.heatPlumes(sink);
  ok(sink.rows.length === 1, 'a heat buffer that is already full takes one plume and the rest are simply not offered');
  resetFireTune();
}
{
  // The hold at the edge of the cap: without it two bodies a hair apart swap the one place between
  // them every frame, which is an effect placed and removed every frame for as long as both burn.
  const { b, fx } = rig();
  tuneFire({ shown: 1, heard: 0 });
  const a = body('a', 5);
  const c = body('c', 5.5);
  b.update(DT, [a, c], null, HERE);
  ok(fx.live.length === 1 && fx.live[0].x === 5, 'the nearer of two is the one drawn');
  c.pos.x = 4.8;
  b.update(DT, [a, c], null, HERE);
  ok(fx.live.length === 1 && fx.live[0].x === 5, 'and it keeps its place when the other creeps a little nearer: a fire already lit counts as nearer than it is');
  c.pos.x = 4;
  b.update(DT, [a, c], null, HERE);
  ok(fx.live.length === 1 && fx.live[0].x === 4, 'but a body that really is nearer takes it');
  ok(fx.all.length === 2, `and the whole exchange cost two placements rather than one a frame (${fx.all.length})`);
  resetFireTune();
}
{
  // The same hold on the *heard* cap, which is the one a single biased order silently loses: with
  // `shown` above `heard` -- which is the shipped setting -- every body near the heard cap's edge
  // has a fire already, so a bias that reads "has a fire" cancels between them and their order is
  // plain distance again. Two bodies milling at nearly equal distance then start and stop a voice
  // each every frame, and a mixer with 40 positional slots collects the fading remains.
  const { b, host } = rig();
  tuneFire({ shown: 8, heard: 1, heat: 0 });
  const a = body('a', 5);
  const c = body('c', 5.5);
  b.update(DT, [a, c], null, HERE);
  ok(host.voices.size === 1 && [...host.voices.values()][0].x === 5, 'the nearer of two burning bodies is the one heard');
  c.pos.x = 4.8;
  b.update(DT, [a, c], null, HERE);
  ok(host.started.length === 1 && [...host.voices.values()][0].x === 5, 'and it keeps the voice when the other creeps a little nearer, although both of them are drawn');
  c.pos.x = 4;
  b.update(DT, [a, c], null, HERE);
  ok(host.started.length === 2 && [...host.voices.values()][0].x === 4, 'but a body that really is nearer takes it');
  ok(host.stopped.length === 1, `and the whole exchange cost one stop and two starts rather than a pair every frame (${host.stopped.length} stops)`);
  ok(host.fades[0] === FIRE_TUNE.fade, 'and a voice let go is faded over our own seconds rather than cut dead');
  resetFireTune();
}
{
  // And on the heat cap, which has no handle and no voice of its own to be recognised by at all.
  const { b } = rig();
  tuneFire({ shown: 8, heard: 0, heat: 1 });
  const a = body('a', 5);
  const c = body('c', 5.5);
  b.update(DT, [a, c], null, HERE);
  const first = new FakeSink();
  b.heatPlumes(first);
  close(first.rows[0][0], 5, 'the nearer of two burning bodies is the one heating the air');
  c.pos.x = 4.8;
  b.update(DT, [a, c], null, HERE);
  const held = new FakeSink();
  b.heatPlumes(held);
  ok(held.rows.length === 1, 'still one plume');
  close(held.rows[0][0], 5, 'and it is still the same body: the hold is the heat cap\'s own, not the drawn cap\'s borrowed');
  c.pos.x = 4;
  b.update(DT, [a, c], null, HERE);
  const took = new FakeSink();
  b.heatPlumes(took);
  close(took.rows[0][0], 4, 'until one really is nearer');
  resetFireTune();
}
{
  // Out of range: still burning, still taking damage, drawn and heard by nobody.
  const { b, fx, host } = rig();
  tuneFire({ range: 20 });
  const near = body('near', 5);
  const far = body('far', 500);
  b.update(DT, [near, far], null, HERE);
  const r = b.report();
  ok(r.burning === 2 && r.shown === 1, 'a body burning half a kilometre off is counted as burning and is not drawn');
  ok(fx.live.length === 1 && fx.live[0].x === 5 && host.voices.size === 1, 'and neither drawn nor heard');
  far.pos.x = 10;
  b.update(DT, [near, far], null, HERE);
  ok(fx.live.length === 2, 'and it lights the moment it comes within the range');
  resetFireTune();
}

// --- the player -----------------------------------------------------------------------------------------

{
  const { b, fx, host } = rig();
  const you = body('you', 0, 0, 3);
  you.key = 1;
  b.update(DT, [], you, HERE);
  ok(fx.live.length === 1, 'the player is burnt whether or not they are in the world\'s own list of the living');
  ok(host.oneShots.length === 1 && host.oneShots[0] === FIRE_TUNE.chimeOn, 'and the client\'s own state chime says so, once');
  for (let i = 0; i < 60; i++) b.update(DT, [], you, HERE);
  ok(host.oneShots.length === 1, 'a second of burning says it once and not sixty times: nothing per tick');
  you.burningFor = 0;
  b.update(DT, [], you, HERE);
  ok(host.oneShots.length === 2 && host.oneShots[1] === FIRE_TUNE.chimeOff, 'and the other chime when it goes out');
  ok(fx.live.length === 0, 'with the fire out');
}
{
  const { b, fx, host } = rig();
  const you = body('you', 0, 0, 3);
  you.key = 1;
  // The player is in the world's list as well whenever they may be attacked: met once, not twice.
  b.update(DT, [you, body('a creature', 4)], you, HERE);
  ok(b.report().burning === 2 && fx.live.length === 2, 'a player who is in the list as well is one burning body, not two');
  ok(host.oneShots.length === 1, 'and still chimes once');
}
{
  const { b, host } = rig();
  const c = body('a creature', 2);
  b.update(DT, [c], null, HERE);
  ok(host.oneShots.length === 0, 'a creature catching fire plays no chime: the state chimes are the player\'s own');
}
{
  // `dead` on the player's own body means noclipping, aboard a hull's rooms or in a panel as well
  // as really dead. A walk up a boarding ramp must not sound as though the fire had gone out.
  //
  // This is a rule about the manager and it is the integrated game's rule too: `World.stepLiving`
  // deliberately does **not** put a burning player's fire out when they become untargetable, and
  // says why in as many words -- the guard it would need (`simulating`) is off for the whole death
  // card, so such a line did nothing at a death and everything on a boarding ramp. A fire ends where
  // the body does (`Player.startRagdoll`, `Player.reset`) or where the world does (`World.unload`),
  // all three in silence, and the record the manager reads carries no burn afterwards.
  const { b, fx, host } = rig();
  const you = body('you', 0, 0, 3);
  you.key = 1;
  b.update(DT, [], you, HERE);
  ok(host.oneShots.length === 1 && fx.live.length === 1, 'burning on foot: the chime and the fire');
  you.dead = true;
  b.update(DT, [], you, HERE);
  ok(fx.live.length === 0, 'stepping aboard, where the player may not be attacked, takes the fire out of the world (it would be placed in the planet\'s frame and the hull would fly out from under it)');
  ok(host.oneShots.length === 1, 'and says nothing: the chimes follow the burn, not whether the player may be attacked');
  you.dead = false;
  b.update(DT, [], you, HERE);
  ok(fx.live.length === 1 && host.oneShots.length === 1, 'and stepping out again lights it without a second chime');
}

// --- the room a fire is heard in ----------------------------------------------------------------------

{
  const { b, host } = rig();
  const c = body('a creature', 2);
  b.setEar({ building: 7, cell: 3 });
  b.update(DT, [c], null, HERE);
  const v = [...host.voices.values()][0];
  const atStart = v.space;
  ok(v.space.building === 7 && v.space.cell === 3, 'a fire is heard in the room the ear is standing in, so a fire in the room with you is not muffled by the wall rule');
  for (let i = 0; i < 30; i++) {
    b.setEar({ building: 7, cell: 3 });
    b.update(DT, [c], null, HERE);
  }
  ok(host.spaceWrites === 0, 'and half a second of standing still writes no room at all');
  b.setEar({ building: -1, cell: -1 });
  b.update(DT, [c], null, HERE);
  ok(host.spaceWrites === 1, 'walking out of the door writes it exactly once');
  const after = [...host.voices.values()][0];
  ok(after.space.building === -1, 'with the new room');
  ok(after.space !== atStart, 'and an object of its own rather than the kept one being written through, because the mixer keeps whatever `setSpace` is handed by reference');
}
{
  const { b, host } = rig();
  tuneFire({ earRoom: false });
  b.setEar({ building: 7, cell: 3 });
  b.update(DT, [body('a creature', 2)], null, HERE);
  const v = [...host.voices.values()][0];
  ok(v.space.building === -1, 'with the ear\'s room switched off a fire stands in the open world, which is the other reading and is one word on the knob');
  resetFireTune();
}

// --- what may go wrong without taking the frame with it -------------------------------------------------

{
  const { b, fx } = rig();
  fx.throwOnPlace = true;
  const c = body('a creature', 2);
  b.update(DT, [c], null, HERE);
  ok(b.report().counts.refused === 1, 'an effects instance that throws costs one count');
  ok(fx.live.length === 0, 'and leaves no handle behind');
  fx.throwOnPlace = false;
  b.update(DT, [c], null, HERE);
  ok(fx.live.length === 1, 'and the next step simply tries again');
}
{
  const { b, host } = rig();
  host.names = new Set<string>();
  host.bank.available = true;
  const c = body('a creature', 2);
  for (let i = 0; i < 30; i++) b.update(DT, [c], null, HERE);
  ok(host.started.length === 0, 'a loop the bank has not got is not asked for');
  ok(b.report().counts.missing === 1, 'and is counted once rather than once a frame');
}
{
  // The mixer refusing is not a fault and is not rare: before the sound pack lands, `Mixer.play`
  // answers 0 with no key and writes the refusal into the forty lines `__debug.audio().recent` is
  // read out of. A fire that asked again on the very next step would fill that report by itself --
  // three seconds of one burning creature is 180 refusals -- so a refusal waits.
  const { b, host } = rig();
  tuneFire({ retry: 1 });
  host.refuse = true;
  const c = body('a creature', 2);
  for (let i = 0; i < 60; i++) b.update(DT, [c], null, HERE);
  ok(host.asked.length === 1, `a second of burning against a mixer that will not start it asks exactly once (${host.asked.length})`);
  ok(b.report().counts.waited === 1, 'and the listing counts the wait, so a bank that never lands can be seen rather than guessed at');
  // The wait is up: one more ask, and no more than one.
  for (let i = 0; i < 60; i++) b.update(DT, [c], null, HERE);
  ok(host.asked.length === 2, `and asks again once the wait is up and not before (${host.asked.length})`);
  host.refuse = false;
  for (let i = 0; i < 62; i++) b.update(DT, [c], null, HERE);
  ok(host.voices.size === 1, 'and the moment the pack is there the fire is heard, with nothing having had to be told about it');
  resetFireTune();
}
{
  // `__debug.advance` steps simulated seconds with the mixer recording rather than playing. Every
  // request made then is a line in its report and no sound at all, so none is made.
  const { b, host } = rig();
  host.advancing = true;
  const you = body('you', 0, 0, 3);
  you.key = 1;
  for (let i = 0; i < 120; i++) b.update(DT, [], you, HERE);
  ok(host.asked.length === 0, 'two simulated seconds of burning ask the mixer for nothing at all: no loop and no chime');
  ok(b.report().counts.chimes === 0, 'and the listing claims no chime that nobody heard');
  host.advancing = false;
  b.update(DT, [], you, HERE);
  ok(host.voices.size === 1, 'and the fire is heard on the first real step after it');
}
{
  // The one count that used to be per body per step, which on a pack converted before this wave is
  // eight a frame and buries every other number in the listing.
  const { b } = rig(null);
  const many: Body[] = [];
  for (let i = 1; i <= 5; i++) many.push(body(`b${i}`, i));
  for (let i = 0; i < 10; i++) b.update(DT, many, null, HERE);
  ok(b.report().counts.noFile === 10, `ten steps with five bodies alight and no file named count ten, not fifty (${b.report().counts.noFile})`);
}
{
  // A mixer swapped under a lit fire: the voices go back to the mixer that handed the keys out,
  // while it is still the one being held. Nothing does this today; it is one line to be right about.
  const { b, host } = rig();
  b.update(DT, [body('a creature', 2)], null, HERE);
  ok(host.voices.size === 1, 'a fire with a voice');
  b.attach(null);
  ok(host.voices.size === 0 && host.stopped.length === 1, 'and taking the mixer away stops it there rather than orphaning the key');
}
{
  // A voice the mixer gives away to something nearer is asked for again rather than moved at: a
  // `move` on a key nobody holds does nothing, and the fire would be silent for the rest of its life.
  const { b, host } = rig();
  const c = body('a creature', 2);
  b.update(DT, [c], null, HERE);
  const key = host.keys;
  host.voices.delete(key);
  b.update(DT, [c], null, HERE);
  ok(host.started.length === 2, 'a voice the mixer took back is started again');
  ok(host.voices.size === 1, 'and the fire is heard again');
}
{
  const { b, fx } = rig();
  const c = body('a creature', 2);
  c.pos.x = Number.NaN;
  b.update(DT, [c], null, HERE);
  ok(fx.live.length === 0, 'a body standing nowhere is not drawn, rather than putting a fire at NaN and a screen-sized black box through the bloom');
  ok(b.report().burning === 1, 'though it is still burning');
}
{
  const { b, fx } = rig();
  b.update(DT, null, null, null);
  ok(fx.live.length === 0, 'no list and nowhere to measure from is not a crash');
}

// --- the switch and the knob ------------------------------------------------------------------------------

{
  const { b, fx, host } = rig();
  const c = body('a creature', 2);
  b.update(DT, [c], null, HERE);
  ok(fx.live.length === 1, 'burning');
  tuneFire({ on: false });
  b.update(DT, [c], null, HERE);
  ok(fx.live.length === 0 && host.voices.size === 0, 'the switch off puts every fire out and the burn is exactly what it was before this work: damage and nothing else');
  const sink = new FakeSink();
  b.heatPlumes(sink);
  ok(sink.rows.length === 0, 'and the heat haze is given nothing');
  ok(b.report().on === false, 'and the listing says which it is');
  tuneFire({ on: true });
  b.update(DT, [c], null, HERE);
  ok(fx.live.length === 1, 'and back on it lights again');
  resetFireTune();
}
{
  resetFireTune();
  const was = { ...FIRE_TUNE };
  tuneFire(undefined);
  ok(FIRE_TUNE.shown === was.shown, 'tuning with nothing changes nothing');
  tuneFire({ shown: Number.NaN, range: Number.NaN, keep: Number.NaN });
  ok(FIRE_TUNE.shown === was.shown && FIRE_TUNE.range === was.range && FIRE_TUNE.keep === was.keep, 'numbers that are not numbers are stepped over one by one');
  tuneFire({ on: 1 as unknown as boolean });
  ok(FIRE_TUNE.on === true, 'and only a boolean writes a switch');
  tuneFire({ loopId: 42 as unknown as string });
  ok(FIRE_TUNE.loopId === was.loopId, 'and only a name writes a name');
  tuneFire({ nonsense: 5 } as unknown as Partial<typeof FIRE_TUNE>);
  ok(!('nonsense' in FIRE_TUNE), 'a key that is not one of ours is not added');
  tuneFire({ shown: 9999 });
  ok(FIRE_TUNE.shown === FIRE_MAX, 'a cap past the ceiling is the ceiling');
  tuneFire({ shown: 2.7 });
  ok(FIRE_TUNE.shown === 2, 'and a cap is whole bodies');
  tuneFire({ range: -10, least: -1, keep: 5, fade: -1 });
  ok(FIRE_TUNE.range === 0 && FIRE_TUNE.least === 0 && FIRE_TUNE.keep === 1 && FIRE_TUNE.fade === 0, 'and every number that has an end is held to it');
  resetFireTune();
  ok(FIRE_TUNE.shown === was.shown && FIRE_TUNE.range === was.range && FIRE_TUNE.on === was.on, 'and the reset puts the lot back');
}

// --- making the effect ready before anybody burns ------------------------------------------------------------

{
  const asked: string[] = [];
  const fx = {
    prepare: async (file: string): Promise<boolean> => {
      asked.push(file);
      return true;
    },
  };
  ok((await prepareFireEffect(fx, null, FILE)) === true, 'the fire\'s own effect is made ready behind the loading screen, so no fire builds a program on the frame it is first lit');
  ok(asked.length === 1 && asked[0] === FILE, 'from the file it was given');
  ok((await prepareFireEffect(fx, null, null)) === false, 'with no file there is nothing to make ready');
  ok((await prepareFireEffect(null, null, FILE)) === false, 'and with no effects instance either');
  const bad = {
    prepare: async (): Promise<boolean> => {
      throw new Error('the pack is not there');
    },
  };
  ok((await prepareFireEffect(bad, null, FILE)) === false, 'and a pack that will not load says no rather than taking the world load down with it');
}

// --- the rack and the world's load race each other ------------------------------------------------------------

{
  // The weapons rack is fetched once at boot and the first world's load races it. A choice made once
  // at the load, with no rack in hand, would stand for the whole session on that planet: every burn
  // invisible, and the console line telling the owner to reconvert a pack that is perfectly good.
  const asked: string[] = [];
  const fx = {
    prepare: async (file: string): Promise<boolean> => {
      asked.push(file);
      return true;
    },
  };
  // The rack, as far as this needs it: the one method that answers which fire to draw, which the
  // real one works out once and says its own console line about once.
  let asks = 0;
  const rack = {
    fireLook: (): { file: string; lift: number } | null => {
      asks++;
      return { file: 'effects/onfire.json', lift: 0 };
    },
  };
  const b = new BurningBodies();
  const before = await adoptFireLook(fx, null, null, b);
  ok(before.file === null && before.known === false, 'a world load that reaches the choice before the rack does draws nothing');
  ok(asks === 0 && asked.length === 0, 'and asks the rack nothing and prepares nothing, rather than reading a pack it has not got and blaming it in the console');
  ok(b.report().why.includes('has not landed'), 'and the listing says which of the two it is waiting on');
  const landed = await adoptFireLook(fx, null, rack, b);
  ok(landed.file === 'effects/onfire.json' && b.effectFile === 'effects/onfire.json', 'and the rack landing afterwards is what chooses the fire, on the very call that would otherwise never come');
  ok(asks === 1 && asked.length === 1 && asked[0] === 'effects/onfire.json', 'with the file made ready before anybody can be set alight');
  const empty = { fireLook: (): { file: string; lift: number } | null => null };
  const none = await adoptFireLook(fx, null, empty, b);
  ok(none.file === null && none.known === true && b.effectFile === null, 'a pack that really was converted before the burn draws nothing, and is a different answer from having no pack at all');
  ok(b.report().why.includes('weapons command'), 'and the listing carries the rack\'s own words, which name the command to run');
}

console.log(`\n${passed} checks passed`);
