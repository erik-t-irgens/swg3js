// Footprints, without a renderer: which ground keeps a print and which keeps none, where a print
// goes against the body that left it, the two feet taken in turn, the rules that keep a body
// standing still from stacking prints in one place, and a body walking from its clips all the way
// to the mark -- a print on sand, none on a metal floor and none at all aboard a hull.
import assert from 'node:assert/strict';
import { footprints, Footprints, PRINT_TUNE, facingOf, sideOf, stanceOffset, slopeStep, lifeFor, type PrintMark } from '../../../src/world/footprints.ts';
import { PRINT_SURFACES, printDepth } from '../../../src/world/surfaces.ts';
import { BodySounds, type FootGround, type FootStep } from '../../../src/audio/footsteps.ts';
import type { ActiveClip } from '../../../src/audio/clipEvents.ts';

let checks = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  checks++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol: number, what: string) => ok(Math.abs(a - b) <= tol, `${what} (${a.toFixed(4)} vs ${b.toFixed(4)})`);

/** One step, as the feet hand it over: a kept record there, a fresh one here. */
function step(over: Partial<FootStep> = {}): FootStep {
  return { key: 1, kind: 'player', label: 'human_male', surface: 'sand', from: 'terrain', x: 0, y: 0, z: 0, heading: 0, scale: 1, inside: false, deck: null, ground: null, ...over };
}

/** A world that answers with one slope and one collider, as `World.footSurfaces.footGround` does. */
function onGround(nx: number, ny: number, nz: number, owner: number): (out: FootGround) => boolean {
  return (out: FootGround) => {
    out.nx = nx;
    out.ny = ny;
    out.nz = nz;
    out.owner = owner;
    return true;
  };
}

/** A marks system that draws nothing and writes down what it was asked for. */
function catcher(): { marks: PrintMark[]; sink: (m: PrintMark) => void } {
  const marks: PrintMark[] = [];
  // The record handed over is one the caller keeps and refills, so it is copied out rather than held.
  return { marks, sink: (m: PrintMark) => void marks.push({ ...m }) };
}

/** A fresh system with a catcher on it, since the game's own is a singleton with a session's state. */
function fresh(): { prints: Footprints; marks: PrintMark[] } {
  const prints = new Footprints();
  const { marks, sink } = catcher();
  prints.sink = sink;
  // Its own copy of the numbers: a test that moved one would otherwise move the game's.
  (prints as { tune: typeof PRINT_TUNE }).tune = { ...PRINT_TUNE };
  return { prints, marks };
}

// --- which ground keeps a print ----------------------------------------------------------------

{
  ok(printDepth('sand') === 1 && printDepth('snow') === 1, 'sand and snow keep a whole print');
  ok(printDepth('mud') > 0 && printDepth('softdirt') > 0, 'mud and soft dirt keep one too');
  ok(printDepth('stone') === 0 && printDepth('rock') === 0 && printDepth('harddirt') === 0 && printDepth('grass') === 0, 'hard ground keeps none: stone, rock, hard dirt and grass');
  ok(printDepth('metal') === 0 && printDepth('wood') === 0 && printDepth('carpet') === 0, "and neither does a room's own floor");
  ok(printDepth('water') === 0 && printDepth('surf') === 0, 'nor water, where a print would wash out as it was made');
  ok(printDepth(null) === 0 && printDepth(undefined) === 0 && printDepth('') === 0, 'a body swimming has no surface at all, and no print');
  ok(Object.values(PRINT_SURFACES).every((d) => d > 0 && d <= 1), 'every surface in the table keeps something and none keeps more than everything');
}

// --- where a print goes -------------------------------------------------------------------------

