// Every package and three addon the game's modules import (`src/`, the space body viewer's shared modules in `src/sky/look/`
// and `src/sky/system/` among them), named to the game's Vite as `optimizeDeps.include` (`vite.config.ts`; the GPU port's pass 2,
// wave 6, maker K, after the owner's Mac of 23 November). Vite's optimiser keeps its made dependencies by the lockfile and the
// config alone, so after a pull that brings a module importing an addon the old cache never made (src/sky/look's loaders, controls
// and bloom since wave 4), it met that import in play, made three again and, with reloading off, never told the page: two copies
// of three's node library in one page, his "No stack defined for assign operation" and a black world until the tab was reopened.
// Named here, every one is made at the server's start, and a list that changes is a config that changes, so a cache made before
// it is made again. `viteDeps.test.ts` holds this list to every bare import under `src/`, so a new one cannot be forgotten.
export const PREBUNDLED = [
  'three',
  'three/webgpu',
  'three/tsl',
  'three/addons/controls/OrbitControls.js',
  'three/addons/csm/CSMShadowNode.js',
  'three/addons/loaders/FBXLoader.js',
  'three/examples/jsm/csm/CSM.js',
  'three/examples/jsm/csm/CSMShader.js',
  'three/examples/jsm/environments/RoomEnvironment.js',
  'three/examples/jsm/loaders/GLTFLoader.js',
  'three/examples/jsm/postprocessing/OutputPass.js',
  'three/examples/jsm/postprocessing/UnrealBloomPass.js',
  'three/examples/jsm/shaders/FXAAShader.js',
  'three/examples/jsm/utils/BufferGeometryUtils.js',
  'three/examples/jsm/utils/SkeletonUtils.js',
  '@dimforge/rapier3d-compat',
  'simplex-noise',
];
