// The motion blur, as a reconstruction filter: every pixel's movement since the last frame is worked
// out, the fastest movement near each tile is found, and each pixel gathers colour along it with a
// depth test, so a sharp thing in front never smears into what is behind it and a moving thing
// smears past its own outline into what is still.
//
// Five draws a frame:
//   1. resolve: each pixel's blur radius in pixels, from one of two sources. Where a mover drew in the
//      velocity product, its velocity (the camera's movement and its own, already merged). Everywhere
//      else the camera's reprojection of the scene depth, weighted by a static cut: nothing nearer
//      than the far side of what the camera follows smears with the camera, so the ship flown stays
//      sharp however large it is and however far back the camera sits. In the race view and a flown
//      ship's chase (`masksFollowed`) what the camera follows is kept sharp by its own pixels instead:
//      the velocity product draws all of it, its riding parts at nought, and the cut shrinks to the
//      lens (`maskCut`), so the ground and the walls right beside the hull smear as the fastest things
//      on the screen; a frame whose mask has a hole in it keeps the cut. Last frame's view is taken
//      with this frame's projection, so zooming in to aim is not movement.
//   2-3. tile max: the longest radius in each K x K tile (K the largest radius), across then down. The
//      race view's K is its own, longer (`raceBlurRadiusPx`): the tile targets are sized once for the
//      smaller of the two and a frame draws into as much of them as its K needs.
//   4. neighbour max: the longest over each tile's 3x3 neighbourhood, which holds every movement that
//      can reach any pixel of the tile.
//   5. gather: 12 taps along the neighbourhood's movement and the pixel's own, each weighted by which
//      of the two is in front and how far each one's blur reaches.
// Strength, the shutter and the longest radius apply to both sources alike, after the choice; the race view
// takes its own three (`MOTION_TUNING.raceStrength`, `raceShutter`, `raceRadiusOfHeight`) and its own taps.
import { REVERSED_DEPTH } from '../depthMode.ts';
import * as THREE from 'three';
import type { FxProductId, FxSettings } from '../fxRegistry.ts';
import type { FxFrameContext } from './context';
// The value imports carry their extensions so a node test can build the pass itself (`motionMask.test.ts`).
import { createFxQuad, FX_CAMERA, NO_PRODUCTS, type FxDebugTexture, type FxPass, type FxWarmItem } from './pass.ts';
import { FX_FULLSCREEN_VERTEX, FX_IGN, FX_LINEARIZE } from './glsl.ts';
import { MAX_TILE_K, MOTION_TUNING, blurRadiusFor, blurScale, clamp, maskCut, maxBlurRadiusPx, raceBlurRadiusPx, staticCut } from './velocityMath.ts';
import { followFarOf, followViewOf, prevProjViewOf, type VelocityProduct } from './velocity.ts';

/** The products the pass reads when moving things smear too. */
const VELOCITY_NEEDS: readonly FxProductId[] = ['velocity'];

/**
 * The debug view's channel for a radius field: hue by direction, brightness by length, lightened where
 * a mover drew (alpha) unless `scale` is 0, which marks a field with no alpha of its own. Until the view
 * knows it, it shows the x radius as grey at `scale`.
 */
export const MOTION_CHANNEL = 'motion' as unknown as FxDebugTexture['channels'];

