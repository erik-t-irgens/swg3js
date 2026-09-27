// The shuttles that land at the starports and the shuttleports, drawn with the game's own rigs.
//
// A shuttle is a skeleton and its clips -- coming down, going up, parked on the ground and parked in
// the sky -- with its hull hung on its joints: one piece on the shuttle's root, five on the transport's
// (the hull, three landing struts and the door), so its struts fold and its door opens as the clip
// says. `tools/swg/travel.mjs` says where each comes from.
//
// Nothing here keeps time. Where a shuttle is in its round is `shuttleAt`, off the clock every browser
// shares with the port's own name, and which clip that is and where in it is `rigPose`; this file only
// puts that pose on the joints, so two players at one starport watch one shuttle land at one instant,
// and the collector's words and what is drawn on the pad can never disagree.
//
// A rig is prepared (its materials joined and its programs compiled) before it is ever shown, drawn as
// an actor like anything else that moves, and while it stands waiting on its pad it is solid: the
// shuttle it replaced was a placed prop you could not walk through, and a parked hull you could would
// be the first thing anybody noticed. Every number of ours is `SHUTTLE_RIG_TUNE`, live through
// `__debug.terminal({ rigs: ... })`.
//
// And it is heard and seen working, from the game's own data and nothing of ours but the scales: its
// idle loop while it is there, and at the moments its own clips mark (`travelTerminal.ts`, `RigMark`)
// the sounds, the engine flames, the smoke on the pad and the shake its client data names. A sound is
// an event, started on the frame its mark is crossed; a flame is a state, lit for as long as its mark's
// window is open in the clip playing now, so whoever looks sees the same flames whenever they looked.
// The effects are the session's own `ParticleEffects`, handed in (`ShuttleRigDeps.fx`) rather than made
// here, which is also what lets a node test stand one in.
//
// A shuttle can also be held off its pad (`hold`), for a hull flown from the same rig to stand in its
// place (`src/vehicles/rigHull.ts`). A hold is counted and outlives `clear`, and neither taking a rig
// away nor giving it back ever happens in front of anybody: softly, it goes the first frame it is away
// or out of sight, and comes back the first frame it is away or parked out of sight.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { cleanTrimesh, Group, groups, RAPIER as R, TRIMESH_FLAGS, type Physics } from '../core/physics.ts';
import { OUTSIDE, type SoundSpace } from '../audio/distance.ts';
import type { EffectHandle } from './particles.ts';
import { poseRigAction, type Pad } from './rigPath.ts';
import { surfaces } from './surfaces.ts';
import { markFires, rigPose, shuttleShake, windowOpen, type RigClips, type RigPose, type ShuttleState, type ShuttleTimes, type TravelRig } from './travelTerminal.ts';

/** Every number of ours about the drawn shuttles. */
export const SHUTTLE_RIG_TUNE = {
  /** Metres from the camera to a shuttle's pad within which it is posed and drawn at all. */
  reach: 9000,
  /** Whether a parked shuttle is solid. */
  solid: true,
  /** Whether the shuttles make their sounds, show their flames and shake the view at all. */
  effects: true,
  /** Metres from the camera within which a shuttle's flames are lit and its one-shot sounds start. */
  near: 2000,
  /**
   * How much further off than the files say a shuttle's flames and smoke are still drawn: every emitter
   * of the game's thins from 20 m and is gone at 200, and a transport lights its engines 360 m up, so
   * with the files' own distances nobody on the pad would see them. Ten times is `near` again.
   */
  fxReach: 10,
  /**
   * Seconds after its mark a one-shot may still start: met later than this -- a shuttle come into
   * view part way through its landing, a frame that stalled -- it is let go rather than played late.
   */
  late: 0.5,
  /**
   * What the client effect's shake amount is multiplied by to make the view's own 0-to-1 shake: the
   * files write 0.02, and at this scale that is half the view's shake with the camera on the pad.
   */
  shake: 25,
  /**
   * Seconds between asks of which room an indoor shuttle's sounds are in (Theed's hangar), while it is
   * shown and moving: its approach comes in through the hangar's doorway and its lift-off leaves by it.
   */
  spaceEvery: 0.25,
  /** Metres its hull must have moved since the last such ask before it is asked again; a parked hull asks nothing. */
  spaceMove: 1,
  /**
   * Metres past which a held shuttle counts as out of sight whatever the view: a 43 m hull is about a
   * degree across there, and a hold waiting for it to be unseen would otherwise wait on a speck.
   */
  seenFar: 2500,
  /** Metres within which a held shuttle counts as seen whatever the view: about one and a half transports. */
  releaseNear: 60,
};

/** The session's particle effects, as much of them as the shuttles use (`ParticleEffects`). */
export interface ShuttleFx {
  prepare(file: string, renderer?: THREE.WebGLRenderer | null): Promise<boolean>;
  place(file: string, matrix: THREE.Matrix4, contained: boolean, transient?: boolean, frame?: THREE.Matrix4 | null, solid?: boolean, options?: { sound?: boolean; reach?: number }): EffectHandle;
  move(handle: EffectHandle, matrix: THREE.Matrix4): void;
  remove(handle: EffectHandle): void;
  /** Live particles of one placed effect: 0 while it is loading or asleep, and once what it made has died away. */
  particlesOf(handle: EffectHandle): number;
  update(dt: number, camera: THREE.Camera, fog: THREE.FogExp2 | null): void;
}

