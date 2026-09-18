// The one copy of the octahedral normal code. A unit vector folds onto the square [-1, 1]^2 and
// unfolds again with no seam at the poles, which is how the water mask stores a surface normal in
// two half floats. The water material writes it (src/world/water.ts) and the effects read it
// (src/core/fx/glsl.ts re-exports both halves as FX_OCT), so the two sides can never disagree.
//
// No imports: the world and the effects both take it from here without pulling each other in.

/** fxOctEncode(n): a unit vector to the octahedral square, stored as it is (no 0..1 bias). */
export const GLSL_OCT_ENCODE = /* glsl */ `
  vec2 fxOctEncode(vec3 n) {
    n /= abs(n.x) + abs(n.y) + abs(n.z);
    if (n.z < 0.0) n.xy = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
    return n.xy;
  }
`;

/** fxOctDecode(e): the octahedral square back to a unit vector. Never zero, so normalising is safe. */
export const GLSL_OCT_DECODE = /* glsl */ `
  vec3 fxOctDecode(vec2 e) {
    vec3 n = vec3(e, 1.0 - abs(e.x) - abs(e.y));
    float t = max(-n.z, 0.0);
    n.x += n.x >= 0.0 ? -t : t;
    n.y += n.y >= 0.0 ? -t : t;
    return normalize(n);
  }
`;
