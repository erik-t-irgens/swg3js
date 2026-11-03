// The ambient occlusion's uniforms for the rooms' pool's other slots (Map-maker II's wave of the rooms' lights): the spots and the
// casting points the frame lit, into the GTAO program's own arrays (`ssaoGtaoFrag`'s variant, built only where the session built
// such slots). Out of `ssao.ts` so a node test fills the very uniforms from a record the pool filled.
//
// Rule for this file (node runs it with type stripping): every value import with its `.ts` extension, nothing that touches the
// page at load.

import type { FxRoomLights } from './lights.ts';

/** The GTAO program's uniforms for the rooms' pool's spots and casting points. */
export interface RoomPoolUniforms {
  uRoomSpotPos: { value: Float32Array };
  uRoomSpotDir: { value: Float32Array };
  uRoomSpotCone: { value: Float32Array };
  uRoomSpotCount: { value: number };
  uRoomCastPos: { value: Float32Array };
  uRoomCastLum: { value: Float32Array };
  uRoomCastCount: { value: number };
}

/**
 * The rooms' pool's spots and casting points the frame lit (`FxLights.rooms`) into the GTAO program's own arrays, as many as its
 * text takes (`spots`, `cast`; nought writes nothing of that kind), and only where the rooms' set applies (`useRegion`): the
 * spots with their cones, the casting points (the first `extraPoints` of `extra`) as points. Nothing is made.
 */
export function fillRoomPoolUniforms(g: RoomPoolUniforms, R: FxRoomLights, useRegion: boolean, spots: number, cast: number): void {
  if (spots > 0) {
    const sp = g.uRoomSpotPos.value;
    const sd = g.uRoomSpotDir.value;
    const sc = g.uRoomSpotCone.value;
    let m = 0;
    if (useRegion) {
      for (let i = 0; i < R.spotCount && m < spots; i++, m++) {
        const s = R.spots[i];
        sp[m * 4] = s.position.x;
        sp[m * 4 + 1] = s.position.y;
        sp[m * 4 + 2] = s.position.z;
        sp[m * 4 + 3] = s.distance;
        sd[m * 4] = s.direction.x;
        sd[m * 4 + 1] = s.direction.y;
        sd[m * 4 + 2] = s.direction.z;
        sd[m * 4 + 3] = s.luminance;
        sc[m * 3] = s.coneCos;
        sc[m * 3 + 1] = s.penumbraCos;
        sc[m * 3 + 2] = s.decay;
      }
    }
    g.uRoomSpotCount.value = m;
  }
  if (cast > 0) {
    const cp = g.uRoomCastPos.value;
    const cl = g.uRoomCastLum.value;
    let m = 0;
    if (useRegion) {
      for (let i = 0; i < R.extraPoints && m < cast; i++, m++) {
        const p = R.extra[i];
        cp[m * 4] = p.position.x;
        cp[m * 4 + 1] = p.position.y;
        cp[m * 4 + 2] = p.position.z;
        cp[m * 4 + 3] = p.distance;
        cl[m * 2] = p.luminance;
        cl[m * 2 + 1] = p.decay;
      }
    }
    g.uRoomCastCount.value = m;
  }
}
