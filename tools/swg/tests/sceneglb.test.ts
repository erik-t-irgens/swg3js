// Making a smaller copy of a converted model.
//
// Everything checked here is pure -- buffers in, buffers out -- so a GLB is built by hand, shrunk
// and read back with no converted world in sight. Where the owner's packs are installed it then
// does the same to a real model and reports what it saved, so the claim is measured rather than
// asserted.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { buildGlb, maskImages, readGlb, relayout, shrinkModel, shrinkRgba } from '../sceneglb.mjs';
import { encodePng, decodePng } from '../png.mjs';

let passed = 0;
function ok(cond: boolean, what: string): void {
  assert.ok(cond, what);
  passed++;
  console.log(`ok   ${what}`);
}
const note = (s: string): void => console.log(`note ${s}`);

/** A four-colour image, so an average over any block is predictable. */
function checker(w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      px[i] = x < w / 2 ? 255 : 0;
      px[i + 1] = y < h / 2 ? 255 : 0;
      px[i + 2] = 128;
      px[i + 3] = 255;
    }
  }
  return px;
}

/** A GLB with one image, one mesh-ish buffer view and, optionally, a cut-out material. */
function fakeGlb(dim: number, mask: boolean): Buffer {
  const png = encodePng(dim, dim, checker(dim, dim));
  const verts = Buffer.alloc(48, 7);
  const bin = Buffer.concat([verts, png]);
  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: verts.length, byteStride: 12, target: 34962 },
      { buffer: 0, byteOffset: verts.length, byteLength: png.length },
    ],
    accessors: [{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3' }],
    images: [{ mimeType: 'image/png', bufferView: 1 }],
    textures: [{ source: 0 }],
    materials: [{ alphaMode: mask ? 'MASK' : 'OPAQUE', alphaCutoff: 0.5, pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  return buildGlb(json, bin);
}

{
  // The container, out and back.
  const made = fakeGlb(64, false);
  const back = readGlb(made);
  ok(back.json.asset.version === '2.0' && back.bin.length > 0, 'a GLB written here reads back as itself');
  ok(made.readUInt32LE(8) === made.length, 'with the length in its header matching the file');
  ok(made.length % 4 === 0, 'and every chunk padded to four bytes, as the format requires');
  let threw = false;
  try {
    readGlb(Buffer.from('not a glb at all'));
  } catch {
    threw = true;
  }
  ok(threw, 'something that is not a GLB is refused rather than half-read');
}

{
  // The shrink itself: an area average, not a sample.
  const px = checker(4, 4);
  const half = shrinkRgba(px, 4, 4, 2, 2);
  ok(half.length === 2 * 2 * 4, 'a quarter-size image has a quarter of the texels');
  ok(half[0] === 255 && half[1] === 255, 'the top-left block averages to the colour that fills it');
  ok(half[2] === 128 && half[3] === 255, 'and the channels that were flat come through untouched');
  // Every texel of the source has to contribute, which is what tells an average from a sample.
  const grad = new Uint8Array(4 * 1 * 4);
  for (let x = 0; x < 4; x++) grad[x * 4] = x * 60;
  const one = shrinkRgba(grad, 4, 1, 1, 1);
  ok(one[0] === Math.round((0 + 60 + 120 + 180) / 4), `all four texels are averaged, not two of them sampled (${one[0]})`);
  ok(shrinkRgba(px, 4, 4, 4, 4) === px, 'an image already the right size is handed straight back');
  const odd = shrinkRgba(checker(9, 9), 9, 9, 4, 4);
  ok(odd.length === 4 * 4 * 4 && odd.every((v) => Number.isFinite(v)), 'and a size that does not divide evenly still comes out whole');
}

{
  // Cut-outs, which are the ones that go wrong quietly.
  const masked = readGlb(fakeGlb(64, true));
  ok(maskImages(masked.json).has(0), 'an image feeding a cut-out material is found');
  const plain = readGlb(fakeGlb(64, false));
  ok(maskImages(plain.json).size === 0, 'and one feeding an ordinary material is not');
  let sawMask = false;
  shrinkModel(fakeGlb(64, true), (src: number, isMask: boolean) => {
    sawMask = sawMask || isMask;
    return isMask ? src : 8;
  });
  ok(sawMask, 'the shrink tells the caller which images are cut-outs, so the rule can spare them');
}

{
  // A real shrink, end to end.
  const out = shrinkModel(fakeGlb(256, false), () => 32);
  const back = readGlb(out.buf);
  ok(out.buf.length < out.before, `the copy is smaller than the model it came from (${out.before} to ${out.buf.length} bytes)`);
  const view = back.json.bufferViews[back.json.images[0].bufferView];
  const img = decodePng(back.bin.subarray(view.byteOffset, view.byteOffset + view.byteLength));
  ok(!!img && img.width === 32 && img.height === 32, `and its texture really is the size it was asked for (${img?.width} by ${img?.height})`);
  ok(out.images[0].from === 256 && out.images[0].to === 32, 'which is reported rather than left to be discovered');

  // The part that would be easy to break: everything else must survive intact.
  const verts = back.json.bufferViews[0];
  const bytes = back.bin.subarray(verts.byteOffset, verts.byteOffset + verts.byteLength);
  ok(verts.byteLength === 48 && bytes.every((v: number) => v === 7), 'the vertex data comes through byte for byte');
  ok(verts.byteStride === 12 && verts.target === 34962, 'with its stride and target, which say how it is read and not where it sits');
  ok(back.json.buffers[0].byteLength === back.bin.length, "and the buffer's own length matches the blob it describes");
  for (const v of back.json.bufferViews) ok(v.byteOffset % 4 === 0, `every view stays four-byte aligned after the move (${v.byteOffset})`);
  ok(back.json.accessors[0].bufferView === 0 && back.json.materials[0].alphaMode === 'OPAQUE', 'and nothing else in the document was disturbed');
}

{
  // Never bigger than it started: asking for more than the source holds must not upscale.
  const same = shrinkModel(fakeGlb(32, false), () => 512);
  ok(same.images[0].to === 32, 'a texture is never enlarged past what the source really holds');
}

{
  // Animated surfaces, which are the ones that would break silently. The converter writes a
  // flip-book as `extras.swg.anim` with a list of **texture indices**, and a scroll as
  // `extras.swg.scroll`; the game reads them off `userData` and swaps between those textures every
  // frame. A shrink that renumbered a texture, dropped an image or lost the extras would leave a
  // sign animating to the wrong frames, or to none, with nothing to say so.
  const png = encodePng(32, 32, checker(32, 32));
  const frames = [encodePng(32, 32, checker(32, 32)), encodePng(32, 32, checker(32, 32)), encodePng(32, 32, checker(32, 32))];
  const bin = Buffer.concat([png, ...frames]);
  let at = 0;
  const views = [png, ...frames].map((b) => {
    const v = { buffer: 0, byteOffset: at, byteLength: b.length };
    at += b.length;
    return v;
  });
  const doc = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: views,
    images: views.map((_, i) => ({ mimeType: 'image/png', bufferView: i })),
    textures: views.map((_, i) => ({ source: i })),
    materials: [
      {
        alphaMode: 'OPAQUE',
        pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
        extras: { unlit: true, swg: { anim: { mode: 'time', seconds: [0.1, 0.1], map: [1, 2, 3] }, scroll: { map: [0, 0.175] }, alphaMap: 2 } },
      },
    ],
    meshes: [{ primitives: [{ attributes: {}, material: 0 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  const out = shrinkModel(buildGlb(doc, bin), () => 16);
  const back = readGlb(out.buf);
  const swg = back.json.materials[0].extras?.swg;
  ok(!!swg, 'a shrunk model keeps the extras the converter wrote on its materials');
  ok(JSON.stringify(swg.anim.map) === '[1,2,3]', `and the flip-book still names the same texture indices (${JSON.stringify(swg.anim?.map)})`);
  ok(swg.anim.seconds[0] === 0.1 && swg.scroll.map[1] === 0.175 && swg.alphaMap === 2, 'with its timing, its scroll rate and its alpha map untouched');
  ok(back.json.images.length === 4 && back.json.textures.length === 4, `every frame of the flip-book survives (${back.json.images.length} images)`);
  const sizes = back.json.images.map((im: { bufferView: number }) => {
    const v = back.json.bufferViews[im.bufferView];
    const d = decodePng(back.bin.subarray(v.byteOffset, v.byteOffset + v.byteLength));
    return `${d?.width}x${d?.height}`;
  });
  ok(new Set(sizes).size === 1, `and every frame comes out the same size as the others, or the swap would jump (${[...new Set(sizes)].join(', ')})`);
  ok(back.json.materials[0].extras.unlit === true, 'and the other extras the game reads come through with them');
}

{
  // A real model, if one is installed.
  const dir = 'assets-private/tatooine';
  const file = existsSync(dir) ? readdirSync(dir).find((f) => f.endsWith('.glb')) : null;
  if (!file) {
    note('no converted world here, so the checks above stand on their own');
  } else {
    const src = readFileSync(`${dir}/${file}`);
    const out = shrinkModel(src, (s: number, isMask: boolean) => Math.min(s, isMask ? 128 : 64));
    const back = readGlb(out.buf);
    ok(back.json.meshes?.length === readGlb(src).json.meshes?.length, 'a real model keeps every mesh it had');
    ok(out.buf.length <= src.length, `and comes out no larger (${(src.length / 1024).toFixed(0)} KB to ${(out.buf.length / 1024).toFixed(0)} KB)`);
    const shrunk = out.images.filter((i: { to?: number; from?: number }) => i.to !== undefined && i.from !== undefined && i.to < i.from);
    note(`${file}: ${out.images.length} images, ${shrunk.length} shrunk, ${(src.length / 1024).toFixed(0)} KB down to ${(out.buf.length / 1024).toFixed(0)} KB`);
  }
}

console.log(`\n${passed} checks passed`);