const RESOLVE_FRAG = /* glsl */ `
uniform sampler2D tVelocity;
uniform highp sampler2D tDepth;
uniform mat4 uInvViewProj;
uniform mat4 uPrevProjView;   // this frame's projection x last frame's view
uniform vec2 uNearFar;
uniform vec2 uCut;
uniform vec2 uSize;
uniform float uScale;
uniform float uMaxRadius;
uniform float uObjects;
varying vec2 vUv;
${FX_LINEARIZE}
void main() {
  ivec2 p = ivec2( gl_FragCoord.xy );
  float d = texelFetch( tDepth, p, 0 ).x;
  float z = fxViewZ( d, uNearFar.x, uNearFar.y );
  vec4 obj = uObjects > 0.5 ? texelFetch( tVelocity, p, 0 ) : vec4( 0.0 );
  vec2 v;
  if ( obj.b > 0.5 ) {
    v = obj.rg;                 // a mover: camera and own motion already combined
  } else {
    vec4 wp = uInvViewProj * vec4( vUv * 2.0 - 1.0, ${REVERSED_DEPTH ? 'd' : 'd * 2.0 - 1.0'}, 1.0 );
    vec4 pr = uPrevProjView * vec4( wp.xyz / wp.w, 1.0 );
    v = pr.w > 1e-4 ? ( vUv - ( pr.xy / pr.w * 0.5 + 0.5 ) ) * smoothstep( uCut.x, uCut.y, z ) : vec2( 0.0 );
  }
  vec2 r = v * uSize * ( 0.5 * uScale );   // uv per frame to a radius in pixels either side
  float len = length( r );
  if ( len > uMaxRadius ) r *= uMaxRadius / len;
  if ( any( isnan( r ) ) || any( isinf( r ) ) ) r = vec2( 0.0 );
  gl_FragColor = vec4( r, z, obj.b );
}
`;

const TILE_FRAG = /* glsl */ `
uniform sampler2D tIn;
uniform int uK;
uniform int uAxis;
void main() {
  ivec2 o = ivec2( gl_FragCoord.xy );
  ivec2 size = textureSize( tIn, 0 );
  ivec2 stepv = uAxis == 0 ? ivec2( 1, 0 ) : ivec2( 0, 1 );
  ivec2 base = uAxis == 0 ? ivec2( o.x * uK, o.y ) : ivec2( o.x, o.y * uK );
  vec2 best = vec2( 0.0 );
  float bestLen = -1.0;
  for ( int i = 0; i < ${MAX_TILE_K}; i++ ) {   // K <= ${MAX_TILE_K} (maxBlurRadiusPx and raceBlurRadiusPx clamp)
    if ( i >= uK ) break;
    vec2 v = texelFetch( tIn, min( base + stepv * i, size - 1 ), 0 ).xy;
    float l = dot( v, v );
    if ( l > bestLen ) { bestLen = l; best = v; }
  }
  gl_FragColor = vec4( best, 0.0, 0.0 );
}
`;

const NEIGHBOUR_FRAG = /* glsl */ `
uniform sampler2D tTiles;
uniform vec2 uTiles;            // the tiles this frame's K made: the target may be larger
void main() {
  ivec2 o = ivec2( gl_FragCoord.xy );
  ivec2 size = ivec2( uTiles );
  vec2 best = texelFetch( tTiles, o, 0 ).xy;
  float bestLen = dot( best, best );
  for ( int y = -1; y <= 1; y++ ) for ( int x = -1; x <= 1; x++ ) {
    if ( x == 0 && y == 0 ) continue;
    vec2 v = texelFetch( tTiles, clamp( o + ivec2( x, y ), ivec2( 0 ), size - 1 ), 0 ).xy;
    // A diagonal tile's blur reaches this tile only along its line of motion, either way (the gather
    // spreads both ways); a motion across the diagonal would spill its corner halo a tile too far.
    if ( x != 0 && y != 0 && abs( dot( normalize( v + 1e-6 ), normalize( vec2( x, y ) ) ) ) < 0.7 ) continue;
    float l = dot( v, v );
    if ( l > bestLen ) { bestLen = l; best = v; }
  }
  gl_FragColor = vec4( best, 0.0, 0.0 );
}
`;