/** Where a sound plays, and the room it plays in; the mixer's own options, as much as is used here. */
export interface ShuttleSoundAt {
  x?: number;
  y?: number;
  z?: number;
  space?: SoundSpace;
}

/** The mixer, as much of it as the shuttles use (`AudioSystem`). */
export interface ShuttleAudio {
  /** Ask the bank for what these will need, ahead of the moment they are played. Never awaited. */
  prepare(ids: Iterable<string>): void;
  play(id: string, options?: ShuttleSoundAt): number;
  loop(id: string, options?: ShuttleSoundAt): number;
  move(key: number, x: number, y: number, z: number): void;
  stop(key: number, fade?: number): void;
  setSpace(key: number, space: SoundSpace): void;
}

/** What a stood shuttle needs from the game: where it is in its round, now. */
export interface ShuttleClock {
  state(): ShuttleState;
  times: ShuttleTimes;
}

export interface ShuttleRigDeps {
  scene: THREE.Scene;
  physics: Physics;
  /** The root of the packs, with its trailing slash. */
  base: string;
  /** Materials joined and programs compiled before it is shown (`World.prepareActor`). */
  prepare(root: THREE.Object3D): Promise<void>;
  /** Out of the portal renderer's set and the cascades' map, before a material is disposed. */
  forget(materials: Iterable<THREE.Material>): void;
  /**
   * The session's particle effects the flames and the smoke play in, updated from `update`; left out,
   * nothing is lit. The world's own scan joins their batches to the portal renderer and compiles them,
   * as it does the ships' and the weapons' effects, since they are made in the same scene.
   */
  fx?: ShuttleFx | null;
  /** What the effects' textures are uploaded with ahead of their first quad; null in a test. */
  renderer?: THREE.WebGLRenderer | null;
  /** The mixer; left out, the shuttles are silent. */
  audio?: ShuttleAudio | null;
  /**
   * The sound space of the room a point stands in, or null out in the open (Theed's hangar is a room).
   * Asked a few times a second at most, and only for a shuttle indoors that is moving.
   */
  spaceAt?(x: number, y: number, z: number): SoundSpace | null;
  /** Shake the view this frame, 0 to 1 (`setViewShake`); the strongest ask of the frame wins. */
  shake?(amount: number): void;
}

/** A flame or a smoke a mark lights, while its window is open: its handle, or null while it is out. */
interface Lit {
  t: number;
  seconds: number;
  file: string;
  joint: THREE.Object3D;
  handle: EffectHandle | null;
}

/** The sounds a mark starts once. */
interface Shot {
  t: number;
  sounds: string[];
  joint: THREE.Object3D;
}

/** A shake a mark opens. */
interface Shake {
  t: number;
  shake: number[];
  joint: THREE.Object3D;
}

/** What one clip of a stood shuttle does and when, bound to that shuttle's own joints. */
interface ClipFx {
  lit: Lit[];
  shots: Shot[];
  shakes: Shake[];
}

/** How many one-shots a shuttle keeps moving with their joints at once; the oldest is let go past it. */
const VOICES_KEPT = 8;

/** A rig as loaded: its joints, its clips, and each piece's model with the joint it rides. */
interface RigAsset {
  joints: THREE.Object3D;
  clips: Map<string, THREE.AnimationClip>;
  parts: { joint: string; model: THREE.Object3D }[];
  /** Everything it owns, for when the world goes. */
  materials: Set<THREE.Material>;
  geometries: Set<THREE.BufferGeometry>;
}

interface Stood {
  key: string;
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Partial<Record<RigPose['role'], THREE.AnimationAction>>;
  current: THREE.AnimationAction | null;
  clock: ShuttleClock;
  inside: boolean;
  shown: boolean;
  /** The pad it stands on, the rig it is drawn with and the branch of its clips, for whatever flies a hull in its place. */
  at: Pad;
  rig: TravelRig;
  mood: string;
  /** Metres: half the diagonal of its biggest piece, the sphere a hold asks the view about. */
  radius: number;
  /** The hull as it stands parked, in the world, once worked out; and its collider while parked. */
  hull: { vertices: Float32Array; indices: Uint32Array } | null;
  collider: R.Collider | null;
  role: RigPose['role'];
  /** What its landing and its lift-off do and when, bound to its own joints; empty for a pack from before. */
  fx: Partial<Record<RigPose['role'], ClipFx>>;
  /** The joints any of that happens at, whose world matrices are brought up to date before it is read. */
  fxJoints: THREE.Object3D[];
  /** The role whose clip `fxAt` was read in, or null while it was shown in none. */
  fxRole: RigPose['role'] | null;
  /** Last frame's seconds in that clip: a one-shot fires on the frame its mark is crossed. */
  fxAt: number;
  /** The joint the idle loop follows and the view's distance is measured from. */
  body: THREE.Object3D;
  /** The idle loop its client data names, its voice while it plays (0 while it does not), and whether it was asked for this showing. */
  ambient: string | null;
  loop: number;
  idleAsked: boolean;
  /** Every sound its client data can play, asked of the bank at `stand` and again as each clip begins. */
  sounds: string[];
  /** The one-shots started, moved with their joints while it is shown. */
  voices: { key: number; joint: THREE.Object3D }[];
  /**
   * Flames put out and still dying away, moved with their joints while it is shown, and taken out of
   * the effects once what they made is gone (or on `clear`), since a standing effect never ends by itself.
   */
  dying: { handle: EffectHandle; joint: THREE.Object3D }[];
  /**
   * The room an indoor shuttle's sounds are in, where its hull is now: this record is the shuttle's own,
   * written in place, and the loop and every sound it started are pointed at it when it changes. Out in
   * the open it stays outside and is never handed to the mixer.
   */
  space: SoundSpace;
  /** Where the hull was when the room was last asked for, and the seconds until it may be asked again. */
  spaceFrom: THREE.Vector3;
  spaceClock: number;
}

