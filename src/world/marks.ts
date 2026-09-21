// What the fight leaves behind on the world's surfaces: the burn a lit lightsaber drags along a
// wall, the scar a bolt stops at, and the print a foot presses into soft ground. One system, one
// ring of quads, at most two draws for all three (a mesh with nothing showing in it is not drawn at
// all), and every piece fading out by its own birth time in the shader so that nothing about a mark
// is ever worked out per frame on the processor. A mark laid writes the four vertices it touched and
// no more: three is told which window of each buffer moved, so a walk and a firefight do not
// re-upload the whole ring on the commonest frames there are.
//
// It began as the saber's own marks and is that file generalised rather than a new one, because the
// saber's version was already the right answer to the hard part: it is **not a projected decal**.
// A projected decal has to be clipped against the triangles it lands on, and the world's props are
// instanced and streamed in and out by tier, so on the browser where the bolt lands those triangles
// may not be here at all. A quad laid on the surface normal needs nothing but the point and the
// normal, both of which every caller already has.
//
// Three things about it are worth knowing before changing any of it.
//
//  - **The three kinds share one ring, and they cannot push one another out.** A firefight lays
//    hundreds of scars and a walk lays a print every half second, so one cursor over one ring would
//    mean a magazine emptied into a wall wiped out every footprint on the planet. The ring is
//    therefore three contiguous ranges of the same buffer, sized by `MARKS.share`, each with a
//    cursor of its own that only ever overwrites its own oldest. `__debug.marks()` reports the three
//    counts and what each of them has pushed out, which is the owner's own check.
//  - **A mark can be told to die with what it was laid on.** Every piece carries an `owner`, which
//    is the collider handle it was laid against (`MARK_WORLD`, -1, means the world itself: the
//    ground and anything that is never streamed; it cannot be 0, since 0 is a handle the engine
//    really hands out -- see the constant). `forget(owner)` takes down every piece laid on
//    that thing, so a scar on a crate goes when the crate streams out instead of hanging in the
//    air where the crate was. Nothing is forgotten automatically: a caller with no handle to give
//    lays a mark on the world and it lives its life out.
//  - **Nothing is laid aboard a ship's rooms.** Aboard, everything lives in the hull's frame and
//    this mesh lives in the world's, so a mark made in a cabin at 300 m/s would be a streak left
//    behind in space. The saber's own burn has always refused to be laid aboard and all three kinds
//    now refuse alike; riding the hull would mean a second set of meshes hung under it, which is a
//    piece of work of its own and is not this one.
//
// The pictures are ours, drawn by hand in `src/world/marks.svg`, the way the interface's glyphs are:
// the client has no dynamic marks of any kind to convert, and nothing from the archives is read
// here. A sheet that does not arrive costs the pictures and nothing else -- the shader falls back
// to a soft disc of the right size, colour and life.
//
// Units are metres and seconds. Nothing in a step allocates: the scratch is at module scope, as the
// rest of the combat code keeps its.
import * as THREE from 'three';
import { sabers } from '../audio/saberSounds.ts';

/** Anything with the three fields: a `THREE.Vector3` is one, and so is a plain object in a test. */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** The families of gun a scar can be left by, which is the weapon effect family its gun names. */
export type ScarFamily = 'bolt' | 'rocket' | 'slug' | 'flame' | 'lightning';

/** Everything that can be asked for by name: the saber's stroke, the five scars, a footprint. */
export type MarkName = 'saber' | ScarFamily | 'print';

/** The three kinds the ring is shared between, which is what `__debug.marks()` counts. */
export type MarkGroup = 'saber' | 'scar' | 'print';

/**
 * A mark laid on the world itself -- the ground, the terrain, a building's shell -- which is never
 * streamed out from under it. Anything else should be given the collider handle it was laid on.
 *
 * It is **-1 and not 0**, and that is not a free choice. A collider handle is a plain integer that
 * the engine hands out from zero and recycles as colliders come and go, and this project already
 * keys real tables on the raw handle (`colliderTemplate` in `layoutStream.ts`), so at any moment
 * exactly one live collider is handle 0 and over a session handle 0 is recycled onto one streamed
 * prop after another. With 0 as the sentinel, every mark laid on whichever prop held it would have
 * been recorded as laid on the world: never counted in `owned`, never taken down by `forget`, and
 * left hanging in the air when that prop streamed out -- silently, since the readout would call it
 * unowned. Handles are never negative, so -1 is a value no collider can ever be.
 */
export const MARK_WORLD = -1;

/** What a caller may say beyond the place, the size and the life. Keep one and reuse it: it is read and not held. */
export interface MarkPlace {
  /** The collider the mark was laid on, so `forget` can take it down with that thing. */
  owner?: number;
  /** Which way the mark's length runs, in world space. Projected onto the surface; null or zero takes any direction. */
  along?: Vec3Like | null;
  /** Seconds the mark's hot edge glows before it is only char. Below zero takes the kind's own. */
  glow?: number;
  /** Length over width. Below zero, or left out, is square: a mark longer than it is wide says so. */
  aspect?: number;
  /** Mirrored across its length: a left foot against a right one. */
  mirror?: boolean;
}

