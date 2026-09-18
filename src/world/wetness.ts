// The weather's shared uniforms: one set of objects joined by reference into every material that
// reads the weather (the falling effects' own shader now; the ground, the water and the world's
// materials once they learn to get wet), so one write per frame reaches all of them and nothing
// ever changes a material's program.
import * as THREE from 'three';

/** Stands for "no surface known here" in the roof map (the same value as the roof grid's ROOF_OPEN). */
const OPEN = -1e9;

/** A 1×1 R32F DataTexture holding "open": the roof map with no grid. uRoofMap starts as it, and uRoofGrid as (0, 0, 1, 1). */
export const OPEN_ROOF_MAP: THREE.DataTexture = (() => {
  const t = new THREE.DataTexture(new Float32Array([OPEN]), 1, 1, THREE.RedFormat, THREE.FloatType);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.flipY = false;
  t.needsUpdate = true;
  return t;
})();

/** The grid uniform while there is no roof grid: one cell at the origin, which the open map says is open. */
export const OPEN_ROOF_GRID = new THREE.Vector4(0, 0, 1, 1);

/** Shared by reference into every hooked material's uniforms. */
export const WEATHER_UNIFORMS: {
  uWetness: THREE.IUniform<number>;
  uPuddles: THREE.IUniform<number>;
  uRain: THREE.IUniform<number>;
  uSnowCover: THREE.IUniform<number>;
  uWeatherTime: THREE.IUniform<number>;
  uWetSky: THREE.IUniform<THREE.Color>;
  uRoofMap: THREE.IUniform<THREE.Texture>;
  uRoofGrid: THREE.IUniform<THREE.Vector4>;
} = {
  uWetness: { value: 0 },
  uPuddles: { value: 0 },
  uRain: { value: 0 },
  uSnowCover: { value: 0 },
  uWeatherTime: { value: 0 },
  uWetSky: { value: new THREE.Color(0.5, 0.55, 0.6) },
  uRoofMap: { value: OPEN_ROOF_MAP },
  uRoofGrid: { value: OPEN_ROOF_GRID },
};

/** False when localStorage 'swg.weather.wrap' is '0' (read once): world materials are not wrapped, for a cost baseline. */
export const WET_WRAP: boolean = (() => {
  try {
    return typeof localStorage === 'undefined' || localStorage.getItem('swg.weather.wrap') !== '0';
  } catch {
    return true;
  }
})();
