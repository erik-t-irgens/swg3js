// What the radial flora's tests build terrains in memory from (radialAffect.test.ts, roadFlora.test.ts,
// grassPlace.test.ts): a retail-shaped header, a radial family and a radial affector. Not a test itself.
import { form, chunk, W, ihdr } from './iffWriter.ts';

/** The header of a retail-shaped terrain: 8 m chunks of two 4 m tiles, so poles 2 m apart, and its four flora tilings (the near radial 0-30 m on 1 m tiles, the far 100-500 on 32). */
export const header = (radialTile = 1, radialBorder = 0) =>
  new W().str('radial').f32(2048).f32(8).i32(2).i32(0).f32(0).f32(2).str('').f32(60)
    .f32(0).f32(50).f32(16).f32(2).u32(0)
    .f32(0).f32(50).f32(4).f32(0).u32(0)
    .f32(0).f32(30).f32(radialTile).f32(radialBorder).u32(0)
    .f32(100).f32(500).f32(32).f32(8).u32(0)
    .u8(1).bytes();

/** A radial affector, version 0002: family, operation (1 add, 0 replace), remove-all, density override and its density. */
export const afd = (tag: 'AFDN' | 'AFDF', family: number, op = 1, removeAll = 0, override = 0, density = 1) =>
  form(tag, form('0002', ihdr(`${tag} ${family}`), chunk('DATA', new W().i32(family).i32(op).i32(removeAll).i32(override).f32(density).bytes())));

/** A radial family, version 0004, its children each one metre square unless sized. */
export const rfam = (id: number, name: string, density: number, shaders: (string | { shader: string; w?: [number, number]; h?: [number, number]; sway?: [number, number]; plus?: boolean; align?: boolean; aspect?: boolean; weight?: number })[]) => {
  const w = new W().i32(id).str(name).u8(255).u8(255).u8(0).f32(density).i32(shaders.length);
  for (const raw of shaders) {
    const s = typeof raw === 'string' ? { shader: raw } : raw;
    w.str(s.shader).f32(s.weight ?? 1).f32(10).f32(s.w?.[0] ?? 1).f32(s.w?.[1] ?? 1).f32(s.h?.[0] ?? 1).f32(s.h?.[1] ?? 1).i32(s.aspect ? 1 : 0).i32(s.sway ? 1 : 0).f32(s.sway?.[0] ?? 0.25).f32(s.sway?.[1] ?? 0.35).i32(s.align ? 1 : 0).i32(s.plus ? 1 : 0);
  }
  return chunk('RFAM', w.bytes());
};