export interface MarksTune {
  /** How many pieces the ring holds across all three kinds. Spent when the meshes are built. */
  pieces: number;
  /** How many hot rims may be over fresh scars at once, in the additive mesh. Spent when built. */
  rims: number;
  /** The share of the ring each kind gets. Spent when built; normalised so the three add to one. */
  share: Record<MarkGroup, number>;
  /** The saber stroke's width, in metres. */
  width: number;
  /** Seconds a stroke glows red before it is only char, and seconds until the char is gone. */
  glowLife: number;
  life: number;
  /** Two contacts closer than this lay nothing new; farther apart than the break, they are two strokes. */
  step: number;
  breakAt: number;
  /** How far off the surface a mark is laid, in metres. */
  lift: number;
  /** A scar's life, and how long its edge glows. */
  scarLife: number;
  scarGlow: number;
  /** A scar's width across, in metres, by the family of gun that left it. */
  scarSize: Record<ScarFamily, number>;
  /** The hot rim over a fresh scar: how much wider than the scar it is, and how long it lasts. 0 turns it off. */
  rimSize: number;
  rimLife: number;
  // A footprint's length, width and life are **not** here. They belong to whoever lays the print,
  // because they are scaled by the body that left it and graded by how deeply the ground took it,
  // and a print is asked for by size and by life like any other mark (`place`). Their one home is
  // `PRINT_TUNE` in `src/world/footprints.ts`, live through `__debug.footprints({ life: 90 })`;
  // keeping a copy of them here would have put a number in `__debug.marks()` that moved nothing.
  /** The share of a mark's life at which it starts fading out. */
  fade: number;
  /** How far out from a quad's middle its shape starts fading to nothing, as a share of its half-width. */
  edge: number;
  /** How hard a scar and a print are laid over what is under them, at their strongest. */
  scarWeight: number;
  printWeight: number;
  /** What is left of a mark's strength once its edge has cooled: 1 is no cooling at all. */
  coolAlpha: number;
  /** How much further off the surface than its own scar a hot rim is laid, as a multiple of `lift`. */
  rimLift: number;
  /**
   * The colours, as 0xRRGGBB read straight into the shader (nothing here is tone mapped and nothing
   * is converted, so a value is the pixel). `char` is what a mark cools to and `hot` what it starts
   * as; a print never glows, so it has only the one.
   */
  colour: Record<MarkColour, number>;
}

/** Every colour the shader takes, which is every colour the marks have. */
export type MarkColour = 'scarChar' | 'scarHot' | 'lightningChar' | 'lightningHot' | 'printChar' | 'rimHot';

/**
 * Every number the marks have. The saber's six are exactly what its own file carried and are not
 * moved by this: a scorch must look today as it looked yesterday. Everything else is ours -- the
 * client has no marks of any kind, so there is nothing to be faithful to. Live through
 * `__debug.marks({ ... })`, except the three that are spent when the meshes are built.
 */
export const MARKS: MarksTune = {
  // 2,250 at 0.4 / 0.4 / 0.2 is 900 for the blade, which is exactly the ring the saber's own file
  // held: a stroke lays a piece every `step` (12 mm), so a smaller share would shorten how much of a
  // long drag the world can still be holding while its 16 s life runs, and a scorch must look today
  // as it looked yesterday. The scars get the same 900 and the prints 450.
  pieces: 2250,
  rims: 96,
  share: { saber: 0.4, scar: 0.4, print: 0.2 },
  width: 0.035,
  glowLife: 1.4,
  life: 16,
  step: 0.012,
  breakAt: 0.6,
  lift: 0.006,
  scarLife: 30,
  scarGlow: 0.6,
  scarSize: { bolt: 0.22, rocket: 0.5, slug: 0.1, flame: 0.45, lightning: 0.3 },
  rimSize: 1.35,
  rimLife: 0.6,
  fade: 0.55,
  edge: 0.78,
  scarWeight: 0.92,
  printWeight: 0.55,
  coolAlpha: 0.85,
  rimLift: 1.5,
  colour: {
    scarChar: 0x0d0908,
    scarHot: 0xff731f,
    lightningChar: 0x141217,
    lightningHot: 0xbfe0ff,
    printChar: 0x17130f,
    rimHot: 0xff9e38,
  },
};

/**
 * The three numbers of `MARKS` that are spent when the meshes are built and are never read again,
 * so writing them from the console would report a change that did not happen. The knob refuses them
 * by name and `report().buildOnly` says what is really in force, exactly as the clashes do.
 */
export const MARKS_BUILD_ONLY: readonly string[] = ['pieces', 'rims', 'share'];

/**
 * Which cell of the sheet each name draws with, and which of the shader's two halves it takes. 0 is
 * the saber, which draws no picture at all: its burn is worked out in the shader as it always was,
 * so that the stroke is exactly what it was before the sheet existed. 1 and up are the sheet's
 * cells, in the order the sheet itself is laid out.
 */
const SLOT: Record<MarkName | 'rim', number> = { saber: 0, bolt: 1, rocket: 2, slug: 3, flame: 4, lightning: 5, print: 6, rim: 7 };

/** Which of the three ranges of the ring each name is laid in. */
const GROUP_OF: Record<MarkName, MarkGroup> = { saber: 'saber', bolt: 'scar', rocket: 'scar', slug: 'scar', flame: 'scar', lightning: 'scar', print: 'print' };

/**
 * Which families get a hot rim over the fresh scar. A flame leaves soot and never a burnt edge, and
 * a slug's pit is too small for a ring to read as anything but a smear, so neither takes one.
 */
const RIMMED: Record<ScarFamily, boolean> = { bolt: true, rocket: true, slug: false, flame: false, lightning: true };

// Which family of scar a gun's name leaves is **not** here. It lives in `scarFamilyFor` in
// `src/combat/scars.ts`, which is the gun side of the question and knows both a gun's own type and
// its weapon effect family, neither of which the marks have any business reading; a mark is asked
// for by family and draws it. Two copies of that rule were written in this wave and one was taken
// out here, because a value with two homes drifts and this project has learned that twice.

/** Where the sheet lives, resolved against this module so the builder rewrites it and a node test never reaches for it. */
const SHEET_URL = new URL('./marks.svg', import.meta.url).href;
/** The sheet's own size in pixels: eight cells in one row. Both numbers are the file's, not a choice made here. */
const SHEET_CELLS = 8;
const SHEET_CELL_PX = 128;