const GATHER_FRAG = /* glsl */ `
uniform sampler2D tColor;       // chain input (Linear)
uniform sampler2D tField;       // Nearest
uniform sampler2D tNeighbours;  // Nearest
uniform float uK;
uniform vec2 uTiles;            // the tiles this frame's K made: the target may be larger
uniform vec2 uTexel;
uniform int uSamples;
varying vec2 vUv;
${FX_IGN}
float cone( float d, float r ) { return clamp( 1.0 - d / max( r, 1e-3 ), 0.0, 1.0 ); }
float cylinder( float d, float r ) { float q = max( r, 1e-3 ); return 1.0 - smoothstep( 0.95 * q, 1.05 * q, d ); }
// 1 when depth a is in front of b; fades over 5 cm, or 2% of b's depth, whichever is larger.
float inFront( float za, float zb ) { return clamp( 1.0 - ( za - zb ) / max( 0.05, 0.02 * zb ), 0.0, 1.0 ); }
void main() {
  float noise = fxIgn( gl_FragCoord.xy );
  ivec2 tsize = ivec2( uTiles );
  vec2 tile = gl_FragCoord.xy / uK + ( noise - 0.5 ) * 0.5;   // a jittered lookup hides the tile edges
  vec2 vN = texelFetch( tNeighbours, clamp( ivec2( tile ), ivec2( 0 ), tsize - 1 ), 0 ).xy;
  vec4 cX = textureLod( tColor, vUv, 0.0 );
  if ( dot( vN, vN ) < 0.25 ) { gl_FragColor = cX; return; }  // nothing within reach moves half a pixel
  vec4 X = textureLod( tField, vUv, 0.0 );
  float rX = max( length( X.xy ), 0.5 );
  float wsum = 1.0 / rX;
  vec3 sum = cX.rgb * wsum;
  vec2 dirX = length( X.xy ) > 0.5 ? X.xy : vN;
  for ( int i = 0; i < 32; i++ ) {
    if ( i >= uSamples ) break;
    float t = mix( -1.0, 1.0, ( float( i ) + noise ) / float( uSamples ) );
    vec2 off = ( ( i & 1 ) == 0 ? vN : dirX ) * t;               // half the taps along the neighbourhood's motion, half along the pixel's own
    vec2 uv = vUv + off * uTexel;
    vec4 Y = textureLod( tField, uv, 0.0 );                       // textureLod in loops: D3D warns about implicit derivatives
    float d = length( off );
    float rY = length( Y.xy );
    float a = inFront( Y.z, X.z ) * cone( d, rY )                // a blurred thing in front reaches X as far as its own radius
            + inFront( X.z, Y.z ) * cone( d, rX )                // what is behind X shows only as far as X's own radius
            + cylinder( d, rY ) * cylinder( d, rX ) * 2.0;       // two blurred pixels at similar depth mix where both reach
    sum += a * textureLod( tColor, uv, 0.0 ).rgb;
    wsum += a;
  }
  vec3 c = sum / max( wsum, 1e-4 );
  if ( any( isnan( c ) ) || any( isinf( c ) ) ) c = cX.rgb;      // never hand bloom a NaN: it becomes a black box
  gl_FragColor = vec4( c, cX.a );
}
`;

function makeMaterial(fragmentShader: string, uniforms: Record<string, THREE.IUniform>, name: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name,
    uniforms,
    vertexShader: FX_FULLSCREEN_VERTEX,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  });
}

function makeTarget(format: THREE.PixelFormat, name: string): THREE.WebGLRenderTarget {
  const rt = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    format,
    depthBuffer: false,
    stencilBuffer: false,
    samples: 0,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
  });
  rt.texture.name = name;
  return rt;
}

export class MotionBlurPass implements FxPass {
  readonly id = 'motionBlur' as const;
  readonly timerLabel = 'pass:motionBlur';
  /** Set by installEffects when the velocity product is registered; without it the pass asks for no product (the runner turns off a pass whose product is missing). */
  objects = false;
  /** Resolved per-pixel blur: rg radius in pixels (clamped), b view depth (m), a 1 where a mover drew. RGBA16F, full size, Nearest. */
  readonly field: THREE.WebGLRenderTarget;
  /** Longest radius per tile along x (ceil(w/K) x h), then per tile (ceil(w/K) x ceil(h/K)), then over 3x3 tiles. RG16F, Nearest. */
  readonly tilesX: THREE.WebGLRenderTarget;
  readonly tiles: THREE.WebGLRenderTarget;
  readonly neighbours: THREE.WebGLRenderTarget;
  /** The static cut the last drawn frame used (view depth, m): what the camera follows and nearer stays sharp. */
  readonly lastCut = new THREE.Vector2(25, 60);
  /** The last drawn frame kept what the camera follows sharp by its own pixels (the mask) rather than by the cut. */
  lastMasked = false;
  /** The velocity product, set by installEffects with it: asked whether what the camera follows is a whole mask this frame. */
  velocity: VelocityProduct | null = null;