{
  const f = { x: 0, z: 0 };
  const s = { x: 0, z: 0 };
  facingOf(0, f);
  // The game's own convention, and not the camera's: a body's heading is where it is going
  // (`atan2(move.x, move.z)`), so its forward is `(sin h, cos h)` -- the same three lines a mobile's
  // muzzle, a fighter's walk step and the player's own `enemyNear` are written with. Read with the
  // camera's `forward()` formula instead, every print points the way the body came from.
  near(f.x, 0, 1e-9, 'heading 0 faces along +Z, as everything that walks in this game does (x)');
  near(f.z, 1, 1e-9, 'heading 0 faces along +Z (z)');
  sideOf(0, s);
  near(s.x, 1, 1e-9, 'and its side is +X (x)');
  near(s.z, 0, 1e-9, 'and its side is +X (z)');
  facingOf(Math.PI / 2, f);
  near(f.x, 1, 1e-9, 'a quarter turn faces along +X');
  near(f.z, 0, 1e-9, 'and no longer along Z at all');
  sideOf(Math.PI / 2, s);
  near(s.z, -1, 1e-9, 'and its side turns with it');
  // The one thing a body walking forward must satisfy: a step taken along its facing moves it the
  // way the game's own movement code moves it, which is what pins the convention to the game.
  for (const h of [0, 0.7, 2.5, -1.4]) {
    facingOf(h, f);
    near(f.x, Math.sin(h), 1e-9, `at ${h.toFixed(1)} rad a print points the way a fighter's own walk step goes (x)`);
    near(f.z, Math.cos(h), 1e-9, `at ${h.toFixed(1)} rad a print points the way a fighter's own walk step goes (z)`);
  }
  // Whatever the heading, the two are at right angles and both are unit.
  for (const h of [0, 0.3, 1.1, -2.2, 5.9]) {
    facingOf(h, f);
    sideOf(h, s);
    near(f.x * s.x + f.z * s.z, 0, 1e-9, `at ${h.toFixed(1)} rad the way it points and its own side are at right angles`);
    near(Math.hypot(f.x, f.z), 1, 1e-9, `at ${h.toFixed(1)} rad the way it points is one metre long`);
  }
  ok(stanceOffset(0.2, 1, false) === 0.2 && stanceOffset(0.2, 1, true) === -0.2, 'the two feet are stepped off the body the same distance either side');
  ok(stanceOffset(0.2, 2, false) === 0.4, "and a body twice the size stands twice as wide");
}

// --- the slope the print is laid in ----------------------------------------------------------------

{
  const o = { x: 0, y: 0, z: 0 };
  slopeStep(1, 0, 0, 1, 0, 0.17, o);
  ok(o.x === 0.17 && o.y === 0 && o.z === 0, 'on flat ground the step onto the other foot is the plain sideways one');
  slopeStep(1, 0, 0, 1, 0, -0.17, o);
  ok(o.x === -0.17 && o.y === 0, 'and the other foot goes the other way');
  // A face leaning 30 degrees, with the slope running along X: the step across it rises with it.
  const a = Math.PI / 6;
  const n = { x: Math.sin(a), y: Math.cos(a), z: 0 };
  slopeStep(1, 0, n.x, n.y, n.z, 0.5, o);
  near(Math.hypot(o.x, o.y, o.z), 0.5, 1e-9, 'a step up a slope is the length it was asked for');
  near(o.x * n.x + o.y * n.y + o.z * n.z, 0, 1e-9, 'and lies in the slope rather than through it');
  // The normal leans toward +X, so the face falls that way and a step along +X goes down it.
  near(o.y, -0.5 * Math.sin(a), 1e-9, 'so the far foot really is further down the face, by the slope of it');
  // Across the slope instead: nothing to climb, so it stays level.
  slopeStep(0, 1, n.x, n.y, n.z, 0.5, o);
  near(o.y, 0, 1e-9, 'a step along the contour climbs nothing');
  // Whatever the ground, the step stays in it and keeps its length.
  for (const [nx, ny, nz] of [[0.3, 0.9, 0.2], [-0.6, 0.7, 0.4], [0, 0.5, 0.87]]) {
    const len = Math.hypot(nx, ny, nz);
    const ux = nx / len;
    const uy = ny / len;
    const uz = nz / len;
    slopeStep(0.6, -0.8, ux, uy, uz, 0.2, o);
    near(o.x * ux + o.y * uy + o.z * uz, 0, 1e-9, `on a ground facing ${uy.toFixed(2)} up the step lies in it`);
    near(Math.hypot(o.x, o.y, o.z), 0.2, 1e-9, 'and is still the length it was asked for');
  }
}

// --- how deeply the ground took it ------------------------------------------------------------------