const VERT = /* glsl */ `
  attribute float aBorn;
  attribute float aKind;
  attribute float aLife;
  attribute float aGlow;
  varying vec2 vUv;
  varying float vBorn;
  varying float vKind;
  varying float vLife;
  varying float vGlow;
  void main() {
    vUv = uv;
    vBorn = aBorn;
    vKind = aKind;
    vLife = aLife;
    vGlow = aGlow;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Two halves, chosen per quad by its kind.
 *
 * The saber's half is the one that was here before and is untouched: across the stroke (u) the burn
 * is hottest in the middle, along it (v) it is even, and the colour goes from a red-orange glow to a
 * dark char over the glow life and then fades out over the life.
 *
 * Everything else reads one cell of the hand-drawn sheet for its shape and takes its colour from
 * the kind: a scar cools from a bright edge to char, soot never glows at all, and a footprint is a
 * shadow pressed into the ground that only ever darkens. The last fifth of every quad is faded to
 * nothing so that a mark never ends on a hard square edge -- which is also what makes the fallback
 * work, since with no sheet the texture reads 1 everywhere and what is left is a soft disc.
 *
 * Pieces not yet laid (born at -1) draw nothing, and so does one past its life: nothing on the
 * processor ever sweeps the ring.
 */
const FRAG = /* glsl */ `
  uniform float uTime;
  uniform sampler2D uSheet;
  uniform float uFade;
  uniform float uCells;
  uniform float uEdge;
  uniform float uScarWeight;
  uniform float uPrintWeight;
  uniform float uCoolAlpha;
  uniform vec3 uScarChar;
  uniform vec3 uScarHot;
  uniform vec3 uLightningChar;
  uniform vec3 uLightningHot;
  uniform vec3 uPrintChar;
  uniform vec3 uRimHot;
  varying vec2 vUv;
  varying float vBorn;
  varying float vKind;
  varying float vLife;
  varying float vGlow;

  void main() {
    if (vBorn < 0.0) discard;
    float age = uTime - vBorn;
    if (age < 0.0 || age > vLife) discard;
    float fade = 1.0 - smoothstep(vLife * uFade, vLife, age);
    float glow = vGlow > 0.0 ? 1.0 - smoothstep(0.0, vGlow, age) : 0.0;
    vec3 col;
    float alpha;
    if (vKind < 0.5) {
      // The saber's stroke, exactly as it has always been drawn.
      float x = abs(vUv.x * 2.0 - 1.0);
      float across = 1.0 - smoothstep(0.35, 1.0, x);
      vec3 ch = vec3(0.06, 0.035, 0.025);
      // Hot: white-yellow at the very middle, red-orange out to the edge.
      vec3 hot = mix(vec3(1.0, 0.25, 0.05), vec3(1.0, 0.85, 0.5), 1.0 - smoothstep(0.0, 0.5, x));
      col = mix(ch, hot, glow);
      alpha = across * fade * mix(0.8, 1.0, glow);
    } else {
      float cell = vKind - 1.0;
      vec2 at = vec2((cell + clamp(vUv.x, 0.002, 0.998)) / uCells, clamp(vUv.y, 0.002, 0.998));
      float shape = texture2D(uSheet, at).a;
      // Away from the middle the quad is faded out, so a mark never ends on its own square edge and
      // a sheet that never arrived is a soft disc rather than a white box.
      vec2 d = vUv * 2.0 - 1.0;
      shape *= 1.0 - smoothstep(uEdge, 1.0, length(d));
      vec3 ch;
      vec3 hot;
      float weight;
      if (vKind < 5.5) {
        // A scar: burnt, with an edge that cools. The lightning's char is the bluest of them.
        ch = vKind > 4.5 ? uLightningChar : uScarChar;
        hot = vKind > 4.5 ? uLightningHot : uScarHot;
        weight = uScarWeight;
      } else if (vKind < 6.5) {
        // A footprint: no heat ever, and lighter than a burn, since it is a shadow and not a hole.
        ch = uPrintChar;
        hot = ch;
        weight = uPrintWeight;
      } else {
        // The hot rim over a fresh scar, in the additive mesh: it is all glow and no char.
        ch = vec3(0.0);
        hot = uRimHot;
        weight = 1.0;
      }
      col = mix(ch, hot, glow);
      alpha = shape * fade * weight * mix(uCoolAlpha, 1.0, glow);
    }
    if (alpha <= 0.0) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

/** The scratch a quad is worked out in. At module scope: a mark is laid inside a step. */
let nx = 0;
let ny = 0;
let nz = 0;
let tx = 0;
let ty = 0;
let tz = 0;
let bx = 0;
let by = 0;
let bz = 0;
const lastPoint = new THREE.Vector3();

/**
 * One mesh's worth of the ring: the buffers, the material and the quads written into them. Two of
 * these exist -- the blended one every mark is drawn in, and the additive one that carries nothing
 * but the hot rim over a fresh scar -- and they are the whole of the drawing cost, which is two
 * calls however many marks there are.
 */
class Sheet {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly slots: number;
  readonly owners: Int32Array;
  private readonly position: THREE.BufferAttribute;
  private readonly born: THREE.BufferAttribute;
  private readonly kind: THREE.BufferAttribute;
  private readonly life: THREE.BufferAttribute;
  private readonly glow: THREE.BufferAttribute;
  /** One window per attribute, handed to three and then written into: see `window` below. */
  private readonly windows: { start: number; count: number }[] = [];
  /**
   * Which owners have at least one piece in this sheet, so that `forget` can answer a handle it has
   * never marked in one lookup instead of walking the ring. It is allowed to hold a handle whose
   * pieces have since been written over: such an entry costs one scan when it is next asked for and
   * is dropped then, and the streamer asks for every handle it removes, so it drains itself.
   */
  private readonly present = new Set<number>();
  /**
   * Whether a program has been built for this material. Until it has, the mesh stays visible whatever
   * is in it: `renderer.compile()` walks the scene with `traverseVisible`, so a mesh hidden while the
   * loading screen is up would have no program and would compile on the first live frame a mark was
   * laid -- which is the one thing this project does not allow. Three calls `onBeforeCompile` for a
   * ShaderMaterial as it does for any other, so this is the compile itself saying so.
   */
  compiled = false;
  /** When the last thing written here stops showing, so a sheet with nothing in it is not drawn. */
  private until = -1;
  /** How many pieces carry an owner that is not the world, so `forget` can leave at once when none do. */
  owned = 0;
  /** How many times `forget` has really walked the ring, which is what the readout reports as `scans`. */
  scans = 0;

  constructor(slots: number, name: string, additive: boolean, sheet: THREE.Texture) {
    this.slots = Math.max(1, Math.floor(slots));
    this.owners = new Int32Array(this.slots).fill(MARK_WORLD);
    const g = new THREE.BufferGeometry();
    const count = this.slots * 4;
    this.position = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
    this.born = new THREE.BufferAttribute(new Float32Array(count).fill(-1), 1);
    this.kind = new THREE.BufferAttribute(new Float32Array(count), 1);
    this.life = new THREE.BufferAttribute(new Float32Array(count).fill(1), 1);
    this.glow = new THREE.BufferAttribute(new Float32Array(count), 1);
    const uv = new Float32Array(count * 2);
    const index: number[] = [];
    for (let i = 0; i < this.slots; i++) {
      // The two corners at the mark's start, then the two at its end: u across, v along.
      uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
      const v = i * 4;
      index.push(v, v + 1, v + 2, v, v + 2, v + 3);
    }
    g.setAttribute('position', this.position);
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aBorn', this.born);
    g.setAttribute('aKind', this.kind);
    g.setAttribute('aLife', this.life);
    g.setAttribute('aGlow', this.glow);
    g.setIndex(index);
    this.position.setUsage(THREE.DynamicDrawUsage);
    this.born.setUsage(THREE.DynamicDrawUsage);
    this.kind.setUsage(THREE.DynamicDrawUsage);
    this.life.setUsage(THREE.DynamicDrawUsage);
    this.glow.setUsage(THREE.DynamicDrawUsage);
    for (let k = 0; k < 5; k++) this.windows.push({ start: 0, count: 0 });
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uSheet: { value: sheet },
        uFade: { value: MARKS.fade },
        uCells: { value: SHEET_CELLS },
        uEdge: { value: MARKS.edge },
        uScarWeight: { value: MARKS.scarWeight },
        uPrintWeight: { value: MARKS.printWeight },
        uCoolAlpha: { value: MARKS.coolAlpha },
        // Vectors and not `THREE.Color`s: a colour would be taken as sRGB and converted on its way
        // in, and these are read into `gl_FragColor` with no tone mapping, so a value is the pixel.
        uScarChar: { value: new THREE.Vector3() },
        uScarHot: { value: new THREE.Vector3() },
        uLightningChar: { value: new THREE.Vector3() },
        uLightningHot: { value: new THREE.Vector3() },
        uPrintChar: { value: new THREE.Vector3() },
        uRimHot: { value: new THREE.Vector3() },
      },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
      toneMapped: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    material.onBeforeCompile = () => {
      this.compiled = true;
    };
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.name = name;
    this.setTime(0);
  }

  /**
   * The clock the pieces age against and every look number the shader reads, written once a frame
   * for the whole sheet: ten uniforms a frame is what makes all of them live through the knob, and
   * none of it allocates -- the colour vectors are the uniforms' own and are written into.
   */
  setTime(now: number): void {
    const u = this.mesh.material.uniforms;
    u.uTime.value = now;
    u.uFade.value = MARKS.fade;
    u.uEdge.value = MARKS.edge;
    u.uScarWeight.value = MARKS.scarWeight;
    u.uPrintWeight.value = MARKS.printWeight;
    u.uCoolAlpha.value = MARKS.coolAlpha;
    hexInto(u.uScarChar.value as THREE.Vector3, MARKS.colour.scarChar);
    hexInto(u.uScarHot.value as THREE.Vector3, MARKS.colour.scarHot);
    hexInto(u.uLightningChar.value as THREE.Vector3, MARKS.colour.lightningChar);
    hexInto(u.uLightningHot.value as THREE.Vector3, MARKS.colour.lightningHot);
    hexInto(u.uPrintChar.value as THREE.Vector3, MARKS.colour.printChar);
    hexInto(u.uRimHot.value as THREE.Vector3, MARKS.colour.rimHot);
    // Nothing in it is showing and a program has been built for it: not drawn at all. The portal
    // renderer makes up to eight `render()` calls a frame, so a mesh whose every quad is dead is
    // eight draw calls and their state changes a frame for nothing, for as long as the page is open.
    this.mesh.visible = !this.compiled || now < this.until;
  }

  /** The texture every cell is read out of; swapped in when the hand-drawn sheet has been rasterised. */
  setSheet(tex: THREE.Texture): void {
    this.mesh.material.uniforms.uSheet.value = tex;
  }

  /** Whether slot `i` is still showing something at `now`. */
  alive(i: number, now: number): boolean {
    const b = this.born.getX(i * 4);
    if (b < 0) return false;
    const age = now - b;
    return age >= 0 && age < this.life.getX(i * 4);
  }

  /**
   * One quad: its middle at (cx, cy, cz), lifted along the normal, `hl` half its length along
   * (tx, ty, tz) and `hw` half its width across (bx, by, bz). `mirror` swaps the two across-corners,
   * which is a left boot against a right one and costs nothing.
   */
  write(i: number, cx: number, cy: number, cz: number, hl: number, hw: number, lift: number, slot: number, born: number, life: number, glow: number, owner: number, mirror: boolean): void {
    const v = i * 4;
    const ox = cx + nx * lift;
    const oy = cy + ny * lift;
    const oz = cz + nz * lift;
    const s = mirror ? -hw : hw;
    this.corner(v + 0, ox - bx * s - tx * hl, oy - by * s - ty * hl, oz - bz * s - tz * hl);
    this.corner(v + 1, ox + bx * s - tx * hl, oy + by * s - ty * hl, oz + bz * s - tz * hl);
    this.corner(v + 2, ox + bx * s + tx * hl, oy + by * s + ty * hl, oz + bz * s + tz * hl);
    this.corner(v + 3, ox - bx * s + tx * hl, oy - by * s + ty * hl, oz - bz * s + tz * hl);
    for (let k = 0; k < 4; k++) {
      this.born.setX(v + k, born);
      this.kind.setX(v + k, slot);
      this.life.setX(v + k, life);
      this.glow.setX(v + k, glow);
    }
    if (this.owners[i] !== MARK_WORLD) this.owned--;
    this.owners[i] = owner;
    if (owner !== MARK_WORLD) {
      this.owned++;
      this.present.add(owner);
    }
    const ends = born + life;
    if (ends > this.until) this.until = ends;
    // Laid after this frame's `setTime`, so the mesh is turned on here rather than a frame later.
    this.mesh.visible = true;
    this.touched(i, true);
  }

  private corner(k: number, x: number, y: number, z: number): void {
    this.position.setXYZ(k, x, y, z);
  }

  /**
   * Slot `i`'s four vertices are what changed, and nothing else is. Three uploads a whole attribute
   * unless it is told which part of it moved, so a footprint laid while walking, or a scar laid by
   * every bolt of a firefight, would otherwise re-upload all five buffers of the whole ring -- which
   * is the commonest frame there is. Each attribute keeps one window, made with the sheet and handed
   * to three once per upload and then merged into in place, so nothing here allocates either.
   */
  private touched(i: number, all: boolean): void {
    const v = i * 4;
    this.window(0, this.position, v * 3, 12);
    this.window(1, this.born, v, 4);
    if (!all) return;
    this.window(2, this.kind, v, 4);
    this.window(3, this.life, v, 4);
    this.window(4, this.glow, v, 4);
  }

  private window(k: number, attr: THREE.BufferAttribute, start: number, count: number): void {
    const w = this.windows[k];
    if (attr.updateRanges.length === 0) {
      w.start = start;
      w.count = count;
      attr.updateRanges.push(w);
    } else {
      // Three empties the list itself once it has uploaded, so a list with something in it is one
      // this sheet put there and has not been drawn since: widen it rather than add a second.
      const end = Math.max(w.start + w.count, start + count);
      w.start = Math.min(w.start, start);
      w.count = end - w.start;
    }
    attr.needsUpdate = true;
  }

  /** Slot `i` gone, whatever was in it. */
  drop(i: number): void {
    const v = i * 4;
    for (let k = 0; k < 4; k++) this.born.setX(v + k, -1);
    if (this.owners[i] !== MARK_WORLD) this.owned--;
    this.owners[i] = MARK_WORLD;
    this.window(1, this.born, v, 4);
  }

  /**
   * Every piece laid on `owner` taken down; returns how many. A handle this sheet has never marked
   * is one lookup and an answer, which is what makes the call cheap enough to make from the
   * streamer's collider disposal: the walk of the ring is paid only for a thing that really carries
   * a mark, and once for a handle whose marks have since been written over.
   */
  forget(owner: number): number {
    if (owner === MARK_WORLD || this.owned <= 0 || !this.present.has(owner)) return 0;
    this.scans++;
    let gone = 0;
    for (let i = 0; i < this.slots; i++) {
      if (this.owners[i] !== owner) continue;
      this.drop(i);
      gone++;
    }
    this.present.delete(owner);
    return gone;
  }

  /** How many pieces between `from` and `to` are still showing. */
  live(from: number, to: number, now: number): number {
    let n = 0;
    for (let i = from; i < to; i++) if (this.alive(i, now)) n++;
    return n;
  }

  clear(): void {
    (this.born.array as Float32Array).fill(-1);
    this.owners.fill(MARK_WORLD);
    this.owned = 0;
    this.present.clear();
    this.until = -1;
    // The whole buffer changed, so any window standing is dropped and three uploads all of it.
    this.born.updateRanges.length = 0;
    this.born.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** One kind's range of the ring: where it starts, how long it is, and where it will write next. */
interface Range {
  from: number;
  to: number;
  next: number;
  laid: number;
  pushedOut: number;
}

/**
 * Every mark in the world. One of these exists for the life of the page (`marks` below), as the
 * clashes and the saber sounds do, so that the bolts, the feet and the blade all write into the one
 * ring without anybody having to be handed anything.
 */
export class Marks {
  /** Both meshes, to be added to the scene once: they never move and they are never culled. */
  readonly group = new THREE.Group();
  private readonly blended: Sheet;
  private readonly additive: Sheet;
  private readonly ranges: Record<MarkGroup, Range>;
  private rimNext = 0;
  private rimLaid = 0;
  private time = 0;
  /** Where each blade's stroke last reached, so the next contact joins it. */
  private readonly last = new Map<number, THREE.Vector3>();
  /** The white stand-in every quad reads until the hand-drawn sheet has arrived. */
  private readonly standIn: THREE.DataTexture;
  private drawn: THREE.Texture | null = null;
  private sheetState: 'none' | 'waiting' | 'drawn' | 'failed' = 'none';
  private exposedOn: object | null = null;

  constructor() {
    this.standIn = whitePixel();
    const total = Math.max(3, Math.floor(MARKS.pieces));
    const sum = Math.max(1e-6, MARKS.share.saber + MARKS.share.scar + MARKS.share.print);
    const saber = Math.max(1, Math.round((total * MARKS.share.saber) / sum));
    const scar = Math.max(1, Math.round((total * MARKS.share.scar) / sum));
    const print = Math.max(1, total - saber - scar);
    this.blended = new Sheet(saber + scar + print, 'marks', false, this.standIn);
    this.additive = new Sheet(Math.max(1, Math.floor(MARKS.rims)), 'marks hot', true, this.standIn);
    this.ranges = {
      saber: { from: 0, to: saber, next: 0, laid: 0, pushedOut: 0 },
      scar: { from: saber, to: saber + scar, next: saber, laid: 0, pushedOut: 0 },
      print: { from: saber + scar, to: saber + scar + print, next: saber + scar, laid: 0, pushedOut: 0 },
    };
    this.group.name = 'marks';
    this.group.add(this.blended.mesh);
    this.group.add(this.additive.mesh);
    this.loadSheet();
  }

  /**
   * The old name for the group, kept so that the one line that puts the marks in the scene goes on
   * working: it added a mesh and now adds both of them at once.
   */
  get mesh(): THREE.Object3D {
    return this.group;
  }

  /** The clock the marks age by. */
  update(dt: number): void {
    this.expose();
    this.time += dt;
    this.blended.setTime(this.time);
    this.additive.setTime(this.time);
  }

  /**
   * Blade `blade` touches a surface at `point` with `normal`: the stroke goes on from where it last
   * was (a short stub when it starts, or starts again after a break). Returns whether anything was
   * laid. Unchanged in every particular from the day the saber's burns were written, because a
   * scorch must look today as it looked yesterday.
   */
  touch(blade: number, point: Vec3Like, normal: Vec3Like, owner: number = MARK_WORLD): boolean {
    let last = this.last.get(blade);
    setNormal(normal);
    if (!last) {
      last = new THREE.Vector3();
      this.last.set(blade, last);
      last.set(point.x, point.y, point.z);
      return this.stub(point, owner);
    }
    const d = Math.sqrt(sqDistance(last, point));
    if (d < MARKS.step) return false;
    if (d > MARKS.breakAt) {
      last.set(point.x, point.y, point.z);
      return this.stub(point, owner);
    }
    lastPoint.copy(last);
    last.set(point.x, point.y, point.z);
    return this.stroke(lastPoint, point, owner);
  }

  /**
   * A dot's worth of stroke where a stroke begins -- which is also where the blade is first heard
   * to meet the wall. A stroke dragged along is one contact, not one a frame: only its beginning,
   * and a beginning again after the blade has left the surface and come back, makes a sound.
   */
  private stub(point: Vec3Like, owner: number): boolean {
    sabers.contact('wall', point);
    anyTangent();
    return this.piece('saber', point.x, point.y, point.z, MARKS.width / 2, MARKS.width / 2, MARKS.glowLife, MARKS.life, owner, false);
  }

  /**
   * A quad of stroke from `a` to `b`, `MARKS.width` across in the surface, a little off it. The
   * length axis is the step itself and is **not** flattened into the surface, so the quad's two
   * ends are exactly the two contacts, which is what the stroke has always drawn.
   */
  private stroke(a: Vec3Like, b: Vec3Like, owner: number): boolean {
    alongDirect(b.x - a.x, b.y - a.y, b.z - a.z);
    const half = Math.sqrt(sqDistance(a, b)) / 2;
    return this.piece('saber', (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, half, MARKS.width / 2, MARKS.glowLife, MARKS.life, owner, false);
  }

  /**
   * A bolt stopped here: one scar of the family the gun names, on the surface normal, with a hot rim
   * over it for its first moments. Returns whether anything was laid.
   */
  scar(family: ScarFamily, at: Vec3Like, normal: Vec3Like, opts?: MarkPlace | null): boolean {
    const size = MARKS.scarSize[family];
    const laid = this.place(family, at, normal, size, MARKS.scarLife, opts);
    if (!laid) return false;
    if (RIMMED[family] && MARKS.rimLife > 0 && MARKS.rimSize > 0) this.rim(at, size * MARKS.rimSize);
    return true;
  }

  // A footprint has no call of its own here, and that is deliberate. One was written -- a `print`
  // that took a heading and read a length, a width and a life out of `MARKS` -- and it was taken out
  // at the merge, for two reasons that are worth keeping written down. Its numbers were a second
  // copy of the ones every print is really laid with (they are scaled by the body and graded by the
  // ground, so they belong to whoever lays the print), and the heading it took was read with the
  // camera's formula rather than the game's, which pointed every print the way the body had come
  // from. A print is asked for through `place` like everything else, with its own size, its own
  // life and the direction it runs in as a vector, so neither side has to agree which way a heading
  // turns: `src/world/footprints.ts` is the one place that knows, and it is node-tested.

  /**
   * A mark by kind, by place, by size and by how long it lasts: the one call the other packages ask
   * for anything with. `size` is the mark's width across in metres and its length follows from the
   * kind's own shape unless `opts.aspect` says otherwise; `life` is seconds. Returns false only when
   * the kind is not one this knows.
   */
  place(kind: MarkName, at: Vec3Like, normal: Vec3Like, size: number, life: number, opts?: MarkPlace | null): boolean {
    const slot = SLOT[kind] as number | undefined;
    if (slot === undefined) return false;
    setNormal(normal);
    const along = opts ? opts.along : null;
    if (along && (along.x !== 0 || along.y !== 0 || along.z !== 0)) alongFrom(along.x, along.y, along.z);
    else anyTangent();
    const owner = opts && opts.owner !== undefined ? opts.owner : MARK_WORLD;
    const mirror = opts && opts.mirror !== undefined ? opts.mirror : false;
    // Square unless the caller says otherwise, for every kind alike: a print is the one mark that is
    // longer than it is wide, and how much longer is the business of whoever laid it, since it is
    // that side that knows how big the body was.
    const aspect = opts && opts.aspect !== undefined && opts.aspect > 0 ? opts.aspect : 1;
    const glow = opts && opts.glow !== undefined && opts.glow >= 0 ? opts.glow : kind === 'saber' ? MARKS.glowLife : kind === 'print' ? 0 : MARKS.scarGlow;
    const half = Math.max(1e-4, size) / 2;
    return this.piece(kind, at.x, at.y, at.z, half * aspect, half, glow, Math.max(0.01, life), owner, mirror);
  }

  /** Every mark laid on `owner` taken down: what it was laid on has streamed out. Returns how many went. */
  forget(owner: number): number {
    return this.blended.forget(owner) + this.additive.forget(owner);
  }

  /** How many marks are still showing, of every kind. The old readout, kept. */
  count(): number {
    const r = this.ranges;
    return this.blended.live(r.saber.from, r.print.to, this.time);
  }

  /** How many of one kind are still showing. */
  countOf(group: MarkGroup): number {
    const r = this.ranges[group];
    return this.blended.live(r.from, r.to, this.time);
  }

  /** Every mark gone (a new world). */
  clear(): void {
    this.blended.clear();
    this.additive.clear();
    for (const key of Object.keys(this.ranges) as MarkGroup[]) {
      const r = this.ranges[key];
      r.next = r.from;
      r.laid = 0;
      r.pushedOut = 0;
    }
    this.rimNext = 0;
    this.rimLaid = 0;
    this.last.clear();
  }

  dispose(): void {
    this.blended.dispose();
    this.additive.dispose();
    this.standIn.dispose();
    if (this.drawn) this.drawn.dispose();
    this.drawn = null;
  }

  /**
   * One piece into its own kind's range of the ring, oldest first. A kind only ever overwrites its
   * own, which is what stops a firefight's scars from wiping out every footprint on the planet, and
   * a piece that was still showing when it was written over is counted as pushed out so that the
   * console can say the budget is too small rather than leaving it to be noticed.
   */
  private piece(kind: MarkName, cx: number, cy: number, cz: number, hl: number, hw: number, glow: number, life: number, owner: number, mirror: boolean): boolean {
    const r = this.ranges[GROUP_OF[kind]];
    const span = r.to - r.from;
    if (span <= 0) return false;
    const i = r.next;
    r.next = r.from + ((i - r.from + 1) % span);
    if (this.blended.alive(i, this.time)) r.pushedOut++;
    this.blended.write(i, cx, cy, cz, hl, hw, MARKS.lift, SLOT[kind], this.time, life, glow, owner, mirror);
    r.laid++;
    return true;
  }

  /** The hot rim over a fresh scar, in the additive mesh, on the frame and the tangent the scar used. */
  private rim(at: Vec3Like, size: number): void {
    const i = this.rimNext;
    this.rimNext = (i + 1) % this.additive.slots;
    const half = size / 2;
    // A little further off the surface than the scar, so the rim is never in a tie with it.
    this.additive.write(i, at.x, at.y, at.z, half, half, MARKS.lift * MARKS.rimLift, SLOT.rim, this.time, MARKS.rimLife, MARKS.rimLife, MARK_WORLD, false);
    this.rimLaid++;
  }

  /**
   * The hand-drawn sheet, fetched once and drawn into one texture both meshes read. Everything about
   * it fails soft: with no page at all (a node test) nothing is fetched, and a sheet that does not
   * arrive leaves the white stand-in in place, which the shader draws as a soft disc of the right
   * size and colour. Swapping a texture into a uniform builds no program, so this can land whenever
   * it lands.
   */
  private loadSheet(): void {
    if (typeof document === 'undefined' || typeof Image === 'undefined') return;
    this.sheetState = 'waiting';
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = SHEET_CELLS * SHEET_CELL_PX;
        canvas.height = SHEET_CELL_PX;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          this.sheetState = 'failed';
          return;
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const tex = new THREE.CanvasTexture(canvas);
        // Only the alpha is ever read, so the sheet is data and not a picture: no colour space, and
        // clamped, because a mark that wrapped would read its neighbour's cell at the seam.
        tex.colorSpace = THREE.NoColorSpace;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        tex.needsUpdate = true;
        this.drawn = tex;
        this.blended.setSheet(tex);
        this.additive.setSheet(tex);
        this.sheetState = 'drawn';
      } catch {
        this.sheetState = 'failed';
      }
    };
    img.onerror = () => {
      this.sheetState = 'failed';
    };
    img.src = SHEET_URL;
  }

  /**
   * What a tab that cannot see the marks reads instead: the three counts, how full each kind's own
   * range is, and what each of them has pushed out, which is the whole of the owner's check that a
   * firefight does not wipe out a walk. Console only, so it may allocate.
   */
  report(opts?: Record<string, unknown> | null): Record<string, unknown> {
    const refused: string[] = [];
    if (opts) tuneMarks(opts, refused);
    const r2 = (v: number) => Math.round(v * 1000) / 1000;
    const kinds: Record<string, unknown> = {};
    let kept = 0;
    let capacity = 0;
    for (const key of ['saber', 'scar', 'print'] as MarkGroup[]) {
      const range = this.ranges[key];
      const span = range.to - range.from;
      const live = this.blended.live(range.from, range.to, this.time);
      kept += live;
      capacity += span;
      kinds[key] = { kept: live, capacity: span, fill: r2(live / Math.max(1, span)), laid: range.laid, pushedOut: range.pushedOut };
    }
    const out: Record<string, unknown> = {
      now: r2(this.time),
      kinds,
      kept,
      capacity,
      fill: r2(kept / Math.max(1, capacity)),
      rims: { kept: this.additive.live(0, this.additive.slots, this.time), capacity: this.additive.slots, laid: this.rimLaid, drawn: this.additive.mesh.visible },
      owned: this.blended.owned + this.additive.owned,
      // How many times a `forget` has really had to walk the ring. A streaming pass that drops a
      // hundred colliders none of which was ever shot at raises it by nothing at all.
      scans: this.blended.scans + this.additive.scans,
      sheet: { state: this.sheetState, cells: SHEET_CELLS },
      // Measured, not a constant: a mesh with nothing showing in it is not drawn at all, so a page
      // where nobody has fired is one draw and often none. It counts 2 until the programs are built,
      // since a mesh hidden while the loading screen is up would compile on a live frame instead.
      draws: (this.blended.mesh.visible ? 1 : 0) + (this.additive.mesh.visible ? 1 : 0),
      drawsMax: 2,
      tune: { ...MARKS, share: { ...MARKS.share }, scarSize: { ...MARKS.scarSize }, colour: { ...MARKS.colour } },
      buildOnly: { pieces: capacity, rims: this.additive.slots, share: { ...MARKS.share } },
    };
    if (refused.length) out.refused = { keys: refused, why: 'spent when the marks were built; they take effect only on a new Marks' };
    return out;
  }

  /**
   * `__debug.marks()` reports and `__debug.marks({ scarLife: 60 })` retunes, hung here rather than
   * in the game's own console block so that nothing outside this file has to know what a mark is.
   * The three build-only numbers are refused by name and come back in `refused`.
   */
  private expose(): void {
    if (typeof window === 'undefined') return;
    const dbg = (window as unknown as { __debug?: Record<string, unknown> }).__debug;
    if (!dbg || dbg === this.exposedOn) return;
    this.exposedOn = dbg;
    dbg.marks = (o: Record<string, unknown> = {}) => this.report(o);
  }
}

/** The floors that keep the numbers finite: a zero life divides by zero and a zero width draws nothing. */
const FLOOR: Record<string, number> = {
  width: 0.001,
  glowLife: 0,
  life: 0.1,
  step: 0.0001,
  breakAt: 0.01,
  lift: 0,
  scarLife: 0.1,
  scarGlow: 0,
  rimSize: 0,
  rimLife: 0,
  fade: 0,
  edge: 0,
  scarWeight: 0,
  printWeight: 0,
  coolAlpha: 0,
  rimLift: 0,
};

/**
 * Move the tuning live, as `__debug.marks({ scarLife: 60 })` does. The three build-only names are
 * pushed into `refused` rather than written where nothing would read them again, and `scarSize` is
 * a table and is written family by family, the way the clash's style weights are.
 */
export function tuneMarks(opts?: Record<string, unknown> | null, refused?: string[]): MarksTune {
  if (!opts) return MARKS;
  for (const [k, v] of Object.entries(opts)) {
    if (k === 'scarSize' && v && typeof v === 'object') {
      for (const [family, size] of Object.entries(v as Record<string, unknown>)) {
        if (typeof size === 'number' && Number.isFinite(size) && family in MARKS.scarSize) MARKS.scarSize[family as ScarFamily] = Math.max(0.01, size);
      }
      continue;
    }
    if (k === 'colour' && v && typeof v === 'object') {
      // `__debug.marks({ colour: { scarHot: 0xff2010 } })`: one colour at a time, as the sizes are.
      for (const [name, hex] of Object.entries(v as Record<string, unknown>)) {
        if (typeof hex === 'number' && Number.isFinite(hex) && name in MARKS.colour) MARKS.colour[name as MarkColour] = Math.max(0, Math.min(0xffffff, Math.round(hex)));
      }
      continue;
    }
    if (!(k in MARKS)) continue;
    if (MARKS_BUILD_ONLY.indexOf(k) >= 0) {
      if (refused) refused.push(k);
      continue;
    }
    if (typeof v === 'number' && Number.isFinite(v)) (MARKS as unknown as Record<string, number>)[k] = Math.max(FLOOR[k] ?? 0, v);
  }
  if (MARKS.fade > 0.99) MARKS.fade = 0.99;
  // At 1 the edge fade is a smoothstep between one number and itself, which is a hard square edge.
  if (MARKS.edge > 0.99) MARKS.edge = 0.99;
  return MARKS;
}

/** The squared distance between two places, without making a vector to hold the difference. */
function sqDistance(a: Vec3Like, b: Vec3Like): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return dx * dx + dy * dy + dz * dz;
}

