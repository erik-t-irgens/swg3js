// The detail map, end to end: the mesh reader keeps the second coordinate set, the GLB writes it
// and its texture, and the runtime injection puts the multiply where the client's own programs do.
//
// What is worth pinning, rather than what is easy:
//
//  - **Nothing is written where nothing can sample it.** A material naming a detail map with no
//    second coordinate set under it would sample one texel of it over the whole surface, because
//    an unset vertex attribute reads as zero -- a flat tint, and worse than no detail at all. The
//    skinned meshes are exactly that case today, so the guard is not hypothetical.
//  - **The injection writes the whole of its set or none of it.** A declaration with no use
//    compiles; a use with no declaration does not, and a program that will not link is a black box
//    in the frame. This is the trap the ground shader already fell into once.
//  - **Everything it declares, it declares before it uses**, in both stages.
//  - **`USE_UV1` is on the material's own defines**, because three decides whether to declare
//    `attribute vec2 uv1` before `onBeforeCompile` ever runs and reads nothing else that we can set.
//  - **The link survives a clone.** `Material.copy` runs userData through JSON and copies no field
//    the material class does not declare, so a texture in userData would be lost by the interior
//    cells, the ship paint and GLTFLoader's own vertex-colour copies. A string id is not.

import { parseMesh } from '../msh.mjs';
import { parseIff } from '../iff.mjs';
import { buildGlb } from '../glb.mjs';
import { MATERIAL_FORMAT, surfaceCounts, surfaceCountsLine } from '../surface.mjs';
import { applyDetail, injectDetail } from '../../../src/world/detailMap.ts';

let checks = 0;
let bad = 0;
function ok(what: string, pass: boolean, note = ''): void {
  checks++;
  if (!pass) {
    bad++;
    console.log(`  FAIL ${what}${note ? `: ${note}` : ''}`);
  } else console.log(`ok   ${what}${note ? ` (${note})` : ''}`);
}

// ---- The converter: what a GLB carries -----------------------------------------------------------

function group(shader: string, withSecond: boolean) {
  const n = 3;
  return {
    shader,
    primitives: [
      {
        count: n,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
        colors: null,
        uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
        uvs2: withSecond ? new Float32Array([0, 0, 4, 0, 0, 4]) : null,
        indices: new Uint16Array([0, 1, 2]),
      },
    ],
  };
}

const onePx = Buffer.from('89504e470d0a1a0a', 'hex'); // not a real PNG; the writer only measures it
const withDetail = { path: 'texture/wall.dds', png: onePx, detail: { path: 'texture/wall_detail.dds', png: onePx } };
const plain = { path: 'texture/floor.dds', png: onePx };

{
  const glb = buildGlb([{ name: 'm', groups: [group('shader/wall.sht', true)] }], {
    flipX: true,
    textures: new Map([['shader/wall.sht', withDetail]]),
  });
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
  const prim = json.meshes[0].primitives[0];
  ok('a detail shader writes the second coordinate set', prim.attributes.TEXCOORD_1 !== undefined);
  const swg = json.materials[prim.material].extras?.swg;
  ok('and the material names its detail texture', typeof swg?.detail === 'number', JSON.stringify(swg));
  ok('which is a real glTF texture', !!json.textures[swg.detail] && json.images[json.textures[swg.detail].source]?.name === 'texture/wall_detail.dds');
}
{
  // A shader with no detail map: nothing extra, whatever coordinate sets the mesh carries.
  const glb = buildGlb([{ name: 'm', groups: [group('shader/floor.sht', true)] }], {
    flipX: true,
    textures: new Map([['shader/floor.sht', plain]]),
  });
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
  const prim = json.meshes[0].primitives[0];
  ok('a plain shader pays nothing for a set it does not sample', prim.attributes.TEXCOORD_1 === undefined);
  ok('and names no detail map', json.materials[prim.material].extras?.swg?.detail === undefined);
}
{
  // The one that matters: a detail shader on a mesh with no second set. The skinned meshes are this.
  const glb = buildGlb([{ name: 'm', groups: [group('shader/wall.sht', false)] }], {
    flipX: true,
    textures: new Map([['shader/wall.sht', withDetail]]),
  });
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
  const prim = json.meshes[0].primitives[0];
  ok('with no second set nothing is written', prim.attributes.TEXCOORD_1 === undefined);
  ok('and the material names no detail map either, so nothing samples texel zero over the whole surface', json.materials[prim.material].extras?.swg?.detail === undefined);
}

// ---- The counts ------------------------------------------------------------------------------------

{
  const c = surfaceCounts([withDetail, plain, { ...withDetail, path: 'texture/wall2.dds' }]);
  ok('two surfaces are counted as detailed', c.detailed === 2, `${c.detailed}`);
  ok('sharing one map', c.detailMaps === 1, `${c.detailMaps} maps`);
  ok('and the line says so', surfaceCountsLine(c).includes('2 with a detail map (1 maps'), surfaceCountsLine(c));
  ok('a pack is stamped at the format that carries them', MATERIAL_FORMAT >= 4, `${MATERIAL_FORMAT}`);
}

