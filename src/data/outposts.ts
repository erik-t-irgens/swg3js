/**
 * Hand-placed structures near each planet's spawn, using converted SWG
 * meshes when an asset pack is present. Positions are metres from the spawn
 * point; rot is yaw in radians; flatten is the radius of level ground.
 */
export interface Placement {
  model: string;
  x: number;
  z: number;
  rot: number;
  flatten?: number;
}

export const OUTPOSTS: Record<string, Placement[]> = {
  tatooine: [
    { model: 'thm_tato_cantina_r0_mesh_r0', x: 36, z: 10, rot: Math.PI * 0.5, flatten: 30 },
    { model: 'thm_tato_house_sml_s01_fp1_r0_mesh', x: -30, z: 22, rot: 0.6, flatten: 18 },
    { model: 'thm_tato_house_m_s01_fp1_r0_mesh', x: -8, z: 52, rot: 2.4, flatten: 22 },
    { model: 'thm_tato_sandstone_hovel_s01', x: 20, z: 46, rot: -1.0, flatten: 12 },
    { model: 'thm_tato_tent_house_s01', x: 42, z: -28, rot: 0.2, flatten: 12 },
    { model: 'thm_tato_jawa_tent_large', x: -46, z: -34, rot: 0.3, flatten: 12 },
    { model: 'thm_tato_jawa_tent_med', x: -58, z: -24, rot: 1.4, flatten: 9 },
    { model: 'thm_tato_jawa_tent_small', x: -52, z: -46, rot: -0.7, flatten: 8 },
    { model: 'thm_tato_luke_farm_dome', x: 70, z: -60, rot: 0, flatten: 16 },
    { model: 'thm_tato_luke_farm_garage', x: 86, z: -48, rot: 0.8, flatten: 14 },
    { model: 'thm_tato_watto_junkshop_r0_mesh', x: -70, z: 66, rot: 1.6, flatten: 24 },
    { model: 'thm_tato_imprv_archway_s01', x: 10, z: 26, rot: 0, flatten: 8 },
    { model: 'thm_tato_guild_statue_freestand_s01', x: 0, z: 30, rot: Math.PI, flatten: 6 },
    { model: 'thm_tato_lucky_despot_debris_lg_engine_s01', x: 110, z: 40, rot: 0.9, flatten: 14 },
    { model: 'thm_tato_lucky_despot_debris_nose_cone', x: 130, z: 70, rot: 2.6, flatten: 14 },
  ],
};