/** The surface's normal into the scratch, normalised; a zero normal is taken as straight up. */
function setNormal(n: Vec3Like): void {
  const len = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
  if (!(len > 1e-6)) {
    nx = 0;
    ny = 1;
    nz = 0;
    return;
  }
  nx = n.x / len;
  ny = n.y / len;
  nz = n.z / len;
}

/** Any direction in the surface at all, for a mark that does not care which way round it lies. */
function anyTangent(): void {
  // The same choice the saber's own stub has always made: x unless the normal is nearly along it.
  if (Math.abs(nx) > 0.9) alongFrom(0, 0, 1);
  else alongFrom(1, 0, 0);
}

/**
 * The mark's length axis: `(ax, ay, az)` flattened into the surface and made a unit vector, with the
 * width axis across it. A direction that lies along the normal leaves nothing to flatten, so it
 * falls back to a perpendicular of the normal's own.
 */
function alongFrom(ax: number, ay: number, az: number): void {
  const d = ax * nx + ay * ny + az * nz;
  let px = ax - nx * d;
  let py = ay - ny * d;
  let pz = az - nz * d;
  let len = Math.sqrt(px * px + py * py + pz * pz);
  if (!(len > 1e-6)) {
    // Straight at the surface: take any perpendicular of the normal rather than dividing by nothing.
    px = Math.abs(nx) > 0.9 ? 0 : 1;
    py = 0;
    pz = Math.abs(nx) > 0.9 ? 1 : 0;
    const dot = px * nx + py * ny + pz * nz;
    px -= nx * dot;
    py -= ny * dot;
    pz -= nz * dot;
    len = Math.sqrt(px * px + py * py + pz * pz);
    if (!(len > 1e-6)) {
      tx = 1;
      ty = 0;
      tz = 0;
      bx = 0;
      by = 0;
      bz = 1;
      return;
    }
  }
  tx = px / len;
  ty = py / len;
  tz = pz / len;
  bx = ny * tz - nz * ty;
  by = nz * tx - nx * tz;
  bz = nx * ty - ny * tx;
}

