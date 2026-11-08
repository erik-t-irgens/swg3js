// The sky dome's colour lines (the horizon pass), out of `sky.ts` so a module node can load reads them: interpolated
// back into `sky.ts`'s `DOME_FRAG` where they stood (the dome's text is what it was to the byte), and wrapped by the far
// ground's ring program in a function of its own (`ringSky`) for the horizon fade, through the dome's own uniform
// objects. Reads `d` (a unit direction), `up` (its height, clamped) and the dome's uniforms by their names.

/** The dome's colour in a direction, from its gradients (or its clear colour) and its horizon fog below the horizon. */
export const DOME_COLOUR_GLSL = `vec3 g1 = uHasGradient > 0.5 ? texture2D(uGradient, vec2(uTime, up)).rgb : uClear;
    vec3 g2 = uHasGradient2 > 0.5 ? texture2D(uGradient2, vec2(uTime, up)).rgb : uClear;
    vec3 col = mix(g1, g2, uGradientMix);
    // Below the horizon the ground normally hides the dome; fade the last strip into the fog.
    col = mix(uHorizonFog, col, smoothstep(-0.03, 0.0, d.y));`;