{
  near(lifeFor(45, 1, 1), 45, 1e-9, 'ground that keeps a whole print keeps it for the whole life');
  near(lifeFor(45, 0.6, 1), 27, 1e-9, 'and soft dirt, which keeps less of one, loses it sooner');
  near(lifeFor(45, 0.6, 0), 45, 1e-9, 'with the grading turned off every print lasts the same time');
  near(lifeFor(45, 0.6, 0.5), 36, 1e-9, 'and half way between is half way between');
  ok(lifeFor(45, -3, 1) === 0 && lifeFor(45, 9, 1) === 45, 'a strength outside 0 to 1 is taken as the nearest of them');
}

// --- one body walking ----------------------------------------------------------------------------

{
  const { prints, marks } = fresh();
  const t = prints.tune;
  prints.step(step({ x: 0, z: 0 }));
  prints.step(step({ x: 0, z: -1 }));
  prints.step(step({ x: 0, z: -2 }));
  ok(marks.length === 3, 'three steps down a beach leave three prints');
  ok(marks[0].left !== marks[1].left && marks[1].left !== marks[2].left, 'the feet are taken in turn, so a walk leaves a left, a right and a left');
  near(marks[0].x, stanceOffset(t.stance, 1, marks[0].left), 1e-9, 'each print is stepped off the middle by half a stance');
  ok(Math.sign(marks[0].x) === -Math.sign(marks[1].x), 'and the two feet fall either side of where the body was');
  ok(marks[0].sx === -marks[1].sx && marks[0].sz === -marks[1].sz, 'the left print is the right one mirrored, which is how one picture draws both');
  near(marks[0].fz, 1, 1e-9, 'a print points the way its body was going, which at heading 0 is +Z');
  ok(marks[0].length === t.length && marks[0].width === t.width && marks[0].life === t.life, 'and it is the tuned size and lasts the tuned time');
  ok(marks[0].strength === 1 && marks[0].surface === 'sand', 'it carries how deeply the ground took it and what that ground was');
  ok(marks[0].nx === 0 && marks[0].ny === 1 && marks[0].nz === 0 && marks[0].owner === null, 'with a world that cannot say, it lies flat and belongs to the world itself');
  ok(prints.log.length === 3 && prints.log[0].foot !== prints.log[1].foot, 'the report keeps the last few prints, each with its own foot');
  ok(prints.log[0].slope === 0 && prints.log[0].owner === null && prints.log[0].life === t.life, 'and the report carries the slope, the thing it was laid on and how long it will last');
}

// --- on a slope, and on something that can stream out ------------------------------------------------

{
  const { prints, marks } = fresh();
  const t = prints.tune;
  // A dune face leaning 20 degrees, with the fall line along X.
  const a = (20 * Math.PI) / 180;
  const ask = onGround(Math.sin(a), Math.cos(a), 0, 0);
  prints.step(step({ x: 0, z: 0, y: 5, ground: ask }));
  near(Math.hypot(marks[0].nx, marks[0].ny, marks[0].nz), 1, 1e-9, "a print carries the ground's own normal, made a unit vector");
  near(marks[0].ny, Math.cos(a), 1e-9, 'which is the face it was laid on and not straight up');
  // The middle is stepped onto the face, so it is neither buried in it nor floating over it.
  const dx = marks[0].x - 0;
  const dy = marks[0].y - 5;
  const dz = marks[0].z - 0;
  near(dx * marks[0].nx + dy * marks[0].ny + dz * marks[0].nz, 0, 1e-9, 'and its middle sits on the face rather than in it');
  near(Math.hypot(dx, dy, dz), t.stance, 1e-9, 'half a stance from where the body stood, measured along the slope');
  // A normal pointing sideways is a wall, not a floor: taken as flat rather than laid on its edge.
  prints.step(step({ x: 9, z: 0, ground: onGround(1, 0, 0, 0) }));
  ok(marks[1].ny === 1, 'a normal no foot could have stood on is taken as flat');
  // And the thing underfoot, so the print goes down when that thing streams out.
  prints.step(step({ x: 20, z: 0, ground: onGround(0, 1, 0, 41) }));
  ok(marks[2].owner === 41, 'a print laid on a placed object carries that object, so it can die with it');
  ok(prints.log[prints.log.length - 1].owner === 41, 'and the report says which one');
  // Soft dirt keeps less of a print than sand does, and that is spent on how long it lasts.
  prints.step(step({ x: 30, z: 0, surface: 'softdirt' }));
  const soft = marks[marks.length - 1];
  near(soft.life, lifeFor(t.life, printDepth('softdirt'), t.strengthLife), 1e-9, 'a print in soft dirt is graded by how deeply that ground took it');
  ok(soft.life < t.life && soft.strength === printDepth('softdirt'), 'so the table\'s own grading reaches something rather than nothing');
}