/**
 * The length axis taken exactly as it is given, with the width axis across it in the surface. It is
 * the saber stroke's own rule: the two contacts a stroke joins are the quad's two ends, so the step
 * between them is never flattened and the stroke never shortens over a corner.
 */
function alongDirect(ax: number, ay: number, az: number): void {
  const len = Math.sqrt(ax * ax + ay * ay + az * az);
  if (!(len > 1e-6)) {
    anyTangent();
    return;
  }
  tx = ax / len;
  ty = ay / len;
  tz = az / len;
  let cx = ny * tz - nz * ty;
  let cy = nz * tx - nx * tz;
  let cz = nx * ty - ny * tx;
  let cl = Math.sqrt(cx * cx + cy * cy + cz * cz);
  if (!(cl > 1e-5)) {
    // Straight along the normal: there is no across to be had, so take any perpendicular of it.
    const sx = Math.abs(nx) > 0.9 ? 0 : 1;
    const sz = Math.abs(nx) > 0.9 ? 1 : 0;
    cx = ny * sz - nz * 0;
    cy = nz * sx - nx * sz;
    cz = nx * 0 - ny * sx;
    cl = Math.sqrt(cx * cx + cy * cy + cz * cz);
    if (!(cl > 1e-6)) {
      bx = 0;
      by = 0;
      bz = 1;
      return;
    }
  }
  bx = cx / cl;
  by = cy / cl;
  bz = cz / cl;
}

/**
 * A colour of the tuning into the vector the shader reads it from, written in place so that moving
 * a colour from the console costs nothing and makes nothing. 0xRRGGBB straight through: the marks
 * are not tone mapped and nothing converts them, so the number typed is the pixel drawn.
 */
function hexInto(v: THREE.Vector3, hex: number): void {
  const n = Math.max(0, Math.min(0xffffff, Math.round(hex)));
  v.set(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** The one white texel every quad reads until the sheet has arrived: never null, so nothing ever binds nothing. */
function whitePixel(): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** The one set of marks, as `clashes` is the one set of clashes and `sabers` the one set of blade sounds. */
export const marks = new Marks();
