# Reversed depth

The game draws with **reversed depth**: the camera's near plane maps to depth 1 and its far plane to 0, in a
floating-point depth buffer. Ordinary depth loses precision with the square of the distance: with the camera's
0.05 m near plane and 9 km far plane, one depth step was about 1.2 m at 1 km, 11 m at 3 km and 97 m at 9 km, so a
seabed within a few metres of the surface showed through the water when seen from high up, and large distant
objects would flicker. Reversed depth in a float buffer keeps precision nearly even at every distance.

It is on wherever the browser offers `EXT_clip_control`, and `?norevz` in the address turns it off to compare.
Both are decided once, when the page loads (`src/core/depthMode.ts`, `REVERSED_DEPTH`).

## Writing code that reads depth

Under reversed depth, every assumption about what a depth value means turns round. New code must not hard-code
the ordinary meaning. Use these:

| You want | Ordinary | Reversed | Use |
|---|---|---|---|
| distance from a depth sample | `ndc = 2d - 1`, then the usual formula | `near*far / (near + d*(far - near))` | `fxViewZ` (`FX_LINEARIZE`, `src/core/fx/glsl.ts`) |
| "nothing was drawn here" (sky) | `d >= 1.0` | `d <= 0.0` | `skyTest('d')` |
| past a shadow map's far end | `z > 1.0` | `z < 0.0` | `pastFarTest('z')` |
| a position from a depth sample | `vec4(uv*2-1, d*2-1, 1)` | `vec4(uv*2-1, d, 1)` | choose by `REVERSED_DEPTH` (see `motionBlur.ts`) |
| a projected point behind the camera | `p.z > 1` | `p.z < 0` | `projectedBehind(p.z, camera)` |
| a culling frustum from a camera | `setFromProjectionMatrix(m)` | needs the flag | `setFromProjectionMatrix(m, THREE.WebGLCoordinateSystem, camera.reversedDepth)` |
| a shadow bias applied by hand | `z += bias` | `z -= bias` | see `grassForDepthMode` (`grass.ts`) |
| polygon offset toward the camera | negative factor and units | three flips the factor only | flip the units yourself (`fx/geometry.ts`, `marks.ts`) |
| a depth written by hand | `ndc * 0.5 + 0.5` | `ndc` as it is | see the planets' depth stand-in (`world.ts`) |
| a far-plane value written by hand | 1.0 | 0.0 | see the doorway reset (`portalRender.ts`) |

**Shader text is chosen in TypeScript when the page loads, never with `#ifdef USE_REVERSED_DEPTH_BUFFER`.** An `#ifdef`
changes a program's text even when it does nothing, and the clouds' and the grass's programs are held to their old
text byte for byte (`airClouds.test.ts`, `grassAir.test.ts`). Where a pinned text must stay in the file verbatim, the
reversed twin is made beside it and swapped in where the material is built (`grassForDepthMode`).

## Three.js 0.185's reversed-depth bugs, and what works round them

Each was found in play, and each is held by `tools/swg/tests/reversedDepth.test.ts` against three's own code, so an
upgrade that changes it fails there, by name.

1. **Draw order.** `WebGLRenderLists.sort` reverses each whole sorted list under reversed depth, meaning to turn
   nearest-first into farthest-first, but that also reverses `renderOrder`: the sky's dome, ordered first and drawn
   without a depth test, was drawn last and covered the world. `src/core/reversedSort.ts` gives the renderer comparators
   that sort into the exact reverse of the wanted order, so three's reversal brings it out right. **This is the one
   workaround that depends on the bug staying**: the test compares the reversed order with the ordinary one and fails
   if they differ.
2. **Shadow cascades.** Three's `CSM` never tells its `CSMFrustum` that the camera is reversed, so every
   `updateFrustums` after the camera was first drawn reversed (a new location, a shadow setting) fitted the cascades to a
   collapsed frustum, and the sun's shadows were gone. `src/world/csmDepth.ts` sets the frustum's depths from the
   camera before every split. Harmless if three mends it.
3. **The depth-test table.** `ReversedDepthFuncs` turns Always into Never and Equal into NotEqual, where only less and
   greater should swap: the doorway's depth reset, asked to write always, wrote never, and rooms seen from outside lost
   to terrain standing in them. `alwaysDepthFunc` in `portalRender.ts` asks the GPU which test three really sets and
   picks the one that comes out Always, so it follows three either way. The game has no other Always, Never, Equal or
   NotEqual depth tests; **any new one must go through the same probe.**

## Traps

- **`renderer.resetState()`** clears three's record that depth is reversed (`currentReversed = false`) without
  changing the GPU's clip range, so depth tests stop being flipped while projections stay reversed. Nothing calls it
  today; anything that does must call `renderer.state.buffers.depth.setReversed(true)` straight after.
- **A camera is reversed only once a reversed renderer has drawn it.** The map screen has its own renderer and its
  camera never is; ask the camera (`camera.reversedDepth`), not the flag, wherever a camera's own maths is concerned.
- **`__debug.grassShadowSelfTest()`** models ordinary depth and does not run under reversed depth; load with
  `?norevz` to run it.

## How it was found

Reversed depth went in behind a flag over eight patches (October 2026), each found by the owner in play: the
sky over the world (draw order), the doorway reset writing the near plane, polygon offsets, motion blur smearing
from the centre (its position from depth), a target box mirrored in front of the player (behind-the-camera tests),
no lens flare (its sky test), shadows lost after a new location (cascades), terrain through doorways (the depth-test
table), and creature animation work counting every creature as on screen (frustums without their far plane).
