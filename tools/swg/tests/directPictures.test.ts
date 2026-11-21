// The pictures of a model file decoded straight from its bytes (the GPU port's pass 1, wave 8, cut 5:
// `SURFACE_TUNE.directPictures`, `DirectPicturesPlugin` in src/world/surfaces.ts), driven through three's own GLTFLoader
// and its own ImageBitmapLoader under node, with the browser's `createImageBitmap` stood in by a recorder. The same file is
// parsed with the switch on and off: every picture held in the file's buffer reaches the decoder with the same bytes, the
// same type and the same options both ways, once a picture however many textures share it; on, no object URL is made and
// nothing is fetched for it; a picture held by address is left to three's way; and every texture comes out the same
// (its bitmap, which way up, its name, its sampler, its colour space, its type, its association with the file's texture
// index, a second sampler's clone of one picture). Then the lines of three's that the plugin leans on are held by hash:
// `GLTFParser.loadImageSource` (the branch for a loader that parses a buffer view's bytes itself) and `loadTextureImage`.
// The pixels themselves are the browser's: held in a page by decoding every picture of a world's model files both ways and
// hashing what each renderer uploads (`A:\swg3js\port\scratch\p1w8-makerB\`).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SURFACE_TUNE, surfaces } from '../../../src/world/surfaces.ts';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}

// ------------------------------------------------------------------ the browser's parts, stood in and recorded
interface Decode {
  bytes: string;
  type: string;
  opts: string;
  bitmap: object;
}
const decodes: Decode[] = [];
const g = globalThis as unknown as Record<string, unknown>;
g.self ??= globalThis;
g.createImageBitmap = async (blob: Blob, opts: unknown): Promise<object> => {
  const bytes = Buffer.from(await blob.arrayBuffer()).toString('hex');
  const bitmap = { width: 4, height: 4, bytes, close() {} };
  decodes.push({ bytes, type: blob.type, opts: JSON.stringify(opts), bitmap });
  return bitmap;
};
let objectUrls = 0;
const ownCreate = URL.createObjectURL.bind(URL);
URL.createObjectURL = (b: Blob): string => {
  objectUrls++;
  return ownCreate(b);
};
let fetched = 0;
const ownFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: unknown, init?: RequestInit) => {
  fetched++;
  return ownFetch(input as string, init);
}) as typeof fetch;

// ------------------------------------------------------------------ a model file: three pictures in its buffer, one by address
const pic = (n: number, len: number): Uint8Array => Uint8Array.from({ length: len }, (_, i) => (i * 31 + n * 17) & 255);
const pngA = pic(1, 37);
const jpgB = pic(2, 53);
const pngC = pic(3, 29);
const tri = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
const parts = [pngA, jpgB, pngC, new Uint8Array(tri.buffer), new Uint8Array(uvs.buffer)];
const pad4 = (n: number): number => (n + 3) & ~3;
const views: { buffer: number; byteOffset: number; byteLength: number }[] = [];
let at = 0;
for (const p of parts) {
  views.push({ buffer: 0, byteOffset: at, byteLength: p.byteLength });
  at = pad4(at + p.byteLength);
}
const bin = new Uint8Array(at);
parts.forEach((p, i) => bin.set(p, views[i].byteOffset));
// A picture by address: a data URL of its own bytes, which three's loader fetches.
const byAddress = `data:image/png;base64,${Buffer.from(pic(4, 21)).toString('base64')}`;
const json = {
  asset: { version: '2.0' },
  buffers: [{ byteLength: bin.byteLength }],
  bufferViews: views,
  accessors: [
    { bufferView: 3, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
    { bufferView: 4, componentType: 5126, count: 3, type: 'VEC2' },
  ],
  images: [{ bufferView: 0, mimeType: 'image/png', name: 'a' }, { bufferView: 1, mimeType: 'image/jpeg' }, { bufferView: 2, mimeType: 'image/png', extras: { kept: 7 } }, { uri: byAddress }],
  samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33648 }, { magFilter: 9729, minFilter: 9987 }],
  textures: [{ source: 0, sampler: 0 }, { source: 1, name: 'glow' }, { source: 0, sampler: 1 }, { source: 2 }, { source: 3 }],
  materials: [
    { name: 'm0', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 2 } }, emissiveTexture: { index: 1 }, emissiveFactor: [1, 1, 1], normalTexture: { index: 3 } },
    { name: 'm1', pbrMetallicRoughness: { baseColorTexture: { index: 4 } } },
  ],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }, { primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 1 }] }],
  nodes: [{ mesh: 0 }, { mesh: 1 }],
  scenes: [{ nodes: [0, 1] }],
  scene: 0,
};
function glb(): ArrayBuffer {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = pad4(text.byteLength);
  const total = 12 + 8 + jsonLen + 8 + bin.byteLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLen);
  out.set(text, 20);
  dv.setUint32(20 + jsonLen, bin.byteLength, true);
  dv.setUint32(24 + jsonLen, 0x004e4942, true);
  out.set(bin, 28 + jsonLen);
  return out.buffer;
}

