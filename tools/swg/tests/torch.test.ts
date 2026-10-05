// The hand torch (src/player/torch.ts): where it is carried, where it points, how bright it may be,
// and the one ray a frame it is aimed with (`Physics.aimDistance`), in a real physics world.
//
// Two faults are pinned. Carried at the camera, which in third person stands metres behind the body,
// its cone went straight through the player's back, and the torch casts no shadow, so it lit what the
// body should have hidden; carried at the head and aimed at the crosshair's point, the back is behind
// the light. And at 260 candela with three's falloff, 1 / max(d^decay, 0.01), a wall at arm's length
// took hundreds of times the sun's irradiance (2.4); capped by the distance to what it is aimed at, it
// never takes more than `maxIrradiance`. Every number checked is ours; nothing is read from the game.
//
// And a third: on layer 0 alone the torch lit nothing indoors, because the portal renderer draws a
// building's rooms through a camera that sees layers 1 and 31 and three leaves out any light whose
// layers that camera does not see. It carries the actor layer now, as the flash pool does, set once
// as it is made and never again.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Group, Physics, RAPIER, groups } from '../../../src/core/physics.ts';
import { TORCH_TUNE, newTorchPose, placeTorch, torchIntensity, type TorchVec } from '../../../src/player/torch.ts';
import { ACTOR_LAYER, INTERIOR_LAYER, markActor, passesSeeing } from '../../../src/world/portalRender.ts';