  private readonly resolveU: Record<string, THREE.IUniform>;
  private readonly tileXU: Record<string, THREE.IUniform>;
  private readonly tileYU: Record<string, THREE.IUniform>;
  private readonly neighbourU: Record<string, THREE.IUniform>;
  private readonly gatherU: Record<string, THREE.IUniform>;
  private readonly all: THREE.ShaderMaterial[];
  private readonly resolveQuad: THREE.Mesh;
  private readonly tileXQuad: THREE.Mesh;
  private readonly tileYQuad: THREE.Mesh;
  private readonly neighbourQuad: THREE.Mesh;
  private readonly gatherQuad: THREE.Mesh;
  /** A kept 1x1 zero texture for the velocity sampler when there is no product: never a null sampler near a shared depth. */
  private readonly placeholder: THREE.DataTexture;
  private readonly debugList: FxDebugTexture[];
  private readonly probeBuf = new Uint16Array(4);
  private width = 1;
  private height = 1;
  /** The K this frame draws with. */
  private k = 8;
  /** Every other view's K and the race view's, as the tiles were last sized for them (the smaller sizes the targets). */
  private kNormal = 8;
  private kRace = 8;

  constructor() {
    this.field = makeTarget(THREE.RGBAFormat, 'fx.motionBlur.field');
    this.tilesX = makeTarget(THREE.RGFormat, 'fx.motionBlur.tilesX');
    this.tiles = makeTarget(THREE.RGFormat, 'fx.motionBlur.tiles');
    this.neighbours = makeTarget(THREE.RGFormat, 'fx.motionBlur.neighbours');
    this.placeholder = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.placeholder.needsUpdate = true;
    this.placeholder.name = 'fx.motionBlur.noVelocity';
    this.resolveU = {
      tVelocity: { value: this.placeholder },
      tDepth: { value: null },
      uInvViewProj: { value: new THREE.Matrix4() },
      uPrevProjView: { value: new THREE.Matrix4() },
      uNearFar: { value: new THREE.Vector2(0.05, 9000) },
      uCut: { value: new THREE.Vector2(25, 60) },
      uSize: { value: new THREE.Vector2(1, 1) },
      uScale: { value: 0.35 },
      uMaxRadius: { value: 36 },
      uObjects: { value: 0 },
    };
    this.tileXU = { tIn: { value: this.field.texture }, uK: { value: 8 }, uAxis: { value: 0 } };
    this.tileYU = { tIn: { value: this.tilesX.texture }, uK: { value: 8 }, uAxis: { value: 1 } };
    this.neighbourU = { tTiles: { value: this.tiles.texture }, uTiles: { value: new THREE.Vector2(1, 1) } };
    this.gatherU = {
      tColor: { value: null },
      tField: { value: this.field.texture },
      tNeighbours: { value: this.neighbours.texture },
      uK: { value: 8 },
      uTiles: { value: new THREE.Vector2(1, 1) },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uSamples: { value: MOTION_TUNING.samples },
    };
    const resolve = makeMaterial(RESOLVE_FRAG, this.resolveU, 'fx.motionBlur.resolve');
    // The two tile draws share one program: only their uniforms differ.
    const tileX = makeMaterial(TILE_FRAG, this.tileXU, 'fx.motionBlur.tileX');
    const tileY = makeMaterial(TILE_FRAG, this.tileYU, 'fx.motionBlur.tileY');
    const neighbour = makeMaterial(NEIGHBOUR_FRAG, this.neighbourU, 'fx.motionBlur.neighbour');
    const gather = makeMaterial(GATHER_FRAG, this.gatherU, 'fx.motionBlur.gather');
    this.all = [resolve, tileX, tileY, neighbour, gather];
    this.resolveQuad = createFxQuad(resolve);
    this.tileXQuad = createFxQuad(tileX);
    this.tileYQuad = createFxQuad(tileY);
    this.neighbourQuad = createFxQuad(neighbour);
    this.gatherQuad = createFxQuad(gather);
    this.debugList = [
      { name: 'field', texture: this.field.texture, channels: MOTION_CHANNEL, scale: 1 / 32 },
      // Scale 0 tells the view this field has no mover channel: an RG target reads alpha 1 everywhere.
      { name: 'tiles', texture: this.neighbours.texture, channels: MOTION_CHANNEL, scale: 0 },
    ];
  }

