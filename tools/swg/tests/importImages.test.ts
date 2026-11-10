// An imports folder decodes each distinct picture its models embed once (`src/world/sharedImages.ts`), where three's
// GLTFLoader decoded every file's copy apart and kept each ImageBitmap for the texture's life: the owner's Utapau stood
// 286 imported models wearing 1,881 embedded pictures, 478 of them distinct, 13.3 GB decoded against 5.0 GB, and ran the
// tab out of memory as the view turned. Three GLBs written here: two walls embedding the same picture, a third embedding
// another picture as its colour and the shared one as its normal map under a sampler of its own. Through the game's own
// AssetPack: the imports folder decodes two pictures for four uses, every use its own texture on the one shared Source with
// its own sampler, the source's version untouched by a later file's clone (so nothing already on the card uploads again),
// and the same files loaded as a converted pack decode every use apart exactly as before (no sharing registered).
//   node tools/swg/tests/importImages.test.ts
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as THREE from 'three';
import { buildGlb } from '../sceneglb.mjs';
import { AssetPack, type LoadedModel } from '../../../src/world/assetPack.ts';

let checks = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  checks++;
  console.log(`  ok ${what}`);
}

const SIDE = 1024;
/** A stand-in picture's bytes: what the decoder is handed, told apart only by its bytes. */
const picture = (seed: number): Buffer => {
  const b = Buffer.alloc(4096);
  b.set([0x89, 0x50, 0x4e, 0x47], 0);
  for (let i = 8; i < b.length; i++) b[i] = (i * 31 + seed * 97) & 255;
  return b;
};
const P1 = picture(1);
const P2 = picture(2);

/** One triangle wearing a colour picture (and a normal picture with a clamped sampler, where given). */
function glb(colour: Buffer, normal?: Buffer): Buffer {
  const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const uv = new Float32Array([0, 0, 1, 0, 0, 1]);
  const parts = [Buffer.from(pos.buffer), Buffer.from(uv.buffer), colour, ...(normal ? [normal] : [])];
  const views: { buffer: number; byteOffset: number; byteLength: number }[] = [];
  let off = 0;
  for (const p of parts) {
    views.push({ buffer: 0, byteOffset: off, byteLength: p.length });
    off += p.length;
  }
  const bin = Buffer.concat(parts);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'piece' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
    materials: [{ name: 'wall', pbrMetallicRoughness: { baseColorTexture: { index: 0 } }, ...(normal ? { normalTexture: { index: 1 } } : {}) }],
    textures: [{ source: 0, sampler: 0 }, ...(normal ? [{ source: 1, sampler: 1 }] : [])],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }, { magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    images: [{ bufferView: 2, mimeType: 'image/png' }, ...(normal ? [{ bufferView: 3, mimeType: 'image/png' }] : [])],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC2' },
    ],
    bufferViews: views,
    buffers: [{ byteLength: bin.length }],
  };
  return buildGlb(json, bin);
}

const tmp = mkdtempSync(join(tmpdir(), 'swg3js-import-images-'));
const FILES: Record<string, Buffer> = { 'wall_a.glb': glb(P1), 'wall_b.glb': glb(P1), 'door.glb': glb(P2, P1) };
const def = (id: string) => ({ id, file: `${id}.glb`, bounds: { min: [0, 0, 0], max: [1, 1, 0] } });
for (const dir of [join('site', 'imports-private'), join('site', 'assets-private', 'conv')]) {
  mkdirSync(join(tmp, dir), { recursive: true });
  for (const [f, b] of Object.entries(FILES)) writeFileSync(join(tmp, dir, f), b);
  writeFileSync(join(tmp, dir, 'manifest.json'), JSON.stringify({ planet: dir.endsWith('conv') ? 'conv' : 'imported', categories: { props: ['wall_a', 'wall_b', 'door'].map(def) } }));
}

