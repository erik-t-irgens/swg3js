// The real streamer and the real physics, driven in node over packs made up on the spot: what a test of
// anything stood in a world in play builds on (`placedColliders.test.ts`, and the permanent layer's after it).
//
// Nothing in the graph `layoutStream.ts` reaches touches a page global when it loads, so nothing here stands
// one in. One module of it is served from a stub: the particle player carries a parameter property, which
// node's type stripping refuses, and the streamer takes exactly one thing from it, `mirroredTransform`, which
// only places an effect -- and these packs carry no effects at all.
import { register } from 'node:module';
import * as THREE from 'three';

const particlesStub = 'export function mirroredTransform(t, out) { return out; }';
const hook = `export async function resolve(s, c, next) {
  const r = await next(s, c);
  if (r.url.endsWith('/src/world/particles.ts')) return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(particlesStub)}), shortCircuit: true };
  return r;
}`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { Physics, Group, groups, RAPIER } = await import('../../../src/core/physics.ts');
const { LayoutStreamer } = await import('../../../src/world/layoutStream.ts');

export { Group, groups, THREE };
export type Streamer = InstanceType<typeof LayoutStreamer>;
export type World = InstanceType<typeof Physics>;

/** What the game's own indoor ray passes over (`World`'s walker filter): the terrain and every building's shell. */
export const INDOOR_FILTER = groups(Group.all, Group.all & ~(Group.terrain | Group.exterior));

/** A box `w` by `h` by `d`, its bottom at `y0` and its middle over the origin. */
export function boxGeo(w: number, h: number, d: number, y0: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, y0 + h / 2, 0);
  return g;
}

const mat = new THREE.MeshStandardMaterial();

/**
 * The house: 20 x 8 x 20 m, its origin on its ground line, its shell cell 0 and its room's floor (0.3 m thick)
 * cell 1, with a box reaching 16 m down for the cellar every real one has, so it files in tier 0 as they do.
 * One room box, so it is a building; no portals, so its room is drawn and made solid with the rest of it.
 */
export const HOUSE = { id: 'house', file: 'house.glb', bounds: { min: [-10, -16, -10], max: [10, 8, 10] }, triangles: 24 };
/** A crate a metre across (tier 2): what a terminal, a seat or a prop is in size. */
export const CRATE = { id: 'crate', file: 'crate.glb', bounds: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }, triangles: 12 };
/** The world's own rock, 26 m across and 30 m high (tier 0). */
export const ROCK = { id: 'rock', file: 'rock.glb', bounds: { min: [-13, 0, -13], max: [13, 30, 13] }, triangles: 12 };
/**
 * The house again, as a building that can host what is put down in it: its shell cell 0 and its one room cell 1
 * in the manifest, with a doorway in its +Z wall between the two, which is what furniture hosting reads (a model
 * with rooms and portals). The loaded model keeps no portals, so its room is drawn and made solid with the rest.
 */
export const HALL = {
  id: 'hall',
  file: 'hall.glb',
  bounds: { min: [-10, -16, -10], max: [10, 8, 10] },
  triangles: 24,
  cells: [
    { index: 0, name: 'r0', bounds: { min: [-10, -16, -10], max: [10, 8, 10] }, portals: [{ geometry: 0, target: 1, passable: true }] },
    { index: 1, name: 'r1', bounds: { min: [-9, 0, -9], max: [9, 7.5, 9] }, portals: [{ geometry: 0, target: 0, passable: true }] },
  ],
  portals: [{ v: [[-1, 0, 10], [1, 0, 10], [1, 2, 10], [-1, 2, 10]], i: [0, 1, 2, 0, 2, 3] }],
};

type Def = { id: string; file: string; bounds: { min: number[]; max: number[] }; triangles: number };