const tmpPose: RigPose = { role: 'sky', seconds: 0, shown: false };
const tmpV = new THREE.Vector3();
const tmpCam = new THREE.Vector3();
const tmpJoint = new THREE.Vector3();
/** Scratch for whether a held shuttle would be seen: the view's frustum (made at most once an update) and the sphere tested against it. */
const viewMatrix = new THREE.Matrix4();
const viewFrustum = new THREE.Frustum();
const seenSphere = new THREE.Sphere();

/** Where a hold on a shuttle stands: on its way out of sight, out of sight, or on its way back. */
export type HoldState = 'hiding' | 'hidden' | 'releasing';

export class ShuttleRigs {
  private readonly deps: ShuttleRigDeps;
  private readonly assets = new Map<string, Promise<RigAsset | null>>();
  private readonly stood: Stood[] = [];
  /** The same, by key. */
  private readonly byKey = new Map<string, Stood>();
  /** The holds on shuttles by key, counted, and kept through `clear` (a key need not be stood to be held). */
  private readonly holds = new Map<string, { count: number; state: HoldState }>();
  /** Whether `viewFrustum` is this update's camera's, so it is worked out once an update and only when a hold asks. */
  private frustumReady = false;
  private readonly loader = surfaces.withPlugin(new GLTFLoader());
  /** Why the last rig that would not stand would not, for the console. */
  note = '';
  /** Moved on by every `clear`, so a stand begun for a world that has gone is dropped. */
  private generation = 0;
  /** The particle files already prepared this session, so each is prepared once however many shuttles use it. */
  private readonly preparedFx = new Map<string, Promise<boolean>>();

  constructor(deps: ShuttleRigDeps) {
    this.deps = deps;
  }

  /** How many are stood, and each one's pose and what it is doing, for the console. */
  describe(): { stood: number; note: string; shuttles: { key: string; role: string; shown: boolean; held: HoldState | null; solid: boolean; inside: boolean; room: string | null; lit: number; dying: number; idling: boolean; marks: number }[] } {
    return {
      stood: this.stood.length,
      note: this.note,
      shuttles: this.stood.map((s) => ({
        key: s.key,
        role: s.role,
        shown: s.shown,
        // Whether something holds it off its pad, and how far that has got.
        held: this.holdState(s.key),
        solid: !!s.collider,
        inside: s.inside,
        // Which room its sounds are in just now, for a shuttle indoors: "building/cell", or outside.
        room: s.inside ? (s.space.building === OUTSIDE.building ? 'outside' : `${s.space.building}/${s.space.cell}`) : null,
        lit: (s.fxRole ? s.fx[s.fxRole]?.lit ?? [] : []).filter((l) => l.handle).length,
        dying: s.dying.length,
        idling: s.loop !== 0,
        marks: Object.values(s.fx).reduce((n, c) => n + (c ? c.lit.length + c.shots.length + c.shakes.length : 0), 0),
      })),
    };
  }

  /** Every stood shuttle's root, for the motion blur: the root stays on its pad and the joints move. */
  roots(out: THREE.Object3D[]): THREE.Object3D[] {
    out.length = 0;
    for (const s of this.stood) if (s.shown) out.push(s.root);
    return out;
  }

  private load(rig: TravelRig): Promise<RigAsset | null> {
    let p = this.assets.get(rig.file);
    if (!p) {
      p = this.fetchRig(rig).catch((err) => {
        this.note = `the rig ${rig.file} would not load: ${err instanceof Error ? err.message : String(err)}`;
        console.warn(this.note);
        return null;
      });
      this.assets.set(rig.file, p);
    }
    return p;
  }