const SITE = 'http://import-images.test/';
const realFetch = globalThis.fetch;
const g = globalThis as unknown as { self?: unknown; createImageBitmap?: unknown; ProgressEvent?: unknown };
const hadSelf = 'self' in g;
const hadProgress = 'ProgressEvent' in g;
const realBitmap = g.createImageBitmap;
let decoded = 0;
g.self ??= globalThis;
g.ProgressEvent ??= class extends Event {
  constructor(type: string, init: Record<string, unknown> = {}) {
    super(type);
    Object.assign(this, init);
  }
};
g.createImageBitmap = async () => {
  decoded++;
  return { width: SIDE, height: SIDE, close() {} };
};
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
  if (url.startsWith('blob:')) return realFetch(input as RequestInfo, init);
  const file = url.startsWith(SITE) ? join(tmp, 'site', ...url.slice(SITE.length).split('/')) : '';
  if (!file || !existsSync(file)) return new Response('missing', { status: 404, headers: { 'content-type': 'text/plain' } });
  const type = file.endsWith('.json') ? 'application/json' : 'model/gltf-binary';
  return new Response(readFileSync(file), { status: 200, headers: { 'content-type': type } });
}) as typeof fetch;

const mat = (m: LoadedModel) => m.primitives[0].material as THREE.MeshStandardMaterial;

try {
  // ---------------------------------------------------------------- 1. an imports folder: one picture per distinct image
  const pack = await AssetPack.load('imported', SITE, { dir: 'imports-private/' });
  ok(!!pack && pack.imported && !!pack.images, 'an imports folder carries its shared pictures');
  const a = await pack!.model('wall_a');
  const versionAfterA = mat(a).map!.source.version;
  const b = await pack!.model('wall_b');
  const door = await pack!.model('door');
  const pics = pack!.images!.pictures;
  ok(decoded === 2, `two distinct pictures decoded for four uses (${decoded})`);
  ok(pics.asked === 4 && pics.decoded === 2, `the folder counts what it shared (${JSON.stringify(pics)})`);
  const each = SIDE * SIDE * 4;
  ok(pack!.images!.askedBytes === 4 * each && pack!.images!.decodedBytes === 2 * each, `the decoded bytes are halved: ${pics.askedMB} MB of pictures asked, ${pics.decodedMB} MB decoded`);
  const ma = mat(a).map!, mb = mat(b).map!;
  ok(ma !== mb && ma.source === mb.source, 'the two walls wear textures of their own on one shared source (one ImageBitmap, one upload)');
  ok(mb.source.version === versionAfterA, `a later file's clone leaves the source's version alone, so a picture already on the card is not uploaded again (${versionAfterA} -> ${mb.source.version})`);
  ok(mb.version > 0, 'the clone itself is marked for its first upload');
  const dn = mat(door).normalMap!, dc = mat(door).map!;
  ok(dn.source === ma.source && dc.source !== ma.source, "the door's normal map shares the walls' picture and its colour is a picture of its own");
  ok(dn.wrapS === THREE.ClampToEdgeWrapping && ma.wrapS === THREE.RepeatWrapping, "each use keeps its own file's sampler (the door's clamped, the walls' repeated)");
  ok(ma.colorSpace === THREE.SRGBColorSpace && dn.colorSpace !== THREE.SRGBColorSpace, 'each use keeps its own colour space (colour sRGB, normal linear)');
  ok(ma.flipY === false && dn.flipY === false && ma.generateMipmaps === true, "glTF's own texture defaults: no flip, mipmaps where the filter wants them");

  // ---------------------------------------------------------------- 2. day one: a converted pack shares nothing
  decoded = 0;
  const conv = await AssetPack.load('conv', SITE);
  ok(!!conv && !conv.imported && conv.images === null, 'a converted pack registers no sharing');
  const ca = await conv!.model('wall_a');
  const cb = await conv!.model('wall_b');
  await conv!.model('door');
  ok(decoded === 4, `and decodes every file's copy apart, as three always did (${decoded})`);
  ok(mat(ca).map!.source !== mat(cb).map!.source, 'its two walls each hold a source of their own');
} finally {
  globalThis.fetch = realFetch;
  g.createImageBitmap = realBitmap;
  if (!hadSelf) delete g.self;
  if (!hadProgress) delete g.ProgressEvent;
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nimport images: ${checks} checks passed`);