interface Read {
  decodes: Decode[];
  objectUrls: number;
  fetched: number;
  textures: { slot: string; tex: THREE.Texture; index: number | undefined }[];
}
async function parse(direct: boolean): Promise<Read> {
  SURFACE_TUNE.directPictures = direct;
  decodes.length = 0;
  objectUrls = 0;
  fetched = 0;
  const loader = surfaces.withPlugin(new GLTFLoader());
  const gltf = await loader.parseAsync(glb(), '');
  const textures: Read['textures'] = [];
  gltf.scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (!m) return;
    for (const slot of ['map', 'emissiveMap', 'metalnessMap', 'roughnessMap', 'normalMap'] as const) {
      const tex = m[slot];
      if (tex) textures.push({ slot: `${m.name}.${slot}`, tex, index: gltf.parser.associations.get(tex)?.textures });
    }
  });
  return { decodes: [...decodes], objectUrls, fetched, textures };
}

const off = await parse(false);
const on = await parse(true);
SURFACE_TUNE.directPictures = true;

ok(SURFACE_TUNE.directPictures === true, 'the switch is on by default');
ok(off.decodes.length === 4 && off.objectUrls === 3 && off.fetched === 4, `three's own way: four pictures decoded, an object URL made and fetched for each of the three in the buffer, the one by address fetched (${off.decodes.length}, ${off.objectUrls}, ${off.fetched})`);
ok(on.decodes.length === 4 && on.objectUrls === 0 && on.fetched === 1, `straight: the same four decoded, no object URL made, only the picture by address fetched (${on.decodes.length}, ${on.objectUrls}, ${on.fetched})`);
const byBytes = (r: Read): Map<string, Decode> => new Map(r.decodes.map((d) => [d.bytes, d]));
const offBy = byBytes(off);
const onBy = byBytes(on);
for (const [name, bytes] of [['png', pngA], ['jpeg', jpgB], ['png with extras', pngC]] as const) {
  const hex = Buffer.from(bytes).toString('hex');
  const a = offBy.get(hex);
  const b = onBy.get(hex);
  ok(!!a && !!b && a.type === b.type && a.opts === b.opts, `the ${name} picture reaches the decoder with its own bytes, type (${b?.type}) and three's options (${b?.opts}) both ways`);
}
ok(JSON.parse(on.decodes[0].opts).premultiplyAlpha === 'none' && JSON.parse(on.decodes[0].opts).colorSpaceConversion === 'none', 'the options are three\'s own: no premultiplied alpha, no colour space conversion');
ok(on.decodes.filter((d) => d.bytes === Buffer.from(pngA).toString('hex')).length === 1, 'a picture two textures share (two samplers) is decoded once, as three decodes it');

ok(off.textures.length === on.textures.length && off.textures.length === 6, `six texture slots filled both ways (${on.textures.length})`);
const fields = (t: THREE.Texture): string =>
  JSON.stringify({ flipY: t.flipY, name: t.name, mag: t.magFilter, min: t.minFilter, s: t.wrapS, t: t.wrapT, mips: t.generateMipmaps, cs: t.colorSpace, data: t.userData, w: (t.image as { width?: number })?.width, bytes: (t.image as { bytes?: string })?.bytes, version: t.version > 0, premultiply: t.premultiplyAlpha, format: t.format, type: t.type, unpack: t.unpackAlignment });