  enabled(ctx: FxFrameContext): boolean {
    return ctx.settings.motionBlurStrength > 0 && !ctx.cameraCut;
  }

  reason(ctx: FxFrameContext): string | null {
    if (ctx.settings.motionBlurStrength <= 0) return 'strength 0';
    if (ctx.cameraCut) return 'camera cut';
    return null;
  }

  needs(ctx: FxFrameContext): readonly FxProductId[] {
    return this.objects && ctx.settings.motionBlurObjects ? VELOCITY_NEEDS : NO_PRODUCTS;
  }

  prepare(ctx: FxFrameContext): void {
    const u = this.resolveU;
    u.tDepth.value = ctx.depth;
    // Null when nothing asked for it or nothing moved on its own this frame.
    const vel = ctx.products.velocity;
    u.tVelocity.value = vel ?? this.placeholder;
    u.uObjects.value = vel ? 1 : 0;
    (u.uInvViewProj.value as THREE.Matrix4).copy(ctx.invViewProj);
    (u.uPrevProjView.value as THREE.Matrix4).copy(prevProjViewOf(ctx));
    (u.uNearFar.value as THREE.Vector2).set(ctx.near, ctx.far);
    // What the camera follows: its own pixels where the velocity product drew all of it this frame (the mask), with the
    // cut shrunk to the lens; else pushed past its far side, with or without object blur.
    this.lastMasked = !!vel && !!this.velocity?.maskedOn(ctx.frame);
    if (this.lastMasked) maskCut(u.uCut.value as THREE.Vector2);
    else staticCut(followFarOf(ctx), u.uCut.value as THREE.Vector2);
    this.lastCut.copy(u.uCut.value as THREE.Vector2);
    // The race view's own shutter, strength (times the setting's), longest smear and taps; every other view the game's.
    const view = followViewOf(ctx);
    const race = view === 'race';
    u.uScale.value = blurScale(view, ctx.settings.motionBlurStrength, ctx.dt);
    (u.uSize.value as THREE.Vector2).set(ctx.width, ctx.height);
    // A radius moved by the console or a dial sizes the tiles again here, on the frame it moved, never otherwise.
    if (maxBlurRadiusPx(this.height) !== this.kNormal || raceBlurRadiusPx(this.height) !== this.kRace) this.resizeTiles();
    this.useK(blurRadiusFor(view, this.height));
    u.uMaxRadius.value = this.k;
    this.gatherU.uSamples.value = clamp(Math.round(race ? MOTION_TUNING.raceSamples : MOTION_TUNING.samples), 1, 32);
  }

  render(ctx: FxFrameContext, input: THREE.WebGLRenderTarget, output: THREE.WebGLRenderTarget | null): boolean {
    const r = ctx.renderer;
    r.setRenderTarget(this.field);
    r.render(this.resolveQuad, FX_CAMERA);
    r.setRenderTarget(this.tilesX);
    r.render(this.tileXQuad, FX_CAMERA);
    r.setRenderTarget(this.tiles);
    r.render(this.tileYQuad, FX_CAMERA);
    r.setRenderTarget(this.neighbours);
    r.render(this.neighbourQuad, FX_CAMERA);
    this.gatherU.tColor.value = input.texture;
    r.setRenderTarget(output);
    r.render(this.gatherQuad, FX_CAMERA);
    return true;
  }