let passed = 0;
const ok = (cond: boolean, what: string) => {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const T = TORCH_TUNE;
/** What three puts on a surface d metres down the beam's axis (the cutoff window left out, which only lowers it). */
const irradianceAt = (intensity: number, d: number) => intensity / Math.max(Math.pow(d, T.decay), 0.01);
const v = (x: number, y: number, z: number): TorchVec => ({ x, y, z });
const sub = (a: TorchVec, b: TorchVec) => v(a.x - b.x, a.y - b.y, a.z - b.z);
const dot = (a: TorchVec, b: TorchVec) => a.x * b.x + a.y * b.y + a.z * b.z;
const len = (a: TorchVec) => Math.sqrt(dot(a, a));
/** The angle, radians, between the beam (source to target) and the line from the source to a point. */
const offBeam = (source: TorchVec, target: TorchVec, p: TorchVec) => Math.acos(Math.max(-1, Math.min(1, dot(sub(target, source), sub(p, source)) / (len(sub(target, source)) * len(sub(p, source))))));

// ---------------------------------------------------------------------------------------------
// How bright.
{
  ok(torchIntensity(Infinity, T) === T.intensity && torchIntensity(Number.NaN, T) === T.intensity, 'with nothing aimed at the torch is as bright as it always was');
  let worst = 0;
  for (let d = 0; d <= T.distance; d += 0.05) worst = Math.max(worst, irradianceAt(torchIntensity(d, T), d));
  ok(worst <= T.maxIrradiance + 1e-9, `whatever it is aimed at takes at most ${T.maxIrradiance} (the sun gives 2.4), where at half a metre it took ${irradianceAt(T.intensity, 0.5).toFixed(0)}`);
  const free = Math.pow(T.intensity / T.maxIrradiance, 1 / T.decay);
  ok(torchIntensity(free + 1, T) === T.intensity && torchIntensity(free - 1, T) < T.intensity, `past ${free.toFixed(1)} m nothing is held back; nearer, the cap takes over`);
  ok(near(torchIntensity(free, T), T.intensity, 1e-6), 'and the two meet without a step');
  let rises = true;
  for (let d = 0; d < T.distance; d += 0.1) if (torchIntensity(d + 0.1, T) < torchIntensity(d, T)) rises = false;
  ok(rises, 'the farther what it is aimed at, the brighter the torch may be, never the other way');
  ok(torchIntensity(-1, T) >= 0 && torchIntensity(0, T) > 0, 'a distance at or under nothing is a surface on the lens, still lit, never a negative light');
}

// ---------------------------------------------------------------------------------------------
// Where it is carried.
{
  const up = v(0, 1, 0);
  const look = v(0, 0, -1);
  const head = v(0, 1.6, 0);
  // Third person: the camera stands 4 m behind the head and a little above.
  const eye = v(0, 2.2, 4);
  const lookDown = (() => {
    const d = sub(v(0, 1.6, -10), eye);
    const l = len(d);
    return v(d.x / l, d.y / l, d.z / l);
  })();
  const pose = newTorchPose();
  const back = v(0, 1.3, 0.18);
  // The old torch: at the camera, down the view.
  const oldTarget = v(eye.x + lookDown.x * 12, eye.y + lookDown.y * 12, eye.z + lookDown.z * 12);
  ok(offBeam(eye, oldTarget, back) < T.angle, "carried at the camera, the player's back sat inside the cone (which is the fault)");
  const wall = len(sub(v(0, 1.6, -10), eye));
  const same = placeTorch(eye, lookDown, up, head, wall, T, pose);
  ok(same === pose, 'the pose is written into the record handed in: nothing is made a frame');
  ok(dot(sub(pose.source, head), lookDown) > 0 && len(sub(pose.source, head)) < 0.5, 'in third person it is carried at the head, a little in front of it');
  ok(offBeam(pose.source, pose.target, back) > Math.PI / 2, "and the player's back is behind the light, where no cone reaches");
  ok(near(pose.target.z, -10, 1e-9) && near(pose.target.y, 1.6, 1e-9), "it is aimed at the crosshair's point, the wall the view meets");
  ok(near(pose.aimed, len(sub(pose.target, pose.source)), 1e-9), 'and how far that point is, from the torch, is what caps it');
  const side = (pose.source.x - head.x);
  ok(near(side, T.side, 1e-9), 'held to the right of the head, by the tune\'s own amount');

  // First person: at the eye, down the view, as it always was.
  const fp = placeTorch(head, look, up, null, 5, T, newTorchPose());
  ok(fp.source.x === head.x && fp.source.y === head.y && fp.source.z === head.z, 'in first person it stays at the eye');
  ok(near(fp.target.z, -5, 1e-9) && fp.aimed === 5, 'aimed down the view at what the view meets');
  const fpNone = placeTorch(head, look, up, null, Infinity, T, newTorchPose());
  ok(fpNone.aimed === Infinity && near(fpNone.target.z, -T.distance, 1e-9), 'and with nothing in reach it points down the view and is not held back');

  // Something between the camera and the head: the crosshair's point is behind the torch, so the beam
  // goes down the view and nothing is known to be in front of it.
  const between = placeTorch(eye, lookDown, up, head, 1.5, T, newTorchPose());
  ok(between.aimed === Infinity && dot(sub(between.target, between.source), lookDown) > 0, 'a crosshair point behind the torch is not aimed at: the beam goes down the view');
  // Nothing hit: down the view, uncapped.
  const open = placeTorch(eye, lookDown, up, head, Infinity, T, newTorchPose());
  ok(open.aimed === Infinity && near(len(sub(open.target, open.source)), T.distance, 1e-9), 'with nothing in reach it shines down the view as far as it reaches');
  // Straight down the up axis: no right to hold it to, and nothing is NaN.
  const downward = placeTorch(v(0, 6, 0), v(0, -1, 0), up, head, 6, T, newTorchPose());
  ok([downward.source.x, downward.source.y, downward.source.z, downward.target.y].every(Number.isFinite), 'looking straight down nothing comes out as a NaN');
}

// ---------------------------------------------------------------------------------------------
// The one ray a frame, in a real physics world.
{
  const physics = await Physics.create();
  const w = physics.world;
  // The player: a capsule at the origin the ray starts behind.
  const player = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 1, 0));
  w.createCollider(RAPIER.ColliderDesc.capsule(0.5, 0.35), player);
  // A speeder under them.
  const ridden = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.3, -1.5).setGravityScale(0));
  w.createCollider(RAPIER.ColliderDesc.cuboid(0.6, 0.3, 1), ridden);
  // A wall 6 m ahead, a creature 4 m ahead off to the side, a sensor 2 m ahead, a building shell 3 m ahead off to the other side.
  w.createCollider(RAPIER.ColliderDesc.cuboid(5, 5, 0.25).setTranslation(0, 1, -6));
  const creature = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(3, 1, -4).setGravityScale(0));
  w.createCollider(RAPIER.ColliderDesc.ball(0.4), creature);
  w.createCollider(RAPIER.ColliderDesc.cuboid(1, 1, 0.1).setTranslation(0, 1, -2).setSensor(true));
  w.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 2, 0.5).setTranslation(-3, 1, -3).setCollisionGroups(groups(Group.exterior, Group.all)));
  physics.step(1 / 60);

  // From a camera 3 m behind the player, straight through it.
  const d = physics.aimDistance(0, 1, 3, 0, 0, -1, 70, false, player);
  ok(near(d, 3 + 6 - 0.25, 1e-3), `the ray looks through the player's own body and the sensor to the wall (${d.toFixed(2)} m)`);
  const low = physics.aimDistance(0, 0.4, 3, 0, 0, -1, 70, false, player, ridden.handle);
  ok(near(low, 9 - 0.25, 1e-3), "and through what the player rides, when it is named");
  ok(physics.aimDistance(0, 0.4, 3, 0, 0, -1, 70, false, player) < 4, 'but not when it is not');
  const toCreature = physics.aimDistance(3, 1, 3, 0, 0, -1, 70, false, player);
  ok(near(toCreature, 7 - 0.4, 1e-3), 'a creature in the way is something the light lands on, as a wall is');
  ok(physics.aimDistance(0, 1, 3, 0, 0, 1, 70, false, player) === Infinity, 'an open view answers Infinity');
  ok(physics.aimDistance(0, 1, 3, 0, 0, -1, 5, false, player) === Infinity, 'and so does a wall past the reach');
  const shell = physics.aimDistance(-3, 1, 3, 0, 0, -1, 70, false, player);
  const shellInside = physics.aimDistance(-3, 1, 3, 0, 0, -1, 70, true, player);
  ok(near(shell, 6 - 0.5, 1e-3) && near(shellInside, 9 - 0.25, 1e-3), "indoors a building's shell is looked through, as the camera looks through it");
  physics.step(1 / 60);
  ok(near(physics.aimDistance(0, 1, 3, 0, 0, -1, 70, false, player), d, 1e-6), 'and a later frame asks the same of the same world, the skipped body forgotten between asks');
}

