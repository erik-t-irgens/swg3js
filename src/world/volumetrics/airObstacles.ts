// The obstacles: the layout streamer's solid boxes (`LayoutStreamer.forEachSolidBox`) drawn as one instanced draw of
// turned quads into the obstacle-top map, each texel the tallest solid's height over its base (MAX-blended), which
// every slab tests by its own floor (the design's §2.5): a solid blocks a slab where it stands more than `over` over the
// slab's floor, so smoke aloft (from the third wave) flows over a low wall and round a tower.
//
// **Two channels.** Red is the walls, which the solver and the dust stop at. Green is red and every room of a compound
// besides, which the volume reads and nothing else: a box wider than `obstacles.widest` is no wall (a compound's one
// box round its own open courtyard, Mos Eisley's starport 160 m across, held the whole window solid as one), but its
// halls are rooms, and the volume's dust must stay out of a room it sees through a door from outside (the design's
// risk 8). So a compound's own box is left out of both channels and its rooms (`SolidBox.room`) go into green alone:
// the air and the dust flow through them, and the volume never draws dust inside them.
//
// Gathered over `obstacles.gather` windows, and gathered again when the window has drifted `regather` of its size or
// every `every` seconds (a house put down in play is in the same regions and comes with the next gather); redrawn
// whenever the window moves, since the boxes are kept in the world's frame and the map is the window's. Past
// `instances` boxes the nearest are kept and the rest counted. Flora is left out: a canopy's box is not a wall.
import * as THREE from 'three';
import { AIR_TUNE } from './airTune.ts';
import type { SolidBox } from '../layoutStream';
import { OBSTACLE_FRAGMENT, OBSTACLE_VERTEX } from './airShaders.ts';
import type { FluidWindow } from './fluidWindow.ts';

/** What the obstacles read the boxes through: the streamer's walk, or a stand-in in a test. */
export interface SolidBoxSource {
  /** `roomsOver`: an object whose own box is wider than this either way is visited with its rooms after it (`SolidBox.room`). */
  forEachSolidBox(x0: number, z0: number, x1: number, z1: number, box: SolidBox, visit: (box: SolidBox) => boolean, roomsOver?: number): void;
}

export class AirObstacles {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly boxes: Float32Array;
  private readonly turns: Float32Array;
  private readonly boxAttr: THREE.InstancedBufferAttribute;
  private readonly turnAttr: THREE.InstancedBufferAttribute;
  /** The boxes held, and how many a gather could not keep. */
  count = 0;
  dropped = 0;
  /** Gathers made since the world began. */
  gathers = 0;
  /** Boxes the last gather left out as wider than `obstacles.widest`. */
  tooWide = 0;
  /** Rooms of those boxes the last gather kept, for the volume alone (the map's green). */
  rooms = 0;
  /** The widest box of the last gather (its larger half extent, metres), where it stands and how tall: the console's. */
  largest = 0;
  largestX = 0;
  largestZ = 0;
  largestTop = 0;
  private readonly cap: number;
  private gx = Number.NaN;
  private gz = Number.NaN;
  private gatheredAt = -Infinity;
  /** The farthest box kept, while a gather is full, and how far. */
  private far = -1;
  private farD = -1;
  private cx = 0;
  private cz = 0;
  private readonly rec: SolidBox = { x: 0, z: 0, hx: 0, hz: 0, cos: 1, sin: 0, top: 0, room: false };
  private readonly visit = (b: SolidBox): boolean => {
    this.take(b);
    return true;
  };

  constructor(windowUniform: { value: THREE.Vector4 }, cap = AIR_TUNE.obstacles.instances) {
    this.cap = Math.max(16, Math.floor(cap));
    this.boxes = new Float32Array(this.cap * 4);
    // cos, sin, top, and 1 for a wall (red and green) or 0 for a room the volume alone keeps clear (green).
    this.turns = new Float32Array(this.cap * 4);
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.boxAttr = new THREE.InstancedBufferAttribute(this.boxes, 4).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    this.turnAttr = new THREE.InstancedBufferAttribute(this.turns, 4).setUsage(THREE.DynamicDrawUsage) as THREE.InstancedBufferAttribute;
    g.setAttribute('aBox', this.boxAttr);
    g.setAttribute('aTurn', this.turnAttr);
    g.instanceCount = 0;
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      name: 'air.obstacles',
      vertexShader: OBSTACLE_VERTEX,
      fragmentShader: OBSTACLE_FRAGMENT,
      uniforms: { uWindow: windowUniform },
      // The tallest solid over a texel wins.
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      toneMapped: false,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
  }

