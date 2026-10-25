// The grass leaning in the moving air (the volumetrics' sixth wave, the design's §14): a twin of the grass's one session
// material, and of its depth material, whose near tufts read slab 0 of the air's atlas at their foot and lean by the
// demo's wheat (`land.html`: `clamp(|v| / 13, 0, 0.85)`, the top sinking by 0.45 of that at its tip), times the page's
// `volArtGrass`, laid on the trees' own sway and never in place of it (decision 80: no gust of its own, the air it
// leans by carries the gusts already). A far card never leans here: it is a tree's card, and the seventh wave lays the
// far grass's and the far cards' lean outside the window.
//
// **The twin is the plain grass's own text with two lines made in, all of them or none** (`grassAirText`): the reads
// before `void main() {` and one line after the sway, so the plain material's text, its depth material's and their
// program keys never move, and a twin whose base text has moved is not made at all. Its key is its own (a define and
// a name), its every uniform object the plain material's by reference, and the session's own record beside them.
//
// **One session record** (`GRASS_AIR_U`) is what both twins read, written by the field the world has taken at the end
// of every frame (`AirField.writeGrass`), and by nothing else, so a field made and thrown away (the in-play warm's) can
// never be what the grass reads; with no field, or the master off, its art share is nought and the twin draws exactly
// the plain grass by its own uniform branch.
//
// **The chooser** (`grassWearsAir`) wears the twin only once its program is built, and, while the grass casts (the
// Flora page's grass or far cards casting), only once a loading screen has drawn the twin's depth program: a custom depth
// material's program comes only from a shadow pass's draw, which no compile can make, and a screen is where the world
// draws one (`World.compileShadowDepth`). Turned on in play with casting on, the grass stays plain until the next arrival.
//
// W7a: the unified wind's lean outside the air's window, and the sheen of a bent stalk, are laid into `swgAirLean` below,
// in this one place.
//
// Nothing here is made on a frame: the materials with the world, their numbers in kept vectors.
import * as THREE from 'three';
import { AIR_TUNE } from './airTune.ts';

/** The record both twins hold by reference. */
export interface GrassAirUniforms {
  /** The air's velocity atlas as it stands (slab 0 is one of its tiles). */
  uAirGrassVel: { value: THREE.Texture | null };
  /** The air window's corner x and z, its size (metres), and its edge band's share, across which the lean fades out. */
  uAirGrassWin: { value: THREE.Vector4 };
  /** Slab 0's rectangle in the atlas's uv (x, y, w, h). */
  uAirGrassRect: { value: THREE.Vector4 };
  /** Half a texel of the atlas, x and y: every read clamped that far inside the tile. */
  uAirGrassHalf: { value: THREE.Vector2 };
  /** x how far the air bends the grass (`volArtGrass`; nought, the plain grass), y the speed of a full lean (m/s), z the most it leans, w how far the top sinks with it. */
  uAirGrassP: { value: THREE.Vector4 };
}

/** A fresh record: every number a double from its first write, the share nought (the twin draws the plain grass). */
export function makeGrassAirUniforms(): GrassAirUniforms {
  const u: GrassAirUniforms = {
    uAirGrassVel: { value: null },
    uAirGrassWin: { value: new THREE.Vector4(0.5, 0.5, 192, AIR_TUNE.window.edge) },
    uAirGrassRect: { value: new THREE.Vector4(0.5, 0.5, 0.5, 0.5) },
    uAirGrassHalf: { value: new THREE.Vector2(0.5, 0.5) },
    uAirGrassP: { value: new THREE.Vector4(0.5, AIR_TUNE.grass.full, AIR_TUNE.grass.most, AIR_TUNE.grass.sink) },
  };
  grassAirOff(u);
  return u;
}

/** The record with nothing to read: the share nought and no texture (a field let go, the master off). */
export function grassAirOff(u: GrassAirUniforms): void {
  u.uAirGrassVel.value = null;
  u.uAirGrassP.value.x = 0;
}

/** The session's one record: the world's field writes it (`AirField.writeGrass`), both twins hold it by reference. */
export const GRASS_AIR_U: GrassAirUniforms = makeGrassAirUniforms();

/**
 * The twin's reads, made in before the grass's `main`: slab 0's air at a world point (the atlas read clamped half a texel
 * inside the slab's tile, as the liquid's), and the lean of a tuft standing at `base`, `lev` of the way up a quad of
 * height `h`, in world metres: along the air, `bend · h · lev²`, and down by `sink` of that (the wheat's own arithmetic),
 * `bend` the wheat's `clamp(|v| / full, 0, most)` times the art share times how far in from the window's edge band. Nought
 * by a uniform branch at a share of nought, nought outside the window, nought where the air reads nothing finite.
 */