// ---- The injection ------------------------------------------------------------------------------

/** Three's own chunk names, as its standard material's shaders carry them. */
const VS = `
#include <common>
void main() {
	#include <uv_vertex>
	#include <project_vertex>
}
`;
const FS = `
#include <common>
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <map_fragment>
	#include <color_fragment>
}
`;

function shader(vs = VS, fs = FS) {
  return { vertexShader: vs, fragmentShader: fs, uniforms: {} as Record<string, { value: unknown }>, defines: {} };
}
const fakeTexture = { isTexture: true, name: 'detail' } as unknown as import('three').Texture;

{
  const s = shader();
  const went = injectDetail(s as never, fakeTexture);
  ok('the injection goes in', went);
  ok('the uniform is bound', s.uniforms.swgDetailMap?.value === fakeTexture);
  // Declared before used, in both stages -- the trap the ground shader fell into.
  const declVs = s.vertexShader.indexOf('varying vec2 vSwgDetailUv;');
  const useVs = s.vertexShader.indexOf('vSwgDetailUv = uv1;');
  ok('the vertex varying is declared before it is written', declVs >= 0 && useVs > declVs, `decl ${declVs}, use ${useVs}`);
  const declFsV = s.fragmentShader.indexOf('varying vec2 vSwgDetailUv;');
  const declFsS = s.fragmentShader.indexOf('uniform sampler2D swgDetailMap;');
  const useFs = s.fragmentShader.indexOf('texture2D( swgDetailMap, vSwgDetailUv )');
  ok('and the fragment sampler and varying before they are read', declFsV >= 0 && declFsS >= 0 && useFs > declFsV && useFs > declFsS, `${declFsS}, ${declFsV}, ${useFs}`);
  // And in the right place: after the colour texture and before anything lights it, which is where
  // the client's own programs put it (`diffuseColor * detailColor * light`).
  ok('it multiplies the colour after the map and before the lighting', s.fragmentShader.indexOf('#include <map_fragment>') < useFs && useFs < s.fragmentShader.indexOf('#include <color_fragment>'));
  ok('and multiplies the rgb only, as every one of the client\'s detail programs does', /diffuseColor\.rgb \*= texture2D\( swgDetailMap/.test(s.fragmentShader));
}
{
  // A shader with an anchor missing is left exactly as it was, rather than half written.
  const s = shader(VS, '#include <common>\nvoid main() {}\n');
  const before = { vs: s.vertexShader, fs: s.fragmentShader };
  ok('a shader with no map stage is refused', !injectDetail(s as never, fakeTexture));
  ok('and is left untouched, not half written', s.vertexShader === before.vs && s.fragmentShader === before.fs);
  ok('with no uniform bound', s.uniforms.swgDetailMap === undefined);
  const s2 = shader('void main() {}\n', FS);
  ok('and one with no vertex chunks likewise', !injectDetail(s2 as never, fakeTexture) && s2.fragmentShader === FS);
}
{
  // The wrap: the define, the hook order and the key.
  let ran = 0;
  const mat = {
    defines: { SOMETHING: '1' },
    onBeforeCompile: function first() {
      ran++;
    },
    customProgramCacheKey: () => 'base',
  } as unknown as import('three').Material;
  applyDetail(mat, fakeTexture);
  ok('the wrap sets USE_UV1 on the material, which is the only way three declares the attribute', (mat.defines as Record<string, string>).USE_UV1 === '');
  ok('and keeps the defines it had', (mat.defines as Record<string, string>).SOMETHING === '1');
  ok('the program is keyed apart', mat.customProgramCacheKey() === 'detail|base');
  const s = shader();
  (mat.onBeforeCompile as (sh: unknown, r: unknown) => void).call(mat, s, null);
  ok('and whatever hook came before still runs', ran === 1);
  ok('with the detail after it', s.uniforms.swgDetailMap?.value === fakeTexture);
  // Idempotent: wrapping again neither double-wraps nor double-keys.
  const key = mat.customProgramCacheKey();
  applyDetail(mat, fakeTexture);
  ok('wrapping twice is wrapping once', mat.customProgramCacheKey() === key, mat.customProgramCacheKey());
  const s2 = shader();
  (mat.onBeforeCompile as (sh: unknown, r: unknown) => void).call(mat, s2, null);
  ok('and the chunk is not written twice', (s2.fragmentShader.match(/swgDetailMap;/g) ?? []).length === 1);
}
{
  // Re-wrapped around a new hook (the cascades setting up again), with the key it had before.
  let cascade = 0;
  const mat = { defines: {}, onBeforeCompile: () => undefined, customProgramCacheKey: () => 'base' } as unknown as import('three').Material;
  applyDetail(mat, fakeTexture);
  mat.onBeforeCompile = function cascades() {
    cascade++;
  };
  applyDetail(mat, fakeTexture);
  ok('a material whose hook was replaced is wrapped again', mat.customProgramCacheKey() === 'detail|base', mat.customProgramCacheKey());
  const s = shader();
  (mat.onBeforeCompile as (sh: unknown, r: unknown) => void).call(mat, s, null);
  ok('the new hook runs', cascade === 1);
  ok('and the detail is still written', s.uniforms.swgDetailMap?.value === fakeTexture);
}

// ---- The link survives a clone --------------------------------------------------------------------

{
  // What `Material.copy` really does to userData, which is why the link is a string.
  const userData = { swgDetail: 'detail7', swgTrack: 'track2' };
  const copied = JSON.parse(JSON.stringify(userData));
  ok('a string id survives the JSON copy a material clone makes', copied.swgDetail === 'detail7');
  // And a texture would not, which is what makes the string necessary rather than tidy: a real
  // Texture is an object with methods, and the copy comes back as a bag of its enumerable fields
  // with nothing that can be bound, uploaded or disposed.
  class FakeTexture {
    isTexture = true;
    dispose(): void {
      /* the method a copy loses */
    }
  }
  const lost = JSON.parse(JSON.stringify({ detail: new FakeTexture() }));
  ok('and a texture would not (the guard is not vacuous)', !(lost.detail instanceof FakeTexture) && typeof lost.detail.dispose !== 'function', JSON.stringify(lost));
}

// ---- The mesh reader ------------------------------------------------------------------------------

{
  // A vertex array with two 2D sets, built by hand to the format the reader expects.
  const sets = 2;
  // flags: position | normal, 2 texture sets, both 2-dimensional (dim - 1 in two bits from bit 12).
  const flags = 1 | 4 | (sets << 8) | (1 << 12) | (1 << 14);
  const count = 3;
  const stride = 12 + 12 + 8 + 8;
  const data = Buffer.alloc(count * stride);
  for (let i = 0; i < count; i++) {
    const o = i * stride;
    data.writeFloatLE(i, o);
    data.writeFloatLE(0, o + 4);
    data.writeFloatLE(0, o + 8);
    data.writeFloatLE(0, o + 12);
    data.writeFloatLE(1, o + 16);
    data.writeFloatLE(0, o + 20);
    data.writeFloatLE(i * 0.5, o + 24);
    data.writeFloatLE(0.25, o + 28);
    data.writeFloatLE(i * 4, o + 32);
    data.writeFloatLE(8, o + 36);
  }
  const info = Buffer.alloc(8);
  info.writeUInt32LE(flags, 0);
  info.writeInt32LE(count, 4);

  // The smallest MESH the reader will take, written out as IFF.
  const chunk = (tag: string, body: Buffer) => Buffer.concat([Buffer.from(tag.padEnd(4).slice(0, 4), 'latin1'), (() => { const b = Buffer.alloc(4); b.writeUInt32BE(body.length); return b; })(), body]);
  const form = (type: string, body: Buffer) => chunk('FORM', Buffer.concat([Buffer.from(type.padEnd(4).slice(0, 4), 'latin1'), body]));
  const name = Buffer.concat([Buffer.from('shader/wall.sht', 'latin1'), Buffer.from([0])]);
  const primInfo = Buffer.alloc(6);
  primInfo.writeInt32LE(9, 0);
  primInfo[4] = 1;
  const indx = Buffer.alloc(4 + 3 * 2);
  indx.writeInt32LE(3, 0);
  for (let i = 0; i < 3; i++) indx.writeUInt16LE(i, 4 + i * 2);
  const vtxa = form('VTXA', form('0003', Buffer.concat([chunk('INFO', info), chunk('DATA', data)])));
  const prim = form('0001', Buffer.concat([chunk('INFO', primInfo), vtxa, chunk('INDX', indx)]));
  const shaderGroup = form('0001', Buffer.concat([chunk('NAME', name), chunk('INFO', (() => { const b = Buffer.alloc(4); b.writeInt32LE(1); return b; })()), prim]));
  const cnt = Buffer.alloc(4);
  cnt.writeInt32LE(1);
  const sps = form('SPS ', form('0001', Buffer.concat([chunk('CNT ', cnt), shaderGroup])));
  const mesh = form('MESH', form('0005', sps));

  const read = parseMesh(parseIff(mesh));
  const p = read.groups[0].primitives[0];
  ok('the mesh reader keeps the main coordinate set', !!p.uvs && p.uvs[2] === 0.5, p.uvs ? `${p.uvs[0]}, ${p.uvs[1]}, ${p.uvs[2]}` : 'none');
  ok('and the detail one beside it', !!p.uvs2 && p.uvs2[0] === 0 && p.uvs2[1] === 8 && p.uvs2[2] === 4, p.uvs2 ? [...p.uvs2].join(',') : 'none');
  ok('which is a set of its own and not the main one scaled', p.uvs2![3] === 8 && p.uvs![3] === 0.25);
}

console.log(`\ndetail maps: ${checks} checks, ${bad} failed`);
if (bad) process.exit(1);