function loadedOf(def: Def, prims: { geometry: THREE.BufferGeometry; cell: number }[], rooms: THREE.Box3[] = []) {
  const bounds = new THREE.Box3(new THREE.Vector3(def.bounds.min[0], def.bounds.min[1], def.bounds.min[2]), new THREE.Vector3(def.bounds.max[0], def.bounds.max[1], def.bounds.max[2]));
  return {
    def,
    scene: new THREE.Group(),
    primitives: prims.map((p) => ({ geometry: p.geometry, material: mat, cell: p.cell })),
    radius: Math.max(Math.abs(def.bounds.max[0] - def.bounds.min[0]), Math.abs(def.bounds.max[2] - def.bounds.min[2])) / 2,
    height: def.bounds.max[1] - Math.min(0, def.bounds.min[1]),
    interiorBoxes: rooms,
    bounds,
    portals: [],
    levels: null,
  };
}

/** A pack holding these models, answering the streamer's four questions of it the way `AssetPack` does. */
function fakePack(planet: string, defs: Def[], models: Record<string, ReturnType<typeof loadedOf>>) {
  const ready = new Map<string, ReturnType<typeof loadedOf>>();
  return {
    manifest: { planet, categories: { layout: defs } },
    root: `/assets-private/${planet}/`,
    objectEffects: null,
    doors: null,
    find: (id: string) => defs.find((d) => d.id === id),
    loaded: (id: string) => ready.get(id) ?? null,
    model: async (id: string) => {
      const m = models[id];
      if (!m) throw new Error(`no model ${id}`);
      ready.set(id, m);
      return m;
    },
  };
}

/** One object of the snapshot's own, in the snapshot's frame (x mirrored about the centre, which is 0 here). */
export interface SnapshotObject {
  template: string;
  model: string;
  x: number;
  y: number;
  z: number;
  q: number[];
  radius: number;
}

/** The rock, standing at the game's (100, 0, 100): snapshot x -100. Its region (0,0) loads tier 0 when the player is near. */
export const ROCK_AT = { x: 100, z: 100 };
const DEFAULT_OBJECTS: SnapshotObject[] = [{ template: 'object/rock', model: 'rock', x: -ROCK_AT.x, y: 0, z: ROCK_AT.z, q: [1, 0, 0, 0], radius: 40 }];

export interface Harness {
  stream: Streamer;
  /** The same streamer with its private parts readable, for a test that has to look inside. */
  s: any;
  physics: World;
  scene: THREE.Scene;
  /** The gallery pack a house comes out of, already standing behind the world as `World.placeBuilding` stands it. */
  gallery: ReturnType<typeof fakePack>;
  /** `update` with the player at a point, a turn of the event loop, and a step of the world: `n` times. */
  settle(at: { x: number; z: number }, n?: number): Promise<void>;
  /** How high the first thing straight down from `from` is at (x, z), or null for nothing. */
  rayDown(x: number, z: number, from?: number, filter?: number): number | null;
  /** Put a thing down in play as the world does, filed under `key`, at the ground line. */
  put(key: string, model: string, x: number, z: number, opts?: { radius?: number; solid?: boolean; inside?: boolean }): Promise<unknown>;
  /** How many instances of anything in the scene stand at (x, z) on the ground: what a placement's own meshes are. */
  meshesAt(x: number, z: number): number;
  /** Whether the streamer keeps a record of meshes made in play for anything filed under `key`, placed now or not. */
  hasRecord(key: string): boolean;
  /** Every loaded tier's list against its region's: the rule the collider sweep depends on. Answers the tiers checked, or -1 on the first that is a copy. */
  tiersShareLists(): number;
}