  private async fetchRig(rig: TravelRig): Promise<RigAsset> {
    const base = this.deps.base;
    const skeleton = await this.loader.loadAsync(base + rig.file);
    const parts: RigAsset['parts'] = [];
    const materials = new Set<THREE.Material>();
    const geometries = new Set<THREE.BufferGeometry>();
    for (const p of rig.parts) {
      const gltf = await this.loader.loadAsync(base + p.file);
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        geometries.add(m.geometry);
        for (const mat of Array.isArray(m.material) ? m.material : [m.material]) materials.add(mat);
      });
      parts.push({ joint: p.joint, model: gltf.scene });
    }
    return { joints: skeleton.scene, clips: new Map(skeleton.animations.map((a) => [a.name, a])), parts, materials, geometries };
  }

  /**
   * Stand one shuttle on its pad: the rig's joints cloned, its pieces hung on them, prepared out of
   * sight, and then posed every frame from `clock`. False when the rig will not load or has none of
   * the clips its branch names.
   */
  async stand(key: string, rig: TravelRig, mood: string, at: { x: number; y: number; z: number; yaw: number }, inside: boolean, clock: ShuttleClock): Promise<boolean> {
    // A world can go while this waits on a load or a compile: what was begun for it is then dropped
    // rather than stood in the next one.
    const generation = this.generation;
    const asset = await this.load(rig);
    if (!asset || generation !== this.generation) return false;
    const clips: RigClips | undefined = rig.moods[mood] ?? Object.values(rig.moods)[0];
    if (!clips) {
      this.note = `the rig ${rig.file} has no clips for ${mood || 'its only branch'}`;
      return false;
    }
    const root = new THREE.Group();
    root.name = `shuttle:${key}`;
    root.position.set(at.x, at.y, at.z);
    root.rotation.y = at.yaw;
    const joints = asset.joints.clone(true);
    root.add(joints);
    for (const p of asset.parts) {
      const joint = joints.getObjectByName(p.joint);
      if (!joint) {
        this.note = `the rig ${rig.file} has no joint ${p.joint}`;
        continue;
      }
      joint.add(p.model.clone(true));
    }
    root.visible = false;
    this.deps.scene.add(root);
    root.updateMatrixWorld(true);
    await this.deps.prepare(root);
    if (generation !== this.generation) {
      this.deps.scene.remove(root);
      return false;
    }
    // Culled piece by piece, since a piece is a still model whose own box is right; prepareActor
    // turns that off for the skinned actors it was written for. And glass casts no shadow, which
    // prepareActor also has every mesh do: the garage leaves a hull's glass casting none, and a hull
    // flown from this rig in its place must throw the same shadow it does.
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.frustumCulled = true;
      if (castsNoShadow(m)) m.castShadow = false;
    });
    const mixer = new THREE.AnimationMixer(joints);
    const actions: Stood['actions'] = {};
    for (const role of ['land', 'lift', 'ground', 'sky'] as const) {
      const name = clips[role];
      const clip = name ? asset.clips.get(name) : undefined;
      if (!clip) continue;
      const a = mixer.clipAction(clip);
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      actions[role] = a;
    }
    if (!actions.land || !actions.lift) {
      this.deps.scene.remove(root);
      this.note = `the rig ${rig.file} has no ${actions.land ? 'lift-off' : 'landing'} clip`;
      return false;
    }
    // What its clips mark, bound to this shuttle's own joints, and its effects made ready before it is
    // ever shown: loaded, their batches made (hidden, so the world's scan compiles them) and their
    // textures uploaded, so the first flame does not wait on any of it.
    const bound = this.bindFx(rig, clips, joints);
    if (bound.files.length && this.deps.fx) {
      await this.prepareFx(bound.files);
      if (generation !== this.generation) {
        this.deps.scene.remove(root);
        return false;
      }
    }
    // Its sounds asked for now as well: the mixer drops a one-shot whose samples have not arrived
    // within a tenth of a second or so of being played, and a take-off's are hundreds of kilobytes,
    // so asked for only when its mark came round the first landing anybody watched would be silent.
    const sounds = soundsOf(rig);
    if (sounds.length) this.deps.audio?.prepare(sounds);
    const s: Stood = {
      key,
      root,
      mixer,
      actions,
      current: null,
      clock,
      inside,
      shown: false,
      at: { x: at.x, y: at.y, z: at.z, yaw: at.yaw },
      rig,
      mood,
      radius: radiusOf(rig),
      hull: null,
      collider: null,
      role: 'sky',
      fx: bound.fx,
      fxJoints: bound.joints,
      fxRole: null,
      fxAt: -Infinity,
      body: joints.getObjectByName('root') ?? joints,
      ambient: rig.ambient ?? null,
      loop: 0,
      idleAsked: false,
      sounds,
      voices: [],
      dying: [],
      space: { building: OUTSIDE.building, cell: OUTSIDE.cell },
      spaceFrom: new THREE.Vector3(Infinity, Infinity, Infinity),
      spaceClock: 0,
    };
    this.stood.push(s);
    this.byKey.set(key, s);
    // Held before it stood (a hull crossed into this world in its place): it starts out of the picture.
    const h = this.holds.get(key);
    if (h?.state === 'hiding') h.state = 'hidden';
    return true;
  }

  /**
   * A rig's marks for one shuttle: each landing and lift-off mark turned into what it does -- the
   * sounds it starts, the effects it lights and for how long, the shake it opens -- at the joint it
   * names on this shuttle's own clone. A mark whose event or joint is not there does nothing, and a
   * pack from before the marks binds nothing at all.
   */
  private bindFx(rig: TravelRig, clips: RigClips, joints: THREE.Object3D): { fx: Stood['fx']; joints: THREE.Object3D[]; files: string[] } {
    const fx: Stood['fx'] = {};
    const used = new Set<THREE.Object3D>();
    const files = new Set<string>();
    const events = rig.events ?? {};
    for (const role of ['land', 'lift'] as const) {
      const name = clips[role];
      const marks = name ? rig.marks?.[name] : undefined;
      if (!marks?.length) continue;
      const c: ClipFx = { lit: [], shots: [], shakes: [] };
      for (const m of marks) {
        const ev = events[m.event];
        const joint = joints.getObjectByName(m.joint);
        if (!ev || !joint) continue;
        if (ev.sounds?.length) c.shots.push({ t: m.t, sounds: ev.sounds, joint });
        for (const p of ev.particles ?? []) {
          if (!p.file || !(p.seconds > 0)) continue;
          c.lit.push({ t: m.t, seconds: p.seconds, file: p.file, joint, handle: null });
          files.add(p.file);
        }
        if (ev.shake && ev.shake.length >= 4) c.shakes.push({ t: m.t, shake: ev.shake, joint });
        used.add(joint);
      }
      fx[role] = c;
    }
    return { fx, joints: [...used], files: [...files] };
  }

  /** Each particle file prepared once for the session, however many shuttles use it. */
  private prepareFx(files: string[]): Promise<unknown> {
    const fx = this.deps.fx;
    if (!fx) return Promise.resolve();
    const waits: Promise<boolean>[] = [];
    for (const f of files) {
      let p = this.preparedFx.get(f);
      if (!p) {
        p = fx.prepare(f, this.deps.renderer ?? null).catch(() => false);
        this.preparedFx.set(f, p);
      }
      waits.push(p);
    }
    return Promise.all(waits);
  }

  /**
   * Put every shuttle near the camera where its round says it is, with its sounds, flames and shake
   * where its clips say, and step the effects those are played in.
   */
  update(dt: number, camera: THREE.Camera, fog: THREE.FogExp2 | null = null): void {
    const reach = SHUTTLE_RIG_TUNE.reach;
    camera.updateMatrixWorld();
    tmpCam.setFromMatrixPosition(camera.matrixWorld);
    this.frustumReady = false;
    for (const s of this.stood) {
      const pose = rigPose(s.clock.state(), s.clock.times, tmpPose);
      const near = s.root.position.distanceToSquared(tmpCam) < reach * reach;
      const want = pose.shown && near;
      const held = this.holds.size > 0 && this.heldNow(s, pose, want, camera);
      s.role = pose.role;
      s.shown = want && !held;
      s.root.visible = s.shown;
      if (s.shown) this.pose(s, pose);
      this.solid(s, s.shown && pose.role === 'ground' && SHUTTLE_RIG_TUNE.solid);
      this.effects(s, pose, dt);
    }
    this.deps.fx?.update(dt, camera, fog);
  }

  // ---------------------------------------------------------------- holds

  /**
   * Hold a shuttle off its pad, for a hull flown from the same rig to stand in its place. Holds are
   * counted (two holders and one letting go keep it held) and outlive `clear`, since a world going and
   * a world coming back is exactly what a hull crossing between them does. Softly, the rig goes the
   * first frame its round has it away or nobody could see it; `now` takes it out of the picture and its
   * collider out of the physics in this same call, for a hull put in its place in the same step, since
   * the rigs are updated after the physics has stepped and two hulls on one pad for one step collide.
   * A key not stood yet is held all the same, and starts out of the picture when it stands.
   */
  hold(key: string, now = false): void {
    let h = this.holds.get(key);
    if (!h) {
      h = { count: 0, state: 'hiding' };
      this.holds.set(key, h);
    }
    h.count++;
    if (h.state === 'releasing') h.state = 'hidden';
    if (!now) return;
    h.state = 'hidden';
    const s = this.byKey.get(key);
    if (!s) return;
    s.shown = false;
    s.root.visible = false;
    this.solid(s, false);
  }

  /**
   * Let go of one hold on a shuttle. The last one let go of softly gives the rig back only the first
   * frame its round has it away or parked where nobody sees it, so it never pops into view; `now`
   * puts it back at once where its round has it, drawn and solid, for a hull taken away in the same
   * step from exactly where the rig parks.
   */
  release(key: string, now = false): void {
    const h = this.holds.get(key);
    if (!h) return;
    h.count = Math.max(0, h.count - 1);
    if (h.count > 0) return;
    // Never taken out of the picture yet: nothing to give back.
    if (now || h.state === 'hiding') {
      this.holds.delete(key);
      const s = this.byKey.get(key);
      if (s && now) this.placeNow(s);
      return;
    }
    h.state = 'releasing';
  }

  /** Where the hold on a shuttle stands, or null when nothing holds it. */
  holdState(key: string): HoldState | null {
    return this.holds.get(key)?.state ?? null;
  }

  /** Every hold let go of at once, for a session going back to the select screen: the next update draws each rig where its round has it. */
  clearHolds(): void {
    this.holds.clear();
  }

  /** The key of the stood shuttle whose pad is nearest a point, or null with none stood. */
  nearest(at: { x: number; y: number; z: number }): string | null {
    let best: Stood | null = null;
    let bestD = Infinity;
    for (const s of this.stood) {
      const d = (s.at.x - at.x) ** 2 + (s.at.y - at.y) ** 2 + (s.at.z - at.z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best ? best.key : null;
  }

  /**
   * A stood shuttle's pad and what it is drawn with, for whatever flies a hull in its place: where it
   * stands, whether indoors, its clock, its rig and branch, and the joint its body is measured from.
   */
  padOf(key: string): { at: Pad; inside: boolean; clock: ShuttleClock; rig: TravelRig; mood: string; body: THREE.Object3D } | null {
    const s = this.byKey.get(key);
    return s ? { at: s.at, inside: s.inside, clock: s.clock, rig: s.rig, mood: s.mood, body: s.body } : null;
  }

  /**
   * One of a stood shuttle's joints in the world, with the rig posed at a role's clip at `seconds`: the
   * console's witness that a hull flown in its place stands where the rig does. It poses the rig,
   * shown or not; the next update poses a shown one where its round has it again. False with no such
   * shuttle or joint.
   */
  jointOf(key: string, name: string, role: RigPose['role'], seconds: number, outPos: THREE.Vector3, outQuat: THREE.Quaternion): boolean {
    const s = this.byKey.get(key);
    const joint = s?.root.getObjectByName(name);
    if (!s || !joint) return false;
    poseRigAction(s, role, seconds);
    joint.updateWorldMatrix(true, false);
    joint.matrixWorld.decompose(outPos, outQuat, tmpV);
    return true;
  }

  /**
   * Whether a held shuttle stays out of the picture this frame, moving its hold on as it goes: one
   * held softly goes the first frame it is away or out of sight ('hiding' to 'hidden'), and one let go
   * of softly comes back the first frame it is away or parked out of sight ('releasing', then gone).
   */
  private heldNow(s: Stood, pose: RigPose, want: boolean, camera: THREE.Camera): boolean {
    const h = this.holds.get(s.key);
    if (!h) return false;
    if (h.state === 'hiding') {
      if (want && this.seen(s, pose, camera)) return false;
      h.state = 'hidden';
      return true;
    }
    if (h.state === 'releasing') {
      if (want && !(pose.role === 'ground' && !this.seen(s, pose, camera))) return true;
      this.holds.delete(s.key);
      return false;
    }
    return true;
  }

  /**
   * Whether somebody would see a shuttle if it were drawn: posed where its round has it (a paused
   * action and a mixer update, which is cheap), its body joint tested as a sphere the size of its
   * biggest piece against the view. Nearer than `releaseNear` it is seen whichever way the camera
   * faces, and past `seenFar` it is a speck that nobody sees. Nothing is allocated.
   */
  private seen(s: Stood, pose: RigPose, camera: THREE.Camera): boolean {
    this.pose(s, pose);
    s.body.updateWorldMatrix(true, false);
    tmpJoint.setFromMatrixPosition(s.body.matrixWorld);
    const d = tmpJoint.distanceTo(tmpCam);
    if (d < SHUTTLE_RIG_TUNE.releaseNear) return true;
    if (d >= SHUTTLE_RIG_TUNE.seenFar) return false;
    if (!this.frustumReady) {
      viewFrustum.setFromProjectionMatrix(viewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      this.frustumReady = true;
    }
    seenSphere.center.copy(tmpJoint);
    seenSphere.radius = s.radius;
    return viewFrustum.intersectsSphere(seenSphere);
  }

  /** One shuttle put where its round has it, drawn and solid as the last update would have left it, between updates. */
  private placeNow(s: Stood): void {
    const reach = SHUTTLE_RIG_TUNE.reach;
    const pose = rigPose(s.clock.state(), s.clock.times, tmpPose);
    s.role = pose.role;
    s.shown = pose.shown && s.root.position.distanceToSquared(tmpCam) < reach * reach;
    s.root.visible = s.shown;
    if (s.shown) this.pose(s, pose);
    this.solid(s, s.shown && pose.role === 'ground' && SHUTTLE_RIG_TUNE.solid);
  }

  /**
   * One shuttle's sounds, flames and shake for this frame, after it has been posed.
   *
   * The idle loop plays for as long as it is shown and follows its hull. A one-shot starts on the frame
   * its mark is crossed (`markFires`), a role just begun counting as coming from -Infinity so a mark
   * on its first instant is not lost, and follows its joint while it plays. A flame is lit for exactly
   * as long as its window is open in the clip playing now (`windowOpen`), placed at its joint in the
   * world with no frame and moved with it every frame, and put out -- told to make no more, so what it
   * made dies away where it is -- when the window closes, the role changes or the shuttle is not shown.
   *
   * A flame is placed as a standing effect and not a passing one. `ParticleEffects` ends a passing
   * effect whose emitters never run out once it is two of its particles' lives and a second and a half
   * old, and drops every particle it has at once: the transport's engines went out 6.5 s into their 15
   * and the pad's smoke 3.5 s into its 5. A standing effect plays its own timing for as long as it is
   * placed, so its window is what ends it. What that costs is that the effects run a standing effect
   * ahead by its particles' longest life the first time it wakes (2.5 s for the engines, 1 s for the
   * smoke), so a flame is a whole flame on its first frame -- which is also what makes it the same
   * flame for somebody who comes into view part way through its window -- and that nothing takes one
   * away but its owner, which `sweepDying` does once what it made has died away.
   */
  private effects(s: Stood, pose: RigPose, dt: number): void {
    const on = s.shown && SHUTTLE_RIG_TUNE.effects;
    const role = on ? pose.role : null;
    const audio = this.deps.audio ?? null;
    const changed = role !== s.fxRole;
    if (changed) {
      this.putOut(s);
      s.fxRole = role;
      s.fxAt = -Infinity;
    }
    if (!on) {
      this.stopLoop(s);
      this.sweepDying(s, false);
      return;
    }
    for (const j of s.fxJoints) j.updateWorldMatrix(true, false);
    s.body.updateWorldMatrix(true, false);
    tmpJoint.setFromMatrixPosition(s.body.matrixWorld);
    // Asked again on each change of role -- a building that has streamed out and back is a new room --
    // and as the hull moves, so the approach and the lift-off are heard where they are flown.
    this.trackSpace(s, dt, changed);
    // A clip begun: its sounds asked for again, since the bank gives back what nothing has played for
    // a while and a round is many minutes long. What is already in costs a lookup apiece.
    if (changed && audio && s.sounds.length) audio.prepare(s.sounds);
    const space = s.inside ? s.space : undefined;
    if (audio && s.ambient) {
      // Asked for once a showing: a mixer with no such sound answers 0, and asking again every frame
      // would be a refusal a frame for as long as it stands there.
      if (!s.idleAsked) {
        s.idleAsked = true;
        s.loop = audio.loop(s.ambient, { x: tmpJoint.x, y: tmpJoint.y, z: tmpJoint.z, space });
      } else if (s.loop) audio.move(s.loop, tmpJoint.x, tmpJoint.y, tmpJoint.z);
    }
    const near = tmpJoint.distanceTo(tmpCam) <= SHUTTLE_RIG_TUNE.near;
    const c = role ? s.fx[role] : undefined;
    const now = pose.seconds;
    if (c) {
      if (near && audio) {
        for (const shot of c.shots) {
          if (!markFires(shot.t, s.fxAt, now, SHUTTLE_RIG_TUNE.late)) continue;
          tmpJoint.setFromMatrixPosition(shot.joint.matrixWorld);
          for (const id of shot.sounds) {
            const key = audio.play(id, { x: tmpJoint.x, y: tmpJoint.y, z: tmpJoint.z, space });
            if (!key) continue;
            s.voices.push({ key, joint: shot.joint });
            if (s.voices.length > VOICES_KEPT) s.voices.shift();
          }
        }
      }
      const fx = this.deps.fx;
      if (fx) {
        for (const l of c.lit) {
          if (near && windowOpen(l.t, l.seconds, now)) {
            if (!l.handle) l.handle = fx.place(l.file, l.joint.matrixWorld, s.inside, false, null, false, { reach: SHUTTLE_RIG_TUNE.fxReach });
            else fx.move(l.handle, l.joint.matrixWorld);
          } else if (l.handle) this.out(s, l);
        }
      }
      const shake = this.deps.shake;
      if (shake) {
        for (const k of c.shakes) {
          tmpJoint.setFromMatrixPosition(k.joint.matrixWorld);
          const amount = shuttleShake(k.shake, k.t, now, tmpJoint.distanceTo(tmpCam), SHUTTLE_RIG_TUNE.shake);
          if (amount > 0) shake(amount);
        }
      }
    }
    s.fxAt = now;
    if (audio) {
      for (const v of s.voices) {
        tmpJoint.setFromMatrixPosition(v.joint.matrixWorld);
        audio.move(v.key, tmpJoint.x, tmpJoint.y, tmpJoint.z);
      }
    }
    this.sweepDying(s, true);
  }

  /**
   * Which room an indoor shuttle's sounds are in, asked where its hull is now (`tmpJoint`) rather than
   * at its pad: Theed's transport flies its approach in through the hangar's doorway from some seventy
   * metres out and leaves by it, and all of that is out in the open, heard muffled from the hangar and
   * dry from the street. Asked when `force` says so (a new clip) and otherwise at most every
   * `spaceEvery` seconds once the hull has moved `spaceMove` metres since the last ask, so a parked hull
   * asks nothing at all. The answer is copied into the shuttle's own record, and when it differs the
   * loop and every sound it started are pointed at that record.
   */
  private trackSpace(s: Stood, dt: number, force: boolean): void {
    const spaceAt = this.deps.spaceAt;
    if (!s.inside || !spaceAt) return;
    s.spaceClock -= dt;
    if (!force) {
      if (s.spaceClock > 0) return;
      const move = SHUTTLE_RIG_TUNE.spaceMove;
      if (tmpJoint.distanceToSquared(s.spaceFrom) < move * move) return;
    }
    s.spaceClock = SHUTTLE_RIG_TUNE.spaceEvery;
    s.spaceFrom.copy(tmpJoint);
    const found = spaceAt(tmpJoint.x, tmpJoint.y, tmpJoint.z);
    const building = found ? found.building : OUTSIDE.building;
    const cell = found ? found.cell : OUTSIDE.cell;
    if (building === s.space.building && cell === s.space.cell) return;
    s.space.building = building;
    s.space.cell = cell;
    const audio = this.deps.audio;
    if (!audio) return;
    if (s.loop) audio.setSpace(s.loop, s.space);
    for (const v of s.voices) audio.setSpace(v.key, s.space);
  }

  /** A flame's window has closed: it makes no more and what it made dies away, still riding its joint. */
  private out(s: Stood, l: Lit): void {
    if (!l.handle) return;
    l.handle.rateScale = 0;
    s.dying.push({ handle: l.handle, joint: l.joint });
    l.handle = null;
  }

  /** Every flame a shuttle has lit, put out. */
  private putOut(s: Stood): void {
    for (const c of Object.values(s.fx)) if (c) for (const l of c.lit) this.out(s, l);
  }

  /**
   * The flames still dying away: moved with their joints while it is shown, and taken out of the
   * effects the moment none of what they made is left. A standing effect never ends by itself, so this
   * is the only thing that takes one away; one still loading or asleep for distance has nothing left
   * to die away and goes at once.
   */
  private sweepDying(s: Stood, shown: boolean): void {
    const fx = this.deps.fx;
    if (!fx || !s.dying.length) return;
    for (let i = s.dying.length - 1; i >= 0; i--) {
      const d = s.dying[i];
      if (fx.particlesOf(d.handle) === 0) {
        fx.remove(d.handle);
        s.dying.splice(i, 1);
        continue;
      }
      if (shown) fx.move(d.handle, d.joint.matrixWorld);
    }
  }

  private stopLoop(s: Stood): void {
    s.idleAsked = false;
    if (!s.loop) return;
    this.deps.audio?.stop(s.loop);
    s.loop = 0;
  }

  /** A shuttle's joints where its clip for the role has them (`poseRigAction`, which a hull flown from the rig poses its limbs with too). */
  private pose(s: Stood, pose: RigPose): void {
    poseRigAction(s, pose.role, pose.seconds);
  }

  /** A parked shuttle's collider on or off: built the first time it is parked, from the hull as it stands. */
  private solid(s: Stood, want: boolean): void {
    if (!want) {
      if (s.collider) {
        this.deps.physics.removeCollider(s.collider);
        s.collider = null;
      }
      return;
    }
    if (s.collider) return;
    if (!s.hull) {
      s.root.updateMatrixWorld(true);
      s.hull = hullOf(s.root);
      if (!s.hull) return;
    }
    const desc = R.ColliderDesc.trimesh(s.hull.vertices, s.hull.indices, TRIMESH_FLAGS).setFriction(0.8);
    desc.setCollisionGroups(s.inside ? groups(Group.interior, Group.all) : groups(Group.all, Group.all));
    s.collider = this.deps.physics.world.createCollider(desc);
  }

  /**
   * Take every shuttle down and let go of the rigs: the world they stood in is going. Every effect a
   * shuttle placed goes with it, lit or still dying away, and every sound it started stops, the idle
   * loop first; the effects themselves are the session's and stay, prepared, for the next world. The
   * holds stay too: a hull that crosses into the next world still stands in its rig's place there.
   */
  clear(): void {
    this.generation++;
    const fx = this.deps.fx;
    const audio = this.deps.audio;
    for (const s of this.stood) {
      for (const c of Object.values(s.fx)) {
        if (!c) continue;
        for (const l of c.lit) {
          if (l.handle) fx?.remove(l.handle);
          l.handle = null;
        }
      }
      for (const d of s.dying) fx?.remove(d.handle);
      s.dying.length = 0;
      this.stopLoop(s);
      if (audio) for (const v of s.voices) audio.stop(v.key);
      s.voices.length = 0;
      this.solid(s, false);
      s.mixer.stopAllAction();
      s.mixer.uncacheRoot(s.root.children[0]);
      this.deps.scene.remove(s.root);
    }
    this.stood.length = 0;
    this.byKey.clear();
    const loads = [...this.assets.values()];
    this.assets.clear();
    for (const p of loads) {
      void p.then((a) => {
        if (!a) return;
        this.deps.forget(a.materials);
        for (const m of a.materials) m.dispose();
        for (const g of a.geometries) g.dispose();
      });
    }
  }
}

/** Whether a mesh casts no shadow, by the rule the garage keeps for a hull's own glass: glass, see-through, or marked so. */
function castsNoShadow(m: THREE.Mesh): boolean {
  const mats = Array.isArray(m.material) ? m.material : [m.material];
  return mats.some((mat) => mat.userData.glass || (mat.transparent && mat.opacity < 1) || mat.userData.noShadow);
}

/** Half the diagonal of a rig's biggest piece by the pack's bounds (whichever corner it wrote first), or 25 m with none. */
function radiusOf(rig: TravelRig): number {
  let r = 0;
  for (const p of rig.parts) {
    const b = p.bounds;
    if (!b || b.min.length < 3 || b.max.length < 3) continue;
    r = Math.max(r, Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2);
  }
  return r > 0 ? r : 25;
}

/** Every sound a rig's client data can play: its idle loop and each event's sounds, once apiece. */
function soundsOf(rig: TravelRig): string[] {
  const out = new Set<string>();
  if (rig.ambient) out.add(rig.ambient);
  for (const ev of Object.values(rig.events ?? {})) for (const id of ev.sounds ?? []) if (id) out.add(id);
  return [...out];
}

/** The hull's triangles in the world, from every mesh under a posed root; null when there are none. */
function hullOf(root: THREE.Object3D): { vertices: Float32Array; indices: Uint32Array } | null {
  const verts: number[] = [];
  const idx: number[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.getAttribute('position');
    if (!pos) return;
    const first = verts.length / 3;
    for (let i = 0; i < pos.count; i++) {
      tmpV.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      verts.push(tmpV.x, tmpV.y, tmpV.z);
    }
    const index = m.geometry.getIndex();
    if (index) for (let i = 0; i < index.count; i++) idx.push(first + index.getX(i));
    else for (let i = 0; i < pos.count; i++) idx.push(first + i);
  });
  if (!idx.length) return null;
  const clean = cleanTrimesh(new Float32Array(verts), new Uint32Array(idx));
  return clean ? { vertices: clean.vertices, indices: clean.indices } : null;
}
