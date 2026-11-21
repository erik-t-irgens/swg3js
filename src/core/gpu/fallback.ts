// The one fallback for what three's WebGPU renderer cannot draw (the GPU port's step 3), on the WebGPU renderer alone.
//
// Three turns a classic material into a node material at one place, `renderer.library.fromMaterial` (called by the node
// builder each time it builds a pipeline): it copies the material's fields onto a new node material of the matching class,
// and has no class for a `ShaderMaterial`, a `RawShaderMaterial`, a `MeshDepthMaterial` or a `MeshDistanceMaterial`. That
// place is wrapped here: a material whose site registered a stand-in (`userData.gpuStandIn`, a function returning a node
// material) gets the stand-in, made once and kept; any other material three has no class for gets one that draws nothing.
// And the draw itself is stepped over for a material three cannot draw that has no stand-in (`renderObject`, the public
// method both a frame and `compileAsync` call each object through), so it builds no pipeline and costs no draw.
//
// A stand-in is only the node graph: the pipeline's state (blending, depth, side, the stencil and its reference) is still
// read off the original material by the backend, so a stand-in for a portal-registered material tests the stencil exactly
// as the original would. Its uniforms are explicit nodes of its own, never a material reference (those read the original,
// which carries no `color` or `roughness` of three's), and it reads the site's live objects so it follows them.
//
// Every one is counted by name: met (unsupported, no stand-in), and drawn with a stand-in.

import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import { float, vec4 } from 'three/tsl';
import { adoptMotion } from './motion.ts';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface FallbackStats {
  /** Materials three has no node class for and that registered no stand-in, by name: how many such materials were met. */
  readonly unsupported: Map<string, number>;
  /** Stand-ins made, by the name of the material they stand in for. */
  readonly standIns: Map<string, number>;
  /** Draws stepped over this frame (zeroed by the frame's counter). */
  skippedDraws: number;
}

/** Whether three's node library has no class for this material (checked by flags, never a map lookup a draw). */
function unsupported(m: Any): boolean {
  return m.isShaderMaterial === true || m.isMeshDepthMaterial === true || m.isMeshDistanceMaterial === true;
}

/**
 * The name a material is counted under: its own, else its type with what draws it -- the nearest named object of the
 * three it hangs under, else its first three uniforms' names with the object's kind and its geometry's (a nameless blade
 * reads "ShaderMaterial (uColor, uBright, uSoft) on a Mesh of BufferGeometry"), since most programs of ours are known by
 * their uniforms.
 */
function nameOf(m: Any, object?: Any): string {
  const own = typeof m.name === 'string' && m.name ? m.name : '';
  if (own) return own;
  if (!object) return m.type;
  let o = object;
  for (let i = 0; i < 3 && o; i++, o = o.parent) {
    if (typeof o.name === 'string' && o.name) return `${m.type} on ${o.name}`;
  }
  const u = m.uniforms ? Object.keys(m.uniforms).slice(0, 3).join(', ') : '';
  return `${m.type}${u ? ` (${u})` : ''} on a ${object.type} of ${object.geometry?.type ?? 'no geometry'}`;
}

export function installFallback(renderer: Any): FallbackStats {
  const stats: FallbackStats = { unsupported: new Map(), standIns: new Map(), skippedDraws: 0 };
  const made = new WeakMap<object, THREE.Material>();
  const met = new WeakSet<object>();
  let nothing: NodeMaterial | null = null;

  const standInOf = (m: Any): THREE.Material | null => {
    const make = m.userData?.gpuStandIn;
    if (typeof make !== 'function') return null;
    let s = made.get(m);
    if (!s) {
      s = make() as THREE.Material;
      made.set(m, s);
      // Pass 1, wave 5: the stand-in's motion marks (the sky's turn, a place handed in) read off the original three builds on.
      adoptMotion(m, s);
      const n = s.name || nameOf(m);
      stats.standIns.set(n, (stats.standIns.get(n) ?? 0) + 1);
    }
    return s;
  };

  const lib = renderer.library;
  const fromMaterial = lib.fromMaterial.bind(lib);
  lib.fromMaterial = (material: Any) => {
    if (material.isNodeMaterial) return material;
    const s = standInOf(material);
    if (s) return s;
    if (unsupported(material)) {
      // Reached only through a path that does not go through `renderObject` (none in three 0.187 that the game uses):
      // a material that discards every fragment, so a pipeline still builds and draws nothing.
      if (!nothing) {
        nothing = new NodeMaterial();
        nothing.name = 'gpu: draws nothing';
        // Every vertex outside the clip volume: nothing is rasterised, and no attribute of the geometry is read.
        nothing.vertexNode = vec4(2, 2, 2, 1);
        nothing.colorNode = vec4(0, 0, 0, 0);
        nothing.opacityNode = float(0);
      }
      return nothing;
    }
    return fromMaterial(material);
  };

  const renderObject = renderer.renderObject;
  renderer.renderObject = function (this: Any, object: Any, scene: Any, camera: Any, geometry: Any, material: Any, group: Any, lightsNode: Any, clippingContext: Any, passId: Any) {
    if (unsupported(material) && typeof material.userData?.gpuStandIn !== 'function') {
      if (!met.has(material)) {
        met.add(material);
        const n = nameOf(material, object);
        stats.unsupported.set(n, (stats.unsupported.get(n) ?? 0) + 1);
      }
      stats.skippedDraws++;
      return;
    }
    return renderObject.call(this, object, scene, camera, geometry, material, group, lightsNode, clippingContext, passId);
  };
  return stats;
}