for (let i = 0; i < on.textures.length; i++) {
  const a = off.textures[i];
  const b = on.textures[i];
  ok(a.slot === b.slot && a.index === b.index && fields(a.tex) === fields(b.tex), `${b.slot}: the same texture both ways (texture ${b.index}: ${fields(b.tex).slice(0, 120)}...)`);
}
{
  const t = (r: Read, slot: string): THREE.Texture => r.textures.find((x) => x.slot === slot)!.tex;
  ok(t(on, 'm0.map').image === t(on, 'm0.metalnessMap').image && t(on, 'm0.map') !== t(on, 'm0.metalnessMap'), "one picture under two samplers is three's clone: one bitmap, two textures");
  ok(t(on, 'm0.map').flipY === false && t(on, 'm0.map').magFilter === THREE.NearestFilter && t(on, 'm0.map').wrapT === THREE.MirroredRepeatWrapping, "the sampler's filters and wrapping and which way up are three's");
  ok(t(on, 'm0.normalMap').userData.kept === 7 && t(on, 'm0.normalMap').userData.mimeType === 'image/png', "the picture's extras and its type are three's");
  ok(t(on, 'm0.emissiveMap').name === 'glow' && t(on, 'm0.map').name === 'a', "and so are the names");
  ok(t(on, 'm1.map').image && (t(on, 'm1.map').image as { bytes: string }).bytes === Buffer.from(pic(4, 21)).toString('hex'), 'the picture by address is three\'s own load, untouched');
}

// ------------------------------------------------------------------ an imports folder's one picture per distinct image
// The plugin answers no texture itself, so a plugin registered after it that picks the texture (an imports pack's
// `SharedImages`, registered after `surfaces.withPlugin` as `AssetPack.load` does) still decides which pictures are decoded,
// and those it decodes go straight to the decoder.
{
  const { SharedImages } = await import('../../../src/world/sharedImages.ts');
  for (const direct of [false, true]) {
    SURFACE_TUNE.directPictures = direct;
    decodes.length = 0;
    objectUrls = 0;
    const images = new SharedImages();
    const loader = surfaces.withPlugin(new GLTFLoader());
    loader.register((parser) => images.plugin(parser));
    // Two files, each wearing the same picture's bytes (two walls cut from one kit).
    await loader.parseAsync(glb(), '');
    await loader.parseAsync(glb(), '');
    const hexA = Buffer.from(pngA).toString('hex');
    // Four textures a file hold a picture of the buffer (the fifth, by address, is three's): eight asked, three distinct.
    ok(images.decoded === 3 && images.asked === 8 && decodes.filter((d) => d.bytes === hexA).length === 1, `${direct ? 'straight' : "three's way"}: the shared pictures still decode each distinct image once for the folder (${images.decoded} decoded for ${images.asked} asked)`);
    ok(direct ? objectUrls === 0 : objectUrls === 3, direct ? 'and the straight decode makes no object URL for them' : 'and three makes an object URL for each (3)');
  }
  SURFACE_TUNE.directPictures = true;
}

// ------------------------------------------------------------------ three's lines the plugin leans on, by hash
{
  const text = readFileSync(new URL('../../../node_modules/three/examples/jsm/loaders/GLTFLoader.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const method = (name: string): string => {
    const start = text.indexOf(`\n\t${name}(`);
    assert.ok(start >= 0, `GLTFParser.${name} is in three's GLTFLoader`);
    const end = text.indexOf('\n\t}\n', start);
    return text.slice(start + 1, end + 3);
  };
  const hash = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);
  const pins: [string, string][] = [
    ['loadImageSource', 'd7e4fa81846013ad'],
    ['loadTextureImage', 'e07f8f50b570763b'],
  ];
  for (const [name, want] of pins) {
    const got = hash(method(name));
    ok(got === want, `three's GLTFParser.${name} is the text the plugin was written against (${got}${got === want ? '' : `, recorded ${want}: read the branch for a loader that parses a buffer view itself again, then record it`})`);
  }
  const src = method('loadImageSource');
  ok(/if \( loader\.isKTX2Loader === true && sourceDef\.bufferView !== undefined \) \{[\s\S]*?parser\.getDependency\( 'bufferView', sourceDef\.bufferView \)\.then\( function \( bufferView \) \{[\s\S]*?loader\.parse\( bufferView, resolve, reject \);/.test(src), 'and its branch hands a loader that parses the bytes itself the buffer view, its answer taken as the texture');
}

console.log(`\n${passed} passed`);