  setSize(width: number, height: number, _settings: FxSettings): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.field.setSize(this.width, this.height);
    (this.gatherU.uTexel.value as THREE.Vector2).set(1 / this.width, 1 / this.height);
    this.resizeTiles();
  }

  /**
   * K = maxBlurRadiusPx(height), and the race view's raceBlurRadiusPx(height), from MOTION_TUNING: only the three tile
   * targets change size, sized for the smaller K (the more tiles), so either view draws into them with no new storage.
   */
  resizeTiles(): void {
    this.kNormal = maxBlurRadiusPx(this.height);
    this.kRace = raceBlurRadiusPx(this.height);
    const k = Math.min(this.kNormal, this.kRace);
    const tw = Math.ceil(this.width / k);
    const th = Math.ceil(this.height / k);
    this.tilesX.setSize(tw, this.height);
    this.tiles.setSize(tw, th);
    this.neighbours.setSize(tw, th);
    // A resize puts each target's viewport back to the whole of it: the next useK writes them again.
    this.k = 0;
    this.useK(this.kNormal);
    this.resolveU.uMaxRadius.value = this.k;
  }

  /**
   * Draw with tiles of `k`: the tile targets' viewports cut to the tiles it makes and the passes told how many there are.
   * Writes only when K changes (entering or leaving the race view), and allocates nothing.
   */
  private useK(k: number): void {
    if (k === this.k) return;
    this.k = k;
    const tw = Math.ceil(this.width / k);
    const th = Math.ceil(this.height / k);
    this.tilesX.viewport.set(0, 0, tw, this.height);
    this.tiles.viewport.set(0, 0, tw, th);
    this.neighbours.viewport.set(0, 0, tw, th);
    this.tileXU.uK.value = k;
    this.tileYU.uK.value = k;
    this.gatherU.uK.value = k;
    (this.neighbourU.uTiles.value as THREE.Vector2).set(tw, th);
    (this.gatherU.uTiles.value as THREE.Vector2).set(tw, th);
  }

  /** The tile size, which is also the longest radius either side of a pixel. */
  get tileSize(): number {
    return this.k;
  }

  materials(): FxWarmItem[] {
    return this.all.map((material) => ({ material, where: 'target' as const }));
  }

  debugTextures(): readonly FxDebugTexture[] {
    return this.debugList;
  }

  /**
   * The resolved field at a pixel of the drawing buffer, counted from the top left, as the last frame
   * drew it: the radius either side in pixels, the view depth, and whether a mover drew there. A
   * synchronous read, for the console only.
   */
  readField(renderer: THREE.WebGLRenderer, x: number, y: number): { radiusPx: [number, number]; viewZ: number; mover: boolean } | null {
    const px = Math.max(0, Math.min(this.width - 1, Math.floor(x)));
    const py = Math.max(0, Math.min(this.height - 1, Math.floor(y)));
    const buf = this.probeBuf;
    buf.fill(0);
    try {
      // Read-back rows run from the bottom; the screen counts from the top.
      renderer.readRenderTargetPixels(this.field, px, this.height - 1 - py, 1, 1, buf);
    } catch {
      return null;
    }
    const h = THREE.DataUtils.fromHalfFloat;
    const round = (v: number) => Math.round(v * 100) / 100;
    return { radiusPx: [round(h(buf[0])), round(h(buf[1]))], viewZ: round(h(buf[2])), mover: h(buf[3]) > 0.5 };
  }

  dispose(): void {
    this.field.dispose();
    this.tilesX.dispose();
    this.tiles.dispose();
    this.neighbours.dispose();
    this.placeholder.dispose();
    for (const m of this.all) m.dispose();
  }
}