  /** The field's clock, seconds, written by the field each frame before `due` (so no number crosses the call). */
  time = 0.5;

  /** Whether the window has drifted far enough, or long enough has passed, that the boxes are gathered again. */
  due(w: FluidWindow): boolean {
    const O = AIR_TUNE.obstacles;
    if (!Number.isFinite(this.gx)) return true;
    const mx = w.ox + w.size / 2 - this.gx;
    const mz = w.oz + w.size / 2 - this.gz;
    if (Math.abs(mx) > w.size * O.regather || Math.abs(mz) > w.size * O.regather) return true;
    return this.time - this.gatheredAt > O.every;
  }

  /** Gather the solid boxes round the window's middle over `gather` windows. */
  gather(src: SolidBoxSource, w: FluidWindow): void {
    const now = this.time;
    const half = (w.size * AIR_TUNE.obstacles.gather) / 2;
    this.cx = w.ox + w.size / 2;
    this.cz = w.oz + w.size / 2;
    this.count = 0;
    this.dropped = 0;
    this.far = -1;
    this.farD = -1;
    this.largest = 0;
    this.tooWide = 0;
    this.rooms = 0;
    src.forEachSolidBox(this.cx - half, this.cz - half, this.cx + half, this.cz + half, this.rec, this.visit, AIR_TUNE.obstacles.widest);
    this.gx = this.cx;
    this.gz = this.cz;
    this.gatheredAt = now;
    this.gathers++;
    this.geometry.instanceCount = this.count;
    this.boxAttr.needsUpdate = true;
    this.turnAttr.needsUpdate = true;
  }

  /** Forget the boxes (a new world, a jump): the next placing gathers again. */
  forget(): void {
    this.count = 0;
    this.geometry.instanceCount = 0;
    this.gx = Number.NaN;
    this.gz = Number.NaN;
  }

  private take(b: SolidBox): void {
    const room = b.room === true;
    if (!room) {
      const big = b.hx > b.hz ? b.hx : b.hz;
      if (big > this.largest) {
        this.largest = big;
        this.largestX = b.x;
        this.largestZ = b.z;
        this.largestTop = b.top;
      }
      // A compound's box is not a wall (`obstacles.widest`): counted and left out of both channels; its rooms follow.
      if (big > AIR_TUNE.obstacles.widest) {
        this.tooWide++;
        return;
      }
    }
    const dx = b.x - this.cx;
    const dz = b.z - this.cz;
    const d = dx * dx + dz * dz;
    let at: number;
    if (this.count < this.cap) {
      at = this.count++;
    } else {
      this.dropped++;
      if (this.far < 0) this.findFar();
      if (d >= this.farD) return;
      at = this.far;
      this.far = -1;
    }
    const k4 = at * 4;
    this.boxes[k4] = b.x;
    this.boxes[k4 + 1] = b.z;
    this.boxes[k4 + 2] = b.hx;
    this.boxes[k4 + 3] = b.hz;
    this.turns[k4] = b.cos;
    this.turns[k4 + 1] = b.sin;
    this.turns[k4 + 2] = b.top;
    this.turns[k4 + 3] = room ? 0 : 1;
    if (room) this.rooms++;
  }

  /** The farthest box kept, while the gather is full. */
  private findFar(): void {
    let best = -1;
    let bestD = -1;
    for (let i = 0; i < this.count; i++) {
      const dx = this.boxes[i * 4] - this.cx;
      const dz = this.boxes[i * 4 + 1] - this.cz;
      const d = dx * dx + dz * dz;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    this.far = best;
    this.farD = bestD;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