// --- what leaves nothing --------------------------------------------------------------------------

{
  const { prints, marks } = fresh();
  prints.step(step({ surface: 'stone', x: 1 }));
  prints.step(step({ surface: 'metal', x: 2 }));
  prints.step(step({ surface: null, x: 3 }));
  ok(marks.length === 0 && prints.counts.hardGround === 3, 'a walk over stone, over a metal floor and through deep water leaves nothing');
  // Aboard a hull the place is the hull's own frame and the marks are in the world's, so a print
  // made there would hang in the air the moment the ship moved: none is made at all.
  prints.step(step({ surface: 'sand', deck: 'metal', x: 4 }));
  ok(marks.length === 0 && prints.counts.aboard === 1, 'and a step taken aboard a hull leaves none either, whatever its deck is made of');
  prints.tune.enabled = false;
  prints.step(step({ x: 5 }));
  ok(marks.length === 0 && prints.counts.off === 1, 'turned off, nothing is laid and the step is still counted');
  prints.tune.enabled = true;
  prints.step(step({ x: 5 }));
  ok(marks.length === 1, 'turned back on, the next step prints');
}

// --- a body standing still --------------------------------------------------------------------------

{
  const { prints, marks } = fresh();
  const t = prints.tune;
  prints.step(step({ x: 0, z: 0 }));
  // A clip that marks feet while the body goes nowhere (a dance, a shuffle in place).
  for (let i = 0; i < 8; i++) prints.step(step({ x: 0, z: t.minStep * 0.2 }));
  ok(marks.length === 1 && prints.counts.tooSoon === 8, 'a body marking feet where it stands leaves one print and not a heap');
  prints.step(step({ x: 0, z: t.minStep * 1.5 }));
  ok(marks.length === 2, 'and the moment it really moves it prints again');
}

// --- a creature's own size ----------------------------------------------------------------------------

{
  const { prints, marks } = fresh();
  const t = prints.tune;
  prints.step(step({ key: 7, label: 'a big one', scale: 2.5, x: 0, z: 0 }));
  near(marks[0].length, t.length * 2.5, 1e-9, "a creature's print is its own size");
  prints.step(step({ key: 7, scale: 99, x: 0, z: t.minStep * 99 }));
  near(marks[1].length, t.length * t.maxScale, 1e-9, 'and however big it says it is, the print is capped');
}

// --- two bodies, and forgetting them ------------------------------------------------------------------

{
  const { prints, marks } = fresh();
  prints.step(step({ key: 1, x: 0, z: 0 }));
  prints.step(step({ key: 2, x: 10, z: 0 }));
  ok(marks.length === 2, 'two bodies walking side by side leave a print each');
  ok(marks[0].left === marks[1].left, "and each body's feet are its own, so neither takes the other's turn");
  prints.tune.bodies = 4;
  for (let key = 3; key < 40; key++) prints.step(step({ key, x: key, z: 0 }));
  ok(prints.feetCount <= 4, 'the bodies remembered are capped, so a valley of wildlife keeps a handful of records');
  prints.leave();
  ok(prints.feetCount === 0 && prints.log.length === 0, 'and a world let go of forgets every one of them');
}

// --- nobody listening ------------------------------------------------------------------------------

{
  const prints = new Footprints();
  prints.step(step());
  ok(prints.counts.noSink === 1 && prints.counts.steps === 1, 'before the world has a marks system a step is counted and nothing is drawn');
  ok(!prints.status().drawn, 'and the report says so rather than looking as though prints were being laid');
}

// --- from a body's own clips, through the feet, to the mark ---------------------------------------------