export const GRASS_AIR_PARS = /* glsl */ `
// The volumetrics' sixth wave: the near grass leans in the moving air at its foot (airGrass.ts).
uniform sampler2D uAirGrassVel;
uniform vec4 uAirGrassWin;
uniform vec4 uAirGrassRect;
uniform vec2 uAirGrassHalf;
uniform vec4 uAirGrassP;
float swgAirGrassAtlas( float l, float origin, float size, float hf ) {
	return origin + clamp( l * size, hf, size - hf );
}
// How far in from the window's edge band a window place is, eased: nought at the edge, one a band's width inside.
float swgAirGrassEdge( float lx, float ly ) {
	float e = min( min( lx, 1.0 - lx ), min( ly, 1.0 - ly ) );
	float edge = clamp( e / max( uAirGrassWin.w, 1e-4 ), 0.0, 1.0 );
	return edge * edge * ( 3.0 - 2.0 * edge );
}
// The wheat's lean for air of speed sp: clamp(sp / full, 0, most), times the art share and the edge's ease.
float swgAirGrassBend( float sp, float edge ) {
	return clamp( sp / max( uAirGrassP.y, 1e-3 ), 0.0, uAirGrassP.z ) * uAirGrassP.x * edge;
}
// How far over a point of the tuft goes, metres: its height fraction squared, the tuft's height, the bend.
float swgAirGrassReach( float lev, float h, float bend ) {
	return lev * lev * h * bend;
}
// Written by its components (no vector arithmetic but the swizzles), so the test runs this very function as script.
vec3 swgAirLean( vec3 base, float lev, float h ) {
	if ( uAirGrassP.x <= 0.0 ) return vec3( 0.0 );
	vec2 l = vec2( ( base.x - uAirGrassWin.x ) / uAirGrassWin.z, ( base.z - uAirGrassWin.y ) / uAirGrassWin.z );
	if ( l.x < 0.0 || l.y < 0.0 || l.x > 1.0 || l.y > 1.0 ) return vec3( 0.0 );
	float edge = swgAirGrassEdge( l.x, l.y );
	vec2 a = vec2( swgAirGrassAtlas( l.x, uAirGrassRect.x, uAirGrassRect.z, uAirGrassHalf.x ), swgAirGrassAtlas( l.y, uAirGrassRect.y, uAirGrassRect.w, uAirGrassHalf.y ) );
	vec2 v = texture2D( uAirGrassVel, a ).xy;
	if ( any( isnan( v ) ) || any( isinf( v ) ) ) return vec3( 0.0 );
	float sp = length( v );
	if ( sp < 1e-3 ) return vec3( 0.0 );
	float k = swgAirGrassReach( lev, h, swgAirGrassBend( sp, edge ) );
	// W7a: the unified wind's lean outside the window (faded in across the edge band as this fades out) and the sheen go here.
	return vec3( v.x / sp * k, - uAirGrassP.w * k, v.y / sp * k );
}
`;

/** Where the reads go: before the grass's own `main`, which the text holds exactly once. */
const MAIN_FROM = 'void main() {';
const MAIN_TO = `${GRASS_AIR_PARS}\nvoid main() {`;
/** The lean, laid on straight after the trees' sway (a near tuft only: a far card is a tree's). */
const SWAY_FROM = 'swgP += swgSwayOffset( vec3( 0.0, position.y * swgH, 0.0 ), swgModel ) * swgScale;';
const SWAY_TO = 'swgP += swgSwayOffset( vec3( 0.0, position.y * swgH, 0.0 ), swgModel ) * swgScale;\n\tif ( ! swgFar ) swgP += swgAirLean( swgBase, position.y, aSwgSize.y * swgScale );';

/** The twin's replacements in the order they are made, each `[from, to]` (the tests undo them on the twin's text and must find the base's own). */
export const GRASS_AIR_EDITS: readonly (readonly [string, string])[] = [
  [MAIN_FROM, MAIN_TO],
  [SWAY_FROM, SWAY_TO],
];

/** `text` with `from` replaced by `to`, or null where `from` is not found exactly once. */
function replaceOnce(text: string, from: string, to: string): string | null {
  const i = text.indexOf(from);
  if (i < 0 || text.indexOf(from, i + from.length) >= 0) return null;
  return text.slice(0, i) + to + text.slice(i + from.length);
}

/** The twin's vertex text from the base's own, every replacement made or none (null). */
export function grassAirText(vertex: string): string | null {
  let v: string | null = vertex;
  for (const [from, to] of GRASS_AIR_EDITS) if (v) v = replaceOnce(v, from, to);
  return v;
}

/** The define the twins carry, which is also their key's own. */
export const GRASS_AIR_DEFINE = 'SWG_GRASS_AIR';

/**
 * A twin of one of the grass's two materials (`grassMaterial` or `grassDepthMaterial`): the base's own text with the lean
 * made in (all of it or none: null where the base's text has moved), its every uniform object shared with the base by
 * reference and the session record's beside them, its defines with one more, and every flag that is in three's key the
 * base's own. Nothing is compiled here.
 */