/** A streamer over a world of `objects` (the rock by default) with the gallery's house and crate standing behind it. */
export async function makeStreamer(objects: SnapshotObject[] = DEFAULT_OBJECTS): Promise<Harness> {
  const physics = await Physics.create();
  const scene = new THREE.Scene();
  const world = fakePack('tatooine', [ROCK, CRATE], {
    rock: loadedOf(ROCK, [{ geometry: boxGeo(26, 30, 26, 0), cell: -1 }]),
    crate: loadedOf(CRATE, [{ geometry: boxGeo(1, 1, 1, 0), cell: -1 }]),
  });
  const room = (): THREE.Box3[] => [new THREE.Box3(new THREE.Vector3(-9, 0, -9), new THREE.Vector3(9, 7.5, 9))];
  const shell = () => [
    { geometry: boxGeo(20, 8, 20, 0), cell: 0 },
    { geometry: boxGeo(18, 0.3, 18, 0), cell: 1 },
  ];
  const gallery = fakePack('gallery', [HOUSE, HALL, CRATE], {
    house: loadedOf(HOUSE, shell(), room()),
    hall: loadedOf(HALL, shell(), room()),
    crate: loadedOf(CRATE, [{ geometry: boxGeo(1, 1, 1, 0), cell: -1 }]),
  });
  const layout = { planet: 'tatooine', center: { x: 0, z: 0 }, radius: 10000, objects };
  const stream = new LayoutStreamer(scene, physics, world as never, layout as never, null, {});
  stream.useGuestPack(gallery as never);
  const s = stream as any;
  const at = new THREE.Vector3();
  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  return {
    stream,
    s,
    physics,
    scene,
    gallery,
    async settle(p, n = 20) {
      for (let i = 0; i < n; i++) {
        stream.update(at.set(p.x, 0, p.z));
        await new Promise((r) => setTimeout(r, 0));
        physics.stepOnce();
      }
    },
    rayDown(x, z, from = 20, filter) {
      ray.origin = { x, y: from, z };
      const hit = physics.world.castRay(ray, 200, true, undefined, filter);
      return hit ? from - hit.timeOfImpact : null;
    },
    put(key, model, x, z, opts = {}) {
      const def = model === 'house' ? HOUSE : CRATE;
      const radius = opts.radius ?? Math.max(Math.abs(def.bounds.max[0] - def.bounds.min[0]), Math.abs(def.bounds.max[2] - def.bounds.min[2])) / 2;
      return stream.place({ model, template: key, x, y: 0, z, q: new THREE.Quaternion(), radius, ...(opts.solid !== undefined ? { solid: opts.solid } : {}), ...(opts.inside ? { inside: true } : {}) });
    },
    meshesAt(x, z) {
      let n = 0;
      for (const c of scene.children) {
        const mesh = c as THREE.InstancedMesh;
        if (!mesh.isInstancedMesh) continue;
        for (let i = 0; i < mesh.count; i++) {
          mesh.getMatrixAt(i, m);
          v.setFromMatrixPosition(m);
          if (Math.abs(v.x - x) < 0.01 && Math.abs(v.z - z) < 0.01) n++;
        }
      }
      return n;
    },
    hasRecord(key) {
      for (const o of s.runtime.keys()) if (o.template === key) return true;
      return false;
    },
    tiersShareLists() {
      let n = 0;
      for (const region of s.regions.values()) {
        for (let t = 0; t < region.tiers.length; t++) {
          const tier = region.tiers[t];
          if (!tier || tier === 'loading') continue;
          if (tier.objects !== region.objects[t]) return -1;
          n++;
        }
      }
      return n;
    },
  };
}

/** A gate on the streamer's compile step: every call passes at once, except the first after `arm`, which waits for `open`. */
export interface Gate {
  arm(): void;
  /** Whether a call is waiting at the gate now. */
  readonly held: boolean;
  open(): void;
}

/**
 * Put a gate on `stream.prepare` (which the world sets to its paced shader queue): what holds a placement's
 * build in the middle of its tier's build, the window in which a tier can unload or a placement be taken
 * away while the runtime loop is still to reach it.
 */
export function gatePrepare(stream: Streamer): Gate {
  let armed = false;
  let release: (() => void) | null = null;
  stream.prepare = () => {
    if (!armed) return Promise.resolve();
    armed = false;
    return new Promise<void>((r) => {
      release = r;
    });
  };
  return {
    arm() {
      armed = true;
    },
    get held() {
      return release !== null;
    },
    open() {
      const r = release;
      release = null;
      r?.();
    },
  };
}