{
  /** The mixer as the feet use it: nothing sounds, and every call is written down. */
  class FakeHost {
    readonly played: { id: string }[] = [];
    private next = 1;
    readonly grid = { isNear: () => true };
    readonly bank = { available: true, sources: null, template: () => ({}) };
    play(id: string): number {
      this.played.push({ id });
      return this.next++;
    }
    loop(): number {
      return this.next++;
    }
    stop(): void {}
    move(): void {}
    setGain(): void {}
    setSpace(): void {}
    isPlaying(): boolean {
      return true;
    }
    prepare(): void {}
  }
  /** One looping clip, whose time the test moves by hand. */
  class FakeClips {
    time: number;
    private readonly token = {};
    constructor(time: number) {
      this.time = time;
    }
    activeClips(out: ActiveClip[]): number {
      out[0] = { name: 'run', half: 'whole', time: this.time, duration: 1, timeScale: 1, weight: 1, looping: true, token: this.token };
      return 1;
    }
  }

  const feet = new BodySounds(new FakeHost() as never, '');
  feet.adoptEvents({
    clientData: { 'clientdata/player/client_shared_player_human_m.cdf': { events: { footstep: 'sound/fs.snd' } } },
    clientEffects: {},
  });
  feet.index.adopt({
    clips: { 'appearance/animation/all_b_loc_run.ans': { events: [{ name: 'event_footstep', f: 0.5 }] } },
    species: { tables: { table: { run: 'appearance/animation/all_b_loc_run.ans' } }, species: { human_male: { template: 'object/creature/player/shared_human_male.iff', table: 'table', clientData: 'clientdata/player/client_shared_player_human_m.cdf' } } },
  });
  const ground = { surface: 'abstract/terrain_surface/sand.iff' as string | null };
  const room = { surface: null as string | null };
  feet.setSurfaceTable({ 'abstract/terrain_surface/sand.iff': { type: 'sand' } });
  // What the world says about the ground itself, which is asked for only when a print is really
  // going to be laid: a face leaning a little, and a collider that could stream out from under it.
  const asked = { n: 0 };
  feet.attachWorld({
    waterTop: () => -Infinity,
    roomSurface: () => room.surface,
    objectTemplate: () => null,
    groundTemplate: () => ground.surface,
    space: () => null,
    footGround: (_x: number, _y: number, _z: number, _inside: boolean, out: FootGround) => {
      asked.n++;
      out.nx = 0.6;
      out.ny = 0.8;
      out.nz = 0;
      out.owner = 12;
      return true;
    },
  });

  const { prints, marks } = fresh();
  feet.onStep = prints.stepHook;
  const clips = new FakeClips(0.4);
  const player = { x: 0, y: 0, z: 0, heading: Math.PI / 2, inside: false, deck: null as string | null, space: null, dead: false, species: 'human_male', activeClips: (out: ActiveClip[]) => clips.activeClips(out) };
  const lists = { player, mobiles: [] as never[], fighters: [] as never[] };
  const ear = { x: 0, y: 0, z: 0 };
  feet.update(1 / 60, ear, lists);
  clips.time = 0.6;
  feet.update(1 / 60, ear, lists);
  ok(marks.length === 1, 'a body walking on sand lays a print on the frame its own clip says the foot lands');
  near(marks[0].fx, 1, 1e-6, "and the print points the way the body was facing, not the way the world does");
  ok(asked.n === 1 && marks[0].owner === 12, "the feet hand the step's own question on, so the print knows the slope and the thing it was laid on");
  near(marks[0].ny, 0.8, 1e-9, 'and it is laid in that slope');
  ok(marks[0].surface === 'sand', 'laid on what the feet worked out it was standing on, which is the one answer both of them use');
  // The same walk on a metal floor indoors: the sound changes and the print is not laid at all.
  player.inside = true;
  room.surface = 'metal';
  clips.time = 0.4;
  feet.update(1 / 60, ear, lists);
  clips.time = 0.6;
  feet.update(1 / 60, ear, lists);
  ok(marks.length === 1 && prints.counts.hardGround === 1, 'the same walk on a metal floor leaves the sound and nothing on the floor');
  // And aboard a hull, where the place is the hull's own frame.
  player.inside = true;
  player.deck = 'metal';
  ground.surface = 'abstract/terrain_surface/sand.iff';
  clips.time = 0.4;
  feet.update(1 / 60, ear, lists);
  clips.time = 0.6;
  feet.update(1 / 60, ear, lists);
  ok(marks.length === 1 && prints.counts.aboard === 1, 'and aboard a hull nothing is laid, since the marks are drawn in the world and the body is not');
}

// --- the game's own -----------------------------------------------------------------------------------

{
  ok(footprints.tune === PRINT_TUNE, "the game's own prints read the tuning object itself, so the console moves what the game reads");
  ok(footprints.sink === null, 'and nothing is wired to it until a world is');
}

console.log(`${checks} checks passed`);