export function grassAirTwin(base: THREE.ShaderMaterial, u: GrassAirUniforms = GRASS_AIR_U): THREE.ShaderMaterial | null {
  const vertex = grassAirText(base.vertexShader);
  if (!vertex) return null;
  const twin = new THREE.ShaderMaterial({
    name: `${base.name}+air`,
    vertexShader: vertex,
    fragmentShader: base.fragmentShader,
    uniforms: { ...base.uniforms, ...u },
    defines: { ...base.defines, [GRASS_AIR_DEFINE]: '' },
    fog: base.fog,
    lights: false,
    transparent: base.transparent,
    depthWrite: base.depthWrite,
    side: base.side,
  });
  twin.toneMapped = base.toneMapped;
  twin.shadowSide = base.shadowSide;
  twin.userData = { ...base.userData, air: true };
  return twin;
}

/** What the grass's chooser is asked (the ground's and the liquids' shape). */
export interface GrassChoice {
  /** The master. */
  on: boolean;
  /** `volGrass`. */
  grass: boolean;
  /** A field the world holds and the machine can run. */
  field: boolean;
  /** The frame report's soft off: the grass back on its plain material. */
  softOff: boolean;
  /** The twin's colour program built for the frames' own target (a sweep's, or the master's in-play warm's). */
  built: boolean;
  /** The grass or the far cards cast (the Flora page's switches). */
  casting: boolean;
  /** A loading screen has drawn the twin's depth program into the shadow maps this session. */
  depthDrawn: boolean;
}

/** A fresh record. */
export function newGrassChoice(): GrassChoice {
  return { on: false, grass: true, field: false, softOff: false, built: false, casting: false, depthDrawn: false };
}

/**
 * Whether the grass wears its twin (class M): the master, the switch and a field, no soft off, the twin built, and while
 * the grass casts its depth program drawn by a screen.
 */
export function grassWearsAir(c: GrassChoice): boolean {
  return c.on && c.grass && c.field && !c.softOff && c.built && (!c.casting || c.depthDrawn);
}

/** Whether the twin is wanted and waits for the next arrival to draw its depth program (what the page says beside the switch). */
export function grassWaitsForScreen(c: GrassChoice): boolean {
  return c.on && c.grass && c.field && !c.softOff && c.casting && !c.depthDrawn;
}

/** The grass material a mesh wears: the plain one whenever the master is off, by identity. */
export function grassMaterialFor<M>(c: GrassChoice, plain: M, twin: M | null): M {
  return twin !== null && grassWearsAir(c) ? twin : plain;
}

/** The lean asked on the CPU: the tuft's foot in window uv, the air there, how high up the quad and its height, the record's numbers; the answer in `x`, `y`, `z`. */
export interface GrassLean {
  lx: number;
  ly: number;
  vx: number;
  vz: number;
  lev: number;
  h: number;
  share: number;
  full: number;
  most: number;
  sink: number;
  edgeBand: number;
  x: number;
  y: number;
  z: number;
}

/** A fresh record, every field a double from its first write. */
export function newGrassLean(): GrassLean {
  return { lx: 0.5, ly: 0.5, vx: 0.5, vz: 0.5, lev: 0.5, h: 0.5, share: 0.5, full: AIR_TUNE.grass.full, most: AIR_TUNE.grass.most, sink: AIR_TUNE.grass.sink, edgeBand: AIR_TUNE.window.edge, x: 0.5, y: 0.5, z: 0.5 };
}

/** `swgAirGrassEdge` on the CPU: how far in from the edge band `edgeBand` (a share of the window) a window place is, eased. */
export function grassEdgeMirror(lx: number, ly: number, edgeBand: number): number {
  const e = Math.min(Math.min(lx, 1 - lx), Math.min(ly, 1 - ly));
  let edge = e / Math.max(edgeBand, 1e-4);
  edge = edge < 0 ? 0 : edge > 1 ? 1 : edge;
  return edge * edge * (3 - 2 * edge);
}

/** `swgAirGrassBend` on the CPU: the wheat's lean at speed `sp`, times the share and the edge. */
export function grassBendMirror(sp: number, edge: number, share: number, full: number, most: number): number {
  let bend = sp / Math.max(full, 1e-3);
  bend = bend < 0 ? 0 : bend > most ? most : bend;
  return bend * share * edge;
}

/** `swgAirLean` line for line on the CPU (the tests' mirror), the air already read at the foot: the lean into `r.x`, `r.y`, `r.z`. */
export function grassLeanIn(r: GrassLean): void {
  r.x = 0;
  r.y = 0;
  r.z = 0;
  if (!(r.share > 0)) return;
  const lx = r.lx;
  const ly = r.ly;
  if (lx < 0 || ly < 0 || lx > 1 || ly > 1) return;
  const edge = grassEdgeMirror(lx, ly, r.edgeBand);
  if (!Number.isFinite(r.vx) || !Number.isFinite(r.vz)) return;
  const sp = Math.sqrt(r.vx * r.vx + r.vz * r.vz);
  if (sp < 1e-3) return;
  const k = r.lev * r.lev * r.h * grassBendMirror(sp, edge, r.share, r.full, r.most);
  r.x = (r.vx / sp) * k;
  r.y = -r.sink * k;
  r.z = (r.vz / sp) * k;
}