// ---------------------------------------------------------------------------------------------
// The wiring: the game writes every number every frame, and only uniforms.
{
  const main = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8');
  const step = /private stepTorch\(\): void \{[\s\S]*?\n {2}\}/.exec(main)?.[0] ?? '';
  ok(step.length > 0, 'the game steps the torch in one method');
  ok(['torch.distance = T.distance', 'torch.angle = T.angle', 'torch.penumbra = T.penumbra', 'torch.decay = T.decay', 'torch.intensity = torchIntensity(pose.aimed, T)'].every((s) => step.includes(s)), 'and writes every number of the tune onto the light each frame it is on');
  ok(!/castShadow|\.visible\s*=|scene\.(add|remove)\(/.test(step), 'never its shadow, its visibility or its place in the scene, which would change the light count and recompile every program');
  ok((step.match(/aimDistance\(/g) ?? []).length === 2 && !/new THREE\.|new RAPIER\./.test(step), 'one ray a frame (in the room\'s world aboard, the world\'s elsewhere), and nothing made');
  // The fault itself is a wiring one: placeTorch keeps the torch at the camera whenever it is handed no
  // head, so the head must be found in third person and handed over, and never in first person.
  const third = /if \(!firstPerson\) \{([\s\S]*?)\n {4}\}/.exec(step)?.[1] ?? '';
  ok(/const firstPerson = this\.cam\.firstPerson;\s*let head: THREE\.Vector3 \| null = null;/.test(step), 'in first person no head is handed over, so the torch stays at the eye');
  ok(/const eyes = this\.eyes\(\);/.test(third) && /head = eyes \? torchHead\.copy\(eyes\) : torchHead\.copy\(player\.worldPos\)\.addScaledVector\(camera\.up, player\.eyeHeight\);/.test(third), "in third person the head is the rig's eyes, or the body's eye height without a head bone");
  ok(/const pose = placeTorch\(eye, torchDir, camera\.up, head, hit, T, this\.torchPose\);/.test(step) && step.indexOf('if (!firstPerson)') < step.indexOf('placeTorch('), 'and that head is what the torch is placed from, after it is found');
  ok(/torch\.position\.set\(pose\.source\.x, pose\.source\.y, pose\.source\.z\);/.test(step) && /torch\.target\.position\.set\(pose\.target\.x, pose\.target\.y, pose\.target\.z\);/.test(step), 'and the light stands and points where the pose says');
  const lights = readFileSync(new URL('../../../src/combat/bladeLights.ts', import.meta.url), 'utf8');
  ok(lights.includes('t.position.distanceTo(mid)'), "the blades' light ceiling measures the torch from where it is carried, not from the camera");

  // The layers: marked once, where the light is made and put in the scene, and never in a frame.
  ok(/this\.scene\.add\(this\.torch, this\.torch\.target\);\s*markActor\(this\.torch\);/.test(main), 'the torch is marked an actor as it is put in the scene, so the rooms pass lights with it');
  ok((main.match(/markActor\(this\.torch\)/g) ?? []).length === 1, 'and only there: its layers are part of every room program\'s key and change once');
  ok(!/layers/.test(step), 'the frame\'s step never touches its layers, which would rebuild every room program on a live frame');
  const ctor = /constructor\(private readonly physics: Physics\) \{[\s\S]*?markActor\(this\.torch\);/.exec(main)?.[0] ?? '';
  ok(ctor.length > 0 && !/\.compile(Async|All|AllAsync|Ready|Everything)?\(/.test(ctor), 'and nothing is compiled before it is marked, so no program is ever built without the spot in its key');
}

// ---------------------------------------------------------------------------------------------
// The layers against the portal renderer's own cameras, set as `renderLayer` sets them.
{
  // The two places a pass's camera is given its layers: the portal renderer's draw, and the world's compile
  // behind the loading screen. Both must see the actor layer, or the torch drops out of that pass's light
  // set -- in the draw it lights nothing there, in the compile every room program is built without its spot
  // and built again on the first live frame. Neither file's class can be made here (one wants a WebGL
  // renderer, the other is the world), so their bodies are pinned, and `passCamera` below is the mirror.
  const portal = readFileSync(new URL('../../../src/world/portalRender.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const renderLayer = /private renderLayer\(scene: THREE\.Scene, camera: THREE\.Camera, layer: number\): void \{([\s\S]*?)\n {2}\}/.exec(portal)?.[1] ?? '';
  ok(/^\s*camera\.layers\.set\(layer\);\s*camera\.layers\.enable\(ACTOR_LAYER\);/.test(renderLayer), "the portal renderer's passes each see their own layer and the actor layer, whichever pass it is");
  const worldSrc = readFileSync(new URL('../../../src/world/world.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const withLayers = /private withLayers<T>\(camera: THREE\.Camera, layer: number, fn: \(\) => T\): T \{([\s\S]*?)\n {2}\}/.exec(worldSrc)?.[1] ?? '';
  ok(/camera\.layers\.set\(layer\);\s*camera\.layers\.enable\(ACTOR_LAYER\);\s*try \{\s*return fn\(\);/.test(withLayers), "and so does the warm-up's compile camera, so every room program is built with the spot in its key behind the loading screen");
  const mainSrc = readFileSync(new URL('../../../src/main.ts', import.meta.url), 'utf8');
  ok(!/torch\.castShadow\s*=/.test(mainSrc), "the game's torch is never made to cast, so the shadow pass's light set is what it was");
  const passCamera = (layer: number) => {
    const c = new THREE.PerspectiveCamera();
    c.layers.set(layer);
    c.layers.enable(ACTOR_LAYER);
    return c;
  };
  const worldCamera = passCamera(0);
  const roomsCamera = passCamera(INTERIOR_LAYER);
  const bare = new THREE.SpotLight(0xffffff, 1);
  ok(bare.layers.test(worldCamera.layers) && !bare.layers.test(roomsCamera.layers), 'a spot light left on layer 0 is seen by the world pass and not by the rooms pass (the fault)');
  ok(passesSeeing(bare.layers.mask) === 'world only', 'and the console says so');
  const torch = new THREE.SpotLight(0xffffff, 1);
  markActor(torch);
  ok(torch.layers.test(worldCamera.layers) && torch.layers.test(roomsCamera.layers), 'marked an actor, both passes see it, so both light with it');
  ok(passesSeeing(torch.layers.mask) === 'world and rooms', "and the console's answer is read off the light's own mask");
  ok(torch.layers.isEnabled(0), 'it stays on layer 0 as well, so nothing about the world pass changes');
}

console.log(`\n${passed} checks passed`);
