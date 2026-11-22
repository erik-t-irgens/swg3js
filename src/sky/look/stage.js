// The dark stage: WebGPU when the browser has it (WebGL 2 otherwise), orbit and zoom, a faint star field.

import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export async function createStage(canvas, { forceWebGL = false } = {}) {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.NoToneMapping; // the pictures' own colours, unchanged
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  await renderer.init();
  const backend = renderer.backend && renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL 2';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020306);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 3000);
  camera.position.set(0, 0, 4.4);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.minDistance = 0.2;
  controls.maxDistance = 400;
  controls.zoomSpeed = 0.9;
  controls.rotateSpeed = 0.7;

  const stars = makeStars();
  scene.add(stars);

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  return { renderer, scene, camera, controls, stars, backend, resize };
}

// A faint field: mostly dim specks, a few brighter ones, a hint of colour.
function makeStars() {
  const N = 4200;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < N; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    pos.set([Math.cos(a) * s * 900, u * 900, Math.sin(a) * s * 900], i * 3);
    const b = 0.02 + Math.pow(rnd(), 5) * 0.7;
    const warm = rnd();
    col.set([b * (0.85 + warm * 0.25), b * 0.95, b * (1.1 - warm * 0.3)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.PointsNodeMaterial({ vertexColors: true, depthWrite: false, sizeAttenuation: false });
  const p = new THREE.Points(g, m);
  p.renderOrder = -10;
  p.frustumCulled = false;
  return p;
}

// Put the camera where the whole body (radius r around the target) fills the view with a margin,
// keeping the direction it looks from.
export function frameCamera(stage, r, target = new THREE.Vector3()) {
  const { camera, controls } = stage;
  const vfov = (camera.fov * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const fov = Math.min(vfov, hfov);
  const dist = (r * 1.18) / Math.sin(fov / 2);
  const dir = camera.position.clone().sub(controls.target);
  if (dir.lengthSq() < 1e-8) dir.set(0, 0, 1);
  dir.normalize();
  controls.target.copy(target);
  camera.position.copy(target).addScaledVector(dir, dist);
  camera.near = Math.max(0.005, dist / 400);
  camera.far = 3000;
  camera.updateProjectionMatrix();
  controls.update();
}
